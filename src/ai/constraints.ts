import type { Constraint, Entity } from '../core/types';
import { CONSTRAINT_KINDS, defaultsFor } from '../core/constraints';
import { wholeWordMatcher } from '../core/rules';
import { ownerAt } from '../core/vault';
import { paragraphs } from './guard';
import { modelFor } from './routes';

// The on-device model proposes constraints too. It reads the raw note, so it runs on the guard route:
// ONLY_ON_DEVICE, refused without an on-device model, and stopped if an answer comes from anywhere else.

/** Kept short: the on-device model does worse with long instructions. */
const SYSTEM = `You read one paragraph of a teacher's private notes about children. List each fact that limits what a child can do or what the school can ask of the family. For each give the child's name, the kind, and a quote copied exactly from the paragraph.
Kinds: time-after (cannot stay after school), time-before (cannot come before school), days-away (away on some days), money (the family cannot pay), no-phone-internet, contact (an adult who must not or cannot be contacted), health, other.
If there is none, return an empty list.`;

const SCHEMA = {
  type: 'object',
  properties: {
    constraints: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          student: { type: 'string' },
          kind: { type: 'string', enum: CONSTRAINT_KINDS },
          quote: { type: 'string' },
        },
        required: ['student', 'kind', 'quote'],
      },
    },
  },
  required: ['constraints'],
};

/** What the model's answer for one paragraph gave: the constraints that hold, and how many were dropped. */
export interface ConstraintReading {
  constraints: Constraint[];
  dropped: number;
}

/**
 * Read the model's answer for one paragraph. A constraint is kept only
 * when its kind is one of the kinds and its quote stands in the paragraph,
 * character for character. Whose it is is settled by the vault's own rule;
 * the name the model gave is only a claim. Returns undefined when the
 * answer cannot be read at all.
 */
export function readConstraintAnswer(note: string, paragraph: string, raw: string, entities: Entity[]): ConstraintReading | undefined {
  let parsed: { constraints?: unknown } | null;
  try {
    parsed = JSON.parse(raw) as { constraints?: unknown } | null;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.constraints)) return undefined;
  const start = note.indexOf(paragraph);
  const reading: ConstraintReading = { constraints: [], dropped: 0 };
  for (const entry of parsed.constraints as { student?: unknown; kind?: unknown; quote?: unknown }[]) {
    const quote = typeof entry?.quote === 'string' ? entry.quote.trim() : '';
    const kind = CONSTRAINT_KINDS.find((k) => k === entry?.kind);
    const inParagraph = quote.length >= 3 ? paragraph.indexOf(quote) : -1;
    const at = inParagraph < 0 ? -1 : start >= 0 ? start + inParagraph : note.indexOf(quote);
    if (!kind || at < 0 || note.slice(at, at + quote.length) !== quote) {
      reading.dropped++;
      continue;
    }
    const name = typeof entry.student === 'string' ? entry.student.trim() : '';
    const claimed = name ? entities.find((e) => e.kind === 'student' && wholeWordMatcher(e.surfaces)?.test(name)) : undefined;
    const about = ownerAt(note, entities, at, at + quote.length, claimed?.id);
    const c: Constraint = { id: `model-${at}-${kind}`, kind, text: quote, at, ...defaultsFor(kind, quote), source: 'on-device model', confirmed: false };
    if (about) {
      c.about = about;
      c.aboutName = entities.find((e) => e.id === about)?.surfaces[0];
    }
    if (!reading.constraints.some((x) => x.id === c.id)) reading.constraints.push(c);
  }
  return reading;
}

const overlap = (a: Constraint, b: Constraint) =>
  a.at !== undefined && b.at !== undefined && a.at < b.at + b.text.length && b.at < a.at + a.text.length;

/**
 * Put the model's proposals with the rules'. Where both found the same
 * words, one is kept: the rule's, marked as found by the model too.
 */
export function mergeProposals(byRule: Constraint[], byModel: Constraint[]): Constraint[] {
  const out = byRule.map((c) => ({ ...c }));
  for (const m of byModel) {
    const same = out.filter((c) => overlap(c, m));
    if (same.length === 0) out.push({ ...m });
    else for (const c of same) if (c.source === 'rule') c.alsoModel = true;
  }
  return out.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
}

/** What a run of the model over the note gave. A paragraph that failed is counted, and blocks nothing. */
export interface ConstraintReport {
  constraints: Constraint[];
  /** Paragraphs the model was asked about. */
  asked: number;
  /** Paragraphs whose request failed or whose answer could not be read. */
  unread: number;
  /** Proposals dropped: no such kind, or a quote that is not in the paragraph. */
  dropped: number;
  /** Set when the run was stopped because an answer did not come from the device. */
  stopped?: string;
}

/** The paragraphs that name a student, as whole words. Only these are asked about. */
export function studentParagraphs(note: string, entities: Entity[]): string[] {
  const names = wholeWordMatcher(entities.filter((e) => e.kind === 'student').flatMap((e) => e.surfaces));
  if (!names) return [];
  return paragraphs(note).filter((p) => {
    names.lastIndex = 0;
    return names.test(p);
  });
}

/**
 * Ask about each student paragraph, one request each. A request that fails
 * or an answer that cannot be read is counted and the run goes on. An
 * answer from anywhere but the device stops the run: nothing more is asked.
 */
export async function askForConstraints(
  note: string,
  entities: Entity[],
  ask: (paragraph: string) => Promise<{ text: string; onDevice: boolean }>,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<ConstraintReport> {
  const parts = studentParagraphs(note, entities);
  const report: ConstraintReport = { constraints: [], asked: 0, unread: 0, dropped: 0 };
  for (let i = 0; i < parts.length; i++) {
    onProgress(i, parts.length);
    report.asked++;
    let answer: { text: string; onDevice: boolean };
    try {
      answer = await ask(parts[i]);
    } catch {
      report.unread++;
      continue;
    }
    if (!answer.onDevice) {
      report.stopped = 'The search for constraints did not run on the device. Stopped.';
      report.unread += parts.length - i;
      report.asked = parts.length;
      break;
    }
    const reading = readConstraintAnswer(note, parts[i], answer.text, entities);
    if (!reading) {
      report.unread++;
      continue;
    }
    report.dropped += reading.dropped;
    for (const c of reading.constraints) if (!report.constraints.some((x) => x.id === c.id)) report.constraints.push(c);
  }
  onProgress(parts.length, parts.length);
  return report;
}

/**
 * Ask the on-device model for constraints. The route is the guard's:
 * modelFor throws before any request when the browser has no on-device
 * model, and the source of every answer is checked.
 */
export async function constraintsOnDevice(
  note: string,
  entities: Entity[],
  onProgress: (done: number, total: number) => void,
): Promise<ConstraintReport> {
  const model = modelFor('guard', { system: SYSTEM, schema: SCHEMA });
  return askForConstraints(
    note,
    entities,
    async (paragraph) => {
      const result = await model.generateContent(`Paragraph:\n${paragraph}`);
      const onDevice = result.response.inferenceSource === 'on_device';
      return { text: onDevice ? result.response.text() : '', onDevice };
    },
    onProgress,
  );
}
