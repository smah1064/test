'use strict';

// Tester 2's run at 11 am Cairo (26 Nov), on the server: a side whose only texts were emptied isn't a printed side
// (not priced, not sent); the editor's Library finds whole words ("cat" isn't "category", "dog" isn't "dogecoin"),
// and still finds a word being typed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const assets = require('../src/assets');

const OPEN = { max: 1e6, ms: 1000 };
let dir;
let server;
let base;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t2-2606-'));
  const app = createApp({ dataDir: dir, adminPassword: 'secret', limits: { designs: [OPEN], designsAll: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': 'en' }, body: JSON.stringify(body) });

test('a side whose texts were all emptied is refused as a printed side (and isn\'t priced)', async () => {
  const front = { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } };
  for (const text of ['', '   ', '‏ ​']) {
    const r = await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', sides: { front, back: { editor: { objects: [{ type: 'i-text', text }] } } } });
    assert.strictEqual(r.status, 400, JSON.stringify(text));
    assert.strictEqual((await r.json()).code, 'sideEmpty');
  }
  // A blank text next to something that shows: the side is printed as before.
  const ok = await post('/api/designs', { productId: 'tshirt', color: 'white', size: 'M', sides: { front, back: { editor: { objects: [{ type: 'i-text', text: ' ' }, { type: 'rect', width: 10, height: 10 }] } } } });
  assert.strictEqual(ok.status, 201, await ok.clone().text());
  assert.ok((await ok.json()).files.includes('back-print.png'), 'its back is printed');
});

test('Library search: whole words first; the start of a longer word only while nothing matches whole', () => {
  const ids = (q) => assets.search(q, { per: 500 }).items.map((i) => i.id);
  const cat = ids('cat');
  assert.ok(cat.length > 0 && cat.some((i) => /:cat(?:-face)?$/.test(i)), 'cats');
  assert.ok(!cat.some((i) => /category/.test(i)), 'no "category" icons');
  assert.deepStrictEqual(ids('قطة'), cat, 'the same in Arabic');
  const dog = ids('dog');
  assert.ok(dog.length > 0 && !dog.some((i) => /dogecoin/.test(i)), 'no dogecoin');
  assert.ok(ids('cats').some((i) => /:cat(?:-face)?$/.test(i)), '"cats" finds cats');
  assert.ok(ids('flo').length > 0, 'a word still being typed finds something');
  assert.ok(ids('heart').length > 50);
});
