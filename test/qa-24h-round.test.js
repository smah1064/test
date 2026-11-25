'use strict';

// QA round on the last 24 hours' additions (25 Nov, 8:29–9:27 pm Cairo).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const preview = require('../src/preview');
const sharp = require('sharp');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN] };
const CUSTOMER = { name: 'ليلى سمير', phone: '01055556666', governorate: 'cairo', city: 'المعادي', address: '3 شارع 9' };
const MUG = { w: 2590, h: 1049 };

let server;
let base;
let dataDir;
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa24h-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: LIMITS, cleanupEvery: 0 });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
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
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text };
}

test('team and invitation names: blank-looking letters are refused, the Arabic letter mark is stripped', async () => {
  for (const [i, blank] of ['ㅤ', 'ㅤㅤㅤ', 'ﾠ', 'ᅟᅠ', '᠎'].entries()) {
    const r = await call('/api/admin/staff', 'POST', { name: blank, username: `blank${i}`, roles: ['catalogue'] }, owner);
    assert.strictEqual(r.status, 400, `${JSON.stringify(blank)} -> ${r.text}`);
  }
  const ok = await call('/api/admin/staff', 'POST', { name: '؜نمدا', username: 'alm1', roles: ['catalogue'] }, owner);
  assert.strictEqual(ok.status, 201, ok.text);
  assert.strictEqual(ok.json.user.name, 'نمدا');
  assert.strictEqual(preview.cleanName('ㅤ'), '');
  assert.strictEqual(preview.cleanName('؜Sara᠎'), 'Sara');
  assert.strictEqual((await call('/api/admin/preview/people', 'POST', { name: 'ㅤㅤ' }, owner)).status, 400);
});

test('approvals details read in words: coupon categories, its code as made, colours by name', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Fin', username: 'fin24', roles: ['finance', 'catalogue'], password: 'a-finance-pass-24' }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const fin = (await call('/api/admin/login', 'POST', { username: 'fin24', password: 'a-finance-pass-24' })).json.token;
  assert.ok(fin);
  const held = await call('/api/admin/coupons', 'POST', { code: 'EID٢٠', type: 'fixed', value: 30, minOrder: 300, categories: ['apparel'] }, fin);
  assert.strictEqual(held.status, 202, held.text);
  const col = await call('/api/admin/catalog/tshirt', 'PUT', { colors: { red: { soldOut: true } } }, fin);
  assert.strictEqual(col.status, 202, col.text);
  const list = (await call('/api/admin/approvals', 'GET', undefined, owner)).json;
  const rows = (list.approvals || list.items || []);
  const coupon = rows.find((a) => /coupons/.test(a.action || a.path || ''));
  const colors = rows.find((a) => /catalog/.test(a.action || a.path || ''));
  const val = (a, en) => (a.changes || []).find((c) => c.field.en.toLowerCase().includes(en));
  assert.strictEqual(val(coupon, 'code').value.en, 'EID20');
  assert.ok(!/apparel/.test(JSON.stringify(val(coupon, 'categor').value)), JSON.stringify(val(coupon, 'categor')));
  const c = val(colors, 'colo').value;
  assert.ok(/Red/.test(c.en) && /sold out/.test(c.en), c.en);
  assert.ok(/أحمر/.test(c.ar) && /خلصان/.test(c.ar), c.ar);
});

