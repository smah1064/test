'use strict';

// Coupon codes typed with Arabic phone keyboards: "EID٢٠" (Arabic-Indic digits), "EID۲۰" (Persian digits)
// and "ＥＩＤ２０" (full-width) are the code "EID20", at checkout and in the admin.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createApp } = require('../src/app');
const coupons = require('../src/coupons');

/** Build a tiny valid RGBA PNG of the given size. */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SIDE = { editor: { objects: [{ type: 'i-text', text: 'hi' }] } };
const PRINT = png(3600, 4800);
const PREVIEW = png(60, 72);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
const OPEN_LIMITS = { designs: [{ max: 1e6, ms: 1000 }], orders: [{ max: 1e6, ms: 1000 }], shares: [{ max: 1e6, ms: 1000 }] };
const CUSTOMER = { name: 'سارة أحمد', phone: '٠١٠ ١٢٣٤ ٥٦٧٨', governorate: 'giza', city: 'الدقي', address: '12 شارع التحرير، الدور 3' };

let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-test-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: OPEN_LIMITS, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let adminToken = null;
const admin = async (url, options = {}) => {
  if (!adminToken) {
    const res = await post('/api/admin/login', { password: 'secret' });
    adminToken = (await res.json()).token;
  }
  return fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, ...(options.headers || {}) } });
};
const mk = (body) => admin('/api/admin/coupons', { method: 'POST', body: JSON.stringify(body) });

/** Create a design the way the editor does: layout, then files, then complete. */
async function makeDesign() {
  const res = await post('/api/designs', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: SIDE } });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const { id, uploadToken, files } = await res.json();
  for (const name of files) {
    const body = name.endsWith('.svg') ? SVG : name.includes('print') ? PRINT : PREVIEW;
    const up = await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body });
    assert.strictEqual(up.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

// The ways a customer types EID20 on a phone.
const TYPED = [
  'EID20', 'eid20', ' e i d 2 0 ',
  'EID٢٠', // Arabic-Indic digits (Arabic phone keyboards)
  'eid٢٠',
  'EID۲۰', // Persian digits
  'ＥＩＤ２０', // full-width
  'ｅｉｄ\u3000２０', // full-width, with an ideographic space
  'EID٢0', // mixed
  '\u200fEID٢٠\u200f', // pasted from a chat, with right-to-left marks
];

test('normCode: Arabic, Persian and full-width digits and letters are the English ones', () => {
  for (const s of TYPED) assert.strictEqual(coupons.normCode(s), 'EID20', JSON.stringify(s));
  assert.strictEqual(coupons.normCode('ＳＵＭＭＥＲ＿２０２６'), 'SUMMER_2026');
  assert.strictEqual(coupons.normCode('new-٠١٢٣٤٥٦٧٨٩'), 'NEW-0123456789');
  assert.strictEqual(coupons.normCode('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.strictEqual(coupons.normCode(null), '');
  assert.strictEqual(coupons.normCode(undefined), '');
});

test('admin: a code typed with Arabic or full-width digits is saved in English digits', async () => {
  let r = await mk({ code: 'eid٢٠', type: 'percent', value: 20, maxDiscount: 100, perCustomer: 1 });
  assert.strictEqual(r.status, 201, await r.clone().text());
  assert.strictEqual((await r.json()).code, 'EID20');
  // The same code typed another way is the same code.
  for (const code of ['ＥＩＤ２０', 'EID۲۰', 'EID20']) {
    r = await mk({ code, type: 'fixed', value: 5 });
    assert.strictEqual(r.status, 409, `${code}: unique code`);
  }
  r = await mk({ code: 'sale۵۰', type: 'fixed', value: 50 });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await r.json()).code, 'SALE50');
  // Still English letters and digits only.
  assert.strictEqual((await mk({ code: 'عيد٢٠', type: 'percent', value: 10 })).status, 400);
  assert.strictEqual((await mk({ code: 'EID٢٠！', type: 'percent', value: 10 })).status, 400);
  const list = (await (await admin('/api/admin/coupons')).json()).coupons.map((c) => c.code).sort();
  assert.deepStrictEqual(list, ['EID20', 'SALE50']);
});

test('checkout: EID20 works however its digits are typed, and counts as one coupon', async () => {
  const d = await makeDesign();
  const quote = (couponCode, designIds = [d.id]) => post('/api/cart/quote', { designIds, couponCode }).then((x) => x.json());
  const plain = await quote('EID20');
  assert.ok(plain.coupon && plain.coupon.discount > 0, JSON.stringify(plain));
  for (const typed of TYPED) {
    const q = await quote(typed);
    assert.ok(!q.couponError, `${JSON.stringify(typed)}: ${q.couponError}`);
    assert.strictEqual(q.coupon.code, 'EID20', JSON.stringify(typed));
    assert.strictEqual(q.coupon.discount, plain.coupon.discount, JSON.stringify(typed));
    assert.strictEqual(q.total, plain.total, JSON.stringify(typed));
  }
  // Ordered with Arabic digits: the order keeps the code as saved.
  let r = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], couponCode: 'EID٢٠', expectedTotal: plain.total });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const order = await r.json();
  assert.strictEqual(order.coupon, 'EID20');
  assert.strictEqual(order.discount, plain.coupon.discount);
  // The same customer typing it in full-width digits: already used (one per customer).
  const d2 = await makeDesign();
  r = await post('/api/orders', { customer: CUSTOMER, designIds: [d2.id], couponCode: 'ＥＩＤ２０' });
  assert.strictEqual(r.status, 409);
  assert.match((await r.json()).error, /already used/);
  const row = (await (await admin('/api/admin/coupons')).json()).coupons.find((c) => c.code === 'EID20');
  assert.strictEqual(row.uses, 1);
  // Persian digits for the other code.
  const q = await quote('sale۵۰', [d2.id]);
  assert.ok(!q.couponError, q.couponError);
  assert.strictEqual(q.coupon.code, 'SALE50');
  // A wrong code is still wrong.
  assert.match((await quote('EID٢١', [d2.id])).couponError, /not valid/);
});
