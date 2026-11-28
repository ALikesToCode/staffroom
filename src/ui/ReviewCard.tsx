import type { Gaps } from '../app/storage';
import type { Violation } from '../core/gate';
import { notSentLine } from '../core/needs';
import type { Task, Where } from '../core/types';
import { CloudText } from './parts';

export interface ReviewCardProps {
  violations: Violation[];
  nothingWithheld: boolean;
  partOfNote: boolean;
  guardWhere: Where;
  guardGaps: Gaps;
  notePartsCount: number;
  replay: boolean;
  taskLabel: Task['label'];
  outgoing: string;
  isLesson: boolean;
  activeNeed: string | null;
  onHoverNeed: (letter: string | null) => void;
  notSentCount: number;
  needsCount?: number;
  withheldCount?: number;
}

export function ReviewCard({
  violations,
  nothingWithheld,
  partOfNote,
  guardWhere,
  guardGaps,
  notePartsCount,
  replay,
  taskLabel,
  outgoing,
  isLesson,
  activeNeed,
  onHoverNeed,
  notSentCount,
  needsCount = 0,
  withheldCount = 0,
}: ReviewCardProps) {
  return (
    <article className="card outbox waiting">
      <div className="card-head">
        <h3>Ready to send</h3>
        <span className={violations.length === 0 ? 'gate pass' : 'gate stop'}>
          {violations.length === 0 ? (
            <>
              <span>No names or numbers found. Please read it once.</span>
              <code className="gate-tag">Exit gate: 0 found</code>
            </>
          ) : (
            <>
              <span>
                {violations.length} {violations.length === 1 ? 'name or number' : 'names or numbers'} must be hidden first
              </span>
              <code className="gate-tag">Exit gate: {violations.length} stopped</code>
            </>
          )}
        </span>
      </div>

      {/* Plain-words summary right above the exact outgoing text, so a teacher sees what goes and what stays at a glance. */}
      <div className="send-summary" aria-label="What leaves and what stays">
        <p>
          <b>Going to Google&apos;s Gemini:</b>{' '}
          {isLesson
            ? needsCount > 0
              ? `your lesson topic and ${needsCount} ${needsCount === 1 ? 'need' : 'needs'}, without names.`
              : 'your lesson topic only, without names.'
            : `your approved note for ${taskLabel.toLowerCase()}, without names.`}
        </p>
        <p>
          <b>Staying on this computer:</b> {withheldCount} {withheldCount === 1 ? 'name or private detail' : 'names and private details'}.
        </p>
      </div>

      {/* What the guard did not cover is said here, beside the gate: before the text, and above the tick. */}
      {nothingWithheld && (
        <p className="caution strong" role="alert">
          {partOfNote
            ? 'Nothing is withheld. The sentences of your note below are exactly as you wrote them: every name and every detail in them will be sent to Google\'s Gemini.'
            : 'Nothing is withheld. The text below is your note exactly as you wrote it: every name and every detail in it will be sent to Google\'s Gemini.'}
        </p>
      )}
      {guardWhere === 'ON_DEVICE' && guardGaps.unread.length > 0 && (
        <p className="caution">
          The on-device model could not read {guardGaps.unread.length} of the {notePartsCount} parts of your note (
          {guardGaps.unread.map((i) => `part ${i + 1}`).join(', ')}). They are listed on the computer side, under what is hidden. Check{' '}
          {guardGaps.unread.length === 1 ? 'it' : 'them'} yourself before you send.
        </p>
      )}
      {guardGaps.dropped > 0 && (
        <p className="caution">
          The on-device model also listed {guardGaps.dropped} unanchored {guardGaps.dropped === 1 ? 'phrase' : 'phrases'} (often
          paraphrases rather than exact words in your note). Read the text below to be sure no real name or private detail remains.
        </p>
      )}
      {guardGaps.partial > 0 && (
        <p className="caution">
          {guardGaps.partial} private {guardGaps.partial === 1 ? 'detail was' : 'details were'} matched to your note only in part. The
          matching words were hidden. Read the text around each private detail and mark what is left.
        </p>
      )}
      <p className="hint">
        {replay ? 'The exact text that was sent on the day' : 'The exact text that will be sent'}, for: {taskLabel.toLowerCase()}.
      </p>
      <div className="wire">
        <CloudText text={outgoing} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? onHoverNeed : undefined} />
      </div>
      {!replay && notSentCount > 0 && <p className="hint">{notSentLine(notSentCount)}</p>}
      {violations.length > 0 && (
        <ul className="stops">
          {violations.map((v, i) => (
            <li key={i}>
              <b>{v.what}</b> {v.why}
            </li>
          ))}
        </ul>
      )}
      {nothingWithheld && (
        <p className="hint">
          {partOfNote
            ? 'A record holds the text you approved. Here that is the sentences of your note that are sent, as written.'
            : 'A record holds the text you approved. Here that is your whole note, as written.'}
        </p>
      )}
    </article>
  );
}
