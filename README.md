# Staffroom

**What a teacher writes about a child stays on the teacher's device.** A small on-device model guards the door; a large cloud model does the writing and only ever sees what the teacher approved.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) with Firebase AI Logic hybrid inference. Platform: Web (Chrome on desktop).

## The problem

A teacher's notebook is full of things that help a child and must not travel: who has epilepsy, whose father lost his job, whose parents are separating. Those are also the notes a teacher most wants help with. Today the choice is to paste them into a chatbot, or to get no help.

## What Staffroom does

1. **Write.** The teacher writes the note as they would in their own notebook, names and all.
2. **Guard, on the device.** Gemini Nano in Chrome reads the raw note and lists names, places and private details (health, family, money, identity). A class list and pattern rules (phone numbers, emails, identity and roll numbers) catch the rest without any model.
3. **Approve.** The teacher sees the exact text that would be sent, with every withheld item replaced by a stand-in such as `[Student 1]` or `[withheld]`. They can release an item or select more text to withhold. A deterministic exit gate re-checks the text; if anything withheld is still in it, the send button is disabled. Nothing is sent until the teacher ticks "I have read this" and presses Approve.
4. **Draft, in the cloud.** A Gemini cloud model writes a support plan, notes to parents or a hand-over from the redacted text.
5. **Check, on the device.** A return gate checks that the reply uses only known stand-ins. Then the on-device model checks each item against the private details the cloud was never told, and marks it *fits*, *think before using* or *conflicts*. Real names are put back locally.
6. **Sign off.** The teacher keeps or strikes each item and signs. A receipt records what was withheld (counts only), the exact text that was approved, which model ran where and the sign-off.

## How hybrid inference is used

The inference mode of each call is chosen by how sensitive its input is. The table is in [`src/ai/routes.ts`](src/ai/routes.ts).

| Job | Input | Mode | Why |
| --- | --- | --- | --- |
| Find names and private details | raw note | `ONLY_ON_DEVICE` | The raw note must never reach a server, so a cloud fallback would be a leak. With no on-device model the app drops to rules plus the teacher's own review. |
| Write the draft | redacted, approved text | `PREFER_IN_CLOUD` | The larger model writes better. With no signal, the on-device model writes it from the same text. |
| Check the draft against the private details | draft + withheld details | `ONLY_ON_DEVICE` | Only the device knows what was withheld. |
| Name the receipt | redacted text | `PREFER_ON_DEVICE` | A small job: free and offline on the device when possible, cloud otherwise. |

Every response's `inferenceSource` is read and shown in the interface and stored on the receipt. The two `ONLY_ON_DEVICE` calls also refuse to continue if the source is not the device.

Three checks are plain code, not a model: the exit gate ([`src/core/gate.ts`](src/core/gate.ts)), the teacher's approval, and the return gate. The gate shares no matching code with the redactor, so it is a second opinion.

## Firebase products

- **Firebase AI Logic** (`firebase/ai`): all four model calls, hybrid on-device and cloud. See `src/ai/`.
- **App Check**: required by AI Logic. reCAPTCHA Enterprise on the hosted site, debug token on localhost.
- **Remote Config**: school policy the teacher cannot change: the drafting model and the kinds of item that are locked as always withheld.
- **Authentication** (anonymous) and **Firestore**: an optional audit copy of each receipt, off by default, readable only by its owner and never editable.

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

Without a Firebase project the on-device half still works: the guard, the gates, and a draft written on the device.

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
pnpm test        # rules, vault, redaction, both gates, receipt
pnpm typecheck
```

## Limits, stated plainly

- The on-device model is Gemini Nano in Chrome on desktop, and English only. In any other browser the app says so and runs the rules-only guard.
- A small model can miss a private detail. That is why the teacher reads the outgoing text and why the class list and rules do not depend on it.
- The on-device check is advice to the teacher, not a verdict. The teacher signs off.
- All data in the sample is invented.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
