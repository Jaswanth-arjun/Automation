/**
 * Guard rails for the Auto Apply with AI safety contract:
 *  - the vision prompt can never invent legal / experience facts,
 *  - a saved answer is never reused across a different legal question or country,
 *  - there is exactly one browser execution authority (extension + approval gate),
 *  - the answer vault is user-scoped, and the legacy auto-submit flag is gone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { Gpt6VisionEngine } from '../lib/gpt6-vision-engine.js';
import { answerCompatibility } from '../lib/answer-memory.js';
import { modelRoutes, roleForTask } from '../lib/model-router.js';
import { extendedBudget, isNoiseQuestion } from '../lib/application-tasks.js';

const root = process.cwd();
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('vision prompt never asserts work authorization or experience the profile did not provide', async () => {
  const originalFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, options = {}) => {
    sent = JSON.parse(String(options.body || '{}'));
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"wait"}' } }] }),
      text: async () => '',
    };
  };
  try {
    const engine = new Gpt6VisionEngine();
    await engine._queryLunaVision({
      base64Screenshot: 'AAAA',
      jobTitle: 'Forward Deployed Engineer Intern',
      company: 'Google',
      profile: { fullName: 'Test Candidate', email: 'c@example.com' },
      stepNumber: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(sent, 'the engine should have called a provider');
  const prompt = String(sent.messages?.[1]?.content?.[0]?.text || '');
  assert.match(prompt, /not provided/);
  assert.doesNotMatch(prompt, /does NOT require visa sponsorship/i);
  assert.doesNotMatch(prompt, /Authorized to work in the country/i);
  assert.doesNotMatch(prompt, /3 years in software/i);
  assert.doesNotMatch(prompt, /click_submit/);
});

test('a saved work-authorization answer is not reused for another country or for sponsorship', () => {
  // Pure compatibility check: no shared store, so this stays deterministic even
  // when the test runner executes files in parallel processes.
  const authorization = { question: 'Are you legally authorized to work in the United States?', answer: 'Yes' };

  assert.equal(answerCompatibility(authorization, 'Are you authorized to work in the United States?').ok, true);
  assert.equal(
    answerCompatibility(authorization, 'Are you legally authorized to work in India?').ok,
    false,
    'a US authorization must not answer an India question',
  );
  assert.equal(
    answerCompatibility(authorization, 'Will you require visa sponsorship?').ok,
    false,
    'authorization and sponsorship are different questions',
  );
});

test('the extension has one submission path and no silent question skipping', () => {
  const filler = source('extension/filler.js');
  assert.doesNotMatch(filler, /autoPromptMissed/, 'one timeout must not skip every later question');
  assert.doesNotMatch(filler, /pending\.autoSubmit/, 'the legacy auto-submit flag is gone');
  assert.match(filler, /waitForDashboardAnswer\(question, 180000\)/, 'task questions must also wait for a dashboard answer');
  assert.match(filler, /async function waitForDashboardApproval/, 'the approval gate stays the only submit path');

  for (const file of ['extension/bridge.js', 'extension/background.js']) {
    assert.doesNotMatch(source(file), /autoSubmit/, `${file} must not carry the legacy auto-submit flag`);
  }
  assert.doesNotMatch(source('landing-page/src/pages/Apply.jsx'), /autoSubmit/);

  const manifest = JSON.parse(source('extension/manifest.json'));
  const scripts = (manifest.content_scripts || []).flatMap((entry) => entry.js || []);
  assert.ok(!scripts.includes('filler-enhancements.js'), 'the guess-memorising file must not be loaded');
  assert.ok(!fs.existsSync(path.join(root, 'extension/filler-enhancements.js')), 'the guess-memorising file is deleted');
});

test('two disjoint lanes: nara+gpt-6-luna for the app, OpenAI only for Auto Apply', () => {
  const previous = {};
  const overrides = {
    AI_STRICT_LANES: 'true',
    AI_FREE_PROVIDER: 'nara',
    AI_FREE_MODEL: 'gpt-6-luna',
    AI_PAID_PROVIDER: 'openai',
    OPENAI_ENABLED: 'true',
    AI_MODEL_PRIMARY_OPENAI: 'gpt-4.1',
    AI_MODEL_FAST_OPENAI: 'gpt-4.1-mini',
    AI_MODEL_VISION_OPENAI: 'gpt-4o-mini',
    AI_MODEL_REASONING_OPENAI: 'gpt-5',
    BYNARA_API_KEY: 'test-nara-key',
    OPENAI_API_KEY: 'test-openai-key',
  };
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  try {
    // Free lane: every role, one provider, one model, no OpenAI.
    for (const role of ['fast', 'primary', 'vision', 'reasoning']) {
      const routes = modelRoutes(role, { paid: false });
      assert.equal(routes.length, 1, `${role} free lane must be a single route`);
      assert.equal(routes[0].provider, 'nara');
      assert.equal(routes[0].model, 'gpt-6-luna');
    }

    // Paid lane: Auto Apply only, OpenAI only, real model ID per role.
    for (const [role, expected] of [
      ['fast', 'gpt-4.1-mini'],
      ['primary', 'gpt-4.1'],
      ['vision', 'gpt-4o-mini'],
      ['reasoning', 'gpt-5'],
    ]) {
      const routes = modelRoutes(role, { paid: true });
      assert.equal(routes.length, 1, `${role} paid lane must be a single route`);
      assert.equal(routes[0].provider, 'openai');
      assert.equal(routes[0].model, expected);
    }

    // When OPENAI_ENABLED is switched off, Auto Apply seamlessly routes all roles to free Nara
    process.env.OPENAI_ENABLED = 'false';
    for (const role of ['fast', 'primary', 'vision', 'reasoning']) {
      const routes = modelRoutes(role, { paid: true });
      assert.equal(routes.length, 1, `${role} free fallback must be a single route`);
      assert.equal(routes[0].provider, 'nara');
      assert.equal(routes[0].model, 'gpt-6-luna');
    }

    // When OPENAI_ENABLED is switched on again, Auto Apply returns to OpenAI models
    process.env.OPENAI_ENABLED = 'true';
    assert.equal(modelRoutes('primary', { paid: true })[0].provider, 'openai');
    assert.equal(modelRoutes('primary', { paid: true })[0].model, 'gpt-4.1');

    // Cheap deterministic work never pays for the primary model.
    assert.equal(roleForTask('answer_inference'), 'fast');
    assert.equal(roleForTask('label_extraction'), 'fast');
    assert.equal(roleForTask('submission_check'), 'fast');
    assert.equal(roleForTask('agent_step'), 'primary');
    assert.equal(roleForTask('resume_selection'), 'primary');
    assert.equal(roleForTask('agent_step', { visual: true }), 'vision');
    assert.equal(roleForTask('agent_step', { failures: 3 }), 'reasoning');
    assert.equal(roleForTask('agent_step', { conflicting: true }), 'reasoning');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('server-side browsers are retired and the vault is user-scoped', () => {
  const server = source('server.js');
  assert.match(server, /code: 'USE_EXTENSION_FLOW'/);
  assert.match(server, /function serverSideApplyEnabled\(\)/);
  assert.match(server, /refundFeature\(user, FEATURE_KEYS\.AUTO_APPLY, 1\)/, 'a failed start must refund the entitlement');
  assert.match(server, /async function vaultOwner\(req = \{\}\)/);
  assert.match(server, /userForToken\(bearer\)/, 'the vault must require a real session token, not the install-owner fallback');
  assert.match(server, /function vaultAnswerIsUnusable\(/, 'page chrome must never be stored as an answer');
  assert.match(server, /roleForTask\('agent_step'/, 'agent steps must use task-aware routing');
  assert.match(source('lib/application-tasks.js'), /roleForTask\('agent_step'/, 'the extension decision loop must use task-aware routing');
  assert.match(source('lib/advanced-ai-engine.js'), /roleForTask\('answer_inference'\)/);
  assert.match(server, /await saveAnswer\(owner\.id, \{/);
  assert.match(server, /await lookupAnswer\(owner\.id, question/);
  assert.doesNotMatch(server, /saveVaultCredential\(domain, \{ email, password/, 'portal passwords are never stored');
});

test('resuming a budget-paused application renews its AI allowance instead of re-pausing', () => {
  const limits = { maxCalls: 40, maxTokens: 90000, maxCostUsd: 0.4 };
  const usage = { calls: 38, inputTokens: 88884, outputTokens: 1790, costUsd: 0.16071 };
  const next = extendedBudget(limits, usage);
  assert.ok(next.maxTokens > usage.inputTokens + usage.outputTokens, 'the token cap must clear the tokens already spent');
  assert.ok(next.maxCalls > usage.calls, 'the call cap must leave room for more steps');
  assert.ok(next.maxCostUsd > usage.costUsd);

  const exhausted = { calls: 80, inputTokens: 200000, outputTokens: 400, costUsd: 1.5 };
  const renewed = extendedBudget({ maxCalls: 0, maxTokens: 0, maxCostUsd: 0 }, exhausted);
  assert.ok(renewed.maxCalls >= exhausted.calls + 10);
  assert.ok(renewed.maxTokens >= exhausted.inputTokens + exhausted.outputTokens + 60000);
  assert.ok(renewed.maxCostUsd >= exhausted.costUsd + 0.25);

  const tasks = source('lib/application-tasks.js');
  assert.match(tasks, /AI budget renewed after your review/, 'the activity log must show the renewed allowance');
});

test('scraped widget text is never a required question and never blocks a resume', () => {
  for (const noise of [
    '10 items selected',
    'Python (Programming Language) (Suggested), press delete to clear value',
    'completed step 2 of 7',
    'Alert: verify that the field',
  ]) {
    assert.equal(isNoiseQuestion(noise), true, noise);
  }
  assert.equal(isNoiseQuestion('Language Hindi Required Language* language'), false);
  assert.equal(isNoiseQuestion('Are you legally authorized to work in the United States?'), false);

  const tasks = source('lib/application-tasks.js');
  assert.match(tasks, /required: !isNoiseQuestion\(/);
  assert.doesNotMatch(
    tasks,
    /throw new Error\('Answer the pending questions before resuming the agent\.'\)/,
    'a pending question must not turn the Resume button into a silent dead end',
  );
});
