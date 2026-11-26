import { describe, expect, it } from 'vitest';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from './samples';
import { buildVault, deterministicCandidates, possibleNameCandidates } from './vault';
import { confirmConstraint, lockConstraints, proposeConstraints } from './constraints';
import { outgoingOf } from './needs';
import { DEFAULT_POLICY } from './policy';
import { needOutcomes as outcomesOf, needsAccount } from './lessonNeeds';
import { asRecordedRun, browserName, captureRun, RECORDED_FILE, replayBanner, replayNext, type RecordedRun, RECORDED_SOURCE, sourceOf } from './recorded';

const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
let held = { entities: vault, constraints: proposeConstraints(SAMPLE_NOTE, vault) };
for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
const entities = lockConstraints(held.entities, held.constraints);

const run: RecordedRun = captureRun(
  {
    task: 'plan',
    note: SAMPLE_NOTE,
    classList: SAMPLE_CLASS_LIST,
    entities,
    constraints: held.constraints,
    outgoing: outgoingOf(SAMPLE_NOTE, entities, held.constraints).text,
    policy: DEFAULT_POLICY,
    draft: { title: 'Support plan', items: [{ heading: '[Student 2]', text: 'Enrol her in the remedial writing club.' }] },
    checks: [{ verdict: 'conflict', reason: 'r', by: 'rule', constraintId: held.constraints[0].id, matched: 'remedial writing club', rules: 2 }],
    where: { guard: 'ON_DEVICE', draft: 'IN_CLOUD', check: 'ON_DEVICE' },
    draftModel: 'gemini-3.5-flash-lite',
  },
  new Date('2026-11-26T10:15:30.000Z'),
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.60 Safari/537.36',
);

describe('a recorded run with rewrites and suggestions', () => {
  const fit = { itemIndex: 0, stepIndex: 0, suggestion: 'Give Meenal the writing task in the lunch break.' };
  const rewrite = { itemIndex: 0, text: 'Give [Student 2] the writing task in the lunch break.' };
  const copy = () => JSON.parse(JSON.stringify(run)) as Record<string, unknown>;

  it('holds what stood at the download, beside the reply as it first came', () => {
    const saved = captureRun({ ...run, rewrites: [rewrite], fits: [fit] }, new Date(run.recordedAt), 'Chrome/142.0.7444.60');
    expect(saved.draft).toEqual(run.draft);
    expect(saved.checks).toEqual(run.checks);
    const back = asRecordedRun(JSON.parse(JSON.stringify(saved)))!;
    expect(back.rewrites).toEqual([rewrite]);
    expect(back.fits).toEqual([fit]);
    expect(asRecordedRun({ ...copy(), fits: [{ ...fit, extra: 'x' }] })!.fits).toEqual([fit]);
  });

  it('leaves both out when there are none, so an older file reads the same', () => {
    const saved = captureRun({ ...run, rewrites: [], fits: [] }, new Date(run.recordedAt), 'Chrome/142.0.7444.60');
    expect(saved).not.toHaveProperty('rewrites');
    expect(saved).not.toHaveProperty('fits');
    expect(asRecordedRun(copy())).not.toHaveProperty('fits');
  });

  it('is refused when a suggestion or a rewrite is not in form', () => {
    for (const fits of [
      'x',
      [{ ...fit, itemIndex: 1 }],
      [{ ...fit, itemIndex: -1 }],
      [{ ...fit, stepIndex: 1.5 }],
      [{ ...fit, suggestion: '  ' }],
      [{ ...fit, suggestion: 'x'.repeat(301) }],
      [{ itemIndex: 0, stepIndex: 0 }],
      [fit, fit],
      [null],
    ]) expect(asRecordedRun({ ...copy(), fits }), JSON.stringify(fits).slice(0, 60)).toBeUndefined();
    for (const rewrites of [{}, [{ itemIndex: 3, text: 'x' }], [{ itemIndex: 0, text: '' }], [{ itemIndex: 0 }], [rewrite, rewrite], [{ itemIndex: 0, text: 'x'.repeat(4001) }]]) {
      expect(asRecordedRun({ ...copy(), rewrites }), JSON.stringify(rewrites).slice(0, 60)).toBeUndefined();
    }
  });
});

