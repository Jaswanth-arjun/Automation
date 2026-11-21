import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Gauge,
  Hourglass,
  Info,
  KeyRound,
  Link2,
  Loader2,
  MessageSquare,
  PauseCircle,
  Play,
  PlayCircle,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  Terminal,
  Timer,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, profileStore, resumeStore, campaignPrefsStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import CampaignStatus from '../components/CampaignStatus';
import './LinkedInAutomation.css';

const LinkedinIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const STATUS_META = {
  idle: { label: 'Idle', tone: 'tone-neutral' },
  running: { label: 'Running', tone: 'tone-warn' },
  syncing: { label: 'Syncing', tone: 'tone-accent' },
  requires_login: { label: 'Login required', tone: 'tone-danger' },
  expired: { label: 'Session expired', tone: 'tone-danger' },
  completed: { label: 'Completed', tone: 'tone-success' },
  completed_sync: { label: 'Sync complete', tone: 'tone-success' },
  stopped: { label: 'Stopped', tone: 'tone-neutral' },
};

const CONN_STATUS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'seen', label: 'Seen' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'replied', label: 'Replied' },
  { key: 'declined', label: 'Declined' },
];

const STATUS_LABEL = {
  pending: 'Pending',
  seen: 'Seen',
  accepted: 'Accepted',
  replied: 'Replied',
  declined: 'Declined',
};

const DEFAULT_ROLES = ['Recruiter', 'Talent Acquisition', 'HR', 'Hiring Manager', 'Engineering Manager'];

const LOG_LEVELS = [
  { key: 'all', label: 'All' },
  { key: 'success', label: 'Success' },
  { key: 'warn', label: 'Warnings' },
  { key: 'error', label: 'Errors' },
];

function levelOf(log) {
  const level = String(log?.level || 'info').toLowerCase();
  if (level === 'warning') return 'warn';
  if (level === 'success' || level === 'error' || level === 'warn') return level;
  return 'info';
}

