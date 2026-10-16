import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users, UserCheck, Eye, MessageCircle, Clock, Play, Square, RefreshCw, Search,
  ExternalLink, Sparkles, Terminal, Plus, X, Radio, Activity, Zap, Target, KeyRound,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, profileStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import ConnectedAccount from '../components/ConnectedAccount';
import EmptyState from '../components/EmptyState';

const LinkedinIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const STATUS_META = {
  idle: { label: 'Idle', cls: 'idle' },
  running: { label: 'Running', cls: 'running' },
  syncing: { label: 'Syncing', cls: 'running' },
  requires_login: { label: 'Login Required', cls: 'warn' },
  completed: { label: 'Completed', cls: 'completed' },
  stopped: { label: 'Stopped', cls: 'stopped' },
};

const CONN_STATUS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'seen', label: 'Seen' },
  { key: 'replied', label: 'Replied' },
  { key: 'declined', label: 'Declined' },
];

const DEFAULT_ROLES = ['Recruiter', 'Talent Acquisition', 'HR', 'Hiring Manager', 'Engineering Manager'];

export default function LinkedInAutomation() {
  const { user } = useAuth();
  const userId = user?.id || 'demo-user-1';

  const [serverOnline, setServerOnline] = useState(false);
  const [statusInfo, setStatusInfo] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [connections, setConnections] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Per-user LinkedIn account connect state
  const [liAccount, setLiAccount] = useState(null);
  const [connectPending, setConnectPending] = useState(false);
  const [cookieMode, setCookieMode] = useState(false);
  const [liAt, setLiAt] = useState('');
  const [cookieBusy, setCookieBusy] = useState(false);

  // Campaign form
  const [searchParams] = useSearchParams();
  const [company, setCompany] = useState(() => searchParams.get('company') || '');
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [newRole, setNewRole] = useState('');
  const [perRole, setPerRole] = useState(10);
  const [useAI, setUseAI] = useState(true);
  const [note, setNote] = useState('');
  const [starting, setStarting] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  // Connections filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const logRef = useRef(null);
  const wsOkRef = useRef(false);

  const isRunning = statusInfo?.status === 'running' || statusInfo?.status === 'syncing';
  const progress = statusInfo?.progress;
  const pct = progress?.stats?.totalTarget
    ? Math.min(100, Math.round((progress.stats.sent / progress.stats.totalTarget) * 100))
    : 0;

  const refreshData = useCallback(async () => {
    try {
      const [s, c, a] = await Promise.all([
        api.getLinkedInStatus(),
        api.getLinkedInConnections(),
        api.getLinkedInAnalytics(),
      ]);
      setServerOnline(true);
      setStatusInfo(s);
      setConnections(Array.isArray(c) ? c : []);
      setAnalytics(a);
    } catch {
      setServerOnline(false);
    }
  }, []);

  // Load this user's connected LinkedIn account once the server is reachable
  useEffect(() => {
    if (!serverOnline) return undefined;
    let alive = true;
    api.getLinkedInAccount(userId)
      .then((acc) => {
        if (!alive) return;
        setLiAccount(acc);
        setConnectPending(acc.status === 'pending_login');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [serverOnline, userId]);

  // Poll account state while a login window is open (fallback when WS missed)
  useEffect(() => {
    if (!connectPending) return undefined;
    const t = setInterval(async () => {
      try {
        const acc = await api.getLinkedInAccount(userId);
        setLiAccount(acc);
        setConnectPending(acc.status === 'pending_login');
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [connectPending, userId]);

  // Initial: check if automation server is reachable
  useEffect(() => {
    let alive = true;
    api.getLinkedInStatus()
      .then((d) => {
        if (!alive) return;
        setServerOnline(true);
        setStatusInfo(d);
        setLoading(false);
        api.getLinkedInConnections().then((c) => alive && setConnections(Array.isArray(c) ? c : [])).catch(() => {});
        api.getLinkedInAnalytics().then((a) => alive && setAnalytics(a)).catch(() => {});
      })
      .catch(() => {
        if (!alive) return;
        setServerOnline(false);
        setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  // WebSocket live updates
  useEffect(() => {
    if (!serverOnline) return undefined;
    let ws;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(`ws://${window.location.host}/linkedin-api`);
      } catch {
        return;
      }

      ws.onopen = () => { wsOkRef.current = true; };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        const { type, data } = msg;
        if (type === 'init') {
          setStatusInfo({ status: data.status, progress: data.progress });
          setLogs(data.logs || []);
          setConnections(data.connections || []);
          setAnalytics(data.analytics);
          const mine = (data.accounts || []).find((a) => a.userId === userId);
          if (mine) {
            setLiAccount(mine);
            setConnectPending(mine.status === 'pending_login');
          }
        } else if (type === 'linkedin_account') {
          if (data.userId === userId) {
            setLiAccount(data.account);
            setConnectPending(data.account.status === 'pending_login');
            if (data.account.connected) {
              flash(`LinkedIn connected as ${data.account.memberName || 'LinkedIn Member'}`, 'ok');
            }
          }
        } else if (type === 'log') {
          setLogs((prev) => [...prev.slice(-199), data]);
        } else if (type === 'progress') {
          setStatusInfo((s) => ({ ...(s || {}), progress: data }));
        } else if (type === 'sent') {
          setConnections((prev) => [data, ...prev.filter((c) => c.id !== data.id)]);
          api.getLinkedInAnalytics().then(setAnalytics).catch(() => {});
        } else if (type === 'status_change') {
          setStatusInfo((s) => ({ ...(s || {}), status: data.status }));
        } else if (type === 'connections_updated') {
          setConnections(data.connections || []);
          setAnalytics(data.analytics);
        }
      };
      ws.onclose = () => {
        wsOkRef.current = false;
        if (!closed) setTimeout(connect, 4000);
      };
    };

    connect();

    // REST polling fallback when WS is not open
    const poll = setInterval(() => {
      if (!wsOkRef.current) refreshData().catch(() => {});
    }, 10000);

    return () => {
      closed = true;
      clearInterval(poll);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [serverOnline, refreshData, userId]);

  // Auto-scroll log feed
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const flash = (msg, type = 'ok') => {
    setActionMsg({ msg, type });
    setTimeout(() => setActionMsg(null), 4000);
  };

  const handleConnect = async () => {
    try {
      const res = await api.connectLinkedIn(userId);
      if (res.status === 'connected') {
        setLiAccount(res.account);
        flash(`LinkedIn already connected as ${res.account?.memberName || 'LinkedIn Member'}`, 'ok');
      } else {
        setConnectPending(true);
        flash('🌐 LinkedIn login window opened — log in with YOUR LinkedIn account (2FA supported)', 'ok');
      }
    } catch (err) {
      flash(err.message || 'Failed to open LinkedIn login window', 'err');
    }
  };

  const handleCancelConnect = async () => {
    try { await api.disconnectLinkedIn(userId); } catch {}
    setConnectPending(false);
    api.getLinkedInAccount(userId).then(setLiAccount).catch(() => {});
  };

  const handleDisconnect = async () => {
    try {
      await api.disconnectLinkedIn(userId);
      setLiAccount(null);
      flash('LinkedIn account disconnected', 'ok');
    } catch (err) {
      flash(err.message || 'Failed to disconnect', 'err');
    }
  };

  const handleCookieConnect = async () => {
    const cookie = liAt.trim();
    if (!cookie) { flash('Paste your li_at cookie first', 'err'); return; }
    setCookieBusy(true);
    try {
      const res = await api.connectLinkedInCookie(userId, cookie);
      setLiAccount(res.account);
      setLiAt('');
      setCookieMode(false);
      flash(`LinkedIn connected as ${res.account?.memberName || 'LinkedIn Member'}`, 'ok');
    } catch (err) {
      flash(err.message || 'li_at cookie connect failed', 'err');
    }
    setCookieBusy(false);
  };

  const handleStart = async () => {
    if (!roles.length) { flash('Add at least one role filter', 'err'); return; }
    if (!liAccount?.connected) {
      flash('Connect your LinkedIn account first (Connected Accounts → Connect)', 'err');
      return;
    }
    setStarting(true);
    try {
      await api.startLinkedIn({
        userId,
        company,
        roles,
        connectionsPerFilter: perRole,
        connectionNote: note || undefined,
        useAINotes: useAI,
        userProfile: profileStore.get() || {},
      });
      flash('🚀 Campaign started! Chrome window will open.', 'ok');
      setStatusInfo((s) => ({ ...(s || {}), status: 'running' }));
    } catch (err) {
      flash(err.message || 'Failed to start campaign', 'err');
    }
    setStarting(false);
  };

  const handleStop = async () => {
    try {
      await api.stopLinkedIn();
      flash('Stop signal sent', 'ok');
      setStatusInfo((s) => ({ ...(s || {}), status: 'stopped' }));
    } catch (err) {
      flash(err.message || 'Failed to stop', 'err');
    }
  };

  const handleSync = async () => {
    try {
      await api.syncLinkedInStatus(userId);
      flash('Background status sync started', 'ok');
    } catch (err) {
      flash(err.message || 'Sync failed', 'err');
    }
  };

  const addRole = () => {
    const r = newRole.trim();
    if (r && !roles.includes(r)) setRoles([...roles, r]);
    setNewRole('');
  };

  const filteredConnections = connections.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.headline || '').toLowerCase().includes(q) ||
        (c.role || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="page-linkedin">
        <header className="page-header"><h1>LinkedIn Automation</h1></header>
        <div className="loading-screen inline"><div className="loading-spinner" /><p>Checking connection…</p></div>
      </div>
    );
  }

  const meta = STATUS_META[statusInfo?.status] || STATUS_META.idle;

  return (
    <div className="page-linkedin">
      <header className="page-header">
        <div>
          <h1>LinkedIn Automation</h1>
          <p>Launch targeted outreach campaigns and track every connection in real time.</p>
        </div>
        <div className="header-actions">
          {serverOnline && (
            <>
              <button className="btn-ghost" onClick={handleSync} title="Sync connection statuses from LinkedIn">
                <RefreshCw size={14} /> Sync Status
              </button>
              <span className={`status-pill ${meta.cls}`}><Radio size={12} /> Server {meta.label}</span>
            </>
          )}
        </div>
      </header>

      <section className="dash-section">
        <h2>Connected Accounts</h2>
        <ConnectedAccount
          name="LinkedIn"
          icon={LinkedinIcon}
          connected={serverOnline && !!liAccount?.connected}
          email={
            serverOnline && liAccount?.connected
              ? `${liAccount.memberName}${liAccount.headline ? ` · ${liAccount.headline}` : ''} · session saved`
              : serverOnline
                ? 'No LinkedIn account connected for your profile — click Connect and log in with your LinkedIn'
                : ''
          }
          pending={serverOnline && connectPending}
          error={!serverOnline ? 'Automation server offline — start it and Retry below' : undefined}
          onConnect={handleConnect}
          onReconnect={handleConnect}
          onDisconnect={serverOnline ? handleDisconnect : undefined}
          onCancel={handleCancelConnect}
        />
        {serverOnline && !liAccount?.connected && !connectPending && !cookieMode && (
          <button className="btn-ghost sm" style={{ marginTop: 8 }} onClick={() => setCookieMode(true)}>
            <KeyRound size={13} /> Connect using li_at cookie instead
          </button>
        )}
        {serverOnline && !liAccount?.connected && cookieMode && (
          <div className="li-cookie-connect">
            <label>Connect with li_at cookie</label>
            <div className="li-cookie-row">
              <input
                value={liAt}
                onChange={(e) => setLiAt(e.target.value)}
                placeholder="Paste li_at cookie value…"
                disabled={cookieBusy}
              />
              <button className="btn-accent" onClick={handleCookieConnect} disabled={cookieBusy}>
                {cookieBusy ? 'Verifying…' : 'Connect'}
              </button>
              <button className="btn-ghost sm" onClick={() => { setCookieMode(false); setLiAt(''); }}>
                <X size={13} />
              </button>
            </div>
            <div className="li-cookie-hint">
              Open <code>linkedin.com</code> while logged in → DevTools → Application → Cookies → copy the <code>li_at</code> value and paste it here.
              Your LinkedIn password is never shared with this app.
            </div>
          </div>
        )}
        {actionMsg && (
          <div className={`li-flash ${actionMsg.type === 'err' ? 'err' : 'ok'}`}>{actionMsg.msg}</div>
        )}
      </section>

      {!serverOnline ? (
        <EmptyState
          icon={LinkedinIcon}
          title="Automation server not running"
          description="Start the LinkedIn automation backend to launch campaigns. Run: cd D:\\Automation && node server.js — it listens on http://localhost:3000."
          actionLabel="Retry Connection"
          onAction={() => { setLoading(true); window.location.reload(); }}
        />
      ) : (
        <>
          {/* Analytics */}
          <section className="dash-section">
            <h2>Campaign Analytics</h2>
            <div className="li-analytics-grid">
              <div className="li-stat c-blue"><Users size={18} /><div><strong>{analytics?.totalSent ?? 0}</strong><span>Requests Sent</span></div></div>
              <div className="li-stat c-green"><UserCheck size={18} /><div><strong>{analytics?.accepted ?? 0}</strong><span>Accepted</span></div></div>
              <div className="li-stat c-purple"><Eye size={18} /><div><strong>{analytics?.seen ?? 0}</strong><span>Seen</span></div></div>
              <div className="li-stat c-orange"><MessageCircle size={18} /><div><strong>{analytics?.replied ?? 0}</strong><span>Replied</span></div></div>
              <div className="li-stat c-yellow"><Clock size={18} /><div><strong>{analytics?.pending ?? 0}</strong><span>Pending</span></div></div>
              <div className="li-stat c-pink"><Zap size={18} /><div><strong>{analytics?.acceptanceRate ?? 0}%</strong><span>Acceptance Rate</span></div></div>
            </div>
          </section>

          <div className="li-grid">
            {/* Campaign Launcher */}
            <section className="dash-section li-launcher">
              <div className="li-card">
                <div className="li-card-head">
                  <h3><Target size={16} /> Campaign Launcher</h3>
                  <span className={`status-pill ${meta.cls}`}>{meta.label}</span>
                </div>

                <div className="li-field">
                  <label>Target Company</label>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Google, Microsoft, Meta or LinkedIn URL"
                    disabled={isRunning}
                  />
                </div>

                <div className="li-field">
                  <label>Role Filters</label>
                  <div className="li-chips">
                    {roles.map((r) => (
                      <span key={r} className="li-chip">
                        {r}
                        {!isRunning && (
                          <button onClick={() => setRoles(roles.filter((x) => x !== r))}><X size={11} /></button>
                        )}
                      </span>
                    ))}
                  </div>
                  {!isRunning && (
                    <div className="li-role-add">
                      <input
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRole()}
                        placeholder="Add role (e.g. Engineering Manager)"
                      />
                      <button className="btn-ghost sm" onClick={addRole}><Plus size={13} /> Add</button>
                    </div>
                  )}
                </div>

                <div className="li-row2">
                  <div className="li-field">
                    <label>Connections / Role</label>
                    <input type="number" min="1" max="40" value={perRole} onChange={(e) => setPerRole(Number(e.target.value) || 10)} disabled={isRunning} />
                  </div>
                  <div className="li-field">
                    <label>AI Personalized Notes</label>
                    <button className={`li-toggle ${useAI ? 'on' : ''}`} onClick={() => setUseAI(!useAI)} disabled={isRunning}>
                      <Sparkles size={13} /> {useAI ? 'Gemini AI On' : 'Template Notes'}
                    </button>
                  </div>
                </div>

                <div className="li-field">
                  <label>Custom Note Template <em>(optional — {useAI ? 'used as fallback' : 'used for everyone'})</em></label>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Hi {name}, I'd love to connect and learn more about opportunities at your company!"
                    disabled={isRunning}
                  />
                </div>

                {progress?.stats?.totalTarget > 0 && (
                  <div className="li-progress-wrap">
                    <div className="li-progress-top">
                      <span><Activity size={13} /> {progress.currentRole ? `Filtering: ${progress.currentRole}` : 'Campaign progress'}</span>
                      <strong>{progress.stats.sent}/{progress.stats.totalTarget}</strong>
                    </div>
                    <div className="li-progress"><div className="li-progress-bar" style={{ width: `${pct}%` }} /></div>
                    <div className="li-progress-meta">
                      <span>✅ {progress.stats.sent} sent</span>
                      <span>⏭️ {progress.stats.skipped} skipped</span>
                      <span>⚠️ {progress.stats.failed} failed</span>
                    </div>
                  </div>
                )}

                <div className="li-actions">
                  {isRunning ? (
                    <button className="btn-ghost danger" onClick={handleStop}><Square size={14} /> Stop Campaign</button>
                  ) : (
                    <button
                      className="btn-accent"
                      onClick={handleStart}
                      disabled={starting || !liAccount?.connected}
                      title={!liAccount?.connected ? 'Connect your LinkedIn account first' : ''}
                    >
                      <Play size={14} /> {starting ? 'Starting…' : liAccount?.connected ? `Start Campaign (${roles.length * perRole} requests)` : 'Connect LinkedIn to Start'}
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Live Activity */}
            <section className="dash-section li-activity">
              <div className="li-card">
                <div className="li-card-head">
                  <h3><Terminal size={16} /> Live Activity</h3>
                  <span className="li-live-dot"><span /> Live</span>
                </div>
                <div className="li-log-feed" ref={logRef}>
                  {logs.length === 0 && <div className="li-log-empty">Waiting for automation events…</div>}
                  {logs.map((l, i) => (
                    <div key={i} className={`li-log-line ${l.level || 'info'}`}>
                      <span className="li-log-time">{l.timestamp}</span>
                      <span className="li-log-msg">{l.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* Connections Tracker */}
          <section className="dash-section">
            <div className="section-header">
              <h2>Connections Tracker <span className="li-count">{filteredConnections.length}</span></h2>
              <div className="li-filters">
                <div className="search-box sm">
                  <Search size={14} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, role…" />
                </div>
                <div className="li-status-chips">
                  {CONN_STATUS.map((s) => (
                    <button
                      key={s.key}
                      className={`chip ${statusFilter === s.key ? 'active' : ''}`}
                      onClick={() => setStatusFilter(s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredConnections.length === 0 ? (
              <div className="activity-timeline">
                <div className="activity-empty">
                  <p>No connections yet. Launch a campaign to start sending personalized requests!</p>
                </div>
              </div>
            ) : (
              <div className="li-conn-list">
                {filteredConnections.slice(0, 60).map((c) => (
                  <div key={c.id} className="li-conn-row">
                    <div className="li-conn-avatar">{(c.name || 'U')[0].toUpperCase()}</div>
                    <div className="li-conn-info">
                      <a href={c.profileUrl || '#'} target="_blank" rel="noreferrer" className="li-conn-name">
                        {c.name} <ExternalLink size={11} />
                      </a>
                      <small>{c.headline || c.role || 'LinkedIn member'}{c.company ? ` · ${c.company}` : ''}</small>
                    </div>
                    <span className={`li-conn-status s-${c.status}`}>{c.status}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
