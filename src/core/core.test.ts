import indexHtml from '../../index.html?raw';
import firestoreRules from '../../firestore.rules?raw';
import { describe, expect, it, vi } from 'vitest';
import { findByRule, findSensitive, nameParts, sentences } from './rules';
import {
  addByTeacher,
  applyLocks,
  bracketBare,
  bracketDraft,
  insidePrivate,
  buildVault,
  deterministicCandidates,
  possibleNameCandidates,
  redact,
  redactWithTokens,
  restore,
  segment,
  widenToWords,
  PRIVATE_TOKEN,
} from './vault';
import { checkOutgoing, checkReply } from './gate';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE, TASKS } from './samples';
import { DRAFT_FORMAT, DRAFT_NOTES_HEADING, draftPrompt, LABEL_CHARS, labelPrompt } from '../ai/draft';
import { NOTE_MAX, plainText } from './text';

/** The sample note as it goes out when no model read it: class list, patterns, sensitive words and capitalised words only. */
const RULES_ONLY_SAMPLE = `Class 6B, week of 16 November. Notes for myself.

[Student 1] has missed four days this month. [withheld]. He is bright in maths but has not handed in homework for two weeks.

[Student 2] reads well aloud but freezes in written tests. She needs extra writing practice, and the remedial writing club meets after the last bell. [withheld]. Her [ID 1]. She walks six kilometres home to [Place 1] and has to leave school at the last bell to reach home before dark.

[Student 3] and [Student 5] fight most days during group work. [withheld]. [Student 5] finishes early and gets bored.

[Student 4] is far ahead in reading. She could help others, but she is shy.`;

describe('pattern rules', () => {
  it('finds phone numbers, emails and identity numbers', () => {
    const hits = findByRule(
      'Call 98765 43210 or +91-9876543210, mail r.k@example.org. Aadhaar 1234 5678 9012. Roll no. 6B/23. DOB: 04/07/2014',
    );
    expect(hits.map((h) => h.rule)).toEqual([
      'phone number',
      'phone number',
      'email address',
      '12-digit identity number',
      'roll or admission number',
      'date of birth',
    ]);
  });

  it('finds a roll number written out in a sentence', () => {
    expect(findByRule('Her roll number is 6B/23 and his roll no. was 14.').map((h) => [h.rule, h.text])).toEqual([
      ['roll or admission number', 'roll number is 6B/23'],
      ['roll or admission number', 'roll no. was 14'],
    ]);
    expect(findByRule('The roll was called at nine. The bread roll is 5 rupees.')).toEqual([]);
  });

  it('finds a single-digit roll number after "no." or "number"', () => {
    expect(findByRule('Roll no. 5 sits by roll number 7.').map((h) => h.text)).toEqual(['Roll no. 5', 'roll number 7']);
    const note = 'Roll no. 5 was late.';
    expect(redact(note, buildVault(note, deterministicCandidates(note, [])))).toBe('[ID 1] was late.');
  });

  it('withholds the whole of two patterns that overlap', () => {
    const note = 'Roll no. 98765 43210 is hers.';
    expect(findByRule(note).map((h) => [h.rule, h.text])).toEqual([
      ['roll or admission number', 'Roll no. 98765'],
      ['phone number', '98765 43210'],
    ]);
    const v = buildVault(note, deterministicCandidates(note, []));
    expect(redact(note, v)).toBe('[ID 1][Contact 1] is hers.');
    expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
  });

  it('finds a number written with brackets, odd spaces or a spaced prefix, in the rules and at the gate', () => {
    const cases: [string, string, string][] = [
      ['Ring (98765) 43210 after four.', 'Ring [Contact 1] after four.', 'phone number'],
      ['Ring (+91) 98765 43210 after four.', 'Ring [Contact 1] after four.', 'phone number'],
      ['Office (022) 2345 6789 today.', 'Office [Contact 1] today.', 'phone number'],
      ['Aadhaar 1234\u00A05678\u202F9012 seen.', 'Aadhaar [ID 1] seen.', '12-digit identity number'],
      ['Ring 98765\u00A043210 after four.', 'Ring [Contact 1] after four.', 'phone number'],
      ['Admission no. AB 12345 is new.', '[ID 1] is new.', 'roll or admission number'],
      ['Her card says AB 12345 on it.', 'Her card says [ID 1] on it.', 'roll or admission number'],
    ];
    for (const [note, out, rule] of cases) {
      const v = buildVault(note, deterministicCandidates(note, []));
      expect(redact(note, v)).toBe(out);
      expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
      // The gate, given the raw text and an empty vault, stops it on its own.
      expect(checkOutgoing(note, []).map((x) => x.why)).toContain(`looks like a ${rule}`);
    }
    expect(findByRule('He scored (45) 50 38 in three tests. Admission number for 2026 is open.')).toEqual([]);
  });

  it('finds a listed name whichever way its accent is typed', () => {
    const composed = 'Jos\u00E9';
    const apart = 'Jose\u0301';
    for (const [listed, written] of [[composed, apart], [apart, composed], [composed, composed]]) {
      const note = `${written} is late. Jose is not.`;
      const v = buildVault(note, deterministicCandidates(note, [listed]));
      expect(redact(note, v)).toBe('[Student 1] is late. Jose is not.');
      expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
      expect(checkOutgoing(note, v).map((x) => x.why)).toEqual(['a withheld student name is still in the text']);
    }
  });

  it('leaves ordinary numbers and dates alone', () => {
    expect(findByRule('Class 6B scored 42 out of 50 on 16 November 2026. 4 days absent.')).toEqual([]);
  });

  it('drops honorifics from names', () => {
    expect(nameParts('Mrs. Kavita Rao')).toEqual(['Kavita', 'Rao']);
  });

  it('never treats a kinship word or a pronoun as part of a name', () => {
    expect(nameParts('his mother Sunita')).toEqual(['Sunita']);
    expect(nameParts('Their grandmother')).toEqual([]);
    const note = 'His mother Sunita rang. His sister and her teacher came.';
    const v = buildVault(note, [
      { kind: 'adult', text: 'His mother Sunita', source: 'on-device model' },
      { kind: 'adult', text: 'sister', source: 'on-device model' },
    ]);
    expect(v.map((e) => e.surfaces)).toEqual([['His mother Sunita', 'Sunita']]);
    expect(redact(note, v)).toBe('[Adult 1] rang. His sister and her teacher came.');
  });
});

describe('sensitive words', () => {
  it('withholds the whole sentence around a sensitive word in the sample note', () => {
    expect(findSensitive(SAMPLE_NOTE).map((h) => [h.category, h.text])).toEqual([
      [
        'family',
        'His mother Sunita told me on the phone (98765 43210) that his father lost his job at the mill and Aarav now helps at the family tea stall before school',
      ],
      ['health', 'She told me she has epilepsy and is afraid of having a seizure in the exam hall'],
      ['family', "Kabir's parents are separating and he is staying with his grandmother"],
    ]);
    for (const h of findSensitive(SAMPLE_NOTE)) expect(SAMPLE_NOTE.slice(h.start, h.end)).toBe(h.text);
  });

  it('needs no model: the rules-only vault hides those sentences', () => {
    const v = buildVault(SAMPLE_NOTE, deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST));
    const details = v.filter((e) => e.kind === 'private');
    expect(details.map((e) => e.source)).toEqual(['rule', 'rule', 'rule']);
    const out = redact(SAMPLE_NOTE, v);
    for (const leaked of ['epilepsy', 'seizure', 'lost his job', 'separating', 'tea stall', 'Sunita', '98765']) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('[Student 1] has missed four days this month. [withheld]. He is bright in maths');
    expect(checkOutgoing(out, v)).toEqual([]);
  });

  it('matches whole words in any case, and a plain plural', () => {
    expect(findSensitive('He takes MEDICATION daily. She had two seizures.')).toHaveLength(2);
    expect(findSensitive('The casters on the trolley broke. Debtors and hospitality were the topics.')).toEqual([]);
  });

  it('does not end a sentence at an abbreviation or inside a number', () => {
    expect(sentences('Her roll no. 6B/23 is new. Mrs. Rao came at 3.30 today!\nNext line').map((s) => s.text)).toEqual([
      'Her roll no. 6B/23 is new',
      'Mrs. Rao came at 3.30 today',
      'Next line',
    ]);
  });
});

