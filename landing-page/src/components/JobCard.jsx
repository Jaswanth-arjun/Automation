import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bookmark } from 'lucide-react';
import MatchScore from './MatchScore';
import ApplyOptionsModal from './ApplyOptionsModal';

export default function JobCard({ job, matchResult, saved, onSave }) {
  const navigate = useNavigate();
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Score from computed matchResult or job
  const score = matchResult?.status === 'scored' || matchResult?.status === 'ineligible'
    ? matchResult.score
    : (matchResult?.score ?? job.matchScore ?? null);

  const handleApply = (e) => {
    e.stopPropagation();
    setApplyModalOpen(true);
  };

  const handleSave = (e) => {
    e.stopPropagation();
    onSave?.(job.id);
  };

  return (
    <>
      <article
        className="match-card"
        onClick={() => navigate(`/dashboard/jobs/${job.id}`)}
      >
        <div className="match-card-header-row">
          {job.companyLogoUrl && !imgError ? (
            <img
              src={job.companyLogoUrl}
              alt=""
              onError={() => setImgError(true)}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '11px',
                objectFit: 'contain',
                background: '#fff',
                border: '1px solid #e5e5e0',
                flexShrink: 0,
                padding: '4px',
              }}
            />
          ) : (
            <div className="job-card-company-mark">
              {job.companyMark || job.company?.[0]?.toUpperCase() || 'J'}
            </div>
          )}
          <MatchScore score={score} size="small" />
        </div>

        <div className="match-card-body">
          <h4 title={job.title}>{job.title}</h4>
          <p>{job.company} · {job.location || 'Remote'}</p>
        </div>

        <div className="match-card-actions">
          <button
            type="button"
            className="match-card-apply-btn"
            onClick={handleApply}
          >
            Apply <ArrowRight size={13} />
          </button>
          <button
            type="button"
            className={`match-card-save-btn ${saved ? 'saved' : ''}`}
            onClick={handleSave}
            title={saved ? 'Remove from saved' : 'Save job'}
            aria-label="Save job"
          >
            <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />
          </button>
        </div>
      </article>

      <ApplyOptionsModal
        job={job}
        isOpen={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
      />
    </>
  );
}
