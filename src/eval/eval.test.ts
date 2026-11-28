import { describe, expect, it } from 'vitest';
import { detailsFor } from '../ai/check';
import { combineChecks, ruleCheckItem } from '../core/conflicts';
import { CASES, prepare } from './cases';
import { prepareFull } from './full';
import { HELDOUT } from './heldout';
import { RULE_CASES, runRuleSet } from './rules';
import { FIT_CASES, FIT_CHILD_CASES, fitInput, fitRow, fitTotals } from './fit';
import { LESSON_CASES, runLessonSet } from './lesson';
import { ruleConflicts } from '../core/conflicts';
import { lessonFitCases, lessonFitRow, lessonFitTotals } from './fit';
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
    // These numbers are a measurement, not a target. A case the rules get wrong stays here by name.
    // The rules have since been changed for other cases (a negation cancels only what it governs, things to
    // bring from home count as a cost, the phone and internet rule is about home, more health words). Those
    // changes were made knowing this set, so it is no longer fresh for them. They moved nothing here:
    // the totals and both lists are the same before and after.
    // The same holds for the later narrowing of "order" and of buying that is only studied, made from
    // steps the cloud wrote live: nothing here moved.
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

describe('the lesson set: whole lessons against the sample class, by rule', () => {
  const { rows, totals } = runLessonSet();

  it('has five lessons in five subjects, five stages each, with the stages that do not suit a child labelled', () => {
    expect(LESSON_CASES.map((c) => c.subject)).toEqual(['English', 'Mathematics', 'Science', 'Social science', 'Art']);
    for (const c of LESSON_CASES) {
      expect(c.stages, c.id).toHaveLength(5);
      for (const [i] of c.expected) expect(i, c.id).toBeLessThan(5);
    }
  });

  it('is measured as it is: what the rules miss and flag wrongly stays listed', () => {
    // A measurement, not a target. As first measured, before any rule was changed: 13 labelled, 10 caught,
    // 3 missed, 1 false alarm. The three misses were "bring one from home" (english, Aarav), a light that
    // "flickers" (science, Meenal) and "those without can purchase a kit" (art, Aarav); the false alarm was
    // the teacher's phone used in class (social, Tanvi).
    //
    // The rules were then changed after seeing these cases: a negation now cancels only what it governs,
    // the money rule knows things to bring from home, the phone and internet rule is about home, and the
    // health words gained "flicker". So this set is no longer fresh for those rules, and the numbers
    // below say only that the fixes do what they were written to do on the cases they were written from.
    // The later narrowing of "order" and of buying that is only studied moved nothing here either.
    expect(totals).toEqual({ lessons: 5, stages: 25, expected: 13, caught: 13, missed: 0, falseAlarms: 0 });
    expect(rows.filter((r) => r.outcome !== 'caught')).toEqual([]);
  });
});

describe('the fit set for a lesson', () => {
  it('has eight fresh steps of a lesson, each one a rule conflict for the child', () => {
    expect(FIT_CHILD_CASES).toHaveLength(8);
    const others = new Set([...FIT_CASES.map((c) => c.step), ...RULE_CASES.map((c) => c.step), ...LESSON_CASES.flatMap((c) => c.stages.map((s) => s.text))]);
    for (const c of FIT_CHILD_CASES) {
      expect(ruleConflicts(c.step, c.constraint)?.verdict, c.id).toBe('conflict');
      expect(others.has(c.step), c.id).toBe(false);
    }
  });

  it('asks what the child does instead, and reads the answer by rule', async () => {
    const c = FIT_CHILD_CASES.find((x) => x.id === 'child-offline-1')!;
    const prompts: string[] = [];
    const ask: FitAsk = async (prompt) => {
      prompts.push(prompt);
      return { text: JSON.stringify({ rewrite: 'He reads the page on the water cycle in the textbook and lists its four stages.' }), onDevice: true };
    };
    const row = await fitRow(c, ask, true);
    expect(prompts[0]).toMatch(/Say what this child does instead\.$/);
    expect(row.offered).toMatchObject({ ok: true, requests: 1 });
    expect(row.first).toMatchObject({ produced: true, rulePasses: true });
  });
});

