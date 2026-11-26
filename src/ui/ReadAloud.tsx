import { useEffect, useState } from 'react';
import { pickVoice } from '../core/speech';

/**
 * "Read aloud on this device": the browser's own speech, with a voice the
 * browser says runs locally and that speaks the language of the text. The
 * app makes no request for it. With no speech in the browser, or no such
 * voice, nothing is shown.
 */
export function ReadAloud({ text, language }: { text: string; language: string }) {
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
  const [voice, setVoice] = useState<SpeechSynthesisVoice | undefined>(undefined);
  const [state, setState] = useState<'idle' | 'speaking' | 'paused'>('idle');
  useEffect(() => {
    if (!synth) return;
    const load = () => setVoice(pickVoice(synth.getVoices(), language));
    load();
    synth.addEventListener('voiceschanged', load);
    return () => {
      synth.removeEventListener('voiceschanged', load);
      synth.cancel();
    };
  }, [synth, language]);
  if (!synth || !voice || !text.trim()) return null;
  const speak = () => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.onend = () => setState('idle');
    u.onerror = () => setState('idle');
    setState('speaking');
    synth.speak(u);
  };
  return (
    <span className="read-aloud">
      {state === 'idle' ? (
        <button className="secondary small" onClick={speak}>
          Read aloud on this device
        </button>
      ) : (
        <>
          <button
            className="secondary small"
            onClick={() => {
              if (state === 'speaking') {
                synth.pause();
                setState('paused');
              } else {
                synth.resume();
                setState('speaking');
              }
            }}
          >
            {state === 'speaking' ? 'Pause' : 'Go on'}
          </button>
          <button
            className="link"
            onClick={() => {
              synth.cancel();
              setState('idle');
            }}
          >
            Stop
          </button>
        </>
      )}
    </span>
  );
}
