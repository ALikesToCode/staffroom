import { describe, expect, it } from 'vitest';
import type { Constraint, Entity } from './types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE_BASE as SAMPLE_NOTE } from './samples';
import { buildVault, deterministicCandidates, possibleNameCandidates, redact } from './vault';
import { approvalKey } from './policy';
import { confirmConstraint, constraintCounts, proposeConstraints, setConstraintKind, setNeed, setShare, unconfirmConstraint } from './constraints';
import { checkNeed, classSentences, NEEDS_HEADING, needLine, needTemplate, notSentLine, outgoingOf, sharedNeeds, withNeeds } from './needs';
import { LESSON_NEEDS_HEADING } from './lessonNeeds';
import { ruleCheckItem } from './conflicts';

const entities0 = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
let held = { entities: entities0, constraints: proposeConstraints(SAMPLE_NOTE, entities0) };
for (const x of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, x.id);
const { entities, constraints } = held;
const student = (name: string) => entities.find((e) => e.kind === 'student' && e.surfaces.includes(name))!;
const of = (kind: string) => constraints.find((c) => c.kind === kind)!;
const made = (extra: Partial<Constraint>): Constraint => ({ id: 'n', kind: 'money', text: 'x', source: 'teacher', confirmed: true, about: student('Aarav').id, ...extra });

describe('the need line of a constraint', () => {
  it('is built from the kind, with the stand-in, and never from the words of the teacher', () => {
    const meenal = student('Meenal').token;
    const aarav = student('Aarav').token;
    expect(needTemplate(of('time-after'), entities)).toBe(`${meenal} cannot stay after the last bell.`);
    expect(needTemplate(of('time-before'), entities)).toBe(`${aarav} cannot come before the first bell.`);
    expect(needTemplate(made({ kind: 'days-away', days: ['Friday', 'Saturday'] }), entities)).toBe(`${aarav} is away on Fridays and Saturdays.`);
    expect(needTemplate(made({ kind: 'days-away', days: ['Monday'] }), entities)).toBe(`${aarav} is away on Mondays.`);
    expect(needTemplate(made({ kind: 'money', text: 'his father lost his job and cannot pay' }), entities)).toBe(`${aarav}'s family cannot pay for anything extra.`);
    expect(needTemplate(made({ kind: 'no-phone-internet' }), entities)).toBe(`${aarav} has no phone or internet at home.`);
    expect(needTemplate(of('contact'), entities)).toBe(`Write to ${student('Kabir').token}'s guardian, not to his parents.`);
    expect(needTemplate(made({ kind: 'contact', who: 'father', text: 'Her father must not be contacted' }), entities)).toBe(`Do not contact ${aarav}'s father.`);
    expect(needTemplate(made({ kind: 'contact', who: 'mother', away: true, text: 'mother died' }), entities)).toBe(`Do not contact ${aarav}'s mother.`);
    for (const c of constraints) expect(needTemplate(c, entities) ?? '', c.kind).not.toContain(c.text);
  });

  it('has no fixed line for health or other, for a constraint about no one student, or when the rule has nothing to say', () => {
    expect(needTemplate(of('health'), entities)).toBeUndefined();
    expect(needTemplate(made({ kind: 'other' }), entities)).toBeUndefined();
    expect(needTemplate(made({ about: undefined }), entities)).toBeUndefined();
    expect(needTemplate(made({ kind: 'days-away', days: [] }), entities)).toBeUndefined();
    expect(needTemplate(made({ kind: 'contact' }), entities)).toBeUndefined();
  });

  it('uses the name once the teacher has released it', () => {
    const released = entities.map((e) => (e.id === student('Meenal').id ? { ...e, withheld: false } : e));
    expect(needTemplate(of('time-after'), released)).toBe('Meenal Joshi cannot stay after the last bell.');
  });

  it('for health is what the teacher typed, with names replaced by their stand-ins', () => {
    const typed = setNeed(constraints, of('health').id, '  No flashing lights for Meenal.  ');
    const health = typed.find((c) => c.kind === 'health')!;
    expect(needLine(health, entities)).toBe(`No flashing lights for ${student('Meenal').token}.`);
    expect(needLine(of('health'), entities)).toBeUndefined();
    // A typed line is ignored for a kind that has a fixed line.
    expect(needLine({ ...of('time-after'), need: 'She walks home before dark' }, entities)).toBe(`${student('Meenal').token} cannot stay after the last bell.`);
  });
});

