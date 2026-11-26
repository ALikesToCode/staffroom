import { describe, expect, it } from 'vitest';
import { detailsFor } from '../ai/check';
import { combineChecks, ruleCheckItem } from '../core/conflicts';
import { CASES, prepare } from './cases';
import { prepareFull } from './full';
import { HELDOUT } from './heldout';
import { RULE_CASES, runRuleSet } from './rules';
import { FIT_CASES, fitInput, fitRow, fitTotals } from './fit';
import { ruleConflicts } from '../core/conflicts';
import type { FitAsk } from '../ai/fit';

describe('the rule layer measured on fresh pairs', () => {
  const { rows, totals } = runRuleSet();

  it('has at least 40 pairs, with conflicts, harmless steps, negated steps and near-misses for every kind a rule can check', () => {
    expect(RULE_CASES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(RULE_CASES.map((c) => c.id)).size).toBe(RULE_CASES.length);
    for (const kind of ['time-after', 'time-before', 'days-away', 'money', 'no-phone-internet', 'contact', 'health']) {
      const sorts = new Set(RULE_CASES.filter((c) => c.constraint.kind === kind).map((c) => c.sort));
      expect([...sorts].sort(), kind).toEqual(['conflict', 'harmless', 'near-miss', 'negated']);
    }
    // None is one of the 24 tuned cases.
    const tuned = new Set(CASES.map((c) => c.advice.replace('[Student 1]', '').trim()));
    expect(RULE_CASES.some((c) => tuned.has(c.step))).toBe(false);
  });

  it('reports what the rules get right and wrong, as it is', () => {
    // These numbers are a measurement, not a target. The rules were not changed to move them, and a case
    // the rules get wrong stays here by name. If a rule changes, these change, and say so in the commit.
    expect(totals).toEqual({ cases: 62, conflictCases: 29, caught: 19, queried: 0, missed: 10, otherCases: 33, passed: 30, falseAlarms: 3 });
    expect(rows.filter((r) => r.expected === 'conflict' && r.got !== 'conflict').map((r) => r.id)).toEqual([
      'after-1', // "once the final bell has gone": no "after"
      'after-2', // a club at 3.30: a time of day, which no rule reads
      'before-2', // "at 7.30": the same
      'days-3', // "Tues": an abbreviation
      'money-1', // "get him a geometry set from the shop": no word for paying
      'money-3', // "a private tutor": the rule knows "tuition"
      'offline-2', // "on the web"
      'contact-2', // "Mr and Mrs": no word for a parent
      'health-2', // "flashes": the trigger is "flashing"
      'health-5', // "the relay team": the trigger is "race"
    ]);
    expect(rows.filter((r) => r.expected === 'none' && r.got !== 'none').map((r) => [r.id, r.matched])).toEqual([
      ['money-7', 'buy'], // "nobody has to buy": a negation the rule does not know
      ['money-8', 'pay'], // "pay close attention"
      ['health-10', 'running'], // "a running record"
    ]);
  });
});

describe('the rule layer on the full-note set', () => {
  const set = prepareFull();

  it('has the constraints the rules propose from the sample note, all confirmed and none told to the cloud', () => {
    expect(set.constraints.map((c) => [c.kind, c.confirmed, Boolean(c.share)])).toEqual([
      ['money', true, false],
      ['time-before', true, false],
      ['health', true, false],
      ['time-after', true, false],
      ['contact', true, false],
    ]);
    // Each is tied to a withheld fact of the fixed vault.
    for (const c of set.constraints) expect(set.entities.find((e) => e.id === c.detailId)?.withheld, c.kind).toBe(true);
  });

  it('includes messages home with the two planted conflicts', () => {
    const home = set.cases.filter((c) => c.id.startsWith('draft-6-'));
    expect(home.filter((c) => c.expected === 'conflict').map((c) => c.student)).toEqual(['Aarav', 'Kabir']);
    expect(home.find((c) => c.student === 'Aarav')!.item.text).toContain('buy the practice workbook');
    expect(home.find((c) => c.student === 'Kabir')!.item.text).toContain('both parents to come in');
  });

  it('reports, item by item, what the rules alone find', () => {
    // A measurement, as above. This set is not held out from the rules: its first five drafts were written
    // before them, and the rules were written knowing the sample note.
    const got = set.cases.map((c) => ({ c, r: ruleCheckItem(c.item, set.constraints, set.entities, set.tokens, set.note) }));
    const conflicts = got.filter((x) => x.c.expected === 'conflict');
    const others = got.filter((x) => x.c.expected === 'compatible');
    expect(conflicts.map((x) => [x.c.id, x.r.hit?.verdict ?? 'none', x.r.hit?.matched ?? ''])).toEqual([
      ['draft-1-meenal', 'conflict', 'after the last bell'],
      ['draft-2-aarav', 'conflict', 'before the first bell'],
      ['draft-2-meenal', 'conflict', 'after the last bell'],
      ['draft-3-kabir', 'conflict', 'mother and father'],
      ['draft-4-meenal', 'conflict', 'evening'],
      ['draft-5-aarav', 'conflict', 'before school'],
      ['draft-5-meenal', 'conflict', 'after the last bell'],
      ['draft-6-aarav', 'conflict', 'buy'],
      ['draft-6-kabir', 'conflict', 'both parents'],
    ]);
    expect(others.filter((x) => x.r.hit).map((x) => x.c.id)).toEqual([]);
    // With no model, a caught item is a conflict and the others the rules compared are "checked by rule only".
    const unchecked = { verdict: 'not checked' as const, reason: 'x' };
    expect(combineChecks(got[1].r, undefined, unchecked)).toMatchObject({ verdict: 'conflict', by: 'rule', cloudSaw: 'She [withheld] to Rampur Kalan and [withheld]' });
    expect(combineChecks(got[0].r, undefined, unchecked)).toMatchObject({ verdict: 'not checked', rules: 2 });
    expect(combineChecks(got[3].r, undefined, unchecked)).toBe(unchecked);
  });
});

