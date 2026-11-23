'use strict';

/**
 * Embroidery: turns a design (the print PNG) into machine stitches and a DST
 * file (Tajima, read by almost every embroidery machine).
 *
 * Automatic digitising, made for simple logos and bold text:
 *  1. The picture is reduced to at most 6 thread colours (each matched to a
 *     common thread shade); see-through and tiny specks are dropped.
 *  2. Every colour area is filled with rows of stitches 0.4 mm apart
 *     ("tatami" fill), stitches up to 3.5 mm long, staggered from row to row
 *     so no lines show. Rows go back and forth; gaps over 1.2 mm are jumps,
 *     long jumps get a trim.
 *  3. Colours are sewn one after the other with a colour change between.
 *
 * Units: DST moves are in 0.1 mm. Y grows upwards in DST.
 * Detailed artwork (photos, gradients, very fine lines) needs a person to
 * digitise it; the admin shows a warning for those.
 */
const sharp = require('sharp');

const ROW = 0.4; // mm between fill rows
const STITCH = 3.5; // mm longest stitch
const MIN_STITCH = 0.8; // mm shortest piece worth sewing
const JUMP_GAP = 1.2; // mm: gaps bigger than this are jumped
const TRIM_AFTER = 5; // mm: jumps this long get a trim (three tiny jumps, as most machines read it)
const PX_PER_MM = 5; // working resolution
const MAX_COLORS = 6;

/** Common embroidery thread shades (name, hex). */
const THREADS = [
  ['White', '#ffffff'], ['Snow', '#f4f4ef'], ['Black', '#111111'], ['Charcoal', '#3a3a3c'], ['Grey', '#8a8d91'], ['Silver', '#c3c6ca'],
  ['Red', '#d01c1f'], ['Dark red', '#8e1b22'], ['Orange', '#f2711c'], ['Coral', '#ff6b5a'], ['Yellow', '#ffd21f'], ['Gold', '#c9a227'],
  ['Cream', '#f3e5c0'], ['Beige', '#d8c3a0'], ['Brown', '#6b4226'], ['Tan', '#b08250'], ['Lime', '#9ccc3a'], ['Green', '#2e9b48'],
  ['Dark green', '#1c5b35'], ['Olive', '#6f7a32'], ['Mint', '#9fe0c3'], ['Teal', '#138f8c'], ['Turquoise', '#21b5c6'], ['Sky blue', '#7cc3ef'],
  ['Blue', '#1f6fd1'], ['Royal blue', '#2443a6'], ['Navy', '#1b2550'], ['Purple', '#6a3fa0'], ['Lavender', '#b49ad9'], ['Pink', '#f58fb7'],
  ['Hot pink', '#e23d8b'], ['Magenta', '#b5267a'], ['Peach', '#f7b58f'], ['Skin', '#e8b996'],
];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist2 = (a, b) => (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2 * 0.59 + (a[2] - b[2]) ** 2 * 0.11;
function nearestThread(c) {
  let best = THREADS[0];
  let bd = Infinity;
  for (const th of THREADS) {
    const d = dist2(c, rgb(th[1]));
    if (d < bd) [bd, best] = [d, th];
  }
  return { name: best[0], hex: best[1] };
}

/** Reduce the opaque pixels to at most k colours (k-means, seeded by popularity). */
function quantize(data, n, k) {
  const counts = new Map();
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const key = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const seeds = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const centres = [];
  for (const [key] of seeds) {
    const c = [((key >> 8) & 15) * 17, ((key >> 4) & 15) * 17, (key & 15) * 17];
    if (centres.every((x) => dist2(x, c) > 1600)) centres.push(c);
    if (centres.length >= k) break;
  }
  if (!centres.length) return { labels: new Int16Array(n).fill(-1), centres };
  const labels = new Int16Array(n).fill(-1);
  for (let iter = 0; iter < 6; iter++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] < 128) {
        labels[i] = -1;
        continue;
      }
      const p = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = dist2(p, centres[c]);
        if (d < bd) [bd, bi] = [d, c];
      }
      labels[i] = bi;
      const s = sums[bi];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    for (let c = 0; c < centres.length; c++) if (sums[c][3]) centres[c] = sums[c].slice(0, 3).map((v) => v / sums[c][3]);
  }
  // Colours that only show up as thin edges between two others (anti-aliasing) or
  // as specks: their pixels join the nearest real colour.
  const counts2 = centres.map(() => 0);
  let opaque = 0;
  for (let i = 0; i < n; i++) if (labels[i] >= 0) { counts2[labels[i]]++; opaque++; }
  const keep = centres.map((c, i) => counts2[i] >= Math.max(opaque * 0.03, PX_PER_MM * PX_PER_MM * 6));
  if (keep.some(Boolean) && keep.some((k) => !k)) {
    const remap = centres.map((c, i) => {
      if (keep[i]) return i;
      let bi = -1;
      let bd = Infinity;
      centres.forEach((o, j) => { if (keep[j] && dist2(c, o) < bd) [bd, bi] = [dist2(c, o), j]; });
      return bi;
    });
    for (let i = 0; i < n; i++) if (labels[i] >= 0) labels[i] = remap[labels[i]];
  }
  return { labels, centres };
}

