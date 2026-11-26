'use strict';

// Tester 2's run at 1 pm Cairo (26 Nov): "Order again" makes the print PDFs again for the new order (they carried
// the old order's number); a staff password of Arabic or Persian digits only is refused like 0-9; deleting a coupon or
// a printing house that is already gone says so instead of "done".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const passwords = require('../src/passwords');

const OPEN = { max: 1e6, ms: 1000 };
const CUSTOMER = { name: 'Salma Adel', phone: '01055558888', governorate: 'cairo', city: 'Maadi', address: '3 Street 9' };
let dir;
let server;
let base;
let token = null;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t2-2607-'));
  const app = createApp({ dataDir: dir, adminPassword: 'secret', limits: { designs: [OPEN], designsAll: [OPEN], orders: [OPEN], reorder: [OPEN], reorderOrder: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const send = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
async function admin(method, url, body) {
  if (!token) token = (await (await send('POST', '/api/admin/login', { password: 'secret' })).json()).token;
  return send(method, url, body, { Authorization: `Bearer ${token}` });
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();

test('"Order again": the copy\'s print PDFs are made again for the new order, not copied with the old number', async () => {
  const created = await (await send('POST', '/api/designs', { productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json();
  for (const name of created.files) {
    const data = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
  }
  assert.strictEqual((await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).status, 200);
  const q = await (await send('POST', '/api/cart/quote', { designIds: [created.id] })).json();
  const order = await (await send('POST', '/api/orders', { customer: CUSTOMER, designIds: [created.id], expectedTotal: q.total })).json();
  for (const fmt of ['pdf', 'pdf-marks']) assert.strictEqual((await admin('GET', `/api/admin/files/${created.id}/front?format=${fmt}`)).status, 200, fmt);
  assert.ok(fs.existsSync(path.join(dir, 'files', created.id, 'front-print.pdf')), 'the first order\'s PDF was made');
  const again = await (await send('POST', `/api/orders/${order.id}/reorder`, {}, { 'x-order-key': order.key })).json();
  const copyId = again.items[0].designId;
  const copied = fs.readdirSync(path.join(dir, 'files', copyId));
  assert.ok(copied.includes('front-print.png'), 'the print picture is copied');
  assert.ok(!copied.some((f) => /-print(-marks)?\.pdf$/.test(f)), `no PDF with the old number: ${copied}`);
});

test('a staff password of Arabic or Persian digits only is refused, as 0-9 is', () => {
  const who = { username: 'mona', name: 'Mona Ali' };
  for (const pw of ['١٢٣٤٥٦٧٨٩٠١٢', '۱۲۳۴۵۶۷۸۹۰۱۲', '123456789012']) assert.strictEqual(passwords.staffPassword(pw, who), false, pw);
  for (const pw of ['Nile-river-2026', 'نهر النيل ٢٠٢٦ أخضر']) assert.strictEqual(passwords.staffPassword(pw, who), true, pw);
});

test('deleting a coupon or a printing house that is already gone: 404, not "done"', async () => {
  const r1 = await admin('DELETE', '/api/admin/coupons/no-such-coupon');
  assert.strictEqual(r1.status, 404);
  assert.strictEqual((await r1.json()).code, 'couponGone');
  const r2 = await admin('DELETE', '/api/admin/houses/no-such-house');
  assert.strictEqual(r2.status, 404);
  assert.strictEqual((await r2.json()).code, 'houseNotFound');
});
