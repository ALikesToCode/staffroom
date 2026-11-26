import type { Constraint, LearningKind } from './types';
import { CONTINUE, type SavedLesson } from './lesson';

// After a lesson the teacher marks, for each child on the class list, how the exit ticket went. The marks
// are kept with the lesson in this browser and nowhere else. From them the device builds needs for the next
// lesson, by rule: a line with no name and no count. Who learned what never leaves the device; the cloud
// still plans for it, and the device puts what it writes beside the right children.

export type TicketMark = 'got' | 'partly' | 'not' | 'absent';
export const TICKET_MARKS: TicketMark[] = ['got', 'partly', 'not', 'absent'];
export const TICKET_MARK: Record<TicketMark, string> = { got: 'Got it', partly: 'Partly', not: 'Not yet', absent: 'Absent' };
/** By the child's name as the class list has it. A child with no mark is not in it. */
export type Ticket = Record<string, TicketMark>;

type TicketKind = Extract<LearningKind, `ticket-${string}`>;
/** The need each mark gives. It says what the mark says and no more: how fast a child got there was never marked. */
const KIND_OF: Record<TicketMark, TicketKind> = { not: 'ticket-not', got: 'ticket-got', partly: 'ticket-partly', absent: 'ticket-absent' };

/**
 * A learning need kept before "got it" was renamed: "ticket-quick" said the
 * child got the topic quickly, which no mark records. It reads as
 * "ticket-got", with the line of that kind. Any other constraint is as it was.
 */
export function currentTicketKind(c: Constraint): Constraint {
  if ((c.learn as string) !== 'ticket-quick') return c;
  const m = /^got (.*) quickly; needs a harder task$/.exec(c.need ?? '');
  return { ...c, learn: 'ticket-got', ...(m ? { need: ticketLine('ticket-got', m[1]) } : {}) };
}

/** The most characters of a topic in a need line. */
export const TICKET_TOPIC_MAX = 60;

/** The topic as a need line says it: without "Continue: ", without a capital that could read as a name, one line. */
export function ticketTopic(topic: string): string {
  let t = topic.replace(/\s+/g, ' ').trim();
  while (t.toLowerCase().startsWith(CONTINUE.toLowerCase())) t = t.slice(CONTINUE.length).trim();
  t = t.replace(/[.\s]+$/, '').slice(0, TICKET_TOPIC_MAX).trim();
  return t ? t[0].toLowerCase() + t.slice(1) : 'the last topic';
}

/** The need line for one kind of result. No name and no count is in it. */
export function ticketLine(kind: TicketKind, topic: string): string {
  const t = ticketTopic(topic);
  if (kind === 'ticket-not') return `has not yet got ${t}; needs it taught again another way`;
  if (kind === 'ticket-got') return `got ${t} on the exit ticket; ready for a harder task`;
  if (kind === 'ticket-partly') return `partly got ${t}; needs more practice on it`;
  return `was absent for ${t}`;
}

/** True for a need that came from an exit ticket. */
export const isTicketNeed = (c: Pick<Constraint, 'learn'>) => c.learn !== undefined && c.learn.startsWith('ticket-');

const slug = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-');

/**
 * The needs a lesson's exit ticket gives the next lesson: one for each
 * child with a mark. Each is confirmed and told, as the teacher marked
 * it; on the next lesson's review it can be switched off like any other
 * need. The child's name stays on the device.
 */
export function ticketNeeds(lesson: SavedLesson): Constraint[] {
  const out: Constraint[] = [];
  for (const [name, mark] of Object.entries(lesson.after?.ticket ?? {})) {
    const kind = KIND_OF[mark];
    if (!kind || !name.trim()) continue;
    out.push({
      id: `ticket-${kind}-${slug(name)}`,
      kind: 'learning',
      learn: kind,
      text: `Exit ticket: ${TICKET_MARK[mark].toLowerCase()}`,
      aboutName: name,
      childName: name,
      need: ticketLine(kind, lesson.fields.topic),
      source: 'teacher',
      confirmed: true,
      share: true,
    });
  }
  return out;
}

/** The constraints the next lesson starts with: the ones kept, without the needs of an earlier exit ticket, and the needs of this one. */
export function withTicketNeeds(constraints: readonly Constraint[], lesson: SavedLesson): Constraint[] {
  return [...constraints.filter((c) => !isTicketNeed(c)), ...ticketNeeds(lesson)];
}

/** Every child got it. The teacher then changes the few. */
export const allGotIt = (classList: readonly string[]): Ticket => Object.fromEntries(classList.map((n) => [n, 'got' as const]));

/** An invented result for the invented class, so that a visitor can see the next lesson planned from one. */
export const SAMPLE_TICKET: Ticket = {
  'Aarav Sharma': 'absent',
  'Diya Sharma': 'got',
  'Meenal Joshi': 'partly',
  'Kabir Qureshi': 'not',
  'Tanvi Rao': 'got',
  'Ishaan Verma': 'not',
};

/** How many lessons the class view goes back. */
export const CLASS_VIEW_LESSONS = 6;

export interface ClassRow {
  child: string;
  /** One for each lesson shown, oldest first. Undefined: no mark. */
  marks: (TicketMark | undefined)[];
  /** The need lines that stand for this child, as the cloud would be told them. */
  needs: string[];
}

/**
 * The class at a glance: for each child on the class list, the marks of
 * the last lessons that have an exit ticket, and the needs that stand.
 * Built on the device from what is kept here. Nothing of it is sent.
 */
export function classView(lessons: readonly SavedLesson[], classList: readonly string[], constraints: readonly Constraint[], lineOf: (c: Constraint) => string | undefined): { lessons: SavedLesson[]; rows: ClassRow[] } {
  const shown = lessons.filter((l) => Object.keys(l.after?.ticket ?? {}).length > 0).slice(0, CLASS_VIEW_LESSONS).reverse();
  const rows = classList.map((child) => ({
    child,
    marks: shown.map((l) => l.after!.ticket![child]),
    needs: [
      ...new Set(
        constraints
          .filter((c) => c.confirmed && (c.childName === child || c.aboutName === child || (c.aboutName !== undefined && child.startsWith(`${c.aboutName} `))))
          .map(lineOf)
          .filter((l): l is string => l !== undefined),
      ),
    ],
  }));
  return { lessons: shown, rows };
}

/** A saved lesson without what is about one child: for "Forget this class". The class plan stays. */
export function withoutClass(lesson: SavedLesson): SavedLesson {
  const { needs: _needs, ...rest } = lesson;
  if (!rest.after) return { ...rest, adjustments: [] };
  const { ticket: _ticket, ...after } = rest.after;
  return { ...rest, adjustments: [], after };
}