/**
 * Stitches for one colour area: rows 0.4 mm apart, sewn back and forth,
 * each run split into stitches of up to 3.5 mm, staggered by row.
 *
 * The area is first cut into strips ("cells") that can each be sewn top to
 * bottom without leaving them: where a row has two pieces (the two sides of
 * an O) they become separate strips, sewn one after the other. Jumps then
 * only happen between strips, not on every row. Returns points in mm:
 * { x, y, jump }.
 */
function fillStitches(mask, W, H, start, under) {
  const rowPx = ROW * PX_PER_MM;
  // 1. The runs of this colour on every row.
  const rows = [];
  for (let yf = rowPx / 2, r = 0; yf < H; yf += rowPx, r++) {
    const y = Math.floor(yf);
    const runs = [];
    let x0 = -1;
    for (let x = 0; x <= W; x++) {
      const on = x < W && mask[y * W + x];
      if (on && x0 < 0) x0 = x;
      if (!on && x0 >= 0) {
        if (x - x0 >= MIN_STITCH * PX_PER_MM * 0.6) runs.push([x0, x - 1]);
        x0 = -1;
      }
    }
    // Gaps covered by a colour sewn later (letters on a badge) are sewn through,
    // so the background has no holes to jump around.
    if (under) {
      for (let k = runs.length - 1; k > 0; k--) {
        let covered = true;
        for (let x = runs[k - 1][1] + 1; x < runs[k][0] && covered; x++) if (!under[y * W + x]) covered = false;
        if (covered) {
          runs[k - 1][1] = runs[k][1];
          runs.splice(k, 1);
        }
      }
    }
    rows.push({ r, yf, runs });
  }
  // 2. Strips: a run continues a strip when they overlap one to one.
  const cells = [];
  let open = [];
  const overlaps = (a, b) => a[0] <= b[1] && a[1] >= b[0];
  for (const row of rows) {
    const next = [];
    for (const run of row.runs) {
      const cs = open.filter((c) => overlaps(c.last, run));
      if (cs.length === 1 && row.runs.filter((x) => overlaps(cs[0].last, x)).length === 1) {
        cs[0].rows.push({ r: row.r, yf: row.yf, a: run[0], b: run[1] });
        cs[0].last = run;
        next.push(cs[0]);
      } else {
        const c = { rows: [{ r: row.r, yf: row.yf, a: run[0], b: run[1] }], last: run };
        cells.push(c);
        next.push(c);
      }
    }
    open = next;
  }
  // 3. Sew the strips, nearest first, each from its nearer end.
  const pts = [];
  let cur = start;
  const todo = cells.slice();
  const endOf = (c, top) => {
    const rr = top ? c.rows[0] : c.rows[c.rows.length - 1];
    return { x: rr.a / PX_PER_MM, y: rr.yf / PX_PER_MM };
  };
  while (todo.length) {
    let bi = 0;
    let bTop = true;
    let bd = Infinity;
    todo.forEach((c, i) => {
      for (const top of [true, false]) {
        const e = endOf(c, top);
        const d = cur ? Math.hypot(e.x - cur.x, e.y - cur.y) : (top ? 0 : 1);
        if (d < bd) [bd, bi, bTop] = [d, i, top];
      }
    });
    const c = todo.splice(bi, 1)[0];
    const list = bTop ? c.rows : c.rows.slice().reverse();
    let dir = cur && cur.x > (list[0].a + list[0].b) / 2 / PX_PER_MM ? -1 : 1;
    for (const rr of list) {
      const ya = rr.yf / PX_PER_MM;
      const xa = (dir > 0 ? rr.a : rr.b + 1) / PX_PER_MM;
      const xb = (dir > 0 ? rr.b + 1 : rr.a) / PX_PER_MM;
      const len = Math.abs(xb - xa);
      const jump = !cur || Math.hypot(xa - cur.x, ya - cur.y) > JUMP_GAP;
      pts.push({ x: xa, y: ya, jump });
      // Staggered stitch ends: each row starts its pattern a third further along.
      const off = ((rr.r % 3) / 3) * STITCH;
      let p = off > 0.6 && off < len ? off : STITCH;
      while (p < len - MIN_STITCH * 0.5) {
        pts.push({ x: xa + Math.sign(xb - xa) * p, y: ya, jump: false });
        p += STITCH;
      }
      pts.push({ x: xb, y: ya, jump: false });
      cur = pts[pts.length - 1];
      dir = -dir;
    }
  }
  return pts;
}

