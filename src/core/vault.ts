import type { Draft, Entity, Kind, Source } from './types';
import { findByRule, findPossibleNames, findSensitive, isWordChar, listedParts, nameParts, nameWords, patternFor, sameForm, wholeWordMatcher } from './rules';

const TOKEN_NAME: Record<Kind, string> = {
  student: 'Student',
  adult: 'Adult',
  place: 'Place',
  contact: 'Contact',
  id: 'ID',
  private: 'withheld',
};

/** The text written in place of a private detail. It is never restored. */
export const PRIVATE_TOKEN = '[withheld]';

/** Matches every stand-in the redactor can write. */
export const TOKEN_RE = /\[(?:Student|Adult|Place|Contact|ID) \d+\]/g;

/**
 * Anything that looks like a stand-in, in any case or spacing: "[student 7]",
 * "[Student7]", "[ withheld ]". Used to catch one typed into the raw note and
 * one a reply invents.
 */
export const LOOKALIKE_RE = /\[\s*(?:student|adult|place|contact|id)\s*\d+\s*\]|\[\s*withheld\s*\]/gi;

/**
 * A stand-in written without its square brackets: "Student 1", "ID 2". A
 * model asked for "[Student 1]" sometimes writes it this way, most often in
 * a heading.
 */
export const BARE_RE = /(?<![[\p{L}\p{N}])(?:Student|Adult|Place|Contact|ID)[ \u00A0]\d+(?![\p{L}\p{N}\]])/gu;

const bracketed = (bare: string) => `[${bare.replace('\u00A0', ' ')}]`;

/**
 * Put the brackets back on a bare stand-in, when the bracketed form is one
 * the redactor wrote into the approved text (`sent`). Any other is left as
 * it came: it is flagged by the return gate and never turned into a name.
 */
export function bracketBare(text: string, sent: readonly string[]): string {
  return text.replace(BARE_RE, (bare) => (sent.includes(bracketed(bare)) ? bracketed(bare) : bare));
}

/** The bare stand-ins in a text whose bracketed form was not in the approved text, once each. */
export function bareNotSent(text: string, sent: readonly string[]): string[] {
  return [...new Set([...text.matchAll(BARE_RE)].map((m) => m[0]).filter((bare) => !sent.includes(bracketed(bare))))];
}

/** A draft with the brackets put back on every bare stand-in that was sent. The reply as it came is kept apart, for the cloud lane. */
export function bracketDraft(draft: Draft, sent: readonly string[]): Draft {
  return {
    title: bracketBare(draft.title, sent),
    items: draft.items.map((i) => ({ heading: bracketBare(i.heading, sent), text: bracketBare(i.text, sent) })),
  };
}

/** The category of a stand-in look-alike found in the raw note. It is always withheld and cannot be released. */
export const RESERVED = 'stand-in';

/** Withheld by the teacher's choice, or because it can never be released. */
const held = (e: Entity) => e.withheld || e.category === RESERVED;

export interface Candidate {
  kind: Kind;
  text: string;
  source: Source;
  category?: string;
  /** For private details: the name of the person it is about, as written. */
  aboutName?: string;
}

const norm = sameForm;

/** True when `text` appears in `note`, ignoring case and spacing. */
export function appearsIn(note: string, text: string): boolean {
  return text.trim().length > 0 && norm(note).includes(norm(text));
}

/**
 * The text as the note writes it, widened to whole words. A selection or a
 * model's quote that cuts a word ("Rampur Kal", "AB1234" inside "XAB12345")
 * would be listed in the vault and then not found by the whole-word search,
 * so it would be sent. Widening it means anything marked is really withheld.
 * Returns undefined when the text is not in the note at all.
 */
export function widenToWords(note: string, text: string): string | undefined {
  const wanted = text.trim();
  if (!wanted) return undefined;
  const whole = wholeWordMatcher([wanted])!.exec(note);
  if (whole) return whole[0];
  const loose = new RegExp(patternFor(wanted), 'iu').exec(note);
  if (!loose) return undefined;
  const [start, end] = wordSpan(note, loose.index, loose.index + loose[0].length);
  return note.slice(start, end);
}

/** A span of the note widened so that it starts and ends at the edge of a word. */
export function wordSpan(note: string, from: number, to: number): [number, number] {
  let start = Math.max(0, Math.min(from, note.length));
  let end = Math.max(start, Math.min(to, note.length));
  while (start < end && /\s/.test(note[start])) start++;
  while (end > start && /\s/.test(note[end - 1])) end--;
  while (start > 0 && isWordChar(note[start - 1])) start--;
  while (end < note.length && isWordChar(note[end])) end++;
  return [start, end];
}

