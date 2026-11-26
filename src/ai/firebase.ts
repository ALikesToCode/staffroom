import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, orderBy, query, setDoc } from 'firebase/firestore';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import type { Kind, Receipt } from '../core/types';
import { receiptRecord, type ReceiptRecord } from '../core/receipts';

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

/**
 * A setting the school publishes through Remote Config. It is enforced in
 * the app, on the teacher's device: it is a default the school chooses, not
 * a security control.
 */
export interface Policy {
  /** The cloud model that drafts. */
  cloudModel: string;
  /** Kinds of item the app will not let a teacher release to the cloud. */
  lockedKinds: Kind[];
  /** Where these values came from. */
  from: 'school policy (Remote Config)' | 'built-in defaults';
}

export const DEFAULT_POLICY: Policy = {
  cloudModel: 'gemini-3.5-flash-lite',
  lockedKinds: ['contact', 'id'],
  from: 'built-in defaults',
};

const KINDS: Kind[] = ['student', 'adult', 'place', 'contact', 'id', 'private'];

export async function loadPolicy(): Promise<Policy> {
  if (!configured) return DEFAULT_POLICY;
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 60 * 60 * 1000;
    rc.defaultConfig = {
      cloud_model: DEFAULT_POLICY.cloudModel,
      locked_kinds: DEFAULT_POLICY.lockedKinds.join(','),
    };
    await fetchAndActivate(rc);
    const locked = getValue(rc, 'locked_kinds');
    const lockedKinds = locked
      .asString()
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is Kind => (KINDS as string[]).includes(s));
    return {
      cloudModel: getValue(rc, 'cloud_model').asString() || DEFAULT_POLICY.cloudModel,
      lockedKinds,
      from: locked.getSource() === 'remote' ? 'school policy (Remote Config)' : 'built-in defaults',
    };
  } catch {
    return DEFAULT_POLICY;
  }
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
  signInAnonymously(auth).catch(() => onUser(null));
  return stop;
}

/**
 * Save the record of a receipt to Firestore under the signed-in user. Only
 * the record goes: counts, times, where each step ran and a digest of the
 * approved text. No text of any kind is sent, and the Firestore rules
 * refuse a document with any other field.
 */
export async function saveReceiptCopy(uid: string, receipt: Receipt): Promise<void> {
  const record: ReceiptRecord = await receiptRecord(receipt);
  await setDoc(doc(getFirestore(app), 'users', uid, 'receipts', record.id), record);
}

export async function loadReceiptCopies(uid: string): Promise<ReceiptRecord[]> {
  const snap = await getDocs(
    query(collection(getFirestore(app), 'users', uid, 'receipts'), orderBy('createdAt', 'desc')),
  );
  return snap.docs.map((d) => d.data() as ReceiptRecord);
}
