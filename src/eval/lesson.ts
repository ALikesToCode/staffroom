import type { DraftItem } from '../core/types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from '../core/samples';
import { confirmConstraint, lockConstraints, proposeConstraints } from '../core/constraints';
import { lessonHits } from '../core/lesson';
import { outgoingOf } from '../core/needs';
import { buildVault, deterministicCandidates, possibleNameCandidates } from '../core/vault';

/**
 * A set for measuring the rule layer on whole lessons: five lesson plans,
 * written by hand as the cloud returns them, in five subjects, read
 * against the constraints the rules propose from the sample note (all
 * confirmed). For each plan the stages that do not suit a child are
 * labelled, with the child.
 *
 * Everything here is invented. The plans were written before the rules
 * were run on them. As first measured the rules caught 10 of the 13
 * labelled pairs, missed 3 and raised 1 false alarm. Four rules were then
 * changed after seeing those cases, so the set is no longer fresh for
 * them: it now shows that the fixes hold, not how the rules do on lessons
 * they have not seen. No model is involved, so it runs in any browser and
 * in the unit tests.
 */
export interface LessonCase {
  id: string;
  subject: string;
  stages: DraftItem[];
  /** The stages that do not suit a child: the stage (from 0) and the child's first name. */
  expected: [stage: number, child: string][];
}

const stage = (heading: string, text: string): DraftItem => ({ heading, text });

export const LESSON_CASES: LessonCase[] = [
  {
    id: 'english',
    subject: 'English',
    stages: [
      stage('Starter (5 minutes)', 'Show a picture of a busy market. Pupils call out five things they can see, hear or smell.'),
      stage('Teach (10 minutes)', 'Model a four-sentence description of the school gate on the board. Pupils copy the sentence starters.'),
      stage('Practise (15 minutes)', 'Pupils describe a place they know, in pairs. Each pair needs a sheet of chart paper; ask pupils to bring one from home tomorrow.'),
      stage('Check (10 minutes)', 'Three pairs read their description aloud. The class says which words helped them see the place.'),
      stage('Homework', 'Pupils find two pictures of a place online and write three sentences about one of them.'),
    ],
    expected: [
      [2, 'Aarav'],
      [4, 'Tanvi'],
    ],
  },
  {
    id: 'maths',
    subject: 'Mathematics',
    stages: [
      stage('Starter (5 minutes)', 'Quick recap of halves and quarters with paper strips. Pupils who want extra help can come ten minutes before school for a recap.'),
      stage('Teach (10 minutes)', 'Show equivalent fractions by folding a strip into two, four and eight parts. Pupils fold their own strips.'),
      stage('Practise (15 minutes)', 'Pupils shade equivalent fractions on squared paper from the class tray and compare with a partner.'),
      stage('Check (10 minutes)', 'Five questions on the board, marked in pairs. Anyone below three marks stays back after the last bell for a second try.'),
      stage('Homework', 'Pupils watch the fractions clip sent to the class WhatsApp group and note two examples from it.'),
    ],
    expected: [
      [0, 'Aarav'],
      [3, 'Meenal'],
      [4, 'Tanvi'],
    ],
  },
  {
    id: 'science',
    subject: 'Science',
    stages: [
      stage('Starter (5 minutes)', 'Ask where a shadow comes from. Pupils point to shadows in the room.'),
      stage('Teach (10 minutes)', 'Darken the room and switch a torch on and off quickly so the light flickers, to show how a shadow appears and goes.'),
      stage('Practise (15 minutes)', 'In groups, pupils move a torch and measure the shadow of a pencil. Each group buys a small torch and a sheet of black paper for this.'),
      stage('Check (10 minutes)', 'Each group draws one diagram of the torch, the pencil and the shadow. Groups compare diagrams.'),
      stage('Homework', 'Pupils ask their parents to help them trace a shadow at noon, and both parents sign the sheet.'),
    ],
    expected: [
      [1, 'Meenal'],
      [2, 'Aarav'],
      [4, 'Kabir'],
    ],
  },
  {
    id: 'social',
    subject: 'Social science',
    stages: [
      stage('Starter (5 minutes)', 'Pupils name three places everyone in the village knows. List them on the board.'),
      stage('Teach (10 minutes)', 'Draw a simple map of the school and the road outside it, with a key. Pupils copy the key.'),
      stage('Practise (15 minutes)', "Pupils look at a map of the district on the teacher's phone, passed round the room, and find the nearest town."),
      stage('Check (10 minutes)', 'A short quiz on the key. The quiz goes on after school on Friday for groups still working.'),
      stage('Homework', 'Pupils walk round their own street in the evening and sketch a map of it at home.'),
    ],
    expected: [[3, 'Meenal']],
  },
  {
    id: 'art',
    subject: 'Art',
    stages: [
      stage('Starter (5 minutes)', 'Pupils bring old magazines and coloured paper from home; those without can purchase a kit for twenty rupees.'),
      stage('Teach (10 minutes)', 'Show how to tear and layer paper to make a hill, a river and a sky. Pupils try one layer.'),
      stage('Practise (15 minutes)', 'Pupils make a collage of a place they like. They invite their mother or father to the display on Saturday.'),
      stage('Check (10 minutes)', 'Display day begins in the early morning, before the first bell: all pupils set up their work then.'),
      stage('Homework', 'Pupils send a photo of the finished collage to the teacher by phone.'),
    ],
    expected: [
      [0, 'Aarav'],
      [2, 'Kabir'],
      [3, 'Aarav'],
      [4, 'Tanvi'],
    ],
  },
];

