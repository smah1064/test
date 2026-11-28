'use strict';

// The shop's photos at about the size they are shown (owner's OK, UX item D, 26 Nov): /img-w/<width>/<folder>/<file>
// makes a smaller copy of public/img/lifestyle|designed once, keeps it in the data folder (out of backups) and
// refuses anything else. The home page asks for them with srcset, shows 8 products first, and the four
// "why order here" points sit under the banner (UX item B).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-sized-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0 });
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const photo = fs.readdirSync(path.join(__dirname, '../public/img/lifestyle')).find((f) => f.endsWith('.webp'));

test('a photo comes at the asked width, much smaller than the original, and is kept for next time', async () => {
  const original = fs.statSync(path.join(__dirname, '../public/img/lifestyle', photo)).size;
  const r = await fetch(`${base}/img-w/480/lifestyle/${photo}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/webp');
  assert.match(r.headers.get('cache-control'), /max-age=86400/);
  const buf = Buffer.from(await r.arrayBuffer());
  const meta = await sharp(buf).metadata();
  assert.ok(meta.width <= 480, `width ${meta.width}`);
  assert.ok(buf.length < original / 2, `${buf.length} of ${original}`);
  // Kept in the data folder, and left out of backups.
  const kept = fs.readdirSync(path.join(dataDir, 'img-sized', '480', 'lifestyle'));
  assert.strictEqual(kept.length, 1);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/backup.js'), 'utf8'), /'img-sized'/);
  // Asked again: the same copy.
  const again = await fetch(`${base}/img-w/480/lifestyle/${photo}`);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(fs.readdirSync(path.join(dataDir, 'img-sized', '480', 'lifestyle')).length, 1);
});

test('only the shop\'s photo folders, the set widths and real files', async () => {
  for (const url of [
    `/img-w/500/lifestyle/${photo}`, // not one of the widths
    `/img-w/480/mockups/${photo}`, // not a photo folder
    '/img-w/480/lifestyle/nope.webp', // no such photo
    '/img-w/480/lifestyle/..%2F..%2Fpackage.json',
    '/img-w/480/lifestyle/index.json',
  ]) {
    const r = await fetch(base + url);
    assert.strictEqual(r.status, 404, url);
  }
});

test('the home page: sized photos with srcset, 8 products first, the four points under the banner', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /srcset="\$\{\[320, 480, 800, 1200\]/);
  assert.match(html, /const FIRST = 8;/);
  assert.match(html, /data-show-all/);
  const trust = html.indexOf('class="hm-trust"');
  assert.ok(trust > html.indexOf('class="hm-hero"') && trust < html.indexOf('id="hm-tiles"'), 'between the banner and the tiles');
  const strings = {};
  require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8'), { window: strings });
  for (const k of ['hm.trustLabel', 'hm.trust.deliveryT', 'hm.trust.proofT', 'hm.trust.oneT', 'hm.trust.payT', 'hm.trust.payS', 'home.showAll', 'home.showing']) {
    const pair = strings.POD_STRINGS[k];
    assert.ok(pair && pair[0] && pair[1], k);
    assert.doesNotMatch(pair[1], /محل/, k);
  }
  // No payment method is promised (cash on delivery now, payment in advance from launch).
  assert.doesNotMatch(strings.POD_STRINGS['hm.trust.payS'].join(' '), /cash|استلام|مقدم/i);
});

test('small text on the home cards is readable, and the price note shows on phones (UX item F)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /<span class="hm-price-note" data-i18n="home.priceNote"><\/span>/);
  assert.doesNotMatch(html, /hide-sm" data-i18n="home.priceNote"/);
  const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
  // (The size has its own small grey line under the price since UX item 3, 27 Nov: still 12.5 px, not pale.)
  assert.match(css, /\.hm-pack \{ display: block; color: #5f6368; font-size: 12\.5px; line-height: 1\.4; \}/);
});

test('the shop\'s artwork in small copies for the Templates list: transparent, far lighter, only real art files', async () => {
  const file = 'trees-big-bows.png';
  const original = fs.statSync(path.join(__dirname, '../public/img/art/christmas', file)).size;
  const r = await fetch(`${base}/img-w/320/art/christmas/${file}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/webp');
  const buf = Buffer.from(await r.arrayBuffer());
  const meta = await sharp(buf).metadata();
  assert.ok(meta.width <= 320, `width ${meta.width}`);
  assert.strictEqual(meta.hasAlpha, true, 'see-through parts kept');
  assert.ok(buf.length < original / 20, `${buf.length} of ${original}`);
  for (const url of [
    '/img-w/320/art/christmas/nope.png',
    '/img-w/320/art/..%2F..%2Fsrc/app.js',
    '/img-w/320/art/Christmas!/trees-big-bows.png',
    `/img-w/500/art/christmas/${file}`,
    '/img-w/320/art/svg/x.svg',
  ]) assert.strictEqual((await fetch(base + url)).status, 404, url);
});

test('the big artwork\'s real sizes, for the editor\'s print check (it shows a 1200 px copy)', async () => {
  const r = await fetch(`${base}/api/art-sizes`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('cache-control'), /max-age=3600/);
  const sizes = await r.json();
  const meta = await sharp(path.join(__dirname, '../public/img/art/christmas/trees-plaid-bows.png')).metadata();
  assert.deepStrictEqual(sizes['christmas/trees-plaid-bows.png'], [meta.width, meta.height]);
  assert.ok(Object.values(sizes).every(([w]) => w > 1400), 'only artwork worth a lighter copy');
  assert.ok(Object.keys(sizes).every((k) => /^[a-z0-9-]+\/[^/]+\.(png|webp|jpe?g)$/i.test(k)));
  // The copy the editor shows is there.
  const copy = await fetch(`${base}/img-w/1200/art/christmas/trees-plaid-bows.png`);
  assert.strictEqual(copy.status, 200);
  assert.strictEqual((await sharp(Buffer.from(await copy.arrayBuffer())).metadata()).width, 1200);
});
