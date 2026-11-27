import { useState } from 'react';
import type { Constraint, ConstraintKind, Entity, ItemCheck } from '../core/types';
import { CloudText } from './parts';
import { ALL_KINDS as CONSTRAINT_KINDS, CONSTRAINT_LABEL, kindLabel } from '../core/constraints';

export interface ConstraintActions {
  onConfirm: (id: string) => void;
  onUnconfirm: (id: string) => void;
  onRemove: (id: string) => void;
  onKind: (id: string, kind: ConstraintKind) => void;
  onTriggers: (id: string, typed: string) => void;
  onAdd: (by: { kind: ConstraintKind; about?: string; text: string }) => void;
  onShare: (id: string, share: boolean) => void;
  onNeed: (id: string, typed: string) => void;
  /** For a lesson: send a need line with a word from the sensitive list as it is worded. */
  onNeedAck?: (id: string, on: boolean) => void;
}

/** What the panel shows of a constraint's need: the line as it would be sent, and what the exit gate stops in it. */
export interface NeedView {
  /** True when the line is the teacher's own (health, other): there is no fixed line for the kind. */
  typed: boolean;
  line?: string;
  issues: { what: string; why: string }[];
  /** For a lesson: words from the sensitive list in the line. */
  sensitive?: string[];
}

const FOUND_BY: Record<Constraint['source'], string> = {
  rule: 'Found by rule',
  'on-device model': 'Found by the on-device model',
  teacher: 'Added by you',
};

/** What the rules read from the words of a constraint, said in a few words. */
export function constraintDetail(c: Constraint): string {
  if (c.kind === 'days-away') return (c.days ?? []).length > 0 ? `Days: ${c.days!.join(', ')}` : 'No day is named, so no rule can check this one.';
  if (c.kind === 'contact') {
    if (!c.who) {
      return c.guardian
        ? `Looked after by: ${c.guardian}. No adult is marked not to contact, so a step that contacts a parent is only queried.`
        : 'No adult is named, so a step that contacts a parent is only queried.';
    }
    return `Adult: ${c.who}${c.away ? ', not there to contact' : ', not to be contacted'}${c.guardian ? `. Looked after by: ${c.guardian}` : ''}`;
  }
  if (c.kind === 'other') return 'No rule can check this one. Only the on-device model can.';
  return '';
}

/**
 * The constraints of a note. Each is one line (the words, whose they are,
 * the kind) with two controls: confirm it, and tell the cloud the need
 * without the reason. Everything else is under Details. Everything here
 * stays on the device.
 */
export function ConstraintsPanel({
  constraints,
  students,
  editable,
  selection,
  actions,
  needOf,
  lesson = false,
  activeNeed,
  onHoverNeed,
}: {
  /** True for a lesson: a need is told by letter with no child in it, and each row shows what stays and what is told. */
  lesson?: boolean;
  constraints: Constraint[];
  students: Entity[];
  editable: boolean;
  /** The words selected in the note, offered as the words of a new constraint. */
  selection: string;
  actions: ConstraintActions;
  /** The need line of a constraint, as it would be sent. */
  needOf: (c: Constraint) => NeedView;
  activeNeed?: string | null;
  onHoverNeed?: (letter: string | null) => void;
}) {
  const [about, setAbout] = useState('');
  const [kind, setKind] = useState<ConstraintKind>('time-after');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'all' | 'told' | 'stays'>('all');
  const nameOf = (id: string | undefined) => students.find((s) => s.id === id)?.surfaces[0];
  const isTold = (c: Constraint) => {
    const n = needOf(c);
    return Boolean(c.confirmed && c.share && n.line);
  };
  const toldCount = constraints.filter(isTold).length;
  const staysCount = constraints.length - toldCount;
  const visible = !lesson || filter === 'all' ? constraints : constraints.filter((c) => (filter === 'told' ? isTold(c) : !isTold(c)));
  const add = () => {
    if (text.trim().length === 0) return;
    actions.onAdd({ kind, about: about || undefined, text });
    setText('');
  };
  return (
    <div className="constraints">
      {lesson && constraints.length > 0 && (
        <div className="filter-bar" role="group" aria-label="Filter constraints">
          <button type="button" className={filter === 'all' ? 'filter-chip on' : 'filter-chip'} onClick={() => setFilter('all')}>
            All ({constraints.length})
          </button>
          <button type="button" className={filter === 'told' ? 'filter-chip on' : 'filter-chip'} onClick={() => setFilter('told')}>
            Told to cloud ({toldCount})
          </button>
          <button type="button" className={filter === 'stays' ? 'filter-chip on' : 'filter-chip'} onClick={() => setFilter('stays')}>
            Stays here ({staysCount})
          </button>
        </div>
      )}
      {constraints.length === 0 ? (
        <p className="empty">No constraint was found. Add one below if there is one.</p>
      ) : visible.length === 0 ? (
        <p className="empty">No constraints in this view.</p>
      ) : (
        <ul className="constraint-list">
          {visible.map((c) => (
            <ConstraintRow
              key={c.id}
              c={c}
              who={nameOf(c.about) ?? c.childName ?? 'the class'}
              need={needOf(c)}
              editable={editable}
              actions={actions}
              lesson={lesson}
              activeNeed={activeNeed}
              onHoverNeed={onHoverNeed}
            />
          ))}
        </ul>
      )}
      {editable && (
        <details className="constraint-add" open={selection !== '' || undefined}>
          <summary>Add a constraint</summary>
          <div className="add-grid">
            <label>
              About
              <select value={about} onChange={(e) => setAbout(e.target.value)}>
                <option value="">The whole class</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.surfaces[0]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value as ConstraintKind)}>
                {CONSTRAINT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CONSTRAINT_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              The words
              <input
                type="text"
                value={text}
                maxLength={300}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type them, or select them in your note"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          </div>
          <span className="actions">
            <button className="secondary small" disabled={text.trim().length === 0} onClick={add}>
              Add and confirm
            </button>
            {selection && selection !== text && (
              <button className="link" onClick={() => setText(selection)}>
                Use the words selected in the note
              </button>
            )}
          </span>
          <p className="hint">Words that stand in your note are withheld. Words you only type here are in no text that is sent.</p>
        </details>
      )}
    </div>
  );
}

