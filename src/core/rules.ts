import type { Kind } from './types';

/** A deterministic hit. No model is involved in these. */
export interface RuleHit {
  kind: Kind;
  text: string;
  start: number;
  end: number;
  rule: string;
}

interface Rule {
  name: string;
  kind: Kind;
  re: RegExp;
}

const RULES: Rule[] = [
  { name: 'email address', kind: 'contact', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // (the roll rule below: a single digit counts only after "no.", "number" or "#", so "the bread roll is 5 rupees" is left alone)
  // 12 digits in groups of four: the format of an Aadhaar number.
  { name: '12-digit identity number', kind: 'id', re: /(?<![\d-])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\d-])/g },
  // Indian mobile numbers, with or without +91, and other long digit runs written as phone numbers.
  { name: 'phone number', kind: 'contact', re: /(?<![\d-])(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\d-])/g },
  { name: 'phone number', kind: 'contact', re: /(?<![\d-])\+\d{1,3}[ -]?\d[\d -]{7,12}\d(?![\d-])/g },
  {
    name: 'roll or admission number',
    kind: 'id',
    re: /\b(?:roll|admission|adm\.?|registration|reg\.?|enrolment|enrollment|student id|udise)\s*(?:(?:no\.?|number|#)\s*(?:(?:is|was)\s+)?[:#-]?\s*(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]*|(?:(?:is|was)\s+)?[:#-]?\s*(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{1,})/gi,
  },
  {
    name: 'date of birth',
    kind: 'id',
    re: /\b(?:dob|d\.o\.b\.?|date of birth|born on)\s*[:-]?\s*\d{1,2}(?:[/.-]\d{1,2}[/.-]\d{2,4}|\s+[A-Za-z]{3,9}\s+\d{2,4})/gi,
  },
];

/** Find contact details and identity numbers by pattern. Longer hits win overlaps. */
export function findByRule(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      hits.push({ kind: rule.kind, text: m[0], start: m.index, end: m.index + m[0].length, rule: rule.name });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: RuleHit[] = [];
  for (const h of hits) {
    const last = kept[kept.length - 1];
    if (last && h.start < last.end) {
      if (h.end - h.start > last.end - last.start) kept[kept.length - 1] = h;
      continue;
    }
    kept.push(h);
  }
  return kept;
}

const HONORIFICS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'madam', 'maam', 'shri', 'smt', 'kumari', 'master', 'the',
]);

/**
 * Words a model sometimes hands back as part of a name ("his mother
 * Sunita"). They are never a name or a part of one: withholding "his" or
 * "mother" on its own would blank out half the note.
 */
const NOT_A_NAME = new Set([
  'his', 'her', 'their', 'mother', 'father', 'parent', 'parents', 'grandmother', 'grandfather', 'uncle', 'aunt',
  'brother', 'sister', 'teacher', 'sir', 'madam',
]);

/**
 * Every word of a name, short ones included, without honorifics.
 * "Mrs. Om Rao" gives ["Om", "Rao"]. Used to tell two people apart.
 */
