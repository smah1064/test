'use strict';
/*
 * Wellbeing quotes pack: 4 English mental-health quotes on soft painted backgrounds,
 * sent by the owner (full licence). Each is one picture with its background
 * (public/img/art/wellbeing/, 1600 × 1279 px at 300 DPI, about 13 × 11 cm), so the
 * owner chose small products only, where it prints sharp: mugs, tumblers,
 * postcards, magnets and notebooks. The red speck after "restart" in the
 * phone-restart-hills picture was painted out.
 *
 * The words are live text (`words`, see public/js/templates.js): each picture has a copy without its
 * lettering (<id>-nowords.png, the background painted on where the letters were; the little dashes and
 * swashes round the words stay), and the words are set on it in the free font closest to the drawn
 * lettering and in its colour, so in the editor they are ordinary text and the picture its own layer.
 */
const { I, D } = require('../library-dsl');

const SMALL = { product: 'mug', aspect: 1600 / 1279, products: ['mug', 'magicmug', 'tumbler', 'postcards', 'magnets', 'notebook'] };
const art = (id) => `/img/art/wellbeing/${id}.png`;

// The words of each picture: x, y (centre) as fractions of the picture, size and w (line width) as fractions of its width.
const WORDS = {
  'superheroes-mental-health-pink': [
    { text: 'EVEN', font: 'Oswald', weight: 'bold', size: 0.1422, x: 0.4917, y: 0.2352, w: 0.2821, angle: 4, fill: '#580058' },
    { text: 'SUPERHEROES', font: 'Oswald', weight: 'bold', size: 0.1104, x: 0.5, y: 0.3858, w: 0.6541, angle: -5.5, fill: '#580058' },
    { text: 'TAKE', font: 'Oswald', weight: 'bold', size: 0.0733, x: 0.5019, y: 0.5039, w: 0.1457, angle: -6, fill: '#580058' },
    { text: 'MENTAL', font: 'Oswald', weight: 'bold', size: 0.1349, x: 0.4934, y: 0.6128, w: 0.4181, angle: -6.5, fill: '#580058' },
    { text: 'HEALTH DAYS', font: 'Oswald', weight: 'bold', size: 0.1167, x: 0.4917, y: 0.769, w: 0.6305, angle: -5, fill: '#580058' },
  ],
  'superheroes-mental-health-lilac': [
    { text: 'EVEN', font: 'Oswald', weight: 'bold', size: 0.1367, x: 0.4917, y: 0.1845, w: 0.2733, fill: '#610000' },
    { text: 'SUPERHEROES', font: 'Oswald', weight: 'bold', size: 0.1138, x: 0.4988, y: 0.3402, w: 0.6757, fill: '#610000' },
    { text: 'TAKE', font: 'Oswald', weight: 'bold', size: 0.0911, x: 0.5003, y: 0.4438, w: 0.1806, fill: '#610000' },
    { text: 'MENTAL', font: 'Oswald', weight: 'bold', size: 0.1329, x: 0.5079, y: 0.5653, w: 0.4154, fill: '#610000' },
    { text: 'HEALTH', font: 'Oswald', weight: 'bold', size: 0.122, x: 0.5133, y: 0.7199, w: 0.3716, fill: '#610000' },
    { text: 'DAYS', font: 'Oswald', weight: 'bold', size: 0.136, x: 0.5079, y: 0.8424, w: 0.2862, fill: '#610000' },
  ],
  'phone-restart-script': [
    { text: 'Even Your\nPhone needs\na restart\nSometimes –\nSo do you.', font: 'Lobster', size: 0.1185, x: 0.4973, y: 0.4978, w: 0.5597, lineHeight: 0.75, fill: '#003d3e' },
  ],
  'phone-restart-hills': [
    { text: 'Even your\nphone needs\na restart\nSometimes –\nSo do you.', font: 'Caprasimo', size: 0.1113, x: 0.4992, y: 0.492, w: 0.7104, lineHeight: 0.75, fill: '#460000' },
  ],
};

const designs = [
  ['superheroes-mental-health-pink', 'Even superheroes take mental health days (pink watercolour)', 'حتى الأبطال الخارقين بياخدوا يوم راحة نفسية (ألوان مائية بينك)'],
  ['superheroes-mental-health-lilac', 'Even superheroes take mental health days (lilac hills)', 'حتى الأبطال الخارقين بياخدوا يوم راحة نفسية (تلال موف)'],
  ['phone-restart-script', 'Even your phone needs a restart sometimes, so do you (script)', 'حتى موبايلك بيحتاج ريستارت ساعات، وانت كمان'],
  ['phone-restart-hills', 'Even your phone needs a restart sometimes, so do you (green hills)', 'حتى موبايلك بيحتاج ريستارت ساعات، وانت كمان (تلال خضرا)'],
].map(([id, en, ar]) => D(`wb-${id}`, 'motivation', en, ar, [
  I(art(id), 1, 0.5, 0.5, { words: { src: art(`${id}-nowords`), texts: WORDS[id] } }),
], 'white', SMALL));

module.exports = { categories: [], designs };
