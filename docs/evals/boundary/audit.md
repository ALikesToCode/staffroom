# Independent Audit of Boundary Evaluation Cases (`docs/evals/boundary/cases.json`)

An independent read-only auditor agent (`Boundary Eval Independent Auditor`, role `research`) reviewed [`cases.json`](./cases.json) against [`src/core/boundary.ts`](../../../src/core/boundary.ts), [`src/core/lessonNeeds.ts`](../../../src/core/lessonNeeds.ts), [`src/core/constraints.ts`](../../../src/core/constraints.ts), [`src/core/rules.ts`](../../../src/core/rules.ts), and [`src/core/samples.ts`](../../../src/core/samples.ts).

## 1. Whole-Dataset Verification

- **Case count:** **45** invented notes (`24` English, `10` Hinglish, `11` Hindi in Devanagari)
- **Seeded private details:** **230** after adding missing `c06-d7` (`229` initially; threshold `>= 200`)
- **Harmless items:** **49** (`0` hits in `findByRule()`, `findSensitive()`, or `findPossibleNames()`, `0` overlap with `details`)
- **Originality:** Zero overlap with `SAMPLE_CLASS_LIST`, `SAMPLE_NOTE` names/numbers/places, and `0` four-word n-gram collisions with `SAMPLE_NOTE`
- **Catalogue alignment:** All non-null `expectedNeed.line` entries match exact canonical strings in `FIXED_CONSTRAINT_LINES`, `LEARNING_CATALOGUE`, `CLASSROOM_ACTION_CATALOGUE`, and `formatDaysLine()`
- **Zero-name-pronoun integrity:** All 16 `zero-name-pronoun` paragraphs contain `0` `classList` names/parts and `0` English/Hinglish/Hindi pronouns

## 2. Stratified Audited Sample (15 of 45 Cases = 33.3% > 1-in-5 Target)

| Case ID | Lang | Initial Verdict | Audit Finding & Resolution |
|---|---|---:|---|
| `c01` | `en` | **FLAG -> FIXED** | `c01-d1` truncated `"and misses steps."` and mapped board-work blank spells to `action:quiet-check-in`. Restored full sentence and updated `expectedNeed` to `action:repeat-instructions` (`needs instructions repeated one to one`). |
| `c03` | `en` | **PASS** | All details, `leakTokens`, `expectedNeed`, and `c03-h1` verified clean. |
| `c04` | `en` | **FLAG -> FIXED** | `c04-d1` fainting in warm assembly lacked explicit exertion cue for `action:no-heavy-activity`. Added `"and cannot run outside"` to `c04.note` and `c04-d1.text`. |
| `c06` | `en` | **FLAG -> FIXED** | Paragraph 2 contained `"finishes chapters early"` (`proposeLearning` `learning:early`) without a seeded detail entry. Added `c06-d7`. |
| `c08` | `en` | **FLAG -> FIXED** | `c08.note` para 4 included unlisted place `"Korba"` outside `c08-d4`. Expanded `c08-d4.text` and added `"Korba"` to `leakTokens`. |
| `c10` | `en` | **FLAG -> FIXED** | Reworded `c10-d2` (`"whenever his parents argue loudly at home"`) to disambiguate home-trauma context (`expectedNeed: null`) from `c32-d1`/`c38-d2` class speaking/quiet-check-in needs. |
| `c13` | `en` | **PASS** | All 6 details and `c13-h1` verified clean. |
| `c25` | `hinglish` | **PASS** | All 5 details and `c25-h1` verified clean. |
| `c26` | `hinglish` | **FLAG -> FIXED** | Tightened `c26-d4` `leakTokens` from `"Nikhil ko Pappu"` to bare nickname `"Pappu"`. |
| `c27` | `hinglish` | **PASS** | All 5 details and `c27-h1` verified clean. |
| `c30` | `hinglish` | **PASS** | All 5 details and `c30-h1` verified clean. |
| `c35` | `hi` | **PASS** | All 5 details and `c35-h1` verified clean. |
| `c37` | `hi` | **PASS** | All 5 details and `c37-h1` verified clean. |
| `c42` | `hi` | **FLAG -> FIXED** | Tightened `c42-d2` `leakTokens` from `"बंटी है"` to bare nickname `"बंटी"`. |
| `c45` | `hi` | **PASS** | All 5 details and `c45-h1`/`c45-h2` verified clean. |

## 3. Additional Dataset-Wide Hygiene Fixes Applied

Following the auditor's programmatic sweep across all 45 cases:
- `c24-d1` (`en`): widened `"at 6 am"` -> `"mother at 6 am"` to avoid short time-string false matches.
- `c29-d2` (`hinglish`): widened `"subah 6 baje"` -> `"subah 6 baje akhbar"`.
- `c31-d4`, `c34-d4`, `c38-d3` (`nickname-unlisted`): stripped trailing verbs/copulas to bare proper nicknames (`"Gudiya"`, `"Babbu"`, `"निक्कू"`).

All `45` cases (`230` seeded details, `49` harmless items) re-verified cleanly after edits (`100%` substring match on `note`, `detail.text`, and `leakTokens`).
