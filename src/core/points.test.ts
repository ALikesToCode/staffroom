import { describe, expect, it } from 'vitest';
import type { DraftItem } from './types';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from './samples';
import { addConstraint, confirmConstraint, lockConstraints, proposeConstraints, unconfirmConstraint } from './constraints';
import { lessonHits } from './lesson';
import { outgoingOf } from './needs';
import { buildVault, deterministicCandidates, possibleNameCandidates } from './vault';
import { acceptablePoints, acceptedPoints, byChild, childFitSaid, childNotes, dedupePairVariations, fitSummary, inNoteOrder, pointCounts, pointHits, pointProblem, recheckPoints, recordedPoints, stageLines, type Point } from './points';

const vault = buildVault(SAMPLE_NOTE, [...deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST), ...possibleNameCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST)]);
let held = { entities: vault, constraints: proposeConstraints(SAMPLE_NOTE, vault) };
for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
const constraints = held.constraints;
const entities = lockConstraints(held.entities, constraints);
const going = outgoingOf(SAMPLE_NOTE, entities, constraints);
const student = (name: string) => entities.find((e) => e.kind === 'student' && e.surfaces.includes(name))!;

const plan: DraftItem[] = [
  { heading: 'Starter (5 minutes)', text: `Show a picture of a market. ${student('Meenal').token} reads the caption aloud.` },
  { heading: 'Teach (10 minutes)', text: 'Model a four-sentence description of the school gate on the board. Pupils copy the sentence starters.' },
  { heading: 'Practise (15 minutes)', text: 'Pupils write a description of a place they know, in pairs.' },
  { heading: 'Check (10 minutes)', text: 'Three pairs read their description aloud' },
  { heading: 'Homework', text: 'Pupils finish the description at home and add three sentences.' },
];

describe('what the note says about each child', () => {
  const notes = childNotes(SAMPLE_NOTE, entities, constraints);

  it('lists the children the note speaks of, in the note\'s order, and not a child it does not mention', () => {
    expect(notes.map((n) => n.name)).toEqual(['Aarav Sharma', 'Meenal Joshi', 'Kabir Qureshi', 'Ishaan Verma', 'Tanvi Rao']);
    expect(notes.map((n) => n.child)).toEqual(['Aarav Sharma', 'Meenal', 'Kabir', 'Ishaan', 'Tanvi']);
    expect(notes.some((n) => n.name === 'Diya Sharma')).toBe(false);
  });

  it('gives each child their own sentences, with names and private details as written', () => {
    const of = (name: string) => notes.find((n) => n.child === name)!;
    expect(of('Meenal').sentences).toEqual([
      'Meenal reads well aloud but freezes in written tests.',
      'She needs extra writing practice, and the remedial writing club meets after the last bell.',
      'She told me she has epilepsy and is afraid of having a seizure in the exam hall.',
      'Her roll no. 6B/23.',
      'She walks six kilometres home to Rampur Kalan and has to leave school at the last bell to reach home before dark.',
    ]);
    // A sentence that names two children is about both.
    expect(of('Kabir').sentences[0]).toBe('Kabir and Ishaan fight most days during group work.');
    expect(of('Ishaan').sentences).toEqual(['Kabir and Ishaan fight most days during group work.', 'Ishaan finishes early and gets bored.']);
    expect(of('Tanvi').text).toContain('does not have a smartphone or an internet connection');
    expect(of('Tanvi').text).not.toMatch(/Aarav|Meenal|epilepsy/);
    expect(of('Aarav Sharma').constraints.map((c) => c.kind)).toEqual(['money', 'time-before']);
    expect(of('Ishaan').constraints).toEqual([]);
  });

  it('adds a constraint the teacher typed that is not in the note', () => {
    const more = addConstraint(SAMPLE_NOTE, entities, constraints, { kind: 'health', about: student('Ishaan').id, text: 'has asthma' });
    const ishaan = childNotes(SAMPLE_NOTE, more.entities, more.constraints).find((n) => n.child === 'Ishaan')!;
    expect(ishaan.text.endsWith('\nhas asthma')).toBe(true);
    expect(ishaan.constraints).toHaveLength(1);
  });

  it('is empty for a note that names nobody', () => {
    expect(childNotes('Class 6B did well this week.', [], [])).toEqual([]);
  });
});

