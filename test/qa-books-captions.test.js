'use strict';

// QA (26 Nov), the colouring book's hollow captions: the spaces between words were lost ("Mohamed Abdelrahman the
// Firefighter" read as one word), an emoji in the name became an empty circle, and a 20-letter name wrapped the
// caption ("Captain" went tiny), sat on the frame's bottom line and the white band cut the frame. Also the face crop's
// print size the book page warns with (a 60 x 40 px photo printed blurred with no word).
const test = require('node:test');
const assert = require('node:assert');
const books = require('../src/books');

const BOOK = books.BOOKS['dream-jobs'];
const pageOf = (img) => BOOK.pages.findIndex((p) => p.img === img);
const PX = 900;

/** The page with its caption and the same page without (the picture alone), as grey pixels; and RGB for colours. */
async function render(img, name, { gender = 'boy', px = PX } = {}) {
  const n = pageOf(img);
  const answers = { name, gender };
  const page = await (await books.renderPage({ book: BOOK, answers }, n, px)).greyscale().raw().toBuffer();
  const plain = await (await books.renderPage({ book: BOOK, answers }, n, px, { noText: true })).greyscale().raw().toBuffer();
  const rgb = await (await books.renderPage({ book: BOOK, answers }, n, px)).removeAlpha().raw().toBuffer();
  return { page, plain, rgb, px };
}
/** The caption's own dark pixels (dark on the page, light in the picture) in the bottom part of the page. */
function captionInk({ page, plain, px }) {
  const cols = new Uint8Array(px);
  const rows = new Uint8Array(px);
  for (let y = Math.round(px * 0.8); y < px; y++) {
    for (let x = 0; x < px; x++) {
      if (page[y * px + x] < 128 && plain[y * px + x] >= 128) { cols[x] = 1; rows[y] = 1; }
    }
  }
  const first = (a) => a.indexOf(1);
  const last = (a) => a.lastIndexOf(1);
  return { cols, rows, x0: first(cols), x1: last(cols), y0: first(rows), y1: last(rows) };
}
/** Runs of blank columns (or rows) between the first and last inked one, as fractions of the page. */
function blankRuns(a, from, to, px) {
  const runs = [];
  let run = 0;
  for (let i = from; i <= to; i++) {
    if (!a[i]) run++;
    else { if (run) runs.push(run / px); run = 0; }
  }
  return runs;
}

test('a spaced name keeps the spaces between the words of its hollow caption', { timeout: 60e3 }, async () => {
  const ink = captionInk(await render('firefighter', 'Mohamed Abdelrahman'));
  // "Mohamed Abdelrahman the Firefighter": 3 spaces, each a clear gap (the letters' own gaps are far smaller).
  const words = blankRuns(ink.cols, ink.x0, ink.x1, PX).filter((g) => g >= 0.008);
  assert.strictEqual(words.length, 3, `gaps: ${blankRuns(ink.cols, ink.x0, ink.x1, PX).map((g) => (g * 100).toFixed(2)).join(' ')}`);
  for (const g of words) assert.ok(g >= 0.01, `a word gap of ${(g * 100).toFixed(2)}% of the page (they were 0.2-0.5%)`);
});

test('an emoji in the name is drawn in its colours on the caption, not as an empty outline', { timeout: 60e3 }, async () => {
  const r = await render('firefighter', 'Laila 😀');
  const { rgb, px } = r;
  const ink = captionInk(r);
  let colour = 0;
  for (let y = ink.y0; y <= ink.y1; y++) {
    for (let x = ink.x0; x <= ink.x1; x++) {
      const i = (y * px + x) * 3;
      if (rgb[i] > 200 && rgb[i + 1] > 140 && rgb[i + 2] < 110) colour++; // the face's yellow
    }
  }
  assert.ok(colour > 400, `${colour} yellow pixels in the caption`);
  // The letters stay hollow: white inside a dark outline (the caption's middle row has both).
  const mid = Math.round((ink.y0 + ink.y1) / 2);
  let dark = 0;
  let white = 0;
  for (let x = ink.x0; x < ink.x0 + (ink.x1 - ink.x0) / 2; x++) {
    const v = r.page[mid * px + x];
    if (v < 80) dark++;
    else if (v > 240) white++;
  }
  assert.ok(dark > 20 && white > 20, `dark ${dark}, white ${white}`);
});

/**
 * Lines of a frame drawn round the picture near the caption: rows dark along half the page (the bottom line, the
 * pilot's line above the caption) and columns near the edges dark down the caption's rows (the sides).
 */
