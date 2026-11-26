import { describe, expect, it } from 'vitest';
import { askForConstraints, mergeProposals, readConstraintAnswer, studentParagraphs } from '../ai/constraints';
import type { Constraint, Entity } from './types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE_BASE as SAMPLE_NOTE } from './samples';
import { buildVault, deterministicCandidates, possibleNameCandidates, redact } from './vault';
import { checkOutgoing } from './gate';
import {
  addConstraint,
  confirmConstraint,
  constraintCounts,
  daysIn,
  lockConstraints,
  proposeConstraints,
  removeConstraint,
  restoreConstraints,
  setConstraintKind,
  setTriggers,
  unconfirmConstraint,
  withConstraintFacts,
} from './constraints';
import { outgoingOf, sharedNeeds } from './needs';

/** The vault a note gets with no model: class list, patterns, sensitive words, capitalised words. */
export function rulesVault(note: string, classList: string[]): Entity[] {
  return buildVault(note, [...deterministicCandidates(note, classList), ...possibleNameCandidates(note, classList)]);
}

const one = (note: string, classList: string[] = []) => {
  const entities = rulesVault(note, classList);
  return { entities, found: proposeConstraints(note, entities) };
};

const brief = (c: Constraint, entities: Entity[]) => [c.kind, entities.find((e) => e.id === c.about)?.surfaces[0] ?? 'class', c.text];