describe('the gate on a need line', () => {
  const whys = (line: string, list: Entity[] = entities) => checkNeed(line, list).map((v) => v.what);

  it('passes a line of plain words and stand-ins from the vault', () => {
    expect(checkNeed(`No flashing lights for ${student('Meenal').token}.`, entities)).toEqual([]);
    expect(checkNeed(`${student('Aarav').token}'s family cannot pay for anything extra.`, entities)).toEqual([]);
  });

  it('stops a withheld item, a name, a number, a made-up stand-in, the withheld marker and a word that gives the reason', () => {
    expect(whys('Do not ring Sunita.')).toContain('Sunita');
    expect(whys('Rampur Kalan is too far to walk after dark.')).toContain('Rampur Kalan');
    expect(whys('Ring 98765 43210 instead.')).toContain('98765 43210');
    expect(whys('Seat [Student 9] at the front.')).toEqual(['[Student 9]']);
    expect(whys('She [withheld] so no late club.')).toEqual(['[withheld]']);
    expect(whys('She has epilepsy, so no flashing lights.')).toEqual(['epilepsy']);
    // A name the vault does not hold looks like any other capitalised word, and is stopped as one.
    expect(whys('Ask Rohan to walk with her.')).toEqual(['Rohan']);
    // A constraint's own words, typed again.
    expect(whys('She has to leave school at the last bell to reach home before dark.').length).toBeGreaterThan(0);
  });
});

describe('needs in the outgoing text', () => {
  it('are told only for a confirmed constraint the teacher switched on', () => {
    expect(sharedNeeds(constraints, entities)).toEqual([]);
    expect(outgoingOf(SAMPLE_NOTE, entities, constraints).text).toBe(redact(SAMPLE_NOTE, entities));
    const on = setShare(constraints, of('time-after').id, true);
    expect(sharedNeeds(on, entities).map((n) => n.line)).toEqual([`${student('Meenal').token} cannot stay after the last bell.`]);
    // Unconfirming switches it off, and an unconfirmed constraint cannot be switched on.
    const off = unconfirmConstraint(on, of('time-after').id);
    expect(sharedNeeds(off, entities)).toEqual([]);
    expect(sharedNeeds(setShare(off, of('time-after').id, true), entities)).toEqual([]);
    // Changing the kind changes the line, so it is switched off until the teacher looks again.
    expect(setConstraintKind(on, of('time-after').id, 'money').find((c) => c.id === of('time-after').id)!.share).toBe(false);
  });

  it('stand under a fixed heading at the end of the exact text, which the approval covers', () => {
    let on = setShare(constraints, of('time-after').id, true);
    on = setShare(on, of('contact').id, true);
    const out = outgoingOf(SAMPLE_NOTE, entities, on);
    const plain = redact(SAMPLE_NOTE, entities);
    expect(out.text).toBe(
      `${plain}\n\n${NEEDS_HEADING}\n- ${student('Meenal').token} cannot stay after the last bell.\n- Write to ${student('Kabir').token}'s guardian, not to his parents.`,
    );
    expect(NEEDS_HEADING).toBe('Needs the teacher has approved (no reasons given):');
    expect(out.violations).toEqual([]);
    expect(out.noteAsWritten).toBe(false);
    expect(out.text).not.toMatch(/before dark|grandmother|separating/);
    expect(approvalKey(out.text, [], 'm')).not.toBe(approvalKey(plain, [], 'm'));
    expect(withNeeds('x', [])).toBe('x');
    expect(withNeeds('x', ['a.', 'a.'])).toBe(`x\n\n${NEEDS_HEADING}\n- a.`);
  });

  it('are stopped at the gate, with the reason, when a typed line holds what must not go', () => {
    let on = setNeed(constraints, of('health').id, 'No flashing lights, because of her epilepsy');
    on = setShare(on, of('health').id, true);
    const out = outgoingOf(SAMPLE_NOTE, entities, on);
    expect(out.violations).toEqual([{ what: 'epilepsy', why: 'a word that gives the reason, in a need line: a need is told without its reason' }]);
    const fine = setNeed(on, of('health').id, 'No flashing lights for Meenal');
    const ok = outgoingOf(SAMPLE_NOTE, entities, fine);
    expect(ok.violations).toEqual([]);
    expect(ok.text.endsWith(`- No flashing lights for ${student('Meenal').token}`)).toBe(true);
    // A health constraint with nothing typed has nothing to tell.
    expect(outgoingOf(SAMPLE_NOTE, entities, setShare(constraints, of('health').id, true)).needs).toEqual([]);
  });

  it('list every stand-in they use among the ones that may come back', () => {
    const only = buildVault('Asha reads well.\n\nBina is ahead.', [
      { kind: 'student', text: 'Asha', source: 'class list' },
      { kind: 'student', text: 'Bina', source: 'class list' },
    ]);
    const typed: Constraint = { id: 't', kind: 'other', text: 'x', source: 'teacher', confirmed: true, share: true, need: 'Seat Bina away from the window' };
    const out = outgoingOf('Asha reads well.', only, [typed]);
    expect(out.text).toBe(`[Student 1] reads well.\n\n${NEEDS_HEADING}\n- Seat [Student 2] away from the window`);
    expect(out.tokens).toEqual(['[Student 1]', '[Student 2]']);
  });
});

