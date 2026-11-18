/**
 * Activity store — one row per company + role.
 *
 * The row data is *derived* from the sources that already own it:
 *   - Gmail sent emails      -> email outreach
 *   - Gmail received emails  -> replies
 *   - LinkedIn connections   -> referral status
 *   - applicationStore       -> application status (single source of truth)
 *
 * Only small UI state lives here (which reply was handled, replies we sent from
 * the drawer). Application status is never duplicated — it always comes from
 * applicationStore, so the Applications page and this table stay in sync.
 */
import { api, applicationStore } from './api';

const OVERLAY_KEY = 'hamzooh_activity_overlay';

export const APPLICATION_STATUS_OPTIONS = [
  'Not applied',
  'Applied',
  'Shortlisted',
  'Rejected',
  'Interview',
  'Offer',
];

export const norm = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function rowKey(company, role) {
  return `${norm(company)}::${norm(role)}`;
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function readOverlay() {
  const value = readJSON(OVERLAY_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

function writeOverlay(next) {
  localStorage.setItem(OVERLAY_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('activity_updated'));
}

/** Application statuses grouped into the buckets the table understands. */
export function appBucket(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'shortlisted' || value === 'interview' || value === 'offer') return 'Shortlisted';
  if (value === 'rejected') return 'Rejected';
  if (value === 'applied' || value === 'outreach' || value === 'response' || value === 'saved') return 'Applied';
  return 'Not applied';
}

const stripSubject = (subject) =>
  String(subject || '')
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();

const isBounce = (mail) => {
  const from = norm(mail?.senderEmail || mail?.from);
  const subject = norm(mail?.subject);
  return from.includes('mailer-daemon') || from.includes('mail-delivery') || subject.includes('delivery status notification');
};

function extractRoleFromNote(note) {
  const text = String(note || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Referral outreach';

  const patterns = [
    // "... at Acme in Software Engineering."
    /\b(?:in|for)\s+([A-Z][A-Za-z0-9 /&+.-]{2,60}?)(?:\.|,|\s+at\s+|$)/,
    // "... exploring the Software Engineer Intern role at Acme."
    /\bexploring\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 /&+().-]{2,70}?)\s+(?:role|opportunit(?:y|ies))\b/i,
    // "... Full Stack Software Engineering Intern opportunities at Acme."
    /\b([A-Za-z][A-Za-z0-9 /&+.-]{2,70}?\s+Intern)\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const role = match[1].trim().replace(/\s+/g, ' ');
    if (role.length > 2) return role;
  }
  return 'Referral outreach';
}

function latestDate(values) {
  let latest = 0;
  values.forEach((value) => {
    if (!value) return;
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time > latest) latest = time;
  });
  return latest || null;
}

/**
 * Fetch the live sources once. Every source is allowed to fail independently
 * so a stopped LinkedIn server does not hide Gmail outreach.
 */
export async function fetchActivitySources() {
  const [sentResult, linkedinResult, mailResult] = await Promise.allSettled([
    api.getSentEmails(),
    api.getLinkedInConnections(),
    api.getEmails(0, 80, '', 'received'),
  ]);

  const errors = [];
  if (sentResult.status === 'rejected') errors.push('email');
  if (linkedinResult.status === 'rejected') errors.push('linkedin');
  if (mailResult.status === 'rejected') errors.push('replies');

  const sent = sentResult.status === 'fulfilled' && Array.isArray(sentResult.value) ? sentResult.value : [];
  const linkedinRaw = linkedinResult.status === 'fulfilled' ? linkedinResult.value : [];
  const linkedin = Array.isArray(linkedinRaw)
    ? linkedinRaw
    : Array.isArray(linkedinRaw?.connections)
      ? linkedinRaw.connections
      : [];
  const received =
    mailResult.status === 'fulfilled'
      ? Array.isArray(mailResult.value?.emails)
        ? mailResult.value.emails
        : Array.isArray(mailResult.value)
          ? mailResult.value
          : []
      : [];

  return { sent, linkedin, received, errors };
}

