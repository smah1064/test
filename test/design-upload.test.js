'use strict';

// "Upload designs (zip)" (src/design-upload.js): reading untrusted zips safely,
// looking at each picture, suggesting products, names and subjects.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const sharp = require('sharp');
const { UploadError, readZip, analyze, suggest, pickProducts, analysisColor, nameFrom, guessCategory } = require('../src/design-upload');
const { PRODUCTS } = require('../src/products');

// ---------- A tiny zip writer (stored and deflated entries) ----------
// Each file: { name, data, store?, method?, flags?, utf8? (default true), usize?, crc?, offset?, packed? }
// The overrides let a test write a lying or broken zip.
function makeZip(files, { before = Buffer.alloc(0) } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, f.latin1 ? 'latin1' : 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data || '');
    const method = f.method ?? (f.store ? 0 : 8);
    const packed = f.packed || (method === 8 ? zlib.deflateRawSync(raw) : raw);
    const crc = f.crc ?? zlib.crc32(raw);
    const usize = f.usize ?? raw.length;
    const flags = (f.flags || 0) | (f.utf8 === false ? 0 : 0x800);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(usize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(f.offset ?? offset, 42);
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
  return Buffer.concat([...locals, cd, before, end]);
}

const zipError = (fn, code) => assert.throws(fn, (e) => e instanceof UploadError && e.code === code, `expected ${code}`);

// ---------- Pictures ----------
const svgPng = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
const svgJpg = (svg) => sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
const svgOf = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;
// A "photo": a gradient edge to edge with shapes on it.
const photoSvg = (w, h) => svgOf(w, h, `<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#2a6"/><stop offset="1" stop-color="#26c"/></linearGradient></defs>`
  + `<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w / 3}" cy="${h / 2}" r="${h / 4}" fill="#fc3"/><rect x="${w / 2}" y="${h / 5}" width="${w / 4}" height="${h / 2}" fill="#c33"/>`);
// A cut-out: a dark cat-ish shape on nothing, with see-through margins round it.
const cutoutSvg = (fill = '#222', w = 1600, h = 1600) => svgOf(w, h, `<circle cx="${w / 2}" cy="${h * 0.55}" r="${Math.min(w, h) * 0.3}" fill="${fill}"/>`
  + `<path d="M${w * 0.3} ${h * 0.4} L${w * 0.35} ${h * 0.15} L${w * 0.45} ${h * 0.3} Z M${w * 0.7} ${h * 0.4} L${w * 0.65} ${h * 0.15} L${w * 0.55} ${h * 0.3} Z" fill="${fill}"/>`);

// ---------- readZip ----------

test('readZip: files from folders, junk and folders left out, names sorted', () => {
  const zip = makeZip([
    { name: 'designs/', data: '', store: true },
    { name: 'designs/mugs/cat 10.png', data: 'ten' },
    { name: 'designs/mugs/cat 2.png', data: 'two', store: true },
    { name: 'designs/readme.txt', data: 'hello '.repeat(100) },
    { name: '__MACOSX/designs/mugs/._cat 2.png', data: 'resource fork' },
    { name: 'designs/.DS_Store', data: 'x' },
    { name: 'designs/Thumbs.db', data: 'x' },
    { name: '.hidden/secret.png', data: 'x' },
    { name: 'designs/Icon\r', data: '' },
    { name: 'مجات/قطة.png', data: 'arabic' },
  ]);
  const files = readZip(zip);
  assert.deepStrictEqual(files.map((f) => f.path), ['designs/mugs/cat 2.png', 'designs/mugs/cat 10.png', 'designs/readme.txt', 'مجات/قطة.png']);
  assert.strictEqual(files[0].data.toString(), 'two');
  assert.strictEqual(files[1].data.toString(), 'ten');
  assert.strictEqual(files[2].data.toString(), 'hello '.repeat(100));
  assert.deepStrictEqual(files.skipped, []);
  assert.ok(files.every((f) => Buffer.isBuffer(f.data)));
});

