/**
 * Central AI model router.
 *
 * Every AI call in the autonomous apply pipeline goes through here so that:
 *  - model IDs are configured in one place (env), never hard-coded in routes,
 *  - cheap models handle routine work and expensive models are escalated to,
 *  - provider fallback happens deliberately,
 *  - real provider usage (tokens, cost, latency) is recorded per user/task.
 *
 * Supported providers are OpenAI-compatible gateways already configured in
 * this project (Nara/BYNARA, NVIDIA, FreeLLMAPI), OpenAI itself
 * (Responses API), and Gemini as a last resort. The router only reports a
 * successful call when the provider actually returned text.
 */

import './env.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AiUsageModel, isMongoActive } from './mongodb.js';

export const MODEL_ROLES = ['fast', 'primary', 'vision', 'reasoning'];

const ROLE_ENV = {
  fast: 'AI_MODEL_FAST',
  primary: 'AI_MODEL_PRIMARY',
  vision: 'AI_MODEL_VISION',
  reasoning: 'AI_MODEL_REASONING',
};

const ROLE_DEFAULTS = {
  fast: 'gpt-6-luna',
  primary: 'gpt-6.2-sol',
  vision: 'gpt-6.1-terra',
  reasoning: 'gpt-6.2-astra',
};

/**
 * Default USD prices per 1M tokens. They are deliberately overridable because
 * the provider's price is the source of truth. If a provider returns an
 * explicit cost, that value wins.
 */
const DEFAULT_PRICES = {
  'gpt-6-luna': { in: 0.10, out: 0.50 },
  'gpt-6.2-sol': { in: 2.00, out: 10.00 },
  'gpt-6.1-terra': { in: 1.00, out: 5.00 },
  'gpt-6.2-astra': { in: 8.00, out: 40.00 },
  // Real OpenAI models a deployment may route to (for example
  // AI_MODEL_VISION_OPENAI=gpt-4o-mini). Indicative list prices per 1M tokens;
  // override per install with AI_PRICE_<MODEL>_IN / AI_PRICE_<MODEL>_OUT.
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4o': { in: 2.50, out: 10.00 },
  'gpt-4.1': { in: 2.00, out: 8.00 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60 },
  'gpt-4.1-nano': { in: 0.10, out: 0.40 },
};

const USAGE_FILE = path.join(process.cwd(), 'data', 'ai_usage.json');
const MAX_USAGE_ROWS = 5000;

/**
 * Route cooldowns.
 *
 * A gateway that answers "this model is not part of your plan", rejects the key
 * or 404s a model must not be retried on every single agent step: that adds
 * seconds of latency and floods the logs. Failed routes cool down for a
 * bounded time, then get retried automatically.
 */
const COOLDOWN_MS = {
  auth: Number(process.env.AI_COOLDOWN_AUTH_MS || 30 * 60 * 1000),
  plan: Number(process.env.AI_COOLDOWN_PLAN_MS || 60 * 60 * 1000),
  model: Number(process.env.AI_COOLDOWN_MODEL_MS || 6 * 60 * 60 * 1000),
  rate: Number(process.env.AI_COOLDOWN_RATE_MS || 40 * 1000),
  network: Number(process.env.AI_COOLDOWN_NETWORK_MS || 60 * 1000),
  other: Number(process.env.AI_COOLDOWN_OTHER_MS || 5 * 60 * 1000),
};

const routeCooldowns = new Map();

function cooldownKey(provider, model) {
  return `${provider}:${model}`;
}

function cooldownForError(err) {
  const status = Number(err?.status || 0);
  if (status === 401 || status === 403) return COOLDOWN_MS.auth;
  if (status === 402 || status === 402.1) return COOLDOWN_MS.plan;
  if (status === 404) return COOLDOWN_MS.model;
  if (status === 429) return COOLDOWN_MS.rate;
  if (!status) return COOLDOWN_MS.network;
  return COOLDOWN_MS.other;
}

function markRouteFailure(provider, model, err) {
  const ms = cooldownForError(err);
  if (!Number.isFinite(ms) || ms <= 0) return;
  routeCooldowns.set(cooldownKey(provider, model), {
    until: Date.now() + ms,
    reason: String(err?.message || err).slice(0, 200),
    status: Number(err?.status || 0),
  });
}

/**
 * Auto Apply is the one feature that must not stall on a network blip. A
 * transient network error (fetch failed, DNS, connection reset) is retried
 * per key with short backoff; anything with an HTTP status is treated as
 * permanent as before.
 */
function isTransientNetError(err) {
  if (!err) return false;
  if (Number(err?.status)) return false;
  const name = String(err?.name || '');
  if (['FetchError', 'TypeError', 'AbortError', 'TimeoutError'].includes(name)) return true;
  const msg = String(err?.message || '').toLowerCase();
  return /fetch failed|econnrefused|enotfound|eai_again|enetunreach|network|socket|timed out|timeout/i.test(msg);
}

