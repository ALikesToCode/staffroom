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
  /** A further test on a match, for what a pattern alone cannot say. */
  accept?: (m: RegExpMatchArray) => boolean;
}

/** What may stand between groups of digits: a space, a tab, a no-break, thin or narrow space, or a hyphen. */
const GAP = '[ \\t\\u00A0\\u2009\\u202F-]';
const digits = (s: string) => s.replace(/\D/g, '').length;

const RULES: Rule[] = [
  { name: 'email address', kind: 'contact', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // 12 digits in groups of four: the format of an Aadhaar number.
  { name: '12-digit identity number', kind: 'id', re: new RegExp(`(?<![\\d-])\\d{4}${GAP}?\\d{4}${GAP}?\\d{4}(?![\\d-])`, 'g') },
  // Indian mobile numbers, with or without +91, and other long digit runs written as phone numbers.
  { name: 'phone number', kind: 'contact', re: new RegExp(`(?<![\\d-])(?:\\+?91${GAP}?|0)?[6-9]\\d{4}${GAP}?\\d{5}(?![\\d-])`, 'g') },
  { name: 'phone number', kind: 'contact', re: /(?<![\d-])\+\d{1,3}[ \t\u00A0\u2009\u202F-]?\d[\d \t\u00A0\u2009\u202F-]{7,12}\d(?![\d-])/g },
  // A mobile number in any grouping: ten digits, the first 6 to 9, in at most five groups:
  // "98 76 54 32 10", "987 654 3210", "987-654-3210".
  {
    name: 'phone number',
    kind: 'contact',
    re: new RegExp(`(?<![\\d-])(?:\\+?91${GAP}?|0)?([6-9](?:${GAP}?\\d){9})(?![\\d-])`, 'g'),
    accept: (m) => m[1].replace(/\d/g, '').length <= 4,
  },
  // A number with part of it in brackets: "(98765) 43210", "(+91) 98765 43210", "(022) 2345 6789".
  {
    name: 'phone number',
    kind: 'contact',
    re: new RegExp(`(?<![\\d-])(?:\\+?\\d{1,3}${GAP}?)?\\(\\+?\\d{1,5}\\)${GAP}?\\d{3,5}(?:${GAP}?\\d{3,5}){0,2}(?![\\d-])`, 'g'),
    accept: (m) => digits(m[0]) >= 10 && digits(m[0]) <= 13,
  },
  // A landline: 0, an STD code of two to four digits, then six to eight digits: "022 2345 6789", "080-23456789".
  {
    name: 'phone number',
    kind: 'contact',
    re: new RegExp(`(?<![\\d-])0\\d{2,4}${GAP}?\\d{3,4}${GAP}?\\d{3,4}(?![\\d-])`, 'g'),
    accept: (m) => digits(m[0]) >= 9 && digits(m[0]) <= 13,
  },
  // After "roll", "admission" and the like. After an explicit "no.", "number" or "#" every group of digits
  // that follows is part of it ("Admission no. AB 12 345"). A single digit counts only after such a label, so
  // "the bread roll is 5 rupees" is left alone. The number may be written with a letter prefix and a space
  // ("AB 12345"); the prefix must be in capitals, so an ordinary word before a number is not taken for one.
  {
    name: 'roll or admission number',
    kind: 'id',
    re: /\b(?:roll|admission|adm\.?|registration|reg\.?|enrolment|enrollment|student id|udise)\s*(?:(?:no\.?|number|#)\s*(?:(?:is|was)\s+)?[:#-]?\s*(?:([A-Z]{1,5})[ \u00A0\u202F])?(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]*(?:[ \u00A0\u202F]\d+(?![A-Za-z\d]))*|(?:(?:is|was)\s+)?[:#-]?\s*(?:([A-Z]{1,5})[ \u00A0\u202F])?(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{1,})/gi,
    accept: (m) => [m[1], m[2]].every((prefix) => prefix === undefined || prefix === prefix.toUpperCase()),
  },
  // A code of capital letters and at least five digits standing on its own: "AB 12345", "KV-204518".
  { name: 'roll or admission number', kind: 'id', re: /(?<![\p{L}\p{N}])[A-Z]{2,5}[ \u00A0\u202F-]?\d{5,10}(?![\p{L}\p{N}])/gu },
  {
    name: 'date of birth',
    kind: 'id',
    re: /\b(?:dob|d\.o\.b\.?|date of birth|born on)\s*[:-]?\s*\d{1,2}(?:[/.-]\d{1,2}[/.-]\d{2,4}|\s+[A-Za-z]{3,9}\s+\d{2,4})/gi,
  },
];

/**
 * Find contact details and identity numbers by pattern. Hits that overlap
 * are all kept: where "Roll no. 98765 43210" is both a roll number and a
 * phone number, both are returned, so the whole of it is withheld. A hit
 * that lies wholly inside another of the same kind is left out, since it
 * adds nothing. One of another kind is kept: the phone number inside
 * "Roll no. 9876543210" is still a contact detail, and stays withheld
 * under a lock on contact details when the identity number is released.
 */
export function findByRule(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      if (rule.accept && !rule.accept(m)) continue;
      hits.push({ kind: rule.kind, text: m[0], start: m.index, end: m.index + m[0].length, rule: rule.name });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: RuleHit[] = [];
  for (const h of hits) {
    if (kept.some((k) => k.kind === h.kind && k.start <= h.start && h.end <= k.end)) continue;
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
 * "Mrs. Om Rao" gives ["Om", "Rao"], and "Mary-Jane Lee" gives
 * ["Mary", "Jane", "Lee"]. Used to tell two people apart.
 */
export function nameWords(name: string): string[] {
  return name
    .split(/[\s.,\u2010\u2011-]+/)
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

/**
 * The parts of a class-list name that are withheld when they stand alone:
 * every word of two letters or more. A single letter, such as the initial
 * in "A. Kumar", is never withheld on its own, or every "A" and "I" in the
 * note would go. The whole name is still withheld wherever it is written.
 */
export function listedParts(name: string): string[] {
  // "Mary-Jane Lee" gives "Mary-Jane" as well as "Mary" and "Jane", so the pair is one stand-in, not two.
  const joined = name.split(/[\s.,]+/).filter((p) => /[\u2010\u2011-]/.test(p) && nameWords(p).length > 1);
  return [...new Set([...joined, ...nameWords(name)])].filter((p) => [...p.normalize('NFC')].length >= 2);
}

const APOSTROPHE = /['\u2019\u02BC]/;

/** Escape a string for use inside a regular expression. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A pattern that finds a string however its accents are written and
 * however its words are spaced. "José" may be typed as one letter é or as e
 * followed by a combining accent; the two look the same and both must be
 * found. The pattern is run on the note as written, so the places it
 * reports are places in the note itself.
 */
export function patternFor(text: string): string {
  let out = '';
  for (const ch of text.trim().normalize('NFC')) {
    if (/\s/.test(ch)) {
      if (!out.endsWith('\\s+')) out += '\\s+';
      continue;
    }
    // A straight and a curly apostrophe are the same letter of a name: "D'Souza" is "D’Souza".
    if (APOSTROPHE.test(ch)) {
      out += "['\u2019\u02BC]";
      continue;
    }
    const apart = ch.normalize('NFD');
    out += apart === ch ? escapeRe(ch) : `(?:${escapeRe(ch)}|${escapeRe(apart)})`;
  }
  return out;
}

/** The same text whichever way its accents and spacing were typed. Used to compare, never to locate. */
export function sameForm(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/['\u2019\u02BC]/g, "'").replace(/\s+/g, ' ').trim();
}

// A combining mark belongs to the letter before it, so it counts as part of the word on both sides.
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}])';
const EDGE_AFTER = '(?![\\p{L}\\p{N}\\p{M}])';

/** True for a character that is part of a word: a letter, a digit or a combining mark. */
export function isWordChar(c: string | undefined): boolean {
  return !!c && /[\p{L}\p{N}\p{M}]/u.test(c);
}

/** A whole-word, case-insensitive matcher for a set of strings, longest first. */
export function wholeWordMatcher(surfaces: string[]): RegExp | null {
  const unique = [...new Set(surfaces.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  unique.sort((a, b) => b.length - a.length);
  return new RegExp(`${EDGE_BEFORE}(?:${unique.map(patternFor).join('|')})${EDGE_AFTER}`, 'giu');
}

// ---------------------------------------------------------------- sensitive words

/**
 * A short, fixed list of words that mark a sentence as private. It is no
 * match for a model: it knows these words and nothing else. It runs in
 * every mode, so a note is never sent with one of these in plain sight
 * only because no model was there to read it.
 */
const SENSITIVE: { category: string; terms: string[] }[] = [
  {
    category: 'health',
    terms: [
      'epilepsy', 'seizure', 'asthma', 'diabetes', 'disability', 'disabled', 'medication', 'medicine', 'hospital', 'pregnant', 'pregnancy',
      'adhd', 'allergy', 'allergies', 'allergic', 'mental health', 'therapy', 'counsellor', 'counselor',
      // "fits" alone is an ordinary word ("this fits the class"), so it counts only as something a child has or gets.
      'gets fits', 'get fits', 'getting fits', 'has fits', 'have fits', 'had fits', 'having fits',
      'cancer', 'hiv', 'tb', 'depression', 'depressed', 'anxiety', 'self-harm', 'self harm', 'suicide', 'suicidal',
      'autism', 'autistic', 'dyslexia', 'dyslexic',
      // Hinglish and Devanagari health terms common in Indian staffroom notes.
      'mirgi', 'मिर्गी', 'daura', 'दौरा', 'dama', 'दमा', 'dawai', 'दवाई', 'bimar', 'बीमार', 'bimari', 'बीमारी', 'aspatal', 'अस्पताल',
    ],
  },
  {
    category: 'family',
    terms: [
      'separating', 'separated', 'divorce', 'divorced', 'died', 'death', 'passed away', 'orphan',
      'stepfather', 'stepmother', 'step-father', 'step-mother', 'step father', 'step mother', 'lost his job', 'lost her job',
      'unemployed', 'debt', 'alcohol', 'alcoholic', 'drinks', 'drinking', 'drunk', 'abuse', 'abused', 'violence',
      'homeless', 'hungry',
      // Hinglish and Devanagari family/financial hardship terms.
      'talaq', 'तलाक', 'karz', 'कर्ज़', 'कर्ज', 'paise nahi', 'पैसे नहीं', 'fees nahi', 'फ़ीस नहीं', 'naukri chali', 'नौकरी चली', 'sharab', 'शराब',
    ],
  },
  { category: 'safety', terms: ['jail', 'jailed', 'prison', 'police', 'arrested', 'beats', 'beaten', 'beating', 'hits', 'bullied', 'marpeet', 'मारपीट', 'pitai', 'पिटाई'] },
  { category: 'identity', terms: ['caste', 'religion', 'dalit', 'sc/st', 'muslim', 'hindu', 'christian', 'sikh'] },
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

/** Split text into sentences, without the closing punctuation. A line break or Devanagari danda also ends a sentence. */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let from = 0;
  const close = (to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /[\s.!?।॥]/.test(text[end - 1])) end--;
    if (end > start) out.push({ text: text.slice(start, end), start, end });
    from = to;
  };
  for (const m of text.matchAll(/(?:[.!?]+(?=\s|$)|[।॥]+(?:\s+|$)|\n+)/g)) {
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

/**
 * Ordinary words that often open a sentence. A capitalised word in that
 * place is held as a possible name unless it is one of these. The list is
 * short on purpose: a word missing from it is withheld, which the teacher
 * can undo, and a name wrongly on it would be sent.
 */
const SENTENCE_OPENERS = new Set([
  'a', 'an', 'this', 'that', 'these', 'those', 'there', 'here', 'you', 'your', 'my', 'our', 'its', 'us',
  'in', 'on', 'at', 'to', 'for', 'from', 'with', 'without', 'by', 'of', 'as', 'after', 'before', 'during', 'since', 'until',
  'when', 'while', 'if', 'but', 'and', 'or', 'so', 'because', 'although', 'though', 'however', 'also', 'then', 'now', 'still',
  'what', 'where', 'why', 'how', 'who', 'which',
  'some', 'most', 'all', 'no', 'not', 'none', 'many', 'few', 'both', 'each', 'every', 'any', 'another', 'other', 'others',
  'one', 'two', 'three', 'four', 'five', 'six', 'last', 'next', 'once',
  'please', 'today', 'tomorrow', 'yesterday', 'tonight', 'sometimes', 'often', 'always', 'never', 'usually', 'maybe', 'perhaps',
  'is', 'are', 'was', 'were', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'must', 'do', 'does', 'did',
  'needs', 'need', 'ask', 'ring', 'call', 'see', 'check', 'seat', 'give', 'tell', 'move', 'remind', 'send', 'plan', 'write',
  'everyone', 'everybody', 'nobody', 'someone', 'children', 'pupils', 'students', 'boys', 'girls', 'homework', 'reading', 'writing',
  'yes', 'thanks', 'thank', 'dear', 'hello',
]);

export interface PossibleName {
  kind: 'adult' | 'place';
  text: string;
  start: number;
  end: number;
}

/**
 * Words that may be a name because they are capitalised. Used only when
 * no model read the note. A word is passed over when it is on the class
 * list, is a month, a day or one of a few ordinary capitalised words, or
 * opens a sentence and is an ordinary opener such as "The" or "When". After "to", "in", "at" or "from" the
 * guess is a place; otherwise an adult.
 */
export function findPossibleNames(text: string, classList: string[]): PossibleName[] {
  const listed = new Set(classList.flatMap((name) => nameWords(name).map((w) => w.toLowerCase())));
  const skip = (word: string) => listed.has(word.toLowerCase()) || NOT_A_PROPER_NAME.has(word.toLowerCase());
  const out: PossibleName[] = [];
  // A capitalised word. An apostrophe before another capital is inside the word ("D’Souza", "O'Brien");
  // one before a small letter is not ("Sunita's").
  const word = "\\p{Lu}(?:[\\p{L}\\p{M}]|['\\u2019\\u02BC](?=\\p{Lu}))+";
  const run = new RegExp(`(?<![\\p{L}\\p{N}])${word}(?:[ \\t]+${word})*(?![\\p{L}\\p{N}])`, 'gu');
  for (const sentence of sentences(text)) {
    for (const m of sentence.text.matchAll(run)) {
      const words = [...m[0].matchAll(new RegExp(word, 'gu'))].map((w) => ({ text: w[0], at: m.index + w.index }));
      // Ordinary words at either end of a run are dropped; a run made only of them is no name.
      let from = 0;
      let to = words.length;
      while (from < to && skip(words[from].text)) from++;
      while (to > from && skip(words[to - 1].text)) to--;
      // The first word of a sentence is capitalised whatever it is. An ordinary opener there is no name; any
      // other word is held, since "Sunita rang" and "Homework rang" look the same to a rule.
      const opensSentence = from === 0 && !/[\p{L}\p{N}]/u.test(sentence.text.slice(0, m.index));
      if (opensSentence && SENTENCE_OPENERS.has(words[0].text.toLowerCase())) {
        from++;
        while (from < to && skip(words[from].text)) from++;
      }
      if (from >= to) continue;
      const start = sentence.start + words[from].at;
      const end = sentence.start + words[to - 1].at + words[to - 1].text.length;
      const before = /([\p{L}]+)[ \t]+$/u.exec(text.slice(Math.max(0, start - 12), start))?.[1].toLowerCase();
      const kind = before && ['to', 'in', 'at', 'from'].includes(before) ? 'place' : 'adult';
      out.push({ kind, text: text.slice(start, end), start, end });
    }
  }
  return out;
}

/** The words from the sensitive list that a text uses, in lower case, once each. */
export function sensitiveWords(text: string): string[] {
  const found = new Set<string>();
  for (const group of SENSITIVE_RE) {
    for (const m of text.matchAll(new RegExp(group.re.source, 'giu'))) found.add(m[0].toLowerCase().replace(/\s+/g, ' '));
  }
  return [...found];
}