describe('constraints proposed by rule', () => {
  it('finds each kind in plain sentences, as the words of the note', () => {
    const list = ['Asha', 'Bina', 'Chetan', 'Dev', 'Esha', 'Firoz', 'Gita', 'Hari'];
    const note = [
      'Asha must leave at the last bell to catch the only bus.',
      'Bina cannot stay back after school.',
      'Chetan delivers newspapers before school.',
      'Dev is away on Fridays and Saturdays.',
      'Esha lives far away. Her family cannot afford anything beyond the fees.',
      'Firoz has no phone at home.',
      'Gita is quiet. Her father must not be contacted by the school.',
      'Hari has asthma.',
    ].join('\n\n');
    const { entities, found } = one(note, list);
    expect(found.map((c) => brief(c, entities))).toEqual([
      ['time-after', 'Asha', 'must leave at the last bell to catch the only bus'],
      ['time-after', 'Bina', 'cannot stay back after school'],
      ['time-before', 'Chetan', 'delivers newspapers before school'],
      ['days-away', 'Dev', 'is away on Fridays and Saturdays'],
      ['money', 'Esha', 'cannot afford anything beyond the fees'],
      ['no-phone-internet', 'Firoz', 'has no phone at home'],
      ['contact', 'Gita', 'Her father must not be contacted by the school'],
      ['health', 'Hari', 'has asthma'],
    ]);
    expect(found.every((c) => c.source === 'rule' && c.confirmed === false)).toBe(true);
    expect(found.every((c) => note.slice(c.at!, c.at! + c.text.length) === c.text)).toBe(true);
    expect(found[3].days).toEqual(['Friday', 'Saturday']);
    expect(found[6]).toMatchObject({ who: 'father' });
    expect(found[6].away).toBeUndefined();
    expect(found[7].triggers).toContain('dust');
  });

  it('reads who is not there to contact, and who looks after the child', () => {
    const { found } = one('Farhan has been quiet. His mother died in March and he lives with his grandmother.', ['Farhan']);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'contact', who: 'parents', guardian: 'grandmother', away: true, text: 'lives with his grandmother' });
    expect(one('Her father passed away last year.').found[0]).toMatchObject({ kind: 'contact', who: 'father', away: true });
    expect(one('Do not phone his mother at work.').found[0]).toMatchObject({ kind: 'contact', who: 'mother' });
  });

  it('reads an allergy and what it is to', () => {
    expect(one('Ila has a nut allergy.', ['Ila']).found[0]).toMatchObject({ kind: 'health', triggers: ['nut', 'peanut'] });
    expect(one('Ila is allergic to eggs and milk.', ['Ila']).found[0].triggers).toEqual(['egg', 'milk']);
    expect(one('Jai has epilepsy and has had a seizure at school.', ['Jai']).found).toHaveLength(1);
  });

  it('names the weekdays once each, in the order of the week', () => {
    expect(daysIn('away on Saturdays, Fridays and friday')).toEqual(['Friday', 'Saturday']);
    expect(daysIn('on a sunny day')).toEqual([]);
  });

  it('proposes nothing from a sentence that states no limit', () => {
    const { found } = one('Tanvi is far ahead in reading. She could help others, but she is shy. Her father lost his job at the mill.', ['Tanvi']);
    expect(found).toEqual([]);
  });

  it('leaves a constraint about the class when it is not plain whose it is', () => {
    const { found } = one('Asha and Bina sit together. She cannot stay back after school.', ['Asha', 'Bina']);
    expect(found[0].about).toBeUndefined();
  });

  it('finds the constraints of the sample note', () => {
    const entities = rulesVault(SAMPLE_NOTE, SAMPLE_CLASS_LIST);
    const found = proposeConstraints(SAMPLE_NOTE, entities);
    expect(found.map((c) => brief(c, entities))).toEqual([
      ['money', 'Aarav Sharma', 'cannot pay for anything extra this term'],
      ['time-before', 'Aarav Sharma', 'now helps at the family tea stall before school'],
      ['health', 'Meenal Joshi', 'has epilepsy'],
      ['time-after', 'Meenal Joshi', 'has to leave school at the last bell to reach home before dark'],
      ['contact', 'Kabir Qureshi', 'staying with his grandmother'],
    ]);
    expect(found.find((c) => c.kind === 'contact')).toMatchObject({ who: 'parents', guardian: 'grandmother', away: true });
    // After "Use the sample class" and the guard: proposed, and nothing confirmed or told until the teacher does it.
    expect(found.every((c) => !c.confirmed && !c.share)).toBe(true);
    expect(sharedNeeds(found, entities)).toEqual([]);
    expect(outgoingOf(SAMPLE_NOTE, entities, found).text).toBe(redact(SAMPLE_NOTE, entities));
  });

  it('withholds the walk home once the sample constraints are confirmed, and leaves the club in the text', () => {
    const entities = rulesVault(SAMPLE_NOTE, SAMPLE_CLASS_LIST);
    // With rules only and nothing confirmed, the cloud is shown the sentence and can plan around it.
    expect(redact(SAMPLE_NOTE, entities)).toContain('last bell to reach home');
    let held = { entities, constraints: proposeConstraints(SAMPLE_NOTE, entities) };
    for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
    const out = outgoingOf(SAMPLE_NOTE, lockConstraints(held.entities, held.constraints), held.constraints);
    expect(out.violations).toEqual([]);
    expect(out.text).not.toContain('last bell to reach home');
    expect(out.text).toContain('the remedial writing club meets after the last bell');
    for (const c of held.constraints) expect(out.text, c.kind).not.toContain(c.text);
  });
});

