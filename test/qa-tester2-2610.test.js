'use strict';

// Tester 2 (7 pm Cairo, 26 Nov): a customer whose phone had already had a once-per-customer automatic offer could
// never order when their address had used up its few phone checks (the cart kept the offer, the order refused it as
// "prices changed" every time); a name from Google sign-in kept hidden direction marks; two copies of the app saving
// one account's cart or saved designs at the same moment lost items.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { createApp } = require('../src/app');

function png(width, height) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
const PRINT = png(1200, 1600);
const PREVIEW = png(60, 72);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
const OPEN = [{ max: 1e6, ms: 1000 }];
const OPEN_LIMITS = Object.fromEntries(['designs', 'designsAll', 'orders', 'couponTry', 'draftSave', 'accountSignup', 'accountLogin'].map((k) => [k, OPEN]));

async function mug(base, text = 'hi') {
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const { id, uploadToken, files } = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text }] } } } })).json();
  for (const name of files) await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body: name.endsWith('.svg') ? SVG : name.includes('print') ? PRINT : PREVIEW });
  return (await (await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } })).json()).id;
}

test('an offer this phone already had: after the order says so, the cart\'s price check uses the phone, and the order goes through', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t2-2610a-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const token = (await (await post('/api/admin/login', { password: 'secret-owner' })).json()).token;
    const c = await post('/api/admin/coupons', { code: 'ONCE15', type: 'percent', value: 20, auto: true, perCustomer: 1 }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(c.status, 201, await c.clone().text());
    const PHONE = '01055555555';
    const customer = { name: 'Sara Ahmed', phone: PHONE, governorate: 'giza', city: 'Dokki', address: '12 Tahrir St' };
    const a = await mug(base, 'first');
    const qa = await (await post('/api/cart/quote', { designIds: [a] })).json();
    assert.strictEqual(qa.coupon.code, 'ONCE15');
    assert.strictEqual((await post('/api/orders', { customer, designIds: [a], expectedTotal: qa.total })).status, 201);
    // This address has had its few phone checks today (one visitor, or many customers on one mobile network).
    const b = await mug(base, 'second');
    for (const other of ['01011111111', '01022222222', '01033333333']) await post('/api/cart/quote', { designIds: [b], phone: other });
    const before = await (await post('/api/cart/quote', { designIds: [b], phone: PHONE })).json();
    assert.strictEqual(before.coupon && before.coupon.code, 'ONCE15', 'the cart can\'t tell yet');
    // The order says the price is different for this phone…
    const refused = await post('/api/orders', { customer, designIds: [b], expectedTotal: before.total });
    assert.strictEqual(refused.status, 409);
    assert.strictEqual((await refused.json()).code, 'priceChanged');
    // …and the cart's next price check now knows: the real price, which orders.
    const after = await (await post('/api/cart/quote', { designIds: [b], phone: PHONE })).json();
    assert.strictEqual(after.coupon, null, JSON.stringify(after.coupon));
    assert.strictEqual(after.total, 250 + 75);
    const ok = await post('/api/orders', { customer, designIds: [b], expectedTotal: after.total });
    assert.strictEqual(ok.status, 201, await ok.clone().text());
    // Another phone's checks stay limited (only the one ordered with was let through).
    const other = await (await post('/api/cart/quote', { designIds: [await mug(base, 'third')], phone: '01044444444' })).json();
    assert.strictEqual(other.coupon && other.coupon.code, 'ONCE15');
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a name from Google sign-in loses hidden direction marks (as a typed one does)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t2-2610b-'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const oauthFetch = async () => {
    const claims = { iss: 'https://accounts.google.com', aud: 'cid', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, sub: 'g-77', email: 'mark@example.com', name: '‮evil‬ Name‏' };
    return new Response(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.sig` }), { status: 200 });
  };
  const app = createApp({ dataDir: dir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false, oauthConfig: { google: { clientId: 'cid', clientSecret: 'sec' }, facebook: null }, oauthFetch });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const B = `http://127.0.0.1:${srv.address().port}`;
  const get = (u, cookie) => fetch(B + u, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const cookies = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]);
  try {
    let r = await get('/auth/google');
    const state = new URL(r.headers.get('location')).searchParams.get('state');
    const sc = cookies(r).find((c) => c.startsWith('pod_o='));
    r = await get(`/auth/google/callback?code=c1&state=${state}`, sc);
    const session = cookies(r).find((c) => c.startsWith('pod_c='));
    const me = (await (await get('/api/account', session)).json()).customer;
    assert.strictEqual(me.name, 'evil Name');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A copy of the app in its own process on the shared data folder; resolves to its address. */
function copy(dataDir) {
  const code = `
    const { createApp } = require(${JSON.stringify(path.join(__dirname, '../src/app'))});
    const open = [{ max: 1e6, ms: 1000 }];
    const limits = Object.fromEntries(['designs', 'designsAll', 'orders', 'draftSave', 'accountSignup', 'accountLogin'].map((k) => [k, open]));
    const s = createApp({ dataDir: ${JSON.stringify(dataDir)}, adminPassword: 'secret', limits, cleanupEvery: 0, requireApproval: false }).listen(0, '127.0.0.1', () => console.log('PORT ' + s.address().port));`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /PORT (\d+)/.exec(out);
      if (m) resolve({ base: `http://127.0.0.1:${m[1]}`, child });
    });
    child.on('exit', (c) => reject(new Error(`copy exited ${c}`)));
  });
}

