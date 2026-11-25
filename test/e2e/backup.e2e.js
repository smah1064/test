'use strict';

// Admin → Backups, in the browser: an owner makes a backup (progress, then the row) and downloads it through the
// browser's own downloads, in Arabic; the team never sees the tab.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { loadPlaywright, startServer, newContext } = require('./helpers');

test('Backups tab: an owner makes one and downloads it; the team doesn\'t see the tab', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  const api = async (url, method, body, token) => {
    const r = await fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const owner = (await api('/api/admin/login', 'POST', { password: 'secret' })).json.token;
    assert.strictEqual((await api('/api/admin/staff', 'POST', { name: 'Ops Backup', username: 'opsbackup', roles: ['operations'], password: 'operations-backup-pass' }, owner)).status, 201);

    const ctx = await newContext(browser);
    await ctx.addInitScript(() => { try { localStorage.setItem('pod-lang', 'ar'); } catch (e) { /* ignore */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${srv.base}/admin`);
    await page.fill('#password', 'secret');
    await page.press('#password', 'Enter');
    await page.waitForSelector('#dash:not([hidden])');
    await page.click('[data-tab="backup"]');
    await page.waitForSelector('#tab-backup [data-bk-make]');
    assert.match(await page.textContent('#tab-backup'), /نسخة احتياطية/);
    // The top card has room inside, like the other dashboard cards: its title and button keep clear of its border.
    const gaps = await page.evaluate(() => {
      const card = document.querySelector('.bk-head').getBoundingClientRect();
      const h = document.querySelector('.bk-head h2').getBoundingClientRect();
      const b = document.querySelector('[data-bk-make]').getBoundingClientRect();
      return { top: h.top - card.top, right: card.right - h.right, bottom: card.bottom - b.bottom, btnRight: card.right - b.right };
    });
    for (const [k, v] of Object.entries(gaps)) assert.ok(v >= 12, `${k}: ${v}px from the card's border`);
    await page.click('[data-bk-make]');
    await page.waitForSelector('#tab-backup .bk-row [data-bk-get]', { timeout: 30000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tab-backup .bk-row [data-bk-get]')]);
    assert.match(dl.suggestedFilename(), /^ebda3-backup-\d{8}-\d{4}\.tar\.gz$/);
    const file = await dl.path();
    const head = fs.readFileSync(file).subarray(0, 2);
    assert.deepStrictEqual([...head], [0x1f, 0x8b], 'a gzip file');
    assert.deepStrictEqual(errors, []);
    await ctx.close();

    // The team: no Backups tab.
    const ctx2 = await newContext(browser);
    const p2 = await ctx2.newPage();
    await p2.goto(`${srv.base}/admin`);
    await p2.fill('#username', 'opsbackup');
    await p2.fill('#password', 'operations-backup-pass');
    await p2.press('#password', 'Enter');
    await p2.waitForSelector('#dash:not([hidden])');
    assert.strictEqual(await p2.isVisible('[data-tab="backup"]'), false);
    await ctx2.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