describe('the stages as the fit is told them', () => {
  it('gives the name, the minutes and the first sentence, with names put back', () => {
    expect(stageLines(plan, entities, going.tokens)).toEqual([
      { name: 'Starter', minutes: 5, summary: 'Show a picture of a market.' },
      { name: 'Teach', minutes: 10, summary: 'Model a four-sentence description of the school gate on the board.' },
      { name: 'Practise', minutes: 15, summary: 'Pupils write a description of a place they know, in pairs.' },
      { name: 'Check', minutes: 10, summary: 'Three pairs read their description aloud' },
      { name: 'Homework', summary: 'Pupils finish the description at home and add three sentences.' },
    ]);
  });

  it('cuts a long first sentence and numbers a name used twice', () => {
    const lines = stageLines([{ heading: 'Teach (5 minutes)', text: 'x'.repeat(300) }, { heading: 'Teach (5 minutes)', text: 'Again.' }], entities, going.tokens);
    expect(lines[0].summary).toHaveLength(160);
    expect(lines.map((l) => l.name)).toEqual(['Teach', 'Teach 2']);
  });
});

describe('a point for one child', () => {
  const meenal = student('Meenal').id;
  const tanvi = student('Tanvi').id;
  const point = (over: Partial<Point>): Point => ({ key: 'p1', childId: meenal, child: 'Meenal', itemIndex: 2, text: 'Give her the writing frame first.', source: 'model', state: 'offered', ...over });

  it('is read by rule against that child\'s constraints and the stage it is for', () => {
    expect(pointHits('Keep her after school to finish.', meenal, 2, plan, constraints, SAMPLE_NOTE).map((h) => h.matched)).toEqual(['after school']);
    expect(pointHits('Keep her after school to finish.', tanvi, 2, plan, constraints, SAMPLE_NOTE)).toEqual([]);
    // Homework is at home, the other stages are in class.
    expect(pointHits('Let her watch the video again.', tanvi, 4, plan, constraints, SAMPLE_NOTE)).toHaveLength(1);
    expect(pointHits('Let her watch the video again.', tanvi, 1, plan, constraints, SAMPLE_NOTE)).toEqual([]);
    expect(pointHits('Let her finish in class, not after the last bell.', meenal, 2, plan, constraints, SAMPLE_NOTE)).toEqual([]);
  });

  it('refuses a typed point with no stage, no words, too many, or against that child', () => {
    expect(pointProblem('Sit her near the door.', meenal, 9, plan, constraints, SAMPLE_NOTE)).toBe('Choose a stage of the lesson.');
    expect(pointProblem('  ', meenal, 2, plan, constraints, SAMPLE_NOTE)).toBe('Write what this child needs.');
    expect(pointProblem('x'.repeat(201), meenal, 2, plan, constraints, SAMPLE_NOTE)).toBe('Keep it to 200 characters.');
    expect(pointProblem('She stays back to finish.', meenal, 2, plan, constraints, SAMPLE_NOTE)).toBe('This goes against what you confirmed (“stays back”). Change it or drop it.');
    expect(pointProblem('Sit her near the door.', meenal, 2, plan, constraints, SAMPLE_NOTE)).toBeUndefined();
  });

  it('goes back to waiting, with the reason, when a constraint switched on later makes a rule fire on it', () => {
    const after = constraints.find((c) => c.kind === 'time-after')!;
    const off = unconfirmConstraint(constraints, after.id);
    const accepted = [point({ text: 'She can finish after school.', state: 'accepted', seen: true }), point({ key: 'p2', state: 'accepted' })];
    // With the constraint off nothing fires, and the same array comes back.
    expect(recheckPoints(accepted, plan, off, SAMPLE_NOTE)).toBe(accepted);
    const back = recheckPoints(accepted, plan, constraints, SAMPLE_NOTE);
    expect(back[0]).toMatchObject({ state: 'offered', why: 'This goes against what you confirmed (“after school”). Change it or drop it.' });
    expect(back[1]).toBe(accepted[1]);
    // A point that waits is left as it is: it is read again when it is accepted.
    const waiting = [point({ text: 'She can finish after school.' })];
    expect(recheckPoints(waiting, plan, constraints, SAMPLE_NOTE)).toBe(waiting);
  });

  it('lets "Accept all" take only points that have been shown', () => {
    expect(acceptablePoints([point({ seen: true }), point({ key: 'p2' }), point({ key: 'p3', state: 'accepted' })])).toEqual({ keys: ['p1'], allSeen: false });
    expect(acceptablePoints([point({ seen: true })])).toEqual({ keys: ['p1'], allSeen: true });
  });

  it('is kept, counted and grouped by child and then by stage, with the adjustments', () => {
    const points = [point({ state: 'accepted', itemIndex: 4 }), point({ key: 'p2', state: 'accepted', itemIndex: 0, text: 'Let her read first.' }), point({ key: 'p3' })];
    const kept = acceptedPoints(points);
    expect(kept).toEqual([
      { itemIndex: 0, childId: meenal, child: 'Meenal', text: 'Let her read first.', source: 'model' },
      { itemIndex: 4, childId: meenal, child: 'Meenal', text: 'Give her the writing frame first.', source: 'model' },
    ]);
    expect(pointCounts(points, 3)).toEqual({ pointsSuggested: 3, pointsAccepted: 2, variationsPlaced: 0, variationsAccepted: 0 });
    expect(pointCounts([point({ need: 'A', source: 'cloud', state: 'accepted' }), point({ key: 'p2', need: 'F', source: 'cloud' }), point({ key: 'p3', state: 'accepted' })], 0)).toEqual({ pointsSuggested: 0, pointsAccepted: 1, variationsPlaced: 2, variationsAccepted: 1 });
    const adjustment = { itemIndex: 2, constraintId: 'c', childId: tanvi, child: 'Tanvi', text: 'Gets a printed copy.', source: 'starter' as const };
    expect(byChild(plan, [adjustment, ...kept, { ...adjustment, itemIndex: 1, child: 'Meenal', text: 'Sits away from the lamp.' }])).toEqual([
      { child: 'Tanvi', lines: [{ stage: 'Practise', text: 'Gets a printed copy.' }] },
      {
        child: 'Meenal',
        lines: [
          { stage: 'Starter', text: 'Let her read first.' },
          { stage: 'Teach', text: 'Sits away from the lamp.' },
          { stage: 'Homework', text: 'Give her the writing frame first.' },
        ],
      },
    ]);
    expect(byChild(plan, [])).toEqual([]);
    // On the sheet the children stand in the note's order, whichever of the two a line is.
    const notes = childNotes(SAMPLE_NOTE, entities, constraints);
    expect(inNoteOrder([adjustment, ...kept, { ...adjustment, childId: undefined, child: 'The class' }], notes).map((a) => a.child)).toEqual(['Meenal', 'Meenal', 'Tanvi', 'The class']);
  });

  it('shows the recorded entries that answer no rule as accepted points', () => {
    const notes = childNotes(SAMPLE_NOTE, entities, constraints);
    expect(recordedPoints([{ itemIndex: 1, childId: meenal, text: 'Seat her near the front.', source: 'model' }, { itemIndex: 0, constraintId: 'c', childId: meenal, text: 'x', source: 'starter' }], notes)).toEqual([
      { key: 'r:0', childId: meenal, child: 'Meenal', itemIndex: 1, text: 'Seat her near the front.', source: 'model', state: 'accepted', seen: true },
    ]);
  });
});

