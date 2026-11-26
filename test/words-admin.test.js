'use strict';

// Editable words in uploaded designs (src/words.js, src/words-routes.js, the library's words state): the picture
// split into its drawing and its words with fake Gemini answers, the background queue (statuses, daily cap,
// retries, off without a key, keep / use, a restart carrying on), the admin routes, and the texts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const express = require('express');
const sharp = require('sharp');

const words = require('../src/words');
const { mount } = require('../src/words-routes');
const { Library } = require('../src/library');
const { MESSAGES, format } = require('../src/i18n');
const roles = require('../src/roles');

// ---------- A synthetic design: an orange disc, two lines of "letters" (black blocks), one on a white badge ----------
const LINES = [
  { text: 'HAPPY DAY', x0: 700, x1: 1400, y0: 200, y1: 320, font: 'Bebas Neue' },
  { text: 'يا سارة', x0: 820, x1: 1280, y0: 800, y1: 880, font: 'Lalezar' },
];
const BADGE = { x0: 760, x1: 1340, y0: 740, y1: 940 }; // white, behind the second line
const DISC = { cx: 350, cy: 600, r: 250 };
const lettersSvg = (l) => {
  const n = 6;
  const step = (l.x1 - l.x0) / n;
  const w = Math.round(step * 0.7);
  return Array.from({ length: n }, (_, i) => `<rect x="${i === n - 1 ? l.x1 - w : Math.round(l.x0 + i * step)}" y="${l.y0}" width="${w}" height="${l.y1 - l.y0}" fill="#141414"/>`).join('');
};
async function picture({ W = 1600, H = 1200, opaque = false, lines = LINES, badge = true } = {}) {
  const k = W / 1600;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <circle cx="${DISC.cx}" cy="${DISC.cy}" r="${DISC.r}" fill="#ff7a00"/>
    ${badge ? `<rect x="${BADGE.x0}" y="${BADGE.y0}" width="${BADGE.x1 - BADGE.x0}" height="${BADGE.y1 - BADGE.y0}" rx="30" fill="#ffffff"/>` : ''}
    ${lines.map(lettersSvg).join('')}</svg>`;
  const art = await sharp(Buffer.from(svg)).resize(Math.round(1600 * k), Math.round(1200 * k)).png().toBuffer();
  const base = sharp({ create: { width: W, height: H, channels: opaque ? 3 : 4, background: opaque ? '#2a6fdb' : { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: art }]);
  return opaque ? base.jpeg({ quality: 95 }).toBuffer() : base.png().toBuffer();
}
const box2d = (l, W = 1600, H = 1200) => [Math.round((l.y0 / H) * 1000), Math.round((l.x0 / W) * 1000), Math.round((l.y1 / H) * 1000), Math.round((l.x1 / W) * 1000)];
const textAnswer = (obj) => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }] });
const imageAnswer = (buf) => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: buf.toString('base64') } }] }, finishReason: 'STOP' }] });
const isText = (req) => req.config && req.config.responseMimeType === 'application/json';

/**
 * A stand-in for Gemini: the list of lines (detect), and an edit that paints the words' places white (on what it
 * was sent, white margins and all) and answers at 2048 px wide, as the image model does. `scale`: the design's
 * coordinates (1600 × 1200) to the picture's.
 */
function fakeGemini({ lines = LINES, scale = 1, W = 1600 * scale, H = 1200 * scale, remove = lines, paint = '#ffffff', extra = {} } = {}) {
  const calls = [];
  const call = async (req) => {
    calls.push(req);
    if (isText(req)) {
      if (extra.text) return extra.text(req);
      return textAnswer({ lines: lines.map((l) => ({ text: l.text, box_2d: box2d(l), color: '#141414', font: l.font, weight: 'bold', curve: l.curve || 0, angle: 0 })) });
    }
    if (extra.image) return extra.image(req);
    const sent = Buffer.from(req.contents[0].parts[1].inlineData.data, 'base64');
    const m = await sharp(sent).metadata();
    // The picture sent fits 2048 px, with white margins to the model's shape.
    const k = Math.min(1, 2048 / Math.max(W, H));
    const left = Math.floor((m.width - Math.round(W * k)) / 2);
    const top = Math.floor((m.height - Math.round(H * k)) / 2);
    const f = scale * k;
    // (The background continued where the words were: white for a see-through picture, sent on white.)
    const rects = remove.map((l) => `<rect x="${Math.round(left + (l.x0 - 8) * f)}" y="${Math.round(top + (l.y0 - 8) * f)}" width="${Math.round((l.x1 - l.x0 + 16) * f)}" height="${Math.round((l.y1 - l.y0 + 16) * f)}" fill="${paint}"/>`).join('');
    const painted = await sharp(sent).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}">${rects}</svg>`) }]).png().toBuffer();
    return imageAnswer(await sharp(painted).resize(2048).png().toBuffer());
  };
  return { call, calls };
}
const rawOf = (buf) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

