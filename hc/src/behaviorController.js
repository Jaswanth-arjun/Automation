import { ANIMATIONS, BEHAVIORS, CYCLE, IDLE_BY_POSE } from './animations.config.js';

const between = (rng, [a, b]) => a + rng() * (b - a);
const rint = (rng, v) => (Array.isArray(v) ? Math.floor(v[0] + rng() * (v[1] - v[0] + 1)) : v ?? 1);

/**
 * Pure logic (no DOM, no timers): decides WHAT the hamster does next.
 * The engine asks for a plan whenever it runs out of steps.
 */
export class BehaviorController {
  constructor({ animations = ANIMATIONS, behaviors = BEHAVIORS, cycle = CYCLE, rng = Math.random,
                now = () => Date.now(), isAvailable = () => true, reducedMotion = false } = {}) {
    Object.assign(this, { animations, behaviors, cycle, rng, now, isAvailable, reducedMotion });
    this.pose = 'sit';
    this.mode = 'active';
    this.modeEnd = now() + between(rng, cycle.active);
    this.modeSince = now();
    this.sleepReason = null;
    this.lastActivity = now();
    this.history = [];
    this.lastId = null;
    this.lastRun = {};
    this.reactions = [];
    this._wake = false;
    this.heading = 1;          // current walking direction (patrol)
  }
  /** Pose to start in = pose of the best available idle animation. Call once sheets are loaded. */
  resetPose() {
    for (const pose of ['sit', 'quad', 'curl']) if ([].concat(IDLE_BY_POSE[pose] ?? []).some(id => this._animOk(id))) return (this.pose = pose);
    const any = Object.keys(this.animations).find(id => this._animOk(id)); if (any) this.pose = this.animations[any].from; return this.pose;
  }
  _canSleep() { const b = this.behaviors.sleep; return !!b && this._behaviorOk(b); }

  // ---------- input from the engine ----------
  noteActivity(kind = 'move') {
    const t = this.now();
    this.lastActivity = t;
    if (this.mode !== 'sleeping' || t - this.modeSince < this.cycle.minSleepMs) return;
    // inactivity-sleep wakes on any activity; cycle-sleep only on a click
    if (this.sleepReason === 'inactive' || kind === 'click') this._wake = true;
  }
  queueReaction(kind) { if (this.reactions.length < 2) this.reactions.push(kind); if (kind === 'click') this.noteActivity('click'); }
  /** True when the engine should end the current looping step at its next loop boundary. */
  hasUrgent() {
    const t = this.now();
    return this.reactions.length > 0 || this._wake ||
      (this.mode !== 'sleeping' && this._canSleep() && t - this.lastActivity > this.cycle.inactivityMs) ||
      (this.mode === 'sleeping' && t >= this.modeEnd);
  }

