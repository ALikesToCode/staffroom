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

/** Split a note into paragraphs. A small model is more exact on short inputs. */
export function paragraphs(note: string): string[] {
  return note
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
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

/**
 * Read the raw note with the on-device model. The route is ONLY_ON_DEVICE:
 * if no on-device model can run, this throws and nothing is sent anywhere.
 */
export async function guardOnDevice(
  note: string,
  onProgress: (done: number, total: number) => void,
): Promise<Candidate[]> {
  const model = modelFor('guard', { system: SYSTEM, schema: SCHEMA });
  const parts = paragraphs(note);
  const found: Candidate[] = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress(i, parts.length);
    const result = await model.generateContent(`Paragraph:\n${parts[i]}`);
    if (result.response.inferenceSource !== 'on_device') {
      // Cannot happen with ONLY_ON_DEVICE. Checked anyway: this is the one call that must not leave.
      throw new Error('The guard did not run on the device. Stopped.');
    }
    let answer: GuardAnswer;
    try {
      answer = JSON.parse(result.response.text()) as GuardAnswer;
    } catch {
      continue;
    }
    for (const p of answer.people ?? []) {
      if (!p.name || /\d/.test(p.name)) continue;
      found.push({ kind: p.role === 'adult' ? 'adult' : 'student', text: p.name, source: 'on-device model' });
    }
    for (const place of answer.places ?? []) {
      if (!place || /^(class|grade|std|standard|section)\b/i.test(place)) continue;
      found.push({ kind: 'place', text: place, source: 'on-device model' });
    }
    for (const d of answer.private ?? []) {
      const quote = d.quote ? anchorQuote(parts[i], d.quote) : undefined;
      if (!quote) continue;
      found.push({ kind: 'private', text: quote, source: 'on-device model', category: d.category, aboutName: d.about });
    }
  }
  onProgress(parts.length, parts.length);
  return found;
}
