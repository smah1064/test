'use strict';

/**
 * Personalised children's books.
 *
 *  - "space-hero": a picture book where the child is the hero. The child's
 *    real face (a circle cropped from their photo) sits on the hero in every
 *    illustration; their answers (name, birthday, parents, city, favourite
 *    fruit and animal, best friend) are written into the story, and the fruit
 *    and animal they choose appear in the pictures.
 *  - "dream-jobs": a colouring book. The child's photo is turned into line
 *    art and becomes the face of the character on every page, with their name
 *    in hollow letters to colour in.
 *
 * Pages are built on the server with sharp: illustration + face + companions +
 * Arabic/English text (shaped by Pango with the shop's own fonts). The same
 * code makes the small previews and the 300 DPI print pages.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');

const ASSETS = path.join(__dirname, 'book-assets');
const FONTS = path.join(__dirname, 'book-fonts');

const TRIM_IN = 8; // 8 x 8 inch book (20 x 20 cm)
const BLEED_IN = 0.125;
const PAGE_IN = TRIM_IN + 2 * BLEED_IN;
const PRINT_PX = Math.round(PAGE_IN * 300); // 2475 px at 300 DPI

const t = (en, ar) => ({ en, ar });

// ---------- Answers ----------
const FRUITS = {
  apple: t('apples', 'التفاح'),
  banana: t('bananas', 'الموز'),
  mango: t('mangoes', 'المانجو'),
  strawberry: t('strawberries', 'الفراولة'),
  orange: t('oranges', 'البرتقال'),
  watermelon: t('watermelon', 'البطيخ'),
  grapes: t('grapes', 'العنب'),
  guava: t('guavas', 'الجوافة'),
};
const FRUIT_LABELS = {
  apple: t('Apple', 'تفاح'), banana: t('Banana', 'موز'), mango: t('Mango', 'مانجو'), strawberry: t('Strawberry', 'فراولة'),
  orange: t('Orange', 'برتقال'), watermelon: t('Watermelon', 'بطيخ'), grapes: t('Grapes', 'عنب'), guava: t('Guava', 'جوافة'),
};
const ANIMALS = {
  cat: t('kitten', 'القط الصغير'),
  dog: t('puppy', 'الكلب الصغير'),
  rabbit: t('bunny', 'الأرنب الصغير'),
  lion: t('lion cub', 'الأسد الصغير'),
  camel: t('baby camel', 'الجمل الصغير'),
  panda: t('panda', 'الباندا الصغير'),
};
const ANIMAL_LABELS = {
  cat: t('Cat', 'قطة'), dog: t('Dog', 'كلب'), rabbit: t('Rabbit', 'أرنب'), lion: t('Lion', 'أسد'), camel: t('Camel', 'جمل'), panda: t('Panda', 'باندا'),
};
const options = (map) => Object.keys(map).map((id) => ({ id, label: map[id] }));

// A birthday is any real day from 1900 up to today. It is only written in the story ("born on 12 March
// 1985", "every year on 12 March"), so a book for a grown-up (a gift for Mama) is fine too; the old
// 1990 limit turned such birthdays away as "not a real date".
const OLDEST_BIRTHDAY = '1900-01-01';
const Q = {
  name: { id: 'name', type: 'text', label: t("Child's name", 'اسم الطفل'), max: 20, required: true },
  gender: { id: 'gender', type: 'choice', label: t('Boy or girl', 'ولد ولا بنت'), options: [{ id: 'boy', label: t('Boy', 'ولد') }, { id: 'girl', label: t('Girl', 'بنت') }], required: true },
  birthday: { id: 'birthday', type: 'date', label: t('Birthday', 'تاريخ الميلاد'), required: true, min: OLDEST_BIRTHDAY },
  city: { id: 'city', type: 'text', label: t('City', 'المدينة'), max: 24, placeholder: t('Cairo', 'Cairo'), required: true },
  father: { id: 'father', type: 'text', label: t("Father's name", 'اسم الأب'), max: 20, required: true },
  mother: { id: 'mother', type: 'text', label: t("Mother's name", 'اسم الأم'), max: 20, required: true },
  fruit: { id: 'fruit', type: 'choice', label: t('Favourite fruit', 'الفاكهة المفضلة'), options: options(FRUIT_LABELS), required: true, pictures: 'fruit' },
  animal: { id: 'animal', type: 'choice', label: t('Favourite animal (the space buddy)', 'الحيوان المفضل (رفيق الرحلة)'), options: options(ANIMAL_LABELS), required: true, pictures: 'animal' },
  friend: { id: 'friend', type: 'text', label: t("Best friend's name", 'اسم أعز صديق'), max: 20, required: true },
  dedication: { id: 'dedication', type: 'textarea', label: t('Dedication (optional)', 'إهداء (اختياري)'), max: 220, required: false },
};

// ---------- Book definitions ----------
// Text uses {placeholders} and [[boy form|girl form]] for words that change
// with the child's gender. Face circles and companions are in percent of the page.
const BOOKS = {
  'space-hero': {
    id: 'space-hero',
    kind: 'story',
    product: 'storybook',
    dir: 'space',
    title: t('{name} in Space', '{name} في الفضاء'),
    blurb: t(
      'A space adventure where your child is the hero: their face in every picture, their name, birthday, family, best friend, favourite fruit and animal in the story.',
      'مغامرة في الفضاء بطلها طفلك: وجهه في كل صورة، واسمه وتاريخ ميلاده وعائلته وصديقه وفاكهته وحيوانه المفضل في الحكاية.'
    ),
    questions: [Q.name, Q.gender, Q.birthday, Q.city, Q.father, Q.mother, Q.fruit, Q.animal, Q.friend, Q.dedication],
    pages: [
      { img: 'cover', type: 'cover', face: [62.2, 56, 11.5, 7.5], title: t('{name}', '{name}'), subtitle: t('in Space', 'في الفضاء') },
      {
        img: '01', type: 'dedication',
        text: t(
          'For {name},\nour little star, born on {birthday}.\nEvery star in the sky shines for you.\n\n{from}',
          'إلى {name}،\n[[نجمنا الصغير الذي وُلد|نجمتنا الصغيرة التي وُلدت]] في {birthday}.\nكل نجوم السماء تلمع من أجلك.\n\n{from}'
        ),
      },
      {
        img: '02', face: [46.3, 34.3, 12.5, 7.5],
        text: t(
          'In the beautiful city of {city} lived a [[boy|girl]] called {name}. Every night, {name} looked at the stars through [[his|her]] telescope and dreamed of flying up to meet them.',
          'في مدينة {city} الجميلة، [[عاش ولد اسمه|عاشت بنت اسمها]] {name}. كل ليلة [[كان ينظر|كانت تنظر]] إلى النجوم بالتلسكوب، [[ويحلم|وتحلم]] بالسفر إليها.'
        ),
      },
      {
        img: '03', face: [37.5, 39, 16, 8],
        text: t(
          'On the night of [[his|her]] birthday, a little star tapped on the window. “Happy birthday, {name}! The stars have chosen you for a very special space mission!”',
          'وفي ليلة عيد [[ميلاده|ميلادها]]، طرقت نجمة صغيرة على النافذة وقالت: «كل سنة وأنت [[طيب|طيبة]] يا {name}! النجوم اختارتك لمهمة فضائية مهمة!»'
        ),
      },
      {
        img: '04', face: [83.5, 42.8, 9.5, 6], companions: [{ kind: 'animal', x: 17, y: 62, w: 20 }],
        text: t(
          '{name} put on a shiny spacesuit and packed a bag full of {fruit}, [[his|her]] favourite fruit. [[His|Her]] loyal friend, the little {animal}, came along as co-pilot.',
          '[[لبس|لبست]] {name} بدلة الفضاء، [[وجهّز|وجهّزت]] حقيبة مليئة بـ{fruit}، [[فاكهته|فاكهتها]] المفضلة. وجاء {animal}، [[صديقه|صديقها]] الوفي، ليكون مساعد القائد.'
        ),
      },
      {
        img: '05', face: [60.5, 29.8, 6.5, 4],
        text: t(
          'Three… two… one… lift-off from {city}! Baba {father} and Mama {mother} waved from the rooftop: “Have a wonderful trip, {name}! We are so proud of you!”',
          'ثلاثة… اثنان… واحد… انطلق الصاروخ من {city}! ولوّح بابا {father} وماما {mother} من فوق السطح: «رحلة سعيدة يا {name}، نحن فخوران بك!»'
        ),
      },
      {
        img: '06', face: [34.2, 31.8, 9.5, 6], companions: [{ kind: 'animal', x: 79, y: 60, w: 19 }],
        text: t(
          'The rocket landed on the Moon. {name} jumped higher and higher, because gravity there is so light! The little {animal} giggled and bounced along beside [[him|her]].',
          'هبط الصاروخ على القمر. [[قفز|قفزت]] {name} عاليًا عاليًا، فالجاذبية هنا خفيفة جدًا! وضحك {animal} وهو يقفز [[بجانبه|بجانبها]].'
        ),
      },
      {
        img: '07', face: [54.8, 33.8, 10.5, 7.5],
        text: t(
          'Next, {name} flew to a planet with shiny, colourful rings and slid down them like the biggest slide in the universe!',
          'ثم [[طار|طارت]] {name} إلى كوكب له حلقات ملوّنة لامعة، [[وتزحلق|وتزحلقت]] عليها كأنها أكبر زحليقة في الكون!'
        ),
      },
      {
        img: '08', face: [31.5, 30.8, 13.5, 9], companions: [{ kind: 'fruit', x: 50.5, y: 45, w: 11 }],
        text: t(
          'On a pink planet, {name} met a small, hungry alien. {name} shared some {fruit} and said, “Sharing makes friends!” The alien smiled, and they became best friends.',
          'على كوكب وردي، [[قابل|قابلت]] {name} مخلوقًا فضائيًا صغيرًا جائعًا. [[فأعطاه|فأعطته]] بعض {fruit} [[وقال|وقالت]]: «المشاركة تصنع الأصدقاء!» فابتسم المخلوق وصارا صديقين.'
        ),
      },
      {
        img: '09', face: [33.2, 44.5, 13, 9], companions: [{ kind: 'animal', x: 72, y: 55, w: 20 }],
        text: t(
          'Suddenly, a storm of space rocks appeared! {name} held the wheel steady, the little {animal} pressed the buttons, and together they steered the rocket bravely through.',
          'فجأة ظهرت عاصفة من الصخور الفضائية! [[أمسك|أمسكت]] {name} المقود بثبات، وضغط {animal} على الأزرار، وعبرا معًا بين الصخور بشجاعة.'
        ),
      },
      {
        img: '10', face: [29.5, 33, 15, 10],
        text: t(
          'Then {name} heard a soft little cry. A baby star had lost its way. {name} carried it gently back to its family, and the whole sky lit up with joy.',
          'ثم [[سمع|سمعت]] {name} بكاءً خفيفًا. كانت نجمة صغيرة قد ضلّت طريقها. [[حملها|حملتها]] {name} بلطف [[وأعادها|وأعادتها]] إلى عائلتها، فأضاءت السماء من الفرح.'
        ),
      },
      {
        img: '11', face: [57.5, 37.5, 11, 6], companions: [{ kind: 'animal', x: 13, y: 50, w: 16 }],
        text: t(
          'To say thank you, the stars wrote {name}’s name across the sky in light. “From now on, a new star called {name} will shine every year on {birthdayDay}!”',
          'شكرت النجوم {name} [[وكتبت اسمه|وكتبت اسمها]] بالضوء في السماء، وقالت: «من الآن، ستلمع نجمة جديدة باسم {name} كل عام يوم {birthdayDay}!»'
        ),
      },
      {
        img: '12', face: [50.1, 48.9, 6, 5.1],
        text: t(
          '{name} flew home, where Baba {father} and Mama {mother} gave [[him|her]] the biggest hug. The next morning, {name} told {friend} the whole story: “Big dreams start with a look at the sky.” The End.',
          '[[عاد|عادت]] {name} إلى البيت، [[وحضنه|وحضنها]] بابا {father} وماما {mother}. وفي الصباح [[حكى|حكت]] {name} الحكاية لـ{friend} [[وقال|وقالت]]: «الأحلام الكبيرة تبدأ بنظرة إلى السماء.» النهاية.'
        ),
      },
      { type: 'back' },
    ],
  },
  'dream-jobs': {
    id: 'dream-jobs',
    kind: 'coloring',
    product: 'coloringbook',
    dir: 'dreams',
    title: t("{name}'s Big Dreams", 'أحلام {name}'),
    blurb: t(
      "A colouring book where your child's photo becomes the face of an astronaut, doctor, footballer, chef and more, with their name in big letters to colour.",
      'كتاب تلوين صورة طفلك فيه بتتحول لرسمة وتبقى وش رائد الفضاء والدكتور ولاعب الكورة والشيف وغيرهم، واسمه بحروف كبيرة يلوّنها.'
    ),
    questions: [Q.name, Q.gender],
    pages: [
      { img: 'cover', type: 'cover', face: [49.8, 58, 9.3, 7.6], title: t("{name}'s Big Dreams", 'أحلام {name}'), subtitle: t('Colouring book', 'كتاب تلوين') },
      { type: 'belongs', caption: t('This book belongs to {name}', 'هذا الكتاب [[ملك|ملك]] {name}') },
      { img: 'astronaut', face: [51.3, 40.1, 13.2, 12.7], caption: t('{name} the Astronaut', '{name} [[رائد|رائدة]] فضاء') },
      { img: 'doctor', face: [52.5, 37.5, 15, 12.7], caption: t('Doctor {name}', '[[الدكتور|الدكتورة]] {name}') },
      { img: 'footballer', face: [51, 37.1, 16, 16.6], caption: t('{name} the Footballer', '{name} [[لاعب|لاعبة]] كورة') },
      { img: 'pilot', face: [52.6, 45.3, 15, 14.6], caption: t('Captain {name}', '[[الكابتن الطيار|الكابتن الطيارة]] {name}') },
      { img: 'chef', face: [54.5, 38.9, 11.4, 10.6], caption: t('Chef {name}', 'الشيف {name}') },
      { img: 'firefighter', face: [41.1, 37, 13, 11.6], caption: t('{name} the Firefighter', '{name} [[بطل|بطلة]] الإطفاء') },
      { img: 'superhero', face: [42.5, 35, 12.3, 12.7], caption: t('Super {name}', '{name} [[البطل الخارق|البطلة الخارقة]]') },
      { img: 'painter', face: [36.5, 36.8, 13.6, 13.6], caption: t('{name} the Artist', '{name} [[الفنان|الفنانة]]') },
      { img: 'scientist', face: [50.5, 40.5, 13, 13.6], caption: t('{name} the Scientist', '{name} [[العالِم|العالِمة]]') },
      { img: 'engineer', face: [51.1, 36.8, 16.5, 16.8], caption: t('{name} the Engineer', '{name} [[المهندس|المهندسة]]') },
      { img: 'teacher', face: [30.7, 43.9, 15, 12.8], caption: t('Teacher {name}', '[[الأستاذ|الأستاذة]] {name}') },
      { img: 'vet', face: [54.8, 34.6, 16.7, 14], caption: t('{name} the Vet', '{name} [[طبيب|طبيبة]] الحيوانات') },
      { img: 'explorer', face: [35.3, 42.2, 11, 10.6], caption: t('{name} the Explorer', '{name} [[المستكشف|المستكشفة]]') },
      { type: 'draw', caption: t('Draw your dream here', 'ارسم حلمك هنا') },
      { type: 'back' },
    ],
  },
};

// ---------- Text ----------
const MONTHS = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const arDigits = (s) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
function formatDate(iso, lang, withYear = true) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const s = `${d} ${MONTHS[lang][mo - 1]}${withYear ? ` ${y}` : ''}`;
  return lang === 'ar' ? arDigits(s) : s;
}
// Text answers must be text; invisible direction marks (pasted from chat apps) would turn names backwards.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
/**
 * At most `max` characters as the form's maxlength counts them (UTF-16), cut between whole letters: an emoji
 * (two UTF-16 units, or several joined) at the limit goes whole, never half of it (QA 25 Nov: a "\ufffd" on the cover).
 */
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
function cut(s, max) {
  if (s.length <= max) return s;
  let out = '';
  for (const { segment } of graphemes.segment(s)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}
const clean = (v, max) => cut((typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(INVISIBLE, '').replace(/[\u0000-\u001f\u007f<>{}\[\]|]/g, ' ').replace(/\s+/g, ' ').trim(), max).trim();

/** Checks and tidies a customer's answers; throws a {field} error for anything missing. */
function cleanAnswers(book, input) {
  if (!input || typeof input !== 'object') input = {};
  const out = {};
  for (const q of book.questions) {
    let v = input[q.id];
    if (q.type === 'choice') v = q.options.some((o) => o.id === v) ? v : '';
    else if (q.type === 'date') {
      v = typeof v === 'string' ? v : '';
      const real = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
      if (v && (!real || v < (q.min || OLDEST_BIRTHDAY) || v > new Date().toISOString().slice(0, 10))) {
        const err = new Error('bookBadDate');
        err.field = q.label;
        throw err;
      }
    } else if (q.type === 'textarea') {
      // (The dedication keeps < and > — "Love you <3" — the pages print text as text; { } [ ] | stay out: the story's own
      // marks. Owner, 26 Nov.)
      v = (typeof v === 'string' ? v : '').replace(INVISIBLE, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f{}\[\]|]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      v = cut(v, q.max).trim();
    } else v = clean(v, q.max || 40);
    // The books are printed in English: Arabic letters would scramble the sentences.
    // Any right-to-left script (Arabic, Hebrew, Syriac, Thaana…) would scramble the English sentences.
    if (typeof v === 'string' && /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(v)) {
      const err = new Error('bookLatin');
      err.field = q.label;
      throw err;
    }
    if (q.required && !v) {
      const err = new Error('bookMissing');
      err.field = q.label;
      throw err;
    }
    out[q.id] = v;
  }
  return out;
}

/** Fills {placeholders} and [[boy|girl]] forms. */
function fill(template, answers, lang) {
  const girl = answers.gender === 'girl';
  const vars = {
    name: answers.name,
    city: answers.city,
    father: answers.father,
    mother: answers.mother,
    friend: answers.friend,
    birthday: formatDate(answers.birthday, lang),
    birthdayDay: formatDate(answers.birthday, lang, false),
    fruit: answers.fruit ? FRUITS[answers.fruit][lang] : '',
    animal: answers.animal ? ANIMALS[answers.animal][lang] : '',
    from: answers.dedication || (lang === 'ar' ? 'مع كل حبنا،\nبابا {father} وماما {mother}' : 'With all our love,\nBaba {father} & Mama {mother}'),
  };
  let s = String(template).replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, (_, b, g) => (girl ? g : b));
  for (let i = 0; i < 2; i++) s = s.replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));
  return s;
}
const escapeMarkup = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- Fonts ----------
let fontsReady = null;
function loadFonts() {
  // Registering each file once makes the families available to Pango.
  fontsReady ||= Promise.all(fs.readdirSync(FONTS).filter((f) => f.endsWith('.ttf')).map((f) => sharp({ text: { text: '.', fontfile: path.join(FONTS, f) } }).png().toBuffer()));
  return fontsReady;
}

