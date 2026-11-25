'use strict';

// "Problem with this file?" on an approved job in the print queue: back to Review with the team's reason; there,
// replacing the file needs a note of what changed (owner's request, 25 Nov).
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext } = require('./helpers');

const CUSTOMER = { name: 'Mona Ali', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '12 Abbas El Akkad St' };
const MUG = { w: 2590, h: 1049 };
let srv;
let browser;
const post = (url, body, headers = {}) => fetch(srv.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const art = (w, h, rgb = { r: 200, g: 40, b: 40 }) => sharp({ create: { width: w, height: h, channels: 4, background: { ...rgb, alpha: 1 } } }).png().toBuffer();

async function approvedMug() {
  const created = await (await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } })).json();
  for (const name of created.files) {
    const body = name.endsWith('-print.png') ? await art(MUG.w, MUG.h) : name.endsWith('.svg') ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') : await art(60, 52);
    await fetch(`${srv.base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
  }
  const d = await (await fetch(`${srv.base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } })).json();
  const proof = await (await fetch(`${srv.base}/api/designs/${d.id}/proof`)).json();
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  const o = await (await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } })).json();
  return o;
}

test.before(async () => {
  srv = await startServer();
  browser = await loadPlaywright().chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

test('an approved job goes back to Review from the print queue, and a replaced file needs a note of what changed', { timeout: 120000 }, async () => {
  const o = await approvedMug();
  const it = o.items[0];
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(`${srv.base}/admin`);
  await page.fill('#password', 'secret');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#dash:not([hidden])');
  // The waiting list: open the job's details, then "Problem with this file?".
  await page.waitForSelector(`[data-toggle-item="${it.id}"]`);
  await page.click(`[data-toggle-item="${it.id}"]`);
  await page.click(`[data-back-open="${it.id}"]`);
  await page.waitForSelector(`#back-why-${it.id}`);
  assert.strictEqual(await page.evaluate((id) => document.activeElement && document.activeElement.id === `back-why-${id}`, it.id), true, 'the reason box has the keyboard');
  // No reason: said, nothing sent.
  await page.click(`[data-back-send="${it.id}"]`);
  await page.waitForFunction(() => document.body.innerText.includes("Write what's wrong first."));
  await page.fill(`#back-why-${it.id}`, 'The logo is too close to the handle.');
  await page.click(`[data-back-send="${it.id}"]`);
  await page.waitForFunction((id) => !document.querySelector(`[data-toggle-item="${id}"]`), it.id);
  await page.waitForFunction(() => document.body.innerText.includes('Sent back to Review.'));

  // Review: the reason is shown to the team.
  await page.click('[data-tab="review"]');
  await page.waitForSelector(`#rv-${it.id}`);
  assert.match(await page.textContent(`#rv-${it.id}`), /Sent back by the shop after the customer approved it: The logo is too close to the handle\./);
  // Replacing the file without a note: refused, with what to do.
  await page.click(`[data-rv-toggle="${it.id}"]`);
  await page.waitForSelector(`[data-rv-file="${it.id}"]`);
  const fixed = await art(MUG.w, MUG.h, { r: 20, g: 20, b: 20 });
  await page.setInputFiles(`[data-rv-file="${it.id}"]`, { name: 'fixed.png', mimeType: 'image/png', buffer: fixed });
  await page.waitForFunction(() => document.body.innerText.includes('Write what you changed in "Note to the customer" first'));
  // With the note: the customer gets the new proof with it.
  await page.fill(`#rv-note-${it.id}`, 'We moved the logo away from the handle.');
  await page.setInputFiles(`[data-rv-file="${it.id}"]`, { name: 'fixed.png', mimeType: 'image/png', buffer: fixed });
  await page.waitForFunction((id) => /awaiting|Waiting/i.test((document.getElementById(`rv-${id}`) || {}).textContent || ''), it.id, { timeout: 30000 });
  const pub = await (await fetch(`${srv.base}/api/orders/${o.id}?k=${o.key}`)).json();
  assert.strictEqual(pub.items[0].status, 'awaiting_approval');
  assert.strictEqual(pub.items[0].approvals.at(-1).note, 'We moved the logo away from the handle.');
  assert.ok(!JSON.stringify(pub).includes('too close to the handle'), 'the team\'s reason stays with the team');
  assert.deepStrictEqual(errors, []);
  await ctx.close();
});
