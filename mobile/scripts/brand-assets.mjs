#!/usr/bin/env node
// The إبداع (ebda3.me) app icons and launch images for the iOS and Android apps, built from the
// brand files in ../public (the brand is never redrawn by hand).
//
//   node scripts/brand-assets.mjs [--preview <file.png>]
//
// Every run rewrites every output with the same bytes and removes the Capacitor defaults they
// replace. It then checks the result against public/icon-512.png and public/icon-maskable-512.png
// and exits non-zero when they differ by more than MAX_MEAN_DIFF. The preview contact sheet is
// for review only; it goes to --preview, or to the system temp folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// ---- Where things are ------------------------------------------------------------------------
const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.resolve(MOBILE, '..', 'public');
const BRAND_MARK_SVG = path.join(PUBLIC, 'img', 'logo-mark-header.svg');
const BRAND_ICON = path.join(PUBLIC, 'icon-512.png');
const BRAND_MASKABLE = path.join(PUBLIC, 'icon-maskable-512.png');
const RES = 'android/app/src/main/res'; // output paths are relative to mobile/
const XCASSETS = 'ios/App/App/Assets.xcassets';

// ---- Brand geometry: public/icon-512.png ------------------------------------------------------
// A 512 x 512 #FAFAF7 square with eight black corner bars and the black mark. Every coordinate
// below is a pixel of that icon ("icon units").
const ICON = 512;
const CENTRE = ICON / 2;
const PAPER = '#FAFAF7'; // the icon's background, also the site's theme and background colour

// The corner marks: two bars at each corner, [x, y, width, height].
const CORNER_BARS = [
  [89, 20, 16, 67], [407, 20, 16, 67], // top corners, upright bars
  [20, 89, 67, 16], [425, 89, 67, 16], // top corners, flat bars
  [20, 407, 67, 16], [425, 407, 67, 16], // bottom corners, flat bars
  [89, 425, 16, 67], [407, 425, 16, 67], // bottom corners, upright bars
];

// The mark: the logo-word path of public/img/logo-mark-header.svg (viewBox 0 0 737 836; the pink
// corner path there is not used). Its bounding box, x 105.25 y 105.25 and 526 x 625 in its own
// units, fills x 148..364, y 128..384 of the icon under translate(MARK_TX MARK_TY) scale(MARK_SCALE).
const MARK_BOX = { x: 105.25, y: 105.25, width: 526, height: 625 }; // in the SVG's own units
const MARK_AT = { x: 148, y: 128 }; // where that box's top-left corner sits in the icon
const MARK_SCALE = 0.4101323; // between 216/526 and 256/625, fitted to icon-512.png
const MARK_TX = MARK_AT.x - MARK_BOX.x * MARK_SCALE; // 104.8336
const MARK_TY = MARK_AT.y - MARK_BOX.y * MARK_SCALE; // 84.8336

// public/icon-maskable-512.png is icon-512.png scaled about its centre by 352/512: resampled to
// 352 px with an 80 px margin. That reproduces it to 0.17/255 on average (351 or 353 px give 0.78
// and 0.87), and keeps the corner marks inside the circle phones crop app icons to.
const MASKABLE_SCALE = 352 / 512; // 0.6875
const MASKABLE_SAFE_RADIUS = 0.4 * ICON; // maskable icons keep a centred circle of 80% safe

// ---- Android ---------------------------------------------------------------------------------
// Adaptive icon (Android 8+): 108 x 108 dp layers, of which launchers show only the centre
// 72 x 72 dp through their mask, keeping a 66 dp circle safe. icon-maskable-512.png is designed
// as that visible square, so the 512-unit layout is drawn 72 dp x MASKABLE_SCALE = 49.5 dp wide,
// centred: scale 49.5 / 512 = 0.0966796875 dp per icon unit, offset 54 - 256 x scale = 29.25 dp.
const ADAPTIVE_DP = 108;
const ADAPTIVE_VISIBLE_DP = 72;
const ADAPTIVE_SAFE_DP = 66;
const ADAPTIVE_SCALE = (ADAPTIVE_VISIBLE_DP * MASKABLE_SCALE) / ICON;
const ADAPTIVE_OFFSET = ADAPTIVE_DP / 2 - CENTRE * ADAPTIVE_SCALE;