/**
 * Digitise a design. png: the print file (transparent background);
 * widthMm, heightMm: its real size. Returns { colors: [{ name, hex, stitches }],
 * stitches: total, trims, widthMm, heightMm, warnings, plan } where plan is
 * the list of moves: { x, y (mm, from the top-left), type: 'stitch'|'jump'|'trim'|'color' }.
 */
async function digitize(png, widthMm, heightMm, { maxColors = MAX_COLORS } = {}) {
  const W = Math.max(8, Math.round(widthMm * PX_PER_MM));
  const H = Math.max(8, Math.round(heightMm * PX_PER_MM));
  const { data } = await sharp(png).resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = W * H;
  const warnings = [];
  // Many semi-transparent pixels or very many colours: a photo or a gradient.
  let soft = 0;
  let opaque = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a > 20 && a < 235) soft++;
    if (a >= 128) opaque++;
  }
  if (!opaque) return { colors: [], stitches: 0, trims: 0, widthMm, heightMm, warnings: ['empty'], plan: [] };
  if (soft > opaque * 0.15) warnings.push('soft');
  const { labels, centres } = quantize(data, n, maxColors);
  // Colour areas, largest first (big fills underneath, details on top).
  const areas = centres.map((c, ci) => {
    const mask = new Uint8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) if (labels[i] === ci) { mask[i] = 1; count++; }
    return { c, mask, count };
  }).filter((a) => a.count > PX_PER_MM * PX_PER_MM * 0.5).sort((a, b) => b.count - a.count);
  // Check how much of each colour is thinner than 1 mm (hard to sew).
  let thin = 0;
  let total = 0;
  for (const a of areas) {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!a.mask[i]) continue;
        total++;
        let run = 0;
        for (let d = -3; d <= 3; d++) if (x + d >= 0 && x + d < W && a.mask[i + d]) run++;
        let col = 0;
        for (let d = -3; d <= 3; d++) if (y + d >= 0 && y + d < H && a.mask[i + d * W]) col++;
        if (Math.min(run, col) < 4) thin++;
      }
    }
  }
  if (total && thin / total > 0.35) warnings.push('thin');
  const plan = [];
  const colors = [];
  let cur = null;
  let trims = 0;
  areas.forEach((a, idx) => {
    if (idx > 0) plan.push({ type: 'color' });
    // Pixels of the colours sewn after this one (smaller areas on top).
    const later = new Uint8Array(n);
    for (const b of areas.slice(idx + 1)) for (let i = 0; i < n; i++) if (b.mask[i]) later[i] = 1;
    const pts = fillStitches(a.mask, W, H, cur, later);
    let count = 0;
    for (const p of pts) {
      if (p.jump && cur) {
        const far = Math.hypot(p.x - cur.x, p.y - cur.y) > TRIM_AFTER;
        if (far) {
          plan.push({ type: 'trim' });
          trims++;
        }
        plan.push({ type: 'jump', x: p.x, y: p.y });
      } else plan.push({ type: 'stitch', x: p.x, y: p.y });
      if (!p.jump) count++;
      cur = p;
    }
    // Tie-off: two tiny stitches back and forth at the end of each colour.
    if (cur) plan.push({ type: 'stitch', x: cur.x - 0.3, y: cur.y }, { type: 'stitch', x: cur.x, y: cur.y });
    const th = nearestThread(a.c);
    colors.push({ ...th, stitches: count });
  });
  const stitches = plan.filter((p) => p.type === 'stitch').length;
  return { colors, stitches, trims, widthMm, heightMm, warnings, plan };
}

