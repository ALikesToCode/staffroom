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
  // 12 digits in groups of four: the format of an Aadhaar number.
  { name: '12-digit identity number', kind: 'id', re: /(?<![\d-])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\d-])/g },
  // Indian mobile numbers, with or without +91, and other long digit runs written as phone numbers.
  { name: 'phone number', kind: 'contact', re: /(?<![\d-])(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\d-])/g },
  { name: 'phone number', kind: 'contact', re: /(?<![\d-])\+\d{1,3}[ -]?\d[\d -]{7,12}\d(?![\d-])/g },
  {
    name: 'roll or admission number',
    kind: 'id',
    re: /\b(?:roll|admission|adm\.?|registration|reg\.?|enrolment|enrollment|student id|udise)\s*(?:no\.?|number|#)?\s*[:#-]?\s*(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{1,}/gi,
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
 * The parts of a name that identify a person on their own.
 * "Mrs. Kavita Rao" gives ["Kavita", "Rao"].
 */
export function nameParts(name: string): string[] {
  return name
    .split(/[\s.,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && !HONORIFICS.has(p.toLowerCase()));
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
