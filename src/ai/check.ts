import type { DraftItem, Entity, ItemCheck } from '../core/types';
import { wholeWordMatcher } from '../core/rules';
import { RESERVED, restore } from '../core/vault';
import { paragraphs } from './guard';
import { modelFor } from './routes';

const QUESTION = `You help a teacher. You are given private facts about a child and advice from a plan. The person who wrote the advice did not know the facts.

Question: can this child follow the advice exactly as it is written, without harm, given the facts?

Answer "yes" when the advice does not require what a fact rules out. Most advice is like this. Advice that is about a different time, a different place or a different thing from the facts is "yes". Advice that already avoids the problem is "yes".
Answer "no" only when the advice itself requires the very thing a fact rules out.
Answer "not sure" when you cannot tell.

Do not imagine risks the advice does not mention. Judge only the words of the advice.
The advice may have several steps. If one step requires the very thing a fact rules out, answer "no" and name that step.
`;

const ANSWER = `
First write advice_requires: what the advice needs from the child, in a few words taken from the advice. Then can_do. Then reason: one short sentence for the teacher that names the fact.`;

const CLASS_FIRST_LINE = 'Private facts about children in this class:';

/** The instructions for a prompt about one child. Kept short: each added rule made the on-device model find more false conflicts. */
const SYSTEM = QUESTION + ANSWER;

/** The instructions for a prompt about the class. Only this one explains whose fact is whose. */
const SYSTEM_CLASS = `${QUESTION}The first line is "${CLASS_FIRST_LINE}". Each fact says which child it is about, when that is known. Answer "no" only for a fact about a child the advice applies to. Advice for the whole class applies to every child.
${ANSWER}`;

// The order matters. The model writes what the advice requires before it answers, so the answer
// follows from the advice as written. Asked for a verdict first, the on-device model found a
// conflict in most harmless advice (see the measurement in the README).
const SCHEMA = {
  type: 'object',
  properties: {
    advice_requires: { type: 'string' },
    can_do: { type: 'string', enum: ['yes', 'no', 'not sure'] },
    reason: { type: 'string' },
  },
  required: ['advice_requires', 'can_do', 'reason'],
};

/** The model answers "can the child do this?". The teacher is shown a verdict. */
const VERDICT_OF: Record<string, 'fits' | 'conflict' | 'unsure'> = { yes: 'fits', no: 'conflict', 'not sure': 'unsure' };

const NO_CLEAR_ANSWER = 'The on-device check gave no clear answer. Read this item yourself.';

const NO_REASON = 'The on-device check flagged this item and gave no reason. Read it against the private details yourself.';

const FITS_NO_REASON = 'The on-device check found no conflict but gave no reason. Read this item against the private details yourself.';

const NO_ANSWER = 'The on-device model did not answer for this item. Read it against the private details yourself.';

const PART_ANSWER =
  'The on-device model did not answer for part of this check. Read this item against the private details yourself.';

/** The verdict for an item when none of its requests was answered: it was not checked at all. */
export const NOT_ANSWERED: ItemCheck = { verdict: 'not checked', reason: NO_ANSWER };

/** The verdict for a group whose request failed or whose answer could not be read. */
export const UNCLEAR: ItemCheck = { verdict: 'unsure', reason: NO_CLEAR_ANSWER };

/**
 * Turn the check model's answer into a verdict. Anything that is not a
 * clear "fits" or "conflict" becomes "unsure", so a broken or unexpected
 * answer is never shown to the teacher as approval. A "fits" with no reason
 * is not clear either: the reason is what shows the model read the facts.
 */
export function readVerdict(raw: string): ItemCheck {
  let parsed: { verdict?: unknown; can_do?: unknown; reason?: unknown } | null;
  try {
    parsed = JSON.parse(raw) as { verdict?: unknown; can_do?: unknown; reason?: unknown } | null;
  } catch {
    return { verdict: 'unsure', reason: NO_CLEAR_ANSWER };
  }
  if (!parsed || typeof parsed !== 'object') return { verdict: 'unsure', reason: NO_CLEAR_ANSWER };
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  // The model's own answer is to "can the child do this?"; a verdict spelled out directly is read too.
  const verdict = typeof parsed.can_do === 'string' ? VERDICT_OF[parsed.can_do] : parsed.verdict;
  if (verdict === 'fits') return reason ? { verdict: 'fits', reason } : { verdict: 'unsure', reason: FITS_NO_REASON };
  // A warning with no reason still has to tell the teacher what to do.
  if (verdict === 'conflict' || verdict === 'unsure') {
    return { verdict, reason: reason || NO_REASON };
  }
  return { verdict: 'unsure', reason: NO_CLEAR_ANSWER };
}

/** The verdict when no private detail was withheld at all. Only then is there nothing to check. */
export const NOTHING_WITHHELD: ItemCheck = {
  verdict: 'nothing withheld',
  reason: 'No private detail was withheld, so there was nothing to check this item against.',
};

