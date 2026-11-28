# Evaluation Log — 28 November 2026

All runs executed on Chrome `158.0.8127.88` (Linux) with Chrome Built-in AI **Gemini Nano** via `@firebase/ai@3.1.0` against invented test data. Latest combined-guard metrics live in [`guard-combined-v2.json`](./guard-combined-v2.json) (prior baseline in [`guard-combined.json`](./guard-combined.json)) and the 35-pupil stress run lives in [`scale-35.json`](./scale-35.json).

## 1. 1-Pass Combined Guard (`guard-combined-v2.json`, latest)

Measured after the R5 polish pass over **3 full runs × 12 fresh invented notes** (`GUARD_CASES`, `60` private details per run = `180` total judgements, `0` failures, `0` unread parts):

| Metric | Rules alone (`3 × 12` runs) | Combined 1-pass Nano (`36` runs = `3 × 12`) | Avg per 12-note run |
|---|---:|---:|---:|
| Private details fully withheld (`caught`) | 138 / 180 (46 / 60) | **153 / 180** | **51.0 / 60** (51, 51, 51) |
| Partly withheld (`partly`) | 30 / 180 (10 / 60) | 21 / 180 | 7.0 / 60 |
| Missed (`missed`) | 12 / 180 (4 / 60) | **6 / 180** | **2.0 / 60** (2, 2, 2) |
| Hard non-rule details fully caught (`notEasy`) | 18 / 57 (6 / 19) | **30 / 57** | **10.0 / 19** |
| Standard details fully caught (`easy`) | 120 / 123 (40 / 41) | **123 / 123** | **41 / 41** |
| Harmless curriculum items wrongly held | 9 / 24 (3 / 8) | **0 / 24** | **0.0 / 8** |
| Constraints matched (`constraintsLabelled`: 11/run) | 3 / 33 (1 / 11) | **12 / 33** (`+19` extras) | **4.0 / 11** |
| Median per-note latency | 2 ms | **3,806 ms** | **3.81 s** |

*(Earlier 28 Nov pre-polish baseline in [`guard-combined.json`](./guard-combined.json): rules `40/60`, combined `148/180` = `49.3/60` (`48, 49, 51`), `7/180` missed, `6/24` harmless held, `11/33` constraints `+40` extras, `4,055 ms` median.)*

## 2. 35-Pupil Scale Stress Test (`scale-35.json`, `?set=scale35`)

Executed on a synthetic **35-student** note (`2,177` characters across `16` paragraphs) in Chrome 158:

- **Rules only (`RULES_ONLY`)**: `50` entities withheld, `11` constraints proposed, `1` learning proposed, `0` unread/dropped/partial, `0` leaks, `0` exit-gate violations (`0 ms`).
- **Combined 1-pass Nano (`ON_DEVICE`)**: **`67` entities withheld (`+17` added by Nano)**, `11` rule + `19` combined constraints proposed, `1` learning proposed, `0` unread/dropped/partial, **`0` exit-gate violations**, **`0` leaked tokens** (`50,319 ms`).

## 3. Multimodal Notebook Photo Scan (`scan`, `ONLY_ON_DEVICE`)

- Input: [`public/sample-notebook.jpg`](../../../public/sample-notebook.jpg) (handwritten invented class notes, downscaled locally on `<canvas>` to `<= 1024px` JPEG).
- Capabilities reported by Chrome 158: `LanguageModel.availability()` `available`, multimodal image+text `available`.
- Latency: **3,129 ms** model step (`4,405 ms` end-to-end click-to-preview in the `v8` unified capture; `7,072 ms` in the earlier `v7` cold capture).
- Cloud inference calls observed in Resource Timing (`networkSteps`): **0**.
- Output: **231 chars** transcribed verbatim (`Diya Sharma`, `Chandpur`, `Meenal Joshi`, `roll no. 6B/23.`, `Phone: 98112 34560`) plus automatic `Class list` extraction (`Diya Sharma`, `Meenal Joshi`, `0` phone numbers).

## 4. Offline Streaming Fallback (`draft`, `PREFER_IN_CLOUD → ON_DEVICE`)

- Condition: CDP `Network.emulateNetworkConditions({ offline: true, ... })` engaged before clicking `Approve and send` on `SAMPLE_NOTE` (`12` confirmed needs: `A`–`I`, `M`–`O`).
- Execution: `writeDraft()` routed offline lesson prompt through `OFFLINE_LESSON_SYSTEM` + `OFFLINE_LESSON_NEEDS_SCHEMA` + `offlineLessonPrompt()` + `normalizeOfflineNeeds()`.
- Latency (`v9` live Chrome 158 capture): **23,298 ms** (`23.3 s`) with offline caution banner (`"You were offline when you approved, so the on-device model wrote this draft from the same approved text."`).
- Output: **`12 / 12` needs written for a stage (`0` missing)**, **`0` `[Student N]` bracket leaks**, local Return Gate check passed.

## 5. Live Hindi Layer A Verification (`Notes to parents`)

- Verified live in Chrome 158 on a `Hindi` parent note (`Meenal Joshi` last-bell rule + fluent speech): displayed `HINDI_RULE_ONLY` caution banner (`Checked by Hindi rules on this device; the on-device model checks English drafts only. Read the Hindi text yourself too.`), executed deterministic Layer A rules (`rules only, no model`), and streamed Devanagari text cleanly.
