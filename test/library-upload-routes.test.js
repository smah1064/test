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

    // Paused: its pictures still load (customers' drafts made from it print at full size), not cached publicly.
    assert.strictEqual((await call(`/api/admin/library/${designId}`, 'PATCH', { hidden: true }, owner)).status, 200);
    const paused = await fetch(base + item.printSrc);
    assert.strictEqual(paused.status, 200);
    assert.match(paused.headers.get('cache-control'), /private/);
    // Deleted (taken down): neither the original nor the screen copy is public any more (QA 25 Nov).
    assert.strictEqual((await call(`/api/admin/library/${designId}`, 'DELETE', undefined, owner)).status, 200);
    assert.strictEqual((await fetch(base + item.printSrc)).status, 404);
    assert.strictEqual((await fetch(base + item.src)).status, 404);
    // Brought back: served again.
    assert.strictEqual((await call(`/api/admin/library/${designId}`, 'PATCH', { deleted: false, hidden: false }, owner)).status, 200);
    assert.strictEqual((await fetch(base + item.printSrc)).status, 200);

    // Not a zip at all.
    const bad = await call('/api/admin/library/uploads', 'POST', Buffer.from('not a zip'), owner);
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await bad.json()).code, 'zipBad');
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

/** A shop on a free port, with a signed-in owner. */
async function shop(dataDir, limits) {
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false, limits });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-owner-pass' }) })).json()).token;
  const auth = { Authorization: `Bearer ${owner}` };
  const get = async (url) => (await fetch(base + url, { headers: auth })).json();
  /** Until the batch has been read (the background reading). */
  const ready = async (id) => {
    for (let i = 0; i < 200; i++) {
      const { batch } = await get(`/api/admin/library/uploads/${id}`);
      if (batch.status !== 'reading') return batch;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('still reading');
  };
  return { server, base, auth, get, ready };
}
const pictureZip = async (n) => {
  const files = [];
  for (let i = 0; i < n; i++) {
    const data = await sharp({ create: { width: 1600, height: 1600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><circle cx="800" cy="800" r="${300 + i * 40}" fill="#2a9d8f"/></svg>`) }]).png().toBuffer();
    files.push({ name: `design-${i + 1}.png`, data });
  }
  return makeZip(files);
};

test('a big zip answers "reading" and is read in the background; nothing publishes until it is done', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libupload-bg-'));
  const { server, base, auth, get, ready } = await shop(dataDir, { zipWaitMs: 0 });
  try {
    const up = await fetch(`${base}/api/admin/library/uploads`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: await pictureZip(4) });
    assert.strictEqual(up.status, 202, await up.clone().text());
    const { batch } = await up.json();
    assert.strictEqual(batch.status, 'reading');
    assert.strictEqual(batch.total, 4);
    // The list shows it with its progress; publishing waits.
    const listed = (await get('/api/admin/library/uploads')).batches.find((b) => b.id === batch.id);
    assert.strictEqual(listed.status, 'reading');
    assert.strictEqual(listed.total, 4);
    const early = await fetch(`${base}/api/admin/library/uploads/${batch.id}/publish`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }) });
    if (early.status !== 200) assert.strictEqual((await early.json()).code, 'uploadNotReady');
    const done = await ready(batch.id);
    assert.strictEqual(done.status, 'ready');
    assert.strictEqual(done.items.length, 4);
    assert.strictEqual(done.done, 4);
    assert.ok(!fs.existsSync(path.join(dataDir, 'library', 'uploads', batch.id, 'upload.zip')), 'the zip itself goes once read');
    const pub = await (await fetch(`${base}/api/admin/library/uploads/${batch.id}/publish`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: done.items.map((i) => ({ id: i.id, products: ['tshirt'] })) }) })).json();
    assert.strictEqual(pub.published.length, 4);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('zips over the size limit are refused, whether the size is announced or not', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libupload-max-'));
  const { server, base, auth } = await shop(dataDir, { zipMaxMB: 1 });
  try {
    const big = Buffer.alloc(1.5 * 2 ** 20, 7);
    const said = await fetch(`${base}/api/admin/library/uploads`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: big });
    assert.strictEqual(said.status, 413);
    const body = await said.json();
    assert.strictEqual(body.code, 'zipOver');
    assert.match(body.error, /1 MB/);
    // Sent in pieces with no size given: stopped once it passes the limit.
    const pieces = new ReadableStream({
      start(c) {
        for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(300 * 1024));
        c.close();
      },
    });
    const streamed = await fetch(`${base}/api/admin/library/uploads`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: pieces, duplex: 'half' }).catch(() => null);
    if (streamed) assert.strictEqual(streamed.status, 413);
    assert.deepStrictEqual(fs.readdirSync(path.join(dataDir, 'library', 'uploads')), [], 'nothing is left on disk');
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a zip still being read when the shop restarts carries on where it was', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libupload-resume-'));
  // As a stopped shop left it: the zip saved, 1 of 3 pictures read (that one is read again).
  const id = 'ab'.repeat(10);
  const dir = path.join(dataDir, 'library', 'uploads', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'upload.zip'), await pictureZip(3));
  fs.writeFileSync(path.join(dir, 'batch.json'), JSON.stringify({ id, createdAt: new Date().toISOString(), by: 'owner', file: 'big.zip', status: 'reading', total: 3, done: 1, items: [], skipped: [] }));
  const { server, ready } = await shop(dataDir, {});
  try {
    const done = await ready(id);
    assert.strictEqual(done.status, 'ready');
    assert.deepStrictEqual(done.items.map((i) => i.path), ['design-2.png', 'design-3.png'], 'it went on from the second picture');
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a big zip goes up in pieces: pieces sent again or out of order are told where to go on from', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libupload-pieces-'));
  const { server, base, auth, get, ready } = await shop(dataDir, { zipMaxMB: 2 });
  const json = { ...auth, 'Content-Type': 'application/json' };
  try {
    const zip = await pictureZip(2);
    // Over the limit: refused before anything is sent.
    const over = await fetch(`${base}/api/admin/library/uploads/start`, { method: 'POST', headers: json, body: JSON.stringify({ size: 3 * 2 ** 20, name: 'x.zip' }) });
    assert.strictEqual(over.status, 413);
    assert.strictEqual((await over.json()).code, 'zipOver');
    const start = await (await fetch(`${base}/api/admin/library/uploads/start`, { method: 'POST', headers: json, body: JSON.stringify({ size: zip.length, name: 'باكدج كبير.zip' }) })).json();
    assert.match(start.id, /^[0-9a-f]{20}$/);
    assert.ok(start.piece >= 2 ** 20);
    const put = (at, part) => fetch(`${base}/api/admin/library/uploads/${start.id}/piece?at=${at}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: part });
    const half = Math.floor(zip.length / 2);
    // Not listed while it goes up; finishing early says how much arrived.
    assert.ok(!(await get('/api/admin/library/uploads')).batches.some((b) => b.id === start.id));
    assert.strictEqual((await (await put(0, zip.subarray(0, half))).json()).received, half);
    const again = await put(0, zip.subarray(0, half)); // sent again (the answer was lost)
    assert.strictEqual(again.status, 409);
    assert.strictEqual((await again.json()).received, half);
    const early = await fetch(`${base}/api/admin/library/uploads/${start.id}/finish`, { method: 'POST', headers: auth });
    assert.strictEqual(early.status, 409);
    assert.strictEqual((await early.json()).received, half);
    const ahead = await put(half + 10, zip.subarray(half + 10)); // a gap
    assert.strictEqual((await ahead.json()).received, half);
    assert.strictEqual((await (await put(half, zip.subarray(half))).json()).received, zip.length);
    const fin = await fetch(`${base}/api/admin/library/uploads/${start.id}/finish`, { method: 'POST', headers: auth });
    assert.ok(fin.status === 201 || fin.status === 202, String(fin.status));
    const done = await ready(start.id);
    assert.strictEqual(done.status, 'ready');
    assert.strictEqual(done.items.length, 2);
    assert.strictEqual(done.file, 'باكدج كبير.zip');
    // Finishing again (a lost answer) is harmless.
    assert.strictEqual((await fetch(`${base}/api/admin/library/uploads/${start.id}/finish`, { method: 'POST', headers: auth })).status, 201);
    // A broken zip sent in pieces is refused at the end and nothing is kept.
    const junk = Buffer.alloc(5000, 1);
    const s2 = await (await fetch(`${base}/api/admin/library/uploads/start`, { method: 'POST', headers: json, body: JSON.stringify({ size: junk.length, name: 'junk.zip' }) })).json();
    await fetch(`${base}/api/admin/library/uploads/${s2.id}/piece?at=0`, { method: 'PUT', headers: auth, body: junk });
    const bad = await fetch(`${base}/api/admin/library/uploads/${s2.id}/finish`, { method: 'POST', headers: auth });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await bad.json()).code, 'zipBad');
    assert.ok(!fs.existsSync(path.join(dataDir, 'library', 'uploads', s2.id)));
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
