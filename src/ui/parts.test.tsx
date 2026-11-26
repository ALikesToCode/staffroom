import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVault } from '../core/vault';
import { CloudText, DeviceText } from './parts';
import { Caught, ConstraintsPanel } from './Constraints';
import type { Constraint } from '../core/types';
import { App } from '../App';

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
    expect(text).toMatch(/About Meenal · found by rule and model · not confirmed/);
    expect(text).toMatch(/About the class · added by you · confirmed by you/);
    expect(text).toContain('Adult: parents, not there to contact. Looked after by: grandmother');
    expect(text).toContain('Add a constraint');
    // The need line that would be sent is shown beside the switch, before it is switched on.
    expect(text).toContain('Tell the cloud the need (not the reason)');
    expect(text).toMatch(/If you switch this on, the cloud will be told:\s+\[Student 1\] cannot stay after the last bell\./);
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
  it('offers the guard, and no recorded run until the file has been read and is in the right form', () => {
    const text = renderToStaticMarkup(<App />).replace(/<[^>]+>/g, ' ');
    expect(text).toContain('Run the guard');
    expect(text).not.toContain('Watch a recorded run');
    expect(text).not.toContain('Recorded run.');
    expect(text).not.toContain('Download this run as JSON');
  });
});
