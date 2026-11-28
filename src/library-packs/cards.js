'use strict';
/*
 * Business cards for a whole team: the fields in { } are filled from the
 * customer's Excel / CSV list (one card pack per row). The column titles in
 * the list must match the fields (the editor's example file has them).
 */
const { T, S, A, D, ACCENT, GOLD, BLUE } = require('../library-dsl');

const CARD = { product: 'bizcards', aspect: 360 / 220 };
const card = (id, en, ar, items, color = 'matte') => D(id, 'business', en, ar, items, color, CARD);

const designs = [
  card('cd-team-ar', 'Team business card (Arabic)', 'كارت شخصي لفريق العمل', [
    T('{الاسم}', 'Cairo', 0.085, 0.5, 0.27, { weight: 'bold' }),
    T('{الوظيفة}', 'Cairo', 0.048, 0.5, 0.44, { fill: ACCENT, weight: 'bold' }),
    S('line', 0.3, 0.5, 0.56, { fill: ACCENT }),
    T('{الموبايل}', 'Tajawal', 0.042, 0.5, 0.7),
    T('{الإيميل}', 'Tajawal', 0.042, 0.5, 0.83),
  ]),
  card('cd-team-en', 'Team business card', 'كارت شخصي لفريق العمل (إنجليزي)', [
    T('{Name}', 'Montserrat', 0.075, 0.5, 0.27, { weight: 'bold' }),
    T('{Position}', 'Montserrat', 0.04, 0.5, 0.43, { fill: BLUE, spacing: 120 }),
    S('line', 0.3, 0.5, 0.56, { fill: BLUE }),
    T('{Phone}', 'Montserrat', 0.038, 0.5, 0.7),
    T('{Email}', 'Montserrat', 0.038, 0.5, 0.83),
  ]),
  card('cd-company-ar', 'Company card with logo (Arabic)', 'كارت شركة بلوجو', [
    A('tabler:building-skyscraper', 0.09, 0.5, 0.15, { fill: GOLD }),
    T('اسم الشركة', 'El Messiri', 0.05, 0.5, 0.31, { weight: 'bold', fill: GOLD }),
    T('{الاسم}', 'Cairo', 0.075, 0.5, 0.5, { weight: 'bold' }),
    T('{الوظيفة}', 'Cairo', 0.042, 0.5, 0.64),
    T('{الموبايل}  •  {الإيميل}', 'Tajawal', 0.036, 0.5, 0.83),
  ], 'kraft'),
  card('cd-modern-en', 'Modern business card', 'كارت عصري (إنجليزي)', [
    S('circle', 0.11, 0.5, 0.17, { fill: ACCENT }),
    T('{Name}', 'Bebas Neue', 0.1, 0.5, 0.42, { spacing: 80 }),
    T('{Position}', 'Montserrat', 0.036, 0.5, 0.58, { fill: ACCENT, weight: 'bold', spacing: 200 }),
    T('{Phone}   |   {Email}', 'Montserrat', 0.034, 0.5, 0.8),
  ]),
  card('cd-bilingual', 'Bilingual business card', 'كارت عربي وإنجليزي', [
    T('{الاسم}', 'Cairo', 0.07, 0.5, 0.2, { weight: 'bold' }),
    T('{Name}', 'Montserrat', 0.05, 0.5, 0.37, { weight: 'bold' }),
    T('{الوظيفة}', 'Cairo', 0.04, 0.5, 0.53, { fill: BLUE }),
    S('line', 0.24, 0.5, 0.64, { fill: BLUE }),
    T('{الموبايل}', 'Tajawal', 0.038, 0.5, 0.75),
    T('{الإيميل}', 'Tajawal', 0.038, 0.5, 0.87),
  ]),
];

module.exports = { categories: [], designs };
