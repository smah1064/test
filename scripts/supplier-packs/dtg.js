'use strict';
/* Supplier pack: DTG (direct to garment). Facts about the files come from src/printfiles.js and src/app.js FORMATS. */
const L = (s) => `<span dir="ltr">${s}</span>`;
const WH = (w, h) => `عرض ${L(w)} × ارتفاع ${L(h)} سم`;
// Print sizes are read from the product data, so the pack can't drift from the site.
const { PRODUCTS } = require('../../src/products');
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const area = (id, sideId = 'front') => {
  const s = PRODUCTS.find((p) => p.id === id).sides.find((x) => x.id === sideId);
  return WH(cm(s.printWidthIn), cm((s.printWidthIn * s.printArea.h) / s.printArea.w));
};

// The test print: 20 × 25 cm, transparent background. Sizes are in cm through --cm.
const SW = [['#00aeef', 'C'], ['#ec008c', 'M'], ['#fff200', 'Y'], ['#000000', 'K'], ['#ed1c24', 'R'], ['#00a651', 'G'], ['#2e3192', 'B'], ['#f7941d', 'Orange'], ['#f5c9a8', 'Skin 1'], ['#a86b45', 'Skin 2']];
const u = (n) => `calc(var(--cm)*${n})`;
const TEST_HTML = (brandName) => `
<div style="position:relative;width:${u(20)};height:${u(25)};color:#000">
  <div style="position:absolute;inset:0;border:${u(0.05)} solid #000"></div>
  <div style="position:absolute;left:${u(0.6)};top:${u(0.4)};right:${u(0.6)};display:flex;justify-content:space-between;align-items:baseline">
    <b style="font-size:${u(0.75)}">${brandName ? `${brandName} · ` : ''}DTG test</b><span style="font-size:${u(0.4)}">frame = 20.0 × 25.0 cm · 300 DPI · sRGB</span></div>

  <div style="position:absolute;left:${u(0.6)};top:${u(1.9)};display:flex;gap:${u(0.2)}">
    ${SW.map(([c, n]) => `<div style="width:${u(1.7)};text-align:center;font-size:${u(0.3)}"><div style="height:${u(1.7)};background:${c}"></div>${n}</div>`).join('')}</div>

  <div style="position:absolute;left:${u(0.6)};top:${u(4.5)};width:${u(18.8)}">
    ${['#00aeef', '#ec008c', '#fff200', '#000000', '#ed1c24'].map((c) => `<div style="height:${u(0.7)};margin-bottom:${u(0.12)};background:linear-gradient(90deg,${c},${c}00)"></div>`).join('')}
    <div style="font-size:${u(0.3)}">100% → transparent (soft edges / shadows)</div>
    <div style="display:flex;margin-top:${u(0.2)}">${[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((k) => { const v = Math.round(255 * (1 - k / 100)); return `<div style="flex:1;height:${u(1)};background:rgb(${v},${v},${v});color:${k > 50 ? '#fff' : '#000'};font-size:${u(0.3)};text-align:center;line-height:${u(1)}">${k}</div>`; }).join('')}</div>
    <div style="font-size:${u(0.3)}">grey steps (0 = white ink only on dark garments)</div>
  </div>

  <div style="position:absolute;left:${u(0.6)};top:${u(11.3)};width:${u(9)}">
    ${[0.1, 0.2, 0.3, 0.5, 0.75, 1].map((mm) => `<div style="display:flex;align-items:center;gap:${u(0.3)};height:${u(0.55)}"><span style="font-size:${u(0.3)};width:${u(1.4)}">${mm} mm</span><div style="flex:1;height:${u(mm / 10)};background:#000"></div><div style="flex:1;height:${u(mm / 10)};background:#ed1c24"></div></div>`).join('')}
    <div style="margin-top:${u(0.3)}">${[6, 8, 10, 12, 14].map((pt) => `<div style="font-size:${u(pt * 0.03528)};line-height:1.5;white-space:nowrap">${pt} pt · Quality print · طباعة بجودة عالية</div>`).join('')}</div>
  </div>

  <div style="position:absolute;left:${u(10.4)};top:${u(11.3)};width:${u(9)};height:${u(6.6)};background:#1f2f54;color:#fff;padding:${u(0.4)};box-sizing:border-box">
    <div style="font-size:${u(0.55)};font-weight:700">White on colour · أبيض على لون</div>
    ${[6, 8, 10, 12].map((pt) => `<div style="font-size:${u(pt * 0.03528)};line-height:1.5">${pt} pt · White text · كلام أبيض</div>`).join('')}
    <div style="display:flex;gap:${u(0.3)};margin-top:${u(0.3)}">${['#ffffff', '#fff200', '#ec008c', '#00aeef'].map((c) => `<div style="width:${u(1.5)};height:${u(1.5)};border-radius:50%;background:${c}"></div>`).join('')}</div>
    ${[0.2, 0.5].map((mm) => `<div style="height:${u(mm / 10)};background:#fff;margin-top:${u(0.3)}"></div>`).join('')}
  </div>

  <div style="position:absolute;left:${u(0.6)};top:${u(18.6)};display:flex;gap:${u(0.5)};align-items:center">
    <div style="width:${u(5)};height:${u(5)};border-radius:50%;background:radial-gradient(circle,#fff200,#f7941d 45%,#ed1c24 70%,#2e3192)"></div>
    <div style="width:${u(5)};height:${u(5)};background:conic-gradient(#ed1c24,#fff200,#00a651,#00aeef,#2e3192,#ec008c,#ed1c24)"></div>
    <div style="width:${u(7.3)};font-size:${u(0.38)};line-height:1.5">
      <div style="height:${u(0.06)};background:#000;width:${u(5)}"></div>
      this line = 5.0 cm<br>
      <b>White solid:</b>
      <div style="height:${u(1.2)};background:#fff;border:${u(0.03)} solid #000"></div>
      <b>Rich black:</b>
      <div style="height:${u(1.2)};background:#000"></div>
    </div>
  </div>
  <div style="position:absolute;left:${u(0.6)};right:${u(0.6)};bottom:${u(0.35)};font-size:${u(0.32)};display:flex;justify-content:space-between"><span>Print at 100% (no scaling), centred on chest</span><span>اطبع بالمقاس الفعلي من غير تكبير أو تصغير</span></div>
</div>`;

