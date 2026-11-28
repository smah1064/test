'use strict';
/*
 * Supplier pack: CNC routing (carved wood signs, calligraphy boards with a raised second layer, letters cut out of
 * sheet, giant event letters). Facts about the files come from src/laser.js (engravePng, cutSvg, laserSvg, traceCut),
 * src/app.js (FORMATS incl. letters-svg / layers-svg, laserSpec), public/js/admin.js (FORMATS_BY_METHOD.cnc),
 * public/js/editor.js (bridges, letter checks) and the products' `laser` and `model` data in src/products.js.
 * The multi-layer wall art of docs/multilayer-plan.md is planned only and is not in this pack.
 */
const L = (s) => `<span dir="ltr">${s}</span>`;
const WH = (w, h) => `عرض ${L(w)} × ارتفاع ${L(h)} سم`;
// Every size is read from the product data, so the pack can't drift from the code.
const { PRODUCTS, printWidthFor, printHeightFor } = require('../../src/products');
const P = (id) => PRODUCTS.find((p) => p.id === id);
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const mm = (inches) => String(Math.round((Number(inches) || 0) * 25.4));
const r2 = (n) => String(Math.round(n * 100) / 100);

// src/laser.js and src/app.js laserSpec (constants there are not exported).
const ENGRAVE_DPI = 254; // src/app.js laserSpec: dpi 254 (0.1 mm per dot)
const CUT_COLOUR = '#ff0000'; // src/laser.js CUT_STYLE
const RAISED_COLOUR = '#0000ff'; // src/app.js FORMATS['layers-svg']
const CUT_STROKE_MM = 0.1; // src/laser.js CUT_STYLE
const CUT_PX_PER_MM = 12; // src/laser.js: trace resolution of the cut lines
const CUT_MAX_PX = 4000; // src/laser.js: longest side of the traced picture
const BOARD_RADIUS_MM = 4; // src/laser.js: corners of the plate under cut letters
const MIN_CARVED_LETTER_MM = 1.5; // public/js/editor.js: warning under this letter height (carving)
const MIN_CUT_LETTER_MM = 5; // public/js/editor.js: warning under this letter height (cut pieces)
const STANDOFFS = 4; // src/products.js NAMEART_SCREWS: the stand-offs drawn on the plate
const LETTERS_FILL = 75; // public/js/editor.js, src/preflight.js: event letters must take at least 75% of the height
// The editor's export (public/js/editor.js exportPrint): 300 DPI, less when the file would pass the canvas limits.
const sourceDpi = (g) => Math.floor(Math.min(300, Math.sqrt(16e6 / (g.wIn * g.hIn)), 8000 / Math.max(g.wIn, g.hIn)));
/** Cut lines are traced from the design's picture: the step of that picture in mm for a piece of this size. */
const traceStep = (g) => r2(1 / Math.min(CUT_PX_PER_MM, CUT_MAX_PX / (Math.max(g.wIn, g.hIn) * 25.4)));

/** The different sizes a product has, smallest first. */
function groups(p) {
  const side = p.sides[0];
  const out = [];
  for (const size of p.sizes) {
    const wIn = printWidthFor(p, side, size.id);
    const hIn = printHeightFor(p, side, size.id);
    const f = { wIn, hIn, w: cm(wIn), h: cm(hIn), size };
    if (!out.some((g) => g.w === f.w && g.h === f.h)) out.push(f);
  }
  return out.sort((x, y) => x.wIn - y.wIn);
}
const last = (id) => groups(P(id)).pop();
const size = (id, i = 0) => { const g = groups(P(id))[i]; return WH(g.w, g.h); };
const sizes = (id) => groups(P(id)).map((g) => WH(g.w, g.h)).join(' أو ');
/** Two sizes: each on its own line with its own numbers. More: the smallest in the block, the rest in a row. */
function sidesOf(p) {
  const g = groups(p);
  const s = p.sides[0];
  const name = SIDE[p.id] || s.name.ar;
  if (g.length < 2) return [{ ...s, name: { ...s.name, ar: name } }];
  const shaped = (f, t) => ({ ...s, name: { ...s.name, ar: `${name} · ${t}` }, printWidthIn: f.wIn, printArea: { ...s.printArea, h: (s.printArea.w * f.hIn) / f.wIn } });
  if (g.length === 2) return g.map((f) => shaped(f, f === g[0] ? 'المقاس الصغير' : 'المقاس الكبير'));
  return [shaped(g[0], 'أصغر مقاس')];
}
const sizeRow = (p) => { const g = groups(p); return g.length > 2 ? [['كل المقاسات', g.map((f) => WH(f.w, f.h)).join('<br>')]] : []; };
const SIDE = { eventletters: 'مساحة الحروف', rehal: 'لوحة الاسم', nameart: 'اللوح' };