/** Text as a transparent image, wrapped to `width`, shrunk until it fits `maxH`. */
async function textImage(text, { font = 'Cairo Bold', pt = 14, px, width, maxH, color = '#1b2740', align = 'centre', lineHeight = 0 }) {
  await loadFonts();
  const dpi = px / PAGE_IN; // points stay the same physical size at any render size
  // Shrink until the text fits the width (a long single word can't wrap) and the height.
  let out = null;
  for (let size = pt; ; size = Math.max(6, size - 0.75)) {
    const img = await sharp({
      // lineHeight: a factor for fonts whose built-in lines are very tall (Lalezar: a wrapped title had a blank line between).
      text: { text: `<span foreground="${color}"${lineHeight ? ` line_height="${lineHeight}"` : ''}>${escapeMarkup(text)}</span>`, font: `${font} ${size}`, width: Math.round(width), align, rgba: true, wrap: 'word', dpi: Math.round(dpi), spacing: Math.round(size * dpi / 72 * 0.25) },
    }).png().toBuffer();
    const m = await sharp(img).metadata();
    out = { img, w: m.width, h: m.height };
    if ((m.width <= width && (!maxH || m.height <= maxH)) || size <= 6) break;
  }
  // Still too big at the smallest size: scale the picture down so it always fits the page.
  const k = Math.min(1, width / out.w, maxH ? maxH / out.h : 1);
  if (k < 1) {
    const w = Math.max(1, Math.floor(out.w * k));
    const h = Math.max(1, Math.floor(out.h * k));
    out = { img: await sharp(out.img).resize(w, h, { fit: 'fill' }).png().toBuffer(), w, h };
  }
  return out;
}