describe('the line over the lesson', () => {
  const hits = lessonHits([{ heading: 'Homework', text: 'Pupils find a picture online. Each pupil buys a sheet of chart paper.' }], constraints, entities, going.tokens, SAMPLE_NOTE);

  it('says how many children have notes, how many points were suggested and how many steps go against a constraint, leaving out what is zero', () => {
    expect(fitSummary(5, 7, hits)).toBe('5 children have private notes. 7 points suggested on this device. 2 go against a constraint you confirmed.');
    expect(fitSummary(1, 1, hits.slice(0, 1))).toBe('1 child has private notes. 1 point suggested on this device. 1 goes against a constraint you confirmed.');
    expect(fitSummary(5, 0, [])).toBe('5 children have private notes.');
    expect(fitSummary(0, 0, [])).toBe('Your note says nothing about any one child, so there is nothing to fit.');
    for (const said of [fitSummary(5, 0, []), fitSummary(5, 3, hits)]) expect(said).not.toMatch(/suit/);
  });
});

describe('what is said after the device read the note about a child', () => {
  it('says nothing when points came and none was left out, and never that the lesson suits the child', () => {
    const got = { points: [{}], droppedByRule: 0, unknownStage: 0, read: true };
    expect(childFitSaid('Meenal', got)).toBeUndefined();
    expect(childFitSaid('Meenal', { ...got, points: [] })).toBe('The on-device model suggested nothing for Meenal in this lesson.');
    expect(childFitSaid('Meenal', { ...got, droppedByRule: 1 })).toBe('1 point was left out: a rule found that it went against a constraint you confirmed.');
    expect(childFitSaid('Meenal', { points: [], droppedByRule: 2, unknownStage: 1, read: true })).toBe(
      'The on-device model suggested nothing for Meenal in this lesson. 2 points were left out: a rule found that it went against a constraint you confirmed. 1 point was left out: it named no stage of this lesson.',
    );
    expect(childFitSaid('Meenal', { ...got, read: false })).toBe('The on-device model gave no answer that could be read for Meenal. Write what Meenal needs yourself.');
  });
});

