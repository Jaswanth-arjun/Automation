import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Globe,
  FileText,
  Check,
  CheckCheck,
  CheckCircle2,
  Send,
  Mail,
} from 'lucide-react';
import './OutreachWalkthrough.css';

/* ------------------------------------------------------------------ */
/* Stage definitions — 3 stages: Email → LinkedIn → Auto apply         */
/* ------------------------------------------------------------------ */

const PEOPLE = [
  { initials: 'NK', name: 'Neha Kapoor', role: 'Engineering Manager · Apple', state: 'Replied' },
  { initials: 'AS', name: 'Arun Shah', role: 'Senior Recruiter · Apple', state: 'Accepted' },
  { initials: 'MJ', name: 'Meera Joshi', role: 'Staff Engineer · Apple', state: 'Invited' },
];

const APPLY_FIELDS = [
  ['Full name', 'Arjun Kumar'],
  ['Email', 'arjun.kumar@gmail.com'],
  ['Phone', '+91 94405 52825'],
  ['LinkedIn', 'linkedin.com/in/arjun-dev'],
];

/* ------------------------------------------------------------------ */
/* Scene 1 — Email referral request                                    */
/* ------------------------------------------------------------------ */

export function EmailScene() {
  return (
    <div className="ow-mail">
      <aside className="ow-mail-side">
        <div className="ow-mail-logo">
          <Mail size={14} />
          <span>Gmail</span>
        </div>
        <span className="ow-mail-folder is-on">Inbox <b>3</b></span>
        <span className="ow-mail-folder">Sent</span>
        <span className="ow-mail-folder">Follow-ups</span>
        <div className="ow-mail-sched">
          <small>Follow-up</small>
          <b>Scheduled · +3 days</b>
        </div>
      </aside>

      <div className="ow-mail-main">
        <div className="ow-mail-top">
          <span className="ow-avatar">RM</span>
          <div className="ow-mail-to">
            <small>To</small>
            <b>Riya Mehta · Talent Partner, Apple</b>
          </div>
          <span className="ow-pill">Referral</span>
        </div>

        <div className="ow-mail-subject">Referral request — Senior Software Engineer (Find My)</div>

        <p className="ow-mail-line">Hi Riya,</p>
        <p className="ow-mail-line">
          I&apos;m applying for the Senior SWE role on the Find My team. My background in distributed
          systems maps closely to the JD — would you be open to a referral?
        </p>

        <div className="ow-mail-attach">
          <FileText size={14} />
          <span>Arjun_Kumar_Apple.pdf</span>
          <b>98% match</b>
        </div>

        <div className="ow-mail-actions">
          <span className="ow-send">
            Send referral request <Send size={12} />
          </span>
          <span className="ow-ghost">Review draft</span>
        </div>

        <div className="ow-mail-toast">
          <CheckCheck size={13} /> Sent from your Gmail · follow-up scheduled
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 2 — LinkedIn referral campaign                                */
/* ------------------------------------------------------------------ */

function LinkedInScene() {
  return (
    <div className="ow-li">
      <div className="ow-li-head">
        <span className="ow-li-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM10 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05C21.4 8.65 22 11 22 14.1V21h-4v-6.1c0-1.45-.03-3.3-2-3.3-2 0-2.3 1.57-2.3 3.2V21h-4z" />
          </svg>
        </span>
        <div>
          <b>Referral campaign</b>
          <small>Senior Software Engineer · India</small>
        </div>
        <span className="ow-live"><i /> Running</span>
      </div>

      <div className="ow-li-stats">
        <div><small>Invites today</small><b>40 / 40</b></div>
        <div><small>Accepted</small><b>18</b></div>
        <div><small>Replies</small><b>6</b></div>
      </div>

      <div className="ow-li-list">
        {PEOPLE.map((p, i) => (
          <div className="ow-li-row" key={p.name} style={{ '--i': i }}>
            <span className="ow-avatar ow-avatar-sm">{p.initials}</span>
            <div className="ow-li-person">
              <b>{p.name}</b>
              <small>{p.role}</small>
            </div>
            <span className={`ow-li-state is-${p.state.toLowerCase()}`}>{p.state}</span>
          </div>
        ))}
      </div>

      <div className="ow-li-foot">
        <CheckCircle2 size={13} /> Personal notes + follow-ups queued for every invite
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 3 — Auto apply                                                */
/* ------------------------------------------------------------------ */

function AutoApplyScene() {
  return (
    <div className="ow-apply">
      <div className="ow-apply-head">
        <div>
          <small>greenhouse.io · Apple Careers</small>
          <b>Senior Software Engineer, Find My</b>
        </div>
        <span className="ow-pill">Auto apply</span>
      </div>

      <div className="ow-apply-fields">
        {APPLY_FIELDS.map(([label, value], i) => (
          <div className="ow-field" key={label} style={{ '--i': i }}>
            <small>{label}</small>
            <span>
              {value}
              <Check size={11} />
            </span>
          </div>
        ))}
      </div>

      <div className="ow-apply-resume">
        <FileText size={14} />
        <div>
          <b>Arjun_Kumar_Apple.pdf</b>
          <small>Tailored · 98% ATS match</small>
        </div>
        <Check size={13} />
      </div>

      <div className="ow-apply-confirm">
        <span><CheckCircle2 size={14} /> You confirm before submitting</span>
        <b className="ow-apply-btn">Submit application</b>
      </div>
    </div>
  );
}

const STAGES = [
  {
    n: '01',
    tab: 'Email',
    kicker: 'Email outreach',
    title: 'Referral requests, written for each role',
    points: [
      'Finds the recruiter or hiring manager for the exact role',
      'Sends a personal note from your own Gmail with your tailored resume',
      'Schedules follow-ups automatically until they reply',
    ],
    url: 'mail.google.com · Referral request',
    Scene: EmailScene,
  },
  {
    n: '02',
    tab: 'LinkedIn',
    kicker: 'LinkedIn outreach',
    title: 'Invites and messages that get accepted',
    points: [
      'Role-based campaigns target the right people, not random profiles',
      'Personal first-name notes with every connection request',
      'Tracks accepted invites and keeps follow-ups moving',
    ],
    url: 'linkedin.com · Referral campaign',
    Scene: LinkedInScene,
  },
  {
    n: '03',
    tab: 'Auto apply',
    kicker: 'Auto apply',
    title: 'Apply the moment someone replies',
    points: [
      'Autofills the application and attaches your tailored ATS resume',
      'Asks for your confirmation before anything is submitted',
      'Syncs the application, reply and status to your tracker',
    ],
    url: 'greenhouse.io · Auto apply',
    Scene: AutoApplyScene,
  },
];

/* ------------------------------------------------------------------ */
/* Browser window mockup (identical frame to AutoApplyWalkthrough)    */
/* ------------------------------------------------------------------ */

const BrowserWindow = memo(function BrowserWindow({ active, trackRef, framesRef }) {
  const stage = STAGES[active] || STAGES[0];
  return (
    <div className="ow-window">
      <div className="ow-chrome">
        <div className="ow-dots" aria-hidden="true">
          <i className="ow-dot ow-dot-r" />
          <i className="ow-dot ow-dot-y" />
          <i className="ow-dot ow-dot-g" />
        </div>
        <div className="ow-url">
          <Globe size={13} />
          <span className="ow-url-text">{stage.url}</span>
        </div>
        <div className="ow-chrome-right">
          <div className="ow-frame-dots" aria-hidden="true">
            {STAGES.map((s, i) => (
              <i key={s.n} className={i === active ? 'is-on' : ''} />
            ))}
          </div>
          <div className="ow-live-pill">
            <span className="ow-live-dot" />
            <span>COPILOT</span>
          </div>
        </div>
      </div>
      <div className="ow-viewport">
        {/* Scroll-driven chain of frames: each frame slides bottom → top,
            one after the other, with a visible gap between them. */}
        <div className="ow-track" ref={trackRef}>
          {STAGES.map((s, i) => {
            const SceneComponent = s.Scene;
            return (
              <div
                key={s.n}
                className={`ow-scene ow-frame ${i === active ? 'is-active' : ''}`}
                aria-hidden={i !== active}
                ref={(el) => { framesRef.current[i] = el; }}
              >
                <SceneComponent />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function OutreachWalkthrough({ onOpen }) {
  const [activeStage, setActiveStage] = useState(0);
  const runwayRef = useRef(null);
  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const framesRef = useRef([]);
  const stepRefs = useRef([]);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 960
  );

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 960);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const applyStepMotion = useCallback((progress) => {
    const N = STAGES.length;
    const t = progress * N;
    const TRAVEL_DOWN = Math.round(window.innerHeight * 0.32);
    const TRAVEL_UP = Math.round(window.innerHeight * 0.19);
    const ENTER = 0.3;
    const EXIT = 0.7;

    stepRefs.current.forEach((el, i) => {
      if (!el) return;

      const local = t - i;
      let y = TRAVEL_DOWN;
      let opacity = 0;

      if (i === 0 && local >= 0 && local < EXIT) {
        y = -6 * (local / EXIT);
        opacity = 1;
      } else if (local >= 0 && local < ENTER) {
        const k = local / ENTER;
        const eased = 1 - Math.pow(1 - k, 3);
        y = TRAVEL_DOWN * (1 - eased);
        opacity = Math.min(1, k * 2.5);
      } else if (local >= ENTER && local < EXIT) {
        const k = (local - ENTER) / (EXIT - ENTER);
        y = -6 * k;
        opacity = 1;
      } else if (local >= EXIT) {
        if (i === N - 1) {
          y = -6;
          opacity = 1;
        } else if (local < 1) {
          const k = (local - EXIT) / (1 - EXIT);
          const eased = k * k;
          y = -6 - (TRAVEL_UP + 6) * eased;
          opacity = Math.max(0, Math.pow(1 - k, 1.3));
        } else {
          y = -(TRAVEL_UP + 10);
          opacity = 0;
        }
      }

      el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
      el.style.opacity = opacity.toFixed(3);
    });
  }, []);

  useEffect(() => {
    if (isMobile) {
      stepRefs.current.forEach((el) => {
        if (!el) return;
        el.style.removeProperty('transform');
        el.style.removeProperty('opacity');
      });
      return undefined;
    }
    let raf = 0;
    let rail = 0; // distance between two frames (frame height + the gap)

    const measureRail = () => {
      const track = trackRef.current;
      const frames = framesRef.current;
      const viewport = track && track.parentElement;
      if (!track || !viewport || !frames[0] || !frames[1]) {
        rail = 0;
        return;
      }
      // offsetTop ignores transforms, so this is always the real spacing.
      const spacing = frames[1].offsetTop - frames[0].offsetTop;
      if (spacing > 1) {
        rail = spacing;
        return;
      }
      const gap = parseFloat(getComputedStyle(track).rowGap) || 0;
      rail = viewport.clientHeight + gap;
    };

    const handleScroll = () => {
      raf = 0;
      const el = runwayRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const totalScroll = rect.height - window.innerHeight;
      if (totalScroll <= 0) return;

      const scrolled = -rect.top;
      const progress = Math.min(1, Math.max(0, scrolled / totalScroll));

      const stage = stageRef.current;
      if (stage) stage.style.setProperty('--ow-progress', progress.toFixed(4));

      const track = trackRef.current;
      if (track && rail <= 1) measureRail();
      if (track && rail) {
        const N = STAGES.length;
        const SLIDE = 0.38; // share of one stage's scroll spent travelling
        const t = progress * N;
        const idx = Math.min(N - 1, Math.floor(t));
        const frac = t - idx;
        let slide = 0;
        if (frac > 1 - SLIDE) {
          const k = Math.min(1, (frac - (1 - SLIDE)) / SLIDE);
          slide = k * k * (3 - 2 * k); // smooth step
        }
        // pos = fractional index of the frame that owns the viewport right now
        const pos = Math.min(N - 1, idx + slide);
        // while a frame holds, let it breathe slightly so the section never
        // feels frozen between two transitions
        const hold = Math.min(1, frac / (1 - SLIDE));

        // Every frame already sits i * rail below the window in normal flow,
        // so they all share one translation: slide the whole chain by -pos.
        const chainY = -pos * rail;

        framesRef.current.forEach((el, i) => {
          if (!el) return;
          const dist = i - pos; // negative = leaving upward, positive = arriving from below
          const p = Math.min(1, Math.abs(dist));
          let scale = 1;
          let tilt = 0;
          let opacity = 1;

          if (dist < 0) {
            // leaving: lifts up, shrinks away, fades into the distance
            scale = 1 - 0.07 * p;
            tilt = -3.5 * p;
            opacity = 1 - 0.55 * p;
          } else if (dist > 0) {
            // arriving: rises from below with a gentle tilt until it locks flat
            scale = 1 - 0.035 * p;
            tilt = 4.5 * p;
            opacity = 1 - 0.28 * p;
          } else if (i === idx) {
            scale = 1 - 0.015 * hold;
          }

          el.style.transform =
            `translate3d(0, ${chainY.toFixed(2)}px, 0) ` +
            `scale(${scale.toFixed(4)}) rotateX(${tilt.toFixed(2)}deg)`;
          el.style.opacity = opacity.toFixed(3);
        });
      }

      applyStepMotion(progress);

      const nextStage = Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length));
      setActiveStage((prev) => (prev !== nextStage ? nextStage : prev));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(handleScroll);
    };

    const onResize = () => {
      rail = 0;
      measureRail();
      onScroll();
    };

    measureRail();
    handleScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    // The pinned stage changes height/width with layout (fonts, images, zoom),
    // so re-measure whenever its box actually changes.
    let ro = null;
    const viewportEl = trackRef.current && trackRef.current.parentElement;
    if (viewportEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        measureRail();
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(handleScroll);
        else handleScroll();
      });
      ro.observe(viewportEl);
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isMobile, applyStepMotion]);

  const goToStage = useCallback((index) => {
    setActiveStage(index);

    if (isMobile) {
      document
        .querySelector(`.ow-mobile-stage[data-stage="${index}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const el = runwayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const totalScroll = el.offsetHeight - window.innerHeight;
    if (totalScroll <= 0) return;

    const targetY = scrollTop + rect.top + ((index + 0.5) / STAGES.length) * totalScroll;
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }, [isMobile]);

  return (
    <section className="ow-runway" id="outreach" ref={runwayRef} aria-labelledby="ow-heading">
      <div className="ow-pinned-stage" ref={stageRef}>
        <div className="ow-layout">
          {/* Left Column: tall interactive Mac Window (matches previous section frame size exactly!) */}
          <div className="ow-stage-col">
            <BrowserWindow
              active={activeStage}
              onOpen={onOpen}
              trackRef={trackRef}
              framesRef={framesRef}
            />
          </div>

          {/* Right Column: Heading & Information (Header + Moving Steps) */}
          <div className="ow-copy-col">
            <header className="ow-header">
              <span className="hmz-kicker">AUTONOMOUS OUTREACH</span>
              <h2 id="ow-heading" className="ow-heading">
                Email &amp; LinkedIn referrals on <em>autopilot.</em>
              </h2>
              <p className="ow-lede">
                HAMZO finds the right people for every role, sends personal referral requests from your
                own inbox and profile, then auto-applies the moment someone replies.
              </p>
            </header>

            <div className="ow-steps-stack">
              {STAGES.map((stage, i) => {
                let state = 'is-upcoming';
                if (i === activeStage) state = 'is-active';
                else if (i < activeStage) state = 'is-passed';

                return (
                  <div
                    key={stage.n}
                    className={`ow-step-item ${state}`}
                    ref={(el) => { stepRefs.current[i] = el; }}
                    onClick={() => goToStage(i)}
                  >
                    <div className="ow-step-badge-row">
                      <span className="ow-step-badge">{stage.n}</span>
                      <div className="ow-step-heading">
                        <small className="ow-step-kicker">{stage.kicker}</small>
                        <h3 className="ow-step-title">{stage.title}</h3>
                      </div>
                    </div>
                    <ul className="ow-step-bullets">
                      {stage.points.map((p, pIdx) => (
                        <li key={p} style={{ '--i': pIdx }}>
                          <span className="ow-bullet-dot" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mobile: static stage pairs (visual + step together) */}
        <div className="ow-mobile">
          {STAGES.map((stage, i) => {
            const Scene = stage.Scene;
            return (
              <div className="ow-mobile-stage" key={stage.n} data-stage={i}>
                <div className="ow-window">
                  <div className="ow-chrome">
                    <div className="ow-dots" aria-hidden="true">
                      <i className="ow-dot ow-dot-r" />
                      <i className="ow-dot ow-dot-y" />
                      <i className="ow-dot ow-dot-g" />
                    </div>
                    <div className="ow-url">
                      <Globe size={13} />
                      <span className="ow-url-text">{stage.url}</span>
                    </div>
                  </div>
                  <div className="ow-viewport">
                    <Scene />
                  </div>
                </div>
                <div className="ow-mobile-step">
                  <div className="ow-step-badge-row">
                    <span className="ow-step-badge">{stage.n}</span>
                    <div className="ow-step-heading">
                      <small className="ow-step-kicker">{stage.kicker}</small>
                      <h3 className="ow-step-title">{stage.title}</h3>
                    </div>
                  </div>
                  <ul className="ow-step-bullets">
                    {stage.points.map((p) => (
                      <li key={p}>
                        <span className="ow-bullet-dot" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
