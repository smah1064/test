'use strict';

// QA round on the last 24 hours' additions (25 Nov, 8:29–9:27 pm Cairo).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const preview = require('../src/preview');

let server;
let base;
let dataDir;
let owner;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa24h-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0 });
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
