import { checkItems, detailsFor, onDeviceAsk } from '../ai/check';
import { paragraphs } from '../ai/guard';
import { deviceStatus, prepareDevice } from '../ai/routes';
import { CASES, prepare, totals, type EvalRow } from './cases';
import { prepareFull } from './full';

// A developer page, not part of the app. It runs the fixed cases through the same check the app runs
// (checkItems, on the ONLY_ON_DEVICE route) and shows what came back. Nothing is sent anywhere.

const status = document.getElementById('eval-status')!;
const table = document.getElementById('eval-rows')!;
const json = document.getElementById('eval-json')!;
const start = document.getElementById('eval-start') as HTMLButtonElement;

const params = new URLSearchParams(location.search);
const runs = Math.max(1, Math.min(20, Number(params.get('runs')) || 1));
/** ?set=full: the whole sample note and five fixed drafts, in place of the 24 single-fact cases. */
const full = params.get('set') === 'full';
/** ?perFact=1: ask about one fact at a time (see CheckOptions.perFact). */
const perFact = params.get('perFact') === '1';
document.getElementById('eval-mode')!.textContent = `Set: ${full ? 'full note, 25 items in 5 drafts' : '24 single-fact cases'}. Mode: ${perFact ? 'one fact at a time' : 'all facts of a child in one prompt'}. Runs of each: ${runs}.`;

function cell(row: HTMLTableRowElement, text: string, className = '') {
  const td = row.insertCell();
  td.textContent = text;
  if (className) td.className = className;
}

function show(rows: EvalRow[], done: boolean) {
  json.textContent = JSON.stringify(
    { done, at: new Date().toISOString(), userAgent: navigator.userAgent, set: full ? 'full' : 'cases', perFact, runsPerCase: runs, totals: totals(rows), rows },
    null,
    2,
  );
}

/** One thing to check: an item, the vault it is checked against, and what the check ought to say. */
interface Job {
  id: string;
  topic: EvalRow['topic'];
  expected: EvalRow['expected'];
  /** Shown in the table: the facts the item is checked against. */
  facts: string;
  advice: string;
  check: () => ReturnType<typeof checkItems>;
}

function jobs(ask: ReturnType<typeof onDeviceAsk>): Job[] {
  const options = { perFact };
  if (full) {
    const set = prepareFull();
    const paras = paragraphs(set.note);
    return set.cases.map((c) => ({
      id: c.id,
      topic: 'full note' as const,
      expected: c.expected,
      facts: detailsFor(c.item, set.entities)
        .flatMap((g) => g.details.map((d) => d.surfaces[0]))
        .join(' | '),
      advice: `${c.student}: ${c.item.text}`,
      check: () => checkItems([c.item], set.entities, paras, set.tokens, ask, undefined, options),
    }));
  }
  return CASES.map((c) => {
    const p = prepare(c);
    return {
      id: c.id,
      topic: c.topic,
      expected: c.expected,
      facts: c.fact,
      advice: c.advice,
      check: () => checkItems([p.item], p.entities, paragraphs(p.note), p.tokens, ask, undefined, options),
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
        const result = await job.check();
        row.got = result.failed > 0 && result.answered === 0 ? 'failed' : result.checks[0].verdict;
        row.reason = result.checks[0].reason;
        row.requests = result.asked;
      } catch (e) {
        row.reason = e instanceof Error ? e.message : String(e);
      }
      row.ms = Math.round(performance.now() - began);
      rows.push(row);
      const right = (row.expected === 'conflict' && row.got === 'conflict') || (row.expected === 'compatible' && row.got === 'fits');
      const tr = (table as HTMLTableSectionElement).insertRow();
      cell(tr, String(r));
      cell(tr, job.id);
      cell(tr, job.facts);
      cell(tr, job.advice);
      cell(tr, row.expected);
      cell(tr, row.got, right ? 'right' : row.got === 'unsure' ? 'unsure' : 'wrong');
      cell(tr, row.reason);
      cell(tr, String(row.ms));
      show(rows, false);
    }
  }
  const t = totals(rows);
  status.textContent = `Done (${full ? 'full note' : 'single facts'}${perFact ? ', one fact at a time' : ''}). Conflicts caught: ${t.conflictsCaught} of ${t.conflictCases} (unsure ${t.conflictsUnsure}, missed ${t.conflictsMissed}). Compatible wrongly flagged as conflict: ${t.compatibleFlaggedAsConflict} of ${t.compatibleCases} (unsure ${t.compatibleUnsure}). Failures: ${t.failures}. Median ${t.medianMs} ms a check.`;
  show(rows, true);
  document.body.dataset.state = 'done';
}

async function begin() {
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
  status.textContent = `This browser has no on-device model (${device}), so the check cannot be measured here. Nothing was run.`;
  document.body.dataset.state = 'no-model';
  json.textContent = JSON.stringify({ done: false, error: `no on-device model (${device})` }, null, 2);
}

void begin();