const art = (w, h, rgb = { r: 200, g: 40, b: 40 }) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { ...rgb, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
  .png().toBuffer();
async function approvedMug() {
  const created = (await call('/api/designs', 'POST', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json;
  for (const name of created.files) {
    const data = name.endsWith('-print.png') ? await art(MUG.w, MUG.h) : name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52);
    await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
  }
  const d = (await call(`/api/designs/${created.id}/complete`, 'POST', undefined, null, { 'x-upload-token': created.uploadToken })).json;
  const proof = (await call(`/api/designs/${d.id}/proof`)).json;
  const q = (await call('/api/cart/quote', 'POST', { designIds: [d.id] })).json;
  return (await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json;
}

test('"Shipped" while a corrected print file is being saved: refused, the job goes back to the customer first', async () => {
  const o = await approvedMug();
  const it = o.items[0];
  const png = await art(MUG.w, MUG.h, { r: 10, g: 10, b: 10 });
  const replace = fetch(`${base}/api/admin/items/${it.id}/replacement/front`, { method: 'PUT', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'image/png', 'x-review-note': encodeURIComponent('Darker') }, body: png });
  await new Promise((r) => setTimeout(r, 30));
  const ship = await call(`/api/admin/orders/${o.id}/shipment`, 'PATCH', { courier: 'Bosta', trackingNumber: '123', shipped: true }, owner);
  const r1 = await replace;
  assert.strictEqual(r1.status, 200, await r1.text());
  assert.strictEqual(ship.status, 409, ship.text);
  assert.ok(['fileBeingReplaced', 'notApproved'].includes(ship.json.code), ship.json.code);
  const pub = (await call(`/api/orders/${o.id}?k=${o.key}`)).json;
  assert.strictEqual(pub.items[0].status, 'awaiting_approval');
  assert.ok(!(pub.shipment && pub.shipment.shippedAt), 'not marked shipped');
});

test('a two-sided job corrected side by side: one proof link (it still opens) and one message, both notes kept', async () => {
  const created = (await call('/api/designs', 'POST', { productId: 'tshirt', color: 'white', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'F' }] } }, back: { editor: { objects: [{ type: 'i-text', text: 'B' }] } } } })).json;
  assert.ok(created.id, JSON.stringify(created));
  const dims = {};
  for (const name of created.files) {
    let data;
    if (name.endsWith('-print.png')) {
      const side = name.replace('-print.png', '');
      const spec = (created.sides || []).find((x) => x.id === side) || {};
      dims[side] = { w: spec.widthPx || 3600, h: spec.heightPx || 4800 };
      data = await art(dims[side].w, dims[side].h);
    } else data = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52);
    await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
  }
  const d = (await call(`/api/designs/${created.id}/complete`, 'POST', undefined, null, { 'x-upload-token': created.uploadToken })).json;
  assert.ok(d && d.id, JSON.stringify(d));
  const real = d.sides ? Object.fromEntries(d.sides.map((x) => [x.id, { w: x.widthPx, h: x.heightPx }])) : dims;
  const proof = (await call(`/api/designs/${d.id}/proof`)).json;
  const q = (await call('/api/cart/quote', 'POST', { designIds: [d.id] })).json;
  const o = (await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json;
  const it = o.items[0];
  const put = async (side, note) => fetch(`${base}/api/admin/items/${it.id}/replacement/${side}`, { method: 'PUT', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'image/png', 'x-review-note': encodeURIComponent(note) }, body: await art((real[side] || dims[side]).w, (real[side] || dims[side]).h, { r: 10, g: 10, b: 10 }) });
  const f = await put('front', 'Logo moved 2 cm from the seam');
  const first = await f.text();
  assert.strictEqual(f.status, 200, first);
  const r1 = (await call('/api/admin/review', 'GET', undefined, owner)).json.items.find((x) => x.id === it.id);
  const link1 = r1.proofLink;
  assert.ok(link1, first.slice(0, 200));
  const b = await put('back', 'Back text made bigger');
  assert.strictEqual(b.status, 200, await b.text());
  const r2 = (await call('/api/admin/review', 'GET', undefined, owner)).json.items.find((x) => x.id === it.id);
  assert.strictEqual(r2.proofLink, link1, 'the first message\'s link still works');
  const token = link1.split('t=')[1];
  const p = await call(`/api/proofs/${token}`);
  assert.strictEqual(p.status, 200, p.text);
  assert.ok(/Logo moved/.test(p.text) && /Back text/.test(p.text), 'both notes reach the customer');
});

test('activity: refused and withdrawn changes say which change', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Cat', username: 'cat24', roles: ['catalogue'], password: 'a-catalogue-pass-24' }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const cat = (await call('/api/admin/login', 'POST', { username: 'cat24', password: 'a-catalogue-pass-24' })).json.token;
  const a1 = await call('/api/admin/catalog/mug', 'PUT', { status: 'hidden', hiddenReason: 'season' }, cat);
  assert.strictEqual(a1.status, 202, a1.text);
  const a2 = await call('/api/admin/catalog/notebook', 'PUT', { status: 'hidden', hiddenReason: 'stock' }, cat);
  assert.strictEqual(a2.status, 202, a2.text);
  const id1 = (a1.json.approval || a1.json).id;
  const id2 = (a2.json.approval || a2.json).id;
  assert.strictEqual((await call(`/api/admin/approvals/${id1}/reject`, 'POST', { note: 'not now' }, owner)).status, 200);
  assert.strictEqual((await call(`/api/admin/approvals/${id2}`, 'DELETE', undefined, cat)).status, 200);
  const again = await call(`/api/admin/approvals/${id1}/approve`, 'POST', {}, owner);
  assert.strictEqual(again.status, 409);
  const entries = (await call('/api/admin/activity', 'GET', undefined, owner)).json.entries;
  const refused = entries.find((e) => e.approvalId === id1 && /reject/.test(e.path));
  const withdrawn = entries.find((e) => e.approvalId === id2 && e.method === 'DELETE');
  assert.ok(refused && /^Refused a change: .+/.test(refused.summary.en) && /رفض تعديل: .+/.test(refused.summary.ar), JSON.stringify(refused));
  assert.ok(withdrawn && /^Withdrew a change: .+/.test(withdrawn.summary.en), JSON.stringify(withdrawn));
  assert.ok(entries.find((e) => e.approvalId === id1 && e.status === 409), 'the late approve names the change too');
});

