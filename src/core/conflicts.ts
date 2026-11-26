import type { Constraint, DraftItem, Entity, ItemCheck } from './types';
import { escapeRe, sentences } from './rules';
import { speaksToClass, steps, studentsNamed } from './items';
import { redactRange, restore } from './vault';

// The first layer of the check: plain rules, on the device, no model. A step of the draft is compared
// with a constraint the teacher confirmed. A rule knows the words listed here and nothing else.

/** What a rule found in one step. `unsure`: the words are there, but the rule cannot tell that they go against the constraint. */
export interface RuleHit {
  verdict: 'conflict' | 'unsure';
  by: 'rule';
  constraintId: string;
  /** The words of the step that the rule matched. */
  matched: string;
  reason: string;
  /** The sentences of the outgoing text around the constraint, as the cloud saw them. */
  cloudSaw?: string;
  /** The need line the cloud was told for this constraint, when it was told one. */
  told?: string;
}

export interface RuleContext {
  /** The student's name, for the reason. */
  name?: string;
  /** Things the note itself says meet after the last bell ("remedial writing club"). */
  afterBell?: string[];
  /** Whether the cloud was told this constraint as a need. Said in the reason when given. */
  told?: boolean;
}

const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}])';
const words = (alternatives: string[]) => new RegExp(`${BEFORE}(?:${alternatives.join('|')})${AFTER}`, 'giu');

/** Words that turn a step round when they stand before the matched words in the same clause. */
const NEGATION = words([
  'without',
  'instead of',
  'rather than',
  'in place of',
  'do not',
  "don't",
  'does not',
  "doesn't",
  'should not',
  "shouldn't",
  'must not',
  "mustn't",
  'need not',
  "needn't",
  'cannot',
  "can't",
  'will not',
  "won't",
  'never',
  'avoid',
  'avoids',
  'avoiding',
  'no need to',
  'not',
  'no',
  'free of',
]);

const CLAUSE_BREAK = /[,;:.!?()–—]|\sbut\s|\sso\s|\sthen\s/giu;

/** True when the words at `index` are negated: a negation stands before them in the same clause. */
export function negated(step: string, index: number): boolean {
  const before = step.slice(0, index);
  let from = 0;
  for (const m of before.matchAll(CLAUSE_BREAK)) from = m.index + m[0].length;
  NEGATION.lastIndex = 0;
  return NEGATION.test(before.slice(from));
}

/** The first place one of the alternatives stands in the step as whole words and is not negated. */
function firstMatch(step: string, alternatives: string[]): RegExpMatchArray | undefined {
  if (alternatives.length === 0) return undefined;
  for (const m of step.matchAll(words(alternatives))) if (!negated(step, m.index)) return m;
  return undefined;
}

const TIME_AFTER = [
  'after[- ]school',
  'afterschool',
  'after (?:the )?(?:last|final) bell',
  'after (?:the )?class(?:es)?',
  'after lessons',
  'stay(?:s|ing|ed)? (?:back|late|behind|on)',
  'evenings?',
  'detentions?',
  'after hours',
  'after dismissal',
  '(?:once|when) school (?:is over|ends|finishes)',
];

const TIME_BEFORE = [
  'before[- ]school',
  'before (?:the )?first bell',
  'before lessons',
  'early morning',
  '(?:come|comes|coming|arrive|arrives|arriving)(?: in| to school)? early',
  'zero period',
  'morning assembly duty',
];

const MONEY = [
  'buy(?:s|ing)?',
  'bought',
  'purchas(?:e|es|ed|ing)',
  'pay(?:s|ing)?(?! attention)',
  'paid',
  'fees?',
  'rupees?',
  'rs\\.?',
  '₹\\s?[\\d,]*',
  'costs?',
  'bring(?:s|ing)? (?:in )?(?:some |the )?money',
  'donat(?:e|es|ed|ing|ion|ions)',
  '(?<!in )order(?:s|ed|ing)?(?! of)',
  // Things a family is usually asked to pay for. A step that lends one is flagged too: the rule cannot tell.
  'workbooks?',
  'uniforms?',
  'kits?',
  'tuitions?',
];

