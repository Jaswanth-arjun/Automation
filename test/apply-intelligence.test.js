import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findBestAnswer,
  inferFromProfile,
  isSubmitButtonText,
  isAdvanceButtonText,
  profileValueForHint,
} from '../lib/apply-intelligence.js';

const profile = {
  fullName: 'Nelluru Jaswanth',
  email: 'jaswanth@example.com',
  phone: '+919440552825',
  location: 'Bengaluru, India',
  skills: ['Python', 'React'],
  education: [{ school: 'NIT', degree: 'B.Tech CSE', dates: '2027' }],
  experience: [{ title: 'Intern', company: 'Acme', dates: '2025' }],
  links: { linkedin: 'https://linkedin.com/in/jaswanth', github: 'https://github.com/jaswanth' },
};

test('reuses semantically similar vault answers', () => {
  const answers = {
    'are you legally authorized to work in the united states': 'No',
  };
  const hit = findBestAnswer('Are you legally authorised to work in the United States?', answers);
  assert.equal(hit, 'No');
});

test('does not invent work authorization or sponsorship', () => {
  const auth = inferFromProfile({ question: 'Are you legally authorized to work in the United States?', profile });
  assert.equal(auth.canInfer, false);
  const visa = inferFromProfile({ question: 'Will you now or in the future require visa sponsorship?', profile });
  assert.equal(visa.canInfer, false);
});

test('uses explicit profile flags for sponsorship', () => {
  const hit = inferFromProfile({
    question: 'Do you require visa sponsorship?',
    options: ['Yes', 'No'],
    profile: { ...profile, requireSponsorship: true },
  });
  assert.equal(hit.canInfer, true);
  assert.equal(hit.answer, 'Yes');
});

test('fills identity fields from profile', () => {
  assert.equal(profileValueForHint(profile, 'email'), 'jaswanth@example.com');
  assert.equal(profileValueForHint(profile, 'phone'), '9440552825');
  assert.equal(profileValueForHint(profile, 'firstName'), 'Nelluru');
  const inferred = inferFromProfile({ question: 'Email address', profile });
  assert.equal(inferred.answer, 'jaswanth@example.com');
});

test('previously employed at this company uses experience, not a guess', () => {
  const no = inferFromProfile({ question: 'Have you previously been employed by Google?', profile, company: 'Google' });
  assert.equal(no.answer, 'No');
  const yes = inferFromProfile({ question: 'Have you previously been employed by Acme?', profile, company: 'Acme' });
  assert.equal(yes.answer, 'Yes');
});

test('EEO questions decline rather than invent demographics', () => {
  const hit = inferFromProfile({
    question: 'What is your gender?',
    options: ['Male', 'Female', 'Decline to self-identify'],
    profile,
  });
  assert.match(String(hit.answer), /Decline/i);
});

test('submit vs next button classification', () => {
  assert.equal(isSubmitButtonText('Submit Application'), true);
  assert.equal(isSubmitButtonText('Next'), false);
  assert.equal(isAdvanceButtonText('Save and Continue'), true);
  assert.equal(isAdvanceButtonText('Submit Application'), false);
});
