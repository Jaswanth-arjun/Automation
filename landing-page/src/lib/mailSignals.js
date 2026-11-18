/**
 * Hamzo mail signals.
 *
 * These helpers are deliberately deterministic. They do not call an LLM, so
 * every row can show a label and a reason instantly. The backend computes the
 * same values; this file is the fallback for older servers and the single
 * source of truth for labels/tones used by the UI.
 */

export const SIGNAL_META = {
  OFFER: { label: 'Offer', tone: 'success', priority: 100, needsReply: true, job: true },
  INTERVIEW: { label: 'Interview', tone: 'indigo', priority: 92, needsReply: true, job: true },
  ASSESSMENT: { label: 'Assessment', tone: 'amber', priority: 84, needsReply: true, job: true },
  SHORTLISTED: { label: 'Shortlisted', tone: 'blue', priority: 74, needsReply: true, job: true },
  RECRUITER: { label: 'Recruiter', tone: 'blue', priority: 62, needsReply: true, job: true },
  REJECTED: { label: 'Update', tone: 'danger', priority: 45, needsReply: false, job: true },
  APPLIED: { label: 'Applied', tone: 'cyan', priority: 55, needsReply: false, job: true },
  NEWSLETTER: { label: 'Newsletter', tone: 'purple', priority: 6, needsReply: false, job: false },
  OTHER: { label: 'General', tone: 'neutral', priority: 20, needsReply: false, job: false },
};

export const PIPELINE_SIGNALS = ['OFFER', 'INTERVIEW', 'ASSESSMENT', 'SHORTLISTED', 'RECRUITER', 'REJECTED'];

const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com',
  'mail.com', 'zoho.com', 'rediffmail.com', 'yandex.com', 'gmx.com', 'fastmail.com',
]);

const ATS_DOMAINS = new Set([
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'workday.com', 'myworkdayjobs.com',
  'smartrecruiters.com', 'icims.com', 'taleo.net', 'successfactors.com', 'ashbyhq.com',
  'hackerrank.com', 'codility.com', 'hirevue.com', 'naukri.com', 'unstop.com',
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'wellfound.com', 'internshala.com',
  'superset.com', 'mynexthire.com', 'jobvite.com', 'bamboohr.com', 'recruitee.com',
  'freshteam.com', 'zohorecruit.com', 'keka.com', 'darwinbox.com', 'rippling.com',
]);

const SUPPRESS_COMPANY_DOMAINS = new Set([
  'google.com', 'microsoft.com', 'apple.com', 'github.com', 'openai.com', 'chatgpt.com',
  'anthropic.com', 'notion.so', 'slack.com', 'zoom.us', 'dropbox.com', 'amazon.com',
  'cloudflare.com', 'adobe.com', 'atlassian.com', 'meta.com', 'facebook.com',
  'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'vercel.com', 'netlify.com',
]);

function domainMatches(domain, domains) {
  if (!domain) return false;
  for (const known of domains) {
    if (domain === known || domain.endsWith(`.${known}`)) return true;
  }
  return false;
}

const SKIP_LABELS = new Set([
  'mail', 'email', 'careers', 'career', 'jobs', 'job', 'recruiting', 'recruitment',
  'talent', 'hr', 'no-reply', 'noreply', 'notifications', 'notify', 'hello', 'team',
  'info', 'support', 'accounts', 'account', 'security',
]);

const SUBJECT_COMPANY_STOPWORDS = new Set([
  'connected', 'account', 'accounts', 'application', 'applications', 'interview',
  'interviews', 'referral', 'referrals', 'your', 'our', 'my', 'the', 'this',
  'that', 'thanks', 'thank', 'you', 'team', 'role', 'position', 'job', 'opportunity',
  'hiring', 'careers', 'career', 'company', 'recruiter', 'senior', 'junior',
  'internship', 'intern', 'remote', 'us', 'me', 'all', 'a', 'an',
]);

