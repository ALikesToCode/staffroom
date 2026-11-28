import type { Dispatch, SetStateAction } from 'react';
import type { Stage } from '../app/storage';
import type { Constraint, DraftItem, Entity, ItemCheck, TaskId, Where } from '../core/types';
import { detailsFor } from '../ai/check';
import { canFit, FIT_LABEL } from '../ai/fit';
import { withConstraintFacts } from '../core/constraints';
import { verdictLabel } from '../core/conflicts';
import { familyAfterRewrite } from '../core/family';
import { needsFitting, NOT_CHECKED_BY_RULE, NOT_ENGLISH, ruleSupportedLanguage, type LessonHit } from '../core/lesson';
import type { LessonNeed, Variation } from '../core/lessonNeeds';
import { namesForNeed, type ChildNote } from '../core/points';
import { stepToRewrite } from '../core/recheck';
import { RECORDED_FIT_LABEL, type RecordedFit } from '../core/recorded';
import { REPEATS_NOTE } from '../core/repeats';
import { restore } from '../core/vault';
import { Caught } from './Constraints';
import { ReadAloud } from './ReadAloud';
import { DeviceText } from './parts';

export interface ResultItemProps {
  i: number;
  item: DraftItem;
  c: ItemCheck | undefined;
  keptValue: boolean | null;
  edited: boolean;
  isLesson: boolean;
  task: TaskId;
  stage: Stage;
  replay: boolean;
  canFitHere: boolean;
  checkWhere: Where;
  rechecked: boolean;
  entities: Entity[];
  sent: {
    entities: Entity[];
    tokens: string[];
    constraints: Constraint[];
    lessonNeeds: LessonNeed[];
    language: string;
  } | null;
  variations: Variation[];
  activeNeed: string | null;
  setActiveNeed: (letter: string | null) => void;
  notesByChild: ChildNote[];
  hits: LessonHit[];
  recordedFit?: RecordedFit;
  box?: { step: string; whole: boolean; text: string; suggested?: boolean };
  setRewriting: Dispatch<SetStateAction<Record<number, { step: string; whole: boolean; text: string; suggested?: boolean }>>>;
  fitSaidValue?: string;
  repeats: boolean;
  family: ReturnType<typeof familyAfterRewrite> | null;
  replyBlocked: boolean;
  copy: (key: number, text: string) => void;
  copyLabel: (key: number, base: string) => string;
  setCopyOn: Dispatch<SetStateAction<number[]>>;
  signing: boolean;
  decide: (i: number, keep: boolean) => void;
  liveConstraints: Constraint[];
  fitting: number | null;
  fittingAll: boolean;
  fitOne: (i: number) => Promise<void>;
  startRewrite: (i: number) => void;
  saveRewrite: (i: number) => void;
  closeRewrite: (i: number) => void;
  edits: Record<number, string>;
  setFitted: Dispatch<SetStateAction<number[]>>;
  checkAgain: (nextEdits: Record<number, string>, nextOff: string[]) => void;
  offIds: string[];
}

