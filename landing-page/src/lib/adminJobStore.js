/**
 * Admin Job Store — localStorage + backend API synchronization.
 * Authoritative source: Backend API (/api/jobs).
 */
const STORAGE_KEY = 'hamzo_admin_jobs';

export const adminJobStore = {
  getAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
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
      id: String(apiJob.id || 'api_' + Math.random().toString(36).slice(2)),
      title: apiJob.role || apiJob.title || 'Software Engineer',
      company: apiJob.company || 'Unknown Company',
      companyLogoUrl: apiJob.logo || '',
      location: (filters.workMode === 'Remote' || String(apiJob.location || '').toLowerCase().includes('remote'))
        ? 'Remote'
        : (apiJob.location || 'India'),
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

  /** Fetch jobs from backend /api/jobs and sync with local store (including deletions) */
  async syncWithBackend() {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) return;
      const apiJobs = await res.json();
      if (!Array.isArray(apiJobs)) return;

      const serverJobs = apiJobs.map((j) => this.normalizeBackendJob(j));
      const currentLocal = this.getAll();

      // Check if serverJobs differ from currentLocal (added, deleted, or changed)
      const serverIds = new Set(serverJobs.map((j) => String(j.id)));
      const localIds = new Set(currentLocal.map((j) => String(j.id)));

      const hasChanged =
        serverJobs.length !== currentLocal.length ||
        serverJobs.some((j) => !localIds.has(String(j.id))) ||
        currentLocal.some((j) => !serverIds.has(String(j.id)));

      if (hasChanged) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serverJobs));
        window.dispatchEvent(new Event('admin_jobs_updated'));

        // Prune deleted jobs from saved jobs if needed
        try {
          const savedKey = 'wayin_saved_jobs';
          const saved = JSON.parse(localStorage.getItem(savedKey) || '[]');
          const pruned = saved.filter((id) => serverIds.has(String(id)));
          if (pruned.length !== saved.length) {
            localStorage.setItem(savedKey, JSON.stringify(pruned));
            window.dispatchEvent(new CustomEvent('saved_jobs_updated', { detail: pruned }));
          }
        } catch {}
      }

      return serverJobs;
    } catch (err) {
      console.warn('Backend sync failed:', err.message);
    }
  },

  async add(job) {
    const payload = {
      logo: job.companyLogoUrl || '',
      role: job.title,
      company: job.company,
      filters: {
        experience: job.category || 'Freshers',
        visibility: 'Confidential',
        workMode: (job.location || '').includes('Remote') ? 'Remote' : (job.location || 'India'),
        type: job.type || 'Full Time',
      },
      mustHaveSkills: job.requiredSkills || [],
      goodToHaveSkills: job.preferredSkills || [],
      applyLink: job.applyLink || '',
      description: job.description || '',
    };

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        const serverJob = data.job || data;
        const normalized = this.normalizeBackendJob(serverJob);

        const all = this.getAll().filter((j) => String(j.id) !== String(normalized.id));
        all.unshift(normalized);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        window.dispatchEvent(new Event('admin_jobs_updated'));
        return normalized;
      }
    } catch (err) {
      console.warn('Backend post failed:', err);
    }

    // Local fallback if offline
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
    return newJob;
  },

  async remove(id) {
    const stringId = String(id);
    const current = this.getAll();
    const target = current.find((j) => String(j.id) === stringId);
    const remaining = current.filter((j) => String(j.id) !== stringId);

    // 1. Immediately update localStorage and notify all UI components
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    window.dispatchEvent(new Event('admin_jobs_updated'));

    // 2. Also remove from savedJobsStore if saved
    try {
      const savedKey = 'wayin_saved_jobs';
      const saved = JSON.parse(localStorage.getItem(savedKey) || '[]');
      if (saved.includes(id)) {
        const nextSaved = saved.filter((x) => String(x) !== stringId);
        localStorage.setItem(savedKey, JSON.stringify(nextSaved));
        window.dispatchEvent(new CustomEvent('saved_jobs_updated', { detail: nextSaved }));
      }
    } catch {}

    // 3. Delete from backend API
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(stringId)}`, { method: 'DELETE' });
      if (!res.ok && target) {
        // Fallback delete by title-company key
        const key = `${(target.title || '').toLowerCase().trim()}-${(target.company || '').toLowerCase().trim()}`;
        await fetch(`/api/jobs/${encodeURIComponent(key)}`, { method: 'DELETE' });
      }
    } catch (err) {
      console.warn('Backend delete failed:', err);
    }

    return remaining;
  },

  update(id, updates) {
    const stringId = String(id);
    const all = this.getAll().map((j) => (String(j.id) === stringId ? { ...j, ...updates } : j));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event('admin_jobs_updated'));
    return all;
  },

  getWithFreshDates() {
    const now = new Date();
    return this.getAll().map((j) => {
      if (j.createdAt) {
        const created = new Date(j.createdAt);
        const diffMs = now - created;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return { ...j, postedDaysAgo: diffDays };
      }
      return j;
    });
  },
};

// Initial sync on module load
adminJobStore.syncWithBackend();

// Auto sync on tab focus and periodic background sync (every 3s)
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    adminJobStore.syncWithBackend();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      window.dispatchEvent(new Event('admin_jobs_updated'));
    }
  });

  setInterval(() => {
    adminJobStore.syncWithBackend();
  }, 3000);
}
