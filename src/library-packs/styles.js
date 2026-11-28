'use strict';
/*
 * Design-trend pack: the 13 popular print-on-demand styles, each with its own
 * artwork (public/img/art: AI illustrations in ai/, hand-made vector art in svg/)
 * and Egyptian Arabic or English words. Names, monograms and gamer tags are
 * placeholders the customer edits. All artwork is original: no real brands,
 * characters or band logos.
 */
const { T, S, I, D, ACCENT, GOLD, PINK, PURPLE } = require('../library-dsl');

const ai = (id) => `/img/art/ai/${id}.png`;
const vec = (id) => `/img/art/svg/${id}.svg`;
const RUST = '#b5542b';
const BROWN = '#7a3b12';
const NEON_PINK = '#f472b6';
const CYAN = '#22d3ee';
const LIME = '#94d82d';
const ORANGE = '#f76707';
const YELLOW = '#fab005';

const categories = [
  { id: 'vintage', name: { en: 'Vintage & retro', ar: 'فينتدج وريترو' } },
  { id: 'surreal', name: { en: 'Dreamy AI art', ar: 'فن خيالي' } },
  { id: 'optical', name: { en: 'Optical illusions', ar: 'خداع بصري' } },
  { id: 'comic', name: { en: 'Comics & pop art', ar: 'كوميكس وبوب آرت' } },
  { id: 'maximal', name: { en: 'Maximalism', ar: 'ألوان على الآخر' } },
  { id: 'artsy', name: { en: 'Painted art', ar: 'رسم وفن' } },
  { id: 'luxury', name: { en: 'Luxury look', ar: 'شيك وفخم' } },
  { id: 'trends', name: { en: 'Trends & slang', ar: 'تريندات وإفيهات' } },
];

