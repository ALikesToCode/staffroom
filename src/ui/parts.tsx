import type { ReactNode } from 'react';
import type { Entity, Kind, Where } from '../core/types';
import { PRIVATE_TOKEN, TOKEN_RE } from '../core/vault';
import { ROUTES, type RouteId } from '../ai/routes';

export const KIND_LABEL: Record<Kind, string> = {
  student: 'Student',
  adult: 'Adult',
  place: 'Place',
  contact: 'Contact detail',
  id: 'Identity number',
  private: 'Private detail',
};

const ANY_TOKEN = new RegExp(`${TOKEN_RE.source}|${PRIVATE_TOKEN.replace(/[[\]]/g, '\\$&')}`, 'g');

/** Text as the cloud sees it: stand-ins drawn as redaction bars. */
export function CloudText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(ANY_TOKEN)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(
      <span className="bar" key={m.index}>
        {m[0].slice(1, -1)}
      </span>,
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** Text as the teacher sees it on the device: real names put back, lightly marked. */
export function DeviceText({ text, entities }: { text: string; entities: Entity[] }) {
  const byToken = new Map(entities.map((e) => [e.token, e]));
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const e = byToken.get(m[0]);
    out.push(
      e ? (
        <span className="restored" key={m.index} title={`The cloud saw ${m[0]}`}>
          {e.surfaces[0]}
        </span>
      ) : (
        <span className="unknown-token" key={m.index} title="This stand-in is not in your vault">
          {m[0]}
        </span>
      ),
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

const WHERE_TEXT: Record<Where, string> = {
  ON_DEVICE: 'ran on this device',
  IN_CLOUD: 'ran in the cloud',
  RULES_ONLY: 'rules only, no model',
  NOT_RUN: 'did not run',
  SKIPPED: 'skipped: nothing to check',
};

/** Shows which inference mode a step was given, and where it actually ran. */
export function RouteChip({ route, where }: { route: RouteId; where?: Where }) {
  const r = ROUTES.find((x) => x.id === route)!;
  return (
    <span className={`route ${where ? `route-${where.toLowerCase()}` : ''}`} title={r.why}>
      <code>{r.mode.toUpperCase()}</code>
      {where && <span>{WHERE_TEXT[where]}</span>}
    </span>
  );
}

export function Stepper({ step }: { step: number }) {
  const steps = ['Write', 'Guard', 'Approve', 'Draft', 'Check', 'Sign off'];
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
          <span className="n">{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="working" role="status">
      <span className="dot" />
      {label}
    </p>
  );
}
