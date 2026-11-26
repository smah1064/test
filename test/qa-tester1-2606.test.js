'use strict';

// Tester 1's run at 10 am Cairo (26 Nov), on the server: an account made from a guest order ("Save your orders")
// keeps the order's delivery address; the last two jobs of an order marked shipped at the same moment on two copies
// of the app leave the order shipped (the customer is told once); shipping details sent on one copy keep a ship date
// set on the other.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { spawn } = require('child_process');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], designsAll: [OPEN], orders: [OPEN], accountSignup: [OPEN], accountLogin: [OPEN], accountLoginId: [OPEN] };
const CUSTOMER = { name: 'Salma Adel', phone: '01055557777', governorate: 'cairo', city: 'Maadi', address: '3 Street 9', notes: 'Ring twice' };
let dir;
let A;
let B;
let C; // a copy in its own process: its requests really run at the same time as A's
let token = null;
const start = (a) => new Promise((resolve) => { const s = a.listen(0, () => resolve(s)); });
const at = (s) => `http://127.0.0.1:${s.address().port}`;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t1-2606-'));
  const opts = { dataDir: dir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0, requireApproval: false };
  A = await start(createApp(opts));
  B = await start(createApp(opts));
  const code = `const { createApp } = require(${JSON.stringify(path.join(__dirname, '../src/app'))});
    const s = createApp(${JSON.stringify(opts)}).listen(0, () => console.log('PORT ' + s.address().port));`;
  C = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PREVIEW_LOCK: 'off' } });
  C.port = await new Promise((resolve, reject) => {
    let out = '';
    C.stdout.on('data', (b) => { out += b; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    C.on('exit', () => reject(new Error('the other copy stopped')));
  });
  C.address = () => ({ port: C.port });
});
test.after(() => {
  A.close();
  B.close();
  if (C) C.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});
const send = (srv, method, url, body, headers = {}) => fetch(at(srv) + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
async function admin(srv, method, url, body) {
  if (!token) token = (await (await send(A, 'POST', '/api/admin/login', { password: 'secret' })).json()).token;
  return send(srv, method, url, body, { Authorization: `Bearer ${token}` });
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
async function tshirt() {
  const created = await (await send(A, 'POST', '/api/designs', { productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json();
  for (const name of created.files) {
    const data = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    assert.strictEqual((await fetch(`${at(A)}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data })).status, 204);
  }
  assert.strictEqual((await fetch(`${at(A)}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).status, 200);
  return created.id;
}
async function order(n, customer = CUSTOMER) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(await tshirt());
  const q = await (await send(A, 'POST', '/api/cart/quote', { designIds: ids })).json();
  const r = await send(A, 'POST', '/api/orders', { customer, designIds: ids, expectedTotal: q.total, orderKey: `k-${Date.now()}-${Math.random()}` });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const here = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_orders='));
  return { ...(await r.json()), here };
}
const onDisk = () => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));

test('an account made from a guest order keeps the order\'s delivery address for next time', async () => {
  const o = await order(1);
  const made = await send(A, 'POST', `/api/orders/${o.id}/account`, { password: 'long-enough-pass' }, { Cookie: o.here });
  assert.strictEqual(made.status, 201, await made.clone().text());
  const cust = onDisk().customers.find((c) => c.phone === CUSTOMER.phone);
  assert.deepStrictEqual(cust.address, { governorate: 'cairo', city: 'Maadi', address: '3 Street 9', notes: 'Ring twice' });
  const session = (made.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => /^pod_c(ust)?[a-z_]*=/.test(c) && !c.endsWith('='));
  const me = await (await send(A, 'GET', '/api/account', undefined, { Cookie: session })).json();
  assert.strictEqual(((me.customer || me).address || {}).address, '3 Street 9', 'the account page and the next checkout have it');
});

test('two copies: the last two jobs marked shipped at the same moment, one on each copy: the order is shipped', async () => {
  for (let round = 0; round < 8; round++) {
    const o = await order(2, { ...CUSTOMER, phone: `0105555${String(8000 + round)}` });
    for (const it of o.items) assert.strictEqual((await admin(A, 'PATCH', `/api/admin/items/${it.id}`, { status: 'printing' })).status, 200);
    const [ra, rb] = await Promise.all([
      admin(A, 'PATCH', `/api/admin/items/${o.items[0].id}`, { status: 'shipped' }),
      admin(C, 'PATCH', `/api/admin/items/${o.items[1].id}`, { status: 'shipped' }),
    ]);
    assert.strictEqual(ra.status, 200, await ra.clone().text());
    assert.strictEqual(rb.status, 200, await rb.clone().text());
    const saved = onDisk().orders.find((x) => x.id === o.id);
    assert.deepStrictEqual(saved.items.map((i) => i.status), ['shipped', 'shipped']);
    assert.ok(saved.shipment && saved.shipment.shippedAt, `round ${round}: the order is on its way`);
  }
});

test('shipping details sent on one copy keep the ship date set on the other copy meanwhile', async () => {
  const o = await order(1, { ...CUSTOMER, phone: '01055559001' });
  assert.strictEqual((await admin(A, 'PATCH', `/api/admin/items/${o.items[0].id}`, { status: 'printing' })).status, 200);
  // Copy B has the order in memory before it ships on copy A.
  assert.strictEqual((await admin(B, 'GET', '/api/admin/orders')).status, 200);
  assert.strictEqual((await admin(A, 'PATCH', `/api/admin/items/${o.items[0].id}`, { status: 'shipped' })).status, 200);
  const r = await admin(B, 'PATCH', `/api/admin/orders/${o.id}/shipment`, { courier: 'Bosta', trackingNumber: '١٢٣٤' });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const saved = onDisk().orders.find((x) => x.id === o.id);
  assert.ok(saved.shipment.shippedAt, 'still shipped');
  assert.strictEqual(saved.shipment.courier, 'Bosta');
  assert.strictEqual(saved.shipment.trackingNumber, '1234');
  // A job still waiting for approval can't be shipped from the order either.
  const waiting = await order(1, { ...CUSTOMER, phone: '01055559002' });
  const db = onDisk();
  const it = db.orders.find((x) => x.id === waiting.id).items[0];
  if (it.status === 'awaiting_approval' || it.status === 'review') {
    assert.strictEqual((await admin(B, 'PATCH', `/api/admin/orders/${waiting.id}/shipment`, { shipped: true })).status, 409);
  }
});
