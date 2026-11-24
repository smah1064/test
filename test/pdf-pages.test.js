'use strict';

// Booklets: a whole PDF, one picture per page (POST /api/artwork/pages).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { createApp } = require('../src/app');

let server;
let base;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-pdfpages-'));
  const app = createApp({ dataDir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function pdf(n) {
  return new Promise((resolve) => {
    const d = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    for (let i = 0; i < n; i++) {
      d.addPage({ size: [420, 595], margin: 0 });
      d.rect(0, 0, 420, 595).fill(i % 2 ? '#1c7ed6' : '#e03131');
    }
    d.end();
  });
}
const send = (body, headers = {}) => fetch(`${base}/api/artwork/pages`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-page-w': '420', 'x-page-h': '595', ...headers }, body });

test('every page of a PDF comes back as a page picture, in order', async () => {
  const r = await send(await pdf(3));
  assert.strictEqual(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.strictEqual(body.pages.length, 3);
  assert.strictEqual(body.more, false);
  const second = await sharp(Buffer.from(body.pages[1].split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true });
  assert.deepStrictEqual([second.info.width, second.info.height], [420, 595]);
  const mid = (Math.floor(second.info.height / 2) * second.info.width + Math.floor(second.info.width / 2)) * second.info.channels;
  assert.ok(second.data[mid + 2] > 150 && second.data[mid] < 80, 'page 2 is the blue one');
});

test('a PDF longer than asked says so, and only PDFs are taken', async () => {
  const body = await (await send(await pdf(5), { 'x-max-pages': '4' })).json();
  assert.strictEqual(body.pages.length, 4);
  assert.strictEqual(body.more, true);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  const bad = await send(png);
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await bad.json()).code, 'pdfOnly');
});
