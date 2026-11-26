import type { Constraint, DraftItem, Entity } from './types';
import { studentsNamed } from './items';
import { sensitiveWords } from './rules';
import { RESERVED, restore } from './vault';

// Does a rewritten item repeat words of the private note? Plain code, on the device. It looks for the
// words themselves: the same thing said in other words is not found, and nothing here says it is.

/** Said on a rewritten item that repeats words of a confirmed constraint or a withheld private detail. */
export const REPEATS_NOTE = 'This rewrite repeats words from your private note. Read it before you copy or print it.';

/** Words too common to count: "she has to leave at the" is not three words of anyone's private note. */
export const SMALL_WORDS = new Set(
  'a about after again all also am an and any are as at be because been before being but by can cannot could did do does each every for from had has have he her here hers him his i if in into is it its just may me more most must my near need needs no not of on only or other our over same she should so some such than that the their them then there these they this those through to too under until up us very want wants was we were what when where which while who with will would you your'.split(
    ' ',
  ),
);

/** The words of a text that count, in order and in lower case: small words left out. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !SMALL_WORDS.has(w));
}

/** The shortest run of content words, in the same order, that counts as repeating a private fact. */
export const REPEAT_RUN = 3;

/** The first run of REPEAT_RUN content words of the fact that the text has in the same order, small words between them aside. */
function sharedRun(text: string[], fact: string[]): string | undefined {
  for (let i = 0; i + REPEAT_RUN <= fact.length; i++) {
    const run = fact.slice(i, i + REPEAT_RUN);
    for (let j = 0; j + REPEAT_RUN <= text.length; j++) {
      if (run.every((w, k) => text[j + k] === w)) return run.join(' ');
    }
  }
  return undefined;
}

/**
 * The words of the private note that an item repeats, as the teacher reads
 * it (names put back). Compared with every confirmed constraint and every
 * withheld private detail about the students the item names, with those
 * about nobody in particular, and with all of them when it names nobody.
 *
 * Two things count: a run of three or more content words of one of those
 * facts, in the same order; and a word from the sensitive list that one of
 * those facts has. A fact said in other words is not found.
 */
export function repeatsPrivate(item: DraftItem, entities: Entity[], constraints: readonly Constraint[], allowed: readonly string[]): string[] {
  const named = studentsNamed(item, entities).map((e) => e.id);
  const mine = (about?: string) => named.length === 0 || !about || named.includes(about);
  const facts = [
    ...constraints.filter((c) => c.confirmed && mine(c.about)).map((c) => c.text),
    ...entities.filter((e) => e.kind === 'private' && e.withheld && e.category !== RESERVED && mine(e.about)).flatMap((e) => e.surfaces),
  ];
  return repeatsOf(restore(`${item.heading}\n${item.text}`, entities, allowed), facts);
}

function repeatsOf(read: string, facts: readonly string[]): string[] {
  const words = contentWords(read);
  const said = new Set(sensitiveWords(read));
  const found = new Set<string>();
  for (const fact of facts) {
    const run = sharedRun(words, contentWords(fact));
    if (run) found.add(run);
    for (const w of sensitiveWords(fact)) if (said.has(w)) found.add(w);
  }
  return [...found];
}

/** Said on an adjustment that repeats words of a confirmed constraint or a withheld private detail of that child. */
export const ADJUSTMENT_REPEATS = 'This adjustment repeats words from your private note. Read it before you copy or print it.';

/** The same for an adjustment: a text about one child (`about`), or about the class when there is none. Names are as typed. */
export function repeatsForChild(text: string, about: string | undefined, entities: Entity[], constraints: readonly Constraint[]): string[] {
  const mine = (id?: string) => !about || !id || id === about;
  return repeatsOf(text, [
    ...constraints.filter((c) => c.confirmed && mine(c.about)).map((c) => c.text),
    ...entities.filter((e) => e.kind === 'private' && e.withheld && e.category !== RESERVED && mine(e.about)).flatMap((e) => e.surfaces),
  ]);
}
