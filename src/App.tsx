import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entity, ItemCheck, Kind, LabelWhere, Receipt, TaskId, Where } from './core/types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE, TASKS } from './core/samples';
import {
  addByTeacher,
  applyLocks,
  bracketDraft,
  buildVault,
  CAPITALISED,
  deterministicCandidates,
  possibleNameCandidates,
  redact,
  redactWithTokens,
  RESERVED,
  restore,
  segment,
} from './core/vault';
import { checkOutgoing, checkReply, type Violation } from './core/gate';
import { digestPrefix, loadReceipts, makeReceipt, sha256Hex, storeReceipts, type ReceiptRecord } from './core/receipts';
import { approvalKey } from './core/policy';
import { familyFor } from './core/family';
import { configured, DEFAULT_POLICY, loadPolicy, loadReceiptCopies, saveReceiptCopy, watchUser, type Policy } from './ai/firebase';
import { deviceStatus, prepareDevice, ROUTES, type DeviceStatus } from './ai/routes';
import { guardOnDevice, paragraphs } from './ai/guard';
import {
  DRAFT_FORMAT,
  DRAFT_NOTES_HEADING,
  DRAFT_SYSTEM,
  LABEL_CHARS,
  LABEL_SYSTEM,
  labelReceipt,
  writeDraft,
  type DraftResult,
} from './ai/draft';
import { anythingToCheck, checkDidNotRun, checkOnDevice, detailsFor, NOTHING_WITHHELD, startsKept } from './ai/check';
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

/** The records read back from the teacher's account. */
type Records =
  | { state: 'idle' | 'loading' | 'failed' }
  | { state: 'ready'; list: ReceiptRecord[]; unreadable: number };

/** Where the on-device guard fell short: pieces it did not read, things it reported that were lost or only partly found. */
interface Gaps {
  unread: number[];
  dropped: number;
  partial: number;
}

const NO_GAPS: Gaps = { unread: [], dropped: 0, partial: 0 };

