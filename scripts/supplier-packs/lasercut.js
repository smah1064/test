'use strict';
/*
 * Supplier pack: laser cutting (cake toppers, Ramadan decorations, the name puzzle, pieces standing in a wooden base).
 * Facts about the files come from src/laser.js (traceCut, cutSvg, laserSvg, boardPath), src/app.js (FORMATS, laserSpec),
 * public/js/admin.js (FORMATS_BY_METHOD.lasercut), public/js/editor.js (bridges and the laser checks) and the
 * products' `laser` and `model` data in src/products.js.
 */
const L = (s) => `<span dir="ltr">${s}</span>`;
const WH = (w, h) => `عرض ${L(w)} × ارتفاع ${L(h)} سم`;
// Every size is read from the product data, so the pack can't drift from the code.
const { PRODUCTS, printWidthFor, printHeightFor } = require('../../src/products');
const P = (id) => PRODUCTS.find((p) => p.id === id);
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const mm = (inches) => String(Math.round((Number(inches) || 0) * 25.4));
const r2 = (n) => String(Math.round(n * 100) / 100);

// src/laser.js (constants there are not exported).
const CUT_COLOUR = '#ff0000'; // CUT_STYLE
const CUT_STROKE_MM = 0.1; // CUT_STYLE
const CUT_PX_PER_MM = 12; // trace resolution of the cut lines
const CUT_MAX_PX = 4000; // longest side of the traced picture
const CUT_MIN_AREA_MM2 = 0.25; // smaller bits are dropped
const BOARD_RADIUS_MM = 4; // corners of the puzzle board
const MIN_CUT_LETTER_MM = 5; // public/js/editor.js: warning under this letter height on cut pieces
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
const size = (id, i = 0) => { const g = groups(P(id))[i]; return WH(g.w, g.h); };
const sizes = (id) => groups(P(id)).map((g) => WH(g.w, g.h)).join(' أو ');
/** A product with two sizes shows both, each on its own line with its own numbers. */
function sidesOf(p) {
  const g = groups(p);
  const s = p.sides[0];
  if (g.length < 2) return [{ ...s, name: { ...s.name, ar: 'القطعة' } }];
  return g.map((f) => ({ ...s, name: { ...s.name, ar: f === g[0] ? 'المقاس الصغير' : 'المقاس الكبير' }, printWidthIn: f.wIn, printArea: { ...s.printArea, h: (s.printArea.w * f.hIn) / f.wIn } }));
}
const thick = (id) => mm(P(id).model.depthIn);
const bridge = (id) => P(id).laser.bridgeMm;
const onePiece = (id) => `القطعة لازم تطلع حتة واحدة: الكلام بيتخّن ${L(bridge(id))} مم عشان الحروف تلزق في بعض، وبننبّه العميل لو التصميم هيطلع أكتر من حتة`;
/** The puzzle's letter limit is written in each size's name (src/products.js). */
const maxLetters = (i) => /(\d+) letters/.exec(P('namepuzzle').sizes[i].label.en)[1];
const BASE = 'القاعدة الخشب اللي القطعة بتقف فيها مش مرسومة في ملفاتنا: محتاجين تعملوها أو توفّروها';
const ORDER = ['caketopper', 'ramadandecor', 'ramadanlight', 'couplestand', 'namepuzzle'];
const big = ORDER.map((id) => groups(P(id)).pop()).sort((a, b) => Math.max(b.wIn, b.hIn) - Math.max(a.wIn, a.hIn))[0];
const oneBridge = [...new Set(ORDER.filter((id) => P(id).laser.pieces === 'one').map(bridge))];