test('a set-up link ends when the person chooses a new password themselves', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Fin Two', username: 'fin2x', roles: ['finance'], password: 'first-pass-fin-2' }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const link = await call(`/api/admin/staff/${add.json.user.id}/setup-link`, 'POST', undefined, owner);
  assert.strictEqual(link.status, 200, link.text);
  const token = new URL(link.json.link, base).searchParams.get('setup');
  const me = (await call('/api/admin/login', 'POST', { username: 'fin2x', password: 'first-pass-fin-2' })).json.token;
  const ch = await call('/api/admin/me/password', 'PUT', { current: 'first-pass-fin-2', password: 'my-own-new-pass-2' }, me);
  assert.strictEqual(ch.status, 200, ch.text);
  const used = await call('/api/admin/setup', 'POST', { token, password: 'someone-elses-pass' });
  assert.notStrictEqual(used.status, 200, used.text);
  assert.ok((await call('/api/admin/login', 'POST', { username: 'fin2x', password: 'my-own-new-pass-2' })).json.token);
});

test('search: father / dad / عيد الأب / بابا find the dad designs, not Santa (بابا نويل); Santa still found', () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/designs.js'), 'utf8');
  const kit = src.slice(src.indexOf('// search-kit:start'), src.indexOf('// search-kit:end') + 18);
  const S = vm.runInNewContext(`${kit}\nSEARCH`);
  const santa = S.index('Merry Christmas (Santa) كريسماس سعيد (بابا نويل) christmas كريسماس');
  const dad = S.index('Best dad أحسن بابا fathers day عيد الأب');
  for (const q of ['father', "Father's Day", 'dad', 'عيد الأب', 'بابا', 'daddy']) {
    assert.ok(S.match(dad, S.query(q)), `${q} finds the dad design`);
    assert.ok(!S.match(santa, S.query(q)), `${q} doesn't find Santa`);
  }
  for (const q of ['santa', 'بابا نويل', 'christmas', 'كريسماس']) assert.ok(S.match(santa, S.query(q)), `${q} finds Santa`);
});

test('weak team passwords are refused: the username, its name, qwerty12345, password1234!', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Mostafa Ali', username: 'mostafa.ali', roles: ['catalogue'] }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const token = new URL(add.json.setupLink, base).searchParams.get('setup');
  for (const weak of ['mostafa.ali', 'mostafa.ali2024', 'Mostafa2024!!', 'qwerty12345', 'password1234!', '1q2w3e4r5t', 'ebda3ebda3!!']) {
    const r = await call('/api/admin/setup', 'POST', { token, password: weak });
    assert.strictEqual(r.status, 400, `${weak} -> ${r.text}`);
    assert.strictEqual(r.json.code, 'passwordTooShort');
  }
  assert.strictEqual((await call('/api/admin/staff', 'POST', { name: 'Op', username: 'opweak', roles: ['operations'], password: 'opweak12345' }, owner)).status, 400);
  const ok = await call('/api/admin/setup', 'POST', { token, password: 'sunny-garden-maadi' });
  assert.strictEqual(ok.status, 200, ok.text);
});

test('"Approve for printing" on a corrected file waiting for the customer: queued for them (with how they confirmed), link kept', async () => {
  const o = await approvedMug();
  const it = o.items[0];
  assert.strictEqual((await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'reopen', note: 'Too close to the handle' }, owner)).status, 200);
  const r = await fetch(`${base}/api/admin/items/${it.id}/replacement/front`, { method: 'PUT', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'image/png', 'x-review-note': encodeURIComponent('Moved 1 cm') }, body: await art(MUG.w, MUG.h, { r: 0, g: 90, b: 0 }) });
  assert.strictEqual(r.status, 200, await r.text());
  const before = (await call('/api/admin/review', 'GET', undefined, owner)).json.items.find((x) => x.id === it.id);
  assert.strictEqual(before.status, 'awaiting_approval');
  const noNote = await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'approve' }, owner);
  assert.strictEqual(noNote.status, 400);
  assert.strictEqual(noNote.json.code, 'confirmNoteRequired');
  const ok = await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'approve', note: 'Confirmed on WhatsApp' }, owner);
  assert.strictEqual(ok.status, 200, ok.text);
  const pub = (await call(`/api/orders/${o.id}?k=${o.key}`)).json;
  assert.strictEqual(pub.items[0].status, 'queued');
  // The customer's link wasn't replaced: it says the proof is done, not "not valid any more".
  const token = before.proofLink.split('t=')[1];
  assert.notStrictEqual((await call(`/api/proofs/${token}`)).status, 404);
  const start = await call(`/api/admin/items/${it.id}`, 'PATCH', { status: 'printing' }, owner);
  assert.strictEqual(start.status, 200, start.text);
});

