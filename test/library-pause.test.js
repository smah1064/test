'use strict';

// Ready designs in the admin: pause (out of the shop for now) and delete (out of the shop and the
// main list, can be brought back), one or many at once; and the one-time pause of the starter designs
// made only of text, shapes and icons (server.js runs it for the real shop).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { Library, SEED, usesArtwork } = require('../src/library');

const withServer = async (opts, fn) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libpause-'));
  const app = createApp({ dataDir, adminPassword: 'secret-owner-pass', cleanupEvery: 0, requireApproval: false, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-owner-pass' }) })).json()).token;
  const admin = (url, method = 'GET', body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    await fn({ base, admin, dataDir });
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
};
const shopIds = async (base) => new Set((await (await fetch(`${base}/api/library`)).json()).designs.map((d) => d.id));

test('the starter designs: 149 drawn with real artwork, the rest only text, shapes and icons', () => {
  assert.strictEqual(SEED.filter(usesArtwork).length, 149);
  assert.strictEqual(SEED.length - SEED.filter(usesArtwork).length, 410);
});

test('pause, delete and bring back one design, or many at once', async () => {
  await withServer({}, async ({ base, admin }) => {
    const all = (await (await admin('/api/admin/library')).json()).designs;
    assert.ok(all.every((d) => d.hidden === false && d.deleted === false));
    assert.ok(all.some((d) => d.artwork) && all.some((d) => !d.artwork));
    const [a, b, c] = all.map((d) => d.id);
    // Pause one: gone from the shop, still in the admin as paused.
    assert.strictEqual((await admin(`/api/admin/library/${a}`, 'PATCH', { hidden: true })).status, 200);
    assert.ok(!(await shopIds(base)).has(a));
    assert.strictEqual((await fetch(`${base}/api/library/${a}`)).status, 404);
    // Delete another (a starter design): gone from the shop, marked deleted, can come back.
    assert.strictEqual((await admin(`/api/admin/library/${b}`, 'DELETE')).status, 200);
    let list = (await (await admin('/api/admin/library')).json()).designs;
    assert.ok(list.find((d) => d.id === b).deleted);
    assert.ok(!(await shopIds(base)).has(b));
    assert.strictEqual((await admin(`/api/admin/library/${b}`, 'PATCH', { deleted: false })).status, 200);
    assert.ok((await shopIds(base)).has(b));
    // A paused design that is deleted and brought back is still paused.
    await admin(`/api/admin/library/${a}`, 'PATCH', { deleted: true });
    await admin(`/api/admin/library/${a}`, 'PATCH', { deleted: false });
    list = (await (await admin('/api/admin/library')).json()).designs;
    assert.deepStrictEqual([list.find((d) => d.id === a).hidden, list.find((d) => d.id === a).deleted], [true, false]);
    // Many at once; unknown ids are skipped.
    const r = await (await admin('/api/admin/library', 'PATCH', { ids: [a, b, c, 'no-such-design'], hidden: false })).json();
    assert.strictEqual(r.changed, 3);
    const shop = await shopIds(base);
    assert.ok([a, b, c].every((id) => shop.has(id)));
    // Bad requests.
    assert.strictEqual((await admin('/api/admin/library', 'PATCH', { ids: [], hidden: true })).status, 400);
    assert.strictEqual((await admin('/api/admin/library', 'PATCH', { ids: [a] })).status, 400);
    assert.strictEqual((await admin('/api/admin/library', 'PATCH', { ids: [a], deleted: 'yes' })).status, 400);
    assert.strictEqual((await admin('/api/admin/library/no-such-design', 'PATCH', { hidden: true })).status, 404);
    assert.strictEqual((await fetch(`${base}/api/admin/library`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [a], hidden: true }) })).status, 401);
  });
});

