import type { Kind } from './types';

/**
 * What one approval is for: the exact outgoing text, the kinds the policy
 * keeps withheld and the model that will draft. The teacher's tick holds
 * only while all three are what they were when it was given.
 *
 * `asWritten` marks the second tick, asked for when nothing at all is
 * withheld: "I am sending my note as written". It is a different key, so
 * the ordinary tick can never stand in for it.
 */
export function approvalKey(text: string, lockedKinds: Kind[], cloudModel: string, asWritten = false): string {
  return JSON.stringify([text, [...lockedKinds].sort(), cloudModel, asWritten]);
}

/** Wait for a value for at most `ms`. After that, or if it fails, use the fallback. Never rejects. */
export function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

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
  /**
   * Where these values came from: fetched just now, kept from the last time
   * they were fetched, or the app's own defaults.
   */
  origin: 'remote' | 'saved' | 'defaults';
  /** The same, in words for the teacher. */
  from: string;
}

export const FROM_REMOTE = 'school policy (Remote Config)';
export const FROM_DEFAULTS_UNLOADED = 'built-in defaults, school policy could not be loaded';
export const FROM_DEFAULTS_UNPUBLISHED = 'built-in defaults, no school policy is published';

/** The policy when the school's could not be loaded and none was kept from before. */
export const DEFAULT_POLICY: Policy = {
  cloudModel: 'gemini-3.5-flash-lite',
  lockedKinds: ['contact', 'id'],
  origin: 'defaults',
  from: FROM_DEFAULTS_UNLOADED,
};

export const KINDS: Kind[] = ['student', 'adult', 'place', 'contact', 'id', 'private'];

/** Where the last school policy that was fetched is kept, in this browser. It holds two settings and a date. */
export const POLICY_KEY = 'staffroom.policy';

/** The last school policy fetched, as it is kept in this browser. */
export interface SavedPolicy {
  cloudModel: string;
  lockedKinds: Kind[];
  /** When it was fetched, as an ISO time. */
  loadedAt: string;
}

/** What to keep of a policy that was just fetched from the school. */
export function toSave(policy: Policy, now: Date): string {
  const saved: SavedPolicy = { cloudModel: policy.cloudModel, lockedKinds: policy.lockedKinds, loadedAt: now.toISOString() };
  return JSON.stringify(saved);
}

/**
 * Read a kept policy. Whatever is in storage is checked field by field, and
 * anything that is not a policy in the present form is ignored, so a
 * damaged or tampered entry can never unlock a kind or name a model.
 */
export function readSaved(raw: string | null | undefined): SavedPolicy | undefined {
  if (!raw) return undefined;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!d || typeof d !== 'object') return undefined;
  const { cloudModel, lockedKinds, loadedAt } = d as Record<string, unknown>;
  if (typeof cloudModel !== 'string' || !/^[A-Za-z0-9._-]{1,60}$/.test(cloudModel)) return undefined;
  if (!Array.isArray(lockedKinds) || !lockedKinds.every((k) => (KINDS as unknown[]).includes(k))) return undefined;
  if (typeof loadedAt !== 'string' || Number.isNaN(Date.parse(loadedAt))) return undefined;
  return { cloudModel, lockedKinds: [...new Set(lockedKinds as Kind[])], loadedAt };
}

/**
 * The policy to use when the school's did not load in time: the last one
 * that did, if this browser kept it, and the built-in defaults if not.
 */
export function fallbackPolicy(saved: SavedPolicy | undefined): Policy {
  if (!saved) return DEFAULT_POLICY;
  const date = new Date(saved.loadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return { cloudModel: saved.cloudModel, lockedKinds: saved.lockedKinds, origin: 'saved', from: `school policy, last loaded ${date}` };
}
