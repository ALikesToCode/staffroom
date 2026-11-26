import { useState } from 'react';
import type { Violation } from '../core/gate';
import type { Materials } from '../core/materials';

/** Said over the materials on the device's side. */
export const MATERIALS_NOTE = 'The cloud wrote each version for a need, by its letter. This device put the names over it. No name was sent.';

/**
 * The materials of a signed lesson, on the device's side: the request as
 * it will be sent, read and ticked before it goes; then what came back,
 * with the children's names over each version for a need.
 */
export function MaterialsCard({
  request,
  stopped,
  busy,
  fail,
  result,
  issues,
  where,
  namesFor,
  onSend,
  onPrint,
}: {
  /** The exact text of the request. */
  request: string;
  /** What the exit gate stops in it. */
  stopped: Violation[];
  busy: boolean;
  fail: string | null;
  result: Materials | null;
  /** What the return gate found in the reply. */
  issues: Violation[];
  where: string;
  /** Whose a need is. Known on this device only. */
  namesFor: (letter: string) => string[];
  onSend: () => void;
  onPrint: (withNames: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [read, setRead] = useState(false);
  const [replyRead, setReplyRead] = useState(false);
  const [noNames, setNoNames] = useState(false);
  if (result) {
    return (
      <article className="card materials">
        <div className="card-head">
          <h3>Materials for this lesson</h3>
          <span className="hint">{where}</span>
        </div>
        <p className="hint">{MATERIALS_NOTE}</p>
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
        {result.versions.length > 0 && <h4>The sheet, for a need</h4>}
        {result.versions.map((v) => (
          <div className="version" key={v.need}>
            <p>
              <b>Sheet for Need {v.need}</b>
              {namesFor(v.need).map((n) => (
                <span className="names" key={n}>
                  {n}
                </span>
              ))}
            </p>
            <p>{v.text}</p>
          </div>
        ))}
        {result.dropped > 0 && (
          <p className="hint">
            {result.dropped} {result.dropped === 1 ? 'version was' : 'versions were'} for a need you did not tell the cloud, or said nothing, so {result.dropped === 1 ? 'it is' : 'they are'} left out.
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
        <div className="actions">
          <button className="secondary" disabled={issues.length > 0 && !replyRead} onClick={() => onPrint(!noNames)}>
            Print the materials
          </button>
          <label className="read-it">
            <input type="checkbox" checked={noNames} onChange={(e) => setNoNames(e.target.checked)} />
            Print without names
          </label>
        </div>
        <p className="hint">
          Prints the class sheet, one page for each need{noNames ? ', by its letter' : ' headed with the names, for you to hand out'}, the exit ticket and your answer key.
        </p>
      </article>
    );
  }
  return (
    <article className="card materials">
      <div className="card-head">
        <h3>Materials for this lesson</h3>
      </div>
      {!asking ? (
        <div className="actions">
          <button className="primary" onClick={() => setAsking(true)}>
            Make the materials
          </button>
          <span className="hint">Board work, a practice sheet with a version for each need, and an exit ticket. One more request to the cloud: you read it first.</span>
        </div>
      ) : (
        <>
          <p className="hint">The exact text that will be sent: the class plan you signed and the needs by letter. No name is in it.</p>
          <pre className="wire">{request}</pre>
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
          <label className="read-it">
            <input type="checkbox" checked={read} disabled={busy || stopped.length > 0} onChange={(e) => setRead(e.target.checked)} />I have read this text.
          </label>
          <div className="actions">
            <button className="primary" disabled={!read || busy || stopped.length > 0} onClick={onSend}>
              {busy ? 'Writing the materials…' : 'Approve and send for materials'}
            </button>
            <button className="link" disabled={busy} onClick={() => setAsking(false)}>
              Not now
            </button>
          </div>
        </>
      )}
    </article>
  );
}

/** The materials as the cloud returned them: letters only. */
export function MaterialsWire({ result }: { result: Materials }) {
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
        <p key={v.need}>
          <b>Sheet for Need {v.need}</b>
          <br />
          {v.text}
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

/** The pages of the materials, as they are printed. Names stand over a version only on the teacher's own print, and only if asked. */
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
            <h1>{names.length > 0 ? names.join(', ') : `Sheet for Need ${v.need}`}</h1>
            <h2>{title}: practice sheet</h2>
            <p>{v.text}</p>
            <ol>
              {result.sheet.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
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
      </div>
    </>
  );
}