const PHONE_INTERNET = [
  'online',
  'internet',
  'videos?',
  'video calls?',
  'apps?',
  'whatsapp',
  'websites?',
  'youtube',
  'google',
  '(?:smart|mobile )?phones?',
  'smartphones?',
  'mobiles?',
  'call(?:s|ing)? home',
  'sms',
  'text messages?',
  'e-?mails?',
  'download(?:s|ed|ing)?',
];

const CONTACT_VERBS =
  '(?:phone|phones|phoning|call|calls|calling|telephone|telephones|ring|rings|meet|meets|meeting|invite|invites|inviting|message|messages|contact|contacts|write to|writes to|writing to|speak to|speak with|talk to|talk with|send|sends|ask|asks|tell|tells|inform|informs|visit|visits|note to|note for|letter to|letter for)';

const ROLE_FORMS: Record<string, string[]> = {
  father: ['father', 'dad', 'daddy', 'papa'],
  mother: ['mother', 'mum', 'mummy', 'mom', 'amma'],
};
const PARENTS = ['both parents', 'mother and father', 'father and mother', 'parents'];
const formsOf = (who: string) => ROLE_FORMS[who] ?? [`${escapeRe(who)}s?`];

const STOP = new Set(['the', 'a', 'an', 'and', 'but', 'or', 'our', 'that', 'because', 'as', 'since', 'so', 'when', 'while', 'if', 'then']);

/**
 * What the note itself says meets after the last bell: "the remedial
 * writing club meets after the last bell" gives "remedial writing club".
 * A step that names it is a step after the last bell.
 */
export function afterBellActivities(note: string): string[] {
  const out: string[] = [];
  const re = /((?:[\p{L}-]+\s+){1,5})(?:meets?|runs?|is held|are held|takes place|happens|is|are)\s+after\s+(?:the\s+)?(?:last bell|final bell|school|class(?:es)?)/giu;
  for (const m of note.matchAll(re)) {
    const before = m[1].trim().split(/\s+/);
    const name: string[] = [];
    for (let i = before.length - 1; i >= 0 && name.length < 4; i--) {
      if (STOP.has(before[i].toLowerCase())) break;
      name.unshift(before[i]);
    }
    if (name.length > 0) out.push(name.join(' ').toLowerCase());
  }
  return [...new Set(out)];
}

/** The ways a step may name such an activity: in full, or by its last two words when it has three or more. */
function activityForms(names: string[]): string[] {
  return names.flatMap((name) => {
    const parts = name.split(' ');
    const forms = [parts.map(escapeRe).join('\\s+')];
    if (parts.length >= 3) forms.push(parts.slice(-2).map(escapeRe).join('\\s+'));
    return forms;
  });
}

/** Said of a rule hit on a constraint whose need the cloud was told, and on one it was not. The cloud can ignore a need. */
export const TOLD = 'The cloud was told this need and the step still goes against it.';
export const NOT_TOLD = 'The cloud was not told this.';

const quote = (text: string) => `“${text}”`;

/**
 * Layer A of the check. Does this step go against this constraint, by the
 * words of the step alone? Whole words, any case. A negation before the
 * words in the same clause ("without attending the after-school club",
 * "instead of", "do not") means no conflict. `other` has no rule.
 */
