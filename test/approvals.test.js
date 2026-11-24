'use strict';

// Proofs and approvals: the customer approves a specific version at checkout,
// production files are kept and fingerprinted, a material change asks for a
// new approval, and complex or flagged jobs go to a person first.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const OPEN = { max: 1e6, ms: 1000 };
const LIMITS = { designs: [OPEN], orders: [OPEN], mergeParse: [OPEN] };
const CUSTOMER = { name: 'ليلى سمير', phone: '01055556666', governorate: 'cairo', city: 'المعادي', address: '3 شارع 9' };
let server;
let base;
let dataDir;
let token = null;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-approval-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: LIMITS, cleanupEvery: 0 });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function admin(url, opts = {}) {
  if (!token) token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
  return fetch(base + url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
}
const adminJson = (url, body) => admin(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Mug wrap: 4 in x 3.5 in, no bleed. At 300 DPI: 1200 x 1050.
const MUG = { w: 1200, h: 1050 };
/** Clear print file with an opaque block well inside the safe area. */
const art = (w, h, rgb = { r: 200, g: 40, b: 40 }) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { ...rgb, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
  .png().toBuffer();

async function makeDesign(body, print) {
  const res = await post('/api/designs', { productId: 'mug', color: 'white', size: '11oz', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } }, ...body });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const created = await res.json();
  for (const name of created.files) {
    let data = await art(60, 52);
    if (name.endsWith('-print.png')) data = print || await art(MUG.w, MUG.h);
    if (name.endsWith('.svg')) data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const r = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body: data });
    assert.strictEqual(r.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}
const proofOf = async (id) => (await fetch(`${base}/api/designs/${id}/proof`)).json();
async function order(ids, approvals) {
  const q = await (await post('/api/cart/quote', { designIds: ids })).json();
  return post('/api/orders', { customer: CUSTOMER, designIds: ids, expectedTotal: q.total, ...(approvals ? { approvals } : {}) });
}

test('the proof shows product, size, sides with physical size, the artwork and the checks', async () => {
  const d = await makeDesign({});
  const p = await proofOf(d.id);
  assert.strictEqual(p.designId, d.id);
  assert.strictEqual(p.proofHash, 'v1');
  assert.strictEqual(p.version, 1);
  assert.strictEqual(p.product.id, 'mug');
  assert.strictEqual(p.size.id, '11oz');
  assert.strictEqual(p.sides.length, 1);
  const s = p.sides[0];
  assert.strictEqual(s.widthPx, MUG.w);
  assert.strictEqual(s.heightPx, MUG.h);
  assert.strictEqual(s.dpi, 300);
  assert.ok(Math.abs(s.widthIn - 4) < 0.01);
  // The artwork is the production file itself (scaled down), transparent where nothing prints.
  const pic = await fetch(base + s.artworkUrl);
  assert.strictEqual(pic.status, 200);
  const meta = await sharp(Buffer.from(await pic.arrayBuffer())).metadata();
  assert.strictEqual(meta.hasAlpha, true);
  assert.strictEqual(Math.round((meta.width / meta.height) * 100), Math.round((MUG.w / MUG.h) * 100));
  assert.strictEqual(p.preflight.status, 'pass', JSON.stringify(p.preflight));
  assert.deepStrictEqual(p.review, { needed: false, reasons: [] });
});

test('checkout: every item approved against its current proof, recorded with the version', async () => {
  const d = await makeDesign({});
  const p = await proofOf(d.id);
  // No approval: refused.
  let r = await order([d.id]);
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /approve|وافق/);
  // An approval of another version: refused, the customer sees the new proof.
  r = await order([d.id], { [d.id]: { proofHash: 'v7' } });
  assert.strictEqual(r.status, 409);
  // The current proof: the order goes straight to the print queue.
  r = await order([d.id], { [d.id]: { proofHash: p.proofHash } });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const o = await r.json();
  const it = o.items[0];
  assert.strictEqual(it.status, 'queued');
  assert.strictEqual(it.approval.proofHash, p.proofHash);
  assert.strictEqual(it.approval.version, 1);
  assert.strictEqual(it.approval.via, 'checkout');
  assert.ok(it.approval.at);
  // The shop can download the approved production file.
  const f = await admin(`/api/admin/files/${d.id}/front`);
  assert.strictEqual(f.status, 200);
});

