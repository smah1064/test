'use strict';

/**
 * Browser test for the caret on canvas text lines that mix Arabic and English
 * (public/js/bidi-caret.js).
 *
 * Run:  node --test test/e2e/bidi-caret.e2e.js
 * (needs Playwright + Chromium; the global install is found via `npm root -g`).
 *
 * Drives /editor in headless Chromium with real mouse clicks, aimed at the
 * places where the browser itself draws each letter (measured in a hidden copy
 * of the line, independently of the editor's code), then types. It checks:
 *   1. a click just after / before every word puts the caret there: drawn there,
 *      and a typed letter lands there (Backspace and Delete act there too)
 *   2. dragging over "Hello", double-clicking it and Shift+Right select exactly it,
 *      and the highlight covers exactly it
 *   3. the left / right arrows walk a mixed line one letter at a time across the screen
 *   4. Home / End go to the start / end of the line in reading order, as in a textarea of the
 *      same direction (Fabric swapped them in right-to-left text boxes)
 *   5. colouring one word of a line written in the other script than the box's (English under
 *      Arabic, Arabic under English) moves no letter, on the canvas and in the print file, and
 *      the caret still lands where it is clicked on that line (public/js/fabric-ext.js)
 *   6. the reading order fabric-ext.js gives 840 lines (420 texts, each in both box directions:
 *      numbers, signs, brackets, Arabic and English) is the browser's own
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

/** In-page helpers: where the browser draws each letter of a line, in the text object's own coordinates. */
function installBidiHelpers() {
  window.__bidi = {
    obj: () => window.__editor.canvas.getActiveObject(),
    toPage(x, y) {
      const c = window.__editor.canvas;
      const o = this.obj();
      let p = fabric.util.transformPoint({ x, y }, o.calcTransformMatrix());
      p = fabric.util.transformPoint(p, c.viewportTransform);
      const r = c.upperCanvasEl.getBoundingClientRect();
      const k = r.width / (c.upperCanvasEl.width / c.getRetinaScaling());
      return { x: r.left + p.x * k, y: r.top + p.y * k };
    },
    /**
     * A one-colour line is drawn by one fillText from its start edge: the browser's own layout of the same text,
     * in the line's own direction (its first letter's, as the side text box shows it: QA 25 Nov).
     */
    line(li) {
      const o = this.obj();
      const g = o._textLines[li];
      const lineRtl = window.POD_FX.lineRtl(o, li);
      const div = document.createElement('div');
      div.style.cssText = `position:fixed;left:0;top:0;white-space:pre;visibility:hidden;font:${o._getFontDeclaration()};direction:${lineRtl ? 'rtl' : 'ltr'};unicode-bidi:isolate`;
      div.textContent = g.join('');
      document.body.appendChild(div);
      const box = div.getBoundingClientRect();
      const rtl = o.direction === 'rtl'; // Fabric gives the line's start in the box's direction
      const start = o._getLeftOffset() + o._getLineLeftOffset(li);
      const x0 = rtl ? start - box.width : start;
      const range = document.createRange();
      let off = 0;
      const boxes = g.map((ch) => {
        range.setStart(div.firstChild, off);
        range.setEnd(div.firstChild, off + ch.length);
        off += ch.length;
        const rs = Array.from(range.getClientRects());
        return { x0: x0 + Math.min(...rs.map((q) => q.left)) - box.left, x1: x0 + Math.max(...rs.map((q) => q.right)) - box.left };
      });
      div.remove();
      const levels = window.POD_FX.bidiLevels(g, lineRtl);
      let top = -o.height / 2;
      for (let i = 0; i < li; i++) top += o.getHeightOfLine(i);
      let first = 0;
      for (let i = 0; i < li; i++) first += o._textLines[i].length + 1;
      return { boxes, levels, first, y: top + (o.getHeightOfLine(li) / o.lineHeight) * 0.55, scale: o.scaleX * window.__editor.canvas.getZoom() };
    },
    caretX() {
      const b = this.obj()._getCursorBoundaries();
      return b.left + b.leftOffset;
    },
    state() {
      const o = this.obj();
      return { text: o.text, s: o.selectionStart, e: o.selectionEnd, editing: o.isEditing, sel: Array.from(o.text).slice(o.selectionStart, o.selectionEnd).join('') };
    },
    /** Columns of the top canvas holding the selection highlight on the row through page y. */
    highlight(pageY) {
      const el = window.__editor.canvas.upperCanvasEl;
      const r = el.getBoundingClientRect();
      const row = el.getContext('2d').getImageData(0, Math.round(((pageY - r.top) * el.height) / r.height), el.width, 1).data;
      const out = [];
      let s = -1;
      for (let x = 0; x <= el.width; x++) {
        const on = x < el.width && row[x * 4 + 3] > 20;
        if (on && s < 0) s = x;
        if (!on && s >= 0) {
          out.push([r.left + (s * r.width) / el.width, r.left + (x * r.width) / el.width]);
          s = -1;
        }
      }
      return out;
    },
  };
}

