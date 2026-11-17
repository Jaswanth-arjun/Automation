import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, FolderOpen, FileText, Mail, Download, Eye, Check,
  X, RefreshCw, AlertCircle, Sparkles, Search, ExternalLink,
} from 'lucide-react';
import EmptyState from '../components/EmptyState';
import CampaignStatus from '../components/CampaignStatus';
import {
  buildTrackerEntries, fetchTrackerSources, matchesTrackerFilter,
  TRACKER_FILTERS, TRACKER_STATUS_META, STAGE_ORDER, STAGE_LABELS,
} from '../lib/jobTracker';
import './Applications.css';

const LinkedinMark = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

function pdfObjectUrl(base64) {
  if (!base64) return '';
  const binary = atob(base64.includes(',') ? base64.split(',')[1] : base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function openResume(resume) {
  const base64 = resume?.pdfBase64 || resume?.base64;
  if (!base64) return;
  window.open(pdfObjectUrl(base64), '_blank');
}

function downloadResume(resume) {
  const base64 = resume?.pdfBase64 || resume?.base64;
  if (!base64) return;
  const link = document.createElement('a');
  link.href = pdfObjectUrl(base64);
  const name = resume?.name || 'tailored-resume.pdf';
  link.download = name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
  link.click();
}

const shortDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const statusClass = (status) => `jt-status-${String(status || 'Not applied').toLowerCase().replace(/[^a-z]+/g, '-')}`;

const LI_STATUS_LABEL = {
  accepted: 'Accepted',
  replied: 'Replied',
  seen: 'Seen',
  pending: 'Pending',
  declined: 'Declined',
};

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

export default function Applications() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState(() => buildTrackerEntries({}));
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceErrors, setSourceErrors] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [outreach, setOutreach] = useState(null); // { type: 'email' | 'linkedin', entry }
  const [alreadyApplied, setAlreadyApplied] = useState(null);
  const [notice, setNotice] = useState(null);
  const sourcesRef = useRef({ sent: [], linkedin: [], received: [] });

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    const sources = await fetchTrackerSources();
    sourcesRef.current = sources;
    setEntries(buildTrackerEntries(sources));
    setSourceErrors(sources.errors || []);
    setSourcesLoading(false);
  }, []);

  useEffect(() => {
    loadSources();
    const refreshLocal = () => {
      // Local stores changed (resume tailored, application added, stage marked).
      setEntries(buildTrackerEntries(sourcesRef.current));
    };
    window.addEventListener('applications_updated', refreshLocal);
    window.addEventListener('resumes_updated', refreshLocal);
    window.addEventListener('apply_progress_updated', refreshLocal);
    window.addEventListener('storage', refreshLocal);
    return () => {
      window.removeEventListener('applications_updated', refreshLocal);
      window.removeEventListener('resumes_updated', refreshLocal);
      window.removeEventListener('apply_progress_updated', refreshLocal);
      window.removeEventListener('storage', refreshLocal);
    };
  }, [loadSources]);

  // Keep the open outreach popup in sync when the tracker refreshes.
  useEffect(() => {
    if (!outreach) return;
    const fresh = entries.find((entry) => entry.key === outreach.entry.key);
    if (fresh && fresh !== outreach.entry) setOutreach({ ...outreach, entry: fresh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const trackable = useMemo(() => entries.filter((entry) => entry.resumeCount > 0 || entry.appliedFlag || entry.applications.length > 0), [entries]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return trackable.filter((entry) => {
      if (!matchesTrackerFilter(entry, statusFilter)) return false;
      if (!needle) return true;
      return `${entry.title} ${entry.company}`.toLowerCase().includes(needle);
    });
  }, [trackable, statusFilter, query]);

  const summary = useMemo(() => ({
    tracked: trackable.length,
    tailored: trackable.filter((entry) => entry.resumeCount > 0).length,
    applied: trackable.filter((entry) => entry.appliedFlag).length,
    replies: trackable.filter((entry) => entry.detected).length,
    linkedin: trackable.reduce((total, entry) => total + (entry.linkedin?.accepted || 0), 0),
  }), [trackable]);

  const handleContinue = (entry) => {
    if (entry.appliedFlag) {
      setAlreadyApplied(entry);
      return;
    }
    if (entry.jobId) {
      navigate(`/dashboard/apply/${entry.jobId}?stage=${entry.nextStage || 'tailor'}`);
      return;
    }
    if (entry.jobUrl) {
      window.open(entry.jobUrl, '_blank');
      return;
    }
    setNotice({ title: 'Job page unavailable', message: 'This entry was tracked from your resume or outreach, but it has no linked job page. Open the job from Jobs to continue the apply flow.' });
  };

  const linkedNow = (entry) => (entry.nextStage ? STAGE_LABELS[entry.nextStage] : 'Applied');

  const emailTitle = (email) => {
    if (!email) return '';
    return [
      `${email.sent} referral email${email.sent > 1 ? 's' : ''}`,
      `${email.recipients.length} contact${email.recipients.length > 1 ? 's' : ''}`,
      `${email.replied} replied`,
    ].join(' · ');
  };

  const linkedinTitle = (linkedin) => {
    if (!linkedin) return '';
    const parts = [
      `${linkedin.sent} request${linkedin.sent > 1 ? 's' : ''}`,
      linkedin.accepted ? `${linkedin.accepted} accepted` : '',
      linkedin.replied ? `${linkedin.replied} replied` : '',
      linkedin.seen ? `${linkedin.seen} seen` : '',
      linkedin.declined ? `${linkedin.declined} declined` : '',
      linkedin.pending ? `${linkedin.pending} pending` : '',
    ];
    return parts.filter(Boolean).join(' · ');
  };

  return (
    <div className="jt-page">
      <header className="jt-header">
        <div>
          <h1>Job Tracker</h1>
          <p>Every job you tailored a resume for, with outreach and replies in one place.</p>
        </div>
      </header>
      <CampaignStatus variant="compact" onNavigate={() => navigate('/dashboard/linkedin?tab=campaign')} showLog={false} />

      <section className="jt-hero">
        <div className="jt-hero-main">
          <span className="jt-hero-eyebrow">Job search</span>
          <h2 className="jt-hero-title">
            <strong>{summary.applied}</strong>
            <span>application{summary.applied === 1 ? '' : 's'} submitted</span>
          </h2>
          <p className="jt-hero-text">
            {summary.tracked > 0
              ? `${summary.tracked} job${summary.tracked === 1 ? '' : 's'} tracked · ${summary.tailored} resume version${summary.tailored === 1 ? '' : 's'} tailored${summary.replies > 0 ? ` · ${summary.replies} inbox update${summary.replies === 1 ? '' : 's'} auto-detected` : ''}.`
              : 'Tailor a resume from any job to start tracking it here with outreach and replies.'}
          </p>
          <div className="jt-hero-actions">
            <button type="button" className="jt-btn-primary" onClick={() => navigate('/dashboard/jobs')}>
              Explore jobs <ArrowRight size={15} />
            </button>
            <button type="button" className="jt-btn-ghost" onClick={loadSources} disabled={sourcesLoading}>
              <RefreshCw size={14} className={sourcesLoading ? 'spin' : ''} />
              {sourcesLoading ? 'Syncing…' : 'Sync tracker'}
            </button>
          </div>
        </div>

        <div className="jt-hero-grid">
          <div className="jt-stat">
            <span className="jt-stat-label">Tracked</span>
            <strong className="jt-stat-value">{summary.tracked}</strong>
            <span className="jt-stat-caption">Jobs in your tracker</span>
          </div>
          <div className="jt-stat">
            <span className="jt-stat-label">Tailored</span>
            <strong className="jt-stat-value is-indigo">{summary.tailored}</strong>
            <span className="jt-stat-caption">Resume versions</span>
          </div>
          <div className="jt-stat">
            <span className="jt-stat-label">Replies</span>
            <strong className="jt-stat-value is-green">{summary.replies}</strong>
            <span className="jt-stat-caption">Inbox updates</span>
          </div>
          <div className="jt-stat">
            <span className="jt-stat-label">LinkedIn</span>
            <strong className="jt-stat-value is-linkedin">{summary.linkedin}</strong>
            <span className="jt-stat-caption">Invites accepted</span>
          </div>
        </div>
      </section>

      {sourceErrors.length > 0 && trackable.length > 0 && (
        <div className="jt-note">
          <AlertCircle size={15} />
          <span>
            {sourceErrors.includes('replies')
              ? 'Connect Gmail to auto-detect interview, shortlist and rejection updates from your inbox.'
              : 'Some outreach sources could not be loaded. Showing what is available.'}
          </span>
        </div>
      )}

      {notice && (
        <div className="jt-note jt-note-soft">
          <AlertCircle size={15} />
          <span><strong>{notice.title}:</strong> {notice.message}</span>
          <button type="button" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {trackable.length === 0 && !sourcesLoading ? (
        <EmptyState
          icon={FolderOpen}
          title="No tracked jobs yet"
          description="Tailor a resume from any job's Apply page and it appears here with its ATS report, outreach and application status."
          actionLabel="Explore Jobs"
          onAction={() => navigate('/dashboard/jobs')}
        />
      ) : (
        <>
          <div className="jt-toolbar">
            <div className="jt-filters">
              {TRACKER_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`jt-filter ${statusFilter === filter ? 'active' : ''}`}
                  onClick={() => setStatusFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
            <label className="jt-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search role or company"
              />
            </label>
          </div>

          {sourcesLoading && trackable.length === 0 && (
            <div className="jt-loading"><RefreshCw size={18} className="spin" /> Loading your tracker…</div>
          )}

          <div className="jt-list">
            {filtered.map((entry) => {
              const meta = TRACKER_STATUS_META[entry.status] || TRACKER_STATUS_META['Not applied'];
              const latest = entry.latestResume;
              return (
                <article key={entry.key} className="jt-row">
                  <div className="jt-row-main">
                    <div className="jt-logo">{entry.companyMark}</div>

                    <div className="jt-ident">
                      <div className="jt-title-row">
                        <h3 title={entry.title}>{entry.title}</h3>
                        {entry.matchScore !== null && <span className="jt-match">{entry.matchScore}%</span>}
                      </div>
                      <p title={`${entry.company}${entry.appliedAt ? ` · Applied ${shortDate(entry.appliedAt)}` : ''}`}>
                        {entry.company}
                        {entry.appliedAt ? ` · Applied ${shortDate(entry.appliedAt)}` : entry.lastActivityAt ? ` · ${shortDate(entry.lastActivityAt)}` : ''}
                      </p>
                    </div>

                    <div
                      className="jt-progress"
                      title={entry.appliedFlag
                        ? 'Applied'
                        : entry.nextStage ? `Paused at ${STAGE_LABELS[entry.nextStage]}` : 'Not started'}
                      aria-label="Stage progress"
                    >
                      {STAGE_ORDER.map((stage, index) => {
                        const done = entry.stages[stage];
                        const current = !done && entry.nextStage === stage;
                        const skipped = Boolean(entry.appliedFlag) && !done && !current;
                        return (
                          <span
                            key={stage}
                            className={`jt-seg ${done ? 'done' : ''} ${current ? 'current' : ''} ${skipped ? 'skipped' : ''}`}
                            title={`${index + 1}. ${STAGE_LABELS[stage]}${done ? ' — done' : current ? ' — paused here' : skipped ? ' — skipped' : ''}`}
                          />
                        );
                      })}
                    </div>

                    <div className="jt-chips">
                      {entry.resumeCount > 0 ? (
                        <span className="jt-chip jt-chip-resume" title={latest?.name || 'Tailored resume'}>
                          <FileText size={14} />
                          <strong>{entry.resumeCount}</strong>
                          <span className="jt-chip-actions">
                            <button type="button" onClick={() => openResume(latest)} title="View latest resume"><Eye size={13} /></button>
                            <button type="button" onClick={() => downloadResume(latest)} title="Download latest resume"><Download size={13} /></button>
                          </span>
                        </span>
                      ) : (
                        <span className="jt-chip jt-chip-muted" title="No tailored resume yet">
                          <FileText size={14} /> No resume
                        </span>
                      )}

                      {entry.email && (
                        <button
                          type="button"
                          className="jt-chip jt-chip-mail jt-chip-btn"
                          onClick={() => setOutreach({ type: 'email', entry })}
                          title={`${emailTitle(entry.email)} · click to see contacted emails`}
                        >
                          <Mail size={14} />
                          <strong>{entry.email.sent}</strong>
                          {entry.email.replied > 0 && (
                            <span className="jt-chip-badge" title={`${entry.email.replied} replied`}>
                              <Check size={9} />{entry.email.replied}
                            </span>
                          )}
                        </button>
                      )}

                      {entry.linkedin && (
                        <button
                          type="button"
                          className="jt-chip jt-chip-li jt-chip-btn"
                          onClick={() => setOutreach({ type: 'linkedin', entry })}
                          title={`${linkedinTitle(entry.linkedin)} · click to see contacts`}
                        >
                          <LinkedinMark size={14} />
                          <strong>{entry.linkedin.sent}</strong>
                          {entry.linkedin.accepted > 0 && (
                            <span className="jt-chip-badge" title={`${entry.linkedin.accepted} accepted`}>
                              <Check size={9} />{entry.linkedin.accepted}
                            </span>
                          )}
                        </button>
                      )}

                      {entry.detected && (
                        <span
                          className="jt-chip jt-chip-update"
                          title={`Auto-detected from email: ${entry.detected.subject || entry.detected.status}`}
                        >
                          <Mail size={13} />
                          <span className="jt-chip-update-text">{entry.detected.status}</span>
                        </span>
                      )}
                    </div>

                    <span
                      className={`jt-status ${statusClass(entry.status)}`}
                      style={{ background: meta.bg, color: meta.color }}
                      title={entry.statusSource === 'email' ? 'Auto-detected from your email' : 'Application status'}
                    >
                      <span className="jt-status-dot" style={{ background: meta.dot }} />
                      {entry.status}
                    </span>

                    <button
                      type="button"
                      className="jt-continue"
                      onClick={() => handleContinue(entry)}
                      title={entry.appliedFlag ? 'Already applied — view status' : `Continue from ${linkedNow(entry)}`}
                    >
                      <ArrowRight size={18} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {filtered.length === 0 && !sourcesLoading && (
            <div className="jt-empty-filter">
              <Sparkles size={18} />
              <p>No tracked jobs match this filter.</p>
              <button type="button" onClick={() => { setStatusFilter('All'); setQuery(''); }}>Clear filters</button>
            </div>
          )}
        </>
      )}

      {/* ── Outreach popup: contacted emails ─────────────────── */}
      {outreach?.type === 'email' && outreach.entry.email && (
        <div
          className="jt-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Referral email outreach"
          onClick={(event) => { if (event.target === event.currentTarget) setOutreach(null); }}
        >
          <div className="jt-modal jt-modal-lg">
            <div className="jt-modal-head">
              <div className="jt-modal-icon jt-icon-mail"><Mail size={19} /></div>
              <div>
                <h3>Referral emails</h3>
                <p>{outreach.entry.title} · {outreach.entry.company}</p>
              </div>
              <button type="button" className="jt-modal-close" onClick={() => setOutreach(null)}><X size={16} /></button>
            </div>

            <div className="jt-outreach-body">
              <div className="jt-outreach-stats">
                <div><strong>{outreach.entry.email.sent}</strong><span>Emails sent</span></div>
                <div><strong>{outreach.entry.email.recipients.length}</strong><span>Contacted</span></div>
                <div><strong>{outreach.entry.email.replied}</strong><span>Replied</span></div>
              </div>

              <div className="jt-meter">
                <div className="jt-meter-top">
                  <span>Reply progress</span>
                  <strong>{pct(outreach.entry.email.replied, outreach.entry.email.recipients.length)}%</strong>
                </div>
                <div className="jt-meter-track">
                  <span
                    className="jt-meter-fill jt-meter-mail"
                    style={{ width: `${pct(outreach.entry.email.replied, outreach.entry.email.recipients.length)}%` }}
                  />
                </div>
              </div>

              <div className="jt-outreach-list">
                <h4>Contacted email IDs</h4>
                <ul>
                  {outreach.entry.email.contacts.map((contact) => (
                    <li key={contact.email}>
                      <span className="jt-avatar jt-avatar-mail">
                        {(contact.name || contact.email).charAt(0).toUpperCase()}
                      </span>
                      <span className="jt-contact-body">
                        <span className="jt-contact-name">{contact.name || contact.email}</span>
                        <span className="jt-contact-sub">
                          {contact.name ? `${contact.email} · ` : ''}
                          sent {shortDate(contact.sentAt)}
                          {contact.sentCount > 1 ? ` · ${contact.sentCount} emails` : ''}
                        </span>
                        {contact.replied && contact.replySubject && (
                          <span className="jt-contact-reply" title={contact.replySubject}>
                            “{contact.replySubject}”{contact.replyAt ? ` · ${shortDate(contact.replyAt)}` : ''}
                          </span>
                        )}
                      </span>
                      <span className={`jt-contact-status ${contact.replied ? 'ok' : ''}`}>
                        {contact.replied ? 'Replied' : 'Awaiting'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {outreach.entry.detected && (
                <div className="jt-outreach-update">
                  <Mail size={13} />
                  <span>
                    <strong>{outreach.entry.detected.status}</strong>
                    {outreach.entry.detected.subject ? ` — ${outreach.entry.detected.subject}` : ''}
                    {outreach.entry.detected.at ? ` · ${shortDate(outreach.entry.detected.at)}` : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="jt-modal-actions">
              <button type="button" className="jt-btn-ghost" onClick={() => setOutreach(null)}>Close</button>
              {outreach.entry.jobId && (
                <button
                  type="button"
                  className="jt-btn-primary"
                  onClick={() => {
                    const target = outreach.entry;
                    setOutreach(null);
                    navigate(`/dashboard/apply/${target.jobId}?stage=referral`);
                  }}
                >
                  Open outreach flow <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Outreach popup: LinkedIn contacts ────────────────── */}
      {outreach?.type === 'linkedin' && outreach.entry.linkedin && (
        <div
          className="jt-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="LinkedIn outreach"
          onClick={(event) => { if (event.target === event.currentTarget) setOutreach(null); }}
        >
          <div className="jt-modal jt-modal-lg">
            <div className="jt-modal-head">
              <div className="jt-modal-icon jt-icon-li"><LinkedinMark size={19} /></div>
              <div>
                <h3>LinkedIn outreach</h3>
                <p>{outreach.entry.title} · {outreach.entry.company}</p>
              </div>
              <button type="button" className="jt-modal-close" onClick={() => setOutreach(null)}><X size={16} /></button>
            </div>

            <div className="jt-outreach-body">
              <div className="jt-outreach-stats">
                <div><strong>{outreach.entry.linkedin.sent}</strong><span>Requests</span></div>
                <div><strong>{outreach.entry.linkedin.accepted}</strong><span>Accepted</span></div>
                <div><strong>{outreach.entry.linkedin.pending}</strong><span>Pending</span></div>
              </div>

              <div className="jt-meter">
                <div className="jt-meter-top">
                  <span>Connection progress</span>
                  <strong>{pct(outreach.entry.linkedin.accepted, outreach.entry.linkedin.sent)}%</strong>
                </div>
                <div className="jt-meter-track">
                  <span
                    className="jt-meter-fill jt-meter-li"
                    style={{ width: `${pct(outreach.entry.linkedin.accepted, outreach.entry.linkedin.sent)}%` }}
                  />
                </div>
              </div>

              <div className="jt-outreach-list">
                <h4>Contacted on LinkedIn</h4>
                <ul>
                  {outreach.entry.linkedin.contacts.map((contact) => (
                    <li key={contact.id}>
                      <span className="jt-avatar jt-avatar-li">
                        {(contact.name || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="jt-contact-body">
                        <span className="jt-contact-name">
                          {contact.name}
                          {contact.role ? <span className="jt-contact-role"> · {contact.role}</span> : null}
                        </span>
                        <span className="jt-contact-sub">
                          {[contact.headline, contact.at ? shortDate(contact.at) : ''].filter(Boolean).join(' · ') || 'Request sent'}
                        </span>
                        {contact.replyText && (
                          <span className="jt-contact-reply" title={contact.replyText}>“{contact.replyText}”</span>
                        )}
                      </span>
                      <span className={`jt-li-status jt-li-${contact.status}`}>
                        {LI_STATUS_LABEL[contact.status] || contact.status}
                      </span>
                      {contact.profileUrl && (
                        <a
                          href={contact.profileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="jt-li-open"
                          title="Open LinkedIn profile"
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="jt-modal-actions">
              <button type="button" className="jt-btn-ghost" onClick={() => setOutreach(null)}>Close</button>
              {outreach.entry.jobId && (
                <button
                  type="button"
                  className="jt-btn-primary"
                  onClick={() => {
                    const target = outreach.entry;
                    setOutreach(null);
                    navigate(`/dashboard/apply/${target.jobId}?stage=linkedin`);
                  }}
                >
                  Open outreach flow <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {alreadyApplied && (
        <div className="jt-modal-backdrop" role="dialog" aria-modal="true" aria-label="Already applied">
          <div className="jt-modal">
            <div className="jt-modal-head">
              <div className="jt-modal-icon"><Check size={20} /></div>
              <div>
                <h3>You already applied</h3>
                <p>{alreadyApplied.title} · {alreadyApplied.company}</p>
              </div>
              <button type="button" className="jt-modal-close" onClick={() => setAlreadyApplied(null)}><X size={16} /></button>
            </div>
            <div className="jt-modal-body">
              <div className="jt-modal-row">
                <span>Application status</span>
                <strong style={{ color: (TRACKER_STATUS_META[alreadyApplied.status] || {}).color }}>
                  {alreadyApplied.status}
                </strong>
              </div>
              <div className="jt-modal-row">
                <span>Applied on</span>
                <strong>{alreadyApplied.appliedAt ? shortDate(alreadyApplied.appliedAt) : 'Recorded'}</strong>
              </div>
              {alreadyApplied.detected && (
                <div className="jt-modal-row">
                  <span>Latest email</span>
                  <strong style={{ maxWidth: '60%', textAlign: 'right' }}>{alreadyApplied.detected.subject || alreadyApplied.detected.status}</strong>
                </div>
              )}
              {alreadyApplied.latestResume && (
                <div className="jt-modal-row">
                  <span>Resume used</span>
                  <strong style={{ maxWidth: '60%', textAlign: 'right' }}>{alreadyApplied.latestResume.name}</strong>
                </div>
              )}
              <p className="jt-modal-hint">
                This job is already marked as applied. Open the job page to review the tailored resume or continue outreach.
              </p>
            </div>
            <div className="jt-modal-actions">
              <button type="button" className="jt-btn-ghost" onClick={() => setAlreadyApplied(null)}>Close</button>
              {alreadyApplied.latestResume && (
                <button type="button" className="jt-btn-ghost" onClick={() => openResume(alreadyApplied.latestResume)}>
                  <Eye size={14} /> View resume
                </button>
              )}
              {alreadyApplied.jobId && (
                <button
                  type="button"
                  className="jt-btn-primary"
                  onClick={() => {
                    const target = alreadyApplied;
                    setAlreadyApplied(null);
                    navigate(`/dashboard/apply/${target.jobId}?stage=apply`);
                  }}
                >
                  Open application <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