/** True when every character of the span is held back: none of it is in the outgoing text. */
export function covered(note: string, entities: Entity[], from: number, to: number): boolean {
  let at = 0;
  for (const s of segment(note, entities)) {
    const end = at + s.text.length;
    if (end > from && at < to && !(s.entity && held(s.entity))) return false;
    at = end;
  }
  return true;
}

/**
 * Build the vault from everything the guard found.
 *
 * People: a short form and a full form of the same kind ("Aarav" and
 * "Aarav Sharma", both students) become one entity. Two people of
 * different kinds are never merged: an adult "Mrs. Sharma" stays apart
 * from the student "Aarav Sharma". A name or part that more than one
 * person could own (a bare "Sharma" beside two Sharmas) is given to none
 * of them: it becomes a withheld item of its own.
 *
 * A name from the class list is held with every one of its words, short
 * ones included ("Om Rao" also withholds a lone "Om"), wherever any of
 * them stands in the note. Everything else is taken as the note writes
 * it, widened to whole words. A private detail gets one entry for each
 * place it occurs, so the same phrase about two children is two entries.
 *
 * Later sources never override an earlier one, so the class list and the
 * rules take priority over the model.
 */
interface Sketch {
  kind: Kind;
  source: Source;
  surfaces: string[];
  category?: string;
}

/**
 * Add a private detail: one entry for each place its words stand in the
 * note, each tied to that place. Returns the entries for this detail that
 * occur once only (a model's "about" can be trusted for those; where the
 * words occur twice, each entry is attached by where it stands).
 */
function addPrivate(note: string, entities: Entity[], c: Candidate, number: (d: Sketch) => Entity): Entity[] {
  const text = widenToWords(note, c.text);
  if (!text) return [];
  const hits = [...note.matchAll(wholeWordMatcher([text])!)];
  const mine: Entity[] = [];
  for (const hit of hits) {
    let e = entities.find((x) => x.kind === 'private' && x.at === hit.index && norm(x.surfaces[0]) === norm(hit[0]));
    if (!e) {
      e = number({ kind: 'private', source: c.source, surfaces: [hit[0]], category: c.category });
      e.at = hit.index;
    }
    mine.push(e);
  }
  return hits.length === 1 ? mine : [];
}

