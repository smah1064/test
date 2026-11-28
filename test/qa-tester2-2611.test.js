'use strict';

// Tester 2 (9 pm Cairo, 26 Nov): ready designs that print a year say this year (2026), as the graduation ones were
// moved to this morning; a founding year ("EST. 2025") is the customer's own and stays.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('no ready design still prints last year (2025), apart from a founding year', () => {
  const dir = path.join(__dirname, '../src/library-packs');
  const found = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/T\('([^']*2025[^']*)'/g)) if (!/EST\. 2025/.test(m[1])) found.push(`${f}:${i + 1} ${m[1]}`);
    });
  }
  assert.deepStrictEqual(found, []);
});
