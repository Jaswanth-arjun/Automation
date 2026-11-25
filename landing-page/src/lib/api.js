const HAMZOOH_API = '';
const LINKEDIN_API = '/linkedin-api';

function getToken() {
  return localStorage.getItem('hamzooh_token') || localStorage.getItem('hamzo_token') || localStorage.getItem('mailmind_token');
}

/** Auth headers for the few plain `fetch` calls (the saved-answers vault). */
export function authHeaders() {
  const token = getToken();
  return token && token !== 'demo_token' ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(baseUrl, path, options = {}) {
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
      error.payload = payload;
      error.missing = payload.missing || undefined;
    }
    throw error;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export const api = {
  // Auth
  getAuthUrl: () => apiFetch(HAMZOOH_API, '/api/gmail/auth-url'),

  // Dashboard / User
  getDashboard: () => apiFetch(HAMZOOH_API, '/api/dashboard'),

  // Gmail & Hamzooh AI
  triggerSync: () => apiFetch(HAMZOOH_API, '/api/gmail/sync', { method: 'POST' }),
  getSyncStatus: () => apiFetch(HAMZOOH_API, '/api/gmail/sync-status'),
  summarizeMail: (mail) => apiFetch(HAMZOOH_API, '/api/ai/mail/summarize', { method: 'POST', body: JSON.stringify(mail) }),
  generateMailReply: (mail) => apiFetch(HAMZOOH_API, '/api/ai/mail/reply', { method: 'POST', body: JSON.stringify(mail) }),
  generateFollowUp: (mail) => apiFetch(HAMZOOH_API, '/api/ai/mail/followup', { method: 'POST', body: JSON.stringify(mail) }),
  sendFollowUp: (payload) => apiFetch(HAMZOOH_API, '/api/ai/mail/followup/send', { method: 'POST', body: JSON.stringify(payload) }),
  generateConversationReply: (payload) => apiFetch(HAMZOOH_API, '/api/ai/conversation/reply', { method: 'POST', body: JSON.stringify(payload) }),
  getContactThread: (email) => apiFetch(HAMZOOH_API, `/api/contact/thread?email=${encodeURIComponent(email)}`),
  sendReply: (payload) => apiFetch(HAMZOOH_API, '/api/reply/send', { method: 'POST', body: JSON.stringify(payload) }),
  getEmails: (page = 0, size = 20, category = '', mailbox = '', label = '', q = '') => {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (category) params.set('category', category);
    if (mailbox) params.set('mailbox', mailbox);
    if (label) params.set('label', label);
    if (q) params.set('q', q);
    return apiFetch(HAMZOOH_API, `/api/emails?${params}`);
  },
  getEmail: (id) => apiFetch(HAMZOOH_API, `/api/emails/${id}`),
  getThread: (threadId) => apiFetch(HAMZOOH_API, `/api/threads/${threadId}`),
  toggleStar: (id, starred) => apiFetch(HAMZOOH_API, `/api/emails/${id}/star?starred=${starred}`, { method: 'POST' }),
  markRead: (id, read = true) => apiFetch(HAMZOOH_API, `/api/emails/${id}/read?read=${read}`, { method: 'POST' }),
  trashEmail: (id) => apiFetch(HAMZOOH_API, `/api/emails/${id}/trash`, { method: 'POST' }),
  snoozeEmail: (id) => apiFetch(HAMZOOH_API, `/api/emails/${id}/snooze`, { method: 'POST' }),
  archiveEmail: (id) => apiFetch(HAMZOOH_API, `/api/emails/${id}/archive`, { method: 'POST' }),
  disconnectGmail: () => apiFetch(HAMZOOH_API, '/api/gmail/disconnect', { method: 'POST' }),
  summarizeEmail: (emailId) => apiFetch(HAMZOOH_API, `/api/ai/summarize/email/${emailId}`, { method: 'POST' }),
  summarizeThread: (threadId) => apiFetch(HAMZOOH_API, `/api/ai/summarize/thread/${threadId}`, { method: 'POST' }),
  generateDraft: (prompt, recipientEmails = [], subject = '') =>
    apiFetch(HAMZOOH_API, '/api/drafts/generate', { method: 'POST', body: JSON.stringify({ prompt, recipientEmails, subject }) }),
  sendDraft: (draftId, subject, bodyText, recipientEmails) =>
    apiFetch(HAMZOOH_API, '/api/drafts/send', { method: 'POST', body: JSON.stringify({ draftId, subject, bodyText, recipientEmails }) }),
  generateReply: (emailId, threadId, instruction) =>
    apiFetch(HAMZOOH_API, '/api/reply/generate', { method: 'POST', body: JSON.stringify({ emailId, threadId, instruction }) }),
  replySend: (payload) => apiFetch(HAMZOOH_API, '/api/reply/send', { method: 'POST', body: JSON.stringify(payload) }),
  chatMail: (question, sessionId = '', threadId = '') =>
    apiFetch(HAMZOOH_API, '/api/chat/query', { method: 'POST', body: JSON.stringify({ question, sessionId, threadId }) }),

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
  resumeCampaign: (id, payload = {}) => apiFetch(LINKEDIN_API, `/api/campaigns/${encodeURIComponent(id)}/resume`, { method: 'POST', body: JSON.stringify(payload) }),
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
  generateCoverLetter: (payload) => apiFetch('', '/api/cover-letter/generate', { method: 'POST', body: JSON.stringify(payload) }),
  renderCoverLetterPdf: (payload) => apiFetch('', '/api/cover-letter/render-pdf', { method: 'POST', body: JSON.stringify(payload) }),
  renderEditedResumePdf: (html) => apiFetch('', '/api/resume/render-edited-pdf', { method: 'POST', body: JSON.stringify({ html }) }),

  // Auto-Apply (Puppeteer engine)
  autoApply: (payload) => apiFetch('', '/api/auto-apply', { method: 'POST', body: JSON.stringify(payload) }),
  autoApplyClose: () => apiFetch('', '/api/auto-apply/close', { method: 'POST' }),
  provideAutoApplyInput: (payload) => apiFetch('', '/api/auto-apply/provide-input', { method: 'POST', body: JSON.stringify(payload) }),

  // Autonomous Auto Apply with AI (Chrome extension executes, backend owns task state)
  startAutoApply: (payload) => apiFetch('', '/api/applications/auto-apply/start', { method: 'POST', body: JSON.stringify(payload) }),
  extensionHeartbeat: (taskId, token, payload = {}) => apiFetch('', '/api/applications/extension/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ taskId, token, ...payload }),
  }),
  getApplicationTask: (taskId) => apiFetch('', `/api/applications/tasks/${encodeURIComponent(taskId)}`),
  getActiveApplicationTask: () => apiFetch('', '/api/applications/tasks/active'),
  listApplicationTasks: (limit = 50) => apiFetch('', `/api/applications/tasks?limit=${encodeURIComponent(limit)}`),
  getApplicationReview: (taskId) => apiFetch('', `/api/applications/tasks/${encodeURIComponent(taskId)}/review`),
  pauseApplicationTask: (taskId) => apiFetch('', `/api/applications/tasks/${encodeURIComponent(taskId)}/pause`, { method: 'POST' }),
  resumeApplicationTask: (taskId) => apiFetch('', `/api/applications/tasks/${encodeURIComponent(taskId)}/resume`, { method: 'POST' }),
  cancelApplicationTask: (taskId, reason = '') => apiFetch('', `/api/applications/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  approveApplicationTask: (taskId) => apiFetch('', `/api/applications/tasks/${encodeURIComponent(taskId)}/approve`, { method: 'POST' }),
  markApplicationTaskSubmitted: (taskId, details = {}) => apiFetch('', `/api/applications/tasks/${encodeURIComponent(taskId)}/mark-submitted`, { method: 'POST', body: JSON.stringify(details) }),
  answerApplicationQuestion: (taskId, questionId, payload) => apiFetch(
    '',
    `/api/applications/tasks/${encodeURIComponent(taskId)}/questions/${encodeURIComponent(questionId)}/answer`,
    { method: 'POST', body: JSON.stringify(payload) },
  ),

  // Saved answer memory
  listAnswerMemory: () => apiFetch('', '/api/answer-memory'),
  saveAnswerMemory: (payload) => apiFetch('', '/api/answer-memory', { method: 'POST', body: JSON.stringify(payload) }),
  updateAnswerMemory: (id, payload) => apiFetch('', `/api/answer-memory/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAnswerMemory: (id) => apiFetch('', `/api/answer-memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  lookupAnswerMemory: (question, options = []) => apiFetch('', '/api/answer-memory/lookup', { method: 'POST', body: JSON.stringify({ question, options }) }),
  getAiUsage: (taskId = '') => apiFetch('', `/api/ai/usage${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`),
  getAiModels: () => apiFetch('', '/api/ai/models'),
};

const EMPLOYEE_CACHE_KEY = 'hamzooh_employees';

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

// Candidate database — every profile save refreshes the admin's batch-wise list.
export const candidateStore = {
  syncProfile(profile = {}) {
    const education = Array.isArray(profile.education) ? profile.education : [];
    const primaryEducation = education.find((item) => item?.institution || item?.graduationYear) || {};
    const batch = String(profile.batch || primaryEducation.graduationYear || '').trim();
    const payload = {
      email: String(profile.email || '').trim(),
      fullName: String(profile.fullName || '').trim(),
      phone: String(profile.phone || '').trim(),
      batch,
      institution: String(primaryEducation.institution || profile.institution || '').trim(),
      skills: Array.isArray(profile.skills) ? profile.skills : [],
    };
    if (!payload.email) return Promise.resolve({ ok: false, skipped: true });
    return apiFetch(HAMZOOH_API, '/api/candidates/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  list({ batch = '', search = '' } = {}) {
    const params = new URLSearchParams();
    if (batch && batch !== 'ALL') params.set('batch', batch);
    if (search) params.set('search', search);
    const query = params.toString();
    return apiFetch(HAMZOOH_API, `/api/candidates${query ? `?${query}` : ''}`);
  },
  broadcast(payload) {
    return apiFetch(HAMZOOH_API, '/api/admin/broadcast-batch-mail', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  sentBroadcasts() {
    return apiFetch(HAMZOOH_API, '/api/admin/sent-broadcasts');
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
      // Unique even when several records are created in the same millisecond
      // (e.g. a batch of application-status emails).
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      appliedAt: application.appliedAt || new Date().toISOString(),
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

/**
 * Record applications the backend verified as submitted — including a manual
 * submit in the job tab — so the Job Tracker and the role page show "Applied"
 * even when the dashboard was closed while the submission happened.
 */
const APPLIED_APPLICATION_STATUSES = new Set(['Applied', 'Shortlisted', 'Assessment', 'Interview', 'Offer', 'Rejected']);

const normalized = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function urlFingerprint(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();
    const ids = (path.match(/[a-z]{0,4}\d{5,}[a-z0-9]*/g) || []).filter((token) => token.length >= 6);
    return { host, path, ids };
  } catch {
    return null;
  }
}

/** Same page, a confirmation sub-page of it, or the same job posting id. */
function detectionMatchesJob(detectionUrl, jobUrl) {
  const a = urlFingerprint(detectionUrl);
  const b = urlFingerprint(jobUrl);
  if (!a || !b || a.host !== b.host) return false;
  if (a.path === b.path) return true;
  if (a.path && b.path && (a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`))) return true;
  return a.ids.some((id) => b.ids.includes(id));
}

