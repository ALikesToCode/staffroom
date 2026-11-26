import { describe, expect, it } from 'vitest';
import type { SavedLesson } from './lesson';
import { confirmConstraint, lockConstraints, proposeConstraints, restoreConstraints } from './constraints';
import { checkLessonNeed, inlineToSection, lessonNeedLine, lessonNeeds, proposeLearning, splitVariations } from './lessonNeeds';
import { outgoingOf } from './needs';
import { namesForNeed, placeVariations, childNotes } from './points';
import { SAMPLE_CLASS_LIST, SAMPLE_NOTE } from './samples';
import { allGotIt, classView, currentTicketKind, SAMPLE_TICKET, ticketLine, ticketNeeds, ticketTopic, withoutClass, withTicketNeeds } from './ticket';
import type { Constraint } from './types';
import { buildVault, deterministicCandidates } from './vault';

const saved = (ticket: Record<string, 'got' | 'partly' | 'not' | 'absent'> | undefined, topic = 'Writing a short description of a place'): SavedLesson => ({
  id: 'l1',
  savedAt: '2026-11-20T10:00:00.000Z',
  fields: { klass: 'Class 6', subject: 'English', topic, minutes: 40, lastTime: '' },
  title: 'A place',
  stages: [{ heading: 'Starter (5 minutes)', text: 'Look at a picture.' }],
  adjustments: [{ itemIndex: 0, child: 'Tanvi Rao', text: 'x', source: 'teacher' }],
  constraintIds: [],
  after: { stages: ['done'], line: '', at: '2026-11-21T10:00:00.000Z', ...(ticket ? { ticket } : {}) },
});

const vault = buildVault(SAMPLE_NOTE, deterministicCandidates(SAMPLE_NOTE, SAMPLE_CLASS_LIST));

