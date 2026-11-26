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
  // From an exit ticket. The line in use names the topic: see ticket.ts.
  'ticket-not': 'has not yet got the last topic; needs it taught again another way',
  'ticket-quick': 'got the last topic quickly; needs a harder task',
  'ticket-absent': 'was absent for the last topic',
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
  'ticket-not': 'J',
  'ticket-quick': 'K',
  'ticket-absent': 'L',
  homework: 'M',
  shy: 'N',
  'reads-above': 'O',
  'reads-below': 'P',
};
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const FIRST_FREE = 'Q';

/** One need as the cloud is told it, and (on the device only) whose it is. */
export interface LessonNeed {
  letter: string;
  /** The line, with no name, no stand-in and no reason. */
  line: string;
  /** The constraints and learning needs behind it. Never sent. */
  constraintIds: string[];
  /** The students who have it, by id in the vault. Never sent. */
  children: string[];
  /** Children who have it and are not in the note, by their name on the class list (from an exit ticket). Never sent. */
  others: string[];
  /** What the exit gate stops in the line. Empty: it may be sent. */
  issues: Violation[];
  /** Words from the sensitive list in the line. They stop it until the teacher ticks "send this need as worded". */
  sensitive: string[];
}

const preferred = (c: Constraint) =>
  c.kind === 'learning' ? (c.learn && (c.learn.startsWith('ticket-') || flat(c.need ?? '') === LEARNING_LINE[c.learn]) ? LETTER_OF[c.learn] : undefined) : LETTER_OF[c.kind];

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
      need = { letter, line, constraintIds: [], children: [], others: [], issues: [], sensitive: [] };
      out.push(need);
    }
    need.constraintIds.push(c.id);
    if (c.about && !need.children.includes(c.about)) need.children.push(c.about);
    if (!c.about && c.childName && !need.others.includes(c.childName)) need.others.push(c.childName);
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

/** The heading of the last item of a lesson: the section where the cloud answers every need it was told. */
export const NEEDS_SECTION = 'For each need';

/** The line under the needs that lists the letters the cloud must answer. It is part of the text the teacher approves. */
export const needsAsk = (letters: readonly string[]) => `Under "${NEEDS_SECTION}", give an entry for every one of these letters: ${letters.join(', ')}.`;

/** The outgoing text with the needs of the lesson under their heading, and the letters that must be answered. With no need, the text as it is. */
export function withLessonNeeds(text: string, needs: readonly LessonNeed[]): string {
  if (needs.length === 0) return text;
  return `${text}\n\n${LESSON_NEEDS_HEADING}\n${needs.map(needLabel).join('\n')}\n${needsAsk(needs.map((n) => n.letter))}`;
}

/** The sentences added to the lesson's instruction: the cloud answers every listed need, in one section after the stages. */
export const VARIATION_INSTRUCTION =
  'If the notes list needs, the stages say nothing about them. After the stages, add one last item with the heading "For each need". Its text has an entry for every listed need, each on its own line, in exactly this form: "Need A | <stage name> | <one or two sentences: what such a pupil does in that stage instead, for the same purpose>". If the lesson already suits a need, write "Need A | none | This lesson already suits this need." A need may have two entries, for two stages. Every listed letter must appear. Do not guess who or how many.';

/** The sentence added to the lesson's instruction for a plan in another language. The stage names and the marker stay in English so that the plan can still be read by the parser. */
export const LANGUAGE_INSTRUCTION =
  'If the lesson lines give a "Language of the plan", write the title, the text of every stage and the text of every entry for a need in that language, in its own script (Hindi in Devanagari). Keep in English the stage names in the headings and in the entries (Starter, Teach, Practise, Check, Homework), the minutes, the heading "For each need", and "Need A |" and "none" in the entries.';

/** The sentence added to the instruction for messages home in another language. */
export const MESSAGES_LANGUAGE_INSTRUCTION = 'If the notes end with a "Language of the messages" line, write every note home in that language, in its own script (Hindi in Devanagari).';

/** What the cloud wrote for one need at one stage. */
export interface Variation {
  itemIndex: number;
  /** The letter of the need. */
  need: string;
  text: string;
}

