import { beforeEach, describe, expect, it } from 'vitest';
import type { Constraint, DraftItem } from './types';
import { SAMPLE_CLASS_LIST, SAMPLE_LESSON, SAMPLE_NOTE, SAMPLE_NOTE_BASE, TASKS } from './samples';
import { buildVault, deterministicCandidates, possibleNameCandidates } from './vault';
import { confirmConstraint, lockConstraints, proposeConstraints } from './constraints';
import { outgoingOf } from './needs';
import { ruleCheckItem, ruleConflicts, ruleHitsForItem } from './conflicts';
import {
  acceptable,
  acceptedAdjustments,
  adjustmentHits,
  adjustmentProblem,
  lessonCounts,
  savedLesson,
  unsettled,
  type Adjustments,
  classPlanText,
  lastTimeSummary,
  lessonBlock,
  lessonHits,
  lessonIssues,
  lessonMinutes,
  lessonReady,
  loadLessons,
  needsFitting,
  continueTopic,
  nextLessonFields,
  stageName,
  starterFor,
  storeLessons,
  withLesson,
  type SavedLesson,
} from './lesson';
import { byChild } from './points';

const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
let held = { entities: vault, constraints: proposeConstraints(SAMPLE_NOTE, vault) };
for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
const constraints = held.constraints;
const entities = lockConstraints(held.entities, constraints);
const going = outgoingOf(SAMPLE_NOTE, entities, constraints);
const tok = (name: string) => entities.find((e) => e.kind === 'student' && e.surfaces.includes(name))!.token;
const of = (kind: Constraint['kind']) => constraints.find((c) => c.kind === kind)!;

const plan: DraftItem[] = [
  { heading: 'Starter (5 minutes)', text: 'Show a picture of a market and ask pupils to name five things they see. Pupils call out words; write them on the board.' },
  { heading: 'Teach (10 minutes)', text: 'Model a four-sentence description of the school gate on the board. Pupils copy the sentence starters into their notebooks.' },
  { heading: 'Practise (15 minutes)', text: 'Pupils write a description of a place they know, in pairs. Each pair needs chart paper; ask pupils to buy a sheet for tomorrow.' },
  { heading: 'Check (10 minutes)', text: 'Three pairs read their description aloud. The class says which words helped them see the place.' },
  { heading: 'Homework', text: `Pupils find two pictures of a place online and write three sentences about one. Anyone still writing stays after school on Thursday to complete it. ${tok('Meenal')} may write hers in class.` },
];

describe('the sample class and its lesson', () => {
  it('is the first task, and its instruction asks for the stages of one lesson', () => {
    expect(TASKS[0].id).toBe('lesson');
    expect(TASKS[0].label).toBe("Tomorrow's lesson");
    expect(TASKS[0].instruction).toMatch(/Starter, Teach, Practise, Check, Homework/);
    expect(TASKS[0].instruction).toMatch(/build on what was done and return to what was not/);
    expect(TASKS.map((t) => t.id)).toEqual(['lesson', 'plan', 'parents', 'handover']);
  });

  it('has one more invented fact than the base note: a child with no phone or internet at home', () => {
    expect(SAMPLE_NOTE.startsWith(SAMPLE_NOTE_BASE)).toBe(true);
    const tanvi = entities.find((e) => e.surfaces.includes('Tanvi'))!;
    expect(constraints.map((c) => c.kind).sort()).toEqual(['contact', 'health', 'money', 'no-phone-internet', 'time-after', 'time-before']);
    expect(of('no-phone-internet')).toMatchObject({ about: tanvi.id, text: 'does not have a smartphone or an internet connection' });
    expect(going.violations).toEqual([]);
    expect(going.text).not.toMatch(/smartphone|internet/);
  });
});

