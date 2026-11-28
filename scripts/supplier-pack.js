'use strict';
/*
 * Supplier packs: one Arabic PDF per production method, to send to printing houses and workshops
 * before choosing who to work with. Each pack states what the site sells with that method (photo,
 * print size, margins, colours, sizes: read from src/products.js, so it always matches the site),
 * the files the dashboard produces for it, and the questions the printer should answer.
 *
 *   NODE_PATH=$(npm root -g) node scripts/supplier-pack.js <method | all> [--brand <id>] [--contact "name · phone"] [--no-prices]
 *
 * The packs never name ebda3 (owner, 28 Nov 2026: he stays hidden and sends them under a partner's name). A brand
 * is scripts/supplier-packs/brands/<id>.json: { "name": { "ar", "en" }, "logo": "file next to the json (svg/png)",
 * "site": "example.com", "contact": "..." }, all optional. Without --brand the pack carries no name or logo.
 *
 * Writes docs/supplier-packs/<brand | unbranded>/<method>-ar.pdf and, for methods with a test print,
 * <method>-test-*.png next to it. Needs Playwright (pre-installed globally).
 * The text of each pack lives in scripts/supplier-packs/<method>.js.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PRODUCTS } = require('../src/products');
const printfiles = require('../src/printfiles');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'supplier-packs');
const PACKS = path.join(__dirname, 'supplier-packs');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const ltr = (s) => `<span dir="ltr">${s}</span>`;
/** Width and height spelled out: in right-to-left text "30 × 40" alone can be read either way round. */
const wh = (w, h) => `عرض ${ltr(w)} × ارتفاع ${ltr(h)} سم`;
const latinDigits = (s) => s.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٪/g, '%');

// ---------- Facts from the product data ----------
// The editor's export (public/js/editor.js exportPrint): 300 DPI, less when the file would pass a phone's canvas limit.
const TARGET_DPI = 300;
const MAX_PRINT_PIXELS = 16e6;
const MAX_PRINT_SIDE = 8000;
function sideFacts(side) {
  const b = Number(side.bleedIn) || 0;
  const wIn = side.printWidthIn;
  const hIn = (wIn * side.printArea.h) / side.printArea.w;
  const W = wIn + 2 * b;
  const H = hIn + 2 * b;
  const dpi = Math.floor(Math.min(TARGET_DPI, Math.sqrt(MAX_PRINT_PIXELS / (W * H)), MAX_PRINT_SIDE / Math.max(W, H)));
  const perUnit = (wIn * 2.54) / side.printArea.w; // cm per mockup unit
  const zone = side.moveZone ? { wCm: side.moveZone.w * perUnit, hCm: side.moveZone.h * perUnit } : null;
  return { wIn, hIn, wCm: cm(wIn), hCm: cm(hIn), bleedMm: Math.round(b * 25.4 * 10) / 10, safeMm: Math.round((Number(side.safeIn) || 0) * 25.4), dpi, zone };
}

