import { describe, expect, it } from 'vitest';
import type { Constraint, DraftItem, ItemCheck } from './types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from './samples';
import { buildVault, deterministicCandidates, possibleNameCandidates, redactWithTokens } from './vault';
import { confirmConstraint, proposeConstraints } from './constraints';
import { combineChecks, ruleCheckItem } from './conflicts';
import { keptAfterRecheck, modelSaid, recheckItems, REWRITTEN_CLEAR, REWRITTEN_UNCOMPARED, rewriteStep, standInsFor, stepIndexOf, stepToRewrite, UNCOMPARED } from './recheck';
import { lockConstraints } from './constraints';
import { checkReply } from './gate';
import { familyFor } from './family';
import { outgoingOf } from './needs';

// The sample note, guarded by rule, with every proposed constraint confirmed.
const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
let held = { entities: vault, constraints: proposeConstraints(SAMPLE_NOTE, vault) };
for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
const { entities, constraints } = held;
const { tokens } = redactWithTokens(SAMPLE_NOTE, entities);
const meenal = entities.find((e) => e.surfaces.includes('Meenal'))!;
const lastBell = constraints.find((c) => c.kind === 'time-after')!;

const items: DraftItem[] = [
  {
    heading: `A note home for ${meenal.token}`,
    text: `${meenal.token} reads aloud with confidence. Please encourage her to attend the after-school writing club this week. A few lines of writing at home each day would help too.`,
  },
  { heading: 'For the class', text: 'Read for ten minutes each morning.' },
];
const noTold = new Map<string, string>();
const first = (list: Constraint[], model: (ItemCheck | undefined)[] = []) =>
  items.map((item, i) => combineChecks(ruleCheckItem(item, list, entities, tokens, SAMPLE_NOTE, noTold), model[i], { verdict: 'not checked', reason: 'x' }));

describe('a constraint switched off and on, with the same draft', () => {
  const off = constraints.map((c) => (c.id === lastBell.id ? { ...c, confirmed: false } : c));
  const none = [undefined, undefined];
  const unchanged = [false, false];

  it('finds the conflict again with the constraints as they were approved', () => {
    const again = recheckItems(items, constraints, entities, tokens, SAMPLE_NOTE, noTold, none, unchanged);
    expect(again).toEqual(first(constraints));
    expect(again[0].verdict).toBe('conflict');
    expect(again[0].constraintId).toBe(lastBell.id);
  });

  it('finds no rule conflict once the constraint is off, and the conflict is back when it is on again', () => {
    const without = recheckItems(items, off, entities, tokens, SAMPLE_NOTE, noTold, none, unchanged);
    expect(without[0].verdict).toBe('not checked');
    expect(without[0].constraintId).toBeUndefined();
    const back = recheckItems(items, constraints, entities, tokens, SAMPLE_NOTE, noTold, none, unchanged);
    expect(back[0].verdict).toBe('conflict');
  });

  it('carries over what the on-device model said in the first check, and never makes it a conflict', () => {
    const doubt: ItemCheck = { verdict: 'unsure', reason: 'She may be too tired in the evening.', by: 'model' };
    const fits: ItemCheck = { verdict: 'fits', reason: 'All steps fit.' };
    const checked = first(constraints, [doubt, fits]);
    expect(checked[0].by).toBe('both');
    const model = checked.map(modelSaid);
    expect(model[0]).toEqual(doubt);
    expect(model[1]).toEqual({ ...fits, by: 'none' });
    const without = recheckItems(items, off, entities, tokens, SAMPLE_NOTE, noTold, model, unchanged);
    expect(without[0]).toMatchObject({ verdict: 'unsure', by: 'model', reason: doubt.reason });
    expect(without[1].verdict).toBe('fits');
  });

  it('does not guess what the model said about an item only a rule spoke on', () => {
    expect(modelSaid(first(constraints)[0])).toBeUndefined();
    expect(modelSaid(undefined)).toBeUndefined();
  });

  it('says so when no confirmed constraint applies to an item', () => {
    const bare = recheckItems(items, [], entities, tokens, SAMPLE_NOTE, noTold, none, unchanged);
    expect(bare[0]).toEqual({ verdict: 'not checked', reason: UNCOMPARED, by: 'none', rules: 0 });
  });
});

