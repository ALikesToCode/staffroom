import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { ConstraintKind, LabelWhere, Receipt, Where } from '../core/types';
import { TASKS } from '../core/samples';
import { draftLine, recordIdTail, type ReceiptRecord } from '../core/receipts';
import { CONSTRAINT_LABEL } from '../core/constraints';
import { requestLine, stepReports, type NetworkRecord, type StepMark } from '../core/network';
import { configured, type Policy } from '../ai/firebase';
import { ROUTES, type DeviceStatus, type RouteId } from '../ai/routes';
import { CloudText, KIND_LABEL } from './parts';
import { foundLine, lessonLine, signOffLine } from './say';

/** The records read back from the teacher's account. */
export type Records =
  | { state: 'idle' | 'loading' | 'failed' }
  | { state: 'ready'; list: ReceiptRecord[]; unreadable: number };

const RECORD_WHERE: Record<Where, string> = {
  ON_DEVICE: 'on the device',
  IN_CLOUD: 'in the cloud',
  RULES_ONLY: 'by rules only',
  NOT_RUN: 'did not run',
  SKIPPED: 'skipped, nothing to check',
};

const LABEL_WHERE: Record<LabelWhere | 'UNKNOWN', string> = {
  ON_DEVICE: 'Written on the device from the approved text',
  IN_CLOUD: 'Written in the cloud from the approved text',
  FALLBACK: 'The task and the day: no model had named this receipt when it was signed off',
  UNKNOWN: 'Not recorded for this receipt',
};

// ------------------------------------------------------------------ the on-device model, in the header

/**
 * Whether this browser has the on-device model. Without one the pill is
 * neutral, not a warning: the app still works, by rule. It opens to say how
 * to turn the model on.
 */
export function DevicePill({
  device,
  download,
  onTurnOn,
  onWatch,
}: {
  device: DeviceStatus;
  download: number | null;
  onTurnOn: () => void;
  /** Absent when there is no recorded run to watch. */
  onWatch?: () => void;
}) {
  if (download !== null) {
    return (
      <span className="pill busy">
        <i />
        On-device model: loading {Math.round(download * 100)}%
      </span>
    );
  }
  switch (device) {
    case 'checking':
      return (
        <span className="pill">
          <i />
          On-device model: checking
        </span>
      );
    case 'available':
      return (
        <span className="pill ok">
          <i />
          On-device model: ready
        </span>
      );
    case 'downloadable':
    case 'downloading':
      return (
        <button className="pill action" onClick={onTurnOn}>
          <i />
          On-device model: turn on
        </button>
      );
    default:
      return (
        <details
          className="pill-pop"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.pop button')) e.currentTarget.open = false;
          }}
        >
          <summary className="pill">
            <i />
            On-device model: not in this browser
          </summary>
          <div className="pop" role="note">
            <b>How to turn it on</b>
            <ol>
              <li>Open this page in Chrome 139 or later on a desktop computer.</li>
              <li>Keep about 22 GB of disk free. Chrome downloads the model the first time.</li>
              <li>If the pill still says this, see the README.</li>
            </ol>
            <p>Until then the guard and the check run by rule, and the cloud still writes the draft.</p>
            {onWatch && (
              <button className="link" onClick={onWatch}>
                Watch a recorded run
              </button>
            )}
          </div>
        </details>
      );
  }
}

// ------------------------------------------------------------------ inspect

/** A panel over the page, closed with its button, the Escape key or a click outside it. */
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer-back" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="secondary small" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const WHERE_RAN: Record<Where, string> = {
  ON_DEVICE: 'Ran on this device',
  IN_CLOUD: 'Ran in the cloud',
  RULES_ONLY: 'Rules only, no model',
  NOT_RUN: 'Did not run',
  SKIPPED: 'Skipped: nothing to check',
};

/**
 * Everything that is sent besides the approved text, word for word, and
 * where each step of this run ran. One click away from every screen.
 */
