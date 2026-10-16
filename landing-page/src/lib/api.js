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
  addEmployee: (payload) => apiFetch('', '/api/employees', { method: 'POST', body: JSON.stringify(payload) }),
  restoreEmployees: (employees) => apiFetch('', '/api/employees/bulk', { method: 'POST', body: JSON.stringify({ employees }) }),
  deleteEmployee: (id) => apiFetch('', `/api/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getSentEmails: () => apiFetch('', '/api/sent-emails'),
  tailorExternalJob: (payload) => apiFetch('', '/api/external-job/tailor', { method: 'POST', body: JSON.stringify(payload) }),

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

export function getUserName(user, profile) {
  const savedProfile = profile !== undefined ? profile : profileStore.get();
  if (savedProfile?.fullName && savedProfile.fullName.trim()) {
    return savedProfile.fullName.trim();
  }

  if (user?.displayName) {
    const dName = user.displayName.trim();
    const isEmailHandle = user.email && (dName === user.email || dName === user.email.split('@')[0] || (/^[a-z0-9._-]+$/i.test(dName) && /\d+/.test(dName)));
    if (!isEmailHandle && !dName.includes('@')) {
      return dName;
    }
  }

  const handle = user?.displayName || user?.email?.split('@')[0] || savedProfile?.email?.split('@')[0] || '';
  if (handle) {
    const rawParts = handle.replace(/\d+/g, '').split(/[._-]+/).filter(Boolean);
    const validParts = rawParts.filter(p => p.length > 2 || rawParts.length === 1);
    const partsToUse = validParts.length > 0 ? validParts : rawParts;
    if (partsToUse.length > 0) {
      return partsToUse.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
    }
  }

  return 'User';
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
export const applicationStore = {
  getAll() {
    const raw = localStorage.getItem('wayin_applications');
    return raw ? JSON.parse(raw) : [];
  },
  add(application) {
    const all = this.getAll();
    all.unshift({ ...application, id: Date.now().toString(), appliedAt: new Date().toISOString(), status: 'Applied' });
    localStorage.setItem('wayin_applications', JSON.stringify(all));
    return all;
  },
  updateStatus(id, status) {
    const all = this.getAll().map(a => a.id === id ? { ...a, status, lastActivity: new Date().toISOString() } : a);
    localStorage.setItem('wayin_applications', JSON.stringify(all));
    return all;
  },
};
