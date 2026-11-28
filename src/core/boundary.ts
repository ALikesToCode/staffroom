import type { Constraint, Entity, LearningKind } from './types';
import type { Violation } from './gate';
import { checkOutgoing } from './gate';
import { WEEKDAYS } from './constraints';
import { lessonBlock, lessonIssues, type LessonFields } from './lesson';
import {
  checkLessonNeed,
  type LessonNeed,
} from './lessonNeeds';
import { materialsText } from './materials';
import { isTicketNeed, ticketLine, ticketTopic } from './ticket';
import { PRIVATE_TOKEN, TOKEN_RE } from './vault';

/**
 * Single readable allowlist & send-time boundary validator.
 *
 * INVARIANT: On the lesson path, ZERO prose from the teacher's raw notebook
 * may leave the device, and ZERO model-authored text may enter the outgoing
 * request. Every need sent to the cloud comes either from this fixed catalogue
 * (with enumerated parameters such as weekdays or the already-validated topic)
 * or from explicit custom wording typed by the teacher and acknowledged via tick.
 */

export const WEEKDAY_ENUM = WEEKDAYS;
export type Weekday = (typeof WEEKDAYS)[number];

export const FIXED_CONSTRAINT_LINES: Record<'time-after' | 'time-before' | 'money' | 'no-phone-internet', string> = {
  'time-after': 'cannot stay after the last bell',
  'time-before': 'cannot come before the first bell',
  money: 'nothing that has to be bought or brought from home',
  'no-phone-internet': 'no phone or internet at home',
};

export const LEARNING_CATALOGUE: Record<LearningKind, string> = {
  tests: 'finds written tests hard; can answer aloud',
  early: 'finishes early and needs more to do',
  missed: 'has missed recent lessons',
  group: 'works better apart from one classmate',
  shy: 'needs time before speaking in front of the class',
  'reads-above': 'reads above the level of the class',
  'reads-below': 'reads below the level of the class',
  homework: 'has not handed in recent homework',
  'ticket-not': 'has not yet got the last topic; needs it taught again another way',
  'ticket-got': 'got the last topic on the exit ticket; ready for a harder task',
  'ticket-partly': 'partly got the last topic; needs more practice on it',
  'ticket-absent': 'was absent for the last topic',
};

const BOUNDARY_NEEDS_HEADING = 'Needs in this class (no names and no reasons are given; a need may be one pupil\'s or several):';
const boundaryNeedsAsk = (letters: readonly string[]) => `Under "For each need", give an entry for every one of these letters: ${letters.join(', ')}.`;

/**
 * Curated classroom-action options for kinds without a fixed rule line
 * (health, contact, other) or when adapting a learning need.
 * Written strictly as what the teacher does in class — never the private reason.
 */
export const CLASSROOM_ACTION_CATALOGUE = {
  'seat-front': 'needs to sit near the front',
  'leave-room': 'may need to leave the room during a lesson',
  'no-heavy-activity': 'no running or heavy activity',
  'short-break': 'needs a short break in a long task',
  'repeat-instructions': 'needs instructions repeated one to one',
  'no-bright-lights': 'must avoid bright or flashing lights',
  'extra-time': 'needs extra time for written work',
  'quiet-check-in': 'needs a quiet check-in instead of being called on aloud',
  'pair-support': 'works best paired with a calm, steady partner',
  'written-copy': 'needs a written copy of board notes',
} as const;

export type ClassroomActionKey = keyof typeof CLASSROOM_ACTION_CATALOGUE;

const CATALOGUE_BY_TEXT = new Map<string, ClassroomActionKey>(
  (Object.entries(CLASSROOM_ACTION_CATALOGUE) as [ClassroomActionKey, string][]).map(([k, v]) => [v.toLowerCase(), k]),
);

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const formatDaysLine = (days: readonly Weekday[]) => `away on ${list(days.map((d) => `${d}s`))}`;

const LETTER_RE = /^[A-Z]{1,2}\d*$/;

export const LABEL_CHARS_LIMIT = 240;

export type LessonBoundaryNeed =
  | {
      letter: string;
      source: 'catalogue';
      catalogueKey: string;
      days?: Weekday[];
      ticketTopic?: string;
      line: string;
    }
  | {
      letter: string;
      source: 'teacher-custom';
      line: string;
      acked: true;
    };

