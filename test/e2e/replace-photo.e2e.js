'use strict';

// Review › Replace a photo (photo prints; owner's decision, 25 Nov): the note first, then the photo; the customer
// gets the new proof.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext } = require('./helpers');
const { PRODUCTS } = require('../../src/products');

const CUSTOMER = { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' };

test('Review › Replace a photo on a photo-prints job: needs the note, then the customer gets version 2', { timeout: 120000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const jpeg = (w, h, c = '#3a7bd5') => sharp({ create: { width: w, height: h, channels: 3, background: c } }).jpeg().toBuffer();
  try {
    const prod = PRODUCTS.find((p) => p.id === 'photoprints');
    const px = (cm) => Math.round((cm / 2.54) * prod.photo.dpi);
    const cm = prod.sizes.find((z) => z.id === '10x15').cm;
    const c = await (await post('/api/photosets', { color: 'gloss', photos: [{ size: '10x15', copies: 1, orientation: 'portrait' }] })).json();
    for (const name of c.files) await fetch(`${srv.base}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: name.startsWith('photo-') ? await jpeg(px(cm[0]), px(cm[1])) : await jpeg(200, 300) });
    await fetch(`${srv.base}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } });
    const proof = await (await fetch(`${srv.base}/api/designs/${c.id}/proof`)).json();
    const q = await (await post('/api/cart/quote', { designIds: [c.id] })).json();
    const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [c.id], expectedTotal: q.total, approvals: { [c.id]: { proofHash: proof.proofHash } } })).json();
    const it = o.items[0];
    const owner = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
    assert.strictEqual((await post(`/api/admin/items/${it.id}/review`, { action: 'reopen', note: 'Too blurry' }, { Authorization: `Bearer ${owner}` })).status, 200);

    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto(`${srv.base}/admin`);
    await page.fill('#password', 'secret');
    await page.click('#login button[type=submit]');
    await page.waitForSelector('#dash:not([hidden])');
    await page.click('[data-tab="review"]');
    await page.waitForSelector(`#rv-${it.id}`);
    await page.click(`[data-rv-toggle="${it.id}"]`);
    await page.waitForSelector(`[data-rv-photo="${it.id}"][data-rv-n="1"]`, { state: 'attached' });
    assert.match(await page.textContent(`#rv-${it.id} .rv-photos`), /Replace a photo/);
    const better = await jpeg(1800, 1200, '#aa2200');
    // No note: said, nothing sent.
    await page.setInputFiles(`[data-rv-photo="${it.id}"][data-rv-n="1"]`, { name: 'better.jpg', mimeType: 'image/jpeg', buffer: better });
    await page.waitForFunction(() => document.body.innerText.includes('Write what you changed'));
    await page.fill(`#rv-note-${it.id}`, 'A sharper copy of your photo');
    await page.setInputFiles(`[data-rv-photo="${it.id}"][data-rv-n="1"]`, { name: 'better.jpg', mimeType: 'image/jpeg', buffer: better });
    await page.waitForFunction(() => /version 2/i.test(document.body.innerText), null, { timeout: 30000 });
    const pub = (await (await fetch(`${srv.base}/api/orders/${o.id}?k=${o.key}`)).json()).items[0];
    assert.strictEqual(pub.status, 'awaiting_approval');
    assert.strictEqual(pub.review.note, 'A sharper copy of your photo');
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
