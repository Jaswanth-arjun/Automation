import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BadgeCheck, CalendarDays, CreditCard, Crown, Gem, Loader2, RefreshCw,
  ShieldCheck, Sparkles, TriangleAlert, Zap, Clock, Ban, BellRing,
} from 'lucide-react';
import { applicationStore } from '../lib/api';
import { billingStore, runCheckout } from '../lib/billing';
import './Subscription.css';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const formatDate = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const daysLeft = (iso) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
};

const SOURCE_LABEL = {
  free: 'Free plan',
  razorpay: 'Razorpay subscription',
  admin: 'Admin granted',
  legacy: 'Full access',
};

const STATUS_LABEL = {
  active: 'Active',
  pending_cancel: 'Cancels at period end',
  cancelled: 'Cancelled',
  expired: 'Expired',
  superseded: 'Replaced by a newer plan',
  granted: 'Granted',
};

function UsageBar({ item }) {
  const unlimited = item.limit === null;
  return (
    <div className={`sub-usage-item ${unlimited ? 'is-unlimited' : ''}`}>
      <div className="sub-usage-top">
        <span className="sub-usage-label">{item.label}</span>
        <span className="sub-usage-count">
          {unlimited ? (
            <><b>{item.used}</b> used · Unlimited</>
          ) : (
            <><b>{item.used}</b> / {item.limit}</>
          )}
        </span>
      </div>
      <div className="sub-bar">
        <span style={{ width: `${unlimited ? 100 : item.percent}%` }} className={unlimited ? 'is-unlimited' : ''} />
      </div>
      <span className="sub-usage-period">
        {item.period === 'day' ? 'Resets daily' : item.period === 'week' ? 'Resets weekly' : 'Resets monthly'}
        {!unlimited && item.remaining === 0 ? ' · limit reached' : ''}
      </span>
    </div>
  );
}

