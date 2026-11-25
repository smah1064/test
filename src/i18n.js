'use strict';

/** Server messages shown to shoppers, in English and Arabic. */
const MESSAGES = {
  unknownProduct: { en: 'Unknown product', ar: 'منتج غير معروف' },
  unknownColor: { en: 'Unknown colour for this product', ar: 'اللون ده مش متاح للمنتج ده' },
  unknownSize: { en: 'Unknown size for this product', ar: 'المقاس ده مش متاح للمنتج ده' },
  sidesRequired: { en: 'sides is required', ar: 'لازم تحدد أوجه التصميم' },
  designAtLeastOne: { en: 'Design at least one side before adding to cart', ar: 'صمّم وجه واحد على الأقل قبل ما تضيفه للسلة' },
  sideEmpty: { en: 'The {side} side has no design', ar: 'مفيش تصميم على وجه {side}' },
  filmBeingMade: { en: 'This job is being put on a DTF film right now. Try again in a moment.', ar: 'الشغلانة دي بتتحط على فيلم DTF دلوقتي. جرّب تاني بعد لحظة.' },
  filmItemChanged: { en: 'A job on this film was sent back to Review or changed while the film was being made. Make the film again.', ar: 'شغلانة على الفيلم ده رجعت للمراجعة أو اتغيرت وهو بيتعمل. اعمل الفيلم تاني.' },
  fileBeingReplaced: { en: 'A corrected file for this job is being saved. Try again in a moment.', ar: 'ملف متصلّح للشغلانة دي بيتحفظ دلوقتي. جرّب تاني بعد لحظة.' },
  reopenNotNow: { en: 'Only an item waiting to print or on the press can be sent back to Review.', ar: 'القطعة ترجع للمراجعة بس وهي مستنية الطباعة أو بتتطبع.' },
  bookSaving: { en: 'Your book is still being saved. Please try again in a moment.', ar: 'الكتاب لسه بيتحفظ. جرب تاني بعد لحظة.' },
  designCompleting: { en: 'This design is being saved. Please wait a moment.', ar: 'التصميم ده بيتحفظ دلوقتي. استنى لحظة.' },
  designChanged: { en: 'The design changed while it was being saved. Please try again.', ar: 'التصميم اتغير وهو بيتحفظ. جرب تاني.' },
  unknownSide: { en: 'Unknown side: {side}', ar: 'وجه غير معروف: {side}' },
  notPng: { en: '{label} must be a PNG image', ar: '{label} لازم يكون صورة PNG' },
  badPng: { en: '{label} is not a valid PNG', ar: '{label} مش صورة PNG سليمة' },
  badImage: { en: 'That picture is not a valid image file. Please try another one.', ar: 'الصورة دي مش ملف صورة سليم. جرّب صورة تانية.' },
  badRequest: { en: 'Something in the request was not right. Please refresh the page and try again.', ar: 'في حاجة مش مظبوطة في الطلب. حدّث الصفحة وحاول تاني.' },
  tooLarge: { en: '{label} is too large', ar: '{label} كبير أوي' },
  designTooLarge: { en: 'Design is too large', ar: 'التصميم كبير أوي' },
  uploadTooLarge: { en: 'Upload is too large', ar: 'الملف اللي اترفع كبير أوي' },
  designNotFound: { en: 'Design not found', ar: 'التصميم ده مش موجود' },
  notFound: { en: 'Not found', ar: 'مش موجود' },
  aiOff: { en: 'AI help isn\'t available right now.', ar: 'المساعدة بالذكاء الاصطناعي مش متاحة دلوقتي.' },
  aiKey: { en: 'AI help isn\'t set up correctly yet.', ar: 'المساعدة بالذكاء الاصطناعي لسه مش متظبطة.' },
  aiBusy: { en: 'AI help is busy. Try again in a minute.', ar: 'المساعد مشغول دلوقتي. جرّب كمان دقيقة.' },
  aiFailed: { en: 'AI help couldn\'t finish this time. Please try again.', ar: 'الطلب ماكملش المرة دي. جرّب تاني.' },
  aiRefused: { en: 'AI help can\'t write that one. Try different words.', ar: 'مينفعش نكتب ده. جرّب كلام تاني.' },
  aiNeedName: { en: 'Type a name first.', ar: 'اكتب الاسم أولًا.' },
  aiLimit: { en: 'You\'ve used today\'s AI help. Try again tomorrow.', ar: 'خلّصت رصيد النهارده من المساعدة. جرّب بكرة.' },
  enhanceBad: { en: 'This photo couldn\'t be improved.', ar: 'معرفناش نحسّن الصورة دي.' },
  priceChanged: { en: 'Prices changed since you added these items. Please check the new total and place the order again.', ar: 'الأسعار اتغيرت من وقت ما ضفت المنتجات. راجع الإجمالي الجديد واطلب تاني.' },
  badPrice: { en: 'Enter a valid price (a number; prices cannot go below 1)', ar: 'اكتب سعرًا صحيحًا (رقم، والسعر لا يقل عن 1)' },
  badCost: { en: 'Enter a valid amount (a number, 0 or more)', ar: 'اكتب مبلغًا صحيحًا (رقم، صفر أو أكثر)' },
  bgBusy: { en: 'Many photos are being processed right now. Please try again in a minute.', ar: 'في صور كتير بتتعالج دلوقتي. حاول تاني بعد دقيقة.' },
  bgLoading: { en: 'Background removal is getting ready. Please try again in a few minutes.', ar: 'إزالة الخلفية بتجهز. حاول تاني بعد كام دقيقة.' },
  bgFailed: { en: 'Could not remove the background of this photo. Please try another photo.', ar: 'ماقدرناش نشيل خلفية الصورة دي. جرّب صورة تانية.' },
  imageTooLarge: { en: 'This picture is too large to print. Please use a smaller one.', ar: 'الصورة كبيرة أوي على الطباعة. استخدم صورة أصغر.' },
  bookLatin: { en: '{field}: please type it in English letters (the book is printed in English)', ar: '{field}: اكتبه بحروف إنجليزي من فضلك (الكتاب مطبوع بالإنجليزي)' },
  bookBadDate: { en: '{field}: please choose a real date from 1900 up to today', ar: '{field}: اختار تاريخ صحيح من سنة 1900 لحد النهارده' },
  acctName: { en: 'Please enter your name', ar: 'اكتب اسمك من فضلك' },
  acctPasswordShort: { en: 'The password needs at least 8 characters', ar: 'كلمة المرور لازم تكون 8 حروف أو أكتر' },
  acctPasswordLong: { en: 'That password is too long', ar: 'كلمة المرور طويلة جدًا' },
  acctPhoneTaken: { en: 'There is already an account with this mobile number. Sign in instead.', ar: 'في حساب بالرقم ده. سجّل دخول بدل كده.' },
  acctEmailTaken: { en: 'There is already an account with this email', ar: 'في حساب بالإيميل ده' },
  reviseNotNeeded: { en: 'This item doesn\'t need changes any more (refresh the page).', ar: 'القطعة دي مش محتاجة تعديل دلوقتي (حدّث الصفحة).' },
  reviseNotEditable: { en: 'This item can\'t be edited here. Please contact the shop.', ar: 'القطعة دي مينفعش تتعدّل من هنا. كلّمنا من فضلك.' },
  reviseOtherProduct: { en: 'The new version must be the same product as the one ordered.', ar: 'النسخة الجديدة لازم تكون نفس المنتج اللي اتطلب.' },
  revisePrice: { en: 'This version changes the price ({was} → {now}). Keep the same number of pieces and options, or contact the shop to change the order.', ar: 'النسخة دي بتغيّر السعر ({was} ← {now}). خلّي عدد القطع والاختيارات زي ما هي، أو كلّمنا لو عايز تغيّر الطلب.' },
  notInReview: { en: 'This job is no longer waiting for review (refresh the page).', ar: 'المهمة دي مش مستنية مراجعة دلوقتي (حدّث الصفحة).' },
  replaceNames: { en: "This side holds the customer's name list, so one file can't replace it. Ask the customer for changes instead.", ar: 'الوش ده عليه قائمة أسماء العميل، فمينفعش ملف واحد يحل محله. اطلب من العميل التعديل بدل كده.' },
  photosCount: { en: 'Choose between 1 and {max} photos', ar: 'اختار من صورة واحدة لحد {max} صورة' },
  photoCopies: { en: 'Copies of each photo: 1 to {max}', ar: 'عدد نسخ كل صورة: من 1 لحد {max}' },
  photoMissing: { en: 'Photo {n} did not finish uploading; please try again', ar: 'الصورة رقم {n} ما اترفعتش كاملة، حاول تاني' },
  photoSize: { en: 'Photo {n} is not the right size for printing; please try again', ar: 'الصورة رقم {n} مقاسها مش مظبوط للطباعة، حاول تاني' },
  captchaFailed: { en: 'Please complete the security check and try again', ar: 'من فضلك كمّل خطوة التحقق الأمني وحاول تاني' },
  acctWrong: { en: 'Wrong mobile number / email or password', ar: 'رقم الموبايل / الإيميل أو كلمة المرور غلط' },
  acctWrongCurrent: { en: 'Your current password is not right', ar: 'كلمة المرور الحالية مش صحيحة' },
  acctSignIn: { en: 'Please sign in', ar: 'سجّل دخول من فضلك' },
  acctResetExpired: { en: 'This reset link has expired. Ask for a new one.', ar: 'رابط إعادة التعيين انتهى. اطلب رابط جديد.' },
  // (Admin → Coupons. A customer typing a code with Arabic letters is told on the cart page: public/cart.html.)
  couponCodeBad: { en: 'Codes are 3-24 English letters or numbers (no spaces), like EID20', ar: 'الكود من 3 لـ 24 حرف إنجليزي أو رقم (من غير مسافات)، زي EID20' },
  couponTypeBad: { en: 'Choose the kind of discount', ar: 'اختار نوع الخصم' },
  couponValueBad: { en: 'Check the discount amount and limits', ar: 'راجع قيمة الخصم والحدود' },
  libNameEnMissing: { en: 'Type the design\'s English name too (the English shop shows it)', ar: 'اكتب اسم التصميم بالإنجليزي كمان (بيظهر في الموقع بالإنجليزي)' },
  libNameEnArabic: { en: 'The English name has Arabic letters: type it in English letters', ar: 'الاسم الإنجليزي فيه حروف عربي: اكتبه بحروف إنجليزي' },
  couponFixedMin: { en: 'The amount off must be at least EGP 1 (discounts are in whole pounds)', ar: 'مبلغ الخصم لازم يكون ١ ج.م. على الأقل (الخصم بالجنيه الكامل)' },
  couponMaxMin: { en: 'The maximum discount must be at least EGP 1 (discounts are in whole pounds)', ar: 'أقصى خصم لازم يكون ١ ج.م. على الأقل (الخصم بالجنيه الكامل)' },
  couponDatesBad: { en: 'Check the dates (the end must be after the start)', ar: 'راجع التواريخ (النهاية لازم تكون بعد البداية)' },
  couponExists: { en: 'A coupon with this code already exists', ar: 'في كوبون بنفس الكود ده' },
  zipBad: { en: 'That file isn\'t a zip we can open. Make a new zip of the design pictures and try again.', ar: 'الملف ده مش zip نقدر نفتحه. اعمل zip جديد للصور وجرب تاني.' },
  zipTooBig: { en: 'The zip is too big once opened. Split the designs into smaller zips.', ar: 'الـ zip كبير أوي بعد ما يتفتح. قسّم التصميمات على كذا zip أصغر.' },
  zipTooMany: { en: 'Too many files in one zip. Split the designs into smaller zips (up to 300 files each).', ar: 'ملفات كتير أوي في zip واحد. قسّمها على كذا zip (لحد ٣٠٠ ملف في كل واحد).' },
  zipOver: { en: 'The zip is over {max} MB. Split the designs into smaller zips.', ar: 'الـ zip أكبر من {max} ميجا. قسّم التصميمات على كذا zip أصغر.' },
  uploadNotReady: { en: 'The pictures in this upload are still being read. Try again in a moment.', ar: 'لسه بنقرا الصور اللي في الرفع ده. جرّب كمان شوية.' },
  zipEmpty: { en: 'No design pictures found in the zip (PNG, JPG, WEBP or SVG).', ar: 'مفيش صور تصميمات في الـ zip ده (PNG أو JPG أو WEBP أو SVG).' },
  notPicture: { en: 'Not a picture', ar: 'مش صورة' },
  tooSmall: { en: 'Too small to print well', ar: 'صغيرة أوي على الطباعة' },
  tooBig: { en: 'Too big (over 60 MB or 100 million pixels)', ar: 'كبيرة أوي (أكتر من ٦٠ ميجا أو ١٠٠ مليون بكسل)' },
  blankPicture: { en: 'The picture is empty (one plain colour)', ar: 'الصورة فاضية (لون واحد بس)' },
  badPicture: { en: 'The picture can\'t be read', ar: 'الصورة مش بتتقري' },
  uploadGone: { en: 'This upload is gone (published or discarded).', ar: 'الرفع ده مبقاش موجود (اتنشر أو اتلغى).' },
  pickProducts: { en: 'Pick at least one product for this design.', ar: 'اختار منتج واحد على الأقل للتصميم ده.' },
  pdfBudget: { en: 'Booklet PDFs can\'t be taken any more today. Please try again tomorrow, or send the pages as pictures.', ar: 'مش هينفع نستقبل ملفات PDF للكتيبات تاني النهارده. جرب بكرة، أو ابعت الصفحات كصور.' },
  pdfLocked: { en: 'This PDF is locked with a password. Save it again without a password, then upload it.', ar: 'الـ PDF ده مقفول بكلمة سر. احفظه تاني من غير كلمة سر وارفعه.' },
  previewCodeBad: { en: 'A code has 6 to 24 English letters or digits.', ar: 'الكود من ٦ لـ ٢٤ حرف إنجليزي أو رقم.' },
  previewCodeTaken: { en: 'Someone already has this code. Choose another.', ar: 'في حد واخد الكود ده. اختار كود تاني.' },
  previewOnly: { en: 'The shop is open to invited people only for now.', ar: 'الموقع مفتوح للمدعوين بس دلوقتي.' },
  couponNotFound: { en: 'This coupon code is not valid', ar: 'كود الخصم ده غير صحيح' },
  couponNotYet: { en: 'This coupon starts on {date}', ar: 'الكوبون ده بيبدأ يوم {date}' },
  couponExpired: { en: 'This coupon has expired', ar: 'الكوبون ده انتهى' },
  couponUsedUp: { en: 'This coupon has been fully used', ar: 'الكوبون ده خلص' },
  couponUsedByYou: { en: 'You have already used this coupon', ar: 'انت استخدمت الكوبون ده قبل كده' },
  couponMinOrder: { en: 'This coupon needs an order of at least {amount}', ar: 'الكوبون ده محتاج طلب بـ {amount} على الأقل' },
  couponNoItems: { en: 'This coupon does not apply to the items in your cart', ar: 'الكوبون ده مش على المنتجات اللي في السلة' },
  couponNoDiscount: { en: 'This coupon doesn\'t lower the price of this cart', ar: 'الكوبون ده مش بيقلل سعر السلة دي' },
  couponShipFree: { en: 'Shipping on this cart is already free, so this coupon doesn\'t lower its price', ar: 'الشحن على السلة دي مجاني أصلًا، فالكوبون ده مش بيقلل سعرها' },
  badAmount: { en: 'Enter an amount from 0.01 to 10,000,000', ar: 'اكتب مبلغ من ٠٫٠١ لحد ١٠٬٠٠٠٬٠٠٠' },
  badDate: { en: 'Enter a valid date', ar: 'اكتب تاريخًا صحيحًا' },
  houseName: { en: 'Enter the printing house name', ar: 'اكتب اسم المطبعة' },
  houseEmail: { en: 'That email address does not look right', ar: 'الإيميل ده مش مظبوط' },
  houseWhatsApp: { en: 'That WhatsApp number does not look right. Use a mobile number (e.g. 01012345678) or a number abroad with its country code (+971501234567). Landlines can\'t receive WhatsApp.', ar: 'رقم الواتساب ده مش مظبوط. اكتب رقم موبايل (مثلًا 01012345678) أو رقم برة مصر بكود البلد (+971501234567). الأرضي مبيستقبلش واتساب.' },
  houseContact: { en: 'Add an email or a WhatsApp number', ar: 'ضيف إيميل أو رقم واتساب' },
  houseMany: { en: 'You can save up to 50 printing houses', ar: 'تقدر تحفظ لحد ٥٠ مطبعة بس' },
  houseNotFound: { en: 'Printing house not found', ar: 'المطبعة دي مش موجودة' },
  houseChannel: { en: 'Choose email or WhatsApp', ar: 'اختار الإيميل أو واتساب' },
  houseNoEmail: { en: 'This printing house has no email address', ar: 'المطبعة دي مالهاش إيميل' },
  houseNoWhatsApp: { en: 'This printing house has no WhatsApp number', ar: 'المطبعة دي مالهاش رقم واتساب' },
  houseNoFiles: { en: 'Choose at least one file to send', ar: 'اختار ملف واحد على الأقل عشان تبعته' },
  emailOff: { en: 'Email is not set up yet (BREVO_API_KEY and MAIL_FROM in Hostinger). Send by WhatsApp instead.', ar: 'الإيميل لسه مش متظبط (BREVO_API_KEY و MAIL_FROM في Hostinger). ابعت على واتساب بدل كده.' },
  houseEmailFailed: { en: 'The email could not be sent. Try again, or send by WhatsApp.', ar: 'معرفناش نبعت الإيميل. جرّب تاني أو ابعت على واتساب.' },
  linkExpired: { en: 'This download link has expired or is not valid. Ask the shop for a new one.', ar: 'رابط التحميل ده انتهى أو مش شغال. اطلب رابط جديد من المتجر.' },
  artworkType: { en: 'Please choose an AI, EPS, PDF, JPG or PNG file (this one can\'t be read)', ar: 'من فضلك اختار ملف AI أو EPS أو PDF أو JPG أو PNG (الملف ده مش بيتقري)' },
  fieldsUnfilled: { en: 'Your design has a field in { } braces. Upload your name list, or type the real words instead.', ar: 'التصميم فيه حقل بين { }. ارفع قائمة الأسماء أو اكتب الكلام الحقيقي مكانه.' },
  artworkLocked: { en: 'This file is locked with a password. Save it again without a password, then upload it.', ar: 'الملف ده مقفول بكلمة سر. احفظه تاني من غير كلمة سر وارفعه.' },
  artworkBad: { en: 'We could not open this file. Save it from Illustrator as "PDF compatible" AI or as EPS, then try again.', ar: 'معرفناش نفتح الملف ده. احفظه من Illustrator كملف AI متوافق مع PDF أو كملف EPS، وبعدين جرّب تاني.' },
  pdfOnly: { en: 'Please choose a PDF file.', ar: 'من فضلك اختار ملف PDF.' },
  pdfBad: { en: 'We could not read the pages of this PDF. Save it again as a standard PDF (for example "Save as PDF" or "Export to PDF") and try again.', ar: 'معرفناش نقرا صفحات ملف الـ PDF ده. احفظه تاني كـ PDF عادي (مثلًا "حفظ كـ PDF" أو "تصدير PDF") وجرّب تاني.' },
  artworkEmpty: { en: 'This file looks empty: nothing visible was found on its first page.', ar: 'الملف شكله فاضي: مفيش حاجة باينة في أول صفحة فيه.' },
  tooFast: { en: 'Too many tries. Wait a minute and try again.', ar: 'محاولات كتير. استنى دقيقة وجرّب تاني.' },
  bookDrawing: { en: 'The pages are still being drawn ({done} of {total}). Try again in a few minutes.', ar: 'الصفحات لسه بتترسم ({done} من {total}). حاول تاني بعد دقايق.' },
  bookPhoto: { en: 'Add a clear photo of your child (JPG or PNG).', ar: 'ضيف صورة واضحة لطفلك (JPG أو PNG).' },
  shareEmpty: { en: 'Add something to the design before sharing it.', ar: 'ضيف حاجة للتصميم قبل ما تشاركه.' },
  shareNotFound: { en: 'This shared design wasn\'t found.', ar: 'التصميم المشارَك ده مش موجود.' },
  feedbackEmpty: { en: 'Write what you\'d change.', ar: 'اكتب التعديل اللي تقترحه.' },
  fieldRequired: { en: '{field} is required', ar: '{field} مطلوب' },
  fieldTooLong: { en: '{field} is too long', ar: '{field} طويل أوي' },
  badEmail: { en: 'Email address looks invalid', ar: 'الإيميل ده شكله مش مظبوط' },
  badPhone: { en: 'Enter an Egyptian mobile number, e.g. 01012345678', ar: 'اكتب رقم موبايل مصري صحيح، مثلًا 01012345678' },
  badGovernorate: { en: 'Choose a governorate', ar: 'اختار المحافظة' },
  badDelivery: { en: 'Choose standard or express delivery', ar: 'اختار التوصيل العادي أو السريع' },
  cartEmpty: { en: 'Your cart is empty', ar: 'السلة فاضية' },
  tooManyItems: { en: 'At most {max} items per order', ar: 'لحد {max} منتج بس في الطلب الواحد' },
  duplicateDesign: { en: 'Each design can only be ordered once', ar: 'مينفعش تطلب نفس التصميم أكتر من مرة' },
  designGone: { en: 'A design in your cart no longer exists', ar: 'فيه تصميم في السلة مبقاش موجود' },
  designOrdered: { en: 'A design in your cart was already ordered', ar: 'فيه تصميم في السلة اتطلب خلاص' },
  orderNotFound: { en: 'Order not found', ar: 'الطلب ده مش موجود' },
  orderLinkNeeded: {
    en: 'To keep your order private, it opens from the link in your order email (or the one you sent yourself on WhatsApp), or from your account if you were signed in when you ordered.',
    ar: 'عشان طلبك يفضل خاص بيك، بيتفتح من اللينك اللي في إيميل الطلب (أو اللي بعته لنفسك على واتساب)، أو من حسابك لو كنت مسجل دخول وانت بتطلب.',
  },
  teamViewOver: {
    en: 'This team link has ended: they work for 30 minutes, and only while you are signed in to the dashboard. Open the order again from the dashboard.',
    ar: 'لينك الفريق ده خلص: بيشتغل ٣٠ دقيقة بس، وطول ما انت مسجل دخول في لوحة الإدارة. افتح الطلب تاني من لوحة الإدارة.',
  },
  wrongPassword: { en: 'Wrong shared owner password', ar: 'كلمة السر المشتركة غلط' },
  tooManyLogins: { en: 'Too many wrong passwords. Try again in {min} min.', ar: 'محاولات غلط كتير. جرّب تاني بعد {min} دقيقة.' },
  tooManyLoginsTwo: { en: 'Too many wrong passwords. Try again in {min} min.', ar: 'محاولات غلط كتير. جرّب تاني بعد دقيقتين.' },
  tooManyLoginsFew: { en: 'Too many wrong passwords. Try again in {min} min.', ar: 'محاولات غلط كتير. جرّب تاني بعد {min} دقايق.' },
  wrongStaffLogin: { en: 'Wrong username or password', ar: 'اسم المستخدم أو كلمة السر غلط' },
  signInAgain: { en: 'Please sign in again', ar: 'من فضلك سجّل الدخول تاني' },
  tooManyWait: { en: 'Too many tries. Please try again in {min} min.', ar: 'محاولات كتير. جرّب تاني بعد {min}.' },
  badStatus: { en: 'status must be one of {list}', ar: 'الحالة لازم تكون واحدة من {list}' },
  importBadUrl: { en: 'Paste a full link that starts with https://', ar: 'الصق رابط كامل بيبدأ بـ https://' },
  importBlocked: { en: "This link can't be opened", ar: 'الرابط ده مش ممكن نفتحه' },
  importFailed: { en: "We couldn't open that link. Try again, or save the picture and upload it", ar: 'معرفناش نفتح الرابط. جرّب تاني، أو احفظ الصورة وارفعها' },
  importRefused: { en: "That site doesn't let us read its pages. Save the picture (or take a screenshot) and upload it", ar: 'الموقع ده مش بيسمح لنا نقرأ صفحاته. احفظ الصورة (أو خد سكرين شوت) وارفعها' },
  importTooBig: { en: 'That file is too big (15 MB at most)', ar: 'الملف كبير أوي (أقصى حاجة 15 ميجا)' },
  importNoImages: { en: "We couldn't find pictures on that page. Save the picture (or take a screenshot) and upload it", ar: 'ملقيناش صور في الصفحة دي. احفظ الصورة (أو خد سكرين شوت) وارفعها' },
  importNotImage: { en: "That link isn't a picture we can use", ar: 'الرابط ده مش صورة نقدر نستخدمها' },
  rightsRequired: { en: 'Please confirm you own the imported design or have permission to print it', ar: 'من فضلك أكّد إن التصميم المستورد ملكك أو معاك إذن بطباعته' },
  takedownMissing: { en: 'Please fill in your name, how to reach you and the details', ar: 'من فضلك اكتب اسمك وطريقة التواصل والتفاصيل' },
  printTooSmall: { en: 'The print file is far too small for this product. Please try again.', ar: 'ملف الطباعة صغير جدًا على المنتج ده. جرّب تاني.' },
  embOneSide: { en: 'Embroidery is on the front only', ar: 'التطريز على الوش بس' },
  embEmpty: { en: 'The embroidery spot is empty: put your design there', ar: 'مكان التطريز فاضي: حط تصميمك فيه' },
  badTrackingUrl: { en: 'The tracking link must start with http:// or https://', ar: 'رابط التتبع لازم يبدأ بـ http:// أو https://' },
  badDate: { en: 'Use a date like 2026-12-31.', ar: 'اكتب التاريخ بالشكل ده 2026-12-31.' },
  badOption: { en: 'That option isn\'t available for this product.', ar: 'الاختيار ده مش متاح للمنتج ده.' },
  approvalRequired: { en: 'Please check and approve each item\'s proof before ordering.', ar: 'راجع البروفة ووافق عليها لكل منتج قبل إتمام الطلب.' },
  proofChanged: { en: 'A design changed since you approved it. Please check the new proof.', ar: 'فيه تصميم اتغيّر بعد ما وافقت عليه. راجع البروفة الجديدة.' },
  notApproved: { en: 'This job isn\'t cleared for printing: it needs review or the customer\'s approval of the current files.', ar: 'الشغلانة دي لسه مش جاهزة للطباعة: محتاجة مراجعة أو موافقة العميل على الملفات الحالية.' },
  proofNotFound: { en: 'This proof link is not valid any more. Check your latest email or open your order.', ar: 'رابط البروفة ده مبقاش شغال. شوف آخر إيميل مننا أو افتح صفحة طلبك.' },
  proofDone: { en: 'This proof was already answered.', ar: 'البروفة دي اترد عليها خلاص.' },
  badDecision: { en: 'Choose approve or request changes.', ar: 'اختار توافق أو تطلب تعديل.' },
  noteRequired: { en: 'Write what needs to change.', ar: 'اكتب التعديل المطلوب.' },
  confirmNoteRequired: { en: 'Write how the customer confirmed this version (e.g. "Confirmed on WhatsApp").', ar: 'اكتب العميل أكّد النسخة دي إزاي (مثلاً "أكّد على واتساب").' },
  alreadyPrinting: { en: 'This item is already being printed.', ar: 'المنتج ده بيتطبع خلاص.' },
  replacementSize: { en: 'The corrected file must be exactly {w} × {h} pixels.', ar: 'الملف المعدّل لازم يكون {w} × {h} بكسل بالظبط.' },
  qtyBad: { en: 'Check the quantities: whole numbers, at least one piece.', ar: 'راجع الكميات: أرقام صحيحة وقطعة واحدة على الأقل.' },
  qtyNoColors: { en: 'This product can be ordered in one colour per design.', ar: 'المنتج ده بيتطلب بلون واحد لكل تصميم.' },
  qtyOnePageCount: { en: 'A booklet design is for one page count: order other page counts as their own design.', ar: 'تصميم الكتيب بيبقى لعدد صفحات واحد: اطلب أي عدد صفحات تاني كتصميم لوحده.' },
  qtyNoSizes: { en: 'This product can be ordered in one size per design (a bigger size is a bigger print).', ar: 'المنتج ده بيتطلب بمقاس واحد لكل تصميم (المقاس الأكبر طباعته أكبر).' },
  qtyTooMany: { en: 'Up to {max} pieces per design. For more, add the design again.', ar: 'لحد {max} قطعة للتصميم. لو محتاج أكتر ضيف التصميم تاني.' },
  mergeBadSize: { en: 'Row {row}: size "{value}" is not one of this product\'s sizes ({list}).', ar: 'الصف {row}: المقاس "{value}" مش من مقاسات المنتج ({list}).' },
  mergeBadColor: { en: 'Row {row}: colour "{value}" is not one of this product\'s colours ({list}).', ar: 'الصف {row}: اللون "{value}" مش من ألوان المنتج ({list}).' },
  mergeNotAllowed: { en: 'Name lists are not available for this product.', ar: 'قوائم الأسماء مش متاحة للمنتج ده.' },
  mergeBad: { en: 'The name list could not be read. Please upload it again.', ar: 'معرفناش نقرا قائمة الأسماء. ارفعها تاني.' },
  mergeEmpty: { en: 'The list has no names. The first row should be the column titles (for example Name), then one row per copy.', ar: 'القائمة مفيهاش أسماء. أول صف يكون عناوين الأعمدة (مثلًا الاسم)، وبعده صف لكل نسخة.' },
  mergeTooMany: { en: 'A list can have up to {max} rows. Split it into more than one order.', ar: 'القائمة ممكن يكون فيها لحد {max} صف. قسّمها على أكتر من طلب.' },
  mergeXls: { en: 'This is an old Excel file (.xls). In Excel choose "Save as" → Excel Workbook (.xlsx) or CSV, then upload that.', ar: 'ده ملف إكسل قديم (.xls). من إكسل اختار "حفظ باسم" ← Excel Workbook (.xlsx) أو CSV وارفعه.' },
  mergeUnreadable: { en: 'Upload an Excel file (.xlsx) or a CSV file.', ar: 'ارفع ملف إكسل (.xlsx) أو ملف CSV.' },
  mergeNoFields: { en: 'Add at least one field from your list (for example {Name}) to a text in the design.', ar: 'ضيف حقل واحد على الأقل من القائمة (مثلًا {الاسم}) في نص في التصميم.' },
  mergeFiles: { en: 'The names could not be prepared for printing. Please try again.', ar: 'معرفناش نجهز الأسماء للطباعة. جرّب تاني.' },
  mergeZipTooBig: { en: 'Too many copies for separate files. Download the single PDF with all copies instead.', ar: 'النسخ كتير على ملفات منفصلة. نزّل ملف الـ PDF الواحد اللي فيه كل النسخ.' },
  badProcess: { en: 'This product can be printed with: {list}', ar: 'المنتج ده بيتطبع بـ: {list}' },
  itemNotFound: { en: 'Item not found', ar: 'المنتج غير موجود' },
  pressBusy: { en: '{order} item {n} is already printing. Finish it first.', ar: 'المنتج {n} من الطلب {order} قيد الطباعة الآن. أنهِه أولًا.' },
  serverError: { en: 'Something went wrong', ar: 'حصلت مشكلة' },
  gangEmpty: { en: 'Add at least one design to the sheet', ar: 'ضيف تصميم واحد على الأقل للشيت' },
  gangTooMany: { en: 'Too many designs for one sheet', ar: 'التصميمات كتير أوي على شيت واحد' },
  gangBadItem: { en: 'Check the sizes and quantities of your designs', ar: 'راجع مقاسات وكميات التصميمات' },
  gangTooWide: { en: 'A design is wider than the 56 cm film', ar: 'فيه تصميم أعرض من الفيلم (56 سم)' },
  gangTooLong: { en: 'The sheet would be longer than 5 m. Split it into two orders.', ar: 'الشيت هيبقى أطول من 5 متر. قسّمه على طلبين.' },
  gangMissingFile: { en: 'A design file did not finish uploading', ar: 'فيه ملف تصميم ماترفعش كامل' },
  // Product manager (admin → Products) and what the shop says about it.
  productUnavailable: { en: '{name} is not available right now. Remove it from the cart or choose another product.', ar: '{name} مش متاح دلوقتي. شيله من السلة أو اختار منتج تاني.' },
  // Archived in admin → Products ("stop selling"): not coming back; the shop offers similar products.
  productRetired: { en: '{name} is no longer sold. Remove it from your cart or put your design on a similar product.', ar: '{name} مبقاش بيتباع. شيله من السلة أو حط تصميمك على منتج شبهه.' },
  colorUnavailable: { en: 'This colour of {name} is sold out right now. Please choose another colour.', ar: 'اللون ده من {name} خلصان دلوقتي. اختار لون تاني.' },
  sizeUnavailable: { en: 'This size of {name} is sold out right now. Please choose another size.', ar: 'المقاس ده من {name} خلصان دلوقتي. اختار مقاس تاني.' },
  sideUnavailable: { en: 'One side of {name} can\'t be printed right now. Remove the design from that side.', ar: 'وش من {name} مش متاح للطباعة دلوقتي. شيل التصميم من الوش ده.' },
  variantUnavailable: { en: 'This colour in this size of {name} is sold out right now. Please choose another colour or size.', ar: 'اللون ده بالمقاس ده من {name} خلصان دلوقتي. اختار لون أو مقاس تاني.' },
  notEnoughStock: { en: 'Only {left} of {name} left. Please order fewer pieces.', ar: 'فاضل {left} بس من {name}. اطلب عدد أقل.' },
  // Nothing left of it for this item: never "Only 0 left… order fewer" (format() picks this one for notEnoughStock with left 0).
  stockNoneLeft: { en: 'No more pieces of {name} are left for this item.', ar: 'مفيش قطع تانية فاضلة من {name} للمنتج ده.' },
  // The cart's prices (POST /api/cart/quote): what is left is all taken by the items above this one in the cart.
  stockInCart: { en: 'The last pieces of {name} are in another item in your cart.', ar: 'آخر قطع من {name} في منتج تاني في سلتك.' },
  badProductField: { en: 'Please check this field: {field}', ar: 'راجع الخانة دي: {field}' },
  needOneColor: { en: 'Keep at least one colour on.', ar: 'خلّي لون واحد على الأقل شغال.' },
  needOneSize: { en: 'Keep at least one size on.', ar: 'خلّي مقاس واحد على الأقل شغال.' },
  needOneSide: { en: 'Keep at least one side on.', ar: 'خلّي وش واحد على الأقل شغال.' },
  badProductId: { en: 'The product code can use small English letters, numbers and dashes only (for example: kids-cap).', ar: 'كود المنتج حروف إنجليزي صغيرة وأرقام وشَرطة بس (مثلًا: kids-cap).' },
  productIdTaken: { en: 'There is already a product with this code.', ar: 'فيه منتج بالكود ده بالفعل.' },
  badTemplate: { en: 'New products can\'t be made from this one.', ar: 'مينفعش نعمل منتج جديد من ده.' },
  tooManyProducts: { en: 'Too many added products.', ar: 'المنتجات المضافة كتير.' },
  tooManyPhotos: { en: 'Up to {max} photos per product.', ar: 'لحد {max} صور للمنتج.' },
  badPhoto: { en: 'Upload a JPG, PNG or WebP photo (up to 15 MB).', ar: 'ارفع صورة JPG أو PNG أو WebP (لحد 15 ميجا).' },
  ownerOnly: { en: 'Only the shop owner can do this.', ar: 'صاحب الموقع بس اللي يقدر يعمل ده.' },
  noPermission: { en: 'Your role doesn\'t include this. Ask an owner.', ar: 'الدور بتاعك مش فيه الحاجة دي. اسأل صاحب الموقع.' },
  staffSelf: { en: 'You can\'t switch off or remove your own owner account. Another owner can.', ar: 'مينفعش توقف أو تشيل حساب صاحب الموقع بتاعك بنفسك. صاحب موقع تاني يقدر.' },
  setupLinkBad: { en: 'This set-up link doesn\'t work any more. Ask an owner for a new one.', ar: 'لينك التفعيل ده مبقاش شغال. اطلب لينك جديد من صاحب الموقع.' },
  emergencyPassword: { en: 'The shared password is changed on the hosting, not here.', ar: 'كلمة السر المشتركة بتتغير من الاستضافة، مش من هنا.' },
  wrongCurrentPassword: { en: 'Your current password is wrong.', ar: 'كلمة السر الحالية غلط.' },
  passwordTooShort: { en: 'Choose a password of at least 10 characters that isn\'t easy to guess (not only numbers, not one letter repeated, not your name or username, not a common one like qwerty123).', ar: 'اختار كلمة سر 10 حروف على الأقل ومش سهلة التخمين (مش أرقام بس، ومش حرف واحد متكرر، ومش اسمك أو اسم الدخول بتاعك، ومش كلمة مشهورة زي qwerty123).' },
  nothingToApprove: { en: 'There is nothing to change in this request.', ar: 'الطلب ده مفيهوش حاجة تتغير.' },
  ownerOwnPassword: { en: 'An owner chooses their own password: send this person a set-up link first, then make them an owner.', ar: 'صاحب الموقع بيختار كلمة السر بنفسه: ابعت للشخص ده لينك التفعيل الأول، وبعدين خليه صاحب موقع.' },
  productIdWaiting: { en: 'A new product with this code is already waiting for an owner\'s approval.', ar: 'فيه منتج جديد بالكود ده مستني موافقة صاحب الموقع خلاص.' },
  couponWaiting: { en: 'A coupon with this code is already waiting for an owner\'s approval.', ar: 'فيه كوبون بالكود ده مستني موافقة صاحب الموقع خلاص.' },
  expenseGone: { en: 'This expense was already deleted.', ar: 'المصروف ده اتمسح قبل كده.' },
  couponGone: { en: 'This coupon was deleted.', ar: 'الكوبون ده اتمسح.' },
  jobMoved: { en: 'Someone else moved this job meanwhile: the list is up to date now.', ar: 'حد تاني غيّر حالة الشغلانة دي في نفس الوقت: القايمة اتحدّثت.' },
  staffOffLink: { en: 'This person is switched off: turn them on first, then send a set-up link.', ar: 'الشخص ده متوقف: شغّله الأول، وبعدين ابعتله لينك التفعيل.' },
  approvalPersonGone: { en: 'The person who asked was switched off or removed, or no longer has the role for this change.', ar: 'الشخص اللي طلبه اتوقف أو اتشال، أو مبقاش عنده الدور اللي يسمح بالتعديل ده.' },
  tooManyMine: { en: 'You have many changes waiting for approval. Wait for an owner to go through them, or withdraw some.', ar: 'عندك تعديلات كتير مستنية موافقة. استنى صاحب الموقع يراجعها، أو اسحب شوية منها.' },
  ownerPasswordLink: { en: 'An owner\'s password isn\'t typed by someone else: send them a new set-up link. For your own, use "Change my password".', ar: 'كلمة سر صاحب الموقع محدش بيكتبها غيره: ابعتله لينك تجهيز جديد. ولو بتاعتك: من "غيّر كلمة السر".' },
  approvalDecidedBy: { en: 'Already decided by {name}: the list is up to date now.', ar: 'اتاخد فيه قرار خلاص من {name}: القايمة اتحدّثت.' },
  approvalDecided: { en: 'This change was already decided.', ar: 'التعديل ده اتاخد فيه قرار خلاص.' },
  tooManyApprovals: { en: 'Too many changes are waiting for approval. Ask an owner to go through them first.', ar: 'فيه تعديلات كتير مستنية موافقة. اطلب من صاحب الموقع يراجعها الأول.' },
  badStaff: { en: 'Enter a name, a username (small English letters and numbers) and at least one role. A password needs at least 10 characters.', ar: 'اكتب الاسم واسم مستخدم (حروف إنجليزي صغيرة وأرقام) واختار دور واحد على الأقل. كلمة السر 10 حروف على الأقل.' },
  productsKept: { en: 'Products are not deleted, so their orders and history stay. Stop selling it instead: it moves to Archived and you can sell it again any time.', ar: 'المنتجات مش بتتمسح عشان طلباتها وتاريخها يفضلوا موجودين. وقّف بيعه بدل كده: هيتنقل للأرشيف وتقدر ترجّعه للبيع في أي وقت.' },
  productInUse: { en: 'This product is in designs or orders already: pause it or stop selling it instead of deleting it.', ar: 'المنتج ده موجود في تصميمات أو طلبات: وقّفه مؤقتًا أو وقّف بيعه بدل ما تمسحه.' },
  staffTaken: { en: 'This username is taken.', ar: 'اسم المستخدم ده موجود.' },
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

// Arabic messages never mix digits: the shop's own words show numbers as ١٢٣ (codes such as
// A5, 3D or 2XL stay; what a customer typed is passed in as text and isn't touched).
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const LATIN_NUM = /(?<![A-Za-z0-9_\-/@:#=?&%"'.])\d+(?:[.,]\d+)*(?![A-Za-z0-9_\-/@:%"']|[.,]\d)/g;
// (A number in English words stays as written: "iPhone 16 Pro", "Class of 2025"; as on the pages.)
const LATIN_BEFORE = /[A-Za-z][A-Za-z'’]*\s+$/;
const LATIN_AFTER = /^\s+[A-Za-z]/;
const arabicDigits = (s) => {
  const str = String(s);
  return str.replace(LATIN_NUM, (m, at) => (LATIN_BEFORE.test(str.slice(Math.max(0, at - 40), at)) || LATIN_AFTER.test(str.slice(at + m.length, at + m.length + 4))
    ? m
    : m.replace(/\d/g, (d) => AR_DIGITS[d]).replace(/\./g, '٫').replace(/,/g, '٬')));
};

function format(key, params, lang) {
  // "Only 0 left… order fewer": never; nothing left for the item has its own words.
  if (key === 'notEnoughStock' && params && typeof params.left === 'number' && params.left <= 0) key = 'stockNoneLeft';
  const m = MESSAGES[key];
  if (!m) return key;
  return (lang === 'ar' ? arabicDigits(m.ar) : m[lang]).replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    // Amounts of money as the pages show them ("EGP 1,000" / "١٬٠٠٠ ج.م."); other numbers in the page's digits.
    if (typeof v === 'number' && (k === 'amount' || k === 'was' || k === 'now')) return money(v, lang);
    // A calendar day (2026-12-25) as words in the page's language: "25 December 2026" / "٢٥ ديسمبر ٢٠٢٦".
    if (k === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      try {
        return new Date(`${v}T12:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      } catch (e) { /* as it is */ }
    }
    // Minutes in Arabic with their word ("دقيقة واحدة", "دقيقتين", "٥ دقايق", "١١ دقيقة").
    if (key === 'tooManyWait' && k === 'min' && typeof v === 'number' && lang === 'ar') {
      const n = new Intl.NumberFormat('ar-EG', { useGrouping: false }).format(v);
      return v === 1 ? 'دقيقة واحدة' : v === 2 ? 'دقيقتين' : v >= 3 && v <= 10 ? `${n} دقايق` : `${n} دقيقة`;
    }
    if (typeof v === 'number' && lang === 'ar') return new Intl.NumberFormat('ar-EG', { useGrouping: false }).format(v);
    // The shop's own bilingual words (a product's name, a size) in the page's digits.
    if (lang === 'ar' && v && typeof v === 'object' && v.ar) return arabicDigits(v.ar);
    return pick(v, lang) ?? '';
  });
}
function money(n, lang) {
  try {
    // Whole pounds without ".00", as the pages show money.
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
  } catch (e) {
    return `${n} EGP`;
  }
}

module.exports = { MESSAGES, FIELDS, langOf, pick, format, arabicDigits };
