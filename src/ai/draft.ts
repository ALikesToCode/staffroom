import type { Draft, LabelWhere, Task, Where } from '../core/types';
import { plainText } from '../core/text';
import { modelFor } from './routes';

/** The system instruction sent with every draft. Shown to the teacher word for word before they approve. */
export const DRAFT_SYSTEM = `You help a school teacher in India with practical, kind, specific classroom advice.

The teacher's notes have been redacted before they reached you. Text in square brackets such as [Student 1], [Adult 1] or [Place 1] stands for a person or place whose identity is withheld. Always refer to them by exactly the same stand-in, brackets included. [withheld] marks a private detail you are not allowed to know. Do not guess what it is and do not ask for it.

Write plainly, in plain text with no markdown: no asterisks, no # headings. No diagnosis, no labels for children, nothing that costs money.`;

/** The fixed sentence that follows the task instruction in every draft prompt. */
export const DRAFT_FORMAT = 'Return a title and a list of items. Each item has a short heading and the text.';

/** The fixed line written above the approved text in every draft prompt. */
export const DRAFT_NOTES_HEADING = "The teacher's redacted notes:";

/**
 * The whole prompt for a draft: the task instruction, the two fixed lines
 * and the approved text. Nothing else is added anywhere, so what the
 * approval card shows is everything the cloud model is sent.
 */
export function draftPrompt(redacted: string, task: Task): string {
  return `${task.instruction}\n\n${DRAFT_FORMAT}\n\n${DRAFT_NOTES_HEADING}\n${redacted}`;
}

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, text: { type: 'string' } },
        required: ['heading', 'text'],
      },
    },
  },
  required: ['title', 'items'],
};

export interface DraftResult {
  draft: Draft;
  where: Where;
  model: string;
}

/**
 * Write the draft from the redacted, teacher-approved text. The route is
 * PREFER_IN_CLOUD: the cloud model writes it, and the on-device model takes
 * over when the cloud cannot be reached.
 */
export async function writeDraft(redacted: string, task: Task, cloudModel: string): Promise<DraftResult> {
  const model = modelFor('draft', { system: DRAFT_SYSTEM, schema: SCHEMA, cloudModel });
  const result = await model.generateContent(draftPrompt(redacted, task));
  const draft = JSON.parse(result.response.text()) as Draft;
  if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) {
    throw new Error('The model returned an empty draft.');
  }
  const onDevice = result.response.inferenceSource === 'on_device';
  return {
    draft: {
      title: plainText(String(draft.title ?? task.label)),
      items: draft.items.map((i) => ({ heading: plainText(String(i.heading ?? '')), text: plainText(String(i.text ?? '')) })),
    },
    where: onDevice ? 'ON_DEVICE' : 'IN_CLOUD',
    model: onDevice ? 'Gemini Nano (Chrome built-in)' : cloudModel,
  };
}

/** The instruction for the call that names the receipt. */
export const LABEL_SYSTEM =
  "You write a short plain title, six words at most, for a teacher's note. Reply with the title only, no quotes, no full stop. Never include a name.";

/** How much of the approved text the naming call is given. */
export const LABEL_CHARS = 1200;

/** The whole prompt for the naming call: the start of the approved text and nothing else. */
export function labelPrompt(redacted: string): string {
  return `Note:\n${redacted.slice(0, LABEL_CHARS)}`;
}

export interface LabelResult {
  title: string;
  /** Where the naming call ran, or FALLBACK when neither model answered and the task name is used. */
  where: LabelWhere;
}

/**
 * A short name for the receipt, from the redacted text only. The route is
 * PREFER_ON_DEVICE; if it falls back to the cloud it uses the same cloud
 * model as the draft. Falls back to the task name if neither model answers.
 * Where the call ran is read from the response and returned, like every
 * other call.
 */
export async function labelReceipt(redacted: string, fallback: string, cloudModel?: string): Promise<LabelResult> {
  try {
    const model = modelFor('label', { system: LABEL_SYSTEM, cloudModel });
    const result = await model.generateContent(labelPrompt(redacted));
    const where: LabelWhere = result.response.inferenceSource === 'on_device' ? 'ON_DEVICE' : 'IN_CLOUD';
    const title = result.response.text().trim().split('\n')[0].replace(/^["'\s]+|["'.\s]+$/g, '');
    // An unusable title is replaced by the task name. The call still ran, so where it ran is still recorded.
    return { title: title && title.length <= 80 ? title : fallback, where };
  } catch {
    return { title: fallback, where: 'FALLBACK' };
  }
}