test('split: the words come out as text where they were drawn; every other pixel and the transparency stay', async () => {
  const W = 1600;
  const H = 1200;
  const src = await picture();
  const g = fakeGemini();
  const out = await words.split(src, { call: g.call });
  assert.strictEqual(out.words, true);
  // The text model: the editor's fonts (read from templates.js) offered, a JSON answer asked for.
  const text = g.calls.filter(isText);
  assert.ok(text.length >= 1);
  const schema = text[text.length - 1].config.responseSchema;
  assert.ok(schema.properties.lines.items.properties.font.enum.includes('Lalezar') && schema.properties.lines.items.properties.font.enum.includes('Bebas Neue'));
  assert.deepStrictEqual(schema.properties.lines.items.properties.box_2d, { type: 'ARRAY', items: { type: 'INTEGER' } });
  assert.match(text[0].contents[0].parts[0].text, /logo/);
  // The image model: the shop's image model, the picture on white, the lines named.
  const edit = g.calls.find((c) => !isText(c));
  assert.strictEqual(edit.model, process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image');
  assert.match(edit.contents[0].parts[0].text, /Remove all the words and letters/);
  assert.match(edit.contents[0].parts[0].text, /«HAPPY DAY»/);
  assert.strictEqual(edit.config.imageConfig.aspectRatio, '4:3');

  // The words-free picture: the original's size and alpha channel; outside the words every pixel is the original's.
  const a = await rawOf(src);
  const b = await rawOf(out.png);
  assert.deepStrictEqual([b.info.width, b.info.height], [W, H]);
  assert.strictEqual((await sharp(out.png).metadata()).hasAlpha, true);
  let changedOutside = 0;
  let wordsLeft = 0;
  let badgeHoles = 0;
  let discChanged = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const same = a.data.readUInt32LE(i) === b.data.readUInt32LE(i);
      const nearWords = LINES.some((l) => x >= l.x0 - 40 && x <= l.x1 + 40 && y >= l.y0 - 40 && y <= l.y1 + 40);
      if (!same && !nearWords) changedOutside++;
      if (!same && (x - DISC.cx) ** 2 + (y - DISC.cy) ** 2 <= DISC.r ** 2) discChanged++;
      const inLetters = LINES.some((l) => x >= l.x0 && x < l.x1 && y >= l.y0 && y < l.y1);
      const onBadge = x >= BADGE.x0 + 30 && x < BADGE.x1 - 30 && y >= BADGE.y0 + 10 && y < BADGE.y1 - 10;
      // The letters are gone: see-through on the first line, the white badge again under the second.
      if (inLetters && !onBadge && b.data[i + 3] > 0) wordsLeft++;
      if (inLetters && onBadge && !(b.data[i + 3] === 255 && b.data[i] > 245 && b.data[i + 1] > 245 && b.data[i + 2] > 245)) badgeHoles++;
    }
  }
  assert.strictEqual(changedOutside, 0, 'no pixel changed away from the words');
  assert.strictEqual(discChanged, 0, 'the drawing is exactly the original');
  assert.strictEqual(wordsLeft, 0, 'the first line is gone, see-through as round it');
  assert.strictEqual(badgeHoles, 0, 'the badge behind the second line is white again, not see-through');

  // The texts: each line's centre and width where the letters were, its font, its colour from the pixels.
  assert.strictEqual(out.texts.length, 2);
  for (const [k, l] of LINES.entries()) {
    const t = out.texts[k];
    assert.strictEqual(t.text, l.text);
    assert.strictEqual(t.font, l.font);
    assert.strictEqual(t.weight, 'bold');
    assert.strictEqual(t.fill, '#141414');
    assert.ok(Math.abs(t.x - (l.x0 + l.x1) / 2 / W) < 0.004, `${l.text}: x ${t.x}`);
    assert.ok(Math.abs(t.y - (l.y0 + l.y1) / 2 / H) < 0.004, `${l.text}: y ${t.y}`);
    assert.ok(Math.abs(t.w - (l.x1 - l.x0) / W) < 0.006, `${l.text}: w ${t.w}`);
    assert.ok(t.size > 0.6 * ((l.y1 - l.y0) / W) && t.size < 2 * ((l.y1 - l.y0) / W), `${l.text}: size ${t.size}`);
    assert.strictEqual(t.curve, undefined);
  }
});

test('split: a big opaque JPG: at most 2048 px go to Gemini, the result is the full size without an alpha channel', async () => {
  const W = 3200;
  const H = 2400;
  const src = await picture({ W, H, opaque: true, badge: false });
  const g = fakeGemini({ scale: 2, paint: '#2a6fdb' });
  const out = await words.split(src, { call: g.call });
  for (const c of g.calls) {
    const m = await sharp(Buffer.from(c.contents[0].parts[1].inlineData.data, 'base64')).metadata();
    assert.ok(Math.max(m.width, m.height) <= 2048, `sent ${m.width} × ${m.height}`);
  }
  const meta = await sharp(out.png).metadata();
  assert.deepStrictEqual([meta.width, meta.height, meta.channels], [W, H, 3]);
  const a = await sharp(src).raw().toBuffer();
  const b = await sharp(out.png).raw().toBuffer();
  let changedOutside = 0;
  let wordsLeft = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 3;
      const nearWords = LINES.some((l) => x >= 2 * l.x0 - 60 && x <= 2 * l.x1 + 60 && y >= 2 * l.y0 - 60 && y <= 2 * l.y1 + 60);
      if (!nearWords && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) changedOutside++;
      // (The letters were near black; the background is blue.)
      if (LINES.some((l) => x >= 2 * l.x0 && x < 2 * l.x1 && y >= 2 * l.y0 && y < 2 * l.y1) && b[i] + b[i + 1] + b[i + 2] < 200) wordsLeft++;
    }
  }
  assert.strictEqual(changedOutside, 0);
  assert.strictEqual(wordsLeft, 0);
  assert.ok(Math.abs(out.texts[0].x - 0.65625) < 0.004 && Math.abs(out.texts[0].w - 0.4375) < 0.006);
});

