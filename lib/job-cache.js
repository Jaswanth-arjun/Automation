/**
 * Phase A shared cache for expensive, repeatable work.
 *
 * Two primitives, deliberately small and dependency-free:
 *
 *  1. `remember(key, factory, { ttlMs })`
 *     - returns the cached value while it is fresh (24h for job postings),
 *     - otherwise runs `factory()` once and stores the result,
 *     - while `factory()` is still running, every concurrent caller for the
 *       same key awaits the *same* promise. Ten candidates opening the same
 *       Amazon posting therefore launch exactly one browser and make exactly
 *       one AI extraction call.
 *
 *  2. `dedupe(key, factory)`
 *     - single-flight only, never stores the result. Used for AI calls that
 *       must stay fresh (cover letters, email replies) but must not be billed
 *       twice when a user double-clicks or a request is retried.
 *
 * The cache is per process. That is intentional for Phase A (single Node
 * instance). Phase B swaps this module's internals for Redis while keeping the
 * exact same API, so call sites never change.
 */

import crypto from 'crypto';

const DEFAULT_TTL_MS = Math.max(0, Number(process.env.JOB_CACHE_TTL_MS || 24 * 60 * 60 * 1000));
const MAX_ENTRIES = Math.max(1, Number(process.env.JOB_CACHE_MAX_ENTRIES || 300));

/** key -> { value, expiresAt, createdAt, hits } */
const store = new Map();
/** key -> Promise (single-flight) */
const inFlight = new Map();

const counters = {
  hits: 0,
  misses: 0,
  stores: 0,
  evictions: 0,
  deduped: 0,
  failures: 0,
  invalidated: 0,
};

function cloneValue(value, clone) {
  if (!clone) return value;
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    // Functions/streams cannot be cloned; hand back the original reference
    // rather than failing a cache read.
    return value;
  }
}

function isFresh(entry) {
  return Boolean(entry) && entry.expiresAt > Date.now();
}

function evictIfNeeded() {
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
    counters.evictions += 1;
  }
}

/** Normalise text so two copies of the same posting hash identically. */
export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Stable short hash for cache keys built from long prompts or job text. */
export function hashKey(...parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    hash.update(typeof part === 'string' ? part : JSON.stringify(part ?? ''));
    hash.update('\u0000');
  }
  return hash.digest('hex').slice(0, 40);
}

/**
 * Cache key for a job posting. A URL and the pasted description are treated as
 * the same job only when both identify the same text; when a description is
 * supplied it wins because it is what the AI actually reads.
 */
export function jobCacheKey({ url = '', jobDescription = '', title = '', company = '' } = {}) {
  const description = normalizeText(jobDescription);
  if (description) return `job:text:${hashKey(title, company, description)}`;
  const cleanUrl = String(url || '').trim().toLowerCase().replace(/#.*$/, '');
  return `job:url:${hashKey(cleanUrl)}`;
}

/**
 * Read a fresh value without running anything.
 * @returns {{ found: boolean, value?: any }}
 */
export function getCached(key, { clone = false } = {}) {
  const entry = store.get(key);
  if (!entry) return { found: false };
  if (!isFresh(entry)) {
    store.delete(key);
    return { found: false };
  }
  entry.hits += 1;
  counters.hits += 1;
  return { found: true, value: cloneValue(entry.value, clone) };
}

/** Store a value. `ttlMs <= 0` disables storage (single-flight still applies). */
export function setCached(key, value, ttlMs = DEFAULT_TTL_MS) {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return value;
  if (store.has(key)) store.delete(key);
  evictIfNeeded();
  store.set(key, {
    value,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttl,
    hits: 0,
  });
  counters.stores += 1;
  return value;
}

/** Drop one key (for example after a job posting is edited). */
export function invalidate(key) {
  const existed = store.delete(key);
  if (existed) counters.invalidated += 1;
  return existed;
}

/** Drop everything whose key starts with `prefix`. */
export function invalidatePrefix(prefix) {
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed += 1;
    }
  }
  counters.invalidated += removed;
  return removed;
}

export function clearCache() {
  const size = store.size;
  store.clear();
  inFlight.clear();
  return size;
}

export function purgeExpired() {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function cacheStats() {
  const now = Date.now();
  let live = 0;
  for (const entry of store.values()) if (entry.expiresAt > now) live += 1;
  return {
    ...counters,
    size: store.size,
    live,
    maxEntries: MAX_ENTRIES,
    inFlight: inFlight.size,
    defaultTtlMs: DEFAULT_TTL_MS,
    hitRate: counters.hits + counters.misses > 0
      ? Math.round((counters.hits / (counters.hits + counters.misses)) * 1000) / 1000
      : 0,
  };
}

/**
 * Single-flight. Concurrent callers for the same key share one promise; the
 * result is not cached. Rejections are never cached, so a transient failure is
 * retried by the next caller.
 */
export function dedupe(key, factory) {
  const existing = inFlight.get(key);
  if (existing) {
    counters.deduped += 1;
    return existing;
  }
  const promise = (async () => {
    try {
      return await factory();
    } catch (err) {
      counters.failures += 1;
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

/**
 * Cache + single-flight in one call.
 *
 * @param {string} key
 * @param {() => Promise<any>|any} factory
 * @param {{ ttlMs?: number, clone?: boolean }} [options]
 */
export function remember(key, factory, options = {}) {
  const ttlMs = options.ttlMs === undefined ? DEFAULT_TTL_MS : Number(options.ttlMs);
  const clone = options.clone === true;

  const cached = getCached(key, { clone });
  if (cached.found) return Promise.resolve(cached.value);

  counters.misses += 1;
  const existing = inFlight.get(key);
  if (existing) {
    counters.deduped += 1;
    return existing;
  }

  const promise = (async () => {
    try {
      const value = await factory();
      setCached(key, value, ttlMs);
      return value;
    } catch (err) {
      counters.failures += 1;
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

/** Test helper: reset counters without touching cached values. */
export function resetCacheStats() {
  for (const key of Object.keys(counters)) counters[key] = 0;
}
