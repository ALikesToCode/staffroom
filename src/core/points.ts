import type { Constraint, DraftItem, Entity } from './types';
import { afterBellActivities, nameInNote, ruleConflicts, stageOf, type RuleHit } from './conflicts';
import { starterFor, stageName, type AdjustmentSource, type LessonHit, type SavedAdjustment } from './lesson';
import type { LessonNeed, Variation } from './lessonNeeds';
import { sentences, wholeWordMatcher } from './rules';
import { ownerAt, RESERVED, restore } from './vault';

// A lesson the cloud wrote honestly seldom breaks a rule. So the device does not wait for a collision: for
// every child the note says something about, it says what that child needs in this lesson, from the
// private note. Everything here is plain code. The words of a point come from the on-device model or from
// the teacher; the rules here and the teacher guard them. Nothing here is ever sent.

/** What the note says about one child: the text the on-device model is given, and what the teacher is shown. */
export interface ChildNote {
  /** The id of the student in the vault. */
  id: string;
  /** The name as the class list has it, over the child's section. */
  name: string;
  /** The name as the note first has it, used in a sentence. */
  child: string;
  /** The sentences of the note about this child, names and private details as written. */
  sentences: string[];
  /** Confirmed constraints about this child. */
  constraints: Constraint[];
  /** The sentences, and after them any withheld detail or confirmed constraint about the child that is not in them. */
  text: string;
}

/** The most of the note about one child that one request carries. */
export const CHILD_NOTE_MAX = 1200;

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The children the note says something about, in the order the note has
 * them. A sentence that names a child is about that child (and about each
 * child it names); a sentence that names nobody belongs to the one child
 * named earlier in its paragraph, by the same rule the vault uses for a
 * private detail. A child on the class list whom the note does not
 * mention is not here.
 */
export function childNotes(note: string, entities: Entity[], constraints: readonly Constraint[]): ChildNote[] {
  const students = entities.filter((e) => e.kind === 'student');
  const by = new Map<string, string[]>();
  for (const s of sentences(note)) {
    // A sentence is kept with its full stop.
    const text = flat(`${note.slice(s.start, s.end)}${/[.!?]/u.test(note[s.end] ?? '') ? note[s.end] : ''}`);
    if (!text) continue;
    const named = students.filter((x) => wholeWordMatcher(x.surfaces)?.test(text)).map((x) => x.id);
    const owner = named.length > 0 ? named : [ownerAt(note, entities, s.start, s.end)].filter((x): x is string => x !== undefined);
    for (const id of owner) by.set(id, [...(by.get(id) ?? []), text]);
  }
  const first = (e: Entity) => Math.min(...e.surfaces.map((x) => note.indexOf(x)).filter((at) => at >= 0), Infinity);
  return students
    .filter((s) => by.has(s.id))
    .sort((a, b) => first(a) - first(b))
    .map((s) => {
      const said = by.get(s.id)!;
      const mine = constraints.filter((c) => c.confirmed && c.about === s.id);
      const joined = said.join(' ');
      const more = [
        ...entities.filter((e) => e.kind === 'private' && e.withheld && e.category !== RESERVED && e.about === s.id).map((e) => flat(e.surfaces[0])),
        ...mine.map((c) => flat(c.text)),
      ].filter((x, i, all) => x && !joined.includes(x) && all.indexOf(x) === i);
      return {
        id: s.id,
        name: s.surfaces[0],
        child: nameInNote(note, s),
        sentences: said,
        constraints: mine,
        text: [joined, ...more].join('\n').slice(0, CHILD_NOTE_MAX),
      };
    });
}

/** One stage of the lesson as the fit is told it: its name, its minutes and one line. */
export interface StageLine {
  name: string;
  minutes?: number;
  summary: string;
}

export const STAGE_SUMMARY_MAX = 160;

