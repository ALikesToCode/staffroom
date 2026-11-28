# Staffroom: Video Script (`v8` — `staffroom-demo-v8.mp4`)

- **Total duration**: `146.80s` (`2m 26.8s`, strictly under `2:30`), `1920x1080` `30fps` H.264/AAC (NVENC), cursor-free live Chrome 158 screencast + DOM stills, Maya 2 (`Nivedita`) narration, `34` decimal-safe caption cues ([`staffroom-demo-v8.srt`](/home/mysterious/Videos/staffroom-demo-v8.srt)).
- **Unified `v8` export**: `?capture=1` exported the live online run (`4.4s` scan end-to-end / `3.1s` model step, `0` model-host calls on all 5 local routes) directly into [`public/recorded-run.json`](../public/recorded-run.json), then continued offline before send to film Shot 6.

## Shot list & voiceover (`p01`–`p08`)

1. **`0:00.00 – 0:10.10` (`p01`) — Title Card + Hero Split-Pane Door**
   > Shared school PCs cannot paste pupil notes into the cloud. Staffroom puts a privacy door on Chrome with Firebase AI Logic.

2. **`0:10.10 – 0:26.94` (`p02`) — Multimodal Notebook OCR (`scan`, `ONLY_ON_DEVICE`) & Class List**
   > Start with a handwritten register photo. Strictly on-device multimodal Gemini Nano transcribes it locally with zero cloud requests, and local name rules extract pupil names straight from the scanned text.

3. **`0:26.94 – 0:54.09` (`p03`) — 1-Pass Hybrid Guard (`guard`) + Nano-Exclusive Need E + Exit Gate**
   > Switching to an invented six-pupil class, the one-pass on-device guard pairs Hinglish and English rules with Gemini Nano. Nano catches what rules miss: Tanvi misses Tuesdays for her grandmother's town clinic visit. Private reasons stay local; only teacher-reviewed class context and anonymous letter codes like Need E cross the Exit Gate.

4. **`0:54.09 – 1:15.41` (`p04`) — Cloud Stream (`PREFER_IN_CLOUD`) -> Check -> Beside Each Child & Aarav Fit (`fit`)**
   > Gemini 3.5 Flash Lite streams the whole-class lesson and adapts each lettered need without ever knowing whose it is. Back on Chrome, Need E lands beside Tanvi, Kabir and Ishaan get one clear seating line, and local Nano suggests empathetic classroom support for Aarav.

5. **`1:15.41 – 1:35.53` (`p05`) — 1-Click Materials, Separate Print Copies & Lessons Exit Ticket**
   > One click builds board work, a class worksheet, and a take-home summary sheet for Tanvi. Class copy prints letter codes only, separate from the private Teacher's copy. In the Lessons tab, marking Got it, Partly, Not yet, or Absent feeds straight into tomorrow's plan.

6. **`1:35.53 – 1:51.89` (`p06`) — Offline-Before-Send Failover (`PREFER_IN_CLOUD -> ON_DEVICE`, `41.3s`, `12/12` needs)**
   > If school Wi-Fi drops, Staffroom recovers on Gemini Nano offline with a clear caution banner, tested mid-stream in code and shown offline here, while the deterministic Return Gate still checks the output locally.

7. **`1:51.89 – 2:15.13` (`p07`) — Inspect (All 6 Routes + Resource Timing) & Verified Benchmark Card**
   > Inspect logs all six routes and Resource Timing: zero cloud model calls on scan, guard, check, naming, and fit. On twelve invented notes across three runs, Nano raised catches from forty-six to fifty-one out of sixty with zero false holds, and held sixty-seven spans across thirty-five pupils.

8. **`2:15.13 – 2:26.80` (`p08`) — Closing Card**
   > Staffroom: your device knows the child; the cloud only knows the need. Try the live app or click Watch a recorded run in any browser.
