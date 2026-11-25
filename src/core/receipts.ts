import type { Entity, ItemCheck, Kind, Receipt, Source, TaskId, Where } from './types';

const KEY = 'staffroom.receipts.v1';

export function loadReceipts(): Receipt[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Receipt[];
  } catch {
    return [];
  }
}

export function storeReceipts(receipts: Receipt[]): void {
  localStorage.setItem(KEY, JSON.stringify(receipts.slice(0, 50)));
}

interface Run {
  task: TaskId;
  label: string;
  entities: Entity[];
  guardWhere: Where;
  sentText: string;
  approvedAt: string;
  draftWhere: Where;
  draftModel: string;
  checkWhere: Where;
  replyFlagged: boolean;
  checks: ItemCheck[];
  kept: number;
  struck: number;
}

/** Build the audit record of a run. Counts and the sent text only: nothing from the vault. */
export function makeReceipt(run: Run): Receipt {
  const found = { student: 0, adult: 0, place: 0, contact: 0, id: 0, private: 0 } as Record<Kind, number>;
  const bySource = { 'class list': 0, rule: 0, 'on-device model': 0, teacher: 0 } as Record<Source, number>;
  for (const e of run.entities) {
    if (!e.withheld) continue;
    found[e.kind]++;
    bySource[e.source]++;
  }
  const count = (v: ItemCheck['verdict']) => run.checks.filter((c) => c.verdict === v).length;
  const now = new Date().toISOString();
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    task: run.task,
    label: run.label,
    guard: { where: run.guardWhere, found, bySource, allowedByTeacher: run.entities.filter((e) => !e.withheld).length },
    sent: { text: run.sentText, chars: run.sentText.length, approvedAt: run.approvedAt, gate: 'passed' },
    draft: { where: run.draftWhere, model: run.draftModel },
    check: {
      where: run.checkWhere,
      replyGate: run.replyFlagged ? 'flagged' : 'passed',
      fits: count('fits'),
      conflict: count('conflict'),
      unsure: count('unsure'),
      nothingWithheld: count('nothing withheld'),
      notChecked: count('not checked'),
    },
    signOff: { kept: run.kept, struck: run.struck, at: now },
  };
}
