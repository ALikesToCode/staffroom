import type { DraftItem } from '../core/types';
import { type SavedAdjustment } from '../core/lesson';
import { variationLine, type Variation } from '../core/lessonNeeds';
import { ForTheseChildren } from './Lesson';

/**
 * In-app side-by-side preview of the two printed outputs of a signed lesson:
 * the anonymous class copy (safe to share or pin up) beside the private
 * teacher's copy with names and per-child adjustments.
 */
export function CopyPreview({
  title,
  meta,
  stages,
  variations,
  adjustments,
}: {
  title: string;
  meta: string;
  stages: readonly DraftItem[];
  variations: readonly Variation[];
  adjustments: readonly SavedAdjustment[];
}) {
  return (
    <section className="copy-preview" aria-label="Preview of class and teacher copies">
      <div className="preview-sheet class-copy">
        <div className="preview-head">
          <span>Class copy · no names</span>
          <span className="copy-badge safe">No names · letter codes only</span>
        </div>
        <div className="preview-paper">
          <h4>{title}</h4>
          {meta && <p className="preview-meta">{meta}</p>}
          {stages.map((item, i) => (
            <div key={i} className="preview-stage">
              <h5>{item.heading}</h5>
              <p>{item.text.trim()}</p>
              {variations
                .filter((v) => v.itemIndex === i)
                .map((v, k) => (
                  <p key={k} className="preview-need">
                    {variationLine(v)}
                  </p>
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="preview-sheet teacher-copy">
        <div className="preview-head">
          <span>Teacher's copy · with names</span>
          <span className="copy-badge private">Stays on this device</span>
        </div>
        <div className="preview-paper">
          <h4>Adjustments for these children</h4>
          <ForTheseChildren stages={stages} adjustments={adjustments} />
        </div>
      </div>
    </section>
  );
}