export function nameWords(name: string): string[] {
  return name
    .split(/[\s.,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !HONORIFICS.has(p.toLowerCase()) && !NOT_A_NAME.has(p.toLowerCase()));
}

/**
 * The parts of a name that are withheld when they stand alone.
 * "Mrs. Kavita Rao" gives ["Kavita", "Rao"]. A part shorter than three
 * letters is left out, because on its own it is too often an ordinary word.
 * The whole name is always withheld, however short: see buildVault.
 */
export function nameParts(name: string): string[] {
  return nameWords(name).filter((p) => p.length >= 3);
}

/** Escape a string for use inside a regular expression. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EDGE_BEFORE = '(?<![\\p{L}\\p{N}])';
const EDGE_AFTER = '(?![\\p{L}\\p{N}])';

/** A whole-word, case-insensitive matcher for a set of strings, longest first. */
export function wholeWordMatcher(surfaces: string[]): RegExp | null {
  const unique = [...new Set(surfaces.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  unique.sort((a, b) => b.length - a.length);
  const body = unique.map((s) => escapeRe(s).replace(/\s+/g, '\\s+')).join('|');
  return new RegExp(`${EDGE_BEFORE}(?:${body})${EDGE_AFTER}`, 'giu');
}

// ---------------------------------------------------------------- sensitive words

/**
 * A short, fixed list of words that mark a sentence as private. It is no
 * match for a model: it knows these words and nothing else. It runs in
 * every mode, so a note is never sent with one of these in plain sight
 * only because no model was there to read it.
 */
const SENSITIVE: { category: string; terms: string[] }[] = [
  { category: 'health', terms: ['epilepsy', 'seizure', 'asthma', 'diabetes', 'disability', 'medication', 'hospital', 'pregnant'] },
  {
    category: 'family',
    terms: [
      'separating', 'separated', 'divorce', 'divorced', 'died', 'death', 'orphan', 'lost his job', 'lost her job',
      'unemployed', 'debt', 'alcohol', 'abuse', 'violence',
    ],
  },
  { category: 'identity', terms: ['caste', 'religion'] },
];

/** The same word with a plain plural "s" also counts: "seizures", "debts". */
const SENSITIVE_RE = SENSITIVE.map((group) => ({
  category: group.category,
  re: new RegExp(
    `${EDGE_BEFORE}(?:${group.terms.map((t) => escapeRe(t).replace(/\s+/g, '\\s+')).join('|')})s?${EDGE_AFTER}`,
    'iu',
  ),
}));

/** A full stop after one of these does not end a sentence. */
const ABBREVIATIONS = new Set([...HONORIFICS, 'no', 'nos', 'adm', 'reg', 'std', 'st', 'dob']);

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/** Split text into sentences, without the closing punctuation. A line break also ends a sentence. */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  const close = (to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /[\s.!?]/.test(text[end - 1])) end--;
    if (end > start) out.push({ text: text.slice(start, end), start, end });
    from = to;
  };
  for (const m of text.matchAll(/[.!?]+(?=\s|$)|\n+/g)) {
    if (m[0] === '.') {
      const word = /[\p{L}]+$/u.exec(text.slice(from, m.index))?.[0].toLowerCase();
      if (word && ABBREVIATIONS.has(word)) continue;
    }
    close(m.index + m[0].length);
  }
  close(text.length);
  return out;
}

export interface SensitiveHit extends Sentence {
  category: string;
}

/** Every sentence that contains a word from the sensitive list, whole. No model is involved. */
export function findSensitive(text: string): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  for (const sentence of sentences(text)) {
    const group = SENSITIVE_RE.find((g) => g.re.test(sentence.text));
    if (group) hits.push({ ...sentence, category: group.category });
  }
  return hits;
}

// ---------------------------------------------------------------- possible names

/** Capitalised words that are not names. Months and days, and words a note often capitalises. */
const NOT_A_PROPER_NAME = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'class', 'notes', 'note', 'i', 'the', 'he', 'she', 'they', 'we', 'it', 'grade', 'section', 'std', 'standard', 'roll',
  'school', 'term', 'week', 'maths', 'english', 'hindi', 'science', 'aadhaar', 'dob', 'udise', 'ptm',
  ...HONORIFICS,
  ...NOT_A_NAME,
]);

export interface PossibleName {
  kind: 'adult' | 'place';
  text: string;
  start: number;
  end: number;
}

/**
 * Words that may be a name because they are capitalised in mid-sentence.
 * Used only when no model read the note. A word is passed over when it
 * starts a sentence, is on the class list, or is a month, a day or one of
 * a few ordinary capitalised words. After "to", "in", "at" or "from" the
 * guess is a place; otherwise an adult.
 */
export function findPossibleNames(text: string, classList: string[]): PossibleName[] {
  const listed = new Set(classList.flatMap((name) => nameWords(name).map((w) => w.toLowerCase())));
  const skip = (word: string) => listed.has(word.toLowerCase()) || NOT_A_PROPER_NAME.has(word.toLowerCase());
  const out: PossibleName[] = [];
  const run = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{M}]+(?:[ \t]+\p{Lu}[\p{L}\p{M}]+)*(?![\p{L}\p{N}])/gu;
  for (const sentence of sentences(text)) {
    for (const m of sentence.text.matchAll(run)) {
      const words = [...m[0].matchAll(/[\p{L}\p{M}]+/gu)].map((w) => ({ text: w[0], at: m.index + w.index }));
      // Ordinary words at either end of a run are dropped; a run made only of them is no name.
      let from = 0;
      let to = words.length;
      while (from < to && skip(words[from].text)) from++;
      while (to > from && skip(words[to - 1].text)) to--;
      if (from >= to) continue;
      // The first word of a sentence is capitalised whatever it is, so one capitalised word there says nothing.
      const opensSentence = from === 0 && !/[\p{L}\p{N}]/u.test(sentence.text.slice(0, m.index));
      if (opensSentence && to - from === 1) continue;
      const start = sentence.start + words[from].at;
      const end = sentence.start + words[to - 1].at + words[to - 1].text.length;
      const before = /([\p{L}]+)[ \t]+$/u.exec(text.slice(Math.max(0, start - 12), start))?.[1].toLowerCase();
      const kind = before && ['to', 'in', 'at', 'from'].includes(before) ? 'place' : 'adult';
      out.push({ kind, text: text.slice(start, end), start, end });
    }
  }
  return out;
}
