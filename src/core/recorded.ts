import type { Constraint, Draft, Entity, ItemCheck, Kind, TaskId, Where } from './types';
import type { Policy } from './policy';
import { KINDS } from './policy';
import { CONSTRAINT_KINDS } from './constraints';

// A recorded run: one real run on the sample class, captured in Chrome with the on-device model, kept as a
// file beside the app. A browser without the on-device model can replay it, read-only. Nothing in a replay
// is computed by a model and nothing is sent.

/** The address of the file, beside the app. Until it exists, the app offers no replay. */
export const RECORDED_FILE = 'recorded-run.json';

export interface RecordedRun {
  /** When the run was made, ISO-8601. */
  recordedAt: string;
  /** The browser it was made in, as it names itself ("Chrome 142.0.0.0"). */
  chrome: string;
  task: TaskId;
  note: string;
  classList: string[];
  /** The vault as it stood at approval. */
  entities: Entity[];
  constraints: Constraint[];
  /** The exact text that was approved and sent. */
  outgoing: string;
  policy: Policy;
  /** The draft as it came back, with stand-ins. */
  draft: Draft;
  /** The verdict for each item of the draft, in order. */
  checks: ItemCheck[];
  where: { guard: Where; draft: Where; check: Where };
  draftModel: string;
}

const WHERES: Where[] = ['ON_DEVICE', 'IN_CLOUD', 'RULES_ONLY', 'NOT_RUN', 'SKIPPED'];
const VERDICTS: ItemCheck['verdict'][] = ['fits', 'conflict', 'unsure', 'nothing withheld', 'not checked'];
const SOURCES = ['class list', 'rule', 'on-device model', 'teacher'];
const TASK_IDS: TaskId[] = ['plan', 'parents', 'handover'];

const str = (v: unknown): v is string => typeof v === 'string';
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T>(v: unknown, each: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(each);
const optional = (v: unknown, is: (x: unknown) => boolean) => v === undefined || is(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

const isEntity = (v: unknown): v is Entity =>
  obj(v) &&
  str(v.id) &&
  KINDS.includes(v.kind as Kind) &&
  str(v.token) &&
  list(v.surfaces, str) &&
  v.surfaces.length > 0 &&
  SOURCES.includes(v.source as string) &&
  typeof v.withheld === 'boolean' &&
  optional(v.at, num) &&
  optional(v.about, str) &&
  optional(v.category, str) &&
  optional(v.span, (s) => obj(s) && num(s.start) && num(s.end));

const isConstraint = (v: unknown): v is Constraint =>
  obj(v) &&
  str(v.id) &&
  CONSTRAINT_KINDS.includes(v.kind as Constraint['kind']) &&
  str(v.text) &&
  ['rule', 'on-device model', 'teacher'].includes(v.source as string) &&
  typeof v.confirmed === 'boolean' &&
  optional(v.about, str) &&
  optional(v.at, num) &&
  optional(v.detailId, str) &&
  optional(v.days, (d) => list(d, str)) &&
  optional(v.triggers, (d) => list(d, str)) &&
  optional(v.who, str) &&
  optional(v.guardian, str) &&
  optional(v.need, str) &&
  optional(v.share, (b) => typeof b === 'boolean');

const isCheck = (v: unknown): v is ItemCheck =>
  obj(v) &&
  VERDICTS.includes(v.verdict as ItemCheck['verdict']) &&
  str(v.reason) &&
  optional(v.by, (b) => ['rule', 'model', 'both', 'none'].includes(b as string)) &&
  optional(v.constraintId, str) &&
  optional(v.matched, str) &&
  optional(v.cloudSaw, str) &&
  optional(v.told, str) &&
  optional(v.also, str) &&
  optional(v.rules, num);

const isItem = (v: unknown): v is { heading: string; text: string } => obj(v) && str(v.heading) && str(v.text);

/**
 * Read a recorded run from the file. Returns undefined for anything that
 * is not one in the present form, so a broken or half-written file offers
 * no replay at all. Only the fields of a recorded run are copied out.
 */
export function asRecordedRun(data: unknown): RecordedRun | undefined {
  if (!obj(data)) return undefined;
  const d = data;
  if (!str(d.recordedAt) || Number.isNaN(Date.parse(d.recordedAt)) || !str(d.chrome) || !str(d.note) || !str(d.outgoing) || !str(d.draftModel)) return undefined;
  if (!TASK_IDS.includes(d.task as TaskId)) return undefined;
  if (!list(d.classList, str) || !list(d.entities, isEntity) || !list(d.constraints, isConstraint) || !list(d.checks, isCheck)) return undefined;
  const policy = d.policy;
  if (!obj(policy) || !str(policy.cloudModel) || !str(policy.from) || !list(policy.lockedKinds, (k): k is Kind => KINDS.includes(k as Kind))) return undefined;
  if (!['remote', 'saved', 'defaults'].includes(policy.origin as string)) return undefined;
  const draft = d.draft;
  if (!obj(draft) || !str(draft.title) || !list(draft.items, isItem) || draft.items.length === 0) return undefined;
  // One verdict for each item, or the file does not describe one run.
  if (d.checks.length !== draft.items.length) return undefined;
  const where = d.where;
  if (!obj(where) || ![where.guard, where.draft, where.check].every((w) => WHERES.includes(w as Where))) return undefined;
  return {
    recordedAt: d.recordedAt,
    chrome: d.chrome,
    task: d.task as TaskId,
    note: d.note,
    classList: d.classList,
    entities: d.entities,
    constraints: d.constraints,
    outgoing: d.outgoing,
    policy: { cloudModel: policy.cloudModel, lockedKinds: policy.lockedKinds, origin: policy.origin as Policy['origin'], from: policy.from },
    draft: { title: draft.title, items: draft.items.map((i) => ({ heading: i.heading, text: i.text })) },
    checks: d.checks,
    where: { guard: where.guard as Where, draft: where.draft as Where, check: where.check as Where },
    draftModel: d.draftModel,
  };
}

/** How the browser names itself, shortened to "Chrome 142.0.0.0" when it is Chrome. */
export function browserName(userAgent: string): string {
  const m = /Chrome\/([\d.]+)/.exec(userAgent);
  return m ? `Chrome ${m[1]}` : userAgent.slice(0, 120);
}

/** Put a live run into the form of the file. The caller downloads it. */
export function captureRun(run: Omit<RecordedRun, 'recordedAt' | 'chrome'>, now: Date, userAgent: string): RecordedRun {
  return { recordedAt: now.toISOString(), chrome: browserName(userAgent), ...run };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The line shown for as long as a replay is on screen. */
export function replayBanner(run: Pick<RecordedRun, 'recordedAt'>): string {
  const at = new Date(run.recordedAt);
  const date = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
  return `Recorded run. This is a replay of a real run on ${date} in Chrome with the on-device model. Nothing is being sent now.`;
}

/** The steps of a replay: the screens of a live run, without the waits. */
export const REPLAY_STAGES = ['write', 'review', 'result', 'signed'] as const;
export type ReplayStage = (typeof REPLAY_STAGES)[number];

/** The screen after this one, or the same one at the end. */
export function replayNext(stage: ReplayStage): ReplayStage {
  return REPLAY_STAGES[Math.min(REPLAY_STAGES.indexOf(stage) + 1, REPLAY_STAGES.length - 1)];
}
