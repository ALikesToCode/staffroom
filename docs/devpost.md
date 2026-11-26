# Staffroom: Devpost text

## Tagline

Your device knows why. The cloud only knows what.

**Live app:** https://staffroom-hybrid-8a71.web.app (any browser; "Watch a recorded run" replays a real run with the on-device model)

**Code:** https://github.com/ALikesToCode/staffroom (Apache-2.0)

## Value proposition

A teacher in an Indian government school plans tomorrow's lesson for a class of forty. The plan is easy to get from a large model. What makes it work for this class is what only the teacher knows: one child must leave at the last bell to walk home before dark, one family cannot pay for anything extra, one child has no phone at home, two boys fight when they sit together. Those facts must not be pasted into a chatbot.

Staffroom splits the job along that line. The cloud model plans the lesson for the whole class and writes a line for each need, told only "Need A: cannot stay after the last bell", with no name, no reason and no count. The device keeps who has which need and why, puts each line beside the right child, and checks every step against what the teacher confirmed. The teacher gets one class plan, printable with no names, and a private page of what each child does differently.

## What it does

1. **Write.** The teacher writes the class note as they would in their own notebook, names and all, and gives the class, subject, topic and length.
2. **What leaves.** On the device, Gemini Nano (Chrome built-in AI) and plain rules find names, places and private details and replace them with stand-ins. They also propose **constraints** ("has to leave school at the last bell to reach home before dark") and **needs**. The teacher confirms each one and chooses which needs to tell the cloud. Each row shows both sides: *Stays here:* the teacher's words and the child's name. *The cloud is told:* "Need A: cannot stay after the last bell". Some facts, such as epilepsy, are told to nobody by default. The teacher reads the exact text and ticks it before anything is sent.
3. **Lesson.** The cloud writes the stages (Starter, Teach, Practise, Check, Homework) and one section, "For each need", with an entry for every letter: what such a pupil does in that stage instead, or "this lesson already suits this need".
4. **Beside each child.** Plain code reads that section strictly. The device places each entry beside every child who has that need; the cloud's side of the screen shows the same reply with letters only. Rules check every step against each child's confirmed constraints. Two children who work better apart get "Seat Kabir and Ishaan in different groups", added by rule on the device, because the cloud cannot know the two needs are about each other. Nothing lands until the teacher accepts it.
5. **Sign off and teach.** The class plan prints and copies with no names; the teacher's copy lists each child's adjustments. "Make the materials" asks the cloud for board work, a practice sheet, a version of the sheet for each need, and an exit ticket with answers. The device puts the names on the right versions.
6. **Next lesson.** After teaching, the teacher taps got it / partly / not yet / absent for each child. The device turns that into new nameless needs ("has not yet got this; needs it taught again another way"), and **Plan the next lesson** starts from them. Who learned what never leaves the device.

There are also three other tasks: a support plan, messages to parents (each message has its own copy rules), and a hand-over note. Plans can be written in Hindi. Read aloud uses the browser's own voices.

## How Firebase AI Logic is used

Every model call goes through the Firebase AI Logic web SDK (`firebase/ai`). The inference mode of each call is chosen by how sensitive its input is:

| Job | Input | Mode |
|---|---|---|
| Find names, private details, constraints and learning needs | the raw note | `ONLY_ON_DEVICE` |
| Write the lesson (or plan, messages, hand-over) and the materials | the approved, redacted text and the needs by letter | `PREFER_IN_CLOUD` |
| Check each step against the private details | the draft and the withheld details | `ONLY_ON_DEVICE` |
| Suggest what one child does instead | one step and that child's notes | `ONLY_ON_DEVICE` |
| Name the receipt | redacted text | `PREFER_ON_DEVICE` |

The mode is not trusted on its own. For the three `ONLY_ON_DEVICE` routes the app refuses to start unless the on-device model is present, reads `inferenceSource` on every response, and stops if an answer did not come from the device. A test removes the model and checks that no network request is made. The screen shows where each step ran.

**Other Firebase products:**
- **App Check** (reCAPTCHA Enterprise), enforced.
- **Remote Config**: the school's policy (which cloud model drafts, which kinds of item stay withheld).
- **Anonymous Authentication**.
- **Cloud Firestore**: an optional record of each receipt, holding counts only and never text, behind exact-field security rules.

The app installs as a PWA and starts offline. Without the on-device model, for example on a phone or in another browser, it runs the rules and the cloud and says so plainly.

## How it was built

React, TypeScript and Vite. The vault, the two gates, the rules that compare steps with constraints, and the reader for the needs section are plain functions with 437 unit tests, separate from the model calls. The models propose; plain code and the teacher decide.

## Measured, not claimed

All runs were on 26 November 2026, in Chrome 158 with Gemini Nano, on invented data.
- **On-device check, held-out cases.** 16 cases written before the model saw them, three runs: 24 of 24 conflicts caught, 4 of 24 harmless items wrongly flagged.
- **On-device check plus rules, full sample note.** Two runs: 18 of 18 conflicts caught, 0 of 42 harmless items flagged, 3 marked unsure.
- **Cloud lessons, need entries.** Asked for a line only where a stage needed one, the cloud wrote lines for 4 of 55 needs over five lessons. With the required "For each need" section, every need got an entry in all five lessons: 7 of 11 with a stage, and 4 with "already suits".
- **Where the small model is weak.**
  - Its open-ended per-child suggestions were useful about a third of the time, so they are an optional extra, labelled as written by a small model.
  - Its proposals of learning needs mostly failed the checks: 3 of 36 kept.
  - The rules carry those jobs and the teacher confirms everything.

## Challenges

- An honest cloud lesson rarely breaks a private constraint. In 20 unsteered plans, none did. So "the device catches the cloud" could not be the whole story; "the cloud writes for the need, the device knows the child" is.
- A small on-device model is a better reader than writer. Staffroom gives it reading jobs (find, propose, check) and leaves writing to the cloud.
- Rules are word lists in English. Text in another language is marked "Not checked by rule".

## What was built during the submission period

All of it. Staffroom is a new project, started after the submission period opened on 11 November 2026. It contains no code or other work that existed before then. It uses standard open-source libraries (React, Vite, the Firebase JavaScript SDK, vite-plugin-pwa), and AI coding assistants were used in writing it.

## Limits

- The on-device model needs Chrome on a desktop that supports the built-in model, and English.
- The demo uses invented data only. Real pupils' data would need a school data agreement and the paid Gemini backend.
- A small model can miss a private detail, and the gates cannot find what nobody marked. That is why the teacher reads the exact outgoing text.
- Sign-off is by whoever is using the browser; anonymous sign-in does not prove who that is.

## Built with

Firebase AI Logic, Chrome built-in AI (Gemini Nano), Gemini Developer API, Firebase App Check, Remote Config, Authentication, Cloud Firestore, Firebase Hosting, React, TypeScript, Vite.
