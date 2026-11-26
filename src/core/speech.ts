// Reading aloud uses the browser's own speech, on this device. A voice is chosen only if the browser says it
// runs locally and it speaks the language of the text; with no such voice the control is not shown at all.

const TAGS: Record<string, string> = {
  english: 'en',
  hindi: 'hi',
  marathi: 'mr',
  bengali: 'bn',
  bangla: 'bn',
  tamil: 'ta',
  telugu: 'te',
  gujarati: 'gu',
  kannada: 'kn',
  malayalam: 'ml',
  punjabi: 'pa',
  urdu: 'ur',
  odia: 'or',
  nepali: 'ne',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  portuguese: 'pt',
  arabic: 'ar',
};

/** The language tag of a language written by name. Empty is English. Undefined: a language this list does not know, so no voice is chosen for it. */
export const speechTag = (language: string): string | undefined => TAGS[(language.trim() || 'English').toLowerCase()];

export interface VoiceLike {
  lang: string;
  localService: boolean;
}

/** A voice of the browser that runs on the device and speaks the language. Undefined: there is none, and nothing is read aloud. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], language: string): V | undefined {
  const tag = speechTag(language);
  if (!tag) return undefined;
  const speaks = (v: V) => {
    const l = v.lang.toLowerCase().replace('_', '-');
    return l === tag || l.startsWith(`${tag}-`);
  };
  return voices.find((v) => v.localService && speaks(v));
}
