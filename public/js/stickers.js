/* Sticker & clipart library. Original vector drawings, 100 x 100 each. */
(function () {
  'use strict';

  const HEART = 'M50 88 C20 66 0 48 0 28 C0 12 12 0 27 0 C37 0 45 5 50 14 C55 5 63 0 73 0 C88 0 100 12 100 28 C100 48 80 66 50 88 Z';
  const STAR5 = 'M50 4 L61 37 L96 37 L68 58 L78 92 L50 72 L22 92 L32 58 L4 37 L39 37 Z';
  const face = (inner) => `<circle cx="50" cy="50" r="44" fill="#ffd43b"/><circle cx="50" cy="50" r="44" fill="none" stroke="#f59f00" stroke-width="3"/>${inner}`;
  const INK = '#5c3d0e';

  const CATEGORIES = [
    { id: 'egypt', name: { en: 'Egypt', ar: 'مصر' } },
    { id: 'ramadan', name: { en: 'Ramadan', ar: 'رمضان' } },
    { id: 'football', name: { en: 'Football', ar: 'كورة' } },
    { id: 'love', name: { en: 'Love', ar: 'حب' } },
    { id: 'birthday', name: { en: 'Birthday', ar: 'عيد ميلاد' } },
    { id: 'fun', name: { en: 'Fun', ar: 'مرح' } },
  ];

  const S = (id, cat, en, ar, body) => ({ id, cat, name: { en, ar }, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${body}</svg>` });

  const STICKERS = [
    // ---------- Egypt ----------
    S('pyramids', 'egypt', 'Pyramids', 'الأهرامات',
      '<circle cx="76" cy="24" r="11" fill="#f6b73c"/>' +
      '<path d="M6 84 L40 28 L74 84 Z" fill="#e0b36a"/><path d="M40 28 L74 84 L54 84 Z" fill="#c99a4f"/>' +
      '<path d="M50 84 L72 48 L96 84 Z" fill="#e8c27f"/><path d="M72 48 L96 84 L80 84 Z" fill="#cfa45c"/>' +
      '<rect x="2" y="83" width="96" height="7" rx="3.5" fill="#d9b277"/>'),
    S('palm', 'egypt', 'Palm tree', 'نخلة',
      '<ellipse cx="50" cy="92" rx="28" ry="5" fill="#e0b36a"/>' +
      '<path d="M50 92 Q45 66 52 38" stroke="#8b5a2b" stroke-width="8" fill="none" stroke-linecap="round"/>' +
      '<path d="M45 80 h9 M45 68 h9 M47 56 h8" stroke="#6b4423" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M52 38 Q30 18 8 32 Q30 28 52 40 Z" fill="#2f9e44"/><path d="M52 38 Q74 18 94 32 Q72 28 52 40 Z" fill="#2f9e44"/>' +
      '<path d="M52 38 Q36 10 16 12 Q36 20 51 40 Z" fill="#37b24d"/><path d="M52 38 Q68 10 88 12 Q68 20 53 40 Z" fill="#37b24d"/>' +
      '<path d="M52 38 Q44 50 30 64 Q46 54 54 40 Z" fill="#2b8a3e"/><path d="M52 38 Q62 52 76 62 Q60 54 50 40 Z" fill="#2b8a3e"/>' +
      '<circle cx="47" cy="42" r="4" fill="#8b5a2b"/><circle cx="55" cy="43" r="4" fill="#8b5a2b"/>'),
    S('ankh', 'egypt', 'Ankh', 'مفتاح الحياة',
      '<ellipse cx="50" cy="28" rx="14" ry="19" fill="none" stroke="#e0a526" stroke-width="9"/>' +
      '<path d="M22 52 H78 M50 47 V94" stroke="#e0a526" stroke-width="10" stroke-linecap="round"/>'),
    S('eye', 'egypt', 'Ancient eye', 'العين الفرعونية',
      '<path d="M14 27 Q50 6 88 25" stroke="#1b3a6b" stroke-width="6" fill="none" stroke-linecap="round"/>' +
      '<path d="M8 46 Q50 16 92 46 Q50 70 8 46 Z" fill="#fff" stroke="#1b3a6b" stroke-width="5" stroke-linejoin="round"/>' +
      '<circle cx="50" cy="44" r="12" fill="#1b3a6b"/><circle cx="54" cy="40" r="3.5" fill="#fff"/>' +
      '<path d="M42 64 L37 84 Q35 93 45 91" stroke="#1b3a6b" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M60 62 Q72 80 86 72" stroke="#1b3a6b" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<path d="M92 46 L98 44" stroke="#1b3a6b" stroke-width="5" stroke-linecap="round"/>'),
    S('lotus', 'egypt', 'Lotus', 'زهرة اللوتس',
      '<path d="M50 84 Q32 60 50 22 Q68 60 50 84 Z" fill="#f783ac"/>' +
      '<path d="M50 84 Q20 72 16 40 Q42 50 50 84 Z" fill="#faa2c1"/><path d="M50 84 Q80 72 84 40 Q58 50 50 84 Z" fill="#faa2c1"/>' +
      '<path d="M50 84 Q14 84 4 64 Q34 62 50 84 Z" fill="#fcc2d7"/><path d="M50 84 Q86 84 96 64 Q66 62 50 84 Z" fill="#fcc2d7"/>' +
      '<path d="M20 90 Q50 82 80 90" stroke="#1c7ed6" stroke-width="4" fill="none" stroke-linecap="round"/>'),
    S('sun', 'egypt', 'Sun', 'شمس',
      '<g stroke="#f59f00" stroke-width="6" stroke-linecap="round"><path d="M50 4 V16 M50 84 V96 M4 50 H16 M84 50 H96 M17 17 L26 26 M74 74 L83 83 M83 17 L74 26 M26 74 L17 83"/></g>' +
      '<circle cx="50" cy="50" r="26" fill="#fcc419"/>'),

    // ---------- Ramadan ----------
    S('fanous', 'ramadan', 'Fanous lantern', 'فانوس',
      '<circle cx="50" cy="8" r="5" fill="none" stroke="#b7791f" stroke-width="3"/>' +
      '<path d="M36 26 L50 12 L64 26 Z" fill="#d69e2e"/><rect x="32" y="25" width="36" height="7" rx="2" fill="#b7791f"/>' +
      '<path d="M32 32 L68 32 L74 52 L68 74 L32 74 L26 52 Z" fill="#d69e2e"/>' +
      '<path d="M36 36 L47 36 L47 70 L36 70 L31 52 Z" fill="#e8590c"/><path d="M53 36 L64 36 L69 52 L64 70 L53 70 Z" fill="#2b8a3e"/>' +
      '<circle cx="50" cy="53" r="6" fill="#fff3bf"/>' +
      '<rect x="34" y="74" width="32" height="7" rx="2" fill="#b7791f"/><path d="M40 81 L60 81 L54 91 L46 91 Z" fill="#d69e2e"/>'),
    S('crescent', 'ramadan', 'Crescent & star', 'هلال ونجمة',
      '<path d="M58 6 A44 44 0 1 0 58 94 A56 56 0 0 1 58 6 Z" fill="#e0a526"/>' +
      `<path d="${STAR5}" fill="#e0a526" transform="translate(56 28) scale(0.32)"/>`),
    S('mosque', 'ramadan', 'Mosque', 'مسجد',
      '<rect x="82" y="30" width="9" height="62" fill="#1971c2"/><path d="M80 30 L86.5 14 L93 30 Z" fill="#1864ab"/>' +
      '<path d="M30 58 Q30 32 50 26 Q70 32 70 58 Z" fill="#1971c2"/><path d="M50 26 V16" stroke="#e0a526" stroke-width="3"/>' +
      '<path d="M52 8 A5 5 0 1 0 52 18 A6.5 6.5 0 0 1 52 8 Z" fill="#e0a526"/>' +
      '<rect x="14" y="56" width="68" height="36" fill="#228be6"/>' +
      '<path d="M40 92 V76 Q40 68 48 68 Q56 68 56 76 V92 Z" fill="#0b3d78"/>' +
      '<path d="M20 72 Q20 66 25 66 Q30 66 30 72 V80 H20 Z M66 72 Q66 66 71 66 Q76 66 76 72 V80 H66 Z" fill="#0b3d78"/>'),
    S('stars', 'ramadan', 'Stars', 'نجوم',
      `<path d="${STAR5}" fill="#fcc419" transform="translate(4 10) scale(0.55)"/>` +
      `<path d="${STAR5}" fill="#e0a526" transform="translate(56 4) scale(0.4)"/>` +
      `<path d="${STAR5}" fill="#ffe066" transform="translate(58 56) scale(0.36)"/>`),

    // ---------- Football ----------
    S('ball', 'football', 'Football', 'كورة',
      '<circle cx="50" cy="50" r="45" fill="#fff" stroke="#212529" stroke-width="4"/>' +
      '<path d="M50 35 L64.3 45.4 L58.8 62.1 L41.2 62.1 L35.7 45.4 Z" fill="#212529"/>' +
      '<g stroke="#212529" stroke-width="3" fill="none"><path d="M50 35 V18 M64.3 45.4 L80.4 40.1 M58.8 62.1 L68.8 75.8 M41.2 62.1 L31.2 75.8 M35.7 45.4 L19.6 40.1"/></g>' +
      '<g fill="#212529"><path d="M43 7 L57 7 L58 18 L50 22 L42 18 Z"/><path d="M90 38 L94 52 L86 56 L80 48 L82 38 Z"/><path d="M78 86 L66 92 L62 82 L68 75 L78 78 Z"/><path d="M22 86 L34 92 L38 82 L32 75 L22 78 Z"/><path d="M10 38 L6 52 L14 56 L20 48 L18 38 Z"/></g>'),
    S('trophy', 'football', 'Trophy', 'كأس',
      '<path d="M26 14 H74 V36 Q74 62 50 64 Q26 62 26 36 Z" fill="#fcc419"/>' +
      '<path d="M26 20 H12 Q12 44 30 46 M74 20 H88 Q88 44 70 46" stroke="#f59f00" stroke-width="6" fill="none"/>' +
      '<rect x="44" y="62" width="12" height="14" fill="#f59f00"/><rect x="30" y="76" width="40" height="8" rx="2" fill="#f59f00"/><rect x="24" y="84" width="52" height="10" rx="3" fill="#e67700"/>' +
      `<path d="${STAR5}" fill="#fff3bf" transform="translate(39 24) scale(0.22)"/>`),
    S('jersey', 'football', 'Jersey', 'تيشيرت فريق',
      '<path d="M30 10 L42 6 Q50 14 58 6 L70 10 L94 26 L84 44 L74 38 V94 H26 V38 L16 44 L6 26 Z" fill="#e03131" stroke="#a51111" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M42 6 Q50 18 58 6" fill="none" stroke="#fff" stroke-width="4"/>' +
      '<rect x="44" y="40" width="12" height="54" fill="#fff"/>'),
    S('medal', 'football', 'Medal', 'ميدالية',
      '<path d="M30 4 H44 L56 40 H42 Z" fill="#1c7ed6"/><path d="M70 4 H56 L44 40 H58 Z" fill="#e03131"/>' +
      '<circle cx="50" cy="64" r="28" fill="#fcc419" stroke="#f59f00" stroke-width="5"/>' +
      `<path d="${STAR5}" fill="#f59f00" transform="translate(35 49) scale(0.3)"/>`),

    // ---------- Love ----------
    S('heart', 'love', 'Heart', 'قلب',
      `<path d="${HEART}" fill="#e03131" transform="translate(0 6)"/>` +
      '<path d="M24 18 Q12 22 12 36" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".55"/>'),
    S('hearts', 'love', 'Two hearts', 'قلبين',
      `<path d="${HEART}" fill="#f783ac" transform="translate(42 34) scale(0.56)"/>` +
      `<path d="${HEART}" fill="#e03131" transform="translate(4 10) scale(0.68)"/>`),
    S('heart-arrow', 'love', 'Heart & arrow', 'قلب وسهم',
      '<path d="M8 82 L92 18" stroke="#8d6e63" stroke-width="5" stroke-linecap="round"/>' +
      `<path d="${HEART}" fill="#e03131" transform="translate(18 18) scale(0.64)"/>` +
      '<path d="M92 18 L78 18 L86 30 Z" fill="#495057"/><path d="M8 82 L4 72 M8 82 L18 86 M14 78 L10 68 M14 78 L24 82" stroke="#e03131" stroke-width="4" stroke-linecap="round"/>'),
    S('rose', 'love', 'Rose', 'وردة',
      '<path d="M50 54 Q48 76 52 96" stroke="#2f9e44" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<path d="M50 74 Q30 64 22 76 Q36 84 50 76 Z" fill="#37b24d"/><path d="M51 84 Q70 74 78 86 Q64 92 51 86 Z" fill="#37b24d"/>' +
      '<path d="M26 30 Q26 8 50 10 Q74 8 74 30 Q74 56 50 58 Q26 56 26 30 Z" fill="#e03131"/>' +
      '<path d="M50 20 Q62 22 60 34 Q58 44 46 42 Q38 38 42 30 Q46 26 52 30" stroke="#a51111" stroke-width="3.5" fill="none" stroke-linecap="round"/>'),
    S('letter', 'love', 'Love letter', 'جواب حب',
      '<rect x="8" y="24" width="84" height="56" rx="6" fill="#fff" stroke="#e64980" stroke-width="4"/>' +
      '<path d="M10 28 L50 58 L90 28" fill="none" stroke="#e64980" stroke-width="4" stroke-linejoin="round"/>' +
      `<path d="${HEART}" fill="#e03131" transform="translate(39 46) scale(0.22)"/>`),

    // ---------- Birthday ----------
    S('cake', 'birthday', 'Cake', 'تورتة',
      '<g stroke="#fff" stroke-width="0"><rect x="34" y="18" width="5" height="18" fill="#4dabf7"/><rect x="48" y="14" width="5" height="22" fill="#ffd43b"/><rect x="62" y="18" width="5" height="18" fill="#69db7c"/></g>' +
      '<path d="M36.5 10 Q33 14 36.5 17 Q40 14 36.5 10 Z M50.5 6 Q47 10 50.5 13 Q54 10 50.5 6 Z M64.5 10 Q61 14 64.5 17 Q68 14 64.5 10 Z" fill="#ff922b"/>' +
      '<rect x="24" y="36" width="52" height="24" rx="5" fill="#fcc2d7"/>' +
      '<rect x="14" y="58" width="72" height="30" rx="5" fill="#f783ac"/>' +
      '<path d="M14 62 Q14 58 18 58 H82 Q86 58 86 62 V68 Q81 74 76 68 Q71 74 66 68 Q61 74 56 68 Q51 74 46 68 Q41 74 36 68 Q31 74 26 68 Q21 74 14 68 Z" fill="#fff"/>' +
      '<rect x="8" y="86" width="84" height="6" rx="3" fill="#ced4da"/>'),
    S('balloons', 'birthday', 'Balloons', 'بالونات',
      '<path d="M30 48 Q38 70 50 96 M70 44 Q62 70 50 96 M50 40 V96" stroke="#868e96" stroke-width="1.5" fill="none"/>' +
      '<ellipse cx="28" cy="32" rx="18" ry="22" fill="#ff6b6b"/><ellipse cx="72" cy="30" rx="18" ry="22" fill="#4dabf7"/><ellipse cx="50" cy="24" rx="18" ry="22" fill="#ffd43b"/>' +
      '<path d="M22 22 Q20 16 25 13 M66 20 Q64 14 69 11 M44 14 Q42 8 47 5" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>'),
    S('gift', 'birthday', 'Gift', 'هدية',
      '<rect x="16" y="44" width="68" height="48" rx="4" fill="#4dabf7"/><rect x="12" y="34" width="76" height="14" rx="3" fill="#339af0"/>' +
      '<rect x="45" y="34" width="10" height="58" fill="#ff6b6b"/>' +
      '<path d="M50 34 C38 16 20 20 28 30 C33 37 44 36 50 34 Z M50 34 C62 16 80 20 72 30 C67 37 56 36 50 34 Z" fill="#ff6b6b"/>'),
    S('party-hat', 'birthday', 'Party hat', 'طرطور',
      '<path d="M50 12 L80 88 H20 Z" fill="#845ef7"/>' +
      '<path d="M41 35 L59 35 L63 46 L37 46 Z M31 60 L69 60 L73 71 L27 71 Z" fill="#fcc419"/>' +
      '<path d="M18 88 L24 80 L30 88 L36 80 L42 88 L48 80 L54 88 L60 80 L66 88 L72 80 L78 88 L82 92 H18 Z" fill="#ff6b6b"/>' +
      '<circle cx="50" cy="10" r="8" fill="#ff6b6b"/>'),
    S('confetti', 'birthday', 'Confetti', 'زينة',
      '<rect x="10" y="14" width="8" height="16" rx="2" fill="#ff6b6b" transform="rotate(-20 14 22)"/><rect x="70" y="10" width="8" height="16" rx="2" fill="#4dabf7" transform="rotate(25 74 18)"/>' +
      '<rect x="44" y="40" width="8" height="16" rx="2" fill="#ffd43b" transform="rotate(40 48 48)"/><rect x="18" y="66" width="8" height="16" rx="2" fill="#69db7c" transform="rotate(-35 22 74)"/>' +
      '<rect x="76" y="64" width="8" height="16" rx="2" fill="#845ef7" transform="rotate(15 80 72)"/>' +
      '<circle cx="36" cy="22" r="5" fill="#69db7c"/><circle cx="84" cy="42" r="5" fill="#ff922b"/><circle cx="14" cy="46" r="5" fill="#845ef7"/><circle cx="56" cy="84" r="5" fill="#ff6b6b"/><circle cx="60" cy="18" r="4" fill="#f783ac"/>' +
      '<path d="M28 44 Q34 38 40 44 T52 44" stroke="#f783ac" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M60 58 Q66 52 72 58 T84 58" stroke="#4dabf7" stroke-width="4" fill="none" stroke-linecap="round"/>'),

    // ---------- Fun ----------
    S('smile', 'fun', 'Smile', 'ابتسامة',
      face(`<ellipse cx="35" cy="40" rx="5" ry="8" fill="${INK}"/><ellipse cx="65" cy="40" rx="5" ry="8" fill="${INK}"/><path d="M28 58 Q50 80 72 58" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`)),
    S('laugh', 'fun', 'Laughing', 'ضحك',
      face(`<path d="M26 42 Q34 32 42 42 M58 42 Q66 32 74 42" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M24 54 H76 Q74 84 50 84 Q26 84 24 54 Z" fill="${INK}"/><path d="M36 74 Q50 64 64 74 Q60 83 50 83 Q40 83 36 74 Z" fill="#ff6b6b"/><path d="M18 46 Q12 56 18 60 Q24 56 18 46 Z M82 46 Q76 56 82 60 Q88 56 82 46 Z" fill="#74c0fc"/>`)),
    S('love-eyes', 'fun', 'Heart eyes', 'عيون قلوب',
      face(`<path d="${HEART}" fill="#e03131" transform="translate(23 28) scale(0.2)"/><path d="${HEART}" fill="#e03131" transform="translate(57 28) scale(0.2)"/><path d="M28 60 Q50 82 72 60" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`)),
    S('cool', 'fun', 'Cool', 'روش',
      face(`<path d="M16 36 H84 V42 Q82 56 67 56 Q55 56 53 44 H47 Q45 56 33 56 Q18 56 16 42 Z" fill="#212529"/><path d="M24 40 L32 40" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/><path d="M36 70 Q54 80 68 64" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`)),
    S('wink', 'fun', 'Wink', 'غمزة',
      face(`<ellipse cx="35" cy="40" rx="5" ry="8" fill="${INK}"/><path d="M58 42 Q66 36 74 42" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M28 58 Q50 80 72 58" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M52 70 Q56 82 64 74" fill="#ff6b6b"/>`)),
    S('crown', 'fun', 'Crown', 'تاج',
      '<path d="M14 74 L8 28 L32 50 L50 18 L68 50 L92 28 L86 74 Z" fill="#fcc419" stroke="#f59f00" stroke-width="3" stroke-linejoin="round"/>' +
      '<rect x="12" y="72" width="76" height="12" rx="3" fill="#f59f00"/>' +
      '<circle cx="8" cy="26" r="5" fill="#f59f00"/><circle cx="50" cy="15" r="5" fill="#f59f00"/><circle cx="92" cy="26" r="5" fill="#f59f00"/>' +
      '<circle cx="30" cy="78" r="3.5" fill="#e03131"/><circle cx="50" cy="78" r="3.5" fill="#1c7ed6"/><circle cx="70" cy="78" r="3.5" fill="#2f9e44"/>'),
    S('bolt', 'fun', 'Lightning', 'برق',
      '<path d="M58 4 L18 56 H46 L38 96 L82 40 H54 Z" fill="#fcc419" stroke="#f59f00" stroke-width="3" stroke-linejoin="round"/>'),
    S('flame', 'fun', 'Flame', 'نار',
      '<path d="M50 96 C24 96 14 76 20 58 C25 44 36 40 34 20 C48 28 54 42 50 52 C56 46 58 38 56 28 C72 40 86 58 80 74 C77 88 66 96 50 96 Z" fill="#ff6b35"/>' +
      '<path d="M50 94 C38 94 32 84 36 74 C39 66 46 64 46 56 C54 62 58 70 56 76 C60 74 62 70 62 66 C68 74 68 84 64 88 C60 92 56 94 50 94 Z" fill="#ffd43b"/>'),
    S('music', 'fun', 'Music', 'موسيقى',
      '<path d="M36 22 L80 10 V22 L36 34 Z" fill="#7048e8"/><path d="M38 24 V76 M78 14 V66" stroke="#7048e8" stroke-width="7"/>' +
      '<ellipse cx="27" cy="78" rx="13" ry="10" fill="#7048e8"/><ellipse cx="67" cy="68" rx="13" ry="10" fill="#7048e8"/>'),
    S('coffee', 'fun', 'Coffee', 'قهوة',
      '<path d="M34 30 Q28 22 34 14 Q40 6 34 0 M52 30 Q46 22 52 14 Q58 6 52 0" stroke="#adb5bd" stroke-width="4" fill="none" stroke-linecap="round"/>' +
      '<path d="M70 46 Q88 46 88 58 Q88 70 70 70" fill="none" stroke="#8d6e63" stroke-width="7"/>' +
      '<path d="M16 38 H72 V60 Q72 84 44 84 Q16 84 16 60 Z" fill="#8d6e63"/><ellipse cx="46" cy="88" rx="36" ry="6" fill="#6d4c41"/>' +
      `<path d="${HEART}" fill="#fff" opacity=".85" transform="translate(36 50) scale(0.2)"/>`),
    S('paw', 'fun', 'Paw print', 'أثر قدم قطة',
      '<g fill="#495057"><ellipse cx="50" cy="68" rx="22" ry="18"/><ellipse cx="22" cy="44" rx="9" ry="12" transform="rotate(-20 22 44)"/><ellipse cx="40" cy="28" rx="9" ry="12"/><ellipse cx="60" cy="28" rx="9" ry="12"/><ellipse cx="78" cy="44" rx="9" ry="12" transform="rotate(20 78 44)"/></g>'),
    S('sparkle', 'fun', 'Sparkle', 'لمعة',
      '<path d="M44 6 Q50 40 82 46 Q50 52 44 88 Q38 52 6 46 Q38 40 44 6 Z" fill="#fcc419"/>' +
      '<path d="M80 62 Q82 74 94 76 Q82 78 80 90 Q78 78 66 76 Q78 74 80 62 Z" fill="#ffe066"/>'),
    S('speech', 'fun', 'Speech bubble', 'فقاعة كلام',
      '<path d="M14 14 H86 Q94 14 94 22 V62 Q94 70 86 70 H40 L20 90 L24 70 H14 Q6 70 6 62 V22 Q6 14 14 14 Z" fill="#fff" stroke="#212529" stroke-width="4" stroke-linejoin="round"/>'),
  ];

  const urlCache = new Map();
  function thumbUrl(sticker) {
    if (!urlCache.has(sticker.id)) urlCache.set(sticker.id, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sticker.svg));
    return urlCache.get(sticker.id);
  }

  /** Turn a sticker into a vector fabric object. */
  function makeSticker(sticker) {
    return new Promise((resolve) => {
      fabric.loadSVGFromString(sticker.svg, (objects, options) => {
        const obj = fabric.util.groupSVGElements(objects, options);
        obj.set({ name: 'sticker:' + sticker.id });
        resolve(obj);
      });
    });
  }

  window.POD_STICKERS = { CATEGORIES, STICKERS, thumbUrl, makeSticker };
})();
