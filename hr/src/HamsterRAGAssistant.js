/* HamsterRAGAssistant v2 — layered character rig + continuous animation loop.
   The animation only listens to events (dispatch). It never touches your retrieval/API code.
   Rigged parts (from the supplied art): body, head, ears L/R, eyes L/R (idle pose); eyes + procedural pages (book pose);
   closed-book layer (cut from the storyboard). Flat poses 'happy' and 'confused' are used only for those two reactions. */
export const CELL = [255, 294];
export const STATES = ['idle','picking_up_book','holding_closed_book','waiting_for_question','opening_book','searching_and_turning_pages',
  'answer_found','celebrating','waiting_for_next_question','error_reaction','closing_book','putting_book_down','returning_to_idle'];
export const LAYERS = ['idle_body','idle_head','idle_earL','idle_earR','idle_eyeL','idle_eyeR','idle_armL','idle_armR','hold_base','hold_eyeL','hold_eyeR','book_closed','happy','confused'];
// pivots / centres in cell units (from rig/meta.json)
const RIG = { neck: [128, 208], earL: [62, 122], earR: [156, 102], foot: [128, 292],
  idleEyes: [[97, 153], [164, 141]], holdEyes: [[101, 177], [171, 166]], shoulderL: [82, 222], shoulderR: [184, 222], bookRest: [135, 252], bookSize: [143, 60] };
const CSS = `
.hrag{--hw:clamp(104px,22vw,150px);--hh:calc(var(--hw)*${CELL[1]}/${CELL[0]});position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:9998;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
 --bg:#fff;--fg:#1d2433;--mut:#6b7488;--bd:#e3e8f2;--acc:#2f6bff;--bub:#eef2fb;--err:#fdecec;--errfg:#9b1c1c}
@media (prefers-color-scheme:dark){.hrag{--bg:#1b2130;--fg:#eef1f8;--mut:#9aa4ba;--bd:#2b3448;--bub:#262e42;--err:#3a2024;--errfg:#ffb4b4}}
.hrag-btn{pointer-events:auto;position:relative;display:block;width:var(--hw);height:var(--hh);padding:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:24px;overflow:visible}
.hrag-btn:focus-visible{outline:3px solid var(--acc);outline-offset:2px}
.hrag-stage{position:absolute;inset:0;transform-origin:50% 99%}
.hrag-rig{position:absolute;inset:0;opacity:0;transition:none}
.hrag-rig.on{opacity:1;transition:opacity .14s linear}
.hrag-rig img,.hrag-rig canvas,.hrag-grp,.hrag-clip canvas{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
.hrag-clip img{position:absolute;pointer-events:none;user-select:none;-webkit-user-drag:none}
.hrag-rig img,.hrag-grp{left:0;top:0;width:100%;height:100%;will-change:transform}
.hrag-rig img{filter:drop-shadow(0 5px 6px rgba(30,20,10,.16))}
.hrag-rig img.nofx{filter:none}
.hrag-grp{will-change:transform}
.hrag-pages{left:0;top:0;width:100%;height:100%}
.hrag-clip{position:absolute;inset:0;clip-path:inset(-120% -120% 0 -120%);pointer-events:none}
.hrag-clip img{left:0;top:0;width:${(143/255*100).toFixed(2)}%;height:${(60/294*100).toFixed(2)}%;opacity:0;will-change:transform;filter:drop-shadow(0 4px 5px rgba(0,0,30,.25))}
.hrag-fx{position:absolute;left:-60%;top:-70%;width:220%;height:190%;pointer-events:none}
.hrag-panel{pointer-events:none;position:absolute;right:calc(var(--hw) + 8px);bottom:calc(var(--hh)*.18);width:min(370px,calc(100vw - var(--hw) - 36px));height:min(480px,calc(100vh - 36px));display:flex;flex-direction:column;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:22px;box-shadow:0 18px 50px rgba(20,30,60,.22);overflow:hidden;
 opacity:0;visibility:hidden;transform:translate(26px,18px) scale(.55);transform-origin:100% 100%;transition:transform .32s cubic-bezier(.2,.9,.25,1.15),opacity .22s ease,visibility 0s linear .32s}
.hrag[data-open="1"] .hrag-panel{pointer-events:auto;opacity:1;visibility:visible;transform:none;transition:transform .32s cubic-bezier(.2,.9,.25,1.15),opacity .22s ease,visibility 0s}
@media (max-width:640px){.hrag-panel{right:0;bottom:calc(var(--hh) + 6px);width:calc(100vw - 24px);height:min(60vh,460px);transform-origin:90% 100%}}
.hrag-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 12px 18px;border-bottom:1px solid var(--bd);font-weight:600;font-size:15px}
.hrag-x{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--mut);font-size:20px;line-height:1}
.hrag-x:hover{background:var(--bub)}.hrag-x:focus-visible{outline:2px solid var(--acc)}
.hrag-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
.hrag-m{max-width:86%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;background:var(--bub)}
.hrag-m.u{align-self:flex-end;background:var(--acc);color:#fff;border-bottom-right-radius:5px}
.hrag-m.b{align-self:flex-start;border-bottom-left-radius:5px}
.hrag-m.e{align-self:flex-start;background:var(--err);color:var(--errfg);border-bottom-left-radius:5px}
.hrag-dots{display:inline-flex;gap:4px}.hrag-dots i{width:6px;height:6px;border-radius:50%;background:var(--mut);animation:hrag-d 1s infinite}.hrag-dots i:nth-child(2){animation-delay:.15s}.hrag-dots i:nth-child(3){animation-delay:.3s}
@keyframes hrag-d{0%,60%,100%{opacity:.3}30%{opacity:1}}
.hrag-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--bd)}
.hrag-in{flex:1;min-width:0;font:inherit;font-size:14px;color:var(--fg);background:var(--bub);border:1px solid transparent;border-radius:14px;padding:10px 12px;outline:none}
.hrag-in:focus{border-color:var(--acc)}
.hrag-send{font:inherit;font-weight:600;font-size:14px;color:#fff;background:var(--acc);border:0;border-radius:14px;padding:0 16px;cursor:pointer}
.hrag-send:disabled,.hrag-in:disabled{opacity:.55;cursor:not-allowed}
@media (prefers-reduced-motion:reduce){.hrag-panel,.hrag[data-open="1"] .hrag-panel{transition:none}.hrag-rig.on{transition:none}}
`;
// Layered book geometry, in the art's own coordinates (143x60): top face A,B,C,D; the SPINE is the A->D edge, page edges run D->C.
const BK = { A: [9.6, 14.4], E1: [67.4, -13], E2: [63.6, 23], Z: 44, Zp: 38 };
const easeOut = (t) => 1 - Math.pow(1 - t, 3), easeIn = (t) => t * t * t;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, rnd = (a, b) => a + Math.random() * (b - a);
const P0 = () => ({ headRot: 0, headY: 0, headX: 0, bodySY: 1, bodyY: 0, earL: 0, earR: 0, eyeS: 1, lookX: 0, lookY: 0,
  bookY: 78, bookRot: -8, bookS: .92, bookA: 1, arm: 0, cover: 0, bx: 0, by: 0, bsc: 1, ikL: 0, ikR: 0, gzB: 0, rFollow: 0, stageY: 0, stageRot: 0, stageSY: 1 });

