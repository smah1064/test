'use strict';
// Words pack: love, motivation, quotes & wisdom, minimal & aesthetic.
const { T, S, K, A, D, ACCENT, GOLD, PINK, TEAL } = require('../library-dsl');

const ROSE = '#f06595';
const WINE = '#a61e4d';
const CREAM = '#f8f1e3';
const SOFTGOLD = '#f2c94c';
const SAGE = '#8fbc8f';
const SKY = '#74c0fc';
const BROWN = '#8b5e34';
const WHITE = '#ffffff';

const categories = [
  { id: 'quotes', name: { en: 'Quotes & wisdom', ar: 'حكم وأقوال' } },
  { id: 'minimal', name: { en: 'Minimal & aesthetic', ar: 'بسيط وأنيق' } },
];

const designs = [
  // ---------- Love ----------
  D('wd-habibi', 'love', 'Habibi', 'حبيبي', [
    A('fluent-emoji-flat:red-heart', 0.18, 0.5, 0.25),
    T('حبيبي', 'Aref Ruqaa', 0.38, 0.5, 0.5, { weight: 'bold' }),
    T('HABIBI', 'Montserrat', 0.06, 0.5, 0.73, { spacing: 400, fill: '#e03131', weight: 'bold' }),
  ]),
  D('wd-habibti', 'love', 'Habibti', 'حبيبتي', [
    A('fluent-emoji-flat:pink-heart', 0.18, 0.5, 0.25),
    T('حبيبتي', 'Aref Ruqaa', 0.36, 0.5, 0.5, { weight: 'bold', fill: ROSE }),
    T('HABIBTI', 'Montserrat', 0.06, 0.5, 0.73, { spacing: 400, weight: 'bold' }),
  ], 'black'),
  D('wd-couple-hiya-donyti', 'love', 'Couple shirt: she is my world (his)', 'تيشيرت كابلز: هي دنيتي (ليه)', [
    T('هي', 'Lalezar', 0.32, 0.5, 0.26),
    T('دنيتي', 'Aref Ruqaa', 0.36, 0.5, 0.58, { weight: 'bold', fill: '#e03131' }),
    K('hearts', 0.24, 0.5, 0.84),
  ]),
  D('wd-couple-howa-donyti', 'love', 'Couple shirt: he is my world (hers)', 'تيشيرت كابلز: هو دنيتي (ليها)', [
    T('هو', 'Lalezar', 0.32, 0.5, 0.26),
    T('دنيتي', 'Aref Ruqaa', 0.36, 0.5, 0.58, { weight: 'bold', fill: '#e03131' }),
    K('hearts', 0.24, 0.5, 0.84),
  ]),
  D('wd-her-king', 'love', 'Couple shirt: her king', 'تيشيرت كابلز: ملكها', [
    A('fluent-emoji-flat:crown', 0.26, 0.5, 0.24),
    T('HER', 'Bebas Neue', 0.16, 0.5, 0.47, { spacing: 300 }),
    T('KING', 'Abril Fatface', 0.3, 0.5, 0.67, { fill: SOFTGOLD }),
  ], 'black'),
  D('wd-his-queen', 'love', 'Couple shirt: his queen', 'تيشيرت كابلز: ملكته', [
    A('fluent-emoji-flat:crown', 0.26, 0.5, 0.24),
    T('HIS', 'Bebas Neue', 0.16, 0.5, 0.47, { spacing: 300 }),
    T('QUEEN', 'Abril Fatface', 0.26, 0.5, 0.67, { fill: SOFTGOLD }),
  ], 'black'),
  D('wd-be-my-valentine', 'love', 'Be my Valentine', 'Be my Valentine', [
    K('heart-arrow', 0.34, 0.5, 0.27),
    T('Be my', 'Dancing Script', 0.13, 0.5, 0.55, { weight: 'bold' }),
    T('Valentine', 'Pacifico', 0.17, 0.5, 0.72, { fill: PINK }),
  ]),
  D('wd-eid-el-hob', 'love', 'Happy Valentine\'s (Arabic)', 'عيد حب سعيد', [
    S('heart', 0.56, 0.5, 0.36, { fill: '#e03131' }),
    T('عيد حب', 'Lalezar', 0.17, 0.5, 0.34, { fill: WHITE }),
    T('سعيد', 'Lalezar', 0.22, 0.5, 0.7),
    T('14 فبراير', 'Changa', 0.08, 0.5, 0.86, { fill: '#e03131', weight: 'bold' }),
  ]),
  D('wd-together-since', 'love', 'Together since (anniversary)', 'مع بعض من سنة (ذكرى الجواز)', [
    K('rings', 0.34, 0.5, 0.2),
    T('Together', 'Pacifico', 0.17, 0.5, 0.44),
    T('SINCE', 'Montserrat', 0.06, 0.5, 0.6, { spacing: 500, weight: 'bold', fill: GOLD }),
    T('14 . 02 . 2020', 'Playfair Display', 0.1, 0.5, 0.74, { weight: 'bold' }),
  ], 'sand'),
  D('wd-sawa-men', 'love', 'Together since a date (Arabic)', 'سوا من يوم (تاريخ)', [
    S('ring', 0.62, 0.5, 0.42, { fill: GOLD }),
    T('سوا', 'Aref Ruqaa', 0.26, 0.5, 0.36, { weight: 'bold' }),
    T('من 2020', 'Changa', 0.09, 0.5, 0.53, { weight: 'bold', fill: GOLD }),
    T('وهنفضل سوا', 'Marhey', 0.1, 0.5, 0.84, { weight: 'bold' }),
  ], 'navy'),
  D('wd-ya-ba5ti-beek', 'love', 'Lucky to have you', 'يا بختي بيك', [
    T('يا بختي', 'Lalezar', 0.26, 0.5, 0.34),
    T('بيك', 'Aref Ruqaa', 0.3, 0.5, 0.6, { weight: 'bold', fill: PINK }),
    A('fluent-emoji-flat:sparkling-heart', 0.18, 0.5, 0.84),
  ]),
  D('wd-nossi-el-tani', 'love', 'My other half', 'نصّي التاني', [
    A('fluent-emoji-flat:two-hearts', 0.26, 0.5, 0.24),
    T('نصّي', 'Lalezar', 0.26, 0.5, 0.52),
    T('التاني', 'Aref Ruqaa', 0.28, 0.5, 0.76, { weight: 'bold', fill: ROSE }),
  ], 'heather'),
  D('wd-love-neon', 'love', 'Love neon', 'Love نيون', [
    T('love', 'Pacifico', 0.28, 0.5, 0.44, { fill: '#ff8fc7', glow: '#f06595' }),
    S('heart', 0.12, 0.5, 0.72, { fill: '#ff8fc7' }),
  ], 'black'),
  D('wd-love-monogram', 'love', 'Couple initials monogram', 'حروف الكابل', [
    T('A', 'Playfair Display', 0.34, 0.3, 0.45, { weight: 'bold' }),
    S('heart', 0.16, 0.5, 0.45, { fill: '#e03131' }),
    T('S', 'Playfair Display', 0.34, 0.7, 0.45, { weight: 'bold' }),
    T('EST. 2025', 'Montserrat', 0.06, 0.5, 0.68, { spacing: 400, weight: 'bold', fill: GOLD }),
  ]),

  // ---------- Motivation ----------
  D('wd-enta-te2dar', 'motivation', 'You can do it', 'إنت تقدر', [
    T('إنت', 'Lalezar', 0.2, 0.5, 0.25),
    T('تقدر', 'Lalezar', 0.38, 0.5, 0.53, { fill: ACCENT }),
    T('صدّق في نفسك', 'Changa', 0.09, 0.5, 0.8, { weight: 'bold' }),
  ]),
  D('wd-enti-te2dari', 'motivation', 'You can do it (girls)', 'إنتي تقدري', [
    A('fluent-emoji-flat:sparkles', 0.14, 0.5, 0.17),
    T('إنتي', 'Lalezar', 0.2, 0.5, 0.36),
    T('تقدري', 'Lalezar', 0.32, 0.5, 0.58, { fill: ROSE }),
    T('وأكتر كمان', 'Marhey', 0.1, 0.5, 0.82, { weight: 'bold' }),
  ], 'black'),
  D('wd-khatwa-khatwa', 'motivation', 'Step by step', 'خطوة خطوة', [
    A('ph:footprints', 0.24, 0.5, 0.2, { fill: TEAL }),
    T('خطوة', 'Lalezar', 0.24, 0.5, 0.45),
    T('خطوة', 'Lalezar', 0.24, 0.5, 0.65, { fill: TEAL }),
    T('وهتوصل', 'Marhey', 0.1, 0.5, 0.86, { weight: 'bold' }),
  ]),
  D('wd-e7lam-akbar', 'motivation', 'Dream bigger (Arabic)', 'احلم أكبر', [
    A('fluent-emoji-flat:rocket', 0.26, 0.5, 0.22),
    T('احلم', 'Rakkas', 0.3, 0.5, 0.5),
    T('أكبر', 'Rakkas', 0.3, 0.5, 0.74, { fill: SOFTGOLD }),
  ], 'navy'),
  D('wd-dream-plan-do', 'motivation', 'Dream. Plan. Do.', 'احلم. خطط. نفذ', [
    T('DREAM.', 'Anton', 0.2, 0.5, 0.3),
    T('PLAN.', 'Anton', 0.2, 0.5, 0.5),
    T('DO.', 'Anton', 0.2, 0.5, 0.7, { fill: ACCENT }),
  ], 'heather'),
  D('wd-keep-going', 'motivation', 'Keep going', 'Keep going', [
    A('tabler:arrow-up-right', 0.2, 0.5, 0.24, { fill: SOFTGOLD }),
    T('KEEP', 'Bebas Neue', 0.26, 0.5, 0.48),
    T('GOING', 'Bebas Neue', 0.14, 0.5, 0.7, { spacing: 200, bg: '#e8590c', bgShape: 'banner', fill: WHITE }),
  ], 'forest'),
  D('wd-hustle', 'motivation', 'Hustle retro', 'Hustle ريترو', [
    T('HUSTLE', 'Bungee', 0.2, 0.5, 0.42, { fill: SOFTGOLD, extrude: '#e8590c' }),
    T('every single day', 'Caveat', 0.11, 0.5, 0.62, { weight: 'bold' }),
  ], 'black'),
  D('wd-love-yourself', 'motivation', 'Love yourself first', 'حب نفسك الأول (إنجليزي)', [
    T('love', 'Pacifico', 0.22, 0.5, 0.32, { fill: PINK }),
    T('YOURSELF', 'Montserrat', 0.1, 0.5, 0.52, { weight: 'bold', spacing: 200 }),
    T('FIRST', 'Montserrat', 0.06, 0.5, 0.66, { spacing: 600 }),
    A('tabler:heart', 0.1, 0.5, 0.82, { fill: PINK }),
  ], 'sand'),
  D('wd-7ebb-nafsak', 'motivation', 'Love yourself (Arabic)', 'حب نفسك', [
    S('heart', 0.5, 0.5, 0.34, { fill: PINK }),
    T('حب', 'Lalezar', 0.2, 0.5, 0.32, { fill: WHITE }),
    T('نفسك', 'Lalezar', 0.26, 0.5, 0.67),
    T('الأول', 'Marhey', 0.11, 0.5, 0.84, { weight: 'bold', fill: PINK }),
  ]),
  D('wd-matestaslemsh', 'motivation', 'Never give up', 'متستسلمش', [
    A('fluent-emoji-flat:fire', 0.22, 0.5, 0.22),
    T('متستسلمش', 'Lalezar', 0.22, 0.5, 0.5, { fill: '#ff922b' }),
    T('لسه البداية', 'Changa', 0.1, 0.5, 0.72, { weight: 'bold' }),
  ], 'black'),
  D('wd-bokra-a7la', 'motivation', 'Tomorrow is brighter', 'بكرة أحلى', [
    A('fluent-emoji-flat:sun', 0.3, 0.5, 0.24),
    T('بكرة', 'Lemonada', 0.22, 0.5, 0.52, { weight: 'bold' }),
    T('أحلى', 'Lemonada', 0.22, 0.5, 0.74, { weight: 'bold', fill: '#f08c00' }),
  ]),
  D('wd-mafeesh-mosta7eel', 'motivation', 'Nothing is impossible', 'مفيش مستحيل', [
    T('مفيش', 'Lalezar', 0.2, 0.5, 0.34),
    T('مستحيل', 'Lalezar', 0.3, 0.5, 0.56, { fill: SOFTGOLD, extrude: '#e03131' }),
    A('fluent-emoji-flat:flexed-biceps', 0.2, 0.5, 0.82),
  ], 'navy'),
  D('wd-one-day-day-one', 'motivation', 'One day or day one', 'يوم ما ولا اليوم الأول', [
    T('ONE DAY', 'Anton', 0.16, 0.5, 0.3, { fill: '#868e96' }),
    T('OR', 'Playfair Display', 0.08, 0.5, 0.46, { weight: 'bold' }),
    T('DAY ONE', 'Anton', 0.2, 0.5, 0.63, { fill: ACCENT }),
    T('it\'s your choice', 'Caveat', 0.09, 0.5, 0.82, { weight: 'bold' }),
  ]),
  D('wd-eshtaghal-fi-samt', 'motivation', 'Work in silence', 'اشتغل في صمت', [
    T('اشتغل في صمت', 'Reem Kufi', 0.14, 0.5, 0.36, { weight: 'bold' }),
    S('line', 0.3, 0.5, 0.5, { fill: GOLD }),
    T('وخلّي نجاحك', 'El Messiri', 0.1, 0.5, 0.62, { weight: 'bold' }),
    T('يتكلم', 'Aref Ruqaa', 0.2, 0.5, 0.8, { weight: 'bold', fill: SOFTGOLD }),
  ], 'black'),
  D('wd-adha-w-oddod', 'motivation', 'Up to the challenge', 'قدّها وقدود', [
    K('bolt', 0.22, 0.5, 0.22),
    T('قدّها', 'Lalezar', 0.34, 0.5, 0.5),
    T('وقدود', 'Marhey', 0.14, 0.5, 0.76, { weight: 'bold', fill: WHITE, bg: '#e8590c', bgShape: 'pill' }),
  ]),

  // ---------- Quotes & wisdom ----------
  D('wd-elly-fat-mat', 'quotes', 'Let the past go', 'اللي فات مات', [
    S('line', 0.4, 0.5, 0.24, { fill: GOLD }),
    T('اللي فات', 'Aref Ruqaa', 0.22, 0.5, 0.4, { weight: 'bold' }),
    T('مات', 'Aref Ruqaa', 0.32, 0.5, 0.6, { weight: 'bold', fill: GOLD }),
    S('line', 0.4, 0.5, 0.78, { fill: GOLD }),
  ], 'black'),
  D('wd-sabr-meftah', 'quotes', 'Patience is the key to relief', 'الصبر مفتاح الفرج', [
    A('fluent-emoji-flat:old-key', 0.24, 0.5, 0.22),
    T('الصبر', 'Aref Ruqaa', 0.26, 0.5, 0.46, { weight: 'bold' }),
    T('مفتاح الفرج', 'El Messiri', 0.13, 0.5, 0.68, { weight: 'bold', fill: BROWN }),
  ], 'sand'),
  D('wd-ettaqi-sharr', 'quotes', 'Beware the anger of the patient', 'اتقِ شرّ الحليم إذا غضب', [
    S('line', 0.36, 0.5, 0.22, { fill: '#e03131' }),
    T('اتق شر الحليم', 'Amiri', 0.14, 0.5, 0.36, { weight: 'bold' }),
    T('إذا غضب', 'Aref Ruqaa', 0.3, 0.5, 0.58, { weight: 'bold', fill: '#e03131' }),
    S('line', 0.36, 0.5, 0.78, { fill: '#e03131' }),
  ]),
  D('wd-el-3elm-noor', 'quotes', 'Knowledge is light', 'العلم نور', [
    A('fluent-emoji-flat:open-book', 0.26, 0.5, 0.24),
    T('العلم', 'Reem Kufi', 0.24, 0.5, 0.5, { weight: 'bold' }),
    T('نور', 'Aref Ruqaa', 0.26, 0.5, 0.72, { weight: 'bold', fill: SOFTGOLD }),
  ], 'navy'),
  D('wd-man-gadda-wagad', 'quotes', 'Whoever strives succeeds', 'من جدّ وجد', [
    A('fluent-emoji-flat:seedling', 0.2, 0.5, 0.2),
    T('مَن جدّ وجد', 'Aref Ruqaa', 0.2, 0.5, 0.44, { weight: 'bold' }),
    T('ومَن زرع حصد', 'Aref Ruqaa', 0.15, 0.5, 0.64, { weight: 'bold', fill: '#2f9e44' }),
  ]),
  D('wd-ta2khira-kheira', 'quotes', 'Every delay holds good', 'كل تأخيرة فيها خيرة', [
    A('tabler:hourglass', 0.18, 0.5, 0.2, { fill: SOFTGOLD }),
    T('كل تأخيرة', 'El Messiri', 0.16, 0.5, 0.42, { weight: 'bold' }),
    T('فيها خيرة', 'Aref Ruqaa', 0.22, 0.5, 0.62, { weight: 'bold', fill: SOFTGOLD }),
  ], 'forest'),
  D('wd-el-haraka-baraka', 'quotes', 'There is blessing in movement', 'في الحركة بركة', [
    T('في الحركة', 'Lalezar', 0.2, 0.5, 0.36),
    T('بركة', 'Aref Ruqaa', 0.32, 0.5, 0.6, { weight: 'bold', fill: TEAL }),
    A('ph:person-simple-run', 0.14, 0.5, 0.84, { fill: TEAL }),
  ]),
  D('wd-khair-el-kalam', 'quotes', 'Best words are few and meaningful', 'خير الكلام ما قلّ ودلّ', [
    A('ph:quotes-fill', 0.14, 0.5, 0.18, { fill: GOLD }),
    T('خير الكلام', 'Amiri', 0.18, 0.5, 0.4, { weight: 'bold' }),
    T('ما قلّ ودلّ', 'Aref Ruqaa', 0.2, 0.5, 0.6, { weight: 'bold', fill: GOLD }),
    S('diamond', 0.06, 0.5, 0.8, { fill: GOLD }),
  ], 'black'),
  D('wd-el-gar', 'quotes', 'The neighbour before the house', 'الجار قبل الدار', [
    S('circle', 0.66, 0.5, 0.44, { fill: '#f3e9d7' }),
    A('tabler:home-heart', 0.16, 0.5, 0.3, { fill: BROWN }),
    T('الجار', 'Aref Ruqaa', 0.2, 0.5, 0.45, { weight: 'bold', fill: '#16181d' }),
    T('قبل الدار', 'El Messiri', 0.11, 0.5, 0.58, { weight: 'bold', fill: BROWN }),
  ], 'forest'),
  D('wd-elly-maloosh-adim', 'quotes', 'Who forgets the old has nothing new', 'اللي ملوش قديم ملوش جديد', [
    T('اللي ملوش قديم', 'Reem Kufi', 0.12, 0.5, 0.3, { weight: 'bold' }),
    S('ribbon', 0.2, 0.5, 0.45, { fill: GOLD }),
    T('ملوش جديد', 'Aref Ruqaa', 0.2, 0.5, 0.62, { weight: 'bold', fill: GOLD }),
  ], 'navy'),
  D('wd-this-too-shall-pass', 'quotes', 'This too shall pass', 'This too shall pass', [
    A('tabler:hourglass', 0.16, 0.5, 0.2, { fill: GOLD }),
    T('this too', 'Playfair Display', 0.13, 0.5, 0.42, { weight: 'bold' }),
    T('shall pass', 'Dancing Script', 0.2, 0.5, 0.6, { weight: 'bold', fill: GOLD }),
  ], 'sand'),
  D('wd-actions-speak', 'quotes', 'Actions speak louder than words', 'الأفعال أبلغ من الكلام (إنجليزي)', [
    T('ACTIONS', 'Oswald', 0.2, 0.5, 0.3, { weight: 'bold', fill: ACCENT }),
    T('SPEAK LOUDER', 'Oswald', 0.11, 0.5, 0.48, { weight: 'bold' }),
    T('THAN WORDS', 'Oswald', 0.11, 0.5, 0.6, { weight: 'bold', fill: '#868e96' }),
    S('line', 0.3, 0.5, 0.74, { fill: ACCENT }),
  ], 'black'),

  // ---------- Minimal & aesthetic ----------
  D('wd-salam', 'minimal', 'Salam calligraphy', 'سلام خط عربي', [
    T('سلام', 'Aref Ruqaa', 0.26, 0.5, 0.42, { weight: 'bold' }),
    S('line', 0.16, 0.5, 0.6, { fill: GOLD }),
    T('PEACE', 'Montserrat', 0.045, 0.5, 0.68, { spacing: 800 }),
  ]),
  D('wd-amal', 'minimal', 'Hope calligraphy', 'أمل خط عربي', [
    A('tabler:seedling', 0.12, 0.5, 0.3, { fill: SAGE }),
    T('أمل', 'Aref Ruqaa', 0.3, 0.5, 0.48, { weight: 'bold' }),
    T('HOPE', 'Montserrat', 0.045, 0.5, 0.66, { spacing: 800, fill: SAGE }),
  ], 'black'),
  D('wd-horreya', 'minimal', 'Freedom calligraphy', 'حرية خط عربي', [
    A('ph:bird', 0.14, 0.64, 0.3, { fill: SKY }),
    T('حرية', 'Aref Ruqaa', 0.26, 0.5, 0.48, { weight: 'bold' }),
    T('FREEDOM', 'Montserrat', 0.045, 0.5, 0.66, { spacing: 800 }),
  ], 'navy'),
  D('wd-reda', 'minimal', 'Contentment calligraphy', 'رضا خط عربي', [
    T('رضا', 'Aref Ruqaa', 0.3, 0.5, 0.44, { weight: 'bold', fill: BROWN }),
    S('diamond', 0.04, 0.5, 0.62, { fill: BROWN }),
  ], 'sand'),
  D('wd-noor', 'minimal', 'Light calligraphy', 'نور خط عربي', [
    A('tabler:sun-low', 0.14, 0.5, 0.28, { fill: SOFTGOLD }),
    T('نور', 'Aref Ruqaa', 0.3, 0.5, 0.48, { weight: 'bold', fill: SOFTGOLD }),
    T('LIGHT', 'Montserrat', 0.045, 0.5, 0.66, { spacing: 800 }),
  ], 'black'),
  D('wd-ma3lesh', 'minimal', 'It\'s okay', 'معلش', [
    T('معلش', 'Reem Kufi', 0.2, 0.5, 0.42, { weight: 'bold' }),
    T('it\'s okay', 'Caveat', 0.1, 0.5, 0.58, { fill: '#495057' }),
  ], 'heather'),
  D('wd-chest-hodoo2', 'minimal', 'Calm chest print', 'هدوء على الصدر', [
    A('ph:waves', 0.1, 0.72, 0.1, { fill: SKY }),
    T('هدوء', 'Reem Kufi', 0.1, 0.72, 0.19, { weight: 'bold' }),
  ], 'navy'),
  D('wd-chest-be-kind', 'minimal', 'Be kind chest print', 'Be kind على الصدر', [
    A('tabler:heart', 0.07, 0.72, 0.1, { fill: '#e03131' }),
    T('be kind', 'Playfair Display', 0.07, 0.72, 0.17, { weight: 'bold' }),
  ]),
  D('wd-serenity', 'minimal', 'Serenity', 'Serenity', [
    T('serenity', 'Playfair Display', 0.15, 0.5, 0.42),
    S('line', 0.12, 0.5, 0.54, { fill: TEAL }),
    T('(n.) calm, peaceful, untroubled', 'Montserrat', 0.042, 0.5, 0.6, { fill: '#495057' }),
  ]),
  D('wd-breathe', 'minimal', 'Breathe', 'Breathe', [
    A('ph:wind', 0.14, 0.5, 0.3, { fill: SAGE }),
    T('breathe', 'Dancing Script', 0.2, 0.5, 0.48, { weight: 'bold' }),
    T('SLOW DOWN', 'Montserrat', 0.045, 0.5, 0.62, { spacing: 800, fill: '#b2f2bb' }),
  ], 'forest'),
  D('wd-mountains-line', 'minimal', 'Mountains line art', 'جبال خطوط بسيطة', [
    A('ph:mountains', 0.36, 0.5, 0.36),
    T('STAY CURIOUS', 'Montserrat', 0.05, 0.5, 0.56, { spacing: 600, weight: 'bold' }),
  ], 'sand'),
];

module.exports = { categories, designs };
