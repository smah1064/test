'use strict';

// QA 28 Nov: the ready designs search had no ranking: "Ho! Ho! Ho!" put "Ho! Ho! Ho! (Santa)" 21st of 24, after hot
// chocolate and holly. A design whose name is what was typed comes first.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext } = require('./helpers');

test('ready designs search: the exact name first, in English and Arabic', { timeout: 120000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const [lang, q] of [['en', 'Ho! Ho! Ho!'], ['en', 'ho ho ho'], ['ar', 'هو هو هو']]) {
      const ctx = await newContext(browser);
      await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
      const page = await ctx.newPage();
      await page.goto(`${srv.base}/designs?q=${encodeURIComponent(q)}`);
      await page.waitForSelector('.design-card', { timeout: 30000 });
      const first = await page.getAttribute('.design-card', 'data-place');
      assert.strictEqual(first, 'xm-ho-ho-ho', `${lang} "${q}": ${first}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
