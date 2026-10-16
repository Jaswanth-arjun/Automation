import test from 'node:test';
import assert from 'node:assert/strict';
import { extractResumeLocation, keywordAudit, scoreLabel, scoreValue } from './JobAnalyzerModal.helpers.js';

test('does not invent scores and labels equality unchanged', () => {
  assert.equal(scoreValue(undefined), null);
  assert.equal(scoreLabel(70, 70), 'Unchanged');
  assert.equal(scoreLabel(70, 71), 'Improved');
  assert.equal(scoreLabel(70, 69), 'Lower after tailoring');
});

test('keyword audit preserves authoritative empty lists', () => {
  assert.deepEqual(keywordAudit({ matchedKeywordsBefore: [], missingKeywords: ['SQL'] })[0].values, []);
  assert.deepEqual(keywordAudit({ matchedKeywordsBefore: [], missingKeywords: ['SQL'] })[5].values, ['SQL']);
});

test('resume location comes from the header, not a long profile headline', () => {
  const text = `NELLURU JASWANTH\nNaidupeta, Tirupati District, Andhra Pradesh, India\n+91 9440552825 · person@example.com · LinkedIn\nPROFESSIONAL SUMMARY\nSoftware Engineer Intern with experience building REST APIs.`;
  assert.equal(extractResumeLocation(text, 'Software Engineer Intern with experience'), 'Naidupeta, Tirupati District, Andhra Pradesh, India');
});
