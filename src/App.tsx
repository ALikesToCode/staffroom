import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Constraint, ConstraintKind, DraftItem, Entity, ItemCheck, Kind, LabelWhere, Receipt, TaskId, Where } from './core/types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE, TASKS } from './core/samples';
import {
  addByTeacher,
  applyLocks,
  bracketDraft,
  buildVault,
  CAPITALISED,
  deterministicCandidates,
  insidePrivate,
  possibleNameCandidates,
  RESERVED,
  restore,
  segment,
  TOKEN_RE,
} from './core/vault';
import { checkReply, safeTitle, type Violation } from './core/gate';
import { loadReceipts, makeReceipt, plainTitle, storeReceipts } from './core/receipts';
import { approvalKey } from './core/policy';
import {
  addConstraint,
  confirmConstraint,
  constraintCounts,
  withConstraintFacts,
  heldByConstraints,
  lockConstraints,
  proposeConstraints,
  removeConstraint,
  restoreConstraints,
  setNeed,
  setShare,
  setConstraintKind,
  setTriggers,
  unconfirmConstraint,
} from './core/constraints';
import { Caught, ConstraintsPanel } from './ui/Constraints';
import { Hero, PROMISE } from './ui/Hero';
import { DevicePill, How, Inspect, Receipts, WHERE_RAN, type Records } from './ui/pages';
import { draftFailure, resultOrder, summaryLine } from './ui/say';
import { keptAfterRecheck, modelSaid, recheckItems, rewriteStep, stepIndexOf, stepToRewrite } from './core/recheck';
import { canFit, FIT_FAILED, FIT_LABEL, fitInputFor, fitStep } from './ai/fit';
import { useInstall, useUpdate } from './ui/pwa';
import { checkNeed, needIsTyped, needLine, outgoingOf, sharedNeeds, type Need } from './core/needs';
import { asRecordedRun, captureRun, RECORDED_FILE, RECORDED_FIT_LABEL, replayBanner, replayNext, type RecordedFit, type RecordedRun, type ReplayStage } from './core/recorded';
import { familyAfterRewrite, familyFor } from './core/family';
import { REPEATS_NOTE, repeatsPrivate } from './core/repeats';
import { configured, DEFAULT_POLICY, loadPolicy, loadReceiptCopies, saveReceiptCopy, watchUser, type Policy } from './ai/firebase';
import { deviceStatus, prepareDevice, type DeviceStatus } from './ai/routes';
import { guardOnDevice, guardOutcome, paragraphs, unreadText } from './ai/guard';
import { constraintsOnDevice, mergeProposals, type ConstraintReport } from './ai/constraints';
import { NOTE_MAX } from './core/text';
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
import { anythingToCheck, checkDidNotRun, checkOnDevice, detailsFor, keepNoConflict, noConflictFound, NOTHING_WITHHELD, startsKept } from './ai/check';
import { combineChecks, ruleCheckItem, verdictLabel } from './core/conflicts';
import { CloudText, DeviceText, KIND_LABEL, RouteChip, Spinner, Stepper } from './ui/parts';

type Stage = 'write' | 'guarding' | 'review' | 'drafting' | 'checking' | 'result' | 'signed';
type View = 'desk' | 'receipts' | 'how';

// The five steps the teacher sees: Write, What leaves, Draft, What your device caught, Sign off.
const STEP: Record<Stage, number> = { write: 0, guarding: 1, review: 1, drafting: 2, checking: 3, result: 3, signed: 5 };

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
// The constraints live with the note: in this tab only, and only for the note they were made for.
const CONSTRAINTS_KEY = 'staffroom.constraints';

// Earlier versions kept the raw note and the class list in local storage. Remove what they left.
try {
  localStorage.removeItem(NOTE_KEY);
  localStorage.removeItem(CLASS_LIST_KEY);
} catch {
  // Storage is switched off, so there is nothing to remove.
}

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
/** Thrown inside the check when this browser has no on-device model. It is caught there and is no error to the teacher. */
const NO_MODEL = new Error('no on-device model was available.');