describe('the fit set: what each child needs in each lesson', () => {
  const cases = lessonFitCases();

  it('has the five lessons of the lesson set for each of the five children the sample note speaks of', () => {
    expect(cases).toHaveLength(25);
    expect(new Set(cases.map((c) => c.id)).size).toBe(25);
    expect([...new Set(cases.map((c) => c.child))]).toEqual(['Aarav Sharma', 'Meenal', 'Kabir', 'Ishaan', 'Tanvi']);
    expect(cases[0].input.stages.map((s) => s.name)).toEqual(['Starter', 'Teach', 'Practise', 'Check', 'Homework']);
    expect(cases[1].input.childNote).toContain('has epilepsy');
  });

  it('reports each point of the first answer and of the offer, and rates none', async () => {
    const meenal = cases.find((c) => c.id === 'english/meenal')!;
    const answers = [
      JSON.stringify({ points: [{ stage: 'Check', do: 'Let her read hers aloud.' }, { stage: 'Plenary', do: 'Ask her first.' }, { stage: 'Homework', do: 'She can finish it after school with you.' }] }),
      JSON.stringify({ points: [{ stage: 'Homework', do: 'She has epilepsy, so keep it short.' }] }),
    ];
    let n = 0;
    const row = await lessonFitRow(meenal, () => async () => ({ text: answers[n++] ?? '', onDevice: true }));
    expect(row.first.map((p) => [p.stage, p.realStage, p.rulePasses, p.rating])).toEqual([
      ['Check', true, true, null],
      ['Plenary', false, false, null],
      ['Homework', true, false, null],
    ]);
    expect(row.first[2].matched).toEqual(['after school']);
    expect(row.offered.map((p) => p.do)).toEqual(['Let her read hers aloud.', 'She has epilepsy, so keep it short.']);
    expect(row.offered[1].repeats.length).toBeGreaterThan(0);
    expect(row).toMatchObject({ read: true, requests: 2, droppedByRule: 0, unknownStage: 1 });
    expect(lessonFitTotals([row])).toEqual({ calls: 1, read: 1, noPoints: 0, points: 3, realStage: 2, rulePasses: 1, repeatsPrivate: 0, offered: 2, offeredRepeatsPrivate: 1, droppedByRule: 0, errors: 0, rated: 0 });
    const stopped = await lessonFitRow(meenal, () => async () => ({ text: 'x', onDevice: false }));
    expect(stopped.error).toMatch(/did not run on the device/);
    expect(lessonFitTotals([stopped])).toMatchObject({ calls: 1, read: 0, errors: 1, points: 0 });
  });
});

describe('the needs set: the parser and the placing, no model', () => {
  it('places every labelled line beside the right child and nowhere else', async () => {
    const { runNeedsSet, NEEDS_CASES, sampleNeeds } = await import('./needs');
    expect(NEEDS_CASES).toHaveLength(5);
    expect(sampleNeeds().needs.map((n) => n.letter).join('')).toBe('ABCDFGHIMNO');
    const { totals } = runNeedsSet();
    // Frozen as first measured.
    expect(totals).toEqual({ replies: 5, lines: 26, right: 26, missing: 0, wrongChild: 0, droppedExpected: 4, droppedFound: 4, hitsExpected: 5, hitsFound: 5, hitsMissed: 0, hitsFalse: 0 });
  });

  it('builds needs J, K, L and Q from an exit ticket, with no name and no count in what is told', async () => {
    const { runTicketSet } = await import('./needs');
    const got = runTicketSet();
    expect(got.rows.filter((r) => !r.right || !r.noNames)).toEqual([]);
    expect([got.right, got.cases]).toEqual([5, 5]);
  });

  it('has twelve paragraphs for the learning-need proposer, and the rule finds the labelled kinds', async () => {
    const { LEARNING_CASES, runLearningRules } = await import('./needs');
    expect(LEARNING_CASES).toHaveLength(12);
    const got = runLearningRules();
    expect([got.right, got.cases]).toEqual([12, 12]);
  });
});

