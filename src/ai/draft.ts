import type { Draft, LabelWhere, Task, TaskId, Where } from '../core/types';
import { ON_DEVICE_MODEL } from '../core/receipts';
import { plainText } from '../core/text';
import { modelFor } from './routes';

const REDACTED = `The teacher's notes have been redacted before they reached you. Text in square brackets such as [Student 1], [Adult 1] or [Place 1] stands for a person or place whose identity is withheld. Always refer to them by exactly the same stand-in, brackets included. [withheld] marks a private detail you are not allowed to know. Do not guess what it is and do not ask for it.`;

/** The system instruction sent with a support plan, messages to parents and a hand-over. Shown to the teacher word for word before they approve. */
export const DRAFT_SYSTEM = `You help a school teacher in India with practical, kind, specific classroom advice.

${REDACTED}

Write plainly, in plain text with no markdown: no asterisks, no # headings. No diagnosis, no labels for children, nothing that costs money.`;

/**
 * The system instruction sent with a lesson. It asks what a teacher would
 * ask of any assistant, and says nothing of what a family can pay for, has
 * at home or has time for: the cloud is not steered towards or away from
 * what the device then checks.
 */
export const LESSON_SYSTEM = `You help a school teacher in India plan a practical lesson for the class, level and topic given: its stages, the minutes for each, the materials and the homework.

${REDACTED}

Write plainly, in plain text with no markdown: no asterisks, no # headings. No diagnosis, no labels for children. Do not use a child's stand-in or a [Place] stand-in as an example in a whole-class step.`;

/** The system instruction for a task. */
export function draftSystem(task: TaskId): string {
  return task === 'lesson' ? LESSON_SYSTEM : DRAFT_SYSTEM;
}

/** The fixed sentence that follows the task instruction in every draft prompt. */
export const DRAFT_FORMAT =
  'Return a title and a list of items. Each item has a short heading and the text. In the title, in every heading and in every text, write each stand-in exactly as it is in the notes, with its square brackets: [Student 1], never Student 1. Where the notes say [withheld], something was kept from you: do not write [withheld] in your answer and do not guess what it was.';

/** The fixed line written above the approved text in every draft prompt. */
export const DRAFT_NOTES_HEADING = "The teacher's redacted notes:";

/**
 * The whole prompt for a draft: the task instruction, the two fixed lines
 * and the approved text. No other text is added, so the approval card
 * shows, word for word, the note text and the instructions the cloud model
 * is sent. The shape of the reply (a schema) is sent too; the card
 * describes it and does not quote it.
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
        properties: {
          heading: {
            type: 'string',
            description: 'A short heading. A stand-in in it keeps its square brackets: [Student 1], never Student 1.',
          },
          text: { type: 'string', description: 'The text. Every stand-in keeps its square brackets.' },
        },
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
  const model = modelFor('draft', { system: draftSystem(task.id), schema: SCHEMA, cloudModel });
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
    model: onDevice ? ON_DEVICE_MODEL : cloudModel,
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
