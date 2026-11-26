import type { ItemCheck } from '../core/types';

// Short sentences the screens say, worked out from what the code found. Plain code, so they can be tested.

/** True for an item with no conflict found: both layers ran and found nothing, or the rules alone ran and had no hit. */
const clear = (c: ItemCheck) => c.verdict === 'fits' || (c.verdict === 'not checked' && (c.rules ?? 0) > 0);

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/** How the verdicts fall: in conflict, doubted, with no conflict found, and the rest, which nothing compared. */
export function tally(checks: readonly ItemCheck[]): { conflict: number; doubt: number; clear: number; open: number } {
  const conflict = checks.filter((c) => c.verdict === 'conflict').length;
  const doubt = checks.filter((c) => c.verdict === 'unsure').length;
  const ok = checks.filter(clear).length;
  return { conflict, doubt, clear: ok, open: checks.length - conflict - doubt - ok };
}

/** The line over the result: what the device found, the conflict first. */
export function summaryLine(checks: readonly ItemCheck[]): string {
  const t = tally(checks);
  if (checks.length === 0) return '';
  if (checks.every((c) => c.verdict === 'nothing withheld')) return 'Nothing was withheld, so there was nothing to check the draft against.';
  const out: string[] = [];
  if (t.conflict > 0) out.push(`${items(t.conflict)} ${t.conflict === 1 ? 'goes' : 'go'} against a constraint you confirmed.`);
  if (t.doubt > 0) out.push(`${items(t.doubt)} to think about.`);
  if (t.clear > 0) {
    out.push(t.clear === checks.length ? `No conflict found in ${t.clear === 1 ? 'the item' : `any of the ${t.clear} items`}.` : `${items(t.clear)} had no conflict found.`);
  }
  if (t.open > 0) out.push(`${items(t.open)} ${t.open === 1 ? 'was' : 'were'} not checked.`);
  return out.join(' ');
}

/** The order the items are shown in: conflicts first, then doubts, then the rest, each group in the draft's order. */
export function resultOrder(checks: readonly (ItemCheck | undefined)[], count: number): number[] {
  const rank = (i: number) => (checks[i]?.verdict === 'conflict' ? 0 : checks[i]?.verdict === 'unsure' ? 1 : 2);
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
}

/** Why a draft was not written, in one plain sentence. The SDK's own message is never shown. */
export function draftFailure(e: unknown, online: boolean): { say: string; status?: number } {
  const err = e as { code?: unknown; customErrorData?: { status?: unknown }; message?: unknown } | null;
  const status = typeof err?.customErrorData?.status === 'number' ? err.customErrorData.status : undefined;
  const code = typeof err?.code === 'string' ? err.code : '';
  if (status === 401 || status === 403) return { say: 'The cloud refused this request, so no draft was written.', status };
  if (status === 429) return { say: 'The cloud model is over its request limit for now, so no draft was written.', status };
  if (status !== undefined && status >= 500) return { say: 'The cloud model is not answering right now, so no draft was written.', status };
  if (!online) return { say: 'This computer is offline and no on-device model was ready, so no draft was written.' };
  // The SDK wraps a failed fetch (no response at all) as a plain error whose message begins this way.
  const noResponse = typeof err?.message === 'string' && /Error fetching from/.test(err.message);
  if (status === undefined && (code.includes('fetch-error') || noResponse)) return { say: 'The cloud could not be reached, so no draft was written.' };
  if (e instanceof SyntaxError || (typeof err?.message === 'string' && err.message === 'The model returned an empty draft.')) {
    return { say: 'The reply could not be read as a draft, so there is none.', status };
  }
  return { say: 'The draft could not be written.', status };
}
