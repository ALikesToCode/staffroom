import type { DraftItem, Entity, ItemCheck } from '../core/types';
import { restore } from '../core/vault';
import { paragraphs } from './guard';
import { modelFor } from './routes';

const SYSTEM = `You check advice for a teacher. The advice was written by a planner who did not know the private facts about the child. You know them. Decide whether the advice still makes sense for this child.

verdict "fits": the advice is sensible given the private facts, or does not touch them.
verdict "conflict": the advice would be unkind, unsafe or impossible for this child given the private facts.
verdict "unsure": the advice touches on the private facts and the teacher should think before using it.

Most advice fits. Choose "fits" unless you can point to one private fact that the advice runs against. A hard home life alone is not a reason to doubt kind, ordinary advice.
Choose "conflict" only when a fact makes the advice impossible or harmful as written: for example, advice to stay after school for a child who must leave early, or advice to phone a parent who is not at home.
Judge only the child named in "Private facts about". Do not judge the advice for other children.

reason is one short sentence for the teacher. Name the private fact that matters.`;

const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['fits', 'conflict', 'unsure'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
};

/** The private details that bear on one draft item: those about any student the item names. */
export function detailsFor(item: DraftItem, entities: Entity[]): { student: Entity; details: Entity[] }[] {
  const text = `${item.heading} ${item.text}`;
  return entities
    .filter((e) => e.kind === 'student' && text.includes(e.token))
    .map((student) => ({
      student,
      details: entities.filter((d) => d.kind === 'private' && d.withheld && d.about === student.id),
    }))
    .filter((x) => x.details.length > 0);
}

/**
 * Check each draft item against what was withheld. The route is
 * ONLY_ON_DEVICE: the withheld details are in this prompt, so it must not
 * go to the cloud. modelFor refuses to start without an on-device model, and
 * a response from anywhere but the device stops the check.
 */
export async function checkOnDevice(
  note: string,
  items: DraftItem[],
  entities: Entity[],
  onProgress: (done: number, total: number) => void,
): Promise<ItemCheck[]> {
  const model = modelFor('check', { system: SYSTEM, schema: SCHEMA });
  const paras = paragraphs(note);
  const checks: ItemCheck[] = [];
  for (let i = 0; i < items.length; i++) {
    onProgress(i, items.length);
    const relevant = detailsFor(items[i], entities);
    if (relevant.length === 0) {
      checks.push({ verdict: 'nothing withheld', reason: 'No private detail was withheld about anyone in this item.' });
      continue;
    }
    let worst: ItemCheck = { verdict: 'fits', reason: '' };
    for (const { student, details } of relevant) {
      const name = student.surfaces[0];
      const context = paras.filter((p) => student.surfaces.some((s) => p.toLowerCase().includes(s.toLowerCase())));
      const prompt = [
        `Private facts about ${name}:`,
        ...details.map((d) => `- ${d.surfaces[0]}`),
        '',
        `What the teacher wrote about ${name}:`,
        context.join('\n'),
        '',
        'Advice to check:',
        restore(`${items[i].heading}. ${items[i].text}`, entities),
      ].join('\n');
      const result = await model.generateContent(prompt);
      if (result.response.inferenceSource !== 'on_device') {
        throw new Error('The check did not run on the device. Stopped.');
      }
      let answer: ItemCheck;
      try {
        const parsed = JSON.parse(result.response.text()) as { verdict?: string; reason?: string };
        const verdict = parsed.verdict === 'conflict' || parsed.verdict === 'unsure' ? parsed.verdict : 'fits';
        answer = { verdict, reason: String(parsed.reason ?? '') };
      } catch {
        answer = { verdict: 'unsure', reason: 'The on-device check gave no clear answer. Read this item yourself.' };
      }
      if (rank(answer) > rank(worst) || !worst.reason) worst = answer;
    }
    checks.push(worst);
  }
  onProgress(items.length, items.length);
  return checks;
}

const rank = (c: ItemCheck) => (c.verdict === 'conflict' ? 2 : c.verdict === 'unsure' ? 1 : 0);