/** Recalculate reply/attention flags after local UI state changes. */
function decorateRow(row, overlay) {
  const state = overlay?.[row.id] || {};
  const handled = state.handled || {};
  const sentReplies = state.sentReplies || {};

  let emailSent = 0;
  let emailReplied = 0;
  let liSent = 0;
  let liAccepted = 0;
  let liSeen = 0;
  let liReplied = 0;
  let liDeclined = 0;
  let unhandled = 0;
  let latestEmailSent = null;

  const contacts = row.contacts.map((contact) => {
    const isHandled = Boolean(handled[contact.id]);
    const next = { ...contact, replyHandled: isHandled, sentReply: sentReplies[contact.id] || null };

    if (next.emails?.length) {
      emailSent += next.emails.length;
      next.emails.forEach((email) => {
        latestEmailSent = latestDate([latestEmailSent, email.sentAt]);
      });
      if (next.reply) {
        emailReplied += 1;
        if (!isHandled) unhandled += 1;
      }
    }

    if (next.linkedin) {
      liSent += 1;
      const status = String(next.linkedin.status || 'pending').toLowerCase();
      if (status === 'accepted' || status === 'replied') liAccepted += 1;
      if (status === 'seen') liSeen += 1;
      if (status === 'replied') liReplied += 1;
      if (status === 'declined') liDeclined += 1;
      if (next.linkedinReply && !isHandled) unhandled += 1;
    }

    return next;
  });

  const lastActivityAt =
    latestDate([
      ...contacts.flatMap((contact) => [
        contact.linkedin?.lastChecked,
        contact.linkedin?.sentAt,
        contact.sentReply?.at,
        ...(contact.emails || []).map((email) => email.sentAt),
      ]),
      ...contacts.map((contact) => contact.reply?.receivedAt || contact.linkedinReply?.receivedAt),
      row.app?.lastActivity,
      row.app?.appliedAt,
    ]) || null;

  const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
  const followUpDue =
    emailSent > 0 &&
    emailReplied === 0 &&
    Boolean(latestEmailSent) &&
    new Date(latestEmailSent).getTime() < fiveDaysAgo;

  const acceptedNoReply = liAccepted > 0 && liReplied === 0;

  let attentionScore = 0;
  if (unhandled > 0) attentionScore += 100;
  if (acceptedNoReply) attentionScore += 20;
  if (followUpDue) attentionScore += 30;

  return {
    ...row,
    contacts,
    emailSent,
    emailReplied,
    liSent,
    liAccepted,
    liSeen,
    liReplied,
    liDeclined,
    unhandledReplies: unhandled,
    needsReply: unhandled > 0,
    awaitingReply: (emailSent > 0 || liSent > 0) && emailReplied === 0 && liReplied === 0,
    followUpDue,
    lastActivityAt,
    attentionScore,
  };
}

/**
 * Build the rows shown in the table.
 * `sources` comes from fetchActivitySources(); `overlay` from readOverlay().
 */
