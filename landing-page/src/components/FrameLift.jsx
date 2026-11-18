import React, { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { ConfirmScene } from './AutoApplyWalkthrough';
import { EmailScene } from './OutreachWalkthrough';
import './FrameLift.css';

/* --------------------------------------------------------------------------
   FrameLift — "lift, glide, settle" handoff between the Auto Apply Copilot
   section and the Autonomous Outreach section (ported from
   hamzooh-frame-lift.html, GSAP replaced by a scroll-driven render loop).

   The browser frame leaves the Auto Apply window, lifts off the page (scales
   down + deepens its shadow), glides across to the Outreach window slot while
   its interior cross-slides from "Application Ready" to the Gmail referral
   request, and settles exactly where the Outreach frame will be.
   -------------------------------------------------------------------------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};
const lerp = (a, b, t) => a + (b - a) * t;

const AAW_URL = 'Review • Ready to Submit';
const OW_URL = 'mail.google.com · Referral request';

export default function FrameLift() {
  const layerRef = useRef(null);
  const frameRef = useRef(null);
  const paneARef = useRef(null);
  const paneBRef = useRef(null);
  const urlRef = useRef(null);
  const [enabled, setEnabled] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 960
  );

  useEffect(() => {
    const onResize = () => setEnabled(window.innerWidth >= 960);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    let raf = 0;
    let cache = null;
    let hiddenAaw = null;
    let hiddenOw = null;

    const els = () => {
      if (cache && cache.aawWin.isConnected && cache.owWin.isConnected) return cache;
      const q = (s) => document.querySelector(s);
      const aawRunway = q('.aaw-runway');
      const aawStage = q('.aaw-pinned-stage');
      const aawWin = q('.aaw-pinned-stage .aaw-window');
      const owRunway = q('.ow-runway');
      const owStage = q('.ow-pinned-stage');
      const owWin = q('.ow-pinned-stage .ow-window');
      if (!aawRunway || !aawStage || !aawWin || !owRunway || !owStage || !owWin) return null;
      cache = { aawRunway, aawStage, aawWin, owRunway, owStage, owWin };
      return cache;
    };

    // Hide the two real frames while the flying frame is on its way, so only
    // one browser window is ever visible during the handoff.
    const hide = (el, flag) => {
      if (!el) return;
      if (flag) {
        if (el.style.opacity === '0') return;
        el.dataset.flHidden = el.style.opacity;
        el.style.opacity = '0';
      } else if (el.dataset.flHidden !== undefined) {
        el.style.opacity = el.dataset.flHidden;
        delete el.dataset.flHidden;
      }
    };

    const render = () => {
      raf = 0;
      const refs = els();
      const layer = layerRef.current;
      const frame = frameRef.current;
      if (!refs || !layer || !frame) return;

      const { aawRunway, aawStage, aawWin, owRunway, owStage, owWin } = refs;
      const vh = window.innerHeight;
      const ay = aawRunway.getBoundingClientRect();
      const oy = owRunway.getBoundingClientRect();

      // Transition window: Auto Apply pin end -> Outreach pin start.
      const start = window.scrollY + ay.bottom - vh;
      const end = window.scrollY + oy.top;
      const span = end - start;
      if (span <= 0) {
        layer.style.display = 'none';
        hide(aawWin, false);
        hide(owWin, false);
        return;
      }

      const p = clamp01((window.scrollY - start) / span);
      if (p <= 0 || p >= 1) {
        layer.style.display = 'none';
        hide(aawWin, false);
        hide(owWin, false);
        return;
      }

      const awr = aawWin.getBoundingClientRect();
      const asr = aawStage.getBoundingClientRect();
      const owr = owWin.getBoundingClientRect();
      const osr = owStage.getBoundingClientRect();

      // Both poses are the windows' resting (pinned) position inside their
      // own pinned stage, so they are scroll-invariant.
      const A = { x: awr.left, y: awr.top - asr.top, w: awr.width, h: awr.height };
      const B = { x: owr.left, y: owr.top - osr.top, w: owr.width, h: owr.height };
      if (A.w < 50 || A.h < 50 || B.w < 50 || B.h < 50) return;

      // Keep the source window visible for the first sliver (the flying frame
      // sits exactly on top of it), then hide both while the frame travels.
      hide(aawWin, p > 0.012);
      hide(owWin, true);

      const lift = smooth(p / 0.3) - smooth((p - 0.72) / 0.28); // 0 → 1 → 0
      const glide = smooth((p - 0.18) / 0.64);

      const x = lerp(A.x, B.x, glide);
      const y = lerp(A.y, B.y, p);
      const w = lerp(A.w, B.w, glide);
      const h = lerp(A.h, B.h, glide);
      const liftScale = 1 - 0.14 * lift;

      frame.style.width = `${A.w.toFixed(2)}px`;
      frame.style.height = `${A.h.toFixed(2)}px`;
      frame.style.transform =
        `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) ` +
        `scale(${((w / A.w) * liftScale).toFixed(4)}, ${((h / A.h) * liftScale).toFixed(4)})`;
      frame.style.boxShadow =
        `0 ${(20 + 60 * lift).toFixed(1)}px ${(60 + 70 * lift).toFixed(1)}px -20px ` +
        `rgba(190, 110, 40, ${(0.3 + 0.22 * lift).toFixed(3)})`;

      // At p = 1 the frame covers the Outreach window exactly, so the hand
      // off to the real window is a single-frame swap with no fade needed.
      layer.style.display = 'block';
      layer.style.opacity = '1';

      // Interiors slide vertically past each other.
      const o = smooth((p - 0.36) / 0.28);
      if (paneARef.current) {
        paneARef.current.style.opacity = (1 - o).toFixed(3);
        paneARef.current.style.transform = `translate3d(0, ${(-36 * o).toFixed(2)}px, 0)`;
      }
      if (paneBRef.current) {
        paneBRef.current.style.opacity = o.toFixed(3);
        paneBRef.current.style.transform = `translate3d(0, ${(36 * (1 - o)).toFixed(2)}px, 0)`;
      }
      if (urlRef.current) {
        const label = o > 0.5 ? OW_URL : AAW_URL;
        if (urlRef.current.textContent !== label) urlRef.current.textContent = label;
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };

    const onResize = () => {
      cache = null;
      onScroll();
    };

    render();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
      hide(cache && cache.aawWin, false);
      hide(cache && cache.owWin, false);
      if (layerRef.current) layerRef.current.style.display = 'none';
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      {/* Extra scroll room so the frame has space to lift and glide. */}
      <div className="fl-bridge" aria-hidden="true" />

      <div className="fl-layer" ref={layerRef} aria-hidden="true">
        <div className="fl-frame" ref={frameRef}>
          <div className="fl-chrome">
            <div className="fl-dots">
              <i className="fl-dot fl-dot-r" />
              <i className="fl-dot fl-dot-y" />
              <i className="fl-dot fl-dot-g" />
            </div>
            <div className="fl-url">
              <Globe size={13} />
              <span ref={urlRef}>{AAW_URL}</span>
            </div>
            <div className="fl-live-pill">
              <span className="fl-live-dot" />
              <span>COPILOT</span>
            </div>
          </div>

          <div className="fl-viewport">
            <div className="fl-pane fl-pane-a" ref={paneARef}>
              <ConfirmScene />
            </div>
            <div className="fl-pane fl-pane-b" ref={paneBRef}>
              <EmailScene />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
