# Staffroom

Your device knows the child. The cloud only knows the need.

Built for **#BuildHybridAI 2026 (Best Web)**.
Live app: **https://staffroom-hybrid-8a71.web.app**

## The problem

In India's government and aided schools — where teachers work on shared **ICT-lab or staffroom desktops** and must handle children's personal data with care (aligned with the data-minimization and children's privacy goals of **India's Digital Personal Data Protection (DPDP) Act 2023**, whose Section 9 verifiable parental consent rules are scheduled for commencement in May 2027) — a teacher cannot paste raw notes naming a child's illness, parents' separation, unpaid fees, caste taunts, or phone number into a cloud model. Stripping all context produces generic plans that break real pupil constraints (scheduling after-bell remedial work for a student who leaves at the last bell, or smartphone homework for a household without a phone or internet).

## What Staffroom does

Staffroom puts a privacy door between raw classroom notes and the cloud, designed for a shared school desktop (**notes, class lists, constraints, saved lessons, and text-bearing local receipts default to `sessionStorage` only**, with `localStorage` persistence strictly opt-in via *Keep this class in this browser* and a one-click **Clear desk** button that wipes `sessionStorage`, opted-in `localStorage` data (`staffroom.class.v1`, `staffroom.keepClass`, `staffroom.lessons.v1`, `staffroom.receipts.v1`), `staffroom.keepCopies`, and signs out the anonymous Firebase Auth session (`clearUserSession()`, surfacing a persistent `signout-failed` warning with retry and fail-closed copy gating if sign-out fails); optional count-only Firestore receipt records already written under *Keep a copy* opt-in remain in Firestore, while browser print (`Ctrl+P` / `Cmd+P`) defaults to the nameless Class copy (`class-only`) rather than rendering the private Teacher's copy):

1. **Write or scan on the device**: Type notes (English, **Hinglish**, or **Devanagari**) or use **Scan notebook photo / Try sample notebook photo** (`public/sample-notebook.jpg`). Multimodal **Gemini Nano** checks `imageOnDeviceStatus()`, downscales on `<canvas>`, and transcribes handwritten pages locally (`3.1s` model step / `4.4s` end-to-end on Chrome 158, `231` chars on the sample page, `0` cloud inference calls), while `extractScannedClassList()` extracts likely student names directly from the scanned text using local proper-name heuristics.
2. **Guard locally before anything leaves (`guardCombinedOnDevice`)**: Deterministic pattern/sensitivity rules (covering English, Hinglish, and Devanagari health/family/money/loss/hunger phrases plus phone/STD/roll/Aadhaar patterns) run alongside a 1-pass combined Gemini Nano call (`ONLY_ON_DEVICE`). Overlapping unconfirmed Nano proposals are folded into confirmed learning needs (`isRedundantWithLearning`), kinship-only tags are filtered (`KINSHIP_ONLY`), and heading paragraphs are skipped in `constraintsFromCombined`. A fail-closed **Exit Gate** (`checkOutgoing` in `src/core/gate.ts` and `outgoingOf` in `src/core/needs.ts`) scans the entire assembled outgoing text (showing `Exit gate: 0 known names/IDs · Review required` or blocking leaks) alongside mandatory teacher review.
3. **Teacher-reviewed data minimization & capability codes (`Need A`–`Need O`)**: For `Tomorrow's lesson`, `classSentences()` filters out single-pupil sentences containing withheld tokens, released pupil/adult names, mostly-withheld fragments, or English/Hinglish (`woh`, `uska`, `uski`, `uske`, `usse`, `usko`) and Devanagari (`वह`, `वो`, `उसने`, `उसका`, `उसकी`, `उसके`, `उसको`, `उसे`, `उससे`) singular third-person pronouns with combining-mark boundaries. What crosses after teacher sign-off is **class-wide context**, **lesson metadata**, **lettered need descriptions** (`Need A: cannot stay after the last bell`, `Need E: away on Tuesdays`), and **formatting instructions** — leaving out flagged names, reasons, diagnoses, and identified single-pupil sentences. Non-lesson tasks (`Support plan`, `Messages to parents`, `Hand-over`) send redacted prose (`[Student 1]`, `[Adult 1]`, `[Place 1]`, `[withheld]`) and approved needs.
4. **Stream the cloud draft (`gemini-3.5-flash-lite`) with compact offline Nano recovery**: `writeDraft()` and `writeMaterials()` stream from Firebase AI Logic using `PREFER_IN_CLOUD` and strict schemas (`VARIATION_INSTRUCTION` ensures recurring-day absences like `away on Tuesdays` get a catch-up step). When Chrome is offline before send (`navigator.onLine === false`) or drops mid-stream / returns leaked `[Student N]` or missing needs on-device, `writeDraft()` switches to compact bracket-free `OFFLINE_LESSON_SYSTEM` + `OFFLINE_LESSON_SCHEMA` + `offlineLessonPrompt()` and normalizes colon-formatted Nano entries (`normalizeOfflineNeeds`) cleanly (`41.3s` live offline fallback on Chrome 158: **`12/12` needs written for a stage, `0` missing, `0` bracket leaks**).
5. **Put the child back beside the lesson**: Locally in Chrome, Staffroom maps each cloud need entry onto the right pupil, deduplicates generic `group`-need variations against local two-child seating adjustments (`dedupePairVariations`), checks English drafts locally via rules + Gemini Nano (`check`), checks **Devanagari Hindi drafts locally via Layer A Hindi conflict rules** (with `HINDI_RULE_ONLY` caution banner), offers subject-aware empathetic on-device suggestions (**More ideas from this device**, `fit`, filtering off-subject maths/intrusive hardship prompts), builds 1-click printable materials (`Board work`, `Practice sheet`, per-Need sheets defaulting to **letter-codes only**, `Exit ticket`), provides **separate safe printing** on signed lessons (**Print class copy (no names)** vs **Print teacher's copy (private)**), and updates future lessons from private exit ticket marks (**`Got it` / `Partly` / `Not yet` / `Absent`**) in the **Lessons** tab.

*Without Chrome 158+ Built-in AI, click **Watch a recorded run** (`public/recorded-run.json`) to replay a complete Chrome 158 + Gemini Nano live run (`1 Write · 2 What leaves · 3 Lesson · 4 Beside each child · 5 Sign off`), trace every `Need` (including `Tanvi Rao`'s Nano-exclusive `Need E: away on Tuesdays`) across the door, preview both copies, and inspect recorded route statuses and scrubbed Resource Timing measurements.*

## Architecture & module layout

- **UI & state modules**: Orchestrated from [`src/App.tsx`](src/App.tsx) alongside [`src/app/storage.ts`](src/app/storage.ts) and focused components under [`src/ui/`](src/ui/) (`AppHeader.tsx`, `ActionBar.tsx`, `CalmNotice.tsx`, `CloudOutcomeCards.tsx`, `ComposeCards.tsx`, `ResultItem.tsx`, `ResultPanel.tsx`, `ReviewCard.tsx`, `PrintSheet.tsx`, `VaultPanel.tsx`, `Hero.tsx`, `Constraints.tsx`, `Lesson.tsx`, `Materials.tsx`, `pages.tsx`).
- **Deterministic privacy & pedagogy core**: Pure, network-free modules under [`src/core/`](src/core/) (`vault.ts`, `rules.ts`, `gate.ts`, `needs.ts`, `lesson.ts`, `lessonNeeds.ts`, `conflicts.ts` with English + Hindi Layer A rules, `recorded.ts`, `recheck.ts`, `ticket.ts`).
- **Hybrid AI routing**: All model calls pass through [`src/ai/routes.ts`](src/ai/routes.ts) (`@firebase/ai`) across all three `InferenceMode`s:

| Route | Mode (`InferenceMode`) | What it touches | Where it runs & fallback behaviour |
|---|---|---|---|
| `scan` | `ONLY_ON_DEVICE` | Local JPEG `<= 1024px` | Checks `imageOnDeviceStatus()` + runs multimodal Gemini Nano OCR (`0` cloud calls); refuses if unavailable or `inferenceSource !== 'on_device'`. |
| `guard` | `ONLY_ON_DEVICE` | Raw note paragraphs | 1-pass entity + private detail + constraint extraction (`guardCombinedOnDevice`). Never touches network; heading paragraphs skipped for constraints. |
| `draft` | `PREFER_IN_CLOUD` | Gate-approved text only | Streams (`generateContentStream`) lesson & materials via Remote Config (`gemini-3.5-flash-lite`); recovers via `OFFLINE_LESSON_SYSTEM` + `offlineLessonPrompt` + `normalizeOfflineNeeds` offline/mid-stream. |
| `check` | `ONLY_ON_DEVICE` | One draft step + one constraint | Compares step against local constraint alongside deterministic English/Hindi rules; deterministic Return Gate checks replies even offline. |
| `fit` | `ONLY_ON_DEVICE` | Step or child note + stages | Rewrites conflicting step (`fitForChild`) or offers subject-aware empathetic per-child suggestions (`fitLessonForChild`), rule- and filter-checked before offer. |
| `label` | `PREFER_ON_DEVICE` | Concise metadata/snippet (`<= 240` chars) | Short receipt title (`LABEL_CHARS = 240`); runs on-device when Nano is ready (`200 ms`, `0` model-host requests), can fall back to cloud, or uses local `FALLBACK`. |

In **Inspect**, Staffroom shows all 6 routes (both live and from `public/recorded-run.json`) alongside **Network, as the browser records it** (`performance.getEntriesByType('resource')` across all hosts), demonstrating `0` model-host requests during `scan`, `guard`, `check`, `label`, and `fit`.

## Firebase & Web Platform

- **Firebase AI Logic** (`@firebase/ai`): hybrid routing (`ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `PREFER_ON_DEVICE`) with Remote Config model selection.
- **Firebase App Check**: reCAPTCHA Enterprise in production (`VITE_APPCHECK_DEBUG_TOKEN` unset in production builds).
- **Firebase Hosting**: strict security headers in [`firebase.json`](firebase.json) (`Content-Security-Policy` including `connect-src 'self' data:` for local multimodal decoding, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`).
- **Firebase Authentication & Cloud Firestore**: anonymous session binding with fail-closed `signout-failed` handling and optional explicit count-only receipt saving (`Keep a copy`; default off).
- **PWA (`vite-plugin-pwa`)**: precaches the app shell (`dist/`, including `public/sample-notebook.jpg`) for offline local operation once visited and Nano is cached.

## Measured results (Chrome `158.0.8127.88` + Gemini Nano)

Raw logs & methodology live under [`docs/evals/2026-11-28/`](docs/evals/2026-11-28/) and [`docs/evals/`](docs/evals/):

| Benchmark | Denominator & Conditions | Rules Alone | Rules + Gemini Nano |
|---|---|---:|---:|
| **1-pass Combined Guard** (`guard-combined-v2.json`) | `12` distinct invented notes, `60` labelled details total, run `3×` (`180` judgments) | `46/60` (`138/180`), `10/60` partial, `4/60` missed, `3/8` (`9/24`) harmless held, `1/11` constraints matched, `2 ms` | **`153/180`** (`51.0/60` across all 3 runs), `21/180` partial, **`6/180` (`2.0/60`) missed**, `30/57` hard non-rule details caught, `123/123` standard, **`0/24` (`0.0/8`) harmless held**, `12/33` exact constraint matches (`+19` unconfirmed extras), **`3,806 ms` (`3.81s`) median** |
| **35-Pupil Stress Test** (`scale-35.json`) | Synthetic `35`-pupil note (`2,177` chars across `16` paragraphs) | `50` withheld, `0` leaked, `0 ms` | **`67` withheld (`+17` Nano)**, `0` unread/dropped/partial, **`0` exit-gate stops, `0` leaked tokens** (`50.3s`) |
| **On-device Check** (`?set=heldout` / `?set=check`) | `16` held-out single-fact cases (`8` conflicts × `3`; `8` harmless × `3`) | — | **`24/24`** conflicts caught (`4/24` harmless flagged); `18/18` on full-note eval (`0/42` harmless conflicts) |
| **Multimodal Notebook Scan** (`scan`) | Single sample page (`public/sample-notebook.jpg`), Chrome 158 | — | **`3.1s`** model step (`4.4s` UI end-to-end), `231` chars transcribed, **`0` cloud calls**, `2` names extracted |
| **Offline-before-send Fallback** (`draft`) | `SAMPLE_NOTE` (12 needs), Chrome 158 CDP offline before approval | — | **`41.3s`** `PREFER_IN_CLOUD -> ON_DEVICE` stream + Return Gate: **`12/12` needs covered (`0` missing), `0` `[Student]` brackets** |

- **Automated suite & security**: **`493/493` unit tests** (`21` Vitest files, covering offline colon-to-pipe normalization, mid-stream/JSON recovery, sign-out retry & fail-closed gating, Hindi Layer A rules, and Devanagari segmentation), `tsc --noEmit` (`0` errors), `pnpm audit --prod` (`0` known vulnerabilities).

## Run & verify locally

```bash
pnpm install
pnpm dev              # http://127.0.0.1:5173
pnpm test             # 493 tests across 21 Vitest files
pnpm typecheck        # tsc --noEmit
pnpm build            # dist/ + service worker
pnpm audit
```

Browser evaluations live on `/eval.html` (`?set=guard`, `?set=scale35`, `?set=heldout`, `?set=check`, `?set=full`, `?set=needs`). Capture mode runs on `?capture=1`.

## Limits, stated plainly

- **Hardware & browser footprint**: On-device Nano features require desktop Chrome 158+ with Built-in AI (`LanguageModel` text and multimodal image capabilities downloaded locally — a multi-GB browser download that may exceed shared low-storage lab PCs unless pre-cached). Other browsers run deterministic rules and can step through the complete Chrome + Nano flow via **Watch a recorded run** ([`public/recorded-run.json`](public/recorded-run.json)).
- **Language coverage**: Deterministic safety rules, single-pupil pronoun filters, and **Layer A lesson/parent-note conflict rules** cover **English, Hinglish phrases, and Devanagari Hindi**, while on-device **Nano semantic step checking (`check`) runs in English only** (Hindi drafts skip the English Nano checker with an explicit `Checked by Hindi rules on this device; the on-device model checks English drafts only` notice; other non-English languages show `NOT_ENGLISH`).
- **Invented data only**: All student names, family details, phone numbers, roll numbers, the 35-pupil stress set, and [`public/sample-notebook.jpg`](public/sample-notebook.jpg) are **invented data only**; no real pupil data, live school pilot, teacher workload study, or legal compliance certification is claimed. Real classroom deployment would require school/board governance and a paid Gemini API billing tier.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
