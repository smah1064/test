'use strict';

/** Egypt's 27 governorates, used for delivery addresses. */
const GOVERNORATES = [
  ['cairo', 'Cairo', 'القاهرة'],
  ['giza', 'Giza', 'الجيزة'],
  ['alexandria', 'Alexandria', 'الإسكندرية'],
  ['qalyubia', 'Qalyubia', 'القليوبية'],
  ['sharqia', 'Sharqia', 'الشرقية'],
  ['dakahlia', 'Dakahlia', 'الدقهلية'],
  ['gharbia', 'Gharbia', 'الغربية'],
  ['monufia', 'Monufia', 'المنوفية'],
  ['beheira', 'Beheira', 'البحيرة'],
  ['kafr-el-sheikh', 'Kafr El Sheikh', 'كفر الشيخ'],
  ['damietta', 'Damietta', 'دمياط'],
  ['port-said', 'Port Said', 'بورسعيد'],
  ['ismailia', 'Ismailia', 'الإسماعيلية'],
  ['suez', 'Suez', 'السويس'],
  ['faiyum', 'Faiyum', 'الفيوم'],
  ['beni-suef', 'Beni Suef', 'بني سويف'],
  ['minya', 'Minya', 'المنيا'],
  ['asyut', 'Asyut', 'أسيوط'],
  ['sohag', 'Sohag', 'سوهاج'],
  ['qena', 'Qena', 'قنا'],
  ['luxor', 'Luxor', 'الأقصر'],
  ['aswan', 'Aswan', 'أسوان'],
  ['red-sea', 'Red Sea', 'البحر الأحمر'],
  ['new-valley', 'New Valley', 'الوادي الجديد'],
  ['matrouh', 'Matrouh', 'مطروح'],
  ['north-sinai', 'North Sinai', 'شمال سيناء'],
  ['south-sinai', 'South Sinai', 'جنوب سيناء'],
].map(([id, en, ar]) => ({ id, name: { en, ar } }));

/** Convert Arabic-Indic and Persian digits to ASCII digits. */
function normalizeDigits(s) {
  return String(s).replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
}

/**
 * Normalise an Egyptian mobile number to 01XXXXXXXXX, or return null.
 * Accepts +20 / 0020 prefixes, spaces, dashes and Arabic digits.
 */
function normalizeEgyptMobile(input) {
  // Phones add invisible direction marks when a number is copied from contacts or WhatsApp.
  let s = normalizeDigits(input || '').replace(/[\s\-().\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '');
  if (s.startsWith('+20')) s = '0' + s.slice(3);
  else if (s.startsWith('0020')) s = '0' + s.slice(4);
  // "+20 010…": the leading 0 written after the country code.
  if (/^001[0125]\d{8}$/.test(s)) s = s.slice(1);
  else if (/^20 ?1/.test(s) && s.length === 12) s = '0' + s.slice(2);
  return /^01[0125]\d{8}$/.test(s) ? s : null;
}

module.exports = { GOVERNORATES, normalizeDigits, normalizeEgyptMobile };
