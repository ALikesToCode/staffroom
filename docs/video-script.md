# Staffroom — Demo Video Script (`v7`, `2m 28s` / `148.20s`)

- **Final video**: `/home/mysterious/Videos/staffroom-demo-v7.mp4` (`1920x1080`, `30 fps`, H.264 + AAC, `148.20s`)
- **Subtitles**: `/home/mysterious/Videos/staffroom-demo-v7.srt` (`34` cues)
- **Narration**: 8 segments (`p01`–`p08`) paired with a single live Chrome 158 capture against `https://staffroom-hybrid-8a71.web.app`, crisp still plates for dense materials/copies, an offline Nano fallback demo, and verified benchmark/proof cards.

## Shot List & Verbatim Narration

### 1. Hook & Privacy Door (`0:00.00 – 0:10.17`)
- **Visual**: Live capture of [staffroom-hybrid-8a71.web.app](https://staffroom-hybrid-8a71.web.app) showing the Workspace header, Device vs Cloud boundary (`The Door`), and `0 KB -> cloud` indicator.
- **Narration (`p01`)**:
  > Shared school PCs cannot paste pupil notes into the cloud. Staffroom puts a privacy door on Chrome with Firebase AI Logic.

### 2. Local Multimodal Notebook OCR (`0:10.17 – 0:27.07`)
- **Visual**: **Write a note -> Try sample notebook photo** runs multimodal Gemini Nano locally in Chrome (`ONLY_ON_DEVICE`), producing handwritten OCR transcription with `0` cloud requests while `extractScannedClassList` pulls **`Class list 2 names`** (`Diya Sharma`, `Meenal Joshi`) locally without phone-number metadata leaks.
- **Narration (`p02`)**:
  > Start with a handwritten register photo. Strictly on-device multimodal Gemini Nano transcribes it locally with zero cloud requests, and local name rules extract pupil names straight from the scanned text.

### 3. On-Device Guard, Need E Discovery & Exit Gate (`0:27.07 – 0:54.28`)
- **Visual**: **Try an invented class** (6 pupils) -> one-pass local guard pairs Hinglish/English rules with Gemini Nano (`IN_DEVICE`). Nano catches **`Found by Gemini Nano`** (`Away on some days` -> **`Tanvi Rao`** missing Tuesdays for her grandmother's clinic visit). Private notes stay on the left of The Door; only teacher-reviewed class context and anonymous letter codes (`Need E: away on Tuesdays`) pass the `Exit gate: clear` check.
- **Narration (`p03`)**:
  > Switching to an invented six-pupil class, the one-pass on-device guard pairs Hinglish and English rules with Gemini Nano. Nano catches what rules miss: Tanvi misses Tuesdays for her grandmother's town clinic visit. Private reasons stay local; only teacher-reviewed class context and anonymous letter codes like Need E cross the Exit Gate.

### 4. Live Cloud Streaming & Local Re-Pairing (`0:54.28 – 1:15.66`)
- **Visual**: `gemini-3.5-flash-lite` streams the lesson (`IN_CLOUD`) over Firebase AI Logic using only anonymous letter codes (`Need A`–`Need F`). Back in Chrome, `Need E` lands beside `Tanvi Rao`, `Kabir Malhotra` + `Ishaan Verma` get one non-contradictory seating line (`Accept`), and **More ideas from this device** (`fit`) runs on Gemini Nano (`IN_DEVICE`) for `Aarav Nair`.
- **Narration (`p04`)**:
  > Gemini 3.5 Flash Lite streams the whole-class lesson and adapts each lettered need without ever knowing whose it is. Back on Chrome, Need E lands beside Tanvi, Kabir and Ishaan get one clear seating line, and local Nano suggests empathetic classroom support for Aarav.

### 5. One-Click Materials, Copies & Exit-Ticket Loop (`1:15.66 – 1:35.84`)
- **Visual**: `Materials` card from the same live run (`On the board` -> `Favourite outdoor places`, `Practice sheet for the class`, and **`Sheet for Need E`** for `Tanvi Rao`), separate nameless **Class copy** (`No names printed by default`) vs private **Teacher's copy** print actions, and the **Lessons** tab (`Got it / Partly / Not yet / Absent`) feeding into **Use in tomorrow's lesson**.
- **Narration (`p05`)**:
  > One click builds board work, a class worksheet, and a take-home summary sheet for Tanvi. Class copy prints letter codes only, separate from the private Teacher's copy. In the Lessons tab, marking Got it, Partly, Not yet, or Absent feeds straight into tomorrow's plan.

### 6. Offline Cloud-Drop Recovery on Gemini Nano (`1:35.84 – 1:52.26`)
- **Visual**: With Chrome offline, requesting the lesson drops straight onto on-device Gemini Nano (`ONLY_ON_DEVICE`), displaying the caution banner (`Written on the device · Gemini Nano`) while the deterministic Return Gate still validates the output locally.
- **Narration (`p06`)**:
  > If school Wi-Fi drops, Staffroom recovers on Gemini Nano offline with a clear caution banner, tested mid-stream in code and shown offline here, while the deterministic Return Gate still checks the output locally.

### 7. Inspect Proof & Local Evaluation Card (`1:52.26 – 2:16.36`)
- **Visual**: **Inspect -> Where each step runs** showing all 6 declared routes (`scan`, `guard`, `check`, `naming`, `lesson`, `fit`) across `ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, and `PREFER_IN_CLOUD`, followed by **Network, as the browser records it** (`22` live Resource Timing entries, `0` model requests on local steps), then the Benchmark Card (`49.3 / 60 withheld (148/180) vs 40 / 60 rules`, `478 / 478 Vitest tests (21 files)`).
- **Narration (`p07`)**:
  > Inspect shows all six routes across all three modes, plus Chrome's Resource Timing log: zero model requests on scan, guard, check, naming, and fit. Across three runs on twelve invented notes with sixty labelled details total, Nano raised full catches from forty to forty-nine point three out of sixty.

### 8. End Card (`2:16.36 – 2:28.20`)
- **Visual**: Summary card showing `staffroom-hybrid-8a71.web.app`, core privacy promise, and **Watch a recorded run** guidance for any browser without Chrome Nano setup.
- **Narration (`p08`)**:
  > Staffroom: your device knows the child; the cloud only knows the need. Try the live app or click Watch a recorded run in any browser.
