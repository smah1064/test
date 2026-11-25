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
  // Library icons and stickers named in templates ({ kind: 'art', art: 'set:name' }), fetched once.
  const artCache = new Map();
  function loadArt(id) {
    if (!artCache.has(id)) {
      artCache.set(id, fetch('/api/assets/icon/' + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    }
    return artCache.get(id);
  }
  async function makeArt(i, ink) {
    const it = await loadArt(i.art);
    if (!it) return null;
    // One-colour icons take the template's colour (or the ink); stickers keep their own colours.
    const body = it.kind === 'icon' ? it.body.replace(/currentColor/g, i.fill || ink) : it.body;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${it.w} ${it.h}" width="${it.w * 8}" height="${it.h * 8}">${body}</svg>`;
    const o = await new Promise((resolve) => fabric.loadSVGFromString(svg, (objects, options) => resolve(objects && objects.length ? fabric.util.groupSVGElements(objects, options) : null)));
    if (o) o.set({ name: (it.kind === 'icon' ? 'icon:' : 'sticker:') + i.art.split(':')[1] });
    return o;
  }
  /**
   * Artwork from the shop's own files (public/img/art): vector art (.svg) becomes editable
   * shapes, so it prints sharp at any size; pictures (.png/.webp) a photo layer.
   */
  const fileArt = new Map();
  /** The full-size original of an uploaded design (or of its copy without the words), used by print files. */
  const PRINT_SRC = /^\/library-art\/[0-9a-z-]{4,40}\/(?:nowords-)?print\.(png|jpg)$/;
  async function makeImage(i, ink) {
    // A white copy of one-colour artwork (`dark`) for dark product colours (light ink).
    const light = i.dark && /^#[0-9a-f]{6}$/i.test(ink || '') && parseInt(ink.slice(1, 3), 16) + parseInt(ink.slice(3, 5), 16) + parseInt(ink.slice(5, 7), 16) > 384;
    const src = String((light ? i.dark : i.src) || '');
    // The shop's own artwork files, and designs uploaded in the admin (published, or still being reviewed).
    const uploaded = /^\/library-(?:art\/[0-9a-z-]{4,40}\/(?:nowords-)?web|upload\/[0-9a-f]{16,40}\/[0-9a-f]{8,40})\.png$/.test(src);
    if (!uploaded && !/^\/img\/art\/[\w/-]+\.(svg|png|webp|jpg)$/.test(src)) return null;
    if (/\.svg$/.test(src)) {
      if (!fileArt.has(src)) fileArt.set(src, fetch(src).then((r) => (r.ok ? r.text() : null)).catch(() => null));
      const text = await fileArt.get(src);
      if (!text) return null;
      const o = await new Promise((resolve) => fabric.loadSVGFromString(text, (objects, options) => resolve(objects && objects.length ? fabric.util.groupSVGElements(objects, options) : null)));
      if (o) o.set({ name: 'art:' + src.split('/').pop().replace(/\.svg$/, '') });
      return o;
    }
    return new Promise((resolve) => fabric.Image.fromURL(src, (img, failed) => {
      if (failed || !img) return resolve(null);
      img.set({ name: uploaded ? (i.name || 'Design') : 'art:' + src.split('/').pop().replace(/\.\w+$/, '') });
      // An uploaded design shows a light copy; its print files use the full-size original (see POD_PRINTSRC).
      if (uploaded && PRINT_SRC.test(String(i.printSrc || ''))) img.set({ printSrc: i.printSrc, printPx: Array.isArray(i.printPx) ? i.printPx.slice(0, 2).map(Number) : null });
      resolve(img);
    }));
  }
  /**
   * Words drawn in a picture, as live text. A picture (`kind: 'image'`) may carry `words`:
   *   { src, dark?, printSrc?, printPx?, texts: [{ text, font, size, x, y, w?, weight?, fill?, curve?, angle?, spacing?, lineHeight? }] }
   * `src` (and `dark`, the white copy for dark colours; `printSrc`, an uploaded design's full-size original) is
   * the same picture without its words, the same size and shape, so it lines up with the original. Each text is
   * placed on that picture: x, y its centre as fractions of the picture's width and height; size the font size
   * and w the width of the line, as fractions of the picture's width (w: the line is set to exactly that width,
   * as the words were drawn). A text without `fill` takes the ink, like the rest of the design.
   * The words then are ordinary text in the editor (tap, double-tap to type), and the picture its own layer.
   */
  function wordsArt(i) {
    const w = i && i.words;
    if (!w || typeof w.src !== 'string' || !Array.isArray(w.texts) || !w.texts.length) return null;
    return { ...i, src: w.src, dark: w.dark || (i.dark === i.src ? w.src : w.dark), printSrc: w.printSrc, printPx: w.printPx, words: undefined };
  }
  /**
   * The text objects of `words` on a picture drawn in `box` ({ cx, cy, w, h, angle?, flipX?, flipY? }: its centre,
   * drawn size and turn on the canvas).
   */
  function wordsTexts(words, box, ink) {
    const rad = ((box.angle || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return (words.texts || []).filter((t) => t && typeof t.text === 'string' && t.text.trim()).map((t) => {
      const text = t.text.slice(0, 500);
      const arabic = ARABIC_RE.test(text);
      const o = new fabric.IText(text, {
        name: 'Text',
        fontFamily: BUNDLED.has(t.font) ? t.font : 'Montserrat',
        fontSize: Math.max(4, Math.round(box.w * (Number(t.size) || 0.08))),
        fontWeight: t.weight || 'normal',
        fill: t.fill || ink,
        textAlign: 'center',
        lineHeight: Number(t.lineHeight) || 1.16,
        charSpacing: arabic ? 0 : Number(t.spacing) || 0,
        direction: arabic ? 'rtl' : 'ltr',
        curve: Math.max(-100, Math.min(100, Number(t.curve) || 0)),
        originX: 'center',
        originY: 'center',
      });
      if (t.w > 0 && !o.curve) o.scaleToWidth(box.w * t.w);
      let dx = ((Number.isFinite(+t.x) ? +t.x : 0.5) - 0.5) * box.w;
      let dy = ((Number.isFinite(+t.y) ? +t.y : 0.5) - 0.5) * box.h;
      if (box.flipX) dx = -dx;
      if (box.flipY) dy = -dy;
      o.set({ left: box.cx + dx * cos - dy * sin, top: box.cy + dx * sin + dy * cos, angle: (box.angle || 0) + (Number(t.angle) || 0) });
      o.setCoords();
      return o;
    });
  }
  /** Make sure the fonts of a picture's words are loaded before they are measured. */
  function ensureWordsFonts(words) {
    return Promise.all(((words && words.texts) || []).map((t) => ensureFont(t.font, t.weight || 'normal', 'normal')));
  }

  /**
   * The part of a print area a layout goes in: printArea.readyZone (fractions of the
   * area) where the product has one: the wall calendar's top half above the month
   * pad, a folder's front half, a brochure's cover panel. readyZoneRtl is used for
   * layouts led by Arabic text (Arabic folders and brochures open the other way).
   */
  function readyArea(area, tpl) {
    if (!area || !area.readyZone) return area;
    // (The biggest text with letters leads: a year or a number says nothing about the language.)
    const texts = ((tpl && tpl.items) || []).filter((i) => i.kind === 'text' && (/[A-Za-z]/.test(i.text || '') || ARABIC_RE.test(i.text || '')));
    const lead = texts.reduce((best, i) => (!best || (i.size || 0) > (best.size || 0) ? i : best), null);
    const z = area.readyZoneRtl && lead && ARABIC_RE.test(lead.text) ? area.readyZoneRtl : area.readyZone;
    return { x: area.x + area.w * z.x, y: area.y + area.h * z.y, w: area.w * z.w, h: area.h * z.h };
  }
  /**
   * How wide a one-line text is drawn. Arabic: the browser's own width, its letters joined (Fabric adds up each
   * letter alone, some 10% short in a joined script like Aref Ruqaa, so a long name fitted by it ran over the edge).
   */
  let measurer = null;
  function drawnWidth(o) {
    const w = o.getScaledWidth();
    if (!ARABIC_RE.test(o.text || '') || /\n/.test(o.text) || o.charSpacing || !o.width || !o._getFontDeclaration) return w;
    measurer ||= document.createElement('canvas').getContext('2d');
    measurer.font = o._getFontDeclaration();
    measurer.direction = o.direction === 'rtl' ? 'rtl' : 'ltr';
    const shaped = measurer.measureText(o.text).width;
    return shaped > o.width ? (w * shaped) / o.width : w;
  }
  /**
   * The customer's own name in place of a sample one (withNames, `fitTo`: the sample): never wider than the sample
   * was, so what is round it stays as drawn; with nothing beside it on its line, as wide as the line's free room
   * inside the margin. A longer name is set smaller (`nameScale` on the object), a shorter one keeps the sample's size.
   */
  function fitName(o, i, built, area, box) {
    if (!o || !i || i.kind !== 'text' || !i.fitTo || typeof i.fitTo.text !== 'string') return;
    const was = new fabric.IText(i.bg ? i.fitTo.text.trim() : i.fitTo.text, {
      fontFamily: i.fitTo.font || i.font,
      fontSize: o.fontSize,
      fontWeight: i.fitTo.weight || 'normal',
      strokeWidth: o.strokeWidth,
      charSpacing: ARABIC_RE.test(i.fitTo.text) ? 0 : i.spacing || 0,
      direction: ARABIC_RE.test(i.fitTo.text) ? 'rtl' : 'ltr',
    });
    const wasW = Math.min(drawnWidth(was), area.w * 0.94);
    const r = o.getBoundingRect(true, true);
    const edge = r.height * 0.15;
    const beside = built.some((x) => {
      if (!x || x === o) return false;
      const q = x.getBoundingRect(true, true);
      return q.top < r.top + r.height - edge && q.top + q.height > r.top + edge;
    });
    const room = 2 * Math.min(o.left - box.x, box.x + box.w - o.left);
    const most = beside ? wasW : Math.max(wasW, room);
    const now = drawnWidth(o);
    if (now > most) {
      o.nameScale = most / now; // (how much smaller than the sample's size: the design page says so)
      o.scaleToWidth((o.getBoundingRect(true, true).width * most) / now);
      o.setCoords();
    }
  }
  async function buildTemplate(tpl, fullArea, ink, { inset = 0, words: liveWords = true } = {}) {
    // Pictures with their words as live text (see wordsArt): the picture without the words, then the words.
    if (liveWords && tpl.items.some((i) => i.kind === 'image' && wordsArt(i))) {
      tpl = { ...tpl, items: tpl.items.map((i) => (i.kind === 'image' && wordsArt(i)) || i), wordsOf: tpl.items.map((i) => (i.kind === 'image' && wordsArt(i) ? i.words : null)) };
      await Promise.all(tpl.wordsOf.filter(Boolean).map(ensureWordsFonts));
    }
    const area = readyArea(fullArea, tpl);
    // A layout drawn for a box of a given shape (tpl.aspect = width / height,
    // e.g. 0.75 for the ready designs, made on a T-shirt): on wider, shorter
    // boxes (mugs, envelopes, banners) sizes follow the height instead, so
    // lines placed by height don't run into each other.
    const U = tpl.aspect ? Math.min(area.w, area.h * tpl.aspect) : area.w;
    await Promise.all(tpl.items.filter((i) => i.kind === 'text').flatMap((i) => [ensureFont(i.font, i.weight || 'normal', 'normal'), ...(i.fitTo ? [ensureFont(i.fitTo.font, i.fitTo.weight || 'normal', 'normal')] : [])]));
    // Stickers load from SVG, so build them first.
    const SK = window.POD_STICKERS;
    const stickerObjs = await Promise.all(tpl.items.map((i) => {
      if (i.kind === 'art') return makeArt(i, ink);
      if (i.kind === 'image') return makeImage(i, ink);
      if (i.kind !== 'sticker' || !SK) return null;
      const def = SK.STICKERS.find((x) => x.id === i.sticker);
      return def ? SK.makeSticker(def) : null;
    }));
    const built = tpl.items.map((i, idx) => {
      let o;
      if (i.kind === 'sticker' || i.kind === 'art' || i.kind === 'image') {
        o = stickerObjs[idx];
        if (!o) return null;
        if (i.full) {
          // A picture made edge to edge (a mouse pad print): covers the whole area, no margin.
          o.scale(Math.max(area.w / o.width, area.h / o.height));
        } else if (i.fit) {
          // A whole picture (uploaded designs): as big as fits in the area, both ways.
          o.scale(Math.min((area.w * i.fit) / o.width, (area.h * i.fit) / o.height));
        } else {
          o.scaleToWidth(U * i.w);
          if (i.h && o.getScaledHeight() > U * i.h) o.scaleToHeight(U * i.h);
        }
        o.set({ angle: i.angle || 0, opacity: i.opacity ?? 1 });
      } else if (i.kind === 'text') {
        const fill = i.fill || ink;
        // (Spaces once used to keep text clear of a ribbon's cut ends are not needed any more.)
        o = new fabric.IText(i.bg ? String(i.text).trim() : i.text, {
          name: 'Text',
          fontFamily: i.font,
          fontSize: Math.round(U * i.size),
          fontWeight: i.weight || 'normal',
          fill,
          stroke: i.outline ? ink : null,
          strokeWidth: i.outline ? Math.max(1.5, U * 0.008) : 0,
          paintFirst: 'stroke',
          textAlign: 'center',
          charSpacing: ARABIC_RE.test(i.text) ? 0 : i.spacing || 0,
          direction: i.direction || (ARABIC_RE.test(i.text) ? 'rtl' : 'ltr'),
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
        o.scaleToWidth(U * i.w);
      }
      o.set({ originX: 'center', originY: 'center', left: area.x + area.w * i.x, top: area.y + area.h * i.y });
      o.setCoords();
      return o;
    });
    const pad = Math.max(inset, Math.min(area.w, area.h) * 0.08);
    const box = { x: area.x + pad, y: area.y + pad, w: area.w - 2 * pad, h: area.h - 2 * pad };
    built.forEach((o, idx) => fitName(o, tpl.items[idx], built, area, box));
    const objs = built.filter(Boolean);
    // The words of pictures, on top, where they were drawn.
    (tpl.wordsOf || []).forEach((words, idx) => {
      const o = built[idx];
      if (!words || !o) return;
      objs.push(...wordsTexts(words, { cx: o.left, cy: o.top, w: o.getScaledWidth(), h: o.getScaledHeight(), angle: o.angle || 0 }, ink));
    });
    // Keep everything well inside the edges: a margin of 8% of the area's short side (at least
    // the product's safe zone, `inset`) all round. Too big: shrunk round the middle; then
    // moved in if a part still sits in the margin.
    // (A design with an edge-to-edge picture keeps no margin.)
    if (tpl.items.some((i) => i.full && i.kind === 'image')) return objs;
    const bounds = () => {
      const rs = objs.map((o) => o.getBoundingRect(true, true));
      return { x0: Math.min(...rs.map((r) => r.left)), y0: Math.min(...rs.map((r) => r.top)), x1: Math.max(...rs.map((r) => r.left + r.width)), y1: Math.max(...rs.map((r) => r.top + r.height)) };
    };
    if (!objs.length) return objs;
    let b = bounds();
    const s = Math.min(1, box.h / (b.y1 - b.y0), box.w / (b.x1 - b.x0));
    if (s < 1) {
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      objs.forEach((o) => {
        o.set({ left: cx + (o.left - cx) * s, top: cy + (o.top - cy) * s, scaleX: o.scaleX * s, scaleY: o.scaleY * s });
        o.setCoords();
      });
      b = bounds();
    }
    const dx = b.x0 < box.x ? box.x - b.x0 : b.x1 > box.x + box.w ? box.x + box.w - b.x1 : 0;
    const dy = b.y0 < box.y ? box.y - b.y0 : b.y1 > box.y + box.h ? box.y + box.h - b.y1 : 0;
    if (dx || dy) objs.forEach((o) => { o.set({ left: o.left + dx, top: o.top + dy }); o.setCoords(); });
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

  /**
   * Before print files are made: pictures of uploaded designs (`printSrc`) swap their light screen copy for
   * the full-size original, at the same size on the canvas, so the print gets every pixel. Done once per
   * picture (their element stays the original afterwards).
   */
  const originals = new Map();
  async function usePrintSources(canvas) {
    const pics = [];
    const walk = (list) => list.forEach((o) => { if (o.type === 'group' && o._objects) walk(o._objects); else if (o.type === 'image' && o.printSrc && !o.printSwapped) pics.push(o); });
    walk(canvas.getObjects());
    await Promise.all(pics.map(async (o) => {
      if (!PRINT_SRC.test(String(o.printSrc))) return;
      if (!originals.has(o.printSrc)) {
        originals.set(o.printSrc, new Promise((resolve) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => resolve(null);
          im.src = o.printSrc;
        }));
      }
      const im = await originals.get(o.printSrc);
      if (!im || !im.naturalWidth) return;
      const shownW = o.width * o.scaleX;
      const shownH = o.height * o.scaleY;
      o.setElement(im);
      o.set({ scaleX: shownW / im.naturalWidth, scaleY: shownH / im.naturalHeight, printSwapped: true });
      o.setCoords();
    }));
  }

  /**
   * The SVG print file names the site's own design pictures by address (/library-art/…: uploaded ready
   * designs), and the server keeps only embedded pictures in an SVG: embed them so the file shows them.
   * A very big original goes in as the lighter web picture (the PNG print file always uses the original).
   */
  const EMBED_MAX = 12 * 2 ** 20;
  const embedded = new Map();
  const OWN_PIC = /^\/library-art\/[0-9a-z-]{4,40}\/(?:nowords-)?(?:print\.(?:png|jpg)|web\.png)$/;
  async function picDataUrl(p) {
    try {
      let blob = await (await fetch(p)).blob();
      if (blob.size > EMBED_MAX && /print\.(png|jpg)$/.test(p)) blob = await (await fetch(p.replace(/print\.(png|jpg)$/, 'web.png'))).blob();
      if (!/^image\/(png|jpeg)$/.test(blob.type)) return null;
      return await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }
  async function inlineSvgImages(svg) {
    const found = new Map();
    for (const m of svg.matchAll(/href="([^"]+)"/g)) {
      const p = m[1].startsWith(location.origin + '/') ? m[1].slice(location.origin.length) : m[1];
      if (OWN_PIC.test(p)) found.set(m[1], p);
    }
    for (const [url, p] of found) {
      if (!embedded.has(p)) embedded.set(p, picDataUrl(p));
      const data = await embedded.get(p);
      if (data) svg = svg.split(`"${url}"`).join(`"${data}"`);
    }
    return svg;
  }

  // ---------- The customer's own name in a ready design ----------
  // Some ready designs show a sample name for the customer to replace ("LAILA", "آدم", "The MAHMOUDS"). Its
  // text item has `sampleName`, the kind of name (one of NAME_ROLES), and `samplePart` when only part of the
  // text is the name ('محمود' in 'عائلة محمود'). The design page (public/js/design.js) asks for the customer's
  // own, and withNames puts it in: the preview, the cart and the print files are all made from that design.
  const NAME_ROLES = ['name', 'his', 'her', 'names', 'family', 'initial', 'initials', 'hisInitial', 'herInitial', 'kid', 'baby', 'cat', 'dog', 'teacher', 'honoree'];
  // Letters; others NAME_LEN (a four-part Egyptian name, "عبد الرحمن محمد عبد الفتاح الشربيني", fits; fitName sets it smaller).
  const NAME_MAX = { initial: 3, hisInitial: 3, herInitial: 3, initials: 9, names: 60 };
  const NAME_LEN = 45;
  /** A ready design's sample names, in order: { index (of its item), role, sample, caps (printed in capitals), max (letters) }. */
  function sampleNames(design) {
    const items = design && design.kind === 'template' && Array.isArray(design.items) ? design.items : [];
    const out = [];
    items.forEach((it, index) => {
      if (!it || it.kind !== 'text' || !it.sampleName || typeof it.text !== 'string' || !it.text.trim()) return;
      const part = typeof it.samplePart === 'string' && it.samplePart.trim() && it.text.includes(it.samplePart) ? it.samplePart : null;
      const sample = (part || it.text).trim();
      const role = NAME_ROLES.includes(it.sampleName) ? it.sampleName : 'name';
      out.push({ index, role, sample, caps: /[A-Z]/.test(sample) && !/[a-z]/.test(sample), max: Math.max(NAME_MAX[role] || NAME_LEN, sample.length) });
    });
    return out;
  }
  /**
   * A typed name made printable: one line, at most `max` letters, without {…} (a place still to fill in, which the
   * server refuses to print), emoji or invisible direction marks (the fonts have none of them).
   * Too long: whole words only, never a word cut short ("…الشربي" for "…الشربيني" is another name); one long word is
   * cut at `max`.
   */
  function cleanName(v, max = NAME_LEN) {
    const s = String(v == null ? '' : v)
      .replace(/[\p{Extended_Pictographic}‍️‪-‮⁦-⁩]/gu, '')
      .replace(/[\u0000-\u001f\u007f-\u009f{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const letters = Array.from(s);
    if (letters.length <= max) return s;
    const kept = letters.slice(0, max);
    const space = kept.lastIndexOf(' ');
    return (letters[max] !== ' ' && space > 0 ? kept.slice(0, space) : kept).join('').trim();
  }
  // The English-only fonts have no Arabic letters: an Arabic name typed over an English sample is set in an
  // Arabic font of the same feel (the editor does the same, with Cairo).
  const ARABIC_FOR = {
    'Dancing Script': 'Aref Ruqaa', Pacifico: 'Aref Ruqaa', Lobster: 'Aref Ruqaa', Caveat: 'Aref Ruqaa',
    'Playfair Display': 'El Messiri', 'Abril Fatface': 'El Messiri', 'Roboto Slab': 'El Messiri',
    Anton: 'Lalezar', Bungee: 'Lalezar', 'Bebas Neue': 'Lalezar', Oswald: 'Lalezar', Righteous: 'Lalezar', 'Permanent Marker': 'Lalezar',
    Montserrat: 'Cairo',
  };
  /** Right to left when the first letter is Arabic (as the editor's text box shows it): "Omar & عمر" stays left to right. */
  function textDirection(s) {
    const first = /[A-Za-zÀ-ɏ֐-ࣿיִ-﷿ﹰ-ﻼ]/.exec(s || '');
    return first && /[֐-ࣿיִ-﷿ﹰ-ﻼ]/.test(first[0]) ? 'rtl' : 'ltr';
  }
  /**
   * The design with the customer's own names: `values` in the order of sampleNames (empty keeps the sample).
   * A changed text remembers the sample it replaces (`fitTo`), so buildTemplate fits the name in its place.
   */
  function withNames(design, values) {
    const list = sampleNames(design);
    if (!list.length || !values) return design;
    const items = design.items.slice();
    let changed = false;
    list.forEach((s, k) => {
      let name = cleanName(values[k], s.max);
      if (!name) return;
      changed = true;
      if (s.caps) name = name.toUpperCase();
      const it = items[s.index];
      const part = typeof it.samplePart === 'string' && it.samplePart.trim() && it.text.includes(it.samplePart) ? it.samplePart : null;
      const text = part ? it.text.replace(part, () => name) : name;
      const next = { ...it, text, direction: textDirection(text), fitTo: { text: it.text, font: it.font, weight: it.weight || 'normal' } };
      if (ARABIC_RE.test(text) && FONTS.english.includes(it.font)) {
        next.font = ARABIC_FOR[it.font] || 'Cairo';
        next.weight = next.font === 'Lalezar' ? 'normal' : next.font === 'Aref Ruqaa' ? 'bold' : it.weight || 'normal';
      }
      items[s.index] = next;
    });
    return changed ? { ...design, items } : design;
  }

  window.POD_DESIGN = { FONTS, BUNDLED, ARABIC_RE, ACCENT, SHAPES, TEXT_PRESETS, TEMPLATES, ensureFont, ensureFontsFor, buildTemplate, readyArea, templateThumb, usePrintSources, inlineSvgImages, NAME_ROLES, sampleNames, cleanName, withNames, wordsTexts, ensureWordsFonts };
})();