export function ResultItem({
  i,
  item,
  c,
  keptValue,
  edited,
  isLesson,
  task,
  stage,
  replay,
  canFitHere,
  checkWhere,
  rechecked,
  entities,
  sent,
  variations,
  activeNeed,
  setActiveNeed,
  notesByChild,
  hits,
  recordedFit,
  box,
  setRewriting,
  fitSaidValue,
  repeats,
  family,
  replyBlocked,
  copy,
  copyLabel,
  setCopyOn,
  signing,
  decide,
  liveConstraints,
  fitting,
  fittingAll,
  fitOne,
  startRewrite,
  saveRewrite,
  closeRewrite,
  edits,
  setFitted,
  checkAgain,
  offIds,
}: ResultItemProps) {
  const conflict = c?.verdict === 'conflict';
  const doubt = c?.verdict === 'unsure';
  const byRuleOnly = c?.verdict === 'not checked' && (c.rules ?? 0) > 0;
  const facts = detailsFor(item, withConstraintFacts(entities, sent?.constraints ?? []));
  const factCount = facts.reduce((n, f) => n + f.details.length, 0);
  const live = stage === 'result' && !replay;
  const whole = live && (conflict || doubt) && sent ? stepToRewrite(item, sent.entities, sent.tokens, c?.matched).whole : true;
  const itemHits = isLesson ? hits.filter((h) => h.itemIndex === i) : [];

  return (
    <li
      className={['item', keptValue === null ? 'undecided' : keptValue ? 'kept' : 'struck', isLesson ? (itemHits.length > 0 ? 'needs-fit' : '') : conflict ? 'is-conflict' : doubt ? 'is-doubt' : '']
        .join(' ')
        .trim()}
    >
      <h4>
        <DeviceText text={item.heading} entities={entities} allowed={sent?.tokens} />
        {edited && <span className="edited-chip">{replay ? 'Rewritten in the recorded run' : 'Rewritten by you'}</span>}
      </h4>
      <p className="item-text">
        <DeviceText text={item.text} entities={entities} allowed={sent?.tokens} mark={conflict || (doubt && c?.constraintId) ? c?.matched : undefined} />
      </p>
      {isLesson && variations.some((v) => v.itemIndex === i) && (
        <ul className="need-lines" aria-label="For the needs you told the cloud">
          {variations
            .filter((v) => v.itemIndex === i)
            .map((v, k) => (
              <li
                key={k}
                className={activeNeed === v.need ? 'is-traced' : undefined}
                onMouseEnter={() => setActiveNeed(v.need)}
                onMouseLeave={() => setActiveNeed(null)}
              >
                <b>For Need {v.need}:</b> {v.text}
                {/* Whose need it is: known on this device only. */}
                {sent &&
                  namesForNeed(v.need, sent.lessonNeeds, notesByChild, sent.entities).map((name) => (
                    <span className="names" key={name}>
                      {name}
                    </span>
                  ))}
              </li>
            ))}
        </ul>
      )}
      {isLesson && itemHits.length > 0 && (
        <div className="verdict v-fit">
          <b>{needsFitting(itemHits)}</b>
          <span>{[...new Set(itemHits.map((h) => h.child))].join(', ')}: see above, under each name.</span>
        </div>
      )}
      {c && conflict && !isLesson && (
        <div className="verdict v-conflict">
          <b>{verdictLabel(c)}</b>
          <span>{c.reason}</span>
          {c.also && (
            <span className="also">
              {rechecked ? 'In the earlier check the on-device model also doubted this: ' : 'The on-device model also doubts this: '}
              {c.also}
            </span>
          )}
          <Caught check={c} constraint={sent?.constraints.find((x) => x.id === c.constraintId)} />
        </div>
      )}
      {c && doubt && !(isLesson && c.constraintId) && (
        <div className="verdict v-doubt">
          <b>{verdictLabel(c)}</b>
          <span>
            {c.reason}
            {rechecked && c.by === 'model' ? ' (From the earlier check.)' : ''}
          </span>
          {c.also && <span className="also">The on-device model also doubts this: {c.also}</span>}
          <Caught check={c} constraint={sent?.constraints.find((x) => x.id === c.constraintId)} />
        </div>
      )}
      {c && !conflict && !doubt && !(isLesson && itemHits.length > 0) && (
        <p className={`quiet-verdict q-${c.verdict.replace(' ', '-')}${byRuleOnly ? ' q-rule' : ''}`}>
          <b>
            {sent?.language && !ruleSupportedLanguage(sent.language)
              ? NOT_CHECKED_BY_RULE
              : edited
                ? 'Checked by rule'
                : byRuleOnly
                  ? 'No conflict found by rule'
                  : verdictLabel(c)}
          </b>{' '}
          <span>
            {sent?.language && !ruleSupportedLanguage(sent.language)
              ? NOT_ENGLISH
              : edited
                ? c.reason
                : byRuleOnly
                  ? `Compared with ${c.rules} ${c.rules === 1 ? 'constraint' : 'constraints'} you confirmed.`
                  : c.verdict === 'not checked' && checkWhere === 'RULES_ONLY'
                    ? 'No constraint you confirmed applies to this item, so no rule compared it.'
                    : `${c.reason}${rechecked && c.verdict === 'fits' ? ' (From the earlier check.)' : ''}`}
          </span>
        </p>
      )}
      {/* What the model compared the item with is said once per item, folded, and only when a model did. */}
      {c && checkWhere === 'ON_DEVICE' && c.verdict !== 'not checked' && !edited && factCount > 0 && (
        <details className="against">
          <summary>
            Checked against {factCount} distinct withheld {factCount === 1 ? 'passage' : 'passages'}, on this device only
          </summary>
          <p className="hint">Distinct note passages withheld (overlapping items grouped once).</p>
          <p>{facts.flatMap((f) => f.details.map((d) => `“${d.surfaces[0]}”`)).join(', ')}</p>
        </details>
      )}
      {edited && repeats && (
        <p className="caution repeats-note" role="status">
          {REPEATS_NOTE}
        </p>
      )}
      {fitSaidValue && live && !box && (
        <p className="caution fit-said" role="status">
          {fitSaidValue}
        </p>
      )}
      {recordedFit && (
        <div className="rewrite fit-recorded">
          <b>{RECORDED_FIT_LABEL}</b>
          <p>{recordedFit.suggestion}</p>
        </div>
      )}
      {box && live && (
        <div className="rewrite">
          <label>
            {box.whole ? 'Rewrite this item' : 'Rewrite this step'}
            {box.suggested && <span className="fit-note">{FIT_LABEL}</span>}
            <textarea
              rows={3}
              value={box.text}
              maxLength={600}
              onChange={(e) => setRewriting((r) => ({ ...r, [i]: { ...box, text: e.target.value } }))}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
            />
          </label>
          <div className="actions">
            <button className="secondary small" disabled={signing || box.text.trim().length === 0} onClick={() => saveRewrite(i)}>
              Save and check by rule
            </button>
            <button className="link" onClick={() => closeRewrite(i)}>
              Cancel
            </button>
            <span className="hint">
              {box.suggested ? 'Change it or save it as it is. Nothing changes until you save.' : 'Your words stay on this device. No model is asked.'}
            </span>
          </div>
        </div>
      )}
      {/* A message home is copied one at a time, so one family's message never travels with another's. */}
      {stage === 'signed' && task === 'parents' && keptValue === true && family && (
        <div className="copy-one">
          {family.student ? (
            <>
              <span className="for-family">For the family of {family.student.surfaces[0]}</span>
              <button className="secondary small" disabled={replyBlocked} onClick={() => copy(i, restore(item.text, entities, sent?.tokens).trim())}>
                {copyLabel(i, 'Copy')}
              </button>
              {stage === 'signed' && !replyBlocked && <ReadAloud text={restore(item.text, entities, sent?.tokens).trim()} language={sent?.language ?? ''} />}
            </>
          ) : (
            <>
              <span className="caution copy-off">{family.why}</span>
              {family.mayTurnOn && !replay && (
                <button className="secondary small" onClick={() => setCopyOn((on) => [...on, i])}>
                  Turn copy on for this message
                </button>
              )}
            </>
          )}
        </div>
      )}
      {stage === 'result' && !(box && live) && !isLesson && (
        <div className="decide" role="group" aria-label="Keep or strike this item">
          <button
            className={keptValue === true ? 'choice on' : 'choice'}
            aria-pressed={keptValue === true}
            aria-label="Keep this item"
            disabled={signing || replay}
            onClick={() => decide(i, true)}
          >
            Keep
          </button>
          <button
            className={keptValue === false ? 'choice on strike' : 'choice'}
            aria-pressed={keptValue === false}
            aria-label="Strike this item"
            disabled={signing || replay}
            onClick={() => decide(i, false)}
          >
            Strike
          </button>
          {canFitHere && canFit(c, liveConstraints) && (
            <button className="primary small" disabled={signing || fitting !== null || fittingAll} onClick={() => void fitOne(i)}>
              {fitting === i ? 'Fitting on this device…' : 'Fit this step on this device'}
            </button>
          )}
          {live && (conflict || doubt) && (
            <button className="link" disabled={signing || fitting === i} onClick={() => startRewrite(i)}>
              {whole ? 'Rewrite this item' : 'Rewrite this step'}
            </button>
          )}
          {live && edited && (
            <button
              className="link"
              disabled={signing}
              onClick={() => {
                const { [i]: _dropped, ...rest } = edits;
                setFitted((f) => f.filter((x) => x !== i));
                checkAgain(rest, offIds);
              }}
            >
              Put the cloud's words back
            </button>
          )}
          <span className="hint state">
            {keptValue === null
              ? 'Choose before you finish.'
              : conflict && keptValue === false
                ? 'Struck to begin with. Keep it only if you still want it.'
                : ''}
          </span>
        </div>
      )}
    </li>
  );
}
