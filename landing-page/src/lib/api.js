const MAILMIND_API = '';
const LINKEDIN_API = '/linkedin-api';

function getToken() {
  return localStorage.getItem('mailmind_token');
}

async function apiFetch(baseUrl, path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && token !== 'demo_token' ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    let message = `Request failed (${res.status})`;
    let payload = null;
    try {
      payload = JSON.parse(text);
      message = payload.error || payload.message || message;
    } catch {
      if (text) message = text.slice(0, 300);
    }
    const error = new Error(message);
    error.status = res.status;
    if (payload) {
      error.code = payload.code || '';
      error.uncertain = Boolean(payload.uncertain);
    }
    throw error;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export const api = {
  // Auth
  getAuthUrl: () => apiFetch(MAILMIND_API, '/api/gmail/auth-url'),

  // Dashboard / User
  getDashboard: () => apiFetch(MAILMIND_API, '/api/dashboard'),

  // Gmail & MailMind AI
  triggerSync: () => apiFetch(MAILMIND_API, '/api/gmail/sync', { method: 'POST' }),
  getSyncStatus: () => apiFetch(MAILMIND_API, '/api/gmail/sync-status'),
  summarizeMail: (mail) => apiFetch(MAILMIND_API, '/api/ai/mail/summarize', { method: 'POST', body: JSON.stringify(mail) }),
  generateMailReply: (mail) => apiFetch(MAILMIND_API, '/api/ai/mail/reply', { method: 'POST', body: JSON.stringify(mail) }),
  generateFollowUp: (mail) => apiFetch(MAILMIND_API, '/api/ai/mail/followup', { method: 'POST', body: JSON.stringify(mail) }),
  sendFollowUp: (payload) => apiFetch(MAILMIND_API, '/api/ai/mail/followup/send', { method: 'POST', body: JSON.stringify(payload) }),
  generateConversationReply: (payload) => apiFetch(MAILMIND_API, '/api/ai/conversation/reply', { method: 'POST', body: JSON.stringify(payload) }),
  getContactThread: (email) => apiFetch(MAILMIND_API, `/api/contact/thread?email=${encodeURIComponent(email)}`),
  sendReply: (payload) => apiFetch(MAILMIND_API, '/api/reply/send', { method: 'POST', body: JSON.stringify(payload) }),
  getEmails: (page = 0, size = 20, category = '', mailbox = '', label = '', q = '') => {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (category) params.set('category', category);
    if (mailbox) params.set('mailbox', mailbox);
    if (label) params.set('label', label);
    if (q) params.set('q', q);
    return apiFetch(MAILMIND_API, `/api/emails?${params}`);
  },
  getEmail: (id) => apiFetch(MAILMIND_API, `/api/emails/${id}`),
  getThread: (threadId) => apiFetch(MAILMIND_API, `/api/threads/${threadId}`),
  toggleStar: (id, starred) => apiFetch(MAILMIND_API, `/api/emails/${id}/star?starred=${starred}`, { method: 'POST' }),
  markRead: (id, read = true) => apiFetch(MAILMIND_API, `/api/emails/${id}/read?read=${read}`, { method: 'POST' }),
  trashEmail: (id) => apiFetch(MAILMIND_API, `/api/emails/${id}/trash`, { method: 'POST' }),
  snoozeEmail: (id) => apiFetch(MAILMIND_API, `/api/emails/${id}/snooze`, { method: 'POST' }),
  archiveEmail: (id) => apiFetch(MAILMIND_API, `/api/emails/${id}/archive`, { method: 'POST' }),
  disconnectGmail: () => apiFetch(MAILMIND_API, '/api/gmail/disconnect', { method: 'POST' }),
  summarizeEmail: (emailId) => apiFetch(MAILMIND_API, `/api/ai/summarize/email/${emailId}`, { method: 'POST' }),
  summarizeThread: (threadId) => apiFetch(MAILMIND_API, `/api/ai/summarize/thread/${threadId}`, { method: 'POST' }),
  generateDraft: (prompt, recipientEmails = [], subject = '') =>
    apiFetch(MAILMIND_API, '/api/drafts/generate', { method: 'POST', body: JSON.stringify({ prompt, recipientEmails, subject }) }),
  sendDraft: (draftId, subject, bodyText, recipientEmails) =>
    apiFetch(MAILMIND_API, '/api/drafts/send', { method: 'POST', body: JSON.stringify({ draftId, subject, bodyText, recipientEmails }) }),
  generateReply: (emailId, threadId, instruction) =>
    apiFetch(MAILMIND_API, '/api/reply/generate', { method: 'POST', body: JSON.stringify({ emailId, threadId, instruction }) }),
  replySend: (payload) => apiFetch(MAILMIND_API, '/api/reply/send', { method: 'POST', body: JSON.stringify(payload) }),
  chatMail: (question, sessionId = '', threadId = '') =>
    apiFetch(MAILMIND_API, '/api/chat/query', { method: 'POST', body: JSON.stringify({ question, sessionId, threadId }) }),

  // LinkedIn automation
  getLinkedInStatus: () => apiFetch(LINKEDIN_API, '/api/status'),
  getLinkedInConnections: (filter = {}) => {
    const params = new URLSearchParams(filter);
    return apiFetch(LINKEDIN_API, `/api/connections?${params}`);
  },
  getLinkedInAnalytics: (company = 'all') => {
    const params = new URLSearchParams();
    if (company && company !== 'all') params.set('company', company);
    const query = params.toString();
    return apiFetch(LINKEDIN_API, `/api/analytics${query ? `?${query}` : ''}`);
  },
  getLinkedInLogs: () => apiFetch(LINKEDIN_API, '/api/logs'),
  startLinkedIn: (config) => apiFetch(LINKEDIN_API, '/api/start', { method: 'POST', body: JSON.stringify(config) }),
  stopLinkedIn: () => apiFetch(LINKEDIN_API, '/api/stop', { method: 'POST' }),
  syncLinkedInStatus: (userId) => apiFetch(LINKEDIN_API, '/api/sync-status', { method: 'POST', body: JSON.stringify({ userId }) }),

  // Multi-stage referral campaign (persistent, backend-executed)
  listCampaigns: () => apiFetch(LINKEDIN_API, '/api/campaigns'),
  getActiveCampaign: () => apiFetch(LINKEDIN_API, '/api/campaigns/active'),
  getCampaign: (id) => apiFetch(LINKEDIN_API, `/api/campaigns/${encodeURIComponent(id)}`),
  startCampaign: (payload) => apiFetch(LINKEDIN_API, '/api/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
  pauseCampaign: (id) => apiFetch(LINKEDIN_API, `/api/campaigns/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeCampaign: (id) => apiFetch(LINKEDIN_API, `/api/campaigns/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  stopCampaign: (id) => apiFetch(LINKEDIN_API, `/api/campaigns/${encodeURIComponent(id)}/stop`, { method: 'POST' }),

  // Per-user LinkedIn account connect
  getLinkedInAccount: (userId) => apiFetch(LINKEDIN_API, `/api/linkedin-account?userId=${encodeURIComponent(userId || 'default')}`),
  connectLinkedIn: (userId) => apiFetch(LINKEDIN_API, '/api/linkedin/connect', { method: 'POST', body: JSON.stringify({ userId }) }),
  connectLinkedInCookie: (userId, liAt) => apiFetch(LINKEDIN_API, '/api/linkedin/connect-cookie', { method: 'POST', body: JSON.stringify({ userId, liAt }) }),
  disconnectLinkedIn: (userId) => apiFetch(LINKEDIN_API, '/api/linkedin/disconnect', { method: 'POST', body: JSON.stringify({ userId }) }),
  verifyLinkedIn: (userId) => apiFetch(LINKEDIN_API, '/api/linkedin/verify', { method: 'POST', body: JSON.stringify({ userId }) }),
  // Live conversation with one contact, from the user's own LinkedIn account
  getLinkedInThread: (payload) => apiFetch(LINKEDIN_API, '/api/linkedin/thread', { method: 'POST', body: JSON.stringify(payload) }),
  sendLinkedInMessage: (payload) => apiFetch(LINKEDIN_API, '/api/linkedin/send-message', { method: 'POST', body: JSON.stringify(payload) }),

  // Real Email Outreach API
  getGmailConfig: () => apiFetch('', '/api/config/gmail'),
  saveGmailConfig: (payload) => apiFetch('', '/api/config/gmail', { method: 'POST', body: JSON.stringify(payload) }),
  sendReferralEmail: (payload) => apiFetch('', '/api/send-email', { method: 'POST', body: JSON.stringify(payload) }),
  getEmployees: (company = '') => apiFetch('', `/api/employees${company ? `?company=${encodeURIComponent(company)}` : ''}`),
  discoverEmployees: (payload) => apiFetch('', '/api/employees/discover', { method: 'POST', body: JSON.stringify(payload) }),
  addEmployee: (payload) => apiFetch('', '/api/employees', { method: 'POST', body: JSON.stringify(payload) }),
  restoreEmployees: (employees) => apiFetch('', '/api/employees/bulk', { method: 'POST', body: JSON.stringify({ employees }) }),
  deleteEmployee: (id) => apiFetch('', `/api/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getSentEmails: () => apiFetch('', '/api/sent-emails'),
  tailorExternalJob: (payload) => apiFetch('', '/api/external-job/tailor', { method: 'POST', body: JSON.stringify(payload) }),
  renderEditedResumePdf: (html) => apiFetch('', '/api/resume/render-edited-pdf', { method: 'POST', body: JSON.stringify({ html }) }),

  // Auto-Apply (Puppeteer engine)
  autoApply: (payload) => apiFetch('', '/api/auto-apply', { method: 'POST', body: JSON.stringify(payload) }),
  autoApplyClose: () => apiFetch('', '/api/auto-apply/close', { method: 'POST' }),
  provideAutoApplyInput: (payload) => apiFetch('', '/api/auto-apply/provide-input', { method: 'POST', body: JSON.stringify(payload) }),
};

const EMPLOYEE_CACHE_KEY = 'hamzo_employees';

export const employeeStore = {
  getAll() {
    try {
      const raw = localStorage.getItem(EMPLOYEE_CACHE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  },
  saveAll(list) {
    localStorage.setItem(EMPLOYEE_CACHE_KEY, JSON.stringify(list));
    return list;
  },
};

// Profile (localStorage)
export const profileStore = {
  get() {
    const raw = localStorage.getItem('wayin_profile');
    return raw ? JSON.parse(raw) : null;
  },
  save(profile) {
    localStorage.setItem('wayin_profile', JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }));
    window.dispatchEvent(new Event('profile_updated'));
    return profile;
  },
};

// LinkedIn campaign form values, shared so the Apply tab and the LinkedIn
// Automation page always launch with the same company / role / filters.
const CAMPAIGN_PREFS_KEY = 'wayin_linkedin_campaign_prefs';
export const campaignPrefsStore = {
  get() {
    try {
      const raw = localStorage.getItem(CAMPAIGN_PREFS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save(prefs) {
    const next = { ...(this.get() || {}), ...prefs, updatedAt: new Date().toISOString() };
    localStorage.setItem(CAMPAIGN_PREFS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('campaign_prefs_updated'));
    return next;
  },
};

export function formatAccountName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let str = raw.trim();
  if (str.includes('@')) {
    str = str.split('@')[0];
  }

  // If already a clean spaced name without numbers (e.g. "Nelluru Jaswanth"), return capitalized words
  if (!/\d/.test(str) && str.includes(' ')) {
    return str
      .split(/\s+/)
      .map((w) => (w.toLowerCase() === 'nlr' ? 'Nelluru' : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
  }

  // Remove trailing years/digits (e.g. 2004, 123, 20)
  str = str.replace(/\d+$/g, '').replace(/^[._-]+|[._-]+$/g, '');

  // If there are separators (. - _)
  if (/[._-]/.test(str)) {
    const parts = str.split(/[._-]+/).filter(Boolean);
    return parts
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === 'nlr') return 'Nelluru';
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
  }

  // If no separators, detect common name roots:
  const lower = str.toLowerCase();
  if (lower.startsWith('nlr') && lower.length > 3) {
    const rest = lower.slice(3);
    return 'Nelluru ' + rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  if (lower.startsWith('nelluru') && lower.length > 7) {
    const rest = lower.slice(7);
    return 'Nelluru ' + rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  if (lower.startsWith('jaswanth') && lower.length > 8) {
    const rest = lower.slice(8);
    return 'Jaswanth ' + rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  if (lower.startsWith('jaswant') && lower.length > 7) {
    const rest = lower.slice(7);
    return 'Jaswanth ' + rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  if (lower.startsWith('puchakayala') && lower.length > 11) {
    const rest = lower.slice(11);
    return 'Puchakayala ' + rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function getUserName(user, profile) {
  const savedProfile = profile !== undefined ? profile : profileStore.get();
  if (savedProfile?.fullName && savedProfile.fullName.trim() && savedProfile.fullName.trim() !== 'Your Name') {
    return savedProfile.fullName.trim();
  }

  if (user?.displayName && user.displayName.trim() && !user.displayName.includes('@')) {
    return formatAccountName(user.displayName);
  }

  const email = user?.email || user?.gmailEmail || savedProfile?.email || '';
  if (email) {
    return formatAccountName(email);
  }

  return 'User';
}

export function getEmailUsername(user, profile) {
  return getUserName(user, profile);
}


// Resume (localStorage)
export const resumeStore = {
  getAll() {
    const raw = localStorage.getItem('wayin_resumes');
    const all = raw ? JSON.parse(raw) : [];
    // An uploaded resume stays the active one until the user picks another,
    // so never leave the list without an active entry.
    if (all.length && !all.some((r) => r.isActive)) {
      all[0] = { ...all[0], isActive: true };
      localStorage.setItem('wayin_resumes', JSON.stringify(all));
    }
    return all;
  },
  add(resume) {
    const all = this.getAll();
    const makeActive = Boolean(resume.isActive || resume.makeActive) || all.length === 0;
    const next = makeActive ? all.map((r) => ({ ...r, isActive: false })) : all;
    next.push({ ...resume, id: Date.now().toString(), uploadedAt: new Date().toISOString(), isActive: makeActive });
    localStorage.setItem('wayin_resumes', JSON.stringify(next));
    window.dispatchEvent(new Event('resumes_updated'));
    return next;
  },
  setActive(id) {
    const all = this.getAll().map(r => ({ ...r, isActive: r.id === id }));
    localStorage.setItem('wayin_resumes', JSON.stringify(all));
    window.dispatchEvent(new Event('resumes_updated'));
    return all;
  },
  remove(id) {
    let all = this.getAll().filter(r => r.id !== id);
    if (all.length && !all.some(r => r.isActive)) all = all.map((r, i) => ({ ...r, isActive: i === 0 }));
    localStorage.setItem('wayin_resumes', JSON.stringify(all));
    window.dispatchEvent(new Event('resumes_updated'));
    return all;
  },
};

// Applications (localStorage)
function saveApplications(all) {
  localStorage.setItem('wayin_applications', JSON.stringify(all));
  window.dispatchEvent(new Event('applications_updated'));
  return all;
}

export const applicationStore = {
  getAll() {
    const raw = localStorage.getItem('wayin_applications');
    return raw ? JSON.parse(raw) : [];
  },
  add(application) {
    const all = this.getAll();
    all.unshift({
      ...application,
      id: Date.now().toString(),
      appliedAt: new Date().toISOString(),
      status: application.status || 'Applied',
    });
    return saveApplications(all);
  },
  updateStatus(id, status) {
    const all = this.getAll().map(a => a.id === id ? { ...a, status, lastActivity: new Date().toISOString() } : a);
    return saveApplications(all);
  },
  update(id, patch) {
    const all = this.getAll().map(a => a.id === id ? { ...a, ...patch, lastActivity: new Date().toISOString() } : a);
    return saveApplications(all);
  },
  remove(id) {
    const all = this.getAll().filter(a => a.id !== id);
    return saveApplications(all);
  },
};

// Per-job progress through the 4-stage apply flow (tailor → referral → LinkedIn
// → direct apply). This is what the Job Tracker uses to resume where the user
// paused. Kept separate from applications because outreach is not an application.
const APPLY_PROGRESS_KEY = 'wayin_apply_progress';

function readApplyProgress() {
  try {
    const raw = localStorage.getItem(APPLY_PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const applyProgressStore = {
  getAll() {
    const value = readApplyProgress();
    return value && typeof value === 'object' ? value : {};
  },
  get(jobId) {
    if (!jobId) return {};
    return this.getAll()[String(jobId)] || {};
  },
  mark(jobId, stage, meta = {}) {
    if (!jobId || !stage) return {};
    const all = this.getAll();
    const key = String(jobId);
    const current = all[key] || {};
    all[key] = {
      ...current,
      ...(meta || {}),
      [stage]: new Date().toISOString(),
    };
    localStorage.setItem(APPLY_PROGRESS_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event('apply_progress_updated'));
    return all[key];
  },
  clear(jobId) {
    if (!jobId) return;
    const all = this.getAll();
    delete all[String(jobId)];
    localStorage.setItem(APPLY_PROGRESS_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event('apply_progress_updated'));
  },
};

// Tailoring report per job (ATS scores, keyword audit, tailored sections). Saved
// so the report and the tailored resume survive a refresh, a stage change or
// reopening the application from Job Tracker. The PDF itself is not copied
// here — the resume store already keeps it for the job.
const TAILOR_REPORT_KEY = 'wayin_tailor_reports';

function readTailorReports() {
  try {
    const raw = localStorage.getItem(TAILOR_REPORT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const tailorReportStore = {
  getAll() {
    const value = readTailorReports();
    return value && typeof value === 'object' ? value : {};
  },
  get(jobId) {
    if (!jobId) return null;
    return this.getAll()[String(jobId)] || null;
  },
  save(jobId, report, meta = {}) {
    if (!jobId || !report) return null;
    const all = this.getAll();
    const entry = {
      savedAt: new Date().toISOString(),
      ...meta,
      report: {
        ...report,
        formats: (report.formats || []).map(({ pdfBase64, ...rest }) => rest),
      },
    };
    all[String(jobId)] = entry;
    try {
      localStorage.setItem(TAILOR_REPORT_KEY, JSON.stringify(all));
    } catch {
      // Storage full: keep the newest report by dropping the oldest entries.
      const keys = Object.keys(all);
      if (keys.length > 1) {
        delete all[keys.find((key) => key !== String(jobId))];
        try { localStorage.setItem(TAILOR_REPORT_KEY, JSON.stringify(all)); } catch { /* give up quietly */ }
      }
    }
    window.dispatchEvent(new Event('tailor_report_updated'));
    return entry;
  },
  clear(jobId) {
    if (!jobId) return;
    const all = this.getAll();
    delete all[String(jobId)];
    localStorage.setItem(TAILOR_REPORT_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event('tailor_report_updated'));
  },
};

