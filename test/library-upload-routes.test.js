'use strict';

// Admin → Ready designs → Upload designs (zip): the routes from upload to a design in the shop, for the
// owner and a product manager (src/app.js; the zip reading and suggestions are in design-upload.test.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const sharp = require('sharp');
const { createApp } = require('../src/app');

/** A zip (deflate) of { name, data } files. */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const packed = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('upload a zip, review, publish: the designs go on the picked products only, printing from the original', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libupload-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method, body, token, headers = {}) => fetch(base + url, {
    method,
    headers: { ...(Buffer.isBuffer(body) ? { 'Content-Type': 'application/zip' } : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  try {
    const owner = (await (await call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json()).token;
    assert.strictEqual((await call('/api/admin/staff', 'POST', { username: 'mona', password: 'Product-Manager-2026!', role: 'products', name: 'Mona' }, owner)).status, 201);
    const staff = (await (await call('/api/admin/login', 'POST', { username: 'mona', password: 'Product-Manager-2026!' })).json()).token;

    // A cut-out picture in an Arabic T-shirt folder, a full picture in "mugs/", a tiny one, a text file.
    const cutout = await sharp({ create: { width: 2000, height: 2000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><circle cx="1000" cy="1000" r="700" fill="#1d2a44"/></svg>') }]).png().toBuffer();
    const wide = await sharp({ create: { width: 2880, height: 1200, channels: 3, background: '#ff7a59' } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2880" height="1200"><circle cx="700" cy="600" r="380" fill="#ffd166"/><rect x="1500" y="250" width="900" height="700" fill="#06d6a0"/></svg>') }]).jpeg().toBuffer();
    const tiny = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#cc0000' } }).png().toBuffer();
    const blank = await sharp({ create: { width: 1500, height: 1500, channels: 3, background: '#ff7a59' } }).jpeg().toBuffer();
    const zip = makeZip([
      { name: 'تيشيرتات/قطة.png', data: cutout },
      { name: 'mugs/sunset.jpg', data: wide },
      { name: 'tiny.png', data: tiny },
      { name: 'blank.jpg', data: blank },
      { name: 'notes.txt', data: 'hello' },
    ]);

    // Nobody without a dashboard sign-in; staff (product manager) may.
    assert.strictEqual((await call('/api/admin/library/uploads', 'POST', zip)).status, 401);
    const up = await call('/api/admin/library/uploads', 'POST', zip, staff, { 'x-file-name': encodeURIComponent('تصميمات نوفمبر.zip') });
    assert.strictEqual(up.status, 201, await up.clone().text());
    const { batch } = await up.json();
    assert.strictEqual(batch.file, 'تصميمات نوفمبر.zip', 'the Arabic zip name comes back as it was');
    assert.strictEqual(batch.by, 'Mona');
    assert.deepStrictEqual(batch.skipped.map((s) => [s.path, s.reason]).sort(), [['blank.jpg', 'blankPicture'], ['notes.txt', 'notPicture'], ['tiny.png', 'tooSmall']]);
    assert.strictEqual(batch.items.length, 2);
    const cat = batch.items.find((i) => i.path.endsWith('قطة.png'));
    const sunset = batch.items.find((i) => i.path === 'mugs/sunset.jpg');
    assert.strictEqual(cat.picked[0], 'tshirt', 'the T-shirt folder name puts the T-shirt first');
    assert.strictEqual(sunset.picked[0], 'mug', 'the mugs folder puts the mug first');
    assert.strictEqual(cat.category, 'pets', '"قطة" (cat) in the name: Pets');
    assert.strictEqual(sunset.category, 'artsy', 'pictures with no subject in their names are "Painted art", not phrases');
    assert.ok(cat.dpiFor.tshirt > 0, 'the print quality per product comes with the item');
    assert.ok(cat.picked.length <= 8);

    // The open uploads list; the review pictures.
    const list = await (await call('/api/admin/library/uploads', 'GET', undefined, owner)).json();
    assert.deepStrictEqual(list.batches.map((b) => [b.id, b.count]), [[batch.id, 2]]);
    const pic = await fetch(base + cat.web);
    assert.strictEqual(pic.status, 200);
    assert.strictEqual(pic.headers.get('content-type'), 'image/png');

    // An item with no product is refused; the other publishes on exactly the products picked.
    const pub = await (await call(`/api/admin/library/uploads/${batch.id}/publish`, 'POST', { items: [
      { id: cat.id, name: { en: 'Happy cat', ar: 'قطة سعيدة' }, category: 'pets', products: ['tshirt', 'mug', 'not-a-product'] },
      { id: sunset.id, name: { en: 'Sunset', ar: 'غروب' }, category: 'artsy', products: [] },
    ] }, staff)).json();
    assert.deepStrictEqual(pub.skipped, [{ itemId: sunset.id, code: 'pickProducts' }]);
    assert.strictEqual(pub.published.length, 1);
    const designId = pub.published[0].designId;
    assert.match(designId, /^u-[0-9a-f]{12}$/);

    // In the shop: on the T-shirt and the mug, not on the hoodie.
    const shown = await (await fetch(`${base}/api/library`)).json();
    const d = shown.designs.find((x) => x.id === designId);
    assert.ok(d, 'the design is in the shop');
    const full = await (await fetch(`${base}/api/library/${designId}`)).json();
    assert.deepStrictEqual(full.products, ['tshirt', 'mug']);
    assert.strictEqual(full.category, 'pets');
    assert.deepStrictEqual(full.name, { en: 'Happy cat', ar: 'قطة سعيدة' });
    const item = full.items[0];
    assert.strictEqual(item.src, `/library-art/${designId}/web.png`);
    assert.strictEqual(item.printSrc, `/library-art/${designId}/print.png`);
    // The print original keeps its full size (trimmed to the artwork), the screen copy is lighter.
    const original = await sharp(Buffer.from(await (await fetch(base + item.printSrc)).arrayBuffer())).metadata();
    assert.deepStrictEqual([original.width, original.height], item.printPx);
    assert.ok(original.width >= 1400, `print original ${original.width}px`);
    const web = await sharp(Buffer.from(await (await fetch(base + item.src)).arrayBuffer())).metadata();
    assert.ok(Math.max(web.width, web.height) <= 1200);
    assert.strictEqual((await fetch(`${base}/library-art/${designId}/print.svg`)).status, 404, 'only the two pictures are served');

    // In the dashboard list: uploaded, by whom, added today.
    const lib = await (await call('/api/admin/library', 'GET', undefined, owner)).json();
    const row = lib.designs.find((x) => x.id === designId);
    assert.strictEqual(row.uploaded, true);
    assert.strictEqual(row.by, 'Mona');
    assert.strictEqual(row.addedOn, new Date().toISOString().slice(0, 10));
    assert.strictEqual(row.artwork, true, 'an uploaded picture counts as an artwork design');

    // The batch keeps what wasn't published; discarding it removes it.
    const left = await (await call(`/api/admin/library/uploads/${batch.id}`, 'GET', undefined, owner)).json();
    assert.deepStrictEqual(left.batch.items.map((i) => i.id), [sunset.id]);
    assert.strictEqual((await call(`/api/admin/library/uploads/${batch.id}`, 'DELETE', undefined, staff)).status, 200);
    assert.strictEqual((await call(`/api/admin/library/uploads/${batch.id}`, 'GET', undefined, owner)).status, 404);
    assert.strictEqual((await fetch(base + sunset.web)).status, 404, 'its pictures go with it');

    // Not a zip at all.
    const bad = await call('/api/admin/library/uploads', 'POST', Buffer.from('not a zip'), owner);
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await bad.json()).code, 'zipBad');
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