const designs = [
  // ---------- 1. Vintage ----------
  D('st-vintage-stork-bike', 'vintage', 'Ride slow (vintage bicycle)', 'ركوب على رواقة (عجلة فينتدج)', [
    I(ai('vintage-stork-bike'), 0.82, 0.5, 0.4),
    T('Ride Slow', 'Lobster', 0.13, 0.5, 0.84, { fill: BROWN }),
  ], 'sand'),
  D('st-vintage-70s-sunset', 'vintage', 'Stay groovy (70s sunset)', 'ستاي جروفي (غروب السبعينات)', [
    I(ai('vintage-70s-sunset'), 0.74, 0.5, 0.4),
    T('Stay Groovy', 'Righteous', 0.12, 0.5, 0.84, { fill: RUST }),
  ]),
  D('st-vintage-deco', 'vintage', 'The Roaring Twenties (Art Deco)', 'العشرينات الذهبية (آرت ديكو)', [
    I(ai('vintage-deco-fan'), 0.72, 0.5, 0.33),
    T('THE ROARING', 'Playfair Display', 0.065, 0.5, 0.64, { spacing: 400 }),
    T('TWENTIES', 'Abril Fatface', 0.17, 0.5, 0.78, { fill: GOLD }),
  ], 'black'),
  D('st-vintage-zaman', 'vintage', 'The good old days (retro sunset badge)', 'زمن الفن الجميل', [
    I(vec('vintage-70s-sunset-badge'), 0.6, 0.5, 0.35),
    T('زمن الفن الجميل', 'Rakkas', 0.13, 0.5, 0.76, { fill: BROWN }),
  ], 'sand'),
  D('st-vintage-groovy', 'vintage', 'Good vibes only (groovy waves)', 'جود فايبز (موجات ريترو)', [
    T('Good Vibes Only', 'Lobster', 0.14, 0.5, 0.3, { fill: RUST }),
    I(vec('vintage-groovy-wave-band'), 0.92, 0.5, 0.62),
  ]),
  D('st-vintage-ayam-zaman', 'vintage', 'Old times (Art Deco frame)', 'أيام زمان (برواز آرت ديكو)', [
    I(vec('vintage-art-deco-frame'), 0.92, 0.5, 0.5),
    T('أيام زمان', 'Aref Ruqaa', 0.19, 0.5, 0.46, { fill: GOLD }),
    T('EST. 1970', 'Playfair Display', 0.055, 0.5, 0.6, { spacing: 300, fill: GOLD }),
  ], 'black'),
  D('st-vintage-retro-badge', 'vintage', 'Retro badge', 'بادج ريترو', [
    I(vec('vintage-starburst-badge'), 0.72, 0.5, 0.46),
    T('RETRO', 'Bungee', 0.13, 0.5, 0.42, { fill: BROWN }),
    T('ريترو', 'Lalezar', 0.1, 0.5, 0.53, { fill: BROWN }),
  ]),

  // ---------- 2. AI-generated / dreamy art ----------
  D('st-surreal-dream-world', 'surreal', 'Dream world (floating islands)', 'عالم الأحلام (جزر طايرة)', [
    I(ai('ai-porthole-dream'), 0.8, 0.5, 0.41),
    T('DREAM WORLD', 'Bebas Neue', 0.12, 0.5, 0.86, { spacing: 300 }),
  ], 'black'),
  D('st-surreal-flow', 'surreal', 'Flow (iridescent liquid)', 'فلو (سائل بألوان قزحية)', [
    I(ai('ai-iridescent-fluid'), 0.84, 0.5, 0.43),
    T('FLOW', 'Bebas Neue', 0.16, 0.5, 0.88, { spacing: 600 }),
  ], 'black'),
  D('st-surreal-7elm', 'surreal', 'A dream (koi dragon)', 'حلم (سمكة تنين)', [
    I(ai('ai-koi-dragon'), 0.84, 0.5, 0.43),
    T('حلم', 'Aref Ruqaa', 0.2, 0.5, 0.87, { fill: '#ff7a59' }),
  ], 'black'),
  D('st-surreal-3alam-tany', 'surreal', 'Another world', 'عالم تاني', [
    I(ai('ai-porthole-dream'), 0.68, 0.5, 0.37),
    T('عالم تاني', 'Lalezar', 0.16, 0.5, 0.76),
    T('ANOTHER WORLD', 'Montserrat', 0.045, 0.5, 0.88, { spacing: 400 }),
  ]),
  D('st-surreal-go-with-flow', 'surreal', 'Go with the flow', 'جو ويذ ذا فلو', [
    I(ai('ai-iridescent-fluid'), 0.76, 0.5, 0.4),
    T('Go with the flow', 'Pacifico', 0.1, 0.5, 0.84, { fill: PURPLE }),
  ]),
  D('st-surreal-mythical', 'surreal', 'Mythical (koi dragon)', 'أسطوري (سمكة تنين)', [
    I(ai('ai-koi-dragon'), 0.8, 0.5, 0.41),
    T('MYTHICAL', 'Righteous', 0.12, 0.5, 0.85, { fill: '#e8590c' }),
  ]),

  // ---------- 3. Animals in funny scenes ----------
  D('st-pets-cool-duck', 'pets', 'Cool as a duck', 'بطة روشة', [
    I(ai('animals-duck-sunglasses'), 0.78, 0.5, 0.4),
    T('Cool as a duck', 'Permanent Marker', 0.1, 0.5, 0.84),
  ]),
  D('st-pets-chef-cat', 'pets', 'Chef cat', 'الشيف قطة', [
    I(ai('animals-chef-cat'), 0.78, 0.5, 0.4),
    T('الشيف قطة', 'Lalezar', 0.15, 0.5, 0.84, { fill: ACCENT }),
  ]),
  D('st-pets-summer-dog', 'pets', 'Summer mode (dog on a float)', 'مود الصيف (كلب على عوامة)', [
    I(ai('animals-dog-float'), 0.8, 0.5, 0.4),
    T('Summer Mode', 'Pacifico', 0.12, 0.5, 0.84, { fill: '#0ca678' }),
  ]),
  D('st-pets-camel-mood', 'pets', 'Camel mood (headphones)', 'مزاج الجمل (سماعات)', [
    I(ai('animals-camel-headphones'), 0.74, 0.5, 0.4),
    T('مزاج الجمل', 'Lalezar', 0.15, 0.5, 0.84, { fill: PINK }),
  ], 'black'),
  D('st-pets-batta-rewsha', 'pets', 'Just a cool duck', 'بطة بس روشة', [
    I(ai('animals-duck-sunglasses'), 0.68, 0.5, 0.35),
    T('بطة', 'Lalezar', 0.18, 0.5, 0.72),
    T('بس روشة', 'Marhey', 0.1, 0.5, 0.86, { fill: YELLOW }),
  ], 'black'),
  D('st-pets-cooking-vibes', 'pets', 'Cooking up good vibes (cat chef)', 'بطبخ مزاج حلو (قطة شيف)', [
    I(ai('animals-chef-cat'), 0.7, 0.5, 0.36),
    T('Cooking up', 'Permanent Marker', 0.09, 0.5, 0.74),
    T('Good Vibes', 'Permanent Marker', 0.12, 0.5, 0.87, { fill: ACCENT }),
  ]),
  D('st-pets-name', 'pets', 'Best dog ever (with the name)', 'أحلى كلب (بالاسم)', [
    I(ai('animals-dog-float'), 0.7, 0.5, 0.36),
    T('Max', 'Pacifico', 0.17, 0.5, 0.74, { fill: '#0ca678', sampleName: 'dog' }),
    T('BEST DOG EVER', 'Bebas Neue', 0.07, 0.5, 0.9, { spacing: 300 }),
  ]),

  // ---------- 4. Workout ----------
  D('st-fitness-never-quit', 'fitness', 'Never quit (boxer)', 'متستسلمش (ملاكم)', [
    I(ai('workout-boxer-lineart'), 0.86, 0.5, 0.4),
    T('NEVER QUIT', 'Anton', 0.15, 0.5, 0.85),
  ]),
  D('st-fitness-mkammleen', 'fitness', 'Keep going (boxer, white ink)', 'مكمّلين (ملاكم)', [
    I(ai('workout-boxer-lineart-white'), 0.86, 0.5, 0.4),
    T('مكمّلين', 'Lalezar', 0.18, 0.5, 0.85, { fill: '#ffd43b' }),
  ], 'black'),
  D('st-fitness-stronger', 'fitness', 'Stronger every day', 'أقوى كل يوم', [
    I(ai('workout-dumbbell-arm'), 0.72, 0.5, 0.36),
    T('STRONGER', 'Anton', 0.15, 0.5, 0.76),
    T('EVERY DAY', 'Bebas Neue', 0.08, 0.5, 0.89, { fill: LIME, spacing: 400 }),
  ], 'black'),
  D('st-fitness-energy', 'fitness', 'Energy (lightning bolt)', 'طاقة', [
    I(vec('workout-lightning-bolt'), 0.58, 0.5, 0.3),
    T('ENERGY', 'Bungee', 0.15, 0.5, 0.64),
    T('طاقة', 'Lalezar', 0.15, 0.5, 0.82, { fill: YELLOW }),
  ], 'black'),
  D('st-fitness-lift-heavy', 'fitness', 'Lift heavy (kettlebell)', 'شيل تقيل', [
    I(vec('workout-kettlebell'), 0.48, 0.5, 0.3),
    T('LIFT', 'Anton', 0.2, 0.5, 0.66),
    T('HEAVY', 'Anton', 0.2, 0.5, 0.86, { fill: ACCENT }),
  ]),
  D('st-fitness-run', 'fitness', 'Run and don\'t look back', 'اجري ومتبصش وراك', [
    I(vec('workout-running-shoe'), 0.8, 0.5, 0.32),
    T('RUN', 'Bungee', 0.2, 0.5, 0.62),
    T('اجري ومتبصش وراك', 'Lalezar', 0.09, 0.5, 0.82),
  ]),
  D('st-fitness-gym-3elagy', 'fitness', 'The gym is my therapy (flexed arm)', 'الجيم علاجي', [
    I(ai('workout-dumbbell-arm'), 0.58, 0.5, 0.3),
    T('الجيم', 'Lalezar', 0.19, 0.5, 0.65),
    T('علاجي', 'Lalezar', 0.19, 0.5, 0.84, { fill: LIME }),
  ], 'black'),

  // ---------- 5. Gaming ----------
  D('st-gaming-level-up', 'gaming', 'Level up (pixel hero)', 'ليفل أب (بطل بكسل)', [
    I(vec('gaming-pixel-hero'), 0.58, 0.5, 0.35),
    T('LEVEL UP', 'Bungee', 0.15, 0.5, 0.75),
    T('PLAYER 1', 'Bungee', 0.06, 0.5, 0.88, { fill: '#ffd43b' }),
  ], 'black'),
  D('st-gaming-3-lives', 'gaming', '3 lives left and still playing', 'فاضل 3 أرواح ولسه بلعب', [
    I(vec('gaming-pixel-hearts'), 0.7, 0.5, 0.27),
    T('3 LIVES LEFT', 'Bungee', 0.1, 0.5, 0.5),
    T('ولسه بلعب', 'Lalezar', 0.14, 0.5, 0.7, { fill: '#ff6b6b' }),
  ], 'black'),
  D('st-gaming-game-on', 'gaming', 'Game on (neon controller)', 'جيم أون (دراع نيون)', [
    I(vec('gaming-neon-controller'), 0.8, 0.5, 0.37),
    T('GAME ON', 'Righteous', 0.16, 0.5, 0.76, { fill: '#a5f3fc', glow: CYAN }),
  ], 'black'),
  D('st-gaming-night-gamer', 'gaming', 'Night gamer (synthwave sunset)', 'جيمر بالليل (غروب سينث ويف)', [
    I(vec('gaming-synthwave-sunset'), 0.84, 0.5, 0.4),
    T('NIGHT GAMER', 'Bungee', 0.11, 0.5, 0.84, { fill: NEON_PINK }),
  ], 'black'),
  D('st-gaming-dor-kaman', 'gaming', 'Just one more round (pixel landscape)', 'بس دور كمان', [
    I(vec('gaming-pixel-landscape'), 0.86, 0.5, 0.38),
    T('بس دور كمان', 'Lalezar', 0.14, 0.5, 0.8),
  ]),
  D('st-gaming-tag', 'gaming', 'Gamer tag (with the name)', 'اسم الجيمر', [
    I(vec('gaming-pixel-hero'), 0.48, 0.5, 0.3),
    T('AHMED', 'Bungee', 0.14, 0.5, 0.66, { fill: '#ffd43b', sampleName: 'name' }),
    T('GAMER TAG', 'Bungee', 0.06, 0.5, 0.8),
  ], 'black'),
  D('st-gaming-mesh-ha2oum', 'gaming', 'Not getting up until I win', 'مش هقوم غير لما أكسب', [
    I(vec('gaming-neon-controller'), 0.68, 0.5, 0.33),
    T('مش هقوم', 'Lalezar', 0.16, 0.5, 0.68),
    T('غير لما أكسب', 'Marhey', 0.09, 0.5, 0.84, { fill: CYAN }),
  ], 'black'),

  D('st-gaming-esports', 'gaming', 'Esports team (name and number)', 'فريق إي سبورتس (اسم ورقم)', [
    I(vec('gaming-neon-controller'), 0.46, 0.5, 0.2),
    T('TEAM NAME', 'Bungee', 0.09, 0.5, 0.38, { fill: CYAN }),
    T('AHMED', 'Bungee', 0.14, 0.5, 0.53, { sampleName: 'name' }),
    T('07', 'Anton', 0.3, 0.5, 0.78, { fill: NEON_PINK }),
  ], 'black'),
  D('st-gaming-lvl-99', 'gaming', 'Level 99 (name and hearts)', 'ليفل 99 (بالاسم)', [
    T('LVL 99', 'Bungee', 0.17, 0.5, 0.3, { fill: '#ffd43b' }),
    I(vec('gaming-pixel-hearts'), 0.56, 0.5, 0.5),
    T('AHMED', 'Righteous', 0.13, 0.5, 0.7, { sampleName: 'name' }),
    T('MAX LEVEL PLAYER', 'Bebas Neue', 0.06, 0.5, 0.84, { spacing: 300 }),
  ], 'black'),
  D('st-gaming-ostoura', 'gaming', 'Gaming legend (with the name)', 'أسطورة الجيم (بالاسم)', [
    I(vec('gaming-pixel-hero'), 0.44, 0.5, 0.27),
    T('أسطورة الجيم', 'Lalezar', 0.15, 0.5, 0.6, { fill: '#ffd43b' }),
    T('أحمد', 'Lalezar', 0.12, 0.5, 0.78, { sampleName: 'name' }),
  ], 'black'),
  D('st-gaming-insert-coin', 'gaming', 'Insert coin (retro arcade)', 'حط فلوس (أركيد زمان)', [
    I(vec('gaming-synthwave-sunset'), 0.8, 0.5, 0.36),
    T('INSERT COIN', 'Bungee', 0.11, 0.5, 0.76, { fill: NEON_PINK }),
    T('ابدأ اللعب', 'Lalezar', 0.1, 0.5, 0.88, { fill: CYAN }),
  ], 'black'),

  // ---------- 6. Optical illusions ----------
  D('st-optical-spiral', 'optical', 'Don\'t stare (hypnotic spiral)', 'متبصش كتير (دوامة)', [
    I(vec('optical-hypnotic-spiral'), 0.8, 0.5, 0.41),
    T('DON\'T STARE', 'Bebas Neue', 0.11, 0.5, 0.87, { spacing: 300 }),
  ]),
  D('st-optical-bent', 'optical', 'Bent reality (3D checkerboard)', 'واقع مايل (شطرنج ثلاثي الأبعاد)', [
    I(vec('optical-bulge-checker'), 0.8, 0.5, 0.41),
    T('BENT REALITY', 'Bebas Neue', 0.1, 0.5, 0.87, { spacing: 300 }),
  ]),
  D('st-optical-impossible', 'optical', 'Impossible (Penrose triangle)', 'مستحيل (مثلث بنروز)', [
    I(vec('optical-impossible-triangle'), 0.74, 0.5, 0.38),
    T('IMPOSSIBLE', 'Bungee', 0.1, 0.5, 0.78),
    T('مفيش حاجة مستحيلة', 'Lalezar', 0.08, 0.5, 0.89, { fill: YELLOW }),
  ], 'black'),
  D('st-optical-dokha', 'optical', 'Dizzy (wave rings)', 'دوخة', [
    I(vec('optical-wave-rings'), 0.8, 0.5, 0.41),
    T('دوخة', 'Lalezar', 0.18, 0.5, 0.87, { fill: '#4c1d95' }),
  ]),
  D('st-optical-hex', 'optical', 'Look closer (hex tunnel)', 'بص أقرب (نفق سداسي)', [
    I(vec('optical-hex-tunnel'), 0.86, 0.5, 0.44),
    T('LOOK CLOSER', 'Montserrat', 0.06, 0.5, 0.92, { spacing: 500 }),
  ], 'black'),
  D('st-optical-bos-kwayes', 'optical', 'Look carefully', 'بص كويس', [
    I(vec('optical-hypnotic-spiral'), 0.68, 0.5, 0.36),
    T('بص كويس', 'Lalezar', 0.15, 0.5, 0.76),
    T('وإنت هتشوف', 'Marhey', 0.08, 0.5, 0.88, { fill: PINK }),
  ], 'black'),

  // ---------- 7. Comic strips & pop art ----------
  D('st-comic-boom', 'comic', 'Boom! (pop-art burst)', 'بووم! (بوب آرت)', [
    I(ai('comic-pop-burst'), 0.9, 0.5, 0.42),
    T('BOOM!', 'Bungee', 0.16, 0.5, 0.86, { fill: '#e03131' }),
  ]),
  D('st-comic-omg', 'comic', 'OMG! (pop-art girl)', 'يا خبر! (بنت بوب آرت)', [
    I(ai('comic-wink-girl'), 0.74, 0.5, 0.4),
    T('OMG!', 'Bungee', 0.15, 0.5, 0.84, { fill: '#e64980' }),
  ]),
  D('st-comic-robot', 'comic', 'Just a sensitive robot (comic strip)', 'مجرد روبوت حساس (كوميك)', [
    I(ai('comic-robot-strip'), 0.96, 0.5, 0.38),
    T('مجرد روبوت حساس', 'Lalezar', 0.11, 0.5, 0.62),
  ]),
  D('st-comic-ya-nhar', 'comic', 'Oh my day! (pop-art burst)', 'يا نهار!', [
    I(ai('comic-pop-burst'), 0.84, 0.5, 0.4),
    T('يا نهار!', 'Lalezar', 0.18, 0.5, 0.84, { fill: YELLOW }),
  ], 'black'),
  D('st-comic-2alby', 'comic', 'My heart got stolen (pop-art girl)', 'قلبي اتخطف', [
    I(ai('comic-wink-girl'), 0.7, 0.5, 0.38),
    T('قلبي اتخطف', 'Lalezar', 0.14, 0.5, 0.82, { fill: '#e64980' }),
  ], 'black'),
  D('st-comic-pow', 'comic', 'Pow! Superhero mode', 'باو! مود البطل الخارق', [
    I(ai('comic-pop-burst'), 0.62, 0.5, 0.3),
    T('POW!', 'Bungee', 0.2, 0.5, 0.64, { fill: YELLOW, extrude: '#e03131' }),
    T('superhero mode', 'Permanent Marker', 0.09, 0.5, 0.84),
  ]),

  // ---------- 8. Maximalism ----------
  D('st-maximal-more', 'maximal', 'More is more (collage face)', 'الكتير حلو (وش كولاج)', [
    I(ai('maximal-collage-face'), 0.84, 0.5, 0.43),
    T('MORE IS MORE', 'Bungee', 0.1, 0.5, 0.9, { fill: '#e64980' }),
  ]),
  D('st-maximal-y2k', 'maximal', 'Y2K sticker bomb', 'ستيكرات Y2K', [
    I(ai('maximal-y2k-stickerbomb'), 0.84, 0.5, 0.43),
    T('Y2K', 'Bungee', 0.16, 0.5, 0.89, { fill: PURPLE }),
  ]),
  D('st-maximal-far7a', 'maximal', 'Joy (dopamine flowers)', 'فرحة (ورد دوبامين)', [
    I(ai('maximal-dopamine-floral'), 0.84, 0.5, 0.43),
    T('فرحة', 'Lalezar', 0.19, 0.5, 0.89, { fill: ORANGE }),
  ], 'black'),
  D('st-maximal-kteer', 'maximal', 'Too much for you (collage face)', 'كتير عليك', [
    I(ai('maximal-collage-face'), 0.8, 0.5, 0.41),
    T('كتير عليك', 'Lalezar', 0.15, 0.5, 0.87, { fill: YELLOW }),
  ], 'black'),
  D('st-maximal-dopamine', 'maximal', 'Dopamine (layered)', 'دوبامين (طبقات)', [
    I(ai('maximal-dopamine-floral'), 0.66, 0.58, 0.47),
    I(vec('trends-y2k-sticker-set'), 0.42, 0.28, 0.24, { angle: -12 }),
    T('DOPAMINE', 'Bungee', 0.12, 0.5, 0.88, { fill: '#e64980' }),
  ]),
  D('st-maximal-bloom', 'maximal', 'Bloom loud', 'افرح بصوت عالي', [
    I(ai('maximal-dopamine-floral'), 0.78, 0.5, 0.4),
    T('Bloom Loud', 'Lobster', 0.14, 0.5, 0.85, { fill: '#d6336c' }),
  ]),

  // ---------- 9. Art-inspired (painted) ----------
  D('st-artsy-nouveau', 'artsy', 'Art Nouveau woman', 'سيدة آرت نوفو', [
    I(ai('art-nouveau-woman'), 0.74, 0.5, 0.44),
    T('Art Nouveau', 'Playfair Display', 0.09, 0.5, 0.91, { fill: '#8a5a2b' }),
  ], 'sand'),
  D('st-artsy-purrfect', 'artsy', 'Purrfect (watercolour cat)', 'بيرفكت (قطة ألوان مائية)', [
    I(ai('art-watercolour-cat'), 0.68, 0.5, 0.41),
    T('Purrfect', 'Dancing Script', 0.14, 0.5, 0.87, { fill: PURPLE }),
  ]),
  D('st-artsy-shams', 'artsy', 'Sun (oil-painted sunflower)', 'شمس (عباد شمس زيت)', [
    I(ai('art-oil-sunflower'), 0.68, 0.5, 0.41),
    T('شمس', 'Aref Ruqaa', 0.19, 0.5, 0.88, { fill: '#f59f00' }),
  ], 'black'),
  D('st-artsy-gamal', 'artsy', 'Beauty (Art Nouveau)', 'جمال (آرت نوفو)', [
    I(ai('art-nouveau-woman'), 0.7, 0.5, 0.42),
    T('جمال', 'Aref Ruqaa', 0.2, 0.5, 0.89, { fill: GOLD }),
  ], 'black'),
  D('st-artsy-otty', 'artsy', 'My sweet cat (watercolour)', 'قطتي حبيبتي (ألوان مائية)', [
    I(ai('art-watercolour-cat'), 0.64, 0.5, 0.4),
    T('قطتي حبيبتي', 'Aref Ruqaa', 0.13, 0.5, 0.86, { fill: PURPLE }),
  ]),
  D('st-artsy-grow', 'artsy', 'Grow through it (sunflower)', 'اكبر واتعلم (عباد شمس)', [
    I(ai('art-oil-sunflower'), 0.64, 0.5, 0.4),
    T('Grow through it', 'Dancing Script', 0.12, 0.5, 0.86, { fill: '#e8590c' }),
  ]),

  // ---------- 10. Uplifting messages ----------
  D('st-up-amazing', 'motivation', 'You\'re doing amazing (sun)', 'إنت عامل شغل حلو (شمس)', [
    I(vec('uplifting-hand-drawn-sun'), 0.42, 0.5, 0.24),
    T('You\'re doing', 'Pacifico', 0.11, 0.5, 0.55),
    T('amazing', 'Pacifico', 0.16, 0.5, 0.73, { fill: ORANGE }),
  ]),
  D('st-up-te2dar', 'motivation', 'You can do it, there\'s no one like you', 'إنت تقدر ومحدش زيك', [
    I(vec('uplifting-hearts-stars-cluster'), 0.6, 0.5, 0.27),
    T('إنت تقدر', 'Lalezar', 0.18, 0.5, 0.62),
    T('ومحدش زيك', 'Marhey', 0.1, 0.5, 0.8, { fill: PINK }),
  ]),
  D('st-up-keep-shining', 'motivation', 'Keep shining (rainbow)', 'خليك منوّر (قوس قزح)', [
    I(vec('uplifting-boho-rainbow'), 0.66, 0.5, 0.3),
    T('Keep Shining', 'Righteous', 0.13, 0.5, 0.64, { fill: '#c2410c' }),
  ]),
  D('st-up-be-you', 'motivation', 'Be you, do you, for you', 'خليك إنت', [
    T('Be you', 'Caveat', 0.15, 0.5, 0.28),
    T('Do you', 'Caveat', 0.15, 0.5, 0.46),
    T('For you', 'Caveat', 0.15, 0.5, 0.64),
    I(vec('uplifting-hearts-stars-cluster'), 0.32, 0.5, 0.86),
  ], 'sand'),
  D('st-up-bokra', 'motivation', 'Tomorrow is better, for sure', 'بكرة أحلى أكيد', [
    I(vec('uplifting-hand-drawn-sun'), 0.42, 0.5, 0.26),
    T('بكرة أحلى', 'Lalezar', 0.18, 0.5, 0.62, { fill: '#f59f00' }),
    T('أكيد', 'Marhey', 0.1, 0.5, 0.8),
  ]),
  D('st-up-kefaya', 'motivation', 'It\'s enough that you\'re here', 'كفاية إنك موجود', [
    I(vec('uplifting-boho-rainbow'), 0.6, 0.5, 0.28),
    T('كفاية إنك', 'Lalezar', 0.13, 0.5, 0.6),
    T('موجود', 'Lalezar', 0.18, 0.5, 0.78, { fill: '#c2410c' }),
  ]),
  D('st-up-stay-strong', 'motivation', 'Stay strong', 'خليك قوي', [
    T('STAY', 'Anton', 0.22, 0.5, 0.33),
    T('STRONG', 'Anton', 0.22, 0.5, 0.56, { fill: ORANGE }),
    I(vec('uplifting-hearts-stars-cluster'), 0.36, 0.5, 0.82),
  ], 'black'),

  // ---------- 11. Luxury look ----------
  D('st-luxury-atelier', 'luxury', 'Atelier (Bauhaus panel)', 'أتيليه (لوحة باوهاوس)', [
    I(vec('luxury-bauhaus-panel'), 0.52, 0.5, 0.4),
    T('ATELIER', 'Montserrat', 0.06, 0.5, 0.82, { spacing: 800 }),
  ], 'sand'),
  D('st-luxury-monogram', 'luxury', 'Monogram with a laurel (initial and name)', 'مونوجرام بإكليل (حرف واسم)', [
    I(vec('luxury-monogram-laurel-frame'), 0.68, 0.5, 0.4),
    T('S', 'Playfair Display', 0.3, 0.5, 0.39, { fill: GOLD, sampleName: 'initial' }),
    T('SARA', 'Montserrat', 0.05, 0.5, 0.76, { spacing: 800, fill: GOLD, sampleName: 'name' }),
  ], 'black'),
  D('st-luxury-aneek', 'luxury', 'Elegant (fine laurel wreath)', 'أنيق (إكليل رفيع)', [
    I(vec('luxury-fine-laurel-wreath'), 0.68, 0.5, 0.42),
    T('أنيق', 'Aref Ruqaa', 0.18, 0.5, 0.4, { fill: GOLD }),
  ], 'black'),
  D('st-luxury-nour', 'luxury', 'Nour (crescent and star)', 'نور (هلال ونجمة)', [
    I(vec('luxury-crescent-star'), 0.4, 0.5, 0.3),
    T('نور', 'El Messiri', 0.16, 0.5, 0.64, { fill: GOLD }),
    T('NOUR', 'Montserrat', 0.045, 0.5, 0.79, { spacing: 800, fill: GOLD }),
  ], 'black'),
  D('st-luxury-essentials', 'luxury', 'Essentials (minimal)', 'إسنشالز (بسيط)', [
    T('ESSENTIALS', 'Montserrat', 0.07, 0.5, 0.44, { spacing: 900 }),
    S('line', 0.26, 0.5, 0.53, { fill: GOLD }),
    T('EST. 2026', 'Montserrat', 0.035, 0.5, 0.61, { spacing: 500 }),
  ]),
  D('st-luxury-basata', 'luxury', 'Simplicity (Bauhaus panel)', 'بساطة (لوحة باوهاوس)', [
    I(vec('luxury-bauhaus-panel'), 0.48, 0.5, 0.38),
    T('بساطة', 'El Messiri', 0.12, 0.5, 0.8),
  ], 'black'),
  D('st-luxury-mono-ar', 'luxury', 'Arabic monogram (initial and name)', 'مونوجرام عربي (حرف واسم)', [
    I(vec('luxury-monogram-laurel-frame'), 0.68, 0.5, 0.4),
    T('م', 'Aref Ruqaa', 0.28, 0.5, 0.37, { fill: GOLD, sampleName: 'initial' }),
    T('محمد', 'El Messiri', 0.07, 0.5, 0.76, { sampleName: 'name' }),
  ]),

  // ---------- 12. Music ----------
  D('st-music-now-playing', 'music', 'Now playing (vinyl)', 'شغّال دلوقتي (أسطوانة)', [
    I(vec('music-vinyl-record'), 0.68, 0.5, 0.37),
    T('NOW PLAYING', 'Bebas Neue', 0.12, 0.5, 0.79, { spacing: 300 }),
  ]),
  D('st-music-mazika', 'music', 'Music and that\'s it (headphones)', 'مزيكا وبس (سماعات)', [
    I(vec('music-headphones-mic'), 0.6, 0.5, 0.37),
    T('مزيكا وبس', 'Lalezar', 0.16, 0.5, 0.78, { fill: '#f06595' }),
  ]),
  D('st-music-turn-up', 'music', 'Turn it up (equaliser)', 'علّي الصوت (إكولايزر)', [
    I(vec('music-equalizer'), 0.8, 0.5, 0.34),
    T('TURN IT UP', 'Bungee', 0.12, 0.5, 0.7),
    T('علّي الصوت', 'Lalezar', 0.12, 0.5, 0.86, { fill: CYAN }),
  ], 'black'),
  D('st-music-2albak', 'music', 'Listen to your heart (notes)', 'اسمع قلبك (نوتة)', [
    I(vec('music-notes-ribbon'), 0.9, 0.5, 0.35),
    T('اسمع قلبك', 'Aref Ruqaa', 0.15, 0.5, 0.7, { fill: PURPLE }),
  ]),
  D('st-music-tarab', 'music', 'Classic tarab (vinyl)', 'الطرب أصول (أسطوانة)', [
    I(vec('music-vinyl-record'), 0.58, 0.5, 0.34),
    T('الطرب', 'Lalezar', 0.18, 0.5, 0.72, { fill: GOLD }),
    T('أصول', 'Marhey', 0.1, 0.5, 0.87),
  ], 'black'),
  D('st-music-therapy', 'music', 'Music is my therapy', 'المزيكا علاجي', [
    T('Music', 'Pacifico', 0.16, 0.5, 0.33),
    T('is my therapy', 'Pacifico', 0.1, 0.5, 0.51, { fill: PURPLE }),
    I(vec('music-equalizer'), 0.6, 0.5, 0.76),
  ]),

  // ---------- 13. Trends & pop culture (Egyptian internet slang) ----------
  D('st-trends-seen', 'trends', 'Seen and didn\'t reply (chat bubbles)', 'سين ومردتش (شات)', [
    I(vec('trends-chat-bubbles'), 0.68, 0.5, 0.38),
    T('سين ومردتش', 'Lalezar', 0.14, 0.5, 0.82, { fill: PURPLE }),
  ]),
  D('st-trends-mood', 'trends', 'Today\'s mood (Y2K stickers)', 'مود النهارده (ستيكرات)', [
    I(vec('trends-y2k-sticker-set'), 0.7, 0.5, 0.37),
    T('مود النهارده', 'Lalezar', 0.15, 0.5, 0.8, { fill: '#b197fc' }),
  ], 'black'),
  D('st-trends-delulu', 'trends', 'Delulu is the solulu', 'ديلولو', [
    T('delulu', 'Pacifico', 0.2, 0.5, 0.38, { fill: '#e64980' }),
    T('is the solulu', 'Pacifico', 0.1, 0.5, 0.57),
    I(vec('uplifting-hearts-stars-cluster'), 0.4, 0.5, 0.8),
  ]),
  D('st-trends-red-carpet', 'trends', 'Not a red flag, a red carpet', 'أنا مش ريد فلاج', [
    T('أنا مش', 'Lalezar', 0.14, 0.5, 0.3),
    T('ريد فلاج', 'Lalezar', 0.2, 0.5, 0.5, { fill: '#e03131' }),
    T('أنا ريد كاربت', 'Marhey', 0.1, 0.5, 0.72, { fill: '#c92a2a' }),
  ]),
  D('st-trends-main-character', 'trends', 'Main character energy', 'طاقة البطل', [
    T('MAIN', 'Anton', 0.22, 0.5, 0.32),
    T('CHARACTER', 'Anton', 0.13, 0.5, 0.5, { fill: '#e64980' }),
    T('ENERGY', 'Bebas Neue', 0.09, 0.5, 0.64, { spacing: 500 }),
    I(vec('trends-y2k-sticker-set'), 0.3, 0.5, 0.85),
  ], 'black'),
  D('st-trends-left-on-read', 'trends', 'Left on read (chat bubbles)', 'ليفت أون ريد (شات)', [
    I(vec('trends-chat-bubbles'), 0.64, 0.5, 0.37),
    T('Left on read', 'Permanent Marker', 0.12, 0.5, 0.82),
  ]),
  D('st-trends-3ady', 'trends', 'Normal, I mean', 'عادي يعني', [
    T('عادي', 'Lalezar', 0.26, 0.5, 0.38),
    T('يعني', 'Marhey', 0.12, 0.5, 0.6, { fill: ACCENT }),
    I(vec('trends-chat-bubbles'), 0.3, 0.5, 0.84),
  ]),
];

module.exports = { categories, designs };
