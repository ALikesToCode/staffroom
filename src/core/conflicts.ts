import type { Constraint, DraftItem, Entity, ItemCheck } from './types';
import { escapeRe, sentences } from './rules';
import { steps, studentsNamed } from './items';
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
  /**
   * Where the step stands, when the item says: the homework of a lesson is done at home, and the other
   * stages of a lesson are taught in class. Left out for a step that could be either.
   */
  stage?: 'homework' | 'class';
}

const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}])';
const words = (alternatives: string[]) => new RegExp(`${BEFORE}(?:${alternatives.join('|')})${AFTER}`, 'giu');

/** Words that turn a step round when they stand just before the matched words in the same clause. */
const NEGATION = words([
  'no need to',
  'instead of',
  'rather than',
  'in place of',
  'free of',
  'without',
  'do not',
  'does not',
  'should not',
  'must not',
  'need not',
  'will not',
  "[\\p{L}]+n't",
  'cannot',
  'never',
  'avoid',
  'avoids',
  'avoiding',
  'not',
  'no',
]);

const CLAUSE_BREAK = /[,;:.!?()–—]|\sbut\s|\sso\s|\sthen\s/giu;

/**
 * How many words may stand between a negation and the words it turns round, small words not counted:
 * "do not ask him to come before school" has two, "ask" and "come".
 */
