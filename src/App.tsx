import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Constraint, ConstraintKind, DraftItem, Entity, ItemCheck, Kind, LabelWhere, Receipt, TaskId, Where } from './core/types';
import { SAMPLE_CLASS_LIST, SAMPLE_LESSON, SAMPLE_NOTE, TASKS } from './core/samples';
import { addByTeacher, applyLocks, bracketDraft, buildVault, deterministicCandidates, insidePrivate, possibleNameCandidates, RESERVED, restore, TOKEN_RE } from './core/vault';
import { checkOutgoing, checkReply, safeTitle, type Violation } from './core/gate';
import { HINDI_RULE_ONLY, languageOf, NOT_ENGLISH, ruleSupportedLanguage, withLanguage } from './core/lesson';
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
import { ConstraintsPanel } from './ui/Constraints';
import { Hero } from './ui/Hero';
import { How, Inspect, Receipts, WHERE_RAN, type Records } from './ui/pages';
import { draftFailure, resultOrder } from './ui/say';
import { keptAfterRecheck, modelSaid, recheckItems, rewriteStep, stepIndexOf, stepToRewrite } from './core/recheck';
import { canFit, FIT_CHILD_FAILED, FIT_FAILED, fitForChild, fitInputFor, fitLessonForChild, fitStep } from './ai/fit';
import { useInstall, useUpdate } from './ui/pwa';
import { checkNeed, needIsTyped, needLine, outgoingOf, sharedNeeds, type Need } from './core/needs';
import { askAgain, entryLine, lessonNeedIsTyped, lessonNeedLine, lessonNeeds, needLabel, needOutcomes, planWithNeeds, proposeLearning, secondAsk, splitVariations, variationLine, withSecondReading, type LessonNeed, type NeedsReading, type Variation } from './core/lessonNeeds';
import { asRecordedRun, captureRun, RECORDED_FILE, RECORDED_SOURCE, replayBanner, replayNext, replayPrev, sourceOf, type RecordedFit, type RecordedRun, type ReplayStage } from './core/recorded';
import { familyAfterRewrite, familyFor } from './core/family';
import { repeatsForChild, repeatsPrivate } from './core/repeats';
import {
  acceptedAdjustments,
  adjustmentHits,
  adjustmentProblem,
  classPlanText,
  lessonCounts,
  lessonHits,
  lessonReady,
  loadLessons,
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
import { Lessons, type PointActions } from './ui/Lesson';
import { acceptedPoints, childFitSaid, childNotes, dedupePairVariations, inNoteOrder, missingPoints, namesForNeed, pairPoints, placeVariations, pointCounts, pointHits, pointProblem, recheckPoints, recordedPoints, stageLines, type Point } from './core/points';
import { clearUserSession, configured, DEFAULT_POLICY, ensureUser, loadPolicy, loadReceiptCopies, saveReceiptCopy, watchUser, type Policy } from './ai/firebase';
import { deviceStatus, imageOnDeviceStatus, prepareDevice, type DeviceStatus } from './ai/routes';
import { constraintsFromCombined, guardCombinedOnDevice, guardOutcome, paragraphs, unreadText } from './ai/guard';
import { extractScannedClassList, prepareNotebookImage, transcribeNotebookOnDevice } from './ai/notebook';
import { mergeLearningIntoConstraints, mergeProposals, type ConstraintReport } from './ai/constraints';
import { classView, currentTicketKind, withoutClass, withTicketNeeds } from './core/ticket';
import { materialsReply, materialsText, unnumbered, type Materials } from './core/materials';
import { MODEL_HOST, STEPS_MAX, type StepId, type StepMark, type StepWhere } from './core/network';
import { stageName } from './core/lesson';
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
import { anythingToCheck, checkDidNotRun, checkOnDevice, keepNoConflict, noConflictFound, NOTHING_WITHHELD, startsKept } from './ai/check';
import { afterBellActivities, combineChecks, ruleCheckItem } from './core/conflicts';
import { RouteChip, Stepper } from './ui/parts';
import { AppHeader } from './ui/AppHeader';
import { ReviewCard } from './ui/ReviewCard';
import { PrintSheet } from './ui/PrintSheet';
import { CalmNotice } from './ui/CalmNotice';
import { ForgetQuestion, NoteLinks, NoteView, VaultPanel } from './ui/VaultPanel';
import { ResultItem } from './ui/ResultItem';
import { NoteComposeCard, NoteReviewCard, TaskComposeCard } from './ui/ComposeCards';
import { CloudOutcomeCards } from './ui/CloudOutcomeCards';
import { ResultPanel } from './ui/ResultPanel';
import { ActionBar } from './ui/ActionBar';
import {
  CLASS_KEY,
  CLASS_LIST_KEY,
  CONSTRAINTS_KEY,
  KEEP_CLASS_KEY,
  keptClass,
  LESSON_KEY,
  local,
  MAX_SELECTION,
  message,
  network,
  NO_GAPS,
  NO_MODEL,
  NOTE_KEY,
  read,
  readSignOutBlocked,
  session,
  STEP,
  write,
  writeSignOutBlocked,
  type Gaps,
  type KeptClass,
  type Stage,
  type View,
} from './app/storage';

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
  const [imageDevice, setImageDevice] = useState<DeviceStatus>('checking');
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState<{ url: string; summary: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [deskCleared, setDeskCleared] = useState<'ok' | 'signout-failed' | null>(() =>
    readSignOutBlocked() ? 'signout-failed' : null,
  );
  const deskClearedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signOutBlockedRef = useRef(readSignOutBlocked());
  const recordsGenRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nanoDiff, setNanoDiff] = useState<{ rulesOnly: number; nanoAdded: number } | null>(null);
  const [streamPreview, setStreamPreview] = useState('');
  const [draftFallback, setDraftFallback] = useState(false);
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
  const stepsRef = useRef<StepMark[]>([]);
  const addStep = (m: StepMark) => {
    stepsRef.current = [...stepsRef.current, m].slice(-STEPS_MAX);
    setSteps(stepsRef.current);
  };
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
  /** What the print sheet holds now: class-only by default (safe on shared printers), teacher-only, or materials with/without names. */
  const [printWhat, setPrintWhat] = useState<'class-only' | 'teacher-only' | 'materials' | 'materials-no-names'>('class-only');
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
    imageOnDeviceStatus().then(setImageDevice);
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
  useEffect(() => write(local, 'staffroom.keepCopies', keepCopies, !keepCopies), [keepCopies]);
  useEffect(() => {
    if (replay) return;
    const blankLesson = !lesson.klass && !lesson.subject && !lesson.topic && !lesson.lastTime && !lesson.language && lesson.minutes === NO_LESSON.minutes;
    write(session, LESSON_KEY, lesson, blankLesson);
  }, [lesson, replay]);
  // The class is kept on this device only when explicitly opted in for a personal device.
  useEffect(() => {
    if (replay) return;
    write(local, KEEP_CLASS_KEY, keepClass, !keepClass);
    write(local, CLASS_KEY, { note, classList, constraints, constraintsNote: constraintsNote.current, lesson, removed } satisfies KeptClass, !keepClass || note === '');
  }, [keepClass, note, classList, constraints, lesson, removed, replay]);
  useEffect(() => {
    if (!replay && !storeLessons(lessons, keepClass) && lessons.length > 0) setStoreFailed(true);
  }, [lessons, keepClass, replay]);
  useEffect(() => {
    if (!replay && !storeReceipts(receipts, keepClass) && receipts.length > 0) setStoreFailed(true);
  }, [receipts, keepClass, replay]);
  useEffect(() => {
    if (!replay) write(session, CONSTRAINTS_KEY, { note: constraintsNote.current, constraints, removed }, constraints.length === 0 && removed.length === 0);
  }, [constraints, replay, removed]);

  /** Read the records kept in the teacher's account. They hold no text, so there is none to show. */
  const refreshRecords = useCallback(async (user: string) => {
    if (signOutBlockedRef.current) {
      recordsGenRef.current += 1;
      setRecords({ state: 'idle' });
      return;
    }
    const gen = ++recordsGenRef.current;
    setRecords((r) => (r.state === 'ready' ? r : { state: 'loading' }));
    try {
      const { records: list, unreadable } = await loadReceiptCopies(user);
      if (recordsGenRef.current !== gen || signOutBlockedRef.current) return;
      setRecords({ state: 'ready', list, unreadable });
    } catch {
      if (recordsGenRef.current !== gen || signOutBlockedRef.current) return;
      setRecords({ state: 'failed' });
    }
  }, []);

  useEffect(() => {
    if (view !== 'receipts') return;
    if (uid && !signOutBlockedRef.current) void refreshRecords(uid);
    else {
      recordsGenRef.current += 1;
      setRecords({ state: 'idle' });
    }
    return () => {
      recordsGenRef.current += 1;
    };
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
  const scanNotebookFile = async (blob: Blob, isSample = false) => {
    if (replay || scanning) return;
    setScanning(true);
    setScanError(null);
    const run = runRef.current;
    try {
      const ready = await turnOnDevice();
      const imgStatus = await imageOnDeviceStatus();
      setImageDevice(imgStatus);
      if (!ready || imgStatus === 'unsupported' || imgStatus === 'unavailable' || runRef.current !== run) {
        setScanError(
          imgStatus === 'unsupported' || imgStatus === 'unavailable'
            ? 'Notebook image transcription is not available in this browser (Chrome Built-in multimodal Nano required).'
            : 'Notebook photo transcription requires Chrome with Gemini Nano ready on this device.',
        );
        return;
      }
      const prepared = await prepareNotebookImage(blob);
      const scanStart = performance.now();
      const scanned = await timed(
        'scan',
        () => transcribeNotebookOnDevice(prepared),
        () => 'ON_DEVICE',
      );
      const scanEnd = performance.now();
      if (runRef.current !== run) return;
      setScanWhere('ON_DEVICE');
      setNote((prev) => {
        const trimmed = prev.trim();
        const combined = trimmed ? `${trimmed}\n\n${scanned.text}` : scanned.text;
        return combined.slice(0, NOTE_MAX);
      });
      // Seed missing student names from the scanned text itself using local proper-name rules, keeping any teacher list intact.
      if (classList.length === 0) {
        const matched = extractScannedClassList(scanned.text);
        if (matched.length > 0) setClassList(matched);
      }
      if (isSample && !lesson.subject && !lesson.topic) setLesson(SAMPLE_LESSON);
      setComposing(true);
      const modelHits = network
        ? network.list().filter((r) => r.host === MODEL_HOST && r.at >= scanStart && r.at <= scanEnd).length
        : null;
      setScanPreview({
        url: prepared.previewUrl,
        summary:
          modelHits !== null
            ? `Transcribed ${scanned.text.length} chars locally on Gemini Nano · ${modelHits} model-host ${modelHits === 1 ? 'request' : 'requests'} recorded`
            : `Transcribed ${scanned.text.length} chars locally on Gemini Nano`,
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
      await scanNotebookFile(blob, true);
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
    // The language the cloud is asked to write in. Run deterministic rules for English and Hindi; skip English-only Nano check for non-English drafts.
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
    setDraftFallback(false);
    setStreamPreview('');
    const approvedAt = new Date().toISOString();
    setSent({ text, at: approvedAt, entities, tokens, online: sentOnline, policy: sentPolicy, constraints, needs: approved.needs, lessonNeeds: approved.lessonNeeds ?? [], language });
    setStage('drafting');
    let drafted: DraftResult;
    try {
      drafted = await timed(
        'draft',
        () =>
          writeDraft(
            text,
            currentTask,
            cloudModel,
            (partial) => !gone() && setStreamPreview(partial),
            () => !gone() && setDraftFallback(true),
          ),
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
      // Over a third of the needs have no entry: the drafter is asked once more, for those letters only. The text is the one
      // the teacher approved and one more line, so there is no new tick; Inspect shows that it was sent, word for word.
      const again = secondAsk(text, split.missing);
      second = again;
      setProgress(drafted.where === 'ON_DEVICE' ? 'Asking this device once more for the needs it left out' : 'Asking the cloud once more for the needs it left out');
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
    if (language && !ruleSupportedLanguage(language)) {
      // Unsupported language: no rule read it, and no model is asked. Every item says so.
      itemChecks = items.map(() => ({ verdict: 'not checked', reason: NOT_ENGLISH }));
    } else if (!anythingToCheck(items, facts)) {
      // No private detail was withheld and no constraint confirmed: there is nothing to check, so no model is asked.
      itemChecks = items.map(() => NOTHING_WITHHELD);
      where = 'SKIPPED';
    } else {
      // Layer A: each step against each confirmed constraint, by rule. Runs in every browser for English and Hindi drafts.
      // Every confirmed constraint is compared, whether or not the cloud was told its need: the cloud can ignore a need.
      const told = new Map(approved.needs.map((n) => [n.id, n.line]));
      // A stage of a lesson is for the whole class, whoever it names: it is compared with every confirmed constraint.
      const byRule = items.map((item) => ruleCheckItem(item, constraints, entities, tokens, note, told, task === 'lesson'));
      const ruleRan = byRule.some((r) => r.compared > 0);
      const unchecked = (reason: string): ItemCheck => ({ verdict: 'not checked', reason });
      // Layer B: the on-device model, against every withheld private detail (English only). Its "no" is a doubt, never a conflict.
      let byModel: ItemCheck[] | null = null;
      let why = language
        ? HINDI_RULE_ONLY
        : 'The on-device check did not run. Read this item against the private details yourself.';
      if (!language) {
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
    const draftOnDevice = drafted.where === 'ON_DEVICE';
    const placed = placeVariations(split.variations, toldNeeds, entities, items, language && !ruleSupportedLanguage(language) ? [] : constraints, note, draftOnDevice);
    const paired = approved.lessonNeeds ? pairPoints(constraints, entities, items, note) : [];
    const missing = dedupePairVariations(missingPoints(split.missing, toldNeeds, entities, constraints, note, draftOnDevice), paired, toldNeeds, constraints);
    setPoints([
      ...dedupePairVariations(placed, paired, toldNeeds, constraints),
      ...missing,
      // Two children who work better apart: only this device knows they are each other's classmate.
      ...paired,
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
    const labelSource =
      task === 'lesson' && lessonReady(lesson)
        ? [lesson.klass, lesson.subject, lesson.topic].filter(Boolean).join(' — ')
        : `${currentTask.label}\n${text}`;
    void timed('label', () => labelReceipt(labelSource, plain, cloudModel), (named) => (named.where === 'FALLBACK' ? 'NONE' : named.where)).then((named) => {
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
    setStoreFailed(!storeReceipts(next, keepClass));
    if (task === 'lesson' && draft) {
      // The signed lesson is kept on this device only: it has the adjustments in it, with names.
      const stages = draft.items.filter((_, i) => signed[i] === true);
      const saved = savedLesson(receipt.id, receipt.createdAt, lesson, draft.title, stages, inNoteOrder([...acceptedAdjustments(hits, adj), ...acceptedPoints(activePoints)], notesByChild), liveConstraints, {
        needs: sent.lessonNeeds.map((n) => ({ letter: n.letter, line: n.line, children: n.children })),
        // A saved lesson counts the kept stages, so a line for a struck stage is not kept.
        ...(materials ? { materials: savedMaterials(materials.materials, materials.issues) } : {}),
        variations: variations.filter((v) => signed[v.itemIndex] === true).map((v) => ({ ...v, itemIndex: signed.slice(0, v.itemIndex).filter((k) => k === true).length })),
      });
      setLessons((l) => {
        const all = [saved, ...l];
        storeLessons(all, keepClass);
        return all.slice(0, 30);
      });
    }
    setStage('signed');
    setSigning(false);
    setCopyState('idle');
    if (keepCopies && uid && !signOutBlockedRef.current) {
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
    const after =
      sent.language && !ruleSupportedLanguage(sent.language)
        ? checks
        : recheckItems(items, live, sent.entities, sent.tokens, note, told, modelChecks, items.map((_, i) => i in nextEdits), task === 'lesson');
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
    if (task !== 'lesson' || !draft || !sent || (sent.language && !ruleSupportedLanguage(sent.language))) return [];
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
        const lessonHeader =
          [lesson.klass.trim(), lesson.subject.trim(), lesson.topic.trim()].filter(Boolean).join(' — ') || restore(now.draft.title, sent.entities, sent.tokens);
        const got = await timed('fit', () =>
          fitLessonForChild({ childName: n.child, childNote: n.text, stages: stageList, lessonHeader, lessonSubject: lesson.subject.trim() }, (p) =>
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
    if (!storeLessons(next, keepClass) && next.length > 0) setStoreFailed(true);
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

  const savedMaterials = (m: Materials, issues: readonly Violation[] = []) => ({
    board: m.board,
    sheet: m.sheet,
    versions: m.versions,
    ticket: m.ticket,
    same: m.same,
    ...(m.missing.length > 0 ? { missing: m.missing } : {}),
    ...(issues.length > 0 ? { issues: issues.map((v) => ({ what: v.what, why: v.why })) } : {}),
  });

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
      // Kept with the saved lesson, if it is signed already. Letters only: no name is in them.
      const id = signedId.current;
      const issues = checkReply(materialsReply(got.materials), sent.entities, sent.tokens, text);
      if (id) changeLessons(lessonsRef.current.map((l) => (l.id === id ? { ...l, materials: savedMaterials(got.materials, issues) } : l)));
      setMaterials({ ...got, text, issues });
      setReceipts((rs) => {
        const next = rs.map((r) => (r.id === id && r.lesson ? { ...r, lesson: { ...r.lesson, materialsVersions: got.materials.versions.length } } : r));
        storeReceipts(next, keepClass);
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

  const printSheet = (kind: typeof printWhat) => {
    setPrintWhat(kind);
    // The sheet is drawn first, then printed; after printing it returns to safe class-only defaults.
    setTimeout(() => {
      window.print();
      setPrintWhat('class-only');
    }, 80);
  };

  const printMaterials = (withNames: boolean) => {
    printSheet(withNames ? 'materials' : 'materials-no-names');
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
    if (!stepsRef.current.some((s) => s.step === 'scan')) setScanWhere('NOT_RUN');
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
    setPrintWhat('class-only');
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
  const forgetNote = (alsoReceipts: boolean, alsoLessons = false) => {
    clearRun();
    if (alsoReceipts) {
      setReceipts([]);
      storeReceipts([]);
    }
    // The marks and needs of each child go with the class. The class plans stay.
    changeLessons(alsoLessons ? [] : lessons.map(withoutClass));
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

  /** Immediately wipe all notes, class lists, constraints, saved lessons, local receipts, copy-record opt-in, and the anonymous Auth session from this browser. */
  const clearDesk = async () => {
    recordsGenRef.current += 1;
    forgetNote(true, true);
    setKeepClass(false);
    setKeepCopies(false);
    setRecords({ state: 'idle' });
    try {
      localStorage.removeItem('staffroom.keepCopies');
    } catch {
      // Storage is switched off.
    }
    signOutBlockedRef.current = true;
    writeSignOutBlocked(true);
    const signedOut = await clearUserSession();
    signOutBlockedRef.current = !signedOut;
    writeSignOutBlocked(!signedOut);
    if (deskClearedTimer.current) {
      clearTimeout(deskClearedTimer.current);
      deskClearedTimer.current = null;
    }
    setDeskCleared(signedOut ? 'ok' : 'signout-failed');
    if (signedOut) {
      deskClearedTimer.current = setTimeout(() => setDeskCleared(null), 4000);
    }
  };

  /** Retry ending the anonymous Auth session after Clear desk failed to sign out cleanly. */
  const retrySignOut = async () => {
    const signedOut = await clearUserSession();
    signOutBlockedRef.current = !signedOut;
    writeSignOutBlocked(!signedOut);
    if (deskClearedTimer.current) {
      clearTimeout(deskClearedTimer.current);
      deskClearedTimer.current = null;
    }
    setDeskCleared(signedOut ? 'ok' : 'signout-failed');
    if (signedOut) {
      recordsGenRef.current += 1;
      setRecords({ state: 'idle' });
      deskClearedTimer.current = setTimeout(() => setDeskCleared(null), 4000);
    }
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
    const replayClassPlan = (source.variations?.length ?? 0) > 0 ? planWithNeeds(source.draft, source.variations!) : classPlanText(source.draft);
    const replayMatText = source.materials ? materialsText(replayClassPlan, nextSent.lessonNeeds, nextSent.language) : '';
    setMaterials(source.materials ? { materials: { ...source.materials, sheet: source.materials.sheet.map(unnumbered), versions: source.materials.versions.map((v) => ({ ...v, items: v.items.map(unnumbered) })), ticket: source.materials.ticket.map((t) => ({ ...t, question: unnumbered(t.question) })), dropped: 0, same: source.materials.same ?? [], missing: source.materials.missing ?? [] }, where: source.where.materials ?? source.where.draft, model: source.draftModel, text: replayMatText, issues: [] } : null);
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
        where: {
          ...(scanWhere === 'ON_DEVICE' ? { scan: 'ON_DEVICE' } : {}),
          guard: guardWhere,
          draft: result.where,
          check: checkWhere,
          ...(fitWhere !== 'NOT_RUN' ? { fit: fitWhere } : {}),
          ...(label && label.where !== 'FALLBACK' ? { label: label.where } : {}),
          ...(materials ? { materials: materials.where } : {}),
        },
        draftModel: result.model,
        networkSteps: stepsRef.current.map((s) => {
          const during = (network?.list() ?? []).filter((r) => r.at >= s.start && r.at <= s.end);
          const modelRequests = during.filter((r) => r.host === MODEL_HOST).length;
          return {
            step: s.step,
            where: s.where ?? (s.step === 'draft' || s.step === 'materials' ? 'IN_CLOUD' : 'ON_DEVICE'),
            durationMs: Math.max(0, Math.round(s.end - s.start)),
            modelRequests,
            otherRequests: during.length - modelRequests,
          };
        }),
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
  const vaultFold = (
    <VaultPanel
      entities={entities}
      withheld={withheld}
      inside={inside}
      policy={policy}
      stage={stage}
      replay={Boolean(replay)}
      guardWhere={guardWhere}
      guardGaps={guardGaps}
      noteParts={noteParts}
      vaultOpen={vaultOpen}
      setVaultOpen={setVaultOpen}
      toggle={toggle}
      releaseAsk={releaseAsk}
      setReleaseAsk={setReleaseAsk}
      flip={flip}
      unconfirmAsk={unconfirmAsk}
      setUnconfirmAsk={setUnconfirmAsk}
      setConstraints={setConstraints}
    />
  );

  const noteView = <NoteView note={note} entities={entities} stage={stage} noteRef={noteRef} onSelectText={onSelectText} />;

  const noteLinks = (
    <NoteLinks
      replay={Boolean(replay)}
      editing={editing}
      busy={busy}
      stage={stage}
      note={note}
      classListCount={classList.length}
      receiptsCount={receipts.length}
      loadSample={loadSample}
      startOver={startOver}
      setForgetAsk={setForgetAsk}
      forgetNote={forgetNote}
    />
  );

  const forgetQuestion = (
    <ForgetQuestion forgetAsk={forgetAsk} receiptsCount={receipts.length} busy={busy} forgetNote={forgetNote} setForgetAsk={setForgetAsk} />
  );

  const calm = (
    <CalmNotice
      stage={stage}
      guardWhere={guardWhere}
      checkWhere={checkWhere}
      guardGaps={guardGaps}
      isLesson={isLesson}
      privateHeld={privateHeld}
      watch={watch}
    />
  );

  /** One item of the draft: the words, what the device found, and the teacher's choice. */
  const resultItem = (i: number) => {
    if (!draft) return null;
    const item = draft.items[i];
    return (
      <ResultItem
        key={i}
        i={i}
        item={item}
        c={checks[i]}
        keptValue={kept[i]}
        edited={i in edits}
        isLesson={isLesson}
        task={task}
        stage={stage}
        replay={Boolean(replay)}
        canFitHere={canFitHere}
        checkWhere={checkWhere}
        rechecked={rechecked}
        entities={entities}
        sent={sent}
        variations={variations}
        activeNeed={activeNeed}
        setActiveNeed={setActiveNeed}
        notesByChild={notesByChild}
        hits={hits}
        recordedFit={replay?.fits?.find((f) => f.itemIndex === i)}
        box={rewriting[i]}
        setRewriting={setRewriting}
        fitSaidValue={fitSaid[i]}
        repeats={repeatsNote(i)}
        family={task === 'parents' ? familyOf(item, i) : null}
        replyBlocked={replyBlocked}
        copy={copy}
        copyLabel={copyLabel}
        setCopyOn={setCopyOn}
        signing={signing}
        decide={decide}
        liveConstraints={liveConstraints}
        fitting={fitting}
        fittingAll={fittingAll}
        fitOne={fitOne}
        startRewrite={startRewrite}
        saveRewrite={saveRewrite}
        closeRewrite={closeRewrite}
        edits={edits}
        setFitted={setFitted}
        checkAgain={checkAgain}
        offIds={offIds}
      />
    );
  };

  return (
    <div className="app">
      <AppHeader
        landing={landing}
        view={view}
        setView={setView}
        lessonsCount={lessons.length}
        receiptsCount={receipts.length}
        device={device}
        download={download}
        onTurnOnDevice={turnOnDevice}
        online={online}
        configured={configured}
        install={install ?? null}
        deskCleared={deskCleared}
        onRetrySignOut={() => void retrySignOut()}
        canClearDesk={!replay && !busy && (note !== '' || classList.length > 0 || lessons.length > 0 || receipts.length > 0 || stage !== 'write')}
        onClearDesk={() => void clearDesk()}
        watch={watch}
        stage={stage}
      />

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
          setKeepCopies={(on) => {
            if (on && signOutBlockedRef.current) return;
            setKeepCopies(on);
            if (on && !uid) void ensureUser();
            else if (on && uid && view === 'receipts') void refreshRecords(uid);
          }}
          signedIn={Boolean(uid) && deskCleared !== 'signout-failed'}
          signOutBlocked={deskCleared === 'signout-failed'}
          records={deskCleared === 'signout-failed' ? { state: 'idle' } : records}
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
              <ResultPanel
                stage={stage}
                progress={progress}
                result={result}
                draft={draft}
                sent={sent}
                isLesson={isLesson}
                needsReply={needsReply}
                variations={variations}
                needNames={needNames}
                entities={entities}
                notesByChild={notesByChild}
                pointsSuggested={pointsSuggested}
                shownPoints={shownPoints}
                hits={hits}
                checks={checks}
                fittingLive={fittingLive}
                toFit={toFit}
                fittingLesson={fittingLesson}
                fitLesson={fitLesson}
                fitChild={fitChild}
                offered={offered}
                acceptAll={acceptAll}
                device={device}
                stageList={stageList}
                shownAdj={shownAdj}
                adjBusy={adjBusy}
                adjNotes={adjNotes}
                childSaid={childSaid}
                replay={Boolean(replay)}
                hitActions={hitActions}
                pointActions={pointActions}
                activeNeed={activeNeed}
                setActiveNeed={setActiveNeed}
                canFitHere={canFitHere}
                fittable={fittable}
                fittingAll={fittingAll}
                fitting={fitting}
                fitAll={fitAll}
                signing={signing}
                kept={kept}
                keptCount={keptCount}
                storeFailed={storeFailed}
                setView={setView}
                task={task}
                copy={copy}
                copyLabel={copyLabel}
                classPlan={classPlan}
                finalText={finalText}
                replyBlocked={replyBlocked}
                previewOpen={previewOpen}
                setPreviewOpen={setPreviewOpen}
                canPrint={canPrint}
                printSheet={printSheet}
                startOver={startOver}
                copied={copied}
                copyState={copyState}
                online={online}
                rechecked={rechecked}
                replyIssues={replyIssues}
                checkWhere={checkWhere}
                checkRequests={checkRequests}
                flagged={flagged}
                unflagged={unflagged}
                resultItem={resultItem}
                offIds={offIds}
                switchConstraint={switchConstraint}
                acceptedNow={acceptedNow}
                lesson={lesson}
                capture={capture}
                downloadRun={downloadRun}
                leaveReplay={leaveReplay}
                materials={materials}
                materialsRequest={materialsRequest}
                materialsStopped={materialsStopped}
                materialsBusy={materialsBusy}
                materialsStreamChars={materialsStreamChars}
                materialsFail={materialsFail}
                makeMaterials={makeMaterials}
                printMaterials={printMaterials}
              />

              {/* ---- the task, and for a lesson the lines that say what it is */}
              {editing && (
                <TaskComposeCard task={task} setTask={setTask} lesson={lesson} setLesson={setLesson} replay={Boolean(replay)} />
              )}

              {/* ---- the note */}
              {editing && (
                <NoteComposeCard
                  noteLinks={noteLinks}
                  forgetQuestion={forgetQuestion}
                  replay={Boolean(replay)}
                  fileInputRef={fileInputRef}
                  scanning={scanning}
                  scanNotebookFile={scanNotebookFile}
                  scanSampleNotebook={scanSampleNotebook}
                  noModel={noModel}
                  imageDevice={imageDevice}
                  scanPreview={scanPreview}
                  scanError={scanError}
                  note={note}
                  setNote={setNote}
                  listOpen={listOpen}
                  setListOpen={setListOpen}
                  classList={classList}
                  setClassList={setClassList}
                  policy={policy}
                  keepClass={keepClass}
                  setKeepClass={setKeepClass}
                  device={device}
                  download={download}
                  nextInReplay={nextInReplay}
                  task={task}
                  lesson={lesson}
                  runGuard={() => runGuard()}
                  watch={watch}
                />
              )}

              {(stage === 'guarding' || stage === 'review') && (
                <NoteReviewCard
                  noteLinks={noteLinks}
                  forgetQuestion={forgetQuestion}
                  noteView={noteView}
                  stage={stage}
                  replay={Boolean(replay)}
                  selection={selection}
                  selectionNote={selectionNote}
                  withholdSelection={withholdSelection}
                />
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
                  <ReviewCard
                    violations={violations}
                    nothingWithheld={nothingWithheld}
                    partOfNote={partOfNote}
                    guardWhere={guardWhere}
                    guardGaps={guardGaps}
                    notePartsCount={noteParts.length}
                    replay={Boolean(replay)}
                    taskLabel={currentTask.label}
                    outgoing={outgoing}
                    isLesson={isLesson}
                    activeNeed={activeNeed}
                    onHoverNeed={setActiveNeed}
                    notSentCount={going.notSent ?? 0}
                  />
                </div>
              )}

              <CloudOutcomeCards
                stage={stage}
                online={online}
                fallbackActive={draftFallback}
                cloudModel={policy.cloudModel}
                streamPreview={streamPreview}
                result={result}
                sectionLines={sectionLines}
                isLesson={isLesson}
                activeNeed={activeNeed}
                setActiveNeed={setActiveNeed}
                variationsCount={variations.length}
                variationsDropped={variationsDropped}
                needsReply={needsReply}
                materials={materials}
                sent={sent}
              />
            </section>
          </div>

          {/* ------------------------------------------------ the action bar: always in reach at the foot of the window */}
          <ActionBar
            stage={stage}
            replay={Boolean(replay)}
            prevInReplay={prevInReplay}
            nextInReplay={nextInReplay}
            leaveReplay={leaveReplay}
            readIt={readIt}
            setReadKey={setReadKey}
            approval={approval}
            guardWhere={guardWhere}
            partsUnread={partsUnread}
            unreadAcked={unreadAcked}
            setUnreadKey={setUnreadKey}
            unreadApproval={unreadApproval}
            guardGaps={guardGaps}
            nothingWithheld={nothingWithheld}
            asWritten={asWritten}
            setAsWrittenKey={setAsWrittenKey}
            asWrittenApproval={asWrittenApproval}
            partOfNote={partOfNote}
            policyReady={policyReady}
            outgoingLength={outgoing.length}
            cloudModel={policy.cloudModel}
            canSend={canSend}
            approveAndSend={approveAndSend}
            replyIssues={replyIssues}
            replyRead={replyRead}
            setReplyRead={setReplyRead}
            isLesson={isLesson}
            waitingHits={waitingHits}
            acceptedNow={acceptedNow}
            waitingPoints={waitingPoints}
            waitingAcceptablePoints={waitingAcceptablePoints}
            undecided={undecided}
            kept={kept}
            keptCount={keptCount}
            struckCount={struckCount}
            toKeep={toKeep}
            signing={signing}
            keepNoConflictClick={() => !signingRef.current && setKept((k) => keepNoConflict(k, checks))}
            acceptWaitingAndSignOff={acceptWaitingAndSignOff}
            signOff={() => void signOff()}
            replyBlocked={replyBlocked}
          />
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
                  where: replay.where,
                  draftModel: replay.draftModel,
                  hasMaterials: Boolean(replay.materials),
                  networkSteps: replay.networkSteps,
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
            scan: replay
              ? replay.where.scan
                ? `${WHERE_RAN[replay.where.scan]}, in the recorded run`
                : 'Not recorded in this capture'
              : scanWhere === 'ON_DEVICE'
                ? WHERE_RAN.ON_DEVICE
                : undefined,
            guard: replay
              ? `${WHERE_RAN[replay.where.guard]}, in the recorded run`
              : stage === 'write' || stage === 'guarding'
                ? undefined
                : WHERE_RAN[guardWhere],
            draft: replay
              ? `${WHERE_RAN[replay.where.draft]}: ${replay.draftModel}`
              : result && after
                ? `${WHERE_RAN[result.where]}: ${result.model}`
                : undefined,
            check: replay
              ? `${WHERE_RAN[replay.where.check]}, in the recorded run`
              : stage === 'result' || stage === 'signed'
                ? WHERE_RAN[checkWhere]
                : undefined,
            // Listed once the on-device model has answered a fit in this run, or recorded in the replay.
            fit: replay
              ? replay.where.fit
                ? `${WHERE_RAN[replay.where.fit]}, in the recorded run`
                : (replay.fits ?? []).length > 0 || (replay.adjustments ?? []).some((a) => a.source === 'on-device model')
                  ? `${WHERE_RAN.ON_DEVICE}, in the recorded run`
                  : 'Not recorded in this capture'
              : stage !== 'result' && stage !== 'signed'
                ? undefined
                : fitWhere === 'NOT_RUN'
                  ? undefined
                  : WHERE_RAN[fitWhere],
            label: replay
              ? replay.where.label
                ? `${WHERE_RAN[replay.where.label]}, in the recorded run`
                : 'Not recorded in this capture'
              : (stage === 'result' || stage === 'signed') && label
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
        <PrintSheet
          printWhat={printWhat}
          draft={draft}
          task={task}
          isLesson={isLesson}
          lesson={lesson}
          materials={materials}
          needNames={needNames}
          printable={printable}
          kept={kept}
          variations={variations}
          acceptedNow={acceptedNow}
          entities={entities}
          tokens={sent?.tokens}
        />
      )}
    </div>
  );
}
