import { familyAfterRewrite } from '../core/family';
import { lessonMinutes, type LessonFields, type SavedAdjustment } from '../core/lesson';
import { variationLine, type Variation } from '../core/lessonNeeds';
import type { MaterialsResult } from '../ai/draft';
import type { Draft, DraftItem, Entity, TaskId } from '../core/types';
import { restore } from '../core/vault';
import { ForTheseChildren } from './Lesson';
import { MaterialsPages } from './Materials';

export interface PrintSheetProps {
  printWhat: 'all' | 'class-only' | 'teacher-only' | 'materials' | 'materials-no-names';
  draft: Draft;
  task: TaskId;
  isLesson: boolean;
  lesson: LessonFields;
  materials: (MaterialsResult & { text: string }) | null;
  needNames: (letter: string) => string[];
  printable: { item: DraftItem; i: number; family: ReturnType<typeof familyAfterRewrite> }[];
  kept: (boolean | null)[];
  variations: Variation[];
  acceptedNow: SavedAdjustment[];
  entities: Entity[];
  tokens?: string[];
}

export function PrintSheet({
  printWhat,
  draft,
  task,
  isLesson,
  lesson,
  materials,
  needNames,
  printable,
  kept,
  variations,
  acceptedNow,
  entities,
  tokens,
}: PrintSheetProps) {
  return (
    <section className="print-sheet" aria-hidden="true">
      {printWhat === 'materials' || printWhat === 'materials-no-names' ? (
        materials && <MaterialsPages title={draft.title} result={materials.materials} namesFor={needNames} withNames={printWhat === 'materials'} />
      ) : task === 'parents' ? (
        printable.map(({ item, i, family }) => (
          <div className="print-page" key={i}>
            <h2>For the family of {family.student!.surfaces[0]}</h2>
            <p>{restore(item.text, entities, tokens).trim()}</p>
          </div>
        ))
      ) : isLesson ? (
        <>
          {/* Page 1: the class plan, stand-ins as they came. No name and no adjustment: it can be pinned up or shared. */}
          {printWhat !== 'teacher-only' && (
            <div className="print-page">
              <h1>{draft.title}</h1>
              <p>{[lesson.klass, lesson.subject, lesson.topic, `${lessonMinutes(lesson.minutes)} minutes`].filter(Boolean).join(' · ')}</p>
              {draft.items.map((item, i) =>
                kept[i] === true ? (
                  <div key={i}>
                    <h2>{item.heading}</h2>
                    <p>{item.text.trim()}</p>
                    {variations
                      .filter((v) => v.itemIndex === i)
                      .map((v, k) => (
                        <p key={k}>{variationLine(v)}</p>
                      ))}
                  </div>
                ) : null,
              )}
            </div>
          )}
          {printWhat === 'teacher-only' && (
            <div className="print-page">
              <h1>Teacher's copy: adjustments. Keep this private.</h1>
              <ForTheseChildren stages={draft.items} adjustments={acceptedNow} />
            </div>
          )}
        </>
      ) : (
        <div className="print-page">
          <h1>{restore(draft.title, entities, tokens)}</h1>
          {draft.items.map((item, i) =>
            kept[i] === true ? (
              <div key={i}>
                <h2>{restore(item.heading, entities, tokens)}</h2>
                <p>{restore(item.text, entities, tokens).trim()}</p>
              </div>
            ) : null,
          )}
        </div>
      )}
    </section>
  );
}