/** The outline of the colouring book's hollow letters, in px: about 0.6 mm when printed. */
const outlineOf = (px) => Math.max(1.5, px * 0.0028);

/**
 * Hollow letters to colour in: the letters of `t` (a text picture, { img, w, h }) drawn as a dark outline,
 * white inside. The outline is the letters stamped round a small circle in the dark colour, with the letters
 * in white on top; returned the same way (a little bigger, for the outline).
 */
async function hollowText(t, px, color = '#1b2740') {
  const r = outlineOf(px);
  const pad = Math.ceil(r) + 1;
  const tint = (hex) => sharp(t.img).composite([{ input: { create: { width: t.w, height: t.h, channels: 4, background: hex } }, blend: 'in' }]).png().toBuffer();
  const [ink, white] = await Promise.all([tint(color), tint('#ffffff')]);
  const layers = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    layers.push({ input: ink, left: Math.round(pad + r * Math.cos(a)), top: Math.round(pad + r * Math.sin(a)) });
  }
  layers.push({ input: white, left: pad, top: pad });
  const w = t.w + 2 * pad;
  const h = t.h + 2 * pad;
  const img = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
  return { img, w, h };
}

/**
 * A colouring-book caption: one line of hollow letters (hollowText) at most `width` x `maxH` px, outline included.
 *  - One line, always: a long name makes the letters smaller (QA 26 Nov: a 20-letter name wrapped, "Captain" went
 *    tiny and the name sat on the picture's frame).
 *  - The outline grows every letter, so the space between two words is widened by it: without that the words ran
 *    together ("Mohamed Abdelrahman the Firefighter" read as one word, QA 26 Nov). (Pango's letter_spacing is in
 *    1/1024 px of the picture, whatever its dpi.)
 *  - Pictures that the fonts draw in their own colours (emoji) are drawn as they are, over the hollow letters, not
 *    turned into an outline (they came out as empty circles).
 */
