import type { Constraint, Entity } from './types';
import type { Violation } from './gate';
import { checkOutgoing } from './gate';
import { findByRule, findPossibleNames, sensitiveWords, sentences, wholeWordMatcher } from './rules';
import { LOOKALIKE_RE, PRIVATE_TOKEN, redactWithTokens, RESERVED, TOKEN_RE } from './vault';
import { lessonNeeds, needLabel, withLessonNeeds, type LessonNeed } from './lessonNeeds';

// A confirmed constraint can be told to the cloud as a need, without its reason: "cannot stay after the
// last bell", and not why. The teacher chooses, one constraint at a time. A need line is outgoing text:
// it is shown in the exact text the teacher approves, and it passes the exit gate like the rest.

/** The line that stands over the needs in the outgoing text. */
export const NEEDS_HEADING = 'Needs the teacher has approved (no reasons given):';

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** How the outgoing text refers to a student: by stand-in while the name is withheld, by name once released. */
function refer(student: Entity): string {
  return student.withheld ? student.token : student.surfaces[0];
}

/**
 * The need line for a constraint, built from its kind and never from the
 * teacher's words. Health and "other" have no fixed line: what would be
 * safe to say depends on the condition. A constraint about no one student
 * has none either.
 */
export function needTemplate(c: Constraint, entities: Entity[]): string | undefined {
  const student = entities.find((e) => e.id === c.about && e.kind === 'student');
  if (!student) return undefined;
  const s = refer(student);
  switch (c.kind) {
    case 'time-after':
      return `${s} cannot stay after the last bell.`;
    case 'time-before':
      return `${s} cannot come before the first bell.`;
    case 'days-away':
      return (c.days ?? []).length > 0 ? `${s} is away on ${list(c.days!.map((d) => `${d}s`))}.` : undefined;
    case 'money':
      return `${s}'s family cannot pay for anything extra.`;
    case 'no-phone-internet':
      return `${s} has no phone or internet at home.`;
    case 'contact': {
      // Only who looks after the child: messages go to that adult, and no one is named as not to contact.
      if (!c.who) return c.guardian ? `Write to ${s}'s guardian.` : undefined;
      const their = /\b(?:he|his|him)\b/i.test(c.text) ? 'his' : /\b(?:she|her)\b/i.test(c.text) ? 'her' : 'their';
      if (c.away && c.guardian) return `Write to ${s}'s guardian, not to ${their} ${c.who}.`;
      return `Do not contact ${s}'s ${c.who}.`;
    }
    default:
      return undefined;
  }
}

/** True for the kinds whose need line is the teacher's own: there is no fixed line for them. */
export function needIsTyped(c: Constraint): boolean {
  return c.kind === 'health' || c.kind === 'other';
}

/**
 * The need line as it would be sent. For health and "other" it is what the
 * teacher typed, with every name and number the vault holds replaced by
 * its stand-in. For the other kinds it is the fixed line.
 */
export function needLine(c: Constraint, entities: Entity[]): string | undefined {
  // A learning need is told for a lesson only, as a line with no child in it: see lessonNeeds.
  if (c.kind === 'learning') return undefined;
  if (!needIsTyped(c)) return needTemplate(c, entities);
  const typed = (c.need ?? '').replace(/\s+/g, ' ').trim();
  if (typed.length === 0) return undefined;
  // Private details are tied to places in the note, not in this line. They are looked for by the gate below.
  return redactWithTokens(typed, entities.filter((e) => e.kind !== 'private' && !e.span)).text;
}

/**
 * The exit gate for one need line. It may hold stand-ins from the vault.
 * It may not hold a withheld item of any kind, a name, a phone number,
 * email or identity number, the marker for a withheld detail, a stand-in
 * the vault does not have, a capitalised word that may be a name, or a
 * word from the sensitive list: a need is told without its reason.
 */
