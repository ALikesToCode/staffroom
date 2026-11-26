import type { DraftItem, LearningKind } from '../core/types';
import { confirmConstraint, lockConstraints, proposeConstraints, restoreConstraints } from '../core/constraints';
import type { SavedLesson } from '../core/lesson';
import { withTicketNeeds, type Ticket } from '../core/ticket';
import { inlineToSection, lessonNeedLine, lessonNeeds, proposeLearning, splitVariations } from '../core/lessonNeeds';
import { placeVariations } from '../core/points';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from '../core/samples';
import { buildVault, deterministicCandidates, possibleNameCandidates } from '../core/vault';

/**
 * A set for the part of a lesson that is plain code: five replies written
 * by hand as the cloud returns them, with lines for needs in them, read
 * against the invented class with every need confirmed and told. For each
 * reply the labels say which child each line belongs beside, how many
 * lines are for a letter that was not sent (or have no words), and which
 * placed lines go against a constraint of that child.
 *
 * Everything here is invented. The replies and labels were written before
 * the code was run on them. No model is involved, so it runs in any
 * browser and in the unit tests.
 */
export interface NeedsCase {
  id: string;
  stages: DraftItem[];
  /** Where each line belongs: the stage (from 0), the letter and the child's first name. */
  placed: [stage: number, letter: string, child: string][];
  /** Lines for a letter that was not sent, or with no words. */
  dropped: number;
  /** The placed lines a rule should fire on, for that child. */
  hits: [stage: number, letter: string, child: string][];
}

const stage = (heading: string, text: string): DraftItem => ({ heading, text });

export const NEEDS_CASES: NeedsCase[] = [
  {
    id: 'english',
    stages: [
      stage('Starter (5 minutes)', 'Pupils call out five things they can see in a picture of a busy market. For Need N: tells a partner first, and the partner shares it.'),
      stage('Teach (10 minutes)', 'Model a four-sentence description of the school gate on the board.'),
      stage('Practise (15 minutes)', 'Pupils describe a place they know, in pairs. For Need G: adds a second paragraph from another point of view. For Need I: is paired with a different classmate.'),
      stage('Check (10 minutes)', 'A short written test of five questions. For Need F: answers the five questions aloud to the teacher.'),
      stage('Homework', 'Pupils find two pictures of a place online and write three sentences. For Need B: writes from two printed pictures given out in class. For Need M: hands in one sentence the next morning.'),
    ],
    placed: [
      [0, 'N', 'Tanvi'],
      [2, 'G', 'Ishaan'],
      [2, 'I', 'Kabir'],
      [2, 'I', 'Ishaan'],
      [3, 'F', 'Meenal'],
      [4, 'B', 'Tanvi'],
      [4, 'M', 'Aarav'],
    ],
    dropped: 0,
    hits: [],
  },
  {
    id: 'maths',
    stages: [
      stage('Starter (5 minutes)', 'Quick recap of halves and quarters with paper strips. For Need H: starts with the recap sheet from last week. For Need D: does the recap during the starter, not before school.'),
      stage('Teach (10 minutes)', 'Show equivalent fractions by folding a strip into two, four and eight parts.'),
      stage('Practise (15 minutes)', 'Pupils shade equivalent fractions on squared paper from the class tray.'),
      stage('Check (10 minutes)', 'Five questions on the board, marked in pairs. For Need F: answers aloud to the teacher after the last bell. For Need A: has the second try at lunch.'),
      stage('Homework', "Pupils watch the fractions clip sent to the class WhatsApp group. For Need B: watches the clip on a neighbour's phone at home. For Need Z: nothing changes."),
    ],
    placed: [
      [0, 'H', 'Aarav'],
      [0, 'D', 'Aarav'],
      [3, 'F', 'Meenal'],
      [3, 'A', 'Meenal'],
      [4, 'B', 'Tanvi'],
    ],
    dropped: 1,
    hits: [
      [3, 'F', 'Meenal'],
      [4, 'B', 'Tanvi'],
    ],
  },
  {
    id: 'science',
    stages: [
      stage('Starter (5 minutes)', 'Ask where a shadow comes from. Pupils point to shadows in the room.'),
      stage('Teach (10 minutes)', 'Show how a shadow grows as the torch moves closer. For Need O: reads the extension card about eclipses.'),
      stage('Practise (15 minutes)', 'In groups, pupils move a torch and measure the shadow of a pencil. For Need C: buys only the black paper. For Need I: works in a different group. For Need G: measures two more objects.'),
      stage('Check (10 minutes)', 'Each group draws one diagram of the torch, the pencil and the shadow.'),
      stage('Homework', 'Pupils trace a shadow at noon. For Need E: does it on Friday.'),
    ],
    placed: [
      [1, 'O', 'Tanvi'],
      [2, 'C', 'Aarav'],
      [2, 'I', 'Kabir'],
      [2, 'I', 'Ishaan'],
      [2, 'G', 'Ishaan'],
    ],
    dropped: 1,
    hits: [[2, 'C', 'Aarav']],
  },
  {
    id: 'social',
    stages: [
      stage('Starter (5 minutes)', 'Pupils name three places everyone in the village knows.'),
      stage('Teach (10 minutes)', 'Draw a simple map of the school and the road outside it, with a key.'),
      stage('Practise (15 minutes)', 'Pupils find the nearest town on a map of the district. For Need H: comes before the first bell to catch up on the key.'),
      stage('Check (10 minutes)', 'A short quiz on the key, answered in front of the class. For Need F: says the answers to a partner, who writes them. For Need N: answers in writing instead.'),
      stage('Homework', 'Pupils sketch a map of their own street. For Need M: finishes the sketch in class the next day. for need a: nothing to change.'),
    ],
    placed: [
      [2, 'H', 'Aarav'],
      [3, 'F', 'Meenal'],
      [3, 'N', 'Tanvi'],
      [4, 'M', 'Aarav'],
      [4, 'A', 'Meenal'],
    ],
    dropped: 0,
    hits: [[2, 'H', 'Aarav']],
  },
  {
    id: 'art',
    stages: [
      stage('Starter (5 minutes)', 'Pupils bring old magazines and coloured paper from home. For Need C: uses magazines from the class box.'),
      stage('Teach (10 minutes)', 'Show how to tear and layer paper to make a hill, a river and a sky.'),
      stage('Practise (15 minutes)', 'Pupils make a collage of a place they like. For Need G: plans a second collage. For Need Q: sits near the front.'),
      stage('Check (10 minutes)', 'Display day begins before the first bell: all pupils set up their work then. For Need D: sets up at break instead.'),
      stage('Homework', 'Pupils send a photo of the finished collage to the teacher by phone. For Need B: emails the photo from home. For Need A:'),
    ],
    placed: [
      [0, 'C', 'Aarav'],
      [2, 'G', 'Ishaan'],
      [3, 'D', 'Aarav'],
      [4, 'B', 'Tanvi'],
    ],
    dropped: 2,
    hits: [[4, 'B', 'Tanvi']],
  },
];

