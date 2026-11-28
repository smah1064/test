'use strict';

// Tester 1 (8 pm Cairo, 26 Nov), in the browser: the cart's "cheaper as…" note stayed in the old language; the editor's
// zoom kept the old language's digits; the print-position arrows stayed on at the zone's edge; a robot check that
// couldn't load asked to "complete" it; the kids' book's current thumbnail was cut at 360 px; share-page replies wrote
// the Arabic month as a number.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');
const { createApp } = require('../../src/app');

let srv;
let browser;
test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});
const post = (url, body) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('cart: the "cheaper as…" note follows a language switch', { timeout: 120000 }, async () => {
  const all = await (await fetch(srv.base + '/api/products')).json();
  const pc = (all.products || all).find((p) => p.id === 'postcards');
  const one = pc.sizes.find((z) => z.copies === 1) || pc.sizes[0];
  const made = await (await post('/api/designs', { productId: 'postcards', color: pc.colors[0].id, size: one.id, sides: { [pc.sides[0].id]: { editor: { objects: [{ type: 'i-text', text: 'Card' }] } } } })).json();
  assert.ok(made.files, JSON.stringify(made));
  for (const name of made.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
      : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1600 : 72, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    await fetch(`${srv.base}/api/designs/${made.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': made.uploadToken, 'Content-Type': 'application/octet-stream' }, body });
  }
  const d = await (await fetch(`${srv.base}/api/designs/${made.id}/complete`, { method: 'POST', headers: { 'x-upload-token': made.uploadToken } })).json();
  const entry = { designId: d.id, productId: d.productId, productName: d.productName, colorName: d.color.name, sizeLabel: d.size.label, sides: d.sides.map((s) => s.name), price: d.price, previewUrl: d.previewUrl, addedAt: new Date().toISOString() };
  const ctx = await newContext(browser);
  await ctx.addInitScript((e) => { if (!localStorage.getItem('pod-cart-v2')) localStorage.setItem('pod-cart-v2', JSON.stringify([e])); }, entry);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${srv.base}/cart`);
    await page.waitForSelector('.cart-qty .qty-n', { timeout: 30000 });
    await page.fill('.cart-qty .qty-n', '20');
    await page.press('.cart-qty .qty-n', 'Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.cart-qty-note')].some((n) => /Cheaper as/.test(n.textContent)), null, { timeout: 30000 });
    await page.click('[data-lang-toggle]');
    await page.waitForFunction(() => document.documentElement.lang === 'ar', null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const notes = await page.$$eval('.cart-qty-note', (els) => els.map((e) => e.textContent));
    assert.ok(notes.length >= 1, 'the note is still there');
    assert.ok(notes.every((n) => !/[A-Za-z]{3,}/.test(n.replace(/A\d|×/g, ''))), `no English left: ${JSON.stringify(notes)}`);
    assert.ok(notes.some((n) => /أرخص/.test(n)), JSON.stringify(notes));
    assert.deepStrictEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('editor: the zoom says its number in the new language\'s digits right after a switch', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  try {
    const page = await openEditor(ctx, srv.base, 'hoodie');
    await page.waitForFunction(() => /[٠-٩]/.test(document.getElementById('zoom-label').textContent), null, { timeout: 15000 });
    await page.evaluate(() => document.querySelector('[data-lang-toggle]').click());
    await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 10000 });
    const label = await page.textContent('#zoom-label');
    assert.match(label, /^\d+%$/, label);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('editor: a print-position arrow turns off when the area can\'t go further that way', { timeout: 60000 }, async () => {
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'hoodie');
    const down = '#place-field [data-nudge="0,1"]';
    await page.waitForSelector(`${down}`, { state: 'attached', timeout: 15000 });
    const up = '#place-field [data-nudge="0,-1"]';
    let presses = 0;
    while (!(await page.$eval(down, (b) => b.disabled)) && presses < 30) {
      await page.evaluate((sel) => document.querySelector(sel).click(), down);
      presses++;
      await page.waitForTimeout(80);
    }
    assert.ok(presses > 0 && presses < 30, `turned off after ${presses} presses`);
    // At the edge: pressing does nothing more, and going back up still works.
    const at = await page.evaluate(() => ({ ...(window.__editor.st.offsets[window.__editor.st.side] || {}) }));
    await page.evaluate((sel) => document.querySelector(sel).click(), down);
    assert.deepStrictEqual(await page.evaluate(() => ({ ...(window.__editor.st.offsets[window.__editor.st.side] || {}) })), at);
    assert.strictEqual(await page.$eval(up, (b) => b.disabled), false);
    await page.evaluate((sel) => document.querySelector(sel).click(), up);
    assert.strictEqual(await page.$eval(down, (b) => b.disabled), false, 'on again after moving back');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('a robot check that can\'t load says so (sign-up), not "complete the security check"', { timeout: 60000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-cap-'));
  const app = createApp({ dataDir, adminPassword: 'secret', cleanupEvery: 0, captcha: { siteKey: '1x00000000000000000000AA', secret: 'test-secret' } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await newContext(browser);
  await ctx.route('https://challenges.cloudflare.com/**', (route) => route.abort());
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/account`);
    await page.waitForSelector('#f-up', { state: 'attached', timeout: 15000 });
    await page.evaluate(() => { const b = document.querySelector('[data-acct-tab="up"], #tab-up, [data-show="up"]'); if (b) b.click(); });
    await page.evaluate(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set('up-name', 'Mona Adel'); set('up-phone', '01066667777'); set('up-email', 'mona@example.com'); set('up-pass', 'Kite-Blue-2026-river'); set('up-pass2', 'Kite-Blue-2026-river');
      const ok = document.getElementById('up-terms'); if (ok) ok.checked = true;
      document.getElementById('f-up').requestSubmit();
    });
    await page.waitForFunction(() => /couldn't load/.test(document.body.textContent), null, { timeout: 20000 });
    assert.doesNotMatch(await page.textContent('body'), /Please complete the security check/);
  } finally {
    await ctx.close();
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('kids\' book at 360 px: the current page\'s thumbnail is whole in the strip as the pages turn', { timeout: 90000 }, async () => {
  for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
    const page = await ctx.newPage();
    try {
      await page.goto(`${srv.base}/book?b=dream-jobs`);
      await page.waitForSelector('#bk-thumbs button', { timeout: 20000 });
      for (let i = 1; i <= 7; i++) {
        await page.click('#bk-next');
        await page.waitForTimeout(700);
        const r = await page.evaluate(() => {
          const s = document.getElementById('bk-thumbs').getBoundingClientRect();
          const a = document.querySelector('#bk-thumbs button.active').getBoundingClientRect();
          return { sl: s.left, sr: s.right, al: a.left, ar: a.right };
        });
        assert.ok(r.al >= r.sl - 0.5 && r.ar <= r.sr + 0.5, `${lang}, page ${i + 1}: ${JSON.stringify(r)}`);
      }
    } finally {
      await ctx.close();
    }
  }
});

test('share page: replies say the month in words in Arabic', { timeout: 60000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
  const preview = await sharp({ create: { width: 60, height: 72, channels: 3, background: '#cccccc' } }).png().toBuffer();
  await ctx.route('**/api/shares/**', (route) => (route.request().method() === 'GET' && /\/api\/shares\/[A-Za-z0-9_-]{12}$/.test(new URL(route.request().url()).pathname)
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'abcdefghijkl', productName: { en: 'Mug', ar: 'مج' }, color: { name: { en: 'White', ar: 'أبيض' } }, size: null, sides: [{ id: 'front', name: { en: 'Front', ar: 'الوش' }, preview: '/img/p.png' }], feedback: [{ vote: 'up', at: '2026-11-26T17:02:00Z', name: 'Mona' }] }) })
    : route.continue()));
  await ctx.route('**/img/p.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: preview }));
  const page = await ctx.newPage();
  try {
    await page.goto(`${srv.base}/share?id=abcdefghijkl`);
    await page.waitForSelector('#share-replies li', { timeout: 15000 });
    const text = await page.textContent('#share-replies');
    assert.match(text, /نوفمبر/, text);
    assert.doesNotMatch(text, /٢٦\/١١/, text);
  } finally {
    await ctx.close();
  }
});
