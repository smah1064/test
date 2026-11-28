'use strict';

// UV DTF cup wraps and the plain glasses they go on (owner, 28 Nov 2026): four wraps (one per glass shape, option
// "stick it on for me" +40 EGP) and four plain glasses sold without printing (`blank: true`), linked both ways
// (`pair`). The wraps are laid out exactly as src/drinkware.js applyTo() lays out a measured cup, so the tapered
// glass's side carries the same `fan` and gets the fan print files; their ready designs are offered only on them;
// every product has its photo, a home-page row and search words in both copies of the alias table.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, priceFor, printWidthFor, printHeightFor, cleanOptions, optionsPrice } = require('../src/products');
const drinkware = require('../src/drinkware');
const fanFiles = require('../src/fan-files');
const { SEED, productsFor } = require('../src/library');
const wrapPack = require('../src/library-packs/uv-wraps');

const byId = (id) => PRODUCTS.find((p) => p.id === id);
const WRAPS = { uvwrap16: 120, uvwrap20: 140, uvwraptumbler: 160, uvwraptaper: 130 };
const BLANKS = { glasscan16: 180, glasscan20: 220, glasstumbler20: 280, glasstaper: 120 };
const PAIRS = { uvwrap16: 'glasscan16', uvwrap20: 'glasscan20', uvwraptumbler: 'glasstumbler20', uvwraptaper: 'glasstaper' };
// The wrap's real size (mm, width × height), with the 5 mm seam gap.
const WRAP_MM = { uvwrap16: [215, 110], uvwrap20: [230, 130], uvwraptumbler: [230, 190] };
// What each glass measures (typed into "New product from photo" the same way): height, rim, base, band top / height.
const TYPED = {
  uvwrap16: { heightMm: 130, topDiaMm: 70, bottomDiaMm: 70, printTopMm: 10, printHeightMm: 110 },
  uvwrap20: { heightMm: 150, topDiaMm: 75, bottomDiaMm: 75, printTopMm: 10, printHeightMm: 130 },
  uvwraptumbler: { heightMm: 200, topDiaMm: 75, bottomDiaMm: 75, printTopMm: 5, printHeightMm: 190 },
  uvwraptaper: { heightMm: 120, topDiaMm: 85, bottomDiaMm: 65, printTopMm: 15, printHeightMm: 90 },
};
const ARABIC = /[؀-ۿ]/;

test('four wraps and four plain glasses, at the suggested prices, in both languages', () => {
  for (const [id, price] of Object.entries({ ...WRAPS, ...BLANKS })) {
    const p = byId(id);
    assert.ok(p, `${id} is in the catalogue`);
    assert.strictEqual(p.basePrice, price, `${id} price`);
    assert.strictEqual(priceFor(p, p.sizes[0].id, 1), price, `${id} priced`);
    assert.strictEqual(p.category, 'home');
    assert.strictEqual(p.process, 'uv');
    assert.ok(p.name.en && ARABIC.test(p.name.ar) && p.description.en && ARABIC.test(p.description.ar), `${id} texts`);
    assert.strictEqual(p.colors.length, 1);
    assert.strictEqual(p.colors[0].id, 'clear');
    assert.strictEqual(p.sizes.length, 1);
    assert.strictEqual(p.sides.length, 1);
    assert.strictEqual(p.sides[0].id, 'front');
    assert.ok(p.sides[0].svg.startsWith('<svg'));
    assert.ok(!/محل/.test(p.description.ar + p.name.ar), `${id}: the site is never called محل`);
    assert.ok(!/cash on delivery|عند الاستلام/i.test(p.description.en + p.description.ar), `${id}: no cash on delivery`);
  }
  for (const id of Object.keys(WRAPS)) {
    const p = byId(id);
    assert.ok(!p.blank, `${id} is printed`);
    assert.match(p.description.en, /UV DTF/);
    assert.match(p.description.en, /no heat/i);
    assert.match(p.description.en, /sold separately/);
    assert.match(p.description.ar, /بتتباع لوحدها/);
  }
  for (const id of Object.keys(BLANKS)) {
    const p = byId(id);
    assert.strictEqual(p.blank, true, `${id} is sold plain`);
    assert.match(p.description.en, /without printing/);
    assert.ok(!p.options, `${id}: no options`);
  }
});

