'use strict';
/*
 * Supplier pack: UV printing. Flatbed on rigid pieces (acrylic, wood, PVC cards, phone cases, bottles), large format
 * (roll-up, banners, window stickers) and UV DTF transfers and cup wraps. Facts about the files come from
 * src/printfiles.js (printPdf, cmykTiff), src/app.js (FORMATS), src/fan-files.js (the fan files of a tapered cup),
 * public/js/drinkware-geom.js and public/js/admin.js (FORMATS_BY_METHOD).
 */
const L = (s) => `<span dir="ltr">${s}</span>`;
const WH = (w, h) => `عرض ${L(w)} × ارتفاع ${L(h)} سم`;
// Every size is read from the product data, so the pack can't drift from what is sold.
const { PRODUCTS, printWidthFor, printHeightFor } = require('../../src/products');
const P = (id) => PRODUCTS.find((p) => p.id === id);
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const mm = (inches) => String(Math.round((Number(inches) || 0) * 25.4 * 10) / 10);
const r1 = (n) => String(Math.round(n * 10) / 10);
const names = (list) => list.map((p) => p.name.ar).join('، ');

// The editor's export (public/js/editor.js exportPrint): 300 DPI, less when the file would pass the canvas limits.
const dpiOf = (wIn, hIn, b) => Math.floor(Math.min(300, Math.sqrt(16e6 / ((wIn + 2 * b) * (hIn + 2 * b))), 8000 / Math.max(wIn + 2 * b, hIn + 2 * b)));
/** One side's print size for one size option. */
function facts(p, side, size) {
  const wIn = printWidthFor(p, side, size.id);
  const hIn = printHeightFor(p, side, size.id);
  return { wIn, hIn, w: cm(wIn), h: cm(hIn), dpi: dpiOf(wIn, hIn, Number(side.bleedIn) || 0) };
}
/** The different print sizes a product has (sizes that are only quantities share one), smallest first. */
function groups(p) {
  const side = p.sides[0];
  const out = [];
  for (const size of p.sizes) {
    const f = facts(p, side, size);
    if (out.some((g) => g.w === f.w && g.h === f.h)) continue;
    const a = [size.family, size.id].find((v) => /^A\d$/.test(v || ''));
    out.push({ ...f, size, label: a || (p.id === 'phonecase' ? size.label.en : '') });
  }
  return out.sort((x, y) => x.wIn - y.wIn);
}
const fact = (id, sizeId) => { const p = P(id); return facts(p, p.sides[0], p.sizes.find((z) => !sizeId || z.id === sizeId)); };
const size = (id, sizeId) => { const f = fact(id, sizeId); return WH(f.w, f.h); };
const dpi = (id, sizeId) => L(`${fact(id, sizeId).dpi} DPI`);

/**
 * What the product block shows: a size that changes the print gets its own line where there is room (one side, two
 * sizes); otherwise the block shows the one size named in the side's title and a row lists the others (sizeRow).
 */
