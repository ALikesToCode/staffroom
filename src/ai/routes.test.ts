import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVault } from '../core/vault';
import { checkOnDevice } from './check';
import { labelReceipt } from './draft';
import { guardOnDevice } from './guard';
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
  });

  it('rejects the guard without a request', async () => {
    await expect(guardOnDevice(note, () => {})).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects the check without a request', async () => {
    const items = [{ heading: '[Student 1]', text: 'Set a timed written test.' }];
    await expect(checkOnDevice(note, items, vault, () => {})).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers without any model when no item has anything to be checked against', async () => {
    const items = [{ heading: 'Whole class', text: 'Start with a quiet reading task.' }];
    const checks = await checkOnDevice(note, items, vault, () => {});
    expect(checks.map((c) => c.verdict)).toEqual(['nothing withheld']);
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