/** Editor page with one text from the Text tool's first preset; returns small drivers. */
async function setup(lang) {
  const ctx = await newContext(browser);
  if (lang === 'ar') await ctx.addInitScript(() => localStorage.setItem('pod-lang', 'ar'));
  const page = await openEditor(ctx, srv.base, 'mug');
  await page.evaluate(installBidiHelpers);
  await page.click('[data-flyout="text"]');
  await page.click('#text-presets [data-i="0"]');
  await page.waitForFunction(() => window.__bidi.obj() && window.__bidi.obj().type === 'i-text');
  await page.evaluate(() => document.querySelectorAll('.flyout').forEach((f) => { f.hidden = true; }));
  let last = 0;
  const d = {
    page,
    ctx,
    state: () => page.evaluate(() => window.__bidi.state()),
    caretX: () => page.evaluate(() => window.__bidi.caretX()),
    line: (li) => page.evaluate((i) => window.__bidi.line(i), li),
    toPage: (x, y) => page.evaluate(([a, b]) => window.__bidi.toPage(a, b), [x, y]),
    /** A click (far enough from the last one not to count as a double click). */
    async click(p) {
      const wait = 650 - (Date.now() - last);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.mouse.click(p.x, p.y);
      last = Date.now();
      await page.waitForTimeout(60);
    },
    async edit() {
      for (let k = 0; k < 2 && !(await d.state()).editing; k++) await d.click(await d.toPage(0, 0));
      assert.ok((await d.state()).editing, 'the text is being edited');
    },
    /** Type a new text into the canvas text, fit it into view, and edit it again. */
    async setText(text) {
      await d.edit();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(text);
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        const c = window.__editor.canvas;
        const o = window.__bidi.obj();
        const r = c.upperCanvasEl.getBoundingClientRect();
        const z = c.getZoom() * (r.width / (c.upperCanvasEl.width / c.getRetinaScaling()));
        const s = Math.min(1, (0.8 * r.width) / (o.width * z));
        o.set({ scaleX: s, scaleY: s });
        const now = window.__bidi.toPage(0, 0);
        o.set({ left: o.left + (r.left + r.width / 2 - now.x) / z });
        o.setCoords();
        c.requestRenderAll();
      });
      assert.strictEqual((await d.state()).text, text);
      await d.edit();
    },
    /** Wait until the canvas stops moving (the editor's notices above it come and go a moment after typing). */
    async settle() {
      const geo = () => page.evaluate(() => {
        const c = window.__editor.canvas;
        const r = c.upperCanvasEl.getBoundingClientRect();
        return [r.left, r.top, r.width, ...c.viewportTransform].map((v) => v.toFixed(1)).join(',');
      });
      let last = await geo();
      let since = Date.now();
      const t0 = Date.now();
      while (Date.now() - since < 450 && Date.now() - t0 < 3000) {
        await page.waitForTimeout(90);
        const g = await geo();
        if (g !== last) {
          last = g;
          since = Date.now();
        }
      }
    },
    /** Page point just inside the left / right edge of letter i of line li (stays inside the text's box). */
    async at(L, i, side, inset = 3) {
      await d.settle();
      const b = L.boxes[i];
      const k = inset / L.scale;
      const x = side === 'right' ? b.x1 - k : side === 'left' ? b.x0 + k : (b.x0 + b.x1) / 2;
      const w = await page.evaluate(() => window.__bidi.obj().width / 2);
      return d.toPage(Math.max(-w + 2 / L.scale, Math.min(w - 2 / L.scale, x)), L.y);
    },
  };
  return d;
}

