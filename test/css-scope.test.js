import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A rule like `footer { position: absolute; left: 8vw }` applies to every
// <footer> in every component. That is exactly how the job page's match strip
// ended up floating over the description. Structural elements in the global
// stylesheet must always be scoped (e.g. `body > footer`, `.jm-foot`).
const CSS = fs.readFileSync(new URL('../landing-page/src/style.css', import.meta.url), 'utf8');
const STRUCTURAL = /^(?:nav|footer|header|aside|main|section|article)$/;

test('global stylesheet never targets bare page-structure elements', () => {
  const offenders = new Set();
  for (const rule of CSS.matchAll(/(?:^|\})\s*([^{}@/]+)\{/g)) {
    for (const selector of rule[1].split(',').map((part) => part.trim())) {
      if (STRUCTURAL.test(selector)) offenders.add(selector);
    }
  }
  assert.deepEqual(
    [...offenders],
    [],
    'scope these selectors (for example "body > footer" or a component class)',
  );
});
