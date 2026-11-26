import type { Constraint } from '../core/types';
import {
  factWordsIn,
  fitForChild,
  fitHits,
  fitLessonForChild,
  fitPrompt,
  fitStep,
  readFit,
  type FitAsk,
  type FitInput,
  type FitPoint,
  type FitStage,
  type LessonFitInput,
} from '../ai/fit';
import { childNotes, pointHits, stageLines } from '../core/points';
import { repeatsForChild } from '../core/repeats';
import { LESSON_CASES, sampleClass } from './lesson';

/**
 * A set for measuring the fit: a step of advice that goes against one
 * confirmed constraint, which the on-device model is asked to rewrite so
 * the child can follow it. Two pairs for each kind of constraint that has
 * a rule; `other` has none, so a rewrite of it could not be compared.
 *
 * Every pair is invented, and none is taken from the other sets or from
 * the sample note. They were written before any model was run on them.
 * The unit tests run this with a fake model; the numbers come only from a
 * run in Chrome with the on-device model.
 */
export interface FitCase {
  id: string;
  student: string;
  constraint: Constraint;
  step: string;
}

const made = (kind: Constraint['kind'], text: string, extra: Partial<Constraint> = {}): Constraint => ({
  id: kind,
  kind,
  text,
  source: 'teacher',
  confirmed: true,
  ...extra,
});

const LIST: [string, string, Constraint, string][] = [
  ['after-1', 'Ritika', made('time-after', 'has to catch the 3.40 bus, the last one to her village'), 'Ask Ritika to stay back for fifteen minutes on Monday to finish her map.'],
  ['after-2', 'Dev', made('time-after', 'minds his younger sisters from the last bell until his mother is back'), 'Put Dev down for the after-school chess practice.'],
  ['before-1', 'Sana', made('time-before', 'cannot be at school before the first bell: her bus gets in at ten to nine'), 'Ask Sana to come in early on Friday to set up the science table.'],
  ['before-2', 'Imran', made('time-before', 'delivers milk with his uncle until just before the first bell'), 'Meet Imran before school to hear him read.'],
  ['days-1', 'Naveen', made('days-away', 'is away on Thursdays, when he takes his grandfather to the clinic', { days: ['Thursday'] }), 'Give Naveen his spelling test on Thursday morning.'],
  ['days-2', 'Pooja', made('days-away', 'does not come on Saturdays: she works at the market stall', { days: ['Saturday'] }), 'Ask Pooja to join the Saturday revision class.'],
  ['money-1', 'Farhan', made('money', 'the family cannot afford anything beyond the school fees this year'), 'Ask Farhan to buy a geometry box for next week.'],
  ['money-2', 'Lata', made('money', 'her mother is out of work and there is no money for extras'), 'Ask Lata to bring money for the class trip to the museum.'],
  ['offline-1', 'Gopal', made('no-phone-internet', 'there is no phone and no internet in the house'), 'Ask Gopal to watch the fractions video online at home.'],
  ['offline-2', 'Mini', made('no-phone-internet', 'the only phone in the family goes to work with her father'), 'Send Mini her weekly spellings by WhatsApp.'],
  ['contact-1', 'Rohan', made('contact', 'his father must not be contacted', { who: 'father' }), "Telephone Rohan's father about the missing homework."],
  ['contact-2', 'Kiran', made('contact', 'lives with her aunt while her parents work abroad', { who: 'parents', guardian: 'aunt', away: true }), "Ask Kiran's parents to sign her reading record each night."],
  ['health-1', 'Tara', made('health', 'has asthma', { triggers: ['running', 'laps', 'dust'] }), 'Have Tara run two laps of the field as a warm-up.'],
  ['health-2', 'Vivek', made('health', 'gets migraines from bright screens', { triggers: ['screen', 'projector'] }), 'Seat Vivek at the front, next to the projector.'],
];

export const FIT_CASES: FitCase[] = LIST.map(([id, student, constraint, step]) => ({ id, student, constraint, step }));

/**
 * Eight more pairs, for a lesson: a step written for the whole class and a
 * fact about one child, for which the model is asked what that child does
 * instead (fitForChild). Invented, and written before any model was run.
 */
const CHILD_LIST: [string, string, Constraint, string][] = [
  ['child-after', 'Ritika', made('time-after', 'has to catch the 3.40 bus, the last one to her village'), 'Groups still working on their poster stay after school on Wednesday to complete it.'],
  ['child-before', 'Imran', made('time-before', 'delivers milk with his uncle until just before the first bell'), 'All pupils come in early on Monday to rehearse the class assembly.'],
  ['child-days', 'Pooja', made('days-away', 'does not come on Saturdays: she works at the market stall', { days: ['Saturday'] }), 'The class test on this chapter is on Saturday in the second period.'],
  ['child-money-1', 'Farhan', made('money', 'the family cannot afford anything beyond the school fees this year'), 'Every pupil buys a set of twelve colour pencils for the map work.'],
  ['child-money-2', 'Lata', made('money', 'her mother is out of work and there is no money for extras'), 'Pupils bring money for a new exercise book for the science journal.'],
  ['child-offline-1', 'Gopal', made('no-phone-internet', 'there is no phone and no internet in the house'), 'For homework, pupils watch a video about the water cycle online and list its four stages.'],
  ['child-offline-2', 'Mini', made('no-phone-internet', 'the only phone in the family goes to work with her father'), 'Pupils send a photo of their finished drawing to the class WhatsApp group tonight.'],
  ['child-contact', 'Kiran', made('contact', 'lives with her aunt while her parents work abroad', { who: 'parents', guardian: 'aunt', away: true }), 'Pupils ask their parents to tell them a story from their own school days and write it down.'],
];

