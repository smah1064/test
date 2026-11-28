'use strict';
/*
 * Supplier pack: DTF (film transfer). Facts about the files come from src/printfiles.js (hardAlpha, dtfFilmPng, filmPdf),
 * src/app.js FORMATS / gangSheetPdf / dtf-items, and public/js/admin.js FORMATS_BY_METHOD.dtf.
 */
const L = (s) => `<span dir="ltr">${s}</span>`;
const WH = (w, h) => `عرض ${L(w)} × ارتفاع ${L(h)} سم`;
// Print sizes are read from the product data, so the pack can't drift from the site.
const { PRODUCTS } = require('../../src/products');
const cm = (inches) => (Math.round(inches * 2.54 * 10) / 10).toFixed(1).replace(/\.0$/, '');
const product = (id) => PRODUCTS.find((p) => p.id === id);
const sideOf = (id, sideId) => { const p = product(id); return p.sides.find((x) => x.id === sideId) || p.sides[0]; };
const area = (id, sideId) => {
  const s = sideOf(id, sideId);
  return WH(cm(s.printWidthIn), cm((s.printWidthIn * s.printArea.h) / s.printArea.w));
};

const IDS = ['polo', 'ziphoodie', 'kidshoodie', 'jersey', 'denim', 'shorts', 'cap', 'apron', 'lunchbag', 'pencilcase'];

// The film settings the code holds today (src/printfiles.js filmPdf defaults; src/app.js /api/admin/dtf-items rollWidthIn).
const ROLL_IN = 22; // film width
const MARGIN_IN = 0.25; // empty edge on each side of the film
const GAP_IN = 0.25; // between pieces
const PAGE_IN = 196; // a longer film continues on the next PDF page
const LABEL_PT = 6; // the sorting label under each piece
const ALPHA_CUTOFF = 128; // hardAlpha: of 255
// The editor's export (public/js/editor.js exportPrint, as scripts/supplier-pack.js sideFacts): 300 DPI, less on big areas.
const dpiOf = (s) => {
  const w = s.printWidthIn + 2 * (Number(s.bleedIn) || 0);
  const h = (s.printWidthIn * s.printArea.h) / s.printArea.w + 2 * (Number(s.bleedIn) || 0);
  return Math.floor(Math.min(300, Math.sqrt(16e6 / (w * h)), 8000 / Math.max(w, h)));
};
const allSides = IDS.flatMap((id) => product(id).sides);
const MIN_DPI = Math.min(...allSides.map(dpiOf));
const safes = allSides.map((s) => Math.round((Number(s.safeIn) || 0) * 25.4));
const SAFE = [Math.min(...safes), Math.max(...safes)];
const mm = (inches) => String(Math.round(inches * 25.4 * 10) / 10);

