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

const Q = {
  name: { id: 'name', type: 'text', label: t("Child's name", 'اسم الطفل'), max: 20, required: true },
  gender: { id: 'gender', type: 'choice', label: t('Boy or girl', 'ولد ولا بنت'), options: [{ id: 'boy', label: t('Boy', 'ولد') }, { id: 'girl', label: t('Girl', 'بنت') }], required: true },
  birthday: { id: 'birthday', type: 'date', label: t('Birthday', 'تاريخ الميلاد'), required: true },
  city: { id: 'city', type: 'text', label: t('City', 'المدينة'), max: 24, placeholder: t('Cairo', 'القاهرة'), required: true },
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
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>{}\[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Checks and tidies a customer's answers; throws a {field} error for anything missing. */
function cleanAnswers(book, input = {}) {
  const out = {};
  for (const q of book.questions) {
    let v = input[q.id];
    if (q.type === 'choice') v = q.options.some((o) => o.id === v) ? v : '';
    else if (q.type === 'date') {
      v = /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : '';
      if (v && (v < '1990-01-01' || v > new Date().toISOString().slice(0, 10))) v = '';
    } else if (q.type === 'textarea') v = String(v || '').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>{}\[\]|]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, q.max);
    else v = clean(v, q.max || 40);
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
async function textImage(text, { font = 'Cairo Bold', pt = 14, px, width, maxH, color = '#1b2740', align = 'centre' }) {
  await loadFonts();
  const dpi = px / PAGE_IN; // points stay the same physical size at any render size
  for (let size = pt; size >= 6; size -= 0.75) {
    const img = await sharp({
      text: { text: `<span foreground="${color}">${escapeMarkup(text)}</span>`, font: `${font} ${size}`, width: Math.round(width), align, rgba: true, wrap: 'word', dpi: Math.round(dpi), spacing: Math.round(size * dpi / 72 * 0.25) },
    }).png().toBuffer();
    const m = await sharp(img).metadata();
    if (!maxH || m.height <= maxH || size <= 6) return { img, w: m.width, h: m.height };
  }
  return null;
}

/** Hollow outlined letters (to colour in) from a text image. */
async function outlined(textImg, thick) {
  const m = await sharp(textImg).metadata();
  const pad = Math.ceil(thick * 2);
  const alpha = await sharp(textImg).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).extractChannel('alpha').toBuffer();
  const W = m.width + 2 * pad;
  const H = m.height + 2 * pad;
  const grown = await sharp(alpha).blur(thick * 1.4).threshold(8).toBuffer();
  const inner = await sharp(alpha).threshold(110).toBuffer();
  const black = await sharp({ create: { width: W, height: H, channels: 3, background: '#111' } }).joinChannel(grown).png().toBuffer();
  const white = await sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } }).joinChannel(inner).png().toBuffer();
  const img = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: black }, { input: white }]).png().toBuffer();
  return { img, w: W, h: H };
}