test('a finance cost change approved after the person became an owner changes the costs only, not the prices', async () => {
  const before = (await call('/api/admin/pricing', 'GET', undefined, owner)).json.products.find((p) => p.id === 'mug');
  const set = await call('/api/admin/pricing/mug', 'PUT', { basePrice: 265, extraSidePrice: before.extraSidePrice, sizes: Object.fromEntries(before.sizes.map((z) => [z.id, z.surcharge])), costs: before.costs }, owner);
  assert.strictEqual(set.status, 200, set.text);
  const add = await call('/api/admin/staff', 'POST', { name: 'Fin Three', username: 'fin3x', roles: ['finance'] }, owner);
  const token = new URL(add.json.setupLink, base).searchParams.get('setup');
  assert.strictEqual((await call('/api/admin/setup', 'POST', { token, password: 'river-nile-sunset' })).status, 200);
  const fin = (await call('/api/admin/login', 'POST', { username: 'fin3x', password: 'river-nile-sunset' })).json.token;
  const held = await call('/api/admin/pricing/mug', 'PUT', { basePrice: 265, extraSidePrice: before.extraSidePrice, sizes: {}, costs: { ...before.costs, blank: 44 } }, fin);
  assert.strictEqual(held.status, 202, held.text);
  assert.strictEqual((await call(`/api/admin/staff/${add.json.user.id}`, 'PATCH', { roles: ['owner'] }, owner)).status, 200);
  const id = (held.json.approval || held.json).id;
  const ok = await call(`/api/admin/approvals/${id}/approve`, 'POST', {}, owner);
  assert.strictEqual(ok.status, 200, ok.text);
  const now = (await call('/api/admin/pricing', 'GET', undefined, owner)).json.products.find((p) => p.id === 'mug');
  assert.strictEqual(now.costs.blank, 44);
  assert.strictEqual(now.basePrice, 265, 'the owner\'s price stays');
});

test('while a corrected file is being saved: review decisions and the printing-house send wait; a DTF film refuses it', async () => {
  const o = await approvedMug();
  const it = o.items[0];
  assert.strictEqual((await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'reopen', note: 'Blurry' }, owner)).status, 200);
  const png = await art(MUG.w, MUG.h, { r: 10, g: 10, b: 120 });
  const replace = fetch(`${base}/api/admin/items/${it.id}/replacement/front`, { method: 'PUT', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'image/png', 'x-review-note': encodeURIComponent('Sharper') }, body: png });
  await new Promise((r) => setTimeout(r, 30));
  const approve = await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'approve' }, owner);
  const changes = await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'changes', note: 'Please change' }, owner);
  const r1 = await replace;
  assert.strictEqual(r1.status, 200, await r1.text());
  assert.strictEqual(approve.status, 409, approve.text);
  assert.strictEqual(changes.status, 409, changes.text);
  const pub = (await call(`/api/orders/${o.id}?k=${o.key}`)).json;
  assert.strictEqual(pub.items[0].status, 'awaiting_approval');
});

test('approvals: a photo to delete and a new photo order show the photos, not their ids', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Cat Two', username: 'cat2x', roles: ['catalogue'], password: 'cat-two-passphrase' }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const cat = (await call('/api/admin/login', 'POST', { username: 'cat2x', password: 'cat-two-passphrase' })).json.token;
  const png = (c) => sharp({ create: { width: 300, height: 300, channels: 3, background: c } }).png().toBuffer();
  const up = async (c) => fetch(`${base}/api/admin/catalog/cap/photos`, { method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'image/png' }, body: await png(c) }).then((r) => r.json());
  await up('#cc0000');
  const two = await up('#0000cc');
  const ids = two.photos.map((p) => p.id);
  const del = await call(`/api/admin/catalog/cap/photos/${ids[0]}`, 'DELETE', undefined, cat);
  assert.strictEqual(del.status, 202, del.text);
  const ord = await call('/api/admin/catalog/cap/photos', 'PUT', { order: [...ids].reverse(), main: ids[1] }, cat);
  assert.strictEqual(ord.status, 202, ord.text);
  const rows = (await call('/api/admin/approvals', 'GET', undefined, owner)).json.approvals;
  const dRow = rows.find((x) => x.id === (del.json.approval || del.json).id);
  const oRow = rows.find((x) => x.id === (ord.json.approval || ord.json).id);
  assert.ok(dRow.pics && dRow.pics[0].url.includes(ids[0]), JSON.stringify(dRow));
  assert.ok(oRow.pics.length >= 2 && oRow.pics[0].url.includes(ids[1]), JSON.stringify(oRow.pics));
  assert.ok(!JSON.stringify(oRow.changes).includes(ids[0]), JSON.stringify(oRow.changes));
});

test('a stock count waiting for approval is marked "changed since" when pieces are sold meanwhile', async () => {
  assert.strictEqual((await call('/api/admin/catalog/mug', 'PUT', { stock: 12 }, owner)).status, 200);
  const cat = (await call('/api/admin/login', 'POST', { username: 'cat2x', password: 'cat-two-passphrase' })).json.token;
  const held = await call('/api/admin/catalog/mug', 'PUT', { stock: 20 }, cat);
  assert.strictEqual(held.status, 202, held.text);
  const id = (held.json.approval || held.json).id;
  const row = async () => (await call('/api/admin/approvals', 'GET', undefined, owner)).json.approvals.find((x) => x.id === id);
  assert.ok(!(await row()).changedSince, 'nothing changed yet');
  await new Promise((r) => setTimeout(r, 5));
  await approvedMug();
  assert.ok((await row()).changedSince, 'a sale since the request is a change');
});

