/* Design library for the editor: fonts, shapes, text presets and templates.
 * Template coordinates are fractions of the print area (0..1, element centre),
 * and sizes are fractions of the print-area width, so every template fits
 * any product.
 */
(function () {
  'use strict';

  const FONTS = {
    arabic: ['Cairo', 'Tajawal', 'Lalezar', 'Reem Kufi', 'El Messiri', 'Amiri', 'Aref Ruqaa', 'Rakkas', 'Changa', 'Marhey', 'Lemonada', 'Kufam', 'Jomhuria', 'Vibes'],
    english: ['Montserrat', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Roboto Slab', 'Pacifico', 'Lobster', 'Permanent Marker', 'Anton', 'Righteous', 'Dancing Script', 'Bungee', 'Abril Fatface', 'Caveat'],
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
    ribbon: { name: { en: 'Ribbon', ar: 'شريط' }, icon: '<path d="M2 8h20l-3 4 3 4H2l3-4z"/>', make: (f) => new fabric.Polygon([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 180, y: 30 }, { x: 200, y: 60 }, { x: 0, y: 60 }, { x: 20, y: 30 }], { fill: f }) },
    shield: { name: { en: 'Shield', ar: 'درع' }, icon: '<path d="M12 2l8 3v7c0 5-4 8-8 10-4-2-8-5-8-10V5z"/>', make: (f) => new fabric.Path('M50 0 L100 18 L100 55 C100 85 75 105 50 115 C25 105 0 85 0 55 L0 18 Z', { fill: f }) },
    bubble: { name: { en: 'Speech bubble', ar: 'فقاعة كلام' }, icon: '<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>', make: (f) => new fabric.Path('M14 0 H126 Q140 0 140 14 V70 Q140 84 126 84 H50 L24 106 L28 84 H14 Q0 84 0 70 V14 Q0 0 14 0 Z', { fill: f }) },
    diamond: { name: { en: 'Diamond', ar: 'معيّن' }, icon: '<path d="M12 2l9 10-9 10-9-10z"/>', make: (f) => new fabric.Polygon([{ x: 50, y: 0 }, { x: 100, y: 60 }, { x: 50, y: 120 }, { x: 0, y: 60 }], { fill: f }) },
    cloud: { name: { en: 'Cloud', ar: 'سحابة' }, icon: '<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>', make: (f) => new fabric.Path('M30 80 A30 30 0 0 1 26 20 A36 36 0 0 1 94 22 A28 28 0 0 1 112 80 Z', { fill: f }) },
    pentagon: { name: { en: 'Pentagon', ar: 'خماسي' }, icon: '<path d="M12 2l10 7.5-4 12H6l-4-12z"/>', make: (f) => new fabric.Polygon(starPoints(5, 50, 50), { fill: f }) },
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
    { group: 'arabic', sample: 'خط مرح', size: 0.16, font: 'Marhey', weight: 'bold' },
    { group: 'arabic', sample: 'ليمونادة', size: 0.13, font: 'Lemonada', weight: 'bold' },
    { group: 'arabic', sample: 'جُمهورية', size: 0.3, font: 'Jomhuria' },
    { group: 'english', sample: 'BOLD', size: 0.26, font: 'Bebas Neue', outline: true },
    { group: 'english', sample: 'Script', size: 0.15, font: 'Pacifico' },
    { group: 'english', sample: 'Classic Serif', size: 0.12, font: 'Playfair Display', italic: true },
    { group: 'english', sample: 'Marker', size: 0.13, font: 'Permanent Marker' },
    { group: 'english', sample: 'CONDENSED', size: 0.14, font: 'Oswald', weight: 'bold', spacing: 120 },
    { group: 'english', sample: 'IMPACT', size: 0.2, font: 'Anton' },
    { group: 'english', sample: 'BUNGEE', size: 0.13, font: 'Bungee' },
    { group: 'english', sample: 'Elegant', size: 0.16, font: 'Dancing Script', weight: 'bold' },
    { group: 'english', sample: 'handwritten', size: 0.15, font: 'Caveat', weight: 'bold' },
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
    {
      id: 'eid-ar',
      name: { en: 'Eid Mubarak (Arabic)', ar: 'عيد مبارك' },
      items: [
        S('crescent', 0.26, 0.5, 0.2, { fill: GOLD }),
        S('star', 0.08, 0.66, 0.12, { fill: GOLD }),
        T('عيد مبارك', 'Marhey', 0.26, 0.5, 0.52, { weight: 'bold', fill: '#2f9e44' }),
        T('كل عام وأنتم بخير', 'Changa', 0.085, 0.5, 0.74, { bg: GOLD, bgShape: 'banner' }),
      ],
    },
    {
      id: 'eid-en',
      name: { en: 'Eid Mubarak', ar: 'Eid Mubarak' },
      items: [
        S('crescent', 0.22, 0.5, 0.22, { fill: GOLD }),
        T('EID', 'Abril Fatface', 0.3, 0.5, 0.5, { fill: GOLD, spacing: 120 }),
        T('Mubarak', 'Dancing Script', 0.17, 0.5, 0.72, { weight: 'bold' }),
      ],
    },
    {
      id: 'wedding-ar',
      name: { en: 'Wedding names (Arabic)', ar: 'أسماء العروسين' },
      items: [
        S('heart', 0.16, 0.5, 0.5, { fill: '#e64980' }),
        T('أحمد', 'Aref Ruqaa', 0.2, 0.5, 0.3, { weight: 'bold' }),
        T('سارة', 'Aref Ruqaa', 0.2, 0.5, 0.7, { weight: 'bold' }),
        T('٢٠٢٦', 'Changa', 0.07, 0.5, 0.9, { fill: GOLD, weight: 'bold' }),
      ],
    },
    {
      id: 'wedding-en',
      name: { en: 'Mr & Mrs', ar: 'Mr & Mrs' },
      items: [
        T('Mr & Mrs', 'Dancing Script', 0.22, 0.5, 0.36, { weight: 'bold' }),
        S('line', 0.5, 0.5, 0.55, { fill: GOLD }),
        T('AHMED + SARA', 'Montserrat', 0.075, 0.5, 0.68, { weight: 'bold', spacing: 250 }),
        T('EST. 2026', 'Montserrat', 0.05, 0.5, 0.82, { fill: GOLD, spacing: 300 }),
      ],
    },
    {
      id: 'grad-ar',
      name: { en: 'Graduation (Arabic)', ar: 'مبروك التخرج' },
      items: [
        S('shield', 0.42, 0.5, 0.36, { fill: '#1c3faa' }),
        T('٢٠٢٦', 'Lalezar', 0.13, 0.5, 0.36, { fill: '#ffffff' }),
        T('مبروك التخرج', 'Lemonada', 0.14, 0.5, 0.74, { weight: 'bold' }),
        T('دفعة الأبطال', 'Tajawal', 0.07, 0.5, 0.88, { fill: ACCENT, weight: 'bold' }),
      ],
    },
    {
      id: 'grad-en',
      name: { en: 'Class of 2026', ar: 'Class of 2026' },
      items: [
        T('CLASS OF', 'Bungee', 0.11, 0.5, 0.3),
        T('2026', 'Bungee', 0.34, 0.5, 0.54, { fill: ACCENT, extrude: '#16181d' }),
        T('Graduate', 'Dancing Script', 0.14, 0.5, 0.8, { weight: 'bold' }),
      ],
    },
    {
      id: 'champions',
      name: { en: 'Champions', ar: 'الأبطال' },
      items: [
        S('shield', 0.5, 0.5, 0.38, { fill: ACCENT }),
        S('star', 0.12, 0.5, 0.3, { fill: '#ffffff' }),
        T('الأبطال', 'Kufam', 0.11, 0.5, 0.47, { fill: '#ffffff', weight: 'bold' }),
        T('CHAMPIONS', 'Anton', 0.13, 0.5, 0.82, { spacing: 100 }),
      ],
    },
    {
      id: 'gym',
      name: { en: 'No pain no gain', ar: 'No pain no gain' },
      items: [
        T('NO PAIN', 'Anton', 0.24, 0.5, 0.32, { spacing: 40 }),
        T('NO GAIN', 'Anton', 0.24, 0.5, 0.58, { fill: ACCENT, spacing: 40 }),
        S('line', 0.6, 0.5, 0.76, { fill: ACCENT }),
        T('TRAIN HARD', 'Montserrat', 0.06, 0.5, 0.86, { weight: 'bold', spacing: 400 }),
      ],
    },
    {
      id: 'brand-en',
      name: { en: 'Business logo', ar: 'شعار شركة (إنجليزي)' },
      items: [
        S('ring', 0.8, 0.5, 0.5, { stroke: true }),
        T('YOUR BRAND', 'Righteous', 0.11, 0.5, 0.44),
        T('EST. 2026', 'Montserrat', 0.055, 0.5, 0.6, { fill: ACCENT, weight: 'bold', spacing: 300 }),
      ],
    },
    {
      id: 'brand-ar',
      name: { en: 'Business logo (Arabic)', ar: 'شعار شركة' },
      items: [
        S('rounded', 0.62, 0.5, 0.4, { fill: ACCENT }),
        T('اسم شركتك', 'Changa', 0.13, 0.5, 0.4, { fill: '#ffffff', weight: 'bold' }),
        T('جودة وثقة منذ ٢٠٢٦', 'Tajawal', 0.07, 0.5, 0.76, { weight: 'bold' }),
      ],
    },
    {
      id: 'cafe',
      name: { en: 'Café sign', ar: 'لافتة مقهى' },
      items: [
        S('ribbon', 0.86, 0.5, 0.56, { fill: ACCENT }),
        T('قهوة', 'Lalezar', 0.24, 0.5, 0.3),
        T('COFFEE HOUSE', 'Righteous', 0.07, 0.5, 0.56, { fill: '#ffffff', spacing: 150 }),
        T('منذ ٢٠٢٦', 'Tajawal', 0.06, 0.5, 0.78, { weight: 'bold' }),
      ],
    },
    {
      id: 'dad',
      name: { en: 'Best Dad', ar: 'أحسن بابا' },
      items: [
        T('أحسن', 'Lemonada', 0.12, 0.5, 0.3, { weight: 'bold' }),
        T('بابا', 'Jomhuria', 0.5, 0.5, 0.56, { fill: ACCENT }),
        S('star', 0.1, 0.18, 0.2, { fill: GOLD, angle: -12 }),
        S('star', 0.08, 0.84, 0.74, { fill: GOLD, angle: 14 }),
      ],
    },
    {
      id: 'neon-vibes',
      name: { en: 'Good vibes (neon)', ar: 'Good vibes' },
      items: [
        T('good', 'Caveat', 0.2, 0.5, 0.34, { fill: '#ffd1ea', glow: '#ff2d95', weight: 'bold' }),
        T('vibes', 'Caveat', 0.3, 0.5, 0.58, { fill: '#c5f6fa', glow: '#22b8cf', weight: 'bold' }),
        T('ONLY', 'Bungee', 0.08, 0.5, 0.8, { fill: '#fff3bf', glow: '#fcc419' }),
      ],
    },
    {
      id: 'little-hero',
      name: { en: 'Little hero (kids)', ar: 'بطل صغير' },
      items: [
        S('burst', 0.66, 0.5, 0.44, { fill: '#fcc419' }),
        T('بطل', 'Lalezar', 0.24, 0.5, 0.4, { fill: '#e03131' }),
        T('صغير', 'Marhey', 0.12, 0.5, 0.82, { weight: 'bold', curve: -30 }),
      ],
    },
    // ---------- Business ----------
    {
      id: 'bizcard-ar',
      name: { en: 'Business card (Arabic)', ar: 'كارت شخصي' },
      items: [
        T('محمد أحمد', 'Cairo', 0.085, 0.5, 0.28, { weight: 'bold' }),
        T('مدير المبيعات', 'Tajawal', 0.05, 0.5, 0.42, { fill: ACCENT, weight: 'bold' }),
        S('line', 0.3, 0.5, 0.53, { fill: ACCENT }),
        T('0100 123 4567', 'Montserrat', 0.045, 0.5, 0.66),
        T('القاهرة، مصر', 'Tajawal', 0.045, 0.5, 0.79),
      ],
    },
    {
      id: 'bizcard-en',
      name: { en: 'Business card', ar: 'كارت شخصي (إنجليزي)' },
      items: [
        S('circle', 0.22, 0.2, 0.5, { fill: ACCENT }),
        T('A', 'Bebas Neue', 0.15, 0.2, 0.52, { fill: '#ffffff' }),
        T('Ahmed Hassan', 'Montserrat', 0.07, 0.64, 0.3, { weight: 'bold' }),
        T('Graphic Designer', 'Montserrat', 0.042, 0.64, 0.44, { fill: ACCENT }),
        T('0100 123 4567', 'Montserrat', 0.04, 0.64, 0.62),
        T('ahmed@company.com', 'Montserrat', 0.04, 0.64, 0.74),
      ],
    },
    {
      id: 'shop-logo',
      name: { en: 'Shop logo', ar: 'لوجو محل' },
      items: [
        S('circle', 0.94, 0.5, 0.5, { fill: ACCENT }),
        T('متجري', 'Lalezar', 0.22, 0.5, 0.44, { fill: '#ffffff' }),
        T('SINCE 2026', 'Montserrat', 0.06, 0.5, 0.66, { fill: '#ffffff', spacing: 200, weight: 'bold' }),
      ],
    },
    {
      id: 'sale-flyer',
      name: { en: 'Sale flyer', ar: 'فلاير عروض' },
      items: [
        T('عرض خاص', 'Lalezar', 0.2, 0.5, 0.16, { fill: ACCENT }),
        T('50%', 'Anton', 0.42, 0.5, 0.42),
        T('خصم على كل المنتجات', 'Cairo', 0.085, 0.5, 0.64, { weight: 'bold' }),
        S('line', 0.5, 0.5, 0.74, { fill: ACCENT }),
        T('لفترة محدودة · 0100 123 4567', 'Tajawal', 0.055, 0.5, 0.84, { weight: 'bold' }),
      ],
    },
    {
      id: 'letterhead',
      name: { en: 'Letterhead', ar: 'ورق مراسلات' },
      items: [
        T('اسم الشركة', 'Cairo', 0.07, 0.5, 0.06, { weight: 'bold' }),
        T('COMPANY NAME', 'Montserrat', 0.035, 0.5, 0.1, { fill: ACCENT, spacing: 300, weight: 'bold' }),
        S('line', 0.9, 0.5, 0.13, { fill: ACCENT }),
        S('line', 0.9, 0.5, 0.93, { fill: ACCENT }),
        T('القاهرة، مصر · 0100 123 4567 · info@company.com', 'Tajawal', 0.028, 0.5, 0.96),
      ],
    },
    {
      id: 'staff-id',
      name: { en: 'Staff ID', ar: 'كارنيه موظف' },
      items: [
        T('COMPANY', 'Bebas Neue', 0.17, 0.5, 0.12, { fill: ACCENT, spacing: 100 }),
        S('circle', 0.46, 0.5, 0.4, { fill: '#d9dde3' }),
        T('أحمد حسن', 'Cairo', 0.11, 0.5, 0.68, { weight: 'bold' }),
        T('قسم المبيعات', 'Tajawal', 0.075, 0.5, 0.79, { fill: ACCENT, weight: 'bold' }),
        T('ID 1024', 'Montserrat', 0.06, 0.5, 0.9),
      ],
    },
  ];

  /**
   * Build fabric objects for a template in the given print area.
   * `ink` is the main text colour that reads well on the product.
   */
  async function buildTemplate(tpl, area, ink) {
    await Promise.all(tpl.items.filter((i) => i.kind === 'text').map((i) => ensureFont(i.font, i.weight || 'normal', 'normal')));
    // Stickers load from SVG, so build them first.
    const SK = window.POD_STICKERS;
    const stickerObjs = await Promise.all(tpl.items.map((i) => {
      if (i.kind !== 'sticker' || !SK) return null;
      const def = SK.STICKERS.find((x) => x.id === i.sticker);
      return def ? SK.makeSticker(def) : null;
    }));
    const objs = tpl.items.map((i, idx) => {
      let o;
      if (i.kind === 'sticker') {
        o = stickerObjs[idx];
        if (!o) return null;
        o.scaleToWidth(area.w * i.w);
        o.set({ angle: i.angle || 0 });
      } else if (i.kind === 'text') {
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
          backgroundColor: i.bg || '',
          bgShape: i.bgShape || 'box',
          curve: i.curve || 0,
        });
        const fs = o.fontSize;
        if (i.glow) o.set({ shadow: new fabric.Shadow({ color: i.glow, blur: fs * 0.42, offsetX: 0, offsetY: 0 }), textFx: 'neon' });
        if (i.shadow) o.set({ shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.38)', blur: fs * 0.14, offsetX: fs * 0.06, offsetY: fs * 0.06 }), textFx: 'shadow' });
        if (i.extrude) o.set({ shadow: new fabric.Shadow({ color: i.extrude, blur: 0, offsetX: fs * 0.07, offsetY: fs * 0.07 }), textFx: 'extrude' });
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
    }).filter(Boolean);
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
  async function templateThumb(tpl, bg = '#ffffff') {
    const key = tpl.id + '|' + bg;
    if (thumbCache.has(key)) return thumbCache.get(key);
    const size = 160;
    const dark = (() => { const n = parseInt(bg.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.45; })();
    const sc = new fabric.StaticCanvas(null, { width: size, height: size, backgroundColor: bg, renderOnAddRemove: false });
    const objs = await buildTemplate(tpl, { x: 12, y: 12, w: size - 24, h: size - 24 }, dark ? '#ffffff' : '#16181d');
    objs.forEach((o) => sc.add(o));
    sc.renderAll();
    const url = sc.toDataURL({ format: 'png' });
    sc.dispose();
    thumbCache.set(key, url);
    return url;
  }

  window.POD_DESIGN = { FONTS, BUNDLED, ARABIC_RE, ACCENT, SHAPES, TEXT_PRESETS, TEMPLATES, ensureFont, ensureFontsFor, buildTemplate, templateThumb };
})();
