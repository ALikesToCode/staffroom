import { splitVariations } from '../core/lessonNeeds';
import { MATERIALS_SCHEMA, MATERIALS_SYSTEM, readMaterials, type Materials } from '../core/materials';
import type { Draft, LabelWhere, Task, TaskId, Where } from '../core/types';
import { ON_DEVICE_MODEL } from '../core/receipts';
import { plainText } from '../core/text';
import { modelFor, onDeviceFallbackFor } from './routes';

const REDACTED = `The teacher's notes have been redacted before they reached you. Text in square brackets such as [Student 1], [Adult 1] or [Place 1] stands for a person or place whose identity is withheld. Always refer to them by exactly the same stand-in, brackets included. [withheld] marks a private detail you are not allowed to know. Do not guess what it is and do not ask for it.`;

/**
 * For a lesson only the note's sentences about the class are sent, so there
 * is seldom a stand-in in it. Given examples of stand-ins, the cloud wrote
 * one that was never sent ("a description of [Place 1]"), which the return
 * gate rightly stops; so a lesson is given no example to copy.
 */
const LESSON_REDACTED = `The teacher's notes were redacted before they reached you, and only their sentences about the class as a whole were kept. A word in square brackets stands for a person or place whose identity is withheld; [withheld] marks a private detail you are not allowed to know. Do not guess what either is. Never write a square-bracketed word that is not in the notes, and do not use one as an example in a whole-class step.`;

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
export const LESSON_SYSTEM = `You help a school teacher in India plan a practical lesson for the class, level and topic given: its stages, the minutes for each, the materials and the homework. Give the lesson a clean, readable title using an em-dash, such as "Class 6 English — Describing a Place".

${LESSON_REDACTED}

Write plainly, in plain text with no markdown: no asterisks, no # headings. No diagnosis, no labels for children.`;

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

/** System instruction for offline on-device lesson plans: bracket-free and focused on lettered needs. */
export const OFFLINE_LESSON_SYSTEM =
  'You plan practical classroom lessons in plain text for teachers in India. Never write square brackets or numbered labels like Student 1. Write for the whole class and answer every lettered need requested.';

