'use strict';
/*
 * Supplier pack: laser engraving (wood, acrylic, slate, leather, pens) and the two Ramadan lanterns.
 * Facts about the files come from src/laser.js (engravePng, cutSvg, laserSvg), src/app.js (FORMATS, laserSpec),
 * public/js/admin.js (FORMATS_BY_METHOD.engrave), public/js/editor.js (the laser checks), the products' `laser`
 * and `model` data in src/products.js, and docs/lanterns (README.md, lanterns.json: PROTOTYPE drawings).
 */
const L = (s) => `<span dir="ltr">${s}</span>`;
const WH = (w, h) => `عرض ${L(w)} × ارتفاع ${L(h)} سم`;
// Every size is read from the product data and the lantern numbers, so the pack can't drift from the code.
const { PRODUCTS, printWidthFor, printHeightFor } = require('../../src/products');
const LANTERNS = require('../../docs/lanterns/lanterns.json');
const P = (id) => PRODUCTS.find((p) => p.id === id);
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const mm = (inches) => String(Math.round((Number(inches) || 0) * 25.4));
const r1 = (n) => String(Math.round(n * 10) / 10);

// src/laser.js and src/app.js laserSpec (constants there are not exported).
const ENGRAVE_DPI = 254; // src/app.js laserSpec: dpi 254 (0.1 mm per dot)
const DOT_MM = r1(25.4 / ENGRAVE_DPI);
const CUT_COLOUR = '#ff0000'; // src/laser.js CUT_STYLE
const RAISED_COLOUR = '#0000ff'; // src/app.js FORMATS['layers-svg']
const CUT_STROKE_MM = 0.1; // src/laser.js CUT_STYLE
const MIN_ENGRAVED_LETTER_MM = 1.5; // public/js/editor.js: warning under this letter height
// The editor's export (public/js/editor.js exportPrint): 300 DPI, less when the file would pass the canvas limits.
const sourceDpi = (wIn, hIn) => Math.floor(Math.min(300, Math.sqrt(16e6 / (wIn * hIn)), 8000 / Math.max(wIn, hIn)));

/** The different sizes a product has (sizes that are only quantities share one), smallest first. */
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
const tag = (p, g, all) => (/^A\d$/.test(g.size.family || '') ? g.size.family : g === all[0] ? 'المقاس الصغير' : 'المقاس الكبير');
/** A product with two sizes shows both, each on its own line with its own numbers. */
function sidesOf(p) {
  const g = groups(p);
  if (g.length < 2) return p.sides;
  const s = p.sides[0];
  return g.map((f) => ({ ...s, name: { ...s.name, ar: `${s.name.ar} · ${tag(p, f, g)}` }, printWidthIn: f.wIn, printArea: { ...s.printArea, h: (s.printArea.w * f.hIn) / f.wIn } }));
}