export function checkNeed(line: string, entities: Entity[]): Violation[] {
  const out: Violation[] = [];
  const where = 'in a need line';
  for (const e of entities) {
    if (!e.withheld && e.category !== RESERVED) continue;
    const found = e.surfaces.find((s) => wholeWordMatcher([s])?.test(line));
    if (found && e.category !== RESERVED) out.push({ what: found, why: `a withheld item, ${where}` });
  }
  for (const hit of findByRule(line)) out.push({ what: hit.text, why: `looks like a ${hit.rule}, ${where}` });
  const known = new Set(entities.filter((e) => e.kind !== 'private').map((e) => e.token));
  for (const m of line.matchAll(LOOKALIKE_RE)) {
    if (!known.has(m[0])) out.push({ what: m[0], why: `not a stand-in from your vault, ${where}` });
  }
  // A name the vault does not hold cannot be told from any other capitalised word, so each is stopped.
  for (const hit of findPossibleNames(line.replace(LOOKALIKE_RE, ' '), [])) {
    out.push({ what: hit.text, why: `may be a name, ${where}: use the stand-in, or write the word without a capital if it is not a name` });
  }
  for (const word of sensitiveWords(line)) out.push({ what: word, why: `a word that gives the reason, ${where}: a need is told without its reason` });
  return out;
}

/** One need that will be told: whose constraint, the line, and what the gate found in it. */
export interface Need {
  id: string;
  line: string;
  issues: Violation[];
}

/** The needs the teacher chose to tell: confirmed, switched on, and with a line to send. In the order of the constraints. */
export function sharedNeeds(constraints: Constraint[], entities: Entity[]): Need[] {
  const out: Need[] = [];
  for (const c of constraints) {
    if (!c.confirmed || !c.share) continue;
    const line = needLine(c, entities);
    if (!line) continue;
    out.push({ id: c.id, line, issues: checkNeed(line, entities) });
  }
  return out;
}

/** The outgoing text with the need lines under their heading. With no need, the text as it is. */
export function withNeeds(text: string, lines: string[]): string {
  const unique = [...new Set(lines)];
  if (unique.length === 0) return text;
  return `${text}\n\n${NEEDS_HEADING}\n${unique.map((l) => `- ${l}`).join('\n')}`;
}

/** He or she: a sentence that says it is about one person, most likely one pupil or a pupil's parent. */
const ONE_PERSON = /(?<![\p{L}])(?:he|she|him|his|her|hers|himself|herself)(?![\p{L}])/iu;

/** A sentence with a withheld detail and fewer words than this besides its stand-ins ("[withheld] to [Place 1] and [withheld].") is a fragment about one pupil. */
const MOSTLY_WITHHELD = 4;
const wordsBesideStandIns = (s: string) => s.split(PRIVATE_TOKEN).join(' ').replace(TOKEN_RE, ' ').match(/\p{L}+/gu)?.length ?? 0;

/** Said under the exact text of a lesson: how many sentences of the note stay here. A count only. */
export const notSentLine = (n: number) => `Not sent: ${n} ${n === 1 ? 'sentence' : 'sentences'} about one pupil. Their needs go by letter.`;

/**
 * For a lesson, the redacted note keeps only what is about the class. A
 * sentence is not sent when it holds the stand-in of a pupil, an adult, a
 * contact or an identity number, or a pupil's or adult's name the teacher
 * released; when it says he or she; or when it is withheld items with
 * fewer than four other words ("[withheld] to [Place 1] and [withheld].").
 * What the cloud needs about one pupil goes as a need, by letter.
 * The note keeps its lines and paragraphs; a sentence that is kept is
 * kept character for character.
 */
