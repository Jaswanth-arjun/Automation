import test from 'node:test'; import assert from 'node:assert/strict';
import { BehaviorController } from '../src/behaviorController.js';
import { ANIMATIONS, BEHAVIORS, CYCLE } from '../src/animations.config.js';

const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const mk = (o = {}) => { const clock = { t: 0 }; const c = new BehaviorController({ rng: mulberry(o.seed ?? 1), now: () => clock.t, ...o }); return { c, clock }; };
const ctx = { roomLeft: 5, roomRight: 5, hideoutDelta: 3 };

test('24 behaviors defined, numbered 1..24', () => {
  const nums = Object.values(BEHAVIORS).map(b => b.n).filter(Boolean).sort((a, b) => a - b);
  assert.deepEqual(nums, Array.from({ length: 24 }, (_, i) => i + 1));
});
test('every behavior references existing animations', () => {
  for (const [id, b] of Object.entries(BEHAVIORS)) for (const s of b.steps) if (s.anim) assert.ok(ANIMATIONS[s.anim], `${id}->${s.anim}`);
});
test('pose continuity: every step starts in the pose the previous step ended in', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { c, clock } = mk({ seed }); let pose = 'sit', n = 0;
    for (let i = 0; i < 1500; i++) {
      clock.t += 3000;                                   // keep user "active"
      c.lastActivity = clock.t;
      for (const s of c.nextPlan(ctx)) { assert.equal(s.from, pose, `seed ${seed} step ${s.anim ?? 'hold'}: expected ${pose}`); pose = s.to; n++; }
    }
    assert.ok(n > 1500);
  }
});
test('never repeats the same behavior back-to-back and respects history', () => {
  const { c, clock } = mk({ seed: 9 }); const ids = [];
  for (let i = 0; i < 400; i++) { clock.t += 4000; c.lastActivity = clock.t; c.nextPlan(ctx); ids.push(c.lastId); }
  for (let i = 1; i < ids.length; i++) if (ids[i] !== 'sleepContinue') assert.notEqual(ids[i], ids[i - 1]); // sleep chunks legitimately repeat
  assert.ok(new Set(ids).size >= 15, 'good variety: ' + new Set(ids).size);
});
test('full cycle: active -> resting -> sleeping -> waking -> active', () => {
  const { c, clock } = mk({ seed: 3 }); const seen = [];
  for (let i = 0; i < 400; i++) { clock.t += 2500; c.lastActivity = clock.t; c.nextPlan(ctx); if (seen.at(-1) !== c.mode) seen.push(c.mode); }
  const s = seen.join('>'); assert.ok(s.includes('active>resting>sleeping>active') || s.includes('resting>sleeping>active'), s);
});
test('sleep uses curlUp then sleepLoop, wake uses wakeUp (cycle sleep wakes only on click)', () => {
  const { c, clock } = mk({ seed: 4 });
  c._setMode('sleeping'); c.sleepReason = 'cycle'; c.pose = 'sit';
  let p = c.nextPlan(ctx); assert.deepEqual(p.map(s => s.anim).slice(0, 2), ['curlUp', 'sleepLoop']);
  clock.t += 10000; c.noteActivity('move'); assert.equal(c.hasUrgent(), false, 'mouse movement must not wake cycle-sleep');
  c.noteActivity('click'); assert.equal(c.hasUrgent(), true);
  p = c.nextPlan(ctx); assert.equal(p[0].anim, 'wakeUp'); assert.equal(c.mode, 'active');
});
test('inactivity -> sleep, any activity -> wake', () => {
  const { c, clock } = mk({ seed: 5 }); clock.t = CYCLE.inactivityMs + 1000;
  assert.equal(c.hasUrgent(), true); let p = c.nextPlan(ctx);
  assert.equal(c.mode, 'sleeping'); assert.ok(p.some(s => s.anim === 'curlUp'));
  clock.t += 7000; c.noteActivity('move'); assert.equal(c.hasUrgent(), true);
  p = c.nextPlan(ctx); assert.equal(p[0].anim, 'wakeUp');
});
test('reactions are queued and played at next plan', () => {
  const { c } = mk({ seed: 6 }); c.queueReaction('click'); assert.ok(c.hasUrgent());
  const p = c.nextPlan(ctx); assert.ok(['celebrate', 'reactJump', 'reactStand'].includes(c.lastId), c.lastId);
});
test('moves fit in available room and use whole strides', () => {
  const { c, clock } = mk({ seed: 7 });
  for (let i = 0; i < 300; i++) { clock.t += 3000; c.lastActivity = clock.t; const room = { roomLeft: 0.4, roomRight: 2, hideoutDelta: null };
    for (const s of c.nextPlan(room)) if (s.move) { assert.ok(s.move.cells <= (s.move.dir === 1 ? 2 : 0.4) + 1e-9); if (!s.move.exact) assert.ok(Math.abs(s.move.cells / ANIMATIONS[s.anim].travel - s.loops) < 1e-9); } }
});
test('reduced motion: no travel, no high-motion behaviors', () => {
  const { c, clock } = mk({ seed: 8, reducedMotion: true }); const used = new Set();
  for (let i = 0; i < 400; i++) { clock.t += 3000; c.lastActivity = clock.t; for (const s of c.nextPlan(ctx)) { assert.ok(!s.move); } used.add(c.lastId); }
  for (const id of used) assert.notEqual(BEHAVIORS[id].motion, 'high', id);
});
test('graceful with missing sheets: only behaviors whose sheets exist are chosen', () => {
  const have = new Set(['sit', 'eat', 'groom', 'washFace']);
  const { c, clock } = mk({ seed: 10, isAvailable: id => have.has(id) }); const ids = new Set();
  for (let i = 0; i < 200; i++) { clock.t += 3000; c.lastActivity = clock.t; for (const s of c.nextPlan(ctx)) assert.ok(have.has(s.anim), s.anim); ids.add(c.lastId); }
  assert.ok(ids.size >= 3);
});
test('hideout behavior: run -> enterHideout -> hold -> exitHideout, exact distance', () => {
  const { c } = mk({ seed: 11 }); c.pose = 'quad'; const p = c._expand('hideout', { hideoutDelta: 2.6 });
  assert.deepEqual(p.map(s => s.anim ?? 'hold'), ['run', 'enterHideout', 'hold', 'exitHideout']);
  assert.equal(p[0].move.exact, true); assert.equal(p[0].move.cells, 2.6);
});