test('readZip: UTF-8 names without the flag (macOS) and Latin-1 fallback', () => {
  const files = readZip(makeZip([
    { name: 'تيشيرتات/أسد.png', data: 'a', utf8: false },
    { name: 'caf\u00e9.png', data: 'b', utf8: false, latin1: true },
  ]));
  assert.deepStrictEqual(files.map((f) => f.path).sort(), ['café.png', 'تيشيرتات/أسد.png'].sort());
});

test('readZip: path tricks stay plain names and never climb out', () => {
  const files = readZip(makeZip([
    { name: '../../etc/passwd.png', data: '1' },
    { name: '/abs/root.png', data: '2' },
    { name: 'C:\\Users\\me\\win.png', data: '3' },
    { name: 'a/./b/../c.png', data: '4' },
    { name: 'evil\u202egnp.exe', data: '5' },
    { name: '../', data: '' },
  ]));
  const paths = files.map((f) => f.path).sort();
  assert.deepStrictEqual(paths, ['a/b/c.png', 'abs/root.png', 'etc/passwd.png', 'evilgnp.exe', 'Users/me/win.png'].sort());
  for (const p of paths) {
    assert.ok(!p.split('/').includes('..') && !p.startsWith('/') && !p.includes('\\') && !/^[a-z]:/i.test(p), p);
  }
});

test('readZip: a zip bomb is refused by its declared size and by what really inflates', () => {
  // Declares 700 MB in one entry: refused before inflating anything.
  zipError(() => readZip(makeZip([{ name: 'big.png', data: Buffer.alloc(1000), usize: 700 * 2 ** 20 }])), 'zipTooBig');
  // Several honest files that together pass the total.
  zipError(() => readZip(makeZip([{ name: 'a.png', data: Buffer.alloc(600) }, { name: 'b.png', data: Buffer.alloc(600) }]), { maxTotal: 1000 }), 'zipTooBig');
  // Declares 1 KB but 20 MB of zeros come out: inflating stops at the declared size.
  const zeros = Buffer.alloc(20 * 2 ** 20);
  assert.throws(() => readZip(makeZip([{ name: 'liar.png', data: zeros, usize: 1024 }])), (e) => e.code === 'zipTooBig' && e.params.reason === 'bomb');
  // An honest file bigger than maxFile is skipped (with a reason), not fatal.
  const files = readZip(makeZip([{ name: 'huge.png', data: Buffer.alloc(5000) }, { name: 'ok.png', data: 'x' }]), { maxFile: 4000 });
  assert.deepStrictEqual(files.map((f) => f.path), ['ok.png']);
  assert.deepStrictEqual(files.skipped, [{ path: 'huge.png', reason: 'tooBig' }]);
});

test('readZip: too many entries', () => {
  const many = Array.from({ length: 301 }, (_, i) => ({ name: `d/${i}.png`, data: 'x', store: true }));
  zipError(() => readZip(makeZip(many)), 'zipTooMany');
  assert.strictEqual(readZip(makeZip(many.slice(0, 300))).length, 300);
  zipError(() => readZip(makeZip(many.slice(0, 5)), { maxEntries: 4 }), 'zipTooMany');
  // Junk doesn't count towards the limit, but the directory itself is never walked without end.
  const junk = Array.from({ length: 50 }, (_, i) => ({ name: `__MACOSX/._${i}.png`, data: 'x', store: true }));
  assert.strictEqual(readZip(makeZip([...junk, { name: 'one.png', data: 'x' }]), { maxEntries: 1 }).length, 1);
  zipError(() => readZip(makeZip([...junk, ...junk, ...junk]), { maxEntries: 1 }), 'zipTooMany');
});