/** The longest piece of the note that can be marked in one go. */
const MAX_SELECTION = 600;

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
  const [guardGaps, setGuardGaps] = useState<Gaps>(NO_GAPS);
  const [progress, setProgress] = useState('');
  const [selection, setSelection] = useState('');
  /** Where in the note the selection was made, so the words meant are marked and not the same letters elsewhere. */
  const selectionSpan = useRef<{ start: number; end: number } | null>(null);
  /** Said in place of the marking buttons when a selection cannot be used. */
  const [selectionNote, setSelectionNote] = useState('');
  /** The exact outgoing text the teacher ticked as read. The tick holds only while this is still the outgoing text. */
  const [readKey, setReadKey] = useState<string | null>(null);
  /** What was approved: the text, when, and the vault as it stood at that moment. */
  const [sent, setSent] = useState<{
    text: string;
    at: string;
    entities: Entity[];
    tokens: string[];
    /** Whether this computer had a network at the moment of sending. */
    online: boolean;
    /** The policy the approval was given under. */
    policy: Policy;
  } | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [replyIssues, setReplyIssues] = useState<Violation[]>([]);
  const [replyRead, setReplyRead] = useState(false);
  const [checks, setChecks] = useState<ItemCheck[]>([]);
  const [checkWhere, setCheckWhere] = useState<Where>('NOT_RUN');
  /** How many requests the check made to the on-device model and how many failed. Null when it made none. */
  const [checkRequests, setCheckRequests] = useState<{ asked: number; failed: number } | null>(null);
  /** For each item: kept (true), struck (false), or not yet decided (null). An undecided item blocks sign-off. */
  const [kept, setKept] = useState<(boolean | null)[]>([]);
  /** True from the click on Sign off until the receipt is written: nothing can be kept or struck in between. */
  const [signing, setSigning] = useState(false);
  const signingRef = useRef(false);
  /** Counts the runs on this page, so work that finishes after a run was cleared does not write into the next one. */
  const runRef = useRef(0);
  const [label, setLabel] = useState<{ title: string; where: LabelWhere } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>(loadReceipts);
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'saved' | 'failed'>('idle');
  /** True when this browser would not store the receipt just signed. */
  const [storeFailed, setStoreFailed] = useState(false);
  /** The inline question asked before forgetting, when receipts are kept. */
  const [forgetAsk, setForgetAsk] = useState(false);
  const [listOpen, setListOpen] = useState(() => read(session, CLASS_LIST_KEY, [] as string[]).length === 0);
  /** False until the school's policy has loaded, or the app has given up waiting and taken the defaults. */
  const [policyReady, setPolicyReady] = useState(false);
  const policyReadyRef = useRef(false);
  const [records, setRecords] = useState<Records>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  /** The last copy to the clipboard: the whole text or one item, and whether it worked. */
  const [copied, setCopied] = useState<{ what: 'all' | number; ok: boolean } | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  /** The policy as last loaded, readable at the moment of sending even before a re-render. */
  const policyRef = useRef<Policy>(DEFAULT_POLICY);

  // ---------------------------------------------------------------- start-up

  useEffect(() => {
    deviceStatus().then(setDevice);
    loadPolicy().then((p) => {
      policyRef.current = p;
      policyReadyRef.current = true;
      setPolicyReady(true);
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

  /** Read the records kept in the teacher's account. They hold no text, so there is none to show. */
  const refreshRecords = useCallback(async (user: string) => {
    setRecords((r) => (r.state === 'ready' ? r : { state: 'loading' }));
    try {
      const { records: list, unreadable } = await loadReceiptCopies(user);
      setRecords({ state: 'ready', list, unreadable });
    } catch {
      setRecords({ state: 'failed' });
    }
  }, []);

  useEffect(() => {
    if (view !== 'receipts') return;
    if (uid) void refreshRecords(uid);
    else setRecords({ state: 'idle' });
  }, [view, uid, refreshRecords]);

  const currentTask = TASKS.find((t) => t.id === task)!;
  // The school's locks are part of how the outgoing text is computed, not only a disabled switch:
  // an item of a locked kind is withheld even if the vault says released (the policy can arrive late).
  // After approval the vault is the one that was approved, so the record matches what was sent.
  const entities = useMemo(
    () => sent?.entities ?? applyLocks(rawEntities, policy.lockedKinds),
    [sent, rawEntities, policy.lockedKinds],
  );
  const outgoing = useMemo(() => redact(note, entities), [note, entities]);
  const violations = useMemo(() => checkOutgoing(outgoing, entities, note), [outgoing, entities, note]);
  const approval = approvalKey(outgoing, policy.lockedKinds, policy.cloudModel);
  const readIt = readKey !== null && readKey === approval;

  // The tick is for one exact text under one policy. If either changes, it is cleared.
  useEffect(() => setReadKey(null), [approval]);

  // ---------------------------------------------------------------- the on-device model

  /** Must be called from a click: Chrome only starts a model download after one. */
  const turnOnDevice = useCallback(async (): Promise<boolean> => {
    // The first look at the device may still be under way. Wait for a real answer, not the placeholder.
    let status = device;
    if (status === 'checking') {
      status = await deviceStatus();
      setDevice(status);
    }
    if (status === 'available') return true;
    if (status !== 'downloadable' && status !== 'downloading') return false;
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
  }, [device]);

  // ---------------------------------------------------------------- step 2: guard

  const runGuard = async () => {
    setError(null);
    setStage('guarding');
    setSelection('');
    setReadKey(null);
    setSent(null);
    setResult(null);
    const candidates = deterministicCandidates(note, classList);
    let where: Where = 'RULES_ONLY';
    let gaps = NO_GAPS;
    setProgress('Checking the class list, the pattern rules and the sensitive words');
    if (await turnOnDevice()) {
      try {
        const report = await guardOnDevice(note, (done, total) =>
          setProgress(`The on-device model is reading part ${Math.min(done + 1, total)} of ${total}`),
        );
        candidates.push(...report.candidates);
        if (report.unread.length >= report.total) {
          // The model read nothing, so this run is a rules-only run and is called one everywhere.
          setError(
            `${report.stopped ?? 'The on-device model could not read any part of the note.'} Only the rules were applied. Read the outgoing text with care.`,
          );
        } else {
          where = 'ON_DEVICE';
          gaps = { unread: report.unread, dropped: report.dropped, partial: report.partial };
          if (report.stopped) setError(`The on-device guard stopped early: ${report.stopped} Check the parts it did not read.`);
        }
      } catch (e) {
        setError(`The on-device guard stopped: ${message(e)} Only the rules were applied. Read the outgoing text with care.`);
      }
    }
    // With no model, a capitalised word in mid-sentence is held back as a possible name. A guess: it can be released.
    if (where === 'RULES_ONLY') candidates.push(...possibleNameCandidates(note, classList));
    setEntities(buildVault(note, candidates));
    setGuardWhere(where);
    setGuardGaps(gaps);
    setStage('review');
  };

  const toggle = (id: string) =>
    setEntities((list) =>
      list.map((e) => (e.id === id && !policyRef.current.lockedKinds.includes(e.kind) ? { ...e, withheld: !e.withheld } : e)),
    );

  /** Take the current selection as something to mark, if it is a usable piece of the note. */
  const readSelection = useCallback(
    (keepIfEmpty: boolean) => {
      const sel = window.getSelection();
      const inNote = !!sel && !!noteRef.current && !!sel.anchorNode && noteRef.current.contains(sel.anchorNode);
      const text = inNote ? sel.toString().trim() : '';
      if (text.length < 2) {
        if (!keepIfEmpty) {
          setSelection('');
          setSelectionNote('');
        }
        return;
      }
      if (text.length > MAX_SELECTION) {
        setSelection('');
        setSelectionNote(
          `That selection is ${text.length.toLocaleString()} characters long. Select ${MAX_SELECTION} characters or fewer at a time, and mark a longer passage in parts.`,
        );
        return;
      }
      // The note view shows the note character for character, so a position in it is a position in the note.
      const range = sel!.getRangeAt(0);
      const before = document.createRange();
      before.selectNodeContents(noteRef.current!);
      before.setEnd(range.startContainer, range.startOffset);
      const raw = range.toString();
      const start = before.toString().length + (raw.length - raw.trimStart().length);
      const end = start + text.length;
      if (note.slice(start, end) !== text) {
        setSelection('');
        selectionSpan.current = null;
        setSelectionNote('That selection is not one unbroken piece of your note. Select within the note, in one go.');
        return;
      }
      selectionSpan.current = { start, end };
      setSelection(text);
      setSelectionNote('');
    },
    [note],
  );

  const onSelectText = () => readSelection(false);

  // A touch selection raises no mouse or key event in the note, so the selection itself is listened to.
  // An emptied selection is ignored here: tapping a button can empty it before the tap arrives.
  useEffect(() => {
    if (stage !== 'review') return;
    const onChange = () => readSelection(true);
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [stage, readSelection]);

  /** Mark the selection. Text already in the vault is set back to withheld; a cut word is widened to the whole word. */
  const withholdSelection = (kind: Kind) => {
    const span = selectionSpan.current ?? undefined;
    if (!span) return;
    setEntities((list) => addByTeacher(note, list, selection, kind, span));
    selectionSpan.current = null;
    setSelection('');
    setSelectionNote('');
    window.getSelection()?.removeAllRanges();
  };

  // ---------------------------------------------------------------- steps 3 to 5: approve, draft, check

  const approveAndSend = async () => {
    // Everything is worked out again at the moment of sending: the current locks, the text they give,
    // and the gate on exactly that text. It is sent only if it is the text the teacher ticked as read.
    if (!policyReadyRef.current) return;
    const sentPolicy = policyRef.current;
    const current = applyLocks(rawEntities, sentPolicy.lockedKinds);
    const { text, tokens } = redactWithTokens(note, current);
    const stopped = checkOutgoing(text, current, note);
    // The tick was for one text, one set of locks and one drafting model. Any of them changed: no send.
    const same = readKey !== null && readKey === approvalKey(text, sentPolicy.lockedKinds, sentPolicy.cloudModel);
    if (stage !== 'review' || !same || stopped.length > 0) {
      setReadKey(null);
      setError(
        stopped.length > 0
          ? 'The exit gate stopped the text. Nothing was sent.'
          : 'The outgoing text or the policy is not what you ticked as read. Nothing was sent. Read it again, then approve.',
      );
      return;
    }
    const entities = current;
    const cloudModel = sentPolicy.cloudModel;
    const sentOnline = navigator.onLine;
    setError(null);
    const approvedAt = new Date().toISOString();
    setSent({ text, at: approvedAt, entities, tokens, online: sentOnline, policy: sentPolicy });
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
          : 'This build has no Firebase project. The cloud refused the request, and no on-device model was ready to write the draft instead. The guard and the gates still work. See the README to connect a project.',
      );
      return;
    }
    setResult(drafted);
    // A stand-in the model wrote without its brackets is read as that stand-in, if it was one that was sent.
    const items = bracketDraft(drafted.draft, tokens).items;
    setKept(items.map(() => null));
    const replyText = [drafted.draft.title, ...drafted.draft.items.flatMap((i) => [i.heading, i.text])].join('\n');
    setReplyIssues(checkReply(replyText, entities, tokens, text));
    setReplyRead(false);

    setStage('checking');
    let itemChecks: ItemCheck[];
    let where: Where = 'NOT_RUN';
    let requests: { asked: number; failed: number } | null = null;
    const unchecked = (reason: string): ItemCheck[] =>
      items.map((item) => (detailsFor(item, entities).length > 0 ? { verdict: 'not checked', reason } : NOTHING_WITHHELD));
    if (!anythingToCheck(items, entities)) {
      // No private detail was withheld: there is nothing to check, so no model is asked.
      itemChecks = items.map(() => NOTHING_WITHHELD);
      where = 'SKIPPED';
    } else {
      try {
        if ((await deviceStatus()) !== 'available') throw new Error('no on-device model was available.');
        const run = await checkOnDevice(note, items, entities, tokens, (done, total) =>
          setProgress(`The on-device model is checking item ${Math.min(done + 1, total)} of ${total}`),
        );
        requests = { asked: run.asked, failed: run.failed };
        if (checkDidNotRun(run)) {
          // Every request failed, so nothing was checked. It is recorded as a check that did not run.
          setError(
            `The on-device check could not run: all ${run.asked} of its requests to the on-device model failed. The items below are not checked.`,
          );
          itemChecks = unchecked('The on-device model did not answer. Read this item against the private details yourself.');
        } else {
          itemChecks = run.checks;
          where = 'ON_DEVICE';
        }
      } catch (e) {
        // Say what happened. The draft stays; every item that had something to be checked against is marked unchecked.
        setError(`The on-device check stopped: ${message(e)} The items below are not checked.`);
        itemChecks = unchecked('The on-device check did not run. Read this item against the private details yourself.');
      }
    }
    setCheckRequests(requests);
    setChecks(itemChecks);
    // An item in conflict starts struck. An unsure or unchecked one starts undecided: the teacher has to choose.
    setKept(startsKept(itemChecks));
    setCheckWhere(where);
    setProgress('Naming the receipt');
    setLabel(await labelReceipt(text, currentTask.label, cloudModel));
    setStage('result');
  };

  // ---------------------------------------------------------------- step 6: sign off

  const signOff = async () => {
    // Locked at once, before anything is awaited: a second click, or a keep or strike made while the
    // receipt is being written, changes nothing. What is recorded is what was on screen at the click.
    if (signingRef.current || stage !== 'result' || !result || !sent || replyBlocked) return;
    if (kept.some((k) => k === null) || !kept.some((k) => k === true)) return;
    signingRef.current = true;
    setSigning(true);
    const run = runRef.current;
    const signed = [...kept];
    let sentSha256 = '';
    try {
      sentSha256 = await sha256Hex(sent.text);
    } catch {
      // No digest in this browser. The receipt is still written; the record works one out if it can.
    }
    if (runRef.current !== run) return;
    const receipt = makeReceipt({
      task,
      label: label?.title || currentTask.label,
      labelWhere: label?.where ?? 'FALLBACK',
      entities,
      guardWhere,
      unreadParagraphs: guardGaps.unread.length,
      droppedDetails: guardGaps.dropped + guardGaps.partial,
      sentText: sent.text,
      sentSha256,
      approvedAt: sent.at,
      draftWhere: result.where,
      draftModel: result.model,
      draftCloud: result.where === 'ON_DEVICE' ? (sent.online ? 'no answer' : 'not reached') : undefined,
      checkWhere,
      checkRequests: checkRequests ?? undefined,
      replyFlagged: replyIssues.length > 0,
      checks,
      kept: signed.filter((k) => k === true).length,
      struck: signed.filter((k) => k === false).length,
    });
    const next = [receipt, ...receipts];
    setKept(signed);
    setReceipts(next);
    // The browser can refuse to store (full, or switched off). Say so; the sign-off and the record go on.
    setStoreFailed(!storeReceipts(next));
    setStage('signed');
    setSigning(false);
    setCopyState('idle');
    if (keepCopies && uid) {
      // Independent of the local store. With no network the write waits, and finishes when the network is back.
      setCopyState('pending');
      // The write can finish long after this run was cleared. Its outcome is shown only while this run is on screen.
      try {
        await saveReceiptCopy(uid, receipt);
        if (runRef.current === run) setCopyState('saved');
        void refreshRecords(uid);
      } catch {
        if (runRef.current === run) setCopyState('failed');
      }
    }
  };

  /** Keep or strike one item. Nothing changes once sign-off has begun. */
  const decide = (i: number, keep: boolean) => {
    if (signingRef.current || stage !== 'result') return;
    setKept((k) => k.map((v, j) => (j === i ? keep : v)));
  };

  /** The draft as it is read on this device: a bare stand-in that was sent has its brackets back. `result.draft` is the reply as it came. */
  const draft = useMemo(() => (result ? bracketDraft(result.draft, sent?.tokens ?? []) : null), [result, sent]);

  const finalText = useMemo(() => {
    if (!draft) return '';
    const items = draft.items.filter((_, i) => kept[i] === true);
    return restore([draft.title, '', ...items.map((i) => `${i.heading}\n${i.text}\n`)].join('\n'), entities, sent?.tokens).trim();
  }, [draft, kept, entities, sent]);

  /** Copy to the clipboard and say plainly whether it worked. The browser can refuse. */
  const copy = async (what: 'all' | number, text: string) => {
    if (replyBlocked) return;
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    setCopied({ what, ok });
    setTimeout(() => setCopied((c) => (c && c.what === what ? null : c)), ok ? 1800 : 6000);
  };

  const copyLabel = (what: 'all' | number, label: string) =>
    copied?.what === what ? (copied.ok ? 'Copied' : 'Could not copy') : label;

  /** Clear everything a run produced. The note and the class list stay. */
  const clearRun = () => {
    runRef.current++;
    signingRef.current = false;
    setSigning(false);
    setCheckRequests(null);
    setStage('write');
    setEntities([]);
    setGuardWhere('NOT_RUN');
    setGuardGaps(NO_GAPS);
    setSelection('');
    setSelectionNote('');
    setReadKey(null);
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
    setCopied(null);
    setStoreFailed(false);
    setForgetAsk(false);
    setError(null);
  };

  const startOver = clearRun;

  /**
   * Forget the raw note, the class list, the vault and the results: from memory and from storage.
   * Receipts hold approved text, so the teacher is asked about them and they go only on a yes.
   */
  const forgetNote = (alsoReceipts: boolean) => {
    clearRun();
    if (alsoReceipts) {
      setReceipts([]);
      storeReceipts([]);
    }
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
  /** Items the teacher has not yet chosen to keep or strike. */
  const undecided = kept.filter((k) => k === null).length;
  const editing = stage === 'write';
  const busy = stage === 'guarding' || stage === 'drafting' || stage === 'checking';

  /** What goes to the cloud model besides the approved text. Shown before approval and kept on screen after it. */
  const sentWith = (
    <>
      <p className="hint">The cloud model also receives the task instruction shown here:</p>
      <p className="instruction">{currentTask.instruction}</p>
      <details className="fixed-instructions">
        <summary>Fixed instructions sent with every draft</summary>
        <p className="hint">The system instruction:</p>
        <pre className="wire small">{DRAFT_SYSTEM}</pre>
        <p className="hint">Written after the task instruction:</p>
        <pre className="wire small">{DRAFT_FORMAT}</pre>
        <p className="hint">Written above your text:</p>
        <pre className="wire small">{DRAFT_NOTES_HEADING}</pre>
        <p className="hint">
          The shape of the answer is fixed too: a title and a list of items, each with a heading and a text. One more
          call names the receipt. It runs on this device when it can; when it cannot, the cloud model is sent the first{' '}
          {LABEL_CHARS.toLocaleString()} characters of the text below with this instruction:
        </p>
        <pre className="wire small">{LABEL_SYSTEM}</pre>
      </details>
    </>
  );

  const vaultBody = (
    <>
      {guardWhere === 'RULES_ONLY' && (
        <p className="caution">
          No on-device model ran, so the raw note was not shown to any model. Only your class list, the pattern rules and a
          short list of sensitive words were applied. Names that are not on the list were not looked for, and nor were
          private details beyond those words: select them in your note.
        </p>
      )}
      {entities.length === 0 ? (
        <p className="empty">Nothing was found to withhold.</p>
      ) : (
        <ul className="vault">
          {entities.map((e) => {
            const reserved = e.category === RESERVED;
            const locked = reserved || policy.lockedKinds.includes(e.kind);
            const guess = e.source === 'rule' && e.category === CAPITALISED;
            const about = entities.find((s) => s.id === e.about);
            return (
              <li key={e.id} className={e.withheld ? '' : 'off'}>
                <span className={`dot k-${e.kind}`} />
                <div className="what">
                  <strong>{e.surfaces[0]}</strong>
                  <small>
                    {reserved ? 'Looks like a stand-in' : KIND_LABEL[e.kind]}
                    {e.category && !guess && !reserved ? `, ${e.category}` : ''}
                    {about && !reserved ? `, about ${about.surfaces[0]}` : ''} · found by{' '}
                    {guess ? 'rule: capitalised word' : e.source}
                  </small>
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
    </>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>Staffroom</h1>
            <p>Your raw note stays on this device. What you approve is the only note text sent.</p>
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
          {/* navigator.onLine says only that this computer has a network. It does not say the cloud model will answer. */}
          <span className={`pill ${online ? 'ok' : 'warn'}`}>
            <i />
            {online ? 'Network: online' : 'Network: offline'}
          </span>
          {!configured && (
            <span className="pill warn">
              <i />
              Cloud: not connected
            </span>
          )}
        </div>
      </header>

      {view === 'how' && <How policy={policy} device={device} />}
      {view === 'receipts' && (
        <Receipts
          receipts={receipts}
          keepCopies={keepCopies}
          setKeepCopies={setKeepCopies}
          signedIn={Boolean(uid)}
          records={records}
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
                <small>Your raw note, the real names and the private details stay on this side. What you approve is the only note text sent.</small>
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
                        onClick={() => (receipts.length > 0 ? setForgetAsk(true) : forgetNote(false))}
                        title="Clears the note, the class list, the vault and the results from this page and from this browser."
                      >
                        Forget this note
                      </button>
                    )}
                  </span>
                </div>
                {forgetAsk && (
                  <div className="confirm" role="group" aria-label="Forget this note">
                    <p>
                      Your note, class list, vault and results will be cleared. This browser also keeps {receipts.length}{' '}
                      {receipts.length === 1 ? 'receipt' : 'receipts'}, and a receipt holds the text you approved. Delete{' '}
                      {receipts.length === 1 ? 'it' : 'them'} too?
                    </p>
                    <div className="actions">
                      <button className="secondary" onClick={() => forgetNote(true)}>
                        Forget the note and delete receipts
                      </button>
                      <button className="secondary" onClick={() => forgetNote(false)}>
                        Forget the note, keep receipts
                      </button>
                      <button className="link" onClick={() => setForgetAsk(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

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
                    <details className="class-list" open={listOpen} onToggle={(e) => setListOpen(e.currentTarget.open)}>
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
                    {(device === 'unsupported' || device === 'unavailable') && (
                      <p className="notice">
                        This browser has no built-in model. Staffroom will use your class list, the pattern rules and a short list of
                        sensitive words only, and you must mark private details yourself. For the full guard and check, open this page
                        in Chrome on a desktop computer.
                      </p>
                    )}
                    {(device === 'downloadable' || device === 'downloading') && download === null && (
                      <p className="notice">
                        The first run downloads the on-device model (several GB) and can take a few minutes. After that it starts
                        straight away.
                      </p>
                    )}
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
                            {(['student', 'adult', 'place', 'contact', 'id', 'private'] as Kind[]).map((k) => (
                              <button key={k} className="chip-btn" onClick={() => withholdSelection(k)}>
                                {KIND_LABEL[k]}
                              </button>
                            ))}
                          </>
                        ) : selectionNote ? (
                          <span className="caution selection-note">{selectionNote}</span>
                        ) : (
                          <span className="hint">
                            Missed something? Select it in your note to withhold it. Selecting a released item withholds it again.
                          </span>
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

              {!editing && stage !== 'guarding' && stage === 'review' && (
                <article className="card">
                  <div className="card-head">
                    <h3>
                      The vault <small>{withheld.length} withheld</small>
                    </h3>
                    <RouteChip route="guard" where={guardWhere} />
                  </div>
                  {vaultBody}
                </article>
              )}

              {/* Past the review the vault is folded away, so the draft and its verdicts are near the top. */}
              {!editing && stage !== 'guarding' && stage !== 'review' && (
                <details className="card vault-fold">
                  <summary>The vault: {withheld.length} withheld</summary>
                  <RouteChip route="guard" where={guardWhere} />
                  {vaultBody}
                </details>
              )}

              {stage === 'checking' && (
                <article className="card">
                  <Spinner label={progress} />
                </article>
              )}

              {(stage === 'result' || stage === 'signed') && result && draft && (
                <article className="card result">
                  <div className="card-head">
                    <h3>{restore(draft.title, entities, sent?.tokens)}</h3>
                  </div>
                  <div className="result-chips">
                    <span className={`route route-${result.where.toLowerCase()}`}>
                      Draft: {result.model} {result.where === 'IN_CLOUD' ? 'in the cloud' : 'on this device'}
                    </span>
                    <span className="chip-line">
                      <span className="chip-label">Check against withheld details:</span>
                      <RouteChip route="check" where={checkWhere} />
                    </span>
                  </div>
                  {replyIssues.length > 0 && (
                    <p className="caution">
                      The reply was flagged at the return gate.{' '}
                      {replyIssues.some((v) => !v.say) &&
                        `${replyIssues
                          .filter((v) => !v.say)
                          .map((v) => `“${v.what}” (${v.why})`)
                          .join('; ')}. `}
                      {replyIssues
                        .filter((v) => v.say)
                        .map((v) => `${v.say} `)
                        .join('')}
                      Read the reply with care. You cannot sign off or copy it until you tick the box below.
                    </p>
                  )}
                  {checkWhere === 'SKIPPED' && (
                    <p className="hint">
                      No private detail was withheld, so there was nothing to check and no model was asked.
                    </p>
                  )}
                  {checkWhere === 'NOT_RUN' && (
                    <p className="caution">
                      {checkRequests && checkRequests.asked > 0
                        ? `The on-device check could not run: all ${checkRequests.asked} of its requests to the on-device model failed.`
                        : 'The on-device check did not run.'}{' '}
                      This draft was not checked against what was withheld. Read each item against the private details yourself,
                      then choose to keep it or strike it.
                    </p>
                  )}
                  {checkWhere === 'ON_DEVICE' && checkRequests && checkRequests.failed > 0 && (
                    <p className="caution">
                      The on-device check ran only in part: {checkRequests.failed} of its {checkRequests.asked} requests to the
                      on-device model failed. The items it could not check say so. Read those against the private details yourself.
                    </p>
                  )}
                  <ol className="items">
                    {draft.items.map((item, i) => {
                      const c = checks[i];
                      const facts = detailsFor(item, entities);
                      // A message home is for one family: the copy button is offered only when the app can tell which.
                      const family = task === 'parents' ? familyFor(item, note, entities, sent?.tokens ?? []) : null;
                      return (
                        <li key={i} className={kept[i] === null ? 'undecided' : kept[i] ? '' : 'struck'}>
                          <h4>
                            <DeviceText text={item.heading} entities={entities} allowed={sent?.tokens} />
                          </h4>
                          <p>
                            <DeviceText text={item.text} entities={entities} allowed={sent?.tokens} />
                          </p>
                          {c && (
                            <div className={`verdict v-${c.verdict.replace(' ', '-')}`}>
                              <b>{VERDICT_LABEL[c.verdict]}</b>
                              <span>{c.reason}</span>
                              {facts.length > 0 && (
                                <small>
                                  {c.verdict === 'not checked' ? 'Not checked against:' : 'Checked against, on this device only:'}{' '}
                                  {facts.flatMap((f) => f.details.map((d) => `“${d.surfaces[0]}”`)).join(', ')}
                                </small>
                              )}
                            </div>
                          )}
                          {stage === 'result' && c?.verdict === 'conflict' && kept[i] === false && (
                            <p className="hint struck-why">
                              Struck to begin with, because it conflicts with what you know. Keep it only if you still want it.
                            </p>
                          )}
                          {/* A message home is copied one at a time, so one family's message never travels with another's. */}
                          {stage === 'signed' && task === 'parents' && kept[i] === true && family && (
                            <div className="copy-one">
                              {family.student ? (
                                <>
                                  <span className="for-family">For the family of {family.student.surfaces[0]}</span>
                                  <button
                                    className="link"
                                    disabled={replyBlocked}
                                    onClick={() => copy(i, restore(item.text, entities, sent?.tokens).trim())}
                                  >
                                    {copyLabel(i, 'Copy this message')}
                                  </button>
                                </>
                              ) : (
                                <span className="caution copy-off">{family.why}</span>
                              )}
                            </div>
                          )}
                          {stage === 'result' && kept[i] === null && (
                            <div className="decide">
                              <p className="hint struck-why">
                                {c?.verdict === 'not checked' ? 'This item was not checked.' : 'The check was not sure about this item.'}{' '}
                                Choose to keep it or strike it before you sign off.
                              </p>
                              <button className="link" disabled={signing} onClick={() => decide(i, true)}>
                                Keep this item
                              </button>
                              <button className="link" disabled={signing} onClick={() => decide(i, false)}>
                                Strike this item
                              </button>
                            </div>
                          )}
                          {stage === 'result' && kept[i] !== null && (
                            <button className="link" disabled={signing} onClick={() => decide(i, !kept[i])}>
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
                      <button
                        className="primary"
                        onClick={signOff}
                        disabled={signing || undecided > 0 || !kept.some((k) => k === true) || replyBlocked}
                      >
                        Sign off {kept.filter((k) => k === true).length} of {kept.length} items
                      </button>
                      <span className="hint">
                        {undecided > 0
                          ? `Choose keep or strike for ${undecided} ${undecided === 1 ? 'item' : 'items'} first. `
                          : kept.some((k) => k === false)
                            ? 'Struck items are left out. '
                            : ''}
                        The numbers of items kept and struck are recorded on the receipt.
                      </span>
                    </div>
                  ) : (
                    <div className="signed">
                      <span className="stamp">Signed off by teacher</span>
                      <div className="actions">
                        {task === 'parents' ? (
                          <span className="hint">Each message is copied on its own, with the button under it, for one family at a time.</span>
                        ) : (
                          <button className="primary" onClick={() => copy('all', finalText)} disabled={replyBlocked}>
                            {copyLabel('all', 'Copy the text')}
                          </button>
                        )}
                        <button className="secondary" onClick={() => setView('receipts')}>
                          See the receipt
                        </button>
                        <button className="link" onClick={startOver}>
                          Start again
                        </button>
                      </div>
                      {copied && !copied.ok && (
                        <p className="caution" role="alert">
                          Could not copy. Your browser did not allow it: select the text and copy it by hand.
                        </p>
                      )}
                      {storeFailed && (
                        <p className="caution" role="alert">
                          This browser could not store the receipt. Copy what you need before you leave this page.
                        </p>
                      )}
                      {copyState === 'pending' && (
                        <p className="hint">
                          {online ? 'Saving the record to your account.' : 'The record will be saved when the network is back.'}
                        </p>
                      )}
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
                <small>Everything the cloud model is shown appears here, word for word.</small>
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
                  {sentWith}
                  <p className="hint">This is the exact text that will be sent, for: {currentTask.label.toLowerCase()}.</p>
                  <pre className="wire">
                    <CloudText text={outgoing} />
                  </pre>
                  <p className="hint policy-line">
                    {policyReady ? `Policy: ${policy.from}. Drafting model: ${policy.cloudModel}.` : 'Policy: loading. Approval waits for it.'}
                  </p>
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
                      The on-device model could not read part {i + 1} of your note
                      {paragraphs(note)[i] ? ` (it begins “${paragraphs(note)[i].slice(0, 40).trim()}…”)` : ''}. Check it yourself
                      before you approve.
                    </p>
                  ))}
                  {guardGaps.dropped > 0 && (
                    <p className="caution">
                      The on-device model reported {guardGaps.dropped} {guardGaps.dropped === 1 ? 'item' : 'items'} (a name, a place
                      or a private detail) that could not be matched to the words of your note, so{' '}
                      {guardGaps.dropped === 1 ? 'it was' : 'they were'} not withheld. Look for names and private details yourself
                      before you approve.
                    </p>
                  )}
                  {guardGaps.partial > 0 && (
                    <p className="caution">
                      {guardGaps.partial} private {guardGaps.partial === 1 ? 'detail was' : 'details were'} matched to your note only
                      in part. The matching words were withheld. Read the text around each private detail and mark what is left.
                    </p>
                  )}
                  {guardWhere === 'RULES_ONLY' && (
                    <p className="caution">
                      No model has read this note. Anything you have not marked yourself will be sent exactly as written below.
                    </p>
                  )}
                  <label className="read-it">
                    <input type="checkbox" checked={readIt} onChange={(e) => setReadKey(e.target.checked ? approval : null)} />
                    {guardWhere === 'RULES_ONLY'
                      ? 'No model looked for private details. I have read this text and marked them myself.'
                      : 'I have read this text and I am content to send it.'}
                  </label>
                  <div className="actions">
                    <button className="primary send" disabled={!readIt || violations.length > 0 || !policyReady} onClick={approveAndSend}>
                      Approve and send
                    </button>
                    <span className="hint">
                      {policyReady ? `${outgoing.length.toLocaleString()} characters` : 'Loading school policy…'}
                    </span>
                  </div>
                </article>
              )}

              {sent && stage !== 'review' && (
                <article className="card outbox">
                  <div className="card-head">
                    {/* "Sent" whenever the request went out, answered or not. With no network it never left. */}
                    <h3>{sent.online || result?.where === 'IN_CLOUD' ? 'Sent' : 'Approved by you'}</h3>
                    <span className="gate pass">
                      Approved {time(sent.at)} · {sent.text.length.toLocaleString()} characters
                    </span>
                  </div>
                  {sentWith}
                  <pre className="wire">
                    <CloudText text={sent.text} />
                  </pre>
                  <p className="hint policy-line">
                    Policy: {sent.policy.from}. Drafting model: {sent.policy.cloudModel}.
                  </p>
                </article>
              )}

              {stage === 'drafting' && (
                <article className="card">
                  <Spinner label={online ? `Asking ${policy.cloudModel} to write the draft` : 'No signal. The on-device model is writing the draft'} />
                </article>
              )}

              {result && stage !== 'review' && stage !== 'drafting' && (
                <article className="card">
                  <div className="card-head">
                    <h3>{result.where === 'IN_CLOUD' ? 'What came back' : 'Written on the device'}</h3>
                    <RouteChip route="draft" where={result.where} />
                  </div>
                  {result.where === 'ON_DEVICE' && (
                    <p className="caution">
                      {sent?.online
                        ? 'The request was sent but the cloud model did not answer, so the on-device model wrote this draft from the same approved text.'
                        : 'The cloud could not be reached, so the on-device model wrote this draft from the same approved text.'}
                    </p>
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
  fits: 'No conflict found',
  conflict: 'Conflicts with what you know',
  unsure: 'Think before using',
  'nothing withheld': 'Nothing to check',
  'not checked': 'Not checked',
};

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
          <b>The exit gate.</b> Plain code re-checks the outgoing text for every withheld item and for the phone, email and ID patterns.
          If it finds one, the send button is disabled. It catches redaction mistakes; it cannot find a private detail nobody marked.
        </li>
        <li>
          <b>You.</b> Nothing is sent until you have read the exact text and pressed Approve. If the text changes after you tick, the
          tick is cleared.
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

function Receipts({
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
      <p className="lede">
        A receipt holds the exact text you approved, counts of what was withheld, which model ran where, and what you signed off. It never
        holds your raw note or anything you withheld.
      </p>
      <label className="read-it">
        <input type="checkbox" checked={keepCopies} disabled={!signedIn} onChange={(e) => setKeepCopies(e.target.checked)} />
        Keep a copy of each receipt's record (no text) in my account (Firestore).
        {!signedIn && <em>{configured ? ' Sign-in is not available right now.' : ' Not available: no Firebase project is connected.'}</em>}
      </label>
      {signedIn && records.state === 'loading' && <p className="hint">Looking up the records kept in your account.</p>}
      {signedIn && records.state === 'failed' && <p className="caution">The records kept in your account could not be read just now.</p>}
      {signedIn && records.state === 'ready' && (
        <div className="records">
          <p className="hint">
            Records kept in your account: {records.list.length}
            {records.unreadable > 0 &&
              `. ${records.unreadable} older ${records.unreadable === 1 ? 'entry is' : 'entries are'} in an earlier form and ${records.unreadable === 1 ? 'is' : 'are'} not listed`}
          </p>
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
                      {r.flags.replyFlagged ? ' · reply flagged' : ''} · digest {digestPrefix(r.approvedSha256)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
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
                          `. The on-device model could not read ${r.guard.unreadParagraphs} ${r.guard.unreadParagraphs === 1 ? 'part' : 'parts'} of the note`}
                        {(r.guard.droppedDetails ?? 0) > 0 &&
                          `. ${r.guard.droppedDetails} reported ${r.guard.droppedDetails === 1 ? 'item' : 'items'} could not be matched to the note in full`}
                      </dd>
                      <dt>Approved</dt>
                      <dd>
                        {new Date(r.sent.approvedAt).toLocaleString()} · {r.sent.chars.toLocaleString()} characters · exit gate {r.sent.gate}
                        {r.sent.sha256 ? ` · digest ${digestPrefix(r.sent.sha256)}` : ''}
                      </dd>
                      <dt>Draft</dt>
                      <dd>
                        {r.draft.model},{' '}
                        {r.draft.where === 'IN_CLOUD'
                          ? 'in the cloud'
                          : r.draft.cloud === 'no answer'
                            ? 'on the device (cloud did not answer)'
                            : 'on the device (cloud not reached)'}
                      </dd>
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
                            : `${
                                (r.check.failedRequests ?? 0) > 0
                                  ? `Could not run, all ${r.check.requests} of its requests to the on-device model failed`
                                  : 'Did not run'
                              }: ${r.check.notChecked} not checked, ${r.check.nothingWithheld} with nothing to check`}
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