// The test print: 20 × 25 cm, transparent background, NOT mirrored and with its soft edges kept. Sizes are in cm through --cm.
const SW = [['#00aeef', 'C'], ['#ec008c', 'M'], ['#fff200', 'Y'], ['#000000', 'K'], ['#ed1c24', 'R'], ['#00a651', 'G'], ['#2e3192', 'B'], ['#f7941d', 'Orange'], ['#f5c9a8', 'Skin 1'], ['#a86b45', 'Skin 2']];
const u = (n) => `calc(var(--cm)*${n})`;
const TEST_HTML = (brandName) => `
<div style="position:relative;width:${u(20)};height:${u(25)};color:#000">
  <div style="position:absolute;inset:0;border:${u(0.05)} solid #000"></div>
  <div style="position:absolute;left:${u(0.6)};top:${u(0.4)};right:${u(0.6)};display:flex;justify-content:space-between;align-items:baseline">
    <b style="font-size:${u(0.75)}">${brandName ? `${brandName} · ` : ''}DTF test</b><span style="font-size:${u(0.4)}">frame = 20.0 × 25.0 cm · 300 DPI · sRGB · not mirrored</span></div>

  <div style="position:absolute;left:${u(0.6)};top:${u(1.9)};display:flex;gap:${u(0.2)}">
    ${SW.map(([c, n]) => `<div style="width:${u(1.7)};text-align:center;font-size:${u(0.3)}"><div style="height:${u(1.7)};background:${c}"></div>${n}</div>`).join('')}</div>

  <div style="position:absolute;left:${u(0.6)};top:${u(4.5)};width:${u(18.8)}">
    ${['#00aeef', '#ec008c', '#fff200', '#000000', '#ed1c24'].map((c) => `<div style="height:${u(0.7)};margin-bottom:${u(0.12)};background:linear-gradient(90deg,${c},${c}00)"></div>`).join('')}
    <div style="font-size:${u(0.3)}">100% → transparent (soft edges / shadows): where does the white layer and the powder stop?</div>
    <div style="display:flex;margin-top:${u(0.2)}">${[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((k) => { const v = Math.round(255 * (1 - k / 100)); return `<div style="flex:1;height:${u(1)};background:rgb(${v},${v},${v});color:${k > 50 ? '#fff' : '#000'};font-size:${u(0.3)};text-align:center;line-height:${u(1)}">${k}</div>`; }).join('')}</div>
    <div style="font-size:${u(0.3)}">grey steps (0 = white ink only)</div>
  </div>

  <div style="position:absolute;left:${u(0.6)};top:${u(11.3)};width:${u(9)}">
    ${[0.1, 0.2, 0.3, 0.5, 0.75, 1].map((w) => `<div style="display:flex;align-items:center;gap:${u(0.3)};height:${u(0.55)}"><span style="font-size:${u(0.3)};width:${u(1.4)}">${w} mm</span><div style="flex:1;height:${u(w / 10)};background:#000"></div><div style="flex:1;height:${u(w / 10)};background:#ed1c24"></div></div>`).join('')}
    <div style="margin-top:${u(0.3)}">${[6, 8, 10, 12, 14].map((pt) => `<div style="font-size:${u(pt * 0.03528)};line-height:1.5;white-space:nowrap">${pt} pt · Quality print · طباعة بجودة عالية</div>`).join('')}</div>
  </div>

  <div style="position:absolute;left:${u(10.4)};top:${u(11.3)};width:${u(9)};height:${u(6.6)};background:#1f2f54;color:#fff;padding:${u(0.4)};box-sizing:border-box">
    <div style="font-size:${u(0.55)};font-weight:700">White on colour · أبيض على لون</div>
    ${[6, 8, 10, 12].map((pt) => `<div style="font-size:${u(pt * 0.03528)};line-height:1.5">${pt} pt · White text · كلام أبيض</div>`).join('')}
    <div style="display:flex;gap:${u(0.3)};margin-top:${u(0.3)}">${['#ffffff', '#fff200', '#ec008c', '#00aeef'].map((c) => `<div style="width:${u(1.5)};height:${u(1.5)};border-radius:50%;background:${c}"></div>`).join('')}</div>
    ${[0.2, 0.5].map((w) => `<div style="height:${u(w / 10)};background:#fff;margin-top:${u(0.3)}"></div>`).join('')}
  </div>

  <div style="position:absolute;left:${u(0.6)};top:${u(18.6)};display:flex;gap:${u(0.5)};align-items:flex-start">
    <div style="width:${u(5)};height:${u(5)};border-radius:50%;background:radial-gradient(circle,#fff200,#f7941d 45%,#ed1c24 70%,#2e3192 85%,#2e319200)"></div>
    <div style="width:${u(5.6)};font-size:${u(0.3)};line-height:1.4">
      <b>Loose dots (do they stay on?)</b>
      ${[0.3, 0.5, 1, 2].map((d) => `<div style="display:flex;align-items:center;gap:${u(0.25)};height:${u(0.55)}"><span style="width:${u(1.2)}">${d} mm</span>${[0, 1, 2, 3, 4, 5].map(() => `<div style="width:${u(d / 10)};height:${u(d / 10)};border-radius:50%;background:#000"></div>`).join('')}</div>`).join('')}
      <b>Gaps in a solid (do they close?)</b>
      <div style="display:flex;height:${u(1.5)};margin-top:${u(0.1)}">${[0.2, 0.3, 0.5, 0.75, 1].map((g) => `<div style="flex:1;background:#000"></div><div style="width:${u(g / 10)}"></div>`).join('')}<div style="flex:1;background:#000"></div></div>
      gaps: 0.2 · 0.3 · 0.5 · 0.75 · 1 mm
    </div>
    <div style="width:${u(6.6)};font-size:${u(0.38)};line-height:1.5">
      <div style="height:${u(0.06)};background:#000;width:${u(5)}"></div>
      this line = 5.0 cm<br>
      <b>White solid:</b>
      <div style="height:${u(1.2)};background:#fff;border:${u(0.03)} solid #000"></div>
      <b>Rich black:</b>
      <div style="height:${u(1.2)};background:#000"></div>
    </div>
  </div>
  <div style="position:absolute;left:${u(0.6)};right:${u(0.6)};bottom:${u(0.35)};font-size:${u(0.32)};display:flex;justify-content:space-between"><span>Mirror in your RIP · print at 100% (no scaling)</span><span>اعكسوه عندكم واطبعوه بالمقاس الفعلي</span></div>
</div>`;

