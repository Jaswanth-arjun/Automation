import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, ArrowRight } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import { applicationStore } from '../lib/api';

const STATUS_COLORS = {
  Saved: { bg: '#e8e8e3', color: '#555852' },
  Applied: { bg: '#445cf514', color: '#445cf5' },
  Outreach: { bg: '#8b5cf614', color: '#8b5cf6' },
  Response: { bg: '#0ea5e914', color: '#0ea5e9' },
  Interview: { bg: '#d4920a14', color: '#d4920a' },
  Offer: { bg: '#22a65b14', color: '#22a65b' },
  Rejected: { bg: '#c74a3d14', color: '#c74a3d' },
  Closed: { bg: '#78797614', color: '#787976' },
};

export default function Applications() {
  const navigate = useNavigate();
  const [applications] = useState(() => applicationStore.getAll());
  const [statusFilter, setStatusFilter] = useState('All');

  const filtered = statusFilter === 'All' ? applications : applications.filter(a => a.status === statusFilter);

  return (
    <div className="page-applications">
      <header className="page-header">
        <div>
          <h1>Applications</h1>
          <p>Track every opportunity in one place.</p>
        </div>
      </header>

      {applications.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No applications yet"
          description="Your next opportunity starts here. Explore jobs and submit your first application."
          actionLabel="Explore Jobs"
          onAction={() => navigate('/dashboard/jobs')}
        />
      ) : (
        <>
          <div className="filter-chips" style={{ marginBottom: 24 }}>
            {['All', ...Object.keys(STATUS_COLORS)].map(s => (
              <button key={s} className={`chip ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>{s}</button>
            ))}
          </div>

          <div className="applications-list">
            {filtered.map(app => (
              <article key={app.id} className="application-card">
                <div className="application-card-main">
                  <div className="job-card-company-mark">{app.companyMark || app.company?.[0]}</div>
                  <div className="application-card-info">
                    <strong>{app.title}</strong>
                    <p>{app.company} · Applied {new Date(app.appliedAt).toLocaleDateString()}</p>
                  </div>
                  <span className="status-pill" style={{
                    background: STATUS_COLORS[app.status]?.bg,
                    color: STATUS_COLORS[app.status]?.color,
                  }}>
                    {app.status}
                  </span>
                </div>
                {app.matchScore !== undefined && (
                  <div className="application-card-match">
                    <span>{app.matchScore}% Match</span>
                    {app.resumeUsed && <span>Resume: {app.resumeUsed}</span>}
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
