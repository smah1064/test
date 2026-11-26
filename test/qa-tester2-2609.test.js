'use strict';

// Tester 2 (5 pm Cairo, 26 Nov): view-only links and the cart's − / + copies could fill the disk (no shop-wide budget).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const servers = [];
async function start(limits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa2609-'));
  const app = createApp({ dataDir: dir, adminPassword: 'secret', limits: { designs: [OPEN], designsAll: [OPEN], views: [OPEN], ...limits }, cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  servers.push({ server, dir });
  return `http://127.0.0.1:${server.address().port}`;
}
test.after(() => { for (const { server, dir } of servers) { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } });
const post = (base, url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: JSON.stringify(body) });
const jpeg = async (n) => `data:image/jpeg;base64,${(await sharp({ create: { width: 400, height: 500, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg({ quality: 70 }).toBuffer()).toString('base64')}`;

test('new view-only links stop at the shop\'s daily room; updating a link (it replaces its pictures) doesn\'t count', async () => {
  const base = await start({ viewsMB: 1 });
  const pages = [{ side: 'front', image: await jpeg(1) }, { side: 'back', image: await jpeg(2) }];
  const first = await post(base, '/api/views', { productId: 'tshirt', pages });
  assert.strictEqual(first.status, 201, await first.clone().text());
  const { id, key } = await first.json();
  const second = await post(base, '/api/views', { productId: 'tshirt', pages });
  assert.strictEqual(second.status, 429, 'the day\'s room is used up');
  const up = await fetch(`${base}/api/views/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-view-key': key }, body: JSON.stringify({ productId: 'tshirt', pages }) });
  assert.strictEqual(up.status, 200, 'the customer\'s own link still updates');
});

test('the cart\'s − / + without the key copies the design within the shop\'s daily copy room', async () => {
  const base = await start({ reorderMB: 1 });
  const png = await sharp({ create: { width: 1200, height: 1600, channels: 4, background: { r: 200, g: 60, b: 60, alpha: 1 } } }).png().toBuffer();
  const small = await sharp({ create: { width: 60, height: 72, channels: 4, background: { r: 200, g: 60, b: 60, alpha: 1 } } }).png().toBuffer();
  const made = await (await post(base, '/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
  for (const f of made.files) await fetch(`${base}/api/designs/${made.id}/files/${f}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body: f.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>') : f.includes('print') ? png : small });
  const d = await (await fetch(`${base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } })).json();
  const a = await post(base, `/api/designs/${d.id}/quantity`, { qty: 2 });
  assert.strictEqual(a.status, 200, await a.clone().text());
  const b = await post(base, `/api/designs/${d.id}/quantity`, { qty: 3 });
  assert.strictEqual(b.status, 429, 'no more copies today');
  // With the cart's key the design itself changes: no copy, no room used.
  const own = await post(base, `/api/designs/${d.id}/quantity`, { qty: 4 }, { 'x-design-key': made.uploadToken });
  assert.strictEqual(own.status, 200);
});