// Splash screen icon (Android 12+): 288 x 288 dp, shown through a centred 192 dp circle. The
// 512-unit layout is drawn 160 dp wide (scale 0.3125, offset 64 dp), so its farthest corner
// point is 90.35 dp from the centre, 5.65 dp inside the circle.
const SPLASH_DP = 288;
const SPLASH_MASK_DP = 192;
const SPLASH_LAYOUT_DP = 160;
const SPLASH_MIN_SPARE_DP = 3; // the check fails if the corners come closer to the circle
const SPLASH_SCALE = SPLASH_LAYOUT_DP / ICON;
const SPLASH_OFFSET = (SPLASH_DP - SPLASH_LAYOUT_DP) / 2;

// Launcher PNGs for Android 7 (API 24-25, before adaptive icons): pixels per density.
const LEGACY_PX = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

// ---- iOS -------------------------------------------------------------------------------------
const IOS_ICON_PX = 1024; // the one universal size; Xcode makes the others from it
const LAUNCH_LOGO_PX = { '2x': 256, '3x': 384 }; // 128 x 128 pt

// ---- Self-check ------------------------------------------------------------------------------
const MAX_MEAN_DIFF = 2.0; // mean absolute difference per RGB value, out of 255

// ---- Arguments -------------------------------------------------------------------------------
let previewFile = path.join(os.tmpdir(), 'ebda3-icons-preview.png');
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--preview' && argv[i + 1]) previewFile = path.resolve(argv[++i]);
    else if (argv[i].startsWith('--preview=')) previewFile = path.resolve(argv[i].slice('--preview='.length));
    else {
      console.error('usage: node scripts/brand-assets.mjs [--preview <file.png>]');
      process.exit(2);
    }
  }
}

// ---- Derived geometry ------------------------------------------------------------------------
// The farthest any shape reaches from the icon centre, in icon units: the bars' corners, and the
// corners of the mark's bounding box (an upper bound for the mark).
const SHAPE_POINTS = [
  ...CORNER_BARS.flatMap(([x, y, w, h]) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]),
  ...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => [
    MARK_AT.x + i * MARK_BOX.width * MARK_SCALE,
    MARK_AT.y + j * MARK_BOX.height * MARK_SCALE,
  ]),
];
const FARTHEST = Math.max(...SHAPE_POINTS.map(([x, y]) => Math.hypot(x - CENTRE, y - CENTRE)));
const SHAPES_MIN = Math.min(...SHAPE_POINTS.flat());
const SHAPES_MAX = Math.max(...SHAPE_POINTS.flat());

