import { describe, expect, it } from 'vitest';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from './samples';
import { buildVault, deterministicCandidates, possibleNameCandidates } from './vault';
import { confirmConstraint, lockConstraints, proposeConstraints } from './constraints';
import { outgoingOf } from './needs';
import { DEFAULT_POLICY } from './policy';
import { asRecordedRun, browserName, captureRun, RECORDED_FILE, replayBanner, replayNext, type RecordedRun } from './recorded';

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
    for (const key of Object.keys(run)) {
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
