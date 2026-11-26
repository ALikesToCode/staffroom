# Staffroom: demo video shot list and voice-over

The screen recording is made: 2:57, silent, 1920×1080, on the hosted app with the real on-device model. Say each line while its shot is on screen: start at the time given and finish before the next. Every line states only what that shot shows. The lines come to about 290 words.

All data in the sample is invented.

| # | Starts | Shot | What is on screen | Say |
|---|---|---|---|---|
| 1 | 0:00 | Title card, then the empty desk | The card; then two lanes and the pill "On-device model: ready" | "A teacher's most useful notes are the ones that should never be pasted into a chatbot. This is Staffroom." |
| 2 | 0:10 | The sample note | "Use the sample class" is pressed; the note and class list fill in | "This invented note has names, a phone number, a roll number, a health condition and family trouble." |
| 3 | 0:21 | Receipts, then back | "Keep a copy of each receipt's record (no text) in my account (Firestore)." is ticked | "First I ask for a record of each run to be kept in my account. It holds no text." |
| 4 | 0:33 | Run the guard | The progress line; the `ONLY_ON_DEVICE` chip on the vault | "The guard is a model inside this browser, called through Firebase AI Logic in only-on-device mode." |
| 5 | 0:43 | Vault and outgoing text | The vault list; on the right the text with `[Student 1]` and `[withheld]`; "Fixed instructions sent with every draft" is opened | "The names it found become stand-ins and the private details it found are withheld. On the right is the note text the cloud model will be shown, word for word, with its instructions." |
| 6 | 0:59 | The teacher decides | One withheld item is released with its switch; the words "has missed four days this month" are selected in the note and withheld as a private detail | "I decide what goes. I release one detail the guard held back, and I select a phrase it left in and withhold it myself." |
| 7 | 1:14 | A locked item | A contact detail with a locked switch; the line "Policy: school policy (Remote Config). Drafting model: …" | "The phone number is locked. The school sets that through Remote Config, and the app enforces it." |
| 8 | 1:24 | Approve and draft | The tick, "Approve and send"; the result shows "Draft: … in the cloud" | "Nothing goes until I tick that I have read it. Gemini writes the plan in the cloud, behind App Check." |
| 9 | 1:35 | The result | Names restored; one item marked "Conflicts with what you know", struck to begin with; its line "Checked against, on this device only" | "The names are put back on my device. The on-device model checked each step against what the cloud never saw. This item sends a child to a club after the last bell, when she has to leave at the last bell, so it starts struck." |
| 10 | 1:53 | Sign off | "Sign off"; the line "The receipt's record (no text) was written to your account by this browser." | "I sign off the rest. The record is written to my account." |
| 11 | 2:01 | Receipts | "Records written by this browser to your account" with a matching value; the local receipt opened, with the same matching value | "The receipt here holds the text I approved. The record in Firestore holds counts, where each model ran and a matching value, and the two values match." |
| 12 | 2:18 | Offline | The pill "Network: offline"; the run again; the caution "The cloud draft failed, so the on-device model wrote this draft from the same approved text."; the draft | "Now the network is off. The guard still runs. The cloud draft fails, so the on-device model writes the draft from the same approved text, and the screen says so." |
| 13 | 2:41 | How it works, then the end card | The table of four routes; the card with the two addresses (2:54) | "Four routes, chosen by how sensitive the data is. The cloud does the heavy writing, under a guard and a person." |

## What was done to the recording

- Three waits are sped up and say so on screen: the guard reading the note (2 times), the cloud draft and the on-device check (2.5 times), and the offline run (5 times). The rest runs 1.12 times faster than it was recorded, to fit three minutes.
- The take shown is one where the on-device check caught the conflict. It does not catch it every time: see the limits in the README.
- In the struck item the cloud model repeated the marker `[withheld]` in its text. The fixed instructions now tell it not to; the take was recorded just before that change.

## Notes for the voice

- Any phone voice recorder is fine. A quiet room matters more than the microphone.
- One recording for the whole video is easiest: play the video with the sound off and speak along with it.
