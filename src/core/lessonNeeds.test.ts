import { describe, expect, it } from 'vitest';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from './samples';
import { addConstraint, confirmConstraint, lockConstraints, proposeConstraints, setNeed, setNeedAck, setShare } from './constraints';
import { outgoingOf } from './needs';
import { buildVault, deterministicCandidates, possibleNameCandidates } from './vault';
import {
  checkLessonNeed,
  LEARNING_LINE,
  LESSON_NEEDS_HEADING,
  lessonNeedLine,
  lessonNeeds,
  needLabel,
  planWithNeeds,
  proposeLearning,
  askAgain,
  needsAsk,
  secondAsk,
  splitVariations,
  withSecondReading,
  VARIATION_INSTRUCTION,
  variationLine,
} from './lessonNeeds';
import { childNotes, fitSummary, namesForNeed, placeVariations } from './points';

const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
/** The sample class as the app holds it for a lesson: every proposal confirmed, and every need that has a line told. */
let held = { entities: vault, constraints: [...proposeConstraints(SAMPLE_NOTE, vault), ...proposeLearning(SAMPLE_NOTE, vault)] };
for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
const all = held.constraints.reduce((cs, c) => (lessonNeedLine(c) ? setShare(cs, c.id, true) : cs), held.constraints);
const entities = lockConstraints(held.entities, all);
const id = (name: string) => entities.find((e) => e.kind === 'student' && e.surfaces.includes(name))!.id;
const name = (sid: string) => entities.find((e) => e.id === sid)!.surfaces[0];

describe('learning needs proposed by rule', () => {
  const found = proposeLearning(SAMPLE_NOTE, vault);

  it('finds in the sample note what is no constraint and still matters for teaching, each with its child', () => {
    expect(found.map((c) => [c.aboutName, c.learn, c.text])).toEqual([
      ['Aarav Sharma', 'missed', 'has missed four days this month'],
      ['Aarav Sharma', 'homework', 'has not handed in homework for two weeks'],
      ['Meenal Joshi', 'tests', 'freezes in written tests'],
      ['Kabir Qureshi', 'group', 'fight most days during group work'],
      ['Ishaan Verma', 'group', 'fight most days during group work'],
      ['Ishaan Verma', 'early', 'finishes early and gets bored'],
      ['Tanvi Rao', 'reads-above', 'is far ahead in reading'],
      ['Tanvi Rao', 'shy', 'is shy'],
    ]);
    for (const c of found) {
      expect(c).toMatchObject({ kind: 'learning', confirmed: false, source: 'rule', need: LEARNING_LINE[c.learn!] });
      expect(SAMPLE_NOTE.slice(c.at, c.at! + c.text.length)).toBe(c.text);
      expect(c.share).toBeUndefined();
    }
  });

  it('reads each kind from plain words, and nothing from words that only look alike', () => {
    const note = (text: string) => {
      const v = buildVault(text, deterministicCandidates(text, ['Lata Nair']));
      return proposeLearning(text, v).map((c) => c.learn);
    };
    expect(note('Lata was absent for six days last month.')).toEqual(['missed']);
    expect(note('Lata gets bored easily.')).toEqual(['early']);
    expect(note('Lata is nervous about tests.')).toEqual(['tests']);
    expect(note('Lata argues with her partner in pair work.')).toEqual(['group']);
    expect(note('Lata reads well above her grade level.')).toEqual(['reads-above']);
    expect(note('Lata struggles to read.')).toEqual(['reads-below']);
    expect(note('Lata does not do her homework.')).toEqual(['homework']);
    expect(note('Lata is afraid of the dark in the exam hall.')).toEqual([]);
    expect(note('Lata reads the board from the front row.')).toEqual([]);
    // Whose it is must be plain.
    expect(note('Somebody finishes early.')).toEqual([]);
  });
});