test('each wrap and its glass point to each other', () => {
  for (const [wrap, glass] of Object.entries(PAIRS)) {
    assert.strictEqual(byId(wrap).pair, glass);
    assert.strictEqual(byId(glass).pair, wrap);
    assert.ok(byId(glass).description.en.includes(byId(wrap).name.en), `${glass} names its wrap`);
  }
});

test('"stick it on for me" adds 40 EGP to a wrap; an unknown choice is refused', () => {
  for (const id of Object.keys(WRAPS)) {
    const p = byId(id);
    const opt = p.options.find((o) => o.id === 'apply');
    assert.ok(opt, `${id} has the apply option`);
    assert.strictEqual(opt.choices[1].name.en, 'Stick it on a glass from this order for me');
    assert.strictEqual(opt.choices[1].name.ar, 'لزقها لي على كوباية من نفس الأوردر');
    const { options } = cleanOptions(p, { apply: 'apply' });
    assert.strictEqual(optionsPrice(p, options, p.sizes[0].id), 40);
    assert.strictEqual(cleanOptions(p, { apply: 'none' }).options, null, 'the default is not kept');
    assert.strictEqual(cleanOptions(p, { apply: 'glue' }).error, true);
  }
});

test('the wraps print at the real size of each glass', () => {
  for (const [id, [w, h]] of Object.entries(WRAP_MM)) {
    const p = byId(id);
    const side = p.sides[0];
    assert.ok(Math.abs(printWidthFor(p, side, p.sizes[0].id) * 25.4 - w) < 2, `${id} width`);
    assert.ok(Math.abs(printHeightFor(p, side, p.sizes[0].id) * 25.4 - h) < 2, `${id} height`);
    assert.ok(!side.fan, `${id}: a straight glass has no fan`);
    assert.ok(side.wrap && side.wrap.view.startsWith('<svg'), `${id}: shown wrapped round the glass`);
  }
});

test('every wrap is laid out exactly as drinkware.applyTo() lays out the same glass (the tapered one with its fan)', () => {
  for (const [id, typed] of Object.entries(TYPED)) {
    const spec = drinkware.buildSpec({ kind: 'cup', material: 'gloss', typed });
    const made = drinkware.applyTo({ sides: [{ id: 'front', name: { en: 'Front', ar: 'الأمام' } }], sizes: [] }, spec);
    const side = byId(id).sides[0];
    assert.deepStrictEqual(side.printArea, made.sides[0].printArea, `${id} print area`);
    assert.strictEqual(side.printWidthIn, made.sides[0].printWidthIn, `${id} width`);
    assert.deepStrictEqual(side.fan, made.sides[0].fan, `${id} fan`);
    assert.deepStrictEqual(byId(id).model.profile, made.model.profile, `${id} 3D profile`);
    assert.deepStrictEqual(byId(id).model.band, made.model.band, `${id} 3D band`);
  }
  const fan = byId('uvwraptaper').sides[0].fan;
  assert.ok(fan && fan.theta > 0 && fan.Ro > fan.Ri && fan.wideTop, 'the tapered glass is printed as a fan, wide edge at the rim');
  // The plain glass has the same print area but no fan (nothing is printed on it).
  assert.deepStrictEqual(byId('glasstaper').sides[0].printArea, byId('uvwraptaper').sides[0].printArea);
  assert.ok(!byId('glasstaper').sides[0].fan);
});

test('the tapered wrap\'s fan print file is made from its stored fan', async () => {
  const p = byId('uvwraptaper');
  const side = p.sides[0];
  const wPx = Math.round(side.printWidthIn * 100);
  const hPx = Math.round(printHeightFor(p, side, p.sizes[0].id) * 100);
  const png = await sharp({ create: { width: wPx, height: hPx, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 1 } } }).png().toBuffer();
  const out = await fanFiles.fanPng(png, side.fan, 100);
  const meta = await sharp(out).metadata();
  assert.ok(meta.width > 0 && meta.height > hPx, 'the fan box is taller than the band (it bows)');
});

