import { describe, expect, it } from 'vitest';
import type { Constraint } from '../core/types';
import { childFitPrompt, FIT_CHILD_FAILED, FIT_CHILD_SYSTEM, fitForChild, canFit, factWordsIn, FIT_FAILED, FIT_MAX, FIT_SCHEMA, FIT_SYSTEM, fitHits, fitInputFor, fitPrompt, fitStep, readFit, FIT_LESSON_SYSTEM, fitLessonForChild, fitLessonPrompt, fitLessonSchema, readPoints, type FitAsk, type FitPoint, type FitStage } from './fit';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from '../core/samples';
import { buildVault, deterministicCandidates, possibleNameCandidates, redactWithTokens } from '../core/vault';
import { confirmConstraint, proposeConstraints } from '../core/constraints';
import { ruleCheckItem, combineChecks } from '../core/conflicts';
import { ROUTES } from './routes';

const leave: Constraint = { id: 'c1', kind: 'time-after', text: 'has to leave school at the last bell to reach home before dark', source: 'rule', confirmed: true, about: 's2' };
const money: Constraint = { id: 'c2', kind: 'money', text: 'the family cannot pay for anything extra this term', source: 'rule', confirmed: true, about: 's2' };
const step = 'Second, enrol Meenal in the remedial writing club after the last bell.';
const input = { step, itemText: `First, seat her at the front. ${step}`, constraint: leave, studentName: 'Meenal', task: 'plan' as const };

/** A model that gives these answers in turn, and remembers what it was asked. */
const fake = (answers: (string | { text: string; onDevice: boolean })[]) => {
  const prompts: string[] = [];
  const ask: FitAsk = async (prompt) => {
    prompts.push(prompt);
    const a = answers[prompts.length - 1] ?? '';
    return typeof a === 'string' ? { text: a, onDevice: true } : a;
  };
  return { ask, prompts };
};
const says = (rewrite: string) => JSON.stringify({ rewrite });

describe('the fit route', () => {
  it('is ONLY_ON_DEVICE, with a short instruction and a one-field answer', () => {
    expect(ROUTES.find((r) => r.id === 'fit')!.mode).toBe('only_on_device');
    expect(FIT_SYSTEM.length).toBeLessThan(260);
    expect(FIT_SCHEMA).toEqual({ type: 'object', properties: { rewrite: { type: 'string' } }, required: ['rewrite'] });
  });

  it('asks with the fact and the step, and nothing else', () => {
    expect(fitPrompt(input)).toBe(
      `Fact about the child: has to leave school at the last bell to reach home before dark\nStep: ${step}\nRewrite the step so the child can follow it.`,
    );
    expect(fitPrompt(input, ['after school', 'club'])).toMatch(/\nIt must not involve: after school, club$/);
  });
});

describe('reading a suggestion', () => {
  it('trims it and keeps at most 300 characters, cut at the end of a sentence', () => {
    expect(readFit(says('  Give Meenal the same task\n in the lunch break.  '), step)).toBe('Give Meenal the same task in the lunch break.');
    const long = `${'Give her the task at lunch. '.repeat(12)}`;
    const kept = readFit(says(long), step)!;
    expect(kept.length).toBeLessThanOrEqual(FIT_MAX);
    expect(kept.endsWith('lunch.')).toBe(true);
    expect(readFit(says('x'.repeat(400)), step)).toHaveLength(FIT_MAX);
  });

  it('rejects an empty answer, the step again, and anything that is not the answer asked for', () => {
    expect(readFit(says('   '), step)).toBeUndefined();
    expect(readFit(says(step), step)).toBeUndefined();
    expect(readFit(says(`  ${step.toUpperCase()} `), step)).toBeUndefined();
    expect(readFit('Give her the task at lunch.', step)).toBeUndefined();
    expect(readFit('{"rewrite": 3}', step)).toBeUndefined();
    expect(readFit('null', step)).toBeUndefined();
  });
});

