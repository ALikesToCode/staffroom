# Staffroom

Your device knows the child. The cloud only knows the need.

Built for **#BuildHybridAI 2026 (Best Web)**.
Live app: **https://staffroom-hybrid-8a71.web.app**

## The problem

In India's government and aided schools — and under **India's Digital Personal Data Protection (DPDP) Act 2023, Section 9** governing children's personal data — a teacher preparing tomorrow's plan in a shared **school ICT lab or staffroom** cannot upload raw notes naming a child's illness, parents' separation, unpaid fees, caste taunts, or phone number to a cloud model. Stripping all context produces generic lessons that break real pupil constraints (scheduling remedial work after the last bell for a student who must catch the 3:40 local bus home; setting smartphone homework for a household without a phone or internet).

## What Staffroom does

Staffroom puts a privacy door between raw classroom notes and the cloud, designed to work cleanly on a shared ICT-lab desktop (**notes do not persist across browser restarts by default**, with a one-click **Clear desk** control):

1. **Write or scan on the device**: Type notes (English, **Hinglish**, or **Devanagari**) or use **Scan notebook photo / Try sample notebook photo** (`public/sample-notebook.jpg`). Multimodal **Gemini Nano** downscales and transcribes handwritten pages locally (`~7.1s`, `231` chars verbatim, `0` cloud inference requests) and auto-populates the `Class list`.
2. **Guard locally before anything leaves (`guardCombinedOnDevice`)**: Deterministic pattern/sensitivity rules plus a 1-pass combined Gemini Nano call extract names, places, phone/STD/roll numbers, private details, and typed constraints locally on the device (`ONLY_ON_DEVICE`). A fail-closed **Exit Gate** checks the outgoing text and blocks sending if any withheld string remains or unguarded text stays unconfirmed.
3. **Send only capability codes (`Need A`, `Need B`, ...)**: For `Tomorrow's lesson`, zero pupil sentences, names, reasons, or health details leave the browser — only abstract needs (`Need A: cannot stay after the last bell`, `Need B: no phone or internet at home`, etc.), traced cross-door by letter.
4. **Stream the cloud draft (`gemini-3.5-flash-lite`) or fall back locally offline**: `writeDraft()` and `writeMaterials()` stream from Firebase AI Logic using `PREFER_IN_CLOUD` and structured schemas, falling back live to local **Gemini Nano streaming** with a clear caution notice if offline.
5. **Put the child back beside the lesson**: Locally in Chrome, Staffroom maps each cloud need entry onto the matching student, preserves peer seating adjustments (`pair: true`, e.g., `Seat Kabir and Ishaan apart.`), checks steps on-device against local constraints (`check`), offers optional local fits (**More ideas from this device**, `fit`), builds 1-click materials (`Board work`, `Practice sheet`, per-Need sheets, `Exit ticket`), prints a **Class copy** (`No names · letter codes only`) separately from the **Teacher's copy** with names, and drives the next lesson from private exit-ticket mastery counts.

*If you do not have Chrome 158+ with Gemini Nano enabled, click **Watch a recorded run** (`public/recorded-run.json`) to replay a complete Chrome 158 + Gemini Nano live run (`1 Write · 2 What leaves · 3 Lesson · 4 Beside each child · 5 Sign off`), trace every `Need` across the door, preview both copies, and inspect route & network proofs.*

## How hybrid inference works (Firebase AI Logic)

