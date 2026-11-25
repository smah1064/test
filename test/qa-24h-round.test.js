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
