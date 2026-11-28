import type { Gaps, Stage } from '../app/storage';
import type { Point } from '../core/points';
import type { LessonHit, SavedAdjustment } from '../core/lesson';
import type { Where } from '../core/types';
import type { Violation } from '../core/gate';

export interface ActionBarProps {
  stage: Stage;
  replay: boolean;
  prevInReplay: () => void;
  nextInReplay: () => void;
  leaveReplay: () => void;
  readIt: boolean;
  setReadKey: (v: string | null) => void;
  approval: string;
  guardWhere: Where;
  partsUnread: boolean;
  unreadAcked: boolean;
  setUnreadKey: (v: string | null) => void;
  unreadApproval: string;
  guardGaps: Gaps;
  nothingWithheld: boolean;
  asWritten: boolean;
  setAsWrittenKey: (v: string | null) => void;
  asWrittenApproval: string;
  partOfNote: boolean;
  policyReady: boolean;
  outgoingLength: number;
  cloudModel: string;
  canSend: boolean;
  approveAndSend: () => void;
  replyIssues: Violation[];
  replyRead: boolean;
  setReplyRead: (v: boolean) => void;
  isLesson: boolean;
  waitingHits: LessonHit[];
  acceptedNow: SavedAdjustment[];
  waitingPoints: Point[];
  waitingAcceptablePoints: Point[];
  undecided: number;
  kept: (boolean | null)[];
  keptCount: number;
  struckCount: number;
  toKeep: number;
  signing: boolean;
  keepNoConflictClick: () => void;
  acceptWaitingAndSignOff: () => void;
  signOff: () => void;
  replyBlocked: boolean;
}

