import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVault } from '../core/vault';
import { splitVariations } from '../core/lessonNeeds';
import { checkOnDevice } from './check';
import { constraintsOnDevice } from './constraints';
import { isRecoveredDraftValid, labelReceipt, normalizeOfflineNeeds, offlineLessonPrompt, streamContent } from './draft';
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
    const lesson = { klass: 'Class 6', subject: 'English', topic: 'Describing a place' };
    expect(
      await labelReceipt('Class 6 — English — Describing a place', 'Support plan for next week', undefined, {
        payload: { kind: 'label', lesson },
        entities: [],
        classList: [],
      }),
    ).toEqual({
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

  it('uses fallbackPrompt on local recovery and formats compact offline lesson prompts', async () => {
    const cloudErr = new Error('offline');
    const rejectedCloud = Promise.reject(cloudErr);
    rejectedCloud.catch(() => {});
    const seenPrompts: string[] = [];
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
    const localOk = {
      generateContentStream: async (p: string) => {
        seenPrompts.push(p);
        return {
          stream: {
            async *[Symbol.asyncIterator]() {
              yield { text: () => '{"title":"Plan","items":[{"heading":"Starter","text":"Read aloud."}]}' };
            },
          },
          response: Promise.resolve({
            text: () => '{"title":"Plan","items":[{"heading":"Starter","text":"Read aloud."}]}',
            inferenceSource: 'on_device',
          }),
        };
      },
    } as unknown as Parameters<typeof streamContent>[0];

    const compact = offlineLessonPrompt(
      [
        'Class notes here.',
        '',
        'Needs in this class (no names and no reasons are given; a need may be one pupil’s or several):',
        'Need A: has missed lessons',
        'Need E: away on Tuesdays',
        'Under "For each need", give an entry for every one of these letters: A, E.',
        '',
        'Lesson',
        'Subject: English',
        'Topic: Describing a Place',
        'Length: 40 minutes',
      ].join('\n'),
    );
    expect(compact).not.toMatch(/\[Student/i);
    expect(compact).toContain('NEVER use square brackets anywhere');
    expect(compact).toContain('Topic: Describing a Place');
    expect(compact).toContain('Class notes:\nClass notes here.');
    expect(compact).toContain('In adjustments, give one concrete teacher action starting with a verb');
    expect(compact).toContain('A = has missed lessons');
    expect(compact).toContain('E = away on Tuesdays');
    expect(compact).toContain('Include all 2 letters: A, E.');

    const res = await streamContent(cloudBroken, 'long cloud prompt', undefined, () => localOk, undefined, compact);
    expect(res.onDevice).toBe(true);
    expect(seenPrompts).toEqual([compact]);
  });

  it('normalizes structured offline adjustments, routes stage "none" concrete actions to stages, and drops verbatim echoes', () => {
    const structuredDraft = {
      title: 'Class 6 English — Describing a Place',
      items: [
        { heading: 'Starter (5 minutes)', text: 'Share favorite place words.' },
        { heading: 'Teach (10 minutes)', text: 'Explain sensory details.' },
        { heading: 'Practise (15 minutes)', text: 'Guide pairs to write a paragraph.' },
        { heading: 'Homework (10 minutes)', text: 'Assign a short place description at home.' },
      ],
      adjustments: [
        { letter: 'A', stage: 'none', action: 'Remind students that assignments must be completed before the end of the school day.' },
        { letter: 'Need B', stage: 'Practise', action: 'Need B: Encourage students to write without online dictionaries.' },
        { letter: 'E', stage: 'none', action: 'If a student is absent on Tuesdays, provide a written description task for them upon their return.' },
        { letter: 'F', stage: 'Teach', action: 'This lesson already suits this need.' },
        { letter: 'G', stage: 'Practise', action: 'finishes early and needs more to do' },
      ],
    };
    const inputNeeds = new Map([
      ['A', 'cannot stay after the last bell'],
      ['B', 'no phone or internet at home'],
      ['E', 'away on Tuesdays'],
      ['F', 'finds written tests hard; can answer aloud'],
      ['G', 'finishes early and needs more to do'],
    ]);
    const normalized = normalizeOfflineNeeds(structuredDraft, ['A', 'B', 'E', 'F', 'G'], inputNeeds);
    expect('adjustments' in normalized).toBe(false);
    const split = splitVariations(normalized, ['A', 'B', 'E', 'F', 'G']);
    expect(split.missing).toEqual(['G']);
    expect(split.none).toEqual(['F']);
    expect(split.dropped).toBe(0);
    expect(split.variations.find((v) => v.need === 'A')?.itemIndex).toBe(3); // Homework
    expect(split.variations.find((v) => v.need === 'B')?.itemIndex).toBe(2); // Practise
    expect(split.variations.find((v) => v.need === 'B')?.text).toBe('Encourage students to write without online dictionaries.');
    expect(split.variations.find((v) => v.need === 'E')?.itemIndex).toBe(3); // Homework
  });

  it('normalizes mixed colon/pipe offline Need lines, rejects verbatim need echoes, and leaves pure pipe drafts intact', () => {
    const colonDraft = {
      title: 'Class 6 English — Describing a Place',
      items: [
        { heading: 'Starter (5 minutes)', text: 'Share sensory words.' },
        { heading: 'Teach (10 minutes)', text: 'Model two sentences on the board.' },
        { heading: 'Practise (15 minutes)', text: 'Pairs write four sentences.' },
        { heading: 'Homework (10 minutes)', text: 'Add one sound detail.' },
        {
          heading: 'For each need',
          text: [
            'Need A: Let the pupil leave on time and hand in work the next morning.',
            'Need B | Practise | Print the picture cards instead of asking for phone photos.',
            'Need C: Explain the starter orally in pairs.',
            'Need D: Give one extra extension prompt on the board.',
            'Need E: This lesson already suits this need.',
            'Need G: finishes early and needs more to do',
          ].join('\n'),
        },
      ],
    };
    const inputNeeds = new Map([
      ['A', 'cannot stay after the last bell'],
      ['B', 'no phone or internet at home'],
      ['C', 'cannot buy materials'],
      ['D', 'needs extra challenge'],
      ['E', 'away on Tuesdays'],
      ['G', 'finishes early and needs more to do'],
    ]);
    const normalized = normalizeOfflineNeeds(colonDraft, ['A', 'B', 'C', 'D', 'E', 'G'], inputNeeds);
    const split = splitVariations(normalized, ['A', 'B', 'C', 'D', 'E', 'G']);
    expect(split.missing).toEqual(['G']); // echoed Need G dropped cleanly instead of inflated
    expect(split.dropped).toBe(0);
    expect(split.none).toEqual(['E']);
    expect(split.variations.find((v) => v.need === 'A')?.itemIndex).toBe(3); // Homework
    expect(split.variations.find((v) => v.need === 'B')?.itemIndex).toBe(2); // Practise (preserved pipe entry)
    expect(split.variations.find((v) => v.need === 'C')?.itemIndex).toBe(0); // Starter
    expect(split.variations.find((v) => v.need === 'D')?.itemIndex).toBe(1); // Teach

    const pipeDraft = {
      title: 'Plan',
      items: [
        { heading: 'Starter', text: 'Go.' },
        { heading: 'For each need', text: 'Need A | Starter | Keep it brief.' },
      ],
    };
    expect(normalizeOfflineNeeds(pipeDraft, ['A'])).toBe(pipeDraft);
  });

  it('retries with fallbackPrompt and fails closed if recovered fallback still violates validateRecovered', async () => {
    const internalOnDevice = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { text: () => '{"title":"Plan","items":[{"heading":"Starter [Student 1]","text":"Poor"}]}' };
          },
        },
        response: Promise.resolve({
          text: () => '{"title":"Plan","items":[{"heading":"Starter [Student 1]","text":"Poor"}]}',
          inferenceSource: 'on_device',
        }),
      }),
    } as unknown as Parameters<typeof streamContent>[0];
    const seenFallback: string[] = [];
    const dedicatedLocal = {
      generateContentStream: async (p: string) => {
        seenFallback.push(p);
        return {
          stream: {
            async *[Symbol.asyncIterator]() {
              yield { text: () => '{"title":"Clean","items":[{"heading":"Starter","text":"Whole class."}]}' };
            },
          },
          response: Promise.resolve({
            text: () => '{"title":"Clean","items":[{"heading":"Starter","text":"Whole class."}]}',
            inferenceSource: 'on_device',
          }),
        };
      },
    } as unknown as Parameters<typeof streamContent>[0];

    const res = await streamContent(
      internalOnDevice,
      'long cloud prompt with [Student 1]',
      undefined,
      () => dedicatedLocal,
      (t, fromDevice) => !(fromDevice && /\[Student\s+\d+\]/i.test(t)),
      'compact bracket-free prompt',
    );
    expect(res.onDevice).toBe(true);
    expect(JSON.parse(res.text).title).toBe('Clean');
    expect(seenFallback).toEqual(['compact bracket-free prompt']);

    const badLocal = {
      generateContentStream: async () => ({
        stream: { async *[Symbol.asyncIterator]() {} },
        response: Promise.resolve({
          text: () => '{"title":"Still bad [Student 1]","items":[{"heading":"Starter","text":"x"}]}',
          inferenceSource: 'on_device',
        }),
      }),
    } as unknown as Parameters<typeof streamContent>[0];
    await expect(
      streamContent(
        internalOnDevice,
        'prompt',
        undefined,
        () => badLocal,
        (t, fromDevice) => !(fromDevice && /\[Student\s+\d+\]/i.test(t)),
        'compact',
        (t) => !/\[Student\s+\d+\]/i.test(t),
      ),
    ).rejects.toThrow(/fallback draft ended incomplete/);
  });

  it('keeps non-homework return clauses out of Homework, fires onFallbackStart on mid-stream recovery, and rejects recovered lessons missing over half of needs', async () => {
    const returnDraft = {
      title: 'Class 6 English',
      items: [
        { heading: 'Starter (5 minutes)', text: 'Warm up.' },
        { heading: 'Teach (10 minutes)', text: 'Model.' },
        { heading: 'Practise (15 minutes)', text: 'Read in pairs.' },
        { heading: 'Homework (10 minutes)', text: 'Write three lines at home.' },
      ],
      adjustments: [
        { letter: 'E', stage: 'none', action: 'Let her return to the text with a partner.' },
        { letter: 'H', stage: 'none', action: 'On her return, read in pairs during Practise.' },
      ],
    };
    const normalized = normalizeOfflineNeeds(returnDraft, ['E', 'H']);
    const split = splitVariations(normalized, ['E', 'H']);
    expect(split.variations.map((v) => v.itemIndex)).toEqual([2, 2]); // Practise for both

    const cloudErr = new Error('mid-stream reset');
    const rej = Promise.reject(cloudErr);
    rej.catch(() => {});
    const cloudBroken = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { text: () => '{"title":"Partial' };
            throw cloudErr;
          },
        },
        response: rej,
      }),
    } as unknown as Parameters<typeof streamContent>[0];
    const localOk = {
      generateContentStream: async () => ({
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { text: () => '{"title":"OK","items":[{"heading":"Starter","text":"Read."}]}' };
          },
        },
        response: Promise.resolve({
          text: () => '{"title":"OK","items":[{"heading":"Starter","text":"Read."}]}',
          inferenceSource: 'on_device',
        }),
      }),
    } as unknown as Parameters<typeof streamContent>[0];

    let startedFallback = 0;
    const recovered = await streamContent(
      cloudBroken,
      'prompt',
      undefined,
      () => localOk,
      undefined,
      'compact',
      undefined,
      () => {
        startedFallback++;
      },
    );
    expect(recovered.onDevice).toBe(true);
    expect(startedFallback).toBe(1);

    const tooFewNeeds = JSON.stringify({
      title: 'Plan',
      items: [{ heading: 'Starter', text: 'Go.' }],
      adjustments: [{ letter: 'A', stage: 'Starter', action: 'Check understanding early.' }],
    });
    expect(isRecoveredDraftValid(tooFewNeeds, true, 'Need A: x\nNeed B: y\nNeed C: z\nNeed D: w', ['A', 'B', 'C', 'D'])).toBe(false);
    const halfNeeds = JSON.stringify({
      title: 'Plan',
      items: [{ heading: 'Starter', text: 'Go.' }],
      adjustments: [
        { letter: 'A', stage: 'Starter', action: 'Check understanding early.' },
        { letter: 'B', stage: 'Starter', action: 'Provide printed cards.' },
      ],
    });
    expect(isRecoveredDraftValid(halfNeeds, true, 'Need A: x\nNeed B: y\nNeed C: z\nNeed D: w', ['A', 'B', 'C', 'D'])).toBe(true);

    const inventedStudentBracket = JSON.stringify({
      title: 'Plan [Student 99]',
      items: [{ heading: 'Starter', text: 'Go.' }],
    });
    expect(isRecoveredDraftValid(inventedStudentBracket, true, '[Student 1] reads well.', [])).toBe(false);
  });
});