export const FIT_CHILD_CASES: FitCase[] = CHILD_LIST.map(([id, student, constraint, step]) => ({ id, student, constraint, step }));

export const fitInput = (c: FitCase): FitInput => ({ step: c.step, itemText: c.step, constraint: c.constraint, studentName: c.student, task: 'plan' });

/** What the model gave for one pair. `first` is its first answer on its own; `offered` is what the app would put in the box, after the one retry. */
export interface FitRow {
  id: string;
  kind: Constraint['kind'];
  constraint: string;
  step: string;
  first: {
    /** The first answer could be read, was not empty and was not the step again. */
    produced: boolean;
    rewrite: string;
    /** No rule fires on it against the constraint. False when nothing was produced. */
    rulePasses: boolean;
    /** The words a rule matched in it. */
    matched: string[];
    /** The words of the private fact that it repeats. */
    factWords: string[];
  };
  offered: { ok: boolean; suggestion: string; requests: number; factWords: string[] };
  /** Set when the run of this pair stopped: no on-device model, a failed request, or an answer from elsewhere. */
  error?: string;
}

export interface FitTotals {
  cases: number;
  /** First answers that were a rewrite at all. */
  produced: number;
  /** First answers that no rule fires on. */
  rulePasses: number;
  /** First answers that repeat words of the private fact. */
  saysFact: number;
  /** Pairs for which a suggestion was offered, the retry included. */
  offered: number;
  /** Offered suggestions that repeat words of the private fact. */
  offeredSaysFact: number;
  /** Pairs whose run stopped. */
  errors: number;
}

/** Run one pair. The model is asked as the app asks it; its first answer is also kept and read on its own. */
export async function fitRow(c: FitCase, ask: FitAsk, forChild = false): Promise<FitRow> {
  const input = fitInput(c);
  const answers: string[] = [];
  const recording: FitAsk = async (prompt) => {
    const answer = await ask(prompt);
    if (answer.onDevice) answers.push(answer.text);
    return answer;
  };
  const row: FitRow = {
    id: c.id,
    kind: c.constraint.kind,
    constraint: c.constraint.text,
    step: c.step,
    first: { produced: false, rewrite: '', rulePasses: false, matched: [], factWords: [] },
    offered: { ok: false, suggestion: '', requests: 0, factWords: [] },
  };
  try {
    const got = forChild ? await fitForChild({ step: c.step, constraint: c.constraint }, recording) : await fitStep(input, recording);
    row.offered = got.ok
      ? { ok: true, suggestion: got.suggestion, requests: got.asked, factWords: factWordsIn(got.suggestion, c.constraint) }
      : { ok: false, suggestion: '', requests: got.asked, factWords: [] };
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e);
  }
  const rewrite = answers.length > 0 ? readFit(answers[0], c.step) : undefined;
  if (rewrite) {
    const hits = fitHits(rewrite, input);
    row.first = { produced: true, rewrite, rulePasses: hits.length === 0, matched: hits.map((h) => h.matched), factWords: factWordsIn(rewrite, c.constraint) };
  }
  return row;
}

export function fitTotals(rows: FitRow[]): FitTotals {
  return {
    cases: rows.length,
    produced: rows.filter((r) => r.first.produced).length,
    rulePasses: rows.filter((r) => r.first.rulePasses).length,
    saysFact: rows.filter((r) => r.first.factWords.length > 0).length,
    offered: rows.filter((r) => r.offered.ok).length,
    offeredSaysFact: rows.filter((r) => r.offered.ok && r.offered.factWords.length > 0).length,
    errors: rows.filter((r) => r.error !== undefined).length,
  };
}

/** The first prompt of a pair, for the table. */
export const fitFirstPrompt = (c: FitCase) => fitPrompt(fitInput(c));

// ---------------------------------------------------------------- a lesson: what each child needs in it

/** One call: one of the five hand-written lessons and one child of the sample class the note says something about. */
export interface LessonFitCase {
  id: string;
  lesson: string;
  child: string;
  input: LessonFitInput;
  check: (point: FitPoint) => string[];
  /** The words of the private note that a point is read for. */
  repeats: (text: string) => string[];
}

