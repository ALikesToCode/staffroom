import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractScannedClassList, NOTEBOOK_PROMPT, transcribeNotebookOnDevice } from './notebook';

describe('on-device multimodal notebook scanner', () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('the network must not be used')));

  beforeEach(() => {
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to scan an image when no on-device model is present and makes 0 fetch calls', async () => {
    await expect(transcribeNotebookOnDevice({ mimeType: 'image/jpeg', data: 'AAAA' })).rejects.toThrow(/no on-device model/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty image payload cleanly without calling the network', async () => {
    await expect(transcribeNotebookOnDevice({ mimeType: 'image/jpeg', data: '' })).rejects.toThrow(/No image data/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(NOTEBOOK_PROMPT).toContain('verbatim');
  });

  it('extracts likely pupil names from raw scanned text while filtering places, adult roles, headers, and duplicates', () => {
    const sampleOcr = [
      'Subject: English',
      'Topic: Describing a place',
      'Class IV B weekly note',
      'Aarav Sharma has been unwell and missed four days. Ask Dr. Rao or Sunita Verma (mother) after school.',
      'Diya Sharma misses Tuesday from Chennai to Delhi.',
      'Kabir and Ishaan talk beside each other; Meenal speaks Hindi at home.',
      'Aarav needs clear board steps.',
    ].join('\n');
    expect(extractScannedClassList(sampleOcr)).toEqual(['Aarav Sharma', 'Diya Sharma', 'Kabir', 'Ishaan', 'Meenal']);
  });

  it('excludes phone and contact labels from extracted class lists on the sample notebook transcription', () => {
    const samplePage = [
      'Class 6B - 16 Nov',
      'Diya Sharma takes the 3:40 bus to Chandpur right after the final period.',
      'Her mother cooks in two homes and has not paid the term fee yet.',
      'Meenal Joshi freezes in written tests. Roll no. 6B/23.',
      'Phone: 98112 34560',
    ].join('\n');
    expect(extractScannedClassList(samplePage)).toEqual(['Diya Sharma', 'Meenal Joshi']);
  });
});
