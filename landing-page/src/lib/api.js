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
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
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
  getEmails: (page = 0, size = 20, category = '', mailbox = '', label = '') => {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (category) params.set('category', category);
    if (mailbox) params.set('mailbox', mailbox);
    if (label) params.set('label', label);
    return apiFetch(MAILMIND_API, `/api/emails?${params}`);
  },
  getEmail: (id) => apiFetch(MAILMIND_API, `/api/emails/${id}`),
  getThread: (threadId) => apiFetch(MAILMIND_API, `/api/threads/${threadId}`),
  toggleStar: (id, starred) => apiFetch(MAILMIND_API, `/api/emails/${id}/star?starred=${starred}`, { method: 'POST' }),
  trashEmail: (id) => apiFetch(MAILMIND_API, `/api/emails/${id}/trash`, { method: 'POST' }),
  snoozeEmail: (id) => apiFetch(MAILMIND_API, `/api/emails/${id}/snooze`, { method: 'POST' }),
  archiveEmail: (id) => apiFetch(MAILMIND_API, `/api/emails/${id}/archive`, { method: 'POST' }),
  summarizeEmail: (emailId) => apiFetch(MAILMIND_API, `/api/ai/summarize/email/${emailId}`, { method: 'POST' }),
  summarizeThread: (threadId) => apiFetch(MAILMIND_API, `/api/ai/summarize/thread/${threadId}`, { method: 'POST' }),
  generateDraft: (prompt, recipientEmails = [], subject = '') =>
    apiFetch(MAILMIND_API, '/api/drafts/generate', { method: 'POST', body: JSON.stringify({ prompt, recipientEmails, subject }) }),
  sendDraft: (draftId, subject, bodyText, recipientEmails) =>
    apiFetch(MAILMIND_API, '/api/drafts/send', { method: 'POST', body: JSON.stringify({ draftId, subject, bodyText, recipientEmails }) }),
  generateReply: (emailId, threadId, instruction) =>
    apiFetch(MAILMIND_API, '/api/reply/generate', { method: 'POST', body: JSON.stringify({ emailId, threadId, instruction }) }),
  sendReply: (draftId, subject, bodyText, recipientEmails) =>
    apiFetch(MAILMIND_API, '/api/reply/send', { method: 'POST', body: JSON.stringify({ draftId, subject, bodyText, recipientEmails }) }),
  chatMail: (question, sessionId = '', threadId = '') =>
    apiFetch(MAILMIND_API, '/api/chat/query', { method: 'POST', body: JSON.stringify({ question, sessionId, threadId }) }),

  // LinkedIn automation
  getLinkedInStatus: () => apiFetch(LINKEDIN_API, '/api/status'),
  getLinkedInConnections: (filter = {}) => {
    const params = new URLSearchParams(filter);
    return apiFetch(LINKEDIN_API, `/api/connections?${params}`);
  },
  getLinkedInAnalytics: () => apiFetch(LINKEDIN_API, '/api/analytics'),
  getLinkedInLogs: () => apiFetch(LINKEDIN_API, '/api/logs'),
  startLinkedIn: (config) => apiFetch(LINKEDIN_API, '/api/start', { method: 'POST', body: JSON.stringify(config) }),
  stopLinkedIn: () => apiFetch(LINKEDIN_API, '/api/stop', { method: 'POST' }),
  syncLinkedInStatus: (userId) => apiFetch(LINKEDIN_API, '/api/sync-status', { method: 'POST', body: JSON.stringify({ userId }) }),

  // Per-user LinkedIn account connect
  getLinkedInAccount: (userId) => apiFetch(LINKEDIN_API, `/api/linkedin-account?userId=${encodeURIComponent(userId || 'default')}`),
  connectLinkedIn: (userId) => apiFetch(LINKEDIN_API, '/api/linkedin/connect', { method: 'POST', body: JSON.stringify({ userId }) }),
  connectLinkedInCookie: (userId, liAt) => apiFetch(LINKEDIN_API, '/api/linkedin/connect-cookie', { method: 'POST', body: JSON.stringify({ userId, liAt }) }),
  disconnectLinkedIn: (userId) => apiFetch(LINKEDIN_API, '/api/linkedin/disconnect', { method: 'POST', body: JSON.stringify({ userId }) }),
  verifyLinkedIn: (userId) => apiFetch(LINKEDIN_API, '/api/linkedin/verify', { method: 'POST', body: JSON.stringify({ userId }) }),

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
    return raw ? JSON.parse(raw) : [];
  },
  add(resume) {
    const all = this.getAll();
    const makeActive = Boolean(resume.isActive || resume.makeActive) || all.length === 0;
    const next = makeActive ? all.map((r) => ({ ...r, isActive: false })) : all;
    next.push({ ...resume, id: Date.now().toString(), uploadedAt: new Date().toISOString(), isActive: makeActive });
    localStorage.setItem('wayin_resumes', JSON.stringify(next));
    return next;
  },
  setActive(id) {
    const all = this.getAll().map(r => ({ ...r, isActive: r.id === id }));
    localStorage.setItem('wayin_resumes', JSON.stringify(all));
    return all;
  },
  remove(id) {
    const all = this.getAll().filter(r => r.id !== id);
    localStorage.setItem('wayin_resumes', JSON.stringify(all));
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
    all.unshift({ ...application, id: Date.now().toString(), appliedAt: new Date().toISOString(), status: 'Applied' });
    return saveApplications(all);
  },
  updateStatus(id, status) {
    const all = this.getAll().map(a => a.id === id ? { ...a, status, lastActivity: new Date().toISOString() } : a);
    return saveApplications(all);
  },
  remove(id) {
    const all = this.getAll().filter(a => a.id !== id);
    return saveApplications(all);
  },
};
