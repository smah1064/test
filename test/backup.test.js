'use strict';

// Backups (owners): the whole data folder as one .tar.gz made in the background, downloaded through a signed
// link; the sign-in key and the backups themselves are left out; the team can't make or fetch one; a restored
// copy (unpacked into an empty folder) runs the shop with its orders.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { createApp } = require('../src/app');
const { Backups, tarStream, listFiles } = require('../src/backup');

const PASS = 'secret-owner-pass';
const start = async (opts = {}) => {
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pod-backup-'));
  const app = createApp({ dataDir, adminPassword: PASS, cleanupEvery: 0, requireApproval: false, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dataDir, base, stop: () => server.close() };
};
const call = async (base, url, method = 'GET', body, token) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: r.status, json, text, headers: r.headers };
};
/** The names and contents in a .tar.gz (read by this test itself, the plain way). */
function untar(buf) {
  const raw = zlib.gunzipSync(buf);
  const out = new Map();
  let long = null;
  for (let at = 0; at + 512 <= raw.length;) {
    const h = raw.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim(), 8);
    const type = String.fromCharCode(h[156]);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    assert.strictEqual(sum, parseInt(h.subarray(148, 154).toString('ascii'), 8), `checksum of ${name}`);
    const data = raw.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { long = data.toString('utf8').replace(/\0+$/, ''); continue; }
    out.set(long || name, Buffer.from(data));
    long = null;
  }
  return out;
}