export class HamsterRAGAssistant {
  constructor(o) {
    this.o = { ui: true, parent: document.body, title: 'Ask me anything', ...o };
    this.rm = matchMedia('(prefers-reduced-motion: reduce)').matches; this.amp = this.rm ? 0.2 : 1; this.tspd = this.rm ? 0.6 : 1;
    this.state = 'idle'; this.tok = 0; this.lock = false; this.queue = []; this.tweens = []; this.P = P0();
    this.rigMode = 'idle'; this.typing = false; this.busy = false; this.speed = 1; this.flip = null; this.parts = [];
    this.log = []; this.stats = { blinks: 0, earTwitches: 0, gazeTargets: new Set(), flips: 0, flipsWhileSearching: 0, celebrations: 0, rigSwaps: 0, squints: 0 };
    this.amb = { blinkAt: 0, blinkStart: -1e9, dbl: false, gz: [0, 0], gzCur: [0, 0], gzAt: 0, gzMode: 'idle', earAt: [0, 0], earStart: [-1e9, -1e9], squintAt: 0, squintStart: -1e9, readAt: 0, readX: 0 };
    this.fxp = []; this.destroyed = false; this.pending = 0; this.sheets = []; this.leftPages = 0; this.sf = 0; this.cvOn = false; this.coverMoving = false; this.followSide = 'R';
  }
  async mount() {
    if (!document.getElementById('hrag-css')) { const s = document.createElement('style'); s.id = 'hrag-css'; s.textContent = CSS; document.head.appendChild(s); }
    const root = this.root = document.createElement('div'); root.className = 'hrag'; root.dataset.open = '0';
    root.innerHTML = `<div class="hrag-panel" role="dialog" aria-label="Chat assistant"></div>
      <button class="hrag-btn" type="button" aria-label="Open assistant chat" aria-expanded="false"><div class="hrag-stage">
        <div class="hrag-rig" data-r="hold"></div><div class="hrag-rig on" data-r="idle"></div>
        <div class="hrag-rig" data-r="happy"></div><div class="hrag-rig" data-r="confused"></div>
        <canvas class="hrag-fx"></canvas></div></button>`;
    this.btn = root.querySelector('.hrag-btn'); this.panel = root.querySelector('.hrag-panel'); this.stage = root.querySelector('.hrag-stage');
    const R = (n) => root.querySelector(`[data-r="${n}"]`); this.rigs = { hold: R('hold'), idle: R('idle'), happy: R('happy'), confused: R('confused') };
    const img = (n) => { const i = new Image(); i.alt = ''; i.draggable = false; i.src = this.o.assets[n]; this.parts.push(i); return i; };
    const idle = this.rigs.idle, hold = this.rigs.hold;
    this.e = {};  // element refs
    const clip = document.createElement('div'); clip.className = 'hrag-clip';
    idle.append(this.e.body = img('idle_body'), clip); clip.append(this.e.book = img('book_closed')); const bc = this.e.bookc = document.createElement('canvas'); bc.className = 'hrag-bookc'; clip.append(bc);
    idle.append(this.e.armL = img('idle_armL'), this.e.armR = img('idle_armR')); [this.e.armL, this.e.armR].forEach((i) => { i.style.filter = 'none'; });   // book sits between body and arms
    const hg = this.e.head = document.createElement('div'); hg.className = 'hrag-grp'; idle.append(hg);
    hg.append(this.e.headImg = img('idle_head'), this.e.earL = img('idle_earL'), this.e.earR = img('idle_earR'), this.e.iEyeL = img('idle_eyeL'), this.e.iEyeR = img('idle_eyeR'));
    [this.e.headImg, this.e.earL, this.e.earR, this.e.iEyeL, this.e.iEyeR].forEach((i) => { i.style.filter = 'none'; });
    hold.append(this.e.hbase = img('hold_base'), this.e.hEyeL = img('hold_eyeL'), this.e.hEyeR = img('hold_eyeR'));
    [this.e.hEyeL, this.e.hEyeR].forEach((i) => { i.style.filter = 'none'; });
    this.e.pages = document.createElement('canvas'); this.e.pages.className = 'hrag-pages'; hold.append(this.e.pages);
    this.rigs.happy.append(img('happy')); this.rigs.confused.append(img('confused'));
    this.fx = root.querySelector('.hrag-fx'); this.fxc = this.fx.getContext('2d');
    await Promise.all(this.parts.map((i) => i.decode ? i.decode().catch(() => {}) : 0));
    if (this.destroyed) return;
    this._buildBase(); this.o.parent.appendChild(root); this._resize();
    this.onResize = () => this._resize(); addEventListener('resize', this.onResize);
    this.btn.addEventListener('click', () => this.dispatch('chatOpened'));
    this.onKey = (e) => { if (e.key === 'Escape' && this.state !== 'idle') this.dispatch('chatClosed'); }; addEventListener('keydown', this.onKey);
    if (this.o.ui) this._buildChat();
    const now = performance.now(); this.amb.blinkAt = now + 1200; this.amb.gzAt = now + 900; this.amb.earAt = [now + 2500, now + 4200]; this.amb.squintAt = now + 6000;
    this.last = now; this.raf = requestAnimationFrame((t) => this._loop(t)); this._setState('idle');
  }
  /* ---------- geometry ---------- */
  _resize() {
    const k = this.k = this.btn.clientWidth / CELL[0]; this.dpr = Math.min(devicePixelRatio || 1, 2);
    const org = (el, x, y) => { el.style.transformOrigin = `${x * k}px ${y * k}px`; };
    org(this.e.head, ...RIG.neck); org(this.e.earL, ...RIG.earL); org(this.e.earR, ...RIG.earR); org(this.e.body, ...RIG.foot); org(this.e.armL, ...RIG.shoulderL); org(this.e.armR, ...RIG.shoulderR); org(this.rigs.happy, 128, 292); org(this.rigs.confused, 128, 292);
    org(this.rigs.hold, 128, 292); org(this.rigs.idle, 128, 292);
    RIG.idleEyes.forEach((c, i) => org([this.e.iEyeL, this.e.iEyeR][i], c[0], c[1] - 3));
    RIG.holdEyes.forEach((c, i) => org([this.e.hEyeL, this.e.hEyeR][i], c[0], c[1] - 3));
    org(this.e.book, RIG.bookSize[0] / 2, RIG.bookSize[1] / 2);
    const bcv = this.e.bookc; bcv.width = Math.round(this.btn.clientWidth * this.dpr); bcv.height = Math.round(this.btn.clientHeight * this.dpr);
    const pg = this.e.pages; pg.width = Math.round(this.btn.clientWidth * this.dpr); pg.height = Math.round(this.btn.clientHeight * this.dpr);
    this.fx.width = Math.round(this.btn.clientWidth * 2.2 * this.dpr); this.fx.height = Math.round(this.btn.clientHeight * 1.9 * this.dpr);
    this.e.book.style.left = '0'; this.e.book.style.top = '0';
  }
  /* ---------- tweens (time based; cancelled by token) ---------- */
  to(tok, ms, target, ef = ease) {
    return new Promise((res) => {
      if (tok !== this.tok) return res(false);
      const from = {}; for (const key in target) from[key] = this.P[key];
      this.tweens.push({ t0: performance.now(), ms: Math.max(1, ms * this.tspd), from, target, ef, res, tok });
    });
  }
  hold(tok, ms) { return this.to(tok, ms, {}); }
  _tick(now) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const w = this.tweens[i];
      if (w.tok !== this.tok) { this.tweens.splice(i, 1); w.res(false); continue; }
      const p = clamp((now - w.t0) / w.ms), e = w.ef(p);
      for (const key in w.target) this.P[key] = lerp(w.from[key], w.target[key], e);
      if (p >= 1) { this.tweens.splice(i, 1); w.res(true); }
    }
  }
  /* ---------- ambient life: blink, gaze, ears, expression, breathing, micro head motion ---------- */
  _ambient(now, dt) {
    const a = this.amb, s = now / 1000, out = {};
    // blink: randomised interval, sometimes a double blink
    if (now >= a.blinkAt) { a.blinkStart = now; this.stats.blinks++; a.dbl = Math.random() < 0.18;
      a.blinkAt = now + (this.rm ? rnd(4500, 9000) : rnd(1900, 5600)); if (a.dbl) a.blinkAt = now + 330; }
    const bt = now - a.blinkStart, BD = 170; let lid = 0;
    if (bt >= 0 && bt < BD) { const u = bt / BD; lid = u < .38 ? ease(u / .38) : 1 - ease((u - .38) / .62); }
    // gaze: natural saccades with smoothing, mode dependent
    const gzList = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -.7], [1, -.7], [-1, .7], [1, .7]];
    const mode = a.gzMode;
    if (now >= a.gzAt) {
      if (mode === 'idle') { const wasC = a.gz[0] === 0 && a.gz[1] === 0;
        a.gz = wasC ? gzList[1 + Math.floor(Math.random() * 8)] : [0, 0]; a.gzAt = now + (wasC ? rnd(550, 1300) : rnd(1500, 4200)); }
      else if (mode === 'reading') { // sweep along a line of text, then next line
        a.readX = a.readX >= 1 ? -1 : a.readX + 0.5; const glance = Math.random() < 0.09;
        a.gz = glance ? [0, -0.5] : [a.readX, 0.75]; a.gzAt = now + (glance ? rnd(600, 900) : rnd(260, 520)); }
      else if (mode === 'searching') { a.readX = a.readX >= 1 ? -1 : a.readX + 0.67; a.gz = [a.readX, 0.55 + 0.3 * Math.sin(now / 400)]; a.gzAt = now + rnd(170, 300) * this.speed; }
      else if (mode === 'rest') { const r = Math.random(); a.gz = r < .55 ? [0, 0.35] : r < .75 ? [0, -0.3] : [Math.random() < .5 ? -.8 : .8, .4]; a.gzAt = now + rnd(900, 2200); }
      else if (mode === 'wait') { const r = Math.random(); a.gz = r < .5 ? [0, -.1] : r < .68 ? [.7, 0] : r < .84 ? [-.7, 0] : r < .93 ? [0, -.6] : [0, .5]; a.gzAt = now + rnd(1000, 2400); }
      else if (mode === 'bookwait') { const r = Math.random(); a.gz = r < .62 ? [rnd(-.7, .7), .7] : r < .82 ? [0, -.15] : [rnd(-.4, .4), .45]; a.gzAt = now + rnd(1100, 2800); }
      else if (mode === 'user') { a.gz = [0, -0.25]; a.gzAt = now + 400; }
      else if (mode === 'down') { a.gz = [Math.sin(now / 700) * .4, 1]; a.gzAt = now + 500; }
      this.stats.gazeTargets.add(a.gz.join(','));
    }
    const gk = 1 - Math.exp(-dt / 55 * (mode === 'searching' ? 1.8 : 1));
    a.gzCur[0] += (a.gz[0] - a.gzCur[0]) * gk; a.gzCur[1] += (a.gz[1] - a.gzCur[1]) * gk;
    // small expression change: smile squint
    if (now >= a.squintAt) { a.squintStart = now; this.stats.squints++; a.squintAt = now + rnd(7000, 14000); }
    const sq = now - a.squintStart < 900 ? Math.sin(clamp((now - a.squintStart) / 900) * Math.PI) : 0;
    // ears: occasional independent twitches
    const ear = [0, 0];
    for (let i = 0; i < 2; i++) {
      if (now >= a.earAt[i]) { a.earStart[i] = now; this.stats.earTwitches++; a.earAt[i] = now + rnd(3500, 9000); }
      const u = (now - a.earStart[i]) / 380; if (u >= 0 && u < 1) ear[i] = Math.sin(u * Math.PI) * (1 - u * .4) * (i ? 5.5 : -5.5) + Math.sin(u * Math.PI * 3) * 1.1 * (i ? 1 : -1);
    }
    out.lid = lid; out.sq = sq; out.ear = ear;
    out.br = Math.sin(s * 2 * Math.PI / 3.8);                                       // breathing
    out.swayRot = this.amp * (0.9 * Math.sin(s * .53) + 0.55 * Math.sin(s * 1.17 + 1.3));   // tiny head movement
    out.swayX = this.amp * 0.8 * Math.sin(s * .41 + .7);
    out.swayY = this.amp * 0.5 * Math.sin(s * .67);
    return out;
  }
  /* ---------- render ---------- */
  _loop(now) {
    if (this.destroyed) return;
    const dt = Math.min(now - this.last, 80); this.last = now;
    this._tick(now); const A = this._ambient(now, dt), P = this.P, k = this.k, t = (x, y, r = 0, sx = 1, sy = 1) => `translate(${x * k}px,${y * k}px) rotate(${r}deg) scale(${sx},${sy})`;
    const BKF = this._bookFrame(now, dt);
    const eyeS = P.eyeS * (1 - A.lid * .92) * (1 - A.sq * .38), lookAmp = 3.3, gw = BKF.gw;
    const dx = (A.lid > .5 ? 0 : 1) * (lerp(this.amb.gzCur[0], BKF.gx, gw) + P.lookX * (1 - gw)) * lookAmp, dy = (lerp(this.amb.gzCur[1], BKF.gy, gw) + P.lookY * (1 - gw)) * (lookAmp - .4) + A.sq * -1.2 + (A.lid * 1.2);
    // idle rig
    this.e.body.style.transform = t(0, P.bodyY + A.br * .35, 0, 1 + A.br * .004, P.bodySY * (1 + A.br * .012));
    const sdrop = (CELL[1] - 2 - 222) * (1 - P.bodySY * (1 + A.br * .012)) + P.bodyY + A.br * .35, ar = P.arm;
    const aL = this._arm(0, BKF.tL, P.ikL, 55 * ar, 1 + .3 * ar, sdrop), aR = this._arm(1, BKF.tR, P.ikR, -55 * ar, 1 + .3 * ar, sdrop);   // paws reach for real targets (cover edge / page edge / hold)
    this._dbg = { tL: BKF.tL, tR: BKF.tR, aL, aR, sdrop }; this.e.armL.style.transform = t(0, sdrop, aL[0], aL[1], aL[1]); this.e.armR.style.transform = t(0, sdrop, aR[0], aR[1], aR[1]);
    this.e.head.style.transform = t(P.headX + A.swayX, P.headY + A.swayY + A.br * .5, P.headRot + A.swayRot, 1, 1);
    this.e.earL.style.transform = t(0, 0, P.earL + A.ear[0]); this.e.earR.style.transform = t(0, 0, P.earR + A.ear[1]);
    const eyeT = `translate(${dx * k}px,${dy * k}px) scale(${1 + (P.eyeS - 1) * .4},${eyeS})`; this.e.iEyeL.style.transform = eyeT; this.e.iEyeR.style.transform = eyeT;
    // hold rig (head nods / reading sway through the whole rig)
    this.e.hEyeL.style.transform = eyeT; this.e.hEyeR.style.transform = eyeT;
    this.rigs.hold.style.transform = t(A.swayX * .5, A.swayY * .6 + A.br * .3, P.stageRot + A.swayRot * .6, 1 + A.br * .003, P.stageSY * (1 + A.br * .01));
    this.rigs.idle.style.transform = 'none';
    const fl = t(A.swayX * .3, A.br * .35, A.swayRot * .4, 1 + A.br * .003, 1 + A.br * .012); this.rigs.happy.style.transform = fl; this.rigs.confused.style.transform = fl;   // celebration pose keeps breathing
    this.stage.style.transform = t(0, P.stageY, 0, 1, 1);
    // book layer
    const bk = this.e.book; bk.style.opacity = P.bookA; bk.style.transform = t(RIG.bookRest[0] - RIG.bookSize[0] / 2, RIG.bookRest[1] - RIG.bookSize[1] / 2 + P.bookY, P.bookRot, P.bookS, P.bookS);
    this._drawBook(now); this._drawFx(now, dt);
    this.raf = requestAnimationFrame((n) => this._loop(n));
  }
  /* ---------- layered 2D book: base (back cover + spine + page edges), right page, left page, flipping sheets, front cover on its hinge ---------- */
  _buildBase() {
    const art = this.e.book, cv = this.baseCv = document.createElement('canvas'); cv.width = 143 * 3; cv.height = 60 * 3; const g = cv.getContext('2d'); g.scale(3, 3); g.drawImage(art, 0, 0, 143, 60);
    const { A, E1, E2 } = BK, P = [A, [A[0] + E1[0], A[1] + E1[1]], [A[0] + E1[0] + E2[0], A[1] + E1[1] + E2[1]], [A[0] + E2[0], A[1] + E2[1]]];
    const cx = P.reduce((s2, p) => s2 + p[0], 0) / 4, cy = P.reduce((s2, p) => s2 + p[1], 0) / 4;
    g.globalCompositeOperation = 'destination-out'; g.beginPath();
    P.forEach((p, i) => { const dx = cx - p[0], dy = cy - p[1], d = Math.hypot(dx, dy), q = [p[0] + dx / d * 1.1, p[1] + dy / d * 1.1]; i ? g.lineTo(...q) : g.moveTo(...q); });
    g.closePath(); g.fill();                       // the cover's top face leaves the base; the cover layer redraws it (identical at rest)
  }
  _tc(p) { const P = this.P, sc = P.bsc; return [135 + P.bx + (p[0] - 71.5) * sc, 252 + P.by + (p[1] - 30) * sc]; }   // art coords -> cell coords
  _coverEdge(phi) { const { A, E1, E2, Z } = BK; return [A[0] + E1[0] * Math.cos(phi) + E2[0] * .8, A[1] + E1[1] * Math.cos(phi) - Z * Math.sin(phi) + E2[1] * .8]; }
  _sheetEdge(phi) { const { A, E1, E2, Zp } = BK; return [A[0] + E1[0] * Math.cos(phi) + E2[0] * .55, A[1] + 2.4 + E1[1] * Math.cos(phi) - Zp * Math.sin(phi) + E2[1] * .55]; }
  _arm(side, T, ik, defRot, defSc, sdrop) {   // inverse kinematics for the arm layers: rotate/scale about the shoulder so the paw reaches T
    const arm = side ? { S: [184, 222], a0: 159.1, L0: 45 } : { S: [82, 222], a0: 21.8, L0: 43 };
    if (!T || ik <= 0.001) return [defRot, defSc];
    const vx = T[0] - arm.S[0], vy = T[1] - (arm.S[1] + sdrop); let rot = Math.atan2(vy, vx) * 180 / Math.PI - arm.a0; rot = ((rot + 540) % 360) - 180;
    const sc = clamp(Math.hypot(vx, vy) / arm.L0, .7, 1.7); return [lerp(defRot, rot, ik), lerp(defSc, sc, ik)];
  }
  _bookFrame(now, dt) {
    const P = this.P, out = { gw: 0, gx: 0, gy: .6, tL: null, tR: null };
    for (let i = this.sheets.length - 1; i >= 0; i--) {
      const sh = this.sheets[i], p = clamp((now - sh.t0) / sh.ms); sh.phi = sh.dir > 0 ? Math.PI * ease(p) : Math.PI * (1 - ease(p));
      if (p >= 1) { this.sheets.splice(i, 1); this.leftPages = Math.max(0, this.leftPages + (sh.dir > 0 ? 1 : -1)); sh.res?.(); }
    }
    const sh0 = this.sheets[0]; this.sf += ((sh0 ? 1 : 0) - this.sf) * (1 - Math.exp(-dt / 110));
    if (!this.cvOn) return out;
    const ph = P.cover, hL = [lerp(42, -30, ph), lerp(35, 40, ph)], hR = [lerp(128, 120, ph), lerp(30, 32, ph)];
    let trk = null, w = 0;
    if (this.coverMoving) { trk = this._tc(this._coverEdge(Math.PI * clamp(ph))); w = P.rFollow; }
    else if (sh0) { trk = this._tc(this._sheetEdge(sh0.phi)); w = this.sf * clamp((2.45 - sh0.phi) / .6); }
    const tL = this._tc(hL), tR = this._tc(hR), side = this.coverMoving ? this.followSide : 'R';
    out.tL = side === 'L' && trk ? [lerp(tL[0], trk[0], w), lerp(tL[1], trk[1], w)] : tL;
    out.tR = side === 'R' && trk ? [lerp(tR[0], trk[0], w), lerp(tR[1], trk[1], w)] : tR;
    const gT = this.coverMoving ? trk : (sh0 ? this._tc(this._sheetEdge(sh0.phi)) : this._tc([75, 22])), gwant = Math.max(this.coverMoving ? P.gzB : 0, sh0 ? this.sf * .85 : 0, this.coverMoving ? 0 : P.gzB);
    out.gw = gT ? gwant : 0; if (gT) { out.gx = clamp((gT[0] - 128) / 45, -1, 1); out.gy = clamp((gT[1] - 165) / 30, .25, 1.15); }
    return out;
  }
  _drawBook(now) {
    const c = this.e.bookc, g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    if (!this.cvOn || !this.baseCv) return;
    const P = this.P, k = this.k * this.dpr, sc = P.bsc, { A, E1, E2, Z, Zp } = BK; g.setTransform(k * sc, 0, 0, k * sc, k * (135 + P.bx - 71.5 * sc), k * (252 + P.by - 30 * sc));
    const add = (p, v, m = 1) => [p[0] + v[0] * m, p[1] + v[1] * m], phi = Math.PI * clamp(P.cover), open = P.cover > .003, off = [0, 2.4];
    const path = (p0, v1, v2) => { g.beginPath(); g.moveTo(...p0); g.lineTo(...add(p0, v1)); g.lineTo(...add(add(p0, v1), v2)); g.lineTo(...add(p0, v2)); g.closePath(); };
    const lines = (p0, v1, v2) => { g.strokeStyle = 'rgba(70,100,165,.5)'; g.lineWidth = .9; for (let i = 0; i < 6; i++) { const t = .12 + i * .152, q = add(p0, v2, t); g.beginPath(); g.moveTo(...add(q, v1, .1)); g.lineTo(...add(q, v1, .9)); g.stroke(); } };
    const page = (p0, v1, v2) => { path(p0, v1, v2); const gr = g.createLinearGradient(p0[0], p0[1], p0[0] + v1[0], p0[1] + v1[1]); gr.addColorStop(0, '#d9e4fa'); gr.addColorStop(.3, '#fbfdff'); gr.addColorStop(1, '#f1f6ff'); g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(25,50,125,.75)'; g.lineWidth = 1; g.lineJoin = 'round'; g.stroke(); lines(p0, v1, v2); };
    const cover = () => {
      const E1p = [E1[0] * Math.cos(phi), E1[1] * Math.cos(phi) - Z * Math.sin(phi)];
      if (phi <= Math.PI / 2 + .001) {                                         // outer face: the art's cover, mapped onto the rotating quad
        const det = E1[0] * E2[1] - E2[0] * E1[1], a = (E1p[0] * E2[1] - E2[0] * E1p[1]) / det, cc = E2[0] * (E1[0] - E1p[0]) / det, b = E2[1] * (E1p[1] - E1[1]) / det, d = (E2[1] * E1[0] - E1p[1] * E2[0]) / det;
        g.save(); g.transform(a, b, cc, d, A[0] - (a * A[0] + cc * A[1]), A[1] - (b * A[0] + d * A[1]));
        g.beginPath(); g.moveTo(...A); g.lineTo(...add(A, E1)); g.lineTo(...add(add(A, E1), E2)); g.lineTo(...add(A, E2)); g.closePath(); g.clip(); g.drawImage(this.e.book, 0, 0, 143, 60); g.restore();
        if (phi > .02) { path(A, E1p, E2); g.fillStyle = `rgba(5,20,90,${.3 * Math.sin(phi)})`; g.fill(); }
      } else {                                                                 // inner face of the cover (lining) once it is past vertical
        path(A, E1p, E2); const gr = g.createLinearGradient(A[0], A[1], A[0] + E1p[0], A[1] + E1p[1]); gr.addColorStop(0, '#c8d8f7'); gr.addColorStop(1, '#e7efff'); g.fillStyle = gr; g.fill();
        g.strokeStyle = '#10285f'; g.lineWidth = 1.7; g.lineJoin = 'round'; g.stroke(); path(add(add(A, E1p, .07), E2, .08), [E1p[0] * .86, E1p[1] * .86], [E2[0] * .84, E2[1] * .84]); g.strokeStyle = 'rgba(40,80,170,.45)'; g.lineWidth = .8; g.stroke();
      }
      if (phi > .08) { g.strokeStyle = '#0d2152'; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(...add(A, E1p)); g.lineTo(...add(add(A, E1p), E2)); g.stroke(); }   // cover thickness on its free edge
    };
    g.drawImage(this.baseCv, 0, 0, 143, 60);                                    // back cover + spine + page edges (from the art)
    if (!open) { cover(); return; }
    if (P.cover > .55) {                                                         // left stack edge, appears as the book opens
      const st = [add(add(A, E2, 1), [0, 2.4]), add(add(A, E2, 1), [0, 2.4])]; g.save(); g.globalAlpha = clamp((P.cover - .55) / .3);
      g.beginPath(); g.moveTo(A[0] + E2[0], A[1] + E2[1] + 2.4); g.lineTo(A[0] + E2[0] - E1[0], A[1] + E2[1] - E1[1] + 2.4); g.lineTo(A[0] + E2[0] - E1[0], A[1] + E2[1] - E1[1] + 8); g.lineTo(A[0] + E2[0], A[1] + E2[1] + 8); g.closePath();
      const gr = g.createLinearGradient(0, A[1] + 30, 0, A[1] + 50); gr.addColorStop(0, '#f6f9ff'); gr.addColorStop(1, '#c9d6f2'); g.fillStyle = gr; g.fill(); g.strokeStyle = '#0d2152'; g.lineWidth = 1.2; g.stroke(); g.restore();
    }
    page(add(add(add(A, off), E2, .035), E1, .03), [E1[0] * .94, E1[1] * .94], [E2[0] * .93, E2[1] * .93]);   // right page (visible as soon as the cover lifts)
    const openLeft = P.cover >= .985;
    if (!openLeft) cover();
    else {
      cover();                                                                   // cover lies open on the left (its lining is the left page)
      if (this.leftPages > 0) page(add(add(add(A, off), E2, .035), E1, -.03), [-E1[0] * .94, -E1[1] * .94], [E2[0] * .93, E2[1] * .93]);   // pages already turned
    }
    for (const sh of this.sheets) {                                              // turning sheets hinge on the same spine
      const ph = sh.phi, E1s = [E1[0] * Math.cos(ph), E1[1] * Math.cos(ph) - Zp * Math.sin(ph)];
      page(add(add(A, off), E2, .035), [E1s[0] * .96, E1s[1] * .96], [E2[0] * .93, E2[1] * .93]);
      path(add(add(A, off), E2, .035), E1s, [E2[0] * .93, E2[1] * .93]); g.fillStyle = `rgba(10,30,110,${.22 * Math.sin(ph)})`; g.fill();
    }
  }
  _burst() {
    if (this.rm) return; const cols = ['#ff6fa8', '#3b82f6', '#ffc933', '#7ee0a8', '#ff9a3c'];
    for (let i = 0; i < 34; i++) this.fxp.push({ x: 128 + rnd(-30, 30), y: 120 + rnd(-20, 10), vx: rnd(-90, 90), vy: rnd(-190, -60), r: rnd(0, 6), vr: rnd(-8, 8), c: cols[i % 5], s: rnd(3, 6), age: 0, life: rnd(900, 1500), star: i % 4 === 0 });
    this.stats.bursts = (this.stats.bursts || 0) + 1;
  }
  _drawFx(now, dt) {
    const c = this.fx, g = this.fxc; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); if (!this.fxp.length) return;
    const k = this.k * this.dpr; g.setTransform(k, 0, 0, k, 0.6 * CELL[0] * k, 0.7 * CELL[1] * k);
    const s = dt / 1000; this.fxp = this.fxp.filter((p) => (p.age += dt) < p.life);
    for (const p of this.fxp) { p.vy += 260 * s; p.x += p.vx * s; p.y += p.vy * s; p.r += p.vr * s; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.globalAlpha = clamp(1 - p.age / p.life + .15); g.fillStyle = p.c;
      if (p.star) { g.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? p.s * .45 : p.s * 1.2, a = i * Math.PI / 4; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); } else g.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .66); g.restore(); }
  }
  /* ---------- rigs (state boundaries only) ---------- */
  _rig(mode) {      // incoming pose fades in over the (still opaque) outgoing one, so there is never a see-through double image
    if (mode === this.rigMode) return; const prev = this.rigs[this.rigMode]; this.rigMode = mode; this.stats.rigSwaps++;
    const n = this.rigs[mode]; this.zc = (this.zc || 1) + 1; n.style.zIndex = this.zc; n.classList.add('on');
    clearTimeout(prev._t); prev._t = setTimeout(() => { if (this.rigs[this.rigMode] !== prev) prev.classList.remove('on'); }, this.rm ? 10 : 180);
  }
  _flipPage(ms = 560, dir = 1) { return new Promise((res) => { this.stats.flips++; if (this.state === 'searching_and_turning_pages') this.stats.flipsWhileSearching++; this.sheets.push({ t0: performance.now(), ms: ms * this.tspd, dir, phi: dir > 0 ? 0 : Math.PI, res }); }); }
  /* ---------- state machine ---------- */
  _setState(s) { this.state = s; this.log.push([s, Math.round(performance.now())]); this.root.dataset.state = s; if (this.log.length > 400) this.log.shift(); }
  _gz(m) { this.amb.gzMode = m; this.amb.gzAt = 0; }
  dispatch(evt, p) {
    if (this.destroyed || !this.root) return;
    if (this.lock && evt !== 'typingStopped' && evt !== 'typing') { this.queue.push([evt, p]); return; }
    switch (evt) {
      case 'chatOpened': return this._open(); case 'chatClosed': return this._close();
      case 'typing': return this._typing(); case 'typingStopped': return this._typingStopped();
      case 'submitted': this.pending++; return this._search(); case 'retrieving': this.speed = .9; return; case 'generating': this.speed = 1.35; return;
      case 'answerReceived': this.pending = Math.max(0, this.pending - 1); if (this.pending > 0) return; return this._found();
      case 'requestFailed': this.pending = Math.max(0, this.pending - 1); if (this.pending > 0) return; return this._error();
    }
  }
  async _flush() { const q = this.queue.splice(0); for (const [e, p] of q) this.dispatch(e, p); }
  async _open() {
    if (this.state !== 'idle') return; this.lock = true; const tok = ++this.tok, S = (x) => this._setState(x); this.speed = 1; this.pending = 0; this.fxp = [];
    Object.assign(this.P, { bookY: 78, bookRot: -8, bookS: .92, bookA: 1, arm: 0, cover: 0, bx: 0, by: 0, bsc: 1, ikL: 0, ikR: 0, gzB: 0, rFollow: 0 }); this.sheets = []; this.leftPages = 0; this.cvOn = false;
    S('picking_up_book'); this._gz('user');                                                // notice -> look down -> bend -> reach -> grab -> lift (unchanged)
    if (!await this.to(tok, 380, { earL: -7, earR: 7, eyeS: 1.14, bodyY: -3 })) return;
    this._gz('down');
    if (!await this.to(tok, 560, { headY: 8, headRot: 6, bodySY: .955, earL: 4, earR: -4, eyeS: 1, bodyY: 0, lookY: .9, arm: .4 })) return;
    if (!await this.to(tok, 520, { headY: 12, headRot: 8, bodySY: .935, lookY: 1, arm: 1 })) return;
    if (!await this.to(tok, 220, { bookY: 68, bookRot: -9, bookS: .95 })) return;
    this._gz('rest');
    if (!await this.to(tok, 950, { arm: 0, bookY: 0, bookRot: 0, bookS: 1, headY: 0, headRot: 0, bodySY: 1, lookY: .4, earL: 0, earR: 0 })) return;
    S('holding_closed_book'); this._setOpen(true); this._gz('wait'); this.cvOn = true; this.P.bookA = 0;   // chat opens; the art book hands over to the layered book (identical pixels at rest)
    if (!await this.to(tok, 700, { lookY: 0, eyeS: 1 })) return;
    if (!await this._openBook(tok)) return;
    this._setState('waiting_for_question'); this._gz('bookwait'); this.lock = false; this._flush();   // book is OPEN; no searching until a question is submitted
  }
  async _openBook(tok) {      // continuous: look down, paws adjust, one paw takes the cover and the cover turns on its spine
    this._setState('opening_book'); this.cvOn = true; this.P.bookA = 0; this.followSide = 'R'; this._gz('down');
    // 1. looks down at the closed book; the left paw adjusts to hold the bottom (spine side) firmly
    if (!(await Promise.all([this.to(tok, 650, { headY: 5, headRot: 3, lookY: .8, ikL: 1, gzB: 1 }), this.to(tok, 300, { eyeS: 1 })])).every(Boolean)) return false;
    // 2. the other paw slowly moves to the front cover and gently takes hold of it (eyes follow the paw)
    this.coverMoving = true;
    if (!await this.to(tok, 800, { ikR: 1, rFollow: 1 })) return false;
    if (!await this.hold(tok, 280)) return false;
    // 3. lifts the cover; it rotates on the spine while the paw keeps contact and the eyes follow the cover edge
    if (!await this.to(tok, 1200, { cover: .6, bx: 15, bsc: .97, by: -3, headRot: 1.8, headY: 4.5 })) return false;
    // 4. past vertical the paw lets go and the cover falls open by itself; the inside pages are revealed progressively
    if (!(await Promise.all([this.to(tok, 750, { cover: 1, bx: 18, bsc: .95, by: -6 }, easeOut), this.to(tok, 550, { rFollow: 0, gzB: 0 })])).every(Boolean)) return false;
    this.coverMoving = false;
    // 5. curious look at the open book, paws settle on the pages, natural reading position
    this._gz('bookwait');
    if (!await this.to(tok, 380, { earL: -4, earR: 4, headY: 2.5, headRot: .6, lookY: .4 })) return false;
    if (!await this.hold(tok, 260)) return false;
    return await this.to(tok, 380, { earL: 0, earR: 0 });
  }
  async _closeBook(tok) {     // reverse: pages go back, the left paw lifts the cover, it swings shut on the spine
    this._gz('down'); if (!await this.to(tok, 320, { headY: 5, headRot: 3, lookY: .8 })) return false;
    const n = Math.min(this.leftPages, 3); for (let i = 0; i < n; i++) { await this._flipPage(340, -1); if (tok !== this.tok) return false; }
    this.leftPages = 0; this.followSide = 'L'; this.coverMoving = true;
    if (!await this.to(tok, 500, { ikL: 1, rFollow: 1, gzB: 1 })) return false;
    if (!await this.to(tok, 950, { cover: .62 })) return false;
    if (!(await Promise.all([this.to(tok, 700, { cover: 0, bx: 0, bsc: 1, by: 0 }, easeIn), this.to(tok, 500, { rFollow: 0, gzB: 0 })])).every(Boolean)) return false;
    this.coverMoving = false; this.cvOn = false; this.P.bookA = 1;                          // closed again: hands the book back to the art layer (identical at rest)
    return true;
  }
  async _close() {
    if (['idle', 'returning_to_idle', 'closing_book', 'putting_book_down'].includes(this.state)) return;
    this.lock = true; const tok = ++this.tok, S = (x) => this._setState(x); this.typing = false; clearTimeout(this.typingT); clearTimeout(this.turnT);
    this.fxp = []; this.speed = 1; this.pending = 0;
    S('closing_book'); this._setOpen(false); this._gz('down');
    if (this.rigMode !== 'idle') { this._rig('idle'); Object.assign(this.P, { stageY: 0, stageRot: 0, eyeS: 1, lookY: .5, headY: 3, headRot: 1 }); if (!await this.hold(tok, 200)) return; }   // from the celebration / confused pose
    if (this.P.cover > .02) { while (this.sheets.length) await this.hold(tok, 60); if (!await this._closeBook(tok)) return; }
    else if (!await this.to(tok, 320, { lookY: 1, headY: 3, headRot: 2, bodySY: .99, eyeS: 1 })) return;
    if (!await this.hold(tok, 200)) return;
    S('putting_book_down');                                                                // bends and lowers the book with its arms
    if (!await this.to(tok, 520, { headY: 10, headRot: 7, bodySY: .94, arm: 1, ikL: 0, ikR: 0, bookY: 66, bookRot: -8, bookS: .96, lookY: 1 })) return;
    if (!await this.to(tok, 380, { bookY: 78, bookRot: -9, bookS: .93 })) return;          // lets go: the book rests underneath again
    S('returning_to_idle'); this._gz('idle');
    if (!await this.to(tok, 700, { arm: 0, headY: 0, headRot: 0, bodySY: 1, lookY: 0, lookX: 0, earL: 0, earR: 0, eyeS: 1, stageY: 0, stageRot: 0, bodyY: 0, ikL: 0, ikR: 0 })) return;
    this._setState('idle'); this.lock = false; this._flush();
  }
  _typing() {
    if (!['waiting_for_question', 'error_reaction'].includes(this.state) || this.P.cover < .99) return;   // the celebration pose is held while the user types
    clearTimeout(this.typingT); this.typingT = setTimeout(() => this._typingStopped(), 1600);
    if (this.typing) return; this.typing = true; this._gz('reading'); this.to(this.tok, 380, { headY: 4, headRot: 2, lookY: .3 }); this._schedTurn();
  }
  _typingStopped() { if (!this.typing) return; this.typing = false; clearTimeout(this.turnT); if (this.state === 'waiting_for_question') { this._gz('bookwait'); this.to(this.tok, 400, { headY: 2.5, headRot: .6, lookY: .4 }); } }
  _schedTurn() { clearTimeout(this.turnT); this.turnT = setTimeout(async () => { if (!this.typing || this.state !== 'waiting_for_question') return; await this._flipPage(650); this._schedTurn(); }, rnd(2000, 3800)); }
  async _search() {
    if (!['waiting_for_question', 'error_reaction', 'celebrating', 'answer_found', 'waiting_for_next_question'].includes(this.state)) return;
    this.typing = false; clearTimeout(this.typingT); clearTimeout(this.turnT); const tok = ++this.tok; this.speed = 1; this.fxp = [];
    if (this.rigMode !== 'idle') { this._rig('idle'); Object.assign(this.P, { stageY: 0, stageRot: 0, eyeS: 1, lookY: .4, headY: 3, headRot: 1 }); }   // from the happy / confused pose back to the open book
    if (this.P.cover < .99 && !await this._openBook(tok)) return;
    this._setState('searching_and_turning_pages'); this._gz('user');
    if (!await this.to(tok, 260, { eyeS: 1.05, headY: 4, headRot: 2, lookY: .5 })) return;   // attentive, lowers its head toward the pages
    this._gz('searching'); this.P.eyeS = 1;
    while (tok === this.tok && !this.destroyed) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) { if (tok !== this.tok) return; await this._flipPage(rnd(480, 600) * this.speed); if (!await this.hold(tok, rnd(110, 260) * this.speed)) return; }
      this._gz('reading'); if (!await this.hold(tok, rnd(800, 1300) * this.speed)) return; this._gz('searching');   // pause to read
    }
  }
  async _found() {      // event-driven: only after a real answer while searching; stays in the celebration pose until the next question
    if (!['searching_and_turning_pages', 'opening_book'].includes(this.state)) return; const tok = ++this.tok; this.flip = null;
    this._setState('answer_found'); this._gz('user');
    if (!await this.to(tok, 340, { stageRot: -.5, stageY: -2, eyeS: 1.22, lookY: -.5 })) return;
    this._setState('celebrating'); this.stats.celebrations++; this._rig('happy'); this._burst();
    const t0 = performance.now(), D = 1300 * this.tspd;
    await new Promise((res) => { const step = (now) => { if (tok !== this.tok) return res(false); const u = clamp((now - t0) / D);
      if (!this.rm) this.P.stageY = -Math.abs(Math.sin(u * Math.PI * 2.5)) * 15 * (1 - u * .5);
      u < 1 ? requestAnimationFrame(step) : res(true); }; requestAnimationFrame(step); });
    if (tok !== this.tok) return; Object.assign(this.P, { stageY: 0, stageRot: 0, eyeS: 1, lookY: 0 }); this._gz('idle');
    this._setState('waiting_for_next_question');      // no timer back to idle / reading: it keeps the happy pose until 'submitted'
  }
  async _error() {
    if (!['searching_and_turning_pages', 'opening_book'].includes(this.state)) return; const tok = ++this.tok; this._setState('error_reaction'); this.P.eyeS = 1;
    this._rig('confused'); if (!await this.hold(tok, 1500)) return;
    this._rig('idle'); this._gz('down'); Object.assign(this.P, { lookY: .5, headY: 4, headRot: 2 });       // looks back into the book, thinking / retrying
    for (let i = 0; i < 2; i++) { if (!await this.hold(tok, 700)) return; await this._flipPage(950); }
    if (tok !== this.tok) return; this._gz('bookwait'); await this.to(tok, 500, { headY: 2.5, headRot: .6, lookY: .4 }); if (tok === this.tok) this._setState('waiting_for_question');
  }
  _setOpen(v) {
    this.root.dataset.open = v ? '1' : '0'; this.btn.setAttribute('aria-expanded', String(v));
    this.btn.setAttribute('aria-label', v ? 'Assistant chat is open' : 'Open assistant chat'); this.o.onOpenChange?.(v);
    if (this.o.ui) { if (v) setTimeout(() => this.input?.focus({ preventScroll: true }), 120); else this.btn.focus({ preventScroll: true }); }
  }
  /* ---------- built-in chat UI (emits events; the RAG call is the host's onAsk) ---------- */
  _buildChat() {
    const p = this.panel;
    p.innerHTML = `<div class="hrag-head"><span></span><button class="hrag-x" type="button" aria-label="Close chat">×</button></div><div class="hrag-msgs" aria-live="polite"></div>
      <form class="hrag-form"><input class="hrag-in" type="text" autocomplete="off" placeholder="Type your question…" aria-label="Your question"><button class="hrag-send" type="submit">Send</button></form>`;
    p.querySelector('.hrag-head span').textContent = this.o.title; this.msgs = p.querySelector('.hrag-msgs'); this.input = p.querySelector('.hrag-in'); this.sendBtn = p.querySelector('.hrag-send');
    p.querySelector('.hrag-x').addEventListener('click', () => this.dispatch('chatClosed'));
    this.input.addEventListener('input', () => { if (this.input.value) this.dispatch('typing'); });
    p.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); this._send(); });
  }
  _add(cls, text) { const d = document.createElement('div'); d.className = 'hrag-m ' + cls; if (text) d.textContent = text; this.msgs.appendChild(d); this.msgs.scrollTop = this.msgs.scrollHeight; return d; }
  async _send() {
    const q = this.input.value.trim(); if (!q || this.busy) return;
    this.busy = true; this.input.value = ''; this.input.disabled = this.sendBtn.disabled = true; this._add('u', q);
    const wait = this._add('b'); wait.innerHTML = '<span class="hrag-dots"><i></i><i></i><i></i></span>';
    this.dispatch('submitted'); this.dispatch('retrieving');
    try { if (!this.o.onAsk) throw new Error('No onAsk handler configured.'); const a = await this.o.onAsk(q, { onStage: (s) => this.dispatch(s) }); wait.textContent = a; this.dispatch('answerReceived'); }
    catch (err) { wait.className = 'hrag-m e'; wait.setAttribute('role', 'alert'); wait.textContent = 'Something went wrong: ' + (err?.message || 'request failed') + ' You can try again.'; this.dispatch('requestFailed'); }
    finally { this.busy = false; this.input.disabled = this.sendBtn.disabled = false; this.msgs.scrollTop = this.msgs.scrollHeight; if (this.state !== 'idle') this.input.focus({ preventScroll: true }); }
  }
  destroy() { this.destroyed = true; cancelAnimationFrame(this.raf); clearTimeout(this.typingT); clearTimeout(this.turnT); removeEventListener('resize', this.onResize); removeEventListener('keydown', this.onKey); this.root?.remove(); }
}