const NEGATION_REACH = 3;
const SMALL = /^(?:to|the|a|an|for|of|in|at|on|by|any|be|him|her|them|it|his|their|your|its)$/iu;
/** These stand before a thing: "without a phone". Followed at once by a verb they stand alone: "those without can buy a kit". */
const BEFORE_A_THING = /^(?:without|instead of|rather than|in place of|free of)$/iu;
const VERB_NEXT = /^(?:can|could|may|might|must|should|will|would|is|are|was|were|do|does|did|have|has|had|need|needs)$/iu;
/** "has not finished": the negation is spent on the next word. What follows ("stays after school") stands. */
const PERFECT = /(?:^|\s)(?:(?:has|have|had)\s+not|hasn't|haven't|hadn't)$/iu;

/**
 * True when the words at `index` are negated: a negation stands before
 * them in the same clause and governs them. It governs what follows it
 * within a few words. It does not reach across a clause, and a "not"
 * earlier in the clause that belongs to other words does not count:
 * "anyone who has not finished stays after school" is not negated.
 */
export function negated(step: string, index: number): boolean {
  const before = step.slice(0, index);
  const breaks = [...before.matchAll(CLAUSE_BREAK)];
  const start = (k: number) => (k >= 0 ? breaks[k].index + breaks[k][0].length : 0);
  if (governs(before.slice(start(breaks.length - 1)))) return true;
  // A list after a negation: "no phone, internet, or purchased items". The negation before the first item governs
  // every later item, each one or two words after a comma (perhaps after "or", "and" or "nor"). The words matched must
  // stand in such a list: after "or"/"and"/"nor", or with a comma just after them. "If you have no pen, buy one" is no list.
  const last = before.slice(start(breaks.length - 1));
  if (!LIST_JOIN.test(last) && !/^\S+(?:\s+\S+)?\s*,/u.test(step.slice(index))) return false;
  let end = before.length;
  for (let k = breaks.length - 1, items = 0; k >= 0 && items < LIST_ITEMS; k--, items++) {
    if (breaks[k][0] !== ',') return false;
    const item = before.slice(start(k), end).replace(LIST_JOIN, '').trim().split(/\s+/).filter((w) => w && !SMALL.test(w));
    if (item.length > 2) return false;
    end = breaks[k].index;
    if (governs(before.slice(start(k - 1), end), true)) return true;
  }
  return false;
}

const LIST_JOIN = /^\s*(?:or|and|nor)\s+/iu;
const LIST_NEGATION = /^(?:no|without|free of|instead of|rather than|in place of)$/iu;

/** The most items of a list one negation reaches across commas. */
const LIST_ITEMS = 4;

/** True when a negation in `clause` governs the words at its end (or, for a list item, the item that ends it). */
function governs(clause: string, item = false): boolean {
  for (const n of clause.matchAll(NEGATION)) {
    const end = n.index + n[0].length;
    const between = clause.slice(end).trim().split(/\s+/).filter(Boolean);
    const counted = between.filter((w) => !SMALL.test(w)).length;
    if (counted > (item ? 2 : NEGATION_REACH)) continue;
    // Across a list only a negation that stands before things reaches: "no phone, internet, or …", not "do not rush her, and …".
    if (item && !LIST_NEGATION.test(n[0])) continue;
    if (BEFORE_A_THING.test(n[0]) && between.length > 0 && VERB_NEXT.test(between[0])) continue;
    if (PERFECT.test(clause.slice(0, end)) && counted > 1) continue;
    return true;
  }
  return false;
}

/** The first place one of the alternatives stands in the step as whole words and is not negated. `accept` can pass a match over. */
function firstMatch(step: string, alternatives: string[], accept?: (m: RegExpMatchArray) => boolean): RegExpMatchArray | undefined {
  if (alternatives.length === 0) return undefined;
  for (const m of step.matchAll(words(alternatives))) if (!negated(step, m.index) && (!accept || accept(m))) return m;
  return undefined;
}

/** The clause the words at `index` stand in: from the last clause break before them to the next one after. */
function clauseAt(step: string, index: number, length: number): string {
  let from = 0;
  for (const m of step.slice(0, index).matchAll(CLAUSE_BREAK)) from = m.index + m[0].length;
  const rest = step.slice(index + length);
  const next = [...rest.matchAll(CLAUSE_BREAK)][0];
  return step.slice(from, next ? index + length + next.index : step.length);
}

const has = (re: RegExp, text: string) => {
  re.lastIndex = 0;
  return re.test(text);
};

/** As `firstMatch`, for a time of day: a clause that says "at home" or "from home" is passed over. */
function firstAtSchool(step: string, alternatives: string[], needs?: RegExp): RegExpMatchArray | undefined {
  if (alternatives.length === 0) return undefined;
  for (const m of step.matchAll(words(alternatives))) {
    if (negated(step, m.index)) continue;
    const clause = clauseAt(step, m.index, m[0].length);
    if (has(AT_HOME, clause)) continue;
    if (needs && !has(needs, clause)) continue;
    return m;
  }
  return undefined;
}

const TIME_AFTER = [
  'after[- ]school',
  'afterschool',
  'after (?:the )?(?:last|final) bell',
  'after (?:the )?class(?:es)?',
  'after lessons',
  'stay(?:s|ing|ed)? (?:back|late|behind|on)',
  'detentions?',
  'after hours',
  'after dismissal',
  '(?:once|when) school (?:is over|ends|finishes)',
];

/**
 * An evening is after the last bell only when the same clause puts it at school: "evening class",
 * "evening club", "stay for the evening study hour". "Write a few sentences every evening" is at home.
 */
const EVENING = ['evenings?'];
const SCHOOL_SIDE = words(['class(?:es)?', 'clubs?', 'sessions?', 'tuitions?', 'practices?', 'stay(?:s|ing|ed)?', '(?:at|in) school']);

/** A step done at home is not at school, before the first bell or after the last. */
const AT_HOME = words(['at home', 'from home']);

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
  // "Contribute an idea" is no payment: the word counts with money, a sum or a cost after it.
  'contribut(?:e|es|ed|ing|ion|ions)(?=\\s+(?:[\\p{L}]+\\s+){0,3}?(?:towards|rupees?|rs\\.?|₹|money|\\d|cost|costs|fund|funds))',
  // To order is to buy only with a thing to buy or a place to buy it from. "Spatial order", "in order", "word order" are not.
  'plac(?:e|es|ed|ing)\\s+an\\s+order',
  'order(?:s|ed|ing)?\\s+(?:a|an|some|one|two|three|\\d+)\\s+(?:[\\p{L}-]+\\s+){0,3}?(?:kits?|books?|cop(?:y|ies)|sets?|workbooks?|readers?|packs?|uniforms?)',
  'order(?:s|ed|ing)?\\s+(?:[\\p{L}-]+\\s+){1,4}?(?:online|from\\s+(?:the|a|an)\\s+(?:shop|store|market|website|supplier|publisher|catalogue))',
  // Things a family is usually asked to pay for. A step that lends one is flagged too: the rule cannot tell.
  'workbooks?',
  'uniforms?',
  'kits?',
  'tuitions?',
];

/**
 * Buying as the thing studied, not a thing asked for: "name items bought from nearby shops", "find out
 * what people buy at the market". The step asks pupils to look at buying (STUDY), the buying is spoken of
 * and not asked for (ABOUT_BUYING before the word, or "buying and selling"), and nobody is told to buy.
 */
const BUY_WORD = /^(?:buy|buys|buying|bought)$/iu;
const STUDY = words([
  'observ(?:e|es|ed|ing)',
  'list(?:s|ed|ing)?',
  'nam(?:e|es|ed|ing)',
  'surveys?',
  'questionnaires?',
  'interview(?:s|ed|ing)?',
  'discuss(?:es|ed|ing)?',
  'role-?plays?',
  'writ(?:e|es|ing) (?:down|about)',
  'record(?:s|ed|ing)?',
  'find(?:s|ing)? out',
  'ask(?:s|ed|ing)?',
  'talk(?:s|ed|ing)? about',
  'shar(?:e|es|ed|ing)',
  'tall(?:y|ies|ied)',
  'call(?:s|ing)? out',
]);
const ABOUT_BUYING =
  /(?:(?:what|which|where|why|how\s+(?:much|many|often))\s+(?:[\p{L}]+\s+){0,3}|(?:items?|things?|goods|products?|foods?|vegetables|fruits?)\s+(?:(?:that|which)\s+)?(?:[\p{L}]+\s+){0,2}|about\s+)$/iu;