describe('fitting a step on the device', () => {
  it('offers a suggestion no rule fires on, after one request', async () => {
    const model = fake([says('Second, give Meenal the remedial writing task in the lunch break.')]);
    expect(await fitStep(input, model.ask)).toEqual({ ok: true, suggestion: 'Second, give Meenal the remedial writing task in the lunch break.', asked: 1 });
    expect(model.prompts).toEqual([fitPrompt(input)]);
  });

  it('asks once more, naming the matched words, when a rule still fires', async () => {
    const model = fake([says('Ask Meenal to stay back for ten minutes of writing.'), says('Give Meenal ten minutes of writing in the lunch break.')]);
    expect(await fitStep(input, model.ask)).toEqual({ ok: true, suggestion: 'Give Meenal ten minutes of writing in the lunch break.', asked: 2 });
    expect(model.prompts[1]).toBe(`${fitPrompt(input)}\nIt must not involve: stay back`);
  });

  it('compares the suggestion with every confirmed constraint about the student, not only the one in conflict', async () => {
    const both = { ...input, constraints: [leave, money, { ...money, id: 'c3', kind: 'time-before' as const, confirmed: false }] };
    const model = fake([says('Ask her family to buy the writing workbook for home.'), says('Meet her before school to write.')]);
    expect(fitHits('Ask her family to buy the writing workbook for home.', both).map((h) => h.matched)).toEqual(['buy']);
    // The second answer goes against nothing confirmed: the time-before constraint is not confirmed.
    expect(await fitStep(both, model.ask)).toEqual({ ok: true, suggestion: 'Meet her before school to write.', asked: 2 });
    expect(model.prompts[1]).toMatch(/It must not involve: buy$/);
  });

  it('knows an activity the note says meets after the last bell', async () => {
    const model = fake([says('Send Meenal to the remedial writing club.'), says('Send Meenal to the remedial writing club on Fridays.')]);
    expect(await fitStep({ ...input, afterBell: ['remedial writing club'] }, model.ask)).toEqual({ ok: false, say: FIT_FAILED, asked: 2 });
  });

  it('gives up after the second request, and says so', async () => {
    const model = fake([says('Keep her after school.'), says('Give her a detention.')]);
    expect(await fitStep(input, model.ask)).toEqual({ ok: false, say: 'The on-device model could not fit this step. Rewrite it yourself or strike it.', asked: 2 });
    expect(model.prompts).toHaveLength(2);
    expect(await fitStep(input, fake(['not json', says(step)]).ask)).toEqual({ ok: false, say: FIT_FAILED, asked: 2 });
    expect(await fitStep(input, fake([says(''), says('Give her the task at lunch.')]).ask)).toMatchObject({ ok: true, asked: 2 });
  });

  it('stops, and reads nothing, when an answer did not come from the device', async () => {
    const model = fake([{ text: says('Give her the task at lunch.'), onDevice: false }]);
    await expect(fitStep(input, model.ask)).rejects.toThrow('The fit did not run on the device. Stopped.');
    expect(model.prompts).toHaveLength(1);
  });

  it('a failed request is the caller\'s to report: it is not turned into a suggestion', async () => {
    const ask: FitAsk = async () => {
      throw new Error('the model stopped');
    };
    await expect(fitStep(input, ask)).rejects.toThrow('the model stopped');
  });
});

describe('what is asked for an item in conflict', () => {
  const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
  let held = { entities: vault, constraints: proposeConstraints(SAMPLE_NOTE, vault) };
  for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
  const { entities, constraints } = held;
  const { tokens } = redactWithTokens(SAMPLE_NOTE, entities);
  const meenal = entities.find((e) => e.surfaces.includes('Meenal'))!;
  const item = { heading: meenal.token, text: `First, seat ${meenal.token} at the front. Second, enrol her in the remedial writing club. Third, praise her.` };
  const check = combineChecks(ruleCheckItem(item, constraints, entities, tokens, SAMPLE_NOTE), undefined, { verdict: 'not checked', reason: 'x' });

  it('is the step the rule matched, the constraint, and every confirmed constraint about that student', () => {
    const asked = fitInputFor(item, check, constraints, entities, tokens, SAMPLE_NOTE, 'plan')!;
    expect(asked.step).toBe('Second, enrol her in the remedial writing club.');
    expect(asked.whole).toBe(false);
    expect(asked.constraint.kind).toBe('time-after');
    expect(asked.studentName).toBe('Meenal');
    expect(asked.afterBell).toEqual(['remedial writing club']);
    expect(asked.constraints!.map((c) => c.about)).toEqual([meenal.id, meenal.id]);
    expect(asked.constraints!.map((c) => c.kind).sort()).toEqual(['health', 'time-after']);
  });

  it('is nothing for an item with no rule conflict, or whose constraint was switched off', () => {
    const off = constraints.map((c) => (c.id === check.constraintId ? { ...c, confirmed: false } : c));
    expect(canFit(check, constraints)).toBe(true);
    expect(canFit(check, off)).toBe(false);
    expect(fitInputFor(item, check, off, entities, tokens, SAMPLE_NOTE, 'plan')).toBeUndefined();
    expect(canFit({ verdict: 'unsure', reason: 'r', by: 'model' }, constraints)).toBe(false);
    expect(canFit({ verdict: 'conflict', reason: 'r' }, constraints)).toBe(false);
    expect(canFit(undefined, constraints)).toBe(false);
  });

  it('a suggestion that still sends her to the club is asked for again, then given up', async () => {
    const asked = fitInputFor(item, check, constraints, entities, tokens, SAMPLE_NOTE, 'plan')!;
    const model = fake([says('Second, send her to the remedial writing club with a friend.'), says('Second, give her the same writing task in the lunch break.')]);
    expect(await fitStep(asked, model.ask)).toMatchObject({ ok: true, asked: 2 });
    expect(model.prompts[1]).toMatch(/It must not involve: remedial writing club$/);
  });
});