export function buildVault(note: string, candidates: Candidate[]): Entity[] {
  interface Draft extends Sketch {
    /** For people: each name as a candidate gave it, in full. */
    given: string[];
  }
  const isPerson = (k: Kind) => k === 'student' || k === 'adult';
  const wordsOf = (d: Draft) => [...new Set(d.surfaces.flatMap((s) => nameWords(s).map(norm)))];
  const within = (a: string[], b: string[]) => a.every((p) => b.includes(p));

  // The whole name is always a surface, however short. The parts of a listed name count from two
  // letters up; the parts of a name found any other way count from three letters up.
  const addSurfaces = (d: Draft, text: string, listed: boolean) => {
    const all = isPerson(d.kind) ? [text, ...(listed ? listedParts(text) : nameParts(text))] : [text];
    for (const s of all) {
      if (!d.surfaces.some((x) => norm(x) === norm(s))) d.surfaces.push(s);
    }
  };

  let drafts: Draft[] = [];
  const addDraft = (c: Candidate): Draft | undefined => {
    const listed = c.source === 'class list' && isPerson(c.kind);
    // A listed name is taken as the list writes it, and need not be in the note in full.
    const text = listed ? c.text.trim() : widenToWords(note, c.text);
    if (!text) return undefined;
    let same: Draft | undefined;
    if (isPerson(c.kind)) {
      // Every word counts here, short ones too: "Om" and "Jo" are two people.
      const words = nameWords(text).map(norm);
      if (words.length === 0) return undefined;
      // Only the same kind can be the same person. "Aarav" and "Aarav Sharma" are one;
      // "Aarav Sharma" and "Diya Sharma" are two: neither name is contained in the other.
      const matches = drafts.filter((d) => {
        if (d.kind !== c.kind) return false;
        const theirs = wordsOf(d);
        return within(words, theirs) || within(theirs, words);
      });
      // A name that fits more than one person is not handed to the first of them.
      same =
        matches.find((d) => wordsOf(d).length === words.length && within(words, wordsOf(d))) ??
        (matches.length === 1 ? matches[0] : undefined);
    } else {
      same = drafts.find((d) => d.kind === c.kind && d.surfaces.some((s) => norm(s) === norm(text)));
      if (same) return same;
    }
    if (!same) {
      same = { kind: c.kind, source: c.source, surfaces: [], category: c.category, given: [] };
      drafts.push(same);
    }
    addSurfaces(same, text, listed);
    if (isPerson(c.kind)) {
      same.given.push(norm(text));
      // The longest form is the one we restore to.
      same.surfaces.sort((a, b) => b.length - a.length);
    }
    return same;
  };

  for (const c of candidates.filter((c) => c.kind !== 'private')) addDraft(c);

  // A name or part claimed by more than one person belongs to none of them.
  const claims = new Map<string, Draft[]>();
  for (const d of drafts.filter((d) => isPerson(d.kind))) {
    for (const s of d.surfaces) claims.set(norm(s), [...(claims.get(norm(s)) ?? []), d]);
  }
  const shared: Draft[] = [];
  for (const [key, claimants] of claims) {
    if (claimants.length < 2) continue;
    const written = claimants[0].surfaces.find((s) => norm(s) === key)!;
    for (const d of claimants) d.surfaces = d.surfaces.filter((s) => norm(s) !== key);
    // Its kind is that of whoever was given exactly this name, or the kind they all share.
    const owner = claimants.find((d) => d.given.includes(key));
    const kind = owner?.kind ?? (claimants.every((d) => d.kind === claimants[0].kind) ? claimants[0].kind : 'adult');
    shared.push({ kind, source: (owner ?? claimants[0]).source, surfaces: [written], given: [key] });
  }
  // What is left of each draft must stand somewhere in the note. A listed name that does not is left out.
  drafts = drafts.filter((d) => d.surfaces.length > 0 && wholeWordMatcher(d.surfaces)!.test(note));

  const counters: Partial<Record<Kind, number>> = {};
  const entities: Entity[] = [];
  const toEntity = (d: Sketch, n: number): Entity => ({
    id: `${d.kind}-${n}`,
    kind: d.kind,
    token: d.kind === 'private' ? PRIVATE_TOKEN : `[${TOKEN_NAME[d.kind]} ${n}]`,
    surfaces: d.surfaces,
    source: d.source,
    withheld: true,
    category: d.category,
  });
  const number = (d: Sketch): Entity => {
    const entity = toEntity(d, (counters[d.kind] = (counters[d.kind] ?? 0) + 1));
    entities.push(entity);
    return entity;
  };
  for (const d of drafts) number(d);
  // A shared name is kept only where it stands alone in the note, outside every fuller name.
  for (const d of shared) {
    const probe = toEntity(d, 0);
    if (segment(note, [...entities, probe]).some((s) => s.entity === probe)) number(d);
  }

  // Private details come last, one entry for each place the words stand in the note.
  for (const c of candidates.filter((c) => c.kind === 'private')) {
    for (const e of addPrivate(note, entities, c, number)) {
      if (!c.aboutName || e.about) continue;
      const parts = [norm(c.aboutName), ...nameWords(c.aboutName).map(norm)];
      const person = entities.find((p) => p.kind === 'student' && p.surfaces.some((s) => parts.includes(norm(s))));
      if (person) e.about = person.id;
    }
  }
  attachPrivateDetails(note, entities);
  return entities;
}

/**
 * A private detail with no known subject is attached to the student named
 * inside it, or else to the student named nearest before it in the same
 * paragraph. Names are matched as whole words.
 */
function attachPrivateDetails(note: string, entities: Entity[]) {
  const lower = note.toLowerCase();
  const students = entities.filter((e) => e.kind === 'student');
  const mentions = (text: string, last: boolean) => {
    let best: { id: string; pos: number } | undefined;
    for (const s of students) {
      for (const m of text.matchAll(wholeWordMatcher(s.surfaces)!)) {
        if (!best || (last ? m.index > best.pos : m.index < best.pos)) best = { id: s.id, pos: m.index };
      }
    }
    return best;
  };
  for (const p of entities.filter((e) => e.kind === 'private' && !e.about)) {
    const at = p.at ?? lower.indexOf(p.surfaces[0].toLowerCase());
    if (at < 0) continue;
    const paragraphStart = lower.lastIndexOf('\n', at) + 1;
    const best = mentions(p.surfaces[0], false) ?? mentions(note.slice(paragraphStart, at), true);
    if (best) p.about = best.id;
  }
}

