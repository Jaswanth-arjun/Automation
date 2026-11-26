import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowUpRight, Check, CheckCircle2, ChevronDown, Info, Loader2,
  Mail, RefreshCw, Send, Sparkles, X,
} from 'lucide-react';
import CompanyLogo from './CompanyLogo';
import { api } from '../lib/api';
import { activityStore, APPLICATION_STATUS_OPTIONS } from '../lib/activityStore';
import { firstName, formatDateTime } from '../lib/timeAgo';

export const LinkedInIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

function contactStatus(contact) {
  if (contact.reply) return contact.replyHandled ? 'Handled' : 'Replied';
  if (contact.sentReply) return 'You replied';
  if (contact.bounced) return 'Bounced';
  if (contact.linkedin) {
    const status = String(contact.linkedin.status || 'pending').toLowerCase();
    if (status === 'replied') return 'Replied';
    if (status === 'accepted') return 'Accepted';
    if (status === 'seen') return 'Seen';
    if (status === 'declined') return 'Declined';
    return 'Sent';
  }
  return 'Sent';
}

const statusClass = (label) => String(label || '').toLowerCase().replace(/[^a-z]+/g, '-');

// LinkedIn conversations are listed by how far each one has gone, not by the
// order the contacts were messaged: replied first, then seen without a reply,
// then accepted, then just sent. Declined invitations sit last.
const LINKEDIN_STAGE_ORDER = { replied: 0, seen: 1, accepted: 2, pending: 3, sent: 3, declined: 4 };

function linkedInStage(contact) {
  const status = String(contact?.linkedin?.status || 'pending').toLowerCase();
  if (contact?.linkedinReply || status === 'replied') return 0;
  return LINKEDIN_STAGE_ORDER[status] ?? 3;
}

function fallbackSummary(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'No reply content yet.';
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  return sentences.slice(0, 2).join(' ').slice(0, 260);
}