describe('the words of the private fact in a text', () => {
  it('lists the words of the fact a suggestion repeats, small words left out', () => {
    expect(factWordsIn('Give Meenal the task at lunch, as she must leave to reach home before dark.', leave)).toEqual(['leave', 'reach', 'home', 'dark']);
    expect(factWordsIn('Give Meenal the task in the lunch break.', leave)).toEqual([]);
    expect(factWordsIn('Lend her the workbook.', money)).toEqual([]);
  });
});

describe('what one child does instead of a step of the lesson', () => {
  const lessonStep = 'Anyone still writing stays after school on Thursday to finish.';
  const child = { step: lessonStep, constraint: leave, constraints: [leave, money] };

  it('asks with the fact and the step, under a short instruction that forbids stating the fact', () => {
    expect(FIT_CHILD_SYSTEM).toMatch(/what this child does instead, for the same purpose\. Do not state the fact\.$/);
    expect(FIT_CHILD_SYSTEM.length).toBeLessThan(260);
    expect(childFitPrompt(child)).toBe(`Fact about the child: ${leave.text}\nStep: ${lessonStep}\nSay what this child does instead.`);
  });

  it('offers an adjustment no rule fires on, and asks once more when one does', async () => {
    const model = fake([says('She buys a notebook and finishes at home.'), says('She finishes in the lunch break on Thursday.')]);
    expect(await fitForChild(child, model.ask)).toEqual({ ok: true, suggestion: 'She finishes in the lunch break on Thursday.', asked: 2 });
    expect(model.prompts[1]).toMatch(/It must not involve: buys$/);
  });

  it('gives up after two requests, and stops when an answer is not from the device', async () => {
    expect(await fitForChild(child, fake([says('Stays back on Friday.'), says('Stays late on Friday.')]).ask)).toEqual({ ok: false, say: FIT_CHILD_FAILED, asked: 2 });
    await expect(fitForChild(child, fake([{ text: says('x y z'), onDevice: false }]).ask)).rejects.toThrow('The fit did not run on the device. Stopped.');
  });
});

