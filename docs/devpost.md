# Staffroom: Devpost text (draft for review, not submitted)

## Tagline

What a teacher writes about a child stays on the teacher's device. The cloud only ever sees what the teacher approved.

**Live app:** https://staffroom-hybrid-8a71.web.app

**Code:** https://github.com/ALikesToCode/staffroom

## Inspiration

Teachers keep the most useful notes about a class in their heads or in a notebook: who is missing school and why, who has a health condition, whose home is in trouble. Those notes are exactly what a large model needs to write a good support plan, and exactly what should not be pasted into one. I work on teacher training in public education in India, and I build agent systems that stay under control. Staffroom puts the two together: the capable model does the heavy writing, and a small model on the device is the guard that decides what it is allowed to see.

## What it does

A teacher writes a note about their class in plain words and picks a task: a support plan for next week, messages to parents, or a handover note.

1. **Guard (on the device).** Chrome's built-in model reads the raw note and finds names, places, contact details, identity numbers and private details. A class list and pattern rules run beside it. Each item is replaced by a stand-in such as `[Student 1]`, and private details by `[withheld]`.
2. **Approve.** The teacher sees the exact text that would leave, can withhold more by selecting it, and can release an item unless school policy locks that kind. An exit gate searches the outgoing text again for every withheld item and blocks sending if one is found. Nothing is sent until the teacher ticks "I have read this text".
3. **Draft (in the cloud).** A Gemini model writes from the redacted text only.
4. **Check (on the device).** The reply comes back with stand-ins. The device puts the names back and the on-device model compares each piece of advice with the private details the cloud never saw, and marks it as fitting, in conflict, or worth a second thought. A return gate rejects replies that contain a stand-in the device did not issue.
5. **Sign off.** The teacher keeps or strikes each item. A receipt records what kinds of item were withheld, the exact text that was approved, which model ran where, and what was signed off. A receipt holds no name and no private detail.

## How Firebase AI Logic is used

Every model call goes through the Firebase AI Logic web SDK (`firebase/ai`), and the inference mode is chosen by how sensitive the input is:

| Step | Input | Mode | Why |
|---|---|---|---|
| Guard | The raw note | `ONLY_ON_DEVICE` | The raw note must not be able to reach a server |
| Draft | Redacted, approved text | `PREFER_IN_CLOUD` | The heavy writing; falls back to the device when the cloud cannot be reached |
| Check | The draft and the withheld details | `ONLY_ON_DEVICE` | The withheld details are in the prompt |
| Receipt label | Redacted text | `PREFER_ON_DEVICE` | A small job that is free and works offline on the device |

The app reads `inferenceSource` on every response. The guard and the check stop if a response did not come from the device, and the screen shows where each step ran.

Other Firebase products:

- **App Check** protects the Gemini API. Enforcement is on: a request without a valid token is refused.
- **Remote Config** holds the school's policy: which cloud model drafts, and which kinds of item a teacher may never release.
- **Authentication** (anonymous) gives each browser an account without asking for personal details.
- **Cloud Firestore** keeps an optional audit copy of each receipt. Rules allow the owner to create and read a receipt, and nobody to edit or delete one.

## How it was built

React, TypeScript and Vite. The redaction vault, the two gates and the receipts are plain functions with unit tests, separate from the model calls, so the safety checks do not depend on a model behaving. The models propose; the deterministic gates and the teacher decide.

## Challenges

- The on-device model is small. It reads the note one paragraph at a time with a strict JSON schema, and its findings are merged with the class list and the rules.
- A guard that misses something must fail safe. That is why the exit gate is a separate, deterministic search, and why the teacher reads the outgoing text before it leaves.
- When no on-device model is available, the app says so plainly: only the class list and rules are applied, and the teacher is told to select private details by hand.

## What I learned

Hybrid inference is more than a cost or latency choice. Routing by the sensitivity of the data makes the on-device model a control point: the cloud model does useful work on exactly what a person approved, and there is a record of it.

## What's next

- Hindi and other Indian languages, when the on-device model supports them.
- An Android version on devices that run Gemini Nano.
- A class list imported from the school's system instead of typed in.

## Limits, stated plainly

- The on-device model needs Chrome on a desktop that supports the built-in model, and English.
- The guard and the check are a small model's judgement. They can miss a detail or doubt good advice. The teacher's read and the gates are the safeguard.
- All sample data is invented.

## Built with

Firebase AI Logic, Chrome built-in AI (Gemini Nano), Gemini Developer API, Firebase App Check, Remote Config, Authentication, Cloud Firestore, React, TypeScript, Vite.