describe('the lines about the lesson', () => {
  it('are sent under a heading, as written, and only the ones that are filled', () => {
    expect(lessonBlock(SAMPLE_LESSON)).toBe('Lesson\nClass: Class 6\nSubject: English\nTopic: Writing a short description of a place\nLength: 40 minutes');
    expect(lessonBlock({ ...SAMPLE_LESSON, klass: ' ', lastTime: ' Starter:  done. ' })).toBe(
      'Lesson\nSubject: English\nTopic: Writing a short description of a place\nLength: 40 minutes\nWhat we did last time: Starter: done.',
    );
    expect(withLesson('Notes.\n', SAMPLE_LESSON)).toBe(`Notes.\n\n${lessonBlock(SAMPLE_LESSON)}`);
    expect(lessonMinutes(35.4)).toBe(35);
    expect(lessonMinutes(0)).toBe(40);
    expect(lessonMinutes('x')).toBe(40);
    expect(lessonReady(SAMPLE_LESSON)).toBe(true);
    expect(lessonReady({ ...SAMPLE_LESSON, topic: '  ' })).toBe(false);
  });

  it('pass with nothing private in them', () => {
    expect(lessonIssues(SAMPLE_LESSON, entities, SAMPLE_CLASS_LIST)).toEqual([]);
    expect(lessonIssues({ ...SAMPLE_LESSON, subject: 'Science', topic: 'Health and disease' }, entities, SAMPLE_CLASS_LIST)).toEqual([]);
  });

  it('are stopped by a name, a number, a withheld detail, a stand-in, or a sensitive word in the line about last time', () => {
    const what = (f: Partial<typeof SAMPLE_LESSON>) => lessonIssues({ ...SAMPLE_LESSON, ...f }, entities, SAMPLE_CLASS_LIST).map((v) => v.what);
    expect(what({ topic: 'A letter to Meenal' })).toEqual(['Meenal']);
    // A name on the class list is caught though the note does not have it.
    expect(what({ topic: 'Diya describes her village' })).toEqual(['Diya']);
    expect(what({ topic: 'Sunita and Rampur Kalan' })).toEqual(['Sunita', 'Rampur Kalan']);
    expect(what({ klass: 'Class 6, ring 98765 43210' })).toEqual(['98765 43210']);
    expect(what({ lastTime: 'Starter: done. One girl had a seizure in the exam hall.' })).toHaveLength(1);
    expect(what({ topic: 'For [Student 2]' })).toEqual(['[Student 2]']);
    expect(what({ topic: 'For Student 2' })).toEqual(['Student 2']);
  });
});

describe('a step for the class against every child', () => {
  const told = new Map<string, string>();
  const hits = lessonHits(plan, constraints, entities, going.tokens, SAMPLE_NOTE, told);

  it('reports every step, child and constraint, not only the first', () => {
    expect(hits.map((h) => [h.itemIndex, h.stepIndex, h.child, h.matched])).toEqual([
      [2, 1, 'Aarav Sharma', 'buy'],
      [4, 0, 'Tanvi', 'online'],
      [4, 1, 'Meenal', 'after school'],
    ]);
    expect(hits[0].key).toBe(`2:1:${of('money').id}`);
    expect(hits[0].line).toBe(
      'Aarav Sharma: This step asks the family of Aarav Sharma to pay for something (“buy”). You confirmed: “cannot pay for anything extra this term”. The cloud was not told this.',
    );
    // The single-hit check, as the other tasks use it, sees only the first.
    expect(ruleHitsForItem(plan[4], constraints, entities, going.tokens, SAMPLE_NOTE)).toHaveLength(2);
  });

  it('compares a stage with every child though it names one', () => {
    // The homework names Meenal. As a step of a lesson it is still compared with Tanvi's constraint.
    expect(ruleCheckItem(plan[4], constraints, entities, going.tokens, SAMPLE_NOTE, told).compared).toBe(2);
    expect(ruleCheckItem(plan[4], constraints, entities, going.tokens, SAMPLE_NOTE, told, true).compared).toBe(6);
  });

  it('says how many steps need fitting, for how many children, in the order of the lesson', () => {
    expect(needsFitting(hits.filter((h) => h.itemIndex === 4))).toBe('Needs fitting for 2 children');
    expect(needsFitting(hits.slice(0, 1))).toBe('Needs fitting for 1 child');
  });

  it('says so when the cloud was told the need', () => {
    const money = of('money');
    const withTold = lessonHits(plan, constraints, entities, going.tokens, SAMPLE_NOTE, new Map([[money.id, 'x']]));
    expect(withTold[0].line).toMatch(/The cloud was told this need and the step still goes against it\.$/);
  });
});

