'use strict';

// The customer's order page needs the order's secret key (owner's decision, 25 Nov): the team works with
// order numbers, and a number alone must not show what was paid or let someone act for the customer.
// The customer's links (cart, emails, account) carry the key; the team opens the page through a 30-minute
// team link from the dashboard, without amounts for roles that don't have them. Orders placed before the
// keys came in still open with their number (links already sent keep working).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const notify = require('../src/notify');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN], reorder: [OPEN], accountSignup: [OPEN], accountLogin: [OPEN], accountLoginId: [OPEN] };
const CUSTOMER = { name: 'Mona Ali', phone: '01011112222', governorate: 'giza', city: 'Dokki', address: '5 Nile St', email: 'mona@example.com' };
let server;
let base;
let dataDir;
let owner;

async function start() {
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: LIMITS, cleanupEvery: 0, requireApproval: false });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  owner = (await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json.token;
}
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-orderkey-'));
  await start();
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
  return { status: r.status, json, text, headers: r.headers };
}
const signIn = async (username, password) => (await call('/api/admin/login', 'POST', { username, password })).json;
async function addMember(username, roles) {
  const r = await call('/api/admin/staff', 'POST', { name: username.toUpperCase(), username, roles }, owner);
  assert.strictEqual(r.status, 201, r.text);
  const token = new URL(r.json.setupLink).searchParams.get('setup');
  const done = await call('/api/admin/setup', 'POST', { token, password: `${username}-long-password` });
  assert.strictEqual(done.status, 200, done.text);
  return { id: r.json.id, token: (await signIn(username, `${username}-long-password`)).token };
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
async function makeDesign(headers = {}) {
  const res = await call('/api/designs', 'POST', { productId: 'tshirt', color: 'black', size: 'M', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } }, null, headers);
  assert.strictEqual(res.status, 201, res.text);
  const { id, uploadToken, files } = res.json;
  for (const name of files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    const up = await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken }, body });
    assert.strictEqual(up.status, 204);
  }
  const done = await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } });
  assert.strictEqual(done.status, 200);
  return id;
}
async function placeOrder(headers = {}) {
  const ids = [await makeDesign(headers), await makeDesign(headers)];
  const q = (await call('/api/cart/quote', 'POST', { designIds: ids })).json;
  const o = await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: ids, expectedTotal: q.total, orderKey: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }, null, headers);
  assert.strictEqual(o.status, 201, o.text);
  return o.json;
}
/** A team link as the dashboard gets it: the ticket, and the cookie that ties it to that browser. */
async function teamLink(orderId, tok) {
  const r = await call(`/api/admin/orders/${orderId}/team-view`, 'POST', undefined, tok);
  assert.strictEqual(r.status, 200, r.text);
  const cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_tv='));
  return { ...r.json, ticket: new URL(r.json.link, 'http://x').searchParams.get('team'), cookie, setCookie: (r.headers.getSetCookie() || []).find((c) => c.startsWith('pod_tv=')) };
}
const teamView = (orderId, t, headers = {}) => call(`/api/orders/${orderId}/team`, 'GET', undefined, null, { 'x-team-view': t.ticket, ...(t.cookie ? { Cookie: t.cookie } : {}), ...headers });
/** Every number in an answer that is one of the order's amounts (total, subtotal, shipping, item prices): as a JSON
 *  number anywhere in it (not inside a string: a random proof code or id may hold the same digits). */