export function ActionBar({
  stage,
  replay,
  prevInReplay,
  nextInReplay,
  leaveReplay,
  readIt,
  setReadKey,
  approval,
  guardWhere,
  partsUnread,
  unreadAcked,
  setUnreadKey,
  unreadApproval,
  guardGaps,
  nothingWithheld,
  asWritten,
  setAsWrittenKey,
  asWrittenApproval,
  partOfNote,
  policyReady,
  outgoingLength,
  cloudModel,
  canSend,
  approveAndSend,
  replyIssues,
  replyRead,
  setReplyRead,
  isLesson,
  waitingHits,
  acceptedNow,
  waitingPoints,
  waitingAcceptablePoints,
  undecided,
  kept,
  keptCount,
  struckCount,
  toKeep,
  signing,
  keepNoConflictClick,
  acceptWaitingAndSignOff,
  signOff,
  replyBlocked,
}: ActionBarProps) {
  return (
    <>
      {stage === 'review' && (
        <div className="action-bar cloud-bar">
          {replay ? (
            <>
              <span className="hint">Recorded run: this is the text that was approved and sent on the day. Nothing is sent now.</span>
              <button className="secondary" onClick={prevInReplay}>
                Back
              </button>
              <button className="primary send" onClick={nextInReplay}>
                Next
              </button>
            </>
          ) : (
            <>
              <div className="ticks">
                <label className="read-it">
                  <input type="checkbox" checked={readIt} onChange={(e) => setReadKey(e.target.checked ? approval : null)} />
                  {guardWhere === 'RULES_ONLY'
                    ? 'No model looked for private details. I have read this text and marked them myself.'
                    : 'I have read this text and I am content to send it.'}
                </label>
                {partsUnread && (
                  <label className="read-it unread-parts">
                    <input type="checkbox" checked={unreadAcked} onChange={(e) => setUnreadKey(e.target.checked ? unreadApproval : null)} />
                    The on-device model did not read {guardGaps.unread.length === 1 ? 'one part' : `${guardGaps.unread.length} parts`} of this
                    note. I have read {guardGaps.unread.length === 1 ? 'that part' : 'those parts'} and marked what is private in{' '}
                    {guardGaps.unread.length === 1 ? 'it' : 'them'} myself.
                  </label>
                )}
                {nothingWithheld && (
                  <label className="read-it as-written">
                    <input type="checkbox" checked={asWritten} onChange={(e) => setAsWrittenKey(e.target.checked ? asWrittenApproval : null)} />
                    {partOfNote
                      ? 'Nothing has been withheld. I am sending these sentences of my note as written.'
                      : 'Nothing has been withheld. I am sending my note as written.'}
                  </label>
                )}
              </div>
              <span className="hint bar-say">
                {policyReady ? `${outgoingLength.toLocaleString()} characters to ${cloudModel}` : 'Loading school policy…'}
              </span>
              <button className="primary send" disabled={!canSend} onClick={approveAndSend}>
                Approve and send
              </button>
            </>
          )}
        </div>
      )}

      {stage === 'result' && (
        <div className="action-bar device-bar">
          {replay ? (
            <>
              <span className="hint">Recorded run: in a live run you keep or strike each item here, then sign off. Nothing is signed off now.</span>
              <button className="secondary" onClick={prevInReplay}>
                Back
              </button>
              <button className="primary" onClick={nextInReplay}>
                Next
              </button>
            </>
          ) : (
            <>
              {replyIssues.length > 0 && (
                <div className="ticks">
                  <label className="read-it reply-read">
                    <input type="checkbox" checked={replyRead} onChange={(e) => setReplyRead(e.target.checked)} />
                    I have read the flagged reply and I still want to use it.
                  </label>
                </div>
              )}
              <span className="hint bar-say">
                {isLesson
                  ? waitingHits.length > 0
                    ? `${waitingHits.length} ${waitingHits.length === 1 ? 'child still waits' : 'children still wait'} for an adjustment, or for you to leave the step as it is.`
                    : `${acceptedNow.length} accepted for ${new Set(acceptedNow.map((a) => a.child)).size} ${new Set(acceptedNow.map((a) => a.child)).size === 1 ? 'child' : 'children'}. They stay on this device.${
                        waitingPoints.length > 0
                          ? waitingAcceptablePoints.length > 0 && waitingPoints.length > waitingAcceptablePoints.length
                            ? ` ${waitingAcceptablePoints.length} ready to accept · ${waitingPoints.length - waitingAcceptablePoints.length} need wording.`
                            : ` ${waitingPoints.length} ${waitingPoints.length === 1 ? 'adaptation still waits' : 'adaptations still wait'}.`
                          : ''
                      }`
                  : undecided > 0
                    ? `${undecided} of ${kept.length} still to decide. Nothing is kept until you keep it.`
                    : keptCount === 0
                      ? 'Every item is struck. Signing off now rejects the whole draft.'
                      : `${keptCount} kept, ${struckCount} struck.`}
              </span>
              {toKeep > 0 && !isLesson && (
                <button className="secondary" disabled={signing} onClick={keepNoConflictClick}>
                  Keep the {toKeep} {toKeep === 1 ? 'item' : 'items'} with no conflict found
                </button>
              )}
              {isLesson && waitingHits.length === 0 && waitingAcceptablePoints.length > 0 ? (
                <>
                  <button className="primary" onClick={acceptWaitingAndSignOff} disabled={signing || undecided > 0 || replyBlocked}>
                    Accept all {waitingAcceptablePoints.length} & sign off
                  </button>
                  <button className="link" onClick={signOff} disabled={signing || undecided > 0 || replyBlocked}>
                    Sign off without {waitingAcceptablePoints.length} unaccepted
                  </button>
                </>
              ) : (
                <button className="primary" onClick={signOff} disabled={signing || undecided > 0 || replyBlocked || (isLesson && waitingHits.length > 0)}>
                  {isLesson ? 'Sign off the lesson' : undecided === 0 && keptCount === 0 ? 'Reject the whole draft' : `Sign off ${keptCount} of ${kept.length} items`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {stage === 'signed' && replay && (
        <div className="action-bar device-bar">
          <span className="hint">Recorded run: end of the replay. Nothing was sent or stored.</span>
          <button className="secondary" onClick={prevInReplay}>
            Back
          </button>
          <button className="primary" onClick={leaveReplay}>
            Leave the recorded run
          </button>
        </div>
      )}
    </>
  );
}
