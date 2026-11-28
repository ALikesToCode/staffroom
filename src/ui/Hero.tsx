import { useRef } from 'react';

/** The promise, said once: on the first screen, and beside the name after it. */
export const PROMISE = 'Your device knows the child. The cloud only knows the need.';

/**
 * The first screen: one plain promise, photo-first entry, secondary text/demo links,
 * and a simple illustration of what stays on this computer vs what goes to the cloud.
 */
export function Hero({
  onTry,
  onWrite,
  onWatch,
  onPhotoFile,
  noModel,
  needsDownload = false,
}: {
  onTry: () => void;
  onWrite: () => void;
  /** Absent when there is no recorded run to watch. */
  onWatch?: () => void;
  /** Opens a handwritten notebook photo directly from the hero CTA. */
  onPhotoFile?: (file: File) => void;
  /** True when this browser has no on-device model. */
  noModel: boolean;
  /** True when the on-device model can be downloaded on first run. */
  needsDownload?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <main className="hero">
      <div className="hero-say">
        <h2>
          <span>Your device knows the child.</span> <span>The cloud only knows the need.</span>
        </h2>
        <p className="hero-sub">
          Plan tomorrow&apos;s lesson for the whole class. Your computer hides every child&apos;s name and private details before anything goes
          to Google&apos;s Gemini, then puts each child&apos;s line beside the right name.
        </p>

        {noModel ? (
          <div className="actions hero-actions">
            {onWatch ? (
              <button className="primary big" onClick={onWatch}>
                Watch a recorded run with Gemini Nano
                <span className="btn-hi" aria-hidden="true">
                  रिकॉर्डेड डेमो देखें
                </span>
              </button>
            ) : (
              <button className="primary big" onClick={onTry}>
                Try a sample class (rules + cloud)
                <span className="btn-hi" aria-hidden="true">
                  उदाहरण कक्षा आज़माएँ
                </span>
              </button>
            )}
            <div className="hero-links">
              {onWatch && (
                <button className="link" onClick={onTry}>
                  Try a sample class (rules + cloud)
                </button>
              )}
              <button className="link" onClick={onWrite}>
                Type instead
              </button>
            </div>
          </div>
        ) : (
          <div className="actions hero-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPhotoFile?.(file);
                e.target.value = '';
              }}
            />
            <div className="hero-cta-row">
              <button
                className="primary big"
                type="button"
                onClick={() => (onPhotoFile ? fileRef.current?.click() : onWrite())}
              >
                Take a photo of my notebook
                <span className="btn-hi" aria-hidden="true">
                  नोटबुक की फोटो लें
                </span>
              </button>
              {onWatch && (
                <button className="secondary" type="button" onClick={onWatch}>
                  Watch a recorded run
                </button>
              )}
            </div>
            <div className="hero-links">
              <button className="link" type="button" onClick={onWrite}>
                Type instead
              </button>
              <button className="link" type="button" onClick={onTry}>
                Try a sample class
              </button>
            </div>
          </div>
        )}

        {noModel ? (
          <p className="hint hero-mode">
            This browser cannot run the local model, so names and numbers are hidden by rule here. The cloud lesson works the same.
          </p>
        ) : (
          <p className="hint hero-mode">
            Reads clear English or Hinglish handwriting on this computer. Hindi script works best when typed.
            {needsDownload
              ? ` First run downloads Gemini Nano in Chrome (several GB) and keeps it on this computer${onWatch ? ', or watch a recorded run while you wait' : ''}.`
              : ''}
          </p>
        )}
      </div>

      <figure className="hero-lanes" aria-label="An example from the sample class">
        <div className="mini device">
          <span className="mini-title">
            <span>On this computer</span> <code className="mini-mode">ONLY_ON_DEVICE</code>
          </span>
          <p className="mini-note">
            <mark className="k-student held">Tanvi</mark>&apos;s family <mark className="k-private held">does not have a smartphone or an internet connection</mark>.
          </p>
          <p className="mini-catch">
            <b>Stays on this computer</b>
            <span>“does not have a smartphone or an internet connection” — Tanvi</span>
          </p>
          <p className="mini-catch">
            <b>Homework, beside Tanvi</b>
            <span>Need B: write from two printed pictures given out in class.</span>
          </p>
        </div>
        <div className="mini-door" aria-hidden="true">
          <span>the door</span>
        </div>
        <div className="mini cloud">
          <span className="mini-title">
            <span>Sent to the cloud</span> <code className="mini-mode">PREFER_IN_CLOUD</code>
          </span>
          <p className="mini-wire">Lesson: Class 6 English, describing a place.</p>
          <p className="mini-wire">
            <b>Not sent</b> any child&apos;s name or private story
          </p>
          <p className="mini-wire">
            <b>What is sent</b> Need B: no phone or internet at home
          </p>
          <p className="mini-wire reply">
            Homework: describe two pictures of a place in three sentences. For Need B: use printed pictures handed out in class.
          </p>
        </div>
        <figcaption>An example. Every pupil shown is invented.</figcaption>
      </figure>
    </main>
  );
}
