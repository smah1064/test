'use strict';

/**
 * Editable words in the designs uploaded by the owner or a product manager (Admin → Ready designs → Upload
 * designs (zip)). The words drawn in such a picture become ordinary text in the editor and the drawing its own
 * layer (see public/js/templates.js, wordsArt): customers change "Happy birthday Sara" by typing.
 *
 *  - detect(buffer): Google Gemini (a text model) lists the lines of words in the picture: what they say, where,
 *    their colour, the closest of the editor's fonts, weight, curve and angle. Words that are part of a logo or a
 *    detail of the drawing are left out.
 *  - split(buffer): the picture without those words (Gemini's image model removes them; only the words' places are
 *    taken from its answer, every other pixel stays the original's) at the original size, and the words as text
 *    lines measured where they were drawn.
 *  - createQueue(): one picture at a time in the background, at most WORDS_DAILY_MAX (60) a day for the whole
 *    shop, a failed try retried twice; the state is kept with each design in the library (src/library.js).
 *
 * Only the shop's own uploads: never customers' pictures (too costly). Off without GEMINI_API_KEY. Uses the same
 * key, client and Vertex AI switch as the books' illustrations (src/cartoon.js); GEMINI_TEXT_MODEL picks the text
 * model (else gemini-flash-latest, then gemini-2.5-flash), GEMINI_IMAGE_MODEL the image model.
 *
 * Pictures and the model's answers are untrusted: pictures are decoded by sharp with a pixel and a time limit, at
 * most 2048 px go to Gemini, every call has a time limit, and anything malformed ends as a WordsError code, never
 * a crash.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cartoon = require('./cartoon');

let sharpModule = null;
// Loaded on first use (as in src/app.js), so the server starts fast.
const sharp = () => (sharpModule ||= require('sharp'));

const MAX_PIXELS = 100e6; // as uploads (src/design-upload.js): 10,000 × 10,000 px
const DECODE = { limitInputPixels: MAX_PIXELS, failOn: 'truncated' };
const EDIT_DECODE = { limitInputPixels: 40e6, failOn: 'truncated' }; // the model's answer
const TIMEOUT = { seconds: 90 }; // no picture may keep sharp busy longer
const SEND_PX = 2048; // the long side of what Gemini sees (and of the working copy the words are found on)
const TEXT_TIMEOUT = 90e3;
const IMAGE_TIMEOUT = 180e3;
const TEXT_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
// The image model's shapes (the picture is sent with white margins to the closest one, then they're cut off).
const RATIOS = [[1, 1], [2, 3], [3, 2], [3, 4], [4, 3], [4, 5], [5, 4], [9, 16], [16, 9], [21, 9]];
const HEX = /^#[0-9a-f]{6}$/i;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
// Control characters and bidi overrides: never in a design's text.
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

const enabled = () => Boolean(process.env.GEMINI_API_KEY);

/** Why making the words editable didn't work: `code` is one of CODES. */
class WordsError extends Error {
  constructor(code, message, status) {
    super(message || `words: ${code}`);
    this.name = 'WordsError';
    this.code = code;
    if (status) this.status = status; // the API's HTTP status, when it gave one
  }
}
// off: no key; key: the key was refused; busy: rate limit / overloaded; timeout; model: no text model answers;
// badPicture / tooBig: the picture can't be read; badAnswer: the list of words couldn't be read; noImage: the image
// model sent no picture (or refused); badEdit: its picture isn't the same picture; notRemoved: the words are still
// there; failed: anything else.
const RETRY = new Set(['busy', 'timeout', 'failed', 'badAnswer', 'noImage', 'badEdit', 'notRemoved']);

// ---------- The editor's fonts (public/js/templates.js FONTS, read at start: fonts added there count) ----------
function readFonts(file = path.join(__dirname, '..', 'public', 'js', 'templates.js')) {
  try {
    const src = fs.readFileSync(file, 'utf8');
    const block = (src.match(/const FONTS = \{([\s\S]*?)\n\s*\};/) || [])[1] || '';
    const lists = {};
    for (const [, key, body] of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) lists[key] = [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    if (lists.arabic && lists.arabic.length && lists.english && lists.english.length) return lists;
  } catch (e) { /* the defaults below */ }
  return { arabic: ['Cairo'], english: ['Montserrat'] };
}
const FONTS = readFonts();
const FONT_LIST = [...new Set([...FONTS.arabic, ...FONTS.english])];
/** The font for a line: the one named when it's the editor's (and can write the line's letters), else the plain one. */
function pickFont(name, text) {
  const arabic = ARABIC.test(text);
  const found = FONT_LIST.find((f) => f.toLowerCase() === String(name || '').trim().toLowerCase());
  if (found && (!arabic || FONTS.arabic.includes(found))) return found;
  return arabic ? FONTS.arabic[0] : FONTS.english[0];
}

// ---------- Gemini ----------
const IMAGE_MODEL = () => cartoon.MODEL();
let textModel = null; // the default text model that answered (GEMINI_TEXT_MODEL unset)
const textModels = () => (process.env.GEMINI_TEXT_MODEL ? [process.env.GEMINI_TEXT_MODEL] : textModel ? [textModel] : TEXT_MODELS);

/** The shop's Gemini call (src/cartoon.js: the key on the Gemini API or Vertex AI). Tests pass their own `call`. */
function defaultCall(request) {
  if (!enabled()) throw new WordsError('off', 'GEMINI_API_KEY is not set');
  return cartoon.callGemini(request);
}
const modelMissing = (e) => (e && (e.status || e.code)) === 404 || /not[ _]?found|is not supported|unknown model|does not exist/i.test(String((e && e.message) || ''));
/** An error from a call as a WordsError. */
function failure(e) {
  if (e instanceof WordsError) return e;
  const status = e && (e.status || e.code);
  const http = Number.isInteger(status) ? status : undefined;
  const msg = String((e && e.message) || e || '');
  if (status === 429 || status === 503 || /RESOURCE_EXHAUSTED|overloaded|UNAVAILABLE/i.test(msg)) return new WordsError('busy', msg, http);
  if (cartoon.keyRejected(e || {})) return new WordsError('key', msg, http);
  if ((e && e.name === 'AbortError') || /timed? ?out|aborted|ETIMEDOUT/i.test(msg)) return new WordsError('timeout', msg, http);
  return new WordsError('failed', msg, http);
}
/** A call, given up after `ms` (the SDK has its own time limit; this one also holds for any `call`). */
async function timed(call, request, ms) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => call(request)),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new WordsError('timeout')), ms); }),
    ]);
  } catch (e) {
    throw failure(e);
  } finally {
    clearTimeout(timer);
  }
}
/** The text of an answer (its thoughts left out). */
function answerText(res) {
  const cand = res && Array.isArray(res.candidates) ? res.candidates[0] : null;
  const parts = (cand && cand.content && Array.isArray(cand.content.parts) && cand.content.parts) || [];
  const text = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  if (text) return text;
  try {
    return res && typeof res.text === 'string' ? res.text : '';
  } catch (e) {
    return '';
  }
}

