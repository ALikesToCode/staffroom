import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entity, ItemCheck, Kind, LabelWhere, Receipt, TaskId, Where } from './core/types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE, TASKS } from './core/samples';
import { addByTeacher, appearsIn, applyLocks, buildVault, deterministicCandidates, redact, restore, segment } from './core/vault';
import { checkOutgoing, checkReply, type Violation } from './core/gate';
import { loadReceipts, makeReceipt, storeReceipts } from './core/receipts';
import { configured, DEFAULT_POLICY, loadPolicy, saveReceiptCopy, watchUser, type Policy } from './ai/firebase';
import { deviceStatus, prepareDevice, ROUTES, type DeviceStatus } from './ai/routes';
import { guardOnDevice, paragraphs } from './ai/guard';
import { labelReceipt, writeDraft, type DraftResult } from './ai/draft';
import { anythingToCheck, checkOnDevice, detailsFor, NOTHING_WITHHELD } from './ai/check';
import { CloudText, DeviceText, KIND_LABEL, RouteChip, Spinner, Stepper } from './ui/parts';

type Stage = 'write' | 'guarding' | 'review' | 'drafting' | 'checking' | 'result' | 'signed';
type View = 'desk' | 'receipts' | 'how';

const STEP: Record<Stage, number> = { write: 0, guarding: 1, review: 2, drafting: 3, checking: 4, result: 5, signed: 6 };