describe('the held-out set for the on-device model', () => {
  it('is sixteen single-fact cases, eight of each sort, with children and facts that are in no other set', () => {
    expect(HELDOUT).toHaveLength(16);
    expect(HELDOUT.filter((c) => c.expected === 'conflict')).toHaveLength(8);
    expect(new Set(HELDOUT.map((c) => c.id)).size).toBe(16);
    const known = new Set(CASES.map((c) => c.student));
    const full = prepareFull();
    for (const c of HELDOUT) {
      expect(known.has(c.student), c.student).toBe(false);
      expect(full.note.includes(c.student), c.student).toBe(false);
      expect(CASES.some((k) => k.fact === c.fact || k.advice === c.advice), c.id).toBe(false);
    }
  });

  it('puts each case to the check as one child with one withheld fact', () => {
    for (const c of HELDOUT) {
      const p = prepare(c);
      const groups = detailsFor(p.item, p.entities);
      expect(groups, c.id).toHaveLength(1);
      expect(groups[0].student?.surfaces[0], c.id).toBe(c.student);
      expect(groups[0].details.map((d) => d.surfaces[0]), c.id).toEqual([c.fact]);
      expect(p.note, c.id).toContain(c.fact);
    }
  });
});

describe('the fit set', () => {
  const says = (rewrite: string) => ({ text: JSON.stringify({ rewrite }), onDevice: true });

  it('has two fresh pairs for every kind a rule can check, each a step the rule calls a conflict', () => {
    expect(FIT_CASES).toHaveLength(14);
    expect(new Set(FIT_CASES.map((c) => c.id)).size).toBe(14);
    for (const kind of ['time-after', 'time-before', 'days-away', 'money', 'no-phone-internet', 'contact', 'health']) {
      expect(FIT_CASES.filter((c) => c.constraint.kind === kind), kind).toHaveLength(2);
    }
    for (const c of FIT_CASES) expect(ruleConflicts(c.step, c.constraint)?.verdict, c.id).toBe('conflict');
    // None is a step of another set.
    const used = new Set([...RULE_CASES.map((c) => c.step), ...CASES.map((c) => c.advice), ...HELDOUT.map((c) => c.advice)]);
    expect(FIT_CASES.some((c) => used.has(c.step))).toBe(false);
    expect(prepareFull().cases.some((full) => FIT_CASES.some((c) => full.item.text.includes(c.step)))).toBe(false);
  });

  it('reports the first answer on its own, and what would be offered after the one retry', async () => {
    const c = FIT_CASES.find((x) => x.id === 'after-1')!;
    const answers = [says('Ask Ritika to stay behind at lunch, as she has to catch the last bus to her village.'), says('Give Ritika fifteen minutes at lunch on Monday to finish her map.')];
    let n = 0;
    const ask: FitAsk = async () => answers[n++];
    const row = await fitRow(c, ask);
    expect(row.first).toEqual({
      produced: true,
      rewrite: 'Ask Ritika to stay behind at lunch, as she has to catch the last bus to her village.',
      rulePasses: false,
      matched: ['stay behind'],
      factWords: ['catch', 'last', 'village'],
    });
    expect(row.offered).toEqual({ ok: true, suggestion: 'Give Ritika fifteen minutes at lunch on Monday to finish her map.', requests: 2, factWords: [] });
    expect(fitInput(c)).toMatchObject({ studentName: 'Ritika', task: 'plan' });
  });

  it('counts a pair with no usable answer, and one whose run stopped, without inventing a rewrite', async () => {
    const none = await fitRow(FIT_CASES[0], async () => says(FIT_CASES[0].step));
    expect(none.first.produced).toBe(false);
    expect(none.offered).toEqual({ ok: false, suggestion: '', requests: 2, factWords: [] });
    const stopped = await fitRow(FIT_CASES[1], async () => ({ text: 'x', onDevice: false }));
    expect(stopped.error).toBe('The fit did not run on the device. Stopped.');
    const good = await fitRow(FIT_CASES[6], async () => says('Lend Farhan a geometry box from the class set for next week.'));
    expect(fitTotals([none, stopped, good])).toEqual({ cases: 3, produced: 1, rulePasses: 1, saysFact: 0, offered: 1, offeredSaysFact: 0, errors: 1 });
  });
});
