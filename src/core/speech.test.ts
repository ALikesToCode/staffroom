import { describe, expect, it } from 'vitest';
import { pickVoice, speechTag } from './speech';

describe('reading aloud', () => {
  const voices = [
    { name: 'net-hi', lang: 'hi-IN', localService: false },
    { name: 'en', lang: 'en_GB', localService: true },
    { name: 'hi', lang: 'hi-IN', localService: true },
    { name: 'hil', lang: 'hil', localService: true },
  ];
  it('knows a language by name, and English when none is given', () => {
    expect(speechTag('')).toBe('en');
    expect(speechTag(' Hindi ')).toBe('hi');
    expect(speechTag('Klingon')).toBeUndefined();
  });
  it('picks only a voice that runs on the device and speaks the language', () => {
    expect(pickVoice(voices, '')?.name).toBe('en');
    expect(pickVoice(voices, 'Hindi')?.name).toBe('hi');
    expect(pickVoice(voices.slice(0, 2), 'Hindi')).toBeUndefined();
    expect(pickVoice(voices, 'Marathi')).toBeUndefined();
    expect(pickVoice(voices, 'Klingon')).toBeUndefined();
    expect(pickVoice([], '')).toBeUndefined();
  });
});
