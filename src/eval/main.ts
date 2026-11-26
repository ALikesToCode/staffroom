import { checkItems, onDeviceAsk } from '../ai/check';
import { paragraphs } from '../ai/guard';
import { deviceStatus, prepareDevice } from '../ai/routes';
import { CASES, prepare, totals, type EvalRow } from './cases';

// A developer page, not part of the app. It runs the fixed cases through the same check the app runs
// (checkItems, on the ONLY_ON_DEVICE route) and shows what came back. Nothing is sent anywhere.

const status = document.getElementById('eval-status')!;
const table = document.getElementById('eval-rows')!;
const json = document.getElementById('eval-json')!;
const start = document.getElementById('eval-start') as HTMLButtonElement;

const runs = Math.max(1, Math.min(20, Number(new URLSearchParams(location.search).get('runs')) || 1));

function cell(row: HTMLTableRowElement, text: string, className = '') {
  const td = row.insertCell();
  td.textContent = text;
  if (className) td.className = className;
}

function show(rows: EvalRow[], done: boolean) {
  json.textContent = JSON.stringify(
    { done, at: new Date().toISOString(), userAgent: navigator.userAgent, runsPerCase: runs, totals: totals(rows), rows },
    null,
    2,
  );
}

async function run() {
  start.disabled = true;
  document.body.dataset.state = 'running';
  const rows: EvalRow[] = [];
  const ask = onDeviceAsk();
  let n = 0;
  for (let r = 1; r <= runs; r++) {
    for (const c of CASES) {
      status.textContent = `Run ${r} of ${runs}: case ${++n} of ${CASES.length * runs} (${c.id})`;
      const p = prepare(c);
      const began = performance.now();
      const row: EvalRow = { id: c.id, run: r, topic: c.topic, expected: c.expected, got: 'failed', reason: '', ms: 0 };
      try {
        const result = await checkItems([p.item], p.entities, paragraphs(p.note), p.tokens, ask);
        row.got = result.failed > 0 && result.answered === 0 ? 'failed' : result.checks[0].verdict;
        row.reason = result.checks[0].reason;
      } catch (e) {
        row.reason = e instanceof Error ? e.message : String(e);
      }
      row.ms = Math.round(performance.now() - began);
      rows.push(row);
      const right = (row.expected === 'conflict' && row.got === 'conflict') || (row.expected === 'compatible' && row.got === 'fits');
      const tr = (table as HTMLTableSectionElement).insertRow();
      cell(tr, String(r));
      cell(tr, c.id);
      cell(tr, c.fact);
      cell(tr, c.advice);
      cell(tr, row.expected);
      cell(tr, row.got, right ? 'right' : row.got === 'unsure' ? 'unsure' : 'wrong');
      cell(tr, row.reason);
      cell(tr, String(row.ms));
      show(rows, false);
    }
  }
  const t = totals(rows);
  status.textContent = `Done. Conflicts caught: ${t.conflictsCaught} of ${t.conflictCases} (unsure ${t.conflictsUnsure}, missed ${t.conflictsMissed}). Compatible wrongly flagged as conflict: ${t.compatibleFlaggedAsConflict} of ${t.compatibleCases} (unsure ${t.compatibleUnsure}). Failures: ${t.failures}. Median ${t.medianMs} ms a check.`;
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