// ---- Building blocks -------------------------------------------------------------------------
const num = (n) => String(+n.toFixed(10)); // exact enough, no exponents, no trailing zeros
const dp2 = (n) => n.toFixed(2);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MARK = (() => {
  const svg = fs.readFileSync(BRAND_MARK_SVG, 'utf8');
  const tag = svg.match(/<path\b[^>]*\bclass="logo-word"[^>]*>/);
  if (!tag) throw new Error(`no <path class="logo-word"> in ${BRAND_MARK_SVG}`);
  const attr = (name) => (tag[0].match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
  const d = attr('d');
  if (!d) throw new Error(`the logo-word path in ${BRAND_MARK_SVG} has no d`);
  return { d, evenOdd: attr('fill-rule') === 'evenodd' };
})();

const BARS_PATH = CORNER_BARS.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join('');

// The icon's shapes as SVG in icon units: black, no background.
const SHAPES_SVG =
  `<g fill="#000"><path d="${BARS_PATH}"/>` +
  `<path${MARK.evenOdd ? ' fill-rule="evenodd"' : ''} transform="translate(${num(MARK_TX)} ${num(MARK_TY)}) scale(${num(MARK_SCALE)})" d="${esc(MARK.d)}"/></g>`;

// A px x px SVG of the layout scaled by `scale` about the centre, on a square of `paper`
// (or a full-size circle of it when `round`; nothing when paper is null).
function iconSvg({ px, scale = 1, paper = PAPER, round = false }) {
  const shapes = scale === 1 ? SHAPES_SVG
    : `<g transform="translate(${CENTRE} ${CENTRE}) scale(${num(scale)}) translate(${-CENTRE} ${-CENTRE})">${SHAPES_SVG}</g>`;
  const ground = !paper ? ''
    : round ? `<circle cx="${CENTRE}" cy="${CENTRE}" r="${CENTRE}" fill="${paper}"/>`
    : `<rect width="${ICON}" height="${ICON}" fill="${paper}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${ICON} ${ICON}">${ground}${shapes}</svg>`;
}

const PNG_OPTIONS = { compressionLevel: 9, adaptiveFiltering: false };
const opaquePng = (svg) => sharp(Buffer.from(svg)).flatten({ background: PAPER }).png(PNG_OPTIONS).toBuffer(); // RGB
const alphaPng = (svg) => sharp(Buffer.from(svg)).ensureAlpha().png(PNG_OPTIONS).toBuffer(); // RGBA

// Xcode's own Contents.json style: two-space indent, "key" : value.
const xcodeJson = (obj) => `${JSON.stringify(obj, null, 2).replace(/^(\s*"[^"]+"):/gm, '$1 :')}\n`;

// An Android VectorDrawable of the layout: `scale` dp per icon unit, `offset` dp from the
// top-left. Android applies a group's scale before its translation, as SVG's
// translate(offset) scale(scale) does.
function vectorDrawable({ sizeDp, scale, offset, about }) {
  const comment = ['Generated by mobile/scripts/brand-assets.mjs from the brand files in public/; do not edit.', '', ...about]
    .map((line, i) => (i === 0 || !line ? line : `     ${line}`)).join('\n');
  if (comment.includes('--')) throw new Error('an XML comment cannot contain --');
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${comment} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${sizeDp}dp"
    android:height="${sizeDp}dp"
    android:viewportWidth="${sizeDp}"
    android:viewportHeight="${sizeDp}">
    <!-- The 512 x 512 brand icon layout (public/icon-512.png), in icon units. -->
    <group
        android:translateX="${num(offset)}"
        android:translateY="${num(offset)}"
        android:scaleX="${num(scale)}"
        android:scaleY="${num(scale)}">
        <!-- The eight corner bars. -->
        <path
            android:fillColor="#000000"
            android:pathData="${BARS_PATH}" />
        <!-- The mark: the logo-word path of public/img/logo-mark-header.svg. -->
        <group
            android:translateX="${num(MARK_TX)}"
            android:translateY="${num(MARK_TY)}"
            android:scaleX="${num(MARK_SCALE)}"
            android:scaleY="${num(MARK_SCALE)}">
            <path
                android:fillColor="#000000"
                android:fillType="${MARK.evenOdd ? 'evenOdd' : 'nonZero'}"
                android:pathData="${esc(MARK.d)}" />
        </group>
    </group>
</vector>
`;
}

// Reads back a VectorDrawable (vector, group and filled path elements, as written above) and
// turns it into SVG in viewport units, so the preview and the checks show what the XML itself
// says. A group's transform is scale, then rotation, then translation, about its pivot.
function vectorDrawableToSvg(xml) {
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const open = [];
  let viewport = null;
  let svg = '';
  for (const [, close, name, rest, selfClosing] of body.matchAll(/<(\/?)([\w-]+)([^>]*?)(\/?)>/g)) {
    if (close) {
      if (open.pop() !== name) throw new Error(`unbalanced </${name}>`);
      if (name === 'group') svg += '</g>';
      continue;
    }
    const a = Object.fromEntries([...rest.matchAll(/android:(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const n = (key, fallback) => (a[key] === undefined ? fallback : Number(a[key]));
    if (name === 'vector') {
      viewport = { width: n('viewportWidth'), height: n('viewportHeight'), widthDp: parseFloat(a.width), heightDp: parseFloat(a.height) };
    } else if (name === 'group') {
      const px = n('pivotX', 0);
      const py = n('pivotY', 0);
      svg += `<g transform="translate(${n('translateX', 0) + px} ${n('translateY', 0) + py}) rotate(${n('rotation', 0)}) scale(${n('scaleX', 1)} ${n('scaleY', 1)}) translate(${-px} ${-py})">`;
    } else if (name === 'path') {
      svg += `<path d="${a.pathData}" fill="${a.fillColor || 'none'}" fill-rule="${a.fillType === 'evenOdd' ? 'evenodd' : 'nonzero'}"/>`;
    } else {
      throw new Error(`unexpected <${name}> in a vector drawable`);
    }
    if (!selfClosing) open.push(name);
  }
  if (open.length || !viewport) throw new Error('malformed vector drawable');
  return { viewport, svg };
}

// The square [at, at + size] (in dp) of a converted VectorDrawable, at px pixels over PAPER.
// `clip` is an SVG shape in dp; clipAll clips the paper too (a launcher mask), otherwise only
// the shapes are clipped (the splash circle). `over` is drawn on top.
function vectorSvg(vd, { at, size, px, clip = '', clipAll = true, over = '' }) {
  const shapes = `<g transform="scale(${num(vd.viewport.widthDp / vd.viewport.width)} ${num(vd.viewport.heightDp / vd.viewport.height)})">${vd.svg}</g>`;
  const paper = `<rect x="${at}" y="${at}" width="${size}" height="${size}" fill="${PAPER}"/>`;
  const clipped = (s) => (clip ? `<g clip-path="url(#clip)">${s}</g>` : s);
  const defs = clip ? `<defs><clipPath id="clip">${clip}</clipPath></defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${at} ${at} ${size} ${size}">${defs}${clipAll ? clipped(paper + shapes) : paper + clipped(shapes)}${over}</svg>`;
}

// ---- Outputs ---------------------------------------------------------------------------------
const written = [];
function write(rel, data) {
  const file = path.join(MOBILE, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  written.push(rel);
}

const ADAPTIVE_ABOUT = [
  'Adaptive icon layers are 108 x 108 dp; launchers show only the centre 72 x 72 dp, through',
  'their mask (circle, squircle, rounded square), and keep a 66 dp circle safe.',
  'public/icon-maskable-512.png is designed as exactly that visible square: the 512-unit icon',
  `layout scaled by ${num(MASKABLE_SCALE)} (352/512) about its centre. So here the layout is`,
  `72 dp x ${num(MASKABLE_SCALE)} = ${num(ADAPTIVE_VISIBLE_DP * MASKABLE_SCALE)} dp wide, centred on the 108 dp canvas:`,
  `  scale     = 72 x ${num(MASKABLE_SCALE)} / 512 = ${num(ADAPTIVE_SCALE)} dp per icon unit`,
  `  translate = 54 - 256 x ${num(ADAPTIVE_SCALE)} = ${num(ADAPTIVE_OFFSET)} dp`,
  `The corner marks (icon units ${SHAPES_MIN}..${SHAPES_MAX}) land on ${dp2(ADAPTIVE_OFFSET + SHAPES_MIN * ADAPTIVE_SCALE)}..${dp2(ADAPTIVE_OFFSET + SHAPES_MAX * ADAPTIVE_SCALE)} dp; their farthest`,
  `point is ${dp2(FARTHEST * ADAPTIVE_SCALE)} dp from the centre, inside the ${ADAPTIVE_SAFE_DP / 2} dp safe radius.`,
];

// iOS: the app icon, and the launch screen logo (black shapes on transparent).
const appIcon = await opaquePng(iconSvg({ px: IOS_ICON_PX }));
write(`${XCASSETS}/AppIcon.appiconset/AppIcon-1024.png`, appIcon);
write(`${XCASSETS}/AppIcon.appiconset/Contents.json`, xcodeJson({
  images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
  info: { author: 'xcode', version: 1 },
}));
for (const [scale, px] of Object.entries(LAUNCH_LOGO_PX)) {
  write(`${XCASSETS}/LaunchLogo.imageset/LaunchLogo@${scale}.png`, await alphaPng(iconSvg({ px, paper: null })));
}
write(`${XCASSETS}/LaunchLogo.imageset/Contents.json`, xcodeJson({
  images: Object.keys(LAUNCH_LOGO_PX).map((scale) => ({ filename: `LaunchLogo@${scale}.png`, idiom: 'universal', scale })),
  info: { author: 'xcode', version: 1 },
}));

// Android: adaptive icon (8+), themed icon (13+), splash icon (12+), launcher PNGs (7).
write(`${RES}/drawable/ic_launcher_foreground.xml`, vectorDrawable({
  sizeDp: ADAPTIVE_DP, scale: ADAPTIVE_SCALE, offset: ADAPTIVE_OFFSET,
  about: ['Adaptive icon foreground (Android 8+), over @color/ic_launcher_background.', '', ...ADAPTIVE_ABOUT],
}));
write(`${RES}/drawable/ic_launcher_monochrome.xml`, vectorDrawable({
  sizeDp: ADAPTIVE_DP, scale: ADAPTIVE_SCALE, offset: ADAPTIVE_OFFSET,
  about: ['Themed icon layer (Android 13+): the same shapes as ic_launcher_foreground.xml; the', 'launcher keeps only their alpha and tints them.', '', ...ADAPTIVE_ABOUT],
}));
write(`${RES}/drawable/splash_icon.xml`, vectorDrawable({
  sizeDp: SPLASH_DP, scale: SPLASH_SCALE, offset: SPLASH_OFFSET,
  about: [
    `Splash screen icon (Android 12+): ${SPLASH_DP} x ${SPLASH_DP} dp, shown through a centred ${SPLASH_MASK_DP} dp circle.`,
    `The 512-unit icon layout is drawn ${SPLASH_LAYOUT_DP} dp wide: scale ${SPLASH_LAYOUT_DP} / 512 = ${num(SPLASH_SCALE)} dp per icon unit,`,
    `translate (${SPLASH_DP} - ${SPLASH_LAYOUT_DP}) / 2 = ${num(SPLASH_OFFSET)} dp. Its farthest corner point is ${dp2(FARTHEST * SPLASH_SCALE)} dp from the`,
    `centre, ${dp2(SPLASH_MASK_DP / 2 - FARTHEST * SPLASH_SCALE)} dp inside the circle.`,
  ],
}));
// Status-bar icon for notifications: Android keeps only its alpha and tints it, and it is drawn
// at 24 dp, so it is the mark alone (no corner bars), as large as fits with 1 dp to spare.
const NOTE_DP = 24;
const NOTE_PAD = 1;
const MARK_W = MARK_BOX.width * MARK_SCALE;
const MARK_H = MARK_BOX.height * MARK_SCALE;
const NOTE_SCALE = (NOTE_DP - 2 * NOTE_PAD) / Math.max(MARK_W, MARK_H);
const NOTE_TX = (NOTE_DP - MARK_W * NOTE_SCALE) / 2 - MARK_AT.x * NOTE_SCALE;
const NOTE_TY = (NOTE_DP - MARK_H * NOTE_SCALE) / 2 - MARK_AT.y * NOTE_SCALE;
write(`${RES}/drawable/ic_notification.xml`, `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by mobile/scripts/brand-assets.mjs from the brand files in public/; do not edit.

     Notification icon (status bar): the mark of the brand icon alone, ${NOTE_DP} x ${NOTE_DP} dp,
     ${NOTE_PAD} dp spare on its longer side. Android uses only its shape and tints it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${NOTE_DP}dp"
    android:height="${NOTE_DP}dp"
    android:viewportWidth="${NOTE_DP}"
    android:viewportHeight="${NOTE_DP}">
    <group
        android:translateX="${num(NOTE_TX)}"
        android:translateY="${num(NOTE_TY)}"
        android:scaleX="${num(NOTE_SCALE)}"
        android:scaleY="${num(NOTE_SCALE)}">
        <group
            android:translateX="${num(MARK_TX)}"
            android:translateY="${num(MARK_TY)}"
            android:scaleX="${num(MARK_SCALE)}"
            android:scaleY="${num(MARK_SCALE)}">
            <path
                android:fillColor="#FFFFFFFF"
                android:fillType="${MARK.evenOdd ? 'evenOdd' : 'nonZero'}"
                android:pathData="${esc(MARK.d)}" />
        </group>
    </group>
</vector>
`);

const ADAPTIVE_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by mobile/scripts/brand-assets.mjs; do not edit. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`;
write(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`, ADAPTIVE_ICON_XML);
write(`${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, ADAPTIVE_ICON_XML);
write(`${RES}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by mobile/scripts/brand-assets.mjs; do not edit. The brand icon's background. -->
<resources>
    <color name="ic_launcher_background">${PAPER}</color>
</resources>
`);
for (const [density, px] of Object.entries(LEGACY_PX)) {
  write(`${RES}/mipmap-${density}/ic_launcher.png`, await opaquePng(iconSvg({ px })));
  write(`${RES}/mipmap-${density}/ic_launcher_round.png`, await alphaPng(iconSvg({ px, scale: MASKABLE_SCALE, round: true })));
}

// Store listings.
const playIcon = await alphaPng(iconSvg({ px: ICON }));
write('store/play-icon-512.png', playIcon);
write('store/app-store-icon-1024.png', appIcon);
write('store/README.md', [
  'Store images for the إبداع apps, written by `node scripts/brand-assets.mjs` from the brand files in `../public` (do not edit them by hand).',
  '- `play-icon-512.png`: the app icon for the Google Play store listing (Play Console; 512 × 512, 32-bit PNG, the full icon on #FAFAF7).',
  '- `app-store-icon-1024.png`: the 1024 × 1024 App Store icon (opaque, no alpha), the same image as the app\'s `AppIcon-1024.png`; App Store Connect takes the icon from the uploaded build, so this copy is for listings, press and review notes.',
  '',
].join('\n'));

// The app's offline page shows the mark at about 96 px.
write('www/brand-mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON} ${ICON}" role="img" aria-label="إبداع">${SHAPES_SVG}</svg>\n`);

// ---- Capacitor defaults these replace --------------------------------------------------------
const removed = [];
function remove(rel) {
  const target = path.join(MOBILE, rel);
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  removed.push(rel);
}
remove(`${XCASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`);
remove(`${XCASSETS}/Splash.imageset`);
remove(`${RES}/drawable-v24/ic_launcher_foreground.xml`);
const resDirs = () => fs.readdirSync(path.join(MOBILE, RES), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
for (const dir of resDirs()) {
  if (dir.startsWith('mipmap-')) remove(`${RES}/${dir}/ic_launcher_foreground.png`);
  if (dir === 'drawable' || dir.startsWith('drawable-')) remove(`${RES}/${dir}/splash.png`);
}
for (const dir of resDirs()) {
  if (/^(drawable|mipmap)(-|$)/.test(dir) && fs.readdirSync(path.join(MOBILE, RES, dir)).length === 0) remove(`${RES}/${dir}`);
}

// ---- Self-check ------------------------------------------------------------------------------
const problems = [];
const diffs = [];
async function compare(label, image, reference) {
  const [a, b] = await Promise.all([image, reference].map((src) =>
    sharp(src).flatten({ background: PAPER }).raw().toBuffer({ resolveWithObject: true })));
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) {
    problems.push(`${label}: ${a.info.width}x${a.info.height}x${a.info.channels} vs ${b.info.width}x${b.info.height}x${b.info.channels}`);
    return;
  }
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
  const diff = sum / a.data.length;
  diffs.push([diff, label]);
  if (diff > MAX_MEAN_DIFF) problems.push(`${label}: mean abs diff ${diff.toFixed(3)} > ${MAX_MEAN_DIFF.toFixed(1)}`);
}
const readVector = (name) => vectorDrawableToSvg(fs.readFileSync(path.join(MOBILE, RES, 'drawable', `${name}.xml`), 'utf8'));
const foregroundVd = readVector('ic_launcher_foreground');
const splashVd = readVector('splash_icon');
const visibleAt = (ADAPTIVE_DP - ADAPTIVE_VISIBLE_DP) / 2;

await compare('rebuilt icon vs public/icon-512.png', Buffer.from(iconSvg({ px: ICON })), BRAND_ICON);
await compare('maskable layout vs public/icon-maskable-512.png', Buffer.from(iconSvg({ px: ICON, scale: MASKABLE_SCALE })), BRAND_MASKABLE);
for (const name of ['ic_launcher_foreground', 'ic_launcher_monochrome']) {
  await compare(`${name}.xml, centre ${ADAPTIVE_VISIBLE_DP} dp vs icon-maskable-512.png`,
    Buffer.from(vectorSvg(readVector(name), { at: visibleAt, size: ADAPTIVE_VISIBLE_DP, px: ICON })), BRAND_MASKABLE);
}
await compare(`splash_icon.xml, its ${SPLASH_LAYOUT_DP} dp layout vs icon-512.png`,
  Buffer.from(vectorSvg(splashVd, { at: SPLASH_OFFSET, size: SPLASH_LAYOUT_DP, px: ICON })), BRAND_ICON);
await compare('www/brand-mark.svg vs icon-512.png', await sharp(path.join(MOBILE, 'www/brand-mark.svg')).resize(ICON, ICON).png().toBuffer(), BRAND_ICON);
await compare('store/play-icon-512.png vs icon-512.png', path.join(MOBILE, 'store/play-icon-512.png'), BRAND_ICON);

async function expectPng(rel, { size, channels, opaque = false, clearCorner = false }) {
  const { data, info } = await sharp(path.join(MOBILE, rel)).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== size || info.height !== size) problems.push(`${rel}: ${info.width}x${info.height}, not ${size}x${size}`);
  if (info.channels !== channels) problems.push(`${rel}: ${info.channels} channels, not ${channels}`);
  if (info.channels !== 4) return;
  if (opaque && data.some((v, i) => i % 4 === 3 && v !== 255)) problems.push(`${rel}: has see-through pixels`);
  if (clearCorner && data[3] !== 0) problems.push(`${rel}: its corner is not transparent`);
}
await expectPng(`${XCASSETS}/AppIcon.appiconset/AppIcon-1024.png`, { size: IOS_ICON_PX, channels: 3 });
for (const [scale, px] of Object.entries(LAUNCH_LOGO_PX)) {
  await expectPng(`${XCASSETS}/LaunchLogo.imageset/LaunchLogo@${scale}.png`, { size: px, channels: 4, clearCorner: true });
}
for (const [density, px] of Object.entries(LEGACY_PX)) {
  await expectPng(`${RES}/mipmap-${density}/ic_launcher.png`, { size: px, channels: 3 });
  await expectPng(`${RES}/mipmap-${density}/ic_launcher_round.png`, { size: px, channels: 4, clearCorner: true });
}
await expectPng('store/play-icon-512.png', { size: ICON, channels: 4, opaque: true });
if (!fs.readFileSync(path.join(MOBILE, 'store/app-store-icon-1024.png')).equals(appIcon)) problems.push('store/app-store-icon-1024.png differs from AppIcon-1024.png');

