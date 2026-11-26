import type { Entity } from './types';
import { findByRule, sameForm, wholeWordMatcher } from './rules';
import { covered, LOOKALIKE_RE, RESERVED } from './vault';

export interface Violation {
  what: string;
  why: string;
}

const flat = sameForm;

/** Whole-word search over the text as it will be sent, whatever way accents and spacing are written. */
function containsWord(haystack: string, needle: string): boolean {
  return wholeWordMatcher([needle])?.test(haystack) ?? false;
}

/**
 * The exit gate. Text may leave the device only when this returns no
 * violations. It re-checks the outgoing text for every withheld item and
 * for the phone, email and ID patterns, so it catches a redaction mistake.
 * It cannot find a private detail that nobody marked.
 *
 * When the raw note is given, it also refuses a withheld item that is
 * nowhere to be found in the note as whole words: such an item is listed
 * in the vault but would redact nothing, so the vault would promise more
 * than the text delivers.
 */
export function checkOutgoing(text: string, entities: Entity[], note?: string): Violation[] {
  const violations: Violation[] = [];
  for (const e of entities) {
    if (!e.withheld && e.category !== RESERVED) continue;
    if (note !== undefined && !wholeWordMatcher(e.surfaces)?.test(note)) {
      violations.push({ what: e.surfaces[0] ?? '', why: 'marked but not found in the text' });
      continue;
    }
    // A stand-in look-alike typed into the note reads the same as a real stand-in, so it cannot be searched
    // for in the outgoing text. The redactor always replaces it, whatever the vault says (see RESERVED).
    if (e.category === RESERVED) continue;
    // A private detail tied to one place may have a twin elsewhere that the teacher released. Its words may
    // then be in the outgoing text, but no more often than they stand released in the note.
    if (note !== undefined && e.at !== undefined) {
      const matcher = () => wholeWordMatcher(e.surfaces)!;
      const released = [...note.matchAll(matcher())].filter((m) => !covered(note, entities, m.index, m.index + m[0].length)).length;
      if ([...text.matchAll(matcher())].length > released) {
        violations.push({ what: e.surfaces[0], why: `a withheld ${label(e)} is still in the text` });
      }
      continue;
    }
    for (const surface of e.surfaces) {
      if (containsWord(text, surface)) {
        violations.push({ what: surface, why: `a withheld ${label(e)} is still in the text` });
        break;
      }
    }
  }
  const allowed = entities.filter((e) => !e.withheld && e.category !== RESERVED).flatMap((e) => e.surfaces.map(flat));
  for (const hit of findByRule(text)) {
    if (allowed.includes(flat(hit.text))) continue;
    violations.push({ what: hit.text, why: `looks like a ${hit.rule}` });
  }
  return violations;
}

/**
 * The return gate. A reply is flagged when it contains anything that looks
 * like a stand-in and is not, character for character, one the redactor
 * wrote into the text the teacher approved; or when it contains anything
 * the exit gate would have stopped.
 *
 * `sentTokens` is the set recorded at approval (see redactWithTokens), not
 * the vault and not a search of the approved text. A stand-in the vault
 * holds but the cloud was never sent, and a malformed one such as
 * "[student 99]" or "[Student99]", are both flagged.
 */
export function checkReply(text: string, entities: Entity[], sentTokens: readonly string[]): Violation[] {
  const violations = checkOutgoing(text, entities);
  const seen = new Set<string>();
  for (const m of text.matchAll(LOOKALIKE_RE)) {
    if (sentTokens.includes(m[0]) || seen.has(m[0])) continue;
    seen.add(m[0]);
    violations.push({ what: m[0], why: 'a stand-in that was not in the text you approved' });
  }
  return violations;
}

function label(e: Entity): string {
  switch (e.kind) {
    case 'student':
      return 'student name';
    case 'adult':
      return 'adult name';
    case 'place':
      return 'place';
    case 'contact':
      return 'contact detail';
    case 'id':
      return 'identity number';
    case 'private':
      return 'private detail';
  }
}
