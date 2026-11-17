import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Hourglass,
  Loader2,
  Pause,
  Play,
  Square,
  UserCheck,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import './CampaignStatus.css';

const STATUS_META = {
  queued: { label: 'Queued', tone: 'warn' },
  running: { label: 'Running', tone: 'warn' },
  paused: { label: 'Paused', tone: 'neutral' },
  waiting: { label: 'Waiting', tone: 'accent' },
  needs_attention: { label: 'Needs Attention', tone: 'danger' },
  completed: { label: 'Campaign Completed', tone: 'success' },
  partially_completed: { label: 'Partially Completed', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
};

const STAGE_LABELS = {
  discovery: 'Discovering connections',
  replied: 'Stage 1 · Replied before',
  seen: 'Stage 2 · Seen, no reply',
  unseen: 'Stage 3 · Message not seen',
  never_messaged: 'Stage 4 · Never messaged',
  pending_invite: 'Stage 5 · Invite pending (skipped)',
  not_connected: 'Stage 6 · Sending invites',
  done: 'All stages finished',
};

const RESULT_LABEL = {
  success: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

const ACTIVE_STATUSES = ['queued', 'running', 'paused', 'waiting', 'needs_attention'];

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function CampaignStatus({
  variant = 'full',
  onNavigate,
  showLog = true,
  defaultOpenLog = false,
  onChange,
  campaignId = '',
  company = '',
  filterByCompany = false,
}) {
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [logOpen, setLogOpen] = useState(Boolean(defaultOpenLog));
  const socketRef = useRef(null);
  const campaignRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const boundRef = useRef(campaignId);
  const logTouchedRef = useRef(false);
  const autoOpenedRef = useRef(false);

  campaignRef.current = campaign;
  onChangeRef.current = onChange;
  if (campaignId) boundRef.current = campaignId;

  useEffect(() => {
    if (onChangeRef.current) onChangeRef.current(campaign);
  }, [campaign]);

  // The activity log opens itself as soon as a campaign starts running, so
  // clicking Start Campaign immediately shows what is being sent.
  useEffect(() => {
    if (!campaign || logTouchedRef.current || autoOpenedRef.current) return;
    if (!showLog || !campaign.people?.length) return;
    if (!['running', 'queued', 'waiting', 'needs_attention'].includes(campaign.status)) return;
    autoOpenedRef.current = true;
    setLogOpen(true);
  }, [campaign, showLog]);

  const load = useCallback(async () => {
    try {
      // A bound card (opened from a job) must show that job's campaign, not
      // whichever campaign happens to be newest.
      if (boundRef.current) {
        const res = await api.getCampaign(boundRef.current);
        setCampaign(res?.campaign || null);
        setError('');
        return;
      }

      const sameCompany = (item) => !filterByCompany || !company
        || String(item.company || '').toLowerCase() === String(company).toLowerCase();

      const res = await api.getActiveCampaign();
      const active = res?.active || null;
      if (active && sameCompany(active)) {
        setCampaign(active);
        setError('');
        return;
      }

      const list = await api.listCampaigns();
      const campaigns = (list?.campaigns || []).filter(sameCompany);
      setCampaign(campaigns[0] || null);
      setError('');
    } catch (err) {
      setError(err.message || 'Campaign status unavailable.');
    } finally {
      setLoading(false);
    }
  }, [filterByCompany, company]);

  useEffect(() => {
    load();
  }, [load, campaignId]);

  // Live updates: WebSocket push + polling fallback while a campaign is active
  useEffect(() => {
    let closed = false;
    let retry = null;
    let socket = null;

    const connect = () => {
      if (closed) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        socket = new WebSocket(`${protocol}://${window.location.host}/linkedin-api`);
      } catch {
        return;
      }
      socketRef.current = socket;

      socket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        const incoming = message.type === 'campaign_update'
          ? message.data
          : (message.type === 'init' ? message.data?.campaign : null);
        if (!incoming) return;
        // Never let another campaign overwrite a card that is bound to one job.
        if (boundRef.current && incoming.id !== boundRef.current) return;
        if (filterByCompany && company && String(incoming.company || '').toLowerCase() !== String(company).toLowerCase()) return;
        setCampaign((current) => (message.type === 'init' && current ? current : incoming));
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 5000);
      };
      socket.onerror = () => {};
    };

    connect();

    const poll = setInterval(() => {
      const status = campaignRef.current?.status;
      if (!status || ACTIVE_STATUSES.includes(status)) load();
    }, 7000);

    return () => {
      closed = true;
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [load]);

  const act = async (action) => {
    if (!campaign) return;
    setBusy(action);
    setError('');
    try {
      const handler = {
        pause: api.pauseCampaign,
        resume: api.resumeCampaign,
        stop: api.stopCampaign,
      }[action];
      const res = await handler(campaign.id);
      if (res?.campaign) setCampaign(res.campaign);
    } catch (err) {
      setError(err.message || `Could not ${action} the campaign.`);
    } finally {
      setBusy('');
    }
  };

  const stats = campaign?.stats || {};
  const total = stats.totalEligible || 0;
  const processed = stats.processed || 0;
  const remaining = stats.remaining != null ? stats.remaining : Math.max(0, total - processed);
  const progressPct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const meta = STATUS_META[campaign?.status] || STATUS_META.queued;
  const isActive = campaign && ACTIVE_STATUSES.includes(campaign.status);
  const isFinished = campaign && ['completed', 'partially_completed', 'failed'].includes(campaign.status);

  const people = useMemo(() => {
    const list = Array.isArray(campaign?.people) ? campaign.people : [];
    return [...list].reverse();
  }, [campaign]);

  const stageRows = useMemo(() => {
    const list = Array.isArray(campaign?.people) ? campaign.people : [];
    const order = ['replied', 'seen', 'unseen', 'never_messaged', 'pending_invite', 'not_connected'];
    return order
      .map((stage) => ({
        stage,
        label: STAGE_LABELS[stage],
        total: list.filter((p) => p.stage === stage).length,
        done: list.filter((p) => p.stage === stage && p.result).length,
      }))
      .filter((row) => row.total > 0);
  }, [campaign]);

  if (loading) {
    return (
      <div className={`cst cst-${variant}`}>
        <div className="cst-loading"><Loader2 className="spin" size={16} /> Loading campaign status…</div>
      </div>
    );
  }

  if (!campaign) {
    if (variant === 'compact') return null;
    return (
      <div className={`cst cst-${variant} cst-empty`}>
        <div className="cst-empty-title">
          <Users size={15} /> No referral campaign yet
        </div>
        <p>Start a campaign to message these connections in stage order — the activity log appears here as soon as it runs.</p>
      </div>
    );
  }

  return (
    <div className={`cst cst-${variant}`}>
      <div className="cst-head">
        <div className="cst-title">
          <span className="cst-name">{campaign.name}</span>
          <span className={`cst-pill is-${meta.tone}`}>{meta.label}</span>
        </div>
        <div className="cst-targets">
          <span><b>{campaign.company}</b> · {campaign.role || 'role not set'}</span>
        </div>
      </div>

      <div className="cst-stage-row">
        <span className="cst-stage">
          <Clock size={12} />
          {STAGE_LABELS[campaign.stage] || 'Preparing'}
        </span>
        <span className="cst-pct">{progressPct}%</span>
      </div>
      <div className="cst-progress"><span style={{ width: `${progressPct}%` }} /></div>

      <div className="cst-counts">
        <div className="cst-count"><b>{total}</b><span>Eligible</span></div>
        <div className="cst-count"><b>{processed}</b><span>Processed</span></div>
        <div className="cst-count"><b>{stats.messagesSent || 0}</b><span>Messages</span></div>
        <div className="cst-count"><b>{stats.invitesSent || 0}</b><span>Invites</span></div>
        <div className="cst-count"><b>{stats.skipped || 0}</b><span>Skipped</span></div>
        <div className="cst-count"><b>{stats.failed || 0}</b><span>Failed</span></div>
        <div className="cst-count"><b>{remaining}</b><span>Remaining</span></div>
      </div>

      {stageRows.length > 0 && (
        <div className="cst-stages">
          {stageRows.map((row) => (
            <div key={row.stage} className="cst-stage-row-item">
              <span className="cst-stage-label">{row.label}</span>
              <span className={`cst-stage-value ${row.done === row.total ? 'is-done' : ''}`}>
                {row.done}/{row.total}
              </span>
            </div>
          ))}
        </div>
      )}

      {(campaign.error || error) && (
        <div className={`cst-error ${campaign.status === 'needs_attention' ? 'is-attention' : ''}`}>
          <AlertTriangle size={13} />
          <div>
            <strong>
              {campaign.status === 'needs_attention'
                ? 'Needs your attention'
                : campaign.status === 'failed' ? 'Campaign failed' : 'Notice'}
            </strong>
            <span>{error || campaign.error}</span>
            {campaign.errorStage && <em>While running: {STAGE_LABELS[campaign.errorStage] || campaign.errorStage}</em>}
          </div>
        </div>
      )}

      {campaign.status === 'completed' && (
        <div className="cst-done">
          <CheckCircle2 size={14} />
          <span>
            Campaign completed — {stats.messagesSent || 0} people messaged, {stats.invitesSent || 0} connection requests sent,
            {' '}{stats.skipped || 0} skipped, {stats.failed || 0} failed.
          </span>
        </div>
      )}

      {campaign.status !== 'completed' && (
        <div className="cst-last">
          <Hourglass size={12} />
          <span>{campaign.lastActivity || 'No activity recorded yet.'}</span>
          {campaign.finishedAt && <em>Finished {formatWhen(campaign.finishedAt)}</em>}
        </div>
      )}

      <div className="cst-actions">
        {(campaign.status === 'running' || campaign.status === 'queued' || campaign.status === 'waiting') && (
          <button type="button" className="cst-btn" onClick={() => act('pause')} disabled={Boolean(busy)}>
            {busy === 'pause' ? <Loader2 className="spin" size={13} /> : <Pause size={13} />} Pause
          </button>
        )}
        {(campaign.status === 'paused' || campaign.status === 'needs_attention' || campaign.status === 'partially_completed' || campaign.status === 'failed') && (
          <button type="button" className="cst-btn is-primary" onClick={() => act('resume')} disabled={Boolean(busy)}>
            {busy === 'resume' ? <Loader2 className="spin" size={13} /> : <Play size={13} />} Resume
          </button>
        )}
        {isActive && (
          <button type="button" className="cst-btn is-danger" onClick={() => act('stop')} disabled={Boolean(busy)}>
            {busy === 'stop' ? <Loader2 className="spin" size={13} /> : <Square size={13} />} Stop
          </button>
        )}
        {variant === 'compact' && onNavigate && (
          <button type="button" className="cst-btn spend-ghost" onClick={onNavigate}>
            Open LinkedIn Automation
          </button>
        )}
        {showLog && people.length > 0 && (
          <button type="button" className="cst-btn spend-ghost cst-log-toggle" onClick={() => { logTouchedRef.current = true; setLogOpen((v) => !v); }}>
            <ChevronDown size={13} className={logOpen ? 'is-open' : ''} />
            {logOpen ? 'Hide' : 'View'} activity ({people.filter((p) => p.result).length})
          </button>
        )}
      </div>

      {logOpen && showLog && (
        <div className="cst-log">
          <div className="cst-log-head">
            <span>Person</span>
            <span>Stage</span>
            <span>Action</span>
            <span>Result</span>
            <span>Time</span>
          </div>
          <div className="cst-log-body">
            {people.map((person, index) => (
              <div key={`${person.id || person.name}-${index}`} className={`cst-log-row is-${person.result || 'pending'}`}>
                <div className="cst-log-person">
                  <div className="cst-log-name">
                    {person.name || 'Unknown'}
                    {person.connection === 'connected' && <UserCheck size={11} />}
                  </div>
                  <span className="cst-log-sub">
                    {person.headline || person.company || person.connection || ''}
                  </span>
                  {person.message && <em className="cst-log-msg">{person.message}</em>}
                  {person.error && <em className="cst-log-err">{person.error}</em>}
                </div>
                <span className="cst-log-stage">{STAGE_LABELS[person.stage] || person.stage}</span>
                <span className="cst-log-action">{person.action || '—'}</span>
                <span className={`cst-log-result is-${person.result || 'pending'}`}>
                  {RESULT_LABEL[person.result] || 'Pending'}
                </span>
                <span className="cst-log-time">{person.at ? formatWhen(person.at) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isFinished && onNavigate && (
        <button type="button" className="cst-details" onClick={() => onNavigate()}>
          Open in LinkedIn Automation
        </button>
      )}
    </div>
  );
}
