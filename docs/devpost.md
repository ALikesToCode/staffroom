# Staffroom: Devpost text

## Tagline

Your device knows the child. The cloud only knows the need.

**Live app:** https://staffroom-hybrid-8a71.web.app (any browser; "Watch a recorded run" replays a real run with the on-device model)

**Code:** https://github.com/ALikesToCode/staffroom (Apache-2.0)

## Try it in 30 seconds (Judge guide)

1. **Any browser (zero setup):** Click **Watch a recorded run with Gemini Nano** on the first screen to step through one complete Chrome 158 + Gemini Nano + `gemini-3.5-flash-lite` lesson run (`Next` / `Back`, or click any step in the progress bar).
2. **Trace across the door:** On **What leaves** or **Beside each child**, hover or focus any `Need` letter (such as `Need F` or `Need I`) or any line in the right-hand cloud pane to highlight matching private details, per-child adjustments, and tailored sheets on the left without ever sending names across the door.
3. **Verify zero cloud leakage live:** Open **Inspect** (or press **Try an invented class** in desktop Chrome with Gemini Nano) to check the explicit `ONLY_ON_DEVICE` / `PREFER_IN_CLOUD` routes and the browser's live Resource Timing log (`0 requests to the model host` during Guard and Check).
4. **Compare outputs at Sign off:** On the **Sign off** screen (or replay step 5), toggle **Preview class & teacher copies** to view the anonymous `Class copy · no names` beside the private `Teacher's copy · with names`.

## Value proposition

A teacher in an Indian government school plans tomorrow's lesson for a class of forty. A large model can write the plan. What makes it work for this class is what only the teacher knows: one child must leave at the last bell to walk home before dark, one family cannot pay for anything extra, one child has no phone at home, two boys fight when they sit together. Those facts should not be pasted into a chatbot.

Staffroom splits the job along that line. For a lesson the cloud is sent the class, subject, topic and length, the sentences of the note about the class as a whole, and each need as a letter ("Need A: cannot stay after the last bell"), with no name, no reason and no count. No sentence about one pupil is sent. The device keeps who has which need and why, puts the cloud's entry for each need beside the right child, and checks every step against the constraints the teacher confirmed. The teacher gets one class plan that prints with no names, and a private page of what each child does differently.

Staffroom is made for the school's shared computer, the staffroom or lab PC. The on-device model needs Chrome on a desktop or laptop that supports it, and English notes. On a phone or in another browser, Staffroom runs the rules and the cloud, and says so.

## What it does

1. **Write.** The teacher writes the class note as they would in their own notebook, names and all, and gives the class, subject, topic and length.
2. **What leaves.** On the device, Gemini Nano (Chrome built-in AI) and plain rules find names, places and private details and replace them with stand-ins. They also propose **constraints** ("has to leave school at the last bell to reach home before dark") and **needs**. The teacher confirms them one by one or with "Confirm all", and chooses which needs to tell the cloud. Each row shows both sides: *Stays here:* the teacher's words and the child's name. *The cloud is told:* "Need A: cannot stay after the last bell". A health condition such as epilepsy is withheld from every cloud request by default. The teacher reads the exact outgoing text and ticks it before anything is sent.
3. **Lesson.** The cloud writes the stages (Starter, Teach, Practise, Check, Homework) and one section, "For each need", with an entry for every letter: what such a pupil does in that stage instead, or "this lesson already suits this need".
4. **Beside each child.** Plain code reads that section strictly. The device places each entry beside every child who has that need; the cloud's side of the screen shows the same reply with letters only. Rules check every step against the confirmed constraints they can read: time after or before school, days away, money, phone and internet at home, a contact, and health words. Learning needs and "other" have no rule. Two children who work better apart get a seating line beside both, added by rule on the device, because the cloud cannot know the two needs are about each other: "Put Kabir and Ishaan in different groups" for group work, "Seat Kabir and Ishaan apart" otherwise. Nothing is added to the plan until the teacher accepts it, one by one or with "Accept all".
5. **Sign off and teach.** The class plan prints and copies with no names; the teacher's copy lists each child's adjustments. "Make the materials" asks the cloud for board work, a practice sheet, an exit ticket with answers, and, for each need the class sheet does not suit, a sheet written out in full (the sentence starters, the recap card, the harder task). The device puts the names over the right sheets on the teacher's copy only.
6. **Next lesson.** After teaching, the teacher marks each child got it / partly / not yet / absent. The device turns the marks into new nameless needs ("has not yet got this; needs it taught again another way", "partly got this; needs more practice on it"), and **Plan the next lesson** starts from them. Who learned what never leaves the device.

The same gates serve three tasks not shown in the video: a support plan, messages to parents and a hand-over note. A plan can be written in Hindi; the rules and the on-device check read English only, so a Hindi plan is marked "Not checked by rule". Read aloud uses the browser's local voices.

## How Firebase AI Logic is used

Every model call goes through the Firebase AI Logic web SDK (`firebase/ai`). The inference mode of each call is chosen by how sensitive its input is:

