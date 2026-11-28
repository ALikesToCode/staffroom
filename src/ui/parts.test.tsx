import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVault } from '../core/vault';
import { CloudText, DeviceText, REPLAY_LESSON_STEPS, Stepper } from './parts';
import { Caught, ConstraintsPanel } from './Constraints';
import type { Constraint } from '../core/types';
import { App } from '../App';
import { MaterialsCard, MATERIALS_NOTE_LOCAL, MaterialsPages } from './Materials';
import { CopyPreview } from './PrintPreview';
import { Drawer, NetworkSection, Receipts } from './pages';
import { AppHeader } from './AppHeader';
import { ReviewCard } from './ReviewCard';
import { GuardingCard } from './ComposeCards';
import { Hero } from './Hero';
import { addRequests } from '../core/network';
import type { Materials } from '../core/materials';
import { readSignOutBlocked, SIGNOUT_BLOCKED_KEY, writeSignOutBlocked } from '../app/storage';

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
    expect(text).toContain('Add something about a child');
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
    expect(text).toContain('Take a photo of my notebook');
    expect(text).toContain('Type instead');
    expect(text).toContain('Try a sample class');
    expect(text).not.toContain('Hide private details');
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
    expect(html).toContain('Plan tomorrow&#x27;s lesson for the whole class.');
    expect(html).toContain('Need B: no phone or internet at home');
    // The name is on the device's side only, and the cloud's side has no sentence about one pupil.
    expect(html.slice(html.indexOf('mini cloud'))).not.toContain('Tanvi');
    expect(html.slice(html.indexOf('mini cloud'))).not.toContain('[Student');
    expect(LESSON_STEPS).toEqual(['Write', 'Check what leaves', 'Lesson', 'For each child', 'Finish']);
    expect(renderToStaticMarkup(<Stepper step={3} lesson />)).toContain('For each child');
    expect(renderToStaticMarkup(<Stepper step={3} />)).toContain(STEPS[3]);
  });

  it('without the on-device model, promotes the recorded run with Gemini Nano as the single primary CTA', async () => {
    const { Hero } = await import('./Hero');
    const buttons = (html: string) => [...html.matchAll(/<button class="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => [m[1], m[2].replace(/<span class="btn-hi"[^>]*>.*?<\/span>/g, '').trim()]);
    const without = renderToStaticMarkup(<Hero onTry={() => {}} onWrite={() => {}} onWatch={() => {}} noModel />);
    expect(buttons(without)).toEqual([
      ['primary big', 'Watch a recorded run with Gemini Nano'],
      ['link', 'Try a sample class (rules + cloud)'],
      ['link', 'Type instead'],
    ]);
    expect(without).toContain('This browser cannot run the local model');
    // With the model, the primary button is notebook photo first and recorded run is a visible secondary button.
    expect(buttons(renderToStaticMarkup(<Hero onTry={() => {}} onWrite={() => {}} onWatch={() => {}} noModel={false} />))).toEqual([
      ['primary big', 'Take a photo of my notebook'],
      ['secondary', 'Watch a recorded run'],
      ['link', 'Type instead'],
      ['link', 'Try a sample class'],
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
        replayInfo={{
          where: { scan: 'ON_DEVICE', guard: 'ON_DEVICE', draft: 'IN_CLOUD', check: 'ON_DEVICE', label: 'ON_DEVICE' },
          draftModel: 'gemini-3.5-flash-lite',
          hasMaterials: true,
          networkSteps: [
            { step: 'scan', where: 'ON_DEVICE', durationMs: 7100, modelRequests: 0, otherRequests: 0 },
            { step: 'guard', where: 'ON_DEVICE', durationMs: 4100, modelRequests: 0, otherRequests: 0 },
            { step: 'draft', where: 'IN_CLOUD', durationMs: 2800, modelRequests: 1, otherRequests: 0 },
          ],
        }}
      />,
    );
    expect(replayHtml).toContain('0 model requests were made during replay');
    expect(replayHtml).toContain('Scan notebook (on the device)');
    expect(replayHtml).toContain('Guard (on the device)');
    expect(replayHtml).toContain('Draft (in the cloud)');
    const noStepsHtml = renderToStaticMarkup(
      <NetworkSection
        network={record}
        steps={[]}
        isReplay
        replayInfo={{ where: { guard: 'ON_DEVICE', draft: 'IN_CLOUD', check: 'ON_DEVICE' }, draftModel: 'gemini-3.5-flash-lite', hasMaterials: false }}
      />,
    );
    expect(noStepsHtml).toContain('Per-step Resource Timing counts were not recorded in this capture.');
  });
});

describe('Stepper and CopyPreview', () => {
  it('renders interactive step buttons when onStep is supplied and supports 4-step replay mode', () => {
    const html = renderToStaticMarkup(<Stepper step={2} lesson onStep={() => {}} />);
    expect(html).toContain('<button type="button" class="step-btn"');
    expect(html).toContain('Lesson');
    const replayHtml = renderToStaticMarkup(<Stepper step={2} lesson steps={REPLAY_LESSON_STEPS} onStep={() => {}} />);
    expect(replayHtml.match(/<li /g)).toHaveLength(4);
    expect(replayHtml).toContain('Lesson &amp; each child');
    expect(replayHtml).not.toContain('>For each child<');
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

describe('MaterialsCard offline copy and Drawer semantics', () => {
  it('uses on-device provenance wording instead of cloud wording when onDevice is true', () => {
    const html = renderToStaticMarkup(
      <MaterialsCard
        request="Class 6"
        stopped={[]}
        busy={false}
        fail={null}
        result={{
          board: ['Line 1'],
          sheet: ['Q1'],
          versions: [],
          ticket: [{ question: 'TQ', answer: 'TA' }],
          dropped: 0,
          same: ['A'],
          missing: ['B'],
        }}
        issues={[]}
        where="The cloud failed, so the on-device model wrote these"
        onDevice
        namesFor={(l) => (l === 'B' ? ['Tanvi'] : [])}
        onSend={() => {}}
      />,
    );
    expect(html).toContain(MATERIALS_NOTE_LOCAL);
    expect(html).toContain('the on-device draft says');
    expect(html).toContain('The on-device model wrote no sheet with lines on it for Need B (Tanvi)');
    expect(html).not.toContain('The cloud wrote');
  });

  it('renders accessible modal dialog markup in Drawer', () => {
    const html = renderToStaticMarkup(
      <Drawer title="Where each step ran" onClose={() => {}}>
        <button type="button">Inner action</button>
      </Drawer>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Where each step ran"');
    expect(html).toContain('Inner action');
  });

  it('keeps the Firestore receipt opt-in switch clickable while signed out when Firebase is available', () => {
    const enabledHtml = renderToStaticMarkup(
      <Receipts
        receipts={[]}
        keepCopies={false}
        setKeepCopies={() => {}}
        signedIn={false}
        canKeepCopies
        records={{ state: 'idle' }}
        onClear={() => {}}
      />,
    );
    expect(enabledHtml).toContain('Turning this on signs this browser back in anonymously.');
    expect(enabledHtml).not.toMatch(/<input type="checkbox"[^>]*disabled/);

    const disabledHtml = renderToStaticMarkup(
      <Receipts
        receipts={[]}
        keepCopies={false}
        setKeepCopies={() => {}}
        signedIn={false}
        canKeepCopies={false}
        records={{ state: 'idle' }}
        onClear={() => {}}
      />,
    );
    expect(disabledHtml).toContain('Not available: no Firebase project is connected.');
    expect(disabledHtml).toMatch(/<input type="checkbox"[^>]*disabled/);
  });
});

describe('AppHeader and ReviewCard', () => {
  it('renders the persistent sign-out failure pill with Retry sign-out action and the ok reset pill', () => {
    const failedHtml = renderToStaticMarkup(
      <AppHeader
        landing={false}
        view="desk"
        setView={() => {}}
        lessonsCount={0}
        receiptsCount={0}
        device="available"
        download={null}
        onTurnOnDevice={() => {}}
        online
        configured
        install={null}
        deskCleared="signout-failed"
        onRetrySignOut={() => {}}
        canClearDesk={false}
        onClearDesk={() => {}}
      />,
    );
    expect(failedHtml).toContain('Browser data cleared; sign-out failed — close this browser or');
    expect(failedHtml).toContain('inline-retry');
    expect(failedHtml).toContain('Retry sign-out');

    const okHtml = renderToStaticMarkup(
      <AppHeader
        landing={false}
        view="desk"
        setView={() => {}}
        lessonsCount={1}
        receiptsCount={2}
        device="available"
        download={null}
        onTurnOnDevice={() => {}}
        online
        configured
        install={null}
        deskCleared="ok"
        onRetrySignOut={() => {}}
        canClearDesk
        onClearDesk={() => {}}
      />,
    );
    expect(okHtml).toContain('Desk cleared from this browser');
    expect(okHtml).toContain('Clear desk');
  });

  it('shows the honest Exit gate label and calm unanchored phrase caution inside ReviewCard', () => {
    const html = renderToStaticMarkup(
      <ReviewCard
        violations={[]}
        nothingWithheld={false}
        partOfNote={false}
        guardWhere="ON_DEVICE"
        guardGaps={{ unread: [], dropped: 2, partial: 0 }}
        notePartsCount={1}
        replay={false}
        taskLabel="Class lesson"
        outgoing="[Student 1] reads well."
        isLesson
        activeNeed={null}
        onHoverNeed={() => {}}
        notSentCount={0}
      />,
    );
    expect(html).toContain('No names or numbers found. Please read it once.');
    expect(html).toContain('Exit gate: 0 found');
    expect(html).toContain('Going to Google&#x27;s Gemini:');
    expect(html).toContain('Staying on this computer:');
    expect(html).toContain('unanchored phrases (often paraphrases rather than exact words in your note)');
    expect(html).not.toContain('so they were not withheld');
  });

  it('disables Keep a copy and hides remote records while Clear desk sign-out is blocked', () => {
    const html = renderToStaticMarkup(
      <Receipts
        receipts={[]}
        keepCopies={false}
        setKeepCopies={() => {}}
        signedIn={false}
        signOutBlocked
        canKeepCopies
        records={{ state: 'idle' }}
        onClear={() => {}}
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('Sign-out failed after Clear desk — use Retry sign-out above before turning copies back on.');
    expect(html).not.toContain('Records in your account');
  });

  it('persists signoutBlocked across cleared tab sessionStorage on shared browsers and clears cleanly on retry', () => {
    const store = (init: Record<string, string> = {}) => {
      const m = new Map(Object.entries(init));
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => {
          m.set(k, v);
        },
        removeItem: (k: string) => {
          m.delete(k);
        },
        clear: () => m.clear(),
        key: (i: number) => [...m.keys()][i] ?? null,
        get length() {
          return m.size;
        },
      } as Storage;
    };
    const origLocal = globalThis.localStorage;
    const origSession = globalThis.sessionStorage;
    const localMock = store();
    const sessionMock = store();
    Object.defineProperty(globalThis, 'localStorage', { value: localMock, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: sessionMock, configurable: true });
    try {
      writeSignOutBlocked(true);
      expect(readSignOutBlocked()).toBe(true);
      sessionMock.clear();
      expect(localMock.getItem(SIGNOUT_BLOCKED_KEY)).toBe('true');
      expect(readSignOutBlocked()).toBe(true);
      writeSignOutBlocked(false);
      expect(readSignOutBlocked()).toBe(false);
      expect(localMock.getItem(SIGNOUT_BLOCKED_KEY)).toBeNull();

      // Local storage is authoritative when accessible (no stale session desync)
      sessionMock.setItem(SIGNOUT_BLOCKED_KEY, 'true');
      expect(readSignOutBlocked()).toBe(false);

      // Falls back gracefully to sessionStorage if localStorage throws
      Object.defineProperty(globalThis, 'localStorage', {
        get() {
          throw new Error('localStorage disabled');
        },
        configurable: true,
      });
      writeSignOutBlocked(true);
      expect(readSignOutBlocked()).toBe(true);
      writeSignOutBlocked(false);
      expect(readSignOutBlocked()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: origLocal, configurable: true });
      Object.defineProperty(globalThis, 'sessionStorage', { value: origSession, configurable: true });
    }
  });

  it('shows plain-English download progress and Watch a recorded run while guarding or awaiting Nano download', () => {
    const dlHtml = renderToStaticMarkup(
      <GuardingCard download={0.42} progress="ignored" onWatch={() => {}} />,
    );
    expect(dlHtml).toContain('Downloading Gemini Nano in Chrome (42%)…');
    expect(dlHtml).toContain('value="42"');
    expect(dlHtml).toContain('Chrome is downloading the on-device model (several GB)');
    expect(dlHtml).toContain('Watch a recorded run');

    const runHtml = renderToStaticMarkup(
      <GuardingCard download={null} progress="Gemini Nano is reading part 2 of 4 on this device" onWatch={() => {}} />,
    );
    expect(runHtml).toContain('Gemini Nano is reading part 2 of 4 on this device');
    expect(runHtml).not.toContain('<progress');
    expect(runHtml).toContain('Watch a recorded run');

    const heroHtml = renderToStaticMarkup(
      <Hero onTry={() => {}} onWrite={() => {}} onWatch={() => {}} noModel={false} needsDownload />,
    );
    expect(heroHtml).toContain('First run downloads Gemini Nano in Chrome (several GB)');
  });
});
