import test from 'node:test';
import assert from 'node:assert/strict';

import express from 'express';
import { describesAiKeyFailure, maintenancePayload, aiMaintenanceMiddleware, MAINTENANCE_MESSAGE } from '../lib/ai-failure.js';

test('AI provider and API-key failures are recognised', () => {
  const failures = [
    'All configured AI providers failed. RadoxAI (gpt-6-luna): RadoxAI request failed (429): rate limit exceeded | Gemini: API key not valid.',
    'Gemini API key is not configured.',
    'FreeLLMAPI request failed (401): Unauthorized',
    'NVIDIA request failed (429): Too Many Requests',
    'OpenAI quota exceeded for this billing period.',
    'API key not valid. Please pass a valid API key.',
    'AI is unavailable — this is an editable template.',
    'All configured AI providers failed. Gemini: API key not configured',
  ];
  for (const message of failures) {
    assert.ok(describesAiKeyFailure(message), `expected a maintenance failure for: ${message}`);
  }
});

test('unrelated errors keep their own message', () => {
  const unrelated = [
    'Gmail rate limit reached. Wait a minute, then retry.',
    'Wait 30s before asking for another code.',
    'Search page loaded but no readable result cards found (LinkedIn may be rate-limiting concurrent automation).',
    'That job link could not be read.',
    'role, company, applyLink, and description are required.',
    'Could not connect Gmail. Reconnect your account.',
    'No readable result cards found on this page.',
    '',
    null,
  ];
  for (const message of unrelated) {
    assert.equal(describesAiKeyFailure(message), false, `expected no maintenance popup for: ${message}`);
  }
});

test('maintenance payload hides the provider detail', () => {
  assert.deepEqual(maintenancePayload(), {
    error: MAINTENANCE_MESSAGE,
    code: 'AI_MAINTENANCE',
    maintenance: true,
  });
  assert.ok(!/gemini|quota|429/i.test(MAINTENANCE_MESSAGE));
});

test('API failures become a maintenance response and fallbacks are flagged', async () => {
  const app = express();
  app.use(aiMaintenanceMiddleware());
  app.get('/provider-error', (req, res) => res.status(500).json({ error: 'Gemini API key not valid. 429 quota exceeded.' }));
  app.get('/fallback', (req, res) => res.json({ text: 'editable template', fallback: true, note: 'AI is unavailable — this is an editable template.' }));
  app.get('/user-error', (req, res) => res.status(429).json({ error: 'Wait 30s before asking for another code.' }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const failed = await fetch(`${base}/provider-error`);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), maintenancePayload());
    assert.equal(failed.headers.get('X-Hamzooh-Maintenance'), '1');

    const fallback = await fetch(`${base}/fallback`);
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get('X-Hamzooh-Maintenance'), '1');
    const fallbackBody = await fallback.json();
    assert.equal(fallbackBody.text, 'editable template', 'the useful fallback must survive');
    assert.equal(fallbackBody.maintenance, true);

    const userError = await fetch(`${base}/user-error`);
    assert.equal(userError.status, 429);
    assert.equal(userError.headers.get('X-Hamzooh-Maintenance'), null);
    assert.equal((await userError.json()).error, 'Wait 30s before asking for another code.');
  } finally {
    server.close();
  }
});
