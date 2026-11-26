import { describe, expect, it } from 'vitest';
import { findByRule, findSensitive, nameParts, sentences } from './rules';
import { addByTeacher, applyLocks, buildVault, deterministicCandidates, redact, restore, segment, PRIVATE_TOKEN } from './vault';
import { checkOutgoing, checkReply } from './gate';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from './samples';
import { plainText } from './text';

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
  const redacted = redact(SAMPLE_NOTE, vault);

  it('treats a first name and a full name as one student', () => {
    const students = vault.filter((e) => e.kind === 'student');
    expect(students.map((s) => s.surfaces[0])).toEqual(['Aarav Sharma', 'Meenal', 'Kabir', 'Tanvi', 'Ishaan']);
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
    expect(about('she has epilepsy')).toBe('Meenal');
    expect(about('She told me')).toBe('Meenal');
    expect(about('his father lost his job')).toBe('Aarav Sharma');
    expect(about('His mother Sunita')).toBe('Aarav Sharma');
    // A name inside the detail wins over the name nearest before it ("Kabir and Ishaan fight ...").
    expect(about("Kabir's parents")).toBe('Kabir');
  });

  it('puts names back on the device', () => {
    expect(restore('Seat [Student 1] beside [Student 4]. Ask [Adult 1].', vault)).toBe(
      'Seat Aarav Sharma beside Tanvi. Ask Sunita.',
    );
  });

  it('lets the teacher release one item and mark another', () => {
    const released = vault.map((e) => (e.surfaces[0] === 'Tanvi' ? { ...e, withheld: false } : e));
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
      expect(checkReply('Pair [Student 1] with [Student 4].', vault, redacted)).toEqual([]);
    });

    it('flags a stand-in that is not in the vault', () => {
      expect(checkReply('Pair [Student 1] with [Student 9].', vault, redacted)).toHaveLength(1);
    });

    it('flags a stand-in the vault holds but the approved text did not contain', () => {
      const approved = 'Help [Student 1] with homework.';
      expect(vault.some((e) => e.token === '[Student 4]')).toBe(true);
      const issues = checkReply('Pair [Student 1] with [Student 4]. Thank [Student 4].', vault, approved);
      expect(issues).toEqual([{ what: '[Student 4]', why: 'a stand-in that was not in the text you approved' }]);
      expect(checkReply('Seat [Student 1] at the front.', vault, approved)).toEqual([]);
    });

    it('flags a real name coming back', () => {
      expect(checkReply('Ask Meenal to read.', vault, redacted)).toHaveLength(1);
    });
  });
});

import { anchorQuote, MAX_CHUNK, paragraphs, readGuardAnswer } from '../ai/guard';
import { anythingToCheck, checkPrompt, contextParagraphs, detailsFor, readVerdict, studentsNamed } from '../ai/check';
import { makeReceipt, receiptRecord, sha256Hex } from './receipts';

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

  it('reads a well-formed answer and counts a detail it cannot find in the note', () => {
    const reading = readGuardAnswer(
      para,
      JSON.stringify({
        people: [{ name: 'Kabir', role: 'student' }],
        places: [],
        private: [
          { quote: "Kabir's parents are separating", category: 'family', about: 'Kabir' },
          { quote: 'he has asthma', category: 'health', about: 'Kabir' },
        ],
      }),
    );
    expect(reading?.candidates.map((c) => c.text)).toEqual(['Kabir', "Kabir's parents are separating"]);
    expect(reading?.dropped).toBe(1);
  });

  it('reports an answer it cannot read instead of treating it as empty', () => {
    expect(readGuardAnswer(para, '{"people": [')).toBeUndefined();
    expect(readGuardAnswer(para, 'null')).toBeUndefined();
    expect(readGuardAnswer(para, '[]')).toBeUndefined();
    expect(readGuardAnswer(para, '{"people": "Kabir", "places": [], "private": []}')).toBeUndefined();
    expect(readGuardAnswer(para, '{"people": [], "places": [], "private": []}')).toEqual({ candidates: [], dropped: 0 });
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
