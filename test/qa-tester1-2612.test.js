'use strict';

// Tester 1 (8 pm Cairo, 26 Nov): a link to one of the shop's own picture designs (/design?id=xm-trees-holly-plaid)
// showed only the shop's logo when shared; it shows the design's artwork now.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

test('link previews of the shop\'s own picture designs show their artwork; a drawing (SVG) keeps the shop\'s card', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t1-2612-'));
  const app = createApp({ dataDir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ogImage = async (id) => {
    const html = await (await fetch(`${base}/design?id=${id}`)).text();
    const m = /<meta property="og:image" content="([^"]+)">/.exec(html);
    return m && m[1];
  };
  try {
    const img = await ogImage('xm-trees-holly-plaid');
    assert.match(img || '', /\/img-w\/1200\/art\/christmas\/trees-holly-plaid\.png$/);
    // (A 1200 px copy, small enough for WhatsApp's preview, not the 2.4 MB original: tester 1, 26 Nov.)
    const r = await fetch(new URL(new URL(img).pathname, base));
    assert.strictEqual(r.status, 200);
    assert.match(r.headers.get('content-type'), /image\/webp/);
    assert.ok(Number(r.headers.get('content-length') || (await r.clone().arrayBuffer()).byteLength) < 400000, 'small enough');
    // A drawing has no picture a link preview can show: the shop's card, as before.
    assert.match(await ogImage('sq-not-lazy') || '', /\/img\/og-ebda3\.png$/);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
