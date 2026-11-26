import type { DraftItem, Entity } from '../core/types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from '../core/samples';
import { buildVault, redactWithTokens, type Candidate } from '../core/vault';

/**
 * The second set for measuring the on-device check: the whole sample note,
 * and five fixed drafts in the form the cloud model writes them, one item
 * for each student, three steps to an item. Everything here is invented.
 *
 * The vault is built from fixed entries, as if the teacher had marked them:
 * the names on the class list and five private facts. So the check is
 * measured on the same facts every time, whatever the guard would find.
 */
export const FULL_FACTS: { text: string; about: string }[] = [
  { text: 'She told me she has epilepsy and is afraid of having a seizure in the exam hall', about: 'Meenal' },
  { text: 'walks six kilometres home', about: 'Meenal' },
  { text: 'has to leave school at the last bell to reach home before dark', about: 'Meenal' },
  {
    text: 'His mother Sunita told me on the phone (98765 43210) that his father lost his job at the mill and Aarav now helps at the family tea stall before school',
    about: 'Aarav',
  },
  { text: "Kabir's parents are separating and he is staying with his grandmother", about: 'Kabir' },
];

type Name = 'Aarav' | 'Meenal' | 'Kabir' | 'Ishaan' | 'Tanvi';

interface FullItem {
  student: Name;
  expected: 'conflict' | 'compatible';
  /** For a conflict: the step that conflicts, and the fact it runs against. */
  because?: string;
  text: string;
}

/** Five drafts. In each, one or two items have a step that a withheld fact plainly rules out; the rest are harmless. */
const DRAFTS: FullItem[][] = [
  [
    {
      student: 'Aarav',
      expected: 'compatible',
      text: 'First, give him five minutes at the start of the maths period to copy down the homework. Second, let him hand in one piece of homework at a time. Third, praise his mental arithmetic in front of a friend.',
    },
    {
      student: 'Meenal',
      expected: 'conflict',
      because: 'The second step keeps her after the last bell; she has to leave school at the last bell.',
      text: 'First, give her ten minutes of written practice at the start of the English period. Second, send her to the remedial writing club after the last bell twice a week. Third, praise one piece of her written work each week.',
    },
    {
      student: 'Kabir',
      expected: 'compatible',
      text: 'First, seat him at a different table from his usual partner for two weeks. Second, give him a clear job in each task, such as timekeeper. Third, notice and name one calm lesson each day.',
    },
    {
      student: 'Ishaan',
      expected: 'compatible',
      text: 'First, keep an extension task ready for when he finishes. Second, ask him to check his own work against a list before handing it in. Third, let him choose a puzzle book for the last five minutes.',
    },
    {
      student: 'Tanvi',
      expected: 'compatible',
      text: 'First, give her a harder book from the shelf. Second, ask her to read with one friend she trusts. Third, let her write a short review of each book she finishes.',
    },
  ],
  [
    {
      student: 'Aarav',
      expected: 'conflict',
      because: 'The first step asks him to be at school before the first bell; he helps at the family tea stall before school.',
      text: 'First, ask him to come to school thirty minutes before the first bell each day to finish his homework. Second, check his homework diary at the end of the maths period. Third, give him one harder maths problem to try each week.',
    },
    {
      student: 'Meenal',
      expected: 'conflict',
      because: 'The second step keeps her after the last bell; she has to leave school at the last bell.',
      text: 'First, let her answer one test question aloud before she writes it. Second, keep her for thirty minutes after the last bell on Mondays for written practice. Third, mark her written work with one comment only.',
    },
    {
      student: 'Kabir',
      expected: 'compatible',
      text: 'First, agree a quiet signal he can use when he feels cross. Second, give him the job of handing out the books. Third, speak with him for two minutes at break on Fridays.',
    },
    {
      student: 'Ishaan',
      expected: 'compatible',
      text: 'First, give him a second, harder worksheet when he finishes. Second, ask him to write one question of his own on each topic. Third, change his seat to the front row for a fortnight.',
    },
    {
      student: 'Tanvi',
      expected: 'compatible',
      text: 'First, lend her a book one level up. Second, ask her to mark the hard words in pencil as she reads. Third, talk with her about the book for two minutes on Wednesdays.',
    },
  ],
  [
    {
      student: 'Aarav',
      expected: 'compatible',
      text: 'First, write his homework on a slip he can keep in his pocket. Second, set him a shorter homework this fortnight. Third, mark his maths first so he hears quickly that it is right.',
    },
    {
      student: 'Meenal',
      expected: 'compatible',
      text: 'First, give her a sentence starter for each written answer. Second, let her plan her writing aloud with you for one minute. Third, show her one of her own good sentences each week.',
    },
    {
      student: 'Kabir',
      expected: 'conflict',
      because: 'The second step needs his mother and father together at home with him; his parents are separating and he is staying with his grandmother.',
      text: 'First, give him a fixed place at the front table. Second, telephone his mother and father at their home this evening and ask them both to sit with him tonight while he does his homework. Third, praise him the first time he works calmly beside his partner.',
    },
    {
      student: 'Ishaan',
      expected: 'compatible',
      text: 'First, give him a reading book to open when his work is done. Second, ask him to explain one answer in writing. Third, give him a harder task on Thursdays.',
    },
    {
      student: 'Tanvi',
      expected: 'compatible',
      text: 'First, let her pick her own reading book. Second, ask her one question about it in private. Third, invite her to read one page aloud to you alone.',
    },
  ],
  [
    {
      student: 'Aarav',
      expected: 'compatible',
      text: 'First, let him do the first homework question in the lesson. Second, keep a spare pencil and notebook for him in your desk. Third, tell him each Friday what he did well in maths.',
    },
    {
      student: 'Meenal',
      expected: 'conflict',
      because: 'The second step keeps her at school until half past six; she has to leave at the last bell to reach home before dark.',
      text: 'First, give her extra time for written answers in lessons. Second, ask her to stay for the evening study hour at school until half past six on Tuesdays. Third, let her write test answers in pencil first.',
    },
    {
      student: 'Kabir',
      expected: 'compatible',
      text: 'First, give him a turn as the one who reads the task aloud. Second, keep the tasks short, ten minutes each. Third, tell him at the door one thing that went well.',
    },
    {
      student: 'Ishaan',
      expected: 'compatible',
      text: 'First, set him a challenge card at the start of each lesson. Second, let him mark his own work with the answer sheet. Third, give him a notebook for his own maths puzzles.',
    },
    {
      student: 'Tanvi',
      expected: 'compatible',
      text: 'First, keep a list of the books she has read. Second, suggest one new author each month. Third, let her sit by the window to read when her work is done.',
    },
  ],
  [
    {
      student: 'Aarav',
      expected: 'conflict',
      because: 'The third step has him at school forty minutes before it starts every day; he helps at the family tea stall before school.',
      text: 'First, seat him near the board in maths. Second, give him two homework questions where others have four. Third, give him the duty of unlocking the room forty minutes before school starts every morning.',
    },
    {
      student: 'Meenal',
      expected: 'conflict',
      because: 'The second step sends her into town after the last bell; she has to leave at the last bell and walks six kilometres home.',
      text: 'First, give her a word bank for each piece of writing. Second, have her walk to the town library after the last bell on Thursdays and work there until five. Third, read her written work back to her once a week.',
    },
    {
      student: 'Kabir',
      expected: 'compatible',
      text: 'First, choose his partner for him this fortnight. Second, give him a card that lists the steps of the task. Third, let him help you tidy the book corner at break.',
    },
    {
      student: 'Ishaan',
      expected: 'compatible',
      text: 'First, give him the next chapter to start when he is done. Second, ask him to write two sentences on what he found easy. Third, let him set one quiz question for you.',
    },
    {
      student: 'Tanvi',
      expected: 'compatible',
      text: 'First, give her a quiet corner for reading. Second, ask her to keep a small reading diary. Third, tell her privately when she has done well.',
    },
  ],
];