export default function Subscription() {
  const [params] = useSearchParams();
  const preselected = params.get('plan') === 'yearly' ? 'yearly' : 'monthly';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cycle, setCycle] = useState(preselected);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [notConfigured, setNotConfigured] = useState(false);

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const res = await billingStore.me();
      setData(res);
      setNotConfigured(res?.payments?.configured === false);
    } catch (err) {
      setError(err.message || 'Could not load your subscription.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 4600);
    return () => clearTimeout(timer);
  }, [toast]);

  const alerts = useMemo(() => {
    try {
      const rows = applicationStore.getAll();
      return rows
        .filter((row) => /interview|offer|shortlist/i.test(String(row.status || '')))
        .slice(0, 6)
        .map((row) => ({
          id: row.id,
          title: row.title || 'Role',
          company: row.company || '',
          status: row.status,
          at: row.lastActivity || row.appliedAt || '',
        }));
    } catch {
      return [];
    }
  }, [data]);

  const plan = data?.plan || null;
  const isPro = Boolean(plan?.isPro);
  const premiumEnabled = data?.premiumEnabled !== false;
  const subscription = data?.subscription || null;
  const grant = data?.grant || null;
  const usage = data?.usage || [];
  const payments = data?.payments || [];
  const pricing = data?.pricing || {};
  const left = daysLeft(subscription?.expiryDate);

  const startCheckout = async (chosen = cycle) => {
    setBusy('checkout');
    setToast('');
    try {
      const verified = await runCheckout({
        cycle: chosen,
        user: data?.user,
        onProgress: (message) => setToast(message),
      });
      setToast('Payment verified — Pro is active.');
      if (verified?.subscription) setData(verified.subscription);
      await load({ quiet: true });
    } catch (err) {
      if (err?.code === 'CHECKOUT_DISMISSED') {
        setToast('Checkout closed — no payment was taken.');
      } else if (err?.status === 503 || err?.code === 'PAYMENTS_NOT_CONFIGURED') {
        setNotConfigured(true);
        setError(err.message || 'Payments are not configured yet.');
      } else {
        setError(err.message || 'Payment could not be completed.');
      }
    } finally {
      setBusy('');
    }
  };

  const cancelPlan = async () => {
    if (!window.confirm('Cancel Pro? You keep Pro access until the end of the paid period.')) return;
    setBusy('cancel');
    try {
      await billingStore.cancel('Cancelled from My Plan');
      setToast('Cancellation scheduled — access continues until the period ends.');
      await load({ quiet: true });
    } catch (err) {
      setError(err.message || 'Could not cancel the subscription.');
    } finally {
      setBusy('');
    }
  };

  const resumePlan = async () => {
    setBusy('resume');
    try {
      await billingStore.resume();
      setToast('Welcome back — auto-renewal is on again.');
      await load({ quiet: true });
    } catch (err) {
      setError(err.message || 'Could not resume the subscription.');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="sub-page">
        <div className="sub-loading"><Loader2 size={20} className="spin" /> Loading your plan…</div>
      </div>
    );
  }

  return (
    <div className="sub-page">
      <header className="sub-head">
        <div>
          <span className="sub-eyebrow"><CreditCard size={12} /> Billing</span>
          <h1>My plan</h1>
          <p>Track what your plan unlocks, how much you have used this month, and your payment history.</p>
        </div>
        <button type="button" className="sub-btn ghost" onClick={() => load()} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {!premiumEnabled && (
        <div className="sub-banner is-info">
          <ShieldCheck size={16} />
          <div>
            <strong>Premium plans are switched off</strong>
            <span>While the administrator keeps subscriptions off, every feature stays available exactly as before.</span>
          </div>
        </div>
      )}

      {error && (
        <div className="sub-banner is-warn">
          <TriangleAlert size={16} />
          <div>
            <strong>{error}</strong>
            <span>You can retry, or contact support if this keeps happening.</span>
          </div>
          <button type="button" className="sub-btn ghost" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      <section className={`sub-hero ${isPro ? 'is-pro' : ''}`}>
        <div className="sub-hero-main">
          <span className="sub-plan-badge">
            {isPro ? <Crown size={13} /> : <Zap size={13} />}
            {plan?.name || (isPro ? 'Pro' : 'Free')}
          </span>
          <h2>{isPro ? 'Pro is active' : 'You are on the Free plan'}</h2>
          <p>
            {isPro
              ? plan?.source === 'admin'
                ? 'Your Pro access was granted by an administrator — no payment is involved.'
                : 'Thanks for going Pro. Every feature and limit below is unlocked on this account.'
              : 'You have full access to the job board, match scores and tracker. Upgrade for more AI actions and every discovered contact.'}
          </p>

          <div className="sub-hero-facts">
            <span><ShieldCheck size={12} /> {SOURCE_LABEL[plan?.source] || plan?.source}</span>
            {isPro && plan?.model && <span><Sparkles size={12} /> {plan.model}</span>}
            {subscription && <span><CalendarDays size={12} /> {STATUS_LABEL[subscription.status] || subscription.status}</span>}
          </div>

          <div className="sub-hero-actions">
            {!isPro && premiumEnabled && (
              <button type="button" className="sub-btn primary" onClick={() => startCheckout(cycle)} disabled={busy === 'checkout'}>
                {busy === 'checkout' ? <Loader2 size={15} className="spin" /> : <Gem size={15} />}
                {busy === 'checkout' ? 'Opening checkout…' : 'Upgrade to Pro'}
              </button>
            )}
            {isPro && subscription && plan?.source === 'razorpay' && (
              <>
                {subscription.cancelAtPeriodEnd ? (
                  <button type="button" className="sub-btn primary" onClick={resumePlan} disabled={busy === 'resume'}>
                    <RefreshCw size={14} /> Keep my Pro
                  </button>
                ) : (
                  <button type="button" className="sub-btn ghost" onClick={cancelPlan} disabled={busy === 'cancel'}>
                    <Ban size={14} /> Cancel renewal
                  </button>
                )}
                <button type="button" className="sub-btn ghost" onClick={() => startCheckout(subscription.cycle === 'yearly' ? 'yearly' : 'monthly')}>
                  <CreditCard size={14} /> Renew / extend
                </button>
              </>
            )}
            {isPro && plan?.source === 'admin' && (
              <span className="sub-grant-note">
                <BadgeCheck size={13} /> Granted {formatDate(grant?.grantDate)}
                {grant?.expiryDate ? ` · expires ${formatDate(grant.expiryDate)}` : ' · no expiry'}
              </span>
            )}
          </div>
        </div>

        <div className="sub-hero-side">
          <div className="sub-fact">
            <span>Billing cycle</span>
            <strong>{subscription ? (subscription.cycle === 'yearly' ? 'Yearly' : 'Monthly') : isPro ? 'Admin grant' : '—'}</strong>
          </div>
          <div className="sub-fact">
            <span>Started</span>
            <strong>{formatDate(subscription?.startDate || grant?.grantDate)}</strong>
          </div>
          <div className="sub-fact">
            <span>{subscription?.cancelAtPeriodEnd ? 'Access ends' : 'Next renewal'}</span>
            <strong>{formatDate(subscription?.expiryDate || grant?.expiryDate)}</strong>
          </div>
          <div className="sub-fact">
            <span>Days remaining</span>
            <strong>{isPro && left !== null ? `${left} day${left === 1 ? '' : 's'}` : '—'}</strong>
          </div>
        </div>
      </section>

      <section className="sub-card">
        <header className="sub-card-head">
          <div>
            <h2>Usage this month</h2>
            <span>Counters reset automatically — upgrading never resets them, and neither does downgrading.</span>
          </div>
          <span className={`sub-pill ${isPro ? 'is-pro' : ''}`}>{isPro ? 'Pro limits' : 'Free limits'}</span>
        </header>

        {usage.length ? (
          <div className="sub-usage-grid">
            {usage.map((item) => <UsageBar key={item.feature} item={item} />)}
          </div>
        ) : (
          <p className="sub-empty">No metered features on this account yet.</p>
        )}

        <div className="sub-limit-note">
          <Zap size={13} />
          <span>
            Email referral campaigns: {plan?.unlockedContacts === null ? 'every discovered contact is unlocked.' : `first ${plan?.unlockedContacts ?? 5} contacts per company are unlocked; the rest are locked.`}
          </span>
        </div>
      </section>

      <section className="sub-card">
        <header className="sub-card-head">
          <div>
            <h2>Recruiter interview alerts</h2>
            <span>{isPro ? 'Instant priority alerts from your tracked applications.' : 'In-app alerts from your tracker. Pro refreshes these instantly.'}</span>
          </div>
          <span className={`sub-pill ${isPro ? 'is-pro' : ''}`}><BellRing size={11} /> {isPro ? 'Instant' : 'Standard'}</span>
        </header>

        {alerts.length ? (
          <ul className="sub-alerts">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <span className="sub-alert-dot" />
                <div>
                  <strong>{alert.title}</strong>
                  <small>{alert.company || 'Company'} · {alert.status}</small>
                </div>
                <span className="sub-alert-time"><Clock size={11} /> {formatDate(alert.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub-empty">No interview or offer updates detected yet. They appear here as your tracker picks up replies.</p>
        )}
      </section>

      {!isPro && premiumEnabled && (
        <section className="sub-card sub-upgrade">
          <header className="sub-card-head">
            <div>
              <h2>Upgrade to Pro</h2>
              <span>Same Pro features on monthly and yearly — yearly simply costs less.</span>
            </div>
          </header>

          <div className="sub-cycles">
            {['monthly', 'yearly'].map((option) => {
              const yearly = option === 'yearly';
              const price = yearly ? pricing.yearly : pricing.monthly;
              const perMonth = yearly ? Math.round((pricing.yearly || 0) / 12) : pricing.monthly;
              return (
                <button
                  key={option}
                  type="button"
                  className={`sub-cycle ${cycle === option ? 'is-active' : ''}`}
                  onClick={() => setCycle(option)}
                >
                  <span className="sub-cycle-name">{yearly ? 'Yearly' : 'Monthly'}</span>
                  <strong>{money(price)}</strong>
                  <small>{yearly ? `${money(perMonth)}/month · save ${money(pricing.savings?.saved || 0)}` : 'Billed every month'}</small>
                  {yearly && pricing.savings?.percent > 0 && <em>Save {pricing.savings.percent}%</em>}
                </button>
              );
            })}
          </div>

          <div className="sub-upgrade-foot">
            <button
              type="button"
              className="sub-btn primary"
              onClick={() => startCheckout(cycle)}
              disabled={busy === 'checkout' || notConfigured}
            >
              {busy === 'checkout' ? <Loader2 size={15} className="spin" /> : <Gem size={15} />}
              {notConfigured ? 'Payments not configured' : `Upgrade — ${money(cycle === 'yearly' ? pricing.yearly : pricing.monthly)}`}
            </button>
            <span><ShieldCheck size={12} /> Razorpay secure checkout · cancel anytime</span>
          </div>
          {notConfigured && (
            <p className="sub-empty">
              Add <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> on the server to enable checkout.
              Until then, an administrator can grant Pro manually from the admin console.
            </p>
          )}
        </section>
      )}

      <section className="sub-card">
        <header className="sub-card-head">
          <div>
            <h2>Payment history</h2>
            <span>Only real Razorpay transactions appear here. Admin grants never show a fake payment.</span>
          </div>
        </header>

        {payments.length ? (
          <div className="sub-table-wrap">
            <table className="sub-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Razorpay payment</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatDate(payment.paidAt || payment.createdAt)}</td>
                    <td>{payment.plan === 'yearly' ? 'Pro yearly' : 'Pro monthly'}</td>
                    <td>{money(payment.amount)}</td>
                    <td>
                      <span className={`sub-status is-${payment.status}`}>{payment.status}</span>
                    </td>
                    <td className="sub-mono">{payment.razorpayPaymentId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sub-empty">No payments yet. {isPro ? 'This access comes from an admin grant.' : ''}</p>
        )}
      </section>

      {toast && <div className="sub-toast">{toast}</div>}
    </div>
  );
}
