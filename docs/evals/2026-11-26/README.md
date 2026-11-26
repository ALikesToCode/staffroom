# Raw results, 26 November 2026

The JSON each run of [`eval.html`](../../../eval.html) printed, unchanged. All runs used headless Chrome 158 on Linux with Gemini Nano (Chrome built-in AI) and invented data. Times are UTC. The case files are in [`src/eval/`](../../../src/eval/).

| File | Set | Run at | Runs per case | Totals |
|---|---|---|---|---|
| `heldout.json` | `?set=heldout`: 8 cases where the advice goes against a withheld fact and 8 where the same fact is there and the advice is fine, written before the model saw them | 06:14 | 3 | conflicts caught in 24 of 24 runs; harmless cases flagged as a conflict in 4 of 24 runs |
| `full.json` | `?set=full`: the sample note, six fixed drafts, rules and model together | 06:18 | 2 | conflicts caught in 18 of 18; harmless items flagged as a conflict 0 of 42, marked unsure 3 of 42 |
| `fit1.json`, `fit2.json` | `?set=fit`: 22 answers for one child (14 steps that go against one constraint, 8 steps of a lesson), and 25 requests for what each child does in each of five lessons | 06:08, 06:12 | 1 each | answers the rules pass: 15 of 22 and 14 of 21; answers that repeat words of the private fact: 9 and 8; lesson points the rules pass: 45 of 46 and 41 of 45. Not rated for quality by a teacher. Run before commit fca2ef0 changed the fit prompt. |
| `learning.json` | `?set=learning`: 12 paragraphs for the proposer of learning needs | 12:53 | – | the rule found the labelled kind in 12 of 12 (paragraphs written knowing the rule); of 36 lines the model proposed, 3 passed the checks |

The check ran on the code as committed at 38165c9 (fca2ef0, at 06:14:38, changed only the fit prompt). The learning set ran on the code at 6bbb500.
