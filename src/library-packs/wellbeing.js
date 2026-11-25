'use strict';
/*
 * Wellbeing quotes pack: 4 English mental-health quotes on soft painted backgrounds,
 * sent by the owner (full licence). Each is one picture with its background
 * (public/img/art/wellbeing/, 1600 × 1279 px at 300 DPI, about 13 × 11 cm), so the
 * owner chose small products only, where it prints sharp: mugs, tumblers,
 * postcards, magnets and notebooks. The red speck after "restart" in the
 * phone-restart-hills picture was painted out.
 */
const { I, D } = require('../library-dsl');

const SMALL = { product: 'mug', aspect: 1600 / 1279, products: ['mug', 'magicmug', 'tumbler', 'postcards', 'magnets', 'notebook'] };
const art = (id) => `/img/art/wellbeing/${id}.png`;

const designs = [
  ['superheroes-mental-health-pink', 'Even superheroes take mental health days (pink watercolour)', 'حتى الأبطال الخارقين بياخدوا يوم راحة نفسية (ألوان مائية بينك)'],
  ['superheroes-mental-health-lilac', 'Even superheroes take mental health days (lilac hills)', 'حتى الأبطال الخارقين بياخدوا يوم راحة نفسية (تلال موف)'],
  ['phone-restart-script', 'Even your phone needs a restart sometimes, so do you (script)', 'حتى موبايلك بيحتاج ريستارت ساعات، وانت كمان'],
  ['phone-restart-hills', 'Even your phone needs a restart sometimes, so do you (green hills)', 'حتى موبايلك بيحتاج ريستارت ساعات، وانت كمان (تلال خضرا)'],
].map(([id, en, ar]) => D(`wb-${id}`, 'motivation', en, ar, [I(art(id), 1, 0.5, 0.5)], 'white', SMALL));

module.exports = { categories: [], designs };