export function ruleConflicts(step: string, c: Constraint, context: RuleContext = {}): RuleHit | undefined {
  const name = context.name ?? 'a child';
  const hit = (matched: string, says: string, verdict: RuleHit['verdict'] = 'conflict'): RuleHit => ({
    verdict,
    by: 'rule',
    constraintId: c.id,
    matched,
    reason: `${says} You confirmed: ${quote(c.text)}.${context.told === undefined ? '' : context.told ? ` ${TOLD}` : ` ${NOT_TOLD}`}`,
  });
  switch (c.kind) {
    case 'time-after': {
      const m = firstMatch(step, TIME_AFTER);
      if (m) {
        const said = m[0].toLowerCase();
        return hit(m[0], said.startsWith('after ') ? `This step keeps ${name} ${said}.` : `This step keeps ${name} at school after the last bell (${quote(m[0])}).`);
      }
      const club = firstMatch(step, activityForms(context.afterBell ?? []));
      if (club) return hit(club[0], `This step sends ${name} to the ${club[0].toLowerCase()}, which your note says meets after the last bell.`);
      return undefined;
    }
    case 'time-before': {
      const m = firstMatch(step, TIME_BEFORE);
      return m ? hit(m[0], `This step needs ${name} at school before the first bell (${quote(m[0])}).`) : undefined;
    }
    case 'days-away': {
      const m = firstMatch(step, (c.days ?? []).map((d) => `${d}s?`));
      return m ? hit(m[0], `This step is set for ${m[0]}, a day ${name} is away.`) : undefined;
    }
    case 'money': {
      const m = firstMatch(step, MONEY);
      return m ? hit(m[0], `This step asks the family of ${name} to pay for something (${quote(m[0])}).`) : undefined;
    }
    case 'no-phone-internet': {
      const m = firstMatch(step, PHONE_INTERNET);
      return m ? hit(m[0], `This step needs a phone or the internet, which ${name} does not have at home (${quote(m[0])}).`) : undefined;
    }
    case 'contact': {
      if (c.away && c.who) {
        // The adult is not there. A step addressed to that adult, or to the parents together, cannot be followed.
        const excluded = c.who === 'parents' ? [...PARENTS, ...ROLE_FORMS.father, ...ROLE_FORMS.mother] : [...PARENTS, ...formsOf(c.who)];
        const m = firstMatch(step, excluded);
        const notThere = `${name}'s ${c.who} ${c.who === 'parents' ? 'are' : 'is'} not there to ask`;
        return m ? hit(m[0], `This step speaks to ${quote(m[0])}, and ${notThere}.`) : undefined;
      }
      // The verb and the adult stand in one clause: "speak to his mother, and do not contact his father" is two.
      const reach = (roles: string[]) => firstMatch(step, [`${CONTACT_VERBS}${AFTER}[^.;!?,]{0,60}?${BEFORE}(?:${roles.join('|')})`]);
      const named = c.who === 'parents' ? [...PARENTS, ...ROLE_FORMS.father, ...ROLE_FORMS.mother] : c.who ? formsOf(c.who) : [];
      const m = named.length > 0 ? reach(named) : undefined;
      if (m) return hit(m[0], `This step has someone contact the ${c.who} of ${name} (${quote(m[0])}).`);
      // One parent is not to be contacted, and the step speaks of the parents: the rule cannot tell which.
      const both = reach(c.who ? PARENTS : [...PARENTS, ...ROLE_FORMS.father, ...ROLE_FORMS.mother]);
      return both ? hit(both[0], `This step contacts the parents of ${name} (${quote(both[0])}). Read it against the constraint.`, 'unsure') : undefined;
    }
    case 'health': {
      const m = firstMatch(step, (c.triggers ?? []).map((t) => `${t.trim().split(/\s+/).map(escapeRe).join('\\s+')}(?:s|es)?`));
      return m ? hit(m[0], `This step involves ${quote(m[0])}, which goes against a health constraint for ${name}.`) : undefined;
    }
    default:
      return undefined;
  }
}

/** What the rules found for one item: the hit, if any, and how many confirmed constraints its steps were compared with. */
export interface RuleCheck {
  hit?: RuleHit;
  compared: number;
}

/** The sentences of the outgoing text that hold the constraint's words, as the cloud saw them. */
export function cloudSawAround(note: string, entities: Entity[], c: Constraint): string | undefined {
  if (c.at === undefined || note.slice(c.at, c.at + c.text.length) !== c.text) return undefined;
  const end = c.at + c.text.length;
  const around = sentences(note).filter((s) => s.start < end && c.at! < s.end);
  if (around.length === 0) return undefined;
  return redactRange(note, entities, around[0].start, around[around.length - 1].end);
}

/**
 * Layer A for one item of the draft. Its heading and each of its steps are
 * compared with every confirmed constraint that applies to it: one about a
 * student the item names, any constraint when the item speaks to the whole
 * class or names nobody, and any constraint about the class. A conflict
 * wins over a query; otherwise the first found is kept.
 */
