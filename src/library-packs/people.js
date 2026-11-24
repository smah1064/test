'use strict';

// People pack: kids, school & teachers, pets, business & teams.
const { T, S, K, A, D, ACCENT, GOLD, GREEN, PINK, BLUE, PURPLE, TEAL, RED } = require('../library-dsl');

const WHITE = '#ffffff';
const INK = '#16181d';
const BROWN = '#7a4a2b';
const fe = (name) => `fluent-emoji-flat:${name}`;

// Where the business designs go (the subject's list is in src/library.js FITS):
// staff and crew shirts are worn and pinned on, not printed on the shop's paper;
// events also get certificates, but no letterhead, invoices or shopping bags.
const STAFF = { notProducts: ['bizcards', 'flyers', 'letterhead', 'dlenvelopes', 'logostickers', 'rollup', 'paperbags', 'invoicebook', 'sign', 'coasters', 'apron', 'deskmat', 'mousepad',
  'giftvouchers', 'brochures', 'menus', 'notepads', 'folders', 'booklets', 'labels', 'windowstickers', 'calendar', 'deskcalendar', 'magnets', 'banners'] };
// Teachers' designs: not on the children's clothes and school things.
const TEACHER = { notProducts: ['kidstee', 'kidshoodie', 'jersey', 'namelabels', 'lunchbag', 'pencilcase', 'stickersheet', 'idcards'] };
// Events keep the brochures, booklets (programmes), folders and notepads handed out there.
const EVENT = { alsoProducts: ['certificates'], notProducts: ['bizcards', 'letterhead', 'dlenvelopes', 'paperbags', 'invoicebook', 'apron', 'coasters', 'giftvouchers', 'menus', 'labels', 'windowstickers', 'calendar', 'deskcalendar', 'magnets'] };

const categories = [
  { id: 'kids', name: { en: 'Kids', ar: 'أطفال' } },
  { id: 'school', name: { en: 'School & teachers', ar: 'مدرسة ومدرسين' } },
  { id: 'pets', name: { en: 'Pets', ar: 'حيوانات أليفة' } },
  { id: 'business', name: { en: 'Business & teams', ar: 'شركات وفرق' } },
];