test('flagged jobs go to a person first: failed checks, a sample, a big run', async () => {
  // A print file far too small for the mug fails the resolution check.
  const low = await makeDesign({}, await art(300, 262));
  const lowProof = await proofOf(low.id);
  assert.strictEqual(lowProof.preflight.status, 'fail');
  assert.ok(lowProof.preflight.checks.some((c) => c.id === 'resolution' && c.level === 'fail'));
  assert.deepStrictEqual(lowProof.review.reasons, ['preflight']);
  // The editor's own checks (a font that didn't load) are part of the proof.
  const font = await makeDesign({ clientChecks: [{ id: 'fontFallback', level: 'warn', params: { fonts: ['Cairo'] } }, { id: 'evil', level: 'fail' }] });
  const fontProof = await proofOf(font.id);
  assert.strictEqual(fontProof.preflight.status, 'warn');
  assert.deepStrictEqual(fontProof.preflight.checks.map((c) => c.id), ['fontFallback']);
  // Several pieces with a printed sample first.
  const many = await makeDesign({ quantities: [{ color: 'white', size: '11oz', qty: 6 }] });
  const manyProof = await proofOf(many.id);
  const r = await order([low.id, font.id, many.id], {
    [low.id]: { proofHash: lowProof.proofHash },
    [font.id]: { proofHash: fontProof.proofHash },
    [many.id]: { proofHash: manyProof.proofHash, sample: true },
  });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const o = await r.json();
  assert.strictEqual(o.status, 'in_review');
  const [a, b, c] = o.items;
  assert.strictEqual(a.status, 'review');
  assert.deepStrictEqual(a.review.reasons, ['preflight']);
  assert.strictEqual(b.status, 'queued', 'a warning alone does not hold the job');
  assert.strictEqual(c.status, 'review');
  assert.deepStrictEqual(c.review.reasons, ['sample']);
  assert.strictEqual(c.approval.sample, true);
  // Nothing in review can be printed or downloaded for production.
  assert.strictEqual((await admin(`/api/admin/files/${low.id}/front`)).status, 409);
  const st = await admin(`/api/admin/items/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'printing' }) });
  assert.strictEqual(st.status, 409);
  // The preview PDF (what the customer designed) is still available.
  assert.strictEqual((await admin(`/api/admin/files/${low.id}/front?format=preview-pdf`)).status, 200);
  // The review list holds the two jobs, with their proofs.
  const list = await (await admin('/api/admin/review')).json();
  const ids = list.items.map((x) => x.id);
  assert.ok(ids.includes(a.id) && ids.includes(c.id) && !ids.includes(b.id));
  // The shop approves the sample job: the customer already approved these files, so it prints.
  const ok = await adminJson(`/api/admin/items/${c.id}/review`, { action: 'approve', note: 'Sample first, then the rest' });
  assert.strictEqual(ok.status, 200, await ok.clone().text());
  assert.strictEqual((await ok.json()).status, 'queued');
  assert.strictEqual((await admin(`/api/admin/files/${many.id}/front`)).status, 200);
  // Asking for changes needs a note.
  assert.strictEqual((await adminJson(`/api/admin/items/${a.id}/review`, { action: 'changes' })).status, 400);
  const ch = await adminJson(`/api/admin/items/${a.id}/review`, { action: 'changes', note: 'The photo is too small for a mug.' });
  assert.strictEqual(ch.status, 200);
  assert.strictEqual((await ch.json()).status, 'changes_requested');
  const pub = await (await fetch(`${base}/api/orders/${o.id}`)).json();
  assert.strictEqual(pub.items[0].status, 'changes_requested');
});

test('a corrected file is a new version: kept apart, approved again by the customer', async () => {
  const d = await makeDesign({ quantities: [{ color: 'white', size: '11oz', qty: 60 }] });
  const p1 = await proofOf(d.id);
  assert.deepStrictEqual(p1.review.reasons, ['bulk']);
  const o = await (await order([d.id], { [d.id]: { proofHash: p1.proofHash } })).json();
  const it = o.items[0];
  assert.strictEqual(it.status, 'review');
  const v1 = fs.readFileSync(path.join(dataDir, 'files', d.id, 'front-print.png'));

  // A corrected print file must be the same size.
  const put = (buf) => admin(`/api/admin/items/${it.id}/replacement/front`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: buf });
  assert.strictEqual((await put(await art(600, 525))).status, 400);
  const rep = await put(await art(MUG.w, MUG.h, { r: 20, g: 120, b: 40 }));
  assert.strictEqual(rep.status, 200, await rep.clone().text());
  const after = await rep.json();
  assert.strictEqual(after.status, 'awaiting_approval');
  // The old file is preserved, the new proof has a new version.
  assert.deepStrictEqual(fs.readFileSync(path.join(dataDir, 'files', d.id, 'front-print.v1.png')), v1);
  const p2 = await proofOf(d.id);
  assert.strictEqual(p2.version, 2);
  assert.notStrictEqual(p2.proofHash, p1.proofHash);
  assert.strictEqual(p2.sides[0].previewUrl, null, 'the old mockup is not shown with the new file');
  // Not printable until the customer approves the new version.
  assert.strictEqual((await admin(`/api/admin/files/${d.id}/front`)).status, 409);

  // The customer's link: the order page gives it while approval is waited for.
  const pub = await (await fetch(`${base}/api/orders/${o.id}`)).json();
  const link = pub.items[0].proofUrl;
  assert.match(link, /^\/proof\?t=/);
  const t = link.split('t=')[1];
  const view = await (await fetch(`${base}/api/proofs/${t}`)).json();
  assert.strictEqual(view.proof.version, 2);
  assert.strictEqual(view.status, 'awaiting_approval');
  // An approval of the old version is refused; a bad decision too.
  assert.strictEqual((await post(`/api/proofs/${t}`, { decision: 'approve', proofHash: p1.proofHash })).status, 409);
  assert.strictEqual((await post(`/api/proofs/${t}`, { decision: 'maybe' })).status, 400);
  const yes = await post(`/api/proofs/${t}`, { decision: 'approve', proofHash: p2.proofHash });
  assert.strictEqual(yes.status, 200);
  assert.strictEqual((await yes.json()).status, 'queued');
  // The link is used up.
  assert.strictEqual((await fetch(`${base}/api/proofs/${t}`)).status, 404);
  const final = (await (await fetch(`${base}/api/orders/${o.id}`)).json()).items[0];
  assert.strictEqual(final.approval.version, 2);
  assert.strictEqual(final.approval.via, 'proof-link');
  assert.deepStrictEqual(final.approvals.map((a) => a.action), ['approved', 'changes', 'approved']);
  assert.strictEqual((await admin(`/api/admin/files/${d.id}/front`)).status, 200);
});

test('the customer can turn down a new proof with a comment', async () => {
  const d = await makeDesign({ quantities: [{ color: 'white', size: '11oz', qty: 50 }] });
  const o = await (await order([d.id], { [d.id]: { proofHash: (await proofOf(d.id)).proofHash } })).json();
  const it = o.items[0];
  await admin(`/api/admin/items/${it.id}/replacement/front`, { method: 'PUT', body: await art(MUG.w, MUG.h, { r: 9, g: 9, b: 9 }) });
  const re = await (await adminJson(`/api/admin/items/${it.id}/resend-proof`, {})).json();
  assert.match(re.proofLink, /^\/proof\?t=/);
  const t = re.proofLink.split('t=')[1];
  const no = await post(`/api/proofs/${t}`, { decision: 'reject', comment: 'Please keep the red colour' });
  assert.strictEqual(no.status, 200);
  assert.strictEqual((await no.json()).status, 'changes_requested');
  const item = (await (await fetch(`${base}/api/orders/${o.id}`)).json()).items[0];
  assert.strictEqual(item.approval, null);
  assert.strictEqual(item.approvals.at(-1).note, 'Please keep the red colour');
  assert.strictEqual((await admin(`/api/admin/files/${d.id}/front`)).status, 409);
});

test('proof emails go in the customer\'s language and never throw', async () => {
  const notify = require('../src/notify');
  const r = await notify.proofMessage({ number: 'POD-1', lang: 'ar', customer: {} }, { productName: { en: 'Mug', ar: 'مج' } }, { kind: 'proof', link: 'https://x.test/proof?t=a' });
  assert.deepStrictEqual(r, { email: 'skipped', reason: 'noEmail' });
  const r2 = await notify.proofMessage(null, null, {});
  assert.strictEqual(r2.email, 'skipped');
});

test('a replaced print file also renews the DTF film and DTG files, and the old vector file is no longer offered', async () => {
  const d = await makeDesign({ quantities: [{ color: 'white', size: '11oz', qty: 60 }] });
  const o = await (await order([d.id], { [d.id]: { proofHash: (await proofOf(d.id)).proofHash } })).json();
  const it = o.items[0];
  assert.strictEqual((await adminJson(`/api/admin/items/${it.id}/review`, { action: 'approve' })).status, 200);
  const get = async (fmt) => admin(`/api/admin/files/${d.id}/front?format=${fmt}`);
  const before = {};
  for (const f of ['dtf-film', 'dtg-white']) {
    const r = await get(f);
    assert.strictEqual(r.status, 200, f);
    before[f] = Buffer.from(await r.arrayBuffer());
  }
  assert.strictEqual((await get('svg')).status, 200);
  // A different colour and shape (the DTG white layer follows the shape).
  const fresh = await sharp({ create: { width: MUG.w, height: MUG.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 300, height: 300, channels: 4, background: { r: 10, g: 60, b: 220, alpha: 1 } } }, left: 450, top: 375 }]).png().toBuffer();
  assert.strictEqual((await admin(`/api/admin/items/${it.id}/replacement/front`, { method: 'PUT', body: fresh })).status, 200);
  const re = await (await adminJson(`/api/admin/items/${it.id}/resend-proof`, {})).json();
  const t = re.proofLink.split('t=')[1];
  assert.strictEqual((await post(`/api/proofs/${t}`, { decision: 'approve', proofHash: (await proofOf(d.id)).proofHash })).status, 200);
  for (const f of ['dtf-film', 'dtg-white']) {
    const r = await get(f);
    assert.strictEqual(r.status, 200, f);
    assert.ok(!before[f].equals(Buffer.from(await r.arrayBuffer())), `${f} made again from the new file`);
  }
  assert.strictEqual((await get('svg')).status, 404);
  const side = (await (await admin('/api/admin/orders')).json()).orders.find((x) => x.id === o.id).items[0].sides[0];
  assert.strictEqual(side.hasSvg, false);
});

test('printing houses are told every size and the number of pieces', () => {
  const dispatch = require('../src/dispatch');
  const order = { number: 'POD-1003', items: [{}] };
  const base = { position: 1, productName: { en: 'T-shirt', ar: 'تيشيرت' }, process: 'dtf', color: { name: { en: 'Black', ar: 'أسود' } }, size: { label: { en: 'M', ar: 'M' } } };
  const args = { house: { name: 'X' }, order, design: { sides: [] }, files: [], lang: 'en', expires: '2026-12-24T00:00:00Z' };
  const mixed = dispatch.whatsappText({ ...args, item: { ...base, copies: 3, quantities: [{ color: { name: { en: 'Black' } }, size: { label: { en: 'S' } }, qty: 2 }, { color: { name: { en: 'Black' } }, size: { label: { en: '2XL' } }, qty: 1 }] } });
  assert.match(mixed, /Black · S ×2، Black · 2XL ×1/);
  assert.match(mixed, /\*Quantity:\* 3/);
  assert.doesNotMatch(mixed, /Black · M/);
  assert.match(dispatch.whatsappText({ ...args, item: { ...base, copies: 4 } }), /\*Quantity:\* 4/);
  assert.match(dispatch.whatsappText({ ...args, item: base }), /\*Quantity:\* 1/);
});

test('accounts: "sold" counts pieces, not order lines', () => {
  const accounting = require('../src/accounting');
  const it = (id, extra) => ({ id, productId: 'tshirt', productName: { en: 'T' }, price: 100, status: 'queued', sides: [{}], ...extra });
  const orders = [{ id: 'o1', number: 1, createdAt: new Date().toISOString(), customer: { name: 'x' }, items: [it('a'), it('b', { copies: 5, quantities: [{ size: { id: 'S' }, qty: 2 }, { size: { id: 'L' }, qty: 3 }] }), it('c', { copies: 3 })], subtotal: 300, shipping: 0, total: 300 }];
  const r = accounting.report({ orders, costs: {}, expenses: [], settings: {} });
  assert.strictEqual(r.products.find((p) => p.productId === 'tshirt').units, 9);
});
