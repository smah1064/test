'use strict';

// Tester 1's run at 10 pm Cairo (25 Nov), on the server: made-up page addresses get the 404 page and are not looked
// up again and again or kept (they filled the server's memory); the shop's real pages still open.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

test('made-up page addresses: the 404 page every time, nothing kept; real pages open', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-pages-'));
  const app = createApp({ dataDir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const realExists = fs.existsSync;
  let looked = 0;
  try {
    for (const p of ['/', '/cart', '/designs', '/offline', '/editor.html', '/account']) {
      assert.strictEqual((await fetch(base + p, { headers: { accept: 'text/html' } })).status, 200, p);
    }
    // (Counted: the server doesn't look on disk for an address that isn't one of its pages.)
    fs.existsSync = (f) => { if (String(f).includes('zzz-made-up')) looked++; return realExists(f); };
    for (let i = 0; i < 200; i++) {
      const r = await fetch(`${base}/zzz-made-up-${'a'.repeat(2000)}-${i}`, { headers: { accept: 'text/html' } });
      assert.strictEqual(r.status, 404);
      if (i === 0) assert.match(await r.text(), /<html/i, 'the shop\'s own 404 page');
    }
    assert.strictEqual(looked, 0, 'made-up names are never looked up');
  } finally {
    fs.existsSync = realExists;
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
