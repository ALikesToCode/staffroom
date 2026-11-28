import { describe, expect, it } from 'vitest';
import { addRequests, APP_CHECK_HOST, hostLabel, MODEL_HOST, NET_MAX, requestLine, requestOf, stepReports, type StepMark, type TimingEntry } from './network';

const entry = (name: string, startTime: number, initiatorType = 'fetch'): TimingEntry => ({ name, startTime, initiatorType });
const model = (at: number) => entry(`https://${MODEL_HOST}/v1beta/projects/p/models/m:generateContent?key=SECRET#x`, at);
const appCheck = (at: number) => entry(`https://${APP_CHECK_HOST}/v1/projects/p/apps/a:exchangeRecaptchaEnterpriseToken?key=SECRET`, at);

describe('the network as the browser records it', () => {
  it('keeps the host and the path of a request, and never its query string, fragment or user name', () => {
    expect(requestOf(model(1200))).toEqual({ at: 1200, host: MODEL_HOST, path: '/v1beta/projects/p/models/m:generateContent', initiator: 'fetch' });
    expect(requestOf(entry('https://user:pw@example.org:8443/a/b?token=1', 5, 'img'))).toEqual({ at: 5, host: 'example.org:8443', path: '/a/b', initiator: 'img' });
    // An address that is not on the web shows its scheme and nothing of what it holds.
    expect(requestOf(entry('data:image/png;base64,AAAA', 9, ''))).toEqual({ at: 9, host: 'data', path: '', initiator: 'other' });
    expect(requestOf(entry('not a url', 1))).toBeUndefined();
    const shown = addRequests([], [model(1), appCheck(2), entry('https://example.org/?q=1', 3)]).map(requestLine).join('\n');
    expect(shown).not.toMatch(/SECRET|\?|#|key=/);
  });

  it('names the model host and App Check by what they are, and any other host by its name', () => {
    expect(hostLabel(MODEL_HOST)).toBe('firebasevertexai.googleapis.com: the cloud model');
    expect(hostLabel(APP_CHECK_HOST)).toBe('content-firebaseappcheck.googleapis.com: App Check');
    expect(hostLabel('www.gstatic.com')).toBe('www.gstatic.com');
  });

  it('adds each entry once, in the order the requests started, and keeps the newest', () => {
    const first = addRequests([], [appCheck(20), model(10)]);
    expect(first.map((r) => r.at)).toEqual([10, 20]);
    expect(addRequests(first, [model(10), model(30)]).map((r) => r.at)).toEqual([10, 20, 30]);
    const many = addRequests([], Array.from({ length: NET_MAX + 5 }, (_, i) => entry(`https://example.org/${i}`, i)));
    expect(many).toHaveLength(NET_MAX);
    expect(many[0].at).toBe(5);
  });

  it('says, for an on-device step, how many requests went to the model host while it ran, and lists every other one', () => {
    const steps: StepMark[] = [
      { step: 'guard', start: 1000, end: 4000, where: 'ON_DEVICE' },
      { step: 'draft', start: 5000, end: 9000 },
    ];
    const requests = addRequests([], [entry('https://example.org/app.js', 500, 'script'), appCheck(2000), model(5100)]);
    const [guard, draft] = stepReports(steps, requests);
    expect(guard.summary).toBe('Guard (on this device): 0 requests to the model host, 1 other request');
    expect(guard.when).toBe('from 1.0 s to 4.0 s after the page opened');
    expect(guard.requests).toEqual(['content-firebaseappcheck.googleapis.com: App Check /v1/projects/p/apps/a:exchangeRecaptchaEnterpriseToken (fetch, at 2.0 s)']);
    expect(draft.summary).toBe('Draft (in the cloud): 1 request to the model host');
    expect(stepReports([{ step: 'check', start: 0, end: 10 }], [])[0].summary).toBe('Check (on this device): 0 requests to the model host');
    expect(stepReports([{ step: 'guard', start: 0, end: 10, where: 'RULES_ONLY' }], [])[0].summary).toBe('Guard (rules only, no model): 0 requests to the model host');
  });

  it('says so when two steps ran at once, since the record cannot tell which made a request', () => {
    const steps: StepMark[] = [
      { step: 'fit', start: 1000, end: 3000 },
      { step: 'label', start: 2000, end: 2500, where: 'IN_CLOUD' },
    ];
    const [fit, label] = stepReports(steps, addRequests([], [model(2100)]));
    expect(fit.summary).toBe('Fit (on this device): 1 request to the model host (1 while another step was running too)');
    expect(fit.requests[0]).toMatch(/Name the saved record was running too, and the record cannot tell which made it$/);
    expect(label.requests[0]).toMatch(/Fit was running too/);
  });
});