function ConstraintRow({
  c,
  who,
  need,
  editable,
  actions,
  lesson,
  activeNeed,
  onHoverNeed,
}: {
  c: Constraint;
  who: string;
  need: NeedView;
  editable: boolean;
  actions: ConstraintActions;
  lesson: boolean;
  activeNeed?: string | null;
  onHoverNeed?: (letter: string | null) => void;
}) {
  const nothingToTell = !need.typed && !need.line;
  const telling = Boolean(c.share) && c.confirmed;
  const letter = telling && need.line ? /^Need ([A-Z]{1,2}):/.exec(need.line)?.[1] : undefined;
  const traced = Boolean(letter && activeNeed === letter);
  const detail = constraintDetail(c);
  const needInput = need.typed && (
    <label className="field">
      {lesson ? 'The need, in your words: no name and no reason' : 'The need, in your words'}
      <input
        type="text"
        defaultValue={c.need ?? ''}
        maxLength={200}
        disabled={!editable}
        onBlur={(e) => actions.onNeed(c.id, e.target.value)}
        key={lesson ? (c.need ?? '') : undefined}
        placeholder={lesson ? (c.kind === 'health' ? 'For example: must avoid flashing or flickering light' : 'Say what such a pupil needs, not why and not who') : c.kind === 'health' ? 'For example: No flashing lights for [Student 2]' : 'Say what the school must do, not why'}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
  return (
    <li
      className={['constraint', c.confirmed ? 'confirmed' : '', traced ? 'is-traced' : ''].filter(Boolean).join(' ')}
      onMouseEnter={() => letter && onHoverNeed?.(letter)}
      onMouseLeave={() => letter && onHoverNeed?.(null)}
    >
      {(!lesson || !c.confirmed) && (
        <div className="c-line">
          <q>{c.text}</q>
          <span className="c-who">{who}</span>
          <span className="kind-chip">{kindLabel(c)}</span>
        </div>
      )}
      <div className="c-controls">
        {editable ? (
          <button
            className={c.confirmed ? 'confirm-btn on' : 'confirm-btn'}
            aria-pressed={c.confirmed}
            title={c.confirmed ? 'Confirmed. Press to unconfirm.' : 'Confirm that this is right'}
            onClick={() => (c.confirmed ? actions.onUnconfirm(c.id) : actions.onConfirm(c.id))}
          >
            {c.confirmed ? 'Confirmed' : 'Confirm'}
          </button>
        ) : (
          <span className={c.confirmed ? 'confirm-btn on static' : 'confirm-btn static'}>{c.confirmed ? 'Confirmed' : 'Not confirmed'}</span>
        )}
        <label className="switch need-switch" title={!c.confirmed ? 'Confirm the constraint first' : nothingToTell ? 'There is no need line for this kind' : ''}>
          <input
            type="checkbox"
            checked={Boolean(c.share)}
            disabled={!editable || !c.confirmed || nothingToTell}
            onChange={(e) => actions.onShare(c.id, e.target.checked)}
          />
          <span />
          {lesson ? 'Tell the cloud this need (no name, no reason)' : 'Tell the cloud the need (not the reason)'}
        </label>
        {lesson && c.confirmed && <span className="kind-chip">{kindLabel(c)}</span>}
        <details className="c-more">
          <summary>Details</summary>
          <p>
            {FOUND_BY[c.source]}
            {c.source === 'rule' && c.alsoModel ? ' and by the on-device model' : ''}. {detail}
          </p>
          {!telling && need.line && (
            <p>
              If you switch it on, the cloud will be told: <code className="need-line">{need.line}</code>
            </p>
          )}
          {nothingToTell && <p>There is no need line for this constraint, so there is nothing to tell the cloud.</p>}
          {c.kind === 'health' && <p>A health need can hint at the condition. There is no fixed line for it: it is told only if you type one.</p>}
          {!telling && needInput}
          <label className="field">
            Kind
            <select
              value={c.kind}
              disabled={!editable}
              onChange={(e) => actions.onKind(c.id, e.target.value as ConstraintKind)}
              aria-label={`Kind of constraint: ${c.text}`}
            >
              {CONSTRAINT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONSTRAINT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {c.kind === 'health' && (
            <label className="field">
              Words that go against it in a step, separated by commas
              <input
                type="text"
                defaultValue={(c.triggers ?? []).join(', ')}
                key={(c.triggers ?? []).join(',')}
                disabled={!editable}
                onBlur={(e) => actions.onTriggers(c.id, e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <span className="hint">The rule looks for these words. It is not medical advice.</span>
            </label>
          )}
          {editable && (
            <button className="link" onClick={() => actions.onRemove(c.id)}>
              Remove this constraint
            </button>
          )}
        </details>
      </div>
      {telling && need.line && !lesson && (
        <p className="need-told">
          The cloud is told: <code className="need-line">{need.line}</code>
        </p>
      )}
      {lesson && c.confirmed && (
        <div
          className={telling && need.line ? 'need-pair told' : 'need-pair'}
          tabIndex={letter ? 0 : undefined}
          onFocus={() => letter && onHoverNeed?.(letter)}
          onBlur={() => letter && onHoverNeed?.(null)}
        >
          <p className="stays">
            <span className="pair-label">Stays here</span>
            <q>{c.text}</q>
            <span className="c-who">{who}</span>
          </p>
          {telling && need.line ? (
            <p className="goes">
              <span className="pair-label">The cloud is told</span>
              <code className="need-line">{need.line}</code>
            </p>
          ) : (
            <p className="goes nothing">
              <span className="pair-label">The cloud is told</span>
              Stays here. Nothing is told.
            </p>
          )}
        </div>
      )}
      {lesson && telling && (need.sensitive ?? []).length > 0 && (
        <label className="read-it">
          <input type="checkbox" checked={Boolean(c.needAck)} disabled={!editable} onChange={(e) => actions.onNeedAck?.(c.id, e.target.checked)} />
          Send this need as worded. It has a word that may give the reason (“{need.sensitive!.join('”, “')}”).
        </label>
      )}
      {telling && need.typed && needInput}
      {telling && !need.line && <p className="need-told">Nothing is typed yet, so nothing is told.</p>}
      {need.line &&
        need.issues.map((v, i) => (
          <p className="caution" key={i}>
            This line cannot be sent: <b>{v.what}</b> {v.why}.
          </p>
        ))}
    </li>
  );
}

/**
 * Under an item a rule caught: what the cloud was shown of the constraint,
 * and what this device knows. The first is outgoing text, stand-ins and
 * all; the second never left the device.
 */
export function Caught({ check, constraint }: { check: ItemCheck; constraint?: Constraint }) {
  if (!check.constraintId || !constraint) return null;
  return (
    <dl className="caught">
      <div className="saw">
        <dt>The cloud was shown</dt>
        <dd>{check.cloudSaw ? <CloudText text={check.cloudSaw} /> : 'Nothing of this: the words are not in the text that was sent.'}</dd>
        {check.told && (
          <>
            <dt>The cloud was told</dt>
            <dd>
              <CloudText text={check.told} />
            </dd>
          </>
        )}
      </div>
      <div className="knows">
        <dt>Your device knows</dt>
        <dd>
          <q>{constraint.text}</q>
        </dd>
      </div>
    </dl>
  );
}
