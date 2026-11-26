/*
 * The view-only page (/view?id=…): a design the customer sent by WhatsApp or email for someone to look at.
 * A booklet is flipped through (one page at a time on phones; on computers the cover alone, then two pages side by
 * side, then the back cover alone, as a real booklet opens); a product's sides (Front / Back…) are tabs. Nothing
 * to buy, approve or comment on: at the end, "Make your own".
 */
(() => {
  'use strict';
  const { t, tr } = POD;
  const $ = (id) => document.getElementById(id);
  const WIDE = window.matchMedia('(min-width: 900px)');
  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');
  const id = (location.pathname.match(/^\/v\/([A-Za-z0-9_-]{4,64})\/?$/) || [])[1] || new URLSearchParams(location.search).get('id') || '';

  let view = null; // what /api/views/<id> answered (cleaned)
  let at = 0; // the page (or side) on screen, from 0 in reading order; on computers, the spread it is in
  let mode = ''; // 'single' (one picture) or 'spread' (an open booklet)
  let turn = null; // the page being turned on a computer: { leaf, done }
  const pics = new Map(); // page → its <img>, made once (a page seen again, or a language switch, loads nothing again)

  // ---------- The data ----------
  const localPath = (u) => typeof u === 'string' && /^\/(?![/\\])/.test(u);
  function clean(v) {
    const pages = (Array.isArray(v && v.pages) ? v.pages : []).filter((p) => p && localPath(p.url)).map((p) => ({
      name: p.name,
      url: p.url,
      w: Number(p.w) > 0 ? Number(p.w) : 1000,
      h: Number(p.h) > 0 ? Number(p.h) : 1000,
    }));
    const own = localPath(v.makeOwn) ? v.makeOwn : v.productId ? `/product?id=${encodeURIComponent(v.productId)}` : '/';
    return { productName: v.productName, kind: v.kind === 'sides' ? 'sides' : 'pages', rtl: v.rtl === true, pages, makeOwn: own };
  }
  const booklet = () => view.kind === 'pages';
  /**
   * Which way "next" lies on screen: a booklet turns the way it is bound (an Arabic booklet, bound on the right, has
   * its next page to the left); a product's sides follow the page's language, like their tabs.
   */
  const flowRtl = () => (booklet() ? view.rtl : document.documentElement.dir === 'rtl');
  /**
   * The steps the page moves through: single pages, or on a computer a booklet's spreads (the cover alone, two pages
   * side by side, the back cover alone). Each step is its pages in reading order.
   */
  function steps() {
    const n = view.pages.length;
    if (mode !== 'spread' || n <= 2) return view.pages.map((_, i) => [i]);
    const out = [[0]];
    for (let i = 1; i < n - 1; i += 2) out.push(i + 1 < n - 1 ? [i, i + 1] : [i]);
    out.push([n - 1]);
    return out;
  }
  const stepOf = (list, page) => Math.max(0, list.findIndex((s) => s.includes(page)));
  /**
   * Where a spread's pages lie: a left-bound booklet has its odd pages (1, 3…) on the right, an Arabic one on the
   * left (so its cover lies to the left of the spine, and in a spread the right-hand page comes first).
   */
  function placed(step) {
    const out = { left: null, right: null };
    for (const i of step) out[(i % 2 === 0) !== view.rtl ? 'right' : 'left'] = i;
    return out;
  }
  // A cover alone sits in the middle, as a closed booklet would.
  const shiftOf = (p) => (p.left == null && p.right != null ? 'right' : p.right == null && p.left != null ? 'left' : '');
  /** On a computer, the side of the open booklet where "Make your own" lies next to the back cover (null: none). */
  function endSide(list, k) {
    if (mode !== 'spread' || k !== list.length - 1 || list[k].length !== 1) return null;
    return placed(list[k]).left == null ? 'left' : 'right';
  }

  // ---------- Pictures ----------
  const altOf = (i) => (booklet() ? t('view.pageAlt', { n: POD.num(i + 1) }) : tr(view.pages[i].name) || t('view.pageAlt', { n: POD.num(i + 1) }));
  function failed(box) {
    box.classList.add('vw-failed');
    box.dataset.msg = t('view.imgFailed');
  }
  function pic(i) {
    let img = pics.get(i);
    if (!img) {
      const p = view.pages[i];
      img = document.createElement('img');
      img.className = 'vw-img';
      img.decoding = 'async';
      img.draggable = false;
      img.width = p.w;
      img.height = p.h;
      img.alt = altOf(i);
      img.addEventListener('error', () => {
        // Made again (asked for again) the next time it is shown, or tapped.
        if (pics.get(i) === img) pics.delete(i);
        if (img.parentElement && !img.parentElement.classList.contains('vw-face')) failed(img.parentElement);
      });
      img.src = p.url;
      pics.set(i, img);
    }
    return img;
  }
  const loaded = (img) => (img.complete ? Promise.resolve() : new Promise((done) => {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }));
  /** The next step's pictures (and the one before), asked for now so turning the page shows them at once. */
  function preload() {
    const list = steps();
    const s = stepOf(list, at);
    for (const k of [s + 1, s - 1]) if (list[k]) list[k].forEach(pic);
  }
  // The thumbnails load once the page on screen and the next one are in (they are the same pictures, so later pages
  // are then ready too).
  let thumbsLoading = false;
  function loadThumbs() {
    if (thumbsLoading) return;
    thumbsLoading = true;
    document.querySelectorAll('#vw-thumbs img[data-src]').forEach((img) => {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    });
  }

  // ---------- Drawing ----------
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  /** One picture (phones, and a product's sides): it keeps its shape, as big as the screen allows. */
  function drawSingle(dir) {
    const box = $('vw-view');
    let frame = box.querySelector(':scope > .vw-frame');
    if (!frame) {
      box.replaceChildren();
      frame = el('div', 'vw-frame');
      box.append(frame);
    }
    const p = view.pages[at];
    frame.style.setProperty('--ar', String(p.w / p.h));
    frame.style.aspectRatio = `${p.w} / ${p.h}`;
    // The new page slides in from the side it lies on (none for a jump, or with reduced motion: see view.css).
    const fromRight = dir > 0 ? !flowRtl() : flowRtl();
    frame.style.setProperty('--vw-from', dir ? `${fromRight ? 28 : -28}px` : '0px');
    frame.classList.toggle('vw-anim', frame.dataset.drawn === '1');
    frame.classList.remove('vw-failed');
    frame.replaceChildren(pic(at));
    frame.dataset.drawn = '1';
  }
  /** An open booklet on a computer: two pages round the spine. */
  function book() {
    const box = $('vw-view');
    let b = box.querySelector(':scope > .vw-book');
    if (!b) {
      box.replaceChildren();
      b = el('div', 'vw-book');
      b.dir = 'ltr';
      b.append(el('div', 'vw-slot vw-left'), el('div', 'vw-slot vw-right'), el('div', 'vw-spine'));
      box.append(b);
    }
    const p = view.pages[0];
    b.style.setProperty('--ar', String(p.w / p.h));
    b.style.aspectRatio = `${2 * p.w} / ${p.h}`;
    return b;
  }
  /** "Make your own" back under the buttons (phones, and every page but a computer's back cover). */
  function endHome() {
    const end = $('vw-end');
    if (end.parentElement !== $('vw-body')) $('vw-body').insertBefore(end, $('vw-thumbs'));
  }
  /** A page in one half of the open booklet; an empty half (beside the back cover) may hold "Make your own". */
  function fillSlot(slot, i, end = false) {
    if (slot.contains($('vw-end'))) endHome();
    slot.replaceChildren();
    slot.classList.toggle('vw-empty', i == null);
    slot.classList.toggle('vw-has-end', i == null && end);
    slot.dataset.side = slot.classList.contains('vw-left') ? 'left' : 'right';
    if (i == null) {
      if (end) slot.append($('vw-end'));
      return;
    }
    const paper = el('div', 'vw-paper');
    paper.append(pic(i));
    slot.append(paper);
  }
  function drawSpread() {
    const b = book();
    const list = steps();
    const k = stepOf(list, at);
    const pl = placed(list[k]);
    const end = endSide(list, k);
    fillSlot(b.querySelector('.vw-left'), pl.left, end === 'left');
    fillSlot(b.querySelector('.vw-right'), pl.right, end === 'right');
    b.dataset.shift = end ? '' : shiftOf(pl);
    b.classList.toggle('vw-open', pl.left != null && pl.right != null);
  }
  function drawStage(dir = 0) {
    if (mode === 'spread') drawSpread();
    else {
      endHome();
      drawSingle(dir);
    }
    showEnd();
    preload();
  }
  /** Turn one leaf round the spine (a computer, one step forward or back). */
  function turnLeaf(toPage, dir) {
    const list = steps();
    const kCur = stepOf(list, at);
    const kNx = stepOf(list, toPage);
    const cur = placed(list[kCur]);
    const nx = placed(list[kNx]);
    const endCur = endSide(list, kCur);
    const endNx = endSide(list, kNx);
    at = toPage;
    drawChrome();
    const b = $('vw-view').querySelector(':scope > .vw-book');
    if (!b || REDUCE.matches) return drawStage();
    // Forward in a left-bound booklet (or back in an Arabic one) turns the right-hand page over to the left.
    // (Under it: what was on the other side stays, and the page it lands on is revealed; "Make your own", beside the
    // back cover, too.)
    const fromRight = (dir > 0) !== view.rtl;
    fillSlot(b.querySelector('.vw-left'), fromRight ? cur.left : nx.left, fromRight ? endCur === 'left' : endNx === 'left');
    fillSlot(b.querySelector('.vw-right'), fromRight ? nx.right : cur.right, fromRight ? endNx === 'right' : endCur === 'right');
    if (b.contains($('vw-end'))) $('vw-end').hidden = false;
    b.classList.toggle('vw-open', true);
    const leaf = el('div', `vw-leaf ${fromRight ? 'vw-from-right' : 'vw-from-left'}`);
    const face = (i, cls) => {
      const f = el('div', `vw-face ${cls}`);
      if (i != null) f.append(pic(i));
      return f;
    };
    leaf.append(face(fromRight ? cur.right : cur.left, 'vw-front'), face(fromRight ? nx.left : nx.right, 'vw-back'));
    b.append(leaf);
    b.dataset.shift = endNx ? '' : shiftOf(nx);
    const done = () => {
      if (!turn || turn.leaf !== leaf) return;
      turn = null;
      leaf.remove();
      drawStage();
    };
    turn = { leaf, done };
    requestAnimationFrame(() => requestAnimationFrame(() => leaf.classList.add('vw-turned')));
    leaf.addEventListener('transitionend', (e) => { if (e.target === leaf) done(); });
    setTimeout(done, 1100);
  }

  /** Everything round the picture: the page indicator, buttons, tabs, thumbnails and the end. */
  function drawChrome() {
    const list = steps();
    const s = stepOf(list, at);
    const step = list[s];
    const n = view.pages.length;
    const last = s === list.length - 1;
    const dirAttr = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
    // Count: "Page 3 of 16", "Pages 2–3 of 16", or the side ("Back (2 of 2)").
    const count = $('vw-count');
    count.dir = dirAttr;
    if (!booklet()) count.textContent = t('view.sideOf', { side: tr(view.pages[at].name), n: POD.num(at + 1), total: POD.num(n) });
    else if (step.length === 2) count.textContent = t('view.pagesOf', { a: POD.num(step[0] + 1), b: POD.num(step[1] + 1), total: POD.num(n) });
    else count.textContent = t('view.pageOf', { n: POD.num(step[0] + 1), total: POD.num(n) });
    // Buttons: "next" on the side the next page lies (an Arabic booklet's on the left).
    const bar = $('vw-bar');
    bar.hidden = n < 2;
    bar.dir = flowRtl() ? 'rtl' : 'ltr';
    $('vw-prev').disabled = s === 0;
    $('vw-next').disabled = last;
    $('vw-prev').setAttribute('aria-label', t(booklet() ? 'view.prevPage' : 'view.prev'));
    $('vw-next').setAttribute('aria-label', t(booklet() ? 'view.nextPage' : 'view.next'));
    drawTabs();
    drawThumbs(step);
    showEnd();
  }
  /** "Make your own": after a booklet's last page; under a product's sides all along (there are only a few). */
  function showEnd() {
    const list = steps();
    $('vw-end').hidden = booklet() && stepOf(list, at) !== list.length - 1;
    $('vw-end-title').hidden = !booklet();
  }
  function drawTabs() {
    const box = $('vw-tabs');
    const stage = $('vw-stage');
    if (booklet() || view.pages.length < 2) {
      box.hidden = true;
      stage.removeAttribute('role');
      stage.setAttribute('aria-labelledby', 'vw-title');
      return;
    }
    box.hidden = false;
    // The picture is the tabs' panel, named by the side on screen.
    stage.setAttribute('role', 'tabpanel');
    stage.setAttribute('aria-labelledby', `vw-tab-${at}`);
    if (box.children.length !== view.pages.length) {
      box.replaceChildren(...view.pages.map((_, i) => {
        const b = el('button', 'side-tab');
        b.type = 'button';
        b.id = `vw-tab-${i}`;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-controls', 'vw-stage');
        b.dataset.page = String(i);
        return b;
      }));
    }
    const hadFocus = box.contains(document.activeElement);
    [...box.children].forEach((b, i) => {
      const on = i === at;
      b.textContent = tr(view.pages[i].name) || POD.num(i + 1);
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && hadFocus && document.activeElement !== b) b.focus();
    });
  }
  function drawThumbs(step) {
    const box = $('vw-thumbs');
    if (!booklet() || view.pages.length < 2) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    // The strip reads the way the booklet turns (an Arabic booklet's page 1 on the right).
    box.dir = view.rtl ? 'rtl' : 'ltr';
    if (box.children.length !== view.pages.length) {
      box.replaceChildren(...view.pages.map((p, i) => {
        const b = el('button', 'vw-thumb');
        b.type = 'button';
        b.dataset.page = String(i);
        b.style.aspectRatio = `${p.w} / ${p.h}`;
        const img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = false;
        img.width = p.w;
        img.height = p.h;
        if (thumbsLoading) img.src = p.url;
        else img.dataset.src = p.url;
        img.addEventListener('error', () => img.classList.add('vw-thumb-failed'));
        b.append(img, el('span', 'vw-thumb-n'));
        return b;
      }));
    }
    const thumbs = [...box.children];
    thumbs.forEach((b, i) => {
      const on = step.includes(i);
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
      b.setAttribute('aria-label', altOf(i));
      b.lastChild.textContent = POD.num(i + 1);
    });
    // The page's thumbnail stays in sight: only the strip scrolls sideways, never the page.
    const first = thumbs[step[0]];
    const lastThumb = thumbs[step[step.length - 1]];
    if (first && box.scrollWidth > box.clientWidth) {
      const s = box.getBoundingClientRect();
      const a = first.getBoundingClientRect();
      const z = lastThumb.getBoundingClientRect();
      const lo = Math.min(a.left, z.left);
      const hi = Math.max(a.right, z.right);
      const dx = lo < s.left ? lo - s.left - 12 : hi > s.right ? hi - s.right + 12 : 0;
      if (dx) box.scrollBy({ left: dx, behavior: REDUCE.matches ? 'auto' : 'smooth' });
    }
  }
  /** The texts in the page's language (a language switch: no picture is loaded again). */
  function drawTexts() {
    const name = tr(view.productName);
    $('vw-name').textContent = name;
    document.title = name ? t('view.docTitle', { name }) : t('view.pageTitle');
    pics.forEach((img, i) => { img.alt = altOf(i); });
    document.querySelectorAll('.vw-failed').forEach((box) => { box.dataset.msg = t('view.imgFailed'); });
    drawChrome();
  }

  // ---------- Moving ----------
  /** Show page `page`; `dir` is +1 / -1 for one step forward / back (the page turns), 0 for a jump. */
  function show(page, dir = 0) {
    if (turn) turn.done(); // (a click while a page turns: that one lands, the next one turns)
    const list = steps();
    const from = stepOf(list, at);
    const to = stepOf(list, page);
    if (to === from) return;
    // A thumbnail next to this spread turns the page too.
    const d = dir || (Math.abs(to - from) === 1 ? to - from : 0);
    if (mode === 'spread' && d) return turnLeaf(list[to][0], d);
    at = list[to][0];
    drawChrome();
    drawStage(d);
    // A phone at the last page: "Make your own" (under the buttons) comes into sight.
    if (mode === 'single' && booklet() && to === list.length - 1) {
      requestAnimationFrame(() => $('vw-end').scrollIntoView({ block: 'nearest', behavior: REDUCE.matches ? 'auto' : 'smooth' }));
    }
  }
  function go(dir) {
    const list = steps();
    const to = stepOf(list, at) + dir;
    if (to >= 0 && to < list.length) show(list[to][0], dir);
  }
  /** Phones and computers switch at 900 px: the same page stays on screen. */
  function setMode() {
    const next = booklet() && WIDE.matches && view.pages.length > 1 ? 'spread' : 'single';
    if (next === mode) return false;
    if (turn) turn.done();
    mode = next;
    $('vw-stage').dataset.mode = mode;
    endHome();
    $('vw-view').replaceChildren();
    return true;
  }

  // ---------- Start ----------
  function showOnly(which) {
    for (const k of ['vw-loading', 'vw-gone', 'vw-failed', 'vw-body']) $(k).hidden = k !== which;
    $('vw-foot').hidden = which !== 'vw-body';
  }
  async function load() {
    showOnly('vw-loading');
    let data;
    try {
      if (!id) throw Object.assign(new Error('no id'), { status: 404 });
      data = clean(await POD.api(`/api/views/${encodeURIComponent(id)}`));
    } catch (e) {
      // An old or wrong link: ask whoever sent it for a new one. Anything else (no connection): try again.
      if (e.status === 404 || e.status === 410 || e.status === 400 || e.code === 'viewNotFound' || e.code === 'viewExpired') return showOnly('vw-gone');
      $('vw-failed-text').textContent = e.message || '';
      return showOnly('vw-failed');
    }
    if (!data.pages.length) return showOnly('vw-gone');
    view = data;
    at = 0;
    pics.clear();
    $('vw-make').href = view.makeOwn;
    $('vw-make-foot').href = view.makeOwn;
    $('vw-body').dataset.kind = view.kind;
    showOnly('vw-body');
    setMode();
    drawTexts();
    drawStage();
    // The thumbnails once the page on screen and the next one are in (or after a while on a slow line).
    const first = steps().slice(0, 2).flat().map(pic);
    Promise.all(first.map(loaded)).then(() => setTimeout(loadThumbs, 120));
    setTimeout(loadThumbs, 5000);
  }

  $('vw-retry').addEventListener('click', load);
  $('vw-prev').addEventListener('click', () => go(-1));
  $('vw-next').addEventListener('click', () => go(1));
  $('vw-thumbs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) show(Number(b.dataset.page));
  });
  $('vw-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) show(Number(b.dataset.page));
  });
  // Arrow keys turn the pages the way they point (whatever the binding).
  document.addEventListener('keydown', (e) => {
    if (!view || $('vw-body').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    go((e.key === 'ArrowLeft') === flowRtl() ? 1 : -1);
  });
  // Swipe sideways to turn (one finger; not while the page is pinch-zoomed in, when a swipe moves round the zoom).
  const zoomed = () => Boolean(window.visualViewport) && window.visualViewport.scale > 1.05;
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => document.body.classList.toggle('vw-zoomed', zoomed()));
  }
  let swipe = null;
  let swipedAt = 0;
  const stage = $('vw-stage');
  stage.addEventListener('pointerdown', (e) => {
    swipe = e.isPrimary && e.button <= 0 && !zoomed() ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  });
  stage.addEventListener('pointercancel', () => { swipe = null; });
  stage.addEventListener('pointerup', (e) => {
    if (!swipe || e.pointerId !== swipe.id || !view) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    swipedAt = Date.now();
    // Dragging the page to the left shows what lies on the right.
    go((dx < 0) !== flowRtl() ? 1 : -1);
  });
  // A click on a picture: one that didn't load is asked for again; on a computer, a page of the booklet turns
  // towards its side (the right-hand page of a left-bound booklet goes forward).
  stage.addEventListener('click', (e) => {
    if (!view || Date.now() - swipedAt < 400) return;
    if (e.target.closest('.vw-failed')) return drawStage();
    const slot = mode === 'spread' && e.target.closest('.vw-slot:not(.vw-empty)');
    if (slot) go((slot.dataset.side === 'left') === flowRtl() ? 1 : -1);
  });
  WIDE.addEventListener('change', () => {
    if (!view || !setMode()) return;
    drawChrome();
    drawStage();
  });
  document.addEventListener('pod:langchange', () => { if (view) drawTexts(); });
  load();
})();