export function App() {
  const [view, setView] = useState<View>('desk');
  const [stage, setStage] = useState<Stage>('write');
  const [note, setNote] = useState(() => read(session, NOTE_KEY, ''));
  const [classList, setClassList] = useState<string[]>(() => read(session, CLASS_LIST_KEY, []));
  const [task, setTask] = useState<TaskId>('parents');
  /** False on the first screen: no form is shown until the teacher chooses to write, or a note is already kept in this tab. */
  const [composing, setComposing] = useState(() => read(session, NOTE_KEY, '') !== '');
  const [inspecting, setInspecting] = useState(false);
  /** Whether the list of what is withheld is unfolded. */
  const [vaultOpen, setVaultOpen] = useState(false);
  /** Why the last draft was not written, in plain words. */
  const [draftFail, setDraftFail] = useState<{ say: string; status?: number } | null>(null);

  const [device, setDevice] = useState<DeviceStatus>('checking');
  const [download, setDownload] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [uid, setUid] = useState<string | null>(null);
  const [keepCopies, setKeepCopies] = useState(() => read(local, 'staffroom.keepCopies', false));

  /** The vault as the guard and the teacher left it. Read `entities` below, which has the school's locks applied. */
  const [rawEntities, setEntities] = useState<Entity[]>([]);
  /** The constraints of this note: proposed, confirmed, or added by hand. They never leave the device. */
  const [constraints, setConstraints] = useState<Constraint[]>(
    () => read(session, CONSTRAINTS_KEY, { note: '', constraints: [] as Constraint[] }).constraints,
  );
  /** The note the constraints were made for. They are kept across a new guard run only while the note is the same. */
  const constraintsNote = useRef(read(session, CONSTRAINTS_KEY, { note: '', constraints: [] as Constraint[] }).note);
  /** Where the on-device model's search for constraints fell short. Null when it did not, or did not run. */
  const [constraintGaps, setConstraintGaps] = useState<Pick<ConstraintReport, 'asked' | 'unread' | 'dropped' | 'stopped'> | null>(null);
  /** The vault item whose release was asked for while a confirmed constraint holds it. */
  const [unconfirmAsk, setUnconfirmAsk] = useState<string | null>(null);
  const [guardWhere, setGuardWhere] = useState<Where>('NOT_RUN');
  const [guardGaps, setGuardGaps] = useState<Gaps>(NO_GAPS);
  const [progress, setProgress] = useState('');
  /** The item the teacher asked to release while only the built-in defaults are in force: asked about before it is released. */
  const [releaseAsk, setReleaseAsk] = useState<string | null>(null);
  const [selection, setSelection] = useState('');
  /** Where in the note the selection was made, so the words meant are marked and not the same letters elsewhere. */
  const selectionSpan = useRef<{ start: number; end: number } | null>(null);
  /** Said in place of the marking buttons when a selection cannot be used. */
  const [selectionNote, setSelectionNote] = useState('');
  /** The exact outgoing text the teacher ticked as read. The tick holds only while this is still the outgoing text. */
  const [readKey, setReadKey] = useState<string | null>(null);
  /** The second tick, asked for when nothing is withheld: "I am sending my note as written". Bound to the same text and policy. */
  const [asWrittenKey, setAsWrittenKey] = useState<string | null>(null);
  /** The tick asked for when the on-device model could not read some parts: "I have read those parts myself". */
  const [unreadKey, setUnreadKey] = useState<string | null>(null);
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
    /** The constraints as they stood at approval. The check is made against these. */
    constraints: Constraint[];
    /** The needs that were told to the cloud, as lines of the approved text. */
    needs: Need[];
  } | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [replyIssues, setReplyIssues] = useState<Violation[]>([]);
  const [replyRead, setReplyRead] = useState(false);
  const [checks, setChecks] = useState<ItemCheck[]>([]);
  /** The verdicts as the first check gave them, before any constraint was switched or any step rewritten. */
  const [firstChecks, setFirstChecks] = useState<ItemCheck[]>([]);
  /** What the on-device model answered for each item in the first check. It is carried over, never asked again. */
  const [modelChecks, setModelChecks] = useState<(ItemCheck | undefined)[]>([]);
  /** Items the teacher rewrote on the device, by position: the new text, stand-ins and all. Nothing of it is sent. */
  const [edits, setEdits] = useState<Record<number, string>>({});
  /** Constraints the teacher switched off on the result screen. The draft is checked again without them, by rule. */
  const [offIds, setOffIds] = useState<string[]>([]);
  /** True once the draft has been checked again on the device after the first check. */
  const [rechecked, setRechecked] = useState(false);
  /** The items whose step is being rewritten, and the words in each box. `suggested`: the words began as a suggestion of the on-device model. */
  const [rewriting, setRewriting] = useState<Record<number, { step: string; whole: boolean; text: string; suggested?: boolean }>>({});
  /** The item the on-device model is fitting now, and whether it is going through all of them. */
  const [fitting, setFitting] = useState<number | null>(null);
  const [fittingAll, setFittingAll] = useState(false);
  const fitBusy = useRef(false);
  /** What is said under an item the on-device model could not fit. */
  const [fitSaid, setFitSaid] = useState<Record<number, string>>({});
  /** The suggestions the on-device model made in this run, the latest for each item. */
  const [fits, setFits] = useState<RecordedFit[]>([]);
  /** The items whose saved rewrite began as a suggestion of the on-device model. */
  const [fitted, setFitted] = useState<number[]>([]);
  /** Rewritten messages home that repeat words of the private note, whose copy the teacher turned on. */
  const [copyOn, setCopyOn] = useState<number[]>([]);
  /** Where the fit ran in this run. NOT_RUN until the on-device model has answered once. */
  const [fitWhere, setFitWhere] = useState<Where>('NOT_RUN');
  const [checkWhere, setCheckWhere] = useState<Where>('NOT_RUN');
  /** How many requests the check made to the on-device model and how many failed. Null when it made none. */
  const [checkRequests, setCheckRequests] = useState<{ asked: number; failed: number } | null>(null);
  /** For each item: kept (true), struck (false), or not yet decided (null). An undecided item blocks sign-off. */
  const [kept, setKept] = useState<(boolean | null)[]>([]);
  /** True from the click on Sign off until the receipt is written: nothing can be kept or struck in between. */
  const [signing, setSigning] = useState(false);
  const signingRef = useRef(false);
  /** True from the click on Approve and send until that run ends: a second click starts nothing. */
  const sendingRef = useRef(false);
  /** Counts the runs on this page, so work that finishes after a run was cleared does not write into the next one. */
  const runRef = useRef(0);
  const [label, setLabel] = useState<{ title: string; where: LabelWhere } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>(loadReceipts);
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'saved' | 'failed'>('idle');
  /** True when this browser would not store the receipt just signed. */
  const [storeFailed, setStoreFailed] = useState(false);
  /** The inline question asked before forgetting, when receipts are kept. */
  const [forgetAsk, setForgetAsk] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  /** False until the school's policy has loaded, or the app has given up waiting and taken the defaults. */
  const [policyReady, setPolicyReady] = useState(false);
  const policyReadyRef = useRef(false);
  const [records, setRecords] = useState<Records>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  /** The last copy to the clipboard: the whole text or one item, and whether it worked. */
  const [copied, setCopied] = useState<{ what: 'all' | number; ok: boolean } | null>(null);
  /** The recorded run kept beside the app, when there is one and it is in the right form. */
  const [recorded, setRecorded] = useState<RecordedRun | null>(null);
  /** Set while a recorded run is replayed. Nothing is sent, no model is asked and no receipt is written. */
  const [replay, setReplay] = useState<RecordedRun | null>(null);
  /** The teacher's own note and settings, put aside while a recorded run is on screen. */
  const stash = useRef<{ note: string; classList: string[]; constraints: Constraint[]; task: TaskId } | null>(null);
  /** ?capture=1: a developer switch that offers the finished run as a file in the form of a recorded run. */
  const capture = useMemo(() => new URLSearchParams(globalThis.location?.search ?? '').get('capture') === '1', []);
  const noteRef = useRef<HTMLDivElement>(null);
  /** The policy as last loaded, readable at the moment of sending even before a re-render. */
  const policyRef = useRef<Policy>(DEFAULT_POLICY);

  // ---------------------------------------------------------------- start-up

  useEffect(() => {
    deviceStatus().then(setDevice);
    const usePolicy = (p: Policy) => {
      policyRef.current = p;
      policyReadyRef.current = true;
      setPolicyReady(true);
      setPolicy(p);
    };
    // The second argument takes a school policy that arrives after the wait. The approval is bound
    // to the policy, so a tick made under the fallback does not carry over.
    loadPolicy(undefined, usePolicy).then(usePolicy);
    // The recorded run is a file beside the app. No file, or one in another form: no replay is offered.
    fetch(`${import.meta.env.BASE_URL}${RECORDED_FILE}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRecorded(asRecordedRun(data) ?? null))
      .catch(() => setRecorded(null));
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

  // A recorded run on screen is not the teacher's note: it is never written over what the tab keeps.
  useEffect(() => {
    if (!replay) write(session, NOTE_KEY, note, note === '');
  }, [note, replay]);
  useEffect(() => {
    if (!replay) write(session, CLASS_LIST_KEY, classList, classList.length === 0);
  }, [classList, replay]);
  useEffect(() => write(local, 'staffroom.keepCopies', keepCopies, false), [keepCopies]);
  useEffect(() => {
    if (!replay) write(session, CONSTRAINTS_KEY, { note: constraintsNote.current, constraints }, constraints.length === 0);
  }, [constraints, replay]);

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
    // In a replay the vault is the recorded one, as it stood: today's policy is not applied to it.
    () => (replay ? rawEntities : (sent?.entities ?? lockConstraints(applyLocks(rawEntities, policy.lockedKinds), constraints))),
    [replay, sent, rawEntities, policy.lockedKinds, constraints],
  );
  // The redacted note, with the needs the teacher chose to tell under it. The gate runs on both.
  const going = useMemo(() => outgoingOf(note, entities, sent?.constraints ?? constraints), [note, entities, sent, constraints]);
  // In a replay the text shown is the text that was sent on the day, as recorded.
  const outgoing = replay ? replay.outgoing : going.text;
  /** True when not one stand-in was written: the outgoing text is the note as the teacher wrote it. */
  const nothingWithheld = replay ? false : going.noteAsWritten;
  const violations = replay ? [] : going.violations;
  const approval = approvalKey(outgoing, policy.lockedKinds, policy.cloudModel);
  const asWrittenApproval = approvalKey(outgoing, policy.lockedKinds, policy.cloudModel, true);
  const readIt = readKey !== null && readKey === approval;
  const asWritten = asWrittenKey !== null && asWrittenKey === asWrittenApproval;
  /** True when a model read the note but not all of it. A rules-only run says as much on the main tick. */
  const partsUnread = guardWhere === 'ON_DEVICE' && guardGaps.unread.length > 0;
  const unreadApproval = approvalKey(outgoing, policy.lockedKinds, policy.cloudModel, false, guardGaps.unread);
  const unreadAcked = unreadKey !== null && unreadKey === unreadApproval;

  // The ticks are for one exact text under one policy. If either changes, they are cleared.
  useEffect(() => {
    setReadKey(null);
    setAsWrittenKey(null);
    setUnreadKey(null);
  }, [approval]);

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

  const noteNow = note;
  const classListNow = classList;
  const runGuard = async (useNote?: string, useList?: string[]) => {
    // A run that is cleared or forgotten while it waits for the model must not write its findings afterwards.
    if (replay) return;
    const run = ++runRef.current;
    const gone = () => runRef.current !== run;
    // The sample is guarded in the same click that loads it, before the state has the note.
    const note = useNote ?? noteNow;
    const classList = useList ?? classListNow;
    setError(null);
    setDraftFail(null);
    setStage('guarding');
    setSelection('');
    setReadKey(null);
    setAsWrittenKey(null);
    setSent(null);
    setResult(null);
    const candidates = deterministicCandidates(note, classList);
    let where: Where = 'RULES_ONLY';
    let gaps = NO_GAPS;
    setProgress('Checking the class list, the pattern rules and the sensitive words');
    const ready = await turnOnDevice();
    if (gone()) return;
    if (ready) {
      try {
        const report = await guardOnDevice(note, (done, total) => {
          if (!gone()) setProgress(`The on-device model is reading part ${Math.min(done + 1, total)} of ${total}`);
        });
        if (gone()) return;
        candidates.push(...report.candidates);
        const outcome = guardOutcome(report);
        where = outcome.where;
        // The parts the model could not read are kept even when it read none: the run is then a rules-only
        // run, and the page and the receipt still say the model was asked and failed.
        gaps = { unread: outcome.unread, dropped: outcome.dropped, partial: outcome.partial };
        if (where === 'RULES_ONLY') {
          setError(
            `${report.stopped ?? 'The on-device model could not read any part of the note.'} Only the rules were applied. Read the outgoing text with care.`,
          );
        } else if (report.stopped) {
          setError(`The on-device guard stopped early: ${report.stopped} Check the parts it did not read.`);
        }
      } catch (e) {
        if (gone()) return;
        // The run broke before it could report. Every part counts as unread.
        gaps = { unread: paragraphs(note).map((_, i) => i), dropped: 0, partial: 0 };
        setError(`The on-device guard stopped: ${message(e)} Only the rules were applied. Read the outgoing text with care.`);
      }
    }
    // With no model, a capitalised word that is not an ordinary sentence opener is held back as a possible name. A guess: it can be released.
    if (where === 'RULES_ONLY') candidates.push(...possibleNameCandidates(note, classList));
    // The model read some parts and not others: the same rule covers the parts it did not read.
    else if (gaps.unread.length > 0) candidates.push(...possibleNameCandidates(unreadText(note, gaps.unread), classList));
    const vault = buildVault(note, candidates);
    // Constraints the teacher confirmed or added for this same note are kept; the rest are proposed afresh.
    let proposed = proposeConstraints(note, vault);
    let fellShort: typeof constraintGaps = null;
    if (where === 'ON_DEVICE') {
      // The on-device model looks for constraints too. A failure here blocks nothing: what the rules found stands.
      try {
        const report = await constraintsOnDevice(note, vault, (done, total) => {
          if (!gone()) setProgress(`The on-device model is looking for constraints in part ${Math.min(done + 1, total)} of ${total}`);
        });
        if (gone()) return;
        proposed = mergeProposals(proposed, report.constraints);
        if (report.unread > 0 || report.dropped > 0 || report.stopped) fellShort = report;
      } catch (e) {
        if (gone()) return;
        fellShort = { asked: 0, unread: 0, dropped: 0, stopped: `The search for constraints stopped: ${message(e)}` };
      }
    }
    setConstraintGaps(fellShort);
    const held = restoreConstraints(note, vault, constraintsNote.current === note ? constraints : [], proposed);
    constraintsNote.current = note;
    setEntities(held.entities);
    setConstraints(held.constraints);
    setGuardWhere(where);
    setGuardGaps(gaps);
    setStage('review');
  };

  const flip = (id: string) =>
    setEntities((list) =>
      list.map((e) => (e.id === id && !policyRef.current.lockedKinds.includes(e.kind) ? { ...e, withheld: !e.withheld } : e)),
    );

  /**
   * Withhold or release one item. Under the built-in defaults the app does not know what the school
   * allows, so releasing is asked about first: see the question under the item.
   */
  const toggle = (e: Entity) => {
    if (replay) return;
    setUnconfirmAsk(null);
    // A confirmed constraint holds its words back. They are released only after it is unconfirmed.
    if (e.withheld && heldByConstraints(constraints).has(e.id)) {
      setReleaseAsk(null);
      setUnconfirmAsk(e.id);
    } else if (e.withheld && policyRef.current.origin === 'defaults') setReleaseAsk(e.id);
    else {
      setReleaseAsk(null);
      flip(e.id);
    }
  };

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
    if (stage !== 'review' || replay) return;
    const onChange = () => readSelection(true);
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [stage, replay, readSelection]);

  /** Mark the selection. Text already in the vault is set back to withheld; a cut word is widened to the whole word. */
  const withholdSelection = (kind: Kind) => {
    const span = selectionSpan.current ?? undefined;
    if (!span || replay) return;
    setEntities((list) => addByTeacher(note, list, selection, kind, span));
    selectionSpan.current = null;
    setSelection('');
    setSelectionNote('');
    window.getSelection()?.removeAllRanges();
  };

  // ---------------------------------------------------------------- constraints

  /** The vault and the constraints change together: confirming a constraint withholds its words. */
  const hold = (held: { entities: Entity[]; constraints: Constraint[] }) => {
    if (stage !== 'review' || replay) return;
    setEntities(held.entities);
    setConstraints(held.constraints);
  };

  const constraintActions = {
    onConfirm: (id: string) => hold(confirmConstraint(note, rawEntities, constraints, id)),
    onUnconfirm: (id: string) => hold({ entities: rawEntities, constraints: unconfirmConstraint(constraints, id) }),
    onRemove: (id: string) => hold({ entities: rawEntities, constraints: removeConstraint(constraints, id) }),
    onKind: (id: string, kind: ConstraintKind) => hold({ entities: rawEntities, constraints: setConstraintKind(constraints, id, kind) }),
    onTriggers: (id: string, typed: string) => hold({ entities: rawEntities, constraints: setTriggers(constraints, id, typed) }),
    onShare: (id: string, share: boolean) => hold({ entities: rawEntities, constraints: setShare(constraints, id, share) }),
    onNeed: (id: string, typed: string) => hold({ entities: rawEntities, constraints: setNeed(constraints, id, typed) }),
    onAdd: (by: { kind: ConstraintKind; about?: string; text: string }) => {
      // Words taken from the selection are withheld at the place they were selected.
      const span = selectionSpan.current;
      const at = span && note.slice(span.start, span.end) === by.text.trim() ? span.start : undefined;
      hold(addConstraint(note, rawEntities, constraints, { ...by, at }));
    },
  };

  /** The need line of a constraint as it would be sent, and what the exit gate stops in it. */
  const needOf = (c: Constraint) => {
    const line = needLine(c, entities);
    return { typed: needIsTyped(c), line, issues: line ? checkNeed(line, entities) : [] };
  };

  // ---------------------------------------------------------------- steps 3 to 5: approve, draft, check

  const approveAndSend = async () => {
    // Everything is worked out again at the moment of sending: the current locks, the text they give,
    // and the gate on exactly that text. It is sent only if it is the text the teacher ticked as read.
    if (!policyReadyRef.current || sendingRef.current || replay) return;
    const sentPolicy = policyRef.current;
    const current = lockConstraints(applyLocks(rawEntities, sentPolicy.lockedKinds), constraints);
    const approved = outgoingOf(note, current, constraints);
    const { text, tokens } = approved;
    const stopped = approved.violations;
    // The tick was for one text, one set of locks and one drafting model. Any of them changed: no send.
    const read = readKey !== null && readKey === approvalKey(text, sentPolicy.lockedKinds, sentPolicy.cloudModel);
    // With nothing withheld the note goes out as written, and that needs its own tick for this same text.
    const written =
      !approved.noteAsWritten ||
      (asWrittenKey !== null && asWrittenKey === approvalKey(text, sentPolicy.lockedKinds, sentPolicy.cloudModel, true));
    // Parts no model read need their own tick too, for this same text.
    const unreadOk =
      !(guardWhere === 'ON_DEVICE' && guardGaps.unread.length > 0) ||
      (unreadKey !== null && unreadKey === approvalKey(text, sentPolicy.lockedKinds, sentPolicy.cloudModel, false, guardGaps.unread));
    const same = read && written && unreadOk;
    if (stage !== 'review' || !same || stopped.length > 0) {
      setReadKey(null);
      setAsWrittenKey(null);
      setUnreadKey(null);
      setError(
        stopped.length > 0
          ? 'The exit gate stopped the text. Nothing was sent.'
          : 'The outgoing text or the policy is not what you ticked as read. Nothing was sent. Read it again, then approve.',
      );
      return;
    }
    // Locked at once, before anything is awaited, so a second click cannot send the text twice.
    sendingRef.current = true;
    const run = runRef.current;
    const gone = () => runRef.current !== run;
    const entities = current;
    const cloudModel = sentPolicy.cloudModel;
    const sentOnline = navigator.onLine;
    setError(null);
    setDraftFail(null);
    const approvedAt = new Date().toISOString();
    setSent({ text, at: approvedAt, entities, tokens, online: sentOnline, policy: sentPolicy, constraints, needs: approved.needs });
    setStage('drafting');
    let drafted: DraftResult;
    try {
      drafted = await writeDraft(text, currentTask, cloudModel);
    } catch (e) {
      if (gone()) return;
      sendingRef.current = false;
      setSent(null);
      setStage('review');
      // Said in one plain sentence. What the SDK reported is not shown.
      setDraftFail(
        configured
          ? draftFailure(e, navigator.onLine)
          : { say: 'This build has no Firebase project, so the cloud refused the request and no draft was written.' },
      );
      return;
    }
    // The note was forgotten, or the run cleared, while the draft was being written: nothing of it is kept.
    if (gone()) return;
    setResult(drafted);
    // A stand-in the model wrote without its brackets is read as that stand-in, if it was one that was sent.
    const items = bracketDraft(drafted.draft, tokens).items;
    setKept(items.map(() => null));
    const replyText = [drafted.draft.title, ...drafted.draft.items.flatMap((i) => [i.heading, i.text])].join('\n');
    setReplyIssues(checkReply(replyText, entities, tokens, text));
    setReplyRead(false);

    // Said before the first request, so the guard's last progress line is not shown under the check.
    setProgress('The on-device model is checking the draft against what you withheld');
    setStage('checking');
    let itemChecks: ItemCheck[];
    let where: Where = 'NOT_RUN';
    let requests: { asked: number; failed: number } | null = null;
    let byModelSaid: (ItemCheck | undefined)[] | null = null;
    // What the check reads: the vault, and what the teacher typed as a constraint that is not in the note.
    const facts = withConstraintFacts(entities, constraints);
    if (!anythingToCheck(items, facts)) {
      // No private detail was withheld and no constraint confirmed: there is nothing to check, so no model is asked.
      itemChecks = items.map(() => NOTHING_WITHHELD);
      where = 'SKIPPED';
    } else {
      // Layer A: each step against each confirmed constraint, by rule. No model, so it runs in every browser.
      // Every confirmed constraint is compared, whether or not the cloud was told its need: the cloud can ignore a need.
      const told = new Map(approved.needs.map((n) => [n.id, n.line]));
      const byRule = items.map((item) => ruleCheckItem(item, constraints, entities, tokens, note, told));
      const ruleRan = byRule.some((r) => r.compared > 0);
      const unchecked = (reason: string): ItemCheck => ({ verdict: 'not checked', reason });
      // Layer B: the on-device model, against every withheld private detail. Its "no" is a doubt, never a conflict.
      let byModel: ItemCheck[] | null = null;
      let why = 'The on-device check did not run. Read this item against the private details yourself.';
      try {
        // No on-device model here: the rules have spoken, and the page says so once, calmly. This is not an error.
        const present = (await deviceStatus()) === 'available';
        if (gone()) return;
        if (!present) throw NO_MODEL;
        const checked = await checkOnDevice(note, items, facts, tokens, (done, total) => {
          if (!gone()) setProgress(`The on-device model is checking item ${Math.min(done + 1, total)} of ${total}`);
        });
        if (gone()) return;
        requests = { asked: checked.asked, failed: checked.failed };
        if (checkDidNotRun(checked)) {
          // Every request failed, so the model checked nothing. It is recorded as a check that did not run.
          setError(
            `The on-device check could not run: all ${checked.asked} of its requests to the on-device model failed. ${
              ruleRan ? 'The items below were checked by rule only.' : 'The items below are not checked.'
            }`,
          );
          why = 'The on-device model did not answer. Read this item against the private details yourself.';
        } else {
          byModel = checked.checks;
          byModelSaid = checked.checks;
          where = 'ON_DEVICE';
        }
      } catch (e) {
        if (gone()) return;
        // Say what happened. The draft stays; what the rules found stands, and the rest is marked unchecked.
        if (e !== NO_MODEL) setError(
          `The on-device check stopped: ${message(e)} ${ruleRan ? 'The items below were checked by rule only.' : 'The items below are not checked.'}`,
        );
      }
      if (!byModel && ruleRan) where = 'RULES_ONLY';
      itemChecks = items.map((_, i) => combineChecks(byRule[i], byModel?.[i], unchecked(why)));
    }
    setCheckRequests(requests);
    setChecks(itemChecks);
    setFirstChecks(itemChecks);
    setModelChecks(byModelSaid ?? itemChecks.map(() => undefined));
    setEdits({});
    setOffIds([]);
    setRechecked(false);
    setRewriting({});
    setFitting(null);
    setFittingAll(false);
    setFitSaid({});
    setFits([]);
    setFitted([]);
    setCopyOn([]);
    setFitWhere('NOT_RUN');
    // An item in conflict starts struck. Every other item starts undecided: nothing is kept until the teacher keeps it.
    setKept(startsKept(itemChecks));
    setCheckWhere(where);
    // The result is shown at once. The receipt has a plain title, made from the task and the day, until the
    // naming call answers; it keeps that title if the call fails or the teacher signs off first.
    const plain = plainTitle(currentTask.id, new Date(approvedAt));
    setLabel({ title: plain, where: 'FALLBACK' });
    sendingRef.current = false;
    setStage('result');
    void labelReceipt(text, plain, cloudModel).then((named) => {
      if (gone() || signingRef.current) return;
      // The title is model-written and is kept with the receipt, so it passes the same checks as outgoing text
      // (names, withheld items, patterns, sensitive words) or the plain title stays.
      setLabel({ ...named, title: safeTitle(named.title, entities, plain) });
    });
  };

  // ---------------------------------------------------------------- step 6: sign off

  const signOff = async () => {
    // Locked at once, before anything is awaited: a second click, or a keep or strike made while the
    // receipt is being written, changes nothing. What is recorded is what was on screen at the click.
    if (signingRef.current || stage !== 'result' || !result || !sent || replyBlocked || replay) return;
    // Signing off with nothing kept is allowed: it rejects the whole draft, and is recorded like any other sign-off.
    if (kept.some((k) => k === null)) return;
    signingRef.current = true;
    setSigning(true);
    const run = runRef.current;
    const signed = [...kept];
    const receipt = makeReceipt({
      task,
      label: label?.title || plainTitle(task, new Date(sent.at)),
      labelWhere: label?.where ?? 'FALLBACK',
      entities,
      guardWhere,
      unreadParagraphs: guardGaps.unread.length,
      droppedDetails: guardGaps.dropped + guardGaps.partial,
      sentText: sent.text,
      approvedAt: sent.at,
      draftWhere: result.where,
      draftModel: result.model,
      cloudFailedWhile: result.where === 'ON_DEVICE' ? (sent.online ? 'online' : 'offline') : undefined,
      checkWhere,
      checkRequests: checkRequests ?? undefined,
      replyFlagged: replyIssues.length > 0,
      checks,
      // The constraints in force at sign-off: one switched off on the result screen is not counted as confirmed.
      constraints: { ...constraintCounts(liveConstraints), shared: sent.needs.length },
      rewritten: signed.filter((k, i) => k === true && i in edits).length,
      fittedOnDevice: signed.filter((k, i) => k === true && i in edits && fitted.includes(i)).length,
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
    if (signingRef.current || stage !== 'result' || replay) return;
    setKept((k) => k.map((v, j) => (j === i ? keep : v)));
  };

  /** The draft as it is read on this device: a bare stand-in that was sent has its brackets back. `result.draft` is the reply as it came. */
  const draft = useMemo(() => {
    if (!result) return null;
    const came = bracketDraft(result.draft, sent?.tokens ?? []);
    // A step the teacher rewrote replaces the cloud's on this device. `result.draft` stays the reply as it came.
    return { ...came, items: came.items.map((item, i) => (i in edits ? { ...item, text: edits[i] } : item)) };
  }, [result, sent, edits]);

  // ---------------------------------------------------------------- checking again, on the device

  /** The constraints of the run as they stand on the result screen: one the teacher switched off is not confirmed. */
  const liveConstraints = useMemo(
    () => (sent?.constraints ?? []).map((c) => (offIds.includes(c.id) ? { ...c, confirmed: false } : c)),
    [sent, offIds],
  );

  /**
   * Check the draft again, by rule, with these edits and these constraints switched off. No model is asked
   * and nothing is sent: the cloud's draft is the same one, and what the on-device model said earlier is kept.
   */
  const checkAgain = (nextEdits: Record<number, string>, nextOff: string[]) => {
    if (signingRef.current || stage !== 'result' || !result || !sent || replay) return;
    const came = bracketDraft(result.draft, sent.tokens).items;
    const items = came.map((item, i) => (i in nextEdits ? { ...item, text: nextEdits[i] } : item));
    const live = sent.constraints.map((c) => (nextOff.includes(c.id) ? { ...c, confirmed: false } : c));
    const told = new Map(sent.needs.filter((n) => !nextOff.includes(n.id)).map((n) => [n.id, n.line]));
    const after = recheckItems(items, live, sent.entities, sent.tokens, note, told, modelChecks, items.map((_, i) => i in nextEdits));
    setKept((k) => keptAfterRecheck(k, checks, after));
    setChecks(after);
    setEdits(nextEdits);
    setOffIds(nextOff);
    setRechecked(true);
    // The return gate reads the draft as it now stands, the teacher's own words included.
    const replyText = [result.draft.title, ...items.flatMap((i) => [i.heading, i.text])].join('\n');
    const issues = checkReply(replyText, sent.entities, sent.tokens, sent.text);
    if (issues.map((v) => v.what + v.why).join('|') !== replyIssues.map((v) => v.what + v.why).join('|')) setReplyRead(false);
    setReplyIssues(issues);
  };

  /** Switch one confirmed constraint off or on, and check the same draft again by rule. */
  const switchConstraint = (id: string, on: boolean) => checkAgain(edits, on ? offIds.filter((x) => x !== id) : [...offIds, id]);

  /** Open the box to rewrite the step a rule matched, or the whole item when no step was matched. */
  const startRewrite = (i: number) => {
    if (!draft || !sent || replay || stage !== 'result') return;
    const { step, whole } = stepToRewrite(draft.items[i], sent.entities, sent.tokens, checks[i]?.matched);
    setRewriting((r) => ({ ...r, [i]: { step, whole, text: step } }));
  };

  const closeRewrite = (i: number) => setRewriting(({ [i]: _closed, ...rest }) => rest);

  /** What the fit reads when it runs: the screen as it stands then, not as it stood when a run of several began. */
  const liveRef = useRef({ draft, checks, liveConstraints, stage });
  liveRef.current = { draft, checks, liveConstraints, stage };

  /**
   * Ask the on-device model for other words for the step of item `i` that a rule found in conflict. The
   * suggestion only fills the rewrite box: nothing in the draft changes until the teacher saves it, and
   * saving goes through the same check by rule and the same return gate as the teacher's own words.
   */
  const fitOne = async (i: number) => {
    const now = liveRef.current;
    if (fitBusy.current || signingRef.current || replay || !sent || !now.draft || now.stage !== 'result' || device !== 'available') return;
    const item = now.draft.items[i];
    const input = fitInputFor(item, now.checks[i], now.liveConstraints, sent.entities, sent.tokens, note, task);
    if (!input) return;
    const run = runRef.current;
    fitBusy.current = true;
    setFitting(i);
    setFitSaid(({ [i]: _old, ...rest }) => rest);
    try {
      const got = await fitStep(input);
      if (runRef.current !== run) return;
      // fitStep reads an answer only when it came from the device, so an answer read is one that ran here.
      setFitWhere('ON_DEVICE');
      // The item was rewritten, or the run signed off, while the model was answering: the suggestion is for words that are gone.
      if (liveRef.current.stage !== 'result' || liveRef.current.draft?.items[i]?.text !== item.text) return;
      if (got.ok) {
        setRewriting((r) => ({ ...r, [i]: { step: input.step, whole: input.whole, text: got.suggestion, suggested: true } }));
        const stepIndex = input.whole ? 0 : stepIndexOf(item, input.step, sent.entities, sent.tokens);
        setFits((f) => [...f.filter((x) => x.itemIndex !== i), { itemIndex: i, stepIndex, suggestion: got.suggestion }].sort((a, b) => a.itemIndex - b.itemIndex));
      } else {
        setFitSaid((said) => ({ ...said, [i]: got.say }));
      }
    } catch {
      // No on-device model, a request that failed, or an answer from somewhere else: nothing is offered.
      if (runRef.current === run) setFitSaid((said) => ({ ...said, [i]: FIT_FAILED }));
    } finally {
      fitBusy.current = false;
      if (runRef.current === run) setFitting(null);
    }
  };

  /** Fit every item a rule found in conflict, one after another. Each suggestion waits in its own box. */
  const fitAll = async () => {
    if (fitBusy.current || fittingAll) return;
    const run = runRef.current;
    setFittingAll(true);
    for (const i of fittable) {
      if (runRef.current !== run || liveRef.current.stage !== 'result') break;
      await fitOne(i);
    }
    if (runRef.current === run) setFittingAll(false);
  };

  /** Put the words in the box in place of that step, on this device only, and check the item again by rule. */
  const saveRewrite = (i: number) => {
    const box = rewriting[i];
    if (!box || !draft || !sent) return;
    const typed = box.text.trim();
    closeRewrite(i);
    if (typed.length === 0 || typed === box.step) return;
    const next = rewriteStep(draft.items[i], box.step, typed, sent.entities, sent.tokens);
    // Counted as fitted on the device when the words began as its suggestion, changed by the teacher or not.
    if (box.suggested) setFitted((f) => (f.includes(i) ? f : [...f, i]));
    checkAgain({ ...edits, [i]: next.text }, offIds);
  };

  /** Confirm every constraint that is not yet confirmed. Each one withholds its words, as a single confirm does. */
  const confirmAll = () => {
    if (stage !== 'review' || replay) return;
    let held = { entities: rawEntities, constraints };
    for (const c of constraints) if (!c.confirmed) held = confirmConstraint(note, held.entities, held.constraints, c.id);
    setEntities(held.entities);
    setConstraints(held.constraints);
  };

  const finalText = useMemo(() => {
    if (!draft) return '';
    const items = draft.items.filter((_, i) => kept[i] === true);
    return restore([draft.title, '', ...items.map((i) => `${i.heading}\n${i.text}\n`)].join('\n'), entities, sent?.tokens).trim();
  }, [draft, kept, entities, sent]);

  /** Copy to the clipboard and say plainly whether it worked. The browser can refuse. */
  const copy = async (what: 'all' | number, text: string) => {
    // Nothing is copied before sign-off, from a flagged reply that was not read, or when no item was kept.
    if (replay || replyBlocked || stage !== 'signed' || !kept.some((k) => k === true)) return;
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
    sendingRef.current = false;
    setSigning(false);
    setCheckRequests(null);
    setStage('write');
    setEntities([]);
    setGuardWhere('NOT_RUN');
    setGuardGaps(NO_GAPS);
    setConstraintGaps(null);
    setSelection('');
    setSelectionNote('');
    setReleaseAsk(null);
    setUnconfirmAsk(null);
    setReadKey(null);
    setAsWrittenKey(null);
    setUnreadKey(null);
    setSent(null);
    setResult(null);
    setChecks([]);
    setFirstChecks([]);
    setModelChecks([]);
    setEdits({});
    setOffIds([]);
    setRechecked(false);
    setRewriting({});
    setFitting(null);
    setFittingAll(false);
    setFitSaid({});
    setFits([]);
    setFitted([]);
    setCopyOn([]);
    setFitWhere('NOT_RUN');
    setDraftFail(null);
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
    setConstraints([]);
    setComposing(false);
    constraintsNote.current = '';
    try {
      sessionStorage.removeItem(CONSTRAINTS_KEY);
      sessionStorage.removeItem(NOTE_KEY);
      sessionStorage.removeItem(CLASS_LIST_KEY);
      localStorage.removeItem(NOTE_KEY);
      localStorage.removeItem(CLASS_LIST_KEY);
    } catch {
      // Storage is switched off, so nothing was kept there.
    }
    window.getSelection()?.removeAllRanges();
  };

  // ---------------------------------------------------------------- the recorded run

  /** Show the recorded run in place of the teacher's note, which is put aside and brought back on leaving. */
  const startReplay = () => {
    if (!recorded || replay) return;
    stash.current = { note, classList, constraints, task };
    clearRun();
    setReplay(recorded);
    setNote(recorded.note);
    setClassList(recorded.classList);
    setConstraints(recorded.constraints);
    setTask(recorded.task);
    setView('desk');
  };

  const leaveReplay = () => {
    const back = stash.current;
    stash.current = null;
    clearRun();
    setReplay(null);
    setNote(back?.note ?? '');
    setClassList(back?.classList ?? []);
    setConstraints(back?.constraints ?? []);
    setTask(back?.task ?? 'parents');
  };

  /** The next screen of the replay. Everything shown comes from the file: no model is asked and nothing is sent. */
  const nextInReplay = () => {
    if (!replay || !['write', 'review', 'result'].includes(stage)) return;
    const to = replayNext(stage as ReplayStage);
    if (to === 'review') {
      setEntities(replay.entities);
      setGuardWhere(replay.where.guard);
    }
    if (to === 'result') {
      const tokens = [...new Set(replay.outgoing.match(TOKEN_RE) ?? [])];
      setSent({
        text: replay.outgoing,
        at: replay.recordedAt,
        entities: replay.entities,
        tokens,
        online: true,
        policy: replay.policy,
        constraints: replay.constraints,
        needs: sharedNeeds(replay.constraints, replay.entities),
      });
      setResult({ draft: replay.draft, where: replay.where.draft, model: replay.draftModel });
      const replyText = [replay.draft.title, ...replay.draft.items.flatMap((i) => [i.heading, i.text])].join('\n');
      // The return gate is plain code, so it is run again here on the recorded reply.
      setReplyIssues(checkReply(replyText, replay.entities, tokens, replay.outgoing));
      setReplyRead(false);
      setChecks(replay.checks);
      setFirstChecks(replay.checks);
      setModelChecks(replay.checks.map(modelSaid));
      setKept(startsKept(replay.checks));
      setCheckWhere(replay.where.check);
    }
    if (to === 'signed' && sent && replay.rewrites && replay.rewrites.length > 0) {
      // The last screen shows the run as it stood when it was saved: the rewritten items in place of the
      // cloud's, checked again here by rule. No model is asked.
      const came = bracketDraft(replay.draft, sent.tokens).items;
      const nextEdits = Object.fromEntries(replay.rewrites.map((r) => [r.itemIndex, r.text]));
      const items = came.map((item, i) => (i in nextEdits ? { ...item, text: nextEdits[i] } : item));
      const told = new Map(sent.needs.map((n) => [n.id, n.line]));
      const after = recheckItems(items, replay.constraints, replay.entities, sent.tokens, replay.note, told, modelChecks, items.map((_, i) => i in nextEdits));
      setKept((k) => keptAfterRecheck(k, checks, after));
      setChecks(after);
      setEdits(nextEdits);
      setRechecked(true);
      const replyText = [replay.draft.title, ...items.flatMap((i) => [i.heading, i.text])].join('\n');
      setReplyIssues(checkReply(replyText, replay.entities, sent.tokens, replay.outgoing));
    }
    setStage(to);
  };

  /** ?capture=1: save the run on screen as a file in the form of a recorded run. */
  const downloadRun = () => {
    if (!sent || !result || replay) return;
    const run = captureRun(
      {
        task,
        note,
        classList,
        entities: sent.entities,
        constraints: sent.constraints,
        outgoing: sent.text,
        policy: sent.policy,
        draft: result.draft,
        // The reply and the verdicts as they first came. What was rewritten or suggested since goes beside them, as it stands now.
        checks: firstChecks,
        where: { guard: guardWhere, draft: result.where, check: checkWhere },
        draftModel: result.model,
        rewrites: Object.entries(edits).map(([i, text]) => ({ itemIndex: Number(i), text })),
        fits,
      },
      new Date(),
      navigator.userAgent,
    );
    const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = RECORDED_FILE;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loadSample = () => {
    setNote(SAMPLE_NOTE);
    setClassList(SAMPLE_CLASS_LIST);
    // Messages home show the family rules and the constraints best.
    setTask('parents');
    setComposing(true);
  };

  /** The first screen's main button: load the invented class and run the guard in one go. */
  const trySample = () => {
    loadSample();
    void runGuard(SAMPLE_NOTE, SAMPLE_CLASS_LIST);
  };

  // ---------------------------------------------------------------- render

  const withheld = entities.filter((e) => e.withheld);
  /** A reply flagged at the return gate cannot be signed off or copied until the teacher has read it. */
  const replyBlocked = replyIssues.length > 0 && !replyRead;
  /** Private details that lie inside a longer one: shown under it in the vault. */
  const inside = useMemo(() => insidePrivate(note, entities), [note, entities]);
  /** The parts the on-device model reads the note in. */
  const noteParts = useMemo(() => paragraphs(note), [note]);
  /** Items the teacher has not yet chosen to keep or strike. */
  const undecided = kept.filter((k) => k === null).length;
  const keptCount = kept.filter((k) => k === true).length;
  const struckCount = kept.filter((k) => k === false).length;
  /** Undecided items the one button keeps: those with no conflict found. */
  const toKeep = kept.filter((k, i) => k === null && noConflictFound(checks[i])).length;
  const editing = stage === 'write';
  const busy = stage === 'guarding' || stage === 'drafting' || stage === 'checking';
  const after = stage === 'drafting' || stage === 'checking' || stage === 'result' || stage === 'signed';
  const noModel = device === 'unsupported' || device === 'unavailable';
  /** The first screen: no form until the teacher chooses one of the ways in. */
  const landing = view === 'desk' && editing && !composing && !replay;
  const watch = recorded && !replay ? startReplay : undefined;
  const confirmedCount = constraints.filter((c) => c.confirmed).length;
  const canSend = readIt && (!nothingWithheld || asWritten) && (!partsUnread || unreadAcked) && violations.length === 0 && policyReady;
  /** The private details that were withheld: what a rules-only check does not compare a step with. */
  const privateHeld = entities.filter((e) => e.kind === 'private' && e.withheld && e.category !== RESERVED && !inside.has(e.id));
  const order = resultOrder(checks, draft?.items.length ?? 0);
  const flagged = order.filter((i) => checks[i]?.verdict === 'conflict' || checks[i]?.verdict === 'unsure');
  const unflagged = order.filter((i) => !flagged.includes(i));
  /** The on-device model can be asked to fit a step: it is here, and this is a live run. */
  const canFitHere = stage === 'result' && !replay && device === 'available';
  /** Items a rule found in conflict that have no suggestion or rewrite waiting in a box. */
  const fittable = canFitHere ? order.filter((i) => canFit(checks[i], liveConstraints) && !(i in rewriting)) : [];
  const install = useInstall();
  const update = useUpdate();

  /** True for an item the teacher rewrote, or saved a suggestion for, that repeats words of the private note. Other words for the same thing are not found. */
  const repeatsNote = (i: number) =>
    Boolean(draft && sent && i in edits && repeatsPrivate(draft.items[i], sent.entities, liveConstraints, sent.tokens).length > 0);
  /** Whose family a message home is for. A rewrite that repeats words of the private note starts with copy off. */
  const familyOf = (item: DraftItem, i: number) =>
    familyAfterRewrite(familyFor(item, note, entities, sent?.tokens ?? [], classList), repeatsNote(i), copyOn.includes(i));

  /** The messages home that may be printed: the same ones that may be copied, each for one family. */
  const printable =
    stage === 'signed' && task === 'parents' && draft
      ? draft.items
          .map((item, i) => ({ item, i, family: familyOf(item, i) }))
          .filter((x) => kept[x.i] === true && x.family.student)
      : [];
  const canPrint = stage === 'signed' && !replay && !replyBlocked && keptCount > 0 && (task !== 'parents' || printable.length > 0);

  /** One row of the vault. `nested` rows are private details that lie inside the longer one above them. */
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
            disabled={locked || stage !== 'review' || Boolean(replay)}
            onChange={() => toggle(e)}
            aria-label={`Withhold ${e.surfaces[0]}`}
          />
          <span />
          {locked && <em>locked</em>}
        </label>
        {releaseAsk === e.id && e.withheld && !locked && stage === 'review' && (
          <div className="confirm release-ask" role="group" aria-label={`Release ${e.surfaces[0]}`}>
            <p>
              Your school's policy is not in force: the app is using its built-in defaults, so it cannot tell whether your school
              allows this to be sent. Release “{e.surfaces[0].length > 60 ? `${e.surfaces[0].slice(0, 60)}…` : e.surfaces[0]}” anyway?
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

  const vaultBody = (
    <>
      {/* The parts the model could not read are quoted here, on the device side: the words are from the raw note. */}
      {guardWhere === 'ON_DEVICE' &&
        guardGaps.unread.map((i) => (
          <p className="caution" key={i}>
            The on-device model could not read part {i + 1} of your note
            {noteParts[i] ? ` (it begins “${noteParts[i].slice(0, 40).trim()}…”)` : ''}. In that part, capitalised words were held
            back as possible names, by rule. Private details in it were not looked for: check it yourself before you approve.
          </p>
        ))}
      {entities.length === 0 ? (
        <p className="empty">Nothing was found to withhold.</p>
      ) : (
        <ul className="vault">{entities.filter((e) => !inside.has(e.id)).map((e) => vaultRow(e, false))}</ul>
      )}
    </>
  );

  /** The vault, folded: the constraints are the centre of the review, and the note shows what is held by colour. */
  const vaultFold = (
    <details
      className="card fold"
      // Open when the teacher opened it, and whenever it lists parts of the note the model could not read.
      open={vaultOpen || (guardWhere === 'ON_DEVICE' && guardGaps.unread.length > 0)}
      onToggle={(e) => setVaultOpen(e.currentTarget.open)}
    >
      <summary>
        {withheld.length} {withheld.length === 1 ? 'name or detail' : 'names and details'} withheld
      </summary>
      {vaultBody}
    </details>
  );

  /** The note as written, with what is held marked by kind. At the review its text can be selected to withhold more. */
  const noteView = (
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

  const noteLinks = (
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
      {!busy && !replay && (note !== '' || classList.length > 0) && (
        <button
          className="link forget"
          onClick={() => (receipts.length > 0 ? setForgetAsk(true) : forgetNote(false))}
          title="Clears the note, the class list, the vault and the results from this page and from this browser."
        >
          Forget this note
        </button>
      )}
    </span>
  );

  const forgetQuestion = forgetAsk && (
    <div className="confirm" role="group" aria-label="Forget this note">
      <p>
        Your note, class list, vault and results will be cleared. This browser also keeps {receipts.length}{' '}
        {receipts.length === 1 ? 'receipt' : 'receipts'}, and a receipt holds the text you approved. Delete{' '}
        {receipts.length === 1 ? 'it' : 'them'} too?
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

  /** One calm line for a run without the on-device model. The long form is one click away. */
  const calm =
    (stage === 'review' || stage === 'guarding') && guardWhere === 'RULES_ONLY' ? (
      <div className="calm" role="status">
        <p>
          <b>Rules only.</b>{' '}
          {guardGaps.unread.length > 0
            ? `The on-device model was asked and could not read any of the ${guardGaps.unread.length} ${guardGaps.unread.length === 1 ? 'part' : 'parts'} of your note`
            : 'No on-device model ran here'}
          , so no model has read your note. Anything you have not marked yourself is sent as written.
        </p>
        <details>
          <summary>Details</summary>
          <p>
            Only your class list, the pattern rules, a short list of sensitive words and a rule for capitalised words were applied. That
            rule holds back, as a possible name, a word that begins with a capital letter and is not an ordinary sentence opener, a day or
            a month. It cannot tell a name from any other capitalised word, and it misses a name written without a capital. Private
            details beyond the listed words were not looked for: select them in your note. No on-device model looked for constraints
            either: these were found by rule, so add any that are missing.
          </p>
        </details>
        {watch && (
          <button className="link" onClick={watch}>
            Watch a recorded run
          </button>
        )}
      </div>
    ) : (stage === 'result' || stage === 'signed') && checkWhere === 'RULES_ONLY' ? (
      <div className="calm" role="status">
        <p>
          <b>Checked by rule only.</b> No on-device model ran here, so each step was compared with the constraints you confirmed and
          nothing else. Read the items against your other private details yourself.
        </p>
        {privateHeld.length > 0 && (
          <details>
            <summary>
              {privateHeld.length} private {privateHeld.length === 1 ? 'detail' : 'details'} no model compared the draft with
            </summary>
            <ul className="quotes">
              {privateHeld.map((e) => (
                <li key={e.id}>“{e.surfaces[0]}”</li>
              ))}
            </ul>
          </details>
        )}
        {watch && (
          <button className="link" onClick={watch}>
            Watch a recorded run
          </button>
        )}
      </div>
    ) : null;

  /** One item of the draft: the words, what the device found, and the teacher's choice. */
  const resultItem = (i: number) => {
    if (!draft) return null;
    const item = draft.items[i];
    const c = checks[i];
    const conflict = c?.verdict === 'conflict';
    const doubt = c?.verdict === 'unsure';
    const edited = i in edits;
    const byRuleOnly = c?.verdict === 'not checked' && (c.rules ?? 0) > 0;
    const facts = detailsFor(item, withConstraintFacts(entities, sent?.constraints ?? []));
    const factCount = facts.reduce((n, f) => n + f.details.length, 0);
    // A message home is for one family: the copy button is offered only when the app can tell which.
    const family = task === 'parents' ? familyOf(item, i) : null;
    const live = stage === 'result' && !replay;
    const whole = live && (conflict || doubt) && sent ? stepToRewrite(item, sent.entities, sent.tokens, c?.matched).whole : true;
    const box = rewriting[i];
    /** In a replay: what the on-device model suggested for this item in the recorded run. Read-only. */
    const recordedFit = replay?.fits?.find((f) => f.itemIndex === i);
    return (
      <li
        key={i}
        className={['item', kept[i] === null ? 'undecided' : kept[i] ? 'kept' : 'struck', conflict ? 'is-conflict' : doubt ? 'is-doubt' : ''].join(' ').trim()}
      >
        <h4>
          <DeviceText text={item.heading} entities={entities} allowed={sent?.tokens} />
          {edited && <span className="edited-chip">{replay ? 'Rewritten in the recorded run' : 'Rewritten by you'}</span>}
        </h4>
        <p className="item-text">
          <DeviceText text={item.text} entities={entities} allowed={sent?.tokens} mark={conflict || (doubt && c?.constraintId) ? c?.matched : undefined} />
        </p>
        {c && conflict && (
          <div className="verdict v-conflict">
            <b>{verdictLabel(c)}</b>
            <span>{c.reason}</span>
            {c.also && (
              <span className="also">
                {rechecked ? 'In the earlier check the on-device model also doubted this: ' : 'The on-device model also doubts this: '}
                {c.also}
              </span>
            )}
            <Caught check={c} constraint={sent?.constraints.find((x) => x.id === c.constraintId)} />
          </div>
        )}
        {c && doubt && (
          <div className="verdict v-doubt">
            <b>{verdictLabel(c)}</b>
            <span>
              {c.reason}
              {rechecked && c.by === 'model' ? ' (From the earlier check.)' : ''}
            </span>
            {c.also && <span className="also">The on-device model also doubts this: {c.also}</span>}
            <Caught check={c} constraint={sent?.constraints.find((x) => x.id === c.constraintId)} />
          </div>
        )}
        {c && !conflict && !doubt && (
          <p className={`quiet-verdict q-${c.verdict.replace(' ', '-')}${byRuleOnly ? ' q-rule' : ''}`}>
            <b>{edited ? 'Checked by rule' : byRuleOnly ? 'No conflict found by rule' : verdictLabel(c)}</b>{' '}
            <span>
              {edited
                ? c.reason
                : byRuleOnly
                  ? `Compared with ${c.rules} ${c.rules === 1 ? 'constraint' : 'constraints'} you confirmed.`
                  : c.verdict === 'not checked' && checkWhere === 'RULES_ONLY'
                    ? 'No constraint you confirmed applies to this item, so no rule compared it.'
                    : `${c.reason}${rechecked && c.verdict === 'fits' ? ' (From the earlier check.)' : ''}`}
            </span>
          </p>
        )}
        {/* What the model compared the item with is said once per item, folded, and only when a model did. */}
        {c && checkWhere === 'ON_DEVICE' && c.verdict !== 'not checked' && !edited && factCount > 0 && (
          <details className="against">
            <summary>
              Checked against {factCount} private {factCount === 1 ? 'detail' : 'details'}, on this device only
            </summary>
            <p>{facts.flatMap((f) => f.details.map((d) => `“${d.surfaces[0]}”`)).join(', ')}</p>
          </details>
        )}
        {edited && repeatsNote(i) && (
          <p className="caution repeats-note" role="status">
            {REPEATS_NOTE}
          </p>
        )}
        {fitSaid[i] && live && !box && (
          <p className="caution fit-said" role="status">
            {fitSaid[i]}
          </p>
        )}
        {recordedFit && (
          <div className="rewrite fit-recorded">
            <b>{RECORDED_FIT_LABEL}</b>
            <p>{recordedFit.suggestion}</p>
          </div>
        )}
        {box && live && (
          <div className="rewrite">
            <label>
              {box.whole ? 'Rewrite this item' : 'Rewrite this step'}
              {box.suggested && <span className="fit-note">{FIT_LABEL}</span>}
              <textarea
                rows={3}
                value={box.text}
                maxLength={600}
                onChange={(e) => setRewriting((r) => ({ ...r, [i]: { ...box, text: e.target.value } }))}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
              />
            </label>
            <div className="actions">
              <button className="secondary small" disabled={signing || box.text.trim().length === 0} onClick={() => saveRewrite(i)}>
                Save and check by rule
              </button>
              <button className="link" onClick={() => closeRewrite(i)}>
                Cancel
              </button>
              <span className="hint">
                {box.suggested ? 'Change it or save it as it is. Nothing changes until you save.' : 'Your words stay on this device. No model is asked.'}
              </span>
            </div>
          </div>
        )}
        {/* A message home is copied one at a time, so one family's message never travels with another's. */}
        {stage === 'signed' && task === 'parents' && kept[i] === true && family && (
          <div className="copy-one">
            {family.student ? (
              <>
                <span className="for-family">For the family of {family.student.surfaces[0]}</span>
                <button className="secondary small" disabled={replyBlocked} onClick={() => copy(i, restore(item.text, entities, sent?.tokens).trim())}>
                  {copyLabel(i, 'Copy')}
                </button>
              </>
            ) : (
              <>
                <span className="caution copy-off">{family.why}</span>
                {family.mayTurnOn && !replay && (
                  <button className="secondary small" onClick={() => setCopyOn((on) => [...on, i])}>
                    Turn copy on for this message
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {stage === 'result' && !(box && live) && (
          <div className="decide" role="group" aria-label="Keep or strike this item">
            <button
              className={kept[i] === true ? 'choice on' : 'choice'}
              aria-pressed={kept[i] === true}
              aria-label="Keep this item"
              disabled={signing || Boolean(replay)}
              onClick={() => decide(i, true)}
            >
              Keep
            </button>
            <button
              className={kept[i] === false ? 'choice on strike' : 'choice'}
              aria-pressed={kept[i] === false}
              aria-label="Strike this item"
              disabled={signing || Boolean(replay)}
              onClick={() => decide(i, false)}
            >
              Strike
            </button>
            {canFitHere && canFit(c, liveConstraints) && (
              <button className="primary small" disabled={signing || fitting !== null || fittingAll} onClick={() => void fitOne(i)}>
                {fitting === i ? 'Fitting on this device…' : 'Fit this step on this device'}
              </button>
            )}
            {live && (conflict || doubt) && (
              <button className="link" disabled={signing || fitting === i} onClick={() => startRewrite(i)}>
                {whole ? 'Rewrite this item' : 'Rewrite this step'}
              </button>
            )}
            {live && edited && (
              <button
                className="link"
                disabled={signing}
                onClick={() => {
                  const { [i]: _dropped, ...rest } = edits;
                  setFitted((f) => f.filter((x) => x !== i));
                  checkAgain(rest, offIds);
                }}
              >
                Put the cloud's words back
              </button>
            )}
            <span className="hint state">
              {kept[i] === null
                ? 'Choose before you sign off.'
                : conflict && kept[i] === false
                  ? 'Struck to begin with. Keep it only if you still want it.'
                  : ''}
            </span>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>Staffroom</h1>
            {!landing && <p>{PROMISE}</p>}
          </div>
        </div>
        <nav aria-label="Sections">
          <button className={view === 'desk' ? 'tab on' : 'tab'} onClick={() => setView('desk')}>
            Desk
          </button>
          <button className={view === 'receipts' ? 'tab on' : 'tab'} onClick={() => setView('receipts')}>
            Receipts
            {/* The badge keeps its place when there is nothing to count, so the header does not shift when it appears. */}
            <span className={receipts.length > 0 ? 'count' : 'count none'} aria-hidden={receipts.length === 0}>
              {receipts.length}
            </span>
          </button>
          <button className={view === 'how' ? 'tab on' : 'tab'} onClick={() => setView('how')}>
            How it works
          </button>
        </nav>
        <div className="status">
          <DevicePill device={device} download={download} onTurnOn={turnOnDevice} onWatch={watch} />
          {/* navigator.onLine says only that this computer has a network. It does not say the cloud model will answer. */}
          {!online && (
            <span className="pill warn">
              <i />
              Network: offline
            </span>
          )}
          {!configured && (
            <span className="pill warn">
              <i />
              Cloud: not connected
            </span>
          )}
          {install && (
            <button className="pill action" onClick={install}>
              Install
            </button>
          )}
        </div>
      </header>

      {replay && (
        <p className="replay-banner" role="status">
          <span>{replayBanner(replay)}</span>
          <button className="link" onClick={leaveReplay}>
            Leave the recorded run
          </button>
        </p>
      )}

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

      {landing && <Hero onTry={trySample} onWrite={() => setComposing(true)} onWatch={watch} noModel={noModel} />}

      {view === 'desk' && !landing && (
        <main className="desk">
          <Stepper step={STEP[stage]} />
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {draftFail && stage === 'review' && (
            <div className="alert fail" role="alert">
              <p>
                <b>{draftFail.say}</b>
                {draftFail.status !== undefined && <small> Status {draftFail.status}.</small>}
              </p>
              <div className="actions">
                <button className="secondary small" disabled={!canSend} onClick={approveAndSend}>
                  Try again
                </button>
                {watch && (
                  <button className="link" onClick={watch}>
                    Watch a recorded run
                  </button>
                )}
              </div>
            </div>
          )}
          {calm}

          <div className="lanes">
            {/* ------------------------------------------------ the device */}
            <section className="lane device" aria-label="On this device">
              <h2 className="lane-title">
                <span>On this device</span>
                {stage === 'review' && <RouteChip route="guard" where={guardWhere} />}
                {(stage === 'result' || stage === 'signed') && <RouteChip route="check" where={checkWhere} />}
              </h2>

              {/* ---- the result comes first once there is one: what the device caught */}
              {stage === 'checking' && (
                <article className="card">
                  <Spinner label={progress} />
                </article>
              )}

              {(stage === 'result' || stage === 'signed') && result && draft && (
                <article className="card result">
                  <p className="eyebrow">{restore(draft.title, entities, sent?.tokens)}</p>
                  <h3 className="summary">{summaryLine(checks)}</h3>
                  {canFitHere && (fittable.length > 1 || fittingAll) && (
                    <div className="actions fit-all">
                      <button className="primary small" disabled={signing || fitting !== null || fittingAll} onClick={() => void fitAll()}>
                        {fittingAll ? 'Fitting on this device…' : `Fit all ${fittable.length} conflicts on this device`}
                      </button>
                      <span className="hint">One after another. Each suggestion waits for you to save it.</span>
                    </div>
                  )}
                  {!replay && stage === 'signed' && (
                    <div className="signed">
                      <span className="stamp">{keptCount === 0 ? 'Whole draft rejected by teacher' : 'Signed off by teacher'}</span>
                      {storeFailed ? (
                        <p className="caution" role="alert">
                          This browser could not store the receipt. Copy what you need before you leave this page.
                        </p>
                      ) : (
                        <p className="receipt-line">
                          Receipt saved.{' '}
                          <button className="link" onClick={() => setView('receipts')}>
                            See the receipt
                          </button>
                        </p>
                      )}
                      <div className="actions">
                        {keptCount > 0 && task !== 'parents' && (
                          <button className="primary" onClick={() => copy('all', finalText)} disabled={replyBlocked}>
                            {copyLabel('all', 'Copy the text')}
                          </button>
                        )}
                        {canPrint && (
                          <button className="secondary" onClick={() => window.print()}>
                            Print
                          </button>
                        )}
                        <button className="link" onClick={startOver}>
                          Start again
                        </button>
                      </div>
                      {keptCount === 0 ? (
                        <p className="hint">You kept no item, so there is nothing to copy.</p>
                      ) : (
                        task === 'parents' && <p className="hint">Each message is copied on its own, and printed on its own page, for one family at a time.</p>
                      )}
                      {copied && !copied.ok && (
                        <p className="caution" role="alert">
                          Could not copy. Your browser did not allow it: select the text and copy it by hand.
                        </p>
                      )}
                      {copyState === 'pending' && (
                        <p className="hint">
                          {online ? 'Saving the record to your account.' : 'The record will be saved when the network is back. Keep this tab open.'}
                        </p>
                      )}
                      {copyState === 'saved' && <p className="hint">The receipt's record (no text) was written to your account by this browser.</p>}
                      {copyState === 'failed' && (
                        <p className="caution">The record could not be saved to your account. The receipt is still kept in this browser.</p>
                      )}
                    </div>
                  )}
                  {rechecked && (
                    <p className="again" role="status">
                      Checked again on this device. Nothing was sent.
                    </p>
                  )}
                  {replyIssues.length > 0 && (
                    <p className="caution">
                      The return gate flagged this draft.{' '}
                      {replyIssues.some((v) => !v.say) &&
                        `${replyIssues
                          .filter((v) => !v.say)
                          .map((v) => `“${v.what}” (${v.why})`)
                          .join('; ')}. `}
                      {replyIssues
                        .filter((v) => v.say)
                        .map((v) => `${v.say} `)
                        .join('')}
                      You cannot sign off or copy it until you tick that you have read it.
                    </p>
                  )}
                  {checkWhere === 'SKIPPED' && <p className="hint">No private detail was withheld, so no model was asked.</p>}
                  {checkWhere === 'NOT_RUN' && (
                    <p className="caution">
                      {checkRequests && checkRequests.asked > 0
                        ? `The on-device check could not run: all ${checkRequests.asked} of its requests to the on-device model failed.`
                        : 'The on-device check did not run.'}{' '}
                      This draft was not checked against what was withheld. Read each item against the private details yourself.
                    </p>
                  )}
                  {checkWhere === 'ON_DEVICE' && checkRequests && checkRequests.failed > 0 && (
                    <p className="caution">
                      The on-device check ran only in part: {checkRequests.failed} of its {checkRequests.asked} requests failed. The items
                      it could not check say so. Read those against the private details yourself.
                    </p>
                  )}

                  {/* What the device caught comes first: conflicts, then doubts. The rest follow the constraints. */}
                  {flagged.length > 0 && <ol className="items">{flagged.map(resultItem)}</ol>}
                  {sent && sent.constraints.some((c) => c.confirmed) && (
                    <div className="strip" role="group" aria-label="Constraints you confirmed">
                      <h4>Constraints you confirmed</h4>
                      <ul>
                        {sent.constraints
                          .filter((c) => c.confirmed)
                          .map((c) => {
                            const who = entities.find((e) => e.id === c.about)?.surfaces[0];
                            return (
                              <li key={c.id}>
                                <label className="switch">
                                  <input
                                    type="checkbox"
                                    checked={!offIds.includes(c.id)}
                                    disabled={stage !== 'result' || signing || Boolean(replay)}
                                    onChange={(e) => switchConstraint(c.id, e.target.checked)}
                                  />
                                  <span />
                                  <q>{c.text}</q>
                                  {who && <small>{who}</small>}
                                </label>
                              </li>
                            );
                          })}
                      </ul>
                      {stage === 'result' && !replay && (
                        <p className="hint">Switch one off or on: the same draft is checked again here, by rule. No new draft is asked for.</p>
                      )}
                    </div>
                  )}
                  {unflagged.length > 0 && <ol className="items">{unflagged.map(resultItem)}</ol>}

                  {capture && !replay && (
                    <div className="actions">
                      <button className="secondary small" onClick={downloadRun}>
                        Download this run as JSON
                      </button>
                      <span className="hint">
                        For the recorded run: the file holds this note, the vault, the constraints, the draft and the verdicts as first checked,
                        and any rewrites and on-device suggestions as they stand now.
                      </span>
                    </div>
                  )}

                  {replay && stage === 'signed' && (
                    <div className="actions">
                      <span className="stamp">End of the recorded run</span>
                      <span className="hint">No receipt was written.</span>
                      <button className="secondary small" onClick={leaveReplay}>
                        Leave the recorded run
                      </button>
                    </div>
                  )}

                </article>
              )}

              {/* ---- the note */}
              {editing && (
                <article className="card">
                  <div className="card-head">
                    <h3>Your note</h3>
                    {noteLinks}
                  </div>
                  {forgetQuestion}
                  <p className="demo-notice">Demonstration. Use invented details only, no real pupils' records.</p>
                  <textarea
                    value={note}
                    readOnly={Boolean(replay)}
                    maxLength={NOTE_MAX}
                    onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                    placeholder="Write what you noticed this week, as you would in your own notebook. Names, family matters, health: write it all."
                    rows={9}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
                    aria-label="Your note"
                  />
                  <p className={note.length >= NOTE_MAX ? 'hint note-count full' : 'hint note-count'}>
                    {note.length.toLocaleString()} of {NOTE_MAX.toLocaleString()} characters
                    {note.length >= NOTE_MAX ? '. Put a longer note through in two runs.' : ''}
                  </p>
                  <details className="class-list" open={listOpen} onToggle={(e) => setListOpen(e.currentTarget.open)}>
                    <summary>
                      Class list <small>{classList.length > 0 ? `${classList.length} names` : 'optional'}</small>
                    </summary>
                    <p>
                      One name per line, kept in this tab until you close it. A name on this list is{' '}
                      {policy.lockedKinds.includes('student') ? 'always withheld' : 'withheld by default'}, with or without a model.
                    </p>
                    <textarea
                      readOnly={Boolean(replay)}
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
                        <input type="radio" name="task" checked={task === t.id} disabled={Boolean(replay)} onChange={() => setTask(t.id)} />
                        <strong>{t.label}</strong>
                        <span>{t.blurb}</span>
                      </label>
                    ))}
                  </fieldset>
                  {noModel && !replay && (
                    <p className="notice">
                      No on-device model in this browser, so the guard runs by rule: your class list, patterns, a short list of sensitive
                      words and capitalised words. Mark other private details yourself.
                    </p>
                  )}
                  {(device === 'downloadable' || device === 'downloading') && download === null && (
                    <p className="notice">The first run downloads the on-device model (several GB) and can take a few minutes.</p>
                  )}
                  {replay ? (
                    <div className="actions">
                      <button className="primary" onClick={nextInReplay}>
                        Next
                      </button>
                      <span className="hint">Recorded run: the next screen shows what the guard found on the day.</span>
                    </div>
                  ) : (
                    <div className="actions">
                      <button className="primary" disabled={note.trim().length < 20 || note.length > NOTE_MAX} onClick={() => runGuard()}>
                        Run the guard
                      </button>
                      <span className="hint">Nothing is sent. The guard runs here.</span>
                      {watch && (
                        <button className="link" onClick={watch}>
                          Watch a recorded run
                        </button>
                      )}
                    </div>
                  )}
                </article>
              )}

              {/* ---- the constraints: the centre of the review */}
              {stage === 'review' && (
                <article className="card constraints-card">
                  <div className="card-head">
                    <h3>
                      Constraints{' '}
                      <small>
                        {confirmedCount} of {constraints.length} confirmed
                      </small>
                    </h3>
                    {!replay && constraints.length - confirmedCount > 0 && (
                      <button className="primary small" onClick={confirmAll}>
                        Confirm all {constraints.length - confirmedCount}
                      </button>
                    )}
                  </div>
                  <p className="hint">
                    Private facts that rule something out. A confirmed one stays here, and every step of the draft is checked against it on
                    this device.
                  </p>
                  {constraintGaps?.stopped && <p className="caution">{constraintGaps.stopped} The constraints found by rule still stand.</p>}
                  {constraintGaps && !constraintGaps.stopped && constraintGaps.unread > 0 && (
                    <p className="caution">
                      The on-device model could not look for constraints in {constraintGaps.unread} of the {constraintGaps.asked}{' '}
                      {constraintGaps.asked === 1 ? 'part' : 'parts'} of your note it was asked about. The constraints found by rule
                      still stand. Add any that are missing.
                    </p>
                  )}
                  {constraintGaps && constraintGaps.dropped > 0 && (
                    <p className="hint">
                      The on-device model proposed {constraintGaps.dropped} {constraintGaps.dropped === 1 ? 'constraint' : 'constraints'}{' '}
                      whose words could not be found in your note, so {constraintGaps.dropped === 1 ? 'it is' : 'they are'} not listed.
                    </p>
                  )}
                  <ConstraintsPanel
                    constraints={constraints}
                    students={entities.filter((e) => e.kind === 'student')}
                    editable={!replay}
                    selection={selection}
                    actions={constraintActions}
                    needOf={needOf}
                  />
                </article>
              )}

              {(stage === 'guarding' || stage === 'review') && (
                <article className="card">
                  <div className="card-head">
                    <h3>Your note</h3>
                    {noteLinks}
                  </div>
                  {forgetQuestion}
                  <p className="demo-notice">Demonstration. Use invented details only, no real pupils' records.</p>
                  {noteView}
                  {stage === 'review' && !replay && (
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
                        <span className="hint">Missed something? Select it in your note to withhold it.</span>
                      )}
                    </div>
                  )}
                </article>
              )}

              {stage === 'guarding' && (
                <article className="card">
                  <Spinner label={download !== null ? `Loading the on-device model: ${Math.round(download * 100)}%` : progress} />
                </article>
              )}

              {(stage === 'review' || after) && vaultFold}

              {after && (
                <details className="card fold">
                  <summary>Your note</summary>
                  {noteLinks}
                  {forgetQuestion}
                  {noteView}
                </details>
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
                <RouteChip route="draft" where={result && stage !== 'review' ? result.where : undefined} />
                <button className="inspect-btn" onClick={() => setInspecting(true)}>
                  Inspect
                </button>
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
                  {/* What the guard did not cover is said here, beside the gate: before the text, and above the tick. */}
                  {nothingWithheld && (
                    <p className="caution strong" role="alert">
                      Nothing is withheld. The text below is your note exactly as you wrote it: every name and every detail in it will be
                      sent to the cloud model.
                    </p>
                  )}
                  {guardWhere === 'ON_DEVICE' && guardGaps.unread.length > 0 && (
                    <p className="caution">
                      The on-device model could not read {guardGaps.unread.length} of the {noteParts.length} parts of your note (
                      {guardGaps.unread.map((i) => `part ${i + 1}`).join(', ')}). They are listed on the device side, under what is withheld.
                      Check {guardGaps.unread.length === 1 ? 'it' : 'them'} yourself before you approve.
                    </p>
                  )}
                  {guardGaps.dropped > 0 && (
                    <p className="caution">
                      The on-device model reported {guardGaps.dropped} {guardGaps.dropped === 1 ? 'item' : 'items'} (a name, a place or a
                      private detail) that could not be matched to the words of your note, so {guardGaps.dropped === 1 ? 'it was' : 'they were'}{' '}
                      not withheld. Look for names and private details yourself before you approve.
                    </p>
                  )}
                  {guardGaps.partial > 0 && (
                    <p className="caution">
                      {guardGaps.partial} private {guardGaps.partial === 1 ? 'detail was' : 'details were'} matched to your note only in
                      part. The matching words were withheld. Read the text around each private detail and mark what is left.
                    </p>
                  )}
                  <p className="hint">
                    {replay ? 'The exact text that was sent on the day' : 'The exact text that will be sent'}, for: {currentTask.label.toLowerCase()}.
                  </p>
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
                  {nothingWithheld && (
                    <p className="hint">A receipt holds the text you approved. Here that is your whole note, as written.</p>
                  )}
                </article>
              )}

              {stage === 'drafting' && (
                <article className="card">
                  <Spinner
                    label={
                      online
                        ? `Asking ${policy.cloudModel} to write the draft`
                        : device === 'available'
                          ? 'No signal. The on-device model is writing the draft'
                          : `No signal, and no on-device model is ready. Trying ${policy.cloudModel} all the same`
                    }
                  />
                </article>
              )}

              {result && stage !== 'review' && stage !== 'drafting' && (
                <article className="card">
                  <div className="card-head">
                    <h3>{result.where === 'IN_CLOUD' ? 'What came back' : 'Written on the device'}</h3>
                    <span className="hint">{result.model}</span>
                  </div>
                  {result.where === 'ON_DEVICE' && (
                    <>
                      <p className="caution">The cloud draft failed, so the on-device model wrote this draft from the same approved text.</p>
                      {/* A separate fact. The app does not know why the cloud draft failed. */}
                      <p className="hint">Browser reported when you approved: {sent?.online ? 'online' : 'offline'}.</p>
                    </>
                  )}
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
                  <p className="hint">The reply uses the stand-ins. Names are put back on your side of the door.</p>
                </article>
              )}

              {sent && stage !== 'review' && (
                <details className="card fold outbox" open={stage === 'drafting' || undefined}>
                  {/* "Sent" only once the cloud has answered. Until then, and when it never did, the app cannot say the text arrived. */}
                  <summary>
                    {result?.where === 'IN_CLOUD' ? 'Sent' : 'Approved by you'} at {time(sent.at)} · {sent.text.length.toLocaleString()} characters
                  </summary>
                  <pre className="wire">
                    <CloudText text={sent.text} />
                  </pre>
                </details>
              )}
            </section>
          </div>

          {/* ------------------------------------------------ the action bar: always in reach at the foot of the window */}
          {stage === 'review' && (
            <div className="action-bar cloud-bar">
              {replay ? (
                <>
                  <span className="hint">Recorded run: this is the text that was approved and sent on the day. Nothing is sent now.</span>
                  <button className="primary send" onClick={nextInReplay}>
                    Next
                  </button>
                </>
              ) : (
                <>
                  <div className="ticks">
                    <label className="read-it">
                      <input type="checkbox" checked={readIt} onChange={(e) => setReadKey(e.target.checked ? approval : null)} />
                      {guardWhere === 'RULES_ONLY'
                        ? 'No model looked for private details. I have read this text and marked them myself.'
                        : 'I have read this text and I am content to send it.'}
                    </label>
                    {partsUnread && (
                      <label className="read-it unread-parts">
                        <input type="checkbox" checked={unreadAcked} onChange={(e) => setUnreadKey(e.target.checked ? unreadApproval : null)} />
                        The on-device model did not read {guardGaps.unread.length === 1 ? 'one part' : `${guardGaps.unread.length} parts`} of
                        this note. I have read {guardGaps.unread.length === 1 ? 'that part' : 'those parts'} and marked what is private in{' '}
                        {guardGaps.unread.length === 1 ? 'it' : 'them'} myself.
                      </label>
                    )}
                    {nothingWithheld && (
                      <label className="read-it as-written">
                        <input type="checkbox" checked={asWritten} onChange={(e) => setAsWrittenKey(e.target.checked ? asWrittenApproval : null)} />
                        Nothing has been withheld. I am sending my note as written.
                      </label>
                    )}
                  </div>
                  <span className="hint bar-say">
                    {policyReady ? `${outgoing.length.toLocaleString()} characters to ${policy.cloudModel}` : 'Loading school policy…'}
                  </span>
                  <button className="primary send" disabled={!canSend} onClick={approveAndSend}>
                    Approve and send
                  </button>
                </>
              )}
            </div>
          )}

          {stage === 'result' && (
            <div className="action-bar device-bar">
              {replay ? (
                <>
                  <span className="hint">Recorded run: in a live run you keep or strike each item here, then sign off. Nothing is signed off now.</span>
                  <button className="primary" onClick={nextInReplay}>
                    Next
                  </button>
                </>
              ) : (
                <>
                  {replyIssues.length > 0 && (
                    <div className="ticks">
                      <label className="read-it reply-read">
                        <input type="checkbox" checked={replyRead} onChange={(e) => setReplyRead(e.target.checked)} />
                        I have read the flagged reply and I still want to use it.
                      </label>
                    </div>
                  )}
                  <span className="hint bar-say">
                    {undecided > 0
                      ? `${undecided} of ${kept.length} still to decide. Nothing is kept until you keep it.`
                      : keptCount === 0
                        ? 'Every item is struck. Signing off now rejects the whole draft.'
                        : `${keptCount} kept, ${struckCount} struck.`}
                  </span>
                  {toKeep > 0 && (
                    <button className="secondary" disabled={signing} onClick={() => !signingRef.current && setKept((k) => keepNoConflict(k, checks))}>
                      Keep the {toKeep} {toKeep === 1 ? 'item' : 'items'} with no conflict found
                    </button>
                  )}
                  <button className="primary" onClick={signOff} disabled={signing || undecided > 0 || replyBlocked}>
                    {undecided === 0 && keptCount === 0 ? 'Reject the whole draft' : `Sign off ${keptCount} of ${kept.length} items`}
                  </button>
                </>
              )}
            </div>
          )}
        </main>
      )}

      <footer>
        <span>All data in the sample is invented.</span>
        <span>
          Policy: {policy.from}. Drafting model {policy.cloudModel}.
        </span>
      </footer>

      {inspecting && (
        <Inspect
          onClose={() => setInspecting(false)}
          taskInstruction={currentTask.instruction}
          system={DRAFT_SYSTEM}
          format={DRAFT_FORMAT}
          heading={DRAFT_NOTES_HEADING}
          labelSystem={LABEL_SYSTEM}
          labelChars={LABEL_CHARS}
          policyLine={
            replay
              ? `Policy on the day: ${replay.policy.from}. Drafting model: ${replay.policy.cloudModel}.`
              : sent
                ? `Policy: ${sent.policy.from}. Drafting model: ${sent.policy.cloudModel}.`
                : policyReady
                  ? `Policy: ${policy.from}. Drafting model: ${policy.cloudModel}.`
                  : 'Policy: loading. Approval waits for it.'
          }
          ran={{
            guard: stage === 'write' || stage === 'guarding' ? undefined : WHERE_RAN[guardWhere],
            draft: result && after ? `${WHERE_RAN[result.where]}: ${result.model}` : undefined,
            check: stage === 'result' || stage === 'signed' ? WHERE_RAN[checkWhere] : undefined,
            // Listed once the on-device model has answered a fit in this run, or the recorded run holds a suggestion.
            fit:
              stage !== 'result' && stage !== 'signed'
                ? undefined
                : replay
                  ? (replay.fits ?? []).length > 0
                    ? `${WHERE_RAN.ON_DEVICE}, in the recorded run`
                    : undefined
                  : fitWhere === 'NOT_RUN'
                    ? undefined
                    : WHERE_RAN[fitWhere],
            label:
              (stage === 'result' || stage === 'signed') && label && !replay
                ? label.where === 'FALLBACK'
                  ? 'No model has named this receipt: it has the task and the day'
                  : WHERE_RAN[label.where]
                : undefined,
          }}
        />
      )}

      {update.reload && (
        <div className="toast" role="status">
          <span>Update available.</span>
          <button className="secondary small" onClick={update.reload}>
            Reload
          </button>
          <button className="link" onClick={update.dismiss}>
            Later
          </button>
        </div>
      )}

      {/* ------------------------------------------------ what is printed: the signed text, names put back, nothing else */}
      {canPrint && draft && (
        <section className="print-sheet" aria-hidden="true">
          {task === 'parents' ? (
            printable.map(({ item, i, family }) => (
              <div className="print-page" key={i}>
                <h2>For the family of {family.student!.surfaces[0]}</h2>
                <p>{restore(item.text, entities, sent?.tokens).trim()}</p>
              </div>
            ))
          ) : (
            <div className="print-page">
              <h1>{restore(draft.title, entities, sent?.tokens)}</h1>
              {draft.items.map((item, i) =>
                kept[i] === true ? (
                  <div key={i}>
                    <h2>{restore(item.heading, entities, sent?.tokens)}</h2>
                    <p>{restore(item.text, entities, sent?.tokens).trim()}</p>
                  </div>
                ) : null,
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
