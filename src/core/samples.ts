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

/** The note as the fixed evaluation sets and the older tests read it. The app's sample adds one sentence to it. */
export const SAMPLE_NOTE_BASE = `Class 6B, week of 16 November. Notes for myself.

Aarav Sharma has missed four days this month. His mother Sunita told me on the phone (98765 43210) that his father lost his job at the mill and the family cannot pay for anything extra this term; Aarav now helps at the family tea stall before school. He is bright in maths but has not handed in homework for two weeks.

Meenal reads well aloud but freezes in written tests. She needs extra writing practice, and the remedial writing club meets after the last bell. She told me she has epilepsy and is afraid of having a seizure in the exam hall. Her roll no. 6B/23. She walks six kilometres home to Rampur Kalan and has to leave school at the last bell to reach home before dark.

Kabir and Ishaan fight most days during group work. Kabir's parents are separating and he is staying with his grandmother. Ishaan finishes early and gets bored.

Tanvi is far ahead in reading. She could help others, but she is shy.`;

/** The sample note of the app: the base note and one more invented fact, so that ordinary homework meets a constraint. */
export const SAMPLE_NOTE = `${SAMPLE_NOTE_BASE} Her family does not have a smartphone or an internet connection.`;

/** The lesson the invented class is planned: nothing in it is private. */
export const SAMPLE_LESSON = { klass: 'Class 6', subject: 'English', topic: 'Writing a short description of a place', minutes: 40, lastTime: '' };

export const TASKS: Task[] = [
  {
    id: 'lesson',
    label: "Tomorrow's lesson",
    blurb: 'A lesson for the whole class, fitted to each child on this device.',
    instruction:
      'Plan one lesson for the whole class, from the lines under "Lesson" at the end of the notes: the class, the subject, the topic and the length. Give four to six items, one for each stage of the lesson in order: Starter, Teach, Practise, Check, Homework. The heading of each item is the stage and its minutes, as in "Starter (5 minutes)"; the minutes add up to the length of the lesson, and homework takes none of them. The text of each item says what the teacher does, what the pupils do and the materials needed, in two to four sentences. Write for the whole class. Name a student by their stand-in only where the notes say that student needs something. If the lines say what was done last time, build on what was done and return to what was not.',
  },
  {
    id: 'plan',
    label: 'Support plan for next week',
    blurb: 'Concrete steps for each child, for the coming week.',
    instruction:
      'Write a support plan for next week. Give one item per student mentioned, plus one item for the whole class if useful. Each item names the student by their stand-in and gives two or three concrete steps a teacher can take in an ordinary classroom with no extra budget.',
  },
  {
    id: 'parents',
    label: 'Messages to parents',
    blurb: 'A short, kind message home for each child.',
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