async function hollowCaption(text, { px, width, maxH, pt = 46, font = 'Lalezar', color = '#1b2740' }) {
  await loadFonts();
  const r = outlineOf(px);
  const pad = Math.ceil(r) + 1;
  const dpi = Math.round(px / PAGE_IN);
  const body = escapeMarkup(text).split(' ').join(`<span letter_spacing="${Math.round(3 * r * 1024)}"> </span>`);
  // alpha: letters drawn see-through (the same layout), so only colour pictures (emoji) show.
  const render = async (size, alpha) => {
    const img = await sharp({ text: { text: `<span foreground="${color}"${alpha ? ` alpha="${alpha}"` : ''}>${body}</span>`, font: `${font} ${size}`, rgba: true, dpi } }).png().toBuffer();
    const m = await sharp(img).metadata();
    return { img, w: m.width, h: m.height };
  };
  let size = pt;
  let t = await render(size);
  for (let i = 0; i < 12 && size > 6; i++) {
    const k = Math.min(width / (t.w + 2 * pad), maxH / (t.h + 2 * pad));
    if (k >= 1) break;
    // (The widened spaces don't shrink with the letters: try again until it fits.)
    size = Math.max(6, Math.min(size - 0.25, Math.floor(size * k * 4) / 4));
    t = await render(size);
  }
  // Colour pictures: taken out of the letters (by their shape, so no rim of them is left to outline) and laid on top.
  let colour = null;
  if (/[^\u0000-ɏ]/.test(text)) {
    const c = await render(size, 1);
    if ((await sharp(c.img).extractChannel(3).stats()).channels[0].max > 0) {
      colour = c.img;
      const shape = await sharp(c.img).extractChannel(3).threshold(1).toBuffer();
      const cut = await sharp({ create: { width: t.w, height: t.h, channels: 3, background: '#000' } }).joinChannel(shape).png().toBuffer();
      t = { ...t, img: await sharp(t.img).composite([{ input: cut, blend: 'dest-out' }]).png().toBuffer() };
    }
  }
  let out = await hollowText(t, px, color);
  if (colour) out = { ...out, img: await sharp(out.img).composite([{ input: colour, left: pad, top: pad }]).png().toBuffer() };
  // Still too big at the smallest size: the picture is made smaller, so it always fits.
  const k = Math.min(1, width / out.w, maxH / out.h);
  if (k < 1) {
    const w = Math.max(1, Math.floor(out.w * k));
    const h = Math.max(1, Math.floor(out.h * k));
    out = { img: await sharp(out.img).resize(w, h, { fit: 'fill' }).png().toBuffer(), w, h };
  }
  return out;
}

