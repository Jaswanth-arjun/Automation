/**
 * Admin Job Store — localStorage + backend API synchronization.
 */
const STORAGE_KEY = 'hamzo_admin_jobs';

export const adminJobStore = {
  getAll() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  /** Normalize backend API job object to React frontend job shape */
  normalizeBackendJob(apiJob) {
    const filters = apiJob.filters || {};
    const mustHave = apiJob.mustHaveSkills || [];
    const goodToHave = apiJob.goodToHaveSkills || [];
    const allSkills = [...mustHave, ...goodToHave];

    let postedDaysAgo = 0;
    if (apiJob.postedAt) {
      const created = new Date(apiJob.postedAt);
      const diffMs = Date.now() - created;
      postedDaysAgo = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }

    return {
      id: apiJob.id || 'api_' + Math.random().toString(36).slice(2),
      title: apiJob.role || apiJob.title || 'Software Engineer',
      company: apiJob.company || 'Unknown Company',
      companyLogoUrl: apiJob.logo || '',
      location: filters.workMode === 'Remote' ? 'Remote' : 'India',
      category: filters.experience || filters.visibility || 'Freshers',
      experienceLabel: '0–1 years',
      experienceMin: 0,
      experienceMax: 1,
      type: filters.type || 'Full Time',
      applyLink: apiJob.applyLink || '',
      requiredSkills: mustHave,
      preferredSkills: goodToHave,
      skills: allSkills.length ? allSkills : ['Software Development'],
      description: apiJob.description || '',
      createdAt: apiJob.postedAt || new Date().toISOString(),
      postedDaysAgo,
      source: 'admin',
    };
  },

  /** Fetch jobs from backend /api/jobs and merge into local store */
  async syncWithBackend() {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) return;
      const apiJobs = await res.json();
      if (!Array.isArray(apiJobs)) return;

      const normalizedApiJobs = apiJobs.map(j => this.normalizeBackendJob(j));
      const localJobs = this.getAll();

      // Merge backend jobs into local store, deduplicating by ID or (title+company)
      const existingIds = new Set(localJobs.map(j => j.id));
      const existingKeys = new Set(localJobs.map(j => `${(j.title||'').toLowerCase().trim()}-${(j.company||'').toLowerCase().trim()}`));

      let addedAny = false;
      normalizedApiJobs.forEach(serverJob => {
        const key = `${(serverJob.title||'').toLowerCase().trim()}-${(serverJob.company||'').toLowerCase().trim()}`;
        if (!existingIds.has(serverJob.id) && !existingKeys.has(key)) {
          localJobs.unshift(serverJob);
          existingIds.add(serverJob.id);
          existingKeys.add(key);
          addedAny = true;
        }
      });

      if (addedAny) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localJobs));
        window.dispatchEvent(new Event('admin_jobs_updated'));
      }
    } catch (err) {
      console.warn('Backend sync failed:', err.message);
    }
  },

  add(job) {
    const all = this.getAll();
    const newJob = {
      ...job,
      id: 'admin_' + Date.now().toString(),
      createdAt: new Date().toISOString(),
      postedDaysAgo: 0,
      source: 'admin',
    };
    all.unshift(newJob);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event('admin_jobs_updated'));

    // Also post to backend /api/jobs
    fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logo: job.companyLogoUrl || '',
        role: job.title,
        company: job.company,
        filters: {
          experience: job.category || 'Freshers',
          visibility: 'Confidential',
          workMode: job.location.includes('Remote') ? 'Remote' : 'India',
          type: job.type || 'Full Time',
        },
        mustHaveSkills: job.requiredSkills || [],
        goodToHaveSkills: job.preferredSkills || [],
        applyLink: job.applyLink || '',
        description: job.description || '',
      }),
    }).catch(() => {});

    return newJob;
  },

  remove(id) {
    const all = this.getAll().filter(j => j.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event('admin_jobs_updated'));

    // Also delete from backend /api/jobs if applicable
    fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    return all;
  },

  update(id, updates) {
    const all = this.getAll().map(j => j.id === id ? { ...j, ...updates } : j);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event('admin_jobs_updated'));
    return all;
  },

  getWithFreshDates() {
    const now = new Date();
    return this.getAll().map(j => {
      if (j.createdAt) {
        const created = new Date(j.createdAt);
        const diffMs = now - created;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return { ...j, postedDaysAgo: diffDays };
      }
      return j;
    });
  }
};

// Initial sync on module load
adminJobStore.syncWithBackend();

