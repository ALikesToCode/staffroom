import type { Constraint, ConstraintKind, Entity, Where } from '../core/types';
import { buildVault, deterministicCandidates, possibleNameCandidates, RESERVED, segment } from '../core/vault';
import { proposeConstraints } from '../core/constraints';
import { guardOutcome, unreadText, type GuardReport } from '../ai/guard';
import { mergeProposals, type ConstraintReport } from '../ai/constraints';

// A set for the guard: what the on-device model adds to the rules when it reads a raw note. Twelve fresh
// class notes, invented, in an Indian school, written for this set and copied from no other. Every private
// detail and every harmless span is labelled here, word for word, and so is every kind of constraint each
// note gives. The labels were written before the set was run.

/** What a labelled detail is. */
export type DetailKind = 'name' | 'place' | 'number' | 'private';

/** Something in the note that must not leave the device, in the note's own words. */
export interface Detail {
  text: string;
  kind: DetailKind;
  /**
   * True when the author expected a rule to catch it: the class list, a
   * pattern, a word of the sensitive list, or (with no model) the
   * capitalised-word rule. False for what only a reader would see. An
   * expectation written with the labels, not a result.
   */
  easy: boolean;
}

export interface GuardCase {
  id: string;
  /** The class list the teacher typed. */
  classList: string[];
  note: string;
  details: Detail[];
  /** Words that may look private and are not: they can be sent. */
  harmless: string[];
  /** The kinds of constraint a careful teacher would confirm from this note, each once. */
  constraints: ConstraintKind[];
}

