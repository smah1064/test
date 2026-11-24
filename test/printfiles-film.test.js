'use strict';

// DTF film: every piece gets its sorting label, on a page where the piece is printed,
// also when a piece ends exactly at a page break (films longer than 196 in continue on the next page).
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const printfiles = require('../src/printfiles');

const PAGE_IN = 196;
const LABEL_IN = 6 / 72 * 1.2; // a 6 pt label line

/** Builds a film and records every label and picture drawn: page, position and page height (inches). */
async function drawn(pieces, opts) {
  const labels = [];
  const images = [];
  const text = PDFDocument.prototype.text;
  const image = PDFDocument.prototype.image;
  PDFDocument.prototype.text = function (str, x, y, o) {
    labels.push({ str, page: this._pageBuffer.length - 1, x: x / 72, y: y / 72, pageH: this.page.height / 72 });
    return text.call(this, str, x, y, o);
  };
  PDFDocument.prototype.image = function (src, x, y, o) {
    images.push({ page: this._pageBuffer.length - 1, y: y / 72, h: o.height / 72, pageH: this.page.height / 72 });
    return image.call(this, src, x, y, o);
  };
  try {
    const film = await printfiles.filmPdf(pieces, opts);
    return { film, labels, images };
  } finally {
    PDFDocument.prototype.text = text;
    PDFDocument.prototype.image = image;
  }
}
const visible = (l) => l.y >= -1e-6 && l.y + LABEL_IN <= l.pageH + 1e-6;

test('a 40-polo film (pieces ending exactly at the page breaks) has a label for each of its 80 pieces', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#e63946' } }).png().toBuffer();
  const pieces = [];
  // As the film route builds them: per side, per line (front first).
  for (const [side, w, h] of [['Front', 4, 4], ['Back', 12, 14.04]]) {
    for (const [n, line] of [[25, 'White M'], [15, 'Black L']]) {
      for (let k = 0; k < n; k++) pieces.push({ png, widthIn: w, heightIn: h, label: `POD-1 #1 · Polo · ${side} · ${line} · ${k + 1}` });
    }
  }
  const { film, labels } = await drawn(pieces, { title: 'DTF film' });
  assert.ok(film.lengthIn > 2 * PAGE_IN && film.lengthIn < 3 * PAGE_IN, `3 pages (${film.lengthIn} in)`);
  assert.strictEqual(labels.filter(visible).length, 80, 'one visible label per piece');
  assert.strictEqual(new Set(labels.filter(visible).map((l) => l.str)).size, 80, 'every piece has its own label');
  assert.strictEqual(labels.length, 80, 'each label is drawn once (not cut in two at a page break)');
});

test('labels stay on the page of their piece at a page break (straight and turned pieces)', async () => {
  const png = await sharp({ create: { width: 8, height: 12, channels: 4, background: '#1d3557' } }).png().toBuffer();
  const m = 0.25;
  // Ready-made layout (inches from the film's top margin): images ending exactly at 196 in and 392 in,
  // one ending just above the break (its label would be cut), and one crossing the break.
  const pieces = [
    { png, widthIn: 4, heightIn: 6, label: 'A ends at the first break' },
    { png, widthIn: 4, heightIn: 6, label: 'B turned, ends at the first break' },
    { png, widthIn: 4, heightIn: 6, label: 'C ends just above the break' },
    { png, widthIn: 4, heightIn: 6, label: 'D crosses the break' },
    { png, widthIn: 4, heightIn: 6, label: 'E ends at the second break' },
    { png, widthIn: 4, heightIn: 6, label: 'F an ordinary piece' },
  ];
  const placements = [
    { id: 0, x: 0, y: PAGE_IN - m - 6, w: 4, h: 6, rotated: false },
    { id: 1, x: 5, y: PAGE_IN - m - 4, w: 6, h: 4, rotated: true },
    { id: 2, x: 12, y: PAGE_IN - m - 6 - 0.05, w: 4, h: 6, rotated: false },
    { id: 3, x: 17, y: PAGE_IN - m - 3, w: 4, h: 6, rotated: false },
    { id: 4, x: 0, y: 2 * PAGE_IN - m - 6, w: 4, h: 6, rotated: false },
    { id: 5, x: 5, y: 2 * PAGE_IN + 10, w: 4, h: 6, rotated: false },
  ];
  const lengthIn = 2 * PAGE_IN + 30;
  const { labels, images } = await drawn(pieces, { placements, lengthIn, title: 'DTF film' });
  assert.strictEqual(labels.length, pieces.length, 'one label per piece');
  for (const l of labels) {
    assert.ok(visible(l), `${l.str}: on the page (y ${l.y.toFixed(3)} of ${l.pageH})`);
    const piece = pieces[placements.findIndex((p) => pieces[p.id].label === l.str)];
    const ih = placements.find((p) => pieces[p.id] === piece).rotated ? piece.widthIn : piece.heightIn;
    // The piece's picture is drawn on that page too, and the label sits right under or above it (not on top of it).
    const pic = images.filter((im) => im.page === l.page && Math.abs(im.h - ih) < 1e-6 && im.y < l.pageH && im.y + im.h > 0);
    assert.ok(pic.some((im) => (l.y >= im.y + im.h - 1e-6 && l.y <= im.y + im.h + 0.05) || (l.y + LABEL_IN <= im.y + 1e-6 && l.y + LABEL_IN >= im.y - 0.05)), `${l.str}: next to its piece`);
  }
  // Pages are drawn with only what shows on them: no pictures left entirely off the page.
  for (const im of images) assert.ok(im.y < im.pageH && im.y + im.h > 0, 'picture on its page');
});
