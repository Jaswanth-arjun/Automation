import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Mail,
  Inbox,
  Send,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Sparkles,
  X,
  ChevronRight,
  Archive,
  PenLine,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  Briefcase,
  Paperclip,
  ShieldCheck,
  ArrowDownUp,
  CornerUpLeft,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { refreshConnectStatus } from '../lib/connectStatus';
import {
  SIGNAL_META,
  PIPELINE_SIGNALS,
  decorateMail,
  mailContext,
  formatWhen,
  daysSince,
  initials,
  senderLabel,
} from '../lib/mailSignals';
import './MailAutomation.css';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'job', label: 'Job mail' },
  { key: 'interview', label: 'Interviews' },
  { key: 'offer', label: 'Offers' },
  { key: 'assessment', label: 'Assessments' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'recruiter', label: 'Recruiters' },
  { key: 'rejected', label: 'Updates' },
  { key: 'unread', label: 'Unread' },
  { key: 'starred', label: 'Starred' },
];

const CATEGORY_COLORS = {
  'Job/Recruitment': '#445cf5',
  'Work/Professional': '#1d63c9',
  'Newsletters': '#6d28d9',
  'Notifications': '#b45309',
  'Uncategorized': '#8a8c86',
};

const SIGNAL_TONE = {
  OFFER: 'tone-success',
  INTERVIEW: 'tone-indigo',
  ASSESSMENT: 'tone-amber',
  SHORTLISTED: 'tone-blue',
  RECRUITER: 'tone-blue',
  REJECTED: 'tone-danger',
  APPLIED: 'tone-cyan',
  NEWSLETTER: 'tone-purple',
  OTHER: 'tone-neutral',
};

function byDate(a, b) {
  return new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0);
}

function matchesFilter(mail, key) {
  switch (key) {
    case 'needs_reply':
      return Boolean(mail.needsReply);
    case 'job':
      return Boolean(mail.isJobRelated);
    case 'interview':
      return mail.signal === 'INTERVIEW';
    case 'offer':
      return mail.signal === 'OFFER';
    case 'assessment':
      return mail.signal === 'ASSESSMENT';
    case 'shortlisted':
      return mail.signal === 'SHORTLISTED';
    case 'recruiter':
      return mail.signal === 'RECRUITER';
    case 'rejected':
      return mail.signal === 'REJECTED';
    case 'unread':
      return !mail.isRead;
    case 'starred':
      return Boolean(mail.isStarred);
    default:
      return true;
  }
}