test('two waiting cost changes for one product, approved in turn, both stay (each carries only what it changed)', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Fin Four', username: 'fin4x', roles: ['finance'], password: 'fourth-finance-pass' }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const fin = (await call('/api/admin/login', 'POST', { username: 'fin4x', password: 'fourth-finance-pass' })).json.token;
  const row = (await call('/api/admin/pricing', 'GET', undefined, owner)).json.products.find((p) => p.id === 'cap');
  const body = (costs) => ({ basePrice: row.basePrice, extraSidePrice: row.extraSidePrice, sizes: Object.fromEntries(row.sizes.map((z) => [z.id, z.surcharge])), costs: { ...row.costs, ...costs } });
  const a = await call('/api/admin/pricing/cap', 'PUT', body({ blank: 41 }), fin);
  const b = await call('/api/admin/pricing/cap', 'PUT', body({ other: 7 }), fin);
  assert.strictEqual(a.status, 202, a.text);
  assert.strictEqual(b.status, 202, b.text);
  for (const r of [a, b]) assert.strictEqual((await call(`/api/admin/approvals/${(r.json.approval || r.json).id}/approve`, 'POST', {}, owner)).status, 200);
  const now = (await call('/api/admin/pricing', 'GET', undefined, owner)).json.products.find((p) => p.id === 'cap');
  assert.strictEqual(now.costs.blank, 41, 'the first change stays');
  assert.strictEqual(now.costs.other, 7);
  const same = { basePrice: now.basePrice, extraSidePrice: now.extraSidePrice, sizes: Object.fromEntries(now.sizes.map((z) => [z.id, z.surcharge])), costs: now.costs };
  assert.strictEqual((await call('/api/admin/pricing/cap', 'PUT', same, fin)).status, 400, 'nothing changed: nothing to approve');
});

test('team sign-in on a known browser: someone else at the same address guessing the username doesn\'t lock it out', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Lock Known', username: 'lkknown', roles: ['operations'], password: 'known-browser-pass' }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const first = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.7.7' }, body: JSON.stringify({ username: 'lkknown', password: 'known-browser-pass' }) });
  assert.strictEqual(first.status, 200);
  const mark = /pod-staff-device=([^;]+)/.exec(first.headers.get('set-cookie') || '')[1];
  for (let i = 0; i < 7; i++) {
    await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.7.7' }, body: JSON.stringify({ username: 'lkknown', password: `wrong-guess-${i}` }) });
  }
  const mine = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.7.7', Cookie: `pod-staff-device=${mark}` }, body: JSON.stringify({ username: 'lkknown', password: 'known-browser-pass' }) });
  assert.strictEqual(mine.status, 200, await mine.text());
  // The known browser's own wrong tries still lock it.
  for (let i = 0; i < 6; i++) {
    await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.7.7', Cookie: `pod-staff-device=${mark}` }, body: JSON.stringify({ username: 'lkknown', password: `my-typo-${i}` }) });
  }
  const locked = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.7.7', Cookie: `pod-staff-device=${mark}` }, body: JSON.stringify({ username: 'lkknown', password: 'known-browser-pass' }) });
  assert.strictEqual(locked.status, 429);
});

test('a required note of invisible marks only is no note', async () => {
  const o = await approvedMug();
  const it = o.items[0];
  const r = await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'reopen', note: '​‏ㅤ ' }, owner);
  assert.strictEqual(r.status, 400, r.text);
});

test('activity: team changes name the person (even once removed) and what changed', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Gone Person', username: 'gone24', roles: ['catalogue'] }, owner);
  const id = add.json.user.id;
  assert.strictEqual((await call(`/api/admin/staff/${id}`, 'PATCH', { active: false }, owner)).status, 200);
  assert.strictEqual((await call(`/api/admin/staff/${id}`, 'PATCH', { roles: ['finance', 'catalogue'] }, owner)).status, 200);
  assert.ok([200, 204].includes((await call(`/api/admin/staff/${id}`, 'DELETE', undefined, owner)).status));
  const lines = (await call('/api/admin/activity', 'GET', undefined, owner)).json.entries.filter((e) => e.path === `/api/admin/staff/${id}`);
  assert.strictEqual(lines.length, 3, JSON.stringify(lines.map((e) => e.summary)));
  for (const e of lines) assert.ok(e.summary.en.includes('Gone Person (gone24)') && e.summary.ar.includes('Gone Person (gone24)'), JSON.stringify(e.summary));
  assert.ok(lines.some((e) => /switched off/.test(e.summary.en)));
  assert.ok(lines.some((e) => /roles Finance, Catalogue/.test(e.summary.en) && /الحسابات/.test(e.summary.ar)));
});

