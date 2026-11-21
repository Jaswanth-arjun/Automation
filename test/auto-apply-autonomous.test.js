import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import {
  saveAnswer, listAnswers, lookupAnswer, updateAnswer, deleteAnswer, answerCompatibility,
} from '../lib/answer-memory.js';
import {
  createTask, getTask, getTaskView, recordCheckpoint, recordReview, approveTask,
  completeTask, pauseTask, resumeTask, cancelTask, reportTaskQuestion, answerTaskQuestion,
  recordSubmissionAttempt, isNoiseQuestion, sanitizeQuestionLabel,
  lookupTaskAnswer, decideNextAction, parseAgentAction, compactSnapshot,
  isTaskStale, abandonTask,
} from '../lib/application-tasks.js';
import { modelConfig, roleForSituation, parseModelJson, priceForModel, modelRoutes, routeCooldownSnapshot, providerKeys } from '../lib/model-router.js';

const RUN = Date.now().toString(36);
const USER_A = `test-user-a-${RUN}`;
const USER_B = `test-user-b-${RUN}`;
const TASKS_FILE = path.join(process.cwd(), 'data', 'application_tasks.json');

const profile = {
  fullName: 'Test Candidate',
  email: `candidate-${RUN}@example.com`,
  phone: '+1 555 0100',
  location: 'Bengaluru, India',
  education: [{ school: 'Test Institute', degree: 'B.Tech Computer Science', graduationYear: '2026' }],
  skills: ['JavaScript', 'React', 'Node.js'],
  projects: [{ name: 'Test project', link: 'https://github.com/example/project' }],
};

function job(overrides = {}) {
  return {
    title: 'Frontend Engineering Intern',
    company: 'Example Corp',
    description: 'React JavaScript Node.js frontend internship for 2026 graduates.',
    ...overrides,
  };
}

async function newTask(userId = USER_A, overrides = {}) {
  return createTask({
    userId,
    userEmail: `${userId}@example.com`,
    payload: {
      url: 'https://jobs.example.com/apply/123',
      job: job(overrides.job),
      profile,
      resumes: [{ name: 'candidate-frontend.pdf', text: 'React JavaScript Node.js frontend projects', size: '1 page' }],
      resumeName: 'candidate-frontend.pdf',
      resumeBase64: 'x'.repeat(200),
      ...overrides.payload,
    },
  });
}

test.after(() => {
  try {
    const rows = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    const kept = rows.filter((row) => ![USER_A, USER_B].includes(row.userId));
    fs.writeFileSync(TASKS_FILE, JSON.stringify(kept, null, 2));
  } catch { /* nothing to clean */ }
});

test('answer memory: saves, lists and reuses an equivalent degree question', async () => {
  const saved = await saveAnswer(USER_A, {
    question: 'What degree are you pursuing?',
    answer: 'B.Tech in Computer Science',
    source: 'user',
  });
  assert.equal(saved.category, 'education_degree');
  assert.equal(saved.confirmed, true);

  const listed = await listAnswers(USER_A);
  assert.ok(listed.some((entry) => entry.id === saved.id));

  const equivalent = await lookupAnswer(USER_A, 'Which undergraduate program are you enrolled in?');
  assert.equal(equivalent.answer, 'B.Tech in Computer Science');

  const different = await lookupAnswer(USER_A, 'Which university do you attend?');
  assert.equal(different.answer, null);
});

test('answer memory: work authorization is never confused with visa sponsorship', async () => {
  await saveAnswer(USER_A, {
    question: 'Are you legally authorized to work in the United States?',
    answer: 'Yes',
    consent: true,
  });

  const auth = await lookupAnswer(USER_A, 'Are you authorized to work in the US?');
  assert.equal(auth.answer, 'Yes');

  const sponsorship = await lookupAnswer(USER_A, 'Will you require visa sponsorship?');
  assert.equal(sponsorship.answer, null);
});

test('answer memory: sensitive answers require explicit consent', async () => {
  await assert.rejects(
    () => saveAnswer(USER_A, { question: 'What is your expected salary?', answer: '100000' }),
    /consent/i,
  );
  const saved = await saveAnswer(USER_A, {
    question: 'What is your expected salary?',
    answer: '100000',
    consent: true,
  });
  assert.equal(saved.sensitive, true);
});

