import { useState } from 'react';
import type { Violation } from '../core/gate';
import type { Materials } from '../core/materials';
import { CloudText } from './parts';

/** Said over the materials on the device's side. */
export const MATERIALS_NOTE = 'The cloud wrote each version for a need, by its letter. This device put the names over it. No name was sent.';
export const MATERIALS_NOTE_LOCAL = 'This device wrote each version for a need, by its letter, and put the names over it. Nothing was sent.';

/**
 * The materials of a signed lesson, on the device's side: crisp 1-click generation
 * with optional inspection of the anonymous outgoing request; then what came back,
 * with the children's names placed over each version locally.
 */
export function MaterialsCard({
  request,
  stopped,
  busy,
  streamChars = 0,
  fail,
  result,
  issues,
  where,
  onDevice = false,
  namesFor,
  onSend,
  onPrint,
  noPrint,
  activeNeed,
  onHoverNeed,
}: {
  /** The exact text of the request. */
  request: string;
  /** What the exit gate stops in it. */
  stopped: Violation[];
  busy: boolean;
  /** Characters streamed so far while generating materials. */
  streamChars?: number;
  fail: string | null;
  result: Materials | null;
  /** What the return gate found in the reply. */
  issues: Violation[];
  where: string;
  onDevice?: boolean;
  /** Whose a need is. Known on this device only. */
  namesFor: (letter: string) => string[];
  onSend: () => void;
  /** Absent: the materials cannot be printed here (the lesson is not signed yet, or this is a replay). */
  onPrint?: (withNames: boolean) => void;
  /** Said under the materials when they cannot be printed. */
  noPrint?: string;
  activeNeed?: string | null;
  onHoverNeed?: (letter: string | null) => void;
}) {
  const [replyRead, setReplyRead] = useState(false);
  const [withNames, setWithNames] = useState(false);
  if (result) {
    return (
      <article className="card materials">
        <div className="card-head">
          <h3>Worksheets &amp; board work</h3>
          <code className="model-tag">{where}</code>
        </div>
        <p className="hint">{onDevice ? MATERIALS_NOTE_LOCAL : MATERIALS_NOTE}</p>
        {issues.length > 0 && (
          <div className="caution" role="alert">
            <p>The return gate found something in the materials. Read them before you print.</p>
            <ul>
              {issues.map((v, i) => (
                <li key={i}>
                  “{v.what}”: {v.why}
                </li>
              ))}
            </ul>
            <label className="read-it">
              <input type="checkbox" checked={replyRead} onChange={(e) => setReplyRead(e.target.checked)} />I have read the materials.
            </label>
          </div>
        )}
        <h4>On the board</h4>
        <ul className="board-work">
          {result.board.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <h4>Practice sheet for the class</h4>
        <ol className="sheet">
          {result.sheet.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
        {result.versions.length > 0 && <h4>A sheet for each need</h4>}
        {result.versions.map((v) => (
          <div
            className={activeNeed === v.need ? 'version is-traced' : 'version'}
            key={v.need}
            tabIndex={onHoverNeed ? 0 : undefined}
            onMouseEnter={() => onHoverNeed?.(v.need)}
            onMouseLeave={() => onHoverNeed?.(null)}
            onFocus={() => onHoverNeed?.(v.need)}
            onBlur={() => onHoverNeed?.(null)}
          >
            <p>
              <b>Sheet for Need {v.need}</b>
              {namesFor(v.need).map((n) => (
                <span className="names" key={n}>
                  {n}
                </span>
              ))}
            </p>
            {v.items.length > 0 ? (
              <>
                {v.note && <p className="hint">For you: {v.note}</p>}
                <ol className="sheet">
                  {v.items.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ol>
              </>
            ) : (
              v.note && <p>{v.note}</p>
            )}
          </div>
        ))}
        {result.same.length > 0 && (
          <p className="hint">
            The class sheet as it is, {onDevice ? 'the on-device draft' : 'the cloud'} says, for {result.same.map((l) => `Need ${l}${namesFor(l).length > 0 ? ` (${namesFor(l).join(', ')})` : ''}`).join('; ')}.
          </p>
        )}
        {result.missing.length > 0 && (
          <p className="caution">
            {onDevice ? 'The on-device model' : 'The cloud'} wrote no sheet with lines on it for {result.missing.map((l) => `Need ${l}${namesFor(l).length > 0 ? ` (${namesFor(l).join(', ')})` : ''}`).join('; ')}. Decide yourself what such a pupil does.
          </p>
        )}
        {result.dropped > 0 && (
          <p className="hint">
            {result.dropped} {result.dropped === 1 ? 'version was' : 'versions were'} for a need you did not tell the cloud, or a second for one need, so {result.dropped === 1 ? 'it is' : 'they are'} left out.
          </p>
        )}
        <h4>Exit ticket</h4>
        <ol className="sheet">
          {result.ticket.map((t, i) => (
            <li key={i}>
              {t.question} <span className="answer">Answer: {t.answer}</span>
            </li>
          ))}
        </ol>
        {onPrint ? (
          <>
            <div className="actions">
              <button className="secondary" disabled={issues.length > 0 && !replyRead} onClick={() => onPrint(withNames)}>
                {withNames ? 'Print materials (with names)' : 'Print materials (letter codes only)'}
              </button>
              <label className="read-it">
                <input type="checkbox" checked={withNames} onChange={(e) => setWithNames(e.target.checked)} />
                Include pupil names on printout (private teacher copy)
              </label>
            </div>
            <p className="hint">
              {withNames
                ? 'Prints the class sheet, a named sheet for each need for you to hand out, the exit ticket and your answer key. Keep this copy private.'
                : 'Prints letter codes only (no pupil names) — safe for a shared school printer — along with the class sheet, exit ticket and answer key.'}
            </p>
          </>
        ) : (
          noPrint && <p className="hint">{noPrint}</p>
        )}
      </article>
    );
  }
  return (
    <article className="card materials">
      <div className="card-head">
        <h3>Worksheets &amp; board work</h3>
        <span className={stopped.length === 0 ? 'gate pass' : 'gate stop'}>
          {stopped.length === 0 ? (
            <>
              <span>No names or numbers found</span>
              <code className="gate-tag">Exit gate: clear</code>
            </>
          ) : (
            <>
              <span>{stopped.length} blocked</span>
              <code className="gate-tag">Exit gate: {stopped.length} stopped</code>
            </>
          )}
        </span>
      </div>
      <div className="actions">
        <button className="primary big" disabled={busy || stopped.length > 0} onClick={onSend}>
          {busy ? (
            streamChars > 0 ? (
              `Writing worksheets (${streamChars} chars)…`
            ) : (
              'Writing board work & worksheets…'
            )
          ) : (
            <>
              Make board work &amp; worksheets
              <span className="btn-hi" aria-hidden="true">
                बोर्ड और वर्कशीट बनाएँ
              </span>
            </>
          )}
        </button>
        <span className="hint">Board work, a class worksheet, a catch-up sheet for each need, and an exit ticket — using letters only, no names.</span>
      </div>
      {stopped.length > 0 && (
        <div className="caution" role="alert">
          <p>The exit gate stopped this text. Nothing will be sent.</p>
          <ul>
            {stopped.map((v, i) => (
              <li key={i}>
                “{v.what}”: {v.why}
              </li>
            ))}
          </ul>
        </div>
      )}
      {fail && (
        <p className="caution" role="alert">
          {fail}
        </p>
      )}
      <details className="materials-inspect">
        <summary>Inspect exact outgoing text (no names · {request.length.toLocaleString()} chars)</summary>
        <pre className="wire">
          <CloudText text={request} activeNeed={activeNeed} onHoverNeed={onHoverNeed} />
        </pre>
      </details>
    </article>
  );
}

/** The materials as the cloud returned them: letters only. */
export function MaterialsWire({
  result,
  activeNeed,
  onHoverNeed,
}: {
  result: Materials;
  activeNeed?: string | null;
  onHoverNeed?: (letter: string | null) => void;
}) {
  return (
    <div className="wire reply">
      <p>
        <b>Board</b>
        {result.board.map((l, i) => (
          <span key={i}>
            <br />
            {l}
          </span>
        ))}
      </p>
      <p>
        <b>Sheet</b>
        {result.sheet.map((l, i) => (
          <span key={i}>
            <br />
            {i + 1}. {l}
          </span>
        ))}
      </p>
      {result.versions.map((v) => (
        <p
          key={v.need}
          className={activeNeed === v.need ? 'need-wire-line is-active' : onHoverNeed ? 'need-wire-line' : undefined}
          tabIndex={onHoverNeed ? 0 : undefined}
          onMouseEnter={() => onHoverNeed?.(v.need)}
          onMouseLeave={() => onHoverNeed?.(null)}
          onFocus={() => onHoverNeed?.(v.need)}
          onBlur={() => onHoverNeed?.(null)}
        >
          <b>Sheet for Need {v.need}</b>
          {v.note && (
            <>
              <br />
              {v.note}
            </>
          )}
          {v.items.map((l, i) => (
            <span key={i}>
              <br />
              {i + 1}. {l}
            </span>
          ))}
        </p>
      ))}
      <p>
        <b>Exit ticket</b>
        {result.ticket.map((t, i) => (
          <span key={i}>
            <br />
            {i + 1}. {t.question} ({t.answer})
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * The pages of the materials, as they are printed. Each need's sheet is a
 * page of its own with its lines numbered. Names stand over it only on the
 * teacher's own print, and only if asked; the class sheet has none. What
 * the cloud wrote for the teacher about a sheet is on the teacher's copy,
 * not on the page a pupil is handed.
 */
export function MaterialsPages({ title, result, namesFor, withNames }: { title: string; result: Materials; namesFor: (letter: string) => string[]; withNames: boolean }) {
  return (
    <>
      <div className="print-page">
        <h1>{title}</h1>
        <h2>Practice sheet</h2>
        <ol>
          {result.sheet.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
      </div>
      {result.versions.map((v) => {
        const names = withNames ? namesFor(v.need) : [];
        return (
          <div className="print-page" key={v.need}>
            {names.length > 0 && <p className="print-names">{names.join(', ')}</p>}
            <h1>Sheet for Need {v.need}</h1>
            <h2>{title}</h2>
            {v.items.length > 0 ? (
              <ol>
                {v.items.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            ) : (
              // A version kept before the lines were asked for says how to do the class sheet.
              <>
                <p>{v.note}</p>
                <ol>
                  {result.sheet.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </>
            )}
          </div>
        );
      })}
      <div className="print-page">
        <h1>Exit ticket</h1>
        <ol>
          {result.ticket.map((t, i) => (
            <li key={i}>{t.question}</li>
          ))}
        </ol>
      </div>
      <div className="print-page">
        <h1>Teacher's copy: answer key and board work</h1>
        <h2>Exit ticket</h2>
        <ol>
          {result.ticket.map((t, i) => (
            <li key={i}>
              {t.question} {t.answer}
            </li>
          ))}
        </ol>
        <h2>On the board</h2>
        {result.board.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        {result.versions.some((v) => v.note && v.items.length > 0) && <h2>The sheets for needs</h2>}
        {result.versions
          .filter((v) => v.note && v.items.length > 0)
          .map((v) => {
            const names = withNames ? namesFor(v.need) : [];
            return (
              <p key={v.need}>
                Need {v.need}
                {names.length > 0 ? ` (${names.join(', ')})` : ''}: {v.note}
              </p>
            );
          })}
      </div>
    </>
  );
}