const thick = (id) => mm(P(id).model.depthIn);
const raised = (id) => mm(P(id).model.raised);
const radius = (id) => P(id).laser.radiusMm;
const option = (id, optId) => P(id).options.find((o) => o.id === optId).choices.map((c) => c.name.ar).join(' / ');
const PRELIM = '(مبدئي)';
const board = (id) => `اللي بنعرضه: لوح ${L(thick(id))} مم والطبقة البارزة ${L(raised(id))} مم ${PRELIM}`;
const TWO = 'نفس تصميم العميل بيطلع مرتين: صورة حفر على اللوح، وحدود قص للطبقة البارزة اللي بتتلزق فوقه (ملف الطبقتين)';
const corners = (id) => `اللوح بيتقص بمقاس القطعة بالظبط، بأركان مدورة نص قطرها ${L(radius(id))} مم (في كل المقاسات)`;
const ROUND = 'اللوح دايرة، والمقاس المكتوب هو قطرها';

const NOTES = {
  calligraphy: {
    material: `لوح خشب مدوّر عليه خط عربي بارز بالدهبي: خشب أرو طبيعي، أسود، أبيض أو جوزي. ${board('calligraphy')}`,
    rows: [['الشكل', ROUND], ['الطبقتين', TWO]],
    ask: 'الكلام البارز الدهبي بتنفّذوه إزاي: حروف مقصوصة من خشب أو MDF ومدهونة دهبي، أكريليك مراية دهبي، ولا حفر بارز في نفس اللوح؟ وأرفع جزء في الخط العربي يستحمل القص واللزق كام مم؟',
  },
  calligraphypanel: {
    material: `لوحة خشب طولية عليها خط عربي مقصوص طبقة تانية وبارز فوقها: جوزي + خشب فاتح، أسود + دهبي، أبيض + دهبي، أرو طبيعي + جوزي. ${board('calligraphypanel')}`,
    rows: [['الشكل', corners('calligraphypanel')], ['الطبقتين', TWO]],
    ask: `المقاس الكبير ${size('calligraphypanel', 1)} بيدخل ماكينتكم قطعة واحدة؟ اللوح ده بيتعمل من خشب مصمت ولا MDF بقشرة؟ وبيتقوّس مع الوقت؟ والتعليق من ورا إزاي؟`,
  },
  doorhanger: {
    material: `يافطة خشب مدوّرة لباب الشقة على حبل جوت، والكتابة طبقة تانية بارزة: زيتي أو أسود + خشب طبيعي، أبيض + جوزي، جوزي + خشب فاتح. ${board('doorhanger')}`,
    rows: [['الشكل', ROUND], ['الطبقتين', TWO], ['التعليق', 'حبل جوت. خروم الحبل مش مرسومة في ملفاتنا']],
    ask: 'الألواح الملونة (زيتي، أسود، أبيض): MDF مدهون ولا خشب مصبوغ؟ خروم الحبل قطرها ومكانها كام عندكم؟ والحبل الجوت منكم؟ وبتستحمل تتعلّق على باب (رطوبة وخبط)؟',
  },
  keyholder: {
    material: `علّاقة مفاتيح خشب بـ ${L(P('keyholder').model.hooks)} شناكل معدن، واسم العيلة ورسمة صغيرة طبقة تانية بارزة: جوزي + خشب فاتح، طبيعي + جوزي، أسود + طبيعي، أبيض + جوزي. ${board('keyholder')}`,
    rows: [['الشكل', corners('keyholder')], ['الطبقتين', TWO], ['الشناكل والتعليق', `${L(P('keyholder').model.hooks)} شناكل تحت الكتابة. أماكن الشناكل وخروم التعليق مش مرسومة في ملفاتنا`]],
    ask: 'الشناكل منكم (نوعها ولونها)؟ بتتركّب بمسامير ولا بتتلف في الخشب؟ والتعليق على الحيطة: خروم ظاهرة ولا علّاقات من ورا؟',
  },
  villasign: {
    material: `يافطة خارجية محفور عليها اسم العيلة ورقم البيت: خشب تيك بحروف غامقة، لوح أسود بحروف بيضا أو نحاسي، لوح أبيض بحروف سودا. التُخن اللي بنعرضه ${L(thick('villasign'))} مم ${PRELIM}`,
    rows: [['الشكل', corners('villasign')], ['الحفر', 'الكلام محفور في اللوح وملوّن جوه الحفر. الملف صورة حفر لون واحد، من غير عمق محدد']],
    ask: 'للشمس والمطر: تنصحوا بأنهي خامة (تيك، خشب معالج، PVC فوم، أكريليك، كلادينج)؟ الحروف بتتلوّن جوه الحفر إزاي؟ التشطيب الخارجي (لاكيه بحري / UV)؟ والتثبيت جنب البوابة (مسامير ظاهرة، فيشر، دبل فيس)؟',
  },
  woodnameplate: {
    material: `قطعة خشب مصمت للمكتب (جوزي أو زان)، محفور على وشّها الاسم والوظيفة. العمق اللي بنعرضه ${L(thick('woodnameplate'))} مم ${PRELIM}`,
    rows: [['الشكل', 'قطعة جاهزة بمقاس الحفر: الملف مفيهوش خط قص'], ['علبة الهدية (اختياري)', option('woodnameplate', 'giftbox')]],
    ask: 'القطعة مقطعها مستطيل ولا مايلة (وشّها مايل للي قاعد قدام المكتب)؟ خشب جوز وزان مصمت متوفر عندكم؟ الحفر بيتلوّن؟ وعلبة الخشب اللي بتتفتح سحب منكم؟',
  },
  rehal: {
    material: `رحل مصحف خشب بيتطبق (زان أو جوزي)، طوله ${L(P('rehal').sizes[0].id)} سم، ومحفور على لوحته اسم أو دعاء قصير`,
    rows: [['الشكل', 'رحل جاهز: الملف فيه حفر لوحة الاسم بس، مفيهوش رسمة الرحل ولا خط قص']],
    ask: 'الرحل نفسه بتصنّعوه ولا بتوفّروه جاهز؟ مقاسه وهو مفتوح ومقفول؟ مكان ومساحة الحفر المتاحة عليه بالظبط؟ والحفر عليه CNC ولا ليزر؟',
  },
  nameart: {
    material: `اسم بالخط العربي مقصوص من أكريليك (بينك، مراية دهبي، أبيض، أسود) أو خشب، ومتثبت على لوح أكريليك أبيض للحيطة. التُخن اللي بنعرضه للحروف ${L(thick('nameart'))} مم ${PRELIM}`,
    rows: [
      ['القص', `كل حرف أو شكل منفصل حتة لوحده، والكلام بيتخّن ${L(P('nameart').laser.bridgeMm)} مم عشان أجزاء الحرف تلزق. ومعاهم حدود اللوح بمقاس القطعة بالظبط وأركان مدورة ${L(BOARD_RADIUS_MM)} مم`],
      ['التعليق', `مرسوم عندنا بـ ${L(STANDOFFS)} مسامير ديكور في أركان اللوح. خروم المسامير مش مرسومة في ملفاتنا`],
    ],
    ask: `المقاس الكبير ${WH(last('nameart').w, last('nameart').h)} بيتقص قطعة واحدة عندكم؟ القص CNC ولا ليزر للأكريليك؟ الحروف بتتلزق على اللوح بإيه، وبتظبطوا أماكنها إزاي؟ ومسامير الديكور منكم؟`,
  },
  eventletters: {
    material: `حروف أو أرقام عملاقة بتقف على الأرض، لحد ${L(P('eventletters').laser.maxPieces)} حروف في الطلب: أبيض، دهبي، روز جولد أو خشب طبيعي. التُخن اللي بنعرضه ${L(thick('eventletters'))} مم ${PRELIM}`,
    rows: [
      ['المقاس', `المساحة المكتوبة هي مساحة الحروف كلها جنب بعض. ارتفاع الحرف ${groups(P('eventletters')).map((g) => L(g.h)).join(' أو ')} سم (الحرف لازم ياخد ${L(`${LETTERS_FILL}%`)} من الارتفاع على الأقل)`],
      ['القص', `كل حرف حتة لوحده، والكلام بيتخّن ${L(P('eventletters').laser.bridgeMm)} مم عشان أجزاء الحرف (النقط) تلزق فيه. القاعدة أو السنّادة مش مرسومة في ملفاتنا`],
    ],
    ask: 'حرف طوله 90 سم بيقف على الأرض إزاي عندكم: تُخن كبير (فوم / خشب مجوّف / صندوق)، قاعدة، ولا سنّادة من ورا؟ الخامة اللي تنصحوا بيها؟ الوزن؟ وبيتنقل ويتسلّم إزاي؟',
  },
};
const ORDER = ['calligraphy', 'calligraphypanel', 'doorhanger', 'keyholder', 'villasign', 'woodnameplate', 'rehal', 'nameart', 'eventletters'];
const productNotes = {};
for (const id of ORDER) productNotes[id] = { ...NOTES[id], hideSizes: true, rows: [...sizeRow(P(id)), ...(NOTES[id].rows || [])] };

