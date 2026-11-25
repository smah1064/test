/* Shared helpers for every page: language, catalog, mockups, cart, UI bits. */
(function () {
  'use strict';

  const CART_KEY = 'pod-cart-v2';
  const LANG_KEY = 'pod-lang';
  const STRINGS = window.POD_STRINGS || {};

  // ---------- Language ----------
  function storedLang() {
    try {
      return localStorage.getItem(LANG_KEY);
    } catch (e) {
      return null;
    }
  }
  // Arabic by default; the shopper's choice is remembered.
  let lang = storedLang() === 'en' ? 'en' : 'ar';

  function applyDir() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }
  applyDir();

  // Arabic pages never mix digits: the shop's own texts (labels, product data, messages) show
  // numbers as ١٢٣. Codes stay as they are (A5, 3D, 2XL, links, colours), and so does anything
  // the customer typed (only the shop's texts go through here).
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const LATIN_NUM = /(?<![A-Za-z0-9_\-/@:#=?&%"'.])\d+(?:[.,]\d+)*(?![A-Za-z0-9_\-/@:%"']|[.,]\d)/g;
  function arabicDigits(s) {
    return String(s).replace(LATIN_NUM, (m) => m.replace(/\d/g, (d) => AR_DIGITS[d]).replace(/\./g, '٫').replace(/,/g, '٬'));
  }
  function fill(str, params) {
    return params ? str.replace(/\{(\w+)\}/g, (_, k) => {
      const v = params[k];
      // Numbers passed as numbers are counts, not customer text: in the page's digits.
      return typeof v === 'number' && lang === 'ar' ? arabicDigits(String(v)) : (v ?? '');
    }) : str;
  }

  /** Translate a UI string key. */
  function t(key, params) {
    const pair = STRINGS[key];
    if (!pair) return key;
    return fill(lang === 'ar' ? arabicDigits(pair[1]) : pair[0], params);
  }

  /** Pick the current language from a { en, ar } value (plain strings pass through). */
  function tr(value) {
    if (value && typeof value === 'object') {
      const v = value[lang] || value.en || '';
      return lang === 'ar' && value.ar ? arabicDigits(v) : v;
    }
    return value == null ? '' : String(value);
  }

  /** Fill every [data-i18n*] element under root. */
  function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
    root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
    const titleKey = document.body && document.body.dataset.titleKey;
    if (titleKey) document.title = t(titleKey);
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'ar';
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      /* the choice just won't be remembered */
    }
    applyDir();
    applyI18n();
    document.dispatchEvent(new CustomEvent('pod:langchange', { detail: { lang } }));
  }

  // ---------- Catalog ----------
  let catalogPromise = null;
  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch('/api/products').then((r) => {
        if (!r.ok) throw new Error(t('msg.loadFailed'));
        return r.json();
      }).then((catalog) => {
        hideEmptyMenus(catalog);
        return catalog;
      });
    }
    return catalogPromise;
  }
  /*
   * The shop only lists what can be ordered now (admin → Products: hidden, removed and
   * out-of-stock products are not in /api/products). Menu links to a part of the shop
   * with nothing in it are hidden: "Kids' books" without any book, "Photos" without photo prints.
   */
  function hideEmptyMenus(catalog) {
    const list = (catalog && catalog.products) || [];
    const apply = () => {
      const off = {
        '.site-header nav .nav-books': !list.some((p) => p.category === 'kids'),
        '.site-header nav a[href="/photos"]': !list.some((p) => p.kind === 'photoset'),
      };
      for (const [sel, hide] of Object.entries(off)) document.querySelectorAll(sel).forEach((a) => a.classList.toggle('nav-off', hide));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }
  /**
   * The product whose pictures (photos, lifestyle and ready-design pictures, model photos)
   * a product uses: products the manager made from another one use that one's.
   */
  const assetId = (p) => (p ? p.base || p.id : '');
  /** A choice (colour or size) that can be picked: listed and not sold out. */
  const canPick = (x) => Boolean(x) && !x.soldOut;
  /** The first colour / size that can be picked (or the first one when all are sold out). */
  const firstPick = (list) => (list || []).find(canPick) || (list || [])[0];
  /**
   * A product's picture on cards and lists: the photo the manager chose (admin → Products),
   * else the real product photo recoloured on the server (products made from another one get that one's
   * photo there), the drawn product if it fails: see thumbFallback.
   */
  function productPicture(p, color) {
    if (p.mainPhoto) return p.mainPhoto;
    const c = color || firstPick(p.colors) || {};
    if (p.kind === 'book') return `/api/books/${encodeURIComponent(p.book)}/sample/0.jpg?lang=${lang}`;
    return `/api/thumbs/${encodeURIComponent(p.id)}/${encodeURIComponent(c.id || '')}.webp`;
  }
  /** The drawn product in its colour: for a picture that didn't load. */
  function thumbFallback(p, color) {
    const c = color || firstPick(p.colors) || {};
    try { return mockupUrl(p.sides[0], c.hex || '#ffffff', 'full') || ''; } catch (e) { return ''; }
  }

  // ---------- Colour helpers ----------
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function mix(hex, target, amount) {
    const a = hexToRgb(hex);
    const b = hexToRgb(target);
    return rgbToHex(a.map((v, i) => v + (b[i] - v) * amount));
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** Fill an SVG mockup template for a product colour. */
  function fillMockup(template, hex) {
    const dark = luminance(hex) < 0.25;
    const shade = dark ? mix(hex, '#ffffff', 0.12) : mix(hex, '#000000', 0.1);
    const line = dark ? mix(hex, '#ffffff', 0.28) : mix(hex, '#000000', 0.32);
    return template.replace(/\{\{C\}\}/g, hex).replace(/\{\{S\}\}/g, shade).replace(/\{\{L\}\}/g, line);
  }
  function svgDataUrl(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function mockupUrl(side, hex, layer) {
    let tpl = layer === 'overlay' ? side.overlay : side.svg;
    // 'full' = product plus its top layer (camera, spiral, shine) for thumbnails.
    if (layer === 'full' && side.overlay) tpl = side.svg.replace('</svg>', side.overlay.replace(/^<svg[^>]*>/, ''));
    return tpl ? svgDataUrl(fillMockup(tpl, hex)) : null;
  }

  // ---------- Money & dates ----------
  function money(n) {
    const v = Number(n);
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: v % 1 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(v);
  }
  function date(iso) {
    return new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }
  /*
   * CAPTCHA (Cloudflare Turnstile) for a form: captcha(boxElement) gives { prepare, token, reset }.
   * The widget is only shown when Cloudflare needs the customer to tick a box; usually it checks
   * silently. Nothing happens when the shop has no CAPTCHA keys (token() is then null).
   */
  let captchaKey;
  let captchaScript;
  const captchaSiteKey = async () => {
    if (captchaKey === undefined) {
      try { captchaKey = (await api('/api/captcha')).siteKey || null; } catch (e) { captchaKey = null; }
    }
    return captchaKey;
  };
  const loadTurnstile = () => (captchaScript ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('captcha')));
    s.onerror = () => { captchaScript = null; reject(new Error('captcha')); };
    document.head.appendChild(s);
  }));
  function captcha(box) {
    let widget = null;
    let current = null;
    let waiting = [];
    let starting = null;
    const done = (tok) => { current = tok; waiting.splice(0).forEach((w) => w(tok)); };
    const start = () => (starting ||= (async () => {
      const key = await captchaSiteKey();
      if (!key) return null;
      const ts = await loadTurnstile();
      widget = ts.render(box, {
        sitekey: key,
        language: lang,
        appearance: 'interaction-only',
        size: 'flexible',
        callback: done,
        'expired-callback': () => { current = null; },
        'error-callback': () => { current = null; },
      });
      return ts;
    })().catch(() => { starting = null; return null; }));
    return {
      /** Start the check early (e.g. when the customer starts typing). */
      prepare() { start(); },
      /** The token for the next request (waits for Cloudflare; null when the CAPTCHA is off). */
      async token() {
        const ts = await start();
        if (!ts) return captchaKey ? '' : null;
        if (current) return current;
        return new Promise((resolve) => {
          waiting.push(resolve);
          setTimeout(() => { waiting = waiting.filter((w) => w !== resolve); resolve(current || ''); }, 30000);
        });
      },
      /** A token works once: get a fresh one after each request. */
      reset() {
        current = null;
        if (widget != null && window.turnstile) try { window.turnstile.reset(widget); } catch (e) { /* gone */ }
      },
    };
  }

  /** A calendar day (YYYY-MM-DD) as "Thursday 26 November". */
  function day(ymd) {
    try {
      return new Date(ymd + 'T12:00:00Z').toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    } catch (e) {
      return ymd;
    }
  }
  function num(n) {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 1 }).format(n);
  }

  // ---------- Cart (designs live on the server; the cart keeps references) ----------
  // One list in the browser: the items being bought, and those "saved for later" (later: true, kept
  // out of the order). getCart / setCart only see and change the first; getSaved / setSaved the second.
  // movedAt says when an item last moved between the two, so the latest move wins across devices.
  function rawCart() {
    try {
      const items = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      // Damaged or very old entries are left out instead of breaking the whole cart.
      return Array.isArray(items) ? items.filter((it) => it && typeof it === 'object' && typeof it.designId === 'string').map((it) => (Array.isArray(it.sides) ? it : { ...it, sides: [] })) : [];
    } catch (e) {
      return [];
    }
  }
  function writeRaw(items) {
    let ok = true;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch (e) {
      toast(t('msg.saveCartFailed'), 'error');
      ok = false;
    }
    updateCartBadge();
    if (ok) cartToAccount();
    return ok;
  }
  const getCart = () => rawCart().filter((it) => !it.later);
  const getSaved = () => rawCart().filter((it) => it.later);
  function setCart(items) {
    const ids = new Set(items.map((it) => it.designId));
    return writeRaw([...items.map((it) => { const { later, ...rest } = it; return rest; }), ...getSaved().filter((it) => !ids.has(it.designId))]);
  }
  function setSaved(items) {
    const ids = new Set(items.map((it) => it.designId));
    return writeRaw([...getCart().filter((it) => !ids.has(it.designId)), ...items.map((it) => ({ ...it, later: true }))]);
  }
  /**
   * Is this ready design offered on this product? The shop works out each
   * design's products once (src/library.js: subject, print-area shape, name
   * fields) and sends them as `products`; the designs page, the product page and
   * the editor all ask here. (Without the list: never on laser products, fabric
   * by the metre, books or photo prints.)
   */
  const designFor = (d, p) => (Array.isArray(d.products) ? d.products.includes(p.id) : !(p.laser || p.pattern || p.kind));
  /** Move one item out of the order to "saved for later" (later = true) or back into the cart. */
  function moveItem(designId, later) {
    const now = new Date().toISOString();
    return writeRaw(rawCart().map((it) => (it.designId === designId ? { ...it, later: Boolean(later) || undefined, movedAt: now } : it)));
  }
  /** Upload one file of a design; a dropped connection gives the shop's own message, not the browser's. */
  async function putFile(url, token, body) {
    try {
      return await fetch(url, { method: 'PUT', headers: { 'x-upload-token': token, 'x-lang': lang, 'Content-Type': 'application/octet-stream' }, body });
    } catch (e) {
      const err = new Error(t('msg.network'));
      err.network = true;
      throw err;
    }
  }
  function updateCartBadge() {
    const n = getCart().length;
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  // ---------- UI ----------
  function toast(message, type) {
    let root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      // Screen readers read each message out (errors right away).
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 5000 : 2800);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(url, options = {}) {
    let res;
    try {
      res = await fetch(url, { ...options, headers: { 'x-lang': lang, ...(options.headers || {}) } });
    } catch (e) {
      // No connection: say so in the shopper's language instead of the browser's "Failed to fetch".
      const err = new Error(t('msg.network'));
      err.network = true;
      throw err;
    }
    const body = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null;
    if (!res.ok) {
      const err = new Error((body && body.error) || t('msg.requestFailed', { status: res.status }));
      err.status = res.status;
      err.code = body && body.code;
      throw err;
    }
    return body;
  }

  /** "Account" in every shop header (next to the cart): a person icon, with the word on wider screens. */
  function addAccountLink() {
    const cartLink = document.querySelector('.site-header nav .cart-link');
    if (!cartLink || document.querySelector('[data-account-link]')) return;
    const a = document.createElement('a');
    a.href = '/account';
    a.className = 'acct-link';
    a.setAttribute('data-account-link', '');
    a.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg><span data-i18n="nav.account"></span>';
    cartLink.before(a);
  }
  /** Footer: a link to the rights / takedown page. */
  function addFooterLinks() {
    const f = document.querySelector('.site-footer .container');
    if (!f || f.querySelector('[data-rights-link]')) return;
    if (f.hasAttribute('data-i18n')) {
      // The footer text is translated into the box itself: move it into a span so the link survives.
      const span = document.createElement('span');
      span.dataset.i18n = f.dataset.i18n;
      f.removeAttribute('data-i18n');
      f.textContent = '';
      f.append(span);
    }
    f.insertAdjacentHTML('beforeend', ' · <a href="/privacy" data-i18n="pp2.link" style="color:inherit"></a> · <a href="/rights" data-rights-link data-i18n="rights.policy" style="color:inherit"></a>');
    // The white logo (from the brand kit) on the dark footer, in the page's language.
    const text = document.createElement('div');
    text.className = 'footer-text';
    text.append(...f.childNodes);
    f.append(text);
    f.insertAdjacentHTML('afterbegin', '<a class="footer-logo" href="/" aria-label="إبداع · ebda3"><img class="for-ar" src="/img/logo-ar-white.svg" alt="" width="91" height="60"><img class="for-en" src="/img/logo-en-white.svg" alt="" width="147" height="60"></a>');
  }
  function initChrome() {
    addAccountLink();
    addFooterLinks();
    applyI18n();
    document.querySelectorAll('[data-account-link]').forEach((a) => a.setAttribute('aria-label', t('nav.account')));
    updateCartBadge();
    document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => setLang(lang === 'ar' ? 'en' : 'ar'));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChrome);
  else initChrome();
  window.addEventListener('storage', (e) => e.key === CART_KEY && updateCartBadge());

  // ---------- Error reports ----------
  // Script errors are sent to the server log so problems on shoppers' phones can be fixed.
  let reported = 0;
  function reportError(msg, src, line, stack) {
    if (reported++ >= 5) return;
    const body = JSON.stringify({ page: location.pathname, msg: String(msg || ''), src: src || '', line: line || '', stack: String(stack || '').slice(0, 600) });
    try {
      if (!navigator.sendBeacon || !navigator.sendBeacon('/api/client-error', body)) {
        fetch('/api/client-error', { method: 'POST', body, keepalive: true }).catch(() => {});
      }
    } catch (e) { /* never let reporting break the page */ }
  }
  window.addEventListener('error', (e) => reportError(e.message, e.filename, e.lineno, e.error && e.error.stack));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason && e.reason.message || e.reason, '', '', e.reason && e.reason.stack));

  // ---------- Saved designs (drafts) ----------
  // One unfinished design per product, kept in this browser (IndexedDB, so
  // uploaded photos fit). Every call resolves, even where storage is blocked.
  const drafts = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('pod-drafts', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('drafts');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('drafts', mode);
        const req = fn(tx.objectStore('drafts'));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    };
    // Each draft in this browser remembers whose it is (the signed-in customer's id, or none for a
    // guest). Before any draft is shown or saved the page asks the shop who is signed in (once per
    // page): drafts of anyone else are never shown, saved to the wrong account, or left behind as a
    // guest's. When the shop can't be asked (offline, slow), only guest drafts are shown.
    const owner = () => {
      try {
        const v = localStorage.getItem('pod-acct');
        return v && v !== '1' ? v : '';
      } catch (e) {
        return '';
      }
    };
    const setOwner = (id) => {
      try { if (id) localStorage.setItem('pod-acct', id); else localStorage.removeItem('pod-acct'); } catch (e) { /* private mode */ }
    };
    let who; // undefined: not asked yet; '' guest; an id: signed in; null: couldn't ask
    let asking = null;
    const withTimeout = (ms) => {
      const c = new AbortController();
      setTimeout(() => c.abort(), ms);
      return c.signal;
    };
    const raw = {
      get: (productId) => run('readonly', (s) => s.get(productId)).catch(() => null),
      all: () => run('readonly', (s) => s.getAll()).catch(() => []),
      clear: () => run('readwrite', (s) => s.clear()).catch(() => null),
    };
    function identify() {
      if (who !== undefined) return Promise.resolve(who);
      return (asking ||= (async () => {
        try {
          const res = await fetch('/api/account', { credentials: 'same-origin', signal: withTimeout(8000) });
          const body = res.ok ? await res.json() : null;
          who = body ? (body.customer && body.customer.id) || '' : null;
        } catch (e) {
          who = null;
        }
        // Another customer than the last one here, or their session ended without signing out (a shared
        // phone): nothing of theirs stays in this browser for the next person.
        if (who !== null && owner() && owner() !== who) {
          await raw.clear();
          forgetPersonal();
        }
        if (who !== null) setOwner(who);
        return who;
      })());
    }
    const mine = (d) => Boolean(d) && (!d.owner || (who && d.owner === who));
    const local = {
      get: async (productId) => { await identify(); const d = await raw.get(productId); return mine(d) ? d : null; },
      // Saved only while the same customer is signed in as when this page started (signing out in another
      // tab stops it: the draft never becomes a guest's).
      set: async (productId, draft) => {
        await identify();
        if (who === null || owner() !== (who || '')) return false;
        return run('readwrite', (s) => s.put({ ...draft, owner: who || undefined }, productId)).then(() => true).catch(() => false);
      },
      remove: (productId) => run('readwrite', (s) => s.delete(productId)).catch(() => null),
      all: async () => { await identify(); return (await raw.all()).filter(mine); },
      clear: raw.clear,
    };
    // Signed-in customers: every draft is also kept on their account, so a
    // design started on the phone opens on the laptop (the newest copy wins).
    const url = (productId) => `/api/account/drafts/${encodeURIComponent(productId)}`;
    const blobToDataUrl = (blob) => new Promise((resolve) => {
      if (!blob) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
    async function fromAccount(productId) {
      if (!(await identify())) return null;
      try {
        const res = await fetch(url(productId), { credentials: 'same-origin', signal: withTimeout(8000) });
        if (!res.ok || res.status === 204 || res.headers.get('x-account') !== who) return null;
        return await res.json();
      } catch (e) {
        return null;
      }
    }
    // Uploads not sent yet ({ productId: accountId }), kept so a page closed before the upload
    // went out sends it on the next visit.
    const PENDING = 'pod-draft-sync';
    const pending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || '{}') || {}; } catch (e) { return {}; } };
    const setPending = (productId, account) => {
      try {
        const p = pending();
        if (account) p[productId] = account;
        else delete p[productId];
        if (Object.keys(p).length) localStorage.setItem(PENDING, JSON.stringify(p));
        else localStorage.removeItem(PENDING);
      } catch (e) { /* private mode */ }
    };
    const timers = new Map(); // productId -> { timer, run }
    const sending = new Map(); // productId -> the upload on its way (waited for before a delete)
    async function upload(productId, draft, account) {
      if (owner() !== account) return false; // signed out or someone else since
      try {
        const { preview, ...rest } = draft;
        const body = JSON.stringify({ ...rest, previewDataUrl: await blobToDataUrl(preview) });
        const res = await fetch(url(productId), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Account': account }, body, keepalive: body.length < 60000 });
        if (res.ok || res.status === 409) setPending(productId, null);
        return res.ok;
      } catch (e) {
        return false; // offline: the copy in this browser is kept, and sent next time
      }
    }
    function toAccount(productId, draft) {
      if (!who || owner() !== who) return;
      const account = who;
      setPending(productId, account);
      const old = timers.get(productId);
      if (old) clearTimeout(old.timer);
      const run = () => {
        timers.delete(productId);
        const p = upload(productId, draft, account).finally(() => { if (sending.get(productId) === p) sending.delete(productId); });
        sending.set(productId, p);
        return p;
      };
      timers.set(productId, { timer: setTimeout(run, 1500), run });
    }
    /** Send a waiting upload now (Save, leaving the page); resolves when it's done. */
    function flush(productId) {
      const job = timers.get(productId);
      if (!job) return Promise.resolve(true);
      clearTimeout(job.timer);
      return job.run();
    }
    window.addEventListener('pagehide', () => { for (const [id] of timers) flush(id); });
    // Uploads a closed page didn't finish: send them from the copy kept in this browser.
    setTimeout(async () => {
      const p = pending();
      if (!Object.keys(p).length) return;
      const me = await identify();
      if (!me) return;
      for (const [productId, account] of Object.entries(p)) {
        if (account !== me) { setPending(productId, null); continue; }
        if (timers.has(productId)) continue;
        const d = await raw.get(productId);
        if (d && mine(d) && d.designs) await upload(productId, d, account);
        else setPending(productId, null);
      }
    }, 1200);
    return {
      async get(productId) {
        const acct = await fromAccount(productId);
        const here = await local.get(productId);
        if (acct && acct.designs && (!here || String(acct.savedAt || '') > String(here.savedAt || ''))) {
          const { previewDataUrl, ...draft } = acct; // eslint-disable-line no-unused-vars
          return draft;
        }
        return here;
      },
      async set(productId, draft) {
        const ok = await local.set(productId, draft);
        if (ok) toAccount(productId, draft);
        return ok;
      },
      flush,
      async remove(productId) {
        const job = timers.get(productId);
        if (job) clearTimeout(job.timer);
        timers.delete(productId);
        setPending(productId, null);
        await local.remove(productId);
        if (who) {
          // An upload already on its way would bring the draft back after the delete: let it land first.
          await (sending.get(productId) || Promise.resolve()).catch(() => null);
          // Waited for, so a page reloaded right after ("Start a new design") doesn't get the account's copy back.
          await fetch(url(productId), { method: 'DELETE', credentials: 'same-origin', keepalive: true, signal: withTimeout(8000) }).catch(() => {});
        }
      },
      all: local.all,
      /**
       * Every unfinished design to list ("My saved designs"): the ones in this browser and,
       * when signed in, the ones on the account (the newest copy of each product), newest first.
       */
      async list() {
        const has = (d) => d && d.designs && Object.values(d.designs).some((objs) => Array.isArray(objs) && objs.length);
        const map = new Map();
        for (const d of await local.all()) {
          if (d && d.productId && has(d)) map.set(d.productId, { productId: d.productId, colorId: d.colorId, sizeId: d.sizeId, savedAt: d.savedAt || '', preview: d.preview instanceof Blob ? d.preview : null });
        }
        if (await identify()) {
          try {
            const res = await fetch('/api/account/drafts', { credentials: 'same-origin', signal: withTimeout(8000) });
            const body = res.ok ? await res.json() : null;
            for (const a of (body && body.drafts) || []) {
              const m = map.get(a.productId);
              if (!m || String(a.savedAt || '') > String(m.savedAt || '')) map.set(a.productId, { productId: a.productId, colorId: a.colorId, sizeId: a.sizeId, savedAt: a.savedAt || '', previewUrl: a.previewUrl || null, preview: (m && m.preview) || null });
            }
          } catch (e) { /* offline: this browser's only */ }
        }
        return [...map.values()].sort((x, y) => String(y.savedAt).localeCompare(String(x.savedAt)));
      },
      /** Who is signed in ('' a guest, null when the shop couldn't be asked). */
      whoami: identify,
      /** Forget every draft kept in this browser (signing out, another customer signing in). */
      clearLocal: () => {
        for (const [, job] of timers) clearTimeout(job.timer);
        timers.clear();
        try { localStorage.removeItem(PENDING); } catch (e) { /* private mode */ }
        return local.clear();
      },
    };
  })();

  /**
   * Forget what a customer left in this browser: cart, checkout choices, photos picked for printing and
   * a storybook's answers (signing out, a session that ended, another customer signing in).
   */
  function forgetPersonal() {
    try {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem('pod-cart-base');
      for (const k of Object.keys(localStorage)) if (k.startsWith('pod-book-')) localStorage.removeItem(k);
    } catch (e) { /* private mode */ }
    try { for (const k of ['pod-proof-ok', 'pod-coupon', 'pod-order-key', 'pod-delivery']) sessionStorage.removeItem(k); } catch (e) { /* private mode */ }
    try { indexedDB.deleteDatabase('pod-photos'); } catch (e) { /* blocked */ }
    updateCartBadge();
  }

  // ---------- The cart on the account ----------
  // Signed in: the cart is also kept on the account, so a design put in the cart on the laptop is in
  // the cart on the phone. Each browser remembers what it last agreed with the account (CART_BASE),
  // so an item removed on one device isn't brought back by another (a three-way merge).
  const CART_BASE = 'pod-cart-base';
  const cartAcct = () => {
    try {
      const v = localStorage.getItem('pod-acct');
      return v && v !== '1' ? v : '';
    } catch (e) {
      return '';
    }
  };
  function cartBase(acct) {
    try {
      const b = JSON.parse(localStorage.getItem(CART_BASE) || 'null');
      return new Set(b && b.acct === acct && Array.isArray(b.ids) ? b.ids : []);
    } catch (e) {
      return new Set();
    }
  }
  function setCartBase(acct, items) {
    try { localStorage.setItem(CART_BASE, JSON.stringify({ acct, ids: items.map((i) => i.designId) })); } catch (e) { /* private mode */ }
  }
  let cartTimer = null;
  let cartMerging = false;
  async function pushCart(acct) {
    cartTimer = null;
    if (!acct) return;
    const items = rawCart();
    // With what this device last agreed with the account: the server merges (another device may have
    // added or removed items since this page was opened) and answers with the merged cart.
    const body = JSON.stringify({ items: items.map((i) => ({ designId: i.designId, addedAt: i.addedAt, ...(i.later ? { later: true } : {}), ...(i.movedAt ? { movedAt: i.movedAt } : {}), ...(i.editToken ? { editToken: i.editToken } : {}) })), base: [...cartBase(acct)] });
    try {
      const res = await fetch('/api/account/cart', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Account': acct }, body, keepalive: body.length < 60000 });
      if (!res.ok || cartAcct() !== acct) return;
      const merged = (await res.json()).items || [];
      const now = rawCart();
      const byId = new Map(now.map((i) => [i.designId, i]));
      const out = merged.map((m) => withMove(byId.get(m.designId), m));
      if (cartKey(out) !== cartKey(now)) {
        cartMerging = true;
        writeRaw(out);
        cartMerging = false;
        document.dispatchEvent(new CustomEvent('pod:cartsynced'));
      }
      setCartBase(acct, out);
    } catch (e) { /* offline (or the page closed first): sent with the next change or visit */ }
  }
  /** This browser's entry with the account's "saved for later" state when that move is newer. */
  function withMove(local, remote) {
    if (!local) return remote;
    if (!remote || String(remote.movedAt || '') <= String(local.movedAt || '')) return local;
    return { ...local, later: remote.later ? true : undefined, movedAt: remote.movedAt };
  }
  const cartKey = (list) => list.map((i) => i.designId + (i.later ? '*' : '')).join(',');
  function cartToAccount() {
    if (cartMerging) return;
    const acct = cartAcct();
    if (!acct) return;
    clearTimeout(cartTimer);
    cartTimer = setTimeout(() => pushCart(acct), 600);
  }
  // Leaving right after a change (add to cart, then off to the cart page): send it now.
  window.addEventListener('pagehide', () => {
    if (cartTimer) {
      clearTimeout(cartTimer);
      pushCart(cartAcct());
    }
  });
  /** Bring this browser's cart and the account's together (on every page, when signed in). */
  async function mergeAccountCart() {
    if (!cartAcct()) return;
    // Who is signed in now (an ended session clears what the last customer left here).
    const me = await drafts.whoami();
    const acct = cartAcct();
    if (!me || me !== acct) return;
    let remote;
    try {
      const c = new AbortController();
      setTimeout(() => c.abort(), 8000);
      const res = await fetch('/api/account/cart', { credentials: 'same-origin', signal: c.signal });
      if (!res.ok || res.headers.get('x-account') !== acct) return;
      remote = (await res.json()).items || [];
    } catch (e) {
      return;
    }
    if (cartAcct() !== acct) return;
    const local = rawCart();
    const base = cartBase(acct);
    const inRemote = new Set(remote.map((i) => i.designId));
    const inLocal = new Set(local.map((i) => i.designId));
    // Kept: in both, or added here since the last sync. Dropped: in the last sync but gone from the
    // account (removed on another device, or ordered). Added: new on the account since the last sync.
    const byRemote = new Map(remote.map((i) => [i.designId, i]));
    const out = local.filter((i) => inRemote.has(i.designId) || !base.has(i.designId)).map((i) => withMove(i, byRemote.get(i.designId)));
    for (const i of remote) if (!inLocal.has(i.designId) && !base.has(i.designId)) out.push(i);
    if (cartKey(out) !== cartKey(local)) {
      cartMerging = true;
      writeRaw(out);
      cartMerging = false;
      document.dispatchEvent(new CustomEvent('pod:cartsynced'));
    }
    const sortKey = (list) => list.map((i) => i.designId + (i.later ? '*' : '')).sort().join(',');
    if (sortKey(remote) !== sortKey(out)) await pushCart(acct);
    else setCartBase(acct, out);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mergeAccountCart, 0));
  else setTimeout(mergeAccountCart, 0);

  // ---------- Garment sizes ----------
  // The print is the same size in cm on every garment size, so on a bigger
  // garment the print box covers less of the photo (scaled from just below the
  // collar, like src/products.js printAreaFor).
  function sizedArea(product, side, sizeId) {
    const a = side.printArea;
    const size = product.sizes.find((z) => z.id === sizeId);
    const f = product.photoChestCm && size && size.chestCm ? product.photoChestCm / size.chestCm : 1;
    if (f === 1) return a;
    const w = Math.round(a.w * f * 10) / 10;
    const h = Math.round(a.h * f * 10) / 10;
    return { ...a, x: Math.round((a.x + a.w / 2 - w / 2) * 10) / 10, w, h, ...(a.rx ? { rx: a.rx * f } : {}) };
  }
  /**
   * How big this size is drawn (1 = the biggest size fills the picture), true to
   * size. Garments: smaller sizes show a smaller garment, so the print looks the
   * same size on screen and the garment grows or shrinks around it. Sizes that
   * are bigger prints (signs A2/A1, posters, canvases, cushions, cards, flyers
   * A5/A4, the 15 oz mug...): the product is drawn in proportion to the biggest.
   */
  function sizeView(product, sizeId) {
    const size = product.sizes.find((z) => z.id === sizeId);
    if (!size) return 1;
    if (product.photoChestCm && size.chestCm) {
      const max = Math.max(...product.sizes.map((z) => z.chestCm || 0));
      return max > 0 ? Math.min(1, size.chestCm / max) : 1;
    }
    if (!product.pattern && product.sizes.some((z) => z.printScale)) {
      const max = Math.max(...product.sizes.map((z) => z.printScale || 1));
      return Math.min(1, (size.printScale || 1) / max);
    }
    return 1;
  }

  // ---------- Canvas prints: the band that wraps round the frame ----------
  /**
   * The print file of a canvas covers the front plus a band of `band` pixels
   * on every side (the frame's depth and the fold at the back). Depending on
   * the edge style the band keeps the design (wrap), mirrors the front's edges
   * (mirror) or is plain white / black. Changes the canvas element in place.
   */
  function canvasEdges(cv, band, mode) {
    if (!band || !mode || mode === 'wrap') return cv;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const b = Math.round(band);
    if (mode === 'white' || mode === 'black') {
      ctx.save();
      ctx.fillStyle = mode === 'white' ? '#ffffff' : '#111111';
      ctx.fillRect(0, 0, W, b);
      ctx.fillRect(0, H - b, W, b);
      ctx.fillRect(0, 0, b, H);
      ctx.fillRect(W - b, 0, b, H);
      ctx.restore();
      return cv;
    }
    // Mirror: each band is the front's edge strip flipped outwards (corners flipped both ways).
    const src = document.createElement('canvas');
    src.width = W;
    src.height = H;
    src.getContext('2d').drawImage(cv, 0, 0);
    const iw = W - 2 * b;
    const ih = H - 2 * b;
    const strip = (sx, sy, sw, sh, dx, dy, fx, fy) => {
      ctx.save();
      ctx.translate(dx + (fx < 0 ? sw : 0), dy + (fy < 0 ? sh : 0));
      ctx.scale(fx, fy);
      ctx.clearRect(0, 0, sw, sh);
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
      ctx.restore();
    };
    strip(b, b, iw, b, b, 0, 1, -1); // top
    strip(b, H - 2 * b, iw, b, b, H - b, 1, -1); // bottom
    strip(b, b, b, ih, 0, b, -1, 1); // left
    strip(W - 2 * b, b, b, ih, W - b, b, -1, 1); // right
    strip(b, b, b, b, 0, 0, -1, -1); // corners
    strip(W - 2 * b, b, b, b, W - b, 0, -1, -1);
    strip(b, H - 2 * b, b, b, 0, H - b, -1, -1);
    strip(W - 2 * b, H - 2 * b, b, b, W - b, H - b, -1, -1);
    return cv;
  }

  // ---------- Fabric patterns ----------
  /**
   * Fill the rectangle (x, y, w, h) of a 2D context with a tile repeated the
   * chosen way: straight, halfdrop (every other column moved down half a
   * tile), halfbrick (every other row moved across half a tile) or mirror
   * (neighbours flipped, so edges always meet). tw, th: one tile's size.
   */
  function drawPattern(ctx, tile, { repeat = 'straight', tw, th, x = 0, y = 0, w, h }) {
    if (!tile || !(tw > 0) || !(th > 0)) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const cols = Math.ceil(w / tw) + 1;
    const rows = Math.ceil(h / th) + 1;
    for (let c = -1; c <= cols; c++) {
      for (let r = -1; r <= rows; r++) {
        let dx = x + c * tw;
        let dy = y + r * th;
        if (repeat === 'halfdrop' && c & 1) dy += th / 2;
        if (repeat === 'halfbrick' && r & 1) dx += tw / 2;
        if (repeat === 'mirror') {
          const fx = c & 1 ? -1 : 1;
          const fy = r & 1 ? -1 : 1;
          ctx.save();
          ctx.translate(dx + (fx < 0 ? tw : 0), dy + (fy < 0 ? th : 0));
          ctx.scale(fx, fy);
          ctx.drawImage(tile, 0, 0, tw, th);
          ctx.restore();
        } else ctx.drawImage(tile, dx, dy, tw, th);
      }
    }
    ctx.restore();
  }
  /**
   * Where the neighbouring copies of a tile sit (for a w x h tile). Artwork
   * that crosses the tile's edge is drawn again at these offsets so the
   * pattern joins up without seams (mirror repeats join by themselves).
   */
  function wrapOffsets(repeat, w, h) {
    if (repeat === 'mirror') return [];
    if (repeat === 'halfdrop') return [[0, -h], [0, h], [-w, -h / 2], [-w, h / 2], [w, -h / 2], [w, h / 2], [-w, -1.5 * h], [w, 1.5 * h]];
    if (repeat === 'halfbrick') return [[-w, 0], [w, 0], [-w / 2, -h], [w / 2, -h], [-w / 2, h], [w / 2, h], [-1.5 * w, -h], [1.5 * w, h]];
    return [[-w, -h], [0, -h], [w, -h], [-w, 0], [w, 0], [-w, h], [0, h], [w, h]];
  }
  /** The real size (cm) of a fabric product at a size: [width, height]. */
  const fabricCm = (product, sizeId) => {
    const z = product.sizes.find((s) => s.id === sizeId) || product.sizes[0];
    return z.cm || [145, 100];
  };

  window.POD = {
    get lang() {
      return lang;
    },
    t, tr, arabicDigits, setLang, applyI18n,
    loadCatalog, assetId, canPick, firstPick, productPicture, thumbFallback, fillMockup, mockupUrl, svgDataUrl, luminance,
    money, date, day, num, captcha,
    getCart, setCart, getSaved, setSaved, moveItem, designFor, putFile, updateCartBadge, toast, esc, api, drafts, forgetPersonal,
    sizedArea, sizeView, canvasEdges, drawPattern, wrapOffsets, fabricCm,
  };
})();
