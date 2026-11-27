# Staffroom Demo Video Script & Shot List (`staffroom-demo-v6.mp4`)

- **Runtime**: `2m 22s` (`142.0s`, 1920x1080 H.264 @ 30fps, AAC narration)
- **Narration voice**: Maya 2 (`Nivedita`, seed 11)
- **Captions**: `/home/mysterious/Videos/staffroom-demo-v6.srt`
- **Live app**: `https://staffroom-hybrid-8a71.web.app` (or click **Watch a recorded run** in any browser without Chrome Built-in Gemini Nano)

All pupil notes, names, and exit-ticket records shown are invented.

---

## Segment Breakdown & Exact Narration

### 0. Hook (`0:00 – 0:10`)
- **Visual**: Opening title card (`Your device knows the child. The cloud only knows the need.`) -> live Landing Door diagram showing `On-device model: ready` beside `ON THIS DEVICE` (`ONLY_ON_DEVICE`) and `THE CLOUD` (`PREFER_IN_CLOUD`).
- **Voiceover**:
  > Shared school PCs cannot paste pupil notes into the cloud. Staffroom puts a privacy door on Chrome with Firebase AI Logic.

### 1. Multimodal Notebook Scan (`0:10 – 0:27`) — `ONLY_ON_DEVICE`
- **Visual**: Handwritten register photo (`public/sample-notebook.jpg`) -> `Try sample notebook photo` -> local multimodal transcription (`229 chars`, `0 model-host requests recorded`) and local Class list name extraction (`Diya Sharma`, `Meenal Joshi`).
- **Voiceover**:
  > Start with a handwritten register photo. Strictly on-device multimodal Gemini Nano transcribes it locally with zero cloud requests, and local name rules extract pupil names straight from the scanned text.

### 2. Hybrid Guard & Exit Gate (`0:27 – 0:50`) — `ONLY_ON_DEVICE`
- **Visual**: Switching to the invented 6-pupil class (`4.1x` speed-up during local pass) -> `Found by Gemini Nano`: Tanvi's Tuesday town-clinic visit withheld locally (`STAYS HERE`), abstracted into `THE CLOUD IS TOLD: Need E: away on Tuesdays` -> reviewed `Waiting at the door` / `Exit gate: clear` payload with zero pupil names or reasons (`874 characters to gemini-3.5-flash-lite`).
- **Voiceover**:
  > Switching to an invented six-pupil class, the one-pass on-device guard pairs Hinglish and English rules with Gemini Nano. Nano catches what rules miss: Tanvi misses Tuesdays for her grandmother's town clinic visit. Private reasons stay local; only class context and anonymous letter codes like Need E cross the reviewed Exit Gate.

### 3. Cloud Draft & Restoring the Child Locally (`0:50 – 1:11`) — `PREFER_IN_CLOUD` + `ONLY_ON_DEVICE`
- **Visual**: Right pane streams whole-class lesson + lettered adaptations (`gemini-3.5-flash-lite`) while left pane runs local checks (`checking item 3 of 5`) -> `Beside each child` shows `Need E` catch-up matched to `Tanvi Rao`, deterministic local pair rule `Seat Kabir and Ishaan apart.` beside `Kabir Qureshi`, and empathetic local Nano fit beside `Aarav Sharma`.
- **Voiceover**:
  > Gemini 3.5 Flash Lite streams the whole-class lesson and adapts each lettered need without ever knowing whose it is. Back on Chrome, Need E lands beside Tanvi, Kabir and Ishaan get one clear seating line, and local Nano suggests empathetic classroom support for Aarav.

### 4. Materials, Separate Print Copies & Exit Ticket Loop (`1:11 – 1:32`) — `IN_CLOUD` + Local Loop
- **Visual**: `Materials for this lesson` (`On the board` + `Practice sheet for the class`) -> `Sheet for Need E` beside `Tanvi Rao` -> Signed lesson showing separate `Print class copy (no names)` and `Print teacher's copy (private)` controls -> `Lessons` tab exit tickets (`Got it`, `Partly`, `Not yet`, `Absent`) feeding into **Plan the next lesson**.
- **Voiceover**:
  > One click builds board work, a class worksheet, and a take-home summary sheet for Tanvi. Class copy prints letter codes only, separate from the private Teacher's copy. In the Lessons tab, marking Got it, Partly, Not yet, or Absent feeds straight into tomorrow's plan.

### 5. Offline Fallback & Return Gate (`1:32 – 1:46`) — `PREFER_IN_CLOUD` -> `ON_DEVICE`
- **Visual**: Live offline-before-send capture (`Browser reported when you approved: offline`) recovering via on-device Gemini Nano (`Written on the device · Gemini Nano (Chrome built-in)`) with amber caution banner and deterministic Return Gate checks + clean `2 ready to accept · 13 need wording` bottom bar.
- **Voiceover**:
  > If school Wi-Fi drops before or mid-stream, Staffroom recovers on Gemini Nano offline with a clear caution banner, while the deterministic Return Gate still checks the output locally.

### 6. Inspect Proof & Chrome 158 Benchmarks (`1:46 – 2:10`)
- **Visual**: `Inspect` drawer showing all 6 declared routes across all 3 `@firebase/ai` modes (`Zero "Not run yet"`) + `Network, as the browser records it` (Chrome Resource Timing log: `0 requests to the model host` on Scan, Guard, Check, Name the receipt, and Fit; `1 request` each on Draft and Materials) -> closing Benchmark Card (`docs/evals/2026-11-28`).
- **Voiceover**:
  > Inspect shows all six routes across all three modes, plus Chrome's Resource Timing log: zero model requests on scan, guard, check, naming, and fit. Across three runs on twelve invented notes with sixty labelled details total, Nano raised full catches from forty to forty-nine point three out of sixty.

**Benchmark Card (on screen):**
- **1-Pass Guard (12 invented notes · 60 details total, run 3x = 180 judgments)**: **49.3 / 60 fully withheld (148/180)** vs **40 / 60 rules alone** (`25/180 partial · 7/180 missed (2.3/60) · False holds 2.0/8 (vs 5/8) · 11/33 constraints (+40 extra) · 4.06s median`)
- **Held-out Check**: `24 / 24 conflicts caught (4 / 24 harmless flagged)` · **Sample Scan**: `7.07s (229-231 chars, 0 cloud calls)`
- **Offline-before-send Fallback**: `40.76s PREFER_IN_CLOUD -> ON_DEVICE stream + Return Gate`
- **Automated Suite & Security**: `473 / 473 Vitest tests (21 files) · 0 TS errors · 0 audit vulnerabilities`

### 7. Outro (`2:10 – 2:22`)
- **Visual**: Closing card with live URL (`https://staffroom-hybrid-8a71.web.app`), **Watch a recorded run** fallback callout, repo URL (`https://github.com/ALikesToCode/staffroom`), and privacy defaults (`Shared PC session-only default · Strict CSP · All pupil data invented`).
- **Voiceover**:
  > Staffroom: your device knows the child; the cloud only knows the need. Try the live app or click Watch a recorded run in any browser.
