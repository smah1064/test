'use strict';
/* Supplier pack: stretched canvas prints. Facts about the files come from src/printfiles.js, src/app.js FORMATS,
 * public/js/admin.js FORMATS_BY_METHOD and public/js/common.js canvasEdges (what goes on the band round the front). */
const L = (s) => `<span dir="ltr">${s}</span>`;
const WH = (w, h) => `عرض ${L(w)} × ارتفاع ${L(h)} سم`;
// Print sizes are read from the product data, so the pack can't drift from the site.
const { PRODUCTS } = require('../../src/products');
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const P = (id) => PRODUCTS.find((p) => p.id === id);
// The editor's export (public/js/editor.js exportPrint): 300 DPI, less when the file would pass 16 million pixels or 8000 px a side.
const facts = (id, sizeId) => {
  const p = P(id);
  const s = p.sides[0];
  const z = p.sizes.find((x) => x.id === sizeId) || p.sizes[0];
  const k = z.printScale || 1; // src/products.js printWidthFor
  const wIn = s.printWidthIn * k;
  const hIn = (wIn * s.printArea.h) / s.printArea.w;
  const b = Number(s.bleedIn) || 0; // the band is the same on every size (public/js/editor.js rects)
  const W = wIn + 2 * b;
  const H = hIn + 2 * b;
  return { w: Math.round(wIn * 2.54), h: Math.round(hIn * 2.54), fileW: cm(W), fileH: cm(H), dpi: Math.floor(Math.min(300, Math.sqrt(16e6 / (W * H)), 8000 / Math.max(W, H))) };
};
const front = (id, sizeId) => { const f = facts(id, sizeId); return WH(f.w, f.h); };
const file = (id, sizeId) => { const f = facts(id, sizeId); return WH(f.fileW, f.fileH); };
const dpi = (id, sizeId) => L(`${facts(id, sizeId).dpi} DPI`);
const side0 = P('canvas').sides[0];
const BAND = cm(side0.bleedIn); // the wrap on each side
const DEPTH = cm(P('canvas').model.depthIn); // the stretcher bar's depth in the product data
const SAFE = Math.round(side0.safeIn * 25.4);
const sizeRows = (id) => P(id).sizes.map((z) => [`اللوحة ${front(id, z.id)}`, `الملف باللفّة ${file(id, z.id)} · ${dpi(id, z.id)}`]);
const sizesList = (id) => P(id).sizes.map((z) => front(id, z.id)).join(' · ');
const biggest = P('canvaswide').sizes[P('canvaswide').sizes.length - 1].id;
const note = (id) => ({
  material: 'قماش كانفاس مشدود على شاسيه خشب، جاهز للتعليق',
  hideSizes: true,
  rows: [
    ...sizeRows(id),
    ['اللفّة على الجوانب', `${L(BAND)} سم من كل ناحية، ثابتة في كل المقاسات (مكتوبة «زيادة القص» في الجدول)`],
  ],
});

