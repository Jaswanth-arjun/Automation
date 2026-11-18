import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ResumeTailoringDemo.css';

/* --------------------------------------------------------------------------
   ResumeTailoringDemo — hosts hamzooh-resume-demo-v2.html.

   The demo is a self-contained 1280×720 GSAP timeline, so it is embedded in a
   same-origin iframe (isolated styles + script) instead of being re-implemented
   in React. This component:
     • keeps the iframe exactly as tall as its content (no inner scrollbars)
     • starts playback when the section scrolls into view and pauses when it
       leaves, so it never restarts on small scroll movements
     • leaves the in-frame Replay button working
   -------------------------------------------------------------------------- */

const SRC = '/resume-demo-v2.html';

export default function ResumeTailoringDemo() {
  const hostRef = useRef(null);
  const frameRef = useRef(null);
  const played = useRef(false);
  const visible = useRef(false);
  const ro = useRef(null);
  const [height, setHeight] = useState(720);

  const demo = () => {
    const win = frameRef.current && frameRef.current.contentWindow;
    return win && win.HAMZOOH_DEMO ? win.HAMZOOH_DEMO : null;
  };

  const syncHeight = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.body) return;
      // Measure the demo's own <section>, not the document scroll height —
      // the document can never report shorter than the iframe itself, which
      // would keep a stale (too tall) height on small screens.
      const section = doc.querySelector('section');
      const measured = section
        ? section.getBoundingClientRect().bottom
        : doc.body.scrollHeight;
      const next = Math.ceil(Math.max(measured, 420));
      if (next > 200) setHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    } catch (err) {
      /* cross-origin — keep the fallback height */
    }
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const setVisible = (flag) => {
      if (visible.current === flag) return;
      visible.current = flag;
      const api = demo();
      if (!api) return;
      if (flag) {
        if (!played.current) {
          played.current = true;
          api.play();
        } else {
          api.resume();
        }
      } else {
        api.suspend();
      }
    };

    // Scroll-position check (works even where IntersectionObserver stays quiet,
    // e.g. a tab that was restored mid-page).
    const onScroll = () => {
      const rect = host.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      setVisible(rect.top < vh * 0.75 && rect.bottom > vh * 0.2);
    };

    let io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => setVisible(entry.isIntersecting));
      }, { threshold: [0, 0.25] });
      io.observe(host);
    }

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('resize', syncHeight);

    return () => {
      if (io) io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('resize', syncHeight);
      if (ro.current) ro.current.disconnect();
    };
  }, [syncHeight]);

  const handleLoad = () => {
    syncHeight();

    const frame = frameRef.current;
    const doc = frame && frame.contentDocument;
    if (doc && doc.body && typeof ResizeObserver !== 'undefined') {
      if (ro.current) ro.current.disconnect();
      ro.current = new ResizeObserver(() => syncHeight());
      ro.current.observe(doc.body);
    }

    const api = demo();
    if (!api) return;
    const rect = hostRef.current.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const onScreen = rect.top < vh * 0.75 && rect.bottom > vh * 0.2;
    if (onScreen && !played.current) {
      visible.current = true;
      played.current = true;
      api.play();
    } else if (!onScreen) {
      visible.current = false;
      api.suspend();
    }

    // Fonts settle a moment after load; re-measure so nothing is clipped.
    window.setTimeout(syncHeight, 300);
    window.setTimeout(syncHeight, 1200);
  };

  return (
    <section className="rd-section" id="resume-engine" ref={hostRef} aria-label="AI resume tailoring demonstration">
      <div className="rd-embed">
        <iframe
          ref={frameRef}
          src={SRC}
          title="HAMZOOH AI resume tailoring demonstration"
          className="rd-embed-frame"
          style={{ height: `${height}px` }}
          onLoad={handleLoad}
          scrolling="no"
        />
      </div>
    </section>
  );
}