function amountsIn(text, order) {
  const amounts = [order.total, order.subtotal, order.shipping, ...order.items.map((i) => i.price), ...order.items.map((i) => i.unitPrice)].filter((n) => typeof n === 'number' && n > 0);
  const numbers = [];
  (function walk(v) {
    if (typeof v === 'number') numbers.push(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  }(JSON.parse(text)));
  return [...new Set(amounts.filter((n) => numbers.includes(n)))];
}

test('a new order has a secret key: its number alone no longer opens the page, the key does', async () => {
  const order = await placeOrder();
  assert.match(order.key, /^[A-Za-z0-9_-]{22}$/, 'the cart gets the key with the new order');
  // The number alone: refused, with the message that says where the right link is.
  const bare = await call(`/api/orders/${order.id}`, 'GET', undefined, null, { 'x-lang': 'en' });
  assert.strictEqual(bare.status, 403);
  assert.strictEqual(bare.json.code, 'orderLinkNeeded');
  assert.match(bare.json.error, /order email/);
  assert.ok(!bare.text.includes(String(order.total)), 'no amounts in the refusal');
  // A wrong key, a key of another length, a key in the wrong place: refused.
  assert.strictEqual((await call(`/api/orders/${order.id}`, 'GET', undefined, null, { 'x-order-key': 'A'.repeat(22) })).status, 403);
  assert.strictEqual((await call(`/api/orders/${order.id}`, 'GET', undefined, null, { 'x-order-key': `${order.key}x` })).status, 403);
  assert.strictEqual((await call(`/api/orders/${order.id}?k[]=${order.key}`)).status, 403);
  // The key (header, or ?k= from the customer's link): the page, with the key for its own links.
  const byHeader = await call(`/api/orders/${order.id}`, 'GET', undefined, null, { 'x-order-key': order.key });
  assert.strictEqual(byHeader.status, 200);
  assert.strictEqual(byHeader.json.key, order.key);
  assert.strictEqual(byHeader.json.total, order.total);
  assert.match(byHeader.headers.get('cache-control'), /no-store/);
  assert.strictEqual((await call(`/api/orders/${order.id}?k=${order.key}`)).status, 200);
  // The key of one order doesn't open another.
  const other = await placeOrder();
  assert.strictEqual((await call(`/api/orders/${other.id}`, 'GET', undefined, null, { 'x-order-key': order.key })).status, 403);
  // A missing order: still "not found".
  assert.strictEqual((await call('/api/orders/00000000-0000-4000-8000-000000000000', 'GET', undefined, null, { 'x-order-key': order.key })).status, 404);
  // The key comes back with the order for the page's own links.
  assert.strictEqual((await call(`/api/orders/${order.id}?k=${order.key}`)).json.key, order.key);
});

test('order again and "send a new version" need the key too', async () => {
  const order = await placeOrder();
  const bare = await call(`/api/orders/${order.id}/reorder`, 'POST', {});
  assert.strictEqual(bare.status, 403);
  assert.strictEqual(bare.json.code, 'orderLinkNeeded');
  const withKey = await call(`/api/orders/${order.id}/reorder`, 'POST', {}, null, { 'x-order-key': order.key });
  assert.strictEqual(withKey.status, 200, withKey.text);
  assert.strictEqual(withKey.json.items.length, 2);
  const it = order.items[0];
  const nd = await makeDesign();
  const revise = await call(`/api/orders/${order.id}/items/${it.id}/revise`, 'POST', { designId: nd });
  assert.strictEqual(revise.status, 403);
  // (With the key it reaches the order: here it isn't waiting for changes.)
  assert.strictEqual((await call(`/api/orders/${order.id}/items/${it.id}/revise`, 'POST', { designId: nd }, null, { 'x-order-key': order.key })).status, 409);
});

test('a signed-in customer opens their own orders without the key; their account links carry it', async () => {
  const signup = await fetch(`${base}/api/account/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mona', phone: '01011112222', email: 'mona.key@example.com', password: 'longenough1' }) });
  assert.strictEqual(signup.status, 201);
  const cookie = signup.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_c='));
  const order = await placeOrder({ Cookie: cookie });
  assert.strictEqual((await call(`/api/orders/${order.id}`, 'GET', undefined, null, { Cookie: cookie })).status, 200);
  const mine = (await call('/api/account/orders', 'GET', undefined, null, { Cookie: cookie })).json.orders;
  assert.strictEqual(mine.find((o) => o.id === order.id).key, order.key);
  // Someone else's account: no.
  const other = await fetch(`${base}/api/account/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sara', phone: '01022223333', email: 'sara.key@example.com', password: 'longenough2' }) });
  const otherCookie = other.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('pod_c='));
  assert.strictEqual((await call(`/api/orders/${order.id}`, 'GET', undefined, null, { Cookie: otherCookie })).status, 403);
  // Signed out: the link (with its key) still works, the number alone doesn't.
  assert.strictEqual((await call(`/api/orders/${order.id}`)).status, 403);
});

test('the dashboard never gets an order\'s key, and a saved design no longer tells its price', async () => {
  const order = await placeOrder();
  const ops = await addMember('opskey', ['operations']);
  for (const tok of [owner, ops.token]) {
    for (const url of ['/api/admin/orders', '/api/admin/queue', '/api/admin/review', '/api/admin/customers']) {
      const r = await call(url, 'GET', undefined, tok);
      assert.ok(!r.text.includes(order.key), `${url} has no order key`);
      assert.ok(!/"(linkKey|orderKey)"/.test(r.text), `${url}: no key fields`);
    }
  }
  const d = await call(`/api/designs/${order.items[0].designId}`);
  assert.strictEqual(d.status, 200);
  assert.ok(!('price' in d.json) && !('unitPrice' in d.json), 'no price in the design answer');
  assert.ok(d.json.editor && d.json.productId, 'the editor still gets the design');
});

test('team link: operations see the order page without amounts or the customer\'s key; owners and finance with amounts', async () => {
  const order = await placeOrder();
  const full = (await call(`/api/orders/${order.id}?k=${order.key}`)).json;
  const ops = await addMember('opsview', ['operations']);
  const fin = await addMember('finview', ['finance']);
  const cat = await addMember('catview', ['catalogue']);

  // Catalogue people don't see orders: no team link.
  assert.strictEqual((await call(`/api/admin/orders/${order.id}/team-view`, 'POST', undefined, cat.token)).status, 403);
  // Not signed in: no link.
  assert.strictEqual((await call(`/api/admin/orders/${order.id}/team-view`, 'POST')).status, 401);
  assert.strictEqual((await call('/api/admin/orders/00000000-0000-4000-8000-000000000000/team-view', 'POST', undefined, ops.token)).status, 404);

  const opsLink = await teamLink(order.id, ops.token);
  assert.match(opsLink.link, new RegExp(`^/order\\?id=${order.id}&team=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}$`));
  assert.strictEqual(opsLink.invoice, null, 'no invoice for a role without amounts');
  assert.ok(!JSON.stringify(opsLink).includes(order.key));
  // The link works only in the browser that asked for it (an HttpOnly cookie, only for /api/orders).
  assert.match(opsLink.setCookie, /^pod_tv=[A-Za-z0-9_-]{32}; Path=\/api\/orders; HttpOnly; SameSite=Strict/);
  const view = await teamView(order.id, opsLink);
  assert.strictEqual(view.status, 200, view.text);
  assert.strictEqual(view.json.team.amounts, false);
  assert.strictEqual(view.json.number, order.number);
  assert.strictEqual(view.json.items.length, 2);
  for (const k of ['total', 'subtotal', 'shipping', 'discount', 'coupon', 'key', 'customerLink']) assert.ok(!(k in view.json), `no ${k}`);
  for (const it of view.json.items) assert.ok(!('price' in it) && !('unitPrice' in it), 'no item prices');
  assert.deepStrictEqual(amountsIn(view.text, full), [], 'no amount anywhere in the answer');
  assert.ok(!view.text.includes(order.key));
  // Copied to another browser (no cookie, or that browser's own): nothing.
  assert.strictEqual((await teamView(order.id, { ticket: opsLink.ticket })).status, 401);
  const elsewhere = await teamLink(order.id, ops.token);
  assert.strictEqual((await teamView(order.id, { ticket: opsLink.ticket, cookie: elsewhere.cookie })).status, 401);
  // The link is for that order only, and needs the link itself; a changed link is refused.
  const other = await placeOrder();
  assert.strictEqual((await teamView(other.id, opsLink)).status, 401);
  assert.strictEqual((await call(`/api/orders/${order.id}/team`, 'GET', undefined, null, { Cookie: opsLink.cookie })).status, 401);
  assert.strictEqual((await teamView(order.id, { ...opsLink, ticket: 'x'.repeat(40) + '.' + 'y'.repeat(43) })).status, 401);
  const [body, sig] = opsLink.ticket.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), e: Date.now() + 864e5 })).toString('base64url');
  assert.strictEqual((await teamView(order.id, { ...opsLink, ticket: `${forged}.${sig}` })).status, 401, 'a longer life is not signed');
  // The customer's own page stays shut to the bare number for operations too.
  assert.strictEqual((await call(`/api/orders/${order.id}`, 'GET', undefined, ops.token)).status, 403);

  // Finance: amounts, the invoice, but not the customer's link.
  const finLink = await teamLink(order.id, fin.token);
  assert.match(finLink.invoice, /^\/invoice\?id=.+&team=/);
  const finView = (await teamView(order.id, finLink)).json;
  assert.strictEqual(finView.team.amounts, true);
  assert.strictEqual(finView.total, full.total);
  assert.ok(!('customerLink' in finView) && !('key' in finView));

  // An owner: amounts, and the customer's own link to pass on (a guest who lost the email).
  const ownView = (await teamView(order.id, await teamLink(order.id, owner))).json;
  assert.strictEqual(ownView.team.amounts, true);
  assert.strictEqual(ownView.team.owner, true);
  assert.ok(ownView.customerLink.endsWith(`/order?id=${order.id}&k=${order.key}`));
  assert.ok(!('key' in ownView));
});

