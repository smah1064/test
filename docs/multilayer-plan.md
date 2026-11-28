# Multi-layer laser / CNC wall art: technical plan

Status: plan only, nothing built yet. Written 28 Nov 2026 against branch `ccr-ca2b0d23-u6zfx5`.
Audience: the coder who builds it step by step (CNC & Laser chat), and the main website chat, which owns
`src/app.js` and `public/js/editor.js`.

Words used here:

- **Layer**: one sheet of one material and colour, cut as one job. One layer = one cut file.
- **Level**: how high a layer sits in the stack (0 = the back board). Two layers may share a level when they never
  overlap (the colour bands of a rainbow).
- **Panel**: one framed piece of a set (a 3-panel wall set has three).
- **Stack**: the layers of a product with their materials and heights, bottom to top.
- "main chat" = the main website chat. "CNC chat" = the CNC & Laser chat.

---

## 1. Summary

**For customers.** A new kind of product: wall art made of 2 to 5 levels of cut wood, MDF or acrylic, glued on top
of each other. The customer picks a ready layered design, types a name or date (it sits on the top layer), picks a
colour for each layer (or one ready colour scheme in one tap), optionally a frame, and sees a 3D preview where the
layers really stand on each other with shadows between them. Then orders as with any other product. Customers do
not draw the scene themselves: the scene artwork is the shop's own and stays fixed; they change words and colours.
Nothing changes for today's products.

**For the workshop.** In the order page, each layered item shows a table of its layers (number, name, material,
colour, thickness) and three kinds of download: one LightBurn SVG per layer (red hairlines = cut, in mm, real
size), one A4 assembly sheet (PDF: stacking order, colours, thickness, small pictures of each layer) and one ZIP
with everything. Text that is engraved on a layer (names on the leaves of the family tree) comes inside that
layer's file as the engraving image, exactly as today's LightBurn file.

**For the code.** One new idea runs through everything: a product may list **layers** (`product.laser.layers`),
and every element of a design carries the id of its layer (`layer` on the Fabric object). The colour of each layer
is a normal **product option** (the mechanism booklets and business cards already use for binding and lamination),
so the cart, order, invoice, admin, drafts, share links and prices handle it with almost no new code. A small new
shared file, `public/js/layers.js`, holds all the layer rules (which layer an element is on, which colour a layer
has, heights, price of extra layers) and is used by the editor, the ready-design page, the 3D preview and the
server, so they always agree. New work, by file:

| File | Owner | What |
| --- | --- | --- |
| `public/js/layers.js` (new) | CNC chat | The layer rules, browser + Node |
| `src/products.js` (laser/CNC sections, new products) | CNC chat | Materials list, `layerOptions()`, `frameOption()`, products |
| `src/laser.js` | CNC chat | Per-layer cut SVG, layer report, assembly sheet |
| `public/js/preview3d.js` | CNC chat (tell main chat before merging) | `buildLayered` |
| `public/js/preview.js`, `templates.js`, `design-render.js`, `design.js`, `admin.js`, `i18n.js`, CSS | CNC chat, shared files: tell main chat first, keep the diffs small | Pass layers through, ready-design page, admin block, texts |
| `src/library-dsl.js`, `src/library-packs/layered.js` (new) | CNC chat | Ready layered designs |
| `public/js/editor.js` | **main chat** | Requests E1 to E10 (section 4) |
| `src/app.js` | **main chat** | Requests A1 to A7 (section 6) |

Products without `laser.layers` take none of the new code paths. Old designs, drafts, carts and orders are not
migrated and not touched.

---

## 2. Current state: what exists and what we reuse

### Product data (`src/products.js`)

- Laser section (search "Laser engraving and cutting"): `laser.kind` (`'engrave'` | `'cut'`), `laser.cut`
  (`'rounded'` | `'arch'` | `null`), `laser.radiusMm`, `laser.bridgeMm`, `laser.pieces` (`'one'` | `'many'`),
  `laser.board`. Colours are materials: `{ id, name, hex, ink }`; `ink` is the one tone the design is drawn in
  (`LASER_WOODS`, `WOOD()`).
- CNC section (search "CNC routing and UV printing"): `calligraphy` (board + raised design), `nameart` and
  `eventletters` (cut pieces).
- `PRODUCTION` table (search `calligraphy: { process: 'cnc'`): `process`, `safeIn`, `bleedIn`, `model`. Laser
  models have `material: 'laser'`; `calligraphy` has `raised: 0.2`.
- `SIZE_PRINT_SCALE`: bigger sizes are the same shape scaled (`printScale`).
- Product options: `options: [{ id, name, help, keepDefault, choices: [{ id, name, price }] }]`, where `price` is a
  number or `{ sizeId: number }`. `cleanOptions(product, raw)` validates, `optionsPrice(product, options, sizeId)`
  prices. **Reused for per-layer colours and for the frame.**
- `p.mix.colors = false` for every laser product (one design = one material). Stays true for layered products.

### Production files (`src/laser.js`)

- `sizeMm`, `strength` (alpha = laser on), `near` (cheap dilation), `dither`, `engravePng`.
- `traceCut(buf, opts)`: traces the alpha at up to 12 px/mm, capped at 4000 px on the long side.
- `roundedRect`, `archPath`, `boardPath(laser, w, h)`, `cutPaths`, `cutSvg`, `laserSvg`, `cutReport`
  (`{ pieces, smallestMm2 }`).
- Uses `public/js/trace.js` (`trace`, `pathData`) on the server: precedent for a file shared by browser and Node.

### Server (`src/app.js`, main chat)

- `FILE_RE` (line ~118): the upload names a design may have.
- `POST /api/designs` (line ~1944): validates product, colour, size, sides and options; keeps each side's
  `editor` object as sent; lists `expectedFiles`; the client uploads exactly the names the server returns.
  A side can keep geometry with the design (`side.fan`), so later product changes do not change an order.
- `designPrice` (line ~3536): `priceFor(product, sizeId, sides)` + `optionsPrice`.
- `FORMATS`, `laserSpec`, `SUFFIX`, `makeFile` (line ~7313 to ~7545): `laser-svg`, `engrave-png`, `cut-svg`, made
  on first request from `<side>-print.png` and cached next to it. `photosZip` builds a ZIP.
- `adminItem` (line ~464) feeds the order page.

### Editor (`public/js/editor.js`, main chat)

- One-tone mode (line ~511 to ~575): `laser()`, `inkOf()`, `lightEngrave()`, `engraveFilters()`,
  `laserTone(o)`, `retoneAll()`, `measureCut()` (counts pieces on a small render).
- `canvas.on('object:added')` tones every new object; `commit()` re-tones everything.
- `EXTRA_PROPS` (line 22): the custom properties saved with each object. `selectable` and `evented` are already
  in it (used for locked artwork).
- `serialize()`, `loadObjects()`, `renderOptions()` (line ~4400, option chips with `data-opt` / `data-choice`),
  `st.options` (saved in drafts, share links, the design hash and the save payload already).
- `checkIssues()` (line ~5180; laser checks at ~5314): photo on a cut product, text too small, pieces fall apart.
- Save flow (line ~7470 to ~7560): per side `exportPrint`, `exportPreview`, `exportSvg`, then
  `POST /api/designs`, then uploads `created.files`.
- Preview (line ~7650 to ~7734): builds `sides` and calls `POD_PREVIEW.open({ product, color, sides, ... })`.

### Shared front-end

- `public/js/fabric-ext.js`: `POD_FX.laserTone(o, { ink, light, bridge, images })` and the `Engrave` image filter.
- `public/js/templates.js`: `buildTemplate(tpl, area, ink, opts)` builds Fabric objects from pack items;
  `makeImage` loads the shop's SVG art (`/img/art/...`) as a Fabric group; `full: true` covers the whole area and
  switches off the automatic margin.
- `public/js/design-render.js`: the ready-design page's renderer: `stage()`, `printBlob()`, `designLayer()`,
  `serialize()`, `addToCart()`. It applies `laserTone` itself and does not send options today.
- `public/js/preview.js`: `renderRealistic` (2D), `raise()` (shadow and rim for `model.raised`), and the 3D tab,
  which copies named fields into `textures[side.id]` and calls `mount()`.
- `public/js/nesting.js`: `POD_NEST.pack(items, rollWidth, gap)`, rectangle packing (DTF gang sheets).

### 3D preview (`public/js/preview3d.js`)

- `laserLook(color, product)`, `laserMats(look, hex, renderer, painted)` → `{ face, edge }` (wood, slate,
  leather, metal, mirror, acrylic).
- `cutSheet(shape, depth, mats)`, `boardShape(w, h, r)`, `archShape`, `engraving(crop, w, h, renderer, opts)`,
  `beam(a, b, sw, sd, material)`.
- `designOutline(crop, wIn)` (trace at up to 600 px, nesting of contours, `smoothOutline`), `solidShapes`,
  `extrudeShapes(shapes, depth, mats)`, `loadTrace()`, `traceFailed()`.
- `raisedBlock` (board + raised design, falls back to a flat engraved board), `laserCutout`, `laserPuzzle`
  (many traced pieces, each its own colour), `buildLaser` (dispatch), `mount()` (async builders allowed).