describe('vault', () => {
  const candidates = [
    ...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST),
    { kind: 'adult' as const, text: 'Sunita', source: 'on-device model' as const },
    { kind: 'place' as const, text: 'Rampur Kalan', source: 'on-device model' as const },
    {
      kind: 'private' as const,
      text: 'she has epilepsy and is afraid of having a seizure in the exam hall',
      source: 'on-device model' as const,
      category: 'health',
    },
    {
      kind: 'private' as const,
      text: 'his father lost his job at the mill',
      source: 'on-device model' as const,
      category: 'money',
      aboutName: 'Aarav',
    },
    { kind: 'student' as const, text: 'Zubin', source: 'on-device model' as const },
  ];
  const vault = buildVault(SAMPLE_NOTE, candidates);
  const { text: redacted, tokens: sentTokens } = redactWithTokens(SAMPLE_NOTE, vault);

  it('treats a first name and a full name as one student', () => {
    const students = vault.filter((e) => e.kind === 'student');
    expect(students.map((s) => s.surfaces[0])).toEqual(['Aarav Sharma', 'Meenal Joshi', 'Kabir Qureshi', 'Tanvi Rao', 'Ishaan Verma']);
    expect(students[0].surfaces).toContain('Aarav');
  });

  it('keeps two students who share a surname apart', () => {
    const v = buildVault('Aarav Sharma sits with Diya Sharma.', [
      { kind: 'student', text: 'Aarav Sharma', source: 'class list' },
      { kind: 'student', text: 'Diya Sharma', source: 'class list' },
    ]);
    expect(v).toHaveLength(2);
    expect(redact('Aarav Sharma sits with Diya Sharma.', v)).toBe('[Student 1] sits with [Student 2].');
  });

  it('ignores anything the model reports that is not in the note', () => {
    expect(vault.some((e) => e.surfaces.includes('Zubin'))).toBe(false);
  });

  it('removes every name, number and private detail from the outgoing text', () => {
    for (const leaked of ['Aarav', 'Sharma', 'Meenal', 'Kabir', 'Ishaan', 'Tanvi', 'Sunita', '98765', 'epilepsy', '6B/23', 'Rampur', 'lost his job']) {
      expect(redacted).not.toContain(leaked);
    }
    expect(redacted).toContain('[Student 1] has missed four days');
    expect(redacted).not.toContain('separating');
    const kabir = vault.map((e) => (e.surfaces[0].startsWith("Kabir's parents") ? { ...e, withheld: false } : e));
    expect(redact(SAMPLE_NOTE, kabir)).toContain("[Student 3]'s parents are separating");
    expect(redacted).toContain(PRIVATE_TOKEN);
  });

  it('attaches a private detail to the right student', () => {
    const byId = (id?: string) => vault.find((e) => e.id === id)?.surfaces[0];
    const about = (start: string) => byId(vault.find((e) => e.kind === 'private' && e.surfaces[0].startsWith(start))?.about);
    expect(about('she has epilepsy')).toBe('Meenal Joshi');
    expect(about('She told me')).toBe('Meenal Joshi');
    expect(about('his father lost his job')).toBe('Aarav Sharma');
    expect(about('His mother Sunita')).toBe('Aarav Sharma');
    // A name inside the detail wins over the name nearest before it ("Kabir and Ishaan fight ...").
    expect(about("Kabir's parents")).toBe('Kabir Qureshi');
  });

  it('puts names back on the device', () => {
    expect(restore('Seat [Student 1] beside [Student 4]. Ask [Adult 1].', vault)).toBe(
      'Seat Aarav Sharma beside Tanvi Rao. Ask Sunita.',
    );
  });

  it('lets the teacher release one item and mark another', () => {
    const released = vault.map((e) => (e.surfaces[0] === 'Tanvi Rao' ? { ...e, withheld: false } : e));
    expect(redact(SAMPLE_NOTE, released)).toContain('Tanvi is far ahead');
    const marked = addByTeacher(SAMPLE_NOTE, released, 'family tea stall', 'private');
    expect(redact(SAMPLE_NOTE, marked)).not.toContain('tea stall');
    expect(redact(SAMPLE_NOTE, marked)).toContain('Tanvi is far ahead');
  });

  it('segments the note without losing a character', () => {
    expect(segment(SAMPLE_NOTE, vault).map((s) => s.text).join('')).toBe(SAMPLE_NOTE);
  });

  it('withholds a short class-list name as a whole word only', () => {
    const note = 'Om has missed school. Jo is ill. Some children join late.';
    const v = buildVault(note, deterministicCandidates(note, ['Om', 'Jo']));
    expect(v.map((e) => e.surfaces)).toEqual([['Om'], ['Jo']]);
    expect(redact(note, v)).toBe('[Student 1] has missed school. [Student 2] is ill. Some children join late.');
    expect(checkOutgoing(redact(note, v), v)).toEqual([]);
  });

  it('keeps two students apart when only a short first name differs', () => {
    const note = 'Om Rao sits with Jo Rao.';
    const v = buildVault(note, deterministicCandidates(note, ['Om Rao', 'Jo Rao']));
    expect(redact(note, v)).toBe('[Student 1] sits with [Student 2].');
  });

  it('never merges an adult into a student who shares a surname', () => {
    const note = 'Aarav Sharma was late. Mrs. Sharma rang at noon.';
    const v = buildVault(note, [
      { kind: 'student', text: 'Aarav Sharma', source: 'class list' },
      { kind: 'adult', text: 'Mrs. Sharma', source: 'on-device model' },
    ]);
    expect(v.map((e) => [e.kind, e.surfaces[0]])).toEqual([['student', 'Aarav Sharma'], ['adult', 'Mrs. Sharma']]);
    expect(redact(note, v)).toBe('[Student 1] was late. [Adult 1] rang at noon.');
    expect(restore('[Adult 1] and [Student 1]', v)).toBe('Mrs. Sharma and Aarav Sharma');
  });

  it('gives a bare surname shared by two people a stand-in of its own', () => {
    const note = 'Aarav Sharma sits with Diya Sharma. Sharma was late again.';
    const v = buildVault(note, deterministicCandidates(note, ['Aarav Sharma', 'Diya Sharma']));
    expect(v.map((e) => e.surfaces)).toEqual([['Aarav Sharma', 'Aarav'], ['Diya Sharma', 'Diya'], ['Sharma']]);
    expect(redact(note, v)).toBe('[Student 1] sits with [Student 2]. [Student 3] was late again.');
    expect(checkOutgoing(redact(note, v), v)).toEqual([]);
    // With no bare use of the surname there is nothing extra to hold.
    const plain = 'Aarav Sharma sits with Diya Sharma.';
    expect(buildVault(plain, deterministicCandidates(plain, ['Aarav Sharma', 'Diya Sharma']))).toHaveLength(2);
    // The same holds when a model reports the bare surname as a person.
    const fromModel = buildVault(note, [
      ...deterministicCandidates(note, ['Aarav Sharma', 'Diya Sharma']),
      { kind: 'student', text: 'Sharma', source: 'on-device model' },
    ]);
    expect(redact(note, fromModel)).toBe('[Student 1] sits with [Student 2]. [Student 3] was late again.');
  });

  it('keeps who a private detail is about when the teacher marks something else', () => {
    const note = 'Kabir and Ishaan fight most days. He cries at home. Rampur is far.';
    const v = buildVault(note, [
      ...deterministicCandidates(note, ['Kabir', 'Ishaan']),
      { kind: 'private', text: 'He cries at home', source: 'on-device model', aboutName: 'Kabir' },
    ]);
    const about = (list: typeof v) => list.find((e) => e.id === list.find((d) => d.kind === 'private')?.about)?.surfaces[0];
    expect(about(v)).toBe('Kabir');
    const released = v.map((e) => (e.surfaces[0] === 'Ishaan' ? { ...e, withheld: false } : e));
    const marked = addByTeacher(note, released, 'Rampur', 'place');
    expect(about(marked)).toBe('Kabir');
    expect(marked.find((e) => e.surfaces[0] === 'Ishaan')?.withheld).toBe(false);
    expect(redact(note, marked)).toBe('[Student 1] and Ishaan fight most days. [withheld]. [Place 1] is far.');
  });

  it('leaves no part of a private detail that overlaps a name', () => {
    const note = 'Aarav Sharma has epilepsy.';
    const v = buildVault(note, [
      { kind: 'student', text: 'Aarav Sharma', source: 'class list' },
      { kind: 'private', text: 'Sharma has epilepsy', source: 'teacher' },
    ]);
    expect(v.map((e) => e.surfaces[0])).toEqual(['Aarav Sharma', 'Sharma has epilepsy']);
    expect(v.every((e) => e.withheld)).toBe(true);
    const out = redact(note, v);
    for (const part of ['has epilepsy', 'has', 'epilepsy', 'Sharma', 'Aarav']) expect(out).not.toContain(part);
    expect(out).toBe('[Student 1][withheld].');
    expect(checkOutgoing(out, v)).toEqual([]);
  });

  it('withholds a short part of a listed name wherever it stands alone', () => {
    const note = 'Om Rao was absent. Om needs reading support. Some children join late.';
    const v = buildVault(note, deterministicCandidates(note, ['Om Rao']));
    expect(v.map((e) => e.surfaces)).toEqual([['Om Rao', 'Rao', 'Om']]);
    expect(redact(note, v)).toBe('[Student 1] was absent. [Student 1] needs reading support. Some children join late.');
    expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
    // A name only a model found keeps the three-letter floor for its parts.
    const fromModel = buildVault(note, [{ kind: 'student', text: 'Om Rao', source: 'on-device model' }]);
    expect(redact(note, fromModel)).toBe('[Student 1] was absent. Om needs reading support. Some children join late.');
  });

  it('withholds every part of a listed name used on its own', () => {
    const note = 'Uma and Priya need reading support.';
    const v = buildVault(note, deterministicCandidates(note, ['Uma Priya']));
    expect(redact(note, v)).toBe('[Student 1] and [Student 1] need reading support.');
    expect(restore('[Student 1]', v)).toBe('Uma Priya');
    // A part two listed people share is withheld as an item of its own.
    const two = 'Uma and Priya need reading support. Priya Nair is new.';
    const shared = buildVault(two, deterministicCandidates(two, ['Uma Priya', 'Priya Nair']));
    expect(redact(two, shared)).toBe('[Student 1] and [Student 3] need reading support. [Student 2] is new.');
    expect(checkOutgoing(redact(two, shared), shared, two)).toEqual([]);
    // A listed name that is nowhere in the note is not in the vault.
    expect(buildVault(note, deterministicCandidates(note, ['Uma Priya', 'Diya Sharma']))).toHaveLength(1);
  });

  it('widens a mark that cuts a word, so what is marked is really withheld', () => {
    const note = 'She walks home to Rampur Kalan and is staying with his grandmother.';
    const out = 'She walks home to [Place 1] and is staying with his grandmother.';
    expect(widenToWords(note, 'Rampur Kal')).toBe('Rampur Kalan');
    expect(widenToWords(note, 'mpur Kalan')).toBe('Rampur Kalan');
    expect(widenToWords(note, 'rampur  kalan')).toBe('Rampur Kalan');
    expect(widenToWords(note, 'Delhi')).toBeUndefined();
    for (const cut of ['Rampur Kal', 'mpur Kalan']) {
      const byTeacher = addByTeacher(note, [], cut, 'place');
      expect(redact(note, byTeacher)).toBe(out);
      expect(checkOutgoing(redact(note, byTeacher), byTeacher, note)).toEqual([]);
      expect(redact(note, buildVault(note, [{ kind: 'place', text: cut, source: 'on-device model' }]))).toBe(out);
    }
    const quote = buildVault(note, [{ kind: 'private', text: 'staying with his grandmoth', source: 'on-device model' }]);
    expect(redact(note, quote)).toBe('She walks home to Rampur Kalan and is [withheld].');
  });

  it('marks the word the teacher selected, not the same letters elsewhere', () => {
    const note = 'Ravi finished. Ravinder takes tablets.';
    const inside = addByTeacher(note, [], 'Ravi', 'student', { start: 15, end: 19 });
    expect(inside[0].surfaces).toEqual(['Ravinder']);
    expect(redact(note, inside)).toBe('Ravi finished. [Student 1] takes tablets.');
    expect(checkOutgoing(redact(note, inside), inside, note)).toEqual([]);
    const first = addByTeacher(note, [], 'Ravi', 'student', { start: 0, end: 4 });
    expect(redact(note, first)).toBe('[Student 1] finished. Ravinder takes tablets.');
    // A selection with stray spaces, or one that starts mid-word, is widened where it was made.
    expect(redact(note, addByTeacher(note, [], ' vinder takes', 'private', { start: 16, end: 29 }))).toBe('Ravi finished. [withheld] tablets.');
  });

  it('holds the selected place itself when the vault would otherwise leave it in the text', () => {
    const note = 'Kabir is on medication.\n\nIshaan is on medication.';
    const pinned = [{ id: 'private-1', kind: 'private' as const, token: PRIVATE_TOKEN, surfaces: ['is on medication'], source: 'on-device model' as const, withheld: true, at: 6 }];
    expect(redact(note, pinned)).toBe('Kabir [withheld].\n\nIshaan is on medication.');
    const second = note.lastIndexOf('is on medication');
    const marked = addByTeacher(note, pinned, 'is on medication', 'private', { start: second, end: second + 16 });
    expect(redact(note, marked)).toBe('Kabir [withheld].\n\nIshaan [withheld].');
    expect(checkOutgoing(redact(note, marked), marked, note)).toEqual([]);
  });

  it('widens a mark inside a longer run of letters and digits to the whole run', () => {
    const note = 'Her bus pass is XAB12345 this year.';
    const v = addByTeacher(note, [], 'AB1234', 'id');
    expect(v[0].surfaces).toEqual(['XAB12345']);
    expect(redact(note, v)).toBe('Her bus pass is [ID 1] this year.');
  });

  it('stops the send when a withheld item is nowhere in the note', () => {
    const note = 'She walks home to Rampur Kalan.';
    const ghost = [{ id: 'place-1', kind: 'place' as const, token: '[Place 1]', surfaces: ['Rampur Kal'], source: 'teacher' as const, withheld: true }];
    expect(redact(note, ghost)).toBe(note);
    expect(checkOutgoing(redact(note, ghost), ghost, note)).toEqual([{ what: 'Rampur Kal', why: 'marked but not found in the text' }]);
    expect(checkOutgoing(redact(note, ghost), [{ ...ghost[0], withheld: false }], note)).toEqual([]);
  });

  it('withholds a released item again when the teacher marks it again', () => {
    const note = 'Tanvi is shy. Ask Tanvi Rao to read.';
    const v = buildVault(note, deterministicCandidates(note, ['Tanvi Rao']));
    const released = v.map((e) => ({ ...e, withheld: false }));
    expect(redact(note, released)).toBe(note);
    const again = addByTeacher(note, released, 'Tanvi', 'place');
    expect(again).toHaveLength(1);
    expect(again[0].kind).toBe('student');
    expect(redact(note, again)).toBe('[Student 1] is shy. Ask [Student 1] to read.');
  });

  it('keeps every form of an item already in the vault when the teacher marks something new', () => {
    const note = 'Om Rao was absent. Om walks to Rampur. He is tired.';
    const v = buildVault(note, [
      ...deterministicCandidates(note, ['Om Rao']),
      { kind: 'private', text: 'He is tired', source: 'on-device model' },
    ]).map((e) => (e.kind === 'private' ? { ...e, withheld: false } : e));
    const marked = addByTeacher(note, v, 'Rampur', 'place');
    expect(marked[0].surfaces).toEqual(['Om Rao', 'Rao', 'Om']);
    expect(marked.map((e) => [e.id, e.withheld, e.about])).toEqual([
      ['student-1', true, undefined],
      ['private-1', false, 'student-1'],
      ['place-1', true, undefined],
    ]);
    expect(redact(note, marked)).toBe('[Student 1] was absent. [Student 1] walks to [Place 1]. He is tired.');
  });

  it('keeps the same private phrase about two children as two entries', () => {
    const note = 'Kabir is on medication.\n\nIshaan is on medication.';
    const v = buildVault(note, [
      { kind: 'student', text: 'Kabir', source: 'class list' },
      { kind: 'student', text: 'Ishaan', source: 'class list' },
      { kind: 'private', text: 'is on medication', source: 'on-device model', aboutName: 'Kabir' },
      { kind: 'private', text: 'is on medication', source: 'on-device model', aboutName: 'Ishaan' },
    ]);
    const details = v.filter((e) => e.kind === 'private');
    expect(details.map((d) => v.find((e) => e.id === d.about)?.surfaces[0])).toEqual(['Kabir', 'Ishaan']);
    expect(redact(note, v)).toBe('[Student 1] [withheld].\n\n[Student 2] [withheld].');
    const oneReleased = v.map((e) => (e === details[0] ? { ...e, withheld: false } : e));
    expect(redact(note, oneReleased)).toBe('[Student 1] is on medication.\n\n[Student 2] [withheld].');
    // The gate does not take the released one for a leak of the other, and still catches a real one.
    expect(checkOutgoing(redact(note, oneReleased), oneReleased, note)).toEqual([]);
    expect(checkOutgoing(note, oneReleased, note).map((v) => v.what)).toContain('is on medication');
    expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
    // A phrase the teacher marks once is withheld in both places, as two entries.
    const byTeacher = addByTeacher(note, v.filter((e) => e.kind !== 'private'), 'on medication', 'private');
    expect(byTeacher.filter((e) => e.kind === 'private').map((d) => byTeacher.find((e) => e.id === d.about)?.surfaces[0])).toEqual(['Kabir', 'Ishaan']);
    expect(redact(note, byTeacher)).toBe('[Student 1] is [withheld].\n\n[Student 2] is [withheld].');
  });

  it('never sends a stand-in the teacher typed into the note as if it were one', () => {
    const note = 'I wrote [Student 1] and [withheld] and [student 7] by hand. Aarav is here.';
    const v = buildVault(note, deterministicCandidates(note, ['Aarav']));
    const sent = redactWithTokens(note, v);
    expect(sent.text).toBe('I wrote [withheld] and [withheld] and [withheld] by hand. [Student 1] is here.');
    expect(sent.tokens).toEqual(['[withheld]', '[Student 1]']);
    expect(checkOutgoing(sent.text, v, note)).toEqual([]);
    // It cannot be released, by the switch or by a policy with no locks.
    const allReleased = v.map((e) => ({ ...e, withheld: false }));
    expect(redact(note, allReleased)).toBe('I wrote [withheld] and [withheld] and [withheld] by hand. Aarav is here.');
    expect(redactWithTokens(note, allReleased).tokens).toEqual(['[withheld]']);
    expect(applyLocks(allReleased, []).filter((e) => e.withheld)).toHaveLength(3);
  });

  it('restores only the stand-ins that were in the approved text', () => {
    expect(restore('Seat [Student 1] beside [Student 4].', vault, ['[Student 1]'])).toBe('Seat Aarav Sharma beside [Student 4].');
    expect(restore('Seat [Student 1] beside [Student 4].', vault, [])).toBe('Seat [Student 1] beside [Student 4].');
  });

  it('guesses names by their capital letter when no model read the note', () => {
    const note = 'Notes for Monday. I met Sunita at Rampur Kalan in November. Then Mrs. Rao rang from Delhi. Aarav was there.';
    const guesses = possibleNameCandidates(note, ['Aarav Sharma']);
    expect(guesses.map((c) => [c.kind, c.text, c.source, c.category])).toEqual([
      ['adult', 'Sunita', 'rule', 'capitalised word'],
      ['place', 'Rampur Kalan', 'rule', 'capitalised word'],
      ['adult', 'Rao', 'rule', 'capitalised word'],
      ['place', 'Delhi', 'rule', 'capitalised word'],
    ]);
    const v = buildVault(note, [...deterministicCandidates(note, ['Aarav Sharma']), ...guesses]);
    expect(redact(note, v)).toBe('Notes for Monday. I met [Adult 1] at [Place 1] in November. Then Mrs. [Adult 2] rang from [Place 2]. [Student 1] was there.');
    // A guess can be released.
    const released = v.map((e) => (e.surfaces[0] === 'Delhi' ? { ...e, withheld: false } : e));
    expect(redact(note, released)).toContain('rang from Delhi.');
  });

  it('withholds Sunita and Rampur Kalan in the sample note with rules only', () => {
    const v = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
    expect(v.filter((e) => e.category === 'capitalised word').map((e) => [e.kind, e.surfaces[0], e.withheld])).toEqual([
      ['adult', 'Sunita', true],
      ['place', 'Rampur Kalan', true],
    ]);
    expect(redact(SAMPLE_NOTE, v)).toBe(RULES_ONLY_SAMPLE);
    expect(checkOutgoing(redact(SAMPLE_NOTE, v), v, SAMPLE_NOTE)).toEqual([]);
  });

  it('still withholds a name inside a private detail the teacher released', () => {
    const note = "Kabir's parents are separating and he is tired. Ring 98765 43210.";
    const v = buildVault(note, [
      ...deterministicCandidates(note, ['Kabir']),
      { kind: 'private', text: "Kabir's parents are separating and he is tired. Ring 98765 43210", source: 'teacher' },
    ]);
    expect(redact(note, v)).toBe('[withheld].');
    const released = v.map((e) => (e.kind === 'private' ? { ...e, withheld: false } : e));
    const out = redact(note, released);
    expect(out).toBe("[Student 1]'s parents are separating and he is tired. Ring [Contact 1].");
    expect(checkOutgoing(out, released)).toEqual([]);
    expect(segment(note, released).map((s) => s.text).join('')).toBe(note);
  });

  it('withholds all of two private details that overlap, whichever is released', () => {
    const note = 'His father lost his job at the mill last month.';
    const v = buildVault(note, [
      { kind: 'private', text: 'father lost his job', source: 'on-device model' },
      { kind: 'private', text: 'lost his job at the mill', source: 'teacher' },
    ]);
    expect(redact(note, v)).toBe('His [withheld] last month.');
    const oneReleased = v.map((e, i) => (i === 0 ? { ...e, withheld: false } : e));
    expect(redact(note, oneReleased)).toBe('His father [withheld] last month.');
    expect(checkOutgoing(redact(note, oneReleased), oneReleased)).toEqual([]);
  });

  it('withholds a locked kind even when the vault says it was released', () => {
    const note = 'Ring Sunita on 98765 43210.';
    const v = buildVault(note, [...deterministicCandidates(note, []), { kind: 'adult', text: 'Sunita', source: 'teacher' }]);
    const allReleased = v.map((e) => ({ ...e, withheld: false }));
    expect(redact(note, allReleased)).toBe(note);
    const locked = applyLocks(allReleased, ['contact', 'id']);
    expect(redact(note, locked)).toBe('Ring Sunita on [Contact 1].');
    expect(checkOutgoing(redact(note, locked), locked)).toEqual([]);
    expect(locked.find((e) => e.kind === 'adult')?.withheld).toBe(false);
    expect(applyLocks(allReleased, [])).toEqual(allReleased);
  });

  describe('exit gate', () => {
    it('passes the redacted text', () => {
      expect(checkOutgoing(redacted, vault)).toEqual([]);
    });

    it('stops the raw note', () => {
      const v = checkOutgoing(SAMPLE_NOTE, vault);
      expect(v.length).toBeGreaterThan(8);
    });

    it('stops a name in a different case or spacing', () => {
      expect(checkOutgoing('talk to AARAV   SHARMA', vault)).toHaveLength(1);
    });

    it('stops a phone number the vault has never seen', () => {
      expect(checkOutgoing('ring 91234 56789', vault)[0].why).toContain('phone number');
    });

    it('does not stop a word that only contains a name', () => {
      const v = buildVault('Tara is here.', [{ kind: 'student', text: 'Tara', source: 'class list' }]);
      expect(checkOutgoing('The guitarist left.', v)).toEqual([]);
    });
  });

  describe('return gate', () => {
    it('passes a reply that uses stand-ins from the approved text', () => {
      expect(checkReply('Pair [Student 1] with [Student 4].', vault, sentTokens, '')).toEqual([]);
    });

    it('flags a stand-in that is not in the vault', () => {
      expect(checkReply('Pair [Student 1] with [Student 9].', vault, sentTokens, '')).toHaveLength(1);
    });

    it('flags a stand-in the vault holds but the approved text did not contain', () => {
      const approved = ['[Student 1]'];
      expect(vault.some((e) => e.token === '[Student 4]')).toBe(true);
      const issues = checkReply('Pair [Student 1] with [Student 4]. Thank [Student 4].', vault, approved, '');
      expect(issues).toEqual([{ what: '[Student 4]', why: 'a stand-in that was not in the text you approved' }]);
      expect(checkReply('Seat [Student 1] at the front.', vault, approved, '')).toEqual([]);
    });

    it('flags a malformed look-alike of a stand-in', () => {
      const approved = ['[Student 1]', '[withheld]'];
      expect(checkReply('Ask [student 1], [Student1], [ Student 1 ] and [Student 99]. [withheld] stays.', vault, approved, '').map((v) => v.what)).toEqual([
        '[student 1]',
        '[Student1]',
        '[ Student 1 ]',
        '[Student 99]',
      ]);
    });

    it('flags a real name coming back', () => {
      expect(checkReply('Ask Meenal to read.', vault, sentTokens, '')).toHaveLength(1);
    });
  });
});