test('answer memory: edits update future lookups and deletes stop reuse', async () => {
  const saved = await saveAnswer(USER_A, {
    question: 'What is your notice period?',
    answer: '30 days',
  });
  await updateAnswer(USER_A, saved.id, { answer: '15 days' });
  const updated = await lookupAnswer(USER_A, 'What is your notice period?');
  assert.equal(updated.answer, '15 days');
  assert.equal(await deleteAnswer(USER_A, saved.id), true);
  const deleted = await lookupAnswer(USER_A, 'What is your notice period?');
  assert.equal(deleted.answer, null);
});

test('answer memory: users cannot read each other\'s answers', async () => {
  await saveAnswer(USER_A, {
    question: 'What are your strongest programming languages?',
    answer: 'JavaScript and Python',
  });
  const other = await listAnswers(USER_B);
  assert.equal(other.length, 0);
  const lookup = await lookupAnswer(USER_B, 'What are your strongest programming languages?');
  assert.equal(lookup.answer, null);
});

test('answer compatibility rejects a saved answer that is not one of the options', () => {
  const compatibility = answerCompatibility(
    { question: 'What degree are you pursuing?', normalizedQuestion: 'degree pursuing', category: 'education_degree', answer: 'B.Tech' },
    'Which undergraduate program are you enrolled in?',
    ['High school', 'B.Tech', 'M.Tech'],
  );
  assert.equal(compatibility.ok, true);
  const mismatch = answerCompatibility(
    { question: 'What degree are you pursuing?', normalizedQuestion: 'degree pursuing', category: 'education_degree', answer: 'B.Tech' },
    'Which undergraduate program are you enrolled in?',
    ['High school', 'M.Tech'],
  );
  assert.equal(mismatch.ok, false);
});

test('task creation validates profile and resume before starting', async () => {
  await assert.rejects(
    () => createTask({ userId: USER_A, payload: { url: 'https://jobs.example.com/apply/1', profile: {}, resumes: [] } }),
    (err) => err.code === 'PROFILE_INCOMPLETE' && err.missing.includes('resume'),
  );
});

test('task lifecycle: checkpoint, review, approval, verified submission', async () => {
  const { task, token } = await newTask();
  assert.ok(task.id.startsWith('app_'));
  assert.equal(task.selectedResume.name, 'candidate-frontend.pdf');
  assert.equal(token.length, 64);

  const checkpointed = await recordCheckpoint(task.id, token, {
    step: 'form_filled', message: 'Filled 8 fields', filledCount: 8, resumeAttached: true,
  });
  assert.equal(checkpointed.checkpoint.filledCount, 8);

  const review = await recordReview(task.id, token, {
    company: 'Example Corp', title: 'Frontend Engineering Intern',
    resumeName: 'candidate-frontend.pdf', filledCount: 8, emptyCount: 0,
    missing: [], warnings: [],
  });
  assert.equal(review.ok, true);
  const waiting = await getTask(task.id, USER_A);
  assert.equal(waiting.status, 'waiting_for_approval');

  // A submitted report before approval is downgraded, never trusted.
  const blocked = await completeTask(task.id, token, {
    status: 'submitted', verified: true, message: 'clicked submit', filledCount: 8,
  });
  assert.notEqual(blocked.status, 'submitted');
  assert.equal(blocked.result.reasonCode, 'APPROVAL_REQUIRED');

  const approved = await approveTask(task.id, USER_A);
  assert.equal(approved.status, 'waiting_for_approval');
  assert.equal(approved.approval.status, 'approved');

  const submitted = await completeTask(task.id, token, {
    status: 'submitted', verified: true, confirmation: 'Application received', filledCount: 8,
  });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.result.verified, true);
});

test('submission click is refused before approval and while paused', async () => {
  const { task, token } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/guarded' } });
  await recordReview(task.id, token, { filledCount: 4, missing: [] });
  await assert.rejects(
    () => recordSubmissionAttempt(task.id, token, { url: 'https://jobs.example.com/apply/guarded' }),
    /approval/i,
  );
  await approveTask(task.id, USER_A);
  await pauseTask(task.id, USER_A);
  await assert.rejects(
    () => recordSubmissionAttempt(task.id, token, { url: 'https://jobs.example.com/apply/guarded' }),
    /paused/i,
  );
});

