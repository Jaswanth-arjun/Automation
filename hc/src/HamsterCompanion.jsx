import { useEffect, useRef } from 'react';
import { ANIMATIONS } from './animations.config.js';
import { HamsterEngine } from './HamsterEngine.js';
import { createPlaceholderManifest } from './placeholders.js';
import defaultManifest from './sprites.manifest.js';

/**
 * <HamsterCompanion />  - mount once (e.g. in your root layout).
 *   placeholders  true  => labelled placeholder boxes (engine test mode)
 *                 false => real sheets from `manifest` (default: /hamster/sheets/*.png)
 * Renders one empty div; the engine owns its own DOM, so React never re-renders it.
 */
export default function HamsterCompanion({ placeholders = false, manifest, size, bottom = 0, zIndex = 10, debug = false, onReady }) {
  const ref = useRef(null);
  useEffect(() => {
    const m = manifest ?? (placeholders ? createPlaceholderManifest(ANIMATIONS) : defaultManifest);
    const engine = new HamsterEngine(ref.current, { manifest: m, size, bottom, zIndex, debug });
    engine.start().then(() => onReady?.(engine));
    return () => engine.destroy();
  }, [placeholders, manifest, size, bottom, zIndex, debug]);
  return <div ref={ref} data-hamster-companion />;
}