/**
 * Where a colouring page's caption band may go. Some pictures have a frame drawn round them with the caption inside
 * it (doctor, pilot, scientist, explorer: a line down each side and one along the bottom; the pilot's also a line
 * above the caption). The band is white and covers what is under it, so it stays inside those lines (QA 26 Nov: a long
 * name's band cut the pilot's frame). Measured on the picture itself, so girl pictures and AI-redrawn pages count as
 * they are. { left, right, top, bottom } in px (the band goes between them); the whole page when there is no frame.
 */
async function captionRoom(base, px) {
  const P = (f) => Math.round(px * f);
  const room = { left: 2, right: px - 2, top: 0, bottom: px - 2 };
  const y0 = P(0.78);
  const { data } = await sharp(base).extract({ left: 0, top: y0, width: px, height: px - y0 }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const dark = (x, y) => data[(y - y0) * px + x] < 160;
  // A side of a frame: a column near the edge that is dark down (nearly) all the caption's rows.
  const side = (x) => {
    let n = 0;
    for (let y = P(0.86); y < P(0.93); y++) if (dark(x, y)) n++;
    return n >= 0.9 * (P(0.93) - P(0.86));
  };
  const gap = P(0.008);
  let framed = false;
  for (let x = P(0.12); x >= P(0.01); x--) if (side(x)) { room.left = x + 1 + gap; framed = true; break; }
  for (let x = P(0.88); x <= P(0.99); x++) if (side(x)) { room.right = x - gap; framed = true; break; }
  // A line across: dark along at least half of the page.
  const across = (y) => {
    let n = 0;
    for (let x = 0; x < px; x++) if (dark(x, y)) n++;
    return n >= px * 0.5;
  };
  for (let y = P(0.93); y < P(0.99); y++) if (across(y)) { room.bottom = y; break; }
  if (framed) for (let y = P(0.88); y >= P(0.8); y--) if (across(y)) { room.top = y + 1; break; }
  return room;
}

// ---------- Faces ----------
// The photo the shopper crops is an oval around the face (hairline to chin),
// 4:5. On each page the drawn face (eyes, nose, mouth) is painted over with
// the drawing's own skin colour, then the child's face is laid on top with
// soft edges and its colours nudged towards the drawing, so it reads as part
// of the illustration. The drawn hair and head shape stay.
const FACE_W = 720;
const FACE_H = 900;
// How big the face crop is drawn for a face spot of height h (% of the page): a photo face (story pages, covers) is
// PHOTO_FACE x h tall after its top PHOTO_TRIM (the hairline) is cut off; a line-art face (colouring pages) LINE_FACE x h.
const PHOTO_FACE = 1.2;
const PHOTO_TRIM = 0.1;
const LINE_FACE = 1.18;
/**
 * The book page warns when the face crop is too small to print sharply, as the photo prints page does: fewer than
 * LOW_DPI of the photo's own pixels per printed inch. Lower than for photo prints (150): the face is smoothed to sit
 * with the painting (and traced for the colouring book), so a face 250 px tall prints as well as a bigger one; at
 * 150 px it is soft and at 100 px blurry on the biggest face (tried at print size, 26 Nov).
 * printIn: the tallest the whole crop prints in the book, in inches.
 */
const LOW_DPI = 100;
function facePrint(book) {
  let most = 0;
  for (const page of book.pages) {
    if (!page.face) continue;
    const line = book.kind === 'coloring' && page.type !== 'cover';
    most = Math.max(most, (page.face[2] / 100) * (line ? LINE_FACE : PHOTO_FACE / (1 - PHOTO_TRIM)));
  }
  return { printIn: Math.round(most * PAGE_IN * 100) / 100, lowDpi: LOW_DPI };
}
const ellipseSvg = (w, h, rx, ry, fill = '#fff') => Buffer.from(`<svg width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${rx}" ry="${ry}" fill="${fill}"/></svg>`);

/** A soft-edged oval alpha mask (raw, 1 byte per pixel, 255 = keep). */
async function ovalMask(w, h, inset = 0.9, feather = 0.06) {
  const pad = Math.ceil(Math.max(w, h) * feather * 2);
  return sharp(ellipseSvg(w + 2 * pad, h + 2 * pad, (w / 2) * inset, (h / 2) * inset))
    .blur(Math.max(0.3, Math.max(w, h) * feather))
    .extract({ left: pad, top: pad, width: w, height: h })
    .extractChannel(3)
    .raw()
    .toBuffer();
}

/** Average colour of a small area of the page (the drawing's skin tone). */
async function sampleColour(base, px, x, y, size) {
  const s = Math.max(4, Math.round(size));
  const left = Math.max(0, Math.min(px - s, Math.round(x - s / 2)));
  const top = Math.max(0, Math.min(px - s, Math.round(y - s / 2)));
  const st = await sharp(base).extract({ left, top, width: s, height: s }).stats();
  return st.channels.slice(0, 3).map((c) => c.mean);
}

/** Layers that put the child's photo face into a drawn face. */
async function storyFaceLayers(base, face, px, [cx, cy, h, eyes]) {
  const P = (v) => (v / 100) * px;
  // 1. Cover the drawn features with the drawn skin colour.
  // Sample the drawn skin in a few places (forehead, cheeks, chin) and keep the lightest:
  // the others may land on hair, an eye or a shadow.
  const spots = [[cx, cy - 0.28 * h], [cx - eyes * 0.62, cy + 0.08 * h], [cx + eyes * 0.62, cy + 0.08 * h], [cx, cy + 0.36 * h], [cx - eyes * 0.3, cy - 0.22 * h], [cx + eyes * 0.3, cy - 0.22 * h]];
  const samples = await Promise.all(spots.map(([x, y]) => sampleColour(base, px, P(x), P(y), P(h * 0.06))));
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  samples.sort((a, b) => lum(b) - lum(a));
  const skin = samples[0].map((v, i) => (v + samples[1][i]) / 2);
  const ew = Math.round(P(Math.max(eyes + 9, 1.1 * h)));
  const eh = Math.round(P(h * 1.08));
  const hex = '#' + skin.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
  const patch = await sharp({ create: { width: ew, height: eh, channels: 3, background: hex } })
    .joinChannel(await ovalMask(ew, eh, 0.92, 0.05), { raw: { width: ew, height: eh, channels: 1 } }).png().toBuffer();
  // 2. The face, colour-matched and softened like paint.
  const fh = Math.round(P(h * PHOTO_FACE));
  const fw = Math.round(fh * (FACE_W / FACE_H));
  // Smooth skin texture a little so the photo sits with the painted style.
  // Drop the hairline strip at the top of the crop (the drawn fringe covers the forehead).
  const meta = await sharp(face).metadata();
  const trim = Math.round(meta.height * PHOTO_TRIM);
  const photo = await sharp(face).extract({ left: 0, top: trim, width: meta.width, height: meta.height - trim }).resize(fw, fh, { fit: 'cover' }).clahe({ width: Math.max(3, Math.round(fw / 3)), height: Math.max(3, Math.round(fh / 3)), maxSlope: 2 }).median(Math.max(1, Math.min(7, Math.round(fw / 90) * 2 + 1))).toBuffer();
  const inner = await sharp(photo).extract({ left: Math.round(fw * 0.25), top: Math.round(fh * 0.3), width: Math.max(1, Math.round(fw * 0.5)), height: Math.max(1, Math.round(fh * 0.45)) }).stats();
  const mean = inner.channels.slice(0, 3).map((c) => c.mean || 1);
  const gain = mean.map((m, i) => 1 + 0.4 * (Math.min(1.7, Math.max(0.8, skin[i] / m)) - 1));
  const tuned = await sharp(photo).linear(gain, [0, 0, 0]).modulate({ saturation: 1.1, brightness: 1.03 }).blur(Math.max(0.3, fw / 700))
    .joinChannel(await ovalMask(fw, fh, 0.86, 0.075), { raw: { width: fw, height: fh, channels: 1 } }).png().toBuffer();
  return [
    { input: patch, left: Math.round(P(cx) - ew / 2), top: Math.round(P(cy) - eh / 2) },
    { input: tuned, left: Math.round(P(cx) - fw / 2), top: Math.round(P(cy) - fh / 2 + P(h * 0.02)) },
  ];
}

/** Line-art version of the face, with lines fading out at the oval's edge. */
async function lineFaceImage(faceLine, fw, fh, feather = 0.06) {
  const lines = await sharp(faceLine).resize(fw, fh, { fit: 'fill' }).blur(Math.max(0.5, fw / 170)).threshold(236).toColourspace('b-w').raw().toBuffer();
  const mask = await ovalMask(fw, fh, 0.88, feather);
  const alpha = Buffer.alloc(fw * fh);
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(((255 - lines[i]) * mask[i]) / 255);
  return sharp({ create: { width: fw, height: fh, channels: 3, background: '#111111' } }).joinChannel(alpha, { raw: { width: fw, height: fh, channels: 1 } }).png().toBuffer();
}

/** Layers that put the child's line-art face into a drawn colouring-page face. */
async function lineFaceLayers(faceLine, px, [cx, cy, h, eyes]) {
  const P = (v) => (v / 100) * px;
  const ew = Math.round(P(Math.max(eyes + 8, 1.05 * h)));
  const eh = Math.round(P(h * 1.02));
  const erase = await sharp({ create: { width: ew, height: eh, channels: 3, background: '#ffffff' } })
    .joinChannel(await ovalMask(ew, eh, 0.97, 0.015), { raw: { width: ew, height: eh, channels: 1 } }).png().toBuffer();
  const fh = Math.round(P(h * LINE_FACE));
  const fw = Math.round(fh * (FACE_W / FACE_H));
  return [
    { input: erase, left: Math.round(P(cx) - ew / 2), top: Math.round(P(cy) - eh / 2) },
    { input: await lineFaceImage(faceLine, fw, fh), left: Math.round(P(cx) - fw / 2), top: Math.round(P(cy) - fh / 2 + P(h * 0.02)) },
  ];
}

/** Photo -> colouring-book line art (difference of Gaussians at a low resolution, specks removed). */
async function lineArt(buf, outW = FACE_W, outH = FACE_H, { work = 360, s1 = 2, k = 1.8, share = 0.08, min = 40, pre = 5, soft = 1.2, tiles = 6 } = {}) {
  const ww = work;
  const wh = Math.round((work * outH) / outW);
  const raw = (b, w = ww, h = wh) => sharp(b, { raw: { width: w, height: h, channels: 1 } });
  const grey = (img) => img.toColourspace('b-w').raw().toBuffer();
  // Even out the lighting first, so a shadow on one cheek doesn't become a black patch.
  const g = await grey(sharp(buf).resize(ww, wh, { fit: 'cover' }).greyscale().clahe({ width: Math.round(ww / tiles), height: Math.round(wh / tiles), maxSlope: 3 }).median(pre).blur(soft));
  const b1 = await grey(raw(g).blur(s1));
  const b2 = await grey(raw(g).blur(s1 * k));
  const d = new Int16Array(ww * wh);
  for (let i = 0; i < d.length; i++) d[i] = b1[i] - b2[i];
  const T = Math.min(-2, Int16Array.from(d).sort()[Math.floor(share * d.length)]);
  const px = Buffer.alloc(d.length);
  for (let i = 0; i < d.length; i++) px[i] = d[i] <= T ? 0 : 255;
  // Drop specks (skin texture, background noise).
  const seen = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i++) {
    if (px[i] !== 0 || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    for (let c = 0; c < comp.length; c++) {
      const j = comp[c];
      const x = j % ww;
      for (const n of [j - ww, j + ww, x > 0 ? j - 1 : -1, x < ww - 1 ? j + 1 : -1]) {
        if (n >= 0 && n < px.length && !seen[n] && px[n] === 0) { seen[n] = 1; comp.push(n); }
      }
    }
    if (comp.length < min) for (const j of comp) px[j] = 255;
  }
  const up = await grey(raw(px).resize(outW, outH, { kernel: 'cubic' }).blur((outW / ww) * 0.6));
  for (let i = 0; i < up.length; i++) up[i] = up[i] < 110 ? 0 : up[i] > 190 ? 255 : Math.round(((up[i] - 110) * 255) / 80);
  return raw(up, outW, outH).png().toBuffer();
}

// ---------- Pages ----------
const art = new Map();
/** An illustration at a given size (cached: previews ask for the same sizes again and again). */
/**
 * The picture for a page: the girl version ("<name>-girl.jpg/png") when the
 * child is a girl and that picture exists, else the usual one. Girl pictures
 * keep the boy picture's pose and face position, so the same face spot fits.
 */
function pictureFile(book, page, answers) {
  const ext = book.kind === 'coloring' && page.type !== 'cover' ? 'png' : 'jpg';
  if (answers && answers.gender === 'girl') {
    const girl = `${book.dir}/${page.img}-girl.${ext}`;
    if (fs.existsSync(path.join(ASSETS, girl))) return girl;
  }
  return `${book.dir}/${page.img}.${ext}`;
}
async function illustration(file, px) {
  const key = `${file}|${px}`;
  if (!art.has(key)) {
    if (art.size > 80) art.clear();
    art.set(key, sharp(path.join(ASSETS, file)).resize(px, px).flatten({ background: '#ffffff' }).png({ compressionLevel: 1 }).toBuffer());
  }
  return art.get(key);
}
const companionFile = (kind, answers) => path.join(ASSETS, 'companions', `${answers[kind]}.png`);

function panel(px, x, y, w, h, opacity = 0.88) {
  const r = Math.round(px * 0.025);
  return Buffer.from(`<svg width="${px}" height="${px}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#fffaf0" fill-opacity="${opacity}"/></svg>`);
}

/**
 * One page of a book as an image `px` wide (square, including bleed).
 * `data`: { book, answers, lang, face (photo square), faceLine (line art) }.
 */
async function renderPage({ book, answers, face, faceLine, redrawn }, index, px, { noText = false } = {}) {
  const lang = 'en'; // the books are printed in English
  const page = book.pages[index];
  const P = (v) => Math.round((v / 100) * px);
  const layers = [];
  let base;
  const coloring = book.kind === 'coloring';

  // A page the AI already redrew with the child: use it as the picture.
  const redraw = redrawn && redrawn[index];
  if (redraw) base = await sharp(redraw).resize(px, px, { fit: 'cover' }).flatten({ background: '#ffffff' }).png({ compressionLevel: 1 }).toBuffer();
  else if (page.img) base = await illustration(pictureFile(book, page, answers), px);
  else base = await sharp({ create: { width: px, height: px, channels: 3, background: page.type === 'back' ? (coloring ? '#ff8a3d' : '#1c2a55') : '#ffffff' } }).png().toBuffer();

  // Companions (favourite animal / fruit) go under the text, over the picture.
  for (const c of redraw ? [] : page.companions || []) {
    if (!answers[c.kind]) continue;
    const w = P(c.w);
    const img = await sharp(companionFile(c.kind, answers)).resize(w, w, { fit: 'inside' }).png().toBuffer();
    const m = await sharp(img).metadata();
    layers.push({ input: img, left: P(c.x) - Math.round(m.width / 2), top: P(c.y) - Math.round(m.height / 2) });
  }

  // The child's face, inside the drawn face.
  if (!redraw && page.face && (face || faceLine)) {
    const useLine = coloring && page.type !== 'cover';
    if (useLine && faceLine) layers.push(...(await lineFaceLayers(faceLine, px, page.face)));
    else if (!useLine && face) layers.push(...(await storyFaceLayers(base, face, px, page.face)));
  }

  const put = (t, cx, top) => layers.push({ input: t.img, left: Math.round(cx - t.w / 2), top: Math.round(top) });
  /**
   * A colouring-book caption in hollow letters, centred at height cy on a solid white rounded band (covers any lines
   * under it), the band inside any frame drawn round the picture (captionRoom). `width`: the most the letters may take.
   */
  const captionBand = async (text, cy, width) => {
    const padX = Math.round(px * 0.03);
    const padY = Math.round(px * 0.012);
    const room = await captionRoom(base, px);
    // The band is centred: as wide as the room on its narrower side allows, with at least a little white each side.
    const most = Math.min(px - 4, 2 * Math.floor(Math.min(px / 2 - room.left, room.right - px / 2)));
    const t = await hollowCaption(text, { px, width: Math.min(width, most - 2 * Math.round(px * 0.012)), maxH: Math.min(px * 0.11, room.bottom - room.top - padY * 2) });
    const bw = Math.min(most, t.w + padX * 2);
    const bh = t.h + padY * 2;
    const bx = Math.round(px / 2 - bw / 2);
    const by = Math.round(Math.max(room.top, Math.min(room.bottom - bh, cy - bh / 2)));
    layers.push({ input: Buffer.from(`<svg width="${px}" height="${px}"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${Math.round(bh / 2)}" fill="#ffffff"/></svg>`), left: 0, top: 0 });
    put(t, px / 2, by + padY);
  };
  if (noText) return sharp(base).composite(layers).flatten({ background: '#ffffff' });

  if (page.type === 'cover') {
    const titleOpts = { font: 'Lalezar', pt: 96, px, width: px * 0.9, maxH: px * 0.2, color: coloring ? '#e4572e' : '#ffd166' };
    let big = await textImage(fill(page.title[lang], answers, lang), titleOpts);
    // A long name wraps the title: Lalezar's own lines are very tall (a blank line between them),
    // so a wrapped title is drawn with tighter lines and the subtitle a little further down.
    const wrapped = big.h > px * 0.11;
    if (wrapped) big = await textImage(fill(page.title[lang], answers, lang), { ...titleOpts, maxH: px * 0.15, lineHeight: 0.5 });
    const sub = await textImage(fill(page.subtitle[lang], answers, lang), { font: 'Cairo Bold', pt: 30, px, width: px * 0.86, maxH: px * 0.08, color: coloring ? '#1b2740' : '#ffffff' });
    const top = px * 0.035;
    if (!coloring) {
      // A soft shadow behind light letters on the night sky.
      const sh = await sharp(big.img).composite([{ input: Buffer.from(`<svg width="${big.w}" height="${big.h}"><rect width="100%" height="100%" fill="#000"/></svg>`), blend: 'in' }]).blur(Math.max(1, px * 0.006)).png().toBuffer();
      layers.push({ input: sh, left: Math.round(px / 2 - big.w / 2 + px * 0.004), top: Math.round(top + px * 0.006) });
    }
    put(big, px / 2, top);
    put(sub, px / 2, top + big.h + px * (wrapped ? 0.012 : 0.005));
  } else if (page.type === 'dedication') {
    const txt = await textImage(fill(page.text[lang], answers, lang), { font: 'Cairo Bold', pt: 22, px, width: px * 0.78, maxH: px * 0.6, color: '#1c2a55' });
    put(txt, px / 2, px * 0.6 - txt.h / 2);
  } else if (page.type === 'back') {
    const named = await textImage(fill(lang === 'ar' ? 'صُنع خصيصًا لـ{name}' : 'Made especially for {name}', answers, lang) + '\nebda3', { font: 'Cairo Bold', pt: 12, px, width: px * 0.8, color: '#ffffff' });
    put(named, px / 2, px * 0.82);
  } else if (page.type === 'belongs' || page.type === 'draw') {
    // Generated colouring pages: a big frame to draw in, or the child's face in a frame.
    const frame = Buffer.from(`<svg width="${px}" height="${px}"><rect x="${P(10)}" y="${P(page.type === 'draw' ? 10 : 14)}" width="${P(80)}" height="${P(page.type === 'draw' ? 66 : 58)}" rx="${P(4)}" fill="none" stroke="#111" stroke-width="${Math.max(2, P(0.6))}" stroke-dasharray="${page.type === 'draw' ? `${P(2)} ${P(1.4)}` : 'none'}"/>${Array.from({ length: 10 }, (_, i) => `<circle cx="${P(10 + (i % 5) * 20)}" cy="${P(i < 5 ? 8 : 80)}" r="${P(1.6)}" fill="none" stroke="#111" stroke-width="${Math.max(2, P(0.4))}"/>`).join('')}</svg>`);
    layers.unshift({ input: frame, left: 0, top: 0 });
    if (page.type === 'belongs' && faceLine) {
      const fh = P(50);
      const fw = Math.round(fh * (FACE_W / FACE_H));
      layers.push({ input: await lineFaceImage(faceLine, fw, fh, 0.05), left: Math.round(px / 2 - fw / 2), top: P(18) });
    }
    // The caption below the frame and the row of circles, on a clean white band, in hollow letters to colour.
    await captionBand(fill(page.caption[lang], answers, lang), P(90.5), px * 0.84);
  } else if (coloring) {
    // Captions sit on a white band, so they never run into the drawing's lines; the name is in hollow letters
    // to colour in, as the book promises (QA 25 Nov: they printed solid navy).
    await captionBand(fill(page.caption[lang], answers, lang), px * 0.905, px * 0.86);
  } else if (page.text) {
    // Story text on a soft panel at the bottom of the picture.
    const txt = await textImage(fill(page.text[lang], answers, lang), { font: 'Cairo Bold', pt: 18, px, width: px * 0.82, maxH: px * 0.22, color: '#1b2740' });
    const ph = txt.h + px * 0.045;
    const py = px * 0.955 - ph;
    layers.unshift({ input: panel(px, Math.round(px * 0.06), Math.round(py), Math.round(px * 0.88), Math.round(ph)), left: 0, top: 0 });
    put(txt, px / 2, py + (ph - txt.h) / 2);
  }

  return sharp(base).composite(layers).flatten({ background: '#ffffff' });
}

async function pageJpeg(data, index, px, quality = 82) {
  return (await renderPage(data, index, px)).jpeg({ quality, mozjpeg: true }).toBuffer();
}

/**
 * The pages of the printed book, in order: page indexes, null for a blank (white) page. A book is printed
 * on sheets, two pages to a sheet, so it needs an even number of pages: with an odd count a blank page goes
 * just before the back cover, which then prints on the back of the last sheet (QA 25 Nov: the colouring
 * book had 17 pages, so its back cover printed on the front of the 9th sheet).
 */
function printPages(book) {
  const list = book.pages.map((_, i) => i);
  if (list.length % 2) {
    const back = book.pages[book.pages.length - 1].type === 'back';
    list.splice(back ? list.length - 1 : list.length, 0, null);
  }
  return list;
}

/** Print-ready PDF: every page at 300 DPI with 1/8" bleed, 8 x 8" trim, an even number of pages (printPages). */
async function bookPdf(data, { title = 'Book' } = {}) {
  const ptSize = PAGE_IN * 72;
  const doc = new PDFDocument({ size: [ptSize, ptSize], margin: 0, autoFirstPage: false, info: { Title: title, Creator: 'ebda3' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));
  for (const i of printPages(data.book)) {
    doc.addPage({ size: [ptSize, ptSize], margin: 0 });
    if (i === null) continue; // a blank page: left white
    const jpg = await (await renderPage(data, i, PRINT_PX)).withIccProfile('srgb').withDensity(300).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    doc.image(jpg, 0, 0, { width: ptSize, height: ptSize });
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** What the book page needs to show the form (no server paths). */
function publicBook(book) {
  return {
    id: book.id,
    kind: book.kind,
    product: book.product,
    title: book.title,
    blurb: book.blurb,
    pages: book.pages.length,
    questions: book.questions.map((q) => ({ ...q, options: q.options && q.options.map((o) => ({ ...o, picture: q.pictures ? `/api/books/companion/${o.id}.png` : null })) })),
    // For the "may print blurry" note under the photo: { printIn, lowDpi } (facePrint).
    photo: facePrint(book),
  };
}

module.exports = {
  BOOKS, TRIM_IN, BLEED_IN, PAGE_IN, PRINT_PX, FRUITS, ANIMALS, OLDEST_BIRTHDAY,
  cleanAnswers, fill, formatDate, renderPage, pageJpeg, bookPdf, printPages, lineArt, publicBook, loadFonts, facePrint,
  companionPath: (id) => (Object.hasOwn(FRUITS, id) || Object.hasOwn(ANIMALS, id) ? path.join(ASSETS, 'companions', `${id}.png`) : null),
};