test('task lifecycle: approved submit must still be verified by the site', async () => {
  const { task, token } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/456' } });
  await recordReview(task.id, token, { filledCount: 3, missing: [] });
  await approveTask(task.id, USER_A);
  const result = await completeTask(task.id, token, {
    status: 'submitted', verified: false, message: 'no confirmation appeared',
  });
  assert.notEqual(result.status, 'submitted');
  assert.equal(result.result.reasonCode, 'SUBMISSION_UNVERIFIED');
  assert.equal(result.approval.status, 'pending', 'unverified click must require a fresh approval');
});

test('a manual submit in the job tab is recorded as a verified submission', async () => {
  const { task, token } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/manual' } });
  await recordReview(task.id, token, { filledCount: 6, missing: [] });
  // No approval: the automation itself never clicked submit. The candidate did.
  const result = await completeTask(task.id, token, {
    status: 'submitted', verified: true, manual: true,
    confirmation: 'confirmation message shown in the job tab',
  });
  assert.equal(result.status, 'submitted');
  assert.equal(result.result.reasonCode, 'MANUAL_SUBMISSION');
  assert.equal(result.approval.status, 'approved');
  assert.equal(result.approval.via, 'candidate');
});

test('widget chrome is never a candidate question and cleaned answers are reused', async () => {
  const raw = 'Data Analysis, press delete to clear value. Data Analysis, press delete to clear value. pill-REMOTE_SKILL-1-31310';
  assert.equal(isNoiseQuestion(raw), true);
  assert.equal(sanitizeQuestionLabel(raw), 'Data Analysis');

  const { task, token } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/noise' } });
  const unreadable = await reportTaskQuestion(task.id, token, { question: raw, options: ['Data Analysis'] });
  assert.equal(unreadable.question, null, 'scraped widget text must never become a dashboard question');

  const asked = await reportTaskQuestion(task.id, token, {
    question: 'Which skills should be listed on this application?',
    options: ['Data Analysis', 'Python (Programming Language)'],
  });
  assert.equal(asked.question.question, 'Which skills should be listed on this application?');
  await answerTaskQuestion(task.id, USER_A, asked.question.id, { answer: 'Data Analysis' });

  // A later ATS labels the same field "Skills"; the saved answer is reused.
  const { task: later, token: laterToken } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/skills' } });
  const reused = await reportTaskQuestion(later.id, laterToken, {
    question: 'Skills', options: ['Data Analysis', 'Linux'],
  });
  assert.equal(reused.answer, 'Data Analysis');
});

test('task questions are saved to memory and reused by a later task', async () => {
  const { task, token } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/789' } });
  const reported = await reportTaskQuestion(task.id, token, {
    question: 'How many years of experience do you have?',
    options: ['0', '1', '2', '3+'],
  });
  assert.equal(reported.answer, null);
  assert.ok(reported.question.id);

  const answered = await answerTaskQuestion(task.id, USER_A, reported.question.id, {
    answer: '2', remember: true,
  });
  assert.equal(answered.status, 'filling_application');

  const { task: second, token: secondToken } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/790' } });
  const reused = await lookupTaskAnswer(second.id, secondToken, 'How many years of experience do you have?', ['0', '1', '2', '3+']);
  assert.equal(reused.answer, '2');
});

test('task lifecycle: pause, resume and cancel are user scoped', async () => {
  const { task, token } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/999' } });
  await recordCheckpoint(task.id, token, { step: 'filling', message: 'Filling fields', status: 'filling_application' });
  const paused = await pauseTask(task.id, USER_A);
  assert.equal(paused.status, 'paused');
  const resumed = await resumeTask(task.id, USER_A);
  assert.equal(resumed.status, 'filling_application');
  const cancelled = await cancelTask(task.id, { userId: USER_A, reason: 'Changed my mind' });
  assert.equal(cancelled.status, 'cancelled');

  assert.equal(await getTaskView(task.id, USER_B), null);
  await assert.rejects(() => approveTask(task.id, USER_B), /not found/i);
  await assert.rejects(
    () => recordCheckpoint(task.id, 'not-the-task-token', { step: 'x' }),
    /not authorized/i,
  );
});