test('small inputs: shipping details are text, rights-request names lose direction marks, Arabic address lines join with "،"', async () => {
  const o = await approvedMug();
  const bad = await call(`/api/admin/orders/${o.id}/shipment`, 'PATCH', { courier: { a: 1 }, trackingNumber: [12, 34] }, owner);
  assert.strictEqual(bad.status, 400, bad.text);
  const td = await call('/api/takedown', 'POST', { name: '‮دمحم‬ Ali', contact: 'someone@example.com', link: 'https://example.com/x', details: 'This is my own artwork, please remove it.' });
  assert.ok([200, 201].includes(td.status), td.text);
  const list = (await call('/api/admin/takedowns', 'GET', undefined, owner)).json;
  const row = (list.takedowns || list.items || list).find ? (list.takedowns || list.items || list).find((x) => /Ali/.test(x.name)) : null;
  assert.ok(row && !/[‪-‮]/.test(row.name), JSON.stringify(row));
});

test('search: هدية finds what هدايا and gift find; قهوة and شاي find the mug', () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/designs.js'), 'utf8');
  const kit = src.slice(src.indexOf('// search-kit:start'), src.indexOf('// search-kit:end') + 18);
  const S = vm.runInNewContext(`${kit}\nSEARCH`);
  const mug = S.index('mug Ceramic Mug مج سيراميك Home & living المنزل cup coffee tea كوب كوباية مق');
  const gifts = S.index('couplemugs Couple Mugs (pair) مجين للكابلز Gifts & occasions cup كوب مق');
  for (const q of ['هدية', 'هدايا', 'gift', 'gifts']) assert.ok(S.match(gifts, S.query(q)), q);
  for (const q of ['قهوة', 'كوب قهوة', 'شاي', 'coffee', 'tea']) assert.ok(S.match(mug, S.query(q)), q);
});

