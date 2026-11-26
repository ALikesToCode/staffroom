import type { Constraint, Draft, DraftItem, Entity, LearningKind } from './types';
import type { Violation } from './gate';
import { checkNeed } from './needs';
import { sensitiveWords, sentences, wholeWordMatcher } from './rules';
import { ownerAt, TOKEN_RE } from './vault';

// For a lesson, the cloud writes for the need and the device knows the child. A need here is a letter
// and a line: no name, no stand-in, no reason, and nothing that says how many children have it or which.
// The cloud is told the lines. Which child a letter belongs to is worked out here and stays here: it is
// in no outgoing text and no record. Plain code, no model.

/** The line a rule gives each kind of learning need. The teacher can change it. */
export const LEARNING_LINE: Record<LearningKind, string> = {
  tests: 'finds written tests hard; can answer aloud',
  early: 'finishes early and needs more to do',
  missed: 'has missed recent lessons',
  group: 'works better apart from one classmate',
  shy: 'needs time before speaking in front of the class',
  'reads-above': 'reads above the level of the class',
  'reads-below': 'reads below the level of the class',
  homework: 'has not handed in recent homework',
};

const TEST = '(?:tests?|exams?|examinations?)';
const LEARNING_PATTERNS: [LearningKind, string][] = [
  ['missed', `(?:(?:has|have|had)\\s+)?(?:missed|been\\s+absent(?:\\s+for)?|was\\s+absent(?:\\s+for)?)\\s+(?:[\\p{L}\\p{N}]+\\s+){0,3}?(?:days?|lessons?|classes|weeks?|school)(?:\\s+(?:this|last)\\s+(?:week|month|term))?`],
  ['early', `finish(?:es|ed)?\\s+(?:[\\p{L}]+\\s+){0,3}?early(?:\\s+and\\s+gets?\\s+bored)?|gets?\\s+bored(?:\\s+easily)?`],
  ['tests', `freezes?\\s+(?:up\\s+)?(?:in|during|at)\\s+(?:[\\p{L}]+\\s+){0,2}?${TEST}|(?:afraid|scared|anxious|nervous)\\s+(?:of|in|about|during)\\s+(?:(?:the|a|written|oral|class|unit)\\s+){0,2}${TEST}(?!\\s+hall)`],
  ['group', `(?:fights?|argues?|quarrels?)\\s+(?:[\\p{L}]+\\s+){0,4}?(?:during|in)\\s+(?:group\\s+work|groups?|pair\\s+work|pairs?)`],
  ['shy', `(?:(?:is|very|rather|quite)\\s+)*(?:shy|withdrawn)`],
  ['reads-above', `(?:(?:is|far|well)\\s+)*ahead\\s+in\\s+reading|reads?\\s+(?:well\\s+|far\\s+)?above\\s+(?:(?:her|his|their|the|grade|class)\\s+){0,2}(?:level|grade|class)`],
  ['reads-below', `(?:(?:is|far|well)\\s+)*behind\\s+in\\s+reading|reads?\\s+(?:well\\s+|far\\s+)?below\\s+(?:(?:her|his|their|the|grade|class)\\s+){0,2}(?:level|grade|class)|struggles?\\s+(?:with|to)\\s+read(?:ing)?`],
  ['homework', `(?:(?:has|have)\\s+)?not\\s+handed\\s+in\\s+(?:[\\p{L}]+\\s+){0,2}?homework(?:\\s+for\\s+[\\p{L}\\p{N}]+\\s+(?:days?|weeks?))?|does\\s+not\\s+(?:do|hand\\s+in)\\s+(?:[\\p{L}]+\\s+){0,2}?homework`],
];
const LEARNING = LEARNING_PATTERNS.map(([kind, source]) => ({ kind, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu') }));

/**
 * Propose learning needs from the note, by rule: things that are no
 * constraint and still matter for teaching. Each is a clause of the note,
 * word for word, with the line for its kind. A sentence that names two
 * children gives one for each. Nothing is confirmed here, and none is
 * told to the cloud: the teacher does both.
 */
export function proposeLearning(note: string, entities: Entity[]): Constraint[] {
  const students = entities.filter((e) => e.kind === 'student');
  const out: Constraint[] = [];
  for (const s of sentences(note)) {
    for (const p of LEARNING) {
      const m = p.re.exec(s.text);
      if (!m) continue;
      const text = m[0].replace(/[\s,]+$/, '');
      const at = s.start + m.index;
      const named = students.filter((x) => wholeWordMatcher(x.surfaces)?.test(s.text));
      const owner = named.length > 0 ? named : students.filter((x) => x.id === ownerAt(note, entities, at, at + text.length));
      // Whose it is must be plain: a need with no child cannot be placed beside anyone.
      for (const child of owner) {
        out.push({ id: `learn-${at}-${p.kind}-${child.id}`, kind: 'learning', learn: p.kind, text, at, about: child.id, aboutName: child.surfaces[0], need: LEARNING_LINE[p.kind], source: 'rule', confirmed: false });
      }
    }
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

const WEEKDAY = /^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)days?$/u;

/** The most characters of a need line. */
export const NEED_LINE_MAX = 120;

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const flat = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').slice(0, NEED_LINE_MAX);

/** True for the kinds whose line for a lesson is the teacher's own: there is no fixed line, and nothing is told until one is typed. */
export const lessonNeedIsTyped = (c: Pick<Constraint, 'kind'>) => c.kind === 'health' || c.kind === 'contact' || c.kind === 'other' || c.kind === 'learning';

/**
 * The need line of a constraint for a lesson, with no child in it. The
 * kinds with a rule have a fixed line. Health, a contact and "other" have
 * none: what would be safe to say is the teacher's decision, so the line
 * is what the teacher typed, or nothing. A learning need starts with the
 * line for its kind, which the teacher can change.
 */
export function lessonNeedLine(c: Constraint): string | undefined {
  switch (c.kind) {
    case 'time-after':
      return 'cannot stay after the last bell';
    case 'time-before':
      return 'cannot come before the first bell';
    case 'days-away':
      return (c.days ?? []).length > 0 ? `away on ${list(c.days!.map((d) => `${d}s`))}` : undefined;
    case 'money':
      return 'nothing that has to be bought or brought from home';
    case 'no-phone-internet':
      return 'no phone or internet at home';
    default:
      return flat(c.need ?? '') || undefined;
  }
}

/** The letter a kind's own line has, so that the same need has the same letter from one lesson to the next. */
const LETTER_OF: Partial<Record<Constraint['kind'] | LearningKind, string>> = {
  'time-after': 'A',
  'no-phone-internet': 'B',
  money: 'C',
  'time-before': 'D',
  'days-away': 'E',
  tests: 'F',
  early: 'G',
  missed: 'H',
  group: 'I',
  shy: 'J',
  'reads-above': 'K',
  'reads-below': 'L',
  homework: 'M',
};
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const FIRST_FREE = 'N';

/** One need as the cloud is told it, and (on the device only) whose it is. */
export interface LessonNeed {
  letter: string;
  /** The line, with no name, no stand-in and no reason. */
  line: string;
  /** The constraints and learning needs behind it. Never sent. */
  constraintIds: string[];
  /** The students who have it, by id in the vault. Never sent. */
  children: string[];
  /** What the exit gate stops in the line. Empty: it may be sent. */
  issues: Violation[];
  /** Words from the sensitive list in the line. They stop it until the teacher ticks "send this need as worded". */
  sensitive: string[];
}

const preferred = (c: Constraint) => (c.kind === 'learning' ? (c.learn && flat(c.need ?? '') === LEARNING_LINE[c.learn] ? LETTER_OF[c.learn] : undefined) : LETTER_OF[c.kind]);

/**
 * The exit gate for one need line of a lesson: what the gate for any need
 * line stops, and any stand-in at all, since this line is about no one.
 * A word from the sensitive list stops it too, unless the teacher has
 * ticked that the line is to be sent as worded.
 */
export function checkLessonNeed(line: string, entities: Entity[], acked: boolean): { issues: Violation[]; sensitive: string[] } {
  const sensitive = sensitiveWords(line);
  const issues = checkNeed(line, entities)
    .filter((v) => !(acked && sensitive.includes(v.what) && v.why.startsWith('a word that gives the reason')))
    // A weekday in the plural ("away on Thursdays") is a day, not a name.
    .filter((v) => !(v.why.startsWith('may be a name') && WEEKDAY.test(v.what)));
  for (const m of line.matchAll(TOKEN_RE)) issues.push({ what: m[0], why: 'a stand-in in a need line: a need for a lesson names no one' });
  return { issues, sensitive };
}

/**
 * The needs the cloud is told for a lesson: every confirmed constraint
 * and learning need that is switched on and has a line. Two children with
 * the same line share one letter. A kind's own line keeps its own letter;
 * any other line takes the next free one.
 */
export function lessonNeeds(constraints: readonly Constraint[], entities: Entity[]): LessonNeed[] {
  const out: LessonNeed[] = [];
  const told = constraints.filter((c) => c.confirmed && c.share && lessonNeedLine(c) !== undefined);
  const taken = new Set(told.map(preferred).filter((l): l is string => l !== undefined));
  let free = LETTERS.indexOf(FIRST_FREE);
  for (const c of told) {
    const line = lessonNeedLine(c)!;
    let need = out.find((n) => n.line.toLowerCase() === line.toLowerCase());
    if (!need) {
      let letter = preferred(c);
      if (!letter || out.some((n) => n.letter === letter)) {
        while (free < LETTERS.length && (taken.has(LETTERS[free]) || out.some((n) => n.letter === LETTERS[free]))) free++;
        letter = LETTERS[free++] ?? `Z${out.length}`;
      }
      need = { letter, line, constraintIds: [], children: [], issues: [], sensitive: [] };
      out.push(need);
    }
    need.constraintIds.push(c.id);
    if (c.about && !need.children.includes(c.about)) need.children.push(c.about);
    const checked = checkLessonNeed(line, entities, Boolean(c.needAck));
    for (const v of checked.issues) if (!need.issues.some((x) => x.what === v.what && x.why === v.why)) need.issues.push(v);
    need.sensitive = [...new Set([...need.sensitive, ...checked.sensitive])];
  }
  return out.sort((a, b) => a.letter.localeCompare(b.letter));
}

/** The line that stands over the needs of a lesson in the outgoing text. */
export const LESSON_NEEDS_HEADING = 'Needs in this class (no names and no reasons are given; a need may be one pupil\'s or several):';

/** A need as it is written in the outgoing text and on the screen. */
export const needLabel = (n: Pick<LessonNeed, 'letter' | 'line'>) => `Need ${n.letter}: ${n.line}`;

/** The outgoing text with the needs of the lesson under their heading. With no need, the text as it is. */
export function withLessonNeeds(text: string, needs: readonly LessonNeed[]): string {
  if (needs.length === 0) return text;
  return `${text}\n\n${LESSON_NEEDS_HEADING}\n${needs.map(needLabel).join('\n')}`;
}

/** The sentence added to the lesson's instruction: the cloud writes a line for a need where a stage needs one. */
export const VARIATION_INSTRUCTION =
  'After each stage, where a listed need changes what a pupil can do in that stage, add one line for that need: "For Need A: <what such a pupil does instead, for the same purpose>". Add a line only where the stage needs it. Do not guess who or how many.';

/** What the cloud wrote for one need at one stage. */
export interface Variation {
  itemIndex: number;
  /** The letter of the need. */
  need: string;
  text: string;
}

const VARIATION = /(?:^|\s)For\s+Need\s+([A-Za-z]{1,2})\s*[:.–-]\s*/giu;

/**
 * Take the lines for needs out of the lesson the cloud returned. The class
 * plan is each stage without them. A line for a letter that was not sent
 * is dropped and counted, as is one with no words. Read strictly: only
 * "For Need <letter>:" begins a line for a need.
 */
export function splitVariations(draft: Draft, letters: readonly string[]): { draft: Draft; variations: Variation[]; dropped: number } {
  const variations: Variation[] = [];
  let dropped = 0;
  const items = draft.items.map((item, itemIndex): DraftItem => {
    const marks = [...item.text.matchAll(VARIATION)];
    if (marks.length === 0) return item;
    marks.forEach((m, i) => {
      const from = m.index + m[0].length;
      const text = item.text.slice(from, i + 1 < marks.length ? marks[i + 1].index : undefined).replace(/\s+/g, ' ').trim();
      const need = m[1].toUpperCase();
      if (text.length === 0 || !letters.includes(need)) dropped++;
      else if (!variations.some((v) => v.itemIndex === itemIndex && v.need === need && v.text === text)) variations.push({ itemIndex, need, text });
    });
    return { heading: item.heading, text: item.text.slice(0, marks[0].index).trim() };
  });
  return { draft: { title: draft.title, items }, variations, dropped };
}

/** The lines for needs under one stage, as the cloud wrote them: "For Need A: …". No name is in them. */
export const variationLine = (v: Variation) => `For Need ${v.need}: ${v.text}`;

/** The class plan with its lines for needs, as text: letters only, no names. This is the part that can be shared. */
export function planWithNeeds(draft: Pick<Draft, 'title'> & { items: readonly DraftItem[] }, variations: readonly Variation[], indexOf: (i: number) => number = (i) => i): string {
  return [draft.title, ...draft.items.map((item, i) => [item.heading, item.text, ...variations.filter((v) => v.itemIndex === indexOf(i)).map(variationLine)].join('\n'))].join('\n\n');
}
