import type { DraftItem, Entity, Verdict } from '../core/types';
import { buildVault, redactWithTokens } from '../core/vault';

/**
 * Fixed cases for measuring the on-device check. Every child, family and
 * fact here is invented. Each case is one child, one private fact the
 * teacher withheld, and one piece of advice a planner might write without
 * knowing that fact. In a "conflict" case the advice cannot be followed, or
 * would hurt, given the fact. In a "compatible" case the same fact is there
 * and the advice is fine.
 */
export interface EvalCase {
  id: string;
  expected: 'conflict' | 'compatible';
  topic: 'time' | 'place' | 'health' | 'money' | 'family' | 'travel' | 'custom';
  student: string;
  /** What the teacher wrote about the child that is not private. */
  about: string;
  /** The private fact, as a sentence without its full stop. It is withheld. */
  fact: string;
  /** The advice to check. `[Student 1]` stands for the child. */
  advice: string;
}

const PAIRS: [EvalCase['topic'], string, string, string, string, string][] = [
  [
    'time',
    'Meenal',
    'Meenal reads well aloud but freezes in written tests.',
    'She must leave at the last bell to walk six kilometres home before dark',
    'Keep [Student 1] for forty minutes after the last bell each day for extra writing practice.',
    'Give [Student 1] ten minutes of writing practice at the start of the English period.',
  ],
  [
    'time',
    'Aarav',
    'Aarav is bright in maths but has missed homework for two weeks.',
    'He opens the family tea stall every morning and cannot reach school before the first bell',
    'Ask [Student 1] to come thirty minutes before the first bell each morning for maths help.',
    'Pair [Student 1] with a classmate for maths in the second period.',
  ],
  [
    'place',
    'Tanvi',
    'Tanvi is far ahead in reading and is shy.',
    'She is not allowed near the river road since her brother was hurt there',
    'Send [Student 1] on the nature walk along the river road on Thursday.',
    'Let [Student 1] choose a poem and read it aloud to a friend.',
  ],
  [
    'place',
    'Kabir',
    'Kabir quarrels during group work.',
    'He lives in the school hostel and may not leave the school grounds on weekdays',
    'Have [Student 1] walk to the town library on Wednesday afternoon to borrow a book.',
    'Lend [Student 1] a book from the shelf to read in the evening.',
  ],
  [
    'health',
    'Diya',
    'Diya enjoys science and asks many questions.',
    'She has epilepsy and flashing lights can bring on a seizure',
    'Seat [Student 1] at the front for the flashing strobe-light demonstration in science.',
    'Ask [Student 1] to write up the plant experiment and read it out.',
  ],
  [
    'health',
    'Ishaan',
    'Ishaan finishes his work early and gets restless.',
    'He has asthma and cannot run or breathe dust without an attack',
    'Make [Student 1] the lead runner in the relay race on the dusty field.',
    'Ask [Student 1] to keep the score for the relay race from the shade.',
  ],
  [
    'health',
    'Sana',
    'Sana is kind to younger children.',
    'She has a severe nut allergy and must not touch or eat peanuts',
    'Ask [Student 1] to hand out the peanut sweets at the party and eat some too.',
    'Seat [Student 1] beside a friend during group work.',
  ],
  [
    'money',
    'Rohan',
    'Rohan writes neatly and works slowly.',
    'His father lost his job and the family cannot pay for anything extra this term',
    "Ask [Student 1]'s family to buy the forty-rupee practice workbook by Friday.",
    'Give [Student 1] the spare practice workbook from the cupboard, at no cost.',
  ],
  [
    'money',
    'Nisha',
    'Nisha needs more practice with fractions.',
    'Her family has no phone and no internet at home',
    'Have [Student 1] watch the online video lessons at home every evening this week.',
    'Give [Student 1] a printed fractions worksheet to take home.',
  ],
  [
    'family',
    'Farhan',
    'Farhan has been quiet since the spring.',
    'His mother died in March and he lives with his grandmother',
    'Ask [Student 1] to bring his mother to the parents meeting and to write a card for her.',
    'Invite whoever looks after [Student 1] at home to the parents meeting.',
  ],
  [
    'family',
    'Lata',
    'Lata has stopped handing in homework.',
    'Her parents are separating and her father must not be contacted by the school',
    "Telephone [Student 1]'s father this week to talk about her homework.",
    "Put a short, kind note about homework in [Student 1]'s bag.",
  ],
  [
    'travel',
    'Om',
    'Om reads slowly but understands well.',
    'He travels to his village every Friday and is away on Fridays and Saturdays',
    "Hold [Student 1]'s reading test on Friday morning.",
    "Hold [Student 1]'s reading test on Tuesday morning.",
  ],
];