const TOLD_TO_BUY = /(?:must|should|needs?\s+to|has\s+to|have\s+to|will|to)\s+$/iu;

function buyingStudied(step: string, m: RegExpMatchArray): boolean {
  if (!BUY_WORD.test(m[0]) || !has(STUDY, step)) return false;
  const before = step.slice(0, m.index);
  if (/^buying\s+and\s+selling/iu.test(step.slice(m.index))) return true;
  return ABOUT_BUYING.test(before) && !TOLD_TO_BUY.test(before);
}

/** Things a family has to find and send in. The words after "bring" are kept in the match, so that what is brought can be read. */
const BRING = [
  "bring(?:s|ing)?\\s+(?:[\\p{L}\\p{N}'-]+\\s+){1,6}?from\\s+home",
  'bring(?:s|ing)?\\s+(?:your|their|his|her|its)\\s+own(?:\\s+[\\p{L}-]+){0,3}',
  '(?:each|every)\\s+(?:pupil|child|student|learner|group|pair)\\s+(?:brings|(?:needs|has|is)\\s+to\\s+bring|must\\s+bring|should\\s+bring)(?:\\s+[\\p{L}\\p{N}-]+){0,4}',
];
/** What every pupil brings to school anyway. */
const SCHOOL_THINGS = words(['notebooks?', 'textbooks?', 'homework', 'pens?', 'pencils?']);

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
  'e-?mail(?:s|ed|ing)?',
  'messaging apps?',
  'download(?:s|ed|ing)?',
];

/** Words that put a step at home, or with the family. */
const HOME_SIDE = words([
  'home',
  'homework',
  'tonight',
  'this evening',
  'evenings?',
  '(?:over|at|on|for) the weekend',
  'after school',
  'famil(?:y|ies)',
  'parents?',
  'mothers?',
  'fathers?',
  'guardians?',
]);
/** Words that put a phone or the internet at school, in the teacher's hands or on a device the school has. */
const SCHOOL_DEVICE = words([
  'in (?:the )?class(?:room)?',
  '(?:at|in) school',
  '(?:computer|ict|it) (?:lab|room|suite)s?',
  'shared (?:device|computer|tablet|laptop|phone|screen)s?',
  "(?:school|class|classroom)(?:'s)? (?:device|computer|tablet|laptop|projector|phone|screen)s?",
  'projectors?',
  'smart ?boards?',
  "teacher(?:'s)? (?:own )?(?:phone|mobile|laptop|device|computer|tablet)",
  'teacher (?:shows|plays|projects|displays|screens)',
  'on the board',
]);
/** These reach the family at home whatever else the step says. */
const TO_THE_FAMILY = /^(?:whatsapp|call(?:s|ing)? home)$/iu;

