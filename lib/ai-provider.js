const DEFAULT_BASE_URL = 'http://localhost:3001/v1';
const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_NARA_BASE_URL = 'https://router.bynara.id/v1';

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

function getNaraApiKey() {
  return String(process.env.BYNARA_API_KEY || process.env.NARA_API_KEY || '').trim();
}

/** Call Nara Router's OpenAI-compatible API. */
export async function askNara(messages, { model, maxTokens = 2200, temperature = 0.1 } = {}) {
  const apiKey = getNaraApiKey();
  if (!apiKey) throw new Error('BYNARA_API_KEY is not configured.');
  const baseUrl = String(process.env.BYNARA_BASE_URL || DEFAULT_NARA_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || process.env.BYNARA_MODEL || 'agnes-2.5-flash',
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(Number(process.env.BYNARA_TIMEOUT_MS || 120000)),
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

function getNvidiaApiKey() {
  return String(process.env.NVIDIA_API_KEY || '').trim();
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
      model: model || process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct',
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