function sidesOf(p) {
  if (p.blank) return p.sides.map((s) => ({ ...s, name: { ...s.name, ar: 'مكان الستيكر على الكوباية' } }));
  const g = groups(p);
  if (g.length < 2) return p.sides;
  const shaped = (s, f, tag) => ({ ...s, name: { ...s.name, ar: `${s.name.ar} · ${tag}` }, printWidthIn: f.wIn, printArea: { ...s.printArea, h: (s.printArea.w * f.hIn) / f.wIn } });
  const tag = (f) => f.label || (f === g[0] ? 'المقاس الصغير' : f === g[g.length - 1] ? 'المقاس الكبير' : 'مقاس وسط');
  if (p.sides.length === 1 && g.length === 2) return g.map((f) => shaped(p.sides[0], f, tag(f)));
  const base = g.find((f) => !f.size.printScale) || g[0];
  return p.sides.map((s) => shaped(s, base, tag(base)));
}
function sizeRow(p) {
  const g = groups(p);
  if (g.length < 2 || (p.sides.length === 1 && g.length === 2)) return [];
  return [['مقاس الطباعة لكل مقاس', g.map((f) => `${f.label ? `${L(f.label)}: ` : ''}${WH(f.w, f.h)} · ${L(`${f.dpi} DPI`)}`).join('<br>')]];
}
const option = (id, optId) => P(id).options.find((o) => o.id === optId).choices.map((c) => c.name.ar).join(' / ');
/** A round piece from its 3D model: diameter and height in cm (plain text: `material` is escaped by the renderer). */
const body = (id) => `قطر حوالي ${cm(P(id).model.diameterIn)} سم وطول حوالي ${cm(P(id).model.heightIn)} سم`;
/** The gap left at the seam of a straight wrap: the glass's circumference less the wrap's width (mm). */
const seamGap = (id) => r1(Math.PI * P(id).model.diameterIn * 25.4 - P(id).sides[0].printWidthIn * 25.4);
const wrapRows = (id) => [['الكوباية', `${P(P(id).pair).name.ar}: ${body(id)}`], ['الفتحة عند اللحام', `الستيكر أقصر من محيط الكوباية بحوالي ${L(seamGap(id))} مم`], ['اللزق (اختياري)', option(id, 'apply')]];
// The tapered cup's fan (public/js/drinkware-geom.js fanOf; src/fan-files.js dims).
const FAN = P('uvwraptaper').sides[0].fan;
const fanBox = { w: 2 * FAN.Ro * Math.sin(FAN.theta / 2), h: FAN.Ro - FAN.Ri * Math.cos(FAN.theta / 2) };
const fanText = `نص القطر الخارجي ${L(r1(FAN.Ro))} مم، الداخلي ${L(r1(FAN.Ri))} مم، زاوية الفتح ${L(`${r1((FAN.theta * 180) / Math.PI)}°`)}؛ القوس الطويل ${L(r1(FAN.phi * FAN.r1))} مم، القصير ${L(r1(FAN.phi * FAN.r2))} مم، وعرض الشريط (المايل) ${L(r1(FAN.s))} مم`;