function clearRouteFailure(provider, model) {
  routeCooldowns.delete(cooldownKey(provider, model));
}

function isRouteCoolingDown(provider, model) {
  const entry = routeCooldowns.get(cooldownKey(provider, model));
  if (!entry) return false;
  if (entry.until <= Date.now()) {
    routeCooldowns.delete(cooldownKey(provider, model));
    return false;
  }
  return true;
}

/** Diagnostics for the dashboard and tests. */
export function routeCooldownSnapshot() {
  const now = Date.now();
  return [...routeCooldowns.entries()]
    .filter(([, entry]) => entry.until > now)
    .map(([route, entry]) => ({
      route,
      retryInMs: entry.until - now,
      status: entry.status,
      reason: entry.reason,
    }));
}

export function resetRouteCooldowns() {
  routeCooldowns.clear();
}

/**
 * Rate-limit protection. The configured free gateways allow only ~10 requests
 * per minute, so calls are spaced out and a 429 is retried after the window the
 * provider asks for. Without this, a burst of field lookups all fail and the
 * agent falls back to asking the candidate for answers it could have decided.
 */
const MIN_CALL_INTERVAL_MS = Number(process.env.AI_MIN_INTERVAL_MS || 0);
const MAX_429_WAIT_MS = Number(process.env.AI_429_MAX_WAIT_MS || 20000);
let callChain = Promise.resolve();
const lastCallByBucket = new Map();

function withCallThrottle(task, bucket = 'global') {
  const run = callChain.then(async () => {
    const last = lastCallByBucket.get(bucket) || 0;
    const wait = MIN_CALL_INTERVAL_MS - (Date.now() - last);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCallByBucket.set(bucket, Date.now());
    return task();
  });
  // Keep the chain alive even if this call rejects.
  callChain = run.then(() => {}, () => {});
  return run;
}

// Per-key cooldown + round-robin cursor so several accounts rotate cleanly.
const keyCooldowns = new Map();
const keyCursor = new Map();
// Keys the provider rejected outright (401/403). A single dead or truncated key
// must never break round-robin for the healthy accounts, so we retire it and
// keep using the rest. Retried again after the TTL in case it was a glitch.
const badKeys = new Map(); // `${provider}:${index}` -> expiresAt
const BAD_KEY_TTL_MS = Number(process.env.AI_BAD_KEY_TTL_MS || 6 * 60 * 60 * 1000);

function markBadKey(name, index, reason) {
  badKeys.set(`${name}:${index}`, Date.now() + BAD_KEY_TTL_MS);
  console.warn(`[model-router] ${name} key #${index + 1} rejected (auth) — skipping it: ${String(reason || '').slice(0, 120)}`);
}

function isBadKey(name, index) {
  const until = badKeys.get(`${name}:${index}`);
  if (!until) return false;
  if (until <= Date.now()) {
    badKeys.delete(`${name}:${index}`);
    return false;
  }
  return true;
}

export function isPaidOpenAiActive() {
  const check = (val) => {
    if (val === undefined || val === null || val === '') return null;
    const s = String(val).trim().toLowerCase();
    return s !== 'false' && s !== 'off' && s !== '0' && s !== 'no';
  };
  const o = check(process.env.OPENAI_ENABLED);
  const p = check(process.env.AI_PAID_ENABLED);
  if (o === false || p === false) return false;
  if (o === true || p === true) return true;
  return true;
}

function pickKeyOrder(name, role = null) {
  const keys = providerKeys(name);
  if (!keys.length) return [];
  let preferredIndex = null;
  if (name === 'nara' && role) {
    // When using Nara, route specific roles to dedicated accounts so they don't starve each other:
    //  Index 1: BYNARA_API_KEY_2 (Primary model - form field analysis)
    //  Index 2: BYNARA_API_KEY_3 (Reasoning model - complex error recovery)
    //  Index 3: BYNARA_API_KEY_4 (Vision model - screenshot checks)
    //  Index 4: BYNARA_API_KEY_5 (Fast decisions - quick micro checks)
    //  Index 0: BYNARA_API_KEY   (General app - resume tailoring, cover letter, chat)
    const roleKeyMap = {
      primary: 1,
      reasoning: 2,
      vision: 3,
      fast: 4,
    };
    if (roleKeyMap[role] != null && roleKeyMap[role] < keys.length) {
      preferredIndex = roleKeyMap[role];
    } else {
      preferredIndex = 0;
    }
  }

  const start = preferredIndex != null ? preferredIndex : (keyCursor.get(name) || 0);
  const now = Date.now();
  const order = [];
  for (let i = 0; i < keys.length; i += 1) {
    const index = (start + i) % keys.length;
    if (isBadKey(name, index)) continue;
    const until = keyCooldowns.get(`${name}:${index}`) || 0;
    order.push({ index, key: keys[index], cooling: until > now });
  }
  // Fresh keys first; cooling keys only become fallbacks.
  return [...order.filter((entry) => !entry.cooling), ...order.filter((entry) => entry.cooling)];
}