/** What the laser does besides engraving: the board's outline (src/laser.js boardPath), or nothing on a ready-made piece. */
function cutText(p) {
  const l = p.laser;
  if (l.cut === 'rounded') return `اللوح بيتقص بنفس مقاس الحفر بالظبط، بأركان مدورة نص قطرها ${L(l.radiusMm)} مم (في كل المقاسات). خط القص في نفس ملف الحفر`;
  if (l.cut === 'arch') return 'اللوح بيتقص بنفس مقاس الحفر بالظبط على شكل قوس: الجوانب والقاعدة مستقيمة، ومن فوق نص دايرة بعرض اللوح كله. خط القص في نفس ملف الحفر';
  return 'حفر بس على قطعة جاهزة: الملف مفيهوش خط قص';
}
const blank = (p) => !p.laser.cut;
const thick = (id) => mm(P(id).model.depthIn);
const outer = (id) => { const [w, h] = P(id).model.outerIn; return WH(cm(w), cm(h)); };
const lantern = (id) => LANTERNS.models[id];
const sheet = (m) => `عرض ${L(m.sheetMm.w)} × طول ${L(m.sheetMm.h)} مم`;
const lanternRows = (id) => {
  const m = lantern(id);
  return [
    ['مقاس الفانوس', `عرض ${L(m.overallMm.W)} × عمق ${L(m.overallMm.D)} × ارتفاع ${L(m.overallMm.H)} مم (من الرجلين لآخر الحلقة)، والجسم عرض ${L(m.bodyMm.W)} × عمق ${L(m.bodyMm.D)} × ارتفاع ${L(m.bodyMm.H)} مم`],
    ['رسمة القص', `${L(m.parts)} قطعة على فرخ ${sheet(m)} (بيتقسّم على مساحة ماكينتكم)، خشب ${L(LANTERNS.params.thicknessMm)} مم`],
    ['اللوحة', `عرض ${L(m.plaqueMm.w)} × ارتفاع ${L(m.plaqueMm.h)} مم، بتتقص من رسمة الجسم. مساحة الاسم بتبدأ ${L(m.nameAreaMm.fromPlaqueTopMm)} مم تحت أول اللوحة وفي النص`],
    ['الإضاءة', `شمعة ${L('LED')} قطرها ${L(LANTERNS.params.ledDiaMm)} مم وارتفاعها ${L(LANTERNS.params.ledHeightMm)} مم، في تجويف قطره ${L(m.led.pocketDiaMm)} مم في القاعدة، وتحتها غطا بيتلف ${L('60°')} ويتشال (قطره ${L(m.led.bayonetDiaMm)} مم)`],
  ];
};
const PROTOTYPE = '<b>نموذج أولي:</b> رسمة الفانوس لسه ما اتنفذتش في أي ورشة. المقاسات والتعشيق محتاجين تأكيدكم قبل الإنتاج.';

