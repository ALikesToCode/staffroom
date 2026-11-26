import { asVersion, BOARD_MAX, MATERIAL_LINE_MAX, SHEET_MAX, SHEET_MIN, TICKET_QUESTIONS, VERSION_ITEMS_MAX, type Materials, type StoredVersion } from './materials';
import type { Constraint, Draft, Entity, ItemCheck, Kind, TaskId, Where } from './types';
import type { Policy } from './policy';
import { KINDS } from './policy';
import { ALL_KINDS } from './constraints';
import { NEED_LINE_MAX, NEED_OUTCOMES, type NeedOutcome, type Variation } from './lessonNeeds';
import { SUGGESTION_MAX } from './recheck';
import { currentTicketKind } from './ticket';
import { ADJUSTMENT_MAX, FIELD_MAX, LANGUAGE_MAX, LAST_TIME_MAX, type AdjustmentSource, type LessonFields } from './lesson';

// A recorded run: one real run on the sample class, captured in Chrome with the on-device model, kept as a
// file beside the app. A browser without the on-device model can replay it, read-only. Nothing in a replay
// is computed by a model and nothing is sent.

/** The address of the file, beside the app. Until it exists, the app offers no replay. */
export const RECORDED_FILE = 'recorded-run.json';

/** A suggestion the on-device model made for one step of an item, as it was offered. Names are written out: it never left the device. */
export interface RecordedFit {
  itemIndex: number;
  /** Which step of the item, counted from 0. 0 when the whole item was fitted. */
  stepIndex: number;
  suggestion: string;
}

/** An item as it stood when the run was saved: the text that replaced the cloud's on the device, with stand-ins. */
export interface RecordedRewrite {
  itemIndex: number;
  text: string;
}

/** What one child does instead of a step of the lesson, as it stood when the run was saved. Names are written out: it never left the device. */
export interface RecordedAdjustment {
  itemIndex: number;
  /** The name of the stage, for a reader of the file. */
  stage?: string;
  /** The student it is for. */
  childId?: string;
  /** The constraint the step went against. Absent for a point that answers no rule. */
  constraintId?: string;
  /** The letter of the need the cloud wrote it for. */
  need?: string;
  text: string;
  source: RecordedSource;
}

/** A need of a lesson as it was sent: a letter and a line. */
export interface RecordedNeed {
  letter: string;
  line: string;
}

/** Who wrote an adjustment, as the file says it. */
export type RecordedSource = 'on-device model' | 'rule starter' | 'teacher' | 'cloud, for a need you approved';
export const RECORDED_SOURCE: Record<AdjustmentSource, RecordedSource> = { model: 'on-device model', starter: 'rule starter', teacher: 'teacher', cloud: 'cloud, for a need you approved' };
/** The same the other way, for a replay. */
export const sourceOf = (s: RecordedSource): AdjustmentSource => (s === 'on-device model' ? 'model' : s === 'rule starter' ? 'starter' : s === 'teacher' ? 'teacher' : 'cloud');

/** The most characters of a rewritten item that a recorded run holds. */
const REWRITE_MAX = 4000;

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
  /** The items the teacher had rewritten when the run was saved, a suggestion saved as it was or changed. Absent: none. */
  rewrites?: RecordedRewrite[];
  /** The suggestions the on-device model made before the run was saved. Shown read-only in a replay. Absent: none. */
  fits?: RecordedFit[];
  /** For a lesson: the lines about it that were sent. Absent for the other tasks. */
  lesson?: LessonFields;
  /** For a lesson: the adjustments that were accepted when the run was saved. Shown read-only in a replay. Absent: none. */
  adjustments?: RecordedAdjustment[];
  /** For a lesson: the needs the cloud was told, by letter. Absent: none. */
  needs?: RecordedNeed[];
  /** For a lesson: which students have each need, by letter. It was never sent: the file is of the invented class, and a replay shows the device's side. */
  needChildren?: Record<string, string[]>;
  /** For a lesson: the lines the cloud wrote for needs, taken out of the stages. Absent: none. */
  variations?: Variation[];
  /** For a lesson: what came of every need that was told, by letter. Absent in a file recorded before it was kept. */
  needOutcomes?: Record<string, NeedOutcome>;
  /** For a lesson: the materials the cloud wrote from the signed plan and the needs by letter. Letters only: no name is in them. Absent: none were made. */
  materials?: RecordedMaterials;
}