describe('a confirmed constraint', () => {
  const entities = rulesVault(SAMPLE_NOTE, SAMPLE_CLASS_LIST);
  const proposed = proposeConstraints(SAMPLE_NOTE, entities);
  const idOf = (kind: string) => proposed.find((c) => c.kind === kind)!.id;

  it('is not withheld until it is confirmed', () => {
    expect(redact(SAMPLE_NOTE, entities)).toContain('has to leave school at the last bell to reach home before dark');
  });

  it('has its words withheld as a private detail of their own', () => {
    const held = confirmConstraint(SAMPLE_NOTE, entities, proposed, idOf('time-after'));
    const c = held.constraints.find((x) => x.kind === 'time-after')!;
    expect(c.confirmed).toBe(true);
    const detail = held.entities.find((e) => e.id === c.detailId)!;
    expect(detail).toMatchObject({ kind: 'private', withheld: true, surfaces: ['has to leave school at the last bell to reach home before dark'] });
    expect(detail.about).toBe(c.about);
    const out = redact(SAMPLE_NOTE, held.entities);
    expect(out).toContain('She walks six kilometres home to [Place 1] and [withheld].');
    expect(out).not.toContain('last bell to reach home');
    expect(checkOutgoing(out, held.entities, SAMPLE_NOTE)).toEqual([]);
    // The vault it was made from is not changed.
    expect(entities.some((e) => e.id === detail.id)).toBe(false);
  });

  it('uses the item that already holds its words back', () => {
    const held = confirmConstraint(SAMPLE_NOTE, entities, proposed, idOf('health'));
    const c = held.constraints.find((x) => x.kind === 'health')!;
    expect(held.entities).toHaveLength(entities.length);
    expect(held.entities.find((e) => e.id === c.detailId)!.surfaces[0]).toBe(
      'She told me she has epilepsy and is afraid of having a seizure in the exam hall',
    );
  });

  it('keeps its item withheld whatever the switch says, until it is unconfirmed', () => {
    const held = confirmConstraint(SAMPLE_NOTE, entities, proposed, idOf('time-after'));
    const c = held.constraints.find((x) => x.kind === 'time-after')!;
    const released = held.entities.map((e) => (e.id === c.detailId ? { ...e, withheld: false } : e));
    expect(redact(SAMPLE_NOTE, released)).toContain('last bell to reach home');
    expect(redact(SAMPLE_NOTE, lockConstraints(released, held.constraints))).not.toContain('last bell to reach home');
    const undone = unconfirmConstraint(held.constraints, c.id);
    expect(undone.find((x) => x.id === c.id)!.confirmed).toBe(false);
    expect(redact(SAMPLE_NOTE, lockConstraints(released, undone))).toContain('last bell to reach home');
    // Unconfirming alone releases nothing.
    expect(redact(SAMPLE_NOTE, lockConstraints(held.entities, undone))).not.toContain('last bell to reach home');
  });

  it('makes a new item when the one around its words was released', () => {
    const sentence = entities.find((e) => e.surfaces[0].startsWith('She told me she has epilepsy'))!;
    const released = entities.map((e) => (e.id === sentence.id ? { ...e, withheld: false } : e));
    const held = confirmConstraint(SAMPLE_NOTE, released, proposed, idOf('health'));
    const out = redact(SAMPLE_NOTE, held.entities);
    expect(out).toContain('She told me she [withheld] and is afraid of having a');
    expect(held.constraints.find((x) => x.kind === 'health')!.detailId).not.toBe(sentence.id);
  });

  it('can be removed, have its kind changed and its trigger words set', () => {
    expect(removeConstraint(proposed, idOf('health')).some((c) => c.kind === 'health')).toBe(false);
    const changed = setConstraintKind(proposed, idOf('health'), 'other').find((c) => c.id === idOf('health'))!;
    expect(changed.kind).toBe('other');
    expect(changed.triggers).toBeUndefined();
    const back = setConstraintKind([changed], changed.id, 'health')[0];
    expect(back.triggers).toContain('flashing lights');
    expect(setTriggers([back], back.id, ' Strobe , screens,,strobe ')[0].triggers).toEqual(['strobe', 'screens']);
  });

  it('is counted by kind, and nothing else of it is counted', () => {
    let held = confirmConstraint(SAMPLE_NOTE, entities, proposed, idOf('time-after'));
    held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, idOf('health'));
    expect(constraintCounts(held.constraints)).toEqual({ confirmed: 2, byKind: { 'time-after': 1, health: 1 } });
    expect(JSON.stringify(constraintCounts(held.constraints))).not.toMatch(/bell|epilepsy|Meenal/);
  });
});