describe('needs the cloud left out, and two children who work better apart', () => {
  it('gives a waiting row with no text beside each child of a need with no entry, with starter wording where the kind has some', async () => {
    const { sampleNeeds } = await import('../eval/needs');
    const { missingPoints, acceptablePoints, fitSummary, pointCounts } = await import('./points');
    const s = sampleNeeds();
    const rows = missingPoints(['B', 'I', 'Z'], s.needs, s.entities, s.constraints, s.note);
    expect(rows.map((p) => [p.child.split(' ')[0], p.need, p.text, p.nothing, Boolean(p.starter)])).toEqual([
      ['Tanvi', 'B', '', true, true],
      ['Kabir', 'I', '', true, false],
      ['Ishaan', 'I', '', true, false],
    ]);
    // Nothing to accept, and not counted as placed.
    expect(acceptablePoints(rows.map((p) => ({ ...p, seen: true })))).toEqual({ keys: [], allSeen: true });
    expect(pointCounts(rows, 0).variationsPlaced).toBe(0);
    expect(fitSummary(5, 0, [], rows)).toBe('5 children have private notes. The cloud wrote nothing for 2 needs.');
  });

  it('puts a pair in different groups on each stage of group work, and seats them apart when no stage has any', async () => {
    const { sampleNeeds } = await import('../eval/needs');
    const { pairPoints, pairLine } = await import('./points');
    const s = sampleNeeds();
    const items = [
      { heading: 'Starter (5 minutes)', text: 'Pupils look at a picture.' },
      { heading: 'Teach (10 minutes)', text: 'In groups of four, pupils sort the words.' },
      { heading: 'Practise (15 minutes)', text: 'Pupils write alone.' },
      { heading: 'Check (10 minutes)', text: 'Partners swap books and mark.' },
    ];
    const got = pairPoints(s.constraints, s.entities, items, s.note);
    expect(pairLine('Kabir', 'Ishaan')).toBe('Put Kabir and Ishaan in different groups.');
    expect(pairLine('Kabir', 'Ishaan', false)).toBe('Seat Kabir and Ishaan apart.');
    // Practise is work alone here, so it gets no line about groups.
    expect(got.map((p) => [p.child, p.itemIndex, p.text, p.source, p.state, p.pair])).toEqual([
      ['Kabir', 1, 'Put Kabir and Ishaan in different groups.', 'starter', 'offered', true],
      ['Ishaan', 1, 'Put Kabir and Ishaan in different groups.', 'starter', 'offered', true],
      ['Kabir', 3, 'Put Kabir and Ishaan in different groups.', 'starter', 'offered', true],
      ['Ishaan', 3, 'Put Kabir and Ishaan in different groups.', 'starter', 'offered', true],
    ]);
    // No stage of group work: one line, on the Practise stage, to seat them apart.
    const alone = items.map((i) => ({ ...i, text: 'Pupils write alone at their desks.' }));
    expect(pairPoints(s.constraints, s.entities, alone, s.note).map((p) => [p.child, p.itemIndex, p.text])).toEqual([
      ['Kabir', 2, 'Seat Kabir and Ishaan apart.'],
      ['Ishaan', 2, 'Seat Kabir and Ishaan apart.'],
    ]);
    // No Practise stage either: the first stage.
    expect(pairPoints(s.constraints, s.entities, alone.slice(0, 2), s.note).map((p) => p.itemIndex)).toEqual([0, 0]);
    expect(pairPoints(s.constraints, s.entities, [], s.note)).toEqual([]);
    // Not a pair: one child alone, or the need not confirmed.
    const one = s.constraints.filter((c) => !(c.learn === 'group' && c.aboutName?.startsWith('Ishaan')));
    expect(pairPoints(one, s.entities, items, s.note)).toEqual([]);
    expect(pairPoints(s.constraints.map((c) => (c.learn === 'group' ? { ...c, confirmed: false } : c)), s.entities, items, s.note)).toEqual([]);
  });

  it('deduplicates group-need cloud variations when local pair lines cover Kabir and Ishaan, and counts pair lines in fitSummary', async () => {
    const { sampleNeeds } = await import('../eval/needs');
    const { pairPoints, placeVariations } = await import('./points');
    const s = sampleNeeds();
    const items = [{ heading: 'Practise (15 minutes)', text: 'Pupils write in pairs.' }];
    const groupNeed = s.needs.find((n) => n.constraintIds.some((id) => s.constraints.find((c) => c.id === id)?.learn === 'group'))!;
    const otherNeed = s.needs.find((n) => n.letter !== groupNeed.letter)!;
    const placed = placeVariations(
      [
        { itemIndex: 0, need: groupNeed.letter, text: 'Seat apart from the specified classmate.' },
        { itemIndex: 0, need: otherNeed.letter, text: 'Give an extension card.' },
      ],
      s.needs,
      s.entities,
      items,
      s.constraints,
      s.note,
    );
    const paired = pairPoints(s.constraints, s.entities, items, s.note);
    const deduped = dedupePairVariations(placed, paired, s.needs, s.constraints);
    expect(deduped.some((p) => p.need === groupNeed.letter)).toBe(false);
    expect(deduped.some((p) => p.need === otherNeed.letter)).toBe(true);
    expect(fitSummary(5, 0, [], [...deduped, ...paired])).toContain('2 local seating lines added on this device in place of the group-work need.');
  });

  it('attributes on-device drafts honestly across fitSummary, placeVariations, missingPoints, preserves danda, and dedupes missing pair needs', async () => {
    const { sampleNeeds } = await import('../eval/needs');
    const { missingPoints, pairPoints, placeVariations } = await import('./points');
    const s = sampleNeeds();
    const items = [{ heading: 'Practise (15 minutes)', text: 'Pupils write in pairs.' }];
    const groupNeed = s.needs.find((n) => n.constraintIds.some((id) => s.constraints.find((c) => c.id === id)?.learn === 'group'))!;
    const otherNeed = s.needs.find((n) => n.letter !== groupNeed.letter)!;
    const placedLocal = placeVariations([{ itemIndex: 0, need: otherNeed.letter, text: 'Send home a printed summary.' }], s.needs, s.entities, items, s.constraints, s.note, true);
    expect(placedLocal[0]?.source).toBe('model');
    expect(fitSummary(5, 0, [], placedLocal, true)).toBe(
      `5 children have private notes. On-device lines placed for 1 need (${placedLocal.length} ${placedLocal.length === 1 ? 'line' : 'lines'} beside ${new Set(placedLocal.map((p) => p.childId)).size} ${new Set(placedLocal.map((p) => p.childId)).size === 1 ? 'child' : 'children'}, without names).`,
    );

    const missingLocal = missingPoints([groupNeed.letter, otherNeed.letter], s.needs, s.entities, s.constraints, s.note, true);
    expect(missingLocal.every((p) => p.source === 'model')).toBe(true);
    const paired = pairPoints(s.constraints, s.entities, items, s.note);
    const dedupedMissing = dedupePairVariations(missingLocal, paired, s.needs, s.constraints);
    expect(dedupedMissing.some((p) => p.need === groupNeed.letter)).toBe(false);
    expect(dedupedMissing.some((p) => p.need === otherNeed.letter)).toBe(true);

    const hindiNote = 'मीनल को शाम को जल्दी घर जाना पड़ता है।';
    const hindiVault = [{ id: 's1', kind: 'student' as const, token: '[Student 1]', surfaces: ['मीनल'], source: 'class list' as const, withheld: true }];
    expect(childNotes(hindiNote, hindiVault, [])[0]?.sentences[0]).toBe(hindiNote);
    const lines = stageLines([{ heading: 'पहला चरण', text: 'सभी छात्र तीन वाक्य लिखेंगे। उसके बाद अभ्यास होगा।' }], hindiVault, []);
    expect(lines[0]?.summary).toBe('सभी छात्र तीन वाक्य लिखेंगे।');
  });

  it('never places two-child pair seating lines onto Homework even if Homework mentions groups', async () => {
    const { pairPoints } = await import('./points');
    const note = 'Kabir and Ishaan fight most days during group work.';
    const pairEntities = [
      { id: 's1', kind: 'student' as const, token: '[Student 1]', surfaces: ['Kabir'], source: 'class list' as const, withheld: true },
      { id: 's2', kind: 'student' as const, token: '[Student 2]', surfaces: ['Ishaan'], source: 'class list' as const, withheld: true },
    ];
    const groupConstraint = { id: 'c1', kind: 'learning' as const, learn: 'group' as const, about: 's1', at: 0, text: 'fight most days during group work', source: 'rule' as const, confirmed: true };
    const groupConstraint2 = { id: 'c2', kind: 'learning' as const, learn: 'group' as const, about: 's2', at: 0, text: 'fight most days during group work', source: 'rule' as const, confirmed: true };
    const items = [
      { heading: 'Practise (15 minutes)', text: 'Work in groups.' },
      { heading: 'Homework (10 minutes)', text: 'Share with family groups at home.' },
    ];
    const pts = pairPoints([groupConstraint, groupConstraint2], pairEntities, items, note);
    expect(pts.map((p) => p.itemIndex)).toEqual([0, 0]);

    const hwVariantItems = [
      { heading: 'Home task (10 minutes)', text: 'Discuss in family groups.' },
      { heading: 'Home learning (10 minutes)', text: 'Practise in pairs at home.' },
      { heading: 'Take-home task (5 minutes)', text: 'Work with partners at home.' },
      { heading: 'Stage 4 – Homework', text: 'Complete with groups.' },
      { heading: 'Starter (5 minutes)', text: 'Read silently alone.' },
    ];
    const variantPts = pairPoints([groupConstraint, groupConstraint2], pairEntities, hwVariantItems, note);
    expect(variantPts.map((p) => p.itemIndex)).toEqual([4, 4]);

    const hwOnlyItems = [{ heading: 'Homework (10 minutes)', text: 'Share at home.' }];
    expect(pairPoints([groupConstraint, groupConstraint2], pairEntities, hwOnlyItems, note)).toEqual([]);
  });
});
