/* Design library for the editor: fonts, shapes, text presets and templates.
 * Template coordinates are fractions of the print area (0..1, element centre),
 * and sizes are fractions of the print-area width, so every template fits
 * any product.
 */
(function () {
  'use strict';

  const FONTS = {
    arabic: ['Cairo', 'Tajawal', 'Lalezar', 'Reem Kufi', 'El Messiri', 'Amiri', 'Aref Ruqaa', 'Rakkas'],
    english: ['Montserrat', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Roboto Slab', 'Pacifico', 'Lobster', 'Permanent Marker'],
  };
  const BUNDLED = new Set([...FONTS.arabic, ...FONTS.english]);
  const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  const ACCENT = '#ff5a36';
  const GOLD = '#e0a526';

  // ---------- Fonts ----------
  const fontPromises = new Map();
  /** Make sure a bundled font is downloaded before the canvas measures text with it. */
  function ensureFont(family, weight = 'normal', style = 'normal') {
    if (!BUNDLED.has(family) || !document.fonts) return Promise.resolve();
    const key = `${family}|${weight}|${style}`;
    if (!fontPromises.has(key)) {
      fontPromises.set(key, document.fonts
        .load(`${style} ${weight} 40px "${family}"`, 'Aa أب')
        .catch(() => {})
        .then(() => fabric.util.clearFabricFontCache(family)));
    }
    return fontPromises.get(key);
  }
  function ensureFontsFor(objects) {
    return Promise.all(objects.filter((o) => o && o.fontFamily).map((o) => ensureFont(o.fontFamily, o.fontWeight, o.fontStyle)));
  }

  // ---------- Shapes ----------
  function starPoints(n, outer, inner, rot = -Math.PI / 2) {
    const pts = [];
    const steps = inner === outer ? n : n * 2;
    for (let i = 0; i < steps; i++) {
      const r = inner === outer || i % 2 === 0 ? outer : inner;
      const a = rot + (i * Math.PI * 2) / steps;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }
  const SHAPES = {
    square: { name: { en: 'Square', ar: 'مربع' }, icon: '<rect x="4" y="4" width="16" height="16"/>', make: (f) => new fabric.Rect({ width: 100, height: 100, fill: f }) },
    rounded: { name: { en: 'Rounded square', ar: 'مربع مستدير' }, icon: '<rect x="4" y="4" width="16" height="16" rx="4"/>', make: (f) => new fabric.Rect({ width: 100, height: 100, rx: 18, ry: 18, fill: f }) },
    circle: { name: { en: 'Circle', ar: 'دائرة' }, icon: '<circle cx="12" cy="12" r="8"/>', make: (f) => new fabric.Circle({ radius: 50, fill: f }) },
    ring: { name: { en: 'Ring', ar: 'حلقة' }, icon: '<circle cx="12" cy="12" r="7" fill="none" stroke-width="3"/>', make: (f) => new fabric.Circle({ radius: 50, fill: 'transparent', stroke: f, strokeWidth: 8, strokeUniform: true }) },
    triangle: { name: { en: 'Triangle', ar: 'مثلث' }, icon: '<path d="M12 4 21 20H3z"/>', make: (f) => new fabric.Triangle({ width: 100, height: 88, fill: f }) },
    star: { name: { en: 'Star', ar: 'نجمة' }, icon: '<path d="m12 3 2.6 5.8 6.4.6-4.8 4.2 1.4 6.3L12 16.6 6.4 19.9l1.4-6.3L3 9.4l6.4-.6z"/>', make: (f) => new fabric.Polygon(starPoints(5, 50, 21), { fill: f }) },
    heart: { name: { en: 'Heart', ar: 'قلب' }, icon: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>', make: (f) => new fabric.Path('M50 88 C20 66 0 48 0 28 C0 12 12 0 27 0 C37 0 45 5 50 14 C55 5 63 0 73 0 C88 0 100 12 100 28 C100 48 80 66 50 88 Z', { fill: f }) },
    crescent: { name: { en: 'Crescent', ar: 'هلال' }, icon: '<path d="M14 3a9 9 0 1 0 0 18a11 11 0 0 1 0-18z"/>', make: (f) => new fabric.Path('M60 5 A45 45 0 1 0 60 95 A60 60 0 0 1 60 5 Z', { fill: f }) },
    hexagon: { name: { en: 'Hexagon', ar: 'سداسي' }, icon: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>', make: (f) => new fabric.Polygon(starPoints(6, 50, 50, 0), { fill: f }) },
    burst: { name: { en: 'Burst', ar: 'انفجار' }, icon: '<path d="M12 2l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z"/>', make: (f) => new fabric.Polygon(starPoints(12, 50, 36), { fill: f }) },
    arrow: { name: { en: 'Arrow', ar: 'سهم' }, icon: '<path d="M3 10h11V5l7 7-7 7v-5H3z"/>', make: (f) => new fabric.Polygon([{ x: 0, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 5 }, { x: 100, y: 50 }, { x: 60, y: 95 }, { x: 60, y: 70 }, { x: 0, y: 70 }], { fill: f }) },
    line: { name: { en: 'Line', ar: 'خط' }, icon: '<rect x="3" y="11" width="18" height="2.5"/>', make: (f) => new fabric.Rect({ width: 140, height: 6, fill: f }) },
  };

  // ---------- Text presets ----------
  // `group`: 'basic' follows the shopper's language; the others are styles.
  const TEXT_PRESETS = [
    { group: 'basic', label: 'preset.heading', text: 'preset.headingText', size: 0.17, weight: 'bold', font: { en: 'Montserrat', ar: 'Cairo' } },
    { group: 'basic', label: 'preset.subheading', text: 'preset.subheadingText', size: 0.11, weight: 'bold', font: { en: 'Montserrat', ar: 'Cairo' } },
    { group: 'basic', label: 'preset.body', text: 'preset.bodyText', size: 0.065, weight: 'normal', font: { en: 'Montserrat', ar: 'Tajawal' } },
    { group: 'arabic', sample: 'عنوان مميز', size: 0.2, font: 'Lalezar' },
    { group: 'arabic', sample: 'بخط الرقعة', size: 0.16, font: 'Aref Ruqaa', weight: 'bold' },
    { group: 'arabic', sample: 'خط كوفي', size: 0.16, font: 'Reem Kufi', weight: 'bold' },
    { group: 'arabic', sample: 'خط نسخ أنيق', size: 0.13, font: 'Amiri' },
    { group: 'arabic', sample: 'ركّاز', size: 0.2, font: 'Rakkas', outline: true },
    { group: 'english', sample: 'BOLD', size: 0.26, font: 'Bebas Neue', outline: true },
    { group: 'english', sample: 'Script', size: 0.15, font: 'Pacifico' },
    { group: 'english', sample: 'Classic Serif', size: 0.12, font: 'Playfair Display', italic: true },
    { group: 'english', sample: 'Marker', size: 0.13, font: 'Permanent Marker' },
    { group: 'english', sample: 'CONDENSED', size: 0.14, font: 'Oswald', weight: 'bold', spacing: 120 },
  ];

  // ---------- Templates ----------
  const T = (text, font, size, x, y, extra = {}) => ({ kind: 'text', text, font, size, x, y, ...extra });
  const S = (shape, w, x, y, extra = {}) => ({ kind: 'shape', shape, w, x, y, ...extra });

  const TEMPLATES = [
    {
      id: 'birthday-ar',
      name: { en: 'Birthday (Arabic)', ar: 'عيد ميلاد' },
      items: [
        S('star', 0.14, 0.18, 0.13, { fill: GOLD, angle: -12 }),
        S('star', 0.1, 0.84, 0.2, { fill: ACCENT, angle: 14 }),
        T('عيد ميلاد', 'Lalezar', 0.24, 0.5, 0.34),
        T('سعيد', 'Lalezar', 0.32, 0.5, 0.56, { fill: ACCENT }),
        T('يا سارة', 'Aref Ruqaa', 0.15, 0.5, 0.8, { weight: 'bold' }),
      ],
    },
    {
      id: 'birthday-en',
      name: { en: 'Happy Birthday', ar: 'Happy Birthday' },
      items: [
        S('star', 0.12, 0.16, 0.14, { fill: GOLD, angle: -12 }),
        S('star', 0.09, 0.86, 0.22, { fill: ACCENT, angle: 14 }),
        T('HAPPY', 'Bebas Neue', 0.3, 0.5, 0.32, { fill: ACCENT, spacing: 60 }),
        T('BIRTHDAY', 'Bebas Neue', 0.26, 0.5, 0.54, { spacing: 60 }),
        T('Sara', 'Pacifico', 0.17, 0.5, 0.78),
      ],
    },
    {
      id: 'ramadan',
      name: { en: 'Ramadan Kareem', ar: 'رمضان كريم' },
      items: [
        S('crescent', 0.3, 0.42, 0.24, { fill: GOLD }),
        S('star', 0.09, 0.62, 0.16, { fill: GOLD }),
        T('رمضان كريم', 'Aref Ruqaa', 0.2, 0.5, 0.6, { weight: 'bold' }),
        T('RAMADAN KAREEM', 'Playfair Display', 0.065, 0.5, 0.8, { spacing: 200 }),
      ],
    },
    {
      id: 'jersey',
      name: { en: 'Team jersey', ar: 'تيشيرت فريق' },
      items: [
        T('AHMED', 'Oswald', 0.2, 0.5, 0.2, { weight: 'bold', spacing: 150 }),
        T('10', 'Oswald', 0.72, 0.5, 0.62, { weight: 'bold', fill: ACCENT, outline: true }),
      ],
    },
    {
      id: 'coffee-ar',
      name: { en: 'Coffee first (Arabic)', ar: 'القهوة أولًا' },
      items: [
        S('circle', 0.78, 0.5, 0.5, { fill: GOLD, opacity: 0.25 }),
        T('القهوة أولًا', 'Reem Kufi', 0.19, 0.5, 0.44, { weight: 'bold' }),
        T('وبعدين نتكلم', 'Tajawal', 0.1, 0.5, 0.62, { fill: ACCENT, weight: 'bold' }),
      ],
    },
    {
      id: 'coffee-en',
      name: { en: 'But first, coffee', ar: 'But first, coffee' },
      items: [
        T('BUT FIRST,', 'Montserrat', 0.1, 0.5, 0.36, { weight: 'bold', spacing: 200 }),
        T('coffee', 'Pacifico', 0.28, 0.5, 0.56, { fill: ACCENT }),
      ],
    },
    {
      id: 'family',
      name: { en: 'Family badge', ar: 'شعار العائلة' },
      items: [
        S('ring', 0.84, 0.5, 0.5, { stroke: true }),
        T('عائلة', 'Lalezar', 0.15, 0.5, 0.36),
        T('الشامي', 'Lalezar', 0.24, 0.5, 0.53, { fill: ACCENT }),
        T('منذ 2026', 'Tajawal', 0.08, 0.5, 0.71, { weight: 'bold' }),
      ],
    },
    {
      id: 'mama',
      name: { en: 'Best Mom', ar: 'أحلى ماما' },
      items: [
        S('heart', 0.5, 0.5, 0.38, { fill: '#e0384b' }),
        T('أحلى ماما', 'Aref Ruqaa', 0.19, 0.5, 0.76, { weight: 'bold' }),
      ],
    },
  ];

  /**
   * Build fabric objects for a template in the given print area.
   * `ink` is the main text colour that reads well on the product.
   */
  async function buildTemplate(tpl, area, ink) {
    await Promise.all(tpl.items.filter((i) => i.kind === 'text').map((i) => ensureFont(i.font, i.weight || 'normal', 'normal')));
    const objs = tpl.items.map((i) => {
      let o;
      if (i.kind === 'text') {
        const fill = i.fill || ink;
        o = new fabric.IText(i.text, {
          name: 'Text',
          fontFamily: i.font,
          fontSize: Math.round(area.w * i.size),
          fontWeight: i.weight || 'normal',
          fill,
          stroke: i.outline ? ink : null,
          strokeWidth: i.outline ? Math.max(1.5, area.w * 0.008) : 0,
          paintFirst: 'stroke',
          textAlign: 'center',
          charSpacing: ARABIC_RE.test(i.text) ? 0 : i.spacing || 0,
          direction: ARABIC_RE.test(i.text) ? 'rtl' : 'ltr',
        });
        if (o.width > area.w * 0.94) o.scaleToWidth(area.w * 0.94);
      } else {
        const def = SHAPES[i.shape];
        o = def.make(i.stroke ? ink : i.fill || ink);
        o.set({ name: def.name.en, angle: i.angle || 0, opacity: i.opacity ?? 1 });
        o.scaleToWidth(area.w * i.w);
      }
      o.set({ originX: 'center', originY: 'center', left: area.x + area.w * i.x, top: area.y + area.h * i.y });
      o.setCoords();
      return o;
    });
    // Squeeze vertically for wide, short print areas so nothing spills out.
    const tops = objs.map((o) => o.getBoundingRect(true, true));
    const minY = Math.min(...tops.map((r) => r.top));
    const maxY = Math.max(...tops.map((r) => r.top + r.height));
    const minX = Math.min(...tops.map((r) => r.left));
    const maxX = Math.max(...tops.map((r) => r.left + r.width));
    const s = Math.min(1, (area.h * 0.94) / (maxY - minY), (area.w * 0.96) / (maxX - minX));
    if (s < 1) {
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      objs.forEach((o) => {
        o.set({ left: cx + (o.left - cx) * s, top: cy + (o.top - cy) * s, scaleX: o.scaleX * s, scaleY: o.scaleY * s });
        o.setCoords();
      });
    }
    return objs;
  }

  const thumbCache = new Map();
  /** Small PNG preview of a template on a white square. */
  async function templateThumb(tpl) {
    if (thumbCache.has(tpl.id)) return thumbCache.get(tpl.id);
    const size = 160;
    const sc = new fabric.StaticCanvas(null, { width: size, height: size, backgroundColor: '#ffffff', renderOnAddRemove: false });
    const objs = await buildTemplate(tpl, { x: 12, y: 12, w: size - 24, h: size - 24 }, '#16181d');
    objs.forEach((o) => sc.add(o));
    sc.renderAll();
    const url = sc.toDataURL({ format: 'png' });
    sc.dispose();
    thumbCache.set(tpl.id, url);
    return url;
  }

  window.POD_DESIGN = { FONTS, BUNDLED, ARABIC_RE, ACCENT, SHAPES, TEXT_PRESETS, TEMPLATES, ensureFont, ensureFontsFor, buildTemplate, templateThumb };
})();
