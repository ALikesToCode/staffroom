/** What kind of thing a withheld item is. */
export type Kind = 'student' | 'adult' | 'place' | 'contact' | 'id' | 'private';

/** Who found it. The teacher always has the last word. */
export type Source = 'class list' | 'rule' | 'on-device model' | 'teacher';

/**
 * One item the guard found in the note. It lives in the vault, which never
 * leaves the device. Only `token` is ever written into outgoing text.
 */
export interface Entity {
  id: string;
  kind: Kind;
  /** Stand-in written into the outgoing text, for example "[Student 1]". */
  token: string;
  /** Every way this item is written in the note. surfaces[0] is used to restore. */
  surfaces: string[];
  source: Source;
  /** false = the teacher chose to let this one through. */
  withheld: boolean;
  /** For private details: where in the note this one stands. The same words elsewhere are another entry. */
  at?: number;
  /**
   * For an occurrence the teacher marked by hand: its exact place in the note, start and end. Exactly these
   * characters are redacted, whatever stands around them, and the exit gate refuses to pass unless they are.
   */
  span?: { start: number; end: number };
  /** For private details: the id of the student it is about, when known. */
  about?: string;
  /** For private details: health, family, money, identity or other. */
  category?: string;
}

export type TaskId = 'plan' | 'parents' | 'handover';

export interface Task {
  id: TaskId;
  label: string;
  blurb: string;
  instruction: string;
}

/** The shape the drafting model must return. */
export interface Draft {
  title: string;
  items: DraftItem[];
}

export interface DraftItem {
  heading: string;
  text: string;
}

/**
 * fits, conflict and unsure come from the on-device check. 'nothing withheld'
 * means no private detail was withheld at all, so there was nothing to check
 * against. 'not checked' means there was, and no on-device model was
 * available to do it.
 */
export type Verdict = 'fits' | 'conflict' | 'unsure' | 'nothing withheld' | 'not checked';

export interface ItemCheck {
  verdict: Verdict;
  reason: string;
}

/** SKIPPED: the step had nothing to do, so no model was asked. NOT_RUN: it had work and no model to do it. */
export type Where = 'ON_DEVICE' | 'IN_CLOUD' | 'RULES_ONLY' | 'NOT_RUN' | 'SKIPPED';

/** Where the call that names the receipt ran. FALLBACK: no model answered, so the task name is used. */
export type LabelWhere = 'ON_DEVICE' | 'IN_CLOUD' | 'FALLBACK';

/**
 * The receipt of one run, kept in this browser. It holds the approved text
 * and no vault contents. The copy that may go to the cloud is smaller: see
 * ReceiptRecord in receipts.ts.
 */
export interface Receipt {
  id: string;
  createdAt: string;
  task: TaskId;
  label: string;
  /** Where the label was written. Receipts made before this was recorded do not have it. */
  labelWhere?: LabelWhere;
  guard: {
    where: Where;
    found: Record<Kind, number>;
    bySource: Record<Source, number>;
    allowedByTeacher: number;
    /** Paragraphs the on-device model did not read successfully. */
    unreadParagraphs: number;
    /** Private details the model reported that could not be found in the note. */
    droppedDetails: number;
  };
  sent: {
    text: string;
    chars: number;
    /** Older receipts carry a digest of the text here. It is no longer made or shown. */
    sha256?: string;
    approvedAt: string;
    gate: 'passed';
  };
  draft: {
    where: Where;
    model: string;
    /**
     * Set when the device wrote the draft. 'failed': the cloud draft failed, for a reason the app cannot know.
     * Older receipts say 'no answer' or 'not reached', which claimed more than the app could tell.
     */
    cloud?: 'failed' | 'no answer' | 'not reached';
    /** What the browser reported about the network at approval. A separate fact, not the cause. */
    browser?: 'online' | 'offline';
  };
  check: {
    where: Where;
    replyGate: 'passed' | 'flagged';
    fits: number;
    conflict: number;
    unsure: number;
    nothingWithheld: number;
    notChecked: number;
    /** Requests made to the on-device model, and how many of them failed. Receipts made before this was recorded do not have them. */
    requests?: number;
    failedRequests?: number;
  };
  signOff: { kept: number; struck: number; at: string };
}

/** What a constraint rules out. `other` is free text: only the model can check it. */
export type ConstraintKind =
  | 'time-after'
  | 'time-before'
  | 'days-away'
  | 'money'
  | 'no-phone-internet'
  | 'contact'
  | 'health'
  | 'other';

/**
 * A private fact that rules something out for one student, or for the
 * class. It is proposed by rule or by the on-device model, or added by the
 * teacher, and counts only once the teacher has confirmed it. It lives
 * with the note, on the device. It never goes to a receipt or a record:
 * those get counts.
 */
export interface Constraint {
  id: string;
  kind: ConstraintKind;
  /** The id of the student it is about. Absent: it is about the class, or it is not plain whose it is. */
  about?: string;
  /** That student's name as written. The vault is rebuilt when the guard runs again, and the name finds the student in it. */
  aboutName?: string;
  /** The teacher's words: the quote from the note, or what the teacher typed. */
  text: string;
  /** Where `text` stands in the note, when it does. */
  at?: number;
  /** The withheld private item that holds these words back, once confirmed. */
  detailId?: string;
  /** days-away: the weekdays, in full ("Friday"). */
  days?: string[];
  /** contact: the adult, as a role ("father", "mother", "parents"). */
  who?: string;
  /** contact: the adult who looks after the child instead ("grandmother"). */
  guardian?: string;
  /** contact: true when the adult is not there to contact (died, left, the child lives elsewhere); absent when the adult must not be contacted. */
  away?: boolean;
  /** health: words that, in a step, go against it ("flashing lights"). */
  triggers?: string[];
  source: 'rule' | 'on-device model' | 'teacher';
  /** True when a rule found it and the on-device model found it too. */
  alsoModel?: boolean;
  confirmed: boolean;
}
