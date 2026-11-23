/* Shared helpers for every page: catalog loading, mockup rendering, cart, UI bits. */
(function () {
  'use strict';

  const CART_KEY = 'pod-cart-v1';

  let catalogPromise = null;
  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch('/api/products').then((r) => {
        if (!r.ok) throw new Error('Could not load products');
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

  /** Fill an SVG mockup template for a garment colour. */
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
    const tpl = layer === 'overlay' ? side.overlay : side.svg;
    return tpl ? svgDataUrl(fillMockup(tpl, hex)) : null;
  }

  // ---------- Money ----------
  const money = (n) => '$' + Number(n).toFixed(2);

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
      toast('Could not save your cart in this browser', 'error');
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

  async function api(url, options) {
    const res = await fetch(url, options);
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) {
      const err = new Error((body && body.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  document.addEventListener('DOMContentLoaded', updateCartBadge);
  window.addEventListener('storage', (e) => e.key === CART_KEY && updateCartBadge());

  window.POD = { loadCatalog, fillMockup, mockupUrl, svgDataUrl, luminance, money, getCart, setCart, updateCartBadge, toast, esc, api };
})();
