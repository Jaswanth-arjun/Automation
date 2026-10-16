import React, { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  Inbox,
  Clock,
  CheckCircle,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Sparkles,
  X,
  FileText,
  User,
  ArrowUpRight,
  ChevronRight
} from 'lucide-react';
import ConnectedAccount from '../components/ConnectedAccount';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

const CATEGORY_COLORS = {
  'Job/Recruitment': 'bg-cyan-500/10 text-cyan-700 border-cyan-300',
  'Work/Professional': 'bg-blue-500/10 text-blue-700 border-blue-300',
  Newsletters: 'bg-purple-500/10 text-purple-700 border-purple-300',
  Notifications: 'bg-orange-500/10 text-orange-700 border-orange-300',
  Personal: 'bg-pink-500/10 text-pink-700 border-pink-300',
  Finance: 'bg-yellow-500/10 text-yellow-700 border-yellow-300',
  Uncategorized: 'bg-gray-500/10 text-gray-700 border-gray-300'
};

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MailAutomation() {
  const { user } = useAuth();

  // Connection state — only true after an explicit Gmail Connect (not Google sign-in)
  const [gmailConnected, setGmailConnected] = useState(false);

  const [gmailEmail, setGmailEmail] = useState('');

  // Modal for connect email input
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [inputEmail, setInputEmail] = useState(user?.email || '');

  // Subtab navigation: ONLY 'dashboard' | 'received' | 'sent'
  const [activeTab, setActiveTab] = useState('dashboard');

  // Real Inbox & Sent Threads Data
  const [receivedThreads, setReceivedThreads] = useState([]);
  const [sentThreads, setSentThreads] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [flashMsg, setFlashMsg] = useState('');

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedThread, setSelectedThread] = useState(null);
  const [selectedSentEmail, setSelectedSentEmail] = useState(null);
  const [aiPanel, setAiPanel] = useState(null);

  // Fetch data
  const loadRealData = async () => {
    if (!gmailConnected) return;
    setLoading(true);
    try {
      const [dashRes, inboxRes, sentRes] = await Promise.all([
        api.getDashboard().catch(() => null),
        api.getEmails(0, 50, '', 'INBOX').catch(() => null),
        api.getEmails(0, 50, '', 'SENT').catch(() => null)
      ]);

      if (dashRes) setDashboardData(dashRes);
      if (inboxRes && inboxRes.emails) setReceivedThreads(inboxRes.emails);
      if (sentRes && sentRes.emails) setSentThreads(sentRes.emails);
    } catch (err) {
      console.error('Error loading mail data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check URL search params for Google OAuth callback return
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      const email = params.get('email') || user?.email || '';
      localStorage.setItem('mailmind_gmail_connected', 'true');
      localStorage.setItem('mailmind_gmail_email', email);
      setGmailConnected(true);
      setGmailEmail(email);
      setFlashMsg(`✅ Gmail connected with full access: ${email}`);
      setTimeout(() => setFlashMsg(''), 5000);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    api.getGmailConfig()
      .then(res => {
        if (res && res.configured) {
          setGmailConnected(true);
          const email = res.email || '';
          setGmailEmail(email);
          localStorage.setItem('mailmind_gmail_connected', 'true');
          localStorage.setItem('mailmind_gmail_email', email);
        } else {
          setGmailConnected(false);
          setGmailEmail('');
          localStorage.removeItem('mailmind_gmail_connected');
          localStorage.removeItem('mailmind_gmail_email');
        }
      })
      .catch(() => {
        setGmailConnected(false);
      });
  }, [user]);

  useEffect(() => {
    if (gmailConnected) {
      loadRealData();
    }
  }, [gmailConnected]);

  // Connect Gmail Handler (Redirects to Google OAuth 2.0 Consent Screen)
  const handleInitiateConnect = async () => {
    try {
      const res = await fetch('/api/gmail/auth-url').then(r => r.json());
      if (res && res.authUrl) {
        window.location.href = res.authUrl;
        return;
      }
    } catch {}
    setError('Could not start Gmail sign-in. Please make sure the backend is running and OAuth is configured in the server environment.');
  };

  // Confirm Connect Email
  const handleConfirmConnect = (e) => {
    e.preventDefault();
    if (!inputEmail.trim()) return;

    const emailToConnect = inputEmail.trim();
    localStorage.setItem('mailmind_gmail_connected', 'true');
    localStorage.setItem('mailmind_gmail_email', emailToConnect);
    setGmailConnected(true);
    setGmailEmail(emailToConnect);
    setShowConnectModal(false);
    setFlashMsg(`Gmail connected: ${emailToConnect}`);
    setTimeout(() => setFlashMsg(''), 4000);
  };

  // Disconnect Gmail Handler
  const handleDisconnectGmail = () => {
    fetch('/api/gmail/disconnect', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('mailmind_gmail_connected');
    localStorage.removeItem('mailmind_gmail_email');
    setGmailConnected(false);
    setGmailEmail('');
    setReceivedThreads([]);
    setSentThreads([]);
    setDashboardData(null);
    setFlashMsg('Gmail account disconnected.');
    setTimeout(() => setFlashMsg(''), 3000);
  };

  // Sync Inbox Handler
  const handleSyncInbox = async () => {
    if (!gmailConnected) {
      handleInitiateConnect();
      return;
    }
    setSyncing(true);
    try {
      await api.triggerSync();
      setFlashMsg('Sync initiated with Gmail API!');
      await loadRealData();
    } catch (err) {
      setFlashMsg(err.message || 'Could not sync Gmail.');
    } finally {
      setTimeout(() => {
        setSyncing(false);
        setTimeout(() => setFlashMsg(''), 3000);
      }, 1200);
    }
  };

  const mailContext = (mail) => ({
    subject: mail.subject,
    from: mail.senders?.[0]?.name || mail.senderName || '',
    to: mail.senders?.[0]?.name || '',
    email: mail.senders?.[0]?.email || mail.senderEmail || '',
    body: mail.bodyText || mail.snippet || '',
  });

  const openAiPanel = async (event, mail, mode) => {
    event.stopPropagation();
    setAiPanel({ mode, mail, text: '', subject: mail.subject || '', loading: true, error: '' });
    try {
      const payload = mailContext(mail);
      const res = mode === 'summary'
        ? await api.summarizeMail(payload)
        : mode === 'reply'
          ? await api.generateMailReply(payload)
          : await api.generateFollowUp(payload);
      setAiPanel({
        mode,
        mail,
        text: res.text || '',
        subject: res.subject || (mode === 'followup' ? `Following up: ${mail.subject || ''}` : mail.subject || ''),
        loading: false,
        error: '',
      });
    } catch (err) {
      setAiPanel({ mode, mail, text: '', subject: '', loading: false, error: err.message || 'Gemini could not complete that request.' });
    }
  };

  const handleSendFollowUp = async () => {
    if (!aiPanel?.mail || !aiPanel.text.trim()) return;
    setAiPanel((prev) => ({ ...prev, sending: true, error: '' }));
    try {
      await api.sendFollowUp({
        to: aiPanel.mail.senders?.[0]?.email || aiPanel.mail.senderEmail,
        subject: aiPanel.subject,
        body: aiPanel.text,
      });
      setAiPanel(null);
      setFlashMsg('Follow-up email sent.');
      setTimeout(() => setFlashMsg(''), 3000);
      await loadRealData();
    } catch (err) {
      setAiPanel((prev) => ({ ...prev, sending: false, error: err.message || 'Could not send the follow-up.' }));
    }
  };

  // Toggle Star
  const handleToggleStar = (e, threadId) => {
    e.stopPropagation();
    setReceivedThreads(prev =>
      prev.map(t => (t.id === threadId ? { ...t, isStarred: !t.isStarred } : t))
    );
    api.toggleStar(threadId, true).catch(() => {});
  };

  // Move to Trash
  const handleTrashThread = (e, threadId) => {
    e.stopPropagation();
    setReceivedThreads(prev => prev.filter(t => t.id !== threadId));
    if (selectedThread?.id === threadId) setSelectedThread(null);
    setFlashMsg('Thread moved to trash');
    setTimeout(() => setFlashMsg(''), 2500);
    api.trashEmail(threadId).catch(() => {});
  };

  // Filter received threads
  const filteredReceived = receivedThreads.filter(t => {
    const matchesSearch =
      !searchQuery ||
      t.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.senders?.some(s => s.name?.toLowerCase().includes(searchQuery.toLowerCase()) || s.email?.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (selectedCategory === 'All') return true;
    if (selectedCategory === 'Starred') return t.isStarred;
    if (selectedCategory === 'Unread') return !t.isRead;
    return t.aiCategory === selectedCategory;
  });

  // Filter sent threads
  const filteredSent = sentThreads.filter(t => {
    return (
      !searchQuery ||
      t.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.senders?.some(s => s.name?.toLowerCase().includes(searchQuery.toLowerCase()) || s.email?.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

  // Category counts for received mails
  const categoryCounts = {
    'Job/Recruitment': receivedThreads.filter(t => t.aiCategory === 'Job/Recruitment').length,
    'Work/Professional': receivedThreads.filter(t => t.aiCategory === 'Work/Professional').length,
    Newsletters: receivedThreads.filter(t => t.aiCategory === 'Newsletters').length,
    Notifications: receivedThreads.filter(t => t.aiCategory === 'Notifications').length
  };

  return (
    <div className="page-mail">
      {/* Header */}
      <header className="page-header">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-extrabold tracking-tight">MailMind AI — Email Dashboard</h1>
            <span className="tag" style={{ color: '#445cf5', borderColor: '#445cf5' }}>
              <Sparkles size={11} className="inline mr-1" /> Active
            </span>
          </div>
          <p>Monitor your job application emails, received recruiter messages & outgoing sent mails.</p>
        </div>
        <div className="header-actions">
          <button
            onClick={handleSyncInbox}
            disabled={syncing}
            className="btn-accent"
            style={{ background: '#445cf5' }}
          >
            <RefreshCw size={14} className={syncing ? 'spin' : ''} />
            {syncing ? 'Syncing Inbox...' : 'Sync Inbox'}
          </button>
        </div>
      </header>

      {/* Flash Notice */}
      {flashMsg && (
        <div className="li-flash ok mb-4">
          <CheckCircle size={16} /> {flashMsg}
        </div>
      )}

      {/* Connected Account Card */}
      <section className="dash-section">
        <ConnectedAccount
          name="Gmail Account"
          icon={Mail}
          connected={gmailConnected}
          email={gmailConnected ? gmailEmail : ''}
          onConnect={handleInitiateConnect}
          onDisconnect={handleDisconnectGmail}
        />
      </section>

      {/* Gmail Connect Input Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-[#d9d9d2] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#f0f0ec] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                  <Mail size={16} />
                </div>
                <h3 className="font-bold text-base text-[#171817]">Connect Gmail Account</h3>
              </div>
              <button onClick={() => setShowConnectModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmConnect} className="space-y-4">
              <p className="text-xs text-gray-600 leading-relaxed">
                Enter your Gmail address to connect your inbox with MailMind AI for tracking job applications and recruiter emails.
              </p>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Your Gmail Address</label>
                <input
                  type="email"
                  required
                  value={inputEmail}
                  onChange={e => setInputEmail(e.target.value)}
                  placeholder="e.g. name@gmail.com"
                  className="w-full p-2.5 rounded-lg border border-[#d9d9d2] text-xs font-semibold outline-none focus:border-[#445cf5]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="btn-accent flex-1 justify-center"
                  style={{ background: '#445cf5' }}
                >
                  <CheckCircle size={14} /> Connect Gmail Account
                </button>
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="btn-ghost"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Tab Bar - ONLY 3 TABS: Dashboard | Received Mails | Sent Mails */}
      <div className="mail-tabs-bar">
        {[
          { id: 'dashboard', label: 'Dashboard Overview', icon: Inbox },
          { id: 'received', label: `Received Mails ${receivedThreads.length > 0 ? `(${receivedThreads.length})` : ''}`, icon: Mail },
          { id: 'sent', label: `Sent Mails ${sentThreads.length > 0 ? `(${sentThreads.length})` : ''}`, icon: Send }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`mail-tab-btn ${isActive ? 'active' : ''}`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: DASHBOARD OVERVIEW */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {!gmailConnected ? (
            <EmptyState
              icon={Mail}
              title="Gmail Not Connected"
              description="Connect your Gmail account to manage job-search outreach, track received recruiter emails, and view sent applications."
              actionLabel="Connect Gmail"
              onAction={handleInitiateConnect}
            />
          ) : (
            <>
              {/* Stats Row */}
              <div className="stats-grid compact">
                <div className="mini-stat">
                  <Inbox size={18} />
                  <div>
                    <strong>{receivedThreads.length}</strong>
                    <span>Received Mails</span>
                  </div>
                </div>
                <div className="mini-stat">
                  <Send size={18} />
                  <div>
                    <strong>{sentThreads.length}</strong>
                    <span>Sent Mails</span>
                  </div>
                </div>
                <div className="mini-stat">
                  <Clock size={18} />
                  <div>
                    <strong>{receivedThreads.filter(t => !t.isRead).length}</strong>
                    <span>Unread Messages</span>
                  </div>
                </div>
                <div className="mini-stat">
                  <CheckCircle size={18} />
                  <div>
                    <strong>Connected</strong>
                    <span>Gmail API Active</span>
                  </div>
                </div>
              </div>

              {/* Category Distribution Grid */}
              <div className="li-card">
                <div className="li-card-head">
                  <h3>
                    <Sparkles size={16} /> Received Email Categories
                  </h3>
                  <span className="text-xs font-bold text-gray-500">Auto-categorized</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { label: 'Job/Recruitment', count: categoryCounts['Job/Recruitment'], color: '#06b6d4', desc: 'Interview invitations & recruiter reachouts' },
                    { label: 'Work/Professional', count: categoryCounts['Work/Professional'], color: '#3b82f6', desc: 'Hiring manager updates & follow-ups' },
                    { label: 'Newsletters', count: categoryCounts['Newsletters'], color: '#a855f7', desc: 'Engineering & tech roundups' },
                    { label: 'Notifications', count: categoryCounts['Notifications'], color: '#f97316', desc: 'System alerts & platform notices' }
                  ].map(cat => (
                    <div
                      key={cat.label}
                      onClick={() => {
                        setSelectedCategory(cat.label);
                        setActiveTab('received');
                      }}
                      className="p-4 rounded-xl bg-[#fafaf7] border border-[#e2e2df] flex items-center justify-between cursor-pointer hover:border-[#445cf5] transition-all"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                          <span className="font-bold text-sm text-[#171817]">{cat.label}</span>
                        </div>
                        <p className="text-xs text-gray-500">{cat.desc}</p>
                      </div>
                      <div className="text-right flex items-baseline gap-1">
                        <span className="text-lg font-extrabold text-[#171817]">{cat.count}</span>
                        <span className="text-xs font-semibold text-gray-500">Threads</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Recent Received */}
                <div className="li-card">
                  <div className="li-card-head">
                    <h3>
                      <Mail size={16} /> Recent Received Mails
                    </h3>
                    <button onClick={() => setActiveTab('received')} className="text-xs font-bold text-[#445cf5] hover:underline flex items-center gap-1">
                      View All <ChevronRight size={12} />
                    </button>
                  </div>
                  {receivedThreads.length === 0 ? (
                    <div className="activity-empty">
                      <p>No received emails found. Click "Sync Inbox" to pull latest messages.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {receivedThreads.slice(0, 4).map(t => (
                        <div
                          key={t.id}
                          onClick={() => {
                            setSelectedThread(t);
                            setActiveTab('received');
                          }}
                          className="p-3 rounded-lg bg-white border border-[#e2e2df] flex items-center justify-between hover:bg-[#f8f9ff] cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center text-xs shrink-0 border border-indigo-200">
                              {t.senders?.[0]?.name?.charAt(0) || 'R'}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-xs truncate text-[#171817]">{t.subject || '(No Subject)'}</div>
                              <div className="text-[11px] text-gray-500 truncate">{t.senders?.[0]?.name || t.senderName}</div>
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-gray-400 shrink-0 ml-2">{formatTime(t.receivedAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Sent */}
                <div className="li-card">
                  <div className="li-card-head">
                    <h3>
                      <Send size={16} /> Recent Sent Mails
                    </h3>
                    <button onClick={() => setActiveTab('sent')} className="text-xs font-bold text-[#445cf5] hover:underline flex items-center gap-1">
                      View All <ChevronRight size={12} />
                    </button>
                  </div>
                  {sentThreads.length === 0 ? (
                    <div className="activity-empty">
                      <p>No sent emails logged yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {sentThreads.slice(0, 4).map(t => (
                        <div
                          key={t.id}
                          onClick={() => {
                            setSelectedSentEmail(t);
                            setActiveTab('sent');
                          }}
                          className="p-3 rounded-lg bg-white border border-[#e2e2df] flex items-center justify-between hover:bg-[#f8f9ff] cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center text-xs shrink-0 border border-emerald-200">
                              <Send size={11} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-xs truncate text-[#171817]">{t.subject || '(No Subject)'}</div>
                              <div className="text-[11px] text-gray-500 truncate">To: {t.senders?.[0]?.name || t.recipient || 'Recipient'}</div>
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-gray-400 shrink-0 ml-2">{formatTime(t.receivedAt || t.sentAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: RECEIVED MAILS (INBOX) */}
      {activeTab === 'received' && (
        <div className="space-y-4">
          {!gmailConnected ? (
            <EmptyState
              icon={Mail}
              title="Gmail Not Connected"
              description="Connect your Gmail account to view your received recruiter messages."
              actionLabel="Connect Gmail"
              onAction={handleInitiateConnect}
            />
          ) : (
            <>
              {/* Search & Filter Toolbar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-[#d9d9d2]">
                <div className="search-box sm flex-1">
                  <Search size={14} className="text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search received mails by sender, email, or subject..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-xs text-gray-400">
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Filter Category Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {['All', 'Job/Recruitment', 'Work/Professional', 'Starred', 'Unread', 'Newsletters'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`chip ${selectedCategory === cat ? 'active' : ''}`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Received Threads List */}
              <div className="li-conn-list">
                {filteredReceived.length === 0 ? (
                  <div className="empty-state">
                    <Inbox size={36} className="empty-state-icon" />
                    <h3>No received emails found</h3>
                    <p>Click "Sync Inbox" to fetch your latest incoming messages.</p>
                    <button onClick={handleSyncInbox} className="btn-accent mt-3" style={{ background: '#445cf5' }}>
                      <RefreshCw size={14} /> Sync Inbox Now
                    </button>
                  </div>
                ) : (
                  filteredReceived.map(thread => {
                    const isUnread = !thread.isRead;
                    const sender = thread.senders?.[0] || { name: thread.senderName || 'Sender', email: thread.senderEmail || '' };

                    return (
                      <div
                        key={thread.id}
                        onClick={() => setSelectedThread(thread)}
                        className={`li-conn-row cursor-pointer group ${isUnread ? 'bg-[#f4f6ff]' : ''}`}
                      >
                        {/* Avatar */}
                        <div className="li-conn-avatar">
                          {sender.name?.charAt(0) || 'R'}
                        </div>

                        {/* Thread Info */}
                        <div className="li-conn-info">
                          <div className="flex items-center gap-2">
                            <span className={`li-conn-name ${isUnread ? 'font-extrabold' : ''}`}>
                              {sender.name}
                            </span>
                            {thread.aiCategory && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[thread.aiCategory] || CATEGORY_COLORS.Uncategorized}`}>
                                {thread.aiCategory}
                              </span>
                            )}
                          </div>
                          <div className={`text-xs ${isUnread ? 'font-bold text-gray-900' : 'text-gray-700'} truncate mt-0.5`}>
                            {thread.subject || '(No Subject)'}
                          </div>
                          <small className="text-gray-500 truncate">{thread.snippet || thread.aiSummary || ''}</small>
                        </div>

                        {/* Actions & Time */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button className="btn-ghost sm" onClick={(e) => openAiPanel(e, thread, 'summary')}>Summarize</button>
                          <button className="btn-ghost sm" onClick={(e) => openAiPanel(e, thread, 'reply')}>Generate reply</button>
                          <span className="text-xs text-gray-400 font-semibold">{formatTime(thread.receivedAt)}</span>
                          <button
                            onClick={(e) => handleToggleStar(e, thread.id)}
                            className="p-1 hover:text-yellow-500 text-gray-400 transition-colors"
                            title={thread.isStarred ? 'Unstar' : 'Star'}
                          >
                            <Star size={16} className={thread.isStarred ? 'fill-yellow-400 text-yellow-400' : ''} />
                          </button>
                          <button
                            onClick={(e) => handleTrashThread(e, thread.id)}
                            className="p-1 hover:text-red-500 text-gray-400 transition-colors"
                            title="Move to Trash"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Full Received Thread Detail Modal */}
              {selectedThread && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                  <div className="bg-white border border-[#d9d9d2] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                    {/* Modal Header */}
                    <div className="p-4 border-b border-[#e2e2df] flex items-center justify-between bg-[#fafaf7]">
                      <div className="flex items-center gap-2">
                        {selectedThread.aiCategory && (
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${CATEGORY_COLORS[selectedThread.aiCategory] || CATEGORY_COLORS.Uncategorized}`}>
                            {selectedThread.aiCategory}
                          </span>
                        )}
                        <h3 className="font-bold text-sm text-[#171817] truncate max-w-md">{selectedThread.subject}</h3>
                      </div>
                      <button onClick={() => setSelectedThread(null)} className="p-1 text-gray-400 hover:text-gray-700">
                        <X size={18} />
                      </button>
                    </div>

                    {/* Modal Body */}
                    <div className="p-6 overflow-y-auto space-y-4 flex-1">
                      {(selectedThread.messages || [selectedThread]).map((msg, idx) => (
                        <div key={msg.id || idx} className="p-4 rounded-xl border border-[#e2e2df] bg-white space-y-3">
                          <div className="flex items-center justify-between border-b border-[#f0f0ec] pb-2">
                            <div>
                              <span className="font-bold text-sm text-[#171817]">{msg.senderName || selectedThread.senders?.[0]?.name || 'Sender'}</span>
                              <span className="text-xs text-gray-500 block">{msg.senderEmail || selectedThread.senders?.[0]?.email || ''}</span>
                            </div>
                            <span className="text-xs text-gray-400">{formatTime(msg.receivedAt || selectedThread.receivedAt)}</span>
                          </div>
                          <div className="text-xs text-[#171817] leading-relaxed whitespace-pre-line">
                            {msg.bodyText || selectedThread.snippet || ''}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Modal Footer */}
                    <div className="p-4 border-t border-[#e2e2df] bg-[#fafaf7] flex justify-end gap-2">
                      <button className="btn-ghost text-xs" onClick={(e) => openAiPanel(e, selectedThread, 'summary')}>Summarize</button>
                      <button className="btn-accent text-xs" onClick={(e) => openAiPanel(e, selectedThread, 'reply')}>Generate reply</button>
                      <button onClick={() => setSelectedThread(null)} className="btn-ghost text-xs">
                        Close Window
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 3: SENT MAILS */}
      {activeTab === 'sent' && (
        <div className="space-y-4">
          {!gmailConnected ? (
            <EmptyState
              icon={Send}
              title="Gmail Not Connected"
              description="Connect your Gmail account to view your sent emails."
              actionLabel="Connect Gmail"
              onAction={handleInitiateConnect}
            />
          ) : (
            <>
              {/* Search Bar */}
              <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-[#d9d9d2]">
                <div className="search-box sm flex-1">
                  <Search size={14} className="text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search sent mails by recipient, email, or subject..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-xs text-gray-400">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Sent Mails List */}
              <div className="li-conn-list">
                {filteredSent.length === 0 ? (
                  <div className="empty-state">
                    <Send size={36} className="empty-state-icon" />
                    <h3>No sent emails found</h3>
                    <p>Sent job applications and outreach emails will appear here.</p>
                  </div>
                ) : (
                  filteredSent.map(item => {
                    const recipient = item.senders?.[0] || { name: item.recipient || 'Recipient', email: '' };

                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedSentEmail(item)}
                        className="li-conn-row cursor-pointer group"
                      >
                        {/* Sent Icon Avatar */}
                        <div className="li-conn-avatar" style={{ background: '#e5f5e9', color: '#22a65b' }}>
                          <Send size={14} />
                        </div>

                        {/* Sent Mail Info */}
                        <div className="li-conn-info">
                          <div className="flex items-center gap-2">
                            <span className="li-conn-name">To: {recipient.name}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                              Sent
                            </span>
                          </div>
                          <div className="text-xs font-bold text-gray-900 truncate mt-0.5">
                            {item.subject || '(No Subject)'}
                          </div>
                          <small className="text-gray-500 truncate">{item.snippet || item.bodyText || ''}</small>
                        </div>

                        {/* Sent Timestamp */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button className="btn-ghost sm" onClick={(e) => openAiPanel(e, item, 'followup')}>Send follow-up</button>
                          <span className="text-xs text-gray-400 font-semibold">{formatTime(item.receivedAt || item.sentAt)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Sent Email Viewer Modal */}
              {selectedSentEmail && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                  <div className="bg-white border border-[#d9d9d2] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
                    {/* Modal Header */}
                    <div className="p-4 border-b border-[#e2e2df] flex items-center justify-between bg-[#fafaf7]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                          Sent Mail
                        </span>
                        <h3 className="font-bold text-sm text-[#171817] truncate max-w-md">{selectedSentEmail.subject}</h3>
                      </div>
                      <button onClick={() => setSelectedSentEmail(null)} className="p-1 text-gray-400 hover:text-gray-700">
                        <X size={18} />
                      </button>
                    </div>

                    {/* Modal Body */}
                    <div className="p-6 overflow-y-auto space-y-4 flex-1">
                      <div className="p-4 rounded-xl border border-[#e2e2df] bg-white space-y-3">
                        <div className="flex items-center justify-between border-b border-[#f0f0ec] pb-2">
                          <div>
                            <span className="font-bold text-sm text-[#171817]">To: {selectedSentEmail.senders?.[0]?.name || selectedSentEmail.recipient || 'Recipient'}</span>
                            <span className="text-xs text-gray-500 block">{selectedSentEmail.senders?.[0]?.email || ''}</span>
                          </div>
                          <span className="text-xs text-gray-400">{formatTime(selectedSentEmail.receivedAt || selectedSentEmail.sentAt)}</span>
                        </div>
                        <div className="text-xs text-[#171817] leading-relaxed whitespace-pre-line font-mono">
                          {selectedSentEmail.bodyText || selectedSentEmail.snippet || ''}
                        </div>
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="p-4 border-t border-[#e2e2df] bg-[#fafaf7] flex justify-end gap-2">
                      <button className="btn-accent text-xs" onClick={(e) => openAiPanel(e, selectedSentEmail, 'followup')}>Send follow-up</button>
                      <button onClick={() => setSelectedSentEmail(null)} className="btn-ghost text-xs">
                        Close Window
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {aiPanel && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-[#d9d9d2] rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">
                {aiPanel.mode === 'summary' ? 'Summary' : aiPanel.mode === 'reply' ? 'Generated reply' : 'Follow-up message'}
              </h3>
              <button onClick={() => setAiPanel(null)} className="text-gray-400"><X size={18} /></button>
            </div>
            {aiPanel.loading ? (
              <p className="text-sm text-gray-500">Gemini is writing this…</p>
            ) : (
              <textarea
                value={aiPanel.text}
                onChange={(e) => setAiPanel((prev) => ({ ...prev, text: e.target.value }))}
                readOnly={aiPanel.mode === 'summary'}
                rows={10}
                className="w-full p-3 rounded-lg border border-[#d9d9d2] text-sm"
              />
            )}
            {aiPanel.error && <p className="text-sm text-red-600">{aiPanel.error}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setAiPanel(null)}>Close</button>
              {aiPanel.mode === 'followup' && !aiPanel.loading && (
                <button className="btn-accent" disabled={aiPanel.sending} onClick={handleSendFollowUp}>
                  {aiPanel.sending ? 'Sending…' : 'Send follow-up'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
