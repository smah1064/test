'use strict';

// Owner's go, 26 Nov (UX review items): on computers the quantity is a − 1 + counter, with the table one click away
// (7); on phones Print | Embroidery is a pill on the design area (5); business-card templates show sample details
// instead of {Name}, the print check flags them until they're replaced, and a name list still fills the blanks (2).
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

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
async function open(product, { lang = 'en', phone = false } = {}) {
  const { devices } = loadPlaywright();
  const ctx = await browser.newContext(phone ? devices['Pixel 7'] : { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${srv.base}/editor?product=${product}&color=white`);
  await page.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.product);
  await page.waitForTimeout(600);
  return { ctx, page };
}

test('computer: How many? is a − 1 + counter; "Another size" opens the table', { timeout: 90000 }, async () => {
  for (const lang of ['en', 'ar']) {
    const { ctx, page } = await open('tshirt', { lang });
    try {
      await page.waitForSelector('#qty-field .qty-step [data-qstep="1"]');
      assert.strictEqual(await page.locator('#qty-field .qty-in').count(), 0, `${lang}: no table of zeros`);
      await page.click('#sizes [data-size="M"]');
      await page.click('#qty-field [data-qstep="1"]');
      await page.waitForFunction(() => JSON.stringify(window.__editor.st.qty) === JSON.stringify({ white: { M: 2 } }));
      assert.match(await page.textContent('#qty-field .qty-n'), /2|٢/);
      assert.ok(await page.isVisible('#qty-field .qty-sum'));
      await page.click('#qty-field [data-qgrid]');
      await page.waitForSelector('#qty-field .qty-in[data-qz="L"]');
      assert.strictEqual(await page.inputValue('#qty-field .qty-in[data-qz="M"]'), '2');
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  }
});

test('phone: Print | Embroidery pill under Front / Back; it switches to the embroidery; not on products without it, nor on computers', { timeout: 90000 }, async () => {
  const { ctx, page } = await open('tshirt', { lang: 'ar', phone: true });
  try {
    await page.waitForSelector('#method-pill:not([hidden]) [data-method="embroidery"]');
    const pill = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const m = document.getElementById('method-pill');
      const tabs = document.getElementById('side-tabs');
      return { text: m.textContent, below: r(m).top >= r(tabs).bottom - 1, h: Math.round(r(m.querySelector('button')).height), wide: document.documentElement.scrollWidth > innerWidth };
    });
    assert.match(pill.text, /طباعة/);
    assert.match(pill.text, /تطريز/);
    assert.match(pill.text, /١٥٠/);
    assert.ok(pill.below, 'under Front / Back');
    assert.ok(pill.h >= 44, `thumb size (${pill.h})`);
    assert.strictEqual(pill.wide, false);
    await page.click('#method-pill [data-method="embroidery"]');
    await page.waitForFunction(() => window.__editor.st.side === 'emb');
    assert.strictEqual(await page.getAttribute('#method-pill [data-method="embroidery"]', 'aria-pressed'), 'true');
    await page.click('#method-pill [data-method="print"]');
    await page.waitForFunction(() => window.__editor.st.side !== 'emb');
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
  const mug = await open('mug', { lang: 'ar', phone: true });
  try {
    assert.strictEqual(await mug.page.isVisible('#method-pill'), false, 'a mug has no embroidery');
  } finally {
    await mug.ctx.close();
  }
  const desk = await open('tshirt');
  try {
    assert.strictEqual(await desk.page.isVisible('#method-pill'), false, 'computers have it in the right column');
  } finally {
    await desk.ctx.close();
  }
});

test('business cards: templates show sample details, not {Name}; flagged until replaced; a name list gets its blanks back', { timeout: 120000 }, async () => {
  for (const lang of ['ar', 'en']) {
    const { ctx, page } = await open('bizcards', { lang, phone: true });
    try {
      // The same blanks the shop's card templates use.
      const filled = await page.evaluate(() => [window.POD_DESIGN.withSamples('{الاسم}'), window.POD_DESIGN.withSamples('{Name}'), window.POD_DESIGN.withSamples('{NAME}'), window.POD_DESIGN.withSamples('{Phone} | {Email}'), window.POD_DESIGN.withSamples('{Team}')]);
      assert.deepStrictEqual(filled, ['سارة أحمد', 'Sara Ahmed', 'SARA AHMED', '01001234567 | sara@example.com', '{Team}']);
      await page.click('.tools [data-flyout="templates"]');
      await page.waitForSelector('#tpl-cats [data-tplcat]');
      const cat = await page.evaluate(() => {
        const list = window.__editor && document.querySelectorAll('#tpl-cats [data-tplcat]');
        const b = [...list].find((x) => /شركات|[Bb]usiness|[Tt]eam/.test(x.textContent));
        return b && b.dataset.tplcat;
      });
      assert.ok(cat, 'the companies and teams group');
      await page.click(`#tpl-cats [data-tplcat="${cat}"]`);
      await page.waitForFunction(() => [...document.querySelectorAll('#template-grid img')].filter((i) => i.src && i.complete).length >= 3, null, { timeout: 30000 });
      await page.click('#template-grid .template-btn >> nth=0');
      await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.fieldSrc));
      const texts = await page.evaluate(() => window.__editor.canvas.getObjects().filter((o) => o.text != null).map((o) => o.text));
      assert.ok(texts.length >= 3, JSON.stringify(texts));
      assert.ok(texts.every((x) => !/\{[^{}]+\}/.test(x)), `no raw blanks: ${JSON.stringify(texts)}`);
      const issues = await page.evaluate(() => window.__editor.checkIssues().filter((i) => i.key === 'check.sampleText').length);
      assert.ok(issues >= 3, `each sample detail is flagged (${issues})`);
      // One typed over: it stays the customer's own; a name list puts the others back to their blanks.
      await page.evaluate(() => {
        const ed = window.__editor;
        const o = ed.canvas.getObjects().find((x) => /سارة|Sara/i.test(x.text || ''));
        o.set('text', 'Laila'); ed.canvas.fire('object:modified', { target: o });
      });
      const csv = 'الاسم,الوظيفة,الموبايل,الإيميل,Name,Position,Phone,Email\nمنى,محاسبة,01111111111,m@x.com,Mona,Accountant,01111111111,m@x.com\n';
      await page.setInputFiles('#merge-file', { name: 'team.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await page.waitForFunction(() => window.__editor.st.mergeList, null, { timeout: 20000 });
      const after = await page.evaluate(() => window.__editor.canvas.getObjects().filter((o) => o.text != null).map((o) => o.text));
      assert.ok(after.includes('Laila'), JSON.stringify(after));
      assert.ok(after.filter((x) => /^\{[^{}]+\}$/.test(x)).length >= 2, `blanks back: ${JSON.stringify(after)}`);
      assert.deepStrictEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  }
});
