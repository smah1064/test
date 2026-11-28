'use strict';
/*
 * Supplier pack: paper printing (digital press / offset): cards, flyers, stickers, envelopes, notebooks, books,
 * calendars, folders, photo prints, magnets. Facts about the files come from src/printfiles.js (printPdf, cmykTiff,
 * bookletPdf), src/app.js (FORMATS, makeMergeFile, photosZip), src/books.js and public/js/admin.js (FORMATS_BY_METHOD).
 */
const L = (s) => `<span dir="ltr">${s}</span>`;
const WH = (w, h) => `عرض ${L(w)} × ارتفاع ${L(h)} سم`;
// Every size is read from the product data, so the pack can't drift from what is sold.
const { PRODUCTS, printWidthFor, printHeightFor } = require('../../src/products');
const P = (id) => PRODUCTS.find((p) => p.id === id);
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const mm = (inches) => String(Math.round((Number(inches) || 0) * 25.4 * 10) / 10);
const names = (list) => list.map((p) => p.name.ar).join('، ');

// The editor's export (public/js/editor.js exportPrint): 300 DPI, less when the file would pass the canvas limits.
const dpiOf = (wIn, hIn, b) => Math.floor(Math.min(300, Math.sqrt(16e6 / ((wIn + 2 * b) * (hIn + 2 * b))), 8000 / Math.max(wIn + 2 * b, hIn + 2 * b)));
/** One side's print size for one size option (photo prints: the size's own cm). */
function facts(p, side, size) {
  const own = p.kind === 'photoset' && size.cm;
  const wIn = own ? size.cm[0] / 2.54 : printWidthFor(p, side, size.id);
  const hIn = own ? size.cm[1] / 2.54 : printHeightFor(p, side, size.id);
  return { wIn, hIn, w: cm(wIn), h: cm(hIn), dpi: dpiOf(wIn, hIn, Number(side.bleedIn) || 0) };
}
/** The different print sizes a product has (sizes that are only quantities share one), smallest first. */
function groups(p) {
  if (p.pattern) return [];
  const side = p.sides[0];
  const out = [];
  for (const size of p.sizes) {
    const f = facts(p, side, size);
    if (out.some((g) => g.w === f.w && g.h === f.h)) continue;
    const a = [size.family, size.id].find((v) => /^A\d$/.test(v || ''));
    out.push({ ...f, size, label: a || '' });
  }
  return out.sort((x, y) => x.wIn - y.wIn);
}
const size = (id, sizeId, sideId) => {
  const p = P(id);
  const f = facts(p, p.sides.find((s) => !sideId || s.id === sideId), p.sizes.find((z) => !sizeId || z.id === sizeId));
  return WH(f.w, f.h);
};
const sizeDpi = (id, sizeId) => { const p = P(id); return facts(p, p.sides[0], p.sizes.find((z) => z.id === sizeId)).dpi; };

/**
 * What the product block shows: a size that changes the print gets its own line where there is room (one side, two
 * sizes); otherwise the block shows the one size named in the side's title and a row lists the others (sizeRow).
 */
function sidesOf(p) {
  if (p.pattern) {
    const big = Math.max(...p.pattern.tiles);
    return p.sides.map((s) => ({ ...s, name: { ...s.name, ar: `${s.name.ar} · أكبر مقاس` }, printWidthIn: big / 2.54 }));
  }
  if (p.paged) return [{ ...p.sides[0], name: { ...p.sides[0].name, ar: 'كل صفحة (الغلاف والصفحات اللي جوه)' } }];
  const g = groups(p);
  if (g.length < 2) return p.sides;
  const shaped = (s, f, tag) => ({ ...s, name: { ...s.name, ar: `${s.name.ar} · ${tag}` }, printWidthIn: f.wIn, printArea: { ...s.printArea, h: (s.printArea.w * f.hIn) / f.wIn } });
  const tag = (f) => f.label || (f === g[0] ? 'المقاس الصغير' : f === g[g.length - 1] ? 'المقاس الكبير' : 'مقاس وسط');
  if (p.sides.length === 1 && g.length === 2) return g.map((f) => shaped(p.sides[0], f, tag(f)));
  const base = p.kind === 'photoset' ? g[0] : g.find((f) => f.wIn === printWidthFor(p, p.sides[0], f.size.id) && !f.size.printScale) || g[0];
  return p.sides.map((s) => shaped(s, base, tag(base)));
}
function sizeRow(p) {
  const g = groups(p);
  if (g.length < 2 || (p.sides.length === 1 && g.length === 2)) return [];
  return [['مقاس الطباعة لكل مقاس', g.map((f) => `${f.label ? `${L(f.label)}: ` : ''}${WH(f.w, f.h)} · ${L(`${f.dpi} DPI`)}`).join('<br>')]];
}
const option = (id, optId) => P(id).options.find((o) => o.id === optId).choices.map((c) => c.name.ar).join(' / ');
const book = (id) => { const { BOOKS, printPages } = require('../../src/books'); const b = BOOKS[P(id).book]; return { pages: b.pages.length, printed: printPages(b).length }; };
const bookRow = (id) => { const b = book(id); return ['الصفحات', `${L(b.pages)} صفحة بالغلافين${b.printed > b.pages ? ` (في ملف الطباعة ${L(b.printed)}: صفحة بيضا قبل الغلاف الخلفي عشان العدد يبقى زوجي)` : ''}`]; };