// ---------- The picture ----------
/**
 * The picture opened: its size (W × H, the right way up), whether it has an alpha channel and any see-through
 * part, and a working copy at most 2048 px on its long side (w0 × h0): RGBA, and RGB on white.
 */
async function openPicture(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new WordsError('badPicture');
  let meta;
  try {
    meta = await sharp()(buffer, DECODE).metadata();
  } catch (e) {
    throw new WordsError('badPicture', e.message);
  }
  if (!(meta.width > 0) || !(meta.height > 0) || !['png', 'jpeg', 'webp'].includes(meta.format)) throw new WordsError('badPicture');
  if (meta.width * meta.height > MAX_PIXELS) throw new WordsError('tooBig');
  const turned = (meta.orientation || 1) >= 5;
  const W = turned ? meta.height : meta.width;
  const H = turned ? meta.width : meta.height;
  const k = Math.min(1, SEND_PX / Math.max(W, H));
  const w0 = Math.max(1, Math.round(W * k));
  const h0 = Math.max(1, Math.round(H * k));
  const open = () => sharp()(buffer, DECODE).autoOrient();
  let rgba;
  try {
    const img = open();
    const { data, info } = await (k < 1 ? img.resize(w0, h0, { fit: 'fill' }) : img).toColourspace('srgb').ensureAlpha()
      .raw({ depth: 'uchar' }).timeout(TIMEOUT).toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || info.width !== w0 || info.height !== h0) throw new Error('unexpected pixels');
    rgba = data;
  } catch (e) {
    throw new WordsError('badPicture', e.message);
  }
  const n = w0 * h0;
  const white = Buffer.alloc(n * 3);
  let minAlpha = 255;
  for (let i = 0, j = 0, q = 0; i < n; i++, j += 4, q += 3) {
    const a = rgba[j + 3];
    if (a < minAlpha) minAlpha = a;
    for (let c = 0; c < 3; c++) white[q + c] = Math.round((rgba[j + c] * a + 255 * (255 - a)) / 255);
  }
  const hasAlpha = Boolean(meta.hasAlpha);
  return { W, H, w0, h0, rgba, white, hasAlpha, seeThrough: hasAlpha && minAlpha < 255, open };
}
const jpegOf = (rgb, width, height, extend) => {
  let img = sharp()(rgb, { raw: { width, height, channels: 3 } });
  if (extend) img = img.extend({ ...extend, background: '#ffffff' });
  return img.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).timeout(TIMEOUT).toBuffer();
};

