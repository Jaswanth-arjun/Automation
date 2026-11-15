import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowUpRight, Check, CheckCircle2, ChevronDown, Copy,
  Loader2, Mail, Send, Sparkles, X,
} from 'lucide-react';
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

function fallbackSummary(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'No reply content yet.';
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  return sentences.slice(0, 2).join(' ').slice(0, 260);
}

function fallbackReply(contact, row) {
  return `Hi ${firstName(contact?.name)},\n\nThank you for getting back to me about the ${row.role} role at ${row.company}. I really appreciate your time and the update.\n\nIf there is anything else you need from me — my resume, portfolio, or availability — I am happy to share it right away.\n\nThanks again,\n`;
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
  const [summaryError, setSummaryError] = useState('');
  const [summaryNonce, setSummaryNonce] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const noticeTimer = useRef(null);

  const emailContacts = useMemo(
    () => (row?.contacts || []).filter((contact) => contact.emails?.length),
    [row],
  );
  const liContacts = useMemo(
    () => (row?.contacts || []).filter((contact) => contact.linkedin),
    [row],
  );
  const contacts = tab === 'email' ? emailContacts : liContacts;

  const selectedContact = useMemo(
    () => (row?.contacts || []).find((contact) => contact.id === activeId) || contacts[0] || null,
    [activeId, contacts, row],
  );

  const reply = selectedContact?.reply || null;
  const linkedinReply = selectedContact?.linkedinReply
    ? {
        subject: `LinkedIn reply — ${row.company}`,
        from: selectedContact.name,
        fromEmail: '',
        body: selectedContact.linkedinReply.body,
        receivedAt: selectedContact.linkedinReply.receivedAt,
      }
    : null;
  const activeReply = reply || linkedinReply;
  const isLinkedIn = Boolean(selectedContact?.linkedin && !selectedContact?.emails?.length);

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
    setSummaryError('');
    setNotice('');
    setError('');
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
  }, [selectedContact?.id, row?.role]);

  /* AI summary for whichever reply is open. */
  useEffect(() => {
    if (!activeReply?.body) {
      setSummary('');
      setSummaryError('');
      return undefined;
    }
    let alive = true;
    setSummaryLoading(true);
    setSummaryError('');
    api
      .summarizeMail(aiPayload(selectedContact, row, activeReply))
      .then((result) => {
        if (!alive) return;
        setSummary(result?.text || fallbackSummary(activeReply.body));
      })
      .catch(() => {
        if (!alive) return;
        setSummary(fallbackSummary(activeReply.body));
        setSummaryError('AI service unavailable — showing an extract instead.');
      })
      .finally(() => {
        if (alive) setSummaryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeReply?.body, selectedContact?.id, row?.id, summaryNonce]);

  if (!row) return null;

  const matchScore = row.matchScore ?? row.app?.matchScore;
  const statusOptions = APPLICATION_STATUS_OPTIONS.includes(row.applicationStatus)
    ? APPLICATION_STATUS_OPTIONS
    : [row.applicationStatus, ...APPLICATION_STATUS_OPTIONS];

  const handleStatusChange = (event) => {
    const status = event.target.value;
    setStatusBusy(true);
    activityStore.setApplicationStatus(row, status);
    onChanged?.();
    setStatusBusy(false);
    showNotice(status === 'Not applied' ? 'Application removed from tracker.' : `Application marked ${status}.`);
  };

  const handleGenerate = async () => {
    if (!selectedContact) return;
    setAiLoading(true);
    setError('');
    try {
      const result = await api.generateMailReply(aiPayload(selectedContact, row, activeReply));
      setReplyText(result?.text || fallbackReply(selectedContact, row));
    } catch {
      setReplyText(fallbackReply(selectedContact, row));
      showNotice('AI service unavailable — added a draft you can edit.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSend = async () => {
    if (!selectedContact?.email || !replyText.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.sendFollowUp({
        to: selectedContact.email,
        subject: replySubject,
        body: replyText,
      });
      activityStore.saveSentReply(row.id, selectedContact.id, {
        subject: replySubject,
        body: replyText,
        at: new Date().toISOString(),
      });
      setReplyText('');
      onChanged?.();
      showNotice('Reply sent. This opportunity is marked as handled.');
    } catch (err) {
      setError(err?.message || 'Could not send the reply. Check the Gmail connection and try again.');
    } finally {
      setSending(false);
    }
  };

  const handleCopy = async () => {
    if (!replyText.trim()) return;
    try {
      await navigator.clipboard.writeText(replyText);
      showNotice('Reply copied — paste it in LinkedIn.');
    } catch {
      setError('Clipboard access was blocked. Select the text and copy it manually.');
    }
  };

  const handleHandled = () => {
    if (!selectedContact) return;
    activityStore.markHandled(row.id, selectedContact.id, true);
    onChanged?.();
    showNotice('Marked as handled.');
  };

  const canReplyByEmail = Boolean(selectedContact?.email);
  const linkedinProfile = selectedContact?.linkedin?.profileUrl;

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
            <span className="atd-mark">{row.companyMark}</span>
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
          {/* Spacious Horizontal Contact Switcher (Replaces cramped vertical sidebar) */}
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
                <Mail size={26} />
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
                  {linkedinProfile && (
                    <a href={linkedinProfile} target="_blank" rel="noreferrer" className="atd-open-li">
                      Open <ArrowUpRight size={12} />
                    </a>
                  )}
                </div>

                {isLinkedIn ? (
                  <>
                    <div className="atd-li-steps">
                      {['sent', 'seen', 'accepted', 'replied'].map((step) => {
                        const current = String(selectedContact.linkedin?.status || 'pending').toLowerCase();
                        const done =
                          step === 'sent' ||
                          (step === 'seen' && current === 'seen') ||
                          (step === 'accepted' && (current === 'accepted' || current === 'replied')) ||
                          (step === 'replied' && current === 'replied');
                        return (
                          <span key={step} className={`atd-li-step ${done ? 'done' : ''}`}>
                            {done ? <Check size={11} /> : <span className="atd-dot" />} {step}
                          </span>
                        );
                      })}
                    </div>

                    {selectedContact.linkedin?.note && (
                      <div className="atd-thread">
                        <div className="atd-bubble out">
                          <header>
                            <span>You</span>
                            <time>{formatDateTime(selectedContact.linkedin.sentAt) || 'Request sent'}</time>
                          </header>
                          <p>{selectedContact.linkedin.note}</p>
                        </div>
                      </div>
                    )}

                    {linkedinReply && (
                      <>
                        <div className="atd-thread">
                          <div className="atd-bubble in">
                            <header>
                              <span>{selectedContact.name}</span>
                              <time>{formatDateTime(linkedinReply.receivedAt)}</time>
                            </header>
                            <p>{linkedinReply.body}</p>
                          </div>
                        </div>
                        <SummaryBox
                          loading={summaryLoading}
                          text={summary}
                          error={summaryError}
                          onRetry={() => setSummaryNonce((value) => value + 1)}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="atd-thread">
                      {(selectedContact.emails || []).slice(0, 1).map((email) => (
                        <div key={email.id} className="atd-bubble out">
                          <header>
                            <span>You · {email.subject || 'Referral request'}</span>
                            <time>{formatDateTime(email.sentAt)}</time>
                          </header>
                          <p>{email.body}</p>
                          {email.bounced && (
                            <span className="atd-bounced"><AlertCircle size={11} /> Delivery failed — address not found</span>
                          )}
                        </div>
                      ))}

                      {reply && (
                        <div className="atd-bubble in">
                          <header>
                            <span>{reply.from}</span>
                            <time>{formatDateTime(reply.receivedAt)}</time>
                          </header>
                          <p>{reply.body}</p>
                        </div>
                      )}

                      {selectedContact.sentReply && (
                        <div className="atd-bubble out">
                          <header>
                            <span>You · reply sent</span>
                            <time>{formatDateTime(selectedContact.sentReply.at)}</time>
                          </header>
                          <p>{selectedContact.sentReply.body}</p>
                        </div>
                      )}
                    </div>

                    {reply && (
                      <SummaryBox
                        loading={summaryLoading}
                        text={summary}
                        error={summaryError}
                        onRetry={() => setSummaryNonce((value) => value + 1)}
                      />
                    )}
                  </>
                )}

                {(reply || linkedinReply) && !selectedContact.replyHandled && (
                  <button className="atd-handled" onClick={handleHandled}>
                    <CheckCircle2 size={14} /> Mark as handled
                  </button>
                )}

                <div className="atd-composer">
                  <div className="atd-composer-head">
                    <div>
                      <h5>{reply || linkedinReply ? 'Reply' : 'Follow up'}</h5>
                      <p>
                        {canReplyByEmail
                          ? `Send directly to ${selectedContact.email}`
                          : 'Generate a reply, copy it, then paste it in LinkedIn.'}
                      </p>
                    </div>
                    <button className="atd-ai-btn" onClick={handleGenerate} disabled={aiLoading}>
                      {aiLoading ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                      {aiLoading ? 'Generating…' : 'Generate with AI'}
                    </button>
                  </div>

                  {canReplyByEmail && (
                    <label className="atd-subject">
                      <span>Subject</span>
                      <input value={replySubject} onChange={(event) => setReplySubject(event.target.value)} />
                    </label>
                  )}

                  <textarea
                    className="atd-textarea"
                    rows={6}
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    placeholder={canReplyByEmail ? 'Write your reply…' : 'Generate a reply to copy into LinkedIn…'}
                  />

                  <div className="atd-composer-actions">
                    <span className="atd-hint">
                      {reply?.fromEmail ? `Replying to ${reply.fromEmail}` : 'Edit anything before sending.'}
                    </span>
                    {canReplyByEmail ? (
                      <button
                        className="atd-send"
                        onClick={handleSend}
                        disabled={sending || !replyText.trim()}
                      >
                        {sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                        {sending ? 'Sending…' : 'Send reply'}
                      </button>
                    ) : (
                      <button className="atd-send" onClick={handleCopy} disabled={!replyText.trim()}>
                        <Copy size={14} /> Copy reply
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

function SummaryBox({ loading, text, error, onRetry }) {
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
        <p>{text || 'No summary available yet.'}</p>
      )}
      {error && <small>{error}</small>}
    </div>
  );
}
