import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findBestAnswer,
  inferFromProfile,
  isSubmitButtonText,
  isAdvanceButtonText,
  profileValueForHint,
  applicationLogisticsAnswer,
  policyAnswer,
  resolveStartDate,
  isStartDateQuestion,
  startDateAnswer,
  salaryDigits,
  matchHint,
  parseLocationString,
  isConsentQuestion,
} from '../lib/apply-intelligence.js';
import { answerCompatibility, questionCategory } from '../lib/answer-memory.js';

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

test('application logistics questions are decided by the agent, not the user', () => {
  const linkedin = applicationLogisticsAnswer('How Did You Hear About Us?', { profile: { ...profile, jobSource: 'LinkedIn' } });
  assert.equal(linkedin.answer, 'Job Sites');
  const site = applicationLogisticsAnswer('Where did you find this job?', { profile: { ...profile, jobSource: 'Greenhouse' } });
  assert.equal(site.answer, 'Career Websites');
  const why = applicationLogisticsAnswer('Why do you want to work here?', { profile, company: 'Acme', jobTitle: 'Intern' });
  assert.match(why.answer, /Acme/);
  // Personal facts are still never decided by logistics rules.
  assert.equal(applicationLogisticsAnswer('Are you authorized to work in the US?', { profile }), null);
  assert.equal(applicationLogisticsAnswer('What is your notice period?', { profile }), null);
});

test('policy answers come only from configured values, never invented', () => {
  const policy = { salary: '600000', requireSponsorship: 'false', workAuthorized: 'true', noticePeriod: 'Immediately' };
  assert.equal(policyAnswer('What is your desired annual salary?', policy).answer, '600000');
  assert.equal(policyAnswer('Will you now or in the future require Company assistance to obtain authorization to work in the job location?', policy).answer, 'No');
  assert.equal(policyAnswer('Are you legally authorized to work in the United States?', policy).answer, 'Yes');
  assert.equal(policyAnswer('What is your notice period?', policy).answer, 'Immediately');
  // Nothing configured -> the question must still be asked.
  assert.equal(policyAnswer('What is your desired annual salary?', {}), null);
});

test('reuses the candidate\'s own sensitive answers without crossing intents', () => {
  const assistance = 'Will you now or in the future require Company assistance to obtain authorization to work in the job location?';
  assert.equal(questionCategory(assistance), 'visa_sponsorship');
  assert.equal(answerCompatibility({ question: 'Do you require visa sponsorship?', answer: 'Yes', category: 'visa_sponsorship' }, assistance).ok, true);
  assert.equal(answerCompatibility({ question: 'Expected salary', answer: '30000', category: 'salary' }, 'What is your desired annual salary?').ok, true);
  // Current pay is a different question from expected pay.
  assert.equal(answerCompatibility({ question: 'Expected salary', answer: '30000', category: 'salary' }, 'What is your current CTC?').ok, false);
  // A sponsorship answer never answers a work-authorization question.
  assert.equal(answerCompatibility({ question: 'Do you require visa sponsorship?', answer: 'Yes', category: 'visa_sponsorship' }, 'Are you legally authorized to work in India?').ok, false);
});

test('uses saved salary and sponsorship preferences when present', () => {
  const withPrefs = { ...profile, jobPreferences: { salaryMin: '30000', requireSponsorship: 'No' } };
  // The Job Profile range is monthly in INR, so the desired ANNUAL salary is
  // the monthly floor annualised — never the raw 30000 typed as annual pay.
  assert.equal(inferFromProfile({ question: 'What is your desired annual salary?', profile: withPrefs }).answer, '360000');
  assert.equal(salaryDigits('3LPA'), '300000');
  assert.equal(salaryDigits('₹3,00,000'), '300000');
  assert.equal(salaryDigits('30k'), '30000');
  assert.equal(inferFromProfile({
    question: 'What is your desired annual salary?',
    profile: { ...profile, expectedSalary: '300000' },
  }).answer, '300000');
  assert.equal(inferFromProfile({ question: 'What is your desired annual salary?', profile: { ...profile, expectedSalary: '3LPA' } }).answer, '300000');
  const visa = inferFromProfile({
    question: 'Will you now or in the future require Company assistance to obtain authorization to work in the job location?',
    options: ['Yes', 'No'],
    profile: withPrefs,
  });
  assert.equal(visa.answer, 'No');
});

