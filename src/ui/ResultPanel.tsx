import type { ReactNode } from 'react';
import type { Stage, View } from '../app/storage';
import type { DraftResult, MaterialsResult } from '../ai/draft';
import type { DeviceStatus } from '../ai/routes';
import type { Violation } from '../core/gate';
import {
  HINDI_RULE_ONLY,
  lessonMinutes,
  NOT_ENGLISH,
  ruleSupportedLanguage,
  type Adjustments,
  type LessonFields,
  type LessonHit,
  type SavedAdjustment,
} from '../core/lesson';
import { needOutcomes, needsAccount, type LessonNeed, type Variation } from '../core/lessonNeeds';
import type { Materials } from '../core/materials';
import { fitSummary, type ChildNote, type Point } from '../core/points';
import type { Constraint, Draft, Entity, ItemCheck, TaskId, Where } from '../core/types';
import { restore } from '../core/vault';
import { ChildSections, ForTheseChildren, type HitActions, type PointActions } from './Lesson';
import { MaterialsCard } from './Materials';
import { CopyPreview } from './PrintPreview';
import { ReadAloud } from './ReadAloud';
import { Spinner } from './parts';
import { summaryLine } from './say';

export interface ResultPanelProps {
  stage: Stage;
  progress: string;
  result: DraftResult | null;
  draft: Draft | null;
  sent: {
    entities: Entity[];
    tokens: string[];
    constraints: Constraint[];
    lessonNeeds: LessonNeed[];
    language: string;
  } | null;
  isLesson: boolean;
  needsReply: { section: string; none: string[]; missing: string[]; second: string | null } | null;
  variations: Variation[];
  needNames: (letter: string) => string[];
  entities: Entity[];
  notesByChild: ChildNote[];
  pointsSuggested: number;
  shownPoints: Point[];
  hits: LessonHit[];
  checks: ItemCheck[];
  fittingLive: boolean;
  toFit: boolean;
  fittingLesson: boolean;
  fitLesson: () => Promise<void>;
  fitChild: { id: string; done: number; total: number } | null;
  offered: number;
  acceptAll: () => void;
  device: DeviceStatus;
  stageList: { name: string }[];
  shownAdj: Adjustments;
  adjBusy: string | null;
  adjNotes: Record<string, string>;
  childSaid: Record<string, string>;
  replay: boolean;
  hitActions: HitActions;
  pointActions: PointActions;
  activeNeed: string | null;
  setActiveNeed: (letter: string | null) => void;
  canFitHere: boolean;
  fittable: number[];
  fittingAll: boolean;
  fitting: number | null;
  fitAll: () => Promise<void>;
  signing: boolean;
  kept: (boolean | null)[];
  keptCount: number;
  storeFailed: boolean;
  setView: (v: View) => void;
  task: TaskId;
  copy: (key: 'all' | number, text: string) => void;
  copyLabel: (key: 'all' | number, base: string) => string;
  classPlan: string;
  finalText: string;
  replyBlocked: boolean;
  previewOpen: boolean;
  setPreviewOpen: (fn: (o: boolean) => boolean) => void;
  canPrint: boolean;
  printSheet: (kind: 'class-only' | 'teacher-only' | 'materials' | 'materials-no-names') => void;
  startOver: () => void;
  copied: { ok: boolean } | null;
  copyState: 'idle' | 'pending' | 'saved' | 'failed';
  online: boolean;
  rechecked: boolean;
  replyIssues: Violation[];
  checkWhere: Where;
  checkRequests: { asked: number; failed: number } | null;
  flagged: number[];
  unflagged: number[];
  resultItem: (i: number) => ReactNode;
  offIds: string[];
  switchConstraint: (id: string, on: boolean) => void;
  acceptedNow: SavedAdjustment[];
  lesson: LessonFields;
  capture: boolean;
  downloadRun: () => void;
  leaveReplay: () => void;
  materials: (MaterialsResult & { text: string; issues: Violation[]; materials: Materials }) | null;
  materialsRequest: string;
  materialsStopped: Violation[];
  materialsBusy: boolean;
  materialsStreamChars: number;
  materialsFail: string | null;
  makeMaterials: () => Promise<void>;
  printMaterials: (withNames: boolean) => void;
}

