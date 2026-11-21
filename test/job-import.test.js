import test from 'node:test';
import assert from 'node:assert/strict';

import { structureJobDescription, buildJobDraft } from '../lib/job-import.js';

const ORACLE_PAGE = [
  'Job Description',
  'As an Intern here at Honeywell, you will gain hands-on experience and contribute to real projects.',
  '',
  'Responsibilities',
  'Support the team in daytoday activities and projects',
  'Assist with data analysis and reporting',
  'Conduct research and gather information for various projects',
  '',
  'Qualifications',
  "Pursuing a Bachelor's degree in a relevant field (e.g., Engineering, Business).",
  '',
  'About Us',
  'Honeywell Technologies is a global, pure-play automation company with a legacy of innovating.',
  '',
  'About',
  'Leadership',
  'Inclusion & Diversity',
  'Accelerator Operating System',
  'Industries',
  'Buildings',
  'Chemicals & Materials',
  'Data Centers',
  'Healthcare',
  'Heavy Industries',
  'Hospitality',
  'LNG',
  'Life Sciences',
  'Low Carbon Energy',
  'Manufacturing',
  'Oil & Gas',
  'Utilities',
  'Life at Honeywell',
  'Your Career Journey',
  'In the Community',
  'Integrity & Compliance',
  'Meet Our People',
  'News',
  'Insights Hub',
  'Privacy preferences',
  'Terms & Conditions',
  'Your Privacy Choices',
  'Manage Cookies',
  '',
  'Accept All',
  'Reject All',
  'Manage Preferences',
].join('\n');

test('job import drops footer navigation and consent banner', () => {
  const output = structureJobDescription(ORACLE_PAGE);

  for (const junk of ['Leadership', 'Inclusion & Diversity', 'Data Centers', 'Insights Hub', 'Manage Cookies', 'Accept All', 'Reject All', 'Manage Preferences']) {
    assert.ok(!output.includes(junk), `expected "${junk}" to be removed, got:\n${output}`);
  }
  assert.ok(!/^## About$/m.test(output), 'the empty "About" menu heading should be dropped');
  assert.ok(!output.includes('## Accept All'), 'a consent button must never become a section heading');
  assert.ok(output.includes('As an Intern here at Honeywell'), 'real job prose must survive');
  assert.ok(output.includes('## Qualifications'), 'real section headings must survive');
  assert.ok(output.includes("Pursuing a Bachelor's degree"), 'real qualification lines must survive');
});

test('job import keeps genuine short bullet lists', () => {
  const posting = [
    'Requirements',
    '• Python',
    '• SQL',
    '• Excel',
    '• Communication',
    '• Teamwork',
    '• Problem solving',
  ].join('\n');
  const output = structureJobDescription(posting);
  for (const skill of ['Python', 'SQL', 'Excel', 'Communication', 'Teamwork']) {
    assert.ok(output.includes(skill), `${skill} should remain in the posting`);
  }
});

test('buildJobDraft keeps a full title and the posting body', () => {
  const draft = buildJobDraft({
    posting: { title: "Intern (Bachelor's)", company: 'Honeywell Technologies', description: 'Responsibilities\nSupport the team in reporting.' },
    meta: { title: "Intern (Bachelor's)", company: 'Honeywell Technologies', location: 'Bengaluru, India' },
    openUrl: 'https://example.com/job/1',
  });
  assert.equal(draft.title, "Intern (Bachelor's)");
  assert.equal(draft.company, 'Honeywell Technologies');
  assert.equal(draft.location, 'Bengaluru, India');
  assert.equal(draft.type, 'Internship');
});
