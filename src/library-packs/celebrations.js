'use strict';

// Celebrations: birthdays, weddings & engagements, graduation, new baby.
const { T, S, K, A, D, ACCENT, GOLD, PINK, BLUE, PURPLE, TEAL } = require('../library-dsl');

const DARK = '#16181d';
const WHITE = '#ffffff';
const ROSE = '#f783ac';
const SKY = '#74c0fc';
const SUN = '#ffd43b';
const MINT = '#63e6be';
const BURGUNDY = '#a61e4d';

const categories = [
  { id: 'wedding', name: { en: 'Weddings & engagement', ar: 'أفراح وخطوبة' } },
  { id: 'graduation', name: { en: 'Graduation', ar: 'تخرج' } },
  { id: 'baby', name: { en: 'New baby', ar: 'مولود جديد' } },
];

// Fine-tuning the subject's products (src/library.js FITS): what a baby or a child
// wears, and the grown-up birthdays that are not for kids' clothes.
const ONESIE = { alsoProducts: ['onesie'] };
const KIDS_CLOTHES = { alsoProducts: ['kidstee', 'kidshoodie'] };
const GROWN_UP = { notProducts: ['kidstee', 'kidshoodie'] };

const designs = [
  // ---------- Birthday ----------
  D('ce-bday-ya-sara', 'birthday', 'Happy birthday with name', 'عيد ميلاد سعيد يا سارة', [
    K('balloons', 0.38, 0.5, 0.21),
    T('عيد ميلاد سعيد', 'Lalezar', 0.145, 0.5, 0.52),
    T('يا سارة', 'Aref Ruqaa', 0.25, 0.5, 0.76, { weight: 'bold', fill: PINK, sampleName: 'name', samplePart: 'سارة' }),
  ]),
  D('ce-happy-bday-arch', 'birthday', 'Happy birthday cake (name)', 'هابي بيرث داي بالاسم', [
    T('HAPPY BIRTHDAY', 'Bungee', 0.1, 0.5, 0.2, { curve: 35 }),
    A('fluent-emoji-flat:birthday-cake', 0.36, 0.5, 0.47),
    T('Ahmed', 'Pacifico', 0.15, 0.5, 0.8, { fill: ACCENT, sampleName: 'name' }),
  ]),
  D('ce-birthday-girl', 'birthday', 'Birthday girl', 'صاحبة عيد الميلاد', [
    A('fluent-emoji-flat:crown', 0.24, 0.5, 0.22),
    T('Birthday', 'Pacifico', 0.17, 0.5, 0.5, { fill: PINK }),
    T('GIRL', 'Bebas Neue', 0.26, 0.5, 0.74, { spacing: 250 }),
  ]),
  D('ce-birthday-boy', 'birthday', 'Birthday boy', 'صاحب عيد الميلاد', [
    K('party-hat', 0.22, 0.5, 0.2),
    T('BIRTHDAY', 'Bungee', 0.12, 0.5, 0.47),
    T('BOY', 'Bungee', 0.28, 0.5, 0.7, { fill: BLUE, extrude: DARK }),
  ]),
  D('ce-30-fabulous', 'birthday', '30 and fabulous', '30 وفي أحلى حالاتي', [
    A('fluent-emoji-flat:sparkles', 0.13, 0.74, 0.2),
    T('30', 'Abril Fatface', 0.5, 0.5, 0.4, { fill: GOLD }),
    T('& FABULOUS', 'Playfair Display', 0.09, 0.5, 0.72, { spacing: 150 }),
  ], 'black', GROWN_UP),
  D('ce-40-lessa-shabab', 'birthday', '40 and still young', '40 ولسه شباب', [
    T('40', 'Anton', 0.52, 0.5, 0.38, { fill: ACCENT }),
    T('ولسه شباب', 'Lalezar', 0.17, 0.5, 0.74),
  ], 'heather', GROWN_UP),
  D('ce-18-kebert', 'birthday', '18 all grown up (neon)', '18 كبرت خلاص', [
    T('18', 'Righteous', 0.46, 0.5, 0.38, { fill: WHITE, glow: PINK }),
    T('كبرت خلاص', 'Lalezar', 0.15, 0.5, 0.73, { fill: ROSE }),
  ], 'black', GROWN_UP),
  D('ce-50-nos-2arn', 'birthday', '50: half a century of sweetness', '50 نص قرن من الحلاوة', [
    T('50', 'Abril Fatface', 0.46, 0.5, 0.32, { fill: GOLD }),
    T('نص قرن', 'Lalezar', 0.17, 0.5, 0.62),
    T('من الحلاوة', 'Marhey', 0.11, 0.5, 0.81, { weight: 'bold', fill: GOLD }),
  ], 'navy', GROWN_UP),
  D('ce-bday-queen', 'birthday', 'Birthday queen', 'ملكة عيد الميلاد', [
    A('fluent-emoji-flat:crown', 0.26, 0.5, 0.2),
    T('ملكة', 'Aref Ruqaa', 0.28, 0.5, 0.5, { weight: 'bold' }),
    T('عيد الميلاد', 'Lalezar', 0.13, 0.5, 0.76, { fill: GOLD }),
  ], 'black'),
  D('ce-saheb-el-eid', 'birthday', 'The birthday boy badge (name)', 'صاحب العيد بالاسم', [
    S('circle', 0.66, 0.5, 0.42, { fill: BLUE }),
    K('party-hat', 0.2, 0.5, 0.12),
    T('صاحب', 'Lalezar', 0.12, 0.5, 0.36, { fill: WHITE }),
    T('العيد', 'Lalezar', 0.2, 0.5, 0.5, { fill: SUN }),
    T('Ahmed', 'Pacifico', 0.12, 0.5, 0.84, { sampleName: 'name' }),
  ]),
  D('ce-kid-5-years', 'birthday', 'Kids birthday: I turned 5', 'أنا كملت 5 سنين', [
    A('fluent-emoji-flat:balloon', 0.22, 0.22, 0.43, { angle: -12 }),
    A('fluent-emoji-flat:balloon', 0.22, 0.78, 0.43, { angle: 12 }),
    T('أنا كملت', 'Marhey', 0.12, 0.5, 0.16, { weight: 'bold' }),
    T('5', 'Bungee', 0.42, 0.5, 0.45, { fill: ACCENT, extrude: DARK }),
    T('سنين', 'Marhey', 0.15, 0.5, 0.78, { weight: 'bold', fill: PURPLE }),
  ]),
  D('ce-first-birthday', 'birthday', 'Baby\'s first birthday', 'عيد ميلادي الأول', [
    A('fluent-emoji-flat:teddy-bear', 0.32, 0.5, 0.24),
    T('عيد ميلادي', 'Lemonada', 0.12, 0.5, 0.57, { weight: 'bold' }),
    T('الأول', 'Lalezar', 0.2, 0.5, 0.78, { fill: TEAL }),
  ], 'white', ONESIE),
  D('ce-bday-squad-ar', 'birthday', 'Birthday squad (Arabic)', 'شلة عيد الميلاد', [
    K('confetti', 0.26, 0.5, 0.17),
    T('شلة', 'Lalezar', 0.32, 0.5, 0.46, { fill: GOLD }),
    T('عيد الميلاد', 'Changa', 0.1, 0.5, 0.74, { weight: 'bold', fill: WHITE, bg: ACCENT, bgShape: 'banner' }),
  ], 'black'),
  D('ce-bday-family', 'birthday', 'Birthday family set', 'عيلة صاحب العيد', [
    K('cake', 0.32, 0.5, 0.2),
    T('عيلة', 'Lalezar', 0.26, 0.5, 0.5),
    T('صاحب العيد', 'Aref Ruqaa', 0.19, 0.5, 0.75, { weight: 'bold', fill: BURGUNDY }),
  ], 'heather'),
  D('ce-team-bday', 'birthday', 'Team birthday girl (name)', 'تيم صاحبة العيد بالاسم', [
    T('TEAM', 'Bebas Neue', 0.14, 0.5, 0.2, { spacing: 300 }),
    T('سارة', 'Aref Ruqaa', 0.32, 0.5, 0.45, { weight: 'bold', fill: PINK, sampleName: 'name' }),
    T('عيد ميلاد سعيد', 'Changa', 0.085, 0.5, 0.71, { weight: 'bold' }),
    K('hearts', 0.16, 0.5, 0.87),
  ]),
  D('ce-vintage-1995', 'birthday', 'Vintage 1995 aged to perfection', 'مواليد 1995 فينتدج', [
    T('VINTAGE', 'Bebas Neue', 0.15, 0.5, 0.2, { spacing: 250 }),
    T('1995', 'Abril Fatface', 0.3, 0.5, 0.42, { fill: BURGUNDY }),
    T('AGED TO PERFECTION', 'Montserrat', 0.055, 0.5, 0.63, { weight: 'bold', spacing: 150 }),
    T('LIMITED EDITION', 'Oswald', 0.065, 0.5, 0.8, { fill: WHITE, bg: BURGUNDY, bgShape: 'ticket', spacing: 100 }),
  ], 'sand', GROWN_UP),
  D('ce-kol-sana-w-enti-tayba', 'birthday', 'Many happy returns (her)', 'كل سنة وإنتِ طيبة', [
    K('gift', 0.26, 0.5, 0.2),
    T('كل سنة', 'Aref Ruqaa', 0.2, 0.5, 0.5, { weight: 'bold' }),
    T('وإنتِ طيبة', 'Aref Ruqaa', 0.18, 0.5, 0.74, { weight: 'bold', fill: PINK }),
  ]),

  // ---------- Weddings & engagement ----------
  D('ce-el-3arousa', 'wedding', 'The bride', 'العروسة', [
    A('fluent-emoji-flat:bouquet', 0.28, 0.5, 0.2),
    T('العروسة', 'Aref Ruqaa', 0.28, 0.5, 0.52, { weight: 'bold' }),
    T('BRIDE', 'Playfair Display', 0.085, 0.5, 0.77, { spacing: 500, fill: '#b07d1a' }),
  ]),
  D('ce-el-3aris', 'wedding', 'The groom', 'العريس', [
    A('mdi:bow-tie', 0.26, 0.5, 0.2, { fill: GOLD }),
    T('العريس', 'Aref Ruqaa', 0.28, 0.5, 0.48, { weight: 'bold' }),
    T('GROOM', 'Playfair Display', 0.08, 0.5, 0.73, { spacing: 500, fill: GOLD }),
  ], 'black'),
  D('ce-shellet-el-3arousa', 'wedding', 'Bride squad (Arabic)', 'شلة العروسة', [
    A('fluent-emoji-flat:ring', 0.18, 0.5, 0.15),
    T('شلة', 'Lalezar', 0.3, 0.5, 0.4, { fill: PINK }),
    T('العروسة', 'Aref Ruqaa', 0.19, 0.5, 0.64, { weight: 'bold' }),
    T('BRIDE SQUAD', 'Montserrat', 0.06, 0.5, 0.84, { weight: 'bold', spacing: 300 }),
  ]),
  D('ce-regalet-el-3aris', 'wedding', 'Groom squad (Arabic)', 'رجالة العريس', [
    K('crown', 0.24, 0.5, 0.17),
    T('رجالة', 'Lalezar', 0.26, 0.5, 0.44, { fill: GOLD }),
    T('العريس', 'Lalezar', 0.2, 0.5, 0.68),
    T('GROOM SQUAD', 'Montserrat', 0.055, 0.5, 0.86, { weight: 'bold', spacing: 300, fill: GOLD }),
  ], 'navy'),
  D('ce-et5atabna', 'wedding', 'We got engaged', 'اتخطبنا', [
    A('fluent-emoji-flat:ring', 0.28, 0.5, 0.22),
    T('اتخطبنا', 'Lalezar', 0.24, 0.5, 0.55, { fill: PINK }),
    T('أخيرًا', 'Marhey', 0.14, 0.5, 0.78, { weight: 'bold' }),
  ]),
  D('ce-save-the-date', 'wedding', 'Save the date', 'احفظ التاريخ', [
    T('SAVE THE DATE', 'Playfair Display', 0.075, 0.5, 0.17, { spacing: 200 }),
    T('12.12', 'Abril Fatface', 0.28, 0.5, 0.38),
    T('2026', 'Montserrat', 0.07, 0.5, 0.56, { weight: 'bold', spacing: 500, fill: GOLD }),
    S('heart', 0.08, 0.5, 0.68, { fill: PINK }),
    T('أحمد و سارة', 'Aref Ruqaa', 0.13, 0.5, 0.83, { weight: 'bold', sampleName: 'names' }),
  ]),
  D('ce-katabna-el-ketab', 'wedding', 'We signed the marriage contract', 'كتبنا الكتاب', [
    K('rings', 0.26, 0.5, 0.2),
    T('كتبنا', 'Aref Ruqaa', 0.22, 0.5, 0.48, { weight: 'bold' }),
    T('الكتاب', 'Aref Ruqaa', 0.22, 0.5, 0.7, { weight: 'bold', fill: GOLD }),
  ], 'navy'),
  D('ce-leilet-el-7enna', 'wedding', 'Henna night', 'ليلة الحنة', [
    A('ph:flower-lotus', 0.26, 0.5, 0.18, { fill: SUN }),
    T('ليلة', 'Aref Ruqaa', 0.17, 0.5, 0.42, { weight: 'bold', fill: SUN }),
    T('الحنة', 'Aref Ruqaa', 0.3, 0.5, 0.64, { weight: 'bold', fill: WHITE }),
    T('سارة', 'Lalezar', 0.12, 0.5, 0.86, { fill: SUN, sampleName: 'name' }),
  ], 'red'),
  D('ce-3arousa-3la-wesh-gawaz', 'wedding', 'Bride to be (Arabic)', 'عروسة على وش جواز', [
    T('عروسة', 'Lalezar', 0.28, 0.5, 0.3, { fill: PINK }),
    T('على وش جواز', 'Marhey', 0.13, 0.5, 0.56, { weight: 'bold' }),
    A('fluent-emoji-flat:sparkling-heart', 0.24, 0.5, 0.8),
  ]),
  D('ce-just-married', 'wedding', 'Just married', 'لسه متجوزين', [
    T('Just', 'Dancing Script', 0.2, 0.5, 0.28, { weight: 'bold', fill: ROSE }),
    T('MARRIED', 'Bebas Neue', 0.24, 0.5, 0.5, { spacing: 150 }),
    A('fluent-emoji-flat:two-hearts', 0.18, 0.5, 0.76),
  ], 'black'),
  D('ce-honeymoon', 'wedding', 'Honeymoon mode', 'شهر العسل', [
    A('fluent-emoji-flat:airplane', 0.26, 0.5, 0.2, { angle: -10 }),
    T('شهر العسل', 'Lalezar', 0.19, 0.5, 0.5, { fill: SUN }),
    T('HONEYMOON MODE: ON', 'Montserrat', 0.055, 0.5, 0.72, { weight: 'bold', spacing: 150 }),
    A('fluent-emoji-flat:beach-with-umbrella', 0.2, 0.5, 0.86),
  ], 'navy'),
  D('ce-wifey', 'wedding', 'Wifey', 'Wifey مراتي', [
    T('Wifey', 'Pacifico', 0.26, 0.5, 0.4, { fill: PINK }),
    T('حبيبة جوزها', 'Aref Ruqaa', 0.15, 0.5, 0.68, { weight: 'bold' }),
    A('fluent-emoji-flat:red-heart', 0.16, 0.5, 0.87),
  ]),
  D('ce-hubby', 'wedding', 'Hubby', 'Hubby جوزي', [
    T('Hubby', 'Pacifico', 0.26, 0.5, 0.4, { fill: SKY }),
    T('حبيب مراته', 'Aref Ruqaa', 0.15, 0.5, 0.68, { weight: 'bold' }),
    A('fluent-emoji-flat:blue-heart', 0.16, 0.5, 0.87),
  ], 'navy'),
  D('ce-forever-ring-badge', 'wedding', 'Together forever badge', 'مع بعض للأبد', [
    S('ring', 0.74, 0.5, 0.45, { fill: GOLD }),
    T('مع بعض', 'Aref Ruqaa', 0.17, 0.5, 0.37, { weight: 'bold' }),
    T('للأبد', 'Aref Ruqaa', 0.18, 0.5, 0.55, { weight: 'bold', fill: GOLD }),
    T('EST. 2026', 'Playfair Display', 0.06, 0.5, 0.87, { spacing: 300 }),
  ], 'black'),

  // ---------- Graduation ----------
  D('ce-class-of-2025', 'graduation', 'Class of 2026', 'دفعة 2026', [
    K('grad-cap', 0.28, 0.5, 0.2),
    T('CLASS OF', 'Bebas Neue', 0.15, 0.5, 0.46, { spacing: 250 }),
    T('2026', 'Anton', 0.32, 0.5, 0.7, { fill: GOLD }),
  ], 'navy'),
  D('ce-et5aragt-a5eran', 'graduation', 'Finally graduated', 'اتخرجت أخيرًا', [
    A('fluent-emoji-flat:graduation-cap', 0.3, 0.5, 0.2),
    T('اتخرجت', 'Lalezar', 0.26, 0.5, 0.52),
    T('أخيرًا', 'Marhey', 0.16, 0.5, 0.77, { weight: 'bold', fill: ACCENT }),
  ]),
  D('ce-dof3a-2025', 'graduation', 'Graduating class 2026 (Arabic)', 'دفعة 2026', [
    T('دفعة', 'Lalezar', 0.22, 0.5, 0.26, { fill: WHITE }),
    T('2026', 'Bungee', 0.24, 0.5, 0.52, { fill: SUN, glow: GOLD }),
    T('اسم الكلية', 'Changa', 0.08, 0.5, 0.76, { weight: 'bold', fill: DARK, bg: SUN, bgShape: 'pill' }),
  ], 'black'),
  D('ce-grad-doctora', 'graduation', 'Doctor graduate (her name)', 'الدكتورة سارة', [
    A('fluent-emoji-flat:stethoscope', 0.26, 0.5, 0.18),
    T('الدكتورة', 'Reem Kufi', 0.13, 0.5, 0.42, { weight: 'bold', fill: TEAL }),
    T('سارة', 'Aref Ruqaa', 0.28, 0.5, 0.62, { weight: 'bold', sampleName: 'name' }),
    T('دفعة 2026', 'Changa', 0.07, 0.5, 0.84, { weight: 'bold', fill: TEAL }),
  ]),
  D('ce-grad-bashmohandes', 'graduation', 'Engineer graduate (name)', 'الباشمهندس أحمد', [
    A('fluent-emoji-flat:gear', 0.24, 0.5, 0.18),
    T('الباشمهندس', 'Lalezar', 0.14, 0.5, 0.42),
    T('أحمد', 'Lalezar', 0.28, 0.5, 0.63, { fill: BLUE, sampleName: 'name' }),
    T('دفعة 2026', 'Changa', 0.07, 0.5, 0.85, { weight: 'bold' }),
  ], 'heather'),
  D('ce-grad-mo7ami', 'graduation', 'Lawyer graduate (name)', 'المحامي أحمد', [
    A('fluent-emoji-flat:balance-scale', 0.26, 0.5, 0.18),
    T('المحامي', 'Reem Kufi', 0.13, 0.5, 0.42, { weight: 'bold' }),
    T('أحمد', 'Aref Ruqaa', 0.28, 0.5, 0.62, { weight: 'bold', fill: GOLD, sampleName: 'name' }),
    T('دفعة 2026', 'Changa', 0.07, 0.5, 0.84, { weight: 'bold' }),
  ], 'navy'),
  D('ce-om-el-5areeg', 'graduation', 'Proud mum of the graduate', 'أم الخريج فخورة', [
    T('أم الخريج', 'Lalezar', 0.19, 0.5, 0.26),
    T('فخورة بيه', 'Aref Ruqaa', 0.19, 0.5, 0.5, { weight: 'bold', fill: PINK }),
    T('PROUD MOM', 'Montserrat', 0.065, 0.5, 0.7, { weight: 'bold', spacing: 300 }),
    A('fluent-emoji-flat:graduation-cap', 0.2, 0.5, 0.86),
  ]),
  D('ce-abu-el-5areega', 'graduation', 'Proud dad of the graduate', 'أبو الخريجة فخور', [
    T('أبو الخريجة', 'Lalezar', 0.17, 0.5, 0.26),
    T('فخور بيها', 'Aref Ruqaa', 0.19, 0.5, 0.5, { weight: 'bold', fill: GOLD }),
    T('PROUD DAD', 'Montserrat', 0.065, 0.5, 0.7, { weight: 'bold', spacing: 300 }),
    A('tabler:school', 0.18, 0.5, 0.86, { fill: GOLD }),
  ], 'navy'),
  D('ce-mafish-emte7anat', 'graduation', 'No more exams', 'مفيش امتحانات تاني', [
    K('books', 0.32, 0.5, 0.19),
    T('مفيش امتحانات', 'Lalezar', 0.14, 0.5, 0.48),
    T('تاني!', 'Lalezar', 0.24, 0.5, 0.72, { fill: ACCENT }),
  ], 'sand'),
  D('ce-graduate-laurel', 'graduation', 'Graduate laurel 2026', 'Graduate 2026', [
    A('tabler:laurel-wreath', 0.72, 0.5, 0.4, { fill: GOLD }),
    T('25', 'Abril Fatface', 0.17, 0.5, 0.39, { fill: WHITE }),
    T('GRADUATE', 'Playfair Display', 0.1, 0.5, 0.76, { spacing: 250 }),
  ], 'forest'),
  D('ce-tassel-hassle', 'graduation', 'The tassel was worth the hassle', 'التخرج كان يستاهل التعب', [
    T('THE TASSEL', 'Bebas Neue', 0.2, 0.5, 0.26),
    T('WAS WORTH THE', 'Montserrat', 0.07, 0.5, 0.46, { weight: 'bold', spacing: 200 }),
    T('HASSLE', 'Bebas Neue', 0.3, 0.5, 0.66, { fill: GOLD }),
    A('tabler:school', 0.16, 0.5, 0.88, { fill: GOLD }),
  ], 'black'),
  D('ce-5areeg-kolleya', 'graduation', 'Faculty graduate (editable)', 'خريج كلية التجارة', [
    A('fluent-emoji-flat:scroll', 0.24, 0.5, 0.18),
    T('خريج', 'Lalezar', 0.26, 0.5, 0.44),
    T('كلية التجارة', 'Changa', 0.1, 0.5, 0.67, { weight: 'bold', fill: WHITE, bg: BLUE, bgShape: 'pill' }),
    T('2026', 'Bebas Neue', 0.1, 0.5, 0.85, { spacing: 300 }),
  ]),

  // ---------- New baby ----------
  D('ce-welcome-baby', 'baby', 'Welcome baby (name)', 'Welcome baby بالاسم', [
    A('fluent-emoji-flat:baby-bottle', 0.24, 0.5, 0.18, { angle: 15 }),
    T('Welcome', 'Pacifico', 0.17, 0.5, 0.45, { fill: TEAL }),
    T('BABY', 'Bebas Neue', 0.16, 0.5, 0.65, { spacing: 400 }),
    T('آدم', 'Aref Ruqaa', 0.18, 0.5, 0.84, { weight: 'bold', fill: TEAL, sampleName: 'baby' }),
  ], 'white', ONESIE),
  D('ce-sebou3', 'baby', 'Sebou3 party (name)', 'سبوع سارة', [
    A('fluent-emoji-flat:candle', 0.2, 0.34, 0.16, { angle: -12 }),
    A('fluent-emoji-flat:candle', 0.22, 0.5, 0.14),
    A('fluent-emoji-flat:candle', 0.2, 0.66, 0.16, { angle: 12 }),
    T('سبوع', 'Lalezar', 0.3, 0.5, 0.43, { fill: PINK }),
    T('سارة', 'Aref Ruqaa', 0.22, 0.5, 0.66, { weight: 'bold', sampleName: 'baby' }),
    T('حلقة برجالاتك', 'Marhey', 0.09, 0.5, 0.85, { weight: 'bold', fill: PINK }),
  ], 'white', ONESIE),
  D('ce-ahlan-bel-nono', 'baby', 'Welcome little one (Arabic)', 'أهلًا بالنونو', [
    A('fluent-emoji-flat:baby', 0.3, 0.5, 0.22),
    T('أهلًا', 'Marhey', 0.15, 0.5, 0.52, { weight: 'bold' }),
    T('بالنونو', 'Lalezar', 0.24, 0.5, 0.75, { fill: TEAL }),
  ], 'white', ONESIE),
  D('ce-big-sister', 'baby', 'Big sister', 'الأخت الكبيرة', [
    A('fluent-emoji-flat:crown', 0.2, 0.5, 0.16),
    T('BIG', 'Bebas Neue', 0.2, 0.5, 0.38, { spacing: 300 }),
    T('SISTER', 'Bebas Neue', 0.2, 0.5, 0.56, { fill: PINK, spacing: 200 }),
    T('أنا الأخت الكبيرة', 'Changa', 0.08, 0.5, 0.78, { weight: 'bold', fill: WHITE, bg: PINK, bgShape: 'pill' }),
  ], 'white', KIDS_CLOTHES),
  D('ce-big-brother', 'baby', 'Big brother', 'الأخ الكبير', [
    K('star-student', 0.2, 0.5, 0.16),
    T('BIG', 'Bebas Neue', 0.2, 0.5, 0.38, { spacing: 300 }),
    T('BROTHER', 'Bebas Neue', 0.2, 0.5, 0.56, { fill: BLUE, spacing: 150 }),
    T('أنا الأخ الكبير', 'Changa', 0.08, 0.5, 0.78, { weight: 'bold', fill: WHITE, bg: BLUE, bgShape: 'pill' }),
  ], 'white', KIDS_CLOTHES),
  D('ce-mama-2orayeb', 'baby', 'Mum to be', 'ماما قريب', [
    T('ماما', 'Lalezar', 0.32, 0.5, 0.32, { fill: PINK }),
    T('قريب أوي', 'Marhey', 0.13, 0.5, 0.58, { weight: 'bold' }),
    A('fluent-emoji-flat:heart-with-ribbon', 0.24, 0.5, 0.8),
  ]),
  D('ce-baba-2orayeb', 'baby', 'Dad to be', 'بابا قريب', [
    T('بابا', 'Lalezar', 0.32, 0.5, 0.32, { fill: SKY }),
    T('قريب أوي', 'Marhey', 0.13, 0.5, 0.58, { weight: 'bold' }),
    A('fluent-emoji-flat:baby-bottle', 0.22, 0.5, 0.8, { angle: 15 }),
  ], 'navy'),
  D('ce-walad-wala-bent', 'baby', 'Boy or girl? (gender reveal)', 'ولد ولا بنت؟', [
    T('ولد', 'Lalezar', 0.26, 0.5, 0.22, { fill: BLUE }),
    T('ولا', 'Marhey', 0.12, 0.5, 0.44, { weight: 'bold' }),
    T('بنت؟', 'Lalezar', 0.26, 0.5, 0.65, { fill: PINK }),
    A('fluent-emoji-flat:baby', 0.18, 0.5, 0.86),
  ]),
  D('ce-teta-awel-mara', 'baby', 'New grandma', 'تيتا لأول مرة', [
    A('fluent-emoji-flat:baby-angel', 0.24, 0.5, 0.18),
    T('تيتا', 'Aref Ruqaa', 0.3, 0.5, 0.46, { weight: 'bold', fill: PURPLE }),
    T('لأول مرة', 'Changa', 0.1, 0.5, 0.71, { weight: 'bold' }),
    T('NEW GRANDMA', 'Montserrat', 0.055, 0.5, 0.86, { weight: 'bold', spacing: 300, fill: PURPLE }),
  ], 'sand'),
  D('ce-baby-loading', 'baby', 'Baby loading', 'بيبي جاي في الطريق', [
    A('fluent-emoji-flat:baby', 0.24, 0.5, 0.2),
    T('BABY', 'Bungee', 0.16, 0.5, 0.45, { fill: MINT }),
    T('LOADING...', 'Bungee', 0.09, 0.5, 0.6),
    T('جاي في السكة', 'Marhey', 0.1, 0.5, 0.79, { weight: 'bold', fill: MINT }),
  ], 'black'),
];

module.exports = { categories, designs };
