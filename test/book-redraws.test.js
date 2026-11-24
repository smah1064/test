'use strict';

// AI-redrawn book pages show the child as described: a new photo or new answers make them go
// (QA 24 Nov: "Order again" + a new photo still printed the first child's redrawn pages).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-redraw-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN], books: [OPEN] }, cleanupEvery: 0, requireApproval: false, captcha: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a new photo or new answers drop the redrawn pages; an unchanged save keeps them', async () => {
  const faceUrl = async (bg) => 'data:image/jpeg;base64,' + (await sharp({ create: { width: 400, height: 400, channels: 3, background: bg } }).jpeg().toBuffer()).toString('base64');
  const answers = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };
  const res = await fetch(base + '/api/books/space-hero/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, face: await faceUrl('#c99') }) });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const d = await res.json();
  const redraw = path.join(dataDir, 'files', d.id, 'redraw-2.jpg');
  const fake = async () => fs.writeFileSync(redraw, await sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } }).jpeg().toBuffer());
  const put = (body) => fetch(`${base}/api/books/designs/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-edit-token': d.editToken }, body: JSON.stringify(body) });
  assert.ok(fs.existsSync(path.dirname(redraw)), 'design folder where the shop keeps its files');
  await fake();
  assert.strictEqual((await put({ answers })).status, 200);
  assert.ok(fs.existsSync(redraw), 'same child: kept');
  assert.strictEqual((await put({ answers: { ...answers, gender: 'girl' } })).status, 200);
  assert.ok(!fs.existsSync(redraw), 'boy -> girl: dropped');
  await fake();
  assert.strictEqual((await put({ answers: { ...answers, gender: 'girl' }, face: await faceUrl('#9c9') })).status, 200);
  assert.ok(!fs.existsSync(redraw), 'new photo: dropped');
});
