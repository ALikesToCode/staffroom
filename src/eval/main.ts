import type { ItemCheck, Verdict } from '../core/types';
import { checkItems, detailsFor, onDeviceAsk } from '../ai/check';
import { paragraphs } from '../ai/guard';
import { deviceStatus, modelFor, prepareDevice } from '../ai/routes';
import { combineChecks, ruleCheckItem } from '../core/conflicts';
import { CASES, prepare, totals, type EvalCase, type EvalRow } from './cases';
import { prepareFull } from './full';
import { HELDOUT } from './heldout';
import { runRuleSet } from './rules';
import { FIT_CASES, FIT_CHILD_CASES, fitRow, fitTotals, lessonFitCases, lessonFitRow, lessonFitTotals, type FitRow, type LessonFitRow } from './fit';
import { FIT_CHILD_SYSTEM, FIT_LESSON_SYSTEM, fitLessonSchema, onDeviceFit } from '../ai/fit';
import { runLessonSet } from './lesson';
import { LEARNING_CASES, learningVault, runLearningRules, runNeedsSet } from './needs';
import { LEARNING_SCHEMA, LEARNING_SYSTEM, readLearningAnswer } from '../ai/learning';

// A developer page, not part of the app. It runs fixed cases through the same check the app runs and shows
// what came back. Nothing is sent anywhere: the model sets use the ONLY_ON_DEVICE route, and the rule set
// uses no model at all.

const status = document.getElementById('eval-status')!;
const table = document.getElementById('eval-rows') as HTMLTableSectionElement;
const json = document.getElementById('eval-json')!;
const start = document.getElementById('eval-start') as HTMLButtonElement;

const params = new URLSearchParams(location.search);
const runs = Math.max(1, Math.min(20, Number(params.get('runs')) || 1));
/**
 * ?set=rules: the rule layer on its own, no model, any browser.
 * ?set=full: the whole sample note and six fixed drafts, both layers.
 * ?set=heldout: sixteen single-fact cases the model has not been tuned on.
 * ?set=fit: fourteen steps in conflict, each rewritten by the on-device model for the child, and eight steps of a lesson for which it says what one child does instead.
 * ?set=lesson: five whole lesson plans against the sample class, rule layer only, no model.
 * ?set=needs: five lesson replies with lines for needs, placed beside the children of the sample class. Plain code, no model.
 * ?set=learning: twelve paragraphs for the proposer of learning needs: the rule, and the on-device model where there is one.
 * No set: the 24 single-fact cases.
 */
const set = (['rules', 'full', 'heldout', 'fit', 'lesson', 'needs', 'learning'] as const).find((s) => s === params.get('set')) ?? 'cases';
/** One fact at a time is the default, as in the app. ?perFact=0 asks about all of a child's facts in one prompt. */
const perFact = params.get('perFact') !== '0';

const SET_NAME: Record<typeof set, string> = {
  cases: '24 single-fact cases, on-device model only',
  heldout: '16 held-out single-fact cases, on-device model only',
  full: 'full note, 30 items in 6 drafts, rule layer and on-device model',
  rules: 'rule layer only, no model',
  fit: '14 steps in conflict rewritten, and 8 steps of a lesson fitted to one child, by the on-device model',
  lesson: '5 lesson plans against the sample class, rule layer only, no model',
  needs: '5 lesson replies with lines for needs, placed beside the children of the sample class, plain code, no model',
  learning: '12 paragraphs for the proposer of learning needs, by rule and by the on-device model',
};
document.getElementById('eval-mode')!.textContent =
  set === 'rules' || set === 'lesson' || set === 'needs' || set === 'learning'
    ? `Set: ${SET_NAME[set]}.`
    : set === 'fit'
      ? `Set: ${SET_NAME[set]}. Runs of each: ${runs}.`
    : `Set: ${SET_NAME[set]}. Mode: ${perFact ? 'one fact at a time' : 'all facts of a child in one prompt'}. Runs of each: ${runs}.`;