const designs = [
  // ---------- Kids ----------
  D('pp-kids-little-hero', 'kids', 'The little hero', 'البطل الصغير', [
    S('shield', 0.44, 0.5, 0.3, { fill: BLUE }),
    S('star', 0.2, 0.5, 0.28, { fill: GOLD }),
    T('البطل', 'Lalezar', 0.22, 0.5, 0.64),
    T('الصغير', 'Marhey', 0.14, 0.5, 0.84, { fill: RED, weight: 'bold' }),
  ]),
  D('pp-kids-princess-name', 'kids', 'Little princess with name', 'الأميرة الصغيرة باسمها', [
    A(fe('crown'), 0.28, 0.5, 0.2),
    T('الأميرة', 'Aref Ruqaa', 0.2, 0.5, 0.48, { weight: 'bold', fill: PINK }),
    T('سارة', 'Lalezar', 0.26, 0.5, 0.74),
    K('sparkle', 0.1, 0.2, 0.36),
    K('sparkle', 0.08, 0.8, 0.62),
  ]),
  D('pp-kids-little-prince', 'kids', 'Little prince with name', 'الأمير الصغير باسمه', [
    A(fe('crown'), 0.26, 0.5, 0.18),
    T('LITTLE', 'Montserrat', 0.06, 0.5, 0.36, { spacing: 300, weight: 'bold' }),
    T('PRINCE', 'Abril Fatface', 0.17, 0.5, 0.5),
    T('Adam', 'Pacifico', 0.14, 0.5, 0.74, { fill: GOLD }),
  ], 'navy'),
  D('pp-kids-dino-roar', 'kids', 'Dino roar', 'ديناصور البيت', [
    A(fe('t-rex'), 0.5, 0.5, 0.3),
    T('ROAR!', 'Bungee', 0.15, 0.5, 0.64, { fill: GREEN, extrude: '#1b5e20' }),
    T('ديناصور البيت', 'Marhey', 0.1, 0.5, 0.84, { weight: 'bold' }),
  ]),
  D('pp-kids-dino-age', 'kids', 'Dino birthday age 5', 'عندي ٥ سنين ديناصور', [
    T('5', 'Anton', 0.5, 0.3, 0.32, { fill: GREEN }),
    A(fe('sauropod'), 0.38, 0.68, 0.32),
    T('عندي ٥ سنين', 'Lalezar', 0.16, 0.5, 0.66),
    T('وزئيري عالي', 'Marhey', 0.1, 0.5, 0.84, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('pp-kids-space-explorer', 'kids', 'Space explorer', 'مستكشف الفضاء', [
    A(fe('rocket'), 0.3, 0.5, 0.24),
    A(fe('ringed-planet'), 0.16, 0.2, 0.14),
    K('stars', 0.12, 0.8, 0.32),
    T('مستكشف', 'Lalezar', 0.2, 0.5, 0.6),
    T('الفضاء', 'Reem Kufi', 0.15, 0.5, 0.8, { fill: GOLD, weight: 'bold' }),
  ], 'navy'),
  D('pp-kids-space-cadet', 'kids', 'Space cadet', 'Space cadet رائد فضاء', [
    A(fe('astronaut'), 0.36, 0.5, 0.28),
    T('SPACE', 'Bungee', 0.16, 0.5, 0.6, { glow: '#4dabf7', fill: WHITE }),
    T('CADET', 'Bungee', 0.11, 0.5, 0.78, { fill: ACCENT }),
  ], 'black'),
  D('pp-kids-super-kid', 'kids', 'Super kid', 'سوبر كيد بطل خارق', [
    S('burst', 0.66, 0.5, 0.36, { fill: GOLD }),
    T('SUPER', 'Bungee', 0.13, 0.5, 0.3, { fill: RED, extrude: INK }),
    T('KID', 'Bungee', 0.17, 0.5, 0.45, { fill: BLUE, extrude: INK }),
    T('بطل خارق', 'Lalezar', 0.15, 0.5, 0.82),
  ]),
  D('pp-kids-first-day', 'kids', 'First day of school', 'أول يوم في المدرسة', [
    A(fe('backpack'), 0.28, 0.5, 0.2),
    T('أول يوم', 'Lalezar', 0.22, 0.5, 0.5),
    T('في المدرسة', 'Marhey', 0.13, 0.5, 0.69, { fill: BLUE, weight: 'bold' }),
    T('2026', 'Bungee', 0.07, 0.5, 0.86, { fill: INK, bg: GOLD, bgShape: 'pill' }),
  ], 'white', { notProducts: ['onesie'] }),
  D('pp-kids-letters', 'kids', 'My first letters', 'حروفي الأولى أ ب ت', [
    T('أ', 'Lalezar', 0.34, 0.72, 0.34, { fill: RED }),
    T('ب', 'Lalezar', 0.34, 0.5, 0.34, { fill: BLUE }),
    T('ت', 'Lalezar', 0.34, 0.28, 0.34, { fill: GREEN }),
    T('حروفي الأولى', 'Marhey', 0.12, 0.5, 0.72, { weight: 'bold' }),
    A(fe('pencil'), 0.14, 0.5, 0.88),
  ]),
  D('pp-kids-numbers', 'kids', 'Smart at numbers 123', 'شاطر في الحساب ١٢٣', [
    T('1', 'Bungee', 0.26, 0.25, 0.28, { fill: RED }),
    T('2', 'Bungee', 0.26, 0.5, 0.28, { fill: GOLD }),
    T('3', 'Bungee', 0.26, 0.75, 0.28, { fill: BLUE }),
    T('أنا شاطر', 'Lalezar', 0.2, 0.5, 0.6),
    T('في الحساب', 'Marhey', 0.12, 0.5, 0.8, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('pp-kids-jungle-king', 'kids', 'Little king of the jungle', 'ملك الغابة الصغير', [
    A(fe('lion'), 0.4, 0.5, 0.26),
    T('ملك الغابة', 'Lalezar', 0.18, 0.5, 0.6),
    T('الصغير', 'Marhey', 0.13, 0.5, 0.8, { fill: GOLD, weight: 'bold' }),
  ], 'forest'),
  D('pp-kids-animal-friends', 'kids', 'Animal friends', 'صحابي الحيوانات', [
    A(fe('panda'), 0.17, 0.2, 0.26),
    A(fe('rabbit-face'), 0.17, 0.4, 0.26),
    A(fe('fox'), 0.17, 0.6, 0.26),
    A(fe('koala'), 0.17, 0.8, 0.26),
    T('صحابي', 'Lalezar', 0.24, 0.5, 0.56),
    T('الحيوانات', 'Marhey', 0.13, 0.5, 0.78, { fill: TEAL, weight: 'bold' }),
  ]),
  D('pp-kids-little-dreamer', 'kids', 'Little dreamer unicorn', 'Little dreamer يونيكورن', [
    A(fe('unicorn'), 0.4, 0.5, 0.28),
    A(fe('rainbow'), 0.2, 0.78, 0.14),
    T('Little', 'Pacifico', 0.12, 0.5, 0.6, { fill: PINK }),
    T('DREAMER', 'Bebas Neue', 0.18, 0.5, 0.78, { fill: PURPLE }),
  ]),
  D('pp-kids-big-brother', 'kids', 'Big brother', 'الأخ الكبير', [
    K('star-student', 0.24, 0.5, 0.2),
    T('أنا الأخ', 'Lalezar', 0.16, 0.5, 0.48),
    T('الكبير', 'Lalezar', 0.28, 0.5, 0.72, { fill: BLUE }),
  ]),
  D('pp-kids-big-sister', 'kids', 'Big sister', 'الأخت الكبيرة', [
    A(fe('butterfly'), 0.24, 0.5, 0.2),
    T('أنا الأخت', 'Lalezar', 0.16, 0.5, 0.48),
    T('الكبيرة', 'Lalezar', 0.26, 0.5, 0.72, { fill: PINK }),
  ]),

  // ---------- School & teachers ----------
  D('pp-sch-best-teacher', 'school', 'Best teacher (male)', 'أحسن مدرس', [
    K('medal', 0.26, 0.5, 0.2),
    T('أحسن', 'Changa', 0.12, 0.5, 0.42, { weight: 'bold' }),
    T('مدرس', 'Lalezar', 0.3, 0.5, 0.62, { fill: BLUE }),
    T('في الدنيا', 'Marhey', 0.1, 0.5, 0.84, { weight: 'bold' }),
  ], 'white', TEACHER),
  D('pp-sch-best-teacher-f', 'school', 'Best teacher (female) with name', 'أحسن مدرسة باسمها', [
    A(fe('red-apple'), 0.24, 0.5, 0.18),
    T('أحسن', 'Marhey', 0.12, 0.5, 0.38, { weight: 'bold' }),
    T('مدرسة', 'Aref Ruqaa', 0.26, 0.5, 0.58, { weight: 'bold', fill: PINK }),
    T('ميس منى', 'Lemonada', 0.08, 0.5, 0.84, { weight: 'bold', fill: WHITE, bg: PINK, bgShape: 'pill' }),
  ], 'white', TEACHER),
  D('pp-sch-class-trip', 'school', 'School trip with school name', 'رحلة المدرسة باسم المدرسة', [
    A(fe('bus'), 0.34, 0.5, 0.2),
    T('رحلة', 'Lalezar', 0.26, 0.5, 0.46),
    T(' مدرسة النور ', 'Lemonada', 0.08, 0.5, 0.68, { weight: 'bold', fill: WHITE, bg: BLUE, bgShape: 'banner' }),
    T('2026', 'Bungee', 0.08, 0.5, 0.86, { fill: ACCENT }),
  ], 'sand'),
  D('pp-sch-exams-close', 'school', 'Exams are coming joke', 'الامتحانات قربت', [
    A(fe('open-book'), 0.22, 0.5, 0.16),
    T('الامتحانات', 'Lalezar', 0.16, 0.5, 0.38),
    T('قرّبت', 'Lalezar', 0.26, 0.5, 0.57, { fill: RED }),
    T('وأنا لسه بفتح الكتاب', 'Changa', 0.075, 0.5, 0.8, { weight: 'bold' }),
  ]),
  D('pp-sch-exam-survivor', 'school', 'Exam survivor', 'نجيت من الامتحانات', [
    A(fe('memo'), 0.22, 0.5, 0.16),
    T('EXAM', 'Anton', 0.2, 0.5, 0.4),
    T('SURVIVOR', 'Anton', 0.13, 0.5, 0.58, { fill: ACCENT }),
    T('نجيت بأعجوبة', 'Marhey', 0.1, 0.5, 0.8, { weight: 'bold' }),
  ], 'black'),
  D('pp-sch-teachers-day', 'school', 'Happy teachers day', 'يوم المعلم شكرًا يا معلمي', [
    A(fe('teacher'), 0.26, 0.5, 0.18),
    T('شكرًا يا معلمي', 'Aref Ruqaa', 0.15, 0.5, 0.44, { weight: 'bold' }),
    T('يوم المعلم', 'Reem Kufi', 0.1, 0.5, 0.62, { fill: GOLD, weight: 'bold' }),
    T("HAPPY TEACHERS' DAY", 'Montserrat', 0.045, 0.5, 0.8, { spacing: 150, weight: 'bold' }),
  ], 'navy'),
  D('pp-sch-school-team', 'school', 'School team emblem', 'فريق المدرسة', [
    S('shield', 0.5, 0.5, 0.36, { fill: BLUE }),
    T('SCHOOL TEAM', 'Bebas Neue', 0.06, 0.5, 0.25, { fill: WHITE, spacing: 150 }),
    T('النور', 'Lalezar', 0.15, 0.5, 0.37, { fill: WHITE }),
    S('star', 0.08, 0.5, 0.5, { fill: GOLD }),
    T('فريق المدرسة', 'Kufam', 0.11, 0.5, 0.82, { weight: 'bold' }),
  ], 'white'),
  D('pp-sch-class-of', 'school', 'Class of 2027', 'دفعة 2027', [
    K('grad-cap', 0.26, 0.5, 0.18),
    T('دفعة', 'Aref Ruqaa', 0.18, 0.5, 0.4, { weight: 'bold' }),
    T('2027', 'Anton', 0.32, 0.5, 0.64, { fill: GOLD }),
    T('CLASS OF 2027', 'Montserrat', 0.05, 0.5, 0.86, { spacing: 250, weight: 'bold' }),
  ], 'black'),
  D('pp-sch-top-of-class', 'school', 'Top of the class', 'الأول على الفصل', [
    K('star-student', 0.28, 0.5, 0.2),
    T('الأول', 'Lalezar', 0.3, 0.5, 0.5, { fill: GOLD }),
    T('على الفصل', 'Marhey', 0.13, 0.5, 0.76, { weight: 'bold' }),
  ]),
  D('pp-sch-cat-homework', 'school', 'The cat ate my homework', 'القطة أكلت الواجب', [
    A(fe('cat-face'), 0.26, 0.5, 0.18),
    T('القطة', 'Lalezar', 0.24, 0.5, 0.44),
    T('أكلت الواجب', 'Lalezar', 0.17, 0.5, 0.66, { fill: ACCENT }),
    T('والله يا ميس', 'Marhey', 0.08, 0.5, 0.85, { weight: 'bold' }),
  ]),
  D('pp-sch-teacher-coffee', 'school', 'Teacher runs on coffee', 'مدرس شغال بالقهوة', [
    A(fe('hot-beverage'), 0.26, 0.5, 0.2),
    T('مدرّس', 'Lalezar', 0.26, 0.5, 0.48),
    T('شغال بالقهوة والصبر', 'Changa', 0.08, 0.5, 0.72, { weight: 'bold', fill: BROWN }),
  ], 'sand', TEACHER),

  // ---------- Pets ----------
  D('pp-pet-cat-mom', 'pets', 'Cat mom', 'مامي القطط', [
    A(fe('smiling-cat-with-heart-eyes'), 0.3, 0.5, 0.22),
    T('مامي', 'Lalezar', 0.24, 0.5, 0.52, { fill: PINK }),
    T('القطط', 'Lalezar', 0.24, 0.5, 0.76),
  ]),
  D('pp-pet-dog-dad', 'pets', 'Dog dad', 'Dog dad بابا الكلاب', [
    A(fe('dog-face'), 0.3, 0.5, 0.2),
    T('DOG', 'Anton', 0.2, 0.5, 0.46),
    T('DAD', 'Anton', 0.28, 0.5, 0.7, { fill: ACCENT }),
  ], 'heather'),
  D('pp-pet-cat-name', 'pets', 'Cat name emblem', 'اسم القطة مشمش', [
    S('circle', 0.58, 0.5, 0.36, { fill: TEAL }),
    A('ph:paw-print-fill', 0.2, 0.5, 0.3, { fill: WHITE }),
    T('مشمش', 'Lalezar', 0.12, 0.5, 0.47, { fill: WHITE }),
    T('أحلى قطة في الدنيا', 'Changa', 0.08, 0.5, 0.82, { weight: 'bold' }),
  ]),
  D('pp-pet-good-boy', 'pets', 'Good boy dog name', 'اسم الكلب Good boy', [
    A('ph:bone-fill', 0.62, 0.5, 0.4, { fill: GOLD, angle: 45 }),
    T('MAX', 'Bungee', 0.13, 0.5, 0.38, { fill: INK }),
    T('GOOD BOY', 'Bebas Neue', 0.1, 0.5, 0.72, { spacing: 200 }),
    A('ph:paw-print-fill', 0.08, 0.5, 0.86, { fill: GOLD }),
  ], 'black'),
  D('pp-pet-cats-over-people', 'pets', 'I love cats more than people', 'بحب القطط أكتر من الناس', [
    A(fe('black-cat'), 0.26, 0.5, 0.16),
    T('بحب القطط', 'Lalezar', 0.18, 0.5, 0.4),
    T('أكتر من', 'Changa', 0.1, 0.5, 0.57, { weight: 'bold' }),
    T('الناس', 'Lalezar', 0.26, 0.5, 0.77, { fill: ACCENT }),
  ]),
  D('pp-pet-four-legs', 'pets', 'My four-legged friend', 'صاحبي بأربع رجلين', [
    S('heart', 0.42, 0.5, 0.28, { fill: PINK }),
    A('ph:paw-print-fill', 0.18, 0.5, 0.27, { fill: WHITE }),
    T('صاحبي', 'Lalezar', 0.22, 0.5, 0.62),
    T('بأربع رجلين', 'Marhey', 0.12, 0.5, 0.82, { fill: PINK, weight: 'bold' }),
  ]),
  D('pp-pet-cat-person', 'pets', 'Cat person', 'Cat person قطط', [
    A(fe('cat'), 0.36, 0.5, 0.26),
    T('CAT', 'Abril Fatface', 0.26, 0.5, 0.6),
    T('PERSON', 'Montserrat', 0.07, 0.5, 0.8, { spacing: 400, weight: 'bold', fill: BROWN }),
  ], 'sand'),
  D('pp-pet-adopt', 'pets', 'Adopt, don\'t shop', 'متشتريش اتبنّى', [
    A('ph:paw-print-fill', 0.22, 0.5, 0.18, { fill: TEAL }),
    T('متشتريش..', 'Changa', 0.11, 0.5, 0.4, { weight: 'bold' }),
    T('اتبنّى', 'Lalezar', 0.3, 0.5, 0.6, { fill: TEAL }),
    T("ADOPT DON'T SHOP", 'Bebas Neue', 0.07, 0.5, 0.84, { spacing: 150 }),
  ]),

  // ---------- Business & teams ----------
  D('pp-biz-staff', 'business', 'Staff shirt with company name', 'تيشيرت ستاف باسم الشركة', [
    T('COMPANY NAME', 'Montserrat', 0.055, 0.5, 0.24, { spacing: 300, weight: 'bold', fill: GOLD }),
    T('STAFF', 'Anton', 0.32, 0.5, 0.46, { spacing: 100 }),
    S('line', 0.5, 0.5, 0.66, { fill: GOLD }),
    T('اسم الشركة', 'Cairo', 0.08, 0.5, 0.77, { weight: 'bold' }),
  ], 'black', STAFF),
  D('pp-biz-team-badge', 'business', 'Team round badge', 'شعار فريق دائري TEAM', [
    S('ring', 0.7, 0.5, 0.38, { fill: BLUE }),
    T('اسم الفريق', 'Cairo', 0.07, 0.5, 0.26, { weight: 'bold' }),
    T('TEAM', 'Bebas Neue', 0.22, 0.5, 0.39, { fill: BLUE }),
    T('2026', 'Montserrat', 0.05, 0.5, 0.5, { spacing: 200, weight: 'bold' }),
    T('فريق العمل', 'Kufam', 0.1, 0.5, 0.86, { weight: 'bold' }),
  ], 'white', STAFF),
  D('pp-biz-cafe', 'business', 'Cafe logo with name', 'لوجو كافيه بالاسم', [
    S('ring', 0.72, 0.5, 0.42, { fill: BROWN }),
    A('ph:coffee-fill', 0.2, 0.5, 0.27, { fill: BROWN }),
    T('كافيه الركن', 'El Messiri', 0.11, 0.5, 0.43, { weight: 'bold' }),
    T('EST. 2026', 'Montserrat', 0.045, 0.5, 0.54, { spacing: 250, weight: 'bold', fill: BROWN }),
    T('COFFEE HOUSE', 'Bebas Neue', 0.09, 0.5, 0.86, { spacing: 250 }),
  ], 'sand'),
  D('pp-biz-restaurant', 'business', 'Restaurant logo with name', 'لوجو مطعم بالاسم', [
    A('ph:chef-hat-fill', 0.26, 0.5, 0.18, { fill: RED }),
    T('مطعم', 'Changa', 0.1, 0.5, 0.36, { weight: 'bold' }),
    T('الأصيل', 'Reem Kufi', 0.24, 0.5, 0.54, { fill: RED, weight: 'bold' }),
    S('line', 0.4, 0.5, 0.7, { fill: RED }),
    T('RESTAURANT', 'Montserrat', 0.055, 0.5, 0.8, { spacing: 300, weight: 'bold' }),
  ]),
  D('pp-biz-bakery', 'business', 'Bakery logo with name', 'لوجو مخبز بالاسم', [
    A(fe('croissant'), 0.28, 0.5, 0.18),
    T('مخبز', 'El Messiri', 0.12, 0.5, 0.38, { weight: 'bold' }),
    T('السنابل', 'Lalezar', 0.24, 0.5, 0.56, { fill: BROWN }),
    T(' BAKERY ', 'Oswald', 0.09, 0.5, 0.8, { fill: WHITE, bg: GOLD, bgShape: 'banner' }),
  ], 'sand'),
  D('pp-biz-salon', 'business', 'Beauty salon logo with name', 'لوجو صالون تجميل بالاسم', [
    A('ph:scissors-fill', 0.2, 0.5, 0.16, { fill: PINK, angle: -90 }),
    T('صالون', 'El Messiri', 0.12, 0.5, 0.36, { weight: 'bold' }),
    T('ليلى', 'Aref Ruqaa', 0.28, 0.5, 0.56, { weight: 'bold', fill: PINK }),
    T('BEAUTY SALON', 'Montserrat', 0.05, 0.5, 0.82, { spacing: 300, weight: 'bold' }),
  ]),
  D('pp-biz-barber', 'business', 'Barber shop logo with name', 'لوجو حلاق بالاسم', [
    A('mdi:mustache', 0.32, 0.5, 0.16, { fill: GOLD }),
    T('BARBER', 'Abril Fatface', 0.17, 0.5, 0.36),
    T('SHOP', 'Montserrat', 0.06, 0.5, 0.5, { spacing: 400, weight: 'bold', fill: GOLD }),
    T('صالون أحمد', 'El Messiri', 0.12, 0.5, 0.72, { weight: 'bold' }),
    T('EST. 2026', 'Montserrat', 0.04, 0.5, 0.86, { spacing: 250, fill: GOLD }),
  ], 'black'),
  D('pp-biz-gym', 'business', 'Gym logo with name', 'لوجو جيم بالاسم', [
    A('ph:barbell-fill', 0.44, 0.5, 0.18, { fill: RED }),
    T('POWER', 'Anton', 0.14, 0.5, 0.38, { spacing: 100 }),
    T('GYM', 'Anton', 0.3, 0.5, 0.58, { fill: RED }),
    T('جيم القوة', 'Lalezar', 0.12, 0.5, 0.84),
  ], 'black'),
  D('pp-biz-pharmacy', 'business', 'Pharmacy logo with name', 'لوجو صيدلية بالاسم', [
    A('tabler:medical-cross-filled', 0.26, 0.5, 0.18, { fill: GREEN }),
    T('صيدلية', 'Cairo', 0.12, 0.5, 0.38, { weight: 'bold' }),
    T('الشفاء', 'Reem Kufi', 0.22, 0.5, 0.56, { fill: GREEN, weight: 'bold' }),
    T('PHARMACY', 'Montserrat', 0.055, 0.5, 0.8, { spacing: 300, weight: 'bold' }),
  ]),
  D('pp-biz-event-crew', 'business', 'Event crew', 'طاقم تنظيم الحفلة CREW', [
    T('EVENT', 'Bebas Neue', 0.1, 0.5, 0.24, { spacing: 300, fill: GOLD }),
    T('CREW', 'Anton', 0.26, 0.5, 0.45, { fill: INK, bg: GOLD, bgShape: 'box' }),
    T('طاقم التنظيم', 'Cairo', 0.1, 0.5, 0.7, { weight: 'bold' }),
    A('ph:headset-fill', 0.1, 0.5, 0.86, { fill: GOLD }),
  ], 'black', STAFF),
  D('pp-biz-volunteer', 'business', 'Volunteer', 'متطوع VOLUNTEER', [
    A('ph:hand-heart-fill', 0.3, 0.5, 0.2, { fill: RED }),
    T('متطوع', 'Lalezar', 0.28, 0.5, 0.5),
    T('VOLUNTEER', 'Bebas Neue', 0.1, 0.5, 0.72, { spacing: 250, fill: RED }),
    T('إيد واحدة تفرق', 'Changa', 0.07, 0.5, 0.86, { weight: 'bold' }),
  ], 'white', STAFF),
  D('pp-biz-charity-run', 'business', 'Charity run with year', 'ماراثون الخير بالسنة', [
    A('ph:person-simple-run-fill', 0.26, 0.5, 0.18, { fill: ACCENT }),
    T('ماراثون الخير', 'Lalezar', 0.14, 0.5, 0.4),
    T('2026', 'Anton', 0.26, 0.5, 0.6, { fill: ACCENT }),
    T('5K CHARITY RUN', 'Bebas Neue', 0.08, 0.5, 0.82, { spacing: 200 }),
  ], 'white', EVENT),
  D('pp-biz-finisher', 'business', 'Marathon finisher badge', 'ميدالية إنهاء الماراثون FINISHER', [
    S('circle', 0.62, 0.5, 0.34, { fill: ACCENT }),
    T('MARATHON', 'Montserrat', 0.05, 0.5, 0.24, { spacing: 250, weight: 'bold', fill: WHITE }),
    T('RUN', 'Anton', 0.18, 0.5, 0.35, { fill: WHITE }),
    T('2026', 'Montserrat', 0.05, 0.5, 0.46, { spacing: 200, weight: 'bold', fill: WHITE }),
    T('FINISHER', 'Bebas Neue', 0.16, 0.5, 0.7, { spacing: 150 }),
    T('خلّصت السباق', 'Marhey', 0.08, 0.5, 0.86, { weight: 'bold', fill: ACCENT }),
  ], 'navy', EVENT),
  D('pp-biz-conference', 'business', 'Annual conference', 'المؤتمر السنوي', [
    T('المؤتمر السنوي', 'Cairo', 0.1, 0.5, 0.22, { weight: 'bold' }),
    S('line', 0.5, 0.5, 0.32, { fill: BLUE }),
    T('2026', 'Bebas Neue', 0.32, 0.5, 0.5, { fill: BLUE }),
    S('line', 0.5, 0.5, 0.68, { fill: BLUE }),
    T('ANNUAL CONFERENCE', 'Montserrat', 0.05, 0.5, 0.78, { spacing: 250, weight: 'bold' }),
  ], 'white', EVENT),
  D('pp-biz-workshop', 'business', 'Workshop', 'ورشة عمل', [
    A('ph:lightbulb-fill', 0.24, 0.5, 0.18, { fill: GOLD }),
    T('ورشة عمل', 'Lalezar', 0.2, 0.5, 0.44),
    T('اتعلم • جرّب • ابتكر', 'Changa', 0.075, 0.5, 0.62, { weight: 'bold', fill: GOLD }),
    T('WORKSHOP 2026', 'Bebas Neue', 0.08, 0.5, 0.82, { spacing: 250 }),
  ], 'navy', EVENT),
  D('pp-biz-startup', 'business', 'Startup team', 'فريق ستارت أب', [
    A('ph:rocket-launch-fill', 0.26, 0.5, 0.18, { fill: ACCENT }),
    T('STARTUP', 'Righteous', 0.16, 0.5, 0.42),
    T('TEAM', 'Bebas Neue', 0.11, 0.5, 0.58, { spacing: 400, fill: ACCENT }),
    T('بنبني حاجة كبيرة', 'Changa', 0.08, 0.5, 0.8, { weight: 'bold' }),
  ], 'black'),
  D('pp-biz-name-role', 'business', 'Name and role (sales team)', 'الاسم والوظيفة فريق المبيعات', [
    T('COMPANY', 'Montserrat', 0.055, 0.5, 0.16, { spacing: 400, weight: 'bold', fill: BLUE }),
    S('line', 0.3, 0.5, 0.24, { fill: BLUE }),
    T('أحمد', 'Lalezar', 0.26, 0.5, 0.44),
    T('SALES TEAM', 'Bebas Neue', 0.09, 0.5, 0.66, { spacing: 150, fill: WHITE, bg: BLUE, bgShape: 'pill' }),
    T('فريق المبيعات', 'Cairo', 0.07, 0.5, 0.82, { weight: 'bold' }),
  ], 'white', STAFF),
  D('pp-biz-delivery', 'business', 'Delivery staff with shop name', 'ديليفري باسم المحل', [
    A('ph:moped-fill', 0.3, 0.5, 0.18, { fill: ACCENT }),
    T('ديليفري', 'Lalezar', 0.22, 0.5, 0.44),
    T(' اسم المحل ', 'Lemonada', 0.08, 0.5, 0.62, { weight: 'bold', fill: WHITE, bg: ACCENT, bgShape: 'banner' }),
    T('DELIVERY', 'Bebas Neue', 0.08, 0.5, 0.82, { spacing: 300 }),
  ], 'white', STAFF),
  D('pp-biz-security', 'business', 'Event security', 'أمن SECURITY', [
    A('ph:shield-check-fill', 0.22, 0.5, 0.18, { fill: GOLD }),
    T('SECURITY', 'Anton', 0.17, 0.5, 0.42, { fill: GOLD, spacing: 100 }),
    S('line', 0.6, 0.5, 0.58, { fill: GOLD }),
    T('الأمن', 'Lalezar', 0.2, 0.5, 0.74),
  ], 'black', STAFF),
];

module.exports = { categories, designs };
