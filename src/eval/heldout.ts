import type { EvalCase } from './cases';

/**
 * A held-out set for the on-device model (Layer B): sixteen single-fact
 * cases, eight where the advice cannot be followed given the fact and
 * eight where it can. Every child and fact is invented, and none is in the
 * 24 cases or the sample note.
 *
 * These were written without running the model on them, and nothing in the
 * check was changed with them in view. They are to be run once.
 */
const PAIRS: [EvalCase['topic'], string, string, string, string, string][] = [
  [
    'time',
    'Pooja',
    'Pooja knows a great deal and answers fast.',
    'She looks after her two small brothers from four in the afternoon, when her mother leaves for the night shift',
    'Enter [Student 1] for the inter-school quiz, which is held from four to six on Wednesday.',
    'Let [Student 1] lead the quiz practice in the lunch break.',
  ],
  [
    'time',
    'Vikram',
    'Vikram is careful with books and likes order.',
    'He comes on the only bus from his village, which reaches school at ten to nine',
    'Have [Student 1] open the library at eight each morning as library monitor.',
    'Make [Student 1] library monitor for the Thursday library period.',
  ],
  [
    'place',
    'Zoya',
    'Zoya is keen on science.',
    'She uses a wheelchair and the science lab is up two flights of stairs with no lift',
    'Have [Student 1] carry out the experiment in the upstairs science lab.',
    'Bring the experiment kit down to the ground-floor room so that [Student 1] can do the experiment there.',
  ],
  [
    'health',
    'Harsh',
    'Harsh makes careless slips in maths.',
    'He has diabetes and must eat at fixed times, with a snack at eleven',
    "Keep [Student 1] in through the eleven o'clock break to finish his corrections, with no food in the room.",
    'Let [Student 1] finish his corrections in the first ten minutes of the afternoon lesson.',
  ],
  [
    'health',
    'Anaya',
    'Anaya loses the thread when a story is read aloud.',
    'She is hard of hearing in her left ear and cannot follow speech from the back of the room',
    'Move [Student 1] to the back row for story time, away from the door.',
    'Seat [Student 1] in the front row on the right-hand side of the room.',
  ],
  [
    'money',
    'Dhruv',
    'Dhruv is the fastest runner in his year.',
    'His family has one set of school clothes for him and cannot buy sports shoes or a kit',
    'Tell [Student 1] he must come in white sports shoes and the house T-shirt for the trials on Monday.',
    'Let [Student 1] take part in the trials in his ordinary school shoes.',
  ],
  [
    'family',
    'Irfan',
    'Irfan speaks well in front of others.',
    'His father is in prison and he does not want anyone at school to know',
    'Ask [Student 1] to give a short talk about what his father does for a living.',
    'Ask [Student 1] to give a short talk about his favourite animal.',
  ],
  [
    'custom',
    'Leela',
    'Leela enjoys the cookery lessons.',
    'She fasts on Mondays and does not eat or drink until sunset',
    'Put [Student 1] on the tasting panel for the cookery lesson on Monday morning.',
    'Put [Student 1] on the tasting panel for the cookery lesson on Thursday morning.',
  ],
];

export const HELDOUT: EvalCase[] = PAIRS.flatMap(([topic, student, about, fact, bad, fine], i) => [
  { id: `heldout-${topic}-${i + 1}-conflict`, expected: 'conflict' as const, topic, student, about, fact, advice: bad },
  { id: `heldout-${topic}-${i + 1}-compatible`, expected: 'compatible' as const, topic, student, about, fact, advice: fine },
]);