const insert = (text, pos, s) => { const a = Array.from(text); a.splice(pos, 0, s); return a.join(''); };

/** Click just after and just before every word of the text; check the caret, type there, Backspace it. */
async function clickEveryWord(d, text, label) {
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const L = await d.line(li);
    const g = Array.from(lines[li]);
    for (let i = 0; i < g.length; i++) {
      if (g[i] === ' ' || (i > 0 && g[i - 1] !== ' ')) continue;
      let j = i;
      while (j < g.length && g[j] !== ' ') j++;
      const word = g.slice(i, j).join('');
      for (const where of ['after', 'before']) {
        const k = where === 'after' ? j - 1 : i; // the letter at that end of the word
        const rtl = L.levels[k] % 2 === 1;
        const side = (where === 'after') !== rtl ? 'right' : 'left';
        await d.click(await d.at(L, k, side));
        const pos = L.first + (where === 'after' ? j : i);
        const s = await d.state();
        assert.deepStrictEqual([s.s, s.e], [pos, pos], `${label}: click ${where} "${word}" puts the caret at ${pos}`);
        const edge = side === 'right' ? L.boxes[k].x1 : L.boxes[k].x0;
        const cx = await d.caretX();
        assert.ok(Math.abs(cx - edge) <= 3 / L.scale + 1, `${label}: the caret is drawn ${where} "${word}" (${cx.toFixed(1)} vs ${edge.toFixed(1)})`);
        const marker = /[\u0600-\u06FF]/.test(word) ? 'ب' : 'X';
        await d.page.keyboard.type(marker);
        assert.strictEqual((await d.state()).text, insert(text, pos, marker), `${label}: typed ${where} "${word}"`);
        await d.page.keyboard.press('Backspace');
        assert.strictEqual((await d.state()).text, text, `${label}: Backspace takes it back`);
        if (where === 'before') {
          await d.page.keyboard.press('Delete');
          assert.strictEqual((await d.state()).text, Array.from(text).filter((_, n) => n !== pos).join(''), `${label}: Delete before "${word}" removes its first letter`);
          await d.page.keyboard.insertText(Array.from(text)[pos]);
          assert.strictEqual((await d.state()).text, text);
        }
      }
    }
  }
}

test('1. clicking after / before each word of a mixed Arabic-English line puts the caret there', { timeout: 150000 }, async () => {
  for (const lang of ['en', 'ar']) {
    const d = await setup(lang);
    try {
      const cases = lang === 'ar'
        ? ['مرحبا Hello 2026 يا عالم']
        : ['مرحبا Hello 2026 يا عالم', 'Hello مرحبا world', 'اطلب 3 iPhone 16 Pro الآن', 'السعر (USD) 250', 'مرحبا Hello\nWorld 2026 عالم', 'مرحبا يا عالم', 'Hello big world'];
      for (const text of cases) {
        await d.setText(text);
        await clickEveryWord(d, text, `${lang} UI, "${text}"`);
      }
      assert.deepStrictEqual(d.page.errors, []);
    } finally {
      await d.ctx.close();
    }
  }
});

