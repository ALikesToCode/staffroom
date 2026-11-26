import type { ConstraintKind, Entity, ItemCheck, Kind, LabelWhere, Receipt, Source, TaskId, Where } from './types';
import { layerCounts } from './conflicts';

const KEY = 'staffroom.receipts.v1';

export function loadReceipts(): Receipt[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Receipt[];
  } catch {
    return [];
  }
}

/** Keep the receipts in this browser. Returns false when the browser would not store them (full, or switched off). */
export function storeReceipts(receipts: Receipt[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(receipts.slice(0, 50)));
    return true;
  } catch {
    return false;
  }
}

const SHORT_TASK: Record<TaskId, string> = { lesson: 'Lesson', plan: 'Support plan', parents: 'Notes to parents', handover: 'Hand-over' };
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The title a receipt has before a model has named it, and keeps if none
 * does: the task and the day, as in "Support plan · 26 Nov 2026". Made
 * from nothing in the note.
 */
export function plainTitle(task: TaskId, at: Date): string {
  return `${SHORT_TASK[task]} \u00B7 ${at.getDate()} ${SHORT_MONTH[at.getMonth()]} ${at.getFullYear()}`;
}

/** The name the app gives the on-device model. */
export const ON_DEVICE_MODEL = 'Gemini Nano (Chrome built-in)';

/** The model names a record may carry, exactly as the Firestore rules list them. Anything else is written as "other". */
export const RECORD_MODELS = [
  ON_DEVICE_MODEL,
  'other',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-pro',
  'gemini-3-flash',
  'gemini-3-flash-lite',
] as const;

/**
 * A model name in the form the cloud record accepts: one from the exact
 * list the Firestore rules hold, or the word "other". The field cannot be
 * used to carry text.
 */
export function recordModelName(name: string): string {
  return (RECORD_MODELS as readonly string[]).includes(name) ? name : 'other';
}

/** The form of a receipt id: the time in base 36, a hyphen, six characters. The Firestore rules accept only this form. */
export const RECEIPT_ID = /^[0-9a-z]{8,9}-[0-9a-z]{6}$/;

/** A new receipt id. */
export function newReceiptId(now = Date.now(), random = Math.random()): string {
  return `${now.toString(36)}-${random.toString(36).slice(2, 8).padEnd(6, '0')}`;
}

/**
 * The last six characters of a receipt's id, shown as its "record id". A
 * receipt in this browser and its record in the account have the same id,
 * and that is the whole of how they are paired.
 */
export function recordIdTail(id: string): string {
  return id.slice(-6);
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
  /** When the device wrote the draft because the cloud draft failed: what the browser reported about the network at approval. */
  cloudFailedWhile?: 'online' | 'offline';
  checkWhere: Where;
  /** Requests the check made to the on-device model, and how many failed. */
  checkRequests?: { asked: number; failed: number };
  replyFlagged: boolean;
  checks: ItemCheck[];
  /** Counts of the confirmed constraints. The constraints themselves are never given to a receipt. */
  constraints?: { confirmed: number; byKind: Partial<Record<ConstraintKind, number>>; shared?: number };
  kept: number;
  struck: number;
  /** Kept items whose text the teacher rewrote on the device. */
  rewritten?: number;
  /** Kept items whose rewrite began as a suggestion of the on-device model. A count: no words of any suggestion. */
  fittedOnDevice?: number;
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
    id: newReceiptId(),
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
    draft: {
      where: run.draftWhere,
      model: run.draftModel,
      ...(run.cloudFailedWhile ? { cloud: 'failed' as const, browser: run.cloudFailedWhile } : {}),
    },
    check: {
      where: run.checkWhere,
      replyGate: run.replyFlagged ? 'flagged' : 'passed',
      fits: count('fits'),
      conflict: count('conflict'),
      unsure: count('unsure'),
      nothingWithheld: count('nothing withheld'),
      notChecked: count('not checked'),
      ...(run.checkRequests ? { requests: run.checkRequests.asked, failedRequests: run.checkRequests.failed } : {}),
      ...layerCounts(run.checks),
    },
    constraints: run.constraints ?? { confirmed: 0, byKind: {} },
    signOff: { kept: run.kept, struck: run.struck, at: now, ...(run.rewritten ? { rewritten: run.rewritten } : {}), ...(run.fittedOnDevice ? { fittedOnDevice: run.fittedOnDevice } : {}) },
  };
}

