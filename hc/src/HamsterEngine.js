import { ANIMATIONS, BEHAVIORS, CYCLE } from './animations.config.js';
import { BehaviorController } from './behaviorController.js';
import { SpriteAssets } from './assets.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * DOM + animation runtime. Plays real sprite-sheet frames on a canvas and moves the
 * character container only when a travelling animation (walk/run/roll/jump) is playing,
 * at the exact speed of its drawn stride. No transform is used to imitate an action.
 */
export class HamsterEngine {
  constructor(container, o = {}) {
    this.o = { animations: ANIMATIONS, behaviors: BEHAVIORS, cycle: CYCLE, bottom: 0, zIndex: 10, debug: false, ...o };
    this.host = container;
    this.reduced = o.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.assets = new SpriteAssets(o.manifest, this.o.animations);
    this.controller = new BehaviorController({
      animations: this.o.animations, behaviors: this.o.behaviors, cycle: this.o.cycle, rng: o.rng ?? Math.random,
      isAvailable: id => this.assets.has(id), reducedMotion: this.reduced,
    });
    this.ac = new AbortController();
    this.queue = []; this.step = null; this.x = 0; this.facing = 1; this.look = null;
    this.last = 0; this.raf = 0; this.drawn = ''; this.waitMs = 0; this.atBottom = false; this.lastScroll = 0; this.lastPointer = 0; this.lookT = 0;
    this._build();
  }

  // ---------------- setup ----------------
  _build() {
    const { cell, groundY } = this.o.manifest;
    this.root = document.createElement('div');
    Object.assign(this.root.style, { position: 'fixed', left: '0', right: '0', bottom: this.o.bottom + 'px', pointerEvents: 'none', overflow: 'hidden', zIndex: this.o.zIndex, contain: 'layout paint style' });
    this.root.setAttribute('aria-hidden', 'true');
    this.hideout = document.createElement('canvas');
    this.pet = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.hit = document.createElement('div');
    for (const el of [this.hideout, this.pet]) Object.assign(el.style, { position: 'absolute', left: '0', pointerEvents: 'none' });
    Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%', userSelect: 'none' });
    Object.assign(this.hit.style, { position: 'absolute', left: '22%', width: '56%', top: '28%', bottom: '0', pointerEvents: 'auto', cursor: 'pointer', touchAction: 'manipulation' });
    this.pet.append(this.canvas, this.hit);
    this.root.append(this.hideout, this.pet);
    this.host.appendChild(this.root);
    this.g = this.canvas.getContext('2d');
    this._size();
    this.x = this._minX();                                   // start at the left edge
  }
  _size() {
    const { cell, groundY } = this.o.manifest;
    this.size = Math.round(this.o.size ?? clamp(innerWidth * 0.18, 88, 150));
    this.h = Math.round(this.size * cell.h / cell.w);
    this.dpr = Math.min(2, devicePixelRatio || 1);
    const drop = -Math.round((cell.h - groundY) * this.size / cell.w);       // feet touch the bottom edge
    this.root.style.height = this.h + drop + 'px';
    for (const el of [this.hideout, this.pet]) { el.style.width = this.size + 'px'; el.style.height = this.h + 'px'; el.style.bottom = drop + 'px'; }
    this.canvas.width = Math.round(this.size * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.hideoutX = Math.max(this.size, innerWidth - this.size * 1.15);
    this.hideout.style.transform = `translate3d(${this.hideoutX}px,0,0)`;
    this.hideoutOk = innerWidth > this.size * 3.2;
    this.hideout.style.display = this.hideoutOk ? 'block' : 'none';
    this.drawn = ''; this._drawProp();
  }
  _drawProp() {
    const p = this.assets.props.get('hideout'); if (!p) return;
    this.hideout.width = this.canvas.width; this.hideout.height = this.canvas.height;
    const g = this.hideout.getContext('2d'); g.clearRect(0, 0, this.hideout.width, this.hideout.height);
    g.drawImage(p.img, 0, 0, this.hideout.width, this.hideout.height);
  }
  _minX() { return -this.size * 0.12; }
  _maxX() { return innerWidth - this.size * 0.88; }

  async start() {
    const sig = { signal: this.ac.signal };
    const on = (t, ev, fn, opt = {}) => t.addEventListener(ev, fn, { ...opt, ...sig });
    on(window, 'pointermove', e => this._pointer(e), { passive: true });
    on(document, 'pointerleave', () => { this.look = null; });
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) on(window, ev, () => this.controller.noteActivity('move'), { passive: true });
    on(window, 'scroll', () => this._scroll(), { passive: true });
    on(window, 'resize', () => { clearTimeout(this._rt); this._rt = setTimeout(() => { this._size(); this.x = clamp(this.x, this._minX(), this._maxX()); this._placed = false; }, 150); });
    on(this.hit, 'click', () => { if (this.step?.hold == null) this.controller.queueReaction('click'); });
    on(document, 'visibilitychange', () => { document.hidden ? cancelAnimationFrame(this.raf) : this._resume(); });
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    on(mq, 'change', e => { this.reduced = e.matches; this.controller.reducedMotion = e.matches; this.queue = []; });
    this.assets.onChange = () => {};
    await this.assets.load();
    if (this.ac.signal.aborted) return;
    this._drawProp();
    this.controller.resetPose();
    this._resume();
  }
  _resume() { cancelAnimationFrame(this.raf); this.last = 0; this.raf = requestAnimationFrame(t => this._tick(t)); }