describe('an adjustment for one child', () => {
  it('has a starter for every kind with a rule, and none for the rest', () => {
    expect(starterFor({ kind: 'time-after' })).toBe('Does this during the lesson or the lunch break instead.');
    expect(starterFor({ kind: 'money' })).toBe('Uses materials from the class set; no need to buy or bring anything.');
    expect(starterFor({ kind: 'no-phone-internet' })).toBe('Gets a printed copy or does it from the textbook; no phone or internet needed.');
    expect(starterFor({ kind: 'time-before' })).toBe('Does this in class time, not before school.');
    expect(starterFor({ kind: 'days-away' })).toBe('Gets this on the day back.');
    expect(starterFor({ kind: 'contact', guardian: 'grandmother' })).toBe('Send word through the grandmother.');
    expect(starterFor({ kind: 'contact' })).toBe('Send word through the listed guardian.');
    expect(starterFor({ kind: 'health' })).toBe("Check this step with the child's care plan before the lesson.");
    expect(starterFor({ kind: 'other' })).toBeUndefined();
  });

  it('is read by rule against that child before it is offered: every starter passes its own constraint', () => {
    for (const c of constraints) {
      const starter = starterFor(c)!;
      expect(adjustmentHits(starter, c, constraints, SAMPLE_NOTE), c.kind).toEqual([]);
      expect(ruleConflicts(starter, c), c.kind).toBeUndefined();
    }
  });

  it('is refused when it goes against that constraint or another one about the same child', () => {
    expect(adjustmentHits('Stays after school on Friday instead.', of('time-after'), constraints, SAMPLE_NOTE).map((h) => h.matched)).toEqual(['after school']);
    // Aarav has two: he cannot pay, and he is at the tea stall before school.
    expect(adjustmentHits('Comes before school to use the class set.', of('money'), constraints, SAMPLE_NOTE).map((h) => h.matched)).toEqual(['before school']);
    // Another child's constraint does not count.
    expect(adjustmentHits('Comes before school to finish it.', of('time-after'), constraints, SAMPLE_NOTE)).toEqual([]);
  });
});