// ---------- Finding the words ----------
const detectPrompt = () => [
  'This picture is a design that a shop prints on products (T-shirts, mugs, posters...). Find the words drawn in it, so the shop can turn them into text its customers can edit.',
  'List each line of words or letters separately (Arabic, English, numbers or any other writing); words drawn on two rows are two lines. For each line give:',
  '- text: exactly as drawn: the same spelling, letters, numbers, diacritics and punctuation, in normal reading order (never translate or correct it);',
  '- box_2d: [ymin, xmin, ymax, xmax] round all the line\'s letters (with their outline or shadow), each from 0 to 1000 of the picture\'s height and width;',
  '- color: the main colour of the letters, as #rrggbb;',
  `- font: the font from this list that looks closest: for Arabic letters one of ${FONTS.arabic.join(', ')}; for other letters one of ${FONT_LIST.join(', ')};`,
  '- weight: "bold" for thick letters, else "normal";',
  '- curve: 0 for a straight line; for words drawn along an arc, 1 to 100 when the middle of the line is higher than its ends (like a rainbow) and -1 to -100 when it is lower (like a smile), 100 being a half circle;',
  '- angle: the degrees the whole line is turned, clockwise positive, 0 when it is level.',
  'Leave out writing the shop should not change: words that are part of a logo, a brand or a signature, writing that is a detail of the drawing itself (a label on a jar, a sign in a street, a number on a shirt someone in the picture wears), and tiny or unreadable writing.',
  'If there are no words to list, give an empty list.',
].join('\n');
const SCHEMA = () => ({
  type: 'OBJECT',
  properties: {
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
          color: { type: 'STRING' },
          font: { type: 'STRING', format: 'enum', enum: FONT_LIST },
          weight: { type: 'STRING', format: 'enum', enum: ['normal', 'bold'] },
          curve: { type: 'INTEGER' },
          angle: { type: 'NUMBER' },
        },
        required: ['text', 'box_2d', 'color', 'font', 'weight', 'curve', 'angle'],
        propertyOrdering: ['text', 'box_2d', 'color', 'font', 'weight', 'curve', 'angle'],
      },
    },
  },
  required: ['lines'],
});
const clampNum = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : 0);
/** The model's list of lines, checked: [{ text, box: [ymin, xmin, ymax, xmax] (0..1000), color, font, weight, curve, angle }]. */
function readLines(answer) {
  let j;
  try {
    const s = String(answer || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    j = JSON.parse(s);
  } catch (e) {
    throw new WordsError('badAnswer', 'not JSON');
  }
  const list = Array.isArray(j) ? j : j && typeof j === 'object' && Array.isArray(j.lines) ? j.lines : null;
  if (!list) throw new WordsError('badAnswer', 'no list');
  const out = [];
  const boxOf = (l) => (Array.isArray(l && l.box_2d) && l.box_2d.length === 4 && l.box_2d.every((v) => Number.isFinite(Number(v))) ? l.box_2d.map(Number) : null);
  // (Boxes given as fractions, 0..1, instead of 0..1000: every one of them.)
  const boxes = list.slice(0, 40).map(boxOf).filter(Boolean);
  const unit = boxes.length && boxes.every((b) => b.every((v) => v >= 0 && v <= 1)) ? 1000 : 1;
  for (const l of list.slice(0, 40)) {
    if (!l || typeof l !== 'object' || typeof l.text !== 'string') continue;
    const text = l.text.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) continue;
    const b = boxOf(l);
    if (!b) continue;
    const [y0, x0, y1, x1] = b.map((v) => Math.max(0, Math.min(1000, v * unit)));
    const box = [Math.min(y0, y1), Math.min(x0, x1), Math.max(y0, y1), Math.max(x0, x1)];
    if (box[2] - box[0] < 2 || box[3] - box[1] < 2) continue;
    out.push({
      text,
      box,
      color: typeof l.color === 'string' && HEX.test(l.color.trim()) ? l.color.trim().toLowerCase() : null,
      font: pickFont(l.font, text),
      weight: /bold|black|heavy|[6-9]00/i.test(String(l.weight || '')) ? 'bold' : 'normal',
      curve: Math.round(clampNum(l.curve, -100, 100)),
      angle: Math.round(clampNum(l.angle, -90, 90) * 10) / 10,
    });
  }
  if (list.length && !out.length) throw new WordsError('badAnswer', 'no usable line');
  return out;
}

/** Ask the text model (the next default one when a model isn't there). */
async function askText(makeRequest, call) {
  const models = textModels();
  let last = null;
  for (const model of models) {
    try {
      const res = await timed(call, makeRequest(model), TEXT_TIMEOUT + 15e3);
      if (!process.env.GEMINI_TEXT_MODEL) textModel = model;
      return res;
    } catch (e) {
      if (!modelMissing(e) || (e instanceof WordsError && e.code !== 'failed')) throw failure(e);
      last = e;
      if (textModel === model) textModel = null;
    }
  }
  throw new WordsError('model', `no text model answered (${models.join(', ')}): ${last && last.message}`);
}

/**
 * The lines of words drawn in a picture (Gemini): { lines: [{ text, box, color, font, weight, curve, angle }],
 * width, height } with box [ymin, xmin, ymax, xmax] in 0..1000 of the picture. `opts.call` replaces the Gemini
 * call (tests); `opts.picture` is the picture opened already.
 */
async function detect(buffer, opts = {}) {
  const pic = opts.picture || (await openPicture(buffer));
  const call = opts.call || defaultCall;
  const image = await jpegOf(pic.white, pic.w0, pic.h0);
  const res = await askText((model) => ({
    model,
    contents: [{ role: 'user', parts: [{ text: detectPrompt() }, { inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } }] }],
    config: { responseMimeType: 'application/json', responseSchema: SCHEMA(), httpOptions: { timeout: TEXT_TIMEOUT } },
  }), call);
  return { lines: readLines(answerText(res)), width: pic.W, height: pic.H };
}