// A sent message plus a refreshed thread can carry the same line twice; the
// panel shows each bubble once. Genuine repeats differ in timestamp.
function dedupeThreadItems(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = `${item?.direction || ''}|${String(item?.text || '').trim()}|${item?.at || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function aiPayload(contact, row, reply) {
  return {
    subject: reply?.subject || contact?.emails?.[0]?.subject || `Application for ${row.role}`,
    from: reply?.from || contact?.name || '',
    to: contact?.name || '',
    email: reply?.fromEmail || contact?.email || '',
    body: reply?.body || contact?.sentReply?.body || '',
  };
}

export default function ActivityDrawer({ row, onClose, onChanged }) {
  const [tab, setTab] = useState('email');
  const [activeId, setActiveId] = useState('');
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryNonce, setSummaryNonce] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [emailThread, setEmailThread] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadNonce, setThreadNonce] = useState(0);
  const [liMessages, setLiMessages] = useState([]);
  const [liLoading, setLiLoading] = useState(false);
  const [liThreadError, setLiThreadError] = useState('');
  const [liThreadNote, setLiThreadNote] = useState('');
  const [liSending, setLiSending] = useState(false);
  const [liReplyText, setLiReplyText] = useState('');
  const [liAiLoading, setLiAiLoading] = useState(false);
  const [liNonce, setLiNonce] = useState(0);
  const [liForceLive, setLiForceLive] = useState(false);
  const noticeTimer = useRef(null);
  const threadEndRef = useRef(null);
  const liRefreshFor = useRef('');

  const emailContacts = useMemo(
    () => (row?.contacts || []).filter((contact) => contact.emails?.length),
    [row],
  );
  const liContacts = useMemo(
    () => (row?.contacts || [])
      .filter((contact) => contact.linkedin)
      // Stable sort: contacts at the same stage keep the order they were added.
      .map((contact, index) => ({ contact, index }))
      .sort((a, b) => linkedInStage(a.contact) - linkedInStage(b.contact) || a.index - b.index)
      .map((entry) => entry.contact),
    [row],
  );
  const contacts = tab === 'email' ? emailContacts : liContacts;

  const selectedContact = useMemo(
    () => (row?.contacts || []).find((contact) => contact.id === activeId) || contacts[0] || null,
    [activeId, contacts, row],
  );

  const isLinkedIn = tab === 'linkedin';
  const reply = selectedContact?.reply || null;
  const activeReply = reply;

  /* Escape closes the drawer; lock page scroll while it is open. */
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  /* Reset local state when another row opens. */
  useEffect(() => {
    if (!row) return;
    const hasEmail = row.contacts?.some((contact) => contact.emails?.length);
    setTab(hasEmail ? 'email' : 'linkedin');
    const firstReply = row.contacts?.find(
      (contact) => (contact.reply || contact.linkedinReply) && !contact.replyHandled,
    );
    const firstContact = row.contacts?.find((contact) => contact.emails?.length) || row.contacts?.[0];
    setActiveId((firstReply || firstContact)?.id || '');
    setReplyText('');
    setReplySubject('');
    setSummary('');
    setNotice('');
    setError('');
    setEmailThread([]);
    setLiMessages([]);
    setLiThreadError('');
    setLiThreadNote('');
    setLiForceLive(false);
    setLiReplyText('');
  }, [row?.id]);

  /* When the tab changes, make sure a contact from that tab is selected. */
  useEffect(() => {
    if (!contacts.length) return;
    if (!contacts.some((contact) => contact.id === activeId)) {
      setActiveId(contacts[0].id);
    }
  }, [tab, contacts, activeId]);

  const showNotice = useCallback((message) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 3500);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  /* Suggest the reply subject once a contact is selected. */
  useEffect(() => {
    if (!selectedContact) return;
    const base = activeReply?.subject || selectedContact.emails?.[0]?.subject || `Application for ${row?.role || ''}`;
    const clean = String(base).replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim();
    setReplySubject(`Re: ${clean}`.trim());
    setReplyText('');
    setError('');
    setLiForceLive(false);
  }, [selectedContact?.id, row?.role]);

  /* Load the whole Gmail thread for the selected email contact. */
  useEffect(() => {
    if (isLinkedIn || !selectedContact?.email) {
      setEmailThread([]);
      return undefined;
    }
    let alive = true;
    setThreadLoading(true);
    api.getContactThread(selectedContact.email)
      .then((result) => {
        if (alive) setEmailThread(Array.isArray(result?.messages) ? result.messages : []);
      })
      .catch(() => {
        if (alive) setEmailThread([]);
      })
      .finally(() => {
        if (alive) setThreadLoading(false);
      });
    return () => { alive = false; };
  }, [isLinkedIn, selectedContact?.email, threadNonce]);

  /* Load the live LinkedIn conversation from the user's own account. */
  useEffect(() => {
    if (!isLinkedIn || !selectedContact?.linkedin) {
      setLiMessages([]);
      setLiThreadNote('');
      setLiThreadError('');
      return undefined;
    }
    // A pending or declined invitation has no thread yet, and scanning the
    // inbox for one costs tens of seconds. Say so immediately instead of
    // making the user wait. Note: 'seen' means they already accepted and have
    // an open messaging thread, so always load the real conversation for it.
    const liStatus = String(selectedContact.linkedin.status || '').toLowerCase();
    if (!liForceLive && ['pending', 'declined'].includes(liStatus)) {
      setLiMessages([]);
      setLiThreadError('');
      setLiLoading(false);
      setLiThreadNote(
        liStatus === 'declined'
          ? `${selectedContact.name} declined the invitation, so there is no conversation to open.`
          : `Your invitation to ${selectedContact.name} is still pending. Messaging opens once they accept — the note you sent is shown below.`,
      );
      return undefined;
    }
    let alive = true;
    const refreshing = liRefreshFor.current === selectedContact.id;
    if (refreshing) liRefreshFor.current = '';
    // Reading a live thread takes a while; without this the pane says "No
    // messages yet" until LinkedIn answers. Also drop the previous contact's
    // thread so one person's conversation never shows under another's name.
    if (!refreshing) {
      setLiMessages([]);
      setLiThreadError('');
      setLiThreadNote('');
    }
    setLiLoading(true);
    api.getLinkedInThread({
      personName: selectedContact.name,
      profileUrl: selectedContact.linkedin.profileUrl,
      refresh: refreshing,
    })
      .then((result) => {
        if (!alive) return;
        const loaded = Array.isArray(result?.messages) ? result.messages : [];
        setLiMessages(loaded);
        // Say "could not open the conversation" only when there is nothing to
        // show. Above an existing thread it read as an error on a working pane.
        setLiThreadNote(loaded.length ? '' : (result?.noThread ? (result.notice || 'No LinkedIn conversation yet.') : ''));
        // A failed background refresh is not worth an error banner when the
        // conversation is already on screen — the messages are what matters.
        setLiThreadError(loaded.length ? '' : (result?.refreshError || ''));
        // Show the saved thread first, then quietly check LinkedIn for newer messages.
        if (result?.cached && !refreshing) {
          api.getLinkedInThread({
            personName: selectedContact.name,
            profileUrl: selectedContact.linkedin.profileUrl,
            refresh: true,
          }).then((latest) => {
            if (!alive) return;
            // Never replace a longer saved conversation with a short live read
            // (the scrape can stop early when LinkedIn re-renders the list).
            if (Array.isArray(latest?.messages) && latest.messages.length) {
              setLiMessages((current) => (latest.messages.length >= current.length ? latest.messages : current));
              setLiThreadError('');
            }
          }).catch(() => {});
        }
      })
      .catch((err) => {
        if (!alive) return;
        setLiThreadNote('');
        setLiThreadError(err?.message || 'Could not read the LinkedIn conversation.');
      })
      .finally(() => {
        if (alive) setLiLoading(false);
      });
    return () => { alive = false; };
  }, [isLinkedIn, selectedContact?.id, selectedContact?.linkedin?.profileUrl, selectedContact?.linkedin?.status, liNonce, liForceLive]);

  const shouldShowSummary = Boolean(
    activeReply?.body &&
    activeReply.body.trim().length >= 120 &&
    activeReply.body.trim().split(/\s+/).filter(Boolean).length >= 20
  );

  /* AI summary for the email reply (only when substantial). */
  useEffect(() => {
    if (isLinkedIn || !shouldShowSummary || !activeReply?.body) {
      setSummary('');
      return undefined;
    }
    let alive = true;
    setSummaryLoading(true);
    api
      .summarizeMail(aiPayload(selectedContact, row, activeReply))
      .then((result) => { if (alive) setSummary(result?.text || fallbackSummary(activeReply.body)); })
      .catch(() => { if (alive) setSummary(fallbackSummary(activeReply.body)); })
      .finally(() => { if (alive) setSummaryLoading(false); });
    return () => { alive = false; };
  }, [isLinkedIn, shouldShowSummary, activeReply?.body, selectedContact?.id, row?.id, summaryNonce]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [emailThread.length, liMessages.length, tab]);

  if (!row) return null;

  const matchScore = row.matchScore ?? row.app?.matchScore;
  const statusOptions = APPLICATION_STATUS_OPTIONS.includes(row.applicationStatus)
    ? APPLICATION_STATUS_OPTIONS
    : [row.applicationStatus, ...APPLICATION_STATUS_OPTIONS];

  const emailHistory = emailThread.length
    ? emailThread.map((mail) => ({
        key: mail.id,
        direction: mail.direction,
        author: mail.direction === 'out' ? 'You' : (mail.fromName || mail.fromEmail || selectedContact?.name),
        text: mail.body,
        at: mail.at,
        subject: mail.subject,
      }))
    : ([
        ...(selectedContact?.emails || []).map((mail) => ({
          key: mail.id,
          direction: 'out',
          author: 'You',
          text: mail.body,
          at: mail.sentAt,
          subject: mail.subject,
        })),
        ...(reply ? [{ key: reply.id, direction: 'in', author: reply.from, text: reply.body, at: reply.receivedAt, subject: reply.subject }] : []),
        ...(selectedContact?.sentReply ? [{ key: 'sent-reply', direction: 'out', author: 'You', text: selectedContact.sentReply.body, at: selectedContact.sentReply.at, subject: '' }] : []),
      ]);

  const liHistory = liMessages.length
    ? dedupeThreadItems(liMessages)
    : [
        ...(selectedContact?.linkedin?.note ? [{ direction: 'out', author: 'You', text: selectedContact.linkedin.note, at: selectedContact.linkedin.sentAt }] : []),
        ...(selectedContact?.linkedinReply ? [{ direction: 'in', author: selectedContact.name, text: selectedContact.linkedinReply.body, at: selectedContact.linkedinReply.receivedAt }] : []),
      ];

  const conversationForAi = (isLinkedIn ? liHistory : emailHistory).map((item) => ({
    direction: item.direction,
    author: item.author,
    text: item.text,
  }));

  const handleStatusChange = (event) => {
    const status = event.target.value;
    setStatusBusy(true);
    activityStore.setApplicationStatus(row, status);
    onChanged?.();
    setStatusBusy(false);
    showNotice(status === 'Not applied' ? 'Application removed from tracker.' : `Application marked ${status}.`);
  };

  const generateDraft = async (channel) => {
    if (!selectedContact) return '';
    const result = await api.generateConversationReply({
      channel,
      contactName: selectedContact.name,
      role: row.role,
      company: row.company,
      messages: conversationForAi,
    });
    return String(result?.text || '').trim();
  };

  const handleGenerate = async () => {
    if (!selectedContact) return;
    setAiLoading(true);
    setError('');
    try {
      const text = await generateDraft('email');
      setReplyText(text || `Hi ${firstName(selectedContact.name)},\n\n`);
    } catch (err) {
      setError(err?.message || 'Could not generate a reply right now.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerateLinkedIn = async () => {
    if (!selectedContact) return;
    setLiAiLoading(true);
    setError('');
    try {
      const text = await generateDraft('linkedin');
      setLiReplyText(text || `Hi ${firstName(selectedContact.name)}, `);
    } catch (err) {
      setError(err?.message || 'Could not generate a reply right now.');
    } finally {
      setLiAiLoading(false);
    }
  };

  const handleSend = async () => {
    if (!selectedContact?.email || !replyText.trim()) return;
    setSending(true);
    setError('');
    try {
      const latestInbound = [...emailThread].reverse().find((mail) => mail.direction === 'in');
      await api.sendReply({
        to: selectedContact.email,
        subject: replySubject,
        body: replyText,
        threadId: latestInbound?.threadId || reply?.threadId || '',
        inReplyTo: latestInbound?.messageIdHeader || '',
        references: latestInbound?.referencesHeader || '',
      });
      activityStore.saveSentReply(row.id, selectedContact.id, {
        subject: replySubject,
        body: replyText,
        at: new Date().toISOString(),
      });
      setReplyText('');
      setThreadNonce((value) => value + 1);
      onChanged?.();
      showNotice('Reply sent from your Gmail account.');
    } catch (err) {
      setError(err?.message || 'Could not send the reply. Check the Gmail connection and try again.');
    } finally {
      setSending(false);
    }
  };

  const handleLinkedInSend = async () => {
    if (!selectedContact || !liReplyText.trim()) return;
    const text = liReplyText.trim();
    setLiSending(true);
    setError('');
    try {
      const result = await api.sendLinkedInMessage({
        personName: selectedContact.name,
        profileUrl: selectedContact.linkedin?.profileUrl || '',
        message: text,
      });
      setLiMessages((current) => [
        ...current,
        { direction: 'out', author: 'You', text, at: new Date().toISOString() },
      ]);
      setLiReplyText('');
      onChanged?.();
      showNotice(result?.warning || 'Message sent from your LinkedIn account.');
    } catch (err) {
      if (err?.uncertain) {
        // The message may have gone out before the tab died — say so and let
        // the user check the real thread rather than inviting a blind resend.
        setLiThreadError('');
        showNotice(err.message);
        setLiNonce((value) => value + 1);
      } else {
        setError(err?.message || 'Could not send the LinkedIn message.');
      }
    } finally {
      setLiSending(false);
    }
  };

  const handleHandled = () => {
    if (!selectedContact) return;
    activityStore.markHandled(row.id, selectedContact.id, true);
    onChanged?.();
    showNotice('Marked as handled.');
  };

  const linkedinProfile = selectedContact?.linkedin?.profileUrl;
  const canSendEmail = Boolean(selectedContact?.email);
  const canSendLinkedIn = Boolean(selectedContact?.linkedin);

  return (
    <div className="atd-overlay" onMouseDown={onClose} role="presentation">
      <aside
        className="atd-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.company} — ${row.role} activity details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="atd-head">
          <div className="atd-head-main">
            <CompanyLogo
              job={{
                company: row.company,
                companyMark: row.companyMark,
                companyLogoUrl: row.companyLogoUrl,
                applyLink: row.applyLink,
              }}
              className="atd-mark"
            />
            <div>
              <h3>{row.role}</h3>
              <p>
                {row.company}
                {matchScore !== undefined && matchScore !== null ? ` · ${Math.round(matchScore)}% match` : ''}
              </p>
            </div>
          </div>
          <button className="atd-close" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </header>

        <div className="atd-statusbar">
          <label className="atd-status-field">
            <span>Application</span>
            <span className={`atd-select-wrap ${statusBusy ? 'is-busy' : ''}`}>
              <select value={row.applicationStatus} onChange={handleStatusChange} disabled={statusBusy}>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <ChevronDown size={13} />
            </span>
          </label>
          <div className="atd-status-meta">
            <span>Last activity</span>
            <strong>{formatDateTime(row.lastActivityAt) || '—'}</strong>
          </div>
          <div className="atd-status-meta">
            <span>Replies</span>
            <strong className={row.unhandledReplies ? 'is-hot' : ''}>
              {row.emailReplied + row.liReplied}
              {row.unhandledReplies > 0 ? ` · ${row.unhandledReplies} new` : ''}
            </strong>
          </div>
        </div>

        <div className="atd-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'email'}
            className={tab === 'email' ? 'active' : ''}
            onClick={() => setTab('email')}
          >
            <Mail size={14} /> Email <span>{emailContacts.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'linkedin'}
            className={tab === 'linkedin' ? 'active' : ''}
            onClick={() => setTab('linkedin')}
          >
            <LinkedInIcon size={14} /> LinkedIn <span>{liContacts.length}</span>
          </button>
        </div>

        <div className="atd-body atd-body-free">
          {contacts.length > 1 && (
            <div className="atd-contact-bar">
              <span className="atd-contact-bar-label">Contact:</span>
              <div className="atd-contact-pill-list">
                {contacts.map((contact) => {
                  const label = contactStatus(contact);
                  const isSelected = selectedContact?.id === contact.id;
                  return (
                    <button
                      key={contact.id}
                      className={`atd-contact-pill ${isSelected ? 'active' : ''}`}
                      onClick={() => setActiveId(contact.id)}
                      title={`View conversation with ${contact.name}`}
                    >
                      <span className="atd-pill-avatar">
                        {String(contact.name || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="atd-pill-name">{contact.name}</span>
                      <span className={`atd-pill-badge s-${statusClass(label)}`}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="atd-detail atd-detail-full">
            {notice && <div className="atd-note success"><CheckCircle2 size={14} /> {notice}</div>}
            {error && <div className="atd-note error"><AlertCircle size={14} /> {error}</div>}

            {contacts.length === 0 ? (
              <div className="atd-empty-detail">
                {tab === 'email' ? <Mail size={26} /> : <LinkedInIcon size={26} />}
                <p>
                  {tab === 'email'
                    ? 'No email outreach yet for this role.'
                    : 'No LinkedIn referrals yet for this company.'}
                </p>
              </div>
            ) : !selectedContact ? (
              <div className="atd-empty-detail">
                <Mail size={26} />
                <p>Select a contact to see the conversation and send a reply.</p>
              </div>
            ) : (
              <>
                <div className="atd-contact-head">
                  <div>
                    <h4>{selectedContact.name}</h4>
                    <p>
                      {selectedContact.email || selectedContact.linkedin?.headline || selectedContact.title || 'LinkedIn member'}
                    </p>
                  </div>
                  <div className="atd-head-actions">
                    <button
                      className="atd-refresh"
                      onClick={() => {
                        if (isLinkedIn) {
                          liRefreshFor.current = selectedContact.id;
                          setLiNonce((value) => value + 1);
                        } else setThreadNonce((value) => value + 1);
                      }}
                      title="Refresh the conversation"
                    >
                      <RefreshCw size={12} className={isLinkedIn ? (liLoading ? 'spin' : '') : (threadLoading ? 'spin' : '')} /> Refresh
                    </button>
                    {linkedinProfile && (
                      <a href={linkedinProfile} target="_blank" rel="noreferrer" className="atd-open-li">
                        Open <ArrowUpRight size={12} />
                      </a>
                    )}
                  </div>
                </div>

                {isLinkedIn && (
                  <div className="atd-li-steps">
                    {['sent', 'accepted', 'seen', 'replied'].map((step) => {
                      const current = String(selectedContact.linkedin?.status || 'pending').toLowerCase();
                      const done =
                        step === 'sent' ||
                        (step === 'accepted' && ['accepted', 'seen', 'replied'].includes(current)) ||
                        (step === 'seen' && ['seen', 'replied'].includes(current)) ||
                        (step === 'replied' && current === 'replied');
                      return (
                        <span key={step} className={`atd-li-step ${done ? 'done' : ''}`}>
                          {done ? <Check size={11} /> : <span className="atd-dot" />} {step}
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="atd-thread atd-thread-full">
                  {isLinkedIn ? (
                    liLoading && liMessages.length === 0 ? (
                      <div className="atd-thread-loading"><Loader2 size={16} className="spin" /> Loading your LinkedIn conversation…</div>
                    ) : (
                      <>
                        {liThreadError ? (
                          <div className="atd-thread-notice error">
                            <AlertCircle size={14} />
                            <span>{liThreadError}</span>
                            <button className="atd-thread-retry" onClick={() => { liRefreshFor.current = selectedContact.id; setLiNonce((value) => value + 1); }}>
                              Try again
                            </button>
                          </div>
                        ) : liThreadNote ? (
                          <div className="atd-thread-notice">
                            <Info size={14} />
                            <span>{liThreadNote}</span>
                            {!liForceLive && ['pending', 'declined'].includes(String(selectedContact.linkedin?.status || '').toLowerCase()) && (
                              <button className="atd-thread-retry" onClick={() => { liRefreshFor.current = selectedContact.id; setLiForceLive(true); setLiNonce((value) => value + 1); }}>
                                Check LinkedIn
                              </button>
                            )}
                          </div>
                        ) : null}

                        {liHistory.length === 0 ? (
                          liThreadError || liThreadNote ? null : (
                            <p className="atd-thread-empty">No messages in this LinkedIn conversation yet.</p>
                          )
                        ) : (
                          liHistory.map((message, index) => (
                            <div key={`${message.at}-${index}`} className={`atd-bubble ${message.direction === 'out' ? 'out' : 'in'}`}>
                              <header>
                                <span>{message.author}</span>
                                <time>{formatDateTime(message.at) || ''}</time>
                              </header>
                              <p>{message.text}</p>
                            </div>
                          ))
                        )}
                      </>
                    )
                  ) : threadLoading && emailHistory.length === 0 ? (
                    <div className="atd-thread-loading"><Loader2 size={16} className="spin" /> Loading the email thread…</div>
                  ) : emailHistory.length === 0 ? (
                    <p className="atd-thread-empty">No emails in this conversation yet.</p>
                  ) : (
                    emailHistory.map((message, index) => (
                      <div key={`${message.key}-${index}`} className={`atd-bubble ${message.direction === 'out' ? 'out' : 'in'}`}>
                        <header>
                          <span>{message.direction === 'out' ? 'You' : message.author}{message.subject ? ` · ${message.subject}` : ''}</span>
                          <time>{formatDateTime(message.at) || ''}</time>
                        </header>
                        <p>{message.text}</p>
                      </div>
                    ))
                  )}
                  <div ref={threadEndRef} />
                </div>

                {!isLinkedIn && reply && shouldShowSummary && (
                  <SummaryBox loading={summaryLoading} text={summary} onRetry={() => setSummaryNonce((value) => value + 1)} />
                )}

                {(reply || selectedContact.linkedinReply) && !selectedContact.replyHandled && (
                  <button className="atd-handled" onClick={handleHandled}>
                    <CheckCircle2 size={14} /> Mark as handled
                  </button>
                )}

                <div className="atd-composer">
                  <div className="atd-composer-head">
                    <div>
                      <h5>{isLinkedIn ? 'Reply on LinkedIn' : 'Reply by email'}</h5>
                      <p>
                        {isLinkedIn
                          ? `Sends from your own LinkedIn account to ${selectedContact.name}.`
                          : `Sends from your Gmail account to ${selectedContact.email}.`}
                      </p>
                    </div>
                    <button
                      className="atd-ai-btn"
                      onClick={isLinkedIn ? handleGenerateLinkedIn : handleGenerate}
                      disabled={isLinkedIn ? liAiLoading : aiLoading}
                    >
                      {(isLinkedIn ? liAiLoading : aiLoading) ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                      {(isLinkedIn ? liAiLoading : aiLoading) ? 'Generating…' : 'Generate with AI'}
                    </button>
                  </div>

                  {!isLinkedIn && (
                    <label className="atd-subject">
                      <span>Subject</span>
                      <input value={replySubject} onChange={(event) => setReplySubject(event.target.value)} />
                    </label>
                  )}

                  {isLinkedIn ? (
                    <textarea
                      className="atd-textarea"
                      rows={5}
                      value={liReplyText}
                      onChange={(event) => setLiReplyText(event.target.value)}
                      placeholder="Write a LinkedIn reply…"
                    />
                  ) : (
                    <textarea
                      className="atd-textarea"
                      rows={6}
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder="Write your reply…"
                    />
                  )}

                  <div className="atd-composer-actions">
                    <span className="atd-hint">
                      {isLinkedIn
                        ? (liHistory.length ? 'AI reads the whole thread before writing.' : 'Reply in the context of this conversation.')
                        : 'AI reads the whole thread before writing. Edit anything before sending.'}
                    </span>
                    {isLinkedIn ? (
                      <button
                        className="atd-send"
                        onClick={handleLinkedInSend}
                        disabled={liSending || !liReplyText.trim() || !canSendLinkedIn}
                      >
                        {liSending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                        {liSending ? 'Sending…' : 'Send on LinkedIn'}
                      </button>
                    ) : (
                      <button
                        className="atd-send"
                        onClick={handleSend}
                        disabled={sending || !replyText.trim() || !canSendEmail}
                      >
                        {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                        {sending ? 'Sending…' : 'Send reply'}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function SummaryBox({ loading, text, onRetry }) {
  if (!loading && !text) return null;
  return (
    <div className="atd-summary">
      <div className="atd-summary-head">
        <span><Sparkles size={13} /> AI summary</span>
        <button onClick={onRetry} title="Refresh summary">Refresh</button>
      </div>
      {loading ? (
        <div className="atd-summary-loading">
          <span /><span /><span />
        </div>
      ) : (
        <p>{text}</p>
      )}
    </div>
  );
}
