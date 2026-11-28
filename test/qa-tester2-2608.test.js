'use strict';

// Tester 2 (3 pm Cairo, 26 Nov): a kids-book photo cut out of its background (transparent PNG) came out with a black
// background on the cover and pages. It is white now.
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa2608-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN], books: [OPEN] }, cleanupEvery: 0, requireApproval: false, captcha: null });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a cut-out (transparent) photo gets white behind the face, not black', async () => {
  // A see-through photo with a red circle (the person) in the middle.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><circle cx="200" cy="250" r="90" fill="#c33"/></svg>';
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  assert.strictEqual((await sharp(png).metadata()).hasAlpha, true);
  const answers = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };
  const res = await fetch(base + '/api/books/space-hero/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, face: 'data:image/png;base64,' + png.toString('base64') }) });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const { id } = await res.json();
  const face = fs.readFileSync(path.join(dataDir, 'files', id, 'face.jpg'));
  const { data, info } = await sharp(face).raw().toBuffer({ resolveWithObject: true });
  const corner = [...data.subarray(0, info.channels)];
  assert.ok(corner.every((v) => v > 240), `the corner is white, not black: ${corner}`);
  const mid = ((info.height >> 1) * info.width + (info.width >> 1)) * info.channels;
  assert.ok(data[mid] > 150 && data[mid + 1] < 100, 'the person is still there');
});

test('a book dedication keeps < and > ("Love you <3"); the story\'s own marks { } [ ] | are still left out; the page renders', async () => {
  const face = 'data:image/jpeg;base64,' + (await sharp({ create: { width: 400, height: 500, channels: 3, background: '#c99' } }).jpeg().toBuffer()).toString('base64');
  const answers = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar', dedication: 'Love you <3 & {name} [x] | Mama' };
  const res = await fetch(base + '/api/books/space-hero/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, face }) });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const d = await res.json();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const designs = Array.isArray(saved.designs) ? saved.designs : Object.values(saved.designs || {});
  const dedication = designs.find((x) => x.id === d.id).answers.dedication;
  assert.match(dedication, /Love you <3 &/);
  assert.doesNotMatch(dedication, /[{}[\]|]/);
  // The dedication page (the second) draws it without trouble.
  const page = await fetch(`${base}/api/books/designs/${d.id}/pages/1.jpg`);
  assert.strictEqual(page.status, 200);
  assert.ok((await page.arrayBuffer()).byteLength > 5000);
});