module.exports = {
  title: 'لوحات الكانفاس المشدودة · Canvas',
  subtitle: 'طباعة على كانفاس وشدّ على شاسيه خشب، طولي وعرضي',
  short: 'الكانفاس',
  bleedLabel: 'اللفّة على الجوانب',
  areaLegend: 'وش اللوحة (من غير اللفّة)',
  products: ['canvas', 'canvaswide'],
  coloursLabel: 'شكل الجوانب (العميل بيختار)',

  filesIntro:
    `كل الملفات بتطلع من نفس تصميم العميل بالمقاس الفعلي (١٠٠٪). الملف فيه <b>واجهة اللوحة + لفّة ${L(BAND)} سم من كل ناحية</b> للجوانب والتنية ورا الشاسيه، واللفّة جاهزة جوه الملف بالشكل اللي العميل اختاره. بنقدر نبعت أي صيغة من دول:`,
  files: [
    { name: `ملف ${L('PDF')}`, spec: `صفحة بمقاس الواجهة + اللفّة، وحدود الواجهة متحددة جوه الملف (${L('TrimBox')})، ألوان ${L('RGB')}`, use: 'الملف الأساسي' },
    { name: `ملف ${L('TIFF CMYK')}`, spec: `${L('CMYK')} بخلفية بيضا (من غير شفافية)، ${L('LZW')}، بمقاس الواجهة + اللفّة`, use: 'لو الـ RIP عندكم بيفضّل TIFF' },
    { name: `ملف ${L('PNG')}`, spec: `ألوان ${L('RGB')} ومعاه بروفايل ${L('sRGB')}، بمقاس الواجهة + اللفّة. الأماكن اللي مفيهاش تصميم شفافة`, use: 'عند الطلب' },
    { name: `${L('PDF')} بعلامات`, spec: `نفس الـ PDF وحواليه هامش فيه علامات عند أركان الواجهة (مكان التنية على حرف الشاسيه)، وسطر فيه بيانات الشغلانة`, use: 'لو بتحتاجوا علامات لظبط الشدّ' },
  ],
  filesNotes: [
    `<b>شكل الجوانب ${L('4')} اختيارات</b>، والملف بيوصلكم جاهز بيها: <b>لفّ الصورة</b> (التصميم نفسه مكمّل على الجوانب، يعني أطراف الصورة بتروح على الجنب)، <b>جوانب معكوسة</b> (الواجهة كاملة والجوانب انعكاس لأطرافها)، <b>جوانب بيضا</b>، أو <b>جوانب سودا</b>.`,
    `<b>الدقة:</b> بتقل مع المقاس عشان حجم الملف: ${P('canvas').sizes.map((z) => `${front('canvas', z.id)} بدقة ${dpi('canvas', z.id)}`).join('، ')}. والعرضي نفس الأرقام.`,
    `الملف مش معكوس. الكلام والعناصر المهمة بنخلّيها جوه الواجهة بـ ${L(SAFE)} مم على الأقل عشان ماتقربش من حرف الشاسيه.`,
  ],

  productsIntro: 'الرسم على أصغر مقاس، وباقي المقاسات مكتوبة جنب كل منتج (مقاس الواجهة، ومقاس الملف باللفّة).',
  productNotes: {
    canvas: { ...note('canvas'), ask: `المقاسات دي متاحة عندكم كشاسيهات جاهزة، ولا بتتعمل بالطلب؟ وسُمك الشاسيه الفعلي عندكم كام سم؟` },
    canvaswide: { ...note('canvaswide'), ask: `المقاس ${front('canvaswide', biggest)}: بتحطّوا عارضة تقوية في نص الشاسيه؟ ومن أنهي مقاس بتبدأوا تحطّوها؟` },
  },

  priceRows: P('canvas').sizes.map((z) => { const f = facts('canvas', z.id); return `لوحة ${f.w} × ${f.h} سم (طباعة + شدّ)`; }).concat(['طباعة كانفاس بس، بالمتر المربع', 'ورنيش / لامينيشن (لو بيتحسب لوحده)']),

  questions: [
    { q: 'نوع وموديل الطابعة وعددها، ونوع الأحبار', opts: ['Latex', 'Eco-solvent', 'Pigment (مائي)', 'UV'], lines: 2 },
    { q: 'أكبر عرض طباعة عندكم على الكانفاس (بالسم)', note: `أكبر ملف عندنا باللفّة: ${file('canvaswide', biggest)}.`, lines: 1 },
    { q: 'خامة الكانفاس: قطن، بوليستر ولا مخلوط؟ الوزن بالجرام؟ مط ولا لامع؟', note: 'ولو عندكم أكتر من خامة: إيه الفرق في الشكل والسعر، وأنهي واحدة بتنصحوا بيها للصور الشخصية؟', lines: 2 },
    { q: 'الشاسيه: نوع الخشب، وسُمكه (العمق) وعرض الضلع بالسم', opts: ['2 سم', '3 سم', '4 سم', 'سُمك تاني: ..........'], note: `ملفاتنا متجهّزة على شاسيه عمقه ${L(DEPTH)} سم تقريبًا. والخشب معالَج ضد الالتواء والرطوبة؟`, lines: 2 },
    { q: `اللفّة: ملفنا فيه ${L(BAND)} سم من كل ناحية (عمق الشاسيه + التنية ورا). كافية للشدّ والتدبيس عندكم؟ ولو لأ، محتاجين كام سم؟`, lines: 1 },
    { q: 'بتحتاجوا كانفاس أبيض زيادة برّه حدود ملفنا عشان الشدّ بالزرادية؟', opts: ['لأ', 'أيوه: ........ سم من كل ناحية'], note: 'ولو أيوه: بتزوّدوها أنتم وقت الطباعة ولا نزوّدها إحنا في الملف؟' },
    { q: 'شكل الجوانب: الأربع اختيارات اللي عندنا كلها تمام عندكم؟', opts: ['لفّ الصورة', 'جوانب معكوسة', 'أبيض', 'أسود'], note: 'وهل الجوانب البيضا بتتساب من غير حبر، ولا بتحتاج معاملة معيّنة؟', lines: 1 },
    { q: 'دقة مكان التنية: نسبة الخطأ بين حرف الشاسيه وحدود الواجهة في الملف (± كام مم)؟', note: `هامش الأمان عندنا ${L(SAFE)} مم جوه الواجهة. كافي؟`, lines: 1 },
    { q: 'الأركان: بتتقفل إزاي؟', opts: ['تنية مستخبية (Gallery corner)', 'قصّ وتطبيق', 'طريقة تانية'], note: 'والتدبيس من ورا بس ولا على الجنب؟', lines: 1 },
    { q: 'الحماية بعد الطباعة', opts: ['ورنيش مط', 'ورنيش لامع', 'لامينيشن', 'من غير'], note: 'الطباعة بتستحمل المسح بقماشة مبلولة؟ وبتتشقق عند التنية مع الألوان الغامقة؟', lines: 2 },
    { q: 'ثبات الألوان: الطباعة بتعيش قد إيه من غير بهتان في نور الأوضة العادي؟', lines: 1 },
    { q: 'التعليق: بتركّبوا إيه في ضهر اللوحة؟', opts: ['علّاقة معدن مسنّنة', 'سلك', 'من غير'], note: 'وبتقفلوا الضهر بورق أو شريط؟', lines: 1 },
    { q: 'أكبر مقاس لوحة مشدودة تقدروا تعملوه، ومن أنهي مقاس بتحطّوا عارضة تقوية في النص؟', lines: 1 },
    { q: 'مقاسات تانية ممكنة غير اللي عندنا (مربع، بانوراما، مقاس بالطلب)؟ وإيه المقاسات الجاهزة عندكم دايمًا؟', lines: 2 },
    { q: 'صيغة الملف المفضّلة عندكم', opts: ['PDF', 'TIFF CMYK', 'PNG', 'صيغة تانية: ..........'] },
    { q: `الدقة: ملفاتنا من ${dpi('canvas', P('canvas').sizes[P('canvas').sizes.length - 1].id)} للمقاس الكبير لحد ${dpi('canvas')} للصغير. كافية للكانفاس؟ وأقل دقة تقبلوها كام؟`, lines: 1 },
    { q: `الألوان: ملفاتنا ${L('sRGB')}. عندكم بروفايل ${L('ICC')} للكانفاس بتاعكم؟ وفيه ألوان بتطلع مختلفة عن الشاشة عادةً (أسود غامق، ألوان البشرة، أزرق)؟`, lines: 2 },
    { q: 'التغليف: إزاي بتحموا الأركان ووش اللوحة في الشحن؟', opts: ['حماية أركان كرتون', 'بابلز', 'كرتونة لكل لوحة'], note: 'وأقصى مقاس يتشحن مع شركات الشحن العادية من غير مشاكل؟', lines: 2 },
    { q: 'لو الخشب التوى أو الكانفاس ارتخى بعد التسليم: بتعيدوا الشدّ؟ وفيه ضمان؟', lines: 1 },
  ],

  confirm: [
    ['مقاسات اللوحة الطولية', sizesList('canvas')],
    ['مقاسات اللوحة العرضية', sizesList('canvaswide')],
    ['اللفّة على الجوانب', `${L(BAND)} سم من كل ناحية، ثابتة في كل المقاسات`],
    ['عمق الشاسيه', `${L(DEPTH)} سم تقريبًا (والباقي من اللفّة تنية ورا الشاسيه)`],
    ['مقاس الملف باللفّة (طولي)', P('canvas').sizes.map((z) => file('canvas', z.id)).join(' · ')],
    ['مقاس الملف باللفّة (عرضي)', P('canvaswide').sizes.map((z) => file('canvaswide', z.id)).join(' · ')],
    ['شكل الجوانب', 'لفّ الصورة، جوانب معكوسة، أبيض، أو أسود: جاهزة جوه الملف'],
    ['هامش الأمان', `${L(SAFE)} مم جوه حدود الواجهة`],
    ['دقة الملف', P('canvas').sizes.map((z) => dpi('canvas', z.id)).join(' · ') + ' (من الأصغر للأكبر)'],
    ['كانفاس زيادة للشدّ برّه الملف', '<b>مفيش</b>: الملف بيخلص عند آخر اللفّة'],
    ['الألوان', `${L('RGB · sRGB')}`],
  ],
};
