# Staffroom

Your device knows the child. The cloud only knows the need.

Built for **#BuildHybridAI 2026 (Best Web)**.
Live app: **https://staffroom-hybrid-8a71.web.app**

## The problem

In India's government and aided schools — where teachers work on shared **ICT-lab or staffroom desktops** and must handle children's personal data with care (aligned with the data-minimization and children's privacy goals of **India's Digital Personal Data Protection (DPDP) Act 2023**, whose Section 9 verifiable parental consent rules are scheduled for commencement in May 2027) — a teacher cannot paste raw notes naming a child's illness, parents' separation, unpaid fees, caste taunts, or phone number into a cloud model. Stripping all context produces generic plans that break real pupil constraints (scheduling after-bell remedial work for a student who leaves at the last bell, or smartphone homework for a household without a phone or internet).

## What Staffroom does

Staffroom puts a privacy door between raw classroom notes and the cloud, designed for a shared school desktop (**notes, class lists, constraints, and saved lessons default to `sessionStorage` only**, with `localStorage` persistence strictly opt-in via *Keep this class in this browser* and a one-click **Clear desk** button that wipes notes, class list, saved lessons, and receipts):

1. **Write or scan on the device**: Type notes (English, **Hinglish**, or **Devanagari**) or use **Scan notebook photo / Try sample notebook photo** (`public/sample-notebook.jpg`). Multimodal **Gemini Nano** checks `imageOnDeviceStatus()`, downscales on `<canvas>`, and transcribes handwritten pages locally (`~7.1s`, `229–231` chars verbatim, `0` cloud requests), while `extractScannedClassList()` extracts likely student names directly from the scanned text using local proper-name heuristics.
2. **Guard locally before anything leaves (`guardCombinedOnDevice`)**: Deterministic pattern/sensitivity rules (covering English, Hinglish, and Devanagari health/family/money phrases plus phone/STD/roll/Aadhaar patterns) run alongside a 1-pass combined Gemini Nano call (`ONLY_ON_DEVICE`). Overlapping unconfirmed Nano proposals are folded into confirmed learning needs (`isRedundantWithLearning`, including non-time `time-after`/`time-before` overlaps lacking schedule cues), and heading paragraphs are skipped in `constraintsFromCombined`. A fail-closed **Exit Gate** (`checkOutgoing` in `src/core/gate.ts` and `outgoingOf` in `src/core/needs.ts`) scans the entire assembled outgoing text (including assembled `Need` blocks) and refuses to send if any withheld string or pattern leak remains.
3. **Send only capability codes (`Need A`–`Need O`)**: For `Tomorrow's lesson`, `classSentences()` filters out single-pupil sentences — including Hinglish (`woh`, `uska`, `uski`, `uske`, `usse`, `usko`) and Devanagari (`वह`, `वो`, `उसने`, `उसका`, `उसकी`, `उसके`, `उसको`, `उसे`, `उससे`) singular third-person pronouns with combining-mark boundaries — so zero pupil names, single-pupil prose, reasons, or health details leave the browser: only class-wide context, lesson metadata, and abstract needs (`Need A: cannot stay after the last bell`, `Need E: away on Tuesdays`, etc.). Non-lesson tasks (`Support plan`, `Messages to parents`, `Hand-over`) send redacted prose (`[Student 1]`, `[Adult 1]`, `[Place 1]`, `[withheld]`) and approved needs.
4. **Stream the cloud draft (`gemini-3.5-flash-lite`) with mid-stream local fallback**: `writeDraft()` and `writeMaterials()` stream from Firebase AI Logic using `PREFER_IN_CLOUD` and strict schemas (`VARIATION_INSTRUCTION` ensures recurring-day absences like `away on Tuesdays` get a catch-up step). If the browser goes offline before starting, drops mid-stream, or returns silently truncated JSON, `streamContent()` clears any partial preview and recovers via `onDeviceFallbackFor` (`ONLY_ON_DEVICE` Gemini Nano streaming).
5. **Put the child back beside the lesson**: Locally in Chrome, Staffroom maps each cloud need entry onto the right pupil, deduplicates generic `group`-need variations against local two-child seating adjustments (`dedupePairVariations`, e.g., `Put Kabir and Ishaan in different groups.` / `Seat Kabir and Ishaan apart.`, counted transparently by `fitSummary`), checks draft steps locally (`check`), offers empathetic on-device suggestions (**More ideas from this device**, `fit`, filtering out prompts asking a child to share/recall family, money, health, or home hardships), builds 1-click printable materials (`Board work`, `Practice sheet`, per-Need sheets, `Exit ticket`), separates **Class copy** (`No names · letter codes only`) from **Teacher's copy** with restored names, and updates future lessons from the private exit ticket marks (**`Got it` / `Partly` / `Not yet` / `Absent`**) in the **Lessons** tab.

