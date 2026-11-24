const DEFAULT_BASE_URL = 'http://localhost:3001/v1';
const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_NARA_BASE_URL = 'https://router.bynara.id/v1';
const DEFAULT_RADOX_BASE_URL = 'https://radoxai.com/v1';

function getBaseUrl() {
  return String(process.env.FREELLMAPI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getApiKey() {
  return String(process.env.FREELLMAPI_KEY || process.env.FREELLMAPI_API_KEY || '').trim();
}

/**
 * Call the local FreeLLMAPI OpenAI-compatible gateway.
 * Throws when it is not configured, unavailable, or returns an invalid result;
 * callers can then deliberately fall back to Gemini.
 */
export async function askFreeLLM(messages, { model, maxTokens = 800, temperature } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('FreeLLMAPI key is not configured.');

  const payload = {
    model: model || process.env.FREELLMAPI_MODEL || 'auto',
    messages,
    max_tokens: maxTokens,
  };
  if (temperature !== undefined) payload.temperature = temperature;

  const response = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(process.env.FREELLMAPI_TIMEOUT_MS || 60000)),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(`FreeLLMAPI request failed (${response.status}): ${detail}`);
  }

  const text = body?.choices?.[0]?.message?.content;
  if (Array.isArray(text)) {
    const joined = text.map((part) => typeof part === 'string' ? part : part?.text || '').join('');
    if (joined.trim()) return joined.trim();
  }
  if (typeof text === 'string' && text.trim()) return text.trim();
  throw new Error('FreeLLMAPI returned an empty response.');
}

export function hasFreeLLMAPI() {
  return Boolean(getApiKey());
}

export function getAllNaraApiKeys() {
  const keys = [];
  const primary = String(process.env.BYNARA_API_KEY || process.env.NARA_API_KEY || '').trim();
  if (primary) keys.push(primary);
  for (let i = 2; i <= 30; i += 1) {
    const k = String(process.env[`BYNARA_API_KEY_${i}`] || '').trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

function getNaraApiKey() {
  return String(process.env.BYNARA_API_KEY || process.env.NARA_API_KEY || '').trim();
}

function normalizeModelName(m, defaultName = 'gpt-6-luna') {
  let model = String(m || '').trim();
  if (model.includes('.')) model = model.replace(/\./g, '-');
  return model || defaultName;
}

/** Call Nara Router's OpenAI-compatible API. */
export async function askNara(messages, { model, maxTokens = 2200, temperature = 0.1, apiKey: explicitKey } = {}) {
  const apiKey = explicitKey || getNaraApiKey();
  if (!apiKey) throw new Error('BYNARA_API_KEY is not configured.');
  let baseUrl = String(process.env.BYNARA_BASE_URL || DEFAULT_NARA_BASE_URL).replace(/\/+$/, '');
  if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1')) baseUrl += '/v1';
  const chosenModel = normalizeModelName(model || process.env.BYNARA_MODEL, 'gpt-6-luna');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: chosenModel,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(Number(process.env.BYNARA_TIMEOUT_MS || 30000)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(`Nara API request failed (${response.status}): ${detail}`);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (Array.isArray(text)) {
    const joined = text.map((part) => typeof part === 'string' ? part : part?.text || '').join('');
    if (joined.trim()) return joined.trim();
  }
  if (typeof text === 'string' && text.trim()) return text.trim();
  throw new Error('Nara API returned an empty response.');
}

function getRadoxApiKey() {
  return String(process.env.RADOX_API_KEY || process.env.RADOXAI_API_KEY || '').trim();
}

/** Call RadoxAI / Coarena's OpenAI-compatible API. */
export async function askRadox(messages, { model, maxTokens = 3000, temperature = 0.1 } = {}) {
  const apiKey = getRadoxApiKey();
  if (!apiKey) throw new Error('RADOX_API_KEY is not configured.');
  let baseUrl = String(process.env.RADOX_BASE_URL || DEFAULT_RADOX_BASE_URL).replace(/\/+$/, '');
  if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1')) baseUrl += '/v1';
  const chosenModel = normalizeModelName(model || process.env.RADOX_MODEL, 'gpt-6-luna');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: chosenModel,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(Number(process.env.RADOX_TIMEOUT_MS || 60000)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(`RadoxAI request failed (${response.status}): ${detail}`);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (Array.isArray(text)) {
    const joined = text.map((part) => typeof part === 'string' ? part : part?.text || '').join('');
    if (joined.trim()) return joined.trim();
  }
  if (typeof text === 'string' && text.trim()) return text.trim();
  throw new Error('RadoxAI returned an empty response.');
}

function getNvidiaApiKey() {
  return String(process.env.NVIDIA_API_KEY || '').trim();
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function getOpenAiApiKey() {
  return String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim();
}

/** Call OpenAI official API */
export async function askOpenAI(messages, { model, maxTokens = 3000, temperature = 0.2 } = {}) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  let baseUrl = String(process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  if (!baseUrl.endsWith('/v1') && !baseUrl.includes('/v1')) baseUrl += '/v1';
  const chosenModel = model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: chosenModel,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS || 35000)),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
    const err = new Error(`OpenAI API request failed (${response.status}): ${detail}`);
    err.status = response.status;
    throw err;
  }
  const text = body?.choices?.[0]?.message?.content;
  if (Array.isArray(text)) {
    const joined = text.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
    if (joined.trim()) return joined.trim();
  }
  if (typeof text === 'string' && text.trim()) return text.trim();
  throw new Error('OpenAI API returned an empty response.');
}

/** Call NVIDIA's OpenAI-compatible API as a provider fallback. */
export async function askNvidia(messages, { model, maxTokens = 1600, temperature = 0.2 } = {}) {
  const apiKey = getNvidiaApiKey();
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not configured.');
  const baseUrl = String(process.env.NVIDIA_BASE_URL || DEFAULT_NVIDIA_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || process.env.NVIDIA_MODEL || 'openai/gpt-oss-20b',
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(Number(process.env.NVIDIA_TIMEOUT_MS || 120000)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
    throw new Error(`NVIDIA API request failed (${response.status}): ${detail}`);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text === 'string' && text.trim()) return text.trim();
  throw new Error('NVIDIA API returned an empty response.');
}
