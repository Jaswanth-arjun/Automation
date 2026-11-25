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

// The campaign has exactly two stages. A person row still carries a legacy
// `stage` value (its conversation context), but that is never shown as a stage
// number: every row belongs to Stage 1 or Stage 2.
const STAGE_LABELS = {
  discovery: 'Searching existing network at company',
  stage1_referral: 'Messaging network connections',
  stage2_invites: 'Sending new connection requests (per role)',
  done: 'Outreach completed',
};

const STAGE1_PERSON_LABEL = 'Network message';
const STAGE2_PERSON_LABEL = 'New connection request';

function stageLabel(stage) {
  if (!stage) return '';
  if (STAGE_LABELS[stage]) return STAGE_LABELS[stage];
  // Campaigns created by the old six-stage pipeline saved stage ids that no
  // longer exist. Fold them into the stage they really belonged to.
  if (/^(stage1|stage2|stage3|stage4|replied|seen|unseen|never_messaged)$/.test(stage)) {
    return STAGE_LABELS.stage1_referral;
  }
  return STAGE_LABELS.stage2_invites;
}

function isInviteRow(person) {
  if (person.phase === 'invite') return true;
  if (person.phase) return false;
  return person.action === 'invite' || person.stage === 'not_connected';
}

function personStageLabel(person) {
  if (isInviteRow(person)) return STAGE2_PERSON_LABEL;
  if (person.connection === 'pending') return 'Stage 2 · Invite pending';
  if (person.connection === 'connected' || person.action === 'message'
    || ['replied', 'seen', 'unseen', 'never_messaged'].includes(person.stage)) {
    return STAGE1_PERSON_LABEL;
  }
  return '—';
}