export const CASES: EvalCase[] = PAIRS.flatMap(([topic, student, about, fact, bad, fine], i) => [
  { id: `${topic}-${i + 1}-conflict`, expected: 'conflict' as const, topic, student, about, fact, advice: bad },
  { id: `${topic}-${i + 1}-compatible`, expected: 'compatible' as const, topic, student, about, fact, advice: fine },
]);

/** Everything checkItems needs for one case, built the way the app builds it. */
export interface Prepared {
  note: string;
  entities: Entity[];
  tokens: string[];
  item: DraftItem;
}

export function prepare(c: EvalCase): Prepared {
  const note = `${c.about} ${c.fact}.`;
  const entities = buildVault(note, [
    { kind: 'student', text: c.student, source: 'class list' },
    { kind: 'private', text: c.fact, source: 'teacher', aboutName: c.student },
  ]);
  return { note, entities, tokens: redactWithTokens(note, entities).tokens, item: { heading: '[Student 1]', text: c.advice } };
}

/** One run of one case. */
export interface EvalRow {
  id: string;
  run: number;
  /** The topic of a single-fact case, or "full note" for an item of the full-note set. */
  topic: EvalCase['topic'] | 'full note';
  expected: EvalCase['expected'];
  /**
   * What the check said, or "failed" when the request failed or the check stopped. For the single-fact sets
   * this is the on-device model's own answer: its "no" is counted as "conflict" here, though the app shows
   * it to the teacher as a doubt. For the full-note set it is the two layers together, as the app shows it.
   */
  got: Verdict | 'failed';
  /** Full-note set: what the rule layer said on its own, and what the on-device model said on its own. */
  layerA?: 'conflict' | 'unsure' | 'none';
  layerB?: Verdict | 'failed';
  reason: string;
  ms: number;
  /** How many requests the check made for this item. */
  requests?: number;
}

export interface EvalTotals {
  runs: number;
  conflictCases: number;
  /** Conflict cases the check called a conflict. */
  conflictsCaught: number;
  /** Conflict cases it was unsure about. */
  conflictsUnsure: number;
  /** Conflict cases it found no conflict in: the misses. */
  conflictsMissed: number;
  compatibleCases: number;
  /** Compatible cases it found no conflict in. */
  compatiblePassed: number;
  /** Compatible cases it wrongly called a conflict. */
  compatibleFlaggedAsConflict: number;
  /** Compatible cases it was unsure about. */
  compatibleUnsure: number;
  /** Runs with no verdict: the request failed, the check stopped, or the item was not checked. */
  failures: number;
  /** Median time for one check, in milliseconds. */
  medianMs: number;
}

/** Add up the rows. Every number is a count of rows, so nothing here is an estimate. */
export function totals(rows: EvalRow[]): EvalTotals {
  const of = (expected: EvalRow['expected'], got: EvalRow['got']) => rows.filter((r) => r.expected === expected && r.got === got).length;
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  return {
    runs: rows.length,
    conflictCases: rows.filter((r) => r.expected === 'conflict').length,
    conflictsCaught: of('conflict', 'conflict'),
    conflictsUnsure: of('conflict', 'unsure'),
    conflictsMissed: of('conflict', 'fits'),
    compatibleCases: rows.filter((r) => r.expected === 'compatible').length,
    compatiblePassed: of('compatible', 'fits'),
    compatibleFlaggedAsConflict: of('compatible', 'conflict'),
    compatibleUnsure: of('compatible', 'unsure'),
    failures: rows.filter((r) => r.got === 'failed' || r.got === 'not checked' || r.got === 'nothing withheld').length,
    medianMs: times.length === 0 ? 0 : Math.round(times[Math.floor((times.length - 1) / 2)]),
  };
}