test('readZip: broken, encrypted, overlapping and ZIP64 zips are zipBad', () => {
  const good = makeZip([{ name: 'a.png', data: 'hello world '.repeat(50) }, { name: 'b.png', data: 'second' }]);
  zipError(() => readZip(Buffer.from('this is not a zip at all, just some text')), 'zipBad');
  zipError(() => readZip(Buffer.alloc(0)), 'zipBad');
  zipError(() => readZip('not a buffer'), 'zipBad');
  zipError(() => readZip(good.subarray(0, good.length - 30)), 'zipBad'); // cut short
  zipError(() => readZip(good.subarray(40)), 'zipBad'); // the start missing
  // A damaged byte in the data: deflate or CRC fails.
  const damaged = Buffer.from(good);
  damaged[40] ^= 0xff;
  zipError(() => readZip(damaged), 'zipBad');
  zipError(() => readZip(makeZip([{ name: 'a.png', data: 'abc', crc: 1234 }])), 'zipBad');
  // Declares more than really comes out.
  zipError(() => readZip(makeZip([{ name: 'a.png', data: 'abc', usize: 10 }])), 'zipBad');
  assert.throws(() => readZip(makeZip([{ name: 'a.png', data: 'abc', flags: 1 }])), (e) => e.code === 'zipBad' && e.params.reason === 'encrypted');
  zipError(() => readZip(makeZip([{ name: 'a.png', data: 'abc', method: 99, packed: Buffer.from('xxxx') }])), 'zipBad');
  // Two entries pointing at the same bytes (the overlapping-files bomb).
  zipError(() => readZip(makeZip([{ name: 'a.png', data: 'same' }, { name: 'b.png', data: 'same', offset: 0 }])), 'zipBad');
  // A ZIP64 locator before the end record.
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  assert.throws(() => readZip(makeZip([{ name: 'a.png', data: 'x' }], { before: locator })), (e) => e.code === 'zipBad' && e.params.reason === 'zip64');
  // Random bytes never crash.
  for (let i = 0; i < 200; i++) {
    const junk = Buffer.from(good);
    for (let k = 0; k < 6; k++) junk[Math.floor(Math.random() * junk.length)] = Math.floor(Math.random() * 256);
    try {
      readZip(junk);
    } catch (e) {
      assert.ok(e instanceof UploadError, e.stack);
    }
  }
});

test('readZip: an unknown compression is skipped with a reason; an empty zip gives no files', () => {
  const files = readZip(makeZip([
    { name: 'lzma.png', data: 'x', method: 14, packed: Buffer.from('????') },
    { name: 'notes.doc', data: 'x', method: 12, packed: Buffer.from('????') },
    { name: 'fine.png', data: 'x' },
  ]));
  assert.deepStrictEqual(files.map((f) => f.path), ['fine.png']);
  assert.deepStrictEqual(files.skipped, [{ path: 'lzma.png', reason: 'badPicture' }, { path: 'notes.doc', reason: 'notPicture' }]);
  const none = readZip(makeZip([]));
  assert.strictEqual(none.length, 0);
  assert.deepStrictEqual(none.skipped, []);
});

// ---------- analyze ----------

test('analyze: non-pictures, broken and small pictures say why', async () => {
  assert.deepStrictEqual(await analyze(Buffer.from('just some notes'), 'readme.txt'), { ok: false, reason: 'notPicture' });
  assert.deepStrictEqual(await analyze(Buffer.from('<html><body><svg></svg></body></html>'), 'page.html'), { ok: false, reason: 'notPicture' });
  assert.deepStrictEqual(await analyze(Buffer.from('not really a png'), 'fake.png'), { ok: false, reason: 'badPicture' });
  assert.deepStrictEqual(await analyze(Buffer.alloc(0), 'empty.png'), { ok: false, reason: 'badPicture' });
  const png = await svgPng(photoSvg(800, 800));
  assert.deepStrictEqual(await analyze(png.subarray(0, 300), 'cut.png'), { ok: false, reason: 'badPicture' });
  const small = await analyze(await svgPng(photoSvg(400, 300)), 'small.png');
  assert.strictEqual(small.ok, false);
  assert.strictEqual(small.reason, 'tooSmall');
  // A GIF named .png is not one of the pictures we take.
  const gif = await sharp(png).gif().toBuffer();
  assert.strictEqual((await analyze(gif, 'anim.png')).reason, 'badPicture');
  // Nothing visible (all see-through) is not a design.
  const blank = await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.strictEqual((await analyze(blank, 'blank.png')).reason, 'blankPicture', 'an empty picture says so');
});

