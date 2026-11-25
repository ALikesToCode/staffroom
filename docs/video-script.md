# Staffroom: demo video script (draft for review)

Target length 2:45, limit 3:00. English. Screen recording of the app in Chrome on a desktop with the built-in model, with a voice-over. Every line below is something shown on screen.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 | Title card, then the empty desk with two lanes: "On this device" and "The cloud" | "A teacher's most useful notes about a class are the ones that should never be pasted into a chatbot. Staffroom lets a cloud model do the writing, with a model on the teacher's own device standing guard at the door." |
| 0:15 | Click "Use the sample class". The invented note for Class 6B appears. Point at a phone number and a health detail | "This is an invented note about five students. It has names, a phone number, a roll number, a health condition and family trouble." |
| 0:30 | Click "Run the guard". Progress shows the on-device model reading paragraph by paragraph. Chip shows `ONLY_ON_DEVICE` | "The guard runs through Firebase AI Logic in only-on-device mode. The raw note cannot go to a server on this route." |
| 0:50 | The vault fills. The cloud lane shows the outgoing text with `[Student 1]` and `[withheld]` | "Each name becomes a stand-in and each private detail is withheld. On the right is the exact text that would leave, word for word." |
| 1:05 | Toggle one item; show a locked contact detail that cannot be toggled; footer shows "school policy (Remote Config)" | "I can withhold more or release an item, unless school policy locks it. That policy comes from Remote Config." |
| 1:20 | Tick "I have read this text", click "Approve and send". Chip shows `PREFER_IN_CLOUD`, "in the cloud" | "A separate exit gate searches the text again. Nothing is sent until I say I have read it. Now Gemini drafts the support plan in the cloud, protected by App Check." |
| 1:40 | Result appears with real names restored and a verdict under each item. Open one "Think before using" | "The reply comes back with stand-ins. My device puts the names back, and the on-device model checks each piece of advice against the details the cloud never saw." |
| 2:00 | Strike one item, click "Sign off" | "I keep or strike each item and sign off." |
| 2:10 | Receipts view: kinds withheld, approved text, which model ran where | "The receipt records what was withheld, what I approved and which model ran where, without a single name. A copy can go to Firestore under rules that allow no edits." |
| 2:25 | Switch the network off in DevTools, run again. Draft panel says "The cloud could not be reached, so the on-device model wrote this draft" | "With no network, the draft falls back to the device. The guard and the check never needed the network at all." |
| 2:40 | "How it works" view with the four routes | "Four routes, chosen by how sensitive the data is. The cloud does the heavy work, under a guard and a person. That is Staffroom." |

## Recording plan

1. Record on a Chrome desktop where the built-in model is ready (the status chip says "On-device model: ready"), at 1920×1080.
2. Do one silent practice run first so the model is warm; the first guard run takes longest.
3. Record the screen in one take per row, then cut waiting time. Show a small "sped up" label wherever a wait is shortened.
4. Voice-over recorded separately and laid over the cut.
5. Upload to YouTube as public only after the final read and a yes.