| Job | Input | Mode |
|---|---|---|
| Find names, private details and constraints | the raw note | `ONLY_ON_DEVICE` |
| Write the lesson and its materials (or a plan, messages, a hand-over) | the approved text: for a lesson, class-level sentences and the needs by letter | `PREFER_IN_CLOUD` |
| Check each step against the private details | the draft and the withheld details | `ONLY_ON_DEVICE` |
| Suggest what one child does instead | one step and that child's notes | `ONLY_ON_DEVICE` |
| Name the receipt | redacted text | `PREFER_ON_DEVICE` |

The mode is not trusted on its own. The three `ONLY_ON_DEVICE` routes have no cloud fallback: each refuses to start a request unless the on-device model is present, reads `inferenceSource` on every response, and stops if an answer did not come from the device. A unit test deletes the browser's `LanguageModel` API, stubs `fetch`, and asserts that none of the three routes calls it. Inspect shows where each step ran, and the browser's own record of the requests made during each step: during the on-device guard, none went to the model.

**Other Firebase products:**
- **App Check** (reCAPTCHA Enterprise), enforced.
- **Remote Config**: the school's policy (which cloud model drafts, which kinds of item stay withheld).
- **Anonymous Authentication**.
- **Cloud Firestore**: an optional record of each receipt, with counts and run details (task, times, model, where each step ran) and no note or lesson text, behind exact-field security rules.

The app installs as a PWA and starts offline.

## How it was built

React, TypeScript and Vite. The vault, the two gates, the rules that compare steps with constraints, and the reader for the needs section are plain functions with unit tests, separate from the model calls. The models propose; plain code and the teacher decide.

## Measured, not claimed

All runs were on 26 and 27 November 2026 in Chrome 158 with Gemini Nano, on invented data. The raw results are in the repository under `docs/evals/`.
- **What Nano adds to the guard.** 12 fresh invented notes with 60 private details, labelled and committed before any run, each run three times through the guard with the rules alone and with the rules plus Nano. Per run, the rules alone missed 9 details outright; with Nano, 1. Of the 19 details no word list could be expected to catch ("her father lost his shop in the floods", "takes the only bus to Chandpur, which leaves at 3:40"), the rules alone hid none in full and 10 in part; with Nano, 8 in full and 10 in part. Nano also proposed about 7 of the 11 labelled constraints (the rules, 1), plus about 12 others per run for the teacher to remove. Both still held back some harmless phrases ("Republic Day", "PE kit").
- **On-device check, held-out cases.** 8 cases where the advice goes against a withheld fact and 8 where it does not, written before the model saw them, each run three times: the conflict was caught in all 24 conflicting runs, and 4 of the 24 harmless runs were wrongly flagged. It is a small set written by us: a sanity check, not a benchmark.
- **On-device check plus rules, full sample note.** Two runs: 18 of 18 conflicts caught. No harmless item was flagged as a conflict; 3 of 42 were marked unsure, for the teacher to read.
- **Cloud lessons, need entries.** Asked for a line only where a stage needed one, the cloud wrote lines for 4 of 55 needs over five lessons. With the required "For each need" section, each of the five lessons had an entry for all 11 needs: 7 for a stage and 4 "already suits". After the lesson request was cut to the sentences about the class (27 November), five more lessons also had an entry for every need, none missing. This counts entries, not whether each one is good teaching.
- **Where Nano is not used to write.** We tried it. Its proposals of learning needs passed the checks 3 times in 36. Its answers for what one child does instead passed the rules 29 times in 43, but 17 of them repeated words of the private fact. So Nano reads (finds, proposes, checks), the cloud writes, the rules carry the learning needs, and its own per-child ideas are an extra the teacher asks for, labelled as written by a small model.

## Challenges

- An honest cloud lesson rarely breaks a private constraint. In 20 unsteered plans, none did. So "the device catches the cloud" could not be the whole story; "the cloud writes for the need, the device knows the child" is.
- In our tests this small on-device model did better at reading jobs than at writing ones, so Staffroom gives it only reading jobs.
- Rules are word lists in English. Text in another language is marked "Not checked by rule".

## What was built during the submission period

All of it. Staffroom is a new project, started after the submission period opened on 11 November 2026. It contains no code or other work that existed before then. It uses standard open-source libraries (React, Vite, the Firebase JavaScript SDK, vite-plugin-pwa), and AI coding assistants were used in writing it.

## Limits

- The on-device model needs Chrome on a desktop that supports the built-in model, and English.
- It has not yet been tried by teachers in a school. All data in the demo is invented. Real pupils' data would need a school data agreement and the paid Gemini backend.
- A small model can miss a private detail, and the gates cannot find what nobody marked. That is why the teacher reads the exact outgoing text.
- A need can itself say something private ("cannot pay for extra materials"). The teacher chooses which needs are told.
- Sign-off is by whoever is using the browser; anonymous sign-in does not prove who that is.

## Built with

Firebase AI Logic, Chrome built-in AI (Gemini Nano), Gemini Developer API, Firebase App Check, Remote Config, Authentication, Cloud Firestore, Firebase Hosting, React, TypeScript, Vite.