module.exports = {
  title: 'الطباعة بالنقل الحراري على فيلم · DTF',
  subtitle: 'بولو، هوديز، تيشيرتات كورة، جاكيت جينز، شورتات، كابات، مرايل وشنط',
  short: 'الطباعة DTF',
  products: IDS,

  filesIntro:
    'كل الملفات بتطلع من نفس تصميم العميل بالمقاس الفعلي للطباعة (١٠٠٪)، من غير أي تكبير أو تصغير مطلوب منكم. ملف الفيلم بيطلع من ملفاتنا <b>معكوس وجاهز</b>، وبنقدر نبعت أي صيغة من دول حسب اللي يناسب برنامج الـ RIP عندكم:',
  files: [
    { name: `ملف الفيلم ${L('PNG')}`, spec: `<b>معكوس</b>، خلفية شفافة بحواف حادة (من غير بيكسلات نص شفافة)، ألوان ${L('RGB')} ومعاه بروفايل ${L('sRGB')}، بالمقاس الفعلي، ${L('300 DPI')}${MIN_DPI < 300 ? ` (المساحات الكبيرة ${L(`${MIN_DPI} DPI`)} تقريبًا)` : ''}`, use: 'الملف الأساسي لكل قطعة لوحدها' },
    { name: `ملف الفيلم ${L('PDF')}`, spec: `نفس ملف الفيلم (معكوس وبحواف حادة) جوه صفحة ${L('PDF')} بالمقاس الفعلي لمساحة الطباعة`, use: 'لو بتفضّلوا PDF' },
    { name: `شيت مجمّع ${L('PDF')}`, spec: `كذا قطعة من كذا أوردر مترصّصين على فيلم عرضه ${L(cm(ROLL_IN))} سم (${L(`${ROLL_IN}"`)})، معكوسين، بينهم ${L(mm(GAP_IN))} مم، وتحت كل قطعة سطر صغير رمادي (${L(`${LABEL_PT} pt`)}) فيه رقم الأوردر والمنتج والوجه والمقاس. طول الصفحة على قد الشغل`, use: 'لما يبقى فيه كذا شغلانة في نفس اليوم' },
    { name: `ملف الطباعة ${L('PNG')} (مش معكوس)`, spec: `التصميم زي ما العميل شافه: خلفية شفافة، ${L('RGB · sRGB')}، بالمقاس الفعلي، والحواف الناعمة زي ما هي`, use: 'لو بتفضّلوا تعكسوا وتظبطوا الأبيض بنفسكم' },
    { name: `ملف ${L('PDF')} (مش معكوس)`, spec: `صفحة بالمقاس الفعلي لمساحة الطباعة، ألوان ${L('RGB')}`, use: 'للمراجعة، أو لو الـ RIP بيعكس لوحده' },
  ],
  filesNotes: [
    `<b>مهم (العكس):</b> ملفات الفيلم والشيت المجمّع بتوصلكم <b>معكوسة جاهزة</b>. لو الـ RIP عندكم بيعكس لوحده قولولنا (سؤال في قسم ٤) عشان نبعت الملف المش معكوس وماتتعكسش مرتين.`,
    `<b>الحواف:</b> في ملف الفيلم أي بيكسل شفافيته أقل من ${L('50%')} بيتشال، واللي أكتر بيبقى لون كامل. يعني الظلال الناعمة والتدرّج لحد الشفاف بيتحوّلوا لحافة حادة، عشان الأبيض والبودرة مايبانوش حوالين التصميم.`,
    'مافيش ملف أبيض منفصل: المفروض الـ RIP عندكم يعمل طبقة الأبيض من شفافية الملف. مقاس الطباعة واحد لكل مقاسات القطعة: التصميم مابيكبرش مع المقاس الأكبر.',
    'أحيانًا العميل بيرتّب شيت كامل بنفسه (كذا تصميم على فيلم واحد): ده بيوصلكم PDF واحد بمقاس الشيت بالظبط، معكوس أو مش معكوس حسب طلبكم، من غير سطور تعريف ومن غير هوامش.',
  ],

  productsIntro: 'القياسات على مقاس M للكبار. الوجه اللي مش مذكور في المنتج مابيتطبعش.',
  productNotes: {
    polo: { material: 'قطن بيكيه بياقة وأزرار', ask: `الكبس على البيكيه جنب الياقة والمرد (مكان الزراير): فيه مسافة لازم نسيبها؟ والطباعة ${area('polo', 'front')} على الصدر بتتظبط في مكانها إزاي؟` },
    ziphoodie: { material: 'ميلتون بسوستة كاملة وكابيشون', ask: 'الكبس على الضهر والسوستة والكابيشون موجودين: بتستخدموا مخدة كبس؟ وشعار الصدر جنب السوستة لازم يبعد عنها كام سم؟' },
    kidshoodie: { material: 'ميلتون بمقاسات أطفال، بجيب كنغر', ask: `عندكم قاعدة مكبس صغيرة لمقاسات الأطفال (من 4 سنين)؟ وطباعة الأمام ${area('kidshoodie', 'front')} فوق الجيب ممكنة على أصغر مقاس؟` },
    jersey: { material: 'قماش رياضي خفيف', ask: 'بتكبسوا على القماش الرياضي (بوليستر)؟ على أي حرارة؟ وبيحصل تغيّر في لون الطباعة من صبغة القماش (خصوصًا الأحمر والكحلي) أو لمعة من المكبس؟' },
    denim: { material: 'جينز متين، الطباعة على الضهر بس', ask: 'الكبس على الجينز فوق خياطات الضهر: الفيلم بيمسك كويس؟ بتكبسوا مرة تانية بعد نزع الفيلم؟ وبتنصحوا بنوع بودرة معيّن للجينز؟' },
    shorts: { material: 'ميلتون برباط على الوسط، طباعة صغيرة على الرِّجل', ask: 'الكبس على رِجل الشورت جنب الخياطة والجيب: فيه قاعدة صغيرة مناسبة؟ والمسافة الآمنة من الخياطة كام؟' },
    cap: { material: 'قطن متين، مقاس واحد قابل للضبط', hideSizes: true, ask: `عندكم مكبس كابات (قاعدة مقوّسة)؟ مساحة ${area('cap')} على وش الكاب مناسبة؟ والخياطة اللي في نص الوش بتأثر على الطباعة؟` },
    apron: { material: 'قطن وبوليستر، بجيب أمامي ورباط', hideSizes: true, ask: 'الكبس على خليط القطن والبوليستر: الحرارة والمدة؟ والطباعة بتستحمل الغسيل المتكرر على حرارة عالية (المريلة بتتغسل كتير)؟' },
    lunchbag: { material: 'شنطة معزولة (مبطّنة) بسوستة ومقبض', hideSizes: true, ask: 'الشنطة مبطّنة بعازل حراري: بتكبسوا عليها وهي جاهزة من غير ما البطانة تتأثر؟ على أي حرارة؟ ولا لازم الطباعة تتعمل على القماش قبل التقفيل؟' },
    pencilcase: { material: 'كانفاس بسوستة', hideSizes: true, ask: 'الكبس على المقلمة وهي متقفّلة (السوستة والخياطات موجودة): ممكن؟ ولا بتحتاجوا القماش مفرود قبل الخياطة؟' },
  },

  priceRows: ['متر فيلم مطبوع (عرض الرول)', 'قطعة صغيرة (شعار صدر) مع الكبس', 'قطعة كبيرة (ضهر كامل) مع الكبس', 'الكبس بس (لو الفيلم جاهز)', 'سعر القطعة الفاضية (لو منكم)'],

  questions: [
    { q: 'نوع وموديل ماكينة الـ DTF وعددها، ونوع الأحبار', note: 'مثال: ماكينة بهيدين Epson i3200 / XP600، أو غيرها. ومعاها هزّاز بودرة وفرن أوتوماتيك ولا يدوي؟', lines: 2 },
    { q: 'برنامج الـ RIP اللي بتشتغلوا بيه', lines: 1 },
    { q: `عرض الفيلم عندكم. إحنا مجهّزين الشيت المجمّع على عرض ${L(cm(ROLL_IN))} سم (${L(`${ROLL_IN}"`)})`, opts: ['30 سم', '33 سم', '42 سم', '60 سم', 'عرض تاني: ..........'] },
    { q: `عرض الطباعة الفعلي جوه الفيلم (بعد الهوامش). إحنا سايبين ${L(mm(MARGIN_IN))} مم من كل ناحية، يعني بنطبع على ${L(cm(ROLL_IN - 2 * MARGIN_IN))} سم`, lines: 1 },
    { q: `أقصى طول للملف الواحد عندكم (بالمتر)؟ الشيت المجمّع عندنا بيتقسم صفحة جديدة كل ${L(cm(PAGE_IN))} سم`, lines: 1 },
    { q: 'نوع الفيلم', opts: ['نزع بارد (Cold peel)', 'نزع سخن (Hot peel)', 'الاتنين'], note: 'واللمسة النهائية: مطفي ولا لامع؟ وبتكبسوا مرة تانية بعد النزع؟', lines: 1 },
    { q: 'نوع البودرة (اللاصق)', opts: ['بيضا', 'سودا (للقطع الغامقة / ضد تغيّر اللون)', 'الاتنين'], note: 'ناعمة ولا متوسطة ولا خشنة؟ وبتغيّروها حسب الخامة؟', lines: 1 },
    { q: 'الخدمة اللي بتقدموها', opts: ['فيلم مطبوع بس (إحنا نكبس)', 'طباعة وكبس على القطع', 'الاتنين'] },
    { q: 'إعدادات الكبس اللي بتنصحوا بيها (حرارة / مدة / ضغط)', table: { cols: ['الخامة', 'الحرارة °C', 'المدة (ثانية)', 'الضغط', 'كبس تاني بعد النزع؟'], rows: ['قطن', 'ميلتون', 'بوليستر رياضي', 'جينز', 'كانفاس'] } },
    { q: 'الشيت المجمّع: تفضّلوا إيه؟', opts: ['شيت PDF جاهز منّا على عرض فيلمكم', 'كل قطعة ملف لوحدها وأنتم ترصّوا', 'مش فارقة'], note: `في الشيت بتاعنا المسافة بين القطع ${L(mm(GAP_IN))} مم، والقطعة ممكن تتلف ${L('90°')} عشان توفّر فيلم. المسافة دي كفاية للقص؟`, lines: 1 },
    { q: 'العكس (Mirror): مين اللي يعكس؟', opts: ['ابعتوا الملف معكوس جاهز', 'ابعتوه عادي والـ RIP بيعكس'] },
    { q: 'طبقة الأبيض: الـ RIP عندكم بيعملها من شفافية الـ PNG؟ وبتسحبوها لجوه (Choke) قد إيه؟', opts: ['أيوه من الشفافية', 'محتاجين ملف أبيض منفصل'], lines: 1 },
    { q: `صيغة الملف المفضّلة عندكم`, opts: ['PNG شفاف RGB', 'PDF', 'TIFF', 'صيغة تانية: ..........'] },
    { q: `الدقة والألوان: ملفاتنا ${L('300 DPI')} بالمقاس الفعلي${MIN_DPI < 300 ? ` (والمساحات الكبيرة ${L(MIN_DPI)})` : ''} و ${L('sRGB')}. كافية؟ وفيه ألوان بتطلع مختلفة عن الشاشة عادةً (أحمر فاقع، فسفوري، أزرق غامق)؟`, lines: 2 },
    { q: `الحواف الناعمة والظلال: إحنا بنحوّلها لحافة حادة (بنشيل أي بيكسل شفافيته أقل من ${L('50%')}). ده مناسب، ولا الـ RIP عندكم بيطلّعها أحسن بهافتون وتفضّلوا الملف بحوافه الناعمة؟`, opts: ['حواف حادة أحسن', 'ابعتوها ناعمة', 'نجرّب الاتنين'], lines: 1 },
    { q: 'أرفع خط وأصغر حجم كلام وأصغر نقطة منفصلة يمسكوا على القماش من غير ما يتقشّروا (بالمم / بالبونط)', lines: 1 },
    { q: 'الخامات اللي بتكبسوا عليها DTF', opts: ['قطن', 'قطن/بوليستر', 'ميلتون', 'بوليستر رياضي', 'جينز', 'كانفاس', 'نايلون / مشمّع', 'شنط مبطّنة'], note: 'واللي مابتنصحوش بيها أو محتاجة بودرة أو حرارة مختلفة.', lines: 2 },
    { q: 'الكابات: عندكم مكبس كابات؟ وأقصى مساحة تتكبس على وش الكاب (عرض × ارتفاع)؟', opts: ['أيوه', 'لأ'], lines: 1 },
    { q: 'مكان الطباعة: بتقيسوا إزاي (كام سم تحت الياقة، شعار الصدر على أي بُعد من النص)؟ ونسبة الخطأ المتوقعة في المكان والاستقامة (± كام مم)؟', lines: 2 },
    { q: 'إحنا بنسمح للعميل يحرّك التصميم (لفوق، لتحت، يمين، شمال) جوه حدود معيّنة وبنكتب لكم الإزاحة بالسم. ده عملي عندكم؟', opts: ['أيوه', 'أيوه بحدود: ..........', 'لأ، مكان ثابت بس'] },
    { q: 'الكبس قرب أو فوق الخياطات، الجيوب، السوست، الزراير والياقة: إيه المسافة الآمنة؟ وبتستخدموا مخدات كبس؟', lines: 2 },
    { q: `سطور التعريف: في الشيت المجمّع بنكتب تحت كل قطعة سطر رمادي صغير (${L(`${LABEL_PT} pt`)}) برقم الأوردر والمقاس. مناسب، ولا يتطبع على الفيلم ويضايق؟`, opts: ['مناسب', 'كبّروه', 'شيلوه وابعتوا كشف'], lines: 1 },
    { q: 'لو هنستلم فيلم بس: بتقصّوا القطع وتفصلوها ولا بيتسلّم رول؟ والفيلم المطبوع بيتخزّن قد إيه قبل الكبس وبأي طريقة؟', lines: 2 },
    { q: 'ثبات الطباعة: بتستحمل كام غسلة تقريبًا؟ بتتشقق مع الشد؟ وتعليمات الغسيل والكي اللي تنصحوا نكتبها للعميل؟', lines: 2 },
    { q: 'ملمس الطباعة في المساحات الكبيرة (ضهر كامل): تقيلة أو مش بتتنفّس؟ بتنصحوا نفرّغ التصميم أو نقلّل المساحات السادة؟', lines: 2 },
    { q: 'بتعملوا تطريز أو عندكم جهة بتتعاملوا معاها؟ (بعض القطع عندنا بتتطلب بشعار مطرّز على الصدر وطباعة DTF على الضهر)', opts: ['أيوه', 'لأ'] },
  ],

  confirm: [
    ['بولو', `الصدر ${area('polo', 'front')}، والخلف ${area('polo', 'back')}`],
    ['هودي بسوستة', `الصدر ${area('ziphoodie', 'front')}، والخلف ${area('ziphoodie', 'back')}`],
    ['هودي أطفال', `الأمام ${area('kidshoodie', 'front')}، والخلف ${area('kidshoodie', 'back')}`],
    ['تيشيرت كورة', `الأمام ${area('jersey', 'front')}، والخلف ${area('jersey', 'back')}`],
    ['جاكيت جينز (الخلف)', `${area('denim', 'back')}`],
    ['شورت (الرِّجل)', `${area('shorts')}`],
    ['كاب (الوش)', `${area('cap')}`],
    ['مريلة', `${area('apron')}`],
    ['شنطة لانش بوكس', `${area('lunchbag')}`],
    ['مقلمة', `${area('pencilcase')}`],
    ['هامش الأمان', `من ${L(SAFE[0])} لـ ${L(SAFE[1])} مم جوه حدود الطباعة (مكتوب لكل منتج في قسم ٢)`],
    ['دقة الملف والألوان', `${L('300 DPI')}${MIN_DPI < 300 ? ` (${L(MIN_DPI)} للمساحات الكبيرة)` : ''}، ${L('RGB · sRGB')}`],
    ['العكس', 'ملف الفيلم والشيت المجمّع معكوسين جاهزين'],
    ['الحواف', `حادة: أي بيكسل شفافيته أقل من ${L('50%')} بيتشال (حد ${L(`${ALPHA_CUTOFF}/255`)})`],
    ['طبقة الأبيض', 'مش بنبعت ملف أبيض: الـ RIP بيعملها من الشفافية'],
    ['عرض الفيلم (افتراض عندنا)', `${L(cm(ROLL_IN))} سم (${L(`${ROLL_IN}"`)})، وهامش ${L(mm(MARGIN_IN))} مم من كل ناحية = عرض طباعة ${L(cm(ROLL_IN - 2 * MARGIN_IN))} سم`],
    ['المسافة بين القطع على الشيت', `${L(mm(GAP_IN))} مم، والقطع ممكن تتلف ${L('90°')}`],
    ['أقصى طول لصفحة الشيت', `${L(cm(PAGE_IN))} سم، والباقي في صفحة تانية`],
    ['سطر التعريف تحت كل قطعة', `رمادي فاتح، ${L(`${LABEL_PT} pt`)}، بحروف إنجليزي`],
  ],

  test: {
    wCm: 20, hCm: 25, white: false, html: TEST_HTML,
    step: 'اطبعوا ملف التجربة المرفق على الفيلم واكبسوه على قطعة فاتحة وقطعة غامقة، وابعتوا لنا صورة واضحة للنتيجة (أو القطعة نفسها).',
    text:
      `مع الملف ده مرفق ملف تجربة ${WH('20', '25')} (PNG شفاف ${L('300 DPI')}). الملف ده بالذات <b>مش معكوس وحوافه الناعمة زي ما هي</b>، عشان نشوف الـ RIP عندكم بيتعامل معاها إزاي: اعكسوه عندكم. ` +
      'فيه ألوان أساسية، تدرّجات لحد الشفاف، خطوط رفيعة، نقط صغيرة منفصلة، فراغات رفيعة جوه مساحة سادة، كلام صغير عربي وإنجليزي، وأبيض على لون. ' +
      'ياريت يتكبس بالمقاس الفعلي على قطعة قطن بيضا وقطعة سودا (ولو متاح قطعة بوليستر)، وتبعتوا صورة للنتيجة في نور النهار ومعاها قياس الإطار بالمسطرة (المفروض العرض 20 سم والارتفاع 25 سم بالظبط)، وصورة تانية بعد غسلة لو أمكن.',
  },
};