test('2. selecting "Hello" inside Arabic text selects and highlights exactly it', { timeout: 60000 }, async () => {
  const d = await setup('en');
  try {
    const text = 'مرحبا Hello 2026 يا عالم';
    await d.setText(text);
    const L = await d.line(0);
    const h = Array.from(text).indexOf('H');
    const a = await d.at(L, h, 'left', 2);
    const b = await d.at(L, h + 4, 'right', 2);
    const covered = async (how) => {
      assert.strictEqual((await d.state()).sel, 'Hello', `${how} selects "Hello"`);
      const p0 = await d.toPage(L.boxes[h].x0, L.y);
      const p1 = await d.toPage(L.boxes[h + 4].x1, L.y);
      const spans = await d.page.evaluate((y) => window.__bidi.highlight(y), p0.y);
      assert.strictEqual(spans.length, 1, `${how}: one highlight block`);
      assert.ok(Math.abs(spans[0][0] - p0.x) <= 3 && Math.abs(spans[0][1] - p1.x) <= 3, `${how}: the highlight covers "Hello" (${spans[0].map((v) => v.toFixed(1))} vs ${p0.x.toFixed(1)},${p1.x.toFixed(1)})`);
    };
    // drag from before "H" to after "o"
    await d.page.waitForTimeout(700);
    await d.page.mouse.move(a.x, a.y);
    await d.page.mouse.down();
    await d.page.mouse.move(b.x, b.y, { steps: 12 });
    await d.page.mouse.up();
    await covered('dragging');
    // double click
    await d.page.waitForTimeout(700);
    const m = await d.at(L, h + 2, 'mid');
    await d.page.mouse.dblclick(m.x, m.y);
    await covered('double-clicking');
    // Shift + Right arrow five times from before "H"
    await d.click(a);
    for (let k = 0; k < 5; k++) await d.page.keyboard.press('Shift+ArrowRight');
    await covered('Shift+Right');
    assert.deepStrictEqual(d.page.errors, []);
  } finally {
    await d.ctx.close();
  }
});

test('3. the arrow keys walk a mixed line one letter at a time across the screen', { timeout: 60000 }, async () => {
  const d = await setup('en');
  try {
    for (const text of ['مرحبا Hello 2026 يا عالم', 'Hello مرحبا world']) {
      await d.setText(text);
      const L = await d.line(0);
      const n = L.boxes.length;
      const left = L.boxes.reduce((m, b, i) => (b.x0 < L.boxes[m].x0 ? i : m), 0);
      const right = L.boxes.reduce((m, b, i) => (b.x1 > L.boxes[m].x1 ? i : m), 0);
      for (const [key, from, side, sign] of [['ArrowRight', left, 'left', 1], ['ArrowLeft', right, 'right', -1]]) {
        await d.click(await d.at(L, from, side, 0.3 * (L.boxes[from].x1 - L.boxes[from].x0) * L.scale));
        let x = await d.caretX();
        for (let k = 0; k < n; k++) {
          await d.page.keyboard.press(key);
          const nx = await d.caretX();
          assert.ok(sign * (nx - x) > 0.5, `"${text}": ${key} press ${k + 1} moves the caret ${sign > 0 ? 'right' : 'left'} (${x.toFixed(1)} → ${nx.toFixed(1)})`);
          x = nx;
        }
      }
    }
    assert.deepStrictEqual(d.page.errors, []);
  } finally {
    await d.ctx.close();
  }
});

