import type { Constraint, ConstraintKind, Draft, DraftItem, Entity } from './types';
import type { Violation } from './gate';
import { afterBellActivities, nameInNote, ruleConflicts, ruleHitsForItem, type RuleHit } from './conflicts';
import { findByRule, findSensitive, listedParts, wholeWordMatcher } from './rules';
import { BARE_RE, LOOKALIKE_RE } from './vault';
import type { StoredVersion } from './materials';

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
  /** The language the cloud is asked to write in. Absent, empty or "English": English. Also read for messages to parents. */
  language?: string;
}

export const NO_LESSON: LessonFields = { klass: '', subject: '', topic: '', minutes: 40, lastTime: '' };
export const LESSON_HEADING = 'Lesson';
export const FIELD_MAX = 120;
export const LAST_TIME_MAX = 600;

const one = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** The languages offered by name. Any other is typed. */
export const LANGUAGES = ['English', 'Hindi'] as const;
export const LANGUAGE_MAX = 40;

/** The language to write in, as it is sent: a name in letters. Empty for English, which is not sent at all. */
export function languageOf(f: Pick<LessonFields, 'language'> | null | undefined): string {
  const l = (f?.language ?? '').replace(/[^\p{L}\p{M}\s()-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, LANGUAGE_MAX);
  return /^english$/i.test(l) ? '' : l;
}

/**
 * The language as the request names it. For Hindi the line also names the script and shows it, because the cloud
 * model otherwise often writes Hindi in Latin letters: told "in Devanagari" alone it did, shown the script it did not.
 */
export function languageLine(language: string): string {
  return /^hindi$/i.test(language.trim()) ? 'Hindi, in Devanagari script (हिन्दी, देवनागरी लिपि में)' : language;
}

/** Said once when the text is not in English. The rules are word lists in English; nothing here claims a model read the text either. */
export const NOT_ENGLISH = 'The rules read English only, so they have not checked this text. Read it yourself.';
export const NOT_CHECKED_BY_RULE = 'Not checked by rule';

/** The line that asks for messages home in a language. */
export const MESSAGES_LANGUAGE = 'Language of the messages';

/** The outgoing text of messages home, with the language asked for under it. In English, the text as it is. */
export function withLanguage<T extends { text: string }>(going: T, language: string): T {
  return language ? { ...going, text: `${going.text.trimEnd()}\n\n${MESSAGES_LANGUAGE}: ${languageLine(language)}` } : going;
}

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
  if (languageOf(f)) lines.push(`Language of the plan: ${languageLine(languageOf(f))}`);
  return lines.join('\n');
}

/** The outgoing text with the lesson under it. */
export const withLesson = (text: string, f: LessonFields) => (text.trim() ? `${text.trimEnd()}\n\n${lessonBlock(f)}` : lessonBlock(f));

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

