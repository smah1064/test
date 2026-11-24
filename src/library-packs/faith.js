'use strict';

// Ramadan, Eid and Islamic phrases: elegant calligraphy, lanterns and crescents,
// Egyptian Ramadan jokes and family sets. No Quran verses.
const { T, S, K, A, D, ACCENT, GOLD, GREEN, PINK, BLUE, PURPLE } = require('../library-dsl');

const CREAM = '#f8e7b9';
const DEEP_GREEN = '#1b5e3b';
const BROWN = '#5c3d1e';
const COPPER = '#9a6b1f';
const ROYAL = '#1c4f8a';
const INK = '#16181d';

// Fine-tuning the subject's products (src/library.js FITS): the greetings that suit
// a prayer mat (the Ramadan and Eid jokes don't), the baby's firsts that suit a onesie.
const MAT = { alsoProducts: ['prayermat'] };
const BABY = { alsoProducts: ['onesie'] };
// Family sets are matching clothes: not for flyers, bags or signs; mum's and dad's not in kids' sizes.
const SET_ONLY = ['flyers', 'logostickers', 'paperbags', 'sign', 'greetingcard', 'tablecloth', 'coasters'];
const GROWN_UP = { notProducts: [...SET_ONLY, 'kidstee', 'kidshoodie'] };
const KID_SET = { notProducts: SET_ONLY };

const categories = [{ id: 'islamic', name: { en: 'Islamic phrases', ar: 'عبارات إسلامية' } }];

// One Ramadan family set: crescent and star on top, the role, a gold line and the year.
const ramadanFamily = (id, en, ar, role, extra) => D(id, 'ramadan', en, ar, [
  S('crescent', 0.2, 0.5, 0.19, { fill: GOLD }),
  S('star', 0.06, 0.62, 0.12, { fill: GOLD }),
  T(role, 'Aref Ruqaa', 0.17, 0.5, 0.47, { weight: 'bold' }),
  S('line', 0.36, 0.5, 0.63, { fill: GOLD }),
  T('لمة رمضان ٢٠٢٧', 'Reem Kufi', 0.085, 0.5, 0.73, { fill: GOLD, weight: 'bold' }),
], 'navy', extra);

// One Eid family set: lantern, the role big, and a gold banner with the year.
const eidFamily = (id, en, ar, role, colour, extra) => D(id, 'eid', en, ar, [
  K('eid-lantern', 0.3, 0.5, 0.18),
  T(role, 'Lalezar', 0.26, 0.5, 0.48, { fill: colour }),
  T('عيد العيلة ٢٠٢٧', 'Changa', 0.075, 0.5, 0.74, { weight: 'bold', fill: '#ffffff', bg: GOLD, bgShape: 'pill' }),
], 'white', extra);

