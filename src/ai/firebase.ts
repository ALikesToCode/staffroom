import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, orderBy, query, setDoc } from 'firebase/firestore';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import type { Kind, Receipt } from '../core/types';

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
if (configured) {
  const debugToken = env.VITE_APPCHECK_DEBUG_TOKEN;
  if (debugToken) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
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

/** What the school sets remotely. The teacher cannot change it. */
export interface Policy {
  /** The cloud model that drafts. */
  cloudModel: string;
  /** Kinds of item a teacher may never release to the cloud. */
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

// ---------------------------------------------------------------- audit copies

/** Sign in without an account, so audit copies have an owner. */
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
 * Save a receipt to Firestore under the signed-in user. A receipt holds the
 * text that was already sent and the counts of what was withheld. It never
 * holds the note, the vault or the restored draft.
 */
export async function saveReceiptCopy(uid: string, receipt: Receipt): Promise<void> {
  await setDoc(doc(getFirestore(app), 'users', uid, 'receipts', receipt.id), receipt);
}

export async function loadReceiptCopies(uid: string): Promise<Receipt[]> {
  const snap = await getDocs(
    query(collection(getFirestore(app), 'users', uid, 'receipts'), orderBy('createdAt', 'desc')),
  );
  return snap.docs.map((d) => d.data() as Receipt);
}
