import test from 'node:test';
import assert from 'node:assert/strict';
import { shortenJobTitle } from './jobTitle.js';

test('keeps a normal title unchanged', () => {
  assert.equal(shortenJobTitle('AI Engineer Intern'), 'AI Engineer Intern');
});

test('removes flattened metadata and description', () => {
  assert.equal(
    shortenJobTitle('AI Engineer Intern – Agentic AI & LLM Engineering Department: AI Engineering Location: Bengaluru Employment Type: Internship Role We are looking for builders'),
    'AI Engineer Intern – Agentic AI & LLM Engineering'
  );
});

test('bounds malformed long titles at a word boundary', () => {
  assert.equal(shortenJobTitle('one two three four five six seven eight nine ten eleven twelve thirteen'), 'one two three four five six seven eight nine ten eleven twelve…');
});

test('handles missing values without mutating the input', () => {
  const original = 'AI Engineer Department: AI';
  assert.equal(shortenJobTitle(), '');
  assert.equal(shortenJobTitle(original), 'AI Engineer');
  assert.equal(original, 'AI Engineer Department: AI');
});