test('4. Home / End go to the start / end of the line in reading order, as in a textarea', { timeout: 90000 }, async () => {
  for (const [lang, text] of [['ar', 'مرحبا Hello 2026 يا عالم\nSecond line here'], ['en', 'Hello\nأحب مصر جدا']]) {
    const d = await setup(lang);
    try {
      await d.setText(text);
      const dir = await d.page.evaluate(() => window.__bidi.obj().direction);
      assert.strictEqual(dir, lang === 'ar' ? 'rtl' : 'ltr');
      const keys = ['Home', 'End', 'Shift+Home', 'Shift+End'];
      const probes = [];
      let first = 0;
      for (const line of text.split('\n')) {
        const n = Array.from(line).length;
        probes.push(first, first + Math.floor(n / 2), first + n);
        first += n + 1;
      }
      const canvas = [];
      for (const pos of probes) {
        for (const key of keys) {
          await d.page.evaluate((p) => {
            const o = window.__bidi.obj();
            o.selectionStart = o.selectionEnd = p;
            o._updateTextarea();
          }, pos);
          await d.page.keyboard.press(key);
          const s = await d.state();
          canvas.push([s.s, s.e]);
        }
      }
      // The same key presses in a plain textarea of the same direction (these texts are one UTF-16 unit per letter).
      await d.page.keyboard.press('Escape');
      await d.page.evaluate(([t, dr]) => {
        const ta = document.createElement('textarea');
        ta.id = 'oracle';
        ta.dir = dr;
        ta.value = t;
        ta.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:200px;z-index:99999';
        document.body.appendChild(ta);
      }, [text, dir]);
      let k = 0;
      for (const pos of probes) {
        for (const key of keys) {
          await d.page.evaluate((p) => { const ta = document.getElementById('oracle'); ta.focus(); ta.setSelectionRange(p, p); }, pos);
          await d.page.keyboard.press(key);
          const want = await d.page.evaluate(() => { const ta = document.getElementById('oracle'); return [ta.selectionStart, ta.selectionEnd]; });
          assert.deepStrictEqual(canvas[k++], want, `${dir} box "${text}": ${key} from ${pos} goes where a textarea goes`);
        }
      }
      assert.deepStrictEqual(d.page.errors, []);
    } finally {
      await d.ctx.close();
    }
  }
});

test('5. colouring one word of a line in the other script than the box moves no letter (canvas, print file, caret)', { timeout: 120000 }, async () => {
  for (const [lang, text, word] of [['ar', 'مرحبا بكم\nSecond line here', 'line'], ['en', 'Hello\nأحب مصر جدا', 'مصر']]) {
    const d = await setup(lang);
    try {
      await d.setText(text);
      await d.page.keyboard.press('Escape');
      /** Where the ink is (alpha >= 100), colour left out: the text drawn alone, and the print file. */
      const masks = () => d.page.evaluate(async () => {
        const ed = window.__editor;
        const o = window.__bidi.obj();
        const clip = o.clipPath;
        o.clipPath = null;
        let el;
        try {
          el = o.toCanvasElement({ multiplier: 2 });
        } finally {
          o.clipPath = clip;
        }
        const own = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
        const print = (await window.__t.decode(await ed.exportPrint({ id: ed.st.side }))).data;
        const bits = (data) => { const m = []; for (let i = 3; i < data.length; i += 4) m.push(data[i] >= 100 ? 1 : 0); return m.join(''); };
        return { own: bits(own), print: bits(print) };
      });
      const moved = (a, b) => {
        let diff = 0;
        let ink = 0;
        for (let i = 0; i < a.length; i++) {
          if (a[i] === '1' || b[i] === '1') ink++;
          if (a[i] !== b[i]) diff++;
        }
        return a.length === b.length && ink > 0 ? diff / ink : 1;
      };
      const plain = await masks();
      // Colour the word as a customer does: its button under "colour one word", then a colour.
      const wi = text.split(/\s+/).indexOf(word);
      await d.page.click(`.word-chip[data-word="${wi}"]`);
      await d.page.click('[data-pal="word"] >> nth=3');
      const styles = await d.page.evaluate(() => window.__bidi.obj().styles);
      assert.strictEqual(Object.keys(styles[1] || {}).length, Array.from(word).length, `"${word}" is coloured`);
      const coloured = await masks();
      for (const where of ['own', 'print']) {
        const r = moved(plain[where], coloured[where]);
        assert.ok(r < 0.003, `${lang} UI, "${text}" with "${word}" coloured: ${(r * 100).toFixed(2)}% of the ink moved (${where === 'own' ? 'canvas' : 'print file'})`);
      }
      // The caret on the coloured line: a click after / before each word lands there.
      await d.edit();
      await clickEveryWord(d, text, `${lang} UI, "${word}" coloured`);
      assert.deepStrictEqual(d.page.errors, []);
    } finally {
      await d.ctx.close();
    }
  }
});