// ---------- Taking them out ----------
/** The picture without the words, from the image model, at the working size (RGB, w0 × h0). */
async function removeWords(pic, lines, call) {
  const { w0, h0 } = pic;
  const r = w0 / h0;
  const [rw, rh] = RATIOS.reduce((best, x) => (Math.abs(Math.log(x[0] / x[1] / r)) < Math.abs(Math.log(best[0] / best[1] / r)) ? x : best));
  // White margins to the model's shape (cut off again below), so nothing is stretched.
  const pw = r > rw / rh ? w0 : Math.round((h0 * rw) / rh);
  const ph = r > rw / rh ? Math.round((w0 * rh) / rw) : h0;
  const left = Math.floor((pw - w0) / 2);
  const top = Math.floor((ph - h0) / 2);
  const sent = await jpegOf(pic.white, w0, h0, { left, top, right: pw - w0 - left, bottom: ph - h0 - top });
  const named = lines.map((l) => `«${l.text}»`).join(', ');
  const prompt = [
    `Remove all the words and letters of these lines of text from this picture: ${named}.`,
    'Keep everything else exactly the same: the same drawing, colours, style, sizes and positions, the same framing and size of the picture.',
    'Where the words were, continue the background and the drawing naturally, as if the words had never been there. Do not add anything. Keep the plain white margins white.',
  ].join(' ');
  const res = await timed(call, {
    model: IMAGE_MODEL(),
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: sent.toString('base64') } }] }],
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: `${rw}:${rh}`, imageSize: '2K' }, httpOptions: { timeout: IMAGE_TIMEOUT } },
  }, IMAGE_TIMEOUT + 15e3);
  const cand = res && Array.isArray(res.candidates) ? res.candidates[0] : null;
  const part = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts.find((p) => p && p.inlineData && typeof p.inlineData.data === 'string') : null;
  if (!part) throw new WordsError('noImage', String((cand && cand.finishReason) || (res && res.promptFeedback && res.promptFeedback.blockReason) || 'NO_IMAGE'));
  const bytes = Buffer.from(part.inlineData.data, 'base64');
  try {
    const meta = await sharp()(bytes, EDIT_DECODE).metadata();
    const turned = (meta.orientation || 1) >= 5;
    const mw = turned ? meta.height : meta.width;
    const mh = turned ? meta.width : meta.height;
    // The same shape, or it isn't the same picture.
    if (!(mw > 0) || !(mh > 0) || Math.abs(Math.log(mw / mh / (pw / ph))) > 0.03) throw new WordsError('badEdit', `answer ${mw}×${mh} for ${pw}×${ph}`);
    const { data, info } = await sharp()(bytes, EDIT_DECODE).autoOrient().flatten({ background: '#ffffff' }).resize(pw, ph, { fit: 'fill' })
      .extract({ left, top, width: w0, height: h0 }).toColourspace('srgb').removeAlpha().raw({ depth: 'uchar' }).timeout(TIMEOUT).toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 || info.width !== w0 || info.height !== h0) throw new WordsError('badEdit', 'unexpected pixels');
    return data;
  } catch (e) {
    throw e instanceof WordsError ? e : new WordsError('badEdit', e.message);
  }
}

const DIFF = 40; // a pixel changed by the edit (0..255 on its most changed channel)
const INK = 0.8; // letters' height (ascenders to descenders) as a share of the font size
const LINE = 1.13; // the editor's line box height as a share of the font size (fabric)

/** Pixels set in `src` (0/1, w × h) grown by r in every direction (a square). */
function dilate(src, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let n = 0;
    for (let x = 0; x < Math.min(w, r); x++) n += src[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) n += src[row + x + r];
      if (x - r - 1 >= 0) n -= src[row + x - r - 1];
      tmp[row + x] = n > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < Math.min(h, r); y++) n += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) n += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) n -= tmp[(y - r - 1) * w + x];
      out[y * w + x] = n > 0 ? 1 : 0;
    }
  }
  return out;
}
const quantile = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(q * (arr.length - 1))))];

/**
 * A line drawn along an arc (the editor's curved text, public/js/fabric-ext.js): its straight length and font size
 * from the box its letters fill (both in px), for `curve` -100..100.
 */
function straightOfArc(boxW, boxH, curve) {
  const c = Math.min(100, Math.abs(curve)) / 100;
  const box = (len, fs) => {
    const theta = Math.max(0.01, c * Math.min(Math.PI, len / (0.75 * LINE * fs)));
    const R = len / theta;
    const half = theta / 2;
    const outer = R + (INK * fs) / 2;
    const inner = R - (INK * fs) / 2;
    return [2 * outer * Math.sin(Math.min(half, Math.PI / 2)), outer - inner * Math.cos(half)];
  };
  const lenFor = (fs) => {
    let lo = boxW * 0.3;
    let hi = boxW * 4;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (box(mid, fs)[0] < boxW) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  let lo = boxH * 0.02;
  let hi = boxH * 2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (box(lenFor(mid), mid)[1] < boxH) lo = mid;
    else hi = mid;
  }
  const fs = (lo + hi) / 2;
  return { len: lenFor(fs), fs };
}

/** The main colour of some pixels of the working copy (RGBA), as #rrggbb, or null. */
function mainColour(rgba, idx) {
  const bins = new Map();
  for (const i of idx) {
    const j = i * 4;
    if (rgba[j + 3] < 200) continue;
    const k = ((rgba[j] >> 4) << 8) | ((rgba[j + 1] >> 4) << 4) | (rgba[j + 2] >> 4);
    const b = bins.get(k) || [0, 0, 0, 0];
    b[0]++;
    b[1] += rgba[j];
    b[2] += rgba[j + 1];
    b[3] += rgba[j + 2];
    bins.set(k, b);
  }
  let best = null;
  for (const b of bins.values()) if (!best || b[0] > best[0]) best = b;
  if (!best) return null;
  return '#' + [1, 2, 3].map((c) => Math.round(best[c] / best[0]).toString(16).padStart(2, '0')).join('');
}

/**
 * Where the words were, from the original and the edit at the working size: the mask of the pixels to take
 * from the edit (padded word boxes ∩ the grown difference), its boxes, and each line kept (the ones the edit
 * really removed) measured from its own pixels.
 */
