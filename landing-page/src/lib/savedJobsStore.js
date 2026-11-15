const STORAGE_KEY = 'wayin_saved_jobs';

export const savedJobsStore = {
  get() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  isSaved(jobId) {
    if (!jobId) return false;
    return this.get().includes(jobId);
  },

  save(jobId) {
    if (!jobId) return;
    const current = this.get();
    if (!current.includes(jobId)) {
      const next = [...current, jobId];
      this._persist(next);
    }
  },

  remove(jobId) {
    if (!jobId) return;
    const current = this.get();
    const next = current.filter((id) => id !== jobId);
    this._persist(next);
  },

  toggle(jobId) {
    if (!jobId) return false;
    const current = this.get();
    const isCurrentlySaved = current.includes(jobId);
    const next = isCurrentlySaved
      ? current.filter((id) => id !== jobId)
      : [...current, jobId];
    this._persist(next);
    return !isCurrentlySaved;
  },

  _persist(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
    window.dispatchEvent(new CustomEvent('saved_jobs_updated', { detail: list }));
  },
};
