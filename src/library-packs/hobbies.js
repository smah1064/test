'use strict';
/*
 * Hobbies pack: football kits and fan shirts, gym & sports, gaming, music & art,
 * travel & outdoors. Team names, numbers, players' names and years are placeholders
 * the customer edits.
 */
const { T, S, K, A, D, ACCENT, GOLD, GREEN, PINK, BLUE, PURPLE, TEAL, RED } = require('../library-dsl');

const categories = [
  { id: 'fitness', name: { en: 'Gym & fitness', ar: 'جيم ورياضة' } },
  { id: 'gaming', name: { en: 'Gaming', ar: 'جيمنج' } },
  { id: 'music', name: { en: 'Music & art', ar: 'موسيقى وفن' } },
  { id: 'travel', name: { en: 'Travel & outdoors', ar: 'سفر ورحلات' } },
];

const designs = [
  // ---------- Football ----------
  D('hb-kit-name-number', 'football', 'Team kit name and number', 'طقم فريق باسم ورقم', [
    T('أحمد', 'Changa', 0.15, 0.5, 0.15, { weight: 'bold', sampleName: 'name' }),
    T('10', 'Anton', 0.6, 0.5, 0.5, { fill: GOLD }),
    T('اسم الفريق', 'Reem Kufi', 0.09, 0.5, 0.86, { weight: 'bold' }),
  ], 'navy'),
  D('hb-kit-en', 'football', 'Team kit (English)', 'طقم فريق إنجليزي', [
    T('AHMED', 'Oswald', 0.13, 0.5, 0.14, { weight: 'bold', spacing: 200, sampleName: 'name' }),
    T('7', 'Anton', 0.64, 0.5, 0.5, { fill: RED }),
    S('line', 0.4, 0.5, 0.79, { fill: RED }),
    T('TEAM NAME', 'Bebas Neue', 0.09, 0.5, 0.87, { spacing: 300 }),
  ]),
  D('hb-captain-armband', 'football', 'Captain armband', 'شارة الكابتن', [
    S('circle', 0.46, 0.5, 0.33, { fill: GOLD }),
    T('C', 'Abril Fatface', 0.3, 0.5, 0.32, { fill: '#16181d' }),
    T('كابتن الفرقة', 'Lalezar', 0.16, 0.5, 0.68),
    T('والكلمة كلمتي', 'Changa', 0.08, 0.5, 0.85, { weight: 'bold', fill: GOLD }),
  ], 'black'),
  D('hb-goalkeeper', 'football', 'Goalkeeper: nobody gets past', 'حارس المرمى محدش هيعدي', [
    A('fluent-emoji-flat:goal-net', 0.34, 0.5, 0.2),
    T('محدش', 'Lalezar', 0.24, 0.5, 0.48),
    T('هيعدّي', 'Lalezar', 0.24, 0.5, 0.68, { fill: GREEN }),
    T('GOALKEEPER', 'Bebas Neue', 0.08, 0.5, 0.88, { spacing: 300 }),
  ]),
  D('hb-gk-safe-hands', 'football', 'Goalkeeper No. 1 safe hands', 'حارس رقم ١', [
    T('GOALKEEPER', 'Bebas Neue', 0.12, 0.5, 0.16, { spacing: 150, curve: 30 }),
    T('1', 'Anton', 0.56, 0.5, 0.5, { fill: GREEN }),
    T('SAFE HANDS', 'Bebas Neue', 0.1, 0.5, 0.86, { fill: '#ffffff', bg: GREEN, bgShape: 'banner' }),
  ], 'black'),
  D('hb-kora-hayaty-neon', 'football', 'Football is my life (neon)', 'الكورة حياتي نيون', [
    A('tabler:ball-football', 0.24, 0.5, 0.2, { fill: '#69db7c' }),
    T('الكورة', 'Lalezar', 0.26, 0.5, 0.5, { fill: '#ffffff', glow: '#40c057' }),
    T('حياتي', 'Lalezar', 0.26, 0.5, 0.74, { fill: '#ffffff', glow: '#f06595' }),
  ], 'black'),
  D('hb-kora-hayaty-arch', 'football', 'Football is my life (arched)', 'الكورة حياتي مقوسة', [
    T('FOOTBALL IS MY LIFE', 'Bebas Neue', 0.1, 0.5, 0.17, { spacing: 100, curve: 40, fill: ACCENT }),
    A('fluent-emoji-flat:soccer-ball', 0.36, 0.5, 0.42),
    T('الكورة حياتي', 'Lalezar', 0.17, 0.5, 0.76),
  ]),
  D('hb-match-day', 'football', 'Match day', 'يوم الماتش', [
    T('MATCH', 'Anton', 0.24, 0.5, 0.2),
    T('DAY', 'Anton', 0.34, 0.5, 0.45, { fill: ACCENT }),
    T('يوم الماتش', 'Lalezar', 0.11, 0.5, 0.72, { fill: '#ffffff', bg: ACCENT, bgShape: 'banner' }),
    A('fluent-emoji-flat:soccer-ball', 0.14, 0.5, 0.89),
  ], 'black'),
  D('hb-match-today', 'football', 'Match today, don\'t talk to me', 'النهارده ماتش متكلمنيش', [
    A('fluent-emoji-flat:stadium', 0.34, 0.5, 0.2),
    T('النهارده ماتش', 'Lalezar', 0.17, 0.5, 0.5),
    T('محدش يكلمني', 'Marhey', 0.125, 0.5, 0.72, { weight: 'bold', fill: RED }),
  ]),
  D('hb-khomasy', 'football', 'Five-a-side league', 'دوري خماسي', [
    S('hexagon', 0.4, 0.5, 0.25, { fill: TEAL }),
    T('5', 'Anton', 0.24, 0.5, 0.25, { fill: '#ffffff' }),
    T('خماسي', 'Lalezar', 0.26, 0.5, 0.58),
    T('دوري الحتة 2025', 'Changa', 0.085, 0.5, 0.82, { weight: 'bold', fill: TEAL }),
  ]),
  D('hb-first-class-fan', 'football', 'First-class fan', 'مشجع درجة أولى', [
    A('fluent-emoji-flat:heart-on-fire', 0.24, 0.5, 0.2),
    T('مشجع', 'Lalezar', 0.3, 0.5, 0.5),
    T('درجة أولى', 'Changa', 0.1, 0.5, 0.78, { weight: 'bold', fill: '#16181d', bg: GOLD, bgShape: 'ticket' }),
  ], 'red'),
  D('hb-team-crest', 'football', 'Team crest with year', 'شعار الفريق بالسنة', [
    S('shield', 0.56, 0.5, 0.36, { fill: GREEN }),
    A('tabler:ball-football', 0.2, 0.5, 0.28, { fill: '#ffffff' }),
    T('EST. 2025', 'Bebas Neue', 0.07, 0.5, 0.45, { fill: '#ffffff', spacing: 150 }),
    T('اسم الفريق', 'Reem Kufi', 0.13, 0.5, 0.74, { weight: 'bold' }),
  ]),
  D('hb-eat-sleep-football', 'football', 'Eat sleep football repeat', 'أكل نوم كورة', [
    T('EAT', 'Anton', 0.16, 0.5, 0.16),
    T('SLEEP', 'Anton', 0.16, 0.5, 0.34),
    T('FOOTBALL', 'Anton', 0.18, 0.5, 0.53, { fill: GREEN }),
    T('REPEAT', 'Anton', 0.16, 0.5, 0.72),
    A('fluent-emoji-flat:soccer-ball', 0.14, 0.5, 0.88),
  ], 'heather'),
  D('hb-striker-9', 'football', 'Striker No. 9', 'الهداف ٩', [
    A('fluent-emoji-flat:fire', 0.2, 0.5, 0.14),
    T('9', 'Anton', 0.48, 0.5, 0.45, { fill: ACCENT, extrude: '#16181d' }),
    T('الهدّاف', 'Lalezar', 0.2, 0.5, 0.8),
  ]),
  D('hb-referee', 'football', 'The referee is against me', 'الحكم ظالمني', [
    A('lucide:whistle', 0.26, 0.5, 0.2, { fill: '#ffd43b' }),
    T('الحَكَم', 'Lalezar', 0.24, 0.5, 0.5),
    T('ظالمني', 'Marhey', 0.17, 0.5, 0.74, { weight: 'bold', fill: '#ffd43b' }),
  ], 'black'),

  // ---------- Gym & fitness ----------
  D('hb-no-pain-no-gain', 'fitness', 'No pain no gain', 'نو بين نو جين', [
    A('mdi:dumbbell', 0.34, 0.5, 0.17, { fill: ACCENT }),
    T('NO PAIN', 'Anton', 0.22, 0.5, 0.42),
    T('NO GAIN', 'Anton', 0.22, 0.5, 0.65, { fill: ACCENT }),
    T('جيم كل يوم', 'Changa', 0.08, 0.5, 0.86, { weight: 'bold' }),
  ], 'black'),
  D('hb-gym-therapy', 'fitness', 'The gym is my therapy', 'الجيم علاجي', [
    A('fluent-emoji-flat:flexed-biceps', 0.3, 0.5, 0.2),
    T('الجيم', 'Lalezar', 0.28, 0.5, 0.5),
    T('علاجي', 'Lalezar', 0.24, 0.5, 0.74, { fill: TEAL }),
  ]),
  D('hb-gym-beast', 'fitness', 'Gym beast', 'وحش الجيم', [
    T('وحش', 'Lalezar', 0.36, 0.5, 0.32, { fill: RED, extrude: '#ffffff' }),
    T('الجيم', 'Lalezar', 0.24, 0.5, 0.6),
    T('BEAST MODE', 'Bebas Neue', 0.09, 0.5, 0.83, { spacing: 300, fill: RED }),
  ], 'black'),
  D('hb-running-club', 'fitness', 'Running club badge', 'نادي الجري', [
    S('ring', 0.64, 0.5, 0.38, { fill: BLUE }),
    T('RUNNING CLUB', 'Bebas Neue', 0.075, 0.5, 0.26, { spacing: 150, curve: 45 }),
    A('fluent-emoji-flat:running-shoe', 0.26, 0.5, 0.42),
    T('نادي الجري', 'Lalezar', 0.15, 0.5, 0.75),
    T('EST. 2025', 'Bebas Neue', 0.07, 0.5, 0.89, { fill: BLUE, spacing: 200 }),
  ]),
  D('hb-run-5k', 'fitness', '5K run, every step counts', 'سباق ٥ كيلو', [
    T('5K', 'Anton', 0.5, 0.5, 0.33, { fill: BLUE }),
    T('كل خطوة', 'Lalezar', 0.16, 0.5, 0.64),
    T('بتفرق', 'Lalezar', 0.16, 0.5, 0.82, { fill: BLUE }),
  ]),
  D('hb-padel', 'fitness', 'Padel addict', 'مدمن بادل', [
    A('fluent-emoji-flat:tennis', 0.28, 0.5, 0.18),
    T('مدمن', 'Lalezar', 0.2, 0.5, 0.44),
    T('بادل', 'Lalezar', 0.32, 0.5, 0.67, { fill: '#c0eb75' }),
    T('PADEL CLUB', 'Bebas Neue', 0.08, 0.5, 0.89, { spacing: 300 }),
  ], 'navy'),
  D('hb-swimming', 'fitness', 'Living in the water', 'عايش في المية', [
    A('fluent-emoji-flat:person-swimming', 0.36, 0.5, 0.22),
    T('عايش', 'Lalezar', 0.26, 0.5, 0.53),
    T('في المية', 'Lalezar', 0.22, 0.5, 0.76, { fill: BLUE }),
  ]),
  D('hb-cycling', 'fitness', 'Ride more worry less', 'ركوب العجل', [
    A('tabler:bike', 0.5, 0.5, 0.27, { fill: TEAL }),
    T('RIDE MORE', 'Bebas Neue', 0.18, 0.5, 0.58),
    T('WORRY LESS', 'Bebas Neue', 0.18, 0.5, 0.76, { fill: TEAL }),
  ], 'heather'),
  D('hb-basketball', 'fitness', 'Basketball number', 'باسكت بالرقم', [
    T('BASKETBALL', 'Bungee', 0.1, 0.5, 0.16, { curve: 35 }),
    A('fluent-emoji-flat:basketball', 0.4, 0.5, 0.45),
    T('11', 'Anton', 0.22, 0.5, 0.82, { fill: ACCENT }),
  ], 'black'),
  D('hb-train-to-eat', 'fitness', 'I train so I can eat', 'بتمرن عشان آكل', [
    T('بتمرّن', 'Lalezar', 0.26, 0.5, 0.26),
    T('عشان', 'Changa', 0.11, 0.5, 0.47, { weight: 'bold' }),
    T('آكل', 'Lalezar', 0.34, 0.5, 0.68, { fill: ACCENT }),
    A('fluent-emoji-flat:pizza', 0.18, 0.5, 0.89),
  ]),
  D('hb-yoga', 'fitness', 'Yoga: breathe', 'يوجا خد نفس', [
    K('lotus', 0.36, 0.5, 0.24),
    T('خُد نفَس', 'Aref Ruqaa', 0.2, 0.5, 0.58, { weight: 'bold' }),
    T('BREATHE', 'Montserrat', 0.07, 0.5, 0.78, { spacing: 400, fill: TEAL }),
  ], 'sand'),

  // ---------- Gaming ----------
  D('hb-gamer-neon', 'gaming', 'Gamer neon', 'جيمر نيون', [
    A('ph:game-controller-fill', 0.36, 0.5, 0.24, { fill: '#da77f2' }),
    T('GAMER', 'Bungee', 0.2, 0.5, 0.56, { fill: '#ffffff', glow: '#be4bdb' }),
    T('جيمر للآخر', 'Lalezar', 0.12, 0.5, 0.78, { fill: '#66d9e8' }),
  ], 'black'),
  D('hb-sibni-akammel', 'gaming', 'Let me finish the game', 'سيبني أكمل الجيم', [
    A('fluent-emoji-flat:video-game', 0.26, 0.5, 0.18),
    T('سيبني أكمّل', 'Lalezar', 0.17, 0.5, 0.44),
    T('الجيم', 'Lalezar', 0.26, 0.5, 0.64, { fill: PURPLE }),
    T('خمس دقايق بس يا ماما', 'Changa', 0.07, 0.5, 0.86, { weight: 'bold' }),
  ]),
  D('hb-level-up', 'gaming', 'Level up birthday', 'ليفل أب عيد ميلاد', [
    A('tabler:arrow-big-up-filled', 0.2, 0.5, 0.16, { fill: GREEN }),
    T('LEVEL', 'Bungee', 0.14, 0.5, 0.36),
    T('25', 'Bungee', 0.36, 0.5, 0.58, { fill: GREEN, extrude: '#16181d' }),
    T('UNLOCKED', 'Bungee', 0.09, 0.5, 0.84, { fill: '#16181d', bg: GREEN, bgShape: 'box' }),
  ], 'heather'),
  D('hb-press-start', 'gaming', 'Press start retro', 'اضغط ابدأ ريترو', [
    S('heart', 0.1, 0.38, 0.14, { fill: RED }),
    S('heart', 0.1, 0.5, 0.14, { fill: RED }),
    S('heart', 0.1, 0.62, 0.14, { fill: RED }),
    T('PRESS', 'Bungee', 0.2, 0.5, 0.38, { fill: '#ffd43b', extrude: '#e8590c' }),
    T('START', 'Bungee', 0.2, 0.5, 0.58, { fill: '#ffd43b', extrude: '#e8590c' }),
    T('اضغط وابدأ', 'Changa', 0.09, 0.5, 0.82, { weight: 'bold' }),
  ], 'black'),
  D('hb-retro-gamer', 'gaming', 'Retro gamer', 'جيمر ريترو', [
    A('mdi:controller-classic', 0.36, 0.5, 0.2),
    T('RETRO', 'Bungee', 0.2, 0.5, 0.47, { fill: PINK, extrude: BLUE }),
    T('GAMER', 'Bungee', 0.2, 0.5, 0.67),
    T('OLD SCHOOL', 'Montserrat', 0.06, 0.5, 0.86, { spacing: 400 }),
  ], 'white'),
  D('hb-sahran', 'gaming', 'Up all night gaming', 'سهران للصبح', [
    A('fluent-emoji-flat:joystick', 0.26, 0.5, 0.18),
    T('سهران', 'Lalezar', 0.3, 0.5, 0.46, { fill: '#ffffff', glow: '#4dabf7' }),
    T('للصبح', 'Marhey', 0.15, 0.5, 0.7, { weight: 'bold', fill: '#74c0fc' }),
    T('NIGHT GAMER', 'Bebas Neue', 0.07, 0.5, 0.88, { spacing: 300 }),
  ], 'navy'),
  D('hb-player-one', 'gaming', 'Player 1 with name', 'بلاير ١ بالاسم', [
    T('PLAYER', 'Bungee', 0.16, 0.5, 0.2),
    T('1', 'Bungee', 0.42, 0.5, 0.48, { fill: ACCENT, extrude: '#16181d' }),
    T('AHMED', 'Montserrat', 0.09, 0.5, 0.8, { weight: 'bold', spacing: 300, sampleName: 'name' }),
  ], 'white'),
  D('hb-net-fasal', 'gaming', 'The internet dropped while I was winning', 'النت فصل وأنا كسبان', [
    A('tabler:wifi-off', 0.3, 0.5, 0.2, { fill: RED }),
    T('النت فصل', 'Lalezar', 0.2, 0.5, 0.5),
    T('وأنا كسبان!', 'Marhey', 0.13, 0.5, 0.73, { weight: 'bold', fill: RED }),
  ]),
  D('hb-gamer-mode-on', 'gaming', 'Gamer mode on', 'مود الجيمر شغال', [
    A('tabler:device-gamepad', 0.34, 0.5, 0.2, { fill: GREEN }),
    T('GAMER MODE', 'Bungee', 0.11, 0.5, 0.46),
    T('ON', 'Bungee', 0.14, 0.5, 0.64, { fill: '#16181d', bg: '#69db7c', bgShape: 'pill' }),
    T('ممنوع الإزعاج', 'Changa', 0.08, 0.5, 0.85, { weight: 'bold', fill: '#69db7c' }),
  ], 'black'),

  // ---------- Music & art ----------
  D('hb-saltana', 'music', 'Tarab mood', 'سلطنة وطرب', [
    A('ph:music-notes-fill', 0.24, 0.5, 0.18, { fill: GOLD }),
    T('سلطنة', 'Aref Ruqaa', 0.28, 0.5, 0.48, { weight: 'bold', fill: GOLD }),
    T('طرب أصيل', 'Reem Kufi', 0.1, 0.5, 0.74, { weight: 'bold' }),
  ], 'black'),
  D('hb-oud', 'music', 'The oud is my companion', 'العود ونيسي', [
    A('ph:music-notes-fill', 0.26, 0.5, 0.2, { fill: GOLD }),
    T('العود', 'Aref Ruqaa', 0.26, 0.5, 0.5, { weight: 'bold' }),
    T('ونيسي', 'Aref Ruqaa', 0.2, 0.5, 0.72, { weight: 'bold', fill: GOLD }),
    T('OUD', 'Playfair Display', 0.06, 0.5, 0.88, { spacing: 500 }),
  ], 'navy'),
  D('hb-guitar', 'music', 'Guitar is my best friend', 'الجيتار صاحبي', [
    A('fluent-emoji-flat:guitar', 0.34, 0.5, 0.24),
    T('الجيتار', 'Lalezar', 0.22, 0.5, 0.56),
    T('صاحبي', 'Marhey', 0.15, 0.5, 0.76, { weight: 'bold', fill: ACCENT }),
  ]),
  D('hb-headphones', 'music', 'Headphones on, can\'t hear you', 'مش سامعك', [
    A('tabler:headphones-filled', 0.34, 0.5, 0.22, { fill: PINK }),
    T('مش سامعك', 'Lalezar', 0.2, 0.5, 0.52),
    T('السماعة في وداني', 'Changa', 0.09, 0.5, 0.72, { weight: 'bold', fill: PINK }),
  ], 'heather'),
  D('hb-mazika-7aya', 'music', 'Music is life', 'المزيكا حياة', [
    A('ph:music-notes-fill', 0.24, 0.5, 0.17, { fill: PINK }),
    T('المزيكا', 'Lalezar', 0.24, 0.5, 0.44, { fill: '#ffffff', glow: '#f06595' }),
    T('حياة', 'Lalezar', 0.28, 0.5, 0.68, { fill: '#ffffff', glow: '#f06595' }),
    T('MUSIC IS LIFE', 'Montserrat', 0.06, 0.5, 0.88, { spacing: 300 }),
  ], 'black'),
  D('hb-fannan', 'music', 'Artist (modest one)', 'فنان على قدي', [
    A('fluent-emoji-flat:artist-palette', 0.3, 0.5, 0.2),
    T('فنان', 'Lalezar', 0.34, 0.5, 0.5),
    T('بس على قدّي', 'Marhey', 0.12, 0.5, 0.74, { weight: 'bold', fill: PURPLE }),
  ]),
  D('hb-drawing', 'music', 'I draw to relax', 'برسم عشان أرتاح', [
    A('fluent-emoji-flat:pencil', 0.24, 0.5, 0.16),
    T('برسم', 'Aref Ruqaa', 0.3, 0.5, 0.42, { weight: 'bold' }),
    T('عشان أرتاح', 'Aref Ruqaa', 0.16, 0.5, 0.66, { weight: 'bold', fill: TEAL }),
    T('DRAW · CREATE · REPEAT', 'Montserrat', 0.05, 0.5, 0.86, { spacing: 150 }),
  ], 'sand'),
  D('hb-zaman-el-fan', 'music', 'Golden era of music', 'زمن الفن الجميل', [
    A('ph:vinyl-record-fill', 0.36, 0.5, 0.24, { fill: GOLD }),
    T('زمن الفن الجميل', 'Aref Ruqaa', 0.16, 0.5, 0.6, { weight: 'bold', fill: GOLD }),
    T('GOLDEN ERA', 'Playfair Display', 0.07, 0.5, 0.79, { spacing: 300 }),
  ], 'black'),
  D('hb-shower-singer', 'music', 'Great voice in the shower only', 'صوتي حلو في الحمام بس', [
    A('fluent-emoji-flat:microphone', 0.26, 0.5, 0.18),
    T('صوتي حلو', 'Lalezar', 0.2, 0.5, 0.46),
    T('في الحمّام بس', 'Marhey', 0.12, 0.5, 0.68, { weight: 'bold', fill: BLUE }),
  ]),

  // ---------- Travel & outdoors ----------
  D('hb-sahel', 'travel', 'Sahel summer', 'الساحل صيف', [
    A('fluent-emoji-flat:sun', 0.26, 0.5, 0.16),
    T('الساحل', 'Lalezar', 0.3, 0.5, 0.44, { fill: BLUE }),
    T('صيف 2025', 'Marhey', 0.13, 0.5, 0.66, { weight: 'bold', fill: ACCENT }),
    A('fluent-emoji-flat:water-wave', 0.2, 0.5, 0.86),
  ]),
  D('hb-summer-vibes', 'travel', 'Summer vibes', 'سمر فايبز', [
    A('fluent-emoji-flat:palm-tree', 0.3, 0.5, 0.22),
    T('Summer', 'Pacifico', 0.18, 0.5, 0.52, { fill: '#ff922b' }),
    T('VIBES', 'Bebas Neue', 0.2, 0.5, 0.74, { spacing: 300 }),
  ], 'white'),
  D('hb-dahab', 'travel', 'Dahab South Sinai', 'دهب جنوب سينا', [
    A('fluent-emoji-flat:diving-mask', 0.26, 0.5, 0.18),
    T('دهب', 'Lalezar', 0.38, 0.5, 0.48, { fill: '#3bc9db' }),
    T('DAHAB · SOUTH SINAI', 'Montserrat', 0.06, 0.5, 0.72, { weight: 'bold', spacing: 200 }),
    A('fluent-emoji-flat:tropical-fish', 0.18, 0.5, 0.87),
  ], 'navy'),
  D('hb-sinai-camping', 'travel', 'Camping under the stars in Sinai', 'تخييم في سينا', [
    K('stars', 0.24, 0.5, 0.15),
    A('fluent-emoji-flat:tent', 0.3, 0.5, 0.4),
    T('ليلة في سينا', 'Lalezar', 0.15, 0.5, 0.68),
    T('SINAI CAMPING', 'Bebas Neue', 0.08, 0.5, 0.86, { spacing: 300, fill: GOLD }),
  ], 'black'),
  D('hb-siwa', 'travel', 'Siwa oasis', 'واحة سيوة', [
    A('fluent-emoji-flat:palm-tree', 0.3, 0.5, 0.2),
    T('سيوة', 'Rakkas', 0.32, 0.5, 0.5),
    T('واحة الهدوء', 'El Messiri', 0.11, 0.5, 0.72, { weight: 'bold', fill: '#e8590c' }),
    T('SIWA OASIS', 'Montserrat', 0.06, 0.5, 0.87, { spacing: 400 }),
  ], 'sand'),
  D('hb-desert-safari', 'travel', 'Desert safari', 'سفاري الصحرا', [
    S('circle', 0.52, 0.5, 0.3, { fill: '#d9480f' }),
    A('fluent-emoji-flat:camel', 0.36, 0.5, 0.34),
    T('سفاري', 'Lalezar', 0.24, 0.5, 0.66),
    T('DESERT SAFARI', 'Bebas Neue', 0.09, 0.5, 0.85, { spacing: 300, fill: '#ff922b' }),
  ], 'black'),
  D('hb-adventure', 'travel', 'Adventure is calling', 'المغامرة بتنادي', [
    A('fluent-emoji-flat:snow-capped-mountain', 0.4, 0.5, 0.22),
    T('ADVENTURE', 'Anton', 0.17, 0.5, 0.5),
    T('IS CALLING', 'Anton', 0.12, 0.5, 0.67, { fill: '#ffd43b' }),
    T('المغامرة بتنادي', 'Changa', 0.08, 0.5, 0.85, { weight: 'bold' }),
  ], 'forest'),
  D('hb-family-trip', 'travel', 'Family trip with year', 'رحلة العيلة بالسنة', [
    A('fluent-emoji-flat:airplane', 0.26, 0.5, 0.16),
    T('رحلة العيلة', 'Lalezar', 0.13, 0.5, 0.4, { fill: '#ffffff', bg: BLUE, bgShape: 'pill' }),
    T('2025', 'Anton', 0.28, 0.5, 0.64, { fill: BLUE }),
    T('FAMILY TRIP', 'Montserrat', 0.06, 0.5, 0.86, { weight: 'bold', spacing: 400 }),
  ]),
  D('hb-shella-trip', 'travel', 'Friends trip with year', 'رحلة الشلة بالسنة', [
    A('fluent-emoji-flat:sunglasses', 0.3, 0.5, 0.15),
    T('رحلة', 'Lalezar', 0.2, 0.5, 0.36),
    T('الشلة', 'Lalezar', 0.3, 0.5, 0.58, { fill: ACCENT }),
    T('2025', 'Bungee', 0.1, 0.5, 0.83, { fill: '#ffffff', bg: ACCENT, bgShape: 'box' }),
  ], 'white'),
];

module.exports = { categories, designs };
