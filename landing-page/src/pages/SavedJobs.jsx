import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Search, ArrowRight, X } from 'lucide-react';
import JobCard from '../components/JobCard';
import EmptyState from '../components/EmptyState';
import { DEMO_JOBS } from '../lib/mockData';
import { adminJobStore } from '../lib/adminJobStore';
import { profileStore } from '../lib/api';
import { computeJobScores } from '../lib/matchScore';
import { savedJobsStore } from '../lib/savedJobsStore';

export default function SavedJobs() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [savedJobIds, setSavedJobIds] = useState(() => savedJobsStore.get());
  const [adminJobs, setAdminJobs] = useState(() => adminJobStore.getWithFreshDates());

  const profile = profileStore.get();

  useEffect(() => {
    adminJobStore.syncWithBackend();
    const refreshJobs = () => setAdminJobs(adminJobStore.getWithFreshDates());
    const refreshSaved = () => setSavedJobIds(savedJobsStore.get());

    window.addEventListener('admin_jobs_updated', refreshJobs);
    window.addEventListener('saved_jobs_updated', refreshSaved);
    window.addEventListener('storage', refreshSaved);

    return () => {
      window.removeEventListener('admin_jobs_updated', refreshJobs);
      window.removeEventListener('saved_jobs_updated', refreshSaved);
      window.removeEventListener('storage', refreshSaved);
    };
  }, []);

  const allJobs = useMemo(() => [...adminJobs, ...DEMO_JOBS], [adminJobs]);
  const scoredJobs = useMemo(() => computeJobScores(profile || {}, allJobs), [profile, allJobs]);

  const savedJobs = useMemo(() => {
    const idSet = new Set(savedJobIds);
    let list = scoredJobs.filter((job) => idSet.has(job.id));

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          j.location.toLowerCase().includes(q) ||
          (j.skills || []).some((s) => s.toLowerCase().includes(q))
      );
    }

    // Deduplicate by title + company
    const seen = new Set();
    list = list.filter((j) => {
      const key = `${j.title.toLowerCase().trim()}-${j.company.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return list;
  }, [scoredJobs, savedJobIds, search]);

  const handleToggleSave = (id) => {
    savedJobsStore.toggle(id);
  };

  return (
    <div className="page-jobs">
      <header className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: '#fff7ed',
              border: '1px solid #ffedd5',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ea580c',
            }}
          >
            <Bookmark size={18} fill="currentColor" />
          </div>
          <div>
            <h1 style={{ margin: 0 }}>Saved Jobs</h1>
            <p style={{ margin: '2px 0 0', color: 'var(--muted)', fontSize: '13px' }}>
              {savedJobs.length} {savedJobs.length === 1 ? 'saved opportunity' : 'saved opportunities'}
            </p>
          </div>
        </div>
      </header>

      {savedJobIds.length > 0 && (
        <div className="jobs-toolbar" style={{ marginTop: '20px' }}>
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search saved jobs by role, company, skill…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {savedJobIds.length === 0 ? (
        <div style={{ marginTop: '30px' }}>
          <EmptyState
            icon={Bookmark}
            title="No saved jobs yet"
            description="When you find an opportunity in Top Matches or the Jobs catalog, click the bookmark icon to save it for later."
            actionLabel="Explore Jobs"
            onAction={() => navigate('/dashboard/jobs')}
          />
        </div>
      ) : savedJobs.length === 0 ? (
        <div style={{ marginTop: '30px' }}>
          <EmptyState
            icon={Search}
            title="No matches found"
            description="None of your saved jobs matched your search criteria."
            actionLabel="Clear search"
            onAction={() => setSearch('')}
          />
        </div>
      ) : (
        <div className="jobs-grid" style={{ marginTop: '20px' }}>
          {savedJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              matchResult={job.matchResult}
              saved={true}
              onSave={handleToggleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}