const QTY = 'الكميات';
const BLANK_ASK = 'بتوفّروا الكوباية دي بنفس المقاس؟ ابعتوا لنا مقاساتها بالظبط (القطر من فوق ومن تحت والطول) عشان نظبط مقاس الستيكر عليها.';
const NOTES = {
  // Flatbed on acrylic, glass and wood
  plaque: { material: 'أكريليك شفاف كريستال: عادي 5 مم أو بلوك تخين 15 مم', hideSizes: true, rows: [['التُخن', option('plaque', 'thickness')], ['التعليق', 'المقاس الكبير بمسامير ديكور للحيطة؛ الصغيرة بتقف على المكتب']], ask: 'بتطبعوا من ورا الأكريليك (معكوس + أبيض وراه) ولا على الوش؟ البلوك 15 مم بيعدّي تحت الهيد؟ والقص والتلميع ومسامير الديكور عندكم؟' },
  acrylicnameplate: { material: 'بلوك أكريليك شفاف تخين بيقف لوحده على المكتب', hideSizes: true, rows: [['الضهر', option('acrylicnameplate', 'backing')]], ask: 'تُخن البلوك المتاح عندكم كام مم؟ والحواف بتتلمّع؟' },
  shield: { material: 'درع أكريليك شفاف تخين واقف على قاعدته', hideSizes: true, rows: [['الضهر', option('shield', 'backing')], ['العلبة', option('shield', 'box')]], ask: 'شكل الدرع والقاعدة: عندكم أشكال جاهزة ولا بتقصّوا ليزر على رسمتنا؟ تُخن الأكريليك كام؟ وعلب القطيفة منكم؟' },
  glassaward: { material: 'درع كريستال تقيل على قاعدة سودا، مطبوع بالألوان', hideSizes: true, ask: 'بتوفّروا دروع الكريستال الفاضية بالأطوال دي؟ الطباعة UV على الكريستال بتثبت (برايمر)؟ ولا بتنصحوا بحفر ليزر جوه الكريستال؟' },
  qrstand: { material: 'ستاند أكريليك شفاف A6 بيقف لوحده على الترابيزة', sizesLabel: QTY, ask: 'الستاند: قطعة مثنية (حرف L) ولا لوح بقاعدة؟ التُخن كام؟ والطباعة بأبيض ورا الألوان عشان تتقري؟' },
  favourtags: { material: 'تاج أكريليك دايرة قطرها 5 سم، مخروم للشريطة: شفاف أو أبيض', sizesLabel: QTY, ask: 'القص والخرم ليزر عندكم؟ مكان وقطر الخرم كام عشان نبعد التصميم عنه؟ وبتطبعوا الأول وبعدين تقصّوا ولا العكس؟' },
  keychain: { material: 'ميدالية أكريليك لامعة بحلقة معدن، بحواف مدورة', sizesLabel: QTY, ask: 'شكل الميدالية ثابت (مستطيل بحواف مدورة) ولا بتقصّوا على حدود التصميم؟ الطباعة وش واحد ولا بتبان من الناحيتين؟ والحلقات منكم؟' },
  quranbox: { material: 'صندوق خشب للمصحف، الطباعة على الغطا: زان طبيعي، جوزي أو أبيض', hideSizes: true, ask: 'بتوفّروا الصندوق نفسه بالمقاسين؟ الطباعة على الخشب الغامق محتاجة أبيض تحتها؟ والصندوق بيعدّي تحت الهيد وهو متجمّع؟' },
  sign: { material: 'لوحة فوم بورد مقوّاة ومعاها حامل', hideSizes: true, ask: 'طباعة مباشرة على الفوم ولا فينيل ملزوق عليه؟ تُخن الفوم كام مم؟ والحامل (ستاند) منكم؟' },
  // Flatbed on ready-made pieces
  phonecase: { material: 'جراب بولي كربونات لامع، الطباعة على الضهر كله', hideSizes: true, ask: 'الجرابات الفاضية منكم؟ أنهي موديلات متاحة عندكم؟ عندكم جيج (Jig) لكل موديل؟ والطباعة بتوصل للحواف المنحنية وحوالين فتحة الكاميرا؟' },
  idcards: { material: 'كارنيه PVC لامع بحواف مدورة، وجه أو وجهين، ومعاه شريط تعليق', sizesLabel: QTY, rows: [['الأسماء', `اسم وصورة مختلفة على كل كارنيه من قائمة العميل (لحد ${L(P('idcards').merge.maxRows)}): صفحة لكل كارنيه`]], ask: 'بتطبعوا الكارنيهات بأنهي طريقة (طابعة كروت حرارية، UV على كروت جاهزة، ولا طباعة وتكبيس)؟ مقاس الكارت عندكم بالظبط؟ والخرم والشريط والجراب منكم؟' },
  bottle: { material: `زمزمية ستانلس ستيل معزولة 750 مل، ${body('bottle')}`, hideSizes: true, ask: 'عندكم ملحق دوّار (Rotary) للطباعة على الأسطوانات؟ أكبر عرض طباعة حوالين الزمزمية كام؟ ولا بتنصحوا بـ UV DTF؟' },
  tumbler: { material: `تمبلر ستانلس ستيل بجدارين وغطا 590 مل، ${body('tumbler')}`, hideSizes: true, ask: 'نفس سؤال الزمزمية. ولو التمبلر عندكم مسحوب (بيضيق من تحت) ابعتوا مقاساته عشان نجهّز الملف على شكله.' },
  paperbags: { material: 'شنطة ورق 25 × 32 سم بيد مبرومة، الطباعة على الوش', sizesLabel: QTY, ask: 'بتطبعوا على شنط جاهزة (بأنهي طريقة؟) ولا الشنطة بتتطبع فرخ وتتجمّع؟ والطباعة على الشنطة السودا والكرافت محتاجة أبيض؟' },
  // Large format
  rollup: { material: 'بانر رول أب على ستاند ألومنيوم مع شنطة', hideSizes: true, ask: 'خامة الرول أب عندكم (PVC / PP / Blockout)؟ كام سم من تحت بيدخلوا جوه القاعدة ومابيبانوش؟ والستاند والشنطة منكم؟' },
  banners: { material: 'بانر فليكس بحواف مخيطة وحلقات معدن: فليكس لامع، مطفي أو ميش', hideSizes: true, ask: 'الحلقات كل كام سم؟ الكَفّة (التني) كام سم ومحتاجة زيادة في الملف؟ والميش متاح عندكم؟' },
  windowstickers: { material: 'ستيكر فينيل ضد المياه للإزاز: أبيض، شفاف يتلزق من بره، أو شفاف يتلزق من جوه (بيتطبع معكوس)', hideSizes: true, ask: 'الفينيل الشفاف: بتطبعوا أبيض تحت الألوان (ومن جوه: ألوان وبعدها أبيض)؟ ملفنا مش معكوس: بتعكسوه أنتم؟ والقص على شكل التصميم ولا مربع؟' },
  // UV DTF
  uvdtf: { material: 'شيت ستيكرز UV DTF من غير خلفية (فيلم A و B)، بيتقشّر ويتلزق على الأسطح الناشفة', hideSizes: true, ask: 'بتقصّوا الشيت لقطع ولا بيتسلّم شيت كامل؟ أقل مسافة بين التصميمات؟ وأرفع خط وأصغر كلام بيثبتوا على الفيلم؟' },
  uvwrap16: { material: 'ستيكر لف UV DTF على فيلم شفاف من غير خلفية، مقصوص على مقاس الكوباية', hideSizes: true, rows: wrapRows('uvwrap16') },
  uvwrap20: { material: 'ستيكر لف UV DTF على فيلم شفاف من غير خلفية، مقصوص على مقاس الكوباية', hideSizes: true, rows: wrapRows('uvwrap20') },
  uvwraptumbler: { material: 'ستيكر لف UV DTF على فيلم شفاف من غير خلفية، مقصوص على مقاس التمبلر', hideSizes: true, rows: wrapRows('uvwraptumbler') },
  uvwraptaper: {
    material: 'ستيكر لف UV DTF لكوباية مسحوبة (بتضيق من تحت): بيتطبع ويتقص على شكل قوس (مروحة) عشان يلف مستوي',
    hideSizes: true,
    rows: [
      ['الكوباية', `${P('glasstaper').name.ar}: نص قطرها عند أول الشريط ${L(FAN.r1)} مم وعند آخره ${L(FAN.r2)} مم`],
      ['المقاس في الجدول', 'ده الشريط وهو مفرود مستطيل (زي ما العميل بيصمم عليه). اللي بيتطبع هو ملف المروحة'],
      ['المروحة', `${fanText}. مساحتها ${WH(r1(fanBox.w / 10), r1(fanBox.h / 10))}`],
      ['الفتحة عند اللحام', `${L(FAN.gapMm)} مم`],
      ['اللزق (اختياري)', option('uvwraptaper', 'apply')],
    ],
    ask: 'بتقبلوا ملف المروحة بتاعنا (PDF بالمقاس الحقيقي وعليه خط القص) وتقصّوا عليه؟ ولا عندكم قالب للكوبايات المسحوبة وعايزين نشتغل عليه؟',
  },
  // The plain glasses the wraps go on
  glasscan16: { noFile: true, material: `كوباية إزاز شفافة شكل الكانز 16 أونصة بغطا بامبو وشفاطة إزاز، ${body('glasscan16')}. بتتباع سادة أو الستيكر ملزوق عليها`, hideSizes: true, ask: BLANK_ASK },
  glasscan20: { noFile: true, material: `كوباية إزاز شفافة شكل الكانز 20 أونصة بغطا بامبو وشفاطة إزاز، ${body('glasscan20')}. بتتباع سادة أو الستيكر ملزوق عليها`, hideSizes: true },
  glasstumbler20: { noFile: true, material: `تمبلر إزاز شفاف مستقيم 20 أونصة بغطا وشفاطة، ${body('glasstumbler20')}. بيتباع سادة أو الستيكر ملزوق عليه`, hideSizes: true },
  glasstaper: { noFile: true, material: `كوباية إزاز شفافة مسحوبة 12 أونصة، ${body('glasstaper')}. بتتباع سادة أو الستيكر ملزوق عليها`, hideSizes: true, ask: 'الكوبايات المسحوبة بتختلف من مورد لمورد: ابعتوا القطر من فوق ومن تحت والطول للكوباية المتاحة عندكم.' },
};
const ORDER = [
  'plaque', 'acrylicnameplate', 'shield', 'glassaward', 'qrstand', 'favourtags', 'keychain', 'quranbox', 'sign',
  'phonecase', 'idcards', 'bottle', 'tumbler', 'paperbags',
  'rollup', 'banners', 'windowstickers',
  'uvdtf', 'uvwrap16', 'uvwrap20', 'uvwraptumbler', 'uvwraptaper',
  'glasscan16', 'glasscan20', 'glasstumbler20', 'glasstaper',
];
const productNotes = {};
for (const id of ORDER) productNotes[id] = { ...NOTES[id], rows: [...sizeRow(P(id)), ...((NOTES[id] || {}).rows || [])] };