function wordRegions(pic, E, lines) {
  const { w0, h0, white: A, rgba } = pic;
  const n = w0 * h0;
  const S = Math.max(w0, h0);
  // Changed pixels, without lone specks.
  const D = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    D[i] = Math.max(Math.abs(A[j] - E[j]), Math.abs(A[j + 1] - E[j + 1]), Math.abs(A[j + 2] - E[j + 2])) > DIFF ? 1 : 0;
  }
  const C = new Uint8Array(n);
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      const i = y * w0 + x;
      if (!D[i]) continue;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h0) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx || dy) && xx >= 0 && xx < w0 && D[yy * w0 + xx]) k++;
        }
      }
      if (k >= 2) C[i] = 1;
    }
  }
  // Each line's box (working px), the box it's measured in and the wider one the edit may be used in.
  const clampBox = (b) => ({ x0: Math.max(0, Math.floor(b.x0)), y0: Math.max(0, Math.floor(b.y0)), x1: Math.min(w0 - 1, Math.ceil(b.x1)), y1: Math.min(h0 - 1, Math.ceil(b.y1)) });
  const grow = (b, p) => clampBox({ x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p });
  const boxes = lines.map((l) => {
    const b = { x0: (l.box[1] / 1000) * w0, y0: (l.box[0] / 1000) * h0, x1: (l.box[3] / 1000) * w0, y1: (l.box[2] / 1000) * h0 };
    const t = Math.min(b.x1 - b.x0, b.y1 - b.y0);
    return { b, measure: grow(b, 0.15 * t + 0.004 * S), pad: grow(b, 0.35 * t + 0.01 * S) };
  });
  // Every pixel near a line belongs to the line whose box is nearest.
  const owner = new Int16Array(n).fill(-1);
  const best = new Float32Array(n);
  boxes.forEach(({ b, pad }, li) => {
    for (let y = pad.y0; y <= pad.y1; y++) {
      const dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
      for (let x = pad.x0; x <= pad.x1; x++) {
        const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
        const d = Math.hypot(dx, dy);
        const i = y * w0 + x;
        if (owner[i] < 0 || d < best[i]) {
          owner[i] = li;
          best[i] = d;
        }
      }
    }
  });
  // The edit is a copy of the picture: changed pixels far from the words mean it moved or redrew everything.
  let outside = 0;
  let outsideN = 0;
  for (let i = 0; i < n; i++) {
    if (owner[i] >= 0) continue;
    outsideN++;
    if (C[i]) outside++;
  }
  if (outsideN > 0.05 * n && outside / outsideN > 0.35) throw new WordsError('badEdit', 'the picture changed everywhere');

  const kept = [];
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, li) => {
    const { b, measure } = boxes[li];
    const idx = [];
    for (let y = measure.y0; y <= measure.y1; y++) {
      for (let x = measure.x0; x <= measure.x1; x++) {
        const i = y * w0 + x;
        if (C[i] && owner[i] === li) idx.push(i);
      }
    }
    // Not taken out (or hardly): the words stay drawn, not as text.
    if (idx.length < Math.max(8, 0.02 * (b.x1 - b.x0) * (b.y1 - b.y0))) return;
    keep[li] = 1;
    const angle = Math.abs(l.angle) >= 2 ? l.angle : 0;
    const rad = (angle * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const s = new Float32Array(idx.length);
    const t = new Float32Array(idx.length);
    idx.forEach((i, k) => {
      const x = (i % w0) + 0.5;
      const y = Math.floor(i / w0) + 0.5;
      s[k] = x * ux + y * uy;
      t[k] = -x * uy + y * ux;
    });
    s.sort();
    t.sort();
    const edge = idx.length > 2000 ? 0.001 : 0;
    const s0 = quantile(s, edge) - 0.5;
    const s1 = quantile(s, 1 - edge) + 0.5;
    const t0 = quantile(t, edge) - 0.5;
    const t1 = quantile(t, 1 - edge) + 0.5;
    const sm = (s0 + s1) / 2;
    const tm = (t0 + t1) / 2;
    const cx = sm * ux - tm * uy;
    const cy = sm * uy + tm * ux;
    const curve = Math.abs(l.curve) >= 8 ? l.curve : 0;
    const arc = curve ? straightOfArc(s1 - s0, t1 - t0, curve) : { len: s1 - s0, fs: (t1 - t0) / INK };
    const r4 = (v) => Math.round(v * 10000) / 10000;
    kept.push({
      text: l.text,
      font: l.font,
      ...(l.weight === 'bold' ? { weight: 'bold' } : {}),
      size: r4(arc.fs / w0),
      x: r4(cx / w0),
      y: r4(cy / h0),
      w: r4(arc.len / w0),
      fill: mainColour(rgba, idx) || l.color || '#000000',
      ...(curve ? { curve } : {}),
      ...(angle ? { angle } : {}),
    });
  });
  if (!kept.length) return { lines: [] };
  // The pixels to take from the edit: the changes grown a little (the letters' soft edges), near the lines kept.
  const r = Math.max(2, Math.round(0.004 * S));
  const grown = dilate(C, w0, h0, r);
  const M = new Uint8Array(n);
  const rects = new Map();
  for (let i = 0; i < n; i++) {
    if (!grown[i] || owner[i] < 0 || !keep[owner[i]]) continue;
    M[i] = 1;
    const x = i % w0;
    const y = (i - x) / w0;
    const rc = rects.get(owner[i]);
    if (!rc) rects.set(owner[i], { x0: x, y0: y, x1: x, y1: y });
    else {
      if (x < rc.x0) rc.x0 = x;
      if (x > rc.x1) rc.x1 = x;
      if (y < rc.y0) rc.y0 = y;
      if (y > rc.y1) rc.y1 = y;
    }
  }
  // Overlapping boxes as one.
  let list = [...rects.values()];
  for (let merged = true; merged;) {
    merged = false;
    for (let a = 0; a < list.length && !merged; a++) {
      for (let b = a + 1; b < list.length && !merged; b++) {
        const p = list[a];
        const q = list[b];
        if (p.x0 <= q.x1 + 2 && q.x0 <= p.x1 + 2 && p.y0 <= q.y1 + 2 && q.y0 <= p.y1 + 2) {
          list[a] = { x0: Math.min(p.x0, q.x0), y0: Math.min(p.y0, q.y0), x1: Math.max(p.x1, q.x1), y1: Math.max(p.y1, q.y1) };
          list = list.filter((_, k) => k !== b);
          merged = true;
        }
      }
    }
  }
  // See-through pictures: how see-through the picture is round each place (the letters left out), so the edit's
  // plain background there becomes see-through again, and a white shape behind the words stays white.
  let around = null;
  if (pic.seeThrough) {
    const sumA = new Float64Array((w0 + 1) * (h0 + 1));
    const sumN = new Float64Array((w0 + 1) * (h0 + 1));
    for (let y = 0; y < h0; y++) {
      let ra = 0;
      let rn = 0;
      for (let x = 0; x < w0; x++) {
        const i = y * w0 + x;
        if (!grown[i]) {
          ra += rgba[i * 4 + 3];
          rn++;
        }
        const o = (y + 1) * (w0 + 1) + x + 1;
        sumA[o] = sumA[o - w0 - 1] + ra;
        sumN[o] = sumN[o - w0 - 1] + rn;
      }
    }
    const box = (sum, x0, y0, x1, y1) => sum[(y1 + 1) * (w0 + 1) + x1 + 1] - sum[y0 * (w0 + 1) + x1 + 1] - sum[(y1 + 1) * (w0 + 1) + x0] + sum[y0 * (w0 + 1) + x0];
    around = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!M[i]) continue;
      const x = i % w0;
      const y = (i - x) / w0;
      let a = 255;
      for (let rad = 2 * r + 2; rad <= S; rad *= 2) {
        const x0 = Math.max(0, x - rad);
        const y0 = Math.max(0, y - rad);
        const x1 = Math.min(w0 - 1, x + rad);
        const y1 = Math.min(h0 - 1, y + rad);
        const k = box(sumN, x0, y0, x1, y1);
        if (k >= 4) {
          a = box(sumA, x0, y0, x1, y1) / k;
          break;
        }
      }
      around[i] = Math.round(a);
    }
  }
  return { lines: kept, mask: M, rects: list, around };
}

