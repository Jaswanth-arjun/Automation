import fs from 'fs';
import path from 'path';
import {
  FEATURES, FEATURE_KEYS, AI_MODELS, FREE_CONTACT_UNLOCK,
  priceFor, yearlySavings,
} from './plans.js';
import {
  activeGrantFor, activeSubscriptionFor, dayKey, getSettings, listSubscriptions,
  listUsers, monthKey, mutateBilling, nowIso, readBilling, findUserById,
  upsertUser, userForToken, weekKey, writeBilling,
} from './store.js';

/**
 * Entitlement service — the only place that answers "can this user do X?".
 *
 * Nothing else in the app should compare plan names. Endpoints call
 * `guardFeature()` / `consumeFeature()` and the frontend renders whatever
 * `/api/subscription/me` returns.
 */

const GMAIL_TOKENS_FILE = path.join(process.cwd(), 'data', 'gmail_tokens.json');

function ownerEmailFromTokens() {
  try {
    if (!fs.existsSync(GMAIL_TOKENS_FILE)) return '';
    const tokens = JSON.parse(fs.readFileSync(GMAIL_TOKENS_FILE, 'utf8'));
    return String(tokens?.email || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

/** Bearer token → user. Falls back to the connected Gmail account or configured admin. */
export function resolveUser(req) {
  const header = String(req?.headers?.authorization || '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (token) {
    const user = userForToken(token);
    if (user) return user;
  }
  const emailHeader = String(req?.headers?.['x-user-email'] || req?.headers?.['x-admin-email'] || '').trim().toLowerCase();
  if (emailHeader) {
    const known = listUsers().find((u) => String(u.email || '').toLowerCase() === emailHeader);
    if (known) return known;
    if (adminEmails().includes(emailHeader)) {
      return upsertUser({ email: emailHeader, displayName: emailHeader.split('@')[0], provider: 'admin' });
    }
  }
  const email = ownerEmailFromTokens();
  if (email) {
    const known = listUsers().find((u) => String(u.email || '').toLowerCase() === email);
    return known || upsertUser({ email, displayName: email.split('@')[0], provider: 'gmail' });
  }
  const admins = adminEmails();
  if (admins.length) {
    const defaultAdmin = admins[0];
    const known = listUsers().find((u) => String(u.email || '').toLowerCase() === defaultAdmin);
    return known || upsertUser({ email: defaultAdmin, displayName: defaultAdmin.split('@')[0], provider: 'admin' });
  }
  return null;
}

export function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminUser(user) {
  if (!user) return false;
  const list = adminEmails();
  if (list.length) return list.includes(String(user.email || '').toLowerCase());
  // No explicit admin list: the owner account (the Gmail identity the app runs
  // as) is the admin. This keeps the current single-owner install working.
  const owner = ownerEmailFromTokens();
  return Boolean(owner) && String(user.email || '').toLowerCase() === owner;
}

/* ── subscription lifecycle ─────────────────────────────── */

export function sweepExpirations(reason = 'expiry sweep') {
  const now = Date.now();
  let changed = 0;

  mutateBilling('subscriptions', (subs) => subs.map((sub) => {
    if (sub.status === 'pending_cancel' && new Date(sub.expiryDate).getTime() <= now) {
      changed += 1;
      return { ...sub, status: 'expired', expiredAt: nowIso(), expiryReason: reason };
    }
    if (sub.status === 'active' && new Date(sub.expiryDate).getTime() <= now) {
      changed += 1;
      return { ...sub, status: 'expired', expiredAt: nowIso(), expiryReason: reason };
    }
    return sub;
  }));

  mutateBilling('grants', (grants) => grants.map((grant) => {
    if (grant.status === 'active' && grant.expiryDate && new Date(grant.expiryDate).getTime() <= now) {
      changed += 1;
      return { ...grant, status: 'expired', expiredAt: nowIso() };
    }
    return grant;
  }));

  return changed;
}

let sweeper = null;
export function startExpirySweeper(intervalMs = 60_000) {
  if (sweeper) return sweeper;
  sweepExpirations('startup');
  sweeper = setInterval(() => {
    try { sweepExpirations(); } catch (err) { console.error('[billing] sweep failed:', err.message); }
  }, intervalMs);
  sweeper.unref?.();
  return sweeper;
}

/* ── access ─────────────────────────────────────────────── */

const LEGACY_ACCESS = {
  premiumEnabled: false,
  planId: 'legacy',
  isPro: true,
  source: 'legacy',
  model: '',
  unlockedContacts: Infinity,
  campaignRequests: Infinity,
  alerts: 'instant',
  subscription: null,
  grant: null,
  limits: {},
};

export function accessForUser(user) {
  const settings = getSettings();
  if (!settings.globalPremiumEnabled) return { ...LEGACY_ACCESS };

  const now = Date.now();
  const sub = user ? activeSubscriptionFor(user.id, now) : null;
  const grant = user ? activeGrantFor(user.id, now) : null;

  const isPro = Boolean(sub || grant);
  const planId = isPro ? 'pro' : 'free';
  const limits = { ...(settings.limits[planId] || {}) };

  return {
    premiumEnabled: true,
    planId,
    isPro,
    source: sub ? 'razorpay' : grant ? 'admin' : 'free',
    model: AI_MODELS[planId],
    unlockedContacts: isPro ? Infinity : (settings.contactUnlockFree ?? FREE_CONTACT_UNLOCK),
    campaignRequests: isPro ? Infinity : (settings.campaignRequests?.free ?? 10),
    alerts: isPro ? 'instant' : 'standard',
    subscription: sub,
    grant,
    limits,
    settings,
  };
}

export function accessFromRequest(req) {
  const user = resolveUser(req);
  return { user, access: accessForUser(user) };
}

/** Safe, frontend-facing snapshot. Never includes payment secrets. */
export function accessSnapshot(user, access) {
  const settings = getSettings();
  const usage = user ? usageSummary(user.id, access) : [];
  const payments = user
    ? readBilling('payments')
      .filter((p) => p.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50)
    : [];
  const subscription = user ? activeSubscriptionFor(user.id) : null;
  const renewal = subscription ? {
    expiryDate: subscription.expiryDate,
    cycle: subscription.billingCycle,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
  } : null;

  return {
    user: user ? {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    } : null,
    premiumEnabled: access.premiumEnabled,
    plan: {
      id: access.planId,
      name: access.planId === 'legacy' ? 'Full access' : access.planId === 'pro' ? 'Pro' : 'Free',
      isPro: access.isPro,
      source: access.source,
      model: access.model || AI_MODELS.free,
      alerts: access.alerts,
      unlockedContacts: access.unlockedContacts === Infinity ? null : access.unlockedContacts,
      campaignRequests: access.campaignRequests === Infinity ? null : access.campaignRequests,
    },
    subscription: subscription ? {
      id: subscription.id,
      cycle: subscription.billingCycle,
      status: subscription.status,
      source: subscription.source,
      startDate: subscription.startDate,
      expiryDate: subscription.expiryDate,
      cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
      razorpayPaymentId: subscription.razorpayPaymentId || '',
      razorpaySubscriptionId: subscription.razorpaySubscriptionId || '',
      amount: subscription.amount || 0,
    } : null,
    renewal,
    grant: access.grant ? {
      id: access.grant.id,
      grantedBy: access.grant.grantedByEmail || access.grant.grantedBy || '',
      grantDate: access.grant.grantDate,
      expiryDate: access.grant.expiryDate || '',
      reason: access.grant.reason || '',
    } : null,
    usage,
    payments: payments.map((p) => ({
      id: p.id,
      plan: p.billingCycle,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt || '',
      razorpayPaymentId: p.razorpayPaymentId || '',
      razorpayOrderId: p.razorpayOrderId || '',
    })),
    pricing: {
      currency: settings.currency,
      monthly: Number(settings.prices.pro_monthly) || 0,
      yearly: Number(settings.prices.pro_yearly) || 0,
      savings: yearlySavings(settings),
    },
  };
}

/* ── usage ──────────────────────────────────────────────── */

function periodKeys(period) {
  const now = new Date();
  if (period === 'day') return { bucket: 'day', key: dayKey(now) };
  if (period === 'week') return { bucket: 'week', key: weekKey(now) };
  return { bucket: 'month', key: monthKey(now) };
}

function limitFor(access, featureKey) {
  if (access.planId === 'legacy') return null;
  const limit = access.limits?.[featureKey];
  if (limit === undefined) return FEATURES[featureKey]?.[access.planId] ?? null;
  return limit;
}

export function readUsage(userId, featureKey) {
  const all = readBilling('usage');
  const entry = all?.[userId]?.[featureKey] || {};
  const def = FEATURES[featureKey];
  if (!def || def.period === 'campaign') return { used: 0, limit: null, period: 'campaign' };
  const { bucket, key } = periodKeys(def.period);
  const current = entry[bucket];
  const used = current && current.key === key ? Number(current.count) || 0 : 0;
  return { used, period: def.period, resetKey: key };
}

export function usageSummary(userId, access) {
  return Object.entries(FEATURES)
    .filter(([, def]) => def.style === 'counter')
    .map(([key, def]) => {
      const { used } = readUsage(userId, key);
      const limit = limitFor(access, key);
      return {
        feature: key,
        label: def.label,
        period: def.period,
        used,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
        percent: limit === null || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100)),
      };
    });
}

/**
 * Increment usage and report whether the action is allowed.
 * Returns `{ ok, used, limit, remaining, unlimited }`.
 */
export function consumeFeature(user, featureKey, amount = 1, accessArg = null) {
  const access = accessArg || accessForUser(user);
  const def = FEATURES[featureKey];
  if (!def || def.style !== 'counter') return { ok: true, unlimited: true, used: 0, limit: null, remaining: null };

  // Premium off → the app behaves exactly as it did before subscriptions existed.
  if (access.planId === 'legacy') return { ok: true, unlimited: true, used: 0, limit: null, remaining: null };

  const limit = limitFor(access, featureKey);
  const { bucket, key } = periodKeys(def.period);
  const all = readBilling('usage');
  const userUsage = { ...(all[user?.id] || {}) };
  const entry = { ...(userUsage[featureKey] || {}) };
  const current = entry[bucket];
  const used = current && current.key === key ? Number(current.count) || 0 : 0;

  if (limit !== null && used + amount > limit) {
    return {
      ok: false,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      unlimited: false,
      period: def.period,
      feature: featureKey,
      label: def.label,
    };
  }

  entry[bucket] = { key, count: used + amount, at: nowIso() };
  userUsage[featureKey] = entry;
  writeBilling('usage', { ...all, [user?.id]: userUsage });

  return {
    ok: true,
    used: used + amount,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used - amount),
    unlimited: limit === null,
  };
}