export interface LessonBoundaryPayload {
  kind: 'lesson';
  lesson: LessonFields;
  needs: LessonBoundaryNeed[];
  missingLetters?: string[];
}

export interface MaterialsBoundaryPayload {
  kind: 'materials';
  classPlan: string;
  needs: LessonBoundaryNeed[];
  language: string;
  lesson?: BoundaryLessonContext;
}

export interface LabelBoundaryPayload {
  kind: 'label';
  lesson: Pick<LessonFields, 'klass' | 'subject' | 'topic'>;
}

export interface CatalogueMatch {
  catalogueKey: string;
  days?: Weekday[];
  ticketTopic?: string;
  line: string;
}

export type BoundaryLessonContext = Pick<LessonFields, 'topic'> & Partial<Pick<LessonFields, 'lastTime'>>;

function ticketCandidateTopics(lesson?: BoundaryLessonContext): string[] {
  const fromLastTime = lesson?.lastTime ? /^\s*Topic:\s*([^.\n]+)/i.exec(lesson.lastTime)?.[1]?.trim() : undefined;
  return [lesson?.topic?.trim(), fromLastTime, 'the last topic'].filter((t): t is string => Boolean(t));
}

/**
 * Identify whether a constraint's shared line comes strictly from the fixed
 * catalogue (never model-authored prose or raw notebook text).
 */
export function matchCatalogueNeed(c: Constraint, line: string, lesson?: BoundaryLessonContext): CatalogueMatch | undefined {
  const clean = line.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;

  if (c.kind === 'time-after' || c.kind === 'time-before' || c.kind === 'money' || c.kind === 'no-phone-internet') {
    const fixed = FIXED_CONSTRAINT_LINES[c.kind];
    return clean === fixed ? { catalogueKey: c.kind, line: fixed } : undefined;
  }

  if (c.kind === 'days-away') {
    const rawDays = c.days ?? [];
    const days = WEEKDAY_ENUM.filter((d) => rawDays.includes(d));
    if (days.length === 0) return undefined;
    const expected = formatDaysLine(days);
    return clean === expected ? { catalogueKey: 'days-away', days, line: expected } : undefined;
  }

  if (c.kind === 'learning' && c.learn) {
    if (isTicketNeed({ learn: c.learn })) {
      for (const candidate of ticketCandidateTopics(lesson)) {
        const formatted = ticketLine(c.learn as Extract<LearningKind, `ticket-${string}`>, candidate);
        if (clean === formatted) return { catalogueKey: c.learn, ticketTopic: ticketTopic(candidate), line: formatted };
      }
    } else if (clean === LEARNING_CATALOGUE[c.learn]) {
      return { catalogueKey: `learning:${c.learn}`, line: LEARNING_CATALOGUE[c.learn] };
    }
  }

  const actionKey = CATALOGUE_BY_TEXT.get(clean.toLowerCase());
  if (actionKey) {
    return { catalogueKey: `action:${actionKey}`, line: CLASSROOM_ACTION_CATALOGUE[actionKey] };
  }

  return undefined;
}

/** True when a line matches one of the curated zero-reason classroom actions in CLASSROOM_ACTION_CATALOGUE. */
export function classroomActionKeyOf(line: string | undefined): ClassroomActionKey | undefined {
  if (!line) return undefined;
  return CATALOGUE_BY_TEXT.get(line.replace(/\s+/g, ' ').trim().toLowerCase());
}

/** Reconstruct the exact expected catalogue string from enumerated key & parameters alone. */
export function resolveCatalogueLine(need: Extract<LessonBoundaryNeed, { source: 'catalogue' }>): string | undefined {
  const k = need.catalogueKey;
  if (k === 'time-after' || k === 'time-before' || k === 'money' || k === 'no-phone-internet') {
    return FIXED_CONSTRAINT_LINES[k];
  }
  if (k === 'days-away') {
    const days = need.days ?? [];
    if (days.length === 0 || !days.every((d) => (WEEKDAY_ENUM as readonly string[]).includes(d))) return undefined;
    const ordered = WEEKDAY_ENUM.filter((d) => days.includes(d));
    return ordered.length === days.length ? formatDaysLine(ordered) : undefined;
  }
  if (k.startsWith('learning:')) {
    const learn = k.slice('learning:'.length) as LearningKind;
    return !learn.startsWith('ticket-') ? LEARNING_CATALOGUE[learn] : undefined;
  }
  if (k.startsWith('ticket-')) {
    if (!['ticket-not', 'ticket-got', 'ticket-partly', 'ticket-absent'].includes(k)) return undefined;
    return ticketLine(k as Extract<LearningKind, `ticket-${string}`>, need.ticketTopic ?? 'the last topic');
  }
  if (k.startsWith('action:')) {
    const actionKey = k.slice('action:'.length) as ClassroomActionKey;
    return actionKey in CLASSROOM_ACTION_CATALOGUE ? CLASSROOM_ACTION_CATALOGUE[actionKey] : undefined;
  }
  return undefined;
}