const NOTES = {
  engrplaque: { material: `أكريليك شفاف رفيع، الحفر بيطلع أبيض مطفي، وبيقف على قاعدة خشب. التُخن اللي بنعرضه ${L(thick('engrplaque'))} مم (مبدئي)`, ask: 'تُخن الأكريليك المتاح عندكم؟ الحفر على الوش ولا من الضهر (معكوس)؟ والقاعدة الخشب بمجرى منكم؟ عرض المجرى كام؟' },
  engrcoasters: { material: 'كوسترز حجر إردواز أو خشب، بتتباع طقم (كل الطقم بنفس التصميم)', sizesLabel: 'الكميات', ask: 'الكوسترز الفاضية (إردواز وخشب) منكم؟ مقاسها بالظبط وشكلها (مربع ولا دايرة، حواف الإردواز مش منتظمة)؟ والحفر على الإردواز بيطلع فاتح وواضح؟' },
  engrtray: { material: `صينية خشب بإيدين، الحفر على الأرضية من جوه. مقاس الصينية الصغيرة من بره ${outer('engrtray')} تقريبًا`, ask: 'الصواني الفاضية منكم؟ الصينية بتدخل تحت راس الليزر وهي متجمّعة (ارتفاع الحافة)؟ ولا بتحفروا الأرضية قبل التجميع؟' },
  engrframe: { material: `برواز خشب، الحفر على الحافة العريضة اللي تحت الصورة. مقاس البرواز الصغير من بره ${outer('engrframe')} تقريبًا`, ask: 'البراويز الفاضية منكم؟ عرض الحافة اللي تحت كام سم في كل مقاس عشان نظبط مساحة الحفر عليها؟' },
  engrcardholder: { material: `حافظة كروت جلد طبيعي، مقاسها ${outer('engrcardholder')}`, ask: 'بتحفروا على الجلد الطبيعي ولا الصناعي (PU)؟ الحفر بيبان إزاي على الأسود والبني والعسلي؟ وفيه ريحة أو أثر دخان بعد الحفر؟' },
  weddingsign: { material: `لوحة على شكل قوس من أكريليك شفاف أو أسود أو خشب، ومعاها حامل. التُخن اللي بنعرضه ${L(thick('weddingsign'))} مم (مبدئي)`, ask: `المقاس الكبير ${size('weddingsign', 1)} بيدخل ماكينتكم قطعة واحدة؟ التُخن اللي تنصحوا بيه عشان اللوحة ماتتنيش على الحامل؟ والحفر على الأكريليك الأسود بيبان؟ والحامل منكم؟` },
  doorsign: { material: `يافطة خشب أو أكريليك أسود، جاهزة للتعليق. التُخن اللي بنعرضه ${L(thick('doorsign'))} مم (مبدئي)`, ask: 'التعليق بيتعمل إزاي عندكم (خرمين في الملف، لزق دبل فيس، علّاقة من ورا)؟ ملفنا دلوقتي مفيهوش خروم.' },
  engrpen: { material: `قلم جاف معدن مدهون (أسود، كحلي، دهبي) أو بامبو. طول القلم حوالي ${L(cm(P('engrpen').model.lengthIn))} سم وقطره حوالي ${L(mm(P('engrpen').model.diameterIn))} مم`, sizesLabel: 'الكميات', ask: 'الأقلام الفاضية منكم؟ بتحفروا المعدن المدهون بـ CO2 ولا فايبر؟ عندكم روتاري أو جيج للأقلام؟ وأقصى طول وارتفاع حفر على جسم القلم عندكم؟' },
  engrwallet: { material: `محفظة جلد طبيعي بتتقفل نصين، مقاسها مقفولة ${outer('engrwallet')} تقريبًا`, sizesLabel: 'الكميات', ask: 'المحافظ الفاضية منكم؟ الحفر على المحفظة وهي متخيّطة ممكن من غير ما الجلد يتحرق أو يتني؟' },
  woodinvite: { material: `كارت خشب بطبقتين: الكارت محفور عليه الكلام، وفوقه برواز ورد مقصوص طبقة تانية وملزوق. اللي بنعرضه: الكارت ${L(thick('woodinvite'))} مم والطبقة البارزة ${L(mm(P('woodinvite').model.raised))} مم (مبدئي، مش متأكد من أي ورشة)`, sizesLabel: 'الكميات', rows: [['الطبقتين', 'نفس التصميم بيطلع مرتين: صورة حفر للكارت، وحدود قص للطبقة البارزة (ملف الطبقتين). محتاجين رأيكم في الطريقة دي (قسم ٤)']], ask: 'أرفع خشب تقدروا تقصّوه وتحفروه من غير ما يتقوّس (قشرة، MDF، أبلكاش)؟ ولزق الطبقة البارزة على 100 كارت عملي عندكم؟' },
  familyfanous: { material: `فانوس خشب مربع بيتقص ليزر ويتجمّع تعشيق ولزق، وفي وشّه لوحة عليها هلال ونجمة محفورين. لكل طلب بيتغيّر اسم العيلة بس (سطر أو سطرين)`, hideSizes: true, rows: [...lanternRows('familyfanous'), ['', PROTOTYPE]], ask: 'تقدروا تقصّوا وتجمّعوا الفانوس كله عندكم (قص، لزق، تركيب الشمعة) وتسلّموه جاهز؟ وبتاخد القطعة وقت قد إيه؟' },
  arabesquelantern: { material: 'فانوس خشب بقوس مدبب وزخارف أرابيسك، بيتقص ليزر ويتجمّع تعشيق ولزق، وفي نص القوس لوحة صغيرة. لكل طلب بيتغيّر الاسم بس (سطر واحد)', hideSizes: true, rows: [...lanternRows('arabesquelantern'), ['', PROTOTYPE]], ask: 'الزخارف المفرّغة (أرفع جزء فيها مرسوم 3 مم بعد القص) بتطلع سليمة عندكم في خشب 3 مم؟ ولا تنصحوا بخامة أو تُخن تاني؟' },
};
const ORDER = ['engrplaque', 'doorsign', 'weddingsign', 'woodinvite', 'engrcoasters', 'engrtray', 'engrframe', 'engrcardholder', 'engrwallet', 'engrpen', 'familyfanous', 'arabesquelantern'];
const productNotes = {};
for (const id of ORDER) {
  const p = P(id);
  const n = NOTES[id];
  productNotes[id] = {
    ...n,
    dpi: ENGRAVE_DPI,
    hideSizes: n.hideSizes || !n.sizesLabel,
    rows: [...(lantern(id) ? [] : [['القص', cutText(p)]]), ...(n.rows || [])].map(([k, v]) => (k ? [k, v] : ['ملحوظة', v])),
  };
}
const cutBoards = ORDER.map(P).filter((p) => !blank(p));
const readyMade = ORDER.map(P).filter((p) => blank(p) && !lantern(p.id));
const biggest = groups(P('weddingsign')).pop();
const names = (list) => list.map((p) => p.name.ar).join('، ');

