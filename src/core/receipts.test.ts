import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadReceipts, makeReceipt, storeReceipts } from './receipts';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  };
}

const sampleReceipt = () =>
  makeReceipt({
    task: 'lesson',
    label: 'Class 6 · Writing a place',
    labelWhere: 'ON_DEVICE',
    entities: [],
    guardWhere: 'ON_DEVICE',
    unreadParagraphs: 0,
    droppedDetails: 0,
    sentText: 'Approved class text with [Student 1].',
    approvedAt: '2026-11-28T00:00:00.000Z',
    draftWhere: 'IN_CLOUD',
    draftModel: 'gemini-3.5-flash-lite',
    checkWhere: 'ON_DEVICE',
    replyFlagged: false,
    checks: [{ verdict: 'fits', reason: 'Ok.' }],
    kept: 1,
    struck: 0,
  });

describe('shared-PC receipt storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults receipts to sessionStorage only and leaves localStorage clean on a fresh tab', () => {
    const session = fakeStorage();
    const local = fakeStorage();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', local);

    const receipt = sampleReceipt();
    expect(storeReceipts([receipt])).toBe(true);
    expect(session.getItem('staffroom.receipts.v1')).not.toBeNull();
    expect(local.getItem('staffroom.receipts.v1')).toBeNull();
    expect(loadReceipts()).toHaveLength(1);

    // Simulate closing the tab on a shared PC (sessionStorage wiped): next teacher sees no receipts.
    session.clear();
    expect(loadReceipts()).toEqual([]);
  });

  it('persists to localStorage only when opted in, migrates cleanly, and clears both tiers', () => {
    const session = fakeStorage();
    const local = fakeStorage();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', local);

    const receipt = sampleReceipt();
    expect(storeReceipts([receipt], true)).toBe(true);
    expect(local.getItem('staffroom.receipts.v1')).not.toBeNull();
    expect(session.getItem('staffroom.receipts.v1')).toBeNull();
    expect(loadReceipts()).toHaveLength(1);

    // Opting back out moves receipts back to sessionStorage and clears localStorage.
    expect(storeReceipts([receipt], false)).toBe(true);
    expect(session.getItem('staffroom.receipts.v1')).not.toBeNull();
    expect(local.getItem('staffroom.receipts.v1')).toBeNull();

    // Clearing wipes both storage tiers.
    storeReceipts([receipt], true);
    expect(storeReceipts([])).toBe(true);
    expect(local.getItem('staffroom.receipts.v1')).toBeNull();
    expect(session.getItem('staffroom.receipts.v1')).toBeNull();
    expect(loadReceipts()).toEqual([]);
  });

  it('preserves sessionStorage on failed opt-in migration, and always clears localStorage on opt-out', () => {
    const session = fakeStorage();
    const throwingLocal = {
      ...fakeStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', throwingLocal);

    const receipt = sampleReceipt();
    expect(storeReceipts([receipt], false)).toBe(true);
    expect(storeReceipts([receipt], true)).toBe(false);
    expect(session.getItem('staffroom.receipts.v1')).not.toBeNull();

    const local = fakeStorage();
    local.setItem('staffroom.receipts.v1', JSON.stringify([receipt]));
    const throwingSession = {
      ...fakeStorage(),
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    vi.stubGlobal('sessionStorage', throwingSession);
    vi.stubGlobal('localStorage', local);

    expect(storeReceipts([receipt], false)).toBe(false);
    expect(local.getItem('staffroom.receipts.v1')).toBeNull();
  });
});
