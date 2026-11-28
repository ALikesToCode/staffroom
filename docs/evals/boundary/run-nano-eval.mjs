#!/usr/bin/env node
/**
 * Gemini Nano & Local-vs-Cloud Boundary Evaluation Runner (Part B — Arms 3, 4b x 3, Local vs Cloud).
 *
 * Requires Chrome 158 with built-in Gemini Nano at:
 *   /home/mysterious/.cache/buildhybridai/chrome/opt/google/chrome/google-chrome
 * and profile at:
 *   /home/mysterious/.cache/buildhybridai/profile
 *
 * Outputs:
 *   docs/evals/boundary/raw-nano.json
 *   docs/evals/boundary/raw-local-vs-cloud.json
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const ROOT = process.cwd();
const CASES_PATH = resolve(ROOT, 'docs/evals/boundary/cases.json');
const NANO_OUT = resolve(ROOT, 'docs/evals/boundary/raw-nano.json');
const LVC_OUT = resolve(ROOT, 'docs/evals/boundary/raw-local-vs-cloud.json');

const CHROME = '/home/mysterious/.cache/buildhybridai/chrome/opt/google/chrome/google-chrome';
const PROFILE = '/home/mysterious/.cache/buildhybridai/profile';
const FALLBACK_DIR = `/tmp/staffroom-fallback-nano-${process.pid}`;
const PORT_FB = 5181;
const PORT_BD = 5182;
const CDP_PORT = 5412;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function checkDetailLeak(detail, outText) {
  const hay = norm(outText);
  if (!hay) return { leaked: false, matched: [] };
  const matched = [];
  if (hay.includes(norm(detail.text))) matched.push(detail.text);
  for (const tok of detail.leakTokens ?? []) {
    if (hay.includes(norm(tok))) matched.push(tok);
  }
  return { leaked: matched.length > 0, matched };
}

function spanOverlap(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

function checkConstraintCoverage(note, constraints, detail) {
  const dStart = note.toLowerCase().indexOf(detail.text.toLowerCase());
  const dSpan = dStart >= 0 ? [dStart, dStart + detail.text.length] : null;
  const dToks = (detail.leakTokens ?? []).map(norm);
  const dLow = norm(detail.text);
  const wantKind = detail.expectedNeed?.kind ?? '';

  for (const con of constraints) {
    const cLow = norm(con.text);
    const kindMatch =
      wantKind === '' ||
      (wantKind.startsWith('learning:') && con.kind === 'learning' && con.learn === wantKind.slice('learning:'.length)) ||
      (wantKind.startsWith('action:') && (con.kind === 'health' || con.kind === 'other' || con.kind === 'contact' || con.kind === 'learning')) ||
      con.kind === wantKind;
    if (!kindMatch) continue;
    if (dSpan && typeof con.at === 'number') {
      if (spanOverlap(dSpan, [con.at, con.at + con.text.length])) return con;
    }
    if (cLow && (dLow.includes(cLow) || cLow.includes(dLow) || dToks.some((t) => t.length >= 4 && cLow.includes(t)))) {
      return con;
    }
  }
  return null;
}

function checkHarmlessFalseHold(caseObj, h, entities, constraints) {
  const hLow = norm(h.text);
  const hIdx = caseObj.note.toLowerCase().indexOf(hLow);
  const hSpan = hIdx >= 0 ? [hIdx, hIdx + h.text.length] : null;
  const hits = [];

  for (const e of entities) {
    if (!e.withheld) continue;
    for (const sp of e.spans ?? []) {
      if (hSpan && spanOverlap(hSpan, [sp.start, sp.end])) {
        hits.push({ type: 'entity', kind: e.kind, surface: caseObj.note.slice(sp.start, sp.end) });
      }
    }
    for (const s of e.surfaces ?? []) {
      const sLow = norm(s);
      if (sLow.length >= 3 && hLow.includes(sLow) && !(e.spans?.length)) {
        hits.push({ type: 'entity-surface', kind: e.kind, surface: s });
      }
    }
  }
  for (const con of constraints) {
    const cLow = norm(con.text);
    if (hSpan && typeof con.at === 'number') {
      if (spanOverlap(hSpan, [con.at, con.at + con.text.length])) {
        hits.push({ type: 'constraint', kind: con.kind, text: con.text });
      }
    } else if (cLow && hLow.includes(cLow)) {
      hits.push({ type: 'constraint-text', kind: con.kind, text: con.text });
    }
  }
  return hits;
}

function scoreRecords(cases, perCaseResults, opts = { scoreNeeds: false, scoreHarmless: false }) {
  const byId = new Map(perCaseResults.map((r) => [r.caseId, r]));
  const leaks = [];
  const byLanguage = {};
  const byCategory = {};
  let totalDetails = 0;

  let autoTotal = 0;
  let autoExactCloud = 0;
  let autoDetected = 0;
  const missedAuto = [];

  let actionTotal = 0;
  let actionDetected = 0;
  const missedAction = [];

  let harmlessTotal = 0;
  const falseHolds = [];

  let onDeviceCount = 0;
  let totalGuardMs = 0;

  for (const c of cases) {
    const res = byId.get(c.id);
    if (res.guardWhere === 'ON_DEVICE') onDeviceCount++;
    totalGuardMs += res.durationMs ?? 0;
    byLanguage[c.language] ??= { details: 0, leaks: 0, autoTotal: 0, autoExactCloud: 0, actionTotal: 0, actionDetected: 0 };
    const normOut = norm(res.outText);

    for (const d of c.details) {
      totalDetails++;
      byLanguage[c.language].details++;
      byCategory[d.category] ??= { total: 0, leaks: 0 };
      byCategory[d.category].total++;

      const { leaked, matched } = checkDetailLeak(d, res.outText);
      if (leaked) {
        byLanguage[c.language].leaks++;
        byCategory[d.category].leaks++;
        leaks.push({ caseId: c.id, language: c.language, detailId: d.id, category: d.category, matched, text: d.text });
      }

      if (opts.scoreNeeds && d.expectedNeed) {
        const isAction = d.expectedNeed.kind.startsWith('action:');
        const coveredByConstraint = checkConstraintCoverage(c.note, res.constraints, d);
        if (!isAction) {
          autoTotal++;
          byLanguage[c.language].autoTotal++;
          if (normOut.includes(norm(d.expectedNeed.line))) {
            autoExactCloud++;
            byLanguage[c.language].autoExactCloud++;
          } else {
            missedAuto.push({
              caseId: c.id,
              language: c.language,
              detailId: d.id,
              category: d.category,
              expectedKind: d.expectedNeed.kind,
              expectedLine: d.expectedNeed.line,
              detectedOnDevice: Boolean(coveredByConstraint),
              guardWhere: res.guardWhere,
              detailText: d.text,
            });
          }
          if (coveredByConstraint) autoDetected++;
        } else {
          actionTotal++;
          byLanguage[c.language].actionTotal++;
          if (coveredByConstraint) {
            actionDetected++;
            byLanguage[c.language].actionDetected++;
          } else {
            missedAction.push({
              caseId: c.id,
              language: c.language,
              detailId: d.id,
              category: d.category,
              expectedKind: d.expectedNeed.kind,
              expectedLine: d.expectedNeed.line,
              guardWhere: res.guardWhere,
              detailText: d.text,
            });
          }
        }
      }
    }

    if (opts.scoreHarmless) {
      for (const h of c.harmless) {
        harmlessTotal++;
        const hits = checkHarmlessFalseHold(c, h, res.entities, res.constraints);
        if (hits.length > 0) {
          falseHolds.push({ caseId: c.id, language: c.language, harmlessId: h.id, text: h.text, hits });
        }
      }
    }
  }

  return {
    cases: cases.length,
    onDeviceCases: onDeviceCount,
    avgGuardMs: Math.round(totalGuardMs / cases.length),
    totalDetails,
    leaksCount: leaks.length,
    leakRatePct: Number(((leaks.length / totalDetails) * 100).toFixed(2)),
    byLanguage,
    byCategory,
    leaks,
    ...(opts.scoreNeeds
      ? {
          usefulness: {
            autoSharedCatalogue: {
              total: autoTotal,
              exactInOutgoing: autoExactCloud,
              detectedOnDevice: autoDetected,
              recallPct: Number(((autoExactCloud / autoTotal) * 100).toFixed(2)),
            },
            teacherSelectableActions: {
              total: actionTotal,
              detectedOnDevice: actionDetected,
              recallPct: Number(((actionDetected / actionTotal) * 100).toFixed(2)),
              autoSentToCloud: 0,
            },
            allExpectedNeeds: {
              total: autoTotal + actionTotal,
              reachedCloudOrDetectedForTeacher: autoExactCloud + actionDetected,
              recallPct: Number((((autoExactCloud + actionDetected) / (autoTotal + actionTotal)) * 100).toFixed(2)),
            },
          },
          missedAuto,
          missedAction,
        }
      : {}),
    ...(opts.scoreHarmless
      ? {
          harmless: {
            total: harmlessTotal,
            falseHolds: falseHolds.length,
            ratePct: Number(((falseHolds.length / harmlessTotal) * 100).toFixed(2)),
            details: falseHolds,
          },
        }
      : {}),
  };
}

const dataset = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
const cases = dataset.cases;

let fbSrv;
let bdSrv;
let chrome;
let ws;

const closeAll = async () => {
  try { ws?.close(); } catch {}
  try { chrome?.kill('SIGTERM'); } catch {}
  if (fbSrv) await fbSrv.close().catch(() => {});
  if (bdSrv) await bdSrv.close().catch(() => {});
  try { execFileSync('git', ['worktree', 'remove', '--force', FALLBACK_DIR], { cwd: ROOT, stdio: 'ignore' }); } catch {}
  rmSync(FALLBACK_DIR, { recursive: true, force: true });
};

try {
  rmSync(FALLBACK_DIR, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'add', '--detach', FALLBACK_DIR, 'submitted-fallback'], { cwd: ROOT, stdio: 'pipe' });
  if (!existsSync(join(FALLBACK_DIR, 'node_modules'))) {
    symlinkSync(join(ROOT, 'node_modules'), join(FALLBACK_DIR, 'node_modules'));
  }
  if (!existsSync(join(FALLBACK_DIR, '.env.local')) && existsSync(join(ROOT, '.env.local'))) {
    symlinkSync(join(ROOT, '.env.local'), join(FALLBACK_DIR, '.env.local'));
  }

  fbSrv = await createServer({ configFile: false, root: FALLBACK_DIR, server: { host: '127.0.0.1', port: PORT_FB, strictPort: true, hmr: false }, logLevel: 'silent' });
  await fbSrv.listen();
  bdSrv = await createServer({ configFile: false, root: ROOT, server: { host: '127.0.0.1', port: PORT_BD, strictPort: true, hmr: false }, logLevel: 'silent' });
  await bdSrv.listen();

  for (const s of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    rmSync(`${PROFILE}/${s}`, { force: true });
  }
  chrome = spawn(CHROME, [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--window-size=1280,800',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, TMPDIR: '/tmp', XDG_RUNTIME_DIR: '/tmp' },
  });

  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const tab = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let cdpId = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++cdpId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'self.FIREBASE_APPCHECK_DEBUG_TOKEN="43b6c530-4a23-4451-bf1d-8125fa1891c2";',
  });

  const ev = async (expr, timeout = 300000) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async()=>{${expr}})()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    }
    return r.result?.result?.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const setupPage = async (url) => {
    await send('Page.navigate', { url });
    await sleep(1200);
    const status = await ev(`
      const routes = await import('/src/ai/routes.ts');
      const dev = await routes.deviceStatus();
      window.__evalMods = {
        guard: await import('/src/ai/guard.ts'),
        aiConstraints: await import('/src/ai/constraints.ts'),
        vault: await import('/src/core/vault.ts'),
        constraints: await import('/src/core/constraints.ts'),
        lessonNeeds: await import('/src/core/lessonNeeds.ts'),
        needs: await import('/src/core/needs.ts'),
        lesson: await import('/src/core/lesson.ts'),
      };
      return dev;
    `);
    if (status !== 'available') throw new Error(`Chrome Gemini Nano not ready on ${url}: ${status}`);
  };

  const runGuardInBrowser = async (c, isBoundary) => {
    return await ev(`
      const m = window.__evalMods;
      const note = ${JSON.stringify(c.note)};
      const classList = ${JSON.stringify(c.classList)};
      const lesson = ${JSON.stringify(c.lesson)};
      const isBoundary = ${JSON.stringify(isBoundary)};
      const t0 = performance.now();
      const candidates = m.vault.deterministicCandidates(note, classList);
      const report = await m.guard.guardCombinedOnDevice(note, () => {});
      candidates.push(...report.candidates);
      const outcome = m.guard.guardOutcome(report);
      if (outcome.where === 'RULES_ONLY') {
        candidates.push(...m.vault.possibleNameCandidates(note, classList));
      } else if (outcome.unread.length > 0) {
        candidates.push(...m.vault.possibleNameCandidates(m.guard.unreadText(note, outcome.unread), classList));
      }
      const vault = m.vault.buildVault(note, candidates);
      let proposed = m.constraints.proposeConstraints(note, vault);
      if (outcome.where === 'ON_DEVICE') {
        const fromModel = m.guard.constraintsFromCombined(note, vault, report.rawParagraphAnswers);
        proposed = m.aiConstraints.mergeProposals(proposed, fromModel.constraints);
      }
      proposed = m.aiConstraints.mergeLearningIntoConstraints(proposed, m.lessonNeeds.proposeLearning(note, vault));
      let held = { entities: vault, constraints: proposed };
      for (const x of proposed) {
        if (!held.constraints.find(k => k.id === x.id)?.confirmed) {
          held = m.constraints.confirmConstraint(note, held.entities, held.constraints, x.id);
        }
      }
      held = {
        ...held,
        constraints: held.constraints.map(k => k.confirmed && m.lessonNeeds.lessonNeedLine(k) !== undefined ? { ...k, share: true } : k),
      };
      const baseOut = isBoundary
        ? m.needs.outgoingOf(note, held.entities, held.constraints, true, lesson)
        : m.needs.outgoingOf(note, held.entities, held.constraints, true);
      const fullOut = m.lesson.withLessonGoing(baseOut, lesson, held.entities, classList);
      return {
        caseId: ${JSON.stringify(c.id)},
        guardWhere: outcome.where,
        durationMs: Math.round(performance.now() - t0),
        unread: outcome.unread,
        dropped: outcome.dropped,
        outText: fullOut.text,
        entities: held.entities,
        constraints: held.constraints,
        lessonNeeds: fullOut.lessonNeeds ?? [],
      };
    `);
  };

  const lvcOnly = process.argv.includes('--lvc-only');
  let run1BoundaryRecords = null;

  if (!lvcOnly) {
    // Arm 3: submitted-fallback (rules + Gemini Nano)
    console.log('\n[Arm 3] Running submitted-fallback (rules + Gemini Nano) across', cases.length, 'cases...');
    await setupPage(`http://127.0.0.1:${PORT_FB}/`);
    const arm3Records = [];
    for (let i = 0; i < cases.length; i++) {
      const r = await runGuardInBrowser(cases[i], false);
      arm3Records.push(r);
      if ((i + 1) % 3 === 0 || i + 1 === cases.length) {
        console.log(`  Arm 3: ${i + 1}/${cases.length} (${r.caseId}: ${r.guardWhere}, ${r.durationMs}ms)`);
      }
    }
    const arm3 = scoreRecords(cases, arm3Records, { scoreNeeds: true, scoreHarmless: true });

    // Arm 4b: boundary (rules + Gemini Nano x 3 runs)
    await setupPage(`http://127.0.0.1:${PORT_BD}/`);
    const arm4bRuns = [];
    for (let runIdx = 1; runIdx <= 3; runIdx++) {
      console.log(`\n[Arm 4b Run ${runIdx}/3] Running boundary (rules + Gemini Nano) across ${cases.length} cases...`);
      const recs = [];
      for (let i = 0; i < cases.length; i++) {
        const r = await runGuardInBrowser(cases[i], true);
        recs.push(r);
        if ((i + 1) % 5 === 0 || i + 1 === cases.length) {
          console.log(`  Arm 4b R${runIdx}: ${i + 1}/${cases.length} (${r.caseId}: ${r.guardWhere}, ${r.durationMs}ms, needs=${r.lessonNeeds.length})`);
        }
      }
      if (runIdx === 1) run1BoundaryRecords = recs;
      const scored = scoreRecords(cases, recs, { scoreNeeds: true, scoreHarmless: true });
      arm4bRuns.push({ run: runIdx, ...scored });
      if (scored.leaksCount > 0) {
        console.error(`STOPPING CONDITION TRIGGERED: Arm 4b Run ${runIdx} had ${scored.leaksCount} leaks!`);
      }
    }

    const mean = (arr) => Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));
    const median = (arr) => {
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[mid] : Number(((s[mid - 1] + s[mid]) / 2).toFixed(2));
    };

    const nanoOut = {
      generatedAt: new Date().toISOString(),
      chromeVersion: 'Chrome 158 + Gemini Nano',
      casesCount: cases.length,
      detailsCount: cases.reduce((n, c) => n + c.details.length, 0),
      harmlessCount: cases.reduce((n, c) => n + c.harmless.length, 0),
      arm3_fallbackRulesPlusNano: arm3,
      arm4b_boundaryRulesPlusNano: {
        runs: arm4bRuns,
        summary: {
          leaksAcrossAllRuns: arm4bRuns.map((r) => r.leaksCount),
          autoExactPerRun: arm4bRuns.map((r) => r.usefulness.autoSharedCatalogue.exactInOutgoing),
          autoTotal: arm4bRuns[0].usefulness.autoSharedCatalogue.total,
          autoRecallPctPerRun: arm4bRuns.map((r) => r.usefulness.autoSharedCatalogue.recallPct),
          autoRecallMeanPct: mean(arm4bRuns.map((r) => r.usefulness.autoSharedCatalogue.recallPct)),
          autoRecallMedianPct: median(arm4bRuns.map((r) => r.usefulness.autoSharedCatalogue.recallPct)),
          actionDetectedPerRun: arm4bRuns.map((r) => r.usefulness.teacherSelectableActions.detectedOnDevice),
          actionTotal: arm4bRuns[0].usefulness.teacherSelectableActions.total,
          actionRecallPctPerRun: arm4bRuns.map((r) => r.usefulness.teacherSelectableActions.recallPct),
          actionRecallMeanPct: mean(arm4bRuns.map((r) => r.usefulness.teacherSelectableActions.recallPct)),
          actionRecallMedianPct: median(arm4bRuns.map((r) => r.usefulness.teacherSelectableActions.recallPct)),
          harmlessFalseHoldsPerRun: arm4bRuns.map((r) => r.harmless.falseHolds),
          harmlessTotal: arm4bRuns[0].harmless.total,
        },
      },
    };
    mkdirSync(resolve(ROOT, 'docs/evals/boundary'), { recursive: true });
    writeFileSync(NANO_OUT, JSON.stringify(nanoOut, null, 2) + '\n');
  } else {
    await setupPage(`http://127.0.0.1:${PORT_BD}/`);
  }

  // Local-only vs Cloud lesson on SAMPLE_NOTE + 5 diverse cases (c01, c06, c26, c35, c42)
  console.log('\n[Local-vs-Cloud] Running 6 lessons (Cloud vs Local-only Gemini Nano fallback)...');
  const lvcCaseIds = ['c01', 'c06', 'c26', 'c35', 'c42'];
  if (!run1BoundaryRecords) {
    run1BoundaryRecords = [];
    for (const cid of lvcCaseIds) {
      run1BoundaryRecords.push(await runGuardInBrowser(cases.find((c) => c.id === cid), true));
    }
  }
  const recById = new Map(run1BoundaryRecords.map((r) => [r.caseId, r]));
  const cloudModel = await ev(`
    const fb = await import('/src/ai/firebase.ts');
    try {
      const pol = await fb.loadPolicy();
      return pol?.cloudModel || fb.DEFAULT_POLICY.cloudModel;
    } catch {
      return fb.DEFAULT_POLICY.cloudModel;
    }
  `);
  console.log('Policy cloudModel =', cloudModel);
  const lvcTargets = [
    { id: 'sample', useSample: true },
    ...lvcCaseIds.map((id) => ({ id, caseObj: cases.find((c) => c.id === id) })),
  ];

  const lvcResults = [];
  for (const target of lvcTargets) {
    let payloadInput;
    if (target.useSample) {
      payloadInput = await ev(`
        const samples = await import('/src/core/samples.ts');
        const m = window.__evalMods;
        const entities0 = m.vault.buildVault(samples.SAMPLE_NOTE, m.vault.deterministicCandidates(samples.SAMPLE_NOTE, samples.SAMPLE_CLASS_LIST));
        const report = await m.guard.guardCombinedOnDevice(samples.SAMPLE_NOTE, () => {});
        const vault = m.vault.buildVault(samples.SAMPLE_NOTE, [...m.vault.deterministicCandidates(samples.SAMPLE_NOTE, samples.SAMPLE_CLASS_LIST), ...report.candidates]);
        let proposed = m.constraints.proposeConstraints(samples.SAMPLE_NOTE, vault);
        const fromModel = m.guard.constraintsFromCombined(samples.SAMPLE_NOTE, vault, report.rawParagraphAnswers);
        proposed = m.aiConstraints.mergeProposals(proposed, fromModel.constraints);
        proposed = m.aiConstraints.mergeLearningIntoConstraints(proposed, m.lessonNeeds.proposeLearning(samples.SAMPLE_NOTE, vault));
        let held = { entities: vault, constraints: proposed };
        for (const x of proposed) {
          if (!held.constraints.find(k => k.id === x.id)?.confirmed) {
            held = m.constraints.confirmConstraint(samples.SAMPLE_NOTE, held.entities, held.constraints, x.id);
          }
        }
        held = {
          ...held,
          constraints: held.constraints.map(k => k.confirmed && m.lessonNeeds.lessonNeedLine(k) !== undefined ? { ...k, share: true } : k),
        };
        const lesson = { klass: 'Class 6', subject: 'English', topic: 'Writing a short description of a place', minutes: 40, lastTime: '' };
        const out = m.lesson.withLessonGoing(m.needs.outgoingOf(samples.SAMPLE_NOTE, held.entities, held.constraints, true, lesson), lesson, held.entities, samples.SAMPLE_CLASS_LIST);
        return { lesson, classList: samples.SAMPLE_CLASS_LIST, entities: held.entities, constraints: held.constraints, outText: out.text, lessonNeeds: out.lessonNeeds };
      `);
    } else {
      const r = recById.get(target.id);
      payloadInput = {
        lesson: target.caseObj.lesson,
        classList: target.caseObj.classList,
        entities: r.entities,
        constraints: r.constraints,
        outText: r.outText,
        lessonNeeds: r.lessonNeeds,
      };
    }

    const runOneDraft = async (offlineMode) => {
      await send('Network.emulateNetworkConditions', {
        offline: offlineMode,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await sleep(200);
      return await ev(`
        const draftMod = await import('/src/ai/draft.ts');
        const boundaryMod = await import('/src/core/boundary.ts');
        const samples = await import('/src/core/samples.ts');
        const ln = await import('/src/core/lessonNeeds.ts');
        const input = ${JSON.stringify(payloadInput)};
        const built = boundaryMod.buildLessonPayload(input.lesson, input.lessonNeeds, input.constraints);
        const lessonTask = samples.TASKS.find(t => t.id === 'lesson');
        const t0 = performance.now();
        try {
          const res = await draftMod.writeDraft(input.outText, lessonTask, ${JSON.stringify(cloudModel)}, undefined, undefined, {
            payload: built.payload,
            entities: input.entities,
            classList: input.classList,
          });
          const elapsed = Math.round(performance.now() - t0);
          const letters = input.lessonNeeds.map(n => n.letter);
          const split = ln.splitVariations(res.draft, letters);
          return {
            ok: true,
            durationMs: elapsed,
            where: res.where,
            model: res.model,
            toldNeeds: letters.length,
            accountedCount: letters.length - split.missing.length,
            variationsCount: split.variations.length,
            noneCount: split.none.length,
            missingLetters: split.missing,
            droppedCount: split.dropped,
            stagesCount: split.draft.items.length,
            title: res.draft.title,
          };
        } catch (err) {
          return { ok: false, durationMs: Math.round(performance.now() - t0), error: String(err?.message ?? err) };
        }
      `, 180000);
    };

    const cloudRes = await runOneDraft(false);
    const localRes = await runOneDraft(true);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    console.log(`  ${target.id}: told=${payloadInput.lessonNeeds.length} | Cloud=${cloudRes.ok ? `${cloudRes.durationMs}ms ${cloudRes.accountedCount}/${cloudRes.toldNeeds}` : cloudRes.error} | Local=${localRes.ok ? `${localRes.durationMs}ms ${localRes.accountedCount}/${localRes.toldNeeds}` : localRes.error}`);
    lvcResults.push({
      id: target.id,
      toldNeeds: payloadInput.lessonNeeds.length,
      cloud: cloudRes,
      local: localRes,
    });
  }

  writeFileSync(LVC_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), cloudModel, results: lvcResults }, null, 2) + '\n');

  if (!lvcOnly) {
    console.log('\n=== Gemini Nano Evaluation Summary ===');
    console.log(`Saved ${NANO_OUT} and ${LVC_OUT}`);
  } else {
    console.log(`\nSaved ${LVC_OUT}`);
  }
} finally {
  await closeAll();
}