/** True when at least one item has something to be checked against. */
export function anythingToCheck(items: DraftItem[], entities: Entity[]): boolean {
  return items.some((item) => detailsFor(item, entities).length > 0);
}

/** The students a draft item names: by stand-in, or by name as a whole word when the teacher released the name. */
export function studentsNamed(item: DraftItem, entities: Entity[]): Entity[] {
  const text = `${item.heading} ${item.text}`;
  return entities.filter(
    (e) => e.kind === 'student' && (text.includes(e.token) || (!e.withheld && wholeWordMatcher(e.surfaces)!.test(text))),
  );
}

/** One prompt's worth of checking: the facts about one student, or (no student) facts about the class. */
export interface CheckGroup {
  student?: Entity;
  details: Entity[];
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

const flat = (e: Entity) => e.surfaces[0].toLowerCase().replace(/\s+/g, ' ');

/**
 * A detail that is wholly inside another about the same child (a phrase
 * inside its own sentence) is listed once, as the longer. Two details about
 * different children are both kept, even when one's words are inside the
 * other's: each is a fact about its own child.
 */
const longestOnly = (all: Entity[]) =>
  all.filter(
    (d) => !all.some((o) => o !== d && o.about === d.about && flat(o).length > flat(d).length && flat(o).includes(flat(d))),
  );

/**
 * What one draft item must be checked against.
 *
 * - For each student the item names, the withheld private details about that student.
 * - Withheld details that are about nobody in particular are never left out: they form a class-wide group.
 * - When that gives nothing (the item names no student, or names only students with no detail of their
 *   own), or when the item speaks to the whole class or to children in general ("everyone", "all
 *   children", "each pupil", "the group": see WHOLE_CLASS) whoever else it names, it is checked against
 *   every withheld private detail, as one group.
 *
 * The result is empty only when no private detail is withheld at all.
 */
export function detailsFor(item: DraftItem, entities: Entity[]): CheckGroup[] {
  // A stand-in look-alike typed into the note is held back as a private item, and is no fact about anyone.
  const withheld = entities.filter((d) => d.kind === 'private' && d.withheld && d.category !== RESERVED);
  if (withheld.length === 0) return [];
  const groups: CheckGroup[] = studentsNamed(item, entities)
    .map((student) => ({ student, details: longestOnly(withheld.filter((d) => d.about === student.id)) }))
    .filter((g) => g.details.length > 0);
  if (groups.length === 0 || WHOLE_CLASS.test(`${item.heading} ${item.text}`)) return [{ details: longestOnly(withheld) }];
  const unattached = longestOnly(withheld.filter((d) => !d.about || !entities.some((e) => e.id === d.about)));
  if (unattached.length > 0) groups.push({ details: unattached });
  return groups;
}

/** The paragraphs that mention any of these names, as whole words. */
export function contextParagraphs(paras: string[], surfaces: string[]): string[] {
  const matcher = wholeWordMatcher(surfaces);
  if (!matcher) return [];
  return paras.filter((p) => {
    matcher.lastIndex = 0;
    return matcher.test(p);
  });
}

/**
 * The prompt for one group. It holds withheld details, so it is only ever
 * given to the on-device model. `allowed` is the set of stand-ins that were
 * in the approved text: only those are turned back into names, as everywhere
 * else, so a stand-in the reply invented is never read as a real child.
 */
export function checkPrompt(group: CheckGroup, item: DraftItem, paras: string[], entities: Entity[], allowed: readonly string[]): string {
  const advice = restore(`${item.heading}. ${item.text}`, entities, allowed);
  if (group.student) {
    const name = group.student.surfaces[0];
    return [
      `Private facts about ${name}:`,
      ...group.details.map((d) => `- ${d.surfaces[0]}`),
      '',
      `What the teacher wrote about ${name}:`,
      contextParagraphs(paras, group.student.surfaces).join('\n'),
      '',
      'Advice to check:',
      advice,
    ].join('\n');
  }
  const about = (d: Entity) => entities.find((e) => e.id === d.about)?.surfaces[0];
  const holds = (p: string, d: Entity) => p.toLowerCase().replace(/\s+/g, ' ').includes(flat(d));
  return [
    CLASS_FIRST_LINE,
    ...group.details.map((d) => `- ${about(d) ? `(about ${about(d)}) ` : ''}${d.surfaces[0]}`),
    '',
    'What the teacher wrote:',
    paras.filter((p) => group.details.some((d) => holds(p, d))).join('\n'),
    '',
    'Advice to check:',
    advice,
  ].join('\n');
}

/**
 * Check each draft item against what was withheld. The route is
 * ONLY_ON_DEVICE: the withheld details are in this prompt, so it must not
 * go to the cloud. modelFor refuses to start without an on-device model, and
 * a response from anywhere but the device stops the check.
 *
 * When no private detail was withheld there is nothing to check, no model
 * is needed and none is asked: the caller records the check as skipped.
 */
export async function checkOnDevice(
  note: string,
  items: DraftItem[],
  entities: Entity[],
  allowed: readonly string[],
  onProgress: (done: number, total: number) => void,
): Promise<CheckRun> {
  if (!anythingToCheck(items, entities)) return { checks: items.map(() => NOTHING_WITHHELD), asked: 0, answered: 0, failed: 0 };
  return checkItems(items, entities, paragraphs(note), allowed, onDeviceAsk(), onProgress);
}

/**
 * The one way a check prompt is put to a model: on the ONLY_ON_DEVICE
 * route. Throws before any request when the browser has no on-device model.
 */
export function onDeviceAsk(): (prompt: string) => Promise<{ text: string; onDevice: boolean }> {
  const one = modelFor('check', { system: SYSTEM, schema: SCHEMA });
  const all = modelFor('check', { system: SYSTEM_CLASS, schema: SCHEMA });
  return async (prompt) => {
    const result = await (prompt.startsWith(CLASS_FIRST_LINE) ? all : one).generateContent(prompt);
    const onDevice = result.response.inferenceSource === 'on_device';
    // The text is read only when the answer came from the device.
    return { text: onDevice ? result.response.text() : '', onDevice };
  };
}

/** What a check run did: a verdict for each item, and how many requests were made, answered and failed. */
export interface CheckRun {
  checks: ItemCheck[];
  /** Requests made to the on-device model. */
  asked: number;
  /** Requests that came back with an answer, readable or not. */
  answered: number;
  /** Requests that failed outright. When this equals `asked`, the check did not run. */
  failed: number;
}

/** True when requests were made and every one of them failed: nothing was checked. */
export function checkDidNotRun(run: CheckRun): boolean {
  return run.asked > 0 && run.failed === run.asked;
}

/**
 * Check each item, one prompt per group. A request that fails does not stop
 * the run. An item none of whose requests was answered is "not checked";
 * one with some answered is at least "unsure"; an answer that cannot be
 * read makes its group unsure. An answer from anywhere but the device is
 * different: the private details were in that prompt, so the whole check
 * stops.
 */
export async function checkItems(
  items: DraftItem[],
  entities: Entity[],
  paras: string[],
  allowed: readonly string[],
  ask: (prompt: string) => Promise<{ text: string; onDevice: boolean }>,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<CheckRun> {
  const run: CheckRun = { checks: [], asked: 0, answered: 0, failed: 0 };
  for (let i = 0; i < items.length; i++) {
    onProgress(i, items.length);
    const groups = detailsFor(items[i], entities);
    if (groups.length === 0) {
      run.checks.push(NOTHING_WITHHELD);
      continue;
    }
    let worst: ItemCheck | undefined;
    let failedHere = 0;
    for (const group of groups) {
      let answer: { text: string; onDevice: boolean } | undefined;
      run.asked++;
      try {
        answer = await ask(checkPrompt(group, items[i], paras, entities, allowed));
      } catch {
        answer = undefined;
      }
      if (answer && !answer.onDevice) throw new Error('The check did not run on the device. Stopped.');
      if (!answer) {
        run.failed++;
        failedHere++;
        continue;
      }
      run.answered++;
      worst = worse(worst, readVerdict(answer.text));
    }
    if (!worst) run.checks.push(NOT_ANSWERED);
    else run.checks.push(failedHere > 0 ? worse(worst, { verdict: 'unsure', reason: PART_ANSWER }) : worst);
  }
  onProgress(items.length, items.length);
  return run;
}

const rank = (c: ItemCheck) => (c.verdict === 'conflict' ? 2 : c.verdict === 'unsure' ? 1 : 0);

/**
 * Keep the more serious of two verdicts. The verdict only ever moves up:
 * a later, milder answer never replaces an earlier warning. Between two of
 * the same rank the first is kept, unless it has no reason to show.
 */
export function worse(current: ItemCheck | undefined, next: ItemCheck): ItemCheck {
  if (!current) return next;
  if (rank(next) > rank(current)) return next;
  if (rank(next) === rank(current) && !current.reason && next.reason) return next;
  return current;
}

/**
 * How each item starts. An item with no conflict found, or with nothing to
 * check, starts kept (true). An item in conflict starts struck (false). An
 * item the check was unsure about, or did not check, starts undecided
 * (null): the teacher has to choose to keep it or strike it before signing
 * off, so a warning is never carried through by default.
 */
export function startsKept(checks: ItemCheck[]): (boolean | null)[] {
  return checks.map((c) => (c.verdict === 'conflict' ? false : c.verdict === 'unsure' || c.verdict === 'not checked' ? null : true));
}
