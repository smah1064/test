'use strict';

// Product options: business-card lamination (سلوفان), priced per pack, shown with the size.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, priceFor } = require('../src/products');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-options-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const SIDE = { editor: { objects: [{ type: 'i-text', text: 'Ahmed' }] } };
const cards = PRODUCTS.find((p) => p.id === 'bizcards');
const LAM = cards.options[0].choices[1].price['200']; // matte lamination on 200 cards

async function make(body) {
  const res = await post('/api/designs', { productId: 'bizcards', color: 'gloss', size: '200', sides: { front: SIDE }, ...body });
  if (res.status !== 201) return res;
  const c = await res.json();
  for (const name of c.files) {
    const png = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: '#ffffff' } }).png().toBuffer();
    let data;
    if (name.endsWith('.svg')) data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    else if (name.endsWith('merge.bin')) data = Buffer.concat(await Promise.all(body.merge.rows.map(() => png(200, 80))));
    else if (name.includes('print') || name.includes('merge-base')) data = await png(1110, 698);
    else data = await png(60, 40);
    assert.strictEqual((await fetch(`${base}/api/designs/${c.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': c.uploadToken }, body: data })).status, 204);
  }
  const done = await fetch(`${base}/api/designs/${c.id}/complete`, { method: 'POST', headers: { 'x-upload-token': c.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

test('business cards: paper finish and lamination options', () => {
  assert.ok(cards.colors.some((c) => c.id === 'matte') && cards.colors.some((c) => c.id === 'gloss'), 'matte and glossy paper');
  assert.strictEqual(cards.colorLabel.ar, 'الورق');
  const lam = cards.options.find((o) => o.id === 'lamination');
  assert.deepStrictEqual(lam.choices.map((c) => c.id), ['none', 'matte', 'gloss']);
  assert.strictEqual(lam.name.ar, 'سلوفان');
});

test('lamination adds its price for the pack size and shows with the size', async () => {
  const plain = await make({});
  assert.strictEqual(plain.price, priceFor(cards, '200', 1));
  assert.strictEqual(plain.options, undefined);
  const lam = await make({ options: { lamination: 'matte' } });
  assert.strictEqual(lam.price, priceFor(cards, '200', 1) + LAM);
  assert.strictEqual(lam.options.lamination.id, 'matte');
  assert.match(lam.size.label.ar, /سلوفان مط/);
  assert.match(lam.size.label.en, /Matte lamination/);
  // "No lamination" is the default and isn't kept.
  const none = await make({ options: { lamination: 'none' } });
  assert.strictEqual(none.price, plain.price);
  // Unknown choices are refused.
  assert.strictEqual((await make({ options: { lamination: 'gold' } })).status, 400);
  // The order keeps the option and its price.
  const q = await (await post('/api/cart/quote', { designIds: [lam.id] })).json();
  assert.strictEqual(q.items[0].price, lam.price);
  const o = await post('/api/orders', { customer: { name: 'شركة', phone: '01012345678', governorate: 'cairo', city: 'نصر', address: '1 شارع' }, designIds: [lam.id], expectedTotal: q.total });
  assert.strictEqual(o.status, 201, await o.clone().text());
  const item = (await o.json()).items[0];
  assert.strictEqual(item.price, lam.price);
  assert.match(item.size.label.ar, /سلوفان مط/);
});

test('a team name list with lamination: one laminated pack per person', async () => {
  const d = await make({
    options: { lamination: 'gloss' },
    sides: { front: { editor: { objects: [{ type: 'i-text', text: '{Name}' }] } } },
    merge: { columns: ['Name'], rows: [['Ahmed'], ['Mona'], ['Omar']], sides: { front: { box: { x: 10, y: 10, w: 200, h: 80 } } } },
  });
  assert.strictEqual(d.merge.count, 3);
  assert.strictEqual(d.price, 3 * (priceFor(cards, '200', 1) + LAM));
  assert.match(d.size.label.ar, /سلوفان لامع/);
});

test('selling prices: half the list prices, rounded to the nearest 10 EGP', () => {
  // The suite runs at list prices (PRICE_FACTOR=1); the shop's default is half.
  const { execFileSync } = require('child_process');
  const env = { ...process.env };
  delete env.PRICE_FACTOR;
  const sold = JSON.parse(execFileSync(process.execPath, ['-e', "const {PRODUCTS,EXTRA_SIDE_PRICE}=require('./src/products');console.log(JSON.stringify({extra:EXTRA_SIDE_PRICE,p:PRODUCTS.map(p=>({id:p.id,base:p.basePrice,sizes:p.sizes.map(s=>s.surcharge||0),emb:p.embroidery?p.embroidery.surcharge:null}))}))"], { cwd: path.join(__dirname, '..'), env }).toString());
  const r10 = (v) => (v ? Math.max(10, Math.round(v / 2 / 10) * 10) : v);
  const { EXTRA_SIDE_PRICE } = require('../src/products');
  assert.strictEqual(sold.extra, r10(EXTRA_SIDE_PRICE));
  for (const list of PRODUCTS) {
    const s = sold.p.find((x) => x.id === list.id);
    assert.strictEqual(s.base, r10(list.basePrice), list.id);
    assert.deepStrictEqual(s.sizes, list.sizes.map((z) => r10(z.surcharge || 0)), list.id);
    if (list.embroidery) assert.strictEqual(s.emb, r10(list.embroidery.surcharge), list.id);
    assert.ok(s.base % 10 === 0, `${list.id} rounded to 10`);
  }
  // Business cards come in packs of hundreds.
  assert.ok(cards.sizes.every((z) => Number(z.id) % 100 === 0), cards.sizes.map((z) => z.id).join(','));
});