/** The stages in one line each: the first sentence, names put back (this is read on the device only). A name used twice is numbered. */
export function stageLines(items: readonly DraftItem[], entities: Entity[], allowed: readonly string[]): StageLine[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const heading = restore(item.heading, entities, allowed);
    const base = stageName(heading);
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    const minutes = /(\d+)\s*min/iu.exec(heading)?.[1];
    const text = flat(restore(item.text, entities, allowed));
    const end = text.search(/[.!?](?:\s|$)/u);
    const summary = (end >= 0 ? text.slice(0, end + 1) : text).slice(0, STAGE_SUMMARY_MAX);
    return { name: n === 1 ? base : `${base} ${n}`, ...(minutes ? { minutes: Number(minutes) } : {}), summary };
  });
}

/** One thing a child needs in one stage of the lesson, as it stands: offered and waiting, or accepted. A dropped point is gone. */
export interface Point {
  key: string;
  childId: string;
  /** The child's name as the note has it. */
  child: string;
  /** The stage it is for. */
  itemIndex: number;
  text: string;
  source: AdjustmentSource;
  state: 'offered' | 'accepted';
  /** True once it has been on screen. "Accept all" counts only these. */
  seen?: boolean;
  /** Why it cannot be accepted as it is: a rule fires on it for this child. Also why an accepted point went back to waiting. */
  why?: string;
  /** The letter of the need the cloud wrote it for. Absent for a point the device or the teacher wrote. */
  need?: string;
  /** Starter wording offered in place of a line a rule fires on. */
  starter?: string;
}

/** The most characters of a point. */
export const POINT_MAX = 200;

/** What the rules find in a point, against every confirmed constraint about that child and about the class. Empty: it may be offered. */
export function pointHits(text: string, childId: string, itemIndex: number, items: readonly DraftItem[], constraints: readonly Constraint[], note: string): RuleHit[] {
  const afterBell = afterBellActivities(note);
  const stage = items[itemIndex] ? stageOf(items[itemIndex], true) : undefined;
  return constraints
    .filter((c) => c.confirmed && (!c.about || c.about === childId))
    .map((c) => ruleConflicts(text, c, { afterBell, stage }))
    .filter((h): h is RuleHit => h !== undefined);
}

const against = (hits: RuleHit[]) => `This goes against what you confirmed (“${[...new Set(hits.map((h) => h.matched))].join('”, “')}”). Change it or drop it.`;

/** What a typed or changed point must pass: a stage of this lesson, not empty, not too long, and no rule firing on it for that child. Undefined: it may be accepted. */
export function pointProblem(text: string, childId: string, itemIndex: number, items: readonly DraftItem[], constraints: readonly Constraint[], note: string, max = POINT_MAX): string | undefined {
  const typed = flat(text);
  if (!items[itemIndex]) return 'Choose a stage of the lesson.';
  if (typed.length === 0) return 'Write what this child needs.';
  if (typed.length > max) return `Keep it to ${max} characters.`;
  const hits = pointHits(typed, childId, itemIndex, items, constraints, note);
  return hits.length > 0 ? against(hits) : undefined;
}

/**
 * After the teacher switches a constraint on the result screen: an accepted
 * point that a rule now fires on goes back to waiting, with the reason. The
 * rest are returned as they are (the same array when nothing changed).
 */
export function recheckPoints(points: readonly Point[], items: readonly DraftItem[], constraints: readonly Constraint[], note: string): Point[] {
  let changed = false;
  const out = points.map((p) => {
    if (p.state !== 'accepted') return p;
    const hits = pointHits(p.text, p.childId, p.itemIndex, items, constraints, note);
    if (hits.length === 0) return p;
    changed = true;
    return { ...p, state: 'offered' as const, seen: true, why: against(hits) };
  });
  return changed ? out : (points as Point[]);
}

