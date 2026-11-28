'use strict';

// Tester 1 (6 pm Cairo, 26 Nov): a coupon day like 2026-13-45 stopped the save with a server error; the owner's
// card showed the raw field name "auto"; two people approving one request at the same moment were told it was
// "already decided by —"; a typed code that only saves less than an automatic offer must still be the order's
// coupon when that offer isn't for this phone; sublimation and DTF jobs went to the printing house as the plain PDF.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
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
const OPEN = { max: 1e6, ms: 1000 };
const CUSTOMER = { name: 'Sara Ahmed', phone: '01012345678', governorate: 'giza', city: 'Dokki', address: '12 Tahrir St' };

let server;
let base;
let dataDir;
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t1-2610-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: { designs: [OPEN], orders: [OPEN], couponTry: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json.token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
async function call(url, method = 'GET', body, token, headers = {}) {
  const r = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'x-lang': 'en', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text };
}
async function addMember(username, roles) {
  const r = await call('/api/admin/staff', 'POST', { name: username.toUpperCase(), username, roles }, owner);
  assert.strictEqual(r.status, 201, r.text);
  const token = new URL(r.json.setupLink).searchParams.get('setup');
  assert.strictEqual((await call('/api/admin/setup', 'POST', { token, password: `${username}-long-password` })).status, 200);
  return { id: r.json.id, token: (await call('/api/admin/login', 'POST', { username, password: `${username}-long-password` })).json.token };
}
async function mug() {
  const r = await call('/api/designs', 'POST', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } });
  const { id, uploadToken, files } = r.json;
  for (const name of files) await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken, 'Content-Type': 'application/octet-stream' }, body: name.endsWith('.svg') ? SVG : name.includes('print') ? PRINT : PREVIEW });
  return (await (await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } })).json()).id;
}

test('a coupon day that is not a day (2026-13-45, 2026-02-30) is refused as one, not a server error', async () => {
  for (const day of ['2026-13-45', '2026-02-30', '2026-00-10']) {
    for (const field of ['startsOn', 'endsOn']) {
      const r = await call('/api/admin/coupons', 'POST', { code: 'DAYBAD', type: 'percent', value: 10, [field]: day }, owner);
      assert.strictEqual(r.status, 400, `${field} ${day}: ${r.text}`);
      assert.strictEqual(r.json.code, 'couponDatesBad');
    }
  }
  const ok = await call('/api/admin/coupons', 'POST', { code: 'DAYGOOD', type: 'percent', value: 10, startsOn: '2026-12-01', endsOn: '2026-12-31' }, owner);
  assert.strictEqual(ok.status, 201, ok.text);
});

test('the owner\'s card names "apply automatically" in words; two people approving at once are told who did', async () => {
  const fin = await addMember('fin7', ['finance']);
  const boss = await addMember('boss7', ['owner']);
  const asked = await call('/api/admin/coupons', 'POST', { code: 'AUTOASK', type: 'percent', value: 5, auto: true }, fin.token);
  assert.strictEqual(asked.status, 202, asked.text);
  const card = (await call('/api/admin/approvals', 'GET', undefined, owner)).json.approvals.find((x) => x.id === asked.json.approval.id);
  const auto = card.changes.find((x) => x.field.en === 'applies automatically');
  assert.ok(auto, JSON.stringify(card.changes.map((x) => x.field)));
  assert.deepStrictEqual(auto.field, { en: 'applies automatically', ar: 'بيتطبق لوحده' });
  assert.ok(!card.changes.some((x) => x.field.en === 'auto'), 'no raw field name');
  // Both approve at the same moment: one applies it, the other is told by whom (never "—").
  const both = await Promise.all([
    call(`/api/admin/approvals/${asked.json.approval.id}/approve`, 'POST', {}, owner),
    call(`/api/admin/approvals/${asked.json.approval.id}/approve`, 'POST', {}, boss.token),
  ]);
  const won = both.filter((r) => r.status === 200);
  const lost = both.filter((r) => r.status === 409);
  assert.strictEqual(won.length, 1, both.map((r) => r.text).join('\n'));
  assert.strictEqual(lost.length, 1);
  assert.strictEqual(lost[0].json.code, 'approvalDecidedBy');
  assert.doesNotMatch(lost[0].json.error || lost[0].text, /—/, lost[0].text);
  assert.match(lost[0].json.error || lost[0].text, /BOSS7|the owner \(emergency login\)/);
});