const printed = ORDER.map(P).filter((p) => !p.blank);
const noBleed = printed.filter((p) => !Number(p.sides[0].bleedIn) && !/^uv(dtf|wrap)/.test(p.id));
const someBleed = printed.filter((p) => Number(p.sides[0].bleedIn));
const bannerDpi = groups(P('banners')).map((f) => `${WH(f.w, f.h)}: ${L(`${f.dpi} DPI`)}`).join('، ');

module.exports = {
  title: 'طباعة UV · فلات بِد، مقاسات كبيرة و UV DTF',
  subtitle: 'أكريليك ودروع، كارنيهات PVC، جرابات موبايل، زمزميات، لوحات، رول أب وبانرات، ستيكرات إزاز، وستيكرات لف UV DTF للكوبايات',
  short: 'طباعة UV',
  compact: true,
  products: ORDER,
  sidesOf,
  coloursLabel: 'اللون / الخامة',

  filesIntro:
    'كل الملفات بتطلع من تصميم العميل بالمقاس الفعلي للطباعة (١٠٠٪)، من غير أي تكبير أو تصغير مطلوب منكم، وكل وش ملف لوحده. بنقدر نبعت أي صيغة من دول:',
  files: [
    { name: `${L('PDF')} جاهز للطباعة`, spec: `صفحة بمقاس القطعة بالظبط (+ زيادة القص لو المنتج ليه)، ${L('TrimBox')} مظبوط، الألوان ${L('RGB')}، والتصميم جوّاه بخلفية شفافة`, use: 'الملف الأساسي لكل شغل الـ UV' },
    { name: `${L('PNG')} شفاف`, spec: `خلفية شفافة، ${L('RGB')} ببروفايل ${L('sRGB')}، بالمقاس الفعلي، ${L('300 DPI')} (أقل في المقاسات الكبيرة، مكتوبة عند كل منتج)`, use: 'لو الـ RIP عندكم بيطلّع الأبيض من الشفافية' },
    { name: `${L('PDF')} بعلامات القص`, spec: `نفس الـ PDF + هامش ${L('0.4')} بوصة (حوالي ${L('1')} سم) فيه علامات قص طولها ${L('6.4')} مم وسطر ببيانات الشغلانة`, use: 'الستيكرات والحاجات اللي بتتقص بعد الطباعة' },
    { name: `${L('TIFF CMYK')}`, spec: `${L('CMYK')} بخلفية بيضا (من غير شفافية)، ${L('LZW')}، ببروفايل ${L('CMYK')} عام مدمج في الملف`, use: 'عند الطلب فقط' },
    { name: 'ملف المروحة (الكوباية المسحوبة)', spec: `التصميم متني على شكل القوس: ${L('PDF')} بالمقاس الحقيقي وعليه خط حدود المروحة (خط رفيع فوشيا)، علامات النص واللحام، كلمة ${L('TOP')} ناحية بُق الكوباية ومسطرة ${L('100')} مم للتأكد من المقاس؛ أو ${L('PNG')} شفاف؛ أو ${L('PNG')} معكوس`, use: 'ستيكر اللف للكوباية المسحوبة بدل الملف المستطيل' },
    { name: 'قوائم الأسماء', spec: `الكارنيهات: ${L('PDF')} واحد فيه صفحة لكل اسم، أو ${L('ZIP')} فيه ${L('PDF')} لكل اسم، ومعاهم القائمة ${L('CSV')}`, use: 'كارنيهات الموظفين' },
  ],
  filesNotes: [
    `<b>مهم:</b> ملفاتنا ألوان بس (${L('RGB')}) بخلفية شفافة: مفيهاش قناة منفصلة للحبر الأبيض ولا للورنيش (Gloss) ولا خط قص. عايزين نعرف بتطلّعوا الأبيض من الشفافية في الـ RIP، ولا محتاجينه مننا كلون Spot باسم معيّن (أسئلة قسم ٤).`,
    'الملفات مش معكوسة. أي حاجة بتتطبع من ورا (أكريليك من الضهر، ستيكر بيتلزق من جوه الإزاز) محتاجة تتعكس: قولوا لنا تعكسوها أنتم ولا نبعتها معكوسة.',
    'التصميم جوه الملف صورة واحدة (Raster) مش Vector. ممكن يكون فيه حواف ناعمة وظلال نص شفافة لأن العميل بيرفع صور وبيستخدم مؤثرات.',
    'الكوبايات الإزاز السادة ملهاش ملفات طباعة: بتتباع لوحدها، أو بنطلب لزق ستيكر اللف عليها.',
  ],

  productsIntro: 'المنتجات اللي ليها أكتر من مقاس: كل مقاس مكتوب في سطر أو في «مقاس الطباعة لكل مقاس». «هامش الأمان» هو المسافة اللي بنبعد بيها الكلام عن الحرف.',
  productNotes,

  priceRows: ['طباعة UV على أكريليك (بالسم² أو بالقطعة)', 'كارنيه PVC وجهين', 'جراب موبايل مطبوع (بالجراب)', 'رول أب 85 × 200 بالستاند', 'بانر فليكس (بالمتر المربع)', 'شيت UV DTF مقاس A3', 'ستيكر لف UV DTF لكوباية 16 أونصة'],

  questions: [
    { q: 'نوع وموديل ماكينات الـ UV عندكم (فلات بِد / رول / هايبرد) ونوع الأحبار وعدد الألوان', note: 'مثال: Mimaki UJF / JFX، Roland، Epson، ماكينات صيني بهيدات Epson أو Ricoh… وبرنامج الـ RIP.', lines: 2 },
    { q: 'الفلات بِد: أكبر مساحة طباعة (عرض × طول بالسم) وأقصى ارتفاع للقطعة تحت الهيد (بالسم)', note: `عندنا قطع لحد ${size('plaque', '40x60')} وبلوك أكريليك 15 مم وصندوق خشب.`, lines: 1 },
    { q: 'الحبر الأبيض والورنيش', opts: ['أبيض', 'ورنيش لامع (Gloss)', 'طباعة بارزة (Emboss)', 'مفيش'], note: 'وترتيب الطبقات المتاح: ألوان فوق أبيض، أبيض فوق ألوان (للطباعة من ورا)، ألوان + أبيض + ألوان.', lines: 1 },
    { q: 'الأبيض والورنيش في الملف: عايزينهم إزاي؟', opts: ['الـ RIP بيطلّع الأبيض من الشفافية', 'لون Spot في PDF باسم: ..........', 'ملف منفصل أبيض وأسود'], note: 'لو Spot: الاسم بالظبط للأبيض وللورنيش (مثال: White / Varnish / RDG_WHITE) وهل لازم يكون Vector.', lines: 2 },
    { q: 'الخامات اللي بتطبعوا عليها والثبات', table: { cols: ['الخامة', 'بتطبعوا عليها؟', 'برايمر / معالجة قبل الطباعة', 'الثبات (خدش / مياه / شمس)'], rows: ['أكريليك', 'إزاز / كريستال', 'معدن (ستانلس مدهون)', 'خشب', 'PVC كروت', 'بولي كربونات (جرابات)', 'فوم بورد', 'ورق شنط / كرافت'] } },
    { q: 'الأكريليك: التُخانات المتاحة عندكم (مم)، والقص', opts: ['بنقص ليزر عندنا', 'بنقص CNC', 'القص بره', 'بنطبع على قطع جاهزة بس'], note: 'بتطبعوا على الوش ولا من ورا (معكوس + أبيض)؟ ومحتاجين مننا ملف قص Vector للأشكال (دروع، ميداليات، تاجات)؟', lines: 2 },
    { q: 'القطع الأسطوانية (زمزمية وتمبلر ستانلس): عندكم ملحق دوّار (Rotary)؟', opts: ['أيوه، لف كامل 360°', 'أيوه، جزء من المحيط', 'لأ، بنطبع شريط مستوي ضيق بس', 'لأ'], note: `مساحتنا القياسية على الزمزمية ${size('bottle')}. أقصى عرض وارتفاع عندكم؟ والقطع المسحوبة ممكنة؟`, lines: 2 },
    { q: 'جرابات الموبايل والقطع الصغيرة (ميداليات، كارنيهات، تاجات): عندكم جيجات (Jigs) بتتظبط عليها القطع؟', note: 'اكتبوا موديلات الموبايلات اللي عندكم جيج ليها، ونسبة الخطأ في مكان الطباعة (± كام مم)، وهل محتاجين زيادة قص حوالين القطعة.', lines: 3 },
    { q: 'كارنيهات الـ PVC: طريقة الطباعة عندكم', opts: ['UV فلات بِد على كروت جاهزة', 'طابعة كروت حرارية', 'طباعة شيت وتكبيس وقص'], note: 'مقاس الكارت عندكم ونص قطر الدوران، والطباعة لحد الحرف ممكنة؟ وكل كارنيه باسم وصورة مختلفة: فيه زيادة في السعر؟', lines: 2 },
    { q: `الرول أب ${size('rollup')}: الخامة، والجزء اللي بيدخل في القاعدة من تحت (سم)، ونوع الستاند`, opts: ['ستاند عادي', 'ستاند عريض / تقيل', 'الستاند من عندنا مش متاح'], note: `ملفنا بمقاس البانر بالظبط من غير زيادة، ودقته ${dpi('rollup')} (المقاس كبير). كافية للماكينة عندكم؟`, lines: 2 },
    { q: 'البانر الفليكس: الخامات المتاحة وعرض الرول، والتشطيب', opts: ['كَفّة ملحومة', 'كَفّة مخيطة', 'حلقات معدن', 'جيب للماسورة', 'قص بس'], note: 'المسافة بين الحلقات، وكام سم زيادة محتاجين في الملف للكَفّة من كل ناحية (ملفنا دلوقتي من غير زيادة).', lines: 2 },
    { q: 'ستيكرات الإزاز والفاترينات: أنواع الفينيل المتاحة', opts: ['فينيل أبيض', 'فينيل شفاف', 'مُفرّغ (One way vision)', 'سلوفان حماية'], note: 'الشفاف اللي بيتلزق من جوه: بتطبعوه معكوس وبعده أبيض؟ القص على شكل التصميم (Contour) ممكن؟ وبتسلّموه بورق نقل (Transfer tape)؟', lines: 2 },
    { q: 'الـ UV DTF: عندكم ماكينة UV DTF (فيلم A + فيلم B)؟', opts: ['أيوه، رول بعرض: ...... سم', 'أيوه، شيتات مقاس: ......', 'لأ'], note: 'الطبقات: أبيض + ألوان + ورنيش؟ واللامينيشن (فيلم B) بيتعمل على الماكينة ولا بعدها؟', lines: 2 },
    { q: 'الـ UV DTF: القص', opts: ['شيت كامل من غير قص', 'قص مستطيل حوالين كل ستيكر', 'قص على الشكل (بلوتر)'], note: 'ستيكرات اللف للكوبايات لازم تتسلّم مقصوصة على مقاسها بالظبط. محتاجين مننا خط قص؟', lines: 1 },
    { q: 'الـ UV DTF على الإزاز: الثبات', note: 'بيستحمل غسيل الإيد؟ غسالة الأطباق؟ المشروبات الساخنة والتلج؟ وإيه اللي تنصحوا نكتبه للعميل؟', lines: 2 },
    { q: `الكوباية المسحوبة: ملف المروحة بتاعنا (${L('PDF')} بالمقاس الحقيقي، ${fanText})`, opts: ['بنقبله ونقص عليه', 'عايزينه PNG من غير خطوط', 'عندنا قالب وهنبعته'], note: 'ولو الكوباية المتاحة عندكم مقاسها مختلف: ابعتوا القطر من فوق ومن تحت والطول ونجهّز الملف عليها.', lines: 1 },
    { q: 'بتلزقوا ستيكر اللف على الكوباية عندكم وتسلّموها جاهزة؟ والكوبايات الإزاز السادة (كانز 16 و 20 أونصة، تمبلر 20، مسحوبة 12) متاحة منكم؟', opts: ['بنلزق وبنوفّر الكوبايات', 'بنلزق على كوبايات منكم', 'ستيكر بس'], lines: 1 },
    { q: `الألوان: ملفاتنا ${L('RGB (sRGB)')}. عندكم بروفايل معيّن للـ RIP تفضّلوا نشتغل عليه، أو تفضّلوا ${L('CMYK')}؟`, note: 'والألوان اللي بتطلع مختلفة عن الشاشة عادةً (أحمر فاقع، برتقالي، أزرق غامق، فسفوري)، والفرق بين الطباعة على أبيض وعلى شفاف.', lines: 2 },
    { q: `الدقة: ملفاتنا ${L('300 DPI')} للقطع الصغيرة، وأقل للكبيرة (اللوحة ${L('A1')}: ${dpi('sign', 'A1')}، ستيكر الإزاز الكبير: ${dpi('windowstickers', '70')}). أقل دقة تقبلوها لكل نوع؟`, lines: 1 },
    { q: 'أرفع خط وأصغر كلام بيطلعوا واضحين (بالمم / بالبونط)، وخصوصًا الأبيض، وعلى الـ UV DTF (الحاجات الرفيعة بتثبت على الفيلم؟)', lines: 2 },
    { q: 'الحواف الناعمة والظلال النص شفافة والتدرّج لحد الشفاف: بتطلع إزاي مع الأبيض تحتها؟ تفضّلوا نحوّل الحواف لحادة قبل ما نبعت؟', lines: 1 },
    { q: 'الطباعة لحد حرف القطعة (Full bleed) على القطع الجاهزة: ممكنة؟ ولا لازم نسيب هامش فاضي من الحرف كام مم؟', lines: 1 },
    { q: 'شنط الورق بلوجو: بتتعمل عندكم؟ بأنهي طريقة (UV، سلك سكرين، أوفست قبل التجميع) وأقل كمية؟', lines: 1 },
    { q: 'القطع الفاضية اللي بتوفّروها (أكريليك مقصوص، دروع كريستال، ميداليات، كروت PVC، جرابات، زمزميات وتمبلر، صناديق خشب): اكتبوا المتاح ومقاساته', lines: 3 },
  ],

  confirm: [
    ['من غير زيادة قص (الملف بمقاس القطعة بالظبط)', names(noBleed)],
    ['بزيادة قص', someBleed.map((p) => `${p.name.ar}: ${L(mm(p.sides[0].bleedIn))} مم`).join('، ')],
    ['الألوان', `${L('RGB · sRGB')} بخلفية شفافة، من غير قناة أبيض أو ورنيش`],
    ['الكارنيه', `${size('idcards')}، هامش أمان ${L(mm(P('idcards').sides[0].safeIn))} مم`],
    ['الميدالية', `${size('keychain')}`],
    ['جراب الموبايل', groups(P('phonecase')).map((f) => `${L(f.label)}: ${WH(f.w, f.h)}`).join('، ')],
    ['الرول أب', `${size('rollup')}، دقة ${dpi('rollup')}، هامش أمان ${L(mm(P('rollup').sides[0].safeIn / 10))} سم`],
    ['البانر', `${bannerDpi}؛ الكلام بعيد عن الحرف ${L(mm(P('banners').sides[0].safeIn / 10))} سم عشان الحلقات`],
    ['اللوحة الفوم', groups(P('sign')).map((f) => `${L(f.label)}: ${WH(f.w, f.h)} · ${L(`${f.dpi} DPI`)}`).join('، ')],
    ['ستيكر الإزاز', groups(P('windowstickers')).map((f) => `${WH(f.w, f.h)} · ${L(`${f.dpi} DPI`)}`).join('، ')],
    ['أقل دقة بنقبلها من صورة العميل', `${L('100 DPI')} للقطع العادية، ${L('72 DPI')} للي ضلعها أطول من ${L('61')} سم، و ${L('40 DPI')} للي أطول من ${L('122')} سم`],
    ['ستيكرات اللف المستقيمة', ['uvwrap16', 'uvwrap20', 'uvwraptumbler'].map((id) => `${P(P(id).pair).name.ar}: ${size(id)}`).join('، ')],
    ['ستيكر الكوباية المسحوبة', `الشريط مفرود ${size('uvwraptaper')}؛ المروحة: ${fanText}`],
    ['فتحة اللحام وهامش الأمان في ستيكرات اللف', `فتحة ${L(FAN.gapMm)} مم، وهامش أمان ${L(mm(P('uvwraptaper').sides[0].safeIn))} مم من كل حرف`],
    ['شيت الـ UV DTF', groups(P('uvdtf')).map((f) => `${L(f.label)}: ${WH(f.w, f.h)}`).join('، ')],
  ],
};
