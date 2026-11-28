# Staffroom

## Elevator pitch

Most hybrid apps decide where the work runs. Staffroom decides what each model is allowed to know.

Your device knows the child. The cloud only knows the need.

## In plain words

A teacher photographs a page of her notebook. Her computer keeps every sentence of that notebook on the device, turns what it finds into lettered needs from a fixed list like "away on Tuesdays", and sends only those lines to the cloud to write tomorrow's lesson. When the lesson comes back, her computer puts each child's name beside the line written for them.

## Try it

- **Any browser, no setup.** Open https://staffroom-hybrid-8a71.web.app and click **Watch a recorded run** (labelled **Watch a recorded run with Gemini Nano** on browsers without an on-device model). It replays a real Chrome and Gemini Nano run, step by step.
- **Chrome with Gemini Nano.** Desktop Chrome 158 or newer with Built-in AI ready (no experimental flags needed; on first visit Chrome downloads Gemini Nano over an unmetered connection). Click **Try a sample class**, press **Hide private details**, tick **I have read it**, click **Send**, and watch the lesson arrive. For the handwriting scan, click **Type instead**, then **Try sample notebook photo**.

Category: Web/Chrome. Code: https://github.com/ALikesToCode/staffroom (Apache-2.0).

## Inspiration

I build teacher-training systems for public schools in India. Most of the teachers I work with are in their forties and fifties. They are not at ease with technology, and they plan tomorrow's lesson at home, on a phone.

What they have, and no software has, is the notebook. Tanvi misses every Tuesday for the clinic. Aarav's father lost his job, so nothing can be asked that costs money. Kabir and Ishaan fight in group work. A lesson plan that ignores these fails in the room.

An AI planner would help most if it knew what is in that notebook. But a child's illness, family and fees should not sit on someone else's server, and India's DPDP Act 2023 asks for extra care with children's data.

Teachers who do use a chatbot leave the names out by hand. That works for one child. For a class of forty it means rewriting the notebook in her head every night. One slip sends a child's illness out. And the answer comes back attached to nobody, so she has to work out again which line was meant for whom.

Redaction alone still leaves privacy resting on detection: a sentence with no name and no pronoun ("the girl by the window has fits") slips past redaction. Hybrid inference works better behind a structural boundary: nothing from the notebook is allowed to cross on the lesson path. The on-device model reads the private notebook so the teacher catches more needs; the cloud model sees only fixed-catalogue needs and lesson lines; and the device puts each child back beside the lines written for them.

## What it does

1. **Reads on the device.** The teacher types her notes in English, Hinglish or Hindi, or photographs the notebook page. Gemini Nano transcribes the handwriting in the browser.
2. **Guards on the device.** Fixed rules catch names, phone numbers, roll numbers and known sensitive phrases. Gemini Nano reads each paragraph and spots indirect needs that rules miss, such as "every Tuesday she goes with her grandmother to the town clinic". Nothing that Gemini Nano writes can ever enter the cloud request: it may only suggest a need kind.
3. **Asks the teacher before anything leaves.** For a lesson, nothing from the notebook is sent — only the lesson lines (class, subject, topic, length, language), lettered needs from a fixed catalogue, or curated zero-reason classroom actions she picks. Free wording stays off unless she writes it herself and ticks **Send my own wording** (shown with a **Your own words** label). Every send call rebuilds and checks the exact request from a typed object in `src/core/boundary.ts` before anything leaves. Nothing is sent until she ticks **I have read it**. For the sample class that text is **824 characters** (with zero notebook sentences), short enough to really read.
4. **Writes in the cloud.** Gemini 3.5 Flash-Lite writes the whole-class lesson and one adjustment for each lettered need. It does not know whose need it is.
5. **Puts the child back, on the device.** The browser places each adjustment beside the right pupil. Gemini Nano checks every step against what the teacher confirmed and can suggest a better fit for one child.
6. **Gives her something to print.** One click writes board work, a class worksheet and a sheet for each need. The class copy prints with letters only. The teacher's copy, with names, is never sent anywhere. She can print it for herself.
7. **Learns from the lesson.** She marks each child as Got it, Partly, Not yet or Absent. The next plan uses that, and again only fixed letters and needs go out.
8. **Works when the Wi-Fi drops.** Gemini Nano writes the lesson on the device and the page says that it did.

A **How it ran** panel shows where each step ran, next to the browser's own network log.

## How I built it with Firebase AI Logic

Every model call goes through Firebase AI Logic, routed around a strict structural boundary (`src/core/boundary.ts`). If an input can identify a child, the step may only run on the device (`ONLY_ON_DEVICE`). On the active lesson flow, non-lesson compose tasks are removed and rejected fail-closed so no raw or redacted notebook prose can ever be sent; all send-time calls require a validated boundary guard.

