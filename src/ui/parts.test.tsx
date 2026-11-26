import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVault } from '../core/vault';
import { CloudText, DeviceText } from './parts';

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