export function ruleCheckItem(
  item: DraftItem,
  constraints: Constraint[],
  entities: Entity[],
  allowed: readonly string[],
  note: string,
  /** The need lines that were sent, by constraint id. The step is compared with every confirmed constraint, told or not. */
  told: ReadonlyMap<string, string> = new Map(),
): RuleCheck {
  const named = studentsNamed(item, entities).map((e) => e.id);
  const everyone = named.length === 0 || speaksToClass(`${item.heading} ${item.text}`);
  const applies = constraints.filter((c) => c.confirmed && (!c.about || everyone || named.includes(c.about)));
  if (applies.length === 0) return { compared: 0 };
  const afterBell = afterBellActivities(note);
  const parts = [restore(item.heading, entities, allowed), ...steps(restore(item.text, entities, allowed))];
  let found: RuleHit | undefined;
  for (const step of parts) {
    for (const c of applies) {
      const student = entities.find((e) => e.id === c.about);
      const name = student ? nameInNote(note, student) : undefined;
      const line = told.get(c.id);
      const said = ruleConflicts(step, c, { name, afterBell, told: line !== undefined });
      if (!said) continue;
      const hit = line === undefined ? said : { ...said, told: line };
      if (hit.verdict === 'conflict') {
        const cloudSaw = cloudSawAround(note, entities, c);
        return { hit: cloudSaw ? { ...hit, cloudSaw } : hit, compared: applies.length };
      }
      found ??= hit;
    }
  }
  return found ? { hit: found, compared: applies.length } : { compared: applies.length };
}

/** The student's name as the teacher first wrote it in the note: "Meenal", though the class list says "Meenal Joshi". */
export function nameInNote(note: string, student: Entity): string {
  const found = student.surfaces
    .map((s) => ({ s, at: note.search(new RegExp(`${BEFORE}${escapeRe(s)}${AFTER}`, 'u')) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at || b.s.length - a.s.length);
  return found[0]?.s ?? student.surfaces[0];
}

/** The reason shown for an item that the rules alone checked. */
export function ruleOnlyReason(compared: number): string {
  return `Checked by rule against ${compared} confirmed ${compared === 1 ? 'constraint' : 'constraints'}. The on-device model was not available for a wider check.`;
}

/**
 * Put the two layers together for one item.
 *
 * - A rule conflict is a conflict, whatever the model said. The rule's reason is shown first.
 * - With no rule hit, the model's answer stands. The model alone never makes a conflict: its "no" is a doubt.
 * - With no answer from the model, an item the rules compared with at least one confirmed constraint is
 *   "checked by rule only". An item they compared with none keeps `unchecked`, the verdict the caller gives
 *   for an item nothing looked at.
 */
export function combineChecks(rule: RuleCheck, model: ItemCheck | undefined, unchecked: ItemCheck): ItemCheck {
  const answered = model && model.verdict !== 'not checked' ? model : undefined;
  const doubt = answered?.verdict === 'unsure' && answered.by === 'model' ? answered.reason : undefined;
  if (rule.hit) {
    const { verdict, constraintId, matched, reason, cloudSaw, told } = rule.hit;
    return {
      verdict,
      reason,
      by: doubt ? 'both' : 'rule',
      constraintId,
      matched,
      ...(cloudSaw ? { cloudSaw } : {}),
      ...(told ? { told } : {}),
      ...(doubt ? { also: doubt } : {}),
      rules: rule.compared,
    };
  }
  if (answered) return { ...answered, by: answered.by ?? 'none', rules: rule.compared };
  if (rule.compared > 0) return { verdict: 'not checked', reason: ruleOnlyReason(rule.compared), by: 'none', rules: rule.compared };
  return model ?? unchecked;
}

/** The heading over an item's verdict. */
export function verdictLabel(c: ItemCheck): string {
  switch (c.verdict) {
    case 'conflict':
      return c.by === 'rule' || c.by === 'both' ? 'Conflicts with a constraint you confirmed' : 'Conflicts with what you know';
    case 'unsure':
      return c.by === 'model' ? 'The on-device model doubts this' : 'Think before using';
    case 'fits':
      return 'No conflict found';
    case 'nothing withheld':
      return 'Nothing to check';
    default:
      return (c.rules ?? 0) > 0 ? 'Checked by rule only' : 'Not checked';
  }
}

/** The two counts a receipt keeps of how the layers answered: conflicts a rule found, and doubts only the model had. */
export function layerCounts(checks: ItemCheck[]): { conflictsByRule: number; doubtsByModel: number } {
  return {
    conflictsByRule: checks.filter((c) => c.verdict === 'conflict' && (c.by === 'rule' || c.by === 'both')).length,
    doubtsByModel: checks.filter((c) => c.verdict === 'unsure' && c.by === 'model').length,
  };
}
