# Staffroom: Devpost text

## Tagline

Your device knows the child. The cloud only knows the need.

*Category: Best Web. Live app: https://staffroom-hybrid-8a71.web.app. Source: https://github.com/ALikesToCode/staffroom.*

## Try it in 30 seconds (Judge guide)

1. **Any browser (no setup required)**: open [staffroom-hybrid-8a71.web.app](https://staffroom-hybrid-8a71.web.app) and click **Watch a recorded run** (`public/recorded-run.json`):
   - Advance through `1 Write · 2 What leaves · 3 Lesson · 4 Beside each child · 5 Sign off` and hover/focus **`Need E: away on Tuesdays`** across The Door to trace how `Tanvi Rao`'s Nano-discovered clinic constraint becomes a Monday take-home sheet without naming Tanvi or her clinic visit to the cloud.
   - Toggle **Preview class & teacher copies** to compare the nameless **Class copy** (`No names · letter codes only`) with the private **Teacher's copy**, inspect 1-click **Materials** (`Sheet for Need E` and the reconstructed `2,570`-character nameless outgoing text), and open **Inspect** to review all 6 recorded route statuses and 7 scrubbed per-step Resource Timing measurements. (When you sign off a live lesson, separate **Print class copy (no names)** and **Print teacher's copy (private)** actions appear, and `Ctrl+P` / `Cmd+P` safely defaults to `class-only` without rendering Teacher's copy.)
2. **In Chrome 158+ with Gemini Nano ready**: click **Write a note -> Try sample notebook photo** to watch multimodal Gemini Nano transcribe handwritten notes locally in ~7.5s (`extractScannedClassList` extracts `Diya Sharma, Meenal Joshi` locally from the OCR text without phone-number metadata leaks), or click **Try an invented class** to run the live 1-pass on-device guard, inspect `Tanvi Rao`'s `Found by Gemini Nano` (`days-away`) catch, approve the minimized text, stream a live cloud lesson (`gemini-3.5-flash-lite`), try **More ideas from this device** (`fit`), mark the exit ticket (`Got it / Partly / Not yet / Absent`) in the **Lessons** tab, and inspect live Chrome Resource Timing entries.
   - *Returning-visit & App Check note*: If a returning visit shows `Update available -> Reload`, click **Reload** for the latest build. Standard Chrome profiles pass reCAPTCHA Enterprise App Check cleanly for live cloud runs; strict incognito or automated browser sessions may hit reCAPTCHA 403 throttling (in which case **Watch a recorded run** works without App Check or Nano).

## Value proposition

Teachers preparing lessons on shared **school ICT-lab or staffroom desktops** want practical plans tuned to their class, without uploading raw notes naming a child's illness, parents' separation, unpaid fees, caste taunts, or phone number to a cloud model. Putting that privacy split first aligns naturally with the data-minimization and children's protection principles of **India's Digital Personal Data Protection (DPDP) Act 2023** (with Section 9 verifiable parental consent rules scheduled for commencement in May 2027), while avoiding generic plans that break real pupil constraints.

**Staffroom puts the privacy split at the door and across every stage:**

1. **The device knows the child**: Gemini Nano + deterministic rules (including Hinglish and Devanagari sensitive terms, Devanagari `।`/`॥` sentence boundaries, and Hinglish/Devanagari singular pronouns in `ONE_PERSON`) read raw teacher notes and handwritten notebook photos locally (`ONLY_ON_DEVICE`), withholding names, places, phone numbers, roll numbers, and private clauses into stand-ins while building local per-child constraints.
2. **Teacher-reviewed data minimization across the door**: For `Tomorrow's lesson`, `classSentences()` filters out single-pupil sentences containing withheld tokens, released pupil/adult names, mostly-withheld fragments, or English/Hinglish/Devanagari singular third-person pronouns, and `outgoingOf()` runs `checkOutgoing()` over the entire assembled outgoing text before approval. What crosses is **class-wide context**, **lesson metadata**, **lettered need descriptions** (`Need A: cannot stay after the last bell`, `Need E: away on Tuesdays`), and **formatting instructions** — leaving out flagged names, reasons, diagnoses, and identified single-pupil sentences under mandatory teacher review. Non-lesson tasks (`Support plan`, `Messages to parents`, `Hand-over`) send redacted prose with stand-ins (`[Student 1]`, `[withheld]`) and approved needs.
3. **The device puts the child back beside the lesson**: Locally in Chrome, Staffroom maps each cloud variation back onto the right pupil, deduplicates overlapping `group`-need variations against named pair adjustments (`Seat Kabir and Ishaan apart.` / `Put Kabir and Ishaan in different groups.`), lets **Gemini Nano** run empathetic per-child fits (**More ideas from this device**), offers separate print actions (**Print class copy (no names)** vs **Print teacher's copy (private)**), and keeps **Materials** printable as letter codes only by default.

Designed for a shared **school ICT-lab or staffroom desktop**: raw notes, class lists, constraints, **saved lessons, and text-bearing local receipts all default to `sessionStorage`** (`localStorage` is strictly opt-in via *Keep this class in this browser*, and both `storeReceipts()` and `storeLessons()` preserve session copies if persistent opt-in fails), native `Ctrl+P` / `Cmd+P` safely defaults to `class-only` on signed lessons, and **Clear desk** wipes `sessionStorage`, persisted class/lessons/receipts, the `staffroom.keepCopies` preference, and signs out the anonymous Firebase Auth session (`clearUserSession()`; optional count-only Firestore receipt records already written under explicit *Keep a copy* opt-in remain in Firestore).

## What it does

- **Handwritten notebook scan (`scan`, `ONLY_ON_DEVICE`)**: Accepts a notebook photo or the sample register page (`public/sample-notebook.jpg`, precached by the PWA), checks `imageOnDeviceStatus()`, downscales locally on `<canvas>` (`<= 1024px` JPEG), and transcribes verbatim via multimodal Gemini Nano, extracting pupil names directly from the scanned text via `extractScannedClassList()` (only the sample button falls back to `SAMPLE_LESSON` when lesson fields are blank).
- **1-pass hybrid privacy guard & full-payload Exit Gate (`guard`, `ONLY_ON_DEVICE`)**: Pairs deterministic rules with `guardCombinedOnDevice` (`~4.1s` median) to extract entities, private clauses, and constraints in one pass per paragraph. `isRedundantWithLearning` folds overlapping unconfirmed Nano proposals (including non-time `time-after`/`time-before` overlaps lacking schedule cues) into confirmed learning needs, while `constraintsFromCombined` skips heading paragraphs. Before sending, `outgoingOf()` runs `checkOutgoing()` across the entire assembled outgoing text (including assembled `Need` blocks) and blocks send on any known leak.
- **Need-coded cloud lesson + local fallback (`draft`, `PREFER_IN_CLOUD`)**: Streams lessons and materials from `gemini-3.5-flash-lite` (Remote Config controlled) using strict schemas, asking for concrete catch-up steps on recurring absence days (`Need E: away on Tuesdays`). Chrome 158 offline-before-send runs confirm pre-start failover (`40.76s`) and local Return Gate verification; unit tests (`src/ai/routes.test.ts`) exercise mid-stream drop and silently truncated cloud JSON recovery via `onDeviceFallbackFor` while preserving original cloud error diagnostics if Nano isn't downloaded.
- **Local Return Gate, empathetic child fits, materials, separate copies & exit-ticket loop**: The deterministic Return Gate checks cloud or fallback replies offline and online; `check` runs locally against confirmed constraints; `fit` refuses intrusive family/money/health prompts in `FIT_LESSON_SYSTEM` and `readPoints` while preserving materials warnings into saved lessons; **Materials** generates 1-click board work, practice sheet, per-Need sheets (names off by default when printing), and exit ticket; **Class copy** & **Teacher's copy** preview cleanly side by side and print separately; and the **Lessons** tab captures private **`Got it` / `Partly` / `Not yet` / `Absent`** marks per need to drive the next lesson.

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

Security & proof in **Inspect**: shows live or recorded route statuses across all 6 routes (honestly reporting `Not recorded` when absent in older captures) alongside **Network, as the browser records it** (`performance.getEntriesByType('resource')` across all hosts, counting `firebasevertexai.googleapis.com` model-host requests vs other page requests per step), paired with strict Firebase Hosting headers (`Content-Security-Policy` including `connect-src 'self' data:` so `@firebase/ai`'s Chrome Built-in AI multimodal `inlineData` adapter decodes local images locally without network requests, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`).

## Measured, not claimed

All benchmarks below were run in **Chrome `158.0.8127.88` (Linux)** with Gemini Nano against invented test sets ([`docs/evals/2026-11-28/`](evals/2026-11-28/) and [`docs/evals/`](evals/)):

| Check / Eval | Scope & Denominator | Measured Outcome |
|---|---|---|
| **1-pass Combined Guard** (`GUARD_CASES`) | `12` distinct invented notes, `60` labelled details total, run `3×` (`180` judgments) | **`148/180`** (`49.3/60` avg: `48, 49, 51`) vs `40/60` rules alone; `25/180` partial; **`7/180` (`2.3/60`) missed**; `25/57` hard non-rule details caught; **`6/24` (`2.0/8`) harmless held** vs `5/8`; `11/33` exact constraint matches (`+40` unconfirmed extras); `4,055 ms` median |
| **Multimodal Notebook Scan** (`scan`) | Single invented handwritten specimen (`public/sample-notebook.jpg`) | **`~7.1s`**, `229–231` chars transcribed verbatim, **`0` cloud calls** |
| **Offline-before-send Fallback** (`draft`) | `SAMPLE_NOTE` under CDP offline emulation before approval | **`40,760 ms`** `PREFER_IN_CLOUD -> ON_DEVICE` stream + local Return Gate check |
| **On-device Check** (`?set=heldout` / `?set=check`) | `16` held-out single-fact cases (`8` conflicts × `3` = `24`; `8` harmless × `3` = `24`) | **`24/24`** conflicts caught (`4/24` harmless flagged); `18/18` on full-note eval (`0/42` harmless conflicts) |
| **Automated Suite & Security** | Local test runner + TypeScript + security audit | **`480/480`** Vitest tests (`21` files), `0` TS errors, `0` audit vulnerabilities |

## Challenges

1. **Keeping generic nouns and overlapping constraints clean**: Generic words like `"home"` and `"school"` previously tripped the Exit Gate against outgoing capability lines, and unconfirmed Nano overlaps sometimes surfaced redundant constraints. Filtering generic place nouns (`readGuardAnswer`), skipping heading paragraphs (`constraintsFromCombined`), and folding non-time `time-after`/`time-before` overlaps into learning needs (`isRedundantWithLearning`) kept the Need table clean.
2. **Making Gemini Nano genuinely load-bearing in the hero flow**: Making Paragraph 5 (`Tanvi Rao`) carry a natural rules-invisible recurring clinic absence (`"Every Tuesday she goes with her grandmother to the town clinic and has to miss school that day"`) paired with `VARIATION_INSTRUCTION`'s recurring-absence guidance gives live runs an un-overlapped `Found by Gemini Nano` (`days-away`) catch (`Need E: away on Tuesdays`) sent across the airgap and mapped back to a Monday catch-up summary sheet for `Tanvi Rao`.
3. **Zero duplicate seating instructions & empathetic fits**: `dedupePairVariations` suppresses redundant cloud `group` variations whenever `pairPoints` provides a concrete named adjustment (`Seat Kabir and Ishaan apart.`), `fitSummary` counts seating lines explicitly, and `FIT_LESSON_SYSTEM` + `readPoints` block intrusive family/money/health hardship prompts cleanly.

## Limits

- **Hardware & browser availability**: On-device AI (`scan`, `guard`, `check`, `fit`, `label`) requires desktop Chrome 158+ with Built-in AI (`LanguageModel` text and image capabilities downloaded — a multi-GB local model footprint that may exceed constrained shared lab hardware). Other browsers run deterministic rules and can step through the recorded Chrome 158 + Nano run.
- **Language scope**: Deterministic Hinglish/Devanagari safety rules and single-pupil pronoun filters run locally, and non-English lessons can be requested from the cloud (`Language of the plan`), while both deterministic conflict rules and on-device Nano step checking run in **English only** (non-English lesson drafts skip local conflict checking with an explicit `NOT_ENGLISH` banner).
- **Offline scope & invented data**: Once precached alongside Nano, local guard, deterministic Return Gate, check, fit, and fallback Nano drafting work offline; standard cloud drafting requires network connectivity. All pupil names, family notes, phone numbers, roll numbers, and notebook photos are **invented data only**; no real school pilot, teacher workload study, or legal compliance certification is claimed, and live classroom rollout requires school/board governance and a paid Gemini API tier.

## Built with

React, TypeScript, Vite, `vite-plugin-pwa`, Firebase AI Logic (`@firebase/ai`, Chrome Gemini Nano + `gemini-3.5-flash-lite`), Firebase Hosting, Firebase App Check (reCAPTCHA Enterprise), Firebase Remote Config, Firebase Authentication (anonymous), Cloud Firestore, Vitest, Playwright.
