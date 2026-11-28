import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Gaps, Stage } from '../app/storage';
import type { Policy } from '../ai/firebase';
import type { Constraint, Entity, Where } from '../core/types';
import { CAPITALISED, RESERVED, segment } from '../core/vault';
import { KIND_LABEL } from './parts';

export interface VaultPanelProps {
  entities: Entity[];
  withheld: Entity[];
  inside: Map<string, string>;
  policy: Policy;
  stage: Stage;
  replay: boolean;
  guardWhere: Where;
  guardGaps: Gaps;
  noteParts: string[];
  vaultOpen: boolean;
  setVaultOpen: (open: boolean) => void;
  toggle: (e: Entity) => void;
  releaseAsk: string | null;
  setReleaseAsk: (id: string | null) => void;
  flip: (id: string) => void;
  unconfirmAsk: string | null;
  setUnconfirmAsk: (id: string | null) => void;
  setConstraints: Dispatch<SetStateAction<Constraint[]>>;
}

export function VaultPanel({
  entities,
  withheld,
  inside,
  policy,
  stage,
  replay,
  guardWhere,
  guardGaps,
  noteParts,
  vaultOpen,
  setVaultOpen,
  toggle,
  releaseAsk,
  setReleaseAsk,
  flip,
  unconfirmAsk,
  setUnconfirmAsk,
  setConstraints,
}: VaultPanelProps) {
  const vaultRow = (e: Entity, nested: boolean) => {
    const reserved = e.category === RESERVED;
    const locked = reserved || policy.lockedKinds.includes(e.kind);
    const guess = e.source === 'rule' && e.category === CAPITALISED;
    const about = entities.find((s) => s.id === e.about);
    const parts = nested ? [] : entities.filter((x) => inside.get(x.id) === e.id);
    const partsHeld = parts.filter((x) => x.withheld).length;
    return (
      <li key={e.id} className={e.withheld ? '' : 'off'}>
        <span className={`dot k-${e.kind}`} />
        <div className="what">
          <strong>{e.surfaces[0]}</strong>
          <small>
            {reserved ? 'Looks like a stand-in' : KIND_LABEL[e.kind]}
            {e.category && !guess && !reserved ? `, ${e.category}` : ''}
            {about && !reserved ? `, about ${about.surfaces[0]}` : ''} · found by {guess ? 'rule: capitalised word' : e.source}
            {e.source === 'on-device model' && <span className="source-badge nano inline">Found by Gemini Nano</span>}
            {nested ? ' · inside the sentence above' : ''}
          </small>
          {!e.withheld && partsHeld > 0 && (
            <small className="parts-held">
              {partsHeld} {partsHeld === 1 ? 'part' : 'parts'} inside {partsHeld === 1 ? 'stays' : 'stay'} withheld.
            </small>
          )}
        </div>
        <code className="token">{e.withheld ? e.token : 'released'}</code>
        <label
          className="switch"
          title={
            reserved
              ? 'Text that looks like one of the stand-ins is always withheld, so it cannot be mistaken for one'
              : locked
                ? 'A setting the school publishes: the app keeps this kind withheld'
                : ''
          }
        >
          <input
            type="checkbox"
            checked={e.withheld}
            disabled={locked || stage !== 'review' || replay}
            onChange={() => toggle(e)}
            aria-label={`Withhold ${e.surfaces[0]}`}
          />
          <span />
          {locked && <em>locked</em>}
        </label>
        {releaseAsk === e.id && e.withheld && !locked && stage === 'review' && (
          <div className="confirm release-ask" role="group" aria-label={`Release ${e.surfaces[0]}`}>
            <p>
              Your school's policy is not in force: the app is using its built-in defaults, so it cannot tell whether your school allows
              this to be sent. Release “{e.surfaces[0].length > 60 ? `${e.surfaces[0].slice(0, 60)}…` : e.surfaces[0]}” anyway?
            </p>
            <div className="actions">
              <button
                className="secondary small"
                onClick={() => {
                  setReleaseAsk(null);
                  flip(e.id);
                }}
              >
                Release it
              </button>
              <button className="link" onClick={() => setReleaseAsk(null)}>
                Keep it withheld
              </button>
            </div>
          </div>
        )}
        {unconfirmAsk === e.id && e.withheld && stage === 'review' && (
          <div className="confirm release-ask" role="group" aria-label={`Release ${e.surfaces[0]}`}>
            <p>You confirmed a constraint in these words, so they stay withheld. Unconfirm it first; then you can release them.</p>
            <div className="actions">
              <button
                className="secondary small"
                onClick={() => {
                  setUnconfirmAsk(null);
                  setConstraints((list) => list.map((c) => (c.detailId === e.id ? { ...c, confirmed: false, share: false } : c)));
                }}
              >
                Unconfirm the constraint
              </button>
              <button className="link" onClick={() => setUnconfirmAsk(null)}>
                Keep it withheld
              </button>
            </div>
          </div>
        )}
        {parts.length > 0 && (
          <details className="inside">
            <summary>
              {parts.length} {parts.length === 1 ? 'part' : 'parts'} inside the sentence above
            </summary>
            <ul className="vault">{parts.map((x) => vaultRow(x, true))}</ul>
          </details>
        )}
      </li>
    );
  };

  return (
    <details
      className="card fold"
      // Open when the teacher opened it, and whenever it lists parts of the note the model could not read.
      open={vaultOpen || (guardWhere === 'ON_DEVICE' && guardGaps.unread.length > 0)}
      onToggle={(e) => setVaultOpen(e.currentTarget.open)}
    >
      <summary>
        {withheld.length} {withheld.length === 1 ? 'name or detail' : 'names and details'} withheld
      </summary>
      {/* The parts the model could not read are quoted here, on the device side: the words are from the raw note. */}
      {guardWhere === 'ON_DEVICE' &&
        guardGaps.unread.map((i) => (
          <p className="caution" key={i}>
            The on-device model could not read part {i + 1} of your note
            {noteParts[i] ? ` (it begins “${noteParts[i].slice(0, 40).trim()}…”)` : ''}. In that part, capitalised words were held back as
            possible names, by rule. Private details in it were not looked for: check it yourself before you approve.
          </p>
        ))}
      {entities.length === 0 ? (
        <p className="empty">Nothing was found to withhold.</p>
      ) : (
        <ul className="vault">{entities.filter((e) => !inside.has(e.id)).map((e) => vaultRow(e, false))}</ul>
      )}
    </details>
  );
}