/** The invented class as it stands after "Confirm all" on a lesson: every constraint and learning need confirmed, and every one with a line told. */
export function sampleNeeds() {
  const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
  const proposed = [...proposeConstraints(SAMPLE_NOTE, vault), ...proposeLearning(SAMPLE_NOTE, vault)];
  let held = { entities: vault, constraints: proposed };
  for (const c of proposed) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
  const constraints = held.constraints.map((c) => (lessonNeedLine(c) !== undefined ? { ...c, share: true } : c));
  const entities = lockConstraints(held.entities, constraints);
  return { note: SAMPLE_NOTE, entities, constraints, needs: lessonNeeds(constraints, entities) };
}

export interface NeedsRow {
  id: string;
  stage: string;
  letter: string;
  child: string;
  /** right: labelled and placed there. missing: labelled and not placed. wrong child: placed beside a child it was not labelled for. */
  outcome: 'right' | 'missing' | 'wrong child';
  /** Whether a rule should fire on the line for this child, and whether one did. */
  hitExpected: boolean;
  hitFound: boolean;
  why: string;
}

export interface NeedsTotals {
  replies: number;
  lines: number;
  right: number;
  missing: number;
  wrongChild: number;
  droppedExpected: number;
  droppedFound: number;
  hitsExpected: number;
  hitsFound: number;
  hitsMissed: number;
  hitsFalse: number;
}