test('a request being applied by one person: the other is told who, not "—"', async () => {
  const fin = await addMember('fin8', ['finance']);
  const boss = await addMember('boss8', ['owner']);
  const asked = await call('/api/admin/coupons', 'POST', { code: 'RACE8', type: 'percent', value: 5 }, fin.token);
  assert.strictEqual(asked.status, 202, asked.text);
  // The first approval's change is held while it runs (as a slow change would be).
  const roles = require('../src/roles');
  const real = roles.replay;
  let release;
  const gate = new Promise((r) => { release = r; });
  let entered;
  const running = new Promise((r) => { entered = r; });
  roles.replay = async (...args) => { entered(); await gate; return real(...args); };
  try {
    const first = call(`/api/admin/approvals/${asked.json.approval.id}/approve`, 'POST', {}, boss.token);
    await running;
    const second = await call(`/api/admin/approvals/${asked.json.approval.id}/approve`, 'POST', {}, owner);
    assert.strictEqual(second.status, 409, second.text);
    assert.match(second.json.error, /BOSS8/, second.json.error);
    const no = await call(`/api/admin/approvals/${asked.json.approval.id}/reject`, 'POST', {}, owner);
    assert.strictEqual(no.status, 409, no.text);
    assert.match(no.json.error, /BOSS8/, no.json.error);
    release();
    const done = await first;
    assert.strictEqual(done.status, 200, done.text);
    assert.strictEqual(done.json.approval.applyingBy, undefined, 'nothing left of the run');
  } finally {
    roles.replay = real;
    release();
  }
});

test('a typed code that saves less than the automatic offer is the order\'s coupon once that offer was used by this phone', async () => {
  const auto = await call('/api/admin/coupons', 'POST', { code: 'ONCE30', type: 'percent', value: 30, auto: true, perCustomer: 1 }, owner);
  assert.strictEqual(auto.status, 201, auto.text);
  assert.strictEqual((await call('/api/admin/coupons', 'POST', { code: 'MINE10', type: 'percent', value: 10 }, owner)).status, 201);
  // First order from this phone: the offer.
  const a = await mug();
  const q1 = (await call('/api/cart/quote', 'POST', { designIds: [a], couponCode: 'MINE10' })).json;
  assert.deepStrictEqual([q1.coupon.code, q1.couponBeaten], ['ONCE30', true]);
  const o1 = await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: [a], couponCode: 'MINE10', expectedTotal: q1.total });
  assert.strictEqual(o1.status, 201, o1.text);
  // The next one, with the code still typed and the phone given: the customer's own code.
  const b = await mug();
  const q2 = (await call('/api/cart/quote', 'POST', { designIds: [b], couponCode: 'MINE10', phone: CUSTOMER.phone })).json;
  assert.deepStrictEqual([q2.coupon.code, q2.discount, q2.couponError, q2.couponBeaten], ['MINE10', 25, null, undefined]);
  const o2 = await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: [b], couponCode: 'MINE10', expectedTotal: q2.total });
  assert.strictEqual(o2.status, 201, o2.text);
  await call(`/api/admin/coupons/${auto.json.id}`, 'PUT', { active: false }, owner);
});

test('sending a sublimation or DTF job ticks the file made for it (mirrored print, film), not the plain PDF', () => {
  const ADMIN = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
  const grab = (re, name, ctx = {}) => {
    const m = ADMIN.match(re);
    assert.ok(m, name);
    return vm.runInNewContext(`${m[0]}; ${name}`, ctx);
  };
  const ctx = { housesData: { houses: [{ id: 'h1', prefer: 'whatsapp' }], productHouses: {} } };
  ctx.findHouse = (id) => ctx.housesData.houses.find((h) => h.id === id) || null;
  ctx.FORMATS_BY_METHOD = grab(/const FORMATS_BY_METHOD = \{[\s\S]*?\n {2}\};/, 'FORMATS_BY_METHOD');
  ctx.RECOMMENDED = grab(/const RECOMMENDED = \{[^\n]*\};/, 'RECOMMENDED');
  ctx.mergeFormats = grab(/function mergeFormats\(item\) \{[\s\S]*?\n {2}\}/, 'mergeFormats');
  ctx.printPdfKey = grab(/const printPdfKey = \(item\) => [^\n]+;/, 'printPdfKey');
  ctx.sendFormats = grab(/function sendFormats\(item\) \{[\s\S]*?\n {2}\}/, 'sendFormats', ctx);
  const sendDefaults = grab(/function sendDefaults\(item\) \{[\s\S]*?\n {2}\}/, 'sendDefaults', ctx);
  const ticked = (item) => [...sendDefaults(item).formats].sort();
  assert.deepStrictEqual(ticked({ productId: 'mug', process: 'sublimation', sides: [{ id: 'front' }] }), ['png-mirror', 'preview-pdf']);
  assert.deepStrictEqual(ticked({ productId: 'tshirt', process: 'dtf', sides: [{ id: 'front' }, { id: 'back', process: 'dtf' }] }), ['dtf-film', 'preview-pdf']);
  // Others as before.
  assert.deepStrictEqual(ticked({ productId: 'tshirt', process: 'dtg', sides: [{ id: 'front' }] }), ['pdf', 'preview-pdf']);
  assert.deepStrictEqual(ticked({ productId: 'flyers', process: 'paper', sides: [{ id: 'front' }] }), ['pdf', 'preview-pdf']);
});
