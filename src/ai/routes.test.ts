import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVault } from '../core/vault';
import { checkOnDevice } from './check';
import { constraintsOnDevice } from './constraints';
import { labelReceipt } from './draft';
import { guardOnDevice } from './guard';
import { fitForChild, fitStep } from './fit';
import { modelFor, onDeviceModelPresent, prepareDevice } from './routes';

const note = 'Meenal reads well. She has epilepsy.';
const vault = buildVault(note, [
  { kind: 'student', text: 'Meenal', source: 'class list' },
  { kind: 'private', text: 'She has epilepsy', source: 'teacher' },
]);

describe('ONLY_ON_DEVICE routes with no on-device model', () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('the network must not be used')));

  beforeEach(() => {
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sees that no model is present', () => {
    expect(onDeviceModelPresent()).toBe(false);
  });

  it('refuses to build a guard or check model', () => {
    expect(() => modelFor('guard', { system: 'x' })).toThrow(/Nothing was sent/);
    expect(() => modelFor('check', { system: 'x' })).toThrow(/Nothing was sent/);
    expect(() => modelFor('fit', { system: 'x' })).toThrow(/Nothing was sent/);
  });

  it('rejects the guard without a request', async () => {
    await expect(guardOnDevice(note, () => {})).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects the search for constraints without a request', async () => {
    await expect(constraintsOnDevice(note, vault, () => {})).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects the check without a request', async () => {
    const items = [{ heading: '[Student 1]', text: 'Set a timed written test.' }];
    await expect(checkOnDevice(note, items, vault, ['[Student 1]'], () => {})).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects the fit of a step without a request', async () => {
    const constraint = { id: 'c', kind: 'time-after' as const, text: 'has to leave at the last bell', source: 'rule' as const, confirmed: true };
    await expect(fitStep({ step: 'Keep her after school.', itemText: 'Keep her after school.', constraint, task: 'plan' })).rejects.toThrow(/no on-device model/);
    await expect(fitForChild({ step: 'Keep her after school.', constraint })).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers without any model when no private detail was withheld', async () => {
    const nothingPrivate = vault.filter((e) => e.kind !== 'private');
    const items = [{ heading: 'Whole class', text: 'Start with a quiet reading task.' }];
    const run = await checkOnDevice(note, items, nothingPrivate, ['[Student 1]'], () => {});
    expect(run.checks.map((c) => c.verdict)).toEqual(['nothing withheld']);
    expect(run.asked).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a whole-class item too when a private detail was withheld', async () => {
    const items = [{ heading: 'Whole class', text: 'Hold a timed written test.' }];
    await expect(checkOnDevice(note, items, vault, ['[Student 1]'], () => {})).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects loading the model without a request', async () => {
    await expect(prepareDevice(() => {})).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still builds the cloud routes, which carry only approved text', () => {
    expect(() => modelFor('draft', { system: 'x' })).not.toThrow();
    expect(() => modelFor('label', { system: 'x' })).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('naming the receipt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a fallback when neither model answers', async () => {
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await labelReceipt('[Student 1] reads well.', 'Support plan for next week')).toEqual({
      title: 'Support plan for next week',
      where: 'FALLBACK',
    });
  });
});
