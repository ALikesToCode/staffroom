import type { Entity, ItemCheck, Kind, LabelWhere, Receipt, Source, TaskId, Where } from './types';

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
  labelWhere: LabelWhere;
  entities: Entity[];
  guardWhere: Where;
  unreadParagraphs: number;
  droppedDetails: number;
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

/** Build the receipt of a run. Counts and the approved text only: nothing from the vault. */
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
    labelWhere: run.labelWhere,
    guard: {
      where: run.guardWhere,
      found,
      bySource,
      allowedByTeacher: run.entities.filter((e) => !e.withheld).length,
      unreadParagraphs: run.unreadParagraphs,
      droppedDetails: run.droppedDetails,
    },
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

/**
 * The copy of a receipt that may be kept in the teacher's account in the
 * cloud. It is the record only: counts, times, where each step ran, and a
 * digest of the approved text. It holds no text at all: not the approved
 * text, not the model-written label, no name.
 */
export interface ReceiptRecord {
  id: string;
  createdAt: string;
  task: TaskId;
  /** How many items of each kind were withheld. */
  withheld: Record<Kind, number>;
  /** How many found items the teacher released. */
  released: number;
  approvedAt: string;
  approvedChars: number;
  /** SHA-256 of the approved text, in hex. Lets the teacher match this record to a local receipt. */
  approvedSha256: string;
  guardWhere: Where;
  draftWhere: Where;
  draftModel: string;
  checkWhere: Where;
  labelWhere: LabelWhere;
  verdicts: { fits: number; conflict: number; unsure: number; nothingWithheld: number; notChecked: number };
  kept: number;
  struck: number;
  flags: { replyFlagged: boolean; unreadParagraphs: number; droppedDetails: number };
}

/** SHA-256 of a text, as 64 hex characters. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reduce a receipt to the record that may leave the device. Every field is listed here by hand, so nothing else can ride along. */
export async function receiptRecord(r: Receipt): Promise<ReceiptRecord> {
  const f = r.guard.found;
  return {
    id: r.id,
    createdAt: r.createdAt,
    task: r.task,
    withheld: { student: f.student, adult: f.adult, place: f.place, contact: f.contact, id: f.id, private: f.private },
    released: r.guard.allowedByTeacher,
    approvedAt: r.sent.approvedAt,
    approvedChars: r.sent.text.length,
    approvedSha256: await sha256Hex(r.sent.text),
    guardWhere: r.guard.where,
    draftWhere: r.draft.where,
    // A model name from the app's settings, never model output. Bounded all the same.
    draftModel: r.draft.model.slice(0, 100),
    checkWhere: r.check.where,
    labelWhere: r.labelWhere ?? 'FALLBACK',
    verdicts: {
      fits: r.check.fits,
      conflict: r.check.conflict,
      unsure: r.check.unsure,
      nothingWithheld: r.check.nothingWithheld,
      notChecked: r.check.notChecked,
    },
    kept: r.signOff.kept,
    struck: r.signOff.struck,
    flags: {
      replyFlagged: r.check.replyGate === 'flagged',
      unreadParagraphs: r.guard.unreadParagraphs ?? 0,
      droppedDetails: r.guard.droppedDetails ?? 0,
    },
  };
}

const KIND_KEYS: Kind[] = ['student', 'adult', 'place', 'contact', 'id', 'private'];
const VERDICT_KEYS = ['fits', 'conflict', 'unsure', 'nothingWithheld', 'notChecked'] as const;

/**
 * Read back a record that was stored in the cloud. Returns undefined for
 * anything that is not a record in the present form (an entry written by
 * an earlier version, say), so nothing unexpected is ever shown. Only the
 * fields of a record are copied out.
 */
export function asReceiptRecord(data: unknown): ReceiptRecord | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.length <= 100;
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  const counts = <K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const m = v as Record<string, unknown>;
    if (!keys.every((k) => count(m[k]))) return undefined;
    return Object.fromEntries(keys.map((k) => [k, m[k] as number])) as Record<K, number>;
  };
  const withheld = counts(d.withheld, KIND_KEYS);
  const verdicts = counts(d.verdicts, VERDICT_KEYS);
  const flags = d.flags as Record<string, unknown> | null | undefined;
  const strings = [d.id, d.createdAt, d.task, d.approvedAt, d.approvedSha256, d.guardWhere, d.draftWhere, d.draftModel, d.checkWhere, d.labelWhere];
  if (!withheld || !verdicts || !flags || typeof flags !== 'object' || !strings.every(str)) return undefined;
  if (![d.released, d.approvedChars, d.kept, d.struck, flags.unreadParagraphs, flags.droppedDetails].every(count)) return undefined;
  if (typeof flags.replyFlagged !== 'boolean' || !['plan', 'parents', 'handover'].includes(d.task as string)) return undefined;
  return {
    id: d.id as string,
    createdAt: d.createdAt as string,
    task: d.task as TaskId,
    withheld,
    released: d.released as number,
    approvedAt: d.approvedAt as string,
    approvedChars: d.approvedChars as number,
    approvedSha256: d.approvedSha256 as string,
    guardWhere: d.guardWhere as Where,
    draftWhere: d.draftWhere as Where,
    draftModel: d.draftModel as string,
    checkWhere: d.checkWhere as Where,
    labelWhere: d.labelWhere as LabelWhere,
    verdicts,
    kept: d.kept as number,
    struck: d.struck as number,
    flags: {
      replyFlagged: flags.replyFlagged,
      unreadParagraphs: flags.unreadParagraphs as number,
      droppedDetails: flags.droppedDetails as number,
    },
  };
}
