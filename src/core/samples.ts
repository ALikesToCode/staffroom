import type { Task } from './types';

/**
 * Invented sample data. No real teacher, student, family, school or phone
 * number appears here.
 */
export const SAMPLE_CLASS_LIST = [
  'Aarav Sharma',
  'Diya Sharma',
  'Meenal Joshi',
  'Kabir Qureshi',
  'Tanvi Rao',
  'Ishaan Verma',
];

export const SAMPLE_NOTE = `Class 6B, week of 16 November. Notes for myself.

Aarav Sharma has missed four days this month. His mother Sunita told me on the phone (98765 43210) that his father lost his job at the mill and Aarav now helps at the family tea stall before school. He is bright in maths but has not handed in homework for two weeks.

Meenal reads well aloud but freezes in written tests. She told me she has epilepsy and is afraid of having a seizure in the exam hall. Her roll no. 6B/23. She walks six kilometres home to Rampur Kalan and must leave before dark.

Kabir and Ishaan fight most days during group work. Kabir's parents are separating and he is staying with his grandmother. Ishaan finishes early and gets bored.

Tanvi is far ahead in reading. She could help others, but she is shy.`;

export const TASKS: Task[] = [
  {
    id: 'plan',
    label: 'Support plan for next week',
    blurb: 'Concrete steps for each child, for the coming week.',
    instruction:
      'Write a support plan for next week. Give one item per student mentioned, plus one item for the whole class if useful. Each item names the student by their stand-in and gives two or three concrete steps a teacher can take in an ordinary classroom with no extra budget.',
  },
  {
    id: 'parents',
    label: 'Notes to parents',
    blurb: 'A short, kind note home for each child.',
    instruction:
      'Draft a short note home for each student mentioned, one item per student. Each note is three or four sentences, warm and specific, says one thing the child does well and one thing to work on together, and asks for one small action at home. Do not mention any other student in a note.',
  },
  {
    id: 'handover',
    label: 'Hand-over for a substitute',
    blurb: 'What a covering teacher needs to know on day one.',
    instruction:
      'Write a hand-over for a substitute teacher who takes this class tomorrow. Give one item per student who needs attention and one item on how the class works as a group. Keep each item to what the substitute must do or avoid.',
  },
];