describe('a signed lesson, kept on this device', () => {
  const lesson: SavedLesson = {
    id: 'l1',
    savedAt: '2026-11-26T10:00:00.000Z',
    fields: SAMPLE_LESSON,
    title: 'Describing a place',
    stages: plan,
    adjustments: [{ itemIndex: 2, constraintId: of('money').id, child: 'Aarav', text: 'Uses chart paper from the class set.', source: 'teacher' }],
    constraintIds: constraints.map((c) => c.id),
  };
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('is stored and read back, thirty at most, and anything not in form is left out', () => {
    expect(loadLessons()).toEqual([]);
    expect(storeLessons(Array.from({ length: 34 }, (_, i) => ({ ...lesson, id: `l${i}` })))).toBe(true);
    expect(loadLessons()).toHaveLength(30);
    expect(loadLessons()[0]).toEqual({ ...lesson, id: 'l0' });
    store.set('staffroom.lessons.v1', JSON.stringify([lesson, { id: 'x' }, null]));
    expect(loadLessons()).toEqual([lesson]);
    store.set('staffroom.lessons.v1', 'not json');
    expect(loadLessons()).toEqual([]);
    storeLessons([]);
    expect(store.size).toBe(0);
  });

  it('gives the next lesson what was done last time, with no adjustment and no name in it', () => {
    expect(stageName('Starter (5 minutes)')).toBe('Starter');
    expect(stageName('Teach - 10 min')).toBe('Teach');
    expect(stageName('Homework')).toBe('Homework');
    expect(lastTimeSummary(lesson)).toBe('Topic: Writing a short description of a place.');
    const taught = { ...lesson, after: { stages: ['done', 'done', 'partly', 'not', null] as const, line: ' Ran out of time  in the pair work. ', at: 'x' } };
    const summary = lastTimeSummary({ ...taught, after: { ...taught.after, stages: [...taught.after.stages] } });
    expect(summary).toBe(
      "Topic: Writing a short description of a place. Starter: done; Teach: done; Practise: partly; Check: not done. Teacher's note: Ran out of time in the pair work.",
    );
    expect(summary).not.toMatch(/Aarav|class set|Student/);
    const next = nextLessonFields({ ...taught, after: { ...taught.after, stages: [...taught.after.stages] } });
    expect(next).toEqual({ klass: 'Class 6', subject: 'English', topic: `Continue: ${taught.fields.topic}`, minutes: 40, lastTime: summary });
    // Said once, however many lessons the topic runs to, and never longer than a lesson line.
    expect(continueTopic('Continue: continue: Fractions')).toBe('Continue: Fractions');
    expect(continueTopic('  ')).toBe('');
    expect(continueTopic('x'.repeat(200))).toHaveLength(120);
    expect(lessonReady(next)).toBe(true);
    // It is checked like every lesson line: a name typed into the teacher's line stops the send.
    const named = nextLessonFields({ ...lesson, after: { stages: [], line: 'Meenal left early.', at: 'x' } });
    expect(lessonIssues({ ...named, topic: 'More describing' }, entities, SAMPLE_CLASS_LIST).map((v) => v.what)).toEqual(['Meenal']);
  });

  it('gives the class plan as text with stand-ins as they came: no name and no adjustment', () => {
    const text = classPlanText({ title: lesson.title, items: plan });
    expect(text.startsWith('Describing a place\n\nStarter (5 minutes)\nShow a picture')).toBe(true);
    expect(text).toContain(tok('Meenal'));
    expect(text).not.toMatch(/Meenal|Aarav|class set/);
  });
});

describe('adjustments on the result screen', () => {
  const hits = lessonHits(plan, constraints, entities, going.tokens, SAMPLE_NOTE);
  const [aarav, tanvi, meenal] = hits;
  const adj: Adjustments = {
    [aarav.key]: { text: 'Uses chart paper from the class set.', source: 'starter', state: 'accepted' },
    [tanvi.key]: { text: 'Gets two printed pictures to write from.', source: 'model', state: 'offered', seen: true },
  };

  it('holds sign-off until every hit is accepted or left', () => {
    expect(unsettled(hits, adj).map((h) => h.child)).toEqual(['Tanvi', 'Meenal']);
    const done: Adjustments = { ...adj, [tanvi.key]: { ...adj[tanvi.key], state: 'accepted' }, [meenal.key]: { text: '', source: 'teacher', state: 'left' } };
    expect(unsettled(hits, done)).toEqual([]);
    expect(lessonCounts(hits, done)).toEqual({ stepsNeedingFit: 2, adjustmentsAccepted: 2, adjustmentsByModel: 1 });
    expect(acceptedAdjustments(hits, done).map((a) => [a.itemIndex, a.child, a.source])).toEqual([[2, 'Aarav Sharma', 'starter'], [4, 'Tanvi', 'model']]);
  });

  it('lets "Accept all" take only offers that have been shown', () => {
    expect(acceptable(hits, adj)).toEqual({ keys: [tanvi.key], allSeen: true });
    const unseen: Adjustments = { ...adj, [meenal.key]: { text: 'Finishes at lunch.', source: 'model', state: 'offered' } };
    expect(acceptable(hits, unseen)).toEqual({ keys: [tanvi.key], allSeen: false });
  });

  it('refuses a typed adjustment that is empty, too long, or still against that child', () => {
    expect(adjustmentProblem('  ', of('time-after'), constraints, SAMPLE_NOTE)).toBe('Write what this child does instead.');
    expect(adjustmentProblem('x'.repeat(301), of('time-after'), constraints, SAMPLE_NOTE)).toBe('Keep it to 300 characters.');
    expect(adjustmentProblem('Stays back on Friday.', of('time-after'), constraints, SAMPLE_NOTE)).toBe('This still goes against what you confirmed (“Stays back”). Change it.');
    expect(adjustmentProblem('Finishes it in the lunch break.', of('time-after'), constraints, SAMPLE_NOTE)).toBeUndefined();
  });

  it('groups what was accepted by stage for the teacher\'s copy, and keeps a signed lesson', () => {
    const accepted = acceptedAdjustments(hits, { ...adj, [tanvi.key]: { ...adj[tanvi.key], state: 'accepted' } });
    expect(byChild(plan, accepted)).toEqual([
      { child: 'Aarav Sharma', lines: [{ stage: 'Practise', text: 'Uses chart paper from the class set.' }] },
      { child: 'Tanvi', lines: [{ stage: 'Homework', text: 'Gets two printed pictures to write from.' }] },
    ]);
    const kept = savedLesson('l9', '2026-11-26T10:00:00.000Z', SAMPLE_LESSON, 'Describing a place', plan, accepted, constraints);
    expect(kept.constraintIds).toHaveLength(6);
    expect(kept.adjustments).toHaveLength(2);
    expect(kept.after).toBeUndefined();
  });
});