describe('what one child needs in a lesson', () => {
  const stages: FitStage[] = [
    { name: 'Starter', minutes: 5, summary: 'Show a picture of a market.' },
    { name: 'Practise', minutes: 15, summary: 'Pupils write a description in pairs.' },
    { name: 'Homework', summary: 'Pupils finish the description at home.' },
  ];
  const child = { childName: 'Meenal', childNote: 'Meenal reads well aloud but freezes in written tests. She has to leave school at the last bell.', stages };
  const points = (...list: [string, string][]) => JSON.stringify({ points: list.map(([stage, d]) => ({ stage, do: d })) });
  const rule = (p: FitPoint) => fitHits(p.text, { constraint: leave, studentName: 'Meenal' }).map((h) => h.matched);

  it('asks with a short instruction, the child, the notes and one line for each stage, and an answer of two points at most', () => {
    expect(FIT_LESSON_SYSTEM.length).toBeLessThan(620);
    expect(FIT_LESSON_SYSTEM).toContain('gives one sentence of at most 25 words');
    expect(FIT_LESSON_SYSTEM).toContain('If nothing in the notes matters for this lesson, give no points.');
    expect(fitLessonPrompt(child)).toBe(
      'Child: Meenal\nNotes about the child:\nMeenal reads well aloud but freezes in written tests. She has to leave school at the last bell.\nLesson plan:\nStarter (5 minutes): Show a picture of a market.\nPractise (15 minutes): Pupils write a description in pairs.\nHomework: Pupils finish the description at home.\nWhat should the teacher do differently for this child in this lesson?',
    );
    expect(fitLessonPrompt(child, ['after school'])).toMatch(/\nIt must not involve: after school$/);
    const schema = fitLessonSchema(stages) as { properties: { points: { maxItems: number; items: { properties: { stage: { enum: string[] }; do: { maxLength: number } } } } } };
    expect(schema.properties.points.maxItems).toBe(2);
    expect(schema.properties.points.items.properties.stage.enum).toEqual(['Starter', 'Practise', 'Homework']);
    expect(schema.properties.points.items.properties.do.maxLength).toBe(200);
  });

  it('reads points that name a stage of this lesson, and leaves out the empty, the repeated, the third and the unknown', () => {
    expect(readPoints(points(['practise', ' Give her   a writing frame. '], ['Homework', 'Let her say it aloud first.']), stages)).toEqual({
      points: [
        { itemIndex: 1, stage: 'Practise', text: 'Give her a writing frame.' },
        { itemIndex: 2, stage: 'Homework', text: 'Let her say it aloud first.' },
      ],
      unknown: 0,
    });
    expect(readPoints(points(['Plenary', 'Ask her first.'], ['Starter', '  '], ['Starter', 'Seat her at the front.'], ['Starter', 'seat her at the front.']), stages)).toEqual({
      points: [{ itemIndex: 0, stage: 'Starter', text: 'Seat her at the front.' }],
      unknown: 1,
    });
    expect(readPoints(points(['Starter', 'One.'], ['Practise', 'Two.'], ['Homework', 'Three.']), stages)!.points).toHaveLength(2);
    expect(readPoints(points(['Starter', `${'A short sentence. '.repeat(20)}`]), stages)!.points[0].text.length).toBeLessThanOrEqual(200);
    expect(
      readPoints(
        points(
          ['Starter', "Prompt Aarav to recall details from his family's situation."],
          ['Teach', "During the explanation, I'll subtly connect sensory details to describing familiar places, drawing on Aarav's involvement at the tea stall."],
          ['Practise', 'Provide extra paper from the class set.'],
        ),
        stages,
      ),
    ).toEqual({
      points: [{ itemIndex: 1, stage: 'Practise', text: 'Provide extra paper from the class set.' }],
      unknown: 0,
    });
    expect(readPoints(JSON.stringify({ points: [] }), stages)).toEqual({ points: [], unknown: 0 });
    for (const raw of ['', 'not json', '{"points":"none"}', 'null']) expect(readPoints(raw, stages), raw).toBeUndefined();
  });

  it('offers what the rules pass, with one request', async () => {
    const model = fake([points(['Practise', 'Give her a writing frame.'])]);
    expect(await fitLessonForChild(child, rule, model.ask)).toEqual({
      points: [{ itemIndex: 1, stage: 'Practise', text: 'Give her a writing frame.' }],
      droppedByRule: 0,
      unknownStage: 0,
      read: true,
      asked: 1,
    });
    expect(model.prompts).toHaveLength(1);
  });

  it('gives no points when the model says the lesson suits the child', async () => {
    expect(await fitLessonForChild(child, rule, fake([points()]).ask)).toMatchObject({ points: [], read: true, asked: 1, droppedByRule: 0 });
  });

  it('asks once more when a rule fires, names the matched words, and keeps the good point of the first answer', async () => {
    const model = fake([points(['Practise', 'Give her a writing frame.'], ['Homework', 'Let her finish it after school with you.']), points(['Homework', 'Let her finish it at lunch.'])]);
    const got = await fitLessonForChild(child, rule, model.ask);
    expect(got.points.map((p) => p.text)).toEqual(['Give her a writing frame.', 'Let her finish it at lunch.']);
    expect(got).toMatchObject({ droppedByRule: 0, asked: 2 });
    expect(model.prompts[1]).toMatch(/It must not involve: after school$/);
  });

  it('drops a point a rule still fires on after the second request, and counts it', async () => {
    const twice = fake([points(['Homework', 'Keep her after school.']), points(['Homework', 'She stays back to finish.'])]);
    expect(await fitLessonForChild(child, rule, twice.ask)).toMatchObject({ points: [], droppedByRule: 1, read: true, asked: 2 });
    const silent = fake([points(['Starter', 'Seat her at the front.'], ['Homework', 'Keep her after school.']), 'not json']);
    expect(await fitLessonForChild(child, rule, silent.ask)).toMatchObject({ points: [{ text: 'Seat her at the front.' }], droppedByRule: 1, asked: 2 });
  });

  it('says so when no answer can be read, and stops when an answer did not come from the device', async () => {
    expect(await fitLessonForChild(child, rule, fake(['not json']).ask)).toEqual({ points: [], droppedByRule: 0, unknownStage: 0, read: false, asked: 1 });
    await expect(fitLessonForChild(child, rule, fake([{ text: points(['Starter', 'Seat her at the front.']), onDevice: false }]).ask)).rejects.toThrow('did not run on the device');
  });

  it('makes no request without an on-device model', async () => {
    await expect(fitLessonForChild(child)).rejects.toThrow();
  });
});
