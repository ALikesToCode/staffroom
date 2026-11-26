// The network as the browser itself records it. Every request the page makes leaves an entry in the
// browser's Resource Timing record: its address, when it started and what started it. The app keeps the
// start and end of each model step, so Inspect can say what the page requested during each one. What is
// shown is the host and the path only: never a query string, a fragment, a header or a token.

/** The host of the cloud model, for both Gemini backends of Firebase AI Logic. */
export const MODEL_HOST = 'firebasevertexai.googleapis.com';
/** The host that hands out App Check tokens. It can be asked for a fresh one at any time. */
export const APP_CHECK_HOST = 'content-firebaseappcheck.googleapis.com';

/** One request as Inspect shows it. */
export interface NetRequest {
  /** When it started, in milliseconds since the page opened (the clock of `performance.now()`). */
  at: number;
  host: string;
  /** The path, without the query string or fragment. Empty for an address that is not on the web (a data: or blob: address). */
  path: string;
  /** What started it, as the browser says: fetch, script, img, link, and so on. */
  initiator: string;
}

/** The fields of a Resource Timing entry that are read. Nothing else of it is kept. */
export type TimingEntry = Pick<PerformanceResourceTiming, 'name' | 'startTime' | 'initiatorType'>;

/** An entry as a request: host and path only. Undefined for an entry whose address cannot be read. */
export function requestOf(entry: TimingEntry): NetRequest | undefined {
  let url: URL;
  try {
    url = new URL(entry.name);
  } catch {
    return undefined;
  }
  const web = url.protocol === 'https:' || url.protocol === 'http:';
  // `host` holds no user name or password, and `pathname` no query or fragment.
  return { at: entry.startTime, host: web ? url.host : url.protocol.replace(/:$/, ''), path: web ? url.pathname : '', initiator: entry.initiatorType || 'other' };
}

/** A host as Inspect names it: the two Firebase hosts by what they are, any other by its name alone. */
export function hostLabel(host: string): string {
  if (host === MODEL_HOST) return `${host}: the cloud model`;
  if (host === APP_CHECK_HOST) return `${host}: App Check`;
  return host;
}

/** The model steps the app times. */
export type StepId = 'guard' | 'draft' | 'check' | 'fit' | 'label' | 'materials';
export const STEP_NAME: Record<StepId, string> = { guard: 'Guard', draft: 'Draft', check: 'Check', fit: 'Fit', label: 'Name the receipt', materials: 'Materials' };

/** Where a step ran, as the app knows it once the step is over. */
export type StepWhere = 'ON_DEVICE' | 'IN_CLOUD' | 'RULES_ONLY' | 'NONE';
const WHERE_SAID: Record<StepWhere, string> = { ON_DEVICE: 'on this device', IN_CLOUD: 'in the cloud', RULES_ONLY: 'rules only, no model', NONE: 'no model answered' };
/** Where a step runs when the app has not said: the three on-device routes, and the draft's route, which prefers the cloud. */
const ROUTE_WHERE: Partial<Record<StepId, StepWhere>> = { guard: 'ON_DEVICE', check: 'ON_DEVICE', fit: 'ON_DEVICE', draft: 'IN_CLOUD', materials: 'IN_CLOUD' };

/** One model step: when it started and ended, on the clock of `performance.now()`. */
export interface StepMark {
  step: StepId;
  start: number;
  end: number;
  where?: StepWhere;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A request as one line: where it went, what started it, and when. */
export const requestLine = (r: NetRequest) => `${hostLabel(r.host)}${r.path ? ` ${r.path}` : ''} (${r.initiator}, at ${seconds(r.at)})`;

export interface StepReport {
  /** "Guard (on this device): 0 requests to the model host". */
  summary: string;
  /** When it ran: "from 1.2 s to 4.0 s after the page opened". */
  when: string;
  /** The requests made while the step ran, each as one line. */
  requests: string[];
}

/**
 * What the record holds for each step: how many requests went to the
 * model host while it ran, and every request that started while it ran,
 * named by host. When two steps ran at once, a request in both is said to
 * be in both: the record cannot tell which step made it.
 */
export function stepReports(steps: readonly StepMark[], requests: readonly NetRequest[]): StepReport[] {
  const within = (s: StepMark, r: NetRequest) => r.at >= s.start && r.at <= s.end;
  return steps.map((s) => {
    const where = s.where ?? ROUTE_WHERE[s.step];
    const title = `${STEP_NAME[s.step]}${where ? ` (${WHERE_SAID[where]})` : ''}`;
    const during = requests.filter((r) => within(s, r));
    const model = during.filter((r) => r.host === MODEL_HOST);
    const others = during.length - model.length;
    const alsoIn = (r: NetRequest) => [...new Set(steps.filter((o) => o !== s && within(o, r)).map((o) => STEP_NAME[o.step]))];
    const shared = model.filter((r) => alsoIn(r).length > 0).length;
    const lines = during.map((r) => {
      const also = alsoIn(r);
      return also.length > 0 ? `${requestLine(r)}; ${also.join(' and ')} was running too, and the record cannot tell which made it` : requestLine(r);
    });
    return {
      summary: `${title}: ${count(model.length, 'request', 'requests')} to the model host${shared > 0 ? ` (${shared} while another step was running too)` : ''}${others > 0 ? `, ${count(others, 'other request', 'other requests')}` : ''}`,
      when: `from ${seconds(s.start)} to ${seconds(s.end)} after the page opened`,
      requests: lines,
    };
  });
}

/** The most requests and steps kept. The oldest go first. */
export const NET_MAX = 400;
export const STEPS_MAX = 40;

/** A request is the same entry when its address, start and starter are the same. */
const keyOf = (r: NetRequest) => `${r.host}${r.path}|${r.at}|${r.initiator}`;

/** The requests with new entries added once each, in the order they started, the newest NET_MAX. */
export function addRequests(list: readonly NetRequest[], entries: readonly TimingEntry[]): NetRequest[] {
  const seen = new Set(list.map(keyOf));
  const out = [...list];
  for (const e of entries) {
    const r = requestOf(e);
    if (!r || seen.has(keyOf(r))) continue;
    seen.add(keyOf(r));
    out.push(r);
  }
  return out.sort((a, b) => a.at - b.at).slice(-NET_MAX);
}

/** The record the page keeps, for Inspect to read while it is open. */
export interface NetworkRecord {
  list: () => readonly NetRequest[];
  subscribe: (onChange: () => void) => () => void;
}

/**
 * Start keeping the browser's record of requests: what it holds already,
 * and each new entry as the browser adds it. The page's own list is kept,
 * since the browser's buffer stops taking entries once it is full. Where
 * the browser has no such record, the list stays empty.
 */
export function recordNetwork(): NetworkRecord {
  let list: readonly NetRequest[] = [];
  const listeners = new Set<() => void>();
  const take = (entries: readonly TimingEntry[]) => {
    const next = addRequests(list, entries);
    if (next.length === list.length && next.every((r, i) => r === list[i])) return;
    list = next;
    for (const f of listeners) f();
  };
  if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
    take(performance.getEntriesByType('resource') as PerformanceResourceTiming[]);
  }
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      new PerformanceObserver((l) => take(l.getEntries() as PerformanceResourceTiming[])).observe({ type: 'resource', buffered: true });
    } catch {
      // The browser keeps no record that can be watched. What was read above stands.
    }
  }
  return {
    list: () => list,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
