'use strict';

// QA tester 2 (25 Nov, 05:01–06:35): Google/Facebook sign-in limits, share replies without direction
// tricks, addresses that can receive mail, pack quantities for the printing house, minutes in Arabic.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const dispatch = require('../src/dispatch');
const i18n = require('../src/i18n');

async function shop(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0635-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}
const json = (base, method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });

test('starting Google sign-in never blocks password sign-in, and a busy connection gets a page, not JSON', async () => {
  const s = await shop({ oauthConfig: { google: { clientId: 'cid', clientSecret: 'sec' }, facebook: null }, limits: { oauthStart: [{ max: 15, ms: 15 * 60e3 }] } });
  try {
    const signup = await json(s.base, 'POST', '/api/account/signup', { name: 'Mona', phone: '01011112222', password: 'longenough1' });
    assert.strictEqual(signup.status, 201, await signup.clone().text());
    // Many customers behind one mobile IP: 15 sign-in starts go to Google.
    for (let i = 0; i < 15; i++) {
      const r = await fetch(`${s.base}/auth/google`, { redirect: 'manual' });
      assert.strictEqual(r.status, 302);
      assert.match(r.headers.get('location'), /accounts\.google\.com/);
    }
    // A password sign-in from the same IP still works.
    const login = await json(s.base, 'POST', '/api/account/login', { login: '01011112222', password: 'longenough1' });
    assert.strictEqual(login.status, 200, await login.clone().text());
    // Over the limit: back to the account page with a message (also from the cart).
    const busy = await fetch(`${s.base}/auth/google`, { redirect: 'manual' });
    assert.strictEqual(busy.status, 302);
    assert.strictEqual(busy.headers.get('location'), '/account?oauth=wait');
    const fromCart = await fetch(`${s.base}/auth/google?next=cart`, { redirect: 'manual' });
    assert.strictEqual(fromCart.headers.get('location'), '/account?oauth=wait&next=cart');
  } finally {
    s.close();
  }
});

test('"try again in N minutes" reads right in Arabic', () => {
  const ar = (min) => i18n.format('tooManyWait', { min }, 'ar');
  assert.match(ar(1), /دقيقة واحدة/);
  assert.match(ar(2), /دقيقتين/);
  assert.match(ar(5), /٥ دقايق/);
  assert.match(ar(15), /١٥ دقيقة/);
  assert.match(i18n.format('tooManyWait', { min: 5 }, 'en'), /in 5 min/);
});

test('share replies lose direction-control characters', async () => {
  const s = await shop();
  try {
    const img = 'data:image/png;base64,' + (await sharp({ create: { width: 60, height: 72, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64');
    const sh = await (await json(s.base, 'POST', '/api/shares', { productId: 'tshirt', color: 'navy', size: 'L', sides: { front: { objects: [{ type: 'i-text', text: 'hi' }] } }, previews: { front: img } })).json();
    const r = await json(s.base, 'POST', `/api/shares/${sh.id}/feedback`, { vote: 'change', comment: '‮abc def', name: 'Ali⁧ 2026⁩' });
    assert.strictEqual(r.status, 201, await r.clone().text());
    const last = (await r.json()).feedback.pop();
    assert.strictEqual(last.comment, 'abc def');
    assert.strictEqual(last.name, 'Ali 2026');
  } finally {
    s.close();
  }
});

test('an email address must be able to receive mail; a final dot from the phone keyboard is dropped', async () => {
  const s = await shop();
  try {
    const signup = await json(s.base, 'POST', '/api/account/signup', { name: 'Omar', phone: '01033334444', password: 'longenough1' });
    assert.strictEqual(signup.status, 201, await signup.clone().text());
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    const save = (email) => json(s.base, 'PUT', '/api/account', { name: 'Omar', email }, { cookie });
    const ok = await save('Dot.Test@Gmail.com.');
    assert.strictEqual(ok.status, 200, await ok.clone().text());
    assert.strictEqual((await ok.json()).customer.email, 'dot.test@gmail.com');
    for (const bad of ['a@b..com', 'a@b', 'a b@c.com', 'a@b.c', 'a@-b.com']) {
      const r = await save(bad);
      assert.strictEqual(r.status, 400, bad);
    }
  } finally {
    s.close();
  }
});

test('the printing house sees a mix of packs pack by pack, never added up as pieces', () => {
  const n = (en, ar) => ({ en, ar });
  const args = { house: { name: 'X' }, design: { sides: [] }, files: [], expires: '2026-12-24T00:00:00Z', order: { number: 'POD-3001', items: [{}] } };
  const vouchers = {
    position: 1, productId: 'giftvouchers', productName: n('Gift vouchers', 'كوبونات هدايا'), color: { name: n('White', 'أبيض') }, size: { id: '1', label: n('1 voucher', 'كوبون واحد') },
    quantities: [
      { color: { name: n('White', 'أبيض') }, size: { id: '1', label: n('1 voucher', 'كوبون واحد') }, qty: 2 },
      { color: { name: n('White', 'أبيض') }, size: { id: '10', label: n('10 vouchers', '10 كوبونات') }, qty: 1 },
    ],
  };
  const en = dispatch.whatsappText({ ...args, item: vouchers, lang: 'en' });
  assert.match(en, /\*Quantity:\* 1 voucher ×2 \+ 10 vouchers ×1/);
  assert.doesNotMatch(en, /\*Quantity:\* 3\b/);
  const ar = dispatch.whatsappText({ ...args, item: vouchers, lang: 'ar' });
  assert.match(ar, /كوبون واحد ×٢ \+ ١٠ كوبونات ×١/);
  // T-shirts (pieces): still added up.
  const shirts = {
    position: 1, productId: 'tshirt', productName: n('T-shirt', 'تيشيرت'), color: { name: n('White', 'أبيض') }, size: { id: 'S', label: n('S', 'S') },
    quantities: [
      { color: { name: n('White', 'أبيض') }, size: { id: 'S', label: n('S', 'S') }, qty: 2 },
      { color: { name: n('White', 'أبيض') }, size: { id: 'XL', label: n('XL', 'XL') }, qty: 1 },
    ],
  };
  assert.match(dispatch.whatsappText({ ...args, item: shirts, lang: 'en' }), /\*Quantity:\* 3\b/);
  // One pack size: its count of packs, as before.
  const one = { ...vouchers, quantities: [vouchers.quantities[1]] };
  assert.match(dispatch.whatsappText({ ...args, item: one, lang: 'en' }), /\*Quantity:\* 1\b/);
});