test('a team link ends with the sign-in that made it: signed out, switched off, role changed, or after 30 minutes', async () => {
  const order = await placeOrder();
  const open = (tok) => teamLink(order.id, tok);
  const view = (t) => teamView(order.id, t, { 'x-lang': 'en' });

  // Signed out.
  const a = await addMember('opsout', ['operations']);
  const t1 = await open(a.token);
  assert.strictEqual((await view(t1)).status, 200);
  await call('/api/admin/logout', 'POST', undefined, a.token);
  const ended = await view(t1);
  assert.strictEqual(ended.status, 401);
  assert.strictEqual(ended.json.code, 'teamViewOver');
  assert.match(ended.json.error, /30 minutes/);

  // Switched off by an owner.
  const b = await addMember('opsoff', ['operations']);
  const t2 = await open(b.token);
  assert.strictEqual((await view(t2)).status, 200);
  assert.strictEqual((await call(`/api/admin/staff/${b.id}`, 'PATCH', { active: false }, owner)).status, 200);
  assert.strictEqual((await view(t2)).status, 401);

  // Moved to a role without orders.
  const c = await addMember('opsmove', ['operations']);
  const t3 = await open(c.token);
  const moved = await call(`/api/admin/staff/${c.id}`, 'PATCH', { roles: ['catalogue'] }, owner);
  assert.strictEqual(moved.status, 200, moved.text);
  assert.strictEqual((await view(t3)).status, 401);

  // A role that gains amounts sees them on the next refresh (the person as they are now).
  const d = await addMember('opsup', ['operations']);
  const t4 = await open(d.token);
  assert.strictEqual((await view(t4)).json.team.amounts, false);
  assert.strictEqual((await call(`/api/admin/staff/${d.id}`, 'PATCH', { roles: ['operations', 'finance'] }, owner)).status, 200);
  const up = await view(t4);
  // (A role change may end their sign-in; either way no stale view of what they may see.)
  assert.ok(up.status === 401 || up.json.team.amounts === true);

  // After 30 minutes.
  const t5 = await open(owner);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 31 * 60e3;
    assert.strictEqual((await view(t5)).status, 401);
  } finally {
    Date.now = realNow;
  }
});