export function detectSignal(subject = '', snippet = '', bodyText = '') {
  const text = `${subject} ${snippet} ${String(bodyText || '').slice(0, 2500)}`.toLowerCase();

  if (/offer letter|offer of employment|pleased to offer|delighted to offer|we are offering you/.test(text)) return 'OFFER';
  if (/\bregret\b|unfortunately|not (?:be )?(?:moving forward|selected|progressing)|unsuccessful|we have decided not|cannot offer|position has been filled/.test(text)) return 'REJECTED';
  if (/interview|technical round|hr round|schedule (?:a|your) call|hiring manager (?:would like|wants) to (?:speak|talk)|panel discussion/.test(text)) return 'INTERVIEW';
  if (/assessment|online test|coding (?:test|challenge|assignment)|hackerrank|codility|take[- ]home|aptitude test|\boa\b/.test(text)) return 'ASSESSMENT';
  if (/shortlist|selected for (?:the )?next|next round|move(?:d)? forward/.test(text)) return 'SHORTLISTED';
  if (/application (?:received|submitted)|thanks? for applying|we received your application|successfully applied/.test(text)) return 'APPLIED';
  if (/recruiter|talent acquisition|hiring manager|referral|opportunit|open role|job opening|position at/.test(text)) return 'RECRUITER';
  return 'OTHER';
}

export function extractCompany(fromEmail = '', subject = '') {
  const email = String(fromEmail || '').trim().toLowerCase();
  const domain = email.includes('@') ? email.split('@').pop() : '';

  if (!domain || domainMatches(domain, PUBLIC_DOMAINS) || domainMatches(domain, SUPPRESS_COMPANY_DOMAINS)) {
    const match = String(subject || '').match(/\b(?:at|with|from|to)\s+([A-Z][A-Za-z0-9&.\-]{2,32})/);
    if (!match) return '';
    const candidate = match[1].replace(/[.,].*$/, '').trim();
    if (SUBJECT_COMPANY_STOPWORDS.has(candidate.toLowerCase())) return '';
    return candidate;
  }
  if (domainMatches(domain, ATS_DOMAINS)) return '';

  const labels = domain.split('.');
  let pick = labels[0];
  if (SKIP_LABELS.has(pick) && labels.length > 2) pick = labels[1];
  if (!pick) return '';
  return pick
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Normalises a raw API email. Server-provided fields win; the client only fills
 * gaps so the UI still works against a stale backend.
 */
export function decorateMail(mail, mailbox) {
  const signal = mail?.signal || detectSignal(mail?.subject, mail?.snippet, mail?.bodyText);
  const meta = SIGNAL_META[signal] || SIGNAL_META.OTHER;
  const sender = mail?.senders?.[0] || {};

  return {
    ...mail,
    id: mail?.id,
    mailbox: mail?.mailbox || mailbox,
    signal,
    signalLabel: meta.label,
    company: mail?.company || extractCompany(sender.email || mail?.senderEmail, mail?.subject),
    isJobRelated: mail?.isJobRelated ?? Boolean(meta.job),
    needsReply: mail?.needsReply ?? (mailbox === 'INBOX' && meta.needsReply),
    priority: numberOr(mail?.priority, meta.priority),
    senderName: mail?.senderName || sender.name || 'Unknown sender',
    senderEmail: mail?.senderEmail || sender.email || '',
    tags: Array.isArray(mail?.tags) ? mail.tags : [meta.label],
  };
}

export function mailContext(mail) {
  const sender = mail?.senders?.[0] || {};
  return {
    subject: mail?.subject || '',
    from: sender.name || mail?.senderName || '',
    to: sender.name || '',
    email: sender.email || mail?.senderEmail || '',
    body: mail?.bodyText || mail?.snippet || '',
  };
}

export function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff < 60 * 1000) return 'Just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 48 * 60 * 60 * 1000) return 'Yesterday';
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function daysSince(iso) {
  if (!iso) return 0;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

export function initials(name = '', email = '') {
  const source = String(name || email || '?').trim();
  if (!source) return '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function senderLabel(mail) {
  if (!mail) return '';
  if (mail.mailbox === 'SENT') {
    const recipient = mail.senders?.[0];
    return recipient?.name || recipient?.email || 'Recipient';
  }
  return mail.senderName || mail.senderEmail || 'Unknown sender';
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