function cell(row: HTMLTableRowElement, text: string, className = '') {
  const td = row.insertCell();
  td.textContent = text;
  if (className) td.className = className;
}

function show(rows: EvalRow[], done: boolean) {
  json.textContent = JSON.stringify(
    { done, at: new Date().toISOString(), userAgent: navigator.userAgent, set, perFact, runsPerCase: runs, totals: totals(rows), ...layerTotals(rows), rows },
    null,
    2,
  );
}

/** For the full-note set: how each layer did on its own, counted from the rows. */
function layerTotals(rows: EvalRow[]) {
  if (set !== 'full') return {};
  const conflicts = rows.filter((r) => r.expected === 'conflict');
  const others = rows.filter((r) => r.expected === 'compatible');
  return {
    layerA: {
      conflictsCaught: conflicts.filter((r) => r.layerA === 'conflict').length,
      conflictsQueried: conflicts.filter((r) => r.layerA === 'unsure').length,
      conflictsMissed: conflicts.filter((r) => r.layerA === 'none').length,
      compatibleFlagged: others.filter((r) => r.layerA !== 'none').length,
    },
    layerB: {
      conflictsSaidNo: conflicts.filter((r) => r.layerB === 'conflict').length,
      conflictsNotSure: conflicts.filter((r) => r.layerB === 'unsure').length,
      conflictsMissed: conflicts.filter((r) => r.layerB === 'fits').length,
      compatibleSaidNo: others.filter((r) => r.layerB === 'conflict').length,
      compatibleNotSure: others.filter((r) => r.layerB === 'unsure').length,
    },
  };
}

/** What the on-device model itself answered. Its "no" is a doubt in the app; here it is counted as the conflict it called. */
const modelAnswer = (c: ItemCheck): Verdict => (c.modelSaid === 'conflict' ? 'conflict' : c.verdict);

interface Outcome {
  got: EvalRow['got'];
  reason: string;
  requests: number;
  layerA?: EvalRow['layerA'];
  layerB?: EvalRow['layerB'];
}

/** One thing to check: an item, the vault it is checked against, and what the check ought to say. */
interface Job {
  id: string;
  topic: EvalRow['topic'];
  expected: EvalRow['expected'];
  /** Shown in the table: the facts the item is checked against. */
  facts: string;
  advice: string;
  check: () => Promise<Outcome>;
}

function jobs(ask: ReturnType<typeof onDeviceAsk>): Job[] {
  const options = { perFact };
  if (set === 'full') {
    const full = prepareFull();
    const paras = paragraphs(full.note);
    return full.cases.map((c) => ({
      id: c.id,
      topic: 'full note' as const,
      expected: c.expected,
      facts: detailsFor(c.item, full.entities)
        .flatMap((g) => g.details.map((d) => d.surfaces[0]))
        .join(' | '),
      advice: `${c.student}: ${c.item.text}`,
      check: async () => {
        // Layer A: the rules, against the confirmed constraints. Layer B: the model, against the withheld facts.
        const byRule = ruleCheckItem(c.item, full.constraints, full.entities, full.tokens, full.note);
        const run = await checkItems([c.item], full.entities, paras, full.tokens, ask, undefined, options);
        const failed = run.failed > 0 && run.answered === 0;
        const both = combineChecks(byRule, failed ? undefined : run.checks[0], { verdict: 'not checked', reason: 'The on-device model did not answer.' });
        return {
          got: both.verdict,
          reason: both.also ? `${both.reason} | Model: ${both.also}` : both.reason,
          requests: run.asked,
          layerA: byRule.hit?.verdict ?? 'none',
          layerB: failed ? 'failed' : modelAnswer(run.checks[0]),
        };
      },
    }));
  }
  const list: EvalCase[] = set === 'heldout' ? HELDOUT : CASES;
  return list.map((c) => {
    const p = prepare(c);
    return {
      id: c.id,
      topic: c.topic,
      expected: c.expected,
      facts: c.fact,
      advice: c.advice,
      check: async () => {
        const run = await checkItems([p.item], p.entities, paragraphs(p.note), p.tokens, ask, undefined, options);
        return { got: run.failed > 0 && run.answered === 0 ? 'failed' : modelAnswer(run.checks[0]), reason: run.checks[0].reason, requests: run.asked };
      },
    };
  });
}