/** The materials as the file holds them. `same` and `missing` are absent in a file recorded before they were kept. */
export type RecordedMaterials = Pick<Materials, 'board' | 'sheet' | 'versions' | 'ticket'> & Partial<Pick<Materials, 'same' | 'missing'>>;

const WHERES: Where[] = ['ON_DEVICE', 'IN_CLOUD', 'RULES_ONLY', 'NOT_RUN', 'SKIPPED'];
const VERDICTS: ItemCheck['verdict'][] = ['fits', 'conflict', 'unsure', 'nothing withheld', 'not checked'];
const SOURCES = ['class list', 'rule', 'on-device model', 'teacher'];
const TASK_IDS: TaskId[] = ['lesson', 'plan', 'parents', 'handover'];

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
  ALL_KINDS.includes(v.kind as Constraint['kind']) &&
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
  optional(v.learn, str) &&
  optional(v.needAck, (b) => typeof b === 'boolean') &&
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

/** A list with one entry at most for each item of the draft, each pointing at an item that exists. */
const perItem = <T extends { itemIndex: number }>(v: unknown, count: number, each: (x: Record<string, unknown>) => boolean): v is T[] =>
  Array.isArray(v) &&
  v.every((x) => obj(x) && num(x.itemIndex) && x.itemIndex < count && each(x)) &&
  new Set(v.map((x: { itemIndex: number }) => x.itemIndex)).size === v.length;

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
  const count = draft.items.length;
  const rewrites = d.rewrites;
  if (rewrites !== undefined && !perItem<RecordedRewrite>(rewrites, count, (x) => str(x.text) && x.text.trim().length > 0 && x.text.length <= REWRITE_MAX)) return undefined;
  const fits = d.fits;
  if (
    fits !== undefined &&
    !perItem<RecordedFit>(fits, count, (x) => num(x.stepIndex) && str(x.suggestion) && x.suggestion.trim().length > 0 && x.suggestion.length <= SUGGESTION_MAX)
  ) {
    return undefined;
  }
  const lesson = d.lesson;
  const short = (v: unknown, max: number) => str(v) && v.length <= max;
  if (
    lesson !== undefined &&
    !(obj(lesson) && short(lesson.klass, FIELD_MAX) && short(lesson.subject, FIELD_MAX) && short(lesson.topic, FIELD_MAX) && short(lesson.lastTime, LAST_TIME_MAX) && optional(lesson.language, (v): v is string => short(v, LANGUAGE_MAX)) && num(lesson.minutes) && lesson.minutes >= 5 && lesson.minutes <= 240)
  ) {
    return undefined;
  }
  // The lines belong to a lesson and to nothing else; a lesson has them.
  if ((d.task === 'lesson') !== (lesson !== undefined)) return undefined;
  const adjustments = d.adjustments;
  if (adjustments !== undefined) {
    const ids = new Set(d.constraints.map((c) => c.id));
    const students = new Set(d.entities.filter((e) => e.kind === 'student').map((e) => e.id));
    const fine =
      d.task === 'lesson' &&
      Array.isArray(adjustments) &&
      adjustments.every(
        (a) =>
          obj(a) && num(a.itemIndex) && a.itemIndex < count &&
          optional(a.constraintId, (x) => str(x) && ids.has(x)) &&
          optional(a.childId, (x) => str(x) && students.has(x)) &&
          // It answers a constraint or is for a child: an entry that is neither belongs to nothing.
          (a.constraintId !== undefined || a.childId !== undefined) &&
          optional(a.stage, (x) => str(x) && x.length <= FIELD_MAX) &&
          optional(a.need, (x) => str(x) && /^[A-Z]{1,2}\d*$/.test(x)) &&
          str(a.text) && a.text.trim().length > 0 && a.text.length <= ADJUSTMENT_MAX && Object.values(RECORDED_SOURCE).includes(a.source as RecordedSource),
      );
    if (!fine) return undefined;
  }
  // The needs, whose they are, and what the cloud wrote for them: all three belong to a lesson, and hang together.
  const letter = (x: unknown): x is string => str(x) && /^[A-Z]{1,2}\d*$/.test(x);
  const needs = d.needs;
  if (needs !== undefined && !(d.task === 'lesson' && list(needs, (n): n is RecordedNeed => obj(n) && letter(n.letter) && str(n.line) && n.line.trim().length > 0 && n.line.length <= NEED_LINE_MAX))) return undefined;
  const letters = new Set((needs as RecordedNeed[] | undefined)?.map((n) => n.letter) ?? []);
  if (needs !== undefined && letters.size !== (needs as RecordedNeed[]).length) return undefined;
  const needChildren = d.needChildren;
  if (needChildren !== undefined) {
    const students = new Set(d.entities.filter((e) => e.kind === 'student').map((e) => e.id));
    if (!obj(needChildren) || !Object.entries(needChildren).every(([k, v]) => letters.has(k) && list(v, str) && v.every((id) => students.has(id)))) return undefined;
  }
  const variations = d.variations;
  if (
    variations !== undefined &&
    !list(variations, (v): v is Variation => obj(v) && num(v.itemIndex) && v.itemIndex < count && letter(v.need) && letters.has(v.need) && str(v.text) && v.text.trim().length > 0 && v.text.length <= 1000)
  ) {
    return undefined;
  }
  // Every need told has one outcome, and a need has an entry for a stage exactly when there are lines for it.
  const needOutcomes = d.needOutcomes;
  if (needOutcomes !== undefined) {
    const lines = new Set((variations as Variation[] | undefined)?.map((v) => v.need) ?? []);
    const whole =
      obj(needOutcomes) &&
      Object.keys(needOutcomes).length === letters.size &&
      [...letters].every((l) => NEED_OUTCOMES.includes(needOutcomes[l] as NeedOutcome) && (needOutcomes[l] === 'for a stage') === lines.has(l));
    if (!whole) return undefined;
  }
  const materials = d.materials;
  if (materials !== undefined) {
    const line = (v: unknown): v is string => str(v) && v.trim().length > 0 && v.length <= MATERIAL_LINE_MAX;
    const whole =
      d.task === 'lesson' &&
      obj(materials) &&
      list(materials.board, line) && materials.board.length >= 1 && materials.board.length <= BOARD_MAX &&
      list(materials.sheet, line) && materials.sheet.length >= SHEET_MIN && materials.sheet.length <= SHEET_MAX &&
      // A version is a sheet with its lines, or, in a file recorded before the lines were asked for, one text.
      list(
        materials.versions,
        (v): v is StoredVersion =>
          obj(v) && letter(v.need) && letters.has(v.need) &&
          ((str(v.note) && v.note.length <= MATERIAL_LINE_MAX && list(v.items, line) && v.items.length >= 1 && v.items.length <= VERSION_ITEMS_MAX && v.text === undefined) ||
            (line(v.text) && v.note === undefined && v.items === undefined)),
      ) &&
      new Set(materials.versions.map((v) => v.need)).size === materials.versions.length &&
      list(materials.ticket, (t): t is { question: string; answer: string } => obj(t) && line(t.question) && line(t.answer)) && materials.ticket.length === TICKET_QUESTIONS;
    if (!whole) return undefined;
    // The needs the class sheet suits and the needs with no sheet: told letters, each in one place only.
    const m = materials as Record<string, unknown>;
    const sheets = (m.versions as StoredVersion[]).map((v) => v.need);
    const same = m.same;
    const missing = m.missing;
    const told = (v: unknown): v is string[] => list(v, letter) && v.every((l) => letters.has(l));
    if (same !== undefined && !told(same)) return undefined;
    if (missing !== undefined && !told(missing)) return undefined;
    const all = [...sheets, ...((same as string[] | undefined) ?? []), ...((missing as string[] | undefined) ?? [])];
    if (new Set(all).size !== all.length) return undefined;
  }
  return {
    recordedAt: d.recordedAt,
    chrome: d.chrome,
    task: d.task as TaskId,
    note: d.note,
    classList: d.classList,
    entities: d.entities,
    constraints: d.constraints.map(currentTicketKind),
    outgoing: d.outgoing,
    policy: { cloudModel: policy.cloudModel, lockedKinds: policy.lockedKinds, origin: policy.origin as Policy['origin'], from: policy.from },
    draft: { title: draft.title, items: draft.items.map((i) => ({ heading: i.heading, text: i.text })) },
    checks: d.checks,
    where: { guard: where.guard as Where, draft: where.draft as Where, check: where.check as Where },
    draftModel: d.draftModel,
    ...(rewrites ? { rewrites: rewrites.map((r) => ({ itemIndex: r.itemIndex, text: r.text })) } : {}),
    ...(fits ? { fits: fits.map((f) => ({ itemIndex: f.itemIndex, stepIndex: f.stepIndex, suggestion: f.suggestion })) } : {}),
    ...(obj(lesson)
      ? { lesson: { klass: lesson.klass as string, subject: lesson.subject as string, topic: lesson.topic as string, minutes: lesson.minutes as number, lastTime: lesson.lastTime as string, ...(typeof lesson.language === 'string' && lesson.language ? { language: lesson.language } : {}) } }
      : {}),
    ...(adjustments
      ? {
          adjustments: (adjustments as RecordedAdjustment[]).map((a) => ({
            itemIndex: a.itemIndex,
            ...(a.stage !== undefined ? { stage: a.stage } : {}),
            ...(a.childId !== undefined ? { childId: a.childId } : {}),
            ...(a.constraintId !== undefined ? { constraintId: a.constraintId } : {}),
            ...(a.need !== undefined ? { need: a.need } : {}),
            text: a.text,
            source: a.source,
          })),
        }
      : {}),
    ...(needs ? { needs: (needs as RecordedNeed[]).map((n) => ({ letter: n.letter, line: n.line })) } : {}),
    ...(needChildren ? { needChildren: Object.fromEntries(Object.entries(needChildren as Record<string, string[]>).map(([k, v]) => [k, [...v]])) } : {}),
    ...(variations ? { variations: (variations as Variation[]).map((v) => ({ itemIndex: v.itemIndex, need: v.need, text: v.text })) } : {}),
    ...(needOutcomes ? { needOutcomes: { ...(needOutcomes as Record<string, NeedOutcome>) } } : {}),
    ...(materials
      ? (() => {
          const m = materials as Omit<RecordedMaterials, 'versions'> & { versions: StoredVersion[] };
          return {
            materials: {
              board: [...m.board],
              sheet: [...m.sheet],
              versions: m.versions.map(asVersion),
              ticket: m.ticket.map((t) => ({ question: t.question, answer: t.answer })),
              ...(m.same ? { same: [...m.same] } : {}),
              ...(m.missing ? { missing: [...m.missing] } : {}),
            },
          };
        })()
      : {}),
  };
}

