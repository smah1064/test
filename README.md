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

**Storefront (`/`)**: 13 products in four categories: t-shirt, kids t-shirt, hoodie, sweatshirt, cap, mug, cushion, framed poster, water bottle, tote bag, phone case, mouse pad and notebook. Each has colours, sizes and a mockup drawn in its colour.

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
- When the product colour changes between light and dark, text and shapes in the default colour switch automatically (dark ↔ white) so they stay visible.
- Image upload (click or drag and drop) with a live **print-quality / DPI indicator** and a warning before you order a blurry image.
- Shapes, plus a one-click "fill print area" background.
- Move, scale, rotate, flip, opacity, layer order, duplicate, delete, centre in print area, and a layers list.
- Front and back sides for products that have both, each with its own design and its own undo/redo history.
- Switch colour, size or even product while keeping the design: it is scaled into the new print area.
- Preview mode hides the guides. Keyboard shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z / Ctrl+Y, Ctrl/⌘+D, Delete, arrows (Shift = 10px).
- Live price: base price, plus a size surcharge, plus a fee for each extra printed side.

**Add to cart** exports two files for each designed side:
- a **print-ready PNG**: transparent, cropped to the print area, at 150 DPI of the real print size (for example 1800 × 2400 px for a 12 × 16 in shirt print)
- a **mockup preview** for the cart, order page and production queue

The editable layout is also saved, so customers can re-open and edit or duplicate a design from the cart.

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
public/js/fabric-ext.js curved text, text boxes, photo shapes, background removal
public/fonts/        self-hosted fonts (SIL Open Font License)
src/store.js         JSON-file store with atomic writes
public/              static site (index, editor, cart, order, admin)
public/js/editor.js  the design editor
public/vendor/       Fabric.js 5.3.0 (MIT)
test/api.test.js     API tests (npm test)
```

## Adding a product

Add an entry to `PRODUCTS` in `src/products.js`. Mockups are SVGs in a 500 × 600 space using `{{C}}` (product colour), `{{S}}` (shade) and `{{L}}` (outline). Each side defines a `printArea` rectangle in that space and its physical `printWidthIn`. An optional `overlay` SVG is drawn on top of the design (for example a phone camera or a mug's highlight).

## Before going live

- **Prices** are starting points in `src/products.js` (`basePrice`, size `surcharge`) and the shipping constants at the bottom of that file. Adjust them to your costs.
- **Online card payments:** orders are cash on delivery. To also take cards, add an Egyptian gateway such as Paymob or Fawry.
- **Storage:** the JSON store suits a single server. For scale, move metadata into a database and print files into object storage.
- **Admin auth** is a single shared password sent in a header. Use real accounts if several people run the press.
