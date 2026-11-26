import type { Constraint } from '../core/types';
import { ruleConflicts } from '../core/conflicts';
import { defaultsFor } from '../core/constraints';

/**
 * A set for measuring the rule layer of the check (Layer A) on its own: a
 * step of advice and one confirmed constraint. No model is involved, so it
 * runs in any browser and in the unit tests.
 *
 * Every case here is invented, and none is taken from the 24 single-fact
 * cases or from the sample note. They were written before the rules were
 * run on them, and no rule was changed to make one of them pass: a case
 * the rules get wrong stays in the set and is counted. Rules were changed
 * later for cases outside this set, by someone who had seen it, so it is
 * no longer fresh for those rules. Its counts did not move.
 *
 * - conflict: the step cannot be followed, given the constraint.
 * - harmless: an ordinary step that has nothing to do with it.
 * - negated: the step names the very thing and steers round it.
 * - near-miss: the step uses words close to the rule's words and is fine.
 */
export interface RuleCase {
  id: string;
  sort: 'conflict' | 'harmless' | 'negated' | 'near-miss';
  constraint: Constraint;
  step: string;
}

const made = (kind: Constraint['kind'], text: string, extra: Partial<Constraint> = {}): Constraint => ({
  id: kind,
  kind,
  text,
  source: 'teacher',
  confirmed: true,
  ...extra,
});

const AFTER = made('time-after', 'has to be home straight after school to mind the shop');
const BEFORE = made('time-before', 'cannot get to school before the first bell');
const DAYS = made('days-away', 'is away on Tuesdays and Wednesdays', { days: ['Tuesday', 'Wednesday'] });
const MONEY = made('money', 'the family cannot pay for anything extra');
const OFFLINE = made('no-phone-internet', 'has no phone and no internet at home');
const FATHER = made('contact', 'his father must not be contacted', { who: 'father' });
const GUARDIAN = made('contact', 'lives with his grandmother', { who: 'parents', guardian: 'grandmother', away: true });
const EPILEPSY = made('health', 'has epilepsy', defaultsFor('health', 'has epilepsy'));
const ASTHMA = made('health', 'has asthma', defaultsFor('health', 'has asthma'));
const NUTS = made('health', 'has a nut allergy', defaultsFor('health', 'has a nut allergy'));

const LIST: [string, RuleCase['sort'], Constraint, string][] = [
  ['after-1', 'conflict', AFTER, 'Offer her twenty minutes of extra help once the final bell has gone.'],
  ['after-2', 'conflict', AFTER, 'Invite him to homework club, which runs from 3.30 to 4.30 in the afternoon.'],
  ['after-3', 'conflict', AFTER, 'Ask her to stay behind for five minutes on Thursday to go over the test.'],
  ['after-4', 'conflict', AFTER, 'Put him in the after-school reading group.'],
  ['after-5', 'harmless', AFTER, 'Give her the last five minutes of the lesson to pack her bag calmly.'],
  ['after-6', 'harmless', AFTER, 'Let him start the worksheet in the lesson and finish it at lunch.'],
  ['after-7', 'negated', AFTER, 'Keep all extra practice inside lesson time, never after school.'],
  ['after-8', 'near-miss', AFTER, 'After the lesson starter, check her planner.'],
  ['after-9', 'near-miss', AFTER, 'Ring the bell for the end of group work.'],

  ['before-1', 'conflict', BEFORE, 'Ask him to arrive fifteen minutes before the first bell to change his reading book.'],
  ['before-2', 'conflict', BEFORE, 'Run a breakfast reading club at 7.30 for him.'],
  ['before-3', 'conflict', BEFORE, 'Have her come in early twice a week for spelling.'],
  ['before-4', 'harmless', BEFORE, 'Check his reading record during registration.'],
  ['before-5', 'harmless', BEFORE, 'Give her the first task as soon as the lesson begins.'],
  ['before-6', 'negated', BEFORE, 'Do not ask him to come before school; use break time instead.'],
  ['before-7', 'near-miss', BEFORE, 'Tell him early in the lesson what the plan is.'],

  ['days-1', 'conflict', DAYS, 'Set his spelling test for Wednesday.'],
  ['days-2', 'conflict', DAYS, 'Pair him with a reading buddy every Tuesday.'],
  ['days-3', 'conflict', DAYS, 'Hand out the project on Tues and collect it the next week.'],
  ['days-4', 'harmless', DAYS, 'Set his spelling test for Thursday.'],
  ['days-5', 'harmless', DAYS, "Give him the week's sheet on Monday so he has it in good time."],
  ['days-6', 'negated', DAYS, 'Avoid Tuesday and Wednesday for anything he must not miss.'],
  ['days-7', 'near-miss', DAYS, 'Give him two days to finish the worksheet.'],

  ['money-1', 'conflict', MONEY, 'Ask the family to get him a geometry set from the stationery shop.'],
  ['money-2', 'conflict', MONEY, 'Each child should bring forty rupees for the museum visit.'],
  ['money-3', 'conflict', MONEY, 'Suggest a private tutor for an hour a week.'],
  ['money-4', 'conflict', MONEY, 'Ask her parents to purchase the class reader.'],
  ['money-5', 'harmless', MONEY, 'Lend him a geometry set from the class box.'],
  ['money-6', 'harmless', MONEY, 'Give her spare paper and a pencil from the tray.'],
  ['money-7', 'negated', MONEY, 'Use the library copy so that nobody has to buy the book.'],
  ['money-8', 'near-miss', MONEY, 'Ask him to pay close attention to place value.'],

  ['offline-1', 'conflict', OFFLINE, 'Send the weekly spellings to the family by WhatsApp.'],
  ['offline-2', 'conflict', OFFLINE, 'Ask her to look up three facts on the web at home.'],
  ['offline-3', 'conflict', OFFLINE, 'Set the homework quiz on the class website.'],
  ['offline-4', 'conflict', OFFLINE, 'Ring the family on their mobile each Friday.'],
  ['offline-5', 'harmless', OFFLINE, 'Send the weekly spellings home on a printed slip.'],
  ['offline-6', 'harmless', OFFLINE, 'Let her use the class dictionary to look up three words.'],
  ['offline-7', 'negated', OFFLINE, 'Give him the worksheet on paper, since he cannot do it online.'],
  ['offline-8', 'near-miss', OFFLINE, 'Build his phonics with ten minutes of sound cards.'],
  ['offline-9', 'near-miss', OFFLINE, 'Ask her to apply the spelling rule to five new words.'],

  ['contact-1', 'conflict', FATHER, 'Phone his father to arrange a meeting about attendance.'],
  ['contact-2', 'conflict', FATHER, 'Send a letter home addressed to Mr and Mrs Verma.'],
  ['contact-3', 'conflict', FATHER, 'Ask his dad to sign the reading record each night.'],
  ['contact-4', 'harmless', FATHER, 'Ask his mother to sign the reading record each night.'],
  ['contact-5', 'harmless', FATHER, 'Praise him for his neat work at the end of the day.'],
  ['contact-6', 'negated', FATHER, 'Speak to his mother only, and do not contact his father.'],
  ['contact-7', 'conflict', GUARDIAN, 'Invite both parents to see his work on Friday.'],
  ['contact-8', 'conflict', GUARDIAN, 'Write a short note to his mum about the good week he has had.'],
  ['contact-9', 'harmless', GUARDIAN, 'Write a short note to his grandmother about the good week he has had.'],
  ['contact-10', 'near-miss', GUARDIAN, "Let him tell a friend about his grandparents' farm."],
  ['contact-11', 'negated', GUARDIAN, 'Address the note to his grandmother rather than to his parents.'],

  ['health-1', 'conflict', EPILEPSY, 'Reward the table with a disco session with strobe lighting.'],
  ['health-2', 'conflict', EPILEPSY, 'Show the fireworks film with its bright flashes.'],
  ['health-3', 'conflict', ASTHMA, 'Make her the board monitor, cleaning chalk dust at the end of each day.'],
  ['health-4', 'conflict', ASTHMA, 'Have him run two laps of the field as a brain break.'],
  ['health-5', 'conflict', ASTHMA, 'Put him in the relay team for sports day.'],
  ['health-6', 'conflict', NUTS, 'Bring in peanut butter sandwiches for the picnic.'],
  ['health-7', 'harmless', ASTHMA, 'Give her a seat by the open window.'],
  ['health-8', 'harmless', EPILEPSY, 'Let him hand out the books.'],
  ['health-9', 'negated', ASTHMA, 'Give him a job as scorer instead of running in the races.'],
  ['health-10', 'near-miss', ASTHMA, 'Keep a running record of the books she finishes.'],
  ['health-11', 'near-miss', NUTS, 'In a nutshell, keep instructions short.'],
];

