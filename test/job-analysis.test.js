import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJobPostingJsonLd, validateJobDescription, keywordsFromJob, calculateKeywordCoverage, validateTailoredResume } from '../lib/job-analysis.js';

test('JSON-LD @graph JobPosting is preferred and preserves real metadata', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Wrong"},{"@type":"JobPosting","title":"AI/C++ Engineer","hiringOrganization":{"name":"Acme"},"description":"Build production systems with AI, C++, and Go. ${'Requirements and responsibilities '.repeat(5)}"}]}</script>`;
  assert.deepEqual(extractJobPostingJsonLd(html), {
    title: 'AI/C++ Engineer', company: 'Acme',
    description: `Build production systems with AI, C++, and Go. ${'Requirements and responsibilities '.repeat(5)}`.replace(/\s+/g, ' ').trim()
  });
});

test('blocked and insufficient pages are rejected', () => {
  assert.throws(() => validateJobDescription({ title: 'Careers', description: 'Sign in to continue' }), /not a usable|too short/);
  assert.throws(() => validateJobDescription({ title: 'Untitled', description: 'A complete-looking page that is actually a JavaScript shell. '.repeat(3) }), /not a usable/);
  assert.throws(() => validateJobDescription({ title: 'Engineer', description: 'Short' }), /too short/);
});

test('keyword matching uses boundaries and aliases for short technical names', () => {
  const keys = keywordsFromJob('Need AI, C, C#, C++, R, Go, .NET, JS and Python.');
  assert.deepEqual(new Set(keys.filter((key) => ['AI', 'C', 'C#', 'C++', 'R', 'Go', '.NET', 'JavaScript', 'Python'].includes(key))), new Set(['AI', 'C', 'C#', 'C++', 'R', 'Go', '.NET', 'JavaScript', 'Python']));
  const score = calculateKeywordCoverage(['AI', 'C#', 'C++'], 'AI and C#', 'AI, C#, C++');
  assert.deepEqual(score.matchedKeywordsBefore, ['AI', 'C#']);
  assert.deepEqual(score.matchedKeywordsAfter, ['AI', 'C#', 'C++']);
  assert.deepEqual(score.addedKeywords, ['C++']);
  assert.equal(calculateKeywordCoverage([], '', '').afterScore, 0);
  assert.equal(calculateKeywordCoverage([], '', '').hasRequirements, false);
});

test('invalid model output is rejected instead of fabricated', () => {
  assert.throws(() => validateTailoredResume({ skills: [] }), /invalid resume/);
  assert.throws(() => validateTailoredResume({ summary: 'ok', skills: [], projects: 'fake' }), /invalid projects/);
});
