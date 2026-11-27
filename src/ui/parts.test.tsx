import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVault } from '../core/vault';
import { CloudText, DeviceText, Stepper } from './parts';
import { Caught, ConstraintsPanel } from './Constraints';
import type { Constraint } from '../core/types';
import { App } from '../App';
import { MaterialsPages } from './Materials';
import { CopyPreview } from './PrintPreview';
import { NetworkSection } from './pages';
import { addRequests } from '../core/network';
import type { Materials } from '../core/materials';

describe('CloudText', () => {
  it('shows each stand-in literally, square brackets included', () => {
    const text = '[Student 1] reads well. [withheld]. Ring [Contact 1].';
    const html = renderToStaticMarkup(<CloudText text={text} />);
    expect(html).toContain('<span class="bar">[Student 1]</span>');
    expect(html).toContain('<span class="bar">[withheld]</span>');
    expect(html).toContain('<span class="bar">[Contact 1]</span>');
    // With the tags taken out, what is left is the outgoing text, character for character.
    expect(html.replace(/<[^>]+>/g, '')).toBe(text);
  });

  it('highlights the active Need line when cross-door tracing is wired', () => {
    const text = 'Need A: leaves early.\nNeed B: no phone at home.';
    const html = renderToStaticMarkup(<CloudText text={text} activeNeed="B" onHoverNeed={() => {}} />);
    expect(html).toContain('<span class="need-wire-line"');
    expect(html).toContain('<span class="need-wire-line is-active"');
    expect(html.replace(/<[^>]+>/g, '')).toBe(text);
  });
});

describe('DeviceText', () => {
  const note = 'Aarav sits with Diya.';
  const vault = buildVault(note, [
    { kind: 'student', text: 'Aarav', source: 'class list' },
    { kind: 'student', text: 'Diya', source: 'class list' },
  ]);

  it('puts a name back only for a stand-in that was in the approved text', () => {
    const html = renderToStaticMarkup(<DeviceText text="Pair [Student 1] with [Student 2] and [Student 9]." entities={vault} allowed={['[Student 1]']} />);
    expect(html.replace(/<[^>]+>/g, '')).toBe('Pair Aarav with [Student 2] and [Student 9].');
    expect(html).toContain('<span class="unknown-token"');
    expect(html).not.toContain('Diya');
  });
});