export const RULE_CASES: RuleCase[] = LIST.map(([id, sort, constraint, step]) => ({ id, sort, constraint, step }));

export interface RuleRow {
  id: string;
  sort: RuleCase['sort'];
  kind: Constraint['kind'];
  constraint: string;
  step: string;
  expected: 'conflict' | 'none';
  /** What the rule said: a conflict, a query (the words are there but the rule cannot tell), or nothing. */
  got: 'conflict' | 'unsure' | 'none';
  matched: string;
  right: boolean;
}

export interface RuleTotals {
  cases: number;
  conflictCases: number;
  /** Conflict cases the rule called a conflict. */
  caught: number;
  /** Conflict cases the rule only queried. */
  queried: number;
  /** Conflict cases the rule said nothing about. */
  missed: number;
  /** Cases that are not conflicts: harmless, negated and near-miss. */
  otherCases: number;
  /** Of those, the ones the rule said nothing about. */
  passed: number;
  /** Of those, the ones the rule wrongly called a conflict or queried. */
  falseAlarms: number;
}

/** Run every case through the rule layer. Nothing is sent anywhere and no model is asked. */
export function runRuleSet(cases: RuleCase[] = RULE_CASES): { rows: RuleRow[]; totals: RuleTotals } {
  const rows = cases.map((c): RuleRow => {
    const hit = ruleConflicts(c.step, c.constraint, { name: 'the student' });
    const expected = c.sort === 'conflict' ? 'conflict' : 'none';
    const got = hit?.verdict ?? 'none';
    return { id: c.id, sort: c.sort, kind: c.constraint.kind, constraint: c.constraint.text, step: c.step, expected, got, matched: hit?.matched ?? '', right: got === expected };
  });
  const conflicts = rows.filter((r) => r.expected === 'conflict');
  const others = rows.filter((r) => r.expected === 'none');
  return {
    rows,
    totals: {
      cases: rows.length,
      conflictCases: conflicts.length,
      caught: conflicts.filter((r) => r.got === 'conflict').length,
      queried: conflicts.filter((r) => r.got === 'unsure').length,
      missed: conflicts.filter((r) => r.got === 'none').length,
      otherCases: others.length,
      passed: others.filter((r) => r.got === 'none').length,
      falseAlarms: others.filter((r) => r.got !== 'none').length,
    },
  };
}
