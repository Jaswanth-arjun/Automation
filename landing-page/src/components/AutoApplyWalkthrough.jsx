import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Globe, ArrowRight, FileText, CheckCircle2, Check, Sparkles } from 'lucide-react';
import PawLogo from './PawLogo';
import './AutoApplyWalkthrough.css';

/* ------------------------------------------------------------------ */
/* Step Definitions                                                   */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    n: '1',
    tab: 'Extension',
    kicker: 'STEP 1 · AUTO-DETECT',
    title: 'Detects on any job board',
    points: [
      'Works on LinkedIn, Naukri, Greenhouse, Lever, Ashby, Workday & company career sites',
      'HAMZO Chrome Extension activates automatically with 1 click',
    ],
    url: 'linkedin.com/jobs • HAMZO Apply Copilot',
    urlTag: 'Extension Active',
  },
  {
    n: '2',
    tab: 'Autofill + Resume',
    kicker: 'STEP 2 · SMART FILL',
    title: 'Autofills & attaches tailored resume',
    points: [
      '15+ standard and complex fields populated in seconds',
      'Generates and injects a keyword-tailored 1-page ATS PDF directly into the file upload',
    ],
    url: 'greenhouse.io/apple/apply • Auto-Fill',
    urlTag: 'Greenhouse Form',
  },
  {
    n: '3',
    tab: 'Vault Memory',
    kicker: 'STEP 3 · VAULT MEMORY',
    title: 'Learns unseen questions (Vault)',
    points: [
      'Never guesses: asks missing employer questions in a swift prompt',
      'Saves answers permanently to your private Vault — never asks again',
    ],
    url: 'Vault • Instant Memory',
    urlTag: 'Smart Vault',
  },
  {
    n: '4',
    tab: 'Review & Sync',
    kicker: 'STEP 4 · ZERO GUESSING',
    title: 'You confirm before submitting',
    points: [
      'Zero silent submissions: full review control on every application',
      'Auto-syncs application status, timestamp, and tailored resume to your Web Tracker',
    ],
    url: 'Review • Ready to Submit',
    urlTag: 'Review Confirmation',
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
          <div key={j.co} className={`aaw-job-row${i === 0 ? ' is-sel' : ''}`}>
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
          <div className="aaw-va-row">
            <span className="lbl">Notice Period</span>
            <span className="val">15 days</span>
            <span className="src">From Vault</span>
          </div>
          <div className="aaw-va-row">
            <span className="lbl">Expected CTC</span>
            <span className="val">₹24–30 LPA</span>
            <span className="src">From Profile</span>
          </div>
          <div className="aaw-va-row">
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
          <div key={i} className={`aaw-scene${i === active ? ' is-active' : ''}`} aria-hidden={i !== active}>
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
  const stepRefs = useRef([]);
  const fillRefs = useRef([]);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 900);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Scroll spy: maps scroll position across the 4 steps
  useEffect(() => {
    if (isMobile) return undefined;
    let raf = 0;

    const update = () => {
      raf = 0;
      const mid = window.innerHeight / 2;
      const els = stepRefs.current;
      let p = els.length;
      for (let i = 0; i < els.length; i += 1) {
        if (!els[i]) continue;
        const r = els[i].getBoundingClientRect();
        if (mid < r.top) { p = i; break; }
        if (mid <= r.bottom) { p = i + (mid - r.top) / r.height; break; }
      }
      const active = Math.min(Math.floor(p), STEPS.length - 1);
      setActiveStep((prev) => (prev !== active ? active : prev));
      fillRefs.current.forEach((el, i) => {
        if (el) el.style.transform = `scaleX(${Math.min(1, Math.max(0, p - i)).toFixed(3)})`;
      });
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isMobile]);

  const goToStep = useCallback((index) => {
    setActiveStep(index);
    stepRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const onTabKeyDown = (e) => {
    let next = null;
    if (e.key === 'ArrowRight') next = (activeStep + 1) % STEPS.length;
    if (e.key === 'ArrowLeft') next = (activeStep - 1 + STEPS.length) % STEPS.length;
    if (next !== null) {
      e.preventDefault();
      goToStep(next);
      document.getElementById(`aaw-tab-${next}`)?.focus();
    }
  };

  return (
    <section className="aaw" id="resume" aria-labelledby="aaw-heading">
      <div className="aaw-container">
        <header className="aaw-header">
          <span className="hmz-kicker">AUTO APPLY COPILOT</span>
          <h2 id="aaw-heading" className="aaw-heading">
            How Auto Apply works on <em>autopilot.</em>
          </h2>
          <p className="aaw-lede">
            HAMZO detects the job, autofills 15+ fields, attaches your tailored ATS resume, and asks your confirmation before submission.
          </p>
        </header>

        <div className="aaw-grid">
          <ol className="aaw-steps">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                ref={(el) => (stepRefs.current[i] = el)}
                data-index={i}
                className={`aaw-step${i === activeStep ? ' is-active' : ''}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className="aaw-step-body"
                  onClick={() => goToStep(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      goToStep(i);
                    }
                  }}
                  aria-current={i === activeStep ? 'step' : undefined}
                >
                  <div className="aaw-title-row">
                    <span className="aaw-badge" aria-hidden="true">{i + 1}</span>
                    <div>
                      <span className="aaw-step-kicker">{step.kicker}</span>
                      <h3 className="aaw-step-title">{step.title}</h3>
                    </div>
                  </div>
                  <ul className="aaw-points">
                    {step.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>

                {isMobile && (
                  <div className="aaw-mobile-preview">
                    <BrowserWindow active={i} onOpen={onOpen} />
                  </div>
                )}
              </li>
            ))}
            <div className="aaw-cta-wrap">
              <button className="hmz-cta" onClick={() => onOpen?.('/dashboard/resume')}>
                Get Chrome Extension <ArrowRight size={15} />
              </button>
              <span className="aaw-cta-note">Free to start · No credit card required</span>
            </div>
          </ol>

          {!isMobile && (
            <div className="aaw-stage-col">
              <BrowserWindow active={activeStep} onOpen={onOpen} />
            </div>
          )}
        </div>
      </div>

      {!isMobile && (
        <nav className="aaw-progress" aria-label="Walkthrough steps">
          <div className="aaw-tabs" role="tablist" onKeyDown={onTabKeyDown}>
            {STEPS.map((step, i) => (
              <button
                key={step.tab}
                id={`aaw-tab-${i}`}
                type="button"
                role="tab"
                aria-selected={i === activeStep}
                tabIndex={i === activeStep ? 0 : -1}
                className={`aaw-tab${i === activeStep ? ' is-active' : ''}`}
                onClick={() => goToStep(i)}
              >
                <span className="aaw-track">
                  <span className="aaw-fill" ref={(el) => (fillRefs.current[i] = el)} />
                </span>
                <span className="aaw-tab-label">{step.tab}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
    </section>
  );
}