/** Run the parser and the placing over the five replies. */
export function runNeedsSet(): { rows: NeedsRow[]; totals: NeedsTotals } {
  const { note, entities, constraints, needs } = sampleNeeds();
  const rows: NeedsRow[] = [];
  let droppedFound = 0;
  for (const c of NEEDS_CASES) {
    // The replies were written with their need lines inside the stages. Each line is carried into the section "For each need" as it is.
    const split = splitVariations(inlineToSection({ title: c.id, items: c.stages }), needs.map((n) => n.letter));
    droppedFound += split.dropped;
    const points = placeVariations(split.variations, needs, entities, split.draft.items, constraints, note);
    const key = (s: number, l: string, child: string) => `${s}:${l}:${child}`;
    const found = new Map(points.map((p) => [key(p.itemIndex, p.need!, p.child.split(' ')[0]), p]));
    const wanted = new Set(c.placed.map((p) => key(...p)));
    const hits = new Set(c.hits.map((p) => key(...p)));
    for (const k of new Set([...wanted, ...found.keys()])) {
      const [s, letter, child] = k.split(':');
      const p = found.get(k);
      rows.push({
        id: c.id,
        stage: c.stages[Number(s)].heading,
        letter,
        child,
        outcome: wanted.has(k) ? (p ? 'right' : 'missing') : 'wrong child',
        hitExpected: hits.has(k),
        hitFound: p?.why !== undefined,
        why: p?.why ?? '',
      });
    }
  }
  const n = (f: (r: NeedsRow) => boolean) => rows.filter(f).length;
  return {
    rows,
    totals: {
      replies: NEEDS_CASES.length,
      lines: NEEDS_CASES.reduce((sum, c) => sum + c.placed.length, 0),
      right: n((r) => r.outcome === 'right'),
      missing: n((r) => r.outcome === 'missing'),
      wrongChild: n((r) => r.outcome === 'wrong child'),
      droppedExpected: NEEDS_CASES.reduce((sum, c) => sum + c.dropped, 0),
      droppedFound,
      hitsExpected: n((r) => r.hitExpected),
      hitsFound: n((r) => r.hitExpected && r.hitFound),
      hitsMissed: n((r) => r.hitExpected && !r.hitFound),
      hitsFalse: n((r) => !r.hitExpected && r.hitFound),
    },
  };
}

// ---------------------------------------------------------------- needs from an exit ticket

/**
 * Cases for the builder of needs from an exit ticket: the marks of a
 * lesson and its topic, and the needs the next lesson should be told, by
 * letter, with the children each belongs to (first names; known on the
 * device only). Plain code, no model.
 */
export interface TicketCase {
  id: string;
  topic: string;
  ticket: Ticket;
  expected: [letter: string, line: string, children: string[]][];
}

export const TICKET_CASES: TicketCase[] = [
  {
    id: 'mixed',
    topic: 'Writing a short description of a place',
    ticket: { 'Aarav Sharma': 'absent', 'Diya Sharma': 'got', 'Meenal Joshi': 'partly', 'Kabir Qureshi': 'not', 'Tanvi Rao': 'got', 'Ishaan Verma': 'not' },
    expected: [
      ['J', 'has not yet got writing a short description of a place; needs it taught again another way', ['Ishaan', 'Kabir']],
      ['K', 'got writing a short description of a place quickly; needs a harder task', ['Diya', 'Tanvi']],
      ['L', 'was absent for writing a short description of a place', ['Aarav']],
    ],
  },
  {
    id: 'all-got-it',
    topic: 'Continue: Equivalent fractions.',
    ticket: Object.fromEntries(SAMPLE_CLASS_LIST.map((n) => [n, 'got' as const])),
    expected: [['K', 'got equivalent fractions quickly; needs a harder task', ['Aarav', 'Diya', 'Ishaan', 'Kabir', 'Meenal', 'Tanvi']]],
  },
  { id: 'partly-only', topic: 'Shadows', ticket: { 'Meenal Joshi': 'partly', 'Tanvi Rao': 'partly' }, expected: [] },
  { id: 'one-absent', topic: 'Maps and keys', ticket: { 'Kabir Qureshi': 'absent' }, expected: [['L', 'was absent for maps and keys', ['Kabir']]] },
  { id: 'no-marks', topic: 'Collage', ticket: {}, expected: [] },
];

export interface TicketRow {
  id: string;
  expected: string[];
  found: string[];
  right: boolean;
  /** True when no child's name and no count is in the lines the cloud would be told. */
  noNames: boolean;
}