describe('the guard set: what the on-device model adds to the rules', () => {
  it('has twelve fresh notes of two to five sentences, every label written out in the words of its note', async () => {
    const { GUARD_CASES } = await import('./guard');
    const { CONSTRAINT_KINDS } = await import('../core/constraints');
    const { sentences } = await import('../core/rules');
    const { SAMPLE_CLASS_LIST, SAMPLE_NOTE } = await import('../core/samples');
    expect(GUARD_CASES).toHaveLength(12);
    expect(new Set(GUARD_CASES.map((c) => c.id)).size).toBe(12);
    for (const c of GUARD_CASES) {
      const n = sentences(c.note).length;
      expect(n >= 2 && n <= 5, `${c.id}: ${n} sentences`).toBe(true);
      for (const d of [...c.details.map((x) => x.text), ...c.harmless]) expect(c.note, `${c.id}: “${d}”`).toContain(d);
      // A harmless span is no part of a private detail, and no private detail is part of it.
      for (const h of c.harmless) for (const d of c.details) expect(h.includes(d.text) || d.text.includes(h), `${c.id}: “${h}” / “${d.text}”`).toBe(false);
      expect(c.constraints.every((k) => CONSTRAINT_KINDS.includes(k))).toBe(true);
      expect(new Set(c.constraints).size).toBe(c.constraints.length);
      // Fresh: no pupil of the sample class, and no sentence of the sample note.
      for (const name of c.classList) expect(SAMPLE_CLASS_LIST).not.toContain(name);
      for (const s of sentences(c.note)) expect(SAMPLE_NOTE).not.toContain(s.text);
    }
    // Details the lists should catch and details only a reader would see; and harmless words that look private.
    const all = GUARD_CASES.flatMap((c) => c.details);
    expect(all.filter((d) => !d.easy).length).toBeGreaterThanOrEqual(15);
    expect(all.filter((d) => d.easy && d.kind === 'private').length).toBeGreaterThanOrEqual(3);
    expect(GUARD_CASES.flatMap((c) => c.harmless).length).toBeGreaterThanOrEqual(6);
  });
});

