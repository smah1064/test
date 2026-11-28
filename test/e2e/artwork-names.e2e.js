'use strict';

// Customers' artwork files (QA of AI/EPS uploads, 25 Nov): a picture saved with an .ai name is used as the
// picture it is, and a file with several artboards says the first one is on the design.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

const pdf = (pages) => new Promise((resolve) => {
  const d = new PDFDocument({ size: [300, 300], margin: 0 });
  const chunks = [];
  d.on('data', (c) => chunks.push(c));
  d.on('end', () => resolve(Buffer.concat(chunks)));
  for (let i = 0; i < pages; i++) {
    if (i) d.addPage({ size: [300, 300], margin: 0 });
    d.circle(150, 150, 60 + i * 20).fill(['#d62828', '#1d4ed8', '#16a34a'][i % 3]);
  }
  d.end();
});

test('a PNG named .ai goes on the design; a 3-artboard .ai says the first one is used', { timeout: 90000 }, async () => {
  const srv = await startServer();
  const browser = await loadPlaywright().chromium.launch();
  try {
    const ctx = await newContext(browser);
    const page = await openEditor(ctx, srv.base, 'tshirt', '&color=white');
    const count = () => page.evaluate(() => window.__editor.canvas.getObjects().filter((o) => o.type === 'image').length);
    const png = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 20, g: 120, b: 220, alpha: 1 } } }).png().toBuffer();
    const asked = [];
    page.on('request', (r) => { if (r.url().includes('/api/artwork')) asked.push(r.url()); });
    await page.setInputFiles('#file-input', { name: 'logo.ai', mimeType: 'application/postscript', buffer: png });
    await page.waitForFunction(() => window.__editor.canvas.getObjects().some((o) => o.type === 'image'), null, { timeout: 20000 });
    assert.strictEqual(await count(), 1, 'the picture is on the design');
    assert.deepStrictEqual(asked, [], 'no conversion asked for: it was a PNG all along');
    // Three artboards: converted, the first one used, and the customer told.
    await page.setInputFiles('#file-input', { name: 'master.ai', mimeType: 'application/pdf', buffer: await pdf(3) });
    await page.waitForFunction(() => window.__editor.canvas.getObjects().filter((o) => o.type === 'image').length === 2, null, { timeout: 30000 });
    await page.waitForFunction(() => /3 artboards/.test(document.body.innerText), null, { timeout: 10000 });
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
