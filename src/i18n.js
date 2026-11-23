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
  aiOff: { en: 'AI help isn\'t available right now.', ar: 'المساعدة بالذكاء الاصطناعي غير متاحة حاليًا.' },
  aiKey: { en: 'AI help isn\'t set up correctly yet.', ar: 'المساعدة بالذكاء الاصطناعي لم تُضبط بعد.' },
  aiBusy: { en: 'AI help is busy. Try again in a minute.', ar: 'المساعد مشغول الآن. جرّب بعد دقيقة.' },
  aiFailed: { en: 'AI help couldn\'t finish this time. Please try again.', ar: 'لم يكتمل الطلب هذه المرة. حاول مرة أخرى.' },
  aiRefused: { en: 'AI help can\'t write that one. Try different words.', ar: 'لا يمكن كتابة هذا الطلب. جرّب كلمات أخرى.' },
  aiNeedName: { en: 'Type a name first.', ar: 'اكتب الاسم أولًا.' },
  aiLimit: { en: 'You\'ve used today\'s AI help. Try again tomorrow.', ar: 'استخدمت رصيد اليوم من المساعدة. جرّب غدًا.' },
  enhanceBad: { en: 'This photo couldn\'t be improved.', ar: 'تعذّر تحسين هذه الصورة.' },
  badPrice: { en: 'Enter a valid price (a number; prices cannot go below 1)', ar: 'اكتب سعرًا صحيحًا (رقم، والسعر لا يقل عن 1)' },
  badCost: { en: 'Enter a valid amount (a number, 0 or more)', ar: 'اكتب مبلغًا صحيحًا (رقم، صفر أو أكثر)' },
  badDate: { en: 'Enter a valid date', ar: 'اكتب تاريخًا صحيحًا' },
  houseName: { en: 'Enter the printing house name', ar: 'اكتب اسم المطبعة' },
  houseEmail: { en: 'That email address does not look right', ar: 'البريد الإلكتروني غير صحيح' },
  houseWhatsApp: { en: 'That WhatsApp number does not look right (e.g. 01012345678 or +971501234567)', ar: 'رقم الواتساب غير صحيح (مثال: 01012345678 أو +971501234567)' },
  houseContact: { en: 'Add an email or a WhatsApp number', ar: 'أضف بريدًا إلكترونيًا أو رقم واتساب' },
  houseMany: { en: 'You can save up to 50 printing houses', ar: 'يمكنك حفظ 50 مطبعة كحد أقصى' },
  houseNotFound: { en: 'Printing house not found', ar: 'المطبعة غير موجودة' },
  houseChannel: { en: 'Choose email or WhatsApp', ar: 'اختر البريد الإلكتروني أو واتساب' },
  houseNoEmail: { en: 'This printing house has no email address', ar: 'لا يوجد بريد إلكتروني لهذه المطبعة' },
  houseNoWhatsApp: { en: 'This printing house has no WhatsApp number', ar: 'لا يوجد رقم واتساب لهذه المطبعة' },
  houseNoFiles: { en: 'Choose at least one file to send', ar: 'اختر ملفًا واحدًا على الأقل للإرسال' },
  emailOff: { en: 'Email is not set up yet (BREVO_API_KEY and MAIL_FROM in Hostinger). Send by WhatsApp instead.', ar: 'البريد الإلكتروني غير مُعدّ بعد (BREVO_API_KEY و MAIL_FROM في Hostinger). أرسل عبر واتساب بدلًا من ذلك.' },
  houseEmailFailed: { en: 'The email could not be sent. Try again, or send by WhatsApp.', ar: 'تعذر إرسال البريد. حاول مرة أخرى أو أرسل عبر واتساب.' },
  linkExpired: { en: 'This download link has expired or is not valid. Ask the shop for a new one.', ar: 'رابط التحميل انتهت صلاحيته أو غير صالح. اطلب رابطًا جديدًا من المتجر.' },
  artworkType: { en: 'Please choose an AI, EPS, JPG or PNG file', ar: 'من فضلك اختر ملف AI أو EPS أو JPG أو PNG' },
  artworkBad: { en: 'We could not open this file. Save it from Illustrator as "PDF compatible" AI or as EPS, then try again.', ar: 'لم نتمكن من فتح هذا الملف. احفظه من Illustrator كملف AI متوافق مع PDF أو كملف EPS ثم حاول مرة أخرى.' },
  artworkEmpty: { en: 'This file looks empty: nothing visible was found on its first page.', ar: 'يبدو أن الملف فارغ: لا يوجد شيء ظاهر في صفحته الأولى.' },
  tooFast: { en: 'Too many tries. Wait a minute and try again.', ar: 'محاولات كثيرة. انتظر دقيقة وحاول مرة أخرى.' },
  bookDrawing: { en: 'The pages are still being drawn ({done} of {total}). Try again in a few minutes.', ar: 'الصفحات لسه بتترسم ({done} من {total}). حاول تاني بعد دقايق.' },
  bookPhoto: { en: 'Add a clear photo of your child (JPG or PNG).', ar: 'أضف صورة واضحة لطفلك (JPG أو PNG).' },
  shareEmpty: { en: 'Add something to the design before sharing it.', ar: 'أضف شيئًا للتصميم قبل مشاركته.' },
  shareNotFound: { en: 'This shared design wasn\'t found.', ar: 'لم يتم العثور على التصميم المشارَك.' },
  feedbackEmpty: { en: 'Write what you\'d change.', ar: 'اكتب التعديل الذي تقترحه.' },
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
  tooManyLogins: { en: 'Too many wrong passwords. Try again in {min} min.', ar: 'محاولات خاطئة كثيرة. حاول مرة أخرى بعد {min} دقيقة.' },
  signInAgain: { en: 'Please sign in again', ar: 'من فضلك سجّل الدخول مرة أخرى' },
  tooManyWait: { en: 'Too many tries. Please try again in {min} min.', ar: 'محاولات كثيرة. حاول مرة أخرى بعد {min} دقيقة.' },
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
