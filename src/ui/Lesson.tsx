import { useEffect, useRef, useState } from 'react';
import type { DraftItem } from '../core/types';
import {
  ADJUSTMENT_MAX,
  forTheseChildren,
  STAGE_DONE,
  STARTER_LABEL,
  stageName,
  type Adjustment,
  type Adjustments,
  type LessonHit,
  type SavedAdjustment,
  type SavedLesson,
  type StageDone,
} from '../core/lesson';
import { ADJUSTMENT_REPEATS } from '../core/repeats';
import { RECORDED_FIT_LABEL } from '../core/recorded';

/** Said over an adjustment the on-device model suggested. */
export const MODEL_LABEL = 'Suggested on this device from your private note. Nothing was sent.';
export const TEACHER_LABEL = 'Written by you';
const SOURCE_LABEL = { model: MODEL_LABEL, starter: STARTER_LABEL, teacher: TEACHER_LABEL } as const;

export interface HitActions {
  /** Ask for words: the on-device model when it is here, the starter when it is not. */
  onSuggest: (hit: LessonHit) => void;
  onAccept: (hit: LessonHit) => void;
  /** Save typed words. Returns what is wrong with them, or undefined when they were accepted. */
  onSave: (hit: LessonHit, text: string) => string | undefined;
  onLeave: (hit: LessonHit) => void;
  /** Open a settled hit again. */
  onReopen: (hit: LessonHit) => void;
  onSeen: (key: string) => void;
  /** True when these words repeat words of the private note about that child. */
  repeats: (hit: LessonHit, text: string) => boolean;
}