const read = <T,>(storage: () => Storage, key: string, fallback: T): T => {
  try {
    const raw = storage().getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

/** Write a value, or remove the key when the value is empty. Storage can be switched off: that is not an error. */
const write = (storage: () => Storage, key: string, value: unknown, empty: boolean) => {
  try {
    if (empty) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do: the value stays in memory for this page only.
  }
};

// The raw note and the class list are kept for this tab only, and are gone when it closes.
// Settings and receipts (which hold only approved text) stay in local storage.
const session = () => sessionStorage;
const local = () => localStorage;
const NOTE_KEY = 'staffroom.note';
const CLASS_LIST_KEY = 'staffroom.classList';

// Earlier versions kept the raw note and the class list in local storage. Remove what they left.
try {
  localStorage.removeItem(NOTE_KEY);
  localStorage.removeItem(CLASS_LIST_KEY);
} catch {
  // Storage is switched off, so there is nothing to remove.
}

const NO_GAPS: { unread: number[]; dropped: number } = { unread: [], dropped: 0 };

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [view, setView] = useState<View>('desk');
  const [stage, setStage] = useState<Stage>('write');
  const [note, setNote] = useState(() => read(session, NOTE_KEY, ''));
  const [classList, setClassList] = useState<string[]>(() => read(session, CLASS_LIST_KEY, []));
  const [task, setTask] = useState<TaskId>('plan');

  const [device, setDevice] = useState<DeviceStatus>('checking');
  const [download, setDownload] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [uid, setUid] = useState<string | null>(null);
  const [keepCopies, setKeepCopies] = useState(() => read(local, 'staffroom.keepCopies', false));

  /** The vault as the guard and the teacher left it. Read `entities` below, which has the school's locks applied. */
  const [rawEntities, setEntities] = useState<Entity[]>([]);
  const [guardWhere, setGuardWhere] = useState<Where>('NOT_RUN');
  const [guardGaps, setGuardGaps] = useState<{ unread: number[]; dropped: number }>(NO_GAPS);
  const [progress, setProgress] = useState('');
  const [selection, setSelection] = useState('');
  /** The exact outgoing text the teacher ticked as read. The tick holds only while this is still the outgoing text. */
  const [readText, setReadText] = useState<string | null>(null);
  /** What was approved: the text, when, and the vault as it stood at that moment. */
  const [sent, setSent] = useState<{ text: string; at: string; entities: Entity[] } | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [replyIssues, setReplyIssues] = useState<Violation[]>([]);
  const [replyRead, setReplyRead] = useState(false);
  const [checks, setChecks] = useState<ItemCheck[]>([]);
  const [checkWhere, setCheckWhere] = useState<Where>('NOT_RUN');
  const [kept, setKept] = useState<boolean[]>([]);
  const [label, setLabel] = useState<{ title: string; where: LabelWhere } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>(loadReceipts);
  const [copyState, setCopyState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const noteRef = useRef<HTMLDivElement>(null);
  /** The policy as last loaded, readable at the moment of sending even before a re-render. */
  const policyRef = useRef<Policy>(DEFAULT_POLICY);

  // ---------------------------------------------------------------- start-up

  useEffect(() => {
    deviceStatus().then(setDevice);
    loadPolicy().then((p) => {
      policyRef.current = p;
      setPolicy(p);
    });
    const stop = watchUser((u) => setUid(u?.uid ?? null));
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      stop();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => write(session, NOTE_KEY, note, note === ''), [note]);
  useEffect(() => write(session, CLASS_LIST_KEY, classList, classList.length === 0), [classList]);
  useEffect(() => write(local, 'staffroom.keepCopies', keepCopies, false), [keepCopies]);

  const currentTask = TASKS.find((t) => t.id === task)!;
  // The school's locks are part of how the outgoing text is computed, not only a disabled switch:
  // an item of a locked kind is withheld even if the vault says released (the policy can arrive late).
  // After approval the vault is the one that was approved, so the record matches what was sent.
  const entities = useMemo(
    () => sent?.entities ?? applyLocks(rawEntities, policy.lockedKinds),
    [sent, rawEntities, policy.lockedKinds],
  );
  const outgoing = useMemo(() => redact(note, entities), [note, entities]);
  const violations = useMemo(() => checkOutgoing(outgoing, entities), [outgoing, entities]);
  const readIt = readText !== null && readText === outgoing;

  // The tick is for one exact text under one policy. If either changes, it is cleared.
  useEffect(() => setReadText(null), [outgoing, policy]);
  const deviceCanRun = device === 'available' || device === 'downloadable' || device === 'downloading';

  // ---------------------------------------------------------------- the on-device model

  /** Must be called from a click: Chrome only starts a model download after one. */
  const turnOnDevice = useCallback(async (): Promise<boolean> => {
    if (device === 'available') return true;
    if (!deviceCanRun) return false;
    try {
      setDownload(0);
      await prepareDevice((fraction) => setDownload(fraction));
      setDevice(await deviceStatus());
      return true;
    } catch (e) {
      setError(`The on-device model could not be loaded: ${message(e)}`);
      setDevice(await deviceStatus());
      return false;
    } finally {
      setDownload(null);
    }
  }, [device, deviceCanRun]);

  // ---------------------------------------------------------------- step 2: guard

  const runGuard = async () => {
    setError(null);
    setStage('guarding');
    setSelection('');
    setReadText(null);
    setSent(null);
    setResult(null);
    const candidates = deterministicCandidates(note, classList);
    let where: Where = 'RULES_ONLY';
    let gaps = NO_GAPS;
    setProgress('Checking the class list and the pattern rules');
    if (await turnOnDevice()) {
      try {
        const report = await guardOnDevice(note, (done, total) =>
          setProgress(`The on-device model is reading paragraph ${Math.min(done + 1, total)} of ${total}`),
        );
        candidates.push(...report.candidates);
        gaps = { unread: report.unread, dropped: report.dropped };
        where = 'ON_DEVICE';
      } catch (e) {
        setError(`The on-device guard stopped: ${message(e)} Only the rules were applied. Read the outgoing text with care.`);
      }
    }
    setEntities(buildVault(note, candidates));
    setGuardWhere(where);
    setGuardGaps(gaps);
    setStage('review');
  };

  const toggle = (id: string) =>
    setEntities((list) =>
      list.map((e) => (e.id === id && !policyRef.current.lockedKinds.includes(e.kind) ? { ...e, withheld: !e.withheld } : e)),
    );

  const onSelectText = () => {
    const text = window.getSelection()?.toString().trim() ?? '';
    setSelection(text.length >= 2 && text.length <= 240 && appearsIn(note, text) ? text : '');
  };

  const withholdSelection = (kind: Kind) => {
    setEntities((list) => addByTeacher(note, list, selection, kind));
    setSelection('');
    window.getSelection()?.removeAllRanges();
  };

  // ---------------------------------------------------------------- steps 3 to 5: approve, draft, check

  const approveAndSend = async () => {
    // Everything is worked out again at the moment of sending: the current locks, the text they give,
    // and the gate on exactly that text. It is sent only if it is the text the teacher ticked as read.
    const current = applyLocks(rawEntities, policyRef.current.lockedKinds);
    const text = redact(note, current);
    const stopped = checkOutgoing(text, current);
    if (stage !== 'review' || readText === null || text !== readText || stopped.length > 0) {
      setReadText(null);
      setError(
        stopped.length > 0
          ? 'The exit gate stopped the text. Nothing was sent.'
          : 'The outgoing text is not the text you ticked as read. Nothing was sent. Read it again, then approve.',
      );
      return;
    }
    const entities = current;
    const cloudModel = policyRef.current.cloudModel;
    setError(null);
    const approvedAt = new Date().toISOString();
    setSent({ text, at: approvedAt, entities });
    setStage('drafting');
    let drafted: DraftResult;
    try {
      drafted = await writeDraft(text, currentTask, cloudModel);
    } catch (e) {
      setSent(null);
      setStage('review');
      setError(
        configured
          ? `The draft could not be written: ${message(e)}`
          : 'This build has no Firebase project, so the cloud step is switched off. The on-device steps work. See the README to connect a project.',
      );
      return;
    }
    setResult(drafted);
    setKept(drafted.draft.items.map(() => true));
    const replyText = [drafted.draft.title, ...drafted.draft.items.flatMap((i) => [i.heading, i.text])].join('\n');
    setReplyIssues(checkReply(replyText, entities, text));
    setReplyRead(false);

    setStage('checking');
    let itemChecks: ItemCheck[];
    let where: Where = 'NOT_RUN';
    if (!anythingToCheck(drafted.draft.items, entities)) {
      // No item names a student with a withheld private detail: there is nothing to check, so no model is asked.
      itemChecks = drafted.draft.items.map(() => NOTHING_WITHHELD);
      where = 'SKIPPED';
    } else {
      try {
        if ((await deviceStatus()) !== 'available') throw new Error('no on-device model');
        itemChecks = await checkOnDevice(note, drafted.draft.items, entities, (done, total) =>
          setProgress(`The on-device model is checking item ${Math.min(done + 1, total)} of ${total}`),
        );
        where = 'ON_DEVICE';
      } catch {
        itemChecks = drafted.draft.items.map((item) =>
          detailsFor(item, entities).length > 0
            ? { verdict: 'not checked', reason: 'No on-device model was available. Read this item against the private details yourself.' }
            : NOTHING_WITHHELD,
        );
      }
    }
    setChecks(itemChecks);
    setCheckWhere(where);
    setProgress('Naming the receipt');
    setLabel(await labelReceipt(text, currentTask.label));
    setStage('result');
  };

  // ---------------------------------------------------------------- step 6: sign off

  const signOff = async () => {
    if (!result || !sent || replyBlocked) return;
    const receipt = makeReceipt({
      task,
      label: label?.title || currentTask.label,
      labelWhere: label?.where ?? 'FALLBACK',
      entities,
      guardWhere,
      unreadParagraphs: guardGaps.unread.length,
      droppedDetails: guardGaps.dropped,
      sentText: sent.text,
      approvedAt: sent.at,
      draftWhere: result.where,
      draftModel: result.model,
      checkWhere,
      replyFlagged: replyIssues.length > 0,
      checks,
      kept: kept.filter(Boolean).length,
      struck: kept.filter((k) => !k).length,
    });
    const next = [receipt, ...receipts];
    setReceipts(next);
    storeReceipts(next);
    setStage('signed');
    setCopyState('idle');
    if (keepCopies && uid) {
      try {
        await saveReceiptCopy(uid, receipt);
        setCopyState('saved');
      } catch {
        setCopyState('failed');
      }
    }
  };

  const finalText = useMemo(() => {
    if (!result) return '';
    const items = result.draft.items.filter((_, i) => kept[i]);
    return restore([result.draft.title, '', ...items.map((i) => `${i.heading}\n${i.text}\n`)].join('\n'), entities).trim();
  }, [result, kept, entities]);

  const copyFinal = async () => {
    if (replyBlocked) return;
    await navigator.clipboard.writeText(finalText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  /** Clear everything a run produced. The note and the class list stay. */
  const clearRun = () => {
    setStage('write');
    setEntities([]);
    setGuardWhere('NOT_RUN');
    setGuardGaps(NO_GAPS);
    setSelection('');
    setReadText(null);
    setSent(null);
    setResult(null);
    setChecks([]);
    setCheckWhere('NOT_RUN');
    setReplyIssues([]);
    setReplyRead(false);
    setKept([]);
    setLabel(null);
    setProgress('');
    setCopyState('idle');
    setError(null);
  };

  const startOver = clearRun;

  /** Forget the raw note, the class list, the vault and the results: from memory and from storage. */
  const forgetNote = () => {
    clearRun();
    setNote('');
    setClassList([]);
    try {
      sessionStorage.removeItem(NOTE_KEY);
      sessionStorage.removeItem(CLASS_LIST_KEY);
      localStorage.removeItem(NOTE_KEY);
      localStorage.removeItem(CLASS_LIST_KEY);
    } catch {
      // Storage is switched off, so nothing was kept there.
    }
    window.getSelection()?.removeAllRanges();
  };

  const loadSample = () => {
    setNote(SAMPLE_NOTE);
    setClassList(SAMPLE_CLASS_LIST);
  };

  // ---------------------------------------------------------------- render

  const withheld = entities.filter((e) => e.withheld);
  /** A reply flagged at the return gate cannot be signed off or copied until the teacher has read it. */
  const replyBlocked = replyIssues.length > 0 && !replyRead;
  const editing = stage === 'write';
  const busy = stage === 'guarding' || stage === 'drafting' || stage === 'checking';

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>Staffroom</h1>
            <p>What you write about a child stays on this device.</p>
          </div>
        </div>
        <nav aria-label="Sections">
          <button className={view === 'desk' ? 'tab on' : 'tab'} onClick={() => setView('desk')}>
            Desk
          </button>
          <button className={view === 'receipts' ? 'tab on' : 'tab'} onClick={() => setView('receipts')}>
            Receipts{receipts.length > 0 && <span className="count">{receipts.length}</span>}
          </button>
          <button className={view === 'how' ? 'tab on' : 'tab'} onClick={() => setView('how')}>
            How it works
          </button>
        </nav>
        <div className="status">
          <DevicePill device={device} download={download} onTurnOn={turnOnDevice} />
          <span className={`pill ${configured && online ? 'ok' : 'warn'}`}>
            <i />
            {!configured ? 'Cloud: not connected' : online ? 'Cloud: reachable' : 'Offline'}
          </span>
        </div>
      </header>

      {view === 'how' && <How policy={policy} device={device} />}
      {view === 'receipts' && (
        <Receipts
          receipts={receipts}
          keepCopies={keepCopies}
          setKeepCopies={setKeepCopies}
          signedIn={Boolean(uid)}
          onClear={() => {
            setReceipts([]);
            storeReceipts([]);
          }}
        />
      )}

      {view === 'desk' && (
        <main>
          <Stepper step={STEP[stage]} />
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <div className="lanes">
            {/* ------------------------------------------------ the device */}
            <section className="lane device" aria-label="On this device">
              <h2 className="lane-title">
                <span>On this device</span>
                <small>Your note, the real names and the private details never leave this side.</small>
              </h2>

              <article className="card">
                <div className="card-head">
                  <h3>Your note</h3>
                  <span className="head-links">
                    {editing ? (
                      <button className="link" onClick={loadSample}>
                        Use the sample class
                      </button>
                    ) : (
                      !busy && stage !== 'signed' && (
                        <button className="link" onClick={startOver}>
                          Edit note
                        </button>
                      )
                    )}
                    {!busy && (note !== '' || classList.length > 0) && (
                      <button
                        className="link forget"
                        onClick={forgetNote}
                        title="Clears the note, the class list, the vault and the results from this page and from this browser. Receipts are kept."
                      >
                        Forget this note
                      </button>
                    )}
                  </span>
                </div>

                {editing ? (
                  <>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Write what you noticed this week, as you would in your own notebook. Names, family matters, health: write it all. The guard reads it here, on this device, before anything is sent."
                      rows={13}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      autoComplete="off"
                      aria-label="Your note"
                    />
                    <details className="class-list" open={classList.length === 0 ? undefined : false}>
                      <summary>
                        Class list <small>{classList.length > 0 ? `${classList.length} names, kept in this tab until you close it` : 'optional, kept in this tab until you close it'}</small>
                      </summary>
                      <p>
                        One name per line. A name on this list is{' '}
                        {policy.lockedKinds.includes('student') ? 'always withheld' : 'withheld by default'}, with or without a model.
                      </p>
                      <textarea
                        value={classList.join('\n')}
                        onChange={(e) => setClassList(e.target.value.split('\n').map((s) => s.trimStart()))}
                        onBlur={() => setClassList((l) => l.map((s) => s.trim()).filter(Boolean))}
                        rows={5}
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        autoComplete="off"
                        aria-label="Class list"
                      />
                    </details>
                    <fieldset className="tasks">
                      <legend>What do you want help with?</legend>
                      {TASKS.map((t) => (
                        <label key={t.id} className={task === t.id ? 'task on' : 'task'}>
                          <input type="radio" name="task" checked={task === t.id} onChange={() => setTask(t.id)} />
                          <strong>{t.label}</strong>
                          <span>{t.blurb}</span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="actions">
                      <button className="primary" disabled={note.trim().length < 20} onClick={runGuard}>
                        Run the guard
                      </button>
                      <span className="hint">Nothing is sent. The guard runs here.</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="note-view" ref={noteRef} onMouseUp={onSelectText} onKeyUp={onSelectText}>
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
                    {stage === 'review' && (
                      <div className="select-bar" aria-live="polite">
                        {selection ? (
                          <>
                            <span>
                              Withhold <q>{selection.length > 48 ? `${selection.slice(0, 48)}…` : selection}</q> as
                            </span>
                            {(['student', 'adult', 'place', 'private'] as Kind[]).map((k) => (
                              <button key={k} className="chip-btn" onClick={() => withholdSelection(k)}>
                                {KIND_LABEL[k]}
                              </button>
                            ))}
                          </>
                        ) : (
                          <span className="hint">Missed something? Select it in your note to withhold it.</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </article>

              {stage === 'guarding' && (
                <article className="card">
                  <Spinner label={download !== null ? `Loading the on-device model: ${Math.round(download * 100)}%` : progress} />
                </article>
              )}

              {!editing && stage !== 'guarding' && (
                <article className="card">
                  <div className="card-head">
                    <h3>
                      The vault <small>{withheld.length} withheld</small>
                    </h3>
                    <RouteChip route="guard" where={guardWhere} />
                  </div>
                  {guardWhere === 'RULES_ONLY' && (
                    <p className="caution">
                      No on-device model ran, so the raw note was not shown to any model. Only your class list and the pattern rules were
                      applied. Names that are not on the list and private details were not looked for: select them in your note.
                    </p>
                  )}
                  {entities.length === 0 ? (
                    <p className="empty">Nothing was found to withhold.</p>
                  ) : (
                    <ul className="vault">
                      {entities.map((e) => {
                        const locked = policy.lockedKinds.includes(e.kind);
                        const about = entities.find((s) => s.id === e.about);
                        return (
                          <li key={e.id} className={e.withheld ? '' : 'off'}>
                            <span className={`dot k-${e.kind}`} />
                            <div className="what">
                              <strong>{e.surfaces[0]}</strong>
                              <small>
                                {KIND_LABEL[e.kind]}
                                {e.category ? `, ${e.category}` : ''}
                                {about ? `, about ${about.surfaces[0]}` : ''} · found by {e.source}
                              </small>
                            </div>
                            <code className="token">{e.withheld ? e.token : 'released'}</code>
                            <label className="switch" title={locked ? 'School policy: this kind is always withheld' : ''}>
                              <input
                                type="checkbox"
                                checked={e.withheld}
                                disabled={locked || stage !== 'review'}
                                onChange={() => toggle(e.id)}
                                aria-label={`Withhold ${e.surfaces[0]}`}
                              />
                              <span />
                              {locked && <em>locked</em>}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </article>
              )}

              {stage === 'checking' && (
                <article className="card">
                  <Spinner label={progress} />
                </article>
              )}

              {(stage === 'result' || stage === 'signed') && result && (
                <article className="card result">
                  <div className="card-head">
                    <h3>{restore(result.draft.title, entities)}</h3>
                    <RouteChip route="check" where={checkWhere} />
                  </div>
                  {replyIssues.length > 0 && (
                    <p className="caution">
                      The reply was flagged at the return gate:{' '}
                      {replyIssues.map((v) => `“${v.what}” (${v.why})`).join('; ')}. Read the reply with care. You cannot sign
                      off or copy it until you tick the box below.
                    </p>
                  )}
                  {checkWhere === 'SKIPPED' && (
                    <p className="hint">
                      No item names a student with a withheld private detail, so there was nothing to check and no model was asked.
                    </p>
                  )}
                  {checkWhere === 'NOT_RUN' && (
                    <p className="caution">
                      No on-device model was available to check this draft against what was withheld. The items below are not checked.
                    </p>
                  )}
                  <ol className="items">
                    {result.draft.items.map((item, i) => {
                      const c = checks[i];
                      const facts = detailsFor(item, entities);
                      return (
                        <li key={i} className={kept[i] ? '' : 'struck'}>
                          <h4>
                            <DeviceText text={item.heading} entities={entities} />
                          </h4>
                          <p>
                            <DeviceText text={item.text} entities={entities} />
                          </p>
                          {c && (
                            <div className={`verdict v-${c.verdict.replace(' ', '-')}`}>
                              <b>{VERDICT_LABEL[c.verdict]}</b>
                              <span>{c.reason}</span>
                              {facts.length > 0 && (
                                <small>
                                  Checked against, on this device only:{' '}
                                  {facts.flatMap((f) => f.details.map((d) => `“${d.surfaces[0]}”`)).join(', ')}
                                </small>
                              )}
                            </div>
                          )}
                          {stage === 'result' && (
                            <button className="link" onClick={() => setKept((k) => k.map((v, j) => (j === i ? !v : v)))}>
                              {kept[i] ? 'Strike this item' : 'Keep this item'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {replyIssues.length > 0 && (
                    <label className="read-it reply-read">
                      <input
                        type="checkbox"
                        checked={replyRead}
                        disabled={stage !== 'result'}
                        onChange={(e) => setReplyRead(e.target.checked)}
                      />
                      I have read the flagged reply and I still want to use it.
                    </label>
                  )}
                  {stage === 'result' ? (
                    <div className="actions">
                      <button className="primary" onClick={signOff} disabled={!kept.some(Boolean) || replyBlocked}>
                        Sign off {kept.filter(Boolean).length} of {kept.length} items
                      </button>
                      <span className="hint">Your sign-off is recorded on the receipt.</span>
                    </div>
                  ) : (
                    <div className="signed">
                      <span className="stamp">Signed off by teacher</span>
                      <div className="actions">
                        <button className="primary" onClick={copyFinal} disabled={replyBlocked}>
                          {copied ? 'Copied' : 'Copy the text'}
                        </button>
                        <button className="secondary" onClick={() => setView('receipts')}>
                          See the receipt
                        </button>
                        <button className="link" onClick={startOver}>
                          Start again
                        </button>
                      </div>
                      {copyState === 'saved' && <p className="hint">The receipt's record (no text) was saved to your account.</p>}
                      {copyState === 'failed' && (
                        <p className="caution">The record could not be saved to your account. The receipt is still kept in this browser.</p>
                      )}
                    </div>
                  )}
                </article>
              )}
            </section>

            {/* ------------------------------------------------ the door */}
            <div className="door" aria-hidden="true">
              <span>the door</span>
            </div>

            {/* ------------------------------------------------ the cloud */}
            <section className="lane cloud" aria-label="The cloud">
              <h2 className="lane-title">
                <span>The cloud</span>
                <small>Everything a server is ever shown appears here, word for word.</small>
              </h2>

              {(editing || stage === 'guarding') && (
                <article className="card ghost">
                  <p className="empty">Nothing has been sent.</p>
                </article>
              )}

              {stage === 'review' && (
                <article className="card outbox waiting">
                  <div className="card-head">
                    <h3>Waiting at the door</h3>
                    <span className={violations.length === 0 ? 'gate pass' : 'gate stop'}>
                      {violations.length === 0 ? 'Exit gate: clear' : `Exit gate: ${violations.length} stopped`}
                    </span>
                  </div>
                  <p className="hint">This is the exact text that will be sent, for: {currentTask.label.toLowerCase()}.</p>
                  <pre className="wire">
                    <CloudText text={outgoing} />
                  </pre>
                  {violations.length > 0 && (
                    <ul className="stops">
                      {violations.map((v, i) => (
                        <li key={i}>
                          <b>{v.what}</b> {v.why}
                        </li>
                      ))}
                    </ul>
                  )}
                  {guardGaps.unread.map((i) => (
                    <p className="caution" key={i}>
                      The on-device model could not read paragraph {i + 1}
                      {paragraphs(note)[i] ? ` (it begins “${paragraphs(note)[i].slice(0, 40).trim()}…”)` : ''}. Check it yourself
                      before you approve.
                    </p>
                  ))}
                  {guardGaps.dropped > 0 && (
                    <p className="caution">
                      The on-device model reported {guardGaps.dropped} private {guardGaps.dropped === 1 ? 'detail' : 'details'} that
                      could not be matched to the words of your note, so {guardGaps.dropped === 1 ? 'it was' : 'they were'} not
                      withheld. Look for private details yourself before you approve.
                    </p>
                  )}
                  {guardWhere === 'RULES_ONLY' && (
                    <p className="caution">
                      No model has read this note. Anything you have not marked yourself will be sent exactly as written below.
                    </p>
                  )}
                  <label className="read-it">
                    <input type="checkbox" checked={readIt} onChange={(e) => setReadText(e.target.checked ? outgoing : null)} />
                    I have read this text and I am content to send it.
                  </label>
                  <div className="actions">
                    <button className="primary send" disabled={!readIt || violations.length > 0} onClick={approveAndSend}>
                      Approve and send
                    </button>
                    <span className="hint">{outgoing.length.toLocaleString()} characters</span>
                  </div>
                </article>
              )}

              {sent && stage !== 'review' && (
                <article className="card outbox">
                  <div className="card-head">
                    <h3>{result?.where === 'ON_DEVICE' ? 'Approved by you' : 'Sent'}</h3>
                    <span className="gate pass">
                      Approved {time(sent.at)} · {sent.text.length.toLocaleString()} characters
                    </span>
                  </div>
                  <pre className="wire">
                    <CloudText text={sent.text} />
                  </pre>
                </article>
              )}

              {stage === 'drafting' && (
                <article className="card">
                  <Spinner label={online ? `${policy.cloudModel} is writing the draft` : 'No signal. The on-device model is writing the draft'} />
                </article>
              )}

              {result && stage !== 'review' && stage !== 'drafting' && (
                <article className="card">
                  <div className="card-head">
                    <h3>{result.where === 'IN_CLOUD' ? 'What came back' : 'Written on the device'}</h3>
                    <RouteChip route="draft" where={result.where} />
                  </div>
                  {result.where === 'ON_DEVICE' && (
                    <p className="caution">The cloud could not be reached, so the on-device model wrote this draft from the same approved text.</p>
                  )}
                  <p className="hint">
                    {result.model}. The reply uses the stand-ins. Names are put back on your side of the door.
                  </p>
                  <div className="wire reply">
                    <strong>
                      <CloudText text={result.draft.title} />
                    </strong>
                    {result.draft.items.map((item, i) => (
                      <p key={i}>
                        <b>
                          <CloudText text={item.heading} />
                        </b>
                        <br />
                        <CloudText text={item.text} />
                      </p>
                    ))}
                  </div>
                </article>
              )}
            </section>
          </div>
        </main>
      )}

      <footer>
        <span>All data in the sample is invented.</span>
        <span>
          Policy: {policy.from}. Drafting model {policy.cloudModel}.
        </span>
      </footer>
    </div>
  );
}

const VERDICT_LABEL: Record<ItemCheck['verdict'], string> = {
  fits: 'Fits what you know',
  conflict: 'Conflicts with what you know',
  unsure: 'Think before using',
  'nothing withheld': 'Nothing to check',
  'not checked': 'Not checked',
};

const LABEL_WHERE: Record<LabelWhere | 'UNKNOWN', string> = {
  ON_DEVICE: 'Written on the device from the approved text',
  IN_CLOUD: 'Written in the cloud from the approved text',
  FALLBACK: 'The task name: no model answered',
  UNKNOWN: 'Not recorded for this receipt',
};

// ------------------------------------------------------------------ small views

function DevicePill({ device, download, onTurnOn }: { device: DeviceStatus; download: number | null; onTurnOn: () => void }) {
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
        <span className="pill warn" title="Use Chrome on a desktop computer for the on-device model.">
          <i />
          On-device model: not available
        </span>
      );
  }
}

function How({ policy, device }: { policy: Policy; device: DeviceStatus }) {
  return (
    <main className="page">
      <h2>How it works</h2>
      <p className="lede">
        Two models, one door. The small model inside this browser reads your note and decides what may not leave. The large model in the
        cloud does the writing, and only ever sees the text you approved. Then the small model checks the reply against what the cloud was
        never told.
      </p>
      <table className="routes">
        <thead>
          <tr>
            <th>Job</th>
            <th>Inference mode</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {ROUTES.map((r) => (
            <tr key={r.id}>
              <td>{r.job}</td>
              <td>
                <code>{r.mode.toUpperCase()}</code>
              </td>
              <td>{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Three checks that are not a model</h3>
      <ul className="plain">
        <li>
          <b>The exit gate.</b> Plain code searches the outgoing text for every withheld item and for anything shaped like a phone number,
          an email or an identity number. If it finds one, the send button is disabled.
        </li>
        <li>
          <b>You.</b> Nothing is sent until you have read the exact text and pressed Approve.
        </li>
        <li>
          <b>The return gate.</b> Plain code checks that the reply uses only the stand-ins that were in the text you approved and
          contains no withheld item. It blocks sign-off until you have read a flagged reply.
        </li>
      </ul>
      <h3>What is in force now</h3>
      <dl className="facts">
        <dt>On-device model</dt>
        <dd>{device === 'available' ? 'Gemini Nano, built into Chrome, ready' : `not ready (${device})`}</dd>
        <dt>Drafting model</dt>
        <dd>{policy.cloudModel}</dd>
        <dt>Always withheld</dt>
        <dd>{policy.lockedKinds.map((k) => KIND_LABEL[k].toLowerCase()).join(', ') || 'nothing is locked'}</dd>
        <dt>Set by</dt>
        <dd>{policy.from}</dd>
        <dt>Firebase</dt>
        <dd>{configured ? 'AI Logic, App Check, Remote Config, Authentication, Firestore' : 'no project connected in this build'}</dd>
      </dl>
    </main>
  );
}

function Receipts({
  receipts,
  keepCopies,
  setKeepCopies,
  signedIn,
  onClear,
}: {
  receipts: Receipt[];
  keepCopies: boolean;
  setKeepCopies: (v: boolean) => void;
  signedIn: boolean;
  onClear: () => void;
}) {
  return (
    <main className="page">
      <h2>Receipts</h2>
      <p className="lede">
        A receipt holds the exact text you approved, counts of what was withheld, which model ran where, and what you signed off. It never
        holds your raw note or anything you withheld.
      </p>
      <label className="read-it">
        <input type="checkbox" checked={keepCopies} disabled={!signedIn} onChange={(e) => setKeepCopies(e.target.checked)} />
        Keep a copy of each receipt's record (no text) in my account (Firestore).
        {!signedIn && <em> Not available: no Firebase project is connected.</em>}
      </label>
      {receipts.length === 0 ? (
        <p className="empty">No receipts yet. Finish a run on the desk.</p>
      ) : (
        <>
          <ul className="receipts">
            {receipts.map((r) => {
              const total = Object.values(r.guard.found).reduce((a, b) => a + b, 0);
              return (
                <li key={r.id}>
                  <details>
                    <summary>
                      <strong>{r.label}</strong>
                      <span>{new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      <span>{total} withheld</span>
                      <span>{r.signOff.kept} signed off</span>
                    </summary>
                    <dl className="facts">
                      <dt>Name</dt>
                      <dd>{LABEL_WHERE[r.labelWhere ?? 'UNKNOWN']}</dd>
                      <dt>Guard</dt>
                      <dd>
                        {r.guard.where === 'ON_DEVICE' ? 'On-device model and rules' : 'Rules only'}:{' '}
                        {Object.entries(r.guard.found)
                          .filter(([, n]) => n > 0)
                          .map(([k, n]) => `${n} ${KIND_LABEL[k as Kind].toLowerCase()}`)
                          .join(', ') || 'nothing found'}
                        {r.guard.allowedByTeacher > 0 && `. ${r.guard.allowedByTeacher} released by the teacher`}
                        {(r.guard.unreadParagraphs ?? 0) > 0 &&
                          `. The on-device model could not read ${r.guard.unreadParagraphs} ${r.guard.unreadParagraphs === 1 ? 'paragraph' : 'paragraphs'}`}
                        {(r.guard.droppedDetails ?? 0) > 0 &&
                          `. ${r.guard.droppedDetails} reported private ${r.guard.droppedDetails === 1 ? 'detail' : 'details'} could not be matched to the note`}
                      </dd>
                      <dt>Approved</dt>
                      <dd>
                        {new Date(r.sent.approvedAt).toLocaleString()} · {r.sent.chars.toLocaleString()} characters · exit gate {r.sent.gate}
                      </dd>
                      <dt>Draft</dt>
                      <dd>
                        {r.draft.model}, {r.draft.where === 'IN_CLOUD' ? 'in the cloud' : 'on the device (cloud not reached)'}
                      </dd>
                      <dt>Check</dt>
                      <dd>
                        {r.check.where === 'ON_DEVICE'
                          ? `On device: ${r.check.fits} fit, ${r.check.unsure} to think about, ${r.check.conflict} in conflict, ${r.check.nothingWithheld} with nothing to check`
                          : r.check.where === 'SKIPPED'
                            ? `Skipped, nothing to check: ${r.check.nothingWithheld} with nothing withheld`
                            : `Did not run: ${r.check.notChecked} not checked, ${r.check.nothingWithheld} with nothing to check`}
                        . Return gate {r.check.replyGate}.
                      </dd>
                      <dt>Sign-off</dt>
                      <dd>
                        {r.signOff.kept} kept, {r.signOff.struck} struck
                      </dd>
                    </dl>
                    <pre className="wire">
                      <CloudText text={r.sent.text} />
                    </pre>
                  </details>
                </li>
              );
            })}
          </ul>
          <button className="link" onClick={onClear}>
            Delete the receipts kept in this browser
          </button>
        </>
      )}
    </main>
  );
}
