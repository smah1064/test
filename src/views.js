'use strict';

// View-only links (owner's decision, 26 Nov): a customer designing a product with several pages or sides (booklets,
// two-sided cards and menus, clothes front and back, mugs...) sends a link by WhatsApp or email so someone can flip
// through it. Only to look: no approval, no comments, no prices, no customer details. The link always shows the latest
// version the customer saved (the editor sends the pictures again with the link's own key), and stops working 60 days
// after its last update.
//
// DATA_DIR/views/<id>/view.json and page-<version>-<n>.(jpg|png). Only the key's hash is kept.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[A-Za-z0-9_-]{12}$/;
const KEY_RE = /^[A-Za-z0-9_-]{32}$/;
const DAYS = 60;
const MAX_PAGES = 40; // a 32-page booklet, with room
const MAX_IMAGE = 2.5e6; // bytes, one picture
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

class ViewError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** A picture sent as a data URL: JPEG or PNG by its own first bytes, at most MAX_IMAGE. { ext, data } or null. */
function pictureOf(v) {
  const m = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
  if (!m || m[1].length > (MAX_IMAGE * 4) / 3 + 8) return null;
  const data = Buffer.from(m[1], 'base64');
  if (data.length < 64 || data.length > MAX_IMAGE) return null;
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return { ext: 'png', data };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: 'jpg', data };
  return null;
}
/** A picture's width and height from its header (PNG IHDR, JPEG SOF), or null. */
function sizeOf({ ext, data }) {
  if (ext === 'png') return data.length > 24 ? { w: data.readUInt32BE(16), h: data.readUInt32BE(20) } : null;
  for (let i = 2; i + 9 < data.length;) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1];
    const len = data.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: data.readUInt16BE(i + 5), w: data.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

class Views {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'views');
    fs.mkdirSync(this.dir, { recursive: true });
  }
  file(id, name) {
    return path.join(this.dir, id, name);
  }
  read(id) {
    if (!ID_RE.test(String(id || ''))) return null;
    try {
      return JSON.parse(fs.readFileSync(this.file(id, 'view.json'), 'utf8'));
    } catch (e) {
      return null;
    }
  }
  write(v) {
    const tmp = this.file(v.id, `view.json.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(v));
    fs.renameSync(tmp, this.file(v.id, 'view.json'));
  }
  /** Still working: updated within the last DAYS days. */
  live(v, now = Date.now()) {
    return Boolean(v) && now - Date.parse(v.updatedAt || v.createdAt || 0) <= DAYS * 864e5;
  }
  /**
   * The pictures to keep: `pages` [{ side, image }] in order, each side one the product has (`sides`: [{ id, name }]).
   * Returns [{ side, name, ext, data, w, h }] or throws ViewError.
   */
  clean(pages, sides) {
    if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) throw new ViewError(400, 'viewBad');
    return pages.map((p) => {
      const sd = p && sides.find((x) => x.id === p.side);
      const pic = sd && pictureOf(p.image);
      const size = pic && sizeOf(pic);
      if (!pic || !size || !(size.w > 0 && size.h > 0 && size.w <= 6000 && size.h <= 6000)) throw new ViewError(400, 'viewBad');
      return { side: sd.id, name: sd.name, ...pic, ...size };
    });
  }
  /** Writes the pictures as version `ver`, removes older ones. */
  put(v, pics) {
    const ver = (v.version || 0) + 1;
    for (const [n, p] of pics.entries()) fs.writeFileSync(this.file(v.id, `page-${ver}-${n}.${p.ext}`), p.data);
    for (const f of fs.readdirSync(path.join(this.dir, v.id))) {
      const m = /^page-(\d+)-\d+\.(jpg|png)$/.exec(f);
      if (m && Number(m[1]) !== ver) fs.rmSync(this.file(v.id, f), { force: true });
    }
    Object.assign(v, { version: ver, updatedAt: new Date().toISOString(), pages: pics.map((p, n) => ({ side: p.side, name: p.name, file: `page-${ver}-${n}.${p.ext}`, w: p.w, h: p.h })) });
    this.write(v);
    return v;
  }
  /** A new link: { view, key }. */
  create({ productId, kind, rtl, pics }) {
    const id = crypto.randomBytes(9).toString('base64url');
    const key = crypto.randomBytes(24).toString('base64url');
    fs.mkdirSync(path.join(this.dir, id), { recursive: true });
    const view = this.put({ id, keyHash: sha(key), productId, kind, rtl: Boolean(rtl), createdAt: new Date().toISOString(), version: 0 }, pics);
    return { view, key };
  }
  /** The link's own key (the customer's), or throws. */
  owned(id, key) {
    const v = this.read(id);
    if (!v) throw new ViewError(404, 'viewNotFound');
    if (!KEY_RE.test(String(key || '')) || !sameSecret(sha(key), v.keyHash)) throw new ViewError(403, 'viewNotYours');
    return v;
  }
  remove(id) {
    if (ID_RE.test(String(id || ''))) fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
  }
  /** Links not updated for DAYS days: removed. Returns how many. */
  cleanup(now = Date.now()) {
    let n = 0;
    let ids = [];
    try { ids = fs.readdirSync(this.dir); } catch (e) { return 0; }
    for (const id of ids) {
      const v = this.read(id);
      if (ID_RE.test(id) && (!v || !this.live(v, now))) {
        // (A folder without its file yet may be one being made right now: left for a day.)
        let age = 0;
        try { age = now - fs.statSync(path.join(this.dir, id)).mtimeMs; } catch (e) { age = 0; }
        if (v || age > 864e5) {
          this.remove(id);
          n++;
        }
      }
    }
    return n;
  }
}

module.exports = { Views, ViewError, ID_RE, KEY_RE, DAYS, MAX_PAGES, pictureOf, sizeOf };
