import React, { useState, useMemo, useEffect } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import JobCard from '../components/JobCard';
import EmptyState from '../components/EmptyState';
import { DEMO_JOBS } from '../lib/mockData';
import { adminJobStore } from '../lib/adminJobStore';
import { profileStore } from '../lib/api';
import { computeJobScores } from '../lib/matchScore';

const JOB_TYPES = ['All', 'Full Time', 'Internship', 'Part Time', 'Contract'];

export default function Jobs() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [sortBy, setSortBy] = useState('match');
  const [savedJobs, setSavedJobs] = useState(() => {
    const s = localStorage.getItem('wayin_saved_jobs');
    return s ? JSON.parse(s) : [];
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adminJobs, setAdminJobs] = useState(() => adminJobStore.getWithFreshDates());

  const profile = profileStore.get();

  // Listen for admin job updates and sync with backend API
  useEffect(() => {
    adminJobStore.syncWithBackend();
    const refresh = () => setAdminJobs(adminJobStore.getWithFreshDates());
    window.addEventListener('admin_jobs_updated', refresh);
    return () => window.removeEventListener('admin_jobs_updated', refresh);
  }, []);

  // Merge admin jobs + demo jobs (admin first)
  const allJobs = useMemo(() => [...adminJobs, ...DEMO_JOBS], [adminJobs]);

  const scoredJobs = useMemo(() => computeJobScores(profile || {}, allJobs), [profile, allJobs]);

  const filtered = useMemo(() => {
    let list = scoredJobs;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(j =>
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        j.location.toLowerCase().includes(q) ||
        (j.skills || []).some(s => s.toLowerCase().includes(q))
      );
    }

    if (typeFilter !== 'All') {
      list = list.filter(j => j.type === typeFilter);
    }

    if (sortBy === 'match') {
      list = [...list].sort((a, b) => (b.matchResult?.score || 0) - (a.matchResult?.score || 0));
    } else if (sortBy === 'recent') {
      list = [...list].sort((a, b) => (a.postedDaysAgo || 99) - (b.postedDaysAgo || 99));
    }

    // Deduplicate by title + company
    const seen = new Set();
    list = list.filter(j => {
      const key = `${j.title.toLowerCase().trim()}-${j.company.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return list;
  }, [scoredJobs, search, typeFilter, sortBy]);

  const toggleSave = (id) => {
    const next = savedJobs.includes(id) ? savedJobs.filter(x => x !== id) : [...savedJobs, id];
    setSavedJobs(next);
    localStorage.setItem('wayin_saved_jobs', JSON.stringify(next));
  };

  return (
    <div className="page-jobs">
      <header className="page-header">
        <h1>Jobs</h1>
        <p>{filtered.length} opportunities available</p>
      </header>

      <div className="jobs-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search by role, company, skill…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <button className={`filter-toggle ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)}>
          <SlidersHorizontal size={16} /> Filters
        </button>
      </div>

      {filtersOpen && (
        <div className="jobs-filters">
          <div className="filter-group">
            <label>Job Type</label>
            <div className="filter-chips">
              {JOB_TYPES.map(t => (
                <button key={t} className={`chip ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <label>Sort By</label>
            <div className="filter-chips">
              <button className={`chip ${sortBy === 'match' ? 'active' : ''}`} onClick={() => setSortBy('match')}>Best Match</button>
              <button className={`chip ${sortBy === 'recent' ? 'active' : ''}`} onClick={() => setSortBy('recent')}>Most Recent</button>
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No jobs found"
          description="Try adjusting your search or filters."
          actionLabel="Clear filters"
          onAction={() => { setSearch(''); setTypeFilter('All'); }}
        />
      ) : (
        <div className="jobs-grid">
          {filtered.map(job => (
            <JobCard
              key={job.id}
              job={job}
              matchResult={job.matchResult}
              saved={savedJobs.includes(job.id)}
              onSave={toggleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}
