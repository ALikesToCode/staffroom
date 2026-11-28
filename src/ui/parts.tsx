import { Fragment, type ReactNode } from 'react';
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

const NEED_WIRE_RE = /^Need ([A-Z]{1,2})(?::|\s*\|)/;

function TokenBars({ text }: { text: string }) {
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
 * Text as the cloud sees it. Each stand-in is drawn as a bar that carries
 * the literal stand-in, square brackets included, so the characters on
 * screen are exactly the characters that are sent.
 *
 * When `onHoverNeed` is supplied, lines naming a Need by letter become
 * interactive so hovering illuminates the matching child row across the door.
 */
export function CloudText({
  text,
  activeNeed,
  onHoverNeed,
}: {
  text: string;
  activeNeed?: string | null;
  onHoverNeed?: (letter: string | null) => void;
}) {
  if (!onHoverNeed && activeNeed === undefined) return <TokenBars text={text} />;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const m = NEED_WIRE_RE.exec(line);
        const letter = m?.[1];
        const sep = i < lines.length - 1 ? '\n' : '';
        if (!letter) {
          return (
            <Fragment key={i}>
              <TokenBars text={line} />
              {sep}
            </Fragment>
          );
        }
        return (
          <Fragment key={i}>
            <span
              className={activeNeed === letter ? 'need-wire-line is-active' : 'need-wire-line'}
              tabIndex={0}
              onMouseEnter={() => onHoverNeed?.(letter)}
              onMouseLeave={() => onHoverNeed?.(null)}
              onFocus={() => onHoverNeed?.(letter)}
              onBlur={() => onHoverNeed?.(null)}
            >
              <TokenBars text={line} />
            </span>
            {sep}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * Text as the teacher sees it on the device: real names put back, lightly
 * marked. Only a stand-in that was in the approved text (`allowed`) is
 * turned back into a name. Any other is shown as it came, marked unknown,
 * even if the vault happens to hold one that reads the same.
 *
 * `mark`: words to highlight where they first stand in the text as it is
 * read here, names put back. They are the words a rule matched.
 */
export function DeviceText({ text, entities, allowed, mark }: { text: string; entities: Entity[]; allowed?: readonly string[]; mark?: string }) {
  const byToken = new Map(entities.filter((e) => e.kind !== 'private').map((e) => [e.token, e]));
  const parts: { text: string; token?: string; known?: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    const e = !allowed || allowed.includes(m[0]) ? byToken.get(m[0]) : undefined;
    parts.push({ text: e ? e.surfaces[0] : m[0], token: m[0], known: Boolean(e) });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });

  const read = parts.map((p) => p.text).join('');
  const from = mark ? read.toLowerCase().indexOf(mark.toLowerCase()) : -1;
  const to = from < 0 ? -1 : from + mark!.length;
  const out: ReactNode[] = [];
  let start = 0;
  parts.forEach((p, i) => {
    const end = start + p.text.length;
    // The piece of this part that lies inside the matched words, if any.
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    const pieces: ReactNode[] =
      from >= 0 && a < b
        ? [
            p.text.slice(0, a - start),
            <mark className="hit" key="hit">
              {p.text.slice(a - start, b - start)}
            </mark>,
            p.text.slice(b - start),
          ]
        : [p.text];
    if (!p.token) out.push(<Fragment key={i}>{pieces}</Fragment>);
    else if (p.known) {
      out.push(
        <span className="restored" key={i} title={`The cloud saw ${p.token}`}>
          {pieces}
        </span>,
      );
    } else {
      out.push(
        <span className="unknown-token" key={i} title="This stand-in was not in the text you approved, so no name is put back">
          {pieces}
        </span>,
      );
    }
    start = end;
  });
  return <>{out}</>;
}

const WHERE_TEXT: Record<Where, string> = {
  ON_DEVICE: 'On this computer',
  IN_CLOUD: 'Sent to the cloud',
  RULES_ONLY: 'Rules only, no local model',
  NOT_RUN: 'Did not run',
  SKIPPED: 'Skipped: nothing to check',
};

/** Shows plain location first, with the Firebase AI Logic mode small and muted beside it. */
export function RouteChip({ route, where }: { route: RouteId; where?: Where }) {
  const r = ROUTES.find((x) => x.id === route)!;
  return (
    <span className={`route ${where ? `route-${where.toLowerCase()}` : ''}`} title={r.why}>
      {where && <span>{WHERE_TEXT[where]}</span>}
      <code className="route-mode">{r.mode.toUpperCase()}</code>
    </span>
  );
}

/** The steps of a run, as the teacher meets them. */
export const STEPS = ['Write', 'Check what leaves', 'Draft', 'Checked here', 'Finish'];
/** The same five, as a lesson meets them. */
export const LESSON_STEPS = ['Write', 'Check what leaves', 'Lesson', 'For each child', 'Finish'];

export function Stepper({ step, lesson = false, onStep }: { step: number; lesson?: boolean; onStep?: (index: number) => void }) {
  const steps = lesson ? LESSON_STEPS : STEPS;
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
          {onStep ? (
            <button type="button" className="step-btn" onClick={() => onStep(i)}>
              <span className="n">{i + 1}</span>
              {s}
            </button>
          ) : (
            <>
              <span className="n">{i + 1}</span>
              {s}
            </>
          )}
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
