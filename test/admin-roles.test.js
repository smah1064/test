'use strict';

// Admin Phase 1 (owner's decisions, 25 Nov): four roles (owner, finance, operations, catalogue) with
// personal sign-ins; catalogue and money changes by the team wait for an owner's approval; daily order
// work happens at once and is logged; operations sees no amounts; the shared password stays as the
// owner's emergency way in (and is logged).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

let server;
let base;
let dataDir;
let owner;
const call = async (url, method = 'GET', body, token, headers = {}) => {
  const r = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text };
};
const signIn = async (username, password) => (await call('/api/admin/login', 'POST', { username, password })).json;
const addMember = async (username, roles) => {
  const r = await call('/api/admin/staff', 'POST', { name: username.toUpperCase(), username, roles }, owner);
  assert.strictEqual(r.status, 201, r.text);
  const token = new URL(r.json.setupLink).searchParams.get('setup');
  const done = await call('/api/admin/setup', 'POST', { token, password: `${username}-long-password` });
  assert.strictEqual(done.status, 200, done.text);
  return { id: r.json.id, token: (await signIn(username, `${username}-long-password`)).token };
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-roles-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json.token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a new team member gets a set-up link, chooses a password with it once, and signs in with their roles', async () => {
  const r = await call('/api/admin/staff', 'POST', { name: 'Salma', username: 'salma', roles: ['finance'] }, owner);
  assert.strictEqual(r.status, 201, r.text);
  assert.ok(/\/admin\?setup=/.test(r.json.setupLink), 'a link to send them');
  assert.strictEqual(r.json.user.setupPending, true);
  assert.deepStrictEqual(r.json.user.roles, ['finance']);
  // No password yet: no sign-in.
  assert.strictEqual((await call('/api/admin/login', 'POST', { username: 'salma', password: '' })).status, 401);
  const token = new URL(r.json.setupLink).searchParams.get('setup');
  assert.strictEqual((await call('/api/admin/setup', 'POST', { token, password: 'short' })).status, 400);
  assert.strictEqual((await call('/api/admin/setup', 'POST', { token: 'not-the-token', password: 'salma-long-password' })).status, 400);
  assert.strictEqual((await call('/api/admin/setup', 'POST', { token, password: 'salma-long-password' })).json.username, 'salma');
  assert.strictEqual((await call('/api/admin/setup', 'POST', { token, password: 'another-long-password' })).status, 400, 'the link works once');
  const login = await signIn('salma', 'salma-long-password');
  assert.deepStrictEqual(login.roles, ['finance']);
  assert.ok(login.perms.includes('orders.amounts') && !login.perms.includes('catalog.edit'));
  const session = (await call('/api/admin/session', 'GET', undefined, login.token)).json;
  assert.deepStrictEqual(session.roles, ['finance']);
  assert.strictEqual(session.shown, 'Salma');
  // The team list shows when they last signed in.
  const list = (await call('/api/admin/staff', 'GET', undefined, owner)).json;
  const row = list.staff.find((u) => u.username === 'salma');
  assert.ok(row.lastSignIn && row.setupPending === false && row.active === true);
  assert.deepStrictEqual(list.roles.map((x) => x.id), ['owner', 'finance', 'operations', 'catalogue']);
});

