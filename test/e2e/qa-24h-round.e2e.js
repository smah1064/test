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
