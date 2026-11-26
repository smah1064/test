'use strict';
/*
 * Funny sarcastic quotes pack: English quotes with cartoon animals, bought by the
 * owner with a full commercial (print on demand) licence. The black line-art ones
 * are one vector file each (public/img/art/sarcastic/*.svg) with a white copy
 * (`dark`) the shop uses on dark product colours, so they work on any colour. The
 * colour pictures ("Error 404" sloths, coffee cow and frog) are full-size transparent PNGs (3600 px class, 300 DPI)
 * with black lettering, so they stay on light colours. The Arabic names explain the joke.
 *
 * The words are live text (`words`, see public/js/templates.js): each picture has a copy without its
 * lettering (<id>-nowords.svg and its white copy, <id>-nowords.png), and the words are set on it in the
 * free font closest to the drawn lettering, where and as big as they were drawn. In the editor they are
 * ordinary text (tap, double-tap to type) and the drawing its own layer. Small words that belong to the
 * drawing itself (the "NOPE" mug and sign, the "0%" battery) stay in the picture.
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

// The words of each picture: x, y (centre) as fractions of the picture, size and w (line width) as fractions of
// its width. No fill: the ink (black, white on dark colours), like the line art.
const WORDS = {
  'not-lazy': [
    { text: 'I’M NOT LAZY', font: 'League Gothic', size: 0.2702, x: 0.4962, y: 0.1244, w: 0.9662 },
    { text: 'I’m on energy', font: 'Pacifico', size: 0.141, x: 0.5031, y: 0.7754, w: 0.7854 },
    { text: 'Saving Mode', font: 'Caprasimo', size: 0.1543, x: 0.4985, y: 0.9132, w: 0.9835 },
  ],
  'first-of-all-no': [
    { text: 'First', font: 'Caprasimo', size: 0.1912, x: 0.7459, y: 0.1164, w: 0.4324, spacing: -60 },
    { text: 'of all', font: 'Caprasimo', size: 0.1215, x: 0.7483, y: 0.2417, w: 0.2794, angle: 1, spacing: -60 },
    { text: 'NO', font: 'Caprasimo', size: 0.3178, x: 0.7495, y: 0.4465, w: 0.4903, spacing: -60 },
    { text: 'Second', font: 'Caprasimo', size: 0.1402, x: 0.7457, y: 0.6396, w: 0.4668, angle: 1, spacing: -60 },
    { text: 'of all', font: 'Caprasimo', size: 0.1035, x: 0.7317, y: 0.7381, w: 0.2368, spacing: -60 },
    { text: 'Still No', font: 'Caprasimo', size: 0.1709, x: 0.7114, y: 0.8813, w: 0.5676, spacing: -80 },
  ],
  'sarcasm-love-language': [
    { text: 'SARCASM', font: 'Caprasimo', size: 0.2044, x: 0.496, y: 0.1092, w: 0.9824, spacing: -80 },
    { text: 'is my', font: 'Yesteryear', size: 0.2018, x: 0.8226, y: 0.2054, w: 0.345 },
    { text: 'LOVE', font: 'Caprasimo', size: 0.2078, x: 0.5354, y: 0.761, w: 0.5995 },
    { text: 'language', font: 'Yesteryear', size: 0.2588, x: 0.5053, y: 0.85, w: 0.7716 },
  ],
  'fluent-sarcasm': [
    { text: 'I Speak', font: 'Chewy', size: 0.1924, x: 0.501, y: 0.0802, w: 0.6153, spacing: 60 },
    { text: 'FLUENT', font: 'Lilita One', size: 0.3039, x: 0.4991, y: 0.2265, w: 0.9659 },
    { text: 'SARCASM', font: 'Smokum', size: 0.3223, x: 0.5, y: 0.868, w: 0.971 },
  ],
  'sarcasm-service': [
    { text: 'SARCASM:', font: 'Chewy', size: 0.2633, x: 0.5017, y: 0.1223, w: 0.9831 },
    { text: 'Just Another Service', font: 'Chewy', size: 0.1134, x: 0.5076, y: 0.7966, w: 0.9234 },
    { text: 'I Offer', font: 'Caprasimo', size: 0.2717, x: 0.5038, y: 0.9262, w: 0.9146 },
  ],
  'not-arguing': [
    { text: 'I’m not', font: 'Kalam', weight: 'bold', size: 0.1359, x: 0.4969, y: 0.0578, w: 0.4513 },
    { text: 'ARGUING', font: 'Lilita One', size: 0.2335, x: 0.5028, y: 0.1852, w: 0.9847 },
    { text: 'I’m just explaining why', font: 'Kalam', weight: 'bold', size: 0.0939, x: 0.4971, y: 0.8056, w: 0.9795 },
    { text: 'I’M RIGHT', font: 'Lilita One', size: 0.2103, x: 0.5016, y: 0.9126, w: 0.9786 },
  ],
  'talk-to-myself': [
    { text: 'I always talk to', font: 'Yesteryear', size: 0.1775, x: 0.5003, y: 0.101, w: 0.9589 },
    { text: 'MYSELF.', font: 'League Gothic', size: 0.2983, x: 0.2896, y: 0.4008, w: 0.5696, spacing: -60 },
    { text: 'Sometimes I need', font: 'Yesteryear', size: 0.0934, x: 0.2755, y: 0.6138, w: 0.5413 },
    { text: 'EXPERT ADVICE', font: 'League Gothic', size: 0.1316, x: 0.2856, y: 0.771, w: 0.5615 },
  ],
  'wrong-once': [
    { text: 'I thought', font: 'Yesteryear', size: 0.1706, x: 0.4893, y: 0.0651, w: 0.5357 },
    { text: 'I WAS WRONG ONCE...', font: 'League Gothic', size: 0.1712, x: 0.5007, y: 0.2135, w: 0.9849 },
    { text: 'But I Was', font: 'Yesteryear', size: 0.2226, x: 0.5021, y: 0.7732, w: 0.8449 },
    { text: 'MISTAKEN', font: 'Lilita One', size: 0.2039, x: 0.4902, y: 0.9401, w: 0.9706 },
  ],
  'keep-rolling-your-eyes': [
    { text: 'KEEP ROLLING', font: 'Anton', size: 0.199, x: 0.4996, y: 0.1079, w: 0.9896 },
    { text: 'your eyes,', font: 'Yesteryear', size: 0.2548, x: 0.5315, y: 0.1768, w: 0.8292, angle: 3 },
    { text: 'MAYBE YOU\'LL FIND A BRAIN', font: 'Six Caps', size: 0.1873, x: 0.4967, y: 0.8553, w: 0.9481 },
    { text: 'back there', font: 'Yesteryear', size: 0.1745, x: 0.5015, y: 0.9523, w: 0.5807 },
  ],
  'personality-attitude': [
    { text: 'Don’t confuse my', font: 'Yesteryear', size: 0.1411, x: 0.5033, y: 0.0761, w: 0.8008, angle: -1 },
    { text: 'PERSONALITY', font: 'Smokum', size: 0.228, x: 0.4991, y: 0.2241, w: 0.9837 },
    { text: 'ATTITUDE', font: 'Smokum', size: 0.2392, x: 0.5031, y: 0.884, w: 0.7266 },
    { text: 'With my', font: 'Yesteryear', size: 0.148, x: 0.5014, y: 0.7511, w: 0.4302 },
  ],
  'nice-person-mouth': [
    { text: 'I REALLY TRY', font: 'Oswald', weight: 'bold', size: 0.1033, x: 0.7176, y: 0.079, w: 0.545 },
    { text: 'TO BE A', font: 'Smokum', size: 0.2224, x: 0.7179, y: 0.2524, w: 0.5381 },
    { text: 'nice person,', font: 'Yesteryear', size: 0.1399, x: 0.7306, y: 0.3687, w: 0.5291 },
    { text: 'BUT SOMETIMES', font: 'Oswald', weight: 'bold', size: 0.0825, x: 0.7198, y: 0.5246, w: 0.5365 },
    { text: 'MY MOUTH', font: 'League Gothic', size: 0.19, x: 0.7172, y: 0.68, w: 0.556 },
    { text: 'doesn’t', font: 'Yesteryear', size: 0.2106, x: 0.7067, y: 0.8075, w: 0.4718 },
    { text: 'care', font: 'Yesteryear', size: 0.204, x: 0.7333, y: 0.8913, w: 0.279, angle: -5 },
  ],
  'under-control': [
    { text: 'DON’T WORRY,', font: 'Oswald', weight: 'bold', size: 0.1715, x: 0.4992, y: 0.0932, w: 0.9886 },
    { text: 'I have everything', font: 'Kalam', weight: 'bold', size: 0.1263, x: 0.492, y: 0.2307, w: 0.9699 },
    { text: 'UNDER CONTROL...', font: 'Ultra', size: 0.0929, x: 0.5017, y: 0.8204, w: 0.9811, spacing: -60 },
    { text: 'SAID NO ONE EVER.', font: 'League Gothic', size: 0.1904, x: 0.4997, y: 0.944, w: 0.9803, angle: -1 },
  ],
  'dont-be-burrito': [
    { text: 'DON\'T BE A', font: 'Kalam', size: 0.1489, x: 0.4942, y: 0.0694, w: 0.7791, angle: -2 },
    { text: 'BUTTHURT', font: 'Chewy', size: 0.2054, x: 0.373, y: 0.766, w: 0.7291, spacing: -40 },
    { text: 'BURRITO', font: 'Chewy', size: 0.2592, x: 0.57, y: 0.8877, w: 0.8039, angle: -2, spacing: -40 },
  ],
  'dont-be-donkey': [
    { text: 'DON\'T BE', font: 'Chewy', size: 0.1218, x: 0.2436, y: 0.2638, curve: 29, angle: -36.2 },
    { text: 'JACKASS', font: 'Chewy', size: 0.1255, x: 0.2207, y: 0.9205, w: 0.4074 },
    { text: 'DONKEY', font: 'Chewy', size: 0.1771, x: 0.7072, y: 0.9203, w: 0.5545 },
  ],
  'dont-be-jerkosaurus': [
    { text: 'DON\'T BE A', font: 'Kalam', size: 0.0838, x: 0.4945, y: 0.0472, w: 0.4442, angle: -1 },
    { text: 'JERKOSAURUS', font: 'Lilita One', size: 0.1471, x: 0.4956, y: 0.2106, curve: 36 },
  ],
  'dont-be-snailbrain': [
    { text: 'DON\'T BE A', font: 'Kalam', size: 0.1054, x: 0.4961, y: 0.0622, w: 0.5585 },
    { text: 'SNAILBRAIN', font: 'Chewy', size: 0.201, x: 0.5002, y: 0.904, w: 0.99 },
  ],
  'error-404-sloth-pillows': [
    { text: 'ERROR', font: 'Chewy', size: 0.2219, x: 0.3014, y: 0.1192, w: 0.5634, angle: -8, fill: '#12aaaa' },
    { text: '404:', font: 'Chewy', size: 0.2048, x: 0.8021, y: 0.1096, w: 0.3862, fill: '#f86c0c' },
    { text: 'MOTIVATION', font: 'Anton', size: 0.222, x: 0.4921, y: 0.8134, w: 0.9746, fill: '#111111' },
    { text: 'NOT', font: 'Caprasimo', size: 0.1304, x: 0.24, y: 0.9459, w: 0.3006, fill: '#0cacac' },
    { text: 'FOUND', font: 'Caprasimo', size: 0.1193, x: 0.6592, y: 0.9421, w: 0.4633, fill: '#111111' },
  ],
  'error-404-sloth-nope-sign': [
    { text: 'ERROR 404:', font: 'Anton', size: 0.2131, x: 0.4992, y: 0.1278, w: 0.9193, fill: '#111111' },
    { text: 'MOTIVATION', font: 'Anton', size: 0.2094, x: 0.4994, y: 0.3658, curve: 16, fill: '#f8680c' },
    { text: 'not\nfound', font: 'Kalam', weight: 'bold', size: 0.1076, x: 0.7948, y: 0.5021, w: 0.2673, angle: -6, lineHeight: 0.775, fill: '#111111' },
  ],
  'error-404-sloth-branch': [
    { text: 'ERROR 404:', font: 'Kalam', weight: 'bold', size: 0.1569, x: 0.5127, y: 0.1295, curve: 32, angle: -3.7, fill: '#111111' },
    { text: 'MOTIVATION', font: 'Anton', size: 0.2202, x: 0.5, y: 0.775, w: 0.9663, fill: '#f86c50' },
    { text: 'not found', font: 'Kalam', weight: 'bold', size: 0.1224, x: 0.5099, y: 0.9391, w: 0.5291, fill: '#111111' },
  ],
  'error-404-sloth-beanie': [
    { text: 'ERROR 404:', font: 'Kalam', weight: 'bold', size: 0.1721, x: 0.5045, y: 0.1121, w: 0.9002, angle: 2, fill: '#111111' },
    { text: 'MOTIVATION', font: 'Anton', size: 0.2249, x: 0.4977, y: 0.7958, w: 0.9858, fill: '#0cb4b8' },
    { text: 'NOT FOUND', font: 'Kalam', weight: 'bold', size: 0.1157, x: 0.499, y: 0.9592, w: 0.6126, fill: '#111111' },
  ],
  'life-begins-after-coffee-cow': [
    { text: 'LIFE BEGINS AFTER', font: 'Smokum', size: 0.1338, x: 0.5084, y: 0.1129, curve: 34, fill: '#110d0a' },
    { text: 'Coffee', font: 'Lobster', size: 0.4287, x: 0.4983, y: 0.7961, w: 0.9416, fill: '#110d0a' },
  ],
  'came-saw-needed-coffee-frog': [
    { text: 'I CAME, I SAW,', font: 'Ultra', size: 0.0765, x: 0.4796, y: 0.1008, curve: 29, fill: '#1c2624' },
    { text: 'I NEEDED', font: 'Ultra', size: 0.0653, x: 0.4892, y: 0.1453, w: 0.3754, fill: '#e4500f' },
    { text: 'COFFEE', font: 'Ultra', size: 0.1512, x: 0.4968, y: 0.2327, w: 0.6566, spacing: -60, fill: '#1c2624' },
    { text: 'So I left', font: 'Pacifico', size: 0.2229, x: 0.498, y: 0.8818, w: 0.8152, fill: '#4f520e' },
  ],
};
const words = (id, src, dark) => (WORDS[id] ? { words: { src, ...(dark ? { dark } : {}), texts: WORDS[id] } } : {});

// The artwork fills most of the print area, a little above the middle (chest height on a T-shirt).
const designs = [
  ...QUOTES.map(([id, en, ar, color]) => D(`sq-${id}`, 'funny', en, ar, [
    I(art(id), 0.9, 0.5, 0.46, { h: 1.2, dark: white(id), ...words(id, art(`${id}-nowords`), white(`${id}-nowords`)) }),
  ], color)),
  ...SLOTHS.map(([id, en, ar]) => D(`sq-${id}`, 'funny', en, ar, [
    I(png(id), 0.9, 0.5, 0.46, { h: 1.2, ...words(id, png(`${id}-nowords`)) }),
  ])),
];

module.exports = { categories: [], designs };
