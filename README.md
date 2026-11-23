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

## What's in it

**Storefront (`/`)**: 21 products in four categories: t-shirt, oversized t-shirt, polo, kids t-shirt, kids hoodie, baby onesie, hoodie, zip hoodie, sweatshirt, shorts, denim jacket (back), apron, cap, mug, cushion, framed poster, water bottle, tote bag, phone case, mouse pad and notebook. Each has colours, sizes and a mockup drawn in its colour.

Product cards, the editor and the cart thumbnails all show **real product photos**, recoloured to the chosen colour (drawn mockups are only a fallback for products without a photo).

**Saved designs**: the editor saves the design in the shopper's browser as they work (IndexedDB, so uploaded photos fit), and the **Save** button takes them back to the products page, where the card shows their design with a "Saved design" badge. Opening the product again restores it. The draft is cleared once the design goes into the cart.

**Design editor (`/editor`)**, built on Fabric.js:
- **16 self-hosted fonts** (8 Arabic, 8 English) with a visual font picker. Arabic text is set right-to-left with properly joined letters, and switches to an Arabic font automatically if typed into an English-only one.
- **Templates** to start from (birthday, Ramadan Kareem, team jersey, family badge and more, in Arabic and English).
- Text presets with size, colour, bold/italic/underline, alignment, letter spacing, line height, outline and shadow. Double-click text to type directly on the product.
- **Snap guides** to the centre and edges of the print area, and **zoom**.
- **Lock** layers so they can't be moved by accident.
- **Curved text** (arcs up or down, works with Arabic), **gradient** colours, hollow outline text, a rounded **background box** behind text, and a quick colour palette.
- **Sticker library**: 36 original vector stickers in six categories (Egypt, Ramadan, football, love, birthday, fun).
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
