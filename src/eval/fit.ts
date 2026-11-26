import type { Constraint } from '../core/types';
import { factWordsIn, fitHits, fitPrompt, fitStep, readFit, type FitAsk, type FitInput } from '../ai/fit';

/**
 * A set for measuring the fit: a step of advice that goes against one
 * confirmed constraint, which the on-device model is asked to rewrite so
 * the child can follow it. Two pairs for each kind of constraint that has
 * a rule; `other` has none, so a rewrite of it could not be compared.
 *
 * Every pair is invented, and none is taken from the other sets or from
 * the sample note. They were written before any model was run on them.
 * The unit tests run this with a fake model; the numbers come only from a
 * run in Chrome with the on-device model.
 */
export interface FitCase {
  id: string;
  student: string;
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

const LIST: [string, string, Constraint, string][] = [
  ['after-1', 'Ritika', made('time-after', 'has to catch the 3.40 bus, the last one to her village'), 'Ask Ritika to stay back for fifteen minutes on Monday to finish her map.'],
  ['after-2', 'Dev', made('time-after', 'minds his younger sisters from the last bell until his mother is back'), 'Put Dev down for the after-school chess practice.'],
  ['before-1', 'Sana', made('time-before', 'cannot be at school before the first bell: her bus gets in at ten to nine'), 'Ask Sana to come in early on Friday to set up the science table.'],
  ['before-2', 'Imran', made('time-before', 'delivers milk with his uncle until just before the first bell'), 'Meet Imran before school to hear him read.'],
  ['days-1', 'Naveen', made('days-away', 'is away on Thursdays, when he takes his grandfather to the clinic', { days: ['Thursday'] }), 'Give Naveen his spelling test on Thursday morning.'],
  ['days-2', 'Pooja', made('days-away', 'does not come on Saturdays: she works at the market stall', { days: ['Saturday'] }), 'Ask Pooja to join the Saturday revision class.'],
  ['money-1', 'Farhan', made('money', 'the family cannot afford anything beyond the school fees this year'), 'Ask Farhan to buy a geometry box for next week.'],
  ['money-2', 'Lata', made('money', 'her mother is out of work and there is no money for extras'), 'Ask Lata to bring money for the class trip to the museum.'],
  ['offline-1', 'Gopal', made('no-phone-internet', 'there is no phone and no internet in the house'), 'Ask Gopal to watch the fractions video online at home.'],
  ['offline-2', 'Mini', made('no-phone-internet', 'the only phone in the family goes to work with her father'), 'Send Mini her weekly spellings by WhatsApp.'],
  ['contact-1', 'Rohan', made('contact', 'his father must not be contacted', { who: 'father' }), "Telephone Rohan's father about the missing homework."],
  ['contact-2', 'Kiran', made('contact', 'lives with her aunt while her parents work abroad', { who: 'parents', guardian: 'aunt', away: true }), "Ask Kiran's parents to sign her reading record each night."],
  ['health-1', 'Tara', made('health', 'has asthma', { triggers: ['running', 'laps', 'dust'] }), 'Have Tara run two laps of the field as a warm-up.'],
  ['health-2', 'Vivek', made('health', 'gets migraines from bright screens', { triggers: ['screen', 'projector'] }), 'Seat Vivek at the front, next to the projector.'],
];

export const FIT_CASES: FitCase[] = LIST.map(([id, student, constraint, step]) => ({ id, student, constraint, step }));

export const fitInput = (c: FitCase): FitInput => ({ step: c.step, itemText: c.step, constraint: c.constraint, studentName: c.student, task: 'plan' });

/** What the model gave for one pair. `first` is its first answer on its own; `offered` is what the app would put in the box, after the one retry. */
export interface FitRow {
  id: string;
  kind: Constraint['kind'];
  constraint: string;
  step: string;
  first: {
    /** The first answer could be read, was not empty and was not the step again. */
    produced: boolean;
    rewrite: string;
    /** No rule fires on it against the constraint. False when nothing was produced. */
    rulePasses: boolean;
    /** The words a rule matched in it. */
    matched: string[];
    /** The words of the private fact that it repeats. */
    factWords: string[];
  };
  offered: { ok: boolean; suggestion: string; requests: number; factWords: string[] };
  /** Set when the run of this pair stopped: no on-device model, a failed request, or an answer from elsewhere. */
  error?: string;
}

export interface FitTotals {
  cases: number;
  /** First answers that were a rewrite at all. */
  produced: number;
  /** First answers that no rule fires on. */
  rulePasses: number;
  /** First answers that repeat words of the private fact. */
  saysFact: number;
  /** Pairs for which a suggestion was offered, the retry included. */
  offered: number;
  /** Offered suggestions that repeat words of the private fact. */
  offeredSaysFact: number;
  /** Pairs whose run stopped. */
  errors: number;
}

/** Run one pair. The model is asked as the app asks it; its first answer is also kept and read on its own. */
export async function fitRow(c: FitCase, ask: FitAsk): Promise<FitRow> {
  const input = fitInput(c);
  const answers: string[] = [];
  const recording: FitAsk = async (prompt) => {
    const answer = await ask(prompt);
    if (answer.onDevice) answers.push(answer.text);
    return answer;
  };
  const row: FitRow = {
    id: c.id,
    kind: c.constraint.kind,
    constraint: c.constraint.text,
    step: c.step,
    first: { produced: false, rewrite: '', rulePasses: false, matched: [], factWords: [] },
    offered: { ok: false, suggestion: '', requests: 0, factWords: [] },
  };
  try {
    const got = await fitStep(input, recording);
    row.offered = got.ok
      ? { ok: true, suggestion: got.suggestion, requests: got.asked, factWords: factWordsIn(got.suggestion, c.constraint) }
      : { ok: false, suggestion: '', requests: got.asked, factWords: [] };
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e);
  }
  const rewrite = answers.length > 0 ? readFit(answers[0], c.step) : undefined;
  if (rewrite) {
    const hits = fitHits(rewrite, input);
    row.first = { produced: true, rewrite, rulePasses: hits.length === 0, matched: hits.map((h) => h.matched), factWords: factWordsIn(rewrite, c.constraint) };
  }
  return row;
}

export function fitTotals(rows: FitRow[]): FitTotals {
  return {
    cases: rows.length,
    produced: rows.filter((r) => r.first.produced).length,
    rulePasses: rows.filter((r) => r.first.rulePasses).length,
    saysFact: rows.filter((r) => r.first.factWords.length > 0).length,
    offered: rows.filter((r) => r.offered.ok).length,
    offeredSaysFact: rows.filter((r) => r.offered.ok && r.offered.factWords.length > 0).length,
    errors: rows.filter((r) => r.error !== undefined).length,
  };
}

/** The first prompt of a pair, for the table. */
export const fitFirstPrompt = (c: FitCase) => fitPrompt(fitInput(c));
