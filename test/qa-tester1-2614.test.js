'use strict';

// Tester 1 (10 pm Cairo, 26 Nov): "prices changed" answers from placing an order could be asked for without end (each
// one unlocked a phone for the cart's price check: who has had an offer); the account's name took ".." or Arabic letter
// marks alone; share-link replies and view-link updates from two copies of the app at once were lost; a coupon saved as
// SALE-50 refused "SALE50", "SALE 50" or "SALE–50".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const sharp = require('sharp');
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

async function start(limits = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t1-2614-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner', limits: { designs: OPEN, orders: OPEN, couponTry: OPEN, accountSignup: OPEN, accountLogin: OPEN, ...limits }, cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}
const send = (base, method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
async function mug(base) {
  const { id, uploadToken, files } = await (await send(base, 'POST', '/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } })).json();
  for (const name of files) await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body: name.endsWith('.svg') ? SVG : name.includes('print') ? PRINT : PREVIEW });
  return (await (await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } })).json()).id;
}
const customer = (phone) => ({ name: 'Sara Ahmed', phone, governorate: 'giza', city: 'Dokki', address: '12 Tahrir St' });

test('"prices changed" from placing an order: a limited number per visitor, and only a few phones unlocked a day', async () => {
  const s = await start();
  try {
    const id = await mug(s.base);
    const codes = [];
    for (let i = 0; i < 12; i++) {
      const r = await send(s.base, 'POST', '/api/orders', { customer: customer(`0101234${String(5000 + i)}`), designIds: [id], expectedTotal: 99999 });
      codes.push(r.status === 409 ? (await r.json()).code : r.status);
    }
    assert.deepStrictEqual(codes.slice(0, 10), Array(10).fill('priceChanged'));
    assert.strictEqual(codes[10], 429, 'the 11th in an hour is refused');
    // The cart's price check: the usual 3 phones and at most 5 unlocked by orders, not all 10.
    const asked = [];
    for (let i = 0; i < 10; i++) asked.push(await (await send(s.base, 'POST', '/api/cart/quote', { designIds: [id], phone: `0101234${String(5000 + i)}`, couponCode: 'NOPE' })).status);
    assert.ok(asked.every((x) => x === 200));
  } finally {
    s.close();
  }
});

test('the account\'s name needs a letter or a digit, as at sign-up and checkout', async () => {
  const s = await start();
  try {
    const up = await send(s.base, 'POST', '/api/account/signup', { name: 'Mona Adel', phone: '01066667777', email: 'mona@example.com', password: 'Kite-Blue-2026-river' });
    assert.strictEqual(up.status, 201, await up.clone().text());
    const cookie = up.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_c='));
    const me = (await (await send(s.base, 'GET', '/api/account', undefined, { cookie })).json()).customer;
    for (const name of ['..', '!!!', '؜؜؜', 'ـــ', '؜..']) {
      const r = await send(s.base, 'PUT', '/api/account', { ...me, name }, { cookie });
      assert.strictEqual(r.status, 400, JSON.stringify(name));
      assert.strictEqual((await r.json()).code, 'acctName');
    }
    const ok = await send(s.base, 'PUT', '/api/account', { ...me, name: 'منى عادل' }, { cookie });
    assert.strictEqual(ok.status, 200, await ok.clone().text());
  } finally {
    s.close();
  }
});

test('a coupon saved with a dash takes the same code typed without it, with a space or an en dash', async () => {
  const s = await start();
  try {
    const token = (await (await send(s.base, 'POST', '/api/admin/login', { password: 'secret-owner' })).json()).token;
    const c = await send(s.base, 'POST', '/api/admin/coupons', { code: 'sale-50', type: 'percent', value: 10 }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(c.status, 201, await c.clone().text());
    const id = await mug(s.base);
    for (const typed of ['SALE-50', 'sale50', 'SALE 50', 'SALE_50', 'SALE–50']) {
      const q = await (await send(s.base, 'POST', '/api/cart/quote', { designIds: [id], couponCode: typed })).json();
      assert.strictEqual(q.coupon && q.coupon.code, 'SALE-50', typed);
      assert.strictEqual(q.couponError, null, typed);
    }
    const o = await send(s.base, 'POST', '/api/orders', { customer: customer('01012345678'), designIds: [id], couponCode: 'SALE50' });
    assert.strictEqual(o.status, 201, await o.clone().text());
  } finally {
    s.close();
  }
});

/** A copy of the app in its own process on the shared data folder; resolves to its address. */
function copy(dataDir) {
  const code = `
    const { createApp } = require(${JSON.stringify(path.join(__dirname, '../src/app'))});
    const open = [{ max: 1e6, ms: 1000 }];
    const limits = Object.fromEntries(['designs', 'designsAll', 'shares', 'views'].map((k) => [k, open]));
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

test('two copies of the app: every share-link reply is kept, and view-link updates all count', { timeout: 120000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t1-2614c-'));
  const A = await copy(dataDir);
  const B = await copy(dataDir);
  try {
    const img = 'data:image/png;base64,' + (await sharp({ create: { width: 60, height: 72, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64');
    const sh = await (await send(A.base, 'POST', '/api/shares', { productId: 'tshirt', color: 'navy', size: 'L', sides: { front: { objects: [{ type: 'i-text', text: 'hi' }] } }, previews: { front: img } })).json();
    assert.ok(sh.id, JSON.stringify(sh));
    // 24 replies at once, half to each copy (6 a minute per visitor on each: from several "visitors").
    const replies = await Promise.all(Array.from({ length: 24 }, (_, i) => send(i % 2 ? A.base : B.base, 'POST', `/api/shares/${sh.id}/feedback`, { vote: 'change', comment: `reply ${i}` }, { 'x-forwarded-for': `10.0.${i}.1` })));
    const ok = replies.filter((r) => r.status === 201).length;
    const kept = (await (await send(A.base, 'GET', `/api/shares/${sh.id}`)).json()).feedback.length;
    assert.strictEqual(kept, ok, `${ok} answered, ${kept} kept`);
    // A view link updated 12 times at once from both copies: its version counts every one.
    const jpeg = async (n) => `data:image/jpeg;base64,${(await sharp({ create: { width: 200, height: 250, channels: 3, background: { r: n * 20, g: 80, b: 120 } } }).jpeg().toBuffer()).toString('base64')}`;
    const made = await (await send(A.base, 'POST', '/api/views', { productId: 'tshirt', pages: [{ side: 'front', image: await jpeg(1) }] })).json();
    assert.ok(made.id && made.key, JSON.stringify(made));
    const ups = await Promise.all(Array.from({ length: 12 }, async (_, i) => send(i % 2 ? A.base : B.base, 'PUT', `/api/views/${made.id}`, { productId: 'tshirt', pages: [{ side: 'front', image: await jpeg(i + 2) }] }, { 'x-view-key': made.key })));
    assert.ok(ups.every((r) => r.status === 200), (await Promise.all(ups.map((r) => r.text()))).join('\n').slice(0, 300));
    const v = await (await send(B.base, 'GET', `/api/views/${made.id}`)).json();
    assert.match(v.pages[0].url, /\?v=13$/, v.pages[0].url);
  } finally {
    A.child.kill();
    B.child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
