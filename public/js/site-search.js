/*
 * Search in the header (every shop page): the magnifier opens a search bar under the header with up to five
 * products as the customer types (picture, name, starting price); a product opens its page, Enter / Search opens
 * the home page's full results (/?q=…#products). The products are found and ordered exactly as the home page's
 * own search does: the lines between site-search:start and site-search:end are the home page's own lines
 * (test/site-search.test.js checks them; the lines marked "header only" are this file's own).
 */
(function () {
  'use strict';
  if (!window.POD) return;
  const { t, tr, esc, money } = POD;

  // site-search:start
  /** The home page's search over a catalogue: (words) → the products found, best first. */
  function makeFinder(products, categories) { // header only
    let q = ''; // header only
    const cat = 'all'; // header only
    const ALIASES = {
      tshirt: 'tee t-shirt tshirt shirt تي شيرت تيشرت تشيرت', kidstee: 'tee t-shirt kids اطفال تيشرت', polo: 'tee shirt تيشرت', oversized: 'tee shirt تيشرت', jersey: 'football soccer shirt تيشرت فانلة',
      hoodie: 'hoody sweater هودى', ziphoodie: 'hoody zip jacket هودى جاكيت', kidshoodie: 'hoody هودى اطفال', sweatshirt: 'sweater سويت شيرت بلوفر',
      cap: 'hat قبعة طاقية', mug: 'cup coffee tea كوب كوباية مق', magicmug: 'cup كوب مق', couplemugs: 'cup كوب مق', tumbler: 'cup travel mug كوب',
      cushion: 'pillow مخدة وسادة', poster: 'frame picture صورة برواز', bottle: 'water flask زجاجة ازازة', tote: 'bag شنطة', phonecase: 'cover iphone samsung كفر',
      notebook: 'كراسة دفتر', mousepad: 'mouse pad', deskmat: 'mouse pad', keychain: 'key ring keyring key chain ميداليه ميدالية مفاتيح سلسلة مفاتيح', stickersheet: 'stickers ستيكر لزق',
      flyers: 'flyer flier leaflet فلاير منشورات',
      bizcards: 'business cards visit كارت فيزيت', canvas: 'painting wall art لوحة', canvaswide: 'painting wall art لوحة', photoprints: 'photos pictures صور',
      storybook: 'kids book story كتاب قصة اطفال', coloringbook: 'kids book coloring تلوين اطفال', caketopper: 'cake topper تورتة', namepuzzle: 'puzzle بازل',
      engrpen: 'pen pens ballpoint قلم اقلام أقلام قلم جاف', engrwallet: 'wallet purse محفظة محفظه محافظ',
      calendar: 'calendar نتيجه نتيجة تقويم نتيجة حيطة', deskcalendar: 'calendar نتيجه نتيجة تقويم مكتب', labels: 'label sticker ليبل استيكر لاصق', banners: 'banner بانر يافطة فليكس لافتة',
      menus: 'menu منيو قايمة طعام مطعم كافيه', brochures: 'brochure flyer leaflet بروشور مطوية', booklets: 'catalog catalogue booklet كتالوج كتيب', folders: 'folder فولدر ملف',
      notepads: 'notepad pad بلوك نوت مفكرة', postcards: 'postcard thank you card بوستكارد كارت شكر', giftvouchers: 'voucher gift card كوبون قسيمة جيفت كارد',
      magnets: 'magnet fridge مغناطيس مغنطيس تلاجة ثلاجة', wrappingpaper: 'gift wrap ورق هدايا تغليف', windowstickers: 'window decal vinyl ستيكر فاترينة زجاج',
      photobook: 'album photo book البوم صور', tablenumbers: 'wedding table number ارقام ترابيزات فرح', placecards: 'wedding place name card كروت اسامي فرح معازيم', bookmarks: 'bookmark فاصل كتاب',
    };
    // search-kit:start (the same lines are in public/index.html and public/js/designs.js; test/search-kit.test.js checks both)
    // Forgiving search: what the typed words find, plus plurals (hoodies, تيشيرتات), one word or two (t-shirt, tshirt),
    // both spellings of تيشيرت, and the shop's words for the same thing in either language (mug, مج, كوباية).
    const SEARCH = (() => {
      // Ignore case, Arabic short vowels and tatweel (U+064B-U+065F stops before the Arabic-Indic digits U+0660-U+0669),
      // the alef / yaa / taa marbuta spellings, and Arabic-Indic / Persian digits (100 typed in Arabic digits finds 100).
      const norm = (s) => String(s || '').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
        .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        // ("بابا نويل" is Santa, not dad: one word of its own, so a Father's Day search doesn't list Christmas. QA 25 Nov.)
        .replace(/(^| )بابا نويل(?= |$)/g, '$1santa')
        .trim();
      // Spelt with or without the long ي (تيشرت / تيشيرت).
      const loose = (s) => s.replace(/ي/g, '').replace(/ +/g, ' ');
      // The same thing said other ways, in both languages (two words keep their space; plurals are found anyway).
      const SAME = {
        tshirt: 'tshirt, t shirt, tee, tee shirt, shirt, تيشيرت, تي شيرت, تشيرت, قميص, قمصان',
        hoodie: 'hoodie, hoody, هودي',
        sweatshirt: 'sweatshirt, sweat shirt, سويتشيرت, سويت شيرت',
        cap: 'cap, hat, كاب, كاسكيت, قبعة, طاقية',
        mug: 'mug, cup, مج, مجات, مجين, ماج, كوب, كوباية, فنجان, فناجين',
        bag: 'bag, شنطة, شنط, كيس, اكياس',
        card: 'card, كارت, كروت, كارد, بطاقة',
        bizcard: 'business card, visit card, visiting card, بيزنس كارد, بيزنس كارت, بزنس كارد, بزنس كارت, كارت بيزنس, كارت بزنس, كروت بيزنس, كروت بزنس, كارت شخصي, كروت شخصية, كارت فيزيت',
        // (One word alone, as the English "business": everything for a business.)
        business: 'business, بيزنس, بزنس',
        catalog: 'catalog, catalogue, كتالوج, كاتلوج, كاتالوج, كتلوج',
        invitation: 'invitation, invite, دعوة',
        wedding: 'wedding, فرح, أفراح, زفاف',
        poster: 'poster, بوستر',
        notebook: 'notebook, note book, نوت بوك, نوتبوك, كشكول, كشاكيل',
        calendar: 'calendar, نتيجة, تقويم, نتايج',
        sticker: 'sticker, ستيكر, استيكر',
        pillow: 'pillow, cushion, pillowcase, pillow case, cushion cover, كوشن, مخدة, خدادية, وسادة, كيس مخدة',
        // (Not كانفاس or canvas alone: the tote bag and the pencil case are canvas too.)
        canvasprint: 'canvas print, wall canvas, لوحة كانفاس, تابلوه, تابلو',
        photobook: 'photo book, photobook, photo album, فوتو بوك, فوتوبوك, البوم صور',
        idcard: 'id card, id badge, name badge, badge, بادج, كارنيه',
        phonecase: 'phone case, phone cover, mobile case, mobile cover, جراب, جراب موبايل, كفر موبايل',
        christmas: 'christmas, xmas, كريسماس',
        santa: 'santa, santa claus, سانتا, سانتا كلوز',
        // (Arabic as found as English: هدية / هدايا / gift, قهوة / coffee, شاي / tea. QA 25 Nov.)
        gift: 'gift, gifts, present, هدية, هدايا, هديه',
        coffee: 'coffee, قهوة, قهوه, نسكافيه',
        tea: 'tea, شاي, شاى',
        birthday: 'birthday, عيد ميلاد',
        dog: 'dog, puppy, كلب, كلاب',
        cat: 'cat, kitten, قطة, قطط',
        kids: 'kids, kid, children, child, اطفال, طفل, ولاد, اولاد',
        // ("Mother's Day" is searched as "mother day": the 's is left out below.)
        mom: 'mom, mum, mommy, mummy, mama, mother, mother day, mothers day, ماما, الام, امي, عيد الام',
        dad: 'dad, daddy, papa, father, father day, fathers day, بابا, الاب, ابويا, عيد الاب',
        // (Valentine's Day, Teacher's Day, a new baby and the prayer mat (مصلية), in either language. QA 25 Nov.)
        valentine: 'valentine, valentines, valentine day, عيد الحب, عيد حب, فالنتاين, فلانتين',
        teacher: 'teacher, teachers day, teacher day, معلم, المعلم, عيد المعلم, مدرس, يوم المعلم',
        baby: 'baby, newborn, بيبي, نونو, مولود',
        prayermat: 'prayer mat, prayer rug, سجادة صلاة, مصلية, مصلاية',
      };
      const sameAs = new Map();
      for (const [k, list] of Object.entries(SAME)) for (const w of list.split(',')) sameAs.set(norm(w), k);
      /** A word and what else it may be written as: the singular of a plural (hoodies, boxes, puppies, wolves,
          تيشيرتات, مدرسين, ستيكرز) and a word without its taa marbuta (شنطة → شنط finds شنط ورق). */
      function forms(w) {
        const out = [w];
        if (/^[a-z]+$/.test(w) && w.length > 3) {
          if (w.length > 4 && w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
          if (w.length > 4 && w.endsWith('ves')) out.push(w.slice(0, -3) + 'f', w.slice(0, -3) + 'fe');
          if (/(s|x|z|ch|sh)es$/.test(w)) out.push(w.slice(0, -2));
          if (/[^siu]s$/.test(w)) out.push(w.slice(0, -1));
        } else if (/^[\u0621-\u064A]+$/.test(w)) {
          if (w.endsWith('ات') && w.length >= 5) out.push(w.slice(0, -2), w.slice(0, -2) + 'ه');
          if ((w.endsWith('ين') || w.endsWith('ون')) && w.length >= 6) out.push(w.slice(0, -2));
          if (w.endsWith('ز') && w.length >= 5) out.push(w.slice(0, -1));
          if (w.endsWith('ه') && w.length >= 4) out.push(w.slice(0, -1));
        }
        return [...new Set(out)];
      }
      // The word after "the" / "for the" / "with the" / "and the" in front (التيشيرتات, للأفراح), when 3 letters or more
      // are left; after "the" / "for the", 2 are enough (الأم, للأب); "for" alone before an alef with 3 left (لأمي).
      // A word of 2 is only looked for with its article (للأب: الأب, as the shop's words list it): أب alone is also the
      // "up" of ليفل أب and ستارت أب. One of the shop's words of 2 (مج, الأم, الأب) also after "with the" / "and the"
      // (بالمج, والأب; not بالون or والده), and مج, a word of the shop alone, also without its article: المج, للمج, والمج
      // and بالمج find what مج finds.
      const article = (w) => {
        const m = /^(?:وال|بال|لل|ال)([ء-ي]{3,})$|^(?:لل|ال)([ء-ي]{2})$|^ل(ا[ء-ي]{2,})$|^(?:وال|بال)([ء-ي]{2})$/.exec(w);
        if (!m) return '';
        return m[4] ? (sameAs.has(m[4]) || sameAs.has(`ال${m[4]}`) ? m[4] : '') : m[1] || m[2] || m[3];
      };
      const bare = (w) => { const c = article(w); return !c ? [w] : c.length === 2 ? [w, `ال${c}`, ...(sameAs.has(c) ? [c] : [])] : [w, c]; };
      const allForms = (w) => [...new Set(bare(w).flatMap(forms))];
      const conceptsOf = (w) => [...new Set(allForms(w).map((f) => sameAs.get(f)).filter(Boolean))];
      /** Two words that name one thing: "t shirt", "business cards", "بيزنس كارد". */
      function pairConcepts(a, b) {
        const out = new Set();
        for (const x of allForms(a)) {
          for (const y of forms(b)) {
            for (const k of [`${x} ${y}`, x + y]) if (sameAs.has(k)) out.add(sameAs.get(k));
          }
        }
        return [...out];
      }
      /** A text to search in: its words (as before), the other forms of its words, and the things they name.
          looseAnywhere: a typed word without its ي is looked for anywhere, however short (as the home page always
          did); otherwise at the start of a word and with three letters or more, so تيشرت finds تيشيرت but رسم does
          not find كريسماس (كرسماس) and في does not find every ف. */
      function index(text, looseAnywhere) {
        const ws = norm(text).split(' ').filter(Boolean);
        const extra = new Set();
        const concepts = new Set();
        ws.forEach((w, i) => {
          for (const f of allForms(w)) if (f !== w) extra.add(f);
          for (const c of conceptsOf(w)) concepts.add(c);
          if (i + 1 < ws.length) for (const c of pairConcepts(w, ws[i + 1])) concepts.add(c);
        });
        const all = ` ${ws.join(' ')} ${[...extra].join(' ')} `;
        return { text: all, loose: loose(all), concepts, looseAnywhere: Boolean(looseAnywhere) };
      }
      /** The words of a search: each as typed, its other forms and what it names; two words that name one thing
          ("t shirts", "بيزنس كارد") also count as one. */
      function query(q) {
        // (A lone "s" is the English 's: "mother's day" is "mother day".)
        const ws = norm(q).split(' ').filter((w, i) => w && !(w === 's' && i > 0));
        const one = (w) => ({ word: w, forms: allForms(w).filter((f) => f !== w), concepts: conceptsOf(w) });
        const terms = [];
        for (let i = 0; i < ws.length; i++) {
          const both = i + 1 < ws.length ? pairConcepts(ws[i], ws[i + 1]) : [];
          if (both.length) {
            terms.push({ word: '', forms: forms(ws[i] + ws[i + 1]), concepts: both, or: [one(ws[i]), one(ws[i + 1])] });
            i++;
          } else terms.push(one(ws[i]));
        }
        return terms;
      }
      // A word as typed is found anywhere in a word, as before (with start: at the start of one, to rank names).
      // Its other forms only as whole words ("dogs" → dog, not dogma; "cars" → car, not card), or by what it names.
      // An Arabic word of three letters (most Arabic words are built on three) inside a longer word is another word:
      // it counts at the start of a word only, and without its ي not at all, on both pages (كيس is not the كس of
      // اكسسوارات, ليل not the لل of للأعمال). One or two letters are a word still being typed: found as before.
      // The same rule for a word of two or three letters after its article (الأم, للأب, لأمي): that word after an article
      // (or none, for three letters) at the start of a word; one of the shop's words (الأم, الأب) as a whole word.
      // الأم is not in الامتحانات, للأب not in للأبد, الأب not in الأبعاد, لأمي (without its ي, لام) not in لاما.
      function hasShort(h, word, core, whole) {
        const end = whole || (core.length === 2 && (sameAs.has(core) || sameAs.has(`ال${core}`))) ? ' ' : '';
        const lc = loose(core);
        return ['', 'ال', 'لل', 'بال', 'وال'].some((p) => [word, core].some((w) => (p || w.length > 2) && h.text.includes(` ${p}${w}${end}`))
          || (lc.length > 2 && h.loose.includes(` ${p}${lc}${end}`)));
      }
      // start 'word': the words as whole words only (or another form, or what they name), to rank names: a mug (مج,
      // the same as كوب) before كوبونات, the cap (كاب) before للكابلز, whose words only start with what was typed.
      function has(h, term, start) {
        const whole = start === 'word';
        const core = article(term.word);
        if (core && core.length <= 3) {
          if (hasShort(h, term.word, core, whole)) return true;
          return term.forms.some((f) => h.text.includes(` ${f} `)) || term.concepts.some((c) => h.concepts.has(c));
        }
        const short = term.word.length === 3 && /^[ء-ي]+$/.test(term.word);
        const at = start || short ? ' ' : '';
        const end = whole ? ' ' : '';
        const lw = loose(term.word);
        const looseHit = h.looseAnywhere && !short && !whole ? h.loose.includes(at + lw) : lw.length > 2 && h.loose.includes(` ${lw}${end}`);
        if (term.word && (h.text.includes(at + term.word + end) || looseHit)) return true;
        if (term.forms.some((f) => h.text.includes(` ${f} `) || h.loose.includes(` ${loose(f)} `))) return true;
        return term.concepts.some((c) => h.concepts.has(c)) || Boolean(term.or && term.or.every((x) => has(h, x, start)));
      }
      /** Every word of the search is in the indexed text. */
      const match = (h, terms, start) => terms.every((term) => has(h, term, start));
      return { norm, loose, forms, index, query, match };
    })();
    // search-kit:end
    const { norm, loose } = SEARCH;
    const catName = (id) => (categories.find((c) => c.id === id) || {}).name || {};
    // A product's sizes and quantities, by id and in both languages: "tshirt xl", "A5 flyers", "كروت شخصية 100", "مج 11oz".
    // (Not "One size" / "مقاس واحد": "size", "one" or "واحد" alone would list every bag and cap.)
    const sizeWords = (p) => (p.sizes || []).filter((z) => z.id !== 'one').flatMap((z) => [z.id, z.label && z.label.en, z.label && z.label.ar]).filter(Boolean).join(' ');
    // Its colours in both languages: "white t-shirt", "هودي اسود", "مج ابيض" list the products that come in that colour.
    // Only the colour's name, not the note after it: the magic mug is black "(turns white when hot)", not a white mug.
    // With the other ways people say a colour (QA 26 Nov): the feminine (شنطة سوداء / سودا, تيشرت بيضا, حمرا, خضرا,
    // زرقا, صفرا), gray for grey and رصاصي for رمادي, beige for the shop's Sand (بيج), ذهبي for دهبي, بمبي / بينك for
    // pink, burgundy for maroon (both نبيتي).
    const COLOR_SAME = ['أسود سوداء سودا', 'أبيض بيضاء بيضا', 'أحمر حمراء حمرا', 'أخضر خضراء خضرا', 'أزرق زرقاء زرقا', 'أصفر صفراء صفرا',
      'grey gray رمادي رصاصي', 'sand beige بيج', 'دهبي ذهبي', 'pink وردي بمبي بينك', 'maroon burgundy نبيتي'];
    const colorWords = (p) => {
      const names = (p.colors || []).flatMap((c) => [c.name && c.name.en, c.name && c.name.ar]).filter(Boolean).map((n) => n.split(/[(:,،]/)[0]).join(' ');
      const ws = ` ${norm(names)} `;
      return [names, ...COLOR_SAME.filter((g) => norm(g).split(' ').some((w) => ws.includes(` ${w} `)))].join(' ');
    };
    const hay = new Map(products.map((p) => {
      const name = `${p.name.en} ${p.name.ar}`;
      const text = [p.id, name, catName(p.category).en, catName(p.category).ar, ALIASES[p.id] || ALIASES[POD.assetId(p)] || '', sizeWords(p)].join(' ');
      const named = SEARCH.index(name, true);
      // (true: everything the shop's search found before is still found.) The description on its own (see inText), and
      // the name also as it is spelt, without the forgiving ي (see rank).
      return [p.id, { all: SEARCH.index(text, true), about: SEARCH.index([p.description && p.description.en, p.description && p.description.ar].join(' '), true), name: ` ${norm(name)} `, named, spelt: { ...named, loose: '' }, sized: SEARCH.index(sizeWords(p), true), colored: SEARCH.index(colorWords(p)) }];
    }));
    // The search, on product text only: markup typed into the box ("<b>") is not a word.
    const typed = () => q.replace(/<[^<>]*>/g, ' ');
    // Its words as typed (names with them come first), and with their other forms (what finds the products).
    const terms = () => norm(typed()).split(' ').filter(Boolean);
    // One of the product's colours: a whole word, as typed or in another form ("whites", "الأبيض"), and spelt as it is
    // (not without its ي), so "mat" is not the matte cards, "black" not the blackout curtains, ورد not pink (وردي).
    const isColor = (h, term) => [term.word, ...term.forms].some((f) => f && h.colored.text.includes(` ${f} `));
    // A year with a calendar ("calendar 2027", "نتيجة 2027"): the calendars are made for any year (QA 26 Nov).
    const forYear = (h, term) => /^20\d\d$/.test(term.word) && h.all.concepts.has('calendar');
    // The product's text: its id, names, category, the shop's words for it and its sizes, as before; in its description
    // (sentences) an English word counts from the start of a word ("print": printed), not inside another: "hat" is not
    // the "that" of the envelopes, the puzzle and the wallet, "sign" not "design", "pen" not "opens", "tee" not "steel"
    // (QA 26 Nov). Arabic as before (و, ب, ف join the word after them). Two words that may name one thing ("business
    // cards") also count each in either place, as when they were one text.
    const inText = (h, term) => SEARCH.match(h.all, [term]) || SEARCH.match(h.about, [term], /[a-z]/.test(term.word || term.or[0].word) || undefined)
      || Boolean(term.or && term.or.every((x) => inText(h, x)));
    // Every word is in the product's text, is one of its colours, or is a year for a calendar.
    const found = (p, qs) => { const h = hay.get(p.id); return qs.every((term) => inText(h, term) || isColor(h, term) || forYear(h, term)); };
    return (words) => { // header only
      q = String(words || '').slice(0, 60); // header only
      const ts = terms();
      const qs = SEARCH.query(typed());
      const searching = Boolean(q.trim());
      let list = products.filter((p) => (cat === 'all' || p.category === cat) && (!searching || (ts.length && found(p, qs))));
      const rank = (p) => { const h = hay.get(p.id); const tz = ts.filter((w) => ts.length < 2 || !SEARCH.match(h.sized, SEARCH.query(w))); const tc = tz.filter((w) => !SEARCH.query(w).every((term) => isColor(h, term) || forYear(h, term))); const tw = tc.length ? tc : tz; const tq = tw.length === ts.length ? qs : SEARCH.query(tw.join(' ')); return SEARCH.match(h.spelt, tq, 'word') ? 0 : tw.every((w) => h.name.includes(` ${w}`)) ? 1 : SEARCH.match(h.named, tq, 'word') || tw.every((w) => loose(h.name).includes(` ${loose(w)}`)) ? 2 : SEARCH.match(h.named, tq, true) ? 3 : 4; };
      if (ts.length) list = list.map((p, i) => [rank(p), i, p]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
      return list; // header only
    }; // header only
  } // header only
  // site-search:end

  const MAX = 5;
  const btn = document.querySelector('[data-site-search]');
  const panel = document.getElementById('site-search');
  if (!btn || !panel) return;
  const form = panel.querySelector('form');
  const input = panel.querySelector('input');
  const list = panel.querySelector('.site-search-list');
  const none = panel.querySelector('.site-search-none');

  // The catalogue (asked for once, when the bar first opens) and the lifestyle photos the home page shows.
  let ready = null;
  function load() {
    if (!ready) {
      const life = fetch('/img/lifestyle/index.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      ready = Promise.all([POD.loadCatalog(), life]).then(([catalog, pics]) => ({
        find: makeFinder(catalog.products || [], catalog.categories || []),
        products: catalog.products || [],
        life: pics || {},
      })).catch((e) => {
        ready = null; // (no connection: the next try asks again)
        throw e;
      });
    }
    return ready;
  }

  // As the home page's cards link: a book to its page, photo prints to /photos, the rest to the product page.
  const hrefOf = (p) => (p.kind === 'book' ? `/book?b=${encodeURIComponent(p.book)}` : p.kind === 'photoset' ? '/photos' : `/product?id=${encodeURIComponent(p.id)}`);
  // The manager's photo, else the lifestyle photo, else the product photo.
  function picture(p, life) {
    const l = !p.mainPhoto && life[POD.assetId(p)];
    const src = l && l.file ? l.file : POD.productPicture(p, POD.firstPick(p.colors));
    return `<img alt="" width="48" height="48" loading="lazy" decoding="async" src="${esc(src)}" data-pid="${esc(p.id)}">`;
  }

  let shown = '';
  let typing = null;
  async function suggest() {
    const words = input.value.trim();
    shown = words;
    if (!words) {
      list.hidden = true;
      list.innerHTML = '';
      none.hidden = true;
      return;
    }
    let data;
    try {
      data = await load();
    } catch (e) {
      return; // (no connection: Enter still opens the full results)
    }
    if (shown !== words) return; // (typed on meanwhile)
    const found = data.find(words).slice(0, MAX);
    none.hidden = found.length > 0;
    list.hidden = !found.length;
    list.innerHTML = found.map((p) => `<li><a class="site-search-item" href="${hrefOf(p)}">${picture(p, data.life)}<span class="site-search-name">${esc(tr(p.name))}</span><span class="site-search-price">${esc(t('search.from', { price: money(POD.fromPrice(p)) }))}</span></a></li>`).join('');
  }
  // A picture that doesn't load: the drawn product instead.
  list.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallback || !ready) return;
    img.dataset.fallback = '1';
    ready.then((d) => {
      const p = d.products.find((x) => x.id === img.dataset.pid);
      if (p) img.src = POD.thumbFallback(p, POD.firstPick(p.colors));
    }).catch(() => {});
  }, true);

  const isOpen = () => !panel.hidden;
  function open() {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    input.focus(); // (in the tap itself, so phones open the keyboard)
    load().catch(() => {});
    if (input.value.trim()) suggest();
  }
  function close(focusButton) {
    if (!isOpen()) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusButton) btn.focus();
  }
  btn.addEventListener('click', () => (isOpen() ? close(true) : open()));
  panel.querySelector('[data-site-search-close]').addEventListener('click', () => close(true));
  input.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(suggest, 120);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const words = input.value.trim().slice(0, 60);
    if (!words) {
      input.focus();
      return;
    }
    location.href = `/?q=${encodeURIComponent(words)}#products`;
  });
  // Escape closes (focus back on the magnifier); the arrow keys move between the box and the suggestions.
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = list.hidden ? [] : [...list.querySelectorAll('a')];
    if (!links.length) return;
    const at = links.indexOf(document.activeElement);
    e.preventDefault();
    if (e.key === 'ArrowDown') (links[at + 1] || links[0]).focus();
    else if (at <= 0) input.focus();
    else links[at - 1].focus();
  });
  // A tap outside the header closes the bar.
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && e.target instanceof Element && !e.target.closest('.site-header')) close(false);
  });
  document.addEventListener('pod:langchange', () => {
    if (isOpen() && input.value.trim()) suggest();
  });
  // Coming back to a page (Back): the bar is closed, as the page was left.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) close(false);
  });
})();
