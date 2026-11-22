import test from 'node:test';
import assert from 'node:assert/strict';
import {
  friendlyStep,
  buildActivityFeed,
  automationPhases,
  automationNow,
} from '../landing-page/src/lib/autoApplyNarrative.js';

test('internal agent steps never surface as terminal-style lines', () => {
  assert.equal(friendlyStep({ step: 'agent_action', message: 'gpt-x chose fill on element 12.' }), null);
  assert.equal(friendlyStep({ step: 'heartbeat', message: 'ping' }), null);
});

test('meaningful steps are rewritten in plain English', () => {
  const observed = friendlyStep({ step: 'agent_observe', message: 'Agent observed 24 element(s) on Siemens application.' });
  assert.equal(observed.title, 'Read the application form');
  assert.match(observed.detail, /24 fields/);

  const resume = friendlyStep({ step: 'resume_selected', message: 'Selected NELLURI-Siemens.pdf. Highest keyword coverage for this job (88%).' });
  assert.equal(resume.title, 'Using NELLURI-Siemens.pdf');
  assert.match(resume.detail, /Highest keyword coverage/);

  const warn = friendlyStep({ step: 'checkpoint', level: 'warn', message: 'Agent said done but 3 required field(s) are empty — continuing instead of approving.' });
  assert.equal(warn.tone, 'warn');
  assert.match(warn.detail, /3 required fields/);
});

test('the feed is newest first and collapses repeats', () => {
  const feed = buildActivityFeed([
    { step: 'created', message: 'Automation task created for Engineer at Acme.', at: '2026-01-01T10:00:00Z' },
    { step: 'created', message: 'Automation task created for Engineer at Acme.', at: '2026-01-01T10:00:05Z' },
    { step: 'resume_selected', message: 'Selected resume.pdf. Closest match.', at: '2026-01-01T10:00:09Z' },
  ]);
  assert.equal(feed.length, 2);
  assert.equal(feed[0].title, 'Using resume.pdf');
  assert.equal(feed[1].title, 'Started your application');
});

test('phase rail and status sentence follow the task status', () => {
  const filling = automationPhases('filling_application');
  assert.equal(filling[0].state, 'done');
  assert.equal(filling[1].state, 'active');
  assert.equal(filling[2].state, 'pending');

  const submitted = automationPhases('submitted');
  assert.ok(submitted.every((phase) => phase.state === 'done'));
  assert.equal(automationNow({ status: 'waiting_for_approval' }).title, 'Ready for your review');
  assert.equal(automationNow({ status: 'filling_application', checkpoint: { filledCount: 7 } }).detail, '7 fields filled.');
});
