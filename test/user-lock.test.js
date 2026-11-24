import test from 'node:test';
import assert from 'node:assert/strict';

import { createKeyedLock } from '../lib/user-lock.js';

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test('the same key never runs two sections at once', async () => {
  const lock = createKeyedLock();
  let active = 0;
  let maxActive = 0;
  const order = [];

  const run = async (name) => {
    const release = await lock.acquire('user-1');
    try {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${name}`);
      await tick(15);
      order.push(`end:${name}`);
    } finally {
      active -= 1;
      release();
    }
  };

  await Promise.all([run('a'), run('b'), run('c')]);

  assert.equal(maxActive, 1, 'sections for one user must be serialised');
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
});

test('different keys run in parallel', async () => {
  const lock = createKeyedLock();
  let active = 0;
  let maxActive = 0;

  const run = async (key) => {
    const release = await lock.acquire(key);
    try {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick(15);
    } finally {
      active -= 1;
      release();
    }
  };

  await Promise.all([run('alice'), run('bob'), run('carol')]);
  assert.equal(maxActive, 3, 'one slow user must not block other users');
});

test('release is idempotent and cleans up the key', async () => {
  const lock = createKeyedLock();
  const release = await lock.acquire('user-2');
  assert.equal(lock.isBusy('user-2'), true);

  release();
  release(); // a double release must not unlock a later holder
  assert.equal(lock.isBusy('user-2'), false);
  assert.equal(lock.size(), 0);

  // A section that throws still releases, so the user is never wedged.
  await assert.rejects(async () => {
    const held = await lock.acquire('user-3');
    try {
      throw new Error('boom');
    } finally {
      held();
    }
  }, /boom/);
  assert.equal(lock.isBusy('user-3'), false);
});
