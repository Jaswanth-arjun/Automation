import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Globe, ArrowRight, FileText, CheckCircle2, Check, Sparkles } from 'lucide-react';
import PawLogo from './PawLogo';
import './AutoApplyWalkthrough.css';

/* ------------------------------------------------------------------ */
/* Step Definitions (Matching Uplers Flow & HAMZO Features)            */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    n: '1',
    tab: 'Auto-Detect',
    title: 'Detects on any job board',
    points: [
      'Works on LinkedIn, Naukri, Greenhouse, Lever, Ashby, Workday & company career sites',
      'HAMZO Chrome Extension activates automatically with 1 click',
    ],
    url: 'linkedin.com/jobs • HAMZO Apply Copilot',
  },
  {
    n: '2',
    tab: 'Smart Fill & Resume',
    title: 'Autofills & attaches tailored resume',
    points: [
      '15+ standard and complex fields populated in seconds',
      'Generates and injects a keyword-tailored 1-page ATS PDF directly into the file upload',
    ],
    url: 'greenhouse.io/apple/apply • Auto-Fill',
  },
  {
    n: '3',
    tab: 'Vault Memory',
    title: 'Learns unseen questions (Vault)',
    points: [
      'Never guesses: asks missing employer questions in a swift prompt',
      'Saves answers permanently to your private Vault — never asks again',
    ],
    url: 'Vault • Instant Memory',
  },
  {
    n: '4',
    tab: 'Review & Submit',
    title: 'You confirm before submitting',
    points: [
      'Zero silent submissions: full review control on every application',
      'Auto-syncs application status, timestamp, and tailored resume to your Web Tracker',
    ],
    url: 'Review • Ready to Submit',
  },
];

const JOBS = [
  { co: 'Apple', role: 'Senior Software Engineer, Find My', loc: 'Bangalore (Hybrid)', c: '#0f172a' },
  { co: 'Amazon', role: 'Software Dev Engineer II', loc: 'Bangalore (Hybrid)', c: '#ff9900' },
  { co: 'Zomato', role: 'SDE III, Backend Systems', loc: 'Gurugram (On-site)', c: '#cb202d' },
  { co: 'Angel One', role: 'Agentic AI Intern', loc: 'Bengaluru (Hybrid)', c: '#0d9488' },
];

const FORM_FIELDS = [
  { label: 'First Name', value: 'Arjun' },
  { label: 'Last Name', value: 'Kumar' },
  { label: 'Email Address', value: 'arjun.kumar@gmail.com' },
  { label: 'Phone Number', value: '+91 94405 52825' },
  { label: 'LinkedIn Profile', value: 'linkedin.com/in/arjun-dev' },
  { label: 'GitHub / Portfolio', value: 'github.com/arjun-dev' },
];

/* ------------------------------------------------------------------ */
/* Interactive Scenes inside Mac Window                               */
/* ------------------------------------------------------------------ */

