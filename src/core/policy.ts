import type { Kind } from './types';

/**
 * What one approval is for: the exact outgoing text, the kinds the policy
 * keeps withheld and the model that will draft. The teacher's tick holds
 * only while all three are what they were when it was given.
 */
export function approvalKey(text: string, lockedKinds: Kind[], cloudModel: string): string {
  return JSON.stringify([text, [...lockedKinds].sort(), cloudModel]);
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
