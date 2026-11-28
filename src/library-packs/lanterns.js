'use strict';

// The Ramadan lanterns (owner's request, 28 Nov 2026; drafts until priced): ready names for the engraved plaques,
// offered only on their own lantern (`products`). Everything is one engraved tone (no colours). The crescent and
// star (Family Fanous) and the two small ornaments (Arabesque Arch) are part of the lantern, so the designs hold
// only the name. Names are samples the customer replaces (sampleName).
//   Family Fanous: the family name on one or two lines (preview example «عائلة حسن»).
//   Arabesque Arch: one first name, kept compact so the arabesque shows round the plaque (example «لارا»).
const { T, D } = require('../library-dsl');

const categories = [];
const forProduct = (product, aspect) => (id, category, en, ar, items) => D(id, category, en, ar, items, 'wood', { product, aspect, products: [product] });
// Print areas (src/products.js): width / height.
const fanous = forProduct('familyfanous', 110 / 76);
const arch = forProduct('arabesquelantern', 84 / 25);

const designs = [
  // ---------- Family Fanous: the family name under the crescent and star ----------
  fanous('lan-fanous-family-ar', 'ramadan', 'Family Fanous: عائلة حسن on two lines', 'فانوس العيلة: عائلة حسن على سطرين', [
    T('عائلة', 'El Messiri', 0.2, 0.5, 0.28, { weight: 'bold' }),
    T('حسن', 'Aref Ruqaa', 0.3, 0.5, 0.68, { weight: 'bold', sampleName: 'family' }),
  ]),
  fanous('lan-fanous-family-ar-line', 'ramadan', 'Family Fanous: عائلة حسن on one line', 'فانوس العيلة: عائلة حسن على سطر واحد', [
    T('عائلة حسن', 'Aref Ruqaa', 0.2, 0.5, 0.5, { weight: 'bold', sampleName: 'family', samplePart: 'حسن' }),
  ]),
  fanous('lan-fanous-beit-ar', 'ramadan', 'Family Fanous: بيت عائلة حسن', 'فانوس العيلة: بيت عائلة حسن', [
    T('بيت عائلة', 'El Messiri', 0.15, 0.5, 0.3, { weight: 'bold' }),
    T('حسن', 'Aref Ruqaa', 0.28, 0.5, 0.7, { weight: 'bold', sampleName: 'family' }),
  ]),
  fanous('lan-fanous-family-en', 'ramadan', 'Family Fanous: Hassan Family', 'فانوس العيلة: اسم العيلة إنجليزي', [
    T('Hassan', 'Playfair Display', 0.22, 0.5, 0.34, { weight: 'bold', sampleName: 'family' }),
    T('Family', 'Playfair Display', 0.15, 0.5, 0.72),
  ]),
  fanous('lan-fanous-the-en', 'ramadan', 'Family Fanous: The Hassans', 'فانوس العيلة: The Hassans', [
    T('The Hassans', 'Playfair Display', 0.16, 0.5, 0.5, { weight: 'bold', sampleName: 'family', samplePart: 'Hassans' }),
  ]),

  // ---------- Arabesque Arch: one first name on the small plaque ----------
  arch('lan-arch-name-ruqaa', 'ramadan', 'Arabesque lantern: لارا', 'فانوس الأرابيسك: لارا', [
    T('لارا', 'Aref Ruqaa', 0.32, 0.5, 0.5, { weight: 'bold', sampleName: 'name' }),
  ]),
  arch('lan-arch-name-messiri', 'ramadan', 'Arabesque lantern: لارا in El Messiri', 'فانوس الأرابيسك: لارا خط المسيري', [
    T('لارا', 'El Messiri', 0.27, 0.5, 0.5, { weight: 'bold', sampleName: 'name' }),
  ]),
  arch('lan-arch-name-en', 'ramadan', 'Arabesque lantern: Lara', 'فانوس الأرابيسك: Lara', [
    T('Lara', 'Playfair Display', 0.26, 0.5, 0.5, { weight: 'bold', sampleName: 'name' }),
  ]),
  arch('lan-arch-name-script', 'ramadan', 'Arabesque lantern: Lara in script', 'فانوس الأرابيسك: Lara خط يد', [
    T('Lara', 'Pacifico', 0.22, 0.5, 0.5, { sampleName: 'name' }),
  ]),
];

module.exports = { categories, designs };