describe('ConstraintsPanel', () => {
  const vault = buildVault('Meenal reads well.', [{ kind: 'student', text: 'Meenal', source: 'class list' }]);
  const actions = { onConfirm() {}, onUnconfirm() {}, onRemove() {}, onKind() {}, onTriggers() {}, onAdd() {}, onShare() {}, onNeed() {} };
  const needOf = (c: Constraint) => (c.id === 'a' ? { typed: false, line: '[Student 1] cannot stay after the last bell.', issues: [] } : { typed: false, issues: [] });
  const constraints: Constraint[] = [
    { id: 'a', kind: 'time-after', about: vault[0].id, text: 'has to leave at the last bell', source: 'rule', alsoModel: true, confirmed: false },
    { id: 'b', kind: 'contact', text: 'lives with his grandmother', who: 'parents', guardian: 'grandmother', away: true, source: 'teacher', confirmed: true },
  ];

  it('shows each constraint with its words, whose it is, who found it and whether it is confirmed', () => {
    const text = renderToStaticMarkup(
      <ConstraintsPanel constraints={constraints} students={vault} editable selection="" actions={actions} needOf={needOf} />,
    ).replace(/<[^>]+>/g, ' ');
    expect(text).toContain('has to leave at the last bell');
    // One line each: the words, whose they are and the kind. Who found it is under Details.
    expect(text).toMatch(/has to leave at the last bell\s+Meenal\s+Cannot stay after school/);
    expect(text).toMatch(/lives with his grandmother\s+the class\s+An adult not to contact/);
    expect(text).toContain('Found by rule and by the on-device model.');
    expect(text).toContain('Added by you.');
    // The two controls of a row: confirm it, and tell the cloud the need.
    expect(text).toMatch(/Confirm\s+Tell the cloud the need \(not the reason\)/);
    expect(text).toMatch(/Confirmed\s+Tell the cloud the need \(not the reason\)/);
    expect(text).toContain('Adult: parents, not there to contact. Looked after by: grandmother');
    const bare = renderToStaticMarkup(
      <ConstraintsPanel constraints={[{ id: 'c', kind: 'contact', text: 'lives with her aunt', guardian: 'aunt', source: 'rule', confirmed: false }]} students={vault} editable selection="" actions={actions} needOf={needOf} />,
    ).replace(/<[^>]+>/g, ' ');
    expect(bare).toMatch(/lives with her aunt\s+the class\s+Who looks after the child/);
    expect(bare).toContain('Looked after by: aunt. No adult is marked not to contact');
    expect(text).toContain('Add a constraint');
    // The need line that would be sent is shown beside the switch, before it is switched on.
    expect(text).toContain('Tell the cloud the need (not the reason)');
    expect(text).toMatch(/If you switch it on, the cloud will be told:\s+\[Student 1\] cannot stay after the last bell\./);
    expect(text).toContain('There is no need line for this constraint, so there is nothing to tell the cloud.');
  });

  it('says what a health need can give away, and why a typed line is stopped', () => {
    const health: Constraint = { id: 'h', kind: 'health', text: 'has epilepsy', source: 'rule', confirmed: true, share: true, need: 'No strobe, she has epilepsy' };
    const text = renderToStaticMarkup(
      <ConstraintsPanel
        constraints={[health]}
        students={vault}
        editable
        selection=""
        actions={actions}
        needOf={() => ({ typed: true, line: 'No strobe, she has epilepsy', issues: [{ what: 'epilepsy', why: 'a word that gives the reason, in a need line' }] })}
      />,
    ).replace(/<[^>]+>/g, ' ');
    expect(text).toContain('A health need can hint at the condition.');
    expect(text).toMatch(/This line cannot be sent:\s+epilepsy\s+a word that gives the reason, in a need line\s*\./);
  });

  it('offers nothing to change once the text is approved', () => {
    const html = renderToStaticMarkup(
      <ConstraintsPanel constraints={constraints} students={vault} editable={false} selection="" actions={actions} needOf={needOf} />,
    );
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Add a constraint');
  });
});

describe('Caught', () => {
  const constraint: Constraint = { id: 'a', kind: 'time-after', text: 'has to leave at the last bell', source: 'rule', confirmed: true };

  it('sets what the cloud was shown beside what the device knows', () => {
    const html = renderToStaticMarkup(
      <Caught check={{ verdict: 'conflict', reason: 'r', by: 'rule', constraintId: 'a', cloudSaw: 'She walks home and [withheld]' }} constraint={constraint} />,
    );
    expect(html).toContain('<span class="bar">[withheld]</span>');
    expect(html.replace(/<[^>]+>/g, ' ')).toMatch(/The cloud was shown\s+She walks home and\s+\[withheld\]\s+Your device knows\s+has to leave at the last bell/);
  });

  it('says so when the words were in no text that was sent, and shows nothing for an item no rule caught', () => {
    const typed = renderToStaticMarkup(<Caught check={{ verdict: 'conflict', reason: 'r', by: 'rule', constraintId: 'a' }} constraint={constraint} />);
    expect(typed).toContain('Nothing of this: the words are not in the text that was sent.');
    expect(renderToStaticMarkup(<Caught check={{ verdict: 'fits', reason: 'r' }} constraint={constraint} />)).toBe('');
  });
});

describe('the first screen', () => {
  it('is one sentence and the ways in: no form, and no recorded run until the file has been read and is in the right form', () => {
    const text = renderToStaticMarkup(<App />).replace(/<[^>]+>/g, ' ');
    expect(text).toMatch(/Your device knows the child\.\s+The cloud only knows the need\./);
    expect(text).toContain('Try an invented class');
    expect(text).toContain('Write a note');
    expect(text).not.toContain('Run the guard');
    expect(renderToStaticMarkup(<App />)).not.toContain('<textarea');
    expect(text).not.toContain('Watch a recorded run');
    expect(text).not.toContain('Recorded run.');
    expect(text).not.toContain('Download this run as JSON');
  });
});