/** Where the draft was written, in words. The failure and the network state are two facts and are said apart. */
export function draftLine(draft: Receipt['draft']): string {
  if (draft.where === 'IN_CLOUD') return `${draft.model}, in the cloud`;
  const browser = draft.browser ? ` Browser reported: ${draft.browser}.` : '';
  return `${draft.model}, on the device. The cloud draft failed, so the on-device model wrote it.${browser}`;
}

/**
 * The copy of a receipt that may be kept in the teacher's account in the
 * cloud. It is a record written by this browser: the teacher's own note of
 * a run, not evidence of it to anyone else, since whoever holds the account
 * can write one. It is the record only: counts, times and where each step ran.
 * It holds no text at all, and nothing worked out from the text but its
 * length: not the approved text, not the model-written label, no name. It is
 * paired with the receipt in this browser by the id the two share.
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
  guardWhere: Where;
  draftWhere: Where;
  draftModel: string;
  checkWhere: Where;
  labelWhere: LabelWhere;
  verdicts: { fits: number; conflict: number; unsure: number; nothingWithheld: number; notChecked: number };
  kept: number;
  struck: number;
  flags: { replyFlagged: boolean; unreadParagraphs: number; droppedDetails: number };
  /** Items a rule found in conflict with a confirmed constraint. */
  conflictsByRule: number;
  /** Items only the on-device model doubted. */
  doubtsByModel: number;
  /** How many constraints the teacher had confirmed. A count: no kind, no words. */
  constraintsConfirmed: number;
  /** How many needs were told to the cloud, without their reasons. */
  needsShared: number;
}

/** Reduce a receipt to the record that may leave the device. Every field is listed here by hand, so nothing else can ride along. */
export function receiptRecord(r: Receipt): ReceiptRecord {
  const f = r.guard.found;
  return {
    id: r.id,
    createdAt: r.createdAt,
    task: r.task,
    withheld: { student: f.student, adult: f.adult, place: f.place, contact: f.contact, id: f.id, private: f.private },
    released: r.guard.allowedByTeacher,
    approvedAt: r.sent.approvedAt,
    approvedChars: r.sent.text.length,
    guardWhere: r.guard.where,
    draftWhere: r.draft.where,
    // A model name from the app's settings, never model output. Reduced to the form the rules accept all the same.
    draftModel: recordModelName(r.draft.model),
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
    conflictsByRule: r.check.conflictsByRule ?? 0,
    doubtsByModel: r.check.doubtsByModel ?? 0,
    constraintsConfirmed: r.constraints?.confirmed ?? 0,
    needsShared: r.constraints?.shared ?? 0,
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
  const strings = [d.id, d.createdAt, d.task, d.approvedAt, d.guardWhere, d.draftWhere, d.draftModel, d.checkWhere, d.labelWhere];
  if (!withheld || !verdicts || !flags || typeof flags !== 'object' || !strings.every(str)) return undefined;
  if (![d.released, d.approvedChars, d.kept, d.struck, flags.unreadParagraphs, flags.droppedDetails].every(count)) return undefined;
  // A record written before these counts were kept does not have them: they read as 0.
  const later = [d.conflictsByRule, d.doubtsByModel, d.constraintsConfirmed, d.needsShared].map((v) => (v === undefined ? 0 : v));
  if (!later.every(count)) return undefined;
  // The same forms the Firestore rules insist on.
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  if (!iso.test(d.createdAt as string) || !iso.test(d.approvedAt as string)) return undefined;
  if (recordModelName(d.draftModel as string) !== d.draftModel) return undefined;
  if (!RECEIPT_ID.test(d.id as string)) return undefined;
  if (typeof flags.replyFlagged !== 'boolean' || !['plan', 'parents', 'handover'].includes(d.task as string)) return undefined;
  return {
    id: d.id as string,
    createdAt: d.createdAt as string,
    task: d.task as TaskId,
    withheld,
    released: d.released as number,
    approvedAt: d.approvedAt as string,
    approvedChars: d.approvedChars as number,
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
    conflictsByRule: later[0] as number,
    doubtsByModel: later[1] as number,
    constraintsConfirmed: later[2] as number,
    needsShared: later[3] as number,
  };
}
