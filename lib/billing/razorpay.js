import crypto from 'crypto';

/**
 * Minimal Razorpay client.
 *
 * Two checkout modes are supported, because they are genuinely different:
 *  - Orders  → one-time payment for one billing period (works on any account).
 *  - Subscriptions → recurring auto-charge (needs Razorpay plan ids configured).
 *
 * We never guess: if plan ids are absent we create an order and the UI labels
 * the purchase as a single period that the user renews manually.
 */

const API = 'https://api.razorpay.com/v1';

export function rzpConfig() {
  return {
    keyId: String(process.env.RAZORPAY_KEY_ID || '').trim(),
    keySecret: String(process.env.RAZORPAY_KEY_SECRET || '').trim(),
    webhookSecret: String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
    planMonthly: String(process.env.RAZORPAY_PLAN_MONTHLY || '').trim(),
    planYearly: String(process.env.RAZORPAY_PLAN_YEARLY || '').trim(),
  };
}

export function isRazorpayConfigured() {
  const { keyId, keySecret } = rzpConfig();
  return Boolean(keyId && keySecret);
}

export function razorpayStatus() {
  const cfg = rzpConfig();
  return {
    configured: Boolean(cfg.keyId && cfg.keySecret),
    keyId: cfg.keyId ? cfg.keyId.slice(0, 12) : '', // publishable key only
    recurring: Boolean(cfg.planMonthly && cfg.planYearly),
    webhook: Boolean(cfg.webhookSecret),
  };
}

function authHeader() {
  const { keyId, keySecret } = rzpConfig();
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

async function rzpFetch(pathname, { method = 'GET', body } = {}) {
  if (!isRazorpayConfigured()) {
    const err = new Error('Razorpay is not configured on this server.');
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = new Error(payload?.error?.description || `Razorpay request failed (${res.status})`);
    err.status = res.status;
    err.details = payload?.error || payload;
    throw err;
  }
  return payload;
}

export function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  return rzpFetch('/orders', {
    method: 'POST',
    body: {
      amount: Math.round(Number(amount)),
      currency,
      receipt: String(receipt || '').slice(0, 40),
      notes,
      payment_capture: 1,
    },
  });
}

export function createSubscription({ planId, totalCount = 12, notes = {}, customerNotify = 1 }) {
  return rzpFetch('/subscriptions', {
    method: 'POST',
    body: { plan_id: planId, total_count: totalCount, customer_notify: customerNotify, notes },
  });
}

export function fetchSubscription(id) {
  return rzpFetch(`/subscriptions/${encodeURIComponent(id)}`);
}

export function cancelSubscription(id, atPeriodEnd = true) {
  return rzpFetch(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { cancel_at_cycle_end: atPeriodEnd ? 1 : 0 },
  });
}

export function fetchPayment(id) {
  return rzpFetch(`/payments/${encodeURIComponent(id)}`);
}

export function verifyCheckoutSignature({ orderId, subscriptionId, paymentId, signature }) {
  const { keySecret } = rzpConfig();
  if (!keySecret) return false;
  const base = orderId
    ? `${orderId}|${paymentId}`
    : `${paymentId}|${subscriptionId}`;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(base)
    .digest('hex');
  return timingSafeEqual(expected, String(signature || ''));
}

export function verifyWebhook(rawBody, signature) {
  const { webhookSecret } = rzpConfig();
  if (!webhookSecret || !signature) return false;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  return timingSafeEqual(expected, String(signature || ''));
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
