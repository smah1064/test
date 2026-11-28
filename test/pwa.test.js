'use strict';

// The shop as an installable app: the manifest, the worker, the "no connection" page, the icons and the
// home-screen tags on every page; and while the shop is private, the worker and that page still load.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const pub = path.join(__dirname, '..', 'public');
const start = async (opts = {}) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-pwa-'));
  const app = createApp({ dataDir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: () => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
};

test('manifest: installable (id, start, scope, standalone), its icons are real files of their sizes, shortcuts open pages', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/site.webmanifest?v=ebda3`);
    assert.strictEqual(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/manifest\+json/);
    assert.strictEqual(r.headers.get('cache-control'), 'no-cache');
    const m = await r.json();
    assert.strictEqual(m.id, '/');
    assert.strictEqual(m.start_url, '/');
    assert.strictEqual(m.scope, '/');
    assert.strictEqual(m.display, 'standalone');
    assert.strictEqual(m.name, 'إبداع');
    assert.strictEqual(m.dir, 'rtl');
    for (const want of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
      const icon = m.icons.find((i) => i.sizes === want[0] && (i.purpose || 'any') === want[1]);
      assert.ok(icon, want.join(' '));
      const res = await fetch(s.base + icon.src);
      assert.strictEqual(res.status, 200, icon.src);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      assert.strictEqual(`${meta.width}x${meta.height}`, icon.sizes, icon.src);
      assert.strictEqual(meta.format, 'png');
    }
    assert.ok(m.shortcuts.length >= 3);
    for (const sc of m.shortcuts) {
      const page = await fetch(s.base + sc.url, { headers: { accept: 'text/html' } });
      assert.strictEqual(page.status, 200, sc.url);
    }
  } finally { s.stop(); }
});

test('the worker: plain script, never kept stale, a policy it can run under; the offline page in both languages, no scripts', async () => {
  const s = await start();
  try {
    const sw = await fetch(`${s.base}/sw.js`);
    assert.strictEqual(sw.status, 200);
    assert.match(sw.headers.get('content-type'), /javascript/);
    assert.strictEqual(sw.headers.get('cache-control'), 'no-cache');
    assert.doesNotMatch(sw.headers.get('content-security-policy'), /sandbox/);
    const code = await sw.text();
    assert.match(code, /mode !== 'navigate'/, 'only page openings are answered by the worker');
    assert.doesNotMatch(code, /cache\.put|cache\.addAll/, 'nothing but the offline page is kept');
    const off = await fetch(`${s.base}/offline`, { headers: { accept: 'text/html' } });
    assert.strictEqual(off.status, 200);
    const html = await off.text();
    assert.match(html, /مفيش اتصال بالإنترنت/);
    assert.match(html, /No internet connection/);
    assert.doesNotMatch(html, /<script/i);
  } finally { s.stop(); }
});

test('every shop page links the manifest and the home-screen name (not the Opening soon or offline pages)', () => {
  for (const f of fs.readdirSync(pub).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(pub, f), 'utf8');
    if (f === 'offline.html' || f === 'coming-soon.html') {
      assert.doesNotMatch(html, /rel="manifest"/, f);
      continue;
    }
    assert.match(html, /<link rel="manifest" href="\/site\.webmanifest/, f);
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="إبداع">/, f);
    assert.match(html, /<link rel="apple-touch-icon"/, f);
  }
});

test('the maskable icon: the whole brand mark (corner marks too) inside the safe circle every phone shows', async () => {
  const { data, info } = await sharp(path.join(pub, 'icon-maskable-512.png')).raw().toBuffer({ resolveWithObject: true });
  assert.strictEqual(info.width, 512);
  let far = 0;
  let dark = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] < 128) { dark++; far = Math.max(far, Math.hypot(x + 0.5 - 256, y + 0.5 - 256)); }
    }
  }
  assert.ok(dark > 5000, 'the mark is there');
  assert.ok(far <= 204.8, `farthest dark pixel ${far.toFixed(1)} px from the centre`);
  if (info.channels === 4) for (let i = 3; i < data.length; i += 4) assert.strictEqual(data[i], 255, 'no see-through pixels');
});

test('while the shop is private, the worker and the offline page still load (nothing of the shop in them)', async () => {
  const s = await start({ previewStart: true });
  try {
    assert.strictEqual((await fetch(`${s.base}/sw.js`)).status, 200);
    const off = await fetch(`${s.base}/offline`, { headers: { accept: 'text/html' } });
    assert.strictEqual(off.status, 200);
    assert.match(await off.text(), /No internet connection/);
    assert.strictEqual((await fetch(`${s.base}/site.webmanifest`)).status, 200);
    assert.strictEqual((await fetch(`${s.base}/icon-maskable-512.png`)).status, 200);
    assert.strictEqual((await fetch(`${s.base}/api/products`)).status, 403);
  } finally { s.stop(); }
});