export function Inspect({
  onClose,
  taskInstruction,
  system,
  format,
  heading,
  labelSystem,
  labelChars,
  policyLine,
  ran,
  secondRequest,
  network,
  steps,
  isReplay = false,
  replayInfo,
}: {
  onClose: () => void;
  taskInstruction: string;
  system: string;
  format: string;
  heading: string;
  labelSystem: string;
  labelChars: number;
  policyLine: string;
  /** Where each step ran in the run on screen. Absent for a step that has not run yet. */
  ran: Partial<Record<RouteId, string>>;
  /** For a lesson: the exact text of the second request, when one was made for needs with no entry. */
  secondRequest?: string;
  /** The browser's record of the requests this page made. Null where there is none. */
  network: NetworkRecord | null;
  /** The model steps of this tab, with when each started and ended. */
  steps: readonly StepMark[];
  isReplay?: boolean;
  replayInfo?: { guard: Where; draft: Where; check: Where; draftModel: string; hasMaterials: boolean };
}) {
  return (
    <Drawer title="Inspect" onClose={onClose}>
      <h3>Where each step runs</h3>
      <ul className="inspect-routes">
        {ROUTES.map((r) => (
          <li key={r.id}>
            <code className="mode">{r.mode.toUpperCase()}</code>
            <b>{r.job}</b>
            <span className={ran[r.id] ? 'ran' : 'ran not'}>{ran[r.id] ?? 'Not run yet'}</span>
            <details>
              <summary>Why</summary>
              <p>{r.why}</p>
            </details>
          </li>
        ))}
      </ul>
      <p className="hint">{policyLine}</p>

      {network && <NetworkSection network={network} steps={steps} isReplay={isReplay} replayInfo={replayInfo} />}

      {secondRequest && (
        <>
          <h3>A second request was made</h3>
          <p>
            Over a third of the needs you told had no entry in the first reply, so the cloud was asked once more for those letters only. It was sent the same
            text you approved and one more line. The exact text:
          </p>
          <pre className="wire">{secondRequest}</pre>
        </>
      )}
      <h3>Sent with your approved text</h3>
      <p className="hint">The task instruction:</p>
      <pre className="wire small">{taskInstruction}</pre>
      <p className="hint">The system instruction, the same for every draft:</p>
      <pre className="wire small">{system}</pre>
      <p className="hint">Written after the task instruction:</p>
      <pre className="wire small">{format}</pre>
      <p className="hint">Written above your text:</p>
      <pre className="wire small">{heading}</pre>
      <p className="hint">The shape of the answer is fixed too: a title and a list of items, each with a heading and a text.</p>

      <h3>Naming the receipt</h3>
      <p className="hint">
        One more call names the receipt. It runs on this device when it can. When it cannot, the cloud model is sent the line “Note:” and
        under it the first {labelChars.toLocaleString()} characters of your approved text, with this instruction:
      </p>
      <pre className="wire small">{labelSystem}</pre>
    </Drawer>
  );
}

export { WHERE_RAN };

/**
 * The requests this page made, as the browser records them, set against
 * the model steps of this tab. Host and path only: no query string, no
 * header, no token. It reads the record while it is open.
 */
