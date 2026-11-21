# Sprite sheet specification

All sheets: **PNG, transparent background**, frames in a grid **4 columns**, row-major, reading order = playback order. **Cell = 512x512 px** for EVERY sheet (same scale). Hamster centered horizontally, feet on **y = 488** in every cell, nothing cropped. Travelling sheets face **RIGHT**. First/last frame of looping sheets must match (seamless).

File name = animation id: `public/hamster/sheets/<id>.png`. Prop: `public/hamster/props/hideout.png` (512x512, transparent doorway).

| id | frames | sheet px (WxH) | fps | loop | pose from→to | what to draw | key poses already extracted |
|---|---|---|---|---|---|---|---|
| sit | 6 | 2048x1024 | 4 | yes | sit→sit | Sitting upright like the reference. Slow breathing, a blink, tiny ear/paw shifts. | 01_happySit |
| sniff | 6 | 2048x1024 | 8 | yes | quad→quad | On all fours, standing still. Nose twitching, head bobbing up/down slightly, whiskers moving. | — |
| walking | 8 | 2048x1024 | 10 | yes | quad→quad | Side view, facing RIGHT. 8-frame walk cycle (DELIVERED). | — |
| walkPause | 1 | 512x512 | 1 | yes | quad→quad | Standing still on all fours. Currently re-uses walking frame 1 (no extra art needed). | — |
| run | 6 | 2048x1024 | 14 | yes | quad→quad | Side view facing RIGHT. Fast gallop: stretched/compressed body, all four legs coordinated. | 02_runA, 03_runB |
| lookAround | 8 | 2048x1024 | 6 | yes | sit→sit | Sitting. Head turns left, back to center, right, back to center. Ears follow. | 08_curiousSit, 18_alertSit |
| lookCursor | 3 | 1536x512 | 0 | no | sit→sit | Sitting. 3 STILL frames in order: [0] head turned to viewer-LEFT, [1] looking straight at viewer, [2] head turned to viewer-RIGHT. | 08_curiousSit / 18_alertSit (turned head; need exact L/C/R) |
| standUp | 12 | 2048x1536 | 8 | no | sit→sit | Rises onto hind legs, looks around while standing (paws up), then lowers back to sitting. | 07_standHappy, 06_armsOpen |
| dig | 6 | 2048x1024 | 10 | yes | quad→quad | Side view facing right. Front paws alternately scratch the ground, small body rock. | — |
| climb | 8 | 2048x1024 | 8 | yes | quad→quad | Side view facing right. Climbs a small wooden ladder / twig DRAWN IN THE FRAME (hamster goes up and returns so first=last frame). | — |
| eat | 8 | 2048x1024 | 8 | yes | sit→sit | Sitting, holds a small strawberry/snack in BOTH front paws, raises to mouth, chews, cheeks puff slightly. | 04_eatStrawberry |
| eatSeeds | 8 | 2048x1024 | 8 | yes | sit→sit | Sitting, nibbling a sunflower seed held in paws, shell bits, fast small chewing. | 12_eatSeed |
| drink | 6 | 2048x1024 | 6 | yes | quad→quad | Side view facing right. Leans forward to a small water-bottle spout / bowl DRAWN IN THE FRAME, licks, returns. | — |
| storeFood | 8 | 2048x1024 | 8 | yes | sit→sit | Sitting. Takes a seed, pushes it into cheek (cheek visibly bulges), second seed, cheeks fuller. | 13_cheekHold |
| washFace | 8 | 2048x1024 | 8 | yes | sit→sit | Sitting. Both front paws lick, then rub over face/ears in circles, return to rest. | 09_washFace |
| groom | 8 | 2048x1024 | 8 | yes | sit→sit | Sitting. Paws and head clean belly/side fur, licks paw, brushes fur. | — |
| stretch | 10 | 2048x1536 | 8 | no | sit→sit | Sitting -> front legs forward, rump up (play-bow stretch) -> back stretch -> yawn -> back to sitting. | 11_stretch |
| curlUp | 8 | 2048x1024 | 8 | no | sit→curl | Sitting -> yawns -> lowers -> curls into a ball, tucks nose, eyes close. LAST frame = frame 0 of sleepLoop. | 10_sleep (end), 01_happySit (start) |
| sleepLoop | 6 | 2048x1024 | 3 | yes | curl→curl | Curled up asleep, eyes closed. Slow breathing; one ear twitch within the loop. | 10_sleep |
| wakeUp | 12 | 2048x1536 | 8 | no | curl→sit | Curled -> slowly opens eyes -> uncurls -> big stretch + yawn -> sits up. LAST frame = frame 0 of sit. | 10_sleep (start), 11_stretch, 01_happySit (end) |
| jump | 8 | 2048x1024 | 12 | no | quad→quad | Side view facing right. Crouch, spring up with legs tucked, peak, land, settle. Travels slightly forward. | 07_standHappy (apex candidate) |
| roll | 8 | 2048x1024 | 10 | yes | quad→quad | Side view. Rolls forward in a somersault/ball roll, returns upright on all fours. First=last frame. | 16_rollBack |
| play | 8 | 2048x1024 | 8 | yes | sit→sit | Sitting with a tiny ball: pats it with paws, rolls it, catches it. Ball DRAWN IN THE FRAME. | 19_holdHeart (placeholder pose only) |
| celebrate | 8 | 2048x1024 | 10 | no | sit→sit | Sitting, excited: raises both paws, happy open-mouth smile (like the reference), wiggles, little hops in place, back to sitting. | 06_armsOpen, 20_celebrateSparkle, 01_happySit |
| enterHideout | 6 | 2048x1024 | 10 | no | quad→hidden | Side view facing right, at the hideout door: scurries in. Last frame: hamster fully inside/behind hideout (may be empty frame). | 15_inHideout |
| exitHideout | 8 | 2048x1024 | 6 | no | hidden→quad | Starts empty/hidden, nose appears at door, head peeks, looks left/right, steps out onto all fours. | 14_peek, 15_inHideout |
| sitDown | 6 | 2048x1024 | 10 | no | quad→sit | From all fours -> rises onto haunches -> settled sitting pose (reference pose). | — |
| dropToFour | 6 | 2048x1024 | 10 | no | sit→quad | From sitting -> leans forward -> front paws down -> on all fours, facing right. | — |