function markKeyCooldown(name, index, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  keyCooldowns.set(`${name}:${index}`, Date.now() + ms);
}

function clearKeyCooldown(name, index) {
  keyCooldowns.delete(`${name}:${index}`);
}

function advanceKeyCursor(name, index, total) {
  if (total > 0) keyCursor.set(name, (index + 1) % total);
}

export function keyPoolSnapshot() {
  const now = Date.now();
  return Object.keys(PROVIDER_KEY_ENV).map((name) => ({
    provider: name,
    keys: providerKeys(name).length,
    cooling: [...keyCooldowns.entries()].filter(([route, until]) => route.startsWith(`${name}:`) && until > now).length,
    bad: [...badKeys.entries()].filter(([route, until]) => route.startsWith(`${name}:`) && until > now).length,
  }));
}

function retryAfterMs(message) {
  const match = String(message || '').match(/try again in (\d+(?:\.\d+)?)\s*s/i);
  return Math.min((Number(match?.[1]) || 8) * 1000 + 500, MAX_429_WAIT_MS);
}

function ensureUsageFile() {
  try {
    const dir = path.dirname(USAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(USAGE_FILE)) fs.writeFileSync(USAGE_FILE, '[]', 'utf8');
  } catch { /* reads fall back to an empty list */ }
}