*Without Chrome 158+ Built-in AI, click **Watch a recorded run** (`public/recorded-run.json`) to replay a complete Chrome 158 + Gemini Nano live run (`1 Write · 2 What leaves · 3 Lesson · 4 Beside each child · 5 Sign off`), trace every `Need` (including `Tanvi Rao`'s Nano-exclusive `Need E: away on Tuesdays`) across the door, preview both copies, and inspect live route & network proofs.*

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

In **Inspect**, Staffroom shows all 6 routes (including `scan` when run live or replayed from `public/recorded-run.json`) alongside **Network, as the browser records it** (`performance.getEntriesByType('resource')` filtered to Google/Firebase hosts for the page load), demonstrating `0` cloud inference calls during `scan` and `guard`.

## Firebase & Web Platform

- **Firebase AI Logic** (`@firebase/ai`): hybrid routing (`ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `PREFER_ON_DEVICE`) with Remote Config model selection.
- **Firebase App Check**: reCAPTCHA Enterprise in production (`VITE_APPCHECK_DEBUG_TOKEN` unset in production builds; `.env.production.local` strictly separated).
- **Firebase Hosting**: strict security headers in [`firebase.json`](firebase.json) (`Content-Security-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`).
- **Firebase Authentication & Cloud Firestore**: anonymous session binding and optional explicit receipt saving (`Keep a copy` toggle; default off for shared ICT-lab PCs).
- **PWA (`vite-plugin-pwa`)**: precaches the app shell (`dist/`, including `public/sample-notebook.jpg`) so local guard, deterministic Return Gate, check, fit, and fallback Nano drafting work offline once visited and Gemini Nano is cached.

## Measured results (Chrome `158.0.8127.88` + Gemini Nano)

Raw logs & methodology live under [`docs/evals/2026-11-28/`](docs/evals/2026-11-28/) and [`docs/evals/`](docs/evals/):

- **1-pass Combined Guard (`GUARD_CASES`: 12 invented notes, 60 private details × 3 runs = 180 judgements)**:
  - **Rules alone**: `40/60` caught in full (`11` partly, `9` missed, `0/19` hard non-rule details caught, `5/8` harmless curriculum lines held, `1/11` constraints matched, median `3 ms`).
  - **Rules + 1-pass `guardCombinedOnDevice`**: **`148/180` (`49.3/60` avg: 48, 49, 51)** caught in full, `25/180` partly, **`7/180` (`2.3/60` avg)** missed, `25/57` hard non-rule details caught, `123/123` standard details caught, **`2.0/8` harmless items held**, `11/33` exact constraint-kind matches (with **`40` unconfirmed extra constraints proposed** across 36 runs; Round 2 also added `isRedundantWithLearning` time-cue folding for non-time `time-after`/`time-before` overlaps), `0` unread parts, `0` failures, median **`4,055 ms`** per note.
- **Multimodal Notebook Scan (`public/sample-notebook.jpg`)**: **~7.1s**, **229–231 chars** transcribed verbatim, **0** cloud inference calls observed.
- **Offline Streaming Fallback (`PREFER_IN_CLOUD -> ON_DEVICE`)**: **40,760 ms** under CDP offline emulation, live streaming preview, 6 checked steps mapped locally to all 5 children, caution banner rendered.
- **On-device Check (`eval.html`, 26 Nov 2026)**: 24/24 conflicts caught on 16 held-out cases (`4/24` harmless flagged); 18/18 conflicts caught across full sample-note runs (`0/42` harmless flagged as conflicts, `3` unsure).
- **Code quality & security**: `469/469` unit tests (`20` files), `tsc --noEmit` (`0` errors), `impeccable detect` (`0` findings), `pnpm audit` (`0` known vulnerabilities).

## Run & verify locally

```bash
pnpm install
pnpm dev              # http://127.0.0.1:5173
pnpm test             # 469 tests across 20 Vitest files
pnpm typecheck        # tsc --noEmit
pnpm build            # dist/ + service worker (including sample-notebook.jpg)
pnpm audit
```

Browser evaluations live on `/eval.html` (`?set=guard`, `?set=check`, `?set=full`, `?set=needs`). Capture mode runs on `?capture=1`.

## Limits, stated plainly

- **Hardware & browser footprint**: On-device Nano features require desktop Chrome 158+ with Built-in AI (`LanguageModel` text and multimodal image capabilities downloaded locally — a multi-GB browser download that may exceed shared low-storage lab PCs unless pre-cached). Other browsers run deterministic rules and can step through the complete Chrome + Nano flow via **Watch a recorded run** ([`public/recorded-run.json`](public/recorded-run.json)).
- **Language coverage**: Deterministic sensitive-phrase rules, pronoun filters, and cloud language prompts (`Language of the plan`) support Hinglish and Devanagari inputs/outputs, while deterministic draft conflict rules and on-device Nano checks work primarily in **English** (the UI explicitly warns when drafting in another language).
- **Invented data only**: All student names, family details, phone numbers, roll numbers, and [`public/sample-notebook.jpg`](public/sample-notebook.jpg) are **invented data only**; no real pupil data or live school trial has been conducted, and no legal compliance certification is claimed. Real classroom deployment would require school/board governance and a paid Gemini API billing tier.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
