'use strict';

// The phone apps (owner's OK, 26 Nov): Android's and iPhone's link checks and the apps' settings, open while the shop is
// private (Google and Apple fetch them without cookies); the link checks are "not found" until their key is set.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

async function shop(env = {}, opts = {}) {
  const was = {};
  for (const [k, v] of Object.entries(env)) { was[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-applinks-'));
  if (opts.config) fs.writeFileSync(path.join(dataDir, 'app-config.json'), JSON.stringify(opts.config));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false, previewStart: Boolean(opts.private) });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get: (p) => fetch(base + p, { redirect: 'manual' }),
    close() {
      server.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    },
  };
}
const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

test('without their keys: the Android and iPhone link checks are not found; the app settings are the defaults', async () => {
  const s = await shop({ APP_ANDROID_SHA256: undefined, APP_APPLE_TEAM_ID: undefined, APP_IOS_STORE_URL: undefined });
  try {
    assert.strictEqual((await s.get('/.well-known/assetlinks.json')).status, 404);
    assert.strictEqual((await s.get('/.well-known/apple-app-site-association')).status, 404);
    const r = await s.get('/app/config.json');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('cache-control'), 'no-cache');
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepStrictEqual(await r.json(), {
      android: { minBuild: 10000, latestBuild: 10000, storeUrl: 'https://play.google.com/store/apps/details?id=me.ebda3.app' },
      ios: { minBuild: 10000, latestBuild: 10000 },
      features: { push: false, socialLogin: { android: false, ios: false } },
      inAppHosts: [],
    });
  } finally {
    s.close();
  }
});

test('with the keys: Android gets its fingerprints (bad ones dropped), iPhone its team and the paths that stay in the browser', async () => {
  const s = await shop({ APP_ANDROID_SHA256: `${FP.toLowerCase()}, nonsense, ${FP}`, APP_APPLE_TEAM_ID: 'ab12cd34ef', APP_IOS_STORE_URL: 'https://apps.apple.com/app/id123456789' });
  try {
    const a = await s.get('/.well-known/assetlinks.json');
    assert.strictEqual(a.status, 200);
    assert.match(a.headers.get('content-type'), /application\/json/);
    assert.deepStrictEqual(await a.json(), [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'me.ebda3.app', sha256_cert_fingerprints: [FP] } }]);
    const i = await s.get('/.well-known/apple-app-site-association');
    assert.strictEqual(i.status, 200, 'no redirect, no extension');
    assert.match(i.headers.get('content-type'), /^application\/json/);
    const aasa = await i.json();
    assert.deepStrictEqual(aasa.applinks.details[0].appIDs, ['AB12CD34EF.me.ebda3.app']);
    const comps = aasa.applinks.details[0].components;
    for (const p of ['/admin*', '/api/*', '/auth/*', '/files/*', '/dl/*']) assert.ok(comps.some((c) => c['/'] === p && c.exclude === true), p);
    assert.deepStrictEqual(comps[comps.length - 1], { '/': '/*' });
    assert.strictEqual((await (await s.get('/app/config.json')).json()).ios.storeUrl, 'https://apps.apple.com/app/id123456789');
  } finally {
    s.close();
  }
});

test('app settings from DATA_DIR/app-config.json: what\'s valid is used, the rest is ignored', async () => {
  const s = await shop({}, { config: {
    android: { minBuild: 10200, latestBuild: 10300, storeUrl: 'javascript:alert(1)' },
    ios: { latestBuild: 'x' },
    message: { ar: 'نسخة جديدة متاحة', en: '' },
    features: { push: true, socialLogin: { android: true, ios: 'yes' } },
    inAppHosts: ['pay.example.com', 'bad host', '<script>'],
    other: 'ignored',
  } });
  try {
    const c = await (await s.get('/app/config.json')).json();
    assert.deepStrictEqual(c.android, { minBuild: 10200, latestBuild: 10300, storeUrl: 'https://play.google.com/store/apps/details?id=me.ebda3.app' });
    assert.strictEqual(c.ios.latestBuild, 10000);
    assert.deepStrictEqual(c.message, { ar: 'نسخة جديدة متاحة', en: 'نسخة جديدة متاحة' });
    assert.deepStrictEqual(c.features, { push: true, socialLogin: { android: true, ios: false } });
    assert.deepStrictEqual(c.inAppHosts, ['pay.example.com']);
    assert.strictEqual(c.other, undefined);
  } finally {
    s.close();
  }
});

test('while the shop is private: these three answer without an invitation; the rest stays behind the lock', async () => {
  const s = await shop({ APP_ANDROID_SHA256: FP, APP_APPLE_TEAM_ID: 'AB12CD34EF' }, { private: true });
  try {
    assert.strictEqual((await s.get('/.well-known/assetlinks.json')).status, 200);
    assert.strictEqual((await s.get('/.well-known/apple-app-site-association')).status, 200);
    assert.strictEqual((await s.get('/app/config.json')).status, 200);
    assert.notStrictEqual((await s.get('/api/products')).status, 200, 'the shop itself is still private');
    assert.notStrictEqual((await s.get('/.well-known/other.json')).status, 200);
    assert.notStrictEqual((await s.get('/app/other.json')).status, 200);
  } finally {
    s.close();
  }
});
