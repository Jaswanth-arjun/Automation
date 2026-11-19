import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { inferFromProfile, profileValueForHint, isAdvanceButtonText, isSubmitButtonText } from '../lib/apply-intelligence.js';

const profile = {
  fullName: 'Nelluru Jaswanth',
  email: 'jaswanth@example.com',
  phone: '9440552825',
  location: 'Bengaluru, India',
  skills: ['Python', 'React'],
  education: [{ school: 'NIT Trichy', degree: 'B.Tech' }],
  experience: [{ company: 'Acme', title: 'Intern' }],
  links: { linkedin: 'https://linkedin.com/in/jaswanth', github: 'https://github.com/jaswanth' },
};

test('filler source routes vault/AI through the background proxy and advances pages', () => {
  const filler = readFileSync(join('extension', 'filler.js'), 'utf8');
  assert.match(filler, /HAMZOOH_PROXY_FETCH/);
  assert.match(filler, /HAMZOOH_GET_RESUME/);
  assert.match(filler, /findAdvanceButton/);
  assert.match(filler, /showSubmitConfirmation/);
  assert.match(filler, /isSensitiveQuestion/);
  const background = readFileSync(join('extension', 'background.js'), 'utf8');
  assert.match(background, /HAMZOOH_BEGIN_FILL/);
  assert.match(filler, /__HAMZOOH_TEST_RUN__/);
  assert.match(background, /indexedDB/);
});

test('page 2 work-auth is not auto-answered without profile flags', () => {
  const hit = inferFromProfile({
    question: 'Are you legally authorized to work in the United States?',
    options: ['Yes', 'No'],
    profile,
  });
  assert.equal(hit.canInfer, false);
});

test('mock application HTML contains the fields Auto Apply must handle', () => {
  const html = readFileSync(join('public', 'mock-apply-form.html'), 'utf8');
  assert.match(html, /Full name/);
  assert.match(html, /type="file"/);
  assert.match(html, /Submit Application/);
  assert.match(html, /Continue/);
});

test('maps profile values onto mock field labels', () => {
  assert.equal(profileValueForHint(profile, 'fullName'), 'Nelluru Jaswanth');
  assert.equal(inferFromProfile({ question: 'How did you hear about us?', options: ['LinkedIn', 'Referral'], profile }).answer, 'LinkedIn');
  assert.equal(isAdvanceButtonText('Continue'), true);
  assert.equal(isSubmitButtonText('Submit Application'), true);
});