function readUsageFile() {
  ensureUsageFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsageFile(rows) {
  ensureUsageFile();
  const trimmed = rows.slice(-MAX_USAGE_ROWS);
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (err) {
    console.warn('[model-router] could not persist usage:', err.message);
  }
}

function priceKey(model) {
  return String(model || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function priceForModel(model) {
  const key = priceKey(model);
  const envIn = Number(process.env[`AI_PRICE_${key}_IN`]);
  const envOut = Number(process.env[`AI_PRICE_${key}_OUT`]);
  const fallback = DEFAULT_PRICES[String(model || '').toLowerCase()] || { in: 0, out: 0 };
  return {
    inputPerMillion: Number.isFinite(envIn) && envIn >= 0 ? envIn : fallback.in,
    outputPerMillion: Number.isFinite(envOut) && envOut >= 0 ? envOut : fallback.out,
  };
}

export function modelConfig() {
  const models = {};
  for (const role of MODEL_ROLES) {
    models[role] = String(process.env[ROLE_ENV[role]] || ROLE_DEFAULTS[role]).trim();
  }
  return {
    models,
    provider: String(process.env.AI_PROVIDER || 'auto').toLowerCase(),
    providerOrder: String(process.env.AI_PROVIDER_ORDER || 'nara,openai,nvidia,gemini,freellm')
      .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
    fallbackModel: String(process.env.AI_MODEL_FALLBACK || '').trim(),
    maxCallsPerTask: Number(process.env.AI_MAX_CALLS_PER_TASK || 80),
    maxTokensPerTask: Number(process.env.AI_MAX_TOKENS_PER_TASK || 200000),
    maxCostPerTaskUsd: Number(process.env.AI_MAX_COST_PER_TASK_USD || 1.50),
    requestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS || 60000),
    visionEnabled: String(process.env.AI_VISION_ENABLED || 'true') !== 'false',
  };
}

// Which env vars hold keys for each provider. The base name plus numbered
// suffixes (_2, _3, ...) let several accounts be rotated round-robin, so the
// free per-account rate limit is no longer a bottleneck.
const PROVIDER_KEY_ENV = {
  openai: ['OPENAI_API_KEY'],
  runcrate: ['RUNCRATE_API_KEY'],
  numes: ['NUMES_API_KEY'],
  nara: ['BYNARA_API_KEY', 'NARA_API_KEY'],
  nvidia: ['NVIDIA_API_KEY'],
  freellm: ['FREELLMAPI_KEY', 'FREELLMAPI_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
};

const MAX_KEYS_PER_PROVIDER = Number(process.env.AI_MAX_KEYS_PER_PROVIDER || 30);

/** All configured keys for a provider, in a stable order. */
export function providerKeys(name) {
  const bases = PROVIDER_KEY_ENV[name] || [];
  const keys = [];
  const seen = new Set();
  const push = (value) => {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  for (const base of bases) {
    push(process.env[base]);
    for (let index = 1; index <= MAX_KEYS_PER_PROVIDER; index += 1) {
      push(process.env[`${base}_${index}`]);
    }
  }
  return keys;
}

function providerConfig(name) {
  const keys = providerKeys(name);
  switch (name) {
    case 'openai':
      return {
        key: keys[0] || '',
        base: String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        kind: 'responses',
      };
    case 'runcrate':
      return {
        key: keys[0] || '',
        base: String(process.env.RUNCRATE_BASE_URL || 'https://api.runcrate.ai/v1').replace(/\/+$/, ''),
        kind: 'chat',
      };
    case 'numes':
      return {
        key: keys[0] || '',
        base: String(process.env.NUMES_BASE_URL || 'https://api.numes.ai/api/v1').replace(/\/+$/, ''),
        kind: 'chat',
      };
    case 'nara':
      return {
        key: keys[0] || '',
        base: String(process.env.BYNARA_BASE_URL || 'https://router.bynara.id/v1').replace(/\/+$/, ''),
        kind: 'chat',
      };
    case 'nvidia':
      return {
        key: keys[0] || '',
        base: String(process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, ''),
        kind: 'chat',
      };
    case 'freellm':
      return {
        key: keys[0] || '',
        base: String(process.env.FREELLMAPI_BASE_URL || 'http://localhost:3001/v1').replace(/\/+$/, ''),
        kind: 'chat',
      };
    case 'gemini':
      return {
        key: keys[0] || '',
        base: 'https://generativelanguage.googleapis.com/v1beta',
        kind: 'gemini',
      };
    default:
      return { key: '', base: '', kind: 'chat' };
  }
}

export function providerStatus() {
  return ['openai', 'runcrate', 'numes', 'nara', 'nvidia', 'freellm', 'gemini'].map((name) => {
    const cfg = providerConfig(name);
    const keys = providerKeys(name);
    return { provider: name, configured: keys.length > 0, keys: keys.length, mode: cfg.kind };
  });
}

/**
 * Model → provider pins.
 *
 * A gateway alias is not portable: `gpt-6-luna` only exists on the Nara router,
 * so sending it to OpenAI/NVIDIA/FreeLLM just burns a failing request (and the
 * route then cools down). `AI_PROVIDER_PINS` (default `gpt-6-luna=nara`) keeps a
 * pinned model on its own provider and lets every other model use the normal
 * fallback order.
 */
function providerPins() {
  const raw = String(process.env.AI_PROVIDER_PINS || 'gpt-6-luna=nara');
  const pins = {};
  for (const pair of raw.split(',')) {
    const [model, provider] = pair.split('=').map((value) => String(value || '').trim().toLowerCase());
    if (model && provider) pins[model] = provider;
  }
  return pins;
}

export function providerPinSnapshot() {
  return providerPins();
}

/**
 * Candidate model/provider pairs for a role.
 *
 * With `AI_STRICT_LANES` (default on) this returns exactly one route:
 *   - `paid: false` → `AI_FREE_PROVIDER` / `AI_FREE_MODEL` (default nara / gpt-6-luna)
 *   - `paid: true`  → `AI_PAID_PROVIDER` (default openai) with the real model ID for
 *     the role from `AI_MODEL_<ROLE>_OPENAI`
 * Only the Auto Apply feature passes `paid: true`, so OpenAI credit is spent by
 * the browser agent alone. Set `AI_STRICT_LANES=false` to restore the old
 * multi-provider fallback chain.
 */
export function modelRoutes(role = 'primary', options = {}) {
  const cfg = modelConfig();
  const safeRole = MODEL_ROLES.includes(role) ? role : 'primary';
  const primaryModel = cfg.models[safeRole];
  const fallback = cfg.fallbackModel || cfg.models.primary;
  let providers = cfg.provider === 'auto'
    ? cfg.providerOrder
    : [cfg.provider, ...cfg.providerOrder.filter((item) => item !== cfg.provider)];

  const paidEnabled = isPaidOpenAiActive();
  const paid = options.paid === true && paidEnabled;

  // Two disjoint lanes, no mixing:
  //   free lane (every feature except Auto Apply, or when OPENAI_ENABLED=false) -> one provider + one model
  //   paid lane (Auto Apply only when OPENAI_ENABLED=true, paid:true)          -> OpenAI key + real model IDs
  // A lane never falls back into the other, so turning Auto Apply on cannot
  // spend the gateway keys and the rest of the app cannot spend OpenAI credit.
  const strictLanes = String(process.env.AI_STRICT_LANES || 'true') !== 'false';
  if (strictLanes) {
    const laneProvider = String(paid
      ? (process.env.AI_PAID_PROVIDER || 'openai')
      : (process.env.AI_FREE_PROVIDER || 'nara')).trim().toLowerCase();
    if (laneProvider !== 'gemini' && providerConfig(laneProvider).key) {
      const laneModel = paid
        ? (String(process.env[`${ROLE_ENV[safeRole]}_${laneProvider.toUpperCase()}`] || '').trim()
          || String(process.env.OPENAI_MODEL || '').trim()
          || cfg.models[safeRole])
        : (String(process.env[`${ROLE_ENV[safeRole]}_NARA`] || '').trim()
          || String(process.env.AI_FREE_MODEL || 'gpt-6-luna').trim());
      return [{ provider: laneProvider, model: laneModel, role: safeRole }];
    }
  }

  if (!paid) {
    // Hard gate: keep OpenAI out of every non-Auto-Apply feature so credits are
    // only used by the browser agent. Fall back to it only if nothing free is
    // configured, otherwise the app would have no AI at all.
    const free = providers.filter((item) => item !== 'openai');
    if (free.some((item) => providerConfig(item).key)) providers = free;
  } else if (safeRole !== 'fast'
    && String(process.env.AI_PREFER_OPENAI || 'true') !== 'false'
    && providerConfig('openai').key) {
    providers = ['openai', ...providers.filter((item) => item !== 'openai')];
  }

  const routes = [];
  const seen = new Set();
  const push = (model, provider) => {
    const key = `${provider}:${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({ model, provider, role: safeRole });
  };

  for (const provider of providers) {
    if (!providerConfig(provider).key) continue;
    const override = String(process.env[`${ROLE_ENV[safeRole]}_${provider.toUpperCase()}`] || '').trim();
    push(override || primaryModel, provider);
  }
  for (const provider of providers) {
    if (!providerConfig(provider).key) continue;
    if (fallback && fallback !== primaryModel) push(fallback, provider);
  }
  // Each gateway may expose its own model alias. Try it as a last resort so a
  // vendor-specific ID that the gateway rejects does not break the pipeline.
  const providerDefault = {
    nara: process.env.BYNARA_MODEL,
    nvidia: process.env.NVIDIA_MODEL,
    freellm: process.env.FREELLMAPI_MODEL,
    openai: process.env.OPENAI_MODEL,
  };
  for (const provider of providers) {
    const model = String(providerDefault[provider] || '').trim();
    if (!model) continue;
    if (provider === 'gemini') continue;
    push(model, provider);
  }
  // Gemini gateway cannot serve vendor-specific model IDs; use its own model.
  const geminiIndex = routes.findIndex((route) => route.provider === 'gemini');
  if (geminiIndex >= 0 && /^gpt-/i.test(routes[geminiIndex].model)) {
    routes[geminiIndex].model = String(process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash');
  }

  // Keep a pinned model on its own provider. If the pin removes every route
  // (provider not configured at all) fall back to the unfiltered list rather
  // than leaving the caller with no AI at all.
  const pins = providerPins();
  if (Object.keys(pins).length) {
    const pinnedRoutes = routes.filter((route) => {
      const pin = pins[String(route.model || '').toLowerCase()];
      return !pin || pin === route.provider;
    });
    if (pinnedRoutes.length) return pinnedRoutes;
  }
  return routes;
}

function mapMessagesForChat(messages) {
  return (messages || []).map((message) => {
    if (typeof message.content === 'string') return { role: message.role, content: message.content };
    const parts = Array.isArray(message.content) ? message.content : [];
    return {
      role: message.role,
      content: parts.map((part) => {
        if (part.type === 'image_url') {
          return { type: 'image_url', image_url: typeof part.image_url === 'string' ? { url: part.image_url } : part.image_url };
        }
        return { type: 'text', text: part.text || '' };
      }),
    };
  });
}

function mapMessagesForResponses(messages) {
  return (messages || []).map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: [{ type: 'input_text', text: message.content }] };
    }
    return {
      role: message.role,
      content: (message.content || []).map((part) => {
        if (part.type === 'image_url') {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
          return { type: 'input_image', image_url: url };
        }
        return { type: 'input_text', text: part.text || '' };
      }),
    };
  });
}

function mapMessagesForGemini(messages) {
  const system = (messages || []).filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  const contents = [];
  for (const message of (messages || []).filter((m) => m.role !== 'system')) {
    const parts = typeof message.content === 'string'
      ? [{ text: message.content }]
      : (message.content || []).map((part) => {
        if (part.type === 'image_url') {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
          const match = String(url || '').match(/^data:([^;]+);base64,(.+)$/);
          return match
            ? { inline_data: { mime_type: match[1], data: match[2] } }
            : { text: `Image URL: ${url}` };
        }
        return { text: part.text || '' };
      });
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  return { system, contents };
}

function normalizeUsage(raw = {}) {
  const input = Number(raw.input_tokens ?? raw.prompt_tokens ?? raw.promptTokenCount ?? 0) || 0;
  const output = Number(raw.output_tokens ?? raw.completion_tokens ?? raw.candidatesTokenCount ?? 0) || 0;
  const reasoning = Number(raw.output_tokens_details?.reasoning_tokens ?? raw.reasoning_tokens ?? raw.thoughtsTokenCount ?? 0) || 0;
  const cached = Number(raw.input_tokens_details?.cached_tokens ?? raw.cached_tokens ?? raw.cachedContentTokenCount ?? 0) || 0;
  const explicitCost = Number(raw.cost ?? raw.total_cost ?? raw.cost_usd);
  return {
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    cachedTokens: cached,
    providerCostUsd: Number.isFinite(explicitCost) ? explicitCost : null,
  };
}

async function callChatProvider(provider, cfg, { model, messages, maxTokens, temperature, timeoutMs, json }) {
  const response = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: mapMessagesForChat(messages),
      max_tokens: maxTokens,
      temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
    const error = new Error(`${provider} ${response.status}: ${String(detail).slice(0, 300)}`);
    error.code = response.status === 404 ? 'MODEL_NOT_FOUND' : 'PROVIDER_ERROR';
    error.status = response.status;
    throw error;
  }
  const raw = body?.choices?.[0]?.message?.content;
  const text = Array.isArray(raw)
    ? raw.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
    : String(raw || '');
  if (!text.trim()) throw new Error(`${provider} returned an empty response.`);
  return { text: text.trim(), usage: normalizeUsage(body.usage || {}) };
}

async function callOpenAIResponses(cfg, { model, messages, maxTokens, timeoutMs, json }) {
  const request = {
    model,
    input: mapMessagesForResponses(messages),
    // OpenAI reasoning models reject max_output_tokens below 16.
    max_output_tokens: Math.max(16, Number(maxTokens) || 16),
  };
  // Reasoning models reject sampling controls; leave temperature unset.
  if (json) request.text = { format: { type: 'json_object' } };
  const effort = String(process.env.AI_REASONING_EFFORT || '').trim();
  if (effort) request.reasoning = { effort };
  const response = await fetch(`${cfg.base}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    const error = new Error(`openai ${response.status}: ${String(detail).slice(0, 300)}`);
    error.code = response.status === 404 ? 'MODEL_NOT_FOUND' : 'PROVIDER_ERROR';
    error.status = response.status;
    throw error;
  }
  const text = body.output_text
    || (body.output || []).flatMap((item) => item.content || []).map((part) => part.text || '').join('');
  if (!String(text).trim()) throw new Error('openai returned an empty response.');
  return { text: String(text).trim(), usage: normalizeUsage(body.usage || {}) };
}

async function callGemini(cfg, { model, messages, maxTokens, temperature, timeoutMs }) {
  const { system, contents } = mapMessagesForGemini(messages);
  const response = await fetch(`${cfg.base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    const error = new Error(`gemini ${response.status}: ${String(detail).slice(0, 300)}`);
    error.code = response.status === 404 ? 'MODEL_NOT_FOUND' : 'PROVIDER_ERROR';
    error.status = response.status;
    throw error;
  }
  const text = (body.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
  if (!text.trim()) throw new Error('gemini returned an empty response.');
  return { text: text.trim(), usage: normalizeUsage(body.usageMetadata || {}) };
}

function computeCost(model, usage) {
  if (usage.providerCostUsd != null) return usage.providerCostUsd;
  const price = priceForModel(model);
  return ((usage.inputTokens / 1_000_000) * price.inputPerMillion)
    + ((usage.outputTokens / 1_000_000) * price.outputPerMillion);
}

function recordUsage(row) {
  const withId = { ...row, id: `aiu_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}` };
  const rows = readUsageFile();
  rows.push(withId);
  writeUsageFile(rows);
  if (isMongoActive()) {
    AiUsageModel.create(withId).catch((err) => console.warn('[model-router] mongo usage write failed:', err.message));
  }
  return withId;
}

export function getUsageSummary({ userId = '', taskId = '' } = {}) {
  const rows = readUsageFile().filter((row) => (
    (!userId || row.userId === userId) && (!taskId || row.taskId === taskId)
  ));
  const summary = {
    calls: rows.length,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    byModel: {},
    escalations: 0,
  };
  for (const row of rows) {
    summary.inputTokens += Number(row.inputTokens || 0);
    summary.outputTokens += Number(row.outputTokens || 0);
    summary.reasoningTokens += Number(row.reasoningTokens || 0);
    summary.cachedTokens += Number(row.cachedTokens || 0);
    summary.costUsd += Number(row.costUsd || 0);
    summary.latencyMs += Number(row.latencyMs || 0);
    summary.escalations += row.escalated ? 1 : 0;
    const key = row.model || 'unknown';
    if (!summary.byModel[key]) summary.byModel[key] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    summary.byModel[key].calls += 1;
    summary.byModel[key].inputTokens += Number(row.inputTokens || 0);
    summary.byModel[key].outputTokens += Number(row.outputTokens || 0);
    summary.byModel[key].costUsd += Number(row.costUsd || 0);
  }
  summary.costUsd = Math.round(summary.costUsd * 1_000_000) / 1_000_000;
  return summary;
}

export class BudgetExceededError extends Error {
  constructor(message, summary, limits) {
    super(message);
    this.name = 'BudgetExceededError';
    this.code = 'AI_BUDGET_EXCEEDED';
    this.summary = summary;
    this.limits = limits;
  }
}

function assertBudget(taskId, limits = {}) {
  if (!taskId) return;
  const cfg = modelConfig();
  const summary = getUsageSummary({ taskId });
  const maxCalls = Number(limits.maxCalls ?? cfg.maxCallsPerTask);
  const maxTokens = Number(limits.maxTokens ?? cfg.maxTokensPerTask);
  const maxCost = Number(limits.maxCostUsd ?? cfg.maxCostPerTaskUsd);
  const tokens = summary.inputTokens + summary.outputTokens;
  if (Number.isFinite(maxCalls) && summary.calls >= maxCalls) {
    throw new BudgetExceededError(`AI call budget reached (${summary.calls}/${maxCalls}).`, summary, { maxCalls, maxTokens, maxCost });
  }
  if (Number.isFinite(maxTokens) && tokens >= maxTokens) {
    throw new BudgetExceededError(`AI token budget reached (${tokens}/${maxTokens}).`, summary, { maxCalls, maxTokens, maxCost });
  }
  if (Number.isFinite(maxCost) && summary.costUsd >= maxCost) {
    throw new BudgetExceededError(`AI cost budget reached ($${summary.costUsd.toFixed(4)}/$${maxCost}).`, summary, { maxCalls, maxTokens, maxCost });
  }
}

/**
 * Route one completion call.
 *
 * @param {object} options
 * @param {'fast'|'primary'|'vision'|'reasoning'} options.role
 * @param {Array} options.messages  chat-style messages; content parts support images.
 * @param {string} [options.taskId]
 * @param {string} [options.userId]
 * @param {object} [options.budget] per-task overrides: {maxCalls,maxTokens,maxCostUsd}
 * @param {boolean} [options.json]
 * @param {boolean} [options.escalated]
 */
export async function executeModel({
  role = 'primary',
  messages = [],
  maxTokens = 900,
  temperature = 0.1,
  taskId = '',
  userId = '',
  budget = {},
  json = false,
  escalated = false,
  timeoutMs = null,
  paid = false,
} = {}) {
  const cfg = modelConfig();
  const allRoutes = modelRoutes(role, { paid });
  if (!allRoutes.length) {
    const error = new Error('No AI provider is configured. Add a provider API key to .env.');
    error.code = 'NO_AI_PROVIDER';
    throw error;
  }
  assertBudget(taskId, budget);

  // Skip routes that recently failed with a non-transient error. If literally
  // every route is cooling down, retry them all once instead of deadlocking.
  let routes = allRoutes.filter((route) => !isRouteCoolingDown(route.provider, route.model));
  if (!routes.length) {
    routes = allRoutes;
    resetRouteCooldowns();
  }

  const errors = [];
  for (const route of routes) {
    const providerCfg = providerConfig(route.provider);
    if (!providerCfg.key) continue;
    const startedAt = Date.now();
    try {
      const request = {
        model: route.model,
        messages,
        maxTokens,
        temperature,
        timeoutMs: timeoutMs || cfg.requestTimeoutMs,
        json,
      };
      const invoke = (activeCfg) => (route.provider === 'openai' && activeCfg.kind === 'responses'
        ? callOpenAIResponses(activeCfg, request)
        : route.provider === 'gemini'
          ? callGemini(activeCfg, request)
          : callChatProvider(route.provider, activeCfg, request));

      // Round-robin across every configured key for this provider.
      // Nara routes each role to a dedicated account so roles do not starve each other.
      const keyOrder = pickKeyOrder(route.provider, role);
      const totalKeys = keyOrder.length;
      let result = null;
      for (const { index, key } of keyOrder) {
        try {
          // Retry transient network blips per key with backoff before
          // failing — a one-off outage shouldn't stall an Auto Apply run.
          let attempt = 0;
          while (true) {
            try {
              result = await withCallThrottle(() => invoke({ ...providerCfg, key }), `${route.provider}:${index}`);
              break;
            } catch (err) {
              if (attempt >= 2 || !isTransientNetError(err)) throw err;
              attempt += 1;
              await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
            }
          }
          if (!result) continue;
          clearKeyCooldown(route.provider, index);
          advanceKeyCursor(route.provider, index, totalKeys);
          break;
        } catch (err) {
          if (err?.status === 429 && totalKeys > 1) {
            markKeyCooldown(route.provider, index, retryAfterMs(err.message));
            advanceKeyCursor(route.provider, index, totalKeys);
            continue;
          }
          if (err?.status === 429) {
            const waitMs = retryAfterMs(err.message);
            console.warn(`[model-router] ${route.provider}/${route.model} rate-limited; waiting ${Math.round(waitMs / 1000)}s`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            result = await withCallThrottle(() => invoke({ ...providerCfg, key }), `${route.provider}:${index}`);
            advanceKeyCursor(route.provider, index, totalKeys);
            break;
          }
          if (err?.status === 401 || err?.status === 403) {
            // A dead or truncated key must not kill the whole provider: retire
            // just that key and keep rotating through the healthy accounts.
            markBadKey(route.provider, index, err.message);
            advanceKeyCursor(route.provider, index, totalKeys);
            continue;
          }
          throw err;
        }
      }
      if (!result) {
        const soonest = keyOrder[0];
        if (!soonest) {
          const authError = new Error(`${route.provider} has no usable API key (every configured key was rejected).`);
          authError.status = 401;
          throw authError;
        }
        // Every key is cooling down: wait for the soonest one and use it.
        const waitMs = Math.max(0, (keyCooldowns.get(`${route.provider}:${soonest.index}`) || 0) - Date.now());
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, MAX_429_WAIT_MS)));
        result = await withCallThrottle(() => invoke({ ...providerCfg, key: soonest.key }), `${route.provider}:${soonest.index}`);
        clearKeyCooldown(route.provider, soonest.index);
        advanceKeyCursor(route.provider, soonest.index, totalKeys);
      }
      clearRouteFailure(route.provider, route.model);
      const latencyMs = Date.now() - startedAt;
      const costUsd = computeCost(route.model, result.usage);
      recordUsage({
        userId,
        taskId,
        role: route.role,
        model: route.model,
        provider: route.provider,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        reasoningTokens: result.usage.reasoningTokens,
        cachedTokens: result.usage.cachedTokens,
        costUsd,
        latencyMs,
        escalated: Boolean(escalated),
        at: new Date().toISOString(),
      });
      return {
        text: result.text,
        model: route.model,
        provider: route.provider,
        role: route.role,
        usage: result.usage,
        costUsd,
        latencyMs,
        escalated: Boolean(escalated),
        fallbackUsed: errors.length > 0,
        errors,
      };
    } catch (err) {
      markRouteFailure(route.provider, route.model, err);
      errors.push({
        provider: route.provider,
        model: route.model,
        status: Number(err?.status || 0),
        error: String(err?.message || err).slice(0, 300),
      });
      console.warn(`[model-router] ${route.provider}/${route.model} failed:`, String(err?.message || err).slice(0, 180));
    }
  }
  const error = new Error(`All AI providers failed for role "${role}". ${errors.map((e) => e.error).join(' | ')}`.slice(0, 700));
  error.code = 'AI_PROVIDERS_FAILED';
  error.attempts = errors;
  throw error;
}

/** Parse a JSON object from a model response without trusting extra prose. */
export function parseModelJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Choose the right role for the next agent decision.
 * Routine observation stays on the primary agent; repeated failures or
 * conflicting information escalate to the reasoning model.
 */
export function roleForSituation({ failures = 0, visual = false, conflicting = false, complex = false } = {}) {
  if (failures >= 3 || conflicting) return 'reasoning';
  if (visual) return 'vision';
  if (failures >= 2 || complex) return 'primary';
  return 'primary';
}

/**
 * The kind of work each Auto Apply step actually is, mapped to the tier that is
 * right for it. This is the place to choose "which model for which task":
 * cheap deterministic work stays on the fast model, page decisions use the
 * primary agent, screenshots use vision, and repeated failures/conflicts
 * escalate to reasoning.
 *
 * Override any task without touching code:
 *   AI_TASK_ROLE_AGENT_STEP=reasoning
 *   AI_TASK_ROLE_ANSWER_INFERENCE=fast
 */
export const TASK_ROLE_DEFAULTS = {
  agent_step: 'primary',
  agent_recovery: 'reasoning',
  vision: 'vision',
  answer_inference: 'fast',
  label_extraction: 'fast',
  submission_check: 'fast',
  resume_selection: 'primary',
  job_analysis: 'primary',
};

export function roleForTask(task, { failures = 0, visual = false, conflicting = false } = {}) {
  const name = String(task || '').trim();
  if (name === 'agent_step' || name === 'agent_recovery') {
    if (name === 'agent_recovery' || failures >= 3 || conflicting) return 'reasoning';
    if (visual) return 'vision';
    return 'primary';
  }
  const configured = String(process.env[`AI_TASK_ROLE_${name.toUpperCase()}`] || '').trim();
  if (MODEL_ROLES.includes(configured)) return configured;
  return TASK_ROLE_DEFAULTS[name] || 'primary';
}

export async function probeModels({ role = 'fast', userId = '', taskId = '', paid = false } = {}) {
  const cfg = modelConfig();
  const routes = modelRoutes(role, { paid });
  if (!routes.length) return { ok: false, error: 'No AI provider configured.', providers: providerStatus(), routes };
  try {
    const result = await executeModel({
      role,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      maxTokens: 32,
      temperature: 0,
      taskId,
      userId,
      paid,
    });
    return { ok: true, model: result.model, provider: result.provider, usage: result.usage, config: cfg };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code, providers: providerStatus(), routes };
  }
}
