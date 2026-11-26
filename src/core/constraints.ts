import type { Constraint, ConstraintKind, Entity } from './types';
import { sentences } from './rules';
import { addByTeacher, ownerAt, PRIVATE_TOKEN, segment } from './vault';

// A constraint is a private fact that rules something out for one student, or for the class.
// Everything here is plain code and runs with no model. Nothing here is ever sent anywhere.

export const CONSTRAINT_KINDS: ConstraintKind[] = [
  'time-after',
  'time-before',
  'days-away',
  'money',
  'no-phone-internet',
  'contact',
  'health',
  'other',
];

/** Every kind a row can have: the constraints, and a learning need, which rules nothing out and has no rule. */
export const ALL_KINDS: ConstraintKind[] = [...CONSTRAINT_KINDS, 'learning'];

export const CONSTRAINT_LABEL: Record<ConstraintKind, string> = {
  'time-after': 'Cannot stay after school',
  'time-before': 'Cannot come before school',
  'days-away': 'Away on some days',
  money: 'Family cannot pay for anything extra',
  'no-phone-internet': 'No phone or internet at home',
  contact: 'An adult not to contact',
  health: 'Health',
  other: 'Other',
  learning: 'Learning need',
};

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DAY = '(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)days?';
const DAYS = `${DAY}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+or\\s+)${DAY})*`;

/** The weekdays a text names, in full and once each: "Fridays and Saturdays" gives Friday, Saturday. */
export function daysIn(text: string): string[] {
  const found = [...text.matchAll(new RegExp(`(?<![\\p{L}])${DAY}(?![\\p{L}])`, 'giu'))].map((m) => {
    const day = m[0].toLowerCase().replace(/s$/, '');
    return WEEKDAYS.find((d) => d.toLowerCase() === day)!;
  });
  return WEEKDAYS.filter((d) => found.includes(d));
}

const ROLE_WORDS = 'father|mother|dad|daddy|mum|mummy|mom|papa|amma|stepfather|stepmother|uncle|aunt|grandfather|grandmother|brother|sister|guardian|parents';
const GUARDIAN_WORDS =
  'grandmother|grandfather|grandparents|aunt|uncle|elder sister|elder brother|older sister|older brother|sister|brother|guardian|foster family|foster parents|neighbour';
const ROLE_AS: Record<string, string> = { dad: 'father', daddy: 'father', papa: 'father', mum: 'mother', mummy: 'mother', mom: 'mother', amma: 'mother' };
const role = (word: string) => ROLE_AS[word.toLowerCase()] ?? word.toLowerCase();

const NOT_CONTACTED = '(?:must not|should not|is not to|are not to|not to|cannot|can\'t)\\s+be\\s+(?:contacted|called|phoned|telephoned|informed|told)';
const DO_NOT_CONTACT = '(?:do not|don\'t|never)\\s+(?:contact|call|phone|ring|telephone|message|write to|inform|tell)';
const LIVES_WITH = `(?:lives?|living|stays?|staying)\\s+with\\s+(?:his|her|their|an?|the)\\s+(${GUARDIAN_WORDS})`;
const GONE = '(?:has\\s+)?(?:died|passed away|is dead|is no more|left home|left the family|has left|is in prison|is in jail|works? away|works? abroad)';
const APART = 'parents\\s+(?:are|have)\\s+(?:separating|separated|divorcing|divorced|split up|not together|living apart)';

/** For a contact constraint: the adult, whether that adult is simply not there, and who looks after the child instead. */
function contactOf(text: string): Pick<Constraint, 'who' | 'guardian' | 'away'> {
  const re = (source: string) => new RegExp(source, 'iu');
  let m = re(`\\b(${ROLE_WORDS})\\b[^;,]{0,60}?${NOT_CONTACTED}`).exec(text) ?? re(`${DO_NOT_CONTACT}\\s+(?:(?:his|her|their|the)\\s+)?(${ROLE_WORDS})\\b`).exec(text);
  if (m) return { who: role(m[1]) };
  m = re(LIVES_WITH).exec(text);
  if (m) return { who: 'parents', guardian: m[1].toLowerCase(), away: true };
  m = re(`\\b(${ROLE_WORDS})\\s+${GONE}`).exec(text);
  if (m) return { who: role(m[1]), away: true };
  if (re(APART).test(text)) return { who: 'parents', away: true };
  m = re(`\\b(${ROLE_WORDS})\\b`).exec(text);
  return m ? { who: role(m[1]) } : {};
}