const designs = [
  // ---------- Ramadan ----------
  D('fa-ram-kareem-gold', 'ramadan', 'Ramadan Kareem gold crescent', 'رمضان كريم هلال ذهبي', [
    S('crescent', 0.3, 0.5, 0.22, { fill: GOLD }),
    S('star', 0.07, 0.68, 0.13, { fill: GOLD }),
    S('star', 0.045, 0.31, 0.11, { fill: GOLD }),
    T('رمضان كريم', 'Aref Ruqaa', 0.2, 0.5, 0.56, { weight: 'bold' }),
    T('RAMADAN KAREEM', 'Montserrat', 0.045, 0.5, 0.76, { spacing: 300, fill: GOLD, weight: 'bold' }),
  ], 'navy', MAT),
  D('fa-ram-kufi-emblem', 'ramadan', 'Ramadan Kareem Kufi emblem', 'شعار رمضان كريم كوفي', [
    S('ring', 0.74, 0.5, 0.42, { fill: GOLD }),
    S('crescent', 0.12, 0.5, 0.27, { fill: GOLD }),
    T('رمضان', 'Reem Kufi', 0.17, 0.5, 0.42, { weight: 'bold' }),
    T('كريم', 'Reem Kufi', 0.12, 0.5, 0.56, { fill: GOLD, weight: 'bold' }),
    T('١٤٤٨ هـ', 'Reem Kufi', 0.09, 0.5, 0.83, { fill: GOLD, weight: 'bold' }),
  ], 'black', MAT),
  D('fa-ram-neon-nights', 'ramadan', 'Ramadan nights neon', 'ليالي رمضان نيون', [
    K('fanous', 0.36, 0.5, 0.22),
    T('رمضان', 'Lalezar', 0.26, 0.5, 0.55, { fill: '#ffe08a', glow: GOLD }),
    T('Ramadan Nights', 'Pacifico', 0.085, 0.5, 0.78, { fill: '#a5e8ff', glow: BLUE }),
  ], 'black'),
  D('fa-ram-mubarak-en', 'ramadan', 'Ramadan Mubarak', 'رمضان مبارك إنجليزي', [
    K('stars', 0.2, 0.5, 0.2),
    T('Ramadan', 'Playfair Display', 0.17, 0.5, 0.45, { weight: 'bold' }),
    T('MUBARAK', 'Montserrat', 0.06, 0.5, 0.6, { spacing: 400, fill: GOLD }),
    S('line', 0.4, 0.5, 0.69, { fill: GOLD }),
    T('رمضان مبارك', 'Aref Ruqaa', 0.09, 0.5, 0.8, { weight: 'bold' }),
  ], 'navy', MAT),
  D('fa-ram-matkalemnish', 'ramadan', 'Don\'t talk to me before Maghrib', 'متكلمنيش قبل المغرب', [
    A('fluent-emoji-flat:alarm-clock', 0.3, 0.5, 0.2),
    T('متكلمنيش', 'Lalezar', 0.24, 0.5, 0.5),
    T('قبل المغرب', 'Marhey', 0.14, 0.5, 0.72, { fill: ACCENT, weight: 'bold' }),
  ]),
  D('fa-ram-sayem-mobtasem', 'ramadan', 'Fasting but smiling', 'صايم بس مبتسم', [
    K('smile', 0.28, 0.5, 0.19),
    T('صايم', 'Jomhuria', 0.5, 0.5, 0.49, { fill: BROWN }),
    T('بس مبتسم', 'Marhey', 0.13, 0.5, 0.76, { fill: ACCENT, weight: 'bold' }),
  ], 'sand'),
  D('fa-ram-foul', 'ramadan', 'Suhoor is foul', 'سحوري فول', [
    A('fluent-emoji-flat:pot-of-food', 0.3, 0.5, 0.18),
    T('سحوري', 'Changa', 0.12, 0.5, 0.38, { weight: 'bold' }),
    T('فول', 'Jomhuria', 0.38, 0.5, 0.6, { fill: '#8a5a2b' }),
    T('ومفيش نقاش', 'Marhey', 0.08, 0.5, 0.86, { weight: 'bold', fill: ACCENT }),
  ]),
  D('fa-ram-qatayef-konafa', 'ramadan', 'Qatayef or kunafa?', 'قطايف ولا كنافة؟', [
    T('قطايف', 'Lalezar', 0.2, 0.5, 0.26, { fill: ACCENT }),
    T('ولا', 'Marhey', 0.11, 0.5, 0.44, { weight: 'bold' }),
    T('كنافة؟', 'Lalezar', 0.2, 0.5, 0.62, { fill: '#c77d0a' }),
    T('سؤال رمضان الصعب', 'Changa', 0.065, 0.5, 0.84, { weight: 'bold', fill: '#ffffff', bg: INK, bgShape: 'pill' }),
  ], 'heather'),
  D('fa-ram-akl-gahz', 'ramadan', 'Food is ready', 'يلا الأكل جاهز', [
    A('fluent-emoji-flat:shallow-pan-of-food', 0.3, 0.5, 0.2),
    T('يلا الأكل جاهز', 'Lalezar', 0.15, 0.5, 0.46),
    T('أحلى جملة في رمضان', 'Changa', 0.07, 0.5, 0.66, { weight: 'bold', fill: '#ffffff', bg: ACCENT, bgShape: 'pill' }),
  ]),
  D('fa-ram-mesaharaty', 'ramadan', 'Wake up for suhoor', 'اصحى يا نايم', [
    K('crescent', 0.26, 0.5, 0.18),
    T('اصحى يا نايم', 'Aref Ruqaa', 0.16, 0.5, 0.44, { weight: 'bold' }),
    T('السحور جاهز', 'Lemonada', 0.1, 0.5, 0.64, { weight: 'bold', fill: GOLD }),
    K('stars', 0.2, 0.5, 0.84),
  ], 'navy'),
  D('fa-ram-fi-masr', 'ramadan', 'Ramadan in Egypt is different', 'رمضان في مصر حاجة تانية', [
    K('fanous', 0.34, 0.5, 0.2),
    T('رمضان في مصر', 'Lalezar', 0.15, 0.5, 0.5),
    T('حاجة تانية', 'Aref Ruqaa', 0.17, 0.5, 0.71, { weight: 'bold', fill: ACCENT }),
  ]),
  D('fa-ram-3d-lamma', 'ramadan', 'Ramadan is sweeter together 3D', 'رمضان أحلى مع اللمة', [
    T('رمضان', 'Lalezar', 0.3, 0.5, 0.38, { fill: GOLD, extrude: '#7a4b00' }),
    T('أحلى مع اللمة', 'Marhey', 0.1, 0.5, 0.63, { weight: 'bold' }),
    K('stars', 0.2, 0.5, 0.83),
  ], 'black'),
  D('fa-ram-first-kid', 'ramadan', 'My first Ramadan', 'أول رمضان ليا', [
    A('fluent-emoji-flat:crescent-moon', 0.3, 0.5, 0.19),
    T('أول رمضان', 'Lemonada', 0.14, 0.5, 0.46, { weight: 'bold', fill: PURPLE }),
    T('ليا', 'Marhey', 0.14, 0.5, 0.63, { fill: GOLD, weight: 'bold' }),
    T('My First Ramadan', 'Caveat', 0.09, 0.5, 0.82),
  ], 'white', BABY),
  D('fa-ram-sayem-lel-dohr', 'ramadan', 'Little faster till noon', 'صايم لحد الضهر', [
    A('fluent-emoji-flat:glowing-star', 0.28, 0.5, 0.19),
    T('صايم', 'Lalezar', 0.24, 0.5, 0.46, { fill: BLUE }),
    T('لحد الضهر', 'Marhey', 0.13, 0.5, 0.68, { weight: 'bold', fill: ACCENT }),
    T('صايم صغير', 'Changa', 0.065, 0.5, 0.85, { weight: 'bold' }),
  ]),
  ramadanFamily('fa-ram-fam-dad', 'Ramadan family set: dad', 'طقم رمضان للعيلة: بابا', 'كبير العيلة', GROWN_UP),
  ramadanFamily('fa-ram-fam-mom', 'Ramadan family set: mom', 'طقم رمضان للعيلة: ماما', 'ملكة السفرة', GROWN_UP),
  ramadanFamily('fa-ram-fam-kid', 'Ramadan family set: kid', 'طقم رمضان للعيلة: الصغيرين', 'فرحة البيت', KID_SET),
  D('fa-ram-fasting-mode', 'ramadan', 'Fasting mode on', 'وضع الصيام شغال', [
    T('FASTING', 'Bungee', 0.15, 0.5, 0.34),
    T('MODE: ON', 'Bungee', 0.09, 0.5, 0.52, { fill: '#ffffff', bg: GREEN, bgShape: 'pill' }),
    T('صايم ومركز', 'Changa', 0.09, 0.5, 0.74, { weight: 'bold', fill: GOLD }),
  ], 'black'),
  D('fa-ram-iftar-squad', 'ramadan', 'Iftar squad', 'شلة الفطار', [
    K('dates', 0.32, 0.5, 0.17),
    T('IFTAR', 'Anton', 0.22, 0.5, 0.44, { fill: ACCENT }),
    T('SQUAD', 'Anton', 0.13, 0.5, 0.62),
    T('شلة الفطار', 'Lalezar', 0.08, 0.5, 0.81, { fill: '#ffffff', bg: INK, bgShape: 'box' }),
  ]),
  D('fa-ram-shahr-el-kheir', 'ramadan', 'Month of goodness mosque', 'شهر الخير', [
    T('RAMADAN KAREEM', 'Montserrat', 0.06, 0.5, 0.17, { curve: 40, spacing: 200, fill: GOLD, weight: 'bold' }),
    K('mosque', 0.56, 0.5, 0.44),
    T('شهر الخير', 'Aref Ruqaa', 0.17, 0.5, 0.76, { weight: 'bold', fill: CREAM }),
  ], 'forest', MAT),

  // ---------- Eid ----------
  D('fa-eid-saeed-gold', 'eid', 'Eid Saeed gold lines', 'عيد سعيد ذهبي', [
    K('stars', 0.26, 0.5, 0.2),
    S('line', 0.5, 0.5, 0.36, { fill: GOLD }),
    T('عيد سعيد', 'Aref Ruqaa', 0.22, 0.5, 0.5, { weight: 'bold', fill: GOLD }),
    S('line', 0.5, 0.5, 0.66, { fill: GOLD }),
    T('EID SAEED', 'Montserrat', 0.05, 0.5, 0.77, { spacing: 300, weight: 'bold' }),
  ], 'navy', MAT),
  D('fa-eid-mubarak-badge', 'eid', 'Eid Mubarak badge', 'عيد مبارك شعار', [
    S('circle', 0.7, 0.5, 0.4, { fill: GREEN }),
    A('fluent-emoji-flat:crescent-moon', 0.14, 0.5, 0.26),
    T('Eid', 'Playfair Display', 0.16, 0.5, 0.41, { fill: '#ffffff', weight: 'bold' }),
    T('MUBARAK', 'Montserrat', 0.05, 0.5, 0.53, { fill: '#ffffff', spacing: 300 }),
    T('عيد مبارك', 'Reem Kufi', 0.1, 0.5, 0.83, { weight: 'bold', fill: GREEN }),
  ], 'white', MAT),
  D('fa-eid-fen-el3edeya', 'eid', 'Where is my Eidiya?', 'فين العيدية؟', [
    A('fluent-emoji-flat:money-bag', 0.3, 0.5, 0.19),
    T('فين', 'Lalezar', 0.18, 0.5, 0.44),
    T('العيدية؟', 'Lalezar', 0.22, 0.5, 0.64, { fill: GREEN }),
    T('Eidiya please', 'Caveat', 0.08, 0.5, 0.84, { fill: ACCENT }),
  ]),
  D('fa-eid-3edeya-7a2', 'eid', 'Eidiya is my right', 'العيدية حق مكتسب', [
    A('tabler:cash-banknote', 0.26, 0.5, 0.21, { fill: DEEP_GREEN }),
    T('العيدية', 'Lalezar', 0.22, 0.5, 0.45, { fill: DEEP_GREEN }),
    T('حق مكتسب', 'Aref Ruqaa', 0.16, 0.5, 0.67, { weight: 'bold', fill: BROWN }),
  ], 'sand'),
  D('fa-eid-kahk', 'eid', 'No Eid without kahk', 'العيد مش عيد من غير كحك', [
    A('fluent-emoji-flat:cookie', 0.3, 0.5, 0.19),
    T('العيد مش عيد', 'Lalezar', 0.14, 0.5, 0.46),
    T('من غير كحك', 'Marhey', 0.13, 0.5, 0.66, { weight: 'bold', fill: '#b7791f' }),
  ]),
  D('fa-eid-adha-mubarak', 'eid', 'Eid al-Adha Mubarak', 'عيد أضحى مبارك', [
    K('eid-sheep', 0.5, 0.5, 0.3),
    T('عيد أضحى مبارك', 'Aref Ruqaa', 0.14, 0.5, 0.66, { weight: 'bold', fill: GOLD }),
    T('EID AL-ADHA', 'Montserrat', 0.045, 0.5, 0.82, { spacing: 300 }),
  ], 'forest', MAT),
  D('fa-eid-kharoof-sa7by', 'eid', 'The sheep is my friend', 'الخروف صاحبي', [
    A('fluent-emoji-flat:ram', 0.4, 0.5, 0.24),
    T('الخروف', 'Lalezar', 0.2, 0.5, 0.56),
    T('صاحبي', 'Marhey', 0.15, 0.5, 0.76, { fill: PINK, weight: 'bold' }),
  ]),
  D('fa-eid-fatta', 'eid', 'Waiting for the fatta', 'مستني الفتة', [
    A('fluent-emoji-flat:fork-and-knife-with-plate', 0.28, 0.5, 0.2),
    T('مستني', 'Changa', 0.12, 0.5, 0.42, { weight: 'bold' }),
    T('الفتة', 'Jomhuria', 0.42, 0.5, 0.64, { fill: ACCENT }),
  ]),
  eidFamily('fa-eid-fam-dad', 'Eid family set: dad', 'طقم العيد للعيلة: بابا', 'بابا', GREEN, GROWN_UP),
  eidFamily('fa-eid-fam-mom', 'Eid family set: mom', 'طقم العيد للعيلة: ماما', 'ماما', PINK, GROWN_UP),
  eidFamily('fa-eid-fam-kid', 'Eid family set: little one', 'طقم العيد للعيلة: الصغنن', 'الصغنن', BLUE, KID_SET),
  D('fa-eid-outfit', 'eid', 'This is my Eid outfit', 'ده لبس العيد', [
    T('ده', 'Marhey', 0.12, 0.5, 0.28, { weight: 'bold' }),
    K('sparkle', 0.16, 0.8, 0.33),
    T('لبس العيد', 'Lalezar', 0.24, 0.5, 0.48, { fill: GOLD }),
    T('EID OUTFIT', 'Bebas Neue', 0.09, 0.5, 0.7, { spacing: 200 }),
  ], 'black'),
  D('fa-eid-kol-sana', 'eid', 'Happy Eid to you all', 'كل سنة وانتم طيبين', [
    T('كل سنة', 'Aref Ruqaa', 0.18, 0.5, 0.36, { weight: 'bold' }),
    T('وانتم طيبين', 'Aref Ruqaa', 0.18, 0.5, 0.56, { weight: 'bold', fill: GOLD }),
    K('eid-lantern', 0.24, 0.5, 0.8),
  ], 'navy', MAT),
  D('fa-eid-taqabbal', 'eid', 'May Allah accept from us and you', 'تقبل الله منا ومنكم', [
    A('ph:star-and-crescent-fill', 0.14, 0.5, 0.2, { fill: COPPER }),
    T('تقبّل الله', 'Amiri', 0.18, 0.5, 0.42, { weight: 'bold', fill: BROWN }),
    T('منا ومنكم', 'Amiri', 0.13, 0.5, 0.6, { fill: COPPER, weight: 'bold' }),
    S('line', 0.3, 0.5, 0.74, { fill: COPPER }),
  ], 'sand', MAT),
  D('fa-eid-first', 'eid', 'My first Eid', 'أول عيد ليا', [
    A('fluent-emoji-flat:balloon', 0.26, 0.5, 0.19),
    T('أول عيد', 'Lemonada', 0.15, 0.5, 0.46, { weight: 'bold', fill: GREEN }),
    T('ليا', 'Marhey', 0.14, 0.5, 0.63, { weight: 'bold', fill: GOLD }),
    T('My First Eid', 'Caveat', 0.09, 0.5, 0.82),
  ], 'white', BABY),
  D('fa-eid-neon', 'eid', 'Happy Eid neon', 'عيد سعيد نيون', [
    T('HAPPY', 'Righteous', 0.11, 0.5, 0.3, { fill: '#ffd1f0', glow: PINK }),
    T('EID', 'Righteous', 0.26, 0.5, 0.48, { fill: '#c8fff4', glow: '#12b886' }),
    T('عيد سعيد', 'Lalezar', 0.12, 0.5, 0.7, { fill: '#ffe08a', glow: GOLD }),
  ], 'black'),

  // ---------- Islamic phrases ----------
  D('fa-isl-alhamdulillah', 'islamic', 'Alhamdulillah calligraphy', 'الحمد لله خط رقعة', [
    S('crescent', 0.18, 0.5, 0.27, { fill: GOLD }),
    T('الحمد لله', 'Aref Ruqaa', 0.24, 0.5, 0.53, { weight: 'bold', fill: CREAM }),
    T('ALHAMDULILLAH', 'Montserrat', 0.045, 0.5, 0.73, { spacing: 300, fill: GOLD }),
  ], 'forest'),
  D('fa-isl-tawakkalt', 'islamic', 'I put my trust in Allah', 'توكلت على الله', [
    T('توكلت', 'Amiri', 0.2, 0.5, 0.36, { weight: 'bold' }),
    T('على الله', 'Amiri', 0.2, 0.5, 0.56, { weight: 'bold', fill: DEEP_GREEN }),
    S('line', 0.16, 0.36, 0.75, { fill: GOLD }),
    S('diamond', 0.045, 0.5, 0.75, { fill: GOLD }),
    S('line', 0.16, 0.64, 0.75, { fill: GOLD }),
  ]),
  D('fa-isl-allahumma-barik', 'islamic', 'Allahumma barik', 'اللهم بارك', [
    A('ph:star-four-fill', 0.1, 0.5, 0.22, { fill: GOLD }),
    T('اللهم', 'Reem Kufi', 0.12, 0.5, 0.4, { fill: GOLD, weight: 'bold' }),
    T('بارك', 'Reem Kufi', 0.28, 0.5, 0.6, { weight: 'bold' }),
  ], 'navy'),
  D('fa-isl-astaghfirullah', 'islamic', 'Astaghfirullah', 'أستغفر الله', [
    A('fluent-emoji-flat:prayer-beads', 0.28, 0.5, 0.25),
    T('أستغفر الله', 'El Messiri', 0.16, 0.5, 0.53, { weight: 'bold' }),
    T('وأتوب إليه', 'El Messiri', 0.09, 0.5, 0.71, { fill: GOLD }),
  ], 'black'),
  D('fa-isl-salli-nabi', 'islamic', 'Pray upon the Prophet', 'صل على النبي', [
    A('ph:mosque-fill', 0.26, 0.5, 0.25, { fill: DEEP_GREEN }),
    T('صلِّ على النبي', 'Aref Ruqaa', 0.17, 0.5, 0.54, { weight: 'bold' }),
    T('عليه الصلاة والسلام', 'Amiri', 0.085, 0.5, 0.72, { fill: COPPER, weight: 'bold' }),
  ]),
  D('fa-isl-jumuah', 'islamic', 'Jumuah Mubarak', 'جمعة مباركة', [
    A('ph:mosque-fill', 0.28, 0.5, 0.25, { fill: DEEP_GREEN }),
    T('جمعة مباركة', 'Aref Ruqaa', 0.19, 0.5, 0.54, { weight: 'bold', fill: BROWN }),
    T('JUMU\'AH MUBARAK', 'Montserrat', 0.045, 0.5, 0.73, { spacing: 250, fill: DEEP_GREEN, weight: 'bold' }),
  ], 'sand'),
  D('fa-isl-hajj', 'islamic', 'Hajj Mabrour', 'حج مبرور', [
    A('fluent-emoji-flat:kaaba', 0.28, 0.5, 0.19),
    T('حج مبرور', 'Aref Ruqaa', 0.2, 0.5, 0.45, { weight: 'bold' }),
    T('وذنب مغفور', 'Aref Ruqaa', 0.14, 0.5, 0.63, { weight: 'bold', fill: COPPER }),
    T('HAJJ MABROUR', 'Montserrat', 0.042, 0.5, 0.8, { spacing: 250 }),
  ]),
  D('fa-isl-umrah', 'islamic', 'Umrah badge 2027', 'عمرة مقبولة ٢٠٢٧', [
    S('ring', 0.72, 0.5, 0.42, { fill: GOLD }),
    A('fluent-emoji-flat:kaaba', 0.22, 0.5, 0.31),
    T('عمرة مقبولة', 'Reem Kufi', 0.11, 0.5, 0.5, { weight: 'bold' }),
    T('UMRAH 2027', 'Montserrat', 0.045, 0.5, 0.86, { spacing: 250, fill: GOLD, weight: 'bold' }),
  ], 'navy'),
  D('fa-isl-subhanallah', 'islamic', 'Subhanallah', 'سبحان الله', [
    S('star', 0.05, 0.3, 0.24, { fill: GOLD }),
    S('crescent', 0.14, 0.5, 0.22, { fill: GOLD }),
    S('star', 0.05, 0.7, 0.24, { fill: GOLD }),
    T('سبحان الله', 'El Messiri', 0.18, 0.5, 0.46, { weight: 'bold', fill: CREAM }),
    T('وبحمده', 'El Messiri', 0.11, 0.5, 0.63, { fill: GOLD, weight: 'bold' }),
  ], 'forest'),
  D('fa-isl-mashallah', 'islamic', 'Mashallah', 'ما شاء الله', [
    S('crescent', 0.15, 0.5, 0.28, { fill: GOLD }),
    T('ما شاء الله', 'Aref Ruqaa', 0.21, 0.5, 0.51, { weight: 'bold', fill: ROYAL }),
    T('Mashallah', 'Dancing Script', 0.11, 0.5, 0.71, { weight: 'bold', fill: COPPER }),
  ]),
  D('fa-isl-ya-rab', 'islamic', 'Ya Rab', 'يا رب', [
    S('crescent', 0.15, 0.5, 0.25, { fill: GOLD }),
    T('يا رب', 'Aref Ruqaa', 0.32, 0.5, 0.51, { weight: 'bold', fill: GOLD }),
    T('YA RAB', 'Montserrat', 0.05, 0.5, 0.74, { spacing: 400 }),
  ], 'black'),
  D('fa-isl-la-hawla', 'islamic', 'La hawla wala quwwata illa billah', 'لا حول ولا قوة إلا بالله', [
    A('ph:star-and-crescent-fill', 0.16, 0.5, 0.24, { fill: GOLD }),
    T('لا حول ولا قوة', 'Amiri', 0.13, 0.5, 0.45, { weight: 'bold' }),
    T('إلا بالله', 'Amiri', 0.18, 0.5, 0.63, { weight: 'bold', fill: GOLD }),
  ], 'navy'),
  D('fa-isl-rizqi', 'islamic', 'My provision is from Allah', 'رزقي على الله', [
    T('رزقي', 'Reem Kufi', 0.24, 0.5, 0.38, { weight: 'bold', fill: DEEP_GREEN }),
    T('على الله', 'Aref Ruqaa', 0.16, 0.5, 0.58, { weight: 'bold', fill: BROWN }),
    S('line', 0.16, 0.36, 0.73, { fill: COPPER }),
    S('diamond', 0.045, 0.5, 0.73, { fill: COPPER }),
    S('line', 0.16, 0.64, 0.73, { fill: COPPER }),
  ], 'sand'),
  D('fa-isl-alhamdulillah-en', 'islamic', 'Alhamdulillah for everything', 'الحمد لله على كل حال', [
    S('crescent', 0.14, 0.5, 0.24, { fill: GOLD }),
    T('Alhamdulillah', 'Dancing Script', 0.15, 0.5, 0.45, { weight: 'bold', fill: DEEP_GREEN }),
    T('FOR EVERYTHING', 'Montserrat', 0.045, 0.5, 0.59, { spacing: 300 }),
    T('الحمد لله على كل حال', 'Amiri', 0.08, 0.5, 0.73, { weight: 'bold', fill: COPPER }),
  ]),
  D('fa-isl-istaeen', 'islamic', 'Seek Allah\'s help', 'استعن بالله ولا تعجز', [
    A('tabler:moon-stars', 0.18, 0.5, 0.26, { fill: GOLD }),
    T('استعن بالله', 'El Messiri', 0.17, 0.5, 0.5, { weight: 'bold' }),
    T('ولا تعجز', 'El Messiri', 0.12, 0.5, 0.68, { weight: 'bold', fill: DEEP_GREEN }),
  ], 'heather'),
];

module.exports = { categories, designs };
