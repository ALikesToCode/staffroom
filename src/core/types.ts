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
 * means there was nothing to check the item against. 'not checked' means no
 * on-device model was available.
 */
export type Verdict = 'fits' | 'conflict' | 'unsure' | 'nothing withheld' | 'not checked';

export interface ItemCheck {
  verdict: Verdict;
  reason: string;
}

export type Where = 'ON_DEVICE' | 'IN_CLOUD' | 'RULES_ONLY' | 'NOT_RUN';

/** The audit record of one run. It holds no vault contents. */
export interface Receipt {
  id: string;
  createdAt: string;
  task: TaskId;
  label: string;
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
    approvedAt: string;
    gate: 'passed';
  };
  draft: { where: Where; model: string };
  check: {
    where: Where;
    replyGate: 'passed' | 'flagged';
    fits: number;
    conflict: number;
    unsure: number;
    nothingWithheld: number;
    notChecked: number;
  };
  signOff: { kept: number; struck: number; at: string };
}
