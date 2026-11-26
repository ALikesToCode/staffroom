import { describe, expect, it } from 'vitest';
import type { Constraint, ConstraintKind, ItemCheck } from './types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE_BASE as SAMPLE_NOTE } from './samples';
import { buildVault, deterministicCandidates, possibleNameCandidates, redactRange, redactWithTokens } from './vault';
import { confirmConstraint, proposeConstraints } from './constraints';
import { afterBellActivities, cloudSawAround, combineChecks, layerCounts, negated, ruleCheckItem, ruleConflicts, ruleOnlyReason, verdictLabel } from './conflicts';
import { keepNoConflict, NOT_ANSWERED, NOTHING_WITHHELD, startsKept } from '../ai/check';
import { makeReceipt, plainTitle, receiptRecord } from './receipts';
import { constraintCounts } from './constraints';

const c = (kind: ConstraintKind, extra: Partial<Constraint> = {}): Constraint => ({
  id: 'c1',
  kind,
  text: 'the words the teacher confirmed',
  source: 'rule',
  confirmed: true,
  ...extra,
});

const verdict = (step: string, constraint: Constraint, afterBell: string[] = []) => ruleConflicts(step, constraint, { name: 'Meenal', afterBell })?.verdict ?? 'none';

describe('the rule layer, kind by kind', () => {
  it('time-after: a step after school or after the last bell', () => {
    const k = c('time-after');
    for (const step of [
      'Send her to the club after the last bell.',
      'Keep her after school for ten minutes.',
      'Ask her to stay back and finish the page.',
      'Hold an after-school catch-up.',
      'Give her a detention.',
      'Go through it with her after class.',
    ]) expect(verdict(step, k), step).toBe('conflict');
    for (const step of [
      'Ring home in the evening.',
      'Go through it with her after the lesson.',
      'Stop when the school bell rings.',
      'Seat her near the door.',
      'Ask her after she has read the page.',
      'Give her extra time in the written test.',
    ]) expect(verdict(step, k), step).toBe('none');
  });

  it('time-after: an evening counts only with a school-side word in the same clause', () => {
    const k = c('time-after');
    for (const step of [
      'Ask her to stay for the evening study hour until half past six.',
      'Enrol her in the evening class.',
      'Send her to the evening club on Tuesdays.',
      'Offer an evening session with the reading teacher.',
      'Arrange evening tuition for her.',
      'Put her down for evening practice at school.',
      'She can finish it at school in the evenings.',
    ]) expect(verdict(step, k), step).toBe('conflict');
    for (const step of [
      'Ask her to write a few sentences about her day every evening.',
      'Her mother can read with her in the evenings.',
      'Ask her to write a few sentences every evening, and praise her in class the next day.',
      'An evening session of reading at home with her brother.',
      'She does not need to stay for the evening.',
    ]) expect(verdict(step, k), step).toBe('none');
    expect(ruleConflicts('Put her down for evening practice at school.', k, { name: 'Meenal' })).toMatchObject({ matched: 'evening' });
  });

  it('time-after and time-before: a step done at home or from home is no conflict', () => {
    for (const step of [
      'Ask her to read for ten minutes at home after school.',
      'She can send the page from home after the last bell.',
      'After school at home, she copies five words.',
      'Ask her to practise the remedial writing club exercises at home.',
    ]) expect(verdict(step, c('time-after'), ['remedial writing club']), step).toBe('none');
    for (const step of [
      'Ask him to read the page at home before school.',
      'He can look over the list from home in the early morning.',
    ]) expect(verdict(step, c('time-before')), step).toBe('none');
    // "At home" in another clause does not reach the words.
    expect(verdict('Give her the sheet to finish at home, and keep her after school on Friday.', c('time-after'))).toBe('conflict');
    expect(verdict('He reads at home; meet him before school to hear him.', c('time-before'))).toBe('conflict');
    expect(verdict('Keep her after school for ten minutes.', c('time-after'))).toBe('conflict');
    expect(verdict('Meet him before school.', c('time-before'))).toBe('conflict');
  });

  it('time-after: an activity the note itself says meets after the last bell', () => {
    expect(afterBellActivities(SAMPLE_NOTE)).toEqual(['remedial writing club']);
    expect(afterBellActivities('Chess club meets after school. Choir and the debating society are held after classes.')).toEqual(['chess club', 'debating society']);
    const k = c('time-after');
    expect(verdict('Enrol her in the remedial writing club.', k)).toBe('none');
    expect(verdict('Enrol her in the remedial writing club.', k, ['remedial writing club'])).toBe('conflict');
    expect(verdict('Enrol her in the Writing Club this week.', k, ['remedial writing club'])).toBe('conflict');
    expect(verdict('Give her remedial writing tasks in class.', k, ['remedial writing club'])).toBe('none');
    expect(ruleConflicts('Enrol her in the remedial writing club.', k, { name: 'Meenal', afterBell: ['remedial writing club'] })!.reason).toBe(
      'This step sends Meenal to the remedial writing club, which your note says meets after the last bell. You confirmed: “the words the teacher confirmed”.',
    );
  });

  it('time-before: a step before school', () => {
    const k = c('time-before');
    for (const step of ['Meet him before school on Monday.', 'Ask him to come in early.', 'Give him morning assembly duty.', 'Use the zero period for maths.', 'An early morning slot would suit.']) {
      expect(verdict(step, k), step).toBe('conflict');
    }
    for (const step of ['Meet him before lunch.', 'Finish early if he is tired.', 'Check his homework first thing in the lesson.']) expect(verdict(step, k), step).toBe('none');
  });

  it('days-away: a step that names one of the days', () => {
    const k = c('days-away', { days: ['Friday', 'Saturday'] });
    expect(verdict('Hold his reading test on Friday morning.', k)).toBe('conflict');
    expect(verdict('Hold a quiz on Fridays.', k)).toBe('conflict');
    expect(verdict('Hold his reading test on Tuesday morning.', k)).toBe('none');
    expect(verdict('Hold his test on any day.', c('days-away', { days: [] }))).toBe('none');
  });

  it('money: a step that costs the family something', () => {
    const k = c('money');
    for (const step of ['Ask the family to buy a workbook.', 'Collect the trip fee by Monday.', 'Each child brings ₹50.', 'It costs 20 rupees.', 'Ask them to bring money for the fair.', 'Order a set of readers for her.']) {
      expect(verdict(step, k), step).toBe('conflict');
    }
    for (const step of ['Each child needs the practice workbook.', 'She should come in full uniform.', 'Bring ₹ 30 for the craft kit.', 'Suggest extra tuition in maths.', 'Send the art kit list home.']) {
      expect(verdict(step, k), step).toBe('conflict');
    }
    for (const step of ['Ask her to pay attention to the margins.', 'Put the cards in order.', 'Give her a printed sheet from the cupboard.', 'There is no need to buy a workbook.']) {
      expect(verdict(step, k), step).toBe('none');
    }
    // Known false alarms: the rule knows the word, not what the step does with it.
    for (const step of ['Lend her a workbook from the cupboard.', 'Check the word order in each sentence.']) expect(verdict(step, k), step).toBe('conflict');
  });

  it('no phone or internet: a step that needs one', () => {
    const k = c('no-phone-internet');
    for (const step of ['Send the worksheet on WhatsApp.', 'Ask him to watch a video at home.', 'Practise on the maths app.', 'Set an online quiz.', 'Email the notes to the family.']) {
      expect(verdict(step, k), step).toBe('conflict');
    }
    for (const step of ['Practise phonics for ten minutes.', 'Ask him to apply the rule.', 'Give him a printed worksheet.']) expect(verdict(step, k), step).toBe('none');
  });

  it('contact: a step that reaches the adult who is not to be contacted', () => {
    const k = c('contact', { who: 'father' });
    expect(verdict("Telephone Lata's father this week.", k)).toBe('conflict');
    expect(verdict('Send a note to her dad about homework.', k)).toBe('conflict');
    expect(verdict("Telephone Lata's mother this week.", k)).toBe('none');
    expect(verdict('Her father is a carpenter, so use that in a maths problem.', k)).toBe('none');
    // The parents together: the rule cannot tell which of them is meant.
    expect(verdict('Invite her parents to the meeting.', k)).toBe('unsure');
    expect(verdict('Call on her to answer first.', k)).toBe('none');
    // No adult was named: any parent the step contacts is a query.
    expect(verdict('Phone her mother.', c('contact'))).toBe('unsure');
  });

  it('contact: a step addressed to an adult who is not there', () => {
    const k = c('contact', { who: 'parents', guardian: 'grandmother', away: true });
    for (const step of ['Ask both parents to come in.', 'Dear parents, Kabir has worked hard.', 'His mother and father can sign the diary.', 'Ask his father to hear him read.']) {
      expect(verdict(step, k), step).toBe('conflict');
    }
    expect(verdict('Ask his grandmother to hear him read.', k)).toBe('none');
    expect(verdict('Write to whoever looks after him, not to his parents.', k)).toBe('none');
    const father = c('contact', { who: 'father', away: true });
    expect(verdict('Ask her father to sign the diary.', father)).toBe('conflict');
    expect(verdict('Ask both parents to come in.', father)).toBe('conflict');
    expect(verdict('Ask her mother to sign the diary.', father)).toBe('none');
    expect(verdict('Ask her grandparents to sign the diary.', father)).toBe('none');
    // Parents who are not together, with no guardian named.
    const apart = c('contact', { who: 'parents', away: true });
    expect(verdict('Invite both parents to the meeting.', apart)).toBe('conflict');
    expect(verdict('Send the report to her mother and father.', apart)).toBe('conflict');
    expect(verdict('Do not ask both parents to come in together.', apart)).toBe('none');
    expect(verdict('Meet whoever collects her, instead of her parents.', apart)).toBe('none');
    expect(ruleConflicts('Ask both parents to come in.', k, { name: 'Kabir' })!.reason).toBe(
      'This step speaks to “both parents”, and Kabir\'s parents are not there to ask. You confirmed: “the words the teacher confirmed”.',
    );
  });

  it('health: a step with one of the trigger words', () => {
    const k = c('health', { triggers: ['flashing lights', 'strobe'] });
    expect(verdict('Use a game with flashing lights as a reward.', k)).toBe('conflict');
    expect(verdict('Use the strobes from the science kit.', k)).toBe('conflict');
    expect(verdict('Use a quiet reading game as a reward.', k)).toBe('none');
    expect(verdict('Anything at all.', c('health', { triggers: [] }))).toBe('none');
    expect(verdict('Share peanuts at break.', c('health', { triggers: ['nut', 'peanut'] }))).toBe('conflict');
  });

  it('other: no rule can check it', () => {
    expect(verdict('Keep her after school and charge a fee.', c('other'))).toBe('none');
  });

  it('negation before the words, in the same clause, means no conflict', () => {
    const k = c('time-after');
    for (const step of [
      'Give her the practice in class, without attending the after-school club.',
      'Meet her at lunch instead of after school.',
      'Do not keep her after the last bell.',
      'Avoid any session after school.',
      'There is no need to stay back.',
      'She should never be given a detention.',
    ]) expect(verdict(step, k), step).toBe('none');
    // A negation in another clause does not reach the words.
    expect(verdict('Do not rush her, and keep her after school to finish.', k)).toBe('conflict');
    expect(verdict('She is not confident, so send her to the club after the last bell.', k)).toBe('conflict');
    expect(negated('Meet her at lunch instead of after school.', 31)).toBe(true);
    expect(verdict('The trip is free of cost.', c('money'))).toBe('none');
    expect(verdict('No fee is asked for.', c('money'))).toBe('none');
  });

  it('gives the matched words and a reason that names the student and quotes the constraint', () => {
    const k = c('time-after', { id: 'x', text: 'has to leave school at the last bell to reach home before dark' });
    expect(ruleConflicts('Second, send her to the club after the last bell.', k, { name: 'Meenal' })).toEqual({
      verdict: 'conflict',
      by: 'rule',
      constraintId: 'x',
      matched: 'after the last bell',
      reason: 'This step keeps Meenal after the last bell. You confirmed: “has to leave school at the last bell to reach home before dark”.',
    });
    expect(ruleConflicts('Hold a catch-up after school for anyone who is behind.', k)!.reason).toMatch(/^This step keeps a child after school\./);
  });
});

