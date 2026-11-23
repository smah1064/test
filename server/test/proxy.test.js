// With TRUST_PROXY=false the server must ignore X-Forwarded-For, so nobody
// can pretend to be on the office network by sending a forged header.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'att-proxy-'));
process.env.TRUST_PROXY = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.COMPANY_TZ = 'UTC';

const { createApp } = require('../src/index');

test('forged X-Forwarded-For is ignored when no proxy is trusted', async () => {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, token, body, headers = {}) =>
    fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, data: await r.json(), headers: r.headers }));

  try {
    const admin = (await json('POST', '/api/auth/login', null, { emp_code: 'admin', password: 'admin123' })).data.token;
    const site = (await json('POST', '/api/admin/sites', admin, { name: 'Office', lat: 1, lng: 1, radius_m: 100, office_ips: '203.0.113.7' })).data;
    await json('POST', '/api/admin/employees', admin, { emp_code: 'P1', name: 'P', password: 'secret1', site_id: site.id });
    const login = await json('POST', '/api/auth/login', null, { emp_code: 'P1', password: 'secret1', portal: 'web' });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const me = await json('GET', '/api/attendance/me', login.data.token, null, { cookie, 'x-forwarded-for': '203.0.113.7' });
    assert.equal(me.data.office_network, 'off'); // the forged header did not count

    const myIp = await json('GET', '/api/admin/my-ip', admin, null, { 'x-forwarded-for': '203.0.113.7' });
    assert.equal(myIp.data.ip, '127.0.0.1');
    assert.equal(myIp.data.private, true);
  } finally {
    server.close();
  }
});