function JobBoardScene({ onOpen }) {
  return (
    <div className="aaw-job">
      <aside className="aaw-job-list">
        <p className="aaw-list-title">Jobs for you</p>
        <p className="aaw-list-sub">Software engineer · India</p>
        {JOBS.map((j, i) => (
          <div key={j.co} className={`aaw-job-row${i === 0 ? ' is-sel' : ''}`} style={{ '--i': i }}>
            <span className="aaw-co-tile" style={{ background: j.c }}>
              {j.co === 'Apple' ? '' : j.co[0]}
            </span>
            <span className="aaw-job-row-text">
              <strong>{j.role}</strong>
              <small>{j.co}</small>
              <small>{j.loc}</small>
            </span>
          </div>
        ))}
      </aside>

      <div className="aaw-job-detail">
        <div className="aaw-co-line">
          <span className="aaw-co-tile apple" style={{ background: '#0f172a' }}></span>
          <span>Apple Inc.</span>
        </div>
        <h4 className="aaw-job-title">Senior Software Engineer, Find My</h4>
        <p className="aaw-job-meta">Bangalore, Karnataka, India · 3 days ago</p>
        <div className="aaw-pills">
          <span>Hybrid</span>
          <span>Full-time</span>
        </div>
        <div className="aaw-job-actions">
          <span className="aaw-fake-apply">Apply ↗</span>
          <span className="aaw-fake-save">Save</span>
        </div>
        <div className="aaw-lines">
          <i style={{ width: '88%' }} />
          <i style={{ width: '72%' }} />
          <i style={{ width: '80%' }} />
        </div>

        {/* Floating HAMZO Copilot Extension Card */}
        <div className="aaw-widget aaw-widget-run">
          <div className="aaw-widget-head">
            <PawLogo size={20} />
            <strong>HAMZO</strong>
            <span className="aaw-tag">Copilot Active</span>
          </div>
          <button
            type="button"
            className="aaw-btn aaw-btn-mint"
            onClick={() => onOpen?.('/dashboard/resume')}
          >
            Run HAMZO on this job <span aria-hidden="true">→</span>
          </button>
          <div className="aaw-widget-quota">
            <div className="aaw-quota-bar">
              <span style={{ width: '40%' }} />
            </div>
            <p className="aaw-widget-sub">Today: 1 of 10 daily applications</p>
          </div>
          <div className="aaw-boards">
            <span className="is-on">LinkedIn</span>
            <span>Naukri</span>
            <span>Greenhouse</span>
            <span>Lever</span>
            <span>Ashby</span>
            <span>Workday</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormScene() {
  return (
    <div className="aaw-pad aaw-form">
      <div className="aaw-form-top">
        <div>
          <span className="aaw-ats-pill">greenhouse.io · Apple Careers</span>
          <p className="aaw-form-title">Application for Senior Software Engineer</p>
        </div>
        <span className="aaw-note">
          <PawLogo size={15} /> Filled by HAMZO from your profile
        </span>
      </div>
      <div className="aaw-fields">
        {FORM_FIELDS.map((f, i) => (
          <div className="aaw-field" key={f.label} style={{ '--i': i }}>
            <label>{f.label}</label>
            <div className="aaw-input">
              <span>{f.value}</span>
              <Check className="aaw-field-check" size={14} />
            </div>
          </div>
        ))}
        {/* Tailored Resume File Attachment Box */}
        <div className="aaw-field aaw-field-resume" style={{ '--i': 6 }}>
          <label>Resume / CV *</label>
          <div className="aaw-attach">
            <span className="aaw-pdf-icon" aria-hidden="true">
              <FileText size={16} />
            </span>
            <span className="aaw-attach-text">
              <strong>✓ Arjun_Kumar_Apple_Tailored.pdf</strong>
              <small>1-page ATS Tailored PDF · 48 KB</small>
            </span>
            <span className="aaw-ats-score">
              <CheckCircle2 size={13} /> 98% Match
            </span>
          </div>
          <div className="aaw-attach-note">
            ✓ Attached automatically via DataTransfer by Hamzo AI Copilot
          </div>
        </div>
      </div>
    </div>
  );
}

function GhostForm() {
  return (
    <div className="aaw-ghost" aria-hidden="true">
      <div className="aaw-field">
        <label>Full name</label>
        <div className="aaw-input"><span>Arjun Kumar</span></div>
      </div>
      <div className="aaw-field">
        <label>Notice period & expected CTC</label>
        <div className="aaw-input aaw-input-pending"><span>Waiting for your answer…</span></div>
      </div>
    </div>
  );
}

function VaultScene() {
  return (
    <div className="aaw-pad aaw-vault">
      <GhostForm />
      <div className="aaw-widget aaw-widget-ask">
        <div className="aaw-widget-head">
          <span className="aaw-robot-badge">🤖</span>
          <div>
            <strong>HAMZO needs one detail</strong>
            <small className="aaw-vault-sub">Saved to Vault — never asks again</small>
          </div>
          <span className="aaw-tag">1 of 2 fields</span>
        </div>
        <p className="aaw-question">
          “What is your current notice period and expected compensation?”
        </p>
        <div className="aaw-vault-answers">
          <div className="aaw-va-row" style={{ '--i': 0 }}>
            <span className="lbl">Notice Period</span>
            <span className="val">15 days</span>
            <span className="src">From Vault</span>
          </div>
          <div className="aaw-va-row" style={{ '--i': 1 }}>
            <span className="lbl">Expected CTC</span>
            <span className="val">₹24–30 LPA</span>
            <span className="src">From Profile</span>
          </div>
          <div className="aaw-va-row" style={{ '--i': 2 }}>
            <span className="lbl">Relocation</span>
            <span className="val">Yes, open to Bangalore</span>
            <span className="src">From Vault</span>
          </div>
        </div>
        <div className="aaw-chips">
          <span className="aaw-chip">Immediate</span>
          <span className="aaw-chip aaw-chip-on">15 days</span>
          <span className="aaw-chip">30 days</span>
        </div>
        <div className="aaw-toggle-row">
          <span className="aaw-toggle" aria-hidden="true"><i /></span>
          <span>💾 Save to Vault (never ask again)</span>
        </div>
      </div>
    </div>
  );
}

function ConfirmScene() {
  return (
    <div className="aaw-pad aaw-confirm">
      <div className="aaw-widget aaw-widget-done">
        <span className="aaw-done-badge">
          <CheckCircle2 size={36} />
        </span>
        <p className="aaw-done-title">Application Ready!</p>
        <p className="aaw-widget-sub">14 fields filled successfully · 0 errors</p>
        <div className="aaw-confirm-summary">
          <div className="aaw-cs-item">
            <span>Target Role:</span>
            <b>Senior Software Engineer, Find My (Apple)</b>
          </div>
          <div className="aaw-cs-item">
            <span>Resume:</span>
            <b>Arjun_Kumar_Apple_Tailored.pdf (98% ATS)</b>
          </div>
        </div>
        <button type="button" className="aaw-btn aaw-btn-mint" tabIndex={-1}>
          ✓ Submit Application
        </button>
        <div className="aaw-done-row">
          <button type="button" className="aaw-btn aaw-btn-outline" tabIndex={-1}>
            👁 Review
          </button>
          <button type="button" className="aaw-btn aaw-btn-cancel" tabIndex={-1}>
            ✗ Cancel
          </button>
        </div>
        <div className="aaw-sync">
          <CheckCircle2 size={15} />
          <span>Auto-syncs application status, timestamp, and tailored resume to your Web Tracker</span>
        </div>
      </div>
    </div>
  );
}

const SCENES = [JobBoardScene, FormScene, VaultScene, ConfirmScene];

/* ------------------------------------------------------------------ */
/* Mac Browser Window Mockup                                          */
/* ------------------------------------------------------------------ */

const BrowserWindow = memo(function BrowserWindow({ active, onOpen }) {
  const s = STEPS[active];
  return (
    <div className="aaw-window">
      <div className="aaw-chrome">
        <div className="aaw-dots" aria-hidden="true">
          <i className="aaw-dot aaw-dot-r" />
          <i className="aaw-dot aaw-dot-y" />
          <i className="aaw-dot aaw-dot-g" />
        </div>
        <div className="aaw-url">
          <Globe size={13} />
          <span key={active} className="aaw-url-text">{s.url}</span>
        </div>
        <div className="aaw-live-pill">
          <span className="aaw-live-dot" />
          <span>COPILOT</span>
        </div>
      </div>
      <div className="aaw-viewport">
        {SCENES.map((Scene, i) => (
          <div
            key={i}
            className={`aaw-scene${i === active ? ' is-active' : i < active ? ' is-prev' : ' is-next'}`}
            aria-hidden={i !== active}
          >
            <Scene onOpen={onOpen} />
          </div>
        ))}
        <span className="aaw-glow" data-step={active} aria-hidden="true" />
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Main AutoApplyWalkthrough Component                                */
/* ------------------------------------------------------------------ */

export default function AutoApplyWalkthrough({ onOpen }) {
  const [activeStep, setActiveStep] = useState(0);
  const runwayRef = useRef(null);
  const stageRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 960);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Sticky Scroll Engine: Pins section for 400vh, smoothly drives bottom-to-top steps
  useEffect(() => {
    if (isMobile) return undefined;
    let raf = 0;

    const handleScroll = () => {
      raf = 0;
      const el = runwayRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const totalScroll = rect.height - window.innerHeight;
      if (totalScroll <= 0) return;

      // Scrolled ratio from 0.0 to 1.0
      const scrolled = -rect.top;
      const progress = Math.min(1, Math.max(0, scrolled / totalScroll));

      // Write the continuous progress straight to CSS. This keeps the pinned
      // stage/tabs animation at 60fps without re-rendering every scroll frame.
      const stage = stageRef.current;
      if (stage) {
        const scaled = progress * STEPS.length;
        stage.style.setProperty('--aaw-progress', progress.toFixed(4));
        stage.style.setProperty('--aaw-step-fill', (scaled - Math.floor(scaled)).toFixed(4));
        stage.style.setProperty('--aaw-step-index', String(Math.min(STEPS.length - 1, Math.floor(scaled))));
      }

      // Maps seamlessly to 4 steps (0, 1, 2, 3)
      const nextStep = Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length));
      setActiveStep((prev) => (prev !== nextStep ? nextStep : prev));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(handleScroll);
    };

    handleScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isMobile]);

  // Click handler to smoothly scroll to any step
  const goToStep = useCallback((index) => {
    setActiveStep(index);
    if (!runwayRef.current) return;

    // On small screens the section is not pinned — just reveal the preview.
    if (isMobile) {
      stageRef.current
        ?.querySelector('.aaw-stage-col')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const el = runwayRef.current;
    const rect = el.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const runwayTop = scrollTop + rect.top;
    const totalScroll = el.offsetHeight - window.innerHeight;
    if (totalScroll <= 0) return;

    // Land in the middle of the requested step's scroll slice.
    const targetY = runwayTop + ((index + 0.5) / STEPS.length) * totalScroll;
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }, [isMobile]);

  return (
    <section className="aaw-runway" id="resume" ref={runwayRef} aria-labelledby="aaw-heading">
      <div className="aaw-pinned-stage" ref={stageRef}>
        {/* Header with generous top padding to clear floating navbar */}
        <header className="aaw-header">
          <span className="hmz-kicker">AUTO APPLY COPILOT</span>
          <h2 id="aaw-heading" className="aaw-heading">
            How Auto Apply works on <em>autopilot.</em>
          </h2>
          <p className="aaw-lede">
            HAMZO detects the job, autofills 15+ fields, attaches your tailored ATS resume, and asks your confirmation before submission.
          </p>
        </header>

        {/* 2-Column Split: Clean Left Step (Bottom to Top Motion) + Right Mac Window Mockup */}
        <div className="aaw-grid">
          {/* Left Column: Moving Steps (Bottom to Top animation, clean typography like Uplers) */}
          <div className="aaw-steps-col">
            <div className="aaw-steps-stack">
              {STEPS.map((step, i) => {
                let state = 'is-upcoming';
                if (i === activeStep) state = 'is-active';
                else if (i < activeStep) state = 'is-passed';

                return (
                  <div key={step.n} className={`aaw-step-item ${state}`}>
                    <div className="aaw-step-badge-row">
                      <span className="aaw-step-badge">{step.n}</span>
                      <h3 className="aaw-step-title">{step.title}</h3>
                    </div>
                    <ul className="aaw-step-bullets">
                      {step.points.map((p) => (
                        <li key={p}>
                          <span className="aaw-step-dot" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Interactive Mac Window Preview */}
          <div className="aaw-stage-col">
            <BrowserWindow active={activeStep} onOpen={onOpen} />
          </div>
        </div>

        {/* Bottom Pinned Tabs (Matching Uplers bottom design) */}
        <div className="aaw-bottom-tabs">
          <div className="aaw-tabs-row" role="tablist" aria-label="Walkthrough steps">
            {STEPS.map((step, i) => {
              const isTabActive = i === activeStep;
              return (
                <button
                  key={step.n}
                  type="button"
                  role="tab"
                  aria-selected={isTabActive}
                  className={`aaw-tab-btn ${isTabActive ? 'is-active' : ''}`}
                  style={{ '--i': i }}
                  onClick={() => goToStep(i)}
                >
                  <span className="aaw-tab-label">
                    <span className="aaw-tab-num">{step.n}.</span> {step.tab}
                  </span>
                  <span className="aaw-tab-track">
                    <span className="aaw-tab-fill" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
