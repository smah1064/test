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

  function fill(str, params) {
    return params ? str.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? '')) : str;
  }

  /** Translate a UI string key. */
  function t(key, params) {
    const pair = STRINGS[key];
    if (!pair) return key;
    return fill(pair[lang === 'ar' ? 1 : 0], params);
  }

  /** Pick the current language from a { en, ar } value (plain strings pass through). */
  function tr(value) {
    if (value && typeof value === 'object') return value[lang] || value.en || '';
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
      });
    }
    return catalogPromise;
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
  function num(n) {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 1 }).format(n);
  }

  // ---------- Cart (designs live on the server; the cart keeps references) ----------
  function getCart() {
    try {
      const items = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(items) ? items : [];
    } catch (e) {
      return [];
    }
  }
  function setCart(items) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch (e) {
      toast(t('msg.saveCartFailed'), 'error');
    }
    updateCartBadge();
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
    const res = await fetch(url, { ...options, headers: { 'x-lang': lang, ...(options.headers || {}) } });
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) {
      const err = new Error((body && body.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  function initChrome() {
    applyI18n();
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
    return {
      get: (productId) => run('readonly', (s) => s.get(productId)).catch(() => null),
      set: (productId, draft) => run('readwrite', (s) => s.put(draft, productId)).then(() => true).catch(() => false),
      remove: (productId) => run('readwrite', (s) => s.delete(productId)).catch(() => null),
      all: () => run('readonly', (s) => s.getAll()).catch(() => []),
    };
  })();

  window.POD = {
    get lang() {
      return lang;
    },
    t, tr, setLang, applyI18n,
    loadCatalog, fillMockup, mockupUrl, svgDataUrl, luminance,
    money, date, num,
    getCart, setCart, updateCartBadge, toast, esc, api, drafts,
  };
})();
