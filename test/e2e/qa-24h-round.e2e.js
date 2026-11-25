'use strict';

// QA round on the last 24 hours' additions (25 Nov, 8:29–9:27 pm Cairo), in the browser: stock per colour and size
// saves only the boxes changed here, so a colleague's count (or the pieces sold since) isn't put back.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

test('Products › stock per colour and size: saving one box keeps a colleague\'s count in another', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  const api = async (url, method, body, token) => {
    const r = await fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const owner = (await api('/api/admin/login', 'POST', { password: 'secret' })).json.token;
    const start = { 'white|S': 5, 'white|M': 5, 'black|S': 5, 'black|M': 5 };
    assert.strictEqual((await api('/api/admin/catalog/tshirt', 'PUT', { stock: null, variantStock: start }, owner)).status, 200);

    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto(`${srv.base}/admin`);
    await page.fill('#password', 'secret');
    await page.press('#password', 'Enter');
    await page.waitForSelector('#dash:not([hidden])');
    await page.click('[data-tab="products"]');
    await page.waitForSelector('#pm-root [data-pm-act="edit"][data-id="tshirt"]');
    await page.click('#pm-root [data-pm-act="edit"][data-id="tshirt"]');
    const box = (c, z) => `.pm-vs .pm-vs-in[data-c="${c}"][data-z="${z}"]`;
    await page.waitForSelector(box('white', 'M'));
    assert.strictEqual(await page.inputValue(box('white', 'S')), '5');

    // A colleague (or a sale) changes white S meanwhile.
    assert.strictEqual((await api('/api/admin/catalog/tshirt', 'PUT', { variantStock: { ...start, 'white|S': 9 } }, owner)).status, 200);

    // Here, on the page opened before: only white M changes.
    await page.fill(box('white', 'M'), '7');
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/admin\/catalog\/tshirt$/.test(r.url()));
    await page.click('[data-pm-save="avail"]');
    assert.strictEqual((await saved).status(), 200);
    const now = (await api('/api/admin/catalog/tshirt', 'GET', undefined, owner)).json;
    assert.strictEqual(now.variantStock['white|S'], 9, 'the colleague\'s count stays');
    assert.strictEqual(now.variantStock['white|M'], 7, 'the box changed here is saved');
    assert.strictEqual(now.variantStock['black|M'], 5);

    // Emptying a box here takes that count away.
    await page.fill(box('black', 'S'), '');
    const saved2 = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/admin\/catalog\/tshirt$/.test(r.url()));
    await page.click('[data-pm-save="avail"]');
    assert.strictEqual((await saved2).status(), 200);
    const after = (await api('/api/admin/catalog/tshirt', 'GET', undefined, owner)).json;
    assert.ok(!('black|S' in after.variantStock), JSON.stringify(after.variantStock));
    assert.strictEqual(after.variantStock['white|S'], 9);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('Editor, no size chosen yet: no size box holds the 1; a number typed under M is M only, and M is the size', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const { openEditor } = require('./helpers');
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    await page.waitForSelector('#qty-field .qty-in[data-qz="M"]');
    const values = await page.$$eval('#qty-field .qty-in', (els) => els.map((e) => [e.dataset.qz, e.value]));
    assert.ok(values.every(([, v]) => v === ''), JSON.stringify(values));
    await page.fill('#qty-field .qty-in[data-qz="M"]', '2');
    await page.dispatchEvent('#qty-field .qty-in[data-qz="M"]', 'change');
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ qty: window.__editor.st.qty, size: window.__editor.st.sizeId, picked: window.__editor.st.sizePicked }));
    assert.deepStrictEqual(st.qty, { white: { M: 2 } }, JSON.stringify(st));
    assert.strictEqual(st.size, 'M');
    assert.strictEqual(st.picked, true);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('Editor: several pictures chosen at once all go on the design; a second colour added before a size is chosen holds no piece', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const { openEditor } = require('./helpers');
  const sharp = require('sharp');
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    const png = (c) => sharp({ create: { width: 400, height: 400, channels: 4, background: c } }).png().toBuffer();
    await page.setInputFiles('#file-input', [
      { name: 'one.png', mimeType: 'image/png', buffer: await png('#cc0000') },
      { name: 'two.png', mimeType: 'image/png', buffer: await png('#0000cc') },
      { name: 'three.png', mimeType: 'image/png', buffer: await png('#00aa00') },
    ]);
    await page.waitForFunction(() => window.__editor.canvas.getObjects().filter((o) => o.type === 'image').length >= 3, null, { timeout: 30000 });
    // Quantities: no size chosen, a second colour.
    await page.waitForSelector('#qty-add');
    const second = await page.$eval('#qty-add', (el) => [...el.options].map((o) => o.value).find(Boolean));
    await page.selectOption('#qty-add', second);
    await page.waitForTimeout(300);
    const values = await page.$$eval('#qty-field .qty-in', (els) => els.map((e) => e.value).filter(Boolean));
    assert.deepStrictEqual(values, [], 'no size box holds a piece nobody chose');
    await page.fill(`#qty-field .qty-in[data-qc="${second}"][data-qz="M"]`, '2');
    await page.dispatchEvent(`#qty-field .qty-in[data-qc="${second}"][data-qz="M"]`, 'change');
    await page.waitForTimeout(300);
    const qty = await page.evaluate(() => window.__editor.st.qty);
    const lines = Object.entries(qty).flatMap(([c, row]) => Object.entries(row).filter(([, n]) => n > 0).map(([z, n]) => `${c}|${z}|${n}`));
    assert.deepStrictEqual(lines, [`${second}|M|2`]);
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('Editor: red text on a black shirt shows (no warning); navy on black is warned about', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const { openEditor } = require('./helpers');
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=black');
    const warned = (fill) => page.evaluate(async (f) => {
      const c = window.__editor.canvas;
      c.getObjects().slice().forEach((o) => { if (o.type === 'i-text' || o.type === 'textbox') c.remove(o); });
      const t = new fabric.IText('Happy Birthday', { left: c.getWidth() / 2, top: c.getHeight() / 2, originX: 'center', originY: 'center', fontSize: 40, fill: f });
      c.add(t);
      c.renderAll();
      return window.__editor.checkIssues().some((i) => i.key === 'check.inkOnColour');
    }, fill);
    assert.strictEqual(await warned('#ff0000'), false, 'red on black shows');
    assert.strictEqual(await warned('#0a1530'), true, 'navy on black hardly shows');
  } finally {
    await browser.close();
    await srv.close();
  }
});