/** The original at its own size with the edit's pixels where the words were (PNG). */
async function compose(pic, E, { mask: M, rects, around }) {
  const { W, H, w0, h0 } = pic;
  const sx = W / w0;
  const sy = H / h0;
  const edit = () => {
    const img = sharp()(E, { raw: { width: w0, height: h0, channels: 3 } });
    return W === w0 && H === h0 ? img : img.resize(W, H, { fit: 'fill', kernel: 'cubic' });
  };
  const at = (x, y) => (x < 0 || y < 0 || x >= w0 || y >= h0 ? 0 : M[y * w0 + x]);
  const overlays = [];
  let bytes = 0;
  const BAND = 4e6; // pixels a piece at the most
  for (const rc of rects) {
    const X0 = Math.max(0, Math.floor((rc.x0 - 1) * sx));
    const X1 = Math.min(W, Math.ceil((rc.x1 + 2) * sx));
    const Y0 = Math.max(0, Math.floor((rc.y0 - 1) * sy));
    const Y1 = Math.min(H, Math.ceil((rc.y1 + 2) * sy));
    const width = X1 - X0;
    if (width <= 0 || Y1 <= Y0) continue;
    const rows = Math.max(1, Math.floor(BAND / width));
    for (let top = Y0; top < Y1; top += rows) {
      const height = Math.min(rows, Y1 - top);
      const R = { left: X0, top, width, height };
      const [orig, ed] = await Promise.all([
        pic.open().extract(R).toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).timeout(TIMEOUT).toBuffer(),
        edit().extract(R).raw({ depth: 'uchar' }).timeout(TIMEOUT).toBuffer(),
      ]);
      const out = Buffer.from(orig);
      for (let y = 0; y < height; y++) {
        const wy = (top + y + 0.5) / sy - 0.5;
        const yi = Math.floor(wy);
        const fy = wy - yi;
        for (let x = 0; x < width; x++) {
          const wx = (X0 + x + 0.5) / sx - 0.5;
          const xi = Math.floor(wx);
          const fx = wx - xi;
          const m00 = at(xi, yi);
          const m10 = at(xi + 1, yi);
          const m01 = at(xi, yi + 1);
          const m11 = at(xi + 1, yi + 1);
          if (!(m00 | m10 | m01 | m11)) continue;
          const m = (m00 * (1 - fx) + m10 * fx) * (1 - fy) + (m01 * (1 - fx) + m11 * fx) * fy;
          if (m <= 0) continue;
          const k = (y * width + x) * 4;
          const j = (y * width + x) * 3;
          const a1 = orig[k + 3] / 255;
          let r2 = ed[j];
          let g2 = ed[j + 1];
          let b2 = ed[j + 2];
          let a2 = 1;
          if (around) {
            // Plain (white) in the edit, where the picture round about is see-through: see-through.
            const ai = Math.min(h0 - 1, Math.max(0, Math.round(wy))) * w0 + Math.min(w0 - 1, Math.max(0, Math.round(wx)));
            // (Mostly see-through round about counts as see-through; mostly solid as solid.)
            const bgA = Math.min(1, Math.max(0, ((around[ai] || 0) / 255 - 0.3) / 0.4));
            const dw = Math.max(255 - r2, 255 - g2, 255 - b2);
            const plain = dw <= 12 ? 1 : dw >= 48 ? 0 : (48 - dw) / 36;
            a2 = 1 - plain * (1 - bgA);
            if (a2 > 0 && a2 < 1) {
              r2 = Math.min(255, Math.max(0, (r2 - 255 * (1 - a2)) / a2));
              g2 = Math.min(255, Math.max(0, (g2 - 255 * (1 - a2)) / a2));
              b2 = Math.min(255, Math.max(0, (b2 - 255 * (1 - a2)) / a2));
            }
          }
          const a = (1 - m) * a1 + m * a2;
          if (a <= 0) {
            out[k] = out[k + 1] = out[k + 2] = out[k + 3] = 0;
            continue;
          }
          out[k] = Math.round(((1 - m) * orig[k] * a1 + m * r2 * a2) / a);
          out[k + 1] = Math.round(((1 - m) * orig[k + 1] * a1 + m * g2 * a2) / a);
          out[k + 2] = Math.round(((1 - m) * orig[k + 2] * a1 + m * b2 * a2) / a);
          out[k + 3] = Math.round(a * 255);
        }
      }
      bytes += out.length;
      // A clean place first (so see-through pixels stay see-through), then the piece.
      if (pic.hasAlpha) overlays.push({ input: { create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }, left: X0, top, blend: 'dest-out' });
      const piece = bytes > 200e6 ? await sharp()(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer() : out;
      overlays.push({ input: piece, ...(Buffer.isBuffer(piece) && piece === out ? { raw: { width, height, channels: 4 } } : {}), left: X0, top, blend: 'over' });
    }
  }
  let img = pic.open().toColourspace('srgb');
  img = pic.hasAlpha ? img.ensureAlpha() : img.removeAlpha();
  // (The pieces are RGBA; the result keeps the original's channels: a picture without alpha stays without.)
  return img.composite(overlays).png({ compressionLevel: 6 }).timeout({ seconds: 180 }).toBuffer();
}

