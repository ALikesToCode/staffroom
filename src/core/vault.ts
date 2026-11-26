import type { Entity, Kind, Source } from './types';
import { findByRule, findSensitive, nameParts, nameWords, wholeWordMatcher } from './rules';

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

export interface Candidate {
  kind: Kind;
  text: string;
  source: Source;
  category?: string;
  /** For private details: the name of the person it is about, as written. */
  aboutName?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** True when `text` appears in `note`, ignoring case and spacing. */
export function appearsIn(note: string, text: string): boolean {
  return text.trim().length > 0 && norm(note).includes(norm(text));
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
 * Later sources never override an earlier one, so the class list and the
 * rules take priority over the model.
 */
export function buildVault(note: string, candidates: Candidate[]): Entity[] {
  interface Draft {
    kind: Kind;
    source: Source;
    surfaces: string[];
    category?: string;
    /** For people: each name as a candidate gave it, in full. */
    given: string[];
  }
  const isPerson = (k: Kind) => k === 'student' || k === 'adult';
  const wordsOf = (d: Draft) => [...new Set(d.surfaces.flatMap((s) => nameWords(s).map(norm)))];
  const within = (a: string[], b: string[]) => a.every((p) => b.includes(p));

  // The whole name is always a surface, however short. Only the parts are filtered.
  const addSurfaces = (d: Draft, text: string) => {
    const all = isPerson(d.kind) ? [text, ...nameParts(text)] : [text];
    for (const s of all) {
      if (!d.surfaces.some((x) => norm(x) === norm(s))) d.surfaces.push(s);
    }
  };

  let drafts: Draft[] = [];
  const addDraft = (c: Candidate): Draft | undefined => {
    const text = c.text.trim();
    if (!text || !appearsIn(note, text)) return undefined;
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
    addSurfaces(same, text);
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
  drafts = drafts.filter((d) => d.surfaces.length > 0);

  const counters: Partial<Record<Kind, number>> = {};
  const entities: Entity[] = [];
  const toEntity = (d: Draft, n: number): Entity => ({
    id: `${d.kind}-${n}`,
    kind: d.kind,
    token: d.kind === 'private' ? PRIVATE_TOKEN : `[${TOKEN_NAME[d.kind]} ${n}]`,
    surfaces: d.surfaces,
    source: d.source,
    withheld: true,
    category: d.category,
  });
  const number = (d: Draft): Entity => {
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

  // Private details come last. Each new one is numbered as it is first seen; a repeat finds its entity again.
  drafts = [];
  for (const c of candidates.filter((c) => c.kind === 'private')) {
    const d = addDraft(c);
    if (!d) continue;
    let e = entities.find((x) => x.surfaces === d.surfaces);
    if (!e) e = number(d);
    if (c.aboutName && !e.about) {
      const parts = [norm(c.aboutName), ...nameWords(c.aboutName).map(norm)];
      const person = entities.find(
        (p) => p.kind === 'student' && p.surfaces.some((s) => parts.includes(norm(s))),
      );
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
    const at = lower.indexOf(p.surfaces[0].toLowerCase());
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
  for (const name of classList) {
    const m = wholeWordMatcher([name, ...nameParts(name)]);
    if (m && m.test(note)) out.push({ kind: 'student', text: name, source: 'class list' });
  }
  // A class-list name may be written in the note only by its first name.
  for (const c of out) {
    if (!appearsIn(note, c.text)) {
      const part = nameParts(c.text).find((p) => wholeWordMatcher([p])!.test(note));
      if (part) c.text = part;
    }
  }
  for (const hit of findByRule(note)) out.push({ kind: hit.kind, text: hit.text, source: 'rule' });
  for (const hit of findSensitive(note)) out.push({ kind: 'private', text: hit.text, source: 'rule', category: hit.category });
  return out;
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
    for (const m of note.matchAll(matcher)) ranges.push({ start: m.index, end: m.index + m[0].length, entity });
  }
  if (ranges.length === 0) return [{ text: note }];
  // Painted in this order, so the last to paint a character owns it:
  // released before withheld, short before long, later items before earlier ones.
  const order = new Map(entities.map((e, i) => [e, i]));
  ranges.sort(
    (a, b) =>
      Number(a.entity.withheld) - Number(b.entity.withheld) ||
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

/** The text that may leave the device: every withheld item replaced by its stand-in. */
export function redact(note: string, entities: Entity[]): string {
  const out: string[] = [];
  let lastWasPrivate = false;
  for (const s of segment(note, entities)) {
    if (!s.entity || !s.entity.withheld) {
      out.push(s.text);
      lastWasPrivate = false;
      continue;
    }
    // Two private details that run into each other are written as one stand-in.
    const isPrivate = s.entity.token === PRIVATE_TOKEN;
    if (!(isPrivate && lastWasPrivate)) out.push(s.entity.token);
    lastWasPrivate = isPrivate;
  }
  return out.join('');
}

/**
 * Apply the school's locks to the vault: an item of a locked kind is
 * withheld, whatever the teacher chose and whenever the policy arrived.
 * The outgoing text is always computed from the result of this.
 */
export function applyLocks(entities: Entity[], lockedKinds: Kind[]): Entity[] {
  return entities.map((e) => (lockedKinds.includes(e.kind) && !e.withheld ? { ...e, withheld: true } : e));
}

/** Put real names back into text that came from the cloud. Runs on the device. */
export function restore(text: string, entities: Entity[]): string {
  const byToken = new Map(entities.filter((e) => e.kind !== 'private').map((e) => [e.token, e]));
  return text.replace(TOKEN_RE, (t) => byToken.get(t)?.surfaces[0] ?? t);
}

/** Add an item the teacher marked by hand. */
export function addByTeacher(note: string, entities: Entity[], text: string, kind: Kind): Entity[] {
  const candidates: Candidate[] = entities.map((e) => ({
    kind: e.kind,
    text: e.surfaces[0],
    source: e.source,
    category: e.category,
  }));
  const next = buildVault(note, [...candidates, { kind, text, source: 'teacher' }]);
  // Keep the teacher's earlier choices, and who each private detail is about. Ids can shift when the
  // vault is rebuilt, so the student is found again by name; a fresh guess never replaces what was known.
  const sameItem = (a: Entity, b: Entity) => a.kind === b.kind && norm(a.surfaces[0]) === norm(b.surfaces[0]);
  for (const e of next) {
    const old = entities.find((o) => sameItem(o, e));
    if (!old) continue;
    e.withheld = old.withheld;
    if (e.kind !== 'private') continue;
    const wasAbout = entities.find((o) => o.id === old.about);
    const nowAbout = wasAbout && next.find((n) => sameItem(n, wasAbout));
    if (nowAbout) e.about = nowAbout.id;
  }
  return next;
}
