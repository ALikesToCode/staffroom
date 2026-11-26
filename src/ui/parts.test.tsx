import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CloudText } from './parts';

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