function timeAgo(value) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '—';
  const diff = Math.max(0, Date.now() - time);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fullDate(value) {
  if (!value) return '—';
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return '—';
  return time.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || '?';
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function formatEstimate(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '< 1 min';
  if (seconds < 60) return '< 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `~${hours}h ${rest}m` : `~${hours}h`;
}

const TONE_DOT = {
  indigo: '#445cf5',
  blue: '#1d63c9',
  success: '#22a65b',
  purple: '#8b3fd6',
  amber: '#d4920a',
  neutral: '#b5b8b0',
};

function FunnelRow({ label, value, total, tone, note }) {
  const pct = percent(value, total);
  const width = value > 0 ? Math.max(pct, 2) : 0;
  return (
    <div className="liq-funnel-row">
      <div className="liq-funnel-top">
        <span className="liq-funnel-label">
          <i className={`liq-funnel-dot c-${tone}`} style={{ background: TONE_DOT[tone] }} />
          {label}
        </span>
        <span className="liq-funnel-value">
          {value}
          <em>{pct}%</em>
        </span>
      </div>
      <div className="liq-funnel-track">
        <div className={`liq-funnel-fill c-${tone}`} style={{ width: `${width}%` }} />
      </div>
      {note && <div className="liq-funnel-note">{note}</div>}
    </div>
  );
}

export default function LinkedInAutomation() {
  const { user } = useAuth();
  const userId = user?.id || 'demo-user-1';

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const [serverOnline, setServerOnline] = useState(null);
  const [statusInfo, setStatusInfo] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [connections, setConnections] = useState([]);
  const [logs, setLogs] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(''); const [connError, setConnError] = useState('');
  const [analyticsError, setAnalyticsError] = useState('');
  const [wsLive, setWsLive] = useState(false);

  // Per-user LinkedIn session
  const [liAccount, setLiAccount] = useState(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [connectPending, setConnectPending] = useState(false);
  const [cookieMode, setCookieMode] = useState(false);
  const [liAt, setLiAt] = useState('');
  const [cookieBusy, setCookieBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Campaign form
  const [company, setCompany] = useState(() => searchParams.get('company') || '');
  const [jobRole, setJobRole] = useState(() => searchParams.get('role') || '');
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [newRole, setNewRole] = useState('');
  const [perRole, setPerRole] = useState(10);
  // Stage 1 target: one company-wide referral-message count, independent of perRole.
  const [referralTarget, setReferralTarget] = useState(5);
  const [useAI, setUseAI] = useState(true);
  const [note, setNote] = useState('');
  const [starting, setStarting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [campaign, setCampaign] = useState(null);

  // Tracker filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [companyScope, setCompanyScope] = useState('all');
  const [visibleCount, setVisibleCount] = useState(60);
  const connCardRef = useRef(null);

  // Activity filters
  const [logLevel, setLogLevel] = useState('all');
  const [logQuery, setLogQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const logRef = useRef(null);
  const wsOkRef = useRef(false);
  const flashTimer = useRef(null);
  const copyTimer = useRef(null);

  const notify = useCallback((type, text) => {
    setActionMsg({ type, text });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setActionMsg(null), 4500);
  }, []);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const refreshData = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const status = await api.getLinkedInStatus();
      setServerOnline(true);
      setLoadError('');
      setStatusInfo(status);
      if (status?.analytics) setAnalytics(status.analytics);

      const [conns, stats] = await Promise.allSettled([
        api.getLinkedInConnections(),
        api.getLinkedInAnalytics(),
      ]);

      if (conns.status === 'fulfilled') {
        setConnections(Array.isArray(conns.value) ? conns.value : []);
        setConnError('');
      } else {
        setConnError(conns.reason?.message || 'Could not load the connection tracker.');
      }

      if (stats.status === 'fulfilled') {
        setAnalytics(stats.value);
        setAnalyticsError('');
      } else {
        setAnalyticsError(stats.reason?.message || 'Could not load campaign analytics.');
      }
    } catch (err) {
      setServerOnline(false);
      if (initial) setLoadError(err?.message || 'Automation server is not reachable.');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData(true);
  }, [refreshData]);

  useEffect(() => {
    let alive = true;
    api.getActiveCampaign()
      .then((res) => {
        if (!alive) return;
        if (res?.active) setCampaign(res.active);
      })
      .catch(() => { });
    return () => { alive = false; };
  }, []);

  // Prefill the launcher with the values used last time — either here or from
  // the Apply → LinkedIn tab — so both entry points run the same campaign.
  useEffect(() => {
    const prefs = campaignPrefsStore.get();
    if (!prefs) return;
    if (prefs.company) setCompany(prefs.company);
    if (prefs.role) setJobRole(prefs.role);
    if (Array.isArray(prefs.roles) && prefs.roles.length) setRoles(prefs.roles);
    if (typeof prefs.perRole === 'number' && prefs.perRole > 0) setPerRole(prefs.perRole);
    if (typeof prefs.referralTarget === 'number' && prefs.referralTarget > 0) setReferralTarget(prefs.referralTarget);
    if (typeof prefs.useAI === 'boolean') setUseAI(prefs.useAI);
    if (typeof prefs.note === 'string') setNote(prefs.note);
  }, []);

  // A running campaign is the source of truth for the launcher values.
  useEffect(() => {
    if (!campaign) return;
    const config = campaign.config || {};
    if (campaign.company) setCompany(campaign.company);
    if (campaign.role) setJobRole(campaign.role);
    if (Array.isArray(config.roles) && config.roles.length) setRoles(config.roles);
    if (typeof config.perRole === 'number' && config.perRole > 0) setPerRole(config.perRole);
    if (typeof config.referralTarget === 'number' && config.referralTarget > 0) setReferralTarget(config.referralTarget);
    if (typeof config.useAINotes === 'boolean') setUseAI(config.useAINotes);
    if (typeof config.connectionNote === 'string') setNote(config.connectionNote);
  }, [campaign?.id]);

  const loadAccount = useCallback(async () => {
    try {
      const account = await api.getLinkedInAccount(userId);
      setLiAccount(account);
      setConnectPending(account?.status === 'pending_login');
      setAccountError('');
      return account;
    } catch (err) {
      setAccountError(err?.message || 'Could not load your LinkedIn session.');
      return null;
    } finally {
      setAccountLoaded(true);
    }
  }, [userId]);

  useEffect(() => {
    if (serverOnline) loadAccount();
  }, [serverOnline, loadAccount]);

  useEffect(() => {
    setAccountLoaded(false);
  }, [userId]);

  // Poll while a LinkedIn login window is open (fallback if a WS event is missed)
  useEffect(() => {
    if (!connectPending) return undefined;
    const timer = setInterval(async () => {
      const account = await loadAccount();
      if (account && account.status !== 'pending_login') setConnectPending(false);
    }, 3000);
    return () => clearInterval(timer);
  }, [connectPending, loadAccount]);

  // WebSocket live updates with a REST polling fallback
  useEffect(() => {
    if (!serverOnline) return undefined;
    let closed = false;
    let socket = null;
    let retry = null;

    const connect = () => {
      if (closed) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        socket = new WebSocket(`${protocol}://${window.location.host}/linkedin-api`);
      } catch {
        return;
      }

      socket.onopen = () => {
        wsOkRef.current = true;
        setWsLive(true);
      };

      socket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        const { type, data } = message;

        if (type === 'init') {
          setStatusInfo((current) => ({
            ...(current || {}),
            status: data.status,
            progress: data.progress,
          }));
          if (Array.isArray(data.logs)) setLogs(data.logs);
          if (Array.isArray(data.connections)) setConnections(data.connections);
          if (data.analytics) setAnalytics(data.analytics);
          const mine = (data.accounts || []).find((account) => account.userId === userId);
          if (mine) {
            setLiAccount(mine);
            setConnectPending(mine.status === 'pending_login');
          }
          if (data.campaign) setCampaign((current) => current || data.campaign);
        } else if (type === 'linkedin_account') {
          if (data.userId === userId) {
            setLiAccount(data.account);
            setConnectPending(data.account?.status === 'pending_login');
            if (data.account?.connected) {
              setStatusInfo((current) => (
                current && (current.status === 'requires_login' || current.status === 'expired')
                  ? { ...current, status: 'idle' }
                  : current
              ));
              notify('ok', `LinkedIn connected as ${data.account.memberName || 'LinkedIn Member'}.`);
            }
          }
        } else if (type === 'log') {
          setLogs((previous) => [...previous.slice(-499), data]);
        } else if (type === 'progress') {
          setStatusInfo((current) => ({ ...(current || {}), progress: data }));
        } else if (type === 'sent') {
          setConnections((previous) => [data, ...previous.filter((item) => item.id !== data.id)]);
        } else if (type === 'status_change') {
          setStatusInfo((current) => ({ ...(current || {}), status: data.status }));
          if (data.error) notify('err', data.error);
        } else if (type === 'connections_updated') {
          if (Array.isArray(data.connections)) setConnections(data.connections);
          if (data.analytics) setAnalytics(data.analytics);
        } else if (type === 'campaign_update') {
          if (data) setCampaign(data);
        }
      };

      socket.onerror = () => {
        wsOkRef.current = false;
        setWsLive(false);
      };

      socket.onclose = () => {
        wsOkRef.current = false;
        setWsLive(false);
        if (!closed) retry = setTimeout(connect, 4000);
      };
    };

    connect();

    const poll = setInterval(() => {
      if (!wsOkRef.current) refreshData().catch(() => { });
    }, 10000);

    return () => {
      closed = true;
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        // Closing while the handshake is still pending logs a browser warning,
        // so wait for the socket to open (or fail) before tearing it down.
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => socket.close();
        } else {
          socket.close();
        }
      }
    };
  }, [serverOnline, refreshData, userId, notify]);

  // Keep the log pinned to the newest event
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll, tab]);

  // Bring the cookie panel into view when it opens from the session alert
  useEffect(() => {
    if (cookieMode) {
      document.querySelector('.liq-cookie')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [cookieMode]);

  // Drop a stale company scope when analytics changes
  useEffect(() => {
    if (companyScope !== 'all' && analytics && !analytics.byCompany?.[companyScope]) {
      setCompanyScope('all');
    }
  }, [analytics, companyScope]);

  useEffect(() => {
    setVisibleCount(60);
  }, [search, statusFilter, companyScope]);

  const meta = STATUS_META[statusInfo?.status] || STATUS_META.idle;
  const status = statusInfo?.status;
  const campaignActive = Boolean(campaign && ['queued', 'running', 'paused', 'waiting', 'needs_attention'].includes(campaign.status));
  const campaignRunning = Boolean(campaign && ['queued', 'running', 'waiting'].includes(campaign.status));
  const isRunning = campaignRunning || status === 'running' || status === 'syncing';
  const isSyncing = !campaignRunning && status === 'syncing';
  const progress = statusInfo?.progress;
  const progressTarget = progress?.stats?.totalTarget || 0;
  const progressSent = progress?.stats?.sent || 0;
  const progressPct = progressTarget > 0 ? Math.min(100, Math.round((progressSent / progressTarget) * 100)) : 0;

  const companies = useMemo(() => {
    const map = analytics?.byCompany || {};
    return Object.values(map)
      .map((item) => ({
        ...item,
        engaged: (item.accepted || 0) + (item.seen || 0) + (item.replied || 0),
      }))
      .sort((a, b) => (b.sent || 0) - (a.sent || 0) || String(a.company).localeCompare(String(b.company)));
  }, [analytics]);

  const scoped = useMemo(() => {
    if (!analytics) {
      return { sent: 0, accepted: 0, seen: 0, replied: 0, pending: 0, declined: 0 };
    }
    if (companyScope !== 'all') {
      const item = analytics.byCompany?.[companyScope];
      return {
        sent: item?.sent || 0,
        accepted: item?.accepted || 0,
        seen: item?.seen || 0,
        replied: item?.replied || 0,
        pending: item?.pending || 0,
        declined: item?.declined || 0,
      };
    }
    return {
      sent: analytics.totalSent || 0,
      accepted: analytics.accepted || 0,
      seen: analytics.seen || 0,
      replied: analytics.replied || 0,
      pending: analytics.pending || 0,
      declined: analytics.declined || 0,
    };
  }, [analytics, companyScope]);

  const engaged = scoped.accepted + scoped.seen + scoped.replied;
  const connectedCount = scoped.accepted + scoped.replied;
  const engagementPct = percent(engaged, scoped.sent);
  const acceptancePct = percent(connectedCount, scoped.sent);
  const replyPct = percent(scoped.replied, scoped.sent);

  const companyConnections = useMemo(
    () => connections.filter((item) => companyScope === 'all' || item.company === companyScope),
    [connections, companyScope],
  );

  const statusCounts = useMemo(() => {
    const counts = { all: companyConnections.length, pending: 0, seen: 0, accepted: 0, replied: 0, declined: 0 };
    companyConnections.forEach((item) => {
      if (counts[item.status] !== undefined) counts[item.status] += 1;
    });
    return counts;
  }, [companyConnections]);

  const filteredConnections = useMemo(() => {
    const query = search.trim().toLowerCase();
    return companyConnections.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!query) return true;
      return [item.name, item.company, item.headline, item.role, item.replyText]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [companyConnections, statusFilter, search]);

  const visibleConnections = filteredConnections.slice(0, visibleCount);

  // Give the tracker a near-full-screen height and scroll the rows inside it,
  // so the page only scrolls far enough to bring the card into view.
  useEffect(() => {
    if (tab !== 'connections') return undefined;
    const fit = () => {
      const el = connCardRef.current;
      if (!el) return;
      el.style.height = `${Math.max(420, Math.round(window.innerHeight - 96))}px`;
    };
    fit();
    const id = setTimeout(fit, 80);
    window.addEventListener('resize', fit);
    return () => {
      clearTimeout(id);
      window.removeEventListener('resize', fit);
    };
  }, [tab, visibleCount, statusFilter, companyScope, search]);

  const filteredLogs = useMemo(() => {
    const query = logQuery.trim().toLowerCase();
    return logs.filter((log) => {
      if (logLevel !== 'all' && levelOf(log) !== logLevel) return false;
      return !query || String(log.message || '').toLowerCase().includes(query);
    });
  }, [logs, logLevel, logQuery]);

  const lastLog = logs[logs.length - 1];

  const batchTotal = roles.length * perRole;
  const estimateSeconds = batchTotal * 27.5 + Math.max(0, roles.length - 1) * 11.5;

  const accountNeedsLogin = liAccount?.status === 'expired' || liAccount?.status === 'requires_login';
  const needsLogin = accountNeedsLogin;
  const connected = Boolean(liAccount?.connected);
  // A login wall hit by the *background* tracker does not invalidate a session
  // the account itself still reports as connected, so it gets a calmer notice.
  const backgroundLoginWall = Boolean(statusInfo?.status === 'requires_login' && connected && !accountNeedsLogin);
  const pending = connectPending || liAccount?.status === 'pending_login';
  // The account file is fetched separately from the campaign data, so avoid
  // flashing "not connected" while that request is still in flight.
  const accountLoading = !accountLoaded && !accountError;

  const flash = (type, text) => notify(type, text);

  const handleConnect = async () => {
    try {
      const result = await api.connectLinkedIn(userId);
      if (result.status === 'connected') {
        setLiAccount(result.account);
        setConnectPending(false);
        flash('ok', `LinkedIn already connected as ${result.account?.memberName || 'LinkedIn Member'}.`);
      } else {
        setConnectPending(true);
        flash('info', 'LinkedIn login window opened. Sign in with your own account — 2FA is supported.');
      }
    } catch (err) {
      flash('err', err.message || 'Could not open the LinkedIn login window.');
    }
  };

  // A stale session still looks "connected" to the account file, so the login
  // flow would short-circuit. Clear the saved profile first, then open a fresh one.
  const handleReconnect = async () => {
    if (!window.confirm('Reconnect LinkedIn? This clears the saved session for this profile and opens a fresh login window.')) return;
    try {
      await api.disconnectLinkedIn(userId);
      setLiAccount(null);
      setConnectPending(false);
      const result = await api.connectLinkedIn(userId);
      if (result.status === 'connected') {
        setLiAccount(result.account);
        flash('ok', `LinkedIn connected as ${result.account?.memberName || 'LinkedIn Member'}.`);
      } else {
        setConnectPending(true);
        flash('info', 'LinkedIn login window opened. Sign in with your own account — 2FA is supported.');
      }
    } catch (err) {
      flash('err', err.message || 'Could not reconnect LinkedIn.');
      await loadAccount();
    }
  };

  const handleCancelConnect = async () => {
    try { await api.disconnectLinkedIn(userId); } catch { /* best effort */ }
    setConnectPending(false);
    await loadAccount();
    flash('ok', 'Pending LinkedIn login cancelled.');
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect LinkedIn? The saved Chrome session for this profile will be deleted.')) return;
    try {
      await api.disconnectLinkedIn(userId);
      setLiAccount(null);
      setConnectPending(false);
      setCookieMode(false);
      flash('ok', 'LinkedIn session disconnected and deleted.');
    } catch (err) {
      flash('err', err.message || 'Could not disconnect LinkedIn.');
    }
  };

  const handleCookieConnect = async () => {
    const cookie = liAt.trim();
    if (!cookie) {
      flash('err', 'Paste your li_at cookie value first.');
      return;
    }
    setCookieBusy(true);
    try {
      const result = await api.connectLinkedInCookie(userId, cookie);
      setLiAccount(result.account);
      setConnectPending(false);
      setCookieMode(false);
      setLiAt('');
      setStatusInfo((current) => (
        current && (current.status === 'requires_login' || current.status === 'expired')
          ? { ...current, status: 'idle' }
          : current
      ));
      flash('ok', `LinkedIn connected as ${result.account?.memberName || 'LinkedIn Member'}.`);
    } catch (err) {
      flash('err', err.message || 'The li_at cookie was rejected by LinkedIn.');
    } finally {
      setCookieBusy(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const result = await api.verifyLinkedIn(userId);
      const { verification, ...account } = result || {};
      if (account && Object.keys(account).length) setLiAccount(account);
      if (verification?.connected) {
        setStatusInfo((current) => ({
          ...(current || {}),
          status: current?.status === 'running' || current?.status === 'syncing' ? current.status : 'idle',
        }));
        flash('ok', 'Session verified — LinkedIn is still signed in.');
      } else if (verification?.verified === false) {
        flash('err', 'Could not verify the session (Chrome was unavailable). Try again.');
      } else {
        flash('err', 'Session expired. Reconnect your LinkedIn account to continue.');
      }
    } catch (err) {
      flash('err', err.message || 'Session verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleStart = async () => {
    if (!connected) {
      flash('err', 'Connect your LinkedIn account before starting a campaign.');
      return;
    }
    if (!jobRole.trim()) {
      flash('err', 'Enter the target job role — referral messages are written for that role.');
      return;
    }
    if (!company.trim()) {
      flash('err', 'Enter a target company or LinkedIn company URL.');
      return;
    }

    setStarting(true);
    try {
      const profile = profileStore.get() || {};
      const resumes = resumeStore.getAll();
      const activeResume = resumes.find((resume) => resume.isActive) || resumes[0];
      campaignPrefsStore.save({
        company: company.trim(),
        role: jobRole.trim(),
        roles,
        perRole,
        referralTarget,
        useAI,
        note,
      });
      const res = await api.startCampaign({
        userId,
        company: company.trim(),
        role: jobRole.trim(),
        roles,
        perRole,
        referralTarget,
        sendInvites: true,
        useAINotes: useAI,
        connectionNote: note.trim(),
        userProfile: {
          ...profile,
          resume: {
            ...(profile.resume || {}),
            text: String(activeResume?.text || profile.resume?.text || '').slice(0, 4000),
          },
        },
      });
      if (res?.campaign) setCampaign(res.campaign);
      setLogs([]);
      setStatusInfo((current) => ({ ...(current || {}), status: 'running' }));
      flash(
        'ok',
        res?.reused
          ? '↻ Attached to the campaign already running for this company and role.'
          : 'Referral campaign started. It keeps running in the background — you can leave this page.',
      );
    } catch (err) {
      flash('err', err.message || 'Could not start the campaign.');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      if (campaign && ['queued', 'running', 'waiting', 'paused', 'needs_attention'].includes(campaign.status)) {
        const res = await api.stopCampaign(campaign.id);
        if (res?.campaign) setCampaign(res.campaign);
        flash('ok', 'Campaign stopped. Resume it any time from the campaign card.');
        return;
      }
      await api.stopLinkedIn();
      setStatusInfo((current) => ({ ...(current || {}), status: 'stopped' }));
      flash('ok', 'Stop signal sent.');
    } catch (err) {
      flash('err', err.message || 'Could not stop the campaign.');
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.syncLinkedInStatus(userId);
      flash('ok', 'Background status sync started. Accepted/served states will update as it runs.');
    } catch (err) {
      flash('err', err.message || 'Could not start the status sync.');
    } finally {
      setSyncing(false);
    }
  };

  const addRole = () => {
    const role = newRole.trim();
    if (role && !roles.includes(role)) setRoles([...roles, role]);
    setNewRole('');
  };

  const handleCopyLogs = async () => {
    try {
      const text = filteredLogs
        .map((log) => `[${log.timestamp || ''}] ${log.message || ''}`)
        .join('\n');
      await navigator.clipboard.writeText(text || 'No log events to copy.');
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      flash('err', 'Clipboard access was blocked by the browser.');
    }
  };

  const scopeCompany = companyScope !== 'all' ? analytics?.byCompany?.[companyScope] : null;
  const scopeEngaged = scopeCompany
    ? (scopeCompany.accepted || 0) + (scopeCompany.seen || 0) + (scopeCompany.replied || 0)
    : 0;

  const heroSub =
    scoped.sent === 0
      ? 'Launch your first campaign to start sending personalized connection requests.'
      : engaged > 0
        ? `${connectedCount} accepted the invite · ${scoped.replied} replied — signals update on every status sync.`
        : scoped.pending > 0
          ? 'No signals yet — your invites are still waiting on a response from LinkedIn.'
          : 'Invites are out. Sync to pick up the latest connection states.';

  if (loading) {
    return (
      <div className="liq-page">
        <header className="liq-head">
          <div>
            <h1>LinkedIn Automation</h1>
            <p>Checking your automation server and LinkedIn session…</p>
          </div>
        </header>
        <div className="liq-loading">
          <Loader2 className="spin" size={26} />
          <span>Checking connection…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="liq-page">
      <header className="liq-head">
        <div>
          <h1>LinkedIn Automation</h1>
          <p>
            Launch consent-first connection requests from your own LinkedIn session and see exactly
            how every invite progressed.
          </p>
        </div>
        <div className="liq-head-actions">
          {serverOnline && (
            <>
              <span className={`liq-live ${wsLive ? '' : 'is-polling'}`}>
                <i /> {wsLive ? 'Live' : 'Polling'}
              </span>
              <button
                type="button"
                className="liq-btn"
                onClick={handleSync}
                disabled={syncing || isRunning}
                title={isRunning ? 'Stop the running automation before syncing again.' : 'Sync connection statuses from LinkedIn'}
              >
                <RefreshCw size={13} className={syncing ? 'spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync status'}
              </button>
            </>
          )}
        </div>
      </header>

      {serverOnline === false && (
        <>
          <div className="liq-alert" role="alert">
            <div className="liq-alert-icon"><AlertTriangle size={18} /></div>
            <div className="liq-alert-body">
              <strong>Automation server is not reachable</strong>
              <p>
                {loadError || 'The dashboard could not reach the LinkedIn automation backend on port 3000.'}
                {' '}Start it with <b>node server.js</b> from the project root, then retry.
              </p>
            </div>
            <div className="liq-alert-actions">
              <button type="button" className="liq-btn primary" onClick={() => refreshData(true)}>
                <RefreshCw size={13} /> Retry connection
              </button>
            </div>
          </div>
          <section className="liq-card">
            <div className="liq-empty">
              <div className="liq-empty-icon"><LinkedinIcon size={20} /></div>
              <strong>Campaign data is unavailable while the backend is offline</strong>
              <p>Your saved connection history stays on disk and will reappear as soon as the server answers.</p>
            </div>
          </section>
        </>
      )}

      {serverOnline && (
        <>
          {connected && needsLogin && (
            <div className="liq-alert" role="alert">
              <div className="liq-alert-icon"><ShieldAlert size={18} /></div>
              <div className="liq-alert-body">
                <strong>LinkedIn is asking for a fresh sign-in</strong>
                <p>
                  The last background sync hit a login wall. Reconnect your session before launching a
                  campaign so requests are not spent on a stale login.
                </p>
              </div>
              <div className="liq-alert-actions">
                <button type="button" className="liq-btn primary" onClick={handleReconnect} disabled={pending}>
                  <Link2 size={13} /> Reconnect LinkedIn
                </button>
                <button type="button" className="liq-btn" onClick={() => setCookieMode(true)}>
                  <KeyRound size={13} /> Use li_at
                </button>
              </div>
            </div>
          )}

          {backgroundLoginWall && (
            <div className="liq-alert is-soft" role="status">
              <div className="liq-alert-icon"><ShieldAlert size={18} /></div>
              <div className="liq-alert-body">
                <strong>Background sync paused</strong>
                <p>
                  LinkedIn asked for a sign-in while checking pending invites. Your saved session is unchanged and
                  campaigns can still launch — verify it once, and only reconnect if verification fails.
                </p>
              </div>
              <div className="liq-alert-actions">
                <button type="button" className="liq-btn" onClick={handleVerify} disabled={verifying || isRunning}>
                  <ShieldCheck size={13} className={verifying ? 'spin' : ''} />
                  {verifying ? 'Verifying…' : 'Verify session'}
                </button>
              </div>
            </div>
          )}

          <section className={`liq-session ${accountLoading ? 'is-checking' : connected ? 'is-on' : pending ? 'is-warn' : 'is-off'}`}>
            <div className="liq-session-icon">
              <LinkedinIcon size={20} />
            </div>
            <div className="liq-session-body">
              {accountLoading ? (
                <>
                  <strong>Checking your LinkedIn session…</strong>
                  <small>Reading the saved session for this profile.</small>
                </>
              ) : connected ? (
                <>
                  <strong>Connected as {liAccount?.memberName || 'LinkedIn Member'}</strong>
                  <div className="liq-session-meta">
                    <span><ShieldCheck size={11} /> <b>{liAccount?.method === 'li_at' ? 'li_at cookie' : 'Login window'}</b></span>
                    <span><Clock size={11} /> Connected <b>{timeAgo(liAccount?.connectedAt)}</b></span>
                    <span><RefreshCw size={11} /> Verified <b>{timeAgo(liAccount?.lastVerified)}</b></span>
                    {liAccount?.headline && <span>{liAccount.headline}</span>}
                  </div>
                </>
              ) : pending ? (
                <>
                  <strong>Finish signing in to LinkedIn</strong>
                  <small>
                    A Chrome window is open. Log in with your own account — 2FA is supported and your
                    password never reaches this dashboard.
                  </small>
                  <div className="liq-session-meta">
                    <span><Loader2 className="spin" size={11} /> Waiting for the login window</span>
                  </div>
                </>
              ) : (
                <>
                  <strong>No LinkedIn session connected</strong>
                  <small>
                    Connect your own account to launch campaigns. The session is stored locally per user,
                    and you can disconnect it at any time.
                  </small>
                  {accountError && <small className="liq-error-text">{accountError}</small>}
                </>
              )}
            </div>
            <div className="liq-session-actions">
              {accountLoading ? null : connected ? (
                <>
                  <span className="liq-pill tone-success">
                    <CheckCircle2 size={11} /> Connected
                  </span>
                  <button type="button" className="liq-btn" onClick={handleVerify} disabled={verifying || isRunning}>
                    <ShieldCheck size={13} className={verifying ? 'spin' : ''} />
                    {verifying ? 'Verifying…' : 'Verify session'}
                  </button>
                  <button type="button" className="liq-btn danger" onClick={handleDisconnect} disabled={isRunning}>
                    Disconnect
                  </button>
                </>
              ) : pending ? (
                <>
                  <span className="liq-pill tone-warn">
                    <Loader2 className="spin" size={11} /> Signing in…
                  </span>
                  <button type="button" className="liq-btn" onClick={handleConnect}>
                    <ExternalLink size={13} /> Reopen window
                  </button>
                  <button type="button" className="liq-btn subtle" onClick={handleCancelConnect}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="liq-pill tone-neutral">Not connected</span>
                  <button type="button" className="liq-btn primary" onClick={handleConnect}>
                    <Link2 size={13} /> Connect LinkedIn
                  </button>
                  <button type="button" className="liq-btn" onClick={() => setCookieMode((value) => !value)}>
                    <KeyRound size={13} /> li_at cookie
                  </button>
                </>
              )}
            </div>
          </section>

          {cookieMode && (
            <section className="liq-cookie">
              <label>Connect with an li_at cookie</label>
              <div className="liq-cookie-row">
                <input
                  value={liAt}
                  onChange={(event) => setLiAt(event.target.value)}
                  placeholder="Paste the li_at cookie value…"
                  disabled={cookieBusy}
                  spellCheck={false}
                />
                <button type="button" className="liq-btn primary" onClick={handleCookieConnect} disabled={cookieBusy || !liAt.trim()}>
                  {cookieBusy ? <Loader2 className="spin" size={13} /> : <KeyRound size={13} />}
                  {cookieBusy ? 'Verifying…' : 'Connect'}
                </button>
                <button
                  type="button"
                  className="liq-btn subtle"
                  onClick={() => { setCookieMode(false); setLiAt(''); }}
                  aria-label="Close cookie connect"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="liq-cookie-hint">
                Open <code>linkedin.com</code> while signed in → DevTools → Application → Cookies → copy
                the <code>li_at</code> value. This is the same session-sync method used by tools like
                Waalaxy. Your password is never shared with this app. Connecting replaces the saved
                session for this profile.
              </div>
            </section>
          )}

          {actionMsg && (
            <div className={`liq-flash ${actionMsg.type}`} role="status">
              {actionMsg.type === 'err' ? <AlertTriangle size={14} /> : actionMsg.type === 'info' ? <Info size={14} /> : <CheckCircle2 size={14} />}
              {actionMsg.text}
            </div>
          )}

          {(connError || analyticsError) && (
            <div className="liq-alert" role="alert">
              <div className="liq-alert-icon"><AlertTriangle size={18} /></div>
              <div className="liq-alert-body">
                <strong>Some campaign data could not be refreshed</strong>
                <p>{[analyticsError, connError].filter(Boolean).join(' ')}</p>
              </div>
              <div className="liq-alert-actions">
                <button type="button" className="liq-btn" onClick={() => refreshData()}>
                  <RefreshCw size={13} /> Retry
                </button>
              </div>
            </div>
          )}

          <section className="liq-hero" aria-label={`Invitation summary${companyScope !== 'all' ? ` for ${companyScope}` : ''}`}>
            <div className="liq-hero-main">
              <span className="liq-hero-eyebrow">Invitation pipeline</span>
              <div className="liq-hero-figure">
                <strong>{engaged}</strong>
                <span>{engaged === 1 ? 'invite showed a signal' : 'invites showed a signal'}</span>
              </div>
              <p className="liq-hero-sub">{heroSub}</p>
              <div className="liq-hero-actions">
                <button type="button" className="liq-btn primary" onClick={() => setTab('campaign')}>
                  Launch campaign <ChevronRight size={13} />
                </button>
                <button
                  type="button"
                  className="liq-btn"
                  onClick={handleSync}
                  disabled={syncing || isRunning}
                  title={isRunning ? 'Stop the running automation before syncing again.' : 'Sync connection statuses from LinkedIn'}
                >
                  <RefreshCw size={13} className={syncing ? 'spin' : ''} />
                  {syncing ? 'Syncing…' : 'Sync status'}
                </button>
              </div>
            </div>
            <div className="liq-hero-kpis">
              <div className="liq-kpi is-indigo">
                <span>Sent</span>
                <strong>{scoped.sent}</strong>
                <small>Personalized invites</small>
              </div>
              <div className="liq-kpi is-green">
                <span>Accepted</span>
                <strong>{connectedCount}</strong>
                <small>{acceptancePct}% of sent</small>
              </div>
              <div className="liq-kpi is-purple">
                <span>Replied</span>
                <strong>{scoped.replied}</strong>
                <small>{replyPct}% of sent</small>
              </div>
              <div className="liq-kpi is-amber">
                <span>Seen</span>
                <strong>{scoped.seen}</strong>
                <small>Viewed, not accepted</small>
              </div>
              <div className="liq-kpi is-slate">
                <span>Pending</span>
                <strong>{scoped.pending}</strong>
                <small>No signal yet</small>
              </div>
              {scoped.declined > 0 && (
                <div className="liq-kpi is-red">
                  <span>Declined</span>
                  <strong>{scoped.declined}</strong>
                  <small>Invite withdrawn</small>
                </div>
              )}
            </div>
          </section>

          {companyScope !== 'all' && scopeCompany && (
            <div className="liq-scope">
              <Building2 size={13} />
              Showing <strong>{companyScope}</strong> · {scopeCompany.sent} sent · {percent(scopeEngaged, scopeCompany.sent)}% engaged
              <button type="button" className="liq-link" onClick={() => setTab('connections')}>
                Open tracker <ArrowRight size={11} />
              </button>
              <button type="button" className="liq-link" onClick={() => setCompanyScope('all')}>
                Clear scope <X size={11} />
              </button>
            </div>
          )}

          <div className="liq-tabs" role="tablist" aria-label="LinkedIn views">
            {[
              { key: 'overview', label: 'Overview', icon: TrendingUp },
              { key: 'campaign', label: 'Campaign', icon: Target },
              { key: 'connections', label: 'Connections', icon: Users, count: connections.length },
              { key: 'activity', label: 'Activity', icon: Terminal, count: logs.length },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  className={`liq-tab ${tab === item.key ? 'active' : ''}`}
                  onClick={() => setTab(item.key)}
                >
                  <Icon size={13} /> {item.label}
                  {typeof item.count === 'number' && <span className="liq-tab-count">{item.count}</span>}
                </button>
              );
            })}
          </div>

          {tab === 'overview' && (
            <>
              <div className="liq-grid">
                <div className="liq-stack">
                  <section className="liq-card">
                    <header className="liq-card-head">
                      <div className="liq-card-title"><TrendingUp size={14} /> Invitation funnel</div>
                      <span className={`liq-pill ${engagementPct >= 20 ? 'tone-success' : 'tone-neutral'}`}>
                        {engagementPct}% engaged
                      </span>
                    </header>
                    <div className="liq-card-body">
                      <div className="liq-funnel">
                        <FunnelRow
                          label="Requests sent"
                          value={scoped.sent}
                          total={scoped.sent}
                          tone="indigo"
                          note="Every personalized invite recorded by the automation."
                        />
                        <FunnelRow
                          label="Any signal"
                          value={engaged}
                          total={scoped.sent}
                          tone="blue"
                          note="Viewed the note, accepted the invite, or replied."
                        />
                        <FunnelRow
                          label="Accepted invite"
                          value={connectedCount}
                          total={scoped.sent}
                          tone="success"
                          note="Accepted connections — includes people who later replied."
                        />
                        <FunnelRow
                          label="Replied"
                          value={scoped.replied}
                          total={scoped.sent}
                          tone="purple"
                          note="A real message came back — the strongest signal."
                        />
                      </div>
                      <div className="liq-funnel-foot">
                        <Clock size={12} />
                        {scoped.pending} still waiting · {scoped.seen} viewed without accepting
                        {scoped.declined > 0 ? ` · ${scoped.declined} declined` : ''}
                      </div>
                    </div>
                  </section>

                  <section className="liq-card">
                    <header className="liq-card-head">
                      <div className="liq-card-title"><Building2 size={14} /> Companies</div>
                      <span className="liq-muted" style={{ fontSize: 10.5, fontWeight: 700 }}>
                        {companies.length} tracked
                      </span>
                    </header>
                    {companies.length === 0 ? (
                      <div className="liq-empty">
                        <div className="liq-empty-icon"><Building2 size={18} /></div>
                        <strong>No companies tracked yet</strong>
                        <p>Company-level stats appear after the first campaign records an invite.</p>
                      </div>
                    ) : (
                      <div className="liq-cos">
                        {companies.map((item) => {
                          const share = percent(item.engaged || 0, item.sent || 0);
                          return (
                            <button
                              key={item.company}
                              type="button"
                              className={`liq-cos-row ${companyScope === item.company ? 'is-active' : ''}`}
                              onClick={() => setCompanyScope(companyScope === item.company ? 'all' : item.company)}
                              title={`Focus ${item.company}`}
                            >
                              <div className="liq-cos-name">
                                {item.company}
                                <small>{item.engaged} of {item.sent} showed a signal</small>
                              </div>
                              <div className="liq-cos-metrics">
                                <span><b>{item.sent}</b> sent</span>
                                <span>{share}%</span>
                                <ChevronRight size={12} />
                              </div>
                              <div className="liq-cos-bar">
                                <span style={{ width: `${item.engaged ? Math.max(share, 2) : 0}%` }} />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>

                <div className="liq-stack">
                  {campaign && (
                    <CampaignStatus variant="compact" onNavigate={() => setTab('campaign')} showLog={false} />
                  )}
                  <section className="liq-card">
                    <header className="liq-card-head">
                      <div className="liq-card-title"><Activity size={14} /> Current run</div>
                      <span className={`liq-pill ${isRunning ? 'tone-warn' : meta.tone}`}>
                        {isSyncing ? 'Syncing' : isRunning ? 'Live' : meta.label}
                      </span>
                    </header>
                    <div className="liq-card-body">
                      {progressTarget > 0 ? (
                        <div className="liq-run">
                          <div className="liq-run-top">
                            <h4>{progress?.currentRole ? `Filtering: ${progress.currentRole}` : 'Sending requests'}</h4>
                            <span className="liq-muted" style={{ fontSize: 10.5, fontWeight: 700 }}>
                              {progressPct}%
                            </span>
                          </div>
                          <div className="liq-progress"><span style={{ width: `${progressPct}%` }} /></div>
                          <div className="liq-run-meta">
                            <span><b>{progressSent}</b> of {progressTarget} requests</span>
                            <span>Target {progress?.targetPerRole || 0} per role</span>
                          </div>
                          <div className="liq-run-counters">
                            <div className="liq-run-counter"><b>{progress?.stats?.sent || 0}</b><span>Sent</span></div>
                            <div className="liq-run-counter"><b>{progress?.stats?.skipped || 0}</b><span>Skipped</span></div>
                            <div className="liq-run-counter"><b>{progress?.stats?.failed || 0}</b><span>Failed</span></div>
                          </div>
                          {isRunning && (
                            <button type="button" className="liq-btn danger" onClick={handleStop}>
                              <Square size={13} /> {isSyncing ? 'Stop sync' : 'Stop campaign'}
                            </button>
                          )}
                        </div>
                      ) : isSyncing ? (
                        <div className="liq-run-empty">
                          <strong>Syncing invite statuses</strong>
                          <p style={{ margin: '0 0 12px' }}>
                            A background tracker is checking pending invites. No campaign requests are being sent.
                          </p>
                          <button type="button" className="liq-btn danger sm" onClick={handleStop}>
                            <Square size={12} /> Stop sync
                          </button>
                        </div>
                      ) : (
                        <div className="liq-run-empty">
                          <strong>No campaign in progress</strong>
                          <p style={{ margin: '0 0 12px' }}>
                            {lastLog ? `Last automation event at ${lastLog.timestamp}.` : 'Configure a campaign to start sending invites.'}
                          </p>
                          <button type="button" className="liq-btn primary sm" onClick={() => setTab('campaign')}>
                            <Target size={13} /> Configure campaign
                          </button>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="liq-card">
                    <header className="liq-card-head">
                      <div className="liq-card-title"><Terminal size={14} /> Recent activity</div>
                      <button type="button" className="liq-link" onClick={() => setTab('activity')}>
                        All logs <ChevronRight size={11} />
                      </button>
                    </header>
                    <div className="liq-feed">
                      {logs.length === 0 ? (
                        <div className="liq-feed-empty">Waiting for automation events…</div>
                      ) : (
                        logs.slice(-5).reverse().map((log, index) => (
                          <div key={`${log.timestamp || ''}-${index}`} className={`liq-feed-row is-${levelOf(log)}`}>
                            <i className="liq-feed-dot" />
                            <span className="liq-feed-msg">{log.message}</span>
                            <span className="liq-feed-time">{log.timestamp}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="liq-card">
                    <header className="liq-card-head">
                      <div className="liq-card-title"><ShieldCheck size={14} /> Safety</div>
                      <button type="button" className="liq-link" onClick={() => setTab('campaign')}>
                        Details <ChevronRight size={11} />
                      </button>
                    </header>
                    <div className="liq-card-body">
                      <div className="liq-safety">
                        <div className="liq-safety-item">
                          <Clock size={13} />
                          <div><strong>Human-paced sending</strong><span>20–35s between requests and 8–15s between role filters.</span></div>
                        </div>
                        <div className="liq-safety-item">
                          <ShieldCheck size={13} />
                          <div><strong>Your own session</strong><span>Runs inside your saved Chrome profile, not a shared bot farm.</span></div>
                        </div>
                        <div className="liq-safety-item">
                          <KeyRound size={13} />
                          <div><strong>No password storage</strong><span>Sign-in happens in LinkedIn's window; this app never stores your password.</span></div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}

          {tab === 'campaign' && (
            <div className="liq-campaign">
              <section className="liq-card">
                <header className="liq-card-head">
                  <div className="liq-card-title"><Target size={14} /> Referral campaign launcher</div>
                  <span className={`liq-pill ${campaignRunning ? 'tone-warn' : meta.tone}`}>
                    {campaignRunning ? 'Running' : isSyncing ? 'Syncing' : meta.label}
                  </span>
                </header>
                <div className="liq-card-body">
                  <div className="liq-field">
                    <label className="liq-label" htmlFor="liq-company">Target company or LinkedIn URL</label>
                    <input
                      id="liq-company"
                      className="liq-input"
                      value={company}
                      onChange={(event) => setCompany(event.target.value)}
                      placeholder="e.g. Google, Microsoft or https://linkedin.com/company/…"
                      disabled={campaignActive}
                    />
                  </div>

                  <div className="liq-field">
                    <label className="liq-label" htmlFor="liq-role">
                      Target job role <em>every message is written for this role</em>
                    </label>
                    <input
                      id="liq-role"
                      className="liq-input"
                      value={jobRole}
                      onChange={(event) => setJobRole(event.target.value)}
                      placeholder="e.g. Software Engineer Intern, Data Analyst"
                      disabled={campaignActive}
                    />
                  </div>

                  <div className="liq-field">
                    <div className="liq-label">Invite roles for not-connected people <em>{roles.length} selected</em></div>
                    <div className="liq-chips">
                      {roles.map((role) => (
                        <span key={role} className="liq-chip">
                          {role}
                          {!campaignActive && (
                            <button type="button" onClick={() => setRoles(roles.filter((item) => item !== role))} aria-label={`Remove ${role}`}>
                              <X size={10} />
                            </button>
                          )}
                        </span>
                      ))}
                      {roles.length === 0 && <span className="liq-muted" style={{ fontSize: 11.5 }}>Add at least one role below.</span>}
                    </div>
                    {!campaignActive && (
                      <div className="liq-role-add">
                        <input
                          value={newRole}
                          onChange={(event) => setNewRole(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addRole();
                            }
                          }}
                          placeholder="Add a role, e.g. Engineering Manager"
                        />
                        <button type="button" className="liq-btn sm" onClick={addRole} disabled={!newRole.trim()}>
                          <Plus size={12} /> Add
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="liq-field">
                    <label className="liq-label" htmlFor="liq-referral-target">
                      Messages to Network (at Company) <em>direct referral DMs to existing 1st-degree connections</em>
                    </label>
                    <input
                      id="liq-referral-target"
                      className="liq-input"
                      type="number"
                      min="1"
                      max="40"
                      value={referralTarget}
                      onChange={(event) => {
                        const next = Number(event.target.value) || 1;
                        setReferralTarget(Math.max(1, Math.min(40, next)));
                      }}
                      disabled={campaignActive}
                    />
                  </div>

                  <div className="liq-row2">
                    <div className="liq-field">
                      <label className="liq-label" htmlFor="liq-per-role">New Connection Requests per Role <em>sent to new contacts matching roles</em></label>
                      <input
                        id="liq-per-role"
                        className="liq-input"
                        type="number"
                        min="1"
                        max="40"
                        value={perRole}
                        onChange={(event) => {
                          const next = Number(event.target.value) || 1;
                          setPerRole(Math.max(1, Math.min(40, next)));
                        }}
                        disabled={campaignActive}
                      />
                    </div>
                    <div className="liq-field">
                      <div className="liq-label">Message style</div>
                      <button
                        type="button"
                        className={`liq-toggle ${useAI ? 'on' : ''}`}
                        onClick={() => setUseAI((value) => !value)}
                        disabled={campaignActive}
                      >
                        <Sparkles size={13} /> {useAI ? 'AI-written + template fallback' : 'Template only'}
                      </button>
                    </div>
                  </div>

                  <div className="liq-field">
                    <label className="liq-label" htmlFor="liq-note">
                      Fallback note template <em>used when AI is unavailable</em>
                    </label>
                    <textarea
                      id="liq-note"
                      className="liq-textarea"
                      rows={3}
                      maxLength={200}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Hi {name}, I'd love to connect and learn more about opportunities at your company!"
                      disabled={campaignActive}
                    />
                    <div className="liq-note-meta">
                      <span>Supports {'{name}'}. LinkedIn allows up to 200 characters.</span>
                      <span className={note.length > 190 ? 'is-over' : ''}>{note.length}/200</span>
                    </div>
                  </div>

                  <div className="liq-estimate">
                    <span><b>Network Messages</b> · up to {referralTarget} referral DMs to existing 1st-degree connections</span>
                    <span><b>New Connection Requests</b> · up to {perRole} invites per role filter ({batchTotal} total)</span>
                    <span><Hourglass size={12} /> {formatEstimate(estimateSeconds)}, referral messages take longer</span>
                  </div>

                  <div className="liq-actions">
                    {campaign?.status === 'running' || campaign?.status === 'queued' || campaign?.status === 'waiting' ? (
                      <button
                        type="button"
                        className="liq-btn danger"
                        onClick={async () => {
                          try {
                            const res = await api.pauseCampaign(campaign.id);
                            if (res?.campaign) setCampaign(res.campaign);
                            flash('ok', 'Campaign paused. Resume whenever you are ready.');
                          } catch (err) {
                            flash('err', err.message || 'Could not pause the campaign.');
                          }
                        }}
                      >
                        <PauseCircle size={14} /> Pause campaign
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="liq-btn primary"
                        onClick={handleStart}
                        disabled={starting || !connected || !jobRole.trim() || !company.trim() || campaign?.status === 'paused'}
                      >
                        <Play size={14} />
                        {starting
                          ? 'Starting…'
                          : accountLoading
                            ? 'Checking LinkedIn session…'
                            : !connected
                              ? 'Connect LinkedIn to start'
                              : campaign?.status === 'paused'
                                ? 'Resume below to continue'
                                : 'Start campaign'}
                      </button>
                    )}
                  </div>
                  <div className={`liq-start-hint ${!connected && !accountLoading ? 'is-block' : ''}`}>
                    {accountLoading
                      ? 'Checking the saved LinkedIn session for this profile…'
                      : !connected
                        ? 'Connect your LinkedIn session above before starting.'
                        : !jobRole.trim()
                          ? 'Enter the target job role so messages can be personalised for it.'
                          : campaign?.status === 'paused'
                            ? 'A paused campaign is waiting. Use Resume in the live status card below.'
                            : needsLogin
                              ? 'The last sync hit a login wall. Reconnect above if this run cannot send.'
                              : 'Runs in the backend — leaving this page will not stop the campaign.'}
                  </div>
                </div>
              </section>

              <div className="liq-stack">
                <CampaignStatus
                  variant="full"
                  onNavigate={() => setTab('connections')}
                  showLog
                />
                <section className="liq-card">
                  <header className="liq-card-head">
                    <div className="liq-card-title"><Timer size={14} /> How this run is paced</div>
                  </header>
                  <div className="liq-card-body">
                    <div className="liq-safety">
                      <div className="liq-safety-item">
                        <Clock size={13} />
                        <div><strong>20–35 seconds between requests</strong><span>Randomized human-like delay enforced by the bot engine.</span></div>
                      </div>
                      <div className="liq-safety-item">
                        <Timer size={13} />
                        <div><strong>8–15 seconds between role filters</strong><span>The queue pauses when it switches search filters.</span></div>
                      </div>
                      <div className="liq-safety-item">
                        <Gauge size={13} />
                        <div><strong>Up to 40 requests per role</strong><span>This is the maximum this dashboard will request in one filter.</span></div>
                      </div>
                      <div className="liq-safety-item warn">
                        <MessageSquare size={13} />
                        <div><strong>200-character note limit</strong><span>LinkedIn truncates longer connection notes, so the form caps them.</span></div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="liq-card">
                  <header className="liq-card-head">
                    <div className="liq-card-title"><ShieldCheck size={14} /> Consent &amp; guardrails</div>
                  </header>
                  <div className="liq-card-body">
                    <div className="liq-safety">
                      <div className="liq-guard">
                        <CheckCircle2 size={13} />
                        <span><strong>Consent-first:</strong> you connect your own account and start every campaign yourself.</span>
                      </div>
                      <div className="liq-guard">
                        <ShieldCheck size={13} />
                        <span><strong>Per-user session:</strong> the Chrome profile lives under <code>sessions/&lt;user&gt;</code> on this machine.</span>
                      </div>
                      <div className="liq-guard">
                        <KeyRound size={13} />
                        <span><strong>No credentials:</strong> LinkedIn passwords are never requested, sent, or stored by the dashboard.</span>
                      </div>
                      <div className="liq-guard">
                        <AlertTriangle size={13} />
                        <span><strong>Honest limits:</strong> this is not a bulk scraper. It sends the queue you define, then stops.</span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {tab === 'connections' && (
            <>
              {companyScope !== 'all' && scopeCompany && (
                <div className="liq-scope">
                  <Building2 size={13} />
                  Showing <strong>{companyScope}</strong> · {scopeCompany.sent} sent
                  <button type="button" className="liq-link" onClick={() => setCompanyScope('all')}>
                    Clear scope <X size={11} />
                  </button>
                </div>
              )}

              <section className="liq-conn-card" ref={connCardRef}>
                <header className="liq-card-head">
                  <div className="liq-card-title"><Users size={14} /> Connection tracker</div>
                  <span className="liq-muted" style={{ fontSize: 10.5, fontWeight: 700 }}>
                    {filteredConnections.length} of {companyConnections.length}
                  </span>
                </header>

                <div className="liq-toolbar">
                  <div className="liq-search">
                    <Search size={14} />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search name, company, role or reply…"
                    />
                    {search && (
                      <button type="button" className="liq-btn icon" onClick={() => setSearch('')} aria-label="Clear search">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <select
                    className="liq-select"
                    style={{ maxWidth: 200 }}
                    value={companyScope}
                    onChange={(event) => setCompanyScope(event.target.value)}
                    aria-label="Filter by company"
                  >
                    <option value="all">All companies</option>
                    {companies.map((item) => (
                      <option key={item.company} value={item.company}>{item.company}</option>
                    ))}
                  </select>
                </div>

                <div className="liq-toolbar">
                  <div className="liq-filters">
                    {CONN_STATUS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`liq-filter ${statusFilter === item.key ? 'active' : ''}`}
                        onClick={() => setStatusFilter(item.key)}
                      >
                        {item.label} {statusCounts[item.key] || 0}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredConnections.length === 0 ? (
                  <div className="liq-empty">
                    <div className="liq-empty-icon"><Users size={18} /></div>
                    <strong>{connections.length ? 'No connections match these filters' : 'No connections yet'}</strong>
                    <p>
                      {connections.length
                        ? 'Try clearing the search, status or company filters.'
                        : 'Launch a campaign to start sending personalized requests. Results land here as the tracker syncs.'}
                    </p>
                    {connections.length > 0 ? (
                      <button
                        type="button"
                        className="liq-btn"
                        onClick={() => { setSearch(''); setStatusFilter('all'); setCompanyScope('all'); }}
                      >
                        Clear filters
                      </button>
                    ) : (
                      <button type="button" className="liq-btn primary" onClick={() => setTab('campaign')}>
                        <Target size={13} /> Configure a campaign
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="liq-conn-list">
                      {visibleConnections.map((item) => (
                        <div key={item.id} className="liq-conn-row">
                          <div className="liq-avatar">{initials(item.name)}</div>
                          <div className="liq-conn-main">
                            {item.profileUrl ? (
                              <a href={item.profileUrl} target="_blank" rel="noreferrer" className="liq-conn-name">
                                {item.name || 'LinkedIn member'} <ExternalLink size={10} />
                              </a>
                            ) : (
                              <span className="liq-conn-name">{item.name || 'LinkedIn member'}</span>
                            )}
                            <span className="liq-conn-sub">
                              {[item.headline || item.role, item.company].filter(Boolean).join(' · ') || 'LinkedIn member'}
                            </span>
                            {item.status === 'replied' && item.replyText && (
                              <p className="liq-conn-reply">“{item.replyText}”</p>
                            )}
                          </div>
                          <div className="liq-conn-side">
                            <span className="liq-conn-time">{timeAgo(item.sentDate || item.lastChecked)}</span>
                            <span className={`liq-status s-${item.status || 'pending'}`}>
                              {STATUS_LABEL[item.status] || item.status || 'Pending'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {visibleCount < filteredConnections.length && (
                      <div className="liq-loadmore">
                        <button type="button" className="liq-btn" onClick={() => setVisibleCount((count) => count + 120)}>
                          Show {Math.min(120, filteredConnections.length - visibleCount)} more
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}

          {tab === 'activity' && (
            <section className="liq-card">
              <header className="liq-card-head">
                <div className="liq-card-title"><Terminal size={14} /> Automation log</div>
                <span className={`liq-pill ${wsLive ? 'tone-success' : 'tone-neutral'}`}>
                  {wsLive ? 'Streaming live' : 'Polling every 10s'}
                </span>
              </header>

              <div className="liq-toolbar">
                <div className="liq-search">
                  <Search size={14} />
                  <input
                    value={logQuery}
                    onChange={(event) => setLogQuery(event.target.value)}
                    placeholder="Filter log messages…"
                  />
                  {logQuery && (
                    <button type="button" className="liq-btn icon" onClick={() => setLogQuery('')} aria-label="Clear log search">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="liq-filters">
                  {LOG_LEVELS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`liq-filter ${logLevel === item.key ? 'active' : ''}`}
                      onClick={() => setLogLevel(item.key)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`liq-btn sm ${autoScroll ? '' : 'subtle'}`}
                  onClick={() => setAutoScroll((value) => !value)}
                  title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
                >
                  {autoScroll ? <PauseCircle size={13} /> : <PlayCircle size={13} />}
                  {autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
                </button>
                <button type="button" className="liq-btn sm" onClick={handleCopyLogs}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="liq-log" ref={logRef}>
                {filteredLogs.length === 0 ? (
                  <div className="liq-log-empty">
                    {logs.length === 0 ? 'Waiting for automation events…' : 'No log lines match this filter.'}
                  </div>
                ) : (
                  filteredLogs.map((log, index) => (
                    <div key={`${log.timestamp || ''}-${index}`} className={`liq-log-row is-${levelOf(log)}`}>
                      <span className="liq-log-time">{log.timestamp}</span>
                      <span className="liq-log-msg">{log.message}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="liq-log-foot">
                <span><Radio size={11} /> {filteredLogs.length} of {logs.length} events shown</span>
                <span>The server keeps the last 500 events</span>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
