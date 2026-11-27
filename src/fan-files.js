'use strict';
/**
 * Print files for round drinkware made from measurements ("New product from photo").
 *
 * The customer designs on the band UNROLLED to a rectangle (Wrect × Hrect, see public/js/drinkware-geom.js); a
 * tapered cup is printed from that rectangle warped to a fan (an annular sector). These make:
 *  - fanPng(printPng, fan, dpi, { mirror })  the fan PNG, same mm per pixel as the rectangle, `dpi` in its header;
 *  - fanPdf(fanPngBuf, fan, { title, slug }) the fan at true size with its outline, centre and seam ticks, "TOP",
 *                                            a 100 mm scale bar and a title line;
 *  - templateSvg(fan, { title }) / templatePdf(fan, { title })  the blank true-size outline with its dimensions;
 *  - specSheetPdf(product, spec)             the workshop's A4 sheet (measurements, band, fan, a small drawing).
 * `fan` is geom.fanOf(print, handle) (drinkware.fanFor(spec)) or a design side's stored `side.fan`
 * ({ r1, r2, s, Ro, Ri, theta, phi, wideTop, ... }). A straight body ('rect' template, or no theta) gives the plain
 * rectangle versions.
 */
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const geom = require('../public/js/drinkware-geom');

const PT_PER_MM = 72 / 25.4;
const MARGIN_MM = 10;
const MAX_PIXELS = 130e6;
const r1 = (n) => Math.round(n * 10) / 10;
const deg = (rad) => r1((rad * 180) / Math.PI);

/** The full fan (box, rectangle) from fanOf's output or a stored side.fan. */
function full(fan) {
  if (!fan || typeof fan !== 'object') throw new Error('fan-files: no fan');
  const f = { ...fan };
  const isFan = f.template ? f.template === 'fan' : Number(f.theta) > 0 && Number(f.Ro) > 0;
  if (!isFan) {
    const Wrect = Number(f.Wrect) || Number(f.phi) * Number(f.r1);
    const Hrect = Number(f.Hrect) || Number(f.h) || Number(f.s);
    if (!(Wrect > 0 && Hrect > 0)) throw new Error('fan-files: bad rectangle');
    return { ...f, template: 'rect', Wrect, Hrect, W: Wrect, H: Hrect };
  }
  const { Ro, Ri, theta } = f;
  if (f.W == null || f.H == null) {
    f.W = theta <= Math.PI ? 2 * Ro * Math.sin(theta / 2) : 2 * Ro;
    f.H = theta <= Math.PI ? Ro - Ri * Math.cos(theta / 2) : Ro + Ro * Math.min(1, -Math.cos(theta / 2));
  }
  if (f.Wrect == null) f.Wrect = f.phi * f.r1;
  if (f.Hrect == null) f.Hrect = f.s;
  if (f.wideTop == null) f.wideTop = true;
  f.template = 'fan';
  return f;
}

// ---------- The fan PNG ----------
/**
 * Warp the rectangle print (PNG) to the fan. Output pixels map back to the rectangle (geom.fanUV) and are sampled
 * bilinearly on premultiplied alpha; outside the fan is transparent. The fan box keeps the input's mm per pixel
 * (px/mm = input width / Wrect), so the file is never sharper or softer than the one preflight approved.
 */
