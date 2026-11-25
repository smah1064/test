'use strict';

// The shop edits the customer's design itself (owner's request, 25 Nov): Review › "Edit the design in the editor"
// opens the job's design in a new tab of the dashboard; saved, it goes to the customer to approve with the note of
// what changed, or (an owner) prints without asking.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext } = require('./helpers');

const CUSTOMER = { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' };
const MUG = { w: 2590, h: 1049 };
let srv;
let browser;
let owner;
const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const art = (w, h, rgb = { r: 200, g: 40, b: 40 }) => sharp({ create: { width: w, height: h, channels: 4, background: { ...rgb, alpha: 1 } } }).png().toBuffer();

async function sentBackMug() {
  const created = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi', left: 200, top: 120, fontSize: 60, fill: '#c0392b', styles: [] }] } } } })).json();
  for (const name of created.files) {
    const body = name.endsWith('-print.png') ? await art(MUG.w, MUG.h) : name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52);
    await fetch(`${srv.base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
  }
  const d = await (await fetch(`${srv.base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
  const proof = await (await fetch(`${srv.base}/api/designs/${d.id}/proof`)).json();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json();
  const back = await post(`/api/admin/items/${o.items[0].id}/review`, { action: 'reopen', note: 'Text too close to the handle' }, { Authorization: `Bearer ${owner}` });
  assert.strictEqual(back.status, 200, await back.text());
  return o;
}

test.before(async () => {
  srv = await startServer();
  owner = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

async function openInEditor(ctx, it) {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${srv.base}/admin`);
  await page.fill('#password', 'secret');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#dash:not([hidden])');
  await page.click('[data-tab="review"]');
  await page.waitForSelector(`#rv-${it.id}`);
  await page.click(`[data-rv-toggle="${it.id}"]`);
  await page.waitForSelector(`[data-rv-shopedit="${it.id}"]`);
  const [ed] = await Promise.all([ctx.waitForEvent('page'), page.click(`[data-rv-shopedit="${it.id}"]`)]);
  const errors = [];
  ed.on('pageerror', (e) => errors.push(String(e)));
  ed.on('dialog', (d) => d.accept().catch(() => {}));
  ed.errors = errors;
  await ed.waitForFunction(() => window.__editor && window.__editor.st && window.__editor.st.shopEdit && window.__editor.st.shopEdit.owner, null, { timeout: 30000 });
  return { page, ed };
}

test('Review › Edit the design in the editor › Send to the customer: a new proof with the note', { timeout: 150000 }, async () => {
  const o = await sentBackMug();
  const it = o.items[0];
  const ctx = await newContext(browser);
  const { ed } = await openInEditor(ctx, it);
  assert.match(await ed.textContent('#add-to-cart'), /Save the shop’s edit/);
  assert.strictEqual(await ed.isHidden('#save-draft'), true);
  // The shop moves the text, then saves.
  await ed.evaluate(() => { const o = window.__editor.canvas.getObjects().find((x) => x.text === 'Hi'); o.set({ left: o.left + 30 }); o.setCoords(); window.__editor.canvas.fire('object:modified', { target: o }); });
  await ed.click('#add-to-cart');
  await ed.waitForSelector('#shop-edit-ask:not([hidden])');
  // No note: said.
  await ed.click('#shop-edit-send');
  await ed.waitForSelector('#shop-edit-msg:not([hidden])');
  await ed.fill('#shop-edit-note', 'Moved the text away from the handle');
  const closed = ed.waitForEvent('close').catch(() => null);
  await ed.click('#shop-edit-send');
  await closed;
  const pub = (await (await fetch(`${srv.base}/api/orders/${o.id}?k=${o.key}`)).json()).items[0];
  assert.strictEqual(pub.status, 'awaiting_approval');
  assert.notStrictEqual(pub.designId, it.designId);
  assert.strictEqual(pub.review.note, 'Moved the text away from the handle');
  assert.deepStrictEqual(ed.errors, []);
});

test('…or printed without asking (an owner): straight to the print queue', { timeout: 150000 }, async () => {
  const o = await sentBackMug();
  const it = o.items[0];
  const ctx = await newContext(browser);
  const { ed } = await openInEditor(ctx, it);
  await ed.click('#add-to-cart');
  await ed.waitForSelector('#shop-edit-ask:not([hidden])');
  assert.match(await ed.textContent('#shop-edit-print'), /Print without asking the customer/);
  await ed.fill('#shop-edit-note', 'Same design, colour profile fixed only');
  const closed = ed.waitForEvent('close').catch(() => null);
  await ed.click('#shop-edit-print');
  await closed;
  const pub = (await (await fetch(`${srv.base}/api/orders/${o.id}?k=${o.key}`)).json()).items[0];
  assert.strictEqual(pub.status, 'queued');
  assert.strictEqual(pub.approval.by, 'shop');
});