describe('the rule layer on an item of a draft', () => {
  const entities0 = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
  let held = { entities: entities0, constraints: proposeConstraints(SAMPLE_NOTE, entities0) };
  for (const x of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, x.id);
  const { entities, constraints } = held;
  const tokens = redactWithTokens(SAMPLE_NOTE, entities).tokens;
  const tok = (name: string) => entities.find((e) => e.kind === 'student' && e.surfaces.includes(name))!.token;
  const check = (heading: string, text: string, list = constraints) => ruleCheckItem({ heading, text }, list, entities, tokens, SAMPLE_NOTE);

  it('catches the club after the last bell for the student who has to leave, and shows what the cloud saw', () => {
    const r = check(tok('Meenal'), `First, give ${tok('Meenal')} a short written task each day. Second, enrol her in the remedial writing club. Third, praise her.`);
    expect(r.compared).toBe(2);
    expect(r.hit).toMatchObject({ verdict: 'conflict', matched: 'remedial writing club' });
    expect(r.hit!.reason).toBe(
      'This step sends Meenal to the remedial writing club, which your note says meets after the last bell. You confirmed: “has to leave school at the last bell to reach home before dark”. The cloud was not told this.',
    );
    expect(r.hit!.cloudSaw).toBe('She walks six kilometres home to [Place 1] and [withheld]');
  });

  it('compares a step only with the constraints of the student the item names', () => {
    const r = check(tok('Tanvi'), `Ask ${tok('Tanvi')} to help in the remedial writing club after the last bell.`);
    expect(r).toEqual({ compared: 0 });
    const aarav = check(tok('Aarav'), `Meet ${tok('Aarav')} before school to go over his homework.`);
    expect(aarav.hit).toMatchObject({ verdict: 'conflict', matched: 'before school' });
    expect(check(tok('Meenal'), `Meet ${tok('Meenal')} before school.`).hit).toBeUndefined();
  });

  it('keeps an item that names a student to that student, though it speaks of classmates or peers', () => {
    const forTanvi = check(`Note for ${tok('Tanvi')}`, `Ask ${tok('Tanvi')} to stay after school and read with her classmates. Her peers can meet before school.`);
    expect(forTanvi).toEqual({ compared: 0 });
    const forMeenal = check(`Note for ${tok('Meenal')}`, `Ask ${tok('Meenal')} to stay after school and read with her classmates.`);
    expect(forMeenal.compared).toBe(2);
    expect(forMeenal.hit).toMatchObject({ verdict: 'conflict', matched: 'after school' });
    // Two students named: the constraints of both, and of nobody else.
    const two = check(`${tok('Tanvi')} and ${tok('Aarav')}`, `Everyone in the group meets before school.`);
    expect(two.hit).toMatchObject({ verdict: 'conflict', matched: 'before school' });
    expect(two.hit!.reason).toContain('Aarav');
  });

  it('compares an item for the whole class, or one that names nobody, with every confirmed constraint', () => {
    const all = check('Whole class', 'Everyone stays for a spelling club after the last bell on Thursday.');
    expect(all.compared).toBe(5);
    expect(all.hit).toMatchObject({ verdict: 'conflict', matched: 'after the last bell' });
    expect(all.hit!.reason).toContain('keeps Meenal after the last bell');
    expect(check('Routines', 'Start each day with five minutes of silent reading.')).toEqual({ compared: 5 });
  });

  it('compares with nothing that is not confirmed', () => {
    const none = constraints.map((x) => ({ ...x, confirmed: false }));
    expect(check(tok('Meenal'), 'Keep her after school.', none)).toEqual({ compared: 0 });
  });

  it('reads the heading too, and a constraint about the class applies to every item', () => {
    expect(check(`After-school practice for ${tok('Meenal')}`, 'Ten minutes of handwriting.').hit).toMatchObject({ verdict: 'conflict' });
    const classWide: Constraint = { id: 'k', kind: 'money', text: 'no family here can pay for extras', source: 'teacher', confirmed: true };
    expect(check(tok('Tanvi'), 'Ask her to buy a reading diary.', [classWide]).hit!.reason).toMatch(/the family of a child/);
  });

  it('shows the cloud the sentences around a constraint as they were sent', () => {
    const health = constraints.find((x) => x.kind === 'health')!;
    expect(cloudSawAround(SAMPLE_NOTE, entities, health)).toBe('[withheld]');
    expect(cloudSawAround(SAMPLE_NOTE, entities, { ...health, at: undefined })).toBeUndefined();
    const at = SAMPLE_NOTE.indexOf('Meenal reads well');
    expect(redactRange(SAMPLE_NOTE, entities, at, at + 17)).toBe('[Student 2] reads well');
  });
});

