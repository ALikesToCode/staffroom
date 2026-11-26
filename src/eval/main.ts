import type { ItemCheck, Verdict } from '../core/types';
import { checkItems, detailsFor, onDeviceAsk } from '../ai/check';
import { paragraphs } from '../ai/guard';
import { deviceStatus, prepareDevice } from '../ai/routes';
import { combineChecks, ruleCheckItem } from '../core/conflicts';
import { CASES, prepare, totals, type EvalCase, type EvalRow } from './cases';
import { prepareFull } from './full';
import { HELDOUT } from './heldout';
import { runRuleSet } from './rules';

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
 * No set: the 24 single-fact cases.
 */
const set = (['rules', 'full', 'heldout'] as const).find((s) => s === params.get('set')) ?? 'cases';
/** One fact at a time is the default, as in the app. ?perFact=0 asks about all of a child's facts in one prompt. */
const perFact = params.get('perFact') !== '0';

const SET_NAME: Record<typeof set, string> = {
  cases: '24 single-fact cases, on-device model only',
  heldout: '16 held-out single-fact cases, on-device model only',
  full: 'full note, 30 items in 6 drafts, rule layer and on-device model',
  rules: 'rule layer only, no model',
};
document.getElementById('eval-mode')!.textContent =
  set === 'rules'
    ? `Set: ${SET_NAME[set]}.`
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

async function run() {
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
