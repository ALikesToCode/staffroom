import { LESSON_NEEDS_HEADING, needLabel } from './lessonNeeds';
import { languageLine } from './lesson';

// Materials for a signed lesson: board work, a practice sheet, a version of the sheet for a need, and an
// exit ticket. One more request to the cloud. What is sent is the class plan the teacher signed and the
// needs by letter: text that was already approved, with no name in it. Whose a need is stays on the device,
// which puts the names over each version on the teacher's own print.

/** The line that stands over the request. */
export const MATERIALS_HEADING = 'Class plan to make materials for:';

/** The instruction for the materials request. */
export const MATERIALS_SYSTEM = `You write classroom materials for the lesson plan below, for a teacher with a blackboard, paper and no budget. Give:
board: what the teacher writes on the board, at most 8 short lines.
sheet: a practice sheet for the whole class, 5 to 8 questions, each one line.
versions: exactly one for every listed need. "need" is the letter only. "text" says how such a pupil does the same sheet or homework for the same purpose, in at most 4 sentences. Where the sheet already suits the need, the text is exactly "same sheet." Every listed letter must appear. Do not guess who or how many.
ticket: an exit ticket of exactly 3 short questions, each with its answer for the teacher.
Use only the plan and the needs. Never write a name. If the plan gives a language, write in that language; keep the letters of the needs as they are.`;

export const MATERIALS_SCHEMA = {
  type: 'object',
  properties: {
    board: { type: 'array', items: { type: 'string' } },
    sheet: { type: 'array', items: { type: 'string' } },
    versions: {
      type: 'array',
      items: { type: 'object', properties: { need: { type: 'string' }, text: { type: 'string' } }, required: ['need', 'text'] },
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

export interface Materials {
  board: string[];
  sheet: string[];
  /** A version of the sheet or the homework for one need, by its letter. */
  versions: { need: string; text: string }[];
  ticket: { question: string; answer: string }[];
  /** Versions left out: for a letter that was not sent, a second one for the same letter, or with no words. */
  dropped: number;
  /** The needs the cloud says the class sheet already suits. */
  same: string[];
  /** The needs that were told and got neither a version nor "same sheet". */
  missing: string[];
}

const line = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MATERIAL_LINE_MAX) : '');
const lines = (v: unknown) => (Array.isArray(v) ? v.map(line).filter(Boolean) : []);

/**
 * Read the reply strictly, section by section. It is not used at all when
 * it is not JSON, when there is no board work, when the sheet has fewer
 * than five questions, or when the exit ticket has fewer than three
 * questions with answers. More than the most allowed is cut. A version
 * counts only for a letter that was sent, once.
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
  const sheet = lines(parsed.sheet).slice(0, SHEET_MAX);
  const ticket = (Array.isArray(parsed.ticket) ? parsed.ticket : [])
    .map((t) => ({ question: line((t as { question?: unknown } | null)?.question), answer: line((t as { answer?: unknown } | null)?.answer) }))
    .filter((t) => t.question && t.answer)
    .slice(0, TICKET_QUESTIONS);
  if (board.length === 0 || sheet.length < SHEET_MIN || ticket.length < TICKET_QUESTIONS) return undefined;
  const versions: Materials['versions'] = [];
  const same: string[] = [];
  let dropped = 0;
  for (const v of Array.isArray(parsed.versions) ? parsed.versions : []) {
    const need = line((v as { need?: unknown } | null)?.need).replace(/^need\s+/i, '').replace(/[:.]$/, '').toUpperCase();
    const text = line((v as { text?: unknown } | null)?.text);
    if (!text || !letters.includes(need) || versions.some((x) => x.need === need) || same.includes(need)) dropped++;
    else if (/^same sheet\.?$/i.test(text)) same.push(need);
    else versions.push({ need, text });
  }
  return { board, sheet, versions, ticket, dropped, same, missing: letters.filter((l) => !same.includes(l) && !versions.some((v) => v.need === l)) };
}

/** The reply as one text, for the return gate: every line of every section. */
export function materialsReply(m: Materials): string {
  return [...m.board, ...m.sheet, ...m.versions.map((v) => `Sheet for Need ${v.need}: ${v.text}`), ...m.ticket.flatMap((t) => [t.question, t.answer])].join('\n');
}