describe('a recorded lesson', () => {
  const lesson = { klass: 'Class 6', subject: 'English', topic: 'Describing a place', minutes: 40, lastTime: '' };

  it('holds the needs by letter, whose each is, the lines for needs and the materials, and refuses any that is not in form', () => {
    const student = entities.find((e) => e.kind === 'student')!.id;
    const needs = [{ letter: 'A', line: 'cannot stay after the last bell' }];
    const variations = [{ itemIndex: 0, need: 'A', text: 'does it at lunch' }];
    const materials = {
      board: ['A place'],
      sheet: ['1', '2', '3', '4', '5'],
      versions: [{ need: 'A', note: 'Hand it out in class.', items: ['Name the place.', 'Write what you see.', 'Write what you hear.'] }],
      ticket: [1, 2, 3].map((n) => ({ question: `q${n}`, answer: `a${n}` })),
    };
    const full = { ...run, task: 'lesson' as const, lesson: { ...lesson, language: 'Hindi' }, needs, needChildren: { A: [student] }, variations, materials };
    const saved = captureRun(full, new Date(run.recordedAt), 'Chrome/142.0.7444.60');
    const back = asRecordedRun(JSON.parse(JSON.stringify(saved)))!;
    expect(back.needs).toEqual(needs);
    expect(back.needChildren).toEqual({ A: [student] });
    expect(back.variations).toEqual(variations);
    // The capture keeps which needs the class sheet suits and which got no sheet: here, none of either.
    expect(back.materials).toEqual({ ...materials, same: [], missing: [] });
    expect(back.lesson?.language).toBe('Hindi');
    const json = () => JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
    for (const bad of [
      { needs: [{ letter: 'a', line: 'x' }] },
      { needs: [...needs, ...needs] },
      { needChildren: { B: [student] } },
      { needChildren: { A: ['nobody'] } },
      { variations: [{ itemIndex: 0, need: 'B', text: 'x' }] },
      { variations: [{ itemIndex: 9, need: 'A', text: 'x' }] },
      { materials: { ...materials, board: [] } },
      { materials: { ...materials, sheet: ['1', '2'] } },
      { materials: { ...materials, ticket: materials.ticket.slice(0, 2) } },
      { materials: { ...materials, versions: [{ need: 'B', note: 'x', items: ['y'] }] } },
      { materials: { ...materials, versions: [...materials.versions, ...materials.versions] } },
      { materials: { ...materials, versions: [{ need: 'A', note: 'x', items: [] }] } },
      { materials: { ...materials, versions: [{ need: 'A', note: 'x', items: ['y'], text: 'z' }] } },
      { materials: { ...materials, versions: [{ need: 'A', note: 'x', items: Array.from({ length: 9 }, () => 'y') }] } },
      { lesson: { ...lesson, language: 'x'.repeat(41) } },
    ]) expect(asRecordedRun({ ...json(), ...bad }), JSON.stringify(bad).slice(0, 60)).toBeUndefined();
    // A file recorded before the lines were asked for has one text for each version: it is read as the note, with no lines.
    expect(asRecordedRun({ ...json(), materials: { ...materials, versions: [{ need: 'A', text: 'Does the sheet in class.' }] } })!.materials!.versions).toEqual([{ need: 'A', note: 'Does the sheet in class.', items: [] }]);
    // No materials outside a lesson.
    expect(asRecordedRun({ ...(JSON.parse(JSON.stringify(run)) as object), materials })).toBeUndefined();
    expect(captureRun({ ...run, task: 'lesson', lesson, needs: [], variations: [] }, new Date(run.recordedAt), 'x')).not.toHaveProperty('needs');
  });
  it('keeps what came of every need and the accounting of the materials, and reads a file recorded before it did', () => {
    const student = entities.find((e) => e.kind === 'student')!.id;
    const needs = [
      { letter: 'A', line: 'cannot stay after the last bell' },
      { letter: 'B', line: 'no phone or internet at home' },
      { letter: 'G', line: 'finishes early and needs more to do' },
    ];
    const variations = [{ itemIndex: 0, need: 'G', text: 'adds a second paragraph' }];
    const needOutcomes = { A: 'already suits', B: 'missing', G: 'for a stage' } as const;
    const materials = {
      board: ['A place'],
      sheet: ['1', '2', '3', '4', '5'],
      versions: [{ need: 'G', note: 'For the early finishers.', items: ['Write a second paragraph.', 'Use three sound words.', 'Underline your best sentence.'] }],
      ticket: [1, 2, 3].map((n) => ({ question: `q${n}`, answer: `a${n}` })),
      same: ['A'],
      missing: ['B'],
      dropped: 1,
    };
    const saved = captureRun({ ...run, task: 'lesson', lesson, needs, needChildren: { G: [student] }, variations, needOutcomes, materials }, new Date(run.recordedAt), 'x');
    const back = asRecordedRun(JSON.parse(JSON.stringify(saved)))!;
    expect(back.needOutcomes).toEqual(needOutcomes);
    expect(needsAccount(back.needOutcomes!)).toBe('For each need: 1 written for a stage, 1 already suited, 1 missing');
    expect(needOutcomes).toEqual(outcomesOf(['A', 'B', 'G'], variations, ['A']));
    expect([back.materials!.same, back.materials!.missing]).toEqual([['A'], ['B']]);
    expect(back.materials).not.toHaveProperty('dropped');
    const json = () => JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
    for (const bad of [
      { needOutcomes: { A: 'already suits', B: 'missing' } },
      { needOutcomes: { ...needOutcomes, Z: 'missing' } },
      { needOutcomes: { ...needOutcomes, A: 'maybe' } },
      // An entry for a stage exactly when there are lines for that need.
      { needOutcomes: { ...needOutcomes, A: 'for a stage' } },
      { needOutcomes: { ...needOutcomes, G: 'already suits' } },
      { materials: { ...json().materials as object, same: ['G'] } },
      { materials: { ...json().materials as object, missing: ['A'] } },
      { materials: { ...json().materials as object, same: ['Z'] } },
    ]) expect(asRecordedRun({ ...json(), ...bad }), JSON.stringify(bad).slice(0, 80)).toBeUndefined();
    // A file recorded before: no outcomes and no accounting of the materials. It still reads.
    const { needOutcomes: _o, ...before } = json();
    const m = { ...(before.materials as Record<string, unknown>) };
    delete m.same;
    delete m.missing;
    const old = asRecordedRun({ ...before, materials: m })!;
    expect(old.needOutcomes).toBeUndefined();
    expect(old.materials).not.toHaveProperty('same');
  });

  const adjustment = { itemIndex: 0, constraintId: held.constraints[0].id, text: 'Uses chart paper from the class set.', source: 'rule starter' as const };
  const student = held.entities.find((e) => e.kind === 'student')!;
  const point = { itemIndex: 0, stage: 'Teach', childId: student.id, text: 'Seat her near the front for the demonstration.', source: 'on-device model' as const };
  const base = () => ({ ...(JSON.parse(JSON.stringify(run)) as Record<string, unknown>), task: 'lesson', lesson });

  it('holds the lines that were sent and the adjustments as they stood, and reads them back', () => {
    const saved = captureRun({ ...run, task: 'lesson', lesson, adjustments: [adjustment] }, new Date(run.recordedAt), 'Chrome/142.0.7444.60');
    const back = asRecordedRun(JSON.parse(JSON.stringify(saved)))!;
    expect(back.task).toBe('lesson');
    expect(back.lesson).toEqual(lesson);
    expect(back.adjustments).toEqual([adjustment]);
    expect(captureRun({ ...run, task: 'lesson', lesson, adjustments: [] }, new Date(run.recordedAt), 'x')).not.toHaveProperty('adjustments');
    // The same child may have more than one adjustment in a stage, for different constraints.
    expect(asRecordedRun({ ...base(), adjustments: [adjustment, { ...adjustment, constraintId: held.constraints[1].id }] })!.adjustments).toHaveLength(2);
    // A point answers no constraint: it is for a child, in a stage, and says who wrote it.
    expect(asRecordedRun({ ...base(), adjustments: [point, { ...adjustment, stage: 'Starter', childId: student.id }] })!.adjustments).toEqual([
      point,
      { itemIndex: 0, stage: 'Starter', childId: student.id, constraintId: held.constraints[0].id, text: adjustment.text, source: 'rule starter' },
    ]);
    expect(sourceOf('on-device model')).toBe('model');
    expect(sourceOf(RECORDED_SOURCE.starter)).toBe('starter');
    expect(sourceOf('teacher')).toBe('teacher');
  });

  it('is refused when the lines or an adjustment are not in form', () => {
    expect(asRecordedRun({ ...base(), lesson: undefined })).toBeUndefined();
    expect(asRecordedRun({ ...(JSON.parse(JSON.stringify(run)) as object), lesson })).toBeUndefined();
    for (const bad of [{ ...lesson, minutes: 2 }, { ...lesson, minutes: '40' }, { ...lesson, topic: 'x'.repeat(121) }, { klass: 'x' }, 'English']) {
      expect(asRecordedRun({ ...base(), lesson: bad }), JSON.stringify(bad).slice(0, 50)).toBeUndefined();
    }
    for (const bad of [
      { ...adjustment, itemIndex: 4 },
      { ...adjustment, constraintId: 'nobody' },
      { ...adjustment, text: ' ' },
      { ...adjustment, text: 'x'.repeat(301) },
      { ...adjustment, source: 'cloud' },
      { ...adjustment, source: 'model' },
      { ...point, childId: 'nobody' },
      { ...point, childId: held.entities.find((e) => e.kind !== 'student')?.id ?? 'x' },
      { itemIndex: 0, text: 'For nobody.', source: 'teacher' },
      { ...point, stage: 7 },
    ]) expect(asRecordedRun({ ...base(), adjustments: [bad] }), JSON.stringify(bad).slice(0, 60)).toBeUndefined();
    expect(asRecordedRun({ ...(JSON.parse(JSON.stringify(run)) as object), adjustments: [adjustment] })).toBeUndefined();
  });
});

