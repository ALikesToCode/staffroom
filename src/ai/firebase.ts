import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, orderBy, query, setDoc } from 'firebase/firestore';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import type { Kind, Receipt } from '../core/types';
import {
  DEFAULT_POLICY,
  fallbackPolicy,
  FROM_DEFAULTS_UNPUBLISHED,
  FROM_REMOTE,
  KINDS,
  POLICY_KEY,
  readSaved,
  toSave,
  withTimeout,
  type Policy,
} from '../core/policy';
import { asReceiptRecord, receiptRecord, type ReceiptRecord } from '../core/receipts';

const env = import.meta.env;

/** True when the build was given a Firebase project. Without one, only the on-device half works. */
export const configured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);

export const app = initializeApp(
  configured
    ? {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        appId: env.VITE_FIREBASE_APP_ID,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      }
    : { apiKey: 'not-configured', projectId: 'not-configured', appId: 'not-configured' },
);

// App Check protects the Gemini API. Firebase AI Logic enforces it.
if (configured && typeof window !== 'undefined') {
  const debugToken = env.VITE_APPCHECK_DEBUG_TOKEN;
  if (debugToken) {
    (globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === 'true' ? true : debugToken;
  }
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (siteKey || debugToken) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-token-only'),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

/** Firebase AI Logic, on the Gemini Developer API. */
export const ai = getAI(app, { backend: new GoogleAIBackend() });

// ---------------------------------------------------------------- policy

export { DEFAULT_POLICY, type Policy } from '../core/policy';

/** How long the app waits for the school's policy before it goes on without it. */
export const POLICY_TIMEOUT_MS = 4000;

const savedPolicy = () => {
  try {
    return readSaved(localStorage.getItem(POLICY_KEY));
  } catch {
    return undefined;
  }
};

/**
 * The policy in force. The school's, when it loads within the timeout. If
 * it does not (no project, no network, a slow or failed fetch), the last
 * school policy this browser fetched is used, and the page says from when.
 * Only when there is none are the built-in defaults used, and then the page
 * says the school's policy could not be loaded. Approval is not offered
 * until this has settled. If the school's policy arrives after the wait, it
 * replaces the fallback from then on.
 */
export async function loadPolicy(timeoutMs = POLICY_TIMEOUT_MS, onLate?: (policy: Policy) => void): Promise<Policy> {
  if (!configured) return DEFAULT_POLICY;
  const fetching = fetchPolicy();
  let settled = false;
  // A fetch that finishes after the wait is still the school's policy: hand it over when it arrives.
  fetching.then(
    (p) => {
      if (settled) onLate?.(p);
    },
    () => {},
  );
  const fetched = await withTimeout<Policy | undefined>(fetching, timeoutMs, undefined);
  settled = true;
  return fetched ?? fallbackPolicy(savedPolicy());
}

/** Fetch the policy. Rejects when it cannot be fetched, so the caller can fall back to the one kept from before. */
async function fetchPolicy(): Promise<Policy> {
  const rc = getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 60 * 60 * 1000;
  rc.defaultConfig = {
    cloud_model: DEFAULT_POLICY.cloudModel,
    locked_kinds: DEFAULT_POLICY.lockedKinds.join(','),
  };
  await fetchAndActivate(rc);
  const locked = getValue(rc, 'locked_kinds');
  const model = getValue(rc, 'cloud_model');
  const lockedKinds = locked
    .asString()
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Kind => (KINDS as string[]).includes(s));
  // The policy counts as the school's when either value was published, not only the locks.
  const published = locked.getSource() === 'remote' || model.getSource() === 'remote';
  if (!published) return { ...DEFAULT_POLICY, from: FROM_DEFAULTS_UNPUBLISHED };
  const policy: Policy = { cloudModel: model.asString() || DEFAULT_POLICY.cloudModel, lockedKinds, origin: 'remote', from: FROM_REMOTE };
  try {
    // Kept so that a slow network next time does not quietly swap the school's locks for the defaults.
    localStorage.setItem(POLICY_KEY, toSave(policy, new Date()));
  } catch {
    // Storage is switched off. The policy is still in force for this page.
  }
  return policy;
}

// ---------------------------------------------------------------- the teacher's own record

/** Sign in without an account, so the teacher's records have an owner. */
export function watchUser(onUser: (user: User | null) => void): () => void {
  if (!configured) {
    onUser(null);
    return () => {};
  }
  const auth = getAuth(app);
  const stop = onAuthStateChanged(auth, onUser);
  const signIn = () => {
    if (!auth.currentUser) signInAnonymously(auth).catch(() => onUser(null));
  };
  signIn();
  // A sign-in that failed for want of a network is tried again when the network is back.
  window.addEventListener('online', signIn);
  return () => {
    window.removeEventListener('online', signIn);
    stop();
  };
}

/**
 * Save the record of a receipt to Firestore under the signed-in user. Only
 * the record goes: counts, times, where each step ran and the length of the
 * approved text. No text of any kind is sent, and the Firestore rules
 * refuse a document with any other field.
 */
export async function saveReceiptCopy(uid: string, receipt: Receipt): Promise<void> {
  const record: ReceiptRecord = receiptRecord(receipt);
  await setDoc(doc(getFirestore(app), 'users', uid, 'receipts', record.id), record);
}

/**
 * Read back the records kept under the signed-in user, newest first. An
 * entry that is not a record in the present form is counted, not shown.
 */
export async function loadReceiptCopies(uid: string): Promise<{ records: ReceiptRecord[]; unreadable: number }> {
  const snap = await getDocs(
    query(collection(getFirestore(app), 'users', uid, 'receipts'), orderBy('createdAt', 'desc')),
  );
  const records = snap.docs.map((d) => asReceiptRecord(d.data())).filter((r): r is ReceiptRecord => r !== undefined);
  return { records, unreadable: snap.docs.length - records.length };
}
