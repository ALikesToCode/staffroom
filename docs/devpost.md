# Staffroom

## Elevator pitch

A lesson planner for teachers. Gemini Nano keeps each child's private details on the device. The cloud writes the lesson knowing only the needs, never whose they are.

## In plain words

A teacher photographs a page of her notebook. Her computer hides every child's name and private details, then asks the cloud for tomorrow's lesson using only needs like "away on Tuesdays". When the lesson comes back, her computer puts each child's name beside the line written for them.

## Try it

- **Any browser, no setup.** Open https://staffroom-hybrid-8a71.web.app and click **Watch a recorded run** (labelled **Watch a recorded run with Gemini Nano** on browsers without an on-device model). It replays a real Chrome and Gemini Nano run, step by step.
- **Chrome with Gemini Nano.** Desktop Chrome 158 or newer with Built-in AI ready (no experimental flags needed; on first visit Chrome downloads Gemini Nano over an unmetered connection). Click **Try a sample class**, press **Hide private details**, tick **I have read it**, click **Send**, and watch the lesson arrive. For the handwriting scan, click **Type instead**, then **Try sample notebook photo**.

Category: Web/Chrome. Code: https://github.com/ALikesToCode/staffroom (Apache-2.0).

## Inspiration

I build teacher-training systems for public schools in India. Most of the teachers I work with are in their forties and fifties. They are not at ease with technology, and they plan tomorrow's lesson at home, on a phone.

What they have, and no software has, is the notebook. Tanvi misses every Tuesday for the clinic. Aarav's father lost his job, so nothing can be asked that costs money. Kabir and Ishaan fight in group work. A lesson plan that ignores these fails in the room.

An AI planner would help most if it knew what is in that notebook. But a child's illness, family and fees should not sit on someone else's server, and India's DPDP Act 2023 asks for extra care with children's data.

Teachers who do use a chatbot leave the names out by hand. That works for one child. For a class of forty it means rewriting the notebook in her head every night. One slip sends a child's illness out. And the answer comes back attached to nobody, so she has to work out again which line was meant for whom.

Hybrid inference can do that work for her. The model that needs to know the child runs on the device. The model that writes well runs in the cloud and is never told who the child is. When the lesson comes back, the device puts each child beside the line written for them and checks it against what only the teacher knows.

## What it does

1. **Reads on the device.** The teacher types her notes in English, Hinglish or Hindi, or photographs the notebook page. Gemini Nano transcribes the handwriting in the browser.
2. **Guards on the device.** Fixed rules catch names, phone numbers, roll numbers and known sensitive phrases. Gemini Nano reads each paragraph and catches what rules miss, such as "every Tuesday she goes with her grandmother to the town clinic". Each private detail becomes a lettered need, like "Need E: away on Tuesdays".
3. **Asks the teacher before anything leaves.** She sees the exact text that will be sent, next to plain counts of what stays and what goes. A last check scans the outgoing text for every name and number the device knows. Nothing is sent until she ticks the box. For the sample class that text is 874 characters, short enough to really read.
4. **Writes in the cloud.** Gemini 3.5 Flash-Lite writes the whole-class lesson and one adjustment for each lettered need. It does not know whose need it is.
5. **Puts the child back, on the device.** The browser places each adjustment beside the right pupil. Gemini Nano checks every step against what the teacher confirmed and can suggest a better fit for one child.
6. **Gives her something to print.** One click writes board work, a class worksheet and a sheet for each need. The class copy prints with letters only. The teacher's copy, with names, is never sent anywhere. She can print it for herself.
7. **Learns from the lesson.** She marks each child as Got it, Partly, Not yet or Absent. The next plan uses that, and again only letters and needs go out.
8. **Works when the Wi-Fi drops.** Gemini Nano writes the lesson on the device and the page says that it did.

A **How it ran** panel shows where each step ran, next to the browser's own network log.

## How I built it with Firebase AI Logic

Every model call goes through Firebase AI Logic. One rule picks the mode for each step: if the input can identify a child, the step may only run on the device.

| Step | Mode | Why |
|---|---|---|
| Read the notebook photo | `ONLY_ON_DEVICE` | The photo holds names. The step refuses to run if Gemini Nano is not available. |
| Guard the note | `ONLY_ON_DEVICE` | It reads the raw note. If the answer did not come from the device, the app stops. On a computer without Gemini Nano, the guard runs on rules alone and tells the teacher so. |
| Write the lesson and materials | `PREFER_IN_CLOUD` | It sees only the approved text, and the larger model writes better lessons. Offline, or if the stream breaks, Gemini Nano takes over. |
| Check each step against a child's constraint | `ONLY_ON_DEVICE` | The constraint is private. |
| Suggest a fit for one child | `ONLY_ON_DEVICE` | It reads the child's note. |
| Name the saved record | `PREFER_ON_DEVICE` | Reads only the first 240 characters of the already-approved text (no names). Short and low-stakes, so it prefers the device. |