test('the wrap designs: 8, in Arabic and English, only on the four wraps; plain glasses take no designs', () => {
  const mine = wrapPack.designs;
  assert.ok(mine.length >= 6 && mine.length <= 10, `${mine.length} designs`);
  const texts = mine.flatMap((d) => d.items.filter((i) => i.kind === 'text').map((i) => i.text));
  assert.ok(texts.some((x) => ARABIC.test(x)) && texts.some((x) => /[A-Za-z]/.test(x)));
  for (const d of mine) {
    assert.ok(SEED.includes(d), `${d.id} is in the library`);
    assert.deepStrictEqual(productsFor(d), Object.keys(WRAPS), `${d.id} is offered on the four wraps`);
    assert.strictEqual(d.product, 'uvwrap20');
    assert.strictEqual(d.color, 'clear');
  }
  for (const id of [...Object.keys(WRAPS), ...Object.keys(BLANKS)]) {
    const on = SEED.filter((d) => productsFor(d).includes(id));
    const foreign = on.filter((d) => !mine.includes(d));
    assert.deepStrictEqual(foreign.map((d) => d.id), [], `${id}: designs from elsewhere`);
    if (BLANKS[id]) assert.strictEqual(on.length, 0, `${id}: a plain glass takes no designs`);
  }
});

test('a photo for every new product (960 × 1200 WebP), listed in index.json', async () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/img/lifestyle/index.json'), 'utf8'));
  for (const id of [...Object.keys(WRAPS), ...Object.keys(BLANKS)]) {
    assert.strictEqual(index[id] && index[id].file, `/img/lifestyle/${id}.webp`, `${id} in index.json`);
    assert.ok(index[id].alt.en && ARABIC.test(index[id].alt.ar), `${id} alt`);
    const meta = await sharp(path.join(__dirname, '../public/img/lifestyle', `${id}.webp`)).metadata();
    assert.deepStrictEqual([meta.format, meta.width, meta.height], ['webp', 960, 1200], id);
  }
});