test('the real shop: artwork designs only where there are some, text-only ones on the other products', async () => {
  await withServer({ libraryOnce: ['pause-no-artwork'] }, async ({ base, admin, dataDir }) => {
    const shop = (await (await fetch(`${base}/api/library`)).json()).designs;
    const ids = new Set(shop.map((d) => d.id));
    assert.ok(SEED.filter(usesArtwork).every((d) => ids.has(d.id)), 'the 87 with artwork stay');
    const on = (pid) => shop.filter((d) => (d.products || []).includes(pid));
    const text = (d) => !usesArtwork(SEED.find((x) => x.id === d.id) || {});
    // A T-shirt and a mug: only artwork designs. Business cards, invitations, cake toppers: their text designs stay.
    assert.ok(on('tshirt').length >= 80 && on('tshirt').every((d) => !text(d)));
    assert.ok(on('mug').length && on('mug').every((d) => !text(d)));
    for (const pid of ['bizcards', 'invitations', 'caketopper', 'engrplaque']) assert.ok(on(pid).some(text), pid);
    // Every design is shown on a product it is offered on.
    assert.ok(shop.every((d) => !d.products || d.products.includes(d.product)), 'shown on one of its products');
    const list = await (await admin('/api/admin/library')).json();
    assert.strictEqual(list.settings.textOnlyLimited, true);
    const paused = list.designs.filter((d) => d.hidden);
    assert.ok(paused.length > 50 && paused.every((d) => !d.artwork), 'text-only designs left with no product are paused');
    assert.ok(list.designs.some((d) => d.limited && !d.hidden));
    // Shown again by the owner: a restart doesn't pause it again.
    const back = paused[0].id;
    await admin(`/api/admin/library/${back}`, 'PATCH', { hidden: false });
    const again = new Library(dataDir);
    again.runOnce(['pause-no-artwork']);
    assert.ok(!again.all().find((d) => d.id === back).hidden);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'library', 'index.json'), 'utf8')).done.includes('pause-no-artwork'));
    // The rule off: text-only designs are offered everywhere again (the paused ones stay paused).
    assert.strictEqual((await admin('/api/admin/library/settings', 'PUT', { textOnlyLimited: 'no' })).status, 400);
    assert.strictEqual((await (await admin('/api/admin/library/settings', 'PUT', { textOnlyLimited: false })).json()).textOnlyLimited, false);
    const all = (await (await fetch(`${base}/api/library`)).json()).designs;
    assert.ok(all.filter((d) => (d.products || []).includes('tshirt')).some(text));
    assert.ok(!all.some((d) => d.id === paused[1].id));
  });
});