export const GUARD_CASES: GuardCase[] = [
  {
    id: 'floods',
    classList: ['Sneha Pillai', 'Arjun Kurian', 'Mehak Gill'],
    note: 'Sneha has been very quiet since the monsoon. Her father lost his shop in the floods and the family has moved in with relatives in Kottayam. She asked me not to tell the others. Arjun has offered to share his notes with her.',
    details: [
      { text: 'Sneha', kind: 'name', easy: true },
      { text: 'Arjun', kind: 'name', easy: true },
      { text: 'Her father lost his shop in the floods', kind: 'private', easy: false },
      { text: 'the family has moved in with relatives in Kottayam', kind: 'private', easy: false },
      { text: 'Kottayam', kind: 'place', easy: true },
    ],
    harmless: [],
    constraints: [],
  },
  {
    id: 'late-bus',
    classList: ['Hemant Bhatt', 'Kavya Iyer', 'Manav Sethi'],
    note: 'Hemant takes the only bus to Chandpur, which leaves at 3:40, right after the last period. He has asked twice to join the cricket nets, but he would have no way home. Kavya plays for the district under-14 team and could coach the juniors.',
    details: [
      { text: 'Hemant', kind: 'name', easy: true },
      { text: 'Kavya', kind: 'name', easy: true },
      { text: 'takes the only bus to Chandpur, which leaves at 3:40, right after the last period', kind: 'private', easy: false },
      { text: 'Chandpur', kind: 'place', easy: true },
    ],
    harmless: ['plays for the district under-14 team'],
    constraints: ['time-after'],
  },
  {
    id: 'clinic',
    classList: ['Fatima Sheikh', 'Om Prakash Yadav', 'Ritu Saini'],
    note: 'Fatima goes to the clinic in Sector 9 every Tuesday with her mother, so she misses the first two periods that day. She gets tired easily and sometimes rests her head on the desk. Om sits beside her and helps her catch up.',
    details: [
      { text: 'Fatima', kind: 'name', easy: true },
      { text: 'Om', kind: 'name', easy: true },
      { text: 'goes to the clinic in Sector 9 every Tuesday with her mother', kind: 'private', easy: false },
      { text: 'Sector 9', kind: 'place', easy: false },
      { text: 'She gets tired easily and sometimes rests her head on the desk', kind: 'private', easy: false },
    ],
    harmless: [],
    constraints: ['days-away', 'health'],
  },
  {
    id: 'easy-ones',
    classList: ['Devansh Mehta', 'Tenzin Dolma', 'Bhavna Rawat'],
    note: "Devansh's parents divorced last year and he now lives with his mother and stepfather. His mother's number is 98200 11456 if the school needs her. Tenzin has asthma and keeps an inhaler in her bag. Bhavna's roll no. 7C/14 is missing from the attendance sheet.",
    details: [
      { text: 'Devansh', kind: 'name', easy: true },
      { text: 'Tenzin', kind: 'name', easy: true },
      { text: 'Bhavna', kind: 'name', easy: true },
      { text: "Devansh's parents divorced last year and he now lives with his mother and stepfather", kind: 'private', easy: true },
      { text: '98200 11456', kind: 'number', easy: true },
      { text: 'Tenzin has asthma and keeps an inhaler in her bag', kind: 'private', easy: true },
      { text: 'roll no. 7C/14', kind: 'number', easy: true },
    ],
    harmless: [],
    constraints: ['health'],
  },
  {
    id: 'fees',
    classList: ['Lakshmi Reddy', 'Pranav Kulkarni', 'Ayesha Khan'],
    note: 'Lakshmi has not paid the exam fee yet; her mother works as a cook in two houses and is paid at the end of the month. Please do not ask her about it in front of the class. Pranav brought sweets for everyone on his birthday.',
    details: [
      { text: 'Lakshmi', kind: 'name', easy: true },
      { text: 'Pranav', kind: 'name', easy: true },
      { text: 'has not paid the exam fee yet', kind: 'private', easy: false },
      { text: 'her mother works as a cook in two houses and is paid at the end of the month', kind: 'private', easy: false },
    ],
    harmless: ['brought sweets for everyone on his birthday'],
    constraints: ['money'],
  },
  {
    id: 'one-phone',
    classList: ['Siddharth Jain', 'Gurpreet Kaur', 'Neha Pandey'],
    note: "Gurpreet's family shares one old phone, and her brother takes it to work all day. She can only do online homework on Sundays, when he is at home. Siddharth won the inter-school quiz in Lucknow last week.",
    details: [
      { text: 'Gurpreet', kind: 'name', easy: true },
      { text: 'Siddharth', kind: 'name', easy: true },
      { text: 'family shares one old phone, and her brother takes it to work all day', kind: 'private', easy: false },
      { text: 'She can only do online homework on Sundays, when he is at home', kind: 'private', easy: false },
      { text: 'Lucknow', kind: 'place', easy: true },
    ],
    harmless: ['won the inter-school quiz'],
    constraints: ['no-phone-internet'],
  },
  {
    id: 'dialysis',
    classList: ['Karthik Subramanian', 'Swati Ghosh', 'Joseph Mathew'],
    note: 'Karthik leaves at lunch on Fridays to take his grandfather for dialysis at the government hospital. His uncle Venkat signs his diary now. Joseph is reading the Harry Potter books in Malayalam and loves them.',
    details: [
      { text: 'Karthik', kind: 'name', easy: true },
      { text: 'Joseph', kind: 'name', easy: true },
      { text: 'leaves at lunch on Fridays to take his grandfather for dialysis at the government hospital', kind: 'private', easy: true },
      { text: 'Venkat', kind: 'name', easy: true },
      { text: 'His uncle Venkat signs his diary now', kind: 'private', easy: false },
    ],
    harmless: ['the Harry Potter books in Malayalam'],
    constraints: ['days-away', 'contact'],
  },
  {
    id: 'curriculum',
    classList: ['Priyanka Das', 'Rahul Verghese', 'Shruti Agarwal'],
    note: 'In science we start the chapter on diseases next week, with a short film about how a hospital works. Priyanka asked if her uncle, a doctor at AIIMS, could visit and talk to the class. Rahul and Shruti are making a poster on mental health for the corridor.',
    details: [
      { text: 'Priyanka', kind: 'name', easy: true },
      { text: 'Rahul', kind: 'name', easy: true },
      { text: 'Shruti', kind: 'name', easy: true },
      { text: 'her uncle, a doctor at AIIMS', kind: 'private', easy: false },
      { text: 'AIIMS', kind: 'place', easy: true },
    ],
    harmless: ['we start the chapter on diseases next week, with a short film about how a hospital works', 'a poster on mental health for the corridor'],
    constraints: [],
  },
  {
    id: 'hostel',
    classList: ['Abdul Rahman', 'Reshma Banu', 'Yusuf Ali'],
    note: 'Yusuf stays at the Al-Noor hostel during the week and goes home to Malerkotla only on Saturday evenings. The hostel warden, Mr Qadri, is the person to call, on 0161 245 7788. He often comes to class without breakfast because the mess opens late.',
    details: [
      { text: 'Yusuf', kind: 'name', easy: true },
      { text: 'stays at the Al-Noor hostel during the week and goes home to Malerkotla only on Saturday evenings', kind: 'private', easy: false },
      { text: 'Al-Noor', kind: 'place', easy: true },
      { text: 'Malerkotla', kind: 'place', easy: true },
      { text: 'Mr Qadri', kind: 'name', easy: true },
      { text: '0161 245 7788', kind: 'number', easy: true },
      { text: 'He often comes to class without breakfast because the mess opens late', kind: 'private', easy: false },
    ],
    harmless: [],
    constraints: ['contact'],
  },
  {
    id: 'no-capitals',
    classList: ['Ananya Bose', 'Jaspreet Singh', 'Simran Menon'],
    note: "ananya's elder sister roshni picks her up now, since their father moved to dubai for work in june. ananya cries some mornings at the gate. jaspreet has been helping her settle in the line.",
    details: [
      { text: 'ananya', kind: 'name', easy: true },
      { text: 'jaspreet', kind: 'name', easy: true },
      { text: 'roshni', kind: 'name', easy: false },
      { text: 'dubai', kind: 'place', easy: false },
      { text: 'their father moved to dubai for work in june', kind: 'private', easy: false },
      { text: 'ananya cries some mornings at the gate', kind: 'private', easy: false },
    ],
    harmless: [],
    constraints: ['contact'],
  },
  {
    id: 'caste',
    classList: ['Manish Kumar', 'Zainab Hussain', 'Tejas Patil'],
    note: "On Monday some boys called Manish names about his caste during the match; I have spoken to them. Zainab's essay on Republic Day won the school prize. Tejas forgot his PE kit again.",
    details: [
      { text: 'Manish', kind: 'name', easy: true },
      { text: 'Zainab', kind: 'name', easy: true },
      { text: 'Tejas', kind: 'name', easy: true },
      { text: 'some boys called Manish names about his caste during the match', kind: 'private', easy: true },
    ],
    harmless: ['Republic Day', 'PE kit'],
    constraints: [],
  },
  {
    id: 'mandi',
    classList: ['Vikas Thakur', 'Nikita Chauhan', 'Harpreet Sodhi'],
    note: 'Vikas helps his father unload vegetables at Azadpur mandi from five in the morning, so he is often late for assembly. He has fallen asleep in two maths lessons this week. His father asked me to keep this between us.',
    details: [
      { text: 'Vikas', kind: 'name', easy: true },
      { text: 'helps his father unload vegetables at Azadpur mandi from five in the morning', kind: 'private', easy: false },
      { text: 'Azadpur', kind: 'place', easy: true },
    ],
    harmless: [],
    constraints: ['time-before'],
  },
];

