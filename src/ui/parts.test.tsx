import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVault } from '../core/vault';
import { CloudText, DeviceText } from './parts';
import { ConstraintsPanel } from './Constraints';
import type { Constraint } from '../core/types';

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
  const actions = { onConfirm() {}, onUnconfirm() {}, onRemove() {}, onKind() {}, onTriggers() {}, onAdd() {} };
  const constraints: Constraint[] = [
    { id: 'a', kind: 'time-after', about: vault[0].id, text: 'has to leave at the last bell', source: 'rule', alsoModel: true, confirmed: false },
    { id: 'b', kind: 'contact', text: 'lives with his grandmother', who: 'parents', guardian: 'grandmother', away: true, source: 'teacher', confirmed: true },
  ];

  it('shows each constraint with its words, whose it is, who found it and whether it is confirmed', () => {
    const text = renderToStaticMarkup(
      <ConstraintsPanel constraints={constraints} students={vault} editable selection="" actions={actions} />,
    ).replace(/<[^>]+>/g, ' ');
    expect(text).toContain('has to leave at the last bell');
    expect(text).toMatch(/About Meenal · found by rule and model · not confirmed/);
    expect(text).toMatch(/About the class · added by you · confirmed by you/);
    expect(text).toContain('Adult: parents, not there to contact. Looked after by: grandmother');
    expect(text).toContain('Add a constraint');
  });

  it('offers nothing to change once the text is approved', () => {
    const html = renderToStaticMarkup(
      <ConstraintsPanel constraints={constraints} students={vault} editable={false} selection="" actions={actions} />,
    );
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Add a constraint');
  });
});