/**
 * Candidates that need no model: the class list, the pattern rules, and the
 * sentences that contain a word from the sensitive list. Used in every mode.
 */
export function deterministicCandidates(note: string, classList: string[]): Candidate[] {
  const out: Candidate[] = [];
  // A listed name counts when the note has it in full or has any one of its words of two letters or more.
  for (const name of classList) {
    const m = wholeWordMatcher([name, ...listedParts(name)]);
    if (m && m.test(note)) out.push({ kind: 'student', text: name, source: 'class list' });
  }
  for (const hit of findByRule(note)) out.push({ kind: hit.kind, text: hit.text, source: 'rule' });
  for (const hit of findSensitive(note)) out.push({ kind: 'private', text: hit.text, source: 'rule', category: hit.category });
  // Text typed into the note that looks like one of the app's own stand-ins must not go out looking like one.
  for (const m of note.matchAll(LOOKALIKE_RE)) out.push({ kind: 'private', text: m[0], source: 'rule', category: RESERVED });
  // The same without brackets ("Student 2"): a reply that echoed it would be read as that stand-in.
  for (const m of note.matchAll(BARE_RE)) out.push({ kind: 'private', text: m[0], source: 'rule', category: RESERVED });
  return out;
}

/** The category of a possible name found by its capital letter. */
export const CAPITALISED = 'capitalised word';

/**
 * Extra candidates for when no model read the note: words that may be a
 * name because they are capitalised in mid-sentence. A guess, so the
 * teacher can release each one.
 */
export function possibleNameCandidates(note: string, classList: string[]): Candidate[] {
  return findPossibleNames(note, classList).map((hit) => ({ kind: hit.kind, text: hit.text, source: 'rule', category: CAPITALISED }));
}

export interface Segment {
  text: string;
  entity?: Entity;
}

/**
 * Split the note into plain text and found items. Every item is searched for
 * on its own, as whole words, so one item can never hide another.
 * Where items overlap, a withheld item always wins over a released one, and
 * a longer withheld item wins over a shorter one. Releasing a private detail
 * therefore never releases a name or a number written inside it.
 */
export function segment(note: string, entities: Entity[]): Segment[] {
  const ranges: { start: number; end: number; entity: Entity }[] = [];
  for (const entity of entities) {
    const matcher = wholeWordMatcher(entity.surfaces);
    if (!matcher) continue;
    for (const m of note.matchAll(matcher)) {
      // A private detail is tied to one place in the note. The same words elsewhere are another entry's.
      if (entity.at !== undefined && m.index !== entity.at) continue;
      ranges.push({ start: m.index, end: m.index + m[0].length, entity });
    }
  }
  if (ranges.length === 0) return [{ text: note }];
  // Painted in this order, so the last to paint a character owns it:
  // released before withheld, short before long, later items before earlier ones.
  const order = new Map(entities.map((e, i) => [e, i]));
  ranges.sort(
    (a, b) =>
      Number(held(a.entity)) - Number(held(b.entity)) ||
      a.end - a.start - (b.end - b.start) ||
      order.get(b.entity)! - order.get(a.entity)! ||
      a.start - b.start,
  );
  const owner: (Entity | undefined)[] = new Array(note.length).fill(undefined);
  for (const r of ranges) owner.fill(r.entity, r.start, r.end);

  const out: Segment[] = [];
  let from = 0;
  for (let i = 1; i <= note.length; i++) {
    if (i === note.length || owner[i] !== owner[from]) {
      out.push({ text: note.slice(from, i), entity: owner[from] });
      from = i;
    }
  }
  return out;
}

/** The outgoing text, with the exact set of stand-ins the redactor wrote into it. */
export interface Redaction {
  text: string;
  /** Every stand-in written into the text, once each. Only these may come back and be restored. */
  tokens: string[];
}

/** Replace every withheld item by its stand-in, and keep a list of the stand-ins used. */
export function redactWithTokens(note: string, entities: Entity[]): Redaction {
  const out: string[] = [];
  const tokens = new Set<string>();
  let lastWasPrivate = false;
  for (const s of segment(note, entities)) {
    if (!s.entity || !held(s.entity)) {
      out.push(s.text);
      lastWasPrivate = false;
      continue;
    }
    // Two private details that run into each other are written as one stand-in.
    const isPrivate = s.entity.token === PRIVATE_TOKEN;
    if (!(isPrivate && lastWasPrivate)) out.push(s.entity.token);
    tokens.add(s.entity.token);
    lastWasPrivate = isPrivate;
  }
  return { text: out.join(''), tokens: [...tokens] };
}

