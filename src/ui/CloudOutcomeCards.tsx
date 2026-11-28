import { time, type Stage } from '../app/storage';
import type { DraftResult, MaterialsResult } from '../ai/draft';
import type { Need } from '../core/needs';
import type { Constraint, Entity } from '../core/types';
import { MaterialsWire } from './Materials';
import { CloudText, Spinner } from './parts';

// Note: uses plain types only without circular deps.
export interface CloudOutcomeCardsProps {
  stage: Stage;
  online: boolean;
  fallbackActive?: boolean;
  cloudModel: string;
  streamPreview: string;
  result: DraftResult | null;
  sectionLines: string[];
  isLesson: boolean;
  activeNeed: string | null;
  setActiveNeed: (l: string | null) => void;
  variationsCount: number;
  variationsDropped: number;
  needsReply: { section: string; none: string[]; missing: string[]; second: string | null } | null;
  materials: (MaterialsResult & { text: string }) | null;
  sent: {
    text: string;
    at: string;
    entities: Entity[];
    tokens: string[];
    online: boolean;
    constraints: Constraint[];
    needs: Need[];
  } | null;
}

// Keep unused type reference avoided: export clean component.
export function CloudOutcomeCards({
  stage,
  online,
  fallbackActive = false,
  cloudModel,
  streamPreview,
  result,
  sectionLines,
  isLesson,
  activeNeed,
  setActiveNeed,
  variationsCount,
  variationsDropped,
  needsReply,
  materials,
  sent,
}: CloudOutcomeCardsProps) {
  return (
    <>
      {stage === 'drafting' && (
        <article className="card">
          <Spinner
            label={
              fallbackActive
                ? streamPreview
                  ? online
                    ? `Cloud failed — streaming on-device draft from Gemini Nano (${streamPreview.length} chars)…`
                    : `Offline — streaming on-device draft from Gemini Nano (${streamPreview.length} chars)…`
                  : online
                    ? 'Cloud failed — falling back to Gemini Nano on this device…'
                    : 'Offline — trying cloud first; falling back to Gemini Nano on this device…'
                : online
                  ? streamPreview
                    ? `Streaming draft from ${cloudModel} (${streamPreview.length} chars)…`
                    : `Asking ${cloudModel} to write the draft`
                  : streamPreview
                    ? `Offline — streaming on-device draft from Gemini Nano (${streamPreview.length} chars)…`
                    : 'Offline — trying cloud first; falling back to Gemini Nano on this device…'
            }
          />
          {streamPreview && (
            <pre className="wire stream-live" aria-live="polite">
              {streamPreview.slice(-900)}
            </pre>
          )}
        </article>
      )}

      {((result && stage !== 'review' && stage !== 'drafting') || materials || (sent && stage !== 'review')) && (
        <div className="cloud-sticky">
          {result && stage !== 'review' && stage !== 'drafting' && (
            <article className="card">
              <div className="card-head">
                <h3>{result.where === 'IN_CLOUD' ? 'What came back' : 'Written on the device'}</h3>
                <span className="hint">{result.model}</span>
              </div>
              {result.where === 'ON_DEVICE' && (
                <>
                  <p className="caution">
                    {sent?.online === false
                      ? 'You were offline when you approved, so the on-device model wrote this draft from the same approved text.'
                      : 'The cloud draft failed, so the on-device model wrote this draft from the same approved text.'}
                  </p>
                  {/* A separate fact. The app does not know why the cloud draft failed. */}
                  <p className="hint">Browser reported when you approved: {sent?.online ? 'online' : 'offline'}.</p>
                </>
              )}
              <div className="wire reply">
                <strong>
                  <CloudText text={result.draft.title} />
                </strong>
                {result.draft.items.map((item, i) => (
                  <p key={i}>
                    <b>
                      <CloudText text={item.heading} />
                    </b>
                    <br />
                    <CloudText text={item.text} />
                  </p>
                ))}
                {sectionLines.length > 0 && (
                  <p>
                    <b>For each need</b>
                    {sectionLines.map((l, k) => (
                      <span key={k}>
                        <br />
                        <CloudText text={l} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <p className="hint">
                {variationsCount > 0
                  ? result.where === 'ON_DEVICE'
                    ? 'This device wrote for each need by its letter from the same approved text.'
                    : 'The cloud wrote for each need by its letter. It was not told whose a need is, or how many pupils have it.'
                  : 'The reply uses the stand-ins. Names are put back on your side of the door.'}
              </p>
              {variationsDropped > 0 && (
                <p className="hint">
                  {variationsDropped} {variationsDropped === 1 ? 'entry was' : 'entries were'} for a need you did not tell the cloud or a
                  stage that is not in the lesson, or had no words, so {variationsDropped === 1 ? 'it is' : 'they are'} left out.
                </p>
              )}
              {needsReply?.second && (
                <p className="hint">
                  {result.where === 'ON_DEVICE' ? 'The on-device model' : 'The cloud'} was asked once more for the needs its first reply left
                  out. Inspect shows the exact text of that second request.
                </p>
              )}
            </article>
          )}

          {materials && (
            <article className="card">
              <div className="card-head">
                <h3>{materials.where === 'IN_CLOUD' ? 'Materials: what came back' : 'Materials: written on the device'}</h3>
                <span className="hint">{materials.model}</span>
              </div>
              <MaterialsWire result={materials.materials} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
              <p className="hint">
                {materials.where === 'ON_DEVICE'
                  ? 'This device wrote these materials from the signed class plan and the needs by letter.'
                  : 'The cloud was sent the signed class plan and the needs by letter. It was not told whose a need is.'}
              </p>
              <details className="fold">
                <summary>The text that was sent for the materials · {materials.text.length.toLocaleString()} characters</summary>
                <pre className="wire">
                  <CloudText text={materials.text} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
                </pre>
              </details>
            </article>
          )}

          {sent && stage !== 'review' && (
            <details className="card fold outbox" open={stage === 'drafting' || undefined}>
              {/* "Sent" only once the cloud has answered. Until then, and when it never did, the app cannot say the text arrived. */}
              <summary>
                {result?.where === 'IN_CLOUD' ? 'Sent' : 'Approved by you'} at {time(sent.at)} · {sent.text.length.toLocaleString()} characters
              </summary>
              <pre className="wire">
                <CloudText text={sent.text} activeNeed={isLesson ? activeNeed : undefined} onHoverNeed={isLesson ? setActiveNeed : undefined} />
              </pre>
            </details>
          )}
        </div>
      )}
    </>
  );
}
