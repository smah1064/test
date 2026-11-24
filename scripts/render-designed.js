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
const only = process.argv.slice(2);

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
    return catalog.products.filter((p) => !p.kind && (!wanted.length || wanted.includes(p.id))).map((p) => p.id);
  }, only);
  for (const id of ids) {
    const res = await page.evaluate(async (productId) => {
      const catalog = await POD.loadCatalog();
      const lib = await POD.api('/api/library');
      const product = catalog.products.find((p) => p.id === productId);
      const fits = lib.designs.filter((d) => POD.designFor(d, product));
      if (!fits.length) return { skipped: 'no ready design fits' };
      // Its own design first, else one picked by the product id (the rows don't all show the same design).
      let h = 0;
      for (const ch of productId) h = (h * 31 + ch.charCodeAt(0)) | 0;
      const own = fits.filter((d) => d.product === productId);
      const d0 = own.length ? own[0] : fits[Math.abs(h) % fits.length];
      const raw = d0.kind === 'objects' ? await POD.api('/api/library/' + encodeURIComponent(d0.id)) : d0;
      // Name-list fields ({Name}, {الاسم}...) shown filled in, as a customer's would be.
      const SAMPLE = { 'الاسم': 'سارة أحمد', 'الوظيفة': 'مديرة التسويق', 'الموبايل': '0100 123 4567', 'الإيميل': 'sara@ebda3.me', Name: 'Sara Ahmed', name: 'Sara', Position: 'Marketing Manager', Phone: '0100 123 4567', Email: 'sara@ebda3.me' };
      const d = JSON.parse(JSON.stringify(raw).replace(/\{([^{}"\\]{1,30})\}/g, (m, k) => SAMPLE[k] || k));
      const color = product.colors.find((c) => c.id === d.color) || product.colors[0];
      const st = await POD_RENDER.stage(d, product, product.sides[0], color);
      const pic = await POD_RENDER.productPicture(st, 2);
      // The card: light grey, the product centred with a soft shadow, 4:3.
      const W = 1200;
      const H = 900;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ececec';
      ctx.fillRect(0, 0, W, H);
      const k = Math.min((W * 0.8) / pic.width, (H * 0.84) / pic.height);
      const w = pic.width * k;
      const hgt = pic.height * k;
      ctx.shadowColor = 'rgba(0, 0, 0, .18)';
      ctx.shadowBlur = 36;
      ctx.shadowOffsetY = 14;
      ctx.drawImage(pic, (W - w) / 2, (H - hgt) / 2, w, hgt);
      return { url: out.toDataURL('image/webp', 0.86), design: d0.id };
    }, id).catch((e) => ({ error: String(e && e.message || e) }));
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
