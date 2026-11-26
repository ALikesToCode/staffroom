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

/**
 * Text as the cloud sees it. Each stand-in is drawn as a bar that carries
 * the literal stand-in, square brackets included, so the characters on
 * screen are exactly the characters that are sent.
 */
export function CloudText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(ANY_TOKEN)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(
      <span className="bar" key={m.index}>
        {m[0]}
      </span>,
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/**
 * Text as the teacher sees it on the device: real names put back, lightly
 * marked. Only a stand-in that was in the approved text (`allowed`) is
 * turned back into a name. Any other is shown as it came, marked unknown,
 * even if the vault happens to hold one that reads the same.
 */
export function DeviceText({ text, entities, allowed }: { text: string; entities: Entity[]; allowed?: readonly string[] }) {
  const byToken = new Map(entities.filter((e) => e.kind !== 'private').map((e) => [e.token, e]));
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const e = !allowed || allowed.includes(m[0]) ? byToken.get(m[0]) : undefined;
    out.push(
      e ? (
        <span className="restored" key={m.index} title={`The cloud saw ${m[0]}`}>
          {e.surfaces[0]}
        </span>
      ) : (
        <span className="unknown-token" key={m.index} title="This stand-in was not in the text you approved, so no name is put back">
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
