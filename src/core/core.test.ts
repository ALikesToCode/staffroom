import indexHtml from '../../index.html?raw';
import { describe, expect, it } from 'vitest';
import { findByRule, findSensitive, nameParts, sentences } from './rules';
import {
  addByTeacher,
  applyLocks,
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
import { plainText } from './text';

/** The sample note as it goes out when no model read it: class list, patterns, sensitive words and capitalised words only. */
const RULES_ONLY_SAMPLE = `Class 6B, week of 16 November. Notes for myself.

[Student 1] has missed four days this month. [withheld]. He is bright in maths but has not handed in homework for two weeks.

[Student 2] reads well aloud but freezes in written tests. She needs extra writing practice. [withheld]. Her [ID 1]. She walks six kilometres home to [Place 1] and must leave before dark.

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
      expect(checkReply('Pair [Student 1] with [Student 4].', vault, sentTokens)).toEqual([]);
    });

    it('flags a stand-in that is not in the vault', () => {
      expect(checkReply('Pair [Student 1] with [Student 9].', vault, sentTokens)).toHaveLength(1);
    });

    it('flags a stand-in the vault holds but the approved text did not contain', () => {
      const approved = ['[Student 1]'];
      expect(vault.some((e) => e.token === '[Student 4]')).toBe(true);
      const issues = checkReply('Pair [Student 1] with [Student 4]. Thank [Student 4].', vault, approved);
      expect(issues).toEqual([{ what: '[Student 4]', why: 'a stand-in that was not in the text you approved' }]);
      expect(checkReply('Seat [Student 1] at the front.', vault, approved)).toEqual([]);
    });

    it('flags a malformed look-alike of a stand-in', () => {
      const approved = ['[Student 1]', '[withheld]'];
      expect(checkReply('Ask [student 1], [Student1], [ Student 1 ] and [Student 99]. [withheld] stays.', vault, approved).map((v) => v.what)).toEqual([
        '[student 1]',
        '[Student1]',
        '[ Student 1 ]',
        '[Student 99]',
      ]);
    });

    it('flags a real name coming back', () => {
      expect(checkReply('Ask Meenal to read.', vault, sentTokens)).toHaveLength(1);
    });
  });
});

import { anchor, anchorQuote, MAX_CHUNK, paragraphs, readChunks, readGuardAnswer } from '../ai/guard';
import { anythingToCheck, checkPrompt, contextParagraphs, detailsFor, readVerdict, startsKept, studentsNamed } from '../ai/check';
import { asReceiptRecord, makeReceipt, receiptRecord, sha256Hex } from './receipts';

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
    const prompt = checkPrompt(detailsFor({ heading: 'Whole class', text: 'Timed test for [Student 2].' }, vault)[0], { heading: 'Whole class', text: 'Timed test for [Student 2].' }, ['Meenal reads well. She has epilepsy.', 'Tanvi is shy.'], vault);
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

  it('starts an item in conflict as struck and the rest as kept', () => {
    const verdicts = ['fits', 'conflict', 'unsure', 'not checked', 'nothing withheld'] as const;
    expect(startsKept(verdicts.map((verdict) => ({ verdict, reason: '' })))).toEqual([true, false, true, true, true]);
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
    expect(record.approvedSha256).toBe(await sha256Hex(sentText));
    expect(record.approvedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.withheld).toEqual({ student: 2, adult: 0, place: 0, contact: 0, id: 0, private: 1 });
    expect(record.verdicts.conflict).toBe(1);
    expect(record.flags).toEqual({ replyFlagged: true, unreadParagraphs: 1, droppedDetails: 0 });
    expect([record.kept, record.struck]).toEqual([1, 1]);
    // Every value is a number, a boolean, or one of a few short fixed strings.
    const strings = Object.values(record).filter((v): v is string => typeof v === 'string');
    expect(strings.every((v) => v.length <= 100)).toBe(true);
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
    expect(asReceiptRecord({ ...record, draftModel: 'x'.repeat(101) })).toBeUndefined();
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
