import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Clock, Building, Bookmark, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import MatchScore from '../components/MatchScore';
import ApplyOptionsModal from '../components/ApplyOptionsModal';
import { DEMO_JOBS } from '../lib/mockData';
import { adminJobStore } from '../lib/adminJobStore';
import { profileStore } from '../lib/api';
import { calculateMatchScore } from '../lib/matchScore';

function renderFormattedDescription(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} style={{ fontSize: '16px', fontWeight: '700', color: '#171817', margin: '22px 0 10px', borderBottom: '1px solid #eee', paddingBottom: '6px' }}>
          {line.replace('## ', '')}
        </h3>
      );
    } else if (line.startsWith('# ')) {
      elements.push(
        <h2 key={i} style={{ fontSize: '18px', fontWeight: '800', color: '#171817', margin: '20px 0 10px' }}>
          {line.replace('# ', '')}
        </h2>
      );
    } else if (line.startsWith('• ') || line.startsWith('- ')) {
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '8px', margin: '5px 0', paddingLeft: '8px', fontSize: '14px', lineHeight: '1.7', color: '#333' }}>
          <span style={{ color: '#445cf5', fontWeight: 'bold' }}>•</span>
          <span>{line.replace(/^[•\-]\s*/, '')}</span>
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: '10px' }} />);
    } else {
      elements.push(
        <p key={i} style={{ fontSize: '14px', lineHeight: '1.7', color: '#333', margin: '5px 0' }}>
          {line}
        </p>
      );
    }
  }
  return elements;
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [adminJobs, setAdminJobs] = useState(() => adminJobStore.getWithFreshDates());

  useEffect(() => {
    // Sync backend on mount
    adminJobStore.syncWithBackend();

    const handleUpdate = () => {
      setAdminJobs(adminJobStore.getWithFreshDates());
    };

    window.addEventListener('admin_jobs_updated', handleUpdate);
    return () => window.removeEventListener('admin_jobs_updated', handleUpdate);
  }, []);

  const allJobs = useMemo(() => [...adminJobs, ...DEMO_JOBS], [adminJobs]);
  const job = useMemo(() => allJobs.find(j => j.id === id), [allJobs, id]);

  const profile = useMemo(() => profileStore.get() || {}, []);
  const matchResult = useMemo(() => {
    if (!job) return { score: 0, explanation: '', matched: [], missing: [] };
    return calculateMatchScore(profile, job);
  }, [profile, job]);

  const isAdmin = job?.source === 'admin';

  const handleApply = () => {
    setApplyModalOpen(true);
  };

  if (!job) {
    return (
      <div className="page-job-detail">
        <button className="btn-ghost" onClick={() => navigate('/dashboard/jobs')}><ArrowLeft size={16} /> Back to jobs</button>
        <div className="empty-state">
          <h3>Job not found</h3>
          <p>This job listing may have been removed or is loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-job-detail">
      <button className="btn-ghost back-btn" onClick={() => navigate('/dashboard/jobs')}>
        <ArrowLeft size={16} /> Back to jobs
      </button>

      <div className="job-detail-layout">
        <div className="job-detail-main">
          <div className="job-detail-header">
            {job.companyLogoUrl ? (
              <img src={job.companyLogoUrl} alt={job.company} style={{ width: '52px', height: '52px', borderRadius: '12px', objectFit: 'cover', border: '1px solid #e5e5e0', flexShrink: 0 }} />
            ) : (
              <div className="job-card-company-mark large">{job.companyMark || job.company?.[0] || '?'}</div>
            )}
            <div>
              <h1>{job.title}</h1>
              <p className="job-detail-company">{job.company}</p>
            </div>
          </div>

          <div className="job-detail-meta">
            <span><MapPin size={15} /> {job.location}</span>
            <span><Clock size={15} /> {job.experienceLabel}</span>
            <span><Building size={15} /> {job.type}</span>
            {isAdmin && job.category && (
              <span style={{
                fontSize: '11px', fontWeight: '700', padding: '3px 12px', borderRadius: '20px',
                background: job.category === 'Remote' ? '#e8f5e9' : job.category === 'Freshers' ? '#eef0ff' : '#fff3e0',
                color: job.category === 'Remote' ? '#2e7d32' : job.category === 'Freshers' ? '#445cf5' : '#e65100',
              }}>
                {job.category}
              </span>
            )}
          </div>

          {/* Must have / Good to have skills header (for admin jobs) */}
          {isAdmin && (
            <div style={{ margin: '16px 0', padding: '16px', background: '#fafaf7', borderRadius: '10px', border: '1px solid #eee' }}>
              {job.requiredSkills?.length > 0 && (
                <div style={{ marginBottom: '6px', fontSize: '13px' }}>
                  <strong style={{ color: '#171817' }}>Must have skills : </strong>
                  <span style={{ color: '#555' }}>{job.requiredSkills.join(', ')}</span>
                </div>
              )}
              {job.preferredSkills?.length > 0 && (
                <div style={{ fontSize: '13px' }}>
                  <strong style={{ color: '#171817' }}>Good to have skills : </strong>
                  <span style={{ color: '#555' }}>{job.preferredSkills.join(', ')}</span>
                </div>
              )}
            </div>
          )}

          {/* Description — rendered with formatting for admin jobs, plain for demo */}
          <section className="job-section">
            <h3>Description</h3>
            {isAdmin ? (
              <div>{renderFormattedDescription(job.description)}</div>
            ) : (
              <p>{job.description}</p>
            )}
          </section>

          {/* Standard sections for demo jobs */}
          {!isAdmin && job.responsibilities?.length > 0 && (
            <section className="job-section">
              <h3>Responsibilities</h3>
              <ul>{job.responsibilities.map(r => <li key={r}>{r}</li>)}</ul>
            </section>
          )}

          {!isAdmin && job.qualifications?.length > 0 && (
            <section className="job-section">
              <h3>Qualifications</h3>
              <ul>{job.qualifications.map(q => <li key={q}>{q}</li>)}</ul>
            </section>
          )}

          {!isAdmin && (
            <>
              <section className="job-section">
                <h3>Required Skills</h3>
                <div className="job-card-skills">{job.requiredSkills?.map(s => <span key={s} className="skill-tag">{s}</span>)}</div>
              </section>

              {job.preferredSkills?.length > 0 && (
                <section className="job-section">
                  <h3>Preferred Skills</h3>
                  <div className="job-card-skills">{job.preferredSkills.map(s => <span key={s} className="skill-tag secondary">{s}</span>)}</div>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="job-detail-sidebar">
          <div className="match-detail-card">
            <h3>Match Score</h3>
            <MatchScore score={matchResult.score} explanation={matchResult.explanation} size="normal" />
            {matchResult.matched?.length > 0 && (
              <div className="match-list">
                <h4><CheckCircle size={14} /> Matched</h4>
                <div className="job-card-skills">{matchResult.matched.map(s => <span key={s} className="skill-tag matched">{s}</span>)}</div>
              </div>
            )}
            {matchResult.missing?.length > 0 && (
              <div className="match-list">
                <h4><XCircle size={14} /> Missing</h4>
                <div className="job-card-skills">{matchResult.missing.map(s => <span key={s} className="skill-tag missing">{s}</span>)}</div>
              </div>
            )}
          </div>

          <div className="job-detail-actions">
            <button className="btn-accent full" onClick={handleApply}>
              Apply Now <ExternalLink size={14} style={{ marginLeft: '4px' }} />
            </button>
            <button className="btn-ghost full"><Bookmark size={16} /> Save Job</button>
          </div>
        </aside>
      </div>

      {/* Apply Options Modal */}
      <ApplyOptionsModal
        job={job}
        isOpen={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
      />
    </div>
  );
}

