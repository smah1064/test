# OneOff Print: print-on-demand storefront

A print-on-demand website where shoppers customise products in a drag-and-drop editor, and every item is printed individually, one at a time.

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

**Storefront (`/`)**: six products (t-shirt, hoodie, mug, tote, framed poster, phone case), each with colours, sizes and a mockup drawn in its colour.

**Design editor (`/editor`)**, built on Fabric.js:
- Text presets with font, size, colour, bold/italic/underline, alignment, letter spacing, line height and outline. Double-click text to type directly on the product.
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

**Checkout (`/cart`)** creates an order in which **every design is its own line with quantity 1**, so each one is a separate print job. Prices are recalculated on the server, and the client's numbers are never trusted. Payment is a demo stub (see below).

**Order tracking (`/order?id=…`)** shows each item moving through *queued → printing → printed → shipped*.

**Production dashboard (`/admin`)** is built around printing one item at a time:
- "On the press" shows a single job: mockups, print specs (inches, pixels, DPI), the shipping address, and download buttons for the print files.
- Only one item can be in `printing` at once. The server rejects starting a second one.
- "Up next" lists the queue (oldest order first), and "Printed, ready to ship" lists items waiting to be shipped. An all-orders view is included too.

## Project layout

```
server.js            entry point (env config)
src/app.js           Express routes: catalog, designs, orders, admin
src/products.js      catalog, mockup SVGs, print areas, pricing
src/store.js         JSON-file store with atomic writes
public/              static site (index, editor, cart, order, admin)
public/js/editor.js  the design editor
public/vendor/       Fabric.js 5.3.0 (MIT)
test/api.test.js     API tests (npm test)
```

## Adding a product

Add an entry to `PRODUCTS` in `src/products.js`. Mockups are SVGs in a 500 × 600 space using `{{C}}` (product colour), `{{S}}` (shade) and `{{L}}` (outline). Each side defines a `printArea` rectangle in that space and its physical `printWidthIn`. An optional `overlay` SVG is drawn on top of the design (for example a phone camera or a mug's highlight).

## Before going live

- **Payments:** `POST /api/orders` marks orders as paid with a demo method. Add a payment provider (for example Stripe Checkout) and create the order only after payment is confirmed.
- **Storage:** the JSON store suits a single server. For scale, move metadata into a database and print files into object storage.
- **Admin auth** is a single shared password sent in a header. Use real accounts if several people run the press.
- **Fonts:** the editor uses fonts installed on the customer's device. To guarantee identical output, bundle web fonts and wait for them to load before rendering.
