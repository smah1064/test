'use strict';

/** Server messages shown to shoppers, in English and Arabic. */
const MESSAGES = {
  unknownProduct: { en: 'Unknown product', ar: 'منتج غير معروف' },
  unknownColor: { en: 'Unknown colour for this product', ar: 'اللون غير متاح لهذا المنتج' },
  unknownSize: { en: 'Unknown size for this product', ar: 'المقاس غير متاح لهذا المنتج' },
  sidesRequired: { en: 'sides is required', ar: 'يجب تحديد أوجه التصميم' },
  designAtLeastOne: { en: 'Design at least one side before adding to cart', ar: 'صمّم وجهًا واحدًا على الأقل قبل الإضافة للسلة' },
  sideEmpty: { en: 'The {side} side has no design', ar: 'لا يوجد تصميم على وجه {side}' },
  unknownSide: { en: 'Unknown side: {side}', ar: 'وجه غير معروف: {side}' },
  notPng: { en: '{label} must be a PNG image', ar: '{label} يجب أن يكون صورة PNG' },
  badPng: { en: '{label} is not a valid PNG', ar: '{label} ليس صورة PNG صالحة' },
  tooLarge: { en: '{label} is too large', ar: '{label} كبير جدًا' },
  designTooLarge: { en: 'Design is too large', ar: 'التصميم كبير جدًا' },
  uploadTooLarge: { en: 'Upload is too large', ar: 'الملف المرفوع كبير جدًا' },
  designNotFound: { en: 'Design not found', ar: 'التصميم غير موجود' },
  notFound: { en: 'Not found', ar: 'غير موجود' },
  fieldRequired: { en: '{field} is required', ar: '{field} مطلوب' },
  fieldTooLong: { en: '{field} is too long', ar: '{field} طويل جدًا' },
  badEmail: { en: 'Email address looks invalid', ar: 'البريد الإلكتروني غير صحيح' },
  badPhone: { en: 'Enter an Egyptian mobile number, e.g. 01012345678', ar: 'أدخل رقم موبايل مصري صحيح، مثل 01012345678' },
  badGovernorate: { en: 'Choose a governorate', ar: 'اختر المحافظة' },
  cartEmpty: { en: 'Your cart is empty', ar: 'سلة التسوق فارغة' },
  tooManyItems: { en: 'At most {max} items per order', ar: 'الحد الأقصى {max} منتج في الطلب الواحد' },
  duplicateDesign: { en: 'Each design can only be ordered once', ar: 'لا يمكن طلب نفس التصميم أكثر من مرة' },
  designGone: { en: 'A design in your cart no longer exists', ar: 'أحد التصميمات في السلة لم يعد موجودًا' },
  designOrdered: { en: 'A design in your cart was already ordered', ar: 'أحد التصميمات في السلة تم طلبه بالفعل' },
  orderNotFound: { en: 'Order not found', ar: 'الطلب غير موجود' },
  wrongPassword: { en: 'Wrong admin password', ar: 'كلمة مرور الإدارة غير صحيحة' },
  badStatus: { en: 'status must be one of {list}', ar: 'الحالة يجب أن تكون واحدة من {list}' },
  itemNotFound: { en: 'Item not found', ar: 'المنتج غير موجود' },
  pressBusy: { en: '{order} item {n} is already printing. Finish it first.', ar: 'المنتج {n} من الطلب {order} قيد الطباعة الآن. أنهِه أولًا.' },
  serverError: { en: 'Something went wrong', ar: 'حدث خطأ ما' },
  gangEmpty: { en: 'Add at least one design to the sheet', ar: 'أضف تصميمًا واحدًا على الأقل إلى الشيت' },
  gangTooMany: { en: 'Too many designs for one sheet', ar: 'عدد التصميمات كبير جدًا على شيت واحد' },
  gangBadItem: { en: 'Check the sizes and quantities of your designs', ar: 'راجع مقاسات وكميات التصميمات' },
  gangTooWide: { en: 'A design is wider than the 56 cm film', ar: 'أحد التصميمات أعرض من الفيلم (56 سم)' },
  gangTooLong: { en: 'The sheet would be longer than 5 m. Split it into two orders.', ar: 'الشيت سيصبح أطول من 5 متر. قسّمه على طلبين.' },
  gangMissingFile: { en: 'A design file did not finish uploading', ar: 'لم يكتمل رفع أحد ملفات التصميم' },
};

const FIELDS = {
  name: { en: 'Name', ar: 'الاسم' },
  phone: { en: 'Mobile number', ar: 'رقم الموبايل' },
  email: { en: 'Email', ar: 'البريد الإلكتروني' },
  city: { en: 'City / area', ar: 'المدينة / المنطقة' },
  address: { en: 'Address', ar: 'العنوان' },
  notes: { en: 'Delivery notes', ar: 'ملاحظات التوصيل' },
};

function langOf(req) {
  const h = String(req.get('x-lang') || req.get('accept-language') || '');
  return h.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/** Pick a language from a { en, ar } value, passing plain strings through. */
function pick(value, lang) {
  if (value && typeof value === 'object') return value[lang] || value.en;
  return value;
}

function format(key, params, lang) {
  const m = MESSAGES[key];
  if (!m) return key;
  return m[lang].replace(/\{(\w+)\}/g, (_, k) => pick(params[k], lang) ?? '');
}

module.exports = { MESSAGES, FIELDS, langOf, pick, format };
