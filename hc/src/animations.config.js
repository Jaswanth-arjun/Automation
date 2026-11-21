/**
 * ANIMATION + BEHAVIOR CONFIGURATION  (the only file you edit to add content)
 *
 * Layer 1 - ANIMATIONS: one entry per sprite sheet (a real frame sequence).
 * Layer 2 - BEHAVIORS : the 24 hamster behaviors, each a script of animations.
 * Layer 3 - CYCLE     : activity cycle (active -> resting -> sleeping -> waking).
 *
 * Poses guarantee visual continuity: an animation starts in pose `from` and
 * ends in pose `to`. The controller only chains animations whose poses match
 * and automatically inserts "bridge" animations (those with from !== to).
 */
export const POSES = { SIT: 'sit', QUAD: 'quad', CURL: 'curl', HIDDEN: 'hidden' };

/**
 * frames  : number of frames in the sheet
 * fps     : playback speed
 * loop    : true = seamless loop (first frame == last frame pose)
 * from/to : start / end pose
 * travel  : distance (in character widths) covered per loop while moving. Must
 *           match the stride drawn in the art so feet do not slide.
 * columns : sheet grid columns (rows are derived). Default 4.
 * desc    : what the artist should draw (also used by the spec generator)
 */
export const ANIMATIONS = {
  // ---- core pose loops
  sit:        { frames: 6,  fps: 4,  loop: true,  from: 'sit',  to: 'sit',  desc: 'Sitting upright like the reference. Slow breathing, a blink, tiny ear/paw shifts.' },
  sniff:      { frames: 6,  fps: 8,  loop: true,  from: 'quad', to: 'quad', desc: 'On all fours, standing still. Nose twitching, head bobbing up/down slightly, whiskers moving.' },
  walking:    { frames: 8,  fps: 10, loop: true,  from: 'quad', to: 'quad', travel: 0.5, sheet: 'REAL', desc: 'Side view, facing RIGHT. 8-frame walk cycle (DELIVERED).' },
  walkPause:  { frames: 1,  fps: 1,  loop: true,  from: 'quad', to: 'quad', sheet: 'FRAME-OF walking', desc: 'Standing still on all fours. Currently re-uses walking frame 1 (no extra art needed).' },
  run:        { frames: 6,  fps: 14, loop: true,  from: 'quad', to: 'quad', travel: 1.1, desc: 'Side view facing RIGHT. Fast gallop: stretched/compressed body, all four legs coordinated.' },
  // ---- looking / exploring
  lookAround: { frames: 8,  fps: 6,  loop: true,  from: 'sit',  to: 'sit',  desc: 'Sitting. Head turns left, back to center, right, back to center. Ears follow.' },
  lookCursor: { frames: 3,  fps: 0,  loop: false, from: 'sit',  to: 'sit',  directional: true, noMirror: true, desc: 'Sitting. 3 STILL frames in order: [0] head turned to viewer-LEFT, [1] looking straight at viewer, [2] head turned to viewer-RIGHT.' },
  standUp:    { frames: 12, fps: 8,  loop: false, from: 'sit',  to: 'sit',  desc: 'Rises onto hind legs, looks around while standing (paws up), then lowers back to sitting.' },
  // ---- working with paws
  dig:        { frames: 6,  fps: 10, loop: true,  from: 'quad', to: 'quad', desc: 'Side view facing right. Front paws alternately scratch the ground, small body rock.' },
  climb:      { frames: 8,  fps: 8,  loop: true,  from: 'quad', to: 'quad', desc: 'Side view facing right. Climbs a small wooden ladder / twig DRAWN IN THE FRAME (hamster goes up and returns so first=last frame).' },
  // ---- eating & drinking
  eat:        { frames: 8,  fps: 8,  loop: true,  from: 'sit',  to: 'sit',  desc: 'Sitting, holds a small strawberry/snack in BOTH front paws, raises to mouth, chews, cheeks puff slightly.' },
  eatSeeds:   { frames: 8,  fps: 8,  loop: true,  from: 'sit',  to: 'sit',  desc: 'Sitting, nibbling a sunflower seed held in paws, shell bits, fast small chewing.' },
  drink:      { frames: 6,  fps: 6,  loop: true,  from: 'quad', to: 'quad', desc: 'Side view facing right. Leans forward to a small water-bottle spout / bowl DRAWN IN THE FRAME, licks, returns.' },
  storeFood:  { frames: 8,  fps: 8,  loop: true,  from: 'sit',  to: 'sit',  desc: 'Sitting. Takes a seed, pushes it into cheek (cheek visibly bulges), second seed, cheeks fuller.' },
  washFace:   { frames: 8,  fps: 8,  loop: true,  from: 'sit',  to: 'sit',  desc: 'Sitting. Both front paws lick, then rub over face/ears in circles, return to rest.' },
  // ---- resting & grooming
  groom:      { frames: 8,  fps: 8,  loop: true,  from: 'sit',  to: 'sit',  desc: 'Sitting. Paws and head clean belly/side fur, licks paw, brushes fur.' },
  stretch:    { frames: 10, fps: 8,  loop: false, from: 'sit',  to: 'sit',  desc: 'Sitting -> front legs forward, rump up (play-bow stretch) -> back stretch -> yawn -> back to sitting.' },
  // ---- sleep cycle (3 sheets)
  curlUp:     { frames: 8,  fps: 8,  loop: false, from: 'sit',  to: 'curl', desc: 'Sitting -> yawns -> lowers -> curls into a ball, tucks nose, eyes close. LAST frame = frame 0 of sleepLoop.' },
  sleepLoop:  { frames: 6,  fps: 3,  loop: true,  from: 'curl', to: 'curl', desc: 'Curled up asleep, eyes closed. Slow breathing; one ear twitch within the loop.' },
  wakeUp:     { frames: 12, fps: 8,  loop: false, from: 'curl', to: 'sit',  desc: 'Curled -> slowly opens eyes -> uncurls -> big stretch + yawn -> sits up. LAST frame = frame 0 of sit.' },
  // ---- playful
  jump:       { frames: 8,  fps: 12, loop: false, from: 'quad', to: 'quad', travel: 0.3, desc: 'Side view facing right. Crouch, spring up with legs tucked, peak, land, settle. Travels slightly forward.' },
  roll:       { frames: 8,  fps: 10, loop: true,  from: 'quad', to: 'quad', travel: 0.6, desc: 'Side view. Rolls forward in a somersault/ball roll, returns upright on all fours. First=last frame.' },
  play:       { frames: 8,  fps: 8,  loop: true,  from: 'sit',  to: 'sit',  desc: 'Sitting with a tiny ball: pats it with paws, rolls it, catches it. Ball DRAWN IN THE FRAME.' },
  celebrate:  { frames: 8,  fps: 10, loop: false, from: 'sit',  to: 'sit',  desc: 'Sitting, excited: raises both paws, happy open-mouth smile (like the reference), wiggles, little hops in place, back to sitting.' },
  // ---- hideout (prop = hideout.png)
  enterHideout: { frames: 6, fps: 10, loop: false, from: 'quad', to: 'hidden', desc: 'Side view facing right, at the hideout door: scurries in. Last frame: hamster fully inside/behind hideout (may be empty frame).' },
  exitHideout:  { frames: 8, fps: 6,  loop: false, from: 'hidden', to: 'quad', desc: 'Starts empty/hidden, nose appears at door, head peeks, looks left/right, steps out onto all fours.' },
  // ---- bridges between poses
  sitDown:    { frames: 6,  fps: 10, loop: false, from: 'quad', to: 'sit',  desc: 'From all fours -> rises onto haunches -> settled sitting pose (reference pose).' },
  dropToFour: { frames: 6,  fps: 10, loop: false, from: 'sit',  to: 'quad', desc: 'From sitting -> leans forward -> front paws down -> on all fours, facing right.' },
};

