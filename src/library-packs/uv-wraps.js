'use strict';

// UV DTF cup wraps (owner, 28 Nov 2026): ready designs for the band that goes round a glass, offered only on the
// four wrap products (`products`, like the CNC / UV pack). Drawn on the 20 oz glass can's wrap (about 23 × 13 cm,
// so the width is about 1.77 × the height); on the 16 oz can, the tumbler and the tapered glass they keep their
// size by the height and sit in the middle (src/library.js fitsShape: all within its limits). The middle of the
// band (x = 0.5) is the front of the glass; the 5 mm seam is at both ends, so nothing important sits at the edges.
// The film has no background: every design is its own colours on clear, readable on a clear glass.
// Names are samples the customer replaces (sampleName: the design page asks for them).
const { T, S, A, D, GOLD, PINK, GREEN } = require('../library-dsl');

const WRAPS = ['uvwrap16', 'uvwrap20', 'uvwraptumbler', 'uvwraptaper'];
const ASPECT = 400 / 225.5; // the 20 oz glass can's wrap (src/products.js)
const COFFEE = '#6f4e37';
const CREAM = '#c8a27a';
const NAVY = '#1b2a4a';
const ROSE = '#c2255c';
const SAGE = '#5c7f67';

const categories = [];

/** A wrap design (shown on the 20 oz glass can's wrap, offered on all four wraps). */
const wrap = (id, category, en, ar, items) => D(id, category, en, ar, items, 'clear', { product: 'uvwrap20', aspect: ASPECT, products: WRAPS.slice() });

const designs = [
  wrap('uvwrap-name-floral-ar', 'love', 'Glass wrap: name with flowers (Arabic)', 'ستيكر كوباية: اسم بالورد', [
    A('fluent-emoji-flat:cherry-blossom', 0.09, 0.2, 0.3),
    A('fluent-emoji-flat:tulip', 0.08, 0.26, 0.7),
    A('fluent-emoji-flat:rose', 0.08, 0.74, 0.3),
    A('fluent-emoji-flat:blossom', 0.09, 0.8, 0.7),
    T('مريم', 'Aref Ruqaa', 0.14, 0.5, 0.45, { fill: ROSE, weight: 'bold', sampleName: 'name' }),
    A('fluent-emoji-flat:herb', 0.06, 0.5, 0.78),
  ]),
  wrap('uvwrap-name-floral-en', 'love', 'Glass wrap: name with wildflowers', 'ستيكر كوباية: اسم بالإنجليزي وورد', [
    A('fluent-emoji-flat:sunflower', 0.09, 0.18, 0.5),
    A('fluent-emoji-flat:hibiscus', 0.08, 0.3, 0.25),
    A('fluent-emoji-flat:tulip', 0.08, 0.7, 0.75),
    A('fluent-emoji-flat:cherry-blossom', 0.09, 0.82, 0.5),
    T('Sarah', 'Great Vibes', 0.13, 0.5, 0.45, { fill: SAGE, sampleName: 'name' }),
  ]),
  wrap('uvwrap-coffee-first-ar', 'quotes', 'Glass wrap: قهوتي الأول', 'ستيكر كوباية: قهوتي الأول', [
    A('fluent-emoji-flat:hot-beverage', 0.1, 0.5, 0.25),
    T('قهوتي الأول', 'Lalezar', 0.1, 0.5, 0.58, { fill: COFFEE }),
    S('circle', 0.025, 0.2, 0.3, { fill: CREAM }),
    S('circle', 0.03, 0.8, 0.7, { fill: CREAM }),
    T('وبعدين نتكلم', 'Tajawal', 0.045, 0.5, 0.82, { fill: CREAM, weight: 'bold' }),
  ]),
  wrap('uvwrap-coffee-first-en', 'quotes', 'Glass wrap: But first, coffee', 'ستيكر كوباية: But first, coffee', [
    T('But first,', 'Dancing Script', 0.07, 0.5, 0.3, { fill: CREAM }),
    T('COFFEE', 'Bebas Neue', 0.15, 0.5, 0.6, { fill: COFFEE }),
    A('fluent-emoji-flat:hot-beverage', 0.07, 0.18, 0.55),
    A('fluent-emoji-flat:croissant', 0.07, 0.82, 0.55),
  ]),
  wrap('uvwrap-ramadan', 'ramadan', 'Glass wrap: Ramadan Kareem', 'ستيكر كوباية: رمضان كريم', [
    A('fluent-emoji-flat:crescent-moon', 0.08, 0.2, 0.32),
    A('fluent-emoji-flat:star', 0.04, 0.27, 0.62),
    T('رمضان كريم', 'Aref Ruqaa', 0.12, 0.5, 0.45, { fill: GOLD, weight: 'bold' }),
    A('fluent-emoji-flat:glowing-star', 0.05, 0.75, 0.3),
    A('fluent-emoji-flat:crescent-moon', 0.06, 0.82, 0.62),
    T('Ramadan Kareem', 'Playfair Display', 0.04, 0.5, 0.8, { fill: NAVY }),
  ]),
  wrap('uvwrap-birthday', 'birthday', 'Glass wrap: birthday with name and age', 'ستيكر كوباية: عيد ميلاد بالاسم والسن', [
    A('fluent-emoji-flat:balloon', 0.08, 0.18, 0.4),
    A('fluent-emoji-flat:party-popper', 0.08, 0.82, 0.4),
    T('Happy Birthday', 'Pacifico', 0.075, 0.5, 0.3, { fill: PINK }),
    T('Omar', 'Lilita One', 0.1, 0.5, 0.6, { fill: '#1c7ed6', sampleName: 'name' }),
    T('7', 'Bungee', 0.06, 0.5, 0.85, { fill: GOLD, sampleName: 'age' }),
  ]),
  wrap('uvwrap-birthday-ar', 'birthday', 'Glass wrap: كل سنة وانت طيب', 'ستيكر كوباية: كل سنة وانت طيب', [
    A('fluent-emoji-flat:birthday-cake', 0.09, 0.5, 0.22),
    T('كل سنة وانت طيب', 'Lalezar', 0.08, 0.5, 0.52, { fill: PINK }),
    T('يا يوسف', 'Lemonada', 0.06, 0.5, 0.78, { fill: GREEN, weight: 'bold', sampleName: 'name', samplePart: 'يوسف' }),
    A('fluent-emoji-flat:wrapped-gift', 0.07, 0.17, 0.6),
    A('fluent-emoji-flat:sparkles', 0.07, 0.83, 0.6),
  ]),
  wrap('uvwrap-monogram', 'minimal', 'Glass wrap: monogram', 'ستيكر كوباية: مونوجرام بالحرف', [
    S('ring', 0.2, 0.5, 0.45, { fill: GOLD }),
    T('M', 'Playfair Display', 0.15, 0.5, 0.45, { fill: NAVY, sampleName: 'initial' }),
    T('MARIAM', 'Montserrat', 0.04, 0.5, 0.88, { fill: NAVY, weight: 'bold', spacing: 400, sampleName: 'name' }),
  ]),
];

module.exports = { categories, designs, WRAPS, ASPECT };