describe('the check against a need the cloud was told', () => {
  const on = setShare(constraints, of('time-after').id, true);
  const tokens = outgoingOf(SAMPLE_NOTE, entities, on).tokens;
  const told = new Map(sharedNeeds(on, entities).map((n) => [n.id, n.line]));
  const item = { heading: student('Meenal').token, text: 'Keep her after the last bell for writing practice.' };

  it('still compares the step with the constraint, and says the cloud was told', () => {
    const r = ruleCheckItem(item, on, entities, tokens, SAMPLE_NOTE, told);
    expect(r.hit).toMatchObject({ verdict: 'conflict', told: `${student('Meenal').token} cannot stay after the last bell.` });
    expect(r.hit!.reason).toBe(
      'This step keeps Meenal after the last bell. You confirmed: “has to leave school at the last bell to reach home before dark”. The cloud was told this need and the step still goes against it.',
    );
  });

  it('says the cloud was not told, for a constraint that was not shared', () => {
    const r = ruleCheckItem({ heading: student('Aarav').token, text: 'Meet him before school.' }, on, entities, tokens, SAMPLE_NOTE, told);
    expect(r.hit!.reason).toMatch(/The cloud was not told this\.$/);
    expect(r.hit!.told).toBeUndefined();
  });

  it('counts the needs that were told', () => {
    expect(constraintCounts(on)).toMatchObject({ confirmed: 5 });
    expect(sharedNeeds(on, entities)).toHaveLength(1);
  });
});

describe('a lesson request', () => {
  const note = 'The class is behind on fractions. Asha reads well. The class visits Rampur on Friday.\n\nBina is ahead; she could help.\nThe hall is shut this week.';
  const vault = buildVault(note, [
    { kind: 'student', text: 'Asha', source: 'class list' },
    { kind: 'student', text: 'Bina', source: 'class list' },
    { kind: 'place', text: 'Rampur', source: 'rule' },
  ]);
  const learning = (id: string, about: string): Constraint => ({ id, kind: 'learning', learn: 'early', text: 'x', source: 'teacher', confirmed: true, share: true, about, need: 'finishes early and needs more to do' });

  it('sends only the sentences about the class, keeping its lines and paragraphs, and the needs by letter', () => {
    const out = outgoingOf(note, vault, [learning('l', vault[1].id)], true);
    expect(out.text).toBe(
      `The class is behind on fractions. The class visits [Place 1] on Friday.\n\nThe hall is shut this week.\n\n${LESSON_NEEDS_HEADING}\nNeed G: finishes early and needs more to do\nUnder "For each need", give an entry for every one of these letters: G.`,
    );
    expect(out.notSent).toBe(2);
    // Only a stand-in still in the text may come back.
    expect(out.tokens).toEqual(['[Place 1]']);
    expect(out.noteAsWritten).toBe(false);
    expect(out.violations).toEqual([]);
    expect(notSentLine(out.notSent!)).toBe('Not sent: 2 sentences about one pupil. Their needs go by letter.');
    expect(notSentLine(1)).toBe('Not sent: 1 sentence about one pupil. Their needs go by letter.');
    // The other tasks still send the whole redacted note.
    expect(outgoingOf(note, vault, []).text).toContain('[Student 1] reads well.');
    expect(outgoingOf(note, vault, []).notSent).toBeUndefined();
  });

  it('leaves out a sentence that says he or she, names a pupil the teacher released, or is nothing but withheld items', () => {
    const released = vault.map((e) => (e.surfaces[0] === 'Asha' ? { ...e, withheld: false } : e));
    expect(classSentences('Asha reads well. Her mother rang. [withheld]. The class sings.', released)).toEqual({ text: 'The class sings.', notSent: 3 });
    expect(classSentences('Then he left. The room is cold!', vault)).toEqual({ text: 'The room is cold!', notSent: 1 });
    // A word that only holds "he" is no pronoun.
    expect(classSentences('The theme is the harvest.', vault)).toEqual({ text: 'The theme is the harvest.', notSent: 0 });
  });

  it('with nothing about the class, sends the needs alone', () => {
    const out = outgoingOf('Asha reads well.', vault, [learning('l', vault[0].id)], true);
    expect(out.text.startsWith(LESSON_NEEDS_HEADING)).toBe(true);
    expect(out.tokens).toEqual([]);
  });

  it('still stops what the exit gate stops, in the sentences that are sent and in the need lines', () => {
    const out = outgoingOf('Ring the office on 98765 43210 before the trip.', [], [], true);
    expect(out.violations.map((v) => v.what)).toEqual(['98765 43210']);
    const typed = outgoingOf(note, vault, [{ ...learning('l', vault[0].id), need: 'has epilepsy' }], true);
    expect(typed.violations.map((v) => v.what)).toEqual(['epilepsy']);
  });
});