/** Bracket-free schema used for on-device lesson fallback so local Nano does not echo stand-in hints. */
const OFFLINE_LESSON_SCHEMA = {
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

const NEEDS_LINE_RE = /^Need ([A-Z]+): (.+)$/gm;
const LESSON_SECTION_RE = /(?:^|\n)Lesson\n/;
const OFFLINE_COLON_NEED_RE = /^Need\s+([A-Za-z]{1,2})\s*[:.–-]\s*(.+)$/gm;
const STAGE_MIN_RE = /\s*[(\[–—:-]\s*\d+\s*min(?:ute)?s?\.?\s*[)\]]?\s*$/iu;

function pickOfflineStage(text: string, stages: readonly string[]): string {
  if (/^(?:this\s+lesson\s+already\s+suits|already\s+suited|no\s+change\s+needed)/i.test(text.trim())) return 'none';
  if (/homework|at home|take[- ]home|after school|before.*bell|next\s+(?:day|morning)|hand\s*in/i.test(text)) {
    const hw = stages.find((s) => /homework/i.test(s));
    if (hw) return hw;
  }
  if (/starter|warm[- ]?up|opening|begin/i.test(text)) {
    const st = stages.find((s) => /starter/i.test(s));
    if (st) return st;
  }
  if (/teach|explain|model|board|demonstrat/i.test(text)) {
    const tc = stages.find((s) => /teach/i.test(s));
    if (tc) return tc;
  }
  return stages.find((s) => /practis|practic/i.test(s)) ?? stages[0] ?? 'none';
}

/**
 * Convert colon-formatted Need lines (`Need A: adjustment`) produced by compact
 * offline Gemini Nano prompts into pipe entries (`Need A | Stage | adjustment`)
 * expected by `splitVariations`. Cloud pipe replies pass through unchanged.
 */
export function normalizeOfflineNeeds(draft: Draft, letters: readonly string[]): Draft {
  const isNeeds = (h: string) => h.replace(/[\s:.]+$/, '').trim().toLowerCase() === 'for each need';
  const at = draft.items.map((i) => isNeeds(i.heading)).lastIndexOf(true);
  if (at < 0) return draft;
  const text = draft.items[at].text;
  if (/\bNeed\s+[A-Za-z]{1,2}\s*\|/.test(text)) return draft;
  const stages = draft.items
    .filter((_, i) => i !== at)
    .map((i) => i.heading.replace(STAGE_MIN_RE, '').trim())
    .filter(Boolean);
  const lines: string[] = [];
  for (const m of text.matchAll(OFFLINE_COLON_NEED_RE)) {
    const letter = m[1].toUpperCase();
    const adj = m[2].trim();
    if (!letters.includes(letter) || !adj) continue;
    lines.push(`Need ${letter} | ${pickOfflineStage(adj, stages)} | ${adj}`);
  }
  if (lines.length === 0) return draft;
  return {
    title: draft.title,
    items: draft.items.map((item, i) => (i === at ? { ...item, text: lines.join('\n') } : item)),
  };
}

/**
 * Compact, structured prompt used ONLY when the cloud is unreachable and Chrome's built-in Nano
 * takes over a lesson plan. Reads only the already-redacted text so zero private identity is exposed.
 */
export function offlineLessonPrompt(redacted: string): string {
  const needs = [...redacted.matchAll(NEEDS_LINE_RE)].map((m) => ({ letter: m[1], line: m[2].trim() }));
  const needsAt = redacted.indexOf('Needs in this class');
  const lessonMatch = LESSON_SECTION_RE.exec(redacted);
  const whatAt = redacted.indexOf('What the lesson is:');
  const lessonAt = lessonMatch ? lessonMatch.index + (lessonMatch[0].startsWith('\n') ? 1 : 0) : whatAt;

  let lessonBlock = '';
  let notesPart = '';
  if (lessonAt >= 0 && needsAt >= 0) {
    if (needsAt < lessonAt) {
      notesPart = redacted.slice(0, needsAt).trim();
      lessonBlock = redacted.slice(lessonAt).trim();
    } else {
      notesPart = redacted.slice(0, lessonAt).trim();
      lessonBlock = redacted.slice(lessonAt, needsAt).trim();
    }
  } else if (lessonAt >= 0) {
    notesPart = redacted.slice(0, lessonAt).trim();
    lessonBlock = redacted.slice(lessonAt).trim();
  } else if (needsAt >= 0) {
    notesPart = redacted.slice(0, needsAt).trim();
  } else {
    notesPart = redacted.trim();
  }

  const lines = [
    'Return JSON with "title" and "items": 4 practical stages totalling the lesson minutes (Starter, Teach, Practise, Homework), plus one final item with exact heading "For each need" if needs are given.',
    'Plain text only. Refer to pupils generally (a pupil, pairs, the class). NEVER use square brackets anywhere.',
    ...(lessonBlock ? ['', lessonBlock] : []),
    ...(notesPart ? ['', 'Class notes:', notesPart] : []),
  ];
  if (needs.length > 0) {
    const letters = needs.map((n) => n.letter);
    lines.push(
      '',
      'Inside the final "For each need" item, write one line for EVERY letter in "Need X: <one short classroom adjustment>" format:',
      ...needs.map((n) => `Need ${n.letter}: ${n.line}`),
      `Cover every letter: ${letters.join(', ')}.`,
    );
  }
  return lines.join('\n');
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
 * Stream a response from a hybrid PREFER_IN_CLOUD model, forwarding partial text as it arrives
 * and returning the final aggregated text and verified `inferenceSource`.
 */
async function readStream(
  model: ReturnType<typeof modelFor>,
  prompt: string,
  onChunk?: (accumulatedText: string) => void,
): Promise<{ text: string; onDevice: boolean }> {
  const streamed = await model.generateContentStream(prompt);
  let partial = '';
  for await (const chunk of streamed.stream) {
    try {
      const piece = chunk.text();
      if (piece) {
        partial += piece;
        onChunk?.(partial);
      }
    } catch {
      // Ignore chunks without text parts (e.g. metadata frames).
    }
  }
  const finalResponse = await streamed.response;
  const text = finalResponse.text();
  if (text && text !== partial) onChunk?.(text);
  return { text, onDevice: finalResponse.inferenceSource === 'on_device' };
}

/**
 * Stream a response from a hybrid PREFER_IN_CLOUD model, forwarding partial text as it arrives
 * and returning the final aggregated text and verified `inferenceSource`.
 * If a stream fails mid-flight (e.g. connection dropped after headers/first chunk) and Chrome's
 * built-in model is available locally, reset partial preview text and recover via ONLY_ON_DEVICE.
 */
export async function streamContent(
  model: ReturnType<typeof modelFor>,
  prompt: string,
  onChunk?: (accumulatedText: string) => void,
  fallbackModel?: () => ReturnType<typeof modelFor> | null,
  validate?: (text: string, onDevice: boolean) => boolean,
  fallbackPrompt?: string,
): Promise<{ text: string; onDevice: boolean }> {
  try {
    const result = await readStream(model, prompt, onChunk);
    if (validate && !validate(result.text, result.onDevice)) {
      throw new Error(result.onDevice ? 'The on-device draft ended incomplete.' : 'The streamed cloud reply ended incomplete.');
    }
    return result;
  } catch (err) {
    const deviceModel = fallbackModel?.();
    if (!deviceModel || deviceModel === model) throw err;
    onChunk?.('');
    let recovered: { text: string; onDevice: boolean };
    try {
      recovered = await readStream(deviceModel, fallbackPrompt ?? prompt, onChunk);
    } catch {
      throw err;
    }
    if (!recovered.onDevice) {
      throw new Error('The fallback draft did not run on the device.');
    }
    return recovered;
  }
}

/**
 * Write the draft from the redacted, teacher-approved text. The route is
 * PREFER_IN_CLOUD: the cloud model writes it, and the on-device model takes
 * over when the cloud cannot be reached.
 */
export async function writeDraft(
  redacted: string,
  task: Task,
  cloudModel: string,
  onProgressText?: (partialText: string) => void,
): Promise<DraftResult> {
  const isLesson = task.id === 'lesson';
  const toldLetters = isLesson ? [...redacted.matchAll(NEEDS_LINE_RE)].map((m) => m[1]) : [];
  const isOffline = typeof globalThis.navigator !== 'undefined' && globalThis.navigator.onLine === false;
  const opts = {
    system: draftSystem(task.id),
    schema: SCHEMA,
    cloudModel,
    ...(isLesson ? { onDeviceSystem: OFFLINE_LESSON_SYSTEM, onDeviceSchema: OFFLINE_LESSON_SCHEMA } : {}),
  };
  const model = modelFor('draft', opts);
  const { text, onDevice } = await streamContent(
    model,
    isLesson && isOffline ? offlineLessonPrompt(redacted) : draftPrompt(redacted, task),
    onProgressText,
    () =>
      onDeviceFallbackFor(
        isLesson ? { ...opts, system: OFFLINE_LESSON_SYSTEM, schema: OFFLINE_LESSON_SCHEMA } : opts,
      ),
    (t, fromDevice) => {
      try {
        const parsed = JSON.parse(t) as Draft | null;
        if (
          !parsed ||
          !Array.isArray(parsed.items) ||
          parsed.items.length === 0 ||
          !parsed.items.every((i) => i && typeof i.heading === 'string' && i.heading.trim().length > 0 && typeof i.text === 'string' && i.text.trim().length > 0)
        ) {
          return false;
        }
        if (fromDevice && isLesson) {
          if (/\[Student\s+\d+\]/i.test(t) && !/\[Student\s+\d+\]/i.test(redacted)) return false;
          if (toldLetters.length > 0) {
            const normalized = normalizeOfflineNeeds(parsed, toldLetters);
            if (splitVariations(normalized, toldLetters).missing.length > Math.floor(toldLetters.length / 3)) {
              return false;
            }
          }
        }
        return true;
      } catch {
        return false;
      }
    },
    isLesson ? offlineLessonPrompt(redacted) : undefined,
  );
  const draft = JSON.parse(text) as Draft;
  if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) {
    throw new Error('The model returned an empty draft.');
  }
  const cleanDraft: Draft = {
    title: plainText(String(draft.title ?? task.label)),
    items: draft.items.map((i) => ({ heading: plainText(String(i.heading ?? '')), text: plainText(String(i.text ?? '')) })),
  };
  return {
    draft: onDevice && isLesson && toldLetters.length > 0 ? normalizeOfflineNeeds(cleanDraft, toldLetters) : cleanDraft,
    where: onDevice ? 'ON_DEVICE' : 'IN_CLOUD',
    model: onDevice ? ON_DEVICE_MODEL : cloudModel,
  };
}

export interface MaterialsResult {
  materials: Materials;
  where: Where;
  model: string;
}

/**
 * Write the materials from the text the teacher approved: the signed class
 * plan and the needs by letter. The route is the draft's, PREFER_IN_CLOUD.
 * A reply that is not whole is refused: nothing of it is shown.
 */
export async function writeMaterials(
  text: string,
  letters: readonly string[],
  cloudModel: string,
  onProgressText?: (partialText: string) => void,
): Promise<MaterialsResult> {
  const opts = { system: MATERIALS_SYSTEM, schema: MATERIALS_SCHEMA, cloudModel };
  const model = modelFor('draft', opts);
  const { text: raw, onDevice } = await streamContent(
    model,
    text,
    onProgressText,
    () => onDeviceFallbackFor(opts),
    (t) => Boolean(readMaterials(plainText(t), letters)),
  );
  const materials = readMaterials(plainText(raw), letters);
  if (!materials) throw new Error('The materials that came back were not whole.');
  return { materials, where: onDevice ? 'ON_DEVICE' : 'IN_CLOUD', model: onDevice ? ON_DEVICE_MODEL : cloudModel };
}

/** The instruction for the call that names the receipt. */
export const LABEL_SYSTEM =
  "You write a short plain title, six words at most, for a teacher's note. Reply with the title only, no quotes, no full stop. Never include a name.";

/** How much of the approved text the naming call is given. */
export const LABEL_CHARS = 240;

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
