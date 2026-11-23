// Messages shown to employees in the mobile app, in English and Arabic.
// The app sends `Accept-Language: ar` or `en`; anything else gets English.
// What is stored for admins (security alerts, reports) is always English.

const MESSAGES = {
  // auth
  CODE_PASSWORD_REQUIRED: {
    en: 'Employee code and password are required',
    ar: 'رمز الموظف وكلمة المرور مطلوبان',
  },
  TOO_MANY_ATTEMPTS: {
    en: 'Too many attempts. Try again in 15 minutes.',
    ar: 'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة.',
  },
  WRONG_CREDENTIALS: {
    en: 'Wrong employee code or password',
    ar: 'رمز الموظف أو كلمة المرور غير صحيحة',
  },
  ACCOUNT_DISABLED: { en: 'Account disabled', ar: 'هذا الحساب موقوف' },
  USE_MOBILE_APP: { en: 'Please use the mobile app to log in', ar: 'يرجى تسجيل الدخول من تطبيق الجوال' },
  DEVICE_MISMATCH: {
    en: 'This account is registered to another phone. Ask your admin to reset your device.',
    ar: 'هذا الحساب مسجّل على جوال آخر. اطلب من المسؤول إعادة تعيين جهازك.',
  },
  NOT_LOGGED_IN: { en: 'Not logged in', ar: 'لم تسجّل الدخول' },
  SESSION_EXPIRED: {
    en: 'Session expired, please log in again',
    ar: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
  },
  NOT_ALLOWED: { en: 'Not allowed', ar: 'غير مسموح' },

  // attendance
  DEV_MODE: {
    en: 'Developer options are turned on. Turn them off and try again.',
    ar: 'خيارات المطوّر مفعّلة. أوقفها ثم حاول مرة أخرى.',
  },
  MOCK_LOCATION: {
    en: 'A fake-GPS / mock location was detected. Punch blocked.',
    ar: 'تم اكتشاف موقع وهمي (GPS مزيف). تم رفض التسجيل.',
  },
  ROOTED: {
    en: 'This phone is rooted or jailbroken and cannot be used for attendance.',
    ar: 'هذا الجوال مكسور الحماية (روت/جيلبريك) ولا يمكن استخدامه لتسجيل الحضور.',
  },
  LOCATION_MISSING: { en: 'Location is missing', ar: 'الموقع غير متوفر' },
  SELFIE_REQUIRED: {
    en: 'A selfie taken with the in-app camera is required',
    ar: 'يجب التقاط صورة سيلفي بكاميرا التطبيق',
  },
  STALE: {
    en: 'The selfie is too old. Please take a new one.',
    ar: 'صورة السيلفي قديمة. يرجى التقاط صورة جديدة.',
  },
  LOW_ACCURACY: {
    en: 'GPS signal is too weak (±{acc} m). Move near a window or outside and try again.',
    ar: 'إشارة GPS ضعيفة (±{acc} م). اقترب من نافذة أو اخرج وحاول مرة أخرى.',
  },
  NO_SITES: {
    en: 'No work location is set up yet. Contact your admin.',
    ar: 'لم يتم إعداد موقع عمل بعد. تواصل مع المسؤول.',
  },
  OUT_OF_RANGE: {
    en: 'You are {distance} m from {site}. You must be within {radius} m.',
    ar: 'أنت على بُعد {distance} م من {site}. يجب أن تكون ضمن {radius} م.',
  },
  ALREADY_IN: { en: 'You are already checked in', ar: 'لقد سجّلت حضورك بالفعل' },
  NOT_IN: { en: 'You are not checked in', ar: 'لم تسجّل حضورك بعد' },
  UPLOAD_ERROR: { en: 'Upload error: {detail}', ar: 'خطأ في رفع الملف: {detail}' },
};

function format(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** 'ar' or 'en' for this request. */
function langOf(req) {
  return req.acceptsLanguages('en', 'ar') === 'ar' ? 'ar' : 'en';
}

/** Message in the requester's language. */
function t(req, key, params) {
  const m = MESSAGES[key];
  if (!m) throw new Error(`Unknown message ${key}`);
  return format(m[langOf(req)] || m.en, params);
}

/** English message (for logs shown to admins). */
function en(key, params) {
  return format(MESSAGES[key].en, params);
}

module.exports = { t, en, langOf, MESSAGES };