// ---------- DST (Tajima) ----------
const bit = (n) => 1 << n;
/** One 3-byte DST record for a move of (dx, dy) in 0.1 mm (|dx|, |dy| <= 121). */
function record(dx, dy, kind) {
  let x = dx;
  let y = dy;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0b00000011;
  if (kind === 'jump') b2 |= bit(7);
  if (kind === 'color') b2 |= bit(7) | bit(6);
  if (x > 40) { b2 |= bit(2); x -= 81; }
  if (x < -40) { b2 |= bit(3); x += 81; }
  if (x > 13) { b1 |= bit(2); x -= 27; }
  if (x < -13) { b1 |= bit(3); x += 27; }
  if (x > 4) { b0 |= bit(2); x -= 9; }
  if (x < -4) { b0 |= bit(3); x += 9; }
  if (x > 1) { b1 |= bit(0); x -= 3; }
  if (x < -1) { b1 |= bit(1); x += 3; }
  if (x > 0) { b0 |= bit(0); x -= 1; }
  if (x < 0) { b0 |= bit(1); x += 1; }
  if (y > 40) { b2 |= bit(5); y -= 81; }
  if (y < -40) { b2 |= bit(4); y += 81; }
  if (y > 13) { b1 |= bit(5); y -= 27; }
  if (y < -13) { b1 |= bit(4); y += 27; }
  if (y > 4) { b0 |= bit(5); y -= 9; }
  if (y < -4) { b0 |= bit(4); y += 9; }
  if (y > 1) { b1 |= bit(7); y -= 3; }
  if (y < -1) { b1 |= bit(6); y += 3; }
  if (y > 0) { b0 |= bit(7); y -= 1; }
  if (y < 0) { b0 |= bit(6); y += 1; }
  return [b0, b1, b2];
}
/** Reads one record back (for checks): { dx, dy, kind }. */
function readRecord(b0, b1, b2) {
  let dx = 0;
  let dy = 0;
  const has = (b, n) => (b & bit(n)) !== 0;
  if (has(b2, 2)) dx += 81;
  if (has(b2, 3)) dx -= 81;
  if (has(b1, 2)) dx += 27;
  if (has(b1, 3)) dx -= 27;
  if (has(b0, 2)) dx += 9;
  if (has(b0, 3)) dx -= 9;
  if (has(b1, 0)) dx += 3;
  if (has(b1, 1)) dx -= 3;
  if (has(b0, 0)) dx += 1;
  if (has(b0, 1)) dx -= 1;
  if (has(b2, 5)) dy += 81;
  if (has(b2, 4)) dy -= 81;
  if (has(b1, 5)) dy += 27;
  if (has(b1, 4)) dy -= 27;
  if (has(b0, 5)) dy += 9;
  if (has(b0, 4)) dy -= 9;
  if (has(b1, 7)) dy += 3;
  if (has(b1, 6)) dy -= 3;
  if (has(b0, 7)) dy += 1;
  if (has(b0, 6)) dy -= 1;
  const kind = b2 === 0xf3 && !b0 && !b1 ? 'end' : (b2 & 0xc0) === 0xc0 ? 'color' : (b2 & 0x80) ? 'jump' : 'stitch';
  return { dx, dy, kind };
}

/**
 * The DST file for a digitised design. The design is centred on the hoop
 * centre (0, 0) as machines expect.
 */