export function classSentences(redacted: string, entities: Entity[]): { text: string; notSent: number } {
  const ofOne = entities.filter((e) => e.kind !== 'place' && e.kind !== 'private');
  const tokens = ofOne.filter((e) => e.withheld).map((e) => e.token);
  const names = wholeWordMatcher(ofOne.filter((e) => !e.withheld && (e.kind === 'student' || e.kind === 'adult')).flatMap((e) => e.surfaces));
  const aboutOne = (s: string) =>
    tokens.some((t) => s.includes(t)) ||
    (names?.test(s) ?? false) ||
    ONE_PERSON.test(s) ||
    (s.includes(PRIVATE_TOKEN) && wordsBesideStandIns(s) < MOSTLY_WITHHELD);
  let notSent = 0;
  const paragraphs = redacted.split(/\n[ \t]*\n/).map((para) =>
    para
      .split('\n')
      .map((line) => {
        const kept: string[] = [];
        for (const s of sentences(line)) {
          const whole = s.text + (/^[.!?]*/.exec(line.slice(s.end))?.[0] ?? '');
          if (aboutOne(s.text)) notSent++;
          else kept.push(whole);
        }
        return kept.join(' ');
      })
      .filter(Boolean)
      .join('\n'),
  );
  return { text: paragraphs.filter(Boolean).join('\n\n'), notSent };
}

/** Everything that would be sent, and whether it may be. */
export interface Outgoing {
  /** The exact text: the redacted note, then the needs. */
  text: string;
  /** Every stand-in written into it, in the note or in a need line. Only these may come back and be restored. */
  tokens: string[];
  /** True when not one stand-in was written into the note part: what is sent of the note is as written. For a lesson, sentences may still be left out (notSent). */
  noteAsWritten: boolean;
  /** For a lesson: how many sentences of the note were left out because they are about one pupil. Absent for the other tasks. */
  notSent?: number;
  needs: Need[];
  /** For a lesson: the needs by letter, with (on the device only) whose each is. Absent for the other tasks. */
  lessonNeeds?: LessonNeed[];
  /** What the exit gate stops, in the note part and in the need lines. Empty: the text may be sent. */
  violations: Violation[];
}

/**
 * Work out the outgoing text: the redacted note, with the needs the
 * teacher chose to tell appended. This is the one place it is made, for
 * the screen and for the moment of sending. For a lesson the note keeps
 * only its sentences about the class (see classSentences).
 */
export function outgoingOf(note: string, entities: Entity[], constraints: Constraint[], lesson = false): Outgoing {
  const redaction = redactWithTokens(note, entities);
  if (lesson) {
    // A lesson is told its needs by letter, with no child in any line, and no sentence about one pupil. Whose each need is stays here.
    const byLetter = lessonNeeds(constraints, entities);
    const kept = classSentences(redaction.text, entities);
    return {
      text: withLessonNeeds(kept.text, byLetter),
      // Only the stand-ins that are still in the text may come back.
      tokens: redaction.tokens.filter((t) => kept.text.includes(t)),
      // Leaving a sentence out withholds nothing from the sentences that are sent, so they still need the as-written tick.
      noteAsWritten: redaction.tokens.length === 0,
      notSent: kept.notSent,
      // One entry for each constraint behind a need, so that a rule hit can say the cloud was told it.
      needs: byLetter.flatMap((n) => n.constraintIds.map((id) => ({ id, line: needLabel(n), issues: n.issues }))),
      lessonNeeds: byLetter,
      violations: [...checkOutgoing(kept.text, entities, note), ...byLetter.flatMap((n) => n.issues)],
    };
  }
  const needs = sharedNeeds(constraints, entities);
  const tokens = new Set(redaction.tokens);
  const known = new Set(entities.filter((e) => e.kind !== 'private' && e.withheld).map((e) => e.token));
  for (const n of needs) for (const m of n.line.matchAll(TOKEN_RE)) if (known.has(m[0])) tokens.add(m[0]);
  return {
    text: withNeeds(redaction.text, needs.map((n) => n.line)),
    tokens: [...tokens],
    noteAsWritten: redaction.tokens.length === 0,
    needs,
    violations: [...checkOutgoing(redaction.text, entities, note), ...needs.flatMap((n) => n.issues)],
  };
}
