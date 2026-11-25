'use strict';
/*
 * Funny sarcastic quotes pack: English quotes with cartoon animals, bought by the
 * owner with a full commercial (print on demand) licence. The black line-art ones
 * are one vector file each (public/img/art/sarcastic/*.svg) with a white copy
 * (`dark`) the shop uses on dark product colours, so they work on any colour. The
 * colour pictures ("Error 404" sloths, coffee cow and frog) are full-size transparent PNGs (3600 px class, 300 DPI)
 * with black lettering, so they stay on light colours. The words are part of the
 * artwork (the English quote stays as it is); the Arabic names explain the joke.
 */
const { I, D } = require('../library-dsl');

const art = (id) => `/img/art/sarcastic/${id}.svg`;
const white = (id) => `/img/art/sarcastic/${id}-white.svg`;
const png = (id) => `/img/art/sarcastic/${id}.png`;

// [file, English name, Arabic name, shop colour]
const QUOTES = [
  ['not-lazy', 'I\'m not lazy, I\'m on energy saving mode (sloth)', 'مش كسلان، أنا في وضع توفير الطاقة (كسلان)', 'white'],
  ['first-of-all-no', 'First of all no, second of all still no (llama)', 'أولًا لأ، ثانيًا برضه لأ (لاما)', 'black'],
  ['sarcasm-love-language', 'Sarcasm is my love language (crow)', 'التريقة هي لغة الحب بتاعتي (غراب)', 'white'],
  ['fluent-sarcasm', 'I speak fluent sarcasm (crow)', 'بتكلم تريقة بطلاقة (غراب)', 'black'],
  ['sarcasm-service', 'Sarcasm: just another service I offer (raccoon)', 'التريقة: خدمة كمان بقدمها (راكون)', 'white'],
  ['not-arguing', 'I\'m not arguing, I\'m just explaining why I\'m right (chicken)', 'أنا مش بجادل، أنا بس بشرح ليه أنا صح (فرخة)', 'black'],
  ['talk-to-myself', 'I always talk to myself, sometimes I need expert advice (pug)', 'بكلم نفسي على طول، ساعات بحتاج رأي خبير (كلب بج)', 'white'],
  ['wrong-once', 'I thought I was wrong once, but I was mistaken (goat)', 'افتكرت إني غلطت مرة، طلعت غلطان (معزة)', 'black'],
  ['keep-rolling-your-eyes', 'Keep rolling your eyes, maybe you\'ll find a brain back there (cats)', 'كمّل قلب عينك، يمكن تلاقي مخ ورا (قطط)', 'white'],
  ['personality-attitude', 'Don\'t confuse my personality with my attitude (crow)', 'متخلطش بين شخصيتي وأسلوبي (غراب)', 'black'],
  ['nice-person-mouth', 'I really try to be a nice person, but my mouth doesn\'t care (bird)', 'بحاول أبقى لطيف، بس لساني مش فارق معاه (عصفورة)', 'white'],
  ['under-control', 'Don\'t worry, I have everything under control... said no one ever (birds)', 'متقلقش، كله تحت السيطرة... محدش قالها قبل كده (عصافير)', 'black'],
  ['dont-be-burrito', 'Don\'t be a butthurt burrito', 'متبقاش بوريتو زعلان', 'white'],
  ['dont-be-donkey', 'Don\'t be a jackass donkey', 'متبقاش حمار (حمار كيوت)', 'black'],
  ['dont-be-jerkosaurus', 'Don\'t be a jerkosaurus (dinosaur)', 'متبقاش رخم (ديناصور كيوت)', 'white'],
  ['dont-be-snailbrain', 'Don\'t be a snailbrain', 'متبقاش مخك مخ حلزونة', 'black'],
];
// The colour pictures (sloths, coffee cow and frog): [file, English name, Arabic name]
const SLOTHS = [
  ['error-404-sloth-pillows', 'Error 404: motivation not found (sloth on pillows)', 'إيرور 404: الحماس مش موجود (كسلان على المخدات)'],
  ['error-404-sloth-nope-sign', 'Error 404: motivation not found (sloth with a Nope sign)', 'إيرور 404: الحماس مش موجود (كسلان شايل يافطة لأ)'],
  ['error-404-sloth-branch', 'Error 404: motivation not found (sloth on a branch)', 'إيرور 404: الحماس مش موجود (كسلان على فرع شجرة)'],
  ['error-404-sloth-beanie', 'Error 404: motivation not found (sloth in a beanie)', 'إيرور 404: الحماس مش موجود (كسلان لابس طاقية)'],
  ['life-begins-after-coffee-cow', 'Life begins after coffee (cow)', 'الحياة بتبدأ بعد القهوة (بقرة)'],
  ['came-saw-needed-coffee-frog', 'I came, I saw, I needed coffee, so I left (frog)', 'جيت، شفت، احتجت قهوة، فمشيت (ضفدع)'],
];

// The artwork fills most of the print area, a little above the middle (chest height on a T-shirt).
const designs = [
  ...QUOTES.map(([id, en, ar, color]) => D(`sq-${id}`, 'funny', en, ar, [
    I(art(id), 0.9, 0.5, 0.46, { h: 1.2, dark: white(id) }),
  ], color)),
  ...SLOTHS.map(([id, en, ar]) => D(`sq-${id}`, 'funny', en, ar, [
    I(png(id), 0.9, 0.5, 0.46, { h: 1.2 }),
  ])),
];

module.exports = { categories: [], designs };
