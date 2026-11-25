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
    assert.match(await page.textContent('#qty-field .qty-sum'), /Choose a size/, 'not "1 piece in total" over empty boxes');
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

test('Account › Password › Delete my account (Arabic): asks to be sure and for the password, then the account is gone', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto(`${srv.base}/account`);
    const made = await page.evaluate(async () => (await fetch('/api/account/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'سارة', phone: '01066665555', password: 'sara-password-1' }) })).status);
    assert.ok([200, 201].includes(made));
    await page.goto(`${srv.base}/account?view=security`);
    await page.waitForSelector('#del-open:visible');
    assert.match(await page.textContent('.acct-delete h3'), /امسح حسابي/);
    await page.click('#del-open');
    await page.click('#del-go');
    await page.waitForSelector('#del-msg:visible');
    assert.match(await page.textContent('#del-msg'), /متأكد/);
    await page.check('#del-sure');
    await page.click('#del-go');
    await page.waitForFunction(() => /كلمة المرور/.test(document.getElementById('del-msg').textContent));
    await page.fill('#del-pw', 'sara-password-1');
    await Promise.all([page.waitForURL(`${srv.base}/`), page.click('#del-go')]);
    const me = await page.evaluate(async () => (await (await fetch('/api/account')).json()).customer);
    assert.strictEqual(me, null);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('Editor: a single postcard says its back side costs its share (EGP 5), not the 50-card pack\'s 60', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const { openEditor } = require('./helpers');
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'postcards', '&size=1');
    await page.waitForFunction(() => document.body.innerText.includes('Add a second side for'));
    const note = await page.evaluate(() => (document.body.innerText.match(/Add a second side for \+?[^\n]*/) || [''])[0]);
    assert.match(note, /\b5\b/, note);
    assert.doesNotMatch(note, /60/, note);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('Activity › more than 500 lines: "Show older" reads the next 500, and the CSV has every line of the period', { timeout: 90000 }, async () => {
  const fs = require('fs');
  const path = require('path');
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  // 1,200 older lines (20 Nov), written before anyone signs in.
  const t0 = Date.parse('2026-11-20T08:00:00Z');
  const lines = Array.from({ length: 1200 }, (x, i) => JSON.stringify({ id: (0x100000000000 + i).toString(16), at: new Date(t0 + i * 1000).toISOString(), whoId: 'owner', who: 'Owner', action: 'PUT /api/admin/coupons/:id', summary: { en: `Seeded change ${i}`, ar: `تعديل ${i}` }, status: 200 }));
  fs.writeFileSync(path.join(srv.dataDir, 'activity.jsonl'), `${lines.join('\n')}\n`);
  const browser = await chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${srv.base}/admin`);
    await page.fill('#password', 'secret');
    await page.press('#password', 'Enter');
    await page.waitForSelector('#dash:not([hidden])');
    await page.click('[data-tab="activity"]');
    await page.waitForSelector('.act-table');
    const rows = () => page.$$eval('.act-table tbody tr', (r) => r.length);
    assert.strictEqual(await rows(), 500);
    assert.ok(await page.isVisible('#act-older'));
    assert.match(await page.textContent('#act-count'), /Show older|اعرض الأقدم/);

    // The CSV is the whole period, while only the first 500 are on the screen.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#act-csv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(csv.includes('Seeded change 0') || csv.includes('تعديل 0'), 'the oldest line is in the file');
    const csvLines = csv.trim().split(/\r?\n/).length - 1;
    assert.ok(csvLines >= 1200, `CSV lines ${csvLines}`);
    assert.strictEqual(await rows(), 500);

    await page.click('#act-older');
    await page.waitForFunction(() => document.querySelectorAll('.act-table tbody tr').length > 500);
    assert.strictEqual(await rows(), 1000);
    await page.click('#act-older');
    await page.waitForFunction(() => !document.getElementById('act-older'));
    assert.strictEqual(await rows(), csvLines);
    assert.doesNotMatch(await page.textContent('#act-count'), /Show older|اعرض الأقدم/);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