// ---------- Drawings and photos ----------
/** The product's own mockup drawing with the print area (solid) and, on garments, the zone the customer may move it in (dashed). */
function sideDrawing(side) {
  const f = sideFacts(side);
  const a = side.printArea;
  const z = side.moveZone;
  const inner = side.svg
    .replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    .replace(/\{\{C\}\}/g, '#f3f4f6').replace(/\{\{S\}\}/g, '#e2e5ea').replace(/\{\{L\}\}/g, '#9097a3');
  const fz = a.w < 120 ? 20 : 26;
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 40 460 540" class="draw">${inner}
    ${z ? `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="none" stroke="#6b7280" stroke-width="2" stroke-dasharray="7 6"/>` : ''}
    <rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" fill="#e8590c" fill-opacity=".14" stroke="#e8590c" stroke-width="3"/>
    <text x="${cx}" y="${a.y + fz + 4}" text-anchor="middle" font-size="${fz}" font-weight="700" fill="#b03d00" direction="ltr">↔ ${f.wCm}</text>
    <text transform="translate(${a.x + fz + 2} ${cy}) rotate(-90)" text-anchor="middle" font-size="${fz}" font-weight="700" fill="#b03d00" direction="ltr">↕ ${f.hCm}</text>
  </svg>`;
}
async function photoUri(id) {
  const file = path.join(ROOT, 'public', 'img', 'lifestyle', `${id}.webp`);
  if (!fs.existsSync(file)) return null;
  const buf = await sharp(file).resize(480, 600, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
const fontFace = () => [400, 700].flatMap((w) => ['arabic', 'latin'].map((set) => {
  const b64 = fs.readFileSync(path.join(ROOT, 'public', 'fonts', 'files', `cairo-${set}-${w}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:'Cairo';font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${set === 'arabic' ? 'U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFC,U+200C-200E' : 'U+0000-00FF,U+2000-206F,U+2212,U+2215'}}`;
})).join('\n');

// ---------- Page pieces ----------
const CSS = `
@page{size:A4;margin:14mm 13mm 16mm}
*{box-sizing:border-box}
body{font-family:'Cairo',sans-serif;font-size:10.5pt;line-height:1.65;color:#1b1d21;margin:0}
h1{font-size:25pt;line-height:1.3;margin:0 0 4mm}
h2{font-size:15pt;margin:0 0 3mm;padding-bottom:1.5mm;border-bottom:1.2mm solid #e8590c;break-after:avoid}
h3{font-size:12pt;margin:0 0 1.5mm;break-after:avoid}
p{margin:0 0 2.5mm}
.sec{break-before:page}
.cover{height:262mm;display:flex;flex-direction:column}
.cover .band{background:#1b1d21;color:#fff;border-radius:4mm;padding:12mm 10mm;margin-bottom:8mm}
.cover .band .kicker{color:#ffb38a;font-weight:700;font-size:11pt;margin-bottom:2mm}
.cover .band .sub{font-size:12pt;color:#d6d9de}
.cover img.logo{height:20mm;max-width:80mm;object-fit:contain;margin-bottom:8mm;align-self:flex-start}
.cover .brandname{font-size:20pt;font-weight:700;margin-bottom:8mm}
.cover .brandname span{font-size:13pt;color:#5d636e;font-weight:400;margin-right:3mm}
.box{border:.3mm solid #d5d8de;border-radius:3mm;padding:4mm 5mm;margin-bottom:4mm;break-inside:avoid}
.box.tint{background:#fff6ef;border-color:#f3c4a4}
.steps{margin:0;padding:0 5mm 0 0}
.steps li{margin-bottom:1.2mm}
.foot{margin-top:auto;color:#5d636e;font-size:9.5pt;border-top:.3mm solid #d5d8de;padding-top:3mm}
table{border-collapse:collapse;width:100%;margin-bottom:3mm}
th,td{border:.3mm solid #d5d8de;padding:1.6mm 2.5mm;text-align:right;vertical-align:top}
th{background:#f3f4f6;font-weight:700;white-space:nowrap}
td.k{background:#f8f9fa;font-weight:700;width:34mm}
.prod{break-inside:avoid;border:.3mm solid #d5d8de;border-radius:3mm;padding:4mm;margin-bottom:5mm}
.prod .top{display:flex;gap:4mm;align-items:flex-start}
.prod img.photo{width:36mm;height:45mm;object-fit:cover;border-radius:2mm;flex:none}
.prod .draws{display:flex;gap:2mm;flex:none}
.prod figure{margin:0;text-align:center;font-size:9pt;color:#5d636e}
.prod svg.draw{width:35mm;height:41mm;display:block}
.prod .info{flex:1;min-width:0}
.prod .info .m{margin-bottom:1.5mm;font-size:9.5pt}
.prod table.sides{font-size:9.5pt;margin:3mm 0 0}
.prod table.sides th,.prod table.sides td{text-align:center;white-space:normal}
.prod .ask{margin-top:2.5mm;background:#fff6ef;border-radius:2mm;padding:2.5mm 3.5mm;font-size:9.5pt}
.chips span{display:inline-block;border:.3mm solid #c9cdd4;border-radius:10mm;padding:0 2.2mm;margin:0 0 1mm 1mm;font-size:9pt;white-space:nowrap}
.chips i{display:inline-block;width:2.6mm;height:2.6mm;border-radius:50%;border:.2mm solid #8b909a;margin-left:1mm;vertical-align:-.3mm}
.legend{font-size:9.5pt;color:#5d636e;margin-bottom:4mm}
.legend b.o{color:#b03d00}
.q{break-inside:avoid;margin-bottom:3.2mm}
.q .t{font-weight:700}
.q .n{display:inline-block;min-width:6mm;color:#e8590c;font-weight:700}
.q .note{color:#5d636e;font-size:9.5pt}
.line{border-bottom:.3mm dotted #6b7280;height:7mm}
.opts{margin-top:.8mm}
.opts span{display:inline-block;margin-left:5mm;white-space:nowrap}
.opts span::before{content:'';display:inline-block;width:3.2mm;height:3.2mm;border:.35mm solid #1b1d21;border-radius:.6mm;margin-left:1.5mm;vertical-align:-.5mm}
.fill td{height:8.5mm}
.small{font-size:9.5pt;color:#5d636e}
[dir=ltr]{unicode-bidi:isolate}
`;

function question(q, n) {
  const lines = q.lines == null ? (q.opts ? 1 : 2) : q.lines;
  return `<div class="q"><div class="t"><span class="n">${n}.</span> ${q.q}</div>
    ${q.note ? `<div class="note">${q.note}</div>` : ''}
    ${q.opts ? `<div class="opts">${q.opts.map((o) => `<span>${o}</span>`).join('')}</div>` : ''}
    ${q.table ? `<table class="fill"><tr>${q.table.cols.map((c) => `<th>${c}</th>`).join('')}</tr>${q.table.rows.map((r) => `<tr>${q.table.cols.map((c, i) => `<td${i ? '' : ' class="k"'}>${i ? '' : r}</td>`).join('')}</tr>`).join('')}</table>` : ''}
    ${'<div class="line"></div>'.repeat(q.table ? 0 : lines)}</div>`;
}

async function productBlock(p, pack) {
  const photo = await photoUri(p.id);
  const sides = p.sides.map((s) => ({ s, f: sideFacts(s) }));
  const sizes = p.sizes.filter((z) => z.id !== 'one').map((z) => (z.label && z.label.ar) || z.id);
  const extra = (pack.productNotes && pack.productNotes[p.id]) || {};
  const meta = [
    ['الخامة', esc(extra.material || p.description.ar)],
    ['ألوان القطعة', `<span class="chips">${p.colors.map((c) => `<span><i style="background:${c.hex}"></i>${esc(c.name.ar)}</span>`).join('')}</span>`],
    ...(sizes.length ? [['المقاسات', `<span class="chips">${sizes.map((z) => `<span${/[\u0600-\u06ff]/.test(z) ? '' : ' dir="ltr"'}>${esc(z)}</span>`).join('')}</span>`]] : []),
  ];
  const anyZone = sides.some(({ f }) => f.zone);
  const anyBleed = sides.some(({ f }) => f.bleedMm);
  const head = ['الوجه', 'مقاس الطباعة', ...(anyBleed ? ['زيادة القص'] : []), 'دقة الملف', 'هامش الأمان', ...(anyZone ? ['مساحة تحريك التصميم'] : [])];
  const body = sides.map(({ s, f }) => [
    `<b>${esc(s.name.ar)}</b>`, `<b>${wh(f.wCm, f.hCm)}</b>`, ...(anyBleed ? [`${ltr(f.bleedMm)} مم`] : []), ltr(`${f.dpi} DPI`), f.safeMm ? `${ltr(f.safeMm)} مم` : '-',
    ...(anyZone ? [f.zone ? `${wh(Math.round(f.zone.wCm), Math.round(f.zone.hCm))} تقريبًا` : 'مكان ثابت'] : []),
  ]);
  return `<div class="prod">
    <h3>${esc(p.name.ar)} <span class="small" dir="ltr">(${esc(p.name.en)})</span></h3>
    <div class="top">
      ${photo ? `<img class="photo" src="${photo}" alt="">` : ''}
      <div class="draws">${sides.map(({ s }) => `<figure>${sideDrawing(s)}${esc(s.name.ar)}</figure>`).join('')}</div>
      <div class="info">${meta.map(([k, v]) => `<div class="m"><b>${k}:</b> ${v}</div>`).join('')}</div>
    </div>
    <table class="sides"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</table>
    ${extra.ask ? `<div class="ask"><b>سؤال عن المنتج ده:</b> ${extra.ask}<div class="line"></div></div>` : ''}
  </div>`;
}

async function buildHtml(pack, opts) {
  const products = pack.products.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
  const brand = opts.brand;
  const general = require(path.join(PACKS, 'general.js'))(opts);
  const contact = opts.contact || brand.contact;
  let n = 0;
  const qs = (list) => list.map((q) => question(q, ++n)).join('');
  const blocks = [];
  for (const p of products) blocks.push(await productBlock(p, pack));
  return latinDigits(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(pack.title)}</title><style>${fontFace()}${CSS}</style></head><body>
  <section class="cover">
    ${brand.logoUri ? `<img class="logo" src="${brand.logoUri}" alt="">` : brand.name.ar || brand.name.en ? `<div class="brandname">${esc(brand.name.ar || brand.name.en)}${brand.name.ar && brand.name.en ? ` <span dir="ltr">${esc(brand.name.en)}</span>` : ''}</div>` : ''}
    <div class="band"><div class="kicker">ملف المواصفات الفنية للموردين</div><h1>${pack.title}</h1><div class="sub">${pack.subtitle}</div></div>
    <div class="box"><h3>مين إحنا</h3><p>${general.about}</p></div>
    <div class="box"><h3>المطلوب منكم</h3><ol class="steps">${general.steps(pack).map((s) => `<li>${s}</li>`).join('')}</ol></div>
    <div class="box tint"><h3>ليه الملف ده</h3><p>${general.why}</p></div>
    <div class="foot">${contact ? `للتواصل: <b>${esc(contact)}</b> · ` : ''}${brand.site ? `${ltr(esc(brand.site))} · ` : ''}إصدار ${ltr(opts.date)} · ${products.length} منتجات في الملف ده</div>
  </section>

  <section class="sec"><h2>١ · الملفات اللي بنبعتها لكم</h2>
    <p>${pack.filesIntro}</p>
    <table><tr><th>الملف</th><th>المواصفات</th><th>بنستخدمه في</th></tr>${pack.files.map((f) => `<tr><td class="k">${f.name}</td><td>${f.spec}</td><td>${f.use}</td></tr>`).join('')}</table>
    <h3>مع كل شغلانة بيوصلكم</h3>
    <p>${general.job}</p>
    ${pack.filesNotes ? `<div class="box tint">${pack.filesNotes.map((x) => `<p>${x}</p>`).join('')}</div>` : ''}
  </section>

  <section class="sec"><h2>٢ · المنتجات ومقاسات الطباعة</h2>
    <p class="legend"><b class="o">المستطيل البرتقالي</b> = مساحة الطباعة القياسية بالسنتيمتر (↔ العرض، ↕ الارتفاع). ${products.some((p) => p.sides.some((s) => s.moveZone)) ? '<b>الخط المنقّط</b> = أقصى مساحة العميل يقدر يحرّك التصميم جوّاها (مكان التصميم بيتكتب في بيانات الشغلانة). ' : ''}${pack.productsIntro || ''}</p>
    ${blocks.join('')}
  </section>

  <section class="sec"><h2>٣ · أسئلة عامة عن الورشة</h2>${qs(general.questions)}</section>
  <section class="sec"><h2>٤ · أسئلة ${pack.short}</h2>${qs(pack.questions)}</section>
  ${pack.confirm && pack.confirm.length ? `<section class="sec"><h2>٥ · نقط محتاجين تأكيدكم عليها</h2><p>الأرقام دي هي اللي ملفاتنا متجهّزة عليها دلوقتي. لو عندكم رقم أنسب لماكيناتكم اكتبوه، وإحنا نعدّل ملفاتنا عليه.</p>
    <table><tr><th>البند</th><th>عندنا دلوقتي</th><th>مناسب؟ / الأنسب عندكم</th></tr>${pack.confirm.map(([k, v]) => `<tr class="fill"><td class="k">${k}</td><td>${v}</td><td style="width:60mm"></td></tr>`).join('')}</table>
    ${pack.test ? `<div class="box tint"><h3>ملف التجربة</h3><p>${pack.test.text}</p></div>` : ''}
    <div class="box"><h3>ملاحظات إضافية منكم</h3>${'<div class="line"></div>'.repeat(5)}</div>
    <p class="small">${general.thanks}</p></section>` : ''}
  </body></html>`);
}

// ---------- Test print ----------
/** A transparent PNG at exactly wCm × hCm and 300 DPI, drawn from the pack's HTML (so it uses the site's fonts). */
async function testPrint(browser, pack, opts) {
  const { wCm, hCm } = pack.test;
  const html = pack.test.html(opts.brand.name.en || '');
  const W = Math.round((wCm / 2.54) * 300);
  const H = Math.round((hCm / 2.54) * 300);
  const page = await browser.newPage({ viewport: { width: Math.ceil(W / 2), height: Math.ceil(H / 2) }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html dir="ltr"><head><meta charset="utf-8"><style>${fontFace()}
    html,body{margin:0;background:transparent;font-family:'Cairo',sans-serif}:root{--cm:${W / 2 / wCm}px}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const shot = await page.screenshot({ omitBackground: true, type: 'png' });
  await page.close();
  const exact = await sharp(shot).resize(W, H, { fit: 'fill' }).png().toBuffer();
  const dir = opts.out;
  const base = `${pack.id}-test-${wCm}x${hCm}cm`;
  const out = [[`${base}.png`, await printfiles.finalizePrintPng(exact, 300)]];
  if (pack.test.white) out.push([`${base}-white-underbase.png`, await printfiles.dtgUnderbase(exact, 300, 2)]);
  for (const [name, buf] of out) fs.writeFileSync(path.join(dir, name), buf);
  return out.map(([name]) => name);
}

// ---------- CLI ----------
(async () => {
  const args = process.argv.slice(2);
  const which = args.find((a) => !a.startsWith('--'));
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
  const all = fs.readdirSync(PACKS).filter((f) => f.endsWith('.js') && f !== 'general.js').map((f) => f.slice(0, -3));
  if (!which || (which !== 'all' && !all.includes(which))) throw new Error(`usage: supplier-pack.js <${all.join(' | ')} | all> [--contact "..."] [--no-prices]`);
  const brandId = flag('--brand');
  const brandDir = path.join(PACKS, 'brands');
  const brand = { name: {}, ...(brandId ? JSON.parse(fs.readFileSync(path.join(brandDir, `${brandId}.json`), 'utf8')) : {}) };
  brand.name = brand.name || {};
  if (brand.logo) {
    const f = path.join(brandDir, brand.logo);
    const type = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(f).toLowerCase()];
    if (!type) throw new Error(`logo must be svg, png, jpg or webp: ${brand.logo}`);
    brand.logoUri = `data:${type};base64,${fs.readFileSync(f).toString('base64')}`;
  }
  const out = path.join(OUT, brandId || 'unbranded');
  const opts = { brand, out, contact: flag('--contact'), prices: !args.includes('--no-prices'), date: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) };
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    fs.mkdirSync(out, { recursive: true });
    for (const id of which === 'all' ? all : [which]) {
      const pack = { id, ...require(path.join(PACKS, `${id}.js`)) };
      const page = await browser.newPage();
      await page.setContent(await buildHtml(pack, opts), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(out, `${id}-ar.pdf`);
      await page.pdf({
        path: file, format: 'A4', printBackground: true, displayHeaderFooter: true, margin: { top: '14mm', bottom: '16mm', left: '13mm', right: '13mm' },
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;font-size:7pt;color:#777;padding:0 13mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>${esc(brand.name.en || '')}${brand.name.en ? ' · ' : ''}${id.toUpperCase()} supplier pack · ${opts.date}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
      await page.close();
      console.log('wrote', path.relative(ROOT, file));
      if (pack.test) for (const name of await testPrint(browser, pack, opts)) console.log('wrote', path.relative(ROOT, path.join(out, name)));
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
