'use strict';

/*
 * Licensed collection "spiderman-bnd" (src/licensed.js): a DRAFT, seen only by the team until the owner confirms
 * the license in writing. The artwork is placeholders (plain grey boxes). To use the approved files, replace the
 * files in public/img/art/licensed-spiderman/ (same names), or change the paths in ART below.
 *
 * Each design is offered on one product only (`products`), the child's name and age are the only things a
 * customer changes (`sampleName` 'kid' and 'age'), and the artwork is never stretched (the editor is not offered).
 */
const { T, I, D } = require('../library-dsl');

const LIC = 'spiderman-bnd';
const CAT = 'licensed-spiderman';
const DIR = '/img/art/licensed-spiderman';
// One file per artwork slot (shape of the placeholder in brackets).
const ART = {
  crouch: `${DIR}/pose-crouch.svg`, // character pose 1 (portrait 3:4)
  web: `${DIR}/pose-web.svg`, // character pose 2 (portrait 3:4)
  swing: `${DIR}/pose-swing.svg`, // character pose 3 (landscape 4:3)
  title: `${DIR}/title.svg`, // movie title logo (wide 4:1)
  emblem: `${DIR}/emblem.svg`, // emblem (square)
};
const RED = '#c62828';
const NAVY = '#1b2a5c';
const lic = (product, color, aspect) => ({ licensed: LIC, products: [product], product, color, aspect });

module.exports = {
  categories: [{ id: CAT, name: { en: 'Spider-Man birthday (licensed)', ar: 'عيد ميلاد سبايدر مان (مرخّص)' } }],
  designs: [
    D('lic-sm-invitation', CAT, 'Spider-Man birthday invitation', 'دعوة عيد ميلاد سبايدر مان', [
      I(ART.title, 0.8, 0.5, 0.1),
      I(ART.web, 0.4, 0.5, 0.39),
      T('انت معزوم!', 'Lalezar', 0.11, 0.5, 0.63, { fill: RED }),
      T('عيد ميلاد يوسف', 'Lalezar', 0.11, 0.5, 0.72, { fill: NAVY, sampleName: 'kid', samplePart: 'يوسف' }),
      T('الـ ٦ سنين', 'Lalezar', 0.08, 0.5, 0.8, { fill: RED, sampleName: 'age', samplePart: '٦' }),
      T('اليوم: ........  الساعة: ........', 'Cairo', 0.05, 0.5, 0.88, { fill: NAVY }),
      T('المكان: ..............................', 'Cairo', 0.05, 0.5, 0.94, { fill: NAVY }),
    ], 'matte', lic('invitations', 'matte', 200 / 280)),
    D('lic-sm-welcome-sign', CAT, 'Spider-Man birthday welcome sign', 'لافتة ترحيب عيد ميلاد سبايدر مان', [
      I(ART.title, 0.8, 0.5, 0.09),
      T('أهلًا بيكم في عيد ميلاد', 'Lalezar', 0.08, 0.5, 0.2, { fill: NAVY }),
      I(ART.crouch, 0.5, 0.5, 0.49),
      T('يوسف', 'Lalezar', 0.2, 0.5, 0.8, { fill: RED, sampleName: 'kid' }),
      T('الـ ٦ سنين', 'Lalezar', 0.1, 0.5, 0.91, { fill: NAVY, sampleName: 'age', samplePart: '٦' }),
    ], 'white', lic('sign', 'white', 200 / 283)),
    D('lic-sm-stickers', CAT, 'Spider-Man party stickers (bag seals)', 'ستيكرات حفلة سبايدر مان (لقفل الأكياس)', [
      I(ART.emblem, 0.5, 0.5, 0.28),
      T('شكرًا إنكم جيتوا', 'Lalezar', 0.09, 0.5, 0.56, { fill: NAVY }),
      T('عيد ميلاد يوسف', 'Lalezar', 0.11, 0.5, 0.7, { fill: RED, sampleName: 'kid', samplePart: 'يوسف' }),
      T('الـ ٦ سنين', 'Lalezar', 0.08, 0.5, 0.82, { fill: NAVY, sampleName: 'age', samplePart: '٦' }),
    ], 'white', lic('stickersheet', 'white', 220 / 311)),
    D('lic-sm-thankyou', CAT, 'Spider-Man thank-you card', 'كارت شكر سبايدر مان', [
      I(ART.swing, 0.8, 0.5, 0.3),
      T('شكرًا إنك جيت', 'Lalezar', 0.12, 0.5, 0.58, { fill: RED }),
      T('عيد ميلاد يوسف', 'Lalezar', 0.11, 0.5, 0.7, { fill: NAVY, sampleName: 'kid', samplePart: 'يوسف' }),
      T('الـ ٦ سنين', 'Lalezar', 0.08, 0.5, 0.81, { fill: RED, sampleName: 'age', samplePart: '٦' }),
    ], 'matte', lic('postcards', 'matte', 220 / 330)),
    D('lic-sm-favor-bag', CAT, 'Spider-Man favor bag', 'كيس هدايا حفلة سبايدر مان', [
      I(ART.web, 0.46, 0.5, 0.33),
      T('هدية من عيد ميلاد', 'Lalezar', 0.08, 0.5, 0.67, { fill: NAVY }),
      T('يوسف', 'Lalezar', 0.15, 0.5, 0.8, { fill: RED, sampleName: 'kid' }),
      T('الـ ٦ سنين', 'Lalezar', 0.07, 0.5, 0.92, { fill: NAVY, sampleName: 'age', samplePart: '٦' }),
    ], 'white', lic('paperbags', 'white', 200 / 222)),
  ],
};
