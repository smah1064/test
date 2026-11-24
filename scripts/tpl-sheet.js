'use strict';
/*
 * Draw the templates of one pack (or all) and check their layout.
 *   node scripts/tpl-sheet.js <server base URL> <pack file | all> <out.jpg>
 * Needs a running shop server (for the fonts, the template code and the library icons) and
 * Playwright (NODE_PATH=$(npm root -g)). The pack is read from disk, so no restart is needed.
 * Prints one line per problem and writes a contact sheet: each design on its product colour
 * (tall area, like a T-shirt) and on a wide, short area (like a mug wrap), with its id underneath.
 */
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');

(async () => {
  const [base, which, out] = process.argv.slice(2);
  if (!base || !which || !out) throw new Error('usage: tpl-sheet.js <base> <pack.js|all> <out.jpg>');
  let designs;
  if (which === 'all') designs = require('../src/library').SEED;
  else {
    delete require.cache[require.resolve(path.resolve(which))];
    designs = require(path.resolve(which)).designs;
  }
  const colors = Object.fromEntries(require('../src/products').PRODUCTS.flatMap((p) => p.colors.map((c) => [`${p.id}:${c.id}`, c.hex])));
  const br = await chromium.launch();
  const page = await br.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(base.replace(/\/$/, '') + '/designs');
  await page.waitForFunction(() => window.POD_DESIGN && window.fabric && window.POD_STICKERS);
  const results = [];
  for (const d of designs) {
    const bg = colors[`${d.product}:${d.color}`] || '#ffffff';
    const r = await page.evaluate(async ([d, bg]) => {
      const n = parseInt(bg.slice(1), 16);
      const dark = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.45;
      const ink = dark ? '#ffffff' : '#16181d';
      const draw = async (W, H) => {
        const pad = 10;
        const area = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };
        const sc = new fabric.StaticCanvas(null, { width: W, height: H, backgroundColor: bg, renderOnAddRemove: false });
        const objs = await window.POD_DESIGN.buildTemplate({ id: d.id, items: d.items, aspect: d.aspect }, area, ink);
        objs.forEach((o) => sc.add(o));
        sc.renderAll();
        const ctx = sc.getContext();
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)';
        ctx.strokeRect(area.x, area.y, area.w, area.h);
        ctx.restore();
        const boxes = objs.map((o) => { const b = o.getBoundingRect(true, true); return { t: o.text || o.name || o.type, text: !!o.text, l: b.left, tp: b.top, w: b.width, h: b.height }; });
        const problems = [];
        if (objs.length !== d.items.length) problems.push(`${d.items.length - objs.length} item(s) failed to draw`);
        for (const b of boxes) {
          const tol = 2;
          if (b.l < area.x - tol || b.tp < area.y - tol || b.l + b.w > area.x + area.w + tol || b.tp + b.h > area.y + area.h + tol) problems.push(`"${b.t}" spills out of the print area`);
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            if (!a.text || !b.text) continue;
            const ox = Math.max(0, Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l));
            const oy = Math.max(0, Math.min(a.tp + a.h, b.tp + b.h) - Math.max(a.tp, b.tp));
            if (ox * oy > Math.min(a.w * a.h, b.w * b.h) * 0.12) problems.push(`texts "${a.t}" and "${b.t}" overlap`);
          }
        }
        const url = sc.toDataURL({ format: 'png' });
        sc.dispose();
        return { url, problems };
      };
      const tall = await draw(240, 320);
      const wide = await draw(420, 180);
      return { tall: tall.url, wide: wide.url, problems: [...tall.problems.map((p) => 'tall: ' + p), ...wide.problems.map((p) => 'wide: ' + p)] };
    }, [d, bg]);
    for (const p of r.problems) console.log(`${d.id}: ${p}`);
    results.push({ d, ...r });
  }
  await br.close();
  // Contact sheet: 4 per row, tall over wide, id underneath (red when a problem was found).
  const per = 4;
  const cw = 440;
  const ch = 320 + 180 + 40;
  const rows = Math.max(1, Math.ceil(results.length / per));
  const tiles = [];
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  for (const [k, r] of results.entries()) {
    const x = (k % per) * cw;
    const y = Math.floor(k / per) * ch;
    tiles.push({ input: Buffer.from(r.tall.split(',')[1], 'base64'), left: x + 100, top: y });
    tiles.push({ input: Buffer.from(r.wide.split(',')[1], 'base64'), left: x + 10, top: y + 325 });
    const label = `${r.d.id}${r.problems.length ? '  (' + r.problems.length + ' problem' + (r.problems.length > 1 ? 's' : '') + ')' : ''}`;
    tiles.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="30"><text x="10" y="20" font-size="16" font-family="sans-serif" fill="${r.problems.length ? '#c92a2a' : '#222'}">${esc(label)}</text></svg>`), left: x, top: y + 508 });
  }
  const sheet = await sharp({ create: { width: per * cw, height: rows * ch, channels: 3, background: '#e9ecef' } }).composite(tiles).jpeg({ quality: 82 }).toBuffer();
  await sharp(sheet).toFile(out);
  console.log(`${results.length} designs, ${results.filter((r) => r.problems.length).length} with problems -> ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