/** One child a step does not suit: why, and the adjustment as it stands. */
function HitRow({ hit, adj, live, canModel, busy, said, recorded, actions }: { hit: LessonHit; adj?: Adjustment; live: boolean; canModel: boolean; busy: boolean; said?: string; recorded: boolean; actions: HitActions }) {
  const [typing, setTyping] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | undefined>();
  const [leaving, setLeaving] = useState(false);
  const [readWhy, setReadWhy] = useState(false);
  const offer = useRef<HTMLDivElement>(null);
  const waiting = adj?.state === 'offered' && !adj.seen;

  // An offer counts as shown once it has been on screen.
  useEffect(() => {
    const el = offer.current;
    if (!waiting || !el) return;
    if (typeof IntersectionObserver === 'undefined') return actions.onSeen(hit.key);
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && actions.onSeen(hit.key), { threshold: 0.6 });
    seen.observe(el);
    return () => seen.disconnect();
    // The handlers are new on every render; the offer and its key are what matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, hit.key]);

  const save = () => {
    const said = actions.onSave(hit, typing ?? '');
    setWrong(said);
    if (!said) setTyping(null);
  };

  return (
    <li className={`hit ${adj?.state ?? 'open'}`}>
      <p className="hit-why">{hit.line}</p>
      {adj && adj.state !== 'left' && typing === null && (
        <div className="adjustment" ref={offer}>
          <span className="adj-source">{recorded && adj.source === 'model' ? RECORDED_FIT_LABEL : SOURCE_LABEL[adj.source]}</span>
          <p>
            <b>{hit.child}:</b> {adj.text}
          </p>
          {adj.said && <span className="hint">{adj.said}</span>}
          {actions.repeats(hit, adj.text) && <span className="caution">{ADJUSTMENT_REPEATS}</span>}
        </div>
      )}
      {said && !adj && <p className="caution">{said}</p>}
      {adj?.state === 'left' && <p className="adjustment left">Left as it is for {hit.child}. You read why it may not suit.</p>}
      {live && typing !== null && (
        <div className="rewrite">
          <label>
            What {hit.child} does instead
            <textarea rows={2} value={typing} maxLength={ADJUSTMENT_MAX} onChange={(e) => setTyping(e.target.value)} spellCheck={false} autoComplete="off" />
          </label>
          {wrong && <span className="caution">{wrong}</span>}
          <div className="actions">
            <button className="secondary small" onClick={save}>
              Save and check by rule
            </button>
            <button className="link" onClick={() => (setTyping(null), setWrong(undefined))}>
              Cancel
            </button>
            <span className="hint">It stays on this device.</span>
          </div>
        </div>
      )}
      {live && typing === null && !leaving && (
        <div className="actions hit-actions">
          {adj?.state === 'offered' && (
            <button className="primary small" onClick={() => actions.onAccept(hit)}>
              Accept
            </button>
          )}
          {!adj && (
            <button className="primary small" disabled={busy} onClick={() => actions.onSuggest(hit)}>
              {busy ? 'Fitting on this device…' : canModel ? 'Fit on this device' : 'Use starter wording'}
            </button>
          )}
          {adj && adj.state !== 'offered' ? (
            <button className="link" onClick={() => actions.onReopen(hit)}>
              Change
            </button>
          ) : (
            <>
              <button className="link" disabled={busy} onClick={() => setTyping(adj?.text ?? '')}>
                {adj ? 'Change' : 'Write it yourself'}
              </button>
              <button className="link" disabled={busy} onClick={() => setLeaving(true)}>
                Leave the step as it is for this child
              </button>
            </>
          )}
        </div>
      )}
      {live && leaving && (
        <div className="confirm">
          <label className="read-it">
            <input type="checkbox" checked={readWhy} onChange={(e) => setReadWhy(e.target.checked)} />I have read why this step may not suit {hit.child}.
          </label>
          <div className="actions">
            <button className="secondary small" disabled={!readWhy} onClick={() => (actions.onLeave(hit), setLeaving(false), setReadWhy(false))}>
              Leave the step as it is
            </button>
            <button className="link" onClick={() => setLeaving(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Under one stage of the lesson: each child it does not suit, and what that child does instead. */
export function LessonHits({
  hits,
  adjustments,
  live,
  canModel,
  busyKey,
  notes = {},
  recorded = false,
  actions,
}: {
  hits: LessonHit[];
  adjustments: Adjustments;
  /** False after sign-off and in a replay: nothing can be changed. */
  live: boolean;
  canModel: boolean;
  /** The hit the device is fitting now. */
  busyKey: string | null;
  /** Said under a hit for which nothing could be offered. */
  notes?: Record<string, string>;
  /** True in a replay: a model's adjustment is labelled as made in the recorded run. */
  recorded?: boolean;
  actions: HitActions;
}) {
  if (hits.length === 0) return null;
  return (
    <ul className="hits">
      {hits.map((h) => (
        <HitRow key={h.key} hit={h} adj={adjustments[h.key]} live={live} canModel={canModel} busy={busyKey === h.key} said={notes[h.key]} recorded={recorded} actions={actions} />
      ))}
    </ul>
  );
}

/** "For these children": what was accepted, by stage. Names are written out: this part is for the teacher only. */
export function ForTheseChildren({ stages, adjustments }: { stages: readonly DraftItem[]; adjustments: readonly SavedAdjustment[] }) {
  const groups = forTheseChildren(stages, adjustments);
  if (groups.length === 0) return <p className="hint">No adjustment was accepted for this lesson.</p>;
  return (
    <dl className="for-children">
      {groups.map((g) => (
        <div key={g.stage}>
          <dt>{g.stage}</dt>
          {g.lines.map((l, i) => (
            <dd key={i}>
              <b>{l.child}:</b> {l.text}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}

const DONE: StageDone[] = ['done', 'partly', 'not'];

/** One saved lesson: the plan, the adjustments, how it went, and the way to the next lesson. */
function LessonCard({ lesson, onAfter, onNext, onDelete }: { lesson: SavedLesson; onAfter: (after: SavedLesson['after']) => void; onNext: () => void; onDelete: () => void }) {
  const [stages, setStages] = useState<(StageDone | null)[]>(() => lesson.stages.map((_, i) => lesson.after?.stages[i] ?? null));
  const [line, setLine] = useState(lesson.after?.line ?? '');
  const said = lesson.after !== undefined;
  return (
    <li>
      <details>
        <summary>
          <b>{lesson.fields.topic}</b>
          <span>
            {[lesson.fields.klass, lesson.fields.subject].filter(Boolean).join(' · ')} · {new Date(lesson.savedAt).toLocaleDateString([], { dateStyle: 'medium' })}
            {said ? ' · you said how it went' : ''}
          </span>
        </summary>
        <ol className="saved-stages">
          {lesson.stages.map((s, i) => (
            <li key={i}>
              <b>{s.heading}</b> <span>{s.text}</span>
            </li>
          ))}
        </ol>
        <h4>For these children</h4>
        <ForTheseChildren stages={lesson.stages} adjustments={lesson.adjustments} />
        <h4>How did it go?</h4>
        <ul className="how-went">
          {lesson.stages.map((s, i) => (
            <li key={i} role="group" aria-label={stageName(s.heading)}>
              <span>{stageName(s.heading)}</span>
              {DONE.map((d) => (
                <button key={d} className={stages[i] === d ? 'choice on' : 'choice'} aria-pressed={stages[i] === d} onClick={() => setStages((v) => v.map((x, j) => (j === i ? d : x)))}>
                  {STAGE_DONE[d]}
                </button>
              ))}
            </li>
          ))}
        </ul>
        <label className="field">
          One line about the lesson <small>optional, no names</small>
          <input type="text" value={line} maxLength={240} onChange={(e) => setLine(e.target.value)} />
        </label>
        <div className="actions">
          <button className="secondary small" onClick={() => onAfter({ stages, line: line.trim(), at: new Date().toISOString() })}>
            {said ? 'Save again' : 'Save how it went'}
          </button>
          <button className="primary small" onClick={onNext}>
            Plan the next lesson
          </button>
          <button className="link" onClick={onDelete}>
            Delete
          </button>
        </div>
        <p className="hint">The next lesson is told the stages and whether each was done, and your line. No adjustment is told.</p>
      </details>
    </li>
  );
}

/** The lessons signed off on this device. They hold names, so they are kept here and nowhere else. */
export function Lessons({
  lessons,
  onAfter,
  onNext,
  onDelete,
  onDeleteAll,
}: {
  lessons: SavedLesson[];
  onAfter: (id: string, after: SavedLesson['after']) => void;
  onNext: (lesson: SavedLesson) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}) {
  return (
    <main className="page">
      <h2>Lessons</h2>
      <p className="lede">Signed lessons, kept in this browser only. Say how one went, then plan the next from it.</p>
      {lessons.length === 0 ? (
        <p className="empty">No lesson has been signed off on this device.</p>
      ) : (
        <>
          <ul className="lesson-list">
            {lessons.map((l) => (
              <LessonCard key={`${l.id}:${l.after?.at ?? ''}`} lesson={l} onAfter={(after) => onAfter(l.id, after)} onNext={() => onNext(l)} onDelete={() => onDelete(l.id)} />
            ))}
          </ul>
          <div className="actions">
            <button className="link" onClick={onDeleteAll}>
              Delete all {lessons.length}
            </button>
            <span className="hint">Thirty at most are kept. Nothing here is in your account.</span>
          </div>
        </>
      )}
    </main>
  );
}
