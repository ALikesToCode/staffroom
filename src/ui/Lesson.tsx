import { MaterialsWire } from './Materials';
import { allGotIt, SAMPLE_TICKET, TICKET_MARK, TICKET_MARKS, type ClassRow, type Ticket } from '../core/ticket';
import { useEffect, useRef, useState } from 'react';
import type { DraftItem } from '../core/types';
import {
  ADJUSTMENT_MAX,
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
import { byChild, POINT_MAX, type ChildNote, type Point } from '../core/points';
import { ADJUSTMENT_REPEATS } from '../core/repeats';
import { RECORDED_FIT_LABEL } from '../core/recorded';

/** Said over an adjustment the on-device model suggested. */
export const MODEL_LABEL = 'Suggested on this device from your private note. Nothing was sent.';
export const TEACHER_LABEL = 'Written by you';
/** Said over a line the cloud wrote for a need, placed beside a child here. */
export const CLOUD_LABEL = 'Written by the cloud for a need you approved. It did not know whose. Placed beside this child on this device.';
/** Said beside a child for a need the cloud was told and wrote nothing for. */
export const NOTHING_WRITTEN = (letter: string) => `The cloud wrote nothing for Need ${letter}.`;
/** Said over a line this device wrote about two children together. */
export const PAIR_LABEL = 'By rule, on this device';
/** Said over a point the on-device model wrote when asked for more ideas. */
export const MORE_LABEL = 'Suggested on this device from your private note. Read it closely: a small model wrote it.';
const SOURCE_LABEL = { model: MODEL_LABEL, starter: STARTER_LABEL, teacher: TEACHER_LABEL, cloud: CLOUD_LABEL } as const;
const POINT_LABEL = { ...SOURCE_LABEL, model: MORE_LABEL } as const;

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
function HitRow({ hit, adj, live, canModel, busy, said, recorded, stage, actions }: { hit: LessonHit; adj?: Adjustment; live: boolean; canModel: boolean; busy: boolean; said?: string; recorded: boolean; stage?: string; actions: HitActions }) {
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
    <li className={`child-hit ${adj?.state ?? 'open'}`}>
      <p className="hit-why">
        {stage && <span className="stage-tag">{stage}</span>}
        {hit.line}
      </p>
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
  stages,
  actions,
}: {
  hits: LessonHit[];
  /** The names of the stages, to tag each hit with its own. */
  stages?: readonly string[];
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
        <HitRow key={h.key} hit={h} adj={adjustments[h.key]} live={live} canModel={canModel} busy={busyKey === h.key} said={notes[h.key]} recorded={recorded} stage={stages?.[h.itemIndex]} actions={actions} />
      ))}
    </ul>
  );
}

export interface PointActions {
  onAccept: (key: string) => void;
  /** Save changed words, or another stage, for a point. Returns what is wrong, or undefined when it was accepted. */
  onSave: (key: string, itemIndex: number, text: string) => string | undefined;
  /** Add a point the teacher typed. Returns what is wrong, or undefined when it was added. */
  onAdd: (childId: string, itemIndex: number, text: string) => string | undefined;
  onDrop: (key: string) => void;
  /** Open an accepted point again. */
  onReopen: (key: string) => void;
  onSeen: (key: string) => void;
  repeats: (childId: string, text: string) => boolean;
  /** Put the starter wording in place of a line a rule fires on. It still waits to be accepted. */
  onStarter: (key: string) => void;
  /** Ask the on-device model for more ideas for one child. Only on request. */
  onMore: (childId: string) => void;
}