Every AI call passes through [`src/ai/routes.ts`](src/ai/routes.ts) using `@firebase/ai` across all three Firebase AI Logic hybrid modes (`ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `PREFER_ON_DEVICE`):

| Route | Mode (`InferenceMode`) | What it touches | Where it runs & fallback behaviour |
|---|---|---|---|
| `scan` | `ONLY_ON_DEVICE` | Local JPEG `<= 1024px` | Multimodal Gemini Nano OCR. Refused before request without local multimodal Nano; fails closed if `inferenceSource !== 'on_device'`. |
| `guard` | `ONLY_ON_DEVICE` | Raw note paragraphs | 1-pass entity + private detail + constraint extraction (`guardCombinedOnDevice`). Never touches network; heading paragraphs skipped in `constraintsFromCombined`. |
| `draft` | `PREFER_IN_CLOUD` | Gate-approved text only | Streams (`generateContentStream`) lesson & materials via Remote Config (`gemini-3.5-flash-lite`), automatically falling back to Gemini Nano offline. |
| `check` | `ONLY_ON_DEVICE` | One draft step + one constraint | Compares step against local constraint alongside deterministic word rules. |
| `fit` | `ONLY_ON_DEVICE` | Step or child note + stages | Rewrites conflicting step (`fitForChild`) or offers per-child suggestions (`fitLessonForChild`), rule-checked before offer. |
| `label` | `PREFER_ON_DEVICE` | Anonymous receipt summary | Short label for signed receipt; runs on-device when Gemini Nano is ready, can fall back to cloud on redacted metadata, or deterministic `FALLBACK` if offline/unconfigured. |

In **Inspect**, Staffroom shows live route execution alongside browser **Resource Timing** entries (`performance.getEntriesByType('resource')`) filtered to origin URLs matching Google/Firebase endpoints during that session — demonstrating `0` network calls to Firebase/Google inference during local `scan` and `guard` runs.

## Firebase & Web Platform

- **Firebase AI Logic** (`@firebase/ai`): hybrid routing (`ONLY_ON_DEVICE` + `PREFER_IN_CLOUD` streaming) with Remote Config model selection.
- **Firebase App Check**: reCAPTCHA Enterprise in production (`VITE_APPCHECK_DEBUG_TOKEN` unset in production builds; strict `.env.production.local` separation).
- **Firebase Hosting**: strict security headers in [`firebase.json`](firebase.json) (`Content-Security-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`).
- **Firebase Authentication & Cloud Firestore**: anonymous session binding and optional explicit receipt saving (`Keep a copy` toggle; default off for shared ICT-lab PCs).
- **PWA (`vite-plugin-pwa`)**: pre-caches the static shell (`dist/`) so local guard, check, fit, and fallback drafting work offline once visited and Gemini Nano is cached.

## Measured results (Chrome `158.0.8127.88` + Gemini Nano)

Raw logs & methodology live under [`docs/evals/2026-11-28/`](docs/evals/2026-11-28/) and [`docs/evals/`](docs/evals/):

- **1-pass Combined Guard (`GUARD_CASES`: 12 fresh invented notes, 60 private details × 3 runs = 180 judgements)**:
  - **Rules alone**: `40/60` caught in full (`11` partly, `9` missed, `0/19` hard non-rule details caught, `5/8` harmless curriculum lines held, `1/11` constraints matched, median `3 ms`).
  - **Rules + 1-pass `guardCombinedOnDevice`**: **`148/180` (`49.3/60` avg: 48, 49, 51)** caught in full, `25/180` partly, **`7/180` (`2.3/60` avg)** missed, `25/57` hard non-rule details caught, `123/123` standard details caught, **`2.0/8` harmless items held**, `11/33` constraints matched, `0` unread parts, `0` failures, median **`4,055 ms`** per note.
- **Multimodal Notebook Scan (`public/sample-notebook.jpg`)**: **7,072 ms**, **231 chars** transcribed verbatim, **0** cloud inference calls observed.
- **Offline Streaming Fallback (`PREFER_IN_CLOUD → ON_DEVICE`)**: **40,760 ms** under CDP offline emulation, live streaming preview, 6 checked steps mapped locally to all 5 children, caution banner rendered.
- **On-device Check (`eval.html`, 26 Nov 2026)**: 24/24 conflicts caught on 16 held-out cases (`4/24` harmless flagged); 18/18 conflicts caught across full sample-note runs (`0/42` harmless flagged as conflicts, `3` unsure).
- **Code quality & security**: `465/465` unit tests (`20` files), `tsc --noEmit` (`0` errors), `pnpm audit` (`0` known vulnerabilities).

## Run & verify locally

```bash
pnpm install
pnpm dev              # http://127.0.0.1:5173
pnpm test             # 465 tests across 20 Vitest files
pnpm typecheck        # tsc --noEmit
pnpm build            # dist/ + service worker
pnpm audit
```

Browser evaluations live on `/eval.html` (`?set=guard`, `?set=check`, `?set=full`, `?set=needs`). Capture mode runs on `?capture=1`.

## Limits, stated plainly

- On-device Nano features require desktop Chrome 158+ with Built-in AI (`LanguageModel` text and image capabilities) downloaded; other browsers run deterministic rules and can explore the full live Chrome + Nano flow via **Watch a recorded run** ([`public/recorded-run.json`](public/recorded-run.json)).
- All student names, family situations, phone numbers, roll numbers, and [`public/sample-notebook.jpg`](public/sample-notebook.jpg) are **invented data only**; no real pupil data or teacher field trial has been conducted. School deployment with real pupil notes requires a school/board DPDP Act agreement and a production Gemini billing tier.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
