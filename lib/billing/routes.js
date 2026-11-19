import crypto from 'crypto';
import {
  CYCLES, FEATURE_KEYS, FREE_CONTACT_UNLOCK, priceFor, publicPlans, yearlySavings,
} from './plans.js';
import {
  activateSubscription, activeGrantFor, activeSubscriptionFor, addMonths, audit,
  findUserById, getSettings, hasProcessedEvent, listAudit, listGrants,
  listSubscriptions, listUsers, markEventProcessed, monthKey, mutateBilling, newId,
  nowIso, readBilling, saveGrant, saveSettings, saveSubscription,
  upsertUser, writeBilling,
} from './store.js';
import {
  accessForUser, accessSnapshot, adminEmails, applyContactAccess, billingOverview,
  isAdminUser, resolveUser, settingsForAdmin, startExpirySweeper, sweepExpirations,
} from './entitlements.js';
import {
  cancelSubscription, createOrder, createSubscription, fetchPayment, isRazorpayConfigured,
  razorpayStatus, rzpConfig, verifyCheckoutSignature, verifyWebhook,
} from './razorpay.js';

const MONTHS = { monthly: 1, yearly: 12 };

function send(res, status, payload) {
  res.status(status).json(payload);
}

function requireUser(req, res) {
  const user = resolveUser(req);
  if (!user) {
    send(res, 401, { error: 'Please sign in to manage your subscription.', code: 'AUTH_REQUIRED' });
    return null;
  }
  return user;
}

function adminGuard(req, res) {
  const user = resolveUser(req);
  if (!user || !isAdminUser(user)) {
    send(res, 403, { error: 'Admin access required.', code: 'FORBIDDEN' });
    return null;
  }
  return user;
}

function expiryFor(cycle, from = new Date()) {
  return addMonths(from, MONTHS[cycle] || 1);
}

function planAmount(settings, cycle) {
  return Math.round(Number(priceFor(settings, cycle)) * 100);
}

/* ── payment records ────────────────────────────────────── */

function recordPayment(patch) {
  const record = {
    id: newId('pay'),
    userId: '',
    subscriptionId: '',
    planType: 'pro',
    billingCycle: 'monthly',
    amount: 0,
    currency: 'INR',
    status: 'created',
    razorpayOrderId: '',
    razorpayPaymentId: '',
    razorpaySubscriptionId: '',
    createdAt: nowIso(),
    paidAt: '',
    failedAt: '',
    refundStatus: '',
    error: '',
    ...patch,
  };
  mutateBilling('payments', (payments) => [record, ...payments].slice(0, 5000));
  return record;
}

function updatePaymentBy(filterFn, patch) {
  let updated = null;
  mutateBilling('payments', (payments) => payments.map((p) => {
    if (updated || !filterFn(p)) return p;
    updated = { ...p, ...patch, updatedAt: nowIso() };
    return updated;
  }));
  return updated;
}

function paymentByOrder(orderId) {
  return readBilling('payments').find((p) => p.razorpayOrderId === orderId) || null;
}

function paymentBySubscription(subId) {
  return readBilling('payments').find((p) => p.razorpaySubscriptionId === subId && p.status !== 'paid') || null;
}

/**
 * Activate or extend Pro. Idempotent per payment id: activating the same
 * payment twice will not push the expiry date forward twice.
 */
function activatePaidPeriod({ userId, cycle, payment, razorpay = {}, extend = false }) {
  const existing = activeSubscriptionFor(userId);
  const from = extend && existing ? new Date(existing.expiryDate) : new Date();
  const expiry = expiryFor(cycle, from);
  const sub = activateSubscription({
    userId,
    planType: 'pro',
    billingCycle: cycle,
    source: 'razorpay',
    periodStart: new Date(),
    expiresAt: expiry,
    razorpay: {
      orderId: razorpay.orderId || payment?.razorpayOrderId || '',
      paymentId: razorpay.paymentId || payment?.razorpayPaymentId || '',
      subscriptionId: razorpay.subscriptionId || payment?.razorpaySubscriptionId || '',
    },
    notes: extend ? 'Renewal' : 'New subscription',
  });
  const activated = { ...sub, amount: payment?.amount || 0 };
  saveSubscription(activated);
  return activated;
}