export function NetworkSection({
  network,
  steps,
  isReplay = false,
  replayInfo,
}: {
  network: NetworkRecord;
  steps: readonly StepMark[];
  isReplay?: boolean;
  replayInfo?: { guard: Where; draft: Where; check: Where; draftModel: string; hasMaterials: boolean };
}) {
  const requests = useSyncExternalStore(network.subscribe, network.list, network.list);
  const reports = stepReports(steps, requests);
  return (
    <>
      <h3>Network, as the browser records it</h3>
      <p className="hint">
        Every request this page has made, from the browser's own record of them (Resource Timing), set against the time each model step ran. It holds
        what this page fetches, not what the browser fetches for itself, such as the on-device model's download. Only the host and the path are shown.
      </p>
      {reports.length === 0 ? (
        isReplay ? (
          <div className="replay-network">
            <p className="hint">
              0 model requests were made in this tab during replay: everything shown comes from the recorded run file on this device.
            </p>
            {replayInfo && (
              <ul className="inspect-network">
                <li>
                  <b>Guard ({RECORD_WHERE[replayInfo.guard]})</b>: 0 requests to the model host when recorded in Chrome 158
                </li>
                <li>
                  <b>Draft ({RECORD_WHERE[replayInfo.draft]} · {replayInfo.draftModel})</b>: approved text and nameless needs only
                </li>
                <li>
                  <b>Check ({RECORD_WHERE[replayInfo.check]})</b>: 0 requests to the model host when recorded
                </li>
                {replayInfo.hasMaterials && (
                  <li>
                    <b>Materials ({RECORD_WHERE[replayInfo.draft]} · {replayInfo.draftModel})</b>: signed class plan and nameless needs only
                  </li>
                )}
              </ul>
            )}
            <p className="hint">Press <b>Try an invented class</b> on the Desk to inspect live Resource Timing for your own session.</p>
          </div>
        ) : (
          <p className="hint">No model step has run in this tab yet.</p>
        )
      ) : (
        <ul className="inspect-network">
          {reports.map((r, i) => (
            <li key={i}>
              <b>{r.summary}</b> <span className="hint">{r.when}</span>
              {r.requests.length > 0 && (
                <ul>
                  {r.requests.map((l, j) => (
                    <li key={j}>{l}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>Every request this page has made · {requests.length}</summary>
        <ul className="inspect-network all">
          {requests.map((r, i) => (
            <li key={i}>{requestLine(r)}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

// ------------------------------------------------------------------ how it works

export function How({ policy, device }: { policy: Policy; device: DeviceStatus }) {
  return (
    <main className="page">
      <h2>How it works</h2>
      <p className="lede">Two models, one door. The small one in your browser decides what may leave. The large one in the cloud writes.</p>
      <section className="arch-diagram" aria-label="Where each step runs">
        <div className="arch-band arch-device">
          <div className="arch-band-head">
            <span>On this device</span>
            <code>Gemini Nano in Chrome + plain rules</code>
          </div>
          <div className="arch-steps">
              <div className="arch-step">
              <b>
                <span className="n">1</span> Scan & Guard
              </b>
              <p>Transcribes handwritten register photos locally, finds names & private facts (incl. Hinglish/Devanagari), swaps stand-ins.</p>
              <code>ONLY_ON_DEVICE</code>
            </div>
            <div className="arch-step">
              <b>
                <span className="n">2</span> What leaves
              </b>
              <p>Teacher reads the exact outgoing text, checks the exit gate, and ticks approval before anything leaves.</p>
            </div>
            <div className="arch-step">
              <b>
                <span className="n">4</span> Beside each child
              </b>
              <p>Need letters map back to the right children locally. A pair rule seats fighting classmates apart.</p>
            </div>
            <div className="arch-step">
              <b>
                <span className="n">5</span> Check and sign off
              </b>
              <p>Each step is checked against confirmed constraints by rule and withheld details by Nano.</p>
              <code>ONLY_ON_DEVICE</code>
            </div>
          </div>
        </div>

        <div className="arch-bridge">
          <div className="arch-wire">
            <b>↓ Sent across the door</b>
            <p>
              Class, subject, topic, length; class-level sentences; <code>Need A: cannot stay after the last bell</code> by letter. No name, no
              reason, no count.
            </p>
          </div>
          <div className="arch-wire">
            <b>↑ Returned across the door</b>
            <p>
              Lesson stages, plus an entry for every letter (<code>Need F | Check | …</code> or <code>already suits</code>). Materials: one sheet
              written out per need.
            </p>
          </div>
        </div>

        <div className="arch-band arch-cloud">
          <div className="arch-band-head">
            <span>In the cloud</span>
            <code>{policy.cloudModel}</code>
          </div>
          <div className="arch-steps cloud-three">
            <div className="arch-step">
              <b>
                <span className="n">3</span> Lesson and materials
              </b>
              <p>Writes one class plan, per-need entries without knowing whose they are, board work, sheets, and exit ticket.</p>
              <code>PREFER_IN_CLOUD</code>
            </div>
            <div className="arch-step">
              <b>App Check</b>
              <p>reCAPTCHA Enterprise enforced on cloud calls.</p>
            </div>
            <div className="arch-step">
              <b>Firestore</b>
              <p>Optional count-only receipt (no note, no draft, no names).</p>
            </div>
          </div>
        </div>

        <div className="arch-band arch-device arch-loop">
          <b>
            <span className="n">6</span> After the lesson
          </b>
          <span>
            Exit-ticket marks (Got it / Partly / Not yet / Absent) stay on this device and turn into nameless needs by letter for the next lesson.
          </span>
        </div>

        <p className="arch-never">
          <b>Never sent:</b> names · who has which need · why · exit-ticket marks · the teacher's copy. Health details stay withheld by default.
        </p>
      </section>

      <table className="routes">
        <thead>
          <tr>
            <th>Job</th>
            <th>Inference mode</th>
          </tr>
        </thead>
        <tbody>
          {ROUTES.map((r) => (
            <tr key={r.id}>
              <td>
                {r.job}
                <details>
                  <summary>Why</summary>
                  <p>{r.why}</p>
                </details>
              </td>
              <td>
                <code>{r.mode.toUpperCase()}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Four checks that are not a model</h3>
      <ul className="plain">
        <li>
          <b>The exit gate</b> re-checks the outgoing text for every withheld item and for phone, email and ID patterns.
          <details>
            <summary>What this does not do</summary>
            <p>
              If it finds one, the send button is disabled. It catches redaction mistakes; it cannot find a private detail nobody marked.
            </p>
          </details>
        </li>
        <li>
          <b>You.</b> Nothing is sent until you have read the exact text and pressed Approve.
          <details>
            <summary>Details</summary>
            <p>If the text changes after you tick, the tick is cleared.</p>
          </details>
        </li>
        <li>
          <b>The return gate</b> checks the reply for stand-ins that were never sent, withheld items and new sensitive words.
          <details>
            <summary>Details</summary>
            <p>
              Plain code checks that the reply uses only the stand-ins that were in the text you approved, contains no withheld item, and
              brings in no word from the sensitive list that your approved text did not have. It blocks sign-off until you have read a
              flagged reply.
            </p>
          </details>
        </li>
        <li>
          <b>The rule check</b> compares each step of the draft with the constraints you confirmed.
          <details>
            <summary>What this does not do</summary>
            <p>
              A step after the last bell for a student who has to leave at it, a cost for a family that cannot pay: only a rule marks an
              item as in conflict. It knows a list of words and nothing else, so it misses a step that says the same thing another way.
              The on-device model is the second layer: its "no" is shown as a doubt, for you to decide on.
            </p>
          </details>
        </li>
      </ul>
      <h3>Measured with Gemini Nano</h3>
      <p className="hint">Measured on 26–28 November 2026 in Chrome 158 with Gemini Nano on invented class notes (docs/evals/).</p>
      <table className="routes">
        <thead>
          <tr>
            <th>Measurement</th>
            <th>Observed result</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Guard on 12 fresh invented notes (60 private details, 3 runs each)</td>
            <td>Rules alone hid 40/60 in full and missed 9; rules + 1-pass combined Gemini Nano hid 49.3/60 on average (148/180, median 4.06s) and cut misses to 2.3/60, with 2/8 harmless held (vs 5/8).</td>
          </tr>
          <tr>
            <td>Multimodal scan &amp; offline draft fallback (28 Nov, Chrome 158)</td>
            <td>Local notebook photo OCR transcribed 231 chars in 7.1s with 0 cloud requests; offline PREFER_IN_CLOUD draft fallback streamed on Gemini Nano in 40.8s with caution notice.</td>
          </tr>
          <tr>
            <td>Check on 16 unseen held-out cases (3 runs each)</td>
            <td>24 of 24 conflicts caught; 4 of 24 harmless runs wrongly flagged as doubts for the teacher to confirm.</td>
          </tr>
          <tr>
            <td>Check + rules on the full sample note (2 runs)</td>
            <td>18 of 18 conflicts caught; 0 of 42 harmless items flagged as conflicts (3 marked unsure).</td>
          </tr>
          <tr>
            <td>Structured lesson needs (10 lessons, 11 needs each)</td>
            <td>100% entry coverage (every letter answered with a stage line or “already suits”, 0 missing), vs 4 of 55 with inline instructions.</td>
          </tr>
          <tr>
            <td>Why Nano reads instead of writes</td>
            <td>Rule-based learning needs replaced the removed Nano proposer (which passed 3/36 times); per-child rewrites repeated note words 17/43 times, so Nano focuses on OCR, guarding, checking, and optional on-request fits.</td>
          </tr>
        </tbody>
      </table>

      <h3>What is in force now</h3>
      <dl className="facts">
        <dt>On-device model</dt>
        <dd>{device === 'available' ? 'Gemini Nano, built into Chrome, ready' : `not ready (${device})`}</dd>
        <dt>Drafting model</dt>
        <dd>{policy.cloudModel}</dd>
        <dt>Kept withheld by the app</dt>
        <dd>{policy.lockedKinds.map((k) => KIND_LABEL[k].toLowerCase()).join(', ') || 'nothing is locked'}</dd>
        <dt>Set by</dt>
        <dd>{policy.from}. A setting the school publishes; enforced in the app.</dd>
        <dt>Firebase</dt>
        <dd>{configured ? 'AI Logic, App Check, Remote Config, Authentication, Firestore' : 'no project connected in this build'}</dd>
      </dl>
    </main>
  );
}

// ------------------------------------------------------------------ receipts

export function Receipts({
  receipts,
  keepCopies,
  setKeepCopies,
  signedIn,
  records,
  onClear,
}: {
  receipts: Receipt[];
  keepCopies: boolean;
  setKeepCopies: (v: boolean) => void;
  signedIn: boolean;
  records: Records;
  onClear: () => void;
}) {
  return (
    <main className="page">
      <h2>Receipts</h2>
      <p className="lede">One line for each run you signed off, kept in this browser.</p>
      <details className="fold">
        <summary>What a receipt holds</summary>
        <p>
          A receipt holds the text you approved. If you approved your note as written, that is your note. It also holds counts of what was
          withheld, which model ran where, and how many items you kept and how many you struck. It does not hold the draft or anything you
          withheld.
        </p>
      </details>

      {receipts.length === 0 ? (
        <p className="empty">No receipts yet. Finish a run on the desk.</p>
      ) : (
        <ul className="receipts">
          {receipts.map((r) => {
            const total = Object.values(r.guard.found).reduce((a, b) => a + b, 0);
            return (
              <li key={r.id}>
                <details>
                  <summary>
                    <strong>{r.label}</strong>
                    <span>{new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    <span>
                      {total} withheld · {r.signOff.kept} kept · {r.signOff.struck} struck
                    </span>
                  </summary>
                  <dl className="facts">
                    <dt>Name</dt>
                    <dd>{LABEL_WHERE[r.labelWhere ?? 'UNKNOWN']}</dd>
                    <dt>Guard</dt>
                    <dd>
                      {r.guard.where === 'ON_DEVICE' ? 'On-device model and rules' : 'Rules only'}:{' '}
                      {foundLine(r.guard.found)}
                      {r.guard.allowedByTeacher > 0 && `. ${r.guard.allowedByTeacher} released by the teacher`}
                      {(r.guard.unreadParagraphs ?? 0) > 0 &&
                        `. The on-device model could not read ${r.guard.unreadParagraphs} ${r.guard.unreadParagraphs === 1 ? 'part' : 'parts'} of the note`}
                      {(r.guard.droppedDetails ?? 0) > 0 &&
                        `. ${r.guard.droppedDetails} reported ${r.guard.droppedDetails === 1 ? 'item' : 'items'} could not be matched to the note in full`}
                    </dd>
                    <dt>Approved</dt>
                    <dd>
                      {new Date(r.sent.approvedAt).toLocaleString()} · {r.sent.chars.toLocaleString()} characters · exit gate {r.sent.gate}
                      {' '}· record id {recordIdTail(r.id)}
                    </dd>
                    <dt>Draft</dt>
                    <dd>{draftLine(r.draft)}</dd>
                    <dt>Check</dt>
                    <dd>
                      {r.check.where === 'ON_DEVICE'
                        ? `On device: ${r.check.fits} with no conflict found, ${r.check.unsure} to think about, ${r.check.conflict} in conflict, ${r.check.notChecked} not checked, ${r.check.nothingWithheld} with nothing to check${
                            (r.check.failedRequests ?? 0) > 0
                              ? `. It ran only in part: ${r.check.failedRequests} of its ${r.check.requests} requests to the on-device model failed`
                              : ''
                          }`
                        : r.check.where === 'SKIPPED'
                          ? `Skipped, nothing to check: ${r.check.nothingWithheld} with nothing withheld`
                          : r.check.where === 'RULES_ONLY'
                            ? `By rule only, no model: ${r.check.conflict} in conflict, ${r.check.unsure} to think about, ${r.check.notChecked} checked by rule only or not checked, ${r.check.nothingWithheld} with nothing to check`
                            : `${
                                (r.check.failedRequests ?? 0) > 0
                                  ? `Could not run, all ${r.check.requests} of its requests to the on-device model failed`
                                  : 'Did not run'
                              }: ${r.check.notChecked} not checked, ${r.check.nothingWithheld} with nothing to check`}
                      . Return gate {r.check.replyGate}.
                    </dd>
                    <dt>Constraints</dt>
                    <dd>
                      {r.constraints
                        ? `${r.constraints.confirmed} confirmed by the teacher${
                            r.constraints.confirmed > 0
                              ? ` (${Object.entries(r.constraints.byKind)
                                  .map(([k, n]) => `${n} ${CONSTRAINT_LABEL[k as ConstraintKind].toLowerCase()}`)
                                  .join(', ')})`
                              : ''
                          }. ${r.constraints.shared ?? 0} told to the cloud as a need, without the reason. ${r.check.conflictsByRule ?? 0} ${(r.check.conflictsByRule ?? 0) === 1 ? 'item' : 'items'} found in conflict by rule, ${r.check.doubtsByModel ?? 0} doubted by the on-device model only. The words of a constraint are not kept here.`
                        : 'Not recorded for this receipt'}
                    </dd>
                    <dt>Sign-off</dt>
                    <dd>
                      {signOffLine(r.signOff)}
                    </dd>
                    {r.lesson && (
                      <>
                        <dt>Lesson</dt>
                        <dd>{lessonLine(r.lesson)}</dd>
                      </>
                    )}
                  </dl>
                  <p className="hint">The text you approved:</p>
                  <pre className="wire">
                    <CloudText text={r.sent.text} />
                  </pre>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <section className="account">
        <label className="switch">
          <input type="checkbox" checked={keepCopies} disabled={!signedIn} onChange={(e) => setKeepCopies(e.target.checked)} />
          <span />
          Keep a copy of each receipt's record (no text) in my account (Firestore).
        </label>
        <p className="hint">
          Counts only, written by this browser: your own note of a run, not proof of it to anyone else.
          {!signedIn && (configured ? ' Sign-in is not available right now.' : ' Not available: no Firebase project is connected.')}
        </p>
        {signedIn && records.state === 'loading' && <p className="hint">Looking up the records kept in your account.</p>}
        {signedIn && records.state === 'failed' && <p className="caution">The records kept in your account could not be read just now.</p>}
        {signedIn && records.state === 'ready' && (
          <details className="fold records">
            <summary>
              Records in your account: {records.list.length}
              {records.unreadable > 0 &&
                `. ${records.unreadable} older ${records.unreadable === 1 ? 'entry is' : 'entries are'} in an earlier form and ${records.unreadable === 1 ? 'is' : 'are'} not listed`}
            </summary>
            <p className="hint">A receipt here and its record in your account have the same record id, so you can pair the two.</p>
            {records.list.length > 0 && (
              <ul className="record-list">
                {records.list.map((r) => {
                  const total = Object.values(r.withheld).reduce((a, b) => a + b, 0);
                  return (
                    <li key={r.id}>
                      <b>{new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</b>
                      <span>{TASKS.find((t) => t.id === r.task)?.label ?? r.task}</span>
                      <span>
                        {total} withheld, {r.kept} kept, {r.struck} struck
                      </span>
                      <span>
                        Guard {RECORD_WHERE[r.guardWhere]} · draft {RECORD_WHERE[r.draftWhere]} ({r.draftModel}) · check{' '}
                        {RECORD_WHERE[r.checkWhere]}
                        {r.flags.replyFlagged ? ' · reply flagged' : ''} · {r.constraintsConfirmed} constraints confirmed, {r.needsShared} told as
                        needs, {r.conflictsByRule} in conflict by rule, {r.doubtsByModel} doubted by the model · record id {recordIdTail(r.id)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        )}
      </section>
      {receipts.length > 0 && (
        <button className="link" onClick={onClear}>
          Delete the receipts kept in this browser
        </button>
      )}
    </main>
  );
}
