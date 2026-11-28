# Staffroom: Video Script (`v11` — `staffroom-demo-v11.mp4`)

- **Total duration**: `169.74s` (`2m 49.74s`, strictly under `2:55` and Devpost's `3:00` limit), `1920x1080` `30fps` H.264/AAC (NVENC), zoomed 2x DPI Chrome 158 captures + live streaming frames, strict device/cloud corner badge synchronization (zero pupil names ever shown under the cloud badge), pre-click states before scan and guard, on-device check verification, `WRITTEN ON THIS COMPUTER` offline lane header, and all 6 routes in `How it ran (Inspect)`, Maya 2 (`Nivedita`) narration with `0.50s` inter-shot pauses, burned-in captions + [`staffroom-demo-v11.srt`](file:///home/mysterious/Videos/staffroom-demo-v11.srt).

## Shot list & voiceover (`p01`–`p09`)

1. **`0:00.00 – 0:21.68` (`p01`) — The problem**
   > A teacher's notebook says things like this. Tanvi misses every Tuesday for the clinic with her grandmother. Her family has no phone at home. A lesson plan that knew this would be a better plan. But a note like that should not go to a cloud model, and stripping forty children's details out by hand every night does not last.

2. **`0:21.68 – 0:36.58` (`p02`) — What Staffroom is (the door)**
   > Staffroom is a lesson planner built on Firebase AI Logic hybrid inference. The model on the device reads the note. The model in the cloud writes the lesson. A door stands between them.

3. **`0:36.58 – 1:07.87` (`p03`) — Notebook scan & on-device guard (`ONLY_ON_DEVICE`)**
   > She types her notes, or photographs the page, and Gemini Nano reads the handwriting in the browser. Then the guard runs, still on the device. Fixed rules catch names, phone numbers and roll numbers. Gemini Nano catches what rules miss. Here it found the Tuesday clinic visit. On the left is what stays here. On the right is all the cloud is told. Need E, away on Tuesdays. No name, no reason.

4. **`1:07.87 – 1:18.77` (`p04`) — Teacher review & approval (`874` chars)**
   > Nothing has been sent yet. She reads the exact text that will leave. The app checks it for every name and number it knows. Then she approves.

5. **`1:18.77 – 1:44.22` (`p05`) — Cloud lesson (`PREFER_IN_CLOUD`) & restoring each child on device**
   > Gemini Flash-Lite in the cloud writes tomorrow's lesson for the whole class, and one adjustment for each lettered need. It never learns whose need it is. Back in the browser, the device puts each adjustment beside the right child. Need E lands beside Tanvi. Gemini Nano then checks each step against what the teacher confirmed, on the device.

6. **`1:44.22 – 2:02.40` (`p06`) — One-click sheets, separate print copies & exit ticket**
   > One click writes the board work, the class worksheet and Tanvi's catch-up sheet. The class copy prints with letters only. The teacher's copy, with names, is never sent anywhere. After the lesson she marks who did not get it, and that shapes the next plan.

7. **`2:02.40 – 2:12.74` (`p07`) — Offline fallback (`PREFER_IN_CLOUD, fell back`)**
   > School Wi-Fi drops. The same button still works. Gemini Nano writes the lesson on the device instead, and the page says so.

8. **`2:12.74 – 2:36.12` (`p08`) — Proof (`How it ran`, network log & single number card)**
   > Inspect shows where every step ran. Six model steps across three hybrid modes, and five of them made no request to any model server. On twelve invented notes, rules alone caught forty-six of sixty private details. With Gemini Nano, fifty-one, and false alarms fell from three in eight to none.

9. **`2:36.12 – 2:49.74` (`p09`) — Closing card**
   > Staffroom. Your device knows the child. The cloud only knows the need. Every pupil in this video is invented. The live app and the code are linked below.
