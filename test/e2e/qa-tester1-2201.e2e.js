'use strict';

// Tester 1's run at 10 pm Cairo (25 Nov), in the browser: a pack product shows its 1 under the pack shown as chosen;
// the Arabic Review card of a photo print names each photo's size in brackets (the "·" read as a zero) and shows no
// "0 × 0 cm" or "? × ? px" lines.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');
const { PRODUCTS } = require('../../src/products');

test('Editor, packs (postcards): the pack shown as chosen has 1 in its box, and the total says one copy', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'postcards');
    await page.waitForSelector('#qty-field .qty-in');
    const st = await page.evaluate(() => ({ size: window.__editor.st.sizeId }));
    const value = await page.$eval(`#qty-field .qty-in[data-qz="${st.size}"]`, (el) => el.value);
    assert.strictEqual(value, '1', 'the chosen pack\'s box says 1');
    assert.doesNotMatch(await page.textContent('#qty-field .qty-sum'), /Choose a size/);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('Review (Arabic): a photo print\'s photos read "صورة ١ (١٠ × ١٥ سم)"; no 0 × 0 cm or ? × ? px lines', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const owner = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
    const prod = PRODUCTS.find((p) => p.id === 'photoprints');
    const px = (cm) => Math.round((cm / 2.54) * prod.photo.dpi);
    const [a, b] = prod.sizes.find((z) => z.id === '10x15').cm.map(px);
    const jpeg = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#3a7bd5' } }).jpeg({ quality: 80 }).toBuffer();
    const c = await (await post('/api/photosets', { color: 'gloss', photos: [{ size: '10x15', copies: 1, orientation: 'portrait', dpi: 60 }] })).json();
    for (const name of c.files) await fetch(`${srv.base}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: name.startsWith('photo-') ? await jpeg(a, b) : await jpeg(200, 300) });
    assert.strictEqual((await fetch(`${srv.base}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } })).status, 200);
    const proof = await (await fetch(`${srv.base}/api/designs/${c.id}/proof`)).json();
    const q = await (await post('/api/cart/quote', { designIds: [c.id] })).json();
    const o = await (await post('/api/orders', { customer: { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' }, designIds: [c.id], expectedTotal: q.total, approvals: { [c.id]: { proofHash: proof.proofHash } } })).json();
    const it = o.items[0];
    // Sent back to Review (the photo is too blurry to print as is).
    const back = await fetch(`${srv.base}/api/admin/items/${it.id}/review`, { method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen', note: 'Photo too blurry' }) });
    assert.strictEqual(back.status, 200, await back.text());

    const ctx = await newContext(browser);
    await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${srv.base}/admin`);
    await page.fill('#password', 'secret');
    await page.press('#password', 'Enter');
    await page.waitForSelector('#dash:not([hidden])');
    await page.click('[data-tab="review"]');
    await page.waitForSelector(`#rv-${it.id}`);
    await page.click(`[data-rv-toggle="${it.id}"]`);
    await page.waitForSelector('.rv-photos .rv-photo-row');
    const label = (await page.textContent('.rv-photos .rv-photo-row span.small')).trim();
    assert.match(label, /^صورة ١ \(.*١٠.*١٥.*\)$/, label);
    assert.doesNotMatch(label, /·/);
    const card = await page.textContent('#tab-review');
    assert.doesNotMatch(card, /٠ × ٠ سم|\? × \? px/, 'no empty size lines');
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
