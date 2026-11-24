'use strict';

// After the order: tracking timeline and shipping details, order again
// (exact copies), payment status, invoices' data and drafts kept on the account.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN], reorder: [OPEN], draftSave: [OPEN], accountSignup: [OPEN], accountLogin: [OPEN], accountLoginId: [OPEN] };
const CUSTOMER = { name: 'منى علي', phone: '01011112222', governorate: 'giza', city: 'الدقي', address: '5 شارع النيل', email: 'mona@example.com' };
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-after-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const json = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
let token = null;
async function admin(method, url, body) {
  if (!token) token = (await (await json('POST', '/api/admin/login', { password: 'secret' })).json()).token;
  return json(method, url, body, { Authorization: `Bearer ${token}` });
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();

async function makeDesign(cookie) {
  const res = await json('POST', '/api/designs', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } }, cookie ? { Cookie: cookie } : {});
  assert.strictEqual(res.status, 201, await res.clone().text());
  const { id, uploadToken, files } = await res.json();
  for (const name of files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    const up = await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken }, body });
    assert.strictEqual(up.status, 204);
  }
  const done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 200);
  return id;
}

test('tracking, shipping details, delivery, payment and order again', async () => {
  const signup = await json('POST', '/api/account/signup', { name: 'Mona', phone: '01011112222', email: 'mona@example.com', password: 'longenough1' });
  assert.strictEqual(signup.status, 201, await signup.clone().text());
  const cookie = signup.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_c='));
  const ids = [await makeDesign(cookie), await makeDesign(cookie)];
  const q = await (await json('POST', '/api/cart/quote', { designIds: ids })).json();
  const o = await json('POST', '/api/orders', { customer: CUSTOMER, designIds: ids, expectedTotal: q.total }, { Cookie: cookie });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const order = await o.json();

  // A new order: placed, nothing else yet; invoice number and shop details for the invoice.
  let got = await (await fetch(`${base}/api/orders/${order.id}`)).json();
  assert.strictEqual(got.status, 'received');
  assert.deepStrictEqual(got.timeline.map((x) => x.step), ['placed', 'production', 'printed', 'shipped', 'delivered']);
  assert.ok(got.timeline[0].at && got.timeline.slice(1).every((x) => x.at === null));
  assert.strictEqual(got.invoice.number, `INV-${order.number}`);
  assert.strictEqual(got.shop.name.en, 'OneOff Print');
  assert.strictEqual(got.items[0].unitPrice, got.items[0].price);
  assert.strictEqual(got.shipment, null);
  assert.strictEqual(got.payment.status, 'pending');
  // In the account's order history.
  const mine = await (await fetch(base + '/api/account/orders', { headers: { Cookie: cookie } })).json();
  assert.strictEqual(mine.orders[0].id, order.id);

  // Production steps.
  for (const it of order.items) assert.strictEqual((await admin('PATCH', `/api/admin/items/${it.id}`, { status: 'printing' })).status, 200);
  got = await (await fetch(`${base}/api/orders/${order.id}`)).json();
  assert.strictEqual(got.status, 'in_production');
  assert.ok(got.timeline[1].at);
  assert.strictEqual(got.timeline[2].at, null);

  // Shipping details; a bad link is refused.
  assert.strictEqual((await admin('PATCH', `/api/admin/orders/${order.id}/shipment`, { trackingUrl: 'javascript:alert(1)' })).status, 400);
  let r = await admin('PATCH', `/api/admin/orders/${order.id}/shipment`, { courier: 'Bosta', trackingNumber: 'BX123', trackingUrl: 'https://bosta.co/track/BX123', eta: '2026-12-01' });
  assert.strictEqual(r.status, 200);
  // The last item marked shipped ships the order.
  for (const it of order.items) await admin('PATCH', `/api/admin/items/${it.id}`, { status: 'shipped' });
  got = await (await fetch(`${base}/api/orders/${order.id}`)).json();
  assert.strictEqual(got.status, 'shipped');
  assert.strictEqual(got.shipment.courier, 'Bosta');
  assert.strictEqual(got.shipment.trackingNumber, 'BX123');
  assert.strictEqual(got.shipment.eta, '2026-12-01');
  assert.ok(got.shipment.shippedAt && got.timeline[3].at && got.timeline[2].at);
  // Delivered, and paid on delivery.
  r = await admin('PATCH', `/api/admin/orders/${order.id}/shipment`, { delivered: true });
  assert.strictEqual((await r.json()).status, 'delivered');
  assert.strictEqual((await admin('PATCH', `/api/admin/orders/${order.id}/payment`, { status: 'paid' })).status, 200);
  got = await (await fetch(`${base}/api/orders/${order.id}`)).json();
  assert.strictEqual(got.status, 'delivered');
  assert.ok(got.timeline[4].at);
  assert.strictEqual(got.payment.status, 'paid');
  assert.strictEqual((await admin('PATCH', `/api/admin/orders/${order.id}/payment`, { status: 'free' })).status, 400);

  // Order again: exact copies with their own files, ready for the cart, at today's prices.
  r = await json('POST', `/api/orders/${order.id}/reorder`);
  assert.strictEqual(r.status, 200);
  const again = await r.json();
  assert.strictEqual(again.items.length, 2);
  assert.deepStrictEqual(again.skipped, []);
  for (const [i, entry] of again.items.entries()) {
    assert.notStrictEqual(entry.designId, ids[i]);
    assert.strictEqual(entry.price, got.items[i].price);
    const orig = fs.readFileSync(path.join(dataDir, 'files', ids[i], 'front-print.png'));
    const copy = fs.readFileSync(path.join(dataDir, 'files', entry.designId, 'front-print.png'));
    assert.ok(orig.equals(copy), 'same print file');
    assert.strictEqual((await fetch(base + entry.previewUrl)).status, 200);
  }
  // The copies can be ordered like any new design.
  const q2 = await (await json('POST', '/api/cart/quote', { designIds: again.items.map((x) => x.designId) })).json();
  assert.ok(q2.items.every((x) => !x.gone));
  const o2 = await json('POST', '/api/orders', { customer: CUSTOMER, designIds: again.items.map((x) => x.designId), expectedTotal: q2.total });
  assert.strictEqual(o2.status, 201, await o2.clone().text());
  assert.strictEqual((await json('POST', '/api/orders/00000000-0000-4000-8000-000000000000/reorder')).status, 404);
});

