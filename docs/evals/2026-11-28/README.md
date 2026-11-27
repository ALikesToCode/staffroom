# Evaluation Log — 28 November 2026

All runs executed on Chrome `158.0.8127.88` (Linux) with Chrome Built-in AI **Gemini Nano** via `@firebase/ai@3.1.0` against invented test data. Raw combined-guard metrics are in [`guard-combined.json`](./guard-combined.json).

## 1. 1-Pass Combined Guard (`guardCombinedOnDevice` + `constraintsFromCombined`)

Measured over **3 full runs × 12 fresh invented notes** (`GUARD_CASES`, `60` private details per run = `180` total judgements, `0` failures, `0` unread parts):

| Metric | Rules alone (`12` notes) | Combined 1-pass Nano (`36` runs = `3 × 12`) | Avg per 12-note run |
|---|---:|---:|---:|
| Private details fully withheld (`caught`) | 40 / 60 | **148 / 180** | **49.3 / 60** (48, 49, 51) |
| Partly withheld (`partly`) | 11 / 60 | 25 / 180 | 8.3 / 60 |
| Missed (`missed`) | 9 / 60 | **7 / 180** | **2.3 / 60** (3, 2, 2) |
| Hard non-rule details fully caught (`notEasy`) | 0 / 19 | **25 / 57** | **8.3 / 19** |
| Standard details fully caught (`easy`) | 40 / 41 | **123 / 123** | **41 / 41** |
| Harmless curriculum items wrongly held | 5 / 8 | **6 / 24** | **2.0 / 8** |
| Constraints matched (`constraintsLabelled`: 11/run) | 1 / 11 | **11 / 33** | **3.7 / 11** |
| Median per-note latency | 3 ms | **4,055 ms** | 3.68s – 4.20s |

Separately on the app's 5-paragraph `SAMPLE_NOTE` (`3` live Chrome 158 passes, `16.6s – 18.6s` per full note), Paragraph 5 (`Tanvi`) reliably produced a typed `time-after` constraint (`source: "on-device model"`) and private detail that rules alone missed (`3/3` passes). Heading-only paragraphs with no student names are skipped in `constraintsFromCombined` via `studentParagraphs()`.

## 2. Multimodal Notebook Photo Scan (`scan`, `ONLY_ON_DEVICE`)

- Input: [`public/sample-notebook.jpg`](../../../public/sample-notebook.jpg) (handwritten invented class notes, downscaled locally on `<canvas>` to `<= 1024px` JPEG).
- Capabilities reported by Chrome 158: `LanguageModel.availability()` `available`, multimodal image+text `available`.
- Latency: **7,072 ms** (~7.1 s).
- Cloud inference calls observed on CDP `Network` listener: **0** (`A1_CLOUD_NET: []`).
- Output: **231 chars** transcribed verbatim (`Class 6B - 16 Nov`, `Diya Sharma` 3:40 bus to `Chandpur` & unpaid term fee, `Meenal Joshi` `roll no. 6B/23.`, `Phone: 98112 34560`) plus automatic `Class list` extraction (`Diya Sharma`, `Meenal Joshi`).

## 3. Offline Streaming Fallback (`draft`, `PREFER_IN_CLOUD → ON_DEVICE`)

- Condition: CDP `Network.emulateNetworkConditions({ offline: true, ... })` engaged before clicking `Approve and send` on `SAMPLE_NOTE`.
- Execution: `writeDraft()` via `generateContentStream()` fell back automatically from `PREFER_IN_CLOUD` to `ON_DEVICE`.
- Latency: **40,760 ms** (~40.8 s) with incremental live streamed draft preview visible (`sawStreamText: true`).
- Output: Valid structured draft (`Class 6B — Writing a Short Description of a Place`), all 5 children mapped locally, 6 checked stages, and visible caution banner (`"The cloud draft failed, so the on-device model wrote this draft from the same approved text."`).
