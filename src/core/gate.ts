import type { Entity } from './types';
import { findByRule } from './rules';
import { TOKEN_RE } from './vault';

export interface Violation {
  what: string;
  why: string;
}

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Whole-word search without regular expressions, so it shares no code with the redactor. */
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
 * violations. It is deliberately a second, independent check: it does not
 * trust that the redactor did its job.
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
 * The return gate. A reply is flagged when it uses a stand-in the vault does
 * not know, or when it contains anything the exit gate would have stopped.
 */
export function checkReply(text: string, entities: Entity[]): Violation[] {
  const violations = checkOutgoing(text, entities);
  const known = new Set(entities.map((e) => e.token));
  for (const m of text.matchAll(TOKEN_RE)) {
    if (!known.has(m[0])) violations.push({ what: m[0], why: 'a stand-in that is not in your vault' });
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
