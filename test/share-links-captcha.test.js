'use strict';

// Share links and the robot check (owner, 26 Nov: "robots are blocked, guests still share freely"): a new view-only
// link or opinion link from a guest needs the (invisible) Cloudflare check; a signed-in customer passed it at sign-up;
// updating one's own view link doesn't ask again.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const CFG = { siteKey: 'site-key-test', secret: 'secret-test' };
const fakeCloudflare = async (url, opts) => {
  const body = new URLSearchParams(String(opts.body));
  return new Response(JSON.stringify(body.get('response') === 'good' ? { success: true } : { success: false }), { headers: { 'content-type': 'application/json' } });
};
let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-sharecap-'));
  const limits = Object.fromEntries(['designs', 'views', 'shares', 'accountSignup', 'accountLogin', 'accountLoginId'].map((k) => [k, [OPEN]]));
  const app = createApp({ dataDir, adminPassword: 'secret', limits, cleanupEvery: 0, requireApproval: false, captcha: CFG, captchaFetch: fakeCloudflare });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': 'en', ...headers }, body: JSON.stringify(body) });
const page = async () => `data:image/jpeg;base64,${(await sharp({ create: { width: 300, height: 400, channels: 3, background: '#48c' } }).jpeg().toBuffer()).toString('base64')}`;

test('view-only links: a guest needs the check; a signed-in customer doesn\'t; updates don\'t ask again', async () => {
  const pages = [{ side: 'front', image: await page() }, { side: 'back', image: await page() }];
  const none = await post('/api/views', { productId: 'tshirt', pages });
  assert.strictEqual(none.status, 400);
  assert.strictEqual((await none.json()).code, 'captchaFailed');
  assert.strictEqual((await post('/api/views', { productId: 'tshirt', pages, captchaToken: 'bad' })).status, 400);
  const ok = await post('/api/views', { productId: 'tshirt', pages, captchaToken: 'good' });
  assert.strictEqual(ok.status, 201, await ok.clone().text());
  const { id, key } = await ok.json();
  const up = await fetch(`${base}/api/views/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-view-key': key }, body: JSON.stringify({ productId: 'tshirt', pages }) });
  assert.strictEqual(up.status, 200, 'the customer\'s own link updates without a new check');
  // Signed in (the check was at sign-up): no check here.
  const signup = await post('/api/account/signup', { name: 'Mona Ali', phone: '01033334444', email: `m${Date.now()}@example.com`, password: 'Garden-Lamp-42!', captchaToken: 'good' });
  assert.ok(signup.ok, await signup.clone().text());
  const cookie = (signup.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
  const mine = await post('/api/views', { productId: 'tshirt', pages }, { Cookie: cookie });
  assert.strictEqual(mine.status, 201, await mine.clone().text());
});

test('opinion links: the same rule', async () => {
  const body = { productId: 'mug', color: 'white', size: '11oz', sides: { front: { objects: [{ type: 'i-text', text: 'hi' }] } }, previews: {} };
  const none = await post('/api/shares', body);
  assert.strictEqual(none.status, 400);
  assert.strictEqual((await none.json()).code, 'captchaFailed');
  // With the check passed it goes on to the design itself (here: refused for its missing preview picture, not the check).
  const ok = await post('/api/shares', { ...body, captchaToken: 'good' });
  assert.notStrictEqual((await ok.json()).code, 'captchaFailed');
});
