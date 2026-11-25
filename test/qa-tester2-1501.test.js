'use strict';

// QA tester 2 (25 Nov, 3:01 pm Cairo run): a share link of a garment with no size chosen named "S" on the share page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

test('a share with no size chosen yet doesn\'t name one; a chosen size is still shown', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa1501-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const preview = 'data:image/png;base64,' + (await sharp({ create: { width: 60, height: 72, channels: 3, background: '#c33' } }).png().toBuffer()).toString('base64');
    const sides = { front: { objects: [{ type: 'i-text', text: 'hi' }] } };
    const open = await (await post('/api/shares', { productId: 'tshirt', color: 'navy', size: 'S', sizePicked: false, sides, previews: { front: preview } })).json();
    assert.strictEqual(open.size, null);
    assert.strictEqual((await (await fetch(`${base}/api/shares/${open.id}`)).json()).size, null);
    // The copy still opens on a size (the editor asks before adding to the cart).
    assert.strictEqual((await (await fetch(`${base}/api/shares/${open.id}/design`)).json()).size, 'S');
    const chosen = await (await post('/api/shares', { productId: 'tshirt', color: 'navy', size: 'L', sizePicked: true, sides, previews: { front: preview } })).json();
    assert.strictEqual(chosen.size.id, 'L');
    // Older editors (no sizePicked) keep showing the size.
    const old = await (await post('/api/shares', { productId: 'tshirt', color: 'navy', size: 'M', sides, previews: { front: preview } })).json();
    assert.strictEqual(old.size.id, 'M');
    // The share page and the editor send / read it.
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'share.js'), 'utf8'), /share\.size \? tr\(share\.size\.label\) : ''/);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'editor.js'), 'utf8'), /sizePicked: Boolean\(st\.sizePicked\), options: st\.options/);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