describe('the two layers put together', () => {
  const hit = { verdict: 'conflict' as const, by: 'rule' as const, constraintId: 'x', matched: 'after school', reason: 'Rule reason.', cloudSaw: '[withheld]' };
  const doubt: ItemCheck = { verdict: 'unsure', reason: 'Model reason.', by: 'model', modelSaid: 'conflict' };
  const fits: ItemCheck = { verdict: 'fits', reason: 'Fine.', by: 'none' };
  const unchecked: ItemCheck = { verdict: 'not checked', reason: 'Nothing looked at this.' };

  it('a rule conflict is a conflict, and the rule speaks first', () => {
    expect(combineChecks({ hit, compared: 2 }, fits, unchecked)).toEqual({
      verdict: 'conflict', reason: 'Rule reason.', by: 'rule', constraintId: 'x', matched: 'after school', cloudSaw: '[withheld]', rules: 2,
    });
    const both = combineChecks({ hit, compared: 2 }, doubt, unchecked);
    expect(both).toMatchObject({ verdict: 'conflict', reason: 'Rule reason.', by: 'both', also: 'Model reason.' });
    expect(combineChecks({ hit, compared: 1 }, undefined, unchecked)).toMatchObject({ verdict: 'conflict', by: 'rule' });
  });

  it('the model alone gives a doubt, never a conflict', () => {
    const only = combineChecks({ compared: 1 }, doubt, unchecked);
    expect(only).toEqual({ ...doubt, rules: 1 });
    expect(verdictLabel(only)).toBe('The on-device model doubts this');
    expect(startsKept([only])).toEqual([null]);
  });

  it('with no model, an item the rules compared is checked by rule only', () => {
    const ruleOnly = combineChecks({ compared: 3 }, undefined, unchecked);
    expect(ruleOnly).toEqual({
      verdict: 'not checked',
      reason: 'Checked by rule against 3 confirmed constraints. The on-device model was not available for a wider check.',
      by: 'none',
      rules: 3,
    });
    expect(ruleOnlyReason(1)).toBe('Checked by rule against 1 confirmed constraint. The on-device model was not available for a wider check.');
    expect(combineChecks({ compared: 3 }, NOT_ANSWERED, unchecked).verdict).toBe('not checked');
    expect(verdictLabel(combineChecks({ compared: 3 }, NOT_ANSWERED, unchecked))).toBe('Checked by rule only');
    // Nothing looked at it: it stays unchecked, and is not called checked.
    expect(combineChecks({ compared: 0 }, undefined, unchecked)).toBe(unchecked);
    expect(verdictLabel(unchecked)).toBe('Not checked');
    expect(combineChecks({ compared: 0 }, NOTHING_WITHHELD, unchecked)).toMatchObject({ verdict: 'nothing withheld' });
  });

  it('names each verdict', () => {
    expect(verdictLabel(combineChecks({ hit, compared: 1 }, fits, unchecked))).toBe('Conflicts with a constraint you confirmed');
    expect(verdictLabel(combineChecks({ compared: 1 }, fits, unchecked))).toBe('No conflict found');
    expect(verdictLabel(NOTHING_WITHHELD)).toBe('Nothing to check');
    expect(verdictLabel({ verdict: 'unsure', reason: 'x', by: 'rule' })).toBe('Think before using');
    expect(verdictLabel({ verdict: 'unsure', reason: 'x', by: 'none' })).toBe('Think before using');
  });

  it('a conflict starts struck, a doubt is never kept by the one button, a rule-only item with no hit is', () => {
    const checks = [
      combineChecks({ hit, compared: 1 }, fits, unchecked),
      combineChecks({ compared: 1 }, doubt, unchecked),
      combineChecks({ compared: 1 }, fits, unchecked),
      combineChecks({ compared: 2 }, undefined, unchecked),
      combineChecks({ compared: 0 }, undefined, unchecked),
      combineChecks({ hit: { ...hit, verdict: 'unsure' }, compared: 1 }, undefined, unchecked),
    ];
    const start = startsKept(checks);
    expect(start).toEqual([false, null, null, null, null, null]);
    expect(keepNoConflict(start, checks)).toEqual([false, null, true, true, null, null]);
    expect(layerCounts(checks)).toEqual({ conflictsByRule: 1, doubtsByModel: 1 });
  });
});

