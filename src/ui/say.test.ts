import { describe, expect, it } from 'vitest';
import type { ItemCheck } from '../core/types';
import { draftFailure, resultOrder, summaryLine, tally } from './say';

const conflict: ItemCheck = { verdict: 'conflict', reason: 'r', by: 'rule', constraintId: 'a' };
const doubt: ItemCheck = { verdict: 'unsure', reason: 'r', by: 'model' };
const fits: ItemCheck = { verdict: 'fits', reason: 'r' };
const byRule: ItemCheck = { verdict: 'not checked', reason: 'r', by: 'none', rules: 2 };
const untouched: ItemCheck = { verdict: 'not checked', reason: 'r' };

describe('the line over the result', () => {
  it('names the conflict first and counts only what was found', () => {
    expect(summaryLine([byRule, conflict, byRule, untouched])).toBe(
      '1 item goes against a constraint you confirmed. 2 items had no conflict found. 1 item was not checked.',
    );
    expect(summaryLine([conflict, conflict, doubt, fits])).toBe('2 items go against a constraint you confirmed. 1 item to think about. 1 item had no conflict found.');
    expect(summaryLine([fits, fits, byRule])).toBe('No conflict found in any of the 3 items.');
    expect(summaryLine([fits])).toBe('No conflict found in the item.');
    expect(summaryLine([untouched, untouched])).toBe('2 items were not checked.');
  });

  it('never calls an item nothing compared "no conflict"', () => {
    expect(tally([untouched, byRule, fits])).toEqual({ conflict: 0, doubt: 0, clear: 2, open: 1 });
  });

  it('says so when there was nothing to check against', () => {
    const none: ItemCheck = { verdict: 'nothing withheld', reason: 'r' };
    expect(summaryLine([none, none])).toBe('Nothing was withheld, so there was nothing to check the draft against.');
    expect(summaryLine([])).toBe('');
  });
});

describe('the order of the items', () => {
  it('puts conflicts first, then doubts, then the rest in the order of the draft', () => {
    expect(resultOrder([byRule, doubt, conflict, fits, conflict], 5)).toEqual([2, 4, 1, 0, 3]);
    expect(resultOrder([], 3)).toEqual([0, 1, 2]);
  });
});

describe('why a draft was not written', () => {
  const sdk = (status?: number, code = 'AI/fetch-error', message = `Error fetching from https://example.test/v1: [${status} Forbidden] secret detail`) =>
    Object.assign(new Error(message), { code, customErrorData: status === undefined ? undefined : { status } });

  it('says a refusal, a limit and an outage in plain words, without the SDK message', () => {
    expect(draftFailure(sdk(403), true)).toEqual({ say: 'The cloud refused this request, so no draft was written.', status: 403 });
    expect(draftFailure(sdk(401), true).say).toBe('The cloud refused this request, so no draft was written.');
    expect(draftFailure(sdk(429), true).say).toBe('The cloud model is over its request limit for now, so no draft was written.');
    expect(draftFailure(sdk(503), true).say).toBe('The cloud model is not answering right now, so no draft was written.');
    for (const status of [401, 403, 429, 503, 400]) expect(draftFailure(sdk(status), true).say).not.toMatch(/example\.test|secret|Error fetching/);
  });

  it('tells a call that got no response from one made offline', () => {
    expect(draftFailure(sdk(undefined, 'AI/error', 'Error fetching from https://example.test: Failed to fetch'), true).say).toBe(
      'The cloud could not be reached, so no draft was written.',
    );
    expect(draftFailure(sdk(undefined, 'AI/error', 'Error fetching from https://example.test: Failed to fetch'), false).say).toBe(
      'This computer is offline and no on-device model was ready, so no draft was written.',
    );
  });

  it('falls back to one plain sentence for anything else', () => {
    expect(draftFailure(new Error('The model returned an empty draft.'), true).say).toBe('The reply could not be read as a draft, so there is none.');
    expect(draftFailure(new SyntaxError('Unexpected token'), true).say).toBe('The reply could not be read as a draft, so there is none.');
    expect(draftFailure('boom', true)).toEqual({ say: 'The draft could not be written.', status: undefined });
    expect(draftFailure(sdk(400), true).say).toBe('The draft could not be written.');
  });
});