test('home page rows and search words (the same in both alias tables)', () => {
  const home = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const search = fs.readFileSync(path.join(__dirname, '../public/js/site-search.js'), 'utf8');
  for (const id of [...Object.keys(WRAPS), ...Object.keys(BLANKS)]) {
    const line = (src) => (src.match(new RegExp(`\\b${id}: '([^']+)'`)) || [])[1];
    assert.ok(line(home), `${id} has search words`);
    assert.strictEqual(line(home), line(search), `${id}: the same words in both tables`);
  }
  const gifts = home.match(/\{ key: 'gifts', ids: \[([^\]]+)\]/)[1];
  for (const id of ['uvwrap16', 'uvwrap20', 'uvwraptumbler', 'uvwraptaper']) assert.ok(gifts.includes(`'${id}'`), `${id} on the home page`);
  // "Start" on a plain glass opens its page, never the editor.
  assert.match(home, /p\.blank \? `\/product\?id=/);
});

test('the product page sells a plain glass without the editor (POST /api/blanks) and links wraps and glasses', () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/product.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/product.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '../public/js/i18n-blanks.js'), 'utf8');
  assert.match(page, /id="pp-blank"/);
  assert.match(page, /id="pp-pair"/);
  assert.match(page, /\/js\/i18n-blanks\.js/);
  assert.match(js, /POD\.api\('\/api\/blanks'/);
  assert.match(js, /productId: product\.id, color: color\.id, size: size\.id, qty, options: null/);
  assert.match(js, /kind: 'blank'/);
  assert.match(js, /cart\.unshift/);
  assert.match(js, /\$\('pp-choices'\)\.hidden = blank/);
  for (const key of js.match(/t\('(?:blank|pair)\.[A-Za-z]+'/g).map((m) => m.slice(3, -1))) assert.ok(i18n.includes(`'${key}'`), `${key} has its texts`);
});

// ---------- Through the API ----------
const OPEN = { max: 1e6, ms: 1000 };
let app;
let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-uvwraps-'));
  app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const madeWraps = {};
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('the shop lists all eight with their flags, links and print sides', async () => {
  const body = await (await fetch(`${base}/api/products`)).json();
  for (const id of [...Object.keys(WRAPS), ...Object.keys(BLANKS)]) {
    const p = body.products.find((x) => x.id === id);
    assert.ok(p, `${id} is listed`);
    assert.strictEqual(p.pair, byId(id).pair);
    assert.strictEqual(Boolean(p.blank), Boolean(BLANKS[id]));
    assert.ok(p.sides[0].printHeightIn > 0);
  }
  assert.ok(body.products.find((x) => x.id === 'uvwraptaper').sides[0].fan, 'the tapered wrap\'s fan reaches the editor');
});

test('a wrap design with "stick it on for me" is priced on the server and keeps the tapered glass\'s fan', async () => {
  for (const id of Object.keys(WRAPS)) {
    const p = byId(id);
    const size = p.sizes[0];
    const res = await post('/api/designs', { productId: id, color: 'clear', size: size.id, options: { apply: 'apply' }, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Mariam' }] } } } });
    assert.strictEqual(res.status, 201, `${id}: ${await res.clone().text()}`);
    const created = await res.json();
    for (const name of created.files) {
      let file;
      if (name.endsWith('.svg')) file = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
      else if (name.includes('print')) {
        const side = p.sides[0];
        file = await sharp({ create: { width: Math.round(printWidthFor(p, side, size.id) * 150), height: Math.round(printHeightFor(p, side, size.id) * 150), channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();
      } else file = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
      const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: file });
      assert.strictEqual(up.status, 204, `${id} ${name}`);
    }
    const done = await (await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
    assert.strictEqual(done.price, WRAPS[id] + 40, `${id}: wrap + applying`);
    const stored = app.locals.store.getDesign(created.id);
    assert.strictEqual(Boolean(stored.sides[0].fan), id === 'uvwraptaper', `${id}: fan kept with the design`);
    madeWraps[id] = created.id;
  }
});

// QA 28 Nov: "stick it on for me" was ordered with no glass, or with a glass of another size.
test('a wrap to be stuck on needs a glass of its size in the same order, one glass per wrap', async () => {
  const wrap = madeWraps.uvwrap16;
  assert.ok(wrap, 'made above');
  const customer = { name: 'Mona', phone: '01011112222', governorate: 'cairo', city: 'Nasr City', address: '3 Street 9' };
  const blank = async (productId, qty = 1) => (await (await post('/api/blanks', { productId, qty })).json()).id;
  const quote = async (ids) => (await (await post('/api/cart/quote', { designIds: ids })).json());
  // Alone: the cart says so on the wrap, and the order is refused.
  let q = await quote([wrap]);
  assert.strictEqual(q.items[0].unavailable, 'wrapNeedsGlass');
  assert.match(q.items[0].unavailableText, /16 oz/);
  let o = await post('/api/orders', { customer, designIds: [wrap], expectedTotal: 0 });
  assert.strictEqual(o.status, 409);
  // With a glass of another size: still refused.
  const taper = await blank('glasstaper');
  q = await quote([wrap, taper]);
  assert.strictEqual(q.items[0].unavailable, 'wrapNeedsGlass');
  assert.ok(!q.items[1].unavailable, 'the glass itself is fine');
  o = await post('/api/orders', { customer, designIds: [wrap, taper], expectedTotal: 0 });
  assert.strictEqual(o.status, 409);
  // With its own glass: fine, and ordered.
  const can = await blank('glasscan16');
  q = await quote([wrap, can]);
  assert.ok(!q.items.some((i) => i.unavailable), JSON.stringify(q.items));
  o = await post('/api/orders', { customer, designIds: [wrap, can], expectedTotal: q.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
});
