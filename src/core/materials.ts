import { LESSON_NEEDS_HEADING, needLabel } from './lessonNeeds';
import { languageLine } from './lesson';

// Materials for a signed lesson: board work, a practice sheet, a sheet of its own for each need, and an
// exit ticket. One more request to the cloud. What is sent is the class plan the teacher signed and the
// needs by letter: text that was already approved, with no name in it. Whose a need is stays on the device,
// which puts the names over each version on the teacher's own print.

/** The line that stands over the request. */
export const MATERIALS_HEADING = 'Class plan to make materials for:';

/** The instruction for the materials request. */
export const MATERIALS_SYSTEM = `You write classroom materials for the lesson plan below, for a teacher with only a chalkboard, chalk, notebooks and pens (no chart paper, markers, posters, or school library unless the plan names them). Give:
board: what the teacher writes on the chalkboard — headings, key words, and a short 3 to 4 sentence model example for a writing lesson, at most 8 short lines.
sheet: a practice sheet for the whole class, 5 to 8 questions, each one line, doable in a pupil's notebook with a pen.
versions: exactly one for every listed need. "need" is the letter only. "items" is the finished sheet the pupil works from instead of the class sheet, for the same purpose: 3 to 8 lines, each one line, written out in full (for example the exact adapted questions, actual sentence starters, or full extra challenge prompt). For an absence or catch-up need, write a self-contained 5 to 8 line take-home sheet a pupil can follow alone at home: 1) what the class learned today, 2) a short 2-line worked example, and 3) 2 to 3 practice steps they can write in a notebook without anyone helping. Never only name a resource; write out every line of it. "note" is at most one sentence for the teacher on how to hand out or use the sheet. Where the class sheet already suits the need, the note is exactly "same sheet." and "items" is empty. Every listed letter must appear. Do not guess who or how many.
ticket: an exit ticket of exactly 3 short questions to test today's skill, each with its answer for the teacher.
Use only the plan and the needs. Never write a name. If the plan gives a language, write in that language; keep the letters of the needs and "same sheet." as they are.`;

export const MATERIALS_SCHEMA = {
  type: 'object',
  properties: {
    board: { type: 'array', items: { type: 'string' } },
    sheet: { type: 'array', items: { type: 'string' } },
    versions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { need: { type: 'string' }, note: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } },
        required: ['need', 'note', 'items'],
      },
    },
    ticket: {
      type: 'array',
      items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] },
    },
  },
  required: ['board', 'sheet', 'versions', 'ticket'],
};

export const BOARD_MAX = 8;
export const SHEET_MIN = 5;
export const SHEET_MAX = 8;
export const TICKET_QUESTIONS = 3;
/** The most lines of the sheet for one need. The cloud is asked for 3 to 8. */
export const VERSION_ITEMS_MAX = 8;
/** The most characters of one line of the materials. */
export const MATERIAL_LINE_MAX = 600;

/** The line under the needs that lists the letters the cloud must give a version for. Part of the text the teacher approves. */
export const versionsAsk = (letters: readonly string[]) => `Give a version of the sheet for every one of these letters: ${letters.join(', ')}. Where the sheet already suits a need, write "same sheet."`;

/** What the cloud writes for a need the class sheet already suits. */
export const SAME_SHEET = 'same sheet.';

/**
 * The exact text of the materials request: the class plan as signed (with
 * its lines for needs, by letter) and the needs by letter. Nothing else.
 */
export function materialsText(plan: string, needs: readonly { letter: string; line: string }[], language = ''): string {
  const parts = [`${MATERIALS_HEADING}\n\n${plan.trim()}`];
  if (needs.length > 0) parts.push(`${LESSON_NEEDS_HEADING}\n${needs.map(needLabel).join('\n')}\n${versionsAsk(needs.map((n) => n.letter))}`);
  if (language.trim()) parts.push(`Language of the materials: ${languageLine(language.trim())}`);
  return parts.join('\n\n');
}