/** Health conditions the rules know, with words that go against each in a step. The teacher can change the words. */
const CONDITIONS: { re: RegExp; triggers: string[] }[] = [
  { re: /\b(?:epilepsy|epileptic|seizures?)\b/iu, triggers: ['flashing', 'flicker', 'flickering', 'strobe', 'strobing'] },
  { re: /\basthma(?:tic)?\b/iu, triggers: ['running', 'sprint', 'race', 'laps', 'dust', 'chalk dust', 'smoke'] },
];

const ALLERGY = /\b(\p{L}+)\s+allerg(?:y|ies)\b|\ballergic\s+to\s+(\p{L}+)(?:\s+and\s+(\p{L}+))?|\ballerg(?:y|ies)\s+to\s+(\p{L}+)/iu;
const NOT_AN_ALLERGEN = new Set(['an', 'a', 'the', 'has', 'have', 'her', 'his', 'bad', 'severe', 'serious', 'food']);

function triggersOf(text: string): string[] {
  const out = CONDITIONS.filter((c) => c.re.test(text)).flatMap((c) => c.triggers);
  const m = ALLERGY.exec(text);
  for (const word of m ? [m[1], m[2], m[3], m[4]] : []) {
    if (!word || NOT_AN_ALLERGEN.has(word.toLowerCase())) continue;
    const w = word.toLowerCase().replace(/s$/, '');
    out.push(w);
    if (w === 'nut') out.push('peanut');
    if (w === 'peanut') out.push('nut');
  }
  return [...new Set(out)];
}

/** What the words of a constraint give for its kind: the days, the adult, the trigger words. */
export function defaultsFor(kind: ConstraintKind, text: string): Pick<Constraint, 'days' | 'who' | 'guardian' | 'away' | 'triggers'> {
  if (kind === 'days-away') return { days: daysIn(text) };
  if (kind === 'contact') return contactOf(text);
  if (kind === 'health') return { triggers: triggersOf(text) };
  return {};
}

const CANNOT = "(?:cannot|can't|can not|is not able to|are not able to|is unable to|are unable to|unable to|must not|may not|is not allowed to)";
const DEVICE = '(?:smart\\s?phone|mobile phone|mobile|phone|internet|wi-?fi|computer|network)';
// To the end of the clause. Sentences are already cut at a full stop; a semicolon ends a clause inside one.
const REST = '[^;]*';