/**
 * The picture split into its drawing and its words: { words: false } when there are none (to change), else
 * { words: true, png, texts, width, height }: png is the picture without the words at its own size, texts the
 * words as the `words.texts` of a ready design's picture (public/js/templates.js: x, y the centre and w the width
 * of each line, size its font size, as fractions of the picture; fill, font, weight, curve, angle). Throws a
 * WordsError. `opts.call` replaces the Gemini call (tests).
 */
async function split(buffer, opts = {}) {
  try {
    const call = opts.call || defaultCall;
    const pic = await openPicture(buffer);
    const { lines } = await detect(buffer, { call, picture: pic });
    if (!lines.length) return { words: false };
    const E = await removeWords(pic, lines, call);
    const regions = wordRegions(pic, E, lines);
    if (!regions.lines.length) throw new WordsError('notRemoved');
    const png = await compose(pic, E, regions);
    return { words: true, png, texts: regions.lines, width: pic.W, height: pic.H };
  } catch (e) {
    throw e instanceof WordsError ? e : new WordsError('failed', e && e.message);
  }
}

// ---------- The queue ----------
const HOST = crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 10);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const writeFile = (file, data) => {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

/**
 * Makes the words of uploaded designs editable in the background, one picture at a time. The state is in the
 * library (src/library.js), so every copy of the app sharing DATA_DIR works from the same list, a picture is
 * worked on by one copy only, and the daily cap counts every copy's pictures.
 */
class WordsQueue {
  constructor({ library, call = defaultCall, split: splitFn = split, enabled: on = enabled, dailyMax, now = () => Date.now(),
    timeZone = process.env.SHOP_TIMEZONE || 'Africa/Cairo', every = 60e3, staleMs = 15 * 60e3, retryMs = 2 * 60e3, maxTries = 3, log = console } = {}) {
    this.library = library;
    this.call = call;
    this.split = splitFn;
    this.on = on;
    const max = dailyMax ?? parseInt(process.env.WORDS_DAILY_MAX, 10);
    this.dailyMax = Number.isInteger(max) && max >= 0 ? max : 60;
    this.now = now;
    this.dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone });
    this.every = every;
    this.staleMs = staleMs;
    this.retryMs = retryMs;
    this.maxTries = maxTries;
    this.log = log;
    this.token = `${HOST}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
    this.running = null;
    this.current = null;
    this.pausedUntil = 0;
    this.timer = null;
  }
  /** Look for work now and then every minute (a restart carries on where the last run stopped). */
  start() {
    if (this.timer || !this.every) return;
    this.timer = setInterval(() => this.kick(), this.every);
    this.timer.unref();
    setImmediate(() => this.kick());
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
  day() {
    return this.dayFmt.format(new Date(this.now()));
  }
  /** A design left 'working' by a copy of the app that stopped (or that has had it far too long). */
  stale(d) {
    if (d.wordsBy === this.token) return this.current !== d.id;
    const [host, pid] = String(d.wordsBy || '').split(':');
    // (This copy before a restart, or another copy on this machine that is gone.)
    if (host === HOST && (Number(pid) === process.pid || !alive(Number(pid)))) return true;
    return !(this.now() - Date.parse(d.wordsAt || 0) < this.staleMs);
  }
  /** Work through what waits (unless already at it). Resolves when there's nothing left for now. */
  kick() {
    if (this.running) return this.running;
    if (!this.on() || this.pausedUntil > this.now()) return Promise.resolve();
    this.running = this.loop().catch((e) => this.log.error('[words]', e && e.message)).finally(() => { this.running = null; });
    return this.running;
  }
  async loop() {
    while (this.on() && this.pausedUntil <= this.now()) {
      const c = this.library.claimWords({ token: this.token, day: this.day(), max: this.dailyMax, maxTries: this.maxTries, now: this.now(), stale: (d) => this.stale(d) });
      if (!c.design) return;
      this.current = c.design.id;
      try {
        await this.work(c.design);
      } finally {
        this.current = null;
      }
    }
  }
  async work(d) {
    let outcome;
    try {
      const pic = (d.items || []).find((i) => i && i.kind === 'image' && typeof i.printSrc === 'string');
      const name = pic ? path.basename(pic.printSrc) : '';
      if (!/^print\.(png|jpg)$/.test(name)) throw new WordsError('badPicture', 'no print file');
      let buf;
      try {
        buf = fs.readFileSync(path.join(this.library.artDir(d.id), name));
      } catch (e) {
        throw new WordsError('badPicture', e.message);
      }
      const out = await this.split(buf, { call: this.call });
      outcome = out && out.words ? { status: 'ready', words: await this.saveFiles(d, name, out) } : { status: 'none' };
    } catch (e) {
      const code = e instanceof WordsError ? e.code : 'failed';
      this.log.warn(`[words] ${d.id} (try ${d.wordsTries}): ${code}${e && e.message && e.message !== `words: ${code}` ? ` (${String(e.message).slice(0, 200)})` : ''}`);
      // A refused key fails every picture: wait a while before the next.
      if (code === 'key' || code === 'off') this.pausedUntil = this.now() + 30 * 60e3;
      outcome = RETRY.has(code) && (d.wordsTries || 1) < this.maxTries
        ? { status: 'queued', error: code, next: new Date(this.now() + this.retryMs * (d.wordsTries || 1)).toISOString() }
        : { status: 'failed', error: code };
    }
    this.library.wordsDone(d.id, this.token, outcome, this.now());
  }
  /** The words-free copies next to the design's own (nowords-web.png, nowords-print.png|jpg): the picture's `words`. */
  async saveFiles(d, printName, out) {
    const dir = this.library.artDir(d.id);
    const ext = printName.endsWith('.jpg') ? 'jpg' : 'png';
    let size = null;
    try {
      const m = await sharp()(path.join(dir, 'web.png')).metadata();
      if (m.width > 0 && m.height > 0) size = [m.width, m.height];
    } catch (e) { /* as uploads make it: 1200 px at the most */ }
    if (!size) {
      const k = Math.min(1, 1200 / Math.max(out.width, out.height));
      size = [Math.max(1, Math.round(out.width * k)), Math.max(1, Math.round(out.height * k))];
    }
    const [print, web] = await Promise.all([
      ext === 'png' ? out.png : sharp()(out.png, DECODE).flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).timeout(TIMEOUT).toBuffer(),
      sharp()(out.png, DECODE).resize(size[0], size[1], { fit: 'fill' }).png({ compressionLevel: 9, adaptiveFiltering: true }).timeout(TIMEOUT).toBuffer(),
    ]);
    fs.mkdirSync(dir, { recursive: true });
    writeFile(path.join(dir, `nowords-print.${ext}`), print);
    writeFile(path.join(dir, 'nowords-web.png'), web);
    return { src: `/library-art/${d.id}/nowords-web.png`, printSrc: `/library-art/${d.id}/nowords-print.${ext}`, printPx: [out.width, out.height], texts: out.texts };
  }
  /** A design just published: its words wait their turn ('off' without the AI key). */
  enqueue(id) {
    const r = this.library.wordsAction(String(id), 'queue', { enabled: this.on(), now: this.now() });
    this.kick();
    return r;
  }
  /** The admin's 'retry' | 'keep' | 'use' (see Library.wordsAction). */
  act(id, action) {
    const r = this.library.wordsAction(String(id), action, { enabled: this.on(), now: this.now() });
    if (r && !r.refused) {
      // (Asked for by the admin: no waiting after a refused key, it's tried again now.)
      if (action !== 'keep') this.pausedUntil = 0;
      this.kick();
    }
    return r;
  }
  /**
   * For the admin: { enabled, dailyMax, usedToday, designs: { id: { status, error, at } } }. A design not looked
   * at yet waits ('queued'), or is 'off' without the key; a deleted one that was never looked at has no status.
   */
  state() {
    const s = this.library.wordsState();
    const on = this.on();
    const deleted = new Set(this.library.index.deleted || []);
    const designs = {};
    for (const [id, x] of Object.entries(s.designs)) {
      let status = x.status;
      if (!status) status = deleted.has(id) ? null : on ? 'queued' : 'off';
      else if (!on && status === 'queued') status = 'off';
      designs[id] = { status, error: x.error, at: x.at };
    }
    const usedToday = s.usage && s.usage.day === this.day() ? s.usage.n : 0;
    return { enabled: on, dailyMax: this.dailyMax, usedToday, designs };
  }
}
const createQueue = (opts) => new WordsQueue(opts);

module.exports = { detect, split, createQueue, WordsQueue, WordsError, enabled, FONTS, RETRY, readLines, straightOfArc, LIMITS: { MAX_PIXELS, SEND_PX }, _parts: { openPicture, removeWords, wordRegions, compose } };