test('6. the reading order of 840 lines (both box directions) is the browser\'s own', { timeout: 60000 }, async () => {
  const words = ['مرحبا', 'Hello', '2026', 'يا', 'عالم', 'iPhone', '16', 'Pro', 'الآن', '3D', '2x1', '10:30', '2.5', '٥٠٪', '$5', '50%', '(Hello)', '(مرحبا)', '-', '!', '؟', '،', ',', '.', '"Hi"', 'A-B', 'كيلو', '#1', '+20', 'ok?', 'لا', 'e-mail', '@user', '٢٠٢٦', 'x', 'ب'];
  const lines = ['abc def)', 'Pro (مرحبا) 5', 'السعر (USD) 250 جنيه', 'مرحبا Hello 2026 يا عالم', 'Hello مرحبا world', 'اطلب 3 iPhone 16 Pro الآن', 'abcمرحبا', 'مرحباabc', 'Price (USD) 5', 'السعر (USD) 5', 'abc (def)', 'مرحبا (abc) عالم', 'abc (مرحبا) def', 'عرض 3D جديد', 'خصم ٥٠٪ النهارده', 'Hello !', 'مرحبا !', '1 2 3', ' مرحبا ', ' Hello ', 'Second line here', 'أحب مصر جدا'];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  while (lines.length < 420) {
    const parts = [];
    for (let k = 1 + Math.floor(rnd() * 6); k > 0; k--) parts.push(words[Math.floor(rnd() * words.length)]);
    lines.push(parts.join(rnd() < 0.85 ? ' ' : ''));
  }
  const ctx = await newContext(browser);
  try {
    const page = await openEditor(ctx, srv.base, 'mug');
    const bad = await page.evaluate((all) => {
      const out = [];
      for (const text of all) for (const rtl of [true, false]) {
        const line = Array.from(text);
        // The browser's order: the letters sorted by where it draws them.
        const div = document.createElement('div');
        div.style.cssText = `position:fixed;left:0;top:0;white-space:pre;font:40px Cairo;direction:${rtl ? 'rtl' : 'ltr'};unicode-bidi:isolate`;
        div.textContent = text;
        document.body.appendChild(div);
        const range = document.createRange();
        let off = 0;
        const xs = line.map((g) => {
          range.setStart(div.firstChild, off);
          range.setEnd(div.firstChild, (off += g.length));
          const rs = Array.from(range.getClientRects());
          return (Math.min(...rs.map((q) => q.left)) + Math.max(...rs.map((q) => q.right))) / 2;
        });
        div.remove();
        const dom = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
        const ours = [];
        for (const run of window.POD_FX.bidiOrder(window.POD_FX.bidiRuns(line, rtl))) {
          const idx = [];
          for (let i = run.start; i < run.end; i++) idx.push(i);
          ours.push(...(run.rtl ? idx.reverse() : idx));
        }
        if (dom.join() !== ours.join()) out.push(`${rtl ? 'rtl' : 'ltr'} box "${text}": browser ${dom.map((i) => line[i]).join('')} / ours ${ours.map((i) => line[i]).join('')}`);
      }
      return out;
    }, lines);
    assert.strictEqual(lines.length * 2, 840);
    assert.deepStrictEqual(bad, []);
  } finally {
    await ctx.close();
  }
});