describe('the words a rule matched', () => {
  const vault = buildVault('Meenal reads well.', [{ kind: 'student', text: 'Meenal', source: 'class list' }]);

  it('are marked where they stand in the text as it is read on the device', () => {
    const html = renderToStaticMarkup(
      <DeviceText text="Ask [Student 1] to stay after the last bell on Monday." entities={vault} allowed={['[Student 1]']} mark="after the last bell" />,
    );
    expect(html).toContain('<mark class="hit">after the last bell</mark>');
    expect(html.replace(/<[^>]+>/g, '')).toBe('Ask Meenal to stay after the last bell on Monday.');
  });

  it('are marked across a name that was put back, and nothing is marked when they are not there', () => {
    const across = renderToStaticMarkup(<DeviceText text="Keep [Student 1] late." entities={vault} allowed={['[Student 1]']} mark="Keep Meenal late" />);
    expect(across.replace(/<[^>]+>/g, '')).toBe('Keep Meenal late.');
    expect(across.match(/<mark class="hit">/g)).toHaveLength(3);
    expect(renderToStaticMarkup(<DeviceText text="Seat her near the door." entities={vault} mark="after school" />)).toBe('Seat her near the door.');
  });
});

describe('the lesson as the first job', () => {
  it('says so on the first screen, and names the steps of a lesson', async () => {
    const { Hero } = await import('./Hero');
    const { LESSON_STEPS, STEPS, Stepper } = await import('./parts');
    const html = renderToStaticMarkup(<Hero onTry={() => {}} onWrite={() => {}} noModel={false} />);
    expect(html).toContain('Your device knows the child.');
    expect(html).toContain('Plan tomorrow&#x27;s lesson for the whole class. The cloud writes for each need without knowing whose it is. Your device puts it beside the right child.');
    expect(html).toContain('Need B: no phone or internet at home');
    // The name is on the device's side only, and the cloud's side has no sentence about one pupil.
    expect(html.slice(html.indexOf('mini cloud'))).not.toContain('Tanvi');
    expect(html.slice(html.indexOf('mini cloud'))).not.toContain('[Student');
    expect(LESSON_STEPS).toEqual(['Write', 'What leaves', 'Lesson', 'Beside each child', 'Sign off']);
    expect(renderToStaticMarkup(<Stepper step={3} lesson />)).toContain('Beside each child');
    expect(renderToStaticMarkup(<Stepper step={3} />)).toContain(STEPS[3]);
  });

  it('without the on-device model, promotes the recorded run with Gemini Nano as the single primary CTA', async () => {
    const { Hero } = await import('./Hero');
    const buttons = (html: string) => [...html.matchAll(/<button class="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]);
    const without = renderToStaticMarkup(<Hero onTry={() => {}} onWrite={() => {}} onWatch={() => {}} noModel />);
    expect(buttons(without)).toEqual([
      ['primary big', 'Watch a recorded run with Gemini Nano'],
      ['secondary big', 'Try live (rules + cloud)'],
      ['secondary big', 'Write a note'],
    ]);
    expect(without).toContain('This browser has no on-device model');
    // With the model, the layout is as it was: the recorded run is a link.
    expect(buttons(renderToStaticMarkup(<Hero onTry={() => {}} onWrite={() => {}} onWatch={() => {}} noModel={false} />))).toEqual([
      ['primary big', 'Try an invented class'],
      ['secondary big', 'Write a note'],
      ['link', 'Watch a recorded run'],
    ]);
    // With no recorded run to watch, nothing offers one.
    expect(renderToStaticMarkup(<Hero onTry={() => {}} onWrite={() => {}} noModel />)).not.toContain('Watch a recorded run');
  });
});

describe('MaterialsPages', () => {
  const result: Materials = {
    board: ['A place'],
    sheet: ['Name the place.', 'Q2', 'Q3', 'Q4', 'Q5'],
    versions: [{ need: 'G', note: 'Hand this out once the class sheet is done.', items: ['Write a second paragraph about a market.', 'Use three sound words.', 'Underline your best sentence.'] }],
    ticket: [1, 2, 3].map((n) => ({ question: `T${n}?`, answer: `A${n}` })),
    dropped: 0,
    same: [],
    missing: [],
  };
  const pages = (withNames: boolean) =>
    renderToStaticMarkup(<MaterialsPages title="A place" result={result} namesFor={(l) => (l === 'G' ? ['Ishaan Verma'] : [])} withNames={withNames} />)
      .split('<div class="print-page">')
      .slice(1);

  it("prints each need's sheet as a page of its own, with its own lines numbered and not the class questions", () => {
    const [, sheetG] = pages(true);
    expect(sheetG).toContain('<h1>Sheet for Need G</h1>');
    expect(sheetG).toContain('<li>Write a second paragraph about a market.</li>');
    expect(sheetG).not.toContain('Name the place.');
    // What the cloud wrote for the teacher is on the teacher's copy, not on the pupil's page.
    expect(sheetG).not.toContain('Hand this out');
    expect(pages(true).at(-1)).toContain('Need G (Ishaan Verma): Hand this out once the class sheet is done.');
  });

  it('puts the names over a sheet only on the teacher’s print, and never on the class sheet', () => {
    const named = pages(true);
    expect(named[1]).toContain('<p class="print-names">Ishaan Verma</p>');
    expect(named[0]).not.toContain('Ishaan');
    expect(pages(false).join('')).not.toContain('Ishaan');
  });
});

describe('NetworkSection', () => {
  it('lists each model step with what the browser recorded during it, by host and path only', () => {
    const requests = addRequests([], [
      { name: 'https://content-firebaseappcheck.googleapis.com/v1/projects/p/apps/a:exchangeToken?key=SECRET', startTime: 1500, initiatorType: 'fetch' },
      { name: 'https://firebasevertexai.googleapis.com/v1beta/m:generateContent?key=SECRET', startTime: 6000, initiatorType: 'fetch' },
    ]);
    const record = { list: () => requests, subscribe: () => () => {} };
    const html = renderToStaticMarkup(
      <NetworkSection
        network={record}
        steps={[
          { step: 'guard', start: 1000, end: 3000, where: 'ON_DEVICE' },
          { step: 'draft', start: 5000, end: 8000, where: 'IN_CLOUD' },
        ]}
      />,
    );
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).toContain('Network, as the browser records it');
    expect(text).toContain('Guard (on this device): 0 requests to the model host, 1 other request');
    expect(text).toContain('content-firebaseappcheck.googleapis.com: App Check');
    expect(text).toContain('Draft (in the cloud): 1 request to the model host');
    expect(html).not.toMatch(/SECRET|\?key/);
    expect(renderToStaticMarkup(<NetworkSection network={record} steps={[]} />)).toContain('No model step has run in this tab yet.');
    const replayHtml = renderToStaticMarkup(
      <NetworkSection
        network={record}
        steps={[]}
        isReplay
        replayInfo={{ guard: 'ON_DEVICE', draft: 'IN_CLOUD', check: 'ON_DEVICE', draftModel: 'gemini-3.5-flash-lite', hasMaterials: true }}
      />,
    );
    expect(replayHtml).toContain('0 model requests were made in this tab during replay');
    expect(replayHtml).toContain('Guard (on the device)');
    expect(replayHtml).toContain('Draft (in the cloud · gemini-3.5-flash-lite)');
    expect(replayHtml).toContain('Materials (in the cloud · gemini-3.5-flash-lite)');
  });
});

describe('Stepper and CopyPreview', () => {
  it('renders interactive step buttons when onStep is supplied', () => {
    const html = renderToStaticMarkup(<Stepper step={2} lesson onStep={() => {}} />);
    expect(html).toContain('<button type="button" class="step-btn"');
    expect(html).toContain('Lesson');
  });

  it('keeps student names out of the anonymous class copy inside CopyPreview', () => {
    const html = renderToStaticMarkup(
      <CopyPreview
        title="Describing a place"
        meta="Class 4 · English"
        stages={[{ heading: 'Starter', text: 'Look at the market picture together.' }]}
        variations={[{ itemIndex: 0, need: 'B', text: 'Give two printed photos.' }]}
        adjustments={[{ child: 'Meenal', itemIndex: 0, text: 'Give two printed photos.', source: 'cloud', need: 'B' }]}
      />,
    );
    const [classSheet, teacherSheet] = html.split('preview-sheet teacher-copy');
    expect(classSheet).toContain('Class copy · no names');
    expect(classSheet).toContain('For Need B: Give two printed photos.');
    expect(classSheet).not.toContain('Meenal');
    expect(teacherSheet).toContain('Meenal');
    expect(teacherSheet).toContain('Give two printed photos.');
  });
});