  // ---------------- interactions (all lightweight) ----------------
  _pointer(e) {
    const t = performance.now(); if (t - this.lastPointer < 80) return; this.lastPointer = t;
    this.controller.noteActivity('move');
    if (this.reduced || !this.assets.has('lookCursor')) return;
    const r = this.pet.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) > this.size * 3) { this.look = null; return; }
    this.look = Math.abs(dx) < this.size * 0.15 ? 1 : dx < 0 ? 0 : 2;
    this.lookT = t;
  }
  _scroll() {
    const t = performance.now(); if (t - this.lastScroll < 200) return; this.lastScroll = t;
    this.controller.noteActivity('scroll');
    const el = document.documentElement, bottom = innerHeight + scrollY >= el.scrollHeight - 8 && el.scrollHeight > innerHeight + 50;
    if (bottom && !this.atBottom) this.controller.queueReaction('bottom');
    else if (!bottom && Math.random() < 0.12) this.controller.queueReaction('scroll');
    this.atBottom = bottom;
  }

  // ---------------- main loop ----------------
  _ctx() {
    const s = this.size;
    return { roomLeft: (this.x - this._minX()) / s, roomRight: (this._maxX() - this.x) / s, hideoutDelta: this.hideoutOk ? (this.hideoutX - this.x) / s : null };
  }
  _next() {
    if (!this.queue.length) this.queue = this.controller.nextPlan(this._ctx());
    const s = this.queue.shift(); if (!s) { this.waitMs = 800; return; }
    this.step = { ...s, t: 0, boundary: 0 };
    if (s.move) this.facing = s.move.dir;
  }
  _tick(ts) {
    this.raf = requestAnimationFrame(t => this._tick(t));
    const dt = this.last ? Math.min(50, ts - this.last) : 16; this.last = ts;
    if (this.waitMs > 0) { this.waitMs -= dt; this._draw(null); return; }
    if (!this.step) this._next();
    const s = this.step; if (!s) return;
    if (this.look != null && ts - this.lookT > 2500) this.look = null;
    if (s.hold != null) { s.t += dt; this._draw(null); if (s.t >= s.hold) this.step = null; return; }

    const sheet = this.assets.sheets.get(s.anim), a = this.o.animations[s.anim];
    const loopMs = (sheet.frames / a.fps) * 1000, total = loopMs * s.loops;
    const prev = s.t; s.t += dt;
    if (s.move && !this.reduced) {
      this.x = clamp(this.x + s.move.dir * s.move.cells * this.size * (Math.min(s.t, total) - Math.min(prev, total)) / total, this._minX(), this._maxX());
      this.pet.style.transform = `translate3d(${this.x.toFixed(1)}px,0,0)`;
    } else if (!this._placed) { this.pet.style.transform = `translate3d(${this.x}px,0,0)`; this._placed = true; }
    let done = s.t >= total;
    const loopIdx = Math.floor(s.t / loopMs);
    if (!done && s.interruptible && loopIdx > s.boundary) { s.boundary = loopIdx; if (this.controller.hasUrgent()) done = true; }
    const frame = done ? sheet.frames - 1 : Math.min(sheet.frames - 1, Math.floor(((s.t % loopMs) / loopMs) * sheet.frames));
    this._draw(s.anim, frame);
    if (done) this.step = null;
  }
  _draw(anim, frame = 0) {
    let id = anim, f = frame;
    if (anim === 'sit' && this.look != null && this.assets.has('lookCursor')) { id = 'lookCursor'; f = this.look; }
    const key = id ? `${id}:${f}:${this.facing}` : 'none';
    if (key === this.drawn) return; this.drawn = key;
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    if (this.o.debug) { this.canvas.dataset.anim = id || ''; this.canvas.dataset.frame = f; }
    if (!id) return;
    const sh = this.assets.sheets.get(id), a = this.o.animations[id];
    const sf = sh.map ? sh.map[f] : f, sx = (sf % sh.columns) * sh.fw, sy = Math.floor(sf / sh.columns) * sh.fh;
    if (this.facing === -1 && !a.noMirror) g.setTransform(-1, 0, 0, 1, W, 0);   // sheets are drawn facing right
    g.imageSmoothingQuality = 'high';
    g.drawImage(sh.img, sx, sy, sh.fw, sh.fh, 0, 0, W, H);
  }

  getState() { const s = this.step; return { anim: s?.anim ?? null, hold: s?.hold ?? null, x: this.x, facing: this.facing, mode: this.controller.mode, pose: this.controller.pose, frame: +this.canvas.dataset.frame }; }
  destroy() {
    this.ac.abort(); cancelAnimationFrame(this.raf); clearTimeout(this._rt);
    this.assets.destroy(); this.root.remove(); this.queue = []; this.step = null;
  }
}