describe('the guard set: the run and the score, with fake guard output', () => {
  const fake = {
    id: 'fake',
    classList: ['Asha Rao'],
    note: 'Asha lives near Rampur and her family struggles after the harvest. Asha won the Science Fair. The class sings.',
    details: [
      { text: 'Asha', kind: 'name' as const, easy: true },
      { text: 'Rampur', kind: 'place' as const, easy: false },
      { text: 'her family struggles after the harvest', kind: 'private' as const, easy: false },
    ],
    harmless: ['Science Fair', 'The class sings'],
    constraints: ['money' as const, 'time-after' as const],
  };

  it('counts a detail caught only where every letter of it is held back, wherever it stands', async () => {
    const { scoreGuard } = await import('./guard');
    const { buildVault } = await import('../core/vault');
    const entities = buildVault(fake.note, [
      { kind: 'student', text: 'Asha Rao', source: 'class list' },
      { kind: 'private', text: 'family struggles after the harvest', source: 'on-device model' },
      { kind: 'place', text: 'Science Fair', source: 'on-device model' },
    ]);
    const constraints = [
      { id: 'm', kind: 'money', text: 'x', source: 'rule', confirmed: false },
      { id: 'l', kind: 'learning', text: 'y', source: 'rule', confirmed: false },
      { id: 'h', kind: 'health', text: 'z', source: 'on-device model', confirmed: false },
    ] satisfies import('../core/types').Constraint[];
    expect(scoreGuard(fake, { entities, constraints })).toEqual({
      caught: ['Asha'],
      partly: ['her family struggles after the harvest'],
      missed: ['Rampur'],
      harmlessHeld: ['Science Fair'],
      constraintsMatched: ['money'],
      constraintsMissed: ['time-after'],
      // A learning need is not a constraint kind here.
      constraintsExtra: ['health'],
    });
    // With nothing held back, every detail is missed and no harmless span is held.
    expect(scoreGuard(fake, { entities: [], constraints: [] })).toMatchObject({ caught: [], partly: [], missed: ['Asha', 'Rampur', 'her family struggles after the harvest'], harmlessHeld: [] });
  });

  it('runs the guard as the app does: with no device the capitalised-word rule; with it the model, and no such rule', async () => {
    const { guardNote, scoreGuard } = await import('./guard');
    const rules = await guardNote(fake, null);
    expect(rules.where).toBe('RULES_ONLY');
    // The capitalised-word rule holds back Rampur, and the harmless Science Fair with it.
    expect(scoreGuard(fake, rules)).toMatchObject({ caught: ['Asha', 'Rampur'], harmlessHeld: ['Science Fair'] });
    const device = {
      guard: async () => ({ candidates: [{ kind: 'private' as const, text: 'her family struggles after the harvest', source: 'on-device model' as const }], total: 1, unread: [], dropped: 0, partial: 0 }),
      constraints: async () => ({ constraints: [{ id: 'd', kind: 'money' as const, text: 'her family struggles after the harvest', source: 'on-device model' as const, confirmed: false }], asked: 1, unread: 0, dropped: 0 }),
    };
    const model = await guardNote(fake, device);
    expect(model.where).toBe('ON_DEVICE');
    expect(scoreGuard(fake, model)).toMatchObject({ caught: ['Asha', 'her family struggles after the harvest'], missed: ['Rampur'], harmlessHeld: [], constraintsMatched: ['money'] });
    // A model that read nothing leaves a rules-only run; one that throws is counted, and the rules stand.
    expect((await guardNote(fake, { ...device, guard: async () => ({ candidates: [], total: 1, unread: [0], dropped: 0, partial: 0 }) })).where).toBe('RULES_ONLY');
    const broke = await guardNote(fake, { ...device, guard: async () => Promise.reject(new Error('no answer')) });
    expect([broke.where, broke.failed]).toEqual(['RULES_ONLY', 'no answer']);
  });

  it('adds up each mode on its own, with the details a rule should catch apart from the rest', async () => {
    const { guardTotals, GUARD_CASES } = await import('./guard');
    const c = GUARD_CASES[0];
    const row = (mode: 'rules' | 'model', caught: string[], ms: number) => ({
      run: 1, id: c.id, mode, where: 'RULES_ONLY' as const, unread: 0, ms,
      caught, partly: [], missed: c.details.map((d) => d.text).filter((t) => !caught.includes(t)),
      harmlessHeld: [], constraintsMatched: [], constraintsMissed: [...c.constraints], constraintsExtra: [],
    });
    const rows = [row('rules', ['Sneha', 'Arjun'], 10), row('model', ['Sneha', 'Arjun', 'Her father lost his shop in the floods'], 300)];
    expect(guardTotals(rows, 'rules')).toMatchObject({ runs: 1, details: 5, caught: 2, missed: 3, easy: { caught: 2 }, notEasy: { caught: 0, missed: 2 }, medianMs: 10 });
    expect(guardTotals(rows, 'model')).toMatchObject({ caught: 3, notEasy: { caught: 1 }, medianMs: 300 });
  });
});

describe('scale35 full-class privacy stress benchmark', () => {
  it('withholds all 35 pupil names, contacts, IDs, and sensitive phrases with zero exit-gate leaks in rules mode', async () => {
    const { buildScale35Fixture, scoreScale35 } = await import('./scale35');
    const fixture = buildScale35Fixture();
    expect(fixture.classList).toHaveLength(35);
    expect(fixture.note.length).toBeLessThanOrEqual(8000);
    const scored = scoreScale35(fixture, [], 'RULES_ONLY', [], 0, 0, 12, 14);
    expect(scored.students).toBe(35);
    expect(scored.exitGateViolations).toEqual([]);
    expect(scored.leakedTokens).toEqual([]);
    expect(scored.constraintsProposed).toBeGreaterThanOrEqual(7);
  });
});
