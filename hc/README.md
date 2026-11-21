# Hamster Companion engine
```
src/animations.config.js   27 sheets + 24 behaviors + activity cycle (edit to add content)
src/sprites.manifest.js    sheet URLs / cell size / ground line (real art)
src/placeholders.js        labelled placeholder sheets (engine test mode, NOT hamsters)
src/behaviorController.js  pure logic: modes, pose graph + auto bridges, no-repeat picks, reactions
src/HamsterEngine.js       canvas sprite player, movement synced to stride, interactions, cleanup
src/HamsterCompanion.jsx   React wrapper   |  src/index.js  vanilla mountHamster()
test/controller.test.mjs   node --test test/        test/browser.py  headless Chromium run
```
React:  `<HamsterCompanion placeholders />`  ->  later `<HamsterCompanion placeholders={false} />`
Vanilla: `mountHamster({ placeholders: false })`
Adding a sheet = drop `<id>.png` in /public/hamster/sheets/. Missing sheets disable only the behaviors that need them.
If a sheet has fewer frames than the spec, set `frames` for it in the manifest.

## Status
- `walking` (8 frames, DELIVERED) - /public/hamster/sheets/walking.png (2048x1024, 4 cols x 2 rows, 512 cells, feet on y=488)
- `walkPause` = walking frame 1 held (derived, no extra file)
- Enabled sheets are listed in `ENABLED` in src/sprites.manifest.js - add an id when its PNG exists.
- Tuning: `fps` and `travel` of `walking` in animations.config.js (travel = character-widths per cycle; raise/lower if feet slide).