const productNotes = {
  caketopper: {
    material: `اسم أو جملة مقصوصة من أكريليك مراية (دهبي، فضي، روز جولد)، أكريليك أسود أو أبيض، أو خشب، بعصاية تتغرس في التورتة. التُخن اللي بنعرضه ${L(thick('caketopper'))} مم (مبدئي)`,
    hideSizes: true,
    rows: [['القص', onePiece('caketopper')], ['العصاية', 'ملفنا فيه حدود تصميم العميل بس: العصاية بتبقى في القص لو التصميم مرسوم بيها']],
    ask: 'العصاية: بتقصّوها مع الاسم حتة واحدة ولا عصاية منفصلة بتتلزق؟ طولها وعرضها كام عندكم؟ والأكريليك المراية: بتقصّوه من الضهر وبتسيبوا ورقة الحماية لحد التسليم؟',
  },
  ramadandecor: {
    material: `هلال أو فانوس أو نجمة باسم العيلة، مقصوصة من خشب أو أكريليك مراية دهبي أو أكريليك أبيض، للتعليق. التُخن اللي بنعرضه ${L(thick('ramadandecor'))} مم (مبدئي)`,
    hideSizes: true,
    rows: [['القص', onePiece('ramadandecor')]],
    ask: 'التعليق: خرم في القطعة (قطره ومكانه عندكم؟) ولا خيط أو شريطة منكم؟ الخرم بيبقى في القص لو التصميم مرسوم بيه بس.',
  },
  ramadanlight: {
    material: `منظر رمضان (جامع وهلال وفوانيس) باسم العيلة، مقصوص حتة واحدة من خشب (طبيعي، جوزي، أبيض) أو أكريليك مراية دهبي، واقف في قاعدة خشب ووراه شمعة ${L('LED')}. التُخن اللي بنعرضه ${L(thick('ramadanlight'))} مم (مبدئي)`,
    hideSizes: true,
    rows: [['القص', onePiece('ramadanlight')], ['القاعدة والشمعة', `${BASE}، ومعاها شمعة ${L('LED')}`]],
    ask: 'القاعدة: مقاسها وعرض وعمق المجرى عندكم كام عشان القطعة تقف ثابتة؟ محتاجين نسيب كام سم مستقيم من تحت في التصميم؟ وشمعة الـ LED منكم؟',
  },
  couplestand: {
    material: `إطار هلال أو قلب فيه الاسمين والتاريخ، مقصوص حتة واحدة من خشب (طبيعي، جوزي، أبيض) أو أكريليك مراية (دهبي، روز جولد)، واقف في قاعدة خشب. التُخن اللي بنعرضه ${L(thick('couplestand'))} مم (مبدئي)`,
    hideSizes: true,
    rows: [['القص', onePiece('couplestand')], ['القاعدة', BASE]],
    ask: `قطعة ${size('couplestand')} واقفة في مجرى: التُخن اللي تنصحوا بيه عشان ماتتهزش أو تتني؟ والأكريليك المراية بيقف كويس في قاعدة خشب؟`,
  },
  namepuzzle: {
    material: `اسم الطفل حروف خشب تخينة بتطلع من لوحة. الحروف خشب طبيعي أو بينك أو زرقا أو ملونة. التُخن اللي بنعرضه ${L(thick('namepuzzle'))} مم (مبدئي)`,
    hideSizes: true,
    rows: [
      ['القص', `كل حرف حتة لوحده (من غير تخين)، ومعاهم حدود اللوحة بمقاس القطعة بالظبط وأركان مدورة ${L(BOARD_RADIUS_MM)} مم. الملف طبقة واحدة: مفيهوش لوح خلفية`],
      ['عدد الحروف', `لحد ${L(maxLetters(0))} حروف في المقاس الصغير و ${L(maxLetters(1))} في الكبير`],
    ],
    ask: 'البازل بيتعمل عندكم إزاي: لوح مفرّغ ملزوق على لوح خلفية؟ تُخن كل لوح؟ الحروف بتتدهن (بينك، أزرق، ألوان) بدهان آمن للأطفال؟ والحواف بتتصنفر؟ والنقط والحتت الصغيرة في الحروف العربي بتتعاملوا معاها إزاي؟',
  },
};

