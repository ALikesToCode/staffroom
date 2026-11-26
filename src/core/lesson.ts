import type { Constraint, ConstraintKind, Draft, DraftItem, Entity } from './types';
import type { Violation } from './gate';
import { afterBellActivities, nameInNote, ruleConflicts, ruleHitsForItem, type RuleHit } from './conflicts';
import { findByRule, findSensitive, listedParts, wholeWordMatcher } from './rules';
import { BARE_RE, LOOKALIKE_RE } from './vault';

// Tomorrow's lesson. The cloud plans the lesson for the class from what is not private: the class, the
// subject, the topic, the length. The device then reads each step against what the teacher confirmed about
// each child, and keeps an adjustment for the child a step does not suit. Plain code: no model here.

/** What the teacher says about the lesson. None of it is private: it is sent, under the heading "Lesson". */
export interface LessonFields {
  klass: string;
  subject: string;
  topic: string;
  minutes: number;
  /** What was done last time. Filled from a saved lesson, or typed. */
  lastTime: string;
}

export const NO_LESSON: LessonFields = { klass: '', subject: '', topic: '', minutes: 40, lastTime: '' };
export const LESSON_HEADING = 'Lesson';
export const FIELD_MAX = 120;
export const LAST_TIME_MAX = 600;

const one = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** The length of a lesson in whole minutes, 5 to 240. Anything else is 40. */
export const lessonMinutes = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 5 && n <= 240 ? Math.round(n) : 40);

/** True when the lesson can be planned: it has a subject and a topic. */
export const lessonReady = (f: LessonFields) => one(f.subject, FIELD_MAX) !== '' && one(f.topic, FIELD_MAX) !== '';

/** The lines sent about the lesson, exactly as they are appended to the outgoing text. */
export function lessonBlock(f: LessonFields): string {
  const lines = [LESSON_HEADING];
  if (one(f.klass, FIELD_MAX)) lines.push(`Class: ${one(f.klass, FIELD_MAX)}`);
  lines.push(`Subject: ${one(f.subject, FIELD_MAX)}`, `Topic: ${one(f.topic, FIELD_MAX)}`, `Length: ${lessonMinutes(f.minutes)} minutes`);
  if (one(f.lastTime, LAST_TIME_MAX)) lines.push(`What we did last time: ${one(f.lastTime, LAST_TIME_MAX)}`);
  return lines.join('\n');
}

/** The outgoing text with the lesson under it. */
export const withLesson = (text: string, f: LessonFields) => `${text.trimEnd()}\n\n${lessonBlock(f)}`;

/**
 * What stops the lesson lines from being sent. They are not redacted: they
 * are meant to hold nothing private, so anything the rules find in them
 * blocks the send until the teacher takes it out. Found by rule only: a
 * name on the class list, the name or words of anything in the vault that
 * is withheld, a phone number, an email address, an identity number,
 * something that looks like a stand-in, and, in the line about last time
 * only, a sentence with a word from the sensitive list.
 */
export function lessonIssues(f: LessonFields, entities: Entity[], classList: readonly string[]): Violation[] {
  const text = lessonBlock(f);
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (what: string, why: string) => {
    if (seen.has(what.toLowerCase())) return;
    seen.add(what.toLowerCase());
    out.push({ what, why });
  };
  const names = [
    ...classList.flatMap((n) => [n, ...listedParts(n)]),
    ...entities.filter((e) => e.kind !== 'private' && e.withheld).flatMap((e) => e.surfaces),
  ];
  for (const m of text.matchAll(new RegExp(wholeWordMatcher(names)?.source ?? '(?!)', 'giu'))) add(m[0], 'a name in the lesson lines, which are sent as written');
  for (const e of entities.filter((x) => x.kind === 'private' && x.withheld)) {
    const m = wholeWordMatcher(e.surfaces)?.exec(text);
    if (m) add(m[0], 'a withheld private detail in the lesson lines');
  }
  for (const hit of findByRule(text)) add(hit.text, 'a contact detail or an identity number in the lesson lines');
  // A topic may well be "Health and disease". Only the free line about last time is read for sensitive words.
  for (const hit of findSensitive(one(f.lastTime, LAST_TIME_MAX))) add(hit.text, 'a sensitive word in what you say was done last time, which is sent as written');
  for (const m of [...text.matchAll(LOOKALIKE_RE), ...text.matchAll(BARE_RE)]) add(m[0], 'something that looks like a stand-in in the lesson lines');
  return out;
}

