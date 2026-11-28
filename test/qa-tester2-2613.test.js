'use strict';

// Tester 2 (11 pm Cairo, 26 Nov): the cart takes "EID2026" for the coupon EID-2026, but the dashboard still saved
// EID2026 (or EID_2026) beside it, so the same words typed two ways gave different discounts; the ready design
// ev-shella-trip still said «دهب ٢٠٢٥» (the 2025 → 2026 change only caught Latin digits).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t2-2613-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-owner' }) })).json()).token;
  const admin = (method, url, body, lang = 'en') => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-lang': lang, Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { base, admin, dataDir, close: () => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('a coupon code that differs from a saved one only by dashes or underscores is refused, saying which', async () => {
  const s = await start();
  try {
    const made = await s.admin('POST', '/api/admin/coupons', { code: 'EID-2026', type: 'percent', value: 10 });
    assert.strictEqual(made.status, 201, await made.clone().text());
    const eid = (await made.json()).coupon || {};
    for (const code of ['EID2026', 'eid_2026']) {
      const r = await s.admin('POST', '/api/admin/coupons', { code, type: 'fixed', value: 250 });
      assert.strictEqual(r.status, 409, code);
      const body = await r.json();
      assert.match(body.error, /EID-2026/, code);
    }
    const ar = await (await s.admin('POST', '/api/admin/coupons', { code: 'EID2026', type: 'fixed', value: 250 }, 'ar')).json();
    assert.match(ar.error, /EID-2026/);
    assert.match(ar.error, /[؀-ۿ]/);
    // The same code again: as before.
    const same = await s.admin('POST', '/api/admin/coupons', { code: 'eid-2026', type: 'percent', value: 5 });
    assert.strictEqual(same.status, 409);
    assert.match((await same.json()).error, /already exists/);
    // Another code made, then renamed to look like the first: refused too.
    const qa = await (await s.admin('POST', '/api/admin/coupons', { code: 'QA15', type: 'percent', value: 15 })).json();
    const id = (qa.coupon || qa).id;
    assert.ok(id, JSON.stringify(qa));
    const rename = await s.admin('PUT', `/api/admin/coupons/${id}`, { code: 'EID_2026' });
    assert.strictEqual(rename.status, 409);
    // Editing a coupon and keeping its own code still works.
    const keep = await s.admin('PUT', `/api/admin/coupons/${id}`, { value: 20 });
    assert.strictEqual(keep.status, 200, await keep.clone().text());
    assert.ok(eid);
  } finally {
    s.close();
  }
});

test('two codes saved before this check (EID-2026 and EID2026) can each still be edited', async () => {
  const s = await start();
  try {
    const a = await (await s.admin('POST', '/api/admin/coupons', { code: 'EID-2026', type: 'percent', value: 10 })).json();
    // (Written straight into the data, as a shop made before this check could have it.)
    const db = path.join(s.dataDir, 'db.json');
    const store = JSON.parse(fs.readFileSync(db, 'utf8'));
    assert.ok(Array.isArray(store.coupons) && store.coupons.length === 1, 'the coupon is in db.json');
    const twin = { ...store.coupons[0], id: 'twin-coupon-1', code: 'EID2026' };
    store.coupons.push(twin);
    fs.writeFileSync(db, JSON.stringify(store));
    // (The app reads its data file again only when it changes under it: a fresh app on the same folder.)
    const app2 = createApp({ dataDir: s.dataDir, adminPassword: 'secret-owner', cleanupEvery: 0, requireApproval: false });
    const server2 = await new Promise((resolve) => { const x = app2.listen(0, () => resolve(x)); });
    try {
      const base2 = `http://127.0.0.1:${server2.address().port}`;
      const token = (await (await fetch(`${base2}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-owner' }) })).json()).token;
      for (const id of [(a.coupon || a).id, 'twin-coupon-1']) {
        const r = await fetch(`${base2}/api/admin/coupons/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ active: false }) });
        assert.strictEqual(r.status, 200, `${id}: ${await r.clone().text()}`);
      }
    } finally {
      server2.close();
    }
  } finally {
    s.close();
  }
});

test('no ready design says 2025 in Arabic digits any more', async () => {
  const s = await start();
  try {
    const d = await (await fetch(`${s.base}/api/library/ev-shella-trip`)).json();
    const text = JSON.stringify(d);
    assert.match(text, /دهب ٢٠٢٦/);
    assert.doesNotMatch(text, /٢٠٢٥/);
    const packs = fs.readdirSync(path.join(__dirname, '../src/library-packs')).map((f) => fs.readFileSync(path.join(__dirname, '../src/library-packs', f), 'utf8')).join('\n');
    assert.doesNotMatch(packs, /٢٠٢٥/);
  } finally {
    s.close();
  }
});
