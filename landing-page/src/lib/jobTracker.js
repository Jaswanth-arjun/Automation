/**
 * Job Tracker model.
 *
 * One entry per job the user acted on (tailored a resume for it and/or applied).
 * Everything else is derived from the sources that already own it:
 *   - resumeStore            -> tailored resume versions (count + latest PDF)
 *   - applicationStore       -> applied records / manual application status
 *   - applyProgressStore     -> which apply stage the user paused on
 *   - Gmail sent emails      -> referral outreach per role
 *   - Gmail received emails  -> application status auto-detected from mail
 *   - LinkedIn connections   -> LinkedIn outreach per company/role
 *
 * Outreach is optional: a job only shows email/LinkedIn numbers when real
 * records exist for it, so the tracker is never padded with noise.
 */
import { api, applicationStore, resumeStore, applyProgressStore, tailorReportStore } from './api';

export const norm = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const TRACKER_STATUS_META = {
  'Not applied': { bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8' },
  Tailored: { bg: '#eef2ff', color: '#4338ca', dot: '#6366f1' },
  Outreach: { bg: '#f5f3ff', color: '#6d28d9', dot: '#8b5cf6' },
  Applied: { bg: '#eff6ff', color: '#1d4ed8', dot: '#3b82f6' },
  Shortlisted: { bg: '#fffbeb', color: '#b45309', dot: '#f59e0b' },
  Assessment: { bg: '#fff7ed', color: '#c2410c', dot: '#f97316' },
  Interview: { bg: '#fdf4ff', color: '#a21caf', dot: '#d946ef' },
  Offer: { bg: '#ecfdf5', color: '#047857', dot: '#10b981' },
  Rejected: { bg: '#fef2f2', color: '#b91c1c', dot: '#ef4444' },
};

export const TRACKER_FILTERS = [
  'All',
  'Tailored',
  'Outreach',
  'Applied',
  'Interview',
  'Shortlisted',
  'Assessment',
  'Offer',
  'Rejected',
];

export const STAGE_ORDER = ['tailor', 'referral', 'linkedin', 'apply'];

export const STAGE_LABELS = {
  tailor: 'Resume tailored',
  referral: 'Referral email',
  linkedin: 'LinkedIn outreach',
  apply: 'Applied',
};

const SIGNAL_STATUS = {
  OFFER: 'Offer',
  INTERVIEW: 'Interview',
  ASSESSMENT: 'Assessment',
  SHORTLISTED: 'Shortlisted',
  REJECTED: 'Rejected',
  APPLIED: 'Applied',
};

const APPLIED_STATUSES = new Set(['Applied', 'Shortlisted', 'Assessment', 'Interview', 'Offer', 'Rejected']);

const companyMatches = (a, b) => {
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  // Avoid "AI" matching "Ai2"; allow "Amazon" to match "Amazon Web Services".
  if (shorter.length < 5) return false;
  return longer.includes(shorter);
};

const titleTokens = (title) => norm(title)
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(' ')
  .filter((word) => word.length > 3 && !['intern', 'internship', 'senior', 'junior', 'role'].includes(word));

const roleMatches = (a, b) => {
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(titleTokens(a));
  const rightTokens = titleTokens(b);
  if (!leftTokens.size || !rightTokens.length) return false;
  return rightTokens.filter((token) => leftTokens.has(token)).length >= Math.max(1, Math.ceil(rightTokens.length / 2));
};

const GENERIC_ROLES = new Set(['', 'outreach', 'unknown', 'not specified', 'n a', 'na', 'none']);

/**
 * LinkedIn campaigns are often started company-wide, and legacy records store
 * "Outreach" as the role. Treat those as a company-level match instead of
 * dropping the record because it does not name the exact job title.
 */
const roleAligned = (recorded, title) => GENERIC_ROLES.has(norm(recorded)) || roleMatches(recorded, title);

const time = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const latestOf = (values) => values
  .filter(Boolean)
  .sort((a, b) => time(b) - time(a))[0] || null;

function isReferralOnly(app) {
  // Legacy records created when a referral email was sent used status "Applied".
  return Boolean(app?.referralSentTo) && !app?.appliedViaExtension && !app?.directAppliedAt;
}

function isAppliedRecord(app) {
  if (!app) return false;
  if (app.status === 'Outreach' || app.status === 'Saved' || app.status === 'Not applied') return false;
  if (isReferralOnly(app)) return false;
  return APPLIED_STATUSES.has(app.status || 'Applied');
}

/** Fetch every source once; each may fail independently. */
export async function fetchTrackerSources() {
  const [sentResult, linkedinResult, mailResult] = await Promise.allSettled([
    api.getSentEmails(),
    api.getLinkedInConnections(),
    api.getEmails(0, 80, '', 'received'),
  ]);

  const errors = [];
  if (sentResult.status === 'rejected') errors.push('email');
  if (linkedinResult.status === 'rejected') errors.push('linkedin');
  if (mailResult.status === 'rejected') errors.push('replies');

  const sent = sentResult.status === 'fulfilled' && Array.isArray(sentResult.value)
    ? sentResult.value
    : [];
  const linkedinRaw = linkedinResult.status === 'fulfilled' ? linkedinResult.value : [];
  const linkedin = Array.isArray(linkedinRaw)
    ? linkedinRaw
    : Array.isArray(linkedinRaw?.connections)
      ? linkedinRaw.connections
      : [];
  const received = mailResult.status === 'fulfilled'
    ? (Array.isArray(mailResult.value?.emails)
      ? mailResult.value.emails
      : Array.isArray(mailResult.value) ? mailResult.value : [])
    : [];

  return { sent, linkedin, received, errors };
}

const EMAIL_STATUS_RANK = { Applied: 1, Shortlisted: 2, Assessment: 2, Interview: 3, Offer: 4, Rejected: 5 };
const squash = (value) => norm(value).replace(/[^a-z0-9]/g, '');

function mailText(mail) {
  return norm(`${mail.company || ''} ${mail.subject || ''} ${mail.snippet || ''} ${mail.senderName || ''} ${mail.senderEmail || ''}`);
}

// ATS mail often comes from a no-reply/workday address, so the company can be
// missing or generic; fall back to the company name appearing in the mail.
function mailIsFromCompany(mail, company) {
  if (!company) return false;
  if (mail.company && companyMatches(mail.company, company)) return true;
  const wanted = squash(company);
  if (wanted.length < 4) return false;
  return squash(mailText(mail)).includes(wanted);
}

/**
 * Apply application-status emails (application received, shortlisted, interview,
 * assessment, offer, rejection) to the stored application records.
 * Statuses only move forward, and only for the matching company + role.
 * Returns how many application records changed.
 */
export function applyEmailStatusUpdates(received = []) {
  const mails = (Array.isArray(received) ? received : [])
    .filter((mail) => mail?.isJobRelated && SIGNAL_STATUS[mail.signal])
    .sort((a, b) => time(b.receivedAt || b.sentAt) - time(a.receivedAt || a.sentAt));
  if (!mails.length) return 0;

  const apps = applicationStore.getAll();
  const resumes = resumeStore.getAll();
  const updates = new Map();
  let created = 0;

  for (const mail of mails) {
    const status = SIGNAL_STATUS[mail.signal];
    if (!status) continue;
    const haystack = `${mail.subject || ''} ${mail.snippet || ''}`;
    const at = mail.receivedAt || mail.sentAt || '';

    const companyApps = apps.filter((app) => mailIsFromCompany(mail, app.company));
    let target = companyApps.find((app) => app.title && roleMatches(haystack, app.title)) || null;
    if (!target && companyApps.length === 1) target = companyApps[0];

    // No application record yet: an "application received" mail for a role the
    // candidate tailored a resume for is a real application — record it.
    if (!target) {
      if (mail.signal !== 'APPLIED') continue;
      const seeds = resumes.filter((resume) => resume.company && mailIsFromCompany(mail, resume.company)
        && (!resume.title || roleMatches(haystack, resume.title)));
      const seed = seeds.length === 1 ? seeds[0] : seeds.find((resume) => roleMatches(haystack, resume.title));
      if (!seed) continue;
      applicationStore.add({
        title: seed.title || '',
        company: seed.company || '',
        companyMark: seed.companyMark,
        jobId: seed.jobId || undefined,
        jobUrl: seed.jobUrl || '',
        status,
        stage: 'apply',
        appliedViaEmail: true,
        appliedAt: at || new Date().toISOString(),
        statusSource: 'email',
        emailSignal: mail.signal,
        emailSubject: mail.subject || '',
        ...(seed.matchScore ? { matchScore: seed.matchScore } : {}),
      });
      created += 1;
      continue;
    }

    const currentStatus = target.status || 'Applied';
    const currentRank = EMAIL_STATUS_RANK[currentStatus] || 0;
    const nextRank = EMAIL_STATUS_RANK[status] || 0;
    if (nextRank < currentRank) continue;
    // Compare with the last email-derived update, not the application date: a
    // status mail can arrive later than the record was created but still be
    // the newest status evidence.
    const lastKnown = time(target.emailReceivedAt || target.lastActivity);
    if (at && lastKnown && time(at) < lastKnown && status !== 'Rejected') continue;
    if (status === currentStatus && at && lastKnown && time(at) <= lastKnown) continue;

    updates.set(target.id, {
      status,
      statusSource: 'email',
      emailSignal: mail.signal,
      emailSubject: mail.subject || '',
      emailReceivedAt: at,
      lastActivity: at || new Date().toISOString(),
    });
  }

  for (const [id, patch] of updates) {
    applicationStore.update(id, patch);
  }
  return created + updates.size;
}

function ensureEntry(map, seed) {
  const company = String(seed.company || '').trim();
  const title = String(seed.title || '').trim();
  if (!company && !title) return null;
  const jobId = seed.jobId ? String(seed.jobId) : '';

  // Check if an existing entry already matches by jobId OR company + role
  for (const existing of map.values()) {
    const idHit = jobId && existing.jobId && existing.jobId === jobId;
    const roleHit = company && title && companyMatches(existing.company, company) && roleMatches(existing.title, title);
    if (idHit || roleHit) {
      if (!existing.jobId && jobId) existing.jobId = jobId;
      if (!existing.jobUrl && seed.jobUrl) existing.jobUrl = seed.jobUrl;
      if (typeof seed.matchScore === 'number') {
        existing.matchScore = existing.matchScore !== null ? Math.max(existing.matchScore, seed.matchScore) : seed.matchScore;
      }
      if (seed.companyMark && (!existing.companyMark || existing.companyMark === '?')) {
        existing.companyMark = seed.companyMark;
      }
      return existing;
    }
  }

  const key = jobId ? `job:${jobId}` : `cr:${norm(company)}::${norm(title)}`;
  const entry = {
    key,
    jobId,
    jobUrl: seed.jobUrl || '',
    title: title || 'Role not specified',
    company: company || 'Unknown company',
    companyMark: seed.companyMark || (company || '?').charAt(0).toUpperCase(),
    matchScore: typeof seed.matchScore === 'number' ? seed.matchScore : null,
    resumes: [],
    applications: [],
    progress: {},
  };
  map.set(key, entry);
  return entry;
}

/** Merge any duplicate entries that share company + role or same jobId. */
function deduplicateTrackerEntries(map) {
  const list = [...map.values()];
  const deletedKeys = new Set();

  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (deletedKeys.has(a.key)) continue;

    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      if (deletedKeys.has(b.key)) continue;

      const sameJobId = a.jobId && b.jobId && a.jobId === b.jobId;
      const sameRole = companyMatches(a.company, b.company) && roleMatches(a.title, b.title);

      if (sameJobId || sameRole) {
        if (!a.jobId && b.jobId) a.jobId = b.jobId;
        if (!a.jobUrl && b.jobUrl) a.jobUrl = b.jobUrl;
        if ((!a.companyMark || a.companyMark === '?') && b.companyMark) {
          a.companyMark = b.companyMark;
        }
        if (typeof b.matchScore === 'number') {
          a.matchScore = typeof a.matchScore === 'number' ? Math.max(a.matchScore, b.matchScore) : b.matchScore;
        }
        a.resumes.push(...b.resumes);
        a.applications.push(...b.applications);
        a.progress = { ...b.progress, ...a.progress };

        map.delete(b.key);
        deletedKeys.add(b.key);
      }
    }
  }

  // Deduplicate inside resumes and applications lists for each surviving entry
  for (const entry of map.values()) {
    const seenR = new Set();
    entry.resumes = entry.resumes.filter((r) => {
      const id = r.id || `${r.name || ''}_${r.uploadedAt || ''}`;
      if (seenR.has(id)) return false;
      seenR.add(id);
      return true;
    });

    const seenA = new Set();
    entry.applications = entry.applications.filter((app) => {
      const id = app.id || `${app.company || ''}_${app.title || ''}_${app.appliedAt || ''}`;
      if (seenA.has(id)) return false;
      seenA.add(id);
      return true;
    });
  }
}