/**
 * When the confirmation page lives on a different host, fall back to the role
 * title plus company appearing on the detected page. Both must match, so a
 * generic "thanks for applying" page can never mark an unrelated job.
 */
function detectionMatchesRole(detection, candidate) {
  const title = normalized(candidate.title);
  if (!title || title.length < 6) return false;
  const haystack = normalized(`${detection.title || ''} ${detection.url || ''}`);
  if (!haystack) return false;
  const company = normalized(candidate.company);
  if (company && !haystack.includes(company) && !normalized(detection.company || '').includes(company)) return false;
  if (haystack.includes(title)) return true;
  // ATS titles carry location/seniority suffixes, so require most meaningful
  // words of the tracked role to appear on the confirmation page.
  const words = title.split(/[^a-z0-9+#.]+/).filter((word) => word.length >= 3);
  if (words.length < 2) return false;
  const hits = words.filter((word) => haystack.includes(word)).length;
  return hits / words.length >= 0.6;
}

function requestExtensionDetections({ scan = false, timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') { resolve([]); return; }
    // No bridge on this page (extension missing or stale): do not make the
    // tracker wait for a reply that can never come.
    if (typeof document === 'undefined' || document.documentElement?.dataset?.hamzoohExtension !== '1') {
      resolve([]);
      return;
    }
    const requestId = `detsub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    const finish = (items) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve(Array.isArray(items) ? items : []);
    };
    function onMessage(event) {
      if (event.source !== window || event.data?.source !== 'hamzooh-extension') return;
      if (event.data.type !== 'HAMZOOH_DETECTED_SUBMISSIONS' || event.data.requestId !== requestId) return;
      finish(event.data.items);
    }
    window.addEventListener('message', onMessage);
    window.postMessage({
      source: 'hamzooh-app',
      type: scan ? 'HAMZOOH_SCAN_SUBMISSIONS' : 'HAMZOOH_LIST_DETECTED_SUBMISSIONS',
      requestId,
    }, '*');
    setTimeout(() => finish([]), timeoutMs);
  });
}

function clearExtensionDetection(id) {
  if (!id || typeof window === 'undefined') return;
  window.postMessage({ source: 'hamzooh-app', type: 'HAMZOOH_CLEAR_DETECTED_SUBMISSION', id }, '*');
}

/**
 * Consume confirmation pages the extension noticed in the browser — including
 * manual applies from a job page with no auto-apply task — and mark the
 * matching tracked role as Applied.
 */
export async function reconcileDetectedSubmissions({
  jobId = '', jobUrl = '', jobTitle = '', jobCompany = '', onlyCurrentJob = false, scan = false,
} = {}) {
  try {
    const detections = await requestExtensionDetections({ scan });
    if (!detections.length) return false;

    const candidates = [];
    const addCandidate = (seed = {}) => {
      const id = seed.jobId ? String(seed.jobId) : '';
      const url = String(seed.jobUrl || '').trim();
      if (!id && !url) return;
      if (candidates.some((item) => (id && item.jobId === id) || (url && item.jobUrl === url))) return;
      candidates.push({
        jobId: id,
        jobUrl: url,
        title: String(seed.title || '').trim(),
        company: String(seed.company || '').trim(),
      });
    };
    resumeStore.getAll().forEach(addCandidate);
    applicationStore.getAll().forEach(addCandidate);
    if (jobId || jobUrl || jobTitle) addCandidate({ jobId, jobUrl, title: jobTitle, company: jobCompany });

    const scoped = onlyCurrentJob
      ? candidates.filter((candidate) => (
        (jobId && candidate.jobId === String(jobId))
        || (jobUrl && candidate.jobUrl === String(jobUrl))
        || (jobTitle && normalized(candidate.title) === normalized(jobTitle)
          && (!jobCompany || normalized(candidate.company) === normalized(jobCompany)))
      ))
      : candidates;
    if (!scoped.length) return false;

    let changed = false;
    for (const detection of detections.slice(0, 20)) {
      if (!detection?.url) continue;
      let match = scoped.find((candidate) => candidate.jobUrl && detectionMatchesJob(detection.url, candidate.jobUrl));
      if (!match) match = scoped.find((candidate) => detectionMatchesRole(detection, candidate));
      if (!match) continue;

      const appliedAt = detection.at || new Date().toISOString();
      const existing = applicationStore.getAll().find((app) => (
        (match.jobId && String(app.jobId || '') === match.jobId)
        || (match.jobUrl && normalized(app.jobUrl) === normalized(match.jobUrl))
        || (app.appliedViaDetectedPage && normalized(app.company) === normalized(match.company)
          && normalized(app.title) === normalized(match.title))
      ));

      if (existing) {
        if (!APPLIED_APPLICATION_STATUSES.has(existing.status || 'Applied')) {
          applicationStore.update(existing.id, {
            status: 'Applied',
            stage: existing.stage || 'apply',
            appliedViaDetectedPage: true,
            detectedUrl: detection.url,
            detectedAt: appliedAt,
            appliedAt: existing.appliedAt || appliedAt,
            statusSource: existing.statusSource || 'extension-detection',
            jobId: existing.jobId || match.jobId || undefined,
            jobUrl: existing.jobUrl || match.jobUrl || detection.url,
          });
          changed = true;
        } else if (!existing.detectedUrl) {
          applicationStore.update(existing.id, {
            appliedViaDetectedPage: true,
            detectedUrl: detection.url,
            detectedAt: appliedAt,
          });
        }
      } else {
        applicationStore.add({
          title: match.title || detection.title || '',
          company: match.company || detection.company || '',
          jobId: match.jobId || undefined,
          jobUrl: match.jobUrl || detection.url,
          status: 'Applied',
          stage: 'apply',
          appliedViaDetectedPage: true,
          detectedUrl: detection.url,
          detectedAt: appliedAt,
          appliedAt,
          statusSource: 'extension-detection',
        });
        changed = true;
      }

      if (match.jobId && !applyProgressStore.get(match.jobId)?.apply) {
        applyProgressStore.mark(match.jobId, 'apply', { company: match.company, title: match.title });
        changed = true;
      }
      clearExtensionDetection(detection.id);
    }
    return changed;
  } catch {
    return false;
  }
}

export async function reconcileSubmittedApplications({ limit = 25, jobId = '', jobUrl = '', jobTitle = '', jobCompany = '' } = {}) {
  try {
    const res = await api.listApplicationTasks(limit);
    const tasks = Array.isArray(res?.tasks) ? res.tasks : [];
    const submitted = tasks.filter((task) => task?.status === 'submitted');
    if (!submitted.length) return false;
    const norm = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const sameJobPage = (left, right) => {
      try {
        const a = new URL(left);
        const b = new URL(right);
        return a.hostname === b.hostname && a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '');
      } catch { return false; }
    };
    const existing = applicationStore.getAll();
    let changed = false;
    for (const task of submitted) {
      const title = task.job?.title || task.title || '';
      const company = task.job?.company || task.company || '';
      // Older tasks predate `job.id`, so match this role by page URL or by
      // company + title before falling back to the task's own job id.
      const sameRole = Boolean(jobTitle && jobCompany)
        && norm(jobTitle) === norm(title)
        && norm(jobCompany) === norm(company);
      const matchesCurrentJob = Boolean(jobId) && ((jobUrl && sameJobPage(jobUrl, task.url)) || sameRole);
      const resolvedJobId = matchesCurrentJob ? String(jobId) : (task.job?.id ? String(task.job.id) : '');
      const match = existing.find((app) => (
        (task.id && String(app.taskId || '') === String(task.id))
        || (resolvedJobId && String(app.jobId || '') === resolvedJobId)
        || (norm(app.company) === norm(company) && norm(app.title) === norm(title))
      ));
      if (!match && (title || company)) {
        applicationStore.add({
          title,
          company,
          jobId: resolvedJobId || undefined,
          jobUrl: task.url || '',
          status: 'Applied',
          stage: 'apply',
          appliedViaExtension: true,
          appliedViaManualSubmission: task.result?.reasonCode === 'MANUAL_SUBMISSION',
          taskId: task.id,
          resumeUsed: task.resumeName || task.selectedResume?.name || 'Tailored Resume (AI agent)',
        });
        existing.push({ taskId: task.id, jobId: resolvedJobId, company, title, appliedViaExtension: true, status: 'Applied' });
        changed = true;
      } else if (match && !APPLIED_APPLICATION_STATUSES.has(match.status || 'Applied')) {
        // A referral/outreach record for the same role must not hide a real
        // submission. Upgrade it instead of adding a duplicate.
        applicationStore.update(match.id, {
          status: 'Applied',
          stage: match.stage || 'apply',
          appliedViaExtension: true,
          appliedViaManualSubmission: task.result?.reasonCode === 'MANUAL_SUBMISSION',
          taskId: match.taskId || task.id,
          jobId: match.jobId || resolvedJobId || undefined,
          jobUrl: match.jobUrl || task.url || '',
          appliedAt: match.appliedAt || task.result?.at || task.updatedAt || new Date().toISOString(),
        });
        Object.assign(match, {
          status: 'Applied',
          taskId: match.taskId || task.id,
          jobId: match.jobId || resolvedJobId,
          appliedViaExtension: true,
        });
        changed = true;
      }
      if (resolvedJobId && !applyProgressStore.get(resolvedJobId)?.apply) {
        applyProgressStore.mark(resolvedJobId, 'apply', { company, title });
      }
    }
    return changed;
  } catch {
    return false;
  }
}

export const coverLetterStore = {
  get(jobId) {
    if (!jobId) return null;
    try {
      const data = localStorage.getItem(`hamzooh_cover_letter_${jobId}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },
  getAll() {
    const prefix = 'hamzooh_cover_letter_';
    const list = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          list.push({
            jobId: key.slice(prefix.length),
            ...parsed,
          });
        }
      }
      list.sort((a, b) => Date.parse(b.updatedAt || b.savedAt || 0) - Date.parse(a.updatedAt || a.savedAt || 0));
    } catch {}
    return list;
  },
  save(jobId, coverLetter) {
    if (!jobId || !coverLetter) return;
    try {
      const now = new Date().toISOString();
      const payload = {
        ...coverLetter,
        jobId,
        savedAt: coverLetter.savedAt || now,
        updatedAt: now,
      };
      localStorage.setItem(`hamzooh_cover_letter_${jobId}`, JSON.stringify(payload));
      window.dispatchEvent(new Event('cover_letter_updated'));
    } catch {}
  },
  clear(jobId) {
    if (!jobId) return;
    try {
      localStorage.removeItem(`hamzooh_cover_letter_${jobId}`);
      window.dispatchEvent(new Event('cover_letter_updated'));
    } catch {}
  },
};