test('a team link works on every copy of the shop and after a restart (nothing kept in one copy\'s memory)', async () => {
  const order = await placeOrder();
  const ops = await addMember('opscopies', ['operations']);
  const t = await teamLink(order.id, ops.token);
  // A second copy of the app on the same data folder.
  const app2 = createApp({ dataDir, adminPassword: 'secret-owner-pass', limits: LIMITS, cleanupEvery: 0, requireApproval: false });
  const server2 = await new Promise((resolve) => { const s = app2.listen(0, () => resolve(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${server2.address().port}/api/orders/${order.id}/team`, { headers: { 'x-team-view': t.ticket, Cookie: t.cookie } });
    assert.strictEqual(r.status, 200, await r.clone().text());
    assert.strictEqual((await r.json()).team.amounts, false);
  } finally {
    server2.close();
  }
  // A restart of this copy.
  server.close();
  await start();
  assert.strictEqual((await teamView(order.id, t)).status, 200);
});

test('the browser a guest ordered from opens their order without the key (an old cart page, no storage, a proof link)', async () => {
  const ids = [await makeDesign()];
  const q = (await call('/api/cart/quote', 'POST', { designIds: ids })).json;
  const placed = await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: ids, expectedTotal: q.total, orderKey: `cart-cookie-${Date.now()}` });
  assert.strictEqual(placed.status, 201);
  const set = placed.headers.getSetCookie().find((c) => c.startsWith('pod_orders='));
  assert.match(set, /; Path=\/api\/orders; Max-Age=\d+; HttpOnly; SameSite=Lax/);
  const cookie = set.split(';')[0];
  const order = placed.json;
  assert.strictEqual((await call(`/api/orders/${order.id}`, 'GET', undefined, null, { Cookie: cookie })).status, 200);
  // Another order's key in the cookie opens nothing else; a made-up pair neither.
  const other = await placeOrder();
  assert.strictEqual((await call(`/api/orders/${other.id}`, 'GET', undefined, null, { Cookie: cookie })).status, 403);
  assert.strictEqual((await call(`/api/orders/${other.id}`, 'GET', undefined, null, { Cookie: `pod_orders=${other.id}~${'A'.repeat(22)}` })).status, 403);
  // A refusal is never cached either.
  const bare = await call(`/api/orders/${other.id}`);
  assert.strictEqual(bare.status, 403);
  assert.match(bare.headers.get('cache-control'), /no-store/);
});

test('the cart\'s "was my order placed?" answer has the key and keeps the order on this browser', async () => {
  const ids = [await makeDesign()];
  const q = (await call('/api/cart/quote', 'POST', { designIds: ids })).json;
  const cartKey = `cart-bykey-${Date.now()}-abcdef`;
  const placed = await call('/api/orders', 'POST', { customer: CUSTOMER, designIds: ids, expectedTotal: q.total, orderKey: cartKey });
  assert.strictEqual(placed.status, 201);
  const r = await call(`/api/orders/by-key/${cartKey}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.key, placed.json.key);
  assert.ok(r.headers.getSetCookie().some((c) => c.startsWith(`pod_orders=${placed.json.id}~${placed.json.key}`)));
});

test('a proof and a saved design tell no prices (the team sees design ids and proof links)', async () => {
  const res = await call('/api/designs', 'POST', { productId: 'tshirt', color: 'black', size: 'M', quantities: [{ color: 'black', size: 'M', qty: 2 }, { color: 'black', size: 'L', qty: 3 }], sides: { front: { editor: { objects: [{ type: 'i-text', text: 'hi' }] } } } });
  assert.strictEqual(res.status, 201, res.text);
  const { id, uploadToken, files } = res.json;
  for (const name of files) {
    const body = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : name.includes('print') ? await png(3600, 4800) : await png(60, 72);
    assert.strictEqual((await fetch(`${base}/api/designs/${id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': uploadToken }, body })).status, 204);
  }
  assert.strictEqual((await fetch(`${base}/api/designs/${id}/complete`, { method: 'POST', headers: { 'x-upload-token': uploadToken } })).status, 200);
  const proof = await call(`/api/designs/${id}/proof`);
  assert.strictEqual(proof.status, 200, proof.text);
  assert.ok(Array.isArray(proof.json.quantities) && proof.json.quantities.length === 2, 'the quantities are there');
  assert.ok(!/unitPrice|packPrice|lineTotal|"price"/.test(proof.text), 'no prices in the proof');
  const design = await call(`/api/designs/${id}`);
  assert.ok(!/unitPrice|packPrice|lineTotal|"price"/.test(JSON.stringify({ ...design.json, editor: null })), 'no prices in the saved design');
});

test('orders from before the keys came in still open with their number (links already sent keep working)', async () => {
  const order = await placeOrder();
  server.close();
  // The order as it was saved before: no key.
  const file = path.join(dataDir, 'db.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete db.orders.find((o) => o.id === order.id).linkKey;
  fs.writeFileSync(file, JSON.stringify(db));
  await start();
  const r = await call(`/api/orders/${order.id}`);
  assert.strictEqual(r.status, 200);
  assert.ok(!('key' in r.json));
  assert.strictEqual((await call(`/api/orders/${order.id}/reorder`, 'POST', {})).status, 200);
});

test('customer emails link to the order with its key; the shop\'s own messages never carry it', () => {
  const order = { id: 'abc-123', linkKey: 'Key_key-1234567890123', number: 'POD-1' };
  assert.strictEqual(notify.orderLink('https://ebda3.me/', order), 'https://ebda3.me/order?id=abc-123&k=Key_key-1234567890123');
  assert.strictEqual(notify.orderLink('https://ebda3.me', order, 'invoice'), 'https://ebda3.me/invoice?id=abc-123&k=Key_key-1234567890123');
  assert.strictEqual(notify.orderLink('https://ebda3.me', { id: 'old-1' }), 'https://ebda3.me/order?id=old-1');
  assert.strictEqual(notify.orderLink('', order), '');
  // The shop's WhatsApp text about a customer's new version links to the dashboard only.
  const text = notify.revisionText({ ...order, items: [{ id: 'i1', productName: { en: 'Mug', ar: 'مج' } }] }, { id: 'i1', productName: { en: 'Mug', ar: 'مج' } }, { admin: 'https://ebda3.me/admin' }, 'en');
  assert.ok(!text.includes(order.linkKey));
});