// ---------- Action 01: walking (only the walking sheet exists) ----------
const only = new Set(['walking', 'walkPause']);
test('walking-only: simulated patrol travels both ways, turns at edges, pauses, never gets stuck', () => {
  const { c, clock } = mk({ seed: 21, isAvailable: id => only.has(id) });
  c.pose = 'quad'; c.lastActivity = -1e9 + 0;           // user inactive for ever: must NOT trigger sleep (no sleep sheets)
  const MIN = -0.12, MAX = 5.0;                         // screen width in character widths
  let x = MIN, dirs = new Set(), turns = 0, prevDir = 1, pauses = 0, walks = 0, minX = 9, maxX = -9;
  for (let i = 0; i < 400; i++) {
    clock.t += 5000;
    assert.equal(c.hasUrgent(), false, 'no sleep available -> no interrupts');
    for (const s of c.nextPlan({ roomLeft: x - MIN, roomRight: MAX - x, hideoutDelta: null })) {
      assert.ok(['walking', 'walkPause'].includes(s.anim));
      if (s.move) { walks++; dirs.add(s.move.dir); if (s.move.dir !== prevDir) { turns++; prevDir = s.move.dir; } x += s.move.dir * s.move.cells; assert.ok(x >= MIN - 1e-9 && x <= MAX + 1e-9, 'x=' + x); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      else { pauses++; assert.equal(s.anim, 'walkPause'); }
    }
    assert.equal(c.mode === 'sleeping', false);
  }
  assert.deepEqual([...dirs].sort(), [-1, 1]); assert.ok(turns >= 10, 'turns ' + turns); assert.ok(pauses > 50 && walks > 100, `${pauses}/${walks}`);
  assert.ok(minX < 0.8 && maxX > MAX - 0.8, `reaches both edges: ${minX}..${maxX}`);
});
test('walking: first leg from the left edge heads right', () => {
  const { c } = mk({ seed: 2, isAvailable: id => only.has(id) }); c.pose = 'quad';
  const p = c.nextPlan({ roomLeft: 0, roomRight: 5, hideoutDelta: null }); const mv = p.find(s => s.move); assert.equal(mv.move.dir, 1);
});
test('pause lasts a few seconds (2-5 loops at 1 fps) and walking resumes', () => {
  const { c } = mk({ seed: 3, isAvailable: id => only.has(id) }); c.pose = 'quad'; let seen = false;
  for (let i = 0; i < 80; i++) { const p = c.nextPlan({ roomLeft: 3, roomRight: 3 }); const k = p.findIndex(s => s.anim === 'walkPause' && !s.idle); if (k >= 0) { seen = true; assert.ok(p[k].loops >= 2 && p[k].loops <= 5); assert.equal(p[k - 1].anim, 'walking'); } }
  assert.ok(seen);
});