test('model router exposes configurable models and escalation roles', () => {
  const keys = ['AI_MODEL_FAST', 'AI_MODEL_PRIMARY', 'AI_MODEL_VISION', 'AI_MODEL_REASONING'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.AI_MODEL_FAST = 'test-luna';
    process.env.AI_MODEL_PRIMARY = 'test-sol';
    process.env.AI_MODEL_VISION = 'test-terra';
    process.env.AI_MODEL_REASONING = 'test-astra';
    const cfg = modelConfig();
    assert.deepEqual(cfg.models, {
      fast: 'test-luna', primary: 'test-sol', vision: 'test-terra', reasoning: 'test-astra',
    });
    assert.equal(roleForSituation({ failures: 0 }), 'primary');
    assert.equal(roleForSituation({ visual: true }), 'vision');
    assert.equal(roleForSituation({ failures: 3 }), 'reasoning');
    assert.deepEqual(parseModelJson('```json\n{"action":"click","id":2}\n```'), { action: 'click', id: 2 });
    const price = priceForModel('gpt-6-luna');
    assert.ok(price.inputPerMillion >= 0);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test('router keeps Auto Apply on the paid OpenAI lane and everything else on the gateway lane', () => {
  const original = {
    key: process.env.OPENAI_API_KEY,
    naraKey: process.env.BYNARA_API_KEY,
    primaryOpenai: process.env.AI_MODEL_PRIMARY_OPENAI,
    order: process.env.AI_PROVIDER_ORDER,
    strict: process.env.AI_STRICT_LANES,
    freeProvider: process.env.AI_FREE_PROVIDER,
    freeModel: process.env.AI_FREE_MODEL,
  };
  try {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.BYNARA_API_KEY = 'test-nara-key';
    process.env.AI_PROVIDER_ORDER = 'nara,radox,openai';
    process.env.AI_MODEL_PRIMARY_OPENAI = 'gpt-6.2-sol';
    process.env.AI_STRICT_LANES = 'true';
    process.env.AI_FREE_PROVIDER = 'nara';
    process.env.AI_FREE_MODEL = 'gpt-6-luna';

    // Auto Apply opts into the paid account explicitly: OpenAI only, no mixing.
    const paid = modelRoutes('primary', { paid: true });
    assert.equal(paid.length, 1, 'the paid lane is a single route');
    assert.equal(paid[0].provider, 'openai');
    assert.equal(paid[0].model, 'gpt-6.2-sol');

    // Every other feature stays on the gateway with gpt-6-luna only.
    const free = modelRoutes('primary');
    assert.equal(free.length, 1, 'the free lane is a single route');
    assert.equal(free[0].provider, 'nara');
    assert.equal(free[0].model, 'gpt-6-luna');
    assert.ok(!free.some((route) => route.provider === 'openai'));
    // Routine work uses the same cheap gateway model.
    assert.equal(modelRoutes('fast')[0].provider, 'nara');
    assert.equal(modelRoutes('fast')[0].model, 'gpt-6-luna');
    assert.deepEqual(routeCooldownSnapshot(), []);
  } finally {
    for (const [key, value] of Object.entries({
      OPENAI_API_KEY: original.key,
      BYNARA_API_KEY: original.naraKey,
      AI_MODEL_PRIMARY_OPENAI: original.primaryOpenai,
      AI_PROVIDER_ORDER: original.order,
      AI_STRICT_LANES: original.strict,
      AI_FREE_PROVIDER: original.freeProvider,
      AI_FREE_MODEL: original.freeModel,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('agent may open an Apply form but never click a submit control on a filled page', () => {
  const posting = {
    elements: [
      { id: 1, tag: 'BUTTON', type: 'button', text: 'Apply for this job', inForm: false },
      { id: 2, tag: 'INPUT', type: 'text', text: '', inForm: false },
    ],
  };
  const nav = parseAgentAction(JSON.stringify({ action: 'click', id: 1 }), posting);
  assert.equal(nav.action, 'click');

  const form = {
    elements: [
      { id: 1, tag: 'BUTTON', type: 'submit', text: 'Apply', inForm: true },
      { id: 2, tag: 'INPUT', type: 'text', text: '', inForm: true },
    ],
  };
  const blocked = parseAgentAction(JSON.stringify({ action: 'click', id: 1 }), form);
  assert.equal(blocked.action, 'done');
  assert.equal(blocked.status, 'ready');

  const submit = {
    elements: [{ id: 1, tag: 'BUTTON', type: 'button', text: 'Submit application', inForm: true }],
  };
  assert.equal(parseAgentAction(JSON.stringify({ action: 'click', id: 1 }), submit).action, 'done');
});

test('snapshot keeps actionable form controls ahead of navigation noise', () => {
  const elements = [];
  for (let i = 1; i <= 120; i += 1) {
    elements.push({ id: i, tag: 'LI', type: 'li', text: `Menu ${i}`, inForm: false });
  }
  elements.push({ id: 200, tag: 'INPUT', type: 'text', text: '', inForm: true });
  elements.push({ id: 201, tag: 'BUTTON', type: 'button', text: 'Next', inForm: true });
  const compact = compactSnapshot({ url: 'https://jobs.example.com', elements });
  assert.equal(compact.elements.length, 60);
  assert.equal(compact.elements[0].id, 200);
  assert.equal(compact.elements[1].id, 201);
});

test('EEO and internal field labels never become candidate questions', async () => {
  const { task, token } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/eeo-1' } });
  const review = await recordReview(task.id, token, {
    filledCount: 10,
    missing: [
      'Male Position_Specific_Questions_75375',
      'Native American or Alaska Native Position_Specific_Questions',
      'Are you authorized to work in the United States?',
    ],
  });
  assert.equal(review.ok, true);
  const stored = await getTask(task.id, USER_A);
  const labels = (stored.questions || []).map((question) => question.question);
  assert.ok(!labels.some((label) => /Position_Specific_Questions/i.test(label)), 'internal field id must be filtered');
  assert.ok(labels.some((label) => /authorized to work/i.test(label)), 'real personal question is kept');
});

test('stale/orphaned tasks are detected and can be abandoned', async () => {
  assert.equal(isTaskStale({ id: 'never-seen-task', status: 'filling_application', updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() }), true);
  const { task } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/stale-1' } });
  assert.equal(isTaskStale(task), false, 'a freshly queued task is not stale yet');
  const abandoned = await abandonTask(task.id, USER_A, 'Superseded in test');
  assert.equal(abandoned.status, 'failed');
  assert.equal(abandoned.result.reasonCode, 'SUPERSEDED');
});

test('application answers bank records a usable answer type', async () => {
  const yesno = await saveAnswer(USER_A, { question: 'Will you require sponsorship?', answer: 'No', options: ['Yes', 'No'], consent: true });
  assert.equal(yesno.answerType, 'yesno');
  const number = await saveAnswer(USER_A, { question: 'What is your expected salary?', answer: '600000', consent: true });
  assert.equal(number.answerType, 'number');
  const select = await saveAnswer(USER_A, { question: 'Which degree do you hold?', answer: "Bachelor's", options: ["Bachelor's", "Master's"] });
  assert.equal(select.answerType, 'select');
  const url = await saveAnswer(USER_A, { question: 'LinkedIn profile URL', answer: 'https://linkedin.com/in/x' });
  assert.equal(url.answerType, 'url');
  const listed = await listAnswers(USER_A);
  assert.ok(listed.some((entry) => entry.id === yesno.id && entry.answerType === 'yesno' && entry.options.includes('Yes')));
});

test('multiple API keys per provider are collected for round-robin', () => {
  const original = { a: process.env.BYNARA_API_KEY_2, b: process.env.BYNARA_API_KEY_3, c: process.env.NARA_API_KEY_2 };
  try {
    process.env.BYNARA_API_KEY_2 = 'nara-two';
    process.env.BYNARA_API_KEY_3 = 'nara-three';
    process.env.NARA_API_KEY_2 = 'nara-two-alt';
    const keys = providerKeys('nara');
    assert.ok(keys.includes('nara-two'), 'numbered key is collected');
    assert.ok(keys.includes('nara-three'), 'third key is collected');
    assert.ok(keys.includes('nara-two-alt'), 'alternate env name is collected');
    // Duplicate keys are collapsed so one account never wastes two slots.
    process.env.BYNARA_API_KEY_3 = 'nara-two';
    const dedup = providerKeys('nara');
    assert.equal(dedup.filter((key) => key === 'nara-two').length, 1);
    // Radox was removed and must never be a route again.
    assert.deepEqual(providerKeys('radox'), []);
    assert.ok(!modelRoutes('primary').some((route) => route.provider === 'radox'));
  } finally {
    for (const [key, value] of Object.entries({ BYNARA_API_KEY_2: original.a, BYNARA_API_KEY_3: original.b, NARA_API_KEY_2: original.c })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('decideNextAction rejects a browser token for the wrong task', async () => {
  const { task } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/1000' } });
  await assert.rejects(
    () => decideNextAction({ taskId: task.id, token: 'wrong-token', snapshot: { url: 'https://jobs.example.com' } }),
    /not authorized/i,
  );
});

test('missing required fields become answerable questions and never store sensitive answers in plaintext', async () => {
  const { task, token } = await newTask(USER_A, { payload: { url: 'https://jobs.example.com/apply/missing-1' } });
  const review = await recordReview(task.id, token, {
    filledCount: 4,
    missing: ['Are you legally authorized to work in the United States?'],
  });
  assert.equal(review.ok, true);
  const waiting = await getTask(task.id, USER_A);
  assert.equal(waiting.status, 'waiting_for_user_input');
  const question = waiting.questions.find((item) => item.status === 'pending');
  assert.ok(question, 'missing field should create a pending question');
  assert.equal(question.sensitive, true);

  const secret = `Yes, authorized per test ${RUN}`;
  await answerTaskQuestion(task.id, USER_A, question.id, {
    answer: secret, remember: true, consent: true,
  });
  const stored = await getTask(task.id, USER_A);
  assert.equal(stored.questions.find((item) => item.id === question.id).answer, '');
  assert.ok(stored.secureAnswers[question.question], 'sensitive answer must be encrypted');
  assert.ok(!JSON.stringify(stored).includes(secret), 'plaintext must not be returned');
  const raw = fs.readFileSync(TASKS_FILE, 'utf8');
  assert.ok(!raw.includes(secret), 'plaintext must not be written to disk');

  const second = await recordReview(task.id, token, { filledCount: 5, missing: [] });
  assert.equal(second.ok, true);
  const ready = await getTask(task.id, USER_A);
  assert.equal(ready.status, 'waiting_for_approval');
  await approveTask(task.id, USER_A);
  const done = await completeTask(task.id, token, { status: 'submitted', verified: true, filledCount: 5 });
  assert.equal(done.status, 'submitted');
});

test('paid OpenAI is opt-in and reserved for Auto Apply only', () => {
  const saved = {
    openai: process.env.OPENAI_API_KEY,
    nara: process.env.BYNARA_API_KEY,
    prefer: process.env.AI_PREFER_OPENAI,
    paidEnabled: process.env.AI_PAID_ENABLED,
    order: process.env.AI_PROVIDER_ORDER,
    primaryOpenai: process.env.AI_MODEL_PRIMARY_OPENAI,
  };
  try {
    process.env.AI_PROVIDER_ORDER = 'nara,openai';
    process.env.OPENAI_API_KEY = 'sk-test-paid';
    process.env.BYNARA_API_KEY = 'coa-test-free';
    process.env.AI_PREFER_OPENAI = 'true';
    process.env.AI_PAID_ENABLED = 'true';
    process.env.AI_MODEL_PRIMARY_OPENAI = 'gpt-6.2-sol';

    // Default (no paid flag): OpenAI must never appear, so credits stay untouched
    // by resume tailoring, question inference or any other feature.
    for (const role of ['fast', 'primary', 'vision', 'reasoning']) {
      const routes = modelRoutes(role);
      assert.ok(
        !routes.some((route) => route.provider === 'openai'),
        `${role} must not use paid OpenAI without an explicit opt-in`,
      );
    }

    // Auto Apply opts in explicitly and gets OpenAI first.
    const primary = modelRoutes('primary', { paid: true });
    assert.equal(primary[0]?.provider, 'openai');
    assert.equal(primary[0]?.model, 'gpt-6.2-sol');

    // A global kill switch wins even when a caller asks for paid.
    process.env.AI_PAID_ENABLED = 'false';
    assert.ok(
      !modelRoutes('primary', { paid: true }).some((route) => route.provider === 'openai'),
      'AI_PAID_ENABLED=false must disable paid OpenAI everywhere',
    );
  } finally {
    for (const [name, value] of Object.entries({
      OPENAI_API_KEY: saved.openai,
      BYNARA_API_KEY: saved.nara,
      AI_PREFER_OPENAI: saved.prefer,
      AI_PAID_ENABLED: saved.paidEnabled,
      AI_PROVIDER_ORDER: saved.order,
      AI_MODEL_PRIMARY_OPENAI: saved.primaryOpenai,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
