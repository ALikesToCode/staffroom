import type { Entity, Kind, Source } from './types';
import { findByRule, nameParts, wholeWordMatcher } from './rules';

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
 * Build the vault from everything the guard found. People who share a name
 * part ("Aarav" and "Aarav Sharma") become one entity. Later sources never
 * override an earlier one, so the class list and the rules take priority
 * over the model.
 */
export function buildVault(note: string, candidates: Candidate[]): Entity[] {
  const entities: Entity[] = [];
  const counters: Partial<Record<Kind, number>> = {};
  const isPerson = (k: Kind) => k === 'student' || k === 'adult';

  const add = (c: Candidate): Entity | undefined => {
    const text = c.text.trim();
    if (!text || !appearsIn(note, text)) return undefined;

    if (isPerson(c.kind)) {
      const parts = nameParts(text).map(norm);
      if (parts.length === 0) return undefined;
      // "Aarav" and "Aarav Sharma" are one person. "Aarav Sharma" and
      // "Diya Sharma" are two: neither name is contained in the other.
      const within = (a: string[], b: string[]) => a.every((p) => b.includes(p));
      const same = entities.find((e) => {
        if (!isPerson(e.kind)) return false;
        const theirs = [...new Set(e.surfaces.flatMap((s) => nameParts(s).map(norm)))];
        return within(parts, theirs) || within(theirs, parts);
      });
      if (same) {
        addSurfaces(same, text);
        // The longest form is the one we restore to.
        same.surfaces.sort((a, b) => b.length - a.length);
        return same;
      }
    } else {
      const same = entities.find((e) => e.kind === c.kind && e.surfaces.some((s) => norm(s) === norm(text)));
      if (same) return same;
    }

    const n = (counters[c.kind] = (counters[c.kind] ?? 0) + 1);
    const entity: Entity = {
      id: `${c.kind}-${n}`,
      kind: c.kind,
      token: c.kind === 'private' ? PRIVATE_TOKEN : `[${TOKEN_NAME[c.kind]} ${n}]`,
      surfaces: [],
      source: c.source,
      withheld: true,
      category: c.category,
    };
    addSurfaces(entity, text);
    entities.push(entity);
    return entity;
  };

  const addSurfaces = (e: Entity, text: string) => {
    const all = isPerson(e.kind) ? [text, ...nameParts(text)] : [text];
    for (const s of all) {
      if (!e.surfaces.some((x) => norm(x) === norm(s))) e.surfaces.push(s);
    }
  };

  for (const c of candidates.filter((c) => c.kind !== 'private')) add(c);
  for (const c of candidates.filter((c) => c.kind === 'private')) {
    const e = add(c);
    if (e && c.aboutName) {
      const parts = nameParts(c.aboutName).map(norm);
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
 * nearest before it in the same paragraph.
 */
function attachPrivateDetails(note: string, entities: Entity[]) {
  const lower = note.toLowerCase();
  const students = entities.filter((e) => e.kind === 'student');
  for (const p of entities.filter((e) => e.kind === 'private' && !e.about)) {
    const at = lower.indexOf(p.surfaces[0].toLowerCase());
    if (at < 0) continue;
    const paragraphStart = lower.lastIndexOf('\n', at) + 1;
    const before = lower.slice(paragraphStart, at);
    let best: { id: string; pos: number } | undefined;
    for (const s of students) {
      for (const surface of s.surfaces) {
        const pos = before.lastIndexOf(surface.toLowerCase());
        if (pos >= 0 && (!best || pos > best.pos)) best = { id: s.id, pos };
      }
    }
    if (best) p.about = best.id;
  }
}

/** Candidates from the class list and from the pattern rules. */
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
  return out;
}

export interface Segment {
  text: string;
  entity?: Entity;
}

/** Split the note into plain text and found items, for display. */
export function segment(note: string, entities: Entity[]): Segment[] {
  const lookup = new Map<string, Entity>();
  for (const e of entities) for (const s of e.surfaces) lookup.set(norm(s), e);
  const matcher = wholeWordMatcher([...entities.flatMap((e) => e.surfaces)]);
  if (!matcher) return [{ text: note }];
  const out: Segment[] = [];
  let at = 0;
  for (const m of note.matchAll(matcher)) {
    if (m.index > at) out.push({ text: note.slice(at, m.index) });
    out.push({ text: m[0], entity: lookup.get(norm(m[0])) });
    at = m.index + m[0].length;
  }
  if (at < note.length) out.push({ text: note.slice(at) });
  return out;
}

/** The text that may leave the device: every withheld item replaced by its stand-in. */
export function redact(note: string, entities: Entity[]): string {
  return segment(note, entities)
    .map((s) => (s.entity && s.entity.withheld ? s.entity.token : s.text))
    .join('');
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
  // Keep the teacher's earlier choices.
  for (const e of next) {
    const old = entities.find((o) => o.kind === e.kind && norm(o.surfaces[0]) === norm(e.surfaces[0]));
    if (old) {
      e.withheld = old.withheld;
      e.about = e.about ?? old.about;
    }
  }
  return next;
}