module.exports = {
  title: 'القص بالليزر',
  subtitle: 'توبر تورتة، زينة رمضان، قطع واقفة في قاعدة خشب، وبازل خشب باسم الطفل',
  short: 'القص بالليزر',
  sizesWord: 'مقاسات القطع',
  jobSize: 'مقاس القطعة بالسنتيمتر',
  compact: true,
  products: ORDER,
  sidesOf,
  sectionTitle: 'المنتجات ومقاسات القطع',
  areaLabel: 'أقصى مقاس للقطعة',
  areaLegend: 'أقصى مساحة للقطعة المقصوصة (القطعة نفسها بتاخد شكل تصميم العميل جوه المساحة دي)',
  sideLabel: 'المقاس',
  dpiColumn: false,
  coloursLabel: 'الخامة / اللون',

  filesIntro:
    'القطع دي بتتقص على حدود تصميم العميل نفسه (اسم، جملة، شكل)، من غير حفر. خطوط القص بتطلع أوتوماتيك من التصميم بالمقاس الحقيقي، ومفيش أي تكبير أو تصغير مطلوب منكم:',
  files: [
    { name: `ملف الليزر ${L('SVG')} (لـ ${L('LightBurn')})`, spec: `خطوط القص بالمقاس الحقيقي بالمليمتر (نقطة الصفر فوق شمال): خط أحمر ${L(CUT_COLOUR)} تُخنه ${L(CUT_STROKE_MM)} مم من غير تعبئة. كل حتة مسار مقفول ومعاه فتحاته الداخلية`, use: 'الملف الأساسي لكل الشغل' },
    { name: `خطوط القص ${L('SVG')}`, spec: 'نفس الخطوط الحمرا في ملف لوحده (في القطع دي الملفين زي بعض لأن مفيش حفر)', use: 'لو بتشتغلوا على برنامج تاني' },
    { name: `التصميم ${L('PNG')} و ${L('PDF')}`, spec: 'شكل القطعة زي ما العميل شافها (بلون الخامة على خلفية شفافة)، بالمقاس الحقيقي', use: 'للمراجعة والمقارنة بعد القص، مش للماكينة' },
  ],
  filesNotes: [
    `<b>مهم:</b> خطوط القص مرسومة من صورة التصميم مش من الخطوط الأصلية: خطوط مستقيمة قصيرة ورا بعض (من غير أقواس)، بخطوة ${L(r2(1 / CUT_PX_PER_MM))} مم في القطع لحد ${L(Math.floor(CUT_MAX_PX / CUT_PX_PER_MM / 10))} سم. عايزين نعرف ده بيأثر على نعومة الحرف أو سرعة الماكينة عندكم (سؤال في قسم ٤).`,
    'الخطوط على المقاس النهائي للقطعة <b>من غير تعويض عرض شعاع الليزر (Kerf)</b>: التعويض بيتظبط عندكم.',
    `الملفات بالمقاس الحقيقي ${L('1:1')}: من غير تكبير أو «Fit to page»، ومن غير إعادة رسم للخطوط أو تغيير للخط. الملف مش معكوس: لو بتقصّوا الأكريليك المراية من الضهر قولوا لنا تعكسوه أنتم ولا نبعته معكوس.`,
    'الملف مفيهوش: قاعدة الستاند، لوح خلفية البازل، خروم تعليق أو عصاية (إلا لو مرسومين في التصميم)، ولا ترتيب القطع على الفرخ (Nesting).',
    'لو العميل حط صورة في التصميم بتطلع في القص مستطيل (بننبّهه قبل الطلب).',
  ],

  productsIntro: 'المقاس المكتوب هو أقصى مساحة: القطعة الفعلية ممكن تكون أصغر شوية حسب التصميم، ومقاسها بيتكتب في بيانات الشغلانة. التُخن «المبدئي» هو اللي بنعرضه للعميل في المعاينة ولسه ما اتأكدش من أي ورشة.',
  productNotes,

  priceRows: ['توبر تورتة أكريليك مراية', 'توبر تورتة خشب', 'زينة رمضان 25 سم', 'قطعة واقفة 30 سم بالقاعدة', 'بازل اسم 30 × 10 سم', 'سعر الخامة (لو منكم)'],

  questions: [
    { q: 'ماكينات الليزر عندكم: النوع، القدرة (وات) ومساحة الشغل', note: `أكبر قطعة عندنا في القص ${WH(big.w, big.h)}.`, table: { cols: ['النوع', 'القدرة (وات)', 'مساحة الشغل (عرض × طول سم)'], rows: ['CO2', 'دايود / غيره'] } },
    { q: 'البرنامج وصيغ الملفات اللي تفضّلوها', opts: ['LightBurn', 'RDWorks', 'CorelDRAW', 'SVG', 'DXF', 'AI / CDR', 'PDF'], note: 'ملف الـ SVG بتاعنا مقاسه بالمليمتر. بيتفتح عندكم بالمقاس الصح؟', lines: 1 },
    { q: 'أقصى تُخن بتقصّوه وأكبر فرخ لكل خامة', table: { cols: ['الخامة', 'التُخانات المتوفرة (مم)', 'أقصى تُخن بيتقص نضيف (مم)', 'مقاس الفرخ (سم)'], rows: ['أبلكاش (زان / حور / بتولا)', 'MDF خام / مدهون', 'أكريليك أسود / أبيض / ملوّن', 'أكريليك مراية (دهبي / فضي / روز جولد)'] } },
    { q: 'عرض شعاع الليزر (Kerf) عندكم لكل خامة وتُخن؟', table: { cols: ['الخامة والتُخن', 'الـ Kerf (مم)'], rows: ['خشب / أبلكاش 3 مم', 'أكريليك 3 مم', 'أكريليك مراية'] } },
    { q: 'ملفاتنا من غير تعويض Kerf. تفضّلوا إيه؟', opts: ['بنعوّض في البرنامج', 'ابعتوا الملف متعوّض بـ: ...... مم', 'مش فارق في القطع دي'] },
    { q: `خطوط القص عندنا خطوط مستقيمة قصيرة مرسومة من صورة (خطوة ${L(r2(1 / CUT_PX_PER_MM))} مم، وفي أكبر قطعة ${L(traceStep(big))} مم). الحرف بيطلع ناعم كده؟`, opts: ['مناسب', 'محتاجين Vector بأقواس', 'بنعيد الرسم (Trace) عندنا'], note: 'لو محتاجين Vector أصلي: بأنهي صيغة؟ والكلام يتحوّل لخطوط (Outlines)؟', lines: 1 },
    { q: `لون وتُخن خط القص: عندنا أحمر ${L(CUT_COLOUR)} وتُخن ${L(CUT_STROKE_MM)} مم. مناسب؟`, opts: ['مناسب', 'عايزين: ..........'] },
    { q: 'أرفع جزء وأضيق وصلة بين الحروف يستحملوا القص والشحن من غير ما يتكسروا (بالمم)', note: `عندنا الكلام بيتخّن ${L(oneBridge.join(' / '))} مم عشان الحروف تلزق في بعض، وبننبّه العميل لو ارتفاع الحرف أقل من ${L(MIN_CUT_LETTER_MM)} مم.`, table: { cols: ['الخامة', 'أرفع جزء (مم)', 'أقل ارتفاع حرف (مم)'], rows: ['خشب / أبلكاش 3 مم', 'أكريليك 3 مم', 'أكريليك مراية'] } },
    { q: 'الحتت الصغيرة (نقط الحروف، فتحات جوه الحروف): بتقع من شبكة الماكينة؟ بتمسكوها إزاي؟ وأصغر حتة تقدروا تسلّموها (بالمم)؟', note: `ملفنا بيشيل أي حتة أصغر من ${L(CUT_MIN_AREA_MM2)} مم² بس.`, lines: 2 },
    { q: 'حرق الحواف وأثر الدخان', opts: ['بنغطّي بورق لاصق (Masking)', 'هوا مساعد / شفط', 'بننضّف ونصنفر بعد القص', 'بيتسلّم زي ما هو'], note: 'شكل حرف القص على الخشب الفاتح والخشب الأبيض المدهون: بيبان بني أو أسود؟', lines: 1 },
    { q: 'الأكريليك المراية: بتقصّوه من الوش ولا من الضهر (معكوس)؟ الطلاء بيتقشّر أو بيتحرق عند الحرف؟ وورقة الحماية بتفضل لحد التسليم؟', lines: 2 },
    { q: 'ألوان الخشب عندنا: طبيعي، جوزي، أبيض. بتوفّروها خشب بلونه، ولا بتصبغوا / تدهنوا؟ والدهان قبل القص ولا بعده؟ وضهر القطعة بيتدهن؟', lines: 2 },
    { q: 'البازل: طريقة التنفيذ عندكم', opts: ['لوح مفرّغ + لوح خلفية ملزوقين', 'لوح واحد تخين والحروف بتعدّي', 'مابنعملوش'], note: 'تُخن الحروف المناسب لإيد الطفل، الخلوص بين الحرف ومكانه، وهل بتزوّدوا زرار (مسكة) لكل حرف؟', lines: 2 },
    { q: 'البازل وأي حاجة للأطفال: الدهان والورنيش آمنين للأطفال (شهادة EN71 أو ما يعادلها)؟ والحواف والأركان بتتصنفر؟', opts: ['أيوه', 'لأ'], lines: 1 },
    { q: 'القطع الواقفة: القاعدة الخشب بمجرى', opts: ['بنعملها ليزر', 'بنعملها CNC', 'بنوفّرها جاهزة', 'لأ'], note: 'مقاس القاعدة، عرض المجرى بالنسبة لتُخن القطعة (عشان تمسك من غير لزق)، وهل تفضّلوا القطعة يبقى ليها لسان من تحت؟', lines: 2 },
    { q: `شمعة الـ ${L('LED')} لزينة رمضان المضيئة: بتوفّروها؟ مقاسها، ومكانها في القاعدة (تجويف ولا ورا القطعة)؟`, opts: ['بنوفّرها', 'لأ'], lines: 1 },
    { q: 'توبر التورتة: العصاية (طول وعرض)، وهل الأكريليك والخشب مناسبين يتغرسوا في الأكل، ولا بتنصحوا بعصاية خشب منفصلة؟', lines: 2 },
    { q: 'التعليق لزينة رمضان: خرم (قطر كام ومكانه)، خيط أو شريطة منكم؟', lines: 1 },
    { q: 'ترتيب القطع على الفرخ (Nesting) لما يبقى فيه أكتر من طلب: بتعملوه أنتم؟ وبتحسبوا بالفرخ ولا بالقطعة ولا بدقيقة القص؟', lines: 2 },
    { q: 'اللزق والتجميع (بازل، قواعد): نوع اللزق، وبيسيب أثر على الأكريليك المراية؟', lines: 1 },
    { q: 'التغليف: القطع الرفيعة (توبر، أسماء) بتتغلّف إزاي عشان ماتتكسرش أو تتخدش في الشحن؟', opts: ['كرتون مقوّى', 'كيس + فوم', 'علبة', 'من غير'], lines: 1 },
  ],

  confirm: [
    ['ملف القص', `${L('SVG')} بالمليمتر، بالمقاس الحقيقي ${L('1:1')}، نقطة الصفر فوق شمال، مش معكوس`],
    ['خط القص', `أحمر ${L(CUT_COLOUR)}، تُخن ${L(CUT_STROKE_MM)} مم، من غير تعبئة، مسارات مقفولة`],
    ['تعويض الـ Kerf', 'مفيش: الخطوط على المقاس النهائي'],
    ['دقة رسم الخطوط', `مرسومة من صورة ${L(CUT_PX_PER_MM)} بيكسل لكل مم (خطوة ${L(r2(1 / CUT_PX_PER_MM))} مم)، وبحد أقصى ${L(CUT_MAX_PX)} بيكسل للضلع الطويل: أكبر قطعة ${WH(big.w, big.h)} خطوتها ${L(traceStep(big))} مم`],
    ['أصغر حتة في الملف', `أي حتة أصغر من ${L(CUT_MIN_AREA_MM2)} مم² بتتشال من الملف`],
    ['تخين الكلام عشان الحروف تلزق', `${ORDER.filter((id) => P(id).laser.pieces === 'one').map((id) => P(id).name.ar).join('، ')}: ${L(oneBridge.join(' / '))} مم. البازل: من غير تخين`],
    ['أصغر كلام مقصوص', `بننبّه العميل تحت ارتفاع حرف ${L(MIN_CUT_LETTER_MM)} مم (تنبيه بس، مش منع)`],
    ['توبر التورتة', `${sizes('caketopper')}، تُخن مبدئي ${L(thick('caketopper'))} مم`],
    ['زينة رمضان', `${sizes('ramadandecor')}، تُخن مبدئي ${L(thick('ramadandecor'))} مم`],
    ['زينة رمضان المضيئة', `${sizes('ramadanlight')}، تُخن مبدئي ${L(thick('ramadanlight'))} مم، في قاعدة خشب`],
    ['ستاند الأسماء', `${sizes('couplestand')}، تُخن مبدئي ${L(thick('couplestand'))} مم، في قاعدة خشب`],
    ['البازل', `${sizes('namepuzzle')}، اللوحة بأركان ${L(BOARD_RADIUS_MM)} مم، تُخن مبدئي ${L(thick('namepuzzle'))} مم، هامش الأمان ${L(mm(P('namepuzzle').sides[0].safeIn))} مم`],
  ],
};
