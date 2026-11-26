import type { Constraint, DraftItem, Entity, ItemCheck, TaskId } from '../core/types';
import { afterBellActivities, nameInNote, ruleConflicts, type RuleHit } from '../core/conflicts';
import { stepToRewrite, SUGGESTION_MAX } from '../core/recheck';
import { SMALL_WORDS } from '../core/repeats';
import { modelFor } from './routes';

// The device fits a step to the child. The cloud wrote the step without the private fact; the on-device
// model, which may read the fact, proposes other words for that one step. The proposal is a suggestion:
// it fills the rewrite box, and the teacher edits it, saves it or throws it away. It runs on its own
// ONLY_ON_DEVICE route: refused without an on-device model, and stopped if an answer comes from anywhere else.

/** Kept short: the on-device model does worse with long instructions. */
export const FIT_SYSTEM =
  'You help a teacher change one step of a plan so one child can follow it. Keep the purpose of the step. Change only what the fact rules out. One or two sentences. Do not mention the fact or the reason.';
export const FIT_FACT = 'Fact about the child: ';
export const FIT_STEP = 'Step: ';
export const FIT_ASK = 'Rewrite the step so the child can follow it.';
/** Added to the second request, with the words a rule matched in the first suggestion. */
export const FIT_MUST_NOT = 'It must not involve: ';

export const FIT_SCHEMA = {
  type: 'object',
  properties: { rewrite: { type: 'string' } },
  required: ['rewrite'],
};

/** The most characters of a suggestion that are kept. */
export const FIT_MAX = SUGGESTION_MAX;

/** Said when the model gave nothing that can be offered, after the second request. */
export const FIT_FAILED = 'The on-device model could not fit this step. Rewrite it yourself or strike it.';
/** Said above a suggestion in the rewrite box. */
export const FIT_LABEL = 'Suggested on this device from your private note. Nothing was sent.';

export interface FitInput {
  /** The step in conflict, as the teacher reads it (names put back). */
  step: string;
  /** The whole text of the item the step is from. Not put in the prompt: it is here for tuning. */
  itemText: string;
  /** The constraint the step goes against. Its words are the fact given to the model. */
  constraint: Constraint;
  /** The student's name as the note has it. Not put in the prompt. */
  studentName?: string;
  /** The task of the run. Not put in the prompt. */
  task: TaskId;
  /** Every confirmed constraint about this student. The suggestion is compared with all of them by rule. Default: the one constraint. */
  constraints?: Constraint[];
  /** Things the note says meet after the last bell, for the rule that compares the suggestion. */
  afterBell?: string[];
}

/** True for an item the device can try to fit: a rule found it in conflict with a constraint that is still confirmed. */
export function canFit(check: ItemCheck | undefined, constraints: readonly Constraint[]): boolean {
  return check?.verdict === 'conflict' && check.constraintId !== undefined && constraints.some((c) => c.id === check.constraintId && c.confirmed);
}

/**
 * What to ask for one item in conflict: the step the rule matched, the
 * constraint it goes against, and every confirmed constraint about the
 * same student or about the class, which the suggestion must pass too.
 * Undefined when the item is not one the device can fit.
 */
export function fitInputFor(
  item: DraftItem,
  check: ItemCheck | undefined,
  constraints: readonly Constraint[],
  entities: Entity[],
  allowed: readonly string[],
  note: string,
  task: TaskId,
): (FitInput & { whole: boolean }) | undefined {
  if (!canFit(check, constraints)) return undefined;
  const constraint = constraints.find((c) => c.id === check!.constraintId)!;
  const { step, whole } = stepToRewrite(item, entities, allowed, check!.matched);
  const student = entities.find((e) => e.id === constraint.about);
  return {
    step,
    whole,
    itemText: item.text,
    constraint,
    studentName: student ? nameInNote(note, student) : undefined,
    task,
    constraints: constraints.filter((c) => c.confirmed && (!c.about || c.about === constraint.about)),
    afterBell: afterBellActivities(note),
  };
}

export type FitResult =
  | { ok: true; suggestion: string; asked: number }
  | { ok: false; say: string; asked: number };

export type FitAsk = (prompt: string) => Promise<{ text: string; onDevice: boolean }>;

/** The prompt for one step. `mustNot`: the words a rule matched in the suggestion before this one. */
export function fitPrompt(input: Pick<FitInput, 'step' | 'constraint'>, mustNot: string[] = []): string {
  const lines = [`${FIT_FACT}${input.constraint.text}`, `${FIT_STEP}${input.step}`, FIT_ASK];
  if (mustNot.length > 0) lines.push(`${FIT_MUST_NOT}${mustNot.join(', ')}`);
  return lines.join('\n');
}

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Read the model's answer. Returns the suggestion, trimmed and at most
 * FIT_MAX characters (cut at the end of a sentence when there is one), or
 * undefined when the answer cannot be read, is empty, or is the step again.
 */
export function readFit(raw: string, step: string): string | undefined {
  let parsed: { rewrite?: unknown } | null;
  try {
    parsed = JSON.parse(raw) as { rewrite?: unknown } | null;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.rewrite !== 'string') return undefined;
  let text = parsed.rewrite.replace(/\s+/g, ' ').trim();
  if (text.length > FIT_MAX) {
    const cut = text.slice(0, FIT_MAX);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = (end > 0 ? cut.slice(0, end + 1) : cut).trim();
  }
  if (text.length === 0 || same(text, step)) return undefined;
  return text;
}

