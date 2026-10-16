import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordAudit, scoreLabel, scoreValue } from './JobAnalyzerModal.helpers.js';

test('does not invent scores and labels equality unchanged', () => {
  assert.equal(scoreValue(undefined), null);
  assert.equal(scoreLabel(70, 70), 'Unchanged');
  assert.equal(scoreLabel(70, 71), 'Improved');
  assert.equal(scoreLabel(70, 69), 'Lower after tailoring');
});

test('keyword audit preserves authoritative empty lists', () => {
  assert.deepEqual(keywordAudit({ matchedKeywordsBefore: [], missingKeywords: ['SQL'] })[0].values, []);
  assert.deepEqual(keywordAudit({ matchedKeywordsBefore: [], missingKeywords: ['SQL'] })[4].values, ['SQL']);
});
