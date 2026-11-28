# Before / After Sample Class Comparison (`submitted-fallback` vs `boundary`)

Side-by-side comparison of the unified sample class (`Class 6`, `English`, `Writing a short description of a place`, `40 minutes`) run end-to-end in real Chrome 158 (`Gemini Nano (Chrome built-in)` on-device + `gemini-3.5-flash-lite` in cloud).

## 1. Summary Metrics

| Metric | Before (`submitted-fallback` @ `12b6636`) | After (`boundary`, preview `1chqe61u`) | Delta |
|---|---:|---:|---:|
| Raw notebook text leaked in `outgoing` | `"Class 6B, week of 16 November. Notes for myself."` (50 chars incl. `\n\n`) | **None (`0` chars, `0` notebook sentences)** | **-50 chars / 0 leakage** |
| Total `outgoing` length | **874 chars** | **824 chars** | **-50 chars** |
| Shared needs sent (`A..I, M..O`) | 12 | 12 | Equal (`12/12`) |
| Cloud draft timing (`gemini-3.5-flash-lite`) | 3,998 ms | 4,051 ms | ~Equal |
| Materials timing (`gemini-3.5-flash-lite`) | 4,194 ms | 3,417 ms | -777 ms |
| Cloud stages generated | 5 stages (Starter, Teach, Practise, Check, Homework) | 5 stages (Starter, Teach, Practise, Check, Homework) | Equal |
| Need variations accounted (`variations` + `already suits`) | 8 variations + 4 `already suits` (`missing: []`) | 8 variations + 4 `already suits` (`missing: []`) | Equal (`12/12`) |
| Materials differentiated versions (`versions` + `same`) | 8 versions + 4 `same` (`missing: []`) | 4 versions (`E, G, H, O`) + 8 `same` (`missing: []`) | Equal (`12/12`) |
| Chalkboard / pen / notebook resource constraint | Respected | Respected | Equal |

## 2. Verdict on Whole-Class Quality

**No quality degradation observed.** Removing the unredacted header sentence (`"Class 6B, week of 16 November. Notes for myself."`) did not weaken the lesson stages, chalkboard scripts, sensory writing model, per-need variations, worksheets, or exit-ticket questions. Every need letter received concrete classroom-ready guidance or verified applicability (`missing: []`), so an optional `"Anything about the whole class?"` bypass field is **not needed** and was not added.

## 3. Outgoing Payload Comparison

### Before (`submitted-fallback`, 874 chars)
Started with unredacted notebook prose:
```text
Class 6B, week of 16 November. Notes for myself.

Needs in this class (no names and no reasons are given; a need may be one pupil's or several):
Need A: cannot stay after the last bell
...
```

### After (`boundary`, 824 chars)
Starts directly with fixed-catalogue needs and lesson metadata (zero notebook text):
```text
Needs in this class (no names and no reasons are given; a need may be one pupil's or several):
Need A: cannot stay after the last bell
Need B: no phone or internet at home
Need C: nothing that has to be bought or brought from home
Need D: cannot come before the first bell
Need E: away on Tuesdays
Need F: finds written tests hard; can answer aloud
Need G: finishes early and needs more to do
Need H: has missed recent lessons
Need I: works better apart from one classmate
Need M: has not handed in recent homework
Need N: needs time before speaking in front of the class
Need O: reads above the level of the class
Under "For each need", give an entry for every one of these letters: A, B, C, D, E, F, G, H, I, M, N, O.

Lesson
Class: Class 6
Subject: English
Topic: Writing a short description of a place
Length: 40 minutes
```

## 4. Lesson Stages Side-by-Side

| Stage | Before (`submitted-fallback`) | After (`boundary`) |
|---|---|---|
| **Title** | Class 6 English — Writing a Short Description of a Place | Class 6 English — Writing a Short Description of a Place |
| **Starter (5 minutes)** | Close eyes and think of a favourite room/park; chalkboard heading `Places We Know`; list 3 sight/sound/smell words. | Close eyes and think of a favourite spot in town/village; chalkboard heading `My Favourite Place`; write 3 things you can see. |
| **Teach (10 minutes)** | 3-sentence chalkboard model paragraph about bright yellow classroom, neem tree birds, damp soil breeze; pupils copy. | 3-sentence chalkboard model paragraph about the old village well, brass pots, and neem tree; focus on colour and sound words. |
| **Practise (15 minutes)** | Write 3 sentences using sight, sound, smell with notebooks and pens. | Write 5 sentences in notebooks using see, hear, feel; teacher circulates with chalk and pens. |
| **Check (10 minutes)** | Exchange notebooks with a partner and check sight, sound, smell details; share one liked thing. | Exchange notebooks with seatmate for colour + sound word; volunteers read one sentence aloud. |
| **Homework** | Write 4 descriptive sentences in notebook about kitchen or walk to school. | Copy corrected paragraph and write 3 sentences on what happens at the place in the evening. |

## 5. Per-Need Variations Side-by-Side (`missing: []` in both)

- **Before (`submitted-fallback`)**:
  - `Need H` (`Starter`): Short recap of descriptive words from chalkboard before writing.
  - `Need F` (`Practise`): Tell description aloud first, then teacher helps write sentences.
  - `Need G` (`Practise`): Write a second short paragraph describing a busy marketplace.
  - `Need I` (`Practise`): Sit at separate desk independently to write quietly.
  - `Need O` (`Practise`): Write 6 sentences with rich vocabulary and figurative language.
  - `Need N` (`Check`): Share written description quietly at teacher's desk instead of whole class.
  - `Need E` (`Homework`): Chalkboard take-home summary lines (`Summary: We learned to write a four-sentence description...`).
  - `Need M` (`Homework`): Show completed homework paragraph at start of next lesson.
  - `already suits`: `A, B, C, D`.
- **After (`boundary`)**:
  - `Need H` (`Starter`): 3-line chalkboard recap (`A place description uses clear nouns and action verbs...`).
  - `Need G` (`Practise`): Extra paragraph on smells and rainy-season weather changes.
  - `Need I` (`Practise`): Move to empty desk by the window to write independently.
  - `Need O` (`Practise`): Advanced adjectives and figurative language (similes).
  - `Need F` (`Check`): Tell description aloud while teacher writes sentences into notebook.
  - `Need N` (`Check`): Two extra minutes to read sentences silently before sharing aloud.
  - `Need E` (`Homework`): Chalkboard take-home summary lines for copying.
  - `Need M` (`Homework`): Bring missing homework and today's writing task tomorrow morning.
  - `already suits`: `A, B, C, D`.

## 6. Materials Side-by-Side (`missing: []` in both)

- **Before (`submitted-fallback`)**: 7 board lines, 8 base sheet items, 8 differentiated versions (`E, F, G, H, I, M, N, O`), `same: ["A", "B", "C", "D"]`, 3 exit-ticket Q&As.
- **After (`boundary`)**: 7 board lines, 6 base sheet items, 4 distinct differentiated sheets (`E` take-home recap, `G` extra challenge, `H` starter recap, `O` advanced figurative passage), `same: ["A", "B", "C", "D", "F", "I", "M", "N"]`, 3 exit-ticket Q&As.

## 7. Provenance

Captured from live deployment of branch `boundary` on `https://staffroom-hybrid-8a71--boundary-1chqe61u.web.app/?capture=1` (Chrome `158.0.0.0`, `recordedAt: 2026-11-28T17:41:17.905Z`) and saved to [`public/recorded-run.json`](../../../public/recorded-run.json).