test('split: no words → { words: false } without an image edit; a curved line keeps its curve', async () => {
  const g = fakeGemini({ lines: [] });
  assert.deepStrictEqual(await words.split(await picture({ lines: [] }), { call: g.call }), { words: false });
  assert.ok(g.calls.every(isText), 'no image edit for a picture without words');

  // A line drawn along an arc as the editor bends text (public/js/fabric-ext.js, curve 40): 600 px long, letters
  // 80 px high (a 100 px font). The curve is kept, and the font size worked out from the arc's box.
  const len = 600;
  const fsz = 100;
  const theta = 0.4 * Math.min(Math.PI, len / (0.75 * 1.13 * fsz));
  const R = len / theta;
  const half = theta / 2;
  const cx = 800;
  const cy = 250 + R + 40;
  const pt = (r, a) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  const arc = { text: 'CURVED', font: 'Anton', curve: 40, x0: Math.round(cx - (R + 40) * Math.sin(half)), x1: Math.round(cx + (R + 40) * Math.sin(half)), y0: 250, y1: Math.round(cy - (R - 40) * Math.cos(half)) };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><path d="M ${pt(R, -half)} A ${R} ${R} 0 0 1 ${pt(R, half)}" stroke="#141414" stroke-width="80" fill="none"/></svg>`;
  const src = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  const c = await words.split(src, { call: fakeGemini({ lines: [arc] }).call });
  assert.strictEqual(c.texts[0].curve, 40);
  assert.ok(Math.abs(c.texts[0].size - fsz / 1600) < 0.006, `size ${c.texts[0].size}`);
  assert.ok(Math.abs(c.texts[0].w - len / 1600) < 0.02, `length ${c.texts[0].w}`);
  assert.ok(Math.abs(c.texts[0].x - 0.5) < 0.004, `x ${c.texts[0].x}`);
  // straightOfArc: back from the box a curved line fills to its length and font size.
  const back = words.straightOfArc(arc.x1 - arc.x0, arc.y1 - arc.y0, 40);
  assert.ok(Math.abs(back.len - len) < 6 && Math.abs(back.fs - fsz) < 3, `${back.len} ${back.fs}`);
});

test('split: bad answers from Gemini end as error codes, never a crash', async () => {
  const src = await picture({ W: 800, H: 600 });
  const codeOf = async (extra, opts = {}) => {
    try {
      await words.split(opts.buffer || src, { call: fakeGemini({ scale: 0.5, extra }).call });
      return 'ok';
    } catch (e) {
      assert.ok(e instanceof words.WordsError, String(e));
      return e.code;
    }
  };
  assert.strictEqual(await codeOf({ text: () => textAnswer('not json at all') }), 'badAnswer');
  assert.strictEqual(await codeOf({ text: () => textAnswer({ lines: [{ text: 'x', box_2d: 'nope' }] }) }), 'badAnswer');
  assert.strictEqual(await codeOf({ text: () => ({}) }), 'badAnswer');
  assert.strictEqual(await codeOf({ image: () => ({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }) }), 'noImage');
  assert.strictEqual(await codeOf({ image: async () => imageAnswer(await sharp({ create: { width: 500, height: 1000, channels: 3, background: '#fff' } }).png().toBuffer()) }), 'badEdit');
  assert.strictEqual(await codeOf({ image: () => imageAnswer(Buffer.from('not a picture')) }), 'badEdit');
  // The model gave the picture back with the words still there.
  assert.strictEqual(await codeOf({ image: (req) => imageAnswer(Buffer.from(req.contents[0].parts[1].inlineData.data, 'base64')) }), 'notRemoved');
  // A different picture altogether.
  assert.strictEqual(await codeOf({ image: async () => imageAnswer(await sharp({ create: { width: 2048, height: 1536, channels: 3, background: '#000' } }).png().toBuffer()) }), 'badEdit');
  const fail = (status, message) => () => { const e = new Error(message); e.status = status; throw e; };
  assert.strictEqual(await codeOf({ image: fail(429, 'Resource exhausted') }), 'busy');
  assert.strictEqual(await codeOf({ text: fail(400, 'API key not valid. Please pass a valid API key.') }), 'key');
  assert.strictEqual(await codeOf({ text: fail(500, 'internal') }), 'failed');
  assert.strictEqual(await codeOf({}, { buffer: Buffer.from('not a picture') }), 'badPicture');
  // No key and no stand-in: off.
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(words.split(src), (e) => e.code === 'off');
  } finally {
    if (key !== undefined) process.env.GEMINI_API_KEY = key;
  }
  // The model's list is checked line by line: odd values are clamped or left out.
  const lines = words.readLines('```json\n{"lines":[{"text":"  Hi\\u202e there ","box_2d":[900,10,100,500],"color":"red","font":"Comic Sans","weight":"700","curve":500,"angle":-400},{"text":"","box_2d":[1,2,3,4]},{"text":"مرحبا","box_2d":[1,2,300,400],"font":"Bebas Neue"}]}\n```');
  assert.deepStrictEqual(lines[0], { text: 'Hi there', box: [100, 10, 900, 500], color: null, font: 'Montserrat', weight: 'bold', curve: 100, angle: -90 });
  assert.strictEqual(lines[1].font, 'Cairo', 'an Arabic line never gets an English-only font');
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual(words.readLines('[{"text":"A","box_2d":[0.1,0.2,0.3,0.4]}]')[0].box, [100, 200, 300, 400], 'boxes as fractions');
});

test('detect through the real client: the SDK sends the schema; a missing text model falls back to the next', async () => {
  const seen = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const model = (req.url.match(/models\/([^:]+):generateContent/) || [])[1];
      const j = JSON.parse(body || '{}');
      seen.push({ model, config: j.generationConfig });
      res.setHeader('Content-Type', 'application/json');
      if (model === 'gemini-flash-latest') {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { code: 404, message: 'models/gemini-flash-latest is not found for API version v1beta', status: 'NOT_FOUND' } }));
      }
      res.end(JSON.stringify(textAnswer({ lines: [{ text: 'HAPPY DAY', box_2d: box2d(LINES[0]), color: '#141414', font: 'Anton', weight: 'normal', curve: 0, angle: 3 }] })));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const saved = { key: process.env.GEMINI_API_KEY, base: process.env.GEMINI_API_BASE, model: process.env.GEMINI_TEXT_MODEL };
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${mock.address().port}`;
  delete process.env.GEMINI_TEXT_MODEL;
  const file = require.resolve('../src/words');
  const cached = require.cache[file];
  delete require.cache[file]; // (a fresh module: no text model remembered from the tests above)
  try {
    const fresh = require('../src/words');
    const d = await fresh.detect(await picture({ W: 800, H: 600 }));
    assert.deepStrictEqual(seen.map((s) => s.model), ['gemini-flash-latest', 'gemini-2.5-flash']);
    assert.strictEqual(seen[1].config.responseMimeType, 'application/json');
    assert.ok(seen[1].config.responseSchema && seen[1].config.responseSchema.properties.lines, 'the schema reaches the API');
    assert.deepStrictEqual(d.lines.map((l) => [l.text, l.font, l.angle]), [['HAPPY DAY', 'Anton', 3]]);
    await fresh.detect(await picture({ W: 800, H: 600 }));
    assert.strictEqual(seen[2].model, 'gemini-2.5-flash', 'the model that answered is remembered');
    // GEMINI_TEXT_MODEL picks it.
    process.env.GEMINI_TEXT_MODEL = 'gemini-custom';
    await fresh.detect(await picture({ W: 800, H: 600 }));
    assert.strictEqual(seen[3].model, 'gemini-custom');
  } finally {
    require.cache[file] = cached;
    for (const [k, env] of [['key', 'GEMINI_API_KEY'], ['base', 'GEMINI_API_BASE'], ['model', 'GEMINI_TEXT_MODEL']]) {
      if (saved[k] === undefined) delete process.env[env];
      else process.env[env] = saved[k];
    }
    mock.close();
  }
});

