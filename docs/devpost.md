# Staffroom: Devpost text

## Tagline

Your device knows the child. The cloud only knows the need.

*Category: Best Web. Live app: https://staffroom-hybrid-8a71.web.app. Source: https://github.com/ALikesToCode/staffroom.*

## Try it in 30 seconds (Judge guide)

1. **Any browser (no setup required)**: open [staffroom-hybrid-8a71.web.app](https://staffroom-hybrid-8a71.web.app) and click **Watch a recorded run** (`public/recorded-run.json`):
   - Advance through `1 Write · 2 What leaves · 3 Lesson · 4 Beside each child · 5 Sign off` and hover/focus **`Need E: away on Tuesdays`** across The Door to trace how `Tanvi Rao`'s Nano-discovered clinic constraint becomes a take-home summary sheet without naming Tanvi or her clinic visit to the cloud.
   - Toggle **Preview class & teacher copies** to compare the nameless **Class copy** (`No names · letter codes only`) with the private **Teacher's copy**, inspect 1-click **Materials** (`Sheet for Need E` and the nameless outgoing text), and open **Inspect** to review all 6 hybrid routes across 7 recorded steps (`scan`, `guard`, `draft`, `check`, `fit`, `label`, plus `materials` on `draft`) and 7 scrubbed per-step Resource Timing measurements (`0` model-host requests on all 5 local routes).
2. **In Chrome 158+ with Gemini Nano ready**: click **Write a note -> Try sample notebook photo** to watch multimodal Gemini Nano transcribe handwritten notes locally in `3.1s` (`4.4s` end-to-end; `extractScannedClassList` extracts `Diya Sharma, Meenal Joshi` locally without phone-number metadata leaks), or click **Try an invented class** to run the live 1-pass on-device guard, inspect `Tanvi Rao`'s `Found by Gemini Nano` (`days-away`) catch, approve the minimized text (`Exit gate: 0 known names/IDs · Review required`), stream a live cloud lesson (`gemini-3.5-flash-lite`), try **More ideas from this device** (`fit`), mark the exit ticket (`Got it / Partly / Not yet / Absent`) in the **Lessons** tab, and inspect live Chrome Resource Timing entries.
   - *Returning-visit & App Check note*: If a returning visit shows `Update available -> Reload`, click **Reload** for the latest build. Standard Chrome profiles pass reCAPTCHA Enterprise App Check cleanly for live cloud runs; strict incognito or automated browser sessions may hit reCAPTCHA 403 throttling (in which case **Watch a recorded run** works without App Check or Nano).

## Value proposition

Teachers preparing lessons on shared **school ICT-lab or staffroom desktops** want practical plans tuned to their class, without uploading raw notes naming a child's illness, parents' separation, unpaid fees, caste taunts, or phone number to a cloud model. Putting that privacy split first aligns naturally with the data-minimization and children's protection principles of **India's Digital Personal Data Protection (DPDP) Act 2023** (with Section 9 verifiable parental consent rules scheduled for commencement in May 2027), while avoiding generic plans that break real pupil constraints.

**Staffroom puts the privacy split at the door and across every stage:**

1. **The device knows the child**: Gemini Nano + deterministic rules (including Hinglish and Devanagari sensitive/loss/hunger/fee terms, Devanagari `।`/`॥` sentence boundaries, and Hinglish/Devanagari singular pronouns in `ONE_PERSON`) read raw teacher notes and handwritten notebook photos locally (`ONLY_ON_DEVICE`), withholding names, places, phone numbers, roll numbers, and private clauses into stand-ins while building local per-child constraints.
2. **Teacher-reviewed data minimization across the door**: For `Tomorrow's lesson`, `classSentences()` filters out single-pupil sentences containing withheld tokens, released pupil/adult names, mostly-withheld fragments, or English/Hinglish/Devanagari singular third-person pronouns, and `outgoingOf()` runs `checkOutgoing()` over the entire assembled outgoing text before approval (`Exit gate: 0 known names/IDs · Review required`). What crosses is **class-wide context**, **lesson metadata**, **lettered need descriptions** (`Need A: cannot stay after the last bell`, `Need E: away on Tuesdays`), and **formatting instructions** — leaving out flagged names, reasons, diagnoses, and identified single-pupil sentences under mandatory teacher review. Non-lesson tasks (`Support plan`, `Messages to parents`, `Hand-over`) send redacted prose with stand-ins (`[Student 1]`, `[withheld]`) and approved needs.
3. **The device puts the child back beside the lesson**: Locally in Chrome, Staffroom maps each cloud variation back onto the right pupil, deduplicates overlapping `group`-need variations against named pair adjustments (`Seat Kabir and Ishaan apart.` / `Put Kabir and Ishaan in different groups.`), runs deterministic **English & Devanagari Hindi Layer A conflict rules**, lets **Gemini Nano** run subject-aware empathetic per-child fits (**More ideas from this device**), offers separate print actions (**Print class copy (no names)** vs **Print teacher's copy (private)**), and keeps **Materials** printable as letter codes only by default.

Designed for a shared **school ICT-lab or staffroom desktop**: raw notes, class lists, constraints, **saved lessons, and text-bearing local receipts default to `sessionStorage`** (`localStorage` is strictly opt-in via *Keep this class in this browser*), native `Ctrl+P` / `Cmd+P` safely defaults to `class-only` on signed lessons, and **Clear desk** wipes `sessionStorage`, persisted class/lessons/receipts, `staffroom.keepCopies`, and signs out the anonymous Firebase Auth session (`clearUserSession()`, surfacing a persistent `signout-failed` warning with **Retry sign-out** and fail-closed copy gating if sign-out fails).

## Why hybrid architecture outperforms single-tier baselines

| Architecture | Raw Pupil Identities | Semantic Catch (12 notes × 3 = 180) | Harmless False Holds (`24` evals) | Class Lesson + `Need` Coverage | Offline Capability |
|---|---|---|---|---|---|
| **Cloud-only** (raw paste) | Uploaded to cloud | Cloud sees everything | — | High | None |
| **Rules-only** (no Nano) | Withheld locally | `46.0/60` (`138/180`), `2 ms` | `9/24` (`3.0/8`) | Cloud only if manually redacted | Local check only |
| **On-device Nano-only** | Withheld locally | `51.0/60` (same local guard) | `0/24` (`0.0/8`) | `23.3s` streaming, `12/12` needs via `OFFLINE_LESSON_NEEDS_SCHEMA` + `normalizeOfflineNeeds` (`0` missing, `0` brackets) | Full offline fallback |
| **Staffroom Hybrid** (`Nano + Flash Lite`) | **Withheld locally (`0` leaks on 35-pupil fixture; `6/180` missed on 12-note eval)** | **`51.0/60` (`153/180`, `3.81s` median)** + `67` spans on `35` pupils | **`0/24` (`0.0/8`)** | **`4.4s` cloud plan + `4.1s` Materials (`9` written + `3` already suited, `0` missing)** + **23.3s** offline fallback | **Pre-cached local routes + Nano lesson fallback** |

## What it does

- **Handwritten notebook scan (`scan`, `ONLY_ON_DEVICE`)**: Accepts a notebook photo or the sample register page (`public/sample-notebook.jpg`, precached by the PWA), checks `imageOnDeviceStatus()`, downscales locally on `<canvas>` (`<= 1024px` JPEG), and transcribes verbatim via multimodal Gemini Nano (`3.1s` model step / `4.4s` UI end-to-end, `231` chars, `0` cloud calls), extracting pupil names directly from the scanned text via `extractScannedClassList()` (`Diya Sharma`, `Meenal Joshi`, `0` phone numbers).
- **1-pass hybrid privacy guard & full-payload Exit Gate (`guard`, `ONLY_ON_DEVICE`)**: Pairs deterministic rules with `guardCombinedOnDevice` (`3.81s` median) to extract entities, private clauses, and constraints in one pass per paragraph (`153/180` = `51.0/60` caught, **`0/24` false holds**, `12/33` exact constraint matches `+19` extras; `67` spans held with `+17` Nano catches on a `35`-pupil note with `0` leaks). Before sending, `outgoingOf()` runs `checkOutgoing()` across the entire assembled outgoing text and displays `Exit gate: 0 known names/IDs · Review required`.
- **Need-coded cloud lesson + fast offline Nano fallback (`draft`, `PREFER_IN_CLOUD`)**: Streams lessons and materials from `gemini-3.5-flash-lite` (Remote Config controlled) using strict schemas, asking for concrete catch-up steps on recurring absence days (`Need E: away on Tuesdays`). When offline (`navigator.onLine === false`) or on mid-stream failure, `writeDraft()` routes through `OFFLINE_LESSON_SYSTEM` + `OFFLINE_LESSON_NEEDS_SCHEMA` + `offlineLessonPrompt()` and normalizes Nano adjustments via `normalizeOfflineNeeds()`, finishing in **`23.3s`** on Chrome 158 with **`12/12` needs written for a stage (`0` missing) and `0` `[Student]` bracket leaks**.
- **Local Return Gate, Hindi Layer A rules, empathetic fits, materials & exit-ticket loop**: The deterministic Return Gate checks replies offline and online; `check` runs locally against confirmed constraints (plus deterministic **Devanagari Hindi Layer A conflict rules** for time, days, money, phone/internet, home items, pair seating, and homework); `fit` passes lesson header & subject (`FIT_LESSON_SYSTEM`) to prevent off-subject or intrusive hardship prompts; **Materials** generates 1-click board work, practice sheet, per-Need sheets (names off by default when printing), and exit ticket; **Class copy** & **Teacher's copy** preview cleanly side by side and print separately; and **Lessons** captures private **`Got it` / `Partly` / `Not yet` / `Absent`** marks per need.

## How Firebase AI Logic is used

All model calls route through [`src/ai/routes.ts`](../src/ai/routes.ts) using `@firebase/ai` across all three Firebase AI Logic hybrid modes (`ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, and `PREFER_ON_DEVICE`), orchestrated from modular UI and storage layers (`src/app/storage.ts`, `src/ui/` components):

| Route | Mode | Input | Role & guardrails |
|---|---|---|---|
| `scan` | `ONLY_ON_DEVICE` | Local JPEG `<= 1024px` | Checks `imageOnDeviceStatus()` and runs multimodal Gemini Nano OCR; throws before request if unavailable and aborts if `inferenceSource !== 'on_device'`. |
| `guard` | `ONLY_ON_DEVICE` | Raw paragraph | 1-pass entity, private phrase, & constraint extraction (`guardCombinedOnDevice`); fails closed if non-`on_device` or invalid JSON; heading paragraphs skipped for constraints. |
| `draft` | `PREFER_IN_CLOUD` | Gate-approved text only | Streams (`generateContentStream`) class lesson & materials from Remote Config (`gemini-3.5-flash-lite`); recovers via `OFFLINE_LESSON_SYSTEM` + `OFFLINE_LESSON_NEEDS_SCHEMA` + `offlineLessonPrompt` + `normalizeOfflineNeeds` pre-start, mid-stream, or on incomplete JSON. |
| `check` | `ONLY_ON_DEVICE` | Single step + one constraint | Compares one draft step against one local constraint alongside deterministic English & Hindi Layer A rules. |
| `fit` | `ONLY_ON_DEVICE` | Step / child note + stages | Rewrites conflicting step (`fitForChild`) or offers subject-aware empathetic child fits (`fitLessonForChild`), rule- and filter-checked before offer. |
| `label` | `PREFER_ON_DEVICE` | Concise metadata/snippet (`<= 240` chars) | Short receipt title (`LABEL_CHARS = 240`); runs on-device when ready (`200 ms`, `0` model-host requests), can fall back to cloud, or uses local `FALLBACK`. |

Security & proof in **Inspect**: shows live or recorded route statuses across all 6 routes alongside **Network, as the browser records it** (`performance.getEntriesByType('resource')` across all hosts), paired with strict Firebase Hosting headers (`Content-Security-Policy` including `connect-src 'self' data:` so `@firebase/ai`'s Chrome Built-in AI multimodal `inlineData` adapter decodes local images locally without network requests, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`).

## Measured, not claimed

All benchmarks below were run in **Chrome `158.0.8127.88` (Linux)** with Gemini Nano against invented test sets ([`docs/evals/2026-11-28/`](evals/2026-11-28/) and [`docs/evals/`](evals/)):

| Check / Eval | Scope & Denominator | Measured Outcome |
|---|---|---|
| **1-pass Combined Guard** (`guard-combined-v2.json`) | `12` distinct invented notes, `60` labelled details total, run `3×` (`180` judgments) | **`153/180`** (`51.0/60` across all 3 runs) vs `46.0/60` (`138/180`) rules alone; `21/180` partial; **`6/180` (`2.0/60`) missed**; `30/57` hard non-rule details caught; **`0/24` (`0.0/8`) harmless held** vs `9/24` rules; `12/33` exact constraints (`+19` extras); **`3,806 ms` (`3.81s`) median** |
| **35-Pupil Scale Stress Test** (`scale-35.json`) | Synthetic `35`-pupil note (`2,177` chars across `16` paragraphs) | **`67` spans withheld** (`+17` Nano beyond `50` rules), **`0` unread / dropped / partial**, **`0` exit-gate stops, `0` leaked tokens** (`50.3s`) |
| **Multimodal Notebook Scan** (`scan`) | Single invented handwritten specimen (`public/sample-notebook.jpg`) | **`3.1s` model step (`4.4s` end-to-end)**, `231` chars transcribed verbatim, **`0` cloud calls**, `2` names extracted |
| **Offline-before-send Fallback** (`draft`) | `SAMPLE_NOTE` (12 needs) under CDP offline emulation before approval | **`23,298 ms` (`23.3s`)** `PREFER_IN_CLOUD -> ON_DEVICE` stream + Return Gate: **`12/12` needs written for a stage (`0` missing), `0` `[Student]` bracket leaks** |
| **On-device Check** (`?set=heldout` / `?set=check`) | `16` held-out single-fact cases (`8` conflicts × `3` = `24`; `8` harmless × `3` = `24`) | **`24/24`** conflicts caught (`4/24` harmless flagged); `18/18` on full-note eval (`0/42` harmless conflicts) |
| **Automated Suite & Security** | Local test runner + TypeScript + security audit | **`499/499`** Vitest tests (`21` files), `0` TS errors, `0` audit vulnerabilities |

**Shared ICT-Lab Timing & Rollout Budget (strictly measured):** Across our Chrome `158.0.8127.88` Linux test runs, an online run completes a notebook photo scan in **`3.1s`** (`4.4s` end-to-end), runs the 1-pass local guard in **`3.81s` median** (`50.3s` across `16` paragraphs / `2,177` chars in the synthetic `35`-pupil stress test), streams the cloud lesson in **`4.4s`**, and generates 1-click materials in **`4.1s`**, while offline Nano fallback on `12` needs completes in **`23.3s`** (`0.2s` on-device receipt labelling online). These timings are browser measurements from one test machine on invented notes; **no real school pilot, teacher workload study, or multi-school deployment trial was conducted**, and school rollout would require provisioning Chrome Built-in AI alongside a paid Gemini API billing tier.

## Challenges

1. **Keeping generic nouns, kinship words, and overlapping constraints crisp**: Generic words like `"home"`, `"school"`, and bare kinship labels previously caused false holds, dropping `0/24` harmless holds in `guard-combined-v2.json` via cleaner `KINSHIP_ONLY` filtering, curriculum/health context exemption, and `isRedundantWithLearning` overlap folding.
2. **Making Gemini Nano load-bearing offline AND online**: Online, Paragraph 5 (`Tanvi Rao`'s Tuesday clinic visit) reliably surfaces an un-overlapped `Found by Gemini Nano` (`days-away`) catch (`Need E: away on Tuesdays`) mapped back to a take-home summary sheet for `Tanvi Rao`. Offline, asking 3B Nano for unstructured pipe/colon text timed out or dropped needs; switching `offlineLessonPrompt` to grammar-constrained `OFFLINE_LESSON_NEEDS_SCHEMA` (`adjustments` with stage enum + verb actions) plus deterministic `normalizeOfflineNeeds()` achieved **`12/12` needs written for a stage (`0` missing, `0` bracket leaks) in `23.3s`**.
3. **Shared-PC sign-out safety & non-English drafting**: Closing the post-`Clear desk` receipt gap via `signout-failed` retry & `signOutBlockedRef` gating, plus Layer A Devanagari Hindi conflict rules (`HINDI_RULE_ONLY`), keeps both shared workstations and bilingual classrooms safe without silent failures.

## Limits

- **Hardware & browser availability**: On-device AI (`scan`, `guard`, `check`, `fit`, `label`) requires desktop Chrome 158+ with Built-in AI (`LanguageModel` text and image capabilities downloaded — a multi-GB local model footprint that may exceed constrained shared lab hardware). Other browsers run deterministic rules and can step through the recorded Chrome 158 + Nano run.
- **Language scope**: Deterministic Hinglish/Devanagari safety rules, single-pupil pronoun filters, and **Layer A Hindi conflict rules** run locally on Chrome without a model; on-device **Nano semantic step checking (`check`) runs in English only** (Hindi drafts surface `Checked by Hindi rules on this device; the on-device model checks English drafts only`, and other non-English languages display `NOT_ENGLISH`).
- **Offline scope & invented data**: Once precached alongside Nano, local guard, deterministic Return Gate, check, fit, and fallback Nano drafting work offline; standard cloud drafting requires network connectivity. All pupil names, family notes, phone numbers, roll numbers, the 35-pupil stress set, and notebook photos are **invented data only**; no real school pilot, teacher workload study, or legal compliance certification is claimed, and live classroom rollout requires school/board governance and a paid Gemini API tier.

## Built with

React, TypeScript, Vite, `vite-plugin-pwa`, Firebase AI Logic (`@firebase/ai`, Chrome Gemini Nano + `gemini-3.5-flash-lite`), Firebase Hosting, Firebase App Check (reCAPTCHA Enterprise), Firebase Remote Config, Firebase Authentication (anonymous), Cloud Firestore, Vitest.
