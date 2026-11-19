import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Check, ChevronDown, Sparkles, Zap, ShieldCheck, Lock, Gem,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { billingStore } from '../lib/billing';
import './PricingSection.css';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

function useInView() {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.16 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}

function FeatureRow({ label, value }) {
  return (
    <li className="hp-feature">
      <span className="hp-check" aria-hidden="true"><Check size={11} strokeWidth={3.5} /></span>
      <span className="hp-feature-label">{label}</span>
      <span className="hp-feature-value">{value}</span>
    </li>
  );
}

export default function PricingSection({ onGetStarted }) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [ref, inView] = useInView();
  const [data, setData] = useState(null);
  const [cycle, setCycle] = useState('monthly');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    billingStore.plans()
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load plans.'); })
      .finally(() => {});
    return () => { cancelled = true; };
  }, []);

  // Premium switched off by the admin → the pricing section disappears entirely.
  if (data && !data.premiumEnabled) return null;
  if (error && !data) return null;

  const limits = data?.limits || {};
  const freeLimits = limits.free || {};
  const proLimits = limits.pro || {};
  const unlimited = (value) => (value === null || value === undefined ? 'Unlimited' : value);
  const contactFree = data?.contactUnlockFree ?? 5;
  const savings = data?.savings || { saved: 0, percent: 0, twelve: 0 };
  const monthly = Number(data?.prices?.pro_monthly || 0);
  const yearly = Number(data?.prices?.pro_yearly || 0);
  const paymentsReady = data?.payments?.configured !== false;

  const goPro = () => {
    if (!isAuthenticated) {
      onGetStarted?.();
      return;
    }
    navigate(`/dashboard/subscription?plan=${cycle}`);
  };

  const planFree = data?.plans?.find((p) => p.id === 'free');
  const planPro = data?.plans?.find((p) => p.id === 'pro');
  const freeModel = planFree?.aiModel || 'gemini-2.5-flash';
  const proModel = planPro?.aiModel || 'gemini-2.5-pro';

  const freeRows = [
    { label: 'AI resume tailoring', value: `${unlimited(freeLimits.resume_tailor)} / month` },
    { label: 'AI communication', value: `${unlimited(freeLimits.ai_comm)} / month` },
    { label: 'LinkedIn campaigns', value: `${unlimited(freeLimits.linkedin_campaign)} / month` },
    { label: 'Referral requests', value: `${unlimited(freeLimits.linkedin_request)} / month` },
    { label: 'Chrome auto-apply', value: `${unlimited(freeLimits.auto_apply)} / month` },
    { label: 'Contacts per company', value: `${contactFree} unlocked` },
    { label: 'AI model', value: freeModel },
    { label: 'Interview alerts', value: 'In-app' },
  ];

  const proRows = [
    { label: 'AI resume tailoring', value: `${unlimited(proLimits.resume_tailor)} / month` },
    { label: 'AI communication', value: `${unlimited(proLimits.ai_comm)} / month` },
    { label: 'LinkedIn campaigns', value: 'Unlimited' },
    { label: 'Referral requests', value: '~100 / week' },
    { label: 'Chrome auto-apply', value: 'Unlimited' },
    { label: 'Contacts per company', value: 'All unlocked' },
    { label: 'AI model', value: proModel },
    { label: 'Interview alerts', value: 'Instant' },
  ];

  const comparison = [
    {
      group: 'Job discovery',
      rows: [
        ['Job board', 'Unlimited', 'Unlimited'],
        ['Saved jobs', 'Unlimited', 'Unlimited'],
        ['Job match score', 'Unlimited', 'Unlimited'],
      ],
    },
    {
      group: 'Profile & resume',
      rows: [
        ['AI resume tailoring', `${unlimited(freeLimits.resume_tailor)} / month`, `${unlimited(proLimits.resume_tailor)} / month`],
        ['ATS report + one-page PDF', 'Every tailor', 'Every tailor'],
        ['Resume templates', 'All available', 'All available'],
      ],
    },
    {
      group: 'AI engine',
      rows: [
        ['Model', freeModel, proModel],
        ['AI communication', `${unlimited(freeLimits.ai_comm)} / month`, `${unlimited(proLimits.ai_comm)} / month`],
      ],
    },
    {
      group: 'Referral outreach',
      rows: [
        ['Contacts per company', `${contactFree} unlocked`, 'All unlocked'],
        ['Hunter.io + admin verified emails', '—', 'Included'],
        ['LinkedIn campaigns', `${unlimited(freeLimits.linkedin_campaign)} / month`, 'Unlimited'],
        ['LinkedIn requests', `${unlimited(freeLimits.linkedin_request)} / month`, '~100 / week'],
        ['Chrome extension auto-apply', `${unlimited(freeLimits.auto_apply)} / month`, 'Unlimited'],
        ['Interview alerts', 'In-app dashboard', 'Instant priority'],
      ],
    },
  ];

  return (
    <section className={`hmz-pricing ${inView ? 'is-in' : ''}`} id="pricing" ref={ref}>
      <div className="hp-halo" aria-hidden="true" />
      <header className="hp-head">
        <span className="hmz-kicker">PRICING</span>
        <h2>Start free. Go <em>Pro</em> when referrals matter.</h2>
        <p>
          Real outreach from day one. Upgrade when you want every contact,
          the premium AI engine and unlimited auto-apply.
        </p>

        <div className="hp-toggle" role="group" aria-label="Billing period">
          <button
            type="button"
            className={cycle === 'monthly' ? 'is-active' : ''}
            onClick={() => setCycle('monthly')}
            aria-pressed={cycle === 'monthly'}
          >
            Monthly
          </button>
          <button
            type="button"
            className={cycle === 'yearly' ? 'is-active' : ''}
            onClick={() => setCycle('yearly')}
            aria-pressed={cycle === 'yearly'}
          >
            Yearly
            {savings.percent > 0 && <span className="hp-save-chip">Save {savings.percent}%</span>}
          </button>
        </div>
      </header>

      <div className="hp-grid">
        {/* ── Free ─────────────────────────────────────────── */}
        <article className="hp-card">
          <div className="hp-card-head">
            <span className="hp-plan-icon"><Zap size={18} /></span>
            <div className="hp-plan-name">
              <h3>Free</h3>
              <p>{planFree?.tagline || 'Everything you need to start getting noticed.'}</p>
            </div>
          </div>

          <div className="hp-price">
            <div className="hp-price-main">
              <strong>₹0</strong>
              <span>forever</span>
            </div>
            <p className="hp-price-sub">No card required — start in minutes.</p>
          </div>

          <button type="button" className="hp-cta ghost" onClick={() => onGetStarted?.()}>
            Get started — it&apos;s free
          </button>

          <div className="hp-includes">
            <span className="hp-includes-title">What&apos;s included</span>
            <ul className="hp-features">
              {freeRows.map((row) => (
                <FeatureRow key={row.label} label={row.label} value={row.value} />
              ))}
            </ul>
          </div>

          <p className="hp-card-foot">
            Job board, saved jobs, match score, tracker, PDF extraction and all resume templates.
          </p>
        </article>

        {/* ── Pro ──────────────────────────────────────────── */}
        <article className="hp-card is-featured">
          <span className="hp-badge"><Sparkles size={11} /> Most popular</span>

          <div className="hp-card-head">
            <span className="hp-plan-icon pro"><Gem size={18} /></span>
            <div className="hp-plan-name">
              <h3>Pro</h3>
              <p>{planPro?.tagline || 'Unlimited outreach to the people who can actually refer you.'}</p>
            </div>
          </div>

          <div className="hp-price">
            <div className="hp-price-main">
              <strong>{money(cycle === 'yearly' ? yearly : monthly)}</strong>
              <span>/{cycle === 'yearly' ? 'year' : 'month'}</span>
            </div>
            <p className="hp-price-sub">
              {cycle === 'yearly' ? (
                <>
                  {money(Math.round(yearly / 12))}/month billed yearly
                  {savings.saved > 0 && (
                    <em> · save {money(savings.saved)} vs {money(savings.twelve)} monthly</em>
                  )}
                </>
              ) : (
                <>Billed monthly · switch to yearly and save {money(savings.saved)}</>
              )}
            </p>
          </div>

          <button type="button" className="hp-cta primary" onClick={goPro}>
            Upgrade to Pro <ArrowUpRight size={16} />
          </button>
          {!paymentsReady && (
            <p className="hp-note">Secure checkout activates as soon as the payment gateway is configured.</p>
          )}

          <div className="hp-includes">
            <span className="hp-includes-title">Everything in Free, plus</span>
            <ul className="hp-features">
              {proRows.map((row) => (
                <FeatureRow key={row.label} label={row.label} value={row.value} />
              ))}
            </ul>
          </div>

          <p className="hp-card-foot">
            Hunter.io + admin-verified emails, every discovered contact and instant interview alerts.
          </p>
        </article>
      </div>

      <details className="hp-compare">
        <summary>
          <span>Compare every feature</span>
          <ChevronDown size={16} className="hp-compare-chevron" />
        </summary>
        <div className="hp-compare-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">Free</th>
                <th scope="col">Pro</th>
              </tr>
            </thead>
            {comparison.map((section) => (
              <tbody key={section.group}>
                <tr className="hp-compare-group">
                  <th scope="rowgroup" colSpan={3}>{section.group}</th>
                </tr>
                {section.rows.map(([label, free, pro]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{free}</td>
                    <td className="is-pro">{pro}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </details>

      <div className="hp-foot">
        <span><ShieldCheck size={13} /> Razorpay secure checkout</span>
        <span><Lock size={13} /> Cancel anytime — access stays until the period ends</span>
        <span><Check size={13} /> No job offers guaranteed — Pro improves your chances, not the outcome</span>
      </div>
    </section>
  );
}