module.exports = {
  title: 'الطباعة المباشرة على القماش · DTG',
  subtitle: 'تيشيرتات، هوديز، سويتشيرتات، شنط قماش وبادي بيبي',
  short: 'الطباعة DTG',
  products: ['tshirt', 'oversized', 'kidstee', 'onesie', 'hoodie', 'sweatshirt', 'tote'],

  filesIntro:
    'كل الملفات بتطلع من نفس تصميم العميل بالمقاس الفعلي للطباعة (١٠٠٪)، من غير أي تكبير أو تصغير مطلوب منكم. بنقدر نبعت أي صيغة من دول حسب اللي يناسب برنامج الـ RIP عندكم:',
  files: [
    { name: `ملف الطباعة ${L('PNG')}`, spec: `خلفية شفافة، ألوان ${L('RGB')} ومعاه بروفايل ${L('sRGB')}، بالمقاس الفعلي، ${L('300 DPI')} (المساحات الكبيرة ${L('250 DPI')} تقريبًا)`, use: 'الملف الأساسي لكل الشغل' },
    { name: `طبقة الأبيض ${L('PNG')}`, spec: `ملف منفصل بنفس المقاس: أبيض تحت كل مكان فيه طباعة، مسحوب لجوه ${L('2')} بيكسل (${L('0.17')} مم) عشان الأبيض مايبانش من الحواف`, use: 'القطع الغامقة والملونة، لو الـ RIP عندكم مابيعملهاش لوحده' },
    { name: `ملف ${L('PDF')}`, spec: `صفحة بالمقاس الفعلي لمساحة الطباعة، ألوان ${L('RGB')}`, use: 'لو بتفضّلوا PDF' },
    { name: `ملف ${L('TIFF CMYK')}`, spec: `${L('CMYK')} بخلفية بيضا (من غير شفافية)، ${L('LZW')}`, use: 'عند الطلب فقط، للقطع البيضا' },
  ],
  filesNotes: [
    `<b>مهم:</b> ملف الـ PNG ممكن يكون فيه حواف ناعمة أو ظلال نص شفافة (العميل بيرفع صور وبيستخدم مؤثرات). عايزين نعرف الـ RIP عندكم بيتعامل معاها إزاي (سؤال في قسم ٤).`,
    'الملف مش معكوس (الطباعة مباشرة على القماش). مقاس الطباعة واحد لكل مقاسات القطعة: التصميم مابيكبرش مع المقاس الأكبر.',
  ],

  productsIntro: 'القياسات على مقاس M للكبار.',
  productNotes: {
    tshirt: { material: 'قطن ممشط 100٪، قصة عادية', ask: `أكبر مساحة طباعة عندكم على التيشيرت؟ ومكان بداية الطباعة تحت الياقة بكام سم عادةً؟` },
    oversized: { material: 'قطن تقيل 100٪، أكتاف نازلة وقصة واسعة', ask: `مساحة ${area('oversized')} ممكنة على ماكينتكم؟ لو لأ، أقصى مساحة كام؟` },
    kidstee: { material: 'قطن 100٪ ناعم', ask: 'عندكم بلاتن (قاعدة) صغيرة لمقاسات الأطفال؟ أصغر مقاس تقدروا تطبعوا عليه؟' },
    onesie: { material: 'قطن 100٪ ناعم، بكبسون', ask: 'بتطبعوا على بادي البيبي (مقاسات 0–18 شهر)؟ عندكم بلاتن مناسب؟ والحبر آمن للأطفال (شهادة OEKO-TEX أو ما يعادلها)؟' },
    hoodie: { material: 'ميلتون متوسط الوزن، بجيب كنغر وكابيشون', ask: 'بتطبعوا DTG على الميلتون؟ نسبة القطن المطلوبة كام؟ والطباعة على الضهر والكابيشون موجود ممكنة؟' },
    sweatshirt: { material: 'ميلتون، رقبة دائرية وأساور ريب', ask: 'نفس سؤال الهودي: نسبة القطن المطلوبة، وهل النتيجة على الميلتون بنفس ثبات التيشيرت؟' },
    tote: { material: 'كانفاس قطن سميك، بدون مقاسات', ask: 'بتطبعوا DTG على الكانفاس؟ على الوجهين؟ ولا بتنصحوا بـ DTF للشنط؟' },
  },

  questions: [
    { q: 'نوع وموديل ماكينة الـ DTG وعددها، ونوع الأحبار', note: 'مثال: Epson F2100 / F3070، Brother GTX، Ricoh، أو غيرها.', lines: 2 },
    { q: 'برنامج الـ RIP اللي بتشتغلوا بيه', lines: 1 },
    { q: 'أكبر مساحة طباعة عندكم (عرض × ارتفاع بالسم)، والبلاتنات (القواعد) المتاحة', note: 'مثال: كبار، أطفال، كُم، شنطة.', lines: 2 },
    { q: `مساحاتنا القياسية ${area('tshirt')} للتيشيرت و ${area('oversized')} للأوفر سايز: الاتنين ممكنين؟`, opts: ['الاتنين', 'الأولى بس', 'أقصى مساحة عندنا: ..........'] },
    { q: 'مقاس الطباعة عندنا ثابت لكل مقاسات القطعة (S لحد 3XL). ده مناسب، ولا بتنصحوا بتكبير التصميم مع المقاسات الكبيرة؟', lines: 1 },
    { q: 'بتطبعوا أبيض على القطع الغامقة والملونة؟', opts: ['أيوه', 'فاتح بس'], note: 'لو أيوه: الألوان اللي بتتطبع عليها كويس (أسود، كحلي، أحمر، أخضر غامق، نبيتي، زيتي…) واللي مابتنصحوش بيها.', lines: 2 },
    { q: 'المعالجة قبل الطباعة (Pretreatment): يدوي ولا ماكينة؟ وبتسيب أثر أو مربع باين حوالين التصميم بعد الكبس؟ بيروح مع أول غسلة؟', lines: 2 },
    { q: 'طبقة الأبيض: تفضّلوا نبعت ملف الأبيض المنفصل بتاعنا، ولا الـ RIP عندكم بيعملها من شفافية الـ PNG؟', opts: ['ابعتوا ملف الأبيض', 'الـ RIP بيعملها', 'مش فارقة'] },
    { q: `صيغة الملف المفضّلة عندكم`, opts: ['PNG شفاف RGB', 'PDF', 'TIFF', 'صيغة تانية: ..........'] },
    { q: `الدقة: ملفاتنا ${L('300 DPI')} بالمقاس الفعلي (والمساحات الكبيرة ${L('250')}). كافية؟ وأقل دقة تقبلوها كام؟`, lines: 1 },
    { q: `الألوان: ملفاتنا ${L('sRGB')}. عندكم بروفايل ألوان معيّن تفضّلوا نشتغل عليه، أو ألوان بتطلع مختلفة عن الشاشة عادةً (أحمر فاقع، فسفوري، أزرق غامق)؟`, lines: 2 },
    { q: 'الحواف الناعمة والظلال النص شفافة والتدرّج لحد الشفاف: بتطلع إزاي على الغامق؟ تفضّلوا نحوّل الحواف لحادة قبل ما نبعت؟', lines: 2 },
    { q: 'أرفع خط وأصغر حجم كلام يطلعوا واضحين عندكم (بالمم / بالبونط)، وخصوصًا الأبيض على الغامق', lines: 1 },
    { q: 'مكان الطباعة: بتقيسوا إزاي (كام سم تحت الياقة)؟ ونسبة الخطأ المتوقعة في المكان والاستقامة (± كام مم)؟', lines: 2 },
    { q: 'إحنا بنسمح للعميل يحرّك التصميم (لفوق، لتحت، يمين، شمال) جوه حدود معيّنة وبنكتب لكم الإزاحة بالسم. ده عملي عندكم؟', opts: ['أيوه', 'أيوه بحدود: ..........', 'لأ، مكان ثابت بس'] },
    { q: 'الطباعة قرب أو فوق الخياطات، الجيوب، السوست والياقة: إيه المسافة الآمنة اللي لازم نسيبها؟', lines: 1 },
    { q: 'الخامات اللي بتطبعوا عليها DTG', opts: ['قطن 100٪', 'قطن/بوليستر (النسبة: ......)', 'ميلتون', 'كانفاس', 'بوليستر'], lines: 1 },
    { q: 'التثبيت بعد الطباعة: مكبس ولا فرن (Tunnel)؟ الحرارة والمدة؟', lines: 1 },
    { q: 'ثبات الطباعة: بتستحمل كام غسلة تقريبًا؟ وتعليمات الغسيل اللي تنصحوا نكتبها للعميل؟', lines: 2 },
    { q: 'طباعة الوجهين (أمام وخلف) في نفس القطعة: فيه أي قيود؟', lines: 1 },
    { q: 'عندكم DTF كمان كبديل لنفس القطع؟ وإمتى بتنصحوا بيه بدل الـ DTG؟', opts: ['أيوه', 'لأ'], lines: 2 },
    { q: 'بتعملوا تطريز أو عندكم جهة بتتعاملوا معاها؟ (بعض القطع عندنا بتتطلب بلوجو مطرّز)', opts: ['أيوه', 'لأ'] },
  ],

  confirm: [
    ['مساحة طباعة التيشيرت', `${area('tshirt')} (أمام وخلف)`],
    ['مساحة الأوفر سايز', `${area('oversized')}`],
    ['مساحة تيشيرت الأطفال', `${area('kidstee')}`],
    ['مساحة بادي البيبي', `${area('onesie')}`],
    ['الهودي (أمام فوق الجيب)', `${area('hoodie')}، والخلف ${area('hoodie', 'back')}`],
    ['شنطة القماش', `${area('tote')} على الوجهين`],
    ['هامش الأمان', `${L('6')} مم جوه حدود الطباعة (${L('4')} مم للبيبي)`],
    ['دقة الملف', `${L('300 DPI')} (${L('250')} للمساحات الكبيرة)`],
    ['الألوان', `${L('RGB · sRGB')}`],
    ['سحب الأبيض لجوه (Choke)', `${L('2')} بيكسل = ${L('0.17')} مم`],
    ['أقل مسافة من الياقة والخياطات', `${L('2.5')} سم من الياقة والديل، ${L('1')} سم من خياطات الجنب`],
  ],

  test: {
    wCm: 20, hCm: 25, white: true, html: TEST_HTML,
    text:
      `مع الملف ده مرفق ملف تجربة ${WH('20', '25')} (PNG شفاف ${L('300 DPI')}) ومعاه ملف طبقة الأبيض بتاعه. فيه ألوان أساسية، تدرّجات لحد الشفاف، خطوط رفيعة، كلام صغير عربي وإنجليزي، وأبيض على لون. ` +
      'ياريت يتطبع بالمقاس الفعلي على تيشيرت أبيض وتيشيرت أسود، وتبعتوا صورة للنتيجة في نور النهار ومعاها قياس الإطار بالمسطرة (المفروض العرض 20 سم والارتفاع 25 سم بالظبط).',
  },
};
