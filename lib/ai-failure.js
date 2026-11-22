/**
 * AI provider/API-key failures are an operator problem.
 *
 * When the configured AI key is rate-limited, out of quota, revoked or the
 * provider is down, users must never see the provider's message. These helpers
 * decide whether an error text describes such a failure so the API can answer
 * with a maintenance notice instead.
 */
export const MAINTENANCE_MESSAGE = 'The application is under maintenance. Please try again later.';

export const MAINTENANCE_CODE = 'AI_MAINTENANCE';

export function describesAiKeyFailure(value) {
  const text = String(value || '');
  if (!text) return false;
  const namesProvider = /\b(?:gemini|generativelanguage|google[- ]generative|nvidia|nara|radox|radoxai|freellm|freellmapi|openai|gpt-6|deepseek)\b/i.test(text);
  const providerProblem = /api[\s_-]?key|quotas?\b|\b(?:401|403|429|500|502|503|504)\b|rate[\s-]?limit|too many requests|resource_exhausted|insufficient|billing|credits?\b|permission denied|unauthori[sz]ed|unavailable|exceeded/i.test(text);
  // A bare API-key complaint ("API key not valid", "api key not configured")
  // is also operator-side even when the provider is not named.
  const apiKeyProblem = /api[\s_-]?key[^.]{0,80}(?:invalid|expired|revoked|not valid|missing|not configured|not set|exceeded|denied|quota)/i.test(text)
    || /(?:invalid|missing|revoked|expired|disabled)[^.]{0,40}api[\s_-]?key/i.test(text);
  // Routes that fall back to a deterministic template say "AI is unavailable"
  // instead of surfacing the provider error.
  const aiUnavailable = /\bai (?:is )?unavailable\b|all configured ai providers failed/i.test(text);
  return (namesProvider && providerProblem) || apiKeyProblem || aiUnavailable;
}

/** The body every API error should carry instead of a provider message. */
export function maintenancePayload() {
  return { error: MAINTENANCE_MESSAGE, code: MAINTENANCE_CODE, maintenance: true };
}

/**
 * Express middleware: rewrite AI provider failures so no client ever sees them.
 * Error responses become the maintenance payload (503); successful fallbacks
 * (template reply) keep their body, gain the maintenance flag and the
 * `X-Hamzooh-Maintenance` header the dashboard watches.
 */
export function aiMaintenanceMiddleware() {
  return function maintenanceMiddleware(req, res, next) {
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (!body || typeof body !== 'object') return sendJson(body);
      const details = [body.error, body.note, body.message]
        .filter((value) => typeof value === 'string' && value.trim());
      const failure = details.find((value) => describesAiKeyFailure(value));
      const flagged = body.maintenance === true || Boolean(failure);
      if (!flagged) return sendJson(body);
      if (failure) console.warn('[maintenance] AI provider failure hidden from the user:', failure.slice(0, 240));
      // The header lets the dashboard show its notice without reading the body.
      res.setHeader('X-Hamzooh-Maintenance', '1');
      if (res.statusCode >= 400) {
        res.status(503);
        return sendJson(maintenancePayload());
      }
      // A deterministic fallback is still useful: keep it, never repeat the
      // provider's message.
      const nextBody = { ...body, code: MAINTENANCE_CODE, maintenance: true };
      if (typeof body.error === 'string' && failure === body.error) nextBody.error = MAINTENANCE_MESSAGE;
      return sendJson(nextBody);
    };
    next();
  };
}
