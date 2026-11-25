'use strict';

// Admin → Rights requests (QA 25 Nov): the owner's alert links to /admin#rights; the owner sees the requests
// (open ones first, with a badge), what the visitor typed as text, and marks them handled. Product managers
// never see the tab.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

test('rights requests: owner list, badge, escaping, handled / open again; hidden from product managers', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    for (const r of [
      { name: 'منى عادل', contact: 'mona@example.com', owner: 'استوديو منى', link: 'https://example.com/design?id=x', details: 'السطر الأول\nالسطر التاني' },
      { name: '<b>Evil</b>', contact: '٠١٠ ١٢٣٤ ٥٦٧٨', owner: '<img src=x onerror="window.__xss=1">', link: 'javascript:window.__xss=1', details: '<script>window.__xss=1</script> please remove' },
    ]) assert.strictEqual((await post('/api/takedown', r)).status, 201);
    const owner = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
    assert.strictEqual((await post('/api/admin/staff', { name: 'Mostafa', username: 'mostafa', password: 'staffpass123' }, { Authorization: `Bearer ${owner}` })).status, 201);

    // ---------- The owner, from the alert's link, in Arabic at phone width ----------
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${srv.base}/admin#rights`);
    await page.fill('#password', 'secret');
    await page.click('#login button[type=submit]');
    await page.waitForSelector('#tab-rights:not([hidden]) .tk-item');
    const seen = await page.evaluate(() => ({
      title: document.getElementById('dash-title').textContent,
      badge: document.getElementById('tk-count').textContent,
      open: document.querySelectorAll('.tk-item.is-open').length,
      injected: document.querySelectorAll('#tab-rights b, #tab-rights img, #tab-rights script').length,
      xss: window.__xss || 0,
      text: document.getElementById('tab-rights').innerText,
      links: [...document.querySelectorAll('#tab-rights a')].map((a) => [a.getAttribute('href'), a.target]),
      details: [...document.querySelectorAll('.tk-details')].map((d) => d.textContent),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.strictEqual(seen.title, 'طلبات الحقوق');
    assert.strictEqual(seen.badge, '٢');
    assert.strictEqual(seen.open, 2);
    assert.strictEqual(seen.injected, 0, 'what the visitor typed is text');
    assert.strictEqual(seen.xss, 0);
    assert.match(seen.text, /<b>Evil<\/b>/);
    assert.match(seen.text, /طلبين مفتوحين/);
    assert.ok(seen.details.includes('السطر الأول\nالسطر التاني'), 'line breaks kept');
    assert.deepStrictEqual(seen.links.filter(([h]) => /^(tel|https:\/\/wa\.me)/.test(h)), [['tel:+201012345678', ''], ['https://wa.me/201012345678', '_blank']]);
    assert.ok(seen.links.some(([h, tgt]) => h === 'mailto:mona@example.com' && !tgt));
    assert.ok(seen.links.some(([h, tgt]) => h === 'https://example.com/design?id=x' && tgt === '_blank'));
    assert.ok(!seen.links.some(([h]) => /^javascript:/i.test(h)), 'no script links');
    assert.strictEqual(seen.overflow, 0, 'no sideways scrolling at 360 px');

    // A note and "handled": the badge follows, and the server has both.
    const first = page.locator('.tk-item.is-open').first();
    const id = await first.getAttribute('data-tk');
    await first.locator('textarea').fill('رديت عليه');
    await first.locator('[data-tk-status="done"]').click();
    await page.waitForFunction((i) => document.getElementById('tk-' + i).classList.contains('is-done'), id);
    assert.strictEqual(await page.textContent('#tk-count'), '١');
    let list = await (await fetch(`${srv.base}/api/admin/takedowns`, { headers: { Authorization: `Bearer ${owner}` } })).json();
    assert.deepStrictEqual([list.open, list.takedowns.find((x) => x.id === id).status, list.takedowns.find((x) => x.id === id).note], [1, 'done', 'رديت عليه']);
    await page.click(`#tk-${id} [data-tk-status="new"]`);
    await page.waitForFunction((i) => document.getElementById('tk-' + i).classList.contains('is-open'), id);
    assert.strictEqual(await page.textContent('#tk-count'), '٢');
    // English: the same view in English words; another tab keeps the badge and leaves #rights.
    await page.click('[data-lang-toggle]');
    await page.waitForFunction(() => document.getElementById('dash-title').textContent === 'Rights requests');
    assert.match(await page.textContent('.tk-intro'), /2 open requests/);
    await page.click('[data-tab="queue"]');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await page.evaluate(() => [location.hash, document.getElementById('tk-count').textContent]), ['', '2']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();

    // ---------- A product manager: no tab, no calls to the owner's routes ----------
    const pctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const pm = await pctx.newPage();
    const calls = [];
    pm.on('request', (r) => { if (r.url().includes('/api/admin/takedowns')) calls.push(r.url()); });
    await pm.goto(`${srv.base}/admin#rights`);
    await pm.click('#staff-toggle');
    await pm.fill('#username', 'mostafa');
    await pm.fill('#password', 'staffpass123');
    await pm.click('#login button[type=submit]');
    await pm.waitForSelector('#tab-products:not([hidden])');
    await pm.waitForTimeout(500);
    assert.deepStrictEqual(await pm.evaluate(() => [document.querySelector('[data-tab="rights"]').hidden, document.getElementById('tab-rights').hidden, document.getElementById('tab-rights').innerHTML]), [true, true, '']);
    assert.deepStrictEqual(calls, []);
    await pctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
