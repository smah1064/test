'use strict';

// Tester 2's run at 3 am Cairo (26 Nov), on the server: two copies of the app on one data folder take turns saving
// one kids book, and a save never changes a book that was just ordered on the other copy; a sold-out cover can't be
// saved or ordered; more of the passwords everyone tries are refused.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { Store } = require('../src/store');
const passwords = require('../src/passwords');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], designsAll: [OPEN], bookSaves: [OPEN], orders: [OPEN] };
const CUSTOMER = { name: 'Salma Adel', phone: '01055556666', governorate: 'cairo', city: 'Maadi', address: '3 Street 9' };
const ANSWERS = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };
const COLORING = { name: 'Laila', gender: 'girl' };

let dir;
let A;
let B;
const start = (a) => new Promise((resolve) => { const s = a.listen(0, () => resolve(s)); });
const at = (s) => `http://127.0.0.1:${s.address().port}`;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-t2-2603-'));
  const opts = { dataDir: dir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0 };
  A = await start(createApp(opts));
  B = await start(createApp(opts));
});
test.after(() => {
  A.close();
  B.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const send = (srv, method, url, body, headers = {}) => fetch(at(srv) + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const photo = async (rgb, size = 500) => `data:image/jpeg;base64,${(await sharp({ create: { width: size, height: size, channels: 3, background: rgb } }).jpeg().toBuffer()).toString('base64')}`;
const noisy = async (size) => `data:image/jpeg;base64,${(await sharp({ create: { width: size, height: size, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg({ quality: 80 }).toBuffer()).toString('base64')}`;
const lockFile = (id) => path.join(dir, 'files', id, '.saving.lock');
const faceFile = (id) => path.join(dir, 'files', id, 'face.jpg');
const onDisk = (id) => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).designs[id];
async function newBook(srv, bookId = 'space-hero', extra = {}) {
  const r = await send(srv, 'POST', `/api/books/${bookId}/designs`, { answers: bookId === 'space-hero' ? ANSWERS : COLORING, face: await photo('#c99'), ...extra });
  assert.strictEqual(r.status, 201, await r.clone().text());
  return r.json();
}
async function order(srv, id) {
  const proof = await (await send(srv, 'GET', `/api/designs/${id}/proof`)).json();
  const q = await (await send(srv, 'POST', '/api/cart/quote', { designIds: [id] })).json();
  return send(srv, 'POST', '/api/orders', { customer: CUSTOMER, designIds: [id], expectedTotal: q.total, approvals: { [id]: { proofHash: proof.proofHash } } });
}
const redness = async (file) => {
  const { channels } = await sharp(file).stats();
  return channels[0].mean - channels[2].mean;
};

test('a book being saved on one copy can\'t be ordered on the other until the save is done', async () => {
  const d = await newBook(A);
  // The other copy is saving it (its lock in the book's folder).
  fs.writeFileSync(lockFile(d.id), '99999');
  const busy = await order(B, d.id);
  assert.strictEqual(busy.status, 409);
  assert.strictEqual((await busy.json()).code, 'bookSaving');
  // A lock left by a copy that crashed long ago doesn't count.
  const old = new Date(Date.now() - 10 * 60e3);
  fs.utimesSync(lockFile(d.id), old, old);
  const ok = await order(B, d.id);
  assert.strictEqual(ok.status, 201, await ok.clone().text());
});

test('a save waiting for the other copy\'s save starts from the latest book, and stops if it was ordered meanwhile', async () => {
  const d = await newBook(A);
  const faceBefore = fs.readFileSync(faceFile(d.id));
  fs.writeFileSync(lockFile(d.id), '99999');
  const saving = send(A, 'PUT', `/api/books/designs/${d.id}`, { answers: { ...ANSWERS, name: 'Changed' }, face: await photo('#33f') }, { 'x-edit-token': d.editToken });
  await new Promise((r) => setTimeout(r, 300));
  // Ordered on the other copy while this save waited.
  new Store(dir).mutate((db) => { db.designs[d.id].orderId = 'order-on-the-other-copy'; });
  fs.rmSync(lockFile(d.id));
  const r = await saving;
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).code, 'designOrdered');
  const after = onDisk(d.id);
  assert.strictEqual(after.answers.name, 'Yousef');
  assert.strictEqual(after.version, 1);
  assert.strictEqual(after.orderId, 'order-on-the-other-copy');
  assert.ok(fs.readFileSync(faceFile(d.id)).equals(faceBefore), 'the photo is the ordered one');
  assert.ok(!fs.existsSync(lockFile(d.id)), 'no lock left behind');
});

test('ordered on the other copy while a save was running: the save is undone, the ordered book stays as approved', async () => {
  // The order has to land between the new photo being written and the save finishing: tried a few times.
  let hit = 0;
  for (let attempt = 0; attempt < 4 && !hit; attempt++) {
    const d = await newBook(A, 'dream-jobs');
    const faceBefore = fs.readFileSync(faceFile(d.id));
    const t0 = fs.statSync(faceFile(d.id)).mtimeMs;
    const saving = send(A, 'PUT', `/api/books/designs/${d.id}`, { answers: { ...COLORING, name: 'Changed' }, face: await noisy(1600) }, { 'x-edit-token': d.editToken });
    let done = false;
    saving.then(() => { done = true; }, () => { done = true; });
    while (!done) {
      let m = t0;
      try { m = fs.statSync(faceFile(d.id)).mtimeMs; } catch (e) { /* being replaced */ }
      if (m !== t0) break;
      await new Promise((r) => setTimeout(r, 2));
    }
    if (!done) new Store(dir).mutate((db) => { db.designs[d.id].orderId = 'order-on-the-other-copy'; });
    const r = await saving;
    if (r.status === 200) continue; // finished before the order: nothing to check this time
    hit++;
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await r.json()).code, 'designOrdered');
    const after = onDisk(d.id);
    assert.strictEqual(after.answers.name, 'Laila', 'the approved name');
    assert.strictEqual(after.version, 1, 'the approved version');
    assert.strictEqual(after.orderId, 'order-on-the-other-copy', 'still ordered');
    assert.ok(fs.readFileSync(faceFile(d.id)).equals(faceBefore), 'the approved photo');
  }
  assert.ok(hit > 0, 'the order landed during a save at least once');
});

