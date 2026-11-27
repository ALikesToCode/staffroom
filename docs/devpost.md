# Staffroom: Devpost text

## Tagline

Your device knows the child. The cloud only knows the need.

*Category: Best Web. Live app: https://staffroom-hybrid-8a71.web.app. Source: https://github.com/ALikesToCode/staffroom.*

## Try it in 30 seconds (Judge guide)

1. Open [staffroom-hybrid-8a71.web.app](https://staffroom-hybrid-8a71.web.app).
   - **In Chrome 158+ with Gemini Nano ready**: click **Write a note -> Try sample notebook photo** to watch multimodal Gemini Nano transcribe handwritten notes locally in ~7.1s with 0 cloud requests (`extractScannedClassList` pulls names locally from the OCR text), or click **Try an invented class** to run the 1-pass on-device guard, inspect `Tanvi Rao`'s `Found by Gemini Nano` (`days-away`, *Every Tuesday she goes with her grandmother to the town clinic...*) catch, approve the redacted text, generate a streamed cloud lesson (`gemini-3.5-flash-lite`), try **More ideas from this device** (`fit`), compare **Class copy** vs **Teacher's copy**, mark the exit ticket (`Got it / Partly / Not yet / Absent`) in the **Lessons** tab, and verify everything live in **Inspect**.
   - **In any browser (with or without Gemini Nano)**: click **Watch a recorded run** (`public/recorded-run.json`) to replay a complete real Chrome 158 + Gemini Nano run (`1 Write · 2 What leaves · 3 Lesson · 4 Beside each child · 5 Sign off`), trace every `Need A`–`Need O` code across the door (including `Tanvi Rao`'s Nano-exclusive `Need E: away on Tuesdays` -> take-home Monday summary sheet), toggle **Preview class & teacher copies**, inspect 1-click materials (`Board work`, `Practice sheet`, `Need` sheets, `Exit ticket`), and open **Inspect** to verify all 6 routes (including `scan`) alongside the browser Resource Timing log.

## Value proposition

Teachers preparing lessons on shared **school ICT-lab or staffroom desktops** want practical plans tuned to their class, without uploading raw notes naming a child's illness, parents' separation, unpaid fees, caste taunts, or phone number to a cloud model. Putting that privacy split first aligns naturally with the data-minimization and children's protection principles of **India's Digital Personal Data Protection (DPDP) Act 2023** (with Section 9 verifiable parental consent rules scheduled for commencement in May 2027), while avoiding generic plans that break real pupil constraints.

**Staffroom puts the privacy split at the door and across every stage:**

1. **The device knows the child**: Gemini Nano + deterministic rules (including Hinglish and Devanagari sensitive terms, Devanagari `।`/`॥` sentence boundaries, and Hinglish/Devanagari singular pronouns in `ONE_PERSON`) read raw teacher notes and handwritten notebook photos locally (`ONLY_ON_DEVICE`), withholding names, places, phone numbers, roll numbers, and private clauses into stand-ins while building local per-child constraints.
2. **The cloud only knows the need**: What leaves the browser for `Tomorrow's lesson` contains zero names, zero reasons, zero diagnoses, and zero single-pupil prose — only class-wide context, lesson metadata, and abstract capability codes (`Need A: cannot stay after the last bell`, `Need E: away on Tuesdays`, etc.). Non-lesson tasks (`Support plan`, `Messages to parents`, `Hand-over`) send redacted prose with stand-ins (`[Student 1]`, `[withheld]`) and approved needs.
3. **The device puts the child back beside the lesson**: Locally in Chrome, Staffroom maps each cloud variation back onto the right pupil, deduplicates overlapping `group`-need variations against named pair adjustments (`Seat Kabir and Ishaan apart.` / `Put Kabir and Ishaan in different groups.`), lets **Gemini Nano** run empathetic per-child fits (**More ideas from this device**), and prints two copies: an anonymous **Class copy** (`No names · letter codes only`) beside a private **Teacher's copy** with restored names.

Designed for a shared **school ICT-lab or staffroom desktop**: raw notes, class lists, constraints, and **saved lessons all stay in `sessionStorage` by default** (`localStorage` is strictly opt-in via *Keep this class in this browser*), and **Clear desk** wipes notes, class list, saved lessons, and receipts from browser storage.

## What it does

- **Handwritten notebook scan (`scan`, `ONLY_ON_DEVICE`)**: Accepts a notebook photo or the sample register page (`public/sample-notebook.jpg`, precached by the PWA), checks `imageOnDeviceStatus()`, downscales locally on `<canvas>` (`<= 1024px` JPEG), and transcribes verbatim via multimodal Gemini Nano (`0` cloud calls), extracting pupil names directly from the scanned text via `extractScannedClassList()` (only the sample button falls back to `SAMPLE_LESSON` when lesson fields are blank).
- **1-pass hybrid privacy guard & full-payload Exit Gate (`guard`, `ONLY_ON_DEVICE`)**: Pairs deterministic rules with `guardCombinedOnDevice` (`~4.1s` median) to extract entities, private clauses, and constraints in one pass per paragraph. `isRedundantWithLearning` folds overlapping unconfirmed Nano proposals (including non-time `time-after`/`time-before` overlaps lacking schedule cues) into confirmed learning needs, while `constraintsFromCombined` skips heading paragraphs. Before sending, `outgoingOf()` runs `checkOutgoing()` across the entire assembled outgoing text (including assembled `Need` blocks) and blocks send on any leak.
- **Need-coded cloud lesson + mid-stream recovery (`draft`, `PREFER_IN_CLOUD`)**: Streams lessons and materials from `gemini-3.5-flash-lite` (Remote Config controlled) using strict schemas, asking for concrete catch-up steps on recurring absence days (`Need E: away on Tuesdays`). If the cloud request fails pre-start, drops mid-stream, or returns silently truncated JSON, `streamContent()` clears any partial preview and recovers via `onDeviceFallbackFor` (`ONLY_ON_DEVICE` Gemini Nano streaming).
- **Local Return Gate, empathetic child fits, materials, two copies & exit-ticket loop**: The deterministic Return Gate checks cloud or fallback replies offline and online; `check` runs locally against confirmed constraints; `fit` refuses insensitive family/money/health recall prompts in `FIT_LESSON_SYSTEM` and `readPoints`; **Materials** generates 1-click board work, practice sheet, per-Need sheets, and exit ticket; **Class copy** & **Teacher's copy** render cleanly side by side; and the **Lessons** tab captures private **`Got it` / `Partly` / `Not yet` / `Absent`** marks per need to drive the next lesson.

## How Firebase AI Logic is used

All model calls route through [`src/ai/routes.ts`](../src/ai/routes.ts) using `@firebase/ai` across all three Firebase AI Logic hybrid modes (`ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, and `PREFER_ON_DEVICE`):

| Route | Mode | Input | Role & guardrails |
|---|---|---|---|
| `scan` | `ONLY_ON_DEVICE` | Local JPEG `<= 1024px` | Checks `imageOnDeviceStatus()` and runs multimodal Gemini Nano OCR; throws before request if unavailable and aborts if `inferenceSource !== 'on_device'`. |
| `guard` | `ONLY_ON_DEVICE` | Raw paragraph | 1-pass entity, private phrase, & constraint extraction (`guardCombinedOnDevice`); fails closed if non-`on_device` or invalid JSON; heading paragraphs skipped for constraints. |
| `draft` | `PREFER_IN_CLOUD` | Gate-approved text only | Streams (`generateContentStream`) class lesson & materials from Remote Config (`gemini-3.5-flash-lite`); recovers pre-start, mid-stream, or on truncated JSON via `onDeviceFallbackFor` (`ONLY_ON_DEVICE`). |
| `check` | `ONLY_ON_DEVICE` | Single step + one constraint | Compares one draft step against one local constraint alongside deterministic rules. |
| `fit` | `ONLY_ON_DEVICE` | Step / child note + stages | Rewrites conflicting step (`fitForChild`) or offers empathetic child fits (`fitLessonForChild`), rule- and filter-checked before offer. |
| `label` | `PREFER_ON_DEVICE` | Concise metadata/snippet (`<= 240` chars) | Short receipt title from lesson metadata (`klass — subject — topic`) or `<= 240`-char redacted snippet (`LABEL_CHARS = 240`); runs on-device when ready, can fall back to cloud on that metadata, or uses local `FALLBACK`. |

Security & proof in **Inspect**: shows live route execution (including `scan`) alongside **Network, as the browser records it** (`performance.getEntriesByType('resource')` filtered to Google/Firebase hosts for that session), paired with strict Firebase Hosting headers (`Content-Security-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`).

## Measured, not claimed

All benchmarks below were run in **Chrome `158.0.8127.88` (Linux)** with Gemini Nano against invented test sets ([`docs/evals/2026-11-28/`](evals/2026-11-28/) and [`docs/evals/`](evals/)):

- **1-pass Combined Guard (`GUARD_CASES`: 12 notes × 60 private details × 3 runs = 180 judgements)**:
  - Rules alone: `40/60` fully caught (`11` partly, `9` missed, `0/19` hard non-rule details caught, `5/8` harmless curriculum lines wrongly held, `1/11` constraints matched, `3 ms` median).
  - Rules + `guardCombinedOnDevice`: **`148/180` (`49.3/60` avg: 48, 49, 51)** fully caught, `25/180` partly, **`7/180` (`2.3/60` avg)** missed, `25/57` hard non-rule details caught, `123/123` standard details caught, **`2.0/8` harmless items wrongly held**, `11/33` exact labelled constraints matched (**`40` unconfirmed extra constraints proposed** across 36 runs; Round 2 also added `isRedundantWithLearning` time-cue folding for non-time `time-after`/`time-before` overlaps), `0` unread parts, `0` failures, median **`4,055 ms`** per note.
- **Multimodal Notebook Scan (`public/sample-notebook.jpg`)**: **~7.1s**, **229–231 chars** transcribed verbatim, **0** cloud inference requests observed.
- **Offline Streaming Fallback (`PREFER_IN_CLOUD -> ON_DEVICE`)**: **40,760 ms** under CDP offline emulation, live streamed preview, valid 6-step lesson mapped to all 5 children, caution notice shown.
- **On-device Check (`eval.html`, 26 Nov 2026)**: 24/24 conflicts caught on 16 unseen cases (`4/24` harmless flagged); 18/18 conflicts caught across full-note evaluation (`0/42` harmless conflicts, `3` unsure).
- **Automated suite**: `469/469` Vitest unit tests (`20` files), `tsc --noEmit` `0` errors, `impeccable detect` `0` findings, `pnpm audit` `0` known vulnerabilities.

## Challenges

1. **Keeping generic nouns and overlapping constraints clean**: Generic words like `"home"` and `"school"` previously tripped the Exit Gate against outgoing capability lines, and unconfirmed Nano overlaps sometimes surfaced redundant constraints. Filtering generic place nouns (`readGuardAnswer`), skipping heading paragraphs (`constraintsFromCombined`), and folding non-time `time-after`/`time-before` overlaps into learning needs (`isRedundantWithLearning`) kept the Need table clean.
2. **Making Gemini Nano genuinely load-bearing in the hero flow**: Making Paragraph 5 (`Tanvi Rao`) carry a natural rules-invisible recurring clinic absence (`"Every Tuesday she goes with her grandmother to the town clinic and has to miss school that day"`) paired with `VARIATION_INSTRUCTION`'s recurring-absence guidance gives live runs an un-overlapped `Found by Gemini Nano` (`days-away`) catch (`Need E: away on Tuesdays`) sent across the airgap and mapped back to a Monday catch-up summary sheet for `Tanvi Rao`.
3. **Zero duplicate seating instructions & empathetic fits**: `dedupePairVariations` suppresses redundant cloud `group` variations whenever `pairPoints` provides a concrete named adjustment (`Seat Kabir and Ishaan apart.`), `fitSummary` counts seating lines explicitly, and `FIT_LESSON_SYSTEM` + `readPoints` block prompts asking pupils to recount family/money/health hardships aloud.

## Limits

- **Hardware & browser availability**: On-device AI (`scan`, `guard`, `check`, `fit`, `label`) requires desktop Chrome 158+ with Built-in AI (`LanguageModel` text and image capabilities downloaded — a multi-GB local model footprint that may exceed constrained shared lab hardware). Other browsers run deterministic rules and can step through the recorded Chrome 158 + Nano run.
- **Language scope**: Deterministic Hinglish/Devanagari safety rules and single-pupil pronoun filters run locally, and non-English lessons can be requested from the cloud (`Language of the plan`), while deterministic conflict rules and on-device Nano checks remain primarily **English** (explicitly flagged in the UI for other languages).
- **Offline scope & invented data**: Once precached alongside Nano, local guard, deterministic Return Gate, check, fit, and fallback Nano drafting work offline; standard cloud drafting requires network connectivity. All pupil names, family notes, phone numbers, roll numbers, and notebook photos are **invented data only**; no real school trial or legal compliance certification is claimed, and live classroom rollout requires school/board governance and a paid Gemini API tier.

## Built with

React, TypeScript, Vite, `vite-plugin-pwa`, Firebase AI Logic (`@firebase/ai`, Chrome Gemini Nano + `gemini-3.5-flash-lite`), Firebase Hosting, Firebase App Check (reCAPTCHA Enterprise), Firebase Remote Config, Firebase Authentication (anonymous), Cloud Firestore, Vitest, Testing Library.
