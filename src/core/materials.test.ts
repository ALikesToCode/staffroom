import { describe, expect, it } from 'vitest';
import { materialsReply, materialsText, MATERIALS_SCHEMA, MATERIALS_SYSTEM, readMaterials } from './materials';

const good = {
  board: ['Describing a place', 'see / hear / smell'],
  sheet: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
  versions: [
    { need: 'F', text: 'Same questions, answered aloud to a partner who writes.' },
    { need: 'Need B:', text: 'Uses the printed pictures.' },
    { need: 'Z', text: 'Not a need that was sent.' },
    { need: 'F', text: 'A second one for F.' },
    { need: 'A', text: '  ' },
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
    expect(MATERIALS_SYSTEM).toContain('the text is exactly "same sheet."');
  });

  it('reads the reply strictly: sections cut to size, versions only for letters that were sent, once', () => {
    const m = readMaterials(JSON.stringify(good), ['A', 'B', 'F'])!;
    expect(m.board).toHaveLength(2);
    expect(m.sheet).toHaveLength(5);
    expect(m.versions).toEqual([
      { need: 'F', text: 'Same questions, answered aloud to a partner who writes.' },
      { need: 'B', text: 'Uses the printed pictures.' },
    ]);
    expect(m.dropped).toBe(3);
    expect(m.same).toEqual([]);
    expect(m.missing).toEqual(['A']);
    const all = readMaterials(JSON.stringify({ ...good, versions: [{ need: 'A', text: 'Same sheet.' }, { need: 'B', text: 'same sheet' }, { need: 'B', text: 'A second for B.' }, { need: 'F', text: 'Answers aloud.' }] }), ['A', 'B', 'F', 'G'])!;
    expect([all.same, all.versions.map((v) => v.need), all.missing, all.dropped]).toEqual([['A', 'B'], ['F'], ['G'], 1]);
    expect(m.ticket).toHaveLength(3);
    const long = readMaterials(JSON.stringify({ ...good, board: Array.from({ length: 12 }, (_, i) => `line ${i}`), sheet: Array.from({ length: 11 }, (_, i) => `q ${i}`) }), [])!;
    expect([long.board.length, long.sheet.length, long.versions.length]).toEqual([8, 8, 0]);
    expect(materialsReply(m)).toContain('Sheet for Need F: Same questions');
    expect(materialsReply(m)).toContain('A3');
  });

  it('holds the parser with text in Devanagari', () => {
    const m = readMaterials(
      JSON.stringify({
        board: ['किसी जगह का वर्णन'],
        sheet: ['प्रश्न १', 'प्रश्न २', 'प्रश्न ३', 'प्रश्न ४', 'प्रश्न ५'],
        versions: [{ need: 'F', text: 'वही प्रश्न, उत्तर साथी को बोलकर बताएँ।' }],
        ticket: [1, 2, 3].map((n) => ({ question: `प्रश्न ${n}?`, answer: `उत्तर ${n}` })),
      }),
      ['F'],
    )!;
    expect(m.versions).toEqual([{ need: 'F', text: 'वही प्रश्न, उत्तर साथी को बोलकर बताएँ।' }]);
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
});