test('the same book saved on both copies at once: one save after the other, never one tab\'s name with the other\'s photo', async () => {
  for (let round = 0; round < 3; round++) {
    const d = await newBook(A);
    const tok = { 'x-edit-token': d.editToken };
    const [ra, rb] = await Promise.all([
      send(A, 'PUT', `/api/books/designs/${d.id}`, { answers: { ...ANSWERS, name: 'Red' }, face: await photo('#e00') }, tok),
      send(B, 'PUT', `/api/books/designs/${d.id}`, { answers: { ...ANSWERS, name: 'Blue' }, face: await photo('#00e') }, tok),
    ]);
    assert.strictEqual(ra.status, 200, await ra.clone().text());
    assert.strictEqual(rb.status, 200, await rb.clone().text());
    const versions = [(await ra.json()).version, (await rb.json()).version].sort();
    assert.deepStrictEqual(versions, [2, 3], 'two saves, two versions');
    const after = onDisk(d.id);
    assert.strictEqual(after.version, 3);
    const red = await redness(faceFile(d.id));
    assert.strictEqual(after.answers.name, red > 0 ? 'Red' : 'Blue', `name ${after.answers.name} with a ${red > 0 ? 'red' : 'blue'} photo`);
  }
});

test('a sold-out cover (admin → Products) can\'t be chosen, saved or ordered', async () => {
  const d = await newBook(A, 'space-hero', { size: 'hard' });
  assert.strictEqual(d.size.id, 'hard');
  new Store(dir).mutate((db) => { db.catalog = { ...(db.catalog || {}), products: { ...((db.catalog || {}).products || {}), storybook: { sizes: { hard: { soldOut: true } } } } }; });
  const made = await send(B, 'POST', '/api/books/space-hero/designs', { answers: ANSWERS, face: await photo('#c99'), size: 'hard' });
  assert.strictEqual(made.status, 409);
  const madeBody = await made.json();
  assert.strictEqual(madeBody.code, 'bookCoverUnavailable', 'said as a cover (QA 26 Nov, 3 pm)');
  assert.match(madeBody.error, /cover|الغلاف/);
  const saved = await send(B, 'PUT', `/api/books/designs/${d.id}`, { answers: { ...ANSWERS, name: 'Again' }, size: 'hard' }, { 'x-edit-token': d.editToken });
  assert.strictEqual(saved.status, 409);
  assert.strictEqual(onDisk(d.id).answers.name, 'Yousef', 'not saved');
  const o = await order(B, d.id);
  assert.strictEqual(o.status, 409);
  assert.strictEqual((await o.json()).code, 'bookCoverUnavailable');
  // The softcover still sells; with no cover asked for, a book gets one that can be ordered.
  const soft = await send(A, 'PUT', `/api/books/designs/${d.id}`, { answers: ANSWERS, size: 'soft' }, { 'x-edit-token': d.editToken });
  assert.strictEqual(soft.status, 200);
  assert.strictEqual((await order(A, d.id)).status, 201);
  new Store(dir).mutate((db) => { db.catalog.products.storybook = { sizes: { soft: { soldOut: true } } }; });
  const plain = await (await send(A, 'POST', '/api/books/space-hero/designs', { answers: ANSWERS, face: await photo('#c99') })).json();
  assert.strictEqual(plain.size.id, 'hard');
  new Store(dir).mutate((db) => { delete db.catalog.products.storybook; });
});

test('customer passwords: "abcd1234", "asdf1234", "11223344" and their like are refused; "mona1234" still does', () => {
  const me = { name: 'Mostafa Ali', phone: '01155554441', email: 'mostafa.ali@gmail.com' };
  for (const pw of ['abcd1234', '1234abcd', 'asdf1234', 'qwer1234', 'zxcv1234', '11223344', '99887766', 'ABCD1234']) {
    assert.strictEqual(passwords.customerPasswordProblem(pw, me), 'acctPasswordCommon', pw);
  }
  for (const pw of ['mona1234', 'ahmed2024', 'nile-river-9', '73915284', 'Garden-of-Maadi-26']) {
    assert.strictEqual(passwords.customerPasswordProblem(pw, me), null, pw);
  }
});

test('the dashboard knows why a book has no AI drawing: the customer said no, or the site\'s AI drawing is off', async () => {
  const yes = await newBook(A, 'space-hero', { aiConsent: true });
  const no = await newBook(A, 'space-hero');
  for (const d of [yes, no]) assert.strictEqual((await order(A, d.id)).status, 201);
  const { token } = await (await send(A, 'POST', '/api/admin/login', { password: 'secret' })).json();
  const items = (await (await send(A, 'GET', '/api/admin/orders', undefined, { Authorization: `Bearer ${token}` })).json()).orders.flatMap((o) => o.items);
  const of = (id) => items.find((i) => i.designId === id).redraw;
  // (No AI key in the tests: the site's AI drawing is off.)
  assert.deepStrictEqual(of(yes.id), { status: 'off', reason: 'aiOff' });
  assert.deepStrictEqual(of(no.id), { status: 'off', reason: 'noConsent' });
});
