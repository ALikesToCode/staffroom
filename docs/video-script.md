# Staffroom: video script (under 3:00)

All footage comes from the app as it is: the hosted site, a live run in Chrome 158 with Gemini Nano, and the recorded-run replay. Every class detail is invented. A time-lapse or a cut in waiting time is labelled on screen. The voice-over is English, synthetic (Nivedita, Maya 2), with burned-in English captions.

| # | On screen | Voice-over |
|---|---|---|
| 1 | "Stays here" \| "The cloud is told" for Meenal: "has to leave school at the last bell to reach home before dark" beside "Need A: cannot stay after the last bell". | Meenal has to leave at the last bell to walk home before dark. Her teacher knows that. The cloud is not told. It gets a letter and a need: Need A, cannot stay after the last bell. No name, no reason, no count. |
| 2 | The lesson comes back. The cloud lane shows "Need F \| …" with letters only; the device lane shows the same line with "Meenal Joshi" beside it, and "For each need: …". | The cloud writes tomorrow's lesson for the whole class, and an entry for every need, without knowing whose need it is. This laptop keeps who has which need, and puts each entry beside the right child. |
| 3 | Title card: Staffroom. "Your device knows the child. The cloud only knows the need." | This is Staffroom, for teachers in India's public schools, on the staffroom computer. A class of forty, a lesson every day, and a notebook full of things that must not travel. |
| 4 | Live run. The teacher's note with names. "Run the guard": stand-ins appear. The pill reads "On-device model: ready" and the guard chip reads ONLY_ON_DEVICE. | The teacher writes as they would in their own notebook. Gemini Nano, running in Chrome on this laptop, finds the names and private details and swaps them for stand-ins. That call has no cloud fallback. With no model, only the rules run. |
| 5 | The constraints card: "Confirm all", the need switches, the epilepsy row "Stays here. Nothing is told." | It also proposes constraints and needs. The teacher confirms them and chooses what the cloud may hear: the need, not the reason. A health condition is withheld by default. |
| 6 | "What leaves": the exact outgoing text (the class line, the needs by letter, the lesson lines) and "Not sent: 14 sentences about one pupil. Their needs go by letter." The tick, then "Approve and send". | For a lesson, no sentence about one pupil is sent. The teacher reads the exact text and ticks it before anything leaves. |
| 7 | "Beside each child": the placed lines for Aarav, Meenal, Kabir, Ishaan and Tanvi, and the seating line marked "By rule, on this device". "Accept all". | The cloud wrote an entry for every need. The device placed each one. It also adds what only it can know: the two boys who fight are fighting each other, so it seats them apart. Rules check each step against what the teacher confirmed. Nothing is added until the teacher accepts it. |
| 8 | "Make the materials": a "Sheet for Need …" written out in full, the child's name on the device side only. The print preview: page 1 with no names, then the teacher's copy. | Then the materials: board work, a practice sheet, a sheet written out for each need, and an exit ticket. The class copy has no names. The teacher's copy does, and stays here. |
| 9 | Lessons page: the exit-ticket grid (Got it / Partly / Not yet / Absent), "Plan the next lesson", the review with "Need J: has not yet got…". | After the lesson, the teacher marks who got it. That stays on the device. The next lesson plans for "pupils who have not got it yet" without the cloud learning who. |
| 10 | Inspect: the routes (ONLY_ON_DEVICE, PREFER_IN_CLOUD, PREFER_ON_DEVICE) and where each step ran; "Network, as the browser records it" for the guard and the draft. Then the measured-numbers card. | Every call goes through Firebase AI Logic. The mode follows the data: raw notes only on the device, approved text in the cloud. Inspect shows the browser's own record: during the on-device guard, no request went to the model. On twelve fresh notes, the rules alone missed nine private details in sixty. With Gemini Nano, one. |
| 11 | A browser without the model: the first screen with "Watch a recorded run with Gemini Nano", the replay. End card: live URL, repo, "Voice-over: synthetic voice (Maya 2, Kyutai Mimi codec)". | No on-device model? The rules and the cloud still work, and a recorded real run shows the rest. Staffroom. The cloud plans for the class. Your device knows the child. |

The seating line in shot 7 follows the run: "Seat Kabir and Ishaan apart." when practice is independent work, "Put Kabir and Ishaan in different groups." on a group stage; paragraph 7 then says "seats them apart" or "puts them in different groups" to match.

Numbers card (shot 10), word for word:
- Measured on invented data, 26 and 27 Nov 2026, Chrome 158 with Gemini Nano
- Guard, 12 fresh notes, 60 private details, per run of 3: missed by the rules alone 9, with Gemini Nano 1
- Check, 8 unseen conflict cases, 3 runs: 24 of 24 caught; 4 of 24 harmless runs flagged
- Raw results: github.com/ALikesToCode/staffroom, docs/evals

## Voice-over text, in one piece

Meenal has to leave at the last bell to walk home before dark. Her teacher knows that. The cloud is not told. It gets a letter and a need: Need A, cannot stay after the last bell. No name, no reason, no count.

The cloud writes tomorrow's lesson for the whole class, and an entry for every need, without knowing whose need it is. This laptop keeps who has which need, and puts each entry beside the right child.

This is Staffroom, for teachers in India's public schools, on the staffroom computer. A class of forty, a lesson every day, and a notebook full of things that must not travel.

The teacher writes as they would in their own notebook. Gemini Nano, running in Chrome on this laptop, finds the names and private details and swaps them for stand-ins. That call has no cloud fallback. With no model, only the rules run.

It also proposes constraints and needs. The teacher confirms them and chooses what the cloud may hear: the need, not the reason. A health condition is withheld by default.

For a lesson, no sentence about one pupil is sent. The teacher reads the exact text and ticks it before anything leaves.

The cloud wrote an entry for every need. The device placed each one. It also adds what only it can know: the two boys who fight are fighting each other, so it seats them apart. Rules check each step against what the teacher confirmed. Nothing is added until the teacher accepts it.

Then the materials: board work, a practice sheet, a sheet written out for each need, and an exit ticket. The class copy has no names. The teacher's copy does, and stays here.

After the lesson, the teacher marks who got it. That stays on the device. The next lesson plans for "pupils who have not got it yet" without the cloud learning who.

Every call goes through Firebase AI Logic. The mode follows the data: raw notes only on the device, approved text in the cloud. Inspect shows the browser's own record: during the on-device guard, no request went to the model. On twelve fresh notes, the rules alone missed nine private details in sixty. With Gemini Nano, one.

No on-device model? The rules and the cloud still work, and a recorded real run shows the rest. Staffroom. The cloud plans for the class. Your device knows the child.
