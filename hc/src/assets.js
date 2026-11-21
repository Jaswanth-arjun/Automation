/** Loads sprite sheets and tracks which animations are really available. */
export class SpriteAssets {
  /** @param manifest see sprites.manifest.js */
  constructor(manifest, animations, onChange = () => {}) {
    this.manifest = manifest; this.animations = animations; this.onChange = onChange;
    this.sheets = new Map();      // id -> { img, fw, fh, columns }
    this.props = new Map();
    this.failed = new Set();
    this.dead = false;
  }
  has = (id) => this.sheets.has(id);
  load() {
    const { cell, sheets = {}, props = {} } = this.manifest;
    const jobs = [];
    // load 'sit' first so something shows up quickly
    const ids = Object.keys(this.animations).sort((a, b) => (b === 'sit') - (a === 'sit'));
    const derived = [];
    for (const id of ids) {
      const def = sheets[id]; if (def?.sameAs) { derived.push([id, def]); continue; }
      if (!def || (!def.url && !def.image)) { this.failed.add(id); continue; }
      jobs.push(this._img(def).then(img => {
        if (this.dead) return;
        const a = this.animations[id], columns = def.columns ?? 4, rows = Math.ceil(a.frames / columns);
        const fw = def.frameW ?? cell.w, fh = def.frameH ?? cell.h;
        if (img.width < columns * fw - 1 || img.height < rows * fh - 1 && !def.image)
          console.warn(`[hamster] sheet "${id}" is ${img.width}x${img.height}, expected ${columns * fw}x${rows * fh}`);
        this.sheets.set(id, { img, fw, fh, columns, frames: Math.min(def.frames ?? a.frames, a.frames) }); this.onChange(id);
      }).catch(() => { this.failed.add(id); console.warn(`[hamster] sheet "${id}" not loaded - behaviors using it are disabled`); }));
    }
    // derived sheets re-use frames of another sheet (e.g. 'walkPause' = frame 1 of 'walking'): no extra image
    const deriveAll = () => { for (const [id, def] of derived) { const src = this.sheets.get(def.sameAs); if (src) this.sheets.set(id, { ...src, frames: def.frameMap.length, map: def.frameMap }); else this.failed.add(id); } };
    for (const [id, def] of Object.entries(props)) if (def && (def.url || def.image))
      jobs.push(this._img(def).then(img => !this.dead && this.props.set(id, { img, ...def })).catch(() => {}));
    return Promise.all(jobs).then(() => { deriveAll(); this.onChange(); });
  }
  _img(def) {
    if (def.image) return Promise.resolve(def.image);      // canvas / ImageBitmap (placeholders)
    return new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = def.url; });
  }
  destroy() { this.dead = true; this.sheets.clear(); this.props.clear(); }
}
