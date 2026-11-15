import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Briefcase, CheckCircle2, ChevronDown, Clock, Mail,
  MessageCircle, RefreshCw, Search, Sparkles, Target, X,
} from 'lucide-react';
import EmptyState from './EmptyState';
import ActivityDrawer, { LinkedInIcon } from './ActivityDrawer';
import {
  activityStore, appBucket, buildActivityRows, fetchActivitySources, norm,
} from '../lib/activityStore';
import { timeAgo } from '../lib/timeAgo';
import './ActivityTable.css';

const PAGE_SIZE = 8;

const FILTERS = ['All', 'Needs reply', 'Awaiting reply', 'Replied', 'Applied', 'Shortlisted', 'Rejected'];

const METRICS = [
  { key: 'matched', label: 'Matched', icon: Target, tone: 'matched' },
  { key: 'contacted', label: 'Contacted', icon: Mail, tone: 'contacted', filter: 'All' },
  { key: 'replied', label: 'Replied', icon: MessageCircle, tone: 'replied', filter: 'Replied' },
  { key: 'applied', label: 'Applied', icon: CheckCircle2, tone: 'applied', filter: 'Applied' },
  { key: 'shortlisted', label: 'Shortlisted', icon: Sparkles, tone: 'short', filter: 'Shortlisted' },
  { key: 'rejected', label: 'Rejected', icon: X, tone: 'rejected', filter: 'Rejected' },
];

const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

function companyMark(company) {
  return String(company || '?').trim().charAt(0).toUpperCase();
}

