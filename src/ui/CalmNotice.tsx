import type { Gaps, Stage } from '../app/storage';
import type { Entity, Where } from '../core/types';

export interface CalmNoticeProps {
  stage: Stage;
  guardWhere: Where;
  checkWhere: Where;
  guardGaps: Gaps;
  isLesson: boolean;
  privateHeld: Entity[];
  watch?: (() => void) | null;
}

/** One calm line for a run without the on-device model. The long form is one click away. */
export function CalmNotice({ stage, guardWhere, checkWhere, guardGaps, isLesson, privateHeld, watch }: CalmNoticeProps) {
  if ((stage === 'review' || stage === 'guarding') && guardWhere === 'RULES_ONLY') {
    return (
      <div className="calm" role="status">
        <p>
          <b>Rules only.</b>{' '}
          {guardGaps.unread.length > 0
            ? `The on-device model was asked and could not read any of the ${guardGaps.unread.length} ${guardGaps.unread.length === 1 ? 'part' : 'parts'} of your note`
            : 'No on-device model ran here'}
          , so no model has read your note. Anything you have not marked yourself is sent as written.
        </p>
        <details>
          <summary>Details</summary>
          <p>
            Only your class list, the pattern rules, a short list of sensitive words and a rule for capitalised words were applied. That rule
            holds back, as a possible name, a word that begins with a capital letter and is not an ordinary sentence opener, a day or a
            month. It cannot tell a name from any other capitalised word, and it misses a name written without a capital. Private details
            beyond the listed words were not looked for: select them in your note. No on-device model looked for constraints either: these
            were found by rule, so add any that are missing.
          </p>
        </details>
        {watch && (
          <button className="link" onClick={watch}>
            Watch a recorded run
          </button>
        )}
      </div>
    );
  }
  if ((stage === 'result' || stage === 'signed') && checkWhere === 'RULES_ONLY') {
    return (
      <div className="calm" role="status">
        <p>
          <b>Checked by rule only.</b> No on-device model ran here, so each step was compared with the constraints you confirmed and nothing
          else.
        </p>
        <details>
          <summary>Details</summary>
          <p>
            Read the items against your other private details yourself.
            {isLesson
              ? ' What the cloud wrote for a need is placed beside each child on this device by plain code, and read by the same rules. Where the on-device model is present, it can also offer more ideas for a child from your note, when you ask.'
              : ''}
          </p>
        </details>
        {privateHeld.length > 0 && (
          <details>
            <summary>
              {privateHeld.length} private {privateHeld.length === 1 ? 'detail' : 'details'} no model compared the draft with
            </summary>
            <ul className="quotes">
              {privateHeld.map((e) => (
                <li key={e.id}>“{e.surfaces[0]}”</li>
              ))}
            </ul>
          </details>
        )}
        {watch && (
          <button className="link" onClick={watch}>
            Watch a recorded run
          </button>
        )}
      </div>
    );
  }
  return null;
}
