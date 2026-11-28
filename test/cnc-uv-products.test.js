'use strict';

// The CNC and UV products (owner's go, 27 Nov): they are in the catalogue in both languages with the prices,
// sizes, materials and options the owner chose; every size prints at its real size; CNC products are drawn in
// one tone (`laser`) and made by 'cnc'; options are charged per size or per pack; a design can be made and
// completed on each through the API; and the plaque and fridge magnets have their new options.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, priceFor, printWidthFor, printHeightFor, optionsPrice, cleanOptions, MOCKUP_WIDTH, MOCKUP_HEIGHT } = require('../src/products');
const catalog = require('../src/catalog');
const { coverPrice } = require('../src/pack-price');

const byId = (id) => PRODUCTS.find((p) => p.id === id);

// id: [category, process, base price, { size: surcharge }, one-tone mode or null]
const SPEC = {
  calligraphy: ['home', 'cnc', 1500, { 40: 0, 50: 450 }, 'engrave'],
  villasign: ['home', 'cnc', 1200, { '40x30': 0, '50x35': 400 }, 'engrave'],
  acrylicnameplate: ['business', 'uv', 650, { '20x7': 0, '25x8': 120 }, null],
  woodnameplate: ['business', 'cnc', 1200, { '20x6': 0, '25x7': 200 }, 'engrave'],
  shield: ['business', 'uv', 350, { '15x20': 0, '20x25': 200, '25x30': 400 }, null],
  quranbox: ['occasions', 'uv', 850, { '20x28': 0, '25x35': 250 }, null],
  nameart: ['home', 'cnc', 1200, { '40x20': 0, '60x30': 300, '80x40': 600, '100x50': 800 }, 'cut'],
  rehal: ['occasions', 'cnc', 550, { 30: 0 }, 'engrave'],
  glassaward: ['business', 'uv', 600, { 15: 0, 20: 300, 25: 600 }, null],
  qrstand: ['business', 'uv', 220, { 1: 0, 5: 730, 10: 1480, 20: 2780 }, null],
  favourtags: ['occasions', 'uv', 750, { 25: 0, 50: 550, 100: 1550 }, null],
  uvdtf: ['school', 'uv', 150, { A5: 0, A4: 100, A3: 270 }, null],
  eventletters: ['occasions', 'cnc', 3000, { 60: 0, 90: 1500 }, 'cut'],
};
const IDS = Object.keys(SPEC);