test('the archive: every file with its bytes, long and Arabic names whole, the sign-in key and backups left out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-backup-unit-'));
  try {
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ orders: [{ id: 'o1' }] }));
    fs.writeFileSync(path.join(dir, '.session-secret'), 'a'.repeat(64));
    fs.writeFileSync(path.join(dir, '.signin-limits.json'), '{}');
    fs.mkdirSync(path.join(dir, 'backups'));
    fs.writeFileSync(path.join(dir, 'backups', 'old.tar.gz'), 'x');
    const deep = path.join(dir, 'library', 'uploads', 'b1', 'تصميمات رمضان', 'a-very-long-folder-name-that-goes-on-and-on-and-on');
    fs.mkdirSync(deep, { recursive: true });
    const big = Buffer.alloc(70000, 7);
    fs.writeFileSync(path.join(deep, 'فانوس-رمضان-كريم-٢٠٢٦.png'), big);
    fs.writeFileSync(path.join(dir, 'db.json.123.tmp'), 'half');
    fs.writeFileSync(path.join(dir, 'empty.txt'), '');
    const files = listFiles(dir);
    const chunks = [];
    const gz = tarStream(files, () => {}).pipe(zlib.createGzip());
    for await (const c of gz) chunks.push(c);
    const got = untar(Buffer.concat(chunks));
    assert.deepStrictEqual([...got.keys()].sort(), ['db.json', 'empty.txt', 'library/uploads/b1/تصميمات رمضان/a-very-long-folder-name-that-goes-on-and-on-and-on/فانوس-رمضان-كريم-٢٠٢٦.png'].sort());
    assert.strictEqual(JSON.parse(got.get('db.json')).orders[0].id, 'o1');
    assert.ok(got.get([...got.keys()].find((k) => k.endsWith('.png'))).equals(big));
    // The system's own tar unpacks it the same way (Arabic and long names, the picture's bytes).
    const tgz = path.join(os.tmpdir(), `bk-${process.pid}.tar.gz`);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-backup-untar-'));
    fs.writeFileSync(tgz, Buffer.concat(chunks));
    execFileSync('tar', ['-xzf', tgz, '-C', out]);
    for (const [name, data] of got) assert.ok(fs.readFileSync(path.join(out, name)).equals(data), name);
    fs.rmSync(tgz, { force: true });
    fs.rmSync(out, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('owners make a backup, download it through a signed link, and a copy restored from it runs the shop', async () => {
  const s = await start();
  let restored = null;
  try {
    const owner = (await call(s.base, '/api/admin/login', 'POST', { password: PASS })).json.token;
    const cp = await call(s.base, '/api/admin/coupons', 'POST', { code: 'KEEPME10', type: 'percent', value: 10, active: true }, owner);
    assert.ok(cp.status < 300, cp.text);
    assert.deepStrictEqual((await call(s.base, '/api/admin/backups', 'GET', undefined, owner)).json.backups, []);
    const made = await call(s.base, '/api/admin/backups', 'POST', undefined, owner);
    assert.strictEqual(made.status, 202, made.text);
    let list;
    for (let i = 0; i < 100; i++) {
      list = (await call(s.base, '/api/admin/backups', 'GET', undefined, owner)).json;
      if (!list.making && list.backups.length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(list.backups.length, 1);
    const b = list.backups[0];
    assert.match(b.name, /^ebda3-backup-\d{8}-\d{4}\.tar\.gz$/);
    // A second press while one is being made is refused; once done, another is fine.
    const link = await call(s.base, `/api/admin/backups/${b.name}/link`, 'POST', undefined, owner);
    assert.strictEqual(link.status, 200, link.text);
    assert.match(link.json.url, /^\/dl\/backup\//);
    const dl = await fetch(s.base + link.json.url);
    assert.strictEqual(dl.status, 200);
    assert.match(dl.headers.get('content-disposition'), /ebda3-backup-/);
    assert.match(dl.headers.get('cache-control'), /no-store/);
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.strictEqual(buf.length, b.bytes);
    // Resumable: a range of it.
    const part = await fetch(s.base + link.json.url, { headers: { Range: 'bytes=0-9' } });
    assert.strictEqual(part.status, 206);
    const files = untar(buf);
    assert.ok(files.has('db.json'));
    assert.ok(!files.has('.session-secret'), 'the sign-in key is never in a backup');
    assert.ok(![...files.keys()].some((k) => k.startsWith('backups/')));
    assert.match(files.get('db.json').toString(), /KEEPME10/);
    // A tampered or expired link: nothing.
    assert.strictEqual((await fetch(s.base + link.json.url.replace(/s=[^&]+/, 's=AAAA'))).status, 404);
    const expired = Backups.linkFor(Buffer.from('nope'), b.name, -1000);
    assert.strictEqual((await fetch(s.base + expired)).status, 404);
    // The activity log says who made and downloaded it.
    const act = (await call(s.base, '/api/admin/activity', 'GET', undefined, owner)).json.entries.map((e) => e.summary && e.summary.en).join('\n');
    assert.match(act, /Started a backup/);
    assert.match(act, /Downloaded the backup/);

    // Restored: unpacked into an empty folder, the shop starts with its coupon (a new sign-in key is made).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-restore-'));
    for (const [name, data] of files) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), data);
    }
    restored = await start({ dataDir: dir });
    const owner2 = (await call(restored.base, '/api/admin/login', 'POST', { password: PASS })).json.token;
    const coupons = (await call(restored.base, '/api/admin/coupons', 'GET', undefined, owner2)).json.coupons;
    assert.ok(coupons.some((c) => c.code === 'KEEPME10'));

    // Delete from the server.
    assert.strictEqual((await call(s.base, `/api/admin/backups/${b.name}`, 'DELETE', undefined, owner)).status, 200);
    assert.strictEqual((await fetch(s.base + link.json.url)).status, 404);
    assert.strictEqual((await call(s.base, `/api/admin/backups/${b.name}/link`, 'POST', undefined, owner)).status, 404);
  } finally {
    s.stop();
    if (restored) { restored.stop(); fs.rmSync(restored.dataDir, { recursive: true, force: true }); }
    fs.rmSync(s.dataDir, { recursive: true, force: true });
  }
});

test('the team can\'t make, list or download backups (owners only); odd names are refused', async () => {
  const s = await start();
  try {
    const owner = (await call(s.base, '/api/admin/login', 'POST', { password: PASS })).json.token;
    const add = await call(s.base, '/api/admin/staff', 'POST', { name: 'Ops Bk', username: 'opsbk', roles: ['operations', 'finance', 'catalogue'], password: 'operations-bk-pass' }, owner);
    assert.strictEqual(add.status, 201, add.text);
    const ops = (await call(s.base, '/api/admin/login', 'POST', { username: 'opsbk', password: 'operations-bk-pass' })).json.token;
    for (const [url, method] of [['/api/admin/backups', 'GET'], ['/api/admin/backups', 'POST'], ['/api/admin/backups/ebda3-backup-20261125-2200.tar.gz/link', 'POST'], ['/api/admin/backups/ebda3-backup-20261125-2200.tar.gz', 'DELETE']]) {
      assert.strictEqual((await call(s.base, url, method, undefined, ops)).status, 403, `${method} ${url}`);
      assert.strictEqual((await call(s.base, url, method)).status, 401, `signed out: ${method} ${url}`);
    }
    for (const name of ['..%2Fdb.json', 'db.json', 'ebda3-backup-x.tar.gz']) {
      assert.strictEqual((await call(s.base, `/api/admin/backups/${name}/link`, 'POST', undefined, owner)).status, 404, name);
      assert.strictEqual((await fetch(`${s.base}/dl/backup/${name}?e=99999999999999&s=x`)).status, 404, name);
    }
  } finally {
    s.stop();
    fs.rmSync(s.dataDir, { recursive: true, force: true });
  }
});

test('one at a time; no room on the server is said; old backups and leftovers are cleared', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-backup-keep-'));
  try {
    fs.writeFileSync(path.join(dir, 'db.json'), '{}');
    const b = new Backups(dir);
    const { finished } = b.start();
    assert.throws(() => b.start(), (e) => e.code === 'backupBusy');
    return finished.then(() => {
      fs.mkdirSync(b.dir, { recursive: true });
      const old = path.join(b.dir, 'ebda3-backup-20200101-0000.tar.gz');
      fs.writeFileSync(old, 'x');
      fs.utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
      const stale = path.join(b.dir, 'ebda3-backup-20200101-0001.tar.gz.part');
      fs.writeFileSync(stale, 'x');
      fs.utimesSync(stale, new Date('2020-01-01'), new Date('2020-01-01'));
      const l = b.list();
      assert.strictEqual(l.backups.length, 1, 'the 4-year-old one is gone');
      assert.ok(!fs.existsSync(stale), 'a half-made file nobody writes is gone');
      // No room: said, nothing started.
      const realStatfs = fs.statfsSync;
      fs.statfsSync = () => ({ bavail: 1, bsize: 1024 });
      try {
        assert.throws(() => b.start(), (e) => e.code === 'backupNoSpace');
        assert.strictEqual(b.list().making, null);
      } finally {
        fs.statfsSync = realStatfs;
      }
    });
  } finally {
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 500);
  }
});