| Step | Mode | Why |
|---|---|---|
| Read the notebook photo | `ONLY_ON_DEVICE` | The photo holds names. The step refuses to run if Gemini Nano is not available. |
| Guard the note | `ONLY_ON_DEVICE` | It reads the raw note. If the answer did not come from the device, the app stops. Without Gemini Nano, the guard uses rules only to find needs — it finds fewer needs, and still sends nothing from the notebook. |
| Write the lesson and materials | `PREFER_IN_CLOUD` | Sees only the fixed-catalogue needs and lesson lines (verified byte-for-byte against `LessonBoundaryPayload` / `MaterialsBoundaryPayload`), never the notebook. Offline or if the stream breaks, Gemini Nano takes over. |
| Check each step against a child's constraint | `ONLY_ON_DEVICE` | The constraint and notebook are private. |
| Suggest a fit for one child | `ONLY_ON_DEVICE` | It reads the child's note. |
| Name the saved record | `PREFER_ON_DEVICE` | Reads only the validated `Class — Subject — Topic` lesson summary (at most 240 characters, never notebook text), enforced by `LabelBoundaryPayload`. |

The rest of Firebase does real work too. **App Check** with reCAPTCHA Enterprise protects the cloud calls. **Remote Config** names the cloud model, so it can change without a new build. **Anonymous Authentication** and **Cloud Firestore** hold an optional saved record that stores counts only and is off by default. **Hosting** serves the app with a strict security policy. The app can also be installed from Chrome.

Built with React, TypeScript and Vite. AI coding assistants were used to build it.

## What I measured

All checks ran on the shipped boundary code in Chrome 158 with Gemini Nano and Firebase AI Logic (`gemini-3.5-flash-lite`), on invented notes. The full dataset (`45` invented notes in English, Hinglish and Hindi Devanagari; `230` seeded private details; `49` harmless classroom details), independent 1-in-3 audit (`15 / 45` cases), scripts and raw logs live under `docs/evals/boundary/`.

- **How much private data crosses the boundary (`230` seeded details across `4` arms)?**
  - **Cloud-only** (raw note sent): **230 / 230** leaked (`100%`).
  - **Previous redaction + class pass-through (`submitted-fallback`)**: **16 / 230** (`6.96%`) leaked with rules only (including `12` sentences with no name and no pronoun), and **13 / 230** (`5.65%`) leaked with rules + Gemini Nano (including `10` prompt-injection lines and `3` odd contacts/IDs).
  - **Structural boundary (`boundary`)**: **0 / 230 (`0.00%`)** leaked across **all 3 runs** with rules only, and **0 / 230 (`0.00%`)** leaked across **all 3 runs** with rules + Gemini Nano (`45 / 45` cases ran `ON_DEVICE`).
- **Where does Gemini Nano earn its place (`3` runs on the boundary)?** When nothing from the notebook crosses, an unrecognised detail can no longer leak — it only costs that child an adjustment unless spotted on-device.
  - **Auto-shared catalogue needs reaching the cloud (`89` expected):** Rules only found **30 / 89 (`33.71%`)**. Adding Gemini Nano raised that to **48, 48 and 49 / 89** (mean **48.33 / 89 = `54.31%`**, median **`53.93%`**, a **+20.60 percentage-point** gain).
  - **Teacher-selectable classroom-action constraints detected on-device (`43` expected, `0` auto-sent):** Rules only found **7 / 43 (`16.28%`)**. Rules + Gemini Nano found **21, 17 and 21 / 43** (mean **19.67 / 43 = `45.74%`**, median **`48.84%`**, nearly **3×** rules only).
  - **False holds on harmless classroom items (`49` items):** Rules only held **0 / 49**. Gemini Nano over-flagged ordinary classroom nouns (such as `Students`, `chalkboard`, `exercise books` and Hindi/Hinglish equivalents) into on-device entities on **22, 21 and 25 of 49** items across runs 1–3; under the structural boundary that causes zero impact on the cloud request.
