# Staffroom

**A teacher's raw note about a child stays on the teacher's device. What the teacher approves is the only note text sent.** A small on-device model guards the door; a large cloud model does the writing and only ever sees what the teacher approved.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) with Firebase AI Logic hybrid inference. Platform: Web (Chrome on desktop).
**Try it:** https://staffroom-hybrid-8a71.web.app (Chrome on a desktop; press **Use the sample class**, then **Run the guard**).

## The problem

A teacher's notebook is full of things that help a child and must not travel: who has epilepsy, whose father lost his job, whose parents are separating. Those are also the notes a teacher most wants help with. Today the choice is to paste them into a chatbot, or to get no help.

## What Staffroom does

1. **Write.** The teacher writes the note as they would in their own notebook, names and all.
2. **Guard, on the device.** Gemini Nano in Chrome reads the raw note and lists names, places and private details (health, family, money, identity). A class-list name is withheld with every one of its words, short ones included. Three things need no model and run in every mode: a class list, pattern rules (phone numbers, emails, identity and roll numbers), and a short list of sensitive words (such as epilepsy, separating, lost his job) that withholds the whole sentence around each one. With no model at all, a capitalised word in mid-sentence is also held back as a possible name, which the teacher can release. If the model's answer for a part of the note cannot be read, the app names that part and asks the teacher to check it; if it read nothing, the run is treated as rules only.
3. **Approve.** The teacher sees the exact text that would be sent, with every withheld item replaced by a stand-in such as `[Student 1]` or `[withheld]`. The card shows each stand-in literally, the task instruction, and the fixed instructions sent with every draft, so everything the cloud model is shown appears there, word for word. They can release an item or select more text to withhold; a selection that cuts a word is widened to the whole word, and a name or number inside a released private detail stays withheld. Approval waits until the school's policy has loaded, and the policy and drafting model are shown under the text. A deterministic exit gate re-checks the outgoing text for every withheld item and for the phone, email and ID patterns; it catches redaction mistakes, it cannot find a private detail nobody marked. It also stops a withheld item that is nowhere to be found in the note. If it finds anything, the send button is disabled. Nothing is sent until the teacher ticks "I have read this text" and presses Approve. The tick belongs to that exact text: if the text or the policy changes, it is cleared, and at the moment of sending the app works the text out again and sends it only if it is the text that was read.
4. **Draft, in the cloud.** A Gemini cloud model writes a support plan, notes to parents or a hand-over from the redacted text.
5. **Check, on the device.** A return gate checks that the reply uses only the stand-ins the app wrote into the approved text and contains no withheld item or look-alike of a stand-in; a stand-in that was not in the approved text is never turned back into a name; it blocks sign-off until the teacher has read a flagged reply. Then the on-device model checks each item against the private details the cloud was never told, and marks it *fits*, *think before using* or *conflicts*. An answer the app cannot read counts as *think before using*, never as *fits*. An item that names no student is checked against every withheld private detail, and *nothing to check* is said only when no private detail was withheld. An item found in conflict starts struck, so the teacher has to choose to keep it. Real names are put back locally.
6. **Sign off.** The teacher keeps or strikes each item and signs. A receipt holds the exact text the teacher approved, counts of what was withheld, which model ran where, and what was signed off. It never holds the raw note or anything that was withheld.

The raw note and the class list are kept for the browser tab only (session storage) and **Forget this note** clears them at once. Receipts are kept in the browser. Spell check is switched off on the note and the class list, so a browser's online spell check is not sent what is typed.

## How hybrid inference is used

The inference mode of each call is chosen by how sensitive its input is. The table is in [`src/ai/routes.ts`](src/ai/routes.ts).

| Job | Input | Mode | Why |
| --- | --- | --- | --- |
| Find names and private details | raw note | `ONLY_ON_DEVICE` | The raw note must never reach a server, so a cloud fallback would be a leak. With no on-device model the app drops to the rules and the teacher's own review, and says so on the approval tick. |
| Write the draft | redacted, approved text | `PREFER_IN_CLOUD` | The larger model writes better. If the cloud call fails in a way the SDK treats as unreachable (network error or an error response) and the on-device model is ready, the draft is written on the device. |
| Check the draft against the private details | draft + withheld details | `ONLY_ON_DEVICE` | Only the device knows what was withheld. |
| Name the receipt | redacted text | `PREFER_ON_DEVICE` | A small job: free, and needing no network, on the device when possible; the cloud model otherwise. |

Every response's `inferenceSource` is read, shown in the interface and stored on the receipt, for all four calls. For the two `ONLY_ON_DEVICE` calls the mode alone is not relied on: the app refuses to start a guard or check request unless the on-device model is present, and stops if a response did not come from the device. Those two routes are given no cloud parameters. A test removes the on-device model and asserts that no network request is made.

Three checks are plain code, not a model: the exit gate ([`src/core/gate.ts`](src/core/gate.ts)), the teacher's approval, and the return gate. The exit gate re-checks the outgoing text for every withheld item and for the phone, email and ID patterns; it catches redaction mistakes, it cannot find a private detail nobody marked. The return gate blocks sign-off until the teacher has read a flagged reply.

## Firebase products

- **Firebase AI Logic** (`firebase/ai`): all four model calls, hybrid on-device and cloud. See `src/ai/`.
- **App Check**: required by AI Logic. reCAPTCHA Enterprise on the hosted site, debug token on localhost.
- **Remote Config**: a setting the school publishes; enforced in the app. It names the drafting model and the kinds of item the app keeps withheld. It is the school's default on the teacher's device, not a security control.
- **Authentication** (anonymous) and **Firestore**: the teacher's own record of each receipt, optional and off by default. The copy in Firestore holds the record only, no text: counts of what was withheld, the length and a SHA-256 digest of the approved text, where each step ran and with which model, verdict counts, what was kept and struck, and flags. The rules accept exactly those fields, let only the owner create and read a record, and let nobody edit or delete one.

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

## Limits, stated plainly

- The on-device model is Gemini Nano in Chrome on desktop, and English only. In any other browser the app says so and runs the rules-only guard: the class list, the patterns and the short list of sensitive words. That list is no substitute for a model or for reading the text.
- The demo uses invented data only. Before use with real pupils a school would need its own data agreement and the paid Gemini backend, because the free Gemini Developer API tier is not meant for personal data.
- "Offline" means the guard, the check and the fallback draft keep working once the page and the on-device model have loaded. The page itself is not installed for an offline start.
- Sign-off is by the person using the browser. Anonymous sign-in gives the browser an account; it does not prove who that person is.
- A small model can miss a private detail, and the exit gate cannot find a private detail nobody marked. That is why the teacher reads the outgoing text and why the class list and rules do not depend on the model.
- The on-device check is advice to the teacher, not a verdict. The teacher signs off.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
