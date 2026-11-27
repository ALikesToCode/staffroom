# Staffroom: Devpost text

## Tagline

Your device knows the child. The cloud only knows the need.

*Category: Best Web. Live app: https://staffroom-hybrid-8a71.web.app. Source: https://github.com/ALikesToCode/staffroom.*

## Try it in 30 seconds (Judge guide)

1. Open [staffroom-hybrid-8a71.web.app](https://staffroom-hybrid-8a71.web.app).
   - **In Chrome 158+ with Gemini Nano ready**: click **Write a note → Try sample notebook photo** to watch Gemini Nano transcribe handwritten notes locally in ~7.1s with 0 cloud requests, or click **Try an invented class** to run the 1-pass on-device guard (`Rules alone found X · Gemini Nano added +Y more`), inspect `Found by Gemini Nano` needs, approve the redacted text, generate a streamed cloud lesson (`gemini-3.5-flash-lite`), try **More ideas from this device** (`fit`), print side-by-side copies, and verify everything live in **Inspect**.
   - **In any browser (with or without Gemini Nano)**: click **Watch a recorded run** (`public/recorded-run.json`) to step directly through a real Chrome 158 + Gemini Nano live run (`1 Write · 2 What leaves · 3 Lesson · 4 Beside each child · 5 Sign off`), trace every `Need A`–`Need O` chip across the airgap (including `Tanvi Rao`'s `Found by Gemini Nano` leave-time need sent as `Need A`), toggle **Preview class & teacher copies**, inspect the 1-click materials (`Board work`, `Practice sheet`, `Need` sheets, `Exit ticket`), and open **Inspect** to verify the live vs recorded inference split.

## Value proposition

In India's government and aided schools — and under **India's Digital Personal Data Protection (DPDP) Act 2023, Section 9** protecting children's personal data — a teacher in a shared staffroom or school **ICT lab** cannot upload raw notes naming a child's illness, parents' separation, unpaid fees, caste taunts, or phone number to a cloud model. Stripping all context produces generic plans that break real children's constraints (after-bell remedial sessions for a pupil who must catch the 3:40 local bus home; paid apps or homework links for a household with no phone or internet).

**Staffroom puts the privacy split at the door and across every stage:**

1. **The device knows the child**: Gemini Nano + deterministic rules (supporting English, **Hinglish**, and **Devanagari** sensitive phrases and schedule patterns) read raw teacher notes and photographed handwritten notebook pages locally on the device (`ONLY_ON_DEVICE`), withholding names, places, phone numbers, roll numbers, and private clauses into stand-ins while building local per-child constraints.
2. **The cloud only knows the need**: What leaves the browser for `Tomorrow's lesson` contains zero names, zero reasons, zero diagnoses, and zero free-form child prose — only abstract capability codes (`Need A: cannot stay after the last bell`, `Need B: no phone or internet at home`, etc.). The cloud model drafts both the shared lesson and one concrete variation per letter.
3. **The device puts the child back beside the lesson**: Locally in Chrome, Staffroom maps each cloud variation back onto the right pupil, adds teacher-reviewed pair adjustments (`pair: true`, e.g., seating `Kabir` and `Ishaan` apart), lets **Gemini Nano** check each lesson step against local constraints and suggest optional child-specific fits (`More ideas from this device`), and prints two copies: a **Class copy** (`No names · letter codes only`) and a **Teacher's copy** with restored student names.

Designed for a shared **school ICT-lab or staffroom desktop** with Chrome Built-in AI: class notes are **not persisted across restarts by default** (`keepClass` defaults off, clearable anytime via **Clear desk**).

## What it does

- **Handwritten notebook scan (`scan`, `ONLY_ON_DEVICE`)**: Accepts a phone photo or sample notebook page (`public/sample-notebook.jpg`), downscales locally on `<canvas>` (`<= 1024px` JPEG), and transcribes it verbatim via multimodal Gemini Nano (`0` cloud inference calls) while auto-populating the Class list.
- **1-pass hybrid privacy guard & exit gate (`guard`, `ONLY_ON_DEVICE`)**: Runs deterministic rules (English, Hinglish, and Devanagari sensitive terms, phones, STD codes, roll numbers, sentence splitting including Devanagari `।` / `॥`) alongside `guardCombinedOnDevice`, which extracts entities, private details, and typed constraints in a single Nano pass per paragraph (`~4.1s` median vs `~20s+` 2-pass). `constraintsFromCombined` uses `studentParagraphs` to skip heading-only paragraphs and enforces verbatim substring + vault-ownership validation. A deterministic fail-closed Exit Gate blocks any send if any withheld string remains or no-Nano partial coverage leaves unchecked risk.
- **Need-coded cloud lesson + streaming UX (`draft`, `PREFER_IN_CLOUD`)**: Streams the lesson from `gemini-3.5-flash-lite` (Remote Config controlled) using strict `responseSchema` so every requested `Need` receives an action, and falls back live to Gemini Nano over `generateContentStream()` if offline or unreachable.
- **Local conflict check, child fits, materials, two print copies & next-lesson loop (`check`, `fit`, `IN_CLOUD` materials)**: Checks steps against local constraints, keeps pair adjustments distinct (`Seat Kabir and Ishaan apart.`), offers on-device child adjustments (`More ideas from this device`), generates 1-click printable materials (`Board work`, `Practice sheet`, per-Need sheets, `Exit ticket`), separates Class copy vs Teacher's copy, and updates future lessons locally from a private exit-ticket check-off (`none got it` / `some got it` / `all got it`).

## How Firebase AI Logic is used

All model access goes through `modelFor()` in [`src/ai/routes.ts`](../src/ai/routes.ts) using the `@firebase/ai` client SDK across all three Firebase AI Logic hybrid modes (`ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, and `PREFER_ON_DEVICE`):

| Route | Mode | Input | Role & guardrails |
|---|---|---|---|
| `scan` | `ONLY_ON_DEVICE` | Local JPEG `<= 1024px` | Multimodal Gemini Nano OCR (`{ type: 'text' }, { type: 'inlineData' }`). Throws before request without local multimodal Nano; verifies `inferenceSource === 'on_device'`. |
| `guard` | `ONLY_ON_DEVICE` | Raw paragraph | 1-pass entity, private phrase, & constraint extraction (`guardCombinedOnDevice`); fails closed if non-`on_device` response or unreadable JSON; heading paragraphs skipped for constraints. |
| `draft` | `PREFER_IN_CLOUD` | Gate-approved text only | Streams (`generateContentStream`) class lesson & materials from Remote Config model (`gemini-3.5-flash-lite`) with automatic local Gemini Nano fallback offline. |
| `check` | `ONLY_ON_DEVICE` | Single step + one constraint | Compares one draft step against one local constraint (`no-conflict` / `conflict` / `unclear`), paired with deterministic rule checks. |
| `fit` | `ONLY_ON_DEVICE` | Step / child note + stages | Rewrites conflicting step (`fitForChild`) or suggests child-specific stage adjustments (`fitLessonForChild` via **More ideas from this device**), rule-checked before offering. |
| `label` | `PREFER_ON_DEVICE` | Anonymous receipt summary | Short receipt label; runs on-device when Gemini Nano is ready and can fall back to the cloud on redacted receipt metadata (or deterministic fallback if offline/unconfigured; never blocks sign-off). |

Security & verification in **Inspect**: shows live route enforcement alongside browser **Resource Timing** entries (`performance.getEntriesByType('resource')`) filtered to network origin calls matching Google/Firebase endpoints for that page load (clearly noted as browser network timing observation alongside code route assertions: `0` cloud inference calls occur during `scan` and `guard`). Firebase Hosting serves strict headers (`Content-Security-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`).

## Measured, not claimed

All benchmarks below were executed in **Chrome `158.0.8127.88` (Linux)** with Gemini Nano against invented test sets ([`docs/evals/2026-11-28/`](evals/2026-11-28/) and [`docs/evals/`](evals/)):

- **1-pass Combined Guard (`GUARD_CASES`: 12 notes × 60 private details × 3 runs = 180 judgements)**:
  - Rules alone: `40/60` fully caught (`11` partly, `9` missed, `0/19` hard non-rule details caught, `5/8` harmless curriculum lines wrongly held, `1/11` constraints matched, `3 ms` median).
  - Rules + `guardCombinedOnDevice`: **`148/180` (`49.3/60` avg: 48, 49, 51)** fully caught, `25/180` partly, **`7/180` (`2.3/60` avg)** missed, `25/57` hard non-rule details caught, `123/123` standard details caught, **`2.0/8` harmless items wrongly held**, `11/33` labelled constraints matched, `0` unread parts, `0` failures, median **`4,055 ms`** per note.
- **Multimodal Notebook Scan (`public/sample-notebook.jpg`)**: **7,072 ms**, **231 chars** transcribed verbatim (`Class 6B - 16 Nov`, `Diya Sharma` 3:40 `Chandpur` bus & unpaid term fee, `Meenal Joshi` `roll no. 6B/23.`, `Phone: 98112 34560`), **0** cloud requests observed.
- **Offline Streaming Fallback (`PREFER_IN_CLOUD → ON_DEVICE`)**: **40,760 ms** with CDP offline emulation active, live streamed text preview, valid 6-step structured lesson mapped to all 5 children, and caution banner (`"The cloud draft failed, so the on-device model wrote this draft from the same approved text."`).
- **On-device Check (`eval.html`, 26 Nov 2026)**: 24/24 conflicts caught on 16 unseen held-out cases (`4/24` harmless flagged as doubts); 18/18 conflicts caught on full-note evaluation (`0/42` harmless flagged as conflicts, `3` unsure).
- **Automated suite**: `465/465` Vitest unit tests (`20` test files), `tsc --noEmit` `0` errors, `pnpm audit` `0` known vulnerabilities.

## Challenges

1. **Stopping generic nouns from tripping the Exit Gate**: Adding natural local details for Gemini Nano (`"takes the 3:40 local bus home..."`) caused Nano to occasionally place `"home"` in `places`, colliding with the standard outgoing capability lines (`at home`, `from home`). Filtering non-named generic place nouns (`home`, `two homes`, `school`, `classroom`, `exam hall`) alongside class headings (`Class 6B`) in `readGuardAnswer` eliminated false blocks while preserving named towns (`Rampur Kalan`, `Chandpur`) and `private` quotes.
2. **Making Gemini Nano load-bearing on the sample run without breaking rule contracts**: Replacing weak inline learning proposals (`3/36` valid in eval) with deterministic learning rules plus ensuring Paragraph 5 (`Tanvi`) carries a natural rules-invisible bus constraint gave live runs a real `Found by Gemini Nano` (`time-after`) need (`Need A`) sent to the cloud and placed beside `Tanvi Rao`.
3. **Keeping multimodal & Hindi/Hinglish handling reliable**: Chrome Built-in AI rejects raw `webp` buffers, so `prepareNotebookImage` normalises images to `<= 1024px` JPEG locally; Devanagari `।`/`॥` sentence terminators and `\p{M}` combining marks were added to `sentences()` and sensitivity word boundaries.

## Limits

- On-device AI (`scan`, `guard`, `check`, `fit`, `label`) requires a desktop browser supporting Chrome Built-in AI (`Chrome 158+` with Gemini Nano ready; multimodal image input available for `scan`). In other browsers, rules handle redaction without cloud uploads and the live recorded run shows the Chrome + Nano experience.
- Offline mode covers local guard, check, fit, and fallback drafting once the app and Nano model are cached by the service worker; normal cloud drafting requires network connectivity.
- All student names, family details, phone numbers, roll numbers, and notebook photos in this submission are **invented data only**; no real pupil data or live school field trial is claimed. Real classroom deployment would require a school/board DPDP-compliant cloud agreement rather than the Firebase Developer free tier.

## Built with

React, TypeScript, Vite, `vite-plugin-pwa`, Firebase AI Logic (`@firebase/ai`, Chrome Gemini Nano + `gemini-3.5-flash-lite`), Firebase Hosting, Firebase App Check (reCAPTCHA Enterprise), Firebase Remote Config, Firebase Authentication (anonymous), Cloud Firestore, Vitest, Testing Library.