const STAGE_STATUS = {
  pending: { label: 'Pending', tone: 'neutral' },
  in_progress: { label: 'In Progress', tone: 'warn' },
  completed: { label: 'Completed', tone: 'success' },
  partially_completed: { label: 'Partially Completed', tone: 'warn' },
  no_connections: { label: 'No Eligible Connections', tone: 'neutral' },
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
  watchLive,
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
  const loadTimestampRef = useRef(0); // Rate limiting
  const errorCountRef = useRef(0); // Error tracking

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
    // Rate limiting: prevent rapid successive loads
    const now = Date.now();
    if (now - loadTimestampRef.current < 1000) {
      console.log('[CampaignStatus] Rate limited - skipping load');
      return;
    }
    loadTimestampRef.current = now;

    // Error circuit breaker: stop loading if too many consecutive errors
    if (errorCountRef.current >= 5) {
      console.error('[CampaignStatus] Too many errors - stopped auto-refresh');
      setError('Campaign status unavailable. Please refresh the page.');
      return;
    }

    try {
      // A bound card (opened from a job) must show that job's campaign, not
      // whichever campaign happens to be newest.
      if (boundRef.current) {
        const res = await api.getCampaign(boundRef.current);
        setCampaign(res?.campaign || null);
        setError('');
        errorCountRef.current = 0; // Reset error count on success
        return;
      }

      const sameCompany = (item) => !filterByCompany || !company
        || String(item.company || '').toLowerCase() === String(company).toLowerCase();

      const res = await api.getActiveCampaign();
      const active = res?.active || null;
      if (active && sameCompany(active)) {
        setCampaign(active);
        setError('');
        errorCountRef.current = 0; // Reset error count on success
        return;
      }

      const list = await api.listCampaigns();
      const campaigns = (list?.campaigns || []).filter(sameCompany);
      setCampaign(campaigns[0] || null);
      setError('');
      errorCountRef.current = 0; // Reset error count on success
    } catch (err) {
      console.error('[CampaignStatus] Load error:', err);
      errorCountRef.current += 1;
      setError(err.message || 'Campaign status unavailable.');
      setCampaign(null); // Clear campaign on error to prevent crash loop
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
      // Stop polling if there's a fatal error to prevent crash loops
      if (status === 'needs_attention' || status === 'failed') {
        console.log('[CampaignStatus] Stopped polling due to error status:', status);
        return;
      }
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
      const res = action === 'resume' && typeof watchLive === 'boolean'
        ? await handler(campaign.id, { headless: !watchLive })
        : await handler(campaign.id);
      if (res?.campaign) setCampaign(res.campaign);
    } catch (err) {
      setError(err.message || `Could not ${action} the campaign.`);
    } finally {
      setBusy('');
    }
  };

  const stats = campaign?.stats || {};

  // Campaigns started before the two-stage split have no stats.stage1/2. Derive
  // the same two panels from their people rows so an in-flight campaign never
  // falls back to the old numbered stages.
  const legacyStages = useMemo(() => {
    if (!campaign || stats.stage1 || stats.stage2) return null;
    const list = Array.isArray(campaign.people) ? campaign.people : [];
    if (!list.length) return null;

    const target = Math.max(1, parseInt(campaign.config?.referralTarget, 10) || 5);
    const referralRows = list.filter((person) => !isInviteRow(person) && person.connection === 'connected');
    const sent1 = referralRows.filter((p) => p.action === 'message' && p.result === 'success').length;
    const failed1 = referralRows.filter((p) => p.action === 'message' && p.result === 'failed').length;
    const skipped1 = referralRows.filter((p) => p.result === 'skipped').length;
    const attempted1 = referralRows.filter((p) => p.action === 'message').length;
    const eligible1 = referralRows.filter((p) => !p.result && p.eligible !== false).length;

    const perRole = Math.max(1, parseInt(campaign.config?.perRole, 10) || 10);
    const inviteRows = list.filter(isInviteRow);
    const configuredRoles = Array.isArray(campaign.config?.roles) && campaign.config.roles.length
      ? campaign.config.roles.filter(Boolean)
      : (campaign.role ? [campaign.role] : []);
    const rowsByRole = new Map();
    for (const person of inviteRows) {
      const key = person.inviteRole || (configuredRoles.length === 1 ? configuredRoles[0] : 'All roles');
      rowsByRole.set(key, [...(rowsByRole.get(key) || []), person]);
    }
    const roleKeys = [...new Set([...configuredRoles, ...rowsByRole.keys()])];
    const roles = roleKeys.map((role) => {
      const rows = rowsByRole.get(role) || [];
      const sent = rows.filter((p) => p.result === 'success').length;
      const failed = rows.filter((p) => p.result === 'failed').length;
      const skipped = rows.filter((p) => p.result === 'skipped').length;
      return {
        role,
        target: perRole,
        sent,
        failed,
        skipped,
        status: sent >= perRole ? 'completed' : (rows.some((p) => p.result) ? 'partially_completed' : 'pending'),
      };
    });

    return {
      stage1: {
        target,
        matched: referralRows.length,
        eligible: eligible1,
        sent: sent1,
        failed: failed1,
        skipped: skipped1,
        remaining: eligible1,
        status: sent1 >= target ? 'completed' : (attempted1 ? 'in_progress' : 'pending'),
      },
      stage2: roles.length ? {
        roles,
        target: roles.reduce((sum, row) => sum + row.target, 0),
        sent: roles.reduce((sum, row) => sum + row.sent, 0),
        failed: roles.reduce((sum, row) => sum + row.failed, 0),
        skipped: roles.reduce((sum, row) => sum + row.skipped, 0),
        status: roles.some((row) => row.status !== 'pending') ? 'in_progress' : 'pending',
      } : null,
    };
  }, [campaign, stats.stage1, stats.stage2]);

  const stage1 = stats.stage1 || legacyStages?.stage1 || null;
  const stage2 = (stats.stage2 && Array.isArray(stats.stage2.roles) ? stats.stage2 : null)
    || (legacyStages?.stage2?.roles?.length ? legacyStages.stage2 : null);
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
        <p>Start a campaign to message your existing connections company-wide, then send role-wise connection requests — the activity log appears here as soon as it runs.</p>
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
          {stageLabel(campaign.stage) || 'Preparing'}
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

      {(stage1 || stage2) && (
        <div className="cst-two-stage">
          {stage1 && (
            <div className="cst-stage-block">
              <div className="cst-stage-block-head">
                <span>Messages to Network (Existing Connections)</span>
                <span className={`cst-pill is-${(STAGE_STATUS[stage1.status] || STAGE_STATUS.pending).tone}`}>
                  {(STAGE_STATUS[stage1.status] || STAGE_STATUS.pending).label}
                </span>
              </div>
              <div className="cst-stage-block-sub">
                {campaign.company} · existing 1st-degree connections · no role filter
              </div>
              <div className="cst-counts">
                <div className="cst-count"><b>{stage1.target}</b><span>Target</span></div>
                <div className="cst-count"><b>{stage1.matched}</b><span>1st-Degree</span></div>
                <div className="cst-count"><b>{stage1.eligible}</b><span>Eligible</span></div>
                <div className="cst-count"><b>{stage1.sent}</b><span>Referrals</span></div>
                <div className="cst-count"><b>{stage1.failed}</b><span>Failed</span></div>
                <div className="cst-count"><b>{stage1.skipped}</b><span>Skipped</span></div>
                <div className="cst-count"><b>{stage1.remaining}</b><span>Remaining</span></div>
              </div>
            </div>
          )}

          {stage2 && stage2.roles.length > 0 && (
            <div className="cst-stage-block">
              <div className="cst-stage-block-head">
                <span>New Connection Requests (Per Role)</span>
                <span className={`cst-pill is-${(STAGE_STATUS[stage2.status] || STAGE_STATUS.pending).tone}`}>
                  {(STAGE_STATUS[stage2.status] || STAGE_STATUS.pending).label}
                </span>
              </div>
              <div className="cst-roles">
                <div className="cst-roles-head">
                  <span>Role</span>
                  <span>Target</span>
                  <span>Sent</span>
                  <span>Failed</span>
                  <span>Status</span>
                </div>
                {stage2.roles.map((row) => (
                  <div key={row.role} className="cst-role-row">
                    <span className="cst-role-name">{row.role}</span>
                    <span>{row.target}</span>
                    <span>{row.sent}</span>
                    <span className={row.failed ? 'is-bad' : ''}>{row.failed}</span>
                    <span className={`cst-role-status is-${(STAGE_STATUS[row.status] || STAGE_STATUS.pending).tone}`}>
                      {(STAGE_STATUS[row.status] || STAGE_STATUS.pending).label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="cst-stage-block cst-overall">
            <div className="cst-stage-block-head"><span>Overall campaign summary</span></div>
            <div className="cst-counts is-five">
              <div className="cst-count"><b>{stats.messagesSent || 0}</b><span>Referral Msgs</span></div>
              <div className="cst-count"><b>{stats.invitesSent || 0}</b><span>Conn Requests</span></div>
              <div className="cst-count"><b>{(stats.messagesSent || 0) + (stats.invitesSent || 0)}</b><span>Successful</span></div>
              <div className="cst-count"><b>{stats.failed || 0}</b><span>Failed</span></div>
              <div className="cst-count"><b>{stats.skipped || 0}</b><span>Skipped</span></div>
            </div>
          </div>
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
            {campaign.errorStage && <em>While running: {stageLabel(campaign.errorStage)}</em>}
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
                <span className="cst-log-stage">{personStageLabel(person)}</span>
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
