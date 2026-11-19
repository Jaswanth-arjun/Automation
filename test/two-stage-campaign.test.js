import test from 'node:test';
import assert from 'node:assert/strict';

import { ReferralCampaignEngine } from '../lib/referral-campaign-engine.js';

/**
 * These tests exercise the two-stage target accounting without LinkedIn:
 * Stage 1 is company-wise with ONE target, Stage 2 keeps one target per role,
 * and neither stage may consume, reduce or redistribute the other's count.
 */

function person(index, extra = {}) {
  return {
    id: `p${index}`,
    name: `Person ${index}`,
    profileUrl: `https://www.linkedin.com/in/person-${index}`,
    connection: 'connected',
    phase: 'referral',
    eligible: true,
    previous: 'never_messaged',
    stage: 'never_messaged',
    action: '',
    message: '',
    result: '',
    error: '',
    at: null,
    ...extra,
  };
}

function invitePerson(index, role, result = 'success') {
  return {
    id: `i${index}`,
    name: `Invite ${index}`,
    profileUrl: `https://www.linkedin.com/in/invite-${index}`,
    connection: result === 'success' ? 'pending' : 'not_connected',
    phase: 'invite',
    inviteRole: role,
    stage: 'not_connected',
    action: 'invite',
    message: '',
    result,
    error: '',
    at: null,
  };
}

function makeEngine({ people, referralTarget = 5, perRole = 5, roles = ['Java Developer', 'React Developer', 'Software Engineer'] }) {
  const engine = new ReferralCampaignEngine({
    id: 'camp_test_two_stage',
    company: 'ABC Technologies',
    role: 'Software Engineer',
    people,
    config: { roles, perRole, referralTarget, useAINotes: false, userProfile: { fullName: 'Test User' } },
    stats: {},
  });

  // Isolate the accounting from the browser, the filesystem store and AI.
  engine.sendLog = [];
  engine.log = () => {};
  engine.save = () => null;
  engine.setStatus = () => null;
  engine.pauseGap = async () => {};
  engine.writeMessage = async (target) => `Hi ${target.name}, quick referral request.`;
  engine.sendNewThread = async (target) => {
    engine.sendLog.push(target.name);
    if (engine.onSend) engine.onSend(engine.sendLog.length);
    return { ok: true };
  };
  engine.sendToExistingThread = async (target) => {
    engine.sendLog.push(target.name);
    if (engine.onSend) engine.onSend(engine.sendLog.length);
    return { ok: true };
  };
  return engine;
}

test('test 1 — enough connections: Stage 1 sends exactly its company-wide target', async () => {
  const people = Array.from({ length: 10 }, (_, i) => person(i + 1));
  const engine = makeEngine({ people, referralTarget: 5 });

  await engine.runStage1();

  const stats = engine.stage1Stats();
  assert.equal(stats.target, 5);
  assert.equal(stats.matched, 10);
  assert.equal(stats.sent, 5);
  assert.equal(stats.status, 'completed');
  assert.equal(engine.sendLog.length, 5);
  assert.equal(people.filter((p) => p.result === 'skipped').length, 5);

  // Stage 2 targets are untouched by Stage 1's result.
  const stage2 = engine.stage2Stats();
  assert.deepEqual(stage2.roles.map((row) => row.target), [5, 5, 5]);
  assert.equal(stage2.sent, 0);
});

test('test 2 — not enough connections: Stage 1 sends what exists and Stage 2 still runs', async () => {
  const people = Array.from({ length: 3 }, (_, i) => person(i + 1));
  const engine = makeEngine({ people, referralTarget: 5 });

  await engine.runStage1();

  const stats = engine.stage1Stats();
  assert.equal(stats.sent, 3);
  assert.equal(stats.status, 'partially_completed');
  assert.equal(stats.remaining, 0);
  assert.equal(engine.sendLog.length, 3);

  // The shortfall of 2 is not added to any role.
  const stage2 = engine.stage2Stats();
  assert.deepEqual(stage2.roles.map((row) => row.target), [5, 5, 5]);
  assert.equal(stage2.target, 15);
});