describe('a step rewritten by the teacher', () => {
  const before = first(constraints);

  it('offers the step the rule matched, with the names put back', () => {
    const { step, whole } = stepToRewrite(items[0], entities, tokens, before[0].matched);
    expect(whole).toBe(false);
    expect(step).toBe('Please encourage her to attend the after-school writing club this week.');
    expect(stepToRewrite(items[1], entities, tokens)).toEqual({ step: 'Read for ten minutes each morning.', whole: true });
  });

  it('replaces that step only, on the device, and writes a name back as its stand-in', () => {
    const { step } = stepToRewrite(items[0], entities, tokens, before[0].matched);
    const next = rewriteStep(items[0], step, '  Meenal can use the writing corner at lunch break. ', entities, tokens);
    expect(next.heading).toBe(items[0].heading);
    expect(next.text).toBe(
      `${meenal.token} reads aloud with confidence. ${meenal.token} can use the writing corner at lunch break. A few lines of writing at home each day would help too.`,
    );
  });

  it('is checked again by rule: clear when no rule fires, still a conflict when one does', () => {
    const { step } = stepToRewrite(items[0], entities, tokens, before[0].matched);
    const fixed = [rewriteStep(items[0], step, 'She can use the writing corner at lunch break.', entities, tokens), items[1]];
    const doubt: ItemCheck = { verdict: 'unsure', reason: 'An earlier doubt.', by: 'model' };
    const clear = recheckItems(fixed, constraints, entities, tokens, SAMPLE_NOTE, noTold, [doubt, undefined], [true, false]);
    // The model's answer was about the old text, so it is dropped for a rewritten item.
    expect(clear[0].verdict).toBe('not checked');
    expect(clear[0].reason).toBe(REWRITTEN_CLEAR);
    expect(clear[0].rules).toBeGreaterThan(0);

    const worse = [rewriteStep(items[0], step, 'Keep her after school on Tuesday instead.', entities, tokens), items[1]];
    const still = recheckItems(worse, constraints, entities, tokens, SAMPLE_NOTE, noTold, [undefined, undefined], [true, false]);
    expect(still[0].verdict).toBe('conflict');
    expect(still[0].matched?.toLowerCase()).toContain('after school');

    const bare = recheckItems(fixed, [], entities, tokens, SAMPLE_NOTE, noTold, [undefined, undefined], [true, false]);
    expect(bare[0].reason).toBe(REWRITTEN_UNCOMPARED);
  });

  it('leaves a name as typed when its stand-in was never sent', () => {
    expect(standInsFor('Meenal and Zoya read together.', entities, tokens)).toBe(`${meenal.token} and Zoya read together.`);
    expect(standInsFor('Meenal reads.', entities, [])).toBe('Meenal reads.');
  });
});

describe('which step of an item was rewritten', () => {
  it('counts from 0 among the steps as the teacher reads them', () => {
    expect(stepIndexOf(items[0], 'Please encourage her to attend the after-school writing club this week.', entities, tokens)).toBe(1);
    expect(stepIndexOf(items[0], 'Meenal reads aloud with confidence.', entities, tokens)).toBe(0);
    expect(stepIndexOf(items[1], 'Read for ten minutes each morning.', entities, tokens)).toBe(0);
    expect(stepIndexOf(items[0], 'Words that are not there.', entities, tokens)).toBe(0);
  });
});

describe('a rewritten message home that states the private reason', () => {
  // The vault as it stands at approval: the words of each confirmed constraint are withheld too.
  const locked = lockConstraints(entities, constraints);
  const going = outgoingOf(SAMPLE_NOTE, locked, constraints);
  const step = 'Please encourage her to attend the after-school writing club this week.';
  const after = (words: string) => {
    const next = rewriteStep(items[0], step, words, locked, going.tokens);
    return {
      gate: checkReply(`Messages home\n${next.heading}\n${next.text}`, locked, going.tokens, going.text),
      family: familyFor(next, SAMPLE_NOTE, locked, going.tokens, SAMPLE_CLASS_LIST),
    };
  };

  it('is flagged by the return gate when the reason has a sensitive word the approved text did not have', () => {
    const { gate } = after('Please give Meenal ten minutes of writing at lunch, because she has epilepsy.');
    expect(gate.map((v) => v.what)).toEqual(['epilepsy']);
    expect(gate[0].why).toBe('a sensitive word that was not in the text you approved');
  });

  it('is not flagged otherwise: neither the gate nor the family copy knows the words of a constraint', () => {
    // As things stand. The words of the confirmed constraint, copied out whole into the message, pass both checks:
    // the return gate does not look for a detail withheld at one place of the note, and the family copy looks
    // only for other students, people, places, contact details and identity numbers.
    const whole = after('Please give Meenal ten minutes of writing at lunch, because she has to leave school at the last bell to reach home before dark.');
    expect(whole.gate).toEqual([]);
    expect(whole.family.student).toBe(meenal);
    const reworded = after('Please give Meenal ten minutes of writing at lunch, as she walks a long way and must be back before nightfall.');
    expect(reworded.gate).toEqual([]);
    expect(reworded.family.student).toBe(meenal);
  });
});

describe('keep and strike after a new check', () => {
  const conflict: ItemCheck = { verdict: 'conflict', reason: 'r', by: 'rule', constraintId: 'a' };
  const clear: ItemCheck = { verdict: 'not checked', reason: 'r', by: 'none', rules: 2 };
  const query: ItemCheck = { verdict: 'unsure', reason: 'r', by: 'rule', constraintId: 'a' };

  it('strikes an item that is now in conflict, even one the teacher had kept', () => {
    expect(keptAfterRecheck([true, null, false], [clear, clear, clear], [conflict, conflict, conflict])).toEqual([false, false, false]);
  });

  it('opens an item again when the conflict that struck it is gone, and never keeps it for the teacher', () => {
    expect(keptAfterRecheck([false], [conflict], [clear])).toEqual([null]);
    expect(keptAfterRecheck([true], [conflict], [clear])).toEqual([true]);
  });

  it('opens a kept item the rules now query, and leaves the rest as they were', () => {
    expect(keptAfterRecheck([true, true, false, null], [clear, query, clear, clear], [query, query, clear, clear])).toEqual([null, true, false, null]);
  });
});