test('analyze: a cut-out is transparent, trimmed, with dark ink; white artwork has light ink', async () => {
  const a = await analyze(await svgPng(cutoutSvg('#222')), 'cat.png');
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.kind, 'png');
  assert.strictEqual(a.transparent, true);
  assert.strictEqual(a.ink, 'dark');
  assert.strictEqual(a.printExt, 'png');
  assert.ok(a.coverage > 0.3 && a.coverage < 0.95, String(a.coverage));
  assert.strictEqual(a.colors[0], '#222222');
  assert.strictEqual(a.flat, true);
  // The see-through margin round the shape is trimmed: the print is the shape's box.
  assert.ok(a.w < 1300 && a.w > 900 && a.h < 1500, `${a.w}×${a.h}`);
  assert.deepStrictEqual(a.printPx, [a.w, a.h]);
  const pm = await sharp(a.print).metadata();
  assert.deepStrictEqual([pm.format, pm.width, pm.height, pm.hasAlpha], ['png', a.w, a.h, true]);
  const wm = await sharp(a.web).metadata();
  assert.strictEqual(wm.format, 'png');
  assert.ok(Math.max(wm.width, wm.height) <= 1200 && wm.hasAlpha);

  const white = await analyze(await svgPng(cutoutSvg('#ffffff')), 'white.png');
  assert.strictEqual(white.transparent, true);
  assert.strictEqual(white.ink, 'light');
});

test('analyze: a JPG photo is a full picture, kept as JPG at full size, metadata stripped', async () => {
  const jpg = await sharp(Buffer.from(photoSvg(1800, 1200))).jpeg({ quality: 90 }).withMetadata({ orientation: 1 }).toBuffer();
  const a = await analyze(jpg, 'photo.jpg');
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.transparent, false);
  assert.strictEqual(a.background, null);
  assert.strictEqual(a.printExt, 'jpg');
  assert.deepStrictEqual(a.printPx, [1800, 1200]);
  assert.ok(a.colors.length >= 3);
  const pm = await sharp(a.print).metadata();
  assert.strictEqual(pm.format, 'jpeg');
  assert.ok(!pm.exif && !pm.orientation);
});

test('analyze: EXIF orientation is applied; a plain white background is found but kept', async () => {
  // Stored 1600×800 turned a quarter clockwise (orientation 6): it shows 800×1600.
  const stored = await svgJpg(svgOf(1600, 800, '<rect width="1600" height="800" fill="#fff"/><rect x="100" y="100" width="300" height="200" fill="#f00"/><rect x="1000" y="500" width="500" height="200" fill="#00f"/>'));
  const a = await analyze(await sharp(stored).withMetadata({ orientation: 6 }).toBuffer(), 'turned.jpg');
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.background, '#ffffff');
  assert.strictEqual(a.transparent, false);
  assert.deepStrictEqual(a.printPx, [800, 1600]);
  // The red block (stored top left) is now top right, the blue one (stored bottom right) bottom left.
  const { data, info } = await sharp(a.print).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.ok(at(600, 250)[0] > 200 && at(600, 250)[2] < 60, String(at(600, 250)));
  assert.ok(at(200, 1250)[2] > 200 && at(200, 1250)[0] < 60, String(at(200, 1250)));
  // The artwork's colours (red, blue); the white background is `background`, not a colour of it.
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.strictEqual(a.colors.length, 2, String(a.colors));
  assert.ok(a.colors.some((c) => rgb(c)[0] > 200 && rgb(c)[2] < 60) && a.colors.some((c) => rgb(c)[2] > 200 && rgb(c)[0] < 60), String(a.colors));

  // A see-through WebP turned the same way is trimmed round the shape as it shows.
  const webp = await sharp(Buffer.from(svgOf(1600, 800, '<rect x="100" y="100" width="800" height="400" fill="#0a0"/>'))).webp({ lossless: true }).withMetadata({ orientation: 6 }).toBuffer();
  assert.strictEqual((await sharp(webp).metadata()).orientation, 6);
  const b = await analyze(webp, 'turned.webp');
  assert.strictEqual(b.ok, true, b.reason);
  assert.strictEqual(b.printExt, 'png');
  assert.ok(b.w >= 400 && b.w < 440 && b.h >= 800 && b.h < 840, `${b.w}×${b.h}`);
});

