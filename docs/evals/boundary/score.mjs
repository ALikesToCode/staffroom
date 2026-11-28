#!/usr/bin/env node
/**
 * Deterministic Boundary Evaluation Scorer (Part B — Arms 1, 2, and 4a x 3).
 *
 * One-command reproducible evaluation of:
 *   - Arm 1: Cloud-only baseline (raw note sent as-is)
 *   - Arm 2: submitted-fallback (tag `submitted-fallback`, rules-only pass-through)
 *   - Arm 4a: boundary (current workspace, rules-only x 3 runs)
 *
 * Usage:
 *   node docs/evals/boundary/score.mjs
 *
 * Outputs:
 *   docs/evals/boundary/raw-rules.json
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const ROOT = process.cwd();
const CASES_PATH = resolve(ROOT, 'docs/evals/boundary/cases.json');
const OUT_PATH = resolve(ROOT, 'docs/evals/boundary/raw-rules.json');
const FALLBACK_DIR = `/tmp/staffroom-fallback-${process.pid}`;

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

function detailSpanOverlap(note, spanA, spanB) {
  return spanA[0] < spanB[1] && spanB[0] < spanA[1];
}

function checkConstraintCoverage(c, detail, entities) {
  const note = c.note;
  const dStart = note.toLowerCase().indexOf(detail.text.toLowerCase());
  const dSpan = dStart >= 0 ? [dStart, dStart + detail.text.length] : null;
  const dToks = (detail.leakTokens ?? []).map(norm);
  const dLow = norm(detail.text);
  const wantKind = detail.expectedNeed?.kind ?? '';

  for (const con of c.constraints) {
    const cLow = norm(con.text);
    const kindMatch =
      wantKind === '' ||
      (wantKind.startsWith('learning:') && con.kind === 'learning' && con.learn === wantKind.slice('learning:'.length)) ||
      (wantKind.startsWith('action:') && (con.kind === 'health' || con.kind === 'other' || con.kind === 'contact' || con.kind === 'learning')) ||
      con.kind === wantKind;
    if (!kindMatch) continue;
    if (dSpan && typeof con.at === 'number') {
      if (detailSpanOverlap(note, dSpan, [con.at, con.at + con.text.length])) return con;
    }
    if (cLow && (dLow.includes(cLow) || cLow.includes(dLow) || dToks.some((t) => t.length >= 4 && cLow.includes(t)))) {
      return con;
    }
  }
  // Check withheld entities overlap if no constraint text matched directly (for entity-only needs)
  void entities;
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
      if (hSpan && detailSpanOverlap(caseObj.note, hSpan, [sp.start, sp.end])) {
        hits.push({ type: 'entity', kind: e.kind, surface: caseObj.note.slice(sp.start, sp.end) });
      }
    }
    for (const s of e.surfaces ?? []) {
      const sLow = norm(s);
      if (sLow.length >= 3 && hLow.includes(sLow)) {
        // Confirm whole-word or non-trivial token match inside harmless span when spans not present
        if (!(e.spans?.length)) hits.push({ type: 'entity-surface', kind: e.kind, surface: s });
      }
    }
  }
  for (const con of constraints) {
    const cLow = norm(con.text);
    if (hSpan && typeof con.at === 'number') {
      if (detailSpanOverlap(caseObj.note, hSpan, [con.at, con.at + con.text.length])) {
        hits.push({ type: 'constraint', kind: con.kind, text: con.text });
      }
    } else if (cLow && hLow.includes(cLow)) {
      hits.push({ type: 'constraint-text', kind: con.kind, text: con.text });
    }
  }
  return hits;
}

async function loadModules(rootDir) {
  const srv = await createServer({
    configFile: false,
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  const [vault, constraints, lessonNeeds, needs, lesson] = await Promise.all([
    srv.ssrLoadModule('/src/core/vault.ts'),
    srv.ssrLoadModule('/src/core/constraints.ts'),
    srv.ssrLoadModule('/src/core/lessonNeeds.ts'),
    srv.ssrLoadModule('/src/core/needs.ts'),
    srv.ssrLoadModule('/src/core/lesson.ts'),
  ]);
  return { srv, vault, constraints, lessonNeeds, needs, lesson };
}

function runRulesOnCase(mods, caseObj, isBoundary) {
  const { note, classList, lesson } = caseObj;
  const entities0 = mods.vault.buildVault(note, [
    ...mods.vault.deterministicCandidates(note, classList),
    ...mods.vault.possibleNameCandidates(note, classList),
  ]);
  const proposed = [
    ...mods.constraints.proposeConstraints(note, entities0),
    ...mods.lessonNeeds.proposeLearning(note, entities0),
  ];
  let held = { entities: entities0, constraints: proposed };
  for (const c of proposed) {
    if (!held.constraints.find((x) => x.id === c.id)?.confirmed) {
      held = mods.constraints.confirmConstraint(note, held.entities, held.constraints, c.id);
    }
  }
  held = {
    ...held,
    constraints: held.constraints.map((c) =>
      c.confirmed && mods.lessonNeeds.lessonNeedLine(c) !== undefined ? { ...c, share: true } : c,
    ),
  };
  const baseOut = isBoundary
    ? mods.needs.outgoingOf(note, held.entities, held.constraints, true, lesson)
    : mods.needs.outgoingOf(note, held.entities, held.constraints, true);
  const fullOut = mods.lesson.withLessonGoing(baseOut, lesson, held.entities, classList);
  return { entities: held.entities, constraints: held.constraints, outgoing: fullOut };
}

function evaluateArm(cases, getOutText, opts = { scoreNeeds: false, scoreHarmless: false }) {
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

  for (const c of cases) {
    byLanguage[c.language] ??= { details: 0, leaks: 0, autoTotal: 0, autoExactCloud: 0, actionTotal: 0, actionDetected: 0 };
    const { outText, entities, constraints } = getOutText(c);
    const normOut = norm(outText);

    for (const d of c.details) {
      totalDetails++;
      byLanguage[c.language].details++;
      byCategory[d.category] ??= { total: 0, leaks: 0 };
      byCategory[d.category].total++;

      const { leaked, matched } = checkDetailLeak(d, outText);
      if (leaked) {
        byLanguage[c.language].leaks++;
        byCategory[d.category].leaks++;
        leaks.push({ caseId: c.id, language: c.language, detailId: d.id, category: d.category, matched, text: d.text });
      }

      if (opts.scoreNeeds && d.expectedNeed) {
        const isAction = d.expectedNeed.kind.startsWith('action:');
        const coveredByConstraint = checkConstraintCoverage({ note: c.note, constraints }, d, entities);
        if (!isAction) {
          autoTotal++;
          byLanguage[c.language].autoTotal++;
          const exact = normOut.includes(norm(d.expectedNeed.line));
          if (exact) {
            autoExactCloud++;
            byLanguage[c.language].autoExactCloud++;
          } else {
            missedAuto.push({
              caseId: c.id,
              language: c.language,
              detailId: d.id,
              category: d.category,
              expectedLine: d.expectedNeed.line,
              expectedKind: d.expectedNeed.kind,
              detectedOnDevice: Boolean(coveredByConstraint),
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
              detailText: d.text,
            });
          }
        }
      }
    }

    if (opts.scoreHarmless) {
      for (const h of c.harmless) {
        harmlessTotal++;
        const hits = checkHarmlessFalseHold(c, h, entities, constraints);
        if (hits.length > 0) {
          falseHolds.push({ caseId: c.id, language: c.language, harmlessId: h.id, text: h.text, hits });
        }
      }
    }
  }

  return {
    cases: cases.length,
    totalDetails,
    leaksCount: leaks.length,
    leakRatePct: Number(((leaks.length / totalDetails) * 100).toFixed(2)),
    byLanguage,
    byCategory,
    leaks,
    ...(opts.scoreNeeds
      ? {
          usefulness: {
            autoSharedCatalogue: { total: autoTotal, exactInOutgoing: autoExactCloud, detectedOnDevice: autoDetected, recallPct: Number(((autoExactCloud / autoTotal) * 100).toFixed(2)) },
            teacherSelectableActions: { total: actionTotal, detectedOnDevice: actionDetected, recallPct: Number(((actionDetected / actionTotal) * 100).toFixed(2)), autoSentToCloud: 0 },
            allExpectedNeeds: { total: autoTotal + actionTotal, reachedCloudOrDetectedForTeacher: autoExactCloud + actionDetected, recallPct: Number((((autoExactCloud + actionDetected) / (autoTotal + actionTotal)) * 100).toFixed(2)) },
          },
          missedAuto,
          missedAction,
        }
      : {}),
    ...(opts.scoreHarmless
      ? {
          harmless: { total: harmlessTotal, falseHolds: falseHolds.length, ratePct: Number(((falseHolds.length / harmlessTotal) * 100).toFixed(2)), details: falseHolds },
        }
      : {}),
  };
}

const dataset = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
const cases = dataset.cases;

let fallbackSrv;
let boundarySrv;
try {
  rmSync(FALLBACK_DIR, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'add', '--detach', FALLBACK_DIR, 'submitted-fallback'], { cwd: ROOT, stdio: 'pipe' });
  if (!existsSync(join(FALLBACK_DIR, 'node_modules'))) {
    symlinkSync(join(ROOT, 'node_modules'), join(FALLBACK_DIR, 'node_modules'));
  }

  const fbMods = await loadModules(FALLBACK_DIR);
  fallbackSrv = fbMods.srv;
  const bdMods = await loadModules(ROOT);
  boundarySrv = bdMods.srv;

  // Arm 1: Cloud-only (raw note sent)
  const arm1 = evaluateArm(cases, (c) => ({ outText: c.note, entities: [], constraints: [] }));

  // Arm 2: submitted-fallback (rules only)
  const arm2 = evaluateArm(
    cases,
    (c) => {
      const r = runRulesOnCase(fbMods, c, false);
      return { outText: r.outgoing.text, entities: r.entities, constraints: r.constraints };
    },
    { scoreNeeds: true, scoreHarmless: true },
  );

  // Arm 4a: boundary (rules only x 3 runs)
  const arm4aRuns = [];
  for (let runIdx = 1; runIdx <= 3; runIdx++) {
    const r = evaluateArm(
      cases,
      (c) => {
        const res = runRulesOnCase(bdMods, c, true);
        return { outText: res.outgoing.text, entities: res.entities, constraints: res.constraints };
      },
      { scoreNeeds: true, scoreHarmless: true },
    );
    arm4aRuns.push({ run: runIdx, ...r });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    casesCount: cases.length,
    detailsCount: cases.reduce((n, c) => n + c.details.length, 0),
    harmlessCount: cases.reduce((n, c) => n + c.harmless.length, 0),
    arm1_cloudOnly: arm1,
    arm2_fallbackRulesOnly: arm2,
    arm4a_boundaryRulesOnly: {
      runs: arm4aRuns,
      summary: arm4aRuns[0],
    },
  };

  mkdirSync(resolve(ROOT, 'docs/evals/boundary'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');

  console.log('\n=== Deterministic Boundary Evaluation Summary (score.mjs) ===');
  console.log(`Cases: ${out.casesCount} | Seeded details: ${out.detailsCount} | Harmless: ${out.harmlessCount}`);
  console.log(`Arm 1 (Cloud-only)            : ${arm1.leaksCount}/${arm1.totalDetails} leaks (${arm1.leakRatePct}%)`);
  console.log(`Arm 2 (submitted-fallback R)  : ${arm2.leaksCount}/${arm2.totalDetails} leaks (${arm2.leakRatePct}%)`);
  for (const r of arm4aRuns) {
    console.log(
      `Arm 4a Run ${r.run} (boundary R)    : ${r.leaksCount}/${r.totalDetails} leaks | auto-shared ${r.usefulness.autoSharedCatalogue.exactInOutgoing}/${r.usefulness.autoSharedCatalogue.total} (${r.usefulness.autoSharedCatalogue.recallPct}%) | actions-detected ${r.usefulness.teacherSelectableActions.detectedOnDevice}/${r.usefulness.teacherSelectableActions.total} (${r.usefulness.teacherSelectableActions.recallPct}%) | harmless false-holds ${r.harmless.falseHolds}/${r.harmless.total}`,
    );
  }
  console.log(`Saved ${OUT_PATH}`);
} finally {
  if (fallbackSrv) await fallbackSrv.close().catch(() => {});
  if (boundarySrv) await boundarySrv.close().catch(() => {});
  try {
    execFileSync('git', ['worktree', 'remove', '--force', FALLBACK_DIR], { cwd: ROOT, stdio: 'ignore' });
  } catch {}
  rmSync(FALLBACK_DIR, { recursive: true, force: true });
}