describe('a recorded run', () => {
  it('is captured in the form of the file and read back whole', () => {
    expect(run.recordedAt).toBe('2026-11-26T10:15:30.000Z');
    expect(run.chrome).toBe('Chrome 142.0.7444.60');
    expect(asRecordedRun(JSON.parse(JSON.stringify(run)))).toEqual(JSON.parse(JSON.stringify(run)));
    // Only the fields of a recorded run come back.
    expect(asRecordedRun({ ...run, extra: 'x' })).not.toHaveProperty('extra');
    expect(RECORDED_FILE).toBe('recorded-run.json');
    expect(browserName('SomethingElse/1.0')).toBe('SomethingElse/1.0');
  });

  it('is refused when it is not in that form, so a broken file offers no replay', () => {
    const copy = () => JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
    expect(asRecordedRun(null)).toBeUndefined();
    expect(asRecordedRun('<!doctype html>')).toBeUndefined();
    expect(asRecordedRun({})).toBeUndefined();
    for (const key of Object.keys(run).filter((k) => !['rewrites', 'fits', 'lesson', 'adjustments'].includes(k))) {
      const broken = copy();
      delete broken[key];
      expect(asRecordedRun(broken), key).toBeUndefined();
    }
    expect(asRecordedRun({ ...copy(), recordedAt: 'last week' })).toBeUndefined();
    expect(asRecordedRun({ ...copy(), checks: [] })).toBeUndefined();
    expect(asRecordedRun({ ...copy(), checks: [{ verdict: 'fine', reason: 'r' }] })).toBeUndefined();
    expect(asRecordedRun({ ...copy(), where: { guard: 'ON_DEVICE', draft: 'IN_CLOUD', check: 'SOMEWHERE' } })).toBeUndefined();
    expect(asRecordedRun({ ...copy(), entities: [{ id: 'x' }] })).toBeUndefined();
    expect(asRecordedRun({ ...copy(), constraints: [{ id: 'x', kind: 'curfew', text: 't', source: 'rule', confirmed: true }] })).toBeUndefined();
    expect(asRecordedRun({ ...copy(), draft: { title: 'x', items: [] } })).toBeUndefined();
    expect(asRecordedRun({ ...copy(), task: 'essay' })).toBeUndefined();
  });

  it('says on a banner that it is a replay, and when the run was made', () => {
    expect(replayBanner(run)).toBe(
      'Recorded run. This is a replay of a real run on 26 November 2026 in Chrome with the on-device model. Nothing is being sent now.',
    );
  });

  it('is walked screen by screen, and stops at the last', () => {
    expect(replayNext('write')).toBe('review');
    expect(replayNext('review')).toBe('result');
    expect(replayNext('result')).toBe('signed');
    expect(replayNext('signed')).toBe('signed');
  });

  it('validates, if the file is there', () => {
    const files = import.meta.glob('../../public/recorded-run.json', { eager: true, import: 'default' });
    for (const [path, data] of Object.entries(files)) expect(asRecordedRun(data), path).toBeDefined();
  });
});
