import { ANIMATIONS } from './animations.config.js';
import { HamsterEngine } from './HamsterEngine.js';
import { createPlaceholderManifest } from './placeholders.js';
import defaultManifest from './sprites.manifest.js';
export { default as HamsterCompanion } from './HamsterCompanion.jsx';
export { ANIMATIONS, BEHAVIORS, CYCLE } from './animations.config.js';
export { createManifest } from './sprites.manifest.js';
/** Framework-free mount. Returns the engine (call .destroy() to remove). */
export function mountHamster({ container = document.body, placeholders = true, manifest, ...opts } = {}) {
  const e = new HamsterEngine(container, { manifest: manifest ?? (placeholders ? createPlaceholderManifest(ANIMATIONS) : defaultManifest), ...opts });
  e.start(); return e;
}