describe('needs from an exit ticket', () => {
  it('says the topic plainly, without "Continue:" and without a leading capital', () => {
    expect(ticketTopic('Continue: Continue: Fractions of a whole.')).toBe('fractions of a whole');
    expect(ticketTopic('   ')).toBe('the last topic');
    expect(ticketLine('ticket-not', 'Fractions')).toBe('has not yet got fractions; needs it taught again another way');
    expect(ticketLine('ticket-got', 'Fractions')).toBe('got fractions on the exit ticket; ready for a harder task');
    expect(ticketLine('ticket-partly', 'Fractions')).toBe('partly got fractions; needs more practice on it');
    expect(ticketLine('ticket-absent', 'Fractions')).toBe('was absent for fractions');
  });

  it('gives one need for each child with a mark, and none for a child with no mark', () => {
    const needs = ticketNeeds(saved(SAMPLE_TICKET));
    expect(needs.map((c) => [c.childName, c.learn])).toEqual([
      ['Aarav Sharma', 'ticket-absent'],
      ['Diya Sharma', 'ticket-got'],
      ['Meenal Joshi', 'ticket-partly'],
      ['Kabir Qureshi', 'ticket-not'],
      ['Tanvi Rao', 'ticket-got'],
      ['Ishaan Verma', 'ticket-not'],
    ]);
    expect(needs.every((c) => c.confirmed && c.share && c.kind === 'learning')).toBe(true);
    expect(ticketNeeds(saved(undefined))).toEqual([]);
    expect(Object.values(allGotIt(SAMPLE_CLASS_LIST))).toEqual(['got', 'got', 'got', 'got', 'got', 'got']);
  });

  it('tells the cloud letters J, K, L and Q with no name and no count, and each line passes the gate', () => {
    const held = restoreConstraints(SAMPLE_NOTE, vault, withTicketNeeds([], saved(SAMPLE_TICKET)), []);
    const entities = lockConstraints(held.entities, held.constraints);
    const needs = lessonNeeds(held.constraints, entities);
    expect(needs.map((n) => [n.letter, n.line])).toEqual([
      ['J', 'has not yet got writing a short description of a place; needs it taught again another way'],
      ['K', 'got writing a short description of a place on the exit ticket; ready for a harder task'],
      ['L', 'was absent for writing a short description of a place'],
      ['Q', 'partly got writing a short description of a place; needs more practice on it'],
    ]);
    for (const n of needs) expect(n.issues, n.line).toEqual([]);
    const text = outgoingOf(SAMPLE_NOTE, entities, held.constraints, true).text;
    const told = text.slice(text.indexOf('Needs in this class'));
    for (const name of ['Aarav', 'Diya', 'Kabir', 'Tanvi', 'Ishaan', 'Meenal', 'Sharma']) expect(told).not.toContain(name);
    expect(told).not.toMatch(/\b(two|three|2|3)\b/);
    // A child who is in the note is tied to the vault; one who is only on the class list is kept by name, on the device.
    const k = needs.find((n) => n.letter === 'K')!;
    expect(k.children).toHaveLength(1);
    expect(k.others).toEqual(['Diya Sharma']);
    expect(namesForNeed('K', needs, childNotes(SAMPLE_NOTE, entities, held.constraints), entities).sort()).toEqual(['Diya Sharma', 'Tanvi Rao']);
  });

  it('places what the cloud wrote for J, K, L and Q beside the right children', () => {
    const held = restoreConstraints(SAMPLE_NOTE, vault, withTicketNeeds([], saved(SAMPLE_TICKET)), []);
    const entities = lockConstraints(held.entities, held.constraints);
    const needs = lessonNeeds(held.constraints, entities);
    const draft = { title: 't', items: [{ heading: 'Teach (10 minutes)', text: 'Model a paragraph. For Need J: works through a second model with the teacher. For Need K: writes from a harder picture. For Need L: reads the model from last lesson first. For Need Q: does two more of the first kind.' }] };
    const split = splitVariations(inlineToSection(draft), needs.map((n) => n.letter));
    const points = placeVariations(split.variations, needs, entities, split.draft.items, held.constraints, SAMPLE_NOTE);
    expect(points.map((p) => `${p.need}:${p.child.split(' ')[0]}`).sort()).toEqual(['J:Ishaan', 'J:Kabir', 'K:Tanvi', 'L:Aarav', 'Q:Meenal']);
  });

  it('replaces the needs of an earlier ticket and keeps every other constraint', () => {
    const base = [...proposeConstraints(SAMPLE_NOTE, vault), ...proposeLearning(SAMPLE_NOTE, vault)];
    const first = withTicketNeeds(base, saved({ 'Tanvi Rao': 'not' }, 'Fractions'));
    const second = withTicketNeeds(first, saved({ 'Tanvi Rao': 'got' }, 'Decimals'));
    expect(second.filter((c) => c.learn?.startsWith('ticket-')).map((c) => c.need)).toEqual(['got decimals on the exit ticket; ready for a harder task']);
    expect(second).toHaveLength(base.length + 1);
  });

  it('reads a need kept as "ticket-quick" as "got it", with the line of that kind', () => {
    const old = { ...ticketNeeds(saved({ 'Tanvi Rao': 'got' }, 'Decimals'))[0], learn: 'ticket-quick', need: 'got decimals quickly; needs a harder task' } as unknown as Constraint;
    expect(currentTicketKind(old)).toMatchObject({ learn: 'ticket-got', need: 'got decimals on the exit ticket; ready for a harder task', childName: 'Tanvi Rao' });
    // A line the teacher changed stays as it is; the kind is still renamed.
    expect(currentTicketKind({ ...old, need: 'needs a harder task' })).toMatchObject({ learn: 'ticket-got', need: 'needs a harder task' });
    const other = proposeLearning(SAMPLE_NOTE, vault)[0];
    expect(currentTicketKind(other)).toBe(other);
  });

  it('a topic with a name in it stops the line at the gate', () => {
    const line = ticketLine('ticket-not', 'the letter Meenal wrote');
    expect(checkLessonNeed(line, vault, false).issues.length).toBeGreaterThan(0);
  });
});

describe('the class view', () => {
  it('shows each child across the lessons with a ticket, oldest first, and the needs that stand', () => {
    let held = { entities: vault, constraints: proposeConstraints(SAMPLE_NOTE, vault) };
    for (const c of held.constraints) held = confirmConstraint(SAMPLE_NOTE, held.entities, held.constraints, c.id);
    const newer = { ...saved(SAMPLE_TICKET), id: 'l2' };
    const older = saved({ 'Tanvi Rao': 'partly' });
    const view = classView([newer, saved(undefined), older], SAMPLE_CLASS_LIST, held.constraints, lessonNeedLine);
    expect(view.lessons.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(view.rows.find((r) => r.child === 'Tanvi Rao')).toEqual({ child: 'Tanvi Rao', marks: ['partly', 'got'], needs: ['no phone or internet at home'] });
    expect(view.rows.find((r) => r.child === 'Diya Sharma')).toEqual({ child: 'Diya Sharma', marks: [undefined, 'got'], needs: [] });
  });

  it('forgetting the class takes the marks, the needs and the adjustments out of a saved lesson', () => {
    const l = withoutClass({ ...saved(SAMPLE_TICKET), needs: [{ letter: 'A', line: 'x', children: ['s1'] }] });
    expect(l.after).toEqual({ stages: ['done'], line: '', at: '2026-11-21T10:00:00.000Z' });
    expect(l.needs).toBeUndefined();
    expect(l.adjustments).toEqual([]);
    expect(l.stages).toHaveLength(1);
  });
});
