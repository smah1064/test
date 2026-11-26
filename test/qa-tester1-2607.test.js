'use strict';

// Tester 1's run at 12 noon Cairo (26 Nov): a coupon code sent as a number counts as a try (it skipped the limit on
// wrong guesses); every ready design has an Arabic name of its own (12 showed their English title on the Arabic site);
// the dashboard says "1 order" / "طلب واحد".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { Library } = require('../src/library');

let dir;
let server;
let base;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t1-2607-'));
  const app = createApp({ dataDir: dir, adminPassword: 'secret', limits: { couponTry: [{ max: 3, ms: 60e3 }] }, cleanupEvery: 0, requireApproval: false });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const quote = (couponCode) => fetch(`${base}/api/cart/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designIds: [], couponCode }) });

test('a coupon code sent as a number counts toward the wrong-guess limit', async () => {
  const seen = [];
  for (let i = 0; i < 6; i++) seen.push((await quote(735190 + i)).status);
  assert.ok(seen.includes(429), `refused after a few wrong numbers: ${seen}`);
});

test('every ready design has an Arabic name of its own (not its English title)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-lib-'));
  try {
    const lib = new Library(d);
    const all = lib.list ? lib.list() : lib.all ? lib.all() : lib.designs;
    const list = Array.isArray(all) ? all : all.designs;
    assert.ok(list.length > 100);
    const same = list.filter((x) => x.name && x.name.en && x.name.en === x.name.ar).map((x) => x.id);
    assert.deepStrictEqual(same, []);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('dashboard customers: "1 order", "2 orders" / "طلب واحد", "طلبين", "٥ طلبات"', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');
  const pick = (k) => { const m = new RegExp(`'${k.replace(/\./g, '\\.')}': \\['([^']*)', '([^']*)'\\]`).exec(src); return m && [m[1], m[2]]; };
  assert.deepStrictEqual(pick('cu.orderCount.one'), ['1 order', 'طلب واحد']);
  assert.deepStrictEqual(pick('cu.orderCount.two'), ['2 orders', 'طلبين']);
  assert.deepStrictEqual(pick('cu.orderCount.few'), ['{n} orders', '{n} طلبات']);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8'), /POD\.plural\('cu\.orderCount', c\.orders\)/);
});