// ---------- The queue and the library ----------
function newLibrary() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-words-'));
  return { dataDir, library: new Library(dataDir) };
}
/** A design published from a zip, as the publish route makes it (its pictures in artDir). */
async function addDesign(library, { id, src, createdAt = new Date().toISOString(), ext = 'png' }) {
  const dir = library.artDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = await sharp(src).metadata();
  fs.writeFileSync(path.join(dir, `print.${ext}`), src);
  fs.writeFileSync(path.join(dir, 'web.png'), await sharp(src).resize(1200, 1200, { fit: 'inside' }).png().toBuffer());
  return library.addUploaded({
    id, kind: 'template', uploaded: true, category: 'funny', name: { en: id, ar: id }, product: 'tshirt', color: 'white', products: ['tshirt'], aspect: 0.75,
    items: [{ kind: 'image', src: `/library-art/${id}/web.png`, printSrc: `/library-art/${id}/print.${ext}`, printPx: [meta.width, meta.height], fit: 0.92, x: 0.5, y: 0.5, w: 0.92 }],
    createdAt, by: 'owner',
  });
}
const pic = (library, id) => library.get(id).items[0];
const quiet = { warn() {}, error() {}, log() {} };
const TEXTS = [{ text: 'Hi', font: 'Cairo', size: 0.1, x: 0.5, y: 0.5, w: 0.4, fill: '#000000' }];
/** A stand-in for split(): answers in turn (an Error to throw, false for no words, else words). */
function fakeSplit(answers) {
  const calls = [];
  const fn = async (buf) => {
    calls.push(buf);
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a instanceof Error) throw a;
    if (a === false) return { words: false };
    return { words: true, png: await sharp(buf).png().toBuffer(), texts: TEXTS, width: (await sharp(buf).metadata()).width, height: (await sharp(buf).metadata()).height };
  };
  return { fn, calls };
}