export interface BuiltLessonBoundary {
  payload: LessonBoundaryPayload;
  customLetters: string[];
  unackedCustomLetters: string[];
}

/**
 * Map active LessonNeeds + backing Constraints into strictly typed LessonBoundaryNeeds.
 * Note text and model prose are never accepted here.
 */
export function buildLessonPayload(
  lesson: LessonFields,
  needs: readonly LessonNeed[],
  constraints: readonly Constraint[],
  missingLetters?: readonly string[],
): BuiltLessonBoundary {
  const byId = new Map(constraints.map((c) => [c.id, c]));
  const typedNeeds: LessonBoundaryNeed[] = [];
  const customLetters: string[] = [];
  const unackedCustomLetters: string[] = [];

  for (const n of needs) {
    const backing = n.constraintIds.map((id) => byId.get(id)).filter((c): c is Constraint => c !== undefined);
    const matches = backing.map((c) => matchCatalogueNeed(c, n.line, lesson));
    const firstMatch = matches[0];
    const allCatalogueSame =
      firstMatch !== undefined &&
      matches.every(
        (m) =>
          m !== undefined &&
          m.catalogueKey === firstMatch.catalogueKey &&
          m.line === firstMatch.line &&
          JSON.stringify(m.days ?? null) === JSON.stringify(firstMatch.days ?? null),
      );

    if (allCatalogueSame && firstMatch) {
      typedNeeds.push({
        letter: n.letter,
        source: 'catalogue',
        catalogueKey: firstMatch.catalogueKey,
        ...(firstMatch.days ? { days: firstMatch.days } : {}),
        ...(firstMatch.ticketTopic !== undefined ? { ticketTopic: firstMatch.ticketTopic } : {}),
        line: firstMatch.line,
      });
    } else {
      customLetters.push(n.letter);
      const acked = backing.length > 0 && backing.every((c) => Boolean(c.needAck));
      if (!acked) unackedCustomLetters.push(n.letter);
      typedNeeds.push({
        letter: n.letter,
        source: 'teacher-custom',
        line: n.line,
        acked: acked as true,
      });
    }
  }

  return {
    payload: {
      kind: 'lesson',
      lesson,
      needs: typedNeeds,
      ...(missingLetters && missingLetters.length > 0 ? { missingLetters: [...missingLetters] } : {}),
    },
    customLetters,
    unackedCustomLetters,
  };
}

/** Format the fixed-shape needs block alone (with zero notebook sentences). */
export function formatBoundaryNeeds(needs: readonly Pick<LessonBoundaryNeed, 'letter' | 'line'>[]): string {
  if (needs.length === 0) return '';
  return `${BOUNDARY_NEEDS_HEADING}\n${needs.map((n) => `Need ${n.letter}: ${n.line}`).join('\n')}\n${boundaryNeedsAsk(needs.map((n) => n.letter))}`;
}

/** Single canonical builder for a lesson cloud request. Accepts ONLY LessonBoundaryPayload. */
export function buildLessonRequestText(payload: LessonBoundaryPayload): string {
  const needsBlock = formatBoundaryNeeds(payload.needs);
  const lessonPart = lessonBlock(payload.lesson);
  const base = needsBlock ? `${needsBlock}\n\n${lessonPart}` : lessonPart;
  if (payload.missingLetters && payload.missingLetters.length > 0) {
    return `${base}\n\nWrite the entries for: ${payload.missingLetters.join(', ')}`;
  }
  return base;
}

/** Single canonical builder for materials request. */
export function buildMaterialsRequestText(payload: MaterialsBoundaryPayload): string {
  return materialsText(payload.classPlan, payload.needs, payload.language);
}

