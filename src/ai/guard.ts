import type { Candidate } from '../core/vault';
import { modelFor } from './routes';

const SYSTEM = `You protect a teacher's private notes about children. You read one paragraph and list what must not leave the teacher's device. Copy every name and phrase exactly as written in the paragraph. Never paraphrase. Never add anything that is not in the paragraph.

people: every person named. role is "student" for a child in the class, "adult" for a parent, relative or staff member.
places: every named village, town, street, shop, school or workplace. A class name such as "Class 6B" is not a place.
private: every phrase that reveals a child's or family's health or disability, family situation, money or work, religion or caste, or a fear or secret the child confided. quote is the shortest exact phrase from the paragraph that carries the detail. category is health, family, money or identity. about is the name of the child it concerns.

Do not list schoolwork, marks, attendance, reading level or behaviour in class as private: the teacher needs help with those. A heading, a date or a remark about the notes themselves is never private.

If there is nothing for a list, return an empty list.`;

const SCHEMA = {
  type: 'object',
  properties: {
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, role: { type: 'string', enum: ['student', 'adult'] } },
        required: ['name', 'role'],
      },
    },
    places: { type: 'array', items: { type: 'string' } },
    private: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          category: { type: 'string', enum: ['health', 'family', 'money', 'identity'] },
          about: { type: 'string' },
        },
        required: ['quote', 'category', 'about'],
      },
    },
  },
  required: ['people', 'places', 'private'],
};

interface GuardAnswer {
  people?: { name?: string; role?: string }[];
  places?: string[];
  private?: { quote?: string; category?: string; about?: string }[];
}

/** No single prompt to the small model carries more than about this many characters of the note. */
export const MAX_CHUNK = 800;

/** Pack pieces, in order, into chunks of at most MAX_CHUNK characters. A piece is never cut here. */
function pack(pieces: string[], joiner: string): string[] {
  const out: string[] = [];
  for (const piece of pieces) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + joiner.length + piece.length <= MAX_CHUNK) out[out.length - 1] = last + joiner + piece;
    else out.push(piece);
  }
  return out;
}

/** Cut one over-long piece: at sentence ends, and at a space only if a single sentence is still too long. */
function cutLong(piece: string): string[] {
  if (piece.length <= MAX_CHUNK) return [piece];
  const sentences = piece.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    const parts: string[] = [];
    let rest = sentence;
    while (rest.length > MAX_CHUNK) {
      const space = rest.lastIndexOf(' ', MAX_CHUNK);
      const at = space > 0 ? space : MAX_CHUNK;
      parts.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  });
  return pack(sentences, ' ');
}

/**
 * Split a note into the pieces the model reads one at a time. A small model
 * is more exact on short inputs, so a paragraph (text between blank lines)
 * longer than MAX_CHUNK is split again: on single line breaks, then on
 * sentence ends. Every character of the note other than spacing is in
 * exactly one piece.
 */
export function paragraphs(note: string): string[] {
  return note
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .flatMap((p) => {
      if (p.length <= MAX_CHUNK) return [p];
      const lines = p.split(/\n/).map((l) => l.trim()).filter(Boolean);
      return pack(lines.flatMap(cutLong), '\n');
    });
}

/**
 * The model sometimes rewords a quote slightly ("Kabir is staying" for "he is
 * staying"). Keep the longest run of at least three of its words that does
 * appear in the paragraph, so the detail is still withheld.
 */
export function anchorQuote(paragraph: string, quote: string): string | undefined {
  const hay = paragraph.toLowerCase();
  if (hay.includes(quote.toLowerCase().trim())) return exactSlice(paragraph, quote.trim());
  const words = quote.trim().split(/\s+/);
  for (let len = words.length - 1; len >= 3; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const run = words.slice(start, start + len).join(' ');
      if (hay.includes(run.toLowerCase())) return exactSlice(paragraph, run);
    }
  }
  return undefined;
}