describe('a constraint added by hand', () => {
  const note = 'Asha reads well. She looks after her brothers until six every evening.';
  const entities = rulesVault(note, ['Asha']);
  const asha = entities.find((e) => e.kind === 'student')!;

  it('is confirmed at once and withholds its words when they stand in the note', () => {
    const at = note.indexOf('looks after');
    const held = addConstraint(note, entities, [], { kind: 'time-after', about: asha.id, text: 'looks after her brothers until six every evening', at });
    expect(held.constraints).toHaveLength(1);
    expect(held.constraints[0]).toMatchObject({ id: 'teacher-1', source: 'teacher', confirmed: true, about: asha.id, aboutName: 'Asha', at });
    expect(redact(note, held.entities)).toBe('[Student 1] reads well. She [withheld].');
    expect(checkOutgoing(redact(note, held.entities), held.entities, note)).toEqual([]);
  });

  it('needs no words in the note: what the teacher typed is in no outgoing text', () => {
    const held = addConstraint(note, entities, [], { kind: 'money', about: asha.id, text: 'The family cannot pay for trips' });
    expect(held.entities).toBe(entities);
    expect(held.constraints[0]).toMatchObject({ confirmed: true, kind: 'money' });
    expect(held.constraints[0].detailId).toBeUndefined();
    // The check is still given it as a fact about her.
    const facts = withConstraintFacts(entities, held.constraints);
    expect(facts[facts.length - 1]).toMatchObject({ kind: 'private', withheld: true, about: asha.id, surfaces: ['The family cannot pay for trips'] });
    expect(withConstraintFacts(entities, [])).toBe(entities);
  });

  it('can be about the class, and empty words add nothing', () => {
    expect(addConstraint(note, entities, [], { kind: 'other', text: 'No one may leave the room during the test' }).constraints[0].about).toBeUndefined();
    expect(addConstraint(note, entities, [], { kind: 'other', text: '   ' }).constraints).toEqual([]);
  });
});

describe('constraints kept while the guard runs again', () => {
  it('are tied again to the student by name and to the item that holds their words', () => {
    const entities = rulesVault(SAMPLE_NOTE, SAMPLE_CLASS_LIST);
    const proposed = proposeConstraints(SAMPLE_NOTE, entities);
    let held = confirmConstraint(SAMPLE_NOTE, entities, proposed, proposed.find((c) => c.kind === 'time-after')!.id);
    const meenal = entities.find((e) => e.surfaces.includes('Meenal'))!;
    held = addConstraint(SAMPLE_NOTE, held.entities, held.constraints, { kind: 'money', about: meenal.id, text: 'Cannot pay for the school trip' });
    // The guard runs again: a vault in another order, and fresh proposals.
    const again = rulesVault(SAMPLE_NOTE, [...SAMPLE_CLASS_LIST].reverse());
    const back = restoreConstraints(SAMPLE_NOTE, again, held.constraints, proposeConstraints(SAMPLE_NOTE, again));
    const meenalNow = again.find((e) => e.surfaces.includes('Meenal'))!;
    expect(meenalNow.id).not.toBe(meenal.id);
    expect(back.constraints.map((c) => [c.kind, c.confirmed, c.source])).toEqual([
      ['money', false, 'rule'],
      ['time-before', false, 'rule'],
      ['health', false, 'rule'],
      ['time-after', true, 'rule'],
      ['contact', false, 'rule'],
      ['money', true, 'teacher'],
    ]);
    expect(back.constraints.filter((c) => c.confirmed).every((c) => c.about === meenalNow.id)).toBe(true);
    expect(redact(SAMPLE_NOTE, back.entities)).not.toContain('last bell to reach home');
  });
});

