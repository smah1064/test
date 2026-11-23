'use strict';

/**
 * Import a design from a link: a product page on another site (we look for
 * its main pictures) or a direct image link. The customer confirms they own
 * the design or have permission to print it before it goes in the cart.
 *
 * Fetching links typed by visitors is risky, so:
 *  - only http/https on the usual ports, no user:password@ in links
 *  - every address the host name resolves to must be public (no localhost,
 *    private networks, cloud metadata...), and the connection is made to the
 *    address that was checked (no DNS rebinding); redirects are checked again
 *  - size limits (pages 3 MB, images 15 MB) and a 12 s timeout
 *  - images are decoded by sharp with a pixel limit and re-encoded, so only
 *    plain pixels reach the editor (never SVG or anything that can run)
 */
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');

const MAX_PAGE = 3e6;
const MAX_IMAGE = 15e6;
const TIMEOUT = 12000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

class ImportError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

/** True for addresses a visitor must not make us reach. */
function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return privateAddress(mapped[1]);
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8');
  }
  return true;
}

/** dns.lookup that refuses private addresses (used for the actual connection). */
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: options.family || 4 }];
    if (!list.length || list.some((a) => privateAddress(a.address))) return cb(new ImportError('importBlocked'));
    if (options.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

function checkUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch (e) {
    throw new ImportError('importBadUrl');
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new ImportError('importBadUrl');
  if (u.port && !['80', '443'].includes(u.port)) throw new ImportError('importBadUrl');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && privateAddress(u.hostname.replace(/^\[|\]$/g, ''))) throw new ImportError('importBlocked');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new ImportError('importBlocked');
  return u;
}

/** GET a URL safely; follows up to 5 redirects. Resolves { url, type, body }. */
function safeGet(raw, { maxBytes, accept }) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    const go = (u) => {
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(u, {
        lookup: safeLookup,
        timeout: TIMEOUT,
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'ar,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br' },
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (++hops > 5) return reject(new ImportError('importFailed', 'too many redirects'));
          try {
            return go(checkUrl(new URL(res.headers.location, u).href));
          } catch (e) {
            return reject(e);
          }
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new ImportError(res.statusCode === 403 || res.statusCode === 429 ? 'importRefused' : 'importFailed', `HTTP ${res.statusCode}`));
        }
        if (Number(res.headers['content-length']) > maxBytes) {
          res.destroy();
          return reject(new ImportError('importTooBig'));
        }
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks = [];
        let size = 0;
        stream.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            stream.destroy();
            reject(new ImportError('importTooBig'));
          } else chunks.push(c);
        });
        stream.on('end', () => resolve({ url: u.href, type: String(res.headers['content-type'] || '').toLowerCase(), body: Buffer.concat(chunks) }));
        stream.on('error', (e) => reject(new ImportError('importFailed', e.message)));
      });
      req.on('timeout', () => req.destroy(new ImportError('importFailed', 'timeout')));
      req.on('error', (e) => reject(e instanceof ImportError ? e : new ImportError(e.code === 'ENOTFOUND' ? 'importBadUrl' : 'importFailed', e.message)));
    };
    try {
      go(checkUrl(raw));
    } catch (e) {
      reject(e);
    }
  });
}

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2F;/gi, '/');
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : '';
};

/** The main pictures of a product page, best first (at most 8), and its title. */
function pageImages(html, pageUrl) {
  const found = [];
  const add = (u) => {
    if (!u || typeof u !== 'string' || u.startsWith('data:')) return;
    try {
      const abs = new URL(decode(u.trim()), pageUrl);
      if (!['http:', 'https:'].includes(abs.protocol)) return;
      if (!found.includes(abs.href)) found.push(abs.href);
    } catch (e) { /* not a link */ }
  };
  // 1. Share pictures (what the shop chose to show in link previews).
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop')).toLowerCase();
    if (['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image'].includes(key)) add(attr(tag, 'content'));
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) if (/image_src/i.test(attr(tag, 'rel'))) add(attr(tag, 'href'));
  // 2. Product data (schema.org JSON-LD).
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v) => {
        if (!v || typeof v !== 'object') return;
        if (Array.isArray(v)) return v.forEach(walk);
        const img = v.image;
        if (typeof img === 'string') add(img);
        else if (Array.isArray(img)) img.forEach((x) => (typeof x === 'string' ? add(x) : x && add(x.url || x.contentUrl)));
        else if (img && typeof img === 'object') add(img.url || img.contentUrl);
        for (const k of ['@graph', 'offers', 'hasVariant', 'mainEntity']) walk(v[k]);
      };
      walk(JSON.parse(m[1].trim()));
    } catch (e) { /* broken JSON-LD */ }
  }
  // 3. Big pictures in the page (product galleries), skipping icons and sprites.
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    if (found.length >= 8) break;
    const w = Number(attr(tag, 'width')) || 0;
    if (w && w < 200) continue;
    const src = attr(tag, 'data-old-hires') || attr(tag, 'data-zoom-image') || attr(tag, 'data-large_image') || attr(tag, 'data-src') || attr(tag, 'src');
    if (!src || /sprite|logo|icon|avatar|pixel|badge|\.svg(\?|$)/i.test(src)) continue;
    add(src);
  }
  const t = /<meta[^>]+property=["']og:title["'][^>]*>/i.exec(html);
  const title = (t && attr(t[0], 'content')) || ((/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] || '');
  return { title: decode(title).trim().slice(0, 200), images: found.slice(0, 8) };
}

/** Reads a page or an image link: { title, images: [url...] }. */
async function readLink(url, get = safeGet) {
  const res = await get(url, { maxBytes: MAX_PAGE, accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5' }).catch((e) => {
    // A direct image link bigger than a page is still fine to fetch as an image.
    if (e.code === 'importTooBig') return { url, type: 'image/unknown', body: Buffer.alloc(0) };
    throw e;
  });
  if (res.type.startsWith('image/')) return { title: '', images: [res.url] };
  if (!/html|xml/.test(res.type) && !/^\s*</.test(res.body.slice(0, 200).toString('utf8'))) throw new ImportError('importNoImages');
  const out = pageImages(res.body.toString('utf8'), res.url);
  if (!out.images.length) throw new ImportError('importNoImages');
  return out;
}

/** Fetches an image link and returns a clean PNG/JPEG (at most maxPx on the long side). */
async function fetchImage(url, { maxPx = 4000, thumb = 0 } = {}, get = safeGet, sharp = require('sharp')) {
  const res = await get(url, { maxBytes: MAX_IMAGE, accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' });
  let meta;
  try {
    meta = await sharp(res.body, { limitInputPixels: 60e6, failOn: 'none' }).metadata();
  } catch (e) {
    throw new ImportError('importNotImage');
  }
  if (!['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff'].includes(meta.format)) throw new ImportError('importNotImage');
  const size = thumb || maxPx;
  let img = sharp(res.body, { limitInputPixels: 60e6, failOn: 'none', animated: false }).rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
  const alpha = meta.hasAlpha || meta.format === 'png' || meta.format === 'gif';
  img = alpha ? img.png({ compressionLevel: thumb ? 6 : 8 }) : img.jpeg({ quality: thumb ? 80 : 92, mozjpeg: true });
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return { body: data, type: alpha ? 'image/png' : 'image/jpeg', width: info.width, height: info.height, source: res.url };
}

module.exports = { ImportError, privateAddress, checkUrl, safeGet, pageImages, readLink, fetchImage, MAX_IMAGE };
