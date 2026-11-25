import { apiFetch } from './api';

/**
 * Subscription API client. Every call goes through apiFetch so the bearer
 * token (mymind_token / hamzooh_token) is attached automatically and 402
 * errors keep their `code`/`feature` fields for upgrade prompts.
 */
export const billingStore = {
  /* public */
  plans: () => apiFetch('', '/api/plans'),
  me: () => apiFetch('', '/api/subscription/me'),
  checkout: (cycle) => apiFetch('', '/api/subscription/checkout', {
    method: 'POST',
    body: JSON.stringify({ cycle }),
  }),
  verify: (payload) => apiFetch('', '/api/subscription/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  cancel: (reason = '') => apiFetch('', '/api/subscription/cancel', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }),
  resume: () => apiFetch('', '/api/subscription/resume', { method: 'POST' }),

  /* admin */
  admin: {
    settings: () => apiFetch('', '/api/admin/billing/settings'),
    saveSettings: (patch) => apiFetch('', '/api/admin/billing/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
    togglePremium: (enabled, reason = '') => apiFetch('', '/api/admin/billing/premium-toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled, reason }),
    }),
    users: (params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
      });
      return apiFetch('', `/api/admin/billing/users?${qs.toString()}`);
    },
    user: (id) => apiFetch('', `/api/admin/billing/users/${encodeURIComponent(id)}`),
    grant: (id, payload) => apiFetch('', `/api/admin/billing/users/${encodeURIComponent(id)}/grant`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    revoke: (id, reason = '') => apiFetch('', `/api/admin/billing/users/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
    stats: () => apiFetch('', '/api/admin/billing/stats'),
    transactions: (params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
      });
      return apiFetch('', `/api/admin/billing/transactions?${qs.toString()}`);
    },
    sweep: () => apiFetch('', '/api/admin/billing/sweep', { method: 'POST' }),
    exportUrl: () => '/api/admin/billing/export.csv',
  },
};

/* ── Razorpay checkout helper ─────────────────────────────── */

let checkoutPromise = null;

export function loadRazorpayCheckout() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser'));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (checkoutPromise) return checkoutPromise;
  checkoutPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Checkout failed to load.')));
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your connection.'));
    document.body.appendChild(script);
  });
  return checkoutPromise;
}

/**
 * Runs the full checkout: backend order → Razorpay modal → backend verify.
 * Resolves with the fresh subscription snapshot.
 */
export async function runCheckout({ cycle, user, onProgress }) {
  const order = await billingStore.checkout(cycle);
  if (!order?.keyId) throw new Error('Payments are not configured yet.');

  const RazorpayCheckout = await loadRazorpayCheckout();

  return new Promise((resolve, reject) => {
    const options = {
      key: order.keyId,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: 'HAMZOOH',
      description: cycle === 'yearly' ? 'Pro — yearly' : 'Pro — monthly',
      prefill: {
        name: user?.displayName || '',
        email: user?.email || '',
      },
      theme: { color: '#335CFF' },
      modal: {
        ondismiss: () => reject(Object.assign(new Error('Checkout closed before payment completed.'), { code: 'CHECKOUT_DISMISSED' })),
      },
      handler: async (response) => {
        try {
          onProgress?.(`Verifying payment ${response.razorpay_payment_id}…`);
          const verified = await billingStore.verify({
            ...response,
            cycle,
          });
          resolve(verified);
        } catch (err) {
          reject(err);
        }
      },
    };

    if (order.mode === 'subscription') {
      options.subscription_id = order.subscriptionId;
    } else {
      options.order_id = order.orderId;
    }

    const rzp = new RazorpayCheckout(options);
    rzp.on('payment.failed', (response) => {
      reject(Object.assign(new Error(response?.error?.description || 'Payment failed.'), { code: 'PAYMENT_FAILED' }));
    });
    rzp.open();
  });
}
