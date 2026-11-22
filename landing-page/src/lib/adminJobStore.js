/**
 * Admin Job Store — localStorage + backend API synchronization.
 * Authoritative source: Backend API (/api/jobs).
 */
const STORAGE_KEY = 'hamzooh_admin_jobs';

export const adminJobStore = {
  getAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const cleaned = parsed.filter((j) => {
        if (!j) return false;
        const comp = String(j.company || '').toLowerCase().trim();
        const id = String(j.id || '').trim();
        if (id === '1' || id === '2' || id === '3' || id === '4') return false;
        if (
          comp === 'northstar labs' ||
          comp === 'pixelcraft studio' ||
          comp === 'cloudsync technologies' ||
          comp === 'athena ai'
        ) {
          return false;
        }
        return true;
      });
      if (cleaned.length !== parsed.length) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
        } catch {}
      }
      return cleaned;
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

    const locationValue = filters.location || apiJob.location
      || (filters.workMode && filters.workMode !== 'Remote' ? filters.workMode : '')
      || 'India';

    return {
      id: String(apiJob.id || 'api_' + Math.random().toString(36).slice(2)),
      title: apiJob.role || apiJob.title || 'Software Engineer',
      company: apiJob.company || 'Unknown Company',
      companyLogoUrl: apiJob.logo || '',
      location: (filters.workMode === 'Remote' || String(apiJob.location || '').toLowerCase().includes('remote'))
        ? 'Remote'
        : locationValue,
      category: filters.category || filters.experience || filters.visibility || 'Freshers',
      experienceLabel: filters.experienceLabel || '0–1 years',
      experienceMin: Number(filters.experienceMin ?? 0),
      experienceMax: Number(filters.experienceMax ?? 1),
      type: filters.type || 'Full Time',
      applyLink: apiJob.applyLink || '',
      sourceUrl: apiJob.sourceUrl || '',
      postedBy: apiJob.postedBy || null,
      requiredSkills: mustHave,
      preferredSkills: goodToHave,
      skills: allSkills.length ? allSkills : ['Software Development'],
      description: apiJob.description || '',
      jobDetails: Array.isArray(apiJob.jobDetails) ? apiJob.jobDetails : [],
      createdAt: apiJob.postedAt || new Date().toISOString(),
      postedDaysAgo,
      source: 'admin',
    };
  },

  /** Fetch jobs from backend /api/jobs and sync with local store (including deletions) */
  async syncWithBackend() {
    // Several pages and the background poll all call this. Without a guard a
    // single page load fired dozens of identical /api/jobs requests at once.
    if (this._syncing) return this._syncing;
    this._syncing = (async () => {
      try {
        const res = await fetch('/api/jobs');
        if (!res.ok) return;
        const apiJobs = await res.json();
        if (!Array.isArray(apiJobs)) return;

        const serverJobs = apiJobs.map((j) => this.normalizeBackendJob(j));
        const currentLocal = this.getAll();

        // Signature catches added/deleted jobs AND edits (e.g. cleaned
        // descriptions) that keep the same ids — so stale local copies heal.
        const signature = (jobs) => jobs
          .map((j) => `${j.id}:${String(j.description || '').length}:${j.applyLink || ''}`)
          .join('|');
        const hasChanged = signature(serverJobs) !== signature(currentLocal);
        const serverIds = new Set(serverJobs.map((j) => String(j.id)));

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
      } finally {
        this._syncing = null;
      }
    })();
    return this._syncing;
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
        category: job.category || 'Freshers',
        location: job.location || 'India',
        experienceLabel: job.experienceLabel || '0–1 years',
        experienceMin: job.experienceMin ?? 0,
        experienceMax: job.experienceMax ?? 1,
      },
      mustHaveSkills: job.requiredSkills || [],
      goodToHaveSkills: job.preferredSkills || [],
      applyLink: job.applyLink || '',
      description: job.description || '',
      jobDetails: Array.isArray(job.jobDetails) ? job.jobDetails : [],
      sourceUrl: job.sourceUrl || '',
      postedBy: job.postedBy || null,
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

  /**
   * Read a public job link into a structured draft for the admin form.
   * Returns the draft job plus the resolved source URL.
   */
  async importFromLink(url) {
    const res = await fetch('/api/jobs/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok || !data?.job) {
      throw new Error(data?.error || `That job link could not be read (${res.status}).`);
    }
    return data;
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

    // Persist the edit server-side too, so it survives a reload on any device.
    const edited = all.find((j) => String(j.id) === stringId);
    if (edited) {
      fetch(`/api/jobs/${encodeURIComponent(stringId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logo: edited.companyLogoUrl || '',
          role: edited.title,
          company: edited.company,
          filters: {
            experience: edited.category || 'Freshers',
            visibility: 'Confidential',
            workMode: (edited.location || '').includes('Remote') ? 'Remote' : (edited.location || 'India'),
            type: edited.type || 'Full Time',
            category: edited.category || 'Freshers',
            location: edited.location || 'India',
            experienceLabel: edited.experienceLabel || '0–1 years',
            experienceMin: edited.experienceMin ?? 0,
            experienceMax: edited.experienceMax ?? 1,
          },
          mustHaveSkills: edited.requiredSkills || [],
          goodToHaveSkills: edited.preferredSkills || [],
          applyLink: edited.applyLink || '',
          description: edited.description || '',
          jobDetails: Array.isArray(edited.jobDetails) ? edited.jobDetails : [],
          sourceUrl: edited.sourceUrl || '',
        }),
      }).catch((err) => console.warn('Backend job update failed:', err.message));
    }

    return all;
  },

  /** Give ownership of legacy (owner-less) postings to the given user. */
  async claimOwnerless(owner) {
    if (!owner || (!owner.id && !owner.email)) return 0;
    const all = this.getAll();
    const legacy = all.filter((job) => !job.postedBy);
    if (!legacy.length) return 0;

    const next = all.map((job) => (job.postedBy ? job : { ...job, postedBy: owner }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

    await Promise.all(legacy.map((job) =>
      fetch(`/api/jobs/${encodeURIComponent(job.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postedBy: owner }),
      }).catch(() => null),
    ));

    window.dispatchEvent(new Event('admin_jobs_updated'));
    return legacy.length;
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
    if (document.hidden) return;
    adminJobStore.syncWithBackend();
  }, 3000);
}