/** Build a 402 response payload the frontend turns into an upgrade prompt. */
export function upgradePayload(result, access) {
  return {
    error: `${result.label || 'This feature'} limit reached on the Free plan.`,
    code: 'UPGRADE_REQUIRED',
    feature: result.feature,
    used: result.used,
    limit: result.limit,
    period: result.period,
    plan: access?.planId || 'free',
  };
}

/** Express helper: consume or send 402. Returns true when the action may proceed. */
export function guardFeature(req, res, featureKey, amount = 1) {
  const { user, access } = accessFromRequest(req);
  const result = consumeFeature(user, featureKey, amount, access);
  if (!result.ok) {
    res.status(402).json(upgradePayload(result, access));
    return false;
  }
  return true;
}

/* ── contact access ─────────────────────────────────────── */

export function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at < 0) return '•••••';
  const domain = value.slice(at + 1);
  return `•••••@${domain}`;
}

/**
 * Applies the Free contact cap to a discovered contact list.
 * Locked rows keep name/role/company so the user can see the opportunity,
 * but the email is replaced before it ever leaves the server.
 */
export function applyContactAccess(list, access) {
  const rows = Array.isArray(list) ? list : [];
  if (access.planId === 'legacy' || access.unlockedContacts === Infinity) {
    return {
      contacts: rows.map((row) => ({ ...row, locked: false })),
      access: { discovered: rows.length, unlocked: rows.length, locked: 0, cap: null },
    };
  }

  const cap = Number(access.unlockedContacts) || 0;
  const contacts = rows.map((row, index) => {
    if (index < cap) return { ...row, locked: false };
    const { email, ...rest } = row;
    return {
      ...rest,
      email: maskEmail(email),
      emailDomain: String(email || '').split('@')[1] || '',
      locked: true,
      unlockHint: 'Upgrade to Pro to unlock this contact',
    };
  });

  return {
    contacts,
    access: {
      discovered: rows.length,
      unlocked: Math.min(cap, rows.length),
      locked: Math.max(0, rows.length - cap),
      cap,
    },
  };
}

