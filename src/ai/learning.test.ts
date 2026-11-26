import { describe, expect, it } from 'vitest';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from '../core/samples';
import { proposeLearning } from '../core/lessonNeeds';
import { buildVault, deterministicCandidates } from '../core/vault';
import { askForLearning, LEARNING_SCHEMA, LEARNING_SYSTEM, mergeLearning, readLearningAnswer } from './learning';
import { studentParagraphs } from './constraints';

const vault = buildVault(SAMPLE_NOTE, deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST));
const paras = studentParagraphs(SAMPLE_NOTE, vault);
const meenal = paras.find((p) => p.includes('Meenal'))!;
const answer = (needs: { quote: string; need: string }[]) => JSON.stringify({ needs });

describe('learning needs from the on-device model', () => {
  it('asks for a quote and a short line with no name and no reason', () => {
    expect(LEARNING_SYSTEM).toContain('copied exactly');
    expect(LEARNING_SYSTEM).toContain('at most 12 words');
    expect(LEARNING_SYSTEM).toContain('no name and no reason');
    expect(LEARNING_SCHEMA.properties.needs.items.required).toEqual(['quote', 'need']);
  });

  it('keeps a need whose quote is in the paragraph, for the child it is about', () => {
    const got = readLearningAnswer(SAMPLE_NOTE, meenal, answer([{ quote: 'needs extra writing practice', need: 'Needs extra writing practice in class.' }]), vault)!;
    expect(got.dropped).toBe(0);
    expect(got.needs).toHaveLength(1);
    expect(got.needs[0]).toMatchObject({ kind: 'learning', need: 'Needs extra writing practice in class', source: 'on-device model', confirmed: false, aboutName: 'Meenal Joshi' });
    expect(SAMPLE_NOTE.slice(got.needs[0].at!, got.needs[0].at! + got.needs[0].text.length)).toBe('needs extra writing practice');
  });

  it('drops a quote that is not in the paragraph, a long line, a name, a stand-in and a word that gives the reason', () => {
    const got = readLearningAnswer(
      SAMPLE_NOTE,
      meenal,
      answer([
        { quote: 'never said this', need: 'needs more time' },
        { quote: 'reads well aloud', need: 'needs a very long line that goes on and on for far more than twelve words in all' },
        { quote: 'reads well aloud', need: 'needs Meenal to read aloud' },
        { quote: 'reads well aloud', need: 'needs [Student 2] to read aloud' },
        { quote: 'freezes in written tests', need: 'needs oral tests because of epilepsy' },
        { quote: 'reads well aloud', need: '' },
      ]),
      vault,
    )!;
    expect(got.needs).toEqual([]);
    expect(got.dropped).toBe(6);
    expect(readLearningAnswer(SAMPLE_NOTE, meenal, 'not json', vault)).toBeUndefined();
  });

  it('merges by span: the rule keeps its line and is marked, and new words are added', () => {
    const byRule = proposeLearning(SAMPLE_NOTE, vault);
    const got = readLearningAnswer(
      SAMPLE_NOTE,
      meenal,
      answer([
        { quote: 'freezes in written tests', need: 'needs to answer aloud' },
        { quote: 'needs extra writing practice', need: 'needs extra writing practice' },
      ]),
      vault,
    )!;
    const merged = mergeLearning(byRule, got.needs);
    expect(merged).toHaveLength(byRule.length + 1);
    const tests = merged.find((c) => c.learn === 'tests')!;
    expect(tests.alsoModel).toBe(true);
    expect(tests.need).toBe('finds written tests hard; can answer aloud');
  });

  it('stops when an answer does not come from the device', async () => {
    let asked = 0;
    const report = await askForLearning(SAMPLE_NOTE, vault, async () => {
      asked++;
      return { text: '', onDevice: false };
    });
    expect(asked).toBe(1);
    expect(report.stopped).toContain('did not run on the device');
    expect(report.needs).toEqual([]);
  });

  it('counts a failed request and goes on', async () => {
    let n = 0;
    const report = await askForLearning(SAMPLE_NOTE, vault, async (p) => {
      if (n++ === 0) throw new Error('x');
      return { text: p.includes('Ishaan') ? answer([{ quote: 'finishes early and gets bored', need: 'needs a harder task ready' }]) : answer([]), onDevice: true };
    });
    expect(report.unread).toBe(1);
    expect(report.asked).toBe(paras.length);
    expect(report.needs.map((c) => c.need)).toEqual(['needs a harder task ready']);
  });
});
