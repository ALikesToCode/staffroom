import type { Entity } from './types';
import { findByRule, sameForm, sensitiveWords, wholeWordMatcher } from './rules';
import { bareNotSent, covered, LOOKALIKE_RE, RESERVED, spanHolds } from './vault';

export interface Violation {
  what: string;
  why: string;
  /** A whole sentence to show in place of `what` and `why`, when there is one. */
  say?: string;
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
 * than the text delivers. And it refuses to pass unless every character
 * of every hand-marked occurrence (an item with offsets) is held back.
 */
export function checkOutgoing(text: string, entities: Entity[], note?: string): Violation[] {
  const violations: Violation[] = [];
  for (const e of entities) {
    if (!e.withheld && e.category !== RESERVED) continue;
    // An occurrence the teacher marked by hand has offsets. Every character between them must be held back.
    // Its words may stand elsewhere in the note unmarked, so the outgoing text is not searched for them.
    if (e.span) {
      if (note === undefined) continue;
      if (!spanHolds(note, e)) violations.push({ what: e.surfaces[0] ?? '', why: 'marked but not found in the text' });
      else if (!covered(note, entities, e.span.start, e.span.end)) {
        violations.push({ what: e.surfaces[0], why: `a withheld ${label(e)} is still in the text` });
      }
      continue;
    }
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
  // A pattern hit is let through only when the teacher released that very item: the same text and the same
  // kind. Releasing an identity number does not release the phone number written with the same digits.
  const allowed = entities
    .filter((e) => !e.withheld && e.category !== RESERVED)
    .flatMap((e) => e.surfaces.map((s) => `${e.kind}:${flat(s)}`));
  for (const hit of findByRule(text)) {
    if (allowed.includes(`${hit.kind}:${flat(hit.text)}`)) continue;
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
 * It is also flagged when it uses a word from the sensitive list that
 * `approvedText`, the text the teacher approved, did not have.
 *
 * A stand-in written without its brackets ("Student 9") is treated the
 * same way.
 *
 * `sentTokens` is the set recorded at approval (see redactWithTokens), not
 * the vault and not a search of the approved text. A stand-in the vault
 * holds but the cloud was never sent, and a malformed one such as
 * "[student 99]" or "[Student99]", are both flagged.
 */
export function checkReply(text: string, entities: Entity[], sentTokens: readonly string[], approvedText: string): Violation[] {
  const violations = checkOutgoing(text, entities);
  const seen = new Set<string>();
  for (const m of text.matchAll(LOOKALIKE_RE)) {
    if (sentTokens.includes(m[0]) || seen.has(m[0])) continue;
    seen.add(m[0]);
    violations.push({ what: m[0], why: 'a stand-in that was not in the text you approved' });
  }
  // A stand-in written without brackets counts as one too. If its bracketed form was sent it is read as that
  // stand-in (see bracketBare); if not, it is flagged like any other the cloud was never given.
  for (const bare of bareNotSent(text, sentTokens)) {
    violations.push({ what: bare, why: 'a stand-in that was not in the text you approved' });
  }
  // The sensitive-word list is run over the reply as well. A word from it that the approved text did not
  // have is something the cloud model brought in itself, so the teacher is asked to read it.
  const stem = (w: string) => w.replace(/s$/, '');
  const approved = new Set(sensitiveWords(approvedText).map(stem));
  for (const word of sensitiveWords(text)) {
    if (approved.has(stem(word))) continue;
    violations.push({
      what: word,
      why: 'a sensitive word that was not in the text you approved',
      say: `The reply mentions ${word}, which was not in the text you approved.`,
    });
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