// ---------------------------------------------------------------- the run and the score

/** Rules only, as in a browser with no on-device model; or the rules and the on-device model together. */
export type GuardMode = 'rules' | 'model';

/** The two on-device calls the guard makes, as the app makes them. Absent: rules only. */
export interface GuardDevice {
  guard: (note: string) => Promise<GuardReport>;
  constraints: (note: string, entities: Entity[]) => Promise<ConstraintReport>;
}

/** What the guard left for one note: the vault and the proposed constraints, before the teacher has touched either. */
export interface GuardOutput {
  entities: Entity[];
  constraints: Constraint[];
  where: Where;
  /** Parts of the note the model was asked to read and could not. */
  unread: number;
  /** Set when a model call threw. What the rules found stands. */
  failed?: string;
}

/**
 * Run the guard on one note as the app does on "Run the guard", step for
 * step: the class list, the patterns and the sensitive words; with the
 * device, the on-device guard, then the capitalised-word rule for what it
 * did not read (or for the whole note when it read nothing); the vault;
 * the constraints by rule, and with the device the model's merged in.
 */
export async function guardNote(c: Pick<GuardCase, 'note' | 'classList'>, device: GuardDevice | null): Promise<GuardOutput> {
  const candidates = deterministicCandidates(c.note, c.classList);
  let where: Where = 'RULES_ONLY';
  let unread: number[] = [];
  let failed: string | undefined;
  if (device) {
    try {
      const report = await device.guard(c.note);
      candidates.push(...report.candidates);
      const outcome = guardOutcome(report);
      where = outcome.where;
      unread = outcome.unread;
      if (report.stopped) failed = report.stopped;
    } catch (e) {
      // As in the app: the run broke before it could report, so every part counts as unread.
      failed = e instanceof Error ? e.message : String(e);
    }
  }
  if (where === 'RULES_ONLY') candidates.push(...possibleNameCandidates(c.note, c.classList));
  else if (unread.length > 0) candidates.push(...possibleNameCandidates(unreadText(c.note, unread), c.classList));
  const entities = buildVault(c.note, candidates);
  let constraints = proposeConstraints(c.note, entities);
  if (device && where === 'ON_DEVICE') {
    try {
      constraints = mergeProposals(constraints, (await device.constraints(c.note, entities)).constraints);
    } catch (e) {
      failed ??= e instanceof Error ? e.message : String(e);
    }
  }
  return { entities, constraints, where, unread: unread.length, ...(failed ? { failed } : {}) };
}

/** For each character of the note, whether the vault holds it back. */
function heldMask(note: string, entities: Entity[]): boolean[] {
  const mask: boolean[] = [];
  for (const s of segment(note, entities)) {
    const held = Boolean(s.entity && (s.entity.withheld || s.entity.category === RESERVED));
    for (let i = 0; i < s.text.length; i++) mask.push(held);
  }
  return mask;
}

