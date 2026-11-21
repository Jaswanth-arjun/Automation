import { useEffect, useRef } from 'react';

// One-shot entrance: the hamster from /hc walks slowly along the bottom from
// the right edge of the dashboard sidebar to the bottom-right corner, then
// cross-fades into the seated RAG assistant at the exact same spot.
const CELL = { w: 512, h: 512, cols: 4, frames: 8 };
const FPS = 9;
const RUN_MS = 6200;

export default function HamsterRunner({ onArrive, fading = false }) {
  const canvasRef = useRef(null);
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let size = 120;
    let dpr = 1;
    let startX = 0;
    let endX = 0;
    let raf = 0;
    let cancelled = false;
    let arrived = false;

    const layout = () => {
      size = Math.round(Math.min(150, Math.max(88, window.innerWidth * 0.18)));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      // Dashboard sidebar is 260px on desktop; off-canvas on smaller screens.
      const sidebar = window.innerWidth >= 1025 ? 260 : 0;
      startX = sidebar + 8;
      endX = Math.max(startX + 40, window.innerWidth - size - 12);
    };

    const draw = (frame) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const sx = (frame % CELL.cols) * CELL.w;
      const sy = Math.floor(frame / CELL.cols) * CELL.h;
      ctx.drawImage(img, sx, sy, CELL.w, CELL.h, 0, 0, size, size);
    };

    const place = (x, y = 0) => {
      canvas.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    };

    const img = new Image();
    img.src = `${import.meta.env.BASE_URL || '/'}hamster/sheets/walking.png`;
    img.onerror = () => { if (!cancelled && !arrived) { arrived = true; arriveRef.current?.(); } };
    img.onload = () => {
      if (cancelled || fading) return; // handoff keeps the last painted frame
      layout();
      if (reduced) {
        place(endX);
        draw(0);
        arrived = true;
        arriveRef.current?.();
        return;
      }
      const t0 = performance.now();
      const tick = (now) => {
        if (cancelled || fading) return;
        const p = Math.min(1, (now - t0) / RUN_MS);
        // Mostly steady walking speed with tiny, natural hesitations instead
        // of a mechanical ease-in-out.
        const eased = Math.min(1, Math.max(0, p - 0.018 * Math.sin(p * Math.PI * 4)));
        const x = startX + (endX - startX) * eased;
        const bob = -Math.abs(Math.sin(now / 115)) * 3; // small lively hop
        place(x, bob);
        draw(Math.floor((now / (1000 / FPS)) % CELL.frames));
        if (p < 1) raf = requestAnimationFrame(tick);
        else {
          place(endX);
          draw(0); // standing frame at the destination
          arrived = true;
          arriveRef.current?.();
        }
      };
      raf = requestAnimationFrame(tick);
    };

    // During handoff the sprite freezes at its destination and fades away while
    // the seated rig fades in on top of it.
    if (fading) {
      canvas.style.transition = 'opacity .7s ease';
      canvas.style.opacity = '0';
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      img.onload = null;
      img.onerror = null;
    };
  }, [fading]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'fixed', left: 0, bottom: -6, zIndex: 9997, pointerEvents: 'none', willChange: 'transform, opacity' }}
    />
  );
}