test('each role reaches its own screens only (403, not signed out)', async () => {
  const fin = await addMember('fin1', ['finance']);
  const ops = await addMember('ops1', ['operations']);
  const cat = await addMember('cat1', ['catalogue']);
  const can = async (token, url) => (await call(url, 'GET', undefined, token)).status;
  assert.strictEqual(await can(fin.token, '/api/admin/accounts'), 200);
  assert.strictEqual(await can(fin.token, '/api/admin/coupons'), 200);
  assert.strictEqual(await can(fin.token, '/api/admin/orders'), 200);
  assert.strictEqual(await can(fin.token, '/api/admin/catalog'), 403);
  assert.strictEqual(await can(fin.token, '/api/admin/houses'), 403);
  assert.strictEqual(await can(ops.token, '/api/admin/orders'), 200);
  assert.strictEqual(await can(ops.token, '/api/admin/queue'), 200);
  assert.strictEqual(await can(ops.token, '/api/admin/houses'), 200);
  assert.strictEqual(await can(ops.token, '/api/admin/customers'), 200);
  assert.strictEqual(await can(ops.token, '/api/admin/takedowns'), 200);
  assert.strictEqual(await can(ops.token, '/api/admin/accounts'), 403);
  assert.strictEqual(await can(ops.token, '/api/admin/coupons'), 403);
  assert.strictEqual(await can(cat.token, '/api/admin/catalog'), 200);
  assert.strictEqual(await can(cat.token, '/api/admin/library'), 200);
  assert.strictEqual(await can(cat.token, '/api/admin/orders'), 403);
  for (const t of [fin.token, ops.token, cat.token]) {
    for (const url of ['/api/admin/staff', '/api/admin/preview', '/api/admin/notifications']) assert.strictEqual(await can(t, url), 403, url);
    // (A refused screen doesn't sign them out.)
    assert.strictEqual(await can(t, '/api/admin/session'), 200);
  }
  const refused = await call('/api/admin/staff', 'GET', undefined, ops.token, { 'Accept-Language': 'ar' });
  assert.strictEqual(refused.json.code, 'noPermission');
  assert.match(refused.json.error, /المالك/);
  // A person with two roles gets both.
  const both = await addMember('both1', ['finance', 'operations']);
  assert.strictEqual(await can(both.token, '/api/admin/accounts'), 200);
  assert.strictEqual(await can(both.token, '/api/admin/houses'), 200);
});

test('a catalogue change by the team waits for an owner, then happens exactly as sent', async () => {
  const cat = await addMember('cat2', ['catalogue']);
  const before = (await call('/api/admin/catalog/apron', 'GET', undefined, owner)).json.lowStockAt;
  const r = await call('/api/admin/catalog/apron', 'PUT', { lowStockAt: 7 }, cat.token);
  assert.strictEqual(r.status, 202, r.text);
  assert.strictEqual(r.json.pending, true);
  assert.match(r.json.approval.summary.en, /Edit a product: .*lowStockAt/);
  assert.strictEqual((await call('/api/admin/catalog/apron', 'GET', undefined, owner)).json.lowStockAt, before, 'nothing changed yet');
  // Bad input is refused now, not after the owner approves it.
  assert.strictEqual((await call('/api/admin/catalog/apron', 'PUT', { stock: -1 }, cat.token)).status, 400);
  assert.strictEqual((await call('/api/admin/catalog/apron', 'PUT', { prices: { basePrice: 1 } }, cat.token)).json.code, 'ownerOnly');
  // The owner sees it waiting; the team member sees their own.
  const session = (await call('/api/admin/session', 'GET', undefined, owner)).json;
  assert.ok(session.pendingApprovals >= 1);
  assert.strictEqual((await call('/api/admin/session', 'GET', undefined, cat.token)).json.myPending, 1);
  const list = (await call('/api/admin/approvals', 'GET', undefined, owner)).json.approvals;
  const a = list.find((x) => x.id === r.json.approval.id);
  assert.strictEqual(a.by.name, 'CAT2');
  assert.deepStrictEqual(a.details, { lowStockAt: 7 });
  // Only owners approve.
  assert.strictEqual((await call(`/api/admin/approvals/${a.id}/approve`, 'POST', {}, cat.token)).status, 403);
  const ok = await call(`/api/admin/approvals/${a.id}/approve`, 'POST', { note: 'fine' }, owner);
  assert.strictEqual(ok.status, 200, ok.text);
  assert.strictEqual(ok.json.approval.status, 'approved');
  const apron = (await call('/api/admin/catalog/apron', 'GET', undefined, owner)).json;
  assert.strictEqual(apron.lowStockAt, 7);
  assert.strictEqual(apron.updatedBy, 'cat2', 'made by the team member');
  assert.strictEqual((await call(`/api/admin/approvals/${a.id}/approve`, 'POST', {}, owner)).status, 409, 'once');
  // The activity log has both: the request and the approved change, with who approved it.
  const log = (await call('/api/admin/activity', 'GET', undefined, owner)).json.entries;
  assert.ok(log.some((e) => e.approvalId === a.id && e.status === 202 && e.whoId === cat.id));
  assert.ok(log.some((e) => e.approvalId === a.id && e.status === 200 && e.whoId === cat.id && e.approvedBy === 'owner'));
  // The team member's own log has only their entries.
  const mine = (await call('/api/admin/activity', 'GET', undefined, cat.token)).json.entries;
  assert.ok(mine.length && mine.every((e) => e.whoId === cat.id));
});

