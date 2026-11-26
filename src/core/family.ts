import type { DraftItem, Entity } from './types';
import { listedParts, nameWords, sameForm, wholeWordMatcher } from './rules';
import { WITHHELD_MARK } from './gate';
import { bareNotSent, LOOKALIKE_RE, restore, segment } from './vault';

/** Whose family a message home is for, or why the app cannot tell. */
export interface Family {
  /** The one student the message names. */
  student?: Entity;
  /** Said in place of the copy button when there is not exactly one, or the message carries another child's details. */
  why?: string;
}

/** Said in place of the copy button on a rewritten message that repeats words of the private note, until the teacher turns copy on. */
export const COPY_OFF_REPEATS = 'Copy is off: this rewrite repeats words from your private note.';

/**
 * The family copy of a rewritten message. When the rewrite repeats words
 * of the private note, copy starts off and the teacher may turn it on for
 * that one message. A message whose copy is off for another reason stays
 * off: that cannot be turned on.
 */
export function familyAfterRewrite(family: Family, repeats: boolean, turnedOn: boolean): Family & { mayTurnOn?: true } {
  if (!family.student || !repeats || turnedOn) return family;
  return { why: COPY_OFF_REPEATS, mayTurnOn: true };
}

const names = (list: Entity[]) => list.map((e) => e.surfaces[0]).join(' and ');

/** True when the text has this item in it: by its stand-in, or by its own words when the teacher released it. */
function mentions(text: string, e: Entity, sent: readonly string[]): boolean {
  if (e.withheld) return sent.includes(e.token) && text.includes(e.token);
  return wholeWordMatcher(e.surfaces)?.test(text) ?? false;
}

/**
 * The students a contact detail or identity number belongs to, as far as
 * the note says: for each place it stands, the student named nearest before
 * it in the same paragraph. `undefined` in the result means a place where
 * no student is named before it.
 */
export function ownersOf(note: string, entities: Entity[], detail: Entity): (Entity | undefined)[] {
  const owners = new Set<Entity | undefined>();
  let last: Entity | undefined;
  for (const s of segment(note, entities)) {
    if (s.entity === detail) owners.add(last);
    else if (s.entity?.kind === 'student') last = s.entity;
    else if (!s.entity && s.text.includes('\n')) last = undefined;
  }
  return [...owners];
}

/**
 * A message home is for one family. This finds the one student an item
 * names, and then reads the exact text that would be copied: the item's
 * text with the names put back. Copying is refused when
 *
 * - the item names no student, or several;
 * - it repeats the marker "[withheld]", or has a stand-in that was never sent;
 * - the text to be copied has another student's name in it, whether that
 *   student is in the vault or only on the class list, and whether it is
 *   written out or as a stand-in;
 * - it carries an adult, a place, a contact detail or an identity number
 *   that the note does not tie to that student.
 *
 * None of this depends on the teacher having read a flagged reply: ticking
 * that box does not turn copying back on.
 */
export function familyFor(item: DraftItem, note: string, entities: Entity[], sent: readonly string[], classList: readonly string[] = []): Family {
  const text = `${item.heading}\n${item.text}`;
  const students = entities.filter((e) => e.kind === 'student' && mentions(text, e, sent));
  if (students.length === 0) {
    return { why: 'Copy is off: this message names no student, so the app cannot tell whose family it is for.' };
  }
  if (students.length > 1) {
    return { why: `Copy is off: this message names more than one student (${names(students)}). A message home goes to one family.` };
  }
  const student = students[0];
  if (WITHHELD_MARK.test(text)) {
    return { why: 'Copy is off: this message repeats the marker [withheld], so something may be missing from it.' };
  }
  const strange = [...text.matchAll(LOOKALIKE_RE)].some((m) => !sent.includes(m[0])) || bareNotSent(text, sent).length > 0;
  if (strange) return { why: 'Copy is off: this message has a stand-in that was not in the text you approved.' };

  // The text as it would be copied, names put back.
  const copied = restore(item.text, entities, sent);
  const own = new Set(student.surfaces.flatMap((s) => [sameForm(s), ...nameWords(s).map(sameForm)]));
  const others = [
    ...entities.filter((e) => e.kind === 'student' && e !== student).flatMap((e) => e.surfaces),
    ...classList.flatMap((name) => [name, ...listedParts(name)]),
  ].filter((s) => !own.has(sameForm(s)));
  const other = wholeWordMatcher(others)?.exec(copied);
  if (other) {
    return { why: `Copy is off: this message has another student's name in it (${other[0]}). A message home goes to one family.` };
  }
  for (const detail of entities.filter((e) => e.kind !== 'student' && e.kind !== 'private' && mentions(text, e, sent))) {
    const owners = ownersOf(note, entities, detail);
    if (owners.length !== 1 || owners[0] !== student) {
      const what = detail.kind === 'adult' || detail.kind === 'place' ? 'a person or a place' : 'a contact detail or an identity number';
      return { why: `Copy is off: this message includes ${what} that your note does not tie to ${student.surfaces[0]}.` };
    }
  }
  return { student };
}