test('two copies of the app saving one account\'s cart and saved designs at the same moment lose nothing', { timeout: 120000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t2-2610c-'));
  const A = await copy(dataDir);
  const B = await copy(dataDir);
  try {
    const signup = await fetch(A.base + '/api/account/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mona Adel', phone: '01066667777', email: 'mona@example.com', password: 'Kite-Blue-2026-river' }) });
    assert.strictEqual(signup.status, 201, await signup.clone().text());
    const cookie = signup.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_c='));
    const put = (base, url, body) => fetch(base + url, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
    // The cart: each round, both devices add their own new item at once (each knowing the cart as it was).
    let known = [];
    for (let round = 0; round < 12; round++) {
      const [x, y] = await Promise.all([mug(A.base, `a${round}`), mug(B.base, `b${round}`)]);
      const base = known.map((k) => k.designId);
      const now = new Date().toISOString();
      const [ra, rb] = await Promise.all([
        put(A.base, '/api/account/cart', { base, items: [...known, { designId: x, addedAt: now }] }),
        put(B.base, '/api/account/cart', { base, items: [...known, { designId: y, addedAt: now }] }),
      ]);
      assert.strictEqual(ra.status, 200, await ra.clone().text());
      assert.strictEqual(rb.status, 200, await rb.clone().text());
      const stored = await (await fetch(A.base + '/api/account/cart', { headers: { cookie } })).json();
      const ids = (stored.items || stored).map((i) => i.designId);
      assert.ok(ids.includes(x) && ids.includes(y), `round ${round}: both kept (${ids.length} items)`);
      known = (stored.items || stored).map((i) => ({ designId: i.designId, addedAt: i.addedAt }));
    }
    // Saved designs: 10 pairs saved at once, one product each.
    const products = ['mug', 'tshirt', 'hoodie', 'poster', 'pillow', 'tote', 'cap', 'bottle', 'notebook', 'mousepad', 'canvas', 'apron', 'sweatshirt', 'kids-tshirt', 'phonecase', 'puzzle', 'magnets', 'flyers', 'menus', 'bizcards'];
    const catalog = (await (await fetch(A.base + '/api/products')).json());
    const known2 = new Set((catalog.products || catalog).map((p) => p.id));
    const list = products.filter((p) => known2.has(p)).slice(0, 20);
    assert.ok(list.length >= 16, `products: ${list.length}`);
    for (let i = 0; i + 1 < list.length; i += 2) {
      const body = { designs: { front: [] }, colorId: '', sizeId: '' };
      const [r1, r2] = await Promise.all([put(A.base, `/api/account/drafts/${list[i]}`, body), put(B.base, `/api/account/drafts/${list[i + 1]}`, body)]);
      assert.strictEqual(r1.status, 200, await r1.clone().text());
      assert.strictEqual(r2.status, 200, await r2.clone().text());
    }
    const drafts = await (await fetch(A.base + '/api/account/drafts', { headers: { cookie } })).json();
    const listed = (drafts.drafts || drafts).map((d) => d.productId);
    assert.strictEqual(listed.length, list.length - (list.length % 2), JSON.stringify(listed));
  } finally {
    A.child.kill();
    B.child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
