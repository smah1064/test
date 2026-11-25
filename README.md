# ebda3 (إبداع): print-on-demand storefront

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
| `ADMIN_PASSWORD` | `admin`  | Password for the production dashboard: use 16+ characters with letters, numbers and symbols |
| `DATA_DIR`       | `./data` | Where orders, designs and print files are stored |
| `ANTHROPIC_API_KEY` | (none) | Turns on AI help (slogans, logos) |
| `AI_DAILY_LIMIT` | `15` | AI requests per visitor per day |
| `AI_GLOBAL_DAILY_LIMIT` | `300` | AI requests for the whole shop per day |
| `TRUST_PROXY` | `1` | Proxy hops in front of the app (Hostinger: 1, the last X-Forwarded-For entry); `false` if none |
| `CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY` | (none) | WhatsApp alert to the shop owner for each new order ([CallMeBot](https://www.callmebot.com), free, own number only) |
| `BREVO_API_KEY`, `MAIL_FROM` | (none) | Email via [Brevo](https://www.brevo.com) (free plan); `MAIL_FROM` must be a verified sender |
| `MAIL_FROM_NAME` | `ebda3` | Sender name on emails |
| `ADMIN_EMAIL` | (none) | Where new-order emails go |
| `ADMIN_LANG` | `ar` | Language of the owner's alerts (`ar` or `en`) |
| `SHOP_WHATSAPP` | (none) | Shop number for the customer's "Confirm on WhatsApp" button (e.g. `201012345678`) |
| `SITE_URL` | (from request) | Public address used in links inside messages |
| `GEMINI_API_KEY` | (none) | Turns on AI drawing for the children's books (Google Gemini API, paid key from Google AI Studio) |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` | Image model used for the cartoon face and the page redraws |
| `GEMINI_VERTEX` | auto | `1` sends the key to Vertex AI, `0` to the Gemini API. Left unset, a key the Gemini API rejects (e.g. an `AQ.` key) is tried on Vertex AI automatically |
| `CARTOON_DAILY_LIMIT` / `CARTOON_GLOBAL_DAILY_LIMIT` | `4` / `150` | Cartoon-face previews per visitor / for the whole shop per day |
| `REDRAW_DAILY_PAGES` | `450` | Pages the AI may redraw per day (about 30 books); more wait until the next day |
| `PREVIEW_LOCK` | (none) | `off`: a test copy that doesn't start private (see Private preview) |

## What's in it

**Storefront (`/`)**: 49 products in eight categories:
- **Apparel:** t-shirt, oversized t-shirt, polo, football jersey (front + back, kids and adult sizes), kids t-shirt, kids hoodie, baby onesie, hoodie, zip hoodie, sweatshirt, shorts, denim jacket (back), cap.
- **Home:** mug, magic (colour-changing) mug, travel tumbler, coaster set, Ramadan tablecloth, cushion, framed poster, water bottle, apron, A3 wall calendar (the whole card printed, a 12-month pad stapled on it), tent desk calendar (your design on half of every month sheet), fridge magnets (6 × 9 to 10 × 15 cm, singles or 100).
- **Gifts & occasions:** couple mugs (two mugs, a design on each, no extra charge for the second), Eid money envelopes (packs of 10/25/50), greeting card, personalised prayer mat, acrylic photo plaque, welcome sign on an easel, postcards / thank-you cards (10 × 15, packs), folded cards printed inside (packs with envelopes), custom wrapping paper (a repeating pattern on 50 × 70 cm sheets), wedding table numbers and place cards (tent cards, with a name / number list).
- **Accessories:** tote bag, phone case, mouse pad, XL desk mat, acrylic keychain (1/5/10).
- **Stationery and back to school:** notebook, sticker sheet, school name labels (40/80), kids lunch bag, pencil case, bookmarks with a tassel, notepads (A5/A6, 50 sheets).
- **Business:** business cards (front/back, 100–1000), flyers (A5/A4, front/back), letterhead paper, DL company envelopes, round logo stickers, roll-up banner with stand, paper shopping bags with a logo, A5 carbonless invoice books, employee ID cards with lanyard (front/back), gift vouchers, A4 tri-fold brochures (outside + inside), restaurant menus (A4/A3, lamination option), presentation folders, A5 stapled booklets (8 to 32 pages, every page designed here or placed from the customer's own PDF), product labels (3 sizes, sheets or roll), window stickers, vinyl banners with eyelets. The editor has matching templates: Arabic and English business cards, shop logo, sale flyer, letterhead and staff ID.
- **Kids books (personalised, printed in English):** "My Space Adventure" story book (the child's face in every picture; name, gender, birthday, city, parents, best friend, favourite fruit and animal written into the story, with the fruit and animal in the pictures) and a 16-page colouring book where the child's photo becomes line art on 13 dream jobs. See *Personalised books* below.
- **Photo prints:** photo prints in four sizes, and a photo album (slip-in pockets for 100 / 200 photos) with your design on the cover.

Each has colours, sizes (or pack sizes) and a mockup drawn in its colour. A product can set `extraSidePrice` to override the usual charge for a second printed side.

Product cards, the editor and the cart thumbnails all show **real product photos**, recoloured to the chosen colour (card pictures are made once on the server by `src/thumbs.js` and served from `/api/thumbs/<product>/<colour>.webp`); drawn mockups are only a fallback for products without a photo.

**AI help** (editor tool "ذكاء"): writes slogans in Egyptian Arabic and/or English for an occasion and tone, and designs 3 logos from a name, built only from the editor's own fonts and shapes, so everything lands on the product as normal editable text and shapes. It runs on Claude Haiku 5.5 (`src/ai.js`) with structured JSON output. It is off until the server has an `ANTHROPIC_API_KEY` environment variable. Each visitor gets `AI_DAILY_LIMIT` requests a day (default 15), and the whole shop `AI_GLOBAL_DAILY_LIMIT` (default 300), so the bill stays predictable.

**Photo quality boost**: a low-resolution photo can be enlarged (Lanczos, up to 4× or 4000 px) and sharpened on the server (`/api/enhance`). It keeps its size on the product, crop, shape and filters, and the DPI badge updates.

**Share for approval**: the Share button makes a link (`/s/<id>`) with a picture of the design (WhatsApp shows it as a link preview). Friends tap "Looks great" or suggest a change; replies show on that page and in the editor's share window. "Open a copy in the editor" loads the design as a new draft. Shared designs are stored under `DATA_DIR/shares/`.

**Ready-made designs shop (`/designs`)**: 29 starter designs (funny Egyptian phrases, Ramadan, football, Eid, love, birthday, family, Egypt, motivation) that customers buy without designing. They pick a design, then any product, colour and size, see it on the real product photo (plus the 3D and print-colour previews), and add it to the cart. "Change the words in the editor" opens it in the editor as a new draft. Starter designs are layouts in `src/library.js` that fit any product and switch to light or dark ink to suit the garment colour. `public/js/design-render.js` places a design on a product and makes the same print PNG, preview and SVG the editor does, so ready designs print exactly like custom ones. The owner adds their own designs in the dashboard's **Ready designs** tab by pasting a share link from the editor (stored in `DATA_DIR/library/`).

The **Ready designs** tab manages every design, starter ones included:
- **Pause** takes a design out of the shop for now; **Show in the shop** brings it back.
- **Delete** takes it out of the shop and out of the main list. Nothing is really removed (the owner's own designs keep their files), and **Bring back** in the "Deleted" filter restores it as it was. Orders made from a design never depend on it.
- Filters (in the shop, paused, deleted, uploaded, "New this week"), category, search, "with artwork / text only", sort (newest / oldest added, name), and pause or show every design in the current list at once (`PATCH /api/admin/library` with `ids`). Each row shows the day the design was added (`addedOn`: the starter packs' days are in `src/library-dates.json`, later ones are noted the first time the shop sees them, in the index's `firstSeen`).
- **Upload designs (zip)**, for the owner and the Catalogue role (they don't see the text-only switch; their publishing waits for an owner's approval). A zip of pictures (PNG, JPG, WEBP, SVG; up to 600 MB and 300 pictures) goes up as is (`POST /api/admin/library/uploads`, the zip's name URL-encoded in `x-file-name`). A zip over 8 MB goes up in 8 MB pieces, each its own short request (Hostinger stops any request after 120 seconds, and a piece lost to a dropped connection is sent again): `POST …/uploads/start` (`size`, `name`), `PUT …/uploads/<batch>/piece?at=<offset>` in order (a piece sent again or out of order gets 409 with `received`, where to go on from), `POST …/uploads/<batch>/finish`; a half-sent upload is hidden from the list and removed after a day. The zip is saved straight to disk as it arrives and its pictures are read one at a time in the background (`openZip`), so memory stays low whatever the size (a 163 MB zip added about 120 MB at its peak): a small zip answers once read (201), a big one answers "reading" (202, `status`, `done`, `total`) and the admin's page shows "Reading the pictures: 37 of 120" until it's ready (the admin can leave the page; Cancel discards it). One zip is read at a time; one still being read when the shop restarts carries on where it was. `src/design-upload.js` reads it safely (no zip bombs, path tricks, encrypted or ZIP64 entries), skips what isn't a usable picture with a reason (not a picture, too small under 600 px, empty, too big), trims cut-outs to the artwork, and suggests the products each picture suits: its shape against each print area, print quality (DPI) at that size, cut-out vs. full picture, dark or light ink (which colour to show it on), and folder or file names in Arabic or English ("mugs/", "تيشيرتات/", "ramadan/…" also sets the category; otherwise "Painted art"). The review screen shows each picture on its suggested products with the shop's own renderer; the admin edits the names (Arabic and English) and category, ticks products (⚠ = won't print well there), skips some, and publishes. Uploads not finished stay listed (`DATA_DIR/library/uploads/<batch>/`, cleaned after 14 days). A published design is a ready design like the rest (pause, delete, filters), on exactly the products ticked, with a light screen picture (`/library-art/<id>/web.png`) and the full-size original that the print PNG and SVG files use (`/library-art/<id>/print.png|jpg`). Uploading never brings back designs the owner paused or deleted, and never changes the frozen text-only list.
- The switch **"Text-only designs hidden on the picture-design products"** (`PUT /api/admin/library/settings`, `textOnlyLimited`). On a fixed list of products (`DATA_DIR/library/index.json` → `textHiddenOn`: T-shirts, hoodies, mugs… the 33 products with 12+ of the first 87 picture designs, as the owner approved) only designs drawn with real artwork are offered; text-only designs stay on every other product. The list is frozen (owner's choice, 25 Nov): new picture designs, uploaded or added in code, never hide text designs; the owner pauses a text design by hand when it has a replacement. Products made later from one on the list follow it.
- One-time steps at the real shop's start (`server.js` → `libraryOnce`, remembered in the index): `pause-no-artwork` (the rule on, text designs left with no product paused), `unpause-artwork-enough`, and `freeze-text-rule` (the list fixed as above; text designs paused only because of designs added later shown again). Paused or deleted designs are never brought back by uploads. In the shop's list, the owner's own designs come first, then those with artwork, then text-only ones.

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

**Order tracking (`/order?id=…&k=…`)** shows each item moving through *queued → printing → printed → shipped*. Each order has a secret **link key** (`k`). The customer's links carry it: the cart after ordering, the emails, the account's order list and the guest's "orders on this device". The order number alone no longer opens the order page, the invoice, "order again" or "send a new version" (`403 orderLinkNeeded`, which says where the right link is); a signed-in customer opens their own orders without it, and so does the browser a guest ordered from (an HttpOnly `pod_orders` cookie, only sent to `/api/orders`, with their last 8 orders). The customer's proof emails and the order page's proof button carry the key too. Orders placed before the keys came in still open by number, so links already sent keep working. The key never reaches the dashboard: `linkKey` and `orderKey` are taken out of every admin answer, and proofs and saved designs carry no prices.
- **Edit link for one item.** When an item waits for the customer's changes (the shop asked, or the customer turned down a proof), it gets its own link (`/editor?design=…&revise=…&rt=…`). The proof page sends the customer there after "Ask for changes", and Review shows it so the shop can send it by WhatsApp to a customer with no email. It opens that design in the editor and sends the new version (`x-revise-token`), and nothing else: no amounts, no other item. It ends once the new version is sent.

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
src/security.js      security headers + CSP, rate limits, admin sessions/lockout, SVG clean-up, old-data clean-up
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

## Products screen (product manager)

Admin → **Products** changes the real products without touching the code (`src/catalog.js`; the changes are kept in the data file under `catalog` and laid over `src/products.js` on every request, like the owner's prices):

- **Pause** a product for a while (season, quality, supplier, other, or out of stock when stock isn't counted; + a note) with an optional **"Show it again on"** day (a day in the shop's time zone, `SHOP_TIMEZONE`, default Africa/Cairo): it comes back by itself that day, worked out on every request, so no job has to run (e.g. Ramadan items every year). A day already gone is refused. The list shows a **Paused** badge with the reason and "back on …"; once the day comes it shows as in the shop with "back since …". Customers who open it see "Not available right now, back soon" (and the day when there is one).
- **Stop selling** a product (archive): it moves to the **Archived** filter (not in "All"), leaves the shop, Accounts → Prices & costs, the coupon product list and the printing-house product list (unless a coupon or a house still names it), and stays in orders, accounts reports and the change log. Customers see "We no longer sell this product" with similar products; carts and orders holding it get `productRetired`. **Sell again** brings it back with everything as it was.
- Either way it disappears from every shop page, ready designs stop offering it, new designs and orders are refused, and carts holding it say so. Old orders and their files keep working. `GET /api/products/:id/name` says where any product stands (`live`, `paused` + `backOn`, `retired`, `soldOut`) and its category, for the shop's "back soon" and "similar products" messages.
- **Stock**: optional count per product. Every order takes its pieces off; at 0 the product leaves the shop by itself (so "out of stock" isn't offered as a pause reason then); "Only n left" shows near the end.
- **Colours and sizes**: on / sold out (still shown, crossed out) / off; rename sizes; add colours and sizes.
- **Prices**: base price, extra side, per-size add-ons (the same prices as Accounts → Prices).
- **Print setup per side**: on/off, physical print width, safe margin, bleed, and the print area on the product drawing (drag the box). New designs use them; designs already made keep their own sizes.
- **Technology**: printing method within what the product can be made with (garments DTG/DTF, laser engraving/cutting...), embroidery on/off, its position, size, price and thread colours.
- **Photos**: upload real product photos (JPG/PNG/WebP, stored as WebP in `DATA_DIR/catalog-photos/`); they lead the product page gallery and the main one is the product's picture on the home page.
- **New product**: made from an existing one (its drawing, 3D model, print setup and ready designs), then changed. It starts out of the shop (paused) until it's published.
- **Nothing is deleted**: products are paused or archived ("stop selling"), never deleted, so old orders, accounts and the change log keep naming them, and they can be sold again with everything as it was. Built-in products can also be reset to the original (the change log keeps what was changed).
- **Staff**: product managers are the **Catalogue** role (see "Team, roles and approvals" below). Their changes here wait for an owner's approval. Every change is logged with who made it.

## Team, roles and approvals (admin)

`src/roles.js`; the owner's decisions of 25 Nov.

- **Four roles**, and a person can hold more than one:
  - **Owner**: everything.
  - **Finance**: orders with amounts, payments, Accounts, costs, expenses, coupons.
  - **Operations**: orders, review, production, files, printing houses, customers, rights requests. Operations sees **no amounts**: prices, totals, costs and discounts are taken out of every answer they get. A customer's password-reset link is the owners' alone (whoever holds it can sign in as the customer).
- **The order page as the customer sees it (team view).** "Customer page" (and "Invoice", for people allowed amounts) on an order asks `POST /api/admin/orders/:orderId/team-view` for a link (`/order?id=…&team=…`) that works for 30 minutes. The page reads `GET /api/orders/:id/team` with the link's ticket (`x-team-view`). It shows no amounts to roles without them, and none of the customer's buttons (order again, edit and resend, WhatsApp, proof). The link is signed (every copy of the app can check it, also after a restart) and works only in the browser that asked for it (an HttpOnly `pod_tv` cookie). Every use checks the sign-in that made it again: signing out, being switched off or a role change ends it (`401 teamViewOver`). An owner's view also has a "Copy the customer's link" button, for a guest who lost the email. Saved designs (`GET /api/designs/:id`) no longer tell their price.
  - **Catalogue**: products, ready designs, zip uploads.
- **Permissions per route.** Every admin route needs one permission (`ROUTES` in `src/roles.js`). A route not listed there is for owners only. A refused route answers 403 `noPermission`; it never signs the person out.
- **Personal sign-ins.**
  - An owner adds a person with a name, username and roles (`POST /api/admin/staff`). The answer carries a **set-up link** (`/admin?setup=…`, 48 hours, works once) where the person chooses their own password (`POST /api/admin/setup`).
  - Owners can give a new link (`POST /api/admin/staff/:id/setup-link`), change a person's roles or switch them off (`PATCH /api/admin/staff/:id`). Either change signs the person out everywhere.
  - No owner can remove or switch off their own owner account. People change their own password with `PUT /api/admin/me/password`.
- **Two owners** sign in personally. The **shared password** (`ADMIN_PASSWORD`) still works as the owner's emergency way in, and every use is written to the activity log.
- **Owner approval.** Catalogue and money changes by anyone who isn't an owner are not done straight away. These are product edits and photos, ready designs (publish, pause, delete), zip publishing, coupons, expenses, costs, actual costs and accounts settings.
  - The request is kept as sent (`db.approvals`; pictures under `DATA_DIR/approvals/`) and answered `202 { pending: true, approval }`.
  - Checks that can fail (bad fields, a taken coupon code, a selling price, a missing product) answer at once, so the person hears straight away.
  - An owner approves (`POST /api/admin/approvals/:id/approve`) or refuses (`…/reject`); the person can withdraw their own (`DELETE /api/admin/approvals/:id`).
  - Approving runs the kept request again **inside the app** (an in-memory connection, no network) as the person who made it. Their limits still apply (selling prices stay the owner's), and the log shows who made it and who approved it.
  - A change that fails when approved is marked `failed` with the reason in both languages, and stays in the waiting list: it can be approved again or refused.
  - Approving checks the person as they are now: someone switched off, removed or without the role any more can't have their change applied, and switching someone off, removing them or taking a role away cancels their waiting changes.
  - Limits: an edit with nothing in it is refused, a photo is checked as a real picture before it waits (the owner sees a small copy), and one person has at most 50 changes waiting (20 pictures).
  - The same change pressed again while it waits (same person, same address, same contents) isn't a second request: the answer is the waiting one with `already: true`, and the screen says "Already waiting for an owner". Coupon rows show a change waiting for approval.
  - The owner's card reads every change in words (print areas, embroidery, new colours and sizes, size renames, printing methods, costs per size), not as code.
- **Sign-in lockouts**: wrong passwords for a username from elsewhere don't lock a person out on a browser they signed in from before (a mark per person, like the owner's), only that address's own wrong tries.
- **Daily order work** (status, shipping, sending to printing houses, review decisions, payments) happens at once and is logged.
- **Activity log**: every change, sign-in and approval, one line each in `DATA_DIR/activity.jsonl` (the previous file is kept as `activity.jsonl.1` once it passes 4 MB). Passwords and tokens are never written. `GET /api/admin/activity`: owners see everyone, others only their own. It answers 500 lines at most, newest first, with `more` and `next` when older lines are there; `before=<next>` reads the next page. The Activity tab shows the latest 500 with "Show older" for the rest, and its CSV holds every line of the chosen person and days (up to 50,000).

## The shop as an app (install on the phone)

The site installs like an app ("Add to Home Screen"): its own icon, full screen, no browser bar.

- **Android and computers (Chrome, Edge, Samsung Internet):** the browser offers to install it, and the footer shows "Install the app / ثبّت التطبيق" while that offer is there. **iPhone and iPad:** the footer link says how (Share, then "Add to Home Screen").
- `public/site.webmanifest`: the brand kit's name, colours and icons, plus `id`, `start_url` and `scope` (`/`) and shortcuts (ready designs, cart, account). It is served `no-cache`, so a changed name or icon reaches installed apps.
- `public/sw.js` (served `no-cache` by `src/app.js`, with a policy a worker can run under): it only steps in when a page can't be reached at all, and shows `public/offline.html` (both languages, no scripts) at the address asked for. Nothing else is kept: pages, orders, prices and pictures always come from the shop, so an installed app is never out of date. A new `VERSION` in `sw.js` replaces the kept offline page.
- `icon-maskable-512.png` is the brand kit's icon, scaled so the whole mark, corner marks included, sits inside the circle every phone shows (phones crop app icons to circles or rounded squares).
- While the shop is private, the manifest, icons, the worker and the offline page load for everyone (none of them shows the shop); the shop itself still needs an invitation.
- The dashboard (`/admin`) opens inside the same app; it has no separate icon.

## Backups

Everything the shop saves is in one folder (`DATA_DIR`; on Hostinger `/home/u893141490/pod-data`, outside the website folder, so deploys never touch it): `db.json` (orders, customers, coupons, the team, approvals), `files/` (customers' designs and print files), `catalog-photos/`, `library/`, `shares/`, `approvals/`, `models/`, `pdf-uploads/`, `activity.jsonl`. The code is on GitHub; passwords and keys are in Hostinger's environment variables (keep a copy in a password manager).

- **Dashboard → Backups (النسخ الاحتياطي), owners only** (permission `backup`): "Make a backup now" builds one `.tar.gz` of the folder in the background (`src/backup.js`; progress on the page), then **Download** gets a signed link (`/dl/backup/<name>?e=&s=`, 6 hours) that the browser saves itself: no size limit in the page, and an interrupted download can be resumed. Made, downloaded and deleted backups are in the activity log.
- Left out: `backups/` itself, `.session-secret` (the key that signs sign-ins and download links: a backup that went astray can't be used to sign in as anyone), `.signin-limits.json` and half-written files.
- Kept on the server for 3 days (the newest 2), then deleted; one is made at a time, and a backup is refused when the server hasn't room for another copy of the folder.
- The file has customers' details: keep it private and delete old copies.

**Restore** (into a new or emptied folder): stop the app, unpack into `DATA_DIR` (`tar -xzf ebda3-backup-YYYYMMDD-HHMM.tar.gz -C /home/u893141490/pod-data`; on Windows, 7-Zip), start the app. A new sign-in key is made, so everyone (team and customers) signs in once again, links already sent to printing houses stop working (send them again) and invited people open their invite link once more.

**Before launch (planned):** a nightly encrypted copy off Hostinger (a cloud storage the owner chooses) and a monthly test restore.

## Private preview (before the shop opens)

Until the owner opens the shop to everyone, only invited people get in (`src/preview.js`).
- **Dashboard → Private preview** (owner only) holds a switch, *Open the shop to everyone* / *Make the shop private again*, and the list of invited people. Each person has a name, a personal code and link (`https://ebda3.me/?invite=CODE`), their last visit and number of visits. Buttons: copy link, send on WhatsApp, turn off / let in again, remove.
- Opening the link, or typing the code on the "Opening soon" page, gives that browser a signed cookie for 60 days (`ebda3_preview`, HttpOnly). Turning a person off or removing them shuts them out at once. The owner and staff get the same cookie when they sign in to the dashboard, and the dashboard's own requests always get through.
- Everyone else gets the bilingual **"Opening soon"** page (`public/coming-soon.html`) for any page address. Data, pictures and files answer 403. Only the files that page and the dashboard's sign-in need stay reachable: code, styles, fonts, the logo and icons, the link-preview picture, `/admin`, and the printing houses' signed `/dl/` links. While private, every answer says `X-Robots-Tag: noindex` and `robots.txt` disallows everything.
- Wrong codes count per visitor: 10 in 15 minutes, 40 a day.
- The real shop starts private the first time it runs with this (`server.js`: `previewStart`). **Test copies** (QA, local runs) start with `PREVIEW_LOCK=off`, for example `PREVIEW_LOCK=off PORT=3400 DATA_DIR=/tmp/qa/data ADMIN_PASSWORD=pw node server.js`. Tests that call `createApp` directly are not affected.

## Before going live

- **Prices** are starting points in `src/products.js` (`basePrice`, size `surcharge`) and the shipping constants at the bottom of that file. Adjust them to your costs.
- **Payment (owner's decision):** at launch the only way to pay is in advance (no cash on delivery). The private preview still shows cash on delivery; before opening, add an Egyptian gateway such as Paymob or Fawry and change every text and email that promises cash on delivery.
- **Backups off Hostinger (planned, see Backups):** a nightly encrypted copy of the data folder to a cloud storage the owner chooses, old copies cleared, and a monthly test restore. Needs the owner's storage account and key (added in Hostinger's settings with their approval).
- **Storage:** the JSON store suits a single server. For scale, move metadata into a database and print files into object storage.
- **Team sign-ins:** each person has their own login and roles (see Team, roles and approvals); the shared password is the owner's emergency way in.

## Proofs, approval and file review

Every order item is printed only from files the customer approved, and complex or flagged jobs are checked by a person first (modelled on the usual print-shop file review and proof process).

- **The proof** (`GET /api/designs/:id/proof`): product, colour, size, pieces, print method, every printed side with its physical size, bleed, safe margin, DPI and pixels, the print file itself on a checkerboard (transparent areas show as squares), the product mockup, the first rows of a name list, and the results of the automatic checks in plain words.
- **Approval at checkout:** standard orders approve each item's proof in the cart (one checkbox per item). The order sends `approvals: { designId: { proofHash, sample? } }`; the server refuses an order without them (`approvalRequired`) or when the design changed since (`proofChanged`, the customer sees the new proof).
- **Recorded against a version:** each design has a version number (`proofHash` is `"v<n>"`); a corrected file from the shop or a redrawn book page makes a new version. The item keeps `approval { proofHash, version, at, via, sample }` and a history (`approvals`) of every approval, rejection, review and change.
- **The exact production file is kept:** admin print downloads refuse (409) while a job is in review or when the design is no longer the version the customer approved. A corrected file from the shop is kept as a new version; the old one stays as `<side>-print.v<n>.png`.
- **Material change → new approval:** a corrected file from the shop (`PUT /api/admin/items/:id/replacement/:side`, same pixel size) or a redrawn book page puts the item in **Waiting for approval** and emails the customer a link (`/proof?t=…`) to approve or ask for changes.
- **Human review only where needed:** jobs go to **Review** (admin tab with a count) when the checks failed, for name lists, embroidery, designs imported from links, 50 or more pieces, or when the customer asked for a printed sample first. Everything else goes straight to the print queue. The shop can approve, ask for changes (the customer is emailed the note), upload a corrected file, or resend the proof link.
- **Send an approved job back:** a job the customer approved that can't be printed as it is (waiting to print or on the press; not once printed) has **Problem with this file?** in the print queue. The team writes what's wrong (required, for the team only: the customer never sees it) and `POST /api/admin/items/:id/review { action: 'reopen', note }` puts it back in **Review** (reason *reopened*). The answer warns when the job was already sent to a printing house or put on a DTF film, so it is stopped there too. In Review the shop then uploads a fixed file, which needs a note of what changed (sent as `x-review-note`; the customer gets the new proof with it by email and on the proof page, and it prints only once they approve), or asks the customer for a change (they edit and send it again), or approves it as it was. The customer hears nothing until one of those.
- **Replace a photo (photo prints, kids' books):** these aren't made in the editor, so a job sent back to Review has **Replace a photo** instead (`PUT /api/admin/items/:id/photo/:n`, the photo's bytes, with the note of what changed as `x-review-note`; owner's decision, 25 Nov). Photo prints: photo `n` is filled to its print size at 300 DPI, its small picture and the contact sheet are made again. Kids' books: `n` is `face`, the child's photo as the book page takes it; the cartoon face and the AI page drawings are made again from it (within the shop's daily drawing budget, the pages queued as after an order). The old photo is kept (`….v1.jpg`), the design's version goes up, and the customer approves the new proof as for a corrected print file (one link and one message for several photos within 10 minutes). Not on the press or after.
- **The shop edits the design itself:** in Review, a job made in the editor has **Edit the design in the editor**. It opens the job's design in a new tab of the dashboard (`/editor?design=…&shopEdit=<order>.<item>`, saved with the dashboard's sign-in in that tab). Saving asks for a note and where it goes. **Send to the customer to approve** (`POST /api/admin/items/:id/shop-edit { designId, baseDesignId, note }`) makes it the job's next version, and the customer gets the new proof with the note. **Print without asking the customer** (`…/shop-edit/print`) is an owner's decision: an owner's goes to the print queue at once, recorded as approved by the shop with who decided; anyone else's waits in **Approvals** (the card shows the version the customer approved next to the shop's edit), and the Review card says it is waiting. The note of why stays with the team. Either way the new version must be the same product with the same pieces (the customer keeps the price agreed at checkout), made from the version the job has now (`shopEditStale` otherwise), and a waiting request fails with its reason if the job moved on meanwhile.
- **The customer's links are the customer's:** the proof link and the edit link shown in Review are for the customer (copy and send them). A browser that signed in to the dashboard (owner or team; its private-preview mark says so) can open them to look but not decide: approving or asking for changes on the proof page answers `proofTeam`, and sending a new version with the edit link `reviseTeam`, unless that browser has the order's key (the customer's own link) or the customer's account. The shop decides for a customer in Review: **Approve for printing** with a note of how they confirmed, or **Edit the design in the editor** (owner's decision, 25 Nov).
- **Edit and send again:** when the shop asks for changes on an editor-made item (name lists included, where the shop can't upload a corrected file), the order page offers **Edit the design and send it again**. It opens the ordered design in the editor (`/editor?design=…&revise=<order id>.<item id>`); **Send the new version** saves it as a new design and `POST /api/orders/:id/items/:itemId/revise` puts it on the item as the next version (back to **Review**, reason *revised*). The shop checks it, the customer approves its proof as usual, and it prints from the new files. The new version must cost the same (same pieces and options), so the order total never changes; otherwise the customer is told to keep the same number or contact the shop.
- **Automatic checks** (`src/preflight.js`, on every finished design): resolution at final print size (up to 24 in: fail below 100 DPI, warning below 150; up to 48 in: 72 / 110; bigger prints seen from further away, such as roll-ups and tablecloths: 40 / 60), export dimensions against the physical size, empty files, artwork too close to the cut (paper, cards, mugs…) or touching the edge (garments), and half-transparent areas that DTF/DTG print badly. The editor adds what only the browser can see: photos too small for their printed size, tiny text, text near the edge, and fonts that did not load (the text would print in a fallback font).
- **Screen proofs are not colour proofs:** the proof and the editor's **Print colours** view are screen estimates. Screens show light (RGB); prints are ink, and every screen differs. Customers who need exact colours on several pieces can ask for a printed sample first, which also sends the job to review.
- **Tests:** `npm test` covers the approval flow (`test/approvals.test.js`) and the checks (`test/preflight.test.js`); `npm run test:e2e` renders real designs in the browser editor and checks export size, image resolution at final size, font rendering (including Arabic), transparency, accepted file types, and that the uploaded print file is exactly what was exported.

## One artwork, many pieces (families, schools, teams, businesses)

The customer makes the artwork once, then says how many pieces they want; the price shown is for all of them. Three cases stay distinct:

1. **Several identical items:** one colour and size, a quantity (e.g. 12 mugs).
2. **The same artwork on different sizes or colours:** a small grid in the editor, colours down the side and sizes across (Black S×2, M×5, L×3, White M×2…). It's one design and one print file; each line is priced at its size (2XL costs more). Offered only where every size and colour uses the same print file (`product.mix`): shirts, hoodies, bags, cards… but not posters, mugs or certificates whose sizes are different print sizes (one size, any quantity), not canvas prints (the "colour" is the printed edge) and not fabric.
3. **Related items with different names or numbers:** a name list (above). Name lists are on invitations, certificates, greeting cards, ID cards, business cards, name labels and sticker sheets only (the owner's choice: not on clothing).

The design keeps `quantities: [{ color, size, qty, unitPrice }]`; orders, the cart, the order page, the account, the invoice and the admin show the breakdown and the total pieces; the accounts count each line's blank cost. For garment name lists the admin also gets **names only (ZIP)**: one transparent PNG per piece (`0001-Ahmed-10-L.png`) with where it goes, for printing names and numbers as separate transfers, and the full print PDF keeps garments transparent.

## After the order: history, order again, invoices, drafts, tracking

- **Order history:** signed-in customers see every order in their account (`GET /api/account/orders`), with Track, Invoice and Order again.
- **Order again (exact):** `POST /api/orders/:id/reorder` copies every item's design with all its files (same print files, same name list, same book) into new designs at today's prices and returns cart entries; items whose product, colour or size no longer exists, or whose book photo was already deleted, are listed as skipped.
- **Invoices:** `/invoice?id=<order id>`: a printable A4 invoice (Print / Save as PDF), number `INV-<order number>`, unit prices, copies, discount, shipping, payment method and status.
- **Drafts on every device:** while signed in, each editor draft is also saved to the account (`/api/account/drafts`, kept in `DATA_DIR/accounts/<customer>/drafts/`, newest 40); the editor opens the newest of this browser's copy and the account's. The account page lists them.
- **Tracking:** `/order?id=…&k=…` shows the timeline (placed, in production, printed, shipped, delivered) with dates, and the courier, tracking number, tracking link and expected date. The admin sets these per order (`PATCH /api/admin/orders/:id/shipment`, also "Mark shipped" / "Mark delivered") and the payment status (`PATCH /api/admin/orders/:id/payment`). When an order ships (all items shipped, or "Mark shipped") the customer gets a "your order is on its way" email once, with the tracking details and links to track and to the invoice.

## The cart on the account

Signed-in customers' carts follow them to their other devices. `GET/PUT /api/account/cart` keep only design ids (plus when they were added, and a book's edit token) in `accounts/<id>/cart.json`; entries are rebuilt from the designs, so prices are today's and ordered or deleted designs drop out. Each browser remembers what it last agreed with the account (`pod-cart-base` in localStorage), so the merge on every page load keeps additions from both sides and respects removals on either. Signing out empties the cart on that device (the account keeps it); another person signing in gets only their own cart.

## Name lists (variable data printing)

For invitations, certificates, greeting cards, ID cards, **business cards**, name labels and sticker sheets (and the team-kit garments below), the editor has **Print a list of names**. It is easy to find: a **Names** button in the editor's tool bar (only on these products) opens it, the product page has a "Print a list of names" card that opens the editor right there (`/editor?product=…&names=1`), and on phones the chip under the price shows the number of names.

**Business card paper and lamination:** the card's paper is chosen as matte, glossy or kraft (shown as "Paper / الورق" instead of "Colour"), and **lamination (سلوفان)** as none, matte or glossy. Business cards come in packs of 100, 200, 300, 500 and 1000. Lamination is priced per pack (60 / 100 / 140 / 200 / 350 EGP for 100 / 200 / 300 / 500 / 1000 cards; change in `options` of `bizcards` in `src/products.js`) and appears with the size everywhere ("500 cards · Matte lamination"): price, cart, order, invoice, admin and print labels. Other products can get options the same way (`product.options`).

**Business cards for a whole team:** each row is one person's pack (100, 250… cards) with their own name, position, phone, email or any other column, priced per pack. Ready layouts with the fields in place ({الاسم} {الوظيفة} {الموبايل} {الإيميل} or {Name} {Position} {Phone} {Email}) are in Templates → Business & teams (`src/library-packs/cards.js`), and the example file has those columns. The shop prints each page of the PDF as one pack.


1. The customer uploads an Excel (.xlsx) or CSV file. The first row holds the column titles (Name, Title…), then one row per copy; up to 1,000 rows. `POST /api/merge/parse` reads it (`src/merge-data.js`: CSV with any separator and Arabic encodings, .xlsx read without extra libraries; old .xls is refused with a "save as .xlsx" message). An example file can be downloaded from the panel.
2. Fields such as `{Name}` go into any text (chips insert them; while typing, at the cursor). The customer styles them like any text and can step through the real rows on the canvas. Each field text has a **longest name width**: longer values get a smaller font so they always fit; the panel lists rows whose names shrink a lot or are empty.
3. The price is per copy (one copy per row) everywhere: editor, cart, order, coupons, costs in the accounts.
4. On save the browser draws, with the same fonts and effects as the editor, the side's background without the field texts (`<side>-merge-base.png`) and one small transparent picture of the field area per row (`<side>-merge.bin`, PNGs back to back), plus the usual files showing row 1. The server checks every picture's size and count.
5. Admin downloads (`src/merge.js`): **All names · PDF with crop marks** (recommended) or without; the background is stored once in the PDF and every page only adds its name, so even 1,000 copies make a small file (300 A4 certificates ≈ 12 MB, built in about 10 s). Also **one PDF per name (ZIP)**, named `0001-Ahmed-Ali.pdf`…, and the **list as CSV** (opens in Excel with Arabic).

New products for this: **Invitation Cards** (13 × 18 cm, 350 gsm, with envelope, front/back) and **Certificates** (A4 or A3 landscape, 300 gsm), with product photos like the rest. A product without a photo shows its drawing on the product cards.

## On a model (clothing previews)

The preview window has an **On a model** tab for clothing: photos of people wearing the blank white garment (`public/mockups/models/`, made with Creative Claw), each with a garment-only mask. The same engine as the product photos recolours the garment from the photo's own shading and warps the design into the print area, shown at about its real size. Skin, hair and backdrop are never touched. The photos and print rectangles are listed in `POD_MODELS` (`public/js/photo-mockups.js`); with several models per side the customer picks one with chips.

Models: T-shirt, oversized tee, hoodie and sweatshirt (man and woman, front; man back; woman back for the T-shirt), zip hoodie, polo and football jersey (man), kids tee and kids hoodie (boy and girl). The garment masks were made from a background-removed cut-out of each photo plus the garment's colour (neutral white, not skin or hair); print rectangles from the garment's measured width and the collar, then checked by eye.

**Turn the model (360°):** every clothing model can be turned all the way round (T-shirt, oversized tee, hoodie, sweatshirt: man and woman; polo, jersey, zip hoodie: man; kids tee and kids hoodie: boy and girl): drag the picture sideways, or use the ◀ slider ▶ under it. Each model has eight photos of the same person every 45° (`<product>-<who>-t045` … `t315`, plus the front and back photos; models that had no back photo got one, with its print rectangle). The front design shows on the front angles and the back design on the back angles, wrapped round the torso as an upright elliptical cylinder (`turn` in `renderPhoto`): it narrows and moves round the chest as the model turns and is hidden at the side views. `TURNS` in `public/js/photo-mockups.js` holds, per model, the torso centre and half-width with the collar and hem rows of the front and back photos and of each three-quarter photo, measured from the garment masks (on long sleeves at the sleeve-to-body seam, as the sleeves hang against the body); the torso's half-depth is taken as 0.7 of its half-width, which is what the 45° photos give. To add a model: 6 angle photos from its front and back photos as references (Nano Banana 2, 2K, 12 credits each), a back photo if it has none, a background cut-out of each (4 credits) for the masks, then the measurements.

## Personalised books

`/book?b=space-hero` and `/book?b=dream-jobs`. The shopper answers the questions, adds a photo and fits the face into the oval guide (hairline to chin, eyes on the line), then flips through every real page before adding to the cart.

- **Pages are drawn on the server** (`src/books.js`, sharp + Pango): illustration (in `src/book-assets/`, made once with Creative Claw) + the child's face + companions + text in the shop's fonts (`src/book-fonts/`, TTF). Previews are 720 px; the print PDF is 8.25 x 8.25 in (8 x 8 in trim + 1/8 in bleed) at 300 DPI.
- **The face:** the drawn face is painted over with the drawing's own skin colour, then the photo face is laid in with soft edges and its colours nudged towards the drawing; the drawn hair and head stay. Colouring pages use line art traced from the photo (difference of Gaussians after evening out the lighting). Face positions per page are `face: [x, y, height, eye spacing]` in percent.
- **Girl pictures:** every illustration also has a girl version (`<page>-girl.jpg`, or `.png` for colouring pages): the same scene, pose and face spot, with pigtails and bows. When the child is a girl the server uses it; if one is missing it falls back to the usual picture.
- **Orders:** a book is a design of kind `book`; the admin downloads one print-ready PDF (`Book PDF`) or the cover proof.
- **AI drawing (option, with the parent's consent):** with `GEMINI_API_KEY` set, the book page offers "Draw my child as a cartoon". The preview then uses **one** AI image: the child's face drawn in the book's style (`src/cartoon.js`), reused for every page and answer change. After the order is placed, a background queue **redraws every page with a face** (12 for the story, 14 for the colouring book, 2K each) so the child is painted into the scene; text is still added by the server so it stays exact. Progress shows in admin; a page that fails twice keeps its preview version; admin can "Redraw pages" again. The PDF waits until drawing finishes. Typical cost: about $0.04–0.10 for the preview and $0.6–1.5 per ordered book.
- **Privacy:** the photo is deleted 30 days after the book is shipped, and unordered books after 7 days.

## Movable print area

On garments and bags (`moveZone` on a side in `src/products.js`, measured from the product photos and kept clear of collars, hems, zips, plackets and pockets) the customer can move the print box: drag the orange "Drag to move" tag under it, or use the arrow buttons (1 cm) in the panel. The design moves with it. The print file size stays the same; the position is saved per side (`offsetCm`, positive = right / lower) and shown to the admin, in the print PDF label and in messages to printing houses ("moved 5 cm lower from the standard position"). The live and realistic previews show the new position.

## Garment sizes in the preview

Each apparel size has a half-chest width (`chestCm` in `src/products.js`) and each garment the size its photo shows (`photoChestCm`). The print is the same size in cm on every size, so the editor and the realistic preview draw the print box (and the design) smaller on a 3XL and bigger on an S, kept just below the collar (`printAreaFor`). Kids sizes (2–4 … 10–12 yrs), baby onesies and kids hoodies have their own widths. Print files are unchanged.

The garment itself is also drawn at its size: the biggest size fills the picture and smaller sizes show a smaller garment, so the print keeps its size on screen while the T-shirt grows or shrinks around it. The editor does this with its view (designs, print files and cart pictures are unchanged); the realistic preview and the ready-design page cut the garment out of the photo, fill the backdrop behind it and put it back smaller (`POD.sizeView`, `sizedPicture` in `public/js/preview.js`). Ready designs ordered from the design page use the chosen size's print box, like the editor.

## AI background removal

In the editor, "Remove background (AI)" on a selected photo, or "Remove the background of my photos" in the upload panel, cuts people, pets and products out of any background. The server runs ISNet (general use, Apache-2.0, the model the free rembg tool uses) with `onnxruntime-node`, one photo at a time in a short-lived process (`src/bgremove.js`, ~2-3 s and ~650 MB per photo). The 178 MB model is downloaded once into `DATA_DIR/models` (checked against its SHA-256) a little after start-up. If the AI isn't available, the editor falls back to the quick plain-background remover. `.npmrc` skips onnxruntime's GPU downloads. Set `BG_REMOVAL=off` to turn it off; `BG_MODEL_PATH` / `BG_MODEL_URL` point to another copy of the model.

## Coupons

Admin → **Coupons**: create codes for a percentage off (optionally capped), an amount off, or free shipping, with an optional minimum order, start/end dates, total uses, uses per customer (by mobile number) and categories. Pause, edit or delete them; each shows how often it was used and the discount given. Customers type the code in the cart; the server checks it again when the order is placed (uses are counted from the saved orders under the store lock, so several app copies can't go over a limit). The discount is shown in the cart, on the order page, in the emails, in the admin order details and in the Accounts report and CSV (`src/coupons.js`).

## Customer accounts

**Delete my account** (Account › Password): with the password (or, for an account with none, ticking that they're sure), `POST /api/account/delete` deletes the account at once: name, mobile, email, password, address, Google / Facebook links, and its folder (the account's cart and saved designs). Orders already placed stay for delivery and the shop's accounts as guest orders, still opened from their links. The privacy page says so (owner's decision, 25 Nov; app stores ask for it too).

Customers can create an account at `/account` (name, mobile number, optional email, password of 8+ characters) or from the "Account" link in the header, and sign in with their mobile number or email.

- **My orders**: every order placed while signed in, with its status (received, printing, shipped) and a link to the order page.
- **Details & address**: name, email and a delivery address. Checkout fills them in for signed-in customers; the address of the first order is saved if the account has none.
- **Password**: change it (this signs out every other device). **Forgot password** sends a link valid for 1 hour by email (when the account has an email and Brevo is set up); otherwise it offers to ask the shop on WhatsApp.
- Signed in but forgot the current password: **"Forgot your current password?"** on the Password tab emails a reset link to the account's email. Accounts made with Google have no password at first; that tab shows "Choose a password" (no current password needed) and explains they can keep using Google.
- Admin → **Customers**: find a customer by name, mobile or email (with their orders and total), and make a **password reset link valid 24 hours, usable once**, to send on WhatsApp or by email: for customers without an email or whose email didn't arrive.
- Accounts are optional: guests can still order without one.

**Sign in with Google / Facebook** (optional; the buttons appear once set up). Privacy policy for the provider forms: `https://ebda3.me/privacy` (also the data-deletion instructions Facebook asks for). New accounts made this way add their mobile number on the account page (checkout asks for it anyway) and can set a password later. An account with the same verified email is linked, not duplicated (`src/oauth.js`).

- Google: [Google Cloud console](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID → Web application. Authorised redirect URIs: `https://ebda3.me/auth/google/callback` and `https://www.ebda3.me/auth/google/callback`. Put the client ID and secret in the hosting panel as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (OAuth consent screen: app name, support email, then Publish).
- Facebook: [Meta for Developers](https://developers.facebook.com/apps) → Create app → Facebook Login → Valid OAuth redirect URIs `https://ebda3.me/auth/facebook/callback` (and www). Set `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.

Passwords are stored as scrypt hashes. The session is a signed, httpOnly cookie (`pod_c`, 60 days) whose key comes from the shop's secret file, so every app copy accepts it (`src/customers.js`).

## Embroidery (DST files)

T-shirts, oversized tees, polos, hoodies, sweatshirts, zip hoodies, kids tees and hoodies, caps, totes and aprons can be **embroidered** instead of printed: in the editor (or "Embroider it" on the product page) the customer switches **Print / Embroidery**. The design then goes in the embroidery area (left chest 9 × 9 cm, cap front 10 × 5.5 cm, tote 15 × 15 cm…, front only). The embroidery box starts at its standard spot and can be moved like a print area (drag its handle or use the arrows), anywhere on the garment's printable zone (on caps, totes and aprons: anywhere on the front print area); the shop sees how far it was moved in cm and the embroidery charge is added (100–180 EGP, set in `EMBROIDERY` in `src/products.js`). The editor warns about photos, gradients, more than 6 colours and text under 5 mm.

When the design is saved, the server digitises it automatically (`src/embroidery.js`): up to 6 thread colours matched to common thread shades, each colour area cut into strips and filled with tatami stitches (0.4 mm rows, stitches up to 3.5 mm, staggered), background colours sewn under the details, jumps and trims between parts, colour changes between colours. The admin shows the stitch count, size and the **thread colours in sewing order**, with downloads of the **DST** (Tajima, read by almost every machine) and a **stitch preview** picture; both are also offered when sending to a printing house. Automatic digitising suits bold text and simple logos; the admin warns when a design has photos/soft edges or many very thin parts, which should be re-digitised by hand.

## Editor library (search icons, stickers and templates)

Editor → **Library**: one search box for about 22,000 icons and colourful stickers plus the templates and ready designs, in Arabic or English ("قلب", "كورة", "رمضان", "heart"…), with tabs (all, colour stickers, icons, templates), "show more" and recently used items. Icons come in the product's ink colour and can be recoloured like any shape.

The graphics are open-licence sets installed from npm (`@iconify-json/*`), all fine to print on products for sale: Fluent Emoji Flat (Microsoft, MIT), Tabler Icons (MIT), Phosphor (MIT, regular and fill), Lucide (ISC) and Material Design Icons (Apache 2.0). They load on first use (about 50 MB of memory). Arabic search words are in `src/asset-words.js` (add more there); spelling differences (أ/إ/آ, ة/ه, ى/ي, diacritics, "ال") are ignored.

### Templates (about 350, in categories)

Editor → **Templates** lists every template and ready design with a search box (Arabic or English) and category chips: Ramadan, Eid, Islamic phrases, birthdays, weddings & engagement, graduation, new baby, funny Egyptian phrases, Egypt, friends, family, football, gym & fitness, gaming, music & art, travel, love, motivation, quotes & wisdom, minimal, kids, school & teachers, pets, business & teams, plus the basics. Thumbnails are drawn only as they scroll into view. The same designs appear in the shop's Ready designs page.

They are written as data in `src/library-packs/*.js` (one file per theme; `src/library.js` holds the first ones), in the small language of `src/library-dsl.js`: text `T`, shapes `S`, the shop's stickers `K` and any library icon or sticker `A('set:name')`, placed as fractions of the print area so each fits every product. A pack adds its own categories. `npm test` checks every design (fonts, shapes, stickers, icons, colours, positions, ids), and `node scripts/tpl-sheet.js <server> <pack.js|all> <out.jpg>` draws a pack on a T-shirt and on a mug-shaped area, reports anything that spills out or overlaps, and makes a contact sheet to look at (`COMPACT=1` for a quick overview). The shop owner can still add designs from the admin (from a share link).

## Fabric printing (roll to roll)

Category **Fabric & home textiles**: printed fabric by the metre (145 cm wide, 1–10 m), upholstery fabric by the metre (140 cm), bed sheets, duvet covers and curtains (pairs). The "colour" is the fabric type (cotton poplin, canvas, satin, velvet, blackout…).

The customer designs **one square tile** and chooses in the editor how it repeats (**straight, half-drop, half-brick, mirror**) and how big each tile prints (10–60 cm). Anything that crosses the tile's edge is drawn again on the opposite side (shifted for half-drop / half-brick), so the print tile is seamless. A small picture in the options shows the pattern on the product at its real scale; the live preview (realistic and 3D) and the cart picture show it on the bed, curtains or fabric roll.

For the print house: the **tile PNG at 300 DPI** (its physical size is the chosen tile size), the item's **pattern line** (tile size, repeat type, fabric width × length) for the RIP's step-and-repeat, and a **repeat preview** JPEG of the whole piece (admin → item → "Repeat preview", also offered when sending to a printing house). Method: roll-to-roll textile (sublimation on polyester, pigment/reactive on cotton).

## Canvas prints

Two products, **Canvas Print (portrait)** and **(landscape)**, in 30×45, 40×60 and 60×90 cm (one design area, the bigger sizes print larger). They are gallery-wrapped on a 1.5 in (4 cm) frame, so the print file has a **1.75 in band on every side** (frame depth + fold at the back). The "colour" is the edge style:

- **Image wrap**: the design continues round the edges (the editor shows the band; keep faces and text inside the front).
- **Mirror wrap**: the band repeats the front's edges flipped, so the whole front stays visible.
- **White / black edges**: plain band.

The editor and the ready-design page make the band when they make the print file (`POD.canvasEdges`), so the PDF/TIFF/PNG are ready to stretch; the admin recommends the PDF. The 3D preview shows the canvas with its real depth and edges.

## Import a design from a link

Editor → **Photo** → **Import from a link**: paste another shop's product page (or a picture link) and pick one of its pictures; it is added like an upload (crop it and remove the background with the photo tools). The server reads the page (share picture, product data, big gallery pictures) and fetches the picture itself (`src/importer.js`): only http/https links on normal ports, no private or local addresses (checked on every connection and redirect), size limits, and pictures are re-encoded, so nothing but pixels reaches the editor. Some big sites block automatic reading; customers then save the picture or take a screenshot and upload it.

Before a design with an imported picture goes in the cart, the customer must tick **"I own this design or have permission to print it"**. The confirmation and the source link are saved with the design and the order; the print queue shows an **Imported** badge and where it came from. Rights holders can send a takedown request from **/rights** (linked in every footer); requests are saved and emailed to `ADMIN_EMAIL` when email is set up. The shop remains responsible for what it prints: check imported brand logos before printing.

## Printing houses

Admin → **Printing houses** tab: save each printing house (name, email and/or WhatsApp number, how you usually send), and pick which one prints each product.

On any item in the print queue, **Send to printing house** opens a small form: the product's printing house is chosen already, with its usual channel and two files ticked (print-ready PDF and the customer-design preview PDF). Any other print file can be ticked too, and a note added.

- **Email** goes through Brevo (`BREVO_API_KEY`, `MAIL_FROM`). Files are attached when they total 10 MB or less, and download links are always in the message.
- **WhatsApp** opens WhatsApp (web, desktop or phone) with the message ready to send: the job details and download links. WhatsApp links cannot carry attachments.
- Download links (`/dl/...`) are signed, need no sign-in, and stop working after 30 days. The customer's name, phone and address are not sent.
- Every send is recorded on the item ("Sent to … by … · date").

## Accounts (prices, costs, profit)

**Price switch:** `PRICE_FACTOR` in Hostinger's environment variables scales every selling price in `src/products.js` (base prices, size and pack surcharges, extra sides, embroidery, lamination), each rounded to the nearest 10 EGP, for example `0.5` for a half-price sale. It defaults to 1 (the prices as written). Prices changed in the admin below are not scaled; shipping is not affected.

**Small packs (from 1 copy):** brochures, booklets, menus, postcards, folded cards, gift vouchers, bookmarks and folders also come as 1, 10 or 25 copies (sizes marked `smallPack` in `src/products.js`), priced by the owner's rule: 1 copy = 5×, 10 copies = 2×, 25 copies = 1.25× the smallest regular pack's price per copy. They are written as an amount off the product's price, but when the owner changes the product's price in the admin each small pack keeps its share of it (rounded to whole EGP, never under 1 EGP), so a lower price never makes a pack free or negative (`src/accounting.js` → `packSurcharge`). A price the owner sets for the pack itself (another amount typed in its box, read against the product price being saved) wins and is saved as the pack's own final price (`packs: { sizeId: EGP }` in the saved prices, `cleanPricing` / `applyPricing`): it stays the same whatever the product's price does later, so changing the product's price never makes it dearer or cheaper and is never refused because of it. Both admin price screens send every size as shown: a pack left as shown stays as it was (at its own price, or following the product's price), and emptying its box makes it follow the product's price again. Own pack prices saved before this as an amount added to the product's price are read at the product price saved with them (the price the shop was charging) and saved as the pack's own price the next time the product's prices are saved. With `PRICE_FACTOR` a pack's built-in price is scaled, so it stays cheaper than the regular pack. In Accounts → Prices a size's cost can be negative (taken off the blank cost: one bookmark doesn't use up a pack of 25) and an item's cost never goes below 0; the unit profit shown is for the first regular pack. **The back side** of a pack smaller than the product's standard one costs its share of the back-side price, like the pack's own price (1 postcard at 20 EGP: back side 5 EGP, not the standard 50-card pack's 60; rounded to whole EGP, at least 1); the standard pack and bigger ones keep the flat back-side price (`sidePriceFor` in `src/products.js`, the editor's `sidePrice`; owner's decision, 25 Nov).

**Photo prints** (`/photos`, product `photoprints`, kind `photoset`): the customer picks up to 100 photos at once, chooses glossy or matte paper, borderless or a 4 mm white border, and per photo the size (10×15 / 13×18 / 15×20 / 20×30 cm at 15 / 25 / 35 / 70 EGP), the copies (1–50), portrait or landscape and the crop. The browser makes a print-ready JPEG of each at 300 DPI (border drawn in) and uploads them one by one (`POST /api/photosets`, then the usual `PUT /api/designs/:id/files/...` and `complete`); the whole set is one cart item. The proof shows a contact sheet and warns about photos under 150 DPI. In the admin the set downloads as one ZIP sorted into a folder per size, each file named `<photo>_<size>_x<copies>.jpg`, with `list.csv` and a `README.txt` (paper, border, prints per size). Costs per print can be set per size in Accounts → Prices.

**Delivery:** the shop's marketing copy (home, product pages) mentions only express delivery within 2 business days; at checkout the customer picks standard (5 business days, the usual shipping) or ⚡ express (2 business days, +100 EGP on top of the shipping, even when shipping is free). Business days are Sunday to Thursday, counted from the day after the order (public holidays are not counted out). The order keeps the speed and the expected day (`delivery: { speed, days, fee, by }`); the order page, invoice, admin (⚡ badge) and the order emails/WhatsApp show it. `EXPRESS_FEE` in the environment changes the fee.

Admin → **Accounts** tab:

- **Prices & costs**: for every product, the selling price, the price of each extra side and per-size price additions (these change the shop right away; saved in `db.pricing` over the defaults in `src/products.js`), and what a piece costs you: the blank product (plus extra per size), printing for the first side and for each extra side, and packaging/other. Shows the profit and margin per piece.
- **Profit & orders**: for this month, last month, this year, all time or chosen dates: sales, product + printing costs, shipping cost (a usual cost per order, changeable per order), gross profit and margin, expenses, net profit, and what was shipped (cash due/collected) vs not shipped yet. Profit by product and by order. Any item's real cost can be entered on the order. Export to CSV for Excel.
- **Expenses**: rent, ads, salaries… by date and type, counted in net profit.

Each new order item keeps a copy of its costs on the order day, so changing costs later does not rewrite past profit.

## Security

**CAPTCHA (Cloudflare Turnstile):** on when `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set in Hostinger's environment variables (a free Cloudflare account → Turnstile → Add widget for `ebda3.me` and `www.ebda3.me`, Managed mode). It guards sign-up, sign-in, "forgot password" (when not signed in) and placing an order. Most customers see nothing: Cloudflare checks in the background and shows a tick box only when it is unsure. The order's token is checked last, after the prices and coupon, so a changed price doesn't use it up. If Cloudflare can't be reached, or the secret key is wrong, requests are let through and the server log says so (an outage must not stop orders; rate limits still apply). Code: `src/captcha.js`; the pages with the widget (`cart`, `account`) may load `challenges.cloudflare.com`.

- **Admin sign-in:** the password is sent once to `POST /api/admin/login`, which returns a session token (12 hours, kept in the tab's `sessionStorage`, sent as `Authorization: Bearer`). Sign out ends it on the server. 5 wrong passwords lock that visitor out for 15 minutes, and 50 wrong passwords per hour from everyone lock sign-in for the hour. These counts, and the customer sign-in limits, are kept in `.signin-limits.json` in the data folder, so every copy of the app shares them and a restart doesn't reset them (keys are hashed: no IP addresses in the file). The dashboard warns when `ADMIN_PASSWORD` is easy to guess. Sessions are kept in memory, so a restart or deploy signs you out.
- **Headers:** every page has a Content-Security-Policy that only runs this site's own scripts (inline scripts allowed by hash, no `eval`, no outside scripts), and blocks framing (clickjacking), plugins and form posts elsewhere. Other responses get a "nothing runs" policy. Also `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (no camera/mic/location), `Cross-Origin-Opener-Policy`, and HSTS over HTTPS.
- **Rate limits (per visitor):** new designs 30 per 10 min / 200 a day (3000 a day for the whole shop), orders 5 per 10 min / 20 a day, share links 10 a minute / 60 a day, order alerts (WhatsApp/email) at most 30 an hour for the whole shop, plus the existing limits on AI, photo boost, proofs and feedback.
- **AI / EPS uploads:** the editor accepts Illustrator (.ai) and EPS files. The server draws the first page to a transparent PNG with Ghostscript compiled to WebAssembly (`@okathira/ghostpdl-wasm`, AGPL-3.0, unmodified) in a worker thread: in-memory files only, `-dSAFER`, stopped after 45 s, two at a time, rate limited per visitor (`src/artwork.js`). AI files must be saved "PDF compatible" (Illustrator's default). The drawing itself gets the size the editor asks for (`x-max-px`), not its page: Ghostscript first finds the box around what is drawn (no picture), then draws only that part, and again more finely when a white page or artboard is cleared around a smaller logo (at most 12000 DPI, and a huge page at most 500,000 pixels across). A page that is mostly a photo keeps the photo's own pixels (never less than the whole page fitted into that size, as before), so the editor's resolution check stays true for it.
- **Uploads:** file names, types, sizes and signatures are checked; SVG print files are cleaned of scripts, event handlers, embedded web pages and outside links; image processing has pixel limits. Print files are admin-only downloads.
- **Clean-up:** every 6 hours, designs that were never ordered are deleted after 30 days (unfinished uploads after 24 hours) and share links after 120 days. Ordered designs are never deleted.
- **Cookies:** only the customer sign-in cookie (HttpOnly, Secure, SameSite=Lax) and the short Google/Facebook sign-in state cookie. Every change made with the cookie needs a JSON body, which another site's form can't send, so cross-site request forgery doesn't apply; admin requests need the token header.
- **Links in emails** (password reset, order alerts, proofs, shipping) use `SITE_URL`, or the request's host only when it is one of the shop's own (`ALLOWED_HOSTS`, default `ebda3.me,www.ebda3.me`), so a forged Host header can't send customers to another site. Reset emails: at most 3 an hour per account.
- **Daily security review:** a scheduled review checks the whole shop every night, fixes clear low-risk problems with tests, and reports the rest.

## Laser engraving and cutting

Twelve laser products (category `laser` in `src/products.js`; production files from `src/laser.js`: an engraving bitmap and LightBurn cut lines). Their "colours" are materials, each with the tone the engraving takes on it (`ink`), and their ready designs are drawn for each one's print area in `src/library-packs/laser.js`.

- **Engraved pen** (`engrpen`, 25 Nov): black, navy and gold coated metal (the engraving shows the bright metal under the coat) and bamboo (burnt dark), engraved along the barrel (45 mm); 1, 10, 25 or 50 pens (180, 135, 120, 110 EGP each).
- **Engraved leather wallet** (`engrwallet`, 25 Nov): a bifold in black, brown, tan or burgundy, engraved on the front (7 × 4 cm); 1, 5 or 10 (450, 410, 400 EGP each).
- Packs of these two count pieces ("الإجمالي ١١ قطعة"), not copies as cards do (`unit: 'piece'` on their sizes). Four ready designs each (names, monogram, "thank you, teacher", "the best dad", his name and your date). Prices are starting points: change them in the dashboard.

## Photo mockups

Each photo is a white (or natural) product on a light background, plus a mask from background removal. To add or replace one:

1. Save the photo as `public/mockups/photos/<name>.webp`, 1000 px wide, and its mask as `<name>-mask.png` (white = product).
2. Add an entry to `public/js/photo-mockups.js` with the print rectangle in photo pixels and the warp type. Set `base` if the product in the photo isn't white. The same rectangle places the photo in the editor, so the print area lines up with the product.