test('checkout and sign-up names need a letter; account passwords are text', async () => {
  const d = (await call('/api/designs', 'POST', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } })).json;
  const bad = await call('/api/orders', 'POST', { customer: { ...CUSTOMER, name: 'ـــ ً' }, designIds: [d.id] });
  assert.strictEqual(bad.status, 400, bad.text);
  assert.strictEqual(bad.json.code, 'fieldRequired');
  const su = await call('/api/account/signup', 'POST', { name: '..', phone: '01077778888', password: 'a-good-password-1' });
  assert.strictEqual(su.status, 400, su.text);
  const ok = await fetch(`${base}/api/account/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sara', phone: '01077778889', password: 'a-good-password-1' }) });
  assert.ok([200, 201].includes(ok.status), await ok.text());
  const cookie = (ok.headers.getSetCookie ? ok.headers.getSetCookie() : [ok.headers.get('set-cookie')]).map((c) => c.split(';')[0]).join('; ');
  const pw = await call('/api/account/password', 'POST', { current: 'a-good-password-1', password: { a: 1 } }, null, { Cookie: cookie });
  assert.strictEqual(pw.status, 400, pw.text);
});

test('the back side of a small pack follows the pack\'s price (owner\'s decision); the standard pack and bigger keep the flat price', () => {
  const P = require('../src/products');
  const p = P.PRODUCTS.find((x) => x.id === 'postcards');
  assert.strictEqual(P.priceFor(p, '1', 1), 20);
  assert.strictEqual(P.priceFor(p, '1', 2), 25, '1 postcard both sides');
  assert.strictEqual(P.priceFor(p, '10', 2) - P.priceFor(p, '10', 1), 25);
  assert.strictEqual(P.priceFor(p, '50', 2) - P.priceFor(p, '50', 1), 60, 'the standard pack: as before');
  assert.strictEqual(P.priceFor(p, '500', 2) - P.priceFor(p, '500', 1), 60, 'bigger packs: as before');
  // Not packs (garment sizes cheaper than the base): the flat price.
  const tee = P.PRODUCTS.find((x) => x.id === 'tshirt');
  for (const z of tee.sizes) assert.strictEqual(P.sidePriceFor(tee, z), tee.extraSidePrice != null ? tee.extraSidePrice : P.sidePriceFor(tee, null));
});

test('a team member\'s browser can look at the customer\'s proof link but not decide; with the order\'s key it can', async () => {
  const o = await approvedMug();
  const it = o.items[0];
  assert.strictEqual((await call(`/api/admin/items/${it.id}/review`, 'POST', { action: 'reopen', note: 'Blurry' }, owner)).status, 200);
  const r = await fetch(`${base}/api/admin/items/${it.id}/replacement/front`, { method: 'PUT', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'image/png', 'x-review-note': encodeURIComponent('Sharper') }, body: await art(MUG.w, MUG.h, { r: 0, g: 0, b: 0 }) });
  assert.strictEqual(r.status, 200);
  const link = (await r.json()).proofLink;
  const token = link.split('t=')[1];
  // A browser that signed in to the dashboard carries its mark.
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-owner-pass' }) });
  const mark = (login.headers.getSetCookie ? login.headers.getSetCookie() : []).map((c) => c.split(';')[0]).filter((c) => !/device/.test(c)).join('; ');
  assert.ok(mark, 'the dashboard sign-in leaves its mark');
  const view = await call(`/api/proofs/${token}`, 'GET', undefined, null, { Cookie: mark });
  assert.strictEqual(view.status, 200);
  assert.strictEqual(view.json.team, true);
  const no = await call(`/api/proofs/${token}`, 'POST', { decision: 'approve', proofHash: view.json.proof.proofHash }, null, { Cookie: mark });
  assert.strictEqual(no.status, 403, no.text);
  assert.strictEqual(no.json.code, 'proofTeam');
  // The customer's own link (with the key) decides, even in that browser; a plain browser does too.
  const yes = await call(`/api/proofs/${token}`, 'POST', { decision: 'approve', proofHash: view.json.proof.proofHash }, null, { Cookie: mark, 'x-order-key': o.key });
  assert.strictEqual(yes.status, 200, yes.text);
});

test('delete my account: with the password; the account, its cart and drafts go; its orders stay as guest orders', async () => {
  const su = await fetch(`${base}/api/account/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Delete Me', phone: '01099998888', password: 'delete-me-pass-1' }) });
  assert.ok([200, 201].includes(su.status), await su.text());
  const cookie = su.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const me = (await call('/api/account', 'GET', undefined, null, { Cookie: cookie })).json;
  const id = (me.customer || me).id;
  assert.ok(id);
  assert.strictEqual((await call('/api/account/cart', 'PUT', { items: [] }, null, { Cookie: cookie })).status < 500, true);
  // An order from the account.
  const d = (await call('/api/designs', 'POST', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } })).json;
  // Wrong password: nothing happens.
  const wrong = await call('/api/account/delete', 'POST', { password: 'not-it' }, null, { Cookie: cookie });
  assert.strictEqual(wrong.status, 401);
  assert.ok((await call('/api/account', 'GET', undefined, null, { Cookie: cookie })).json.customer, 'still there after a wrong password');
  const del = await call('/api/account/delete', 'POST', { password: 'delete-me-pass-1' }, null, { Cookie: cookie });
  assert.strictEqual(del.status, 200, del.text);
  assert.strictEqual((await call('/api/account', 'GET', undefined, null, { Cookie: cookie })).json.customer, null, 'signed out and gone');
  assert.strictEqual(fs.existsSync(path.join(dataDir, 'accounts', id)), false, 'its folder is gone');
  // Signing in again: no such account.
  assert.notStrictEqual((await call('/api/account/login', 'POST', { login: '01099998888', password: 'delete-me-pass-1' })).status, 200);
  // The same mobile can make a new account.
  const again = await call('/api/account/signup', 'POST', { name: 'New Me', phone: '01099998888', password: 'new-me-pass-12' });
  assert.ok([200, 201].includes(again.status), again.text);
  assert.ok(d.id);
});

test('blank-looking characters (Hangul filler, Braille blank) are no name or note; invite names keep emoji whole', async () => {
  const d = (await call('/api/designs', 'POST', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } })).json;
  for (const blank of ['ㅤㅤ', '⠀⠀']) {
    const r = await call('/api/orders', 'POST', { customer: { ...CUSTOMER, name: blank }, designIds: [d.id] });
    assert.strictEqual(r.status, 400, `${JSON.stringify(blank)} -> ${r.text}`);
    const c = await call('/api/orders', 'POST', { customer: { ...CUSTOMER, city: blank }, designIds: [d.id] });
    assert.strictEqual(c.status, 400, `city ${JSON.stringify(blank)} -> ${c.text}`);
  }
  const o = await approvedMug();
  const r = await call(`/api/admin/items/${o.items[0].id}/review`, 'POST', { action: 'reopen', note: '⠀⠀ ✔' }, owner);
  assert.strictEqual(r.status, 400, r.text);
  assert.strictEqual(preview.cleanName('Sara 👩‍💻'), 'Sara 👩‍💻');
  assert.strictEqual(preview.cleanName('⠀⠀'), '');
});