export function buildActivityRows(sources = {}, overlay = readOverlay()) {
  const sent = Array.isArray(sources.sent) ? sources.sent : [];
  const linkedin = Array.isArray(sources.linkedin) ? sources.linkedin : [];
  const received = Array.isArray(sources.received) ? sources.received : [];

  const applications = applicationStore.getAll();
  const rows = new Map();

  const ensureRow = (company, role) => {
    const cleanCompany = String(company || 'Unknown company').trim();
    const cleanRole = String(role || 'Role not specified').trim();
    const id = rowKey(cleanCompany, cleanRole);
    if (!rows.has(id)) {
      const app = applications.find(
        (item) => norm(item.company) === norm(cleanCompany) && norm(item.title) === norm(cleanRole),
      );
      rows.set(id, {
        id,
        company: cleanCompany,
        role: cleanRole,
        companyMark: cleanCompany.charAt(0).toUpperCase(),
        contacts: [],
        app: app || null,
        applicationStatus: app?.status || 'Not applied',
      });
    }
    return rows.get(id);
  };

  /* ---------- Email outreach ---------- */
  const ownSenders = new Set(sent.map((email) => norm(email.sender || email.senderEmail)));
  const replies = received.filter(
    (mail) => !isBounce(mail) && !ownSenders.has(norm(mail.senderEmail)) && mail.subject,
  );
  const bounces = received.filter(isBounce);

  const replyBySentId = new Map();
  const sortedSent = [...sent].sort(
    (a, b) => new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime(),
  );

  // 1. Direct 1-to-1 match: email recipient matches reply sender
  const unassignedReplies = [];
  replies.forEach((mail) => {
    const sender = norm(mail.senderEmail);
    const directSent = sortedSent.find(
      (email) => !replyBySentId.has(email.id) && sender && norm(email.recipient) === sender,
    );
    if (directSent) {
      replyBySentId.set(directSent.id, mail);
    } else {
      unassignedReplies.push(mail);
    }
  });

  const bounceFor = (email) => {
    const recipient = norm(email.recipient);
    if (!recipient) return null;
    return (
      bounces.find((mail) => String(mail.bodyText || mail.snippet || '').toLowerCase().includes(recipient)) || null
    );
  };

  sent.forEach((email) => {
    const row = ensureRow(email.company, email.jobTitle);
    const contactId = `email:${norm(email.recipient) || email.id}`;
    let contact = row.contacts.find((item) => item.id === contactId);
    if (!contact) {
      contact = {
        id: contactId,
        name: email.recipientName || email.recipient || 'Email contact',
        email: email.recipient || '',
        title: 'Email contact',
        channel: 'email',
        emails: [],
      };
      row.contacts.push(contact);
    }

    const reply = replyBySentId.get(email.id);
    const bounce = reply ? null : bounceFor(email);

    contact.emails.push({
      id: email.id,
      subject: email.subject || '',
      body: email.bodyText || '',
      sentAt: email.sentAt,
      status: email.status || 'Sent',
      bounced: Boolean(bounce),
      bounceReason: bounce ? String(bounce.snippet || bounce.subject || 'Delivery failed') : '',
    });

    if (reply) {
      contact.reply = {
        id: reply.id,
        subject: reply.subject || '',
        body: reply.bodyText || reply.snippet || '',
        from: reply.senderName || reply.senderEmail || 'Recipient',
        fromEmail: reply.senderEmail || '',
        receivedAt: reply.receivedAt || reply.sentAt,
        threadId: reply.threadId || '',
      };
    }
  });

  // 2. Separate contact for replies from hiring managers whose recipient was different
  unassignedReplies.forEach((mail) => {
    const subject = stripSubject(mail.subject);
    const matchingSent = sortedSent.find((email) => subject && stripSubject(email.subject) === subject);
    if (matchingSent) {
      const row = ensureRow(matchingSent.company, matchingSent.jobTitle);
      const contactId = `email:${norm(mail.senderEmail) || mail.id}`;
      let contact = row.contacts.find((item) => item.id === contactId);
      if (!contact) {
        contact = {
          id: contactId,
          name: mail.senderName || mail.senderEmail || 'Sender',
          email: mail.senderEmail || '',
          title: 'Hiring Team',
          channel: 'email',
          emails: [],
        };
        row.contacts.push(contact);
      }
      contact.reply = {
        id: mail.id,
        subject: mail.subject || '',
        body: mail.bodyText || mail.snippet || '',
        from: mail.senderName || mail.senderEmail || 'Recipient',
        fromEmail: mail.senderEmail || '',
        receivedAt: mail.receivedAt || mail.sentAt,
        threadId: mail.threadId || '',
      };
    }
  });

  /* ---------- LinkedIn outreach ---------- */
  const linkedinByCompany = new Map();
  linkedin.forEach((connection) => {
    const company = norm(connection.company) || 'unknown company';
    if (!linkedinByCompany.has(company)) linkedinByCompany.set(company, []);
    linkedinByCompany.get(company).push(connection);
  });

  linkedinByCompany.forEach((connections, companyKey) => {
    const companyName = connections[0]?.company || 'Unknown company';
    const existing = [...rows.values()]
      .filter((row) => norm(row.company) === companyKey)
      .sort((a, b) => new Date(b.app?.appliedAt || 0) - new Date(a.app?.appliedAt || 0));

    let row;
    if (existing.length) {
      // LinkedIn does not tell us the target role, so attach the people to the
      // company's newest opportunity row instead of inventing a duplicate row.
      row = existing[0];
    } else {
      row = ensureRow(companyName, extractRoleFromNote(connections[0]?.note));
    }

    connections.forEach((connection) => {
      const status = String(connection.status || 'pending').toLowerCase();
      const contactId = `li:${connection.id || norm(connection.name)}`;
      if (row.contacts.some((item) => item.id === contactId)) return;
      const contact = {
        id: contactId,
        name: connection.name || 'LinkedIn member',
        email: '',
        title: connection.role || connection.headline || 'LinkedIn member',
        channel: 'linkedin',
        linkedin: {
          status,
          profileUrl: connection.profileUrl || connection.id || '',
          headline: connection.headline || '',
          note: connection.note || '',
          sentAt: connection.sentDate || '',
          lastChecked: connection.lastChecked || '',
        },
      };
      if (status === 'replied' && String(connection.replyText || '').trim()) {
        contact.linkedinReply = {
          body: connection.replyText,
          receivedAt: connection.lastChecked || connection.sentDate,
        };
      }
      row.contacts.push(contact);
    });
  });

  /* ---------- Applied jobs without outreach ---------- */
  applications.forEach((app) => {
    const row = ensureRow(app.company, app.title);
    if (!row.app) {
      row.app = app;
      row.applicationStatus = app.status || 'Applied';
    }
    if (app.matchScore !== undefined) row.matchScore = app.matchScore;
    if (app.companyMark) row.companyMark = app.companyMark;
  });

  /* ---------- Finish rows ---------- */
  const output = [...rows.values()]
    .map((row) => decorateRow(row, overlay))
    .sort((a, b) => {
      if (b.attentionScore !== a.attentionScore) return b.attentionScore - a.attentionScore;
      return new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0) || a.company.localeCompare(b.company);
    });

  return output;
}

