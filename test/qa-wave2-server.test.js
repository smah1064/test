'use strict';

// QA report of 25 Nov (second wave), the server's part:
// - the cart's subtotal (and so free shipping and coupons) counts only items that can be ordered;
// - a shared design keeps its options (a booklet's binding), so "Open a copy" starts from them;
// - a PDF longer than the booklets: its first pages and its LAST page come back (the back cover).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const { createApp } = require('../src/app');
const { PRODUCTS, printWidthFor } = require('../src/products');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa-wave2-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await (await post('/api/admin/login', { password: 'secret-owner-pass' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const req = (method, url, body, token) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (url, body, token) => req('POST', url, body, token);
const byId = (id) => PRODUCTS.find((p) => p.id === id);

async function makeDesign(id) {
  const p = byId(id);
  const sz = p.sizes.find((z) => !z.soldOut && !z.off);
  const side = p.sides[0];
  const res = await post('/api/designs', { productId: id, color: p.colors.find((c) => !c.soldOut && !c.off).id, size: sz.id, sides: { [side.id]: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const created = await res.json();
  for (const name of created.files) {
    let body;
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    else if (name.includes('print')) {
      const wIn = printWidthFor(p, side, sz.id) + 2 * (side.bleedIn || 0);
      const hIn = (printWidthFor(p, side, sz.id) * side.printArea.h) / side.printArea.w + 2 * (side.bleedIn || 0);
      body = await sharp({ create: { width: Math.round(wIn * 100), height: Math.round(hIn * 100), channels: 4, background: '#2050c0' } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

test('the cart subtotal leaves out items that can\'t be ordered right now', async () => {
  const mug = await makeDesign('mug');
  const tote = await makeDesign('tote');
  const quote = async () => (await post('/api/cart/quote', { designIds: [mug.id, tote.id] })).json();
  const both = await quote();
  assert.ok(both.items.every((i) => !i.unavailable));
  assert.strictEqual(both.subtotal, Math.round((both.items[0].price + both.items[1].price) * 100) / 100);
  const r = await req('PUT', '/api/admin/catalog/mug', { status: 'hidden', hiddenReason: 'season' }, owner);
  assert.strictEqual(r.status, 200, await r.clone().text());
  const one = await quote();
  const m = one.items.find((i) => i.designId === mug.id);
  const t = one.items.find((i) => i.designId === tote.id);
  assert.ok(m.unavailable, 'the paused mug is flagged');
  assert.strictEqual(one.subtotal, t.price, 'only the tote counts');
  assert.strictEqual(one.total, Math.round((t.price - one.discount + one.shipping) * 100) / 100);
  await req('PUT', '/api/admin/catalog/mug', { status: 'live' }, owner);
});

test('a shared booklet keeps its binding for "Open a copy"', async () => {
  const preview = 'data:image/png;base64,' + (await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer()).toString('base64');
  const p = byId('booklets');
  const side = p.sides[0].id;
  const share = async (options) => {
    const res = await post('/api/shares', { productId: 'booklets', color: p.colors[0].id, size: p.sizes[0].id, options, sides: { [side]: { objects: [{ type: 'i-text', text: 'Cover' }] } }, previews: { [side]: preview } });
    assert.strictEqual(res.status, 201, await res.clone().text());
    return (await (await fetch(`${base}/api/shares/${(await res.json()).id}/design`)).json());
  };
  const left = await share({ binding: 'left' });
  assert.strictEqual(left.options.binding.id, 'left');
  // The binding is kept either way (it is shown on the cart, proof, order and admin).
  const right = await share({ binding: 'right' });
  assert.strictEqual(right.options.binding.id, 'right');
  // Unknown options are simply left out (a share is not an order).
  const odd = await share({ binding: 'diagonal', glitter: 'yes' });
  assert.ok(!odd.options);
});

function pdf(n) {
  return new Promise((resolve) => {
    const d = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    for (let i = 0; i < n; i++) {
      // The last page is square and green, the others A5 in red / blue.
      d.addPage({ size: i === n - 1 ? [500, 500] : [420, 595], margin: 0 });
      d.rect(0, 0, 600, 600).fill(i === n - 1 ? '#2f9e44' : i % 2 ? '#1c7ed6' : '#e03131');
    }
    d.end();
  });
}

test('a PDF longer than asked: its first pages and its last one (for the back cover)', async () => {
  const res = await fetch(`${base}/api/artwork/pages`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-page-w': '420', 'x-page-h': '595', 'x-max-pages': '4' }, body: await pdf(7) });
  assert.strictEqual(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.strictEqual(body.count, 7);
  assert.strictEqual(body.more, true);
  assert.strictEqual(body.pages.length, 4);
  assert.deepStrictEqual(body.pageNums, [0, 1, 2, 6]);
  const last = await sharp(Buffer.from(body.pages[3].split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.ok(Math.abs(last.info.width / last.info.height - 1) < 0.02, 'the 4th picture is the square last page');
  const mid = (Math.floor(last.info.height / 2) * last.info.width + Math.floor(last.info.width / 2)) * last.info.channels;
  assert.ok(last.data[mid + 1] > 120 && last.data[mid] < 90, 'and it is the green one');
  // Its box is kept by its page number, as the print files look it up (boxes[page]).
  assert.ok(body.boxes[6] && body.boxes[6].w === 500 && body.boxes[6].h === 500);
  assert.strictEqual(body.boxes[4], null);
  const kept = JSON.parse(fs.readFileSync(path.join(dataDir, 'pdf-uploads', `${body.pdfId}.json`), 'utf8'));
  assert.deepStrictEqual(kept.boxes[6], body.boxes[6]);
});

test('booklet PDFs: a daily budget for the whole shop, so the disk can\'t be filled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-pdfbudget-'));
  const app = createApp({ dataDir: dir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false, limits: { pdfPagesMB: 2 } });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}/api/artwork/pages`;
    const send = async () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-page-w': '420', 'x-page-h': '595', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 200)}` }, body: await pdf(1) });
    assert.strictEqual((await send()).status, 200);
    assert.strictEqual((await send()).status, 200);
    assert.strictEqual((await send()).status, 429, 'over the shop\'s 2 MB for today');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
