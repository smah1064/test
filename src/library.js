'use strict';

/*
 * Ready-made designs shop.
 *
 * Starter designs are written here as layouts of text, shapes and stickers in
 * fractions of the print area (the same format as the editor's templates),
 * so each one fits any product. Text without a colour uses dark or light ink
 * to suit the garment colour.
 *
 * The shop owner adds more from the admin dashboard, from a share link made
 * in the editor; those keep the editor's own objects and are scaled to each
 * product's print area. They live in DATA_DIR/library/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCENT = '#ff5a36';
const GOLD = '#e0a526';
const GREEN = '#2f9e44';
const PINK = '#e64980';
const T = (text, font, size, x, y, extra = {}) => ({ kind: 'text', text, font, size, x, y, ...extra });
const S = (shape, w, x, y, extra = {}) => ({ kind: 'shape', shape, w, x, y, ...extra });
const K = (sticker, w, x, y, extra = {}) => ({ kind: 'sticker', sticker, w, x, y, ...extra });

const CATEGORIES = [
  { id: 'funny', name: { en: 'Funny phrases', ar: 'جمل مضحكة' } },
  { id: 'ramadan', name: { en: 'Ramadan', ar: 'رمضان' } },
  { id: 'football', name: { en: 'Football', ar: 'كورة' } },
  { id: 'eid', name: { en: 'Eid', ar: 'العيد' } },
  { id: 'love', name: { en: 'Love', ar: 'حب' } },
  { id: 'birthday', name: { en: 'Birthday', ar: 'عيد ميلاد' } },
  { id: 'family', name: { en: 'Family', ar: 'العيلة' } },
  { id: 'egypt', name: { en: 'Egypt', ar: 'مصر' } },
  { id: 'motivation', name: { en: 'Motivation', ar: 'تحفيز' } },
];

const D = (id, category, en, ar, items, color = 'white') => ({ id, category, name: { en, ar }, kind: 'template', product: 'tshirt', color, items });

const SEED = [
  // ---------- Funny Egyptian phrases ----------
  D('mesh-fady', 'funny', 'Busy right now', 'مش فاضي', [
    T('مش فاضي', 'Lalezar', 0.3, 0.5, 0.42),
    T('حاليًا', 'Marhey', 0.14, 0.5, 0.66, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('coffee-first', 'funny', 'No talking before coffee', 'مفيش كلام قبل القهوة', [
    K('coffee', 0.3, 0.5, 0.26),
    T('مفيش كلام', 'Lalezar', 0.2, 0.5, 0.6),
    T('قبل القهوة', 'Marhey', 0.14, 0.5, 0.8, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('sleep-best', 'funny', 'Sleep beats everything', 'النوم أحسن من أي حاجة', [
    T('النوم', 'Lalezar', 0.28, 0.5, 0.32),
    T('أحسن من', 'Changa', 0.12, 0.5, 0.54, { weight: 'bold' }),
    T('أي حاجة', 'Lalezar', 0.24, 0.5, 0.75, { fill: ACCENT }),
  ]),
  D('mazagy', 'funny', 'Mood: high', 'مزاجي عالي', [
    K('cool', 0.28, 0.5, 0.25),
    T('مزاجي', 'Lalezar', 0.26, 0.5, 0.58),
    T('عالي', 'Marhey', 0.17, 0.5, 0.8, { fill: ACCENT, weight: 'bold' }),
  ], 'black'),
  D('ana-geet', 'funny', 'I have arrived', 'أنا جيت', [
    T('أنا جيت', 'Lalezar', 0.28, 0.5, 0.4),
    T('نوّرت المكان', 'Lemonada', 0.1, 0.5, 0.65, { weight: 'bold', fill: '#ffffff', bg: ACCENT, bgShape: 'banner' }),
  ]),
  D('mat2la2sh', 'funny', 'Don\'t worry', 'متقلقش', [
    T('متقلقش', 'Lalezar', 0.28, 0.5, 0.42),
    T('كله هيبقى تمام', 'Changa', 0.11, 0.5, 0.66, { weight: 'bold', fill: ACCENT }),
  ]),
  D('ga3an', 'funny', 'Always hungry', 'جعان على طول', [
    T('جعان', 'Jomhuria', 0.62, 0.5, 0.44),
    T('على طول', 'Marhey', 0.14, 0.5, 0.78, { fill: ACCENT, weight: 'bold' }),
  ], 'black'),
  D('khaleha', 'funny', 'Leave it to God', 'خليها على الله', [
    T('خليها', 'Aref Ruqaa', 0.24, 0.5, 0.38, { weight: 'bold' }),
    T('على الله', 'Aref Ruqaa', 0.24, 0.5, 0.66, { weight: 'bold', fill: GOLD }),
  ]),
  // ---------- Ramadan ----------
  D('ramadan-fanous', 'ramadan', 'Ramadan Kareem lantern', 'فانوس رمضان كريم', [
    K('fanous', 0.3, 0.5, 0.25),
    T('رمضان كريم', 'Aref Ruqaa', 0.2, 0.5, 0.62, { weight: 'bold' }),
    T('RAMADAN KAREEM', 'Playfair Display', 0.06, 0.5, 0.82, { spacing: 200, fill: GOLD }),
  ]),
  D('ramadan-yegma3na', 'ramadan', 'Ramadan brings us together', 'رمضان يجمعنا', [
    S('crescent', 0.24, 0.5, 0.2, { fill: GOLD }),
    S('star', 0.07, 0.66, 0.12, { fill: GOLD }),
    T('رمضان', 'Lalezar', 0.3, 0.5, 0.52),
    T('يجمعنا', 'Marhey', 0.17, 0.5, 0.76, { fill: GOLD, weight: 'bold' }),
  ], 'black'),
  D('ramadan-wanas', 'ramadan', 'Ramadan vibes', 'ونس رمضان', [
    K('mosque', 0.42, 0.5, 0.32),
    T('ونس رمضان', 'Lemonada', 0.15, 0.5, 0.74, { weight: 'bold' }),
  ]),
  D('ahlan-ramadan', 'ramadan', 'Ahlan Ramadan', 'أهلًا رمضان', [
    K('stars', 0.2, 0.22, 0.2),
    K('crescent', 0.22, 0.78, 0.2),
    T('أهلًا رمضان', 'Reem Kufi', 0.2, 0.5, 0.55, { weight: 'bold', fill: GOLD }),
    T('Ahlan Ramadan', 'Dancing Script', 0.11, 0.5, 0.76, { weight: 'bold' }),
  ], 'black'),
  // ---------- Football ----------
  D('kora-hayaty', 'football', 'Football is my life', 'الكورة حياتي', [
    K('ball', 0.3, 0.5, 0.24),
    T('الكورة', 'Lalezar', 0.26, 0.5, 0.56),
    T('حياتي', 'Lalezar', 0.26, 0.5, 0.8, { fill: ACCENT }),
  ]),
  D('captain', 'football', 'Captain', 'الكابتن', [
    S('shield', 0.5, 0.5, 0.38, { fill: ACCENT }),
    T('C', 'Anton', 0.24, 0.5, 0.36, { fill: '#ffffff' }),
    T('الكابتن', 'Kufam', 0.15, 0.5, 0.82, { weight: 'bold' }),
  ]),
  D('goooal', 'football', 'Goooal', 'جووون', [
    T('جووووون', 'Lalezar', 0.26, 0.5, 0.44, { fill: ACCENT, extrude: '#16181d' }),
    T('GOAL!', 'Bungee', 0.11, 0.5, 0.72),
  ]),
  D('number-10', 'football', 'King of the pitch No. 10', 'ملك الملعب ١٠', [
    T('ملك الملعب', 'Changa', 0.12, 0.5, 0.14, { weight: 'bold' }),
    T('10', 'Anton', 0.66, 0.5, 0.58, { fill: ACCENT }),
  ]),
  D('born-to-play', 'football', 'Born to play', 'Born to play', [
    T('BORN TO', 'Anton', 0.14, 0.5, 0.3),
    T('PLAY', 'Anton', 0.34, 0.5, 0.55, { fill: ACCENT }),
    K('ball', 0.15, 0.5, 0.84),
  ], 'black'),
  // ---------- Eid ----------
  D('eid-mubarak', 'eid', 'Eid Mubarak', 'عيد مبارك', [
    K('eid-lantern', 0.24, 0.5, 0.24),
    T('عيد مبارك', 'Marhey', 0.22, 0.5, 0.6, { weight: 'bold', fill: GREEN }),
    T('كل سنة وانتم طيبين', 'Changa', 0.075, 0.5, 0.8, { weight: 'bold' }),
  ]),
  D('eid-sheep', 'eid', 'Eid joy', 'العيد فرحة', [
    K('eid-sheep', 0.42, 0.5, 0.32),
    T('العيد فرحة', 'Lalezar', 0.2, 0.5, 0.76),
  ]),
  // ---------- Love ----------
  D('ba7ebak', 'love', 'I love you', 'بحبك', [
    S('heart', 0.42, 0.5, 0.36, { fill: '#e03131' }),
    T('بحبك', 'Aref Ruqaa', 0.22, 0.5, 0.78, { weight: 'bold' }),
  ]),
  D('wanasy', 'love', 'You are my comfort', 'إنت ونسي', [
    T('إنتَ', 'Lalezar', 0.2, 0.5, 0.28),
    T('ونسي', 'Lalezar', 0.36, 0.5, 0.54, { fill: PINK }),
    K('hearts', 0.2, 0.5, 0.83),
  ]),
  // ---------- Birthday ----------
  D('3eed-milad', 'birthday', 'Happy birthday (Arabic)', 'عيد ميلاد سعيد', [
    K('cake', 0.3, 0.5, 0.24),
    T('عيد ميلاد', 'Lalezar', 0.2, 0.5, 0.56),
    T('سعيد', 'Lalezar', 0.26, 0.5, 0.79, { fill: ACCENT }),
  ]),
  D('birthday-squad', 'birthday', 'Birthday squad', 'Birthday squad', [
    K('party-hat', 0.22, 0.5, 0.2),
    T('BIRTHDAY', 'Bungee', 0.13, 0.5, 0.48),
    T('SQUAD', 'Bungee', 0.2, 0.5, 0.68, { fill: ACCENT }),
  ]),
  // ---------- Family ----------
  D('set-el-7abayeb', 'family', 'Best mom', 'ست الحبايب', [
    S('heart', 0.44, 0.5, 0.36, { fill: PINK }),
    T('ماما', 'Lalezar', 0.15, 0.5, 0.35, { fill: '#ffffff' }),
    T('ست الحبايب', 'Aref Ruqaa', 0.16, 0.5, 0.8, { weight: 'bold' }),
  ]),
  D('a7san-ab', 'family', 'Best dad', 'أحسن بابا', [
    K('crown', 0.28, 0.5, 0.22),
    T('بابا', 'Jomhuria', 0.5, 0.5, 0.58),
    T('أحسن أب في الدنيا', 'Changa', 0.09, 0.5, 0.86, { weight: 'bold', fill: ACCENT }),
  ]),
  // ---------- Egypt ----------
  D('masry', 'egypt', 'Proudly Egyptian', 'مصري وأفتخر', [
    K('pyramids', 0.44, 0.5, 0.28),
    T('مصري', 'Lalezar', 0.28, 0.5, 0.64),
    T('وأفتخر', 'Marhey', 0.15, 0.5, 0.85, { fill: GOLD, weight: 'bold' }),
  ]),
  D('cairo', 'egypt', 'Cairo', 'القاهرة', [
    T('CAIRO', 'Abril Fatface', 0.22, 0.5, 0.4),
    T('القاهرة', 'Reem Kufi', 0.14, 0.5, 0.6, { weight: 'bold', fill: GOLD }),
    K('palm', 0.16, 0.5, 0.82),
  ], 'black'),
  // ---------- Motivation ----------
  D('kammel', 'motivation', 'Keep going', 'كمّل', [
    T('كمّل', 'Lalezar', 0.38, 0.5, 0.4, { fill: ACCENT }),
    T('ومتبصش وراك', 'Changa', 0.11, 0.5, 0.66, { weight: 'bold' }),
  ]),
  D('dream-big', 'motivation', 'Dream big', 'Dream big', [
    K('sparkle', 0.16, 0.2, 0.18),
    T('DREAM', 'Anton', 0.26, 0.5, 0.4),
    T('BIG', 'Anton', 0.32, 0.5, 0.66, { fill: ACCENT }),
  ], 'black'),
];

// Designs that look best on one of the newer products open on it by default
// (customers can still switch to any product on the design page).
const DEFAULT_PRODUCT = {
  'number-10': ['jersey', 'white'],
  captain: ['jersey', 'white'],
  'eid-mubarak': ['eidenvelopes', 'gold'],
  'eid-sheep': ['eidenvelopes', 'white'],
  ba7ebak: ['couplemugs', 'white'],
  wanasy: ['couplemugs', 'white'],
  'ramadan-fanous': ['tablecloth', 'white'],
  '3eed-milad': ['greetingcard', 'white'],
  'set-el-7abayeb': ['prayermat', 'white'],
  kammel: ['tumbler', 'white'],
};
for (const d of SEED) {
  if (DEFAULT_PRODUCT[d.id]) [d.product, d.color] = DEFAULT_PRODUCT[d.id];
}

// ---------- Custom designs (added by the shop owner) ----------
class Library {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'library');
    fs.mkdirSync(this.dir, { recursive: true });
    this.indexPath = path.join(this.dir, 'index.json');
    this.index = { hidden: [], custom: [] };
    this.stamp = null;
    this.reload();
  }
  /** Re-read the index if another copy of the app changed it. */
  reload() {
    let stamp = null;
    try {
      const st = fs.statSync(this.indexPath);
      stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch (e) {
      return;
    }
    if (stamp === this.stamp) return;
    try {
      this.index = { hidden: [], custom: [], ...JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) };
      this.stamp = stamp;
    } catch (e) { /* half-written; try next time */ }
  }
  save() {
    const tmp = `${this.indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.index, null, 2));
    fs.renameSync(tmp, this.indexPath);
    try {
      const st = fs.statSync(this.indexPath);
      this.stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch (e) { /* ignore */ }
  }
  /** Every design, newest custom ones first, with `hidden` set. */
  all() {
    this.reload();
    const hidden = new Set(this.index.hidden);
    return [...this.index.custom.slice().reverse(), ...SEED].map((d) => ({ ...d, hidden: hidden.has(d.id) }));
  }
  visible() {
    return this.all().filter((d) => !d.hidden);
  }
  get(id) {
    const d = this.all().find((x) => x.id === id);
    if (!d) return null;
    if (d.kind === 'objects') {
      try {
        return { ...d, objects: JSON.parse(fs.readFileSync(path.join(this.dir, `${d.id}.json`), 'utf8')) };
      } catch (e) {
        return null;
      }
    }
    return d;
  }
  previewPath(id) {
    return path.join(this.dir, `${id}.png`);
  }
  addCustom({ name, category, product, color, objects, area, preview }) {
    this.reload();
    const id = 'c-' + crypto.randomBytes(6).toString('hex');
    fs.writeFileSync(path.join(this.dir, `${id}.json`), JSON.stringify(objects));
    if (preview) fs.writeFileSync(this.previewPath(id), preview);
    const meta = { id, category, name, kind: 'objects', product, color, area, createdAt: new Date().toISOString() };
    this.index.custom.push(meta);
    this.save();
    return meta;
  }
  setHidden(id, hidden) {
    this.reload();
    if (!this.all().some((d) => d.id === id)) return false;
    this.index.hidden = this.index.hidden.filter((x) => x !== id);
    if (hidden) this.index.hidden.push(id);
    this.save();
    return true;
  }
  removeCustom(id) {
    this.reload();
    const before = this.index.custom.length;
    this.index.custom = this.index.custom.filter((d) => d.id !== id);
    if (this.index.custom.length === before) return false;
    this.index.hidden = this.index.hidden.filter((x) => x !== id);
    for (const f of [`${id}.json`, `${id}.png`]) fs.rmSync(path.join(this.dir, f), { force: true });
    this.save();
    return true;
  }
}

module.exports = { Library, CATEGORIES, SEED };