function exactSlice(paragraph: string, text: string): string {
  const at = paragraph.toLowerCase().indexOf(text.toLowerCase());
  return paragraph.slice(at, at + text.length);
}

/** What the model said about one paragraph, turned into candidates. */
export interface ParagraphReading {
  candidates: Candidate[];
  /** Private details the model reported that could not be found in the paragraph. */
  dropped: number;
}

/**
 * Turn the model's answer for one paragraph into candidates. Returns
 * undefined when the answer cannot be read at all: the caller must then
 * treat the paragraph as not guarded by the model.
 */
export function readGuardAnswer(paragraph: string, raw: string): ParagraphReading | undefined {
  let answer: GuardAnswer;
  try {
    answer = JSON.parse(raw) as GuardAnswer;
  } catch {
    return undefined;
  }
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return undefined;
  const list = <T,>(v: T[] | undefined): T[] | undefined => (v === undefined ? [] : Array.isArray(v) ? v : undefined);
  const people = list(answer.people);
  const places = list(answer.places);
  const details = list(answer.private);
  if (!people || !places || !details) return undefined;

  const candidates: Candidate[] = [];
  let dropped = 0;
  for (const p of people) {
    if (!p || typeof p.name !== 'string' || !p.name || /\d/.test(p.name)) continue;
    candidates.push({ kind: p.role === 'adult' ? 'adult' : 'student', text: p.name, source: 'on-device model' });
  }
  for (const place of places) {
    if (typeof place !== 'string' || !place || /^(class|grade|std|standard|section)\b/i.test(place)) continue;
    candidates.push({ kind: 'place', text: place, source: 'on-device model' });
  }
  for (const d of details) {
    const quote = d && typeof d.quote === 'string' && d.quote.trim() ? anchorQuote(paragraph, d.quote) : undefined;
    if (!quote) {
      // The model saw something private here and it could not be pinned to the words of the note.
      dropped++;
      continue;
    }
    candidates.push({
      kind: 'private',
      text: quote,
      source: 'on-device model',
      category: typeof d.category === 'string' ? d.category : undefined,
      aboutName: typeof d.about === 'string' ? d.about : undefined,
    });
  }
  return { candidates, dropped };
}

/** What the on-device guard found, and where it fell short. */
export interface GuardReport {
  candidates: Candidate[];
  /** Paragraphs (counted from 0) whose answer could not be read. The model did not guard these. */
  unread: number[];
  /** Private details the model reported that could not be found in the note, so were not withheld. */
  dropped: number;
}

/**
 * Read the raw note with the on-device model. The route is ONLY_ON_DEVICE:
 * if the browser has no on-device model, modelFor throws before a request
 * is made, and nothing is sent anywhere.
 *
 * A paragraph the model did not answer in a readable way is reported, never
 * passed over in silence: the teacher is told to check it.
 */
export async function guardOnDevice(
  note: string,
  onProgress: (done: number, total: number) => void,
): Promise<GuardReport> {
  const model = modelFor('guard', { system: SYSTEM, schema: SCHEMA });
  const parts = paragraphs(note);
  const report: GuardReport = { candidates: [], unread: [], dropped: 0 };
  for (let i = 0; i < parts.length; i++) {
    onProgress(i, parts.length);
    const result = await model.generateContent(`Paragraph:\n${parts[i]}`);
    if (result.response.inferenceSource !== 'on_device') {
      // modelFor already refused to start without an on-device model. This is the second check, after
      // the fact: the SDK reports where each response came from, and anything but the device stops the run.
      throw new Error('The guard did not run on the device. Stopped.');
    }
    let raw: string | undefined;
    try {
      raw = result.response.text();
    } catch {
      raw = undefined;
    }
    const reading = raw === undefined ? undefined : readGuardAnswer(parts[i], raw);
    if (!reading) {
      report.unread.push(i);
      continue;
    }
    report.candidates.push(...reading.candidates);
    report.dropped += reading.dropped;
  }
  onProgress(parts.length, parts.length);
  return report;
}