test('queue: published → working → editable words (files beside the originals); keep the original lettering, use the words again', async () => {
  const { library } = newLibrary();
  const src = await picture({ W: 800, H: 600 });
  await addDesign(library, { id: 'u-aaaaaaaaaaa1', src });
  const g = fakeGemini({ scale: 0.5 });
  const q = words.createQueue({ library, call: g.call, enabled: () => true, every: 0, log: quiet });
  assert.deepStrictEqual(q.enqueue('u-aaaaaaaaaaa1'), { status: 'queued', error: null });
  await q.kick();
  const st = q.state();
  assert.strictEqual(st.designs['u-aaaaaaaaaaa1'].status, 'ready');
  assert.strictEqual(st.usedToday, 1);
  assert.strictEqual(st.dailyMax, 60);
  const item = pic(library, 'u-aaaaaaaaaaa1');
  assert.deepStrictEqual(Object.keys(item.words).sort(), ['printPx', 'printSrc', 'src', 'texts']);
  assert.strictEqual(item.words.src, '/library-art/u-aaaaaaaaaaa1/nowords-web.png');
  assert.strictEqual(item.words.printSrc, '/library-art/u-aaaaaaaaaaa1/nowords-print.png');
  assert.deepStrictEqual(item.words.printPx, [800, 600]);
  assert.strictEqual(item.words.texts.length, 2);
  // (The builder's patterns in public/js/templates.js accept these files.)
  const tpl = fs.readFileSync(path.join(__dirname, '../public/js/templates.js'), 'utf8');
  const rule = tpl.match(/const PRINT_SRC = \/(.+)\/([a-z]*);/);
  assert.match(item.words.printSrc, new RegExp(rule[1], rule[2]));
  const dir = library.artDir('u-aaaaaaaaaaa1');
  const web = await sharp(path.join(dir, 'web.png')).metadata();
  const noWeb = await sharp(path.join(dir, 'nowords-web.png')).metadata();
  assert.deepStrictEqual([noWeb.width, noWeb.height], [web.width, web.height], 'the same size as web.png');
  const noPrint = await sharp(path.join(dir, 'nowords-print.png')).metadata();
  assert.deepStrictEqual([noPrint.width, noPrint.height, noPrint.hasAlpha], [800, 600, true]);
  // The index on disk has it (another copy of the app reads it).
  const index = JSON.parse(fs.readFileSync(path.join(library.dir, 'index.json'), 'utf8'));
  assert.strictEqual(index.custom[0].wordsStatus, 'ready');
  assert.ok(index.custom[0].wordsAt);

  // Keep the original lettering: the picture as uploaded; then back to the words with no new AI call.
  const calls = g.calls.length;
  assert.strictEqual(q.act('u-aaaaaaaaaaa1', 'keep').status, 'kept');
  assert.strictEqual(pic(library, 'u-aaaaaaaaaaa1').words, undefined);
  assert.ok(fs.existsSync(path.join(dir, 'nowords-web.png')), 'the files stay');
  assert.strictEqual(q.act('u-aaaaaaaaaaa1', 'use').status, 'ready');
  await q.kick();
  assert.strictEqual(g.calls.length, calls, 'no new AI call');
  assert.deepStrictEqual(pic(library, 'u-aaaaaaaaaaa1').words, item.words);
  // Retry on ready changes nothing; a design not uploaded (a starter one) is no one's.
  assert.strictEqual(q.act('u-aaaaaaaaaaa1', 'retry').status, 'ready');
  assert.strictEqual(q.act('mesh-fady', 'retry'), null);
});

test('queue: no words → none; a JPG original gets a JPG copy; without the key everything is off', async () => {
  const { library } = newLibrary();
  await addDesign(library, { id: 'u-bbbbbbbbbbb1', src: await picture({ W: 800, H: 600, lines: [] }) });
  await addDesign(library, { id: 'u-bbbbbbbbbbb2', src: await picture({ W: 800, H: 600, opaque: true, badge: false }), ext: 'jpg' });
  let on = false;
  let current = null;
  const g = fakeGemini({ scale: 0.5 });
  // (The first picture has no words: an empty list for it.)
  const call = (req) => (isText(req) && current === 'u-bbbbbbbbbbb1' ? textAnswer({ lines: [] }) : g.call(req));
  const q = words.createQueue({
    library, enabled: () => on, every: 0, log: quiet, call,
    split: (buf, o) => words.split(buf, o),
  });
  // (Which design is being split, for the stand-in.)
  const work = q.work.bind(q);
  q.work = (d) => { current = d.id; return work(d); };
  assert.deepStrictEqual(q.enqueue('u-bbbbbbbbbbb1'), { status: 'off', error: null });
  assert.strictEqual(q.state().designs['u-bbbbbbbbbbb2'].status, 'off', 'not looked at, no key: off');
  assert.deepStrictEqual(q.act('u-bbbbbbbbbbb1', 'retry'), { refused: 'wordsOff' });
  await q.kick();
  assert.strictEqual(g.calls.length, 0, 'nothing sent without the key');
  on = true;
  await q.kick();
  const st = q.state().designs;
  assert.strictEqual(st['u-bbbbbbbbbbb1'].status, 'none');
  assert.strictEqual(st['u-bbbbbbbbbbb2'].status, 'ready');
  assert.strictEqual(pic(library, 'u-bbbbbbbbbbb1').words, undefined);
  assert.strictEqual(pic(library, 'u-bbbbbbbbbbb2').words.printSrc, '/library-art/u-bbbbbbbbbbb2/nowords-print.jpg');
  const jpg = await sharp(path.join(library.artDir('u-bbbbbbbbbbb2'), 'nowords-print.jpg')).metadata();
  assert.deepStrictEqual([jpg.format, jpg.width, jpg.height], ['jpeg', 800, 600]);
  // "No words found" can be tried again.
  assert.strictEqual(q.act('u-bbbbbbbbbbb1', 'retry').status, 'queued');
});

