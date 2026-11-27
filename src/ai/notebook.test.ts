import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTEBOOK_PROMPT, transcribeNotebookOnDevice } from './notebook';

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
});