/* ── admin helpers ──────────────────────────────────────── */

export function billingOverview() {
  const settings = getSettings();
  const users = listUsers();
  const subs = listSubscriptions();
  const payments = readBilling('payments');
  const now = Date.now();

  const isActive = (sub) => ['active', 'pending_cancel'].includes(sub.status) && new Date(sub.expiryDate).getTime() > now;
  const activeSubs = subs.filter(isActive);
  const paidUserIds = new Set(activeSubs.map((s) => s.userId));
  const grantUsers = users.filter((u) => activeGrantFor(u.id, now));
  const grantedOnly = grantUsers.filter((u) => !paidUserIds.has(u.id));

  const paid = payments.filter((p) => p.status === 'paid');
  const failed = payments.find((p) => p.status === 'failed');
  const revenue = paid.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  return {
    settings,
    totals: {
      users: users.length,
      free: Math.max(0, users.length - paidUserIds.size - grantedOnly.length),
      pro: paidUserIds.size + grantedOnly.length,
      monthly: activeSubs.filter((s) => s.billingCycle === 'monthly').length,
      yearly: activeSubs.filter((s) => s.billingCycle === 'yearly').length,
      adminGranted: grantedOnly.length,
      expired: subs.filter((s) => s.status === 'expired').length,
      cancelled: subs.filter((s) => s.status === 'cancelled').length,
      paymentsOk: paid.length,
      paymentsFailed: failed ? payments.filter((p) => p.status === 'failed').length : 0,
      revenue,
      monthlyRevenue: paid.filter((p) => p.billingCycle === 'monthly').reduce((s, p) => s + Number(p.amount || 0), 0),
      yearlyRevenue: paid.filter((p) => p.billingCycle === 'yearly').reduce((s, p) => s + Number(p.amount || 0), 0),
      monthlyPurchases: paid.filter((p) => p.billingCycle === 'monthly').length,
      yearlyPurchases: paid.filter((p) => p.billingCycle === 'yearly').length,
      conversionRate: users.length ? Math.round(((paidUserIds.size + grantedOnly.length) / users.length) * 100) : 0,
    },
    recentPayments: payments
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 12),
  };
}

export function settingsForAdmin() {
  const settings = getSettings();
  return {
    ...settings,
    priceLabel: {
      monthly: priceFor(settings, 'monthly'),
      yearly: priceFor(settings, 'yearly'),
      savings: yearlySavings(settings),
    },
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  };
}

export function findUserOrNull(id) {
  return findUserById(id);
}

export { FEATURE_KEYS, FEATURES };
