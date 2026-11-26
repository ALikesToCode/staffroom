import type { Constraint, Entity } from '../core/types';
import { checkLessonNeed, NEED_LINE_MAX } from '../core/lessonNeeds';
import { ownerAt } from '../core/vault';
import { studentParagraphs } from './constraints';
import { modelFor } from './routes';

// The on-device model proposes learning needs too: what a paragraph says about how a child learns, as a
// line with no name and no reason. It reads the raw note, so it runs on the guard route: ONLY_ON_DEVICE,
// refused without an on-device model, and stopped if an answer comes from anywhere else. Nothing it
// proposes is confirmed or told: the teacher does both, and can change the line.

/** Kept short: the on-device model does worse with long instructions. */
export const LEARNING_SYSTEM = `You read one paragraph of a teacher's private notes about children. List what a child needs in a lesson because of how the child learns: missed lessons, finishes early, fears tests, trouble in group work, shy, reads above or below the class, homework not done.
For each give a quote copied exactly from the paragraph, and the need in at most 12 words. The need starts with a verb or with "needs". It has no name and no reason.
Leave out health, money, family and times of day. If there is none, return an empty list.`;

export const LEARNING_SCHEMA = {
  type: 'object',
  properties: {
    needs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          need: { type: 'string' },
        },
        required: ['quote', 'need'],
      },
    },
  },
  required: ['needs'],
};

/** The most words of a need line the on-device model proposes. */
export const LEARNING_NEED_WORDS = 12;

export interface LearningReading {
  needs: Constraint[];
  dropped: number;
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');

/**
 * Read the model's answer for one paragraph. A need is kept only when its
 * quote stands in the paragraph character for character, the quote is
 * plainly about one student, and the line is short and passes the gate for
 * a need line: no name, no stand-in, no word from the sensitive list.
 * Returns undefined when the answer cannot be read at all.
 */
export function readLearningAnswer(note: string, paragraph: string, raw: string, entities: Entity[]): LearningReading | undefined {
  let parsed: { needs?: unknown } | null;
  try {
    parsed = JSON.parse(raw) as { needs?: unknown } | null;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.needs)) return undefined;
  const start = note.indexOf(paragraph);
  const reading: LearningReading = { needs: [], dropped: 0 };
  for (const entry of parsed.needs as { quote?: unknown; need?: unknown }[]) {
    const quote = typeof entry?.quote === 'string' ? entry.quote.trim() : '';
    const line = typeof entry?.need === 'string' ? flat(entry.need) : '';
    const inParagraph = quote.length >= 3 ? paragraph.indexOf(quote) : -1;
    const at = inParagraph < 0 || start < 0 ? -1 : start + inParagraph;
    const words = line.split(' ').filter(Boolean).length;
    const about = at < 0 ? undefined : ownerAt(note, entities, at, at + quote.length);
    const child = entities.find((e) => e.id === about && e.kind === 'student');
    const gate = checkLessonNeed(line, entities, false);
    if (at < 0 || !child || words === 0 || words > LEARNING_NEED_WORDS || line.length > NEED_LINE_MAX || gate.issues.length > 0) {
      reading.dropped++;
      continue;
    }
    const c: Constraint = { id: `learn-model-${at}-${child.id}`, kind: 'learning', text: quote, at, about: child.id, aboutName: child.surfaces[0], need: line, source: 'on-device model', confirmed: false };
    if (!reading.needs.some((x) => x.id === c.id)) reading.needs.push(c);
  }
  return reading;
}

const overlap = (a: Constraint, b: Constraint) => a.at !== undefined && b.at !== undefined && a.at < b.at + b.text.length && b.at < a.at + a.text.length;

/**
 * Put the model's learning needs with the rules'. Where both found the
 * same words about the same child, the rule's is kept (its line is the
 * fixed one for its kind) and marked as found by the model too. Words a
 * constraint already covers are left to the constraint.
 */
export function mergeLearning(proposed: Constraint[], byModel: Constraint[]): Constraint[] {
  const out = proposed.map((c) => ({ ...c }));
  for (const m of byModel) {
    const same = out.filter((c) => overlap(c, m) && (c.kind !== 'learning' || c.about === m.about));
    if (same.length === 0) out.push({ ...m });
    else for (const c of same) if (c.source === 'rule' && c.kind === 'learning') c.alsoModel = true;
  }
  return out.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
}

export interface LearningReport {
  needs: Constraint[];
  asked: number;
  unread: number;
  dropped: number;
  stopped?: string;
}

/** Ask about each student paragraph, one request each. An answer from anywhere but the device stops the run. */
export async function askForLearning(note: string, entities: Entity[], ask: (paragraph: string) => Promise<{ text: string; onDevice: boolean }>): Promise<LearningReport> {
  const parts = studentParagraphs(note, entities);
  const report: LearningReport = { needs: [], asked: 0, unread: 0, dropped: 0 };
  for (let i = 0; i < parts.length; i++) {
    report.asked++;
    let answer: { text: string; onDevice: boolean };
    try {
      answer = await ask(parts[i]);
    } catch {
      report.unread++;
      continue;
    }
    if (!answer.onDevice) {
      report.stopped = 'The search for learning needs did not run on the device. Stopped.';
      report.unread += parts.length - i;
      report.asked = parts.length;
      break;
    }
    const reading = readLearningAnswer(note, parts[i], answer.text, entities);
    if (!reading) {
      report.unread++;
      continue;
    }
    report.dropped += reading.dropped;
    for (const c of reading.needs) if (!report.needs.some((x) => x.id === c.id)) report.needs.push(c);
  }
  return report;
}

/** Ask the on-device model for learning needs, on the guard's route. */
export async function learningOnDevice(note: string, entities: Entity[]): Promise<LearningReport> {
  const model = modelFor('guard', { system: LEARNING_SYSTEM, schema: LEARNING_SCHEMA });
  return askForLearning(note, entities, async (paragraph) => {
    const result = await model.generateContent(`Paragraph:\n${paragraph}`);
    const onDevice = result.response.inferenceSource === 'on_device';
    return { text: onDevice ? result.response.text() : '', onDevice };
  });
}