/* ── public routes ──────────────────────────────────────── */

export function registerBillingRoutes(app) {
  startExpirySweeper();

  // Pricing catalogue for the landing page + dashboard.
  app.get('/api/plans', (req, res) => {
    const settings = getSettings();
    const { user, access } = (() => {
      const u = resolveUser(req);
      return { user: u, access: accessForUser(u) };
    })();
    send(res, 200, {
      ...publicPlans(settings),
      payments: razorpayStatus(),
      viewer: user ? { plan: access.planId, isPro: access.isPro } : null,
    });
  });

  // My subscription + usage + payment history.
  app.get('/api/subscription/me', (req, res) => {
    sweepExpirations();
    const user = requireUser(req, res);
    if (!user) return;
    const access = accessForUser(user);
    send(res, 200, {
      ...accessSnapshot(user, access),
      payments: razorpayStatus(),
    });
  });

  // Start checkout: creates a Razorpay order (or subscription when plan ids exist).
  app.post('/api/subscription/checkout', async (req, res) => {
    const settings = getSettings();
    if (!settings.globalPremiumEnabled) {
      return send(res, 403, {
        error: 'Premium plans are currently disabled by the administrator.',
        code: 'PREMIUM_DISABLED',
      });
    }
    if (!isRazorpayConfigured()) {
      return send(res, 503, {
        error: 'Payments are not configured yet. Add Razorpay keys to enable checkout.',
        code: 'PAYMENTS_NOT_CONFIGURED',
      });
    }

    const user = requireUser(req, res);
    if (!user) return;

    const cycle = String(req.body?.cycle || 'monthly').toLowerCase();
    if (!CYCLES[cycle]) {
      return send(res, 400, { error: 'Choose a monthly or yearly plan.' });
    }

    const cfg = rzpConfig();
    const amount = planAmount(settings, cycle);
    const receipt = `hamzo_${Date.now().toString(36)}`.slice(0, 40);

    try {
      // Recurring mode only when the account is actually configured for it.
      const planId = cycle === 'yearly' ? cfg.planYearly : cfg.planMonthly;
      if (planId) {
        const subscription = await createSubscription({
          planId,
          totalCount: cycle === 'yearly' ? 5 : 60,
          notes: { userId: user.id, email: user.email, cycle },
        });
        const payment = recordPayment({
          userId: user.id,
          billingCycle: cycle,
          amount: settings.prices[cycle === 'yearly' ? 'pro_yearly' : 'pro_monthly'],
          status: 'created',
          razorpaySubscriptionId: subscription.id,
          mode: 'subscription',
        });
        return send(res, 200, {
          mode: 'subscription',
          subscriptionId: subscription.id,
          paymentId: payment.id,
          amount,
          currency: settings.currency,
          keyId: cfg.keyId,
          cycle,
        });
      }

      const order = await createOrder({
        amount,
        currency: settings.currency,
        receipt,
        notes: { userId: user.id, email: user.email, cycle },
      });
      const payment = recordPayment({
        userId: user.id,
        billingCycle: cycle,
        amount: settings.prices[cycle === 'yearly' ? 'pro_yearly' : 'pro_monthly'],
        status: 'created',
        razorpayOrderId: order.id,
        mode: 'order',
      });
      return send(res, 200, {
        mode: 'order',
        orderId: order.id,
        paymentId: payment.id,
        amount: order.amount,
        currency: order.currency || settings.currency,
        keyId: cfg.keyId,
        cycle,
      });
    } catch (err) {
      console.error('[billing] checkout failed:', err.message);
      return send(res, err.status || 500, { error: err.message || 'Could not start checkout.' });
    }
  });

  // Verify the checkout result. Never trusts a frontend "success" flag.
  app.post('/api/subscription/verify', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;

    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      razorpay_subscription_id: subscriptionId,
      cycle: cycleInput,
    } = req.body || {};

    if (!paymentId || !signature || (!orderId && !subscriptionId)) {
      return send(res, 400, { error: 'Missing Razorpay verification fields.' });
    }
    if (!verifyCheckoutSignature({ orderId, subscriptionId, paymentId, signature })) {
      return send(res, 400, { error: 'Payment signature could not be verified.', code: 'INVALID_SIGNATURE' });
    }

    const payment = orderId ? paymentByOrder(orderId) : paymentBySubscription(subscriptionId);
    if (!payment || payment.userId !== user.id) {
      return send(res, 404, { error: 'Payment record not found for this account.' });
    }

    // Duplicate verification (double click, retried request) is a no-op.
    if (payment.status === 'paid') {
      return send(res, 200, { ok: true, duplicate: true, subscription: accessSnapshot(user, accessForUser(user)) });
    }

    let verified = { status: 'captured', amount: payment.amount };
    try {
      const remote = await fetchPayment(paymentId);
      verified = remote;
      if (!['captured', 'authorized'].includes(remote.status)) {
        updatePaymentBy((p) => p.id === payment.id, {
          status: remote.status === 'failed' ? 'failed' : 'pending',
          razorpayPaymentId: paymentId,
        });
        return send(res, 402, {
          error: `Payment is not complete yet (${remote.status}).`,
          code: 'PAYMENT_NOT_CAPTURED',
        });
      }
      if (Number(remote.amount) !== Number(payment.amount) * 100) {
        updatePaymentBy((p) => p.id === payment.id, {
          status: 'review',
          razorpayPaymentId: paymentId,
          error: `Amount mismatch: expected ${payment.amount * 100}, got ${remote.amount}`,
        });
        return send(res, 409, { error: 'Payment amount did not match the selected plan. Contact support.' });
      }
    } catch (err) {
      // Network failure to Razorpay must not block a signature-verified payment;
      // the webhook will confirm it. We log and continue.
      console.warn('[billing] could not confirm payment with Razorpay:', err.message);
    }

    const cycle = MONTHS[cycleInput] ? cycleInput : payment.billingCycle;
    updatePaymentBy((p) => p.id === payment.id, {
      status: 'paid',
      paidAt: nowIso(),
      razorpayPaymentId: paymentId,
      razorpaySubscriptionId: subscriptionId || '',
      method: verified.method || '',
    });

    const sub = activatePaidPeriod({
      userId: user.id,
      cycle,
      payment,
      razorpay: { orderId, paymentId, subscriptionId },
    });

    audit({
      action: 'payment.activated',
      userId: user.id,
      userEmail: user.email,
      newStatus: `pro:${cycle}`,
      reason: 'Razorpay checkout verified',
      meta: { orderId, paymentId, amount: payment.amount },
    });

    return send(res, 200, {
      ok: true,
      subscription: accessSnapshot(user, accessForUser(user)),
      activated: { cycle, expiryDate: sub.expiryDate },
    });
  });

  // Keep Pro until the period ends when the user cancels.
  app.post('/api/subscription/cancel', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const sub = activeSubscriptionFor(user.id);
    if (!sub) return send(res, 404, { error: 'No active subscription to cancel.' });

    if (sub.razorpaySubscriptionId && isRazorpayConfigured()) {
      try {
        await cancelSubscription(sub.razorpaySubscriptionId, true);
      } catch (err) {
        console.warn('[billing] Razorpay cancel failed:', err.message);
      }
    }

    const updated = saveSubscription({
      ...sub,
      status: 'pending_cancel',
      cancelAtPeriodEnd: true,
      cancelledAt: nowIso(),
    });
    audit({
      action: 'subscription.cancel_requested',
      userId: user.id,
      userEmail: user.email,
      previousStatus: sub.status,
      newStatus: updated.status,
      reason: String(req.body?.reason || 'Cancelled by user').slice(0, 300),
    });
    return send(res, 200, { ok: true, subscription: accessSnapshot(user, accessForUser(user)) });
  });

  // Undo a pending cancellation before the period ends.
  app.post('/api/subscription/resume', (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const sub = activeSubscriptionFor(user.id);
    if (!sub || !sub.cancelAtPeriodEnd) return send(res, 404, { error: 'No pending cancellation found.' });
    saveSubscription({ ...sub, status: 'active', cancelAtPeriodEnd: false, cancelledAt: '' });
    audit({
      action: 'subscription.cancel_resumed',
      userId: user.id,
      userEmail: user.email,
      previousStatus: 'pending_cancel',
      newStatus: 'active',
      reason: 'User resumed before period end',
    });
    return send(res, 200, { ok: true, subscription: accessSnapshot(user, accessForUser(user)) });
  });

  /* ── webhook ──────────────────────────────────────────── */

  app.post('/api/razorpay/webhook', (req, res) => {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhook(raw, signature)) {
      return send(res, 400, { error: 'Invalid webhook signature.' });
    }

    let payload = {};
    try { payload = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid webhook body.' }); }

    const eventId = String(req.headers['x-razorpay-event-id'] || payload?.event_id || '').trim()
      || `evt_${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
    if (hasProcessedEvent(eventId)) {
      return send(res, 200, { ok: true, duplicate: true });
    }

    const event = String(payload.event || '');
    const entity = payload.payload?.payment?.entity
      || payload.payload?.subscription?.entity
      || payload.payload?.refund?.entity
      || {};

    try {
      if (event === 'payment.captured' || event === 'payment.authorized') {
        const orderId = entity.order_id || '';
        const payment = paymentByOrder(orderId);
        const userId = payment?.userId || entity.notes?.userId || '';
        const cycle = payment?.billingCycle || entity.notes?.cycle || 'monthly';
        if (userId && entity.status !== 'failed') {
          if (payment && payment.status !== 'paid') {
            updatePaymentBy((p) => p.id === payment.id, {
              status: 'paid',
              paidAt: nowIso(),
              razorpayPaymentId: entity.id,
            });
          }
          const existing = activeSubscriptionFor(userId);
          // Guard against double-extending when verify already handled this payment.
          const alreadyApplied = existing?.razorpayPaymentId === entity.id
            || readBilling('payments').some((p) => p.razorpayPaymentId === entity.id && p.status === 'paid' && p.applied);
          if (!alreadyApplied) {
            const paid = payment ? updatePaymentBy((p) => p.id === payment.id, { applied: true }) : null;
            activatePaidPeriod({
              userId,
              cycle: MONTHS[cycle] ? cycle : 'monthly',
              payment: paid || { amount: Number(entity.amount || 0) / 100 },
              razorpay: { orderId, paymentId: entity.id, subscriptionId: entity.subscription_id },
            });
            audit({
              action: 'payment.webhook_activated',
              userId,
              newStatus: `pro:${cycle}`,
              reason: `Razorpay webhook ${event}`,
              meta: { orderId, paymentId: entity.id },
            });
          }
        }
      } else if (event === 'payment.failed') {
        const orderId = entity.order_id || '';
        const payment = paymentByOrder(orderId);
        if (payment) {
          updatePaymentBy((p) => p.id === payment.id, {
            status: 'failed',
            failedAt: nowIso(),
            error: String(entity.error_description || 'Payment failed').slice(0, 300),
          });
        }
      } else if (event === 'subscription.charged' || event === 'subscription.activated') {
        const subId = entity.id || '';
        const payment = paymentBySubscription(subId);
        const userId = payment?.userId || entity.notes?.userId || '';
        const cycle = payment?.billingCycle || entity.notes?.cycle
          || (entity.plan_id && entity.plan_id === rzpConfig().planYearly ? 'yearly' : 'monthly');
        if (userId) {
          updatePaymentBy((p) => p.razorpaySubscriptionId === subId, {
            status: 'paid', paidAt: nowIso(), applied: true,
          });
          activatePaidPeriod({
            userId,
            cycle,
            payment: payment || { amount: Number(entity.amount || 0) / 100 },
            razorpay: { subscriptionId: subId, paymentId: entity.latest_invoice_id || '' },
            extend: true,
          });
          audit({
            action: 'subscription.webhook_charged',
            userId,
            newStatus: `pro:${cycle}`,
            reason: `Razorpay webhook ${event}`,
            meta: { subscriptionId: subId, currentEnd: entity.current_end },
          });
        }
      } else if (['subscription.cancelled', 'subscription.halted', 'subscription.completed'].includes(event)) {
        const subId = entity.id || '';
        const sub = listSubscriptions().find((s) => s.razorpaySubscriptionId === subId);
        if (sub) {
          const status = event === 'subscription.cancelled' ? 'cancelled' : 'expired';
          saveSubscription({
            ...sub,
            status,
            cancelledAt: event === 'subscription.cancelled' ? nowIso() : sub.cancelledAt,
            expiryReason: `Razorpay webhook ${event}`,
          });
          audit({
            action: `subscription.${event.split('.')[1]}`,
            userId: sub.userId,
            previousStatus: sub.status,
            newStatus: status,
            reason: `Razorpay webhook ${event}`,
          });
        }
      } else if (event === 'refund.created' || event === 'payment.refunded') {
        const paymentId = entity.payment_id || '';
        updatePaymentBy((p) => p.razorpayPaymentId === paymentId, {
          refundStatus: entity.status || 'processed',
          refundedAt: nowIso(),
          status: 'refunded',
        });
      }

      markEventProcessed(eventId, event);
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error('[billing] webhook handling failed:', err.message);
      // Do not mark the event processed: Razorpay will retry.
      return send(res, 500, { error: 'Webhook handling failed.' });
    }
  });

  /* ── admin: settings ──────────────────────────────────── */

  app.get('/api/admin/billing/settings', (req, res) => {
    if (!adminGuard(req, res)) return;
    send(res, 200, settingsForAdmin());
  });

  app.put('/api/admin/billing/settings', (req, res) => {
    const admin = adminGuard(req, res);
    if (!admin) return;
    const body = req.body || {};
    const patch = {};
    if (typeof body.globalPremiumEnabled === 'boolean') patch.globalPremiumEnabled = body.globalPremiumEnabled;
    if (body.prices) {
      patch.prices = {};
      if (body.prices.pro_monthly !== undefined) patch.prices.pro_monthly = Math.max(0, Number(body.prices.pro_monthly) || 0);
      if (body.prices.pro_yearly !== undefined) patch.prices.pro_yearly = Math.max(0, Number(body.prices.pro_yearly) || 0);
    }
    if (body.limits) {
      patch.limits = {};
      for (const plan of ['free', 'pro']) {
        if (!body.limits[plan]) continue;
        patch.limits[plan] = {};
        for (const [key, value] of Object.entries(body.limits[plan])) {
          if (!Object.values(FEATURE_KEYS).includes(key)) continue;
          patch.limits[plan][key] = value === null ? null : Math.max(0, Number(value) || 0);
        }
      }
    }
    if (body.contactUnlockFree !== undefined) patch.contactUnlockFree = Math.max(0, Number(body.contactUnlockFree) || 0);
    if (body.campaignRequests) {
      patch.campaignRequests = {};
      for (const plan of ['free', 'pro']) {
        if (body.campaignRequests[plan] === undefined) continue;
        const value = body.campaignRequests[plan];
        patch.campaignRequests[plan] = value === null ? null : Math.max(0, Number(value) || 0);
      }
    }

    const before = getSettings();
    const next = saveSettings(patch, admin.email);
    audit({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'settings.updated',
      previousStatus: before.globalPremiumEnabled ? 'premium_on' : 'premium_off',
      newStatus: next.globalPremiumEnabled ? 'premium_on' : 'premium_off',
      reason: String(body.reason || 'Admin updated billing settings').slice(0, 300),
      meta: { patch },
    });
    send(res, 200, { ok: true, settings: settingsForAdmin() });
  });

  app.post('/api/admin/billing/premium-toggle', (req, res) => {
    const admin = adminGuard(req, res);
    if (!admin) return;
    const enabled = Boolean(req.body?.enabled);
    const before = getSettings();
    const next = saveSettings({ globalPremiumEnabled: enabled }, admin.email);
    audit({
      adminId: admin.id,
      adminEmail: admin.email,
      action: enabled ? 'premium.global_enabled' : 'premium.global_disabled',
      previousStatus: before.globalPremiumEnabled ? 'on' : 'off',
      newStatus: enabled ? 'on' : 'off',
      reason: String(req.body?.reason || '').slice(0, 300),
    });
    send(res, 200, { ok: true, settings: settingsForAdmin() });
  });

  /* ── admin: users & grants ────────────────────────────── */

  app.get('/api/admin/billing/users', (req, res) => {
    if (!adminGuard(req, res)) return;
    const search = String(req.query.search || '').trim().toLowerCase();
    const filter = String(req.query.filter || 'all');
    const sort = String(req.query.sort || 'createdAt');
    const dir = String(req.query.dir || 'desc') === 'asc' ? 1 : -1;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 20));

    const subs = listSubscriptions();
    const now = Date.now();
    const activeFor = (userId) => subs
      .filter((s) => s.userId === userId)
      .sort((a, b) => new Date(b.expiryDate) - new Date(a.expiryDate))[0] || null;

    let rows = listUsers().map((user) => {
      const sub = activeFor(user.id);
      const active = sub && ['active', 'pending_cancel'].includes(sub.status) && new Date(sub.expiryDate).getTime() > now;
      const grant = activeGrantFor(user.id, now);
      const plan = active || grant ? 'pro' : 'free';
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        plan,
        source: active ? 'razorpay' : grant ? 'admin' : 'free',
        cycle: active ? sub.billingCycle : grant ? 'grant' : '',
        status: active ? sub.status : grant ? 'granted' : 'free',
        expiryDate: active ? sub.expiryDate : grant?.expiryDate || '',
        grant: grant ? {
          id: grant.id,
          grantDate: grant.grantDate,
          expiryDate: grant.expiryDate || '',
          reason: grant.reason || '',
          grantedBy: grant.grantedByEmail || '',
        } : null,
        payments: readBilling('payments').filter((p) => p.userId === user.id && p.status === 'paid').length,
      };
    });

    if (search) {
      rows = rows.filter((r) => String(r.email).includes(search) || String(r.displayName || '').toLowerCase().includes(search));
    }
    const filterMap = {
      free: (r) => r.plan === 'free',
      pro: (r) => r.plan === 'pro',
      monthly: (r) => r.plan === 'pro' && r.cycle === 'monthly',
      yearly: (r) => r.plan === 'pro' && r.cycle === 'yearly',
      active: (r) => r.plan === 'pro' && ['active', 'pending_cancel'].includes(r.status),
      expired: (r) => r.status === 'expired' || subs.some((s) => s.userId === r.id && s.status === 'expired'),
      cancelled: (r) => subs.some((s) => s.userId === r.id && s.status === 'cancelled'),
      admin: (r) => r.source === 'admin',
      paid: (r) => r.payments > 0,
    };
    if (filterMap[filter]) rows = rows.filter(filterMap[filter]);

    rows.sort((a, b) => {
      const av = a[sort] ?? '';
      const bv = b[sort] ?? '';
      if (sort === 'createdAt' || sort === 'expiryDate') {
        return (new Date(av || 0) - new Date(bv || 0)) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });

    const total = rows.length;
    const start = (page - 1) * pageSize;
    send(res, 200, {
      users: rows.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      counts: {
        all: listUsers().length,
        pro: rows.filter((r) => r.plan === 'pro').length,
        free: rows.filter((r) => r.plan === 'free').length,
      },
    });
  });

  app.get('/api/admin/billing/users/:id', (req, res) => {
    if (!adminGuard(req, res)) return;
    const user = findUserById(req.params.id);
    if (!user) return send(res, 404, { error: 'User not found.' });
    const subs = listSubscriptions().filter((s) => s.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const payments = readBilling('payments').filter((p) => p.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const grants = listGrants(user.id).sort((a, b) => new Date(b.grantDate) - new Date(a.grantDate));
    send(res, 200, {
      user,
      snapshot: accessSnapshot(user, accessForUser(user)),
      subscriptions: subs,
      payments,
      grants,
      audit: listAudit(user.id).slice(0, 50),
    });
  });

  app.post('/api/admin/billing/users/:id/grant', (req, res) => {
    const admin = adminGuard(req, res);
    if (!admin) return;
    const user = findUserById(req.params.id);
    if (!user) return send(res, 404, { error: 'User not found.' });

    const reason = String(req.body?.reason || '').trim();
    if (!reason) return send(res, 400, { error: 'Add a short reason for this grant (audit trail).' });

    const days = Number(req.body?.expiryDays) || 0;
    const explicitDate = String(req.body?.expiryDate || '').trim();
    let expiryDate = '';
    if (explicitDate) {
      const parsed = new Date(explicitDate);
      if (Number.isNaN(parsed.getTime())) return send(res, 400, { error: 'Invalid expiry date.' });
      expiryDate = parsed.toISOString();
    } else if (days > 0) {
      expiryDate = new Date(Date.now() + days * 86400000).toISOString();
    }

    // Supersede any other active manual grant (one active grant at a time).
    mutateBilling('grants', (grants) => grants.map((g) => (
      g.userId === user.id && g.status === 'active'
        ? { ...g, status: 'superseded', supersededAt: nowIso() }
        : g
    )));

    const grant = saveGrant({
      id: newId('grant'),
      userId: user.id,
      grantedBy: admin.id,
      grantedByEmail: admin.email,
      grantDate: nowIso(),
      expiryDate,
      reason: reason.slice(0, 500),
      status: 'active',
    });

    audit({
      adminId: admin.id,
      adminEmail: admin.email,
      userId: user.id,
      userEmail: user.email,
      action: 'premium.granted',
      previousStatus: 'free',
      newStatus: 'pro',
      reason: reason.slice(0, 300),
      meta: { grantId: grant.id, expiryDate },
    });

    send(res, 200, { ok: true, grant, snapshot: accessSnapshot(user, accessForUser(user)) });
  });

  app.post('/api/admin/billing/users/:id/revoke', (req, res) => {
    const admin = adminGuard(req, res);
    if (!admin) return;
    const user = findUserById(req.params.id);
    if (!user) return send(res, 404, { error: 'User not found.' });

    const reason = String(req.body?.reason || 'Manual premium revoked').slice(0, 300);
    let revoked = 0;
    mutateBilling('grants', (grants) => grants.map((g) => {
      if (g.userId !== user.id || g.status !== 'active') return g;
      revoked += 1;
      return { ...g, status: 'revoked', revokedAt: nowIso(), revokedBy: admin.email, revokeReason: reason };
    }));

    // A paid subscription is untouched: accessForUser prefers it automatically.
    const sub = activeSubscriptionFor(user.id);
    audit({
      adminId: admin.id,
      adminEmail: admin.email,
      userId: user.id,
      userEmail: user.email,
      action: 'premium.revoked',
      previousStatus: 'pro',
      newStatus: sub ? 'pro' : 'free',
      reason,
      meta: { revoked, keptPaidSubscription: Boolean(sub) },
    });

    send(res, 200, {
      ok: true,
      revoked,
      keptPaidSubscription: Boolean(sub),
      snapshot: accessSnapshot(user, accessForUser(user)),
    });
  });

  /* ── admin: analytics ─────────────────────────────────── */

  app.get('/api/admin/billing/stats', (req, res) => {
    if (!adminGuard(req, res)) return;
    const overview = billingOverview();
    const payments = readBilling('payments');
    const month = monthKey();
    const paidThisMonth = payments.filter((p) => p.status === 'paid' && String(p.paidAt || p.createdAt).startsWith(month));
    send(res, 200, {
      totals: overview.totals,
      settings: {
        globalPremiumEnabled: overview.settings.globalPremiumEnabled,
        prices: overview.settings.prices,
        savings: yearlySavings(overview.settings),
      },
      razorpay: razorpayStatus(),
      revenue: {
        total: overview.totals.revenue,
        monthly: overview.totals.monthlyRevenue,
        yearly: overview.totals.yearlyRevenue,
        thisMonth: paidThisMonth.reduce((s, p) => s + Number(p.amount || 0), 0),
        thisMonthCount: paidThisMonth.length,
      },
      recentPayments: overview.recentPayments,
    });
  });

  app.get('/api/admin/billing/transactions', (req, res) => {
    if (!adminGuard(req, res)) return;
    const status = String(req.query.status || 'all');
    const search = String(req.query.search || '').trim().toLowerCase();
    const users = listUsers();
    const byId = new Map(users.map((u) => [u.id, u]));
    let rows = readBilling('payments').map((p) => ({
      ...p,
      userEmail: byId.get(p.userId)?.email || p.userId,
      userName: byId.get(p.userId)?.displayName || '',
    }));
    if (status !== 'all') rows = rows.filter((p) => p.status === status);
    if (search) {
      rows = rows.filter((p) => String(p.userEmail).toLowerCase().includes(search)
        || String(p.razorpayPaymentId || '').includes(search)
        || String(p.razorpayOrderId || '').includes(search));
    }
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
    send(res, 200, {
      transactions: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    });
  });

  app.get('/api/admin/billing/export.csv', (req, res) => {
    if (!adminGuard(req, res)) return;
    const users = listUsers();
    const subs = listSubscriptions();
    const payments = readBilling('payments');
    const now = Date.now();
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Name', 'Email', 'Plan', 'Cycle', 'Status', 'Access source', 'Amount', 'Razorpay payment id',
      'Start date', 'Expiry date', 'Payment date', 'Renewal date', 'Registered at',
    ];
    const lines = users.map((user) => {
      const sub = subs
        .filter((s) => s.userId === user.id)
        .sort((a, b) => new Date(b.expiryDate) - new Date(a.expiryDate))[0];
      const grant = activeGrantFor(user.id, now);
      const active = sub && ['active', 'pending_cancel'].includes(sub.status) && new Date(sub.expiryDate).getTime() > now;
      const pay = payments.find((p) => p.userId === user.id && p.status === 'paid');
      return [
        user.displayName, user.email,
        active || grant ? 'Pro' : 'Free',
        active ? sub.billingCycle : grant ? 'admin grant' : '',
        active ? sub.status : grant ? 'granted' : 'free',
        active ? 'Razorpay' : grant ? 'Admin grant' : 'Free',
        pay ? pay.amount : 0,
        pay?.razorpayPaymentId || '',
        active ? sub.startDate : grant?.grantDate || '',
        active ? sub.expiryDate : grant?.expiryDate || '',
        pay?.paidAt || '',
        active && !sub.cancelAtPeriodEnd ? sub.expiryDate : '',
        user.createdAt,
      ].map(esc).join(',');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hamzo-subscriptions-${nowIso().slice(0, 10)}.csv"`);
    res.send([header.map(esc).join(','), ...lines].join('\n'));
  });

  app.post('/api/admin/billing/sweep', (req, res) => {
    if (!adminGuard(req, res)) return;
    const changed = sweepExpirations('manual admin sweep');
    send(res, 200, { ok: true, changed });
  });

  // Contact access preview for support/debugging (no emails of locked rows).
  app.get('/api/admin/billing/contact-policy', (req, res) => {
    if (!adminGuard(req, res)) return;
    const settings = getSettings();
    send(res, 200, {
      freeContacts: settings.contactUnlockFree ?? FREE_CONTACT_UNLOCK,
      campaignRequests: settings.campaignRequests,
      premiumEnabled: settings.globalPremiumEnabled,
      admins: adminEmails(),
    });
  });
}

export function billingHealth() {
  return {
    razorpay: isRazorpayConfigured(),
    recurring: razorpayStatus().recurring,
    users: listUsers().length,
    activeSubscriptions: listSubscriptions().filter((s) => s.status === 'active').length,
  };
}
