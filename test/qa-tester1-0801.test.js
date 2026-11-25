'use strict';

// QA tester 1 (25 Nov, 08:01–09:26): uploads are checked before they are read.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('../src/app');

test('a file sent to a made-up design is refused before its body is read (no memory held)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0801-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    // Says 100 MB, sends 1 KB and waits: the answer must come without the rest.
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'PUT', path: '/api/designs/00000000-0000-4000-8000-000000000000/files/front-print.png', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 100 * 1024 * 1024, 'X-Upload-Token': 'nope' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
        req.destroy();
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET' && e.code !== 'EPIPE') reject(e); });
      req.write(Buffer.alloc(1024));
      setTimeout(() => reject(new Error('no answer before the body was sent')), 4000);
    });
    assert.strictEqual(status, 404);
  } finally {
    server.closeAllConnections && server.closeAllConnections();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('packs count copies: sizes carry their copies, and quantity lines are marked as packs', async () => {
  const { PRODUCTS } = require('../src/products');
  const by = (id) => PRODUCTS.find((p) => p.id === id);
  assert.deepStrictEqual(by('bizcards').sizes.map((z) => z.copies), [100, 200, 300, 500, 1000]);
  assert.deepStrictEqual(by('booklets').sizes.filter((z) => z.family === '8').map((z) => z.copies), [1, 10, 25, 50, 100]);
  assert.deepStrictEqual(by('labels').sizes.slice(0, 2).map((z) => [z.family, z.copies]), [['50x30', 100], ['50x30', 250]]);
  // Window stickers are sizes in cm, photo books count photos, T-shirts aren't packs.
  for (const id of ['windowstickers', 'photobook', 'tshirt']) assert.ok(by(id).sizes.every((z) => z.copies === undefined), id);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0801p-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cat = await (await fetch(`${base}/api/products`)).json();
    assert.strictEqual(cat.products.find((p) => p.id === 'bizcards').sizes[1].copies, 200, 'the shop gets the copies');
    // 2 × 100 cards + 1 × 1000 cards: the lines say they are packs and how many cards each holds.
    const r = await fetch(`${base}/api/designs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 'bizcards', color: 'gloss', size: '100', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Mona' }] } } }, quantities: [{ color: 'gloss', size: '100', qty: 2 }, { color: 'gloss', size: '1000', qty: 1 }] }) });
    assert.strictEqual(r.status, 201);
    const { id } = await r.json();
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    const d = Array.isArray(db.designs) ? db.designs.find((x) => x.id === id) : db.designs[id];
    assert.deepStrictEqual(d.quantities.map((l) => [l.size.id, l.size.pack, l.size.copies, l.qty]), [['100', true, 100, 2], ['1000', true, 1000, 1]]);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rights requests: kept, listed newest first for the owner only, and marked handled', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0801t-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method, body, token) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    for (const name of ['Mona', 'Karim']) {
      assert.strictEqual((await call('/api/takedown', 'POST', { name, contact: 'mona@example.com', owner: 'Mona Studio', link: 'https://ebda3.me/design?id=x', details: 'This design copies my drawing.' })).status, 201);
    }
    assert.strictEqual((await call('/api/admin/takedowns', 'GET')).status, 401, 'not without signing in');
    const owner = (await (await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json()).token;
    const list = await (await call('/api/admin/takedowns', 'GET', undefined, owner)).json();
    assert.strictEqual(list.takedowns.length, 2);
    assert.strictEqual(list.open, 2);
    const one = list.takedowns[1];
    const done = await (await call(`/api/admin/takedowns/${one.id}`, 'PATCH', { status: 'done', note: 'Design deleted' }, owner)).json();
    assert.strictEqual(done.takedown.status, 'done');
    assert.strictEqual(done.takedown.note, 'Design deleted');
    assert.strictEqual((await (await call('/api/admin/takedowns', 'GET', undefined, owner)).json()).open, 1);
    assert.strictEqual((await call(`/api/admin/takedowns/${one.id}`, 'PATCH', { status: 'gone' }, owner)).status, 400);
    assert.strictEqual((await call('/api/admin/takedowns/nope', 'PATCH', { status: 'done' }, owner)).status, 404);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a shared fabric design keeps its repeat style and tile size (QA tester 2, 25 Nov)', async () => {
  const sharp = require('sharp');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0801s-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { PRODUCTS } = require('../src/products');
    const fabric = PRODUCTS.find((p) => p.pattern);
    const side = fabric.sides[0].id;
    const img = 'data:image/png;base64,' + (await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64');
    const post = (pattern) => fetch(`${base}/api/shares`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: fabric.id, color: fabric.colors[0].id, size: fabric.sizes[0].id, sides: { [side]: { objects: [{ type: 'i-text', text: 'x' }], pattern } }, previews: { [side]: img } }) }).then((r) => r.json());
    const sh = await post({ repeat: 'mirror', tileCm: 60 });
    const d = await (await fetch(`${base}/api/shares/${sh.id}/design`)).json();
    assert.deepStrictEqual(d.editor[side].pattern, { repeat: 'mirror', tileCm: 60 });
    // Made-up values fall back to the product's own.
    const odd = await post({ repeat: 'sideways', tileCm: 7 });
    assert.deepStrictEqual((await (await fetch(`${base}/api/shares/${odd.id}/design`)).json()).editor[side].pattern, { repeat: 'straight', tileCm: fabric.pattern.tile });
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('what the editor warned about (past the edge, embroidery) reaches the proof, worded in both languages', () => {
  const preflight = require('../src/preflight');
  const checks = [
    { id: 'cutEdge', level: 'warn', side: 'front', params: { name: 'Hello' } },
    { id: 'embSmallText', level: 'warn', side: 'emb', params: { name: 'Mona' } },
    { id: 'embColors', level: 'warn', side: 'emb', params: { n: 12, max: 6 } },
    { id: 'embPhoto', level: 'warn', side: 'emb', params: { name: 'photo.jpg' } },
    { id: 'embGradient', level: 'warn', side: 'emb', params: { name: 'Logo' } },
  ];
  const r = preflight.mergeClientChecks({ status: 'pass', checks: [] }, checks);
  assert.deepStrictEqual(r.checks.map((c) => c.id), checks.map((c) => c.id));
  assert.strictEqual(r.status, 'warn', 'not "ready to print, nothing to fix"');
  const strings = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');
  for (const c of checks) assert.match(strings, new RegExp(`'pf\\.${c.id}': \\['[^']+', '[^']+'\\]`), c.id);
  const editor = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'editor.js'), 'utf8');
  for (const k of ['check.cut', 'check.embSmallText', 'check.embPhoto', 'check.embGradient', 'check.embColorsN']) assert.ok(editor.includes(`i.key === '${k}'`), k);
});

test('links to a product, a ready design, a kids book and a shared design preview as themselves (WhatsApp)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0801o-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const meta = (html, prop) => [...html.matchAll(new RegExp(`<meta property="${prop}" content="([^"]*)">`, 'g'))].map((m) => m[1]);
  try {
    const product = await (await fetch(`${base}/product?id=mug`)).text();
    assert.strictEqual(meta(product, 'og:image').length, 1, 'one picture only (the general card is gone)');
    assert.match(meta(product, 'og:image')[0], /\/api\/thumbs\/mug\//);
    assert.match(meta(product, 'og:title')[0], /مج|Mug/);
    assert.match(product, /<title>[^<]*(مج|Mug)[^<]*<\/title>/);
    const lib = await (await fetch(`${base}/api/library`)).json();
    const d = lib.designs[0];
    const design = await (await fetch(`${base}/design?id=${encodeURIComponent(d.id)}`)).text();
    assert.ok(meta(design, 'og:title')[0].includes(d.name.en), meta(design, 'og:title')[0]);
    const book = await (await fetch(`${base}/book?b=space-hero`)).text();
    assert.match(meta(book, 'og:image')[0], /\/api\/books\/space-hero\/sample\/0\.jpg$/);
    // The child's name isn't known yet: "Your child in Space", never "{name} in Space".
    assert.ok(!meta(book, 'og:title')[0].includes('{name}') && meta(book, 'og:title')[0].includes('طفلك في الفضاء') && meta(book, 'og:title')[0].includes('Your child in Space'), meta(book, 'og:title')[0]);
    // A ready design drawn from words and shapes has no picture of its own here: the shop's card, not a blank product.
    const tpl = lib.designs.find((x) => x.kind === 'template');
    const tplPage = await (await fetch(`${base}/design?id=${encodeURIComponent(tpl.id)}`)).text();
    assert.match(meta(tplPage, 'og:image')[0], /og-ebda3\.png$/);
    // Unknown ids and other pages keep the general card; nothing typed in the address is echoed.
    const odd = await (await fetch(`${base}/product?id=%22%3E%3Cscript%3E`)).text();
    assert.match(meta(odd, 'og:image')[0], /og-ebda3\.png$/);
    assert.ok(!odd.includes('<script>"'), 'no echo');
    const home = await (await fetch(`${base}/`)).text();
    assert.match(meta(home, 'og:image')[0], /og-ebda3\.png$/);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