export const activityStore = {
  getOverlay: readOverlay,

  getRowState(rowId) {
    const overlay = readOverlay();
    return overlay?.[rowId] || {};
  },

  markHandled(rowId, contactId, handled = true) {
    const overlay = readOverlay();
    const row = { ...(overlay[rowId] || {}) };
    const handledMap = { ...(row.handled || {}) };
    if (handled) handledMap[contactId] = new Date().toISOString();
    else delete handledMap[contactId];
    row.handled = handledMap;
    overlay[rowId] = row;
    writeOverlay(overlay);
  },

  saveSentReply(rowId, contactId, reply) {
    const overlay = readOverlay();
    const row = { ...(overlay[rowId] || {}) };
    row.sentReplies = { ...(row.sentReplies || {}), [contactId]: reply };
    row.handled = { ...(row.handled || {}), [contactId]: new Date().toISOString() };
    overlay[rowId] = row;
    writeOverlay(overlay);
  },

  /**
   * Write the application status to applicationStore (the shared source of
   * truth). Creates the application when needed and removes it for
   * "Not applied", so the Applications page always matches this table.
   */
  setApplicationStatus(row, status) {
    const existing = applicationStore
      .getAll()
      .find((item) => norm(item.company) === norm(row.company) && norm(item.title) === norm(row.role));

    if (status === 'Not applied') {
      if (existing) applicationStore.remove(existing.id);
      return 'Not applied';
    }

    if (existing) {
      applicationStore.updateStatus(existing.id, status);
      return status;
    }

    const all = applicationStore.add({
      title: row.role,
      company: row.company,
      companyMark: row.companyMark,
      jobId: row.jobId,
      matchScore: row.matchScore,
    });
    const created = all[0];
    if (created?.id) applicationStore.updateStatus(created.id, status);
    return status;
  },
};
