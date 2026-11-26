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
    /** SHA-256 of the text, in hex. Receipts made before this was recorded do not have it. */
    sha256?: string;
    approvedAt: string;
    gate: 'passed';
  };
  draft: { where: Where; model: string; cloud?: 'no answer' | 'not reached' };
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