import { anchor, anchorQuote, guardOutcome, MAX_CHUNK, paragraphs, readChunks, readGuardAnswer } from '../ai/guard';
import { anythingToCheck, checkDidNotRun, checkItems, checkPrompt, contextParagraphs, detailsFor, NOT_ANSWERED, readVerdict, startsKept, steps, studentsNamed, UNCLEAR, worse } from '../ai/check';
import { asReceiptRecord, digestPrefix, draftLine, makeReceipt, newReceiptId, receiptRecord, RECEIPT_ID, recordModelName, sha256Hex } from './receipts';
import { approvalKey, DEFAULT_POLICY, fallbackPolicy, readSaved, toSave, withTimeout } from './policy';
import { familyFor, ownersOf } from './family';
import { CASES, prepare, totals } from '../eval/cases';

describe('guard helpers', () => {
  const para = "Kabir's parents are separating and he is staying with his grandmother.";

  it('keeps an exact quote', () => {
    expect(anchorQuote(para, "kabir's parents are separating")).toBe("Kabir's parents are separating");
  });

  it('anchors a reworded quote to the words that are in the note', () => {
    expect(anchorQuote(para, 'Kabir is staying with his grandmother')).toBe('is staying with his grandmother');
  });

  it('drops a quote that is not in the note', () => {
    expect(anchorQuote(para, 'he has asthma')).toBeUndefined();
  });

  it('widens a quote that cuts a word', () => {
    expect(anchorQuote(para, 'staying with his grandmoth')).toBe('staying with his grandmother');
    expect(anchor(para, 'staying with his grandmoth')).toEqual({ text: 'staying with his grandmother', exact: true });
    expect(anchor(para, 'Kabir is staying with his grandmother')).toEqual({ text: 'is staying with his grandmother', exact: false });
  });

  it('reads a well-formed answer and counts what it cannot find in the note', () => {
    const reading = readGuardAnswer(
      para,
      JSON.stringify({
        people: [{ name: 'Kabir', role: 'student' }, { name: 'Zubin', role: 'student' }, { name: 7, role: 'adult' }, { name: 'Class 6B' }],
        places: ['Rampur', 12, 'Class 6B'],
        private: [
          { quote: "Kabir's parents are separating", category: 'family', about: 'Kabir' },
          { quote: 'he has asthma', category: 'health', about: 'Kabir' },
          { quote: 'Kabir is staying with his grandmother', category: 'family', about: 'Kabir' },
          { quote: 5 },
        ],
      }),
    );
    expect(reading?.candidates.map((c) => c.text)).toEqual(['Kabir', "Kabir's parents are separating", 'is staying with his grandmother']);
    // Dropped: Zubin, the name 7, Rampur, the place 12, the asthma quote and the quote 5.
    expect(reading?.dropped).toBe(6);
    expect(reading?.partial).toBe(1);
  });

  it('reports an answer it cannot read, or that lacks a list, instead of treating it as empty', () => {
    expect(readGuardAnswer(para, '{"people": [')).toBeUndefined();
    expect(readGuardAnswer(para, 'null')).toBeUndefined();
    expect(readGuardAnswer(para, '[]')).toBeUndefined();
    expect(readGuardAnswer(para, '{"people": "Kabir", "places": [], "private": []}')).toBeUndefined();
    expect(readGuardAnswer(para, '{"people": [], "places": []}')).toBeUndefined();
    expect(readGuardAnswer(para, '{}')).toBeUndefined();
    expect(readGuardAnswer(para, '{"people": [], "places": [], "private": []}')).toEqual({ candidates: [], dropped: 0, partial: 0 });
  });

  it('keeps what earlier pieces found when a later piece fails', async () => {
    const good = (name: string) => JSON.stringify({ people: [{ name, role: 'student' }], places: [], private: [] });
    const asked: string[] = [];
    const report = await readChunks(['Kabir is here.', 'Ishaan is here.', 'Tanvi is here.', 'Meenal is here.'], async (chunk) => {
      asked.push(chunk);
      if (chunk.startsWith('Ishaan')) throw new Error('the model stopped');
      if (chunk.startsWith('Tanvi')) return { text: 'not json', onDevice: true };
      return { text: good(chunk.split(' ')[0]), onDevice: true };
    });
    expect(report.candidates.map((c) => c.text)).toEqual(['Kabir', 'Meenal']);
    expect(report.unread).toEqual([1, 2]);
    expect(report.total).toBe(4);
    expect(report.stopped).toBeUndefined();
    expect(asked).toHaveLength(4);
  });

  it('stops asking, and keeps what it has, when an answer did not come from the device', async () => {
    const asked: string[] = [];
    const report = await readChunks(['Kabir is here.', 'Ishaan is here.', 'Tanvi is here.'], async (chunk) => {
      asked.push(chunk);
      return { text: JSON.stringify({ people: [{ name: chunk.split(' ')[0] }], places: [], private: [] }), onDevice: asked.length === 1 };
    });
    expect(report.candidates.map((c) => c.text)).toEqual(['Kabir']);
    expect(report.unread).toEqual([1, 2]);
    expect(report.stopped).toMatch(/did not run on the device/);
    expect(asked).toHaveLength(2);
  });

  it('marks every piece unread when the model never answers', async () => {
    const report = await readChunks(['one', 'two'], async () => {
      throw new Error('no answer');
    });
    expect(report.unread).toEqual([0, 1]);
    expect(report.unread.length).toBe(report.total);
  });

  it('splits on blank lines', () => {
    expect(paragraphs('one\n\n two \n\n\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('splits a long paragraph on line breaks, then on sentence ends', () => {
    const sentence = 'Aarav handed in his maths homework late again this week.';
    const line = Array.from({ length: 20 }, () => sentence).join(' ');
    const long = ['A short first line.', line, 'A short last line.'].join('\n');
    expect(long.length).toBeGreaterThan(MAX_CHUNK);
    const chunks = paragraphs(`Heading\n\n${long}\n\nA short paragraph.`);
    expect(chunks[0]).toBe('Heading');
    expect(chunks[chunks.length - 1]).toBe('A short paragraph.');
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= MAX_CHUNK)).toBe(true);
    // Only at a line break or a sentence end, and nothing is lost.
    for (const c of chunks.slice(1, -1)) expect(c).toMatch(/^A[^]*\.$/);
    const words = (t: string) => t.split(/\s+/).filter(Boolean);
    expect(chunks.flatMap(words)).toEqual(words(`Heading ${long} A short paragraph.`));
  });

  it('cuts a single sentence that is too long at a space', () => {
    const endless = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
    const chunks = paragraphs(endless);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= MAX_CHUNK)).toBe(true);
    expect(chunks.join(' ')).toBe(endless);
  });

  it('leaves a paragraph of ordinary length whole', () => {
    expect(paragraphs(SAMPLE_NOTE)).toHaveLength(5);
  });
});

