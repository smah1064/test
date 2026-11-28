'use strict';
/*
 * Mouse pad pack, bought by the owner with a full licence (public/img/art/mousepads/):
 * 3 "3D animal breaking through a wall" pictures and 3 Halloween stained-glass
 * pictures, made for mouse pads (sublimation, edge to edge). The 9.5 × 8 in files at
 * 300 DPI were cut from the middle to the mouse pad's 24 × 19 cm shape, so each
 * fills the whole pad (`full`: no margin, see buildTemplate in public/js/templates.js).
 * Mouse pad only.
 */
const { I, D } = require('../library-dsl');

const PAD = { product: 'mousepad', aspect: 380 / 300, products: ['mousepad'] };
const art = (id) => `/img/art/mousepads/${id}.png`;

const designs = [
  ['wall-hole-tiger', 'optical', '3D tiger breaking through a wall', 'نمر طالع من الحيطة (3D)'],
  ['wall-hole-giraffe', 'optical', '3D giraffe peeking through a wall', 'زرافة باصة من الحيطة (3D)'],
  ['wall-hole-alpaca', 'optical', '3D alpaca peeking through a wall', 'ألباكا باصة من الحيطة (3D)'],
  ['stained-glass-cauldron', 'artsy', 'Halloween cauldron (stained glass)', 'قِدر هالوين (زجاج معشق)'],
  ['stained-glass-haunted-forest', 'artsy', 'Halloween haunted forest and bats (stained glass)', 'غابة هالوين وخفافيش (زجاج معشق)'],
  ['stained-glass-spider', 'artsy', 'Halloween spider web (stained glass)', 'شبكة عنكبوت هالوين (زجاج معشق)'],
].map(([id, cat, en, ar]) => D(`mp-${id}`, cat, en, ar, [I(art(id), 1, 0.5, 0.5, { full: true })], 'white', PAD));

module.exports = { categories: [], designs };