test('approvals details in words: a size rename, new colours and sizes, embroidery, print areas, a size\'s cost', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Cat Five', username: 'cat5x', roles: ['catalogue', 'finance'], password: 'catalogue-five-pass' }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const cat = (await call('/api/admin/login', 'POST', { username: 'cat5x', password: 'catalogue-five-pass' })).json.token;
  const ask = async (url, body) => { const r = await call(url, 'PUT', body, cat); assert.strictEqual(r.status, 202, `${url} ${r.text}`); return (r.json.approval || r.json).id; };
  const ids = {
    sizes: await ask('/api/admin/catalog/hoodie', { sizes: { S: { soldOut: true }, M: { label: { en: 'Medium', ar: 'وسط' } } } }),
    colors: await ask('/api/admin/catalog/hoodie', { addColors: [{ id: 'sagegreen', name: { en: 'Sage', ar: 'زيتي فاتح' }, hex: '#9caf88' }] }),
    newSizes: await ask('/api/admin/catalog/hoodie', { addSizes: [{ id: '4XL', label: { en: '4XL', ar: '4XL' }, surcharge: 40 }] }),
    emb: await ask('/api/admin/catalog/cap', { embroidery: { at: 'center', cm: [10, 5.5], surcharge: 100, maxColors: 7 } }),
    sides: await ask('/api/admin/catalog/tote', { sides: { front: { safeMm: 9 }, back: { off: true } } }),
  };
  const rows = (await call('/api/admin/approvals', 'GET', undefined, owner)).json.approvals;
  const text = (id, l) => JSON.stringify((rows.find((x) => x.id === id).changes || []).map((c) => c.value[l]));
  assert.match(text(ids.sizes, 'en'), /renamed.*Medium \/ وسط/);
  assert.match(text(ids.sizes, 'ar'), /اسمه يبقى/);
  assert.match(text(ids.colors, 'ar'), /زيتي/);
  assert.match(text(ids.newSizes, 'en'), /4XL/);
  assert.match(text(ids.emb, 'en'), /centre.*10×5\.5 cm.*7 thread colours/);
  assert.match(text(ids.emb, 'ar'), /في النص/);
  assert.match(text(ids.sides, 'en'), /safe margin 9 mm/);
  assert.match(text(ids.sides, 'en'), /off/);
  for (const id of Object.values(ids)) for (const l of ['en', 'ar']) assert.ok(!/[{}[\]"]{2}|"id"|"hex"/.test(text(id, l).replace(/^\["|"\]$/g, '')), `${l}: ${text(id, l)}`);
});

test('the same change pressed twice while it waits is one request; the coupon row says it is waiting', async () => {
  const add = await call('/api/admin/staff', 'POST', { name: 'Fin Six', username: 'fin6x', roles: ['finance'], password: 'finance-six-pass' }, owner);
  assert.strictEqual(add.status, 201, add.text);
  const fin = (await call('/api/admin/login', 'POST', { username: 'fin6x', password: 'finance-six-pass' })).json.token;
  const made = await call('/api/admin/coupons', 'POST', { code: 'TWICE10', type: 'percent', value: 10, active: true }, owner);
  assert.ok(made.status < 300, made.text);
  const c = (made.json.coupon || made.json);
  const first = await call(`/api/admin/coupons/${c.id}`, 'PUT', { active: false }, fin);
  assert.strictEqual(first.status, 202, first.text);
  assert.ok(!first.json.already);
  const again = await call(`/api/admin/coupons/${c.id}`, 'PUT', { active: false }, fin);
  assert.strictEqual(again.status, 202, again.text);
  assert.strictEqual(again.json.already, true);
  assert.strictEqual(again.json.approval.id, first.json.approval.id);
  // A different change on the same coupon is its own request.
  const other = await call(`/api/admin/coupons/${c.id}`, 'PUT', { value: 15 }, fin);
  assert.strictEqual(other.status, 202, other.text);
  assert.notStrictEqual(other.json.approval.id, first.json.approval.id);
  const pending = (await call('/api/admin/approvals', 'GET', undefined, owner)).json.approvals.filter((a) => a.path === `/api/admin/coupons/${c.id}` && a.status === 'pending');
  assert.strictEqual(pending.length, 2);
  const list = (await call('/api/admin/coupons', 'GET', undefined, fin)).json.coupons;
  assert.strictEqual(list.find((x) => x.id === c.id).waiting.length, 2);
});

test('activity log pages: "more" and a "before" cursor reach the older lines, none repeated or skipped', async () => {
  for (let i = 0; i < 5; i++) await call('/api/admin/coupons', 'POST', { code: `PAGE${i}X`, type: 'percent', value: 5, active: true }, owner);
  const all = (await call('/api/admin/activity?limit=500', 'GET', undefined, owner)).json;
  assert.ok(all.entries.length >= 5);
  const seen = [];
  let next = '';
  for (let guard = 0; guard < 400; guard++) {
    const r = (await call(`/api/admin/activity?limit=2${next ? `&before=${encodeURIComponent(next)}` : ''}`, 'GET', undefined, owner)).json;
    seen.push(...r.entries.map((e) => e.id));
    if (!r.more) { assert.ok(!r.next); break; }
    assert.ok(r.next);
    next = r.next;
  }
  assert.deepStrictEqual(seen, all.entries.map((e) => e.id));
  // A bad cursor is the first page, not an error.
  assert.strictEqual((await call('/api/admin/activity?limit=2&before=nope', 'GET', undefined, owner)).status, 200);
});