const adaptiveFarDp = FARTHEST * ADAPTIVE_SCALE;
if (adaptiveFarDp > ADAPTIVE_SAFE_DP / 2) problems.push(`adaptive icon: corners reach ${dp2(adaptiveFarDp)} dp from the centre, outside the ${ADAPTIVE_SAFE_DP} dp safe circle`);
const splashSpareDp = SPLASH_MASK_DP / 2 - FARTHEST * SPLASH_SCALE;
if (splashSpareDp < SPLASH_MIN_SPARE_DP) problems.push(`splash icon: corners only ${dp2(splashSpareDp)} dp inside the ${SPLASH_MASK_DP} dp circle`);
if (FARTHEST * MASKABLE_SCALE > MASKABLE_SAFE_RADIUS) problems.push('round icon: corners outside the maskable safe circle');

// ---- Preview contact sheet (review only) -----------------------------------------------------
async function writePreview(file) {
  const TILE = 256;
  const GAP = 32;
  const LABEL = 46;
  const COLS = 4;
  const read = (rel) => fs.readFileSync(path.join(MOBILE, rel));
  const paperTile = () => sharp({ create: { width: TILE, height: TILE, channels: 4, background: PAPER } });
  const svgPng = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
  const circle72 = `<circle cx="${ADAPTIVE_DP / 2}" cy="${ADAPTIVE_DP / 2}" r="${ADAPTIVE_VISIBLE_DP / 2}"/>`;
  // AOSP's squircle launcher mask (config_icon_mask, 100 x 100 units) on the visible 72 dp.
  const squircle72 = `<path transform="translate(${visibleAt} ${visibleAt}) scale(${ADAPTIVE_VISIBLE_DP / 100})" d="M50,0 C10,0 0,10 0,50 0,90 10,100 50,100 90,100 100,90 100,50 100,10 90,0 50,0 Z"/>`;
  const splashCircle = (attrs) => `<circle cx="${SPLASH_DP / 2}" cy="${SPLASH_DP / 2}" r="${SPLASH_MASK_DP / 2}"${attrs}/>`;
  const legacySquares = ['mdpi', 'hdpi', 'xhdpi'].map((d) => ({ input: read(`${RES}/mipmap-${d}/ic_launcher.png`), px: LEGACY_PX[d] }));
  let x = (TILE - legacySquares.reduce((s, t) => s + t.px, 0) - 16 * (legacySquares.length - 1)) / 2;
  const legacyRow = legacySquares.map((t) => { const at = { input: t.input, left: x, top: (TILE - t.px) / 2 }; x += t.px + 16; return at; });
  const markSize = 96;
  const markPng = await sharp(read('www/brand-mark.svg'), { density: (72 * markSize) / ICON }).resize(markSize, markSize).png().toBuffer();

  const tiles = [
    ['iOS app icon', 'AppIcon-1024.png at 256 px', await sharp(appIcon).resize(TILE, TILE).png().toBuffer()],
    ['Android adaptive, circle', `foreground XML, centre ${ADAPTIVE_VISIBLE_DP} dp`,
      await svgPng(vectorSvg(foregroundVd, { at: visibleAt, size: ADAPTIVE_VISIBLE_DP, px: TILE, clip: circle72 }))],
    ['Android adaptive, squircle', `foreground XML, centre ${ADAPTIVE_VISIBLE_DP} dp`,
      await svgPng(vectorSvg(foregroundVd, { at: visibleAt, size: ADAPTIVE_VISIBLE_DP, px: TILE, clip: squircle72 }))],
    ['Android 7 round icon', 'mipmap-xxxhdpi, 192 px', read(`${RES}/mipmap-xxxhdpi/ic_launcher_round.png`)],
    ['Android 12 splash', `splash_icon.xml, ${SPLASH_MASK_DP} dp circle dashed`,
      await svgPng(vectorSvg(splashVd, { at: 0, size: SPLASH_DP, px: TILE, clip: splashCircle(''), clipAll: false,
        over: splashCircle(' fill="none" stroke="#8A8A85" stroke-width="1.5" stroke-dasharray="5 4"') }))],
    ['iOS launch logo', 'LaunchLogo@2x.png on #FAFAF7', await paperTile().composite([{ input: read(`${XCASSETS}/LaunchLogo.imageset/LaunchLogo@2x.png`) }]).png().toBuffer()],
    ['Android 7 square icons', '48, 72 and 96 px, actual size',
      await sharp({ create: { width: TILE, height: TILE, channels: 4, background: '#00000000' } }).composite(legacyRow).png().toBuffer()],
    ['Offline page mark', `www/brand-mark.svg at ${markSize} px`,
      await paperTile().composite([{ input: markPng, left: (TILE - markSize) / 2, top: (TILE - markSize) / 2 }]).png().toBuffer()],
  ];
  const rows = Math.ceil(tiles.length / COLS);
  const width = GAP + COLS * (TILE + GAP);
  const height = GAP + rows * (TILE + LABEL + GAP);
  const layers = [];
  let labels = '';
  for (const [i, [title, note, png]] of tiles.entries()) {
    const left = GAP + (i % COLS) * (TILE + GAP);
    const top = GAP + Math.floor(i / COLS) * (TILE + LABEL + GAP);
    const meta = await sharp(png).metadata();
    layers.push({ input: png, left: left + Math.round((TILE - meta.width) / 2), top: top + Math.round((TILE - meta.height) / 2) });
    labels += `<text x="${left}" y="${top + TILE + 20}" font-size="15" font-weight="600">${esc(title)}</text>`;
    labels += `<text x="${left}" y="${top + TILE + 38}" font-size="13">${esc(note)}</text>`;
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Inter, DejaVu Sans, sans-serif" fill="#161616">${labels}</g></svg>`), left: 0, top: 0 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: '#C4C4BE' } }).composite(layers).png().toFile(file);
}
await writePreview(previewFile);

// ---- Summary ---------------------------------------------------------------------------------
console.log(`brand-assets: wrote ${written.length} files`);
console.log(`  iOS      AppIcon-1024.png (opaque RGB), LaunchLogo @2x/@3x (${Object.values(LAUNCH_LOGO_PX).join('/')} px, transparent)`);
console.log(`  Android  adaptive foreground + monochrome: layout ${num(ADAPTIVE_VISIBLE_DP * MASKABLE_SCALE)} dp of ${ADAPTIVE_DP} (scale ${num(ADAPTIVE_SCALE)}, offset ${num(ADAPTIVE_OFFSET)} dp), corners ${dp2(adaptiveFarDp)} dp from the centre (safe ${ADAPTIVE_SAFE_DP / 2})`);
console.log(`           splash_icon: layout ${SPLASH_LAYOUT_DP} dp of ${SPLASH_DP} (scale ${num(SPLASH_SCALE)}, offset ${num(SPLASH_OFFSET)} dp), corners ${dp2(splashSpareDp)} dp inside the ${SPLASH_MASK_DP} dp circle`);
console.log(`           launcher PNGs ${Object.values(LEGACY_PX).join('/')} px (square + round), background ${PAPER}`);
console.log('  store    play-icon-512.png, app-store-icon-1024.png, README.md');
console.log('  www      brand-mark.svg');
console.log(removed.length ? `removed ${removed.length}:\n${removed.map((r) => `  ${r}`).join('\n')}` : 'removed nothing (already clean)');
console.log(`self-check, mean abs diff out of 255 (limit ${MAX_MEAN_DIFF.toFixed(1)}):`);
for (const [diff, label] of diffs) console.log(`  ${diff.toFixed(3)}  ${label}`);
console.log(`preview: ${previewFile}`);
if (problems.length) {
  console.error(`self-check FAILED:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exitCode = 1;
}
