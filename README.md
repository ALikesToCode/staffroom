# Staffroom

**Your device knows the child. The cloud only knows the need.**

Built for **#BuildHybridAI 2026 (Best Web/Chrome)** · Live app: **https://staffroom-hybrid-8a71.web.app** · Licence: [Apache-2.0](LICENSE)

A teacher photographs a page of her notebook. Her computer hides every child's name and private details, then asks the cloud for tomorrow's lesson using only needs like "away on Tuesdays". When the lesson comes back, her computer puts each child's name beside the line written for them.

![Staffroom privacy door showing private details staying on the computer and lettered needs sent to the cloud](docs/door-preview.png)

## Try it

- **Any browser, no setup.** Open **https://staffroom-hybrid-8a71.web.app** and click **Watch a recorded run** (labelled **Watch a recorded run with Gemini Nano** on browsers without an on-device model). It replays a real Chrome and Gemini Nano run, step by step.
- **Chrome 158+ with Gemini Nano.** Requires desktop Chrome 158 or newer with Built-in AI ready — see Chrome's [Prompt API hardware & disk requirements](https://developer.chrome.com/docs/ai/prompt-api) (`>= 22 GB` free disk and either `> 4 GB` VRAM or `16 GB` RAM + `4+` CPU cores). Click **Try a sample class**, press **Hide private details**, tick **I have read it**, and click **Send**. For the handwriting scan, click **Type instead**, then **Try sample notebook photo**.

## How each step picks a model

Every model call goes through Firebase AI Logic (`@firebase/ai`). If an input can identify a child, the step may only run on the device:

| Step | Mode | Why |
|---|---|---|
| Read the notebook photo | `ONLY_ON_DEVICE` | The photo holds names. The step refuses to run if Gemini Nano is not available. |
| Guard the note | `ONLY_ON_DEVICE` | It reads the raw note. If the answer did not come from the device, the app stops. On a computer without Gemini Nano, the guard runs on rules alone and tells the teacher so. |
| Write the lesson and materials | `PREFER_IN_CLOUD` | It sees only the approved text, and the larger model writes better lessons. Offline, or if the stream breaks, Gemini Nano takes over. |
| Check each step against a child's constraint | `ONLY_ON_DEVICE` | The constraint is private. |
| Suggest a fit for one child | `ONLY_ON_DEVICE` | It reads the child's note. |
| Name the saved record | `PREFER_ON_DEVICE` | It reads only the first 240 characters of the already-approved outgoing text, which holds no pupil identity. Runs on the device when ready and in the cloud when needed. |

## Measured results (Chrome `158.0.8127.88` + Gemini Nano)

Raw logs & methodology live under [`docs/evals/2026-11-28/`](docs/evals/2026-11-28/) and [`docs/evals/`](docs/evals/):

| Benchmark | Denominator & Conditions | Rules Alone | Rules + Gemini Nano |
|---|---|---:|---:|
| **1-pass Combined Guard** ([`guard-combined-v2.json`](docs/evals/2026-11-28/guard-combined-v2.json)) | `12` distinct invented notes, `60` labelled details total, run `3×` (`180` judgments) | `46/60` (`138/180`), `10/60` partial, `4/60` missed, `3/8` (`9/24`) harmless held, `1/11` constraints matched, `2 ms` | **`153/180`** (`51.0/60` across all 3 runs), `21/180` partial, **`6/180` (`2.0/60`) missed**, `30/57` hard non-rule details caught, `123/123` standard, **`0/24` (`0.0/8`) harmless held**, `12/33` exact constraint matches (`+19` unconfirmed extras), **`3,806 ms` (`3.81s`) median** |
| **35-Pupil Stress Test** ([`scale-35.json`](docs/evals/2026-11-28/scale-35.json)) | Synthetic `35`-pupil note (`2,177` chars across `16` paragraphs) | `50` withheld, `0` leaked, `0 ms` | **`67` withheld (`+17` Nano)**, `0` unread/dropped/partial, **`0` exit-gate stops, `0` leaked tokens** (`50.3s`) |
| **On-device Check** (`?set=heldout` / `?set=check`) | `16` held-out single-fact cases (`8` conflicts × `3`; `8` harmless × `3`) | — | **`24/24`** conflicts caught (`4/24` harmless flagged); `18/18` on full-note eval (`0/42` harmless conflicts) |
| **Multimodal Notebook Scan** (`scan`) | Single sample page (`public/sample-notebook.jpg`), Chrome 158 | — | **`3.1s`** model step (`4.4s` UI end-to-end), `231` chars transcribed, **`0` cloud calls**, `2` names extracted |
| **Offline-before-send Fallback** (`draft`) | `SAMPLE_NOTE` (`12` needs), Chrome 158 CDP offline before approval | — | **`23.3s`** (`23,298 ms`) `PREFER_IN_CLOUD -> ON_DEVICE` stream + Return Gate: **`12/12` needs written for a stage (`0` missing), `0` `[Student]` brackets** |