  // ---------- planning ----------
  _anyFor(mode) { return Object.values(this.behaviors).some(b => b.weight > 0 && b.modes.includes(mode) && this._behaviorOk(b)); }
  _setMode(m) { this.mode = m; this.modeSince = this.now(); this.modeEnd = this.now() + (this.cycle[m] ? between(this.rng, this.cycle[m]) : 0); }
  _animOk(id) { return !!this.animations[id] && this.isAvailable(id); }
  _allowed(b) { return !(this.reducedMotion && b.motion === 'high'); }
  _behaviorOk(b) {
    if (!this._allowed(b)) return false;
    return b.steps.every(s => !s.anim || this._animOk(s.anim)) && this._pathOk(b);
  }
  _pathOk(b) {
    let pose = this.pose;
    for (const s of b.steps) {
      if (!s.anim) continue;
      const a = this.animations[s.anim];
      const p = this.path(pose, a.from); if (!p) return false;
      pose = a.to;
    }
    return true;
  }
  /** Shortest chain of available bridge animations from pose A to pose B (BFS). */
  path(from, to) {
    if (from === to) return [];
    const bridges = Object.entries(this.animations).filter(([id, a]) => a.from !== a.to && this._animOk(id));
    const q = [[from, []]], seen = new Set([from]);
    while (q.length) {
      const [pose, chain] = q.shift();
      for (const [id, a] of bridges) if (a.from === pose && !seen.has(a.to)) {
        const c = [...chain, id]; if (a.to === to) return c;
        seen.add(a.to); q.push([a.to, c]);
      }
    }
    return null;
  }
  _push(plan, animId, extra = {}) {
    const a = this.animations[animId];
    plan.push({ anim: animId, from: a.from, to: a.to, loops: 1, interruptible: a.loop, ...extra });
    this.pose = a.to;
  }
  _expand(behaviorId, ctx = {}) {
    const b = this.behaviors[behaviorId], plan = [];
    for (const s of b.steps) {
      if (s.chance != null && this.rng() > s.chance) continue;
      if (s.hold) { plan.push({ hold: between(this.rng, s.hold), from: 'hidden', to: 'hidden' }); continue; }
      for (const id of this.path(this.pose, this.animations[s.anim].from)) this._push(plan, id);
      const a = this.animations[s.anim];
      let step = { loops: rint(this.rng, s.loops) };
      if (s.move && !this.reducedMotion && a.travel) {
        const m = this._resolveMove(s.move, a, ctx);
        if (m) step = { loops: Math.max(1, Math.round(m.cells / a.travel)), move: m };
      } else if (s.move && a.loop) step = { loops: 2 };   // reduced motion: animate in place
      this._push(plan, s.anim, { ...step, interruptible: a.loop && !step.move?.exact });
    }
    this.lastRun[behaviorId] = this.now();
    return plan;
  }
  _resolveMove(m, a, ctx) {
    const { roomLeft = 4, roomRight = 4 } = ctx;
    if (m.to === 'hideout') {
      if (ctx.hideoutDelta == null) return null;
      return { dir: Math.sign(ctx.hideoutDelta) || 1, cells: Math.abs(ctx.hideoutDelta), exact: true };
    }
    const want = between(this.rng, m.cells);
    const prefer = this.rng() < 0.1 ? -this.heading : this.heading;          // keep going, occasionally turn on a whim
    for (const dir of [prefer, -prefer]) {
      const room = (dir === 1 ? roomRight : roomLeft) - 0.1;
      if (room < a.travel) continue;
      let n = Math.max(1, Math.round(want / a.travel));
      while (n > 1 && n * a.travel > room) n--;
      this.heading = dir;                                                    // hitting an edge => room is small => we turn around
      return { dir, cells: n * a.travel };
    }
    return null;
  }
  _idleGap() {
    const id = [].concat(IDLE_BY_POSE[this.pose] ?? []).find(i => this._animOk(i));
    if (!id || this.rng() > this.cycle.idleChance) return [];
    const plan = []; this._push(plan, id, { loops: rint(this.rng, [1, 3]), idle: true }); return plan;
  }
  _pick(kind) {
    let pool = Object.entries(this.behaviors).filter(([id, b]) => kind ? b.reaction?.includes(kind) : (b.modes.includes(this.mode) && b.weight > 0));
    pool = pool.filter(([, b]) => this._behaviorOk(b));
    if (!kind) pool = pool.filter(([id, b]) => this.now() - (this.lastRun[id] ?? -1e9) >= (b.cooldown ?? 0));
    const fresh = pool.filter(([id]) => id !== this.lastId && !this.history.includes(id));
    const alt = pool.filter(([id]) => id !== this.lastId);
    const use = fresh.length ? fresh : alt.length ? alt : pool;          // a single available behavior may repeat
    if (!use.length) return null;
    let r = this.rng() * use.reduce((s, [, b]) => s + (kind ? 1 : b.weight), 0);
    for (const [id, b] of use) { r -= kind ? 1 : b.weight; if (r <= 0) return id; }
    return use[use.length - 1][0];
  }
  _record(id) { this.lastId = id; this.history.push(id); if (this.history.length > this.cycle.historySize) this.history.shift(); }
  _try(id, ctx) { const b = this.behaviors[id]; return b && this._behaviorOk(b) ? this._expand(id, ctx) : null; }

  /** @returns {Array} steps (never empty unless no sheet is available) */
  nextPlan(ctx = {}) {
    const t = this.now();
    if (this.mode !== 'sleeping' && t - this.lastActivity > this.cycle.inactivityMs) { this.sleepReason = 'inactive'; this._setMode('sleeping'); }
    else if (this.mode === 'sleeping' && (this._wake || t >= this.modeEnd)) { this._wake = false; this._setMode('waking'); }
    else if (this.mode === 'active' && t >= this.modeEnd) this._setMode('resting');
    else if (this.mode === 'resting' && t >= this.modeEnd) { this.sleepReason = 'cycle'; this._setMode('sleeping'); }

    if (this.mode === 'resting' && !this._anyFor('resting')) this._setMode('active');   // nothing to do while resting yet
    if (this.mode === 'waking') {
      const plan = this._try('wakeUp'); this._setMode('active');
      if (plan) { this._record('wakeUp'); return plan; }
      this.pose = this.pose === 'curl' ? 'sit' : this.pose;
    }
    if (this.mode === 'sleeping') {
      const id = this.pose === 'curl' ? 'sleepContinue' : 'sleep';
      const plan = this._try(id, ctx);
      if (plan) { this._record(id); return plan; }
      this._setMode('active');                      // no sleep sheets yet: skip sleeping
    }
    const kind = this.reactions.shift();
    if (kind) { const id = this._pick(kind); const plan = id && this._try(id, ctx); if (plan) { this._record(id); return plan; } }
    const id = this._pick();
    if (!id) { const idle = []; const g = [].concat(IDLE_BY_POSE[this.pose] ?? []).find(i => this._animOk(i)); if (g) this._push(idle, g, { loops: 1, idle: true }); return idle; }
    const gap = this.lastId && !['sit', 'sniff', 'walking'].includes(id) ? this._idleGap() : [];
    const plan = [...gap, ...this._expand(id, ctx)];
    this._record(id);
    return plan;
  }
}
