import type { DraftItem, Entity } from './types';
import { wholeWordMatcher } from './rules';
import { bareNotSent, LOOKALIKE_RE, segment } from './vault';

/** Whose family a message home is for, or why the app cannot tell. */
export interface Family {
  /** The one student the message names. */
  student?: Entity;
  /** Said in place of the copy button when there is not exactly one, or the message carries another child's details. */
  why?: string;
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
 * names. It refuses when the item names none or several, when it has a
 * stand-in that was never sent, and when it carries a contact detail or an
 * identity number that the note does not tie to that student.
 */
export function familyFor(item: DraftItem, note: string, entities: Entity[], sent: readonly string[]): Family {
  const text = `${item.heading}\n${item.text}`;
  const students = entities.filter((e) => e.kind === 'student' && mentions(text, e, sent));
  if (students.length === 0) {
    return { why: 'Copy is off: this message names no student, so the app cannot tell whose family it is for.' };
  }
  if (students.length > 1) {
    return { why: `Copy is off: this message names more than one student (${names(students)}). A message home goes to one family.` };
  }
  const student = students[0];
  const strange = [...text.matchAll(LOOKALIKE_RE)].some((m) => m[0] !== '[withheld]' && !sent.includes(m[0])) || bareNotSent(text, sent).length > 0;
  if (strange) return { why: 'Copy is off: this message has a stand-in that was not in the text you approved.' };
  for (const detail of entities.filter((e) => (e.kind === 'contact' || e.kind === 'id') && mentions(text, e, sent))) {
    const owners = ownersOf(note, entities, detail);
    if (owners.length !== 1 || owners[0] !== student) {
      return {
        why: `Copy is off: this message includes a contact detail or an identity number that your note does not tie to ${student.surfaces[0]}.`,
      };
    }
  }
  return { student };
}