- **Automated suite & security**: **`500/500` unit tests** (`21` Vitest files), `tsc --noEmit` (`0` errors), `pnpm audit --prod` (`0` known vulnerabilities).

## Limits

- **Hardware today**: On-device Nano features require desktop Chrome 158+ meeting [Prompt API requirements](https://developer.chrome.com/docs/ai/prompt-api) (`>= 22 GB` free storage and `> 4 GB` VRAM or `16 GB` RAM + `4+` cores). Older lab PCs and phones run deterministic privacy rules with clear notices and cloud drafting, or can replay the Chrome + Nano run via **Watch a recorded run**.
- **API tier**: The public demo uses the free Gemini Developer API tier ([terms](https://ai.google.dev/gemini-api/terms)), where Google may use submitted prompts and outputs to improve its products; only approved redacted needs are sent. Schools must use a paid tier.
- **Language scope**: Rules, pronoun filters, and Layer A lesson checks cover English, Hinglish, and Devanagari Hindi; Gemini Nano semantic step checking (`check`) runs in English only (Hindi drafts show a rule-only caution). The screens are in English, with a short Hindi line under some of the main buttons.
- **Invented data only**: No teacher has used this in a classroom yet. Every pupil, note, and notebook photo is invented.

## Details

### Shared-computer privacy & data flow

Staffroom is designed for shared computers (notes, class lists, confirmed constraints, saved lessons, and text-bearing local records default to `sessionStorage` only; `localStorage` persistence is strictly opt-in via *Keep this class in this browser*):

- **Clear desk** wipes `sessionStorage`, opted-in `localStorage` keys (`staffroom.class.v1`, `staffroom.keepClass`, `staffroom.lessons.v1`, `staffroom.receipts.v1`), `staffroom.keepCopies`, and signs out the anonymous Firebase Auth session (`clearUserSession()`, surfacing a persistent `signout-failed` retry banner and fail-closed copy gating if sign-out fails).
- **Separate print copies & Materials**: Signed lessons separate **Print class copy (no names)** (`class-only`, also default for `Ctrl+P` / `Cmd+P`) from **Print teacher's copy (private)**, and 1-click **Materials** (`Board work`, `Practice sheet`, per-Need sheets, `Exit ticket`) print letter codes only unless pupil names are explicitly included.
- **Deterministic privacy core & gates** ([`src/core/`](src/core/)): Combines `vault.ts`, `rules.ts`, `gate.ts` (`checkOutgoing`), `needs.ts` (`classSentences`, `outgoingOf`, Hinglish/Devanagari singular pronouns in `ONE_PERSON`), `lesson.ts`, `lessonNeeds.ts`, `conflicts.ts` (English + Devanagari Hindi Layer A rules), `recorded.ts`, `recheck.ts`, and `ticket.ts`.
- **Resilient streaming & offline schema** (`src/ai/draft.ts`): Streams `gemini-3.5-flash-lite` via `generateContentStream`; on offline or mid-stream failures, switches to grammar-constrained `OFFLINE_LESSON_SYSTEM` + `OFFLINE_LESSON_NEEDS_SCHEMA` + `offlineLessonPrompt()` with deterministic `normalizeOfflineNeeds()`.

### Module layout & Firebase services

- **UI & state**: [`src/App.tsx`](src/App.tsx), [`src/app/storage.ts`](src/app/storage.ts), and [`src/ui/`](src/ui/).
- **Hybrid AI routing**: [`src/ai/routes.ts`](src/ai/routes.ts) (`scan`, `guard`, `draft`, `check`, `fit`, `label`). **How it ran (Inspect)** displays all 6 routes alongside `performance.getEntriesByType('resource')` network timing (`0` model-host requests for `scan`, `guard`, `check`, `label`, and `fit`).
- **Firebase & PWA**: Firebase AI Logic (`@firebase/ai`), Remote Config (`cloud_model`), App Check (reCAPTCHA Enterprise; debug tokens excluded from production builds), Anonymous Auth + optional count-only Cloud Firestore records (`Keep a copy`, off by default), Hosting strict CSP (`connect-src 'self' data:`), and `vite-plugin-pwa` offline precaching of `dist/`.

### Run & verify locally

```bash
pnpm install
pnpm dev              # http://127.0.0.1:5173
pnpm test             # 500 tests across 21 Vitest files
pnpm typecheck        # tsc --noEmit
pnpm build            # dist/ + service worker
pnpm audit --prod     # 0 known production vulnerabilities
```

Browser evaluations live on `/eval.html` (`?set=guard`, `?set=scale35`, `?set=heldout`, `?set=check`, `?set=full`, `?set=needs`). Capture mode runs on `?capture=1`.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