function toDst(d, label = 'ONEOFF') {
  const recs = [];
  const cx = d.widthMm / 2;
  const cy = d.heightMm / 2;
  // Positions in 0.1 mm, centred, Y up.
  const pos = (p) => [Math.round((p.x - cx) * 10), Math.round((cy - p.y) * 10)];
  let x = 0;
  let y = 0;
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  let stitches = 0;
  let colorChanges = 0;
  const moveTo = (tx, ty, kind) => {
    // Long moves are split into jumps of at most 12.1 mm; the last part keeps the kind.
    let dx = tx - x;
    let dy = ty - y;
    const parts = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 121));
    for (let i = 1; i <= parts; i++) {
      const nx = Math.round(x + (dx * 1) / (parts - i + 1));
      const ny = Math.round(y + (dy * 1) / (parts - i + 1));
      const k = i < parts ? 'jump' : kind;
      recs.push(record(nx - x, ny - y, k));
      if (k === 'stitch') stitches++;
      dx -= nx - x;
      dy -= ny - y;
      x = nx;
      y = ny;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  };
  for (const p of d.plan) {
    if (p.type === 'color') {
      recs.push(record(0, 0, 'color'));
      colorChanges++;
    } else if (p.type === 'trim') {
      // A trim: three small jumps there and back (read as "cut" by Tajima machines).
      recs.push(record(2, 2, 'jump'), record(-4, -4, 'jump'), record(2, 2, 'jump'));
    } else {
      const [tx, ty] = pos(p);
      moveTo(tx, ty, p.type === 'jump' ? 'jump' : 'stitch');
    }
  }
  recs.push([0, 0, 0xf3]); // end
  const head = [
    `LA:${String(label).replace(/[^\x20-\x7e]/g, '').slice(0, 16).padEnd(16, ' ')}\r`,
    `ST:${String(recs.length).padStart(7, ' ')}\r`,
    `CO:${String(colorChanges).padStart(3, ' ')}\r`,
    `+X:${String(Math.abs(maxX)).padStart(5, ' ')}\r`,
    `-X:${String(Math.abs(minX)).padStart(5, ' ')}\r`,
    `+Y:${String(Math.abs(maxY)).padStart(5, ' ')}\r`,
    `-Y:${String(Math.abs(minY)).padStart(5, ' ')}\r`,
    `AX:${x >= 0 ? '+' : '-'}${String(Math.abs(x)).padStart(5, ' ')}\r`,
    `AY:${y >= 0 ? '+' : '-'}${String(Math.abs(y)).padStart(5, ' ')}\r`,
    `MX:+${String(0).padStart(5, ' ')}\r`,
    `MY:+${String(0).padStart(5, ' ')}\r`,
    `PD:******\r`,
  ].join('');
  const header = Buffer.alloc(512, 0x20);
  header.write(head, 0, 'latin1');
  header[head.length] = 0x1a;
  return { buffer: Buffer.concat([header, Buffer.from(recs.flat())]), stitches, colorChanges, extents: { minX, maxX, minY, maxY } };
}

/** A picture of the stitches (thread colours on the garment colour), for checking and for the customer. */
async function stitchPreview(d, { pxPerMm = 8, background = '#ffffff' } = {}) {
  const W = Math.ceil(d.widthMm * pxPerMm);
  const H = Math.ceil(d.heightMm * pxPerMm);
  const lines = [];
  let ci = 0;
  let prev = null;
  let path = '';
  const flush = () => {
    if (path) lines.push(`<path d="${path}" stroke="${d.colors[ci] ? d.colors[ci].hex : '#000'}"/>`);
    path = '';
  };
  for (const p of d.plan) {
    if (p.type === 'color') {
      flush();
      ci++;
      prev = null;
    } else if (p.type === 'jump' || p.type === 'trim') {
      if (p.type === 'jump') prev = p;
    } else {
      if (prev) path += `M${(prev.x * pxPerMm).toFixed(1)} ${(prev.y * pxPerMm).toFixed(1)}L${(p.x * pxPerMm).toFixed(1)} ${(p.y * pxPerMm).toFixed(1)}`;
      prev = p;
    }
  }
  flush();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${background}"/><g fill="none" stroke-width="${(0.38 * pxPerMm).toFixed(2)}" stroke-linecap="round">${lines.join('')}</g></svg>`;
  return sharp(Buffer.from(svg), { limitInputPixels: 2e8 }).png().toBuffer();
}

module.exports = { digitize, toDst, stitchPreview, record, readRecord, nearestThread, THREADS, MAX_COLORS };
