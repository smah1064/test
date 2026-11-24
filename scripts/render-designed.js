#!/usr/bin/env node
/*
 * Product pictures "with a design on": every product shown printed with one of
 * the shop's ready-made designs, on a light-grey card background (4:3), drawn
 * with the shop's own renderer, so the picture is exactly what we print.
 * Writes public/img/designed/<productId>.webp and public/img/designed/index.json.
 *
 *   node scripts/render-designed.js            all products
 *   node scripts/render-designed.js mug tshirt only these
 *
 * Needs Playwright with Chromium (preinstalled in the dev container).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { createApp } = require('../src/app');

const OUT = path.join(__dirname, '..', 'public', 'img', 'designed');
// Arguments: product ids, or id=designId to choose the design for a product.
const args = process.argv.slice(2);
const only = args.map((a) => a.split('=')[0]);
const chosen = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => a.split('=')));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'designed-'));
  const app = createApp({ dataDir, adminPassword: 'render-only-' + Date.now(), cleanupEvery: 0, requireApproval: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.warn('page error:', String(e)));
  // The ready-design page loads everything the renderer needs (fabric, fonts, product photos, previews).
  await page.goto(`${base}/design?id=none`);
  await page.waitForFunction(() => window.POD_RENDER && window.POD && window.POD_PREVIEW);
  const indexFile = path.join(OUT, 'index.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
  const ids = await page.evaluate(async (wanted) => {
    const catalog = await POD.loadCatalog();
    return catalog.products.filter((p) => !wanted.length || wanted.includes(p.id)).map((p) => p.id);
  }, only);
  for (const id of ids) {
    const res = await page.evaluate(async ({ productId, pick }) => {
      const catalog = await POD.loadCatalog();
      const lib = await POD.api('/api/library');
      const product = catalog.products.find((p) => p.id === productId);
      const loadImg = (src) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('image ' + src.slice(0, 60))); im.src = src; });
      /** Crop a picture to what is drawn on it (its alpha), with a little room. */
      const cropToArt = (full) => {
        const w = full.width;
        const h = full.height;
        const d = full.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          if (d[(y * w + x) * 4 + 3] < 40) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) return full;
        const out = document.createElement('canvas');
        out.width = x1 - x0 + 4;
        out.height = y1 - y0 + 4;
        out.getContext('2d').drawImage(full, -x0 + 2, -y0 + 2);
        return out;
      };
      /** The card: light grey, the picture centred with a soft shadow, 4:3. */
      const card = (pic, { fill = 0.8, shadow = true } = {}) => {
        const W = 1200;
        const H = 900;
        const out = document.createElement('canvas');
        out.width = W;
        out.height = H;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ececec';
        ctx.fillRect(0, 0, W, H);
        const k = Math.min((W * fill) / pic.width, (H * (fill + 0.04)) / pic.height);
        const w = pic.width * k;
        const hgt = pic.height * k;
        if (shadow) { ctx.shadowColor = 'rgba(0, 0, 0, .18)'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 14; }
        ctx.drawImage(pic, (W - w) / 2, (H - hgt) / 2, w, hgt);
        return out.toDataURL('image/webp', 0.86);
      };
      let h = 0;
      for (const ch of productId) h = (h * 31 + ch.charCodeAt(0)) | 0;
      h = Math.abs(h);

      // Kids' books: the real sample cover.
      if (product.kind === 'book') {
        const cover = await loadImg(`/api/books/${encodeURIComponent(product.book)}/sample/0.jpg?lang=ar`);
        const c = document.createElement('canvas');
        c.width = cover.naturalWidth + 24;
        c.height = cover.naturalHeight;
        const x = c.getContext('2d');
        x.fillStyle = '#d9d4cc'; // the pages under the cover
        x.fillRect(16, 10, cover.naturalWidth, cover.naturalHeight - 10);
        x.drawImage(cover, 0, 0);
        return { url: card(c, { fill: 0.62 }), design: 'book-cover' };
      }
      // Photo prints: a small fan of prints with white borders (pictures from the lifestyle set).
      if (product.kind === 'photoset') {
        const srcs = ['/img/lifestyle/canvaswide.webp', '/img/lifestyle/plaque.webp', '/img/lifestyle/hero-2.webp'];
        const ims = await Promise.all(srcs.map(loadImg));
        const c = document.createElement('canvas');
        c.width = 1400;
        c.height = 1100;
        const x = c.getContext('2d');
        const pw = 520;
        const ph = 680;
        [[-0.16, 330, 580], [0.02, 700, 520], [0.15, 1060, 600]].forEach(([rot, cx, cy], k) => {
          const im = ims[k];
          x.save();
          x.translate(cx, cy);
          x.rotate(rot);
          x.shadowColor = 'rgba(0,0,0,.2)'; x.shadowBlur = 24; x.shadowOffsetY = 10;
          x.fillStyle = '#fff';
          x.fillRect(-pw / 2, -ph / 2, pw, ph);
          x.shadowColor = 'transparent';
          const b = 26;
          const iw = pw - 2 * b; const ih = ph - 2 * b;
          const s = Math.max(iw / im.naturalWidth, ih / im.naturalHeight);
          const sw = iw / s; const sh = ih / s;
          x.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, -pw / 2 + b, -ph / 2 + b, iw, ih);
          x.restore();
        });
        return { url: card(cropToArt(c), { fill: 0.84, shadow: false }), design: 'photos' };
      }
      // Fabric, bedding, curtains, wrapping paper: the product covered with a repeating pattern.
      if (product.pattern) {
        const T = 600;
        const tile = document.createElement('canvas');
        tile.width = T;
        tile.height = T;
        const g = tile.getContext('2d');
        const palettes = [['#f4ede2', '#c96f4a', '#7f9a7a', '#e1b04a', '#2f6f73'], ['#fbf6ee', '#d98b6c', '#9bb08f', '#e9c46a', '#264653'], ['#f2ebe3', '#b5654a', '#6f8f7f', '#d9a441', '#3a5a6b']];
        const [bg, a, b, c2, d2] = palettes[h % palettes.length];
        g.fillStyle = bg;
        g.fillRect(0, 0, T, T);
        // Boho motifs: arches, suns and leaves, placed so the tile repeats without seams.
        const arch = (x, y, r, col) => { g.lineWidth = r * 0.28; g.strokeStyle = col; for (const k of [1, 0.62]) { g.beginPath(); g.arc(x, y, r * k, Math.PI, 0); g.stroke(); } };
        const sun = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
        const leaf = (x, y, r, rot, col) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = col; g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r * 0.7, 0, 0, r); g.quadraticCurveTo(-r * 0.7, 0, 0, -r); g.fill(); g.strokeStyle = bg; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -r * 0.8); g.lineTo(0, r * 0.8); g.stroke(); g.restore(); };
        for (const [ox, oy] of [[0, 0], [T, 0], [0, T], [T, T]]) {
          arch(150 + ox - (ox ? T : 0), 200 + oy - (oy ? T : 0), 80, a);
          sun(450 + ox - (ox ? T : 0), 130 + oy - (oy ? T : 0), 46, c2);
          leaf(420 + ox - (ox ? T : 0), 430 + oy - (oy ? T : 0), 70, 0.6, b);
          leaf(170 + ox - (ox ? T : 0), 470 + oy - (oy ? T : 0), 56, -0.5, d2);
          sun(300 + ox - (ox ? T : 0), 330 + oy - (oy ? T : 0), 18, a);
          sun(560 + ox - (ox ? T : 0), 560 + oy - (oy ? T : 0), 14, b);
        }
        const sc = product.pattern.scene;
        const S = 3; // pixels per mockup unit
        const W0 = 500 * S;
        const H0 = 600 * S;
        const out = document.createElement('canvas');
        out.width = W0;
        out.height = H0;
        const x = out.getContext('2d');
        const color = product.colors[0];
        const [base, over] = await Promise.all([loadImg(POD.mockupUrl(sc, color.hex)), sc.overlay ? loadImg(POD.mockupUrl(sc, color.hex, 'overlay')) : null]);
        x.drawImage(base, 0, 0, W0, H0);
        const f = sc.fill;
        const cm = POD.fabricCm(product, product.sizes[0].id);
        const tileCm = Math.max(...product.pattern.tiles); // the biggest tile: the motifs read at card size
        const tw = (f.w * S * tileCm) / cm[0];
        POD.drawPattern(x, tile, { repeat: 'halfdrop', tw, th: tw, x: f.x * S, y: f.y * S, w: f.w * S, h: f.h * S });
        if (over) x.drawImage(over, 0, 0, W0, H0);
        return { url: card(cropToArt(out), { fill: 0.74 }), design: 'pattern' };
      }

      let fits = lib.designs.filter((dd) => POD.designFor(dd, product));
      let note = '';
      if (!fits.length) {
        // No ready design made for this shape: the ones made for the nearest shape.
        const pa = product.sides[0].printArea;
        const want = Math.log(pa.w / pa.h);
        const aspectOf = (dd) => {
          if (dd.aspect) return dd.aspect;
          const src = catalog.products.find((p) => p.id === dd.product);
          const a = src && src.sides[0].printArea;
          return a ? a.w / a.h : 1;
        };
        const scored = lib.designs.map((dd) => [Math.abs(Math.log(aspectOf(dd)) - want), dd]).sort((p1, p2) => p1[0] - p2[0]);
        const best = scored[0][0];
        fits = scored.filter((s2) => s2[0] <= best + 0.15).map((s2) => s2[1]);
        note = ' (nearest shape)';
      }
      // Its own design first, else one picked by the product id (the rows don't all show the same design).
      const own = fits.filter((dd) => dd.product === productId);
      const d0 = (pick && lib.designs.find((dd) => dd.id === pick)) || (own.length ? own[0] : fits[h % fits.length]);
      const raw = d0.kind === 'objects' ? await POD.api('/api/library/' + encodeURIComponent(d0.id)) : d0;
      // Name-list fields ({Name}, {الاسم}...) shown filled in, as a customer's would be.
      const SAMPLE = { 'الاسم': 'سارة أحمد', 'الوظيفة': 'مديرة التسويق', 'الموبايل': '0100 123 4567', 'الإيميل': 'sara@ebda3.me', Name: 'Sara Ahmed', name: 'Sara', Position: 'Marketing Manager', Phone: '0100 123 4567', Email: 'sara@ebda3.me' };
      const d = JSON.parse(JSON.stringify(raw).replace(/\{([^{}"\\]{1,30})\}/g, (m, k) => SAMPLE[k] || k));
      const color = product.colors.find((c) => c.id === d.color) || product.colors[0];
      const st = await POD_RENDER.stage(d, product, product.sides[0], color);
      const pic = await POD_RENDER.productPicture(st, 2);
      return { url: card(pic), design: d0.id + note };
    }, { productId: id, pick: chosen[id] || null }).catch((e) => ({ error: String(e && e.message || e) }));
    if (!res.url) {
      console.log(id, 'skipped:', res.skipped || res.error);
      continue;
    }
    fs.writeFileSync(path.join(OUT, `${id}.webp`), Buffer.from(res.url.split(',')[1], 'base64'));
    index[id] = { file: `/img/designed/${id}.webp`, design: res.design };
    console.log(id, 'ok', res.design);
  }
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + '\n');
  await browser.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