/** How much of every place a span stands in the note is held back, letters and digits counted. */
function share(note: string, mask: readonly boolean[], text: string): 'all' | 'part' | 'none' {
  let held = 0;
  let total = 0;
  for (let at = note.indexOf(text); at >= 0; at = note.indexOf(text, at + 1)) {
    // A short name counts where it stands as a word, not inside another word.
    const edge = (i: number) => i < 0 || i >= note.length || !/[\p{L}\p{N}]/u.test(note[i]);
    if (!edge(at - 1) || !edge(at + text.length)) continue;
    for (let i = at; i < at + text.length; i++) {
      if (!/[\p{L}\p{N}]/u.test(note[i])) continue;
      total++;
      if (mask[i]) held++;
    }
  }
  return total === 0 || held === 0 ? 'none' : held === total ? 'all' : 'part';
}

/** How one run of the guard did on one note, against its labels. */
export interface GuardScore {
  /** Details held back wherever they stand. */
  caught: string[];
  /** Details held back only in part. */
  partly: string[];
  missed: string[];
  /** Harmless spans of which any part was held back. */
  harmlessHeld: string[];
  /** Labelled kinds of constraint that were proposed, and those that were not. */
  constraintsMatched: ConstraintKind[];
  constraintsMissed: ConstraintKind[];
  /** Kinds proposed that no label has. */
  constraintsExtra: ConstraintKind[];
}

/** Set what the guard left against the labels of the note. Plain code. */
export function scoreGuard(c: GuardCase, out: Pick<GuardOutput, 'entities' | 'constraints'>): GuardScore {
  const mask = heldMask(c.note, out.entities);
  const by = (want: 'all' | 'part' | 'none') => c.details.filter((d) => share(c.note, mask, d.text) === want).map((d) => d.text);
  const proposed = [...new Set(out.constraints.filter((x) => x.kind !== 'learning').map((x) => x.kind))];
  return {
    caught: by('all'),
    partly: by('part'),
    missed: by('none'),
    harmlessHeld: c.harmless.filter((h) => share(c.note, mask, h) !== 'none'),
    constraintsMatched: c.constraints.filter((k) => proposed.includes(k)),
    constraintsMissed: c.constraints.filter((k) => !proposed.includes(k)),
    constraintsExtra: proposed.filter((k) => !c.constraints.includes(k)),
  };
}

/** One row of the set: one note, one mode, one run. */
export interface GuardRow extends GuardScore {
  run: number;
  id: string;
  mode: GuardMode;
  where: Where;
  unread: number;
  failed?: string;
  ms: number;
}

/** The totals of one mode over every row of it. */
export function guardTotals(rows: readonly GuardRow[], mode: GuardMode) {
  const mine = rows.filter((r) => r.mode === mode);
  const easy = new Map(GUARD_CASES.map((c) => [c.id, new Set(c.details.filter((d) => d.easy).map((d) => d.text))]));
  const count = (pick: (r: GuardRow) => string[], wantEasy?: boolean) =>
    mine.reduce((n, r) => n + pick(r).filter((t) => wantEasy === undefined || easy.get(r.id)?.has(t) === wantEasy).length, 0);
  const ms = mine.map((r) => r.ms).sort((a, b) => a - b);
  return {
    runs: mine.length,
    details: count((r) => [...r.caught, ...r.partly, ...r.missed]),
    caught: count((r) => r.caught),
    partly: count((r) => r.partly),
    missed: count((r) => r.missed),
    // The details the author expected only a reader to see, and those a rule should catch.
    notEasy: { caught: count((r) => r.caught, false), partly: count((r) => r.partly, false), missed: count((r) => r.missed, false) },
    easy: { caught: count((r) => r.caught, true), partly: count((r) => r.partly, true), missed: count((r) => r.missed, true) },
    harmless: mine.reduce((n, r) => n + (GUARD_CASES.find((c) => c.id === r.id)?.harmless.length ?? 0), 0),
    harmlessHeld: mine.reduce((n, r) => n + r.harmlessHeld.length, 0),
    constraintsLabelled: mine.reduce((n, r) => n + r.constraintsMatched.length + r.constraintsMissed.length, 0),
    constraintsMatched: mine.reduce((n, r) => n + r.constraintsMatched.length, 0),
    constraintsExtra: mine.reduce((n, r) => n + r.constraintsExtra.length, 0),
    unreadParts: mine.reduce((n, r) => n + r.unread, 0),
    failures: mine.filter((r) => r.failed).length,
    medianMs: ms.length > 0 ? ms[Math.floor(ms.length / 2)] : 0,
  };
}