- No shadow maps today: only a soft contact shadow under the product.

### Work in progress to be aware of

While this plan was written, the working tree held uncommitted two-layer work from another session: six new
one-tone products (`calligraphypanel`, `doorhanger`, `keyholder`, `ramadanlight`, `couplestand`, `woodinvite`) in
`src/products.js`, a pack `src/library-packs/cnc-twolayer.js` (named in `src/library.js`, `OWN_DESIGNS_ONLY`) and
new helpers in `public/js/preview3d.js` (`placeBoard`, `jute`, `hooks`, `standBase`). They use the existing
board + raised-design model, not real layers, and this plan does not change them. Step 4 edits the same file
(`preview3d.js`): rebase on that work first and reuse `placeBoard` if it fits.

### Ready designs

- `src/library-dsl.js`: `T` (text), `S` (shape), `A` (icon), `I` (shop artwork file), `D` (design).
- `src/library-packs/laser.js`, `cnc-uv.js`: `forProduct(product, aspect, color)`; designs are tied to their
  product with `products: [id]`.

### Tests

- `test/laser.test.js` (laser.js units), `test/laser-api.test.js` (design → files through the API),
  `test/cnc-uv-products.test.js`, `test/library-laser.test.js`, `test/library-cnc-uv.test.js`,
  `test/library-packs.test.js`, e2e: `test/e2e/calligraphy-raised.e2e.js`, `preview3d-pen-wallet.e2e.js`.
- `npm test` = `node --test test/*.test.js`; `npm run test:e2e` = `node --test test/e2e/*.e2e.js`.

---

## 3. Data model

### 3.1 Decisions

1. **Layers are fixed by the product.** A product lists up to 8 layer slots. Customers cannot add layers. A design
   may leave slots empty; an empty cut layer is not made and not charged.
2. **Each element says its layer**: the Fabric object property `layer` (the layer id). No `layer` = the product's
   default layer. An unknown id = the default layer.
3. **Each layer's colour is a product option** (one option per layer, `keepDefault: true` so it is stored with
   every design). Exception: one layer may follow the product's own colour picker (`from: 'color'`), normally the
   back board, so the drawn mockup (`{{C}}`) shows it.
4. **The frame is a product option** (`id: 'frame'`), priced per size.
5. **A 3-panel set is one side, one design.** The print area covers the whole set; `laser.panels` says where the
   three panels are inside it. Art between panels is not made. Production and the 3D preview split by panel.
6. **The order keeps a snapshot of its stack** (as `side.fan` does for cups), so changing a product later does not
   change an order already placed.
7. **Legacy fields stay**: a layered product still has `laser.kind: 'cut'`, `bridgeMm`, `pieces`, so old code that
   reads them keeps working.

### 3.2 Product fields

New fields, all inside `laser` (so they reach the browser with the product, as `laser` does today):

```js
laser: {
  kind: 'cut', bridgeMm: 2, pieces: 'many', board: true,   // legacy fields, kept
  layers: [ /* bottom to top, 2 to 8 entries */
    {
      id: 'l1',                // /^[a-z0-9]{1,12}$/, unique in the product
      kind: 'backing',         // 'backing' = full board, nothing traced
                               // 'cut'     = cut along the outline of its elements
                               // 'engrave' = engraved on another layer (`on`), no thickness of its own
      name: t('Back board', 'لوح الخلفية'),
      level: 0,                // optional; default = position in the list. 0..4
      from: 'color',           // 'color' (product colour) | 'option' | 'fixed'
      option: 'l2',            // from 'option': id of the product option that picks the material
      material: { id, name, hex, look },  // from 'fixed'
      on: 'l3',                // kind 'engrave': the layer it is engraved on
      thicknessMm: 3,          // default 3; a material may override (mirror acrylic 2)
      cut: 'rect',             // kind 'backing': 'rect' | 'rounded' | 'round' | 'arch'; radiusMm for 'rounded'
      rimMm: 15,               // kind 'cut': add a border this wide all round, joined to the art (0 = none)
      pieces: 'one',           // kind 'cut': 'one' (warn if it falls apart) | 'many'
      bridgeMm: 2,             // kind 'cut': text is thickened by this so letters join
      accepts: ['text'],       // what customers may put on it: 'text', 'shape', 'art'. [] = shop art only
      minTextMm: 10,           // smallest letter height (default: cut 10, engrave 3)
      default: true,           // where new elements go. Exactly one layer; it must accept 'text'
    },
  ],
  panels: [ { x: 0, y: 0, w: 0.3, h: 1 }, ... ],  // optional, 1 to 3, fractions of the print area
  included: 3,                 // optional: cut layers covered by the base price
  layerPrice: { '40x60': 200, '60x90': 350 },     // optional: each used cut layer beyond `included`, per size
  palettes: [                  // optional: ready colour schemes (one tap sets several options)
    { id: 'night', name: t('Night', 'ليل'), options: { l2: 'navy', l3: 'sand', l4: 'gold' } },
  ],
}
```

Option choices for layers carry what the preview and the workshop need:

```js
{ id: 'l2', layer: 'l2', keepDefault: true, name: t('Sky colour', 'لون السما'),
  choices: [ { id: 'navy', name: t('Navy', 'كحلي'), price: 0, hex: '#1b2a4a', look: 'paint' }, ... ] }
```

`look` is one of `'paint'` (painted MDF), `'wood'`, `'acrylic'`, `'mirror'`. `price` may be `{ sizeId: n }` (mirror
acrylic costs more on a big size). The frame option: `{ id: 'frame', keepDefault: true, choices: [{ id: 'none',
price: 0 }, { id: 'natural', price: { '40x60': 350, '60x90': 600 }, hex: '#d8b183', look: 'wood' }, ...] }`.

The model in `PRODUCTION`:

```js
layerscene: { process: 'cnc', safeIn: 0.4, bleedIn: 0,
  model: { type: 'layered', material: 'laser', frame: { widthIn: 0.8, depthIn: 1.2 }, gapIn: 2 } },
```

`model.frame` is the frame's shape (drawn only when the `frame` option is not `none`); `gapIn` is the space between
panels of a set. `process` stays `'cnc'` or `'lasercut'` (no new process name: the admin's format lists and the
tests key on these).

Helpers to add in `src/products.js` (CNC section), so products stay short:

```js
const LAYER_MATERIALS = { navy: { name: t('Navy', 'كحلي'), hex: '#1b2a4a', look: 'paint' }, ... };  // section 10
/** One option per pickable layer. `spec` = [[layerId, en, ar, [materialIds], { priceBySize? }], ...] */
function layerOptions(spec) -> option[]
/** The frame option. `prices` = { natural: { '40x60': 350, ... }, black: {...}, white: {...} } */
function frameOption(prices) -> option
```

### 3.3 Example product

```js
{
  id: 'layerscene',
  category: 'home',
  name: t('Layered Wood Wall Art', 'لوحة خشب طبقات'),
  description: t('A scene cut in layers of painted wood, one on top of the other, with your family name. Ready to hang.',
                 'منظر مقصوص طبقات خشب ملوّن فوق بعض، باسم العيلة. جاهزة للتعليق.'),
  basePrice: 1800,
  colorLabel: t('Back board', 'لوح الخلفية'),
  colors: [
    { id: 'white', name: t('White', 'أبيض'), hex: '#f2eee7', ink: '#f2eee7', look: 'paint' },
    { id: 'navy', name: t('Navy', 'كحلي'), hex: '#1b2a4a', ink: '#1b2a4a', look: 'paint' },
    { id: 'black', name: t('Black', 'أسود'), hex: '#232326', ink: '#232326', look: 'paint' },
  ],
  sizes: [
    { id: '40x60', label: t('40 × 60 cm', '40 × 60 سم'), surcharge: 0 },
    { id: '60x90', label: t('60 × 90 cm', '60 × 90 سم'), surcharge: 1400 },
  ],
  options: [
    ...layerOptions([
      ['l2', 'Far layer', 'الطبقة البعيدة', ['navy', 'sky', 'sand', 'sage', 'terracotta', 'white', 'black']],
      ['l3', 'Middle layer', 'الطبقة الوسطى', ['sand', 'mustard', 'terracotta', 'sage', 'white', 'black', 'walnut']],
      ['l4', 'Front layer and name', 'الطبقة الأمامية والاسم', ['gold', 'white', 'black', 'walnut', 'natural']],
    ]),
    frameOption({ natural: { '40x60': 350, '60x90': 600 }, black: { '40x60': 350, '60x90': 600 }, white: { '40x60': 350, '60x90': 600 } }),
  ],
  sides: [{ id: 'front', name: FRONT,
    svg: sv(WALL('#e9e4dc') + shadowRect(90, 60, 320, 480, 4) + '<rect x="90" y="60" width="320" height="480" rx="4" fill="{{C}}" stroke="{{L}}" stroke-width="2"/>'),
    printArea: { x: 90, y: 60, w: 320, h: 480 }, printWidthIn: cmIn(40) }],
  cardArt: '...',
  laser: {
    kind: 'cut', bridgeMm: 2, pieces: 'many', board: true,
    layers: [
      { id: 'l1', kind: 'backing', name: t('Back board', 'لوح الخلفية'), from: 'color', cut: 'rect', thicknessMm: 3, accepts: [] },
      { id: 'l2', kind: 'cut', name: t('Far layer', 'الطبقة البعيدة'), from: 'option', option: 'l2', rimMm: 15, pieces: 'one', accepts: [] },
      { id: 'l3', kind: 'cut', name: t('Middle layer', 'الطبقة الوسطى'), from: 'option', option: 'l3', rimMm: 15, pieces: 'one', accepts: [] },
      { id: 'l4', kind: 'cut', name: t('Front layer', 'الطبقة الأمامية'), from: 'option', option: 'l4', rimMm: 15, pieces: 'one', bridgeMm: 2, accepts: ['text'], default: true },
    ],
    included: 3,
    layerPrice: { '40x60': 200, '60x90': 350 },
    palettes: [
      { id: 'night', name: t('Night', 'ليل'), options: { l2: 'navy', l3: 'sand', l4: 'gold' } },
      { id: 'desert', name: t('Desert', 'صحرا'), options: { l2: 'sky', l3: 'terracotta', l4: 'walnut' } },
    ],
  },
},
// SIZE_PRINT_SCALE: layerscene: { '60x90': 1.5 }
// PRODUCTION:       layerscene: { process: 'cnc', safeIn: 0.4, bleedIn: 0, model: { type: 'layered', material: 'laser', frame: { widthIn: 0.8, depthIn: 1.2 } } }
```

