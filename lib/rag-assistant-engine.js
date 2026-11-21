/**
 * Hamzooh Copilot — retrieval layer.
 *
 * The copilot must never invent a contact, a company or a reply. Every answer
 * is built from the workspace's own records:
 *
 *   connections.json   LinkedIn outreach (name, company, role, status, reply)
 *   employees.json     recruiter / employee directory
 *   sent_emails.json   referral emails already sent
 *   jobs.json          admin-posted roles
 *   resumes/*.pdf      tailored resumes written by the apply flow
 *   clientState        applications kept in the browser (applicationStore)
 *
 * Record-list questions are answered deterministically from those facts, so a
 * model can only ever rephrase verified data — not add to it. Free-form
 * overview questions get the same verified facts as ground-truth context.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const RESUME_DIR = path.join(DATA_DIR, 'resumes');

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

const fileCache = new Map();

function readJson(dataDir, file, fallback) {
  const full = path.join(dataDir, file);
  try {
    const stat = fs.statSync(full);
    const hit = fileCache.get(full);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value;
    const value = JSON.parse(fs.readFileSync(full, 'utf8'));
    fileCache.set(full, { mtimeMs: stat.mtimeMs, value });
    return value;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const LEGAL_SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|group|technologies|technology|systems|solutions|services|private|pvt|plc|gmbh|holdings|international)\b/g;

export function normCompany(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9&+\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companyMatches(value, key) {
  if (!key) return false;
  const candidate = normCompany(value);
  if (!candidate) return false;
  if (candidate === key) return true;
  // "Twilio Inc" → twilio, "Electronic Arts" vs "Electronic Arts Inc".
  return candidate.includes(key) || key.includes(candidate);
}

const DISPLAY_OVERRIDES = {
  ea: 'Electronic Arts',
  ai2: 'AI2',
  tcs: 'TCS',
  ibm: 'IBM',
  sap: 'SAP',
};

const TECH_LEXICON = [
  'google', 'alphabet', 'amazon', 'aws', 'microsoft', 'meta', 'facebook', 'apple', 'netflix',
  'adobe', 'salesforce', 'oracle', 'dell', 'honeywell', 'nvidia', 'intel', 'cisco', 'ibm',
  'uber', 'twilio', 'zoho', 'flipkart', 'swiggy', 'zomato', 'paytm', 'razorpay', 'tesla',
  'stripe', 'atlassian', 'servicenow', 'vmware', 'qualcomm', 'samsung', 'sony', 'walmart',
  'goldman sachs', 'jpmorgan', 'morgan stanley', 'optum', 'accenture', 'infosys', 'wipro',
  'cognizant', 'capgemini', 'deloitte', 'electronic arts', 'ea', 'ai2', 'zebra', 'carousell',
  'zetwerk', 'angel one',
];

function titleCase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (DISPLAY_OVERRIDES[key]) return DISPLAY_OVERRIDES[key];
  return raw
    .split(/\s+/)
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function humanDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function clip(value, length = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function linkedInLink(connection) {
  const url = String(connection.profileUrl || connection.url || '');
  const name = String(connection.name || 'Unknown');
  return /^https?:\/\//i.test(url) ? `[${name}](${url})` : `**${name}**`;
}

/* ------------------------------------------------------------------ */
/* Intent + entity extraction                                          */
/* ------------------------------------------------------------------ */

const INTENT_RULES = [
  { intent: 'resume', test: /\b(resume|cv|pdf|tailor(ed)?)\b|resume\s*(ivvu|kavali|kaavali)|cv\s*(ivvu|kavali)/i },
  { intent: 'email', test: /\b(mail|email|inbox|smtp|gmail)\b|mail\s*lo|email\s*lo/i },
  { intent: 'applications', test: /\bappl(y|ied|ication|ications)\b|apply\s*ches|chesanu|chesenu|chesa\b|apply\s*chesin/i },
  { intent: 'jobs', test: /\b(jobs?|openings?|roles?|positions?|skills?)\b|jobs?\s*(list|chupinchu|ivvu)/i },
  { intent: 'employees', test: /\b(recruiters?|employees?|hr|contacts?|hiring)\b|employees?\s*(ivvu|kavali)/i },
];