/** The stage and the words of a point, typed by the teacher. */
function PointForm({ child, stages, from, onSave, onCancel }: { child: string; stages: readonly string[]; from?: Point; onSave: (itemIndex: number, text: string) => string | undefined; onCancel: () => void }) {
  const [itemIndex, setItemIndex] = useState(from?.itemIndex ?? 0);
  const [text, setText] = useState(from?.text ?? '');
  const [wrong, setWrong] = useState<string | undefined>();
  return (
    <div className="rewrite">
      <label>
        Stage
        <select value={itemIndex} onChange={(e) => setItemIndex(Number(e.target.value))}>
          {stages.map((name, i) => (
            <option key={i} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        What {child} needs in this stage
        <textarea rows={2} value={text} maxLength={POINT_MAX} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      {wrong && <span className="caution">{wrong}</span>}
      <div className="actions">
        <button
          className="secondary small"
          onClick={() => {
            const said = onSave(itemIndex, text);
            setWrong(said);
            if (!said) onCancel();
          }}
        >
          Save and check by rule
        </button>
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
        <span className="hint">It stays on this device.</span>
      </div>
    </div>
  );
}

/** One thing a child needs in one stage: the words, who wrote them, and the teacher's choice. */
function PointRow({ point, stages, live, recorded, actions }: { point: Point; stages: readonly string[]; live: boolean; recorded: boolean; actions: PointActions }) {
  const [changing, setChanging] = useState(false);
  const offer = useRef<HTMLDivElement>(null);
  const waiting = point.state === 'offered' && !point.seen;

  // A point counts as shown once it has been on screen.
  useEffect(() => {
    const el = offer.current;
    if (!waiting || !el) return;
    if (typeof IntersectionObserver === 'undefined') return actions.onSeen(point.key);
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && actions.onSeen(point.key), { threshold: 0.6 });
    seen.observe(el);
    return () => seen.disconnect();
    // The handlers are new on every render; the point and its key are what matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, point.key]);

  return (
    <li className={`child-hit ${point.state}`}>
      {!changing && (
        <div className="adjustment" ref={offer}>
          {point.nothing ? (
            <p>
              <span className="stage-tag need-tag">Need {point.need}</span>
              {NOTHING_WRITTEN(point.need ?? '')}
            </p>
          ) : (
            <>
              <span className="adj-source">{point.pair ? PAIR_LABEL : recorded && point.source === 'model' ? RECORDED_FIT_LABEL : POINT_LABEL[point.source]}</span>
              <p>
                <span className="stage-tag">{stages[point.itemIndex]}</span>
                {point.need && <span className="stage-tag need-tag">Need {point.need}</span>}
                {point.text}
              </p>
            </>
          )}
          {point.why && <span className="caution">{point.why}</span>}
          {actions.repeats(point.childId, point.text) && <span className="caution">{ADJUSTMENT_REPEATS}</span>}
        </div>
      )}
      {live && changing && <PointForm child={point.child} stages={stages} from={point} onSave={(i, text) => actions.onSave(point.key, i, text)} onCancel={() => setChanging(false)} />}
      {live && !changing && (
        <div className="actions hit-actions">
          {point.state === 'offered' ? (
            <>
              {!point.nothing && (
                <button className="primary small" onClick={() => actions.onAccept(point.key)}>
                  Accept
                </button>
              )}
              {(point.why || point.nothing) && point.starter && (
                <button className="secondary small" onClick={() => actions.onStarter(point.key)} title={point.starter}>
                  Use starter wording
                </button>
              )}
              <button className="link" onClick={() => setChanging(true)}>
                {point.nothing ? 'Write it yourself' : 'Change'}
              </button>
            </>
          ) : (
            <button className="link" onClick={() => actions.onReopen(point.key)}>
              Change
            </button>
          )}
          <button className="link" onClick={() => actions.onDrop(point.key)}>
            Drop
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * "Fit to each child": one section for each child the note says something
 * about. What the note says, folded; then the steps that go against a
 * constraint the teacher confirmed, then the points offered for that child.
 */
export function ChildSections({
  notes,
  stages,
  hits,
  adjustments,
  points,
  live,
  canModel,
  busyKey,
  busyChild,
  hitNotes,
  said,
  recorded = false,
  hitActions,
  pointActions,
}: {
  notes: readonly ChildNote[];
  /** The names of the stages, in the lesson's order. */
  stages: readonly string[];
  hits: LessonHit[];
  adjustments: Adjustments;
  points: readonly Point[];
  live: boolean;
  canModel: boolean;
  busyKey: string | null;
  /** The child the device is writing points for now. */
  busyChild: string | null;
  hitNotes: Record<string, string>;
  /** Said in a child's section after a fit: nothing suggested, a point dropped, no answer. */
  said: Record<string, string>;
  recorded?: boolean;
  hitActions: HitActions;
  pointActions: PointActions;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const forClass = hits.filter((h) => !h.childId || !notes.some((n) => n.id === h.childId));
  const rows = (list: LessonHit[]) => (
    <LessonHits hits={list} adjustments={adjustments} live={live} canModel={canModel} busyKey={busyKey} notes={hitNotes} recorded={recorded} stages={stages} actions={hitActions} />
  );
  return (
    <div className="children">
      {notes.map((n) => {
        const mine = points.filter((p) => p.childId === n.id);
        return (
          <section key={n.id} className="child" aria-label={n.name}>
            <h4>{n.name}</h4>
            <details className="from-note">
              <summary>From your note</summary>
              <ul className="quotes">
                {n.sentences.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
            {rows(hits.filter((h) => h.childId === n.id))}
            {mine.length > 0 && (
              <ul className="hits">
                {mine.map((p) => (
                  <PointRow key={p.key} point={p} stages={stages} live={live} recorded={recorded} actions={pointActions} />
                ))}
              </ul>
            )}
            {busyChild === n.id && <p className="hint">Reading the note about {n.child} on this device…</p>}
            {said[n.id] && <p className="hint">{said[n.id]}</p>}
            {live && adding === n.id && <PointForm child={n.child} stages={stages} onSave={(i, text) => pointActions.onAdd(n.id, i, text)} onCancel={() => setAdding(null)} />}
            {live && adding !== n.id && (
              <div className="actions hit-actions">
                <button className="link" onClick={() => setAdding(n.id)}>
                  Write what {n.child} needs
                </button>
                {canModel && (
                  <button className="link" disabled={busyChild !== null || busyKey !== null} onClick={() => pointActions.onMore(n.id)}>
                    More ideas from this device
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
      {forClass.length > 0 && (
        <section className="child" aria-label="The class">
          <h4>The class</h4>
          {rows(forClass)}
        </section>
      )}
    </div>
  );
}

/** "For these children": what was accepted, by child and then by stage. Names are written out: this part is for the teacher only. */
export function ForTheseChildren({ stages, adjustments }: { stages: readonly DraftItem[]; adjustments: readonly SavedAdjustment[] }) {
  const groups = byChild(stages, adjustments);
  if (groups.length === 0) return <p className="hint">Nothing was accepted for any child in this lesson.</p>;
  return (
    <dl className="for-children">
      {groups.map((g) => (
        <div key={g.child}>
          <dt>{g.child}</dt>
          {g.lines.map((l, i) => (
            <dd key={i}>
              <b>{l.stage}:</b> {l.text}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}

const DONE: StageDone[] = ['done', 'partly', 'not'];

/** One saved lesson: the plan, the adjustments, how it went, and the way to the next lesson. */
function LessonCard({
  lesson,
  classList,
  sample,
  open,
  onAfter,
  onNext,
  onDelete,
}: {
  lesson: SavedLesson;
  /** The children the exit ticket is marked for. */
  classList: readonly string[];
  /** True for the invented class: an invented result can be filled in. */
  sample: boolean;
  open: boolean;
  onAfter: (after: SavedLesson['after']) => void;
  onNext: () => void;
  onDelete: () => void;
}) {
  const [stages, setStages] = useState<(StageDone | null)[]>(() => lesson.stages.map((_, i) => lesson.after?.stages[i] ?? null));
  const [line, setLine] = useState(lesson.after?.line ?? '');
  const [ticket, setTicket] = useState<Ticket>(() => lesson.after?.ticket ?? {});
  const said = lesson.after !== undefined;
  const marked = Object.keys(ticket).length;
  const after = (t: Ticket, s = stages) => ({ stages: s, line: line.trim(), at: new Date().toISOString(), ...(Object.keys(t).length > 0 ? { ticket: t } : {}) });
  const fillSample = () => {
    const done = lesson.stages.map(() => 'done' as const);
    setTicket(SAMPLE_TICKET);
    setStages(done);
    onAfter(after(SAMPLE_TICKET, done));
  };
  return (
    <li>
      <details open={open || undefined}>
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
        {lesson.materials && (
          <details className="saved-materials">
            <summary>Materials</summary>
            <MaterialsWire result={{ ...lesson.materials, dropped: 0, same: lesson.materials.same ?? [], missing: [] }} />
          </details>
        )}
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
        <h4>Exit ticket, child by child</h4>
        {classList.length === 0 ? (
          <p className="hint">Add a class list on the Write screen to mark each child here.</p>
        ) : (
          <>
            <ul className="how-went ticket">
              {classList.map((child) => (
                <li key={child} role="group" aria-label={child}>
                  <span>{child}</span>
                  {TICKET_MARKS.map((m) => (
                    <button
                      key={m}
                      className={ticket[child] === m ? 'choice on' : 'choice'}
                      aria-pressed={ticket[child] === m}
                      onClick={() => setTicket(({ [child]: was, ...rest }) => (was === m ? rest : { ...rest, [child]: m }))}
                    >
                      {TICKET_MARK[m]}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="secondary small" onClick={() => setTicket(allGotIt(classList))}>
                All got it
              </button>
              {sample && (
                <button className="secondary small" onClick={fillSample}>
                  Fill an invented result
                </button>
              )}
              <span className="hint">
                {marked === 0 ? 'One tap for each child. ' : ''}Kept in this browser with the lesson. Who got it is never sent: the next lesson is told only needs,
                with no name and no count.
              </span>
            </div>
          </>
        )}
        <label className="lesson-field">
          One line about the lesson <small>optional, no names</small>
          <input type="text" value={line} maxLength={240} onChange={(e) => setLine(e.target.value)} />
        </label>
        <div className="actions">
          <button className="secondary small" onClick={() => onAfter(after(ticket))}>
            {said ? 'Save again' : 'Save how it went'}
          </button>
          <button className="primary small" onClick={onNext}>
            Plan the next lesson
          </button>
          <button className="link" onClick={onDelete}>
            Delete
          </button>
        </div>
        <p className="hint">The next lesson is told the stages and whether each was done, your line, and the needs the exit ticket gives, by letter. No name, no count and no adjustment is told.</p>
      </details>
    </li>
  );
}

/** The lessons signed off on this device. They hold names, so they are kept here and nowhere else. */
export function Lessons({
  lessons,
  classList,
  sample,
  view,
  onAfter,
  onNext,
  onDelete,
  onDeleteAll,
}: {
  lessons: SavedLesson[];
  classList: readonly string[];
  sample: boolean;
  /** The class at a glance: each child across the last lessons, and the needs that stand. */
  view: { lessons: SavedLesson[]; rows: ClassRow[] };
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
              <LessonCard key={l.id} lesson={l} classList={classList} sample={sample} open={l === lessons[0]} onAfter={(after) => onAfter(l.id, after)} onNext={() => onNext(l)} onDelete={() => onDelete(l.id)} />
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
      {classList.length > 0 && (view.lessons.length > 0 || view.rows.some((r) => r.needs.length > 0)) && (
        <section className="class-view" aria-label="The class">
          <h3>The class</h3>
          <p className="hint">
            Each child across the last lessons with an exit ticket, and the needs that stand. Built and kept on this device only. “Forget this
            class” on the Desk wipes it.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Child</th>
                  {view.lessons.map((l) => (
                    <th scope="col" key={l.id} title={l.fields.topic}>
                      {l.fields.topic.length > 18 ? `${l.fields.topic.slice(0, 17)}…` : l.fields.topic}
                    </th>
                  ))}
                  <th scope="col">Needs that stand</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.child}>
                    <th scope="row">{r.child}</th>
                    {r.marks.map((m, i) => (
                      <td key={i} className={m ? `mark m-${m}` : 'mark'}>
                        {m ? TICKET_MARK[m] : '–'}
                      </td>
                    ))}
                    <td>{r.needs.join('; ') || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