/** How the browser names itself, shortened to "Chrome 142.0.0.0" when it is Chrome. */
export function browserName(userAgent: string): string {
  const m = /Chrome\/([\d.]+)/.exec(userAgent);
  return m ? `Chrome ${m[1]}` : userAgent.slice(0, 120);
}

/**
 * Put a live run into the form of the file. The caller downloads it.
 * `draft` and `checks` are the reply and the verdicts as they first came;
 * `rewrites` and `fits` are what stood on the result screen at that moment.
 * An empty list of either is left out.
 */
export function captureRun(run: Omit<RecordedRun, 'recordedAt' | 'chrome'>, now: Date, userAgent: string): RecordedRun {
  const { rewrites, fits, adjustments, needs, needChildren, variations, needOutcomes, materials, ...rest } = run;
  return {
    recordedAt: now.toISOString(),
    chrome: browserName(userAgent),
    ...rest,
    ...(rewrites && rewrites.length > 0 ? { rewrites } : {}),
    ...(fits && fits.length > 0 ? { fits } : {}),
    ...(adjustments && adjustments.length > 0 ? { adjustments } : {}),
    ...(needs && needs.length > 0 ? { needs, ...(needChildren ? { needChildren } : {}), ...(needOutcomes ? { needOutcomes } : {}) } : {}),
    ...(variations && variations.length > 0 ? { variations } : {}),
    ...(materials
      ? {
          materials: {
            board: materials.board,
            sheet: materials.sheet,
            versions: materials.versions.map((v) => ({ need: v.need, note: v.note, items: v.items })),
            ticket: materials.ticket,
            same: materials.same ?? [],
            missing: materials.missing ?? [],
          },
        }
      : {}),
  };
}

/** Said over a suggestion shown in a replay. */
export const RECORDED_FIT_LABEL = 'Suggested on this device in the recorded run';

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
