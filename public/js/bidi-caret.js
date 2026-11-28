/* Caret, selection and clicks on text lines that mix right-to-left (Arabic)
 * and left-to-right (English, numbers) words, in the design editor.
 *
 * Fabric works out where the caret goes, what a click hits and what the
 * selection covers as if every line ran in one direction (the text box's).
 * The browser draws a mixed line by the Unicode bidi rules instead: "Hello
 * 2026" inside Arabic text is shown left to right, in its own place. On such
 * lines the caret was drawn in one spot while the typing went in another.
 *
 * Here every letter of such a line gets the place where it is really drawn:
 * the line's stretches in display order (bidiLevels / bidiLineLayout in
 * fabric-ext.js, which match the browser's order), each stretch measured on the
 * canvas, and the letters inside it placed by the browser's own shaping (a
 * hidden copy of the stretch). Clicks, the caret, the selection highlight and
 * the arrow keys use those places. The same goes for Arabic lines in one
 * direction, whose joined letters Fabric measures one by one, unjoined (the
 * caret could land a letter off). Lines Fabric gets right (English, or text
 * drawn letter by letter with letter spacing) keep Fabric's own handling.
 */
(function () {
  'use strict';

  const FX = window.POD_FX;
  if (!window.fabric || !FX || !FX.bidiLevels || !FX.bidiLineLayout || !FX.styledBidiLine) return;
  const IT = fabric.IText.prototype;
  const WORD = /[\p{L}\p{N}\p{M}]/u;
  // Scripts whose letters join up (Arabic and its neighbours): Fabric measures each letter
  // on its own, unjoined, so its letter widths are off on such lines even in one direction.
  const JOINED = /[\u0600-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

  let measuring = null;
  const measureCtx = () => measuring || (measuring = fabric.util.createCanvasElement().getContext('2d'));

  // ---------- Where each letter of a line is drawn ----------

  /** Stretches of one level in typing order: [{ start, end, level }]. */
  function levelRuns(levels) {
    const runs = [];
    for (let i = 0; i < levels.length; i++) {
      const top = runs[runs.length - 1];
      if (top && top.level === levels[i]) top.end = i + 1;
      else runs.push({ rtl: levels[i] % 2 === 1, level: levels[i], start: i, end: i + 1 });
    }
    return runs;
  }

  /**
   * The pieces Fabric itself draws a line in (one fillText each, in the text's
   * direction, from the line's start), exactly as Text#_renderChars cuts them:
   * the whole line, or (justified text, a word in another style) word or style pieces.
   */
  function fabricPieces(o, li, line, bounds, left) {
    const isJustify = (o.textAlign || '').indexOf('justify') !== -1;
    if (!isJustify && o.charSpacing === 0 && o.isEmptyStyles(li)) return [{ start: 0, end: line.length, at: left }];
    const sign = o.direction === 'ltr' ? 1 : -1;
    const pieces = [];
    let start = 0;
    let boxWidth = 0;
    let actualStyle;
    let nextStyle;
    for (let i = 0, len = line.length - 1; i <= len; i++) {
      let timeToRender = i === len || o.charSpacing;
      const box = bounds[i];
      if (boxWidth === 0) {
        left += sign * (box.kernedWidth - box.width);
        boxWidth += box.width;
      } else {
        boxWidth += box.kernedWidth;
      }
      if (isJustify && !timeToRender && o._reSpaceAndTab.test(line[i])) timeToRender = true;
      if (!timeToRender) {
        actualStyle = actualStyle || o.getCompleteStyleDeclaration(li, i);
        nextStyle = o.getCompleteStyleDeclaration(li, i + 1);
        timeToRender = fabric.util.hasStyleChanged(actualStyle, nextStyle, false);
      }
      if (timeToRender) {
        pieces.push({ start, end: i + 1, at: left });
        start = i + 1;
        actualStyle = nextStyle;
        left += sign * boxWidth;
        boxWidth = 0;
      }
    }
    return pieces;
  }

  // Where each letter of a stretch in one direction sits, measured by the browser
  // itself in a hidden element (joined Arabic letters are much narrower than
  // Fabric's one-by-one measures). Cached by font, direction and text.
  let probe = null;
  const edgeCache = new Map();
  // A font that finishes loading changes every measure: forget them all.
  let fontGen = 0;
  try {
    document.fonts.addEventListener('loadingdone', () => {
      fontGen++;
      edgeCache.clear();
    });
  } catch (e) {
    /* no font loading API: measures are kept */
  }
  function letterEdges(graphemes, font, rtl) {
    const text = graphemes.join('');
    const key = `${font}|${rtl ? 'r' : 'l'}|${text}`;
    if (edgeCache.has(key)) return edgeCache.get(key);
    let ready = true;
    try {
      ready = document.fonts.check(font, text);
    } catch (e) {
      ready = true;
    }
    let out = null;
    try {
      if (!probe || !probe.isConnected) {
        probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'all:initial;position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre;unicode-bidi:isolate;letter-spacing:0;word-spacing:0;contain:layout style';
        document.body.appendChild(probe);
      }
      probe.style.font = font;
      probe.style.direction = rtl ? 'rtl' : 'ltr';
      probe.textContent = text;
      const node = probe.firstChild;
      const box = probe.getBoundingClientRect();
      const range = document.createRange();
      const edges = [];
      let off = 0;
      for (const g of graphemes) {
        range.setStart(node, off);
        range.setEnd(node, off + g.length);
        let x0 = Infinity;
        let x1 = -Infinity;
        for (const r of range.getClientRects()) {
          x0 = Math.min(x0, r.left - box.left);
          x1 = Math.max(x1, r.right - box.left);
        }
        edges.push(x1 >= x0 ? [x0, x1] : null);
        off += g.length;
      }
      probe.textContent = '';
      if (box.width > 0 && edges.every(Boolean)) out = { edges, width: box.width };
    } catch (e) {
      out = null;
    }
    // Measured with a stand-in font while the real one loads: use it now, measure again next time.
    if (!ready) return out;
    edgeCache.set(key, out);
    if (edgeCache.size > 500) edgeCache.delete(edgeCache.keys().next().value);
    return out;
  }

  // Vowel signs and other marks belong to the letter before them (Fabric counts them as letters
  // of their own): the caret never stops between a letter and its marks.
  const ATTACHED = /^[\p{M}\u200C\u200D]+$/u;

  /**
   * Letters a..b-1, drawn as one stretch in one direction from x with width w:
   * their places (the browser's, else Fabric's letter widths). A letter and its
   * marks make one unit { start, end, x0, x1, rtl }; units are listed left to right
   * in L.vis, and L.boxes[i] is the unit of letter i.
   */
  function place(L, bounds, a, b, x, w, rtl, font) {
    const raw = [];
    const m = letterEdges(L.line.slice(a, b), font, rtl);
    if (m) {
      const k = w / m.width;
      for (let i = a; i < b; i++) raw.push([x + m.edges[i - a][0] * k, x + m.edges[i - a][1] * k]);
    } else {
      let sum = 0;
      for (let i = a; i < b; i++) sum += Math.max(0, bounds[i].kernedWidth);
      let at = rtl ? x + w : x;
      for (let i = a; i < b; i++) {
        const wi = sum > 0 ? (Math.max(0, bounds[i].kernedWidth) * w) / sum : w / (b - a);
        raw.push(rtl ? [at - wi, at] : [at, at + wi]);
        at += rtl ? -wi : wi;
      }
    }
    const units = [];
    for (let i = a; i < b; i++) {
      const [x0, x1] = raw[i - a];
      let u = units[units.length - 1];
      if (u && ATTACHED.test(L.line[i])) {
        u.end = i + 1;
        u.x0 = Math.min(u.x0, x0);
        u.x1 = Math.max(u.x1, x1);
      } else {
        units.push((u = { start: i, end: i + 1, x0, x1, rtl }));
      }
      L.boxes[i] = u;
    }
    L.vis.push(...(rtl ? units.reverse() : units));
  }

  /**
   * The drawn place of every letter of line li (object coordinates, x from the
   * object's centre), or null when Fabric's own one-direction model is right
   * for the line (it is then left to Fabric).
   */
  function build(o, li, line, bounds) {
    const rtl = o.direction === 'rtl';
    // A line in one colour that reads the other way than its box is drawn by fabric-ext.js
    // in its own direction (from its left edge): its letters are read that way here too.
    const other = FX.otherWayLine ? FX.otherWayLine(o, line, li) : false;
    const lineRtl = other ? !rtl : rtl;
    const base = lineRtl ? 1 : 0;
    const left = o._getLeftOffset() + o._getLineLeftOffset(li); // the line's start, as Fabric draws it
    const ctx = measureCtx();
    const L = { line, boxes: new Array(line.length), vis: [] };
    if (FX.styledBidiLine(o, line, li)) {
      // Drawn by fabric-ext.js piece by piece in display order: the same layout.
      for (const run of FX.bidiLineLayout(o, ctx, line, left, li)) {
        for (const p of run.pieces) place(L, bounds, p.first, p.last + 1, p.x, p.w, run.rtl, o._getFontDeclaration(o.getCompleteStyleDeclaration(li, p.last)));
      }
    } else {
      // Drawn by Fabric: each piece by the browser, which puts its words in display order.
      // Fabric's own model is kept for a line whose pieces all run the text's way and
      // whose letters do not join (English; any line drawn letter by letter).
      let mine = other;
      ctx.save();
      for (const piece of fabricPieces(o, li, line, bounds, left)) {
        const seg = line.slice(piece.start, piece.end);
        const levels = FX.bidiLevels(seg, lineRtl);
        if (seg.length > 1 && (levels.some((lv) => lv % 2 !== base) || seg.some((g) => JOINED.test(g)))) mine = true;
        const runs = levelRuns(levels);
        const font = o._getFontDeclaration(o.getCompleteStyleDeclaration(li, piece.start));
        ctx.font = font;
        let total = 0;
        for (const run of runs) {
          ctx.direction = run.rtl ? 'rtl' : 'ltr';
          run.w = ctx.measureText(seg.slice(run.start, run.end).join('')).width;
          total += run.w;
        }
        // Drawn from the piece's start: its left edge, or its right edge for right-to-left text.
        let x = rtl ? piece.at - total : piece.at;
        for (const run of FX.bidiOrder(runs)) {
          place(L, bounds, piece.start + run.start, piece.start + run.end, x, run.w, run.rtl, font);
          x += run.w;
        }
      }
      ctx.restore();
      if (!mine) return null;
    }
    L.vis.forEach((u, v) => { u.v = v; });
    return L;
  }

  const cache = new WeakMap(); // Fabric's letter boxes of a line (new on every re-measure) → layout
  function lineStyleKey(o, li) {
    const m = o._styleMap && o._styleMap[li];
    const s = o.styles && o.styles[m ? m.line : li];
    return s ? JSON.stringify(s) + (m ? '@' + m.offset : '') : '';
  }
  /** The layout of line li, or null when Fabric's own model is right for it (see build). */
  function layout(o, li) {
    const line = o._textLines && o._textLines[li];
    const bounds = o.__charBounds && o.__charBounds[li];
    if (!line || line.length < 2 || !bounds || bounds.length < line.length || o.path) return null;
    const key = [fontGen, o.direction, o.textAlign, o.width, o.charSpacing, o._getLineLeftOffset(li), lineStyleKey(o, li)].join('|');
    const hit = cache.get(bounds);
    if (hit && hit.key === key) return hit.L;
    const L = build(o, li, line, bounds);
    cache.set(bounds, { key, L });
    return L;
  }

  // ---------- Caret positions on a laid-out line ----------
  // A caret position c sits after letter c-1 and before letter c. Where two
  // stretches of different directions meet, those two edges are in different
  // places on screen: 'back' shows the caret after letter c-1, 'fwd' before letter c.

  const lead = (b) => (b.rtl ? b.x1 : b.x0);
  const trail = (b) => (b.rtl ? b.x0 : b.x1);
  function caretX(L, c, aff) {
    const n = L.boxes.length;
    if (c <= 0) return lead(L.boxes[0]);
    if (c >= n) return trail(L.boxes[n - 1]);
    return aff === 'fwd' ? lead(L.boxes[c]) : trail(L.boxes[c - 1]);
  }
  const ambiguous = (L, c) => c > 0 && c < L.boxes.length && Math.abs(lead(L.boxes[c]) - trail(L.boxes[c - 1])) > 0.5;
  /** The gap between units (0 = left end … L.vis.length = right end, in display order) the caret is in. */
  function slotOf(L, c, aff) {
    const n = L.boxes.length;
    const fwd = c < n && (c === 0 || aff === 'fwd');
    const u = L.boxes[fwd ? c : c - 1];
    const onRight = fwd ? u.rtl : !u.rtl;
    return u.v + (onRight ? 1 : 0);
  }
  /**
   * The caret position for a gap between units. Where the gap is between two
   * stretches it stands for two positions: the one next to `near` (the letter
   * clicked or stepped over) wins, unless that is a space or a sign and the
   * other is part of a word ("Hello|" then a space: the caret belongs to "Hello").
   */
  function atSlot(L, s, near) {
    const A = s > 0 ? L.vis[s - 1] : null;
    const B = s < L.vis.length ? L.vis[s] : null;
    const fromA = !A ? null : A.rtl ? { pos: A.start, aff: 'fwd', u: A } : { pos: A.end, aff: 'back', u: A };
    const fromB = !B ? null : B.rtl ? { pos: B.end, aff: 'back', u: B } : { pos: B.start, aff: 'fwd', u: B };
    if (!fromA || !fromB) return fromA || fromB;
    let pick = near === B ? fromB : fromA;
    const other = pick === fromA ? fromB : fromA;
    if (pick.pos !== other.pos && !WORD.test(L.line[pick.u.start]) && WORD.test(L.line[other.u.start])) pick = other;
    return pick;
  }
  /** The caret position nearest to x on a laid-out line. */
  function atX(L, x) {
    let best = L.vis[0];
    let bestD = Infinity;
    for (const u of L.vis) {
      const d = x < u.x0 ? u.x0 - x : x > u.x1 ? x - u.x1 : 0;
      if (d < bestD) {
        bestD = d;
        best = u;
        if (!d) break;
      }
    }
    return atSlot(L, best.v + (x > (best.x0 + best.x1) / 2 ? 1 : 0), best);
  }

  // ---------- Which side an ambiguous caret is shown on ----------
  // Remembered per text box: the last caret (text, position, side, x). A click
  // or an arrow key sets the side; after typing the caret follows the new
  // letter; after deleting it stays where it was.
  function remember(o, pos, aff, x, li) {
    o.__bidiCaret = { text: o.text, pos, aff, x, li };
  }
  function caretAff(o, pos, li, c, L) {
    if (!ambiguous(L, c)) return 'back';
    const m = o.__bidiCaret;
    if (!m) return 'back';
    if (m.text === o.text && m.pos === pos && m.aff) return m.aff;
    const typed = m.text !== o.text && o.text.length > m.text.length && pos > m.pos;
    if (typed || m.li !== li || m.x == null) return 'back';
    return Math.abs(caretX(L, c, 'fwd') - m.x) < Math.abs(caretX(L, c, 'back') - m.x) ? 'fwd' : 'back';
  }

  // ---------- Fabric's own model (lines in one direction) ----------
  function lineStart(o, li) {
    let s = 0;
    for (let i = 0; i < li; i++) s += o._textLines[i].length + o.missingNewlineOffset(i);
    return s;
  }
  /** Fabric's caret x for position c of line li (as _getCursorBoundariesOffsets, without its cache). */
  function fabricCaretX(o, li, c) {
    const bound = o.__charBounds[li] && o.__charBounds[li][c];
    let left = bound ? bound.left : 0;
    if (o.charSpacing !== 0 && c === o._textLines[li].length) left -= o._getWidthOfCharSpacing();
    const x = o._getLineLeftOffset(li) + (left > 0 ? left : 0);
    return o._getLeftOffset() + (o.direction === 'rtl' ? -x : x);
  }
  /** The caret x of a text position (object coordinates). */
  function caretXAt(o, pos) {
    const loc = o.get2DCursorLocation(pos);
    const L = layout(o, loc.lineIndex);
    return L ? caretX(L, loc.charIndex, caretAff(o, pos, loc.lineIndex, loc.charIndex, L)) : fabricCaretX(o, loc.lineIndex, loc.charIndex);
  }
  /** The text position on line li nearest to x: { pos (in the whole text), aff }. */
  function positionAt(o, li, x) {
    const L = layout(o, li);
    if (L) {
      const r = atX(L, x);
      return { pos: lineStart(o, li) + r.pos, aff: r.aff };
    }
    let best = 0;
    for (let c = 1; c <= o._textLines[li].length; c++) if (Math.abs(fabricCaretX(o, li, c) - x) < Math.abs(fabricCaretX(o, li, best) - x)) best = c;
    return { pos: lineStart(o, li) + best, aff: null };
  }

  // ---------- Fabric hooks ----------

  // A click or tap: the letter under the pointer, by where letters are drawn.
  const origPointer = IT.getSelectionStartFromPointer;
  IT.getSelectionStartFromPointer = function (e) {
    const p = this.getLocalPointer(e);
    let height = 0;
    let li = 0;
    for (let i = 0; i < this._textLines.length; i++) {
      if (height > p.y) break;
      height += this.getHeightOfLine(i) * this.scaleY;
      li = i;
    }
    const L = layout(this, li);
    if (!L) return origPointer.call(this, e);
    let x = p.x / this.scaleX - this.width / 2;
    if (this.flipX) x = -x;
    const r = atX(L, x);
    const pos = Math.min(lineStart(this, li) + r.pos, this._text.length);
    remember(this, pos, r.aff, null, li);
    this.__bidiFocus = { text: this.text, pos, aff: r.aff };
    return pos;
  };

  // Where the caret is drawn (and the hidden text field placed, for the phone keyboard).
  const origOffsets = IT._getCursorBoundariesOffsets;
  IT._getCursorBoundariesOffsets = function (position) {
    const loc = this.get2DCursorLocation(position);
    const live = this.isEditing && position === this.selectionStart && this.selectionStart === this.selectionEnd;
    const L = layout(this, loc.lineIndex);
    if (!L) {
      const r = origOffsets.call(this, position);
      if (live) remember(this, position, null, this._getLeftOffset() + r.left, loc.lineIndex);
      return r;
    }
    let top = 0;
    for (let i = 0; i < loc.lineIndex; i++) top += this.getHeightOfLine(i);
    const aff = caretAff(this, position, loc.lineIndex, loc.charIndex, L);
    const x = caretX(L, loc.charIndex, aff);
    if (live) remember(this, position, aff, x, loc.lineIndex);
    return { top, left: x - this._getLeftOffset() };
  };

  /** Spans [x0, x1] covered by letters a..b-1 of a laid-out line. */
  function spans(L, a, b) {
    const out = [];
    let cur = null;
    for (const u of L.vis) {
      if (u.end <= a || u.start >= b) {
        cur = null;
        continue;
      }
      if (cur) cur[1] = Math.max(cur[1], u.x1);
      else out.push((cur = [u.x0, u.x1]));
    }
    return out;
  }

  // The selection highlight: on a mixed line, over the selected letters where they are drawn
  // (a selection across a change of direction can be several blocks).
  const origSelection = IT.renderSelection;
  IT.renderSelection = function (boundaries, ctx) {
    const comp = this.inCompositionMode;
    const selStart = comp ? this.hiddenTextarea.selectionStart : this.selectionStart;
    const selEnd = comp ? this.hiddenTextarea.selectionEnd : this.selectionEnd;
    const start = this.get2DCursorLocation(selStart);
    const end = this.get2DCursorLocation(selEnd);
    const startLine = start.lineIndex;
    const endLine = end.lineIndex;
    let mixed = false;
    for (let i = startLine; i <= endLine && !mixed; i++) mixed = Boolean(layout(this, i));
    if (!mixed) return origSelection.call(this, boundaries, ctx);
    const isJustify = this.textAlign.indexOf('justify') !== -1;
    const startChar = start.charIndex < 0 ? 0 : start.charIndex;
    const endChar = end.charIndex < 0 ? 0 : end.charIndex;
    for (let i = startLine; i <= endLine; i++) {
      let lineHeight = this.getHeightOfLine(i);
      const realLineHeight = lineHeight;
      if (this.lineHeight < 1 || (i === endLine && this.lineHeight > 1)) lineHeight /= this.lineHeight;
      let drawHeight = lineHeight;
      let extraTop = 0;
      if (comp) {
        ctx.fillStyle = this.compositionColor || 'black';
        drawHeight = 1;
        extraTop = lineHeight;
      } else {
        ctx.fillStyle = this.selectionColor;
      }
      const y = boundaries.top + boundaries.topOffset + extraTop;
      const L = layout(this, i);
      if (L) {
        const a = i === startLine ? startChar : 0;
        const b = i === endLine ? endChar : L.boxes.length;
        for (const [x0, x1] of spans(L, a, b)) ctx.fillRect(x0, y, x1 - x0, drawHeight);
      } else {
        // A line in one direction: as Fabric draws it.
        const lineOffset = this._getLineLeftOffset(i) || 0;
        let boxStart = 0;
        let boxEnd = 0;
        if (i === startLine) boxStart = this.__charBounds[startLine][startChar].left;
        if (i >= startLine && i < endLine) {
          boxEnd = isJustify && !this.isEndOfWrapping(i) ? this.width : this.getLineWidth(i) || 5;
        } else if (i === endLine) {
          if (endChar === 0) boxEnd = this.__charBounds[endLine][endChar].left;
          else boxEnd = this.__charBounds[endLine][endChar - 1].left + this.__charBounds[endLine][endChar - 1].width - this._getWidthOfCharSpacing();
        }
        let drawStart = boundaries.left + lineOffset + boxStart;
        const drawWidth = boxEnd - boxStart;
        if (this.direction === 'rtl') drawStart = this.width - drawStart - drawWidth;
        ctx.fillRect(drawStart, y, drawWidth, drawHeight);
      }
      boundaries.topOffset += realLineHeight;
    }
  };

  // Left / right arrows on a mixed line move the caret one letter left / right on screen
  // (with Shift, the moving end of the selection). Alt/Ctrl/Cmd jumps stay Fabric's; Home/End below.
  function arrow(o, e) {
    if (!e || (e.keyCode !== 37 && e.keyCode !== 39) || e.altKey || e.metaKey || e.ctrlKey) return false;
    const collapsed = o.selectionStart === o.selectionEnd;
    if (!collapsed && !e.shiftKey) return false;
    const startMoves = !collapsed && o._selectionDirection === 'left';
    const focus = startMoves ? o.selectionStart : o.selectionEnd;
    const anchor = startMoves ? o.selectionEnd : o.selectionStart;
    const loc = o.get2DCursorLocation(focus);
    const li = loc.lineIndex;
    const c = loc.charIndex;
    const L = layout(o, li);
    if (!L) return false;
    const dir = e.keyCode === 37 ? -1 : 1;
    const m = o.__bidiFocus;
    const aff = collapsed ? caretAff(o, focus, li, c, L) : m && m.text === o.text && m.pos === focus && m.aff ? m.aff : 'back';
    const s = slotOf(L, c, aff);
    const ns = s + dir;
    const first = focus - c;
    let pos;
    let naff = null;
    if (ns < 0 || ns > L.vis.length) {
      // Off the end of the line: to the next line (the way the text runs) or the previous one.
      const forward = dir > 0 !== (FX.lineRtl ? FX.lineRtl(o, li) : o.direction === 'rtl'); // the way this line reads
      if (forward) {
        if (li >= o._textLines.length - 1) return true;
        pos = first + o._textLines[li].length + o.missingNewlineOffset(li);
      } else {
        if (li === 0) return true;
        pos = first - Math.max(1, o.missingNewlineOffset(li - 1));
      }
    } else {
      const r = atSlot(L, ns, L.vis[dir < 0 ? ns : s]);
      pos = first + r.pos;
      naff = r.aff;
    }
    if (e.shiftKey) {
      o.selectionStart = Math.min(anchor, pos);
      o.selectionEnd = Math.max(anchor, pos);
      o._selectionDirection = pos < anchor ? 'left' : 'right';
    } else {
      o.selectionStart = o.selectionEnd = pos;
      o._selectionDirection = dir < 0 ? 'left' : 'right';
    }
    o.__bidiFocus = { text: o.text, pos, aff: naff };
    remember(o, pos, naff, null, -1);
    o._currentCursorOpacity = 1;
    o.abortCursorAnimation();
    o.initDelayedCursor();
    o._fireSelectionChanged();
    o._updateTextarea();
    return true;
  }
  const origLeft = IT.moveCursorLeft;
  const origRight = IT.moveCursorRight;
  IT.moveCursorLeft = function (e) {
    if (!arrow(this, e)) origLeft.call(this, e);
  };
  IT.moveCursorRight = function (e) {
    if (!arrow(this, e)) origRight.call(this, e);
  };

  // Home / End: to the start / end of the line in reading order (with Shift, select to there),
  // as in a text field, right-to-left ones too: for Arabic the start is the right edge. Fabric
  // swaps the two keys in right-to-left text boxes (it maps them like the arrows there). Its
  // moveCursorLeft / moveCursorRight go back / forward in the text, whatever the box's direction.
  IT.keysMapRtl = Object.assign({}, IT.keysMapRtl, { 35: 'moveCursorRight', 36: 'moveCursorLeft' });

  // Up / down arrows: to the letter drawn above / below the caret.
  function vertical(o, e, isRight, d) {
    const sel = o._getSelectionForOffset(e, isRight);
    const li = o.get2DCursorLocation(sel).lineIndex;
    const to = li + d;
    if (to < 0 || to >= o._textLines.length || e.metaKey || e.keyCode === 33 || e.keyCode === 34) return null;
    if (!layout(o, li) && !layout(o, to)) return null;
    const r = positionAt(o, to, caretXAt(o, sel));
    if (r.aff) remember(o, r.pos, r.aff, null, -1);
    o.__bidiFocus = { text: o.text, pos: r.pos, aff: r.aff };
    return r.pos - sel;
  }
  const origUp = IT.getUpCursorOffset;
  const origDown = IT.getDownCursorOffset;
  IT.getUpCursorOffset = function (e, isRight) {
    const off = vertical(this, e, isRight, -1);
    return off === null ? origUp.call(this, e, isRight) : off;
  };
  IT.getDownCursorOffset = function (e, isRight) {
    const off = vertical(this, e, isRight, 1);
    return off === null ? origDown.call(this, e, isRight) : off;
  };

  window.POD_BIDI_CARET = { layout, caretX, slotOf, atSlot, atX, spans };
})();