describe('constraints proposed by the on-device model', () => {
  const note = 'Class notes.\n\nAsha reads well. She minds the shop until seven each evening. Her aunt must not be rung.\n\nBina is ahead in maths.';
  const entities = rulesVault(note, ['Asha', 'Bina']);
  const para = studentParagraphs(note, entities)[0];
  const answer = (list: unknown[]) => JSON.stringify({ constraints: list });

  it('asks only about paragraphs that name a student', () => {
    expect(studentParagraphs(note, entities)).toEqual([para, 'Bina is ahead in maths.']);
    expect(para.startsWith('Asha reads well')).toBe(true);
  });

  it('keeps a proposal only when its quote stands in the paragraph, word for word', () => {
    const reading = readConstraintAnswer(
      note,
      para,
      answer([
        { student: 'Asha', kind: 'time-after', quote: 'minds the shop until seven each evening' },
        { student: 'Asha', kind: 'time-after', quote: 'minds the shop until 7 pm' },
        { student: 'Asha', kind: 'curfew', quote: 'Asha reads well' },
        { student: 'Bina', kind: 'money', quote: 'Bina is ahead in maths' },
        { student: 'Asha', kind: 'contact', quote: 'Her aunt must not be rung' },
      ]),
      entities,
    )!;
    expect(reading.dropped).toBe(3);
    expect(reading.constraints.map((c) => [c.kind, c.text, c.source, c.confirmed])).toEqual([
      ['time-after', 'minds the shop until seven each evening', 'on-device model', false],
      ['contact', 'Her aunt must not be rung', 'on-device model', false],
    ]);
    const asha = entities.find((e) => e.surfaces.includes('Asha'))!;
    expect(reading.constraints.every((c) => c.about === asha.id && note.slice(c.at!, c.at! + c.text.length) === c.text)).toBe(true);
    expect(reading.constraints[1].who).toBe('aunt');
  });

  it('does not take the model at its word about whose a fact is', () => {
    const reading = readConstraintAnswer(note, para, answer([{ student: 'Bina', kind: 'time-after', quote: 'minds the shop until seven each evening' }]), entities)!;
    expect(reading.constraints[0].about).toBeUndefined();
  });

  it('cannot read an answer that is not in the form asked for', () => {
    expect(readConstraintAnswer(note, para, 'not json', entities)).toBeUndefined();
    expect(readConstraintAnswer(note, para, '{"constraints":"none"}', entities)).toBeUndefined();
    expect(readConstraintAnswer(note, para, '{"constraints":[]}', entities)).toEqual({ constraints: [], dropped: 0 });
  });

  it('is merged with the rules: the same words are kept once, as found by rule and model', () => {
    const sample = rulesVault(SAMPLE_NOTE, SAMPLE_CLASS_LIST);
    const byRule = proposeConstraints(SAMPLE_NOTE, sample);
    const meenal = SAMPLE_NOTE.slice(SAMPLE_NOTE.indexOf('Meenal reads'), SAMPLE_NOTE.indexOf('\n\nKabir'));
    const byModel = readConstraintAnswer(
      SAMPLE_NOTE,
      meenal,
      answer([
        { student: 'Meenal', kind: 'time-after', quote: 'has to leave school at the last bell' },
        { student: 'Meenal', kind: 'other', quote: 'freezes in written tests' },
      ]),
      sample,
    )!.constraints;
    const merged = mergeProposals(byRule, byModel);
    expect(merged.map((c) => [c.kind, c.source, c.alsoModel ?? false, c.text])).toEqual([
      ['money', 'rule', false, 'cannot pay for anything extra this term'],
      ['time-before', 'rule', false, 'now helps at the family tea stall before school'],
      ['other', 'on-device model', false, 'freezes in written tests'],
      ['health', 'rule', false, 'has epilepsy'],
      ['time-after', 'rule', true, 'has to leave school at the last bell to reach home before dark'],
      ['contact', 'rule', false, 'staying with his grandmother'],
    ]);
    // The rules' own list is not changed.
    expect(byRule.some((c) => c.alsoModel)).toBe(false);
  });

  it('goes on when a request fails, and reports it', async () => {
    let n = 0;
    const report = await askForConstraints(note, entities, async () => {
      if (n++ === 0) throw new Error('model busy');
      return { text: 'broken', onDevice: true };
    });
    expect(report).toEqual({ constraints: [], asked: 2, unread: 2, dropped: 0 });
  });

  it('stops at an answer that did not come from the device, and uses nothing of it', async () => {
    const asked: string[] = [];
    const report = await askForConstraints(note, entities, async (p) => {
      asked.push(p);
      return { text: answer([{ student: 'Asha', kind: 'other', quote: 'Asha reads well' }]), onDevice: false };
    });
    expect(asked).toHaveLength(1);
    expect(report.constraints).toEqual([]);
    expect(report.stopped).toMatch(/did not run on the device/);
    expect(report.unread).toBe(2);
  });
});