const CONTACT_VERBS =
  '(?:phone|phones|phoning|call|calls|calling|telephone|telephones|ring|rings|meet|meets|meeting|invite|invites|inviting|message|messages|contact|contacts|write to|writes to|writing to|speak to|speak with|talk to|talk with|send|sends|ask|asks|tell|tells|inform|informs|informing|notify|notifies|notifying|e-?mail|e-?mails|e-?mailing|text(?:s|ing)?(?=\\s+(?:his|her|their|[\\p{L}]+[\u2019\u0027]s)\\s)|visit|visits|note to|note for|letter to|letter for)';

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
      const m = firstAtSchool(step, TIME_AFTER) ?? firstAtSchool(step, EVENING, SCHOOL_SIDE);
      if (m) {
        const said = m[0].toLowerCase();
        return hit(m[0], said.startsWith('after ') ? `This step keeps ${name} ${said}.` : `This step keeps ${name} at school after the last bell (${quote(m[0])}).`);
      }
      const club = firstAtSchool(step, activityForms(context.afterBell ?? []));
      if (club) return hit(club[0], `This step sends ${name} to the ${club[0].toLowerCase()}, which your note says meets after the last bell.`);
      return undefined;
    }
    case 'time-before': {
      const m = firstAtSchool(step, TIME_BEFORE);
      return m ? hit(m[0], `This step needs ${name} at school before the first bell (${quote(m[0])}).`) : undefined;
    }
    case 'days-away': {
      const m = firstMatch(step, (c.days ?? []).map((d) => `${d}s?`));
      return m ? hit(m[0], `This step is set for ${m[0]}, a day ${name} is away.`) : undefined;
    }
    case 'money': {
      const m = firstMatch(step, MONEY, (x) => !buyingStudied(step, x));
      if (m) return hit(m[0], `This step asks the family of ${name} to pay for something (${quote(m[0])}).`);
      const b = firstMatch(step, BRING, (x) => !has(SCHOOL_THINGS, x[0]));
      return b ? hit(b[0], `This step asks the family of ${name} to provide something (${quote(b[0])}).`) : undefined;
    }
    case 'no-phone-internet': {
      // The constraint is about home. A phone or the internet used in class, on a device the school has, is no conflict.
      const home = has(HOME_SIDE, step);
      const school = has(SCHOOL_DEVICE, step) || context.stage === 'class';
      let query: RuleHit | undefined;
      for (const m of step.matchAll(words(PHONE_INTERNET))) {
        if (negated(step, m.index)) continue;
        if (home || TO_THE_FAMILY.test(m[0]) || (!school && context.stage === 'homework')) {
          return hit(m[0], `This step needs a phone or the internet, which ${name} does not have at home (${quote(m[0])}).`);
        }
        if (school) continue;
        query ??= hit(
          m[0],
          `This step uses a phone or the internet (${quote(m[0])}). The rule cannot tell whether that is at school or at home, where ${name} has none. Read it against the constraint.`,
          'unsure',
        );
      }
      return query;
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

/**
 * Where an item's steps are done, by its heading: an item headed "Homework" is done at home, and any
 * other stage of a lesson is taught in class. An item of another task that is not homework could be either.
 */
export function stageOf(item: DraftItem, lesson: boolean): RuleContext['stage'] {
  if (/^\s*home\s?work(?![\p{L}])/iu.test(item.heading)) return 'homework';
  return lesson ? 'class' : undefined;
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
 * student the item names, any constraint when the item names nobody (so
 * whole-class wording counts only then), and any constraint about the class. A conflict
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
  /** True for a step of a lesson: it is for the whole class, whoever it names, so every confirmed constraint is compared. */
  wholeClass = false,
): RuleCheck {
  const named = studentsNamed(item, entities).map((e) => e.id);
  // An item that names a student is about that student, though it speaks of classmates or peers.
  const everyone = wholeClass || named.length === 0;
  const applies = constraints.filter((c) => c.confirmed && (!c.about || everyone || named.includes(c.about)));
  if (applies.length === 0) return { compared: 0 };
  const afterBell = afterBellActivities(note);
  const stage = stageOf(item, wholeClass);
  const parts = [restore(item.heading, entities, allowed), ...steps(restore(item.text, entities, allowed))];
  let found: RuleHit | undefined;
  for (const step of parts) {
    for (const c of applies) {
      const student = entities.find((e) => e.id === c.about);
      const name = student ? nameInNote(note, student) : undefined;
      const line = told.get(c.id);
      const said = ruleConflicts(step, c, { name, afterBell, told: line !== undefined, stage });
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

/** One step of an item that a rule found against one confirmed constraint. */
export interface StepHit {
  /** Which step of the item, counted from 0 among its steps as the teacher reads them. -1: the heading. */
  stepIndex: number;
  /** The step, names put back. */
  step: string;
  constraint: Constraint;
  hit: RuleHit;
}

/**
 * Every rule hit in one item of a draft: each step against each confirmed
 * constraint, not only the first found. For a lesson, where a step is for
 * the whole class and may be wrong for several children at once. Every
 * confirmed constraint is compared, whoever the item names.
 */
export function ruleHitsForItem(
  item: DraftItem,
  constraints: Constraint[],
  entities: Entity[],
  allowed: readonly string[],
  note: string,
  told: ReadonlyMap<string, string> = new Map(),
): StepHit[] {
  const applies = constraints.filter((c) => c.confirmed);
  if (applies.length === 0) return [];
  const afterBell = afterBellActivities(note);
  const stage = stageOf(item, true);
  const parts = [restore(item.heading, entities, allowed), ...steps(restore(item.text, entities, allowed).trim())];
  const out: StepHit[] = [];
  parts.forEach((step, i) => {
    for (const c of applies) {
      const student = entities.find((e) => e.id === c.about);
      const line = told.get(c.id);
      const said = ruleConflicts(step, c, { name: student ? nameInNote(note, student) : undefined, afterBell, told: line !== undefined, stage });
      if (said) out.push({ stepIndex: i - 1, step, constraint: c, hit: line === undefined ? said : { ...said, told: line } });
    }
  });
  return out;
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
