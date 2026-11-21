import test from 'node:test';
import assert from 'node:assert/strict';
import { ragEngine, normCompany, parseResumeFilename } from '../lib/rag-assistant-engine.js';

test('company query never borrows people from other companies', () => {
  // Savio Coelho works at Twilio and only holds a Google certification, so a
  // "Google employees" question must not return him.
  const result = ragEngine.retrieve('na linkdin network lo google lo work chesey employees ivvu');
  assert.equal(result.summary.intent, 'linkedin');
  assert.equal(result.summary.company, 'Google');
  assert.equal(result.summary.total, 0);
  assert.equal(result.facts.people, undefined);
  assert.match(result.answer, /do not have any connections working at \*\*Google\*\*/i);
});

test('company query returns exactly that company\'s connections', () => {
  const result = ragEngine.retrieve('na linkdin network lo twilio lo work chesey vallu evaru?');
  assert.match(String(result.summary.company), /twilio/i);
  assert.ok(result.facts.people.length > 0, 'expected Twilio connections');
  for (const person of result.facts.people) {
    assert.match(String(person.company), /twilio/i, `unexpected company: ${person.company}`);
  }
});

test('company with no connections is reported honestly', () => {
  const result = ragEngine.retrieve('who works at Netflix in my network?');
  assert.equal(result.summary.total, 0);
  assert.match(result.answer, /do not have any connections working at \*\*Netflix\*\*/i);
  assert.equal(result.facts.people, undefined);
});

test('LinkedIn reply filters split replied vs awaiting', () => {
  const replied = ragEngine.retrieve('who replied to me on LinkedIn?');
  assert.ok(replied.facts.people.length > 0);
  assert.ok(replied.facts.people.every((person) => person.status === 'replied' || person.replyText));

  const awaiting = ragEngine.retrieve("Who didn't reply on LinkedIn?");
  assert.ok(awaiting.facts.people.length > 0);
  assert.ok(awaiting.facts.people.every((person) => person.status !== 'replied' && !person.replyText));
});

test('email questions group outreach by company and never invent replies', () => {
  const result = ragEngine.retrieve('mail lo ewarewaru reply icharu for which company?');
  assert.equal(result.summary.intent, 'email');
  assert.ok(result.summary.total > 0);
  assert.ok(Array.isArray(result.facts.groups) && result.facts.groups.length > 0);
  if (result.summary.replies === 0) {
    assert.match(result.answer, /No email replies are recorded/i);
  }
});

test('applications are listed from the browser store', () => {
  const applications = [
    { company: 'Twilio', title: 'Software Engineer Intern', status: 'Applied', appliedAt: '2026-11-01T10:00:00.000Z', matchScore: 84 },
    { company: 'Zetwerk', role: 'Android Engineer Intern', status: 'Interviewing', appliedAt: '2026-10-20T10:00:00.000Z' },
  ];
  const result = ragEngine.retrieve('nenu a a companies ki apply chesenu?', { applications });
  assert.equal(result.summary.intent, 'applications');
  assert.equal(result.summary.total, 2);
  assert.match(result.answer, /Twilio/);
  assert.match(result.answer, /Zetwerk/);
  assert.match(result.answer, /Interviewing/);
});

test('tailored resume lookup links the exact PDF', () => {
  const result = ragEngine.retrieve('Twilio ki apply chesina resume ivvu');
  assert.equal(result.summary.intent, 'resume');
  assert.ok(result.summary.total > 0);
  const download = result.actions.find((action) => action.type === 'download');
  assert.ok(download, 'expected a download action');
  assert.match(download.filename, /Twilio-tailored-resume\.pdf$/);
  assert.match(download.url, /^\/api\/resumes\/download\//);
});

test('company normalization and filename parsing', () => {
  assert.equal(normCompany('Twilio Inc'), 'twilio');
  assert.equal(normCompany('Honeywell Technologies'), 'honeywell');
  const parsed = parseResumeFilename('1795170982735_NELLURU-Twilio-tailored-resume.pdf');
  assert.equal(parsed.owner, 'NELLURU');
  assert.equal(parsed.company, 'Twilio');
});