/** One item of one draft, ready for the check, with what the check ought to say. */
export interface FullCase {
  id: string;
  expected: 'conflict' | 'compatible';
  student: Name;
  because?: string;
  item: DraftItem;
}

export interface FullSet {
  note: string;
  entities: Entity[];
  tokens: string[];
  cases: FullCase[];
}

/** The sample note, the fixed vault and the twenty-five items, built the way the app builds them. */
export function prepareFull(): FullSet {
  const candidates: Candidate[] = [
    ...SAMPLE_CLASS_LIST.map((name) => ({ kind: 'student' as const, text: name, source: 'class list' as const })),
    ...FULL_FACTS.map((f) => ({ kind: 'private' as const, text: f.text, source: 'teacher' as const, aboutName: f.about })),
  ];
  const entities = buildVault(SAMPLE_NOTE, candidates);
  const tokens = redactWithTokens(SAMPLE_NOTE, entities).tokens;
  const tokenOf = (name: Name) => entities.find((e) => e.kind === 'student' && e.surfaces.includes(name))!.token;
  const cases = DRAFTS.flatMap((draft, d) =>
    draft.map((it) => ({
      id: `draft-${d + 1}-${it.student.toLowerCase()}`,
      expected: it.expected,
      student: it.student,
      because: it.because,
      // The heading is the child's stand-in, as the drafting model is told to write it.
      item: { heading: tokenOf(it.student), text: it.text },
    })),
  );
  return { note: SAMPLE_NOTE, entities, tokens, cases };
}