test('queue: one picture at a time, the daily cap (every copy together), tried again twice, then failed', async () => {
  const { library } = newLibrary();
  const src = await picture({ W: 700, H: 600, lines: [] });
  for (let i = 1; i <= 3; i++) await addDesign(library, { id: `u-ccccccccccc${i}`, src, createdAt: `2026-11-0${i}T10:00:00Z` });
  let now = Date.parse('2026-11-25T10:00:00Z');
  const s = fakeSplit([false]);
  let running = 0;
  let most = 0;
  const split = async (...a) => {
    running++;
    most = Math.max(most, running);
    try { return await s.fn(...a); } finally { running--; }
  };
  const q = words.createQueue({ library, split, enabled: () => true, every: 0, log: quiet, dailyMax: 2, now: () => now });
  // Designs from before (no status yet) wait their turn, newest first.
  assert.strictEqual(q.state().designs['u-ccccccccccc1'].status, 'queued');
  await Promise.all([q.kick(), q.kick()]);
  assert.strictEqual(most, 1, 'one picture at a time');
  let st = q.state();
  assert.strictEqual(st.usedToday, 2);
  assert.deepStrictEqual(['u-ccccccccccc1', 'u-ccccccccccc2', 'u-ccccccccccc3'].map((id) => st.designs[id].status), ['queued', 'none', 'none']);
  // Another copy of the app (same DATA_DIR) has no more pictures today either.
  const other = words.createQueue({ library: new Library(path.dirname(library.dir)), split, enabled: () => true, every: 0, log: quiet, dailyMax: 2, now: () => now });
  await other.kick();
  assert.strictEqual(s.calls.length, 2);
  // The next day (Cairo time) it carries on.
  now = Date.parse('2026-11-25T22:30:00Z');
  await q.kick();
  st = q.state();
  assert.strictEqual(st.designs['u-ccccccccccc1'].status, 'none');
  assert.strictEqual(st.usedToday, 1);

  // A failure is tried again twice (after a wait), then it fails; a picture that can't be read fails at once.
  const { library: lib2 } = newLibrary();
  await addDesign(lib2, { id: 'u-ddddddddddd1', src });
  await addDesign(lib2, { id: 'u-ddddddddddd2', src });
  const busy = fakeSplit([new words.WordsError('busy')]);
  const q2 = words.createQueue({ library: lib2, split: busy.fn, enabled: () => true, every: 0, log: quiet, now: () => now, retryMs: 60e3 });
  q2.enqueue('u-ddddddddddd1');
  await q2.kick();
  assert.strictEqual(busy.calls.length, 2, 'both designs tried once; the next try waits');
  assert.deepStrictEqual(lib2.wordsState().designs['u-ddddddddddd1'], { status: 'queued', error: 'busy', at: lib2.wordsState().designs['u-ddddddddddd1'].at });
  for (let i = 0; i < 4; i++) {
    now += 5 * 60e3;
    await q2.kick();
  }
  assert.strictEqual(busy.calls.length, 6, 'three tries each');
  assert.deepStrictEqual(Object.values(q2.state().designs).map((x) => [x.status, x.error]), [['failed', 'busy'], ['failed', 'busy']]);
  // Try again (the admin): three more tries for that one, and it works this time.
  const ok = fakeSplit([new words.WordsError('timeout'), {}]);
  q2.split = ok.fn;
  assert.strictEqual(q2.act('u-ddddddddddd1', 'retry').status, 'queued');
  await q2.kick();
  now += 5 * 60e3;
  await q2.kick();
  assert.strictEqual(q2.state().designs['u-ddddddddddd1'].status, 'ready');
  const bad = fakeSplit([new words.WordsError('badPicture')]);
  q2.split = bad.fn;
  q2.act('u-ddddddddddd2', 'retry');
  await q2.kick();
  assert.strictEqual(bad.calls.length, 1);
  assert.deepStrictEqual([q2.state().designs['u-ddddddddddd2'].status, q2.state().designs['u-ddddddddddd2'].error], ['failed', 'badPicture']);
  // Anything else going wrong (a bug, odd output) fails the design, never the queue.
  q2.split = async () => { throw new TypeError('x is undefined'); };
  q2.retryMs = 0;
  q2.act('u-ddddddddddd2', 'retry');
  for (let i = 0; i < 3; i++) await q2.kick();
  assert.deepStrictEqual([q2.state().designs['u-ddddddddddd2'].status, q2.state().designs['u-ddddddddddd2'].error], ['failed', 'failed']);
  q2.split = async () => ({ words: true, png: Buffer.from('nonsense'), texts: [], width: 1, height: 1 });
  q2.act('u-ddddddddddd2', 'retry');
  for (let i = 0; i < 3; i++) await q2.kick();
  assert.strictEqual(q2.state().designs['u-ddddddddddd2'].status, 'failed');
});

