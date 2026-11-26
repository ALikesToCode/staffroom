import type { ConstraintKind } from '../core/types';

// A set for the guard: what the on-device model adds to the rules when it reads a raw note. Twelve fresh
// class notes, invented, in an Indian school, written for this set and copied from no other. Every private
// detail and every harmless span is labelled here, word for word, and so is every kind of constraint each
// note gives. The labels were written before the set was run.

/** What a labelled detail is. */
export type DetailKind = 'name' | 'place' | 'number' | 'private';

/** Something in the note that must not leave the device, in the note's own words. */
export interface Detail {
  text: string;
  kind: DetailKind;
  /**
   * True when the author expected a rule to catch it: the class list, a
   * pattern, a word of the sensitive list, or (with no model) the
   * capitalised-word rule. False for what only a reader would see. An
   * expectation written with the labels, not a result.
   */
  easy: boolean;
}

export interface GuardCase {
  id: string;
  /** The class list the teacher typed. */
  classList: string[];
  note: string;
  details: Detail[];
  /** Words that may look private and are not: they can be sent. */
  harmless: string[];
  /** The kinds of constraint a careful teacher would confirm from this note, each once. */
  constraints: ConstraintKind[];
}

export const GUARD_CASES: GuardCase[] = [
  {
    id: 'floods',
    classList: ['Sneha Pillai', 'Arjun Kurian', 'Mehak Gill'],
    note: 'Sneha has been very quiet since the monsoon. Her father lost his shop in the floods and the family has moved in with relatives in Kottayam. She asked me not to tell the others. Arjun has offered to share his notes with her.',
    details: [
      { text: 'Sneha', kind: 'name', easy: true },
      { text: 'Arjun', kind: 'name', easy: true },
      { text: 'Her father lost his shop in the floods', kind: 'private', easy: false },
      { text: 'the family has moved in with relatives in Kottayam', kind: 'private', easy: false },
      { text: 'Kottayam', kind: 'place', easy: true },
    ],
    harmless: [],
    constraints: [],
  },
  {
    id: 'late-bus',
    classList: ['Hemant Bhatt', 'Kavya Iyer', 'Manav Sethi'],
    note: 'Hemant takes the only bus to Chandpur, which leaves at 3:40, right after the last period. He has asked twice to join the cricket nets, but he would have no way home. Kavya plays for the district under-14 team and could coach the juniors.',
    details: [
      { text: 'Hemant', kind: 'name', easy: true },
      { text: 'Kavya', kind: 'name', easy: true },
      { text: 'takes the only bus to Chandpur, which leaves at 3:40, right after the last period', kind: 'private', easy: false },
      { text: 'Chandpur', kind: 'place', easy: true },
    ],
    harmless: ['plays for the district under-14 team'],
    constraints: ['time-after'],
  },
  {
    id: 'clinic',
    classList: ['Fatima Sheikh', 'Om Prakash Yadav', 'Ritu Saini'],
    note: 'Fatima goes to the clinic in Sector 9 every Tuesday with her mother, so she misses the first two periods that day. She gets tired easily and sometimes rests her head on the desk. Om sits beside her and helps her catch up.',
    details: [
      { text: 'Fatima', kind: 'name', easy: true },
      { text: 'Om', kind: 'name', easy: true },
      { text: 'goes to the clinic in Sector 9 every Tuesday with her mother', kind: 'private', easy: false },
      { text: 'Sector 9', kind: 'place', easy: false },
      { text: 'She gets tired easily and sometimes rests her head on the desk', kind: 'private', easy: false },
    ],
    harmless: [],
    constraints: ['days-away', 'health'],
  },
  {
    id: 'easy-ones',
    classList: ['Devansh Mehta', 'Tenzin Dolma', 'Bhavna Rawat'],
    note: "Devansh's parents divorced last year and he now lives with his mother and stepfather. His mother's number is 98200 11456 if the school needs her. Tenzin has asthma and keeps an inhaler in her bag. Bhavna's roll no. 7C/14 is missing from the attendance sheet.",
    details: [
      { text: 'Devansh', kind: 'name', easy: true },
      { text: 'Tenzin', kind: 'name', easy: true },
      { text: 'Bhavna', kind: 'name', easy: true },
      { text: "Devansh's parents divorced last year and he now lives with his mother and stepfather", kind: 'private', easy: true },
      { text: '98200 11456', kind: 'number', easy: true },
      { text: 'Tenzin has asthma and keeps an inhaler in her bag', kind: 'private', easy: true },
      { text: 'roll no. 7C/14', kind: 'number', easy: true },
    ],
    harmless: [],
    constraints: ['health'],
  },
  {
    id: 'fees',
    classList: ['Lakshmi Reddy', 'Pranav Kulkarni', 'Ayesha Khan'],
    note: 'Lakshmi has not paid the exam fee yet; her mother works as a cook in two houses and is paid at the end of the month. Please do not ask her about it in front of the class. Pranav brought sweets for everyone on his birthday.',
    details: [
      { text: 'Lakshmi', kind: 'name', easy: true },
      { text: 'Pranav', kind: 'name', easy: true },
      { text: 'has not paid the exam fee yet', kind: 'private', easy: false },
      { text: 'her mother works as a cook in two houses and is paid at the end of the month', kind: 'private', easy: false },
    ],
    harmless: ['brought sweets for everyone on his birthday'],
    constraints: ['money'],
  },
  {
    id: 'one-phone',
    classList: ['Siddharth Jain', 'Gurpreet Kaur', 'Neha Pandey'],
    note: "Gurpreet's family shares one old phone, and her brother takes it to work all day. She can only do online homework on Sundays, when he is at home. Siddharth won the inter-school quiz in Lucknow last week.",
    details: [
      { text: 'Gurpreet', kind: 'name', easy: true },
      { text: 'Siddharth', kind: 'name', easy: true },
      { text: 'family shares one old phone, and her brother takes it to work all day', kind: 'private', easy: false },
      { text: 'She can only do online homework on Sundays, when he is at home', kind: 'private', easy: false },
    ],
    harmless: ['won the inter-school quiz in Lucknow last week'],
    constraints: ['no-phone-internet'],
  },
  {
    id: 'dialysis',
    classList: ['Karthik Subramanian', 'Swati Ghosh', 'Joseph Mathew'],
    note: 'Karthik leaves at lunch on Fridays to take his grandfather for dialysis at the government hospital. His uncle Venkat signs his diary now. Joseph is reading the Harry Potter books in Malayalam and loves them.',
    details: [
      { text: 'Karthik', kind: 'name', easy: true },
      { text: 'Joseph', kind: 'name', easy: true },
      { text: 'leaves at lunch on Fridays to take his grandfather for dialysis at the government hospital', kind: 'private', easy: true },
      { text: 'Venkat', kind: 'name', easy: true },
      { text: 'His uncle Venkat signs his diary now', kind: 'private', easy: false },
    ],
    harmless: ['the Harry Potter books in Malayalam'],
    constraints: ['days-away', 'contact'],
  },
  {
    id: 'curriculum',
    classList: ['Priyanka Das', 'Rahul Verghese', 'Shruti Agarwal'],
    note: 'In science we start the chapter on diseases next week, with a short film about how a hospital works. Priyanka asked if her uncle, a doctor at AIIMS, could visit and talk to the class. Rahul and Shruti are making a poster on mental health for the corridor.',
    details: [
      { text: 'Priyanka', kind: 'name', easy: true },
      { text: 'Rahul', kind: 'name', easy: true },
      { text: 'Shruti', kind: 'name', easy: true },
      { text: 'her uncle, a doctor at AIIMS', kind: 'private', easy: false },
      { text: 'AIIMS', kind: 'place', easy: true },
    ],
    harmless: ['we start the chapter on diseases next week, with a short film about how a hospital works', 'a poster on mental health for the corridor'],
    constraints: [],
  },
  {
    id: 'hostel',
    classList: ['Abdul Rahman', 'Reshma Banu', 'Yusuf Ali'],
    note: 'Yusuf stays at the Al-Noor hostel during the week and goes home to Malerkotla only on Saturday evenings. The hostel warden, Mr Qadri, is the person to call, on 0161 245 7788. He often comes to class without breakfast because the mess opens late.',
    details: [
      { text: 'Yusuf', kind: 'name', easy: true },
      { text: 'stays at the Al-Noor hostel during the week and goes home to Malerkotla only on Saturday evenings', kind: 'private', easy: false },
      { text: 'Al-Noor', kind: 'place', easy: true },
      { text: 'Malerkotla', kind: 'place', easy: true },
      { text: 'Mr Qadri', kind: 'name', easy: true },
      { text: '0161 245 7788', kind: 'number', easy: true },
      { text: 'He often comes to class without breakfast because the mess opens late', kind: 'private', easy: false },
    ],
    harmless: [],
    constraints: ['contact'],
  },
  {
    id: 'no-capitals',
    classList: ['Ananya Bose', 'Jaspreet Singh', 'Simran Menon'],
    note: "ananya's elder sister roshni picks her up now, since their father moved to dubai for work in june. ananya cries some mornings at the gate. jaspreet has been helping her settle in the line.",
    details: [
      { text: 'ananya', kind: 'name', easy: true },
      { text: 'jaspreet', kind: 'name', easy: true },
      { text: 'roshni', kind: 'name', easy: false },
      { text: 'dubai', kind: 'place', easy: false },
      { text: 'their father moved to dubai for work in june', kind: 'private', easy: false },
      { text: 'ananya cries some mornings at the gate', kind: 'private', easy: false },
    ],
    harmless: [],
    constraints: ['contact'],
  },
  {
    id: 'caste',
    classList: ['Manish Kumar', 'Zainab Hussain', 'Tejas Patil'],
    note: "On Monday some boys called Manish names about his caste during the match; I have spoken to them. Zainab's essay on Republic Day won the school prize. Tejas forgot his PE kit again.",
    details: [
      { text: 'Manish', kind: 'name', easy: true },
      { text: 'Zainab', kind: 'name', easy: true },
      { text: 'Tejas', kind: 'name', easy: true },
      { text: 'some boys called Manish names about his caste during the match', kind: 'private', easy: true },
    ],
    harmless: ['Republic Day', 'PE kit'],
    constraints: [],
  },
  {
    id: 'mandi',
    classList: ['Vikas Thakur', 'Nikita Chauhan', 'Harpreet Sodhi'],
    note: 'Vikas helps his father unload vegetables at Azadpur mandi from five in the morning, so he is often late for assembly. He has fallen asleep in two maths lessons this week. His father asked me to keep this between us.',
    details: [
      { text: 'Vikas', kind: 'name', easy: true },
      { text: 'helps his father unload vegetables at Azadpur mandi from five in the morning', kind: 'private', easy: false },
      { text: 'Azadpur', kind: 'place', easy: true },
    ],
    harmless: [],
    constraints: ['time-before'],
  },
];