function frameLines({ plain, px }) {
  const dark = (x, y) => plain[y * px + x] < 128;
  const rows = [];
  for (let y = Math.round(px * 0.8); y < Math.round(px * 0.99); y++) {
    let n = 0;
    for (let x = 0; x < px; x++) if (dark(x, y)) n++;
    if (n >= px * 0.5) rows.push(y);
  }
  const cols = [];
  for (let x = Math.round(px * 0.01); x < Math.round(px * 0.99); x++) {
    if (x > px * 0.12 && x < px * 0.88) continue;
    let n = 0;
    for (let y = Math.round(px * 0.86); y < Math.round(px * 0.93); y++) if (dark(x, y)) n++;
    if (n >= 0.9 * (Math.round(px * 0.93) - Math.round(px * 0.86))) cols.push(x);
  }
  return { rows, cols };
}

test('a 20-letter name: one line of letters, the band inside the frame (its lines untouched), "Captain" not tiny', { timeout: 120e3 }, async () => {
  const long = 'WWWWWWWWWWWWWWWWWWWW';
  for (const img of ['pilot', 'doctor', 'scientist', 'explorer']) {
    for (const gender of ['boy', 'girl']) {
      for (const name of [long, 'Abdelrahmanalexander', 'Jaylan', 'Laila']) {
        const r = await render(img, name, { gender });
        const { rows, cols } = frameLines(r);
        assert.ok(rows.length && cols.length >= 2, `${img}: a framed picture`);
        // Nothing of the frame is painted over by the white band.
        let cut = 0;
        for (const y of rows) for (let x = 0; x < r.px; x++) if (r.plain[y * r.px + x] < 128 && r.page[y * r.px + x] > 200) cut++;
        for (const x of cols) for (let y = Math.round(r.px * 0.8); y < r.px; y++) if (r.plain[y * r.px + x] < 128 && r.page[y * r.px + x] > 200) cut++;
        assert.strictEqual(cut, 0, `${img} ${gender} "${name}": ${cut} pixels of the frame painted over`);
        // One line: the caption's ink rows are one block (two lines have blank rows between them).
        const ink = captionInk(r);
        const between = blankRuns(ink.rows, ink.y0, ink.y1, r.px);
        assert.deepStrictEqual(between, [], `${img} "${name}": one line (blank rows inside: ${between.length})`);
        // Inside the frame's sides and above its bottom line.
        const left = Math.max(...cols.filter((x) => x < r.px / 2));
        const right = Math.min(...cols.filter((x) => x > r.px / 2));
        const bottom = Math.min(...rows.filter((y) => y > r.px * 0.93));
        assert.ok(ink.x0 > left && ink.x1 < right && ink.y1 < bottom, `${img} "${name}": the caption inside the frame`);
        // Shrunk only as much as its line needs (20 W's, the widest letters, are still 5 mm tall when printed).
        const tall = (ink.y1 - ink.y0) / r.px;
        assert.ok(tall >= (name === long ? 0.025 : 0.035), `${img} "${name}": letters ${(100 * tall).toFixed(1)}% of the page tall`);
      }
    }
  }
});

test('a short name keeps its caption as it was: the same size on every colouring page, and a long one only shrinks', { timeout: 60e3 }, async () => {
  // "Laila" fits at the caption's full size: its letters are as tall as with a few more of the same letters.
  for (const img of ['astronaut', 'pilot', 'doctor']) {
    const a = captionInk(await render(img, 'Lailaaaa'));
    const b = captionInk(await render(img, 'Laila'));
    assert.strictEqual(a.y1 - a.y0, b.y1 - b.y0, img);
    assert.strictEqual(a.y0, b.y0, img);
    const long = captionInk(await render(img, 'WWWWWWWWWWWWWWWWWWWW'));
    assert.ok(long.y1 - long.y0 < a.y1 - a.y0, `${img}: the long name is drawn smaller`);
  }
});

test('the face crop\'s print size, for the book page\'s "may print blurry" note', () => {
  const story = books.publicBook(books.BOOKS['space-hero']).photo;
  const colouring = books.publicBook(BOOK).photo;
  // The biggest face: story page 3 (16% of the page, photo), the vet colouring page (16.7%, line art).
  assert.deepStrictEqual(story, { printIn: 1.76, lowDpi: 100 });
  assert.deepStrictEqual(colouring, { printIn: 1.63, lowDpi: 100 });
  // A 60 x 40 photo: the oval is 84% of its short side tall at the least zoom, far below; a phone photo is fine.
  const dpi = (shortSide, zoom, p) => ((shortSide / zoom) * 0.84) / p.printIn;
  assert.ok(dpi(40, 1, story) < story.lowDpi);
  assert.ok(dpi(3000, 2, story) > story.lowDpi);
});