test('start date is computed relative to today, never a stale fixed date', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  assert.equal(resolveStartDate('tomorrow', now), '11/22/2026');
  assert.equal(resolveStartDate('immediate', now), '11/21/2026');
  assert.equal(resolveStartDate('+7 days', now), '11/28/2026');
  assert.equal(resolveStartDate('2026-12-01', now), '12/01/2026');
  assert.equal(resolveStartDate('06/15/2026', now), '06/15/2026');
  assert.equal(resolveStartDate('', now), '');
  const policy = { startDate: 'tomorrow' };
  const answer = policyAnswer('What date are you available to start?', policy);
  assert.match(answer.answer, /^\d{2}\/\d{2}\/\d{4}$/);
});

test('availability questions are answered with the next date, not a relocation preference', () => {
  assert.equal(isStartDateQuestion('What date are you available to start?'), true);
  assert.equal(isStartDateQuestion('Earliest available joining date'), true);
  assert.equal(isStartDateQuestion('When can you join us?'), true);
  assert.equal(isStartDateQuestion('What is your notice period?'), false);
  assert.match(startDateAnswer({}), /^\d{2}\/\d{2}\/\d{4}$/);
  // A date field must never be answered as Yes/No from the "available" rule.
  const inferred = inferFromProfile({ question: 'What date are you available to start?', profile });
  assert.equal(inferred.canInfer, true);
  assert.match(String(inferred.answer), /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(inferred.reason, undefined);
  const logistics = applicationLogisticsAnswer('What date are you available to start?', { profile });
  assert.match(String(logistics.answer), /^\d{2}\/\d{2}\/\d{4}$/);
  // A configured offset is honoured instead of always defaulting to tomorrow.
  const later = inferFromProfile({ question: 'When can you start?', profile: { ...profile, availableStart: '+7 days' } });
  assert.match(String(later.answer), /^\d{2}\/\d{2}\/\d{4}$/);
});

test('phone device type and source questions are answered locally without asking', () => {
  const phone = applicationLogisticsAnswer('Phone Device Type*', { profile: {} });
  assert.equal(phone.answer, 'Mobile');
  assert.equal(phone.source, 'logistics-phone-type');

  const cases = [
    [{ jobSource: 'linkedin' }, 'Job Sites'],
    [{ jobSource: 'Employee Referral' }, 'Employee Referral'],
    [{ jobSource: 'company career site' }, 'Career Websites'],
    [{ jobSource: 'campus placement' }, 'Campus Campaign'],
    [{ jobSource: 'job alert' }, 'Job Alert'],
  ];
  for (const [profile, expected] of cases) {
    const res = applicationLogisticsAnswer('How Did You Hear About Us?', { profile });
    assert.equal(res.answer, expected, `source ${profile.jobSource} should map to ${expected}`);
  }
});

test('location parser and hints handle multi-part addresses and asterisked labels', () => {
  const p = {
    ...profile,
    location: 'Naidupeta, Tirupati District, Andhra Pradesh, India',
  };
  assert.equal(matchHint('City *')?.key, 'city');
  assert.equal(matchHint('State/Province *')?.key, 'state');
  assert.equal(matchHint('Country *')?.key, 'country');
  assert.equal(profileValueForHint(p, 'city'), 'Naidupeta');
  assert.equal(profileValueForHint(p, 'state'), 'Andhra Pradesh');
  assert.equal(profileValueForHint(p, 'country'), 'India');
});

test('handles Greenhouse / modern ATS custom dropdown choices correctly', () => {
  const p = {
    ...profile,
    location: 'Naidupeta, Tirupati District, Andhra Pradesh, India',
    willingToRelocate: true,
  };

  // 1. Country with code in options
  const countryRes = inferFromProfile({
    question: 'Country *',
    options: ['Afghanistan (+93)', 'India (+91)', 'United States (+1)'],
    profile: p,
  });
  assert.equal(countryRes.canInfer, true);
  assert.equal(countryRes.answer, 'India (+91)');

  // 2. Consent / SMS Text updates
  assert.equal(isConsentQuestion('Do you allow us to provide you TEXT/SMS updates of your interview process?*'), true);
  const smsRes = inferFromProfile({
    question: 'Do you allow us to provide you TEXT/SMS updates of your interview process?*',
    options: ['Yes', 'No'],
    profile: p,
  });
  assert.equal(smsRes.canInfer, true);
  assert.equal(smsRes.answer, 'Yes');

  // 3. Office attendance / based in Gurgaon office
  const officeRes = inferFromProfile({
    question: 'The internship is going to be based in the Agoda Gurgaon office. Are you willing to be based here and come to the office at least 2 days a week?*',
    options: ['Yes', 'No'],
    profile: p,
  });
  assert.equal(officeRes.canInfer, true);
  assert.equal(officeRes.answer, 'Yes');

  // 4. Relocation self-fund option
  const relocateRes = inferFromProfile({
    question: 'If you are not based in Gurgaon, are you willing to relocate yourself for this internship?*',
    options: [
      "I am based in Gurgaon and don't need relocation support",
      'I am willing to self-fund my relocation for this internship',
      'I am NOT willing to self-fund my relocation for this internship',
    ],
    profile: p,
  });
  assert.equal(relocateRes.canInfer, true);
  assert.equal(relocateRes.answer, 'I am willing to self-fund my relocation for this internship');

  // 5. Full-time internship 6 months
  const durationRes = inferFromProfile({
    question: 'Are you able to do a full-time internship for 6 months (24 weeks)?*',
    options: ['Yes', 'No'],
    profile: p,
  });
  assert.equal(durationRes.canInfer, true);
  assert.equal(durationRes.answer, 'Yes');

  // 6. NOC (No Objection Certificate)
  const nocRes = inferFromProfile({
    question: 'Are your university will be able to provide an "No Objection Certificate"*',
    options: ['Yes', 'No'],
    profile: p,
  });
  assert.equal(nocRes.canInfer, true);
  assert.equal(nocRes.answer, 'Yes');

  // 7. Engineering blog
  const blogRes = inferFromProfile({
    question: 'Have you read our Engineering blog? (https://medium.com/agoda-engineering)*',
    options: ['Yes', 'No'],
    profile: p,
  });
  assert.equal(blogRes.canInfer, true);
  assert.equal(blogRes.answer, 'Yes');

  // 8. Booking Holdings past employment (candidate never worked there)
  const workedRes = inferFromProfile({
    question: 'Are you presently employed by any company within the Booking Holdings group...*',
    options: ['Yes', 'No'],
    profile: p,
    company: 'Agoda',
  });
  assert.equal(workedRes.canInfer, true);
  assert.equal(workedRes.answer, 'No');

  // 9. Education end date month and year
  const endMonthRes = inferFromProfile({
    question: 'End date month*',
    options: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    profile: p,
  });
  assert.equal(endMonthRes.canInfer, true);
  assert.equal(endMonthRes.answer, '05');

  const endYearRes = inferFromProfile({
    question: 'End date year*',
    options: ['2024', '2025', '2026', '2027', '2028'],
    profile: {
      ...p,
      education: [{ degree: 'B.Tech', school: 'NBKR', graduationYear: '2027' }],
    },
  });
  assert.equal(endYearRes.canInfer, true);
  assert.equal(endYearRes.answer, '2027');
});
