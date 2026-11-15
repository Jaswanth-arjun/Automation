import React, { useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, ArrowRight, ShieldCheck, Check } from 'lucide-react';
import './CompleteProfileModal.css';

const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const LOOP_MS = 7000;

/* Profile fields that fly out of the resume paper and stop in the centre of
   the Job match ring (on top of it) */
const SKILLS = [
  { label: 'Name', delay: 0.9, endY: 0, tilt: -5 },
  { label: 'Email', delay: 2.1, endY: 0, tilt: 4 },
  { label: 'Phone', delay: 3.6, endY: 0, tilt: -2 },
];

export default function CompleteProfileModal({ isOpen, onClose, matchScore = null }) {
  const navigate = useNavigate();
  // Only animate a real, already-calculated score. Never invent one.
  const hasScore = typeof matchScore === 'number' && Number.isFinite(matchScore);
  const targetScore = hasScore ? Math.max(0, Math.min(100, Math.round(matchScore))) : 0;

  const canvasRef = useRef(null);
  const paperRef = useRef(null);
  const ringBoxRef = useRef(null);
  const flightRef = useRef(null);
  const scoreColumnRef = useRef(null);
  const scoreNumberRef = useRef(null);
  const progressRef = useRef(null);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  /* Looping motion-graphic: skills fly from the paper into the ring while the
     score counts up in three steps, locks at the target score with a verified
     badge, then the loop restarts. */
  useEffect(() => {
    if (!isOpen) return undefined;

    const measureFlight = () => {
      const canvas = canvasRef.current;
      const paper = paperRef.current;
      const ring = ringBoxRef.current;
      const flight = flightRef.current;
      if (!canvas || !paper || !ring || !flight) return;

      const c = canvas.getBoundingClientRect();
      const p = paper.getBoundingClientRect();
      const r = ring.getBoundingClientRect();

      const startX = p.right - c.left - 6;
      const startY = p.top - c.top + p.height * 0.52;
      const endY = r.top - c.top + r.height * 0.5;
      /* Chips travel on top of the ring and stop at its centre. */
      const endCenterX = r.left - c.left + r.width * 0.5;

      flight.style.setProperty('--sx', `${startX}px`);
      flight.style.setProperty('--sy', `${startY}px`);
      flight.style.setProperty('--fy', `${endY - startY}px`);

      flight.querySelectorAll('.cpm-skill-chip').forEach((chip) => {
        chip.style.setProperty('--fx', `${endCenterX - startX}px`);
      });
    };

    measureFlight();
    const layoutFrame = requestAnimationFrame(measureFlight);
    /* Re-measure once the modal's entrance animation finishes so the pop
       transform does not skew the paper/ring coordinates. */
    const settleTimer = window.setTimeout(measureFlight, 460);
    window.addEventListener('resize', measureFlight);

    const easeOut = (k) => 1 - Math.pow(1 - k, 3);
    const firstStop = Math.round(targetScore * 0.3);
    const secondStop = Math.round(targetScore * 0.65);
    const startedAt = performance.now();

    let raf = 0;

    const tick = (now) => {
      const t = ((now - startedAt) % LOOP_MS) / 1000;

      let score = 0;
      let achieved = false;
      let resetting = false;

      if (t < 0.9) {
        score = 0;
      } else if (t < 1.85) {
        score = firstStop * easeOut((t - 0.9) / 0.95);
      } else if (t < 2.1) {
        score = firstStop;
      } else if (t < 3.2) {
        score = firstStop + (secondStop - firstStop) * easeOut((t - 2.1) / 1.1);
      } else if (t < 3.6) {
        score = secondStop;
      } else if (t < 4.7) {
        score = secondStop + (targetScore - secondStop) * easeOut((t - 3.6) / 1.1);
      } else if (t < 6.1) {
        score = targetScore;
        achieved = true;
      } else if (t < 6.5) {
        score = targetScore;
        achieved = true;
        resetting = true;
      } else {
        score = 0;
      }

      // Without a real calculated score the ring stays empty and the number
      // stays as a dash — the modal explains what to complete instead.
      if (hasScore) {
        if (scoreNumberRef.current) {
          scoreNumberRef.current.textContent = `${Math.round(score)}%`;
        }
        if (progressRef.current) {
          progressRef.current.style.strokeDashoffset = String(
            RING_CIRCUMFERENCE - (score / 100) * RING_CIRCUMFERENCE
          );
        }
      }
      if (scoreColumnRef.current) {
        scoreColumnRef.current.classList.toggle('is-achieved', achieved && !resetting);
        scoreColumnRef.current.classList.toggle('is-resetting', resetting);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(layoutFrame);
      clearTimeout(settleTimer);
      window.removeEventListener('resize', measureFlight);
    };
  }, [isOpen, targetScore, hasScore]);

  if (!isOpen) return null;

  const handleGoToProfile = () => {
    onClose?.();
    navigate('/dashboard/profile');
  };

  const handleLater = () => {
    onClose?.();
  };

  const modalContent = (
    <div className="cpm-overlay" onClick={handleLater} role="dialog" aria-modal="true">
      <div className="cpm-card-modal" onClick={(e) => e.stopPropagation()}>
        {/* ─── Top Canvas with Motion Graphic & Close Button ─── */}
        <div className="cpm-top-canvas" ref={canvasRef}>
          {/* Ambient Glowing Aura */}
          <div className="cpm-canvas-glow" />

          {/* Close X Button */}
          <button className="cpm-close-btn" onClick={handleLater} title="Close" aria-label="Close">
            <X size={15} />
          </button>

          {/* Decorative Sparkle Stars */}
          <svg
            className="cpm-sparkle-star cpm-star-left"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>

          <svg
            className="cpm-sparkle-star cpm-star-right"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>

          <svg
            className="cpm-sparkle-star cpm-star-center"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>

          {/* Skill chips flying paper → ring (looping) */}
          <div className="cpm-flight-layer" ref={flightRef} aria-hidden="true">
            {SKILLS.map((skill) => (
              <span
                key={skill.label}
                className="cpm-skill-chip"
                style={{
                  '--oy': `${skill.endY}px`,
                  '--tilt': `${skill.tilt}deg`,
                  animationDelay: `${skill.delay}s`,
                }}
              >
                {skill.label}
              </span>
            ))}
          </div>

          {/* Left: Floating Resume / Profile Card with Scanning Laser */}
          <div className="cpm-paper-card" ref={paperRef}>
            {/* Animated Laser Scanning Beam */}
            <div className="cpm-scan-beam" />

            <div className="cpm-paper-top">
              <div className="cpm-paper-avatar">
                <div className="cpm-avatar-pulse" />
              </div>
              <div className="cpm-paper-header-lines">
                <div className="cpm-paper-h-line-1" />
                <div className="cpm-paper-h-line-2" />
              </div>
            </div>
            <div className="cpm-paper-body-lines">
              <div className="cpm-orange-bar w-100" />
              <div className="cpm-orange-bar w-85" />
              <div className="cpm-orange-bar w-100" />
              <div className="cpm-orange-bar w-70" />
              <div className="cpm-orange-bar w-55" />
            </div>
          </div>

          {/* Right: Circular Job Match Indicator with Animated Ring */}
          <div className="cpm-score-column" ref={scoreColumnRef}>
            <div className="cpm-score-ring-outer" ref={ringBoxRef}>
              <span className="cpm-score-halo" />
              <svg className="cpm-score-svg-ring" viewBox="0 0 100 100">
                <circle className="cpm-svg-ring-track" cx="50" cy="50" r={RING_RADIUS} />
                <circle
                  className="cpm-svg-ring-active"
                  ref={progressRef}
                  cx="50"
                  cy="50"
                  r={RING_RADIUS}
                  style={{
                    strokeDasharray: RING_CIRCUMFERENCE,
                    strokeDashoffset: RING_CIRCUMFERENCE,
                  }}
                />
                <circle className="cpm-svg-ring-orbit" cx="50" cy="50" r={RING_RADIUS} />
              </svg>
              <div className="cpm-score-ring-inner">
                <span className="cpm-score-number" ref={scoreNumberRef}>
                  {hasScore ? '0%' : '—'}
                </span>
              </div>
              <span className="cpm-score-check" aria-hidden="true">
                <Check size={12} strokeWidth={3.5} />
              </span>
              <span className="cpm-score-spark" aria-hidden="true">
                ✦
              </span>
            </div>
            <span className="cpm-score-label">{hasScore ? 'Job match' : 'Score locked'}</span>
          </div>
        </div>

        {/* ─── Bottom Actions & Content ─── */}
        <div className="cpm-bottom-content">
          <div className="cpm-pill-badge">
            PROFILE SETUP • 2 MINUTES
          </div>

          <div className="cpm-big-button-wrap">
            <button className="cpm-big-orange-btn" onClick={handleGoToProfile}>
              <span>Complete Profile Now</span>
              <ArrowRight size={17} />
            </button>
          </div>

          <div>
            <button className="cpm-dismiss-link" onClick={handleLater}>
              I’ll do this later
            </button>
          </div>

          <div className="cpm-trust-banner">
            <ShieldCheck size={14} />
            <span>You stay in control and review every application before it is sent.</span>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