/** The points "Accept all" may accept, and whether every waiting point has been shown. */
export function acceptablePoints(points: readonly Point[]): { keys: string[]; allSeen: boolean } {
  const offered = points.filter((p) => p.state === 'offered');
  const keys = offered.filter((p) => p.seen).map((p) => p.key);
  return { keys, allSeen: keys.length === offered.length };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The line over the lesson. A part that is zero is left out, and it never
 * says a lesson suits everyone: no rule and no model can know that.
 * `points` are the lines as they stand; `suggested` is how many the
 * on-device model wrote in this run.
 */
export function fitSummary(children: number, suggested: number, hits: readonly LessonHit[], points: readonly Point[] = []): string {
  const steps = new Set(hits.map((h) => `${h.itemIndex}:${h.stepIndex}`)).size;
  const placed = points.filter((p) => p.need !== undefined);
  const needs = new Set(placed.map((p) => p.need)).size;
  const beside = new Set(placed.map((p) => p.childId)).size;
  const against = steps + placed.filter((p) => p.state === 'offered' && p.why !== undefined).length;
  const out: string[] = [];
  if (children > 0) out.push(`${count(children, 'child has', 'children have')} private notes.`);
  if (needs > 0) out.push(`The cloud wrote for ${count(needs, 'need', 'needs')} without knowing whose.`);
  if (placed.length > 0) out.push(`${count(placed.length, 'line', 'lines')} placed beside ${count(beside, 'child', 'children')} on this device.`);
  if (suggested > 0) out.push(`${count(suggested, 'point', 'points')} suggested on this device.`);
  if (against > 0) out.push(`${against === 1 ? '1 goes' : `${against} go`} against a constraint you confirmed.`);
  return out.length > 0 ? out.join(' ') : 'Your note says nothing about any one child, so there is nothing to fit.';
}

/**
 * Put what the cloud wrote for a need beside each child who has that
 * need. The cloud wrote it without knowing whose it is; only this device
 * knows. The words are left as the cloud wrote them. Each line is read by
 * rule against ALL of that child's confirmed constraints, not only the
 * one behind the need: a line a rule fires on is offered with the reason,
 * and with starter wording when there is some that passes.
 */
export function placeVariations(
  variations: readonly Variation[],
  needs: readonly LessonNeed[],
  entities: Entity[],
  items: readonly DraftItem[],
  constraints: readonly Constraint[],
  note: string,
): Point[] {
  const afterBell = afterBellActivities(note);
  const out: Point[] = [];
  for (const v of variations) {
    const need = needs.find((n) => n.letter === v.need);
    if (!need || !items[v.itemIndex]) continue;
    for (const childId of need.children) {
      const student = entities.find((e) => e.id === childId && e.kind === 'student');
      if (!student) continue;
      const child = nameInNote(note, student);
      const stage = stageOf(items[v.itemIndex], true);
      const mine = constraints.filter((c) => c.confirmed && (!c.about || c.about === childId));
      const hit = mine.map((c) => ({ c, hit: ruleConflicts(v.text, c, { name: child, afterBell, stage }) })).find((x) => x.hit !== undefined);
      const starter = hit ? starterFor(hit.c) : undefined;
      const usable = starter !== undefined && pointHits(starter, childId, v.itemIndex, items, constraints, note).length === 0;
      out.push({
        key: `v:${v.itemIndex}:${v.need}:${childId}`,
        childId,
        child,
        itemIndex: v.itemIndex,
        text: v.text,
        source: 'cloud',
        state: 'offered',
        need: v.need,
        ...(hit?.hit ? { why: hit.hit.reason } : {}),
        ...(usable ? { starter } : {}),
      });
    }
  }
  return out;
}

/** The names beside each line for a need, for the device's side of the lesson: who has that need. Never sent. */
export function namesForNeed(need: string, needs: readonly LessonNeed[], notes: readonly ChildNote[], entities: Entity[]): string[] {
  const n = needs.find((x) => x.letter === need);
  return [...(n?.children ?? []).map((id) => notes.find((x) => x.id === id)?.name ?? entities.find((e) => e.id === id)?.surfaces[0]).filter((x): x is string => x !== undefined), ...(n?.others ?? [])];
}

/** The accepted points as a saved lesson and a recorded run keep them. */
export function acceptedPoints(points: readonly Point[]): SavedAdjustment[] {
  return points
    .filter((p) => p.state === 'accepted')
    .sort((a, b) => a.itemIndex - b.itemIndex)
    .map((p) => ({ itemIndex: p.itemIndex, childId: p.childId, child: p.child, text: p.text, source: p.source, ...(p.need ? { need: p.need } : {}) }));
}

/** The counts a receipt keeps of the points: how many the on-device model suggested and how many were accepted. No words. */
export function pointCounts(points: readonly Point[], suggested: number): { pointsSuggested: number; pointsAccepted: number; variationsPlaced: number; variationsAccepted: number } {
  const placed = points.filter((p) => p.need !== undefined);
  return {
    pointsSuggested: suggested,
    pointsAccepted: points.filter((p) => p.state === 'accepted' && p.need === undefined).length,
    variationsPlaced: placed.length,
    variationsAccepted: placed.filter((p) => p.state === 'accepted').length,
  };
}

/** The teacher's copy: what was accepted, by child (in the order first met), then by the lesson's stage order. */
export function byChild(stages: readonly DraftItem[], adjustments: readonly SavedAdjustment[]): { child: string; lines: { stage: string; text: string }[] }[] {
  const children = [...new Set(adjustments.map((a) => a.child))];
  return children.map((child) => ({
    child,
    lines: adjustments
      .filter((a) => a.child === child && stages[a.itemIndex])
      .map((a, i) => ({ a, i }))
      .sort((x, y) => x.a.itemIndex - y.a.itemIndex || x.i - y.i)
      .map(({ a }) => ({ stage: stageName(stages[a.itemIndex].heading), text: a.text })),
  }));
}

/** In a replay: the recorded entries that answer no rule hit, shown as accepted points. */
export function recordedPoints(list: readonly { itemIndex: number; constraintId?: string; childId?: string; child?: string; text: string; source: AdjustmentSource; need?: string }[], notes: readonly ChildNote[]): Point[] {
  return list
    .filter((a) => a.constraintId === undefined && a.childId !== undefined)
    .map((a, i) => ({
      key: `r:${i}`,
      childId: a.childId!,
      child: notes.find((n) => n.id === a.childId)?.child ?? a.child ?? '',
      itemIndex: a.itemIndex,
      text: a.text,
      source: a.source,
      state: 'accepted' as const,
      seen: true,
      ...(a.need ? { need: a.need } : {}),
    }));
}

/**
 * What is said in a child's section after the on-device model answered:
 * nothing when it gave points and none was left out. It never says the
 * lesson suits the child: that the model offered nothing is all that is known.
 */
export function childFitSaid(child: string, got: { points: readonly unknown[]; droppedByRule: number; unknownStage: number; read: boolean }): string | undefined {
  if (!got.read) return `The on-device model gave no answer that could be read for ${child}. Write what ${child} needs yourself.`;
  const out: string[] = [];
  if (got.points.length === 0) out.push(`The on-device model suggested nothing for ${child} in this lesson.`);
  if (got.droppedByRule > 0) out.push(`${count(got.droppedByRule, 'point was', 'points were')} left out: a rule found that it went against a constraint you confirmed.`);
  if (got.unknownStage > 0) out.push(`${count(got.unknownStage, 'point was', 'points were')} left out: it named no stage of this lesson.`);
  return out.length > 0 ? out.join(' ') : undefined;
}

/** What was accepted, with the children in the note's order: the adjustments and the points of one child stand together. */
export function inNoteOrder(list: readonly SavedAdjustment[], notes: readonly ChildNote[]): SavedAdjustment[] {
  const at = (a: SavedAdjustment) => {
    const i = notes.findIndex((n) => n.id === a.childId);
    return i < 0 ? notes.length : i;
  };
  return list.map((a, i) => ({ a, i })).sort((x, y) => at(x.a) - at(y.a) || x.i - y.i).map(({ a }) => a);
}