test('refused and withdrawn changes never happen; photos (binary) wait and apply too', async () => {
  const cat = await addMember('cat3', ['catalogue']);
  const before = (await call('/api/admin/catalog/mug', 'GET', undefined, owner)).json.lowStockAt;
  const r1 = await call('/api/admin/catalog/mug', 'PUT', { lowStockAt: 3 }, cat.token);
  const no = await call(`/api/admin/approvals/${r1.json.approval.id}/reject`, 'POST', { note: 'not now' }, owner);
  assert.strictEqual(no.json.approval.status, 'rejected');
  assert.strictEqual(no.json.approval.note, 'not now');
  const r2 = await call('/api/admin/catalog/mug', 'PUT', { lowStockAt: 4 }, cat.token);
  const other = await addMember('cat4', ['catalogue']);
  assert.strictEqual((await call(`/api/admin/approvals/${r2.json.approval.id}`, 'DELETE', undefined, other.token)).status, 403, 'not someone else\'s');
  assert.strictEqual((await call(`/api/admin/approvals/${r2.json.approval.id}`, 'DELETE', undefined, cat.token)).json.approval.status, 'withdrawn');
  assert.strictEqual((await call(`/api/admin/approvals/${r2.json.approval.id}/approve`, 'POST', {}, owner)).status, 409);
  assert.strictEqual((await call('/api/admin/catalog/mug', 'GET', undefined, owner)).json.lowStockAt, before);
  // A product photo (sent as a picture, not JSON).
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#cc3333' } }).png().toBuffer();
  const up = await call('/api/admin/catalog/notebook/photos', 'POST', png, cat.token, { 'Content-Type': 'image/png' });
  assert.strictEqual(up.status, 202, up.text);
  assert.deepStrictEqual(Object.keys(up.json.approval.details), ['bytes', 'type']);
  const ok = await call(`/api/admin/approvals/${up.json.approval.id}/approve`, 'POST', {}, owner);
  assert.strictEqual(ok.json.approval.status, 'approved', ok.text);
  assert.strictEqual((await call('/api/admin/catalog/notebook', 'GET', undefined, owner)).json.photos.length, 1);
});

test('money changes by finance wait; their cost edit keeps the owner\'s prices', async () => {
  const fin = await addMember('fin2', ['finance']);
  const c = await call('/api/admin/coupons', 'POST', { code: 'FIN10', type: 'percent', value: 10 }, fin.token);
  assert.strictEqual(c.status, 202, c.text);
  assert.match(c.json.approval.summary.en, /FIN10/);
  assert.ok(!(await call('/api/admin/coupons', 'GET', undefined, owner)).json.coupons.some((x) => x.code === 'FIN10'));
  await call(`/api/admin/approvals/${c.json.approval.id}/approve`, 'POST', {}, owner);
  assert.ok((await call('/api/admin/coupons', 'GET', undefined, owner)).json.coupons.some((x) => x.code === 'FIN10'));
  const e = await call('/api/admin/expenses', 'POST', { amount: 250, category: 'other', date: '2026-11-25', note: 'tape' }, fin.token);
  assert.strictEqual(e.status, 202, e.text);
  // Costs of a product: the prices stay the owner's (the screen sends them along).
  const before = (await call('/api/admin/pricing', 'GET', undefined, owner)).json.products.find((p) => p.id === 'mug');
  const p = await call('/api/admin/pricing/mug', 'PUT', { basePrice: 1, costs: { blank: 40 } }, fin.token);
  assert.strictEqual(p.status, 202, p.text);
  assert.strictEqual((await call(`/api/admin/approvals/${p.json.approval.id}/approve`, 'POST', {}, owner)).json.approval.status, 'approved');
  const after = (await call('/api/admin/pricing', 'GET', undefined, owner)).json.products.find((x) => x.id === 'mug');
  assert.strictEqual(after.basePrice, before.basePrice);
  assert.strictEqual(after.costs.blank, 40);
  // The owner's own changes happen at once.
  assert.strictEqual((await call('/api/admin/coupons', 'POST', { code: 'OWN5', type: 'percent', value: 5 }, owner)).status, 201);
});

