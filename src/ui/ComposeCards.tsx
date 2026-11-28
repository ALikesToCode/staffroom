import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import type { Stage } from '../app/storage';
import type { DeviceStatus } from '../ai/routes';
import type { Policy } from '../ai/firebase';
import {
  FIELD_MAX,
  HINDI_RULE_ONLY,
  LANGUAGES,
  languageOf,
  LAST_TIME_MAX,
  lessonMinutes,
  lessonReady,
  NOT_ENGLISH,
  ruleSupportedLanguage,
  type LessonFields,
} from '../core/lesson';
import { TASKS } from '../core/samples';
import { NOTE_MAX } from '../core/text';
import type { Kind, TaskId } from '../core/types';
import { KIND_LABEL, Spinner } from './parts';

export function TaskComposeCard({
  task,
  setTask,
  lesson,
  setLesson,
  replay,
}: {
  task: TaskId;
  setTask: (t: TaskId) => void;
  lesson: LessonFields;
  setLesson: Dispatch<SetStateAction<LessonFields>>;
  replay: boolean;
}) {
  return (
    <article className="card">
      <fieldset className="tasks">
        <legend>What do you want help with?</legend>
        {TASKS.map((t) => (
          <label key={t.id} className={task === t.id ? 'task on' : 'task'}>
            <input type="radio" name="task" checked={task === t.id} disabled={replay} onChange={() => setTask(t.id)} />
            <strong>{t.label}</strong>
            <span>{t.blurb}</span>
          </label>
        ))}
      </fieldset>
      {(task === 'lesson' || task === 'parents') && (
        <div className="write-in">
          <label className="lesson-field">
            Write it in
            <select
              value={LANGUAGES.some((l) => l === (lesson.language || 'English')) ? lesson.language || 'English' : 'other'}
              disabled={replay}
              onChange={(e) => setLesson((l) => ({ ...l, language: e.target.value === 'other' ? ' ' : e.target.value === 'English' ? '' : e.target.value }))}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
              <option value="other">Another language</option>
            </select>
          </label>
          {lesson.language !== undefined && lesson.language !== '' && !LANGUAGES.some((l) => l === lesson.language) && (
            <label className="lesson-field">
              Which language
              <input
                type="text"
                value={lesson.language.trimStart()}
                maxLength={40}
                readOnly={replay}
                placeholder="Marathi"
                onChange={(e) => setLesson((l) => ({ ...l, language: e.target.value || ' ' }))}
              />
            </label>
          )}
          {languageOf(lesson) && (
            <p className="hint">
              Sent as one line: “{task === 'lesson' ? 'Language of the plan' : 'Language of the messages'}: {languageOf(lesson)}”.{' '}
              {ruleSupportedLanguage(languageOf(lesson)) ? HINDI_RULE_ONLY : NOT_ENGLISH}
            </p>
          )}
        </div>
      )}
      {task === 'lesson' && (
        <div className="lesson-lines">
          {(
            [
              ['klass', 'Class', 'Class 6'],
              ['subject', 'Subject', 'English'],
              ['topic', 'Topic', 'Writing a short description of a place'],
            ] as const
          ).map(([key, label, example]) => (
            <label key={key} className={`lesson-field f-${key}`}>
              {label}
              <input
                type="text"
                value={lesson[key]}
                readOnly={replay}
                maxLength={FIELD_MAX}
                placeholder={example}
                onChange={(e) => setLesson((l) => ({ ...l, [key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="lesson-field f-minutes">
            Minutes
            <input
              type="number"
              min={5}
              max={240}
              value={lesson.minutes}
              readOnly={replay}
              onChange={(e) => setLesson((l) => ({ ...l, minutes: Number(e.target.value) }))}
              onBlur={() => setLesson((l) => ({ ...l, minutes: lessonMinutes(l.minutes) }))}
            />
          </label>
          <label className="lesson-field f-last">
            What we did last time <small>optional</small>
            <textarea
              rows={2}
              value={lesson.lastTime}
              readOnly={replay}
              maxLength={LAST_TIME_MAX}
              onChange={(e) => setLesson((l) => ({ ...l, lastTime: e.target.value }))}
            />
          </label>
          <p className="hint">These lines are not private. They are sent as written, under “Lesson”.</p>
        </div>
      )}
    </article>
  );
}

export function NoteComposeCard({
  noteLinks,
  forgetQuestion,
  replay,
  fileInputRef,
  scanning,
  scanNotebookFile,
  scanSampleNotebook,
  noModel,
  imageDevice,
  scanPreview,
  scanError,
  note,
  setNote,
  listOpen,
  setListOpen,
  classList,
  setClassList,
  policy,
  keepClass,
  setKeepClass,
  device,
  download,
  task,
  lesson,
  runGuard,
  watch,
}: {
  noteLinks: ReactNode;
  forgetQuestion: ReactNode;
  replay: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  scanning: boolean;
  scanNotebookFile: (f: File) => Promise<void>;
  scanSampleNotebook: () => Promise<void>;
  noModel: boolean;
  imageDevice: DeviceStatus;
  scanPreview: { url: string; summary: string } | null;
  scanError: string | null;
  note: string;
  setNote: (s: string) => void;
  listOpen: boolean;
  setListOpen: (v: boolean) => void;
  classList: string[];
  setClassList: Dispatch<SetStateAction<string[]>>;
  policy: Policy;
  keepClass: boolean;
  setKeepClass: (v: boolean) => void;
  device: DeviceStatus;
  download: number | null;
  task: TaskId;
  lesson: LessonFields;
  runGuard: () => void;
  watch?: (() => void) | null;
}) {
  return (
    <article className="card">
      <div className="card-head">
        <h3>Your note</h3>
        {noteLinks}
      </div>
      {forgetQuestion}
      <p className="demo-notice">Public demo. Please try it with invented pupils.</p>
      {!replay && (
        <div className="notebook-scan">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void scanNotebookFile(f);
              e.target.value = '';
            }}
          />
          <button className="secondary" type="button" disabled={scanning || noModel || imageDevice === 'unsupported' || imageDevice === 'unavailable'} onClick={() => fileInputRef.current?.click()}>
            {scanning ? 'Reading your notebook on this computer…' : 'Take a photo of my notebook'}
          </button>
          <button className="link" type="button" disabled={scanning} onClick={() => void scanSampleNotebook()}>
            Try sample notebook photo
          </button>
          <span className="hint scan-hint">
            {noModel || imageDevice === 'unsupported' || imageDevice === 'unavailable'
              ? 'Notebook photo reading needs Chrome with its built-in image model on a laptop.'
              : 'Reads clear English or Hinglish handwriting on this computer. Hindi script works best when typed.'}
          </span>
        </div>
      )}
      {scanPreview && (
        <div className="scan-preview" role="status">
          <img src={scanPreview.url} alt="Scanned handwritten register thumbnail" />
          <span>{scanPreview.summary}</span>
        </div>
      )}
      {scanError && (
        <p className="caution" role="alert">
          {scanError}
        </p>
      )}
      <textarea
        value={note}
        readOnly={replay}
        maxLength={NOTE_MAX}
        onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
        placeholder="Write what you noticed this week, as you would in your own notebook. Names, family matters, health: write it all."
        rows={9}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        aria-label="Your note"
      />
      <p className={note.length >= NOTE_MAX ? 'hint note-count full' : 'hint note-count'}>
        {note.length.toLocaleString()} of {NOTE_MAX.toLocaleString()} characters
        {note.length >= NOTE_MAX ? '. Put a longer note through in two runs.' : ''}
      </p>
      <details className="class-list" open={listOpen} onToggle={(e) => setListOpen(e.currentTarget.open)}>
        <summary>
          Class list <small>{classList.length > 0 ? `${classList.length} names` : 'optional'}</small>
        </summary>
        <p>
          One name per line, kept with your note. A name on this list is{' '}
          {policy.lockedKinds.includes('student') ? 'always withheld' : 'withheld by default'}, with or without a model.
        </p>
        <textarea
          readOnly={replay}
          value={classList.join('\n')}
          onChange={(e) => setClassList(e.target.value.split('\n').map((s) => s.trimStart()))}
          onBlur={() => setClassList((l) => l.map((s) => s.trim()).filter(Boolean))}
          rows={5}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Class list"
        />
      </details>
      {!replay && (
        <label className="keep-class">
          <input type="checkbox" checked={keepClass} onChange={(e) => setKeepClass(e.target.checked)} />
          Keep this class in this browser
          <small>
            {keepClass
              ? 'On: your note, class list, constraints, saved lessons and saved records stay in local storage on this computer only.'
              : 'Off by default: closing this tab removes your notes, class list, lessons and saved records.'}
          </small>
        </label>
      )}
      {noModel && !replay && (
        <p className="notice">
          No on-device model in this browser, so the guard runs by rule: your class list, patterns, a short list of sensitive words and
          capitalised words. Mark other private details yourself.
        </p>
      )}
      {(device === 'downloadable' || device === 'downloading') && download === null && (
        <p className="notice">The first run downloads the on-device model (several GB) and can take a few minutes.</p>
      )}
      {replay ? null : (
        <div className="actions">
          <button
            className="primary big"
            disabled={note.trim().length < 20 || note.length > NOTE_MAX || (task === 'lesson' && !lessonReady(lesson))}
            onClick={runGuard}
          >
            Hide private details
            <span className="btn-hi" aria-hidden="true">
              निजी बातें छिपाएँ
            </span>
          </button>
          <span className="hint">Nothing is sent yet. This runs on this computer.</span>
          {watch && (
            <button className="link" onClick={watch}>
              Watch a recorded run
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function NoteReviewCard({
  noteLinks,
  forgetQuestion,
  noteView,
  stage,
  replay,
  selection,
  selectionNote,
  withholdSelection,
}: {
  noteLinks: ReactNode;
  forgetQuestion: ReactNode;
  noteView: ReactNode;
  stage: Stage;
  replay: boolean;
  selection: string;
  selectionNote: string;
  withholdSelection: (k: Kind) => void;
}) {
  return (
    <article className="card">
      <div className="card-head">
        <h3>Your note</h3>
        {noteLinks}
      </div>
      {forgetQuestion}
      <p className="demo-notice">Public demo. Please try it with invented pupils.</p>
      {noteView}
      {stage === 'review' && !replay && (
        <div className="select-bar" aria-live="polite">
          {selection ? (
            <>
              <span>
                Withhold <q>{selection.length > 48 ? `${selection.slice(0, 48)}…` : selection}</q> as
              </span>
              {(['student', 'adult', 'place', 'contact', 'id', 'private'] as Kind[]).map((k) => (
                <button key={k} className="chip-btn" onClick={() => withholdSelection(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </>
          ) : selectionNote ? (
            <span className="caution selection-note">{selectionNote}</span>
          ) : (
            <span className="hint">Missed something? Select it in your note to withhold it.</span>
          )}
        </div>
      )}
    </article>
  );
}

/** Shown in the device lane while downloading Gemini Nano on first run or running the local guard. */
export function GuardingCard({
  download,
  progress,
  onWatch,
}: {
  download: number | null;
  progress: string;
  onWatch?: (() => void) | null;
}) {
  const pct = download !== null ? Math.round(download * 100) : null;
  return (
    <article className="card guarding-card">
      <Spinner label={pct !== null ? `Downloading Gemini Nano in Chrome (${pct}%)…` : progress || 'Hiding private details on this computer…'} />
      {pct !== null && (
        <>
          <progress className="model-progress" max={100} value={pct} aria-label="On-device model download progress" />
          <p className="hint">
            Chrome is downloading the on-device model (several GB) for this first run and keeps it on this computer. You can watch a recorded
            run while you wait.
          </p>
        </>
      )}
      {onWatch && (
        <div className="actions">
          <button type="button" className="secondary small" onClick={onWatch}>
            Watch a recorded run
          </button>
        </div>
      )}
    </article>
  );
}