// ---------------------------------------------------------------- the check: a step for the class against each child

/** One step of the lesson that does not suit one child, by rule. */
export interface LessonHit {
  /** Stable for a draft: the item, the step and the constraint. */
  key: string;
  itemIndex: number;
  /** -1: the heading of the stage. */
  stepIndex: number;
  step: string;
  constraintId: string;
  /** The child's name as the note has it, or "The class" for a constraint about everyone. */
  child: string;
  matched: string;
  verdict: RuleHit['verdict'];
  /** The child, what the step asks, what was confirmed, and whether the cloud was told. */
  line: string;
}

export const THE_CLASS = 'The class';

/** Every (step, child, constraint) hit in the lesson, in the lesson's order. */
export function lessonHits(
  items: DraftItem[],
  constraints: Constraint[],
  entities: Entity[],
  allowed: readonly string[],
  note: string,
  told: ReadonlyMap<string, string> = new Map(),
): LessonHit[] {
  return items.flatMap((item, itemIndex) =>
    ruleHitsForItem(item, constraints, entities, allowed, note, told).map(({ stepIndex, step, constraint, hit }) => {
      const student = entities.find((e) => e.id === constraint.about);
      const child = student ? nameInNote(note, student) : THE_CLASS;
      return {
        key: `${itemIndex}:${stepIndex}:${constraint.id}`,
        itemIndex,
        stepIndex,
        step,
        constraintId: constraint.id,
        child,
        matched: hit.matched,
        verdict: hit.verdict,
        line: `${child}: ${hit.reason}`,
      };
    }),
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The marker on a stage that needs fitting. */
export function needsFitting(hits: readonly LessonHit[]): string {
  const children = new Set(hits.map((h) => h.child)).size;
  return `Needs fitting for ${count(children, 'child', 'children')}`;
}

/** The line over the lesson: how many stages need fitting, for how many children, and how many suit everyone. */
export function lessonSummary(hits: readonly LessonHit[], stages: number, constraintsCompared: number): string {
  if (constraintsCompared === 0) return 'You confirmed no constraint, so no rule compared the lesson with any child.';
  const fit = new Set(hits.map((h) => h.itemIndex)).size;
  const children = new Set(hits.map((h) => h.child)).size;
  const rest = stages - fit;
  const out: string[] = [];
  if (fit > 0) out.push(`${count(fit, 'step needs', 'steps need')} fitting for ${count(children, 'child', 'children')}.`);
  if (rest > 0) out.push(`${count(rest, 'step suits', 'steps suit')} everyone, by rule.`);
  return out.join(' ');
}

// ---------------------------------------------------------------- the fit: an adjustment for one child

export type AdjustmentSource = 'model' | 'starter' | 'teacher';

/** Said over a starter. */
export const STARTER_LABEL = 'Starter wording, by rule';

/**
 * Words to start from when no model is here: one sentence for each kind of
 * constraint, for the teacher to change or accept. `other` has none, and
 * for health it is a pointer to the care plan, never a medical instruction.
 */
export function starterFor(c: Pick<Constraint, 'kind' | 'guardian'>): string | undefined {
  const by: Partial<Record<ConstraintKind, string>> = {
    'time-after': 'Does this during the lesson or the lunch break instead.',
    'time-before': 'Does this in class time, not before school.',
    'days-away': 'Gets this on the day back.',
    money: 'Uses materials from the class set; no need to buy or bring anything.',
    'no-phone-internet': 'Gets a printed copy or does it from the textbook; no phone or internet needed.',
    contact: `Send word through ${c.guardian ? `the ${c.guardian}` : 'the listed guardian'}.`,
    health: "Check this step with the child's care plan before the lesson.",
  };
  return by[c.kind];
}

/** What the rules find in an adjustment, against every confirmed constraint about that child and about the class. Empty: it may be offered. */
export function adjustmentHits(text: string, constraint: Constraint, constraints: readonly Constraint[], note: string): RuleHit[] {
  const afterBell = afterBellActivities(note);
  return constraints
    .filter((c) => c.confirmed && (c.id === constraint.id || !c.about || c.about === constraint.about))
    .map((c) => ruleConflicts(text, c, { afterBell }))
    .filter((h): h is RuleHit => h !== undefined);
}

/** The most characters of an adjustment. */
export const ADJUSTMENT_MAX = 300;

// ---------------------------------------------------------------- the signed lesson, kept on this device

export type StageDone = 'done' | 'partly' | 'not';
export const STAGE_DONE: Record<StageDone, string> = { done: 'Done', partly: 'Partly', not: 'Not done' };

export interface SavedAdjustment {
  itemIndex: number;
  constraintId: string;
  /** The child's name. A saved lesson is on this device only. */
  child: string;
  text: string;
  source: AdjustmentSource;
}

/** A signed lesson. Kept in this browser only: it has names in it and is never sent. */
export interface SavedLesson {
  id: string;
  savedAt: string;
  fields: LessonFields;
  title: string;
  /** The class plan: the stages that were kept, stand-ins as they came, with no names put back. */
  stages: DraftItem[];
  adjustments: SavedAdjustment[];
  constraintIds: string[];
  /** How it went, said after teaching. */
  after?: { stages: (StageDone | null)[]; line: string; at: string };
}

const KEY = 'staffroom.lessons.v1';
export const LESSONS_MAX = 30;

const str = (v: unknown): v is string => typeof v === 'string';
const isSaved = (v: unknown): v is SavedLesson => {
  const l = v as SavedLesson | null;
  return Boolean(
    l && typeof l === 'object' && str(l.id) && str(l.savedAt) && str(l.title) && l.fields && str(l.fields.subject) && str(l.fields.topic) &&
      Array.isArray(l.stages) && l.stages.every((s) => s && str(s.heading) && str(s.text)) &&
      Array.isArray(l.adjustments) && l.adjustments.every((a) => a && Number.isInteger(a.itemIndex) && str(a.child) && str(a.text)) &&
      Array.isArray(l.constraintIds),
  );
};

export function loadLessons(): SavedLesson[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter(isSaved).slice(0, LESSONS_MAX) : [];
  } catch {
    return [];
  }
}

/** Keep the lessons in this browser, newest first, thirty at most. False when the browser would not store them. */
export function storeLessons(lessons: SavedLesson[]): boolean {
  try {
    if (lessons.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(lessons.slice(0, LESSONS_MAX)));
    return true;
  } catch {
    return false;
  }
}

/** A stage's name without its minutes: "Starter (5 minutes)" is "Starter". */
export const stageName = (heading: string) => heading.replace(/\s*[(\[–—:-]\s*\d+\s*min(?:ute)?s?\.?\s*[)\]]?\s*$/iu, '').trim() || heading.trim();

/**
 * What was done last time, for the next lesson: the topic, each stage with
 * done, partly or not done, and the teacher's own line. Built on the
 * device from the saved lesson. No adjustment and no name of a child is in
 * it; it still goes through the same checks as every lesson line.
 */
export function lastTimeSummary(lesson: SavedLesson): string {
  const said = lesson.after;
  const parts = [`Topic: ${lesson.fields.topic}.`];
  if (said) {
    const stages = lesson.stages
      .map((s, i) => (said.stages[i] ? `${stageName(s.heading).replace(/\[[^\]]*\]/g, '').trim()}: ${STAGE_DONE[said.stages[i]!].toLowerCase()}` : ''))
      .filter(Boolean);
    if (stages.length > 0) parts.push(`${stages.join('; ')}.`);
    const line = one(said.line, 240);
    if (line) parts.push(`Teacher's note: ${line}`);
  }
  return one(parts.join(' '), LAST_TIME_MAX);
}

/** The fields the next lesson starts from: the same class and subject and length, no topic, and what was done last time. */
export function nextLessonFields(lesson: SavedLesson): LessonFields {
  return { klass: lesson.fields.klass, subject: lesson.fields.subject, topic: '', minutes: lessonMinutes(lesson.fields.minutes), lastTime: lastTimeSummary(lesson) };
}

/** The class plan as text: the title and each stage, stand-ins as they came. No name and no adjustment is in it. */
export function classPlanText(draft: Pick<Draft, 'title'> & { items: DraftItem[] }): string {
  return [draft.title, ...draft.items.map((i) => `${i.heading}\n${i.text}`)].join('\n\n');
}