test('operations works on orders at once, sees no amounts, and every change is logged', async () => {
  const ops = await addMember('ops2', ['operations']);
  // An order to look at.
  const sharp = require('sharp');
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
  const d = await call('/api/designs', 'POST', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } });
  assert.strictEqual(d.status, 201, d.text);
  for (const name of d.json.files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    assert.strictEqual((await call(`/api/designs/${d.json.id}/files/${name}`, 'PUT', body, undefined, { 'x-upload-token': d.json.uploadToken })).status, 204);
  }
  assert.strictEqual((await call(`/api/designs/${d.json.id}/complete`, 'POST', undefined, undefined, { 'x-upload-token': d.json.uploadToken })).status, 200);
  const q = (await call('/api/cart/quote', 'POST', { designIds: [d.json.id] })).json;
  const o = await call('/api/orders', 'POST', { designIds: [d.json.id], expectedTotal: q.total, customer: { name: 'Test Buyer', phone: '01001234567', governorate: 'cairo', city: 'Nasr City', address: '1 Nile St' } });
  assert.strictEqual(o.status, 201, o.text);
  const orders = (await call('/api/admin/orders', 'GET', undefined, ops.token)).json.orders;
  const mine = orders.find((x) => x.id === o.json.id);
  for (const k of ['subtotal', 'total', 'discount']) assert.strictEqual(mine[k], undefined, k);
  assert.strictEqual(typeof mine.shipping, 'undefined');
  assert.strictEqual(mine.items[0].unitPrice, undefined);
  assert.strictEqual(mine.items[0].orderTotal, undefined);
  assert.ok(mine.customer.name && mine.items[0].productId, 'the rest is there');
  assert.ok(!/"(total|subtotal|unitPrice|price)":\d/.test(JSON.stringify(orders)), 'no amount anywhere');
  // Finance and owners see them.
  const fin = await addMember('fin3', ['finance']);
  assert.strictEqual((await call('/api/admin/orders', 'GET', undefined, fin.token)).json.orders.find((x) => x.id === o.json.id).total, o.json.total);
  // Daily work: at once.
  const itemId = mine.items[0].id;
  const s = await call(`/api/admin/items/${itemId}`, 'PATCH', { status: 'printing' }, ops.token);
  assert.strictEqual(s.status, 200, s.text);
  assert.strictEqual(s.json.price, undefined, 'the answer has no amounts either');
  const log = (await call('/api/admin/activity', 'GET', undefined, owner)).json.entries;
  const e = log.find((x) => x.whoId === ops.id && x.action === 'PATCH /api/admin/items/:itemId');
  assert.ok(e && e.status === 200 && e.body.status === 'printing' && e.label.en === 'Job status');
  // Their own actual cost entry is money: not theirs at all.
  assert.strictEqual((await call(`/api/admin/items/${itemId}/cost`, 'PATCH', { actualCost: 10 }, ops.token)).status, 403);
});

test('the shared password is the emergency way in: it works, and its use is logged', async () => {
  const login = await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' });
  assert.strictEqual(login.json.emergency, true);
  assert.deepStrictEqual(login.json.roles, ['owner']);
  const session = (await call('/api/admin/session', 'GET', undefined, login.json.token)).json;
  assert.strictEqual(session.emergency, true);
  assert.strictEqual(session.role, 'owner');
  const log = (await call('/api/admin/activity', 'GET', undefined, owner)).json.entries;
  assert.ok(log.some((e) => e.action === 'signIn' && e.emergency === true));
  // It can't be changed from the dashboard.
  assert.strictEqual((await call('/api/admin/me/password', 'PUT', { current: 'x', password: 'whatever-long-one' }, owner)).json.code, 'emergencyPassword');
});

