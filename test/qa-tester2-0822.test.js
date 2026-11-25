'use strict';

// QA tester 2 (25 Nov, 07:02–08:22): {fields} can't be ordered unfilled, share replies are text only,
// numbers in English words keep their digits on Arabic pages, the staff name survives a reload.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const i18n = require('../src/i18n');

async function shop() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0822-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, method, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { base, call, close: () => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('a design with an unfilled {field} is refused (a ready business card can\'t print "{Name}")', async () => {
  const s = await shop();
  try {
    const card = (text) => s.call('/api/designs', 'POST', { productId: 'bizcards', color: 'gloss', size: '100', sides: { front: { editor: { objects: [{ type: 'i-text', text }, { type: 'group', objects: [{ type: 'textbox', text: 'Mona' }] }] } } } });
    const r = await card('{الاسم}\n{الوظيفة}');
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.strictEqual(body.code, 'fieldsUnfilled');
    // Inside a group too.
    const g = await s.call('/api/designs', 'POST', { productId: 'bizcards', color: 'gloss', size: '100', sides: { front: { editor: { objects: [{ type: 'group', objects: [{ type: 'i-text', text: 'Call {Phone}' }] }] } } } });
    assert.strictEqual(g.status, 400);
    // Real words are fine, and so are braces that aren't a field.
    assert.strictEqual((await card('Mona Ali')).status, 201);
    assert.strictEqual((await card('{ }')).status, 201);
  } finally {
    s.close();
  }
});

test('share replies take text only and never cut an emoji in half', async () => {
  const s = await shop();
  try {
    const img = 'data:image/png;base64,' + (await sharp({ create: { width: 60, height: 72, channels: 3, background: '#fff' } }).png().toBuffer()).toString('base64');
    const sh = await (await s.call('/api/shares', 'POST', { productId: 'tshirt', color: 'navy', size: 'L', sides: { front: { objects: [{ type: 'i-text', text: 'hi' }] } }, previews: { front: img } })).json();
    const reply = async (body) => (await (await s.call(`/api/shares/${sh.id}/feedback`, 'POST', body)).json()).feedback.pop();
    assert.strictEqual((await reply({ vote: 'up', name: { a: 1 } })).name, '');
    const long = `${'x'.repeat(39)}😀`;
    const got = (await reply({ vote: 'up', name: long })).name;
    assert.strictEqual(got, long, 'the emoji stays whole');
    assert.ok(!/[\ud800-\udbff]$/.test((await reply({ vote: 'up', name: `${'y'.repeat(39)}😀😀` })).name), 'never half an emoji');
  } finally {
    s.close();
  }
});

test('Arabic pages keep the digits of English words ("iPhone 16 Pro", "Class of 2025")', () => {
  const ar = i18n.arabicDigits;
  assert.strictEqual(ar('Class of 2025'), 'Class of 2025');
  assert.strictEqual(ar('30 and fabulous'), '30 and fabulous');
  assert.strictEqual(ar('جراب iPhone 16 Pro'), 'جراب iPhone 16 Pro');
  assert.strictEqual(ar('30 × 40 سم'), '٣٠ × ٤٠ سم');
  assert.strictEqual(ar('A4 × 100'), 'A4 × ١٠٠');
  assert.strictEqual(ar('10 كوبونات'), '١٠ كوبونات');
  // The pages do the same (public/js/common.js).
  const common = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'common.js'), 'utf8');
  assert.match(common, /LATIN_BEFORE = \/\[A-Za-z\]\[A-Za-z'’\]\*\\s\+\$\//);
});

test('the staff session says the person\'s name, so it survives a reload', async () => {
  const s = await shop();
  try {
    const owner = (await (await s.call('/api/admin/login', 'POST', { password: 'secret-owner-pass' })).json()).token;
    assert.strictEqual((await s.call('/api/admin/staff', 'POST', { username: 'mostafa', password: 'Product-Manager-2026!', role: 'products', name: 'Mostafa مصطفى' }, { Authorization: `Bearer ${owner}` })).status, 201);
    const staff = (await (await s.call('/api/admin/login', 'POST', { username: 'mostafa', password: 'Product-Manager-2026!' })).json()).token;
    const me = await (await s.call('/api/admin/session', 'GET', undefined, { Authorization: `Bearer ${staff}` })).json();
    assert.strictEqual(me.shown, 'Mostafa مصطفى');
    assert.strictEqual(me.name, 'mostafa');
  } finally {
    s.close();
  }
});
