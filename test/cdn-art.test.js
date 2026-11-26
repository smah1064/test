'use strict';

// The hosting's CDN shrinks pictures for phones (800 px wide, WebP) unless told not to. The ready designs' artwork goes
// into print files, so it is sent with "no-transform" (owner, 26 Nov: a 3598 px design arrived 68 DPI on a phone).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

test('design artwork and the link preview are sent with no-transform; other photos are not held back', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-cdnart-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const p of ['/img/art/christmas/trees-holly-plaid.png', '/img/art/christmas/noel.svg', '/img/art/sarcastic/error-404-sloth-beanie-nowords.png', '/img/og-ebda3.png']) {
      const r = await fetch(base + p);
      assert.strictEqual(r.status, 200, p);
      assert.match(r.headers.get('cache-control') || '', /no-transform/, p);
    }
    const photo = await fetch(`${base}/img/lifestyle/mug.webp`);
    if (photo.status === 200) assert.doesNotMatch(photo.headers.get('cache-control') || '', /no-transform/);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a ready design\'s picture is named "Design picture" in the layers and the print check, in both languages', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
  assert.match(src, /'layer\.art': \['Design picture', 'صورة التصميم'\]/);
  const ed = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'editor.js'), 'utf8');
  assert.match(ed, /if \(\/\^art:\/\.test\(o\.name \|\| ''\)\) return t\('layer\.art'\);/);
});