/** The fit: each step is rewritten on the device, and the rewrite is read by rule. Nothing here judges whether the rewrite is good advice. */
async function runFit() {
  start.disabled = true;
  document.body.dataset.state = 'running';
  const rows: (FitRow & { run: number; ms: number })[] = [];
  const ask = onDeviceFit();
  const askChild = onDeviceFit(FIT_CHILD_SYSTEM);
  const cases = [...FIT_CASES.map((c) => ({ c, child: false })), ...FIT_CHILD_CASES.map((c) => ({ c, child: true }))];
  const lessonRows: (LessonFitRow & { run: number; ms: number })[] = [];
  const lessonCases = lessonFitCases();
  const report = (done: boolean) =>
    (json.textContent = JSON.stringify(
      {
        done,
        at: new Date().toISOString(),
        userAgent: navigator.userAgent,
        set,
        runsPerCase: runs,
        totals: fitTotals(rows),
        rows,
        // What each child needs in a lesson. "rating" on each point is null: it is for a person who reads the point to fill in.
        lessonTotals: lessonFitTotals(lessonRows),
        lessonRows,
      },
      null,
      2,
    ));
  let n = 0;
  for (let r = 1; r <= runs; r++) {
    for (const { c, child } of cases) {
      status.textContent = `Run ${r} of ${runs}: step ${++n} of ${cases.length * runs} (${c.id})`;
      const began = performance.now();
      const row = { ...(await fitRow(c, child ? askChild : ask, child)), run: r, ms: 0 };
      row.ms = Math.round(performance.now() - began);
      rows.push(row);
      const tr = table.insertRow();
      cell(tr, String(r));
      cell(tr, c.id);
      cell(tr, `${row.kind}: ${row.constraint}`);
      cell(tr, row.step);
      cell(tr, 'a rewrite no rule fires on');
      cell(
        tr,
        row.error ? 'failed' : row.offered.ok ? `offered after ${row.offered.requests} ${row.offered.requests === 1 ? 'request' : 'requests'}` : 'nothing offered',
        row.offered.ok ? 'right' : 'wrong',
      );
      cell(
        tr,
        row.error ??
          [
            row.first.produced ? `First answer: ${row.first.rewrite}` : 'First answer: no rewrite.',
            row.first.produced ? (row.first.rulePasses ? 'No rule fires on it.' : `A rule matched “${row.first.matched.join('”, “')}”.`) : '',
            row.first.factWords.length > 0 ? `It repeats words of the fact: ${row.first.factWords.join(', ')}.` : '',
            row.offered.ok && row.offered.suggestion !== row.first.rewrite ? `Offered: ${row.offered.suggestion}` : '',
            row.offered.ok && row.offered.factWords.length > 0 && row.offered.suggestion !== row.first.rewrite ? `It repeats words of the fact: ${row.offered.factWords.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
      );
      cell(tr, String(row.ms));
      report(false);
    }
    // What each child needs in each of the five lessons: one request for a child, as in the app.
    let m = 0;
    for (const c of lessonCases) {
      status.textContent = `Run ${r} of ${runs}: lesson and child ${++m} of ${lessonCases.length} (${c.id})`;
      const began = performance.now();
      const row = { ...(await lessonFitRow(c, (stages) => onDeviceFit(FIT_LESSON_SYSTEM, fitLessonSchema(stages)))), run: r, ms: 0 };
      row.ms = Math.round(performance.now() - began);
      lessonRows.push(row);
      const tr = table.insertRow();
      const said = (p: LessonFitRow['first'][number]) =>
        `[${p.stage}] ${p.do} (${p.realStage ? 'a stage of the lesson' : 'no such stage'}; ${p.rulePasses ? 'no rule fires' : p.realStage ? `a rule matched “${p.matched.join('”, “')}”` : 'not read by rule'}; ${
          p.repeats.length > 0 ? `repeats private words: ${p.repeats.join(', ')}` : 'repeats no private words'
        }; rating: not rated)`;
      cell(tr, String(r));
      cell(tr, c.id);
      cell(tr, `the note about ${c.child}`);
      cell(tr, `${c.lesson}: the whole lesson, one line for each stage`);
      cell(tr, 'at most two points, each for a stage, that no rule fires on');
      cell(tr, row.error ? 'failed' : !row.read ? 'no answer could be read' : `${row.offered.length} offered`, row.error || !row.read ? 'wrong' : '');
      cell(
        tr,
        row.error ??
          [
            row.first.length > 0 ? `First answer: ${row.first.map(said).join(' ')}` : 'First answer: no points.',
            row.requests > 1 ? `Asked once more. Offered: ${row.offered.map(said).join(' ') || 'nothing'}.` : '',
            row.droppedByRule > 0 ? `Left out by rule: ${row.droppedByRule}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
      );
      cell(tr, String(row.ms));
      report(false);
    }
  }
  const t = fitTotals(rows);
  const l = lessonFitTotals(lessonRows);
  status.textContent = `Done (${SET_NAME.fit}). What each child needs in a lesson: ${l.calls} calls, ${l.read} read, ${l.noPoints} with no points; ${l.points} points in first answers, ${l.realStage} naming a stage of the lesson, ${l.rulePasses} with no rule firing, ${l.repeatsPrivate} repeating private words; ${l.offered} offered, ${l.droppedByRule} left out by rule; stopped ${l.errors}; rated by a person ${l.rated}. Steps: First answers: ${t.produced} of ${t.cases} were a rewrite, ${t.rulePasses} had no rule fire on them, ${t.saysFact} repeated words of the private fact. Offered after at most one retry: ${t.offered} of ${t.cases} (${t.offeredSaysFact} repeating words of the fact). Stopped: ${t.errors}.`;
  report(true);
  document.body.dataset.state = 'done';
}

async function run() {
  if (set === 'fit') return runFit();
  start.disabled = true;
  document.body.dataset.state = 'running';
  const rows: EvalRow[] = [];
  const list = jobs(onDeviceAsk());
  let n = 0;
  for (let r = 1; r <= runs; r++) {
    for (const job of list) {
      status.textContent = `Run ${r} of ${runs}: case ${++n} of ${list.length * runs} (${job.id})`;
      const began = performance.now();
      const row: EvalRow = { id: job.id, run: r, topic: job.topic, expected: job.expected, got: 'failed', reason: '', ms: 0 };
      try {
        Object.assign(row, await job.check());
      } catch (e) {
        row.reason = e instanceof Error ? e.message : String(e);
      }
      row.ms = Math.round(performance.now() - began);
      rows.push(row);
      const right = (row.expected === 'conflict' && row.got === 'conflict') || (row.expected === 'compatible' && row.got === 'fits');
      const tr = table.insertRow();
      cell(tr, String(r));
      cell(tr, job.id);
      cell(tr, job.facts);
      cell(tr, job.advice);
      cell(tr, row.expected);
      cell(tr, row.layerA === undefined ? row.got : `${row.got} (rule: ${row.layerA}; model: ${row.layerB})`, right ? 'right' : row.got === 'unsure' ? 'unsure' : 'wrong');
      cell(tr, row.reason);
      cell(tr, String(row.ms));
      show(rows, false);
    }
  }
  const t = totals(rows);
  status.textContent = `Done (${SET_NAME[set]}${perFact ? ', one fact at a time' : ''}). Conflicts caught: ${t.conflictsCaught} of ${t.conflictCases} (unsure ${t.conflictsUnsure}, missed ${t.conflictsMissed}). Compatible wrongly flagged as conflict: ${t.compatibleFlaggedAsConflict} of ${t.compatibleCases} (unsure ${t.compatibleUnsure}). Failures: ${t.failures}. Median ${t.medianMs} ms a check.`;
  show(rows, true);
  document.body.dataset.state = 'done';
}

/** Five whole lessons against the sample class, by rule. No model, so it runs at once in any browser. */
function runLessons() {
  const { rows, totals: t } = runLessonSet();
  for (const row of rows) {
    const tr = table.insertRow();
    cell(tr, '1');
    cell(tr, `${row.id}`);
    cell(tr, row.child);
    cell(tr, `${row.subject}: ${row.stage}`);
    cell(tr, row.outcome === 'false alarm' ? 'suits everyone' : 'needs fitting');
    cell(tr, row.outcome, row.outcome === 'caught' ? 'right' : 'wrong');
    cell(tr, row.matched ? `matched “${row.matched}”` : '');
    cell(tr, '');
  }
  status.textContent = `Done (${SET_NAME.lesson}). Of ${t.expected} stages labelled as not suiting a child: ${t.caught} caught, ${t.missed} missed. False alarms: ${t.falseAlarms}.`;
  json.textContent = JSON.stringify({ done: true, at: new Date().toISOString(), userAgent: navigator.userAgent, set, totals: t, rows }, null, 2);
  document.body.dataset.state = 'done';
}

/** Five replies with lines for needs: the parser and the placing. No model, so it runs at once in any browser. */
function runNeeds() {
  const { rows, totals: t } = runNeedsSet();
  for (const row of rows) {
    const tr = table.insertRow();
    cell(tr, '1');
    cell(tr, row.id);
    cell(tr, `Need ${row.letter}`);
    cell(tr, row.stage);
    cell(tr, `beside ${row.child}${row.hitExpected ? ', and a rule fires' : ''}`);
    cell(tr, `${row.outcome}${row.hitFound ? ', a rule fired' : ''}`, row.outcome === 'right' && row.hitExpected === row.hitFound ? 'right' : 'wrong');
    cell(tr, row.why);
    cell(tr, '');
  }
  status.textContent = `Done (${SET_NAME.needs}). Of ${t.lines} labelled lines: ${t.right} beside the right child, ${t.missing} missing, ${t.wrongChild} beside a wrong child. Lines left out (letter not sent, or no words): ${t.droppedFound}, expected ${t.droppedExpected}. Rule hits: ${t.hitsFound} of ${t.hitsExpected} found, ${t.hitsFalse} not labelled.`;
  json.textContent = JSON.stringify({ done: true, at: new Date().toISOString(), userAgent: navigator.userAgent, set, totals: t, rows }, null, 2);
  document.body.dataset.state = 'done';
}

/** Twelve paragraphs for the proposer of learning needs. The rule runs anywhere; the on-device model is asked only where there is one. Its lines are for a person to read. */
async function runLearning() {
  const byRule = runLearningRules();
  const device = await deviceStatus();
  const model = device === 'available' ? modelFor('guard', { system: LEARNING_SYSTEM, schema: LEARNING_SCHEMA }) : null;
  const rows: unknown[] = [];
  let kept = 0;
  let dropped = 0;
  let unread = 0;
  for (const [i, c] of LEARNING_CASES.entries()) {
    status.textContent = `Paragraph ${i + 1} of ${LEARNING_CASES.length} (${c.id})`;
    const rule = byRule.rows[i];
    let said = 'not asked: no on-device model here';
    let needs: { quote: string; need: string }[] = [];
    let ms = 0;
    if (model) {
      const began = performance.now();
      try {
        const result = await model.generateContent(`Paragraph:\n${c.paragraph}`);
        if (result.response.inferenceSource !== 'on_device') throw new Error('the answer did not come from the device');
        const reading = readLearningAnswer(c.paragraph, c.paragraph, result.response.text(), learningVault(c));
        if (!reading) {
          unread++;
          said = 'the answer could not be read';
        } else {
          kept += reading.needs.length;
          dropped += reading.dropped;
          needs = reading.needs.map((n) => ({ quote: n.text, need: n.need ?? '' }));
          said = `${needs.map((n) => `“${n.quote}” -> ${n.need}`).join('; ') || 'no needs'}${reading.dropped > 0 ? ` (left out: ${reading.dropped})` : ''}`;
        }
      } catch (e) {
        unread++;
        said = `failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      ms = Math.round(performance.now() - began);
    }
    rows.push({ id: c.id, paragraph: c.paragraph, expected: rule.expected, byRule: rule.found, ruleRight: rule.right, byModel: needs, modelSaid: said, rating: null, ms });
    const tr = table.insertRow();
    cell(tr, '1');
    cell(tr, c.id);
    cell(tr, c.paragraph);
    cell(tr, 'the learning needs in it');
    cell(tr, rule.expected.join(', ') || 'none');
    cell(tr, `rule: ${rule.found.join(', ') || 'none'}`, rule.right ? 'right' : 'wrong');
    cell(tr, `on-device model: ${said}`);
    cell(tr, String(ms));
  }
  const totals = { cases: byRule.cases, ruleRight: byRule.right, model: model ? { needsKept: kept, leftOut: dropped, unread } : null };
  status.textContent = `Done (${SET_NAME.learning}). By rule: ${byRule.right} of ${byRule.cases} paragraphs with exactly the labelled kinds. ${model ? `On-device model: ${kept} needs kept, ${dropped} left out (quote not in the paragraph, or a line that is too long or does not pass the gate), ${unread} paragraphs unread. Its lines are not rated here.` : 'The on-device model was not asked: this browser has none.'}`;
  json.textContent = JSON.stringify({ done: true, at: new Date().toISOString(), userAgent: navigator.userAgent, set, totals, rows }, null, 2);
  document.body.dataset.state = 'done';
}

/** The rule layer on its own. No model, so it runs at once in any browser. */
function runRules() {
  const { rows, totals: t } = runRuleSet();
  for (const row of rows) {
    const tr = table.insertRow();
    cell(tr, '1');
    cell(tr, `${row.id} (${row.sort})`);
    cell(tr, `${row.kind}: ${row.constraint}`);
    cell(tr, row.step);
    cell(tr, row.expected);
    cell(tr, row.got, row.right ? 'right' : row.got === 'unsure' ? 'unsure' : 'wrong');
    cell(tr, row.matched ? `matched “${row.matched}”` : '');
    cell(tr, '');
  }
  status.textContent = `Done (${SET_NAME.rules}). Conflicts caught: ${t.caught} of ${t.conflictCases} (queried ${t.queried}, missed ${t.missed}). False alarms on the other cases: ${t.falseAlarms} of ${t.otherCases}.`;
  json.textContent = JSON.stringify({ done: true, at: new Date().toISOString(), userAgent: navigator.userAgent, set, totals: t, rows }, null, 2);
  document.body.dataset.state = 'done';
}

async function begin() {
  if (set === 'rules') return runRules();
  if (set === 'lesson') return runLessons();
  if (set === 'needs') return runNeeds();
  if (set === 'learning') return runLearning();
  const device = await deviceStatus();
  if (device === 'available') return run();
  if (device === 'downloadable' || device === 'downloading') {
    status.textContent = 'The on-device model is not loaded yet. Press the button to load it and run.';
    start.hidden = false;
    start.onclick = async () => {
      start.disabled = true;
      try {
        await prepareDevice((f) => (status.textContent = `Loading the on-device model: ${Math.round(f * 100)}%`));
        await run();
      } catch (e) {
        status.textContent = `The on-device model could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
        document.body.dataset.state = 'no-model';
      }
    };
    return;
  }
  status.textContent = `This browser has no on-device model (${device}), so the check cannot be measured here. Nothing was run. The rule layer needs no model: add ?set=rules to the address.`;
  document.body.dataset.state = 'no-model';
  json.textContent = JSON.stringify({ done: false, error: `no on-device model (${device})` }, null, 2);
}

void begin();
