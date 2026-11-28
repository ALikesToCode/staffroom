import { recordNetwork } from '../core/network';
import type { Constraint } from '../core/types';
import type { LessonFields } from '../core/lesson';

export type Stage = 'write' | 'guarding' | 'review' | 'drafting' | 'checking' | 'result' | 'signed';
export type View = 'desk' | 'lessons' | 'receipts' | 'how';

// The five steps the teacher sees: Write, What leaves, Draft, What your device caught, Sign off.
export const STEP: Record<Stage, number> = { write: 0, guarding: 1, review: 1, drafting: 2, checking: 3, result: 3, signed: 5 };

export const read = <T,>(storage: () => Storage, key: string, fallback: T): T => {
  try {
    const raw = storage().getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

/** Write a value, or remove the key when the value is empty. Storage can be switched off: that is not an error. */
export const write = (storage: () => Storage, key: string, value: unknown, empty: boolean) => {
  try {
    if (empty) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do: the value stays in memory for this page only.
  }
};

// The raw note and the class list are kept for this tab only, and are gone when it closes.
// Settings and receipts (which hold only approved text) stay in local storage.
export const session = () => sessionStorage;
export const local = () => localStorage;
export const NOTE_KEY = 'staffroom.note';
export const CLASS_LIST_KEY = 'staffroom.classList';
// The constraints live with the note: in this tab only, and only for the note they were made for.
export const CONSTRAINTS_KEY = 'staffroom.constraints';
// The lines about the lesson. Nothing in them is private, and they are kept with the note.
export const LESSON_KEY = 'staffroom.lesson';
// "Keep this class on this device": the note, the class list, the constraints and the lesson lines, in local storage.
export const KEEP_CLASS_KEY = 'staffroom.keepClass';
export const CLASS_KEY = 'staffroom.class.v1';
export const SIGNOUT_BLOCKED_KEY = 'staffroom.signoutBlocked';

/** Read whether Clear desk failed to end the anonymous Auth session across tabs or reloads. */
export function readSignOutBlocked(): boolean {
  return read<boolean>(local, SIGNOUT_BLOCKED_KEY, false) || read<boolean>(session, SIGNOUT_BLOCKED_KEY, false);
}

/** Persist or clear the fail-closed signout-blocked marker across browser-wide and tab storage. */
export function writeSignOutBlocked(blocked: boolean): void {
  write(local, SIGNOUT_BLOCKED_KEY, true, !blocked);
  write(session, SIGNOUT_BLOCKED_KEY, true, !blocked);
}

export interface KeptClass {
  note: string;
  classList: string[];
  constraints: Constraint[];
  constraintsNote: string;
  lesson: LessonFields;
  /** Proposals the teacher removed, by kind and words, so the next guard run does not propose them again. */
  removed?: string[];
}

/** What the tab keeps comes first; with none, the class kept on this device, when the teacher chose to keep one. */
export const keptClass = (): KeptClass | null =>
  read<boolean>(local, KEEP_CLASS_KEY, false) === true ? read<KeptClass | null>(local, CLASS_KEY, null) : null;

/** The browser's own record of the requests this page makes, kept from the moment the app loads. Inspect reads it. */
export const network = typeof window !== 'undefined' ? recordNetwork() : null;

// Earlier versions kept the raw note and the class list in local storage. Remove what they left.
try {
  localStorage.removeItem(NOTE_KEY);
  localStorage.removeItem(CLASS_LIST_KEY);
} catch {
  // Storage is switched off, so there is nothing to remove.
}

/** Where the on-device guard fell short: pieces it did not read, things it reported that were lost or only partly found. */
export interface Gaps {
  unread: number[];
  dropped: number;
  partial: number;
}

export const NO_GAPS: Gaps = { unread: [], dropped: 0, partial: 0 };

/** The longest piece of the note that can be marked in one go. */
export const MAX_SELECTION = 600;

export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Thrown inside the check when this browser has no on-device model. It is caught there and is no error to the teacher. */
export const NO_MODEL = new Error('no on-device model was available.');
