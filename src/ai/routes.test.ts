import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVault } from '../core/vault';
import { checkOnDevice } from './check';
import { constraintsOnDevice } from './constraints';
import { labelReceipt, streamContent } from './draft';
import { guardOnDevice } from './guard';
import { fitForChild, fitStep } from './fit';
import { transcribeNotebookOnDevice } from './notebook';
import { imageOnDeviceStatus, modelFor, onDeviceModelPresent, prepareDevice } from './routes';

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

  it('refuses to build a scan, guard, check, or fit model', () => {
    expect(() => modelFor('scan', { system: 'x', multimodal: 'image' })).toThrow(/Nothing was sent/);
    expect(() => modelFor('guard', { system: 'x' })).toThrow(/Nothing was sent/);
    expect(() => modelFor('check', { system: 'x' })).toThrow(/Nothing was sent/);
    expect(() => modelFor('fit', { system: 'x' })).toThrow(/Nothing was sent/);
  });

  it('rejects notebook scanning without a request', async () => {
    expect(await imageOnDeviceStatus()).toBe('unsupported');
    await expect(transcribeNotebookOnDevice({ mimeType: 'image/jpeg', data: 'AAAA' })).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it('recovers mid-stream network failure via on-device fallback and resets partial chunks', async () => {
    const err = new Error('network dropped mid-stream');
    const rejectedResponse = Promise.reject(err);
    rejectedResponse.catch(() => {});
    const cloudBroken = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { text: () => '{"title":"Partial' };
            throw err;
          },
        },
        response: rejectedResponse,
      }),
    } as unknown as Parameters<typeof streamContent>[0];
    const localDevice = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { text: () => '{"title":"Full"' };
          },
        },
        response: Promise.resolve({ text: () => '{"title":"Full"}', inferenceSource: 'on_device' }),
      }),
    } as unknown as Parameters<typeof streamContent>[0];

    const seen: string[] = [];
    const res = await streamContent(cloudBroken, 'prompt', (c) => seen.push(c), () => localDevice);
    expect(res).toEqual({ text: '{"title":"Full"}', onDevice: true });
    expect(seen).toEqual(['{"title":"Partial', '', '{"title":"Full"', '{"title":"Full"}']);
  });

  it('recovers silently truncated cloud JSON via on-device fallback when validation fails', async () => {
    const truncatedCloud = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { text: () => '{"title":"Truncated' };
          },
        },
        response: Promise.resolve({ text: () => '{"title":"Truncated', inferenceSource: 'in_cloud' }),
      }),
    } as unknown as Parameters<typeof streamContent>[0];
    const localDevice = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { text: () => '{"title":"Valid","items":[{"heading":"Starter","text":"Ok."}]}' };
          },
        },
        response: Promise.resolve({ text: () => '{"title":"Valid","items":[{"heading":"Starter","text":"Ok."}]}', inferenceSource: 'on_device' }),
      }),
    } as unknown as Parameters<typeof streamContent>[0];

    const seen: string[] = [];
    const res = await streamContent(
      truncatedCloud,
      'prompt',
      (c) => seen.push(c),
      () => localDevice,
      (t) => {
        try {
          const parsed = JSON.parse(t) as { items?: unknown[] };
          return Array.isArray(parsed.items) && parsed.items.length > 0;
        } catch {
          return false;
        }
      },
    );
    expect(res.onDevice).toBe(true);
    expect(seen[0]).toBe('{"title":"Truncated');
    expect(seen[1]).toBe('');
    expect(JSON.parse(res.text).title).toBe('Valid');
  });

  it('rethrows the original cloud error when the local fallback fails (e.g. model not downloaded)', async () => {
    const cloudErr = new Error('HTTP 429 rate limited');
    const rejectedCloud = Promise.reject(cloudErr);
    rejectedCloud.catch(() => {});
    const cloudBroken = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            throw cloudErr;
          },
        },
        response: rejectedCloud,
      }),
    } as unknown as Parameters<typeof streamContent>[0];
    const brokenLocal = {
      generateContentStream: async () => {
        throw new Error('LanguageModel unavailable');
      },
    } as unknown as Parameters<typeof streamContent>[0];

    await expect(streamContent(cloudBroken, 'prompt', undefined, () => brokenLocal)).rejects.toThrow('HTTP 429 rate limited');
  });

  it('rejects if fallback reports an unexpected non-device inferenceSource', async () => {
    const cloudErr = new Error('cloud timeout');
    const rejectedCloud = Promise.reject(cloudErr);
    rejectedCloud.catch(() => {});
    const cloudBroken = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            throw cloudErr;
          },
        },
        response: rejectedCloud,
      }),
    } as unknown as Parameters<typeof streamContent>[0];
    const spoofedLocal = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { text: () => '{"title":"X"}' };
          },
        },
        response: Promise.resolve({ text: () => '{"title":"X"}', inferenceSource: 'in_cloud' }),
      }),
    } as unknown as Parameters<typeof streamContent>[0];

    await expect(streamContent(cloudBroken, 'prompt', undefined, () => spoofedLocal)).rejects.toThrow('did not run on the device');
  });
});