- **Local-only (Gemini Nano) vs Cloud (`gemini-3.5-flash-lite`) across `6` lessons (`sample`, `c01`, `c06`, `c26`, `c35`, `c42`):** Both Cloud and Local fallback accounted for **100%** of sent needs (`11/11`, `2/2`, `2/2`, `1/1`, `2/2`, `0/0`; `0` missing, `0` dropped). Cloud finished `5` of `6` runs `IN_CLOUD` in **1.9 to 4.2 s** (median **2.4 s**, `5` stages; the zero-need Hindi case fell back on-device in `9.2 s`). Local-only Nano ran all `6` `ON_DEVICE` in **4.7 to 15.9 s** (median **6.3 s**, `4` stages).
- **How long does the recorded sample class take (`public/recorded-run.json`)?** In Chrome 158: **6.3 s** to read the sample notebook photo (`0` cloud calls), **18.9 s** for the on-device guard across the sample note (`0` cloud calls), **4.1 s** for the cloud lesson from **824 characters** (`12/12` needs), **3.4 s** for cloud materials (`12/12` needs), **18.9 s** for the on-device conflict check (`0` cloud calls), **1.3 s** for the on-device child fit (`0` cloud calls), and **0.25 s** on-device record naming.
- **508 automated tests** across `22` Vitest files pass (including adversarial zero-4-word-run tests on undetected notes, prompt injection, Hindi and Hinglish), `0` TypeScript errors, and `0` known production dependency vulnerabilities.

## Challenges

**Replacing probabilistic privacy with a structural wall.** In our first submitted build, privacy rested on redaction plus filtering out single-pupil sentences. Testing `45` adversarial notes showed where that breaks: sentences with no name or pronoun still slipped out (`12` details under rules only), and prompt-injection lines fooled the small model (`10` details under Gemini Nano). Removing the notebook pass-through entirely and letting only a single typed allowlist (`src/core/boundary.ts`) build and verify outgoing requests dropped leakage to **0 / 230** in every arm while keeping lesson quality intact (**824** characters, `50` shorter than before, with `12 / 12` needs accounted for).

**Keeping Gemini Nano honest — including what it over-flags.** Moving to zero leakage shifted what Gemini Nano is evaluated for: recall of real classroom needs without false alarms. Across 3 runs on 45 notes, Nano nearly doubled useful catalogue needs found (`33.71%` -> `54.31%`) and tripled classroom-action recall (`16.28%` -> `45.74%`), yet still tagged harmless classroom nouns in `21–25 / 49` items on-device. Under the boundary those false holds never reach or distort the cloud request, and measuring them openly shows where small on-device models still need tightening.

**Writing for a teacher, not for a developer.** The first version spoke in mode names and gates. The teachers I work with would have closed it. The screens now say clearly where the work is happening in ordinary words ("Nothing from your notebook is sent. Only these lines."), the main actions are large buttons, and the mode names sit beside them in small type for anyone who wants to check.

**Designing for a computer that is not yours.** Many teachers share a computer at school. Notes, class lists, confirmed constraints, saved lessons and local records live only in the browser tab unless the teacher turns on keeping the class in this browser, so closing the tab removes them. One button, Clear desk, wipes everything and signs out. The default print is the copy without names.

## What I learned

Most hybrid apps ask where a task should run. The real boundary is what each model is allowed to see. Once nothing from the private notebook is structurally permitted to cross, the device model stops carrying the impossible burden of perfect redaction and focuses purely on understanding what the child needs, while the cloud model writes strong whole-class plans knowing only fixed needs and never who any child is.

## Limits

- **It needs a capable computer today.** Chrome's Prompt API requires at least 22 GB of free disk space on the profile volume and either a graphics card with more than 4 GB of video memory or 16 GB of RAM with four or more CPU cores. Most lab PCs in Indian government schools do not have that, and the teachers I build for plan on a phone, which cannot run it yet. Without Gemini Nano, this browser uses rules only to find needs — it finds fewer needs, and still sends nothing from your notebook. There is no notebook photo scan, no on-device semantic check, and no offline lesson without Chrome's on-device model. Today the full flow fits a teacher with a recent laptop.
- **The demo's cloud is the free Gemini Developer API.** Under Google's Unpaid Services terms, Google may use submitted text to improve its products and human reviewers may read it, and Google tells developers not to send personal or sensitive data there. Only the fixed-catalogue needs and lesson fields cross; a school should use a paid tier, where prompts are not used for training.
- **Free wording is opt-in and checked.** If a teacher writes her own classroom-action line outside the fixed catalogue, the exit gate scans it, requires her explicit tick (**Send my own wording**), and flags it **Your own words**. A teacher can still deliberately write something unwise there or tick past it, though no raw notebook sentence can cross automatically.
- **A letter is not anonymity inside the classroom.** The cloud cannot tell whose need it is. Classmates looking at a printed sheet sometimes can.
- No teacher has used this in a classroom yet. Every pupil, note and photo is invented.
- Gemini Nano checks lessons written in English. Lessons in Hindi are checked by rules. The screens are in English, with a short Hindi line under some of the main buttons.

## What's next

A trial with teachers on invented and then real classes, with a school's consent. Android via the Firebase AI Logic Android hybrid SDK once on-device Gemini Nano reaches the phones teachers own, because that is where most of them plan. Reducing on-device harmless entity over-tagging without sacrificing Hindi/Hinglish recall, plus full Hindi screens.