test('analyze: SVG is drawn into a PNG (4000 px long side), outside links neutralised, never kept as SVG', async () => {
  const svg = `<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
  <!ENTITY ns_svg "http://www.w3.org/2000/svg">
  <!ENTITY ns_xlink "http://www.w3.org/1999/xlink">
]>
<svg xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" width="80" height="60" viewBox="0 0 80 60">
<style>@import url(http://127.0.0.1:9/x.css); .a { fill: url(http://127.0.0.1:9/p.svg#x) }</style>
<image xlink:href="file:///etc/passwd" width="10" height="10"/>
<image href="http://127.0.0.1:9/a.png" width="10" height="10"/>
<rect width="80" height="60" fill="#123456"/><circle cx="40" cy="30" r="20" fill="#eeeeee"/></svg>`;
  const a = await analyze(Buffer.from(svg), 'logo.svg');
  assert.strictEqual(a.ok, true, a.reason);
  assert.strictEqual(a.kind, 'svg');
  assert.strictEqual(a.printExt, 'png');
  assert.deepStrictEqual(a.printPx, [4000, 3000]);
  for (const buf of [a.web, a.print]) {
    assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
    assert.ok(!buf.includes('<svg') && !buf.includes('xlink') && !buf.includes('passwd'));
  }
  // A light circle on a plain navy square: artwork on a plain background (kept, not trimmed).
  assert.strictEqual(a.background, '#123456');
  assert.strictEqual(a.colors[0], '#eeeeee');
  assert.strictEqual(a.ink, 'light');
  // A logo with nothing behind it stays see-through.
  const logo = await analyze(Buffer.from(svgOf(300, 100, '<text x="10" y="80" font-size="80" fill="#c33">LOGO</text>')), 'logo.svg');
  assert.strictEqual(logo.ok, true, logo.reason);
  assert.strictEqual(logo.transparent, true);
  assert.ok((await sharp(logo.print).metadata()).hasAlpha);
});

