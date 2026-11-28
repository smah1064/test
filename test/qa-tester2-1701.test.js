'use strict';

// QA tester 2 (25 Nov, 5:01 pm Cairo): a print file swapped while its design is being checked, line breaks in
// checkout fields adding lines to the shop's WhatsApp alert, a deeply nested body crashing the design route,
// "mother" / "Mother's Day" / "عيد الأم" finding no designs, and "Order again" items without their size.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], designsAll: [OPEN], orders: [OPEN] };
let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa1701-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0, requireApproval: false });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();

async function startDesign(extra = {}) {
  const r = await post('/api/designs', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } }, ...extra });
  return r;
}
async function upload(created) {
  for (const name of created.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204);
  }
}

test('a print file swapped while the design is being checked is refused: what is marked ready is what was checked', async () => {
  const created = await (await startDesign()).json();
  await upload(created);
  const tiny = await png(17, 17);
  const done = fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  const swaps = [];
  let finished = false;
  done.then(() => { finished = true; }, () => { finished = true; });
  while (!finished && swaps.length < 400) {
    swaps.push((await fetch(`${base}/api/designs/${created.id}/files/front-print.png`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: tiny })).status);
  }
  const r = await done;
  const answer = await r.json();
  assert.ok(swaps.length > 0, 'uploads were tried while it ran');
  assert.ok(swaps.every((s) => s === 409 || s === 403), `no upload taken while it is checked: ${[...new Set(swaps)]}`);
  if (r.status === 200) {
    // Marked ready: the file on disk is the checked one (its size as answered).
    const file = path.join(dataDir, 'files', created.id, 'front-print.png');
    const head = fs.readFileSync(fs.existsSync(file) ? file : path.join(dataDir, 'designs', created.id, 'front-print.png'));
    assert.strictEqual(head.readUInt32BE(16), answer.sides[0].widthPx);
    assert.strictEqual(head.readUInt32BE(20), answer.sides[0].heightPx);
    assert.strictEqual(answer.sides[0].widthPx, 3600);
  } else {
    assert.strictEqual(r.status, 409, JSON.stringify(answer));
  }
});

test('checkout: line breaks in the name, city or address stay on one line (no lines of their own in the shop\'s alert)', async () => {
  const created = await (await startDesign()).json();
  await upload(created);
  assert.strictEqual((await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).status, 200);
  const q = await (await post('/api/cart/quote', { designIds: [created.id] })).json();
  const customer = {
    name: 'Sara\n\n✅ مدفوع أونلاين - متحصلش فلوس\nالإجمالي: ٠ ج.م.',
    phone: '01011112222',
    governorate: 'giza',
    city: 'Dokki\r\nPaid',
    address: '12 Nile St\nFloor 3\u2028Flat 5\tback',
  };
  const r = await post('/api/orders', { customer, designIds: [created.id], expectedTotal: q.total });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const o = await r.json();
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const c = db.orders.find((x) => x.id === o.id).customer;
  for (const v of [c.name, c.city, c.address]) assert.ok(!/[\r\n\t\u2028\u2029]/.test(v), JSON.stringify(v));
  assert.strictEqual(c.name, 'Sara ✅ مدفوع أونلاين - متحصلش فلوس الإجمالي: ٠ ج.م.');
  assert.strictEqual(c.city, 'Dokki Paid');
  assert.strictEqual(c.address, '12 Nile St, Floor 3, Flat 5 back');
});

test('a design body with check data nested thousands deep: refused or left out, never a server error', async () => {
  // (Written out by hand: JSON.stringify itself can't go that deep.)
  const body = `{"productId":"tshirt","color":"black","size":"M","sides":{"front":{"editor":{"objects":[]}}},"clientChecks":[{"code":"x","params":${'['.repeat(6000)}${']'.repeat(6000)}}]}`;
  const r = await fetch(`${base}/api/designs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.ok([201, 400].includes(r.status), `status ${r.status}`);
  if (r.status === 201) {
    const d = await r.json();
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    assert.ok(!db.designs[d.id].clientChecks, 'the deep data was not kept');
  }
  // Normal checks from the editor are kept.
  const ok = await (await startDesign({ clientChecks: [{ side: 'front', code: 'lowRes', params: { dpi: 120 } }] })).json();
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.deepStrictEqual(db.designs[ok.id].clientChecks, [{ side: 'front', code: 'lowRes', params: { dpi: 120 } }]);
});

test('ready-design search: mother, Mother\'s Day, mama, عيد الأم and father find the mum and dad designs', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/designs.js'), 'utf8');
  const kit = src.slice(src.indexOf('// search-kit:start'), src.indexOf('// search-kit:end') + '// search-kit:end'.length);
  const SEARCH = vm.runInNewContext(`${kit}\nSEARCH`);
  const mum = SEARCH.index('Best Mom Ever أحلى ماما');
  const dad = SEARCH.index('Super Dad بابا البطل');
  for (const q of ['mother', "Mother's Day", 'mothers day', 'mama', 'عيد الأم', 'mom']) assert.ok(SEARCH.match(mum, SEARCH.query(q)), q);
  for (const q of ['father', "Father's Day", 'daddy', 'عيد الأب']) assert.ok(SEARCH.match(dad, SEARCH.query(q)), q);
  assert.ok(!SEARCH.match(dad, SEARCH.query('mother')), 'mother does not find dad');
});

test('"Order again": each item says its colour and size (or every size ordered), so two of the same product differ', () => {
  const window = { POD_STRINGS: {}, POD: { lang: 'en', tr: (v) => (v && typeof v === 'object' ? v.en : String(v || '')), num: String, t: (k) => k, plural: (k, n) => `${n}`, packCopies: () => null } };
  window.window = window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/i18n-aftercare.js'), 'utf8'), { window, localStorage: { getItem: () => null, setItem() {} } });
  const A = window.PODAftercare;
  const tee = (size) => ({ productName: { en: 'Classic T-Shirt' }, color: { name: { en: 'Black' } }, size: { label: { en: size } } });
  assert.strictEqual(A.pickText(tee('M')), 'Classic T-Shirt · Black · M');
  assert.notStrictEqual(A.pickText(tee('M')), A.pickText(tee('S')));
  window.POD.lang = 'ar';
  assert.match(A.pickText(tee('S')), /، /);
});