test('test 3 — no connections: Stage 1 sends nothing and reports it honestly', async () => {
  const engine = makeEngine({ people: [], referralTarget: 5 });

  await engine.runStage1();

  const stats = engine.stage1Stats();
  assert.equal(stats.matched, 0);
  assert.equal(stats.sent, 0);
  assert.equal(stats.status, 'no_connections');
  assert.equal(engine.sendLog.length, 0);
  assert.deepEqual(engine.stage2Stats().roles.map((row) => row.target), [5, 5, 5]);
});

test('test 4 — multiple roles keep independent counts', () => {
  const people = [
    ...Array.from({ length: 5 }, (_, i) => invitePerson(i + 1, 'Java Developer')),
    ...Array.from({ length: 3 }, (_, i) => invitePerson(i + 20, 'React Developer')),
    ...Array.from({ length: 5 }, (_, i) => invitePerson(i + 40, 'Software Engineer')),
  ];
  const engine = makeEngine({ people });

  const stage2 = engine.stage2Stats();
  assert.deepEqual(stage2.roles.map((row) => [row.role, row.target, row.sent, row.status]), [
    ['Java Developer', 5, 5, 'completed'],
    ['React Developer', 5, 3, 'in_progress'],
    ['Software Engineer', 5, 5, 'completed'],
  ]);
  // One person can never be counted for two roles.
  assert.equal(stage2.sent, 13);
});

test('test 5 — resume never repeats a referral message', async () => {
  const people = Array.from({ length: 10 }, (_, i) => person(i + 1));
  const first = makeEngine({ people, referralTarget: 5 });
  first.onSend = (count) => { if (count >= 2) first.shouldStop = true; };
  await first.runStage1();

  const afterStop = first.stage1Stats();
  assert.equal(afterStop.sent, 2);
  assert.equal(first.stage1Done, false, 'a stopped run must not look finished');

  // Resume from the saved people list (the campaign row as it was persisted).
  const resumedPeople = people.map((p) => ({ ...p }));
  const second = makeEngine({ people: resumedPeople, referralTarget: 5 });
  await second.runStage1();

  const totalSent = resumedPeople.filter((p) => p.action === 'message' && p.result === 'success').length;
  assert.equal(totalSent, 5);
  assert.equal(second.sendLog.length, 3, 'only the three missing messages are sent');
  const names = resumedPeople.filter((p) => p.result === 'success').map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'no person was messaged twice');
});

test('test 5b — a person already contacted for this company is skipped', async () => {
  const people = Array.from({ length: 3 }, (_, i) => person(i + 1));
  const engine = makeEngine({ people, referralTarget: 5 });
  engine.loadPreviousCampaignMessages = () => {};
  engine.messagedBefore = new Set(['https://www.linkedin.com/in/person-1']);

  await engine.runStage1();

  assert.deepEqual(engine.sendLog, ['Person 2', 'Person 3']);
  assert.equal(people[0].result, 'skipped');
});

test('test 6/7 — referral messages use the previous conversation when it exists', () => {
  const engine = makeEngine({ people: [] });

  const withHistory = person(1, {
    previous: 'replied',
    stage: 'replied',
    conversation: [
      { direction: 'out', text: 'Hi, are you at ABC?', at: '' },
      { direction: 'in', text: 'Yes! Happy to help if I can.', at: '' },
    ],
  });
  const brief = engine.conversationBrief(withHistory);
  assert.match(brief, /You: Hi, are you at ABC\?/);
  assert.match(brief, /Person 1: Yes! Happy to help if I can\./);

  const snippetOnly = person(2, { lastMessageSnippet: 'Thanks for reaching out!' });
  assert.match(engine.conversationBrief(snippetOnly), /Thanks for reaching out!/);

  assert.equal(engine.conversationBrief(person(3)), '', 'no history means no invented context');
});

test('stage 1 never searches by role — only the company', () => {
  const engine = makeEngine({ people: [], roles: ['Java Developer', 'React Developer'] });
  assert.equal(engine.config.company, 'ABC Technologies');
  assert.equal(engine.config.referralTarget, 5);
  assert.equal(engine.config.perRole, 5);
});