export function buildTrackerEntries(sources = {}) {
  const sent = Array.isArray(sources.sent) ? sources.sent : [];
  const linkedin = Array.isArray(sources.linkedin) ? sources.linkedin : [];
  const received = Array.isArray(sources.received) ? sources.received : [];
  const progressAll = applyProgressStore.getAll();
  const reportsAll = tailorReportStore.getAll();

  const map = new Map();

  resumeStore.getAll().forEach((resume) => {
    ensureEntry(map, {
      jobId: resume.jobId,
      jobUrl: resume.jobUrl,
      title: resume.title,
      company: resume.company,
      matchScore: resume.matchScore,
    })?.resumes.push(resume);
  });

  applicationStore.getAll().forEach((app) => {
    ensureEntry(map, {
      jobId: app.jobId,
      jobUrl: app.jobUrl,
      title: app.title,
      company: app.company,
      companyMark: app.companyMark,
      matchScore: app.matchScore,
    })?.applications.push(app);
  });

  deduplicateTrackerEntries(map);

  const entries = [...map.values()].map((entry) => {
    const progress = entry.jobId ? (progressAll[entry.jobId] || {}) : {};

    const resumes = [...entry.resumes].sort((a, b) => time(b.uploadedAt || b.createdAt) - time(a.uploadedAt || a.createdAt));
    const applications = [...entry.applications].sort((a, b) => time(b.appliedAt) - time(a.appliedAt));
    const appliedRecords = applications.filter(isAppliedRecord);

    const emailRecords = sent.filter((mail) =>
      companyMatches(mail.company, entry.company)
      && roleAligned(mail.jobTitle, entry.title));

    // Per-recipient reply detection: a received mail whose sender matches one of
    // the addresses we wrote to means that contact answered.
    const replyBySender = new Map();
    received.forEach((mail) => {
      const sender = norm(mail.senderEmail || mail.senders?.[0]?.email);
      if (!sender) return;
      const at = time(mail.receivedAt || mail.sentAt);
      const current = replyBySender.get(sender);
      if (!current || at > current.at) replyBySender.set(sender, { mail, at });
    });

    const emailContacts = emailRecords
      .reduce((list, mail) => {
        const key = norm(mail.recipient);
        if (!key) return list;
        const existing = list.find((contact) => contact.key === key);
        if (existing) {
          existing.sentCount += 1;
          if (time(mail.sentAt) > time(existing.sentAt)) existing.sentAt = mail.sentAt;
          if (mail.recipientName && !existing.name) existing.name = mail.recipientName;
        } else {
          list.push({
            key,
            email: mail.recipient,
            name: mail.recipientName || '',
            sentCount: 1,
            sentAt: mail.sentAt,
          });
        }
        return list;
      }, [])
      .map((contact) => {
        const hit = replyBySender.get(contact.key);
        return {
          ...contact,
          replied: Boolean(hit),
          replySubject: hit?.mail?.subject || '',
          replyAt: hit?.mail?.receivedAt || hit?.mail?.sentAt || '',
        };
      })
      .sort((a, b) => (Number(b.replied) - Number(a.replied)) || (time(b.sentAt) - time(a.sentAt)));

    const emailRecipients = emailContacts.map((contact) => contact.email);
    const email = emailRecords.length
      ? {
        sent: emailRecords.length,
        recipients: emailRecipients,
        contacts: emailContacts,
        replied: emailContacts.filter((contact) => contact.replied).length,
        latestAt: latestOf(emailRecords.map((mail) => mail.sentAt)),
        subjects: [...new Set(emailRecords.map((mail) => mail.subject).filter(Boolean))],
      }
      : null;

    // LinkedIn outreach is tracked per company, and the connection's `role` is
    // the person's job (Recruiter, HR, ...) — not the job title. So company is
    // the only reliable key here; filtering by role hid real requests.
    const liRecords = linkedin.filter((item) => companyMatches(item.company, entry.company));
    const liCount = (status) => liRecords.filter((item) => norm(item.status) === status).length;
    const linkedinStats = liRecords.length
      ? {
        sent: liRecords.length,
        accepted: liCount('accepted') + liCount('replied'),
        seen: liCount('seen'),
        replied: liCount('replied'),
        declined: liCount('declined'),
        pending: liCount('pending'),
        latestAt: latestOf(liRecords.flatMap((item) => [item.lastChecked, item.sentDate, item.sentAt, item.updatedAt])),
        contacts: [...liRecords]
          .map((item) => ({
            id: item.id || item.profileUrl || item.name,
            name: item.name || 'LinkedIn contact',
            role: item.role && !GENERIC_ROLES.has(norm(item.role)) ? item.role : '',
            headline: item.headline || '',
            status: norm(item.status) || 'pending',
            profileUrl: item.profileUrl || item.url || '',
            replyText: item.replyText || '',
            at: item.lastChecked || item.sentDate || item.sentAt || item.updatedAt || '',
          }))
          .sort((a, b) => time(b.at) - time(a.at)),
      }
      : null;

    // Status auto-detected from received mail. Company must match; role in the
    // subject/snippet is preferred over a company-only match.
    const statusMails = received
      .filter((mail) => mail.isJobRelated && SIGNAL_STATUS[mail.signal] && companyMatches(mail.company, entry.company))
      .map((mail) => {
        const haystack = `${mail.subject || ''} ${mail.snippet || ''}`;
        return { mail, roleHit: roleMatches(haystack, entry.title), at: time(mail.receivedAt || mail.sentAt) };
      })
      .sort((a, b) => (Number(b.roleHit) - Number(a.roleHit)) || (b.at - a.at));
    const detectedMail = statusMails[0]?.mail || null;
    const detected = detectedMail
      ? {
        status: SIGNAL_STATUS[detectedMail.signal],
        signal: detectedMail.signal,
        subject: detectedMail.subject,
        snippet: detectedMail.snippet,
        at: detectedMail.receivedAt || detectedMail.sentAt,
        sender: detectedMail.senderName || detectedMail.senderEmail || '',
      }
      : null;

    const appliedRecord = appliedRecords[0] || null;
    const appliedStatus = appliedRecord?.status && APPLIED_STATUSES.has(appliedRecord.status)
      ? appliedRecord.status
      : null;
    const applyDone = Boolean(appliedRecord || progress.apply || detected || appliedStatus);

    const tailorDone = resumes.length > 0 || Boolean(progress.tailor);
    const referralDone = emailRecords.length > 0 || Boolean(progress.referral);
    const linkedinDone = liRecords.length > 0 || Boolean(progress.linkedin);

    let status = 'Not applied';
    let statusSource = 'none';
    if (detected) {
      status = detected.status;
      statusSource = 'email';
    } else if (appliedStatus) {
      status = appliedStatus;
      statusSource = 'application';
    } else if (emailRecords.length || liRecords.length || progress.referral || progress.linkedin) {
      status = 'Outreach';
      statusSource = 'outreach';
    } else if (tailorDone) {
      status = 'Tailored';
      statusSource = 'resume';
    }

    const nextStage = applyDone
      ? null
      : !tailorDone
        ? 'tailor'
        : !referralDone
          ? 'referral'
          : !linkedinDone
            ? 'linkedin'
            : 'apply';

    const lastActivityAt = latestOf([
      ...resumes.map((resume) => resume.uploadedAt),
      ...applications.map((app) => app.lastActivity || app.appliedAt),
      email?.latestAt,
      linkedinStats?.latestAt,
      detected?.at,
      progress.tailor,
      progress.referral,
      progress.linkedin,
      progress.apply,
    ]);

    // Lookup saved tailoring report for ATS scores
    let matchedReport = null;
    if (entry.jobId && reportsAll[String(entry.jobId)]) {
      matchedReport = reportsAll[String(entry.jobId)];
    } else {
      matchedReport = Object.values(reportsAll).find((rep) => {
        const repCompany = rep.company || rep.report?.company || rep.report?.job?.company;
        const repTitle = rep.jobTitle || rep.report?.title || rep.report?.job?.title;
        return repCompany && repTitle && companyMatches(repCompany, entry.company) && roleMatches(repTitle, entry.title);
      }) || null;
    }

    // Keyword coverage from a real tailoring report, when one was saved for
    // this job. No report means no coverage figures — never invent a delta.
    const atsObj = matchedReport?.report?.ats || matchedReport?.report || {};
    const beforeScore = typeof atsObj.beforeScore === 'number' ? atsObj.beforeScore : null;
    const afterScore = typeof atsObj.afterScore === 'number' ? atsObj.afterScore : null;
    const hasCoverage = beforeScore !== null && afterScore !== null;

    return {
      key: entry.key,
      jobId: entry.jobId || '',
      jobUrl: entry.jobUrl || resumes[0]?.jobUrl || '',
      title: entry.title,
      company: entry.company,
      companyMark: entry.companyMark,
      matchScore: entry.matchScore,
      beforeScore,
      afterScore,
      hasCoverage,
      resumes,
      resumeCount: resumes.length,
      latestResume: resumes[0] || null,
      email,
      linkedin: linkedinStats,
      detected,
      applied: appliedRecord,
      appliedAt: appliedRecord?.appliedAt || progress.apply || null,
      appliedFlag: applyDone,
      status,
      statusSource,
      stages: {
        tailor: tailorDone,
        referral: referralDone,
        linkedin: linkedinDone,
        apply: applyDone,
      },
      nextStage,
      progress,
      lastActivityAt,
    };
  });

  return entries.sort((a, b) => time(b.lastActivityAt) - time(a.lastActivityAt));
}

export function matchesTrackerFilter(entry, filter) {
  if (filter === 'All') return true;
  if (filter === 'Tailored') return entry.resumeCount > 0;
  if (filter === 'Applied') return entry.appliedFlag;
  if (filter === 'Outreach') return Boolean(entry.email || entry.linkedin) || entry.status === 'Outreach';
  return entry.status === filter;
}