test('drafts kept on the account (open on another device)', async () => {
  const signup = await json('POST', '/api/account/signup', { name: 'Omar', phone: '01033334444', password: 'longenough1' });
  const cookie = signup.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_c='));
  const H = { Cookie: cookie };
  assert.strictEqual((await json('GET', '/api/account/drafts')).status, 401);
  assert.strictEqual((await json('PUT', '/api/account/drafts/tshirt', { designs: {} })).status, 401);
  const preview = 'data:image/png;base64,' + (await png(40, 48)).toString('base64');
  const draft = { productId: 'tshirt', colorId: 'black', sizeId: 'L', side: 'front', designs: { front: [{ type: 'i-text', text: 'مرحبا' }] }, offsets: {}, method: 'print', previewDataUrl: preview };
  let r = await json('PUT', '/api/account/drafts/tshirt', draft, H);
  assert.strictEqual(r.status, 200);
  const { savedAt } = await r.json();
  assert.ok(savedAt);
  assert.strictEqual((await json('PUT', '/api/account/drafts/not-a-product', draft, H)).status, 404);
  // Another device: the list and the draft itself.
  const list = await (await json('GET', '/api/account/drafts', undefined, H)).json();
  assert.strictEqual(list.drafts.length, 1);
  assert.strictEqual(list.drafts[0].productId, 'tshirt');
  assert.strictEqual(list.drafts[0].sizeId, 'L');
  assert.strictEqual((await fetch(base + list.drafts[0].previewUrl, { headers: H })).status, 200);
  const back = await (await json('GET', '/api/account/drafts/tshirt', undefined, H)).json();
  assert.strictEqual(back.designs.front[0].text, 'مرحبا');
  assert.strictEqual(back.savedAt, savedAt);
  assert.strictEqual(back.previewDataUrl, undefined);
  // Someone else's account does not see it.
  const other = await json('POST', '/api/account/signup', { name: 'Youssef', phone: '01055556660', password: 'longenough1' });
  const oc = other.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_c='));
  assert.strictEqual((await (await json('GET', '/api/account/drafts', undefined, { Cookie: oc })).json()).drafts.length, 0);
  assert.strictEqual((await json('GET', '/api/account/drafts/tshirt', undefined, { Cookie: oc })).status, 404);
  // Deleted (when it goes into the cart, or by the customer).
  assert.strictEqual((await json('DELETE', '/api/account/drafts/tshirt', undefined, H)).status, 204);
  assert.strictEqual((await (await json('GET', '/api/account/drafts', undefined, H)).json()).drafts.length, 0);
  assert.strictEqual((await json('GET', '/api/account/drafts/tshirt', undefined, H)).status, 404);
});