test('queue: a restart carries on: queued and half-done designs, and designs already on the site', async () => {
  const { dataDir, library } = newLibrary();
  const src = await picture({ W: 700, H: 600, lines: [] });
  await addDesign(library, { id: 'u-eeeeeeeeeee1', src, createdAt: '2026-11-01T10:00:00Z' });
  await addDesign(library, { id: 'u-eeeeeeeeeee2', src, createdAt: '2026-11-02T10:00:00Z' });
  await addDesign(library, { id: 'u-eeeeeeeeeee3', src, createdAt: '2026-11-03T10:00:00Z' });
  await addDesign(library, { id: 'u-eeeeeeeeeee4', src, createdAt: '2026-11-04T10:00:00Z' });
  // Before the restart: one queued, one being worked on by this copy (stopped since), one taken by another copy
  // just now (left alone), one never looked at.
  const first = words.createQueue({ library, split: fakeSplit([false]).fn, enabled: () => true, every: 0, log: quiet });
  library.withLock(() => {
    const at = new Date().toISOString();
    Object.assign(library.index.custom[0], { wordsStatus: 'queued', wordsAt: at });
    Object.assign(library.index.custom[1], { wordsStatus: 'working', wordsBy: first.token, wordsAt: at, wordsTries: 1 });
    Object.assign(library.index.custom[2], { wordsStatus: 'working', wordsBy: 'elsewhere:1:abcd', wordsAt: at, wordsTries: 1 });
    library.save();
  });
  // The restart: a new queue (this process, another token) with every: on, as the app starts it.
  const s = fakeSplit([false]);
  const lib = new Library(dataDir);
  const q = words.createQueue({ library: lib, split: s.fn, enabled: () => true, every: 60e3, log: quiet });
  q.start();
  try {
    for (let i = 0; i < 50 && s.calls.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
    await q.kick();
  } finally {
    q.stop();
  }
  const st = q.state().designs;
  assert.deepStrictEqual(['u-eeeeeeeeeee1', 'u-eeeeeeeeeee2', 'u-eeeeeeeeeee3', 'u-eeeeeeeeeee4'].map((id) => st[id].status), ['none', 'none', 'working', 'none']);
  assert.strictEqual(s.calls.length, 3);
  // The other copy's design once it has been "working" far too long: taken over; after three tries: failed.
  lib.withLock(() => {
    Object.assign(lib.index.custom[2], { wordsAt: new Date(Date.now() - 3600e3).toISOString(), wordsTries: 3 });
    lib.save();
  });
  await q.kick();
  assert.deepStrictEqual([q.state().designs['u-eeeeeeeeeee3'].status, q.state().designs['u-eeeeeeeeeee3'].error], ['failed', 'stopped']);
  // Kept while being worked on: what comes back is put aside, and "use" puts it in place.
  const { library: lib3 } = newLibrary();
  await addDesign(lib3, { id: 'u-fffffffffff1', src });
  let release;
  const slow = async (buf) => { await new Promise((r) => { release = r; }); return { words: true, png: await sharp(buf).png().toBuffer(), texts: TEXTS, width: 700, height: 600 }; };
  const q3 = words.createQueue({ library: lib3, split: slow, enabled: () => true, every: 0, log: quiet });
  q3.enqueue('u-fffffffffff1');
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(q3.state().designs['u-fffffffffff1'].status, 'working');
  assert.deepStrictEqual(q3.act('u-fffffffffff1', 'retry'), { refused: 'wordsWorking' });
  assert.strictEqual(q3.act('u-fffffffffff1', 'keep').status, 'kept');
  release();
  await q3.kick();
  assert.strictEqual(q3.state().designs['u-fffffffffff1'].status, 'kept');
  assert.strictEqual(pic(lib3, 'u-fffffffffff1').words, undefined);
  assert.strictEqual(q3.act('u-fffffffffff1', 'use').status, 'ready');
  assert.deepStrictEqual(pic(lib3, 'u-fffffffffff1').words.texts, TEXTS);
});

test('admin routes: the words of every uploaded design, retry / keep / use, refusals in both languages', async () => {
  const { library } = newLibrary();
  await addDesign(library, { id: 'u-ggggggggggg1', src: await picture({ W: 700, H: 600, lines: [] }) });
  class HttpError extends Error {
    constructor(status, key) { super(key); this.status = status; this.key = key; }
  }
  let on = false;
  const s = fakeSplit([{}]);
  const queue = words.createQueue({ library, split: s.fn, enabled: () => on, every: 0, log: quiet });
  const app = express();
  let guarded = 0;
  const w = mount(app, { library, guard: (req, res, next) => { guarded++; next(); }, HttpError, queue, start: false });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ code: err.key, error: format(err.key || 'serverError', {}, req.get('accept-language') === 'ar' ? 'ar' : 'en') }));
  const server = await new Promise((r) => { const sv = app.listen(0, () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (id, body, lang = 'en') => fetch(`${base}/api/admin/library/${id}/words`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': lang }, body: JSON.stringify(body) });
  try {
    let r = await (await fetch(`${base}/api/admin/library/words`)).json();
    assert.deepStrictEqual(r, { enabled: false, dailyMax: 60, usedToday: 0, designs: { 'u-ggggggggggg1': { status: 'off', error: null, at: null } } });
    let res = await post('u-ggggggggggg1', { action: 'retry' }, 'ar');
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(await res.json(), { code: 'wordsOff', error: MESSAGES.wordsOff.ar });
    assert.strictEqual((await post('u-ggggggggggg1', { action: 'delete' })).status, 400);
    assert.strictEqual((await post('u-ggggggggggg1', {})).status, 400);
    res = await post('u-nothere0001', { action: 'keep' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).code, 'wordsNotUploaded');
    on = true;
    res = await post('u-ggggggggggg1', { action: 'retry' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).id, 'u-ggggggggggg1');
    await queue.kick();
    r = await (await fetch(`${base}/api/admin/library/words`)).json();
    assert.strictEqual(r.designs['u-ggggggggggg1'].status, 'ready');
    assert.strictEqual(r.usedToday, 1);
    res = await post('u-ggggggggggg1', { action: 'keep' });
    assert.deepStrictEqual(await res.json(), { id: 'u-ggggggggggg1', status: 'kept', error: null, at: library.wordsState().designs['u-ggggggggggg1'].at });
    assert.strictEqual((await (await post('u-ggggggggggg1', { action: 'use' })).json()).status, 'ready');
    assert.ok(guarded >= 8, 'every route behind the guard');
    // enqueue (the publish route's call) for a new design.
    await addDesign(library, { id: 'u-ggggggggggg2', src: await picture({ W: 700, H: 600, lines: [] }) });
    assert.strictEqual(w.enqueue('u-ggggggggggg2').status, 'queued');
    await queue.kick();
    assert.strictEqual(queue.state().designs['u-ggggggggggg2'].status, 'ready');
  } finally {
    server.close();
  }
  // The routes' permissions: seeing the words with the library, changing them as for uploads.
  assert.strictEqual(roles.routeOf('GET', '/api/admin/library/words').perm, 'library.view');
  assert.strictEqual(roles.routeOf('POST', '/api/admin/library/:id/words').perm, 'uploads');
  assert.ok(roles.ROLE_PERMS.catalogue.includes('uploads'));
});

test('the words\' texts: both languages, Egyptian Arabic, the same placeholders, never "محل"', () => {
  const FORMAL = /هل تريد|سيتم|تعذّر|تعذر|يمكنك|لم يتم|لم نتمكن|لا يمكن|يجب أن|ليس |لا يوجد|لا توجد|حدث خطأ|الآن|حاليًا|جاري |غدًا/;
  for (const k of ['wordsOff', 'wordsWorking', 'wordsNotUploaded']) {
    assert.ok(MESSAGES[k] && MESSAGES[k].en && MESSAGES[k].ar, k);
    assert.doesNotMatch(MESSAGES[k].ar, /محل/, k);
    assert.doesNotMatch(MESSAGES[k].ar, FORMAL, k);
  }
  const window = { POD_STRINGS: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/i18n-admin-uploads.js'), 'utf8'), { window });
  const keys = Object.keys(window.POD_STRINGS).filter((k) => k.startsWith('rd.words.'));
  assert.ok(keys.length >= 15);
  for (const k of keys) {
    const [en, ar] = window.POD_STRINGS[k];
    assert.ok(en && ar, k);
    assert.doesNotMatch(ar, /محل/, k);
    assert.doesNotMatch(ar, FORMAL, k);
    assert.deepStrictEqual((en.match(/\{\w+\}/g) || []).sort(), (ar.match(/\{\w+\}/g) || []).sort(), `${k}: same placeholders`);
  }
  // Every status has its line in the admin, and the line's keys exist.
  const admin = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
  for (const st of ['ready', 'queued', 'working', 'none', 'failed', 'kept', 'off']) assert.match(admin, new RegExp(`\\n\\s+${st}: \\[`), st);
  for (const k of admin.match(/'rd\.words\.[\w.]+'/g)) assert.ok(window.POD_STRINGS[k.slice(1, -1)] || /why\.$/.test(k.slice(1, -1)), k);
  // The fonts offered to the model are the editor's.
  const tpl = fs.readFileSync(path.join(__dirname, '../public/js/templates.js'), 'utf8');
  const win = {};
  vm.runInNewContext(tpl, { window: win, document: { fonts: {} }, fabric: {} });
  assert.deepStrictEqual(words.FONTS, JSON.parse(JSON.stringify({ arabic: win.POD_DESIGN.FONTS.arabic, english: win.POD_DESIGN.FONTS.english })));
});
