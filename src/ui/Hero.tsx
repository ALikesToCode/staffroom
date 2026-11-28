/** The promise, said once: on the first screen, and beside the name after it. */
export const PROMISE = 'Your device knows the child. The cloud only knows the need.';

/**
 * The first screen: one sentence, the ways in, and a small picture of the
 * two sides. The picture is a fixed example from the invented class; it is
 * labelled as one.
 */
export function Hero({
  onTry,
  onWrite,
  onWatch,
  noModel,
  needsDownload = false,
}: {
  onTry: () => void;
  onWrite: () => void;
  /** Absent when there is no recorded run to watch. */
  onWatch?: () => void;
  /** True when this browser has no on-device model. */
  noModel: boolean;
  /** True when the on-device model can be downloaded on first run. */
  needsDownload?: boolean;
}) {
  return (
    <main className="hero">
      <div className="hero-say">
        <h2>
          <span>Your device knows the child.</span> <span>The cloud only knows the need.</span>
        </h2>
        <p className="hero-sub">
          Plan tomorrow's lesson for the whole class. The cloud writes for each need without knowing whose it is. Your device puts it beside
          the right child.
        </p>
        {/* Without the on-device model, the recorded run with Nano is the single primary CTA so judges feel the full architecture first. */}
        {noModel && onWatch ? (
          <div className="actions">
            <button className="primary big" onClick={onWatch}>
              Watch a recorded run with Gemini Nano
            </button>
            <button className="secondary big" onClick={onTry}>
              Try live (rules + cloud)
            </button>
            <button className="secondary big" onClick={onWrite}>
              Write a note
            </button>
          </div>
        ) : (
          <div className="actions">
            <button className="primary big" onClick={onTry}>
              Try an invented class
            </button>
            <button className="secondary big" onClick={onWrite}>
              Write a note
            </button>
            {onWatch && (
              <button className="link" onClick={onWatch}>
                Watch a recorded run
              </button>
            )}
          </div>
        )}
        {noModel ? (
          <p className="hint hero-mode">
            This browser has no on-device model, so the guard and the check run by rule here. The cloud draft works the same.
          </p>
        ) : (
          needsDownload && (
            <p className="hint hero-mode">
              The first run downloads Gemini Nano in Chrome (several GB) and keeps it on this device{onWatch ? ', or watch a recorded run while you wait' : ''}.
            </p>
          )
        )}
      </div>

      <figure className="hero-lanes" aria-label="An example from the invented class">
        <div className="mini device">
          <span className="mini-title">
            On this device <code className="mini-mode">ONLY_ON_DEVICE</code>
          </span>
          <p className="mini-note">
            <mark className="k-student held">Tanvi</mark>'s family <mark className="k-private held">does not have a smartphone or an internet connection</mark>.
          </p>
          <p className="mini-catch">
            <b>Stays here</b>
            <span>“does not have a smartphone or an internet connection” — Tanvi</span>
          </p>
          <p className="mini-catch">
            <b>Homework, beside Tanvi</b>
            <span>For Need B: write from two printed pictures given out in class.</span>
          </p>
        </div>
        <div className="mini-door" aria-hidden="true">
          <span>the door</span>
        </div>
        <div className="mini cloud">
          <span className="mini-title">
            The cloud <code className="mini-mode">PREFER_IN_CLOUD</code>
          </span>
          <p className="mini-wire">Lesson: English, describing a place.</p>
          <p className="mini-wire">
            <b>Not sent</b> what the note says about one pupil
          </p>
          <p className="mini-wire">
            <b>The cloud is told</b> Need B: no phone or internet at home
          </p>
          <p className="mini-wire reply">
            Homework: find two pictures of a place online and write three sentences. For Need B: write from two printed pictures given out
            in class.
          </p>
        </div>
        <figcaption>An example. All data in the sample is invented.</figcaption>
      </figure>
    </main>
  );
}