const INLINE = /(?:^|\s)For\s+Need\s+([A-Za-z]{1,2})\s*[:.–-]\s*/giu;
const ENTRY = /(?:^|\s)Need\s+([A-Za-z]{1,2})\s*\|\s*([^|\n]*?)\s*\|[ \t]*/gu;
const isSection = (heading: string) => heading.replace(/[\s:.]+$/, '').trim().toLowerCase() === NEEDS_SECTION.toLowerCase();
const stageKey = (s: string) => s.replace(/\[[^\]]*\]/g, '').replace(/\s*[(\[–—:-]\s*\d+\s*min(?:ute)?s?\.?\s*[)\]]?\s*$/iu, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The most entries one need may have: one for each of two stages. */
export const NEED_ENTRIES_MAX = 2;

/** What was read of the section "For each need". */
export interface NeedsReading {
  /** The class plan: the reply without the section. */
  draft: Draft;
  variations: Variation[];
  /** Entries left out: an unknown letter, an unknown stage, no words, or a third entry for one need. */
  dropped: number;
  /** The needs the cloud says the lesson already suits. */
  none: string[];
  /** The needs that were told and have no entry at all. */
  missing: string[];
  /** The section as the cloud returned it. Empty when there was none. */
  section: string;
}

/**
 * Take the section "For each need" out of the lesson the cloud returned
 * and read it strictly. The class plan is the stages. An entry is "Need
 * <letter> | <stage name> | <text>"; its stage must be a stage of this
 * lesson by name, or "none". An entry for a letter that was not sent or a
 * stage that is not there, one with no words, and a third for the same
 * need are dropped and counted. A need that was told and has no entry is
 * listed as missing.
 */
export function splitVariations(draft: Draft, letters: readonly string[]): NeedsReading {
  const at = draft.items.map((i) => isSection(i.heading)).lastIndexOf(true);
  const items = draft.items.filter((_, i) => i !== at);
  const section = at < 0 ? '' : draft.items[at].text.trim();
  const variations: Variation[] = [];
  const none: string[] = [];
  let dropped = 0;
  const marks = [...section.matchAll(ENTRY)];
  marks.forEach((m, i) => {
    const text = section.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).replace(/\s+/g, ' ').trim();
    const need = m[1].toUpperCase();
    const stage = stageKey(m[2]);
    if (!letters.includes(need)) return void dropped++;
    if (stage === 'none') return void (none.includes(need) || none.push(need));
    const itemIndex = stage === '' ? -1 : items.findIndex((item) => stageKey(item.heading) === stage);
    if (itemIndex < 0 || text.length === 0 || variations.filter((v) => v.need === need).length >= NEED_ENTRIES_MAX) return void dropped++;
    if (!variations.some((v) => v.itemIndex === itemIndex && v.need === need)) variations.push({ itemIndex, need, text });
  });
  const answered = new Set(variations.map((v) => v.need));
  const suits = none.filter((n) => !answered.has(n));
  return {
    draft: { title: draft.title, items },
    variations: variations.sort((a, b) => a.itemIndex - b.itemIndex),
    dropped,
    none: suits,
    missing: letters.filter((l) => !answered.has(l) && !suits.includes(l)),
    section,
  };
}

/** True when so many needs went unanswered that the cloud is asked once more: over a third of those told. */
export const askAgain = (missing: readonly string[], letters: readonly string[]) => missing.length * 3 > letters.length;

/** The text of the second request: the same approved text, and the letters still to answer. */
export const secondAsk = (approved: string, missing: readonly string[]) => `${approved}\n\nWrite the entries for: ${missing.join(', ')}`;

/** Put the entries of a second reply with the first, for the letters that were missing only. The class plan stays the first reply's. */
export function withSecondReading(first: NeedsReading, second: Draft): NeedsReading {
  const more = splitVariations(second, first.missing);
  // The second reply may name its stages differently; an entry counts only for a stage of the first plan.
  const byName = more.variations
    .map((v) => ({ ...v, itemIndex: first.draft.items.findIndex((item) => stageKey(item.heading) === stageKey(more.draft.items[v.itemIndex]?.heading ?? '')) }))
    .filter((v) => v.itemIndex >= 0);
  const answered = new Set(byName.map((v) => v.need));
  return {
    ...first,
    variations: [...first.variations, ...byName].sort((a, b) => a.itemIndex - b.itemIndex),
    dropped: first.dropped + more.dropped + (more.variations.length - byName.length),
    none: [...first.none, ...more.none.filter((n) => !answered.has(n))],
    missing: first.missing.filter((l) => !answered.has(l) && !more.none.includes(l)),
    section: [first.section, more.section].filter(Boolean).join('\n'),
  };
}

/** A need entry as the section has it. */
export const entryLine = (v: Variation, stage: string) => `Need ${v.need} | ${stage} | ${v.text}`;

/**
 * A reply written in the earlier form, with "For Need A: …" inside the
 * stages, turned into the form with a section. The fixed sets were written
 * in the earlier form; this carries each of their lines over as it is.
 */
export function inlineToSection(draft: Draft): Draft {
  const entries: string[] = [];
  const items = draft.items.map((item): DraftItem => {
    const marks = [...item.text.matchAll(INLINE)];
    if (marks.length === 0) return item;
    marks.forEach((m, i) => entries.push(`Need ${m[1]} | ${stageKey(item.heading)} | ${item.text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim()}`));
    return { heading: item.heading, text: item.text.slice(0, marks[0].index).trim() };
  });
  return { title: draft.title, items: entries.length > 0 ? [...items, { heading: NEEDS_SECTION, text: entries.join('\n') }] : items };
}

/** The lines for needs under one stage, as the cloud wrote them: "For Need A: …". No name is in them. */
export const variationLine = (v: Variation) => `For Need ${v.need}: ${v.text}`;

/** The class plan with its lines for needs, as text: letters only, no names. This is the part that can be shared. */
export function planWithNeeds(draft: Pick<Draft, 'title'> & { items: readonly DraftItem[] }, variations: readonly Variation[], indexOf: (i: number) => number = (i) => i): string {
  return [draft.title, ...draft.items.map((item, i) => [item.heading, item.text, ...variations.filter((v) => v.itemIndex === indexOf(i)).map(variationLine)].join('\n'))].join('\n\n');
}
