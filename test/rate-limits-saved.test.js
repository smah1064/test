'use strict';

// Security review 28 Nov: the host stops the app after 5 quiet minutes and the per-visitor limits started again
// from zero. They are now kept in a file (hashed keys, no IP addresses) and read back when the app starts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PersistentRateLimiter } = require('../src/security');

test('per-visitor limits survive a restart; the file holds no addresses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-rl-'));
  const file = path.join(dir, '.rate-limits.json');
  const rules = [{ max: 3, ms: 3600e3 }];
  const a = new PersistentRateLimiter(file);
  for (let i = 0; i < 3; i++) assert.strictEqual(a.hit('coupon:203.0.113.9', rules), 0);
  assert.ok(a.hit('coupon:203.0.113.9', rules) > 0, 'over the limit');
  a.save();
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('203.0.113.9') && !text.includes('coupon'), 'hashed keys only');
  // "Restarted": a new limiter on the same file still counts the earlier tries.
  const b = new PersistentRateLimiter(file);
  assert.ok(b.hit('coupon:203.0.113.9', rules) > 0, 'still over the limit after a restart');
  assert.strictEqual(b.hit('coupon:198.51.100.7', rules), 0, 'another visitor is not');
  // Another copy's counts are merged, not overwritten.
  const c = new PersistentRateLimiter(file);
  c.hit('orders:192.0.2.1', rules);
  c.save();
  b.save();
  const d = new PersistentRateLimiter(file);
  assert.ok(d.check('orders:192.0.2.1', rules).list.length === 1);
  assert.ok(typeof d.check('coupon:203.0.113.9', rules) === 'number');
  // A broken file is ignored.
  fs.writeFileSync(file, '{not json');
  assert.strictEqual(new PersistentRateLimiter(file).hit('x:1', rules), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