async function fanPng(printPng, fanIn, dpi, { mirror = false } = {}) {
  const fan = full(fanIn);
  const { data: src, info } = await sharp(printPng, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const inW = info.width;
  const inH = info.height;
  const density = Math.max(1, Math.round(Number(dpi) || (inW / fan.Wrect) * 25.4));
  if (fan.template !== 'fan') {
    let img = sharp(src, { raw: { width: inW, height: inH, channels: 4 } });
    if (mirror) img = img.flop();
    return img.withDensity(density).png().toBuffer();
  }
  const k = inW / fan.Wrect; // px per mm
  const outW = Math.max(1, Math.round(fan.W * k));
  const outH = Math.max(1, Math.round(fan.H * k));
  const kx = outW / fan.W;
  const ky = outH / fan.H;
  const out = Buffer.alloc(outW * outH * 4);
  const { Ro, s, theta, wideTop } = fan;
  const halfW = fan.W / 2;
  const H = fan.H;
  const maxX = inW - 1;
  const maxY = inH - 1;
  for (let y = 0; y < outH; y++) {
    const Ym = (y + 0.5) / ky;
    const yy = wideTop ? Ym : H - Ym;
    const dy = Ro - yy;
    const dy2 = dy * dy;
    for (let x = 0; x < outW; x++) {
      const Xm = (mirror ? outW - x - 0.5 : x + 0.5) / kx;
      const dx = Xm - halfW;
      const rho = Math.sqrt(dx * dx + dy2);
      const u = Math.atan2(dx, dy) / theta + 0.5;
      const vw = (Ro - rho) / s;
      const v = wideTop ? vw : 1 - vw;
      // Pixel centres: the rectangle's pixel i covers u in [i, i+1) / inW.
      const fx = u * inW - 0.5;
      const fy = v * inH - 0.5;
      if (fx <= -1 || fy <= -1 || fx >= inW || fy >= inH) continue;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      // Four neighbours; those off the rectangle count as transparent (a soft edge on the fan's outline).
      for (let j = 0; j < 4; j++) {
        const sx = x0 + (j & 1);
        const sy = y0 + (j >> 1);
        if (sx < 0 || sy < 0 || sx > maxX || sy > maxY) continue;
        const w = ((j & 1) ? ax : 1 - ax) * ((j >> 1) ? ay : 1 - ay);
        const i = (sy * inW + sx) * 4;
        const wa = w * src[i + 3];
        r += src[i] * wa;
        g += src[i + 1] * wa;
        b += src[i + 2] * wa;
        a += wa;
      }
      if (a <= 0) continue;
      const o = (y * outW + x) * 4;
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
      out[o + 3] = Math.round(a);
    }
  }
  return sharp(out, { raw: { width: outW, height: outH, channels: 4 } }).withDensity(density).png().toBuffer();
}

// ---------- Drawing the outline ----------
/** The outline as points (mm from the fan box's top-left): wide/top edge left to right, then back along the other. */
function outlinePoints(fan, n = 256) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(geom.fanXY(i / n, 0, fan));
  for (let i = n; i >= 0; i--) pts.push(geom.fanXY(i / n, 1, fan));
  return pts;
}
/** A tick continuing the band's edge line at u outwards past the edge v (0 top, 1 bottom), len mm. */
function tick(fan, u, v, len) {
  const p = geom.fanXY(u, v, fan);
  const q = geom.fanXY(u, v ? 0 : 1, fan);
  const dx = p[0] - q[0];
  const dy = p[1] - q[1];
  const d = Math.hypot(dx, dy) || 1;
  return [p, [p[0] + (dx / d) * len, p[1] + (dy / d) * len]];
}
/** The fan's numbers, for the template and the spec sheet. */
function dims(fan) {
  if (fan.template !== 'fan') return [`Straight wrap: ${r1(fan.Wrect)} x ${r1(fan.Hrect)} mm (width x height)`];
  return [
    `Fan: outer radius ${r1(fan.Ro)} mm, inner radius ${r1(fan.Ri)} mm, sweep ${deg(fan.theta)}°`,
    `Box ${r1(fan.W)} x ${r1(fan.H)} mm; long arc ${r1(fan.phi * fan.r1)} mm, short arc ${r1(fan.phi * fan.r2)} mm, slant ${r1(fan.s)} mm`,
    `Narrower at the ${fan.wideTop ? 'bottom' : 'top'} by ${geom.squeezePct(fan)}%`,
  ];
}

function pdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/** One true-size page: [image], outline, ticks, TOP, scale bar, title, dimensions. */
function truePage(fanIn, { image = null, title = '', slug = '', withDims = false } = {}) {
  const fan = full(fanIn);
  const m = MARGIN_MM;
  const pageWmm = Math.max(fan.W + 2 * m, 130);
  const pageHmm = fan.H + 2 * m + (withDims ? 14 : 0);
  const ox = (pageWmm - fan.W) / 2; // the fan box's left edge, mm
  const oy = m;
  const P = (pt) => [(ox + pt[0]) * PT_PER_MM, (oy + pt[1]) * PT_PER_MM];
  const doc = new PDFDocument({ size: [pageWmm * PT_PER_MM, pageHmm * PT_PER_MM], margin: 0, info: { Title: title || 'Drinkware wrap', Creator: 'ebda3' } });
  const done = pdfBuffer(doc);
  const box = [ox * PT_PER_MM, (pageHmm - oy - fan.H) * PT_PER_MM, (ox + fan.W) * PT_PER_MM, (pageHmm - oy) * PT_PER_MM]; // PDF boxes: origin bottom-left
  doc.page.dictionary.data.TrimBox = box;
  doc.page.dictionary.data.ArtBox = box;
  if (image) doc.image(image, ox * PT_PER_MM, oy * PT_PER_MM, { width: fan.W * PT_PER_MM, height: fan.H * PT_PER_MM });

  // Outline (hairline), centre and seam ticks.
  const pts = outlinePoints(fan).map(P);
  doc.save().lineWidth(0.4).strokeColor(image ? '#e0007a' : '#000000');
  doc.moveTo(...pts[0]);
  for (const p of pts.slice(1)) doc.lineTo(...p);
  doc.closePath().stroke();
  for (const u of [0, 0.5, 1]) {
    for (const v of [0, 1]) {
      const [a, b] = tick(fan, u, v, 4);
      doc.moveTo(...P(a)).lineTo(...P(b)).stroke();
    }
  }
  if (!image) {
    // The centre line (opposite the seam or the handle), dashed.
    doc.dash(2, { space: 2 }).moveTo(...P(geom.fanXY(0.5, 0, fan))).lineTo(...P(geom.fanXY(0.5, 1, fan))).stroke().undash();
  }
  doc.restore();

  // "TOP" just outside the band's top edge, by the centre tick.
  const [, tTop] = tick(fan, 0.5, 0, 6.5);
  const [tx, ty] = P(tTop);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text('TOP', tx + 4, ty - 4, { lineBreak: false });

  // Title (top-left margin, short of the centre) and the 100 mm scale bar with the slug (bottom margin).
  if (title) doc.font('Helvetica').fontSize(7).fillColor('#000000').text(title, 4 * PT_PER_MM, 3 * PT_PER_MM, { width: Math.max(30, pageWmm / 2 - 14) * PT_PER_MM, height: 9, lineBreak: false, ellipsis: true });
  const by = (oy + fan.H + 4) * PT_PER_MM;
  const bx = 4 * PT_PER_MM;
  doc.save().lineWidth(0.8).strokeColor('#000000').moveTo(bx, by).lineTo(bx + 100 * PT_PER_MM, by).stroke();
  for (let i = 0; i <= 10; i++) {
    const x = bx + i * 10 * PT_PER_MM;
    doc.moveTo(x, by - (i % 5 ? 1.5 : 3) * PT_PER_MM).lineTo(x, by).stroke();
  }
  doc.restore();
  doc.font('Helvetica').fontSize(6).fillColor('#000000').text('100 mm: print at 100% (no scaling)', bx, by + 1.5 * PT_PER_MM, { lineBreak: false });
  if (slug) doc.font('Helvetica').fontSize(6).fillColor('#000000').text(slug, bx + 104 * PT_PER_MM, by - 1, { width: Math.max(10, pageWmm - 112) * PT_PER_MM, height: 8, lineBreak: false, ellipsis: true });
  if (withDims) {
    let y = (oy + fan.H + 9) * PT_PER_MM;
    doc.font('Helvetica').fontSize(7.5).fillColor('#000000');
    for (const line of dims(fan)) {
      doc.text(line, bx, y, { lineBreak: false });
      y += 9;
    }
  }
  doc.end();
  return done;
}