The rest of Firebase does real work too. **App Check** with reCAPTCHA Enterprise protects the cloud calls. **Remote Config** names the cloud model, so it can change without a new build. **Anonymous Authentication** and **Cloud Firestore** hold an optional saved record that stores counts only and is off by default. **Hosting** serves the app with a strict security policy. The app can also be installed from Chrome.

Built with React, TypeScript and Vite. AI coding assistants were used to build it.

## What I measured

All of this ran in Chrome 158 with Gemini Nano on one machine, on invented notes. The raw results are in the repository's evaluation folder.

- **Does Gemini Nano add anything to plain rules?** On 12 notes with 60 labelled private details, run three times, rules alone caught 46. Rules with Gemini Nano caught 51 on average. Rules alone wrongly held 3 of 8 harmless details. With Gemini Nano that fell to 0 of 8.
- **What about the other 9?** Seven were partly caught and two were missed. That is why the teacher reads the outgoing text before it is sent.
- **Does it hold up on a full class?** On a 35-pupil note, the guard withheld 67 details. Gemini Nano found 17 of them that rules did not. The exit check found no leaked name or number.
- **Does the device catch a bad cloud suggestion?** On 16 held-out cases run three times, the on-device check caught 24 of 24 real conflicts and wrongly flagged 4 of 24 harmless steps.
- **How long does a teacher wait?** About 4 seconds for the guard on a paragraph, 3 seconds to read the notebook photo, 4 seconds for the cloud lesson, and 23 seconds for the offline lesson on Gemini Nano.
- **500 automated tests** pass.

## Challenges

**Making Gemini Nano matter.** In early versions the rules did nearly all the work and the on-device model was decoration. I built a labelled set of notes to find where it earns its place. It turned out to be indirect details that no pattern can match, like the Tuesday clinic visit, and cutting the false alarms that made the rules annoying.

**Getting a small model to write a full lesson offline.** Asked for free text, Gemini Nano dropped needs or timed out. A strict JSON schema, plus a tidy-up step in plain code, got every need in the sample class accounted for.

**Writing for a teacher, not for a developer.** The first version spoke in mode names and gates. The teachers I work with would have closed it. The screens now say where the work is happening in ordinary words, the main actions are large buttons, and the mode names sit beside them in small type for anyone who wants to check.

**Designing for a computer that is not yours.** Many teachers share a computer at school. Notes, class lists, saved lessons and local records live only in the browser tab unless the teacher turns on keeping the class in this browser, so closing the tab removes them. One button, Clear desk, wipes everything and signs out. The default print is the copy without names.

## What I learned

I started by asking which model was big enough for each task. The better question was what each model is allowed to see. Once the modes followed the data, the product explained itself in one line: your device knows the child, the cloud only knows the need.

## Limits

- **It needs a capable computer today.** Chrome's Prompt API requires at least 22 GB of free disk space on the profile volume and either a graphics card with more than 4 GB of video memory or 16 GB of RAM with four or more CPU cores. Most lab PCs in Indian government schools do not have that, and the teachers I build for plan on a phone, which cannot run it yet. On those devices Staffroom still tells the teacher clearly that no on-device model ran, withholds known names and numbers by rule, and requires her to check and approve every word before sending to the cloud. But there is no notebook photo scan, no on-device semantic check, and no offline lesson. Today it fits a teacher with a recent laptop.
- **The demo's cloud is the free Gemini Developer API.** Under Google's Unpaid Services terms, Google may use submitted text to improve its products and human reviewers may read it, and Google tells developers not to send personal or sensitive data there. Only the approved text without names goes out; a school should use a paid tier, where prompts are not used for training.
- **The teacher can tick the box without reading.** The app keeps the outgoing text short and shows it beside what was held back. It cannot make her read it.
- **A letter is not anonymity inside the classroom.** The cloud cannot tell whose need it is. Classmates looking at a printed sheet sometimes can.
- No teacher has used this in a classroom yet. Every pupil, note and photo is invented.
- Gemini Nano checks lessons written in English. Lessons in Hindi are checked by rules. The screens are in English, with a short Hindi line under some of the main buttons.

## What's next

A trial with teachers on invented and then real classes, with a school's consent. Android, as Gemini Nano reaches the phones teachers own, because that is where most of them plan. Hindi screens, and more Indian languages in the on-device check.