export function NoteView({
  note,
  entities,
  stage,
  noteRef,
  onSelectText,
}: {
  note: string;
  entities: Entity[];
  stage: Stage;
  noteRef: RefObject<HTMLDivElement | null>;
  onSelectText: () => void;
}) {
  return (
    <div className="note-view" ref={stage === 'review' ? noteRef : undefined} onMouseUp={onSelectText} onKeyUp={onSelectText}>
      {segment(note, entities).map((s, i) =>
        s.entity ? (
          <mark
            key={i}
            className={`k-${s.entity.kind} ${s.entity.withheld ? 'held' : 'released'}`}
            title={s.entity.withheld ? `Withheld. The cloud sees ${s.entity.token}` : 'You released this. The cloud will see it.'}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  );
}

export function NoteLinks({
  replay,
  editing,
  busy,
  stage,
  note,
  classListCount,
  receiptsCount,
  loadSample,
  startOver,
  setForgetAsk,
  forgetNote,
}: {
  replay: boolean;
  editing: boolean;
  busy: boolean;
  stage: Stage;
  note: string;
  classListCount: number;
  receiptsCount: number;
  loadSample: () => void;
  startOver: () => void;
  setForgetAsk: (v: boolean) => void;
  forgetNote: (alsoReceipts: boolean) => void;
}) {
  return (
    <span className="head-links">
      {replay ? null : editing ? (
        <button className="link" onClick={loadSample}>
          Fill in the invented class
        </button>
      ) : (
        !busy &&
        stage !== 'signed' && (
          <button className="link" onClick={startOver}>
            Edit note
          </button>
        )
      )}
      {!busy && !replay && (note !== '' || classListCount > 0) && (
        <button
          className="link forget"
          onClick={() => (receiptsCount > 0 ? setForgetAsk(true) : forgetNote(false))}
          title="Clears the note, the class list, the vault and the results from this page and from this browser."
        >
          Forget this class
        </button>
      )}
    </span>
  );
}

export function ForgetQuestion({
  forgetAsk,
  receiptsCount,
  busy,
  forgetNote,
  setForgetAsk,
}: {
  forgetAsk: boolean;
  receiptsCount: number;
  busy: boolean;
  forgetNote: (alsoReceipts: boolean) => void;
  setForgetAsk: (v: boolean) => void;
}) {
  if (!forgetAsk) return null;
  return (
    <div className="confirm" role="group" aria-label="Forget this note">
      <p>
        Your note, class list, vault and results will be cleared. This browser also keeps {receiptsCount}{' '}
        {receiptsCount === 1 ? 'receipt' : 'receipts'}, and a receipt holds the text you approved. Delete{' '}
        {receiptsCount === 1 ? 'it' : 'them'} too?
      </p>
      <div className="actions">
        <button className="secondary small" disabled={busy} onClick={() => forgetNote(true)}>
          Forget the note and delete receipts
        </button>
        <button className="secondary small" disabled={busy} onClick={() => forgetNote(false)}>
          Forget the note, keep receipts
        </button>
        <button className="link" onClick={() => setForgetAsk(false)}>
          Cancel
        </button>
      </div>
      {busy && <p className="hint">Wait for the step that is running to finish, then choose.</p>}
    </div>
  );
}
