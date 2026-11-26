import type { Constraint, DraftItem, Entity, ItemCheck } from './types';
import { combineChecks, ruleCheckItem } from './conflicts';
import { steps } from './items';
import { wholeWordMatcher } from './rules';
import { restore } from './vault';

// Checking a draft again on the device, after the teacher rewrote a step or switched a constraint off or on.
// Only the rule layer runs here: no model is asked and nothing is sent. What the on-device model said in the
// first check is carried over for items whose text has not changed.

/** Said under an item the teacher rewrote, when no rule fires on it. */
export const REWRITTEN_CLEAR = 'Rewritten by you. No conflict found by rule.';
/** Said under an item the teacher rewrote, when no confirmed constraint applies to it. */
export const REWRITTEN_UNCOMPARED = 'Rewritten by you. No constraint you confirmed applies to it, so no rule compared it.';
/** Said under an item no rule compared and no model checked. */
export const UNCOMPARED = 'No constraint you confirmed applies to this item, so no rule compared it. Read it yourself.';

/**
 * The step of an item that a rule matched, as the teacher reads it (names
 * put back). With no match, or when the matched words are not found, the
 * whole text: the teacher then rewrites the item.
 */
export function stepToRewrite(item: DraftItem, entities: Entity[], allowed: readonly string[], matched?: string): { step: string; whole: boolean } {
  const text = restore(item.text, entities, allowed).trim();
  const parts = steps(text);
  const found = matched ? parts.find((p) => p.toLowerCase().includes(matched.toLowerCase())) : undefined;
  // A step is a trimmed piece of the text. If it cannot be found again as written, the whole text is rewritten.
  if (!found || parts.length <= 1 || !text.includes(found)) return { step: text, whole: true };
  return { step: found, whole: false };
}

/** The most characters of a suggestion the on-device model makes for one step. */
export const SUGGESTION_MAX = 300;

/** Which step of the item this is, counted from 0 among its steps as the teacher reads them. 0 for the whole item. */
export function stepIndexOf(item: DraftItem, step: string, entities: Entity[], allowed: readonly string[]): number {
  return Math.max(0, steps(restore(item.text, entities, allowed).trim()).indexOf(step));
}

/**
 * Write the names in a text back as the stand-ins that were sent, so the
 * rewritten item is read like the rest of the draft. A name whose stand-in
 * was not in the approved text stays as typed.
 */
export function standInsFor(text: string, entities: Entity[], allowed: readonly string[]): string {
  const named = entities
    .filter((e) => e.kind !== 'private' && e.withheld && allowed.includes(e.token))
    .flatMap((e) => e.surfaces.map((surface) => ({ surface, token: e.token })))
    .sort((a, b) => b.surface.length - a.surface.length);
  let out = text;
  for (const { surface, token } of named) {
    const re = wholeWordMatcher([surface]);
    if (re) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), token);
  }
  return out;
}

/**
 * Replace one step of an item with the teacher's own words. Nothing is
 * sent: the item changes on this device only. The heading stays, so the
 * item is still about the same student.
 */
export function rewriteStep(item: DraftItem, step: string, replacement: string, entities: Entity[], allowed: readonly string[]): DraftItem {
  const text = restore(item.text, entities, allowed).trim();
  const typed = replacement.trim().replace(/\s+/g, ' ');
  const next = text === step || !text.includes(step) ? typed : text.replace(step, () => typed);
  return { heading: item.heading, text: standInsFor(next.trim(), entities, allowed) };
}

/** What the on-device model said about an item in the first check, read back from that check's verdict. Undefined: not known. */
export function modelSaid(first: ItemCheck | undefined): ItemCheck | undefined {
  if (!first) return undefined;
  if (first.by === 'both' && first.also) return { verdict: 'unsure', reason: first.also, by: 'model' };
  // A rule hit hides what the model said, unless the model had a doubt too.
  if (first.constraintId) return undefined;
  if (first.verdict === 'fits' || first.verdict === 'unsure') return { verdict: first.verdict, reason: first.reason, by: first.by };
  return undefined;
}

/**
 * Check every item again by rule against the constraints as they stand now.
 *
 * - `constraints`: the constraints of the run; one the teacher switched off is not confirmed here.
 * - `model`: what the on-device model answered for each item in the first check, when that is known.
 *   It is carried over, never asked again, and dropped for an item the teacher rewrote.
 * - `rewritten`: true for an item whose text the teacher changed.
 */
export function recheckItems(
  items: DraftItem[],
  constraints: Constraint[],
  entities: Entity[],
  allowed: readonly string[],
  note: string,
  told: ReadonlyMap<string, string>,
  model: readonly (ItemCheck | undefined)[],
  rewritten: readonly boolean[],
): ItemCheck[] {
  return items.map((item, i) => {
    const rule = ruleCheckItem(item, constraints, entities, allowed, note, told);
    const uncompared: ItemCheck = { verdict: 'not checked', reason: UNCOMPARED, by: 'none', rules: 0 };
    if (!rewritten[i]) return combineChecks(rule, model[i], uncompared);
    if (rule.hit) return combineChecks(rule, undefined, uncompared);
    return { verdict: 'not checked', reason: rule.compared > 0 ? REWRITTEN_CLEAR : REWRITTEN_UNCOMPARED, by: 'none', rules: rule.compared };
  });
}

/**
 * Keep, strike or leave open, after a new check. An item now in conflict is
 * struck, whatever it was. An item that was struck only because of a
 * conflict that is gone, and a kept item the rules now query, are open
 * again: the teacher chooses. Nothing becomes kept here.
 */
export function keptAfterRecheck(kept: readonly (boolean | null)[], before: readonly ItemCheck[], after: readonly ItemCheck[]): (boolean | null)[] {
  return after.map((now, i) => {
    const was = before[i]?.verdict;
    const k = kept[i] ?? null;
    if (now.verdict === 'conflict') return false;
    if (was === 'conflict' && k === false) return null;
    if (now.verdict === 'unsure' && was !== 'unsure' && k === true) return null;
    return k;
  });
}