const QTY = 'الكميات';
const MAXN = L(P('invitations').merge.maxRows);
const NOTES = {
  // Cards
  bizcards: { material: 'كارت 350 جرام، وجه أو وجهين', sizesLabel: QTY, rows: [['السلوفان (اختياري)', option('bizcards', 'lamination')]] },
  postcards: { material: 'كارت 350 جرام، وجه أو وجهين', sizesLabel: QTY },
  giftvouchers: { material: 'كارت 350 جرام، وجه أو وجهين', sizesLabel: QTY, rows: [['السلوفان (اختياري)', option('giftvouchers', 'lamination')]] },
  bookmarks: { material: 'كارت 350 جرام، وجه أو وجهين، بخرم وشرّابة دهبي', sizesLabel: QTY, ask: 'الخرم والشرّابة: بتعملوهم عندكم؟ مكان الخرم وقطره كام عشان نبعد التصميم عنه؟' },
  invitations: { material: 'كارت 350 جرام، وجه أو وجهين، ومعاه ظرف أبيض', hideSizes: true, rows: [['أسماء المعازيم', `اسم مختلف على كل كارت (لحد ${MAXN} اسم): بنبعت PDF فيه صفحة لكل اسم`]], ask: 'الورق اللؤلؤي والكريمي والكرافت متاح عندكم بوزن 350 جرام؟ والظروف البيضا المناسبة لمقاس الكارت منكم؟' },
  greetingcard: { material: 'كارت مقوّى مطفي بيتطوي، الطباعة على الغلاف بس والجوه فاضي، ومعاه ظرف أبيض', hideSizes: true, ask: 'ملفنا هو وش الغلاف بس (مش الفرخ المفرود). تحبوا نبعته مفرود على الفرخ كله (الضهر + الغلاف) بمكان التكسير؟ ووزن الكارت اللي تنصحوا بيه؟' },
  foldedcards: { material: 'كارت 300 جرام، A5 بيتطوي A6، مطبوع الغلاف والصفحة اللي جوه، ومعاه ظرف أبيض', sizesLabel: QTY, ask: 'بنبعت ملفين بمقاس A6: الغلاف والصفحة اللي جوه (مش الفرخ A5 المفرود). تحبوا نركّبهم إحنا على الفرخ المفرود وشين، ولا بتركّبوهم أنتم؟' },
  tablenumbers: { material: 'كارت ستاند 350 جرام بيتطوي ويقف على الترابيزة، وجه أو وجهين', hideSizes: true, rows: [['الأرقام / الأسماء', `رقم أو اسم مختلف على كل كارت من قائمة العميل (لحد ${MAXN}): صفحة لكل كارت`]], ask: 'ملفنا هو الوش بمقاسه بعد الطي (والوش التاني لو مطلوب). بتركّبوا الوشين على الكارت المفرود وتكسّروه أنتم؟' },
  placecards: { material: 'كارت ستاند صغير 350 جرام بيتطوي، وجه أو وجهين', hideSizes: true, rows: [['أسماء المعازيم', `اسم مختلف على كل كارت (لحد ${MAXN} اسم): صفحة لكل اسم`]], ask: 'نفس سؤال أرقام الترابيزات: التركيب على الكارت المفرود والتكسير عندكم؟' },
  certificates: { material: 'كارت 300 جرام، بالعرض، وجه واحد', hideSizes: true, rows: [['الأسماء', `اسم مختلف على كل شهادة من قائمة العميل (لحد ${MAXN}): صفحة لكل اسم`]] },
  menus: { material: 'كارت 300 جرام، مطبوع وشين', sizesLabel: 'المقاسات والكميات', rows: [['السلوفان (اختياري، على الوشين)', option('menus', 'lamination')]] },
  // Flyers, brochures, stationery
  flyers: { material: 'ورق 150 جرام ساتان أو لامع، وجه أو وجهين', sizesLabel: 'المقاسات والكميات' },
  brochures: { material: 'ورق 170 جرام ساتان أو لامع، A4 بيتطوي 3 طيّات (يبقى 10 × 21 سم)، مطبوع وشين', sizesLabel: QTY, ask: 'ملفنا A4 كامل لكل وش من غير علامات تكسير، والتلات أجزاء متساوية في التصميم. بتحتاجوا الجزء اللي بيدخل جوه أقصر كام مم؟ والطي عندكم ماكينة؟' },
  letterhead: { material: 'ورق A4 وزن 100 جرام، وجه واحد، من غير زيادة قص', sizesLabel: QTY },
  dlenvelopes: { material: 'ظرف DL (11 × 22 سم)، الطباعة على الوش بس، من غير زيادة قص', sizesLabel: QTY, ask: 'بتطبعوا على ظروف جاهزة ولا على فرخ وبعدين تتقص وتتلزق؟ وأقل مسافة للطباعة من حرف الظرف؟' },
  eidenvelopes: { material: 'ظرف عيدية صغير، الطباعة على الوش بس', sizesLabel: 'الباكتات', ask: 'الظرف بيتعمل عندكم (طباعة فرخ + قص بفورمة + لزق) ولا بتطبعوا على ظروف جاهزة؟ والألوان الدهبي والأخضر والأحمر: ورق ملوّن ولا أرضية مطبوعة؟' },
  folders: { material: 'كارت 350 جرام، فولدر A4 (22 × 31 سم مقفول) بجيب من جوه ومكان لكارت شخصي؛ التصميم هو البرّه كله مفرود (الوش + الضهر)', sizesLabel: QTY, rows: [['السلوفان (اختياري)', option('folders', 'lamination')]], ask: 'عندكم فورمة (Die) جاهزة لفولدر بجيب؟ ابعتوا لنا رسمة الفورمة بمقاساتها عشان نظبط ملفنا عليها. والجيب بيتطبع ولا سادة؟' },
  notepads: { material: 'بلوك نوت 50 ورقة، ورق 80 جرام بضهر كرتون، متقفل بالغِرا، نفس التصميم على كل ورقة', sizesLabel: 'المقاسات والكميات', ask: 'الغِرا من فوق ولا من الجنب؟ وسُمك كرتون الضهر عندكم؟' },
  invoicebook: { material: 'دفتر A5 ورق كربوني (NCR)، 50 نسخة مرقّمة في الدفتر، من غير زيادة قص', sizesLabel: QTY, rows: [['النُسخ', 'نسختين (أبيض + بمبي) أو 3 نسخ (أبيض + بمبي + أصفر)']], ask: 'الترقيم: بتعملوه أنتم (ماكينة ترقيم)؟ محتاجين مننا رقم البداية ومكان الرقم على الورقة؟ والتجليد غِرا ولا دبوس مع تخريم (Perforation)؟' },
  // Stickers and labels
  stickersheet: { material: 'فينيل لامع ضد المياه، مقصوص حوالين الأشكال (Kiss-cut)', hideSizes: true, ask: 'ملفنا مفيهوش خط قص: بتطلّعوا خط القص حوالين الأشكال من الملف عندكم (Contour)؟ ولا محتاجينه مننا كطبقة منفصلة؟' },
  namelabels: { material: 'ستيكر ضد المياه بحواف مدورة، نفس التصميم على كل الستيكرات (أو اسم مختلف من قائمة)', sizesLabel: 'الباكتات', ask: 'بنبعت ملف ستيكر واحد بمقاسه: التكرار على الشيت والقص عندكم؟ ونص قطر الدوران المتاح كام؟' },
  logostickers: { material: 'ستيكر دايرة قطرها 5 سم، لامع ضد المياه: أبيض أو شفاف أو كرافت', sizesLabel: QTY, ask: 'على الشفاف والكرافت: عندكم حبر أبيض؟ ولو لأ، الألوان بتطلع إزاي؟' },
  labels: { material: 'ليبل مستطيل بحواف مدورة: ورق أبيض لامع، فينيل أبيض ضد المياه، فينيل شفاف أو كرافت', sizesLabel: 'المقاسات والكميات', rows: [['طريقة التسليم', option('labels', 'delivery')]], ask: 'بتسلّموا على رول؟ قطر البكرة واتجاه اللف والمسافة بين الليبلز كام؟ وأقل كمية للرول؟' },
  magnets: { material: 'مغناطيس تلاجة: طباعة لامعة أو مطفية على ضهر مغناطيس، بحواف مدورة', sizesLabel: 'المقاسات والكميات', rows: [['الوش', `${option('magnets', 'finish')} (أكريليك شفاف 3 مم فوق الطباعة)`]], ask: 'بتطبعوا على ورق وتلزقوه على شيت مغناطيس، ولا طباعة مباشرة؟ سُمك المغناطيس كام؟ والوش الأكريليك 3 مم متاح عندكم؟' },
  // Bound products
  notebook: { material: 'كشكول A5 سلك، غلاف مقوّى مطبوع (أمامي وخلفي)، 120 صفحة جوه', sizesLabel: 'الصفحات اللي جوه', ask: 'الصفحات اللي جوه (مسطّرة / منقّطة / سادة) جاهزة عندكم؟ السلك من الجنب: كام مم نسيبهم فاضيين في الغلاف عند الخرم؟ ووزن ورق الغلاف والجوه عندكم؟' },
  booklets: { material: 'كتيب A5 دبوس من النص: ورق 115 جرام جوه وغلاف 250 جرام (مطفي أو لامع)', sizesLabel: 'عدد الصفحات × النسخ', rows: [['الصفحات', `${[...new Set(P('booklets').sizes.map((z) => z.pages))].map((n) => L(n)).join(' أو ')} صفحة بالغلاف`], ['التدبيس', option('booklets', 'binding')], ['الملف', 'مترتب للطباعة والتدبيس (كل صفحتين على فرخ)، أو كل الصفحات بالترتيب']] },
  storybook: { material: 'كتاب أطفال 20 × 20 سم، ألوان كاملة، غلاف عادي أو مقوّى', sizesLabel: 'الغلاف', rows: [bookRow('storybook')], ask: 'الملف صفحات مفردة بالترتيب (الغلاف الأمامي أول صفحة والخلفي آخر صفحة)، من غير كعب. الغلاف المقوّى بتعملوه إزاي من الملف ده، ومحتاجين غلاف مفرود بكعب؟' },
  coloringbook: { material: 'كتاب تلوين 20 × 20 سم: غلاف ملون وصفحات خطوط سودا للتلوين، غلاف عادي أو مقوّى', sizesLabel: 'الغلاف', rows: [bookRow('coloringbook')], ask: 'ورق الصفحات اللي جوه لازم يكون مطفي (غير مصقول) عشان التلوين: المتاح عندكم إيه وبأي وزن؟' },
  photobook: { material: 'ألبوم صور بغلاف مقوّى وجيوب جاهزة لصور 10 × 15 (100 أو 200 صورة)؛ المطبوع هو الغلاف بس، مطفي أو لامع', hideSizes: true, ask: 'بتوفّروا الألبوم نفسه وتطبعوا غلافه؟ الغلاف بيتلف على الكرتون (محتاج زيادة للتني كام مم) ولا بيتلزق فوقه؟' },
  calendar: { material: 'نتيجة حائط: كارت A3 مقوّى مطبوع كله (مطفي أو لامع)، ومتدبّس على نصه اللي تحت بلوك 12 شهر، بشريط معدن وعلّاقة', sizesLabel: QTY, ask: 'ملفنا هو الكارت A3 بس. بلوك الشهور (عربي وإنجليزي) جاهز عندكم ومقاسه كام؟ والشريط المعدن والعلّاقة عندكم؟ ووزن الكارت؟' },
  deskcalendar: { material: 'نتيجة مكتب ستاند: 13 ورقة (غلاف و12 شهر) بسلك على قاعدة مقوّاة؛ تصميم العميل على نص كل ورقة والشهر على النص التاني', sizesLabel: QTY, ask: 'ملفنا هو نص الورقة بتاع التصميم بس (نفسه على كل الورق). عندكم قالب الشهور الـ 12 (عربي وإنجليزي) تركّبوه جنبه؟ ولا نبعت إحنا الـ 13 ورقة كاملين؟ ومقاس الورقة والقاعدة عندكم؟' },
  // Posters, photos, wrapping paper
  poster: { material: 'ورق مطفي عالي الجودة جوه إطار جاهز للتعليق (أسود، أبيض، خشب فاتح أو غامق)', hideSizes: true, ask: 'بتوفّروا الإطارات بالمقاسين والألوان دي؟ ونوع ووزن الورق المطفي اللي بتطبعوا عليه البوسترات؟' },
  photoprints: { material: 'ورق فوتوغرافي لامع أو مطفي', rows: [['الملفات', `ملف ZIP: فولدر لكل مقاس، كل صورة JPEG بمقاسها على ${L('300 DPI')}، وعدد النسخ في اسم الملف، ومعاه قائمة ${L('list.csv')}`], ['الإطار', `${option('photoprints', 'border')} (${L(P('photoprints').photo.borderMm)} مم)`], ['الكمية', `لحد ${L(P('photoprints').photo.maxPhotos)} صورة في الطلب و ${L(P('photoprints').photo.maxCopies)} نسخة من الصورة`]], ask: 'بتطبعوا على معمل صور (Minilab) ولا Inkjet؟ الصور بتتطبع من غير حواف (Borderless) بكام مم بيتقص من كل ناحية؟ والإطار الأبيض بتعملوه أنتم؟' },
  wrappingpaper: { material: 'فرخ ورق تغليف مطبوع بنقشة متكررة: أبيض لامع، أبيض مطفي أو كرافت', sizesLabel: 'الكميات', rows: [['الفرخ', WH(...P('wrappingpaper').sizes[0].cm)], ['وحدة النقشة', `مربع بيتكرر على الفرخ كله، مقاسه ${P('wrappingpaper').pattern.tiles.map((t) => L(t)).join(' أو ')} سم حسب اختيار العميل`], ['طريقة التكرار', 'عادي، نص نزلة، زي الطوب أو معكوس (بتتكتب في بيانات الشغلانة)'], ['الملفات', 'ملف وحدة النقشة (PNG / PDF) + صورة JPEG للفرخ كله للمراجعة بس (دقتها قليلة، مش للطباعة)']], ask: 'بتكرّروا الوحدة على الفرخ عندكم، ولا لازم نبعت الفرخ كله ملف واحد جاهز؟ ووزن ورق التغليف المتاح؟ وأكبر فرخ بتطبعوه؟' },
};
const ORDER = [
  'bizcards', 'postcards', 'giftvouchers', 'bookmarks', 'invitations', 'greetingcard', 'foldedcards', 'tablenumbers', 'placecards', 'certificates', 'menus',
  'flyers', 'brochures', 'letterhead', 'dlenvelopes', 'eidenvelopes', 'folders', 'notepads', 'invoicebook',
  'stickersheet', 'namelabels', 'logostickers', 'labels', 'magnets',
  'notebook', 'booklets', 'storybook', 'coloringbook', 'photobook', 'calendar', 'deskcalendar',
  'poster', 'photoprints', 'wrappingpaper',
];
const productNotes = {};
for (const id of ORDER) productNotes[id] = { ...NOTES[id], rows: [...sizeRow(P(id)), ...((NOTES[id] || {}).rows || [])] };