// ---------- Faces ----------
// The photo the shopper crops is an oval around the face (hairline to chin),
// 4:5. On each page the drawn face (eyes, nose, mouth) is painted over with
// the drawing's own skin colour, then the child's face is laid on top with
// soft edges and its colours nudged towards the drawing, so it reads as part
// of the illustration. The drawn hair and head shape stay.
const FACE_W = 720;
const FACE_H = 900;
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
  const fh = Math.round(P(h * 1.2));
  const fw = Math.round(fh * (FACE_W / FACE_H));
  // Smooth skin texture a little so the photo sits with the painted style.
  // Drop the hairline strip at the top of the crop (the drawn fringe covers the forehead).
  const meta = await sharp(face).metadata();
  const trim = Math.round(meta.height * 0.1);
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
  const fh = Math.round(P(h * 1.18));
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
async function renderPage({ book, answers, face, faceLine }, index, px) {
  const lang = 'en'; // the books are printed in English
  const page = book.pages[index];
  const P = (v) => Math.round((v / 100) * px);
  const layers = [];
  let base;
  const coloring = book.kind === 'coloring';

  if (page.img) base = await illustration(`${book.dir}/${page.img}.${coloring && page.type !== 'cover' ? 'png' : 'jpg'}`, px);
  else base = await sharp({ create: { width: px, height: px, channels: 3, background: page.type === 'back' ? (coloring ? '#ff8a3d' : '#1c2a55') : '#ffffff' } }).png().toBuffer();

  // Companions (favourite animal / fruit) go under the text, over the picture.
  for (const c of page.companions || []) {
    if (!answers[c.kind]) continue;
    const w = P(c.w);
    const img = await sharp(companionFile(c.kind, answers)).resize(w, w, { fit: 'inside' }).png().toBuffer();
    const m = await sharp(img).metadata();
    layers.push({ input: img, left: P(c.x) - Math.round(m.width / 2), top: P(c.y) - Math.round(m.height / 2) });
  }

  // The child's face, inside the drawn face.
  if (page.face && (face || faceLine)) {
    const useLine = coloring && page.type !== 'cover';
    if (useLine && faceLine) layers.push(...(await lineFaceLayers(faceLine, px, page.face)));
    else if (!useLine && face) layers.push(...(await storyFaceLayers(base, face, px, page.face)));
  }

  const put = (t, cx, top) => layers.push({ input: t.img, left: Math.round(cx - t.w / 2), top: Math.round(top) });

  if (page.type === 'cover') {
    const big = await textImage(fill(page.title[lang], answers, lang), { font: 'Lalezar', pt: 96, px, width: px * 0.9, maxH: px * 0.2, color: coloring ? '#e4572e' : '#ffd166' });
    const sub = await textImage(fill(page.subtitle[lang], answers, lang), { font: 'Cairo Bold', pt: 30, px, width: px * 0.86, maxH: px * 0.08, color: coloring ? '#1b2740' : '#ffffff' });
    const top = px * 0.035;
    if (!coloring) {
      // A soft shadow behind light letters on the night sky.
      const sh = await sharp(big.img).composite([{ input: Buffer.from(`<svg width="${big.w}" height="${big.h}"><rect width="100%" height="100%" fill="#000"/></svg>`), blend: 'in' }]).blur(Math.max(1, px * 0.006)).png().toBuffer();
      layers.push({ input: sh, left: Math.round(px / 2 - big.w / 2 + px * 0.004), top: Math.round(top + px * 0.006) });
    }
    put(big, px / 2, top);
    put(sub, px / 2, top + big.h + px * 0.005);
  } else if (page.type === 'dedication') {
    const txt = await textImage(fill(page.text[lang], answers, lang), { font: 'Cairo Bold', pt: 22, px, width: px * 0.78, maxH: px * 0.6, color: '#1c2a55' });
    put(txt, px / 2, px * 0.6 - txt.h / 2);
  } else if (page.type === 'back') {
    const named = await textImage(fill(lang === 'ar' ? 'صُنع خصيصًا لـ{name}' : 'Made especially for {name}', answers, lang) + '\nOneOff Print', { font: 'Cairo Bold', pt: 12, px, width: px * 0.8, color: '#ffffff' });
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
    const cap = await textImage(fill(page.caption[lang], answers, lang), { font: 'Lalezar', pt: 46, px, width: px * 0.84, maxH: px * 0.14 });
    const o = await outlined(cap.img, Math.max(2, px * 0.006));
    put(o, px / 2, page.type === 'draw' ? P(80) : P(78));
  } else if (coloring) {
    const cap = await textImage(fill(page.caption[lang], answers, lang), { font: 'Lalezar', pt: 46, px, width: px * 0.86, maxH: px * 0.13 });
    const o = await outlined(cap.img, Math.max(2, px * 0.006));
    put(o, px / 2, px * 0.895 - o.h / 2);
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

/** Print-ready PDF: every page at 300 DPI with 1/8" bleed, 8 x 8" trim. */
async function bookPdf(data, { title = 'Book' } = {}) {
  const ptSize = PAGE_IN * 72;
  const doc = new PDFDocument({ size: [ptSize, ptSize], margin: 0, autoFirstPage: false, info: { Title: title, Creator: 'OneOff Print' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));
  for (let i = 0; i < data.book.pages.length; i++) {
    const jpg = await (await renderPage(data, i, PRINT_PX)).withIccProfile('srgb').withDensity(300).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    doc.addPage({ size: [ptSize, ptSize], margin: 0 });
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
  };
}

module.exports = {
  BOOKS, TRIM_IN, BLEED_IN, PAGE_IN, PRINT_PX, FRUITS, ANIMALS,
  cleanAnswers, fill, formatDate, renderPage, pageJpeg, bookPdf, lineArt, publicBook, loadFonts,
  companionPath: (id) => (FRUITS[id] || ANIMALS[id] ? path.join(ASSETS, 'companions', `${id}.png`) : null),
};