/** The outgoing text of a lesson: the redacted note and needs, the lesson lines under them, and what stops either. */
export function withLessonGoing<T extends { text: string; violations: Violation[] }>(going: T, f: LessonFields | null, entities: Entity[], classList: readonly string[]): T {
  if (!f) return going;
  return { ...going, text: withLesson(going.text, f), violations: [...going.violations, ...lessonIssues(f, entities, classList)] };
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
  /** The student the constraint is about. Absent for a constraint about everyone. */
  childId?: string;
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
        ...(student ? { childId: student.id } : {}),
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

// ---------------------------------------------------------------- the fit: an adjustment for one child

/** Who wrote the words: the on-device model, a rule's starter, the teacher, or the cloud for a need the teacher approved. */
export type AdjustmentSource = 'model' | 'starter' | 'teacher' | 'cloud';

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
  /** The constraint the step went against. Absent for a point: something the child needs that answers no rule. */
  constraintId?: string;
  /** The student it is for. Absent for the class, and in a lesson saved before this was kept. */
  childId?: string;
  /** The child's name. A saved lesson is on this device only. */
  child: string;
  text: string;
  source: AdjustmentSource;
  /** The letter of the need the cloud wrote it for, when it did. */
  need?: string;
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
  /** The needs the cloud was told for this lesson, by letter, and whose each is. On this device only. */
  needs?: { letter: string; line: string; children: string[]; others?: string[] }[];
  /** The lines the cloud wrote for needs. `itemIndex` counts the kept stages. */
  variations?: { itemIndex: number; need: string; text: string }[];
  /** The materials the cloud wrote for this lesson, by letter. No name is in them. */
  materials?: { board: string[]; sheet: string[]; versions: StoredVersion[]; ticket: { question: string; answer: string }[]; same?: string[] };
  /** How it went, said after teaching. */
  after?: { stages: (StageDone | null)[]; line: string; at: string; ticket?: Record<string, 'got' | 'partly' | 'not' | 'absent'> };
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

export const CONTINUE = 'Continue: ';

/** The topic the next lesson starts with: "Continue: " and the last topic, said once however many lessons it runs to. The teacher can change it. */
export function continueTopic(topic: string): string {
  let last = one(topic, FIELD_MAX);
  while (last.toLowerCase().startsWith(CONTINUE.toLowerCase())) last = last.slice(CONTINUE.length).trim();
  return last ? one(`${CONTINUE}${last}`, FIELD_MAX) : '';
}

/** The fields the next lesson starts from: the same class and subject and length, the last topic to continue, and what was done last time. */
export function nextLessonFields(lesson: SavedLesson): LessonFields {
  return {
    klass: lesson.fields.klass,
    subject: lesson.fields.subject,
    topic: continueTopic(lesson.fields.topic),
    minutes: lessonMinutes(lesson.fields.minutes),
    lastTime: lastTimeSummary(lesson),
  };
}

/** The class plan as text: the title and each stage, stand-ins as they came. No name and no adjustment is in it. */
export function classPlanText(draft: Pick<Draft, 'title'> & { items: DraftItem[] }): string {
  return [draft.title, ...draft.items.map((i) => `${i.heading}\n${i.text}`)].join('\n\n');
}

// ---------------------------------------------------------------- adjustments on the result screen

/** One adjustment as it stands: offered and waiting, accepted, or the step left as it is for this child. */
export interface Adjustment {
  text: string;
  source: AdjustmentSource;
  state: 'offered' | 'accepted' | 'left';
  /** True once an offer has been on screen. "Accept all" counts only offers that have been. */
  seen?: boolean;
  /** Said with the offer: why the words are a starter and not the model's. */
  said?: string;
}

/** The adjustments of a run, by the key of the hit they answer. */
export type Adjustments = Record<string, Adjustment>;

/** Hits the teacher has not yet settled: nothing offered, or an offer still waiting. Sign-off waits for these. */
export const unsettled = (hits: readonly LessonHit[], adj: Adjustments) => hits.filter((h) => !adj[h.key] || adj[h.key].state === 'offered');

/** Offers that wait and have been shown, which "Accept all" may accept; and whether every waiting offer has been shown. */
export function acceptable(hits: readonly LessonHit[], adj: Adjustments): { keys: string[]; allSeen: boolean } {
  const offered = hits.filter((h) => adj[h.key]?.state === 'offered');
  const keys = offered.filter((h) => adj[h.key].seen).map((h) => h.key);
  return { keys, allSeen: keys.length === offered.length };
}

/** What a typed or changed adjustment must pass: not empty, not too long, and no rule firing on it for that child. Undefined: it may be accepted. */
export function adjustmentProblem(text: string, constraint: Constraint, constraints: readonly Constraint[], note: string): string | undefined {
  const typed = text.replace(/\s+/g, ' ').trim();
  if (typed.length === 0) return 'Write what this child does instead.';
  if (typed.length > ADJUSTMENT_MAX) return `Keep it to ${ADJUSTMENT_MAX} characters.`;
  const hits = adjustmentHits(typed, constraint, constraints, note);
  if (hits.length > 0) return `This still goes against what you confirmed (“${hits.map((h) => h.matched).join('”, “')}”). Change it.`;
  return undefined;
}

/** The counts a receipt keeps about a lesson. Counts only: no words of any adjustment. */
export function lessonCounts(hits: readonly LessonHit[], adj: Adjustments): { stepsNeedingFit: number; adjustmentsAccepted: number; adjustmentsByModel: number } {
  const accepted = hits.filter((h) => adj[h.key]?.state === 'accepted');
  return {
    stepsNeedingFit: new Set(hits.map((h) => h.itemIndex)).size,
    adjustmentsAccepted: accepted.length,
    adjustmentsByModel: accepted.filter((h) => adj[h.key].source === 'model').length,
  };
}

/** The accepted adjustments, in the lesson's order, as a saved lesson and a recorded run keep them. */
export function acceptedAdjustments(hits: readonly LessonHit[], adj: Adjustments): SavedAdjustment[] {
  return hits
    .filter((h) => adj[h.key]?.state === 'accepted')
    .map((h) => ({ itemIndex: h.itemIndex, constraintId: h.constraintId, ...(h.childId ? { childId: h.childId } : {}), child: h.child, text: adj[h.key].text, source: adj[h.key].source }));
}

/** A signed lesson in the form it is kept in. */
export function savedLesson(
  id: string,
  at: string,
  fields: LessonFields,
  title: string,
  stages: DraftItem[],
  adjustments: SavedAdjustment[],
  constraints: readonly Constraint[],
  extra: Pick<SavedLesson, 'needs' | 'variations' | 'materials'> = {},
): SavedLesson {
  return {
    id,
    savedAt: at,
    fields: { ...fields, minutes: lessonMinutes(fields.minutes) },
    title,
    stages,
    adjustments,
    constraintIds: constraints.filter((c) => c.confirmed).map((c) => c.id),
    ...(extra.needs && extra.needs.length > 0 ? { needs: extra.needs } : {}),
    ...(extra.variations && extra.variations.length > 0 ? { variations: extra.variations } : {}),
    ...(extra.materials ? { materials: extra.materials } : {}),
  };
}

/** In a replay: the adjustments of the recorded run, set against the hits the rules find in its draft. Each stands as accepted. */
export function recordedAdjustments(hits: readonly LessonHit[], list: readonly { itemIndex: number; constraintId?: string; text: string; source: AdjustmentSource }[]): Adjustments {
  const out: Adjustments = {};
  for (const a of list) {
    if (a.constraintId === undefined) continue;
    const hit = hits.find((h) => h.itemIndex === a.itemIndex && h.constraintId === a.constraintId && !(h.key in out));
    if (hit) out[hit.key] = { text: a.text, source: a.source, state: 'accepted', seen: true };
  }
  return out;
}
