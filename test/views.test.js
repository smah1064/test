'use strict';

// View-only links (owner's decision, 26 Nov): a booklet or a two-sided product sent by WhatsApp or email to flip
// through. The customer's key updates the same link to the latest version; whoever has the link only looks; it stops
// 60 days after its last update; while the shop is private, the link (its page and pictures) opens for anyone who has it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { views: [OPEN] };
const servers = [];
async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-views-'));
  const app = createApp({ dataDir: dir, adminPassword: 'secret-owner-pass', limits: LIMITS, cleanupEvery: 0, requireApproval: false, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  servers.push({ server, dir });
  return { base: `http://127.0.0.1:${server.address().port}`, dir, app };
}
test.after(() => {
  for (const { server, dir } of servers) {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
const page = async (n, w = 420, h = 600) => `data:image/jpeg;base64,${(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 20 * n, g: 120, b: 200 } } }).jpeg().toBuffer()).toString('base64')}`;
const json = (base, url, method, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('a booklet\'s pages: made, seen in order, updated with the key to the latest version, removed', async () => {
  const { base } = await start();
  const P = require('../src/products');
  const booklet = (P.PRODUCTS || P.products).find((p) => p.id === 'booklets');
  const ids = booklet.sides.slice(0, 8).map((s) => s.id);
  assert.strictEqual(ids.length, 8);
  const pages = await Promise.all(ids.map(async (side, n) => ({ side, image: await page(n) })));
  const made = await json(base, '/api/views', 'POST', { productId: 'booklets', options: {}, pages });
  assert.strictEqual(made.status, 201, await made.clone().text());
  const { id, key, url } = await made.json();
  assert.match(id, /^[A-Za-z0-9_-]{12}$/);
  assert.match(key, /^[A-Za-z0-9_-]{32}$/);
  assert.strictEqual(url, `/view?id=${id}`);
  const v = await (await fetch(`${base}/api/views/${id}`)).json();
  assert.strictEqual(v.kind, 'pages');
  assert.strictEqual(v.rtl, true, 'an Arabic booklet turns from the right');
  assert.strictEqual(v.pages.length, 8);
  assert.deepStrictEqual([v.pages[0].w, v.pages[0].h], [420, 600]);
  assert.strictEqual(v.makeOwn, '/product?id=booklets');
  assert.ok(!JSON.stringify(v).match(/price|EGP|key|customer|phone/i), 'nothing but the pages');
  const img = await fetch(base + v.pages[3].url);
  assert.strictEqual(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/jpeg/);
  assert.match(img.headers.get('cache-control'), /no-transform/);
  // The customer saves a newer version: the same link shows it (4 pages now, left binding).
  const wrong = await json(base, `/api/views/${id}`, 'PUT', { productId: 'booklets', pages: pages.slice(0, 4) }, { 'x-view-key': 'x'.repeat(32) });
  assert.strictEqual(wrong.status, 403);
  const up = await json(base, `/api/views/${id}`, 'PUT', { productId: 'booklets', options: { binding: 'left' }, pages: pages.slice(0, 4) }, { 'x-view-key': key });
  assert.strictEqual(up.status, 200, await up.clone().text());
  const v2 = await (await fetch(`${base}/api/views/${id}`)).json();
  assert.strictEqual(v2.pages.length, 4);
  assert.strictEqual(v2.rtl, false);
  assert.notStrictEqual(v2.pages[0].url, v.pages[0].url, 'a new picture address for the new version');
  assert.strictEqual((await fetch(base + v.pages[6].url)).status, 404, 'pages the new version doesn\'t have are gone');
  // Removed by the customer.
  assert.strictEqual((await json(base, `/api/views/${id}`, 'DELETE', undefined, { 'x-view-key': key })).status, 200);
  assert.strictEqual((await fetch(`${base}/api/views/${id}`)).status, 404);
});

test('two-sided products and mugs; single-sided products and bad pictures are refused', async () => {
  const { base } = await start();
  const tee = await json(base, '/api/views', 'POST', { productId: 'tshirt', pages: [{ side: 'front', image: await page(1) }, { side: 'back', image: await page(2) }] });
  assert.strictEqual(tee.status, 201, await tee.clone().text());
  const tv = await (await fetch(`${base}/api/views/${(await tee.json()).id}`)).json();
  assert.strictEqual(tv.kind, 'sides');
  assert.deepStrictEqual(tv.pages.map((p) => p.name.en), ['Front', 'Back']);
  assert.strictEqual((await json(base, '/api/views', 'POST', { productId: 'couplemugs', pages: [{ side: 'mug1', image: await page(1) }, { side: 'mug2', image: await page(2) }] })).status, 201);
  const mug = await json(base, '/api/views', 'POST', { productId: 'mug', pages: [{ side: 'front', image: await page(1) }] });
  assert.strictEqual(mug.status, 400);
  assert.strictEqual((await mug.json()).code, 'viewProduct');
  const svg = `data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(120)).toString('base64')}`;
  for (const pages of [[{ side: 'front', image: svg }], [{ side: 'nope', image: await page(1) }], []]) {
    const r = await json(base, '/api/views', 'POST', { productId: 'tshirt', pages });
    assert.strictEqual(r.status, 400, JSON.stringify(pages).slice(0, 80));
  }
});

test('60 days after its last update the link stops (410) and the clean-up removes it', async () => {
  const { base, dir, app } = await start();
  const made = await (await json(base, '/api/views', 'POST', { productId: 'flyers', pages: [{ side: 'front', image: await page(1) }, { side: 'back', image: await page(2) }] })).json();
  const file = path.join(dir, 'views', made.id, 'view.json');
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  v.updatedAt = new Date(Date.now() - 61 * 864e5).toISOString();
  fs.writeFileSync(file, JSON.stringify(v));
  const r = await fetch(`${base}/api/views/${made.id}`, { headers: { 'x-lang': 'ar' } });
  assert.strictEqual(r.status, 410);
  assert.match((await r.json()).error, /اللينك/);
  await app.locals.cleanup();
  assert.ok(!fs.existsSync(path.join(dir, 'views', made.id)), 'removed');
});

test('while the shop is private: the view page and the link\'s pictures open without an invitation, nothing else', async () => {
  const { base } = await start({ previewStart: true });
  // Made by an invited customer (here: the owner's browser), opened by someone without an invitation.
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-owner-pass' }) });
  const cookie = (login.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
  const made = await json(base, '/api/views', 'POST', { productId: 'menus', pages: [{ side: 'front', image: await page(1) }, { side: 'back', image: await page(2) }] }, { Cookie: cookie });
  assert.strictEqual(made.status, 201, await made.clone().text());
  const { id } = await made.json();
  assert.strictEqual((await json(base, '/api/views', 'POST', { productId: 'menus', pages: [] })).status, 403, 'making one needs the shop');
  assert.strictEqual((await fetch(`${base}/api/products`)).status, 403);
  const v = await fetch(`${base}/api/views/${id}`);
  assert.strictEqual(v.status, 200);
  const meta = await v.json();
  assert.strictEqual((await fetch(base + meta.pages[1].url)).status, 200);
  const html = await (await fetch(`${base}/view?id=${id}`)).text();
  assert.ok(!html.includes('/api/preview/enter'), 'the view page, not "Opening soon"');
  // A made-up path next to it doesn't get through.
  assert.notStrictEqual((await fetch(`${base}/api/views/${id}/page/0.svg`)).status, 200);
  assert.strictEqual((await fetch(`${base}/api/views/../products`)).status, 403);
});
