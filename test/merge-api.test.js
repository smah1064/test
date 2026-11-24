'use strict';

// Name lists (variable data): spreadsheet upload, a design with one copy per
// row, the price for every copy, and the print files (one PDF, a ZIP, the list).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { readZip } = require('../src/merge-data');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN], mergeParse: [OPEN] };
const CUSTOMER = { name: 'سارة أحمد', phone: '01012345678', governorate: 'giza', city: 'الدقي', address: '12 شارع التحرير' };
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-merge-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let token = null;
async function admin(url) {
  if (!token) token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  return fetch(base + url, { headers: { Authorization: `Bearer ${token}` } });
}
const solid = (w, h, rgba) => sharp({ create: { width: w, height: h, channels: 4, background: rgba } }).png().toBuffer();
const pages = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

// Invitation front: 5.12 in wide + 0.08 in bleed each side, at 300 DPI.
const W = Math.round((5.12 + 0.16) * 300);
const H = Math.round(((5.12 * 280) / 200 + 0.16) * 300);
const BOX = { x: 200, y: 900, w: 1100, h: 200 };
const ROWS = [['Ahmed Ali', 'Manager'], ['منى حسن', 'مهندسة'], ['Omar', '']];

test('spreadsheet upload: columns and rows', async () => {
  const csv = '﻿Name,Title\r\nAhmed Ali,Manager\r\n"منى حسن",مهندسة\r\n\r\nOmar,\r\n';
  const res = await fetch(base + '/api/merge/parse', { method: 'POST', body: Buffer.from(csv) });
  assert.strictEqual(res.status, 200);
  const t = await res.json();
  assert.deepStrictEqual(t.columns, ['Name', 'Title']);
  assert.deepStrictEqual(t.rows, ROWS);
  assert.strictEqual(t.total, 3);
  const bad = await fetch(base + '/api/merge/parse', { method: 'POST', body: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]) });
  assert.strictEqual(bad.status, 400);
  assert.match((await bad.json()).error, /xlsx|إكسل/);
});

test('name list design: one copy per row, priced per copy, print files for every name', async () => {
  const sides = { front: { editor: { objects: [{ type: 'i-text', text: 'Dear {Name}' }] } } };
  const merge = { columns: ['Name', 'Title'], rows: ROWS, sides: { front: { box: BOX } } };

  // Only the products that offer name lists.
  const no = await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides, merge });
  assert.strictEqual(no.status, 400);
  // The fields must be on a side that is printed.
  const badSide = await post('/api/designs', { productId: 'invitations', color: 'matte', size: '13x18', sides, merge: { ...merge, sides: { back: { box: BOX } } } });
  assert.strictEqual(badSide.status, 400);

  const res = await post('/api/designs', { productId: 'invitations', color: 'matte', size: '13x18', sides, merge });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const { id, uploadToken, files } = await res.json();
  assert.ok(files.includes('front-merge-base.png') && files.includes('front-merge.bin'));
  const put = (name, body) => fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken }, body });
  const print = await solid(W, H, { r: 250, g: 240, b: 220, alpha: 1 });
  const pics = await Promise.all(ROWS.map((_, i) => solid(BOX.w, BOX.h, { r: 40 * i, g: 20, b: 120, alpha: 0.9 })));
  for (const name of files) {
    let body = await solid(60, 72, { r: 255, g: 255, b: 255, alpha: 1 });
    if (name === 'front-print.png' || name === 'front-merge-base.png') body = print;
    if (name === 'front-merge.bin') body = Buffer.concat(pics.slice(0, 2)); // one picture missing
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.strictEqual((await put(name, body)).status, 204, name);
  }
  // A picture missing: not accepted; with all three it is.
  let done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 400);
  assert.strictEqual((await put('front-merge.bin', Buffer.concat(pics))).status, 204);
  done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  const d = await done.json();
  assert.strictEqual(d.merge.count, 3);
  assert.strictEqual(d.price, 105); // 35 per card x 3

  // Reopening the design brings the list back.
  const again = await (await fetch(`${base}/api/designs/${id}`)).json();
  assert.deepStrictEqual(again.mergeList.rows, ROWS);

  // Cart and order: every copy is paid for.
  const q = await (await post('/api/cart/quote', { designIds: [id] })).json();
  assert.strictEqual(q.items[0].price, 105);
  const o = await post('/api/orders', { customer: CUSTOMER, designIds: [id], expectedTotal: q.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const order = await o.json();
  assert.strictEqual(order.items[0].copies, 3);
  assert.strictEqual(order.items[0].price, 105);

  // Print files: one PDF with a page per copy, one PDF per copy in a ZIP, the list.
  const pdfRes = await admin(`/api/admin/files/${id}/front?format=merge-pdf`);
  assert.strictEqual(pdfRes.status, 200);
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  assert.strictEqual(pages(pdf), 3);
  // The background is embedded once, not once per page.
  const images = (pdf.toString('latin1').match(/\/Subtype \/Image/g) || []).length;
  assert.ok(images <= 1 + 3 * 2, `images: ${images}`);
  const marks = Buffer.from(await (await admin(`/api/admin/files/${id}/front?format=merge-pdf-marks`)).arrayBuffer());
  assert.strictEqual(pages(marks), 3);
  const zipRes = await admin(`/api/admin/files/${id}/front?format=merge-zip`);
  assert.strictEqual(zipRes.status, 200);
  const zip = readZip(Buffer.from(await zipRes.arrayBuffer()));
  assert.deepStrictEqual([...zip.keys()], ['0001-Ahmed-Ali.pdf', '0002-منى-حسن.pdf', '0003-Omar.pdf']);
  for (const one of zip.values()) assert.strictEqual(pages(one), 1);
  const csv = Buffer.from(await (await admin(`/api/admin/files/${id}/front?format=merge-csv`)).arrayBuffer()).toString('utf8');
  assert.ok(csv.startsWith('﻿#,Name,Title'));
  assert.ok(csv.includes('2,منى حسن,مهندسة'));
  // An ordinary design has no name-list files.
  assert.strictEqual((await admin(`/api/admin/files/${id}/front?format=merge-nope`)).status, 404);
});