function detectIntent(message) {
  const text = String(message || '');
  const replyAsked = /\brepl(y|ied|ies|ying)\b|reply\s*ich|respond(ed)?|reply\s*vach/i.test(text);
  const linkedInAsked = /\b(linked?\s?in|linkdin|network|connections?)\b/i.test(text);
  const awaiting = /(not|didn'?t|never|no)\s+(reply|replied|respond)|reply\s*(ledu|raledu)|innka\s*reply|not\s*replied/i.test(text);

  if (replyAsked && /\b(mail|email|inbox|gmail)\b|mail\s*lo|email\s*lo/i.test(text)) return { intent: 'email', awaiting };
  if (replyAsked && linkedInAsked) return { intent: 'linkedin', status: awaiting ? 'awaiting' : 'replied' };
  if (replyAsked && !linkedInAsked) return { intent: 'linkedin', status: awaiting ? 'awaiting' : 'replied' };

  for (const rule of INTENT_RULES) {
    if (rule.intent === 'jobs' || rule.intent === 'employees') continue;
    if (rule.test.test(text)) return { intent: rule.intent, status: '' };
  }
  // "network lo Google lo work chesey employees" is a network question even
  // though it contains the word "employees".
  if (linkedInAsked) return { intent: 'linkedin', status: awaiting ? 'awaiting' : '' };
  for (const rule of INTENT_RULES) {
    if (rule.intent !== 'jobs' && rule.intent !== 'employees') continue;
    if (rule.test.test(text)) return { intent: rule.intent, status: '' };
  }
  if (/\b(who|evaru|evaraina)\b.*\b(work|company)\b/i.test(text)) {
    return { intent: 'linkedin', status: awaiting ? 'awaiting' : '' };
  }
  if (/\b(summary|overview|status|report|dashboard|ela\s*undi|em\s*jarugutundi)\b/i.test(text)) {
    return { intent: 'overview', status: '' };
  }
  return { intent: 'general', status: '' };
}

// Placeholder employer names (imported jobs often say just "Company") must
// never count as a real company: "... for which company?" would then be scoped
// to that placeholder and return nothing.
const PLACEHOLDER_COMPANIES = new Set([
  'company', 'the company', 'companies', 'unknown', 'n a', 'na', 'none', 'null',
  'confidential', 'private', 'employer', 'client', 'organization', 'organisation',
]);

function extractCompany(message, companies) {
  const text = ` ${String(message || '').toLowerCase().replace(/[^a-z0-9&+\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  const pool = new Map();
  for (const name of companies) {
    const key = normCompany(name);
    if (PLACEHOLDER_COMPANIES.has(key)) continue;
    if (key.length >= 3 && !pool.has(key)) pool.set(key, name);
    const alias = key.split(' ')[0];
    if (alias.length >= 3 && !PLACEHOLDER_COMPANIES.has(alias) && !pool.has(alias)) pool.set(alias, name);
  }
  for (const name of TECH_LEXICON) {
    const key = normCompany(name);
    if (key.length >= 3 && !pool.has(key)) pool.set(key, name);
  }
  const keys = [...pool.keys()].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (text.includes(` ${key} `) || text.includes(` ${key},`) || text.includes(` ${key}?`)) {
      const display = pool.get(key);
      const known = companies.some((name) => companyMatches(name, key));
      return { name: titleCase(display), key, known };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export class HamzoohRAGEngine {
  constructor(options = {}) {
    this.dataDir = options.dataDir || DATA_DIR;
    this.resumeDir = options.resumeDir || RESUME_DIR;
    this.refreshIndices();
  }

  refreshIndices() {
    const connections = readJson(this.dataDir, 'connections.json', []);
    const employees = readJson(this.dataDir, 'employees.json', []);
    const sentEmails = readJson(this.dataDir, 'sent_emails.json', []);
    const jobs = readJson(this.dataDir, 'jobs.json', []);
    const applications = readJson(this.dataDir, 'applications.json', []);
    const blueprints = readJson(this.dataDir, 'application_blueprints.json', {});
    this.connections = Array.isArray(connections) ? connections : [];
    this.employees = Array.isArray(employees) ? employees : [];
    this.sentEmails = Array.isArray(sentEmails) ? sentEmails : [];
    this.jobs = Array.isArray(jobs) ? jobs : [];
    this.storedApplications = Array.isArray(applications) ? applications : [];
    this.blueprints = blueprints && typeof blueprints === 'object' ? blueprints : {};
    return this;
  }

  /* Tool 1 — LinkedIn network, filtered by company / status / name. */
  queryLinkedIn({ company = '', status = '', name = '' } = {}) {
    const key = normCompany(company);
    return this.connections.filter((connection) => {
      // "Who works at Google?" must mean the company field. A headline such as
      // "... | Google Data Analytics Certified" does NOT make someone a Google
      // employee, so it is only used when the company field is empty.
      const employer = String(connection.company || '').trim();
      const matchCompany = !key
        || companyMatches(employer, key)
        || (!employer && companyMatches(connection.headline, key));
      const replyText = String(connection.replyText || '').trim();
      const state = String(connection.status || '').toLowerCase();
      const matchStatus = !status
        || (status === 'replied' ? state === 'replied' || Boolean(replyText)
          : status === 'awaiting' ? state !== 'replied' && !replyText
            : status === 'connected' ? state === 'connected' || state === 'accepted'
              : state === status);
      const matchName = !name || String(connection.name || '').toLowerCase().includes(name.toLowerCase());
      return matchCompany && matchStatus && matchName;
    });
  }

  /* Tool 2 — Referral emails already sent. */
  queryEmails({ company = '', hasReply = null } = {}) {
    const key = normCompany(company);
    return this.sentEmails.filter((email) => {
      if (!key) return true;
      return companyMatches(email.company, key);
    }).filter((email) => {
      if (hasReply === null) return true;
      return hasReply ? this.emailHasReply(email) : !this.emailHasReply(email);
    });
  }

  emailHasReply(email) {
    const status = String(email.status || '').toLowerCase();
    return status.includes('repl') || Boolean(String(email.replyText || '').trim());
  }

  /* Tool 3 — Tailored resume PDFs on disk. */
  findResumes({ company = '' } = {}) {
    let files = [];
    try { files = fs.readdirSync(this.resumeDir); } catch { return []; }
    const key = normCompany(company);
    return files
      .filter((file) => /\.pdf$/i.test(file))
      .map((filename) => {
        const meta = parseResumeFilename(filename);
        return {
          filename,
          company: meta.company,
          owner: meta.owner,
          downloadUrl: `/api/resumes/download/${encodeURIComponent(filename)}`,
          previewUrl: `/api/resumes/${encodeURIComponent(filename)}`,
        };
      })
      .filter((resume) => !key || companyMatches(resume.company, key));
  }

  /* Tool 4 — Employee / recruiter directory. */
  queryEmployees({ company = '', name = '' } = {}) {
    const key = normCompany(company);
    return this.employees.filter((employee) => {
      const matchCompany = !key || companyMatches(employee.company, key);
      const matchName = !name || String(employee.name || '').toLowerCase().includes(name.toLowerCase());
      return matchCompany && matchName;
    });
  }

  /* Tool 5 — Applications (browser store, then any server-side records). */
  queryApplications(clientApplications = [], { company = '' } = {}) {
    const key = normCompany(company);
    const source = Array.isArray(clientApplications) && clientApplications.length
      ? clientApplications
      : this.storedApplications;
    return source
      .map((application) => ({
        company: String(application.company || application.employer || '').trim(),
        role: String(application.role || application.title || application.jobTitle || '').trim(),
        status: String(application.status || 'Applied').trim(),
        stage: String(application.stage || '').trim(),
        appliedAt: application.appliedAt || application.createdAt || application.updatedAt || '',
        matchScore: Number(application.matchScore ?? application.score ?? NaN),
        appliedViaExtension: Boolean(application.appliedViaExtension),
        resumeUsed: String(application.resumeUsed || application.resumeName || '').trim(),
        jobId: application.jobId || application.id || '',
      }))
      .filter((application) => !key || companyMatches(application.company, key))
      .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
  }

  /* Tool 6 — Admin-posted jobs. */
  queryJobs({ company = '', skill = '' } = {}) {
    const key = normCompany(company);
    const skillKey = String(skill || '').toLowerCase();
    return this.jobs.filter((job) => {
      const matchCompany = !key || companyMatches(job.company, key);
      const skills = [
        ...(Array.isArray(job.mustHaveSkills) ? job.mustHaveSkills : []),
        ...(Array.isArray(job.goodToHaveSkills) ? job.goodToHaveSkills : []),
      ].join(' ').toLowerCase();
      return matchCompany && (!skillKey || skills.includes(skillKey));
    });
  }

  knownCompanies() {
    const names = [
      ...this.connections.map((item) => item.company),
      ...this.sentEmails.map((item) => item.company),
      ...this.jobs.map((item) => item.company),
      ...this.employees.map((item) => item.company),
    ];
    return [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))];
  }

  /* ---------------------------------------------------------------- */
  /* Retrieval                                                         */
  /* ---------------------------------------------------------------- */

  retrieve(message, clientState = {}) {
    this.refreshIndices();
    const text = String(message || '');
    const { intent, status } = detectIntent(text);
    const company = extractCompany(text, this.knownCompanies());
    const applications = Array.isArray(clientState.applications) ? clientState.applications : [];
    const emailReplies = Array.isArray(clientState.emailReplies) ? clientState.emailReplies : [];

    if (intent === 'resume') return this.resumeAnswer(company);
    if (intent === 'email') return this.emailAnswer(company, emailReplies);
    if (intent === 'applications') return this.applicationAnswer(company, applications);
    if (intent === 'jobs') return this.jobAnswer(company, text);
    if (intent === 'employees') return this.employeeAnswer(company);
    if (intent === 'linkedin') return this.linkedInAnswer(company, status);
    if (intent === 'overview') return this.overviewAnswer(applications);
    return this.generalAnswer(company);
  }

  linkedInAnswer(company, status) {
    const filterLabel = status === 'replied' ? 'who replied' : status === 'awaiting' ? 'who has not replied yet' : 'your network';
    const allMatches = this.queryLinkedIn({
      company: company ? company.key : '',
      status: status === 'replied' ? 'replied' : status === 'awaiting' ? 'awaiting' : '',
    });
    const matches = allMatches.slice(0, 60);
    const totalMatches = allMatches.length;
    const shownNote = totalMatches > matches.length ? `\n\n*Showing the first ${matches.length} of ${totalMatches}. Open LinkedIn automation for the full list.*` : '';
    const actions = [];
    const lines = [];

    if (company && matches.length === 0) {
      const recruiters = this.queryEmployees({ company: company.key });
      const totalNetwork = this.connections.length;
      const repliedCount = this.connections.filter((item) => item.status === 'replied' || String(item.replyText || '').trim()).length;
      lines.push(`You currently do not have any connections working at **${company.name}** in your network.`);
      lines.push('');
      lines.push(`- LinkedIn records checked: ${totalNetwork} connections (${repliedCount} replied)`);
      lines.push(`- ${company.name} recruiters in the discovery directory: ${recruiters.length}`);
      if (recruiters.length) {
        lines.push('');
        lines.push(`### ${company.name} contacts in the directory`);
        recruiters.slice(0, 8).forEach((person) => {
          lines.push(`- **${person.name}** — ${person.role || 'Recruiter'}${person.email ? ` · ${person.email}` : ''}`);
        });
        actions.push({ type: 'route', label: `Open ${company.name} recruiters`, path: '/dashboard/mail' });
      }
      actions.push({ type: 'route', label: 'Open LinkedIn automation', path: '/dashboard/linkedin' });
      return this.result({
        answer: lines.join('\n'),
        actions,
        facts: { intent: 'linkedin', company: company.name, matches: [], recruiters: recruiters.length },
        summary: { intent: 'linkedin', company: company.name, total: 0, recruiters: recruiters.length },
        useLLM: false,
      });
    }

    if (company) {
      lines.push(`### ${company.name} — ${totalMatches} connection${totalMatches === 1 ? '' : 's'}${status === 'replied' ? ' who replied' : status === 'awaiting' ? ' still waiting for a reply' : ''}`);
      if (!matches.length) {
        lines.push(`No ${company.name} connection matches "${filterLabel}" in your records.`);
      } else {
        matches.forEach((person) => {
          const bits = [
            person.role || 'Connection',
            person.status ? `status: ${person.status}` : '',
            person.sentDate ? `invited ${humanDate(person.sentDate)}` : '',
          ].filter(Boolean);
          lines.push(`- ${linkedInLink(person)} — ${bits.join(' · ')}`);
          const reply = String(person.replyText || '').trim();
          if (reply) lines.push(`  ↳ *${clip(reply, 200)}*`);
        });
      }
    } else if (status === 'replied' || status === 'awaiting') {
      lines.push(`### LinkedIn ${status === 'replied' ? 'replies' : 'connections still waiting for a reply'} (${totalMatches})`);
      if (!matches.length) {
        lines.push(status === 'replied' ? 'No LinkedIn replies recorded yet.' : 'Everyone in your outreach has replied.');
      } else {
        matches.forEach((person) => {
          const reply = String(person.replyText || '').trim();
          lines.push(`- ${linkedInLink(person)} — ${person.role || 'Connection'}${person.company ? ` at ${person.company}` : ''}`);
          if (reply) lines.push(`  ↳ *${clip(reply, 200)}*`);
        });
      }
    } else {
      const byCompany = new Map();
      matches.forEach((person) => {
        const name = String(person.company || 'Unknown').trim();
        byCompany.set(name, (byCompany.get(name) || 0) + 1);
      });
      lines.push(`### Your LinkedIn network — ${totalMatches} connections across ${byCompany.size} companies`);
      [...byCompany.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .forEach(([name, count]) => lines.push(`- **${name}** — ${count} connection${count === 1 ? '' : 's'}`));
      if (!matches.length) lines.push('No LinkedIn connections are stored yet. Run a campaign to build your network.');
      actions.push({ type: 'route', label: 'Open LinkedIn automation', path: '/dashboard/linkedin' });
    }

    return this.result({
      answer: lines.join('\n') + shownNote,
      actions,
      facts: {
        intent: 'linkedin',
        company: company ? company.name : '',
        status: status || '',
        people: matches.slice(0, 40).map((person) => ({
          name: person.name,
          company: person.company,
          role: person.role,
          status: person.status,
          profileUrl: person.profileUrl || '',
          replyText: clip(person.replyText, 220),
        })),
      },
      summary: { intent: 'linkedin', company: company ? company.name : '', total: totalMatches },
      useLLM: false,
    });
  }

  emailAnswer(company, emailReplies) {
    const emails = this.queryEmails({ company: company ? company.key : '' });
    const replied = emails.filter((email) => this.emailHasReply(email));
    const extraReplies = emailReplies.filter((reply) => !company || companyMatches(reply.company, company.key));
    const lines = [];
    const actions = [];
    const byCompany = new Map();
    emails.forEach((email) => {
      const name = String(email.company || 'Unknown').trim();
      const entry = byCompany.get(name) || { count: 0, roles: new Set(), replied: 0, recipients: new Set() };
      entry.count += 1;
      if (email.jobTitle) entry.roles.add(String(email.jobTitle).trim());
      if (this.emailHasReply(email)) entry.replied += 1;
      if (email.recipient) entry.recipients.add(String(email.recipient).trim());
      byCompany.set(name, entry);
    });

    const scope = company ? `${company.name} ` : '';
    lines.push(`### Email outreach${company ? ` — ${company.name}` : ''}`);
    lines.push(`- Emails sent: **${emails.length}** across **${byCompany.size}** companies`);
    lines.push(`- Replies recorded: **${replied.length}**${extraReplies.length ? ` · ${extraReplies.length} in the synced mailbox` : ''}`);

    if (emails.length === 0) {
      lines.push('');
      lines.push(`No referral emails have been sent to ${scope || 'any company'} yet.`);
    } else {
      lines.push('');
      [...byCompany.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 15)
        .forEach(([name, entry]) => {
          const roles = [...entry.roles].slice(0, 2).join(', ');
          lines.push(`- **${name}** — ${entry.count} email${entry.count === 1 ? '' : 's'}${roles ? ` · ${roles}` : ''} · ${entry.replied ? `**${entry.replied} replied**` : 'no reply yet'}`);
        });
    }

    if (replied.length) {
      lines.push('');
      lines.push('### Who replied');
      replied.slice(0, 20).forEach((email) => {
        lines.push(`- **${email.recipientName || email.recipient}** — ${email.company || 'Unknown'}${email.jobTitle ? ` · ${email.jobTitle}` : ''}`);
        lines.push(`  ↳ *${clip(email.replyText, 200)}*`);
      });
    } else {
      lines.push('');
      lines.push('No email replies are recorded in your workspace yet. Reply detection comes from the Gmail sync — once a recruiter answers, the response shows up here.');
    }

    if (extraReplies.length) {
      lines.push('');
      lines.push('### Replies from your synced mailbox');
      extraReplies.slice(0, 12).forEach((reply) => {
        lines.push(`- **${reply.recipientName || reply.recipient || reply.from || 'Recruiter'}** — ${reply.company || 'Unknown'}${reply.subject ? ` · ${clip(reply.subject, 90)}` : ''}`);
      });
    }

    actions.push({ type: 'route', label: 'Open Mail automation', path: '/dashboard/mail' });
    return this.result({
      answer: lines.join('\n'),
      actions,
      facts: {
        intent: 'email',
        company: company ? company.name : '',
        sent: emails.length,
        replies: replied.length,
        groups: [...byCompany.entries()].slice(0, 20).map(([name, entry]) => ({
          company: name,
          emails: entry.count,
          replied: entry.replied,
          roles: [...entry.roles].slice(0, 3),
        })),
      },
      summary: { intent: 'email', company: company ? company.name : '', total: emails.length, replies: replied.length },
      useLLM: false,
    });
  }

  applicationAnswer(company, clientApplications) {
    const applications = this.queryApplications(clientApplications, { company: company ? company.key : '' });
    const lines = [];
    const actions = [];
    const byStatus = new Map();
    applications.forEach((application) => {
      byStatus.set(application.status, (byStatus.get(application.status) || 0) + 1);
    });

    lines.push(`### Applications${company ? ` — ${company.name}` : ''}`);
    if (!applications.length) {
      lines.push(clientApplications.length
        ? `No applications recorded for ${company ? company.name : 'a company'} yet.`
        : 'No applications are saved in this browser yet. Apply to a job from Job Tracker and it will appear here.');
      actions.push({ type: 'route', label: 'Open Job Tracker', path: '/dashboard/applications' });
      return this.result({
        answer: lines.join('\n'),
        actions,
        facts: { intent: 'applications', company: company ? company.name : '', applications: [] },
        summary: { intent: 'applications', company: company ? company.name : '', total: 0 },
        useLLM: false,
      });
    }

    lines.push(`- Total applications: **${applications.length}**`);
    [...byStatus.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => lines.push(`- ${status}: ${count}`));
    lines.push('');
    applications.slice(0, 25).forEach((application) => {
      const bits = [
        application.status,
        application.stage ? `stage: ${application.stage}` : '',
        application.appliedAt ? `applied ${humanDate(application.appliedAt)}` : '',
        Number.isFinite(application.matchScore) ? `match ${Math.round(application.matchScore)}%` : '',
        application.appliedViaExtension ? 'auto-applied' : '',
      ].filter(Boolean);
      lines.push(`- **${application.company || 'Unknown'}** — ${application.role || 'Role'} · ${bits.join(' · ')}`);
    });
    actions.push({ type: 'route', label: 'Open Job Tracker', path: '/dashboard/applications' });

    return this.result({
      answer: lines.join('\n'),
      actions,
      facts: {
        intent: 'applications',
        company: company ? company.name : '',
        applications: applications.slice(0, 30),
        statuses: Object.fromEntries(byStatus),
      },
      summary: { intent: 'applications', company: company ? company.name : '', total: applications.length },
      useLLM: false,
    });
  }

  resumeAnswer(company) {
    const resumes = this.findResumes({ company: company ? company.key : '' });
    const all = this.findResumes({});
    const lines = [];
    const actions = [];

    if (!resumes.length) {
      lines.push(company
        ? `No tailored resume is stored for **${company.name}** yet.`
        : 'No tailored resumes are stored yet.');
      if (all.length) {
        lines.push('');
        lines.push(`Stored resumes (${all.length}):`);
        all.slice(0, 10).forEach((resume) => lines.push(`- ${resume.company || 'Unnamed'} — \`${resume.filename}\``));
      }
      actions.push({ type: 'route', label: 'Tailor a resume', path: '/dashboard/resume' });
      return this.result({
        answer: lines.join('\n'),
        actions,
        facts: { intent: 'resume', company: company ? company.name : '', resumes: [] },
        summary: { intent: 'resume', company: company ? company.name : '', total: 0 },
        useLLM: false,
      });
    }

    lines.push(`### Tailored resume${resumes.length === 1 ? '' : 's'}${company ? ` for ${company.name}` : ''}`);
    resumes.forEach((resume) => {
      lines.push(`- **${resume.company || company?.name || 'Resume'}** — \`${resume.filename}\``);
      actions.push({
        type: 'download',
        label: `Download ${resume.company || 'resume'} PDF`,
        filename: resume.filename,
        url: resume.downloadUrl,
      });
    });
    lines.push('');
    lines.push('Click the button below the answer to download the exact PDF that was generated for that application.');

    return this.result({
      answer: lines.join('\n'),
      actions,
      facts: { intent: 'resume', company: company ? company.name : '', resumes },
      summary: { intent: 'resume', company: company ? company.name : '', total: resumes.length },
      useLLM: false,
    });
  }

  jobAnswer(company, message) {
    const skillMatch = String(message || '').match(/\b(react|node|python|java|sql|machine learning|ml|data|frontend|backend|full\s?stack|android|ios|cloud|devops)\b/i);
    const jobs = this.queryJobs({
      company: company ? company.key : '',
      skill: skillMatch ? skillMatch[1] : '',
    });
    const lines = [];
    const actions = [];
    lines.push(`### Open roles${company ? ` at ${company.name}` : ''}${skillMatch ? ` for ${skillMatch[1]}` : ''}`);
    if (!jobs.length) {
      lines.push('No posted role matches that filter right now.');
      actions.push({ type: 'route', label: 'Browse jobs', path: '/dashboard/jobs' });
    } else {
      jobs.slice(0, 12).forEach((job) => {
        const skills = (job.mustHaveSkills || []).slice(0, 4).join(', ');
        lines.push(`- **${job.role || job.title || 'Role'}** — ${job.company || 'Hamzooh'}${skills ? ` · ${skills}` : ''}`);
        actions.push({ type: 'route', label: `${job.company || 'Job'} — ${job.role || 'role'}`, path: `/dashboard/jobs/${job.id}` });
      });
      actions.push({ type: 'route', label: 'Browse all jobs', path: '/dashboard/jobs' });
    }
    return this.result({
      answer: lines.join('\n'),
      actions: actions.slice(0, 4),
      facts: {
        intent: 'jobs',
        company: company ? company.name : '',
        jobs: jobs.slice(0, 15).map((job) => ({
          role: job.role || job.title,
          company: job.company,
          location: job.location || job.filters?.location || '',
          skills: (job.mustHaveSkills || []).slice(0, 6),
        })),
      },
      summary: { intent: 'jobs', company: company ? company.name : '', total: jobs.length },
      useLLM: false,
    });
  }

  employeeAnswer(company) {
    const employees = this.queryEmployees({ company: company ? company.key : '' }).slice(0, 25);
    const lines = [];
    lines.push(`### Directory contacts${company ? ` at ${company.name}` : ''} — ${employees.length}`);
    if (!employees.length) {
      lines.push(`No directory contacts stored for ${company ? company.name : 'this filter'} yet. Use employee discovery on the Mail page to add recruiters.`);
    } else {
      employees.forEach((employee) => {
        lines.push(`- **${employee.name}** — ${employee.role || 'Contact'}${employee.email ? ` · ${employee.email}` : ''}`);
      });
    }
    return this.result({
      answer: lines.join('\n'),
      actions: [{ type: 'route', label: 'Open Mail automation', path: '/dashboard/mail' }],
      facts: {
        intent: 'employees',
        company: company ? company.name : '',
        employees: employees.map((employee) => ({
          name: employee.name,
          company: employee.company,
          role: employee.role,
          email: employee.email,
        })),
      },
      summary: { intent: 'employees', company: company ? company.name : '', total: employees.length },
      useLLM: false,
    });
  }

  overviewAnswer(clientApplications) {
    const connections = this.connections;
    const repliedLinkedIn = connections.filter((item) => item.status === 'replied' || String(item.replyText || '').trim());
    const applications = this.queryApplications(clientApplications, {});
    const resumes = this.findResumes({});
    const emails = this.sentEmails;
    const emailReplies = emails.filter((email) => this.emailHasReply(email));

    const answer = [
      '### Workspace overview',
      `- LinkedIn: **${connections.length}** connections · **${repliedLinkedIn.length}** replied`,
      `- Referral emails: **${emails.length}** sent · **${emailReplies.length}** replied`,
      `- Applications tracked: **${applications.length}**`,
      `- Tailored resumes on file: **${resumes.length}**`,
      `- Posted roles: **${this.jobs.length}**`,
      '',
      'Ask me about any company (e.g. "Google employees in my network"), a reply status, your applications, or a tailored resume.',
    ].join('\n');

    return this.result({
      answer,
      actions: [{ type: 'route', label: 'Open Job Tracker', path: '/dashboard/applications' }],
      facts: {
        intent: 'overview',
        linkedin: { connections: connections.length, replied: repliedLinkedIn.length },
        email: { sent: emails.length, replied: emailReplies.length },
        applications: applications.slice(0, 10),
        resumes: resumes.map((resume) => resume.filename),
        jobs: this.jobs.length,
      },
      summary: {
        intent: 'overview',
        total: connections.length + emails.length + applications.length,
        applications: applications.length,
      },
      useLLM: Boolean(clientApplications.length || connections.length),
    });
  }

  generalAnswer(company) {
    const lines = [
      'I answer only from your Hamzooh records — LinkedIn outreach, referral emails, applications, tailored resumes and posted jobs.',
      '',
      'Try asking:',
      '- "Google employees in my network"',
      '- "Who replied to my emails?"',
      '- "Which companies have I applied to?"',
      '- "Give me my Twilio tailored resume"',
      '- "Who didn\'t reply on LinkedIn?"',
    ];
    if (company) {
      const count = this.queryLinkedIn({ company: company.key }).length;
      lines.push('');
      lines.push(`**${company.name}**: ${count} LinkedIn connection${count === 1 ? '' : 's'}, ${this.queryEmployees({ company: company.key }).length} directory contacts, ${this.queryEmails({ company: company.key }).length} emails sent.`);
    }
    return this.result({
      answer: lines.join('\n'),
      actions: [],
      facts: { intent: 'general', company: company ? company.name : '' },
      summary: { intent: 'general', total: 0 },
      useLLM: false,
    });
  }

  result({ answer, actions, facts, summary, useLLM }) {
    return { answer, actions: actions || [], facts, summary, useLLM: Boolean(useLLM) };
  }
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

export function buildSystemPrompt(retrieval) {
  return [
    'You are the Hamzooh Copilot, embedded in the user\'s career workspace.',
    'Answer ONLY from the VERIFIED DATA below. Never invent contacts, companies, replies, dates or statistics.',
    'If the data is empty, say so plainly and suggest a next action — do not guess.',
    'Format with short markdown bullets. Never print raw URLs: use [Name](url) links.',
    'Answer in the language the user writes in (English or Telugu-English mix).',
    '',
    'VERIFIED DATA:',
    JSON.stringify(retrieval.facts, null, 2),
  ].join('\n');
}

export function parseResumeFilename(filename) {
  const base = String(filename || '');
  const stripped = base
    .replace(/^\d+_/, '')
    .replace(/-?tailored-resume\.pdf$/i, '')
    .replace(/\.pdf$/i, '');
  const parts = stripped.split('-').filter(Boolean);
  const ownerRaw = parts.shift() || '';
  return {
    owner: ownerRaw.replace(/_/g, ' ').trim(),
    company: parts.join(' ').trim(),
  };
}

export const ragEngine = new HamzoohRAGEngine();
export default ragEngine;