/** What the rules find in a suggestion, against every constraint given. Any hit, conflict or query, counts. */
export function fitHits(suggestion: string, input: Pick<FitInput, 'constraint' | 'constraints' | 'studentName' | 'afterBell'>): RuleHit[] {
  const all = input.constraints ?? [input.constraint];
  return all
    .filter((c) => c.confirmed)
    .map((c) => ruleConflicts(suggestion, c, { name: input.studentName, afterBell: input.afterBell }))
    .filter((h): h is RuleHit => h !== undefined);
}

/** The words of the private fact that a text repeats: whole words of four letters or more, small words left out. */
export function factWordsIn(text: string, constraint: Pick<Constraint, 'text'>): string[] {
  const words = (s: string) => s.toLowerCase().match(/\p{L}{4,}/gu) ?? [];
  const inText = new Set(words(text));
  return [...new Set(words(constraint.text))].filter((w) => !SMALL_WORDS.has(w) && inText.has(w));
}

/** The one way a fit prompt is put to a model: on the ONLY_ON_DEVICE route. Throws before any request when the browser has no on-device model. */
export function onDeviceFit(system: string = FIT_SYSTEM): FitAsk {
  const model = modelFor('fit', { system, schema: FIT_SCHEMA });
  return async (prompt) => {
    const result = await model.generateContent(prompt);
    const onDevice = result.response.inferenceSource === 'on_device';
    // The text is read only when the answer came from the device.
    return { text: onDevice ? result.response.text() : '', onDevice };
  };
}

/**
 * Ask the on-device model for other words for one step, so the child the
 * constraint is about can follow it.
 *
 * The suggestion is compared by rule with every confirmed constraint about
 * the student before it is offered. If a rule still fires, the model is
 * asked once more, with the matched words named. If that fails too, or an
 * answer is empty, unreadable or the step again, nothing is offered and
 * FIT_FAILED is said. An answer that did not come from the device stops
 * the fit: its text is never read.
 *
 * Nothing here changes the draft. The caller puts the suggestion in the
 * rewrite box; saving it goes through the same recheck as the teacher's own words.
 */
export async function fitStep(input: FitInput, ask?: FitAsk): Promise<FitResult> {
  // Built before anything else: with no on-device model this throws, and no request exists.
  const put = ask ?? onDeviceFit();
  let mustNot: string[] = [];
  let asked = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    asked++;
    const answer = await put(fitPrompt(input, mustNot));
    if (!answer.onDevice) throw new Error('The fit did not run on the device. Stopped.');
    const suggestion = readFit(answer.text, input.step);
    if (!suggestion) continue;
    const hits = fitHits(suggestion, input);
    if (hits.length === 0) return { ok: true, suggestion, asked };
    mustNot = [...new Set([...mustNot, ...hits.map((h) => h.matched.toLowerCase())])];
  }
  return { ok: false, say: FIT_FAILED, asked };
}

// ---------------------------------------------------------------- a lesson: what one child does instead

/** Kept short, like FIT_SYSTEM. The step stays as it is for the class; the answer is for one child. */
export const FIT_CHILD_SYSTEM =
  'A class is doing one step of a lesson. One child cannot do it as written because of the fact given. Say in one or two sentences what this child does instead, for the same purpose. Do not state the fact.';
export const FIT_CHILD_ASK = 'Say what this child does instead.';
/** Said when the model gave nothing that can be offered for a child, after the second request. */
export const FIT_CHILD_FAILED = 'The on-device model could not fit this step for this child. Write the adjustment yourself.';

export interface ChildFitInput {
  /** The step of the lesson, as the teacher reads it. */
  step: string;
  /** The constraint the step goes against. Its words are the fact given to the model. */
  constraint: Constraint;
  /** Every confirmed constraint about this child and about the class. The adjustment is compared with all of them by rule. Default: the one constraint. */
  constraints?: Constraint[];
  afterBell?: string[];
}

/** The prompt for one child and one step. `mustNot`: the words a rule matched in the answer before this one. */
export function childFitPrompt(input: Pick<ChildFitInput, 'step' | 'constraint'>, mustNot: string[] = []): string {
  const lines = [`${FIT_FACT}${input.constraint.text}`, `${FIT_STEP}${input.step}`, FIT_CHILD_ASK];
  if (mustNot.length > 0) lines.push(`${FIT_MUST_NOT}${mustNot.join(', ')}`);
  return lines.join('\n');
}

/**
 * Ask the on-device model what one child does instead of a step of the
 * lesson. The same route and the same rules as fitStep: refused with no
 * on-device model, stopped by an answer from anywhere else, compared by
 * rule with that child's confirmed constraints, and asked once more when a
 * rule still fires. What comes back is an offer: the teacher accepts it,
 * changes it or leaves the step as it is.
 */
export async function fitForChild(input: ChildFitInput, ask?: FitAsk): Promise<FitResult> {
  const put = ask ?? onDeviceFit(FIT_CHILD_SYSTEM);
  let mustNot: string[] = [];
  let asked = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    asked++;
    const answer = await put(childFitPrompt(input, mustNot));
    if (!answer.onDevice) throw new Error('The fit did not run on the device. Stopped.');
    const suggestion = readFit(answer.text, input.step);
    if (!suggestion) continue;
    const hits = fitHits(suggestion, input);
    if (hits.length === 0) return { ok: true, suggestion, asked };
    mustNot = [...new Set([...mustNot, ...hits.map((h) => h.matched.toLowerCase())])];
  }
  return { ok: false, say: FIT_CHILD_FAILED, asked };
}
