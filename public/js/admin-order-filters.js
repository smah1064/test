/*
 * Admin → Orders: search, status chips with live counts, more filters (payment, delivery speed, the day the order
 * was placed, governorate, product), the order of the list, and 50 orders at a time. admin.js draws the rows
 * (renderOrders); this file only decides which orders, in which order, and draws its own controls above them.
 *
 * The filters are kept for this browser tab (sessionStorage), so the 15-second refresh and a tab switch keep them,
 * and the refresh never moves the keyboard focus: the controls are drawn once and only their numbers change.
 * No amounts: nothing here filters or sorts by money (Operations sees none). A coupon code is searched only when
 * this person may see amounts and the order answer carries it (the server leaves it out for the others).
 */
(function () {
  'use strict';

  const STORE_KEY = 'pod-admin-order-filters';
  const PAGE = 50;
  const SORTS = ['new', 'old', 'due'];
  const CHIPS = ['all', 'review', 'customer', 'received', 'in_production', 'ready', 'shipped', 'delivered', 'late'];
  const DEFAULTS = Object.freeze({ q: '', chip: 'all', pay: '', speed: '', from: '', to: '', gov: '', product: '', sort: 'new', more: false, limit: PAGE });
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const P = () => window.POD;

  // ---------- Words and numbers as typed ----------
  /** Arabic-Indic (٠-٩) and Persian (۰-۹) digits as 0-9. */
  const latin = (s) => String(s == null ? '' : s)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  /**
   * Text for searching: lower case, digits as 0-9, the Arabic spellings that vary (أ إ آ ٱ → ا, ة → ه, ى → ي,
   * ؤ → و, ئ → ي, Persian ی ک) as one, short vowels and tatweel left out, anything but letters and digits a space.
   * (The vowels' range stops at U+065F: the Arabic-Indic digits right after it are turned into 0-9, not dropped.)
   */
  function norm(s) {
    return latin(String(s == null ? '' : s).normalize('NFKC').toLowerCase())
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىی]/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ک/g, 'ك')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }
  /** Typed like a phone number (or a piece of one): digits, with + ( ) - . and spaces. */
  const PHONE_LIKE = /^[+\d\s().\-٠-٩۰-۹]+$/;
  /**
   * A phone number as its own digits, without Egypt's code or the leading 0: "01012345678", "+20 101 234 5678",
   * "00201012345678", "1012345678" and "٠١٠١٢٣٤٥٦٧٨" are all "1012345678". "20" is taken as the country code
   * after "+" or "00", or when the number is long enough to hold it (11 digits and more).
   */
  function phoneKey(s) {
    const raw = latin(s).trim();
    let d = raw.replace(/\D/g, '');
    const intl = /^(\+|00)/.test(raw);
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('20') && (intl || d.length >= 11)) d = d.slice(2);
    if (d.startsWith('0')) d = d.slice(1);
    return d;
  }
  /** What was typed: each word (all of them must match), and the whole of it when it is a phone number. */
  function parseQuery(q) {
    const raw = latin(String(q == null ? '' : q)).trim();
    // ("+20…" is only ever a phone number: not looked for in the text, and "+20" alone says nothing yet.)
    const words = raw.split(/\s+/).filter(Boolean).map((w) => ({
      text: /^\+/.test(w) ? [] : norm(w).split(' ').filter(Boolean),
      phone: PHONE_LIKE.test(w) ? phoneKey(w) : '',
    })).filter((w) => w.text.length || w.phone);
    const whole = PHONE_LIKE.test(raw) && raw.replace(/\D/g, '').length >= 6 ? phoneKey(raw) : '';
    return { words, phone: whole };
  }

  // ---------- An order's facts ----------
  const itemsOf = (o) => (o && Array.isArray(o.items) ? o.items : []);
  const isDelivered = (o) => o.status === 'delivered' || Boolean(o.shipment && o.shipment.deliveredAt);
  const isShipped = (o) => isDelivered(o) || o.status === 'shipped' || Boolean(o.shipment && o.shipment.shippedAt);
  /** As admin.js's orderState: delivered (the courier's date counts too), else the order's status. */
  const defaultState = (o) => (isDelivered(o) ? 'delivered' : o.status);
  const isPaid = (o) => Boolean(o.payment && o.payment.status === 'paid');
  const speedOf = (o) => (o.delivery && o.delivery.speed === 'express' ? 'express' : 'standard');
  const dueOf = (o) => (o.delivery && YMD.test(o.delivery.by || '') ? o.delivery.by : '');
  const couponOf = (o) => (typeof o.coupon === 'string' ? o.coupon : o.coupon && typeof o.coupon.code === 'string' ? o.coupon.code : '');
  const both = (v) => (v && typeof v === 'object' ? [v.en, v.ar] : [v]);
  /** The governorate an order goes to: its id (older orders: the name as written). */
  const govOf = (o) => {
    const c = (o && o.customer) || {};
    return String(c.governorate || (c.governorateName && c.governorateName.en) || '');
  };
  let dayFmt = null;
  /** The calendar day in Cairo (YYYY-MM-DD) of a time: an order placed at 00:30 Cairo time is that day's. */
  function cairoDay(when) {
    const d = when instanceof Date ? when : new Date(when);
    if (Number.isNaN(d.getTime())) return '';
    try {
      dayFmt ||= new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
      const p = Object.fromEntries(dayFmt.formatToParts(d).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}`;
    } catch (e) {
      return new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10); // (no time zones: Cairo's winter time)
    }
  }
  /** Everything the search looks at, in one line: number, customer, governorate, products, shipping, coupon. */
  function haystack(o, withCoupon) {
    const c = o.customer || {};
    const sh = o.shipment || {};
    const parts = [
      o.number, c.name, c.email, c.city, c.governorate, ...both(c.governorateName),
      ...itemsOf(o).flatMap((i) => both(i.productName)),
      sh.trackingNumber, sh.courier,
      withCoupon ? couponOf(o) : '',
    ];
    return ` ${norm(parts.filter((x) => x != null && x !== '').join(' '))} `;
  }
  /** Does the order match what was typed? Every word: in its text, or (a phone-like word) in its phone. */
  function matches(o, query, withCoupon) {
    const q = typeof query === 'string' ? parseQuery(query) : query;
    if (!q.words.length) return true;
    const phone = phoneKey((o.customer && o.customer.phone) || '');
    if (q.phone && phone && phone.includes(q.phone)) return true;
    const text = haystack(o, withCoupon);
    // (Typed without the space inside: "pod1003" for POD-1003, "عبدالرحمن" for عبد الرحمن. Six letters or more, so a
    // short word doesn't match across two words. QA 25 Nov.)
    const tight = text.replace(/ /g, '');
    const has = (x) => text.includes(x) || (x.length >= 6 && tight.includes(x));
    return q.words.every((w) => (w.text.length && w.text.every(has)) || Boolean(w.phone && phone && phone.includes(w.phone)));
  }

  // ---------- Chips, filters, order ----------
  /** ctx: { state(o), today: YYYY-MM-DD in Cairo }. */
  const CHIP_TEST = {
    all: () => true,
    // An item waits for the shop's check.
    review: (o) => itemsOf(o).some((i) => i.status === 'review'),
    // An item waits for the customer: their approval of the proof, or the changes the shop asked for.
    customer: (o) => itemsOf(o).some((i) => i.status === 'awaiting_approval' || i.status === 'changes_requested'),
    received: (o, ctx) => ctx.state(o) === 'received',
    // (Not the ones ready to ship: each order in one stage. QA 25 Nov.)
    in_production: (o, ctx) => ctx.state(o) === 'in_production' && !CHIP_TEST.ready(o),
    // Every item printed (or already handed over), the order not shipped yet.
    ready: (o) => itemsOf(o).length > 0 && itemsOf(o).every((i) => i.status === 'printed' || i.status === 'shipped') && !isShipped(o),
    shipped: (o, ctx) => ctx.state(o) === 'shipped',
    delivered: (o, ctx) => ctx.state(o) === 'delivered',
    // The day it should have arrived by has passed (in Cairo), and it hasn't been delivered.
    late: (o, ctx) => Boolean(dueOf(o)) && dueOf(o) < ctx.today && ctx.state(o) !== 'delivered',
  };
  /** The more filters: '' is any. */
  function passesMore(o, F) {
    if (F.pay && (F.pay === 'paid') !== isPaid(o)) return false;
    if (F.speed && speedOf(o) !== F.speed) return false;
    if (F.gov && govOf(o) !== F.gov) return false;
    if (F.product && !itemsOf(o).some((i) => i.productId === F.product)) return false;
    if (F.from || F.to) {
      // (Dates typed the wrong way round: the days between them.)
      const [a, b] = F.from && F.to && F.from > F.to ? [F.to, F.from] : [F.from, F.to];
      const d = cairoDay(o.createdAt);
      if (!d || (a && d < a) || (b && d > b)) return false;
    }
    return true;
  }
  const time = (o) => Date.parse(o.createdAt) || 0;
  /**
   * new: newest first (as the server sends them); old: oldest first; due: the day it should arrive by, soonest
   * first. When sorting by due date, delivered orders come after the ones still on their way (nothing left to do
   * there), and orders without a date last. Ties keep the newest-first order.
   */
  function sortOrders(list, sort, ctx = { state: defaultState }) {
    const out = list.slice();
    if (sort === 'old') return out.sort((a, b) => time(a) - time(b));
    if (sort === 'due') {
      const done = (o) => (ctx.state(o) === 'delivered' ? 1 : 0);
      return out.sort((a, b) => done(a) - done(b) || (dueOf(a) || '9999').localeCompare(dueOf(b) || '9999') || time(a) - time(b));
    }
    return out.sort((a, b) => time(b) - time(a));
  }
  /**
   * The orders for these filters: `scoped` match the search and the more filters (the chips count within these),
   * `list` is the chip's share of them, in the order picked; `counts` has each chip's number.
   */
  function apply(all, F, ctx) {
    const c = { state: defaultState, today: cairoDay(new Date()), coupons: false, ...ctx };
    const q = parseQuery(F.q);
    const scoped = (Array.isArray(all) ? all : []).filter((o) => o && passesMore(o, F) && matches(o, q, c.coupons && Boolean(couponOf(o))));
    const counts = {};
    for (const k of CHIPS) counts[k] = scoped.filter((o) => CHIP_TEST[k](o, c)).length;
    const chip = CHIP_TEST[F.chip] ? F.chip : 'all';
    return { scoped, counts, list: sortOrders(scoped.filter((o) => CHIP_TEST[chip](o, c)), F.sort, c) };
  }
  /** A kept or typed set of filters, with anything unknown dropped. */
  function sanitize(v) {
    const s = { ...DEFAULTS };
    if (!v || typeof v !== 'object') return s;
    if (typeof v.q === 'string') s.q = v.q.slice(0, 100);
    if (CHIPS.includes(v.chip)) s.chip = v.chip;
    if (v.pay === 'paid' || v.pay === 'unpaid') s.pay = v.pay;
    if (v.speed === 'express' || v.speed === 'standard') s.speed = v.speed;
    if (YMD.test(v.from || '')) s.from = v.from;
    if (YMD.test(v.to || '')) s.to = v.to;
    if (typeof v.gov === 'string') s.gov = v.gov.slice(0, 80);
    if (typeof v.product === 'string') s.product = v.product.slice(0, 120);
    if (SORTS.includes(v.sort)) s.sort = v.sort;
    s.more = v.more === true;
    if (Number.isInteger(v.limit) && v.limit > PAGE && v.limit <= 100 * PAGE) s.limit = Math.ceil(v.limit / PAGE) * PAGE;
    return s;
  }
  const isFiltered = (F) => Boolean(String(F.q || '').trim() || F.chip !== 'all' || F.pay || F.speed || F.from || F.to || F.gov || F.product);
  /** How many of the more filters are set (the dates count once). */
  const moreCount = (F) => [F.pay, F.speed, F.from || F.to, F.gov, F.product].filter(Boolean).length;
  /** The governorates and products the orders have, for the filters' lists: [{ value, label }] by name. */
  function choices(all) {
    const tr = (v) => (P() && P().tr ? P().tr(v) : both(v)[0] || '');
    const gov = new Map();
    const prod = new Map();
    for (const o of Array.isArray(all) ? all : []) {
      if (!o) continue;
      const g = govOf(o);
      if (g && !gov.has(g)) gov.set(g, tr(o.customer.governorateName) || g);
      for (const i of itemsOf(o)) if (i.productId && !prod.has(i.productId)) prod.set(i.productId, tr(i.productName) || i.productId);
    }
    let coll;
    try { coll = new Intl.Collator(P() && P().lang === 'ar' ? 'ar' : 'en', { sensitivity: 'base', numeric: true }); } catch (e) { coll = { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) }; }
    const list = (m) => [...m].map(([value, label]) => ({ value, label })).sort((a, b) => coll.compare(a.label, b.label));
    return { gov: list(gov), product: list(prod) };
  }

  // ---------- Kept for this browser tab ----------
  function load() {
    try { return sanitize(JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null')); } catch (e) { return { ...DEFAULTS }; }
  }
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(F)); } catch (e) { /* private mode: only this page keeps them */ }
  }

  // ---------- The controls ----------
  let F = load();
  const opts = { rerender() {}, state: defaultState, amounts: () => false };
  let root = null;
  let moreBox = null;
  let lastAll = null;
  let last = { total: 0, matching: 0, shown: 0 };
  let timer = 0;
  let moreHtml = null;
  const $ = (id) => document.getElementById(id);

  function markup() {
    const opt = (v, key) => `<option value="${v}" data-i18n="${key}"></option>`;
    return `
      <div class="card of-card">
        <div class="of-search">
          <label for="of-q" data-i18n="of.search"></label>
          <input type="search" id="of-q" autocomplete="off" spellcheck="false" maxlength="100" dir="auto" enterkeyhint="search" data-i18n-placeholder="of.searchPh">
        </div>
        <div class="chips of-chips" id="of-chips" role="group" data-i18n-aria="of.statusGroup">
          ${CHIPS.map((c) => `<button type="button" class="chip of-chip of-chip-${c}" data-of-chip="${c}" aria-pressed="false"><span data-i18n="of.chip.${c}"></span><span class="of-n" data-of-n></span></button>`).join('')}
        </div>
        <div class="of-bar">
          <button type="button" class="btn btn-sm of-more-btn" id="of-more-btn" aria-expanded="false" aria-controls="of-more"><span data-i18n="of.more"></span><span class="of-more-n" id="of-more-n" hidden></span><span class="of-caret" aria-hidden="true"></span></button>
          <div class="of-sort">
            <label for="of-sort" data-i18n="of.sort"></label>
            <select id="of-sort">${opt('new', 'of.sort.new')}${opt('old', 'of.sort.old')}${opt('due', 'of.sort.due')}</select>
          </div>
        </div>
        <div class="of-more" id="of-more" hidden>
          <div class="field"><label for="of-pay" data-i18n="of.pay"></label><select id="of-pay">${opt('', 'of.any')}${opt('paid', 'ship.paid')}${opt('unpaid', 'ship.unpaid')}</select></div>
          <div class="field"><label for="of-speed" data-i18n="of.speed"></label><select id="of-speed">${opt('', 'of.any')}${opt('express', 'of.express')}${opt('standard', 'delivery.standard')}</select></div>
          <fieldset class="of-dates">
            <legend class="of-vh" data-i18n="of.placed"></legend>
            <div class="field"><label for="of-from" data-i18n="of.from"></label><input type="date" id="of-from" dir="ltr"></div>
            <div class="field"><label for="of-to" data-i18n="of.to"></label><input type="date" id="of-to" dir="ltr"></div>
          </fieldset>
          <div class="field"><label for="of-gov" data-i18n="of.gov"></label><select id="of-gov"></select></div>
          <div class="field"><label for="of-product" data-i18n="of.product"></label><select id="of-product"></select></div>
        </div>
      </div>
      <div class="of-shown">
        <p class="muted small of-count" id="of-count" aria-live="polite"></p>
        <button type="button" class="btn btn-sm of-clear" id="of-clear" data-of-clear hidden data-i18n="of.clear"></button>
      </div>`;
  }

  /** Draw the controls once (admin.js calls this when it starts). */
  function mount(o = {}) {
    Object.assign(opts, o);
    root = $('order-filters');
    moreBox = $('orders-more');
    if (!root || root.dataset.ready) return;
    root.dataset.ready = '1';
    root.innerHTML = markup();
    P().applyI18n(root);
    setControls();
    $('of-q').addEventListener('input', () => {
      clearTimeout(timer);
      // (As you type: once the typing pauses, so a fast typist doesn't redraw 340 orders per letter.)
      timer = setTimeout(() => change({ q: $('of-q').value.slice(0, 100) }), 200);
    });
    // (The ✕ in the search box, and Enter: at once.)
    $('of-q').addEventListener('search', () => { clearTimeout(timer); change({ q: $('of-q').value.slice(0, 100) }); });
    $('of-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-of-chip]');
      if (b) change({ chip: b.dataset.ofChip });
    });
    $('of-more-btn').addEventListener('click', () => {
      F.more = !F.more;
      save();
      setMoreOpen();
    });
    $('of-sort').addEventListener('change', (e) => change({ sort: e.target.value }));
    for (const [id, k] of [['of-pay', 'pay'], ['of-speed', 'speed'], ['of-gov', 'gov'], ['of-product', 'product'], ['of-from', 'from'], ['of-to', 'to']]) {
      $(id).addEventListener('change', (e) => change({ [k]: e.target.value }));
    }
    document.addEventListener('click', (e) => { if (e.target.closest('[data-of-clear]')) clearFilters(); });
    if (moreBox) moreBox.addEventListener('click', (e) => { if (e.target.closest('[data-of-more]')) showMore(); });
    document.addEventListener('pod:langchange', () => { if (lastAll) sync(lastAll, apply(lastAll, F, context(lastAll))); });
  }
  /** A filter changed: from the first 50 again, kept, and the list drawn again. */
  function change(patch) {
    const next = sanitize({ ...F, ...patch, limit: PAGE });
    if (JSON.stringify(next) === JSON.stringify(F)) return;
    F = next;
    save();
    opts.rerender();
  }
  /** "Clear filters": the search, the chip and the more filters (the sort stays, as does the open "More filters"). */
  function clearFilters() {
    clearTimeout(timer);
    F = sanitize({ ...DEFAULTS, sort: F.sort, more: F.more });
    save();
    setControls();
    opts.rerender();
    // (The button just pressed goes away: the search box is where to start again.)
    if ($('of-q')) $('of-q').focus();
  }
  function showMore() {
    const before = last.shown;
    F.limit += PAGE;
    save();
    opts.rerender();
    // Straight to the first of the new ones (its "Shipping & payment" button), for keyboards and screen readers.
    const rows = document.querySelectorAll('#orders tr.order-row');
    const first = rows[before] && (rows[before].querySelector('[data-ship-toggle]') || rows[before].querySelector('button, a[href]'));
    if (first) first.focus();
  }
  function setMoreOpen() {
    $('of-more').hidden = !F.more;
    $('of-more-btn').setAttribute('aria-expanded', String(F.more));
  }
  /** The controls as F says (after loading the kept filters, or clearing them). */
  function setControls() {
    if (!root || !root.dataset.ready) return;
    if ($('of-q').value !== F.q) $('of-q').value = F.q;
    $('of-sort').value = F.sort;
    for (const [id, k] of [['of-pay', 'pay'], ['of-speed', 'speed'], ['of-from', 'from'], ['of-to', 'to']]) $(id).value = F[k];
    setMoreOpen();
  }
  /** A select's options, drawn again only when they changed (an open or focused list stays as it is). */
  function fill(sel, anyKey, items, value) {
    const list = value && !items.some((x) => x.value === value) ? [...items, { value, label: value }] : items;
    const sig = P().lang + '\u0001' + list.map((x) => x.value + '\u0002' + x.label).join('\u0001');
    if (sel.dataset.sig !== sig) {
      const esc = P().esc;
      sel.innerHTML = `<option value="">${esc(P().t(anyKey))}</option>` + list.map((x) => `<option value="${esc(x.value)}" dir="auto">${esc(x.label)}</option>`).join('');
      sel.dataset.sig = sig;
    }
    if (sel.value !== value) sel.value = value;
  }
  const setText = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
  /** The count line: how many are on the page, of how many. */
  function countText(total, matching, shown) {
    const { t, num, plural } = P();
    if (shown < matching) return isFiltered(F)
      ? t('of.countPaged', { n: num(shown), matching: plural('of.matching', matching), total: num(total) })
      : t('of.count', { n: num(shown), orders: plural('of.orders', total) });
    return isFiltered(F) ? t('of.count', { n: num(matching), orders: plural('of.orders', total) }) : t('of.countAll', { n: num(total) });
  }
  /** Numbers, pressed chip, lists, count line and buttons, for this answer (focus and typing stay where they are). */
  function sync(all, r) {
    if (!root || !root.dataset.ready) return;
    const { t, num } = P();
    const total = all.length;
    root.hidden = !total && !isFiltered(F);
    // The search box says what it looks in (a coupon only for people who see amounts).
    const ph = opts.amounts() ? 'of.searchPhAll' : 'of.searchPh';
    const q = $('of-q');
    if (q.dataset.i18nPlaceholder !== ph) q.dataset.i18nPlaceholder = ph;
    if (q.placeholder !== t(ph)) q.placeholder = t(ph);
    for (const b of root.querySelectorAll('[data-of-chip]')) {
      const k = b.dataset.ofChip;
      const on = F.chip === k;
      b.classList.toggle('active', on);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      setText(b.querySelector('[data-of-n]'), num(r.counts[k]));
      b.classList.toggle('of-has', r.counts[k] > 0);
    }
    const c = choices(all);
    fill($('of-gov'), 'of.anyGov', c.gov, F.gov);
    fill($('of-product'), 'of.anyProduct', c.product, F.product);
    const n = moreCount(F);
    $('of-more-n').hidden = !n;
    setText($('of-more-n'), n ? num(n) : '');
    setText($('of-count'), countText(total, r.list.length, Math.min(F.limit, r.list.length)));
    $('of-clear').hidden = !isFiltered(F);
  }
  function renderMore(matching, shown) {
    if (!moreBox) return;
    const left = matching - shown;
    moreBox.hidden = left <= 0;
    const html = left > 0 ? `<button type="button" class="btn of-show-more" data-of-more>${P().esc(P().t('of.showMore', { n: P().num(Math.min(PAGE, left)) }))}</button>` : '';
    // (Drawn again only when it changed: the refresh leaves a focused "Show more" where it is.)
    if (html !== moreHtml) moreBox.innerHTML = moreHtml = html;
  }
  const context = (all) => ({
    state: opts.state,
    today: cairoDay(new Date()),
    // (Only for people allowed amounts, and only when the answer has them: the server leaves them out otherwise.)
    coupons: Boolean(opts.amounts()) && (!window.AdminRoles || window.AdminRoles.anyAmount(all, 'total')),
  });
  /** The orders to draw now, for admin.js's renderOrders: filtered, in order, the first 50 (or more). */
  function view(all) {
    const list = Array.isArray(all) ? all : [];
    lastAll = list;
    const r = apply(list, F, context(list));
    const shown = r.list.slice(0, F.limit);
    last = { total: list.length, matching: r.list.length, shown: shown.length };
    sync(list, r);
    renderMore(r.list.length, shown.length);
    return shown;
  }
  /** The table's line when nothing matches (admin.js puts it in a row). */
  function emptyHtml() {
    const { esc, t } = P();
    const q = String(F.q || '').trim();
    return `<div class="of-empty"><p>${esc(t('of.none'))}</p>${q ? `<p class="small">${esc(t('of.searched'))} <bdi dir="auto">${esc(q)}</bdi></p>` : ''}<button type="button" class="btn btn-sm" data-of-clear>${esc(t('of.clear'))}</button></div>`;
  }
  /** Signed out: the next person starts with no filters. */
  function reset() {
    clearTimeout(timer);
    F = { ...DEFAULTS };
    lastAll = null;
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
    setControls();
  }

  window.AdminOrderFilters = {
    mount, view, emptyHtml, reset,
    get filters() { return { ...F }; },
    // (For the tests.)
    PAGE, CHIPS, DEFAULTS, norm, phoneKey, parseQuery, matches, cairoDay, apply, sortOrders, sanitize, isFiltered, moreCount, choices,
  };
})();
