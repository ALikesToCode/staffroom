import { describe, expect, it } from 'vitest';
import { findByRule, nameParts } from './rules';
import { addByTeacher, buildVault, deterministicCandidates, redact, restore, segment, PRIVATE_TOKEN } from './vault';
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
    it('passes a reply that uses known stand-ins', () => {
      expect(checkReply('Pair [Student 1] with [Student 4].', vault)).toEqual([]);
    });

    it('flags a stand-in that is not in the vault', () => {
      expect(checkReply('Pair [Student 1] with [Student 9].', vault)).toHaveLength(1);
    });

    it('flags a real name coming back', () => {
      expect(checkReply('Ask Meenal to read.', vault)).toHaveLength(1);
    });
  });
});

import { anchorQuote, paragraphs } from '../ai/guard';
import { detailsFor } from '../ai/check';
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

  it('writes a receipt with no vault contents', () => {
    const receipt = makeReceipt({
      task: 'plan',
      label: 'Support plan',
      entities: vault,
      guardWhere: 'ON_DEVICE',
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
