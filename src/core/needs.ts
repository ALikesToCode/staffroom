import type { Constraint, Entity } from './types';
import type { Violation } from './gate';
import { checkOutgoing } from './gate';
import { findByRule, findPossibleNames, sensitiveWords, wholeWordMatcher } from './rules';
import { LOOKALIKE_RE, redactWithTokens, RESERVED, TOKEN_RE } from './vault';

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
      if (!c.who) return undefined;
      const their = /\b(?:he|his|him)\b/i.test(c.text) ? 'his' : /\b(?:she|her)\b/i.test(c.text) ? 'her' : 'their';
      if (c.away && c.who === 'parents' && c.guardian) return `Write to ${s}'s guardian, not to ${their} parents.`;
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

/** Everything that would be sent, and whether it may be. */
export interface Outgoing {
  /** The exact text: the redacted note, then the needs. */
  text: string;
  /** Every stand-in written into it, in the note or in a need line. Only these may come back and be restored. */
  tokens: string[];
  /** True when the redacted note has no stand-in in it at all: it is the note as written. */
  noteAsWritten: boolean;
  needs: Need[];
  /** What the exit gate stops, in the note part and in the need lines. Empty: the text may be sent. */
  violations: Violation[];
}

/**
 * Work out the outgoing text: the redacted note, with the needs the
 * teacher chose to tell appended. This is the one place it is made, for
 * the screen and for the moment of sending.
 */
export function outgoingOf(note: string, entities: Entity[], constraints: Constraint[]): Outgoing {
  const redaction = redactWithTokens(note, entities);
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