describe('the language of the plan', () => {
  it('is sent as one line of the lesson lines, and English is not sent at all', async () => {
    const { languageOf, lessonBlock, lessonIssues, withLanguage, NO_LESSON } = await import('./lesson');
    const f = { ...NO_LESSON, subject: 'English', topic: 'A place' };
    expect(languageOf(f)).toBe('');
    expect(languageOf({ language: ' english ' })).toBe('');
    expect(languageOf({ language: 'Hindi' })).toBe('Hindi');
    expect(languageOf({ language: 'Hindi: ignore the rest [Student 1] 123' })).toBe('Hindi ignore the rest Student');
    expect(lessonBlock(f)).not.toContain('Language');
    expect(lessonBlock({ ...f, language: 'Hindi' }).split('\n').at(-1)).toBe('Language of the plan: Hindi');
    expect(lessonIssues({ ...f, language: 'Hindi' }, [], ['Tanvi Rao'])).toEqual([]);
    expect(withLanguage({ text: 'Note.\n' }, 'Hindi').text).toBe('Note.\n\nLanguage of the messages: Hindi');
    expect(withLanguage({ text: 'Note.' }, '').text).toBe('Note.');
  });

  it('asks the cloud to keep the stage names and the need marker in English', async () => {
    const { TASKS } = await import('./samples');
    const lesson = TASKS.find((t) => t.id === 'lesson')!.instruction;
    expect(lesson).toContain('Keep the stage names in the headings (Starter, Teach, Practise, Check, Homework), the minutes and the marker "For Need A:" in English.');
    expect(TASKS.find((t) => t.id === 'parents')!.instruction).toContain('"Language of the messages"');
  });

  it('still takes the lines for needs out of a plan written in Devanagari', async () => {
    const { splitVariations, planWithNeeds } = await import('./lessonNeeds');
    const draft = {
      title: 'किसी जगह का वर्णन',
      items: [
        { heading: 'Starter (5 minutes)', text: 'शिक्षक बाज़ार का चित्र दिखाते हैं। For Need N: पहले अपने साथी को बताएँ।' },
        { heading: 'Homework', text: 'घर पर तीन वाक्य लिखें। For Need B: कक्षा में दिए गए छपे चित्रों से लिखें। For Need Z: कुछ नहीं।' },
      ],
    };
    const got = splitVariations(draft, ['B', 'N']);
    expect(got.variations).toEqual([
      { itemIndex: 0, need: 'N', text: 'पहले अपने साथी को बताएँ।' },
      { itemIndex: 1, need: 'B', text: 'कक्षा में दिए गए छपे चित्रों से लिखें।' },
    ]);
    expect(got.dropped).toBe(1);
    expect(got.draft.items[0].text).toBe('शिक्षक बाज़ार का चित्र दिखाते हैं।');
    expect(planWithNeeds(got.draft, got.variations)).toContain('For Need B: कक्षा में दिए गए छपे चित्रों से लिखें।');
  });
});