describe('the needs a lesson is told', () => {
  const needs = lessonNeeds(all, entities);

  it('gives each need a letter and a line with no child in it, and keeps whose it is here', () => {
    expect(needs.map((n) => [n.letter, n.line, n.children.map(name)])).toEqual([
      ['A', 'cannot stay after the last bell', ['Meenal Joshi']],
      ['B', 'no phone or internet at home', ['Tanvi Rao']],
      ['C', 'nothing that has to be bought or brought from home', ['Aarav Sharma']],
      ['D', 'cannot come before the first bell', ['Aarav Sharma']],
      ['F', 'finds written tests hard; can answer aloud', ['Meenal Joshi']],
      ['G', 'finishes early and needs more to do', ['Ishaan Verma']],
      ['H', 'has missed recent lessons', ['Aarav Sharma']],
      // Two children with the same need share one letter.
      ['I', 'works better apart from one classmate', ['Kabir Qureshi', 'Ishaan Verma']],
      ['M', 'has not handed in recent homework', ['Aarav Sharma']],
      ['N', 'needs time before speaking in front of the class', ['Tanvi Rao']],
      ['O', 'reads above the level of the class', ['Tanvi Rao']],
    ]);
    for (const n of needs) expect(n.issues, n.line).toEqual([]);
  });

  it('has no line for health or a contact until the teacher types one', () => {
    const health = all.find((c) => c.kind === 'health')!;
    const contact = all.find((c) => c.kind === 'contact')!;
    expect(lessonNeedLine(health)).toBeUndefined();
    expect(lessonNeedLine(contact)).toBeUndefined();
    expect(needs.some((n) => n.constraintIds.includes(health.id) || n.constraintIds.includes(contact.id))).toBe(false);
    const typed = setShare(setNeed(all, health.id, 'Must avoid flashing or flickering light.'), health.id, true);
    const more = lessonNeeds(typed, entities);
    expect(more.find((n) => n.constraintIds.includes(health.id))).toMatchObject({ letter: 'R', line: 'Must avoid flashing or flickering light', issues: [] });
  });

  it('is written under its own heading in the outgoing text, with no stand-in, no name and no count of children', () => {
    const going = outgoingOf(SAMPLE_NOTE, entities, all, true);
    const block = going.text.slice(going.text.indexOf(LESSON_NEEDS_HEADING));
    expect(block.split('\n').slice(1, 4)).toEqual(['Need A: cannot stay after the last bell', 'Need B: no phone or internet at home', 'Need C: nothing that has to be bought or brought from home']);
    expect(block).not.toMatch(/\[Student|\[Place|Meenal|Aarav|Tanvi|Kabir|Ishaan|two|both|\d/);
    expect(going.violations).toEqual([]);
    expect(going.lessonNeeds).toHaveLength(11);
    // A rule hit can still say the cloud was told the need behind a constraint.
    expect(going.needs.find((n) => n.id === all.find((c) => c.kind === 'time-after')!.id)?.line).toBe('Need A: cannot stay after the last bell');
    // The words behind a confirmed learning need are withheld from the note, so the cloud cannot tie the need to a stand-in.
    expect(going.text.slice(0, going.text.indexOf(LESSON_NEEDS_HEADING))).not.toMatch(/freezes in written tests|finishes early|far ahead in reading/);
    // The other tasks are told nothing of a learning need.
    expect(outgoingOf(SAMPLE_NOTE, entities, all).text).not.toMatch(/Need [A-Z]:|written tests hard/);
  });

  it('carries no sentence about one pupil: what is about the class, then every need by letter', () => {
    const going = outgoingOf(SAMPLE_NOTE, entities, all, true);
    const note = going.text.slice(0, going.text.indexOf(LESSON_NEEDS_HEADING));
    expect(going.text).not.toContain('[Student');
    expect(note).not.toMatch(/\b(?:he|she|his|her)\b|\[withheld\]|\[Place|\[ID|\[Adult|\[Contact/i);
    // The class-level sentences of the note are still sent.
    expect(note.trim()).toBe('Class 6B, week of 16 November. Notes for myself.');
    expect(going.notSent).toBe(15);
    for (const n of going.lessonNeeds!) expect(going.text).toContain(`\n${needLabel(n)}\n`);
    expect(going.tokens).toEqual([]);
    expect(going.violations).toEqual([]);
  });

  it('keeps a need that is switched off, or not confirmed, to itself', () => {
    const tests = all.find((c) => c.learn === 'tests')!;
    expect(lessonNeeds(setShare(all, tests.id, false), entities).some((n) => n.letter === 'F')).toBe(false);
    expect(lessonNeeds(all.map((c) => ({ ...c, share: false })), entities)).toEqual([]);
    expect(outgoingOf(SAMPLE_NOTE, entities, all.map((c) => ({ ...c, share: false })), true).text).not.toContain(LESSON_NEEDS_HEADING);
  });

  it('gives a line the teacher changed the next free letter, and stops a name, a stand-in and a sensitive word in it', () => {
    const early = all.find((c) => c.learn === 'early')!;
    const changed = lessonNeeds(setNeed(all, early.id, 'needs a harder task once done'), entities);
    expect(changed.find((n) => n.constraintIds.includes(early.id))).toMatchObject({ letter: 'R', line: 'needs a harder task once done' });
    expect(changed.some((n) => n.letter === 'G')).toBe(false);
    const why = (line: string, acked = false) => checkLessonNeed(line, entities, acked).issues.map((v) => v.what);
    expect(why('needs more to do, like Ishaan')).toContain('Ishaan');
    expect(why('[Student 2] cannot stay late')).toContain('[Student 2]');
    expect(why('needs help when Rohit is away')).toContain('Rohit');
    expect(why('away on Thursdays')).toEqual([]);
    // A word from the sensitive list stops the line until the teacher says to send it as worded.
    const said = checkLessonNeed('has epilepsy; avoid flashing light', entities, false);
    expect(said.sensitive).toContain('epilepsy');
    expect(said.issues.map((v) => v.what)).toContain('epilepsy');
    expect(checkLessonNeed('has epilepsy; avoid flashing light', entities, true).issues).toEqual([]);
    const health = all.find((c) => c.kind === 'health')!;
    const typed = setShare(setNeed(all, health.id, 'has epilepsy; avoid flashing light'), health.id, true);
    expect(outgoingOf(SAMPLE_NOTE, entities, typed, true).violations.map((v) => v.what)).toEqual(['epilepsy']);
    const acked = setNeedAck(typed, health.id, true);
    expect(outgoingOf(SAMPLE_NOTE, entities, acked, true).violations).toEqual([]);
    // Other words need their own tick.
    expect(setNeed(acked, health.id, 'has seizures').find((c) => c.id === health.id)!.needAck).toBeUndefined();
  });

  it('labels a need the same way everywhere', () => {
    expect(needLabel(needs[0])).toBe('Need A: cannot stay after the last bell');
  });
});

describe('what the cloud wrote for a need', () => {
  const needs = lessonNeeds(all, entities);
  const letters = needs.map((n) => n.letter);
  const reply = {
    title: 'Describing a place',
    items: [
      { heading: 'Starter (5 minutes)', text: 'Show a picture of a market. Pupils call out what they see.' },
      { heading: 'Practise (15 minutes)', text: 'Pupils write a description in pairs.' },
      { heading: 'Check (10 minutes)', text: 'A short written quiz.' },
      { heading: 'Homework', text: 'Pupils find a picture of a place online and describe it.' },
      {
        heading: 'For each need',
        text: [
          'Need G | Practise | such a pupil adds a second paragraph on sounds.',
          'Need I | Practise (15 minutes) | such pupils work in different pairs.',
          'Need F | Check | a pupil with this need answers the quiz aloud, and may finish it after school.',
          'Need Q | Check | sits near the door.',
          'Need b | homework | such a pupil describes a picture from the textbook.',
          'Need C | Homework | ',
          'Need A | Plenary | leaves at the bell.',
          'Need D | none | This lesson already suits this need.',
          'Need H | none | This lesson already suits this need.',
        ].join('\n'),
      },
    ],
  };
  const { draft, variations, dropped, none, missing, section } = splitVariations(reply, letters);

  it('asks the cloud for a line only where a stage needs one, and not to guess who', () => {
    expect(VARIATION_INSTRUCTION).toContain('one last item with the heading "For each need"');
    expect(VARIATION_INSTRUCTION).toContain('"Need A | <stage name> | <one or two short, direct teacher actions starting with a verb');
    expect(VARIATION_INSTRUCTION).toContain('Never write "such a pupil", "for the same purpose", or "the pupil who".');
    expect(VARIATION_INSTRUCTION).toContain('"Need A | none | This lesson already suits this need."');
    expect(VARIATION_INSTRUCTION).toContain('Every listed letter must appear.');
    expect(needsAsk(['A', 'B'])).toBe('Under "For each need", give an entry for every one of these letters: A, B.');
    expect(outgoingOf(SAMPLE_NOTE, entities, all, true).text).toContain(`\n${needsAsk(letters)}`);
    expect(VARIATION_INSTRUCTION).toContain('Do not guess who or how many.');
  });

  it('takes the lines out of the stages, strictly: an unknown letter and an empty line are dropped and counted', () => {
    expect(draft.items.map((i) => i.text)).toEqual([
      'Show a picture of a market. Pupils call out what they see.',
      'Pupils write a description in pairs.',
      'A short written quiz.',
      'Pupils find a picture of a place online and describe it.',
    ]);
    expect(variations).toEqual([
      { itemIndex: 1, need: 'G', text: 'such a pupil adds a second paragraph on sounds.' },
      { itemIndex: 1, need: 'I', text: 'such pupils work in different pairs.' },
      { itemIndex: 2, need: 'F', text: 'a pupil with this need answers the quiz aloud, and may finish it after school.' },
      { itemIndex: 3, need: 'B', text: 'such a pupil describes a picture from the textbook.' },
    ]);
    // Left out: letter Q, no words for C, a stage that is not there for A.
    expect(dropped).toBe(3);
    expect(none).toEqual(['D', 'H']);
    // A need may have two entries and no more, and one with a real entry is not also "none".
    const two = splitVariations({ title: 't', items: [{ heading: 'Starter', text: 'a' }, { heading: 'Teach', text: 'b' }, { heading: 'Check', text: 'c' }, { heading: 'For each need:', text: 'Need G | none | suits. Need G | Starter | one. Need G | Teach | two. Need G | Check | three.' }] }, ['G']);
    expect(two).toMatchObject({ variations: [{ itemIndex: 0, need: 'G', text: 'one.' }, { itemIndex: 1, need: 'G', text: 'two.' }], dropped: 1, none: [], missing: [] });
    expect(missing).toEqual(letters.filter((l) => !['B', 'D', 'F', 'G', 'H', 'I'].includes(l)));
    expect(section).toContain('Need Q | Check | sits near the door.');
    const bare = splitVariations({ title: 't', items: [{ heading: 'h', text: 'Plan for needs of the class. Need A | h | not in a section.' }] }, letters);
    expect(bare).toMatchObject({ draft: { title: 't', items: [{ heading: 'h', text: 'Plan for needs of the class. Need A | h | not in a section.' }] }, variations: [], dropped: 0, none: [], missing: letters, section: '' });
    expect(variationLine(variations[0])).toBe('For Need G: such a pupil adds a second paragraph on sounds.');

    // If the cloud puts a stage name instead of "none" alongside "This lesson already suits this need.", treat it as already suited rather than placing it beside a child.
    const stageAlreadySuits = splitVariations(
      {
        title: 't',
        items: [
          { heading: 'Homework (0 minutes)', text: 'Write five sentences.' },
          {
            heading: 'For each need',
            text: [
              'Need A | Homework | This lesson already suits this need.',
              'Need B | Homework | Already suited.',
              'Need C | Homework | No change needed.',
              'Need G | Homework | Add two extension questions.',
            ].join('\n'),
          },
        ],
      },
      ['A', 'B', 'C', 'G'],
    );
    expect(stageAlreadySuits.none).toEqual(['A', 'B', 'C']);
    expect(stageAlreadySuits.variations).toEqual([{ itemIndex: 0, need: 'G', text: 'Add two extension questions.' }]);
    expect(stageAlreadySuits.missing).toEqual([]);
    expect(stageAlreadySuits.dropped).toBe(0);
    expect(planWithNeeds(stageAlreadySuits.draft, stageAlreadySuits.variations)).not.toContain('already suits');
    expect(placeVariations(stageAlreadySuits.variations, needs, entities, stageAlreadySuits.draft.items, all, SAMPLE_NOTE)).toHaveLength(1);
  });

  it('asks once more when over a third of the needs have no entry, for the missing letters only', () => {
    expect(askAgain(['A', 'B'], ['A', 'B', 'C', 'D', 'E', 'F'])).toBe(false);
    expect(askAgain(['A', 'B', 'C'], ['A', 'B', 'C', 'D', 'E', 'F'])).toBe(true);
    expect(askAgain([], [])).toBe(false);
    expect(secondAsk('approved text', ['B', 'D'])).toBe('approved text\n\nWrite the entries for: B, D');
    const first = splitVariations(reply, letters);
    const again = withSecondReading(first, {
      title: 'x',
      items: [
        { heading: 'Opening (5 minutes)', text: 'A different lesson.' },
        { heading: 'Homework', text: 'x' },
        { heading: 'For each need', text: 'Need A | Homework | hands it in before the last bell.\nNeed C | Opening | no such stage in the first plan.\nNeed M | none | This lesson already suits this need.\nNeed G | Homework | not asked for again.' },
      ],
    });
    expect(again.draft).toEqual(first.draft);
    expect(again.variations.filter((v) => v.need === 'A')).toEqual([{ itemIndex: 3, need: 'A', text: 'hands it in before the last bell.' }]);
    expect(again.none).toEqual(['D', 'H', 'M']);
    expect(again.missing).toEqual(first.missing.filter((l) => l !== 'A' && l !== 'M'));
    expect(again.dropped).toBe(first.dropped + 2);
    expect(again.variations.filter((v) => v.need === 'G')).toHaveLength(1);
  });

  it('gives the plan that can be shared: the stages and the lines by letter, with no name', () => {
    const text = planWithNeeds(draft, variations);
    expect(text).toContain('Practise (15 minutes)\nPupils write a description in pairs.\nFor Need G: such a pupil adds a second paragraph on sounds.\nFor Need I: such pupils work in different pairs.');
    expect(text).not.toContain('For each need');
    expect(text).not.toMatch(/Meenal|Ishaan|Kabir|Tanvi|Aarav/);
  });

  it('puts each line beside each child who has that need, in the cloud\'s own words, and only on the device', () => {
    const placed = placeVariations(variations, needs, entities, draft.items, all, SAMPLE_NOTE);
    expect(placed.map((p) => [p.child, p.need, p.itemIndex, p.source, p.state])).toEqual([
      ['Ishaan', 'G', 1, 'cloud', 'offered'],
      ['Kabir', 'I', 1, 'cloud', 'offered'],
      ['Ishaan', 'I', 1, 'cloud', 'offered'],
      ['Meenal', 'F', 2, 'cloud', 'offered'],
      ['Tanvi', 'B', 3, 'cloud', 'offered'],
    ]);
    expect(placed[0].text).toBe('such a pupil adds a second paragraph on sounds.');
    expect(new Set(placed.map((p) => p.key)).size).toBe(5);
    expect(namesForNeed('I', needs, childNotes(SAMPLE_NOTE, entities, all), entities)).toEqual(['Kabir Qureshi', 'Ishaan Verma']);
    expect(namesForNeed('Q', needs, childNotes(SAMPLE_NOTE, entities, all), entities)).toEqual([]);
  });

  it('catches what the cloud could not know: a line for one need that breaks another constraint of the same child', () => {
    const placed = placeVariations(variations, needs, entities, draft.items, all, SAMPLE_NOTE);
    const meenal = placed.find((p) => p.child === 'Meenal')!;
    // Written for Need F (tests). It keeps her after school, which the constraint behind Need A rules out.
    expect(meenal.why).toBe('This step keeps Meenal after school. You confirmed: “has to leave school at the last bell to reach home before dark”.');
    expect(meenal.starter).toBe('Does this during the lesson or the lunch break instead.');
    expect(placed.filter((p) => p.why !== undefined)).toHaveLength(1);
    // The same line is fine for a child with the need and without that constraint.
    const lata = addConstraint(SAMPLE_NOTE, entities, all, { kind: 'learning', about: id('Kabir Qureshi'), text: 'finds tests hard' });
    const hers = lata.constraints.find((c) => c.text === 'finds tests hard')!;
    const both = setShare(setNeed(lata.constraints, hers.id, LEARNING_LINE.tests), hers.id, true);
    const again = placeVariations(variations, lessonNeeds(both, lata.entities), lata.entities, draft.items, both, SAMPLE_NOTE);
    expect(again.filter((p) => p.need === 'F').map((p) => [p.child, p.why !== undefined])).toEqual([['Meenal', true], ['Kabir', false]]);
  });

  it('says in one line what the cloud wrote for and what the device placed, leaving out what is zero', () => {
    const placed = placeVariations(variations, needs, entities, draft.items, all, SAMPLE_NOTE);
    expect(fitSummary(5, 0, [], placed)).toBe('5 children have private notes. The cloud wrote for 4 needs without knowing whose. 5 lines placed beside 4 children on this device. 1 goes against a constraint you confirmed.');
    expect(fitSummary(5, 0, [], placed.slice(0, 1))).toBe('5 children have private notes. The cloud wrote for 1 need without knowing whose. 1 line placed beside 1 child on this device.');
  });
});
