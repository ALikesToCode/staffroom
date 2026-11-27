import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Constraint, ConstraintKind, DraftItem, Entity, ItemCheck, Kind, LabelWhere, Receipt, TaskId, Where } from './core/types';
import { SAMPLE_CLASS_LIST, SAMPLE_LESSON, SAMPLE_NOTE, TASKS } from './core/samples';
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
import { checkOutgoing, checkReply, safeTitle, type Violation } from './core/gate';
import { LANGUAGES, languageOf, NOT_CHECKED_BY_RULE, NOT_ENGLISH, withLanguage } from './core/lesson';
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
  removedKey,
  withoutRemoved,
  restoreConstraints,
  setNeed,
  setNeedAck,
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
import { canFit, FIT_CHILD_FAILED, FIT_FAILED, FIT_LABEL, fitForChild, fitInputFor, fitLessonForChild, fitStep } from './ai/fit';
import { useInstall, useUpdate } from './ui/pwa';
import { checkNeed, needIsTyped, needLine, notSentLine, outgoingOf, sharedNeeds, type Need } from './core/needs';
import { lessonNeedIsTyped, lessonNeedLine, askAgain, entryLine, lessonNeeds, needLabel, needOutcomes, needsAccount, planWithNeeds, proposeLearning, secondAsk, splitVariations, variationLine, withSecondReading, type LessonNeed, type NeedsReading, type Variation } from './core/lessonNeeds';
import { asRecordedRun, captureRun, RECORDED_FILE, RECORDED_FIT_LABEL, RECORDED_SOURCE, replayBanner, replayNext, replayPrev, sourceOf, type RecordedFit, type RecordedRun, type ReplayStage } from './core/recorded';
import { familyAfterRewrite, familyFor } from './core/family';
import { REPEATS_NOTE, repeatsForChild, repeatsPrivate } from './core/repeats';
import {
  acceptedAdjustments,
  adjustmentHits,
  adjustmentProblem,
  classPlanText,
  FIELD_MAX,
  LAST_TIME_MAX,
  lessonCounts,
  lessonHits,
  lessonMinutes,
  lessonReady,
  loadLessons,
  needsFitting,
  nextLessonFields,
  NO_LESSON,
  recordedAdjustments,
  savedLesson,
  starterFor,
  storeLessons,
  unsettled,
  withLessonGoing,
  type Adjustments,
  type LessonFields,
  type LessonHit,
  type SavedLesson,
} from './core/lesson';
import { ChildSections, ForTheseChildren, Lessons, type PointActions } from './ui/Lesson';
import { acceptedPoints, childFitSaid, childNotes, fitSummary, inNoteOrder, missingPoints, namesForNeed, pairPoints, placeVariations, pointCounts, pointHits, pointProblem, recheckPoints, recordedPoints, stageLines, type Point } from './core/points';
import { configured, DEFAULT_POLICY, loadPolicy, loadReceiptCopies, saveReceiptCopy, watchUser, type Policy } from './ai/firebase';
import { deviceStatus, prepareDevice, type DeviceStatus } from './ai/routes';
import { constraintsFromCombined, guardCombinedOnDevice, guardOutcome, paragraphs, unreadText } from './ai/guard';
import { prepareNotebookImage, transcribeNotebookOnDevice } from './ai/notebook';
import { mergeLearningIntoConstraints, mergeProposals, type ConstraintReport } from './ai/constraints';
import { classView, currentTicketKind, withoutClass, withTicketNeeds } from './core/ticket';
import { materialsReply, materialsText, unnumbered, type Materials } from './core/materials';
import { recordNetwork, STEPS_MAX, type StepId, type StepMark, type StepWhere } from './core/network';
import { stageName } from './core/lesson';
import { MaterialsCard, MaterialsPages, MaterialsWire } from './ui/Materials';
import { CopyPreview } from './ui/PrintPreview';
import { ReadAloud } from './ui/ReadAloud';
import { NOTE_MAX } from './core/text';
import {
  DRAFT_FORMAT,
  DRAFT_NOTES_HEADING,
  draftSystem,
  LABEL_CHARS,
  LABEL_SYSTEM,
  labelReceipt,
  writeDraft,
  writeMaterials,
  type MaterialsResult,
  type DraftResult,
} from './ai/draft';
import { anythingToCheck, checkDidNotRun, checkOnDevice, detailsFor, keepNoConflict, noConflictFound, NOTHING_WITHHELD, startsKept } from './ai/check';
import { afterBellActivities, combineChecks, ruleCheckItem, verdictLabel } from './core/conflicts';
import { CloudText, DeviceText, KIND_LABEL, RouteChip, Spinner, Stepper } from './ui/parts';

type Stage = 'write' | 'guarding' | 'review' | 'drafting' | 'checking' | 'result' | 'signed';
type View = 'desk' | 'lessons' | 'receipts' | 'how';

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
// The lines about the lesson. Nothing in them is private, and they are kept with the note.
const LESSON_KEY = 'staffroom.lesson';
// "Keep this class on this device": the note, the class list, the constraints and the lesson lines, in local storage.
const KEEP_CLASS_KEY = 'staffroom.keepClass';
const CLASS_KEY = 'staffroom.class.v1';
interface KeptClass {
  note: string;
  classList: string[];
  constraints: Constraint[];
  constraintsNote: string;
  lesson: LessonFields;
  /** Proposals the teacher removed, by kind and words, so the next guard run does not propose them again. */
  removed?: string[];
}
/** What the tab keeps comes first; with none, the class kept on this device, when the teacher chose to keep one. */
const keptClass = (): KeptClass | null => (read<boolean>(local, KEEP_CLASS_KEY, false) === true ? read<KeptClass | null>(local, CLASS_KEY, null) : null);

