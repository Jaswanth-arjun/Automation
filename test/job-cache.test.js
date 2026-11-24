import test from 'node:test';
import assert from 'node:assert/strict';

import {
  remember,
  dedupe,
  getCached,
  setCached,
  invalidate,
  invalidatePrefix,
  clearCache,
  cacheStats,
  resetCacheStats,
  jobCacheKey,
  normalizeText,
  hashKey,
} from '../lib/job-cache.js';

test('remember caches a value for the TTL and serves it without re-running', async () => {
  clearCache();
  resetCacheStats();
  let calls = 0;
  const factory = async () => {
    calls += 1;
    return { text: 'job description', calls };
  };

  const first = await remember('unit:remember:1', factory, { ttlMs: 60_000 });
  const second = await remember('unit:remember:1', factory, { ttlMs: 60_000 });

  assert.equal(calls, 1, 'the factory must run once inside the TTL');
  assert.deepEqual(first, second);
  assert.equal(cacheStats().hits, 1);
  assert.equal(cacheStats().misses, 1);
  assert.equal(getCached('unit:remember:1').found, true);
});

test('remember deduplicates concurrent callers into a single factory run', async () => {
  clearCache();
  resetCacheStats();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const factory = async () => {
    calls += 1;
    await gate;
    return 'shared-result';
  };

  const pending = Array.from({ length: 10 }, () => remember('unit:dedupe:1', factory, { ttlMs: 60_000 }));
  // Let all ten callers attach to the in-flight promise before it resolves.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, 'ten concurrent callers must share one in-flight call');
  release();

  const results = await Promise.all(pending);
  assert.deepEqual(results, Array(10).fill('shared-result'));
  assert.equal(calls, 1);
  assert.equal(cacheStats().deduped, 9);
});

test('an expired entry runs the factory again', async () => {
  clearCache();
  let calls = 0;
  const factory = async () => { calls += 1; return calls; };

  assert.equal(await remember('unit:ttl:1', factory, { ttlMs: 5 }), 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await remember('unit:ttl:1', factory, { ttlMs: 5 }), 2);
  assert.equal(calls, 2);
});

test('ttl 0 is single-flight only and never stores the result', async () => {
  clearCache();
  let calls = 0;
  const factory = async () => { calls += 1; return calls; };

  assert.equal(await remember('unit:ttl0:1', factory, { ttlMs: 0 }), 1);
  assert.equal(getCached('unit:ttl0:1').found, false);
  assert.equal(await remember('unit:ttl0:1', factory, { ttlMs: 0 }), 2);
  assert.equal(calls, 2);
});

test('a rejected factory is never cached, so the next caller retries', async () => {
  clearCache();
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary failure');
    return 'recovered';
  };

  await assert.rejects(() => remember('unit:error:1', flaky, { ttlMs: 60_000 }), /temporary failure/);
  assert.equal(getCached('unit:error:1').found, false);
  assert.equal(await remember('unit:error:1', flaky, { ttlMs: 60_000 }), 'recovered');
  assert.equal(calls, 2);
});

test('dedupe shares one in-flight promise but does not cache the value', async () => {
  clearCache();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const factory = async () => { calls += 1; await gate; return 'draft'; };

  const a = dedupe('unit:dedupe-only', factory);
  const b = dedupe('unit:dedupe-only', factory);
  release();
  assert.deepEqual(await Promise.all([a, b]), ['draft', 'draft']);
  assert.equal(calls, 1);

  await dedupe('unit:dedupe-only', async () => { calls += 1; return 'draft'; });
  assert.equal(calls, 2, 'dedupe must not remember the value');
});

test('invalidate and invalidatePrefix remove only the matching keys', async () => {
  clearCache();
  setCached('unit:inv:a', 'a', 60_000);
  setCached('unit:inv:b', 'b', 60_000);
  setCached('other:c', 'c', 60_000);

  assert.equal(invalidate('unit:inv:a'), true);
  assert.equal(getCached('unit:inv:a').found, false);
  assert.equal(invalidatePrefix('unit:inv:'), 1);
  assert.equal(getCached('unit:inv:b').found, false);
  assert.equal(getCached('other:c').found, true);
});

test('jobCacheKey is stable for the same posting and changes with the text', () => {
  const a = jobCacheKey({
    url: 'https://example.com/jobs/1',
    jobDescription: 'We are hiring a   Backend Engineer.\r\nNode.js and AWS.',
  });
  const b = jobCacheKey({
    url: 'https://example.com/jobs/2',
    jobDescription: 'we are hiring a backend engineer.\nNode.js and AWS.',
  });
  const c = jobCacheKey({
    url: 'https://example.com/jobs/1',
    jobDescription: 'We are hiring a Frontend Engineer.\nReact and TypeScript.',
  });

  assert.equal(a, b, 'whitespace/case/URL differences must not split the same description');
  assert.notEqual(a, c);
  assert.equal(normalizeText(' A \r\n\r\n\r\n B '), 'a\n\nb');
  assert.equal(hashKey('same'), hashKey('same'));
  assert.notEqual(hashKey('same'), hashKey('different'));
});
