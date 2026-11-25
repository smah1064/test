/* Fabric.js extensions used by the editor:
 *   - curved text (`curve` -100..100) that keeps Arabic letters joined
 *   - a padded, rounded background box for text (`backgroundColor`)
 *   - photo shapes (`mask`) with an optional inner border
 *   - smart background removal for photos with a plain background
 */
(function () {
  'use strict';

  // ---------- Right-to-left text direction ----------
  // Fabric sets the canvas text direction only when the canvas element's
  // "dir" attribute differs from the text's. Every redraw of a cached text
  // resets the context, so from the second draw on the direction is left as
  // "inherit", which some browsers (Chrome/Edge on Windows) resolve to
  // left-to-right for canvases outside the page: Arabic text is then drawn
  // one text-width to the right and cut off. Clearing the attribute first
  // makes Fabric set the direction (and alignment) itself on every draw.
  const origRenderChars = fabric.Text.prototype._renderChars;
  fabric.Text.prototype._renderChars = function (method, ctx, line, left, top, lineIndex) {
    if (ctx && ctx.canvas && ctx.canvas.removeAttribute) ctx.canvas.removeAttribute('dir');
    if (styledBidiLine(this, line, lineIndex)) return renderBidiLine.call(this, method, ctx, line, left, top, lineIndex);
    if (otherWayLine(this, line, lineIndex)) return renderOtherWayLine.call(this, method, ctx, line, left, top, lineIndex);
    return origRenderChars.call(this, method, ctx, line, left, top, lineIndex);
  };

  // ---------- Each line in its own direction ----------
  // The side text box shows every line in the direction of its own first letter
  // (dir="auto": "Happy New Year 2026!" under an Arabic line still ends in "!"),
  // so the canvas and the print files do the same. Fabric draws every line in
  // the text box's direction; in a text with Arabic letters a line that starts
  // with a letter of the other script is drawn here instead (a text with no
  // right-to-left letters at all is left exactly as Fabric draws it).
  const DRAWN_ONE_BY_ONE = (o) => o.path || o.charSpacing || (o.textAlign || '').includes('justify');
  const textHasRtl = (o) => (o._textLines || []).some((l) => l.some((ch) => RTL_CH.test(ch)));
  /** Whether line `lineIndex` reads right to left (its first strong letter; the box's direction when it has none). */
  function lineRtl(o, lineIndex) {
    const boxRtl = o.direction === 'rtl';
    if (DRAWN_ONE_BY_ONE(o) || !textHasRtl(o)) return boxRtl;
    for (const ch of (o._textLines && o._textLines[lineIndex]) || []) {
      const t = bidiType(ch);
      if (t === 'L') return false;
      if (t === 'R' || t === 'AL') return true;
    }
    return boxRtl;
  }
  /** A line in one style that reads the other way than its text box: drawn by renderOtherWayLine. */
  function otherWayLine(o, line, lineIndex) {
    return Boolean(line && line.length) && !DRAWN_ONE_BY_ONE(o) && o.isEmptyStyles(lineIndex) && lineRtl(o, lineIndex) !== (o.direction === 'rtl');
  }
  /** Such a line, in one piece in its own direction, from its left edge (Fabric gives its start in the box's direction). */
  function renderOtherWayLine(method, ctx, line, left, top, lineIndex) {
    const lineHeight = this.getHeightOfLine(lineIndex);
    top -= (lineHeight * this._fontSizeFraction) / this.lineHeight;
    const x = this.direction === 'rtl' ? left - this.getLineWidth(lineIndex) : left;
    ctx.save();
    ctx.direction = lineRtl(this, lineIndex) ? 'rtl' : 'ltr';
    ctx.textAlign = 'left';
    this._renderChar(method, ctx, lineIndex, 0, line.join(''), x, top, lineHeight);
    ctx.restore();
  }

  // ---------- The width a line is really drawn at ----------
  // Fabric adds up the letters of a line measured one by one. Arabic letters
  // join up when the browser draws the whole line, so the line is drawn wider
  // (or narrower) than Fabric's sum: the box was too small for the text, a
  // curved line lost its last letter, a centred one sat off centre and a
  // background box did not cover it. Lines with right-to-left letters, and lines
  // drawn here in the other direction, take the width the browser draws them at.
  let measureCtx = null;
  /** The drawn width of line `lineIndex`, or null when Fabric's own sum is the drawn width. */
  function drawnLineWidth(o, lineIndex) {
    const line = o._textLines && o._textLines[lineIndex];
    if (!line || !line.length || DRAWN_ONE_BY_ONE(o) || !textHasRtl(o)) return null;
    measureCtx = measureCtx || fabric.util.createCanvasElement().getContext('2d');
    if (styledBidiLine(o, line, lineIndex)) {
      // Laid out piece by piece (renderBidiLine): the pieces side by side.
      return bidiLineLayout(o, measureCtx, line, 0, lineIndex).reduce((n, run) => n + run.w, 0);
    }
    if (!o.isEmptyStyles(lineIndex)) return null; // drawn by Fabric piece by piece
    const rtl = lineRtl(o, lineIndex);
    if (rtl === (o.direction === 'rtl') && !line.some((ch) => RTL_CH.test(ch))) return null; // English in an English box
    measureCtx.save();
    measureCtx.font = o._getFontDeclaration(o.getCompleteStyleDeclaration(lineIndex, 0));
    measureCtx.direction = rtl ? 'rtl' : 'ltr';
    const w = measureCtx.measureText(line.join('')).width;
    measureCtx.restore();
    return w;
  }
  const origMeasureLine = fabric.Text.prototype.measureLine;
  fabric.Text.prototype.measureLine = function (lineIndex) {
    const info = origMeasureLine.call(this, lineIndex);
    const w = drawnLineWidth(this, lineIndex);
    if (w != null && w > 0) info.width = w;
    return info;
  };

  // ---------- A word in another colour, on a line that is not plain text in the box's direction ----------
  // Fabric draws a line that has several colours piece by piece, in the order
  // the letters were typed, from the line's start in the box's direction. That
  // is only right for a line that runs the box's way all along. A line with
  // English and Arabic on it, or a line written in the other script than the
  // box's ("Second line here" under an Arabic first line, "أحب مصر جدا" under
  // "Hello") came out with its words in the wrong order; and Arabic pieces were
  // placed by Fabric's letter-by-letter (unjoined) widths, so the words around a
  // coloured one moved. Such lines are laid out here in reading order instead,
  // by the Unicode bidi rules (UAX #9) for one line of plain text: each letter
  // gets a level (even: left to right, odd: right to left), the line is split
  // into stretches of one level, the stretches are put in display order, and
  // each coloured piece is measured and drawn in its stretch's direction, from
  // where the browser starts the line in one colour. So a number and the
  // English letters around it ("3D", "2x1") stay together, and the line reads
  // and sits exactly as the browser shows it in one colour. A line in one
  // colour keeps the browser's own layout; so does an English line with a
  // coloured word in a left-to-right box (Fabric places it right).
  const RTL_CH = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
  /** Whether line `lineIndex` (with words in other colours or fonts) is drawn by renderBidiLine. */
  function styledBidiLine(o, line, lineIndex) {
    if (o.path || o.charSpacing || (o.textAlign || '').includes('justify') || !line || line.length < 2) return false;
    if (o.isEmptyStyles(lineIndex)) return false;
    // Right-to-left letters anywhere (Arabic joins its letters: Fabric's widths are off).
    if (line.some((ch) => RTL_CH.test(ch))) return true;
    // A line that reads the other way than its box (English under an Arabic first line).
    const rtl = lineRtl(o, lineIndex);
    if (rtl !== (o.direction === 'rtl')) return true;
    // Anything that does not run the box's way (English or numbers in a right-to-left box).
    return bidiLevels(line, rtl).some((lv) => lv !== (rtl ? 1 : 0));
  }
  /** The bidi type of one character (the types that matter for one line of text). */
  function bidiType(ch) {
    if (/[\p{Mn}\p{Me}]/u.test(ch)) return 'NSM'; // marks (Arabic vowel signs) go with the letter before them
    if (/[\u0660-\u0669\u066B\u066C\u0600-\u0605]/.test(ch)) return 'AN'; // Arabic-Indic digits
    if (/[0-9\u06F0-\u06F9\u00B2\u00B3\u00B9\u2070-\u2079\u2080-\u2089]/.test(ch)) return 'EN';
    if (/[+\-\u2212\uFE62\uFE63\uFF0B\uFF0D]/.test(ch)) return 'ES';
    if (/[,.:/\u00A0\u060C\u202F\u2044\uFE50\uFE52\uFE55\uFF0C\uFF0E\uFF0F\uFF1A]/.test(ch)) return 'CS';
    if (/[#$%\u00A2-\u00A5\u00B0\u00B1\u0609\u060A\u066A\u2030-\u2034\u20A0-\u20CF]/.test(ch)) return 'ET';
    if (/[\u0590-\u05FF\u07C0-\u085F\uFB1D-\uFB4F\u200F]/.test(ch)) return 'R';
    if (RTL_CH.test(ch)) return 'AL';
    if (/\s/.test(ch)) return 'WS';
    if (/[\p{L}\p{Nd}\p{Mc}\u200E]/u.test(ch)) return 'L';
    return 'ON';
  }
  // Paired brackets (Unicode BidiBrackets.txt): opening → closing.
  const OPEN_BRACKET = {
    '(': ')', '[': ']', '{': '}', '⁅': '⁆', '⁽': '⁾', '₍': '₎', '⌈': '⌉', '⌊': '⌋',
    '〈': '〉', '❨': '❩', '❪': '❫', '❬': '❭', '❮': '❯', '❰': '❱',
    '❲': '❳', '❴': '❵', '⟅': '⟆', '⟦': '⟧', '⟨': '⟩', '⟪': '⟫',
    '⟬': '⟭', '⟮': '⟯', '⦃': '⦄', '⦅': '⦆', '⦇': '⦈', '⦉': '⦊',
    '⦋': '⦌', '⦍': '⦐', '⦏': '⦎', '⦑': '⦒', '⦓': '⦔', '⦕': '⦖',
    '⦗': '⦘', '⧘': '⧙', '⧚': '⧛', '⧼': '⧽', '⸢': '⸣', '⸤': '⸥',
    '⸦': '⸧', '⸨': '⸩', '《': '》', '「': '」', '『': '』', '【': '】',
    '〔': '〕', '〖': '〗', '〘': '〙', '〚': '〛', '﹙': '﹚', '﹛': '﹜',
    '﹝': '﹞', '（': '）', '［': '］', '｛': '｝', '｟': '｠', '｢': '｣',
  };
  const CLOSE_BRACKET = new Set(Object.values(OPEN_BRACKET));
  const sameBracket = (ch) => (ch === '\u2329' ? '\u3008' : ch === '\u232A' ? '\u3009' : ch); // canonical equivalents
  /** UAX #9 BD16 + N0 on resolved types `t` (changed in place). */
  function bracketPairs(line, t, orig, baseRtl) {
    const n = t.length;
    const e = baseRtl ? 'R' : 'L';
    const strongOf = (x) => (x === 'L' ? 'L' : x === 'R' || x === 'EN' || x === 'AN' ? 'R' : null);
    const pairs = [];
    const stack = [];
    for (let i = 0; i < n; i++) {
      if (t[i] !== 'ON') continue;
      const ch = sameBracket(line[i]);
      if (OPEN_BRACKET[ch]) {
        if (stack.length === 63) break;
        stack.push({ close: OPEN_BRACKET[ch], at: i });
      } else if (CLOSE_BRACKET.has(ch)) {
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].close !== ch) continue;
          pairs.push([stack[k].at, i]);
          stack.length = k;
          break;
        }
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [open, close] of pairs) {
      let inside = null;
      for (let k = open + 1; k < close; k++) {
        const s = strongOf(t[k]);
        if (s === e) { inside = e; break; }
        if (s) inside = s;
      }
      if (!inside) continue;
      let d = e;
      if (inside !== e) {
        // Only the opposite direction inside: the brackets follow it when the text before them does too.
        let before = e;
        for (let k = open - 1; k >= 0; k--) {
          const s = strongOf(t[k]);
          if (s) { before = s; break; }
        }
        d = before;
      }
      for (const p of [open, close]) {
        t[p] = d;
        for (let k = p + 1; k < n && orig[k] === 'NSM'; k++) t[k] = d;
      }
    }
  }
  /** The bidi level of every character of a line (UAX #9 rules W1-W7, N0-N2, I1-I2 and L1). */
  function bidiLevels(line, baseRtl) {
    const n = line.length;
    const sos = baseRtl ? 'R' : 'L';
    const orig = line.map(bidiType);
    const t = orig.slice();
    // W1: a mark takes the type of the character before it.
    for (let i = 0; i < n; i++) if (t[i] === 'NSM') t[i] = i ? t[i - 1] : sos;
    // W2: a European number after Arabic letters is an Arabic number. W3: Arabic letters are R.
    let strong = sos;
    for (let i = 0; i < n; i++) {
      if (t[i] === 'L' || t[i] === 'R' || t[i] === 'AL') strong = t[i];
      else if (t[i] === 'EN' && strong === 'AL') t[i] = 'AN';
    }
    for (let i = 0; i < n; i++) if (t[i] === 'AL') t[i] = 'R';
    // W4: one separator between two numbers of a kind joins them (1.5, 10:30, 1+2).
    for (let i = 1; i < n - 1; i++) {
      if (t[i] === 'ES' && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN';
      else if (t[i] === 'CS' && (t[i - 1] === 'EN' || t[i - 1] === 'AN') && t[i + 1] === t[i - 1]) t[i] = t[i - 1];
    }
    // W5: currency and percent signs next to a European number join it.
    for (let i = 0; i < n; i++) {
      if (t[i] !== 'ET') continue;
      let j = i;
      while (j < n && t[j] === 'ET') j++;
      if ((i > 0 && t[i - 1] === 'EN') || (j < n && t[j] === 'EN')) for (let k = i; k < j; k++) t[k] = 'EN';
      i = j - 1;
    }
    // W6: other separators are neutral.
    for (let i = 0; i < n; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON';
    // W7: a European number after English letters reads with them.
    strong = sos;
    for (let i = 0; i < n; i++) {
      if (t[i] === 'L' || t[i] === 'R') strong = t[i];
      else if (t[i] === 'EN' && strong === 'L') t[i] = 'L';
    }
    // N0: a pair of brackets reads with the words inside it, so "(USD)" in Arabic
    // text or "abc (def)" in a right-to-left box keep both brackets in place.
    bracketPairs(line, t, orig, baseRtl);
    // N1/N2: spaces and marks take the direction around them when both sides agree
    // (numbers count as right-to-left here), else the text's own.
    const side = (x) => (x === 'L' ? 'L' : 'R');
    for (let i = 0; i < n; i++) {
      if (t[i] !== 'WS' && t[i] !== 'ON') continue;
      let j = i;
      while (j < n && (t[j] === 'WS' || t[j] === 'ON')) j++;
      const before = i > 0 ? side(t[i - 1]) : sos;
      const after = j < n ? side(t[j]) : sos;
      const d = before === after ? before : sos;
      for (let k = i; k < j; k++) t[k] = d;
      i = j - 1;
    }
    // I1/I2: the levels.
    const base = baseRtl ? 1 : 0;
    const levels = t.map((x) => (base ? (x === 'R' ? 1 : 2) : x === 'L' ? 0 : x === 'R' ? 1 : 2));
    // L1: spaces at the end of the line are at the text's own level.
    for (let i = n - 1; i >= 0 && orig[i] === 'WS'; i--) levels[i] = base;
    return levels;
  }
  /** Stretches of one level, in typing order: [{ rtl, level, start, end }]. */
  function bidiRuns(line, baseRtl) {
    const levels = bidiLevels(line, baseRtl);
    const runs = [];
    for (let i = 0; i < levels.length; i++) {
      const top = runs[runs.length - 1];
      if (top && top.level === levels[i]) top.end = i + 1;
      else runs.push({ rtl: levels[i] % 2 === 1, level: levels[i], start: i, end: i + 1 });
    }
    return runs;
  }
  /** The same stretches in display order, left to right (rule L2). */
  function bidiOrder(runs) {
    const out = runs.slice();
    if (!out.length) return out;
    const max = Math.max(...out.map((r) => r.level));
    const min = Math.min(...out.map((r) => r.level));
    for (let lev = max; lev >= (min % 2 ? min : min + 1); lev--) {
      for (let i = 0; i < out.length; i++) {
        if (out[i].level < lev) continue;
        let j = i;
        while (j < out.length && out[j].level >= lev) j++;
        out.splice(i, j - i, ...out.slice(i, j).reverse());
        i = j - 1;
      }
    }
    return out;
  }
  /**
   * Where such a line is drawn: its stretches in display order (left to right),
   * each with its pieces { text, first, last, w, x }. `left` is the line's start
   * as Fabric gives it (left edge, or right edge in a right-to-left box); `ctx`
   * is only used to measure. The line is read in its own direction (lineRtl).
   * The caret code (bidi-caret.js) uses the same layout.
   */
  function bidiLineLayout(o, ctx, line, left, lineIndex) {
    const rtl = o.direction === 'rtl';
    const runs = bidiRuns(line, lineRtl(o, lineIndex)); // the line read in its own direction
    let total = 0;
    ctx.save();
    for (const run of runs) {
      // Pieces of one colour/font inside the stretch, measured as they will be drawn.
      const pieces = [];
      let s = run.start;
      for (let i = run.start; i < run.end; i++) {
        if (i === run.end - 1 || fabric.util.hasStyleChanged(o.getCompleteStyleDeclaration(lineIndex, i), o.getCompleteStyleDeclaration(lineIndex, i + 1), false)) {
          const text = line.slice(s, i + 1).join('');
          ctx.font = o._getFontDeclaration(o.getCompleteStyleDeclaration(lineIndex, i));
          ctx.direction = run.rtl ? 'rtl' : 'ltr';
          pieces.push({ text, first: s, last: i, w: ctx.measureText(text).width });
          s = i + 1;
        }
      }
      // A right-to-left stretch shows its first piece on the right.
      run.pieces = run.rtl ? pieces.reverse() : pieces;
      run.w = pieces.reduce((n, p) => n + p.w, 0);
      total += run.w;
    }
    ctx.restore();
    // Fabric gives the line's start (its left edge, or its right edge in a right-to-left box),
    // already placed for the alignment, and draws a line in one colour from there with the
    // browser's widths: start there too, so no word moves when one is coloured. (The line's
    // width is this layout's own: see drawnLineWidth.)
    let x = rtl ? left - total : left;
    const order = bidiOrder(runs);
    for (const run of order) {
      for (const p of run.pieces) {
        p.x = x;
        x += p.w;
      }
    }
    return order;
  }
  function renderBidiLine(method, ctx, line, left, top, lineIndex) {
    const lineHeight = this.getHeightOfLine(lineIndex);
    top -= (lineHeight * this._fontSizeFraction) / this.lineHeight;
    const order = bidiLineLayout(this, ctx, line, left, lineIndex);
    ctx.save();
    ctx.textAlign = 'left';
    for (const run of order) {
      ctx.direction = run.rtl ? 'rtl' : 'ltr';
      for (const p of run.pieces) this._renderChar(method, ctx, lineIndex, p.last, p.text, p.x, top, lineHeight);
    }
    ctx.restore();
  }
  // Underline (and line-through, overline) of such a line: under each piece where it is drawn, in
  // its colour. (Fabric draws it by its own letter-by-letter places, in the box's direction: the
  // coloured stretch of the underline ended up under another word.) Fabric draws the other lines.
  const origDecoration = fabric.Text.prototype._renderTextDecoration;
  fabric.Text.prototype._renderTextDecoration = function (ctx, type) {
    if (!this[type] && !this.styleHas(type)) return;
    const lines = this._textLines;
    const own = lines.map((line, i) => styledBidiLine(this, line, i));
    if (!own.includes(true)) return origDecoration.call(this, ctx, type);
    // Fabric's line measures are kept in its caches: fill them before it sees our lines as empty ones.
    lines.forEach((line, i) => this._getLineLeftOffset(i) + this.getHeightOfLine(i));
    this._textLines = lines.map((line, i) => (own[i] ? [] : line));
    try {
      origDecoration.call(this, ctx, type);
    } finally {
      this._textLines = lines;
    }
    let top = this._getTopOffset();
    for (let i = 0; i < lines.length; i++) {
      const lh = this.getHeightOfLine(i);
      if (own[i] && (this[type] || this.styleHas(type, i))) {
        const baseline = top + (lh / this.lineHeight) * (1 - this._fontSizeFraction);
        for (const run of bidiLineLayout(this, ctx, lines[i], this._getLeftOffset() + this._getLineLeftOffset(i), i)) {
          for (const p of run.pieces) {
            const at = (prop) => this.getValueOfPropertyAt(i, p.first, prop);
            if (!at(type) || !at('fill')) continue;
            ctx.fillStyle = at('fill');
            ctx.fillRect(p.x, baseline + this.offsets[type] * this.getHeightOfChar(i, p.first) + (at('deltaY') || 0), p.w, this.fontSize / 15);
          }
        }
      }
      top += lh;
    }
  };

  // ---------- Curved text ----------
  // The text is drawn straight into an offscreen canvas at the current
  // device resolution, then bent along an arc in thin vertical slices. This
  // works for any script, because the browser shapes the whole line first.
  const TP = fabric.Text.prototype;
  TP.curve = 0;
  TP._dimensionAffectingProps = TP._dimensionAffectingProps.concat('curve');
  TP.cacheProperties = TP.cacheProperties.concat('curve');

  function geometry(o) {
    const w = o._straightW;
    const h = o._straightH;
    // Keep the radius at least as large as the text height.
    const maxTheta = Math.min(Math.PI, w / (h * 0.75));
    const theta = Math.max(0.01, (Math.min(Math.abs(o.curve), 100) / 100) * maxTheta);
    const R = w / theta;
    const half = theta / 2;
    const outer = R + h / 2;
    const inner = R - h / 2;
    return { w, h, theta, R, boxW: 2 * outer * Math.sin(Math.min(half, Math.PI / 2)), boxH: outer - inner * Math.cos(half) };
  }

  const origInit = TP.initDimensions;
  TP.initDimensions = function () {
    origInit.call(this);
    if (this.__skipDimension) return;
    this._straightW = this.width;
    this._straightH = this.height;
    if (this.curve && !this.isEditing) {
      const g = geometry(this);
      this.width = g.boxW;
      this.height = g.boxH;
    }
  };

  function fillKey(f) {
    return f && typeof f === 'object' ? JSON.stringify(f.colorStops || f) : String(f);
  }

  const origRender = TP._render;
  TP._render = function (ctx) {
    if (!this.curve || this.isEditing || !this._straightW) return origRender.call(this, ctx);
    const g = geometry(this);
    const m = ctx.getTransform();
    const dev = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d), 0.1);
    const pad = Math.ceil((this.strokeWidth || 0) + this.fontSize * 0.15);
    let res = Math.min(12, Math.max(1, Math.ceil(dev * 1.25 * 4) / 4));
    while ((g.w + pad * 2) * (g.h + pad * 2) * res * res > 30e6 && res > 1) res -= 0.5;
    const key = [this.text, this.fontFamily, this.fontSize, this.fontWeight, this.fontStyle, fillKey(this.fill), this.stroke, this.strokeWidth,
      this.charSpacing, this.lineHeight, this.textAlign, this.underline, this.linethrough, this.direction, this.paintFirst, g.w, g.h, res, JSON.stringify(this.styles || {})].join('|');
    if (!this._curveCache || this._curveCache.key !== key) {
      const c = fabric.util.createCanvasElement();
      c.width = Math.ceil((g.w + pad * 2) * res);
      c.height = Math.ceil((g.h + pad * 2) * res);
      const cx = c.getContext('2d');
      cx.scale(res, res);
      cx.translate(pad + g.w / 2, pad + g.h / 2);
      const saveW = this.width;
      const saveH = this.height;
      this.width = g.w;
      this.height = g.h;
      try {
        origRender.call(this, cx);
      } finally {
        this.width = saveW;
        this.height = saveH;
      }
      this._curveCache = { key, canvas: c };
    }
    const src = this._curveCache.canvas;
    const up = this.curve > 0; // rainbow; otherwise a smile
    const y0 = up ? -g.boxH / 2 + g.h / 2 + g.R : g.boxH / 2 - g.h / 2 - g.R;
    const slice = Math.min(g.w / 20, Math.max(0.2, 2 / dev));
    const overlap = 1 / dev;
    for (let x = -g.w / 2 - pad; x < g.w / 2 + pad; x += slice) {
      const phi = (x + slice / 2) / g.R;
      ctx.save();
      ctx.translate(g.R * Math.sin(phi), up ? y0 - g.R * Math.cos(phi) : y0 + g.R * Math.cos(phi));
      ctx.rotate(up ? phi : -phi);
      const sx = (x + g.w / 2 + pad) * res;
      const sw = Math.min(slice * res + 1, src.width - sx);
      if (sw > 0) ctx.drawImage(src, sx, 0, sw, src.height, -slice / 2, -(g.h / 2 + pad), sw / res + overlap, g.h + pad * 2);
      ctx.restore();
    }
  };

  // ---------- Text background box ----------
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Background shapes: box (rounded), pill, banner (notched ribbon ends), ticket (round notches).
  TP.bgShape = 'box';
  TP.cacheProperties = TP.cacheProperties.concat('bgShape');
  /** How far the background box reaches past the text on each side (object units). */
  function bgPadding(o) {
    const dim = o._getNonTransformedDimensions();
    const shape = o.bgShape || 'box';
    const py = o.fontSize * 0.15;
    const h = dim.y + py * 2;
    // Ribbons and tickets are cut in at the ends: widen them by the cut so it never reaches the letters.
    const cut = shape === 'banner' ? h * 0.32 : shape === 'ticket' ? h * 0.22 : 0;
    return { dim, shape, h, py, px: o.fontSize * 0.3 + cut };
  }
  TP._renderBackground = function (ctx) {
    if (!this.backgroundColor) return;
    const { dim, shape, h, py, px } = bgPadding(this);
    const x = -dim.x / 2 - px;
    const y = -dim.y / 2 - py;
    const w = dim.x + px * 2;
    ctx.fillStyle = this.backgroundColor;
    if (shape === 'pill') {
      roundRectPath(ctx, x, y, w, h, h / 2);
    } else if (shape === 'banner') {
      const n = Math.min(h * 0.32, w * 0.15);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w - n, y + h / 2);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + n, y + h / 2);
      ctx.closePath();
    } else if (shape === 'ticket') {
      const r = Math.min(h * 0.22, w * 0.1);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h / 2 - r);
      ctx.arc(x + w, y + h / 2, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + h / 2 + r);
      ctx.arc(x, y + h / 2, r, Math.PI / 2, -Math.PI / 2, true);
      ctx.closePath();
    } else {
      roundRectPath(ctx, x, y, w, h, this.fontSize * 0.25);
    }
    ctx.fill();
    this._removeShadow(ctx);
  };

  // ---------- Photo shapes ----------
  const IP = fabric.Image.prototype;
  IP.mask = null;
  IP.maskBorder = 0;
  IP.maskBorderColor = '#ffffff';
  IP.cacheProperties = IP.cacheProperties.concat('mask', 'maskBorder', 'maskBorderColor');
  IP.stateProperties = IP.stateProperties.concat('mask', 'maskBorder', 'maskBorderColor');

  const HEART = [[50, 88], ['C', 20, 66, 0, 48, 0, 28], ['C', 0, 12, 12, 0, 27, 0], ['C', 37, 0, 45, 5, 50, 14], ['C', 55, 5, 63, 0, 73, 0], ['C', 88, 0, 100, 12, 100, 28], ['C', 100, 48, 80, 66, 50, 88]];
  function polygon(ctx, n, w, h, innerRatio, rot) {
    const steps = innerRatio ? n * 2 : n;
    for (let i = 0; i < steps; i++) {
      const r = innerRatio && i % 2 ? innerRatio : 1;
      const a = rot + (i * Math.PI * 2) / steps;
      const x = (Math.cos(a) * r * w) / 2;
      const y = (Math.sin(a) * r * h) / 2;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  function maskPath(ctx, kind, w, h) {
    const x = -w / 2;
    const y = -h / 2;
    ctx.beginPath();
    switch (kind) {
      case 'circle':
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      case 'rounded':
        roundRectPath(ctx, x, y, w, h, Math.min(w, h) * 0.14);
        break;
      case 'heart': {
        const sx = w / 100;
        const sy = h / 88;
        const P = (px, py) => [x + px * sx, y + py * sy];
        ctx.moveTo(...P(HEART[0][0], HEART[0][1]));
        for (const c of HEART.slice(1)) ctx.bezierCurveTo(...P(c[1], c[2]), ...P(c[3], c[4]), ...P(c[5], c[6]));
        ctx.closePath();
        break;
      }
      case 'star':
        polygon(ctx, 5, w, h, 0.45, -Math.PI / 2);
        break;
      case 'hexagon':
        polygon(ctx, 6, w, h, 0, 0);
        break;
      case 'arch': {
        const rr = Math.min(w / 2, h / 2);
        ctx.moveTo(x, y + h);
        ctx.lineTo(x, y + rr);
        ctx.ellipse(0, y + rr, w / 2, rr, 0, Math.PI, 0);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        break;
      }
      default:
        ctx.rect(x, y, w, h);
    }
  }
  const origImgRender = IP._render;
  IP._render = function (ctx) {
    if (!this.mask) return origImgRender.call(this, ctx);
    ctx.save();
    maskPath(ctx, this.mask, this.width, this.height);
    ctx.clip();
    origImgRender.call(this, ctx);
    if (this.maskBorder > 0) {
      // Drawn inside the shape so it never spills past the photo.
      ctx.lineWidth = (this.maskBorder / 100) * Math.min(this.width, this.height) * 2;
      ctx.strokeStyle = this.maskBorderColor;
      maskPath(ctx, this.mask, this.width, this.height);
      ctx.stroke();
    }
    ctx.restore();
  };

  // ---------- Smart background removal ----------
  /**
   * Make the plain background around a picture transparent: starting from the
   * edges, flood-fill every connected pixel that is close to the edge colour.
   * Interior areas of the same colour (e.g. white eyes in a logo) are kept.
   * Resolves to a PNG Blob, or null when the edges are not a plain colour.
   */
  async function removeBackground(source, tolerance = 42) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const c = fabric.util.createCanvasElement();
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // Edge colour: average of opaque border pixels; bail out if they vary a lot.
    let n = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
    for (const p of border) {
      if (d[p * 4 + 3] < 16) continue;
      r += d[p * 4];
      g += d[p * 4 + 1];
      b += d[p * 4 + 2];
      n++;
    }
    if (!n) return null;
    r /= n;
    g /= n;
    b /= n;
    const dist = (p) => Math.abs(d[p * 4] - r) + Math.abs(d[p * 4 + 1] - g) + Math.abs(d[p * 4 + 2] - b);
    const near = border.filter((p) => d[p * 4 + 3] >= 16 && dist(p) < tolerance * 1.5).length;
    if (near < n * 0.5) return null;

    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    for (const p of border) {
      if (!seen[p] && (d[p * 4 + 3] < 16 || dist(p) < tolerance)) {
        seen[p] = 1;
        stack[top++] = p;
      }
    }
    while (top) {
      const p = stack[--top];
      d[p * 4 + 3] = 0;
      const x = p % w;
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of neighbours) {
        if (q < 0 || q >= w * h || seen[q]) continue;
        if (d[q * 4 + 3] < 16 || dist(q) < tolerance) {
          seen[q] = 1;
          stack[top++] = q;
        } else {
          seen[q] = 2; // edge pixel: soften below
        }
      }
    }
    // Soften the outline: edge pixels that are still fairly close to the background become semi-transparent.
    for (let p = 0; p < w * h; p++) {
      if (seen[p] !== 2) continue;
      const k = dist(p) / (tolerance * 2.5);
      if (k < 1) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * Math.max(0.15, k));
    }
    ctx.putImageData(img, 0, 0);
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  // ---------- SVG export ----------
  /** SVG markup for a photo shape, in the image's own coordinates. */
  function maskShapeSvg(kind, w, h, attrs) {
    const x = -w / 2;
    const y = -h / 2;
    const n = (v) => +v.toFixed(3);
    const poly = (count, inner, rot) => {
      const steps = inner ? count * 2 : count;
      const pts = [];
      for (let i = 0; i < steps; i++) {
        const r = inner && i % 2 ? inner : 1;
        const ang = rot + (i * Math.PI * 2) / steps;
        pts.push(`${n((Math.cos(ang) * r * w) / 2)},${n((Math.sin(ang) * r * h) / 2)}`);
      }
      return `<polygon points="${pts.join(' ')}" ${attrs}/>`;
    };
    switch (kind) {
      case 'circle': return `<ellipse cx="0" cy="0" rx="${n(w / 2)}" ry="${n(h / 2)}" ${attrs}/>`;
      case 'rounded': return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(w, h) * 0.14)}" ${attrs}/>`;
      case 'heart': {
        const sx = w / 100;
        const sy = h / 88;
        const P = (px, py) => `${n(x + px * sx)},${n(y + py * sy)}`;
        const d = `M${P(HEART[0][0], HEART[0][1])} ` + HEART.slice(1).map((c) => `C${P(c[1], c[2])} ${P(c[3], c[4])} ${P(c[5], c[6])}`).join(' ') + ' Z';
        return `<path d="${d}" ${attrs}/>`;
      }
      case 'star': return poly(5, 0.45, -Math.PI / 2);
      case 'hexagon': return poly(6, 0, 0);
      case 'arch': {
        const rr = Math.min(w / 2, h / 2);
        return `<path d="M${n(x)},${n(y + h)} L${n(x)},${n(y + rr)} A${n(w / 2)},${n(rr)} 0 0 1 ${n(x + w)},${n(y + rr)} L${n(x + w)},${n(y + h)} Z" ${attrs}/>`;
      }
      default: return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${attrs}/>`;
    }
  }
  // Photo shapes become real SVG clip paths, so the photo stays editable in vector software.
  const origImgSvg = IP._toSVG;
  IP._toSVG = function () {
    const markup = origImgSvg.call(this);
    if (!this.mask) return markup;
    const id = 'photoShape_' + fabric.Object.__uid++;
    const shape = (attrs) => maskShapeSvg(this.mask, this.width, this.height, attrs);
    const out = [`<clipPath id="${id}">${shape('')}</clipPath>\n`, `<g clip-path="url(#${id})">\n`, ...markup, '</g>\n'];
    if (this.maskBorder > 0) {
      const bw = (this.maskBorder / 100) * Math.min(this.width, this.height) * 2;
      out.push(`<g clip-path="url(#${id})">${shape(`fill="none" stroke="${this.maskBorderColor}" stroke-width="${bw.toFixed(3)}"`)}</g>\n`);
    }
    return out;
  };
  // Curved text and text with a background box are drawn by custom code, so
  // they go into the SVG as a 300 DPI picture of exactly what is on screen.
  const origTextSvg = TP.toSVG;
  // Text with coloured words is embedded the same way (the right-to-left SVG
  // layout below draws each line as one run).
  const hasWordStyles = (o) => o.styles && Object.values(o.styles).some((line) => line && Object.keys(line).length);
  TP.toSVG = function (reviver) {
    if (!this.curve && !this.backgroundColor && !hasWordStyles(this)) return origTextSvg.call(this, reviver);
    const r = this.getBoundingRect(true, true);
    const mult = Math.min(24, Math.max(2, 300 / (TP.svgUnitsPerInch || 50))); // 300 DPI at the product's real size
    let ex = 0;
    let ey = 0;
    if (this.shadow) {
      const sc = this.getObjectScaling();
      ex = Math.round(Math.abs(this.shadow.offsetX) + this.shadow.blur) * Math.abs(sc.scaleX);
      ey = Math.round(Math.abs(this.shadow.offsetY) + this.shadow.blur) * Math.abs(sc.scaleY);
    }
    // The picture is the text's box (and its shadow); a background box reaches past it by its
    // padding, so the picture takes that in too (its ends and round corners were cut off).
    // Arabic text and boxes get a picture of exactly the place it is put in (toDataURL rounds
    // its canvas up, and the SVG then shrank the picture to fit: the print file's text sat smaller).
    let crop = {};
    let fit = '';
    if (this.backgroundColor || textHasRtl(this)) {
      let mx = 0;
      let my = 0;
      if (this.backgroundColor) {
        const { px, py } = bgPadding(this);
        const ax = Math.abs(px * (this.scaleX || 1));
        const ay = Math.abs(py * (this.scaleY || 1));
        const a = fabric.util.degreesToRadians(this.angle || 0);
        mx = ax * Math.abs(Math.cos(a)) + ay * Math.abs(Math.sin(a));
        my = ax * Math.abs(Math.sin(a)) + ay * Math.abs(Math.cos(a));
      }
      // toDataURL draws the object in the middle of a canvas of its box (and shadow), rounded up.
      const cw = Math.ceil(r.width + 2 * ex);
      const ch = Math.ceil(r.height + 2 * ey);
      ex += mx;
      ey += my;
      crop = { left: cw / 2 - (r.width / 2 + ex), top: ch / 2 - (r.height / 2 + ey), width: r.width + 2 * ex, height: r.height + 2 * ey };
      fit = ' preserveAspectRatio="none"';
    }
    const url = this.toDataURL({ multiplier: mult, format: 'png', ...crop });
    const f = (v) => +v.toFixed(3);
    return `<image x="${f(r.left - ex)}" y="${f(r.top - ey)}" width="${f(r.width + 2 * ex)}" height="${f(r.height + 2 * ey)}"${fit} xlink:href="${url}" href="${url}"></image>\n`;
  };

  // Right-to-left (Arabic) text: lay each line out ourselves with direction="rtl"
  // so the SVG matches the canvas exactly. The text stays real, editable text.
  // A line that reads the other way (English under an Arabic first line, or
  // Arabic under an English one) goes in a <text> of its own direction.
  const origTextInnerSvg = TP._toSVG;
  TP._toSVG = function () {
    const rtls = (this._textLines || []).map((l, i) => lineRtl(this, i));
    if (this.charSpacing || (this.direction !== 'rtl' && !rtls.some(Boolean))) return origTextInnerSvg.call(this);
    const n = (v) => +v.toFixed(3);
    const offsets = this._getSVGLeftTopOffsets();
    const spans = { rtl: [], ltr: [] };
    let top = offsets.textTop;
    for (let i = 0; i < this._textLines.length; i++) {
      const lh = this.getHeightOfLine(i);
      const lw = this.getLineWidth(i);
      const align = this.textAlign.replace('justify-', '').replace('justify', 'left');
      const left = -this.width / 2 + (align === 'center' ? (this.width - lw) / 2 : align === 'right' ? this.width - lw : 0);
      const baseline = top + (lh * (1 - this._fontSizeFraction)) / this.lineHeight;
      const text = fabric.util.string.escapeXml(this._textLines[i].join(''));
      if (text) spans[rtls[i] ? 'rtl' : 'ltr'].push(`<tspan x="${n(rtls[i] ? left + lw : left)}" y="${n(baseline)}">${text}</tspan>`);
      top += lh;
    }
    const out = [];
    for (const dir of ['rtl', 'ltr']) {
      if (!spans[dir].length && (dir !== this.direction || spans.rtl.length + spans.ltr.length)) continue;
      const part = this._wrapSVGTextAndBg({ textSpans: spans[dir], textBgRects: [] });
      out.push(...part.map((p) => (typeof p === 'string' ? p.replace('<text ', `<text direction="${dir}" text-anchor="start" `) : p)));
    }
    return out;
  };

  // Embed the fonts a design uses, so the SVG looks the same on any computer.
  let fontIndex = null;
  async function loadFontIndex() {
    if (!fontIndex) {
      fontIndex = fetch('/fonts/fonts.css').then((r) => r.text()).then((css) => {
        const faces = [];
        for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
          const body = m[1];
          const get = (k) => (new RegExp(k + ':\\s*([^;]+);').exec(body) || [])[1];
          faces.push({
            family: (get('font-family') || '').replace(/['"]/g, '').trim(),
            weight: Number(get('font-weight')) || 400,
            url: (/url\(([^)]+)\)/.exec(body) || [])[1],
            range: get('unicode-range'),
          });
        }
        return faces;
      });
    }
    return fontIndex;
  }
  const blobToDataUrl = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  async function fontFaceCss(objects) {
    const used = new Map();
    const walk = (o) => {
      if (o.type === 'group' && o._objects) o._objects.forEach(walk);
      if (o.fontFamily && !o.curve && !o.backgroundColor) {
        const w = o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 ? 700 : 400;
        used.set(`${o.fontFamily}|${w}`, { family: o.fontFamily, weight: w });
      }
    };
    objects.forEach(walk);
    if (!used.size) return '';
    const faces = await loadFontIndex();
    const css = [];
    for (const { family, weight } of used.values()) {
      let matches = faces.filter((f) => f.family === family && f.weight === weight);
      if (!matches.length) matches = faces.filter((f) => f.family === family);
      for (const f of matches) {
        const data = await blobToDataUrl(await (await fetch(f.url)).blob());
        css.push(`@font-face{font-family:'${family}';font-weight:${f.weight};src:url(${data.replace('application/octet-stream', 'font/woff2')}) format('woff2');${f.range ? `unicode-range:${f.range};` : ''}}`);
      }
    }
    return css.join('');
  }

  // ---------- Laser engraving: a photo as the laser will burn it ----------
  // Every pixel becomes the material's engraved tone (`ink`); how dark the
  // photo is there decides how strongly it is engraved (its opacity). On
  // materials that turn lighter where engraved (acrylic, slate) the photo's
  // light parts are engraved instead (`light`), as for a negative.
  fabric.Image.filters.Engrave = fabric.util.createClass(fabric.Image.filters.BaseFilter, {
    type: 'Engrave',
    ink: '#000000',
    light: false,
    mainParameter: 'ink',
    applyTo2d(options) {
      const d = options.imageData.data;
      const c = new fabric.Color(this.ink).getSource();
      for (let i = 0; i < d.length; i += 4) {
        const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        const k = this.light ? lum : 1 - lum;
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
        d[i + 3] = Math.round(d[i + 3] * k);
      }
    },
    isNeutralState() { return false; },
    toObject() { return { type: this.type, ink: this.ink, light: this.light }; },
  });
  fabric.Image.filters.Engrave.fromObject = fabric.Image.filters.BaseFilter.fromObject;

  /**
   * Laser products: an element drawn in the material's one tone (`ink`), as the
   * laser makes it: no colours, shadows or boxes behind words; photos through
   * the Engrave filter; for cut pieces (`bridge` > 0, in canvas units) text gets
   * an outline of the same tone (at most `bridge`) so its letters (and Arabic dots) join up.
   */
  const solidPaint = (v) => v != null && v !== '' && v !== 'transparent' && v !== 'none' && !(typeof v === 'string' && /^rgba?\([^)]*,\s*0(\.0+)?\s*\)$/.test(v));
  const isTextObj = (x) => x && (x.type === 'i-text' || x.type === 'text' || x.type === 'textbox');
  function laserTone(o, { ink, light = false, bridge = 0, images = true }) {
    const paint = (x) => {
      if (x.type === 'image') {
        if (!images) return;
        x.filters = [...(x.filters || []).filter((f) => f && !['Engrave', 'Grayscale', 'Sepia'].includes(f.type)), new fabric.Image.filters.Engrave({ ink, light })];
        x.applyFilters();
        if (x.maskBorderColor) x.set('maskBorderColor', ink);
        return;
      }
      if (x.type === 'group' && x._objects) {
        x._objects.forEach(paint);
        return;
      }
      if (solidPaint(x.fill) || (x.fill && typeof x.fill === 'object')) x.set('fill', ink);
      if (solidPaint(x.stroke) && x.strokeWidth) x.set('stroke', ink);
      if (x.shadow) x.set('shadow', null);
      // A box behind the words would be engraved (or cut) as one solid block, hiding them.
      if (x.backgroundColor) x.set('backgroundColor', '');
      if (x.textFx) x.set({ textFx: null, fxBase: null });
      if (x.styles) {
        for (const line of Object.values(x.styles)) for (const ch of Object.values(line || {})) {
          delete ch.fill;
          delete ch.stroke;
          delete ch.textBackgroundColor;
        }
      }
      // As thick as needed to join letters and dots, but thinner on small words so they stay readable.
      if (bridge && isTextObj(x)) {
        const w = Math.min(bridge, (x.fontSize || 40) * Math.abs((x.scaleY || 1) * ((o !== x && o.scaleY) || 1)) * 0.09);
        x.set({ stroke: ink, strokeWidth: w, strokeUniform: true, paintFirst: 'stroke', strokeLineJoin: 'round' });
      }
      x.dirty = true;
    };
    paint(o);
    o.dirty = true;
  }

  window.POD_FX = { laserTone, maskPath, roundRectPath, removeBackground, fontFaceCss, bidiLevels, bidiRuns, bidiOrder, styledBidiLine, bidiLineLayout, lineRtl, otherWayLine, drawnLineWidth };
})();