/** Idle animation per pose: first AVAILABLE entry is used. */
export const IDLE_BY_POSE = { sit: 'sit', quad: ['sniff', 'walkPause'], curl: 'sleepLoop' };

/**
 * steps: [{ anim, loops:[min,max] | n }]               stationary, repeats `loops` times
 *        [{ anim, move:{ cells:[min,max] } }]          travels (loops derived from anim.travel)
 *        [{ anim, move:{ to:'hideout' } }]             travels to the hideout
 *        [{ hold:[minMs,maxMs] }]                      waits while hidden
 * modes: where the autonomous controller may pick it. weight: relative chance.
 * motion: 'high' behaviors are removed under prefers-reduced-motion.
 * reaction: user-triggered ('click' | 'scroll' | 'bottom'), never picked randomly.
 * engine: true => handled by engine (cursor look), no steps.
 */
export const BEHAVIORS = {
  // Patrol: walk a leg in the current heading (turns around at the screen edge), then often stop for a few seconds.
  walking:     { n: 1,  motion: 'high', modes: ['active'], weight: 4,   cooldown: 0,  steps: [{ anim: 'walking', move: { cells: [2, 6] } }, { anim: 'walkPause', loops: [2, 5], chance: 0.65 }] },
  run:         { n: 2,  motion: 'high', modes: ['active'], weight: 1.5, cooldown: 15000, steps: [{ anim: 'run', move: { cells: [3, 8] } }] },
  explore:     { n: 3,  motion: 'high', modes: ['active'], weight: 4,   cooldown: 20000, steps: [
    { anim: 'walking', move: { cells: [1, 2.5] } }, { anim: 'sniff', loops: [2, 4] },
    { anim: 'walking', move: { cells: [1, 2.5] } }, { anim: 'lookAround', loops: [1, 1] },
    { anim: 'walking', move: { cells: [1, 2.5] } }, { anim: 'sniff', loops: [2, 3] }] },
  sniff:       { n: 4,  motion: 'low',  modes: ['active'], weight: 2,   cooldown: 6000,  steps: [{ anim: 'sniff', loops: [3, 6] }] },
  lookAround:  { n: 5,  motion: 'low',  modes: ['active', 'resting'], weight: 2, cooldown: 8000, steps: [{ anim: 'lookAround', loops: [1, 2] }] },
  standUp:     { n: 6,  motion: 'low',  modes: ['active', 'resting'], weight: 1.5, cooldown: 15000, steps: [{ anim: 'standUp', loops: 1 }] },
  dig:         { n: 7,  motion: 'high', modes: ['active'], weight: 1.5, cooldown: 20000, steps: [{ anim: 'dig', loops: [4, 8] }] },
  climb:       { n: 8,  motion: 'high', modes: ['active'], weight: 1,   cooldown: 30000, steps: [{ anim: 'climb', loops: [2, 4] }] },
  eat:         { n: 9,  motion: 'low',  modes: ['active', 'resting'], weight: 2, cooldown: 25000, steps: [{ anim: 'eat', loops: [4, 8] }] },
  eatSeeds:    { n: 10, motion: 'low',  modes: ['resting'], weight: 2,   cooldown: 25000, steps: [{ anim: 'eatSeeds', loops: [4, 8] }] },
  drink:       { n: 11, motion: 'low',  modes: ['active'], weight: 1,   cooldown: 30000, steps: [{ anim: 'drink', loops: [3, 6] }] },
  storeFood:   { n: 12, motion: 'low',  modes: ['active', 'resting'], weight: 1.2, cooldown: 30000, steps: [{ anim: 'storeFood', loops: [2, 3] }] },
  washFace:    { n: 13, motion: 'low',  modes: ['resting'], weight: 3,   cooldown: 12000, steps: [{ anim: 'washFace', loops: [3, 5] }] },
  sleep:       { n: 14, motion: 'low',  modes: [], weight: 0, steps: [{ anim: 'curlUp', loops: 1 }, { anim: 'sleepLoop', loops: [6, 10] }] },   // driven by the cycle
  wakeUp:      { n: 15, motion: 'low',  modes: [], weight: 0, steps: [{ anim: 'wakeUp', loops: 1 }] },                                          // driven by the cycle
  stretch:     { n: 16, motion: 'low',  modes: ['resting', 'active'], weight: 2, cooldown: 20000, steps: [{ anim: 'stretch', loops: 1 }] },
  groom:       { n: 17, motion: 'low',  modes: ['resting'], weight: 3,   cooldown: 12000, steps: [{ anim: 'groom', loops: [3, 6] }] },
  sit:         { n: 18, motion: 'low',  modes: ['active', 'resting'], weight: 2, cooldown: 3000, steps: [{ anim: 'sit', loops: [3, 6] }] },
  jump:        { n: 19, motion: 'high', modes: ['active'], weight: 1.5, cooldown: 15000, steps: [{ anim: 'jump', loops: [1, 2] }] },
  roll:        { n: 20, motion: 'high', modes: ['active'], weight: 1,   cooldown: 25000, steps: [{ anim: 'roll', move: { cells: [1, 3] } }] },
  play:        { n: 21, motion: 'high', modes: ['active'], weight: 1.5, cooldown: 25000, steps: [{ anim: 'play', loops: [3, 6] }] },
  reactToCursor: { n: 22, engine: true, motion: 'low', modes: [], weight: 0, steps: [] },            // lookCursor, engine-level
  celebrate:   { n: 23, motion: 'high', modes: ['active'], weight: 0.7, cooldown: 30000, reaction: ['click', 'bottom'], steps: [{ anim: 'celebrate', loops: 1 }] },
  hideout:     { n: 24, motion: 'high', modes: ['active'], weight: 1,   cooldown: 45000, steps: [
    { anim: 'run', move: { to: 'hideout' } }, { anim: 'enterHideout', loops: 1 },
    { hold: [3000, 9000] }, { anim: 'exitHideout', loops: 1 }] },
  // extra reactions (not among the 24; reuse existing sheets)
  reactJump:   { n: 0, motion: 'high', modes: [], weight: 0, reaction: ['click'], steps: [{ anim: 'jump', loops: 1 }] },
  reactStand:  { n: 0, motion: 'low',  modes: [], weight: 0, reaction: ['click', 'scroll'], steps: [{ anim: 'standUp', loops: 1 }] },
  reactLook:   { n: 0, motion: 'low',  modes: [], weight: 0, reaction: ['scroll'], steps: [{ anim: 'lookAround', loops: [1, 2] }] },
  sleepContinue: { n: 0, motion: 'low', modes: [], weight: 0, steps: [{ anim: 'sleepLoop', loops: [6, 10] }] },
};

/** Activity cycle, durations in ms [min,max]. */
export const CYCLE = {
  active:   [45000, 90000],
  resting:  [20000, 40000],
  sleeping: [40000, 90000],
  inactivityMs: 45000,     // no user activity for this long => falls asleep
  minSleepMs: 6000,        // can't be woken before this
  historySize: 3,          // behaviors not repeated within the last N picks
  idleChance: 0.55,        // chance of a short idle gap between behaviors
};
