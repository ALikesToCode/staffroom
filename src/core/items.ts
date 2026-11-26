import type { DraftItem, Entity } from './types';
import { wholeWordMatcher } from './rules';

// What a draft item is about, and the steps it is made of. Plain code: both layers of the check use it.

/** The students a draft item names: by stand-in, or by name as a whole word when the teacher released the name. */
export function studentsNamed(item: DraftItem, entities: Entity[]): Entity[] {
  const text = `${item.heading} ${item.text}`;
  return entities.filter(
    (e) => e.kind === 'student' && (text.includes(e.token) || (!e.withheld && wholeWordMatcher(e.surfaces)!.test(text))),
  );
}

/**
 * Words that make an item apply to every child, whoever else it names:
 * "whole class", "everyone", "all children", "every pupil", "each child",
 * "students", "the group", "anyone", "nobody". The list is wide on purpose.
 * A wrong match only means the item is checked against more facts.
 */
const WHOLE_CLASS = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' +
    [
      '(?:the |whole |entire )class(?:room)?',
      'every(?:one|body)',
      'any(?:one|body)',
      'no(?:body| one)',
      '(?:all|every|each|any|no|most|some|other|the) (?:of the |the |other )?(?:child|children|pupils?|students?|learners?|boys?|girls?|kids?)',
      'children|pupils|students|learners|classmates|peers',
      'the (?:whole |entire |other )?groups?',
      'all of (?:them|you)|the rest|the others|each other|one another',
    ].join('|') +
    ')(?![\\p{L}\\p{N}])',
  'iu',
);

/** True when the text speaks to every child, whoever else it names. */
export function speaksToClass(text: string): boolean {
  return WHOLE_CLASS.test(text);
}

/** The most steps of one item that are checked one by one. Any beyond that are checked together, as the last. */
const MAX_STEPS = 6;

/**
 * The steps of one item of advice: its sentences, or its numbered points.
 * Each is checked on its own. Text with no sentence break is one step.
 */
export function steps(text: string): string[] {
  const parts = text
    // A sentence may begin with a capital, with a stand-in ("[Student 2] should…") or with a number.
    .split(/(?<=[.!?])\s+(?=\p{Lu}|\[|\d+[.)]\s)|\s+(?=\d+[.)]\s)/u)
    .map((p) => p.trim())
    .filter((p) => /\p{L}{2}/u.test(p));
  if (parts.length <= 1) return [text.trim()];
  if (parts.length <= MAX_STEPS) return parts;
  return [...parts.slice(0, MAX_STEPS - 1), parts.slice(MAX_STEPS - 1).join(' ')];
}