/** Build the needs for each case as the app does on "Plan the next lesson", and set them against the labels. */
export function runTicketSet(): { rows: TicketRow[]; right: number; cases: number } {
  const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
  const rows = TICKET_CASES.map((c) => {
    const lesson: SavedLesson = {
      id: c.id,
      savedAt: '',
      fields: { klass: 'Class 6', subject: 'x', topic: c.topic, minutes: 40, lastTime: '' },
      title: c.topic,
      stages: [],
      adjustments: [],
      constraintIds: [],
      after: { stages: [], line: '', at: '', ticket: c.ticket },
    };
    const held = restoreConstraints(SAMPLE_NOTE, vault, withTicketNeeds([], lesson), []);
    const entities = lockConstraints(held.entities, held.constraints);
    const needs = lessonNeeds(held.constraints, entities);
    const first = (n: string) => n.split(' ')[0];
    const say = (letter: string, line: string, children: string[]) => `${letter}: ${line} [${[...children].sort().join(', ')}]`;
    const found = needs.map((n) => say(n.letter, n.line, [...n.children.map((id) => first(entities.find((e) => e.id === id)?.surfaces[0] ?? '?')), ...n.others.map(first)]));
    const expected = c.expected.map((e) => say(...e));
    const told = needs.map((n) => `Need ${n.letter}: ${n.line}`).join('\n');
    const noNames = needs.every((n) => n.issues.length === 0) && !SAMPLE_CLASS_LIST.some((n) => n.split(' ').some((part) => told.includes(part))) && !/\b\d+\b/.test(told);
    return { id: c.id, expected, found, right: expected.join('|') === found.join('|'), noNames };
  });
  return { rows, right: rows.filter((r) => r.right && r.noNames).length, cases: rows.length };
}

// ---------------------------------------------------------------- learning needs, for the on-device model

/**
 * Twelve invented paragraphs about one child each, for the proposer of
 * learning needs. `expected` are the kinds of need a careful reader would
 * take from the paragraph; an empty list means it has none (the paragraph
 * is about health, money, family or times, which are not learning needs).
 * The rule's answer is scored against the kinds. The on-device model
 * writes a free line, so its answer is shown for a person to read: only
 * whether its quote is in the paragraph and its line passes the gate is
 * counted.
 */
export interface LearningCase {
  id: string;
  child: string;
  paragraph: string;
  expected: LearningKind[];
}

export const LEARNING_CASES: LearningCase[] = [
  { id: 'absent', child: 'Nikhil', paragraph: 'Nikhil was absent for six days this month with his family at a wedding. He is cheerful and tries hard.', expected: ['missed'] },
  { id: 'early', child: 'Farah', paragraph: 'Farah finishes early in almost every lesson and gets bored. She then starts talking to her neighbour.', expected: ['early'] },
  { id: 'tests', child: 'Devika', paragraph: 'Devika knows the work when I ask her at her desk, but she is afraid of written tests and leaves half the paper blank.', expected: ['tests'] },
  { id: 'group', child: 'Samar', paragraph: 'Samar argues with his partner in pair work nearly every time. Alone he works steadily.', expected: ['group'] },
  { id: 'shy', child: 'Lata', paragraph: 'Lata is very shy and will not answer in front of the class, though her written work is good.', expected: ['shy'] },
  { id: 'reads-below', child: 'Gopal', paragraph: 'Gopal struggles with reading and is about two years behind the class. He follows well when a story is read to him.', expected: ['reads-below'] },
  { id: 'reads-above', child: 'Rhea', paragraph: 'Rhea reads far above her grade level and has finished every book on the class shelf.', expected: ['reads-above'] },
  { id: 'homework', child: 'Imran', paragraph: 'Imran has not handed in homework for three weeks. In class he does the work without trouble.', expected: ['homework'] },
  { id: 'two', child: 'Pooja', paragraph: 'Pooja missed two weeks of school in October and now freezes in tests, even on work she knew before.', expected: ['missed', 'tests'] },
  { id: 'none-health', child: 'Vikram', paragraph: 'Vikram has asthma and keeps an inhaler in his bag. He must not run in the dust.', expected: [] },
  { id: 'none-family', child: 'Sana', paragraph: "Sana's mother works nights, so nobody can come to school meetings. The family cannot pay for the trip.", expected: [] },
  { id: 'unlisted', child: 'Harsh', paragraph: 'Harsh understands a new idea much faster when he can draw it. He loses the thread in long spoken explanations.', expected: [] },
];

export interface LearningRuleRow {
  id: string;
  expected: LearningKind[];
  found: LearningKind[];
  right: boolean;
}

/** The vault of one paragraph, with its child on the class list. */
export const learningVault = (c: LearningCase) => buildVault(c.paragraph, deterministicCandidates(c.paragraph, [c.child]));

/** What the rule proposes for each paragraph, set against the labels. */
export function runLearningRules(): { rows: LearningRuleRow[]; right: number; cases: number } {
  const rows = LEARNING_CASES.map((c) => {
    const found = [...new Set(proposeLearning(c.paragraph, learningVault(c)).map((x) => x.learn!))].sort();
    const expected = [...c.expected].sort();
    return { id: c.id, expected, found, right: expected.join() === found.join() };
  });
  return { rows, right: rows.filter((r) => r.right).length, cases: rows.length };
}
