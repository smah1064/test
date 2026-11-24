'use strict';
// Everyday pack: funny Egyptian phrases, Egypt, friends and family designs.
const { T, S, K, A, D, ACCENT, GOLD, GREEN, PINK, BLUE, PURPLE, TEAL, RED } = require('../library-dsl');

const CREAM = '#f8f1e3';
const WHITE = '#ffffff';
const INK = '#16181d';

const categories = [{ id: 'friends', name: { en: 'Friends', ar: 'أصحاب' } }];

// Fine-tuning the family subject's products (src/library.js FITS): the designs a child or baby wears.
const LITTLE = { alsoProducts: ['kidstee', 'kidshoodie', 'onesie'] };
// A gift for mum, dad or the grandparents also on a prayer mat.
const MAT = { alsoProducts: ['prayermat'] };

const designs = [
  // ---------- Funny Egyptian phrases ----------
  D('ev-nayem', 'funny', 'Asleep even when awake', 'نايم وأنا صاحي', [
    A('fluent-emoji-flat:sleeping-face', 0.3, 0.5, 0.22),
    T('نايم', 'Lalezar', 0.32, 0.5, 0.54),
    T('حتى وأنا صاحي', 'Marhey', 0.12, 0.5, 0.78, { fill: BLUE, weight: 'bold' }),
  ]),
  D('ev-5-minutes', 'funny', 'Five more minutes', 'خمس دقايق كمان', [
    A('fluent-emoji-flat:alarm-clock', 0.28, 0.5, 0.2),
    T('خمس دقايق', 'Lalezar', 0.22, 0.5, 0.5),
    T('كمان بس', 'Lalezar', 0.22, 0.5, 0.7, { fill: ACCENT }),
    T('FIVE MORE MINUTES', 'Bebas Neue', 0.06, 0.5, 0.88, { spacing: 200 }),
  ], 'heather'),
  D('ev-akkelny', 'funny', 'Feed me then talk to me', 'أكّلني وبعدين كلّمني', [
    A('fluent-emoji-flat:falafel', 0.3, 0.5, 0.2),
    T('أكّلني', 'Lalezar', 0.28, 0.5, 0.5),
    T('وبعدين كلّمني', 'Marhey', 0.13, 0.5, 0.76, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('ev-3asaby-ga3an', 'funny', 'Not angry, just hungry', 'مش عصبي أنا جعان', [
    T('أنا مش عصبي', 'Changa', 0.11, 0.5, 0.2, { weight: 'bold' }),
    T('أنا بس', 'Lalezar', 0.14, 0.5, 0.36),
    T('جعان', 'Jomhuria', 0.48, 0.5, 0.64, { fill: GOLD }),
  ], 'black'),
  D('ev-ta3meya', 'funny', 'Falafel is my true love', 'الطعمية حب حياتي', [
    T('حب حياتي', 'Aref Ruqaa', 0.14, 0.5, 0.2, { weight: 'bold', fill: RED }),
    A('fluent-emoji-flat:falafel', 0.34, 0.5, 0.46),
    T('الطعمية', 'Lalezar', 0.24, 0.5, 0.76, { fill: GREEN }),
  ], 'sand'),
  D('ev-diet-bokra', 'funny', 'Diet starts tomorrow', 'الدايت من بكرة', [
    A('fluent-emoji-flat:pizza', 0.28, 0.5, 0.2),
    T('الدايت', 'Lalezar', 0.3, 0.5, 0.5),
    T('  يبدأ من بكرة  ', 'Lemonada', 0.1, 0.5, 0.74, { weight: 'bold', fill: WHITE, bg: ACCENT, bgShape: 'banner' }),
  ]),
  D('ev-fel-sekka', 'funny', 'On my way (still dressing)', 'أنا في السكة', [
    A('fluent-emoji-flat:automobile', 0.3, 0.5, 0.2),
    T('أنا في السكة', 'Lalezar', 0.2, 0.5, 0.5),
    T('(لسه بلبس)', 'Marhey', 0.12, 0.5, 0.72, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('ev-za7ma', 'funny', 'Blame the traffic', 'الزحمة هي السبب', [
    A('fluent-emoji-flat:vertical-traffic-light', 0.4, 0.5, 0.24),
    T('مش أنا اللي اتأخرت', 'Changa', 0.09, 0.5, 0.5, { weight: 'bold' }),
    T('دي الزحمة', 'Lalezar', 0.24, 0.5, 0.7, { fill: GOLD }),
  ], 'black'),
  D('ev-mfalles', 'funny', 'Broke but happy', 'مفلّس بس مبسوط', [
    A('fluent-emoji-flat:money-with-wings', 0.3, 0.5, 0.2),
    T('مفلّس', 'Lalezar', 0.3, 0.5, 0.5),
    T('بس مبسوط', 'Marhey', 0.15, 0.5, 0.76, { fill: GREEN, weight: 'bold' }),
  ]),
  D('ev-morattab', 'funny', 'Salary vanishes', 'المرتب بيخلص', [
    T('المرتب', 'Jomhuria', 0.48, 0.5, 0.34, { fill: GREEN }),
    T('بيخلص قبل ما ينزل', 'Changa', 0.1, 0.5, 0.62, { weight: 'bold' }),
    A('fluent-emoji-flat:money-with-wings', 0.18, 0.5, 0.82),
  ], 'navy'),
  D('ev-shay', 'funny', 'Tea fixes everything', 'كوباية شاي تحل أي مشكلة', [
    A('fluent-emoji-flat:hot-beverage', 0.3, 0.5, 0.2),
    T('كوباية شاي', 'Lalezar', 0.2, 0.5, 0.5),
    T('تحل أي مشكلة', 'Aref Ruqaa', 0.14, 0.5, 0.72, { weight: 'bold', fill: '#b5651d' }),
  ], 'sand'),
  D('ev-mazbout', 'funny', 'Mood: just right (coffee)', 'مزاجي مظبوط', [
    S('circle', 0.5, 0.5, 0.3, { fill: '#6f4e37' }),
    A('tabler:coffee', 0.26, 0.5, 0.3, { fill: CREAM }),
    T('مزاجي', 'Changa', 0.12, 0.5, 0.62, { weight: 'bold' }),
    T('مظبوط', 'Lalezar', 0.26, 0.5, 0.8, { fill: GOLD }),
  ], 'black'),
  D('ev-emte7anat', 'funny', 'Exams: God help us', 'الامتحانات ربنا يستر', [
    A('fluent-emoji-flat:books', 0.28, 0.5, 0.2),
    T('الامتحانات', 'Lalezar', 0.2, 0.5, 0.5),
    T('ربنا يسترها', 'Marhey', 0.14, 0.5, 0.72, { fill: PURPLE, weight: 'bold' }),
  ]),
  D('ev-leilet-emte7an', 'funny', 'Whole syllabus in one night', 'المنهج كله في ليلة', [
    T('ذاكرت المنهج كله', 'Changa', 0.1, 0.5, 0.22, { weight: 'bold' }),
    T('في ليلة', 'Lalezar', 0.28, 0.5, 0.46, { fill: GOLD }),
    A('fluent-emoji-flat:night-with-stars', 0.26, 0.5, 0.76),
  ], 'navy'),
  D('ev-khamees', 'funny', 'Thursday best day', 'الخميس أحلى يوم', [
    T('يوم', 'Changa', 0.1, 0.5, 0.18, { weight: 'bold' }),
    T('الخميس', 'Lalezar', 0.32, 0.5, 0.42, { fill: ACCENT, extrude: INK }),
    T('أحلى يوم في الأسبوع', 'Marhey', 0.09, 0.5, 0.68, { weight: 'bold' }),
    A('fluent-emoji-flat:partying-face', 0.18, 0.5, 0.86),
  ]),
  D('ev-agaza', 'funny', 'Day off, no work talk', 'النهارده أجازة', [
    A('fluent-emoji-flat:beach-with-umbrella', 0.3, 0.5, 0.2),
    T('النهارده أجازة', 'Lalezar', 0.17, 0.5, 0.48),
    T('متكلمنيش في الشغل', 'Changa', 0.09, 0.5, 0.68, { weight: 'bold', fill: WHITE, bg: TEAL, bgShape: 'pill' }),
  ]),
  D('ev-social-battery', 'funny', 'Social battery 5%', 'طاقتي الاجتماعية ٥٪', [
    A('fluent-emoji-flat:low-battery', 0.3, 0.5, 0.2),
    T('5%', 'Anton', 0.3, 0.5, 0.48, { fill: RED }),
    T('SOCIAL BATTERY', 'Bebas Neue', 0.1, 0.5, 0.68, { spacing: 150 }),
    T('طاقتي خلصت', 'Marhey', 0.09, 0.5, 0.84, { weight: 'bold' }),
  ], 'black'),
  D('ev-kollo-tamam', 'funny', 'All good (almost)', 'كله تمام تقريبًا', [
    A('fluent-emoji-flat:grinning-face-with-sweat', 0.3, 0.5, 0.2),
    T('كله تمام', 'Lalezar', 0.24, 0.5, 0.5),
    T('تقريبًا', 'Marhey', 0.13, 0.5, 0.72, { fill: ACCENT, weight: 'bold' }),
  ], 'heather'),
  D('ev-demaghy', 'funny', 'My brain never switches off', 'دماغي مبتفصلش', [
    A('fluent-emoji-flat:exploding-head', 0.3, 0.5, 0.2),
    T('دماغي', 'Lalezar', 0.28, 0.5, 0.5),
    T('مبتفصلش', 'Lalezar', 0.2, 0.5, 0.74, { fill: PURPLE }),
  ]),
  D('ev-3addeeha', 'funny', 'Let it go', 'عدّيها', [
    T('عدّيها', 'Aref Ruqaa', 0.34, 0.5, 0.4, { weight: 'bold', fill: GOLD }),
    T('الدنيا مش مستاهلة', 'Changa', 0.1, 0.5, 0.66, { weight: 'bold' }),
  ], 'black'),
  D('ev-ma3lesh', 'funny', 'Ma3lesh fixes all', 'معلش', [
    T('معلش', 'Jomhuria', 0.66, 0.5, 0.4, { fill: TEAL }),
    T('كلمة بتحل كل حاجة', 'Marhey', 0.1, 0.5, 0.72, { weight: 'bold' }),
  ]),
  D('ev-sahran', 'funny', 'Up all night (neon)', 'سهران', [
    A('fluent-emoji-flat:crescent-moon', 0.24, 0.5, 0.2),
    T('سهران', 'Lalezar', 0.3, 0.5, 0.5, { fill: '#e7f5ff', glow: BLUE }),
    T('والصبح نايم', 'Marhey', 0.12, 0.5, 0.74, { fill: PINK, weight: 'bold', glow: PINK }),
  ], 'black'),

  // ---------- Egypt ----------
  D('ev-om-el-donya', 'egypt', 'Egypt mother of the world', 'مصر أم الدنيا', [
    K('pyramids', 0.46, 0.5, 0.24),
    T('مصر', 'Lalezar', 0.4, 0.5, 0.56),
    T('  أم الدنيا  ', 'Lemonada', 0.11, 0.5, 0.83, { weight: 'bold', fill: WHITE, bg: '#8b5e1a', bgShape: 'banner' }),
  ], 'sand'),
  D('ev-alex', 'egypt', 'Alexandria', 'إسكندرية', [
    A('fluent-emoji-flat:sailboat', 0.28, 0.5, 0.18),
    T('ALEX', 'Anton', 0.3, 0.5, 0.44, { fill: WHITE }),
    T('إسكندرية', 'Aref Ruqaa', 0.16, 0.5, 0.66, { weight: 'bold', fill: '#74c0fc' }),
    T('عروس البحر المتوسط', 'Changa', 0.07, 0.5, 0.84, { weight: 'bold', fill: WHITE }),
  ], 'navy'),
  D('ev-aswan', 'egypt', 'Aswan sun badge', 'أسوان', [
    S('circle', 0.72, 0.5, 0.42, { fill: '#d9480f' }),
    K('sun', 0.2, 0.5, 0.24),
    T('أسوان', 'Lalezar', 0.2, 0.5, 0.46, { fill: CREAM }),
    T('ASWAN', 'Montserrat', 0.07, 0.5, 0.6, { weight: 'bold', spacing: 300, fill: CREAM }),
    T('أحلى شمس في الدنيا', 'Marhey', 0.08, 0.5, 0.88, { weight: 'bold' }),
  ], 'sand'),
  D('ev-luxor', 'egypt', 'Luxor gold', 'الأقصر', [
    K('ankh', 0.18, 0.5, 0.18),
    T('الأقصر', 'Reem Kufi', 0.22, 0.5, 0.46, { weight: 'bold', fill: GOLD }),
    T('LUXOR', 'Playfair Display', 0.1, 0.5, 0.64, { spacing: 300 }),
    S('line', 0.4, 0.5, 0.76, { fill: GOLD }),
    T('مدينة المية باب', 'Changa', 0.07, 0.5, 0.86, { weight: 'bold', fill: GOLD }),
  ], 'black'),
  D('ev-cairo-neon', 'egypt', 'Cairo never sleeps (neon)', 'القاهرة مبتنامش', [
    T('القاهرة', 'Lalezar', 0.26, 0.5, 0.32, { fill: '#fff0f6', glow: PINK }),
    T('مبتنامش', 'Lalezar', 0.2, 0.5, 0.56, { fill: '#e3fafc', glow: '#15aabf' }),
    T('CAIRO NEVER SLEEPS', 'Bebas Neue', 0.07, 0.5, 0.78, { spacing: 200, fill: GOLD }),
  ], 'black'),
  D('ev-gada3', 'egypt', 'Gada3 slang type', 'جدع', [
    T('جدع', 'Jomhuria', 0.56, 0.5, 0.36, { fill: ACCENT, extrude: '#7a2e0e' }),
    T('GADA3', 'Bungee', 0.1, 0.5, 0.68),
    T('ابن بلد وقلبه أبيض', 'Changa', 0.08, 0.5, 0.82, { weight: 'bold' }),
  ], 'sand'),
  D('ev-fol', 'egypt', 'Fol el fol (feeling great)', 'فل الفل', [
    A('fluent-emoji-flat:white-flower', 0.26, 0.5, 0.2),
    T('فل', 'Lalezar', 0.46, 0.5, 0.48),
    T('الفل', 'Aref Ruqaa', 0.18, 0.5, 0.76, { weight: 'bold', fill: GREEN }),
  ]),
  D('ev-pharaohs', 'egypt', 'Descendant of the pharaohs', 'من نسل الفراعنة', [
    K('eye', 0.3, 0.5, 0.18),
    T('من نسل', 'Changa', 0.11, 0.5, 0.4, { weight: 'bold', fill: CREAM }),
    T('الفراعنة', 'Reem Kufi', 0.2, 0.5, 0.58, { weight: 'bold', fill: GOLD }),
    S('line', 0.36, 0.5, 0.7, { fill: GOLD }),
    T('SONS OF PHARAOHS', 'Bebas Neue', 0.07, 0.5, 0.82, { spacing: 200, fill: CREAM }),
  ], 'black'),
  D('ev-nile', 'egypt', 'Drink from the Nile', 'اللي يشرب من النيل', [
    K('lotus', 0.28, 0.5, 0.2),
    T('اللي يشرب من النيل', 'Aref Ruqaa', 0.12, 0.5, 0.46, { weight: 'bold' }),
    T('لازم يرجعله', 'Aref Ruqaa', 0.16, 0.5, 0.66, { weight: 'bold', fill: BLUE }),
    A('fluent-emoji-flat:water-wave', 0.2, 0.5, 0.86),
  ]),
  D('ev-egypt-retro', 'egypt', 'Retro Egypt 3D', 'مصر ريترو', [
    K('sun', 0.3, 0.5, 0.2),
    T('EGYPT', 'Bungee', 0.24, 0.5, 0.5, { fill: '#f08c00', extrude: '#862e9c' }),
    T('مصر', 'Lalezar', 0.2, 0.5, 0.74, { fill: '#862e9c' }),
  ], 'sand'),

  // ---------- Friends ----------
  D('ev-el-shella', 'friends', 'The gang', 'الشلة', [
    A('tabler:friends', 0.3, 0.5, 0.2, { fill: ACCENT }),
    T('الشلة', 'Lalezar', 0.4, 0.5, 0.5),
    T('مع بعض في أي حتة', 'Marhey', 0.1, 0.5, 0.76, { weight: 'bold', fill: ACCENT }),
  ]),
  D('ev-sa7by-akhoya', 'friends', 'My friend, my brother', 'صاحبي أخويا', [
    T('صاحبي', 'Lalezar', 0.34, 0.5, 0.34, { fill: GOLD }),
    T('أخويا اللي', 'Changa', 0.11, 0.5, 0.58, { weight: 'bold' }),
    T('أمي مخلفتهوش', 'Changa', 0.11, 0.5, 0.72, { weight: 'bold' }),
  ], 'black'),
  D('ev-bff-best', 'friends', 'Best (matching pair 1)', 'Best توأم 1', [
    S('heart', 0.42, 0.5, 0.3, { fill: PINK }),
    T('BEST', 'Anton', 0.34, 0.5, 0.66),
    T('توأم روحي ١', 'Marhey', 0.08, 0.5, 0.86, { weight: 'bold', fill: PINK }),
  ]),
  D('ev-bff-friends', 'friends', 'Friends (matching pair 2)', 'Friends توأم 2', [
    S('heart', 0.42, 0.5, 0.3, { fill: PINK }),
    T('FRIENDS', 'Anton', 0.24, 0.5, 0.66),
    T('توأم روحي ٢', 'Marhey', 0.08, 0.5, 0.86, { weight: 'bold', fill: PINK }),
  ]),
  D('ev-masayeb', 'friends', 'Partners in trouble', 'شريكي في المصايب', [
    A('fluent-emoji-flat:handshake', 0.3, 0.5, 0.2),
    T('شريكي', 'Lalezar', 0.28, 0.5, 0.48),
    T('في المصايب', 'Lalezar', 0.18, 0.5, 0.7, { fill: ACCENT }),
    T('PARTNERS IN CRIME', 'Bebas Neue', 0.06, 0.5, 0.87, { spacing: 200 }),
  ], 'heather'),
  D('ev-shella-trip', 'friends', 'Friends trip (place & year)', 'رحلة الشلة', [
    A('fluent-emoji-flat:beach-with-umbrella', 0.3, 0.5, 0.2),
    T('رحلة الشلة', 'Lalezar', 0.2, 0.5, 0.48),
    T('  دهب ٢٠٢٥  ', 'Lemonada', 0.1, 0.5, 0.68, { weight: 'bold', fill: WHITE, bg: TEAL, bgShape: 'ticket' }),
    T('FRIENDS TRIP', 'Montserrat', 0.06, 0.5, 0.86, { weight: 'bold', spacing: 300 }),
  ]),
  D('ev-squad-est', 'friends', 'The squad est. year', 'The Squad من سنة', [
    S('ring', 0.8, 0.5, 0.46, { fill: GOLD }),
    T('THE', 'Montserrat', 0.06, 0.5, 0.28, { weight: 'bold', spacing: 300, fill: GOLD }),
    T('SQUAD', 'Bungee', 0.16, 0.5, 0.44),
    T('EST. 2015', 'Oswald', 0.07, 0.5, 0.6, { spacing: 200, fill: GOLD }),
    T('صحاب من زمان', 'Marhey', 0.08, 0.5, 0.92, { weight: 'bold' }),
  ], 'navy'),
  D('ev-so7ab-el-3omr', 'friends', 'Lifelong friends', 'صحاب العمر', [
    A('fluent-emoji-flat:people-hugging', 0.3, 0.5, 0.2),
    T('صحاب العمر', 'El Messiri', 0.2, 0.5, 0.48, { weight: 'bold' }),
    T('مهما الأيام تعدّي', 'Changa', 0.09, 0.5, 0.68, { weight: 'bold', fill: PURPLE }),
  ], 'white'),
  D('ev-maa-el-magnoun', 'friends', 'I\'m with this crazy one', 'أنا مع المجنون ده', [
    T('أنا مع', 'Lalezar', 0.2, 0.5, 0.3),
    T('المجنون ده', 'Lalezar', 0.2, 0.5, 0.52, { fill: ACCENT }),
    A('tabler:arrow-right', 0.3, 0.5, 0.78, { fill: ACCENT }),
  ]),
  D('ev-ana-el-magnoun', 'friends', 'I\'m the crazy one', 'أنا المجنون', [
    T('أنا', 'Lalezar', 0.2, 0.5, 0.3),
    T('المجنون', 'Lalezar', 0.26, 0.5, 0.52, { fill: ACCENT }),
    T('اللي بيتكلموا عليه', 'Marhey', 0.08, 0.5, 0.76, { weight: 'bold' }),
  ]),
  D('ev-a3da-7elwa', 'friends', 'Good times with friends', 'القعدة الحلوة', [
    A('fluent-emoji-flat:teapot', 0.3, 0.42, 0.22),
    A('fluent-emoji-flat:hot-beverage', 0.2, 0.64, 0.25),
    T('القعدة الحلوة', 'Lalezar', 0.18, 0.5, 0.5),
    T('مع الصحاب', 'Aref Ruqaa', 0.15, 0.5, 0.7, { weight: 'bold', fill: '#b5651d' }),
  ], 'sand'),
  D('ev-friends-forever', 'friends', 'Friends forever', 'صحاب للأبد', [
    T('Friends', 'Pacifico', 0.18, 0.5, 0.3, { fill: TEAL }),
    T('forever', 'Dancing Script', 0.13, 0.5, 0.48, { weight: 'bold' }),
    S('heart', 0.1, 0.5, 0.62, { fill: PINK }),
    T('صحاب للأبد', 'Marhey', 0.11, 0.5, 0.78, { weight: 'bold', fill: TEAL }),
  ]),

  // ---------- Family ----------
  D('ev-fam-dad', 'family', 'Family set: Dad', 'طقم العيلة: بابا', [
    T('عيلة المصري', 'Changa', 0.08, 0.5, 0.14, { weight: 'bold', fill: GOLD }),
    K('crown', 0.22, 0.5, 0.3),
    T('بابا', 'Lalezar', 0.34, 0.5, 0.56),
    T('  كبير العيلة  ', 'Lemonada', 0.1, 0.5, 0.8, { weight: 'bold', fill: WHITE, bg: BLUE, bgShape: 'banner' }),
  ]),
  D('ev-fam-mum', 'family', 'Family set: Mum', 'طقم العيلة: ماما', [
    T('عيلة المصري', 'Changa', 0.08, 0.5, 0.14, { weight: 'bold', fill: GOLD }),
    K('heart', 0.22, 0.5, 0.3),
    T('ماما', 'Lalezar', 0.34, 0.5, 0.56),
    T('  قلب العيلة  ', 'Lemonada', 0.1, 0.5, 0.8, { weight: 'bold', fill: WHITE, bg: PINK, bgShape: 'banner' }),
  ]),
  D('ev-fam-son', 'family', 'Family set: Son', 'طقم العيلة: الابن', [
    T('عيلة المصري', 'Changa', 0.08, 0.5, 0.14, { weight: 'bold', fill: GOLD }),
    K('bolt', 0.2, 0.5, 0.3),
    T('البطل', 'Lalezar', 0.3, 0.5, 0.56),
    T('  سند العيلة  ', 'Lemonada', 0.1, 0.5, 0.8, { weight: 'bold', fill: WHITE, bg: TEAL, bgShape: 'banner' }),
  ], 'white', LITTLE),
  D('ev-fam-daughter', 'family', 'Family set: Daughter', 'طقم العيلة: البنت', [
    T('عيلة المصري', 'Changa', 0.08, 0.5, 0.14, { weight: 'bold', fill: GOLD }),
    K('sparkle', 0.2, 0.5, 0.3),
    T('الأميرة', 'Lalezar', 0.28, 0.5, 0.56),
    T('  دلّوعة العيلة  ', 'Lemonada', 0.1, 0.5, 0.8, { weight: 'bold', fill: WHITE, bg: PURPLE, bgShape: 'banner' }),
  ], 'white', LITTLE),
  D('ev-family-first', 'family', 'Family first', 'العيلة أولًا', [
    A('fluent-emoji-flat:house-with-garden', 0.3, 0.5, 0.2),
    T('العيلة أولًا', 'Lalezar', 0.2, 0.5, 0.5),
    T('FAMILY FIRST', 'Montserrat', 0.07, 0.5, 0.68, { weight: 'bold', spacing: 300, fill: GREEN }),
  ], 'white', LITTLE),
  D('ev-gedo', 'family', 'Grandpa our blessing', 'جدو بركتنا', [
    A('fluent-emoji-flat:old-man', 0.3, 0.5, 0.2),
    T('جدو', 'Lalezar', 0.34, 0.5, 0.5),
    T('كبيرنا وبركتنا', 'El Messiri', 0.12, 0.5, 0.74, { weight: 'bold', fill: GOLD }),
  ], 'navy', MAT),
  D('ev-tita', 'family', 'Nothing beats grandma\'s cooking', 'أكل تيتة', [
    A('fluent-emoji-flat:old-woman', 0.28, 0.5, 0.18),
    T('مفيش أحلى من', 'Changa', 0.1, 0.5, 0.42, { weight: 'bold' }),
    T('أكل تيتة', 'Lalezar', 0.24, 0.5, 0.62, { fill: ACCENT }),
    A('fluent-emoji-flat:shallow-pan-of-food', 0.2, 0.5, 0.85),
  ]),
  D('ev-ekhwat', 'family', 'Siblings: fight daily, love forever', 'إخوات', [
    T('إخوات', 'Jomhuria', 0.46, 0.5, 0.3, { fill: TEAL }),
    T('خناق كل يوم', 'Changa', 0.1, 0.5, 0.6, { weight: 'bold' }),
    T('وحب العمر كله', 'Changa', 0.1, 0.5, 0.74, { weight: 'bold', fill: PINK }),
    S('heart', 0.1, 0.5, 0.88, { fill: PINK }),
  ], 'white', LITTLE),
  D('ev-set-el-kol', 'family', 'Mum the queen of all', 'ست الكل', [
    S('heart', 0.56, 0.5, 0.36, { fill: RED }),
    T('ماما', 'Lalezar', 0.16, 0.5, 0.34, { fill: WHITE }),
    T('ست الكل', 'El Messiri', 0.2, 0.5, 0.74, { weight: 'bold', fill: RED }),
  ], 'white', MAT),
  D('ev-baba-sanad', 'family', 'Dad my rock', 'بابا سندي', [
    S('shield', 0.5, 0.5, 0.36, { fill: BLUE }),
    T('بابا', 'Lalezar', 0.16, 0.5, 0.34, { fill: WHITE }),
    T('سندي وضهري', 'Lalezar', 0.16, 0.5, 0.78),
    T('HAPPY FATHER\'S DAY', 'Bebas Neue', 0.05, 0.5, 0.91, { spacing: 200, fill: BLUE }),
  ], 'heather', MAT),
  D('ev-a9ghar-wa7ed', 'family', 'Newest family member', 'أصغر واحد في العيلة', [
    A('fluent-emoji-flat:baby', 0.3, 0.5, 0.2),
    T('أصغر واحد', 'Lalezar', 0.2, 0.5, 0.48),
    T('في العيلة', 'Marhey', 0.14, 0.5, 0.68, { weight: 'bold', fill: PINK }),
    T('سليم 2025', 'Changa', 0.07, 0.5, 0.86, { weight: 'bold', fill: BLUE }),
  ], 'white', LITTLE),
];

module.exports = { categories, designs };
