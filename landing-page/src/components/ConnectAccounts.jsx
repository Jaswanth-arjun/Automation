import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ShieldCheck, Check, ArrowUpRight, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConnectStatus } from '../lib/connectStatus';
import './ConnectAccounts.css';

const LinkedinIcon = ({ size = 17 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

export default function ConnectAccounts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { loading, error, mail, linkedin } = useConnectStatus(user?.id);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const mailConnected = mail?.state === 'connected';
  const liConnected = linkedin?.state === 'connected';
  const done = (mailConnected ? 1 : 0) + (liConnected ? 1 : 0);

  // Nothing to nudge, backend unreachable, or still resolving: stay invisible
  // so the dashboard layout never shifts for users who are already set up.
  if (loading || error || !mail || !linkedin || done === 2) return null;

  const handleConnectMail = async () => {
    setNotice('');
    setBusy('mail');
    try {
      const res = await api.getAuthUrl();
      if (res?.authUrl) {
        window.location.href = res.authUrl;
        return;
      }
      setNotice('Google did not return an authorization URL. Try again from the Mail page.');
    } catch (err) {
      setNotice(err.message || 'Could not start Gmail sign-in. Is the backend running?');
    }
    setBusy('');
  };

  const linkedinLabel =
    linkedin.state === 'expired' ? 'Reconnect' : linkedin.state === 'pending' ? 'Finish setup' : 'Connect';
  const linkedinMeta =
    linkedin.state === 'expired'
      ? 'Session expired — reconnect to keep sending invites.'
      : linkedin.state === 'pending'
        ? 'Login window open — finish signing in to LinkedIn.'
        : 'Send connection invites from your own LinkedIn session.';

  return (
    <section className="cca-card" aria-labelledby="cca-title">
      <div className="cca-head">
        <div className="cca-head-text">
          <span className="cca-eyebrow">
            <span className="cca-eyebrow-dot" /> Getting started
          </span>
          <h2 id="cca-title">Connect your accounts</h2>
          <p>
            HAMZO runs on your own Gmail and LinkedIn. Connect them once and you can reply to recruiters and
            send invites without leaving the dashboard.
          </p>
        </div>
        <div className="cca-progress" aria-label={`${done} of 2 accounts connected`}>
          <span className="cca-progress-label">
            <strong>{done}</strong> of 2 connected
          </span>
          <span className="cca-progress-track">
            <span className="cca-progress-fill" style={{ width: `${(done / 2) * 100}%` }} />
          </span>
        </div>
      </div>

      <div className="cca-rows">
        <div className={`cca-row ${mailConnected ? 'is-done' : ''}`}>
          <div className="cca-row-icon is-mail">
            <Mail size={17} />
          </div>
          <div className="cca-row-text">
            <strong>Gmail</strong>
            <span>
              {mailConnected
                ? mail.email || 'Connected — Hamzo can draft and send recruiter replies.'
                : 'Draft and send recruiter replies straight from your inbox.'}
            </span>
          </div>
          <div className="cca-row-action">
            {mailConnected ? (
              <span className="cca-chip">
                <Check size={12} /> Connected
              </span>
            ) : (
              <button
                type="button"
                className="cca-btn is-primary"
                onClick={handleConnectMail}
                disabled={busy === 'mail'}
              >
                {busy === 'mail' ? <Loader2 size={13} className="cca-spin" /> : null}
                Connect Gmail <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </div>

        <div className={`cca-row ${liConnected ? 'is-done' : ''}`}>
          <div className="cca-row-icon is-linkedin">
            <LinkedinIcon />
          </div>
          <div className="cca-row-text">
            <strong>LinkedIn</strong>
            <span>{liConnected ? linkedin.name || 'Connected — invites go out from your own session.' : linkedinMeta}</span>
          </div>
          <div className="cca-row-action">
            {liConnected ? (
              <span className="cca-chip">
                <Check size={12} /> Connected
              </span>
            ) : (
              <button
                type="button"
                className={`cca-btn ${linkedin.state === 'expired' ? 'is-warn' : ''}`}
                onClick={() => navigate('/dashboard/linkedin')}
              >
                {linkedinLabel} <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <p className="cca-notice">
          <AlertCircle size={13} /> {notice}
        </p>
      )}

      <p className="cca-foot">
        <ShieldCheck size={13} />
        You stay in control — HAMZO never asks for your LinkedIn password and only sends what you approve.
      </p>
    </section>
  );
}
