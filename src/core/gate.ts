import type { Entity } from './types';
import { findByRule } from './rules';
import { TOKEN_RE } from './vault';

export interface Violation {
  what: string;
  why: string;
}

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Whole-word search over the text as it will be sent. */
function containsWord(haystack: string, needle: string): boolean {
  const h = flat(haystack);
  const n = flat(needle).trim();
  if (!n) return false;
  let from = 0;
  for (;;) {
    const at = h.indexOf(n, from);
    if (at < 0) return false;
    if (!isWordChar(h[at - 1]) && !isWordChar(h[at + n.length])) return true;
    from = at + 1;
  }
}

/**
 * The exit gate. Text may leave the device only when this returns no
 * violations. It re-checks the outgoing text for every withheld item and
 * for the phone, email and ID patterns, so it catches a redaction mistake.
 * It cannot find a private detail that nobody marked.
 */
export function checkOutgoing(text: string, entities: Entity[]): Violation[] {
  const violations: Violation[] = [];
  for (const e of entities) {
    if (!e.withheld) continue;
    for (const surface of e.surfaces) {
      if (containsWord(text, surface)) {
        violations.push({ what: surface, why: `a withheld ${label(e)} is still in the text` });
        break;
      }
    }
  }
  const allowed = entities.filter((e) => !e.withheld).flatMap((e) => e.surfaces.map(flat));
  for (const hit of findByRule(text)) {
    if (allowed.includes(flat(hit.text))) continue;
    violations.push({ what: hit.text, why: `looks like a ${hit.rule}` });
  }
  return violations;
}

/**
 * The return gate. A reply is flagged when it uses a stand-in that was not
 * in the text the teacher approved, or when it contains anything the exit
 * gate would have stopped.
 *
 * The stand-ins are taken from the approved text, not from the vault: a
 * stand-in the vault holds but the cloud was never sent (for a name inside
 * a withheld private detail, say) is one the cloud model cannot know, so
 * a reply that uses it is not trusted.
 */
export function checkReply(text: string, entities: Entity[], approvedText: string): Violation[] {
  const violations = checkOutgoing(text, entities);
  const sent = new Set(Array.from(approvedText.matchAll(TOKEN_RE), (m) => m[0]));
  const seen = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    if (sent.has(m[0]) || seen.has(m[0])) continue;
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
