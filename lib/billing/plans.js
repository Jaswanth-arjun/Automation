/**
 * Plan catalogue — the single source of truth for what Free and Pro can do.
 *
 * Limits live here (and can be overridden per-install from
 * data/billing/settings.json via the admin panel), so no feature should
 * hard-code "5" or "50" anywhere else.
 *
 * `null` means unlimited. Unlimited features still keep infrastructure
 * safeguards (single-flight auto-apply, LinkedIn pacing, Gmail throttling).
 */

export const PLAN_IDS = ['free', 'pro'];

export const FEATURE_KEYS = {
  RESUME_TAILOR: 'resume_tailor',
  AI_COMM: 'ai_comm',
  LINKEDIN_CAMPAIGN: 'linkedin_campaign',
  LINKEDIN_REQUEST: 'linkedin_request',
  AUTO_APPLY: 'auto_apply',
  EMAIL_REFERRAL_SEND: 'email_referral_send',
};

/**
 * period: 'day' | 'week' | 'month'
 * free/pro: number allowed per period, or null for unlimited.
 * style: 'counter' = usage is consumed; 'campaign' = checked per action.
 */
export const FEATURES = {
  [FEATURE_KEYS.RESUME_TAILOR]: {
    label: 'AI resume/cover letter tailoring',
    period: 'month',
    free: 5,
    pro: 50,
    style: 'counter',
  },
  [FEATURE_KEYS.AI_COMM]: {
    label: 'AI communication actions',
    period: 'month',
    free: 10,
    pro: 150,
    style: 'counter',
  },
  [FEATURE_KEYS.LINKEDIN_CAMPAIGN]: {
    label: 'LinkedIn referral campaigns',
    period: 'month',
    free: 5,
    pro: null,
    style: 'counter',
  },
  [FEATURE_KEYS.LINKEDIN_REQUEST]: {
    label: 'LinkedIn referral requests',
    period: 'month',
    free: 50,
    pro: null,
    style: 'counter',
  },
  [FEATURE_KEYS.AUTO_APPLY]: {
    label: 'Chrome extension auto-applies',
    period: 'month',
    free: 5,
    pro: null,
    style: 'counter',
  },
  [FEATURE_KEYS.EMAIL_REFERRAL_SEND]: {
    label: 'Referral emails per campaign',
    period: 'campaign',
    free: 5,
    pro: null,
    style: 'campaign',
  },
};

/** Contacts a Free user can unlock per company discovery. */
export const FREE_CONTACT_UNLOCK = 5;

/** Requests allowed inside one LinkedIn campaign. */
export const CAMPAIGN_REQUESTS = {
  free: 10,
  pro: 100,
};

/** AI engine per plan (the model ids the product promises on the pricing page). */
export const AI_MODELS = {
  free: 'Standard AI',
  pro: 'Hamzooh Ultra AI',
};

export const DEFAULT_SETTINGS = {
  globalPremiumEnabled: false,
  currency: 'INR',
  prices: {
    pro_monthly: 699,
    pro_yearly: 4999,
  },
  limits: {
    free: {
      [FEATURE_KEYS.RESUME_TAILOR]: 5,
      [FEATURE_KEYS.AI_COMM]: 10,
      [FEATURE_KEYS.LINKEDIN_CAMPAIGN]: 5,
      [FEATURE_KEYS.LINKEDIN_REQUEST]: 50,
      [FEATURE_KEYS.AUTO_APPLY]: 5,
    },
    pro: {
      [FEATURE_KEYS.RESUME_TAILOR]: 50,
      [FEATURE_KEYS.AI_COMM]: 150,
      [FEATURE_KEYS.LINKEDIN_CAMPAIGN]: null,
      [FEATURE_KEYS.LINKEDIN_REQUEST]: null,
      [FEATURE_KEYS.AUTO_APPLY]: null,
    },
  },
  contactUnlockFree: FREE_CONTACT_UNLOCK,
  campaignRequests: { free: 10, pro: 100 },
  updatedAt: null,
  updatedBy: '',
};

export const CYCLES = {
  monthly: { id: 'monthly', label: 'Monthly', months: 1 },
  yearly: { id: 'yearly', label: 'Yearly', months: 12 },
};

export function priceFor(settings, cycle) {
  const prices = settings?.prices || DEFAULT_SETTINGS.prices;
  return cycle === 'yearly' ? Number(prices.pro_yearly) || 0 : Number(prices.pro_monthly) || 0;
}

export function yearlySavings(settings) {
  const monthly = Number(settings?.prices?.pro_monthly) || 0;
  const yearly = Number(settings?.prices?.pro_yearly) || 0;
  const twelve = monthly * 12;
  const saved = Math.max(0, twelve - yearly);
  const percent = twelve > 0 ? Math.round((saved / twelve) * 100) : 0;
  return { twelve, saved, percent };
}

/** Plan shape the landing page and dashboards render. No secrets in here. */
export function publicPlans(settings) {
  const savings = yearlySavings(settings);
  return {
    premiumEnabled: Boolean(settings?.globalPremiumEnabled),
    currency: settings?.currency || 'INR',
    prices: {
      pro_monthly: Number(settings?.prices?.pro_monthly) || 0,
      pro_yearly: Number(settings?.prices?.pro_yearly) || 0,
    },
    savings,
    limits: settings?.limits || DEFAULT_SETTINGS.limits,
    contactUnlockFree: settings?.contactUnlockFree ?? FREE_CONTACT_UNLOCK,
    campaignRequests: settings?.campaignRequests || DEFAULT_SETTINGS.campaignRequests,
    plans: [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        cadence: 'forever',
        tagline: 'Everything you need to start getting noticed.',
        aiModel: AI_MODELS.free,
      },
      {
        id: 'pro',
        name: 'Pro',
        price: Number(settings?.prices?.pro_monthly) || 0,
        yearlyPrice: Number(settings?.prices?.pro_yearly) || 0,
        cadence: 'month',
        tagline: 'Unlimited outreach to the people who can actually refer you.',
        aiModel: AI_MODELS.pro,
        recommended: true,
      },
    ],
  };
}