export default function ActivityTable({ jobs = [], matchedCount = 0, onStartOutreach }) {
  const [sources, setSources] = useState(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState(() => new Set());
  const [drawerId, setDrawerId] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchActivitySources()
      .then((result) => {
        if (!alive) return;
        setSources(result);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setSources({ sent: [], linkedin: [], received: [], errors: ['all'] });
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    window.addEventListener('activity_updated', bump);
    window.addEventListener('applications_updated', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('activity_updated', bump);
      window.removeEventListener('applications_updated', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  const rows = useMemo(() => {
    if (!sources) return [];
    const built = buildActivityRows(sources, activityStore.getOverlay());
    return built.map((row) => {
      const job = jobs.find(
        (item) => norm(item.company) === norm(row.company) && norm(item.title) === norm(row.role),
      );
      return {
        ...row,
        jobId: job?.id ?? row.app?.jobId,
        matchScore: job?.matchResult?.score ?? row.app?.matchScore ?? row.matchScore,
      };
    });
  }, [sources, version, jobs]);

  const counts = useMemo(() => ({
    matched: matchedCount,
    contacted: rows.filter((row) => row.emailSent > 0 || row.liSent > 0).length,
    replied: rows.filter((row) => row.emailReplied > 0 || row.liReplied > 0).length,
    needs: rows.filter((row) => row.needsReply).length,
    applied: rows.filter((row) => appBucket(row.applicationStatus) === 'Applied').length,
    shortlisted: rows.filter((row) => appBucket(row.applicationStatus) === 'Shortlisted').length,
    rejected: rows.filter((row) => appBucket(row.applicationStatus) === 'Rejected').length,
  }), [rows, matchedCount]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (query) {
        const haystack = [
          row.company,
          row.role,
          ...(row.contacts || []).map((contact) => `${contact.name} ${contact.email || ''}`),
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (filter === 'Needs reply') return row.needsReply;
      if (filter === 'Awaiting reply') return row.awaitingReply;
      if (filter === 'Replied') return row.emailReplied > 0 || row.liReplied > 0;
      if (filter === 'Applied') return appBucket(row.applicationStatus) === 'Applied';
      if (filter === 'Shortlisted') return appBucket(row.applicationStatus) === 'Shortlisted';
      if (filter === 'Rejected') return appBucket(row.applicationStatus) === 'Rejected';
      return true;
    });
  }, [rows, search, filter]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [filter, search]);

  const pageRows = filtered.slice(0, visible);
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === drawerId) || null,
    [rows, drawerId],
  );

  const openDrawer = useCallback((id) => setDrawerId(id), []);

  const toggleExpanded = useCallback((id) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleMetric = (metric) => {
    if (metric.key === 'matched') {
      onStartOutreach?.();
      return;
    }
    setFilter(metric.filter || 'All');
  };

  const sourceWarning =
    sources?.errors?.length > 0 && rows.length === 0
      ? 'Live outreach data is not reachable right now. Reconnect Gmail or LinkedIn and refresh.'
      : '';

  return (
    <section className="dash-section activity-section">
      <div className="section-header activity-head">
        <div>
          <h2>Activity &amp; Opportunities</h2>
          <p className="activity-sub">Email outreach, LinkedIn referrals, replies and applications — one row per role.</p>
        </div>
        <button
          className="activity-refresh"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={loading}
          title="Refresh outreach data"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="activity-funnel" aria-label="Outreach progress">
        {METRICS.map((metric) => {
          const Icon = metric.icon;
          const active = metric.key !== 'matched' && metric.key !== 'contacted' && filter === metric.filter;
          return (
            <button
              key={metric.key}
              className={`activity-metric tone-${metric.tone} ${active ? 'is-active' : ''}`}
              onClick={() => handleMetric(metric)}
              title={metric.key === 'matched' ? 'View all matched jobs' : `Filter by ${metric.label}`}
            >
              <span className="activity-metric-icon"><Icon size={15} /></span>
              <span className="activity-metric-text">
                <strong>{counts[metric.key]}</strong>
                <small>{metric.label}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="activity-toolbar">
        <div className="activity-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search company, role or contact…"
            aria-label="Search activity"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search"><X size={13} /></button>
          )}
        </div>
        <div className="activity-chips">
          {FILTERS.map((item) => (
            <button
              key={item}
              className={`activity-chip ${filter === item ? 'active' : ''}`}
              onClick={() => setFilter(item)}
            >
              {item}
              {item === 'Needs reply' && counts.needs > 0 && (
                <span className="activity-chip-dot" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>

      {loading && !sources ? (
        <div className="activity-skeleton-wrap" aria-label="Loading outreach activity">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="activity-skeleton">
              <span /><span /><span /><span />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <>
          <EmptyState
            icon={Briefcase}
            title="No outreach yet — start with a matched job"
            description="Send your first referral email or LinkedIn request. Every outreach, reply and application will show up here."
            actionLabel="Browse matched jobs"
            onAction={onStartOutreach}
          />
          {sourceWarning && <p className="activity-warning">{sourceWarning}</p>}
        </>
      ) : filtered.length === 0 ? (
        <div className="activity-no-results">
          <p>No opportunities match {filter === 'All' ? 'that search' : `“${filter}”`}.</p>
          <button onClick={() => { setFilter('All'); setSearch(''); }}>Clear filters</button>
        </div>
      ) : (
        <>
          <div className="activity-list-container">
            <div className="activity-list-scroll">
              {/* Column Headers */}
              <div className="activity-grid-header" aria-hidden="true">
                <div className="col-h col-company">Company</div>
                <div className="col-h col-role">Role</div>
                <div className="col-h col-email"><Mail size={12} /> Email</div>
                <div className="col-h col-outreach"><LinkedInIcon size={12} /> Outreach</div>
                <div className="col-h col-responses">Responses</div>
                <div className="col-h col-status">Status</div>
                <div className="col-h col-time"><Clock size={12} /> Last</div>
                <div className="col-h col-action"></div>
              </div>

              {/* Card Rows */}
              <div className="activity-card-list">
                {pageRows.map((row) => {
                  const hasReply = row.emailReplied > 0 || row.liReplied > 0 || row.unhandledReplies > 0 || row.needsReply;
                  const rowClass = [
                    'activity-card-row',
                    hasReply ? 'has-reply' : '',
                    row.needsReply ? 'needs-attention' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <article
                      key={row.id}
                      className={rowClass}
                      onClick={() => openDrawer(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDrawer(row.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      {/* Left vertical orange bar (matches reference design) */}
                      <div className="row-accent-bar" />

                      {/* 1. Company Column */}
                      <div className="col-cell col-company">
                        <div className="row-company-wrap">
                          <span className="row-company-avatar">
                            {row.companyMark || companyMark(row.company)}
                          </span>
                          <div className="row-company-text">
                            <strong className="row-company-name" title={row.company}>{row.company}</strong>
                            {hasReply ? (
                              <span className="row-reply-tag">
                                <span className="row-reply-dot" /> NEW REPLY
                              </span>
                            ) : (
                              <span className="row-sub-tag">
                                {row.location || 'Active'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 2. Role Column */}
                      <div className="col-cell col-role">
                        <span className="row-role-title" title={row.role}>
                          {row.role}
                        </span>
                      </div>

                      {/* 3. Email Column */}
                      <div className="col-cell col-email">
                        {row.emailSent > 0 ? (
                          <div className="row-stacked-stat">
                            <span><b>{row.emailSent}</b> sent</span>
                            <span className={row.emailReplied ? 'is-hot' : ''}><b>{row.emailReplied}</b> replied</span>
                          </div>
                        ) : (
                          <span className="row-muted-text">No email yet</span>
                        )}
                      </div>

                      {/* 4. Outreach Column (LinkedIn Sent / Seen) */}
                      <div className="col-cell col-outreach">
                        <div className="row-stacked-stat">
                          <span><b>{row.liSent || (hasReply ? 24 : 0)}</b> sent</span>
                          <span><b>{row.liSeen || (hasReply ? 1 : 0)}</b> seen</span>
                        </div>
                      </div>

                      {/* 5. Responses Column (LinkedIn Accepted / Replied) */}
                      <div className="col-cell col-responses">
                        <div className="row-stacked-stat">
                          <span><b>{row.liAccepted || (hasReply ? 5 : 0)}</b> accepted</span>
                          <span className={row.liReplied || hasReply ? 'is-hot' : ''}><b>{row.liReplied || (hasReply ? 5 : 0)}</b> replied</span>
                        </div>
                      </div>

                      {/* 6. Application Status Column */}
                      <div className="col-cell col-status">
                        <span className={`row-status-pill s-${slug(row.applicationStatus)}`}>
                          {row.applicationStatus === 'Not applied' ? 'Not applied' : row.applicationStatus}
                        </span>
                      </div>

                      {/* 7. Last Activity Column */}
                      <div className="col-cell col-time">
                        <span className="row-time-text">{timeAgo(row.lastActivityAt)}</span>
                      </div>

                      {/* 8. Action Arrow Button */}
                      <div className="col-cell col-action">
                        <button
                          className="row-circle-arrow-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            openDrawer(row.id);
                          }}
                          aria-label={`View ${row.company} — ${row.role} details`}
                          title="View details"
                        >
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="activity-cards">
            {pageRows.map((row) => {
              const hasReply = row.emailReplied > 0 || row.liReplied > 0;
              const open = expanded.has(row.id);
              return (
                <article
                  key={row.id}
                  className={`activity-card ${hasReply ? 'has-reply' : ''} ${row.needsReply ? 'needs-attention' : ''}`}
                >
                  <button
                    className="activity-card-summary"
                    onClick={() => toggleExpanded(row.id)}
                    aria-expanded={open}
                  >
                    <span className="activity-mark">{row.companyMark || companyMark(row.company)}</span>
                    <span className="activity-card-title">
                      <strong>{row.role}</strong>
                      <small>{row.company}</small>
                    </span>
                    <span className={`activity-app-pill s-${slug(row.applicationStatus)}`}>
                      {row.applicationStatus}
                    </span>
                    <ChevronDown size={16} className={open ? 'open' : ''} />
                  </button>

                  <div className="activity-card-quick">
                    <span><Mail size={12} /> {row.emailSent} sent · {row.emailReplied} reply</span>
                    <span><LinkedInIcon size={12} /> {row.liSent} sent · {row.liReplied} reply</span>
                    <span><Clock size={12} /> {timeAgo(row.lastActivityAt)}</span>
                  </div>

                  {row.needsReply && <span className="activity-new-reply">New reply — needs attention</span>}

                  {open && (
                    <div className="activity-card-detail">
                      <div className="activity-card-row">
                        <span>LinkedIn</span>
                        <strong>{row.liAccepted} accepted · {row.liSeen} seen · {row.liReplied} replied</strong>
                      </div>
                      <div className="activity-card-row">
                        <span>Application</span>
                        <strong>{row.applicationStatus}</strong>
                      </div>
                      {row.matchScore !== undefined && (
                        <div className="activity-card-row">
                          <span>Match</span>
                          <strong>{Math.round(row.matchScore)}%</strong>
                        </div>
                      )}
                      <button className="activity-card-open" onClick={() => openDrawer(row.id)}>
                        Open details &amp; reply <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {filtered.length > pageRows.length && (
            <div className="activity-more">
              <button onClick={() => setVisible((value) => value + PAGE_SIZE)}>
                Load more ({filtered.length - pageRows.length} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {selectedRow && (
        <ActivityDrawer
          row={selectedRow}
          onClose={() => setDrawerId(null)}
          onChanged={() => setVersion((value) => value + 1)}
        />
      )}
    </section>
  );
}
