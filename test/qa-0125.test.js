'use strict';

// QA fixes:
//  - booklets: one design is one page count. The "How many?" grid and the server never take
//    another size (an 8-page design ordered as 32 pages would print 24 blank pages);
//  - cake-topper ready designs: the stakes hang from the bar, below the words, at a sturdy width
//    (they used to come out twice as long and run up through the lettering).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { PRODUCTS } = require('../src/products');
const { designs } = require('../src/library-packs/laser');

const OPEN = { max: 1e6, ms: 1000 };
let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa0125-'));
  const app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('booklets: the size is the page count, so a design is never mixed with other sizes', async () => {
  const paged = PRODUCTS.filter((p) => p.paged);
  assert.ok(paged.some((p) => p.id === 'booklets'));
  for (const p of paged) assert.strictEqual(p.mix.sizes, false, `${p.id}: one page count per design`);
  // The cover finish is not part of the pages: matte and glossy covers of one design are fine.
  assert.strictEqual(PRODUCTS.find((p) => p.id === 'booklets').mix.colors, true);

  const sides = { front: { editor: { objects: [{ type: 'i-text', text: 'Cover' }] } } };
  const order = (quantities) => post('/api/designs', { productId: 'booklets', color: 'matte', size: '8-50', sides, quantities });
  // Another page count (32 pages × 100 copies) or the same pages in another number of copies: refused.
  for (const size of ['32-100', '16-50', '8-100']) {
    const r = await order([{ color: 'matte', size: '8-50', qty: 1 }, { color: 'matte', size, qty: 1 }]);
    assert.strictEqual(r.status, 400, size);
    assert.strictEqual((await r.json()).code, 'qtyOnePageCount');
  }
  // More copies of the chosen size, in both cover finishes: accepted.
  const ok = await order([{ color: 'matte', size: '8-50', qty: 2 }, { color: 'gloss', size: '8-50', qty: 1 }]);
  assert.strictEqual(ok.status, 201, await ok.clone().text());
});

/*
 * Where a template's line lands, as public/js/templates.js draws it: the shape is turned first
 * and then scaled so its bounding box is U × w wide (Fabric's scaleToWidth, whose bounds count a
 * stroke width of 1). So a standing line's `w` sets its thickness. Sizes are fractions of the
 * area's width; on the cake topper (U = the area's width) a length L covers L × aspect of its height.
 */
const LINE = (() => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/templates.js'), 'utf8');
  const m = /line: \{[^\n]*new fabric\.Rect\(\{ width: (\d+), height: (\d+)/.exec(src);
  assert.ok(m, 'the line shape is a rectangle in templates.js');
  return { W: Number(m[1]), H: Number(m[2]) };
})();
function lineBox(i, aspect) {
  const turned = Math.abs(i.angle || 0) % 180 === 90;
  const s = turned ? (i.w / LINE.W) * ((LINE.W + 1) / (LINE.H + 1)) : i.w / LINE.W;
  const long = LINE.W * s;
  const thick = LINE.H * s;
  const [wx, hy] = turned ? [thick, long * aspect] : [long, thick * aspect];
  return { turned, thick, x0: i.x - wx / 2, x1: i.x + wx / 2, y0: i.y - hy / 2, y1: i.y + hy / 2 };
}

test('cake toppers: the stakes hang from the bar, below the words, about 5 mm wide', () => {
  const toppers = designs.filter((d) => d.product === 'caketopper');
  assert.ok(toppers.length >= 4);
  const widthMm = 150; // the 15 cm topper (the smaller size)
  for (const d of toppers) {
    const lines = d.items.filter((i) => i.kind === 'shape' && i.shape === 'line').map((i) => lineBox(i, d.aspect));
    const bars = lines.filter((l) => !l.turned);
    const standing = lines.filter((l) => l.turned).sort((a, b) => a.x0 - b.x0);
    assert.ok(standing.length, `${d.id}: has stakes`);
    // Standing lines that overlap make one stake.
    const stakes = [];
    for (const l of standing) {
      const last = stakes[stakes.length - 1];
      if (last && l.x0 < last.x1) last.parts.push(l), (last.x1 = Math.max(last.x1, l.x1));
      else stakes.push({ x0: l.x0, x1: l.x1, parts: [l] });
    }
    const textBottom = Math.max(...d.items.filter((i) => i.kind === 'text').map((i) => i.y));
    for (const st of stakes) {
      const top = Math.min(...st.parts.map((p) => p.y0));
      const bottom = Math.max(...st.parts.map((p) => p.y1));
      // The bar it hangs from: the lowest bar across it.
      const bar = bars.filter((b) => b.x0 < st.x0 && b.x1 > st.x1).sort((a, b) => b.y0 - a.y0)[0];
      assert.ok(bar, `${d.id}: a stake hangs from a bar`);
      assert.ok(top >= bar.y0 - 1e-9 && top < bar.y1, `${d.id}: the stake starts inside the bar (top ${top.toFixed(3)}, bar ${bar.y0.toFixed(3)}..${bar.y1.toFixed(3)})`);
      assert.ok(top > textBottom, `${d.id}: the stake starts below the words' middle, not up through them`);
      // (Placed for the area; a stake may run past its bottom: the edge fit brings the whole piece in.)
      assert.ok(bottom > 0.9 && bottom < 1.1, `${d.id}: the stake reaches down to the bottom (${bottom.toFixed(3)})`);
      // Its lines overlap (one solid piece), and the stake is sturdy but slim.
      for (let k = 1; k < st.parts.length; k++) assert.ok(st.parts[k].x0 < st.parts[k - 1].x1 - st.parts[k].thick * 0.2, `${d.id}: the stake's lines overlap`);
      const mm = (st.x1 - st.x0) * widthMm;
      assert.ok(mm >= 4 && mm <= 8, `${d.id}: stake ${mm.toFixed(1)} mm wide`);
    }
  }
});
