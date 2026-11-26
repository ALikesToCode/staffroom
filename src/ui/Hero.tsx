/** The promise, said once: on the first screen, and beside the name after it. */
export const PROMISE = 'Your device knows why. The cloud only knows what.';

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
}: {
  onTry: () => void;
  onWrite: () => void;
  /** Absent when there is no recorded run to watch. */
  onWatch?: () => void;
  /** True when this browser has no on-device model. */
  noModel: boolean;
}) {
  return (
    <main className="hero">
      <div className="hero-say">
        <h2>
          <span>Your device knows why.</span> <span>The cloud only knows what.</span>
        </h2>
        <p className="hero-sub">
          Plan tomorrow's lesson for the whole class. Your device fits it to each child, using what only you know.
        </p>
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
        {noModel && (
          <p className="hint hero-mode">
            This browser has no on-device model, so the guard and the check run by rule here. The cloud draft works the same.
          </p>
        )}
      </div>

      <figure className="hero-lanes" aria-label="An example from the invented class">
        <div className="mini device">
          <span className="mini-title">On this device</span>
          <p className="mini-note">
            <mark className="k-student held">Tanvi</mark>'s family <mark className="k-private held">does not have a smartphone or an internet connection</mark>.
          </p>
          <p className="mini-catch">
            <b>Homework needs fitting for 1 child</b>
            <span>Tanvi: gets two printed pictures to write from.</span>
          </p>
        </div>
        <div className="mini-door" aria-hidden="true">
          <span>the door</span>
        </div>
        <div className="mini cloud">
          <span className="mini-title">The cloud</span>
          <p className="mini-wire">
            <span className="bar">[Student 5]</span>'s family <span className="bar">[withheld]</span>. Lesson: English, describing a place.
          </p>
          <p className="mini-wire reply">Homework: find two pictures of a place online and write three sentences.</p>
        </div>
        <figcaption>An example. All data in the sample is invented.</figcaption>
      </figure>
    </main>
  );
}