export function ResultPanel({
  stage,
  progress,
  result,
  draft,
  sent,
  isLesson,
  needsReply,
  variations,
  needNames,
  entities,
  notesByChild,
  pointsSuggested,
  shownPoints,
  hits,
  checks,
  fittingLive,
  toFit,
  fittingLesson,
  fitLesson,
  fitChild,
  offered,
  acceptAll,
  device,
  stageList,
  shownAdj,
  adjBusy,
  adjNotes,
  childSaid,
  replay,
  hitActions,
  pointActions,
  activeNeed,
  setActiveNeed,
  canFitHere,
  fittable,
  fittingAll,
  fitting,
  fitAll,
  signing,
  kept,
  keptCount,
  storeFailed,
  setView,
  task,
  copy,
  copyLabel,
  classPlan,
  finalText,
  replyBlocked,
  previewOpen,
  setPreviewOpen,
  canPrint,
  printSheet,
  startOver,
  copied,
  copyState,
  online,
  rechecked,
  replyIssues,
  checkWhere,
  checkRequests,
  flagged,
  unflagged,
  resultItem,
  offIds,
  switchConstraint,
  acceptedNow,
  lesson,
  capture,
  downloadRun,
  leaveReplay,
  materials,
  materialsRequest,
  materialsStopped,
  materialsBusy,
  materialsStreamChars,
  materialsFail,
  makeMaterials,
  printMaterials,
}: ResultPanelProps) {
  return (
    <>
      {stage === 'checking' && (
        <article className="card">
          <Spinner label={progress} />
        </article>
      )}

      {(stage === 'result' || stage === 'signed') && result && draft && (
        <article className="card result">
          {sent?.language && (
            <p className="caution" role="status">
              {ruleSupportedLanguage(sent.language) ? HINDI_RULE_ONLY : NOT_ENGLISH}
            </p>
          )}
          {isLesson && needsReply && sent && sent.lessonNeeds.length > 0 && (
            <p className="hint">{needsAccount(needOutcomes(sent.lessonNeeds.map((n) => n.letter), variations, needsReply.none))}.</p>
          )}
          {isLesson && needsReply && needsReply.none.length > 0 && (
            <p className="hint">
              {result.where === 'ON_DEVICE' ? 'The on-device draft' : 'The cloud'} says this lesson already suits{' '}
              {needsReply.none.map((l) => `Need ${l}${needNames(l).length > 0 ? ` (${needNames(l).join(', ')})` : ''}`).join('; ')}. Read it
              against what you know.
            </p>
          )}
          <h3 className="summary">{restore(draft.title, entities, sent?.tokens)}</h3>
          <p className="result-sub">
            {isLesson
              ? fitSummary(
                  notesByChild.length,
                  replay ? shownPoints.filter((p) => p.source === 'model' && !p.need).length : pointsSuggested,
                  hits,
                  shownPoints,
                  result?.where === 'ON_DEVICE',
                )
              : summaryLine(checks)}
          </p>
          {isLesson && fittingLive && (notesByChild.length > 0 || hits.length > 0) && (
            <div className="actions fit-all">
              {(toFit || fittingLesson) && (
                <button className="secondary" disabled={signing || adjBusy !== null || fittingLesson} onClick={() => void fitLesson()}>
                  {fitChild
                    ? `Fitting for ${fitChild.done} of ${fitChild.total} ${fitChild.total === 1 ? 'child' : 'children'}…`
                    : fittingLesson
                      ? 'Checking on this computer…'
                      : 'Suggest fits on this computer'}
                </button>
              )}
              {offered > 1 && (
                <button className="secondary small" disabled={signing} onClick={acceptAll}>
                  Accept all {offered}
                </button>
              )}
              <span className="hint">
                {variations.length > 0
                  ? result.where === 'ON_DEVICE'
                    ? 'This device wrote each line for a need, not for a child, and put it beside the child. Nothing lands until you accept it.'
                    : 'The cloud wrote each line for a need, not for a child. This device put it beside the child. Nothing lands until you accept it.'
                  : device === 'available'
                    ? 'Write what a child needs, or ask this device for more ideas under a name. Nothing is sent, and nothing lands until you accept it.'
                    : 'No on-device model here. Write what a child needs yourself; a step that goes against a constraint gets starter wording by rule. Nothing lands until you accept it.'}
              </span>
            </div>
          )}
          {isLesson && stage === 'result' && (notesByChild.length > 0 || hits.length > 0) && (
            <ChildSections
              notes={notesByChild}
              stages={stageList.map((x) => x.name)}
              hits={hits}
              adjustments={shownAdj}
              points={shownPoints}
              live={fittingLive}
              canModel={device === 'available'}
              busyKey={adjBusy}
              busyChild={fitChild?.id ?? null}
              hitNotes={adjNotes}
              said={childSaid}
              recorded={replay}
              onDevice={result?.where === 'ON_DEVICE'}
              hitActions={hitActions}
              pointActions={pointActions}
              activeNeed={activeNeed}
              onHoverNeed={setActiveNeed}
            />
          )}
          {canFitHere && (fittable.length > 1 || fittingAll) && (
            <div className="actions fit-all">
              <button className="primary small" disabled={signing || fitting !== null || fittingAll} onClick={() => void fitAll()}>
                {fittingAll ? 'Fitting on this device…' : `Fit all ${fittable.length} conflicts on this device`}
              </button>
              <span className="hint">One after another. Each suggestion waits for you to save it.</span>
            </div>
          )}
          {!replay && stage === 'signed' && (
            <div className="signed">
              <span className="stamp">{keptCount === 0 ? 'Whole draft rejected by teacher' : 'Finished by teacher'}</span>
              {storeFailed ? (
                <p className="caution" role="alert">
                  This browser could not store the record. Copy what you need before you leave this page.
                </p>
              ) : (
                <p className="receipt-line">
                  Record saved.{' '}
                  <button className="link" onClick={() => setView('receipts')}>
                    See the record
                  </button>
                </p>
              )}
              <div className="actions">
                {canPrint && isLesson && (
                  <>
                    <button className="primary big" onClick={() => printSheet('class-only')}>
                      Print class copy (no names)
                      <span className="btn-hi" aria-hidden="true">
                        कक्षा की कॉपी प्रिंट करें
                      </span>
                    </button>
                    <button className="secondary" onClick={() => printSheet('teacher-only')}>
                      Print teacher&apos;s copy (private)
                    </button>
                  </>
                )}
                {keptCount > 0 && task !== 'parents' && (
                  <button className={isLesson && canPrint ? 'link' : 'primary big'} onClick={() => copy('all', isLesson ? classPlan : finalText)} disabled={replyBlocked}>
                    {copyLabel('all', isLesson ? 'Copy the class plan' : 'Copy the text')}
                  </button>
                )}
                {keptCount > 0 && isLesson && (
                  <button className="link" onClick={() => setPreviewOpen((o) => !o)}>
                    {previewOpen ? 'Hide copy preview' : 'Preview class & teacher copies'}
                  </button>
                )}
                {keptCount > 0 && isLesson && !replyBlocked && <ReadAloud text={classPlan} language={sent?.language ?? ''} />}
                {isLesson && (
                  <button className="link" onClick={() => setView('lessons')}>
                    Lessons
                  </button>
                )}
                {canPrint && !isLesson && (
                  <button className="secondary" onClick={() => window.print()}>
                    Print
                  </button>
                )}
                <button className="link" onClick={startOver}>
                  Start again
                </button>
              </div>
              {isLesson && keptCount > 0 && (
                <p className="hint">On a shared printer, print the class copy (no names) separately from your private teacher copy.</p>
              )}
              {keptCount === 0 ? (
                <p className="hint">You kept no item, so there is nothing to copy.</p>
              ) : (
                task === 'parents' && <p className="hint">Each message is copied on its own, and printed on its own page, for one family at a time.</p>
              )}
              {copied && !copied.ok && (
                <p className="caution" role="alert">
                  Could not copy. Your browser did not allow it: select the text and copy it by hand.
                </p>
              )}
              {copyState === 'pending' && (
                <p className="hint">
                  {online ? 'Saving the record to your account.' : 'The record will be saved when the network is back. Keep this tab open.'}
                </p>
              )}
              {copyState === 'saved' && <p className="hint">The receipt's record (no text) was written to your account by this browser.</p>}
              {copyState === 'failed' && (
                <p className="caution">The record could not be saved to your account. The receipt is still kept in this browser.</p>
              )}
            </div>
          )}
          {rechecked && (
            <p className="again" role="status">
              Checked again on this device. Nothing was sent.
            </p>
          )}
          {replyIssues.length > 0 && (
            <p className="caution">
              The return gate flagged this draft.{' '}
              {replyIssues.some((v) => !v.say) &&
                `${replyIssues
                  .filter((v) => !v.say)
                  .map((v) => `“${v.what}” (${v.why})`)
                  .join('; ')}. `}
              {replyIssues
                .filter((v) => v.say)
                .map((v) => `${v.say} `)
                .join('')}
              You cannot sign off or copy it until you tick that you have read it.
            </p>
          )}
          {checkWhere === 'SKIPPED' && <p className="hint">No private detail was withheld, so no model was asked.</p>}
          {checkWhere === 'NOT_RUN' && (
            <p className="caution">
              {checkRequests && checkRequests.asked > 0
                ? `The on-device check could not run: all ${checkRequests.asked} of its requests to the on-device model failed.`
                : 'The on-device check did not run.'}{' '}
              This draft was not checked against what was withheld. Read each item against the private details yourself.
            </p>
          )}
          {checkWhere === 'ON_DEVICE' && checkRequests && checkRequests.failed > 0 && (
            <p className="caution">
              The on-device check ran only in part: {checkRequests.failed} of its {checkRequests.asked} requests failed. The items it could not
              check say so. Read those against the private details yourself.
            </p>
          )}

          {/* What the device caught comes first: conflicts, then doubts. The rest follow the constraints. */}
          {flagged.length > 0 && <ol className="items">{flagged.map(resultItem)}</ol>}
          {sent && sent.constraints.some((c) => c.confirmed) && (
            <div className="strip" role="group" aria-label="Constraints you confirmed">
              <h4>Constraints you confirmed</h4>
              <ul>
                {sent.constraints
                  .filter((c) => c.confirmed)
                  .map((c) => {
                    const who = entities.find((e) => e.id === c.about)?.surfaces[0];
                    return (
                      <li key={c.id}>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={!offIds.includes(c.id)}
                            disabled={stage !== 'result' || signing || replay}
                            onChange={(e) => switchConstraint(c.id, e.target.checked)}
                          />
                          <span />
                          <q>{c.text}</q>
                          {who && <small>{who}</small>}
                        </label>
                      </li>
                    );
                  })}
              </ul>
              {stage === 'result' && !replay && (
                <p className="hint">Switch one off or on: the same draft is checked again here, by rule. No new draft is asked for.</p>
              )}
            </div>
          )}
          {unflagged.length > 0 && <ol className="items">{unflagged.map(resultItem)}</ol>}

          {isLesson && stage === 'signed' && (
            <div className="strip">
              <h4>For these children</h4>
              <ForTheseChildren stages={draft.items} adjustments={acceptedNow} />
              <p className="hint">Kept on this device with the lesson. Never sent, and not in any record.</p>
            </div>
          )}

          {isLesson && stage === 'signed' && previewOpen && (replay || keptCount > 0) && (
            <CopyPreview
              title={draft.title}
              meta={[lesson.klass, lesson.subject, lesson.topic, `${lessonMinutes(lesson.minutes)} minutes`].filter(Boolean).join(' · ')}
              stages={draft.items.filter((_, i) => kept[i] === true)}
              variations={variations}
              adjustments={acceptedNow}
            />
          )}

          {capture && !replay && (
            <div className="actions">
              <button className="secondary small" onClick={downloadRun}>
                Download this run as JSON
              </button>
              <span className="hint">
                For the recorded run: the file holds this note, the vault, the constraints, the draft and the verdicts as first checked, and
                any rewrites and on-device suggestions as they stand now.
              </span>
            </div>
          )}

          {replay && stage === 'signed' && (
            <div className="actions">
              <span className="stamp">End of the recorded run</span>
              {isLesson && (
                <button className="secondary small" onClick={() => setPreviewOpen((o) => !o)}>
                  {previewOpen ? 'Hide copy preview' : 'Preview class & teacher copies'}
                </button>
              )}
              <span className="hint">No receipt was written.</span>
              <button className="secondary small" onClick={leaveReplay}>
                Leave the recorded run
              </button>
            </div>
          )}
        </article>
      )}

      {isLesson && sent && !replyBlocked && (replay ? Boolean(materials) && (stage === 'result' || stage === 'signed') : stage === 'result' || (stage === 'signed' && keptCount > 0)) && (
        <MaterialsCard
          request={materialsRequest}
          stopped={materialsStopped}
          busy={materialsBusy}
          streamChars={materialsStreamChars}
          fail={materialsFail}
          result={materials?.materials ?? null}
          issues={materials?.issues ?? []}
          where={materials ? (materials.where === 'IN_CLOUD' ? `Written in the cloud by ${materials.model}` : 'The cloud failed, so the on-device model wrote these') : ''}
          onDevice={materials?.where === 'ON_DEVICE'}
          namesFor={needNames}
          onSend={() => void makeMaterials()}
          onPrint={stage === 'signed' && !replay ? printMaterials : undefined}
          noPrint={replay ? 'From the recorded run.' : 'Sign off the lesson to print these.'}
          activeNeed={activeNeed}
          onHoverNeed={setActiveNeed}
        />
      )}
    </>
  );
}