How the other three products map onto the same fields (built later):

- **Rainbow name sign**: 7 layers on 3 levels. `base` (`kind: 'cut'`, `level: 0`, `from: 'fixed'` raw MDF,
  `pieces: 'one'`; its shop art is the whole rainbow's silhouette, and it holds the bands); `b1..b5` = the colour
  bands (`kind: 'cut'`, all `level: 1`, each `from: 'option'`); `name` (`level: 2`, `pieces: 'one'`,
  `bridgeMm: 2.5`, `accepts: ['text']`, `default: true`, `from: 'color'`). Palettes do the heavy lifting
  (pastel, bold, boho).
- **3-panel wall set**: `l1` backing (`from: 'color'`), `l2` motif (`from: 'option'`, `pieces: 'many'`),
  `panels` = three rectangles; the side's `overlay` SVG draws the gaps over the editor canvas.
- **Family tree**: `l1` backing (round, `cut: 'round'`), `l2` tree (`kind: 'cut'`, `pieces: 'one'`), `l3` names
  (`kind: 'engrave'`, `on: 'l2'`, `accepts: ['text']`, `default: true`, `minTextMm: 3`).

### 3.4 Ready designs (library packs)

New pack `src/library-packs/layered.js`. Items are the usual DSL items plus two fields:

- `layer: '<layer id>'` on any item.
- `lock: true` on scene artwork: the customer cannot select, move or delete it (colour still follows its layer).

The design itself may carry `options` (the starting colour of each layer for this design) and nothing else new.
Artwork: one SVG per layer in `public/img/art/layered/<design>/<layer>.svg`, drawn by the shop.

```js
const { T, I, D } = require('../library-dsl');
const scene = (id, cat, en, ar, items, color, options) =>
  D(id, cat, en, ar, items, color, { product: 'layerscene', aspect: 320 / 480, products: ['layerscene'], options });
const art = (design, layer) => I(`/img/art/layered/${design}/${layer}.svg`, 1, 0.5, 0.5, { full: true, layer, lock: true });

scene('ml-pyramids-night', 'layered', 'Pyramids at night', 'الأهرامات بالليل', [
  art('pyramids-night', 'l2'),     // sky with stars and moon cut out
  art('pyramids-night', 'l3'),     // the three pyramids
  art('pyramids-night', 'l4'),     // dunes, palms and a plain band for the name
  T('عائلة محمود', 'Lalezar', 0.085, 0.5, 0.9, { layer: 'l4', weight: 'bold', sampleName: 'family', samplePart: 'محمود' }),
], 'navy', { l2: 'navy', l3: 'sand', l4: 'gold' });
```

Rules for the artwork files (checked by a test, step 5):

- The SVG's `viewBox` has the print area's shape (here 2:3), so `full: true` places it exactly.
- Filled shapes only, one colour, no strokes, no text, no images, no gradients. The colour in the file does not
  matter (the layer's colour replaces it).
- No part thinner than the layer's minimum feature at the smallest size (section 10).
- A layer with `rimMm` does not need to draw the border: the code adds it. Art must touch the border or other
  art so the layer is one piece when `pieces: 'one'`.
- A text on a cut layer must overlap the layer's art (a "name band"), so the name is part of the piece.

### 3.5 What a customer's design stores

Per element (inside `sides[side].editor.objects[i]`, written by Fabric through `EXTRA_PROPS`):

| Property | Type | Meaning |
| --- | --- | --- |
| `layer` | string | Layer id. Missing or unknown = the default layer |
| `lockLayer` | boolean | Shop scene art: not selectable (also `selectable: false`, `evented: false`, already saved today) |

Per side (new key, sent by the editor and the ready-design page, kept by the server as it keeps `editor` today):

```js
sides.front.editor.ml = { v: 1, layers: ['l1', 'l2', 'l3', 'l4'] }   // used layer ids, bottom to top
```

Per design (existing key): `options: { l2: 'navy', l3: 'sand', l4: 'gold', frame: 'natural' }` in the request;
stored by `cleanOptions` as `{ l2: { id, name, optionName }, ... }`.

Stored by the server on the design's side (snapshot, request A2):

```js
design.sides[0].layers = [
  { id: 'l1', n: 1, level: 0, kind: 'backing', name: { en, ar }, thicknessMm: 3, zMm: 0,
    material: { id: 'navy', name: { en, ar }, hex: '#1b2a4a', look: 'paint' }, cut: 'rect', radiusMm: 0 },
  { id: 'l2', n: 2, level: 1, kind: 'cut', name, thicknessMm: 3, zMm: 3, material: {...}, rimMm: 15, pieces: 'one', bridgeMm: 0 },
  ...
];
design.sides[0].panels = [{ x, y, w, h }, ...];   // only for sets
```

Files: one extra upload per used `cut` or `engrave` layer: `front-layer-l2.png`, the layer alone, same pixel size
as `front-print.png`, where only alpha matters. `front-print.png` stays the full picture in the chosen colours
(proof, cart picture, flat fallback).

### 3.6 Versioning and migration

- **No migration.** Old designs have no `layer`, no `ml`, no layer files, and their products have no
  `laser.layers`: every new code path starts with `POD_LAYERS.layersOf(product)` and stops when it returns `null`.
- **Drafts** (local and account drafts) store objects through `EXTRA_PROPS` and `st.options` already, so the layer
  of each element and each layer's colour survive a reload once `layer` is in `EXTRA_PROPS` (request E1).
- **Product changes later.** A layer removed from a product: its elements fall to the default layer when the
  design is opened again. A material removed: `cleanOptions` already refuses an unknown choice at save; the
  editor's `optionsFrom()` already falls back to the first choice on load. Orders use their snapshot.
- **`ml.v`** is 1. A future change of meaning bumps it; readers treat a missing `ml` as "not layered" and an
  unknown `v` as 1.
- A draft made on a layered product before a deploy and saved after it works: the server decides which layer
  files it wants (`created.files`), the client uploads those names only.

### 3.7 The shared rules file: `public/js/layers.js` (new)

UMD wrapper like `trace.js` and `nesting.js` (`window.POD_LAYERS` in the browser, `require` on the server). Pure
functions, no DOM, no Fabric.

```js
LIMITS = { maxLayers: 8, maxLevels: 5, maxPanels: 3 }

layersOf(product) -> Layer[] | null
  // null unless product.laser.layers is a valid list. Each Layer is normalised:
  // { id, index, n (index + 1), level, kind, name, from, option, material, on, thicknessMm, cut, radiusMm,
  //   rimMm, pieces, bridgeMm, accepts, minTextMm, isDefault }

defaultLayer(product) -> Layer
layerOf(product, obj) -> Layer                 // obj.layer; missing or unknown -> defaultLayer
accepts(layer, obj) -> boolean                 // obj.type: text types -> 'text'; group/path/shape -> 'shape' or 'art'; image -> false
materialOf(product, layer, sel) -> { id, name, hex, look, thicknessMm }
  // sel = { colorId, options }. options values may be 'navy' or { id: 'navy' } (editor state or stored design).
  // 'engrave' layers: the host's material with hex = engraved tone (darker by 45% on wood/paint, '#e6ecef' on acrylic).
stack(product, sel) -> StackLayer[]            // Layer + { material, thicknessMm, zMm }
  // zMm = height of the layer's underside: sum of the thickest layer of each lower level.
toneFor(product, obj, sel, unitsPerInch) -> { ink, light: false, bridge }   // what POD_FX.laserTone needs
sortByLayer(objects, product) -> objects       // stable sort by (level, index); returns the same array object
usedLayerIds(product, objects) -> string[]     // backing layers always; others only if an object is on them
extraPrice(product, sizeId, usedIds) -> number // max(0, used cut layers - included) * layerPrice[sizeId]; 0 if not set
panelsOf(product) -> [{ x, y, w, h }]          // [{ x: 0, y: 0, w: 1, h: 1 }] when there are none
validate(product) -> string[]                  // data mistakes, for the product tests (empty = fine)
```

`validate` checks: 2 to 8 layers; unique ids of the right form; at most 5 distinct levels; exactly one default,
and it accepts text; every `option` exists in `product.options`, has `keepDefault: true` and every choice has
`hex` and `look`; at most one `from: 'color'`; `on` points at a cut or backing layer; panels inside 0..1 and not
overlapping; `layerPrice` has every size id; the lowest level is a backing or a `pieces: 'one'` cut layer.

---

## 4. Editor

Everything in this section that touches `public/js/editor.js` is a **request to the main chat** (E1 to E10). The
texts (i18n keys, both languages) and the CSS can be prepared by the CNC chat.

### 4.1 What the customer sees

- A **Layers** panel, only on layered products. Rows from the top layer down to the back board (the order
  people know from design apps). Each row: a colour swatch (opens that layer's colours), the layer's name, how
  many elements are on it, an eye button (show / hide) and a "focus" button (the other layers fade to 25%).
- Above the rows, when the product has `palettes`: a line of ready colour schemes; one tap sets every layer.
- Hide and focus are **view only**: never saved, never in a draft, and every export (print, masks, preview)
  first shows all layers again.
- Selecting an element highlights its layer's row. The properties panel shows "Layer: <name>" with a "Move to
  layer" choice listing only the layers that accept that kind of element. Locked scene art cannot be selected.
- New text goes to the default layer (or the focused layer, if it accepts text).
- Colours in the properties panel stay hidden as on one-tone products; the note there (`laser.toneTitle`) says
  "This element takes the colour of its layer: <layer name>".
- Uploads: photos make no sense on cut layers (today's `check.cutPhoto` warning). On layered products the upload
  button stays, the existing rights rules stay untouched, and an uploaded image goes to an engrave layer when the
  product has one; otherwise the existing warning shows. No new way around the rights checks is added.

**Mobile.** A "Layers" chip in the toolbar opens a bottom sheet with the same rows. Rows at least 44 px high,
swatches 36 px, colour choices in one line that scrolls sideways, the sheet no taller than 60% of the screen so
the canvas stays visible behind it. Layout uses logical CSS (`margin-inline-start`, `inset-inline-end`,
`text-align: start`), no left/right, so it mirrors in Arabic.

### 4.2 Requests to the main chat (`public/js/editor.js`)

**E1. Save the layer with each element.** Add `'layer'` and `'lockLayer'` to `EXTRA_PROPS` (line 22). Load
`/js/layers.js` on the editor page before `editor.js`.

**E2. One tone per layer.** In the editor's `laserTone(o, opts)` wrapper (line ~523): when
`POD_LAYERS.layersOf(st.product)` is not null, take the tone from
`POD_LAYERS.toneFor(st.product, o, { colorId: st.colorId, options: st.options }, rects().u)` and pass its
`{ ink, light, bridge }` to `window.POD_FX.laserTone` instead of `inkOf()` / `lightEngrave()` / the product
bridge. Same in `engraveFilters(o)`. In the option click handler (line ~4444): after `st.options` changes on a
layered product, call `retoneAll()`. Nothing changes when the product has no layers.

**E3. Elements stay in layer order.** In `canvas.on('object:added')`: on a layered product, an object without
`layer` gets `st.layerTarget || POD_LAYERS.defaultLayer(st.product).id`; if that layer does not accept it, the
first layer that does. In `commit()`: if the canvas order differs from `POD_LAYERS.sortByLayer(...)`, reorder
with `canvas.moveTo` (inside `st.silent`, no extra history step). "Bring forward / send back" move an element
only among elements of its own layer.

**E4. Layers panel.** New `renderLayers()` called from `renderOptions()` / `refreshChrome()`; markup
`#layers-panel` with rows `button[data-layer]`, swatch `button[data-layer-colour]`, `button[data-layer-eye]`,
`button[data-layer-solo]`, palettes `button[data-palette]`. View state in `st.layerView = { hidden: [], solo: null }`
(not in drafts, not in the design hash). Hidden layers: `o.visible = false` on screen only; focus: `o.opacity`
shown at 25% through a render-time override, not by changing the saved opacity. Layer options are rendered here
as swatches, and **left out of the generic option chips** of `renderOptions()` (an option with `layer` set is a
layer colour). The frame option stays a normal chip.

**E5. Move to layer.** In the properties panel for a selected element on a layered product: a select
`#p-layer` with the accepting layers; on change set `o.layer`, re-tone, `commit()`.

**E6. Opening a ready design.** When the design from the library has `options`, start `st.options` from them
(through `optionsFrom()` so unknown ids fall back). Items with `lock` arrive from `buildTemplate` already locked
(`selectable: false`, `evented: false`, `lockLayer: true`); the editor must keep them out of "select all",
"delete all" and the layer list of movable elements. Palette tap: `st.options = { ...st.options, ...palette.options }`,
then `retoneAll()`.

**E7. Checks.** In `checkIssues()` (laser block, line ~5314), for layered products replace the single-layer
checks by per-layer ones (keys in 4.3):

- text smaller than the layer's `minTextMm` → `layers.smallText` (warn);
- a `pieces: 'one'` layer that comes out in more than one piece → `layers.pieces` (warn). `measureCut()` is
  generalised: one small render per used cut layer with only that layer's elements visible, plus the rim, result
  in `st.cutPiecesByLayer = { l4: 1, ... }`. At most 8 renders of 260 px, on the same 350 ms debounce;
- an element on a layer that does not accept it (can happen after a product change) → moved to the default layer
  silently, no warning;
- a text on a cut layer that touches nothing else of its layer (it would be a loose piece) on a `pieces: 'one'`
  layer is already caught by `layers.pieces`; on `pieces: 'many'` layers show `layers.looseText` (info level,
  only when the product has no backing under it);
- sets: a text that crosses the gap between two panels → `layers.acrossPanels` (warn);
- a used cut layer with no elements left (customer deleted the only text of a text-only layer) is fine; a design
  where every layer above the back board is empty is stopped by the server's existing `sideEmpty`.

Thin parts and unsupported pieces are checked on the server after upload (A6), where the full-size masks are;
the editor shows what the server found in the usual file-check list.

**E8. Saving.** In the save loop (line ~7490): on a layered product, per side, add
`ml: { v: 1, layers: POD_LAYERS.usedLayerIds(st.product, st.designs[s.id]) }` to the side's `editor`, and for
every used `cut` or `engrave` layer make `files[`${s.id}-layer-${id}.png`]` with a new
`exportLayerMask(side, layerId)`: all view overrides off, only that layer's elements visible, then the same
render as `exportPrint(side)` (same size, same clip), elements restored in `finally`. The upload loop already
sends only `created.files`, so this is safe before the server asks for them.

**E9. Preview.** Where the preview's `sides` are built (line ~7693 to ~7734): on a layered product add to each
entry `layers: [{ id, crop }]`, one canvas per used cut / engrave layer: the trim area only, at most 900 px on
the long side (600 px when `matchMedia('(max-width: 700px)')`), made the same way as `exportLayerMask` but small.
Pass `options: st.options` to `POD_PREVIEW.open(...)`.

**E10. Price.** Where the editor adds the options' prices (line ~5735): add
`POD_LAYERS.extraPrice(st.product, st.sizeId, POD_LAYERS.usedLayerIds(st.product, serialize()))` on layered
products, so the price shown is the price the server charges (A3).

### 4.3 Texts (both languages; added to `public/js/i18n.js` by the CNC chat)

| Key | English | Arabic |
| --- | --- | --- |
| `layers.title` | Layers | الطبقات |
| `layers.open` | Layers | الطبقات |
| `layers.count` | {n} elements | {n} عنصر |
| `layers.colour` | Colour of {layer} | لون {layer} |
| `layers.schemes` | Ready colour schemes | ألوان جاهزة |
| `layers.show` / `layers.hide` | Show layer / Hide layer | إظهار الطبقة / إخفاء الطبقة |
| `layers.focus` / `layers.unfocus` | Work on this layer only / Show all layers | اشتغل على الطبقة دي بس / إظهار كل الطبقات |
| `layers.moveTo` | Move to layer | انقل لطبقة |
| `layers.note` | This takes the colour of its layer: {layer}. Change it from Layers. | ده بياخد لون طبقته: {layer}. غيّره من الطبقات. |
| `layers.locked` | Part of the design. You can change its colour from Layers. | جزء من التصميم. تقدر تغيّر لونه من الطبقات. |
| `layers.smallText` | {name} is too small to cut: letters on {layer} need to be at least {mm} mm high. | {name} صغير على القص: الحروف في {layer} لازم تبقى {mm} مم على الأقل. |
| `layers.pieces` | {layer} would come out in {n} separate pieces. Keep every letter touching the rest. | {layer} هتطلع {n} قطع منفصلة. خلي كل الحروف لازقة في بعض. |
| `layers.looseText` | {name} will be a separate piece glued on by hand. | {name} هيبقى قطعة لوحدها وتتلزق باليد. |
| `layers.acrossPanels` | {name} runs across the gap between two panels and will be cut off there. | {name} معدّي على الفاصل بين لوحتين وهيتقطع هناك. |
| `layers.thin` | {layer} has parts thinner than {mm} mm. They may break when cut. | {layer} فيها أجزاء أرفع من {mm} مم وممكن تتكسر في القص. |
| `layers.floating` | {layer} has a piece with nothing under it to glue it to. | {layer} فيها قطعة مفيش تحتها حاجة تتلزق عليها. |
| `fmt.layer-cut` | Cut file, layer {n}: {layer} (SVG) | ملف القص، طبقة {n}: {layer} (SVG) |
| `fmt.assembly-pdf` | Assembly sheet (PDF) | ورقة التجميع (PDF) |
| `fmt.layers-zip` | All layers + assembly sheet (ZIP) | كل الطبقات + ورقة التجميع (ZIP) |
| `admin.layerFiles` | Layers, bottom to top | الطبقات من تحت لفوق |

No new text mentions payment. Nothing here promises cash on delivery.

---

## 5. 3D preview

### 5.1 Inputs

- `preview.js` (3D tab) passes two new things: `textures[side.id].layers = entry.layers || null` (the canvases
  from E9 or from the ready-design page) and `mount(container, { ..., options: state.options })`.
  `POD_PREVIEW.open` accepts `options` and keeps it in `state`.
- `mount()` passes `options` to `buildLaser(m, color, tex, renderer, product, options)`; first line of
  `buildLaser`: `if (m.type === 'layered') return buildLayered(m, color, tex, renderer, product, options);`
  Every other product ignores the new argument.

### 5.2 `buildLayered` (new, in `public/js/preview3d.js`)

```js
async function buildLayered(m, color, tex, renderer, product, options) -> THREE.Group
```

1. Load `POD_LAYERS` the way `loadTrace()` loads `trace.js` (new `loadLayers()`), then
   `stack = POD_LAYERS.stack(product, { colorId: color.id, options })`. Units: inches, `mm / 25.4`.
2. Size: `printSize(side, t)` as today → `w`, `h`, `k`.
3. For each panel (`POD_LAYERS.panelsOf(product)`; one for normal products): crop each layer canvas to the
   panel, build one stack, place the stacks side by side with `m.gapIn * k` between them, all in one group.
4. For each layer of the stack, bottom to top:
   - **backing**: `cutSheet(boardShape(pw, ph, r), t, layerMats(material))` at `z = zIn + t / 2`
     (`archShape` for `cut: 'arch'`, radius = half the width for `'round'`).
   - **cut**: draw the rim into a copy of the layer canvas (a `rimMm` wide border), then
     `designOutline(canvas, pw)` → `extrudeShapes(solidShapes(o.list), t, layerMats(material))` at its `z`.
     If the layer is empty, skip it.
   - **engrave**: `engraving(crop, pw, ph, renderer, { frosted: host look is acrylic })` placed 0.004 in above the
     host layer's top face.
5. **Shadows between layers** (no shadow maps): for each cut layer, a `shadowDecal`: a plane lying 0.003 in above
   the top face of the level below, textured with the layer's own alpha drawn through a canvas shadow
   (`shadowBlur`, `shadowOffsetX/Y`, then `destination-out` with the layer itself, the method `raise()` in
   `preview.js` already uses), then masked by what is really below it (`destination-in` with the union of the
   lower layers' alpha; a backing counts as full). Blur and offset grow with the gap: `blur = 0.9 × gap`,
   `offset = (0.5, 0.7) × gap`, darkness 0.42. Material: `MeshBasicMaterial({ map, transparent: true,
   depthWrite: false, polygonOffset: true })`, `renderOrder` above the sheets. This gives the soft dark line
   under each edge that makes the layers read as stacked, at the cost of one small texture per layer.
6. **Frame**, when the `frame` option is not `none` and `m.frame` is set: four `beam()` bars round the panel
   (`m.frame.widthIn × k` wide, `m.frame.depthIn` deep, the stack sits inside with its back flush), material
   `laserMats('wood', choice.hex, renderer, choice.look === 'paint')`.
7. `g.rotation.y = -0.3` as the other wall pieces; `g.userData.shadow` unchanged (contact shadow as today).

Helpers to add next to `laserMats`:

```js
function layerMats(material, renderer, process) -> { face, edge }
  // 'paint'  : flat colour, roughness 0.7; edge = laser-burnt brown '#4a3324' (lasercut) or raw MDF '#b08e6a' (cnc)
  // 'wood'   : laserMats('wood', hex, renderer, false)
  // 'acrylic': laserMats('acrylic', hex, renderer)
  // 'mirror' : laserMats('mirror', hex, renderer)
function shadowDecal(layerCanvas, belowCanvas, w, h, gapIn, renderer) -> THREE.Mesh
function flatLayer(layerCanvas, w, h, material, renderer) -> THREE.Mesh     // fallback, see 5.4
function frameBars(w, h, frame, mats) -> THREE.Group
```

Materials are cached per `look + hex` inside one `buildLayered` call (wood canvases are the costly part).

### 5.3 The flat (2D) views

- Editor canvas: layers are drawn in their colours in layer order (E2, E3). No shadows on the canvas itself.
- Realistic view (`preview.js`, `renderRealistic`): when the entry has `layers`, draw them bottom to top instead
  of the single design, each through a small `raise()`-style shadow (lift = the layer's thickness in pixels,
  `entry.rects.u × S × mm / 25.4`). Small change in a shared file: CNC chat, tell main chat first.
- Cart and order pictures: the plain composite (`<side>-preview.png`), as today.

### 5.4 When tracing fails or is too heavy

- `designOutline` rejects or returns nothing for a layer: that layer becomes a `flatLayer`: a plane at the
  layer's top height with the layer's alpha and colour (`alphaTest: 0.5`). The stack still shows the right
  colours and order, only without cut edges on that layer. `traceFailed()` logs it as today.
- More than 12,000 outline points in one layer after tracing: trace again with `simplify: 2`; still more: flat
  layer.
- No layer canvases at all (an old page calling a new preview, or a design saved before the engine): fall back
  to `laserCutout(...)` with the composite design, which is today's behaviour for cut products.
- WebGL missing: `mount()` already returns `null` and the preview says so.

### 5.5 Performance budget (phones first)

| Thing | Limit |
| --- | --- |
| Layers drawn | 8 per panel, 3 panels, but at most 10 traced outlines per preview (beyond that: flat layers) |
| Layer canvas from the editor | long side 900 px (600 px on phones) |
| Trace grid | 600 px long side (420 px on phones): pass a `maxPx` argument to `designOutline(crop, wIn, maxPx = 600)` |
| Outline points per layer | 12,000 |
| Shadow decal texture | 512 px long side (256 px on phones) |
| Shadow maps | none |
| Pixel ratio | unchanged (max 2) |
| Build time on a mid-range phone | under 1.5 s for 5 layers; the preview shows its usual loading state meanwhile |

The traces run one after another with an `await` between layers so the page stays responsive. No per-frame work
is added: everything is built once.

---

## 6. Production

### 6.1 New functions in `src/laser.js` (CNC chat)

```js
/** One layer's LightBurn file (SVG, mm). */
async function layerCutSvg(buf, { widthMm, heightMm, layer, panel = null, engrave = null, guide = null, label = '' }) -> string
  // buf     : the layer's mask PNG (null for a backing layer)
  // layer   : a snapshot entry (3.5): kind, cut, radiusMm, rimMm, pieces
  // panel   : { x, y, w, h } fractions; the mask is cropped to it and the file is the panel's own size
  // engrave : mask PNG of an 'engrave' layer hosted on this layer -> <g id="engrave"> image (engravePng), as laserSvg does
  // guide   : mask PNG of the layer(s) directly above -> <g id="guide"> blue hairlines (#0000ff) = "score lightly,
  //           this is where the next layer is glued". Only written when the layer above has no rim.
  // label   : small text line engraved-free: written as an XML comment and as <title> only (nothing is cut for it)
/** What cutting a layer gives, for warnings. */
async function layerReport(buf, { widthMm, heightMm, layer, panel = null, below = null, minFeatureMm = 2 })
  -> { pieces, smallestMm2, thinMm2, floating, bboxMm: { w, h } }
  // thinMm2  : area that disappears when the shape is eroded then grown back by minFeatureMm / 2 (use near())
  // floating : pieces whose overlap with `below` (union mask PNG of all lower layers) is under 30% of their area
/** The A4 assembly sheet. */
async function assemblyPdf({ title, product, sizeLabel, widthMm, heightMm, layers, panels, frame, notes }) -> Buffer
  // layers: [{ n, id, name, materialName, hex, thicknessMm, pieces, file, thumb: Buffer (PNG) }], bottom to top
```

Details:

- A `cut` layer's mask gets its rim painted in (a border `rimMm` wide) **before** tracing, so the rim and the art
  are one outline. A backing layer is `boardPath`-style geometry only (`cut: 'rect' | 'rounded' | 'round' |
  'arch'`), no trace.
- Tracing reuses `traceCut` (12 px/mm, at most 4000 px): 0.08 mm per pixel up to 33 cm, 0.15 mm at 60 cm,
  0.23 mm at 90 cm. That is the same precision today's big cut products have; see 6.4 for the exact-vector
  improvement.
- No kerf compensation in the file (the workshop sets it in LightBurn), stated on the assembly sheet.
- The assembly sheet is made with `pdfkit` (already a dependency; see `printfiles.printPdf` for the house style).
  Content: order number and product, size, "Layer 1 = back", a table (number, name, material, colour swatch,
  thickness, pieces, file name), a small picture of each layer, a picture of the finished piece
  (`front-preview.png`), the frame choice, total depth, and three fixed notes (glue from the back board up; rims
  line the layers up; blue lines are placement guides, not cuts). **English**, like every other production label
  (`pickEn`); numbers, swatches and pictures carry most of it. The order page shows the same table in the admin's
  language.
- Exports: `module.exports = { engravePng, cutSvg, laserSvg, cutReport, layerCutSvg, layerReport, assemblyPdf }`.
  The existing four are untouched.

### 6.2 File names

Stored with the design (same folder as today's files):

| File | Made by |
| --- | --- |
| `front-layer-<id>.png` | uploaded by the editor / ready-design page |
| `front-layer-<id>-cut.svg`, `front-layer-<id>-p<k>-cut.svg` (panel k of a set) | on first download, cached |
| `front-assembly.pdf`, `front-layers.zip` | on first download, cached |

Download names (what the workshop sees), built from the existing `base` name of `makeFile`:

```
<base>-L2of4-far-layer-navy-3mm.svg
<base>-L2of4-far-layer-navy-3mm-panel1of3.svg
<base>-assembly.pdf
<base>-layers.zip
```

`L<n>of<N>` first so files sort in stacking order; then the layer's English name, material id and thickness.

### 6.3 Requests to the main chat (`src/app.js`)

**A1. Accept the layer files.** Add to `FILE_RE`: `^(front|back)-layer-[a-z0-9]{1,12}\.png$`. `checkUpload`
treats them as PNG (same limits as `-print.png`).

**A2. `POST /api/designs` on a layered product** (`POD_LAYERS.layersOf(product)` not null; require
`../public/js/layers.js` lazily like `laserFiles`):

- For each side: `used = POD_LAYERS.usedLayerIds(product, ed.objects)` (computed on the server; the client's
  `ml.layers` is only a hint). Store `ml: { v: 1, layers: used }` in the side's editor.
- Add `<side>-layer-<id>.png` to `expectedFiles` for every used `cut` and `engrave` layer.
- Store the snapshot on the stored side: `layers` = `POD_LAYERS.stack(product, { colorId, options: picked.options })`
  filtered to `used`, with the fields of 3.5 only; `panels` when the product has them.
- Every layer option must be present after `cleanOptions` (they are `keepDefault`); if one is missing, fill the
  default choice rather than fail (old drafts).
- When a design's files are replaced (the cleanup at line ~1490): also remove `*-layer-*-cut.svg`,
  `*-assembly.pdf`, `*-layers.zip`.

**A3. Price.** In `designPrice` → `unit(sizeId)`: add
`POD_LAYERS.extraPrice(product, sizeId, d.sides.flatMap((s) => (s.layers || []).map((l) => l.id)))`.
Zero for every product without `laser.layerPrice`.

**A4. Downloads.** In `makeFile`, before the `FORMATS` lookup, when `side.layers` exists:

- `format=layer-cut&layer=<id>[&panel=<k>]` → `laserFiles.layerCutSvg(...)` with the layer's mask, the hosted
  engrave layer's mask (if any) and the guide mask (union of the layers one level up, when they have no rim).
  404 for an unknown layer or panel. `engrave` layers have no file of their own.
- `format=assembly-pdf` → `laserFiles.assemblyPdf(...)`; thumbnails with `sharp` (mask tinted with the layer's
  hex, 400 px).
- `format=layers-zip` → every layer file + the assembly sheet + `front-print.png`, built like `photosZip`.
- Names as in 6.2 (`SUFFIX` does not fit: the name depends on the layer). The existing `laser-svg` / `cut-svg`
  formats keep working on the composite and are simply not offered for layered items (A5).

**A5. Order page data.** `adminItem`: for each side with `layers`, pass
`layers: [{ id, n, name, kind, material: { name, hex }, thicknessMm, pieces }]` and `panels: <count>`.
The download buttons are drawn in `public/js/admin.js` `printFiles()` (CNC chat, shared file): when `s.layers`
exists, a block titled `admin.layerFiles` with, first, **All layers + assembly sheet (ZIP)** (recommended), then
the assembly sheet, then one button per layer (per panel for sets), each with its colour swatch; the usual
`FORMATS_BY_METHOD` list is reduced to `png` (the proof picture) for these items.

**A6. Checks after upload.** In `/complete`, for layered designs: `laserFiles.layerReport` per cut layer; add to
the design's checks (warnings, never blocking): pieces > 1 on a `pieces: 'one'` layer (`layers.pieces`),
`thinMm2 > 4` (`layers.thin`), `floating > 0` (`layers.floating`). Store `pieces` per layer in the snapshot (the
assembly sheet prints it).

**A7. Reading a design back.** `GET /api/designs/:id` already returns the editor objects (with `layer`) and the
options; make sure `sides[].layers` is in the public shape too, so the proof / view page can show the 3D stack
later. Low priority.

### 6.4 Nesting and exact vectors (later steps, not needed for launch)

- **Nesting.** Each layer file is the layer at real size with its origin at the top-left corner; the workshop
  places files on its sheet in LightBurn. A later "one file per material" export can reuse
  `POD_NEST.pack(items, sheetWidthMm, gapMm)` with each piece's bounding box (from `layerReport.bboxMm`),
  grouping layers that share material and thickness (the three motif panels of a wall set, the bands of a
  rainbow). Rectangle packing wastes material on odd shapes, so this is a convenience, not a saving.
- **Exact vectors for locked art.** A locked `full: true` art item is never moved by the customer, so the server
  can write the SVG's own paths, scaled to mm, instead of a traced outline, whenever a layer contains only such
  an item (no text joined to it). This removes the 0.23 mm steps on 90 cm pieces. Needs the library item's `src`
  kept on the object (`artSrc` is already in `EXTRA_PROPS` for another purpose; use a new `layerSrc` property).

---

## 7. Pricing

Where it lives: all numbers in `src/products.js` on the product; the formula in two existing functions plus one
new one. The owner can still change base price and size surcharges from the dashboard as for any product.

```
price of one piece =
    basePrice                                   (product)
  + size.surcharge                              (per size: bigger sheets, more cutting time)
  + extra layers × laser.layerPrice[size]       (POD_LAYERS.extraPrice: used cut layers beyond laser.included)
  + frame option price[size]                    (optionsPrice, existing)
  + premium material per layer [size]           (optionsPrice, existing: a choice with a price, e.g. mirror acrylic)
```

- "Size × layer count" is covered two ways: a product with a fixed number of layers puts everything in the size
  surcharge; a product whose designs use 3, 4 or 5 layers sets `included: 3` and `layerPrice`.
- The ready-design page and the editor show the same number because both call `POD_LAYERS.extraPrice` (E10 and
  step 8); the server charges through A3. A unit test compares the three.
- Sets are priced as one product (the set), not per panel.
- Design-page price for a ready design: its `ml.layers` is known from its items, so the price shown before
  opening the editor is already right.
- Starting numbers are placeholders for the owner (section 8).

---

## 8. Risks and open questions for the owner

Risks (and what the plan does about them):

1. **Precision on big pieces.** Cut lines are traced from a picture: about 0.23 mm steps at 90 cm. Fine for
   wall art glued in layers, visible on mirror acrylic edges. Fix later with exact vectors (6.4).
2. **Phones.** Five traced layers cost more than today's one. The budget in 5.5 and the flat-layer fallback keep
   the preview working on weak phones; it will look a little less sharp there.
3. **Two chats, two big files.** Most editor and server work is the main chat's. The order in section 9 lets
   the CNC chat finish and test its part first, and nothing shows to customers until the first product is added.
4. **Fragile designs.** Thin parts break in cutting. The shop draws the scenes, so the art is checked once by
   tests; only the customer's text can cause trouble, and the checks in 4.2 (E7) and 6.3 (A6) cover it.
5. **Long option lists in the cart.** Each layer's colour appears next to the size ("40 × 60 cm · Far layer: Navy
   · ..."). Correct but long with 5 layers. If it looks crowded, the main chat can shorten the display to "5
   colours" with the details one tap away.

Questions for the owner:

1. **Which workshop and machine for each product**, and its bed size? Can it cut 60 × 90 cm in one piece?
2. **Which materials and colours do we really stock?** Painted MDF, coloured acrylic, plywood, mirror acrylic;
   thickness of each. The list in section 10 is a proposal.
3. **Free colour per layer, or only ready colour schemes?** The plan builds both; we can launch with schemes
   only on some products (the rainbow) if you prefer fewer choices.
4. **Does the piece ship glued and ready to hang**, with or without a frame? Is 60 × 90 cm safe to ship
   everywhere?
5. **Prices**: per size, per extra layer, for the frame, for mirror acrylic.
6. **May customers move the scene artwork**, or only change the words and colours (the plan assumes: only words
   and colours)?
7. **Is an English assembly sheet fine for the workshop**, or do they need Arabic on it?

### Owner's answers (28 Nov 2026)

1. **Machine size:** assumed yes (60 × 90 cm cuts in one piece). Confirm with the workshop before launch.
2. **Materials:** all the listed ones are stocked; thickness not known yet. Use the proposal below until the
   workshop confirms: **3 mm** for every coloured layer (painted MDF, plywood, acrylic), **2 mm** mirror
   acrylic, back board **3 mm up to 40 × 60 cm and 5 mm for 60 × 90 cm**. Keep thickness a per-material
   setting in `src/products.js` so it can change without code changes.
3. **Colours:** any colour per layer (free choice), plus ready colour schemes as a one-tap shortcut.
4. **Shipping:** glued, ready to hang, safe to ship everywhere. Applies to the layered scenes, rainbow sign,
   3-panel sets and family tree. Frame: an option (see 5).
5. **Prices** (proposal, owner to confirm):

   | Product | Sizes | Price incl. 3 layers | Each extra layer | Frame |
   | --- | --- | --- | --- | --- |
   | Layered scene | 40 × 60 / 60 × 90 cm | 1,400 / 2,400 | +150 / +250 (up to 5) | +250 / +400 |
   | Rainbow name sign | 40 / 60 cm wide | 650 / 950 (bands + name) | n/a | n/a |
   | 3-panel set | 3 × 30 × 60 / 3 × 40 × 80 cm | 1,800 / 2,700 (2 layers each) | n/a | +450 / +650 |
   | Family tree | 60 × 60 cm | 1,600 (2 layers) | +150 | +350 |

   Mirror acrylic on a layer: +100 (small sizes) / +200 (big sizes).
6. **What customers may change** (owner asked for advice; recommendation adopted until he says otherwise):
   words, colours, and the size and position of their own text. The scene artwork stays fixed, because moving it
   breaks the stacking and the joins between layers, which the shop checks once per design.
7. **Assembly sheet:** both Arabic and English.

---

## 9. Build plan

Rules for every step: run `npm test` and the listed e2e file before handing over; no product with
`laser.layers` is added to `PRODUCTS` before step 11, so customers see nothing until then; tests use the fixture
of step 2. Each step leaves the site working if the next one is never built.

### Step 1. Layer rules: `public/js/layers.js`  (CNC chat)

- Files: `public/js/layers.js` (new), `test/layers.test.js` (new).
- Build every function of 3.7 exactly as listed.
- Unit tests: a product without layers → `layersOf` null; normalisation defaults (level, thickness 3, pieces
  'many', accepts []); `layerOf` with missing and unknown ids; `materialOf` for `color`, `option` (both option
  shapes) and `fixed`; `stack` heights for 4 levels and for layers sharing a level; `sortByLayer` is stable;
  `usedLayerIds`; `extraPrice` (below, at and above `included`; missing `layerPrice` → 0); `validate` catches each
  mistake listed in 3.7.
- Done when: `node --test test/layers.test.js` passes and the file loads in a browser (`window.POD_LAYERS`).

> **Step 1 and Step 3 done (28 Nov 2026):** `public/js/layers.js`, `test/layers.test.js`, the three production
> functions in `src/laser.js` and `test/laser-layers.test.js`. Differences from the plan are listed in the coder's
> report (per-size thickness, Arabic drawn as outlines, optional `preview` / `depthMm` on `assemblyPdf`).

### Step 2. Materials, helpers and the test fixture  (CNC chat)

- Files: `src/products.js` (CNC section: `LAYER_MATERIALS`, `layerOptions`, `frameOption`, exported),
  `test/fixtures/layered-product.js` (new), `test/layered-products.test.js` (new).
- The fixture exports `layeredProduct()` (the product of 3.3 with id `mltest`, complete with `process`,
  `methods`, `model`, `mix`, `safeIn` / `bleedIn` on its side, as the loop near `PRODUCTION` would set them),
  `setProduct()` (a 3-panel, 2-layer product, id `mlset`) and `install()` / `uninstall()` that push them into /
  remove them from the exported `PRODUCTS` array. If the catalogue copies the product list at `createApp`, call
  `install()` before `createApp`.
- Unit tests: `POD_LAYERS.validate` is empty for both fixtures; every real product in `PRODUCTS` with
  `laser.layers` validates (none yet: the test is ready for step 11); `layerOptions` output passes
  `cleanOptions`; `optionsPrice` adds the frame per size.
- Done when: tests pass and `npm test` is as green as before (no existing product changed).

### Step 3. Production files: `src/laser.js`  (CNC chat)

- Files: `src/laser.js`, `test/laser-layers.test.js` (new).
- Build `layerCutSvg`, `layerReport`, `assemblyPdf` (6.1). Do not change the four existing exports.
- Unit tests (masks made with `sharp` from small SVGs, as `test/laser.test.js` does): backing layer → one path
  of the board's size; `cut: 'round'` gives a circle; a cut layer with `rimMm` → one piece even when the art is
  two blobs that touch the rim; without rim → two pieces; `panel` crops and the SVG has the panel's mm size;
  `engrave` adds the image group; `guide` adds blue paths and no red ones for them; `layerReport.thinMm2` > 0 for
  a 1 mm bar and 0 for a 10 mm bar; `floating` counts a piece with nothing below; `assemblyPdf` returns a PDF
  (starts with `%PDF`) with one page for 4 layers.
- Done when: tests pass; a sample SVG opened in LightBurn or Inkscape shows the right size in mm (check by hand
  once and note it in the PR).

### Step 4. 3D preview  (CNC chat; tell main chat before merging `preview3d.js` / `preview.js`)

- Files: `public/js/preview3d.js` (`loadLayers`, `layerMats`, `shadowDecal`, `flatLayer`, `frameBars`,
  `buildLayered`, `designOutline` gets `maxPx`, `buildLaser` and `mount` get `options`), `public/js/preview.js`
  (pass `layers` and `options`; realistic view draws layers with shadows),
  `test/e2e/preview3d-layered.e2e.js` (new).
- e2e (pattern of `test/e2e/preview3d-pen-wallet.e2e.js`; no editor needed): in a page,
  `import('/js/preview3d.js')`, build three small layer canvases by hand, call `mount()` with the fixture product
  as a plain object and `options`; assert through `container.__pod3d.scene`: one mesh per layer at increasing z;
  each mesh's colour matches its option; the frame bars exist only with a frame option; a set gives three
  groups; with a layer canvas that makes `trace` throw (stub `window.POD_TRACE.trace`), the layer is a flat
  plane and the others are still extruded; no page errors; build under 3 s in the test browser.
- Also assert an existing laser product (`calligraphy`) still builds exactly as before
  (`test/e2e/calligraphy-raised.e2e.js` stays green).
- Done when: e2e passes on desktop and with the `Pixel 7` device profile.

### Step 5. Ready designs carry layers  (CNC chat; shared files, tell main chat)

- Files: `src/library-dsl.js` (document `layer`, `lock`; `D` passes `options` through), `public/js/templates.js`
  (`buildTemplate`: after an object is built, `if (i.layer) o.set('layer', i.layer)`; `if (i.lock) o.set({
  selectable: false, evented: false, lockLayer: true })`), `src/library.js` only if it strips unknown design
  fields (check that `options` reaches the browser), `test/library-layered.test.js` (new).
- No pack yet. The test builds a fixture design for `mltest` and checks: item fields survive the library's
  serialisation; the artwork rules of 3.4 on any SVG under `public/img/art/layered/` (none yet).
- Done when: tests pass; existing `test/library-*.test.js` unchanged and green.

### Step 6. Server accepts layered designs  (main chat: A1, A2, A3; CNC chat writes the test)

- Files: `src/app.js`; `test/laser-layers-api.test.js` (new, CNC chat, pattern of `test/laser-api.test.js`).
- Tests: `POST /api/designs` on `mltest` returns the layer file names in `files`; a design using 3 of 4 layers
  lists only those; the stored design has `sides[0].layers` with materials from the options; unknown `layer` on
  an object counts as the default layer; the price equals base + size + extra layers + frame; a design on an
  existing laser product (`caketopper`) returns exactly the files it returned before; uploading
  `front-layer-l2.png` is accepted, `front-layer-zz.png` (not expected) is refused.
- Done when: tests pass; `test/laser-api.test.js`, `test/api.test.js` unchanged and green.

### Step 7. Editor, part 1: tone, order, save  (main chat: E1, E2, E3, E8)

- Files: `public/js/editor.js`, the editor page (script tag for `layers.js`);
  `test/e2e/editor-layers.e2e.js` (new; the product is injected by routing `/api/products` as
  `calligraphy-raised.e2e.js` does, and installed in the test server through the fixture).
- e2e: opening a layered ready design shows each element in its layer's colour; changing a layer option
  recolours only that layer; a new text lands on the default layer and above lower layers; reload keeps layers
  and colours (draft); saving uploads the layer files and the cart gets the item; a one-tone product
  (`caketopper`) behaves as before (existing editor e2e files stay green).
- Done when: e2e passes on desktop and `Pixel 7`, in Arabic and English.

### Step 8. Ready-design page  (CNC chat; shared files `design-render.js`, `design.js`, tell main chat)

- Files: `public/js/design-render.js` (`EXTRA_PROPS` + `layer`, `lockLayer`; `stage()` takes `options` and tones
  per layer with `POD_LAYERS.toneFor`; new `layerMask(st, layerId)` and `layerCrops(st, maxPx)`; `addToCart`
  sends `options`, `ml`, and the layer files), `public/js/design.js` (on layered products: the layer colour
  swatches and palettes under the colour picker, the frame choice, price with `extraPrice`; passes `layers` and
  `options` to the preview), `public/js/i18n.js`, CSS; `test/e2e/design-layered.e2e.js` (new).
- e2e: the page of a layered ready design shows the swatches; typing a name changes the top layer's text; a
  palette tap recolours the picture; "Add to cart" creates a design whose stored options match; the 3D tab shows
  the stack; RTL layout has no horizontal scroll at 360 px wide.
- Done when: e2e passes; `test/e2e/own-name.e2e.js` and `designs-light.e2e.js` stay green.

### Step 9. Editor, part 2: panel, checks, preview, price  (main chat: E4, E5, E6, E7, E9, E10)

- Files: `public/js/editor.js`, CSS; i18n keys from the CNC chat (4.3); extend `test/e2e/editor-layers.e2e.js`.
- e2e: the Layers panel lists layers top to bottom; hide and focus change the screen but not the saved design
  or the exported files (compare the uploaded mask with and without a hidden layer); "Move to layer" offers
  only accepting layers; a too-small text and a text that makes two pieces show their warnings in both
  languages; the preview's 3D tab shows one mesh per layer; the price shown equals the server's; on `Pixel 7`
  the bottom sheet opens, rows are at least 44 px high, nothing overflows in Arabic.
- Done when: e2e passes; all `editor-stage*.e2e.js` stay green.

### Step 10. Workshop downloads  (main chat: A4, A5, A6, A7; CNC chat: `admin.js`, i18n)

- Files: `src/app.js`, `public/js/admin.js`, `public/js/i18n.js`; extend `test/laser-layers-api.test.js`; a
  small e2e `test/e2e/admin-layers.e2e.js` (new).
- Tests: `format=layer-cut&layer=l2` returns an SVG of the right mm size named `...-L2of4-...svg`; an unknown
  layer is 404; `assembly-pdf` is a PDF; `layers-zip` contains N layer files + the PDF + the print PNG; a set
  returns one file per panel; `/complete` adds the three warnings on masks made to trigger them; the order page
  shows the layer table and the buttons, in Arabic and English; a non-layered laser order still offers
  `laser-svg` / `cut-svg` as before.
- Done when: tests pass and one real order made by hand on the test server downloads and opens correctly.

### Step 11. First product goes live  (CNC chat, products and designs; owner's answers needed first)

- Files: `src/products.js` (the product, `SIZE_PRINT_SCALE`, `PRODUCTION`, gift tags as the other CNC products
  have), `src/library-packs/layered.js` + registration in `src/library.js` (also add the product id to
  `OWN_DESIGNS_ONLY` there, so general T-shirt designs are never offered on it), `public/img/art/layered/...`,
  `public/img/lifestyle/<id>.webp` (made with Creative Claw, 960 × 1200, the house style: standing OK in
  `CLAUDE.md`), `README.md` (a "Multi-layer wall art" section after "CNC and UV products": fields, files, the
  rules file), tests: `test/layered-products.test.js` now covers the real product; `test/library-layered.test.js`
  covers the real pack and artwork; one e2e that orders the real product from the design page.
- Check the product and pack texts for payment wording: nothing may promise cash on delivery
  (`test/prepay-wording.test.js` must stay green).
- Done when: full `npm test` and `npm run test:e2e` pass; the owner has seen the product on the preview site.
- The other products (rainbow sign, 3-panel sets, family tree) are each a repeat of this step with their own
  data; the engine does not change.

### Later (not needed for launch)

- Exact vectors for locked art (6.4). Files: `src/laser.js`, `templates.js`; main chat: `EXTRA_PROPS` +
  `layerSrc`.
- One nested file per material (6.4). Files: `src/laser.js`; main chat: one more format.
- 3D stack on the customer's proof / view page (A7 + `public/js/view-page.js`).

---

## 10. Appendix: technical sheet

All numbers are the plan's defaults until the owner and the workshop confirm them (section 8).

**Layers**

| | |
| --- | --- |
| Levels (depth) | 2 to 5 |
| Layers (cut files) per panel | 2 to 8 |
| Panels in a set | 1 to 3 |
| Layer id | lower-case letters and digits, 1 to 12 characters |
| Layer kinds | `backing` (full board), `cut` (outline), `engrave` (on another layer) |
| Default thickness | 3 mm per layer |
| Deepest stack | 5 × 3 mm = 15 mm, 30 mm with a frame |

**Materials** (`LAYER_MATERIALS`, proposal)

| Look | Ids | Thickness |
| --- | --- | --- |
| Painted MDF (`paint`) | white, black, navy, sky, teal, sage, forest, mustard, terracotta, blush, sand, grey, burgundy | 3 mm |
| Wood (`wood`) | natural (birch plywood), oak, walnut (stained) | 3 mm |
| Acrylic (`acrylic`) | acrylic-black, acrylic-white | 3 mm |
| Mirror acrylic (`mirror`) | gold, silver, rosegold | 2 mm |
| Back board | any `paint` or `wood` | 3 mm (5 mm from 60 × 90 cm up) |
| Frame | natural, black, white; 20 mm wide, 30 mm deep | |

**Cutting rules**

| | Laser | CNC router |
| --- | --- | --- |
| Smallest part width (`minFeatureMm`) | 2 mm | 4 mm (inside corners keep the bit's radius) |
| Smallest cut letter height (`minTextMm`) | 10 mm | 25 mm |
| Smallest engraved letter height | 3 mm | 6 mm |
| Bridge that joins letters (`bridgeMm`) | 2 to 2.5 mm | 3 mm |
| Rim of a framed layer (`rimMm`) | 12 mm or more (default 15) | 15 mm or more |
| Smallest loose piece | 25 mm² (warned below this) | 100 mm² |
| Kerf | about 0.15 mm, not compensated in the file | set by the workshop |

**Sizes** (first products)

| Product | Sizes |
| --- | --- |
| Layered framed scene | 40 × 60 cm, 60 × 90 cm |
| Rainbow name sign | 40 cm, 60 cm wide |
| 3-panel wall set | three panels of 30 × 40 cm, 5 cm apart (to confirm) |
| Family tree | 60 × 60 cm |

**Files**

| File | Format |
| --- | --- |
| Layer mask (upload) | PNG, same pixels as the print file (up to 16 megapixels), only alpha matters |
| Layer cut file | SVG in mm, real size, origin top-left. Red `#ff0000` 0.1 mm lines = cut; blue `#0000ff` = placement guide (score lightly or switch off); embedded black/white image = engrave (254 DPI) |
| Trace precision | 12 px/mm up to 33 cm; 0.15 mm per pixel at 60 cm; 0.23 mm at 90 cm |
| Assembly sheet | PDF, A4, English, one page up to 8 layers |
| Everything | ZIP: layer SVGs + assembly PDF + print PNG |
| Names | `<order>-<product>-...-L<n>of<N>-<layer>-<material>-<mm>mm[-panel<k>of<K>].svg` |

**3D preview limits**

| | Desktop | Phone |
| --- | --- | --- |
| Layer canvas (long side) | 900 px | 600 px |
| Trace grid (long side) | 600 px | 420 px |
| Traced outlines per preview | 10 | 10 |
| Outline points per layer | 12,000 | 12,000 |
| Shadow texture per layer | 512 px | 256 px |
| Shadow maps | none | none |
| Fallback | flat coloured layer when a trace fails or is too heavy; today's single cut-out when no layers arrive | |

**Where things live**

| Thing | File |
| --- | --- |
| Layer rules (shared) | `public/js/layers.js` |
| Product layers, materials, prices | `src/products.js` |
| Ready layered designs | `src/library-packs/layered.js`, `public/img/art/layered/` |
| Cut files, report, assembly sheet | `src/laser.js` |
| 3D stack | `public/js/preview3d.js` (`buildLayered`) |
| Editor (main chat) | `public/js/editor.js` (E1 to E10) |
| Server (main chat) | `src/app.js` (A1 to A7) |