/** The browser's own record of the requests this page makes, kept from the moment the app loads. Inspect reads it. */
const network = typeof window !== 'undefined' ? recordNetwork() : null;

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
  const [note, setNote] = useState(() => read(session, NOTE_KEY, '') || (keptClass()?.note ?? ''));
  const [classList, setClassList] = useState<string[]>(() => {
    const inTab = read<string[]>(session, CLASS_LIST_KEY, []);
    return inTab.length > 0 || read(session, NOTE_KEY, '') !== '' ? inTab : (keptClass()?.classList ?? []);
  });
  /** Whether the class is explicitly kept in localStorage for a personal device. Defaults to false (session-only for shared staffroom PCs). */
  const [keepClass, setKeepClass] = useState<boolean>(() => read<boolean>(local, KEEP_CLASS_KEY, false) === true);
  const [task, setTask] = useState<TaskId>('lesson');
  /** The lines about the lesson: the class, the subject, the topic, the length, and what was done last time. Sent as written. */
  const [lesson, setLesson] = useState<LessonFields>(() => ({ ...NO_LESSON, ...(read<LessonFields | null>(session, LESSON_KEY, null) ?? keptClass()?.lesson ?? NO_LESSON) }));
  /** False on the first screen: no form is shown until the teacher chooses to write, or a note is already kept in this tab. */
  const [composing, setComposing] = useState(() => read(session, NOTE_KEY, '') !== '' || Boolean(keptClass()?.note));
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
  const [constraints, setConstraints] = useState<Constraint[]>(() => {
    const inTab = read(session, CONSTRAINTS_KEY, { note: '', constraints: [] as Constraint[] });
    // A need kept under the name an exit-ticket kind had before reads under its present one.
    return (inTab.constraints.length > 0 || read(session, NOTE_KEY, '') !== '' ? inTab.constraints : (keptClass()?.constraints ?? [])).map(currentTicketKind);
  });
  /** Proposals the teacher removed from this class, by kind and words. Kept with the constraints; never sent. */
  const [removed, setRemoved] = useState<string[]>(() => {
    const inTab = read(session, CONSTRAINTS_KEY, { note: '', constraints: [] as Constraint[], removed: [] as string[] });
    return inTab.removed ?? (read(session, NOTE_KEY, '') === '' ? (keptClass()?.removed ?? []) : []);
  });
  /** The note the constraints were made for. They are kept across a new guard run only while the note is the same. */
  const constraintsNote = useRef(
    read(session, CONSTRAINTS_KEY, { note: '', constraints: [] as Constraint[] }).note || (read(session, NOTE_KEY, '') === '' ? (keptClass()?.constraintsNote ?? '') : ''),
  );
  /** Where the on-device model's search for constraints fell short. Null when it did not, or did not run. */
  const [constraintGaps, setConstraintGaps] = useState<Pick<ConstraintReport, 'asked' | 'unread' | 'dropped' | 'stopped'> | null>(null);
  /** The vault item whose release was asked for while a confirmed constraint holds it. */
  const [unconfirmAsk, setUnconfirmAsk] = useState<string | null>(null);
  const [guardWhere, setGuardWhere] = useState<Where>('NOT_RUN');
  const [scanWhere, setScanWhere] = useState<Where>('NOT_RUN');
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState<{ url: string; summary: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [deskCleared, setDeskCleared] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nanoDiff, setNanoDiff] = useState<{ rulesOnly: number; nanoAdded: number } | null>(null);
  const [streamPreview, setStreamPreview] = useState('');
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
    /** For a lesson: the needs by letter, and whose each is. The letters and lines were sent; whose they are was not. */
    lessonNeeds: LessonNeed[];
    /** The language the cloud was asked to write in. Empty: English. */
    language: string;
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
  /** For a lesson: what each child a step does not suit does instead, as it stands. Never sent, and not in any record. */
  const [adj, setAdj] = useState<Adjustments>({});
  /** The hit the device is fitting now, and whether it is going through the whole lesson. */
  const [adjBusy, setAdjBusy] = useState<string | null>(null);
  const [fittingLesson, setFittingLesson] = useState(false);
  /** Said under a hit for which nothing could be offered. */
  const [adjNotes, setAdjNotes] = useState<Record<string, string>>({});
  /** For a lesson: what each child needs in it, offered by the on-device model or typed by the teacher. Never sent, and not in any record. */
  const [points, setPoints] = useState<Point[]>([]);
  /** How many points the on-device model suggested in this run. */
  const [pointsSuggested, setPointsSuggested] = useState(0);
  /** Said in a child's section after the device read the note about that child. */
  const [childSaid, setChildSaid] = useState<Record<string, string>>({});
  /** The child the device is writing points for now, and how far through the class it is. */
  const [fitChild, setFitChild] = useState<{ id: string; done: number; total: number } | null>(null);
  /** The children the on-device model has answered for in this run. */
  const [fittedChildren, setFittedChildren] = useState<string[]>([]);
  const pointSeq = useRef(0);
  /** For a lesson: the lines the cloud wrote for needs, by stage and letter, and how many it wrote for a letter it was not sent. */
  const [variations, setVariations] = useState<Variation[]>([]);
  const [variationsDropped, setVariationsDropped] = useState(0);
  /** For a lesson: the section "For each need" as the cloud returned it, the needs it says the lesson suits, the needs with no entry, and the text of the second request if one was made. */
  const [needsReply, setNeedsReply] = useState<{ section: string; none: string[]; missing: string[]; second: string | null } | null>(null);
  /** When each model step of this tab started and ended, on the clock of the browser's record of requests. Shown under Inspect. */
  const [steps, setSteps] = useState<StepMark[]>([]);
  const addStep = (m: StepMark) => setSteps((s) => [...s, m].slice(-STEPS_MAX));
  /** Run one model step and keep when it started and ended. What it returns or throws is passed on as it is. */
  const timed = async <T,>(step: StepId, run: () => Promise<T>, whereOf?: (v: T) => StepWhere): Promise<T> => {
    const start = performance.now();
    try {
      const v = await run();
      addStep({ step, start, end: performance.now(), ...(whereOf ? { where: whereOf(v) } : {}) });
      return v;
    } catch (e) {
      addStep({ step, start, end: performance.now() });
      throw e;
    }
  };
  /** For a signed lesson: the materials the cloud wrote from the signed plan and the needs by letter, and what the return gate found in them. */
  const [materials, setMaterials] = useState<(MaterialsResult & { text: string; issues: Violation[] }) | null>(null);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsStreamChars, setMaterialsStreamChars] = useState(0);
  const [materialsFail, setMaterialsFail] = useState<string | null>(null);
  /** What the print sheet holds now: the signed text, or the materials with or without names. */
  const [printWhat, setPrintWhat] = useState<'run' | 'materials' | 'materials-no-names'>('run');
  /** The receipt of the run on screen, once signed. */
  const signedId = useRef<string | null>(null);
  /** The lessons signed off on this device. */
  const [lessons, setLessons] = useState<SavedLesson[]>(loadLessons);
  const lessonsRef = useRef(lessons);
  lessonsRef.current = lessons;
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
  /** The need letter currently highlighted across THE DOOR (between device child rows and cloud lines). */
  const [activeNeed, setActiveNeed] = useState<string | null>(null);
  /** Whether the side-by-side class copy & teacher's copy preview is open on a signed lesson. */
  const [previewOpen, setPreviewOpen] = useState(false);
  /** The teacher's own note and settings, put aside while a recorded run is on screen. */
  const stash = useRef<{ note: string; classList: string[]; constraints: Constraint[]; task: TaskId; lesson: LessonFields } | null>(null);
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
    if (!replay) write(session, LESSON_KEY, lesson, false);
  }, [lesson, replay]);
  // The class is kept on this device only when explicitly opted in for a personal device.
  useEffect(() => {
    if (replay) return;
    write(local, KEEP_CLASS_KEY, keepClass, !keepClass);
    write(local, CLASS_KEY, { note, classList, constraints, constraintsNote: constraintsNote.current, lesson, removed } satisfies KeptClass, !keepClass || note === '');
  }, [keepClass, note, classList, constraints, lesson, removed, replay]);
  useEffect(() => {
    if (!replay) write(session, CONSTRAINTS_KEY, { note: constraintsNote.current, constraints, removed }, constraints.length === 0 && removed.length === 0);
  }, [constraints, replay, removed]);

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
  const going = useMemo(
    () => withLanguage(withLessonGoing(outgoingOf(note, entities, sent?.constraints ?? constraints, task === 'lesson'), task === 'lesson' ? lesson : null, entities, classList), task === 'parents' ? languageOf(lesson) : ''),
    [note, entities, sent, constraints, task, lesson, classList],
  );
  // In a replay the text shown is the text that was sent on the day, as recorded.
  const outgoing = replay ? replay.outgoing : going.text;
  /** True when not one stand-in was written: the outgoing text is the note as the teacher wrote it. */
  const nothingWithheld = replay ? false : going.noteAsWritten;
  /** For a lesson: sentences about one pupil that are left out, so what is sent is part of the note, not all of it. */
  const partOfNote = !replay && (going.notSent ?? 0) > 0;
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
  /** Transcribe a handwritten register photo strictly on-device via Gemini Nano (`ONLY_ON_DEVICE`), adding its text to the note. */
  const scanNotebookFile = async (blob: Blob) => {
    if (replay || scanning) return;
    setScanning(true);
    setScanError(null);
    const run = runRef.current;
    try {
      const ready = await turnOnDevice();
      if (!ready || runRef.current !== run) {
        setScanError('Notebook photo transcription requires Chrome with Gemini Nano ready on this device.');
        return;
      }
      const prepared = await prepareNotebookImage(blob);
      const scanned = await timed(
        'scan',
        () => transcribeNotebookOnDevice(prepared),
        () => 'ON_DEVICE',
      );
      if (runRef.current !== run) return;
      setScanWhere('ON_DEVICE');
      setNote((prev) => {
        const trimmed = prev.trim();
        const combined = trimmed ? `${trimmed}\n\n${scanned.text}` : scanned.text;
        return combined.slice(0, NOTE_MAX);
      });
      // Seed missing student names from the sample list if the note was blank or mentions sample students, keeping any teacher list intact.
      if (classList.length === 0) {
        const matched = SAMPLE_CLASS_LIST.filter((name) => scanned.text.toLowerCase().includes(name.split(' ')[0].toLowerCase()));
        if (matched.length > 0) setClassList(matched);
      }
      if (!lesson.subject && !lesson.topic) setLesson(SAMPLE_LESSON);
      setComposing(true);
      setScanPreview({
        url: prepared.previewUrl,
        summary: `Transcribed ${scanned.text.length} chars locally on Gemini Nano · 0 cloud requests`,
      });
    } catch (e) {
      if (runRef.current === run) setScanError(`Could not read that notebook image on this device: ${message(e)}`);
    } finally {
      if (runRef.current === run) setScanning(false);
    }
  };

  const scanSampleNotebook = async () => {
    if (replay || scanning) return;
    setScanError(null);
    try {
      const resp = await fetch(`${import.meta.env.BASE_URL}sample-notebook.jpg`);
      if (!resp.ok) throw new Error('Sample notebook image was not found.');
      const blob = await resp.blob();
      await scanNotebookFile(blob);
    } catch (e) {
      setScanError(message(e));
    }
  };

  const runGuard = async (useNote?: string, useList?: string[], forLesson = task === 'lesson') => {
    // A run that is cleared or forgotten while it waits for the model must not write its findings afterwards.
    if (replay) return;
    const run = ++runRef.current;
    const gone = () => runRef.current !== run;
    // The sample is guarded in the same click that loads it, before the state has the note.
    const note = useNote ?? noteNow;
    const classList = useList ?? classListNow;
    setError(null);
    setDraftFail(null);
    setNanoDiff(null);
    setStage('guarding');
    const guardStart = performance.now();
    setSelection('');
    setReadKey(null);
    setAsWrittenKey(null);
    setSent(null);
    setResult(null);
    const candidates = deterministicCandidates(note, classList);
    const ruleCandidateCount = candidates.length;
    let where: Where = 'RULES_ONLY';
    let gaps = NO_GAPS;
    let combinedAnswers: { paragraph: string; raw: string }[] = [];
    setProgress('Checking the class list, pattern rules, and sensitive words (English & Hinglish)');
    const ready = await turnOnDevice();
    if (gone()) return;
    if (ready) {
      try {
        const report = await guardCombinedOnDevice(note, (done, total) => {
          if (!gone()) setProgress(`Gemini Nano is reading part ${Math.min(done + 1, total)} of ${total} on this device`);
        });
        if (gone()) return;
        candidates.push(...report.candidates);
        combinedAnswers = report.rawParagraphAnswers;
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
    const ruleConstraintCount = proposed.length + (forLesson ? proposeLearning(note, vault).length : 0);
    let fellShort: typeof constraintGaps = null;
    if (where === 'ON_DEVICE') {
      const fromModel = constraintsFromCombined(note, vault, combinedAnswers);
      proposed = mergeProposals(proposed, fromModel.constraints);
      if (fromModel.dropped > 0) fellShort = { asked: combinedAnswers.length, unread: gaps.unread.length, dropped: fromModel.dropped };
    }
    setConstraintGaps(fellShort);
    // For a lesson: what the note says about how a child learns, proposed by rule and deduplicated against model "other" proposals. None is confirmed and none is told.
    if (forLesson) proposed = mergeLearningIntoConstraints(proposed, proposeLearning(note, vault));
    // A proposal the teacher removed for this class is not proposed again.
    proposed = withoutRemoved(proposed, removed);
    const held = restoreConstraints(note, vault, constraintsNote.current === note ? constraints : [], proposed);
    constraintsNote.current = note;
    if (where === 'ON_DEVICE') {
      const nanoAdded =
        held.entities.filter((e) => e.source === 'on-device model').length +
        held.constraints.filter((c) => c.source === 'on-device model').length;
      setNanoDiff({ rulesOnly: ruleCandidateCount + ruleConstraintCount, nanoAdded });
    }
    setEntities(held.entities);
    setConstraints(held.constraints);
    setGuardWhere(where);
    setGuardGaps(gaps);
    addStep({ step: 'guard', start: guardStart, end: performance.now(), where: where === 'ON_DEVICE' ? 'ON_DEVICE' : 'RULES_ONLY' });
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

  /** The invented class shows the whole design at once: a need with a line is told as soon as it is confirmed. A typed note starts with nothing told. */
  const toldByDefault = (held: { entities: Entity[]; constraints: Constraint[] }, ids: string[]) =>
    task === 'lesson' && note === SAMPLE_NOTE
      ? { ...held, constraints: held.constraints.map((c) => (ids.includes(c.id) && c.confirmed && lessonNeedLine(c) !== undefined ? { ...c, share: true } : c)) }
      : held;

  const constraintActions = {
    onConfirm: (id: string) => hold(toldByDefault(confirmConstraint(note, rawEntities, constraints, id), [id])),
    onNeedAck: (id: string, on: boolean) => hold({ entities: rawEntities, constraints: setNeedAck(constraints, id, on) }),
    onUnconfirm: (id: string) => hold({ entities: rawEntities, constraints: unconfirmConstraint(constraints, id) }),
    onRemove: (id: string) => {
      const c = constraints.find((x) => x.id === id);
      if (c && c.source !== 'teacher') setRemoved((r) => (r.includes(removedKey(c)) ? r : [...r, removedKey(c)]));
      hold({ entities: rawEntities, constraints: removeConstraint(constraints, id) });
    },
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
    if (task === 'lesson') {
      // For a lesson the line has a letter and no child. One not yet told is shown as it would be told.
      const all = c.confirmed && c.share ? (going.lessonNeeds ?? []) : lessonNeeds(constraints.map((x) => (x.id === c.id ? { ...x, confirmed: true, share: true } : x)), entities);
      const need = all.find((n) => n.constraintIds.includes(c.id));
      return { typed: lessonNeedIsTyped(c), line: need ? needLabel(need) : undefined, issues: need?.issues ?? [], sensitive: need?.sensitive ?? [] };
    }
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
    // The language the cloud is asked to write in. The rules read English only, so in any other they check nothing.
    const language = task === 'lesson' || task === 'parents' ? languageOf(lesson) : '';
    const approved = withLanguage(withLessonGoing(outgoingOf(note, current, constraints, task === 'lesson'), task === 'lesson' ? lesson : null, current, classList), task === 'parents' ? language : '');
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
    setStreamPreview('');
    const approvedAt = new Date().toISOString();
    setSent({ text, at: approvedAt, entities, tokens, online: sentOnline, policy: sentPolicy, constraints, needs: approved.needs, lessonNeeds: approved.lessonNeeds ?? [], language });
    setStage('drafting');
    let drafted: DraftResult;
    try {
      drafted = await timed(
        'draft',
        () => writeDraft(text, currentTask, cloudModel, (partial) => !gone() && setStreamPreview(partial)),
        (d) => (d.where === 'ON_DEVICE' ? 'ON_DEVICE' : 'IN_CLOUD'),
      );
    } catch (e) {
      if (gone()) return;
      sendingRef.current = false;
      setStreamPreview('');
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
    // The return gate reads the reply as it came, the lines for needs included.
    let replyText = [drafted.draft.title, ...drafted.draft.items.flatMap((i) => [i.heading, i.text])].join('\n');
    // For a lesson, the section "For each need" is taken out of the reply: the class plan is the stages.
    const toldNeeds = approved.lessonNeeds ?? [];
    const letters = toldNeeds.map((n) => n.letter);
    let split: NeedsReading = approved.lessonNeeds ? splitVariations(drafted.draft, letters) : { draft: drafted.draft, variations: [], dropped: 0, none: [], missing: [], section: '' };
    let second: string | null = null;
    if (askAgain(split.missing, letters)) {
      // Over a third of the needs have no entry: the cloud is asked once more, for those letters only. The text is the one
      // the teacher approved and one more line, so there is no new tick; Inspect shows that it was sent, word for word.
      const again = secondAsk(text, split.missing);
      second = again;
      setProgress('Asking the cloud once more for the needs it left out');
      try {
        const more = await timed('draft', () => writeDraft(again, currentTask, cloudModel), (d) => (d.where === 'ON_DEVICE' ? 'ON_DEVICE' : 'IN_CLOUD'));
        if (gone()) return;
        split = withSecondReading(split, more.draft);
        // The return gate reads the second reply too.
        replyText = [replyText, ...more.draft.items.flatMap((i) => [i.heading, i.text])].join('\n');
      } catch {
        if (gone()) return;
        // The second request failed: the first reply stands, and the needs it left out are shown as left out.
      }
    }
    drafted = { ...drafted, draft: split.draft };
    setResult(drafted);
    // A stand-in the model wrote without its brackets is read as that stand-in, if it was one that was sent.
    const items = bracketDraft(drafted.draft, tokens).items;
    setKept(items.map(() => null));
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
    if (language) {
      // Not in English: no rule read it, and no model is asked. Every item says so.
      itemChecks = items.map(() => ({ verdict: 'not checked', reason: NOT_ENGLISH }));
    } else if (!anythingToCheck(items, facts)) {
      // No private detail was withheld and no constraint confirmed: there is nothing to check, so no model is asked.
      itemChecks = items.map(() => NOTHING_WITHHELD);
      where = 'SKIPPED';
    } else {
      // Layer A: each step against each confirmed constraint, by rule. No model, so it runs in every browser.
      // Every confirmed constraint is compared, whether or not the cloud was told its need: the cloud can ignore a need.
      const told = new Map(approved.needs.map((n) => [n.id, n.line]));
      // A stage of a lesson is for the whole class, whoever it names: it is compared with every confirmed constraint.
      const byRule = items.map((item) => ruleCheckItem(item, constraints, entities, tokens, note, told, task === 'lesson'));
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
        const checked = await timed('check', () =>
          checkOnDevice(note, items, facts, tokens, (done, total) => {
            if (!gone()) setProgress(`The on-device model is checking item ${Math.min(done + 1, total)} of ${total}`);
          }),
        );
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
    setAdj({});
    setAdjBusy(null);
    setFittingLesson(false);
    setAdjNotes({});
    // What the cloud wrote for a need is put beside each child who has it. Only this device knows who that is.
    setVariations(split.variations);
    setVariationsDropped(split.dropped);
    setNeedsReply(approved.lessonNeeds ? { section: split.section, none: split.none, missing: split.missing, second } : null);
    setPoints([
      ...placeVariations(split.variations, toldNeeds, entities, items, language ? [] : constraints, note),
      ...missingPoints(split.missing, toldNeeds, entities, constraints, note),
      // Two children who work better apart: only this device knows they are each other's classmate.
      ...(approved.lessonNeeds ? pairPoints(constraints, entities, items, note) : []),
    ]);
    setPointsSuggested(0);
    setChildSaid({});
    setFitChild(null);
    setFittedChildren([]);
    setFitWhere('NOT_RUN');
    // An item in conflict starts struck. Every other item starts undecided: nothing is kept until the teacher keeps it.
    // A lesson is kept whole: a stage that does not suit one child is right for the class, and is fitted, not struck.
    setKept(task === 'lesson' ? itemChecks.map(() => true) : startsKept(itemChecks));
    setCheckWhere(where);
    // The result is shown at once. The receipt has a plain title, made from the task and the day, until the
    // naming call answers; it keeps that title if the call fails or the teacher signs off first.
    const plain = plainTitle(currentTask.id, new Date(approvedAt));
    setLabel({ title: plain, where: 'FALLBACK' });
    sendingRef.current = false;
    setStage('result');
    void timed('label', () => labelReceipt(text, plain, cloudModel), (named) => (named.where === 'FALLBACK' ? 'NONE' : named.where)).then((named) => {
      if (gone() || signingRef.current) return;
      // The title is model-written and is kept with the receipt, so it passes the same checks as outgoing text
      // (names, withheld items, patterns, sensitive words) or the plain title stays.
      setLabel({ ...named, title: safeTitle(named.title, entities, plain) });
    });
  };

  // ---------------------------------------------------------------- step 6: sign off

  const signOff = async (pointsOverride?: Point[]) => {
    // Locked at once, before anything is awaited: a second click, or a keep or strike made while the
    // receipt is being written, changes nothing. What is recorded is what was on screen at the click.
    if (signingRef.current || stage !== 'result' || !result || !sent || replyBlocked || replay) return;
    // Signing off with nothing kept is allowed: it rejects the whole draft, and is recorded like any other sign-off.
    if (kept.some((k) => k === null)) return;
    // A lesson is signed off only when every child a step does not suit has an adjustment, or the teacher left the step as it is.
    if (task === 'lesson' && unsettled(hits, adj).length > 0) return;
    const activePoints = pointsOverride ?? points;
    if (pointsOverride) setPoints(pointsOverride);
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
      constraints: { ...constraintCounts(liveConstraints), shared: task === 'lesson' ? sent.lessonNeeds.length : sent.needs.length },
      rewritten: signed.filter((k, i) => k === true && i in edits).length,
      fittedOnDevice: signed.filter((k, i) => k === true && i in edits && fitted.includes(i)).length,
      lesson: task === 'lesson' ? { ...lessonCounts(hits, adj), ...pointCounts(activePoints, pointsSuggested), needsTold: sent.lessonNeeds.length, ...(materials ? { materialsVersions: materials.materials.versions.length } : {}) } : undefined,
      kept: signed.filter((k) => k === true).length,
      struck: signed.filter((k) => k === false).length,
    });
    signedId.current = receipt.id;
    const next = [receipt, ...receipts];
    setKept(signed);
    setReceipts(next);
    // The browser can refuse to store (full, or switched off). Say so; the sign-off and the record go on.
    setStoreFailed(!storeReceipts(next));
    if (task === 'lesson' && draft) {
      // The signed lesson is kept on this device only: it has the adjustments in it, with names.
      const stages = draft.items.filter((_, i) => signed[i] === true);
      const saved = savedLesson(receipt.id, receipt.createdAt, lesson, draft.title, stages, inNoteOrder([...acceptedAdjustments(hits, adj), ...acceptedPoints(activePoints)], notesByChild), liveConstraints, {
        needs: sent.lessonNeeds.map((n) => ({ letter: n.letter, line: n.line, children: n.children })),
        // A saved lesson counts the kept stages, so a line for a struck stage is not kept.
        ...(materials ? { materials: savedMaterials(materials.materials) } : {}),
        variations: variations.filter((v) => signed[v.itemIndex] === true).map((v) => ({ ...v, itemIndex: signed.slice(0, v.itemIndex).filter((k) => k === true).length })),
      });
      setLessons((l) => {
        const all = [saved, ...l];
        storeLessons(all);
        return all.slice(0, 30);
      });
    }
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
    const after = sent.language ? checks : recheckItems(items, live, sent.entities, sent.tokens, note, told, modelChecks, items.map((_, i) => i in nextEdits), task === 'lesson');
    if (task !== 'lesson') setKept((k) => keptAfterRecheck(k, checks, after));
    setChecks(after);
    setEdits(nextEdits);
    setOffIds(nextOff);
    setRechecked(true);
    // The return gate reads the draft as it now stands, the teacher's own words included.
    const replyText = [result.draft.title, ...items.flatMap((i) => [i.heading, i.text]), ...variations.map(variationLine)].join('\n');
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
      const got = await timed('fit', () => fitStep(input));
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

  // ---------------------------------------------------------------- a lesson: fit each step to each child

  /** Every step of the lesson that does not suit a child, by rule, against the constraints as they stand now. */
  const hits = useMemo<LessonHit[]>(() => {
    if (task !== 'lesson' || !draft || !sent || sent.language) return [];
    const told = new Map(sent.needs.filter((n) => !offIds.includes(n.id)).map((n) => [n.id, n.line]));
    return lessonHits(draft.items, liveConstraints, sent.entities, sent.tokens, note, told);
  }, [task, draft, sent, liveConstraints, offIds, note]);
  const hitsRef = useRef(hits);
  hitsRef.current = hits;
  /** The children the note says something about, and the stages in one line each. Both are read on this device only. */
  const notesByChild = useMemo(() => (task === 'lesson' && draft && sent ? childNotes(note, sent.entities, liveConstraints) : []), [task, draft, sent, note, liveConstraints]);
  const stageList = useMemo(() => (task === 'lesson' && draft && sent ? stageLines(draft.items, sent.entities, sent.tokens) : []), [task, draft, sent]);
  const notesRef = useRef(notesByChild);
  notesRef.current = notesByChild;
  const fittedRef = useRef(fittedChildren);
  fittedRef.current = fittedChildren;
  const adjRef = useRef(adj);
  adjRef.current = adj;
  const fittingLive = stage === 'result' && !replay;

  /** Offer the starter for this kind of constraint, if it has one and no rule fires on it for that child. */
  const offerStarter = (hit: LessonHit, c: Constraint, said?: string) => {
    const starter = starterFor(c);
    if (starter && adjustmentHits(starter, c, liveConstraints, note).length === 0) {
      setAdj((a) => ({ ...a, [hit.key]: { text: starter, source: 'starter', state: 'offered', said } }));
    } else {
      setAdjNotes((n) => ({ ...n, [hit.key]: said ? FIT_CHILD_FAILED : 'There is no starter wording for this. Write the adjustment yourself.' }));
    }
  };

  /** Get words for one child and one step: from the on-device model when it is here, from the starter when it is not. Nothing is accepted. */
  const suggestFor = async (hit: LessonHit) => {
    const c = liveConstraints.find((x) => x.id === hit.constraintId);
    if (!c || !sent || replay || liveRef.current.stage !== 'result' || signingRef.current || fitBusy.current || adjRef.current[hit.key]) return;
    setAdjNotes(({ [hit.key]: _old, ...rest }) => rest);
    if (device !== 'available') return offerStarter(hit, c);
    const run = runRef.current;
    fitBusy.current = true;
    setAdjBusy(hit.key);
    try {
      const got = await timed('fit', () =>
        fitForChild({
          step: hit.step,
          constraint: c,
          constraints: liveConstraints.filter((x) => x.confirmed && (x.id === c.id || !x.about || x.about === c.about)),
          afterBell: afterBellActivities(note),
        }),
      );
      if (runRef.current !== run) return;
      setFitWhere('ON_DEVICE');
      if (got.ok) setAdj((a) => ({ ...a, [hit.key]: { text: got.suggestion, source: 'model', state: 'offered' } }));
      else offerStarter(hit, c, 'The on-device model gave nothing that could be offered, so this is the starter.');
    } catch {
      if (runRef.current === run) offerStarter(hit, c, 'The on-device model did not answer, so this is the starter.');
    } finally {
      fitBusy.current = false;
      if (runRef.current === run) setAdjBusy(null);
    }
  };

  /**
   * What each child needs in this lesson: one request for each child the note says something about, one
   * after another, on the fit route. A point is read by rule against that child's constraints before it is
   * offered. Nothing lands: each point waits for the teacher.
   */
  const fitChildren = async (only: string) => {
    const now = liveRef.current;
    if (!sent || !now.draft || replay || device !== 'available' || fitBusy.current) return;
    const run = runRef.current;
    const items = now.draft.items;
    const todo = notesRef.current.filter((n) => n.id === only);
    let done = 0;
    for (const n of todo) {
      if (runRef.current !== run || liveRef.current.stage !== 'result' || signingRef.current) break;
      done++;
      setFitChild({ id: n.id, done, total: todo.length });
      setChildSaid(({ [n.id]: _old, ...rest }) => rest);
      fitBusy.current = true;
      try {
        const got = await timed('fit', () =>
          fitLessonForChild({ childName: n.child, childNote: n.text, stages: stageList }, (p) =>
            pointHits(p.text, n.id, p.itemIndex, items, liveRef.current.liveConstraints, note).map((h) => h.matched),
          ),
        );
        if (runRef.current !== run) return;
        setFitWhere('ON_DEVICE');
        setFittedChildren((f) => [...f, n.id]);
        setPointsSuggested((c) => c + got.points.length);
        setPoints((ps) => [
          ...ps,
          ...got.points
            .filter((p) => !ps.some((x) => x.childId === n.id && x.itemIndex === p.itemIndex && x.text === p.text))
            .map((p): Point => ({ key: `p:${n.id}:${++pointSeq.current}`, childId: n.id, child: n.child, itemIndex: p.itemIndex, text: p.text, source: 'model', state: 'offered' })),
        ]);
        const said = childFitSaid(n.child, got);
        if (said) setChildSaid((c) => ({ ...c, [n.id]: said }));
      } catch {
        if (runRef.current === run) setChildSaid((c) => ({ ...c, [n.id]: `The on-device model did not answer for ${n.child}. Write what ${n.child} needs yourself.` }));
      } finally {
        fitBusy.current = false;
      }
    }
    if (runRef.current === run) setFitChild(null);
  };

  /** "Fit the lesson on this device": each child with a note, then every hit with nothing offered yet, one after another. Each offer waits for the teacher. */
  const fitLesson = async () => {
    if (fitBusy.current || fittingLesson) return;
    const run = runRef.current;
    setFittingLesson(true);
    for (const hit of [...hitsRef.current]) {
      if (runRef.current !== run || liveRef.current.stage !== 'result') break;
      if (!adjRef.current[hit.key] && hitsRef.current.some((h) => h.key === hit.key)) await suggestFor(hit);
    }
    if (runRef.current === run) setFittingLesson(false);
  };

  const hitActions = {
    onSuggest: (hit: LessonHit) => void suggestFor(hit),
    onAccept: (hit: LessonHit) => {
      const c = liveConstraints.find((x) => x.id === hit.constraintId);
      // Read by rule once more at the moment it is accepted: a constraint may have been switched since it was offered.
      if (!fittingLive || !c || adjustmentProblem(adj[hit.key]?.text ?? '', c, liveConstraints, note)) return;
      setAdj((a) => (a[hit.key] ? { ...a, [hit.key]: { ...a[hit.key], state: 'accepted', seen: true } } : a));
    },
    onSave: (hit: LessonHit, text: string) => {
      const c = liveConstraints.find((x) => x.id === hit.constraintId);
      if (!fittingLive || !c) return 'This step is no longer waiting for an adjustment.';
      const problem = adjustmentProblem(text, c, liveConstraints, note);
      if (problem) return problem;
      const typed = text.replace(/\s+/g, ' ').trim();
      setAdj((a) => ({ ...a, [hit.key]: { text: typed, source: a[hit.key]?.text === typed ? a[hit.key].source : 'teacher', state: 'accepted', seen: true } }));
      return undefined;
    },
    onLeave: (hit: LessonHit) => fittingLive && setAdj((a) => ({ ...a, [hit.key]: { text: '', source: 'teacher', state: 'left' } })),
    onReopen: (hit: LessonHit) =>
      fittingLive &&
      setAdj(({ [hit.key]: was, ...rest }) => (was && was.state === 'accepted' ? { ...rest, [hit.key]: { ...was, state: 'offered', seen: true } } : rest)),
    repeats: (hit: LessonHit, text: string) => {
      const c = liveConstraints.find((x) => x.id === hit.constraintId);
      return Boolean(sent && repeatsForChild(text, c?.about, sent.entities, liveConstraints).length > 0);
    },
  };

  const pointActions: PointActions = {
    onAccept: (key) => {
      const items = draft?.items;
      if (!fittingLive || !items) return;
      // Read by rule once more at the moment it is accepted: a constraint may have been switched since it was offered.
      setPoints((ps) =>
        ps.map((p) => {
          if (p.key !== key) return p;
          // A line the cloud wrote is left as long as it came.
          const problem = pointProblem(p.text, p.childId, p.itemIndex, items, liveConstraints, note, p.source === 'cloud' ? 1000 : undefined);
          const { why: _why, ...rest } = p;
          return problem ? { ...rest, seen: true, why: problem } : { ...rest, state: 'accepted', seen: true };
        }),
      );
    },
    onSave: (key, itemIndex, text) => {
      const p = points.find((x) => x.key === key);
      if (!fittingLive || !draft || !p) return 'This point is no longer here.';
      const problem = pointProblem(text, p.childId, itemIndex, draft.items, liveConstraints, note);
      if (problem) return problem;
      const typed = text.replace(/\s+/g, ' ').trim();
      setPoints((ps) => ps.map((x) => (x.key === key ? { key, childId: x.childId, child: x.child, itemIndex, text: typed, source: x.text === typed ? x.source : 'teacher', state: 'accepted', seen: true } : x)));
      return undefined;
    },
    onAdd: (childId, itemIndex, text) => {
      const n = notesByChild.find((x) => x.id === childId);
      if (!fittingLive || !draft || !n) return 'This lesson can no longer be changed.';
      const problem = pointProblem(text, childId, itemIndex, draft.items, liveConstraints, note);
      if (problem) return problem;
      const typed = text.replace(/\s+/g, ' ').trim();
      setPoints((ps) => [...ps, { key: `p:${childId}:${++pointSeq.current}`, childId, child: n.child, itemIndex, text: typed, source: 'teacher', state: 'accepted', seen: true }]);
      return undefined;
    },
    onDrop: (key) => fittingLive && setPoints((ps) => ps.filter((p) => p.key !== key)),
    onReopen: (key) => fittingLive && setPoints((ps) => ps.map((p) => (p.key === key ? { ...p, state: 'offered', seen: true } : p))),
    repeats: (childId, text) => Boolean(sent && repeatsForChild(text, childId, sent.entities, liveConstraints).length > 0),
    onStarter: (key) => {
      if (!fittingLive) return;
      setPoints((ps) =>
        ps.map((p) => {
          if (p.key !== key || !p.starter) return p;
          const { why: _why, starter, nothing: _nothing, ...rest } = p;
          return { ...rest, text: starter, source: 'starter', state: 'offered', seen: true };
        }),
      );
    },
    onMore: (childId) => void fitChildren(childId),
  };

  /** Accept every offered adjustment and valid adaptation point at once (no scroll-lock required). */
  const acceptAll = () => {
    for (const h of hits) {
      if (adj[h.key]?.state === 'offered') hitActions.onAccept(h);
    }
    const items = draft?.items;
    if (!fittingLive || !items) return;
    setPoints((ps) =>
      ps.map((p) => {
        if (p.state !== 'offered' || p.nothing) return p;
        const problem = pointProblem(p.text, p.childId, p.itemIndex, items, liveConstraints, note, p.source === 'cloud' ? 1000 : undefined);
        const { why: _why, ...rest } = p;
        return problem ? { ...rest, seen: true, why: problem } : { ...rest, state: 'accepted', seen: true };
      }),
    );
  };

  /** Accept all valid waiting points & hits, then immediately sign off without losing pending adaptations. */
  const acceptWaitingAndSignOff = () => {
    const items = draft?.items;
    if (!fittingLive || !items) return;
    const nextPoints = points.map((p) => {
      if (p.state !== 'offered' || p.nothing) return p;
      const problem = pointProblem(p.text, p.childId, p.itemIndex, items, liveConstraints, note, p.source === 'cloud' ? 1000 : undefined);
      const { why: _why, ...rest } = p;
      return problem ? { ...rest, seen: true, why: problem } : { ...rest, state: 'accepted' as const, seen: true };
    });
    void signOff(nextPoints);
  };

  // A constraint switched on the result screen: an accepted point that a rule now fires on goes back to waiting.
  useEffect(() => {
    if (task !== 'lesson' || !draft || stage !== 'result' || replay) return;
    setPoints((ps) => recheckPoints(ps, draft.items, liveConstraints, note));
  }, [task, draft, stage, replay, liveConstraints, note]);

  // ---------------------------------------------------------------- saved lessons, and the next one

  const changeLessons = (next: SavedLesson[]) => {
    setLessons(next);
    storeLessons(next);
  };

  /** Open the write screen for the lesson after this one: same class, same subject, and what was done last time. */
  const planNext = (from: SavedLesson) => {
    if (replay) return;
    clearRun();
    setTask('lesson');
    setLesson(nextLessonFields(from));
    // What the exit ticket said becomes needs for this lesson: told by letter, with the names kept here.
    setConstraints(withTicketNeeds(constraints, from));
    constraintsNote.current = note;
    setComposing(true);
    setView('desk');
  };

  /** Confirm every constraint that is not yet confirmed. Each one withholds its words, as a single confirm does. */
  const confirmAll = () => {
    if (stage !== 'review' || replay) return;
    let held = { entities: rawEntities, constraints };
    for (const c of constraints) if (!c.confirmed) held = confirmConstraint(note, held.entities, held.constraints, c.id);
    held = toldByDefault(held, constraints.filter((c) => !c.confirmed).map((c) => c.id));
    setEntities(held.entities);
    setConstraints(held.constraints);
  };

  const finalText = useMemo(() => {
    if (!draft) return '';
    const items = draft.items.filter((_, i) => kept[i] === true);
    return restore([draft.title, '', ...items.map((i) => `${i.heading}\n${i.text}\n`)].join('\n'), entities, sent?.tokens).trim();
  }, [draft, kept, entities, sent]);

  /** The class plan of a lesson as it is copied: the kept stages with stand-ins as they came, so no name and no adjustment is in it. */
  // Before sign-off the plan is every stage that is not struck; after it, the stages that were kept.
  const keptIndexes = draft ? draft.items.map((_, i) => i).filter((i) => (stage === 'signed' ? kept[i] === true : kept[i] !== false)) : [];
  const classPlan = draft
    ? variations.length > 0
      ? // With the lines for needs under each stage, by letter: no name is in them either.
        planWithNeeds({ title: draft.title, items: keptIndexes.map((i) => draft.items[i]) }, variations, (i) => keptIndexes[i])
      : classPlanText({ title: draft.title, items: keptIndexes.map((i) => draft.items[i]) })
    : '';

  const savedMaterials = (m: Materials) => ({ board: m.board, sheet: m.sheet, versions: m.versions, ticket: m.ticket, same: m.same });

  /** The request for materials, exactly as it would be sent: the signed class plan and the needs by letter. */
  const materialsRequest = task === 'lesson' && sent && (stage === 'signed' || stage === 'result') && classPlan ? materialsText(classPlan, sent.lessonNeeds, sent.language) : '';
  const materialsStopped = useMemo(() => (materialsRequest && sent ? checkOutgoing(materialsRequest, sent.entities) : []), [materialsRequest, sent]);
  /** The section "For each need" as the cloud returned it; in a replay, the entries that were kept. */
  const sectionLines = needsReply?.section
    ? needsReply.section.split('\n').map((l) => l.trim()).filter(Boolean)
    : result
      ? variations.map((v) => entryLine(v, stageName(result.draft.items[v.itemIndex]?.heading ?? '')))
      : [];
  const needNames = (letter: string) => (sent ? namesForNeed(letter, sent.lessonNeeds, notesByChild, sent.entities) : []);

  const makeMaterials = async () => {
    if (!sent || !materialsRequest || materialsBusy || replay || materialsStopped.length > 0) return;
    const text = materialsRequest;
    const run = runRef.current;
    setMaterialsBusy(true);
    setMaterialsStreamChars(0);
    setMaterialsFail(null);
    try {
      const got = await timed(
        'materials',
        () =>
          writeMaterials(
            text,
            sent.lessonNeeds.map((n) => n.letter),
            sent.policy.cloudModel,
            (partial) => runRef.current === run && setMaterialsStreamChars(partial.length),
          ),
        (g) => (g.where === 'ON_DEVICE' ? 'ON_DEVICE' : 'IN_CLOUD'),
      );
      if (runRef.current !== run) return;
      setMaterials({ ...got, text, issues: checkReply(materialsReply(got.materials), sent.entities, sent.tokens, text) });
      // Counted on the receipt in this browser. Nothing of it is in the record that may leave the device.
      const id = signedId.current;
      // Kept with the saved lesson, if it is signed already. Letters only: no name is in them.
      if (id) changeLessons(lessonsRef.current.map((l) => (l.id === id ? { ...l, materials: savedMaterials(got.materials) } : l)));
      setReceipts((rs) => {
        const next = rs.map((r) => (r.id === id && r.lesson ? { ...r, lesson: { ...r.lesson, materialsVersions: got.materials.versions.length } } : r));
        storeReceipts(next);
        return next;
      });
    } catch {
      if (runRef.current === run) setMaterialsFail(configured ? 'The materials could not be written, or what came back was not whole. Nothing of it is shown. You can try again.' : 'This build has no Firebase project, so the cloud refused the request and no materials were written.');
    } finally {
      if (runRef.current === run) {
        setMaterialsBusy(false);
        setMaterialsStreamChars(0);
      }
    }
  };

  const printMaterials = (withNames: boolean) => {
    setPrintWhat(withNames ? 'materials' : 'materials-no-names');
    // The sheet is drawn first, then printed; after printing it holds the signed text again.
    setTimeout(() => {
      window.print();
      setPrintWhat('run');
    }, 80);
  };

  /** The confirmed needs with a line for a lesson that are not told yet, and the button that tells them all. */
  const untold = task === 'lesson' ? constraints.filter((c) => c.confirmed && !c.share && lessonNeedLine(c) !== undefined) : [];
  const tellAll = () => {
    if (stage !== 'review' || replay) return;
    const ids = new Set(untold.map((c) => c.id));
    setConstraints(constraints.map((c) => (ids.has(c.id) ? { ...c, share: true } : c)));
  };

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
    setScanWhere('NOT_RUN');
    setNanoDiff(null);
    setStreamPreview('');
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
    setAdj({});
    setAdjBusy(null);
    setFittingLesson(false);
    setAdjNotes({});
    setPoints([]);
    setVariations([]);
    setVariationsDropped(0);
    setNeedsReply(null);
    setMaterials(null);
    setMaterialsBusy(false);
    setMaterialsStreamChars(0);
    setMaterialsFail(null);
    setPrintWhat('run');
    signedId.current = null;
    setPointsSuggested(0);
    setChildSaid({});
    setFitChild(null);
    setFittedChildren([]);
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
    setActiveNeed(null);
    setPreviewOpen(false);
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
    // The marks and needs of each child go with the class. The class plans stay.
    changeLessons(lessons.map(withoutClass));
    setNote('');
    setClassList([]);
    setConstraints([]);
    setRemoved([]);
    setLesson(NO_LESSON);
    setKeepClass(false);
    setScanPreview(null);
    setScanError(null);
    setScanWhere('NOT_RUN');
    setComposing(false);
    constraintsNote.current = '';
    try {
      localStorage.removeItem(CLASS_KEY);
      localStorage.removeItem(KEEP_CLASS_KEY);
      sessionStorage.removeItem(LESSON_KEY);
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

  /** Immediately wipe all notes, class lists, constraints, saved lessons, and local receipts from this browser (shared-PC reset). */
  const clearDesk = () => {
    forgetNote(true);
    setKeepClass(false);
    setDeskCleared(true);
    setTimeout(() => setDeskCleared(false), 4000);
  };

  // ---------------------------------------------------------------- the recorded run

  /** Jump cleanly to any screen of the recorded run. Everything shown comes from the file: no model is asked and nothing is sent. */
  const jumpReplay = (to: ReplayStage, source: RecordedRun | null = replay) => {
    if (!source) return;
    setActiveNeed(null);
    setPreviewOpen(to === 'signed');
    if (to === 'write') {
      setEntities([]);
      setGuardWhere('NOT_RUN');
      setSent(null);
      setResult(null);
      setChecks([]);
      setFirstChecks([]);
      setModelChecks([]);
      setEdits({});
      setRechecked(false);
      setKept([]);
      setCheckWhere('NOT_RUN');
      setVariations([]);
      setNeedsReply(null);
      setMaterials(null);
      setReplyIssues([]);
      setReplyRead(false);
      setStage('write');
      return;
    }
    setEntities(source.entities);
    setGuardWhere(source.where.guard);
    if (to === 'review') {
      setSent(null);
      setResult(null);
      setChecks([]);
      setFirstChecks([]);
      setModelChecks([]);
      setEdits({});
      setRechecked(false);
      setKept([]);
      setCheckWhere('NOT_RUN');
      setVariations([]);
      setNeedsReply(null);
      setMaterials(null);
      setReplyIssues([]);
      setReplyRead(false);
      setStage('review');
      return;
    }
    const tokens = [...new Set(source.outgoing.match(TOKEN_RE) ?? [])];
    const recordedNeeds = source.task === 'lesson' ? source.needs : undefined;
    const nextSent = {
      text: source.outgoing,
      at: source.recordedAt,
      entities: source.entities,
      tokens,
      online: true,
      policy: source.policy,
      constraints: source.constraints,
      needs: recordedNeeds ? outgoingOf(source.note, source.entities, source.constraints, true).needs : sharedNeeds(source.constraints, source.entities),
      language: source.task === 'lesson' || source.task === 'parents' ? languageOf(source.lesson) : '',
      lessonNeeds: (recordedNeeds ?? []).map((n) => ({ ...n, constraintIds: [], children: source.needChildren?.[n.letter] ?? [], others: [], issues: [], sensitive: [] })),
    };
    setSent(nextSent);
    setVariations(source.variations ?? []);
    // What came of each need, as recorded. A file recorded before this was kept has none, and no line accounts for the needs.
    const outcomes = Object.entries(source.needOutcomes ?? {});
    setNeedsReply(
      source.needOutcomes
        ? { section: '', none: outcomes.filter(([, o]) => o === 'already suits').map(([l]) => l), missing: outcomes.filter(([, o]) => o === 'missing').map(([l]) => l), second: null }
        : null,
    );
    setMaterials(source.materials ? { materials: { ...source.materials, sheet: source.materials.sheet.map(unnumbered), versions: source.materials.versions.map((v) => ({ ...v, items: v.items.map(unnumbered) })), ticket: source.materials.ticket.map((t) => ({ ...t, question: unnumbered(t.question) })), dropped: 0, same: source.materials.same ?? [], missing: source.materials.missing ?? [] }, where: source.where.draft, model: source.draftModel, text: '', issues: [] } : null);
    setResult({ draft: source.draft, where: source.where.draft, model: source.draftModel });
    const baseReplyText = [source.draft.title, ...source.draft.items.flatMap((i) => [i.heading, i.text]), ...(source.variations ?? []).map(variationLine)].join('\n');
    const baseModelChecks = source.checks.map(modelSaid);
    let nextChecks = source.checks;
    let nextKept = source.task === 'lesson' ? source.checks.map(() => true) : startsKept(source.checks);
    let nextEdits: Record<number, string> = {};
    let nextRechecked = false;
    let nextReplyText = baseReplyText;
    if (to === 'signed' && source.rewrites && source.rewrites.length > 0) {
      // The last screen shows the run as it stood when it was saved: the rewritten items in place of the
      // cloud's, checked again here by rule. No model is asked.
      const came = bracketDraft(source.draft, tokens).items;
      nextEdits = Object.fromEntries(source.rewrites.map((r) => [r.itemIndex, r.text]));
      const items = came.map((item, i) => (i in nextEdits ? { ...item, text: nextEdits[i] } : item));
      const told = new Map(nextSent.needs.map((n) => [n.id, n.line]));
      const after = recheckItems(items, source.constraints, source.entities, tokens, source.note, told, baseModelChecks, items.map((_, i) => i in nextEdits));
      nextKept = keptAfterRecheck(nextKept, source.checks, after);
      nextChecks = after;
      nextRechecked = true;
      nextReplyText = [source.draft.title, ...items.flatMap((i) => [i.heading, i.text])].join('\n');
    }
    setChecks(nextChecks);
    setFirstChecks(source.checks);
    setModelChecks(baseModelChecks);
    setEdits(nextEdits);
    setRechecked(nextRechecked);
    setKept(nextKept);
    setCheckWhere(source.where.check);
    // The return gate is plain code, so it is run again here on the recorded reply.
    setReplyIssues(checkReply(nextReplyText, source.entities, tokens, source.outgoing));
    setReplyRead(false);
    setStage(to);
  };

  /** Show the recorded run in place of the teacher's note, which is put aside and brought back on leaving. */
  const startReplay = () => {
    if (!recorded || replay) return;
    stash.current = { note, classList, constraints, task, lesson };
    clearRun();
    setReplay(recorded);
    setNote(recorded.note);
    setClassList(recorded.classList);
    setConstraints(recorded.constraints);
    setTask(recorded.task);
    setLesson(recorded.lesson ?? NO_LESSON);
    jumpReplay('write', recorded);
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
    setTask(back?.task ?? 'lesson');
    setLesson(back?.lesson ?? NO_LESSON);
  };

  const nextInReplay = () => {
    if (!replay || !['write', 'review', 'result'].includes(stage)) return;
    jumpReplay(replayNext(stage as ReplayStage));
  };

  const prevInReplay = () => {
    if (!replay || !['review', 'result', 'signed'].includes(stage)) return;
    jumpReplay(replayPrev(stage as ReplayStage));
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
        ...(task === 'lesson'
          ? {
              lesson,
              adjustments: inNoteOrder([...acceptedAdjustments(hits, adj), ...acceptedPoints(points)], notesByChild).map((a) => ({
                itemIndex: a.itemIndex,
                ...(stageList[a.itemIndex] ? { stage: stageList[a.itemIndex].name } : {}),
                ...(a.childId ? { childId: a.childId } : {}),
                ...(a.constraintId ? { constraintId: a.constraintId } : {}),
                text: a.text,
                source: RECORDED_SOURCE[a.source],
                ...(a.need ? { need: a.need } : {}),
                ...(a.pair ? { pair: true } : {}),
              })),
              needs: sent.lessonNeeds.map((n) => ({ letter: n.letter, line: n.line })),
              needChildren: Object.fromEntries(sent.lessonNeeds.map((n) => [n.letter, n.children])),
              variations,
              needOutcomes: needOutcomes(sent.lessonNeeds.map((n) => n.letter), variations, needsReply?.none ?? []),
              ...(materials ? { materials: materials.materials } : {}),
            }
          : {}),
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
    // The invented class is planned a lesson: the main job of the app.
    setTask('lesson');
    setLesson(SAMPLE_LESSON);
    setComposing(true);
  };

  /** The first screen's main button: load the invented class and run the guard in one go. */
  const trySample = () => {
    loadSample();
    void runGuard(SAMPLE_NOTE, SAMPLE_CLASS_LIST, true);
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
  const isLesson = task === 'lesson';
  /** The adjustments on screen: the teacher's own, or in a replay the ones of the recorded run. */
  const recordedAdj = (replay?.adjustments ?? []).map((a) => ({ ...a, source: sourceOf(a.source) }));
  const shownAdj = replay ? recordedAdjustments(hits, recordedAdj) : adj;
  const shownPoints = replay ? recordedPoints(recordedAdj, notesByChild) : points;
  const waitingHits = unsettled(hits, shownAdj);
  const waitingPoints = shownPoints.filter((p) => p.state === 'offered');
  const waitingAcceptablePoints = waitingPoints.filter((p) => !p.nothing && !p.why);
  const offered = hits.filter((h) => shownAdj[h.key]?.state === 'offered').length + waitingAcceptablePoints.length;
  // Each child by the full class-list name for consistent private Teacher's copy output.
  const acceptedNow = inNoteOrder([...acceptedAdjustments(hits, shownAdj), ...acceptedPoints(shownPoints)], notesByChild).map((a) => {
    const named = a.childId ? notesByChild.find((n) => n.id === a.childId)?.name : undefined;
    return named && named !== a.child ? { ...a, child: named } : a;
  });
  /** Something the device can still write: a child it has not answered for, or a hit with nothing offered. */
  const toFit = hits.some((h) => !adj[h.key]);
  // A lesson is read in its own order. The other tasks show what was caught first.
  const order = isLesson ? (draft?.items ?? []).map((_, i) => i) : resultOrder(checks, draft?.items.length ?? 0);
  const flagged = isLesson ? [] : order.filter((i) => checks[i]?.verdict === 'conflict' || checks[i]?.verdict === 'unsure');
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
          Forget this class
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
          nothing else.
        </p>
        <details>
          <summary>Details</summary>
          <p>
            Read the items against your other private details yourself.
            {isLesson
              ? ' What the cloud wrote for a need is placed beside each child on this device by plain code, and read by the same rules. Where the on-device model is present, it can also offer more ideas for a child from your note, when you ask.'
              : ''}
          </p>
        </details>
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
    /** For a lesson: the children this stage does not suit, by rule. */
    const itemHits = isLesson ? hits.filter((h) => h.itemIndex === i) : [];
    /** In a replay: what the on-device model suggested for this item in the recorded run. Read-only. */
    const recordedFit = replay?.fits?.find((f) => f.itemIndex === i);
    return (
      <li
        key={i}
        className={['item', kept[i] === null ? 'undecided' : kept[i] ? 'kept' : 'struck', isLesson ? (itemHits.length > 0 ? 'needs-fit' : '') : conflict ? 'is-conflict' : doubt ? 'is-doubt' : '']
          .join(' ')
          .trim()}
      >
        <h4>
          <DeviceText text={item.heading} entities={entities} allowed={sent?.tokens} />
          {edited && <span className="edited-chip">{replay ? 'Rewritten in the recorded run' : 'Rewritten by you'}</span>}
        </h4>
        <p className="item-text">
          <DeviceText text={item.text} entities={entities} allowed={sent?.tokens} mark={conflict || (doubt && c?.constraintId) ? c?.matched : undefined} />
        </p>
        {isLesson && variations.some((v) => v.itemIndex === i) && (
          <ul className="need-lines" aria-label="For the needs you told the cloud">
            {variations
              .filter((v) => v.itemIndex === i)
              .map((v, k) => (
                <li
                  key={k}
                  className={activeNeed === v.need ? 'is-traced' : undefined}
                  onMouseEnter={() => setActiveNeed(v.need)}
                  onMouseLeave={() => setActiveNeed(null)}
                >
                  <b>For Need {v.need}:</b> {v.text}
                  {/* Whose need it is: known on this device only. */}
                  {sent && namesForNeed(v.need, sent.lessonNeeds, notesByChild, sent.entities).map((name) => (
                    <span className="names" key={name}>
                      {name}
                    </span>
                  ))}
                </li>
              ))}
          </ul>
        )}
        {isLesson && itemHits.length > 0 && (
          <div className="verdict v-fit">
            <b>{needsFitting(itemHits)}</b>
            <span>{[...new Set(itemHits.map((h) => h.child))].join(', ')}: see above, under each name.</span>
          </div>
        )}
        {c && conflict && !isLesson && (
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
        {c && doubt && !(isLesson && c.constraintId) && (
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
        {c && !conflict && !doubt && !(isLesson && itemHits.length > 0) && (
          <p className={`quiet-verdict q-${c.verdict.replace(' ', '-')}${byRuleOnly ? ' q-rule' : ''}`}>
            <b>{sent?.language ? NOT_CHECKED_BY_RULE : edited ? 'Checked by rule' : byRuleOnly ? 'No conflict found by rule' : verdictLabel(c)}</b>{' '}
            <span>
              {sent?.language
                ? NOT_ENGLISH
                : edited
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
                {stage === 'signed' && !replyBlocked && <ReadAloud text={restore(item.text, entities, sent?.tokens).trim()} language={sent?.language ?? ''} />}
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
        {stage === 'result' && !(box && live) && !isLesson && (
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
          <button className={view === 'lessons' ? 'tab on' : 'tab'} onClick={() => setView('lessons')}>
            Lessons
            <span className={lessons.length > 0 ? 'count' : 'count none'} aria-hidden={lessons.length === 0}>
              {lessons.length}
            </span>
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
          {deskCleared && (
            <span className="pill ok" role="status">
              <i />
              Desk cleared from this browser
            </span>
          )}
          {!replay && !busy && (note !== '' || classList.length > 0 || lessons.length > 0 || receipts.length > 0 || stage !== 'write') && (
            <button className="pill action" type="button" onClick={clearDesk} title="Wipe notes, class list, saved lessons, and receipts from this browser (shared-PC reset)">
              Clear desk
            </button>
          )}
        </div>
      </header>

      {replay && (
        <div className="replay-banner" role="status">
          <span>{replayBanner(replay)}</span>
          <span className="replay-jumps">
            <button className="link" type="button" onClick={() => jumpReplay('review')}>
              What leaves
            </button>
            <button className="link" type="button" onClick={() => jumpReplay('result')}>
              Beside each child
            </button>
            <button className="link" type="button" onClick={() => jumpReplay('signed')}>
              Copy preview
            </button>
            <button className="link" type="button" onClick={() => setInspecting(true)}>
              Inspect
            </button>
            <button className="link" type="button" onClick={leaveReplay}>
              Leave the recorded run
            </button>
          </span>
        </div>
      )}

      {view === 'how' && <How policy={policy} device={device} />}
      {view === 'lessons' && (
        <Lessons
          lessons={lessons}
          classList={classList}
          sample={note === SAMPLE_NOTE}
          view={classView(lessons, classList, constraints, lessonNeedLine)}
          onAfter={(id, after) => changeLessons(lessons.map((l) => (l.id === id ? { ...l, after } : l)))}
          onNext={planNext}
          onDelete={(id) => changeLessons(lessons.filter((l) => l.id !== id))}
          onDeleteAll={() => changeLessons([])}
        />
      )}
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
          <Stepper
            step={STEP[stage]}
            lesson={task === 'lesson'}
            onStep={
              replay
                ? (i) => jumpReplay(i === 0 ? 'write' : i === 1 ? 'review' : i === 4 ? 'signed' : 'result')
                : undefined
            }
          />
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
                  {sent?.language && (
                    <p className="caution" role="status">
                      {NOT_ENGLISH}
                    </p>
                  )}
                  {isLesson && needsReply && sent && sent.lessonNeeds.length > 0 && <p className="hint">{needsAccount(needOutcomes(sent.lessonNeeds.map((n) => n.letter), variations, needsReply.none))}.</p>}
                  {isLesson && needsReply && needsReply.none.length > 0 && (
                    <p className="hint">
                      The cloud says this lesson already suits {needsReply.none.map((l) => `Need ${l}${needNames(l).length > 0 ? ` (${needNames(l).join(', ')})` : ''}`).join('; ')}. Read it against what you know.
                    </p>
                  )}
                  <h3 className="summary">{restore(draft.title, entities, sent?.tokens)}</h3>
                  <p className="result-sub">
                    {isLesson ? fitSummary(notesByChild.length, replay ? shownPoints.filter((p) => p.source === 'model').length : pointsSuggested, hits, shownPoints) : summaryLine(checks)}
                  </p>
                  {isLesson && fittingLive && (notesByChild.length > 0 || hits.length > 0) && (
                    <div className="actions fit-all">
                      {(toFit || fittingLesson) && (
                        <button className="primary small" disabled={signing || adjBusy !== null || fittingLesson} onClick={() => void fitLesson()}>
                          {fitChild
                            ? `Fitting for ${fitChild.done} of ${fitChild.total} ${fitChild.total === 1 ? 'child' : 'children'}…`
                            : fittingLesson
                              ? 'Fitting on this device…'
                              : 'Fit the lesson on this device'}
                        </button>
                      )}
                      {offered > 1 && (
                        <button className="secondary small" disabled={signing} onClick={acceptAll}>
                          Accept all {offered}
                        </button>
                      )}
                      <span className="hint">
                        {variations.length > 0
                          ? 'The cloud wrote each line for a need, not for a child. This device put it beside the child. Nothing lands until you accept it.'
                          : device === 'available'
                            ? 'Write what a child needs, or ask this device for more ideas under a name. Nothing is sent, and nothing lands until you accept it.'
                            : 'No on-device model here. Write what a child needs yourself; a step that goes against a constraint gets starter wording by rule. Nothing lands until you accept it.'}
                      </span>
                    </div>
                  )}
                  {isLesson && stage === 'result' && (notesByChild.length > 0 || hits.length > 0) && (
                    <ChildSections
                      notes={notesByChild}
                      stages={stageList.map((x) => x.name)}
                      hits={hits}
                      adjustments={shownAdj}
                      points={shownPoints}
                      live={fittingLive}
                      canModel={device === 'available'}
                      busyKey={adjBusy}
                      busyChild={fitChild?.id ?? null}
                      hitNotes={adjNotes}
                      said={childSaid}
                      recorded={Boolean(replay)}
                      hitActions={hitActions}
                      pointActions={pointActions}
                      activeNeed={activeNeed}
                      onHoverNeed={setActiveNeed}
                    />
                  )}
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
                          <button className="primary" onClick={() => copy('all', isLesson ? classPlan : finalText)} disabled={replyBlocked}>
                            {copyLabel('all', isLesson ? 'Copy the class plan' : 'Copy the text')}
                          </button>
                        )}
                        {keptCount > 0 && isLesson && (
                          <button className="secondary" onClick={() => setPreviewOpen((o) => !o)}>
                            {previewOpen ? 'Hide copy preview' : 'Preview class & teacher copies'}
                          </button>
                        )}
                        {keptCount > 0 && isLesson && !replyBlocked && <ReadAloud text={classPlan} language={sent?.language ?? ''} />}
                        {isLesson && (
                          <button className="link" onClick={() => setView('lessons')}>
                            Lessons
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
                      {isLesson && keptCount > 0 && (
                        <p className="hint">
                          The class plan is copied and printed with no name and nothing written for a child. What you accepted for each child prints on a second page, for you.
                        </p>
                      )}
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

                  {isLesson && stage === 'signed' && (
                    <div className="strip">
                      <h4>For these children</h4>
                      <ForTheseChildren stages={draft.items} adjustments={acceptedNow} />
                      <p className="hint">Kept on this device with the lesson. Never sent, and not in any record.</p>
                    </div>
                  )}

                  {isLesson && stage === 'signed' && previewOpen && (replay || keptCount > 0) && (
                    <CopyPreview
                      title={draft.title}
                      meta={[lesson.klass, lesson.subject, lesson.topic, `${lessonMinutes(lesson.minutes)} minutes`].filter(Boolean).join(' · ')}
                      stages={draft.items.filter((_, i) => kept[i] === true)}
                      variations={variations}
                      adjustments={acceptedNow}
                    />
                  )}

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
                      {isLesson && (
                        <button className="secondary small" onClick={() => setPreviewOpen((o) => !o)}>
                          {previewOpen ? 'Hide copy preview' : 'Preview class & teacher copies'}
                        </button>
                      )}
                      <span className="hint">No receipt was written.</span>
                      <button className="secondary small" onClick={leaveReplay}>
                        Leave the recorded run
                      </button>
                    </div>
                  )}

                </article>
              )}

              {isLesson && sent && !replyBlocked && (replay ? Boolean(materials) && (stage === 'result' || stage === 'signed') : stage === 'result' || (stage === 'signed' && keptCount > 0)) && (
                <MaterialsCard
                  request={materialsRequest}
                  stopped={materialsStopped}
                  busy={materialsBusy}
                  streamChars={materialsStreamChars}
                  fail={materialsFail}
                  result={materials?.materials ?? null}
                  issues={materials?.issues ?? []}
                  where={materials ? (materials.where === 'IN_CLOUD' ? `Written in the cloud by ${materials.model}` : 'The cloud failed, so the on-device model wrote these') : ''}
                  namesFor={needNames}
                  onSend={() => void makeMaterials()}
                  onPrint={stage === 'signed' && !replay ? printMaterials : undefined}
                  noPrint={replay ? 'From the recorded run.' : 'Sign off the lesson to print these.'}
                  activeNeed={activeNeed}
                  onHoverNeed={setActiveNeed}
                />
              )}

              {/* ---- the task, and for a lesson the lines that say what it is */}
              {editing && (
                <article className="card">
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
                  {(task === 'lesson' || task === 'parents') && (
                    <div className="write-in">
                      <label className="lesson-field">
                        Write it in
                        <select
                          value={LANGUAGES.some((l) => l === (lesson.language || 'English')) ? lesson.language || 'English' : 'other'}
                          disabled={Boolean(replay)}
                          onChange={(e) => setLesson((l) => ({ ...l, language: e.target.value === 'other' ? ' ' : e.target.value === 'English' ? '' : e.target.value }))}
                        >
                          {LANGUAGES.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                          <option value="other">Another language</option>
                        </select>
                      </label>
                      {lesson.language !== undefined && lesson.language !== '' && !LANGUAGES.some((l) => l === lesson.language) && (
                        <label className="lesson-field">
                          Which language
                          <input type="text" value={lesson.language.trimStart()} maxLength={40} readOnly={Boolean(replay)} placeholder="Marathi" onChange={(e) => setLesson((l) => ({ ...l, language: e.target.value || ' ' }))} />
                        </label>
                      )}
                      {languageOf(lesson) && (
                        <p className="hint">
                          Sent as one line: “{task === 'lesson' ? 'Language of the plan' : 'Language of the messages'}: {languageOf(lesson)}”. {NOT_ENGLISH}
                        </p>
                      )}
                    </div>
                  )}
                  {task === 'lesson' && (
                    <div className="lesson-lines">
                      {(
                        [
                          ['klass', 'Class', 'Class 6'],
                          ['subject', 'Subject', 'English'],
                          ['topic', 'Topic', 'Writing a short description of a place'],
                        ] as const
                      ).map(([key, label, example]) => (
                        <label key={key} className={`lesson-field f-${key}`}>
                          {label}
                          <input
                            type="text"
                            value={lesson[key]}
                            readOnly={Boolean(replay)}
                            maxLength={FIELD_MAX}
                            placeholder={example}
                            onChange={(e) => setLesson((l) => ({ ...l, [key]: e.target.value }))}
                          />
                        </label>
                      ))}
                      <label className="lesson-field f-minutes">
                        Minutes
                        <input
                          type="number"
                          min={5}
                          max={240}
                          value={lesson.minutes}
                          readOnly={Boolean(replay)}
                          onChange={(e) => setLesson((l) => ({ ...l, minutes: Number(e.target.value) }))}
                          onBlur={() => setLesson((l) => ({ ...l, minutes: lessonMinutes(l.minutes) }))}
                        />
                      </label>
                      <label className="lesson-field f-last">
                        What we did last time <small>optional</small>
                        <textarea
                          rows={2}
                          value={lesson.lastTime}
                          readOnly={Boolean(replay)}
                          maxLength={LAST_TIME_MAX}
                          onChange={(e) => setLesson((l) => ({ ...l, lastTime: e.target.value }))}
                        />
                      </label>
                      <p className="hint">These lines are not private. They are sent as written, under “Lesson”.</p>
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
                  {!replay && (
                    <div className="notebook-scan">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void scanNotebookFile(f);
                          e.target.value = '';
                        }}
                      />
                      <button className="secondary small" type="button" disabled={scanning} onClick={() => fileInputRef.current?.click()}>
                        {scanning ? 'Transcribing on this device…' : 'Scan notebook photo'}
                      </button>
                      <button className="link" type="button" disabled={scanning} onClick={() => void scanSampleNotebook()}>
                        Try sample notebook photo
                      </button>
                      {noModel && <span className="hint">Notebook photo transcription requires Chrome's built-in Gemini Nano.</span>}
                    </div>
                  )}
                  {scanPreview && (
                    <div className="scan-preview" role="status">
                      <img src={scanPreview.url} alt="Scanned handwritten register thumbnail" />
                      <span>{scanPreview.summary}</span>
                    </div>
                  )}
                  {scanError && (
                    <p className="caution" role="alert">
                      {scanError}
                    </p>
                  )}
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
                      One name per line, kept with your note. A name on this list is{' '}
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
                  {!replay && (
                    <label className="keep-class">
                      <input type="checkbox" checked={keepClass} onChange={(e) => setKeepClass(e.target.checked)} />
                      Keep this class in this browser
                      <small>
                        {keepClass
                          ? 'On: your note, class list and constraints stay in local storage on this computer only.'
                          : 'Personal device only — leave off on a shared staffroom PC (session clears when tab closes).'}
                      </small>
                    </label>
                  )}
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
                      <button
                        className="primary"
                        disabled={note.trim().length < 20 || note.length > NOTE_MAX || (task === 'lesson' && !lessonReady(lesson))}
                        onClick={() => runGuard()}
                      >
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

              {stage === 'guarding' && (
                <article className="card">
                  <Spinner label={download !== null ? `Loading the on-device model: ${Math.round(download * 100)}%` : progress} />
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

              {/* ---- the constraints: below the highlighted note on Review */}
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
                    {isLesson
                      ? 'What your note says a child cannot do, or needs. The words and the name stay here. If you switch a need on, the cloud is told the need by a letter, with no name and no reason, and writes for it without knowing whose it is.'
                      : 'Private facts that rule something out. A confirmed one stays here, and every step of the draft is checked against it on this device.'}
                  </p>
                  {guardWhere === 'ON_DEVICE' && nanoDiff && !replay && (
                    <p className="nano-summary" role="status">
                      <b>Gemini Nano on this device:</b> Rules alone found {nanoDiff.rulesOnly} · Gemini Nano added +{nanoDiff.nanoAdded} more.
                    </p>
                  )}
                  {isLesson && !replay && untold.length > 0 && (
                    <div className="actions">
                      <button className="secondary small" onClick={tellAll}>
                        Tell the cloud {untold.length === 1 ? 'the 1 need' : `all ${untold.length} needs`}
                      </button>
                      <span className="hint">Letters and lines only. Whose each need is stays on this device.</span>
                    </div>
                  )}
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
                    lesson={isLesson}
                    activeNeed={activeNeed}
                    onHoverNeed={setActiveNeed}
                  />
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
                <div className="cloud-sticky">
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
                        {partOfNote
                          ? 'Nothing is withheld. The sentences of your note below are exactly as you wrote them: every name and every detail in them will be sent to the cloud model.'
                          : 'Nothing is withheld. The text below is your note exactly as you wrote it: every name and every detail in it will be sent to the cloud model.'}
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
                      <CloudText text={outgoing} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
                    </pre>
                    {!replay && (going.notSent ?? 0) > 0 && <p className="hint">{notSentLine(going.notSent!)}</p>}
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
                      <p className="hint">
                        {partOfNote
                          ? 'A receipt holds the text you approved. Here that is the sentences of your note that are sent, as written.'
                          : 'A receipt holds the text you approved. Here that is your whole note, as written.'}
                      </p>
                    )}
                  </article>
                </div>
              )}

              {stage === 'drafting' && (
                <article className="card">
                  <Spinner
                    label={
                      online
                        ? streamPreview
                          ? `Streaming draft from ${policy.cloudModel} (${streamPreview.length} chars)…`
                          : `Asking ${policy.cloudModel} to write the draft`
                        : 'Offline — trying cloud first; falling back to Gemini Nano on this device…'
                    }
                  />
                  {streamPreview && (
                    <pre className="wire stream-live" aria-live="polite">
                      {streamPreview.slice(-900)}
                    </pre>
                  )}
                </article>
              )}

              {((result && stage !== 'review' && stage !== 'drafting') || materials || (sent && stage !== 'review')) && (
                <div className="cloud-sticky">
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
                        {sectionLines.length > 0 && (
                          <p>
                            <b>For each need</b>
                            {sectionLines.map((l, k) => (
                              <span key={k}>
                                <br />
                                <CloudText text={l} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      <p className="hint">
                        {variations.length > 0
                          ? 'The cloud wrote for each need by its letter. It was not told whose a need is, or how many pupils have it.'
                          : 'The reply uses the stand-ins. Names are put back on your side of the door.'}
                      </p>
                      {variationsDropped > 0 && (
                        <p className="hint">
                          {variationsDropped} {variationsDropped === 1 ? 'entry was' : 'entries were'} for a need you did not tell the cloud or a stage that is not in the lesson, or had no words, so{' '}
                          {variationsDropped === 1 ? 'it is' : 'they are'} left out.
                        </p>
                      )}
                      {needsReply?.second && <p className="hint">The cloud was asked once more for the needs its first reply left out. Inspect shows the exact text of that second request.</p>}
                    </article>
                  )}

                  {materials && (
                    <article className="card">
                      <div className="card-head">
                        <h3>{materials.where === 'IN_CLOUD' ? 'Materials: what came back' : 'Materials: written on the device'}</h3>
                        <span className="hint">{materials.model}</span>
                      </div>
                      <MaterialsWire result={materials.materials} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
                      <p className="hint">The cloud was sent the signed class plan and the needs by letter. It was not told whose a need is.</p>
                      <details className="fold">
                        <summary>The text that was sent for the materials · {materials.text.length.toLocaleString()} characters</summary>
                        <pre className="wire">
                          <CloudText text={materials.text} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
                        </pre>
                      </details>
                    </article>
                  )}

                  {sent && stage !== 'review' && (
                    <details className="card fold outbox" open={stage === 'drafting' || undefined}>
                      {/* "Sent" only once the cloud has answered. Until then, and when it never did, the app cannot say the text arrived. */}
                      <summary>
                        {result?.where === 'IN_CLOUD' ? 'Sent' : 'Approved by you'} at {time(sent.at)} · {sent.text.length.toLocaleString()} characters
                      </summary>
                      <pre className="wire">
                        <CloudText text={sent.text} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ------------------------------------------------ the action bar: always in reach at the foot of the window */}
          {stage === 'review' && (
            <div className="action-bar cloud-bar">
              {replay ? (
                <>
                  <span className="hint">Recorded run: this is the text that was approved and sent on the day. Nothing is sent now.</span>
                  <button className="secondary" onClick={prevInReplay}>
                    Back
                  </button>
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
                        {partOfNote
                          ? 'Nothing has been withheld. I am sending these sentences of my note as written.'
                          : 'Nothing has been withheld. I am sending my note as written.'}
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
                  <button className="secondary" onClick={prevInReplay}>
                    Back
                  </button>
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
                    {isLesson
                      ? waitingHits.length > 0
                        ? `${waitingHits.length} ${waitingHits.length === 1 ? 'child still waits' : 'children still wait'} for an adjustment, or for you to leave the step as it is.`
                        : `${acceptedNow.length} accepted for ${new Set(acceptedNow.map((a) => a.child)).size} ${new Set(acceptedNow.map((a) => a.child)).size === 1 ? 'child' : 'children'}. They stay on this device.${
                            waitingPoints.length > 0 ? ` ${waitingPoints.length} ${waitingPoints.length === 1 ? 'adaptation still waits' : 'adaptations still wait'}.` : ''
                          }`
                      : undecided > 0
                      ? `${undecided} of ${kept.length} still to decide. Nothing is kept until you keep it.`
                      : keptCount === 0
                        ? 'Every item is struck. Signing off now rejects the whole draft.'
                        : `${keptCount} kept, ${struckCount} struck.`}
                  </span>
                  {toKeep > 0 && !isLesson && (
                    <button className="secondary" disabled={signing} onClick={() => !signingRef.current && setKept((k) => keepNoConflict(k, checks))}>
                      Keep the {toKeep} {toKeep === 1 ? 'item' : 'items'} with no conflict found
                    </button>
                  )}
                  {isLesson && waitingHits.length === 0 && waitingAcceptablePoints.length > 0 ? (
                    <>
                      <button className="primary" onClick={acceptWaitingAndSignOff} disabled={signing || undecided > 0 || replyBlocked}>
                        Accept all {waitingAcceptablePoints.length} & sign off
                      </button>
                      <button className="link" onClick={() => void signOff()} disabled={signing || undecided > 0 || replyBlocked}>
                        Sign off without {waitingAcceptablePoints.length} unaccepted
                      </button>
                    </>
                  ) : (
                    <button className="primary" onClick={() => void signOff()} disabled={signing || undecided > 0 || replyBlocked || (isLesson && waitingHits.length > 0)}>
                      {isLesson ? 'Sign off the lesson' : undecided === 0 && keptCount === 0 ? 'Reject the whole draft' : `Sign off ${keptCount} of ${kept.length} items`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {stage === 'signed' && replay && (
            <div className="action-bar device-bar">
              <span className="hint">Recorded run: end of the replay. Nothing was sent or stored.</span>
              <button className="secondary" onClick={prevInReplay}>
                Back
              </button>
              <button className="primary" onClick={leaveReplay}>
                Leave the recorded run
              </button>
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
          system={draftSystem(currentTask.id)}
          format={DRAFT_FORMAT}
          heading={DRAFT_NOTES_HEADING}
          labelSystem={LABEL_SYSTEM}
          labelChars={LABEL_CHARS}
          secondRequest={needsReply?.second ?? undefined}
          network={network}
          steps={steps}
          isReplay={Boolean(replay)}
          replayInfo={
            replay
              ? {
                  guard: replay.where.guard,
                  draft: replay.where.draft,
                  check: replay.where.check,
                  draftModel: replay.draftModel,
                  hasMaterials: Boolean(replay.materials),
                }
              : undefined
          }
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
            scan: scanWhere === 'ON_DEVICE' ? WHERE_RAN.ON_DEVICE : undefined,
            guard: stage === 'write' || stage === 'guarding' ? undefined : WHERE_RAN[guardWhere],
            draft: result && after ? `${WHERE_RAN[result.where]}: ${result.model}` : undefined,
            check: stage === 'result' || stage === 'signed' ? WHERE_RAN[checkWhere] : undefined,
            // Listed once the on-device model has answered a fit in this run, or the recorded run holds a suggestion.
            fit:
              stage !== 'result' && stage !== 'signed'
                ? undefined
                : replay
                  ? (replay.fits ?? []).length > 0 || (replay.adjustments ?? []).some((a) => a.source === 'on-device model')
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
          {printWhat !== 'run' && materials ? (
            <MaterialsPages title={draft.title} result={materials.materials} namesFor={needNames} withNames={printWhat === 'materials'} />
          ) : task === 'parents' ? (
            printable.map(({ item, i, family }) => (
              <div className="print-page" key={i}>
                <h2>For the family of {family.student!.surfaces[0]}</h2>
                <p>{restore(item.text, entities, sent?.tokens).trim()}</p>
              </div>
            ))
          ) : isLesson ? (
            <>
              {/* Page 1: the class plan, stand-ins as they came. No name and no adjustment: it can be pinned up or shared. */}
              <div className="print-page">
                <h1>{draft.title}</h1>
                <p>{[lesson.klass, lesson.subject, lesson.topic, `${lessonMinutes(lesson.minutes)} minutes`].filter(Boolean).join(' · ')}</p>
                {draft.items.map((item, i) =>
                  kept[i] === true ? (
                    <div key={i}>
                      <h2>{item.heading}</h2>
                      <p>{item.text.trim()}</p>
                      {variations
                        .filter((v) => v.itemIndex === i)
                        .map((v, k) => (
                          <p key={k}>{variationLine(v)}</p>
                        ))}
                    </div>
                  ) : null,
                )}
              </div>
              <div className="print-page">
                <h1>Teacher's copy: adjustments. Keep this private.</h1>
                <ForTheseChildren stages={draft.items} adjustments={acceptedNow} />
              </div>
            </>
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
