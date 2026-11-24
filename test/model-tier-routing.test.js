import test from 'node:test';
import assert from 'node:assert/strict';

import { modelRoutes, tierModel, freeLaneModel, modelConfig } from '../lib/model-router.js';

const ENV_KEYS = [
  'OPENAI_ENABLED',
  'AI_PAID_ENABLED',
  'AI_STRICT_LANES',
  'AI_PAID_PROVIDER',
  'AI_FREE_PROVIDER',
  'AI_FREE_MODEL',
  'AI_PAID_FALLBACK_FREE',
  'OPENAI_API_KEY',
  'BYNARA_API_KEY',
  'AI_MODEL_PRIMARY_OPENAI',
  'AI_MODEL_FAST_OPENAI',
  'AI_MODEL_VISION_OPENAI',
  'AI_MODEL_REASONING_OPENAI',
  'AI_MODEL_FREE_OPENAI',
  'AI_MODEL_FREE_OPENAI_PRIMARY',
  'AI_MODEL_PRIMARY_FREE_OPENAI',
  'AI_MODEL_FAST_FREE_OPENAI',
];

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of ENV_KEYS) previous[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    AI_STRICT_LANES: 'true',
    AI_PAID_PROVIDER: 'openai',
    AI_FREE_PROVIDER: 'nara',
    AI_FREE_MODEL: 'gpt-6-luna',
    OPENAI_API_KEY: 'test-openai-key',
    BYNARA_API_KEY: 'test-nara-key',
    AI_MODEL_PRIMARY_OPENAI: 'gpt-4.1',
    AI_MODEL_FAST_OPENAI: 'gpt-4.1-mini',
    AI_MODEL_VISION_OPENAI: 'gpt-4o-mini',
    AI_MODEL_REASONING_OPENAI: 'gpt-5',
    ...overrides,
  });
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('development mode (OPENAI_ENABLED=false) never touches OpenAI', () => {
  withEnv({ OPENAI_ENABLED: 'false', AI_PAID_ENABLED: 'true' }, () => {
    for (const tier of ['free', 'pro']) {
      for (const role of ['fast', 'primary', 'vision', 'reasoning']) {
        const routes = modelRoutes(role, { paid: true, tier });
        assert.equal(routes.length, 1, `${tier}/${role} must be a single free route`);
        assert.equal(routes[0].provider, 'nara');
        assert.equal(routes[0].model, 'gpt-6-luna');
        assert.equal(routes[0].lane, 'free');
      }
    }
    // Even an explicit paid request stays free while development mode is on.
    assert.ok(!modelRoutes('primary', { paid: true, fallback: true }).some((r) => r.provider === 'openai'));
  });
});

test('production free tier uses gpt-4o-mini, Pro tier uses the premium model', () => {
  withEnv({ OPENAI_ENABLED: 'true', AI_PAID_ENABLED: 'true' }, () => {
    const free = modelRoutes('primary', { paid: true, tier: 'free' });
    assert.equal(free.length, 1);
    assert.equal(free[0].provider, 'openai');
    assert.equal(free[0].model, 'gpt-4o-mini');
    assert.equal(free[0].lane, 'paid');

    const pro = modelRoutes('primary', { paid: true, tier: 'pro' });
    assert.equal(pro.length, 1);
    assert.equal(pro[0].provider, 'openai');
    assert.equal(pro[0].model, 'gpt-4.1');

    // No tier (Auto Apply's existing callers) keeps the role's paid model.
    assert.equal(modelRoutes('primary', { paid: true })[0].model, 'gpt-4.1');
  });
});

test('a paid lane can degrade to the free gateway without changing the public contract', () => {
  withEnv({ OPENAI_ENABLED: 'true', AI_PAID_ENABLED: 'true', AI_PAID_FALLBACK_FREE: 'true' }, () => {
    const single = modelRoutes('primary', { paid: true, tier: 'free' });
    assert.equal(single.length, 1, 'public modelRoutes() stays single-route');

    const withFallback = modelRoutes('primary', { paid: true, tier: 'free', fallback: true });
    assert.equal(withFallback.length, 2);
    assert.equal(withFallback[0].provider, 'openai');
    assert.equal(withFallback[0].model, 'gpt-4o-mini');
    assert.equal(withFallback[1].provider, 'nara');
    assert.equal(withFallback[1].model, 'gpt-6-luna');
  });
});

test('the free lane and tier models are configurable', () => {
  withEnv({
    OPENAI_ENABLED: 'true',
    AI_PAID_ENABLED: 'true',
    AI_MODEL_FREE_OPENAI: 'gpt-4.1-nano',
  }, () => {
    assert.equal(tierModel('free', 'primary'), 'gpt-4.1-nano');
    assert.equal(tierModel('pro', 'primary'), 'gpt-4.1');
    assert.equal(freeLaneModel('primary'), 'gpt-6-luna');
    const cfg = modelConfig();
    assert.equal(cfg.paidEnabled, true);
    assert.equal(cfg.tierModels.free.primary, 'gpt-4.1-nano');
  });
});
