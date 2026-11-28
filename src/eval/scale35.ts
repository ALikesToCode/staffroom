import { applyLocks, buildVault, deterministicCandidates, redact } from '../core/vault';
import { checkOutgoing, type Violation } from '../core/gate';
import { proposeConstraints } from '../core/constraints';
import { proposeLearning } from '../core/lessonNeeds';
import { DEFAULT_POLICY } from '../core/policy';
import type { Candidate } from '../core/vault';
import type { Constraint, Entity, Where } from '../core/types';

export interface Scale35Fixture {
  classList: string[];
  note: string;
  /** PII strings (names, phones, IDs, sensitive family/health clauses) that must never survive redaction. */
  mustWithhold: string[];
}

export const SCALE_35_CLASS: string[] = [
  'Aadhya Hegde',
  'Bhavesh Solanki',
  'Charvi Deshmukh',
  'Devansh Tiwari',
  'Eshaan Kulkarni',
  'Falguni Parekh',
  'Gaurav Bhasin',
  'Harshita Sahu',
  'Indrajit Sarkar',
  'Jhanvi Goswami',
  'Kartikeya Pillai',
  'Lavanya Sundaram',
  'Manan Chaturvedi',
  'Niharika Mohanty',
  'Omkar Shinde',
  'Pranjal Vyas',
  'Qasim Siddiqui',
  'Ritika Bhardwaj',
  'Siddharth Unni',
  'Tamanna Chatterjee',
  'Udayan Pathak',
  'Vanshika Sethi',
  'Waqar Ansari',
  'Yashaswi Kothari',
  'Zoya Merchant',
  'Amritpal Gill',
  'Bhumika Rawat',
  'Chaitanya Gokhale',
  'Deepika Subramanian',
  'Eklavya Tomar',
  'Farhan Qureshi',
  'Gitanjali Patnaik',
  'Himanshu Chauhan',
  'Ira Kulkarni',
  'Jitendra Yadav',
];

export const SCALE_35_NOTE = [
  'Class 6C weekly staffroom register (invented teaching note):',
  'Aadhya reads fluently and helped Bhavesh check spelling; Bhavesh helps at the family bakery before school from 5 am and arrives sleepy.',
  'Charvi told me she has asthma and carries an inhaler, so avoid dusty playground errands. Devansh misses Tuesdays for his mother’s clinic rounds.',
  'Eshaan cannot pay for any printed workbook this term because his father lost his shop after the rains; ring Mrs. Parekh (+91 98112 44019) only through office hours, Falguni’s father must not be rung.',
  'Gaurav has no phone or internet at home. Harshita wrote an essay on mental health and reads confidently aloud.',
  'Indrajit ko mirgi aati hai and he rests his head when lights flash. Jhanvi arrives without breakfast most Mondays.',
  'Kartikeya lives in Sultanpur Village; Lavanya stays back after the last bell only on Wednesdays for choir, whereas Manan must leave at the final bell.',
  'Niharika has unpaid exam fees pending (Roll no. 6C/14, Ref AP-449012). Omkar is preparing a science chapter on diseases and a story about a hospital.',
  'Pranjal and Qasim talk across desks during silent writing; seat apart. Ritika’s parents are separating, told in confidence by email (parents.ritika@example.invalid).',
  'Siddharth (सिद्धार्थ) has no phone at home on Saturdays (घर पर फ़ोन नहीं है). Tamanna’s father passed away last month (तमन्ना के पिता का निधन पिछले महीने हुआ).',
  'Udayan finishes exercises early and wants extension reading. Vanshika struggles with multi-step word problems and needs worked examples.',
  'Waqar misses four lessons each fortnight for seasonal harvest travel. Yashaswi has an allergy to chalk dust.',
  'Zoya is cheerful in group reading. Amritpal ke ghar paise nahi hain (Aadhaar 4829 1102 7734) and Bhumika translates instructions calmly.',
  'Chaitanya gets tired easily during long copying tasks. Deepika stays on for remedial reading after school, while Eklavya’s mother works evening shifts until nine pm.',
  'Farhan prefers oral checks before written paragraphs. Gitanjali lost her notebook twice last week. Himanshu reads clearly.',
  'Ira and Jitendra completed every workbook page cleanly and peer-tutored the back row on Friday.',
].join('\n\n');

export function buildScale35Fixture(): Scale35Fixture {
  return {
    classList: SCALE_35_CLASS,
    note: SCALE_35_NOTE,
    mustWithhold: [
      ...SCALE_35_CLASS.map((n) => n.split(' ')[0]),
      '98112',
      '44019',
      'parents.ritika@example.invalid',
      '4829',
      'asthma',
      'mirgi',
      'separating',
      'lost his shop',
      'without breakfast',
      'tired easily',
    ],
  };
}

export interface Scale35Result {
  students: number;
  noteChars: number;
  where: Where;
  paragraphs: number;
  unread: number[];
  dropped: number;
  partial: number;
  entitiesHeld: number;
  nanoAdded: number;
  constraintsProposed: number;
  learningProposed: number;
  exitGateViolations: Violation[];
  leakedTokens: string[];
  ms: number;
}

export function scoreScale35(
  fixture: Scale35Fixture,
  modelCandidates: Candidate[],
  where: Where,
  unread: number[],
  dropped: number,
  partial: number,
  ms: number,
  paragraphsCount: number,
): Scale35Result {
  const ruleCands = deterministicCandidates(fixture.note, fixture.classList);
  const rawEntities: Entity[] = applyLocks(
    buildVault(fixture.note, [...ruleCands, ...modelCandidates]),
    DEFAULT_POLICY.lockedKinds,
  );
  const constraints: Constraint[] = proposeConstraints(fixture.note, rawEntities);
  const learning = proposeLearning(fixture.note, rawEntities);
  const redacted = redact(fixture.note, rawEntities);
  const exitGateViolations = checkOutgoing(redacted, rawEntities, fixture.note);
  const lowerOut = redacted.toLowerCase();
  const leakedTokens = fixture.mustWithhold.filter((s) => lowerOut.includes(s.toLowerCase()));
  return {
    students: fixture.classList.length,
    noteChars: fixture.note.length,
    where,
    paragraphs: paragraphsCount,
    unread,
    dropped,
    partial,
    entitiesHeld: rawEntities.filter((e) => e.withheld).length,
    nanoAdded: rawEntities.filter((e) => e.source === 'on-device model' && e.withheld).length,
    constraintsProposed: constraints.length,
    learningProposed: learning.length,
    exitGateViolations,
    leakedTokens,
    ms,
  };
}
