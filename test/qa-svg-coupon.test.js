'use strict';

// QA (25 Nov):
//  - the vector print file (SVG) keeps the customer's own words exactly: "@import coffee", "Visit
//    url(ebda3.me)", "مرحبا url(موقعي)" and "javascript: the good parts" were cut off, turned into "none"
//    or lost their "javascript:". Only CSS (<style>, style="…", fill="url(…)") and links (href…) are
//    cleaned, and the clean-up still lets nothing load from elsewhere or run;
//  - a coupon worth under a pound: the admin refuses amounts off and caps under 1 EGP, and a coupon that
//    takes nothing off this cart (1% of 35 EGP is 0.35: no pound) says so instead of being applied, and
//    an order never uses it up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { PRODUCTS, printWidthFor } = require('../src/products');
const { sanitizeSvg } = require('../src/security');
const coupons = require('../src/coupons');
const { format } = require('../src/i18n');

// ---------- SVG: the customer's words ----------

const TEXTS = ['@import coffee', 'Visit url(ebda3.me)', 'مرحبا url(موقعي)', 'javascript: the good parts'];
// As the editor writes them (fabric escapes & < > " ' in text).
const xml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const FONTS = "@font-face{font-family:'Cairo';font-weight:400;src:url(data:font/woff2;base64,d09GMgABAAAA) format('woff2');unicode-range:U+0600-06FF, U+0750-077F;}";
// The editor's note (comments are left out of the cleaned file, as before).
const NOTE = '<!-- ebda3 artwork: 12 x 16 in. sRGB. -->';
const STYLE = 'stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-dashoffset: 0; stroke-linejoin: miter; stroke-miterlimit: 4; fill: rgb(0,0,0); fill-rule: nonzero; opacity: 1; white-space: pre;';
/** An SVG like the editor's export: fonts in a <style>, a gradient, a picture and one <text> per line. */
function editorSvg(texts, extra = '') {
  const lines = texts.map((t, i) => `<g transform="matrix(1 0 0 1 400 ${100 + i * 60})"><text xml:space="preserve" font-family="Cairo" font-size="40" font-style="normal" font-weight="normal" style="${STYLE}"${/[\u0600-\u06ff]/.test(t) ? ' direction="rtl" text-anchor="start"' : ''}><tspan x="-180" y="12.57">${xml(t)}</tspan></text></g>\n`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n'
    + '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="12in" height="16in" viewBox="0 0 800 1000" xml:space="preserve">\n'
    + '<desc>Created with Fabric.js 5.3.0</desc>\n'
    + `${NOTE}<defs><style>${FONTS}</style>\n</defs>\n`
    + '<linearGradient id="SVGID_1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" style="stop-color:rgb(255,0,0);stop-opacity: 1"/><stop offset="100%" style="stop-color:rgb(0,0,255);stop-opacity: 1"/></linearGradient>\n'
    + '<rect x="10" y="10" width="50" height="50" style="stroke: none; fill: url(#SVGID_1); fill-rule: nonzero; opacity: 1;"/>\n'
    + '<image x="0" y="0" width="2" height="2" xlink:href="data:image/png;base64,iVBORw0KGgo=" href="data:image/png;base64,iVBORw0KGgo="></image>\n'
    + lines + extra
    + '</svg>';
}
/** The text of every <tspan>, as an XML parser reads it. */
const spans = (svg) => [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (x, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&'));

/** Well-formed XML: libxml2 (inside sharp) refuses anything else ("XML parse error"). */
async function assertWellFormed(svg, label = '') {
  const sized = svg.replace(/<svg\b(?![^>]*\bwidth=)/, '<svg width="20" height="20"');
  await assert.doesNotReject(sharp(Buffer.from(sized)).png().toBuffer(), `${label}\n${svg}`);
  // And every tag closed in order.
  const stack = [];
  for (const m of svg.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    if (m[1]) assert.strictEqual(stack.pop(), m[2], `${label}: </${m[2]}> closes the wrong tag`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepStrictEqual(stack, [], `${label}: tags left open`);
}

test('svg: the customer\'s words survive byte for byte (the editor\'s file is unchanged but for its note)', async () => {
  const more = ['Tom & Jerry <3 "quoted" it\'s', '😀 🇪🇬 emoji', 'url(', '@import', 'a;b;c', 'JaVaScRiPt:alert(1)', 'vbscript: old', 'data:text/html,hi', 'expression(1+1)', 'url(http://evil.example/x.png)'];
  const svg = editorSvg([...TEXTS, ...more]);
  const out = sanitizeSvg(svg);
  assert.strictEqual(out, svg.replace(NOTE, ''));
  assert.deepStrictEqual(spans(out), [...TEXTS, ...more]);
  for (const t of TEXTS) assert.ok(out.includes(`>${xml(t)}</tspan>`), t);
  await assertWellFormed(out, 'editor file');
  // Entities and characters written either way stay exactly as written.
  const ents = '<svg xmlns="http://www.w3.org/2000/svg"><text>&#x1F600; &#128512; &#x645;&#x631;&#x62D;&#x628;&#x627; &amp;amp; &lt;b&gt; a&gt;b ]]&gt; 100% ✓ ج.م.</text><text><![CDATA[@import url(http://e/x.css); javascript:x <b>]]></text></svg>';
  assert.strictEqual(sanitizeSvg(ents), ents);
});

test('svg: the words survive next to dangerous CSS, links and scripts, which are still removed', async () => {
  const evil = '<style>@import url(http://evil.example/a.css);.b{fill:url(http://evil.example/p#g)}</style>'
    + '<a href="javascript:alert(1)"><text onclick="alert(2)">javascript: the good parts</text></a>'
    + '<script>alert(3)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>';
  const out = sanitizeSvg(editorSvg(TEXTS, evil));
  assert.deepStrictEqual(spans(out), TEXTS);
  assert.match(out, /<a><text>javascript: the good parts<\/text><\/a>/);
  assert.doesNotMatch(out, /evil\.example|alert\(|onclick|<script|<foreignObject|@import url/i);
  assert.ok(out.includes(`<style>${FONTS}</style>`), 'the fonts stay');
  await assertWellFormed(out, 'with evil parts');
});

test('svg: dangerous CSS in <style> is cleaned there only, however it is written', async () => {
  const W = (body) => `<svg xmlns="http://www.w3.org/2000/svg">${body}<text x="1;2" style="fill:red;">after; @import x; url(y)</text><rect width="3" height="4"/></svg>`;
  const cases = [
    '<style>@import "http://evil.example/x.css";.a{fill:red}</style>',
    '<style>@IMPORT url(http://evil.example/x.css)</style>', // no ";": the rest of this CSS only
    '<style>@\\69mport url(http://evil.example/x.css);</style>', // CSS escape
    '<style>&#64;import url(http://evil.example/x.css);</style>', // XML character reference
    '<style><![CDATA[@import url(http://evil.example/x.css);]]></style>',
    "<style>.a{background:url( 'http://evil.example/x.png' )}</style>",
    '<style>.a{background:URL(//evil.example/x.png)}</style>',
    '<style>.a{background:\\75 rl(http://evil.example/x.png)}</style>', // "\75 rl(" is "url("
    '<style>.a{background:u&#114;l(http://evil.example/x.png)}</style>',
    '<style>.a{background:url(/**/http://evil.example/x.png)}</style>',
    '<style>.a{background:url&lpar;http://evil.example/x.png)}</style>', // not XML: written out as plain text
    '<style>.a{background:-webkit-image-set("http://evil.example/x.png" 1x)}</style>',
    '<style>.a{width:expression(alert(1))}</style>',
    '<style>@font-face{font-family:x;src:url(http://evil.example/f.woff2)}</style>',
    '<style>.a{background:url("data:text/html,<script>alert(1)</script>")}</style>',
    '<style>.a{background:url(javascript:alert(1))}</style>',
    '<style>.a{background:url(data:image/svg+xml;base64,PHN2Zy8+)}</style>',
    '<h:style xmlns:h="http://www.w3.org/1999/xhtml">@import url(http://evil.example/x.css);</h:style>',
    '<style>.a{fill:red}<style>@import url(http://evil.example/x.css);</style></style>',
  ];
  for (const c of cases) {
    const out = sanitizeSvg(W(c));
    // What a browser would read as the CSS: no address outside the file, nothing that runs.
    const css = [...out.matchAll(/<(?:h:)?style\b[^>]*>([\s\S]*?)<\/(?:h:)?style>/g)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).join('\n');
    assert.doesNotMatch(css, /@import|image-set\(|expression\(|\\/i, `${c}\n${out}`);
    for (const u of css.matchAll(/url\(\s*['"]?\s*([^\s'")]*)/gi)) assert.match(u[1], /^(#|data:(image\/(png|jpe?g|gif|webp)|font\/)[^,]*[;,])/i, `${c}\n${out}`);
    // Everything after the <style> is untouched: no cut to the next ";" anywhere in the file.
    assert.ok(out.endsWith('<text x="1;2" style="fill:red;">after; @import x; url(y)</text><rect width="3" height="4"/></svg>'), `${c}\n${out}`);
    await assertWellFormed(out, c);
  }
  // A CSS escape for a character XML doesn't allow can't break the file.
  const ctl = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.a{font-family:\\1 x\\F y\\0}</style><text font-family="A\\B">t</text></svg>');
  assert.doesNotMatch(ctl, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  await assertWellFormed(ctl, 'escaped control characters');
  // In-file references, embedded pictures and fonts stay.
  const ok = '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:url(#g)} .b{background:url("data:image/png;base64,iVBOR")} @font-face{src:url(data:font/woff2;base64,AAAA)}</style></svg>';
  assert.strictEqual(sanitizeSvg(ok), ok);
  // An unfinished <style> (or one closed by its parent) is still cleaned, and closed.
  for (const c of ['<style>.a{fill:url(http://evil.example/x)}', '<g><style>.a{fill:url(http://evil.example/x)}</g>']) {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">${c}</svg>`);
    assert.doesNotMatch(out, /evil/);
    assert.match(out, /<style>\.a\{fill:none\}<\/style>/);
  }
});

test('svg: style="…" and presentation attributes are cleaned; links, handlers and scripts go', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:h="http://www.w3.org/1999/xhtml">'
    + '<rect width="1" height="1" style="fill:url(http://evil.example/a#g);stroke:red" fill="url(//evil.example/b#g)" filter="u&#x72;l(http://evil.example/f#f)" mask="url(#m)" clip-path="url(#c)"/>'
    + '<rect width="1" height="1" style="behavior:url(x.htc);-moz-binding:url(http://evil.example/x.xml#a);fill:\\75 rl(http://evil.example/e)"/>'
    + '<a href="javascript:alert(1)"><text>1</text></a><a xlink:href="JaVaScRiPt:alert(1)"><text>2</text></a>'
    + '<a href="&#106;avascript:alert(1)"><text>3</text></a><a href=" java&#x09;script:alert(1)"><text>4</text></a>'
    + '<a href="vbscript:msgbox(1)"><text>5</text></a><a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"><text>6</text></a>'
    + '<a href="http://evil.example/"><text>7</text></a><use href="//evil.example/x.svg#a"/><use href="#a"/><feImage href="http://evil.example/x.png"/>'
    + '<rect width="1" height="1" onload="alert(1)" ONCLICK="alert(1)" onmouseover="alert(1)" values="javascript:alert(1)" to="vbscript:x" by="data:text/html,x"/>'
    + '<script>alert(1)</script><h:script>alert(1)</h:script><foreignObject><h:iframe src="http://evil.example/"/></foreignObject>'
    + '<h:img src="http://evil.example/x.png" srcset="http://evil.example/y.png 1x"/><set attributeName="href" to="javascript:alert(1)"/>'
    + '<image href="data:image/png;base64,AAAA" xlink:href="data:image/png;base64,AAAA"/>'
    + '<a href="#top" aria-label="Read javascript: the good parts"><text>8</text></a></svg>';
  const out = sanitizeSvg(svg);
  assert.doesNotMatch(out, /evil\.example|javascript:alert|vbscript:|data:text|<script|<h:script|<foreignObject|<h:iframe|<set\b|onload|onclick|onmouseover|\\|srcset/i, out);
  assert.match(out, /<rect width="1" height="1" style="fill:none;stroke:red" fill="none" filter="none" mask="url\(#m\)" clip-path="url\(#c\)"\/>/);
  assert.match(out, /<rect width="1" height="1" style="behavior:none;-moz-binding:none;fill:none"\/>/);
  assert.match(out, /<use href="#a"\/>/);
  assert.match(out, /<image href="data:image\/png;base64,AAAA" xlink:href="data:image\/png;base64,AAAA"\/>/);
  // Words that only mention javascript: in an attribute that isn't a link are left alone.
  assert.match(out, /<a href="#top" aria-label="Read javascript: the good parts"><text>8<\/text><\/a>/);
  for (let n = 1; n <= 8; n++) assert.ok(out.includes(`<text>${n}</text>`), `link ${n}'s words stay`);
  await assertWellFormed(out, 'attributes');
});

// ---------- Coupons: whole pounds ----------

const coupon = (over) => ({ code: 'X', active: true, type: 'percent', value: 10, products: [], categories: [], ...over });
const line = (price, productId = 'bookmarks') => ({ productId, category: 'stationery', price });
const clean = (b) => coupons.cleanCoupon({ code: 'TINY', ...b }, { products: [], categories: [] });

test('coupons: the admin refuses amounts off and caps under 1 EGP, with a clear message in both languages', () => {
  assert.deepStrictEqual(clean({ type: 'fixed', value: 0.4 }), { error: 'couponFixedMin' });
  assert.deepStrictEqual(clean({ type: 'fixed', value: '0.99' }), { error: 'couponFixedMin' });
  assert.deepStrictEqual(clean({ type: 'fixed', value: 0 }), { error: 'couponFixedMin' });
  assert.deepStrictEqual(clean({ type: 'percent', value: 10, maxDiscount: 0.5 }), { error: 'couponMaxMin' });
  assert.deepStrictEqual(clean({ type: 'percent', value: 10, maxDiscount: 0 }), { error: 'couponMaxMin' });
  assert.deepStrictEqual(clean({ type: 'fixed', value: -5 }), { error: 'couponValueBad' });
  assert.deepStrictEqual(clean({ type: 'percent', value: 0 }), { error: 'couponValueBad' });
  assert.deepStrictEqual(clean({ type: 'percent', value: 101 }), { error: 'couponValueBad' });
  // 1 EGP and more are fine; so is a small percentage, and no cap at all.
  assert.strictEqual(clean({ type: 'fixed', value: 1 }).coupon.value, 1);
  assert.strictEqual(clean({ type: 'fixed', value: '12.5' }).coupon.value, 12.5);
  assert.strictEqual(clean({ type: 'percent', value: 10, maxDiscount: 1 }).coupon.maxDiscount, 1);
  assert.strictEqual(clean({ type: 'percent', value: 0.5, maxDiscount: '' }).coupon.value, 0.5);
  assert.strictEqual(clean({ type: 'percent', value: 10 }).coupon.maxDiscount, undefined);
  assert.strictEqual(clean({ type: 'freeship' }).coupon.value, 0);
  assert.match(format('couponFixedMin', {}, 'en'), /at least EGP 1\b.*whole pounds/);
  assert.match(format('couponFixedMin', {}, 'ar'), /١ ج\.م\. على الأقل/);
  assert.match(format('couponMaxMin', {}, 'en'), /maximum discount must be at least EGP 1\b/);
  assert.match(format('couponMaxMin', {}, 'ar'), /أقصى خصم .*١ ج\.م\. على الأقل/);
});

test('coupons: one that takes nothing off this cart is refused, not applied; free shipping still works', () => {
  assert.deepStrictEqual(coupons.apply(coupon({ value: 1 }), { lines: [line(30)] }), { ok: false, reason: 'couponNoDiscount' }, '1% of 30 is 0.30');
  assert.deepStrictEqual(coupons.apply(coupon({ type: 'fixed', value: 0.4 }), { lines: [line(450)] }), { ok: false, reason: 'couponNoDiscount' }, 'an old 0.40 coupon');
  assert.deepStrictEqual(coupons.apply(coupon({ value: 50, maxDiscount: 0.4 }), { lines: [line(450)] }), { ok: false, reason: 'couponNoDiscount' }, 'an old 0.40 cap');
  assert.strictEqual(coupons.apply(coupon({ value: 1 }), { lines: [line(50)] }).discount, 1, '1% of 50 is 0.50: 1 pound');
  assert.strictEqual(coupons.apply(coupon({ type: 'fixed', value: 1 }), { lines: [line(450)] }).discount, 1);
  const ship = coupons.apply(coupon({ type: 'freeship', value: 0 }), { lines: [line(35)] });
  assert.deepStrictEqual([ship.ok, ship.discount, ship.freeShipping], [true, 0, true]);
  assert.strictEqual(coupons.apply(coupon({ type: 'freeship', value: 0 }), { lines: [line(35)], shipping: 75 }).ok, true);
  assert.deepStrictEqual(coupons.apply(coupon({ type: 'freeship', value: 0 }), { lines: [line(2000)], shipping: 0 }), { ok: false, reason: 'couponShipFree' });
  for (const lang of ['en', 'ar']) assert.ok(format('couponNoDiscount', {}, lang).length > 10);
  assert.match(format('couponNoDiscount', {}, 'en'), /doesn't lower the price of this cart/);
  assert.match(format('couponNoDiscount', {}, 'ar'), /مش بيقلل سعر السلة/);
});

// ---------- Through the shop ----------

const OPEN = { max: 1e6, ms: 1000 };
const CUSTOMER = { name: 'Test', phone: '01012345678', governorate: 'cairo', city: 'Nasr City', address: '1 Street' };
let server;
let base;
let dataDir;
let app;
let token;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-qa-svg-coupon-'));
  app = createApp({ dataDir, adminPassword: 'secret', limits: { designs: [OPEN], orders: [OPEN], couponTry: [OPEN] }, cleanupEvery: 0, requireApproval: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await post('/api/admin/login', { password: 'secret' })).json()).token;
});
test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const admin = (url, method = 'GET', body, lang) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(lang ? { 'x-lang': lang } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

/** A one-bookmark design (35 EGP) made the editor's way, with this SVG as its vector file. */
async function bookmark(svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>') {
  const p = PRODUCTS.find((x) => x.id === 'bookmarks');
  const side = p.sides.find((s) => s.id === 'front');
  const res = await post('/api/designs', { productId: p.id, color: p.colors[0].id, size: '1', sides: { front: { editor: { objects: [{ type: 'i-text', text: 'Hi' }] } } } });
  assert.strictEqual(res.status, 201, await res.clone().text());
  const created = await res.json();
  for (const name of created.files) {
    let body;
    if (name.endsWith('.svg')) body = Buffer.from(svg);
    else if (name.includes('print')) {
      const wIn = printWidthFor(p, side, '1') + 2 * (side.bleedIn || 0);
      const hIn = (printWidthFor(p, side, '1') * side.printArea.h) / side.printArea.w + 2 * (side.bleedIn || 0);
      body = await sharp({ create: { width: Math.round(wIn * 100), height: Math.round(hIn * 100), channels: 4, background: '#2050c0' } }).png().toBuffer();
    } else body = await sharp({ create: { width: 60, height: 72, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const up = await fetch(`${base}/api/designs/${created.id}/files/${name}`, { method: 'PUT', headers: { 'x-upload-token': created.uploadToken }, body });
    assert.strictEqual(up.status, 204, name);
  }
  const done = await fetch(`${base}/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });
  assert.strictEqual(done.status, 200, await done.clone().text());
  return done.json();
}

test('the SVG the admin downloads has the customer\'s words exactly as uploaded', async () => {
  const svg = editorSvg(TEXTS, '<script>alert(1)</script><a href="javascript:alert(1)"><text>x</text></a>');
  const d = await bookmark(svg);
  const r = await admin(`/api/admin/files/${d.id}/front?format=svg`);
  assert.strictEqual(r.status, 200);
  const got = Buffer.from(await r.arrayBuffer()).toString('utf8');
  assert.strictEqual(got, editorSvg(TEXTS, '<a><text>x</text></a>').replace(NOTE, ''));
  assert.deepStrictEqual(spans(got), TEXTS);
  await assertWellFormed(got, 'downloaded');
});

test('admin: TINY worth 0.40 (or a 0.50 cap) is refused, in the admin\'s language', async () => {
  for (const [lang, re] of [['en', /at least EGP 1/], ['ar', /١ ج\.م\. على الأقل/]]) {
    let r = await admin('/api/admin/coupons', 'POST', { code: 'TINY', type: 'fixed', value: '0.4' }, lang);
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, re);
    r = await admin('/api/admin/coupons', 'POST', { code: 'CAPPED', type: 'percent', value: '10', maxDiscount: '0.5' }, lang);
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, lang === 'en' ? /maximum discount/ : /أقصى خصم/);
  }
  assert.strictEqual((await admin('/api/admin/coupons', 'POST', { code: 'ONEPOUND', type: 'fixed', value: '1' })).status, 201);
  const codes = (await (await admin('/api/admin/coupons')).json()).coupons.map((c) => c.code);
  assert.deepStrictEqual(codes, ['ONEPOUND']);
});

test('a coupon that takes nothing off the cart says so, and ordering never uses it up', async () => {
  assert.strictEqual((await admin('/api/admin/coupons', 'POST', { code: 'ONEPCT', type: 'percent', value: 1, maxUses: 1 })).status, 201);
  // One saved before the admin refused amounts under a pound.
  app.locals.store.mutate((db) => { db.coupons.push({ id: 'old-tiny', code: 'TINY', type: 'fixed', value: 0.4, products: [], categories: [], active: true, maxUses: 1, note: '' }); });
  const d = await bookmark();
  for (const code of ['ONEPCT', 'tiny']) {
    for (const lang of ['en', 'ar']) {
      const q = await (await post('/api/cart/quote', { designIds: [d.id], couponCode: code }, { 'x-lang': lang })).json();
      assert.strictEqual(q.coupon, null, code);
      assert.strictEqual(q.discount, 0);
      assert.strictEqual(q.couponError, format('couponNoDiscount', {}, lang));
      assert.strictEqual(q.total, q.subtotal + q.shipping);
    }
    const r = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], couponCode: code });
    assert.strictEqual(r.status, 409, code);
    assert.strictEqual((await r.json()).code, 'couponNoDiscount');
  }
  const list = (await (await admin('/api/admin/coupons')).json()).coupons;
  for (const c of list) assert.strictEqual(c.uses, 0, `${c.code} was not used up`);
  // Without the code the order goes through as usual.
  const q = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.strictEqual((await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total })).status, 201);
});

test('free shipping and one-pound coupons still apply', async () => {
  assert.strictEqual((await admin('/api/admin/coupons', 'POST', { code: 'SHIPFREE', type: 'freeship' })).status, 201);
  const d = await bookmark();
  const plain = await (await post('/api/cart/quote', { designIds: [d.id] })).json();
  assert.ok(plain.shipping > 0);
  const q = await (await post('/api/cart/quote', { designIds: [d.id], couponCode: 'SHIPFREE' })).json();
  assert.ok(!q.couponError, q.couponError);
  assert.strictEqual(q.coupon.freeShipping, true);
  assert.strictEqual(q.baseShipping, 0);
  assert.strictEqual(q.total, q.subtotal);
  const one = await (await post('/api/cart/quote', { designIds: [d.id], couponCode: 'ONEPOUND' })).json();
  assert.strictEqual(one.discount, 1);
  const r = await post('/api/orders', { customer: CUSTOMER, designIds: [d.id], couponCode: 'SHIPFREE', expectedTotal: q.total });
  assert.strictEqual(r.status, 201, await r.clone().text());
  const list = (await (await admin('/api/admin/coupons')).json()).coupons;
  assert.strictEqual(list.find((c) => c.code === 'SHIPFREE').uses, 1);
  // What it gave: the shipping it waived, not "EGP 0" (QA 25 Nov).
  assert.strictEqual(list.find((c) => c.code === 'SHIPFREE').discountGiven, plain.shipping);
});
