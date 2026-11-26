import { useState } from 'react';
import type { Constraint, ConstraintKind, Entity } from '../core/types';
import { CONSTRAINT_KINDS, CONSTRAINT_LABEL } from '../core/constraints';

export interface ConstraintActions {
  onConfirm: (id: string) => void;
  onUnconfirm: (id: string) => void;
  onRemove: (id: string) => void;
  onKind: (id: string, kind: ConstraintKind) => void;
  onTriggers: (id: string, typed: string) => void;
  onAdd: (by: { kind: ConstraintKind; about?: string; text: string }) => void;
}

const FOUND_BY: Record<Constraint['source'], string> = {
  rule: 'found by rule',
  'on-device model': 'found by the on-device model',
  teacher: 'added by you',
};

/** What the rules read from the words of a constraint, said in a few words. */
export function constraintDetail(c: Constraint): string {
  if (c.kind === 'days-away') return (c.days ?? []).length > 0 ? `Days: ${c.days!.join(', ')}` : 'No day is named, so no rule can check this one.';
  if (c.kind === 'contact') {
    if (!c.who) return 'No adult is named, so a step that contacts a parent is only queried.';
    return `Adult: ${c.who}${c.away ? ', not there to contact' : ', not to be contacted'}${c.guardian ? `. Looked after by: ${c.guardian}` : ''}`;
  }
  if (c.kind === 'other') return 'No rule can check this one. Only the on-device model can.';
  return '';
}

/**
 * The constraints of a note: proposed ones to confirm, confirmed ones, and
 * a form to add one by hand. Everything here stays on the device.
 */
export function ConstraintsPanel({
  constraints,
  students,
  editable,
  selection,
  actions,
}: {
  constraints: Constraint[];
  students: Entity[];
  editable: boolean;
  /** The words selected in the note, offered as the words of a new constraint. */
  selection: string;
  actions: ConstraintActions;
}) {
  const [about, setAbout] = useState('');
  const [kind, setKind] = useState<ConstraintKind>('time-after');
  const [text, setText] = useState('');
  const nameOf = (id: string | undefined) => students.find((s) => s.id === id)?.surfaces[0];
  const add = () => {
    if (text.trim().length === 0) return;
    actions.onAdd({ kind, about: about || undefined, text });
    setText('');
  };
  return (
    <div className="constraints">
      <p className="hint">
        A constraint is a private fact that rules something out for a student. Confirm the ones that are right. A confirmed
        constraint is withheld from the cloud, and every step of the draft is checked against it on this device, by rule.
      </p>
      {constraints.length === 0 ? (
        <p className="empty">No constraint was found. Add one below if there is one.</p>
      ) : (
        <ul className="constraint-list">
          {constraints.map((c) => (
            <li key={c.id} className={c.confirmed ? 'constraint confirmed' : 'constraint'}>
              <q>{c.text}</q>
              <small>
                About {nameOf(c.about) ?? 'the class'} · {FOUND_BY[c.source]}
                {c.source === 'rule' && c.alsoModel ? ' and model' : ''} · {c.confirmed ? 'confirmed by you' : 'not confirmed'}
              </small>
              <label>
                Kind{' '}
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
              {constraintDetail(c) && <small>{constraintDetail(c)}</small>}
              {c.kind === 'health' && (
                <label>
                  Words that go against it in a step, separated by commas{' '}
                  <input
                    type="text"
                    defaultValue={(c.triggers ?? []).join(', ')}
                    key={(c.triggers ?? []).join(',')}
                    disabled={!editable}
                    onBlur={(e) => actions.onTriggers(c.id, e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
              )}
              {editable && (
                <span className="actions">
                  {c.confirmed ? (
                    <button className="link" onClick={() => actions.onUnconfirm(c.id)}>
                      Unconfirm
                    </button>
                  ) : (
                    <button className="secondary" onClick={() => actions.onConfirm(c.id)}>
                      Confirm
                    </button>
                  )}
                  <button className="link" onClick={() => actions.onRemove(c.id)}>
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <fieldset className="constraint-add">
          <legend>Add a constraint</legend>
          <label>
            About{' '}
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
            Kind{' '}
            <select value={kind} onChange={(e) => setKind(e.target.value as ConstraintKind)}>
              {CONSTRAINT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONSTRAINT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            The words{' '}
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
          <span className="actions">
            {selection && selection !== text && (
              <button className="link" onClick={() => setText(selection)}>
                Use the words selected in the note
              </button>
            )}
            <button className="secondary" disabled={text.trim().length === 0} onClick={add}>
              Add and confirm
            </button>
          </span>
          <p className="hint">Words that stand in your note are withheld. Words you only type here are in no text that is sent.</p>
        </fieldset>
      )}
    </div>
  );
}
