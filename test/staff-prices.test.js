'use strict';

// A product manager (staff) can't change any selling price: not through a new size's add-on nor the
// embroidery price (QA 02:01, high).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

test('staff edits keep the money fields as they are', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-staffprices-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method, body, token) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const owner = (await (await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json()).token;
    assert.strictEqual((await call('/api/admin/staff', 'POST', { username: 'mona', password: 'Product-Manager-2026!', role: 'products', name: 'Mona' }, owner)).status, 201);
    const staff = (await (await call('/api/admin/login', 'POST', { username: 'mona', password: 'Product-Manager-2026!' })).json()).token;
    // (A product manager's change waits for the owner's approval, then runs as it was sent.)
    const approved = async (r) => {
      assert.strictEqual(r.status, 202, await r.clone().text());
      const a = (await r.json()).approval;
      const ok = await (await call(`/api/admin/approvals/${a.id}/approve`, 'POST', {}, owner)).json();
      assert.strictEqual(ok.approval.status, 'approved', JSON.stringify(ok));
      return ok;
    };
    const hoodie = async () => (await (await fetch(`${base}/api/products`)).json()).products.find((p) => p.id === 'hoodie');
    const before = await hoodie();
    await approved(await call('/api/admin/catalog/hoodie', 'PUT', { addSizes: [{ id: 'XS', label: { en: 'XS', ar: 'XS' }, surcharge: -500 }], embroidery: { at: 'chest', cm: [8, 8], surcharge: 0 } }, staff));
    const after = await hoodie();
    assert.strictEqual(after.sizes.find((z) => z.id === 'XS').surcharge, 0, 'a new size adds nothing');
    assert.strictEqual(after.embroidery.surcharge, before.embroidery.surcharge, 'embroidery keeps its price');
    // The owner can still set them.
    await call('/api/admin/catalog/hoodie', 'PUT', { addSizes: [{ id: 'XS', label: { en: 'XS', ar: 'XS' }, surcharge: -100 }] }, owner);
    assert.strictEqual((await hoodie()).sizes.find((z) => z.id === 'XS').surcharge, -100);
    // ...and a product manager's later edit keeps the owner's add-on.
    await approved(await call('/api/admin/catalog/hoodie', 'PUT', { addSizes: [{ id: 'XS', label: { en: 'XS', ar: 'XS' }, surcharge: 999 }] }, staff));
    assert.strictEqual((await hoodie()).sizes.find((z) => z.id === 'XS').surcharge, -100);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