// Real print size (cm, width × height) per size. Where the owner's sizes were not all one shape, every size keeps
// the first one's shape (the label says the real size).
const TRIM = {
  calligraphy: { 40: [40, 40], 50: [50, 50] },
  villasign: { '40x30': [40, 30], '50x35': [50, 37.5] },
  acrylicnameplate: { '20x7': [20, 7], '25x8': [25, 8.75] },
  woodnameplate: { '20x6': [20, 6], '25x7': [25, 7.5] },
  shield: { '15x20': [16, 20], '20x25': [20, 25], '25x30': [24, 30] },
  quranbox: { '20x28': [20, 28], '25x35': [25, 35] },
  nameart: { '40x20': [40, 20], '60x30': [60, 30], '80x40': [80, 40], '100x50': [100, 50] },
  rehal: { 30: [12, 6] },
  glassaward: { 15: [10, 15], 20: [13.33, 20], 25: [16.67, 25] },
  qrstand: { 1: [10.5, 14.8], 5: [10.5, 14.8], 10: [10.5, 14.8], 20: [10.5, 14.8] },
  favourtags: { 25: [5, 5], 50: [5, 5], 100: [5, 5] },
  uvdtf: { A5: [14.8, 21], A4: [21, 29.7], A3: [29.7, 42] },
  eventletters: { 60: [150, 60], 90: [225, 90] },
  plaque: { '13x18': [13, 18], '18x25': [18, 25], '30x40': [28.9, 40], '40x60': [43.3, 60] },
};

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-cncuv-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('the catalogue API lists the 13 products in English and Arabic, in their categories', async () => {
  const body = await (await fetch(base + '/api/products')).json();
  for (const id of IDS) {
    const p = body.products.find((x) => x.id === id);
    assert.ok(p, `${id} is listed`);
    assert.strictEqual(p.category, SPEC[id][0], `${id} category`);
    assert.ok(body.categories.some((c) => c.id === p.category), `${id} category exists`);
    assert.ok(p.name.en && /[؀-ۿ]/.test(p.name.ar), `${id} name`);
    assert.ok(p.description.en && /[؀-ۿ]/.test(p.description.ar), `${id} description`);
    for (const c of p.colors) assert.ok(c.name.en && c.name.ar && /^#[0-9a-f]{6}$/i.test(c.hex), `${id}/${c.id} colour`);
    for (const s of p.sides) assert.ok(s.printHeightIn > 0 && s.svg.startsWith('<svg'), `${id}/${s.id} side`);
    assert.ok(!p.deliverTo, `${id} ships everywhere`);
  }
  assert.strictEqual(new Set(body.products.map((p) => p.id)).size, body.products.length, 'product ids are unique');
});

test('names, prices and sizes are the ones the owner chose', () => {
  const names = {
    calligraphy: 'لوحة كاليجرافي خشب طبقات', villasign: 'يافطة فيلا وبيت', acrylicnameplate: 'اسم مكتب أكريليك', woodnameplate: 'اسم مكتب خشب',
    shield: 'درع تكريم أكريليك', quranbox: 'صندوق مصحف بغطا مطبوع', nameart: 'اسم كاليجرافي على لوح', rehal: 'رحل مصحف بالاسم', glassaward: 'درع كريستال',
    qrstand: 'ستاند أكريليك للمنيو والـ QR', favourtags: 'تاجات أكريليك للتوزيعات', uvdtf: 'شيت ستيكرز UV DTF', eventletters: 'حروف كبيرة للمناسبات',
  };
  for (const id of IDS) {
    const p = byId(id);
    const [, process, price, sizes] = SPEC[id];
    assert.strictEqual(p.name.ar, names[id], `${id} Arabic name`);
    assert.strictEqual(p.process, process, `${id} process`);
    assert.deepStrictEqual(p.methods, [process], `${id} methods`);
    assert.strictEqual(p.basePrice, price, `${id} base price`);
    assert.deepStrictEqual(Object.fromEntries(p.sizes.map((z) => [z.id, z.surcharge])), Object.fromEntries(Object.entries(sizes).map(([k, v]) => [String(k), v])), `${id} sizes`);
    for (const z of p.sizes) {
      assert.ok(z.label.en && /[؀-ۿ]/.test(z.label.ar) || /^[\x20-\x7e]+$/.test(z.label.ar), `${id}/${z.id} label`);
      assert.ok(priceFor(p, z.id, 1) > 0, `${id}/${z.id} priced`);
    }
    // Bigger sizes cost more.
    const prices = p.sizes.map((z) => priceFor(p, z.id, 1));
    assert.deepStrictEqual(prices, [...prices].sort((a, b) => a - b), `${id} bigger costs more`);
  }
});

test('texts: no "محل", no cash on delivery, no delivery limit; the Quran box says the Quran is not included', () => {
  for (const id of [...IDS, 'plaque', 'magnets']) {
    const p = byId(id);
    const all = JSON.stringify([p.name, p.description, p.sizes.map((z) => z.label), p.colors.map((c) => c.name), p.options || []]);
    assert.ok(!/محل/.test(all), `${id}: never calls the shop محل`);
    assert.ok(!/cash on delivery|الدفع عند الاستلام|كاش عند الاستلام|COD\b/i.test(all), `${id}: no cash on delivery`);
    assert.ok(!/Cairo and Giza|القاهرة والجيزة|our own van|عربيتنا/i.test(all), `${id}: no delivery limit`);
    assert.ok(!p.deliverTo, `${id}: no deliverTo`);
  }
  const q = byId('quranbox').description;
  assert.match(q.en, /Quran isn’t included/);
  assert.match(q.ar, /المصحف مش معاه/);
});

test('CNC products are one-tone (engraved or cut) with a carved tone per material; UV ones print in colour', () => {
  for (const id of IDS) {
    const p = byId(id);
    const mode = SPEC[id][4];
    if (!mode) {
      assert.ok(!p.laser, `${id} is printed in colour`);
      continue;
    }
    assert.strictEqual(p.laser.kind, mode, `${id} laser kind`);
    assert.strictEqual(p.colorLabel.en.length > 0, true);
    for (const c of p.colors) assert.ok(/^#[0-9a-f]{6}$/i.test(c.ink || ''), `${id}/${c.id} has its carved tone`);
    assert.strictEqual(p.mix.colors, false, `${id}: one design is one material`);
    assert.ok(p.cardArt && p.cardArt.includes('{{I}}'), `${id} card art in the material's tone`);
  }
  // Round board; rounded corners about 10 mm; letters on a plate (many pieces, plate cut too); freestanding letters.
  assert.deepStrictEqual(byId('calligraphy').laser, { kind: 'engrave', cut: 'rounded', radiusMm: 250 });
  assert.strictEqual(byId('calligraphy').sides[0].printArea.rx, byId('calligraphy').sides[0].printArea.w / 2);
  assert.deepStrictEqual(byId('villasign').laser, { kind: 'engrave', cut: 'rounded', radiusMm: 10 });
  assert.deepStrictEqual(byId('nameart').laser, { kind: 'cut', bridgeMm: 1.5, pieces: 'many', board: true });
  // (Up to 3 characters, each the chosen 60 / 90 cm tall: QA on the live site, 28 Nov.)
  assert.deepStrictEqual(byId('eventletters').laser, { kind: 'cut', bridgeMm: 3, pieces: 'many', maxPieces: 3, fillHeight: true });
  assert.strictEqual(byId('woodnameplate').laser.cut, null);
  assert.strictEqual(byId('rehal').laser.cut, null);
  // The admin can switch a CNC product between the CNC and laser processes, and a laser one to CNC.
  assert.deepStrictEqual(catalog.processChoices(byId('calligraphy')), ['engrave', 'lasercut', 'cnc']);
  assert.ok(catalog.processChoices(byId('doorsign')).includes('cnc'));
});

test('print setup: process, safe margin, no bleed, and a 3D model the preview knows', () => {
  const MODELS = new Set(['block', 'cutout', 'pad']);
  for (const id of IDS) {
    const p = byId(id);
    assert.ok(MODELS.has(p.model.type), `${id} model ${p.model.type}`);
    assert.ok(p.model.depthIn > 0, `${id} depth`);
    if (p.laser) assert.strictEqual(p.model.material, 'laser', `${id} laser look`);
    for (const s of p.sides) {
      assert.strictEqual(s.bleedIn, 0, `${id} no bleed`);
      assert.ok(s.safeIn >= 0 && s.safeIn * 2 < s.printWidthIn, `${id} safe margin`);
    }
  }
  for (const id of ['acrylicnameplate', 'shield', 'glassaward', 'qrstand', 'favourtags']) assert.strictEqual(byId(id).model.clear, true, `${id} is clear`);
});

test('print areas sit inside the drawing, and every size prints at its real size and shape', () => {
  for (const id of [...IDS, 'plaque']) {
    const p = byId(id);
    for (const s of p.sides) {
      const a = s.printArea;
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= MOCKUP_WIDTH && a.y + a.h <= MOCKUP_HEIGHT, `${id}/${s.id} print area inside the mockup`);
      for (const layer of [s.svg, s.overlay].filter(Boolean)) assert.ok(/^<svg[^>]*viewBox="0 0 500 600"/.test(layer) && layer.endsWith('</svg>'), `${id}/${s.id} drawing`);
      for (const z of p.sizes) {
        const [wCm, hCm] = TRIM[id][z.id];
        const wIn = printWidthFor(p, s, z.id);
        const hIn = printHeightFor(p, s, z.id);
        assert.ok(Math.abs(wIn * 2.54 - wCm) < 0.12, `${id}/${z.id}: ${(wIn * 2.54).toFixed(2)} cm wide, want ${wCm}`);
        assert.ok(Math.abs(hIn * 2.54 - hCm) < 0.12, `${id}/${z.id}: ${(hIn * 2.54).toFixed(2)} cm high, want ${hCm}`);
        assert.ok(!z.printHeightCm, `${id}/${z.id}: the shape is the drawing's`);
      }
    }
  }
});

test('options: priced per size (plaque) and per pack (magnets), charged on top of the size', () => {
  const plaque = byId('plaque');
  assert.deepStrictEqual(plaque.sizes.map((z) => [z.id, z.surcharge]), [['13x18', 0], ['18x25', 250], ['30x40', 650], ['40x60', 1350]]);
  const thick = { thickness: { id: 'block' } };
  assert.deepStrictEqual(plaque.sizes.map((z) => optionsPrice(plaque, thick, z.id)), [250, 350, 600, 900]);
  assert.strictEqual(optionsPrice(plaque, { thickness: { id: 'standard' } }, '40x60'), 0);
  assert.deepStrictEqual(cleanOptions(plaque, { thickness: 'standard' }), { options: null }, 'the default is not kept');
  assert.ok(cleanOptions(plaque, { thickness: 'nope' }).error);

  const mag = byId('magnets');
  const acrylic = { finish: { id: 'acrylic' } };
  for (const z of mag.sizes) {
    const pack = priceFor(mag, z.id, 1);
    const extra = optionsPrice(mag, acrylic, z.id);
    assert.ok(Math.abs(extra / pack - 0.6) < 0.01, `magnets ${z.id}: +${extra} on ${pack}`);
  }
  // With the acrylic face, more magnets still never cost less (the cheapest packs that make at least that many).
  for (const fam of ['60x90', '80x120', '100x150']) {
    const packs = mag.sizes.filter((z) => z.family === fam).map((z) => ({ copies: z.copies, price: priceFor(mag, z.id, 1) + optionsPrice(mag, acrylic, z.id) }));
    let last = 0;
    for (let n = 1; n <= 300; n++) {
      const pr = coverPrice(packs, n);
      assert.ok(pr >= last, `magnets ${fam} acrylic: ${n} cost ${pr} < ${last}`);
      last = pr;
    }
  }

  assert.strictEqual(optionsPrice(byId('shield'), { backing: { id: 'white' }, box: { id: 'velvet' } }, '25x30'), 190);
  assert.strictEqual(optionsPrice(byId('acrylicnameplate'), { backing: { id: 'white' } }, '25x8'), 50);
  assert.strictEqual(optionsPrice(byId('woodnameplate'), { giftbox: { id: 'wood' } }, '20x6'), 200);
  for (const id of ['plaque', 'magnets', 'shield', 'acrylicnameplate', 'woodnameplate']) {
    for (const o of byId(id).options) {
      assert.strictEqual(o.choices[0].price, 0, `${id}/${o.id}: the first choice is free`);
      for (const c of o.choices.slice(1)) for (const z of byId(id).sizes) assert.ok((typeof c.price === 'number' ? c.price : c.price[z.id]) > 0, `${id} ${o.id}/${c.id} priced for ${z.id}`);
    }
  }
});

test('packs (QR stands, favour tags): pieces, cheaper per piece, and more never cost less', () => {
  for (const id of ['qrstand', 'favourtags']) {
    const p = byId(id);
    assert.ok(p.sizes.every((z) => z.pack && z.copies > 0 && z.unit === 'piece'), `${id} packs of pieces`);
    const per = p.sizes.map((z) => priceFor(p, z.id, 1) / z.copies);
    assert.deepStrictEqual(per, [...per].sort((a, b) => b - a), `${id} cheaper per piece in bigger packs`);
    const packs = p.sizes.map((z) => ({ copies: z.copies, price: priceFor(p, z.id, 1) }));
    let last = 0;
    for (let n = 1; n <= 250; n++) {
      const pr = coverPrice(packs, n);
      assert.ok(pr >= last, `${id}: ${n} cost ${pr} < ${last}`);
      last = pr;
    }
  }
  assert.deepStrictEqual(byId('qrstand').sizes.map((z) => priceFor(byId('qrstand'), z.id, 1)), [220, 950, 1700, 3000]);
  assert.deepStrictEqual(byId('favourtags').sizes.map((z) => priceFor(byId('favourtags'), z.id, 1)), [750, 1300, 2300]);
});

/** Create a design on every side the way the editor does, upload its files at their real shape and complete it. */
async function makeDesign(p, size, extra = {}) {
  const sides = Object.fromEntries(p.sides.map((s) => [s.id, { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } }]));
  const res = await post('/api/designs', { productId: p.id, color: p.colors[0].id, size: size.id, sides, ...extra });
  assert.strictEqual(res.status, 201, `${p.id}: ${await res.clone().text()}`);
  const created = await res.json();
  for (const name of created.files) {
    const side = p.sides.find((s) => name.startsWith(`${s.id}-`));
    let body;
    if (name.endsWith('.svg')) body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    else if (name.includes('print')) {
      // 60 DPI at the real size (the giant letters are over 2 m wide).
      const wIn = printWidthFor(p, side, size.id);
      const hIn = printHeightFor(p, side, size.id);
      body = await sharp({ create: { width: Math.round(wIn * 60), height: Math.round(hIn * 60), channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204, `${p.id} ${name}`);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, `${p.id}: ${await done.clone().text()}`);
  return done.json();
}

test('a design can be made and completed on every new product, at its biggest size, priced on the server', async () => {
  for (const id of IDS) {
    const p = byId(id);
    const size = p.sizes[p.sizes.length - 1];
    const d = await makeDesign(p, size);
    assert.strictEqual(d.status, 'ready', id);
    assert.strictEqual(d.price, priceFor(p, size.id, 1), `${id} priced on the server`);
  }
});

test('options are charged on the server: thick plaque, acrylic magnets, a shield with both options', async () => {
  const plaque = byId('plaque');
  const a = await makeDesign(plaque, plaque.sizes.find((z) => z.id === '40x60'), { options: { thickness: 'block' } });
  assert.strictEqual(a.price, priceFor(plaque, '40x60', 1) + 900);
  const mag = byId('magnets');
  const b = await makeDesign(mag, mag.sizes.find((z) => z.id === '80x120-100'), { options: { finish: 'acrylic' } });
  assert.strictEqual(b.price, priceFor(mag, '80x120-100', 1) + 1320);
  const shield = byId('shield');
  const c = await makeDesign(shield, shield.sizes[0], { options: { backing: 'white', box: 'velvet' } });
  assert.strictEqual(c.price, 350 + 40 + 150);
  const bad = await post('/api/designs', { productId: 'shield', color: 'clear', size: '15x20', options: { box: 'gold' }, sides: { front: { editor: { objects: [{ type: 'i-text', text: 'x' }] } } } });
  assert.strictEqual(bad.status, 400, 'an unknown choice is refused');
});

test('CNC products get the vector files the workshop needs (LightBurn SVG with cut lines)', async () => {
  const { token } = await (await post('/api/admin/login', { password: 'secret' })).json();
  const get = (url) => fetch(base + url, { headers: { Authorization: `Bearer ${token}` } });
  for (const id of ['villasign', 'nameart']) {
    const p = byId(id);
    const d = await makeDesign(p, p.sizes[0]);
    const order = await (await post('/api/orders', { customer: { name: 'Test', phone: '01012345678', governorate: 'giza', city: 'Dokki', address: '1 Street' }, designIds: [d.id] })).json();
    assert.ok(order.id, JSON.stringify(order));
    const svg = await get(`/api/admin/files/${d.id}/front?format=laser-svg`);
    assert.strictEqual(svg.status, 200, `${id}: ${await svg.clone().text()}`);
    const text = await svg.text();
    assert.match(text, /stroke="#ff0000"/, `${id}: red cut lines`);
    const [w, h] = TRIM[id][p.sizes[0].id];
    const m = /<svg[^>]*width="([\d.]+)mm" height="([\d.]+)mm"/.exec(text);
    assert.ok(m && Math.abs(Number(m[1]) - w * 10) < 1 && Math.abs(Number(m[2]) - h * 10) < 1, `${id}: ${m && m[1]} × ${m && m[2]} mm, want ${w * 10} × ${h * 10}`);
  }
  // UV products have no laser files.
  const nameplate = await makeDesign(byId('acrylicnameplate'), byId('acrylicnameplate').sizes[0]);
  assert.strictEqual((await get(`/api/admin/files/${nameplate.id}/front?format=laser-svg`)).status, 404);
});
