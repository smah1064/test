'use strict';

// Private preview: until the shop opens, only invited people (personal link or code), the owner and
// staff get in; everyone else sees the "Opening soon" page and data/pictures answer 403.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('../src/app');
const preview = require('../src/preview');

const PASS = 'secret-owner-pass';
const start = async (opts = {}) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-preview-'));
  const app = createApp({ dataDir, adminPassword: PASS, cleanupEvery: 0, requireApproval: false, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dataDir, server, base, stop: () => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
};
const cookieOf = (res) => {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const c = all.find((x) => x.startsWith(`${preview.COOKIE}=`));
  return c ? c.split(';')[0] : '';
};
/** A request sent exactly as written (fetch would tidy "/js/../" away). */
const raw = (base, p) => new Promise((resolve, reject) => {
  const u = new URL(base);
  http.get({ host: u.hostname, port: u.port, path: p, headers: { accept: 'text/html' } }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});

test('preview cookies: signed, named, and they expire', () => {
  const key = Buffer.alloc(32, 7);
  const v = preview.sign(key, 'p-abc123');
  assert.deepStrictEqual(preview.verify(key, v), { who: 'p-abc123' });
  assert.strictEqual(preview.verify(Buffer.alloc(32, 8), v), null, 'another shop\'s key');
  assert.strictEqual(preview.verify(key, v.replace('p-abc123', 'owner')), null, 'tampered');
  assert.strictEqual(preview.verify(key, preview.sign(key, 'owner', Date.now() - 61 * 864e5)), null, 'expired');
  assert.strictEqual(preview.verify(key, 'garbage'), null);
  assert.match(preview.newCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.strictEqual(preview.normCode(' k7qx-4mpa '), 'K7QX4MPA');
});

test('without previewStart (tests, PREVIEW_LOCK=off) the shop is open as before', async () => {
  const s = await start();
  try {
    const home = await fetch(s.base + '/');
    assert.strictEqual(home.status, 200);
    assert.ok(!(await home.text()).includes('/api/preview/enter'));
    assert.strictEqual((await fetch(s.base + '/api/products')).status, 200);
  } finally { s.stop(); }
});

test('private: Opening soon for everyone else, invited people, owner and staff get in', async () => {
  const s = await start({ previewStart: true });
  try {
    const { base } = s;
    // Everyone else.
    const home = await fetch(base + '/', { headers: { accept: 'text/html' } });
    assert.strictEqual(home.status, 200);
    assert.match(await home.text(), /\/api\/preview\/enter/);
    assert.strictEqual(home.headers.get('x-robots-tag'), 'noindex, nofollow');
    const page = await fetch(base + '/product?id=tshirt', { headers: { accept: 'text/html' } });
    assert.match(await page.text(), /\/api\/preview\/enter/, 'any page shows Opening soon');
    const api = await fetch(base + '/api/products');
    assert.strictEqual(api.status, 403);
    assert.match((await api.json()).error, /invited/);
    for (const p of ['/img/lifestyle/tshirt.webp', '/api/thumbs/tshirt/white.webp', '/api/library', '/mockups/photos/tshirt-front.webp']) {
      assert.strictEqual((await fetch(base + p)).status, 403, p);
    }
    assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \//);
    // What the Opening soon page and the dashboard's sign-in need stays reachable.
    for (const p of ['/js/common.js', '/css/styles.css', '/fonts/fonts.css', '/img/logo-ar.svg', '/favicon.svg', '/admin', '/img/og-ebda3.png']) {
      assert.strictEqual((await fetch(base + p)).status, 200, p);
    }
    // The dashboard opens with its own password, however its address is written.
    for (const p of ['/admin', '/admin/', '/admin.html', '/Admin', '/ADMIN/']) {
      const r = await fetch(base + p, { headers: { accept: 'text/html' } });
      const html = await r.text();
      assert.strictEqual(r.status, 200, p);
      assert.ok(!html.includes('/api/preview/enter') && html.includes('id="login"'), p);
    }
    // Paths dressed up as open ones don't get through.
    for (const p of ['/js/../img/lifestyle/tshirt.webp', '/js/%2e%2e/img/lifestyle/tshirt.webp', '/js/..%2fimg/lifestyle/tshirt.webp', '/css/..\\img/lifestyle/tshirt.webp']) {
      assert.notStrictEqual(await raw(base, p), 200, p);
    }
    // The owner signs in: the dashboard works, and the browser gets in.
    const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASS }) });
    const ownerCookie = cookieOf(login);
    assert.ok(ownerCookie, 'cookie at sign-in');
    const { token } = await login.json();
    const admin = (url, method = 'GET', body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.strictEqual((await fetch(base + '/api/products', { headers: { cookie: ownerCookie } })).status, 200);
    assert.strictEqual((await admin('/api/products')).status, 200, 'the dashboard\'s own requests');
    let state = await (await admin('/api/admin/preview')).json();
    assert.deepStrictEqual(state, { on: true, people: [] });
    assert.strictEqual((await fetch(base + '/api/admin/preview')).status, 401);
    // The owner's own code: typed with "@", spaces or small letters, it is the same code.
    const ezz = await (await admin('/api/admin/preview/people', 'POST', { name: 'Ezzat', code: '@ezzatinvite' })).json();
    assert.strictEqual(ezz.code, 'EZZATINVITE');
    assert.strictEqual((await admin('/api/admin/preview/people', 'POST', { name: 'Again', code: 'EzzatInvite' })).status, 409);
    assert.strictEqual((await admin('/api/admin/preview/people', 'POST', { name: 'Short', code: 'ab' })).status, 400);
    const typedOwn = await fetch(base + '/api/preview/enter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=%40ezzatinvite', redirect: 'manual' });
    assert.ok(cookieOf(typedOwn), 'typed as given, with the @');
    await admin(`/api/admin/preview/people/${ezz.id}`, 'DELETE');
    // Invite someone: a personal link.
    assert.strictEqual((await admin('/api/admin/preview/people', 'POST', { name: '  ' })).status, 400);
    const mona = await (await admin('/api/admin/preview/people', 'POST', { name: 'Mona (designer)' })).json();
    assert.match(mona.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.ok(mona.link.endsWith(`/?invite=${mona.code}`));
    const open = await fetch(`${base}/product?id=mug&invite=${mona.code}`, { redirect: 'manual' });
    assert.strictEqual(open.status, 303);
    assert.strictEqual(open.headers.get('location'), '/product?id=mug', 'back to the page, without the code');
    const monaCookie = cookieOf(open);
    assert.ok(monaCookie);
    const inside = await fetch(base + '/', { headers: { cookie: monaCookie, accept: 'text/html' } });
    assert.ok(!(await inside.text()).includes('/api/preview/enter'), 'the real shop');
    assert.strictEqual((await fetch(base + '/api/products', { headers: { cookie: monaCookie } })).status, 200);
    state = await (await admin('/api/admin/preview')).json();
    assert.ok(state.people[0].lastSeen && state.people[0].visits === 1);
    // Or typed on the Opening soon page (a plain form), in any case and with spaces.
    const typed = await fetch(base + '/api/preview/enter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `code=${encodeURIComponent(' ' + mona.code.toLowerCase().slice(0, 4) + '-' + mona.code.toLowerCase().slice(4))}`, redirect: 'manual' });
    assert.strictEqual(typed.headers.get('location'), '/');
    assert.ok(cookieOf(typed));
    // A wrong code says so; too many wrong ones wait.
    const wrong = await fetch(base + '/?invite=AAAAAAAA', { redirect: 'manual' });
    assert.strictEqual(wrong.headers.get('location'), '/?code=wrong');
    assert.ok(!cookieOf(wrong));
    let last;
    for (let i = 0; i < 12; i++) last = await fetch(base + '/api/preview/enter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=ZZZZZZZZ', redirect: 'manual' });
    assert.strictEqual(last.headers.get('location'), '/?code=wait');
    // Turned off: shut out at once (same cookie); back on: in again.
    assert.strictEqual((await admin(`/api/admin/preview/people/${mona.id}`, 'PATCH', { off: true })).status, 200);
    assert.strictEqual((await fetch(base + '/api/products', { headers: { cookie: monaCookie } })).status, 403);
    await admin(`/api/admin/preview/people/${mona.id}`, 'PATCH', { off: false });
    assert.strictEqual((await fetch(base + '/api/products', { headers: { cookie: monaCookie } })).status, 200);
    // A forged or tampered cookie gets nothing.
    assert.strictEqual((await fetch(base + '/api/products', { headers: { cookie: monaCookie.replace(/p-[0-9a-f]+/, 'owner') } })).status, 403);
    // Removed: shut out.
    await admin(`/api/admin/preview/people/${mona.id}`, 'DELETE');
    assert.strictEqual((await fetch(base + '/api/products', { headers: { cookie: monaCookie } })).status, 403);
    // Open to everyone.
    assert.strictEqual((await admin('/api/admin/preview', 'PUT', { on: 'yes' })).status, 400);
    assert.strictEqual((await (await admin('/api/admin/preview', 'PUT', { on: false })).json()).on, false);
    assert.strictEqual((await fetch(base + '/api/products')).status, 200);
    assert.ok(!(await fetch(base + '/')).headers.get('x-robots-tag'));
  } finally { s.stop(); }
});

test('staff sign in through the private shop and get in too', async () => {
  const s = await start({ previewStart: true });
  try {
    const { base } = s;
    const { token } = await (await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASS }) })).json();
    const made = await fetch(base + '/api/admin/staff', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username: 'nour', password: 'Product-Manager-2026!', role: 'products', name: 'Nour' }) });
    assert.strictEqual(made.status, 201, await made.clone().text());
    const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nour', password: 'Product-Manager-2026!' }) });
    assert.strictEqual(login.status, 200, await login.clone().text());
    const c = cookieOf(login);
    assert.match(c, /=s-/);
    assert.strictEqual((await fetch(base + '/api/products', { headers: { cookie: c } })).status, 200);
    // Staff can't manage the invitations.
    const staffToken = (await login.json()).token;
    assert.strictEqual((await fetch(base + '/api/admin/preview', { headers: { Authorization: `Bearer ${staffToken}` } })).status, 401);
  } finally { s.stop(); }
});
