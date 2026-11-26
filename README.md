# Staffroom

**What the teacher approves is the only note text sent.** A small on-device model reads a teacher's note about a child on the teacher's device and proposes what to withhold; a large cloud model does the writing and is sent only the text the teacher approved. If the teacher withholds nothing, that text is the note as written, and the app says so and asks for a second tick.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) with Firebase AI Logic hybrid inference. Platform: Web (Chrome on desktop).
**Try it:** https://staffroom-hybrid-8a71.web.app (Chrome on a desktop; press **Use the sample class**, then **Run the guard**).

## The problem

A teacher's notebook is full of things that help a child and must not travel: who has epilepsy, whose father lost his job, whose parents are separating. Those are also the notes a teacher most wants help with. Today the choice is to paste them into a chatbot, or to get no help.

## What Staffroom does

1. **Write.** The teacher writes the note as they would in their own notebook, names and all.
2. **Guard, on the device.** Gemini Nano in Chrome reads the raw note and lists names, places and private details (health, family, money, identity). A class-list name is withheld in full and by each of its words of two letters or more; a single initial is never withheld on its own. Three things need no model and run in every mode: a class list, pattern rules (mobile and landline numbers, emails, identity and roll numbers), and a short list of sensitive words (such as epilepsy, separating, lost his job, police, debt) that withholds the whole sentence around each one. With no model at all, a capitalised-word rule also runs: a word that begins with a capital letter and is not an ordinary sentence opener, a day or a month is held back as a possible name, which the teacher can release. That rule cannot tell a name from any other capitalised word, and it misses a name written without a capital. If the model's answer for a part of the note cannot be read, the app names that part and asks the teacher to check it; if it read nothing, the run is treated as rules only, and the page and the receipt still say how many parts the model was asked to read and could not. A note is limited to 8,000 characters.
3. **Approve.** The teacher sees the exact text that would be sent, with every withheld item replaced by a stand-in such as `[Student 1]` or `[withheld]`. The card shows each stand-in literally, the task instruction, and the fixed instructions sent with every draft, so everything the cloud model is shown appears there, word for word. They can release an item or select more text to withhold; a selection that cuts a word is widened to the whole word, and a name or number inside a released private detail stays withheld. Approval waits up to four seconds for the school's policy. If it does not load in that time, the app uses the last school policy this browser fetched and says from when; if there is none, it uses its built-in defaults, says that the school's policy could not be loaded, and asks for a confirmation before any item is released. The policy in force and the drafting model are shown under the text. A deterministic exit gate re-checks the outgoing text for every withheld item and for the phone, email and ID patterns; it catches redaction mistakes, it cannot find a private detail nobody marked. It also stops a withheld item that is nowhere to be found in the note. If it finds anything, the send button is disabled. What the guard did not cover (unread parts, items it could not match, a rules-only run) is said beside the gate, above the text. Nothing is sent until the teacher ticks "I have read this text" and presses Approve; when nothing at all is withheld, a second tick is needed: "Nothing has been withheld. I am sending my note as written." The tick belongs to that exact text: if the text or the policy changes, it is cleared, and at the moment of sending the app works the text out again and sends it only if it is the text that was read.
4. **Draft, in the cloud.** A Gemini cloud model writes a support plan, notes to parents or a hand-over from the redacted text.
5. **Check, on the device.** A return gate checks that the reply uses only the stand-ins the app wrote into the approved text and contains no withheld item or look-alike of a stand-in; a stand-in that was not in the approved text is never turned back into a name, and one written without its brackets ("Student 1") is read as the stand-in only if that stand-in was sent. The gate also flags a word from the sensitive list that the approved text did not have. It blocks sign-off until the teacher has read a flagged reply. Then the on-device model checks each item against the private details the cloud was never told, and marks it *no conflict found*, *think before using* or *conflicts*. An answer the app cannot read, or a "no conflict" with no reason given, counts as *think before using*. An item that names no student, or speaks of children in general, is checked against every withheld private detail, and *nothing to check* is said only when no private detail was withheld. If every request of the check fails, the page and the receipt say the check could not run; if some fail, they say it ran only in part. An item found in conflict starts struck, so the teacher has to choose to keep it. An item the check was unsure about, or did not check, starts undecided: the teacher has to choose to keep it or strike it before signing off. Real names are put back locally. For notes to parents, each message is copied on its own and shows whose family it is for; copying is off for a message that names no student or more than one, or that carries a contact detail or identity number the note does not tie to that student.
6. **Sign off.** The teacher keeps or strikes each item and signs. A receipt holds the exact text the teacher approved, counts of what was withheld, which model ran where, and how many items were kept and how many struck. It does not hold the draft, the raw note or anything that was withheld.

The raw note and the class list are kept for the browser tab only (session storage) and **Forget this note** clears them at once. Receipts are kept in the browser. Spell check is switched off on the note and the class list, so a browser's online spell check is not sent what is typed.

## How hybrid inference is used

The inference mode of each call is chosen by how sensitive its input is. The table is in [`src/ai/routes.ts`](src/ai/routes.ts).

| Job | Input | Mode | Why |
| --- | --- | --- | --- |
| Find names and private details | raw note | `ONLY_ON_DEVICE` | This call carries the raw note, so a cloud fallback would be a leak. With no on-device model the app drops to the rules and the teacher's own review, and says so on the approval tick. |
| Write the draft | redacted, approved text | `PREFER_IN_CLOUD` | The larger model writes better. If the cloud call fails in a way the SDK treats as unreachable (network error or an error response) and the on-device model is ready, the draft is written on the device. The page then says that the cloud draft failed, and gives what the browser reported about the network as a separate fact: the app does not know why the call failed. |
| Check the draft against the private details | draft + withheld details | `ONLY_ON_DEVICE` | Only the device knows what was withheld. |
| Name the receipt | redacted text | `PREFER_ON_DEVICE` | A small job: free, and needing no network, on the device when possible; the cloud model otherwise. |