/** The fan PNG (from fanPng) at true size, with its outline and marks. */
function fanPdf(fanPngBuf, fan, { title = '', slug = '' } = {}) {
  return truePage(fan, { image: fanPngBuf, title, slug });
}
/** The blank template at true size, with its dimensions. */
function templatePdf(fan, { title = '' } = {}) {
  return truePage(fan, { title: title || 'Drinkware wrap template', withDims: true });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** The blank template as a true-size SVG (mm units), with its dimensions. */
function templateSvg(fanIn, { title = '' } = {}) {
  const fan = full(fanIn);
  const m = MARGIN_MM;
  const W = fan.W + 2 * m;
  const lines = dims(fan);
  const H = fan.H + 2 * m + 5 * lines.length + 4;
  const P = (pt) => `${(m + pt[0]).toFixed(2)} ${(m + pt[1]).toFixed(2)}`;
  let outline;
  if (fan.template === 'fan') {
    const big = fan.theta > Math.PI ? 1 : 0;
    // The wide arc turns clockwise on screen when it is on top (y down), the other way when the fan is flipped.
    const sw = fan.wideTop ? 1 : 0;
    const a0 = geom.fanXY(0, 0, fan);
    const a1 = geom.fanXY(1, 0, fan);
    const b1 = geom.fanXY(1, 1, fan);
    const b0 = geom.fanXY(0, 1, fan);
    const [rTop, rBot] = fan.wideTop ? [fan.Ro, fan.Ri] : [fan.Ri, fan.Ro];
    outline = `M${P(a0)} A${rTop.toFixed(2)} ${rTop.toFixed(2)} 0 ${big} ${sw} ${P(a1)} L${P(b1)} A${rBot.toFixed(2)} ${rBot.toFixed(2)} 0 ${big} ${1 - sw} ${P(b0)} Z`;
  } else {
    outline = `M${m} ${m} h${fan.W.toFixed(2)} v${fan.H.toFixed(2)} h${(-fan.W).toFixed(2)} Z`;
  }
  const ticks = [0, 0.5, 1].flatMap((u) => [0, 1].map((v) => tick(fan, u, v, 4))).map(([a, b]) => `M${P(a)} L${P(b)}`).join(' ');
  const centre = `M${P(geom.fanXY(0.5, 0, fan))} L${P(geom.fanXY(0.5, 1, fan))}`;
  const [, top] = tick(fan, 0.5, 0, 6.5);
  const text = lines.map((l, i) => `<text x="${m}" y="${(m + fan.H + 8 + i * 5).toFixed(2)}" font-size="3.4">${esc(l)}</text>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}mm" height="${H.toFixed(2)}mm" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" font-family="Helvetica, Arial, sans-serif">`
    + `<title>${esc(title || 'Drinkware wrap template')}</title>`
    + `<path d="${outline}" fill="none" stroke="#000" stroke-width="0.25"/>`
    + `<path d="${ticks}" fill="none" stroke="#000" stroke-width="0.25"/>`
    + `<path d="${centre}" fill="none" stroke="#000" stroke-width="0.2" stroke-dasharray="2 2"/>`
    + `<text x="${(m + top[0] + 1.5).toFixed(2)}" y="${(m + top[1] + 1).toFixed(2)}" font-size="3" font-weight="bold">TOP</text>`
    + (title ? `<text x="2" y="4.5" font-size="3">${esc(title)}</text>` : '')
    + text
    + '</svg>\n';
}

// ---------- The workshop's spec sheet ----------
const pick = (v) => (v && typeof v === 'object' ? v.en || v.ar || '' : String(v || ''));
/** A4: the product, its measurements, the print band, the fan (or the straight wrap) and a small drawing. */
function specSheetPdf(product, spec) {
  const p = product || {};
  const fan = full(geom.fanOf(spec.print, spec.handle));
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Spec sheet ${p.id || ''}`.trim(), Creator: 'ebda3' } });
  const done = pdfBuffer(doc);
  const W = doc.page.width - 80;
  const d = spec.dims || {};
  const pr = spec.print || {};
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text(pick(p.name) || p.id || 'Drinkware', 40, 40, { width: W });
  doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`${p.id ? `Product ${p.id} · ` : ''}spec v${spec.v || 1}${spec.checkedAt ? ` · dimensions checked ${String(spec.checkedAt).slice(0, 10)}${spec.checkedBy ? ` by ${spec.checkedBy}` : ''}` : ' · dimensions NOT checked yet'}`, { width: W });
  doc.moveDown(0.8);
  const section = (h) => doc.moveDown(0.4).font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(h, { width: W }).moveDown(0.15);
  const row = (k, v) => doc.font('Helvetica').fontSize(10).fillColor('#222222').text(`${k}: `, { continued: true, width: W }).font('Helvetica-Bold').text(String(v));
  section('Product');
  row('Kind', spec.kind);
  row('Material', spec.material);
  row('Height', `${d.heightMm} mm`);
  row('Diameter at the rim (top)', `${d.topDiaMm} mm`);
  row('Diameter at the base (bottom)', `${d.bottomDiaMm} mm`);
  row('Handle', spec.handle ? `${spec.handle.widthMm} mm wide, from ${spec.handle.y0Mm} to ${spec.handle.y1Mm} mm below the rim` : 'none');
  section('Print band');
  row('Starts below the rim', `${pr.topMm} mm`);
  row('Height (vertical)', `${pr.heightMm} mm`);
  row('Diameter at its top / bottom edge', `${pr.d1Mm} / ${pr.d2Mm} mm`);
  row('Seam gap / safe margin', `${pr.gapMm} / ${pr.safeMm} mm`);
  row('Printed round the cup', `${deg(fan.phi)}° of 360°`);
  section(fan.template === 'fan' ? 'Fan template (tapered body)' : 'Straight wrap');
  if (fan.template === 'fan') {
    row('Outer radius Ro', `${r1(fan.Ro)} mm`);
    row('Inner radius Ri', `${r1(fan.Ri)} mm`);
    row('Sweep', `${deg(fan.theta)}°`);
    row('Fan box W x H', `${r1(fan.W)} x ${r1(fan.H)} mm`);
    row('Customer design (unrolled)', `${r1(fan.Wrect)} x ${r1(fan.Hrect)} mm (long arc x slant height)`);
    row('Short arc', `${r1(fan.phi * fan.r2)} mm`);
    row('Squeeze at the narrow edge', `${geom.squeezePct(fan)}% (narrow at the ${fan.wideTop ? 'bottom' : 'top'})`);
  } else {
    row('Wrap W x H', `${r1(fan.Wrect)} x ${r1(fan.Hrect)} mm`);
  }
  // A small drawing of the template.
  const top = doc.y + 16;
  const boxW = W;
  const boxH = Math.max(80, doc.page.height - 60 - top);
  const k = Math.min(boxW / fan.W, boxH / fan.H);
  const ox = 40 + (boxW - fan.W * k) / 2;
  const P = (pt) => [ox + pt[0] * k, top + pt[1] * k];
  const pts = outlinePoints(fan, 128).map(P);
  doc.save().lineWidth(1).strokeColor('#111111').fillColor('#f1f3f4');
  doc.moveTo(...pts[0]);
  for (const pt of pts.slice(1)) doc.lineTo(...pt);
  doc.closePath().fillAndStroke();
  doc.dash(3, { space: 3 }).lineWidth(0.6).moveTo(...P(geom.fanXY(0.5, 0, fan))).lineTo(...P(geom.fanXY(0.5, 1, fan))).stroke().undash();
  doc.restore();
  const tp = P(tick(fan, 0.5, 0, 0)[0]);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#111111').text('TOP', tp[0] + 4, Math.max(top - 10, tp[1] - 10), { lineBreak: false });
  doc.end();
  return done;
}

module.exports = { fanPng, fanPdf, templateSvg, templatePdf, specSheetPdf, fullFan: full };
