import { describe, expect, it } from 'vitest';
import { findByRule, nameParts } from './rules';
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

  it('leaves ordinary numbers and dates alone', () => {
    expect(findByRule('Class 6B scored 42 out of 50 on 16 November 2026. 4 days absent.')).toEqual([]);
  });

  it('drops honorifics from names', () => {
    expect(nameParts('Mrs. Kavita Rao')).toEqual(['Kavita', 'Rao']);
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
    expect(redacted).toContain("[Student 3]'s parents");
    expect(redacted).toContain(PRIVATE_TOKEN);
  });

  it('attaches a private detail to the right student', () => {
    const byId = (id?: string) => vault.find((e) => e.id === id)?.surfaces[0];
    const details = vault.filter((e) => e.kind === 'private');
    expect(byId(details[0].about)).toBe('Meenal');
    expect(byId(details[1].about)).toBe('Aarav Sharma');
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

import { anchorQuote, paragraphs, readGuardAnswer } from '../ai/guard';
import { anythingToCheck, detailsFor, readVerdict } from '../ai/check';
import { makeReceipt } from './receipts';

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
});

describe('check and receipt', () => {
  const note = 'Meenal reads well. She has epilepsy.\n\nTanvi is shy.';
  const vault = buildVault(note, [
    { kind: 'student', text: 'Meenal', source: 'class list' },
    { kind: 'student', text: 'Tanvi', source: 'class list' },
    { kind: 'private', text: 'She has epilepsy', source: 'on-device model', category: 'health' },
  ]);

  it('gives each item only the details about the students it names', () => {
    expect(detailsFor({ heading: '[Student 1]', text: 'timed quiz' }, vault)[0].details).toHaveLength(1);
    expect(detailsFor({ heading: '[Student 2]', text: 'pair work' }, vault)).toEqual([]);
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

  it('knows when no item has anything to be checked against', () => {
    expect(anythingToCheck([{ heading: '[Student 2]', text: 'pair work' }], vault)).toBe(false);
    expect(anythingToCheck([{ heading: '[Student 2]', text: 'pair work' }, { heading: '[Student 1]', text: 'quiz' }], vault)).toBe(true);
  });

  it('writes a receipt with no vault contents', () => {
    const receipt = makeReceipt({
      task: 'plan',
      label: 'Support plan',
      entities: vault,
      guardWhere: 'ON_DEVICE',
      unreadParagraphs: 1,
      droppedDetails: 0,
      sentText: redact(note, vault),
      approvedAt: new Date().toISOString(),
      draftWhere: 'IN_CLOUD',
      draftModel: 'gemini-3.5-flash-lite',
      checkWhere: 'ON_DEVICE',
      replyFlagged: false,
      checks: [{ verdict: 'conflict', reason: 'x' }, { verdict: 'nothing withheld', reason: 'y' }],
      kept: 1,
      struck: 1,
    });
    const json = JSON.stringify(receipt);
    expect(json).not.toContain('Meenal');
    expect(json).not.toContain('epilepsy');
    expect(receipt.guard.found.student).toBe(2);
    expect(receipt.guard.unreadParagraphs).toBe(1);
    expect(receipt.check.conflict).toBe(1);
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