/** Single canonical builder for receipt naming prompt (never reads notebook text). */
export function buildLabelRequestText(payload: LabelBoundaryPayload): string {
  const summary = [payload.lesson.klass, payload.lesson.subject, payload.lesson.topic]
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' — ')
    .slice(0, LABEL_CHARS_LIMIT);
  return `Note:\n${summary}`;
}

export type BoundaryValidation = { ok: true; text: string } | { ok: false; errors: string[] };

function validateNeedList(
  needs: readonly LessonBoundaryNeed[],
  lesson: BoundaryLessonContext,
  entities: Entity[],
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const allowedTicketTopics = new Set(ticketCandidateTopics(lesson).map((t) => ticketTopic(t)));
  for (const n of needs) {
    if (!LETTER_RE.test(n.letter)) {
      errors.push(`Invalid need letter "${n.letter}".`);
      continue;
    }
    if (seen.has(n.letter)) errors.push(`Duplicate need letter "${n.letter}".`);
    seen.add(n.letter);

    if (n.source === 'catalogue') {
      const rebuilt = resolveCatalogueLine(n);
      if (!rebuilt || rebuilt !== n.line) {
        errors.push(`Need ${n.letter} does not match fixed catalogue key "${n.catalogueKey}".`);
      }
      if (n.ticketTopic && n.ticketTopic !== 'the last topic' && (lesson.topic || lesson.lastTime)) {
        if (!allowedTicketTopics.has(ticketTopic(n.ticketTopic))) {
          errors.push(`Need ${n.letter} exit-ticket topic does not match lesson topic.`);
        }
      }
    } else if (n.source === 'teacher-custom') {
      if (n.acked !== true) {
        errors.push(`Need ${n.letter} custom wording was not explicitly acknowledged ("Send my own wording").`);
      }
      const lineIssues = checkLessonNeed(n.line, entities, true).issues;
      if (lineIssues.length > 0) {
        errors.push(`Need ${n.letter} custom wording failed exit gate: ${lineIssues.map((v) => v.what).join(', ')}.`);
      }
    } else {
      errors.push(`Need ${String((n as { letter?: unknown }).letter)} has unknown boundary source.`);
    }
  }
  return errors;
}

/**
 * Send-time validator for lesson cloud requests. Rebuilds the exact expected text
 * from the typed LessonBoundaryPayload, validates every need against the allowlist
 * (or requires explicit custom ack), runs lessonIssues + checkOutgoing, and refuses
 * to send if outgoingText differs by even one character.
 */
export function validateLessonBoundary(
  payload: LessonBoundaryPayload,
  outgoingText: string,
  entities: Entity[],
  classList: readonly string[],
): BoundaryValidation {
  const errors = validateNeedList(payload.needs, payload.lesson, entities);
  const fieldViolations = lessonIssues(payload.lesson, entities, classList);
  for (const v of fieldViolations) errors.push(`Lesson field blocked (${v.what}): ${v.why}`);

  if (payload.missingLetters) {
    const allowed = new Set(payload.needs.map((n) => n.letter));
    for (const l of payload.missingLetters) {
      if (!allowed.has(l)) errors.push(`Missing-letter retry references unknown Need ${l}.`);
    }
  }

  const expected = buildLessonRequestText(payload);
  if (outgoingText !== expected) {
    errors.push('Outgoing lesson request does not match the canonical boundary builder.');
  }

  for (const v of checkOutgoing(outgoingText, entities)) {
    errors.push(`Exit gate blocked (${v.what}): ${v.why}`);
  }
  for (const m of outgoingText.matchAll(TOKEN_RE)) {
    errors.push(`Stand-in token "${m[0]}" is not allowed in lesson outgoing text.`);
  }
  if (outgoingText.includes(PRIVATE_TOKEN)) {
    errors.push(`Marker "${PRIVATE_TOKEN}" is not allowed in lesson outgoing text.`);
  }

  return errors.length === 0 ? { ok: true, text: expected } : { ok: false, errors };
}

export function assertLessonBoundary(
  payload: LessonBoundaryPayload,
  outgoingText: string,
  entities: Entity[],
  classList: readonly string[],
): string {
  const check = validateLessonBoundary(payload, outgoingText, entities, classList);
  if (!check.ok) throw new Error(`Boundary refused lesson send: ${check.errors.join(' ')}`);
  return check.text;
}

