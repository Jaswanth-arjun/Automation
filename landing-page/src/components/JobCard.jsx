import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Clock, Bookmark, ArrowRight, ExternalLink } from 'lucide-react';
import MatchScore from './MatchScore';
import ApplyOptionsModal from './ApplyOptionsModal';

export default function JobCard({ job, matchResult, saved, onSave }) {
  const navigate = useNavigate();
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const score = matchResult?.score ?? job.matchScore ?? 0;
  const isAdmin = job.source === 'admin';

  const handleApply = () => {
    setApplyModalOpen(true);
  };

  return (
    <>
      <article className="job-card">
        <div className="job-card-header">
          {job.companyLogoUrl ? (
            <img
              src={job.companyLogoUrl}
              alt={job.company}
              style={{ width: '38px', height: '38px', borderRadius: '10px', objectFit: 'cover', border: '1px solid #e5e5e0', flexShrink: 0 }}
            />
          ) : (
            <div className="job-card-company-mark">{job.companyMark || job.company?.[0] || '?'}</div>
          )}
          <div className="job-card-meta">
            <h3 className="job-card-title">{job.title}</h3>
            <p className="job-card-company">{job.company}</p>
          </div>
          <button className={`job-card-save ${saved ? 'saved' : ''}`} onClick={() => onSave?.(job.id)} title="Save job">
            <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="job-card-details">
          <span><MapPin size={13} /> {job.location}</span>
          <span><Clock size={13} /> {job.experienceLabel || `${job.experienceMin || 0}–${job.experienceMax || 0} years`}</span>
        </div>

        {/* Category badge for admin jobs */}
        {isAdmin && job.category && (
          <div style={{ marginBottom: '8px' }}>
            <span style={{
              display: 'inline-block', fontSize: '10px', fontWeight: '700',
              padding: '2px 10px', borderRadius: '20px',
              background: job.category === 'Remote' ? '#e8f5e9' : job.category === 'Freshers' ? '#eef0ff' : '#fff3e0',
              color: job.category === 'Remote' ? '#2e7d32' : job.category === 'Freshers' ? '#445cf5' : '#e65100',
            }}>
              {job.category}
            </span>
          </div>
        )}

        <div className="job-card-skills">
          {(job.skills || job.requiredSkills || []).slice(0, 4).map(s => (
            <span key={s} className="skill-tag">{s}</span>
          ))}
        </div>

        <div className="job-card-bottom">
          <MatchScore score={score} explanation={matchResult?.explanation} size="small" />
          <div className="job-card-actions">
            <button className="btn-ghost" onClick={() => navigate(`/dashboard/jobs/${job.id}`)}>
              View <ArrowRight size={14} />
            </button>
            <button className="btn-accent" onClick={handleApply}>
              Apply <ExternalLink size={12} style={{ marginLeft: '2px' }} />
            </button>
          </div>
        </div>

        {job.postedDaysAgo !== undefined && (
          <span className="job-card-posted">
            Posted {job.postedDaysAgo === 0 ? 'today' : job.postedDaysAgo === 1 ? 'yesterday' : `${job.postedDaysAgo} days ago`}
          </span>
        )}
      </article>

      <ApplyOptionsModal
        job={job}
        isOpen={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
      />
    </>
  );
}