/** The patterns, in order. In one sentence the first pattern of a kind gives the words; later ones only add to it. */
const PATTERNS: { kind: ConstraintKind; re: RegExp }[] = (
  [
    [
      'time-after',
      `(?:(?:has|have|had|needs?)\\s+to|must)\\s+(?:leave|go home|be home|get home|reach home|walk home)\\b[^;]*?(?:(?:at|by|after|when|with)\\s+the\\s+(?:last|final)\\s+bell|straight after school|as soon as school ends|before dark)${REST}`,
    ],
    ['time-after', `${CANNOT}\\s+stay\\b${REST}`],
    ['time-after', `(?:leaves?|goes home|is collected|is picked up)\\s+(?:school\\s+)?(?:at|with|straight after)\\s+the\\s+(?:last|final)\\s+bell${REST}`],
    [
      'time-before',
      `(?:now\\s+)?(?:helps?|works?|is helping|is working|has to help|has to work|sells?|delivers?)\\b[^;]{0,80}?\\bbefore\\s+(?:school|the first bell|class(?:es)?)\\b`,
    ],
    ['time-before', `${CANNOT}\\s+(?:come|arrive|reach school|get to school|be at school)\\b[^;]{0,40}?(?:early|before\\s+(?:school|the first bell))${REST}`],
    [
      'days-away',
      `(?:is\\s+)?(?:away|absent|not in school|not at school|out of school|misses school|does not come(?: to school)?|doesn't come(?: to school)?|cannot come(?: to school)?)\\s+(?:on|every|each)\\s+${DAYS}`,
    ],
    ['money', `(?:cannot|can't|can not|could not|is unable to|are unable to|is not able to|are not able to|unable to)\\s+(?:pay|afford)\\b${REST}`],
    ['money', `(?:has|have|there is)\\s+no\\s+money\\b${REST}`],
    ['no-phone-internet', `(?:(?:has|have|had|there is|with)\\s+)?no\\s+${DEVICE}\\b${REST}`],
    ['no-phone-internet', `(?:does not|doesn't|do not|don't)\\s+have\\s+(?:a\\s+|an\\s+|any\\s+)?${DEVICE}\\b${REST}`],
    ['no-phone-internet', `without\\s+(?:a\\s+|an\\s+|any\\s+)?${DEVICE}\\b${REST}`],
    ['contact', `(?:(?:his|her|their|the)\\s+)?(?:${ROLE_WORDS})\\b[^;,]{0,60}?${NOT_CONTACTED}${REST}`],
    ['contact', `${NOT_CONTACTED}${REST}`],
    ['contact', `${DO_NOT_CONTACT}\\b${REST}`],
    ['contact', `${LIVES_WITH}\\b`],
    ['contact', `(?:(?:his|her|their)\\s+)?(?:${ROLE_WORDS})\\s+${GONE}\\b${REST}`],
    ['contact', `${APART}\\b`],
    ['health', `(?:(?:has|have|had|with|gets?)\\s+)?(?:epilepsy|epileptic(?:\\s+(?:fits|seizures?))?|seizures?)`],
    ['health', `(?:(?:has|have|had|with)\\s+)?asthma(?:tic)?`],
    ['health', `(?:(?:has|have|had)\\s+(?:an?\\s+)?)?(?:\\p{L}+\\s+allerg(?:y|ies)|allergic\\s+to\\s+\\p{L}+(?:\\s+and\\s+\\p{L}+)?|allerg(?:y|ies)\\s+to\\s+\\p{L}+)`],
  ] as [ConstraintKind, string][]
).map(([kind, source]) => ({ kind, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu') }));

const nameOf = (entities: Entity[], id: string | undefined) => entities.find((e) => e.id === id)?.surfaces[0];

/**
 * Propose constraints from the note, by rule. Each is a clause of the
 * note, word for word, with the kind its pattern gives. Whose it is comes
 * from the same rule the vault uses for a private detail; when that is not
 * plain it is about the class. Nothing is confirmed here: the teacher does that.
 */
export function proposeConstraints(note: string, entities: Entity[]): Constraint[] {
  const out: Constraint[] = [];
  for (const s of sentences(note)) {
    const inSentence = new Map<ConstraintKind, Constraint>();
    for (const p of PATTERNS) {
      const m = p.re.exec(s.text);
      if (!m) continue;
      const text = m[0].replace(/[\s,]+$/, '');
      const at = s.start + m.index;
      const extra = defaultsFor(p.kind, text);
      if (p.kind === 'days-away' && (extra.days ?? []).length === 0) continue;
      const first = inSentence.get(p.kind);
      if (first) {
        // The same kind twice in one sentence is one constraint. The later match only fills in what the first lacks.
        first.guardian ??= extra.guardian;
        if (extra.triggers) first.triggers = [...new Set([...(first.triggers ?? []), ...extra.triggers])];
        continue;
      }
      const about = ownerAt(note, entities, at, at + text.length);
      const c: Constraint = { id: `rule-${at}-${p.kind}`, kind: p.kind, text, at, ...extra, source: 'rule', confirmed: false };
      if (about) {
        c.about = about;
        c.aboutName = nameOf(entities, about);
      }
      inSentence.set(p.kind, c);
      out.push(c);
    }
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/** The vault and the constraints, changed together. */
export interface Held {
  entities: Entity[];
  constraints: Constraint[];
}

/** Where a constraint's words stand in the note: at its own place, or the first place they are found. */
function placeOf(note: string, c: Constraint): { start: number; end: number } | undefined {
  if (c.text.length === 0) return undefined;
  if (c.at !== undefined && note.slice(c.at, c.at + c.text.length) === c.text) return { start: c.at, end: c.at + c.text.length };
  const at = note.indexOf(c.text);
  return at < 0 ? undefined : { start: at, end: at + c.text.length };
}

/** The withheld private item that holds back the characters from `start` to `end`, when one holds all of them. */
function privateOwner(note: string, entities: Entity[], start: number, end: number): Entity | undefined {
  const share = new Map<Entity, number>();
  let at = 0;
  for (const s of segment(note, entities)) {
    const stop = at + s.text.length;
    const overlap = Math.min(stop, end) - Math.max(at, start);
    if (overlap > 0) {
      if (!s.entity || !s.entity.withheld) return undefined;
      if (s.entity.kind === 'private') share.set(s.entity, (share.get(s.entity) ?? 0) + overlap);
    }
    at = stop;
  }
  return [...share.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Confirm a constraint. Its words in the note are withheld as a private
 * detail: the item that already holds them back is used, or one is made
 * for exactly those words. The constraint is tied to that item, which
 * cannot be released while the constraint is confirmed. Words the teacher
 * typed that are not in the note are in no outgoing text, so there is
 * nothing to withhold.
 */
export function confirmConstraint(note: string, entities: Entity[], constraints: Constraint[], id: string): Held {
  const c = constraints.find((x) => x.id === id);
  if (!c) return { entities, constraints };
  let next = entities;
  let detailId: string | undefined;
  const place = placeOf(note, c);
  if (place) {
    let owner = privateOwner(note, next, place.start, place.end);
    if (!owner) {
      next = addByTeacher(note, next, c.text, 'private', place);
      owner = privateOwner(note, next, place.start, place.end);
    }
    detailId = owner?.id;
  }
  const confirmed: Constraint = { ...c, confirmed: true, ...(place ? { at: place.start } : {}) };
  if (detailId) confirmed.detailId = detailId;
  else delete confirmed.detailId;
  return { entities: next, constraints: constraints.map((x) => (x.id === id ? confirmed : x)) };
}

/** Take the confirmation back. The words stay withheld until the teacher releases them. */
export function unconfirmConstraint(constraints: Constraint[], id: string): Constraint[] {
  // Only a confirmed constraint can be told to the cloud as a need, so the switch goes off with it.
  return constraints.map((c) => (c.id === id ? { ...c, confirmed: false, share: false } : c));
}

/** Tell the cloud the need of a confirmed constraint, or stop telling it. An unconfirmed constraint is never shared. */
export function setShare(constraints: Constraint[], id: string, share: boolean): Constraint[] {
  return constraints.map((c) => (c.id === id ? { ...c, share: share && c.confirmed } : c));
}

/** Set the need line the teacher typed, for a health or "other" constraint. */
export function setNeed(constraints: Constraint[], id: string, typed: string): Constraint[] {
  return constraints.map((c) => {
    if (c.id !== id) return c;
    // Other words need their own tick: the one given was for the line as it was.
    const { needAck: _ack, ...rest } = c;
    return { ...rest, need: typed.slice(0, 200) };
  });
}

export function removeConstraint(constraints: Constraint[], id: string): Constraint[] {
  return constraints.filter((c) => c.id !== id);
}

/** Change the kind. What the old kind read from the words (days, adult, trigger words) is read again for the new one. */
export function setConstraintKind(constraints: Constraint[], id: string, kind: ConstraintKind): Constraint[] {
  return constraints.map((c) => {
    if (c.id !== id) return c;
    const { days: _days, who: _who, guardian: _guardian, away: _away, triggers: _triggers, need: _need, learn: _learn, needAck: _ack, ...rest } = c;
    // Another kind has another need line, so the need is not told until the teacher switches it on again.
    return { ...rest, kind, share: false, ...defaultsFor(kind, c.text) };
  });
}

/** For a lesson: tick or untick "send this need as worded" for a need line with a word from the sensitive list. */
export function setNeedAck(constraints: Constraint[], id: string, on: boolean): Constraint[] {
  return constraints.map((c) => {
    if (c.id !== id) return c;
    const { needAck: _ack, ...rest } = c;
    return on ? { ...rest, needAck: true } : rest;
  });
}

/** Set the trigger words of a health constraint, as the teacher typed them, separated by commas. */
export function setTriggers(constraints: Constraint[], id: string, typed: string): Constraint[] {
  const triggers = [...new Set(typed.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
  return constraints.map((c) => (c.id === id ? { ...c, triggers } : c));
}

/**
 * Add a constraint by hand: a student (or none, for the class), a kind and
 * the words. It is confirmed at once, since the teacher wrote it. If the
 * words stand in the note they are withheld.
 */
export function addConstraint(
  note: string,
  entities: Entity[],
  constraints: Constraint[],
  by: { kind: ConstraintKind; about?: string; text: string; at?: number },
): Held {
  const text = by.text.trim();
  if (text.length === 0) return { entities, constraints };
  const n = Math.max(0, ...constraints.map((c) => Number(/^teacher-(\d+)$/.exec(c.id)?.[1]) || 0)) + 1;
  const c: Constraint = { id: `teacher-${n}`, kind: by.kind, text, ...defaultsFor(by.kind, text), source: 'teacher', confirmed: false };
  if (by.at !== undefined) c.at = by.at;
  const student = entities.find((e) => e.id === by.about && e.kind === 'student');
  if (student) {
    c.about = student.id;
    c.aboutName = student.surfaces[0];
  }
  return confirmConstraint(note, entities, [...constraints, c], c.id);
}

/** The ids of the vault items that confirmed constraints hold back. */
export function heldByConstraints(constraints: Constraint[]): Set<string> {
  return new Set(constraints.filter((c) => c.confirmed && c.detailId).map((c) => c.detailId!));
}

/**
 * The vault with every confirmed constraint's item withheld, whatever its
 * switch says. The outgoing text is always computed from the result of
 * this, so the cloud never sees a confirmed constraint.
 */
export function lockConstraints(entities: Entity[], constraints: Constraint[]): Entity[] {
  const held = heldByConstraints(constraints);
  if (held.size === 0) return entities;
  return entities.map((e) => (held.has(e.id) && !e.withheld ? { ...e, withheld: true } : e));
}

/**
 * Bring kept constraints back after the guard has run again on the same
 * note. The vault was rebuilt, so each is tied again to its student by
 * name and, if confirmed, to the item that holds its words back. A fresh
 * proposal in the place of a kept constraint is dropped.
 */
export function restoreConstraints(note: string, entities: Entity[], kept: Constraint[], proposed: Constraint[]): Held {
  const students = entities.filter((e) => e.kind === 'student');
  const old = kept
    .filter((c) => c.confirmed || c.source === 'teacher')
    .map((c) => {
      const { about: _about, detailId: _detailId, ...rest } = c;
      const student = students.find((s) => c.aboutName !== undefined && s.surfaces.includes(c.aboutName));
      return student ? { ...rest, about: student.id } : { ...rest, aboutName: undefined };
    });
  const overlaps = (a: Constraint, b: Constraint) =>
    a.at !== undefined && b.at !== undefined && a.at < b.at + b.text.length && b.at < a.at + a.text.length;
  let held: Held = { entities, constraints: [...old, ...proposed.filter((p) => !old.some((o) => overlaps(o, p)))] };
  for (const c of old) if (c.confirmed) held = confirmConstraint(note, held.entities, held.constraints, c.id);
  return { entities: held.entities, constraints: held.constraints.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity)) };
}

/** How many constraints are confirmed, and of which kinds. This is all a receipt holds of them. */
export function constraintCounts(constraints: Constraint[]): { confirmed: number; byKind: Partial<Record<ConstraintKind, number>> } {
  const byKind: Partial<Record<ConstraintKind, number>> = {};
  for (const c of constraints) if (c.confirmed) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  return { confirmed: constraints.filter((c) => c.confirmed).length, byKind };
}

/**
 * The vault as the check reads it: with one more private detail for each
 * confirmed constraint whose words are not in the note (the teacher typed
 * them). Only for the check. These are never used to write outgoing text.
 */
export function withConstraintFacts(entities: Entity[], constraints: Constraint[]): Entity[] {
  const typed = constraints.filter((c) => c.confirmed && !c.detailId);
  if (typed.length === 0) return entities;
  return [
    ...entities,
    ...typed.map(
      (c): Entity => ({
        id: `fact-${c.id}`,
        kind: 'private',
        token: PRIVATE_TOKEN,
        surfaces: [c.text],
        source: 'teacher',
        withheld: true,
        ...(c.about ? { about: c.about } : {}),
      }),
    ),
  ];
}