test('analyze: hostile SVGs end as badPicture quickly', async () => {
  const laughs = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><text>&c;</text><rect width="800" height="800"/></svg>`;
  const include = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xi="http://www.w3.org/2001/XInclude" width="800" height="800"><xi:include href="/etc/passwd" parse="text"/></svg>';
  const unclosed = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800"';
  const started = Date.now();
  for (const svg of [laughs, include, unclosed]) assert.strictEqual((await analyze(Buffer.from(svg), 'x.svg')).reason, 'badPicture');
  // A huge declared size is drawn at 4000 px, not at its own size; an absurd one is refused.
  const huge = await analyze(Buffer.from(svgOf(1e5, 5e4, '<rect width="100000" height="50000" fill="#c33"/><circle cx="50000" cy="25000" r="20000" fill="#fff"/>')), 'huge.svg');
  assert.deepStrictEqual(huge.printPx, [4000, 2000]);
  assert.strictEqual((await analyze(Buffer.from(svgOf(1e8, 1e8, '<rect width="1" height="1"/>')), 'absurd.svg')).reason, 'badPicture');
  // Gzipped SVG (which sharp would unpack) is not taken as an SVG at all.
  assert.strictEqual((await analyze(zlib.gzipSync(svgOf(800, 800, '<rect width="800" height="800"/>')), 'x.svg')).reason, 'badPicture');
  assert.ok(Date.now() - started < 15000);
});

// ---------- suggest ----------

const art = (w, h, more) => ({ ok: true, kind: 'png', w, h, transparent: true, ink: 'dark', coverage: 0.5, colors: ['#222222'], flat: false, background: null, ...more });
const full = (w, h, more) => ({ ok: true, kind: 'jpg', w, h, transparent: false, ink: 'dark', coverage: 1, colors: ['#2a6', '#26c'], flat: false, background: null, ...more });
const ids = (list, n) => list.slice(0, n).map((s) => s.productId);
const byId = (list, id) => list.find((s) => s.productId === id);

test('suggest: a transparent cut-out goes on clothes, mugs and bags first', () => {
  const list = suggest(art(3000, 3000), PRODUCTS);
  const top3 = ids(list, 3);
  assert.ok(top3.includes('tshirt') && top3.includes('mug'), top3.join());
  const top8 = ids(list, 8);
  for (const id of ['hoodie', 'sweatshirt', 'tote']) assert.ok(top8.includes(id), `${id} in ${top8}`);
  for (const id of ['tshirt', 'mug']) {
    const s = byId(list, id);
    assert.ok(s.ok && s.score >= 0.75 && s.reasons.includes('transparentArtwork') && s.reasons.includes('darkInk'), JSON.stringify(s));
  }
  // Shop print takes no random picture first.
  assert.ok(byId(list, 'invoicebook').score < 0.2 && byId(list, 'letterhead').score < 0.3);
  const picked = pickProducts(list);
  assert.ok(picked.length === 8 && picked.includes('tshirt') && picked.includes('mug'));
});

test('suggest: a panoramic picture goes round a mug first', () => {
  for (const [w, h] of [[2300, 1000], [2400, 1000], [2600, 1000]]) {
    const list = suggest(full(w, h), PRODUCTS);
    assert.strictEqual(list[0].productId, 'mug', ids(list, 5).join());
    assert.ok(list[0].reasons.includes('wrapFits') && list[0].ok && list[0].score >= 0.9);
  }
  // A cut-out that wide wraps round the mug too.
  assert.strictEqual(suggest(art(2500, 1000), PRODUCTS)[0].productId, 'mug');
});

test('suggest: an upright photo edge to edge goes on wall art and phone cases', () => {
  const list = suggest(full(2000, 3000), PRODUCTS);
  const top3 = ids(list, 3);
  assert.ok(top3.includes('poster') && top3.includes('canvas'), top3.join());
  assert.ok(pickProducts(list).includes('phonecase'), ids(list, 10).join());
  assert.ok(byId(list, 'poster').reasons.includes('fullPicture'));
  assert.ok(byId(list, 'canvas').reasons.includes('shapeFits'));
  // A wide canvas and a wide desk mat are a poor fit for an upright picture.
  assert.ok(byId(list, 'canvaswide').score < 0.45 && byId(list, 'deskmat').score < 0.45);
});

test('suggest: folder and file names (English and Arabic) come first', () => {
  const photo = full(2000, 3000);
  const cut = art(3000, 3000);
  assert.strictEqual(suggest(photo, PRODUCTS, { path: 'mugs/photo.jpg' })[0].productId, 'mug');
  assert.ok(suggest(photo, PRODUCTS, { path: 'mugs/photo.jpg' })[0].reasons.includes('folderName'));
  assert.strictEqual(suggest(cut, PRODUCTS, { path: 'designs/مجات/قطة.png' })[0].productId, 'mug');
  assert.strictEqual(suggest(cut, PRODUCTS, { path: 'مج/قطة.png' })[0].productId, 'mug');
  assert.strictEqual(suggest(photo, PRODUCTS, { path: 'تيشيرتات/صورة.jpg' })[0].productId, 'tshirt');
  assert.strictEqual(suggest(photo, PRODUCTS, { path: 'Hoodies/x.jpg' })[0].productId, 'hoodie');
  assert.strictEqual(suggest(cut, PRODUCTS, { path: 'posters/x.png' })[0].productId, 'poster');
  assert.strictEqual(suggest(cut, PRODUCTS, { path: 'x/phone-cases/x.png' })[0].productId, 'phonecase');
  assert.strictEqual(suggest(cut, PRODUCTS, { path: 'kids hoodies/x.png' })[0].productId, 'kidshoodie');
  const cards = ids(suggest(photo, PRODUCTS, { path: 'cards/eid.jpg' }), 3);
  assert.ok(cards.every((id) => ['greetingcard', 'foldedcards', 'postcards'].includes(id)), cards.join());
  const file = suggest(cut, PRODUCTS, { path: 'cat-tote-bag.png' });
  assert.strictEqual(file[0].productId, 'tote');
  assert.ok(file[0].reasons.includes('fileName'));
  // A product's own name works as a folder name.
  assert.strictEqual(suggest(cut, PRODUCTS, { path: 'Ceramic Mug/x.png' })[0].productId, 'mug');
  // Words inside other words don't count ("landscape" is not a cap, "smuggler" not a mug, "committee" not a tee).
  const unnamed = suggest(cut, PRODUCTS, { path: 'landscape/committee-smuggler.png' });
  assert.ok(unnamed.every((s) => !s.reasons.includes('folderName') && !s.reasons.includes('fileName')));
  assert.deepStrictEqual(unnamed, suggest(cut, PRODUCTS));
});

test('suggest: books, photo sets, booklets, fabric and laser stay out unless they fit', () => {
  const kinds = PRODUCTS.filter((p) => p.kind || p.paged).map((p) => p.id);
  const fabric = PRODUCTS.filter((p) => p.pattern).map((p) => p.id);
  const laser = PRODUCTS.filter((p) => p.laser).map((p) => p.id);
  assert.ok(kinds.length && fabric.length && laser.length);
  const list = suggest(full(3000, 3000), PRODUCTS).map((s) => s.productId);
  for (const id of [...kinds, ...fabric, ...laser, 'prayermat']) assert.ok(!list.includes(id), id);
  // Fabric when the folder says so; laser for one flat colour.
  assert.strictEqual(suggest(full(3000, 3000), PRODUCTS, { path: 'fabric/pattern.jpg' })[0].productId, 'fabric');
  const flat = suggest(art(3000, 3000, { flat: true }), PRODUCTS).map((s) => s.productId);
  assert.ok(laser.every((id) => flat.includes(id)));
  assert.ok(!flat.some((id) => kinds.includes(id)));
  const engraved = suggest(art(3000, 3000, { flat: true }), PRODUCTS, { path: 'laser/logo.png' });
  assert.ok(laser.includes(engraved[0].productId) && engraved[0].reasons.includes('flatColour'), JSON.stringify(engraved[0]));
});

test('suggest: resolution decides ok (below 100 DPI is lowRes)', () => {
  const list = suggest(full(800, 1200), PRODUCTS);
  const poster = byId(list, 'poster');
  assert.strictEqual(poster.ok, false);
  assert.ok(poster.dpi < 100 && poster.reasons.includes('lowRes'));
  assert.ok(!pickProducts(list).includes('poster'));
  const phone = byId(list, 'phonecase');
  assert.ok(phone.ok && phone.dpi > 150 && phone.reasons.includes('highRes'));
  // The DPI is the picture filling 92% of the print area at the default size (a T-shirt: 12 in wide).
  const tee = byId(suggest(art(2208, 2208), PRODUCTS), 'tshirt');
  assert.strictEqual(tee.dpi, 200);
  assert.deepStrictEqual(suggest({ ok: false, reason: 'notPicture' }, PRODUCTS), []);
});

test('suggest: light artwork needs a dark product colour', () => {
  const list = suggest(art(3000, 3000, { ink: 'light' }), PRODUCTS);
  assert.ok(byId(list, 'tshirt').reasons.includes('lightInk'));
  assert.ok(byId(list, 'poster').reasons.includes('inkClash')); // posters print on white paper
  assert.ok(byId(list, 'poster').score < byId(suggest(art(3000, 3000), PRODUCTS), 'poster').score);
});

test('suggest: from a real analysed picture', async () => {
  const a = await analyze(await svgPng(cutoutSvg('#222', 2400, 2400)), 'designs/mugs/cat.png');
  const list = suggest(a, PRODUCTS, { path: 'designs/mugs/cat.png' });
  assert.strictEqual(list[0].productId, 'mug');
  for (const s of list) {
    assert.ok(s.score >= 0 && s.score <= 1 && Number.isInteger(s.dpi) && Array.isArray(s.reasons));
  }
});

test('analysisColor: white for dark artwork, black for light, nearest for a plain background', () => {
  const get = (id) => PRODUCTS.find((p) => p.id === id);
  assert.strictEqual(analysisColor(art(1, 1), get('tshirt')), 'white');
  assert.strictEqual(analysisColor(art(1, 1, { ink: 'light' }), get('tshirt')), 'black');
  assert.strictEqual(analysisColor(art(1, 1), get('phonecase')), 'clear'); // the lightest there is
  assert.strictEqual(analysisColor(art(1, 1, { ink: 'light' }), get('hoodie')), 'black');
  assert.strictEqual(analysisColor(full(1, 1), get('mug')), 'white');
  assert.strictEqual(analysisColor(full(1, 1), get('poster')), get('poster').colors[0].id); // the frame
  assert.strictEqual(analysisColor(full(1, 1, { background: '#ffffff' }), get('hoodie')), 'cream');
  assert.strictEqual(analysisColor(full(1, 1), { id: 'x', colors: [] }), null);
});

// ---------- names and subjects ----------

test('nameFrom: a readable name from the file name', () => {
  assert.deepStrictEqual(nameFrom('happy-cat_01.png'), { en: 'Happy cat', ar: 'Happy cat' });
  assert.deepStrictEqual(nameFrom('designs/mugs/HappyCat (2).PNG'), { en: 'Happy cat', ar: 'Happy cat' });
  assert.deepStrictEqual(nameFrom('قطة_سعيدة.png'), { en: 'قطة سعيدة', ar: 'قطة سعيدة' });
  assert.deepStrictEqual(nameFrom('NASA_logo-final.svg'), { en: 'NASA logo', ar: 'NASA logo' });
  assert.deepStrictEqual(nameFrom('HAPPY_CAT.jpg'), { en: 'Happy cat', ar: 'Happy cat' });
  assert.deepStrictEqual(nameFrom('iPhone wallpaper copy.png'), { en: 'iPhone wallpaper', ar: 'iPhone wallpaper' });
  assert.deepStrictEqual(nameFrom('01 - new baby.png'), { en: 'New baby', ar: 'New baby' });
  assert.deepStrictEqual(nameFrom('IMG_1234.JPG'), { en: 'Design 1234', ar: 'تصميم 1234' });
  assert.deepStrictEqual(nameFrom('.png'), { en: 'Design', ar: 'تصميم' });
  assert.ok(nameFrom(`${'long '.repeat(40)}.png`).en.length <= 80);
});

test('guessCategory: subjects from folders (innermost first) and file names, else other', () => {
  assert.strictEqual(guessCategory('ramadan/fanous.png'), 'ramadan');
  assert.strictEqual(guessCategory('رمضان/فانوس.png'), 'ramadan');
  assert.strictEqual(guessCategory('designs/عيد ميلاد/كيكة.png'), 'birthday');
  assert.strictEqual(guessCategory('العيد/x.png'), 'eid');
  assert.strictEqual(guessCategory('happy-cat_01.png'), 'pets');
  assert.strictEqual(guessCategory('football/mugs/x.png'), 'football');
  assert.strictEqual(guessCategory('mugs/love/heart.png'), 'love');
  assert.strictEqual(guessCategory('Funny Phrases/x.png'), 'funny'); // a subject's own name
  assert.strictEqual(guessCategory('random stuff/IMG_1.png'), 'other');
  assert.strictEqual(guessCategory(''), 'other');
});