describe('check and receipt', () => {
  const note = 'Meenal reads well. She has epilepsy.\n\nTanvi is shy.';
  const vault = buildVault(note, [
    { kind: 'student', text: 'Meenal', source: 'class list' },
    { kind: 'student', text: 'Tanvi', source: 'class list' },
    { kind: 'private', text: 'She has epilepsy', source: 'on-device model', category: 'health' },
  ]);

  it('lists a phrase and the sentence around it once', () => {
    const v = buildVault(note, [
      { kind: 'student', text: 'Meenal', source: 'class list' },
      { kind: 'private', text: 'She has epilepsy', source: 'rule' },
      { kind: 'private', text: 'epilepsy', source: 'on-device model' },
    ]);
    expect(detailsFor({ heading: '[Student 1]', text: 'timed quiz' }, v)[0].details.map((d) => d.surfaces[0])).toEqual(['She has epilepsy']);
  });

  it('checks an item against the details about the students it names', () => {
    const groups = detailsFor({ heading: '[Student 1]', text: 'timed quiz' }, vault);
    expect(groups).toHaveLength(1);
    expect(groups[0].student?.surfaces[0]).toBe('Meenal');
    expect(groups[0].details.map((d) => d.surfaces[0])).toEqual(['She has epilepsy']);
  });

  it('finds a student whose name was released, as a whole word', () => {
    const released = vault.map((e) => (e.surfaces[0] === 'Meenal' ? { ...e, withheld: false } : e));
    expect(studentsNamed({ heading: 'Meenal', text: 'timed quiz' }, released).map((e) => e.surfaces[0])).toEqual(['Meenal']);
    expect(detailsFor({ heading: 'Reading', text: "Give meenal's group a timed quiz" }, released)[0].student?.surfaces[0]).toBe('Meenal');
    expect(studentsNamed({ heading: 'Meenalben', text: 'timed quiz' }, released)).toEqual([]);
    // A name that is still withheld is matched by its stand-in only.
    expect(studentsNamed({ heading: 'Meenal', text: 'timed quiz' }, vault)).toEqual([]);
  });

  it('checks an item that names no student with a detail against every withheld detail', () => {
    for (const item of [
      { heading: 'Whole class', text: 'Hold a timed written test.' },
      { heading: '[Student 2]', text: 'pair work' },
    ]) {
      const groups = detailsFor(item, vault);
      expect(groups).toHaveLength(1);
      expect(groups[0].student).toBeUndefined();
      expect(groups[0].details.map((d) => d.surfaces[0])).toEqual(['She has epilepsy']);
    }
    const prompt = checkPrompt(detailsFor({ heading: 'Whole class', text: 'Timed test for [Student 2].' }, vault)[0], { heading: 'Whole class', text: 'Timed test for [Student 2].' }, ['Meenal reads well. She has epilepsy.', 'Tanvi is shy.'], vault, ['[Student 1]', '[Student 2]']);
    expect(prompt).toContain('Private facts about children in this class:\n- (about Meenal) She has epilepsy');
    expect(prompt).toContain('What the teacher wrote:\nMeenal reads well. She has epilepsy.\n');
    expect(prompt).toContain('Whole class. Timed test for Tanvi.');
  });

  it('never leaves out a withheld detail that is about nobody in particular', () => {
    const text = 'The hostel children get no dinner.\n\nMeenal reads well. She has epilepsy.';
    const v = buildVault(text, [
      { kind: 'student', text: 'Meenal', source: 'class list' },
      { kind: 'private', text: 'She has epilepsy', source: 'on-device model' },
      { kind: 'private', text: 'The hostel children get no dinner', source: 'teacher' },
    ]);
    const groups = detailsFor({ heading: '[Student 1]', text: 'Stay late for practice.' }, v);
    expect(groups.map((g) => [g.student?.surfaces[0], g.details.map((d) => d.surfaces[0])])).toEqual([
      ['Meenal', ['She has epilepsy']],
      [undefined, ['The hostel children get no dinner']],
    ]);
  });

  it('says nothing was withheld only when no private detail is withheld', () => {
    const none = vault.map((e) => (e.kind === 'private' ? { ...e, withheld: false } : e));
    expect(detailsFor({ heading: 'Whole class', text: 'x' }, none)).toEqual([]);
    expect(anythingToCheck([{ heading: '[Student 1]', text: 'quiz' }], none)).toBe(false);
    expect(anythingToCheck([{ heading: 'Whole class', text: 'x' }], vault)).toBe(true);
  });

  it('only ever moves a verdict up', () => {
    const fits = { verdict: 'fits' as const, reason: 'ok' };
    const unsure = { verdict: 'unsure' as const, reason: 'think' };
    const conflict = { verdict: 'conflict' as const, reason: 'must leave early' };
    expect(worse(undefined, fits)).toBe(fits);
    expect(worse(fits, conflict)).toBe(conflict);
    expect(worse(conflict, fits)).toBe(conflict);
    expect(worse(conflict, unsure)).toBe(conflict);
    expect(worse(unsure, fits)).toBe(unsure);
    expect(worse(unsure, { verdict: 'unsure', reason: 'another' })).toBe(unsure);
    // Same rank: the one with a reason to show is kept.
    expect(worse({ verdict: 'fits', reason: '' }, fits)).toBe(fits);
    expect(worse(fits, { verdict: 'fits', reason: '' })).toBe(fits);
    let run: ReturnType<typeof worse> | undefined;
    for (const next of [fits, conflict, fits, unsure]) run = worse(run, next);
    expect(run).toBe(conflict);
  });

  it('splits advice into steps so each is checked on its own', () => {
    expect(steps('First, greet her. Second, send her to the club after the last bell. Third, praise her.')).toEqual([
      'First, greet her.',
      'Second, send her to the club after the last bell.',
      'Third, praise her.',
    ]);
    expect(steps('1. Greet her. 2. Pair her with a friend.')).toEqual(['Greet her.', 'Pair her with a friend.']);
    expect(steps('Seat her near the door')).toEqual(['Seat her near the door']);
    expect(steps('A. B. C. D. E. F. G. H.'.replace(/([A-H])/g, '$1a go'))).toHaveLength(6);
  });

  it('asks about each step, and one conflicting step makes the item a conflict', async () => {
    const note = 'Meenal reads well. She must leave before dark.';
    const entities = buildVault(note, [
      { kind: 'student', text: 'Meenal', source: 'class list' },
      { kind: 'private', text: 'She must leave before dark', source: 'teacher', aboutName: 'Meenal' },
    ]);
    const asked: string[] = [];
    const run = await checkItems(
      [{ heading: '[Student 1]', text: 'First, greet her. Second, send her to the club after the last bell.' }],
      entities,
      [note],
      ['[Student 1]'],
      async (prompt) => {
        asked.push(prompt);
        const no = prompt.includes('club');
        return { text: JSON.stringify({ advice_requires: 'x', can_do: no ? 'no' : 'yes', reason: 'r' }), onDevice: true };
      },
    );
    expect(asked).toHaveLength(2);
    expect(asked[0]).not.toContain('club');
    expect(run.checks[0].verdict).toBe('conflict');
  });

  it("reads the model's answer to \"can the child do this?\" as a verdict", () => {
    expect(readVerdict('{"advice_requires":"stay late","can_do":"no","reason":"She must leave before dark."}').verdict).toBe('conflict');
    expect(readVerdict('{"advice_requires":"read aloud","can_do":"yes","reason":"Nothing in the facts rules it out."}').verdict).toBe('fits');
    expect(readVerdict('{"advice_requires":"x","can_do":"not sure","reason":"Hard to tell."}').verdict).toBe('unsure');
    expect(readVerdict('{"advice_requires":"x","can_do":"maybe","reason":"?"}').verdict).toBe('unsure');
  });

  it('gives a warning with no reason a reason the teacher can act on', () => {
    expect(readVerdict('{"verdict":"conflict","reason":""}').reason).toMatch(/gave no reason/);
    expect(readVerdict('{"verdict":"unsure"}').reason).toMatch(/gave no reason/);
    // "fits" with no reason is not taken as a pass.
    for (const raw of ['{"verdict":"fits","reason":""}', '{"verdict":"fits"}', '{"verdict":"fits","reason":"  "}']) {
      expect(readVerdict(raw).verdict).toBe('unsure');
      expect(readVerdict(raw).reason).toMatch(/gave no reason/);
    }
    expect(UNCLEAR).toEqual({ verdict: 'unsure', reason: 'The on-device check gave no clear answer. Read this item yourself.' });
  });

  it('checks an item that speaks to the whole class against everything, even when it names a student', () => {
    const text = 'Meenal reads well. She has epilepsy.\n\nTanvi is shy. Her father is unemployed.';
    const v = buildVault(text, [
      { kind: 'student', text: 'Meenal', source: 'class list' },
      { kind: 'student', text: 'Tanvi', source: 'class list' },
      { kind: 'private', text: 'She has epilepsy', source: 'on-device model' },
      { kind: 'private', text: 'Her father is unemployed', source: 'on-device model' },
    ]);
    const all = ['She has epilepsy', 'Her father is unemployed'];
    for (const item of [
      { heading: 'Everyone', text: 'Ask [Student 1] to lead a timed test.' },
      { heading: '[Student 1]', text: 'Read aloud in front of the class.' },
      { heading: 'Plan', text: 'All students bring ten rupees; [Student 2] collects it.' },
      { heading: 'Whole class and [Student 2]', text: 'Quiet reading.' },
    ]) {
      const groups = detailsFor(item, v);
      expect(groups).toHaveLength(1);
      expect(groups[0].student).toBeUndefined();
      expect(groups[0].details.map((d) => d.surfaces[0])).toEqual(all);
    }
    // An item for one student, with no such words, is still checked against that student only.
    const one = detailsFor({ heading: '[Student 1]', text: 'Give extra time in tests.' }, v);
    expect(one.map((g) => [g.student?.surfaces[0], g.details.map((d) => d.surfaces[0])])).toEqual([['Meenal', ['She has epilepsy']]]);
  });

  it('marks a group whose request fails as unsure and carries on', async () => {
    const items = [
      { heading: '[Student 1]', text: 'timed quiz' },
      { heading: '[Student 1]', text: 'extra time' },
      { heading: '[Student 1]', text: 'reading aloud' },
    ];
    let asked = 0;
    const run = await checkItems(items, vault, [note], ['[Student 1]'], async () => {
      asked++;
      if (asked === 1) throw new Error('the model stopped');
      if (asked === 2) return { text: 'not json', onDevice: true };
      return { text: '{"verdict":"fits","reason":"ok"}', onDevice: true };
    });
    expect(run.checks).toEqual([NOT_ANSWERED, UNCLEAR, { verdict: 'fits', reason: 'ok' }]);
    expect(NOT_ANSWERED.verdict).toBe('not checked');
    expect(asked).toBe(3);
    expect([run.asked, run.answered, run.failed]).toEqual([3, 2, 1]);
    expect(checkDidNotRun(run)).toBe(false);
  });

  it('says the check did not run when every request failed', async () => {
    const items = [
      { heading: '[Student 1]', text: 'timed quiz' },
      { heading: 'Seating', text: 'Move desks.' },
    ];
    const run = await checkItems(items, vault, [note], ['[Student 1]'], async () => {
      throw new Error('the model stopped');
    });
    expect(run.checks).toEqual([NOT_ANSWERED, NOT_ANSWERED]);
    expect([run.asked, run.answered, run.failed]).toEqual([2, 0, 2]);
    expect(checkDidNotRun(run)).toBe(true);
    expect(checkDidNotRun({ checks: [], asked: 0, answered: 0, failed: 0 })).toBe(false);
  });

  it('marks an item unsure when only some of its requests were answered', async () => {
    const text = 'The hostel children get no dinner.\n\nMeenal reads well. She has epilepsy.';
    const v = buildVault(text, [
      { kind: 'student', text: 'Meenal', source: 'class list' },
      { kind: 'private', text: 'She has epilepsy', source: 'on-device model' },
      { kind: 'private', text: 'The hostel children get no dinner', source: 'teacher' },
    ]);
    let asked = 0;
    const run = await checkItems([{ heading: '[Student 1]', text: 'Stay late for practice.' }], v, paragraphs(text), ['[Student 1]'], async () => {
      if (++asked === 2) throw new Error('the model stopped');
      return { text: '{"verdict":"fits","reason":"ok"}', onDevice: true };
    });
    expect(run.checks[0].verdict).toBe('unsure');
    expect(run.checks[0].reason).toMatch(/did not answer for part of this check/);
    expect([run.asked, run.answered, run.failed]).toEqual([2, 1, 1]);
  });

  it('puts back only the stand-ins that were sent when it writes the check prompt', () => {
    const item = { heading: '[Student 1]', text: 'Pair with [Student 2] for a timed quiz.' };
    const group = detailsFor(item, vault)[0];
    const prompt = checkPrompt(group, item, [note], vault, ['[Student 1]']);
    expect(prompt).toContain('Meenal. Pair with [Student 2] for a timed quiz.');
    expect(prompt.split('Advice to check:')[1]).not.toContain('Tanvi');
  });

  it('stops the whole check when an answer did not come from the device', async () => {
    const items = [{ heading: '[Student 1]', text: 'timed quiz' }];
    await expect(checkItems(items, vault, [note], ['[Student 1]'], async () => ({ text: '{"verdict":"fits","reason":"ok"}', onDevice: false }))).rejects.toThrow(
      /did not run on the device/,
    );
  });

  it('starts a conflict struck, and leaves an unsure or unchecked item for the teacher to decide', () => {
    const verdicts = ['fits', 'conflict', 'unsure', 'not checked', 'nothing withheld'] as const;
    expect(startsKept(verdicts.map((verdict) => ({ verdict, reason: '' })))).toEqual([true, false, null, null, true]);
  });

  it('keeps two details about different children even when one is inside the other', () => {
    const text = 'Tanvi was told that Meenal has epilepsy. Meenal reads well.';
    const v = buildVault(text, [
      { kind: 'student', text: 'Meenal', source: 'class list' },
      { kind: 'student', text: 'Tanvi', source: 'class list' },
      { kind: 'private', text: 'Tanvi was told that Meenal has epilepsy', source: 'on-device model', aboutName: 'Tanvi' },
      { kind: 'private', text: 'Meenal has epilepsy', source: 'on-device model', aboutName: 'Meenal' },
    ]);
    const meenal = v.find((e) => e.surfaces[0] === 'Meenal')!;
    const groups = detailsFor({ heading: meenal.token, text: 'Give a timed quiz.' }, v);
    expect(groups.map((g) => [g.student?.surfaces[0], g.details.map((d) => d.surfaces[0])])).toEqual([['Meenal', ['Meenal has epilepsy']]]);
    expect(detailsFor({ heading: 'Seating', text: 'Move desks.' }, v)[0].details.map((d) => d.surfaces[0])).toEqual([
      'Tanvi was told that Meenal has epilepsy',
      'Meenal has epilepsy',
    ]);
  });

  it('checks advice for children in general against every withheld fact', () => {
    const text = 'Meenal reads well. She has epilepsy.\n\nTanvi is shy. Her father is unemployed.';
    const v = buildVault(text, [
      { kind: 'student', text: 'Meenal', source: 'class list' },
      { kind: 'student', text: 'Tanvi', source: 'class list' },
      { kind: 'private', text: 'She has epilepsy', source: 'on-device model' },
      { kind: 'private', text: 'Her father is unemployed', source: 'on-device model' },
    ]);
    for (const words of [
      'Have all children stay late and ask [Student 2] to lead',
      'Every child brings ten rupees; [Student 2] collects it',
      'Each pupil reads aloud after [Student 2]',
      'The children line up behind [Student 2]',
      'Pupils swap books with [Student 2]',
      'Students who finish early help [Student 2]',
      'The group waits for [Student 2]',
      'Anyone may ask [Student 2] for help',
      'Nobody leaves before [Student 2]',
      'All the students stay with [Student 2]',
      'Everybody claps for [Student 2]',
      'No one sits beside [Student 2] today',
      'Her classmates read with [Student 2]',
      'The rest follow [Student 2]',
    ]) {
      const groups = detailsFor({ heading: 'Plan', text: `${words}.` }, v);
      expect(groups, words).toHaveLength(1);
      expect(groups[0].student, words).toBeUndefined();
      expect(groups[0].details.map((d) => d.surfaces[0]), words).toEqual(['She has epilepsy', 'Her father is unemployed']);
    }
    // Ordinary advice for one named child is still checked against that child only.
    for (const words of ['Give [Student 2] group work with a friend', 'Let [Student 2] finish in class']) {
      expect(detailsFor({ heading: 'Plan', text: `${words}.` }, v).map((g) => g.student?.surfaces[0]), words).toEqual(['Tanvi']);
    }
  });

  it('collects context paragraphs by whole word', () => {
    const paras = ['Some children join late.', 'Om has missed school.', 'Ask OM again.', 'Tomorrow is a holiday.'];
    expect(contextParagraphs(paras, ['Om'])).toEqual(['Om has missed school.', 'Ask OM again.']);
    expect(contextParagraphs(paras, [])).toEqual([]);
  });

  it('reads a clear verdict and treats anything else as unsure', () => {
    expect(readVerdict('{"verdict":"fits","reason":"ok"}')).toEqual({ verdict: 'fits', reason: 'ok' });
    expect(readVerdict('{"verdict":"conflict","reason":"must leave early"}').verdict).toBe('conflict');
    expect(readVerdict('{"verdict":"unsure","reason":"r"}').verdict).toBe('unsure');
    for (const raw of ['{"reason":"looks fine"}', '{"verdict":"approved","reason":"x"}', '{"verdict":null}', 'null', '"fits"', 'not json']) {
      expect(readVerdict(raw).verdict).toBe('unsure');
      expect(readVerdict(raw).reason).toMatch(/no clear answer/);
    }
  });

  const sentText = redact(note, vault);
  const receipt = makeReceipt({
    task: 'plan',
    label: 'Reading and a shy reader',
    labelWhere: 'ON_DEVICE',
    entities: vault,
    guardWhere: 'ON_DEVICE',
    unreadParagraphs: 1,
    droppedDetails: 0,
    sentText,
    sentSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    approvedAt: new Date().toISOString(),
    draftWhere: 'IN_CLOUD',
    draftModel: 'gemini-3.5-flash-lite',
    checkWhere: 'ON_DEVICE',
    replyFlagged: true,
    checks: [{ verdict: 'conflict', reason: 'x' }, { verdict: 'nothing withheld', reason: 'y' }],
    kept: 1,
    struck: 1,
  });

  it('writes a receipt with no vault contents', () => {
    const json = JSON.stringify(receipt);
    expect(json).not.toContain('Meenal');
    expect(json).not.toContain('epilepsy');
    expect(receipt.sent.text).toBe(sentText);
    expect(receipt.guard.found.student).toBe(2);
    expect(receipt.guard.unreadParagraphs).toBe(1);
    expect(receipt.labelWhere).toBe('ON_DEVICE');
    expect(receipt.check.conflict).toBe(1);
  });

  it('records how many check requests were made and how many failed', () => {
    expect(receipt.check.requests).toBeUndefined();
    const failed = makeReceipt({
      task: 'plan',
      label: 'x',
      labelWhere: 'FALLBACK',
      entities: vault,
      guardWhere: 'ON_DEVICE',
      unreadParagraphs: 0,
      droppedDetails: 0,
      sentText,
      sentSha256: '',
      approvedAt: new Date().toISOString(),
      draftWhere: 'IN_CLOUD',
      draftModel: 'gemini-3.5-flash-lite',
      checkWhere: 'NOT_RUN',
      checkRequests: { asked: 4, failed: 4 },
      replyFlagged: false,
      checks: [{ verdict: 'not checked', reason: 'x' }],
      kept: 1,
      struck: 0,
    });
    expect([failed.check.where, failed.check.requests, failed.check.failedRequests, failed.check.notChecked]).toEqual(['NOT_RUN', 4, 4, 1]);
  });

  it('computes a SHA-256 digest in hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('reduces a receipt to a record with no text for the cloud copy', async () => {
    const record = await receiptRecord(receipt);
    expect(Object.keys(record).sort()).toEqual(
      [
        'id', 'createdAt', 'task', 'withheld', 'released', 'approvedAt', 'approvedChars', 'approvedSha256', 'guardWhere',
        'draftWhere', 'draftModel', 'checkWhere', 'labelWhere', 'verdicts', 'kept', 'struck', 'flags',
      ].sort(),
    );
    const json = JSON.stringify(record);
    expect(json).not.toContain(sentText);
    expect(json).not.toContain('reads well');
    expect(json).not.toContain('Student 1');
    expect(json).not.toContain(receipt.label);
    expect(json).not.toContain('Meenal');
    expect(record.approvedChars).toBe(sentText.length);
    expect(record.approvedSha256).toBe(receipt.sent.sha256);
    expect((await receiptRecord({ ...receipt, sent: { ...receipt.sent, sha256: undefined } })).approvedSha256).toBe(await sha256Hex(sentText));
    expect(record.approvedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.withheld).toEqual({ student: 2, adult: 0, place: 0, contact: 0, id: 0, private: 1 });
    expect(record.verdicts.conflict).toBe(1);
    expect(record.flags).toEqual({ replyFlagged: true, unreadParagraphs: 1, droppedDetails: 0 });
    expect([record.kept, record.struck]).toEqual([1, 1]);
    // Every value is a number, a boolean, or one of a few short fixed strings.
    const strings = Object.values(record).filter((v): v is string => typeof v === 'string');
    expect(strings.every((v) => v.length <= 100)).toBe(true);
  });

  it('writes the record in exactly the forms the Firestore rules accept', async () => {
    const odd = { ...receipt, draft: { where: 'IN_CLOUD' as const, model: 'gemini-3.5/flash:lite <b>"x"</b> ' + 'y'.repeat(80) } };
    const record = await receiptRecord(odd);
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
    expect(record.createdAt).toMatch(iso);
    expect(record.approvedAt).toMatch(iso);
    expect(record.approvedSha256).toMatch(/^[0-9a-f]{64}$/);
    // A model name is a Gemini cloud model, the on-device model's one name, or "other": never free text.
    expect(record.draftModel).toBe('other');
    expect(recordModelName('Gemini Nano (Chrome built-in)')).toBe('Gemini Nano (Chrome built-in)');
    expect(recordModelName('gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite');
    for (const name of ['<>', '', 'Gemini Nano', 'gemini-', 'gemini-3.5 flash', 'Gemini-3.5-Flash', 'my-model', `gemini-${'x'.repeat(41)}`]) {
      expect(recordModelName(name), name).toBe('other');
    }
    expect(record.id).toMatch(RECEIPT_ID);
    expect(newReceiptId(1795000000000, 0)).toBe('mwm0nk74-000000');
    expect(newReceiptId(1795000000000, 0.5)).toMatch(RECEIPT_ID);
    for (let i = 0; i < 50; i++) expect(newReceiptId()).toMatch(RECEIPT_ID);
    // The rules file states the same two forms.
    expect(firestoreRules).toContain("receiptId.matches('^[0-9a-z]{8,9}-[0-9a-z]{6}$')");
    expect(firestoreRules).toContain("v.matches('^gemini-[a-z0-9.-]{1,40}$') || v == 'Gemini Nano (Chrome built-in)' || v == 'other'");
    expect(firestoreRules).toContain('&& isModel(d.draftModel)');
    expect(['ON_DEVICE', 'RULES_ONLY']).toContain(record.guardWhere);
    expect(['ON_DEVICE', 'IN_CLOUD']).toContain(record.draftWhere);
    expect(['ON_DEVICE', 'NOT_RUN', 'SKIPPED']).toContain(record.checkWhere);
    expect(['ON_DEVICE', 'IN_CLOUD', 'FALLBACK']).toContain(record.labelWhere);
    // The same eight characters are shown on the receipt here and on the record in the account.
    expect(digestPrefix(record.approvedSha256)).toBe(digestPrefix(receipt.sent.sha256));
    expect(digestPrefix(record.approvedSha256)).toBe('ba7816bf');
    expect(digestPrefix(undefined)).toBe('');
  });

  it('reads a stored record back, and refuses anything in another form', async () => {
    const record = await receiptRecord(receipt);
    expect(asReceiptRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    // Only the fields of a record come back, whatever else an entry holds.
    expect(asReceiptRecord({ ...record, sent: { text: 'approved text' }, label: 'A title' })).toEqual(record);
    // An entry written by an earlier version (a whole receipt) is not a record.
    expect(asReceiptRecord(receipt)).toBeUndefined();
    expect(asReceiptRecord({ ...record, task: 'other' })).toBeUndefined();
    expect(asReceiptRecord({ ...record, kept: -1 })).toBeUndefined();
    expect(asReceiptRecord({ ...record, draftModel: 'x'.repeat(61) })).toBeUndefined();
    expect(asReceiptRecord({ ...record, draftModel: 'A sentence about a child' })).toBeUndefined();
    expect(asReceiptRecord({ ...record, id: 'a-note-about-meenal' })).toBeUndefined();
    expect(asReceiptRecord({ ...record, draftModel: 'gemini<script>' })).toBeUndefined();
    expect(asReceiptRecord({ ...record, createdAt: 'yesterday' })).toBeUndefined();
    expect(asReceiptRecord({ ...record, approvedSha256: 'abc' })).toBeUndefined();
    expect(asReceiptRecord(null)).toBeUndefined();
  });
});

describe('draft prompt', () => {
  it('is the task instruction, two fixed lines and the approved text, and nothing else', () => {
    const task = TASKS[0];
    expect(draftPrompt('[Student 1] reads well.', task)).toBe(
      `${task.instruction}\n\n${DRAFT_FORMAT}\n\n${DRAFT_NOTES_HEADING}\n[Student 1] reads well.`,
    );
  });

  it('gives the naming call only the start of the approved text', () => {
    expect(labelPrompt('x'.repeat(5000))).toBe(`Note:\n${'x'.repeat(LABEL_CHARS)}`);
  });
});

describe('plainText', () => {
  it('removes markdown marks and keeps the words', () => {
    expect(plainText('1. **Check in Briefly:** ask [Student 1] *after* school.')).toBe('1. Check in Briefly: ask [Student 1] after school.');
    expect(plainText('## Support Plan\n__Maths__ review with `[Student 2]`')).toBe('Support Plan\nMaths review with [Student 2]');
  });
  it('leaves stand-ins, lists and ordinary punctuation alone', () => {
    const text = '[Student 1] and [Adult 1]: 3 * 4 = 12, see roll_no_6B. - first\n- second';
    expect(plainText(text)).toBe(text);
  });
  it('drops an unpaired bold mark', () => {
    expect(plainText('**Note: sit near [Student 3]')).toBe('Note: sit near [Student 3]');
  });
});

describe('page', () => {
  it('asks the browser not to translate it, so page translation is not sent the note', () => {
    const html = indexHtml;
    expect(html).toContain('<meta name="google" content="notranslate" />');
    expect(html).toContain('<html lang="en" translate="no">');
    expect(html).toContain('<div id="root" translate="no">');
  });
});

describe('approval and policy', () => {
  it('binds an approval to the text, the locked kinds and the drafting model', () => {
    const key = approvalKey('Hello [Student 1].', ['contact', 'id'], 'gemini-3.5-flash-lite');
    expect(approvalKey('Hello [Student 1].', ['id', 'contact'], 'gemini-3.5-flash-lite')).toBe(key);
    expect(approvalKey('Hello [Student 1]. ', ['contact', 'id'], 'gemini-3.5-flash-lite')).not.toBe(key);
    expect(approvalKey('Hello [Student 1].', ['contact'], 'gemini-3.5-flash-lite')).not.toBe(key);
    expect(approvalKey('Hello [Student 1].', ['contact', 'id', 'student'], 'gemini-3.5-flash-lite')).not.toBe(key);
    expect(approvalKey('Hello [Student 1].', ['contact', 'id'], 'another-model')).not.toBe(key);
    // The tick for "I am sending my note as written" is another key: the ordinary tick cannot stand in for it.
    expect(approvalKey('Hello [Student 1].', ['contact', 'id'], 'gemini-3.5-flash-lite', false)).toBe(key);
    expect(approvalKey('Hello [Student 1].', ['contact', 'id'], 'gemini-3.5-flash-lite', true)).not.toBe(key);
  });

  it('falls back to the defaults when the policy is slow or fails', async () => {
    vi.useFakeTimers();
    try {
      const slow = withTimeout(new Promise<string>(() => {}), 4000, 'defaults');
      await vi.advanceTimersByTimeAsync(4000);
      expect(await slow).toBe('defaults');
      expect(await withTimeout(Promise.reject(new Error('offline')), 4000, 'defaults')).toBe('defaults');
      expect(await withTimeout(Promise.resolve('remote'), 4000, 'defaults')).toBe('remote');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('listed names with initials and hyphens', () => {
  it('never withholds a one-letter part of a listed name on its own', () => {
    const list = ['A. Kumar', 'Imran I'];
    const note = 'A good week. I saw Imran and Kumar after lunch. A. Kumar and Imran I were early.';
    const v = buildVault(note, deterministicCandidates(note, list));
    expect(v.map((e) => e.surfaces)).toEqual([
      ['A. Kumar', 'Kumar'],
      ['Imran I', 'Imran'],
    ]);
    expect(redact(note, v)).toBe('A good week. I saw [Student 2] and [Student 1] after lunch. [Student 1] and [Student 2] were early.');
    expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
  });

  it('does not list a student whose only match is an initial', () => {
    const note = 'A good week. I marked the tests.';
    expect(deterministicCandidates(note, ['A. Kumar', 'Imran I'])).toEqual([]);
  });

  it('still withholds a two-letter part of a listed name', () => {
    const note = 'Om was late.';
    expect(redact(note, buildVault(note, deterministicCandidates(note, ['Om Rao'])))).toBe('[Student 1] was late.');
  });

  it('withholds either half of a hyphenated listed name when it stands alone', () => {
    const list = ['Mary-Jane Lee'];
    for (const [note, out] of [
      ['Mary was away.', '[Student 1] was away.'],
      ['Jane was away.', '[Student 1] was away.'],
      ['Mary-Jane was away, and Mary-Jane Lee came back.', '[Student 1] was away, and [Student 1] came back.'],
    ]) {
      const v = buildVault(note, deterministicCandidates(note, list));
      expect(redact(note, v)).toBe(out);
      expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
    }
  });
});

describe('landline numbers', () => {
  it('finds a landline with its STD code, in the rules and at the exit gate', () => {
    for (const number of ['022 2345 6789', '080-23456789', '0484 234 5678', '01123456789']) {
      const note = `Ring the office on ${number} after four.`;
      expect(findByRule(note).map((h) => [h.rule, h.text])).toEqual([['phone number', number]]);
      const v = buildVault(note, deterministicCandidates(note, []));
      expect(redact(note, v)).toBe('Ring the office on [Contact 1] after four.');
      expect(checkOutgoing(note, []).map((x) => x.why)).toEqual(['looks like a phone number']);
    }
  });

  it('leaves dates, times and short numbers alone', () => {
    expect(findByRule('Due 01-02-2026 at 0900 hours. Page 0123 of 0456. Scored 045 then 067.')).toEqual([]);
  });
});

describe('more sensitive words', () => {
  it('withholds sentences about the law, drink, violence, health, hardship and identity', () => {
    const lines = [
      'His father is in jail',
      'Her uncle was sent to prison',
      'The police came to the house',
      'His brother was arrested',
      'Her father drinks',
      'He has been drinking again',
      'Her father comes home drunk',
      'There is alcohol at home',
      'He beats the children',
      'She was beaten at home',
      'He hits her',
      'There was abuse at home',
      'Her mother has cancer',
      'His father has HIV',
      'Her aunt is being treated for TB',
      'She is treated for depression',
      'He has anxiety before tests',
      'There are signs of self-harm',
      'She spoke of suicide',
      'He has autism',
      'She has dyslexia',
      'He has a disability',
      'She is being bullied',
      'The family is homeless',
      'He comes to school hungry',
      'They are in debt',
      'Others tease her about caste',
      'The family is Dalit',
      'He is listed as SC/ST',
      'The family is Muslim',
      'The family is Hindu',
      'The family is Christian',
      'The family is Sikh',
      'Her sister is pregnant',
      'His grandfather died',
      'There was a death in the family',
    ];
    for (const line of lines) expect(findSensitive(`${line}.`).map((h) => h.text), line).toEqual([line]);
  });

  it('leaves ordinary classroom words alone', () => {
    expect(findSensitive('She speaks Hindi well. He hit the target in maths. The debate was on the best table. Stables and policy were the topics.')).toEqual([]);
  });
});

describe('capitalised words that open a sentence, when no model read the note', () => {
  const guess = (note: string, list: string[] = []) => possibleNameCandidates(note, list).map((c) => c.text);

  it('holds a word that opens a sentence unless it is an ordinary opener', () => {
    expect(guess('Sunita rang at noon. She was upset. Today went well. Rohan was absent on Monday.')).toEqual(['Sunita', 'Rohan']);
  });

  it('passes over ordinary openers, days and months', () => {
    const note =
      'The test went well. He is early. They left. This is new. Her work is neat. His bag is lost. We met. I agree. In class he is quiet. On Friday we met. At lunch she left. When it rains he is late. If so, fine. But not always. And so on. Some left. Most stayed. All came. No homework. Not today. Please note. Today is fine. Tomorrow too. Yesterday was hard. Monday is sports day. March is exam month.';
    expect(guess(note)).toEqual([]);
  });

  it('drops an ordinary opener in front of a name and keeps the name', () => {
    expect(guess('When Sunita rang I was out. Then Mrs. Rao came.')).toEqual(['Sunita', 'Rao']);
  });

  it('leaves a class-list name to the class list', () => {
    expect(guess('Kabir was late.', ['Kabir Khan'])).toEqual([]);
  });
});

describe('a stand-in written without its brackets', () => {
  const note = 'Aarav reads well. Meenal is shy. Tanvi helps.';
  const v = buildVault(note, deterministicCandidates(note, ['Aarav', 'Meenal', 'Tanvi']));
  const sentTokens = ['[Student 1]', '[Student 2]'];

  it('is asked for with brackets in the fixed instructions', () => {
    expect(DRAFT_FORMAT).toContain('with its square brackets');
    expect(DRAFT_FORMAT).toContain('[Student 1], never Student 1');
  });

  it('is read as the stand-in when its bracketed form was sent, in a heading and in a text', () => {
    expect(bracketBare('Student 1', sentTokens)).toBe('[Student 1]');
    expect(bracketBare("Seat Student 1 by [Student 2]. Student 2's desk is free.", sentTokens)).toBe("Seat [Student 1] by [Student 2]. [Student 2]'s desk is free.");
    const draft = bracketDraft({ title: 'Plan for Student 1', items: [{ heading: 'Student 2', text: 'Pair Student 2 with [Student 1].' }] }, sentTokens);
    expect(draft).toEqual({ title: 'Plan for [Student 1]', items: [{ heading: '[Student 2]', text: 'Pair [Student 2] with [Student 1].' }] });
    expect(restore(draft.items[0].heading, v, sentTokens)).toBe('Meenal');
    expect(restore(draft.items[0].text, v, sentTokens)).toBe('Pair Meenal with Aarav.');
    expect(studentsNamed(draft.items[0], v).map((e) => e.surfaces[0])).toEqual(['Aarav', 'Meenal']);
  });

  it('is left alone when its bracketed form was not sent, or when it is part of a longer word or number', () => {
    expect(bracketBare('Student 3 and Student 12 and MyStudent 1 and Student 1a.', sentTokens)).toBe('Student 3 and Student 12 and MyStudent 1 and Student 1a.');
    expect(restore(bracketBare('Student 3', sentTokens), v, sentTokens)).toBe('Student 3');
  });

  it('is flagged by the return gate when its bracketed form was not sent', () => {
    expect(checkReply('Student 1\nPair Student 2 with [Student 1].', v, sentTokens, '')).toEqual([]);
    expect(checkReply('Student 3\nPair Student 3 with Adult 1.', v, sentTokens, '')).toEqual([
      { what: 'Student 3', why: 'a stand-in that was not in the text you approved' },
      { what: 'Adult 1', why: 'a stand-in that was not in the text you approved' },
    ]);
  });

  it('typed into the note is held back, so it cannot come back as somebody else', () => {
    const typed = 'Student 2 in my register is Aarav. Meenal is shy.';
    const tv = buildVault(typed, deterministicCandidates(typed, ['Aarav', 'Meenal']));
    expect(redact(typed, tv)).toBe('[withheld] in my register is [Student 1]. [Student 2] is shy.');
    expect(checkOutgoing(redact(typed, tv), tv, typed)).toEqual([]);
  });
});

describe('return gate: sensitive words', () => {
  const note = 'Meenal reads well. She has epilepsy.';
  const v = buildVault(note, deterministicCandidates(note, ['Meenal']));
  const { text: approved, tokens } = redactWithTokens(note, v);

  it('flags a sensitive word in the reply that was not in the approved text', () => {
    expect(approved).toBe('[Student 1] reads well. [withheld].');
    expect(checkReply('Watch [Student 1] for seizures, and ask about her medication.', v, tokens, approved)).toEqual([
      { what: 'seizures', why: 'a sensitive word that was not in the text you approved', say: 'The reply mentions seizures, which was not in the text you approved.' },
      { what: 'medication', why: 'a sensitive word that was not in the text you approved', say: 'The reply mentions medication, which was not in the text you approved.' },
    ]);
  });

  it('passes a sensitive word the teacher approved, in the singular or the plural', () => {
    const released = v.map((e) => (e.kind === 'private' ? { ...e, withheld: false } : e));
    const sent = redactWithTokens('Meenal reads well. She has had a seizure.', released);
    expect(checkReply('Know what to do if [Student 1] has seizures.', released, sent.tokens, sent.text)).toEqual([]);
    expect(checkReply('Give [Student 1] extra reading time.', v, tokens, approved)).toEqual([]);
  });
});

describe('a message home is for one family', () => {
  const note = 'Aarav reads well. His mother can be reached on 98765 43210.\n\nMeenal is shy. Ring 91234 56789.\n\nThe office number is 022 2345 6789.';
  const v = buildVault(note, deterministicCandidates(note, ['Aarav', 'Meenal']));
  const { tokens } = redactWithTokens(note, v);
  const family = (heading: string, text: string, sent = tokens, vault = v) => familyFor({ heading, text }, note, vault, sent);

  it('names the one student a message is for', () => {
    expect(tokens).toEqual(['[Student 1]', '[Contact 1]', '[Student 2]', '[Contact 2]', '[Contact 3]']);
    expect(family('[Student 1]', '[Student 1] reads well.')).toEqual({ student: v[0] });
    expect(family('A note home', 'Dear family, [Student 2] is settling in.').student?.surfaces[0]).toBe('Meenal');
  });

  it('refuses a message that names no student or several', () => {
    expect(family('A note home', 'Dear family, your child reads well.').why).toBe(
      'Copy is off: this message names no student, so the app cannot tell whose family it is for.',
    );
    expect(family('[Student 1]', '[Student 1] and [Student 2] sit together.').why).toBe(
      'Copy is off: this message names more than one student (Aarav and Meenal). A message home goes to one family.',
    );
  });

  it('counts a released name, as a whole word', () => {
    const released = v.map((e) => (e.surfaces[0] === 'Meenal' ? { ...e, withheld: false } : e));
    expect(family('[Student 1]', 'Aarav sits beside Meenal.', tokens, released).why).toMatch(/more than one student/);
    expect(family('[Student 1]', 'Aarav sits beside Meenalben.', tokens, released).student?.surfaces[0]).toBe('Aarav');
  });

  it("refuses a message that carries another child's contact detail, or one tied to nobody", () => {
    expect(ownersOf(note, v, v.find((e) => e.token === '[Contact 1]')!).map((e) => e?.surfaces[0])).toEqual(['Aarav']);
    expect(ownersOf(note, v, v.find((e) => e.token === '[Contact 3]')!)).toEqual([undefined]);
    expect(family('[Student 1]', 'Ring us on [Contact 1].')).toEqual({ student: v[0] });
    expect(family('[Student 1]', 'Ring us on [Contact 2].').why).toBe(
      'Copy is off: this message includes a contact detail or an identity number that your note does not tie to Aarav.',
    );
    expect(family('[Student 1]', 'Ring the office on [Contact 3].').why).toMatch(/does not tie to Aarav/);
  });

  it('refuses a message with a stand-in that was never sent', () => {
    expect(family('[Student 1]', 'Pair with [Student 9].').why).toBe('Copy is off: this message has a stand-in that was not in the text you approved.');
    expect(family('[Student 1]', 'Pair with Student 9.').why).toMatch(/stand-in that was not in the text/);
    // A stand-in the vault holds but the cloud was never sent does not count as a name.
    expect(family('[Student 2]', 'A note.', ['[Student 1]']).why).toMatch(/names no student|stand-in that was not/);
  });
});

describe('school policy that does not load in time', () => {
  const school = { cloudModel: 'gemini-3.5-flash', lockedKinds: ['contact', 'id', 'student'] as const };

  it('uses the last school policy this browser fetched, and says from when', () => {
    const raw = toSave({ cloudModel: school.cloudModel, lockedKinds: [...school.lockedKinds], origin: 'remote', from: 'school policy (Remote Config)' }, new Date('2026-11-20T09:30:00Z'));
    const policy = fallbackPolicy(readSaved(raw));
    expect(policy).toEqual({
      cloudModel: 'gemini-3.5-flash',
      lockedKinds: ['contact', 'id', 'student'],
      origin: 'saved',
      from: 'school policy, last loaded 20 Nov 2026',
    });
  });

  it('uses the built-in defaults when none was kept, and says the policy could not be loaded', () => {
    expect(fallbackPolicy(undefined)).toBe(DEFAULT_POLICY);
    expect(DEFAULT_POLICY.origin).toBe('defaults');
    expect(DEFAULT_POLICY.from).toBe('built-in defaults, school policy could not be loaded');
    expect(DEFAULT_POLICY.lockedKinds).toEqual(['contact', 'id']);
  });

  it('ignores a kept policy that is not in the present form', () => {
    const good = { cloudModel: 'gemini-3.5-flash', lockedKinds: ['contact'], loadedAt: '2026-11-20T09:30:00.000Z' };
    expect(readSaved(JSON.stringify(good))).toEqual(good);
    for (const raw of [
      null,
      '',
      'not json',
      'null',
      '[]',
      JSON.stringify({ ...good, cloudModel: '' }),
      JSON.stringify({ ...good, cloudModel: 'a model; rm -rf' }),
      JSON.stringify({ ...good, cloudModel: 7 }),
      JSON.stringify({ ...good, lockedKinds: 'contact' }),
      JSON.stringify({ ...good, lockedKinds: ['contact', 'everything'] }),
      JSON.stringify({ ...good, loadedAt: 'last week' }),
      JSON.stringify({ cloudModel: good.cloudModel, lockedKinds: [] }),
    ]) {
      expect(readSaved(raw), String(raw)).toBeUndefined();
    }
  });
});

describe('a guard run in which every request failed', () => {
  const parts = ['One.', 'Two.', 'Three.'];

  it('is a rules-only run that still counts the parts the model could not read', async () => {
    const report = await readChunks(parts, async () => {
      throw new Error('the model stopped');
    });
    expect(guardOutcome(report)).toEqual({ where: 'RULES_ONLY', unread: [0, 1, 2], dropped: 0, partial: 0 });
  });

  it('is an on-device run when the model read at least one part', async () => {
    let asked = 0;
    const report = await readChunks(parts, async () => {
      if (++asked === 2) throw new Error('the model stopped');
      return { text: '{"people":[],"places":[],"private":[]}', onDevice: true };
    });
    expect(guardOutcome(report)).toEqual({ where: 'ON_DEVICE', unread: [1], dropped: 0, partial: 0 });
  });

  it('keeps the count on the receipt of a rules-only run', () => {
    const r = makeReceipt({
      task: 'plan',
      label: 'x',
      labelWhere: 'FALLBACK',
      entities: [],
      guardWhere: 'RULES_ONLY',
      unreadParagraphs: 3,
      droppedDetails: 0,
      sentText: 'x',
      sentSha256: '',
      approvedAt: new Date().toISOString(),
      draftWhere: 'ON_DEVICE',
      draftModel: 'Gemini Nano (Chrome built-in)',
      cloudFailedWhile: 'offline',
      checkWhere: 'SKIPPED',
      replyFlagged: false,
      checks: [],
      kept: 1,
      struck: 0,
    });
    expect([r.guard.where, r.guard.unreadParagraphs]).toEqual(['RULES_ONLY', 3]);
    expect(r.draft).toEqual({ where: 'ON_DEVICE', model: 'Gemini Nano (Chrome built-in)', cloud: 'failed', browser: 'offline' });
  });
});

describe('the draft line of a receipt', () => {
  it('says the cloud draft failed and gives the network state as a separate fact', () => {
    expect(draftLine({ where: 'IN_CLOUD', model: 'gemini-3.5-flash-lite' })).toBe('gemini-3.5-flash-lite, in the cloud');
    expect(draftLine({ where: 'ON_DEVICE', model: 'Gemini Nano (Chrome built-in)', cloud: 'failed', browser: 'offline' })).toBe(
      'Gemini Nano (Chrome built-in), on the device. The cloud draft failed, so the on-device model wrote it. Browser reported: offline.',
    );
    expect(draftLine({ where: 'ON_DEVICE', model: 'Gemini Nano (Chrome built-in)', cloud: 'failed', browser: 'online' })).toMatch(/Browser reported: online\.$/);
    // A receipt from before: the cause it named is not repeated.
    expect(draftLine({ where: 'ON_DEVICE', model: 'Gemini Nano (Chrome built-in)', cloud: 'not reached' })).toBe(
      'Gemini Nano (Chrome built-in), on the device. The cloud draft failed, so the on-device model wrote it.',
    );
  });
});

describe('note length', () => {
  it('has room for the sample note many times over', () => {
    expect(NOTE_MAX).toBe(8000);
    expect(SAMPLE_NOTE.length).toBeLessThan(NOTE_MAX / 4);
  });
});

describe('a private detail inside another', () => {
  const note = 'Meenal reads well. She told me she has epilepsy and is afraid of a seizure. Tanvi is shy. Her father is unemployed.';
  const v = buildVault(note, [
    { kind: 'student', text: 'Meenal', source: 'class list' },
    { kind: 'private', text: 'She told me she has epilepsy and is afraid of a seizure', source: 'rule', category: 'health' },
    { kind: 'private', text: 'has epilepsy', source: 'on-device model', category: 'health' },
    { kind: 'private', text: 'afraid of a seizure', source: 'on-device model', category: 'health' },
    { kind: 'private', text: 'Her father is unemployed', source: 'rule', category: 'family' },
  ]);
  const id = (text: string) => v.find((e) => e.surfaces[0] === text)!.id;

  it('is listed under the longer one', () => {
    expect([...insidePrivate(note, v)]).toEqual([
      [id('has epilepsy'), id('She told me she has epilepsy and is afraid of a seizure')],
      [id('afraid of a seizure'), id('She told me she has epilepsy and is afraid of a seizure')],
    ]);
  });

  it('changes no count and nothing that is sent', () => {
    expect(v.filter((e) => e.withheld && e.kind === 'private')).toHaveLength(4);
    expect(redact(note, v)).toBe('[Student 1] reads well. [withheld]. Tanvi is shy. [withheld].');
    // With the sentence released, the parts inside it stay withheld.
    const released = v.map((e) => (e.id === id('She told me she has epilepsy and is afraid of a seizure') ? { ...e, withheld: false } : e));
    expect(redact(note, released)).toBe('[Student 1] reads well. She told me she [withheld] and is [withheld]. Tanvi is shy. [withheld].');
  });

  it('does not nest the same words in two places, or details side by side', () => {
    const twice = 'He is unwell. Later: he is unwell again.';
    const tv = buildVault(twice, [{ kind: 'private', text: 'he is unwell', source: 'teacher' }]);
    expect(insidePrivate(twice, tv).size).toBe(0);
  });
});

describe('the cases for measuring the on-device check', () => {
  it('has twelve conflicts and twelve compatible cases over six topics', () => {
    expect(CASES).toHaveLength(24);
    expect(CASES.filter((c) => c.expected === 'conflict')).toHaveLength(12);
    expect(CASES.filter((c) => c.expected === 'compatible')).toHaveLength(12);
    expect([...new Set(CASES.map((c) => c.topic))].sort()).toEqual(['family', 'health', 'money', 'place', 'time', 'travel']);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(24);
  });

  it('puts each case to the check as the app would: one child, one withheld fact, one prompt', async () => {
    for (const c of CASES) {
      const p = prepare(c);
      expect(p.tokens, c.id).toEqual(['[Student 1]', '[withheld]']);
      const groups = detailsFor(p.item, p.entities);
      expect(groups.map((g) => [g.student?.surfaces[0], g.details.map((d) => d.surfaces[0])]), c.id).toEqual([[c.student, [c.fact]]]);
      const prompts: string[] = [];
      const run = await checkItems([p.item], p.entities, paragraphs(p.note), p.tokens, async (prompt) => {
        prompts.push(prompt);
        return { text: '{"verdict":"fits","reason":"ok"}', onDevice: true };
      });
      expect(run.asked, c.id).toBe(1);
      expect(prompts[0], c.id).toContain(`Private facts about ${c.student}:\n- ${c.fact}`);
      expect(prompts[0], c.id).toContain(c.advice.replaceAll('[Student 1]', c.student));
    }
  });

  it('adds up the rows without estimating anything', () => {
    const row = (expected: 'conflict' | 'compatible', got: 'fits' | 'conflict' | 'unsure' | 'failed' | 'not checked', ms: number) => ({
      id: 'x', run: 1, topic: 'time' as const, expected, got, reason: '', ms,
    });
    expect(
      totals([
        row('conflict', 'conflict', 900),
        row('conflict', 'unsure', 1100),
        row('conflict', 'fits', 1000),
        row('conflict', 'failed', 10),
        row('compatible', 'fits', 800),
        row('compatible', 'conflict', 1200),
        row('compatible', 'unsure', 700),
        row('compatible', 'not checked', 5),
      ]),
    ).toEqual({
      runs: 8,
      conflictCases: 4,
      conflictsCaught: 1,
      conflictsUnsure: 1,
      conflictsMissed: 1,
      compatibleCases: 4,
      compatiblePassed: 1,
      compatibleFlaggedAsConflict: 1,
      compatibleUnsure: 1,
      failures: 2,
      medianMs: 800,
    });
    expect(totals([]).medianMs).toBe(0);
  });
});

describe('an occurrence the teacher marked by hand', () => {
  const mark = (note: string, vault: ReturnType<typeof buildVault>, from: number, text: string, kind: 'private' | 'adult' = 'private') =>
    addByTeacher(note, vault, text, kind, { start: from, end: from + text.length });

  it('withholds the last two of three repeated words, and nothing else', () => {
    const note = 'It was very very very hard.';
    const v = mark(note, [], note.indexOf('very very', 8), 'very very');
    expect(v.map((e) => [e.surfaces[0], e.span])).toEqual([['very very', { start: 12, end: 21 }]]);
    expect(redact(note, v)).toBe('It was very [withheld] hard.');
    expect(segment(note, v).map((s) => [s.text, Boolean(s.entity)])).toEqual([
      ['It was very ', false],
      ['very very', true],
      [' hard.', false],
    ]);
    expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
  });

  it('withholds the first two of three repeated words when those were selected', () => {
    const note = 'very very very';
    const v = mark(note, [], 0, 'very very');
    expect(redact(note, v)).toBe('[withheld] very');
    expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
    const both = mark(note, v, 10, 'very');
    expect(redact(note, both)).toBe('[withheld] [withheld]');
    expect(checkOutgoing(redact(note, both), both, note)).toEqual([]);
  });

  it('withholds only the one of two identical phrases that was selected', () => {
    const note = 'He is unwell. Later he is unwell again.';
    const second = note.lastIndexOf('he is unwell');
    const v = mark(note, [], second, 'he is unwell');
    expect(redact(note, v)).toBe('He is unwell. Later [withheld] again.');
    expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
    // Marking the first as well gives two entries, and releasing one leaves the other.
    const both = mark(note, v, 0, 'He is unwell');
    expect(redact(note, both)).toBe('[withheld]. Later [withheld] again.');
    const released = both.map((e) => (e.span?.start === 0 ? { ...e, withheld: false } : e));
    expect(redact(note, released)).toBe('He is unwell. Later [withheld] again.');
    expect(checkOutgoing(redact(note, released), released, note)).toEqual([]);
    // Selecting the second again does not withhold the released first.
    expect(redact(note, mark(note, released, second, 'he is unwell'))).toBe('He is unwell. Later [withheld] again.');
    // Selecting the released first withholds it again.
    expect(redact(note, mark(note, released, 0, 'He is unwell'))).toBe('[withheld]. Later [withheld] again.');
  });

  it('is stopped at the exit gate when its offsets do not hold its words', () => {
    const note = 'He is unwell. Later he is unwell again.';
    const v = mark(note, [], 0, 'He is unwell');
    const moved = v.map((e) => ({ ...e, span: { start: 3, end: 15 } }));
    expect(redact(note, moved)).toBe(note);
    expect(checkOutgoing(redact(note, moved), moved, note)).toEqual([{ what: 'He is unwell', why: 'marked but not found in the text' }]);
    const beyond = v.map((e) => ({ ...e, span: { start: 30, end: 90 } }));
    expect(checkOutgoing(redact(note, beyond), beyond, note).map((x) => x.why)).toEqual(['marked but not found in the text']);
  });

  it('still withholds a marked name wherever it stands', () => {
    const note = 'Sunita rang. I told Sunita to wait.';
    const v = mark(note, [], 20, 'Sunita', 'adult');
    expect(redact(note, v)).toBe('[Adult 1] rang. I told [Adult 1] to wait.');
    expect(checkOutgoing(redact(note, v), v, note)).toEqual([]);
  });
});