/** The text that may leave the device: every withheld item replaced by its stand-in. */
export function redact(note: string, entities: Entity[]): string {
  return redactWithTokens(note, entities).text;
}

/**
 * Apply the school's locks to the vault: an item of a locked kind is
 * withheld, whatever the teacher chose and whenever the policy arrived.
 * The outgoing text is always computed from the result of this.
 */
export function applyLocks(entities: Entity[], lockedKinds: Kind[]): Entity[] {
  return entities.map((e) => ((lockedKinds.includes(e.kind) || e.category === RESERVED) && !e.withheld ? { ...e, withheld: true } : e));
}

/**
 * Put real names back into text that came from the cloud. Runs on the
 * device. When `allowed` is given, only those stand-ins are restored: the
 * ones the redactor wrote into the approved text. Any other is left as it
 * came, so a stand-in the cloud was never sent is never turned into a name.
 */
export function restore(text: string, entities: Entity[], allowed?: readonly string[]): string {
  const byToken = new Map(entities.filter((e) => e.kind !== 'private').map((e) => [e.token, e]));
  return text.replace(TOKEN_RE, (t) => (allowed && !allowed.includes(t) ? t : (byToken.get(t)?.surfaces[0] ?? t)));
}

/**
 * Add an item the teacher marked by hand. The vault is added to, never
 * rebuilt: every item already in it keeps all its forms, its withheld
 * state and the student it is about.
 *
 * `span` is where in the note the selection was made. It decides which
 * words are meant: selecting "Ravi" inside "Ravinder" marks "Ravinder",
 * even though a "Ravi" stands on its own elsewhere. The span is widened to
 * whole words, and the result is checked: if the selected words would
 * still be in the outgoing text, an item tied to that exact place is added,
 * so what the teacher selected is always held back.
 *
 * Without a span the first place the text stands is taken. Text that is
 * already in the vault is set back to withheld.
 */
export function addByTeacher(note: string, entities: Entity[], text: string, kind: Kind, span?: { start: number; end: number }): Entity[] {
  let where: [number, number] | undefined;
  let marked: string | undefined;
  if (span) {
    where = wordSpan(note, span.start, span.end);
    marked = where[1] > where[0] ? note.slice(where[0], where[1]) : undefined;
  } else {
    marked = widenToWords(note, text);
  }
  if (!marked) return entities;
  const key = norm(marked);
  const has = (e: Entity, k: string) => e.surfaces.some((s) => norm(s) === k);
  const next = entities.map((e) => (has(e, key) && !e.withheld ? { ...e, withheld: true } : { ...e }));
  const number = (d: Sketch): Entity => {
    const n = Math.max(0, ...next.filter((e) => e.kind === d.kind).map((e) => Number(e.id.split('-')[1]) || 0)) + 1;
    const entity: Entity = {
      id: `${d.kind}-${n}`,
      kind: d.kind,
      token: d.kind === 'private' ? PRIVATE_TOKEN : `[${TOKEN_NAME[d.kind]} ${n}]`,
      surfaces: d.surfaces,
      source: d.source,
      withheld: true,
      category: d.category,
    };
    next.push(entity);
    return entity;
  };
  if (!entities.some((e) => has(e, key))) {
    if (kind === 'private') {
      addPrivate(note, next, { kind, text: marked, source: 'teacher' }, number);
      attachPrivateDetails(note, next);
    } else {
      // A part of a marked name is added only if nobody in the vault already has it.
      const person = kind === 'student' || kind === 'adult';
      const parts = person ? nameParts(marked).filter((p) => !next.some((e) => has(e, norm(p)))) : [];
      number({ kind, source: 'teacher', surfaces: [marked, ...parts.filter((p) => norm(p) !== key)] });
    }
  }
  // The proof: the words the teacher selected are not in the outgoing text. If they still are, hold that place itself.
  if (where && !covered(note, next, where[0], where[1])) {
    number({ kind, source: 'teacher', surfaces: [marked] }).at = where[0];
    if (kind === 'private') attachPrivateDetails(note, next);
  }
  return next;
}
