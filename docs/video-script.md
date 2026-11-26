# Staffroom: video script (about 2:50)

All footage comes from the app as it is: the hosted site, a live run in Chrome 158 with Gemini Nano, and the recorded-run replay. Every class detail is invented. A time-lapse or a cut in waiting time is labelled on screen. The voice-over is English, with burned-in English captions.

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:12 | Two lanes side by side. Left, "Stays here": “has to leave school at the last bell to reach home before dark”, Meenal Joshi. Right, "The cloud is told": "Need A: cannot stay after the last bell". | Meenal has to leave at the last bell to walk home before dark. Her teacher knows that. The cloud never will. It is only told: one pupil in this class cannot stay after the bell. |
| 2 | 0:12–0:24 | The lesson comes back. The cloud lane shows "Need F \| Practise \| Such a pupil dictates…". The device lane shows the same line, with "Meenal Joshi" beside it. | The cloud writes tomorrow's lesson for the whole class, and a line for every need, without knowing whose need it is. Only this laptop knows. It puts each line beside the right child. |
| 3 | 0:24–0:36 | Title card: Staffroom. "Your device knows why. The cloud only knows what." | This is Staffroom, for teachers in India's public schools. A class of forty, a lesson every day, and a notebook full of things that must not travel. |
| 4 | 0:36–0:58 | Live run. The teacher writes the class note with names. "Run the guard": stand-ins appear. The pill reads "On-device model: ready" and the guard chip reads ONLY_ON_DEVICE. | The teacher writes as they would in their own notebook. Gemini Nano, running in Chrome on this laptop, finds the names and private details and swaps them for stand-ins. That call runs only on the device. If there is no model, the app refuses to send the note anywhere else. |
| 5 | 0:58–1:18 | The constraints card. Rows are confirmed one by one; the need switches turn on. The epilepsy row reads "Stays here. Nothing is told." | It also proposes constraints and needs. The teacher confirms each one and chooses what the cloud may hear: a need, never the reason. Some things, like a health condition, are told to nobody by default. |
| 6 | 1:18–1:30 | "What leaves": the exact outgoing text with [Student 1] and [withheld], and the needs list. The tick, then "Approve and send". | Nothing leaves until the teacher has read the exact text and ticked it. |
| 7 | 1:30–1:52 | Result, "Beside each child": sections for Aarav, Meenal, Kabir, Ishaan and Tanvi, each with placed lines. "Seat Kabir and Ishaan in different groups." is marked "By rule, on this device". | The cloud wrote for every need. The device placed each line. It also adds what only it can know: the two boys who fight are fighting each other, so it seats them in different groups. Rules check every step against what the teacher confirmed. Nothing lands until the teacher accepts it. |
| 8 | 1:52–2:08 | "Make the materials": the board work, the practice sheet, "Sheet for Need G" with Ishaan's name on the device lane only. Then the print preview: page 1 with no names, page 2 the teacher's copy. | Then the materials: board work, a practice sheet, a version for each need, and an exit ticket. The class copy has no names. The teacher's copy does, and stays here. |
| 9 | 2:08–2:26 | Lessons page. The exit-ticket grid: Got it / Partly / Not yet / Absent. "Plan the next lesson". The review shows "Need J: has not yet got…". | After the lesson, the teacher marks who got it. That stays on the device. The next lesson plans for "pupils who have not got it yet" without the cloud ever learning who. |
| 10 | 2:26–2:40 | Inspect: the routes with ONLY_ON_DEVICE, PREFER_IN_CLOUD and PREFER_ON_DEVICE, and where each step ran. Then the measured numbers card. | Every call goes through Firebase AI Logic. The mode follows the data: raw notes only on the device, approved text in the cloud. We measured the on-device check on cases it had never seen: it caught twenty-four of twenty-four conflicts, and wrongly flagged four harmless items of twenty-four. |
| 11 | 2:40–2:50 | A different browser: a grey pill, then "Watch a recorded run". End card: live URL and repo. | No on-device model? The rules and the cloud still work, and a recorded real run shows the rest. Staffroom. The cloud plans for the class. Your device knows the child. |

## Voice-over text, in one piece

Meenal has to leave at the last bell to walk home before dark. Her teacher knows that. The cloud never will. It is only told: one pupil in this class cannot stay after the bell.

The cloud writes tomorrow's lesson for the whole class, and a line for every need, without knowing whose need it is. Only this laptop knows. It puts each line beside the right child.

This is Staffroom, for teachers in India's public schools. A class of forty, a lesson every day, and a notebook full of things that must not travel.

The teacher writes as they would in their own notebook. Gemini Nano, running in Chrome on this laptop, finds the names and private details and swaps them for stand-ins. That call runs only on the device. If there is no model, the app refuses to send the note anywhere else.

It also proposes constraints and needs. The teacher confirms each one and chooses what the cloud may hear: a need, never the reason. Some things, like a health condition, are told to nobody by default.

Nothing leaves until the teacher has read the exact text and ticked it.

The cloud wrote for every need. The device placed each line. It also adds what only it can know: the two boys who fight are fighting each other, so it seats them in different groups. Rules check every step against what the teacher confirmed. Nothing lands until the teacher accepts it.

Then the materials: board work, a practice sheet, a version for each need, and an exit ticket. The class copy has no names. The teacher's copy does, and stays here.

After the lesson, the teacher marks who got it. That stays on the device. The next lesson plans for "pupils who have not got it yet" without the cloud ever learning who.

Every call goes through Firebase AI Logic. The mode follows the data: raw notes only on the device, approved text in the cloud. We measured the on-device check on cases it had never seen: it caught twenty-four of twenty-four conflicts, and wrongly flagged four harmless items of twenty-four.

No on-device model? The rules and the cloud still work, and a recorded real run shows the rest. Staffroom. The cloud plans for the class. Your device knows the child.