test('admin: an order still in review cannot be marked shipped; delivery dates must be real; Arabic digits find customers', async () => {
  const { createApp: make } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-ship-gate-'));
  const app = make({ dataDir: dir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false, limits: { designs: [{ max: 1e6, ms: 1000 }], orders: [{ max: 1e6, ms: 1000 }] } });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const p = (url, body, headers = {}) => fetch(b + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const sharp = require('sharp');
    const c = await (await p('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } }, quantities: [{ color: 'white', size: '11oz', qty: 60 }] })).json();
    for (const name of c.files) {
      const data = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1050 : 52, channels: 4, background: '#c33' } }).png().toBuffer();
      await fetch(`${b}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: data });
    }
    const d = await (await fetch(`${b}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } })).json();
    const proof = await (await fetch(`${b}/api/designs/${d.id}/proof`)).json();
    const q = await (await p('/api/cart/quote', { designIds: [d.id] })).json();
    const order = await (await p('/api/orders', { customer: { name: 'منى', phone: '01012345678', governorate: 'cairo', city: 'نصر', address: '1' }, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json();
    assert.strictEqual(order.items[0].status, 'review', '60 mugs: checked by hand first');
    const { token } = await (await p('/api/admin/login', { password: 'secret' })).json();
    const ship = (body) => fetch(`${b}/api/admin/orders/${order.id}/shipment`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.strictEqual((await ship({ delivered: true })).status, 409);
    assert.strictEqual((await ship({ shipped: true })).status, 409);
    assert.strictEqual((await ship({ eta: '2026-02-30' })).status, 400);
    assert.strictEqual((await ship({ eta: '2026-12-01' })).status, 200);
    assert.strictEqual((await p('/api/account/signup', { name: 'Mona Ali', phone: '01012345678', password: 'a-long-password-1' })).status, 201);
    const found = await (await fetch(`${b}/api/admin/customers?q=${encodeURIComponent('٠١٠١٢')}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.ok((found.customers || []).length >= 1 || found.total >= 1, JSON.stringify(found).slice(0, 200));
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('admin: review actions only on jobs in review; bad dates, formats and costs are refused (no 500s)', async () => {
  const { createApp: make } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-admin-guards-'));
  const app = make({ dataDir: dir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false, limits: { designs: [{ max: 1e6, ms: 1000 }], orders: [{ max: 1e6, ms: 1000 }] } });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const p = (url, body, headers = {}) => fetch(b + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const sharp = require('sharp');
    const c = await (await p('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } })).json();
    for (const name of c.files) {
      const data = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1050 : 52, channels: 4, background: '#c33' } }).png().toBuffer();
      await fetch(`${b}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: data });
    }
    const d = await (await fetch(`${b}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } })).json();
    const q = await (await p('/api/cart/quote', { designIds: [d.id] })).json();
    const order = await (await p('/api/orders', { customer: { name: 'منى', phone: '01012345678', governorate: 'cairo', city: 'نصر', address: '1' }, designIds: [d.id], expectedTotal: q.total })).json();
    const { token } = await (await p('/api/admin/login', { password: 'secret' })).json();
    const H = { Authorization: `Bearer ${token}` };
    const json = (method, url, body) => fetch(b + url, { method, headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify(body) });
    assert.strictEqual((await json('PATCH', `/api/admin/orders/${order.id}/shipment`, { shipped: true })).status, 200);
    const rv = await json('POST', `/api/admin/items/${order.items[0].id}/review`, { action: 'approve' });
    assert.strictEqual(rv.status, 409);
    assert.strictEqual((await rv.json()).code, 'notInReview');
    assert.strictEqual((await json('PATCH', `/api/admin/orders/${order.id}/shipment`, { eta: '2026-13-01' })).status, 400);
    assert.strictEqual((await fetch(`${b}/api/admin/files/${d.id}/front?format[]=png`, { headers: H })).status, 404);
    assert.strictEqual((await json('PATCH', `/api/admin/orders/${order.id}/shipping-cost`, { actualShipping: true })).status, 400);
    assert.strictEqual((await json('PATCH', `/api/admin/items/${order.items[0].id}/cost`, { actualCost: [5] })).status, 400);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