export interface LessonRow {
  id: string;
  subject: string;
  stage: string;
  child: string;
  /** caught: labelled and found. missed: labelled and not found. false alarm: found and not labelled. */
  outcome: 'caught' | 'missed' | 'false alarm';
  matched: string;
}

export interface LessonTotals {
  lessons: number;
  stages: number;
  /** Labelled (stage, child) pairs. */
  expected: number;
  caught: number;
  missed: number;
  falseAlarms: number;
}

/** The sample class as the app holds it at approval: the vault by rule, every proposed constraint confirmed. */
export function sampleClass() {
  const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
  let held = { entities: vault, constraints: proposeConstraints(SAMPLE_NOTE, vault) };
  for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
  const entities = lockConstraints(held.entities, held.constraints);
  return { note: SAMPLE_NOTE, entities, constraints: held.constraints, tokens: outgoingOf(SAMPLE_NOTE, entities, held.constraints).tokens };
}

/** Run the rules over the five lessons. A (stage, child) pair is counted once, however many constraints or steps found it. */
export function runLessonSet(): { rows: LessonRow[]; totals: LessonTotals } {
  const { note, entities, constraints, tokens } = sampleClass();
  const rows: LessonRow[] = [];
  for (const c of LESSON_CASES) {
    const found = new Map<string, string>();
    for (const h of lessonHits(c.stages, constraints, entities, tokens, note)) {
      const key = `${h.itemIndex}:${h.child.split(' ')[0]}`;
      if (!found.has(key)) found.set(key, h.matched);
    }
    const wanted = new Set(c.expected.map(([i, child]) => `${i}:${child}`));
    for (const key of new Set([...wanted, ...found.keys()])) {
      const [i, child] = key.split(':');
      rows.push({
        id: c.id,
        subject: c.subject,
        stage: c.stages[Number(i)].heading,
        child,
        outcome: wanted.has(key) ? (found.has(key) ? 'caught' : 'missed') : 'false alarm',
        matched: found.get(key) ?? '',
      });
    }
  }
  const n = (o: LessonRow['outcome']) => rows.filter((r) => r.outcome === o).length;
  return {
    rows,
    totals: {
      lessons: LESSON_CASES.length,
      stages: LESSON_CASES.reduce((sum, c) => sum + c.stages.length, 0),
      expected: LESSON_CASES.reduce((sum, c) => sum + c.expected.length, 0),
      caught: n('caught'),
      missed: n('missed'),
      falseAlarms: n('false alarm'),
    },
  };
}
