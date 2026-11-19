import test from 'node:test';
import assert from 'node:assert/strict';
import { extractResumeLocation, keywordAudit, matchJobFromTailored, scoreLabel, scoreValue } from './JobAnalyzerModal.helpers.js';

test('does not invent scores and labels equality unchanged', () => {
  assert.equal(scoreValue(undefined), null);
  assert.equal(scoreLabel(70, 70), 'Coverage unchanged');
  assert.equal(scoreLabel(70, 71), 'More keywords covered');
  assert.equal(scoreLabel(70, 69), 'Coverage dropped after tailoring');
});

test('the matched job keeps its description so the score uses the same requirements', () => {
  const description = 'Requirements\n- Strong Python and SQL\n- Build REST APIs';
  const job = matchJobFromTailored({
    title: 'Backend Engineer',
    company: 'Acme',
    description,
    keywords: ['Python', 'SQL'],
  });
  assert.equal(job.description, description);
  assert.deepEqual(job.requiredSkills, []);
  assert.equal(job.title, 'Backend Engineer');
});

test('keywords stand in as requirements only when no description came back', () => {
  const job = matchJobFromTailored({ title: 'Analyst', company: 'Acme', keywords: ['Excel', 'SQL'] });
  assert.deepEqual(job.requiredSkills, ['Excel', 'SQL']);
});

test('keyword audit preserves authoritative empty lists', () => {
  assert.deepEqual(keywordAudit({ matchedKeywordsBefore: [], missingKeywords: ['SQL'] })[0].values, []);
  assert.deepEqual(keywordAudit({ matchedKeywordsBefore: [], missingKeywords: ['SQL'] })[5].values, ['SQL']);
});

test('resume location comes from the header, not a long profile headline', () => {
  const text = `NELLURU JASWANTH\nNaidupeta, Tirupati District, Andhra Pradesh, India\n+91 9440552825 · person@example.com · LinkedIn\nPROFESSIONAL SUMMARY\nSoftware Engineer Intern with experience building REST APIs.`;
  assert.equal(extractResumeLocation(text, 'Software Engineer Intern with experience'), 'Naidupeta, Tirupati District, Andhra Pradesh, India');
});