const RAISED = ORDER.filter((id) => P(id).model.raised);
const CARVED = ORDER.filter((id) => P(id).laser.kind === 'engrave' && !P(id).model.raised);
const name = (id) => P(id).name.ar;
const stepOf = (id) => `${name(id)} ${WH(last(id).w, last(id).h)}: ${L(traceStep(last(id)))} مم`;

module.exports = {
  title: 'الحفر والقص CNC',
  subtitle: 'لوحات كاليجرافي خشب بكتابة بارزة، يفط فيلات، علّاقات باب ومفاتيح، أسماء مكاتب، أسماء مقصوصة على لوح، وحروف كبيرة للمناسبات',
  short: 'الـ CNC',
  sizesWord: 'مقاسات القطع',
  jobSize: 'مقاس القطعة بالسنتيمتر',
  compact: true,
  products: ORDER,
  sidesOf,
  sectionTitle: 'المنتجات ومقاسات القطع',
  areaLabel: 'مقاس القطعة',
  areaLegend: 'مقاس القطعة أو اللوح (وفي القطع الجاهزة: مساحة الحفر)',
  sideLabel: 'المقاس',
  dpiColumn: false,
  coloursLabel: 'الخامة / اللون',

  filesIntro:
    'القطع دي لون واحد: الكلام والرسومات يا بتتحفر في اللوح، يا بتتقص حروف، يا بتتقص طبقة تانية وتتلزق فوق اللوح. ملفاتنا بتطلع أوتوماتيك من تصميم العميل بالمقاس الحقيقي، وهي معمولة أصلًا لبرامج الليزر، فعايزين نعرف إيه اللي ينفع منها للراوتر وإيه اللي محتاجينه بشكل تاني:',
  files: [
    { name: `ملف ${L('SVG')} (لـ ${L('LightBurn')})`, spec: `ملف واحد بالمقاس الحقيقي بالمليمتر (نقطة الصفر فوق شمال): صورة الحفر جوّاه، وخطوط القص (حدود اللوح أو الحروف) خط أحمر ${L(CUT_COLOUR)} تُخنه ${L(CUT_STROKE_MM)} مم من غير تعبئة`, use: 'الملف الأساسي' },
    { name: `خطوط القص ${L('SVG')}`, spec: `الخطوط الحمرا لوحدها بالمليمتر: حدود اللوح (${L('Vector')} مظبوط)، أو حدود الحروف المقصوصة (مرسومة من صورة التصميم)`, use: 'قص حدود اللوح والحروف (Profile)' },
    { name: `صورة الحفر ${L('PNG')}`, spec: `أبيض وأسود بس (${L('1-bit')}): الأسود = المكان اللي بيتحفر. ${L(`${ENGRAVE_DPI} DPI`)} بالمقاس الحقيقي. <b>صورة مش ${L('Vector')}</b>، ومن غير عمق`, use: 'الأماكن المحفورة في اللوح' },
    { name: `الحروف البارزة ${L('SVG')}`, spec: `للقطع اللي بطبقتين بس: حدود قص الطبقة البارزة (خط أحمر، مرسومة من صورة التصميم)`, use: 'قص الطبقة التانية' },
    { name: `الطبقتين ${L('SVG')}`, spec: `للقطع اللي بطبقتين بس: صورة الحفر + حدود اللوح بالأحمر + حدود الطبقة البارزة بالأزرق ${L(RAISED_COLOUR)} في ملف واحد`, use: 'يبيّن مكان الطبقة البارزة على اللوح' },
    { name: `التصميم ${L('PNG')} و ${L('PDF')}`, spec: 'التصميم زي ما العميل شافه (بلون الحفر أو الخامة على خلفية شفافة)، بالمقاس الحقيقي', use: 'للمراجعة والمقارنة، أو لو هتعيدوا الرسم عندكم' },
  ],
  filesNotes: [
    `<b>مهم:</b> مفيش عندنا ملف ${L('DXF')} ولا مسارات عدّة (Toolpaths) ولا ${L('G-code')}، والحفر صورة نقط مش ${L('Vector')}. في القطع المحفورة (${CARVED.map(name).join('، ')}) هتحتاجوا تحوّلوا الصورة لـ ${L('Vector')} عندكم، أو تقولوا لنا الصيغة اللي تشتغلوا عليها (أسئلة قسم ٤).`,
    `حدود الحروف والطبقة البارزة مرسومة من صورة التصميم: خطوط مستقيمة قصيرة ورا بعض (من غير أقواس)، بخطوة ${L(r2(1 / CUT_PX_PER_MM))} مم في القطع لحد ${L(Math.floor(CUT_MAX_PX / CUT_PX_PER_MM / 10))} سم، وأكبر من كده في القطع الكبيرة (الأرقام في قسم ٥).`,
    'الخطوط على المقاس النهائي للقطعة: <b>من غير تعويض قطر البنطة</b> ومن غير تدوير للأركان الداخلية. الملف مفيهوش عمق الحفر ولا نوع الحفر (V ولا Pocket): دول بيتحددوا معاكم.',
    `الألوان: الأحمر = قص حدود اللوح أو الحروف. الأزرق = حدود الطبقة البارزة (بتتقص من لوح تاني، وعلى اللوح الأساسي هي علامة مكان بس). الصورة السودا = حفر.`,
    `الملفات بالمقاس الحقيقي ${L('1:1')} ومش معكوسة: من غير تكبير أو تصغير، ومن غير تغيير الخط. الملف مفيهوش خروم تعليق ولا أماكن شناكل أو مسامير.`,
  ],

  productsIntro: 'لو المنتج ليه مقاسين، كل مقاس في سطر. التُخن «المبدئي» هو اللي بنعرضه للعميل في المعاينة: الخامات والتُخانات لسه ما اتأكدتش من أي ورشة، ورأيكم هو اللي هنمشي عليه.',
  productNotes,

  priceRows: ['لوحة كاليجرافي مدوّرة 40 سم بطبقتين', 'لوحة طولية 40 × 80 سم بطبقتين', 'يافطة فيلا 40 × 30 سم', 'اسم مكتب خشب مصمت', 'اسم مقصوص على لوح 60 × 30 سم', 'حرف مناسبات 60 سم / 90 سم (بالحرف)', 'سعر الخامة (لو منكم)'],

  questions: [
    { q: 'ماكينات الـ CNC عندكم: النوع، مساحة الشغل (عرض × طول سم) وأقصى ارتفاع (Z)', note: `أكبر قطع عندنا: ${WH(last('calligraphypanel').w, last('calligraphypanel').h)} (اللوحة الطولية)، ${WH(last('nameart').w, last('nameart').h)} (الاسم على لوح)، وحرف طوله ${L(last('eventletters').h)} سم.`, lines: 2 },
    { q: 'القطع الأكبر من مساحة الماكينة: بتتقسّم وتتلحم عندكم؟', opts: ['كل المقاسات دي قطعة واحدة', 'بنقسّم ونلحم', 'أقصى مقاس قطعة واحدة: ..........'] },
    { q: 'الإسبندل والعِدد: القدرة، وأصغر بنطة بتشتغلوا بيها (القطر بالمم)، وزوايا بنط الـ V المتوفرة', note: 'وأصغر نص قطر في الأركان الداخلية بيطلع عندكم.', lines: 2 },
    { q: 'برنامج الرسم والتشغيل', opts: ['Aspire / VCarve', 'ArtCAM', 'Fusion 360', 'AutoCAD', 'CorelDRAW', 'برنامج تاني: ..........'] },
    { q: 'صيغ الملفات اللي تفضّلوها', opts: ['DXF', 'SVG', 'AI / EPS', 'PDF Vector', 'CRV / ART', 'صورة وبنرسمها عندنا'], note: `ملفاتنا ${L('SVG')} بالمليمتر. بتفتح عندكم بالمقاس الصح؟`, lines: 1 },
    { q: `الحفر عندنا صورة نقط (${L(`PNG ${ENGRAVE_DPI} DPI`)}) مش ${L('Vector')}. هتتعاملوا معاها إزاي؟`, opts: ['بنحوّلها Vector عندنا', 'محتاجين Vector منكم', 'بنحفرها ليزر مش CNC'], note: 'لو بتحوّلوها: بتاخد وقت قد إيه للقطعة، وبتبعتوا لنا شكل المسارات للموافقة قبل التشغيل؟', lines: 2 },
    { q: `حدود الحروف عندنا خطوط مستقيمة قصيرة مرسومة من صورة (خطوة ${L(r2(1 / CUT_PX_PER_MM))} مم، وفي حروف المناسبات ${L(last('eventletters').h)} سم ${L(traceStep(last('eventletters')))} مم). تنفع للقص؟`, opts: ['تنفع', 'محتاجين Vector بأقواس', 'بنعيد الرسم عندنا'], lines: 1 },
    { q: 'نوع الحفر اللي تنصحوا بيه للكلام على اللوح', opts: ['V-Carve', 'Pocket بعمق ثابت', 'حفر بارز (الكلام طالع والأرضية نازلة)', 'ليزر'], note: 'والعمق المعتاد (مم) لكل نوع، وأرفع خط وأصغر حرف بيطلعوا واضحين.', lines: 2 },
    { q: 'أقل مقاسات تنصحوا بيها', note: `عندنا بننبّه العميل لو ارتفاع الحرف المحفور أقل من ${L(MIN_CARVED_LETTER_MM)} مم أو المقصوص أقل من ${L(MIN_CUT_LETTER_MM)} مم (أرقام معمولة لليزر). عايزين أرقام الراوتر عندكم.`, table: { cols: ['', 'خشب / MDF', 'أكريليك'], rows: ['أرفع جزء يستحمل القص (مم)', 'أقل ارتفاع حرف مقصوص (مم)', 'أقل ارتفاع حرف محفور (مم)', 'أصغر حتة منفصلة (مم)'] } },
    { q: 'الخامات المتوفرة عندكم دايمًا', table: { cols: ['الخامة', 'متوفرة؟', 'التُخانات (مم)', 'مقاس اللوح (سم)'], rows: ['MDF خام / بقشرة', 'خشب زان', 'خشب جوز / أرو', 'خشب تيك (خارجي)', 'أبلكاش', 'PVC فوم', 'أكريليك ملوّن / مراية'] } },
    { q: 'الكتابة البارزة (طبقة تانية فوق اللوح): طريقة التنفيذ عندكم', opts: ['حروف مقصوصة وملزوقة', 'حفر بارز في نفس اللوح', 'الاتنين متاحين'], note: 'لو ملزوقة: بتظبطوا أماكن الحروف إزاي (حفر خفيف مكانها، استنسل، علامات)؟ نوع اللزق؟ وأرفع جزء في الخط العربي يستحمل؟', lines: 2 },
    { q: `في القطع اللي بطبقتين ملفنا فيه التصميم مرتين: صورة حفر على اللوح، وحدود الطبقة البارزة بالأزرق ${L(RAISED_COLOUR)}. تحبوا مكان الطبقة على اللوح يبقى إيه؟`, opts: ['حفر خفيف (جيب) الحروف تقعد فيه', 'خط تعليم خفيف', 'من غير أي علامة'], note: 'ولو جيب: عمقه كام، وبتوسّعوه كام مم عن الحروف؟', lines: 1 },
    { q: 'الدهبي في لوحات الكاليجرافي: بتعملوه إزاي؟', opts: ['دهان دهبي (سبراي)', 'ورق دهب', 'أكريليك مراية دهبي', 'MDF بقشرة دهبي'], note: 'واللي بيعيش أكتر من غير ما يغمق أو يتقشّر.', lines: 1 },
    { q: 'الألواح الملونة (أسود، أبيض، زيتي) والخشب (جوزي، طبيعي، أرو، زان): بتوفّروها خشب بلونه ولا صبغة / دهان على MDF؟ والتشطيب', opts: ['صنفرة', 'صبغة', 'دهان دوكو', 'لاكيه مط / لامع', 'زيت / شمع'], lines: 2 },
    { q: 'يافطة الفيلا (خارجية): الخامة والتشطيب اللي بيستحملوا الشمس والمطر، وتلوين الحروف جوه الحفر (أبيض، أسود، نحاسي)', note: 'والعمر المتوقع قبل ما تحتاج تتجدد.', lines: 3 },
    { q: 'حروف المناسبات (ارتفاع 60 و 90 سم، بتقف على الأرض)', table: { cols: ['', 'ارتفاع 60 سم', 'ارتفاع 90 سم'], rows: ['الخامة', 'التُخن (مم)', 'طريقة الوقوف (تُخن / قاعدة / سنّادة)', 'الوزن التقريبي للحرف'] } },
    { q: 'حروف المناسبات: التشطيب (أبيض، دهبي، روز جولد، خشب طبيعي) بيتعمل إزاي؟ الحواف بتتقفل وتتدهن؟ وفيه إضاءة (لمبات) متاحة عندكم؟', lines: 2 },
    { q: 'الاسم المقصوص على لوح أكريليك أبيض: بتقصّوا الأكريليك CNC ولا ليزر؟ الحروف (أكريليك ملوّن / مراية / خشب) بتتلزق على اللوح بإيه؟ ومسامير الديكور (Stand-offs) منكم؟', lines: 2 },
    { q: 'الإكسسوارات والتعليق', opts: ['شناكل معدن للمفاتيح', 'حبل جوت', 'علّاقات من ورا', 'مسامير ديكور', 'خروم ظاهرة', 'علبة خشب بتتفتح سحب'], note: 'اكتبوا المتاح منكم، وأماكن وأقطار الخروم اللي محتاجين نزوّدها في ملفاتنا.', lines: 2 },
    { q: 'الرحل: بتصنّعوه أو بتوفّروه جاهز (30 سم)؟ ومساحة الحفر المتاحة على لوحته', opts: ['بنصنّعه', 'بنوفّره جاهز', 'لأ'], lines: 1 },
    { q: 'الطباعة UV فوق الخشب المحفور أو المقصوص (لو حبّينا نضيف ألوان بعدين): عندكم فلات بِد UV ولا بتتعاملوا مع جهة تانية؟ وبتظبطوا الطباعة على الحفر إزاي؟', opts: ['عندنا', 'جهة تانية', 'لأ'], lines: 1 },
    { q: 'دقة المقاسات: نسبة الخطأ المتوقعة في مقاس القطعة ومكان الحفر (± كام مم)', lines: 1 },
    { q: 'التغليف والنقل للقطع الكبيرة والتقيلة (لوحة 60 × 120 سم، حروف 90 سم): بتغلّفوها إزاي؟ وبتوصّلوا؟', lines: 2 },
  ],

  confirm: [
    ['صيغة الملفات', `${L('SVG')} بالمليمتر، بالمقاس الحقيقي ${L('1:1')}، نقطة الصفر فوق شمال، مش معكوس. مفيش ${L('DXF')}`],
    ['الألوان في الملف', `أحمر ${L(CUT_COLOUR)} تُخن ${L(CUT_STROKE_MM)} مم = قص. أزرق ${L(RAISED_COLOUR)} = الطبقة البارزة. صورة سودا = حفر`],
    ['صورة الحفر', `أبيض وأسود ${L('1-bit')}، ${L(`${ENGRAVE_DPI} DPI`)}، من غير عمق. في القطع الكبيرة صورة تصميم العميل أقل دقة وبتتكبّر: ${name('calligraphypanel')} ${WH(last('calligraphypanel').w, last('calligraphypanel').h)} حوالي ${L(`${sourceDpi(last('calligraphypanel'))} DPI`)}`],
    ['تعويض قطر البنطة / Kerf', 'مفيش: الخطوط على المقاس النهائي، والأركان الداخلية حادة'],
    ['دقة رسم حدود الحروف', `${L(CUT_PX_PER_MM)} بيكسل لكل مم (خطوة ${L(r2(1 / CUT_PX_PER_MM))} مم) وبحد أقصى ${L(CUT_MAX_PX)} بيكسل للضلع الطويل. في أكبر المقاسات:<br>${['calligraphy', 'calligraphypanel', 'nameart', 'eventletters'].map(stepOf).join('<br>')}`],
    ['تخين الكلام عشان أجزاء الحرف تلزق', `${name('nameart')}: ${L(P('nameart').laser.bridgeMm)} مم. ${name('eventletters')}: ${L(P('eventletters').laser.bridgeMm)} مم`],
    ['أصغر كلام', `تنبيه للعميل تحت ارتفاع حرف ${L(MIN_CARVED_LETTER_MM)} مم (محفور) أو ${L(MIN_CUT_LETTER_MM)} مم (مقصوص). أرقام معمولة لليزر`],
    ['قطع بطبقتين', RAISED.map((id) => `${name(id)}: ${sizes(id)}، لوح ${L(thick(id))} مم + بارز ${L(raised(id))} مم`).join('<br>')],
    ['قطع محفورة', CARVED.map((id) => `${name(id)}: ${sizes(id)}${id === 'rehal' ? '' : `، تُخن ${L(thick(id))} مم`}`).join('<br>')],
    ['أركان الألواح', ['calligraphypanel', 'keyholder', 'villasign'].map((id) => `${name(id)}: ${L(radius(id))} مم`).join('، ') + `. اللوح تحت الاسم المقصوص: ${L(BOARD_RADIUS_MM)} مم`],
    ['الاسم المقصوص على لوح', `${groups(P('nameart')).map((g) => WH(g.w, g.h)).join('<br>')}<br>تُخن الحروف ${L(thick('nameart'))} مم`],
    ['حروف المناسبات', `لحد ${L(P('eventletters').laser.maxPieces)} حروف. مساحة الحروف كلها ${sizes('eventletters')}، والحرف بياخد ${L(`${LETTERS_FILL}%`)} من الارتفاع على الأقل. تُخن ${L(thick('eventletters'))} مم`],
    ['هامش الأمان', `الكلام بعيد عن حرف اللوح من ${L(mm(P('rehal').sides[0].safeIn))} مم (الرحل) لـ ${L(mm(P('villasign').sides[0].safeIn))} مم (يافطة الفيلا)`],
    ['كل التُخانات والخامات', 'مبدئية: هي اللي بنعرضها في المعاينة، ومحتاجة تأكيدكم أو بديلكم'],
  ],
};
