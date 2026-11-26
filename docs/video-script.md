# Staffroom: demo video shot list and voice-over

Record the shots in this order. Say each line while its shot is on screen. Every line states only what that shot shows. The lines come to about 270 words.

All data in the sample is invented.

| # | Shot | What must be on screen | Say |
|---|---|---|---|
| 1 | The empty desk | Two lanes; the pill reads "On-device model: ready" | "A teacher's most useful notes are the ones that should never be pasted into a chatbot. This is Staffroom." |
| 2 | The sample note | Press "Use the sample class"; the note and class list fill in | "This invented note has names, a phone number, a roll number, a health condition and family trouble." |
| 3 | Receipts, then back | Tick "Keep a copy of each receipt's record (no text) in my account (Firestore)."; return to Desk | "First I ask for a record of each receipt to be kept in my account. It holds no text." |
| 4 | Run the guard | Progress line; the `ONLY_ON_DEVICE` chip on the vault | "The guard is a model inside this browser, called through Firebase AI Logic in only-on-device mode." |
| 5 | Vault and outgoing text | The vault list; on the right the text with `[Student 1]` and `[withheld]`; open "Fixed instructions sent with every draft" | "Each name becomes a stand-in and each private detail is withheld. On the right is everything the cloud model will be shown, word for word, instructions included." |
| 6 | A locked item | A contact detail with a locked switch; the line "Policy: school policy (Remote Config). Drafting model: …" | "The phone number is locked. That is a setting the school publishes through Remote Config, and the app enforces it." |
| 7 | Approve and draft | Tick the box, press "Approve and send"; the result shows "Draft: … in the cloud" | "An exit gate re-checks the text for everything marked, and nothing goes until I tick that I have read it. Gemini writes the plan in the cloud, behind App Check." |
| 8 | The result | Names restored; one item marked "Conflicts with what you know", struck to begin with; its line "Checked against, on this device only" | "The names are put back on my device. The on-device model checked each item against what the cloud never saw. This one conflicts with a detail I withheld, so it starts struck." |
| 9 | Sign off | Press "Sign off"; the line "The receipt's record (no text) was saved to your account." | "I sign off the rest. The record is saved to my account." |
| 10 | Receipts | The local receipt opened; below, "Records kept in your account" with the same digest prefix | "The receipt here holds the text I approved. The record in Firestore holds counts, where each model ran and a digest, and the digests match." |
| 11 | Offline | The pill reads "Network: offline"; run again; the caution "The cloud could not be reached, so the on-device model wrote this draft"; the draft text | "Now the network is off. The guard still runs. The cloud cannot be reached, so the on-device model writes the draft from the same approved text, and the screen says so." |
| 12 | How it works | The table of four routes | "Four routes, chosen by how sensitive the data is. The cloud does the heavy writing, under a guard and a person." |

## Notes for recording

- Shot 8 needs a real conflict. The sample note is written to make one likely (extra writing practice for a child who must leave before dark), but the cloud model's plan varies. Run again if no item conflicts.
- Shot 11 needs the page and the on-device model already loaded before the network is switched off.
- Any phone voice recorder is fine for the voice. A quiet room matters more than the microphone.

## The recording, and when to speak

The screen recording is made: 2:54, silent, 1920×1080, on the hosted app with the real on-device model. Start each shot's line at its time and finish before the next.

| Shot | Starts |
|---|---|
| 1 | 0:00 |
| 2 | 0:07 |
| 3 | 0:20 |
| 4 | 0:33 |
| 5 | 0:47 |
| 6 | 1:01 |
| 7 | 1:14 |
| 8 | 1:28 |
| 9 | 1:49 |
| 10 | 1:59 |
| 11 | 2:19 (this part is sped up 2.3 times and says so on screen) |
| 12 | 2:46 |

The take shown is one where the on-device check caught the conflict. It does not catch it every time: see the limits in the README.