Every response's `inferenceSource` is read, shown in the interface and stored on the receipt, for all four calls. For the two `ONLY_ON_DEVICE` calls the mode alone is not relied on: the app refuses to start a guard or check request unless the on-device model is present, and stops if a response did not come from the device. Those two routes are given no cloud parameters. A test removes the on-device model and asserts that no network request is made.

Three checks are plain code, not a model: the exit gate ([`src/core/gate.ts`](src/core/gate.ts)), the teacher's approval, and the return gate. The exit gate re-checks the outgoing text for every withheld item and for the phone, email and ID patterns; it catches redaction mistakes, it cannot find a private detail nobody marked. The return gate blocks sign-off until the teacher has read a flagged reply.

## Firebase products

- **Firebase AI Logic** (`firebase/ai`): all four model calls, hybrid on-device and cloud. See `src/ai/`.
- **App Check**: required by AI Logic. reCAPTCHA Enterprise on the hosted site, debug token on localhost.
- **Remote Config**: a setting the school publishes; enforced in the app. It names the drafting model and the kinds of item the app keeps withheld. It is the school's default on the teacher's device, not a security control.
- **Authentication** (anonymous) and **Firestore**: the teacher's own record of each receipt, optional and off by default. It is a record written by this browser: the teacher's own note of a run, not evidence of it to anyone else, since whoever is signed in to the account can write one. The copy in Firestore holds the record only, no text: counts of what was withheld, the length and a SHA-256 digest of the approved text, where each step ran and with which model, verdict counts, how many items were kept and struck, and flags. The digest is a value for matching a record to the local receipt. The rules accept exactly those fields, an id in the form the app generates, and a model name that is a Gemini model, the on-device model or "other"; they let only the owner create and read a record, and let nobody edit or delete one.

## Run it

Requirements: Node 22+, pnpm, Chrome 139+ on desktop for the on-device model (Chrome downloads Gemini Nano on first use; it needs about 22 GB of free disk).

```bash
pnpm install
cp .env.example .env.local   # fill in your Firebase web app config
pnpm dev                     # http://127.0.0.1:5173
```

Firebase setup, once:

1. Create a Firebase project and a web app. In **AI Logic**, press Get started and choose the Gemini Developer API (no billing needed).
2. Enable **Authentication > Anonymous** and create a **Firestore** database.
3. App Check: with `VITE_APPCHECK_DEBUG_TOKEN=true`, open the app, copy the debug token from the browser console and register it under **App Check > Apps > Manage debug tokens**.
4. `firebase deploy --only firestore:rules,remoteconfig` to publish the rules and the policy template.

Without a Firebase project the guard and the gates still work. The draft step first attempts the cloud with the approved text and is refused, then the on-device model writes the draft if it is ready.

To try it: press **Use the sample class**, then **Run the guard**.

## Deploy

```bash
# .env.production.local must leave VITE_APPCHECK_DEBUG_TOKEN empty and set
# VITE_RECAPTCHA_ENTERPRISE_SITE_KEY to a key registered under App Check.
pnpm build
firebase deploy --only hosting,firestore:rules,remoteconfig --project <your-project-id>
```

A debug token must never be built into a hosted site: it would let anyone pass App Check.

## Tests

```bash
pnpm test        # rules, vault, redaction, both gates, receipts, on-device routes
pnpm typecheck
```

## Measuring the on-device check

[`eval.html`](eval.html) is a developer page that measures the check on the real on-device model. With `pnpm dev` running, open http://127.0.0.1:5173/eval.html in Chrome on a desktop. It puts 24 fixed, invented cases ([`src/eval/cases.ts`](src/eval/cases.ts)) through the same code the app uses, on the same `ONLY_ON_DEVICE` route: 12 where the advice conflicts with a withheld fact (time, place, health, money, family, travel) and 12 where the same fact is there and the advice is fine. Each case runs once; add `?runs=3` to run each three times. The page shows a table and the same results as JSON in `<pre id="eval-json">`: for each case what was expected, what the check said, its reason and the time taken, and totals for conflicts caught, compatible cases wrongly flagged as a conflict, unsure answers and failures.

## Limits, stated plainly

- The on-device model is Gemini Nano in Chrome on desktop, and English only. In any other browser the app says so and runs the rules-only guard: the class list, the patterns, the short list of sensitive words and the capitalised-word rule. Those are no substitute for a model or for reading the text.
- The demo uses invented data only. Before use with real pupils a school would need its own data agreement and the paid Gemini backend, because the free Gemini Developer API tier is not meant for personal data.
- "Offline" means the guard, the check and the fallback draft keep working once the page and the on-device model have loaded. The page itself is not installed for an offline start.
- Sign-off is by the person using the browser. Anonymous sign-in gives the browser an account; it does not prove who that person is.
- A small model can miss a private detail, and the exit gate cannot find a private detail nobody marked. That is why the teacher reads the outgoing text and why the class list and rules do not depend on the model.
- The on-device check is a small model too. In nine runs of the sample note on 26 November 2026 (Chrome 158) it flagged a conflict with the after-school club in four. A conflict it flags is worth reading; "no conflict found" is not a guarantee.
- The on-device check is advice to the teacher, not a verdict. The teacher signs off.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