/** Send-time validator for materials requests (classPlan contains no withheld tokens/names + exact rebuild). */
export function validateMaterialsBoundary(
  payload: MaterialsBoundaryPayload,
  outgoingText: string,
  entities: Entity[],
): BoundaryValidation {
  const errors = validateNeedList(payload.needs, payload.lesson ?? { topic: '' }, entities);
  for (const v of checkOutgoing(payload.classPlan, entities)) {
    errors.push(`Materials class plan blocked (${v.what}): ${v.why}`);
  }
  for (const m of payload.classPlan.matchAll(TOKEN_RE)) {
    errors.push(`Stand-in token "${m[0]}" is not allowed in materials request.`);
  }
  if (payload.classPlan.includes(PRIVATE_TOKEN)) {
    errors.push(`Marker "${PRIVATE_TOKEN}" is not allowed in materials request.`);
  }
  const expected = buildMaterialsRequestText(payload);
  if (outgoingText !== expected) {
    errors.push('Outgoing materials request does not match the canonical boundary builder.');
  }
  for (const v of checkOutgoing(outgoingText, entities)) {
    errors.push(`Materials exit gate blocked (${v.what}): ${v.why}`);
  }
  for (const m of outgoingText.matchAll(TOKEN_RE)) {
    errors.push(`Stand-in token "${m[0]}" is not allowed in materials request.`);
  }
  if (outgoingText.includes(PRIVATE_TOKEN)) {
    errors.push(`Marker "${PRIVATE_TOKEN}" is not allowed in materials request.`);
  }
  return errors.length === 0 ? { ok: true, text: expected } : { ok: false, errors };
}

export function assertMaterialsBoundary(
  payload: MaterialsBoundaryPayload,
  outgoingText: string,
  entities: Entity[],
): string {
  const check = validateMaterialsBoundary(payload, outgoingText, entities);
  if (!check.ok) throw new Error(`Boundary refused materials send: ${check.errors.join(' ')}`);
  return check.text;
}

/** Send-time validator for naming/labeling saved records (lesson metadata only, never raw notebook). */
export function validateLabelBoundary(
  payload: LabelBoundaryPayload,
  promptText: string,
  entities: Entity[],
  classList: readonly string[],
): BoundaryValidation {
  const errors: string[] = [];
  const fullFields: LessonFields = { ...payload.lesson, minutes: 40, lastTime: '' };
  for (const v of lessonIssues(fullFields, entities, classList)) {
    errors.push(`Label metadata blocked (${v.what}): ${v.why}`);
  }
  const expected = buildLabelRequestText(payload);
  if (promptText !== expected) {
    errors.push('Outgoing label prompt does not match canonical lesson metadata.');
  }
  for (const v of checkOutgoing(promptText, entities)) {
    errors.push(`Label exit gate blocked (${v.what}): ${v.why}`);
  }
  for (const m of promptText.matchAll(TOKEN_RE)) {
    errors.push(`Stand-in token "${m[0]}" is not allowed in label prompt.`);
  }
  if (promptText.includes(PRIVATE_TOKEN)) {
    errors.push(`Marker "${PRIVATE_TOKEN}" is not allowed in label prompt.`);
  }
  return errors.length === 0 ? { ok: true, text: expected } : { ok: false, errors };
}

export function assertLabelBoundary(
  payload: LabelBoundaryPayload,
  promptText: string,
  entities: Entity[],
  classList: readonly string[],
): string {
  const check = validateLabelBoundary(payload, promptText, entities, classList);
  if (!check.ok) throw new Error(`Boundary refused label send: ${check.errors.join(' ')}`);
  return check.text;
}

/** Count unacknowledged custom needs as blocking Violations for UI gate integration. */
export function customNeedAckViolations(
  needs: readonly LessonNeed[],
  constraints: readonly Constraint[],
  lesson?: BoundaryLessonContext,
): Violation[] {
  const byId = new Map(constraints.map((c) => [c.id, c]));
  const out: Violation[] = [];
  for (const n of needs) {
    const backing = n.constraintIds.map((id) => byId.get(id)).filter((c): c is Constraint => c !== undefined);
    const isCat = backing.length > 0 && backing.every((c) => matchCatalogueNeed(c, n.line, lesson) !== undefined);
    if (isCat) continue;
    const acked = backing.length > 0 && backing.every((c) => Boolean(c.needAck));
    if (!acked && n.issues.length === 0) {
      out.push({
        what: `Need ${n.letter}`,
        why: 'your own words — tick "Send my own wording" next to this need before sending',
      });
    }
  }
  return out;
}
