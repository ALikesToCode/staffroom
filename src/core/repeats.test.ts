import { describe, expect, it } from 'vitest';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from './samples';
import { buildVault, deterministicCandidates, possibleNameCandidates } from './vault';
import { confirmConstraint, lockConstraints, proposeConstraints } from './constraints';
import { outgoingOf } from './needs';
import { rewriteStep } from './recheck';
import { COPY_OFF_REPEATS, familyAfterRewrite, familyFor } from './family';
import { contentWords, REPEATS_NOTE, repeatsPrivate } from './repeats';

const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
let held = { entities: vault, constraints: proposeConstraints(SAMPLE_NOTE, vault) };
for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
const constraints = held.constraints;
const entities = lockConstraints(held.entities, constraints);
const { tokens } = outgoingOf(SAMPLE_NOTE, entities, constraints);
const tok = (name: string) => entities.find((e) => e.kind === 'student' && e.surfaces.includes(name))!.token;
const step = 'Please encourage her to attend the after-school writing club this week.';
const item = { heading: `A note home for ${tok('Meenal')}`, text: `${tok('Meenal')} reads aloud with confidence. ${step}` };
const rewritten = (words: string) => rewriteStep(item, step, words, entities, tokens);
const repeats = (words: string, list = constraints) => repeatsPrivate(rewritten(words), entities, list, tokens);

describe('a rewrite that repeats words of the private note', () => {
  it('is found by a run of three content words of a confirmed constraint, small words between them aside', () => {
    expect(repeats('Please give Meenal ten minutes of writing at lunch, because she has to leave school at the last bell to reach home before dark.')).toEqual(['leave school last']);
    expect(repeats('She must reach home before it is dark, so give her the task at lunch.')).toEqual(['reach home dark']);
    expect(contentWords('has to leave school at the last bell')).toEqual(['leave', 'school', 'last', 'bell']);
  });

  it('is found by a sensitive word that one of her private details has', () => {
    expect(repeats('Please give Meenal ten minutes of writing at lunch, because she has epilepsy.')).toEqual(['epilepsy']);
  });

  it('is found in a withheld private detail that is no constraint', () => {
    const none = constraints.map((c) => ({ ...c, confirmed: false }));
    expect(repeats('Give her the task at lunch: she is afraid of having a seizure in the exam hall.', none)).toContain('afraid having seizure');
  });

  it('is not found in an ordinary rewrite, in two shared words, or in the same thing said in other words', () => {
    expect(repeats('Please give Meenal ten minutes of writing at lunch.')).toEqual([]);
    expect(repeats('She can leave school with her friends after the writing task at lunch.')).toEqual([]);
    // A paraphrase is not detected. The line on the item is not shown for it.
    expect(repeats('Please give Meenal ten minutes of writing at lunch, as she walks a long way and must be back before nightfall.')).toEqual([]);
  });

  it('reads only the facts of the student the item names, and every fact when it names nobody', () => {
    const words = 'the family cannot pay for anything extra this term';
    expect(repeats(`Lend her the book, since ${words}.`)).toEqual([]);
    const forAarav = { heading: `A note home for ${tok('Aarav')}`, text: `Lend ${tok('Aarav')} the book, since ${words}.` };
    expect(repeatsPrivate(forAarav, entities, constraints, tokens)).toContain('family pay anything');
    expect(repeatsPrivate({ heading: 'Books', text: `Lend the book, since ${words}.` }, entities, constraints, tokens)).toContain('family pay anything');
  });

  it('says so in one plain line that does not claim more', () => {
    expect(REPEATS_NOTE).toBe('This rewrite repeats words from your private note. Read it before you copy or print it.');
  });
});

describe('the family copy of a rewritten message', () => {
  const said = rewritten('Please give Meenal ten minutes of writing at lunch, because she has to leave school at the last bell to reach home before dark.');
  const family = familyFor(said, SAMPLE_NOTE, entities, tokens, SAMPLE_CLASS_LIST);

  it('starts off when the rewrite repeats words of the private note, and the teacher may turn it on', () => {
    expect(family.student).toBeDefined();
    expect(familyAfterRewrite(family, true, false)).toEqual({ why: COPY_OFF_REPEATS, mayTurnOn: true });
    expect(familyAfterRewrite(family, true, true)).toBe(family);
    expect(familyAfterRewrite(family, false, false)).toBe(family);
  });

  it('stays off, with nothing to turn on, when copy is off for another reason', () => {
    const two = familyFor({ heading: 'x', text: `${tok('Meenal')} and ${tok('Aarav')} read together.` }, SAMPLE_NOTE, entities, tokens, SAMPLE_CLASS_LIST);
    expect(two.student).toBeUndefined();
    expect(familyAfterRewrite(two, true, true)).toBe(two);
    expect(familyAfterRewrite(two, true, false)).not.toHaveProperty('mayTurnOn');
  });
});