test('two owners: a second owner signs in personally, approves, and can\'t switch themselves off', async () => {
  const o2 = await addMember('owner2', ['owner']);
  const session = (await call('/api/admin/session', 'GET', undefined, o2.token)).json;
  assert.strictEqual(session.role, 'owner');
  assert.ok(!session.emergency);
  assert.strictEqual((await call('/api/admin/staff', 'GET', undefined, o2.token)).status, 200);
  // Their own changes happen at once (an owner's).
  assert.strictEqual((await call('/api/admin/catalog/apron', 'PUT', { lowStockAt: 9 }, o2.token)).status, 200);
  assert.strictEqual((await call(`/api/admin/staff/${o2.id}`, 'PATCH', { active: false }, o2.token)).json.code, 'staffSelf');
  assert.strictEqual((await call(`/api/admin/staff/${o2.id}`, 'PATCH', { roles: ['finance'] }, o2.token)).json.code, 'staffSelf');
  assert.strictEqual((await call(`/api/admin/staff/${o2.id}`, 'DELETE', undefined, o2.token)).json.code, 'staffSelf');
});

test('switching someone off or changing their roles signs them out; they can change their own password', async () => {
  const m = await addMember('mem1', ['catalogue']);
  const ch = await call(`/api/admin/staff/${m.id}`, 'PATCH', { roles: ['operations'] }, owner);
  assert.deepStrictEqual(ch.json.roles, ['operations']);
  assert.strictEqual((await call('/api/admin/session', 'GET', undefined, m.token)).status, 401, 'new roles: sign in again');
  const t2 = (await signIn('mem1', 'mem1-long-password')).token;
  assert.strictEqual((await call('/api/admin/orders', 'GET', undefined, t2)).status, 200);
  // Own password.
  assert.strictEqual((await call('/api/admin/me/password', 'PUT', { current: 'wrong', password: 'mem1-new-long-password' }, t2)).json.code, 'wrongCurrentPassword');
  const pw = await call('/api/admin/me/password', 'PUT', { current: 'mem1-long-password', password: 'mem1-new-long-password' }, t2);
  assert.strictEqual(pw.status, 200, pw.text);
  assert.strictEqual((await call('/api/admin/session', 'GET', undefined, pw.json.token)).status, 200, 'the new sign-in works');
  assert.strictEqual((await call('/api/admin/session', 'GET', undefined, t2)).status, 401, 'the old one doesn\'t');
  // Switched off: out, and can't sign in.
  await call(`/api/admin/staff/${m.id}`, 'PATCH', { active: false }, owner);
  assert.strictEqual((await call('/api/admin/session', 'GET', undefined, pw.json.token)).status, 401);
  assert.strictEqual((await call('/api/admin/login', 'POST', { username: 'mem1', password: 'mem1-new-long-password' })).status, 401);
  // A new set-up link (forgotten password).
  await call(`/api/admin/staff/${m.id}`, 'PATCH', { active: true }, owner);
  const link = await call(`/api/admin/staff/${m.id}/setup-link`, 'POST', undefined, owner);
  const token = new URL(link.json.setupLink).searchParams.get('setup');
  assert.strictEqual((await call('/api/admin/setup', 'POST', { token, password: 'mem1-third-long-password' })).status, 200);
  assert.strictEqual((await call('/api/admin/login', 'POST', { username: 'mem1', password: 'mem1-third-long-password' })).status, 200);
});

test('a forged approval header gets nothing', async () => {
  const r = await call('/api/admin/catalog/apron', 'PUT', { lowStockAt: 1 }, undefined, { 'X-Approval-Replay': 'abc.def' });
  assert.strictEqual(r.status, 401);
});