/** The five lessons of the lesson set, each with each of the sample's children the note speaks of: 25 calls. */
export function lessonFitCases(): LessonFitCase[] {
  const { note, entities, constraints, tokens } = sampleClass();
  const notes = childNotes(note, entities, constraints);
  return LESSON_CASES.flatMap((lesson) => {
    const stages = stageLines(lesson.stages, entities, tokens);
    return notes.map((n) => ({
      id: `${lesson.id}/${n.child.split(' ')[0].toLowerCase()}`,
      lesson: lesson.subject,
      child: n.child,
      input: { childName: n.child, childNote: n.text, stages },
      check: (p: FitPoint) => pointHits(p.text, n.id, p.itemIndex, lesson.stages, constraints, note).map((h) => h.matched),
      repeats: (text: string) => repeatsForChild(text, n.id, entities, constraints),
    }));
  });
}

/** One point of an answer, as the page reports it. The rating is for a person who reads it: nothing here fills it in. */
export interface LessonFitPoint {
  stage: string;
  do: string;
  /** True when the stage it names is a stage of this lesson. */
  realStage: boolean;
  /** True when no rule fires on it for that child. Not read for a point with no real stage. */
  rulePasses: boolean;
  matched: string[];
  /** The words of the private note about the child that it repeats, in runs of three or more or from the sensitive list. */
  repeats: string[];
  /** A human rating, filled in by hand afterwards. Always null here. */
  rating: null;
}

export interface LessonFitRow {
  id: string;
  lesson: string;
  child: string;
  /** The points of the first answer, as the model gave them, before any guard. */
  first: LessonFitPoint[];
  /** The points offered to the teacher, after the guards and at most one more request. */
  offered: LessonFitPoint[];
  read: boolean;
  requests: number;
  droppedByRule: number;
  unknownStage: number;
  error?: string;
}

const rawPoints = (raw: string): { stage: string; do: string }[] => {
  try {
    const parsed = JSON.parse(raw) as { points?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.points)) return [];
    return (parsed.points as { stage?: unknown; do?: unknown }[])
      .filter((p) => p && typeof p.do === 'string' && p.do.trim().length > 0)
      .map((p) => ({ stage: typeof p.stage === 'string' ? p.stage : '', do: (p.do as string).replace(/\s+/g, ' ').trim() }));
  } catch {
    return [];
  }
};

/** Run one call as the app runs it. `asker` builds the request for a lesson's stages, as onDeviceFit does. */
export async function lessonFitRow(c: LessonFitCase, asker: (stages: FitStage[]) => FitAsk): Promise<LessonFitRow> {
  const answers: string[] = [];
  const ask = asker(c.input.stages);
  const recording: FitAsk = async (prompt) => {
    const answer = await ask(prompt);
    if (answer.onDevice) answers.push(answer.text);
    return answer;
  };
  const report = (stage: string, text: string): LessonFitPoint => {
    const itemIndex = c.input.stages.findIndex((s) => s.name.toLowerCase() === stage.trim().toLowerCase());
    const matched = itemIndex >= 0 ? c.check({ itemIndex, stage, text }) : [];
    return { stage, do: text, realStage: itemIndex >= 0, rulePasses: itemIndex >= 0 && matched.length === 0, matched, repeats: c.repeats(text), rating: null };
  };
  const row: LessonFitRow = { id: c.id, lesson: c.lesson, child: c.child, first: [], offered: [], read: false, requests: 0, droppedByRule: 0, unknownStage: 0 };
  try {
    const got = await fitLessonForChild(c.input, c.check, recording);
    row.offered = got.points.map((p) => report(p.stage, p.text));
    row.read = got.read;
    row.requests = got.asked;
    row.droppedByRule = got.droppedByRule;
    row.unknownStage = got.unknownStage;
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e);
  }
  if (answers.length > 0) row.first = rawPoints(answers[0]).map((p) => report(p.stage, p.do));
  return row;
}

export interface LessonFitTotals {
  calls: number;
  /** Calls whose first answer could be read. */
  read: number;
  /** Calls whose first answer gave no point. */
  noPoints: number;
  /** Points in first answers, and how many of them name a real stage, pass the rules, and repeat private words. */
  points: number;
  realStage: number;
  rulePasses: number;
  repeatsPrivate: number;
  /** Points offered after the guards. */
  offered: number;
  offeredRepeatsPrivate: number;
  droppedByRule: number;
  errors: number;
  /** Offered points a person has rated. Nothing here rates one. */
  rated: number;
}

export function lessonFitTotals(rows: LessonFitRow[]): LessonFitTotals {
  const first = rows.flatMap((r) => r.first);
  const offered = rows.flatMap((r) => r.offered);
  return {
    calls: rows.length,
    read: rows.filter((r) => r.read).length,
    noPoints: rows.filter((r) => r.read && r.first.length === 0).length,
    points: first.length,
    realStage: first.filter((p) => p.realStage).length,
    rulePasses: first.filter((p) => p.rulePasses).length,
    repeatsPrivate: first.filter((p) => p.repeats.length > 0).length,
    offered: offered.length,
    offeredRepeatsPrivate: offered.filter((p) => p.repeats.length > 0).length,
    droppedByRule: rows.reduce((n, r) => n + r.droppedByRule, 0),
    errors: rows.filter((r) => r.error !== undefined).length,
    rated: offered.filter((p) => p.rating !== null).length,
  };
}
