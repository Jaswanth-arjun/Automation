import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DEFAULT_SETTINGS } from './plans.js';

/**
 * File-backed billing store.
 *
 * The rest of this app persists state as JSON under data/ (connections,
 * candidates, campaigns…), so subscriptions follow the same pattern instead
 * of introducing a second database. Every write is synchronous on purpose:
 * it serialises usage counters and payment activation inside Node's single
 * thread, which is what keeps counters from double-incrementing under
 * concurrent requests.
 */

const DIR = path.join(process.cwd(), 'data', 'billing');

const FILES = {
  settings: 'settings.json',
  users: 'users.json',
  sessions: 'sessions.json',
  subscriptions: 'subscriptions.json',
  payments: 'payments.json',
  usage: 'usage.json',
  grants: 'grants.json',
  audit: 'audit.json',
  events: 'webhook_events.json',
};

const DEFAULTS = {
  settings: () => structuredClone(DEFAULT_SETTINGS),
  users: () => [],
  sessions: () => [],
  subscriptions: () => [],
  payments: () => [],
  usage: () => ({}),
  grants: () => [],
  audit: () => [],
  events: () => ({}),
};

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function fileFor(name) {
  ensureDir();
  return path.join(DIR, FILES[name]);
}

export function readBilling(name) {
  const file = fileFor(name);
  try {
    if (!fs.existsSync(file)) return DEFAULTS[name]();
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return DEFAULTS[name]();
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[billing] Could not read ${name}:`, err.message);
    return DEFAULTS[name]();
  }
}

export function writeBilling(name, value) {
  const file = fileFor(name);
  const payload = JSON.stringify(value, null, 2);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.writeFileSync(file, payload, 'utf8');
      return value;
    } catch (err) {
      if (attempt === 2) {
        console.error(`[billing] Could not write ${name}:`, err.message);
        throw err;
      }
      const until = Date.now() + 40;
      while (Date.now() < until) { /* wait out a Windows file lock */ }
    }
  }
  return value;
}

export function mutateBilling(name, mutator) {
  const current = readBilling(name);
  const next = mutator(current);
  writeBilling(name, next === undefined ? current : next);
  return next === undefined ? current : next;
}

/* ── ids & time ─────────────────────────────────────────── */

export const nowIso = () => new Date().toISOString();

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;

/** YYYY-MM-DD in local time. */
export function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO-style week key, week starting Monday. */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function monthKey(date = new Date()) {
  return dayKey(date).slice(0, 7);
}

/** Add calendar months, clamping the day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/* ── settings ───────────────────────────────────────────── */

export function getSettings() {
  const stored = readBilling('settings');
  // Merge defensively so a partially written/older file never breaks reads.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    prices: { ...DEFAULT_SETTINGS.prices, ...(stored.prices || {}) },
    limits: {
      free: { ...DEFAULT_SETTINGS.limits.free, ...(stored.limits?.free || {}) },
      pro: { ...DEFAULT_SETTINGS.limits.pro, ...(stored.limits?.pro || {}) },
    },
    campaignRequests: { ...DEFAULT_SETTINGS.campaignRequests, ...(stored.campaignRequests || {}) },
  };
}

export function saveSettings(patch, adminEmail = '') {
  const next = {
    ...getSettings(),
    ...patch,
    prices: { ...getSettings().prices, ...(patch?.prices || {}) },
    limits: {
      free: { ...getSettings().limits.free, ...(patch?.limits?.free || {}) },
      pro: { ...getSettings().limits.pro, ...(patch?.limits?.pro || {}) },
    },
    campaignRequests: { ...getSettings().campaignRequests, ...(patch?.campaignRequests || {}) },
    updatedAt: nowIso(),
    updatedBy: adminEmail || '',
  };
  writeBilling('settings', next);
  return next;
}

/* ── users & sessions ───────────────────────────────────── */

export function listUsers() {
  return readBilling('users');
}

export function findUserByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  return listUsers().find((u) => String(u.email || '').toLowerCase() === target) || null;
}

export function findUserById(id) {
  return listUsers().find((u) => u.id === id) || null;
}

export function upsertUser({ email, displayName, avatarUrl, provider }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return null;
  const existing = findUserByEmail(cleanEmail);
  const stamp = nowIso();
  if (existing) {
    return mutateBilling('users', (users) => users.map((u) => (
      u.id === existing.id
        ? {
          ...u,
          displayName: displayName || u.displayName,
          avatarUrl: avatarUrl || u.avatarUrl,
          lastLoginAt: stamp,
          provider: provider || u.provider,
        }
        : u
    ))).find((u) => u.id === existing.id);
  }
  const user = {
    id: `usr_${crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 16)}`,
    email: cleanEmail,
    displayName: displayName || cleanEmail.split('@')[0],
    avatarUrl: avatarUrl || '',
    provider: provider || 'email',
    createdAt: stamp,
    lastLoginAt: stamp,
  };
  mutateBilling('users', (users) => [...users, user]);
  return user;
}

export function createSession(userId, ttlDays = 30) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlDays * 86400000).toISOString(),
  };
  mutateBilling('sessions', (sessions) => {
    const live = sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
    // Keep at most 40 sessions per user to bound the file.
    const mine = live.filter((s) => s.userId === userId);
    const drop = new Set(mine.slice(-39).map((s) => s.token));
    return [...live.filter((s) => !drop.has(s.token)), session];
  });
  return token;
}

export function userForToken(token) {
  const clean = String(token || '').trim();
  if (!clean) return null;
  const session = readBilling('sessions').find((s) => s.token === clean);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return findUserById(session.userId);
}

export function revokeSessions(userId) {
  mutateBilling('sessions', (sessions) => sessions.filter((s) => s.userId !== userId));
}

/* ── subscriptions ──────────────────────────────────────── */

const ACTIVE_STATUSES = new Set(['active', 'authenticated', 'pending_cancel']);

export function listSubscriptions() {
  return readBilling('subscriptions');
}

export function activeSubscriptionFor(userId, now = Date.now()) {
  return listSubscriptions()
    .filter((s) => s.userId === userId && ACTIVE_STATUSES.has(s.status))
    .filter((s) => new Date(s.expiryDate).getTime() > now)
    .sort((a, b) => new Date(b.expiryDate) - new Date(a.expiryDate))[0] || null;
}

export function saveSubscription(record) {
  const stamped = { ...record, updatedAt: nowIso() };
  mutateBilling('subscriptions', (subs) => {
    const idx = subs.findIndex((s) => s.id === record.id);
    if (idx >= 0) {
      const next = [...subs];
      next[idx] = stamped;
      return next;
    }
    return [...subs, stamped];
  });
  return stamped;
}

/**
 * Activate a paid period. Replaces any other active subscription for the user
 * (upgrades/downgrades) but never deletes history: old rows are marked
 * `superseded`.
 */
export function activateSubscription({ userId, planType = 'pro', billingCycle, source, razorpay = {}, periodStart, expiresAt, notes = '' }) {
  const start = periodStart ? new Date(periodStart) : new Date();
  const expiry = expiresAt ? new Date(expiresAt) : null;
  mutateBilling('subscriptions', (subs) => subs.map((s) => (
    s.userId === userId && ACTIVE_STATUSES.has(s.status)
      ? { ...s, status: 'superseded', supersededAt: nowIso() }
      : s
  )));
  return saveSubscription({
    id: newId('sub'),
    userId,
    planType,
    billingCycle,
    status: 'active',
    source: source || 'razorpay',
    startDate: start.toISOString(),
    expiryDate: (expiry || new Date(start)).toISOString(),
    razorpayCustomerId: razorpay.customerId || '',
    razorpaySubscriptionId: razorpay.subscriptionId || '',
    razorpayOrderId: razorpay.orderId || '',
    razorpayPaymentId: razorpay.paymentId || '',
    cancelAtPeriodEnd: false,
    cancelledAt: '',
    notes,
    createdAt: nowIso(),
  });
}

/* ── manual grants ──────────────────────────────────────── */

export function listGrants(userId) {
  return readBilling('grants').filter((g) => !userId || g.userId === userId);
}

export function activeGrantFor(userId, now = Date.now()) {
  return listGrants(userId)
    .filter((g) => g.status === 'active')
    .filter((g) => !g.expiryDate || new Date(g.expiryDate).getTime() > now)
    .sort((a, b) => new Date(b.grantDate) - new Date(a.grantDate))[0] || null;
}

export function saveGrant(record) {
  mutateBilling('grants', (grants) => {
    const idx = grants.findIndex((g) => g.id === record.id);
    if (idx >= 0) {
      const next = [...grants];
      next[idx] = record;
      return next;
    }
    return [...grants, record];
  });
  return record;
}

/* ── audit ──────────────────────────────────────────────── */

export function audit(entry) {
  const record = {
    id: newId('aud'),
    timestamp: nowIso(),
    adminId: entry.adminId || '',
    adminEmail: entry.adminEmail || '',
    userId: entry.userId || '',
    userEmail: entry.userEmail || '',
    action: entry.action,
    previousStatus: entry.previousStatus || '',
    newStatus: entry.newStatus || '',
    reason: entry.reason || '',
    meta: entry.meta || {},
  };
  mutateBilling('audit', (log) => [record, ...log].slice(0, 2000));
  return record;
}

export function listAudit(userId) {
  const log = readBilling('audit');
  return userId ? log.filter((e) => e.userId === userId) : log;
}

/* ── webhook idempotency ────────────────────────────────── */

export function hasProcessedEvent(eventId) {
  if (!eventId) return false;
  return Boolean(readBilling('events')[eventId]);
}

export function markEventProcessed(eventId, note = '') {
  if (!eventId) return;
  mutateBilling('events', (events) => {
    const next = { ...events, [eventId]: { at: nowIso(), note } };
    // Bound the ledger: keep the newest 5000 events.
    const keys = Object.keys(next);
    if (keys.length > 5000) {
      keys.slice(0, keys.length - 5000).forEach((k) => delete next[k]);
    }
    return next;
  });
}

export const BILLING_DIR = DIR;
