# OneOff Print: print-on-demand storefront

A print-on-demand website where shoppers customise products in a drag-and-drop editor, and every item is printed individually, one at a time.

Built for Egypt: **Arabic and English** (Arabic by default, full right-to-left layout, switch in the header), prices in **Egyptian pounds (EGP)**, and checkout with mobile number, governorate and **cash on delivery**.

## Run it

```bash
npm install
ADMIN_PASSWORD=choose-something npm start
```

- Shop: http://localhost:3000
- Production dashboard: http://localhost:3000/admin

Requires Node 18+. There is no database to set up: data is stored under `data/` (or `DATA_DIR`).

| Variable         | Default  | Purpose                              |
| ---------------- | -------- | ------------------------------------ |
| `PORT`           | `3000`   | HTTP port                            |
| `ADMIN_PASSWORD` | `admin`  | Password for the production dashboard (set this!) |
| `DATA_DIR`       | `./data` | Where orders, designs and print files are stored |
| `ANTHROPIC_API_KEY` | (none) | Turns on AI help (slogans, logos) |
| `AI_DAILY_LIMIT` | `15` | AI requests per visitor per day |
| `AI_GLOBAL_DAILY_LIMIT` | `300` | AI requests for the whole shop per day |
| `TRUST_PROXY` | `true` | Use the visitor IP from the proxy (set `false` if not behind one) |
| `CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY` | (none) | WhatsApp alert to the shop owner for each new order ([CallMeBot](https://www.callmebot.com), free, own number only) |
| `BREVO_API_KEY`, `MAIL_FROM` | (none) | Email via [Brevo](https://www.brevo.com) (free plan); `MAIL_FROM` must be a verified sender |
| `MAIL_FROM_NAME` | `OneOff Print` | Sender name on emails |
| `ADMIN_EMAIL` | (none) | Where new-order emails go |
| `ADMIN_LANG` | `ar` | Language of the owner's alerts (`ar` or `en`) |
| `SHOP_WHATSAPP` | (none) | Shop number for the customer's "Confirm on WhatsApp" button (e.g. `201012345678`) |
| `SITE_URL` | (from request) | Public address used in links inside messages |

## What's in it

**Storefront (`/`)**: 21 products in four categories: t-shirt, oversized t-shirt, polo, kids t-shirt, kids hoodie, baby onesie, hoodie, zip hoodie, sweatshirt, shorts, denim jacket (back), apron, cap, mug, cushion, framed poster, water bottle, tote bag, phone case, mouse pad and notebook. Each has colours, sizes and a mockup drawn in its colour.

Product cards, the editor and the cart thumbnails all show **real product photos**, recoloured to the chosen colour (card pictures are made once on the server by `src/thumbs.js` and served from `/api/thumbs/<product>/<colour>.webp`); drawn mockups are only a fallback for products without a photo.

**AI help** (editor tool "ذكاء"): writes slogans in Egyptian Arabic and/or English for an occasion and tone, and designs 3 logos from a name, built only from the editor's own fonts and shapes, so everything lands on the product as normal editable text and shapes. It runs on Claude Haiku 5.5 (`src/ai.js`) with structured JSON output. It is off until the server has an `ANTHROPIC_API_KEY` environment variable. Each visitor gets `AI_DAILY_LIMIT` requests a day (default 15), and the whole shop `AI_GLOBAL_DAILY_LIMIT` (default 300), so the bill stays predictable.

**Photo quality boost**: a low-resolution photo can be enlarged (Lanczos, up to 4× or 4000 px) and sharpened on the server (`/api/enhance`). It keeps its size on the product, crop, shape and filters, and the DPI badge updates.

**Share for approval**: the Share button makes a link (`/s/<id>`) with a picture of the design (WhatsApp shows it as a link preview). Friends tap "Looks great" or suggest a change; replies show on that page and in the editor's share window. "Open a copy in the editor" loads the design as a new draft. Shared designs are stored under `DATA_DIR/shares/`.

**Ready-made designs shop (`/designs`)**: 29 starter designs (funny Egyptian phrases, Ramadan, football, Eid, love, birthday, family, Egypt, motivation) that customers buy without designing. They pick a design, then any product, colour and size, see it on the real product photo (plus the 3D and print-colour previews), and add it to the cart. "Change the words in the editor" opens it in the editor as a new draft. Starter designs are layouts in `src/library.js` that fit any product and switch to light or dark ink to suit the garment colour. `public/js/design-render.js` places a design on a product and makes the same print PNG, preview and SVG the editor does, so ready designs print exactly like custom ones. The owner adds their own designs in the dashboard's **Ready designs** tab by pasting a share link from the editor, and can hide starter designs or delete their own (stored in `DATA_DIR/library/`).

**Order notifications**: for every new order the owner gets a WhatsApp message (CallMeBot) and an email (Brevo) with the items, total, customer and address, and the customer gets a confirmation email in the language they ordered in (when they gave an email). The order page has a "Confirm on WhatsApp" button that opens a chat with the shop's number with the order details filled in. Each channel switches on when its variables are set (see the table above). Sending happens after the order is saved and never blocks it; the result is shown per order in the dashboard's orders tab, which also lists which channels are set up and has a "Send me a test" button (`src/notify.js`).

**Saved designs**: the editor saves the design in the shopper's browser as they work (IndexedDB, so uploaded photos fit), and the **Save** button takes them back to the products page, where the card shows their design with a "Saved design" badge. Opening the product again restores it. The draft is cleared once the design goes into the cart.

**Design editor (`/editor`)**, built on Fabric.js:
- **28 self-hosted fonts** (14 Arabic, 14 English) with a visual font picker. Arabic text is set right-to-left with properly joined letters, and switches to an Arabic font automatically if typed into an English-only one.
- **22 templates** to start from: birthday, Ramadan, Eid, wedding, graduation, champions, gym, business logos, café sign, best mom/dad, neon "good vibes", kids and more, in Arabic and English.
- Text presets with size, colour, bold/italic/underline, alignment, letter spacing, line height, outline and shadow. Double-click text to type directly on the product.
- **Snap guides** to the centre and edges of the print area and to the edges and centres of the other elements, and **zoom**.
- **Floating bar** next to the selected element: edit text (types straight on the product), style, duplicate, forward/back, delete, group/ungroup. Bigger handles on touch screens.
- **Layout tools**: exact width, height and position in cm, keep proportions on/off (shapes can stretch), align to the print area or to each other, even spacing for 3+ elements, and group/ungroup.
- **Layers**: drag to reorder (mouse or finger), and lock so they can't be moved by accident.
- **Text styles** in one tap: shadow, neon, 3D, retro, outline, sticker, and sunset/gold/ocean gradients. **Colour single words** differently.
- **Curved text** (arcs up or down, works with Arabic), **gradient** colours, hollow outline text, a **background shape** behind text (box, pill, ribbon, ticket), and a quick colour palette.
- **Sticker library**: 61 original vector stickers in 11 categories (Egypt, Ramadan, Eid, football, sports, love, wedding, birthday, graduation, nature, fun). 18 shapes, including ribbon, shield, speech bubble and cloud.
- **Photo tools**: crop (free or square), shape a photo into a circle, heart, star, hexagon, arch or rounded frame with an optional border, brightness/contrast/saturation, and smart **background removal** for photos on a plain background.
- **Phone-first layout** on small screens: bottom toolbar, settings in a slide-up panel that zooms the view to the print area, pinch to zoom, bigger touch targets.
- **Print guides**: the print edge (red), a **safe zone** (green, keep text inside) and a **bleed** line (blue) for edge-to-edge products. A live **print check** flags low-resolution images, anything that will be cut off or isn't printed, text too close to the edge and text too small to read, and outlines the problem elements. Selected photos show a **DPI badge**. Shoppers are asked to confirm before ordering a design with problems.
- **Live preview**: a *realistic* view built on **real product photos** (in `public/mockups/photos/`, generated with Creative Claw). The product is recoloured to the chosen colour from the photo's own shading, and the artwork is warped into the measured print area: it follows the fabric folds, wraps around mugs, bottles and caps, and is lit by the photo, with the fabric texture showing through. Products without a photo fall back to a drawn mockup. Also included: a rotatable **3D** view (three.js) at real-world size, and a **print colours** view showing an RGB → CMYK estimate. Each view can be saved as an image.
- When the product colour changes between light and dark, text and shapes in the default colour switch automatically (dark ↔ white) so they stay visible.
- Image upload (click or drag and drop) with a live **print-quality / DPI indicator** and a warning before you order a blurry image.
- Shapes, plus a one-click "fill print area" background.
- Move, scale, rotate, flip, opacity, layer order, duplicate, delete, centre in print area, and a layers list.
- Front and back sides for products that have both, each with its own design and its own undo/redo history.
- Switch colour, size or even product while keeping the design: it is scaled into the new print area.
- Preview mode hides the guides. Keyboard shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z / Ctrl+Y, Ctrl/⌘+D, Delete, arrows (Shift = 10px).
- Live price: base price, plus a size surcharge, plus a fee for each extra printed side.

**Add to cart** exports, for each designed side, a **transparent RGB print PNG at 300 DPI** (artwork plus bleed, capped at 16 megapixels so it works on iPhones), an **SVG** with the fonts embedded, and a mockup preview. They are uploaded as binary files in three steps (create → upload → complete). On completion the server embeds the **sRGB colour profile and DPI** in the PNG.

The production dashboard offers every print file in the format each print method needs, made on first download:

| Format | Use |
| --- | --- |
| PNG · RGB · transparent | DTG / DTF clothing printing |
| PNG · mirrored | Sublimation transfer paper (mugs, cushions, mouse pads) |
| PDF · print-ready | Exact physical size, with TrimBox and BleedBox set |
| PDF · crop marks | Paper printing, with crop marks and a job slug |
| TIFF · CMYK | Offset or paper print shops that want CMYK (converted with an embedded CMYK profile) |
| SVG · vector | Vector workflows, cutting plotters |
| PNG · DTF film | Mirrored, with hard alpha edges (no semi-transparent pixels that print as a white halo) |
| PDF · DTF film | The same film piece at exact size, with a cutting gap and a label |
| PNG · DTG white underbase | The white layer for dark garments, choked slightly so it doesn't show at the edges |

Each product records its print method, and the dashboard highlights the recommended file.

**DTF and DTG.** Garments can be printed either way, and the printer picks the method per item in the dashboard (caps are DTF only). The file list changes to match. The **DTF film** tab lists every DTF item waiting to print: tick the ones to run together and the server packs them onto one mirrored 56 cm film PDF, with a label under each piece (order, product, side), splitting pages every 5 m. Each item is marked with its film batch (F1, F2, …) so you know which film it's on. Gang sheet orders placed before the customer gang sheet page was removed can still be downloaded as a mirrored film PDF, a plain PDF or a proof PNG.

**Checkout (`/cart`)** asks for name, Egyptian mobile number (any common format, including Arabic digits), governorate, city and address. Payment is **cash on delivery**. Every design is its own order line with quantity 1, so each one is a separate print job. Prices are recalculated on the server, and the client's numbers are never trusted.

**Order tracking (`/order?id=…`)** shows each item moving through *queued → printing → printed → shipped*.

**Production dashboard (`/admin`)** is built around printing one item at a time:
- "On the press" shows a single job: mockups, print specs (inches, pixels, DPI), the shipping address, and download buttons for the print files.
- Only one item can be in `printing` at once. The server rejects starting a second one.
- "Up next" lists the queue (oldest order first), and "Printed, ready to ship" lists items waiting to be shipped. An all-orders view is included too.

## Project layout

```
server.js            entry point (env config)
src/app.js           Express routes: catalog, designs, orders, admin
src/products.js      catalog, mockup SVGs, print areas, EGP pricing
src/egypt.js         governorates, mobile number validation
src/thumbs.js        recoloured product-photo card pictures (sharp)
src/ai.js            AI slogans and logos (Claude Haiku 5.5, structured output)
src/library.js       ready-made designs: starter designs and the owner's own
public/js/design-render.js  places a design on any product; print/preview/SVG without the editor
public/designs.html, design.html  the ready-made designs shop
public/share.html    shared-design page (approve / suggest a change)
src/i18n.js          server messages in English and Arabic
public/js/i18n.js    all interface text in English and Arabic
public/js/templates.js  fonts, shapes, text presets, templates
public/js/stickers.js   sticker library (original SVG artwork)
public/js/fabric-ext.js curved text, text boxes, photo shapes, background removal, SVG export
public/js/preview.js    photo + drawn mockup renderers, preview window, CMYK proof
public/js/photo-mockups.js  print area, warp type and colour rules for each product photo
public/mockups/photos/  product photos (.webp) and cut-out masks (-mask.png)
public/js/preview3d.js  3D product models (three.js)
src/printfiles.js       PDF / CMYK TIFF / mirrored PNG / DTF film / DTG underbase / sRGB+DPI finishing (sharp, pdfkit)
public/js/nesting.js    MaxRects film packing (used by the DTF film builder)
public/fonts/        self-hosted fonts (SIL Open Font License)
src/store.js         JSON-file store with atomic writes
public/              static site (index, editor, cart, order, admin)
public/js/editor.js  the design editor
public/vendor/       Fabric.js 5.3.0 and three.js r160 (MIT)
test/api.test.js     API tests (npm test)
```

## Adding a product

Add an entry to `PRODUCTS` in `src/products.js`. Mockups are SVGs in a 500 × 600 space using `{{C}}` (product colour), `{{S}}` (shade) and `{{L}}` (outline). Each side defines a `printArea` rectangle in that space and its physical `printWidthIn`. Set its print method, safe zone and bleed in the `PRODUCTION` map, and for garments the allowed methods in `METHODS`. An optional `overlay` SVG is drawn on top of the design (for example a phone camera or a mug's highlight).

## Before going live

- **Prices** are starting points in `src/products.js` (`basePrice`, size `surcharge`) and the shipping constants at the bottom of that file. Adjust them to your costs.
- **Online card payments:** orders are cash on delivery. To also take cards, add an Egyptian gateway such as Paymob or Fawry.
- **Storage:** the JSON store suits a single server. For scale, move metadata into a database and print files into object storage.
- **Admin auth** is a single shared password sent in a header. Use real accounts if several people run the press.

## Photo mockups

Each photo is a white (or natural) product on a light background, plus a mask from background removal. To add or replace one:

1. Save the photo as `public/mockups/photos/<name>.webp`, 1000 px wide, and its mask as `<name>-mask.png` (white = product).
2. Add an entry to `public/js/photo-mockups.js` with the print rectangle in photo pixels and the warp type. Set `base` if the product in the photo isn't white. The same rectangle places the photo in the editor, so the print area lines up with the product.
