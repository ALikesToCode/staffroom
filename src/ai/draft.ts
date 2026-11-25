import type { Draft, Task, Where } from '../core/types';
import { plainText } from '../core/text';
import { modelFor } from './routes';

const SYSTEM = `You help a school teacher in India with practical, kind, specific classroom advice.

The teacher's notes have been redacted before they reached you. Text in square brackets such as [Student 1], [Adult 1] or [Place 1] stands for a person or place whose identity is withheld. Always refer to them by exactly the same stand-in, brackets included. [withheld] marks a private detail you are not allowed to know. Do not guess what it is and do not ask for it.

Write plainly, in plain text with no markdown: no asterisks, no # headings. No diagnosis, no labels for children, nothing that costs money.`;

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
  const model = modelFor('draft', { system: SYSTEM, schema: SCHEMA, cloudModel });
  const result = await model.generateContent(
    `${task.instruction}\n\nReturn a title and a list of items. Each item has a short heading and the text.\n\nThe teacher's redacted notes:\n${redacted}`,
  );
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

/**
 * A short name for the receipt, from the redacted text only. The route is
 * PREFER_ON_DEVICE. Falls back to the task name if neither model answers.
 */
export async function labelReceipt(redacted: string, fallback: string): Promise<string> {
  try {
    const model = modelFor('label', {
      system: 'You write a short plain title, six words at most, for a teacher\'s note. Reply with the title only, no quotes, no full stop. Never include a name.',
    });
    const result = await model.generateContent(`Note:\n${redacted.slice(0, 1200)}`);
    const title = result.response.text().trim().split('\n')[0].replace(/^["'\s]+|["'.\s]+$/g, '');
    return title && title.length <= 80 ? title : fallback;
  } catch {
    return fallback;
  }
}