describe('what a receipt keeps of the constraints and the two layers', () => {
  it('keeps counts and nothing else', () => {
    const checks: ItemCheck[] = [
      { verdict: 'conflict', reason: 'Rule reason naming Meenal.', by: 'rule', constraintId: 'x', matched: 'after school', cloudSaw: '[withheld]', rules: 1 },
      { verdict: 'unsure', reason: 'Model reason.', by: 'model', modelSaid: 'conflict', rules: 1 },
      { verdict: 'fits', reason: 'Fine.', by: 'none', rules: 0 },
    ];
    const constraints: Constraint[] = [
      c('time-after', { text: 'has to leave school at the last bell' }),
      c('health', { id: 'c2', text: 'has epilepsy', triggers: ['strobe'] }),
      c('money', { id: 'c3', text: 'cannot pay', confirmed: false }),
    ];
    const receipt = makeReceipt({
      task: 'plan',
      label: 'Support plan',
      labelWhere: 'FALLBACK',
      entities: [],
      guardWhere: 'RULES_ONLY',
      unreadParagraphs: 0,
      droppedDetails: 0,
      sentText: '[Student 1] reads well.',
      approvedAt: new Date().toISOString(),
      draftWhere: 'IN_CLOUD',
      draftModel: 'gemini-3.5-flash-lite',
      checkWhere: 'RULES_ONLY',
      replyFlagged: false,
      checks,
      constraints: { ...constraintCounts(constraints), shared: 1 },
      kept: 1,
      struck: 2,
      rewritten: 1,
      fittedOnDevice: 1,
      lesson: { stepsNeedingFit: 2, adjustmentsAccepted: 3, adjustmentsByModel: 1 },
    });
    expect(receipt.lesson).toEqual({ stepsNeedingFit: 2, adjustmentsAccepted: 3, adjustmentsByModel: 1 });
    expect(JSON.stringify(receiptRecord(receipt))).not.toMatch(/stepsNeedingFit|adjustments/);
    // Rewrites and fits are counted in this browser only: the record that may go to the account has no key for either.
    expect(receipt.signOff).toMatchObject({ kept: 1, struck: 2, rewritten: 1, fittedOnDevice: 1 });
    expect(JSON.stringify(receiptRecord(receipt))).not.toMatch(/fitted|rewritten/i);
    expect(receipt.check).toMatchObject({ conflict: 1, unsure: 1, fits: 1, conflictsByRule: 1, doubtsByModel: 1 });
    expect(receipt.constraints).toEqual({ confirmed: 2, byKind: { 'time-after': 1, health: 1 }, shared: 1 });
    expect(JSON.stringify(receipt)).not.toMatch(/last bell|epilepsy|strobe|Meenal|Rule reason|after school/);
    const record = receiptRecord(receipt);
    expect(record).toMatchObject({ checkWhere: 'RULES_ONLY', conflictsByRule: 1, doubtsByModel: 1, constraintsConfirmed: 2, needsShared: 1 });
    expect(JSON.stringify(record)).not.toMatch(/time-after|health/);
  });
});

describe('the title a receipt has before a model names it', () => {
  it('is the task and the day, and nothing from the note', () => {
    expect(plainTitle('plan', new Date(2026, 10, 26, 9, 30))).toBe('Support plan · 26 Nov 2026');
    expect(plainTitle('parents', new Date(2027, 0, 3))).toBe('Notes to parents · 3 Jan 2027');
    expect(plainTitle('handover', new Date(2026, 11, 31))).toBe('Hand-over · 31 Dec 2026');
  });
});
