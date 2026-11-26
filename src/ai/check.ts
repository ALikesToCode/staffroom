import type { DraftItem, Entity, ItemCheck } from '../core/types';
import { wholeWordMatcher } from '../core/rules';
import { RESERVED, restore } from '../core/vault';
import { paragraphs } from './guard';
import { modelFor } from './routes';

const SYSTEM = `You check advice for a teacher. The advice was written by a planner who did not know the private facts about the child. You know them. Decide whether the advice still makes sense for this child.

verdict "fits": the advice is sensible given the private facts, or does not touch them.
verdict "conflict": the advice would be unkind, unsafe or impossible for this child given the private facts.
verdict "unsure": the advice touches on the private facts and the teacher should think before using it.

Most advice fits. Choose "fits" unless you can point to one private fact that the advice runs against. A hard home life alone is not a reason to doubt kind, ordinary advice.
Choose "conflict" only when a fact makes the advice impossible or harmful as written: for example, advice to stay after school for a child who must leave early, or advice to phone a parent who is not at home.
Read every step of the advice, one at a time. If any single step asks the child to be somewhere, stay somewhere or do something at a time or place that a private fact rules out, the verdict is "conflict", even when the other steps are fine. Name that step in the reason.
When the first line is "Private facts about" one child's name, judge only that child. Do not judge the advice for other children.
When the first line is "Private facts about children in this class", each fact says which child it is about, when that is known. The advice conflicts only if it runs against a fact about a child the advice applies to. Advice for the whole class applies to every child.

reason is one short sentence for the teacher. Name the private fact that matters.`;

const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['fits', 'conflict', 'unsure'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
};

const NO_CLEAR_ANSWER = 'The on-device check gave no clear answer. Read this item yourself.';

const NO_REASON = 'The on-device check flagged this item and gave no reason. Read it against the private details yourself.';

/** The verdict for a group whose request failed or whose answer could not be read. */
export const UNCLEAR: ItemCheck = { verdict: 'unsure', reason: NO_CLEAR_ANSWER };

/**
 * Turn the check model's answer into a verdict. Anything that is not a
 * clear "fits" or "conflict" becomes "unsure", so a broken or unexpected
 * answer is never shown to the teacher as approval.
 */
export function readVerdict(raw: string): ItemCheck {
  let parsed: { verdict?: unknown; reason?: unknown } | null;
  try {
    parsed = JSON.parse(raw) as { verdict?: unknown; reason?: unknown } | null;
  } catch {
    return { verdict: 'unsure', reason: NO_CLEAR_ANSWER };
  }
  if (!parsed || typeof parsed !== 'object') return { verdict: 'unsure', reason: NO_CLEAR_ANSWER };
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  if (parsed.verdict === 'fits') return { verdict: 'fits', reason };
  // A warning with no reason still has to tell the teacher what to do.
  if (parsed.verdict === 'conflict' || parsed.verdict === 'unsure') {
    return { verdict: parsed.verdict, reason: reason || NO_REASON };
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

/** Words that make an item apply to every child, whoever else it names. */
const WHOLE_CLASS = /(?<![\p{L}\p{N}])(?:whole class|everyone|all students|the class)(?![\p{L}\p{N}])/iu;

const flat = (e: Entity) => e.surfaces[0].toLowerCase().replace(/\s+/g, ' ');

/** A detail that is wholly inside another in the list (a phrase inside its own sentence) is listed once, as the longer. */
const longestOnly = (all: Entity[]) =>
  all.filter((d) => !all.some((o) => o !== d && flat(o).length > flat(d).length && flat(o).includes(flat(d))));

/**
 * What one draft item must be checked against.
 *
 * - For each student the item names, the withheld private details about that student.
 * - Withheld details that are about nobody in particular are never left out: they form a class-wide group.
 * - When that gives nothing (the item names no student, or names only students with no detail of their
 *   own), or when the item speaks to the whole class ("whole class", "everyone", "all students",
 *   "the class") whoever else it names, it is checked against every withheld private detail, as one group.
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

/** The prompt for one group. It holds withheld details, so it is only ever given to the on-device model. */
export function checkPrompt(group: CheckGroup, item: DraftItem, paras: string[], entities: Entity[]): string {
  const advice = restore(`${item.heading}. ${item.text}`, entities);
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
    'Private facts about children in this class:',
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
  onProgress: (done: number, total: number) => void,
): Promise<ItemCheck[]> {
  if (!anythingToCheck(items, entities)) return items.map(() => NOTHING_WITHHELD);
  const model = modelFor('check', { system: SYSTEM, schema: SCHEMA });
  return checkItems(
    items,
    entities,
    paragraphs(note),
    async (prompt) => {
      const result = await model.generateContent(prompt);
      const onDevice = result.response.inferenceSource === 'on_device';
      // The text is read only when the answer came from the device.
      return { text: onDevice ? result.response.text() : '', onDevice };
    },
    onProgress,
  );
}

/**
 * Check each item, one prompt per group. One request that fails, or one
 * answer that cannot be read, makes that group unsure and the run goes on.
 * An answer from anywhere but the device is different: the private details
 * were in that prompt, so the whole check stops.
 */
export async function checkItems(
  items: DraftItem[],
  entities: Entity[],
  paras: string[],
  ask: (prompt: string) => Promise<{ text: string; onDevice: boolean }>,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<ItemCheck[]> {
  const checks: ItemCheck[] = [];
  for (let i = 0; i < items.length; i++) {
    onProgress(i, items.length);
    const groups = detailsFor(items[i], entities);
    if (groups.length === 0) {
      checks.push(NOTHING_WITHHELD);
      continue;
    }
    let worst: ItemCheck | undefined;
    for (const group of groups) {
      let answer: { text: string; onDevice: boolean } | undefined;
      try {
        answer = await ask(checkPrompt(group, items[i], paras, entities));
      } catch {
        answer = undefined;
      }
      if (answer && !answer.onDevice) throw new Error('The check did not run on the device. Stopped.');
      worst = worse(worst, answer ? readVerdict(answer.text) : UNCLEAR);
    }
    checks.push(worst ?? UNCLEAR);
  }
  onProgress(items.length, items.length);
  return checks;
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
 * Which items start as kept. An item the check found in conflict starts
 * struck, so the teacher has to choose to keep it. The others start kept;
 * an unsure or unchecked one carries its warning with it.
 */
export function startsKept(checks: ItemCheck[]): boolean[] {
  return checks.map((c) => c.verdict !== 'conflict');
}
