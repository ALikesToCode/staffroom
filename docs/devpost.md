# Staffroom: Devpost text

## Tagline

A small model on the teacher's device reads a note about a child and proposes what to withhold. What the teacher approves is the only note text sent to the cloud.

**Live app:** https://staffroom-hybrid-8a71.web.app

**Code:** https://github.com/ALikesToCode/staffroom

## Inspiration

Teachers keep the most useful notes about a class in their heads or in a notebook: who is missing school and why, who has a health condition, whose home is in trouble. Those notes are exactly what a large model needs to write a good support plan, and exactly what should not be pasted into one. I work on teacher training in public education in India, and I build agent systems that stay under control. Staffroom puts the two together: the capable model does the heavy writing, and a small model on the device is the guard that decides what it is allowed to see.

## What it does

A teacher writes a note about their class in plain words and picks a task: a support plan for next week, messages to parents, or a handover note.

1. **Guard (on the device).** The on-device model finds names, places and private details; pattern rules find contact details and identity numbers; the class list finds listed names. A short list of sensitive words withholds the sentence around each one. The rules and the list need no model. With no model at all, a capitalised-word rule also holds back, as a possible name, any capitalised word that is not an ordinary sentence opener, a day or a month. Each item is replaced by a stand-in such as `[Student 1]`, and private details by `[withheld]`.
2. **Approve.** The teacher sees the exact text that would leave, can withhold more by selecting it, and can release an item unless school policy locks that kind. An exit gate re-checks the outgoing text for every withheld item and for the phone, email and ID patterns; it catches redaction mistakes, it cannot find a private detail nobody marked. If it finds anything, sending is blocked. Nothing is sent until the teacher ticks "I have read this text", and the tick holds only for that exact text. If nothing at all is withheld, the app warns that the note will go as written and asks for a second tick.
3. **Draft (in the cloud).** A Gemini model writes from the redacted text only.
4. **Check (on the device).** The reply comes back with stand-ins. The device puts the names back and the on-device model compares each piece of advice with the private details the cloud never saw, and marks it as no conflict found, in conflict, or worth a second thought. An item in conflict starts struck; an item the check was unsure about has to be kept or struck by the teacher before sign-off. A return gate flags a reply that uses a stand-in that was not in the approved text, or a sensitive word the approved text did not have, and blocks sign-off until the teacher has read a flagged reply.
5. **Sign off.** The teacher keeps or strikes each item. A receipt holds the exact text the teacher approved, counts of what was withheld, which model ran where, and how many items were kept and how many struck. It does not hold the draft, the raw note or anything that was withheld.

## How Firebase AI Logic is used

Every model call goes through the Firebase AI Logic web SDK (`firebase/ai`), and the inference mode is chosen by how sensitive the input is:

| Step | Input | Mode | Why |
|---|---|---|---|
| Guard | The raw note | `ONLY_ON_DEVICE` | This call carries the raw note, so it must not be able to reach a server |
| Draft | Redacted, approved text | `PREFER_IN_CLOUD` | The heavy writing; if the cloud call fails with a network error or an error response and the on-device model is ready, the draft is written on the device |
| Check | The draft and the withheld details | `ONLY_ON_DEVICE` | The withheld details are in the prompt |
| Receipt label | Redacted text | `PREFER_ON_DEVICE` | A small job that is free and needs no network when it runs on the device |

The app reads `inferenceSource` on every response, and the screen shows where each step ran. For the guard and the check, the app refuses to start a guard or check request unless the on-device model is present, and stops if a response did not come from the device.

Other Firebase products:

- **App Check** protects the Gemini API. Enforcement is on: a request without a valid token is refused.
- **Remote Config** holds a setting the school publishes; enforced in the app: which cloud model drafts, and which kinds of item the app keeps withheld. It is the school's default, not a security control.
- **Authentication** (anonymous) gives each browser an account without asking for personal details.
- **Cloud Firestore** keeps the teacher's own record of each receipt, if the teacher turns it on. It is a record written by this browser, the teacher's own note of a run and not evidence of it to anyone else. The copy in Firestore holds the record only, no text: counts, where each step ran, and a digest of the approved text, which is a value for matching the record to the local receipt. Rules allow the owner to create and read a record with exactly those fields, and nobody to edit or delete one.

## How it was built

React, TypeScript and Vite. The redaction vault, the two gates and the receipts are plain functions with unit tests, separate from the model calls, so the safety checks do not depend on a model behaving. The models propose; the deterministic gates and the teacher decide.

## Challenges

- The on-device model is small. It reads the note one paragraph at a time with a strict JSON schema, and its findings are merged with the class list and the rules.
- The exit gate enforces what has been marked and the patterns it knows. It cannot find a private detail nobody marked, which is why the teacher reads the exact text before it leaves. A part of the note the on-device model could not read is named on screen, not passed over.
- When no on-device model is available, the app says so plainly: only the class list, the pattern rules, the list of sensitive words and the capitalised-word rule are applied, and the teacher is told to select private details by hand.

## What I learned

Hybrid inference is more than a cost or latency choice. Routing by the sensitivity of the data makes the on-device model a control point: the cloud model does useful work on exactly what a person approved, and the teacher has a receipt of it.

## What's next

- Hindi and other Indian languages, when the on-device model supports them.
- An Android version on devices that run Gemini Nano.
- A class list imported from the school's system instead of typed in.

## Limits, stated plainly

- The on-device model needs Chrome on a desktop that supports the built-in model, and English.
- The guard and the check are a small model's judgement. They can miss a detail or doubt good advice. In nine runs of the sample note on 26 November 2026 (Chrome 158), the on-device check flagged a conflict with the after-school club in four. I did not record, for every run, whether the cloud draft proposed the club, so the true catch rate may be higher than four in nine. The teacher's read and the gates are the safeguard.
- The demo uses invented data only. Before use with real pupils a school would need its own data agreement and the paid Gemini backend, because the free Gemini Developer API tier is not meant for personal data.
- "Offline" means the guard, the check and the fallback draft keep working once the page and the on-device model have loaded. The page itself is not installed for an offline start.
- Sign-off is by the person using the browser. Anonymous sign-in gives the browser an account; it does not prove who that person is.

## Built with

Firebase AI Logic, Chrome built-in AI (Gemini Nano), Gemini Developer API, Firebase App Check, Remote Config, Authentication, Cloud Firestore, React, TypeScript, Vite.
