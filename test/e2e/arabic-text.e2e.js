'use strict';

/**
 * QA (25 Nov): Arabic text in the print files.
 *   1. Curved Arabic lost its last letter ("الحلوة" printed "الحلوذ"); flat Arabic sat off centre and
 *      ran past its box (cut at X = 0): Fabric sized each line by its letters measured one by one,
 *      narrower than the joined Arabic the browser draws. Every line is now as wide as it is drawn.
 *   4. A coloured word at the edge of a mixed line lost its first letter in the SVG.
 *   5. A background box: the text ran past the box, and the SVG cut the box's ends and the last letter.
 *   6. A line under a line in the other script was drawn in the box's direction ("!Happy New Year 2026").
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer, newContext, openEditor } = require('./helpers');

let srv;
let browser;

test.before(async () => {
  srv = await startServer();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
});

test.after(async () => {
  if (browser) await browser.close();
  if (srv) await srv.close();
});

/** The mug editor in Arabic, with in-page helpers (window.__ar) to place a text and read back its print files. */
async function setup() {
  const ctx = await newContext(browser);
  await ctx.addInitScript(() => localStorage.setItem('pod-lang', 'ar'));
  const page = await openEditor(ctx, srv.base, 'mug');
  await page.evaluate(() => {
    const ed = window.__editor;
    const T = window.__t;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__ar = {
      /** A new text from the first preset, typed in the side box, 60% of the print width, centred (or at the left edge). */
      async add(text, { curve = 0, bg = null, red = null, atLeft = false, scale = 0 } = {}) {
        const cv = ed.canvas;
        cv.discardActiveObject();
        cv.remove(...cv.getObjects());
        document.querySelector('#text-presets [data-i="0"]').click();
        for (let i = 0; i < 100 && !cv.getObjects().length; i++) await wait(50);
        const box = document.getElementById('p-text');
        box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(300);
        const o = cv.getObjects()[0];
        if (curve) {
          const c = document.getElementById('p-curve');
          c.value = String(curve);
          c.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (bg) o.set({ backgroundColor: bg });
        if (red) {
          const at = Array.from(o.text).join('').indexOf(red);
          o.setSelectionStyles({ fill: '#ff0000' }, at, at + Array.from(red).length);
        }
        o.initDimensions();
        const tr = ed.rects(ed.st.product.sides[0].id).trim;
        o.scale(scale || (tr.w * 0.6) / o.width);
        o.set({ originX: 'center', originY: 'center', left: tr.x + tr.w / 2, top: tr.y + tr.h / 2 });
        if (atLeft) o.set({ left: tr.x + o.getScaledWidth() / 2 });
        o.setCoords();
        o.dirty = true;
        cv.renderAll();
        return o;
      },
      /** Each line's width against the browser's own width of the line (in its own direction). */
      widths() {
        const o = ed.canvas.getObjects()[0];
        const m = document.createElement('canvas').getContext('2d');
        return o._textLines.map((l, i) => {
          m.font = o._getFontDeclaration();
          m.direction = window.POD_FX.lineRtl(o, i) ? 'rtl' : 'ltr';
          return { line: l.join(''), fabric: o.getLineWidth(i), browser: m.measureText(l.join('')).width };
        });
      },
      /** Ink (alpha >= 128) of the print PNG and of the SVG drawn by the browser at the same size, and the text's box, in print pixels. */
      async prints() {
        const side = ed.st.product.sides[0];
        const png = await ed.exportPrint(side);
        const svg = await ed.exportSvg(side);
        const pimg = await T.decode(png);
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
        const c = document.createElement('canvas');
        c.width = pimg.width;
        c.height = pimg.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, c.width, c.height);
        const simg = { width: c.width, height: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
        const o = ed.canvas.getObjects()[0];
        const { bleed } = ed.rects(side.id);
        const k = pimg.width / bleed.w;
        const r = o.getBoundingRect(true, true);
        return { png: T.ink(pimg), svg: T.ink(simg), box: { x0: (r.left - bleed.x) * k, x1: (r.left + r.width - bleed.x) * k }, svgText: svg };
      },
    };
  });
  return { ctx, page };
}

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} (${a.toFixed(2)} vs ${b.toFixed(2)})`);

test('1. Arabic text is as wide as the browser draws it: curved text keeps its last letter, flat text sits in its box', { timeout: 120000 }, async () => {
  const { ctx, page } = await setup();
  try {
    const birthday = 'عيد ميلاد سعيد يا منى الحلوة';
    for (const [text, opts] of [[birthday, { curve: 60 }], [birthday, { curve: -60 }], [birthday, { curve: 30 }], ['Happy عيد ميلاد سعيد', { curve: 30 }], [birthday, {}], [birthday, { atLeft: true }]]) {
      const label = `"${text}" ${JSON.stringify(opts)}`;
      await page.evaluate(([t, o]) => window.__ar.add(t, o).then(() => null), [text, opts]);
      for (const w of await page.evaluate(() => window.__ar.widths())) close(w.fabric, w.browser, 0.5, `${label}: the line is as wide as the browser draws it`);
      if (opts.curve) {
        // The straight line drawn before it is bent: no letter reaches the edge of that picture (where it was cut off).
        const edges = await page.evaluate(() => {
          const o = window.__editor.canvas.getObjects()[0];
          const c = o._curveCache && o._curveCache.canvas;
          if (!c) return null;
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let x0 = c.width;
          let x1 = -1;
          for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
          const pad = Math.ceil((o.strokeWidth || 0) + o.fontSize * 0.15) * (c.width / (o._straightW + 2 * Math.ceil((o.strokeWidth || 0) + o.fontSize * 0.15)));
          return { x0, x1, w: c.width, pad };
        });
        assert.ok(edges, `${label}: curved text is drawn`);
        assert.ok(edges.x0 > edges.pad / 2 && edges.x1 < edges.w - 1 - edges.pad / 2, `${label}: the letters are inside the curved text's picture (ink ${edges.x0}..${edges.x1} of ${edges.w}, margin ${edges.pad.toFixed(1)})`);
      }
      const p = await page.evaluate(() => window.__ar.prints().then((r) => ({ png: r.png, svg: r.svg, box: r.box })));
      assert.ok(!p.png.empty && !p.svg.empty, `${label}: ink in both print files`);
      if (!opts.curve) {
        // Flat text: the ink is inside the text's box (so centred text is centred, and text at X = 0 is not cut).
        assert.ok(p.png.x >= p.box.x0 - 2 && p.png.x + p.png.w <= p.box.x1 + 2, `${label}: the ink (${p.png.x}..${p.png.x + p.png.w}) is inside the text's box (${p.box.x0.toFixed(0)}..${p.box.x1.toFixed(0)})`);
        if (opts.atLeft) assert.ok(p.png.x > 0, `${label}: the last letter is not cut at the print's edge`);
      }
      // The SVG shows the same as the PNG: nothing cut off either side.
      close(p.svg.x, p.png.x, 3, `${label}: the SVG's ink starts where the PNG's does`);
      close(p.svg.x + p.svg.w, p.png.x + p.png.w, 3, `${label}: the SVG's ink ends where the PNG's does`);
    }
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('4/5. a coloured word at the edge of a mixed line and a background box are whole in the SVG', { timeout: 90000 }, async () => {
  const { ctx, page } = await setup();
  try {
    for (const [text, opts] of [['عيد ميلاد سعيد يا Ahmed', { red: 'Ahmed' }], ['Happy birthday يا أحمد', { red: 'Happy' }], ['عيد ميلاد سعيد يا منى الحلوة', { bg: '#ffd43b' }], ['عيد ميلاد سعيد يا منى الحلوة', { bg: '#ffd43b', curve: 40 }], ['Happy Birthday Mona!', { bg: '#ffd43b' }]]) {
      const label = `"${text}" ${JSON.stringify(opts)}`;
      await page.evaluate(([t, o]) => window.__ar.add(t, o).then(() => null), [text, opts]);
      const p = await page.evaluate(() => window.__ar.prints().then((r) => ({ png: r.png, svg: r.svg, box: r.box })));
      close(p.svg.x, p.png.x, 3, `${label}: the SVG's ink starts where the PNG's does`);
      close(p.svg.x + p.svg.w, p.png.x + p.png.w, 3, `${label}: the SVG's ink ends where the PNG's does`);
      if (opts.bg && !opts.curve) {
        // The letters are inside the text's box (the background box adds its padding round that box).
        const bare = await page.evaluate(async () => {
          const o = window.__editor.canvas.getObjects()[0];
          const bg = o.backgroundColor;
          o.set({ backgroundColor: '' });
          try {
            const r = await window.__ar.prints();
            return { png: r.png, box: r.box };
          } finally {
            o.set({ backgroundColor: bg });
          }
        });
        assert.ok(bare.png.x >= bare.box.x0 - 2 && bare.png.x + bare.png.w <= bare.box.x1 + 2, `${label}: the letters (${bare.png.x}..${bare.png.x + bare.png.w}) are inside the text's box (${bare.box.x0.toFixed(0)}..${bare.box.x1.toFixed(0)})`);
        assert.ok(p.png.x < p.box.x0 - 5 && p.png.x + p.png.w > p.box.x1 + 5, `${label}: the background box reaches past the text on both sides`);
      }
    }
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});

test('6. a line under a line in the other script reads in its own direction (canvas and SVG)', { timeout: 90000 }, async () => {
  const { ctx, page } = await setup();
  try {
    for (const [text, own] of [['كل سنة وانتي طيبة\nHappy New Year 2026!', 'Happy New Year 2026!'], ['Happy New Year 2026!\nكل سنة وانتي طيبة!', 'كل سنة وانتي طيبة!']]) {
      // The line drawn alone (a text of its own, which the browser lays out right) and as the second line.
      const res = await page.evaluate(async ([t, line]) => {
        const T = window.__t;
        /** The ink of the lower part of line `li` (below the line above's letters), as a mask of its own box. */
        const lineInk = (o, li) => {
          const c = o.clipPath;
          o.clipPath = null;
          o.dirty = true;
          const el = o.toCanvasElement({ multiplier: 2 });
          o.clipPath = c;
          o.dirty = true;
          const k = el.height / o.height;
          let top = 0;
          for (let i = 0; i < li; i++) top += o.getHeightOfLine(i);
          const y0 = Math.round((top + o.getHeightOfLine(li) * 0.35) * k);
          const y1 = Math.round((top + o.getHeightOfLine(li)) * k);
          const d = el.getContext('2d').getImageData(0, y0, el.width, y1 - y0);
          const img = { width: el.width, height: y1 - y0, data: d.data };
          const box = T.ink(img);
          return T.mask(img, box);
        };
        // Which direction each line is drawn in on the canvas.
        const drawn = [];
        const fill = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (s, ...rest) {
          drawn.push([s, this.direction]);
          return fill.call(this, s, ...rest);
        };
        let two;
        let one;
        try {
          // (Both at the same size, so they are drawn alike.)
          two = lineInk(await window.__ar.add(t, { scale: 1 }), 1);
          const svg = (await window.__ar.prints()).svgText;
          one = lineInk(await window.__ar.add(line, { scale: 1 }), 0);
          const iou = T.iou(two, one);
          const lineDir = (drawn.find((d) => d[0] === line) || [])[1];
          // The <text> element holding the line (and no other <text> in between).
          const inSvg = new RegExp(`<text direction="(\\w+)"[^>]*>(?:(?!</text>)[^])*?${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(svg);
          return { iou, lineDir, svgDir: inSvg && inSvg[1] };
        } finally {
          CanvasRenderingContext2D.prototype.fillText = fill;
        }
      }, [text, own]);
      const want = /[A-Za-z]/.test(own[0]) ? 'ltr' : 'rtl';
      assert.strictEqual(res.lineDir, want, `"${own}" under the other line is drawn ${want} on the canvas`);
      assert.strictEqual(res.svgDir, want, `"${own}" is ${want} in the SVG`);
      assert.ok(res.iou > 0.9, `"${own}" as the second line looks as it does alone (overlap ${res.iou.toFixed(3)})`);
    }
    assert.deepStrictEqual(page.errors, []);
  } finally {
    await ctx.close();
  }
});
