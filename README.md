# Staffroom

Your device knows the child. The cloud only knows the need.

Built for **#BuildHybridAI 2026 (Best Web)**.
Live app: **https://staffroom-hybrid-8a71.web.app**

## The problem

In India's government and aided schools — where teachers work on shared **ICT-lab or staffroom desktops** and must handle children's personal data with care (aligned with the data-minimization and children's privacy goals of **India's Digital Personal Data Protection (DPDP) Act 2023**, whose Section 9 verifiable parental consent rules are scheduled for commencement in May 2027) — a teacher cannot paste raw notes naming a child's illness, parents' separation, unpaid fees, caste taunts, or phone number into a cloud model. Stripping all context produces generic plans that break real pupil constraints (scheduling after-bell remedial work for a student who leaves at the last bell, or smartphone homework for a household without a phone or internet).

## What Staffroom does

Staffroom puts a privacy door between raw classroom notes and the cloud, designed for a shared school desktop (**notes, class lists, constraints, saved lessons, and text-bearing local receipts default to `sessionStorage` only**, with `localStorage` persistence strictly opt-in via *Keep this class in this browser* and a one-click **Clear desk** button that wipes `sessionStorage`, opted-in `localStorage` data (`staffroom.keptClass`, `staffroom.keepClass`, `staffroom.lessons`, `staffroom.receipts.v1`), the `staffroom.keepCopies` preference, and signs out the anonymous Firebase Auth session (`clearUserSession()`); optional count-only Firestore receipt records already written under *Keep a copy* opt-in remain in Firestore, while browser print (`Ctrl+P` / `Cmd+P`) defaults to the nameless Class copy (`class-only`) rather than rendering the private Teacher's copy):

1. **Write or scan on the device**: Type notes (English, **Hinglish**, or **Devanagari**) or use **Scan notebook photo / Try sample notebook photo** (`public/sample-notebook.jpg`). Multimodal **Gemini Nano** checks `imageOnDeviceStatus()`, downscales on `<canvas>`, and transcribes handwritten pages locally (`~7.1s`, `229–231` chars on the sample page, `0` cloud inference calls), while `extractScannedClassList()` extracts likely student names directly from the scanned text using local proper-name heuristics.
2. **Guard locally before anything leaves (`guardCombinedOnDevice`)**: Deterministic pattern/sensitivity rules (covering English, Hinglish, and Devanagari health/family/money phrases plus phone/STD/roll/Aadhaar patterns) run alongside a 1-pass combined Gemini Nano call (`ONLY_ON_DEVICE`). Overlapping unconfirmed Nano proposals are folded into confirmed learning needs (`isRedundantWithLearning`, including non-time `time-after`/`time-before` overlaps lacking schedule cues), and heading paragraphs are skipped in `constraintsFromCombined`. A fail-closed **Exit Gate** (`checkOutgoing` in `src/core/gate.ts` and `outgoingOf` in `src/core/needs.ts`) scans the entire assembled outgoing text (including assembled `Need` blocks) for known withheld items and patterns, alongside mandatory teacher review of any unmarked details.
3. **Teacher-reviewed data minimization & capability codes (`Need A`–`Need O`)**: For `Tomorrow's lesson`, `classSentences()` filters out single-pupil sentences containing withheld tokens, released pupil/adult names, mostly-withheld fragments, or English/Hinglish (`woh`, `uska`, `uski`, `uske`, `usse`, `usko`) and Devanagari (`वह`, `वो`, `उसने`, `उसका`, `उसकी`, `उसके`, `उसको`, `उसे`, `उससे`) singular third-person pronouns with combining-mark boundaries. What crosses after teacher sign-off is **class-wide context**, **lesson metadata**, **lettered need descriptions** (`Need A: cannot stay after the last bell`, `Need E: away on Tuesdays`), and **formatting instructions** — leaving out flagged names, reasons, diagnoses, and identified single-pupil sentences. Non-lesson tasks (`Support plan`, `Messages to parents`, `Hand-over`) send redacted prose (`[Student 1]`, `[Adult 1]`, `[Place 1]`, `[withheld]`) and approved needs.
4. **Stream the cloud draft (`gemini-3.5-flash-lite`) with local fallback**: `writeDraft()` and `writeMaterials()` stream from Firebase AI Logic using `PREFER_IN_CLOUD` and strict schemas (`VARIATION_INSTRUCTION` ensures recurring-day absences like `away on Tuesdays` get a catch-up step). Chrome 158 offline-before-send verification (`40.76s`) proves pre-start fallback to `ONLY_ON_DEVICE` Gemini Nano streaming plus local Return Gate checks; unit tests (`src/ai/routes.test.ts`) exercise mid-stream network failure and silently truncated cloud JSON recovery via `onDeviceFallbackFor`.
5. **Put the child back beside the lesson**: Locally in Chrome, Staffroom maps each cloud need entry onto the right pupil, deduplicates generic `group`-need variations against local two-child seating adjustments (`dedupePairVariations`, e.g., `Put Kabir and Ishaan in different groups.` / `Seat Kabir and Ishaan apart.`, counted transparently by `fitSummary`), checks English drafts locally (`check`), offers empathetic on-device suggestions (**More ideas from this device**, `fit`, filtering intrusive hardship prompts), builds 1-click printable materials (`Board work`, `Practice sheet`, per-Need sheets defaulting to **letter-codes only**, `Exit ticket`), provides **separate safe printing** on signed lessons (**Print class copy (no names)** vs **Print teacher's copy (private)**), and updates future lessons from private exit ticket marks (**`Got it` / `Partly` / `Not yet` / `Absent`**) in the **Lessons** tab.

*Without Chrome 158+ Built-in AI, click **Watch a recorded run** (`public/recorded-run.json`) to replay a complete Chrome 158 + Gemini Nano live run (`1 Write · 2 What leaves · 3 Lesson · 4 Beside each child · 5 Sign off`), trace every `Need` (including `Tanvi Rao`'s Nano-exclusive `Need E: away on Tuesdays`) across the door, preview both copies, and inspect recorded route statuses and scrubbed Resource Timing measurements.*

## How hybrid inference works (Firebase AI Logic)

Every AI call passes through [`src/ai/routes.ts`](src/ai/routes.ts) using `@firebase/ai` across all three Firebase AI Logic hybrid modes (`ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `PREFER_ON_DEVICE`):

| Route | Mode (`InferenceMode`) | What it touches | Where it runs & fallback behaviour |
|---|---|---|---|
| `scan` | `ONLY_ON_DEVICE` | Local JPEG `<= 1024px` | Checks `imageOnDeviceStatus()` + runs multimodal Gemini Nano OCR (`0` cloud calls); refuses if unavailable or `inferenceSource !== 'on_device'`. |
| `guard` | `ONLY_ON_DEVICE` | Raw note paragraphs | 1-pass entity + private detail + constraint extraction (`guardCombinedOnDevice`). Never touches network; heading paragraphs skipped for constraints. |
| `draft` | `PREFER_IN_CLOUD` | Gate-approved text only | Streams (`generateContentStream`) lesson & materials via Remote Config (`gemini-3.5-flash-lite`); falls back to local Nano pre-start, mid-stream, or on incomplete JSON. |
| `check` | `ONLY_ON_DEVICE` | One draft step + one constraint | Compares step against local constraint alongside deterministic word rules; deterministic Return Gate checks replies even offline. |
| `fit` | `ONLY_ON_DEVICE` | Step or child note + stages | Rewrites conflicting step (`fitForChild`) or offers empathetic per-child suggestions (`fitLessonForChild`), rule- and filter-checked before offer. |
| `label` | `PREFER_ON_DEVICE` | Concise metadata/snippet (`<= 240` chars) | Short receipt title from lesson header (`klass — subject — topic`) or `<= 240`-char redacted snippet (`LABEL_CHARS = 240`); runs on-device when Nano is ready, can fall back to cloud, or uses local `FALLBACK`. |

In **Inspect**, Staffroom shows all 6 routes (both live and from `public/recorded-run.json` when captured) alongside **Network, as the browser records it** (all page `performance.getEntriesByType('resource')` entries across all hosts, counting requests to `firebasevertexai.googleapis.com` per timed step and masking tokens/query strings), demonstrating `0` model-host requests during `scan`, `guard`, `check`, `label`, and `fit`.

## Firebase & Web Platform

- **Firebase AI Logic** (`@firebase/ai`): hybrid routing (`ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `PREFER_ON_DEVICE`) with Remote Config model selection.
- **Firebase App Check**: reCAPTCHA Enterprise in production (`VITE_APPCHECK_DEBUG_TOKEN` unset in production builds; `.env.production.local` strictly separated).
- **Firebase Hosting**: strict security headers in [`firebase.json`](firebase.json) (`Content-Security-Policy` including `connect-src 'self' data:` so `@firebase/ai`'s Chrome Built-in AI multimodal `inlineData` adapter can decode local images locally without network requests, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`).
- **Firebase Authentication & Cloud Firestore**: anonymous session binding and optional explicit receipt saving (`Keep a copy` toggle; default off for shared ICT-lab PCs; Firestore documents store schema-checked counts only with zero free text).
- **PWA (`vite-plugin-pwa`)**: precaches the app shell (`dist/`, including `public/sample-notebook.jpg`) so local guard, deterministic Return Gate, check, fit, and fallback Nano drafting work offline once visited and Gemini Nano is cached.

## Measured results (Chrome `158.0.8127.88` + Gemini Nano)

Raw logs & methodology live under [`docs/evals/2026-11-28/`](docs/evals/2026-11-28/) and [`docs/evals/`](docs/evals/):

| Benchmark | Denominator & Conditions | Rules Alone | Rules + Gemini Nano |
|---|---|---:|---:|
| **1-pass Combined Guard** (`GUARD_CASES`) | `12` distinct invented notes, `60` labelled details total, run `3×` (`180` judgments) | `40/60` caught (`11` partial, `9` missed, `5/8` harmless held, `1/11` constraints matched, `3 ms`) | **`148/180`** (`49.3/60`: `48, 49, 51`), `25/180` partial, **`7/180` (`2.3/60`) missed**, `25/57` hard non-rule details caught, `123/123` standard, **`6/24` (`2.0/8`) harmless held**, `11/33` exact constraint matches (`+40` unconfirmed extras), `4,055 ms` median |
| **On-device Check** (`?set=heldout` / `?set=check`) | `16` held-out single-fact cases (`8` conflicts × `3` runs = `24`; `8` harmless × `3` runs = `24`) | — | **`24/24`** conflicts caught (`4/24` harmless flagged); `18/18` on full-note eval (`0/42` harmless conflicts flagged, `3` unsure) |
| **Multimodal Notebook Scan** (`scan`) | Single sample page (`public/sample-notebook.jpg`), Chrome 158 | — | **`~7.1s`**, `229–231` chars transcribed, **`0` cloud calls** |
| **Offline-before-send Fallback** (`draft`) | `SAMPLE_NOTE`, Chrome 158 with CDP offline emulation before approval | — | **`40.76s`** `PREFER_IN_CLOUD -> ON_DEVICE` stream + local Return Gate check |

- **Automated suite & security**: **`478/478` unit tests** (`21` Vitest files, including mid-stream drop, truncated JSON recovery, failure-safe session-only receipt isolation, and Devanagari sentence segmentation), `tsc --noEmit` (`0` errors), `pnpm audit --prod` (`0` known vulnerabilities).

## Run & verify locally

```bash
pnpm install
pnpm dev              # http://127.0.0.1:5173
pnpm test             # 478 tests across 21 Vitest files
pnpm typecheck        # tsc --noEmit
pnpm build            # dist/ + service worker (including sample-notebook.jpg)
pnpm audit
```

Browser evaluations live on `/eval.html` (`?set=guard`, `?set=heldout`, `?set=check`, `?set=full`, `?set=needs`). Capture mode runs on `?capture=1`.

## Limits, stated plainly

- **Hardware & browser footprint**: On-device Nano features require desktop Chrome 158+ with Built-in AI (`LanguageModel` text and multimodal image capabilities downloaded locally — a multi-GB browser download that may exceed shared low-storage lab PCs unless pre-cached). Other browsers run deterministic rules and can step through the complete Chrome + Nano flow via **Watch a recorded run** ([`public/recorded-run.json`](public/recorded-run.json)).
- **Language coverage**: Deterministic sensitive-phrase rules, pronoun filters, and cloud language prompts (`Language of the plan`) support Hinglish and Devanagari inputs/outputs, while both deterministic draft conflict rules and on-device Nano step checking work in **English only** (non-English lesson drafts skip local conflict checking with an explicit `NOT_ENGLISH` banner).
- **Invented data only**: All student names, family details, phone numbers, roll numbers, and [`public/sample-notebook.jpg`](public/sample-notebook.jpg) are **invented data only**; no real pupil data, live school pilot, teacher workload study, or legal compliance certification is claimed. Real classroom deployment would require school/board governance and a paid Gemini API billing tier.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