// Which products have which bleed (for the "confirm" table).
const mine = ORDER.map(P);
const bleedOf = (p) => Number(mm(p.sides[0].bleedIn));
const withBleed = (test) => names(mine.filter((p) => test(bleedOf(p))));
const safes = mine.flatMap((p) => p.sides.map((s) => Math.round((Number(s.safeIn) || 0) * 25.4))).filter(Boolean);

module.exports = {
  title: 'طباعة الورق والكروت والستيكرز',
  subtitle: 'كروت، فلايرز وبروشورات، دعوات، ستيكرز وليبلز، ظروف، كشاكيل وكتب وكتيبات، نتايج، فولدرات، صور ومغناطيس',
  short: 'طباعة الورق',
  products: ORDER,
  sidesOf,
  coloursLabel: 'الورق / اللون',

  filesIntro:
    'كل الملفات بتطلع من تصميم العميل بالمقاس الفعلي (١٠٠٪) ومعاها زيادة القص، من غير أي تكبير أو تصغير مطلوب منكم. كل قطعة (وكل وش) ملف لوحده: إحنا مابنركّبش على فرخ الطباعة. بنقدر نبعت أي صيغة من دول:',
  files: [
    { name: `${L('PDF')} بعلامات القص`, spec: `صفحة = المقاس النهائي + زيادة القص + هامش ${L('0.4')} بوصة (حوالي ${L('1')} سم) حواليها فيه علامات قص طولها ${L('0.25')} بوصة (${L('6.4')} مم) وسطر فيه بيانات الشغلانة. ${L('TrimBox')} و ${L('BleedBox')} مظبوطين. الألوان ${L('RGB')}`, use: 'الملف الأساسي لكل شغل الورق' },
    { name: `${L('PDF')} من غير علامات`, spec: `صفحة = المقاس النهائي + زيادة القص بالظبط، ${L('TrimBox')} و ${L('BleedBox')} مظبوطين. الألوان ${L('RGB')}`, use: 'لو بتركّبوا على الفرخ ببرنامج Imposition' },
    { name: `${L('TIFF CMYK')}`, spec: `${L('CMYK')} بخلفية بيضا، ضغط ${L('LZW')}، بزيادة القص ومن غير علامات. التحويل ببروفايل ${L('CMYK')} عام مدمج في الملف (مش بروفايل مطبعتكم)`, use: 'لو بتفضّلوا CMYK جاهز' },
    { name: `${L('PNG')}`, spec: `خلفية شفافة، ${L('RGB')} ببروفايل ${L('sRGB')}، بزيادة القص، ${L('300 DPI')} (أقل في المقاسات الكبيرة، مكتوبة عند كل منتج)`, use: 'الستيكرز على الشفاف، أو عند الطلب' },
    { name: 'قوائم الأسماء', spec: `لما كل نسخة عليها اسم مختلف (دعوات، شهادات، كروت ترابيزات…): ${L('PDF')} واحد فيه صفحة لكل اسم (بعلامات قص أو من غير)، أو ${L('ZIP')} فيه ${L('PDF')} لكل اسم، ومعاهم القائمة ${L('CSV')}`, use: 'المنتجات اللي بتتطبع بأسماء' },
    { name: 'الكتيبات', spec: `${L('PDF')} مترتب للتدبيس من النص (كل صفحتين على فرخ بمقاس صفحتين + زيادة القص، وعلامة مكان الطي فوق وتحت)، أو ${L('PDF')} بكل الصفحات بالترتيب. عدد الصفحات بيتكمّل لمضاعفات 4 بصفحات بيضا قبل الغلاف الخلفي`, use: 'الكتيبات والكتالوجات' },
    { name: 'كتب الأطفال', spec: `${L('PDF')} بكل الصفحات بالترتيب، كل صفحة ${L('300 DPI')} بزيادة قص ${L(mm(require('../../src/books').BLEED_IN))} مم، ${L('RGB · sRGB')}، من غير علامات قص`, use: 'قصة الطفل وكتاب التلوين' },
    { name: 'صور العملاء', spec: `${L('ZIP')}: فولدر لكل مقاس، صور ${L('JPEG')} على ${L('300 DPI')}، وعدد النسخ في اسم كل ملف`, use: 'طباعة الصور' },
  ],
  filesNotes: [
    `<b>مهم:</b> ملفات الـ ${L('PDF')} والـ ${L('PNG')} ألوانها ${L('RGB')} (${L('sRGB')})، والتصميم جوّاها صورة واحدة (Raster) مش Vector، فالكلام الأسود مش ${L('K 100%')} صافي. عايزين نعرف تفضّلوا تحوّلوا للـ ${L('CMYK')} عندكم ولا نبعت ${L('CMYK')} ببروفايل مطبعتكم (أسئلة قسم ٤).`,
    'ملفاتنا مفيهاش: خط قص للستيكرز (Cut line)، علامات تكسير أو طي، قناة للحبر الأبيض أو الـ Spot UV أو الفويل. لو محتاجين أي حاجة منهم قولوا لنا شكلها المطلوب.',
    'الورق الملوّن (كريمي، كرافت، لؤلؤي…) بيتكتب في بيانات الشغلانة: الملف نفسه خلفيته شفافة أو بيضا ومفيهوش لون الورق.',
  ],

  productsIntro: '«زيادة القص» هي اللي بتتقص بره المقاس النهائي من كل ناحية. المنتجات اللي ليها أكتر من مقاس: كل مقاس مكتوب في سطر أو في «مقاس الطباعة لكل مقاس».',
  productNotes,

  priceRows: ['كروت شخصية 350 جرام وجهين (1000 كارت)', 'فلاير A5 وجهين (1000)', 'ستيكرز / ليبلز (1000 قطعة 5 سم)', 'كارت دعوة 13 × 18 + ظرف', 'كتيب A5 16 صفحة', 'سلوفان مط أو لامع (للـ 1000 كارت)'],

  questions: [
    { q: 'نوع الطباعة عندكم وموديلات الماكينات', opts: ['ديجيتال', 'أوفست', 'الاتنين'], note: 'مثال: Konica Minolta، Xerox، Ricoh، HP Indigo، Heidelberg… ومن أنهي كمية بتحوّلوا الشغل للأوفست.', lines: 2 },
    { q: 'أكبر مقاس فرخ بتطبعوه ديجيتال (بالسم)، وأكبر مساحة طباعة فعلية عليه، وأتقل وزن ورق بيعدّي في الماكينة', note: 'مثال: 33 × 48.7 سم. وهل البانر الطويل (لفولدر مفرود 44 × 31 سم أو كارت A3 بزيادة القص) بيعدّي؟', lines: 2 },
    { q: 'الورق المتاح عندكم دايمًا: اكتبوا الأوزان بالجرام لكل نوع', table: { cols: ['النوع', 'الأوزان المتاحة (جرام)', 'ملاحظات'], rows: ['كوشيه لامع', 'كوشيه مط / ساتان', 'ورق أبيض عادي (طبع)', 'كارت برستول / مقوّى', 'كرافت', 'لؤلؤي / كريمي / ورق فاخر', 'ورق كربوني (NCR)', 'ورق تغليف خفيف'] } },
    { q: 'خامات الستيكر والمغناطيس المتاحة', opts: ['ستيكر ورق لامع', 'فينيل أبيض ضد المياه', 'فينيل شفاف', 'ستيكر كرافت', 'شيت مغناطيس'], note: 'وهل عندكم حبر أبيض للطباعة على الشفاف والكرافت؟', lines: 2 },
    { q: `زيادة القص (Bleed) المطلوبة عندكم: ملفاتنا ${L('2')} مم في أغلب المنتجات، ${L('1')} مم في الستيكرز الصغيرة و ${L('3')} مم في القليل. محتاجين كام؟`, opts: ['2 مم كفاية', '3 مم في الكل', 'رقم تاني: ..........'], lines: 1 },
    { q: `هامش الأمان: أقل مسافة للكلام واللوجو من خط القص عندكم (بالمم)؟ ونسبة الترحيل في القص (± كام مم)؟`, note: 'مهم خصوصًا في الكروت الشخصية والإطارات الرفيعة حوالين التصميم.', lines: 1 },
    { q: 'علامات القص', opts: ['عايزين PDF بعلامات القص بتاعتنا', 'من غير علامات (بنحطها إحنا)', 'مش فارقة'], lines: 1 },
    { q: 'التركيب على الفرخ (Imposition)', opts: ['ابعتوا قطعة واحدة في PDF وإحنا نركّب', 'ركّبوا أنتم على فرخ مقاسه: ..........'], note: 'ملفاتنا دلوقتي قطعة واحدة في كل ملف (والكتيبات بس بتتركّب للتدبيس). لو لازم نركّب إحنا: اكتبوا مقاس الفرخ والمسافات والعلامات المطلوبة.', lines: 2 },
    { q: `الألوان: ملفاتنا ${L('RGB (sRGB)')}، وعندنا ${L('TIFF CMYK')} ببروفايل عام. تفضّلوا إيه؟`, opts: ['PDF RGB ونحوّل إحنا', 'CMYK ببروفايلنا: ..........', 'مش فارقة'], note: `لو ${L('CMYK')}: اسم البروفايل (مثال: ${L('FOGRA39 / ISO Coated v2')} للكوشيه، ${L('FOGRA47 / PSO Uncoated')} للورق العادي) أو ابعتوا ملف الـ ${L('ICC')}.`, lines: 1 },
    { q: `الأسود: الكلام الأسود عندنا جاي من ${L('RGB')} ومش ${L('K 100%')} صافي، والتصميم صورة مش Vector. ده بيعمل مشكلة في الكلام الصغير عندكم (ترحيل ألوان)؟ وأصغر بونط يطلع واضح؟`, note: `ونسبة الأسود الغني (Rich black) اللي تنصحوا بيها للمساحات السودا الكبيرة، وأقصى تغطية حبر (${L('TAC')}).`, lines: 2 },
    { q: `الدقة: ملفاتنا ${L('300 DPI')} بالمقاس الفعلي (البوستر ${size('poster', '45x60')} بيطلع ${L(`${sizeDpi('poster', '45x60')} DPI`)}). كافية؟`, opts: ['أيوه', 'لأ، المطلوب: ..........'] },
    { q: 'أقل كمية بتقبلوها لكل نوع، ومن أنهي كمية السعر بينزل', table: { cols: ['المنتج', 'أقل كمية', 'ملاحظات'], rows: ['كروت شخصية / كروت', 'فلايرز / بروشورات', 'دعوات وكروت بأسماء', 'ستيكرز / ليبلز', 'ظروف مطبوعة', 'كتيبات / كتب', 'نتايج', 'فولدرات'] } },
    { q: 'السلوفان (Lamination)', opts: ['مط', 'لامع', 'Soft touch', 'وش واحد', 'وشين'], note: 'أقل وزن ورق بيتسلفن عندكم، وأقل كمية، وهل بيتعمل على الطباعة الديجيتال من غير ما يقشّر؟', lines: 2 },
    { q: 'تشطيبات تانية متاحة عندكم', opts: ['Spot UV', 'فويل دهبي / فضي', 'بصمة بارزة', 'كورنر (حواف مدورة)', 'تكسير', 'طي ماكينة', 'تخريم (Perforation)', 'ترقيم', 'خرم'], note: 'للـ Spot UV والفويل: عايزين الملف إزاي (طبقة منفصلة / لون Spot باسم معيّن)؟ ونص قطر الكورنر المتاح.', lines: 2 },
    { q: 'التكسير والطي: من أنهي وزن ورق لازم تكسير قبل الطي عشان الطباعة ماتشرخش؟ وبتطووا البروشور 3 طيّات والكروت المطوية عندكم؟', lines: 2 },
    { q: 'التجليد المتاح عندكم', opts: ['دبوس من النص', 'سلك (Wire-O)', 'سلك حلزوني', 'غِرا (Perfect)', 'غلاف مقوّى (Hard cover)', 'غِرا بلوكات'], note: 'لكل نوع: أقل وأكتر عدد صفحات، وأقل كمية، والهامش المطلوب ناحية الكعب أو السلك.', lines: 3 },
    { q: `كتب الأطفال ${size('storybook')}: بتعملوا نسخة واحدة بغلاف مقوّى؟ محتاجين الغلاف ملف منفصل مفرود بكعب؟ ونوع الورق اللي جوه؟`, note: 'ملفنا دلوقتي صفحات مفردة بالترتيب، الغلاف أول وآخر صفحة.', lines: 2 },
    { q: 'الكتيبات الدبوس: تفضّلوا أنهي ملف؟', opts: ['المترتب للتدبيس (صفحتين على الفرخ)', 'الصفحات بالترتيب ونركّب إحنا'], note: 'وبتعوّضوا زحف الصفحات (Creep) عندكم في الكتيبات الـ 32 صفحة؟', lines: 1 },
    { q: 'الستيكرز: طريقة القص عندكم', opts: ['Kiss-cut على شيت', 'Die-cut كل ستيكر لوحده', 'قص على رول', 'فورمة جاهزة (دايرة / مستطيل)'], note: 'خط القص: بتطلّعوه أنتم من حدود التصميم، ولا عايزينه مننا (Vector بلون Spot اسمه إيه، مثال CutContour)؟ والمسافة بين التصميم وخط القص؟', lines: 2 },
    { q: 'الستيكرز ضد المياه: نوع الفينيل والحبر، وهل بيتسلفن؟ بيستحمل غسيل الزمزمية واللانش بوكس؟', lines: 1 },
    { q: 'الظروف (DL وظروف العيدية وظروف الدعوات)', opts: ['بنطبع على ظروف جاهزة', 'بنطبع فرخ ونقص ونلزق', 'مابنعملش ظروف'], note: 'المقاسات الجاهزة عندكم، وهل الطباعة لحد الحرف ممكنة؟', lines: 2 },
    { q: 'طباعة الصور: نوع الورق الفوتوغرافي (لامع / مطفي / Luster) ووزنه، والماكينة (معمل صور ولا Inkjet)، والمقاسات المتاحة', lines: 2 },
    { q: 'البيانات المتغيرة (اسم مختلف على كل نسخة): بنبعت PDF فيه صفحة لكل اسم، أو PDF لكل اسم. ده مناسب؟', opts: ['PDF واحد بكل الأسماء', 'PDF لكل اسم', 'ابعتوا التصميم + القائمة ونركّب إحنا'], note: 'وهل فيه زيادة في السعر للشغل اللي كل نسخة فيه مختلفة؟', lines: 1 },
    { q: 'البروفة: بتطبعوا نسخة واحدة للموافقة على نفس الورق قبل الكمية؟ وبتبعتوا صورة ولا لازم نستلمها؟', lines: 1 },
  ],

  confirm: [
    ['زيادة القص (Bleed)', `${L('2')} مم في أغلب المنتجات. ${L('1')} مم: ${withBleed((b) => b === 1)}. ${L('1.5')} مم: ${withBleed((b) => b === 1.5)}. ${L('3')} مم أو أكتر: ${withBleed((b) => b >= 3)}. من غير زيادة: ${withBleed((b) => b === 0)}`],
    ['هامش الأمان', `من ${L(Math.min(...safes))} لـ ${L(Math.max(...safes))} مم جوه خط القص حسب المنتج (مكتوب في جدول كل منتج)`],
    ['علامات القص', `طولها ${L('6.4')} مم، خط ${L('0.25 pt')} أسود، في هامش ${L('10')} مم حوالين الصفحة`],
    ['الألوان', `${L('PDF / PNG')}: ${L('RGB · sRGB')}. ${L('TIFF')}: ${L('CMYK')} ببروفايل عام (مش ${L('FOGRA39')})`],
    ['دقة الملف', `${L('300 DPI')}، وأقل في المقاسات الكبيرة: البوستر ${L(`${sizeDpi('poster', '45x60')} DPI`)}، الشهادة ${L('A3')} ${L(`${sizeDpi('certificates', 'A3')} DPI`)}، الفولدر المفرود ${L(`${sizeDpi('folders', '1')} DPI`)}`],
    ['الكارت الشخصي', size('bizcards')],
    ['كارت الدعوة', size('invitations')],
    ['ظرف DL', size('dlenvelopes')],
    ['ظرف العيدية', size('eidenvelopes')],
    ['البروشور 3 طيّات (مفرود)', `${size('brochures')}، التلات أجزاء متساوية ومن غير علامات تكسير`],
    ['الفولدر (البرّه مفرود)', `${size('folders')}، من غير رسمة الفورمة والجيب`],
    ['كتب الأطفال', `${size('storybook')} (${L('8 × 8')} بوصة)، زيادة قص ${L(mm(P('storybook').sides[0].bleedIn))} مم`],
    ['الكتيب المترتب للتدبيس', `فرخ = صفحتين ${L('A5')} جنب بعض + زيادة القص من بره بس، الصفحات مضاعفات ${L('4')}`],
    ['الصور', `${L('JPEG · 300 DPI')}؛ الإطار الأبيض ${L(P('photoprints').photo.borderMm)} مم؛ بننبّه العميل لو صورته أقل من ${L(`${P('photoprints').photo.lowDpi} DPI`)}`],
    ['ليبل المنتجات', `${groups(P('labels')).map((f) => WH(f.w, f.h)).join('، ')}، بحواف مدورة`],
  ],
};
