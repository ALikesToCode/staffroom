# Raw results, 27 November 2026

`guard.json` is what [`eval.html?set=guard&runs=3`](../../../eval.html) printed, unchanged: headless Chrome 158 on Linux with Gemini Nano, run at 00:48 UTC on the code at 4eec64c. The twelve invented notes and their labels are in [`src/eval/guard.ts`](../../../src/eval/guard.ts); the labels were committed (e4590b6, fac37c9) before any run. Each note ran three times through the guard's own steps, once with the rules alone and once with the rules and the on-device model.

| Per run, 12 notes | Rules alone | Rules and Gemini Nano |
|---|---|---|
| Labelled private details hidden in full | 40 of 60 | 49 of 60 |
| hidden in part | 11 | 10 |
| missed | 9 | 1 |
| The 19 details no word list was expected to catch: in full / in part / missed | 0 / 10 / 9 | 8 / 10 / 1 |
| Harmless spans held back | 5 of 8 | 4 of 8 |
| Labelled constraint kinds proposed | 1 of 11 | about 7 of 11 (20 of 33 over three runs) |
| Other constraint proposals, for the teacher to remove | 0 | about 12 (37 over three runs) |
| Median time per note | 3 ms | 3.9 s |

"In part" means some words of the detail were replaced (a town, a name) and the rest was sent. The one detail the model missed in every run: "He often comes to class without breakfast because the mess opens late". Harmless spans both modes held back: "Republic Day", "PE kit", "a poster on mental health for the corridor", and a sentence about a chapter on diseases.
