import { describe, expect, it } from 'vitest';
import { asVersion, materialsReply, materialsText, MATERIALS_SCHEMA, MATERIALS_SYSTEM, readMaterials } from './materials';

const good = {
  board: ['Describing a place', 'see / hear / smell'],
  sheet: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
  versions: [
    { need: 'F', note: 'Read each one aloud; a partner writes the answer.', items: ['1. Say what you see.', 'Say what you hear.', 'Say one word for how it feels.'] },
    { need: 'Need B:', note: '', items: ['Look at picture 1. Name the place.', 'Write one thing you see in it.', 'Write one sound you might hear there.'] },
    { need: 'Z', note: 'Not a need that was sent.', items: ['x'] },
    { need: 'F', note: 'A second one for F.', items: ['y'] },
    { need: 'A', note: 'Use a recap card.', items: [] },
  ],
  ticket: [
    { question: 'T1?', answer: 'A1' },
    { question: 'T2?', answer: 'A2' },
    { question: 'T3?', answer: 'A3' },
    { question: 'T4?', answer: 'A4' },
  ],
};

describe('materials for a lesson', () => {
  it('sends the signed plan and the needs by letter, and nothing else', () => {
    const text = materialsText('A place\n\nStarter (5 minutes)\nLook.\nFor Need F: says it aloud.', [{ letter: 'F', line: 'finds written tests hard; can answer aloud' }]);
    expect(text).toBe(
      "Class plan to make materials for:\n\nA place\n\nStarter (5 minutes)\nLook.\nFor Need F: says it aloud.\n\nNeeds in this class (no names and no reasons are given; a need may be one pupil's or several):\nNeed F: finds written tests hard; can answer aloud\nGive a version of the sheet for every one of these letters: F. Where the sheet already suits a need, write \"same sheet.\"",
    );
    expect(materialsText('P', [], 'Hindi')).toBe('Class plan to make materials for:\n\nP\n\nLanguage of the materials: Hindi, in Devanagari script (हिन्दी, देवनागरी लिपि में)');
  });

  it('asks for the four sections and never a name', () => {
    for (const k of ['board', 'sheet', 'versions', 'ticket']) expect(MATERIALS_SCHEMA.required).toContain(k);
    expect(MATERIALS_SYSTEM).toContain('at most 8 short lines');
    expect(MATERIALS_SYSTEM).toContain('5 to 8 questions');
    expect(MATERIALS_SYSTEM).toContain('exactly 3 short questions');
    expect(MATERIALS_SYSTEM).toContain('Never write a name');
    expect(MATERIALS_SYSTEM).toContain('Do not guess who or how many');
    expect(MATERIALS_SYSTEM).toContain('exactly one for every listed need');
    expect(MATERIALS_SYSTEM).toContain('the note is exactly "same sheet."');
    // A version is a sheet the pupil works from, not an instruction that names one.
    expect(MATERIALS_SYSTEM).toContain('Never only name a resource; write out every line of it');
    expect(MATERIALS_SYSTEM).toContain('3 to 8 lines, each one line');
    expect(MATERIALS_SYSTEM).toContain('"note" is at most one sentence for the teacher');
    expect(MATERIALS_SCHEMA.properties.versions.items.required).toEqual(['need', 'note', 'items']);
  });

  it('reads the reply strictly: sections cut to size, versions only for letters that were sent, once', () => {
    const m = readMaterials(JSON.stringify(good), ['A', 'B', 'F'])!;
    expect(m.board).toHaveLength(2);
    expect(m.sheet).toHaveLength(5);
    expect(m.versions).toEqual([
      { need: 'F', note: 'Read each one aloud; a partner writes the answer.', items: ['Say what you see.', 'Say what you hear.', 'Say one word for how it feels.'] },
      { need: 'B', note: '', items: ['Look at picture 1. Name the place.', 'Write one thing you see in it.', 'Write one sound you might hear there.'] },
    ]);
    // Z was not sent and F came twice. A only named a recap card and wrote none of it, so A has no sheet.
    expect(m.dropped).toBe(2);
    expect(m.same).toEqual([]);
    expect(m.missing).toEqual(['A']);
    const all = readMaterials(
      JSON.stringify({
        ...good,
        versions: [
          { need: 'A', note: 'Same sheet.', items: [] },
          { need: 'B', note: '', items: ['same sheet'] },
          { need: 'B', note: 'A second for B.', items: ['z'] },
          { need: 'F', note: 'Answers aloud.', items: ['Say it.'] },
          // A version in the old form, with only a text: no lines, so G is missing.
          { need: 'G', text: 'Does the same sheet with a partner.' },
        ],
      }),
      ['A', 'B', 'F', 'G'],
    )!;
    expect([all.same, all.versions.map((v) => v.need), all.missing, all.dropped]).toEqual([['A', 'B'], ['F'], ['G'], 1]);
    const many = readMaterials(JSON.stringify({ ...good, versions: [{ need: 'F', note: 'n', items: Array.from({ length: 12 }, (_, i) => `line ${i}`) }] }), ['F'])!;
    expect(many.versions[0].items).toHaveLength(8);
    expect(m.ticket).toHaveLength(3);
    const long = readMaterials(JSON.stringify({ ...good, board: Array.from({ length: 12 }, (_, i) => `line ${i}`), sheet: Array.from({ length: 11 }, (_, i) => `q ${i}`) }), [])!;
    expect([long.board.length, long.sheet.length, long.versions.length]).toEqual([8, 8, 0]);
    // The return gate reads every line of every sheet.
    expect(materialsReply(m)).toContain('Sheet for Need F: Read each one aloud');
    expect(materialsReply(m)).toContain('Say one word for how it feels.');
    expect(materialsReply(m)).toContain('Sheet for Need B\nLook at picture 1. Name the place.');
    expect(materialsReply(m)).toContain('A3');
  });

  it('holds the parser with text in Devanagari', () => {
    const m = readMaterials(
      JSON.stringify({
        board: ['किसी जगह का वर्णन'],
        sheet: ['प्रश्न १', 'प्रश्न २', 'प्रश्न ३', 'प्रश्न ४', 'प्रश्न ५'],
        versions: [{ need: 'F', note: 'साथी लिखता है।', items: ['वही प्रश्न, उत्तर साथी को बोलकर बताएँ।'] }],
        ticket: [1, 2, 3].map((n) => ({ question: `प्रश्न ${n}?`, answer: `उत्तर ${n}` })),
      }),
      ['F'],
    )!;
    expect(m.versions).toEqual([{ need: 'F', note: 'साथी लिखता है।', items: ['वही प्रश्न, उत्तर साथी को बोलकर बताएँ।'] }]);
    expect(m.sheet).toHaveLength(5);
  });

  it('uses nothing of a reply that is not whole', () => {
    expect(readMaterials('not json', [])).toBeUndefined();
    expect(readMaterials('null', [])).toBeUndefined();
    expect(readMaterials(JSON.stringify({ ...good, board: [] }), [])).toBeUndefined();
    expect(readMaterials(JSON.stringify({ ...good, sheet: ['Q1', 'Q2', 'Q3', 'Q4'] }), [])).toBeUndefined();
    expect(readMaterials(JSON.stringify({ ...good, ticket: good.ticket.slice(0, 2) }), [])).toBeUndefined();
    expect(readMaterials(JSON.stringify({ ...good, ticket: [{ question: 'a' }, { question: 'b', answer: 'c' }, { question: 'd', answer: 'e' }] }), [])).toBeUndefined();
  });
  it('takes off a number the cloud put in front of a question, since the page numbers them', () => {
    const raw = JSON.stringify({ board: ['B'], sheet: ['1. One', '2) Two', 'Q3. Three', '4: Four', '5. Five', '10 apples in a bag'], versions: [], ticket: [1, 2, 3].map((n) => ({ question: `${n}. Q${n}`, answer: 'A' })) });
    const m = readMaterials(raw, [])!;
    expect(m.sheet).toEqual(['One', 'Two', 'Three', 'Four', 'Five', '10 apples in a bag']);
    expect(m.ticket.map((t) => t.question)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('reads a version kept before the lines were asked for: its text is the note, with no lines', () => {
    expect(asVersion({ need: 'G', text: 'Writes a second paragraph.' })).toEqual({ need: 'G', note: 'Writes a second paragraph.', items: [] });
    expect(asVersion({ need: 'G', note: 'n', items: ['a', 'b'] })).toEqual({ need: 'G', note: 'n', items: ['a', 'b'] });
  });
});