function searchMatch(mail, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [mail.subject, mail.snippet, mail.senderName, mail.senderEmail, mail.company, mail.bodyText]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

export default function MailAutomation() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') || 'overview';
  // The Job updates tab was removed; old links fall back to Overview.
  const tab = tabParam === 'updates' ? 'overview' : tabParam;

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState({ email: '', method: '' });
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState(null);
  const [lastSync, setLastSync] = useState(() => localStorage.getItem('hamzo_last_sync') || localStorage.getItem('mailmind_last_sync') || '');

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('priority');
  const [mailError, setMailError] = useState('');
  const [bodyState, setBodyState] = useState({});

  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [summaries, setSummaries] = useState({});
  const [composer, setComposer] = useState(null);
  const [ai, setAi] = useState(null);
  const [copiedId, setCopiedId] = useState('');

  const searchRef = useRef(null);
  const splitRef = useRef(null);
  const inflightBodies = useRef(new Set());

  const notify = useCallback((type, text) => setFlash({ type, text }), []);

  // Inbox/Sent: size the mail pane so it ends exactly at the bottom of the
  // viewport. The list then scrolls inside its own scrollbar instead of
  // stretching the page to the full length of the mailbox.
  useEffect(() => {
    if (tab !== 'inbox' && tab !== 'sent') return undefined;
    const fit = () => {
      const el = splitRef.current;
      if (!el) return;
      if (window.innerWidth < 1180) {
        el.style.height = '';
        el.style.marginBottom = '';
        return;
      }
              el.style.marginBottom = '0px';
        const top = Math.max(0, el.getBoundingClientRect().top);
        // Fill to the bottom of the screen plus ~2 extra rows, so a short page
        // scroll reveals them instead of only showing three at a time.
        const extra = 520;
        const next = Math.max(240, Math.round(window.innerHeight - top - 18 + extra));
        el.style.height = `${next}px`;
        // Cancel whatever trailing space the shell adds below the pane, so the
        // box ends at the viewport bottom and the page itself never scrolls.
        const paneBottom = el.getBoundingClientRect().bottom;
        const trailing = document.documentElement.scrollHeight - paneBottom;
        if (trailing > 18) el.style.marginBottom = `${18 - Math.round(trailing)}px`;
    };
    fit();
    const timer = setTimeout(fit, 120);
    window.addEventListener('resize', fit);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', fit);
      if (splitRef.current) {
        splitRef.current.style.height = '';
        splitRef.current.style.marginBottom = '';
      }
    };
  }, [tab, loading]);

  const loadMail = useCallback(async () => {
    const [inboxRes, sentRes] = await Promise.allSettled([
      api.getEmails(0, 30, '', 'INBOX'),
      api.getEmails(0, 30, '', 'SENT'),
    ]);

    if (inboxRes.status === 'rejected' && sentRes.status === 'rejected') {
      const reason = inboxRes.reason || sentRes.reason;
      const message = reason?.message || 'Could not load Gmail messages.';
      setMailError(message);
      return false;
    }

    setMailError('');
    if (inboxRes.status === 'fulfilled') {
      setInbox((inboxRes.value?.emails || []).map((mail) => decorateMail(mail, 'INBOX')));
    }
    if (sentRes.status === 'fulfilled') {
      setSent((sentRes.value?.emails || []).map((mail) => decorateMail(mail, 'SENT')));
    }
    // A successful mailbox load means we just read Gmail, so record it.
    const stamp = new Date().toISOString();
    localStorage.setItem('hamzo_last_sync', stamp);
    localStorage.setItem('mailmind_last_sync', stamp);
    setLastSync(stamp);
    return true;
  }, []);

  /**
   * Bodies are intentionally not part of the list response: fetching 30 full
   * messages per mailbox burns the Gmail quota. Load one body on demand and
   * return the enriched message so AI actions can use the real text.
   */
  const ensureBody = useCallback(
    async (mail) => {
      if (!mail?.id || mail.bodyText) return mail;
      if (inflightBodies.current.has(mail.id)) return mail;

      inflightBodies.current.add(mail.id);
      setBodyState((state) => ({ ...state, [mail.id]: 'loading' }));
      try {
        const body = await api.getEmail(mail.id);
        const merged = { ...mail, ...body };
        const patch = (list) => list.map((item) => (item.id === mail.id ? { ...item, ...body } : item));
        setInbox(patch);
        setSent(patch);
        setBodyState((state) => ({ ...state, [mail.id]: 'ready' }));
        return merged;
      } catch (err) {
        setBodyState((state) => ({ ...state, [mail.id]: 'error' }));
        notify('err', err.message || 'Could not load the message body.');
        return mail;
      } finally {
        inflightBodies.current.delete(mail.id);
      }
    },
    [notify],
  );

  // Boot: resolve the connection, then load mail. Handles the OAuth return
  // (`?connected=true`) that AuthCallback sends us back with.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const justConnected = params.get('connected') === 'true';
      const connectedEmail = params.get('email') || '';

      if (justConnected) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      setLoading(true);
      const cfg = await api.getGmailConfig().catch(() => null);
      if (cancelled) return;

      const isConnected = Boolean(cfg?.configured);
      setConnected(isConnected);
      setAccount({
        email: cfg?.email || connectedEmail || '',
        method: cfg?.method || '',
      });

      if (isConnected) {
        await loadMail();
        if (cancelled) return;
        setLoading(false);

        if (justConnected) {
          // Dashboard checklist + sidebar dot should reflect the new account.
          refreshConnectStatus(user?.id, { force: true }).catch(() => {});
          notify('ok', `Gmail connected${connectedEmail ? ` — ${connectedEmail}` : ''}. Syncing your inbox…`);
          try {
            await api.triggerSync();
            await loadMail();
            const stamp = new Date().toISOString();
            localStorage.setItem('hamzo_last_sync', stamp);
            localStorage.setItem('mailmind_last_sync', stamp);
            setLastSync(stamp);
            notify('ok', 'Inbox synced.');
          } catch (err) {
            notify('err', err.message || 'Connected, but the first sync failed.');
          }
        }
      } else {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadMail, notify]);

  // Flash messages auto-dismiss so the page never keeps stale banners.
  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(timer);
  }, [flash]);

  // `/` focuses search, Escape closes the reading pane / AI drawer.
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setDetailOpen(false);
        setAi(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const res = await api.getAuthUrl();
      if (res?.authUrl) {
        window.location.href = res.authUrl;
        return;
      }
      notify('err', 'Google did not return an authorization URL.');
    } catch (err) {
      notify('err', err.message || 'Could not start Gmail sign-in. Is the backend running?');
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    if (disconnecting) return;
    if (!window.confirm('Disconnect this Gmail account? Hamzo will stop syncing until you reconnect.')) return;

    setDisconnecting(true);
    let failed = false;
    try {
      await api.disconnectGmail();
    } catch {
      failed = true;
    }

    setConnected(false);
    setAccount({ email: '', method: '' });
    setInbox([]);
    setSent([]);
    setMailError('');
    setSelectedId(null);
    setDetailOpen(false);
    setSummaries({});
    setComposer(null);
    setAi(null);
    localStorage.removeItem('hamzo_last_sync');
    localStorage.removeItem('mailmind_last_sync');
    setLastSync('');
    setDisconnecting(false);

    // Keep the dashboard checklist and the sidebar dot in sync immediately.
    try {
      await refreshConnectStatus(user?.id, { force: true });
    } catch {
      // A status refresh failure must never look like a failed disconnect.
    }

    notify(
      failed ? 'err' : 'ok',
      failed
        ? 'Signed out in this tab, but the server did not confirm it. Reload the page before connecting again.'
        : 'Gmail disconnected. You can reconnect any time.',
    );
  };

  const handleSync = async () => {
    if (!connected) {
      handleConnect();
      return;
    }
    setSyncing(true);
    try {
      const res = await api.triggerSync();
      await loadMail();
      const stamp = new Date().toISOString();
      localStorage.setItem('hamzo_last_sync', stamp);
      localStorage.setItem('mailmind_last_sync', stamp);
      setLastSync(stamp);
      notify('ok', `Inbox synced — ${res?.received ?? 0} received, ${res?.sent ?? 0} sent.`);
    } catch (err) {
      notify('err', err.message || 'Could not sync Gmail.');
    } finally {
      setSyncing(false);
    }
  };

  const openMail = (mail) => {
    setSelectedId(mail.id);
    setDetailOpen(true);
    if (mail.mailbox === 'INBOX' && !mail.isRead) {
      setInbox((list) => list.map((item) => (item.id === mail.id ? { ...item, isRead: true } : item)));
      api.markRead(mail.id, true).catch(() => {});
    }
    // Fetch the full body lazily; the list only carries metadata.
    ensureBody(mail);
  };

  const handleStar = async (event, mail) => {
    event?.stopPropagation?.();
    const next = !mail.isStarred;
    const patch = (list) => list.map((item) => (item.id === mail.id ? { ...item, isStarred: next } : item));
    setInbox(patch);
    setSent(patch);
    try {
      await api.toggleStar(mail.id, next);
    } catch (err) {
      notify('err', err.message || 'Could not update the star.');
      await loadMail().catch(() => {});
    }
  };

  const removeLocally = (id) => {
    setInbox((list) => list.filter((mail) => mail.id !== id));
    setSent((list) => list.filter((mail) => mail.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setDetailOpen(false);
    }
  };

  const handleArchive = async (event, mail) => {
    event?.stopPropagation?.();
    removeLocally(mail.id);
    try {
      await api.archiveEmail(mail.id);
      notify('ok', 'Archived in Gmail.');
    } catch (err) {
      notify('err', err.message || 'Could not archive the email.');
      await loadMail().catch(() => {});
    }
  };

  const handleTrash = async (event, mail) => {
    event?.stopPropagation?.();
    removeLocally(mail.id);
    try {
      await api.trashEmail(mail.id);
      notify('ok', 'Moved to Gmail trash.');
    } catch (err) {
      notify('err', err.message || 'Could not trash the email.');
      await loadMail().catch(() => {});
    }
  };

  const summarize = async (mail) => {
    if (!mail) return;
    setSummaries((prev) => ({ ...prev, [mail.id]: { loading: true, text: '' } }));
    try {
      const full = await ensureBody(mail);
      const res = await api.summarizeMail(mailContext(full));
      setSummaries((prev) => ({
        ...prev,
        [mail.id]: { loading: false, text: res?.text || '', note: res?.fallback ? res.note || '' : '' },
      }));
    } catch (err) {
      setSummaries((prev) => ({
        ...prev,
        [mail.id]: { loading: false, text: '', error: err.message || 'Summary failed.' },
      }));
    }
  };

  const startReply = async (mail) => {
    if (!mail) return;
    setComposer({
      mail,
      subject: /^re:/i.test(mail.subject || '') ? mail.subject : `Re: ${mail.subject || 'your message'}`,
      text: '',
      loading: true,
      sending: false,
      error: '',
      note: '',
    });
    try {
      const full = await ensureBody(mail);
      const res = await api.generateMailReply(mailContext(full));
      setComposer((prev) =>
        prev && prev.mail.id === mail.id
          ? { ...prev, text: res?.text || '', loading: false, note: res?.fallback ? res.note || '' : '' }
          : prev,
      );
    } catch (err) {
      setComposer((prev) =>
        prev && prev.mail.id === mail.id
          ? { ...prev, loading: false, error: err.message || 'Could not generate a reply.' }
          : prev,
      );
    }
  };

  const sendReply = async () => {
    if (!composer || !composer.text.trim()) return;
    setComposer((prev) => ({ ...prev, sending: true, error: '' }));
    try {
      await api.replySend({
        to: composer.mail.senderEmail,
        subject: composer.subject,
        body: composer.text,
        threadId: composer.mail.threadId,
        inReplyTo: composer.mail.messageIdHeader,
        references: composer.mail.referencesHeader,
      });
      setComposer(null);
      notify('ok', `Reply sent to ${composer.mail.senderEmail}.`);
      await loadMail();
    } catch (err) {
      setComposer((prev) => ({ ...prev, sending: false, error: err.message || 'Could not send the reply.' }));
    }
  };

  const startFollowUp = async (mail) => {
    if (!mail) return;
    setAi({
      mail,
      subject: /^follow/i.test(mail.subject || '') ? mail.subject : `Following up: ${mail.subject || 'my last email'}`,
      text: '',
      loading: true,
      sending: false,
      error: '',
      note: '',
    });
    try {
      const full = await ensureBody(mail);
      const res = await api.generateFollowUp(mailContext(full));
      setAi((prev) =>
        prev && prev.mail.id === mail.id
          ? {
              ...prev,
              text: res?.text || '',
              subject: res?.subject || prev.subject,
              loading: false,
              note: res?.fallback ? res.note || '' : '',
            }
          : prev,
      );
    } catch (err) {
      setAi((prev) =>
        prev && prev.mail.id === mail.id
          ? { ...prev, loading: false, error: err.message || 'Could not write a follow-up.' }
          : prev,
      );
    }
  };

  const sendFollowUp = async () => {
    if (!ai || !ai.text.trim()) return;
    setAi((prev) => ({ ...prev, sending: true, error: '' }));
    try {
      await api.sendFollowUp({ to: ai.mail.senderEmail, subject: ai.subject, body: ai.text });
      setAi(null);
      notify('ok', `Follow-up sent to ${ai.mail.senderEmail}.`);
      await loadMail();
    } catch (err) {
      setAi((prev) => ({ ...prev, sending: false, error: err.message || 'Could not send the follow-up.' }));
    }
  };

  const copyText = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopiedId(id);
      setTimeout(() => setCopiedId(''), 1600);
    } catch {
      notify('err', 'Clipboard is blocked in this browser.');
    }
  };

  const selected = useMemo(
    () => [...inbox, ...sent].find((mail) => mail.id === selectedId) || null,
    [inbox, sent, selectedId],
  );

  const stats = useMemo(() => {
    const needsReply = inbox.filter((mail) => mail.needsReply).length;
    const interviews = inbox.filter((mail) => mail.signal === 'INTERVIEW').length;
    const offers = inbox.filter((mail) => mail.signal === 'OFFER').length;
    const unread = inbox.filter((mail) => !mail.isRead).length;
    return { needsReply, interviews, offers, unread };
  }, [inbox]);

  const categoryRows = useMemo(() => {
    const counts = {};
    inbox.forEach((mail) => {
      const key = mail.aiCategory || 'Uncategorized';
      counts[key] = (counts[key] || 0) + 1;
    });
    const labelOf = (key) => (key === 'Uncategorized' ? 'Other' : key);
    return Object.entries(CATEGORY_COLORS).map(([key, color]) => ({
      key,
      label: labelOf(key),
      color,
      count: counts[key] || 0,
    }));
  }, [inbox]);

  const attention = useMemo(() => {
    const needsReply = inbox.filter((mail) => mail.needsReply);
    const pool = needsReply.length ? needsReply : inbox.filter((mail) => mail.isJobRelated && !mail.isRead);
    return [...pool]
      .sort((a, b) => b.priority - a.priority || byDate(a, b))
      .slice(0, 5);
  }, [inbox]);

  const filteredInbox = useMemo(() => {
    const list = inbox.filter((mail) => matchesFilter(mail, filter) && searchMatch(mail, query));
    return [...list].sort(sort === 'priority' ? (a, b) => b.priority - a.priority || byDate(a, b) : byDate);
  }, [inbox, filter, query, sort]);

  const filteredSent = useMemo(() => {
    return [...sent.filter((mail) => searchMatch(mail, query))].sort(byDate);
  }, [sent, query]);

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'there';
  const lastSyncLabel = lastSync ? `Last sync ${formatWhen(lastSync)}` : 'Not synced yet';

  const retryLoad = async () => {
    setLoading(true);
    await loadMail();
    setLoading(false);
  };

  return (
    <div className={`mm-page ${tab === 'inbox' || tab === 'sent' ? 'is-mail-list' : ''}`}>
      <header className="mm-head">
        <div>
          <h1>Email command center</h1>
          <p>
            Job threads, recruiter replies and follow-ups — sorted by what needs you next, {displayName}.
          </p>
        </div>
        <div className="mm-head-actions">
          <span className={`mm-sync-note ${connected ? '' : 'is-off'}`}>
            <span className="mm-dot" />
            {connected ? lastSyncLabel : 'Gmail not connected'}
          </span>
          <button type="button" className="mm-btn primary" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'spin' : ''} />
            {syncing ? 'Syncing…' : connected ? 'Sync inbox' : 'Connect Gmail'}
          </button>
        </div>
      </header>

      {flash && (
        <div className={`mm-flash ${flash.type === 'err' ? 'err' : 'ok'}`} role="status">
          {flash.type === 'err' ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          {flash.text}
        </div>
      )}

      <section
        className={`mm-account ${connected ? '' : 'is-off'} ${tab === 'inbox' || tab === 'sent' ? 'is-compact' : ''}`}
      >
        <div className="mm-account-icon">
          <Mail size={19} />
        </div>
        <div className="mm-account-info">
          <strong>Gmail account</strong>
          <small>
            {connected
              ? `${account.email || account.method || 'Connected'} · Hamzo reads job mail only`
              : 'Connect an inbox to read recruiter threads, draft replies and track application updates.'}
          </small>
        </div>
        {connected ? (
          <>
            <div className="mm-account-actions">
              <span className="mm-status-pill">
                <CheckCircle2 size={13} /> Connected
              </span>
              <button
                type="button"
                className="mm-btn"
                onClick={handleConnect}
                disabled={connecting || disconnecting}
                title="Pick a different Google account"
              >
                {connecting ? 'Opening Google…' : 'Switch account'}
              </button>
              <button
                type="button"
                className="mm-btn danger"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </>
        ) : (
          <div className="mm-account-actions">
            <span className="mm-status-pill off">Not connected</span>
            <button
              type="button"
              className="mm-btn primary"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? 'Opening Google…' : 'Connect Gmail'}
            </button>
          </div>
        )}
      </section>

      {!connected ? (
        <ConnectPanel loading={loading} onConnect={handleConnect} />
      ) : (
        <>
          {mailError && (
            <div className="mm-flash err" role="alert">
              <AlertTriangle size={15} />
              <span style={{ flex: 1 }}>{mailError}</span>
              <button type="button" className="mm-btn" onClick={retryLoad} disabled={loading}>
                {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Retry
              </button>
            </div>
          )}

          {/* The same daily header on every Mail tab. */}
          <section className="mm-hero" aria-label="Mail summary">
            <div className="mm-hero-main">
              <span className="mm-hero-eyebrow">Today</span>
              <div className="mm-hero-figure">
                <strong>{stats.needsReply}</strong>
                <span>{stats.needsReply === 1 ? 'email needs your reply' : 'emails need your reply'}</span>
              </div>
              <p className="mm-hero-sub">
                {stats.needsReply > 0
                  ? 'Recruiter replies, interview invites and offer mails are waiting in your inbox.'
                  : 'Nothing is waiting on you right now. New recruiter mail lands here after a sync.'}
              </p>
              <div className="mm-hero-actions">
                <button type="button" className="mm-btn primary" onClick={() => setTab('inbox')}>
                  Open inbox <ChevronRight size={13} />
                </button>
                <button type="button" className="mm-btn" onClick={handleSync} disabled={syncing}>
                  <RefreshCw size={13} className={syncing ? 'spin' : ''} />
                  {syncing ? 'Syncing…' : 'Sync inbox'}
                </button>
              </div>
            </div>

              <div className="mm-hero-kpis">
                <div className="mm-kpi is-indigo">
                  <span>Inbox</span>
                  <strong>{inbox.length}</strong>
                  <small>{stats.unread} unread</small>
                </div>
                <div className="mm-kpi is-green">
                  <span>Interviews</span>
                  <strong>{stats.interviews}</strong>
                  <small>Invites &amp; scheduling</small>
                </div>
                <div className="mm-kpi is-amber">
                  <span>Offers</span>
                  <strong>{stats.offers}</strong>
                  <small>Offer letters</small>
                </div>
              <div className="mm-kpi is-slate">
                <span>Sent</span>
                <strong>{sent.length}</strong>
                <small>Outreach &amp; replies</small>
              </div>
            </div>
          </section>

          <div className="mm-tabs" role="tablist" aria-label="Mail views">
            {[
              { key: 'overview', label: 'Overview', icon: Sparkles },
              { key: 'inbox', label: 'Inbox', icon: Inbox, count: inbox.length },
              { key: 'sent', label: 'Sent', icon: Send, count: sent.length },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  className={`mm-tab ${tab === item.key ? 'active' : ''}`}
                  onClick={() => setTab(item.key)}
                >
                  <Icon size={14} />
                  {item.label}
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span className="mm-tab-count">{item.count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {tab === 'overview' && (
            <div className="mm-overview">
              <div className="mm-stack">
                <section className="mm-card">
                  <header className="mm-card-head">
                    <div className="mm-card-title">
                      <CornerUpLeft size={15} /> Needs your attention
                    </div>
                    <button type="button" className="mm-link" onClick={() => setTab('inbox')}>
                      Open inbox <ChevronRight size={12} />
                    </button>
                  </header>
                  {loading ? (
                    <SkeletonRows />
                  ) : attention.length === 0 ? (
                    <EmptyBlock
                      icon={CheckCircle2}
                      title="Nothing is waiting on you"
                      description="No recruiter or interview email needs a reply right now."
                    />
                  ) : (
                    <div className="mm-attn">
                      {attention.map((mail) => (
                        <div
                          key={mail.id}
                          className="mm-attn-row"
                          role="button"
                          tabIndex={0}
                          onClick={() => openMail(mail)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') openMail(mail);
                          }}
                        >
                          <Avatar mail={mail} />
                          <div className="mm-attn-body">
                            <div className="mm-attn-top">
                              <span className="mm-attn-from">{senderLabel(mail)}</span>
                              <SignalChip signal={mail.signal} />
                              {!mail.isRead && <span className="mm-signal tone-indigo">New</span>}
                            </div>
                            <div className="mm-attn-subject">{mail.subject || '(No subject)'}</div>
                            <div className="mm-attn-meta">
                              {mail.company && <span>{mail.company}</span>}
                              <span>{daysSince(mail.receivedAt) === 0 ? 'Today' : `${daysSince(mail.receivedAt)}d waiting`}</span>
                            </div>
                          </div>
                          <div className="mm-attn-right">
                            <span className="mm-attn-time">{formatWhen(mail.receivedAt)}</span>
                            <ChevronRight size={15} color="#b6b8b0" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="mm-card mm-card-grow">
                  <header className="mm-card-head">
                    <div className="mm-card-title">
                      <Mail size={15} /> Recent received
                    </div>
                    <button type="button" className="mm-link" onClick={() => setTab('inbox')}>
                      View all <ChevronRight size={12} />
                    </button>
                  </header>
                  {loading ? (
                    <SkeletonRows />
                  ) : inbox.length === 0 ? (
                    <EmptyBlock
                      icon={Inbox}
                      title="No mail yet"
                      description="Run a sync to pull your latest inbox messages."
                      action={<button type="button" className="mm-btn primary" onClick={handleSync}>Sync now</button>}
                    />
                  ) : (
                    <div className="mm-card-body-grow is-list">
                      {[...inbox].sort(byDate).slice(0, 5).map((mail) => (
                        <MailRow
                          key={mail.id}
                          mail={mail}
                          selected={mail.id === selectedId}
                          onOpen={() => openMail(mail)}
                          onStar={(event) => handleStar(event, mail)}
                          onArchive={(event) => handleArchive(event, mail)}
                          onTrash={(event) => handleTrash(event, mail)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="mm-stack">
                <section className="mm-card">
                  <header className="mm-card-head">
                    <div className="mm-card-title">
                      <Briefcase size={15} /> Application signals
                    </div>
                    <span className="mm-muted" style={{ fontSize: 10.5, fontWeight: 700 }}>
                      Auto-tagged
                    </span>
                  </header>
                  <div className="mm-card-body">
                    <div className="mm-signal-grid">
                      {PIPELINE_SIGNALS.map((signal) => {
                        const meta = SIGNAL_META[signal];
                        const count = inbox.filter((mail) => mail.signal === signal).length;
                        return (
                          <button
                            key={signal}
                            type="button"
                            className={`mm-signal-tile ${count > 0 ? 'has-mail' : ''}`}
                            style={{ '--mm-signal': signalColor(signal) }}
                            onClick={() => {
                              setFilter(signal.toLowerCase());
                              setTab('inbox');
                            }}
                          >
                            <span className="mm-signal-tile-top">
                              <span className="mm-signal-tile-dot" />
                              <strong>{count}</strong>
                            </span>
                            <span className="mm-signal-tile-label">{meta.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="mm-card">
                  <header className="mm-card-head">
                    <div className="mm-card-title">
                      <Send size={15} /> Recent sent
                    </div>
                    <button type="button" className="mm-link" onClick={() => setTab('sent')}>
                      View all <ChevronRight size={12} />
                    </button>
                  </header>
                  {loading ? (
                    <SkeletonRows rows={2} />
                  ) : sent.length === 0 ? (
                    <EmptyBlock
                      icon={Send}
                      title="No sent mail yet"
                      description="Replies and follow-ups you send from Hamzo appear here."
                    />
                  ) : (
                    <div>
                      {[...sent].sort(byDate).slice(0, 6).map((mail) => (
                        <div key={mail.id} className="mm-attn-row" onClick={() => openMail(mail)}>
                          <Avatar mail={mail} />
                          <div className="mm-attn-body">
                            <div className="mm-attn-top">
                              <span className="mm-attn-from">{senderLabel(mail)}</span>
                            </div>
                            <div className="mm-attn-subject">{mail.subject || '(No subject)'}</div>
                          </div>
                          <span className="mm-attn-time">{formatWhen(mail.receivedAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="mm-card mm-card-grow">
                  <header className="mm-card-head">
                    <div className="mm-card-title">
                      <Inbox size={15} /> Inbox mix
                    </div>
                    <span className="mm-muted" style={{ fontSize: 10.5, fontWeight: 700 }}>
                      {inbox.length} threads
                    </span>
                  </header>
                  <div className="mm-card-body mm-card-body-grow">
                    {categoryRows.every((row) => !row.count) && (
                      <p className="mm-empty-note">No categorized mail yet — sync your inbox to see the mix.</p>
                    )}
                    <div className="mm-bars">
                      {categoryRows.map((row) => {
                        const total = Math.max(1, inbox.length);
                        const pct = Math.round((row.count / total) * 100);
                        return (
                          <div className="mm-bar-row" key={row.key}>
                            <div className="mm-bar-top">
                              <span>{row.label}</span>
                              <span>{row.count}</span>
                            </div>
                            <div className="mm-bar-track">
                              <div
                                className="mm-bar-fill"
                                style={{ width: `${pct}%`, background: row.color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {tab === 'inbox' && (
            <>
              <MailToolbar
                query={query}
                setQuery={setQuery}
                filter={filter}
                setFilter={setFilter}
                sort={sort}
                setSort={setSort}
                inbox={inbox}
                searchRef={searchRef}
              />
              <div className="mm-split" ref={splitRef}>
                <div className="mm-list">
                  {loading ? (
                    <SkeletonRows />
                  ) : filteredInbox.length === 0 ? (
                    <EmptyBlock
                      icon={Search}
                      title={query ? 'No matches' : 'Nothing in this view'}
                      description={
                        query
                          ? `No email matches “${query}”. Try a different word or clear the filter.`
                          : 'Try another filter, or sync to pull new messages.'
                      }
                    />
                  ) : (
                    filteredInbox.map((mail) => (
                      <MailRow
                        key={mail.id}
                        mail={mail}
                        selected={mail.id === selectedId}
                        onOpen={() => openMail(mail)}
                        onStar={(event) => handleStar(event, mail)}
                        onArchive={(event) => handleArchive(event, mail)}
                        onTrash={(event) => handleTrash(event, mail)}
                      />
                    ))
                  )}
                </div>

                <div className={`mm-detail-col ${detailOpen ? 'is-open' : ''}`}>
                  <ReadingPane
                    mail={selected}
                    summary={selected ? summaries[selected.id] : null}
                    composer={composer && composer.mail?.id === selected?.id ? composer : null}
                    onSummarize={() => summarize(selected)}
                    onReply={() => startReply(selected)}
                    onFollowUp={() => startFollowUp(selected)}
                    onStar={(event) => handleStar(event, selected)}
                    onArchive={(event) => handleArchive(event, selected)}
                    onTrash={(event) => handleTrash(event, selected)}
                    onClose={() => setDetailOpen(false)}
                    onChangeComposer={(patch) => setComposer((prev) => ({ ...prev, ...patch }))}
                    onSendReply={sendReply}
                    onCancelComposer={() => setComposer(null)}
                    onCopy={copyText}
                    copied={copiedId === selected?.id}
                    bodyState={selected ? bodyState[selected.id] : null}
                    onLoadBody={() => ensureBody(selected)}
                  />
                </div>
              </div>
            </>
          )}

          {tab === 'sent' && (
            <>
              <MailToolbar
                query={query}
                setQuery={setQuery}
                filter="all"
                setFilter={() => {}}
                sort="newest"
                setSort={setSort}
                inbox={[]}
                searchRef={searchRef}
                simple
              />
              <div className="mm-split" ref={splitRef}>
                <div className="mm-list">
                  {loading ? (
                    <SkeletonRows />
                  ) : filteredSent.length === 0 ? (
                    <EmptyBlock
                      icon={Send}
                      title={query ? 'No matches' : 'No sent mail yet'}
                      description={
                        query
                          ? `No sent email matches “${query}”.`
                          : 'Replies and follow-ups you send from Hamzo appear here.'
                      }
                    />
                  ) : (
                    filteredSent.map((mail) => (
                      <MailRow
                        key={mail.id}
                        mail={mail}
                        selected={mail.id === selectedId}
                        onOpen={() => openMail(mail)}
                        onStar={(event) => handleStar(event, mail)}
                        onArchive={(event) => handleArchive(event, mail)}
                        onTrash={(event) => handleTrash(event, mail)}
                      />
                    ))
                  )}
                </div>

                <div className={`mm-detail-col ${detailOpen ? 'is-open' : ''}`}>
                  <ReadingPane
                    mail={selected}
                    summary={selected ? summaries[selected.id] : null}
                    composer={composer && composer.mail?.id === selected?.id ? composer : null}
                    onSummarize={() => summarize(selected)}
                    onReply={() => startReply(selected)}
                    onFollowUp={() => startFollowUp(selected)}
                    onStar={(event) => handleStar(event, selected)}
                    onArchive={(event) => handleArchive(event, selected)}
                    onTrash={(event) => handleTrash(event, selected)}
                    onClose={() => setDetailOpen(false)}
                    onChangeComposer={(patch) => setComposer((prev) => ({ ...prev, ...patch }))}
                    onSendReply={sendReply}
                    onCancelComposer={() => setComposer(null)}
                    onCopy={copyText}
                    copied={copiedId === selected?.id}
                    bodyState={selected ? bodyState[selected.id] : null}
                    onLoadBody={() => ensureBody(selected)}
                  />
                </div>
              </div>
            </>
          )}

        </>
      )}

      {/*
        The reading pane is rendered inside the Inbox/Sent tabs. On a narrow
        screen it becomes a fixed sheet, so we also render it here when a mail
        was opened from Overview/Job updates and the user is not on those tabs.
      */}
      {tab === 'overview' && detailOpen && selected && (
        <div className="mm-overlay mm-sheet-overlay" onClick={() => setDetailOpen(false)}>
          <div className="mm-sheet" onClick={(event) => event.stopPropagation()}>
            <ReadingPane
              mail={selected}
              summary={summaries[selected.id]}
              composer={composer && composer.mail?.id === selected.id ? composer : null}
              onSummarize={() => summarize(selected)}
              onReply={() => startReply(selected)}
              onFollowUp={() => startFollowUp(selected)}
              onStar={(event) => handleStar(event, selected)}
              onArchive={(event) => handleArchive(event, selected)}
              onTrash={(event) => handleTrash(event, selected)}
              onClose={() => setDetailOpen(false)}
              onChangeComposer={(patch) => setComposer((prev) => ({ ...prev, ...patch }))}
              onSendReply={sendReply}
              onCancelComposer={() => setComposer(null)}
              onCopy={copyText}
              copied={copiedId === selected.id}
              bodyState={bodyState[selected.id]}
              onLoadBody={() => ensureBody(selected)}
            />
          </div>
        </div>
      )}

      {ai && (
        <div className="mm-overlay" onClick={() => setAi(null)}>
          <div className="mm-drawer" onClick={(event) => event.stopPropagation()}>
            <header className="mm-drawer-head">
              <div className="mm-drawer-title">
                <Sparkles size={15} /> Follow-up draft
              </div>
              <button type="button" className="mm-btn icon" onClick={() => setAi(null)} aria-label="Close">
                <X size={16} />
              </button>
            </header>
            <div className="mm-drawer-body">
              <div className="mm-field">
                <label>To</label>
                <input className="mm-input" value={ai.mail.senderEmail || ''} readOnly />
              </div>
              <div className="mm-field">
                <label>Subject</label>
                <input
                  className="mm-input"
                  value={ai.subject}
                  onChange={(event) => setAi((prev) => ({ ...prev, subject: event.target.value }))}
                />
              </div>
              <div className="mm-field">
                <label>Message</label>
                {ai.loading ? (
                  <div className="mm-hint">
                    <Loader2 size={13} className="spin" /> Gemini is drafting…
                  </div>
                ) : (
                  <textarea
                    className="mm-textarea"
                    value={ai.text}
                    onChange={(event) => setAi((prev) => ({ ...prev, text: event.target.value }))}
                  />
                )}
              </div>
              {ai.error && <p className="mm-error">{ai.error}</p>}
              {ai.note && (
                <p className="mm-note">
                  <AlertTriangle size={12} /> {ai.note}
                </p>
              )}
            </div>
            <footer className="mm-drawer-foot">
              <button
                type="button"
                className="mm-btn"
                onClick={() => copyText(`ai-${ai.mail.id}`, ai.text)}
                disabled={!ai.text}
              >
                {copiedId === `ai-${ai.mail.id}` ? <Check size={14} /> : <Copy size={14} />} Copy
              </button>
              <button type="button" className="mm-btn" onClick={() => setAi(null)}>
                Cancel
              </button>
              <button type="button" className="mm-btn primary" onClick={sendFollowUp} disabled={ai.sending || !ai.text}>
                {ai.sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                {ai.sending ? 'Sending…' : 'Send follow-up'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Presentational components                                          */
/* ------------------------------------------------------------------ */

function SignalChip({ signal }) {
  const meta = SIGNAL_META[signal] || SIGNAL_META.OTHER;
  return <span className={`mm-signal ${SIGNAL_TONE[signal] || SIGNAL_TONE.OTHER}`}>{meta.label}</span>;
}

function signalColor(signal) {
  switch (signal) {
    case 'OFFER':
      return '#1f7a45';
    case 'INTERVIEW':
      return '#3b4fd8';
    case 'ASSESSMENT':
      return '#b45309';
    case 'SHORTLISTED':
      return '#1d63c9';
    case 'RECRUITER':
      return '#1d63c9';
    case 'REJECTED':
      return '#b42318';
    default:
      return '#8a8c86';
  }
}

function Avatar({ mail }) {
  const tone = SIGNAL_TONE[mail.signal] || SIGNAL_TONE.OTHER;
  return <span className={`mm-avatar ${tone}`}>{initials(senderLabel(mail), mail.senderEmail)}</span>;
}

function SkeletonRows({ rows = 5 }) {
  return (
    <div className="mm-skeleton">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="mm-skeleton-row" key={index} />
      ))}
    </div>
  );
}

function EmptyBlock({ icon: Icon, title, description, action }) {
  return (
    <div className="mm-empty">
      <span className="mm-empty-icon">
        <Icon size={20} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function ConnectPanel({ loading, onConnect }) {
  return (
    <section className="mm-card">
      <div style={{ padding: '26px 24px', maxWidth: 620 }}>
        <div className="mm-eyebrow">
          <ShieldCheck size={12} /> Consent first
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 19, fontWeight: 800, letterSpacing: '-.02em' }}>
          Turn your inbox into a job pipeline
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
          Hamzo reads recruiter threads, interviews, assessments and offers, then links them to your
          applications. You keep full control: every reply is editable before it is sent, and you can
          disconnect in one click.
        </p>
        <div className="mm-bars" style={{ marginBottom: 18 }}>
          {[
            'Sort job mail from newsletters automatically',
            'Draft replies and follow-ups you can edit',
            'Detect interview, assessment and offer signals',
          ].map((item) => (
            <div className="mm-row-line" key={item} style={{ fontSize: 12, color: '#3d403a' }}>
              <CheckCircle2 size={14} color="#1f7a45" /> {item}
            </div>
          ))}
        </div>
        <div className="mm-row-line" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="mm-btn primary" onClick={onConnect} disabled={loading}>
            <Mail size={14} /> Connect Gmail
          </button>
          <span className="mm-hint">
            <ShieldCheck size={12} /> Standard Google OAuth. We never store your password.
          </span>
        </div>
      </div>
    </section>
  );
}

function MailToolbar({ query, setQuery, filter, setFilter, sort, setSort, inbox, searchRef, simple = false }) {
  return (
    <div className="mm-toolbar">
      <div className="mm-search">
        <Search size={14} color="#8d9088" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={simple ? 'Search sent mail…' : 'Search sender, company, subject or content…'}
          aria-label="Search mail"
        />
        <span className="mm-kbd">/</span>
        {query && (
          <button type="button" className="mm-btn icon" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </div>

      {!simple && (
        <div className="mm-chips">
          {FILTERS.map((item) => {
            const count = item.key === 'all' ? inbox.length : inbox.filter((mail) => matchesFilter(mail, item.key)).length;
            return (
              <button
                key={item.key}
                type="button"
                className={`mm-chip ${filter === item.key ? 'active' : ''}`}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
                {count > 0 && <span className="mm-chip-count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {!simple && (
        <div className="mm-sort">
          <ArrowDownUp size={12} />
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort mail">
            <option value="priority">Priority</option>
            <option value="newest">Newest</option>
          </select>
        </div>
      )}
    </div>
  );
}

function MailRow({ mail, selected, onOpen, onStar, onArchive, onTrash }) {
  return (
    <article
      className={`mm-row ${!mail.isRead ? 'is-unread' : ''} ${selected ? 'is-selected' : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
    >
      <Avatar mail={mail} />
      <div className="mm-row-main">
        <div className="mm-row-top">
          <span className="mm-row-from">{senderLabel(mail)}</span>
          {mail.isStarred && <Star size={12} className="mm-row-star" fill="currentColor" />}
          {mail.mailbox === 'SENT' ? (
            <span className="mm-signal tone-neutral">
              <Send size={9} /> Sent
            </span>
          ) : (
            <SignalChip signal={mail.signal} />
          )}
        </div>
        <div className="mm-row-subject">{mail.subject || '(No subject)'}</div>
        <div className="mm-row-snippet">{mail.snippet || mail.bodyText || 'No preview available.'}</div>
        <div className="mm-row-tags">
          {mail.company && mail.isJobRelated && (
            <span className="mm-mini-tag">
              <Briefcase size={9} /> {mail.company}
            </span>
          )}
          {mail.needsReply && (
            <span className="mm-mini-tag">
              <CornerUpLeft size={9} /> Needs reply
            </span>
          )}
          {mail.hasAttachments && (
            <span className="mm-mini-tag">
              <Paperclip size={9} /> Attachment
            </span>
          )}
          <span className="mm-mini-tag">
            <Clock size={9} /> {formatWhen(mail.receivedAt)}
          </span>
        </div>
      </div>
      <div className="mm-row-side">
        <span className="mm-row-time">{formatWhen(mail.receivedAt)}</span>
        <div className="mm-row-actions">
          <button
            type="button"
            className="mm-btn icon"
            onClick={(event) => onStar(event)}
            aria-label={mail.isStarred ? 'Unstar' : 'Star'}
            title={mail.isStarred ? 'Unstar' : 'Star'}
          >
            <Star size={14} fill={mail.isStarred ? 'currentColor' : 'none'} color={mail.isStarred ? '#e0a800' : undefined} />
          </button>
          <button
            type="button"
            className="mm-btn icon"
            onClick={(event) => onArchive(event)}
            aria-label="Archive"
            title="Archive"
          >
            <Archive size={14} />
          </button>
          <button
            type="button"
            className="mm-btn icon"
            onClick={(event) => onTrash(event)}
            aria-label="Move to trash"
            title="Move to trash"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function ReadingPane({
  mail,
  summary,
  composer,
  onSummarize,
  onReply,
  onFollowUp,
  onStar,
  onArchive,
  onTrash,
  onClose,
  onChangeComposer,
  onSendReply,
  onCancelComposer,
  onCopy,
  copied,
  bodyState,
  onLoadBody,
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [mail?.id]);

  if (!mail) {
    return (
      <div className="mm-detail">
        <EmptyBlock
          icon={Mail}
          title="Select an email"
          description="Open a message to read it, get an AI summary, or draft a reply."
        />
      </div>
    );
  }

  const sender = senderLabel(mail);
  const body = mail.bodyText || mail.snippet || '';
  const isLong = body.length > 1400;

  return (
    <div className="mm-detail">
      <header className="mm-detail-head">
        <div className="mm-detail-head-main">
          <div className="mm-row-line" style={{ flexWrap: 'wrap' }}>
            {mail.mailbox === 'SENT' ? (
              <span className="mm-signal tone-neutral">
                <Send size={9} /> Sent
              </span>
            ) : (
              <SignalChip signal={mail.signal} />
            )}
            {mail.needsReply && <span className="mm-mini-tag">Needs reply</span>}
            {mail.company && mail.isJobRelated && (
              <span className="mm-mini-tag">
                <Briefcase size={9} /> {mail.company}
              </span>
            )}
          </div>
          <h2 className="mm-detail-subject">{mail.subject || '(No subject)'}</h2>
        </div>
        <button type="button" className="mm-btn icon" onClick={onClose} aria-label="Close email">
          <X size={16} />
        </button>
      </header>

      <div className="mm-detail-meta">
        <Avatar mail={mail} />
        <div className="mm-detail-sender">
          <strong>{sender}</strong>
          <small>
            {mail.senderEmail || 'No address'}
            {' · '}
            {formatWhen(mail.receivedAt)}
          </small>
        </div>
        <button
          type="button"
          className="mm-btn icon"
          onClick={() => onCopy(mail.id, body)}
          aria-label="Copy email body"
          title="Copy email body"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>

      <div className="mm-detail-actions">
        <button type="button" className="mm-btn primary" onClick={onReply}>
          <PenLine size={13} /> AI reply
        </button>
        <button type="button" className="mm-btn" onClick={onSummarize}>
          <Sparkles size={13} /> Summarize
        </button>
        <button type="button" className="mm-btn" onClick={onFollowUp}>
          <CornerUpLeft size={13} /> Follow-up
        </button>
        <button type="button" className="mm-btn icon" onClick={onStar} aria-label="Star" title="Star">
          <Star size={15} fill={mail.isStarred ? 'currentColor' : 'none'} color={mail.isStarred ? '#e0a800' : undefined} />
        </button>
        <button type="button" className="mm-btn icon" onClick={onArchive} aria-label="Archive" title="Archive">
          <Archive size={15} />
        </button>
        <button type="button" className="mm-btn icon" onClick={onTrash} aria-label="Trash" title="Trash">
          <Trash2 size={15} />
        </button>
      </div>

      {summary && (
        <div className="mm-summary">
          <div className="mm-summary-head">
            <Sparkles size={12} /> {summary.note ? 'Email text' : 'AI summary'}
          </div>
          {summary.loading ? (
            <p className="mm-hint">
              <Loader2 size={12} className="spin" /> Reading the thread…
            </p>
          ) : summary.error ? (
            <p className="mm-summary-error">{summary.error}</p>
          ) : (
            <p>{summary.text}</p>
          )}
          {summary.note && !summary.loading && <p className="mm-note">{summary.note}</p>}
        </div>
      )}

      {mail.hasAttachments && (
        <span className="mm-attachment">
          <Paperclip size={13} /> This email has an attachment. Open it in Gmail to download.
        </span>
      )}

      <div className={`mm-detail-body ${isLong && !expanded ? 'is-clamped' : ''}`}>
        {body || (bodyState === 'loading' ? '' : 'This message has no readable text body.')}
      </div>
      {!body && bodyState === 'loading' && (
        <div className="mm-clamp-toggle mm-hint">
          <Loader2 size={12} className="spin" /> Loading the full message…
        </div>
      )}
      {!body && bodyState === 'error' && (
        <div className="mm-clamp-toggle">
          <button type="button" className="mm-link" onClick={onLoadBody}>
            Could not load the body — retry
          </button>
        </div>
      )}
      {isLong && (
        <div className="mm-clamp-toggle">
          <button type="button" className="mm-link" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show less' : 'Show full email'} <ChevronRight size={12} style={{ transform: expanded ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
          </button>
        </div>
      )}

      {composer && (
        <div className="mm-composer">
          <div className="mm-composer-head">
            <div className="mm-composer-title">
              <PenLine size={13} /> Reply to {composer.mail.senderEmail || sender}
            </div>
            <button type="button" className="mm-btn icon" onClick={onCancelComposer} aria-label="Cancel reply">
              <X size={15} />
            </button>
          </div>

          <div className="mm-field">
            <label>Subject</label>
            <input
              className="mm-input"
              value={composer.subject}
              onChange={(event) => onChangeComposer({ subject: event.target.value })}
            />
          </div>
          <div className="mm-field">
            <label>Message</label>
            {composer.loading ? (
              <div className="mm-hint">
                <Loader2 size={13} className="spin" /> Gemini is drafting a reply…
              </div>
            ) : (
              <textarea
                className="mm-textarea"
                value={composer.text}
                onChange={(event) => onChangeComposer({ text: event.target.value })}
                placeholder="Write your reply…"
              />
            )}
          </div>
          {composer.error && <p className="mm-error">{composer.error}</p>}
          {composer.note && (
            <p className="mm-note">
              <AlertTriangle size={12} /> {composer.note}
            </p>
          )}

          <div className="mm-composer-foot">
            <span className="mm-hint">
              <ShieldCheck size={12} /> Sends from your connected Gmail. Edit before sending.
            </span>
            <div className="mm-row-line">
              <button type="button" className="mm-btn" onClick={onCancelComposer}>
                Discard
              </button>
              <button
                type="button"
                className="mm-btn primary"
                onClick={onSendReply}
                disabled={composer.sending || composer.loading || !composer.text.trim()}
              >
                {composer.sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                {composer.sending ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