test('artwork needs enough designs on a product; the owner\'s text-only design is text-only; a design on no product is not shown', async () => {
  const { productsFor, ARTWORK_ENOUGH } = require('../src/library');
  // The live shop's first run (one artwork design was enough): brought back where products now have room.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libenough-'));
  try {
    fs.mkdirSync(path.join(dataDir, 'library'), { recursive: true });
    const once = new Set();
    for (const d of SEED) if (usesArtwork(d)) productsFor(d).forEach((id) => once.add(id));
    const hidden = SEED.filter((d) => !usesArtwork(d) && productsFor(d).every((id) => once.has(id))).map((d) => d.id);
    fs.writeFileSync(path.join(dataDir, 'library', 'index.json'), JSON.stringify({ hidden, deleted: [], custom: [], done: ['pause-no-artwork'], textOnlyLimited: true }));
    const lib = new Library(dataDir);
    lib.runOnce(['pause-no-artwork', 'unpause-artwork-enough']);
    const shown = lib.visible();
    const on = (pid) => shown.filter((d) => d.products.includes(pid));
    assert.ok(lib.all().filter((d) => d.hidden).length < hidden.length, 'some brought back');
    assert.ok(on('greetingcard').length > 50, 'greeting cards are not left nearly empty');
    assert.ok(on('tshirt').every((d) => usesArtwork(d)) && on('tshirt').length >= ARTWORK_ENOUGH);
    assert.ok(usesArtwork(shown[0]), 'designs with artwork come first');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  await withServer({ libraryOnce: ['pause-no-artwork'] }, async ({ base, admin }) => {
    // A text-only design the rule leaves on no product: shown in the admin, never opened in the shop.
    const list = (await (await admin('/api/admin/library')).json()).designs;
    const none = list.find((d) => d.hidden && !d.artwork);
    await admin(`/api/admin/library/${none.id}`, 'PATCH', { hidden: false });
    const again = (await (await admin('/api/admin/library')).json()).designs.find((d) => d.id === none.id);
    if (again.limited && !again.products.length) assert.strictEqual((await fetch(`${base}/api/library/${none.id}`)).status, 404);
  });
});

test('frozen: new picture designs never hide text designs; the owner decides (25 Nov)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libfreeze-'));
  try {
    const lib = new Library(dataDir);
    lib.runOnce(['pause-no-artwork', 'unpause-artwork-enough', 'freeze-text-rule']);
    const textOn = (pid) => lib.visible().filter((d) => !usesArtwork(d) && d.kind !== 'objects' && !d.uploaded && d.products.includes(pid)).length;
    const before = textOn('apron');
    assert.ok(before > 20, 'the apron shows its text designs');
    assert.strictEqual(textOn('tshirt'), 0, 'T-shirts show only picture designs');
    // Twelve picture designs uploaded for aprons: its text designs stay.
    for (let i = 0; i < 12; i++) {
      lib.addUploaded({ id: `u-${String(i).padStart(12, '0')}`, kind: 'template', uploaded: true, category: 'funny', name: { en: `P${i}`, ar: `P${i}` }, product: 'apron', color: 'white', products: ['apron'], aspect: 0.75, items: [{ kind: 'image', src: `/library-art/u-${String(i).padStart(12, '0')}/web.png`, fit: 0.92, x: 0.5, y: 0.5, w: 0.92 }] });
    }
    assert.strictEqual(textOn('apron'), before);
    assert.strictEqual(lib.visible().filter((d) => d.uploaded && d.products.includes('apron')).length, 12);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('automatic steps never undo a pause or show the owner made by hand', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libhand-'));
  try {
    // As the live shop was before the freeze: the first two steps done, the owner then pausing some
    // text designs by hand, and showing one that had been paused automatically.
    const lib = new Library(dataDir);
    lib.runOnce(['pause-no-artwork', 'unpause-artwork-enough']);
    delete lib.index.textHiddenOn;
    lib.save();
    const text = lib.all().filter((d) => !usesArtwork(d) && d.kind !== 'objects' && !d.uploaded && !d.hidden);
    const mine = text.slice(0, 40).map((d) => d.id);
    lib.setFlags(mine, { hidden: true });
    const autoPaused = lib.all().find((d) => d.hidden && !mine.includes(d.id));
    lib.setFlags([autoPaused.id], { hidden: false });
    lib.runOnce(['pause-no-artwork', 'unpause-artwork-enough', 'freeze-text-rule']);
    const hidden = new Set(lib.all().filter((d) => d.hidden).map((d) => d.id));
    assert.deepStrictEqual(mine.filter((id) => !hidden.has(id)), [], 'the owner\'s pauses stay');
    assert.ok(!hidden.has(autoPaused.id), 'the one shown by hand stays shown');
    // Also in a fresh shop where the first step runs after a hand choice.
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-libhand2-'));
    try {
      const fresh = new Library(dir2);
      const target = SEED_TEXT_ON_TSHIRT(fresh);
      fresh.setFlags([target], { hidden: false });
      fresh.runOnce(['pause-no-artwork']);
      assert.ok(!fresh.all().find((d) => d.id === target).hidden, 'shown by hand before the first step: stays shown');
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
/** A text-only starter design that goes only on picture-design products (the first step would pause it). */
function SEED_TEXT_ON_TSHIRT(lib) {
  const d = lib.all().find((x) => !usesArtwork(x) && x.kind !== 'objects' && !x.uploaded && x.products && x.products.length && x.products.every((p) => ['tshirt', 'hoodie', 'mug', 'sweatshirt', 'oversized', 'tote'].includes(p)));
  return d ? d.id : lib.all().find((x) => !usesArtwork(x)).id;
}

test('every design in the admin list says the day it was added', async () => {
  await withServer({}, async ({ admin }) => {
    const list = (await (await admin('/api/admin/library')).json()).designs;
    assert.ok(list.length > 500);
    assert.ok(list.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.addedOn || '')), 'a day for every design');
  });
});