/** The sheet for one need, by its letter: the lines such a pupil works from, and a sentence for the teacher. */
export interface Version {
  need: string;
  /** For the teacher, on how to use the sheet. It is not printed on the pupil's page. */
  note: string;
  /** The lines the pupil works from, written out in full. Empty only in a version kept before they were asked for. */
  items: string[];
}

export interface Materials {
  board: string[];
  sheet: string[];
  versions: Version[];
  ticket: { question: string; answer: string }[];
  /** Versions left out: for a letter that was not sent, or a second one for the same letter. */
  dropped: number;
  /** The needs the cloud says the class sheet already suits. */
  same: string[];
  /** The needs that were told and got neither a sheet with lines on it nor "same sheet". */
  missing: string[];
}

/** A version as a saved lesson or a recorded run may hold it. One kept before the lines were asked for has only `text`, which said how to do the class sheet. */
export type StoredVersion = { need: string; note?: string; items?: string[]; text?: string };

/** A stored version in the present form: an old one's text is its note, and it has no lines. */
export function asVersion(v: StoredVersion): Version {
  return { need: v.need, note: v.note ?? v.text ?? '', items: Array.isArray(v.items) ? [...v.items] : [] };
}

const line = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MATERIAL_LINE_MAX) : '');
const lines = (v: unknown) => (Array.isArray(v) ? v.map(line).filter(Boolean) : []);

/** A question without a number the cloud put in front of it: the page numbers the questions itself. */
export const unnumbered = (q: string) => q.replace(/^\s*(?:Q\s*)?\d{1,2}\s*[.):]\s+/iu, '');

const isSame = (s: string) => /^same sheet\.?$/i.test(s);

/**
 * Read the reply strictly, section by section. It is not used at all when
 * it is not JSON, when there is no board work, when the sheet has fewer
 * than five questions, or when the exit ticket has fewer than three
 * questions with answers. More than the most allowed is cut. A version
 * counts only for a letter that was sent, once, and only with lines on it:
 * one that only says what to do, with no lines, leaves its need missing.
 */
export function readMaterials(raw: string, letters: readonly string[]): Materials | undefined {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown> | null;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const board = lines(parsed.board).slice(0, BOARD_MAX);
  const sheet = lines(parsed.sheet).map(unnumbered).filter(Boolean).slice(0, SHEET_MAX);
  const ticket = (Array.isArray(parsed.ticket) ? parsed.ticket : [])
    .map((t) => ({ question: unnumbered(line((t as { question?: unknown } | null)?.question)), answer: line((t as { answer?: unknown } | null)?.answer) }))
    .filter((t) => t.question && t.answer)
    .slice(0, TICKET_QUESTIONS);
  if (board.length === 0 || sheet.length < SHEET_MIN || ticket.length < TICKET_QUESTIONS) return undefined;
  const versions: Materials['versions'] = [];
  const same: string[] = [];
  let dropped = 0;
  for (const v of Array.isArray(parsed.versions) ? parsed.versions : []) {
    const got = v as { need?: unknown; note?: unknown; items?: unknown } | null;
    const need = line(got?.need).replace(/^need\s+/i, '').replace(/[:.]$/, '').toUpperCase();
    const note = line(got?.note);
    const items = lines(got?.items).map(unnumbered).filter(Boolean).slice(0, VERSION_ITEMS_MAX);
    if (!letters.includes(need) || versions.some((x) => x.need === need) || same.includes(need)) dropped++;
    // "same sheet." is the cloud's word that the class sheet suits, wherever it put it.
    else if (isSame(note) || (items.length === 1 && isSame(items[0]))) same.push(need);
    else if (items.length > 0) versions.push({ need, note, items });
  }
  return { board, sheet, versions, ticket, dropped, same, missing: letters.filter((l) => !same.includes(l) && !versions.some((v) => v.need === l)) };
}

/** The reply as one text, for the return gate: every line of every section. */
export function materialsReply(m: Materials): string {
  return [
    ...m.board,
    ...m.sheet,
    ...m.versions.flatMap((v) => [v.note ? `Sheet for Need ${v.need}: ${v.note}` : `Sheet for Need ${v.need}`, ...v.items]),
    ...m.ticket.flatMap((t) => [t.question, t.answer]),
  ].join('\n');
}
