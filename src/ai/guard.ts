import { widenToWords, type Candidate } from '../core/vault';
import { modelFor } from './routes';

const SYSTEM = `You protect a teacher's private notes about children. You read one paragraph and list what must not leave the teacher's device. Copy every name and phrase exactly as written in the paragraph. Never paraphrase. Never add anything that is not in the paragraph.

people: every person named. role is "student" for a child in the class, "adult" for a parent, relative or staff member.
places: every named village, town, street, shop, school or workplace. A class name such as "Class 6B" is not a place.
private: every phrase that reveals a child's or family's health or disability, family situation, money or work, religion or caste, or a fear or secret the child confided. quote is the shortest exact phrase from the paragraph that carries the detail. category is health, family, money or identity. about is the name of the child it concerns.

Do not list schoolwork, marks, attendance, reading level or behaviour in class as private: the teacher needs help with those. Shyness, boredom, finishing early, talking and fighting in class are classroom behaviour, not private details. A heading, a date or a remark about the notes themselves is never private.

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

/** A quote pinned to the words of the note. `exact` is false when only part of the quote could be found. */
export interface Anchored {
  text: string;
  exact: boolean;
}

/**
 * Pin a quote to the words of the paragraph. The model sometimes rewords a
 * quote slightly ("Kabir is staying" for "he is staying"): then the longest
 * run of at least three of its words that does appear is kept, so the
 * detail is still withheld, and the match is marked as partial. Whatever is
 * found is widened to whole words, so a quote that cuts a word
 * ("staying with his grandmoth") still withholds the whole word.
 */
export function anchor(paragraph: string, quote: string): Anchored | undefined {
  const whole = widenToWords(paragraph, quote);
  if (whole) return { text: whole, exact: true };
  const words = quote.trim().split(/\s+/);
  for (let len = words.length - 1; len >= 3; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const found = widenToWords(paragraph, words.slice(start, start + len).join(' '));
      if (found) return { text: found, exact: false };
    }
  }
  return undefined;
}

/** The words of the paragraph a quote was pinned to, if any. */
export function anchorQuote(paragraph: string, quote: string): string | undefined {
  return anchor(paragraph, quote)?.text;
}

/** What the model said about one paragraph, turned into candidates. */
export interface ParagraphReading {
  candidates: Candidate[];
  /** Things the model reported that could not be found in the paragraph at all, so were not withheld. */
  dropped: number;
  /** Private details found only in part: the matching words were withheld, the rest needs the teacher's eye. */
  partial: number;
}

/**
 * Turn the model's answer for one paragraph into candidates. Returns
 * undefined when the answer cannot be read, or lacks any of its three
 * lists: the caller must then treat the paragraph as not guarded by the
 * model. A name, place or detail that cannot be found in the paragraph, or
 * is not text at all, is counted as dropped, never passed over in silence.
 */
export function readGuardAnswer(paragraph: string, raw: string): ParagraphReading | undefined {
  let answer: GuardAnswer;
  try {
    answer = JSON.parse(raw) as GuardAnswer;
  } catch {
    return undefined;
  }
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return undefined;
  const { people, places, private: details } = answer;
  if (!Array.isArray(people) || !Array.isArray(places) || !Array.isArray(details)) return undefined;

  const candidates: Candidate[] = [];
  let dropped = 0;
  let partial = 0;
  for (const p of people as unknown[]) {
    const name = (p as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !name.trim()) {
      dropped++;
      continue;
    }
    // "Class 6B" and the like: not a person, and not something the model saw that was then lost.
    if (/\d/.test(name)) continue;
    const text = widenToWords(paragraph, name);
    if (!text) {
      dropped++;
      continue;
    }
    candidates.push({ kind: (p as { role?: unknown }).role === 'adult' ? 'adult' : 'student', text, source: 'on-device model' });
  }
  for (const place of places as unknown[]) {
    if (typeof place !== 'string' || !place.trim()) {
      dropped++;
      continue;
    }
    if (/^(class|grade|std|standard|section)\b/i.test(place)) continue;
    const text = widenToWords(paragraph, place);
    if (!text) {
      dropped++;
      continue;
    }
    candidates.push({ kind: 'place', text, source: 'on-device model' });
  }
  for (const d of details as unknown[]) {
    const detail = d as { quote?: unknown; category?: unknown; about?: unknown } | null;
    const found = detail && typeof detail.quote === 'string' ? anchor(paragraph, detail.quote) : undefined;
    if (!found) {
      // The model saw something private here and it could not be pinned to the words of the note.
      dropped++;
      continue;
    }
    if (!found.exact) partial++;
    candidates.push({
      kind: 'private',
      text: found.text,
      source: 'on-device model',
      category: typeof detail!.category === 'string' ? detail!.category : undefined,
      aboutName: typeof detail!.about === 'string' ? detail!.about : undefined,
    });
  }
  return { candidates, dropped, partial };
}

/** What the on-device guard found, and where it fell short. */
export interface GuardReport {
  candidates: Candidate[];
  /** How many pieces the note was read in. */
  total: number;
  /** Pieces (counted from 0) that were not read: the answer was unreadable or the request failed. */
  unread: number[];
  /** Things the model reported that could not be found in the note, so were not withheld. */
  dropped: number;
  /** Private details found only in part. */
  partial: number;
  /** Set when the run had to stop early. What was found before that is kept. */
  stopped?: string;
}

/** What a guard run amounts to: whether a model read the note, and where it fell short. */
export interface GuardOutcome {
  /** ON_DEVICE when the model read at least one piece. RULES_ONLY when it read none. */
  where: 'ON_DEVICE' | 'RULES_ONLY';
  unread: number[];
  dropped: number;
  partial: number;
}

/**
 * Sum up a guard run. When the model read nothing, the run is a rules-only
 * run, and it still says how many pieces the model was asked to read and
 * could not: that is not the same as a run where no model was there.
 */
export function guardOutcome(report: GuardReport): GuardOutcome {
  return {
    where: report.unread.length >= report.total ? 'RULES_ONLY' : 'ON_DEVICE',
    unread: report.unread,
    dropped: report.dropped,
    partial: report.partial,
  };
}

/**
 * The text of the pieces the model could not read, one to a paragraph. The
 * capitalised-word rule is run over this, so a name in a piece no model
 * read is still held back as a possible name.
 */
export function unreadText(note: string, unread: number[]): string {
  const parts = paragraphs(note);
  return unread
    .map((i) => parts[i])
    .filter((p): p is string => typeof p === 'string')
    .join('\n\n');
}

/** The model's answer for one piece, and whether it came from the device. */
export interface ChunkAnswer {
  text: string;
  onDevice: boolean;
}

/**
 * Read the pieces one at a time. A piece whose request fails or whose
 * answer cannot be read is marked unread, and what was found in the other
 * pieces is kept. An answer that did not come from the device stops the
 * run at once: that piece and every later one is unread, and nothing more
 * is asked.
 */
export async function readChunks(
  parts: string[],
  ask: (chunk: string) => Promise<ChunkAnswer>,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<GuardReport> {
  const report: GuardReport = { candidates: [], total: parts.length, unread: [], dropped: 0, partial: 0 };
  for (let i = 0; i < parts.length; i++) {
    onProgress(i, parts.length);
    let answer: ChunkAnswer;
    try {
      answer = await ask(parts[i]);
    } catch {
      report.unread.push(i);
      continue;
    }
    if (!answer.onDevice) {
      report.stopped = 'The guard did not run on the device. Stopped.';
      for (let j = i; j < parts.length; j++) report.unread.push(j);
      break;
    }
    const reading = readGuardAnswer(parts[i], answer.text);
    if (!reading) {
      report.unread.push(i);
      continue;
    }
    report.candidates.push(...reading.candidates);
    report.dropped += reading.dropped;
    report.partial += reading.partial;
  }
  onProgress(parts.length, parts.length);
  return report;
}

/**
 * Read the raw note with the on-device model. The route is ONLY_ON_DEVICE:
 * if the browser has no on-device model, modelFor throws before a request
 * is made, and nothing is sent anywhere.
 *
 * modelFor already refused to start without an on-device model. The source
 * of each response is the second check, after the fact: the SDK reports
 * where it came from, and anything but the device stops the run.
 */
export async function guardOnDevice(
  note: string,
  onProgress: (done: number, total: number) => void,
): Promise<GuardReport> {
  const model = modelFor('guard', { system: SYSTEM, schema: SCHEMA });
  return readChunks(
    paragraphs(note),
    async (chunk) => {
      const result = await model.generateContent(`Paragraph:\n${chunk}`);
      const onDevice = result.response.inferenceSource === 'on_device';
      return { text: onDevice ? result.response.text() : '', onDevice };
    },
    onProgress,
  );
}