module.exports = {
  title: 'الحفر بالليزر',
  subtitle: 'بلاكات أكريليك، يفط ولوحات خشب، دعوات خشب، كوسترز، صواني وبراويز، جلد، أقلام، وفوانيس رمضان خشب',
  short: 'الحفر بالليزر',
  sizesWord: 'مساحات الحفر',
  jobSize: 'مقاس الحفر بالسنتيمتر',
  dpiLabel: 'دقة صورة الحفر',
  compact: true,
  products: ORDER,
  sidesOf,
  sectionTitle: 'المنتجات ومساحات الحفر',
  areaLabel: 'مساحة الحفر',
  areaLegend: 'مساحة الحفر (ولو اللوح بيتقص: هي مقاس اللوح نفسه)',
  sideLabel: 'المكان',
  coloursLabel: 'الخامة / اللون',

  filesIntro:
    'الحفر عندنا لون واحد: كل حاجة في التصميم (كلام، رسومات، صور) بتتحوّل لصورة حفر أبيض وأسود بالمقاس الحقيقي. الملفات بتطلع أوتوماتيك من تصميم العميل، ومفيش أي تكبير أو تصغير مطلوب منكم:',
  files: [
    { name: `ملف الليزر ${L('SVG')} (لـ ${L('LightBurn')})`, spec: `ملف واحد بالمقاس الحقيقي بالمليمتر (نقطة الصفر فوق شمال): صورة الحفر جوّاه (${L(`${ENGRAVE_DPI} DPI`)})، وفوقها خط قص اللوح لو المنتج بيتقص: خط أحمر ${L(CUT_COLOUR)} تُخنه ${L(CUT_STROKE_MM)} مم من غير تعبئة`, use: 'الملف الأساسي لكل الشغل' },
    { name: `صورة الحفر ${L('PNG')}`, spec: `أبيض وأسود بس (${L('1-bit')}): الأسود = الليزر شغّال، الأبيض = مطفي. ${L(`${ENGRAVE_DPI} DPI`)} يعني النقطة ${L(DOT_MM)} مم، والمقاس الحقيقي مكتوب جوه الملف`, use: 'لو برنامجكم مابيفتحش الـ SVG، أو بتحطوا الصورة بنفسكم' },
    { name: `خطوط القص ${L('SVG')}`, spec: `خط قص اللوح لوحده بالمليمتر، نفس الخط الأحمر. القطع الجاهزة (كوسترز، صواني، جلد، أقلام) ملفها مفيهوش خطوط`, use: 'لو بتقصّوا على ماكينة أو برنامج تاني' },
    { name: `ملفات الطبقة البارزة ${L('SVG')}`, spec: `لدعوة الخشب بس: ملف فيه حدود قص الطبقة البارزة (أحمر)، وملف «الطبقتين» فيه صورة الحفر + خط قص الكارت بالأحمر + حدود الطبقة البارزة بالأزرق ${L(RAISED_COLOUR)}`, use: 'الطبقة التانية اللي بتتلزق فوق الكارت' },
    { name: `التصميم ${L('PNG')} و ${L('PDF')}`, spec: `التصميم زي ما العميل شافه (بلون الحفر على خلفية شفافة)، بالمقاس الحقيقي`, use: 'للمراجعة والمقارنة، مش للماكينة' },
    { name: 'رسومات الفوانيس', spec: `لكل فانوس: رسمة كل القطع مفرودة ${L('SVG')} و ${L('DXF (R12)')} بمقاس ${L('1:1')} بالمليمتر، ورسمة تجميع، وملف تجربة التعشيق. الطبقات: ${L('CUT')} أحمر ${L(CUT_COLOUR)} ${L(CUT_STROKE_MM)} مم، ${L('ENGRAVE')} تعبئة سودا، ${L('SCORE')} أزرق (علامات أماكن اللزق)، ${L('NOTES')} رمادي (شرح، مابيتنفّذش)`, use: 'ثابتة لكل الطلبات. لكل طلب بييجي ملف الاسم بس' },
  ],
  filesNotes: [
    `<b>مهم:</b> الحفر صورة نقط (${L('Raster')}) مش ${L('Vector')}، والخطوط مش مطلوبة عندكم. الصور والظلال متحوّلة عندنا لنقط أبيض وأسود جاهزة (${L('Dither')})، والكلام والخطوط حوافها حادة. يعني المفروض الصورة تتحفر زي ما هي من غير ${L('Dither')} تاني في برنامجكم (سؤال في قسم ٤).`,
    `الملفات بالمقاس الحقيقي ${L('1:1')}: من غير تكبير أو «Fit to page»، ومن غير إعادة رسم لخطوط القص. الملف مش معكوس: لو شغلكم محتاج عكس (حفر الأكريليك من الضهر) قولوا لنا.`,
    'خطوط القص مرسومة على المقاس النهائي للقطعة <b>من غير تعويض عرض شعاع الليزر (Kerf)</b>: التعويض بيتظبط عندكم. رسومات الفوانيس بس هي اللي التعشيق فيها متعوّض (الرقم في قسم ٥).',
    'الملف فيه لون حفر واحد: مفيش درجات قوة مختلفة ولا أكتر من عمق. القوة والسرعة لكل خامة بتتظبط عندكم.',
    `الفوانيس: الاسم بييجي ملف ليزر ${L('SVG')} بمقاس مساحة الاسم بالظبط (صورة حفر من غير خطوط قص)، وبيتحط على المساحة المنقّطة المرسومة على اللوحة في رسمة الجسم.`,
  ],

  productsIntro: 'لو المنتج ليه مقاسين، كل مقاس في سطر. «هامش الأمان» هو المسافة اللي بنبعد بيها الكلام عن حرف القطعة. التُخن المكتوب «مبدئي» هو اللي بنعرضه للعميل في المعاينة ولسه ما اتأكدش من أي ورشة.',
  productNotes,

  priceRows: ['حفر على قطعة جاهزة (جلد / كوستر / قلم)', 'حفر وقص لوح لحد 30 × 15 سم', 'حفر وقص لوح 40 × 60 سم', 'دعوة خشب بطبقتين (الكارت الواحد في 50 كارت)', 'فانوس خشب مقصوص ومتجمّع بالإضاءة', 'سعر الخامة / القطعة الفاضية (لو منكم)'],

  questions: [
    { q: 'ماكينات الليزر عندكم: النوع، القدرة (وات) ومساحة الشغل لكل ماكينة', table: { cols: ['النوع', 'القدرة (وات)', 'مساحة الشغل (عرض × طول سم)', 'أقصى ارتفاع للقطعة تحت الراس (سم)'], rows: ['CO2', 'فايبر (Fiber)', 'دايود (Diode)', 'UV / غيره'] } },
    { q: 'البرنامج اللي بتشتغلوا بيه', opts: ['LightBurn', 'RDWorks', 'LaserGRBL', 'EZCAD (فايبر)', 'CorelDRAW', 'برنامج تاني: ..........'] },
    { q: 'صيغ الملفات اللي تفضّلوها', opts: ['SVG (صورة حفر + خط قص)', 'PNG للحفر + SVG للقص', 'DXF للقص', 'PDF', 'AI / CDR', 'صيغة تانية: ..........'], note: `ملف الـ SVG بتاعنا مقاسه بالمليمتر. بيتفتح عندكم بالمقاس الصح من غير ما تعدّلوا حاجة؟`, lines: 1 },
    { q: `الفصل بين القص والحفر: عندنا القص خط أحمر ${L(CUT_COLOUR)} تُخنه ${L(CUT_STROKE_MM)} مم، والحفر صورة سودا، والأزرق ${L(RAISED_COLOUR)} للطبقة التانية أو علامات اللزق. ده مناسب لطريقة شغلكم؟`, opts: ['مناسب', 'عايزين ألوان / طبقات تانية: ..........'], lines: 1 },
    { q: `دقة الحفر: صورتنا ${L(`${ENGRAVE_DPI} DPI`)} (النقطة ${L(DOT_MM)} مم). مناسبة لعدسة ماكينتكم؟ وإيه الدقة اللي بتشتغلوا بيها على الخشب، الأكريليك، الجلد والإردواز؟`, lines: 2 },
    { q: `الصور والظلال: بنبعتها متحوّلة لنقط أبيض وأسود (${L('Floyd–Steinberg dither')}). تحفروها زي ما هي، ولا تفضّلوا صورة رمادي (${L('Grayscale')}) وتعملوا التحويل بنفسكم؟`, opts: ['زي ما هي (Pass-through / Threshold)', 'ابعتوا Grayscale', 'مابنحفرش صور'], note: 'والخامات اللي الصور بتطلع عليها كويس عندكم، واللي مابتنصحوش بيها.', lines: 1 },
    { q: 'الخامات المتوفرة عندكم دايمًا', table: { cols: ['الخامة', 'متوفرة؟', 'التُخانات (مم)', 'الألوان / الأنواع'], rows: ['أبلكاش (زان / حور / بتولا)', 'MDF خام / مدهون', 'خشب طبيعي (زان، جوز، أرو)', 'أكريليك شفاف', 'أكريليك أسود / أبيض / ملوّن', 'جلد طبيعي / صناعي (PU)', 'إردواز (Slate)'] } },
    { q: 'القطع الجاهزة اللي بتوفّروها فاضية', opts: ['كوسترز إردواز', 'كوسترز خشب', 'صواني خشب', 'براويز خشب', 'حافظات كروت جلد', 'محافظ جلد', 'أقلام معدن', 'أقلام بامبو'], note: 'اكتبوا مقاس كل قطعة بالظبط (ومكان ومساحة الحفر المتاحة عليها) عشان نظبط مساحاتنا عليها.', lines: 3 },
    { q: 'ألوان الخشب عندنا: طبيعي، جوزي، أبيض. بتوفّروها خشب بلونه، ولا بتصبغوا / تدهنوا؟ والدهان قبل الحفر ولا بعده؟', lines: 2 },
    { q: 'الحفر على الأكريليك الشفاف: على الوش ولا من الضهر (معكوس)؟ وعلى الأكريليك الأسود: الحفر بيبان بوضوح، ولا بتملوه لون؟', lines: 2 },
    { q: 'الحفر على الجلد', opts: ['جلد طبيعي', 'جلد صناعي (PU)', 'مابنحفرش جلد'], note: 'شكل الحفر على الغامق والفاتح، الريحة وأثر الدخان، والحفر على قطعة متخيّطة جاهزة (حافظة كروت، محفظة).', lines: 2 },
    { q: 'الأقلام: بتحفروا على المعدن المدهون والبامبو؟', opts: ['فايبر على المعدن', 'CO2 بيشيل الدهان', 'روتاري (ملحق دوّار)', 'جيج لعدد أقلام مع بعض', 'لأ'], note: `مساحتنا على جسم القلم ${size('engrpen')}. لون الحفر بيطلع إيه على الأسود والكحلي والدهبي؟ وكام قلم في الساعة؟`, lines: 2 },
    { q: 'القطع الصغيرة والجاهزة (كوسترز، جلد، أقلام): بتظبطوا مكان الحفر إزاي (جيج، كاميرا، إطار تجريبي)؟ ونسبة الخطأ في المكان (± كام مم)؟', lines: 2 },
    { q: `عرض شعاع الليزر (Kerf) عندكم لكل خامة وتُخن؟ ملفاتنا من غير تعويض: بتعوّضوه أنتم في البرنامج؟`, opts: ['بنعوّض في البرنامج', 'ابعتوا الملف متعوّض بـ: ...... مم', 'مش فارق في القطع دي'], lines: 2 },
    { q: `أصغر كلام وأرفع خط بيطلعوا واضحين في الحفر على كل خامة (بالمم)`, note: `عندنا بننبّه العميل لو ارتفاع الحرف أقل من ${L(MIN_ENGRAVED_LETTER_MM)} مم.`, table: { cols: ['الخامة', 'أقل ارتفاع حرف (مم)', 'أرفع خط (مم)'], rows: ['خشب / أبلكاش', 'أكريليك', 'جلد', 'إردواز', 'قلم معدن'] } },
    { q: 'عمق الحفر ودرجة اللون: بتحفروا مرة واحدة ولا أكتر؟ وتقدروا تثبّتوا نفس الدرجة بين قطعة وقطعة في نفس الطلب؟', lines: 2 },
    { q: 'أثر الدخان والحرق حوالين الحفر والقص', opts: ['بنغطّي بورق لاصق (Masking)', 'بننضّف بعد الحفر', 'بنصنفر الحواف', 'شفط دخان / هوا مساعد'], note: 'وشكل حرف القص على الخشب (بني غامق / أسود) مقبول يتسلّم كده ولا بيتنضّف؟', lines: 1 },
    { q: 'التشطيب بعد الحفر', opts: ['ورنيش / لاكيه', 'زيت خشب', 'تلميع حواف الأكريليك', 'من غير تشطيب'], lines: 1 },
    { q: `دعوة الخشب بطبقتين: الكارت محفور وفوقه طبقة مقصوصة ملزوقة. بتعملوا القص واللزق عندكم؟`, opts: ['قص ولزق', 'قص بس', 'لأ'], note: `الملف بيدّي نفس التصميم حفر على الكارت وحدود قص للطبقة البارزة. تفضّلوا تحفروا مكان الطبقة على الكارت كعلامة لزق، ولا تعلّموها بخط خفيف (Score)، ولا من غير علامة؟ وأرفع جزء في الطبقة البارزة يستحمل القص واللزق كام مم؟`, lines: 3 },
    { q: 'القواعد والحوامل: قاعدة خشب بمجرى للبلاك الأكريليك، وحامل للوحة الترحيب. بتعملوها أو بتوفّروها؟', opts: ['بنعملها', 'بنوفّرها جاهزة', 'لأ'], note: 'عرض المجرى بيتظبط على تُخن اللوح إزاي؟', lines: 1 },
    { q: 'الفوانيس: تقدروا تقصّوا ملف تجربة التعشيق بتاعنا على خشبكم وتبعتوا لنا أنهي فتحة دخلت مظبوط؟', opts: ['أيوه', 'لأ'], note: `الملف فيه فتحات من ${L('2.8')} لـ ${L('3.4')} مم ولسان ${L('10')} مم وزوج تعشيق. الرسمة دلوقتي على خشب ${L(LANTERNS.params.thicknessMm)} مم وفتحة ${L(LANTERNS.params.slotMm)} مم و Kerf ${L(LANTERNS.params.kerfMm)} مم، وبنعدّلها على قياسكم.`, lines: 2 },
    { q: 'الفوانيس: التُخن الحقيقي لخشب الـ 3 مم عندكم (بيبقى من 2.7 لـ 3.2)، ونوعه', opts: ['أبلكاش بتولا', 'أبلكاش حور', 'MDF', 'غيره: ..........'], lines: 1 },
    { q: 'الفوانيس: التجميع', opts: ['بنقص ونجمّع ونلزق', 'بنقص بس', 'لأ'], note: `كل فانوس ${L(lantern('familyfanous').parts)} أو ${L(lantern('arabesquelantern').parts)} قطعة: جدران بتعشيق، قاعدة، قبة من أوجه مستوية ملزوقة، وحلقة تعليق. الوقت المتوقع للفانوس الواحد، ونوع اللزق؟`, lines: 2 },
    { q: `الفوانيس: شمعة الـ ${L('LED')}: بتوفّروها؟ مقاس المتاح عندكم (القطر × الارتفاع) ومكان المفتاح والبطارية`, note: `الرسمة دلوقتي على شمعة قطرها ${L(LANTERNS.params.ledDiaMm)} مم وارتفاعها ${L(LANTERNS.params.ledHeightMm)} مم.`, lines: 2 },
    { q: `الفوانيس: الفرخ المرسوم عرضه ${L(lantern('familyfanous').sheetMm.w)} مم وطوله ${L(lantern('familyfanous').sheetMm.h)} أو ${L(lantern('arabesquelantern').sheetMm.h)} مم. بتقسّموه على مساحة ماكينتكم بنفسكم، ولا نبعته متقسّم على مقاس معيّن؟`, opts: ['بنقسّمه', 'ابعتوه على مقاس: ..........'] },
    { q: 'تغليف القطع اللي بتتكسر أو بتتخدش (أكريليك، إردواز، فوانيس متجمّعة): بتغلّفوها إزاي للتسليم؟', lines: 2 },
  ],

  confirm: [
    ['ملف الليزر', `${L('SVG')} بالمليمتر، بالمقاس الحقيقي ${L('1:1')}، نقطة الصفر فوق شمال، مش معكوس`],
    ['صورة الحفر', `أبيض وأسود ${L('1-bit')}، الأسود = حفر، ${L(`${ENGRAVE_DPI} DPI`)} (النقطة ${L(DOT_MM)} مم). الصور متحوّلة ${L('Floyd–Steinberg')}`],
    ['خط القص', `أحمر ${L(CUT_COLOUR)}، تُخن ${L(CUT_STROKE_MM)} مم، من غير تعبئة. الأزرق ${L(RAISED_COLOUR)} = الطبقة البارزة أو علامات لزق (مش قص في اللوح)`],
    ['تعويض الـ Kerf', `مفيش في ملفات الطلبات. في رسومات الفوانيس: ${L(LANTERNS.params.kerfMm)} مم في التعشيق`],
    ['أصغر كلام محفور', `بننبّه العميل تحت ارتفاع حرف ${L(MIN_ENGRAVED_LETTER_MM)} مم (تنبيه بس، مش منع)`],
    ['دقة تصميم العميل قبل التحويل', `${L('300 DPI')} للقطع الصغيرة. الكبيرة أقل: لوحة الترحيب ${WH(biggest.w, biggest.h)} حوالي ${L(`${sourceDpi(biggest.wIn, biggest.hIn)} DPI`)} وبتتكبّر لـ ${L(ENGRAVE_DPI)}`],
    ['ألواح بتتقص مع الحفر', cutBoards.map((p) => `${p.name.ar}: ${sizes(p.id)}`).join('<br>')],
    ['شكل القص', `بلاك الأكريليك أركان ${L(P('engrplaque').laser.radiusMm)} مم، يافطة الباب ${L(P('doorsign').laser.radiusMm)} مم، دعوة الخشب ${L(P('woodinvite').laser.radiusMm)} مم. لوحة الترحيب قوس: نص دايرة بعرض اللوح من فوق`],
    ['مساحة الحفر على القطع الجاهزة', readyMade.map((p) => `${p.name.ar}: ${sizes(p.id)}`).join('<br>')],
    ['هامش الأمان', `من ${L(r1(Math.min(...ORDER.map((id) => P(id).sides[0].safeIn)) * 25.4))} مم (القلم) لـ ${L(mm(P('weddingsign').sides[0].safeIn))} مم (لوحة الترحيب)، مكتوب عند كل منتج`],
    ['تُخانات مبدئية', `بلاك أكريليك ${L(thick('engrplaque'))} مم، لوحة الترحيب ${L(thick('weddingsign'))} مم، يافطة الباب ${L(thick('doorsign'))} مم، دعوة الخشب ${L(thick('woodinvite'))} مم + طبقة بارزة ${L(mm(P('woodinvite').model.raised))} مم`],
    ['الفوانيس (نموذج أولي)', `خشب ${L(LANTERNS.params.thicknessMm)} مم، الفتحة مرسومة ${L(LANTERNS.params.slotMm)} مم، أرفع جزء في الزخارف ${L(LANTERNS.params.minWebMm)} مم بعد القص، والقطع بعيدة عن بعض ${L('7')} مم`],
    ['مقاس الفوانيس', ['familyfanous', 'arabesquelantern'].map((id) => `${P(id).name.ar}: عرض ${L(lantern(id).overallMm.W)} × عمق ${L(lantern(id).overallMm.D)} × ارتفاع ${L(lantern(id).overallMm.H)} مم، والفرخ ${sheet(lantern(id))}`).join('<br>')],
    ['مساحة الاسم على الفوانيس', ['familyfanous', 'arabesquelantern'].map((id) => `${P(id).name.ar}: ${size(id)}`).join('<br>')],
    ['شمعة الفانوس', `${L('LED')} قطر ${L(LANTERNS.params.ledDiaMm)} مم وارتفاع ${L(LANTERNS.params.ledHeightMm)} مم، التجويف ${L(LANTERNS.params.ledPocketMm)} مم`],
  ],
};
