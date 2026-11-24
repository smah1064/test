'use strict';

// CAPTCHA (Cloudflare Turnstile) on sign-up, sign-in, password-reset requests and checkout.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const captcha = require('../src/captcha');

const OPEN = { max: 1e6, ms: 1000 };
const CFG = { siteKey: 'site-key-test', secret: 'secret-test' };
// Cloudflare stand-in: only the token "good" passes.
const seen = [];
const fakeCloudflare = async (url, opts) => {
  const body = new URLSearchParams(String(opts.body));
  seen.push({ url, secret: body.get('secret'), response: body.get('response') });
  return new Response(JSON.stringify(body.get('response') === 'good' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }), { headers: { 'content-type': 'application/json' } });
};
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-captcha-'));
  const limits = Object.fromEntries(['designs', 'orders', 'accountSignup', 'accountLogin', 'accountLoginId', 'accountForgot', 'accountForgotId'].map((k) => [k, [OPEN]]));
  const app = createApp({ dataDir, adminPassword: 'secret', limits, cleanupEvery: 0, requireApproval: false, captcha: CFG, captchaFetch: fakeCloudflare });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const errorOf = async (res) => (await res.json()).code;

test('verify: missing, good, refused, Cloudflare down, wrong secret', async () => {
  assert.deepStrictEqual(await captcha.verify(CFG, '', '1.2.3.4', { fetchImpl: fakeCloudflare }), { ok: false, reason: 'missing' });
  assert.deepStrictEqual(await captcha.verify(CFG, 'x'.repeat(3000), null, { fetchImpl: fakeCloudflare }), { ok: false, reason: 'missing' });
  assert.deepStrictEqual(await captcha.verify(CFG, 'good', '1.2.3.4', { fetchImpl: fakeCloudflare }), { ok: true });
  assert.strictEqual(seen.at(-1).url, captcha.VERIFY_URL);
  assert.strictEqual(seen.at(-1).secret, CFG.secret);
  assert.strictEqual((await captcha.verify(CFG, 'bad', null, { fetchImpl: fakeCloudflare })).ok, false);
  const down = async () => { throw new Error('ECONNRESET'); };
  assert.deepStrictEqual(await captcha.verify(CFG, 'any', null, { fetchImpl: down }), { ok: true, unchecked: true });
  const badSecret = async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret'] }));
  assert.strictEqual((await captcha.verify(CFG, 'any', null, { fetchImpl: badSecret })).ok, true);
  // Off unless both keys are set.
  assert.strictEqual(captcha.fromEnv({ TURNSTILE_SITE_KEY: 'a' }), null);
  assert.deepStrictEqual(captcha.fromEnv({ TURNSTILE_SITE_KEY: 'a', TURNSTILE_SECRET_KEY: 'b' }), { siteKey: 'a', secret: 'b' });
});

test('the pages get the site key (never the secret) and may load Cloudflare on the forms', async () => {
  const r = await fetch(base + '/api/captcha');
  assert.deepStrictEqual(await r.json(), { siteKey: CFG.siteKey });
  for (const page of ['/cart', '/account']) {
    const csp = (await fetch(base + page)).headers.get('content-security-policy');
    assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/, page);
    assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com/, page);
  }
  assert.doesNotMatch((await fetch(base + '/')).headers.get('content-security-policy'), /cloudflare/);
  for (const page of ['/', '/cart', '/account', '/js/common.js']) assert.ok(!(await (await fetch(base + page)).text()).includes(CFG.secret));
});

test('sign-up, sign-in and password-reset requests need the CAPTCHA', async () => {
  const user = { name: 'Mona', phone: '01098765432', email: 'mona@example.com', password: 'a-long-password-1' };
  let r = await post('/api/account/signup', user);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(await errorOf(r), 'captchaFailed');
  assert.strictEqual((await post('/api/account/signup', { ...user, captchaToken: 'bad' })).status, 400);
  r = await post('/api/account/signup', { ...user, captchaToken: 'good' });
  assert.strictEqual(r.status, 201, await r.clone().text());
  r = await post('/api/account/login', { login: user.phone, password: user.password });
  assert.strictEqual(await errorOf(r), 'captchaFailed');
  assert.strictEqual((await post('/api/account/login', { login: user.phone, password: user.password, captchaToken: 'good' })).status, 200);
  assert.strictEqual(await errorOf(await post('/api/account/forgot', { login: user.email })), 'captchaFailed');
  assert.strictEqual((await post('/api/account/forgot', { login: user.email, captchaToken: 'good' })).status, 200);
});

test('checkout needs the CAPTCHA, checked after the prices (a token works only once)', async () => {
  const c = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json();
  for (const name of c.files) {
    const data = name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await sharp({ create: { width: name.includes('print') ? 1200 : 60, height: name.includes('print') ? 1050 : 52, channels: 4, background: '#cc3333' } }).png().toBuffer();
    await fetch(`${base}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: data });
  }
  const d = await (await fetch(`${base}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } })).json();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const customer = { name: 'منى', phone: '01012345678', governorate: 'cairo', city: 'نصر', address: '1 شارع' };
  const before = seen.length;
  // A wrong total is answered first, without asking Cloudflare (the token is not used up).
  assert.strictEqual((await post('/api/orders', { customer, designIds: [d.id], expectedTotal: q.total + 1, captchaToken: 'good' })).status, 409);
  assert.strictEqual(seen.length, before);
  assert.strictEqual(await errorOf(await post('/api/orders', { customer, designIds: [d.id], expectedTotal: q.total })), 'captchaFailed');
  const ok = await post('/api/orders', { customer, designIds: [d.id], expectedTotal: q.total, captchaToken: 'good' });
  assert.strictEqual(ok.status, 201, await ok.clone().text());
});
