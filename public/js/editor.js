/* Product design editor built on Fabric.js.
 *
 * The canvas works in the 500 x 600 mockup coordinate space and is zoomed to
 * fit the screen. Each product side keeps its own list of objects and its own
 * undo history. On "Add to cart" every designed side is exported twice:
 *   - a transparent, print-ready PNG of just the print area at ~150 DPI
 *   - a mockup preview PNG for the cart, order page and production queue
 */
(async function () {
  'use strict';

  const W = 500;
  const H = 600;
  const TARGET_DPI = 300;
  const MAX_PRINT_PIXELS = 16e6; // iPhone Safari's canvas limit is 16.7 million pixels
  const MAX_PRINT_SIDE = 8000;
  const MAX_UPLOAD_PX = 3000;
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const MAX_VECTOR_BYTES = 40 * 1024 * 1024;
  const HISTORY_LIMIT = 60;
  const SNAP_PX = 7;
  const EXTRA_PROPS = ['name', 'selectable', 'evented', 'curve', 'mask', 'maskBorder', 'maskBorderColor', 'lockRatio', 'bgShape', 'textFx', 'fxBase', 'boosted', 'importSource', 'mergeFit', 'pdfSrc', 'printSrc', 'printPx'];
  const $ = (id) => document.getElementById(id);
  const { esc, money, toast, t, tr } = POD;
  const D = window.POD_DESIGN;
  const isText = (o) => o && (o.type === 'i-text' || o.type === 'text' || o.type === 'textbox');

  // ---------- Fabric defaults ----------
  fabric.Object.prototype.objectCaching = false;
  fabric.enableGLFiltering = false; // canvas filters work on images of any size
  Object.assign(fabric.Object.prototype, {
    transparentCorners: false,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#ca3d1a',
    borderColor: '#ca3d1a',
    cornerSize: 12,
    touchCornerSize: 28,
    cornerStyle: 'circle',
    borderScaleFactor: 1.5,
    padding: 4,
    originX: 'center',
    originY: 'center',
  });
  // Bigger handles for fingers.
  const COARSE = window.matchMedia('(pointer: coarse)').matches;
  if (COARSE) Object.assign(fabric.Object.prototype, { cornerSize: 18, touchCornerSize: 48, padding: 8 });
  if (COARSE && fabric.Object.prototype.controls && fabric.Object.prototype.controls.mtr) fabric.Object.prototype.controls.mtr.offsetY = -46;
  const MOBILE = window.matchMedia('(max-width: 820px)');

  // ---------- Load catalog and (optionally) a saved design ----------
  let catalog;
  try {
    catalog = await POD.loadCatalog();
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  // Books and photo prints have their own pages, not the editor.
  const products = catalog.products.filter((x) => !x.kind);
  {
    const asked = catalog.products.find((x) => x.id === new URLSearchParams(location.search).get('product'));
    if (asked && asked.kind === 'book') location.replace('/book?b=' + encodeURIComponent(asked.book));
    if (asked && asked.kind === 'photoset') location.replace('/photos');
  }
  const params = new URLSearchParams(location.search);
  // Colours and sizes the product manager marked sold out stay listed but can't be picked.
  const canPick = (x) => x && !x.soldOut;
  const ED_TEXT = {
    'ed.soldOut': ['Sold out', 'خلصان'],
    'ed.sizeSwitched': ['That size is sold out in this colour, so we picked the next size.', 'المقاس ده خلصان في اللون ده، فاخترنالك المقاس اللي بعده.'],
    'ed.soldOutPick': ['This one is sold out right now. Please pick another.', 'ده خلصان دلوقتي. اختار غيره.'],
    'ed.designGone': ['This ready design isn\'t in the shop right now. Pick another one, or start your own.', 'التصميم الجاهز ده مش متاح دلوقتي. اختار تصميم تاني أو ابدأ تصميمك.'],
    'ed.productGone': ['This product isn\'t available right now, so we opened another one. You can pick a different product from the list.', 'المنتج ده مش متاح دلوقتي، ففتحنالك منتج تاني. تقدر تختار منتج غيره من القائمة.'],
    'ed.productPaused': ['{name} isn\'t available right now ({back}), so we opened another product. You can pick a different one from the list.', 'المنتج «{name}» مش متاح دلوقتي ({back})، ففتحنالك منتج تاني. تقدر تختار منتج غيره من القائمة.'],
    'ed.productRetired': ['{name} is no longer sold, so we opened a similar product: {other}.', 'المنتج «{name}» مبقاش بيتباع، ففتحنالك منتج شبهه: {other}.'],
    'ed.productRetiredOther': ['{name} is no longer sold, so we opened another product: {other}. You can pick a different one from the list.', 'المنتج «{name}» مبقاش بيتباع، ففتحنالك منتج تاني: {other}. تقدر تختار منتج غيره من القائمة.'],
  };
  const tEd = (k, vals) => (ED_TEXT[k] ? ED_TEXT[k][POD.lang === 'ar' ? 1 : 0].replace(/\{(\w+)\}/g, (m, v) => (vals && vals[v] != null ? vals[v] : m)) : t(k, vals));
  const firstPick = (list) => list.find(canPick) || list[0];
  /** A size's add-on price: "+50 ج.م." or "−100 ج.م." (a cheaper size). */
  const addOn = (v) => `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`;
  // Stock per colour and size: a size can be sold out in one colour only.
  const comboOut = (p, colorId, sizeId) => Boolean(p && p.outCombos && p.outCombos.includes(`${colorId}|${sizeId}`));
  const sizeOk = (p, colorId, z) => canPick(z) && !comboOut(p, colorId, z.id);
  // A product the shop doesn't sell right now isn't in the list: say so, then show another one. Paused or
  // sold out: "not available right now (back soon)". Stopped selling: a similar one (the same kind of
  // product). Gives the product to open instead (null: the first one, as for an old link).
  const missing = async (id) => {
    if (!id || products.some((p) => p.id === id)) return null;
    const info = await POD.productState(id);
    const name = info.name ? tr(info.name) : '';
    const like = info.state === 'retired' ? POD.similarProducts({ products }, info, 1) : null;
    const instead = (like && like.list[0]) || null;
    const back = POD.backText(info);
    const msg = !name ? tEd('ed.productGone')
      : instead ? tEd(like.same ? 'ed.productRetired' : 'ed.productRetiredOther', { name, other: tr(instead.name) })
        : back ? tEd('ed.productPaused', { name, back }) : tEd('ed.productGone');
    setTimeout(() => toast(msg, 'error'), 400);
    return instead;
  };
  const insteadOf = await missing(params.get('product'));
  /** A saved or shared design's options ({ optionId: { id } }, the first choice left out) as the editor keeps them. */
  const optionsFrom = (kept) => Object.fromEntries((st.product.options || []).map((o) => {
    const id = kept && kept[o.id] && (kept[o.id].id || kept[o.id]);
    return [o.id, o.choices.some((c) => c.id === id) ? id : o.choices[0].id];
  }));
  /**
   * Booklets: the binding is chosen once, when the booklet is opened, from the shop's language then
   * (English reads left to right: bound on the left; Arabic on the right). It stays as chosen: switching
   * language later never changes what is ordered or how the cover is drawn.
   */
  function seedBinding(product = st.product) {
    const bind = (product.options || []).find((o) => o.id === 'binding');
    if (!bind || bind.choices.some((c) => c.id === (st.options || {}).binding)) return;
    const left = POD.lang === 'en' && bind.choices.find((c) => c.id === 'left');
    st.options = { ...(st.options || {}), binding: (left || bind.choices[0]).id };
  }

  const st = {
    product: products.find((p) => p.id === params.get('product')) || insteadOf || products[0],
    options: {}, // product options such as business-card lamination: { optionId: choiceId }
    colorId: null,
    sizeId: null,
    side: null,
    designs: {}, // sideId -> serialized objects
    history: {}, // sideId -> { stack: [json], i }
    offsets: {}, // sideId -> { dx, dy }: where the customer moved the print area
    pattern: null, // fabric products: { repeat, tileCm } (how the tile repeats, and its size)
    method: 'print', // (older drafts) 'embroidery': the front was embroidered; now the embroidery is its own layer, st.designs.emb
    editingCartIndex: null,
    revise: null, // { orderId, itemId }: a new version of an ordered item the shop sent back for changes
    shopEdit: null, // { orderId, itemId, baseDesignId, owner }: the shop's own edit of an ordered item (dashboard, Review)
    editingDesignId: null,
    preview: false,
    exporting: false,
    silent: false,
    dirty: false,
    zoom: 1, // relative to "fit to screen"
    guides: null,
    mergeList: null, // name list: { columns, rows, total, truncated, fileName }
    mergeRow: 0, // the row shown in the preview
    mergePreview: false, // the canvas shows a row's real values (editing paused)
    qty: null, // pieces: { colorId: { sizeId: n } } (one artwork in several colours / sizes)
  };

  if (params.get('design')) {
    try {
      const saved = await POD.api('/api/designs/' + encodeURIComponent(params.get('design')));
      const instead = await missing(saved.productId);
      st.product = products.find((p) => p.id === saved.productId) || instead || st.product;
      st.colorId = saved.color.id;
      st.sizeId = saved.size.id;
      st.sizePicked = true; // a saved design or cart item: its size was chosen
      if (saved.method === 'embroidery') st.method = 'embroidery'; // see below: older designs embroidered the front itself
      st.options = optionsFrom(saved.options);
      if (saved.quantities) st.qty = Object.fromEntries([...new Set(saved.quantities.map((l) => l.color.id))].map((c) => [c, Object.fromEntries(saved.quantities.filter((l) => l.color.id === c).map((l) => [l.size.id, l.qty]))]));
      if (saved.mergeList) st.mergeList = { columns: saved.mergeList.columns, rows: saved.mergeList.rows, total: saved.mergeList.rows.length, truncated: false, fileName: '' };
      // Designs from before embroidery was a layer: their stitched front is the embroidery layer now.
      const host = st.product.embroidery && st.product.embroidery.side;
      const editorSides = { ...saved.editor };
      if (saved.method === 'embroidery' && host && !editorSides.emb && editorSides[host] && saved.embSide !== 'emb') {
        editorSides.emb = editorSides[host];
        delete editorSides[host];
      }
      for (const [sideId, data] of Object.entries(editorSides)) {
        st.designs[sideId] = await blobifyImages(data.objects || []);
        if (data.offset) st.offsets[sideId] = data.offset;
        if (data.pattern) st.pattern = data.pattern;
        carryPlaced(sideId, data.area);
      }
      const idx = Number(params.get('cart'));
      const cart = POD.getCart();
      // From the order page's "Edit the design and send it again": ?revise=<order id>.<item id>&k=<the order's key>.
      const rv = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/i.exec(params.get('revise') || '');
      // (Or the item's own edit link from the shop or the proof page: ?rt=…, no order key needed.)
      const rt = /^[A-Za-z0-9_-]{20,40}$/.test(params.get('rt') || '') ? params.get('rt') : '';
      if (rv) st.revise = { orderId: rv[1], itemId: rv[2], key: POD.orderKey(rv[1], params.get('k')), rt };
      // The shop's own edit, opened from the dashboard's Review tab: ?shopEdit=<order id>.<item id> (signed in there).
      const se = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/i.exec(params.get('shopEdit') || '');
      if (se && !rv) st.shopEdit = { orderId: se[1], itemId: se[2], baseDesignId: saved.id, owner: false };
      // (A product the shop doesn't sell now opens another one: that is a new design, not this cart item.)
      if (!rv && !se && st.product.id === saved.productId && params.get('cart') !== null && Number.isInteger(idx) && cart[idx] && cart[idx].designId === saved.id) {
        st.editingCartIndex = idx;
        st.editingDesignId = saved.id;
      }
    } catch (e) {
      toast(t('msg.openFailed', { msg: e.message }), 'error');
    }
  }
  // Drafts: designs started from the products page are kept in this browser
  // until they go into the cart (editing a cart item never touches them).
  // Opened from the ready-made designs shop: load that design (and colour) as a new draft.
  let libraryDesign = null;
  let libraryError = null;
  if (!params.get('design') && params.get('library')) {
    try {
      libraryDesign = await POD.api('/api/library/' + encodeURIComponent(params.get('library')));
      // The customer's own name(s) typed on the ready-design page (/design: &name=…, one per sample name, in order).
      if (params.has('name') && D.withNames) libraryDesign = D.withNames(libraryDesign, params.getAll('name'));
      if (params.get('color')) st.colorId = params.get('color');
    } catch (e) {
      libraryError = e; // said after the drafts: the customer's own version may still be here
    }
  }
  let fromShare = false;
  if (!params.get('design') && /^[A-Za-z0-9_-]{12}$/.test(params.get('share') || '')) {
    try {
      const shared = await POD.api('/api/shares/' + encodeURIComponent(params.get('share')) + '/design');
      const instead = await missing(shared.productId);
      st.product = products.find((p) => p.id === shared.productId) || instead || st.product;
      if (st.product.id === shared.productId) st.options = optionsFrom(shared.options);
      st.colorId = shared.color;
      st.sizeId = shared.size; // (the size is still asked: the friend may not have chosen one)
      for (const [sideId, data] of Object.entries(shared.editor || {})) {
        if (st.product.sides.some((sd) => sd.id === sideId) || (sideId === 'emb' && st.product.embroidery)) {
          st.designs[sideId] = await blobifyImages(data.objects || []);
          if (data.offset) st.offsets[sideId] = data.offset;
          if (data.pattern) st.pattern = data.pattern;
          carryPlaced(sideId, data.area);
        }
      }
      fromShare = true;
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  // Reading window.indexedDB throws when the browser blocks site data: drafts are then simply off.
  const idbOk = (() => { try { return Boolean(window.indexedDB); } catch (e) { return false; } })();
  const draftMode = !params.get('design') && !!(POD.drafts && idbOk);
  let restoredDraft = false;
  let bootDone = false; // autosave starts once the editor has loaded
  // The ready-made design this draft started from (kept in the draft), so opening that design
  // again brings back the customer's own version instead of the original.
  st.libraryId = null;
  let draft = draftMode ? await POD.drafts.get(st.product.id) : null;
  // The customer's own saved design for this product, kept while something else opens here (a shared design,
  // another ready design): it is replaced only once that one is changed, never just by looking (QA 25 Nov).
  let heldDraft = null;
  if (fromShare && draft) {
    heldDraft = draft;
    draft = null;
  }
  // A quick copy written while leaving the page (the browser may close before the real save finishes):
  // used when it is newer than the saved draft and belongs to the same customer.
  if (draftMode && !fromShare) {
    try {
      const raw = localStorage.getItem('pod-rescue:' + st.product.id);
      const r = raw && JSON.parse(raw);
      let me = '';
      try { const v = localStorage.getItem('pod-acct'); me = v && v !== '1' ? v : ''; } catch (e) { /* private mode */ }
      if (r && r.designs && r.acct === me && (!draft || !(Date.parse(draft.savedAt) >= r.at))) draft = { ...r, savedAt: new Date(r.at).toISOString() };
      else if (r) localStorage.removeItem('pod-rescue:' + st.product.id);
    } catch (e) { /* unreadable: ignored */ }
  }
  if (!(draft && draft.designs && Object.values(draft.designs).some((o) => o && o.length))) draft = null;
  // The name(s) typed on the ready-design page this time: another name than the draft's opens the design with it (the
  // draft is kept, as for another design); the same ones (a reload) bring the draft back. QA 25 Nov.
  const typedNames = params.has('name') ? params.getAll('name').join('\n') : null;
  if (draft && libraryDesign) {
    if (draft.library && draft.library === params.get('library') && (typedNames === null || (draft.libraryNames || null) === typedNames)) libraryDesign = null;
    else {
      // Another design (or one from scratch): the ready-made design opens as asked, the saved one is kept.
      heldDraft = draft;
      draft = null;
    }
  }
  if (libraryDesign) { st.libraryId = params.get('library'); st.libraryNames = typedNames; }
  if (draft) {
    st.libraryId = typeof draft.library === 'string' ? draft.library : null;
    st.libraryNames = typeof draft.libraryNames === 'string' ? draft.libraryNames : null;
    st.colorId = draft.colorId;
    st.sizeId = draft.sizeId;
    // Drafts from before embroidery was a layer: their stitched front is the embroidery layer now.
    const host = st.product.embroidery && st.product.embroidery.side;
    const dDesigns = { ...draft.designs };
    const dOffsets = { ...(draft.offsets || {}) };
    if (draft.method === 'embroidery' && host && !dDesigns.emb && dDesigns[host]) {
      dDesigns.emb = dDesigns[host];
      delete dDesigns[host];
      if (dOffsets[host]) dOffsets.emb = dOffsets[host];
      delete dOffsets[host];
    }
    const known = (id) => st.product.sides.some((s) => s.id === id) || (id === 'emb' && Boolean(st.product.embroidery));
    for (const [sideId, objs] of Object.entries(dDesigns)) {
      if (known(sideId)) st.designs[sideId] = await blobifyImages(objs || []);
    }
    for (const [sideId, o] of Object.entries(dOffsets)) if (known(sideId)) st.offsets[sideId] = o;
    for (const sideId of Object.keys(dDesigns)) if (known(sideId)) carryPlaced(sideId, draft.areas && draft.areas[sideId]);
    if (draft.pattern) st.pattern = draft.pattern;
    if (draft.options && typeof draft.options === 'object') st.options = { ...draft.options };
    if (st.product.merge && draft.mergeList && draft.mergeList.columns && draft.mergeList.rows) st.mergeList = draft.mergeList; // (clothing no longer takes name lists)
    if (draft.qty && typeof draft.qty === 'object') st.qty = draft.qty;
    if (draft.sizePicked) st.sizePicked = true;
    restoredDraft = true;
  }
  // A colour picked on the product page (?color=) wins over the draft's; a saved design keeps its own
  // (and so does a restored draft of a ready-made design: the link carries the design's first colour).
  if (!params.get('design') && !(restoredDraft && st.libraryId) && canPick(st.product.colors.find((c) => c.id === params.get('color')))) st.colorId = params.get('color');
  st.colorId = canPick(st.product.colors.find((c) => c.id === st.colorId)) ? st.colorId : firstPick(st.product.colors).id;
  seedBinding(); // a new booklet: bound on the side its language reads from
  // A ready design no longer in the shop: said only when the customer's own version of it isn't here.
  if (libraryError && !restoredDraft) toast(libraryError.status === 404 ? tEd('ed.designGone') : libraryError.message, 'error');
  if (!params.get('design') && canPick(st.product.sizes.find((z) => z.id === params.get('size')))) {
    st.sizeId = params.get('size');
    st.sizePicked = true;
  }
  st.sizeId = sizeOk(st.product, st.colorId, st.product.sizes.find((s) => s.id === st.sizeId)) ? st.sizeId : (st.product.sizes.find((z) => sizeOk(st.product, st.colorId, z)) || firstPick(st.product.sizes)).id;
  st.side = st.product.sides.find((s) => (st.designs[s.id] || []).length)?.id || st.product.sides[0].id;
  /** Fabric products: a valid { repeat, tileCm } for this product (or null for other products). */
  const REPEATS = ['straight', 'halfdrop', 'halfbrick', 'mirror'];
  function normPattern(product, p) {
    if (!product.pattern) return null;
    const tileCm = Number(p && p.tileCm);
    return { repeat: REPEATS.includes(p && p.repeat) ? p.repeat : 'straight', tileCm: product.pattern.tiles.includes(tileCm) ? tileCm : product.pattern.tile };
  }
  st.pattern = normPattern(st.product, st.pattern);
  // ---------- Embroidery: a layer of its own on the side it is stitched on ----------
  // The front can carry a print and embroidery together: the embroidery is
  // edited as the side 'emb' (its own smaller area, thread checks and stitch
  // file); the print is the front itself. Each shows on the shirt while the
  // other is being edited (the "ghost", drawn under the artwork).
  const EMB = 'emb';
  st.method = 'print';
  /** The product's embroidery (null when it can't be embroidered). */
  const emb = () => st.product.embroidery || null;
  /** The product sides (tabs); the embroidery layer is reached from its side with Print / Embroidery. */
  const activeSides = () => {
    // Booklets: the pages this size prints (front cover, inside pages, back cover).
    if (!st.product.paged) return st.product.sides;
    const all = st.product.sides;
    const size = st.product.sizes.find((z) => z.id === st.sizeId) || st.product.sizes[0];
    const n = Math.min(all.length, size.pages || all.length);
    return [all[0], ...all.slice(1, n - 1), all[all.length - 1]];
  };
  /** Every layer that can carry artwork: the sides (pages), and the embroidery layer. */
  const allSides = () => (emb() ? [...activeSides(), baseSide(EMB)] : activeSides());
  /** What a draft keeps: every layer, and on booklets the pages a smaller page count hides too (they come back). */
  const keptSides = () => (st.product.paged ? [...st.product.sides, ...(emb() ? [baseSide(EMB)] : [])] : allSides());
  /** Booklets: pages a page count would leave out that have something on them. */
  const designedBeyond = (sizeId) => {
    if (!st.product.paged) return [];
    const z = st.product.sizes.find((x) => x.id === sizeId);
    const n = z && z.pages ? z.pages : st.product.sides.length;
    const keep = new Set([...st.product.sides.slice(0, Math.max(1, n - 1)), st.product.sides[st.product.sides.length - 1]].map((sd) => sd.id));
    return st.product.sides.filter((sd) => !keep.has(sd.id) && (sd.id === st.side ? canvas.getObjects().some((o) => !o.excludeFromExport) : (st.designs[sd.id] || []).length));
  };
  /** Is this the embroidery layer? */
  const embHere = (id = st.side) => Boolean(emb() && id === EMB);
  /** The product side a layer is on (the embroidery: its side). */
  const hostOf = (id = st.side) => (id === EMB && emb() ? emb().side : id);
  /** Does the design have embroidery? */
  const usesEmb = () => Boolean(emb()) && (st.side === EMB ? canvas.getObjects().length : (st.designs[EMB] || []).length) > 0;
  if (params.get('method') === 'embroidery' && emb()) st.side = EMB;
  else if (!st.product.sides.some((s) => (st.designs[s.id] || []).length) && (st.designs[EMB] || []).length && emb()) st.side = EMB;

  // On garments and bags the print area can be moved (st.offsets, in mockup units);
  // sideDef() gives the side with its print area where the customer put it.
  // Garment sizes: the print is the same size in cm on every size, so on a
  // bigger garment the print box is smaller (scaled from just below the collar).
  const embLayers = new Map();
  const baseSide = (id = st.side) => {
    if (id === EMB) {
      if (!emb()) return undefined;
      const host = st.product.sides.find((s) => s.id === emb().side);
      const key = st.product.id;
      if (!embLayers.has(key)) embLayers.set(key, { ...host, id: EMB, host: host.id, name: { en: `${host.name.en} embroidery`, ar: `تطريز ${host.name.ar}` } });
      return embLayers.get(key);
    }
    return st.product.sides.find((s) => s.id === id);
  };
  function areaFor(product, sideId, sizeId, offset) {
    const a = product.sides.find((s) => s.id === sideId).printArea;
    const size = product.sizes.find((z) => z.id === sizeId);
    const f = product.photoChestCm && size && size.chestCm ? product.photoChestCm / size.chestCm : 1;
    const w = f === 1 ? a.w : Math.round(a.w * f * 10) / 10;
    const h = f === 1 ? a.h : Math.round(a.h * f * 10) / 10;
    const x = f === 1 ? a.x : Math.round((a.x + a.w / 2 - w / 2) * 10) / 10;
    return { ...a, x: x + ((offset && offset.dx) || 0), y: a.y + ((offset && offset.dy) || 0), w, h, ...(a.rx && f !== 1 ? { rx: a.rx * f } : {}) };
  }
  /**
   * A side saved against another print area (POD.placedArea: hoodie fronts before 25 Nov 2026, whose area started
   * at the collar) is carried into today's, at its standard spot: the customer sees it there before saving again.
   */
  function carryPlaced(sideId, area) {
    const side = st.product.sides.find((s) => s.id === sideId);
    if (!side || !(st.designs[sideId] || []).length) return; // (the embroidery layer's spot never moved)
    const o = st.offsets[sideId] || null;
    const from = POD.placedArea(st.product, side, st.sizeId, { area, offset: o });
    const now = areaFor(st.product, sideId, st.sizeId, o);
    if (['x', 'y', 'w', 'h'].every((k) => Math.abs(from[k] - now[k]) < 0.05)) return;
    st.designs[sideId] = remap(st.designs[sideId], from, areaFor(st.product, sideId, st.sizeId, null));
    delete st.offsets[sideId];
  }
  /** The standard print area a side's objects were placed in, kept with every save (see carryPlaced). */
  const xywh = (a) => ({ x: a.x, y: a.y, w: a.w, h: a.h });
  const placedAreas = () => Object.fromEntries(st.product.sides.map((s) => [s.id, xywh(areaFor(st.product, s.id, st.sizeId, null))]));
  const sizedSides = new Map();
  const sideDef = (id = st.side) => {
    const s = baseSide(id);
    if (!s) return s;
    // Embroidery: its own smaller area (left chest, cap front...), movable like a print.
    const e = emb();
    if (e && s.id === EMB) {
      const eo = st.offsets[s.id];
      const key = `emb:${st.product.id}:${s.id}:${eo ? eo.dx : 0}:${eo ? eo.dy : 0}`;
      const printArea = { ...e.area, x: e.area.x + ((eo && eo.dx) || 0), y: e.area.y + ((eo && eo.dy) || 0) };
      if (!sizedSides.has(key)) sizedSides.set(key, { ...s, printArea, printWidthIn: e.widthIn, printHeightIn: e.heightIn, bleedIn: 0, safeIn: 0.06 });
      return sizedSides.get(key);
    }
    const o = st.offsets[s.id];
    const key = `${st.product.id}:${s.id}:${st.sizeId}:${o ? o.dx : 0}:${o ? o.dy : 0}:${st.pattern ? st.pattern.tileCm : ''}`;
    if (!sizedSides.has(key)) {
      const a = areaFor(st.product, s.id, st.sizeId, o);
      const same = a.x === s.printArea.x && a.y === s.printArea.y && a.w === s.printArea.w && a.h === s.printArea.h;
      // Sizes that print bigger or smaller (posters, cards, signs): same drawing area, different inches.
      const size = st.product.sizes.find((z) => z.id === st.sizeId);
      // Fabric patterns: the tile prints at the chosen size (cm).
      const k = ((size && size.printScale) || 1) * (st.pattern ? st.pattern.tileCm / 2.54 / s.printWidthIn : 1);
      const physical = k === 1 ? {} : { printWidthIn: s.printWidthIn * k, printHeightIn: (s.printHeightIn || 0) * k };
      sizedSides.set(key, same && k === 1 ? s : { ...s, ...physical, printArea: same ? s.printArea : a });
    }
    return sizedSides.get(key);
  };
  const area = (id) => sideDef(id).printArea;
  const color = () => st.product.colors.find((c) => c.id === st.colorId);
  // ---------- Laser: the design in the material's one tone ----------
  // A laser can't print colours: what it engraves (or cuts) shows as the
  // material's own engraved tone (`ink` of the chosen material). Every element
  // is drawn in that tone, photos as the laser would burn them; cut pieces get
  // a thick outline round the letters (`bridgeMm`) so they join into one piece.
  const laser = () => st.product.laser || null;
  const inkOf = () => (color() && color().ink) || '#000000';
  const lightEngrave = () => POD.luminance(inkOf()) > POD.luminance((color() && color().hex) || '#ffffff');
  function engraveFilters(o) {
    const keep = (o.filters || []).filter((f) => f && !['Engrave', 'Grayscale', 'Sepia'].includes(f.type));
    return [...keep, new fabric.Image.filters.Engrave({ ink: inkOf(), light: lightEngrave() })];
  }
  function laserTone(o, { images = true } = {}) {
    const L = laser();
    if (!L || !o || o.name === '__cropper') return;
    const bridge = L.kind === 'cut' ? ((L.bridgeMm || 0) / 25.4) * rects().u : 0;
    window.POD_FX.laserTone(o, { ink: inkOf(), light: lightEngrave(), bridge, images });
  }
  /** After the material changes: everything takes the new tone. */
  function retoneAll() {
    if (!laser()) return;
    canvas.getObjects().forEach(laserTone);
    canvas.requestRenderAll();
    commit();
  }
  /** Cut products: how many separate pieces the cut would make (counted on a small render). */
  let cutTimer = null;
  function measureCut() {
    const L = laser();
    if (!L || L.kind !== 'cut') return;
    clearTimeout(cutTimer);
    cutTimer = setTimeout(() => {
      try {
        const r = rects().trim;
        const k = Math.min(1.5, 260 / r.w);
        const cv = withArtworkOnly(() => canvas.toCanvasElement(k, { left: r.x, top: r.y, width: r.w, height: r.h }), r);
        const w = cv.width;
        const h = cv.height;
        const a = cv.getContext('2d').getImageData(0, 0, w, h).data;
        const seen = new Uint8Array(w * h);
        let pieces = 0;
        const stack = [];
        for (let i = 0; i < w * h; i++) {
          if (seen[i] || a[i * 4 + 3] < 128) continue;
          let size = 0;
          stack.push(i);
          seen[i] = 1;
          while (stack.length) {
            const j = stack.pop();
            size++;
            const x = j % w;
            const y = (j - x) / w;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const n = ny * w + nx;
              if (!seen[n] && a[n * 4 + 3] >= 128) { seen[n] = 1; stack.push(n); }
            }
          }
          if (size > 3) pieces++;
        }
        if (pieces !== st.cutPieces) {
          st.cutPieces = pieces;
          scheduleCheck();
        }
      } catch (e) { /* only a warning */ }
    }, 350);
  }
  const surfaceHex = () => st.product.surface || color().hex;
  const inkFor = (hex) => (POD.luminance(hex) < 0.45 ? '#ffffff' : '#16181d');

  // ---------- Canvas ----------
  // Keep exact sizes when the design is saved (Fabric rounds to 2 decimals by default, which
  // shrinks or grows small-scaled photos by up to 15-30% between screen and print).
  fabric.Object.NUM_FRACTION_DIGITS = 8;
  const canvas = new fabric.Canvas('design-canvas', {
    width: W,
    height: H,
    preserveObjectStacking: true,
    controlsAboveOverlay: true,
    stopContextMenu: true,
    fireRightClick: false,
  });
  if (COARSE) canvas.selection = false; // one finger drags objects, two fingers zoom
  // The other layer of the side shown under the artwork (print under embroidery and back): see refreshGhost.
  const ghost = { el: null, key: '', token: 0, boxes: [] };

  function fit() {
    const stage = $('stage');
    // With the phone panel open there is little room: zoom in on the print area instead of the whole product.
    const focus = MOBILE.matches && st.sheet;
    const a = area();
    // Garment sizes: the biggest size fills the picture and smaller ones are
    // drawn smaller around the middle (k), so the garment grows or shrinks
    // with the size while the print keeps its size on screen.
    const k = POD.sizeView(st.product, st.sizeId);
    const base = focus
      ? Math.min((stage.clientWidth - 16) / (a.w + 48), (stage.clientHeight - 16) / (a.h + 48 + (zoneOf() ? 40 : 0))) / k
      : Math.min((stage.clientWidth - 32) / W, (stage.clientHeight - 32) / H, 1.6);
    const z = Math.max(0.15, base) * st.zoom;
    canvas.setDimensions({ width: Math.round(W * z), height: Math.round(H * z) });
    canvas.setViewportTransform([z * k, 0, 0, z * k, (W * z * (1 - k)) / 2, (H * z * (1 - k)) / 2]);
    requestAnimationFrame(() => typeof positionFloatBar === 'function' && positionFloatBar());
    if (focus) {
      const vt = canvas.viewportTransform;
      stage.scrollLeft = (a.x + a.w / 2) * vt[0] + vt[4] - stage.clientWidth / 2;
      stage.scrollTop = (a.y + a.h / 2 + (zoneOf() ? 20 : 0)) * vt[3] + vt[5] - stage.clientHeight / 2;
    }
    $('zoom-label').textContent = POD.num(Math.round(st.zoom * 100)) + '%';
    canvas.requestRenderAll();
  }
  new ResizeObserver(() => fit()).observe($('stage'));
  const setZoom = (z) => {
    st.zoom = Math.min(8, Math.max(0.5, z));
    fit();
  };
  /** Scroll so the middle of the print area is in the middle of the screen. */
  function centerOnPrint() {
    const stage = $('stage');
    const a = area();
    const vt = canvas.viewportTransform;
    const r = canvas.wrapperEl.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    stage.scrollLeft += r.left + (a.x + a.w / 2) * vt[0] + vt[4] - (s.left + stage.clientWidth / 2);
    stage.scrollTop += r.top + (a.y + a.h / 2) * vt[3] + vt[5] - (s.top + stage.clientHeight / 2);
  }
  /** Zoom so the print area fills most of the screen (small prints: chest embroidery, a polo's chest...). */
  function zoomToPrint() {
    const stage = $('stage');
    const a = area();
    const now = canvas.viewportTransform[0] || 1; // screen pixels per unit now
    // About half the screen: big enough to work on, with the product round it still in view.
    const want = Math.min(((stage.clientWidth - 48) * 0.5) / a.w, ((stage.clientHeight - 48) * 0.5) / a.h);
    setZoom((st.zoom * want) / now);
    centerOnPrint();
  }
  /**
   * A print area that is small on screen: start a little closer to it, but
   * not so close that the product round it is lost (at most 3x: the corner
   * picture and ⤢ show the whole item).
   */
  function autoFocusPrint() {
    const stage = $('stage');
    const a = area();
    const vt = canvas.viewportTransform;
    const now = vt[0] || 1;
    const short = Math.min(stage.clientWidth, stage.clientHeight);
    if (Math.max(a.w * vt[0], a.h * vt[3]) >= short * 0.22) return;
    const want = Math.min(((stage.clientWidth - 48) * 0.3) / a.w, ((stage.clientHeight - 48) * 0.3) / a.h);
    setZoom(Math.min(3, (st.zoom * want) / now));
    centerOnPrint();
  }
  // +/-: zoom round the print area, which stays in the middle.
  $('zoom-in').addEventListener('click', () => { setZoom(st.zoom * 1.25); centerOnPrint(); });
  $('zoom-out').addEventListener('click', () => { setZoom(st.zoom / 1.25); centerOnPrint(); });
  $('zoom-fit').addEventListener('click', () => setZoom(1));
  $('zoom-print').addEventListener('click', zoomToPrint);

  // ---------- The whole item in the corner while zoomed in ----------
  const overview = { busy: false, timer: null, scale: 1 };
  /** Is part of the product off screen (zoomed in)? */
  const zoomedIn = () => {
    const stage = $('stage');
    return canvas.getWidth() > stage.clientWidth + 2 || canvas.getHeight() > stage.clientHeight + 2;
  };
  /** The part of the canvas on screen, in canvas pixels. */
  function visiblePart() {
    const stage = $('stage');
    const r = canvas.wrapperEl.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const x = Math.max(0, s.left + stage.clientLeft - r.left);
    const y = Math.max(0, s.top + stage.clientTop - r.top);
    return { x, y, w: Math.min(canvas.getWidth() - x, stage.clientWidth), h: Math.min(canvas.getHeight() - y, stage.clientHeight) };
  }
  function overviewFrame() {
    const box = $('overview');
    if (box.hidden) return;
    const v = visiblePart();
    const k = overview.scale;
    Object.assign($('overview-view').style, { left: `${v.x * k}px`, top: `${v.y * k}px`, width: `${v.w * k}px`, height: `${v.h * k}px` });
  }
  function drawOverview() {
    const box = $('overview');
    // (Not on a phone while a panel is open: the canvas is small then and shows the print area close up.)
    const show = zoomedIn() && !st.preview && !(MOBILE.matches && st.sheet);
    box.hidden = !show;
    if (!show) return;
    const max = MOBILE.matches ? 96 : 150;
    const k = Math.min(max / canvas.getWidth(), max / canvas.getHeight());
    overview.scale = k;
    overview.busy = true;
    let pic;
    try {
      // The whole canvas (product, design, print-area guides), small.
      pic = canvas.toCanvasElement(k);
    } finally {
      overview.busy = false;
    }
    const cv = $('overview-canvas');
    cv.width = pic.width;
    cv.height = pic.height;
    const c2 = cv.getContext('2d');
    c2.drawImage(pic, 0, 0);
    // Where the design goes (the print area), so it can be found on the whole item.
    const a = area();
    const vt = canvas.viewportTransform;
    c2.strokeStyle = '#d6451f';
    c2.lineWidth = 1;
    c2.setLineDash([3, 2]);
    c2.strokeRect(Math.round((a.x * vt[0] + vt[4]) * k) + 0.5, Math.round((a.y * vt[3] + vt[5]) * k) + 0.5, Math.max(2, Math.round(a.w * vt[0] * k)), Math.max(2, Math.round(a.h * vt[3] * k)));
    overviewFrame();
  }
  const scheduleOverview = () => {
    clearTimeout(overview.timer);
    overview.timer = setTimeout(drawOverview, 250);
  };
  canvas.on('after:render', () => { if (!overview.busy) scheduleOverview(); });
  $('stage').addEventListener('scroll', overviewFrame, { passive: true });
  /** Click or drag on the small picture: that spot comes to the middle of the screen. */
  function overviewGo(e) {
    const r = $('overview-canvas').getBoundingClientRect();
    const stage = $('stage');
    const v = visiblePart();
    const cx = (e.clientX - r.left) / overview.scale;
    const cy = (e.clientY - r.top) / overview.scale;
    stage.scrollLeft += cx - (v.x + v.w / 2);
    stage.scrollTop += cy - (v.y + v.h / 2);
    overviewFrame();
  }
  $('overview-pic').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const pic = $('overview-pic');
    pic.setPointerCapture(e.pointerId);
    overviewGo(e);
    const move = (ev) => overviewGo(ev);
    const up = () => { pic.removeEventListener('pointermove', move); pic.removeEventListener('pointerup', up); pic.removeEventListener('pointercancel', up); };
    pic.addEventListener('pointermove', move);
    pic.addEventListener('pointerup', up);
    pic.addEventListener('pointercancel', up);
  });
  $('overview-all').addEventListener('click', () => setZoom(1));

  function clipRect(a) {
    // An arch-topped board (welcome signs): straight sides, a half circle on top.
    const arch = sideDef().printArea.shape === 'arch';
    if (arch) {
      const r = a.w / 2;
      return new fabric.Path(`M ${a.x} ${a.y + a.h} L ${a.x} ${a.y + r} A ${r} ${r} 0 0 1 ${a.x + a.w} ${a.y + r} L ${a.x + a.w} ${a.y + a.h} Z`, { strokeWidth: 0, absolutePositioned: true });
    }
    return new fabric.Rect({
      left: a.x, top: a.y, width: a.w, height: a.h, rx: a.rx || 0, ry: a.rx || 0,
      originX: 'left', originY: 'top', strokeWidth: 0, absolutePositioned: true,
    });
  }

  /** Trim (the print edge), bleed (artwork that gets trimmed off) and safe zone, in mockup units. */
  function rects(sideId) {
    const sd = sideDef(sideId);
    const a = sd.printArea;
    const u = a.w / sd.printWidthIn; // units per inch
    const b = (sd.bleedIn || 0) * u;
    const sf = (sd.safeIn || 0) * u;
    return {
      u, b, sf,
      trim: a,
      bleed: { x: a.x - b, y: a.y - b, w: a.w + 2 * b, h: a.h + 2 * b, rx: a.rx ? a.rx + b : 0 },
      safe: { x: a.x + sf, y: a.y + sf, w: a.w - 2 * sf, h: a.h - 2 * sf, rx: a.rx ? Math.max(0, a.rx - sf) : 0 },
    };
  }
  // While editing, artwork shows into the bleed; the preview shows the trimmed result.
  const currentClip = () => (st.preview ? rects().trim : rects().bleed);
  function applyClips(r = currentClip()) {
    canvas.getObjects().forEach((o) => {
      if (o.name === '__cropper') return;
      o.clipPath = clipRect(r);
      o.dirty = true;
      if (o.type === 'group') o.getObjects().forEach((c) => { c.clipPath = null; c.dirty = true; });
    });
    canvas.requestRenderAll();
  }
  function pathRect(ctx, r) {
    ctx.beginPath();
    if (ctx.roundRect && r.rx) ctx.roundRect(r.x, r.y, r.w, r.h, r.rx);
    else ctx.rect(r.x, r.y, r.w, r.h);
  }

  // Print-area guide and snap lines, drawn on top while editing.
  canvas.on('after:render', (opt) => {
    if (st.preview || st.exporting || overview.busy) return;
    const ctx = (opt && opt.ctx) || canvas.contextContainer;
    const a = area();
    const vt = canvas.viewportTransform;
    const px = 1 / vt[0];
    ctx.save();
    ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    if (crop) {
      const f = crop.full;
      const r = cropRect();
      ctx.fillStyle = 'rgba(15, 17, 22, .55)';
      ctx.beginPath();
      ctx.rect(f.L, f.T, f.W, f.H);
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill('evenodd');
    }
    const R = rects();
    // Bleed: solid blue line outside the print edge.
    if (R.b) {
      ctx.setLineDash([]);
      ctx.lineWidth = 1 * px;
      ctx.strokeStyle = 'rgba(28, 126, 214, .85)';
      pathRect(ctx, R.bleed);
      ctx.stroke();
    }
    // Safe zone: green dashed line inside the print edge.
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.lineWidth = 1 * px;
    ctx.strokeStyle = 'rgba(47, 158, 68, .9)';
    pathRect(ctx, R.safe);
    ctx.stroke();
    // Print edge.
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = 'rgba(255, 90, 54, .9)';
    pathRect(ctx, a);
    ctx.stroke();
    // Elements with print problems get a red outline.
    if (st.issueObjs && st.issueObjs.size) {
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = 'rgba(224, 49, 49, .95)';
      for (const o of st.issueObjs) {
        if (!canvas.contains(o)) continue;
        const r = absRect(o);
        ctx.strokeRect(r.left - 3 * px, r.top - 3 * px, r.width + 6 * px, r.height + 6 * px);
      }
      // Print and embroidery on top of each other: the other layer's artwork is outlined too.
      if (st.issues && st.issues.some((i) => i.overlap) && ghost.boxes) {
        for (const b of ghost.boxes) ctx.strokeRect(b.left - 3 * px, b.top - 3 * px, b.width + 6 * px, b.height + 6 * px);
      }
    }
    // DPI badge on the selected photo.
    const sel = canvas.getActiveObject();
    if (sel && sel.type === 'image' && !crop) {
      const dpi = imageDpi(sel);
      const r = sel.getBoundingRect(true, true);
      const txt = `${POD.num(dpi)} DPI`; // (Arabic page: Arabic digits, as in its message)
      ctx.setLineDash([]);
      ctx.font = `700 ${10 * px}px system-ui, sans-serif`;
      const tw = ctx.measureText(txt).width + 10 * px;
      const bx = r.left;
      const by = Math.max(r.top - 22 * px, 2 * px);
      ctx.fillStyle = dpi >= 150 ? '#2f9e44' : dpi >= 100 ? '#e67700' : '#e03131';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw, 16 * px, 8 * px); else ctx.rect(bx, by, tw, 16 * px);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.direction = 'ltr';
      ctx.fillText(txt, bx + 5 * px, by + 11.5 * px);
    }
    // Movable print area: a handle under the box (and the allowed zone while dragging).
    st.handleRect = null;
    const zone = zoneOf();
    if (zone && !crop) {
      if (st.movingArea) {
        ctx.setLineDash([2 * px, 4 * px]);
        ctx.lineWidth = 1 * px;
        ctx.strokeStyle = 'rgba(255, 90, 54, .55)';
        ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
        // Centre guides: the middle of the garment (up and down) and of the
        // zone (across); solid pink when the print box is snapped to them.
        const g = areaGuides();
        const snap = st.areaSnap || {};
        const guide = (on, x1, y1, x2, y2) => {
          ctx.setLineDash(on ? [] : [5 * px, 4 * px]);
          ctx.lineWidth = (on ? 1.5 : 1) * px;
          ctx.strokeStyle = on ? '#e64980' : 'rgba(230, 73, 128, .45)';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        };
        guide(snap.x, g.x, zone.y, g.x, zone.y + zone.h);
        guide(snap.y, zone.x, g.y, zone.x + zone.w, g.y);
      }
      const label = '✥ ' + t('area.drag');
      ctx.setLineDash([]);
      ctx.font = `700 ${11 * px}px Cairo, system-ui, sans-serif`;
      const hw = ctx.measureText(label).width + 22 * px;
      const hh = 24 * px;
      const hx = a.x + a.w / 2 - hw / 2;
      const hy = Math.min(a.y + a.h + 8 * px, H - hh - 2 * px);
      st.handleRect = { x: hx, y: hy, w: hw, h: hh };
      ctx.fillStyle = st.movingArea ? '#a8320f' : '#ca3d1a';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(hx, hy, hw, hh, hh / 2); else ctx.rect(hx, hy, hw, hh);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.direction = POD.lang === 'ar' ? 'rtl' : 'ltr';
      ctx.fillText(label, hx + hw / 2, hy + 16 * px);
    }
    const s = sideDef();
    ctx.font = `600 ${11 * px}px Cairo, system-ui, sans-serif`;
    ctx.fillStyle = '#ca3d1a';
    const dims = { w: POD.num(s.printWidthIn * 2.54), h: POD.num(s.printHeightIn * 2.54) };
    const stitched = embHere() || st.method === 'embroidery';
    let label = t(stitched ? 'embArea' : 'printArea', dims);
    if (ctx.measureText(label).width > a.w + 30 * px) label = t('printAreaShort', dims);
    const rtl = POD.lang === 'ar';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.fillText(label, rtl ? a.x + a.w : a.x, a.y - 6 * px);
    if (st.guides) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#d946ef';
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      for (const x of st.guides.v) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (const y of st.guides.h) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }
    ctx.restore();
  });

  // ---------- Moving the print area (garments and bags) ----------
  function zoneOf(id = st.side) {
    const s = baseSide(id);
    // Embroidery moves anywhere on the side's printable zone (on caps and totes: the whole print area).
    if (embHere(id)) return s ? s.moveZone || s.printArea : null;
    return (s && s.moveZone) || null;
  }
  /** The print box at its standard spot (embroidery: the standard embroidery spot). */
  const baseArea = (id = st.side) => (embHere(id) ? emb().area : areaFor(st.product, id, st.sizeId, null));
  const areaUnitsPerCm = (id = st.side) => baseArea(id).w / (sideDef(id).printWidthIn * 2.54);
  /** Keep the print area inside the side's allowed zone. */
  function clampOffset(dx, dy, id = st.side) {
    const z = zoneOf(id);
    if (!z) return { dx: 0, dy: 0 };
    const a = baseArea(id);
    const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, Math.min(lo, 0)), Math.max(hi, 0)));
    return { dx: clamp(dx, z.x - a.x, z.x + z.w - a.w - a.x), dy: clamp(dy, z.y - a.y, z.y + z.h - a.h - a.y) };
  }
  /** Where the centre guides are while dragging the print area. */
  function areaGuides(id = st.side) {
    const z = zoneOf(id);
    return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
  }
  /** Snap a dragged offset so the print box's centre sits on a guide when it is close. */
  function snapOffset(dx, dy) {
    const a = baseArea();
    const g = areaGuides();
    const th = SNAP_PX / canvas.getZoom();
    const cx = a.x + a.w / 2 + dx;
    const cy = a.y + a.h / 2 + dy;
    const snap = { x: Math.abs(cx - g.x) < th, y: Math.abs(cy - g.y) < th };
    st.areaSnap = snap;
    return { dx: snap.x ? g.x - a.x - a.w / 2 : dx, dy: snap.y ? g.y - a.y - a.h / 2 : dy };
  }
  /** Put the print area at this offset; the design moves with it. */
  function moveArea(dx, dy) {
    const cur = st.offsets[st.side] || { dx: 0, dy: 0 };
    const next = clampOffset(dx, dy);
    const ddx = next.dx - cur.dx;
    const ddy = next.dy - cur.dy;
    if (!ddx && !ddy) return false;
    if (next.dx || next.dy) st.offsets[st.side] = next;
    else delete st.offsets[st.side];
    canvas.discardActiveObject();
    canvas.getObjects().forEach((o) => {
      if (o.name === '__cropper') return;
      o.set({ left: o.left + ddx, top: o.top + ddy });
      o.setCoords();
    });
    applyClips();
    renderPlacement();
    if (typeof hideFloatBar === 'function') hideFloatBar();
    return true;
  }
  function renderPlacement() {
    const box = $('place-field');
    if (!box) return;
    const z = zoneOf();
    box.hidden = !z;
    if (!z) return;
    const o = st.offsets[st.side] || { dx: 0, dy: 0 };
    const u = areaUnitsPerCm();
    const x = Math.round((o.dx / u) * 2) / 2;
    const y = Math.round((o.dy / u) * 2) / 2;
    const parts = [];
    if (y) parts.push(t(y > 0 ? 'area.lower' : 'area.higher', { n: POD.num(Math.abs(y)) }));
    if (x) parts.push(t(x > 0 ? 'area.right' : 'area.left', { n: POD.num(Math.abs(x)) }));
    $('place-title').textContent = t(embHere() || st.method === 'embroidery' ? 'area.titleEmb' : 'area.title');
    $('place-info').textContent = parts.length ? t('area.moved', { v: parts.join(POD.lang === 'ar' ? ' و' : ', ') }) : t('area.standard');
    $('place-reset').disabled = !parts.length;
  }
  {
    // Drag the handle under the print area (mouse and touch). Caught before Fabric sees it.
    let drag = null;
    const onHandle = (e) => {
      const r = st.handleRect;
      if (!r || st.preview || crop || !zoneOf()) return false;
      const p = canvas.getPointer(e);
      const pad = 6 / canvas.getZoom();
      return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
    };
    const start = (e) => {
      if (drag || !e.isPrimary || !onHandle(e)) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      const p = canvas.getPointer(e);
      const o = st.offsets[st.side] || { dx: 0, dy: 0 };
      drag = { x: p.x, y: p.y, dx: o.dx, dy: o.dy };
      st.movingArea = true;
      canvas.requestRenderAll();
    };
    const move = (e) => {
      if (!drag) return;
      if (e.cancelable) e.preventDefault();
      const p = canvas.getPointer(e);
      const to = snapOffset(drag.dx + p.x - drag.x, drag.dy + p.y - drag.y);
      if (!moveArea(to.dx, to.dy)) canvas.requestRenderAll();
    };
    const end = () => {
      if (!drag) return;
      drag = null;
      st.movingArea = false;
      st.areaSnap = null;
      commit();
      canvas.requestRenderAll();
    };
    // Pointer events drive the drag; the mouse/touch events Fabric listens to are stopped while it runs.
    canvas.wrapperEl.addEventListener('pointerdown', start, { capture: true });
    for (const ev of ['mousedown', 'touchstart']) {
      canvas.wrapperEl.addEventListener(ev, (e) => { if (drag) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } }, { capture: true, passive: false });
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    canvas.on('mouse:move', (opt) => { if (!drag && onHandle(opt.e)) canvas.setCursor('grab'); });
  }
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nudge]');
    if (n || e.target.closest('#place-reset')) cancelCrop();
    if (n) {
      const [sx, sy] = n.dataset.nudge.split(',').map(Number);
      const o = st.offsets[st.side] || { dx: 0, dy: 0 };
      const u = areaUnitsPerCm();
      if (moveArea(o.dx + sx * u, o.dy + sy * u)) commit();
      return;
    }
    if (e.target.closest('#place-reset') && moveArea(0, 0)) commit();
  });

  // Snap to the centre and edges of the print area while dragging.
  canvas.on('object:moving', (e) => {
    const o = e.target;
    if (crop && o === crop.cropper) return clampCropper();
    const a = area();
    const th = SNAP_PX / canvas.getZoom();
    const guides = { v: [], h: [] };
    const c = o.getCenterPoint();
    const r = o.getBoundingRect(true, true);
    let dx = 0;
    let dy = 0;
    const tryX = (value, target) => { if (!dx && Math.abs(value - target) < th) { dx = target - value; guides.v.push(target); } };
    const tryY = (value, target) => { if (!dy && Math.abs(value - target) < th) { dy = target - value; guides.h.push(target); } };
    tryX(c.x, a.x + a.w / 2);
    tryX(r.left, a.x);
    tryX(r.left + r.width, a.x + a.w);
    tryY(c.y, a.y + a.h / 2);
    tryY(r.top, a.y);
    tryY(r.top + r.height, a.y + a.h);
    // ...and to the centres and edges of the other elements.
    const moving = new Set(o.type === 'activeSelection' ? o.getObjects() : [o]);
    for (const other of canvas.getObjects()) {
      if (moving.has(other) || other.name === '__cropper' || other.visible === false) continue;
      const q = other.getBoundingRect(true, true);
      const qc = { x: q.left + q.width / 2, y: q.top + q.height / 2 };
      tryX(c.x, qc.x);
      tryX(r.left, q.left);
      tryX(r.left + r.width, q.left + q.width);
      tryX(r.left, q.left + q.width);
      tryX(r.left + r.width, q.left);
      tryY(c.y, qc.y);
      tryY(r.top, q.top);
      tryY(r.top + r.height, q.top + q.height);
      tryY(r.top, q.top + q.height);
      tryY(r.top + r.height, q.top);
      if (dx && dy) break;
    }
    if (dx || dy) o.setPositionByOrigin(new fabric.Point(c.x + dx, c.y + dy), 'center', 'center');
    st.guides = guides.v.length || guides.h.length ? guides : null;
    // Never let an element go completely out of the print area (it would vanish and
    // couldn't be grabbed again): a part of it always stays inside.
    keepReachable(o);
  });
  function keepReachable(o) {
    const R = rects();
    const E = R.b ? R.bleed : R.trim;
    const b = o.getBoundingRect(true, true);
    const kx = Math.min(b.width, Math.max(b.width * 0.3, 16), E.w * 0.25);
    const ky = Math.min(b.height, Math.max(b.height * 0.3, 16), E.h * 0.25);
    let mx = 0;
    let my = 0;
    if (b.left > E.x + E.w - kx) mx = E.x + E.w - kx - b.left;
    else if (b.left + b.width < E.x + kx) mx = E.x + kx - (b.left + b.width);
    if (b.top > E.y + E.h - ky) my = E.y + E.h - ky - b.top;
    else if (b.top + b.height < E.y + ky) my = E.y + ky - (b.top + b.height);
    if (!mx && !my) return false;
    o.set({ left: o.left + mx, top: o.top + my });
    o.setCoords();
    return true;
  }
  /**
   * A saved design was opened: say so, and offer to start a new design instead
   * (the saved one is deleted after a confirmation).
   */
  function draftChoice(fixed) {
    const bar = document.createElement('div');
    bar.className = 'draft-bar';
    bar.setAttribute('role', 'status');
    const fill = () => {
      bar.innerHTML = `<span>${esc(t('draft.restored'))}${fixed ? ' ' + esc(POD.plural('draft.fixedOutside', fixed)) : ''}</span>
      <button type="button" class="btn btn-sm" data-draft="new">${esc(t('draft.startNew'))}</button>
      <button type="button" class="fly-close" data-draft="keep" aria-label="${esc(t('draft.keep'))}">✕</button>`;
    };
    fill();
    document.body.appendChild(bar);
    document.addEventListener('pod:langchange', fill); // (in the page's new language)
    const hide = () => {
      document.removeEventListener('pod:langchange', fill);
      bar.remove();
    };
    const timer = setTimeout(hide, 12000);
    bar.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-draft]');
      if (!b) return;
      clearTimeout(timer);
      if (b.dataset.draft === 'keep') return hide();
      if (!confirm(t('draft.startNewConfirm'))) return;
      startingOver = true; // no autosave while starting over
      clearTimeout(draftTimer);
      draftTimer = null;
      await draftSaving.catch(() => null);
      await POD.drafts.remove(st.product.id);
      try { localStorage.removeItem('pod-rescue:' + st.product.id); } catch (err) { /* private mode */ }
      // The same product, colour and size, empty: not the ready-made design, shared design or cart item it came from.
      const u = new URL(location.href);
      for (const k of ['cart', 'library', 'share', 'design', 'revise', 'k', 'rt', 'name']) u.searchParams.delete(k);
      u.searchParams.set('product', st.product.id);
      u.searchParams.set('color', st.colorId);
      if (st.sizePicked) u.searchParams.set('size', st.sizeId);
      location.replace(u.toString());
    });
  }
  /**
   * A shared or ready design opened while the customer has their own saved design for this product: say it is
   * kept (until this one is changed), with a way back to it.
   */
  let hideHeldBar = () => {};
  function heldChoice() {
    const bar = document.createElement('div');
    bar.className = 'draft-bar';
    bar.setAttribute('role', 'status');
    const fill = () => {
      bar.innerHTML = `<span>${esc(t('draft.heldNote'))}</span>
      <button type="button" class="btn btn-sm" data-held="open">${esc(t('draft.heldOpen'))}</button>
      <button type="button" class="fly-close" data-held="close" aria-label="${esc(t('draft.keep'))}">✕</button>`;
    };
    fill();
    document.body.appendChild(bar);
    document.addEventListener('pod:langchange', fill);
    hideHeldBar = () => {
      document.removeEventListener('pod:langchange', fill);
      bar.remove();
      hideHeldBar = () => {};
    };
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-held]');
      if (!b) return;
      if (b.dataset.held === 'close') return hideHeldBar();
      // Their own design: the same product without the shared / ready design (nothing here was changed).
      st.dirty = false;
      const u = new URL(location.href);
      for (const k of ['cart', 'library', 'share', 'design', 'revise', 'k', 'rt', 'name', 'color', 'size']) u.searchParams.delete(k);
      u.searchParams.set('product', st.product.id);
      location.href = u.toString();
    });
  }
  /** Bring an element that is outside the print area back in (shrunk to fit if it is bigger). */
  function bringInside(o) {
    const R = rects();
    const T = R.safe && R.safe.w > 20 && R.safe.h > 20 ? R.safe : R.trim; // inside the safe margin, not on the edge
    let b = o.getBoundingRect(true, true);
    const k = Math.min(1, (T.w * 0.9) / b.width, (T.h * 0.9) / b.height);
    if (k < 1) {
      o.set({ scaleX: o.scaleX * k, scaleY: o.scaleY * k });
      o.setCoords();
      b = o.getBoundingRect(true, true);
    }
    const nx = Math.min(Math.max(b.left, T.x), T.x + T.w - b.width);
    const ny = Math.min(Math.max(b.top, T.y), T.y + T.h - b.height);
    o.set({ left: o.left + nx - b.left, top: o.top + ny - b.top });
    o.setCoords();
  }
  /** Elements lying completely outside the print area (invisible, can't be printed). */
  const outsideObjects = () => checkIssues().filter((i) => i.key === 'check.outside').map((i) => i.obj);
  canvas.on('mouse:up', () => {
    if (st.guides) {
      st.guides = null;
      canvas.requestRenderAll();
    }
  });

  // ---------- Mockup background / overlay ----------
  const imageCache = new Map();
  function fabricImage(url) {
    if (!imageCache.has(url)) {
      imageCache.set(url, new Promise((resolve, reject) => {
        fabric.Image.fromURL(url, (img, failed) => {
          if (failed || !img) return reject(new Error('Image failed to load'));
          img.set({ originX: 'left', originY: 'top', left: 0, top: 0 });
          resolve(img);
        });
      }));
    }
    return imageCache.get(url);
  }

  /**
   * The real product photo, recoloured, placed so its measured print area
   * sits exactly on the side's print area. Dark parts that are never printed
   * on (camera lenses) go on top as the overlay.
   */
  async function photoMockup(cfg, side, hex) {
    const P = window.POD_PHOTOS;
    const at = P.placement(cfg, baseSide(side.id).printArea);
    const [cv, dark] = await Promise.all([
      P.render(cfg, hex, { width: 1000, cutout: true }),
      cfg.keepDark ? P.darkOverlay(cfg, 1000) : null,
    ]);
    const image = (el) => new fabric.Image(el, {
      originX: 'left', originY: 'top', left: at.x, top: at.y, scaleX: at.kx / el.scale, scaleY: at.ky / el.scale,
    });
    return [image(cv), dark ? image(dark) : null];
  }

  let mockupToken = 0;
  /** Booklets bound on the right (Arabic): the covers drawn with the staples on the other edge. */
  const rightBound = () => {
    const bind = (st.product.options || []).find((o) => o.id === 'binding');
    return Boolean(bind && chosenOption(bind).id === 'right');
  };
  async function applyMockup(sideId = st.side) {
    const token = ++mockupToken;
    const plain = sideDef(sideId);
    const side = plain && plain.rtlArt && rightBound() ? { ...plain, ...plain.rtlArt } : plain;
    const hex = color().hex;
    let bg;
    let ov;
    // A print all the way round (mugs) is shown unrolled: the drawing, not the photo of one side.
    const photo = !side.wrap && window.POD_PHOTOS && window.POD_PHOTOS.forSide ? window.POD_PHOTOS.forSide(st.product.base || st.product.id, side.host || side.id) : null;
    if (photo) {
      try {
        [bg, ov] = await photoMockup(photo, side, hex);
      } catch (e) {
        bg = null;
      }
    }
    if (!bg) {
      [bg, ov] = await Promise.all([
        fabricImage(POD.mockupUrl(side, hex)),
        side.overlay ? fabricImage(POD.mockupUrl(side, hex, 'overlay')) : null,
      ]);
    }
    if (token !== mockupToken) return;
    canvas.backgroundImage = bg;
    canvas.overlayImage = ov;
    canvas.requestRenderAll();
    refreshGhost();
  }

  // ---------- The other layer of this side, shown under the artwork ----------
  // Editing the print on the front shows the embroidery there (and the other
  // way round), so the customer sees both on the shirt. It is drawn with the
  // product picture: never in print files, always in the product previews.
  const GHOST_SCALE = 2;
  const ghostSideOf = (id = st.side) => (!emb() ? null : id === EMB ? emb().side : id === emb().side ? EMB : null);
  async function refreshGhost() {
    const other = ghostSideOf();
    const objs = other ? st.designs[other] || [] : [];
    const my = ++ghost.token;
    if (!objs.length) {
      if (ghost.el) { ghost.el = null; ghost.key = ''; ghost.boxes = []; canvas.requestRenderAll(); }
      return;
    }
    const a = area(other);
    const key = JSON.stringify([other, st.product.id, a, objs]);
    if (key === ghost.key) return;
    await D.ensureFontsFor(objs);
    const enlivened = await new Promise((resolve) => fabric.util.enlivenObjects(objs, resolve));
    if (my !== ghost.token) return;
    const el = document.createElement('canvas');
    const sc = new fabric.StaticCanvas(el, { width: W * GHOST_SCALE, height: H * GHOST_SCALE, enableRetinaScaling: false, renderOnAddRemove: false });
    sc.setViewportTransform([GHOST_SCALE, 0, 0, GHOST_SCALE, 0, 0]);
    enlivened.forEach((o) => { o.clipPath = clipRect(a); sc.add(o); });
    sc.renderAll();
    // Where its artwork is (inside its area), so the two layers can be kept apart.
    ghost.boxes = enlivened.filter((o) => o.visible !== false).map((o) => o.getBoundingRect(true, true)).map((b) => {
      const x = Math.max(b.left, a.x);
      const y = Math.max(b.top, a.y);
      return { left: x, top: y, width: Math.min(b.left + b.width, a.x + a.w) - x, height: Math.min(b.top + b.height, a.y + a.h) - y };
    }).filter((b) => b.width > 0 && b.height > 0);
    ghost.el = sc.lowerCanvasEl;
    ghost.key = key;
    canvas.requestRenderAll();
  }
  /** Draws the other layer onto a picture of the whole mockup (`scale` pixels per unit). */
  const withGhost = (cv, scale) => {
    if (ghost.el) cv.getContext('2d').drawImage(ghost.el, 0, 0, W * scale, H * scale);
    return cv;
  };
  canvas._renderBackground = function (ctx) {
    fabric.StaticCanvas.prototype._renderBackground.call(this, ctx);
    // Only with the product picture: print files (drawn without it) never get the other layer.
    if (!ghost.el || !this.backgroundImage) return;
    const v = this.viewportTransform;
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    ctx.drawImage(ghost.el, 0, 0, W, H);
    ctx.restore();
  };

  // ---------- Serialisation ----------
  function serialize() {
    // canvas.toObject resolves positions of objects inside a multi-selection.
    return canvas.toObject(EXTRA_PROPS).objects.map((o) => {
      delete o.clipPath;
      return o;
    });
  }

  async function loadObjects(objects) {
    await D.ensureFontsFor(objects || []);
    return new Promise((resolve) => {
      fabric.util.enlivenObjects(objects || [], (enlivened) => {
        st.silent = true;
        canvas.discardActiveObject();
        canvas.remove(...canvas.getObjects());
        enlivened.forEach((o) => canvas.add(o));
        st.silent = false;
        canvas.requestRenderAll();
        resolve();
      });
    });
  }

  canvas.on('object:added', (e) => {
    e.target.clipPath = clipRect(currentClip());
    laserTone(e.target);
    if (!st.silent) commit();
  });
  canvas.on('object:removed', () => !st.silent && commit());
  canvas.on('object:modified', (e) => {
    if (crop && e.target === crop.cropper) {
      clampCropper();
      canvas.requestRenderAll();
      return;
    }
    commit();
  });
  canvas.on('text:changed', (e) => {
    fixArabic(e.target);
    renderLayers();
    syncTextField();
    // Typed on the canvas: the "colour one word" buttons follow the words too (QA 25 Nov).
    if (canvas.getActiveObject() === e.target) refreshWordChips(e.target);
    scheduleCommit();
  });
  // Curved text is edited straight, then bends back when editing ends.
  canvas.on('text:editing:entered', (e) => { e.target.initDimensions(); e.target.setCoords(); canvas.requestRenderAll(); });
  canvas.on('text:editing:exited', (e) => { e.target.initDimensions(); e.target.setCoords(); canvas.requestRenderAll(); commit(); });
  ['selection:created', 'selection:updated'].forEach((ev) => canvas.on(ev, () => {
    canvas.getActiveObjects().forEach(applyRatioLock);
    st.wordSel = null;
    renderProps();
    renderLayers();
    scheduleCheck();
    // Phones: a newly added element opens its settings; tapping an existing
    // one shows the floating bar, which has a button for the settings.
    if (MOBILE.matches && st.openSheetOnSelect) setSheet('props');
    st.openSheetOnSelect = false;
    renderFloatBar();
  }));
  let lastCleared = null;
  canvas.on('selection:cleared', (e) => {
    if (st.reselecting) return;
    lastCleared = { objs: e.deselected || [], at: Date.now(), sheet: st.sheet };
    if (crop) {
      canvas.setActiveObject(crop.cropper);
      return;
    }
    renderProps();
    renderLayers();
    scheduleCheck();
    if (st.sheet === 'props') setSheet(null);
    renderFloatBar();
  });
  // Hide the floating bar while dragging, bring it back afterwards.
  ['object:moving', 'object:scaling', 'object:rotating'].forEach((ev) => canvas.on(ev, () => { st.dragging = true; hideFloatBar(); }));
  canvas.on('mouse:up', () => { if (st.dragging) { st.dragging = false; renderFloatBar(); } });
  canvas.on('text:editing:entered', hideFloatBar);
  canvas.on('text:editing:exited', () => renderFloatBar());
  canvas.on('object:scaling', updateQuality);
  ['object:moving', 'object:scaling', 'object:rotating'].forEach((ev) => canvas.on(ev, () => scheduleCheck()));
  canvas.on('object:rotating', (e) => { const r = $('p-angle'); if (r) r.value = Math.round(e.target.angle); });

  // ---------- History (per side) ----------
  function hist() {
    return (st.history[st.side] ||= { stack: [], i: -1 });
  }
  function seedHistory() {
    const h = hist();
    if (!h.stack.length) {
      h.stack.push(snapshot());
      h.i = 0;
    }
  }
  let commitTimer = null;
  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, 350);
  }
  function commit() {
    clearTimeout(commitTimer);
    if (st.silent || crop || st.mergePreview) return;
    // Laser: nothing gets a colour of its own (photos keep their engraving filter from when they were added).
    if (laser()) {
      canvas.getObjects().forEach((o) => laserTone(o, { images: false }));
      canvas.requestRenderAll();
    }
    const snap = snapshot();
    const h = hist();
    if (h.stack[h.i] !== snap) {
      h.stack = h.stack.slice(0, h.i + 1);
      h.stack.push(snap);
      if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
      h.i = h.stack.length - 1;
      st.dirty = true;
    }
    st.designs[st.side] = JSON.parse(snap).o;
    measureCut();
    refreshChrome();
    schedulePatternPreview();
  }
  function snapshot() {
    // `k`: the default ink at the time (white on a dark garment), so undo after a colour change keeps text readable.
    return JSON.stringify({ o: serialize(), a: st.offsets[st.side] || null, k: inkFor(surfaceHex()) });
  }
  async function stepHistory(delta) {
    if (st.mergePreview) endMergePreview();
    cancelCrop();
    hideFloatBar();
    commit();
    const h = hist();
    const next = h.i + delta;
    if (next < 0 || next >= h.stack.length) return;
    h.i = next;
    const snap = JSON.parse(h.stack[h.i]);
    if (snap.a) st.offsets[st.side] = snap.a;
    else delete st.offsets[st.side];
    // Undo doesn't change the garment's colour: text and shapes in the default ink of that moment take today's
    // (no black text left on a black shirt, QA 25 Nov).
    const ink = inkFor(surfaceHex());
    if (snap.k && snap.k !== ink && !laser()) {
      const same = (c) => typeof c === 'string' && c.toLowerCase() === snap.k;
      snap.o = snap.o.map((o) => ({ ...o, ...(same(o.fill) ? { fill: ink } : {}), ...(same(o.stroke) ? { stroke: ink } : {}) }));
    }
    await loadObjects(snap.o);
    st.designs[st.side] = snap.o;
    renderPlacement();
    // The step as it stands now (its ink swapped, or anything the canvas normalised) is the history's: otherwise the
    // next Undo's commit() saw a difference, cut the history there and pushed it again, so Undo got stuck (QA 25 Nov).
    h.stack[h.i] = snapshot();
    refreshChrome();
    renderProps();
  }

  // Serialise async UI actions so loads never interleave.
  let chain = Promise.resolve();
  const serial = (fn) => (...args) => (chain = chain.then(() => fn(...args)).catch((e) => toast(e.message, 'error')));

  // ---------- Arabic text ----------
  /** Arabic needs right-to-left direction, joined letters (no letter spacing) and an Arabic font. */
  function fixArabic(o) {
    if (!isText(o)) return;
    const arabic = D.ARABIC_RE.test(o.text);
    // The direction follows the first letter (as the text box shows it): "I love مصر 2026" stays left to right.
    const first = /[A-Za-z\u00c0-\u024f\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/.exec(o.text || '');
    const props = { direction: first && /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/.test(first[0]) ? 'rtl' : 'ltr' };
    if (arabic && o.charSpacing) props.charSpacing = 0;
    if (arabic && D.FONTS.english.includes(o.fontFamily)) {
      props.fontFamily = 'Cairo';
      D.ensureFont('Cairo', o.fontWeight).then(() => { o.initDimensions(); o.setCoords(); canvas.requestRenderAll(); });
    }
    o.set(props);
  }

  // ---------- Adding things ----------
  function addObject(obj, { select = true, shrinkToFit = true, behindText = false } = {}) {
    if (select) st.openSheetOnSelect = true;
    cancelCrop();
    // Where a new thing goes: the part of the print area meant for designs where the product has one
    // (a wall calendar's top half above the month pad, a folder's front, a brochure's cover panel).
    const full = area();
    const z = full.readyZone ? (POD.lang === 'ar' && full.readyZoneRtl ? full.readyZoneRtl : full.readyZone) : null;
    const a = z ? { x: full.x + full.w * z.x, y: full.y + full.h * z.y, w: full.w * z.w, h: full.h * z.h } : full;
    obj.set({ originX: 'center', originY: 'center', left: a.x + a.w / 2, top: a.y + a.h / 2 });
    const maxW = a.w * 0.85;
    const maxH = a.h * 0.85;
    if (shrinkToFit && (obj.getScaledWidth() > maxW || obj.getScaledHeight() > maxH)) {
      const s = Math.min(maxW / obj.getScaledWidth(), maxH / obj.getScaledHeight());
      obj.scale((obj.scaleX || 1) * s);
    }
    // A new photo goes under the texts already there, so it never hides the customer's words.
    const firstText = behindText ? canvas.getObjects().findIndex((x) => isText(x) && x.visible !== false) : -1;
    if (firstText >= 0) canvas.insertAt(obj, firstText);
    else canvas.add(obj);
    if (select) canvas.setActiveObject(obj);
    obj.setCoords();
    canvas.requestRenderAll();
    closeFlyouts();
    if (st.preview) togglePreview();
  }

  function renderPresets() {
    const groups = { basic: [], arabic: [], english: [] };
    D.TEXT_PRESETS.forEach((p, i) => groups[p.group].push([p, i]));
    const btn = ([p, i]) => {
      const font = typeof p.font === 'object' ? p.font[POD.lang] : p.font;
      const label = p.label ? t(p.label) : p.sample;
      const size = p.group === 'basic' ? [22, 17, 14][i] : 22;
      return `<button class="text-preset" data-i="${i}" style="font-family:'${font}';font-size:${size}px;font-weight:${p.weight === 'bold' ? 700 : 400};${p.italic ? 'font-style:italic' : ''}">${esc(label)}</button>`;
    };
    $('text-presets').innerHTML =
      groups.basic.map(btn).join('') +
      `<div class="preset-group">${esc(t('fly.text.arabic'))}</div>` + groups.arabic.map(btn).join('') +
      `<div class="preset-group">${esc(t('fly.text.english'))}</div>` + groups.english.map(btn).join('');
  }
  $('text-presets').addEventListener('click', serial(async (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    const p = D.TEXT_PRESETS[Number(btn.dataset.i)];
    const font = typeof p.font === 'object' ? p.font[POD.lang] : p.font;
    const text = p.text ? t(p.text) : p.sample;
    const arabic = D.ARABIC_RE.test(text);
    await D.ensureFont(font, p.weight || 'normal', p.italic ? 'italic' : 'normal');
    const ink = inkFor(surfaceHex());
    const tx = new fabric.IText(text, {
      name: 'Text',
      fontFamily: font,
      fontSize: Math.round(area().w * p.size),
      fontWeight: p.weight || 'normal',
      fontStyle: p.italic ? 'italic' : 'normal',
      charSpacing: arabic ? 0 : p.spacing || 0,
      direction: arabic ? 'rtl' : 'ltr',
      fill: p.outline ? D.ACCENT : ink,
      stroke: p.outline ? ink : null,
      strokeWidth: p.outline ? 2 : 0,
      paintFirst: 'stroke',
      textAlign: 'center',
    });
    tx.placeholder = text; // typing replaces it (not saved with the design)
    addObject(tx);
  }));
  // The example words of a new text ("Your Text"): selected when the customer starts typing, so typing replaces them.
  const stillPlaceholder = (o) => Boolean(o && o.placeholder && o.text === o.placeholder);
  canvas.on('text:editing:entered', (e) => { if (stillPlaceholder(e.target)) { e.target.selectAll(); canvas.requestRenderAll(); } });
  document.addEventListener('focusin', (e) => {
    if (e.target && e.target.id === 'p-text' && stillPlaceholder(active())) setTimeout(() => { try { e.target.select(); } catch (err) { /* gone */ } }, 0);
  });

  function renderShapes() {
    $('shape-grid').innerHTML = Object.entries(D.SHAPES)
      .map(([k, s]) => `<button class="shape-btn" data-shape="${k}" title="${esc(tr(s.name))}" aria-label="${esc(tr(s.name))}"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">${s.icon}</svg></button>`)
      .join('');
  }
  $('shape-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shape]');
    if (!btn) return;
    const def = D.SHAPES[btn.dataset.shape];
    const obj = def.make(inkFor(surfaceHex()) === '#ffffff' ? '#ffffff' : D.ACCENT);
    obj.set({ name: def.name.en });
    addObject(obj);
  });
  $('fill-area').addEventListener('click', () => {
    const a = rects().bleed; // fill into the bleed so no white edge is left after trimming
    const r = new fabric.Rect({ name: 'Background', width: a.w, height: a.h, rx: a.rx || 0, ry: a.rx || 0, fill: '#ffd84d' });
    st.silent = true;
    addObject(r, { shrinkToFit: false });
    canvas.sendToBack(r);
    st.silent = false;
    commit();
  });

  // ---------- Templates ----------
  // Every template: the editor's own (D.TEMPLATES) and the ready designs of the shop's
  // library (hundreds, in categories), searchable in Arabic or English. Thumbnails are
  // drawn only when they scroll into view.
  const tplState = { list: null, cat: 'all', q: '', cats: [] };
  const normQ = (x) => String(x || '').toLowerCase().replace(/[\u064b-\u065f\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const colourHex = (pid, cid) => {
    const p = products.find((x) => x.id === pid);
    const c = p && p.colors.find((x) => x.id === cid);
    return c ? c.hex : '#ffffff';
  };
  async function loadTemplateList() {
    if (tplState.list) return tplState.list;
    const lib = await POD.api('/api/library').catch(() => ({ categories: [], designs: [] }));
    const ready = (lib.designs || []).map((d) => ({
      key: 'lib:' + d.id, name: d.name, cat: d.category, design: d,
      tpl: d.kind === 'template' ? { id: d.id, items: d.items, aspect: d.aspect } : null,
      bg: colourHex(d.product, d.color), preview: d.kind === 'template' ? null : d.preview,
    }));
    const own = D.TEMPLATES.map((x) => ({ key: 'tpl:' + x.id, name: x.name, cat: 'basics', tpl: x, bg: '#ffffff' }));
    tplState.cats = [{ id: 'all', name: { en: 'All', ar: 'الكل' } }, ...(lib.categories || []).filter((c) => ready.some((x) => x.cat === c.id)), { id: 'basics', name: { en: 'Basics', ar: 'أساسيات' } }];
    tplState.list = [...ready, ...own];
    return tplState.list;
  }
  /** Draw template thumbnails as they come into view (a few at a time). */
  const thumbQueue = [];
  let thumbBusy = 0;
  function pumpThumbs() {
    while (thumbBusy < 3 && thumbQueue.length) {
      const { img, x } = thumbQueue.shift();
      if (!img.isConnected || img.dataset.done) continue;
      img.dataset.done = '1';
      thumbBusy++;
      const job = x.preview ? Promise.resolve(x.preview) : D.templateThumb(x.tpl, x.bg);
      job.then((u) => { img.src = u; }).catch(() => {}).finally(() => { thumbBusy--; pumpThumbs(); });
    }
  }
  const thumbObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      thumbObserver.unobserve(en.target);
      const x = en.target._tpl;
      if (x) thumbQueue.push({ img: en.target, x });
    }
    pumpThumbs();
  }, { rootMargin: '200px' }) : null;
  function lazyThumb(img, x) {
    img._tpl = x;
    if (thumbObserver) thumbObserver.observe(img);
    else { thumbQueue.push({ img, x }); pumpThumbs(); }
  }
  async function renderTemplates() {
    const list = await loadTemplateList();
    // Only the subjects that have designs for this product (laser products have their own designs).
    const fitsNow = list.filter((x) => !x.design || POD.designFor(x.design, st.product));
    const cats = tplState.cats.filter((c) => c.id === 'all' || fitsNow.some((x) => x.cat === c.id));
    if (!cats.some((c) => c.id === tplState.cat)) tplState.cat = 'all';
    $('tpl-cats').innerHTML = cats.map((c) => `<button type="button" class="tpl-cat ${c.id === tplState.cat ? 'active' : ''}" data-tplcat="${esc(c.id)}" role="tab" aria-selected="${c.id === tplState.cat}">${esc(tr(c.name))}</button>`).join('');
    const words = normQ(tplState.q).split(/\s+/).filter(Boolean);
    const catNames = Object.fromEntries(tplState.cats.map((c) => [c.id, [c.name.en, c.name.ar]]));
    // Templates with {fields} (team business cards…) only where a name list can fill them.
    const fieldy = (x) => /\{[^{}"\\\n]{1,40}\}/.test(JSON.stringify((x.tpl && x.tpl.items) || (x.design && (x.design.items || x.design.objects)) || ''));
    const shown = fitsNow.filter((x) => (st.product.merge || !fieldy(x)) && (tplState.cat === 'all' || x.cat === tplState.cat)
      && words.every((w) => [x.name.en, x.name.ar, ...(catNames[x.cat] || [])].some((n) => normQ(n).includes(w))));
    $('tpl-status').hidden = shown.length > 0;
    $('tpl-status').textContent = shown.length ? '' : t('lib.none');
    const grid = $('template-grid');
    grid.innerHTML = shown.map((x) => `<button class="template-btn" data-tplkey="${esc(x.key)}"><img alt=""><span>${esc(tr(x.name))}</span></button>`).join('');
    const byKey = new Map(shown.map((x) => [x.key, x]));
    grid.querySelectorAll('[data-tplkey]').forEach((b) => lazyThumb(b.querySelector('img'), byKey.get(b.dataset.tplkey)));
  }
  $('tpl-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tplcat]');
    if (!b) return;
    tplState.cat = b.dataset.tplcat;
    renderTemplates();
  });
  let tplQTimer = null;
  $('tpl-q').addEventListener('input', () => {
    clearTimeout(tplQTimer);
    tplQTimer = setTimeout(() => {
      tplState.q = $('tpl-q').value;
      renderTemplates();
    }, 200);
  });
  /** Put a template or a ready design (from the Templates panel or the Library) on the product. */
  async function useTemplateEntry(x) {
    if (x.tpl && !x.design) return addTemplate(x.tpl);
    const full = await POD.api('/api/library/' + encodeURIComponent(x.design.id));
    if (full.kind === 'template') return addTemplate({ id: full.id, items: full.items, aspect: full.aspect });
    await loadObjects([...serialize(), ...remap(full.objects || [], full.area || area(), area())]);
    commit();
  }
  $('template-grid').addEventListener('click', serial(async (e) => {
    const btn = e.target.closest('[data-tplkey]');
    if (!btn || !tplState.list) return;
    const x = tplState.list.find((y) => y.key === btn.dataset.tplkey);
    if (x) await useTemplateEntry(x);
  }));
  /** Put a template's (or an AI logo's) elements on the product, selected together. */
  async function addTemplate(tpl) {
    cancelCrop();
    const objs = await D.buildTemplate(tpl, area(), inkFor(surfaceHex()), { inset: rects().sf });
    if (!objs.length) return;
    st.silent = true;
    canvas.discardActiveObject();
    objs.forEach((o) => canvas.add(o));
    st.silent = false;
    canvas.setActiveObject(objs.length > 1 ? new fabric.ActiveSelection(objs, { canvas }) : objs[0]);
    canvas.requestRenderAll();
    commit();
    closeFlyouts();
    if (st.preview) togglePreview();
  }

  // ---------- Images ----------
  // Huge files are downscaled; while editing they are kept as blob: URLs.
  function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('msg.badImage')));
      img.src = url;
    });
  }
  // Illustrator and EPS files: the server draws them to a transparent PNG first.
  const isVectorFile = (file) => /\.(ai|eps|epsf|ps|pdf)$/i.test(file.name || '') || /postscript|illustrator|application\/pdf/.test(file.type || '');
  const isSvgFile = (file) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
  async function convertVectorFile(file) {
    if (file.size > MAX_VECTOR_BYTES) throw new Error(t('msg.tooBigVector'));
    busy(true, t('busy.artwork'));
    try {
      const res = await netFetch('/api/artwork', {
        method: 'POST',
        headers: { 'x-lang': POD.lang, 'x-max-px': String(MAX_UPLOAD_PX), 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) {
        const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
        throw new Error((body && body.error) || t('msg.badImage'));
      }
      const blob = await res.blob();
      // A file with several artboards: the first is used (said, so the customer isn't surprised).
      const boards = Number(res.headers.get('x-artwork-pages')) || 1;
      if (boards > 1) toast(t('msg.firstArtboard', { n: POD.num(boards) }));
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
    } finally {
      busy(false);
    }
  }
  /** A picture saved with an .ai / .eps / .pdf name (a PNG, JPEG, GIF, WebP or SVG inside): used as the picture it is. */
  async function pictureInside(file) {
    const b = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
    if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { type: 'image/png', ext: '.png' };
    if (at(0, 0xff, 0xd8, 0xff)) return { type: 'image/jpeg', ext: '.jpg' };
    if (at(0, 0x47, 0x49, 0x46, 0x38)) return { type: 'image/gif', ext: '.gif' };
    if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { type: 'image/webp', ext: '.webp' };
    if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(b))) return { type: 'image/svg+xml', ext: '.svg' };
    return null;
  }
  async function addImageFile(file, { source } = {}) {
    if (!file) return;
    if (isVectorFile(file)) {
      const real = await pictureInside(file);
      if (real) file = new File([file], file.name.replace(/\.[^.]+$/, '') + real.ext, { type: real.type });
      else {
        try {
          file = await convertVectorFile(file);
        } catch (e) {
          return toast(e.message, 'error');
        }
      }
    }
    const svg = isSvgFile(file);
    if (!svg && !/^image\/(png|jpeg|webp|gif)$/.test(file.type) && !/\.(jpe?g)$/i.test(file.name || '')) return toast(t('msg.badType'), 'error');
    if (file.size > MAX_UPLOAD_BYTES) return toast(t('msg.tooBig'), 'error');
    // SVG: the browser draws it as a picture (no scripts, no outside files) at full upload size.
    if (svg && file.type !== 'image/svg+xml') file = new File([file], file.name, { type: 'image/svg+xml' });
    const srcUrl = URL.createObjectURL(file);
    try {
      const img = await loadHtmlImage(srcUrl);
      if (!img.naturalWidth || !img.naturalHeight) throw new Error(t('msg.badImage'));
      const scale = svg ? MAX_UPLOAD_PX / Math.max(img.naturalWidth, img.naturalHeight) : Math.min(1, MAX_UPLOAD_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const jpeg = file.type === 'image/jpeg' || (!file.type && /\.jpe?g$/i.test(file.name || ''));
      const blob = await new Promise((r) => c.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', 0.92));
      const fimg = await new Promise((resolve) => fabric.Image.fromURL(URL.createObjectURL(blob), resolve));
      fimg.set({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Image', ...(source ? { importSource: source } : {}) });
      const a = area();
      fimg.scale(Math.min((a.w * 0.8) / fimg.width, (a.h * 0.8) / fimg.height));
      addObject(fimg, { behindText: true });
      const dpi = imageDpi(fimg);
      if (dpi < dpiLimits().fail) toast(t('msg.lowResToast', { dpi: POD.num(dpi) }), 'error');
      // "Remove the background of my photos" is ticked in the upload panel.
      if ($('auto-bg') && $('auto-bg').checked && !/\.png$/i.test(file.name || '')) await removeImageBackground(fimg);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      URL.revokeObjectURL(srcUrl);
    }
  }
  // ---------- Import a picture from a link (another site's product page or an image link) ----------
  $('imp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('imp-url').value.trim();
    if (!url) return;
    const box = $('imp-results');
    box.innerHTML = `<div class="muted small"><span class="spinner spinner-sm"></span> ${esc(t('imp.loading'))}</div>`;
    try {
      const r = await POD.api('/api/import/link', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': POD.lang }, body: JSON.stringify({ url }) });
      box.innerHTML = `<div class="muted small" style="margin-bottom:6px">${esc(t('imp.pick'))}</div><div class="imp-grid">${r.images.map((u) => `<button type="button" class="imp-pick" data-src="${esc(u)}"><img alt="" loading="lazy" src="/api/import/image?thumb=1&url=${encodeURIComponent(u)}"></button>`).join('')}</div>`;
      box.dataset.page = url;
      // Pictures that fail to load (blocked, not a picture) are hidden.
      box.querySelectorAll('.imp-pick img').forEach((img) => img.addEventListener('error', () => img.parentElement.remove()));
    } catch (err) {
      box.innerHTML = `<div class="small" style="color:var(--danger,#e03131);line-height:1.6">${esc(err.message)}</div>`;
    }
  });
  $('imp-results').addEventListener('click', async (e) => {
    const b = e.target.closest('.imp-pick');
    if (!b) return;
    busy(true, t('imp.adding'));
    try {
      const res = await netFetch(`/api/import/image?url=${encodeURIComponent(b.dataset.src)}`, { headers: { 'x-lang': POD.lang, 'x-max-px': String(MAX_UPLOAD_PX) } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('msg.badImage'));
      const blob = await res.blob();
      const file = new File([blob], 'Imported.' + (blob.type === 'image/png' ? 'png' : 'jpg'), { type: blob.type });
      busy(false);
      await addImageFile(file, { source: $('imp-results').dataset.page || b.dataset.src });
      toast(t('imp.cleanTip'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy(false);
    }
  });
  /** True when any side uses a picture imported from another site. */
  const hasImports = () => allSides().some((sd) => (sd.id === st.side ? serialize() : st.designs[sd.id] || []).some((o) => o && o.importSource));
  /** Ask the customer to confirm the rights to imported pictures (resolves true/false). */
  function confirmRights() {
    return new Promise((resolve) => {
      const m = $('rights');
      $('rights-check').checked = false;
      $('rights-ok').disabled = true;
      m.hidden = false;
      const done = (ok) => {
        m.hidden = true;
        $('rights-ok').onclick = null;
        $('rights-cancel').onclick = null;
        resolve(ok);
      };
      $('rights-check').onchange = () => { $('rights-ok').disabled = !$('rights-check').checked; };
      $('rights-ok').onclick = () => done(true);
      $('rights-cancel').onclick = () => done(false);
    });
  }

  // Remembered in this browser.
  try { $('auto-bg').checked = localStorage.getItem('pod-auto-bg') === '1'; } catch (e) { /* private mode */ }
  $('auto-bg').addEventListener('change', (e) => { try { localStorage.setItem('pod-auto-bg', e.target.checked ? '1' : '0'); } catch (err) { /* private mode */ } });
  // ---------- Booklets: a whole PDF, or several photos, on the pages in order ----------
  const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
  const isPicture = (f) => f && (/^image\//.test(f.type || '') || /\.(png|jpe?g|webp|gif|svg|ai|eps)$/i.test(f.name || ''));
  /** Pages from the current one on (several files), or every page from the cover (a PDF). */
  const addFiles = serial(async (list) => {
    const files = [...(list || [])].filter(Boolean);
    if (!files.length) return;
    // (Several pictures chosen at once: each goes on the design, one after another; only the first was. QA 25 Nov.)
    if (!st.product.paged) {
      for (const f of files.slice(0, 10)) await addImageFile(f);
      return;
    }
    if (files.length === 1 && isPdf(files[0])) return addPdfPages(files[0]);
    if (files.length === 1) return addImageFile(files[0]);
    const pages = activeSides();
    const from = Math.max(0, pages.findIndex((s) => s.id === hostOf()));
    const room = pages.slice(from);
    // Pictures only (a PDF among photos, or a file that isn't a picture, is left out).
    const use = files.filter((f) => !isPdf(f) && isPicture(f)).slice(0, room.length);
    if (use.length < files.length) toast(tPg('ed.filesSkipped', { n: POD.num(files.length - use.length) }));
    for (let i = 0; i < use.length; i++) {
      if (room[i].id !== hostOf()) {
        commit();
        canvas.discardActiveObject();
        await showSide(room[i].id);
        seedHistory(); // the page as it was, so Undo takes the photo off again
      }
      await addImageFile(use[i]);
      commit();
    }
    renderSideTabs();
    refreshChrome();
    tabInView();
    toast(tPg('ed.filesPlaced', { n: POD.num(use.length) }));
  });
  /** Every page of a PDF on the booklet's pages: page 1 on the cover, the last on the back cover. */
  async function addPdfPages(file) {
    if (file.size > 60 * 1024 * 1024) return toast(tPg('ed.pdfTooBig'), 'error');
    const first = activeSides()[0];
    const r0 = rects(first.id).bleed;
    // About 200 DPI over the page with its bleed.
    const w = Math.round(Math.min(2000, sideDef(first.id).printWidthIn * 200 * (r0.w / rects(first.id).trim.w)));
    const h = Math.round((w * r0.h) / r0.w);
    busy(true, tPg('ed.pdfReading'));
    let got;
    try {
      const res = await netFetch('/api/artwork/pages', { method: 'POST', headers: { 'x-lang': POD.lang, 'x-page-w': String(w), 'x-page-h': String(h), 'x-max-pages': '32', 'Content-Type': 'application/pdf' }, body: file });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error((body && body.error) || t('msg.badImage'));
      got = body;
    } catch (e) {
      busy(false);
      return toast(e.message, 'error');
    }
    busy(false);
    // Pages in the PDF. A long one comes back as its first pages and its last one (pageNums: which
    // page of the PDF each picture is).
    const n = got.count || got.pages.length;
    const nums = Array.isArray(got.pageNums) && got.pageNums.length === got.pages.length ? got.pageNums : got.pages.map((_, i) => i);
    // A size with room for every page (same number of copies), when the chosen one is too small or too
    // big; for a PDF longer than every booklet, the biggest one.
    const copies = (id) => String(id).split('-')[1] || '';
    const cur = st.product.sizes.find((z) => z.id === st.sizeId);
    const sameCopies = st.product.sizes.filter((z) => copies(z.id) === copies(st.sizeId) && canPick(z)).sort((a, b) => a.pages - b.pages);
    const biggest = sameCopies[sameCopies.length - 1];
    if (n !== activeSides().length) {
      const fits = sameCopies.filter((z) => sizeOk(st.product, st.colorId, z)).find((z) => z.pages >= n) || (biggest && biggest.pages > cur.pages ? biggest : null);
      if (fits && fits.id !== st.sizeId && fits.pages !== cur.pages && window.confirm(tPg('ed.pdfSize', { n: POD.num(n), pages: POD.num(fits.pages), now: POD.num(cur.pages) }))) {
        st.sizePicked = true;
        await changeSize(fits.id);
        renderOptions();
      }
    }
    const pages = activeSides();
    const k = pages.length;
    // In order: PDF page 1 on the cover, page 2 on page 2… and the PDF's last page always on the back
    // cover: a longer PDF loses the pages before its last one, a shorter one leaves blank pages before it.
    const last = got.pages.length - 1;
    const pick = n >= k ? [...Array(k - 1).keys(), n > k ? last : k - 1] : got.pages.map((_, i) => i); // pictures used
    const at = n >= k || n < 2 ? pick.map((_, i) => i) : [...Array(n - 1).keys(), k - 1]; // booklet page of each
    const targets = at.map((i) => pages[i]);
    const used = pick.map((i) => got.pages[i]);
    // Which page of the PDF each one is: the print files use that page of the PDF itself, not the picture.
    const srcIdx = pick.map((i) => nums[i]);
    busy(true, tPg('ed.pdfPlacing'));
    let fitted = 0; // pages of another shape, fitted inside the page
    try {
      for (let i = 0; i < used.length && i < targets.length; i++) {
        const page = targets[i];
        if (page.id !== hostOf()) {
          commit();
          canvas.discardActiveObject();
          await showSide(page.id);
          seedHistory(); // the page as it was, so Undo takes the PDF page off again
        }
        const fimg = await new Promise((resolve) => fabric.Image.fromURL(used[i], resolve));
        const r = rects(page.id).bleed;
        // A page from an earlier PDF here is replaced (a corrected PDF takes its place, not hides under it).
        for (const old of canvas.getObjects().filter((o) => o.pdfSrc)) canvas.remove(old);
        fimg.set({ name: `${(file.name || 'PDF').replace(/\.[^.]+$/, '').slice(0, 30)}${POD.sep ? POD.sep() : ' · '}${POD.num(srcIdx[i] + 1)}`, ...(got.pdfId ? { pdfSrc: { id: got.pdfId, page: srcIdx[i] } } : {}) });
        // Same shape as the booklet page: it fills the page with its bleed. Another shape (landscape,
        // square...) fits inside the page whole, rather than losing what doesn't fit.
        const t = rects(page.id).trim;
        const off = Math.abs(Math.log((fimg.width / fimg.height) / (r.w / r.h))) > 0.08;
        if (off) fitted += 1;
        fimg.scale(off ? Math.min(t.w / fimg.width, t.h / fimg.height) : Math.max(r.w / fimg.width, r.h / fimg.height));
        addObject(fimg, { select: false, shrinkToFit: false });
        // The page fills the page with its bleed, under anything already designed there.
        fimg.set({ left: r.x + r.w / 2, top: r.y + r.h / 2 });
        canvas.sendToBack(fimg);
        fimg.setCoords();
        commit();
      }
      if (targets[0].id !== hostOf()) await showSide(targets[0].id);
    } finally {
      busy(false);
    }
    renderSideTabs();
    refreshChrome();
    tabInView();
    if (n > k) {
      // The biggest booklet, or the customer kept a smaller one.
      const atMost = !biggest || biggest.pages <= k;
      toast(tPg(atMost ? 'ed.pdfTooMany' : 'ed.pdfCut', { n: POD.num(n), k: POD.num(k), first: POD.num(k - 1) }), 'error');
    } else if (n < k && n >= 2) {
      toast(tPg('ed.pdfFewer', { n: POD.num(n), blank: POD.num(k - n) }));
    } else toast(tPg(Math.min(n, k) === 1 ? 'ed.pdfPlacedOne' : 'ed.pdfPlaced', { n: POD.num(Math.min(n, k)) }));
    if (fitted) setTimeout(() => toast(tPg('ed.pdfFitted', { n: POD.num(fitted) })), 2600);
  }
  const PG_TEXT = {
    'ed.pdfReading': ['Reading the PDF pages…', 'بنقرا صفحات الـ PDF…'],
    'ed.pdfPlacedOne': ['The page was placed on the cover. Flip through the booklet in the preview.', 'اتحطت الصفحة على الغلاف. قلّب في الكتيب من المعاينة.'],
    'ed.pdfFitted': ['{n} pages have another shape than the booklet (e.g. landscape): they were fitted inside the page whole. Resize them if you like.', 'صفحات شكلها مختلف عن الكتيب (عددها {n}، زي العرضي): اتحطت جوه الصفحة كاملة. تقدر تكبرها لو حابب.'],
    'ed.pdfTooBig': ['That PDF is bigger than 60 MB. Save a smaller one (for example with compressed pictures), then upload it again.', 'الـ PDF ده أكبر من ٦٠ ميجابايت. احفظه أصغر (مثلًا بضغط الصور) وارفعه تاني.'],
    'ed.pdfPlacing': ['Putting the pages in the booklet…', 'بنحط الصفحات في الكتيب…'],
    'ed.pdfPlaced': ['{n} pages placed in order, page 1 on the cover. Flip through them in the preview.', 'اتحطت الصفحات بالترتيب (عددها {n})، أول صفحة على الغلاف. قلّب فيهم من المعاينة.'],
    'ed.pdfTooMany': ['The PDF has {n} pages, more than the biggest booklet ({k} pages). Its first {first} pages and its last one (on the back cover) were used.', 'صفحات الـ PDF (عددها {n}) أكتر من أكبر كتيب (عدد صفحاته {k}). استخدمنا أول صفحاته (عددها {first}) وآخر صفحة على الغلاف الخلفي.'],
    'ed.pdfCut': ['The PDF has {n} pages and this booklet has {k}: its first {first} pages and its last one (on the back cover) were used. To use every page, pick a bigger booklet under Size.', 'صفحات الـ PDF عددها {n} وصفحات الكتيب ده {k}: استخدمنا أول صفحاته (عددها {first}) وآخر صفحة على الغلاف الخلفي. عشان تستخدم كل الصفحات، اختار كتيب أكبر من المقاس.'],
    'ed.pdfFewer': ['{n} pages placed: page 1 on the cover and the last one on the back cover, with {blank} blank pages before it.', 'اتحطت الصفحات (عددها {n}): أول صفحة على الغلاف وآخر صفحة على الغلاف الخلفي، وقبلها صفحات فاضية (عددها {blank}).'],
    'ed.pdfSize': ['The PDF has {n} pages and this booklet has {now}. Switch to the {pages}-page booklet?', 'صفحات الـ PDF: {n}، وصفحات الكتيب ده: {now}. تحب تغيّر لكتيب عدد صفحاته {pages}؟'],
    'ed.filesPlaced': ['{n} photos placed, one on each page from this one on.', 'اتحطت الصور (عددها {n})، صورة في كل صفحة من الصفحة دي ورايح.'],
    'ed.filesSkipped': ['{n} files were left out (not enough pages after this one, or files that aren\'t photos).', 'سبنا ملفات (عددها {n}): الصفحات اللي بعد دي مش كفاية، أو ملفات مش صور.'],
    'ed.pagesHidden': ['With this page count these pages won\'t be printed: {pages}. Their designs are kept, and come back if you pick more pages again. Continue?', 'بعدد الصفحات ده الصفحات دي مش هتتطبع: {pages}. تصميمها هيفضل محفوظ ويرجع لو اخترت صفحات أكتر تاني. نكمّل؟'],
  };
  const tPg = (k, params = {}) => (PG_TEXT[k] ? PG_TEXT[k][POD.lang === 'ar' ? 1 : 0].replace(/\{(\w+)\}/g, (m, x) => (params[x] != null ? params[x] : m)) : t(k, params));
  $('file-input').addEventListener('change', (e) => {
    addFiles([...e.target.files]); // copied first: clearing the field empties its list
    e.target.value = '';
  });
  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
  $('stage').addEventListener('dragover', (e) => e.preventDefault());
  $('stage').addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });

  /** Resolution a print needs at its size: big prints are seen from further away (same tiers as the server's checks). */
  function dpiLimits(sideId = st.side) {
    const s = sideDef(sideId);
    const longIn = Math.max(s.printWidthIn, (s.printWidthIn * s.printArea.h) / s.printArea.w);
    if (longIn > 48) return { fail: 40, warn: 60 };
    if (longIn > 24) return { fail: 72, warn: 110 };
    return { fail: 100, warn: 150 };
  }
  function imageDpi(o, sideId = st.side) {
    const s = sideDef(sideId);
    const widthIn = ((o.width * Math.abs(o.scaleX || 1)) / s.printArea.w) * s.printWidthIn;
    // An uploaded design prints from its full-size original (printPx), not the screen copy.
    const px = o.printSrc && Array.isArray(o.printPx) && o.printPx[0] > o.width && !o.printSwapped ? o.printPx[0] : o.width;
    return Math.round(px / widthIn);
  }

  async function toDataUrl(url) {
    const blob = await (await fetch(url)).blob();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error(t('msg.badImage')));
      r.readAsDataURL(blob);
    });
  }
  async function blobifyImages(objects) {
    return Promise.all(objects.map(async (o) => {
      if (o.type === 'image' && typeof o.src === 'string' && o.src.startsWith('data:')) {
        const blob = await (await fetch(o.src)).blob();
        return { ...o, src: URL.createObjectURL(blob) };
      }
      return o;
    }));
  }
  const inlined = new Map();
  async function inlineImages(objects) {
    return Promise.all(objects.map(async (o) => {
      if (o.type === 'image' && typeof o.src === 'string' && o.src.startsWith('blob:')) {
        if (!inlined.has(o.src)) inlined.set(o.src, toDataUrl(o.src));
        return { ...o, src: await inlined.get(o.src) };
      }
      return o;
    }));
  }

  // ---------- Flyouts ----------
  function closeFlyouts() {
    document.querySelectorAll('.flyout').forEach((f) => (f.hidden = true));
    document.querySelectorAll('.tool').forEach((x) => x.classList.remove('open'));
  }
  let templatesRendered = false;
  document.querySelectorAll('.tool[data-flyout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fly = $('flyout-' + btn.dataset.flyout);
      const open = fly.hidden;
      closeFlyouts();
      fly.hidden = !open;
      btn.classList.toggle('open', open);
      if (open && btn.dataset.flyout === 'templates' && !templatesRendered) {
        templatesRendered = true;
        renderTemplates();
      }
    });
  });
  canvas.on('mouse:down', closeFlyouts);
  document.querySelectorAll('.flyout .fly-close').forEach((b) => b.addEventListener('click', closeFlyouts));

  // ---------- Stickers ----------
  const SK = window.POD_STICKERS;
  let stickerCat = 'all';
  function renderStickers() {
    $('sticker-cats').innerHTML = [{ id: 'all', name: null }, ...SK.CATEGORIES]
      .map((c) => `<button class="chip ${c.id === stickerCat ? 'active' : ''}" data-scat="${c.id}">${esc(c.name ? tr(c.name) : t('cat.all'))}</button>`).join('');
    $('sticker-grid').innerHTML = SK.STICKERS.filter((s) => stickerCat === 'all' || s.cat === stickerCat)
      .map((s) => `<button class="sticker-btn" data-sticker="${s.id}" title="${esc(tr(s.name))}" aria-label="${esc(tr(s.name))}"><img alt="" loading="lazy" src="${SK.thumbUrl(s)}"></button>`).join('');
  }
  $('sticker-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scat]');
    if (!b) return;
    stickerCat = b.dataset.scat;
    renderStickers();
  });
  $('sticker-grid').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-sticker]');
    if (!b) return;
    const obj = await SK.makeSticker(SK.STICKERS.find((x) => x.id === b.dataset.sticker));
    const a = area();
    obj.scale(Math.min((a.w * 0.42) / obj.width, (a.h * 0.42) / obj.height));
    addObject(obj);
  }));

  // ---------- Library: search icons, stickers and templates (Arabic or English) ----------
  const lib = { type: 'all', q: '', page: 0, items: [], token: 0, designs: null };
  const libSvg = (it, color) => {
    const body = color ? it.body.replace(/currentColor/g, color) : it.body;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${it.w} ${it.h}" width="${it.w * 8}" height="${it.h * 8}">${body}</svg>`;
  };
  const libThumb = (it) => `<button type="button" class="sticker-btn lib-item" data-lib="${esc(it.id)}" title="${esc(it.id.split(':')[1].replace(/-/g, ' '))}"><img alt="" loading="lazy" src="${POD.svgDataUrl(libSvg(it, it.kind === 'icon' ? '#16181d' : null))}"></button>`;
  const LIB_RECENT = 'pod-lib-recent';
  const libRecent = () => { try { return JSON.parse(localStorage.getItem(LIB_RECENT) || '[]'); } catch (e) { return []; } };
  function rememberLib(it) {
    try { localStorage.setItem(LIB_RECENT, JSON.stringify([it, ...libRecent().filter((x) => x.id !== it.id)].slice(0, 12))); } catch (e) { /* private mode */ }
  }
  /** Templates and ready designs whose names match (searched here, they are few). */
  async function libTemplates(q) {
    if (!lib.designs) lib.designs = await POD.api('/api/library').then((r) => r.designs).catch(() => []);
    const norm = (x) => String(x || '').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    const words = norm(q).split(/\s+/).filter(Boolean);
    const hit = (names) => !words.length || words.every((w) => names.some((n) => norm(n).includes(w)));
    const tpls = D.TEMPLATES.filter((x) => hit([x.name.en, x.name.ar])).map((x) => ({ kind: 'tpl', id: 'tpl:' + x.id, tpl: x, name: x.name }));
    const ready = lib.designs.filter((d) => POD.designFor(d, st.product) && hit([d.name.en, d.name.ar, d.category])).map((d) => ({ kind: 'ready', id: 'lib:' + d.id, design: d, name: d.name }));
    return [...ready, ...tpls];
  }
  async function libSearch(more) {
    const my = ++lib.token;
    if (!more) {
      lib.page = 0;
      lib.items = [];
      $('lib-grid').innerHTML = '<div class="pv-loading" style="grid-column:1/-1"><div class="spinner"></div></div>';
    }
    const recent = libRecent();
    $('lib-recent-box').hidden = Boolean(lib.q) || lib.type === 'template' || !recent.length;
    if (!$('lib-recent-box').hidden) $('lib-recent').innerHTML = recent.map(libThumb).join('');
    try {
      if (lib.type === 'template') {
        const list = await libTemplates(lib.q);
        if (my !== lib.token) return;
        $('lib-status').textContent = list.length ? '' : t('lib.none');
        $('lib-grid').innerHTML = list.map((x) => `<button type="button" class="sticker-btn lib-tpl" data-libtpl="${esc(x.id)}" title="${esc(tr(x.name))}"><img alt="" data-tplthumb="${esc(x.id)}"><span>${esc(tr(x.name))}</span></button>`).join('');
        lib.tplList = list;
        for (const x of list) {
          const img = $('lib-grid').querySelector(`[data-tplthumb="${CSS.escape(x.id)}"]`);
          if (!img) continue;
          if (x.kind === 'ready' && x.design.kind !== 'template') lazyThumb(img, { preview: x.design.preview });
          else lazyThumb(img, { tpl: x.kind === 'tpl' ? x.tpl : { id: x.design.id, items: x.design.items, aspect: x.design.aspect }, bg: x.kind === 'tpl' ? '#ffffff' : colourHex(x.design.product, x.design.color) });
        }
        $('lib-more').hidden = true;
        return;
      }
      const r = await POD.api(`/api/assets/search?q=${encodeURIComponent(lib.q)}&type=${lib.type}&page=${lib.page}`);
      if (my !== lib.token) return;
      lib.items.push(...r.items);
      $('lib-status').textContent = !lib.items.length ? t('lib.none') : lib.q ? t('lib.count', { n: POD.num(r.total) }) : t('lib.popular');
      $('lib-grid').innerHTML = lib.items.map(libThumb).join('');
      $('lib-more').hidden = !r.more;
    } catch (e) {
      if (my === lib.token) $('lib-grid').innerHTML = `<p class="small muted" style="grid-column:1/-1">${esc(e.message)}</p>`;
    }
  }
  let libTimer = null;
  $('lib-q').addEventListener('input', () => {
    clearTimeout(libTimer);
    libTimer = setTimeout(() => {
      lib.q = $('lib-q').value.trim();
      libSearch(false);
    }, 250);
  });
  $('lib-types').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ltype]');
    if (!b || b.dataset.ltype === lib.type) return;
    lib.type = b.dataset.ltype;
    document.querySelectorAll('#lib-types [data-ltype]').forEach((x) => x.classList.toggle('active', x === b));
    libSearch(false);
  });
  $('lib-more').addEventListener('click', () => {
    lib.page++;
    libSearch(true);
  });
  /** Put an icon (in the product's ink colour) or a colourful sticker on the design. */
  async function addLibItem(it) {
    const svg = libSvg(it, it.kind === 'icon' ? inkFor(surfaceHex()) : null);
    const obj = await new Promise((resolve) => fabric.loadSVGFromString(svg, (objects, options) => resolve(fabric.util.groupSVGElements(objects, options))));
    obj.set({ name: (it.kind === 'icon' ? 'icon:' : 'sticker:') + it.id.split(':')[1] });
    const a = area();
    obj.scale(Math.min((a.w * 0.4) / obj.width, (a.h * 0.4) / obj.height));
    addObject(obj);
    rememberLib(it);
  }
  const libClick = serial(async (e) => {
    const b = e.target.closest('[data-lib]');
    if (b) {
      const it = lib.items.find((x) => x.id === b.dataset.lib) || libRecent().find((x) => x.id === b.dataset.lib);
      if (it) await addLibItem(it);
      return;
    }
    const tb = e.target.closest('[data-libtpl]');
    if (!tb || !lib.tplList) return;
    const x = lib.tplList.find((y) => y.id === tb.dataset.libtpl);
    if (!x) return;
    if (x.kind === 'tpl') return addTemplate(x.tpl);
    const full = await POD.api('/api/library/' + encodeURIComponent(x.design.id));
    if (full.kind === 'template') return addTemplate({ id: full.id, items: full.items, aspect: full.aspect });
    await loadObjects([...serialize(), ...remap(full.objects || [], full.area || area(), area())]);
    commit();
  });
  $('lib-grid').addEventListener('click', libClick);
  $('lib-recent').addEventListener('click', libClick);
  let libStarted = false;
  document.querySelector('.tool[data-flyout="library"]').addEventListener('click', () => {
    if (!libStarted) {
      libStarted = true;
      libSearch(false);
    }
    setTimeout(() => $('lib-q').focus(), 50);
  });

  // ---------- Phone layout: slide-up panel ----------
  function syncSheetTitle() {
    if (st.sheet) $('sheet-title').textContent = st.sheet === 'product' ? t('sheet.product') : $('props-title').textContent;
  }
  function setSheet(mode) {
    st.sheet = mode;
    document.body.classList.toggle('sheet-props', mode === 'props');
    document.body.classList.toggle('sheet-product', mode === 'product');
    document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.toggle('open', b.dataset.sheet === mode));
    syncSheetTitle();
    requestAnimationFrame(() => { fit(); renderFloatBar(); });
  }
  document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => {
    closeFlyouts();
    if (st.sheet === b.dataset.sheet) return setSheet(null);
    cancelCrop();
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setSheet(b.dataset.sheet);
  }));
  // Closing the settings keeps the element selected, with its floating bar.
  $('sheet-close').addEventListener('click', () => {
    if (st.sheet === 'props') cancelCrop();
    setSheet(null);
  });
  MOBILE.addEventListener('change', () => setSheet(null));

  // Two-finger pinch zooms and pans the view.
  const stageEl = $('stage');
  let pinch = null;
  const tDist = (tt) => Math.hypot(tt[0].clientX - tt[1].clientX, tt[0].clientY - tt[1].clientY);
  const tMid = (tt) => ({ x: (tt[0].clientX + tt[1].clientX) / 2, y: (tt[0].clientY + tt[1].clientY) / 2 });
  stageEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    // Remember which spot of the product is under the fingers, as a share of the
    // canvas, so zooming keeps that spot under them instead of drifting away.
    const m0 = tMid(e.touches);
    const r0 = canvas.wrapperEl.getBoundingClientRect();
    pinch = {
      d: Math.max(10, tDist(e.touches)), z: st.zoom,
      fx: Math.min(1, Math.max(0, (m0.x - r0.left) / (r0.width || 1))),
      fy: Math.min(1, Math.max(0, (m0.y - r0.top) / (r0.height || 1))),
    };
    e.preventDefault();
    e.stopPropagation();
    // The first finger reached the canvas a moment earlier: undo whatever it started.
    canvas._currentTransform = null;
    const recent = lastCleared && Date.now() - lastCleared.at < 400 ? lastCleared.objs.filter((o) => canvas.contains(o)) : [];
    if (recent.length && !canvas.getActiveObject()) {
      if (lastCleared.sheet === 'props') st.openSheetOnSelect = true;
      canvas.setActiveObject(recent.length === 1 ? recent[0] : new fabric.ActiveSelection(recent, { canvas }));
    }
    canvas.requestRenderAll();
  }, { passive: false, capture: true });
  stageEl.addEventListener('touchmove', (e) => {
    if (!pinch) return;
    // Keep the canvas out of it until every finger has lifted, so the selection survives.
    e.preventDefault();
    e.stopPropagation();
    if (e.touches.length !== 2) return;
    setZoom(pinch.z * (tDist(e.touches) / pinch.d));
    const m = tMid(e.touches);
    const r = canvas.wrapperEl.getBoundingClientRect();
    stageEl.scrollLeft += r.left + pinch.fx * r.width - m.x;
    stageEl.scrollTop += r.top + pinch.fy * r.height - m.y;
  }, { passive: false, capture: true });
  const endPinch = (e) => {
    if (!pinch) return;
    e.stopPropagation();
    if (e.touches.length === 0) pinch = null;
  };
  // Ctrl/⌘ + mouse wheel (and a trackpad pinch, which sends the same): zoom on the spot under the pointer.
  stageEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r0 = canvas.wrapperEl.getBoundingClientRect();
    const fx = (e.clientX - r0.left) / (r0.width || 1);
    const fy = (e.clientY - r0.top) / (r0.height || 1);
    setZoom(st.zoom * Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.006));
    const r = canvas.wrapperEl.getBoundingClientRect();
    stageEl.scrollLeft += r.left + fx * r.width - e.clientX;
    stageEl.scrollTop += r.top + fy * r.height - e.clientY;
  }, { passive: false });
  stageEl.addEventListener('touchend', endPinch, { capture: true });
  stageEl.addEventListener('touchcancel', endPinch, { capture: true });

  // ---------- Object actions ----------
  const active = () => canvas.getActiveObject();
  function removeSelected() {
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    st.silent = true;
    canvas.discardActiveObject();
    objs.forEach((o) => canvas.remove(o));
    st.silent = false;
    commit();
    renderProps();
  }
  function duplicateSelected() {
    const o = active();
    if (!o || o.type === 'activeSelection') return;
    o.clone((cl) => {
      cl.set({ left: o.left + 14, top: o.top + 14 });
      canvas.add(cl);
      canvas.setActiveObject(cl);
      canvas.requestRenderAll();
    }, EXTRA_PROPS);
  }
  function centerSelected(axis) {
    const o = active();
    if (!o) return;
    const a = area();
    const c = o.getCenterPoint();
    const target = new fabric.Point(axis === 'v' ? c.x : a.x + a.w / 2, axis === 'h' ? c.y : a.y + a.h / 2);
    o.setPositionByOrigin(target, 'center', 'center');
    o.setCoords();
    canvas.requestRenderAll();
    commit();
  }
  function fitToArea(o) {
    const a = area();
    o.set({ angle: 0 });
    o.scale(Math.min(a.w / o.width, a.h / o.height));
    o.setPositionByOrigin(new fabric.Point(a.x + a.w / 2, a.y + a.h / 2), 'center', 'center');
    o.setCoords();
    canvas.requestRenderAll();
    commit();
    updateQuality();
  }
  function layer(dir) {
    const o = active();
    if (!o) return;
    ({ up: () => canvas.bringForward(o), down: () => canvas.sendBackwards(o), top: () => canvas.bringToFront(o), bottom: () => canvas.sendToBack(o) })[dir]();
    canvas.requestRenderAll();
    commit();
  }
  function setLocked(o, locked) {
    o.set({ selectable: !locked, evented: !locked });
    if (locked && canvas.getActiveObjects().includes(o)) canvas.discardActiveObject();
    canvas.requestRenderAll();
    commit();
    renderLayers();
  }

  // ---------- Layout: exact size in cm, alignment, distribution, groups ----------
  const unitsPerCm = () => rects().u / 2.54;
  function boxOf(o) {
    o.setCoords();
    return o.getBoundingRect(true, true);
  }
  /** Keep proportions: by default for text, photos, stickers and groups; shapes can stretch. */
  const ratioLocked = (o) => (typeof o.lockRatio === 'boolean' ? o.lockRatio : isText(o) || o.type === 'image' || o.type === 'group' || isSticker(o));
  function applyRatioLock(o) {
    if (!o || o.type === 'activeSelection' || !o.setControlsVisibility) return;
    const free = !ratioLocked(o);
    o.setControlsVisibility({ ml: free, mr: free, mt: free, mb: free });
  }
  function sizeCm(o) {
    const u = unitsPerCm();
    const r = boxOf(o);
    const a = area();
    return { w: o.getScaledWidth() / u, h: o.getScaledHeight() / u, x: (r.left - a.x) / u, y: (r.top - a.y) / u };
  }
  function setSizeCm(o, dim, cm) {
    const u = unitsPerCm();
    const c = o.getCenterPoint();
    const target = Math.max(0.2, cm) * u;
    // The measured size includes outlines, so correct the scale until it matches.
    for (let i = 0; i < 3; i++) {
      const now = dim === 'w' ? o.getScaledWidth() : o.getScaledHeight();
      if (!now || Math.abs(now - target) < 0.01) break;
      const k = target / now;
      if (dim === 'w') o.set(ratioLocked(o) ? { scaleX: o.scaleX * k, scaleY: o.scaleY * k } : { scaleX: o.scaleX * k });
      else o.set(ratioLocked(o) ? { scaleX: o.scaleX * k, scaleY: o.scaleY * k } : { scaleY: o.scaleY * k });
    }
    o.setPositionByOrigin(c, 'center', 'center');
    o.setCoords();
  }
  function setPosCm(o, axis, cm) {
    const u = unitsPerCm();
    const r = boxOf(o);
    const a = area();
    if (axis === 'x') o.set({ left: o.left + (a.x + cm * u - r.left) });
    else o.set({ top: o.top + (a.y + cm * u - r.top) });
    o.setCoords();
  }
  /** Run fn on the loose objects of the selection, then select them again. */
  function onSelectedObjects(fn) {
    const sel = active();
    if (!sel) return;
    const objs = canvas.getActiveObjects();
    const multi = sel.type === 'activeSelection';
    st.reselecting = true;
    if (multi) canvas.discardActiveObject();
    fn(objs);
    objs.forEach((o) => o.setCoords());
    if (multi) canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
    st.reselecting = false;
    canvas.requestRenderAll();
    commit();
    renderProps();
    renderFloatBar();
  }
  function unionBox(objs) {
    const rs = objs.map(boxOf);
    const left = Math.min(...rs.map((r) => r.left));
    const top = Math.min(...rs.map((r) => r.top));
    return { left, top, width: Math.max(...rs.map((r) => r.left + r.width)) - left, height: Math.max(...rs.map((r) => r.top + r.height)) - top };
  }
  /** Align to the selection's own box (several elements) or to the print area (one element). */
  function alignSelected(how) {
    onSelectedObjects((objs) => {
      const a = area();
      const box = objs.length > 1 ? unionBox(objs) : { left: a.x, top: a.y, width: a.w, height: a.h };
      for (const o of objs) {
        const r = boxOf(o);
        let dx = 0;
        let dy = 0;
        if (how === 'left') dx = box.left - r.left;
        if (how === 'right') dx = box.left + box.width - (r.left + r.width);
        if (how === 'hcenter') dx = box.left + box.width / 2 - (r.left + r.width / 2);
        if (how === 'top') dy = box.top - r.top;
        if (how === 'bottom') dy = box.top + box.height - (r.top + r.height);
        if (how === 'vcenter') dy = box.top + box.height / 2 - (r.top + r.height / 2);
        o.set({ left: o.left + dx, top: o.top + dy });
      }
    });
  }
  /** Equal gaps between three or more elements. */
  function distributeSelected(axis) {
    onSelectedObjects((objs) => {
      if (objs.length < 3) return;
      const k = axis === 'h' ? ['left', 'width'] : ['top', 'height'];
      const items = objs.map((o) => ({ o, r: boxOf(o) })).sort((p, q) => p.r[k[0]] - q.r[k[0]]);
      const first = items[0].r;
      const last = items[items.length - 1].r;
      const total = items.reduce((sum, it) => sum + it.r[k[1]], 0);
      const gap = (last[k[0]] + last[k[1]] - first[k[0]] - total) / (items.length - 1);
      let pos = first[k[0]] + first[k[1]] + gap;
      for (const it of items.slice(1, -1)) {
        const d = pos - it.r[k[0]];
        it.o.set(axis === 'h' ? { left: it.o.left + d } : { top: it.o.top + d });
        pos += it.r[k[1]] + gap;
      }
    });
  }
  function groupSelected() {
    const sel = active();
    if (!sel || sel.type !== 'activeSelection') return;
    st.reselecting = true;
    const g = sel.toGroup();
    st.reselecting = false;
    g.set({ lockRatio: true });
    applyClips();
    applyRatioLock(g);
    canvas.setActiveObject(g);
    canvas.requestRenderAll();
    commit();
    renderProps();
    renderLayers();
    renderFloatBar();
  }
  function ungroupSelected() {
    const g = active();
    if (!g || g.type !== 'group' || isSticker(g)) return;
    st.reselecting = true;
    const sel = g.toActiveSelection();
    st.reselecting = false;
    sel.getObjects().forEach(applyRatioLock);
    applyClips();
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
    commit();
    renderProps();
    renderLayers();
    renderFloatBar();
  }
  const ALIGN_ICONS = {
    left: '<path d="M4 3v18M8 7h12M8 15h7" />',
    hcenter: '<path d="M12 3v18M6 7h12M8.5 15h7" />',
    right: '<path d="M20 3v18M4 7h12M9 15h7" />',
    top: '<path d="M3 4h18M7 8v12M15 8v7" />',
    vcenter: '<path d="M3 12h18M7 6v12M15 8.5v7" />',
    bottom: '<path d="M3 20h18M7 4v12M15 9v7" />',
    dh: '<path d="M4 4v16M20 4v16M10 8h4v8h-4z" />',
    dv: '<path d="M4 4h16M4 20h16M8 10h8v4H8z" />',
  };
  const alignIcon = (k) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${ALIGN_ICONS[k]}</svg>`;
  function alignButtons(multi) {
    const b = (k, title) => `<button class="btn btn-sm btn-icon" data-align-to="${k}" title="${esc(t(title))}" aria-label="${esc(t(title))}">${alignIcon(k)}</button>`;
    return `<div class="align-row" dir="ltr">
      ${b('left', 'align.left')}${b('hcenter', 'align.hcenter')}${b('right', 'align.right')}
      ${b('top', 'align.top')}${b('vcenter', 'align.vcenter')}${b('bottom', 'align.bottom')}
    </div>
    <p class="muted small" style="margin:4px 0 0">${esc(t(multi ? 'align.toSelection' : 'align.toArea'))}</p>`;
  }
  /** The size and place boxes after one of them changed (the one being typed in is left alone). */
  function refreshCmBoxes(o, changed) {
    const z = sizeCm(o);
    const f = (v) => (Math.round(v * 10) / 10).toString();
    for (const [id, v] of [['p-wcm', z.w], ['p-hcm', z.h], ['p-xcm', z.x], ['p-ycm', z.y]]) {
      const el = $(id);
      if (el && v != null && !(el === document.activeElement && el !== changed)) el.value = f(v);
    }
  }
  function sizeGroup(o) {
    const z = sizeCm(o);
    const f = (v) => (Math.round(v * 10) / 10).toString();
    return group('size', t('grp.size'), `
      <div class="field grid-2">
        <div><label for="p-wcm">${esc(t('size.width'))}</label><input type="text" class="num-in" data-step="0.1" data-min="0.2" id="p-wcm" value="${f(z.w)}" inputmode="decimal" autocomplete="off"></div>
        <div><label for="p-hcm">${esc(t('size.height'))}</label><input type="text" class="num-in" data-step="0.1" data-min="0.2" id="p-hcm" value="${f(z.h)}" inputmode="decimal" autocomplete="off"></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" id="p-ratio" ${ratioLocked(o) ? 'checked' : ''}> ${esc(t('size.lockRatio'))}</label></div>
      <div class="field grid-2">
        <div><label for="p-xcm">${esc(t('size.x'))}</label><input type="text" class="num-in" data-step="0.1" id="p-xcm" value="${f(z.x)}" inputmode="decimal" autocomplete="off"></div>
        <div><label for="p-ycm">${esc(t('size.y'))}</label><input type="text" class="num-in" data-step="0.1" id="p-ycm" value="${f(z.y)}" inputmode="decimal" autocomplete="off"></div>
      </div>
      <div class="field">${alignButtons(false)}</div>`);
  }

  // ---------- Floating bar next to the selection ----------
  const FB = {
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    style: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor"/><path d="M12 21a3 3 0 0 1 0-6h2"/>',
    dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    group: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 7h6v6M7 11v6h6"/>',
    ungroup: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  };
  const fbIcon = (k) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${FB[k]}</svg>`;
  function hideFloatBar() {
    const bar = $('float-bar');
    if (bar) bar.hidden = true;
  }
  function renderFloatBar() {
    const bar = $('float-bar');
    if (!bar) return;
    const o = active();
    // Phones: the settings sheet has the same actions and the design area is small.
    if (!o || crop || st.preview || st.exporting || st.dragging || o.isEditing || (MOBILE.matches && st.sheet)) return hideFloatBar();
    const multi = o.type === 'activeSelection';
    const items = [];
    if (isText(o)) items.push(['edit-text', 'edit', 'fb.editText', true]);
    if (MOBILE.matches) items.push(['open-props', 'style', multi ? 'fb.arrange' : 'fb.style', true]);
    if (multi) items.push(['group', 'group', 'group.make', false]);
    if (o.type === 'group' && !isSticker(o)) items.push(['ungroup', 'ungroup', 'group.ungroup', false]);
    if (!multi) items.push(['duplicate', 'dup', 'props.duplicate', false], ['up', 'up', 'props.forward', false], ['down', 'down', 'props.backward', false]);
    items.push(['delete', 'del', multi ? 'props.deleteSelected' : 'props.delete', false]);
    bar.innerHTML = items.map(([act, icon, key, label]) =>
      `<button type="button" data-fb="${act}" class="${act === 'delete' ? 'danger' : ''}" title="${esc(t(key))}" aria-label="${esc(t(key))}">${fbIcon(icon)}${label ? `<span>${esc(t(key))}</span>` : ''}</button>`).join('');
    bar.hidden = false;
    positionFloatBar();
  }
  /** Below the element (the rotate handle is above it), or above when there is no room. */
  function positionFloatBar() {
    const bar = $('float-bar');
    const o = active();
    if (!bar || bar.hidden || !o) return;
    o.setCoords();
    const r = o.getBoundingRect();
    const cv = canvas.upperCanvasEl.getBoundingClientRect();
    const wrap = bar.parentElement.getBoundingClientRect();
    const stage = $('stage').getBoundingClientRect();
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const gap = COARSE ? 30 : 18;
    let x = cv.left + r.left + r.width / 2 - bw / 2;
    let y = cv.top + r.top + r.height + gap;
    if (y + bh > stage.bottom - 6) y = cv.top + r.top - bh - (COARSE ? 64 : 48);
    x = Math.max(stage.left + 6, Math.min(x, stage.right - bw - 6));
    y = Math.max(stage.top + 6, Math.min(y, stage.bottom - bh - 6));
    bar.style.transform = `translate(${Math.round(x - wrap.left)}px, ${Math.round(y - wrap.top)}px)`;
  }
  $('stage').addEventListener('scroll', positionFloatBar, { passive: true });
  window.addEventListener('resize', () => requestAnimationFrame(positionFloatBar));
  $('float-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fb]');
    const o = active();
    if (!btn || !o) return;
    const act = btn.dataset.fb;
    if (act === 'edit-text' && isText(o)) {
      hideFloatBar();
      o.enterEditing();
      o.selectAll();
      if (o.hiddenTextarea) o.hiddenTextarea.focus();
      canvas.requestRenderAll();
      return;
    }
    if (act === 'open-props') return setSheet('props');
    if (act === 'group') return groupSelected();
    if (act === 'ungroup') return ungroupSelected();
    if (act === 'duplicate') duplicateSelected();
    if (act === 'up' || act === 'down') layer(act);
    if (act === 'delete') return removeSelected();
    requestAnimationFrame(renderFloatBar);
  });

  // ---------- Properties panel ----------
  const props = $('props');
  const PALETTE = ['#16181d', '#ffffff', '#ff5a36', '#e03131', '#f783ac', '#fcc419', '#e0a526', '#2f9e44', '#1c7ed6', '#22304f', '#7048e8', '#8d6e63'];
  const MASKS = ['none', 'circle', 'rounded', 'heart', 'star', 'hexagon', 'arch'];
  const openGroups = new Set(['text', 'fx', 'colours', 'photo']);
  const group = (id, title, body) =>
    `<details class="pgroup" data-group="${id}" ${openGroups.has(id) ? 'open' : ''}><summary>${esc(title)}</summary><div class="pgroup-body">${body}</div></details>`;
  const palette = (target) =>
    `<div class="palette">${PALETTE.map((c) => `<button type="button" class="pal" data-pal="${target}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`;
  const isSticker = (o) => typeof o.name === 'string' && o.name.startsWith('sticker:');
  const isGradient = (f) => f && typeof f === 'object' && Array.isArray(f.colorStops);
  const makeGradient = (c1, c2) => new fabric.Gradient({
    type: 'linear', gradientUnits: 'percentage', coords: { x1: 0, y1: 0, x2: 0, y2: 1 },
    colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }],
  });
  props.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.dataset && d.dataset.group) d.open ? openGroups.add(d.dataset.group) : openGroups.delete(d.dataset.group);
  }, true);

  function fontPicker(o) {
    const opt = (f, sample) => `<button type="button" class="font-option ${f === o.fontFamily ? 'active' : ''}" data-font="${esc(f)}" style="font-family:'${esc(f)}'">${sample}<small>${esc(f)}</small></button>`;
    return `
      <details class="font-picker" id="p-font-picker">
        <summary style="font-family:'${esc(o.fontFamily)}'" aria-label="${esc(t('props.font'))}">${esc(o.fontFamily)}</summary>
        <div class="font-list">
          <div class="group">${esc(t('props.fontsArabic'))}</div>
          ${D.FONTS.arabic.map((f) => opt(f, 'أبجد هوز')).join('')}
          <div class="group">${esc(t('props.fontsEnglish'))}</div>
          ${D.FONTS.english.map((f) => opt(f, 'Aa Bb Cc')).join('')}
        </div>
      </details>`;
  }

  function fillControls(o) {
    const grad = isGradient(o.fill);
    const hollow = !grad && (!o.fill || o.fill === 'transparent');
    const c1 = grad ? o.fill.colorStops[0].color : hollow ? '#ffffff' : o.fill;
    const c2 = grad ? o.fill.colorStops[o.fill.colorStops.length - 1].color : D.ACCENT;
    return `
      <div class="field">
        <label>${esc(t('props.fillStyle'))}</label>
        <div class="btn-group">
          <button class="btn btn-sm ${grad ? '' : 'active'}" data-fillmode="solid">${esc(t('props.solid'))}</button>
          <button class="btn btn-sm ${grad ? 'active' : ''}" data-fillmode="gradient">${esc(t('props.gradient'))}</button>
        </div>
      </div>
      ${grad
        ? `<div class="field row"><input class="shrink" type="color" id="p-grad1" value="${toHex(c1)}"><span class="grad-preview" style="background:linear-gradient(90deg, ${toHex(c1)}, ${toHex(c2)})"></span><input class="shrink" type="color" id="p-grad2" value="${toHex(c2)}"></div>`
        : `<div class="field color-row"><input type="color" id="p-fill" value="${toHex(c1)}" aria-label="${esc(t('props.colour'))}">${palette('fill')}</div>`}
      <div class="field"><label class="check"><input type="checkbox" id="p-nofill" ${hollow ? 'checked' : ''}> ${esc(t(isText(o) ? 'props.hollow' : 'props.none'))}</label></div>`;
  }

  function outlineControls(o, max) {
    return `
      <div class="field">
        <label>${esc(t('props.outline'))}</label>
        <div class="color-row"><input type="color" id="p-stroke" value="${toHex(o.stroke || '#000000')}" aria-label="${esc(t('props.outline'))}">${palette('stroke')}</div>
        <input type="range" id="p-stroke-w" min="0" max="${max}" step="0.5" value="${numv(o.strokeWidth)}" aria-label="${esc(t('props.outlineWidth'))}">
      </div>`;
  }

  function arrangeGroup(o) {
    return group('arrange', t('grp.arrange'), `
      <div class="field grid-2">
        <div><label for="p-opacity">${esc(t('props.opacity'))}</label><input type="range" id="p-opacity" min="0.05" max="1" step="0.05" value="${numv(o.opacity, 1)}"></div>
        <div><label for="p-angle">${esc(t('props.rotation'))}</label><input type="text" class="num-in" data-step="1" data-min="-360" data-max="360" id="p-angle" value="${Math.round(o.angle)}" autocomplete="off"></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" id="p-shadow" ${o.shadow ? 'checked' : ''}> ${esc(t('props.shadow'))}</label></div>
      <div class="grid-4" dir="ltr">
        <button class="btn btn-sm" data-act="flip-x" title="${esc(t('props.flipH'))}">⇋</button>
        <button class="btn btn-sm" data-act="flip-y" title="${esc(t('props.flipV'))}">⇵</button>
        <button class="btn btn-sm" data-act="top" title="${esc(t('props.front'))}">⤒</button>
        <button class="btn btn-sm" data-act="bottom" title="${esc(t('props.back'))}">⤓</button>
      </div>`);
  }

  const ICON = {
    dup: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    del: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };
  function quickActions() {
    return `<div class="quick-actions" dir="ltr">
      <button class="btn btn-sm" data-act="duplicate" title="${esc(t('props.duplicate'))}" aria-label="${esc(t('props.duplicate'))}">${ICON.dup}</button>
      <button class="btn btn-sm" data-act="center-h" title="${esc(t('props.centerH'))}">↔</button>
      <button class="btn btn-sm" data-act="center-v" title="${esc(t('props.centerV'))}">↕</button>
      <button class="btn btn-sm" data-act="up" title="${esc(t('props.forward'))}">▲</button>
      <button class="btn btn-sm" data-act="down" title="${esc(t('props.backward'))}">▼</button>
      <button class="btn btn-sm btn-danger" data-act="delete" title="${esc(t('props.delete'))}" aria-label="${esc(t('props.delete'))}">${ICON.del}</button>
    </div>`;
  }

  /**
   * What is selected comes first in the side panel, above the product settings (a ready design's long product,
   * size and print-place settings pushed the text's font and colour out of sight: owner, 25 Nov). A new selection
   * scrolls the panel back to its top, so its settings are in view. (Phones show one sheet at a time anyway.)
   */
  let propsFor = null;
  function placeProps(o) {
    const sec = $('sec-props');
    const prod = $('sec-product');
    const check = $('sec-check');
    if (!sec || !prod || !check) return;
    if (o && sec.nextElementSibling !== prod) prod.before(sec);
    if (!o && check.nextElementSibling !== sec) check.after(sec);
    if (o && o !== propsFor) {
      const scroller = sec.closest('.panel-scroll');
      if (scroller) scroller.scrollTop = 0;
    }
    propsFor = o || null;
  }
  function renderProps() {
    const o = active();
    const box = $('props');
    placeProps(o || (crop ? crop : null));
    $('props-title').textContent = t('panel.selected');
    if (crop) {
      $('props-title').textContent = t('props.crop');
      box.innerHTML = `
        <p class="muted small" style="margin-top:0">${esc(t('props.cropHint'))}</p>
        <div class="field"><div class="btn-group">
          <button class="btn btn-sm ${crop.square ? '' : 'active'}" data-act="crop-free">${esc(t('props.cropFree'))}</button>
          <button class="btn btn-sm ${crop.square ? 'active' : ''}" data-act="crop-square">${esc(t('props.cropSquare'))}</button>
        </div></div>
        <div class="grid-2">
          <button class="btn btn-primary btn-sm" data-act="crop-apply">${esc(t('props.cropApply'))}</button>
          <button class="btn btn-sm" data-act="crop-cancel">${esc(t('props.cropCancel'))}</button>
        </div>`;
      syncSheetTitle();
      return;
    }
    if (!o) {
      box.innerHTML = `<p class="empty-props">${esc(t('panel.empty'))}<br><br><span class="small">${esc(t('panel.tip'))}</span></p>`;
      syncSheetTitle();
      return;
    }
    if (o.type === 'activeSelection') {
      $('props-title').textContent = t('panel.nSelected', { n: o.size() });
      const n = o.size();
      box.innerHTML = `
        <div class="field"><label>${esc(t('align.title'))}</label>${alignButtons(true)}</div>
        <div class="field"><label>${esc(t('align.distribute'))}</label>
          <div class="grid-2">
            <button class="btn btn-sm" data-distribute="h" ${n < 3 ? 'disabled' : ''}>${alignIcon('dh')} ${esc(t('align.distH'))}</button>
            <button class="btn btn-sm" data-distribute="v" ${n < 3 ? 'disabled' : ''}>${alignIcon('dv')} ${esc(t('align.distV'))}</button>
          </div>
          ${n < 3 ? `<p class="muted small" style="margin:4px 0 0">${esc(t('align.distHint'))}</p>` : ''}
        </div>
        <div class="grid-2">
          <button class="btn btn-sm" data-act="center-h">${esc(t('props.centerH'))}</button>
          <button class="btn btn-sm" data-act="center-v">${esc(t('props.centerV'))}</button>
        </div>
        <button class="btn btn-sm btn-block" data-act="group" style="margin-top:8px">${esc(t('group.make'))}</button>
        <button class="btn btn-sm btn-block btn-danger" data-act="delete" style="margin-top:8px">${esc(t('props.deleteSelected'))}</button>`;
      syncSheetTitle();
      return;
    }
    const text = isText(o);
    const image = o.type === 'image';
    const sticker = isSticker(o);
    $('props-title').textContent = text ? t('panel.text') : image ? t('panel.image') : layerName(o);
    let html = quickActions();

    if (text) {
      const arabic = D.ARABIC_RE.test(o.text);
      html += group('text', t('grp.text'), `
        <div class="field"><textarea id="p-text" rows="2" dir="auto">${esc(o.text)}</textarea></div>
        <div class="field">${fontPicker(o)}</div>
        <div class="field row">
          <input type="text" class="num-in" data-step="1" data-min="4" data-max="400" inputmode="numeric" autocomplete="off" id="p-size" value="${Math.round(o.fontSize)}" aria-label="${esc(t('props.size'))}" title="${esc(t('props.size'))}" style="max-width:84px">
          <div class="btn-group">
            <button class="btn btn-sm ${o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 ? 'active' : ''}" data-toggle="bold" title="${esc(t('props.bold'))}"><b>B</b></button>
            <button class="btn btn-sm ${o.fontStyle === 'italic' ? 'active' : ''}" data-toggle="italic" title="${esc(t('props.italic'))}"><i>I</i></button>
            <button class="btn btn-sm ${o.underline ? 'active' : ''}" data-toggle="underline" title="${esc(t('props.underline'))}"><u>U</u></button>
          </div>
        </div>
        <div class="field btn-group" dir="ltr">
          ${['left', 'center', 'right'].map((al) => `<button class="btn btn-sm ${o.textAlign === al ? 'active' : ''}" data-align="${al}" title="${esc(t('props.align' + al[0].toUpperCase() + al.slice(1)))}">${{ left: '⇤', center: '↔', right: '⇥' }[al]}</button>`).join('')}
        </div>`);
      if (!laser()) html += textFxGroup(o);
      html += group('colours', t(laser() ? 'laser.toneTitle' : 'grp.colours'), laser() ? laserNote() : fillControls(o) + `<div class="word-ctl">${wordControls(o)}</div>` + outlineControls(o, 12));
      html += group('effects', t('grp.effects'), `
        <div class="field">
          <label for="p-curve">${esc(t('props.curve'))}</label>
          <div class="row"><input type="range" id="p-curve" min="-100" max="100" step="5" value="${numv(o.curve)}"><button class="btn btn-sm shrink" data-act="straighten">${esc(t('props.straighten'))}</button></div>
        </div>
        ${laser() ? '' : `        <div class="field">
          <label class="check"><input type="checkbox" id="p-textbg" ${o.backgroundColor ? 'checked' : ''}> ${esc(t('props.textBg'))}</label>
          ${o.backgroundColor ? `<div class="color-row" style="margin-top:6px"><input type="color" id="p-bgcolor" value="${toHex(o.backgroundColor)}">${palette('bg')}</div>
          <div class="btn-group bg-shapes" style="margin-top:6px">${['box', 'pill', 'banner', 'ticket'].map((k) => `<button type="button" class="btn btn-sm ${(o.bgShape || 'box') === k ? 'active' : ''}" data-bgshape="${k}" title="${esc(t('bgshape.' + k))}"><span class="bgs bgs-${k}"></span>${esc(t('bgshape.' + k))}</button>`).join('')}</div>` : ''}
        </div>`}
        <div class="field grid-2">
          <div><label for="p-spacing">${esc(t('props.spacing'))}</label>${arabic ? `<div class="muted small">${esc(t('props.spacingArabic'))}</div>` : `<input type="range" id="p-spacing" min="-100" max="800" step="10" value="${numv(o.charSpacing)}">`}</div>
          <div><label for="p-lh">${esc(t('props.lineHeight'))}</label><input type="range" id="p-lh" min="0.7" max="2.5" step="0.05" value="${numv(o.lineHeight, 1.16)}"></div>
        </div>`);
    } else if (image) {
      const fs = filterState(o);
      html += `<div class="field" id="quality-box"></div>`;
      html += group('photo', t('grp.photo'), `
        <div class="field grid-2">
          <button class="btn btn-sm" data-act="crop">✂ ${esc(t('props.crop'))}</button>
          <button class="btn btn-sm" data-act="fit">${esc(t('props.fit'))}</button>
        </div>
        <div class="field">
          <label>${esc(t('props.photoShape'))}</label>
          <div class="mask-grid">${MASKS.map((m) => `<button class="mask-btn ${(o.mask || 'none') === m ? 'active' : ''}" data-mask="${m}" title="${esc(t('mask.' + m))}"><span class="mask-icon mask-${m}"></span><small>${esc(t('mask.' + m))}</small></button>`).join('')}</div>
        </div>
        ${o.mask ? `<div class="field"><label>${esc(t('props.border'))}</label>${laser() ? '' : `<div class="color-row"><input type="color" id="p-bordercolor" value="${toHex(o.maskBorderColor)}">${palette('border')}</div>`}<input type="range" id="p-border" min="0" max="12" step="0.5" value="${numv(o.maskBorder)}" aria-label="${esc(t('props.border'))}"></div>` : ''}
        ${boostBox(o)}
        <div class="field">
          <button class="btn btn-sm btn-block" data-act="removebg">✦ ${esc(t('props.removeBg'))}</button>
          <p class="muted small" style="margin:6px 0 0">${esc(t('props.removeBgHint'))}</p>
        </div>`);
      html += group('adjust', t('grp.adjust'), `
        ${['brightness', 'contrast', 'saturation'].map((k) => `<div class="field"><label for="p-${k}">${esc(t('props.' + k))}</label><input type="range" id="p-${k}" data-adjust="${k}" min="-100" max="100" step="5" value="${Math.round(fs[k] * 100)}"></div>`).join('')}
        <div class="field toggles" ${laser() ? 'hidden' : ''}>
          <label class="check"><input type="checkbox" data-filter="gray" ${fs.gray ? 'checked' : ''}> ${esc(t('props.grayscale'))}</label>
          <label class="check"><input type="checkbox" data-filter="sepia" ${fs.sepia ? 'checked' : ''}> ${esc(t('props.sepia'))}</label>
        </div>
        <button class="btn btn-sm" data-act="reset-adjust">${esc(t('props.reset'))}</button>`);
    } else if (!sticker && o.type !== 'group') {
      html += group('colours', t(laser() ? 'laser.toneTitle' : 'grp.colours'), (laser() ? laserNote() : fillControls(o) + outlineControls(o, 30)) +
        (o.type === 'rect' ? `<div class="field"><label for="p-rx">${esc(t('props.radius'))}</label><input type="range" id="p-rx" min="0" max="${Math.round(Math.min(o.width, o.height) / 2)}" value="${numv(o.rx)}"></div>` : ''));
    }
    if (o.type === 'group' && !isSticker(o)) html += `<button class="btn btn-sm btn-block" data-act="ungroup" style="margin-bottom:10px">${esc(t('group.ungroup'))}</button>`;
    html += sizeGroup(o);
    html += arrangeGroup(o);
    box.innerHTML = html;
    if (image) updateQuality();
    syncSheetTitle();
  }

  /** Laser products: one tone, so instead of colour pickers a word on how it will look. */
  function laserNote() {
    const c = color();
    return `<div class="field laser-note"><span class="laser-swatch" style="background:${esc(c.hex)}"><i style="background:${esc(inkOf())}"></i></span>
      <p class="small" style="margin:0">${esc(t(laser().kind === 'cut' ? 'laser.noteCut' : 'laser.noteEngrave', { material: tr(c.name) }))}</p></div>`;
  }
  function toHex(c) {
    if (typeof c !== 'string') return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    try {
      return '#' + new fabric.Color(c).toHex();
    } catch (e) {
      return '#000000';
    }
  }

  function updateQuality() {
    const o = active();
    const box = $('quality-box');
    if (!o || o.type !== 'image' || !box) return;
    const dpi = imageDpi(o);
    const [cls, word] = dpi >= 150 ? ['good', t('props.qualityGreat')] : dpi >= 100 ? ['ok', t('props.qualityOk')] : ['low', t('props.qualityLow')];
    box.innerHTML = `<div class="quality ${cls}">${esc(t('props.quality', { word, dpi }))}</div>`;
  }

  function syncTextField() {
    const o = active();
    const f = $('p-text');
    if (o && f && document.activeElement !== f) f.value = o.text;
  }

  function setProp(propsToSet, { commitNow = false } = {}) {
    const o = active();
    if (!o) return;
    o.set(propsToSet);
    if ('text' in propsToSet) fixArabic(o);
    if (o.initDimensions) o.initDimensions();
    o.setCoords();
    o.dirty = true;
    canvas.requestRenderAll();
    commitNow ? commit() : scheduleCommit();
  }

  /** fetch, with the shop's own message (not the browser's "Failed to fetch") when the connection drops. */
  async function netFetch(url, opts) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      const err = new Error(t('msg.network'));
      err.network = true;
      throw err;
    }
  }
  /** A number for a slider (values in a shared or saved design are never put into the page as they are). */
  function numv(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

  // ---------- Text styles (one tap) ----------
  const TEXT_FX = ['none', 'shadow', 'neon', 'extrude', 'retro', 'outline', 'sticker', 'sunset', 'gold', 'ocean'];
  const hexToRgb = (h) => { const n = parseInt(toHex(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixHex = (a, b, k) => '#' + hexToRgb(a).map((v, i) => Math.round(v + (hexToRgb(b)[i] - v) * k).toString(16).padStart(2, '0')).join('');
  // Neon lightens the letters: the chosen colour is kept (fxBase) so "None" or another style brings it back.
  const neonGlow = (base) => { const lum = POD.luminance(base); return lum < 0.12 || lum > 0.92 ? '#ff2d95' : base; };
  const neonFill = (base) => mixHex(neonGlow(base), '#ffffff', 0.6);
  /** The text's main colour, whatever its current fill is. */
  function baseColour(o) {
    // Still the neon letters of the colour chosen before (not recoloured since): that colour.
    if (o.textFx === 'neon' && o.fxBase && typeof o.fill === 'string' && toHex(o.fill) === neonFill(o.fxBase)) return toHex(o.fxBase);
    if (isGradient(o.fill)) return toHex(o.fill.colorStops[0].color);
    if (o.fill && o.fill !== 'transparent') return toHex(o.fill);
    if (o.stroke) return toHex(o.stroke);
    return inkFor(surfaceHex());
  }
  function textFxProps(o, id) {
    const fs = o.fontSize;
    const sc = Math.abs(o.scaleX || 1);
    const base = baseColour(o);
    const lum = POD.luminance(base);
    const plain = { shadow: null, stroke: null, strokeWidth: 0, fill: base, textFx: id === 'none' ? null : id, fxBase: null };
    const shadow = (color, blur, off) => new fabric.Shadow({ color, blur: fs * blur, offsetX: fs * off, offsetY: fs * off });
    switch (id) {
      case 'shadow': return { ...plain, shadow: shadow('rgba(0,0,0,0.38)', 0.14, 0.06) };
      case 'neon': {
        const glow = neonGlow(base);
        return { ...plain, fill: neonFill(base), fxBase: base, shadow: new fabric.Shadow({ color: glow, blur: fs * 0.42, offsetX: 0, offsetY: 0 }) };
      }
      case 'extrude': return { ...plain, shadow: shadow(mixHex(base, lum < 0.2 ? '#ffffff' : '#000000', 0.45), 0, 0.07) };
      case 'retro': return { ...plain, stroke: '#16181d', strokeWidth: fs * sc * 0.045, strokeUniform: true, paintFirst: 'stroke', shadow: shadow(lum > 0.6 ? D.ACCENT : '#fcc419', 0, 0.09) };
      case 'outline': return { ...plain, fill: 'transparent', stroke: base, strokeWidth: Math.max(1.5, fs * sc * 0.04), strokeUniform: true, paintFirst: 'stroke' };
      case 'sticker': return { ...plain, stroke: '#ffffff', strokeWidth: fs * sc * 0.14, strokeUniform: true, paintFirst: 'stroke', strokeLineJoin: 'round', shadow: shadow('rgba(0,0,0,0.28)', 0.12, 0.03) };
      case 'sunset': return { ...plain, fill: makeGradient('#ff5a36', '#fcc419') };
      case 'gold': return { ...plain, fill: makeGradient('#f7d774', '#b8860b'), stroke: '#7a5a10', strokeWidth: Math.max(1, fs * sc * 0.015), strokeUniform: true, paintFirst: 'stroke' };
      case 'ocean': return { ...plain, fill: makeGradient('#22d3ee', '#1c3faa') };
      default: return plain;
    }
  }
  function textFxGroup(o) {
    const sample = D.ARABIC_RE.test(o.text) ? 'أبج' : 'Abc';
    return group('fx', t('grp.textFx'), `
      <div class="fx-grid">${TEXT_FX.map((id) => `<button type="button" class="fx-chip ${(o.textFx || 'none') === id ? 'active' : ''}" data-fx="${id}" title="${esc(t('fx.' + id))}">
        <span class="fx-sample fx-${id}" style="font-family:'${esc(o.fontFamily)}'">${sample}</span><small>${esc(t('fx.' + id))}</small></button>`).join('')}</div>`);
  }
  // ---------- Colour single words ----------
  function wordsOf(o) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(o.text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }
  /**
   * The word chosen for colouring (st.wordSel, its place in the list) after the text changed:
   * followed by where it starts (st.wordSelAt), so typing words before it does not hand the
   * colour to another word; forgotten when its first letter was deleted or typed over.
   */
  function followWordSel(o, words) {
    const at = st.wordSelAt;
    if (st.wordSel == null || !at) {
      if (st.wordSel != null && !words[st.wordSel]) st.wordSel = null;
      return;
    }
    let pos = at.start;
    if (at.text !== o.text) {
      // The changed stretch: what the old and the new text do not share at their start and end.
      const was = at.text;
      const now = o.text;
      let a = 0;
      while (a < was.length && a < now.length && was[a] === now[a]) a++;
      let z = 0;
      while (z < was.length - a && z < now.length - a && was[was.length - 1 - z] === now[now.length - 1 - z]) z++;
      if (pos >= was.length - z) pos += now.length - was.length; // changed before the word: it moved
      else if (pos >= a) pos = -1; // its first letter changed: not the chosen word any more
    }
    const i = words.findIndex((w) => w.start <= pos && pos < w.end);
    st.wordSel = i < 0 ? null : i;
    st.wordSelAt = i < 0 ? null : { text: o.text, start: words[i].start };
  }
  /**
   * A place in the text as Fabric counts it (letters as drawn: an emoji is one, though it is two JavaScript
   * characters). wordsOf() counts JavaScript characters, as the rest of the word tools do (QA 25 Nov: an emoji
   * before the word coloured the wrong letters).
   */
  const fabricAt = (o, i) => {
    const split = fabric.util.string.graphemeSplit;
    return split ? split(String(o.text || '').slice(0, i)).length : i;
  };
  function wordColour(o, w) {
    const st0 = o.getSelectionStyles ? o.getSelectionStyles(fabricAt(o, w.start), fabricAt(o, w.start) + 1)[0] : null;
    return toHex((st0 && st0.fill) || (isGradient(o.fill) || o.fill === 'transparent' ? baseColour(o) : o.fill));
  }
  const wordChips = (o, words) => words.map((w, i) => `<button type="button" class="word-chip ${st.wordSel === i ? 'active' : ''}" data-word="${i}" style="color:${wordColour(o, w)}">${esc(w.text)}</button>`).join('');
  /** The words as typed so far (the text box keeps its focus; the rest of the panel stays). */
  function refreshWordChips(o) {
    const box = props.querySelector('.word-chips');
    // One word becoming two (or a text typed again from empty): the whole "colour one word" part appears,
    // and goes again when the text is down to one word (QA 25 Nov).
    const holder = props.querySelector('.word-ctl');
    if (!box || wordsOf(o).length < 2) {
      if (holder) holder.innerHTML = wordControls(o);
      return;
    }
    const words = wordsOf(o);
    const had = st.wordSel;
    followWordSel(o, words);
    // (The chosen word gone: the colour boxes go too.)
    if (had != null && st.wordSel == null && holder) {
      holder.innerHTML = wordControls(o);
      return;
    }
    box.innerHTML = wordChips(o, words);
  }
  function wordControls(o) {
    if (o.type !== 'i-text' || !o.setSelectionStyles) return '';
    const words = wordsOf(o);
    if (words.length < 2) return '';
    followWordSel(o, words);
    const styled = o.styles && Object.values(o.styles).some((l) => l && Object.keys(l).length);
    return `<div class="field">
      <label>${esc(t('words.title'))}</label>
      <div class="word-chips" dir="auto">${wordChips(o, words)}</div>
      ${st.wordSel != null
        ? `<div class="color-row" style="margin-top:6px"><input type="color" id="p-wordcolor" value="${wordColour(o, words[st.wordSel])}" aria-label="${esc(t('words.colour'))}">${palette('word')}</div>`
        : `<p class="muted small" style="margin:4px 0 0">${esc(t('words.hint'))}</p>`}
      ${styled ? `<button type="button" class="btn btn-sm" data-act="reset-words" style="margin-top:6px">${esc(t('words.reset'))}</button>` : ''}
    </div>`;
  }
  function setWordColour(o, colour) {
    const words = wordsOf(o);
    followWordSel(o, words);
    const w = words[st.wordSel];
    if (!w) return;
    o.setSelectionStyles({ fill: colour }, fabricAt(o, w.start), fabricAt(o, w.end));
    o.dirty = true;
    canvas.requestRenderAll();
  }

  function shadowFor(o) {
    const s = Math.max(1.5, Math.min(o.width, o.height) * 0.035);
    return new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: s * 2, offsetX: s, offsetY: s });
  }

  // ----- Photo filters -----
  const ADJUST = { brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation' };
  function filterState(o) {
    const get = (type) => (o.filters || []).find((f) => f && f.type === type);
    return {
      white: !!get('RemoveColor'),
      gray: !!get('Grayscale'),
      sepia: !!get('Sepia'),
      brightness: get('Brightness')?.brightness || 0,
      contrast: get('Contrast')?.contrast || 0,
      saturation: get('Saturation')?.saturation || 0,
    };
  }
  let filterTimer = null;
  function applyFilterState(o, s, { now = false } = {}) {
    const F = fabric.Image.filters;
    const list = [];
    if (s.white) list.push(new F.RemoveColor({ color: '#ffffff', distance: 0.12 }));
    if (s.brightness) list.push(new F.Brightness({ brightness: s.brightness }));
    if (s.contrast) list.push(new F.Contrast({ contrast: s.contrast }));
    if (s.saturation) list.push(new F.Saturation({ saturation: s.saturation }));
    if (s.gray) list.push(new F.Grayscale());
    if (s.sepia) list.push(new F.Sepia());
    o.filters = laser() ? engraveFilters({ filters: list }) : list;
    clearTimeout(filterTimer);
    const run = () => {
      o.applyFilters();
      o.dirty = true;
      canvas.requestRenderAll();
      commit();
    };
    now ? run() : (filterTimer = setTimeout(run, 120));
  }

  /** The AI on the server cuts out the subject (people, pets, products) from any background. */
  async function aiRemoveBackground(el) {
    const w = el.naturalWidth || el.width;
    const h = el.naturalHeight || el.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(el, 0, 0, w, h);
    const jpg = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.93));
    const res = await netFetch('/api/remove-bg', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-lang': POD.lang, 'x-max-px': String(Math.max(w, h)) }, body: jpg });
    if (!res.ok) {
      const body = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null;
      const err = new Error((body && body.error) || t('msg.removeBgNone'));
      err.status = res.status;
      throw err;
    }
    return res.blob();
  }
  async function removeImageBackground(o) {
    busy(true, t('busy.removingBgAi'));
    try {
      await new Promise((r) => setTimeout(r, 40)); // let the overlay paint first
      const el = o._originalElement || o.getElement();
      let blob = null;
      try {
        blob = await aiRemoveBackground(el);
      } catch (e) {
        // AI not available (or the server is busy): the quick plain-background method still helps logos on white.
        if (e.status && e.status !== 503) throw e;
        blob = await window.POD_FX.removeBackground(el);
        if (!blob) {
          toast(e.message || t('msg.removeBgNone'), 'error');
          return;
        }
      }
      if (!blob) {
        toast(t('msg.removeBgNone'), 'error');
        return;
      }
      const img = await loadHtmlImage(URL.createObjectURL(blob));
      o.setElement(img, { width: o.width, height: o.height, cropX: o.cropX, cropY: o.cropY });
      if (o.filters && o.filters.length) o.applyFilters();
      o.dirty = true;
      canvas.requestRenderAll();
      commit();
      renderProps();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy(false);
    }
  }

  // ----- Crop -----
  let crop = null;
  function startCrop(img) {
    if (crop) return;
    const el = img.getElement();
    const fullW = el.naturalWidth || el.width;
    const fullH = el.naturalHeight || el.height;
    const sx = img.scaleX;
    const sy = img.scaleY;
    const prev = { cropX: img.cropX, cropY: img.cropY, width: img.width, height: img.height, angle: img.angle, center: img.getCenterPoint() };
    img.rotate(0);
    const c = img.getCenterPoint();
    const visL = c.x - (img.width * sx) / 2;
    const visT = c.y - (img.height * sy) / 2;
    const dispX = img.flipX ? fullW - img.cropX - img.width : img.cropX;
    const dispY = img.flipY ? fullH - img.cropY - img.height : img.cropY;
    const full = { L: visL - dispX * sx, T: visT - dispY * sy, W: fullW * sx, H: fullH * sy };
    img.set({ cropX: 0, cropY: 0, width: fullW, height: fullH });
    img.setPositionByOrigin(new fabric.Point(full.L + full.W / 2, full.T + full.H / 2), 'center', 'center');
    img.setCoords();
    const cropper = new fabric.Rect({
      name: '__cropper', left: c.x, top: c.y, width: prev.width * sx, height: prev.height * sy,
      fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 1.5, strokeDashArray: [6, 4], strokeUniform: true,
      cornerColor: '#ffffff', cornerStrokeColor: '#16181d', borderColor: '#ffffff', lockRotation: true,
      excludeFromExport: true, noScaleCache: false, padding: 0,
    });
    cropper.setControlsVisibility({ mtr: false });
    const others = canvas.getObjects().map((o) => [o, o.selectable, o.evented]);
    others.forEach(([o]) => o.set({ selectable: false, evented: false }));
    crop = { img, cropper, prev, full, sx, sy, fullW, fullH, others, square: false };
    st.silent = true;
    canvas.add(cropper);
    st.silent = false;
    cropper.clipPath = null;
    canvas.setActiveObject(cropper);
    canvas.requestRenderAll();
    renderProps();
  }
  function cropRect() {
    const c = crop.cropper;
    const p = c.getCenterPoint();
    const w = c.width * c.scaleX;
    const h = c.height * c.scaleY;
    return { x: p.x - w / 2, y: p.y - h / 2, w, h };
  }
  function clampCropper() {
    const f = crop.full;
    const c = crop.cropper;
    let { x, y, w, h } = cropRect();
    w = Math.min(w, f.W);
    h = Math.min(h, f.H);
    x = Math.min(Math.max(x, f.L), f.L + f.W - w);
    y = Math.min(Math.max(y, f.T), f.T + f.H - h);
    c.set({ scaleX: w / c.width, scaleY: h / c.height });
    c.setPositionByOrigin(new fabric.Point(x + w / 2, y + h / 2), 'center', 'center');
    c.setCoords();
  }
  function setCropSquare(on) {
    crop.square = on;
    const c = crop.cropper;
    c.setControlsVisibility({ ml: !on, mr: !on, mt: !on, mb: !on });
    if (on) {
      const { x, y, w, h } = cropRect();
      const s = Math.min(w, h);
      c.set({ scaleX: s / c.width, scaleY: s / c.height });
      c.setPositionByOrigin(new fabric.Point(x + w / 2, y + h / 2), 'center', 'center');
      clampCropper();
    }
    canvas.requestRenderAll();
    renderProps();
  }
  function finishCrop() {
    st.silent = true;
    canvas.remove(crop.cropper);
    st.silent = false;
    crop.others.forEach(([o, sel, ev]) => o.set({ selectable: sel, evented: ev }));
    const img = crop.img;
    crop = null;
    canvas.setActiveObject(img);
    canvas.requestRenderAll();
    renderProps();
  }
  function applyCrop() {
    const { img, full, sx, sy, fullW, fullH, prev } = crop;
    const r = cropRect();
    let x = Math.max(0, Math.round((r.x - full.L) / sx));
    let y = Math.max(0, Math.round((r.y - full.T) / sy));
    const w = Math.max(4, Math.min(fullW - x, Math.round(r.w / sx)));
    const h = Math.max(4, Math.min(fullH - y, Math.round(r.h / sy)));
    if (img.flipX) x = fullW - x - w;
    if (img.flipY) y = fullH - y - h;
    img.set({ cropX: x, cropY: y, width: w, height: h });
    img.setPositionByOrigin(new fabric.Point(r.x + r.w / 2, r.y + r.h / 2), 'center', 'center');
    img.rotate(prev.angle);
    img.setCoords();
    finishCrop();
    commit();
  }
  function cancelCrop() {
    if (!crop) return;
    const { img, prev } = crop;
    img.set({ cropX: prev.cropX, cropY: prev.cropY, width: prev.width, height: prev.height });
    img.rotate(prev.angle);
    img.setPositionByOrigin(prev.center, 'center', 'center');
    img.setCoords();
    finishCrop();
  }

  // Number boxes (size, width, position, angle) are text boxes, so Arabic and Persian digits typed on an
  // Arabic keyboard count ("٨٠" is 80; a number box would drop them, QA 25 Nov). Arrow keys still step.
  const latinNumber = (v) => String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٫,]/g, '.').replace(/[−–]/g, '-').replace(/[^\d.-]/g, '');
  props.addEventListener('keydown', (e) => {
    const box = e.target;
    if (!box.classList || !box.classList.contains('num-in') || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const step = Number(box.dataset.step) || 1;
    let n = (Number(latinNumber(box.value)) || 0) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
    if (box.dataset.min !== undefined) n = Math.max(Number(box.dataset.min), n);
    if (box.dataset.max !== undefined) n = Math.min(Number(box.dataset.max), n);
    box.value = String(Math.round(n / step) * step).replace(/(\.\d*?)0{6,}\d*$/, '$1');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  props.addEventListener('input', (e) => {
    const o = active();
    if (!o || crop) return;
    const v = e.target.classList && e.target.classList.contains('num-in') ? latinNumber(e.target.value) : e.target.value;
    if (e.target.dataset.adjust) {
      const s = filterState(o);
      s[e.target.dataset.adjust] = Number(v) / 100;
      applyFilterState(o, s);
      return;
    }
    switch (e.target.id) {
      case 'p-text': {
        const wasArabic = D.ARABIC_RE.test(o.text);
        // Words coloured one by one keep their colour when typing in this box: only the changed stretch is
        // replaced (as typing on the canvas does), so the colours move with their letters (QA 25 Nov).
        if (o.insertChars && o.styles && Object.keys(o.styles).length) {
          const split = fabric.util.string.graphemeSplit;
          const was = split(o.text || '');
          const now = split(v);
          let a = 0;
          while (a < was.length && a < now.length && was[a] === now[a]) a++;
          let z = 0;
          while (z < was.length - a && z < now.length - a && was[was.length - 1 - z] === now[now.length - 1 - z]) z++;
          const mid = now.slice(a, now.length - z).join('');
          if (mid) o.insertChars(mid, null, a, was.length - z);
          else if (was.length - z > a) o.removeChars(a, was.length - z);
          if (o.text !== v) o.set({ text: v }); // (lines and anything else: as typed)
          setProp({ text: o.text });
        } else setProp({ text: v });
        renderLayers();
        if (wasArabic !== D.ARABIC_RE.test(v)) renderPropsKeepFocus();
        else refreshWordChips(o); // (the "colour one word" buttons follow the new words)
        break;
      }
      case 'p-size': if (Number(v) >= 4) setProp({ fontSize: Number(v) }); break;
      case 'p-fill': if (!$('p-nofill').checked) setProp({ fill: v }); break;
      case 'p-grad1': case 'p-grad2': {
        setProp({ fill: makeGradient($('p-grad1').value, $('p-grad2').value) });
        const prev = props.querySelector('.grad-preview');
        if (prev) prev.style.background = `linear-gradient(90deg, ${$('p-grad1').value}, ${$('p-grad2').value})`;
        break;
      }
      case 'p-stroke': setProp({ stroke: v, strokeUniform: true, strokeWidth: o.strokeWidth || 2, paintFirst: 'stroke' }); break;
      case 'p-stroke-w': setProp({ strokeWidth: Number(v), stroke: o.stroke || $('p-stroke').value, strokeUniform: true, paintFirst: 'stroke' }); break;
      case 'p-spacing': setProp({ charSpacing: Number(v) }); break;
      case 'p-lh': setProp({ lineHeight: Number(v) }); break;
      case 'p-rx': setProp({ rx: Number(v), ry: Number(v) }); break;
      case 'p-opacity': setProp({ opacity: Number(v) }); break;
      case 'p-angle': o.rotate(Number(v) || 0); setProp({}); break;
      case 'p-curve': setProp({ curve: Number(v) }); break;
      case 'p-wcm': case 'p-hcm': {
        const cm = parseFloat(String(v).replace(',', '.'));
        if (cm > 0) {
          setSizeCm(o, e.target.id === 'p-wcm' ? 'w' : 'h', cm);
          canvas.requestRenderAll();
          const z = sizeCm(o);
          const other = $(e.target.id === 'p-wcm' ? 'p-hcm' : 'p-wcm');
          if (other) other.value = (Math.round((e.target.id === 'p-wcm' ? z.h : z.w) * 10) / 10).toString();
          updateQuality();
          scheduleCheck();
          renderFloatBar();
        }
        break;
      }
      case 'p-xcm': case 'p-ycm': {
        const cm = parseFloat(String(v).replace(',', '.'));
        if (!Number.isNaN(cm)) { setPosCm(o, e.target.id === 'p-xcm' ? 'x' : 'y', cm); canvas.requestRenderAll(); scheduleCheck(); renderFloatBar(); }
        break;
      }
      case 'p-bgcolor': setProp({ backgroundColor: v }); break;
      case 'p-wordcolor': setWordColour(o, v); scheduleCommit(); break;
      case 'p-border': setProp({ maskBorder: Number(v) }); break;
      case 'p-bordercolor': setProp({ maskBorderColor: v, maskBorder: o.maskBorder || 4 }); break;
      default:
    }
  });
  function renderPropsKeepFocus() {
    const f = $('p-text');
    const pos = f ? f.selectionStart : null;
    renderProps();
    const nf = $('p-text');
    if (nf && pos !== null) { nf.focus(); nf.setSelectionRange(pos, pos); }
  }
  props.addEventListener('change', (e) => {
    const o = active();
    if (!o || crop) return;
    const id = e.target.id;
    if (id === 'p-nofill') {
      const solid = $('p-fill') ? $('p-fill').value : inkFor(surfaceHex());
      const off = e.target.checked;
      setProp(off ? { fill: 'transparent', stroke: o.stroke || inkFor(surfaceHex()), strokeWidth: o.strokeWidth || 2, paintFirst: 'stroke' } : { fill: solid }, { commitNow: true });
      renderProps();
    }
    if (id === 'p-shadow') setProp({ shadow: e.target.checked ? shadowFor(o) : null }, { commitNow: true });
    if (id === 'p-ratio') { o.set({ lockRatio: e.target.checked }); applyRatioLock(o); canvas.requestRenderAll(); commit(); }
    if (id === 'p-textbg') {
      setProp({ backgroundColor: e.target.checked ? (inkFor(surfaceHex()) === '#ffffff' ? '#ff5a36' : '#fcc419') : '' }, { commitNow: true });
      renderProps();
    }
    if (e.target.dataset.filter) {
      const s = filterState(o);
      s[e.target.dataset.filter] = e.target.checked;
      if (e.target.checked) s[e.target.dataset.filter === 'gray' ? 'sepia' : 'gray'] = false;
      applyFilterState(o, s, { now: true });
      renderProps();
    }
    if (id === 'p-wordcolor') renderProps();
    if (['p-text', 'p-size', 'p-curve', 'p-spacing', 'p-lh', 'p-opacity', 'p-border', 'p-stroke-w', 'p-wcm', 'p-hcm', 'p-xcm', 'p-ycm'].includes(id) || e.target.dataset.adjust) commit();
    // (The four boxes show the new size and place; the panel isn't drawn again, so moving on to
    // the next box keeps its focus, QA 25 Nov.)
    if (['p-wcm', 'p-hcm', 'p-xcm', 'p-ycm'].includes(id)) refreshCmBoxes(o, e.target);
  });
  props.addEventListener('click', serial(async (e) => {
    if (crop) {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'crop-apply') applyCrop();
      if (act === 'crop-cancel') cancelCrop();
      if (act === 'crop-free') setCropSquare(false);
      if (act === 'crop-square') setCropSquare(true);
      return;
    }
    const o = active();
    if (!o) return;
    const fontBtn = e.target.closest('[data-font]');
    if (fontBtn) {
      const family = fontBtn.dataset.font;
      await D.ensureFont(family, o.fontWeight, o.fontStyle);
      setProp({ fontFamily: family }, { commitNow: true });
      renderProps();
      return;
    }
    const pal = e.target.closest('[data-pal]');
    if (pal) {
      const c = pal.dataset.c;
      ({
        fill: () => setProp({ fill: c }, { commitNow: true }),
        stroke: () => setProp({ stroke: c, strokeWidth: o.strokeWidth || 2, strokeUniform: true, paintFirst: 'stroke' }, { commitNow: true }),
        bg: () => setProp({ backgroundColor: c }, { commitNow: true }),
        border: () => setProp({ maskBorderColor: c, maskBorder: o.maskBorder || 4 }, { commitNow: true }),
        word: () => { setWordColour(o, c); commit(); },
      })[pal.dataset.pal]();
      renderProps();
      return;
    }
    const fxBtn = e.target.closest('[data-fx]');
    if (fxBtn && isText(o)) {
      const fx = textFxProps(o, fxBtn.dataset.fx);
      o.set({ shadow: null, stroke: null, strokeWidth: 0 });
      setProp(fx, { commitNow: true });
      renderProps();
      return;
    }
    const wordBtn = e.target.closest('[data-word]');
    if (wordBtn) {
      const i = Number(wordBtn.dataset.word);
      st.wordSel = st.wordSel === i ? null : i;
      st.wordSelAt = st.wordSel == null ? null : { text: o.text, start: wordsOf(o)[i].start };
      renderProps();
      return;
    }
    const bgShapeBtn = e.target.closest('[data-bgshape]');
    if (bgShapeBtn) {
      setProp({ bgShape: bgShapeBtn.dataset.bgshape }, { commitNow: true });
      renderProps();
      return;
    }
    const maskBtn = e.target.closest('[data-mask]');
    if (maskBtn) {
      const m = maskBtn.dataset.mask;
      setProp({ mask: m === 'none' ? null : m }, { commitNow: true });
      renderProps();
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.fillmode) {
      const grad = isGradient(o.fill);
      if (btn.dataset.fillmode === 'gradient' && !grad) {
        const base = typeof o.fill === 'string' && o.fill !== 'transparent' ? toHex(o.fill) : D.ACCENT;
        setProp({ fill: makeGradient(base, base === D.ACCENT ? '#fcc419' : D.ACCENT) }, { commitNow: true });
      }
      if (btn.dataset.fillmode === 'solid' && grad) setProp({ fill: o.fill.colorStops[0].color }, { commitNow: true });
      renderProps();
      return;
    }
    if (btn.dataset.toggle) {
      const tg = btn.dataset.toggle;
      if (tg === 'bold') {
        const weight = o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 ? 'normal' : 'bold';
        await D.ensureFont(o.fontFamily, weight, o.fontStyle);
        setProp({ fontWeight: weight }, { commitNow: true });
      }
      if (tg === 'italic') setProp({ fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }, { commitNow: true });
      if (tg === 'underline') setProp({ underline: !o.underline }, { commitNow: true });
      renderProps();
      return;
    }
    if (btn.dataset.align) {
      setProp({ textAlign: btn.dataset.align }, { commitNow: true });
      renderProps();
      return;
    }
    if (btn.dataset.alignTo) { alignSelected(btn.dataset.alignTo); return; }
    if (btn.dataset.distribute) { distributeSelected(btn.dataset.distribute); return; }
    const act = btn.dataset.act;
    if (act === 'group') { groupSelected(); return; }
    if (act === 'ungroup') { ungroupSelected(); return; }
    if (act === 'center-h') centerSelected('h');
    if (act === 'center-v') centerSelected('v');
    if (act === 'flip-x') setProp({ flipX: !o.flipX }, { commitNow: true });
    if (act === 'flip-y') setProp({ flipY: !o.flipY }, { commitNow: true });
    if (['up', 'down', 'top', 'bottom'].includes(act)) layer(act);
    if (act === 'duplicate') duplicateSelected();
    if (act === 'delete') removeSelected();
    if (act === 'fit') fitToArea(o);
    if (act === 'straighten') { setProp({ curve: 0 }, { commitNow: true }); renderProps(); }
    if (act === 'reset-words') { st.wordSel = null; o.set({ styles: {} }); o.dirty = true; canvas.requestRenderAll(); commit(); renderProps(); }
    if (act === 'crop') startCrop(o);
    if (act === 'removebg') await removeImageBackground(o);
    if (act === 'boost') await boostImage(o);
    if (act === 'reset-adjust') { applyFilterState(o, { ...filterState(o), brightness: 0, contrast: 0, saturation: 0, gray: false, sepia: false }, { now: true }); renderProps(); }
  }));

  // ---------- Layers ----------
  function shapeName(o) {
    if (o.name === 'Background') return t('layers.background');
    if (o.type === 'group' && !isSticker(o)) return t('layers.group', { n: o.size() });
    if (isSticker(o)) {
      const sk = SK.STICKERS.find((x) => 'sticker:' + x.id === o.name);
      return sk ? tr(sk.name) : t('tool.stickers');
    }
    const def = Object.values(D.SHAPES).find((s) => s.name.en === o.name);
    return def ? tr(def.name) : o.name || t('panel.shape');
  }
  function layerName(o) {
    if (isText(o)) return `“${o.text.replace(/\s+/g, ' ').slice(0, 28)}”`;
    if (o.type === 'image') return o.name || t('panel.image');
    return shapeName(o);
  }
  const LOCK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const UNLOCK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';
  // Pressing a layer or side button right after typing in a field: leaving the field saves the change,
  // which would draw these lists again under the pointer, and the browser then drops the click. While a
  // press inside them lasts, they are drawn again only once it is over.
  // (var and function declarations: these lists can be drawn while the editor is still starting.)
  var pressIn = null; // eslint-disable-line no-var
  var deferred = new Map(); // eslint-disable-line no-var
  document.addEventListener('pointerdown', (e) => { pressIn = ['layers', 'side-tabs'].find((id) => $(id) && $(id).contains(e.target)) || null; }, true);
  // The hold lasts until the click has been handled: on phones the field loses focus after the finger
  // lifts (when the browser sends its mouse events), just before the click.
  var pressTimer = null; // eslint-disable-line no-var
  function endPress(ms) {
    if (!pressIn) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressIn = null;
      for (const [id, fn] of [...deferred]) { deferred.delete(id); fn(); }
    }, ms);
  }
  document.addEventListener('click', () => endPress(0), true);
  document.addEventListener('pointerup', () => endPress(700), true);
  document.addEventListener('pointercancel', () => endPress(0), true);
  function heldOff(id, fn) {
    if (!pressIn || pressIn !== id) return false;
    (deferred || (deferred = new Map())).set(id, fn);
    return true;
  }
  function renderLayers() {
    if (heldOff('layers', renderLayers)) return;
    const objs = canvas.getObjects().slice().reverse();
    const sel = canvas.getActiveObjects();
    $('layers').innerHTML = objs.length
      ? objs.map((o, i) => {
          const locked = o.selectable === false;
          return `<li data-i="${objs.length - 1 - i}" class="${sel.includes(o) ? 'active' : ''} ${locked ? 'locked' : ''}">
            <span class="grip" data-grip title="${esc(t('layers.drag'))}" aria-label="${esc(t('layers.drag'))}">⋮⋮</span>
            <span dir="auto" class="lname">${esc(layerName(o))}</span>
            <button data-lock class="${locked ? 'on' : ''}" title="${esc(t(locked ? 'layers.unlock' : 'layers.lock'))}" aria-label="${esc(t(locked ? 'layers.unlock' : 'layers.lock'))}">${locked ? LOCK_ICON : UNLOCK_ICON}</button>
            <button data-del title="${esc(t('layers.delete'))}" aria-label="${esc(t('layers.delete'))}">✕</button>
          </li>`;
        }).join('')
      : `<li style="cursor:default" class="muted"><span>${esc(t('layers.empty'))}</span></li>`;
  }
  // Drag a layer by its handle to change the stacking order (mouse and touch).
  $('layers').addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    const li = grip.closest('li');
    const list = $('layers');
    const items = [...list.querySelectorAll('li[data-i]')];
    if (items.length < 2) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const from = items.indexOf(li);
    let to = from;
    li.classList.add('dragging');
    const move = (ev) => {
      const y = ev.clientY;
      to = items.length - 1;
      for (let k = 0; k < items.length; k++) {
        const r = items[k].getBoundingClientRect();
        if (y < r.top + r.height / 2) { to = k; break; }
      }
      items.forEach((it, k) => it.classList.toggle('drop-before', k === to && to !== from && to < from));
      items.forEach((it, k) => it.classList.toggle('drop-after', k === to && to !== from && to > from));
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      items.forEach((it) => it.classList.remove('dragging', 'drop-before', 'drop-after'));
      if (to === from) return;
      // The list shows the top layer first; canvas order is the reverse.
      const o = canvas.getObjects()[Number(li.dataset.i)];
      const n = canvas.getObjects().length;
      canvas.moveTo(o, n - 1 - to);
      canvas.requestRenderAll();
      commit();
      renderLayers();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  $('layers').addEventListener('click', (e) => {
    if (e.target.closest('[data-grip]')) return;
    const li = e.target.closest('[data-i]');
    if (!li) return;
    const o = canvas.getObjects()[Number(li.dataset.i)];
    if (!o) return;
    const locked = o.selectable === false;
    if (e.target.closest('[data-lock]')) return setLocked(o, !locked);
    if (e.target.closest('[data-del]')) {
      st.silent = true;
      if (canvas.getActiveObjects().includes(o)) canvas.discardActiveObject();
      canvas.remove(o);
      st.silent = false;
      commit();
      renderProps();
      return;
    }
    if (locked) return;
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
    renderProps();
    renderLayers();
  });

  // ---------- Product options ----------
  function renderOptions() {
    const p = st.product;
    $('product-select').innerHTML = products.map((x) => `<option value="${x.id}" ${x === p ? 'selected' : ''}>${esc(tr(x.name))}</option>`).join('');
    $('swatches').innerHTML = p.colors.map((c) => `<button class="swatch ${c.id === st.colorId ? 'active' : ''}${c.soldOut ? ' sold-out' : ''}" data-color="${c.id}"${c.soldOut ? ' aria-disabled="true"' : ''} title="${esc(tr(c.name))}${c.soldOut ? ` · ${esc(tEd('ed.soldOut'))}` : ''}" aria-label="${esc(tr(c.name))}${c.soldOut ? ` · ${esc(tEd('ed.soldOut'))}` : ''}" style="background:${c.hex}"></button>`).join('');
    $('color-name').textContent = tr(color().name);
    $('color-label').textContent = p.colorLabel ? `${tr(p.colorLabel)}:` : t('panel.colour');
    // Options such as lamination (business cards), with what each adds to the chosen size.
    $('prod-options').innerHTML = (p.options || []).map((opt) => {
      const cur = chosenOption(opt);
      return `<div class="field"><label>${esc(tr(opt.name))}</label>
        <div class="chips">${opt.choices.map((c) => { const pr = choicePrice(c, st.sizeId); return `<button class="chip ${c === cur ? 'active' : ''}" data-opt="${esc(opt.id)}" data-choice="${esc(c.id)}">${esc(tr(c.name))}${pr ? ` <span style="opacity:.7">+${esc(money(pr))}</span>` : ''}</button>`; }).join('')}</div>
        ${opt.help ? `<p class="muted small" style="margin:6px 0 0;line-height:1.5">${esc(tr(opt.help))}</p>` : ''}</div>`;
    }).join('');
    $('sizes').innerHTML = p.sizes.map((s) => {
      const out = !sizeOk(p, st.colorId, s);
      // (A garment whose size isn't chosen yet shows none as chosen: Add to cart asks for it, QA 25 Nov.)
      const askSize = p.category === 'apparel' && p.sizes.length > 1 && !st.sizePicked;
      return `<button class="chip ${s.id === st.sizeId && !askSize ? 'active' : ''}${out ? ' sold-out' : ''}" data-size="${s.id}"${out ? ' aria-disabled="true"' : ''}>${esc(tr(s.label))}${out ? ` <span class="sold-tag">${esc(tEd('ed.soldOut'))}</span>` : POD.sizeNote(st.product, s) ? ` <span style="opacity:.7">${esc(POD.sizeNote(st.product, s))}</span>` : ''}</button>`;
    }).join('');
    // Print or embroidery (garments, caps, totes, aprons).
    $('method-field').hidden = !p.embroidery;
    if (p.embroidery) {
      // Which layer of the front is being edited: its print or its embroidery (both can be used together).
      const now = st.side === EMB ? 'embroidery' : 'print';
      const hostName = tr(baseSide(p.embroidery.side).name);
      $('method-chips').innerHTML = ['print', 'embroidery'].map((m) => `<button class="chip ${m === now ? 'active' : ''}" data-method="${m}" aria-pressed="${m === now}">${esc(t('emb.' + m))}${m === 'embroidery' ? ` <span style="opacity:.7">+${esc(money(p.embroidery.surcharge))}</span>` : ''}</button>`).join('');
      $('method-note').textContent = st.side === EMB
        ? t('emb.noteN', { w: POD.num(Math.round(p.embroidery.widthIn * 25.4) / 10), h: POD.num(Math.round(p.embroidery.heightIn * 25.4) / 10), colours: POD.plural('emb.colours', p.embroidery.maxColors) }) + ' ' + t('emb.bothNote', { side: hostName })
        : t(usesEmb() ? 'emb.printNoteWith' : 'emb.printNote', { side: hostName });
    }
    // Fabric: how the tile repeats and how big it prints.
    $('pattern-field').hidden = !st.pattern;
    if (st.pattern) {
      $('pat-repeats').innerHTML = REPEATS.map((r) => `<button class="chip ${r === st.pattern.repeat ? 'active' : ''}" data-repeat="${r}">${esc(t('pat.' + r))}</button>`).join('');
      $('pat-tiles').innerHTML = p.pattern.tiles.map((cm) => `<button class="chip ${cm === st.pattern.tileCm ? 'active' : ''}" data-tile="${cm}">${esc(POD.num(cm))} ${esc(t('pat.cm'))}</button>`).join('');
    }
  }
  $('prod-options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-opt]');
    if (!b) return;
    st.options = { ...(st.options || {}), [b.dataset.opt]: b.dataset.choice };
    renderOptions();
    refreshChrome();
    // The binding moves the staples on the cover drawing.
    if (b.dataset.opt === 'binding') applyMockup();
  });
  $('method-chips').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-method]');
    if (!b || !st.product.embroidery) return;
    // Print / Embroidery: edit the front's print or its embroidery. Nothing is moved or deleted:
    // each layer keeps its own design, and the other one stays on the shirt.
    const to = b.dataset.method === 'embroidery' ? EMB : st.side === EMB ? st.product.embroidery.side : null;
    if (!to || to === st.side) return;
    cancelCrop();
    commit();
    canvas.discardActiveObject();
    await showSide(to);
    seedHistory();
    renderOptions();
    refreshChrome();
    renderProps();
    st.zoom = 1;
    fit();
    autoFocusPrint();
  }));
  $('pat-repeats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-repeat]');
    if (!b || !st.pattern || b.dataset.repeat === st.pattern.repeat) return;
    st.pattern.repeat = b.dataset.repeat;
    renderOptions();
    schedulePatternPreview(0);
    scheduleDraft();
  });
  $('pat-tiles').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tile]');
    if (!b || !st.pattern || Number(b.dataset.tile) === st.pattern.tileCm) return;
    st.pattern.tileCm = Number(b.dataset.tile);
    renderOptions();
    renderCheck();
    canvas.requestRenderAll();
    schedulePatternPreview(0);
    scheduleDraft();
  });
  $('swatches').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-color]');
    if (!b || b.dataset.color === st.colorId) return;
    if (b.classList.contains('sold-out')) return toast(tEd('ed.soldOutPick'));
    const oldInk = inkFor(surfaceHex());
    const fromColor = st.colorId;
    const fromSize = st.sizeId; // (before a sold-out size is switched below: the pieces follow from here)
    st.colorId = b.dataset.color;
    // The chosen size sold out in this colour: the first size there is.
    if (!sizeOk(st.product, st.colorId, st.product.sizes.find((z) => z.id === st.sizeId))) {
      const next = st.product.sizes.find((z) => sizeOk(st.product, st.colorId, z));
      if (next) {
        await changeSize(next.id);
        toast(tEd('ed.sizeSwitched'));
      }
    }
    qtyFollow(fromColor, fromSize);
    const newInk = inkFor(surfaceHex());
    renderOptions();
    await applyMockup();
    if (oldInk !== newInk && !laser()) swapInk(oldInk, newInk);
    retoneAll();
    schedulePatternPreview(0);
  }));
  /** Text and shapes in the default ink colour follow the product: dark on light, white on dark. */
  function swapInk(from, to) {
    const same = (c) => typeof c === 'string' && c.toLowerCase() === from;
    const fix = (o) => {
      const p = {};
      if (same(o.fill)) p.fill = to;
      if (same(o.stroke)) p.stroke = to;
      return p;
    };
    let changed = false;
    canvas.getObjects().forEach((o) => {
      const p = fix(o);
      if (Object.keys(p).length) { o.set(p); o.dirty = true; changed = true; }
    });
    for (const s of allSides()) {
      if (s.id === st.side || !st.designs[s.id]) continue;
      st.designs[s.id] = st.designs[s.id].map((o) => ({ ...o, ...fix(o) }));
    }
    canvas.requestRenderAll();
    if (changed) commit();
  }
  $('sizes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    if (b.classList.contains('sold-out')) return toast(tEd('ed.soldOutPick'));
    // Booklets: fewer pages than are designed: say which won't print (their designs are kept).
    const lost = b.dataset.size !== st.sizeId ? designedBeyond(b.dataset.size) : [];
    if (lost.length && !window.confirm(tPg('ed.pagesHidden', { pages: lost.map((sd) => tr(sd.name)).join('، ') }))) return;
    st.sizePicked = true;
    if (b.dataset.size !== st.sizeId) {
      const fromSize = st.sizeId;
      changeSize(b.dataset.size);
      qtyFollow(st.colorId, fromSize);
    }
    renderOptions();
    refreshChrome();
  });
  /** A different garment size: the print box changes size on the garment, and the design with it. */
  /** Returns a promise that settles once the design on screen has been redrawn for the new size. */
  function changeSize(sizeId) {
    let redrawn = Promise.resolve();
    let remapped = false; // the page on screen is redrawn (and its history seeded) once remapped
    const prev = st.sizeId;
    const before = (sid) => areaFor(st.product, sid, prev, st.offsets[sid]);
    cancelCrop();
    commit();
    canvas.discardActiveObject();
    st.sizeId = sizeId;
    for (const sd of st.product.sides) {
      const from = before(sd.id);
      const o = st.offsets[sd.id];
      if (o) {
        const c = clampOffset(o.dx, o.dy, sd.id);
        if (c.dx || c.dy) st.offsets[sd.id] = c;
        else delete st.offsets[sd.id];
      }
      const to = areaFor(st.product, sd.id, sizeId, st.offsets[sd.id]);
      if (from.w === to.w && from.x === to.x && from.y === to.y) continue;
      if (sd.id === st.side) {
        const objs = remap(serialize(), from, to);
        st.designs[sd.id] = objs;
        remapped = true;
        redrawn = loadObjects(objs).then(() => { applyClips(); seedHistory(); commit(); renderCheck(); });
      } else if ((st.designs[sd.id] || []).length) {
        st.designs[sd.id] = remap(st.designs[sd.id], from, to);
      }
    }
    // Undo works within one size: the history starts again at the new size (from what's on screen now).
    st.history = {};
    if (!remapped) seedHistory();
    applyClips();
    fit(); // the garment is drawn at this size's scale
    schedulePatternPreview(0);
    redrawn.then(() => refreshGhost()); // the print under the embroidery changed size too
    // Booklets: a smaller page count drops the last pages from the strip (their designs are kept).
    if (st.product.paged && !activeSides().some((sd) => sd.id === st.side)) {
      redrawn = redrawn.then(() => showSide(activeSides()[0].id)).then(() => { seedHistory(); renderSideTabs(); refreshChrome(); tabInView(); });
    }
    return redrawn;
  }
  $('product-select').addEventListener('change', serial(async (e) => changeProduct(e.target.value)));

  /** Switch product, carrying the design across by scaling it into the new print areas. */
  async function changeProduct(id) {
    const next = products.find((p) => p.id === id);
    if (!next || next === st.product) return;
    st.options = {}; // options belong to a product
    seedBinding(next);
    cancelCrop();
    commit();
    const oldInk = inkFor(surfaceHex()); // (the new product may not have this colour: dark text then follows it)
    const prev = st.product;
    const pending = prev.sides.filter((s) => (st.designs[s.id] || []).length).map((s) => s.id);
    const mapped = {};
    const from = (sid) => sideDef(sid).printArea; // where the customer had moved it
    const nextSize = canPick(next.sizes.find((z) => z.id === st.sizeId)) ? st.sizeId : firstPick(next.sizes).id;
    const to = (s) => areaFor(next, s.id, nextSize, null);
    for (const s of next.sides) {
      if (pending.includes(s.id)) {
        mapped[s.id] = remap(st.designs[s.id], from(s.id), to(s));
        pending.splice(pending.indexOf(s.id), 1);
      }
    }
    for (const s of next.sides) {
      if (!mapped[s.id] && pending.length) {
        const sid = pending.shift();
        mapped[s.id] = remap(st.designs[sid], from(sid), to(s));
      }
    }
    // The embroidery layer: to the new product's embroidery spot, or (no embroidery there) left out.
    const embObjs = st.designs[EMB] || [];
    const lost = pending.map((sid) => tr(prev.sides.find((s) => s.id === sid).name));
    if (embObjs.length && prev.embroidery) {
      if (next.embroidery) mapped[EMB] = remap(embObjs, sideDef(EMB).printArea, next.embroidery.area);
      else lost.push(t('emb.embroidery'));
    }
    if (lost.length) toast(t('msg.noRoom', { product: tr(next.name), sides: lost.join(' + ') }));
    const wasEmb = st.side === EMB;
    st.product = next;
    st.designs = mapped;
    st.offsets = {}; // the new product starts at its standard print position
    st.history = {};
    if (!canPick(next.colors.find((c) => c.id === st.colorId))) st.colorId = firstPick(next.colors).id;
    st.sizeId = nextSize;
    st.pattern = normPattern(next, st.pattern);
    st.side = wasEmb && next.embroidery ? EMB : next.sides.find((s) => s.id === hostOf(st.side))?.id || next.sides[0].id;
    const url = new URL(location.href);
    url.searchParams.set('product', next.id);
    history.replaceState(null, '', url);
    renderOptions();
    await Promise.all([applyMockup(), loadObjects(st.designs[st.side])]);
    st.zoom = 1;
    fit();
    autoFocusPrint();
    schedulePatternPreview();
    seedHistory();
    // Another colour (white → a black hoodie): text and shapes in the default ink follow it, as when the colour is picked.
    const newInk = inkFor(surfaceHex());
    if (oldInk !== newInk && !laser()) swapInk(oldInk, newInk);
    refreshChrome();
    renderProps();
  }

  function remap(objects, from, to) {
    const s = Math.min(to.w / from.w, to.h / from.h);
    const fcx = from.x + from.w / 2;
    const fcy = from.y + from.h / 2;
    const tcx = to.x + to.w / 2;
    const tcy = to.y + to.h / 2;
    return objects.map((o) => (o.name === 'Background' && o.type === 'rect'
      // A full-area background fill should keep filling the new print area.
      ? { ...o, left: tcx, top: tcy, width: to.w, height: to.h, scaleX: 1, scaleY: 1, angle: 0, rx: to.rx || 0, ry: to.rx || 0 }
      : { ...o, left: tcx + (o.left - fcx) * s, top: tcy + (o.top - fcy) * s, scaleX: (o.scaleX || 1) * s, scaleY: (o.scaleY || 1) * s }));
  }

  // ---------- Sides ----------
  function renderSideTabs() {
    if (heldOff('side-tabs', renderSideTabs)) return;
    const n = (id) => (id === st.side ? canvas.getObjects().length : (st.designs[id] || []).length);
    // Booklets: a strip of numbered pages (Cover, 2, 3… Back) that scrolls sideways.
    $('side-tabs').classList.toggle('pages', Boolean(st.product.paged));
    // Booklets: previous / next page buttons either side of the strip.
    const list = activeSides();
    const at = list.findIndex((s) => s.id === hostOf());
    $('page-prev').hidden = $('page-next').hidden = !st.product.paged;
    $('page-prev').disabled = at <= 0;
    $('page-next').disabled = at < 0 || at >= list.length - 1;
    $('side-tabs').innerHTML = activeSides().map((s) => {
      const on = hostOf() === s.id;
      if (st.product.paged) {
        return `<button class="side-tab page-tab ${on ? 'active' : ''}" data-side="${s.id}" role="tab" aria-selected="${on}" title="${esc(tr(s.name))}" aria-label="${esc(tr(s.name))}">${esc(tr(s.short || s.name))}${n(s.id) ? '<span class="has"></span>' : ''}</button>`;
      }
      const stitched = emb() && emb().side === s.id && n(EMB) > 0;
      const count = n(s.id) + (stitched ? n(EMB) : 0);
      // The side with embroidery says so ("Front + embroidery").
      const how = stitched ? ` <span class="side-how">+ ${esc(t('emb.embroidery'))}</span>` : '';
      return `<button class="side-tab ${on ? 'active' : ''}" data-side="${s.id}" role="tab" aria-selected="${on}">${esc(tr(s.name))}${how}${count ? '<span class="has"></span>' : ''}</button>`;
    }).join('');
  }
  /** Booklets: go to the page before / after (dir -1 / 1), keeping it in view in the strip. */
  const goPage = serial(async (dir) => {
    if (!st.product.paged) return;
    const list = activeSides();
    const to = list[list.findIndex((s) => s.id === hostOf()) + dir];
    if (!to) return;
    commit();
    canvas.discardActiveObject();
    await showSide(to.id);
    seedHistory(); // as a click on the page's tab does: the first change on it can be undone
    renderSideTabs();
    refreshChrome();
    tabInView();
  });
  /** The page being shown kept in view in the strip of pages (a phone shows only a few). */
  function tabInView() {
    const tab = $('side-tabs').querySelector(`[data-side="${hostOf()}"]`);
    if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('page-prev').addEventListener('click', () => goPage(-1));
  $('page-next').addEventListener('click', () => goPage(1));
  // Page Up / Page Down turn the pages (not while typing).
  document.addEventListener('keydown', (e) => {
    if (!st.product.paged || (e.key !== 'PageUp' && e.key !== 'PageDown')) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]') || (canvas.getActiveObject() && canvas.getActiveObject().isEditing)) return;
    if (!$('pv').hidden) return;
    e.preventDefault();
    goPage(e.key === 'PageDown' ? 1 : -1);
  });
  async function showSide(id) {
    if (st.mergePreview) endMergePreview();
    st.side = id;
    await Promise.all([applyMockup(id), loadObjects(st.designs[id])]);
    await refreshGhost(); // the other layer of this side, before anything is drawn from it
    if (MOBILE.matches && st.sheet) fit();
    renderCheck();
  }
  $('side-tabs').addEventListener('click', serial(async (e) => {
    const b = e.target.closest('[data-side]');
    if (!b || b.dataset.side === hostOf()) return;
    cancelCrop();
    commit();
    await showSide(b.dataset.side);
    seedHistory();
    refreshChrome();
    renderProps();
    renderOptions(); // Print / Embroidery follows the side
  }));

  // ---------- Toolbar ----------
  function togglePreview() {
    st.preview = !st.preview;
    $('preview-toggle').classList.toggle('active', st.preview);
    if (st.preview) canvas.discardActiveObject();
    applyClips();
  }
  $('preview-toggle').addEventListener('click', togglePreview);
  $('undo').addEventListener('click', serial(() => stepHistory(-1)));
  $('redo').addEventListener('click', serial(() => stepHistory(1)));
  $('clear-side').addEventListener('click', () => {
    if (!canvas.getObjects().length) return;
    if (!confirm(t('msg.clearConfirm', { side: tr(sideDef().name) }))) return;
    st.silent = true;
    canvas.discardActiveObject();
    canvas.remove(...canvas.getObjects());
    st.silent = false;
    commit();
    renderProps();
  });

  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (crop) {
      if (e.key === 'Escape') cancelCrop();
      if (e.key === 'Enter') applyCrop();
      return;
    }
    const o = active();
    if (o && o.isEditing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); serial(() => stepHistory(e.shiftKey ? 1 : -1))(); return; }
    if (mod && key === 'y') { e.preventDefault(); serial(() => stepHistory(1))(); return; }
    if (!o) return;
    if (mod && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); removeSelected(); return; }
    const step = e.shiftKey ? 10 : 1;
    const moves = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    if (moves[key]) {
      e.preventDefault();
      o.set({ left: o.left + moves[key][0], top: o.top + moves[key][1] });
      o.setCoords();
      canvas.requestRenderAll();
      scheduleCommit();
    }
  });

  // ---------- Print check ----------
  /** Bounding box on the canvas, also correct for objects inside a multi-selection. */
  function absRect(o) {
    const m = o.calcTransformMatrix();
    const d = o._getNonTransformedDimensions();
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => fabric.util.transformPoint({ x: (sx * d.x) / 2, y: (sy * d.y) / 2 }, m));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  /** Problems that would make the print blurry, cut off or hard to read. */
  /**
   * The editor's checks of one side in the server's words (see preflight.js): photos too small
   * for their printed size, tiny text, text close to the cut, and fonts that did not load
   * (the text would print in a fallback font).
   */
  async function reportChecks(sideId, issues) {
    // Text layers are named “like this” in the layers list; the warning texts add their own quotes.
    const short = (v) => String(v || '').replace(/^“([\s\S]*)”$/, '$1').slice(0, 60);
    const out = [];
    for (const i of issues) {
      if (i.key === 'check.lowres') out.push({ id: 'lowResImage', level: 'fail', side: sideId, params: { name: short(i.params.name), dpi: i.params.dpi } });
      else if (i.key === 'check.okres') out.push({ id: 'lowResImage', level: 'warn', side: sideId, params: { name: short(i.params.name), dpi: i.params.dpi } });
      else if (i.key === 'check.tiny') out.push({ id: 'tinyText', level: 'warn', side: sideId, params: { name: short(i.params.name), pt: i.params.pt } });
      else if (i.key === 'check.safe') out.push({ id: 'outsideSafe', level: 'warn', side: sideId, params: { name: short(i.params.name) } });
      // What the customer was warned about must show on the proof too (not "ready to print").
      else if (i.key === 'check.hidden') out.push({ id: 'hiddenText', level: 'fail', side: sideId, params: { name: short(i.params.name) } });
      else if (i.key === 'check.inkOnColour') out.push({ id: 'inkOnColour', level: 'warn', side: sideId, params: { name: short(i.params.name), colour: short(i.params.colour) } });
      else if (i.key === 'check.fieldText') out.push({ id: 'fieldText', level: 'fail', side: sideId, params: { name: short(i.params.name) } });
      else if (i.key === 'check.cutPieces') out.push({ id: 'cutPieces', level: 'warn', side: sideId, params: { n: Number(st.cutPieces) || 0 } });
      else if (i.key === 'check.cutPhoto') out.push({ id: 'cutPhoto', level: 'warn', side: sideId, params: { name: short(i.params.name) } });
      // Past the edge, and the embroidery warnings: on the proof too, never "nothing to fix" (QA 25 Nov).
      else if (i.key === 'check.cut') out.push({ id: 'cutEdge', level: 'warn', side: sideId, params: { name: short(i.params.name) } });
      else if (i.key === 'check.embSmallText') out.push({ id: 'embSmallText', level: 'warn', side: sideId, params: { name: short(i.params.name) } });
      else if (i.key === 'check.embPhoto') out.push({ id: 'embPhoto', level: 'warn', side: sideId, params: { name: short(i.params.name) } });
      else if (i.key === 'check.embGradient') out.push({ id: 'embGradient', level: 'warn', side: sideId, params: { name: short(i.params.name) } });
      else if (i.key === 'check.embColorsN') out.push({ id: 'embColors', level: 'warn', side: sideId, params: { n: Number(i.params.count) || 0, max: Number(i.params.limit) || 0 } });
    }
    const missing = new Set();
    for (const o of canvas.getObjects()) {
      if (!isText(o) || o.visible === false || !o.fontFamily) continue;
      const family = String(o.fontFamily).split(',')[0].replace(/["']/g, '').trim();
      if (!family || !document.fonts) continue;
      // The face this text really uses (a bold line needs the bold font, not the regular one).
      const spec = `${o.fontStyle || 'normal'} ${o.fontWeight || 'normal'} 16px "${family}"`;
      const sample = String(o.text || 'a').slice(0, 50) || 'a';
      try {
        if (!document.fonts.check(spec, sample)) {
          await Promise.race([document.fonts.load(spec, sample), new Promise((res) => setTimeout(res, 3000))]).catch(() => {});
          if (!document.fonts.check(spec, sample)) missing.add(short(family));
        }
      } catch (e) { /* an odd font name: nothing to report */ }
    }
    if (missing.size) out.push({ id: 'fontFallback', level: 'warn', side: sideId, params: { fonts: [...missing].slice(0, 10) } });
    return out;
  }

  /** Is this picture solid (not see-through) at a canvas point? Reads a small alpha map of the picture once. */
  const alphaMaps = new WeakMap();
  function solidAt(img, pt) {
    const el = img.getElement && img.getElement();
    if (!el || !(el.naturalWidth || el.width)) return false;
    let map = alphaMaps.get(el);
    if (!map) {
      const N = 48;
      const c = document.createElement('canvas');
      c.width = N;
      c.height = N;
      const ctx = c.getContext('2d');
      try {
        ctx.drawImage(el, 0, 0, N, N);
        map = { N, data: ctx.getImageData(0, 0, N, N).data };
      } catch (e) {
        map = { N, data: null }; // unreadable: treat as solid
      }
      alphaMaps.set(el, map);
    }
    const local = fabric.util.transformPoint(pt, fabric.util.invertTransform(img.calcTransformMatrix()));
    const w = img.width;
    const h = img.height;
    const cx = img.cropX || 0;
    const cy = img.cropY || 0;
    const px = local.x + w / 2 + cx;
    const py = local.y + h / 2 + cy;
    const ew = el.naturalWidth || el.width;
    const eh = el.naturalHeight || el.height;
    if (local.x < -w / 2 || local.x > w / 2 || local.y < -h / 2 || local.y > h / 2) return false;
    if (!map.data) return true;
    const ix = Math.min(map.N - 1, Math.max(0, Math.floor((px / ew) * map.N)));
    const iy = Math.min(map.N - 1, Math.max(0, Math.floor((py / eh) * map.N)));
    return map.data[(iy * map.N + ix) * 4 + 3] > 200 && (img.opacity == null || img.opacity > 0.6);
  }
  function checkIssues() {
    const R = rects();
    const sd = sideDef();
    const edge = R.b ? R.bleed : R.trim;
    const issues = [];
    for (const o of canvas.getObjects()) {
      if (o.name === '__cropper' || o.visible === false) continue;
      const r = absRect(o);
      const name = layerName(o);
      const covers = r.left <= R.trim.x + 1 && r.top <= R.trim.y + 1 && r.left + r.width >= R.trim.x + R.trim.w - 1 && r.top + r.height >= R.trim.y + R.trim.h - 1;
      const outside = r.left > edge.x + edge.w || r.left + r.width < edge.x || r.top > edge.y + edge.h || r.top + r.height < edge.y;
      if (outside) {
        issues.push({ level: 'error', key: 'check.outside', obj: o, params: { name } });
        continue;
      }
      const cut = r.left < edge.x - 0.5 || r.top < edge.y - 0.5 || r.left + r.width > edge.x + edge.w + 0.5 || r.top + r.height > edge.y + edge.h + 0.5;
      // Fabric patterns: crossing the tile edge is how a pattern joins up (it continues on the other side).
      if (cut && !covers && !st.pattern) issues.push({ level: 'warn', key: 'check.cut', obj: o, params: { name } });
      const important = isText(o) || isSticker(o);
      const unsafe = r.left < R.safe.x || r.top < R.safe.y || r.left + r.width > R.safe.x + R.safe.w || r.top + r.height > R.safe.y + R.safe.h;
      if (!cut && important && unsafe) issues.push({ level: 'warn', key: 'check.safe', obj: o, params: { name } });
      // (A page of the customer's own PDF prints from the PDF itself, not from this picture.)
      if (o.type === 'image' && !o.pdfSrc) {
        const dpi = imageDpi(o);
        const lim = dpiLimits();
        if (dpi < lim.fail) issues.push({ level: 'error', key: 'check.lowres', obj: o, params: { name, dpi } });
        else if (dpi < lim.warn) issues.push({ level: 'warn', key: 'check.okres', obj: o, params: { name, dpi } });
      }
      if (isText(o)) {
        const pt = Math.round(((o.fontSize * Math.abs(o.scaleY)) / R.u) * 72 * 0.7); // cap height ≈ 70% of font size
        if (pt < 6) issues.push({ level: 'warn', key: 'check.tiny', obj: o, params: { name, pt } });
      }
    }
    // Text covered by a picture above it (the picture is solid there): it would not show in print.
    const objs = canvas.getObjects().filter((o) => o.name !== '__cropper' && o.visible !== false);
    objs.forEach((o, i) => {
      if (!isText(o)) return;
      // Pictures (solid where their pixels are) and shapes / stickers with a fill (solid inside their outline).
      const above = objs.slice(i + 1).filter((x) => !isText(x));
      if (!above.length) return;
      const r = absRect(o);
      const pts = [];
      for (let gx = 1; gx <= 5; gx++) for (let gy = 1; gy <= 3; gy++) pts.push(new fabric.Point(r.left + (r.width * gx) / 6, r.top + (r.height * gy) / 4));
      const solid = (x, pt) => {
        if (x.type === 'image') return solidAt(x, pt);
        if ((x.opacity != null && x.opacity < 0.6) || !x.containsPoint) return false;
        const fill = x.type === 'group' ? 'group' : x.fill;
        if (!fill || fill === 'transparent' || /^rgba?\([^)]*,\s*0(\.\d+)?\s*\)$/.test(String(fill))) return false;
        return x.containsPoint(pt, null, true);
      };
      const hidden = pts.filter((pt) => above.some((x) => solid(x, pt))).length;
      if (hidden >= pts.length * 0.6) issues.push({ level: 'error', key: 'check.hidden', obj: o, params: { name: layerName(o) } });
    });
    // A name-list field ({Name}) on a product without name lists would print as it is.
    if (!st.product.merge) {
      for (const o of objs) if (isText(o) && hasShopField(o.text)) issues.push({ level: 'error', key: 'check.fieldText', obj: o, params: { name: layerName(o) } });
    }
    // Several garment colours in one order (name list colours or the quantities): words that disappear on one of them.
    if (!st.product.surface && !embHere() && !laser()) {
      const ids = new Set(Object.entries(qtyGrid()).filter(([, row]) => Object.values(row).some((n) => n > 0)).map(([c]) => c));
      if (st.mergeList) {
        const vc = mergeVariantCols();
        if (vc.color >= 0) st.mergeList.rows.forEach((r) => { const c = matchColorId(r[vc.color]); if (c) ids.add(c); });
      }
      const garments = st.product.colors.filter((c) => ids.has(c.id) && c.hex);
      if (garments.length >= 1) {
        const ratio = (a, b) => { const x = POD.luminance(a); const y = POD.luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        for (const o of objs) {
          if (!isText(o)) continue;
          const ink = typeof o.fill === 'string' && o.fill !== 'transparent' ? o.fill : typeof o.stroke === 'string' ? o.stroke : null;
          if (!ink) continue;
          let hex;
          try { hex = new fabric.Color(ink).toHex(); } catch (e) { continue; }
          const outline = o.stroke && o.strokeWidth > 0 && typeof o.stroke === 'string' && o.fill !== 'transparent' ? new fabric.Color(o.stroke).toHex() : null;
          const lost = garments.find((g) => ratio('#' + hex, g.hex) < 1.6 && !(outline && ratio('#' + outline, g.hex) >= 1.6));
          if (lost) issues.push({ level: 'warn', key: 'check.inkOnColour', obj: o, params: { name: layerName(o), colour: tr(lost.name) } });
        }
      }
    }
    // Print and embroidery on the same side go in different places: never on top of each other.
    if (ghostSideOf() && ghost.el && ghost.boxes && ghost.boxes.length) {
      const own = area();
      for (const o of canvas.getObjects()) {
        if (o.name === '__cropper' || o.visible === false) continue;
        const r = absRect(o);
        const x = Math.max(r.left, own.x);
        const y = Math.max(r.top, own.y);
        const w = Math.min(r.left + r.width, own.x + own.w) - x;
        const h = Math.min(r.top + r.height, own.y + own.h) - y;
        if (w <= 0 || h <= 0) continue;
        const hit = ghost.boxes.some((b) => Math.min(x + w, b.left + b.width) - Math.max(x, b.left) > 0.5 && Math.min(y + h, b.top + b.height) - Math.max(y, b.top) > 0.5);
        if (hit) issues.push({ level: 'error', key: st.side === EMB ? 'check.embOverPrint' : 'check.printOverEmb', obj: o, params: { name: layerName(o) }, overlap: true });
      }
    }
    // Embroidery (the stitched side only): no photos or gradients, at most 6 thread colours, text big enough to stitch.
    if (embHere()) {
      const colours = new Set();
      const ppmm = R.u / 25.4; // mockup units per mm
      for (const o of canvas.getObjects()) {
        if (o.name === '__cropper' || o.visible === false) continue;
        const name = layerName(o);
        if (o.type === 'image') issues.push({ level: 'warn', key: 'check.embPhoto', obj: o, params: { name } });
        const paint = (o.type === 'group' ? o.getObjects() : [o]);
        for (const x of paint) {
          for (const c of [x.fill, x.strokeWidth ? x.stroke : null]) {
            if (c && typeof c === 'object' && c.colorStops) issues.push({ level: 'warn', key: 'check.embGradient', obj: o, params: { name } });
            else if (typeof c === 'string' && c && c !== 'transparent' && !/^rgba?\([^)]*,\s*0\s*\)$/.test(c)) colours.add(new fabric.Color(c).toHex());
          }
        }
        if (isText(o) && o.fontSize * Math.abs(o.scaleY || 1) * 0.7 < 5 * ppmm) issues.push({ level: 'warn', key: 'check.embSmallText', obj: o, params: { name } });
      }
      if (colours.size > emb().maxColors) issues.push({ level: 'warn', key: 'check.embColorsN', obj: null, params: { n: POD.plural('emb.colours', colours.size), max: POD.plural('emb.threads', emb().maxColors), count: colours.size, limit: emb().maxColors } });
    }
    // Laser: photos can't be cut round, letters too small to engrave or cut cleanly, cut pieces that fall apart.
    if (laser()) {
      const L = laser();
      const ppmm = R.u / 25.4;
      const minMm = L.kind === 'cut' ? 5 : 1.5; // letter height
      for (const o of canvas.getObjects()) {
        if (o.name === '__cropper' || o.visible === false) continue;
        const name = layerName(o);
        if (L.kind === 'cut' && o.type === 'image') issues.push({ level: 'warn', key: 'check.cutPhoto', obj: o, params: { name } });
        if (isText(o) && o.fontSize * Math.abs(o.scaleY || 1) * 0.7 < minMm * ppmm) issues.push({ level: 'warn', key: L.kind === 'cut' ? 'check.cutSmallText' : 'check.laserSmallText', obj: o, params: { name, mm: POD.num(minMm) } });
      }
      measureCut();
      if (L.kind === 'cut' && L.pieces === 'one' && st.cutPieces > 1) issues.push({ level: 'warn', key: 'check.cutPieces', obj: null, params: { n: POD.num(st.cutPieces) } });
    }
    issues.sort((x, y) => (x.level === y.level ? 0 : x.level === 'error' ? -1 : 1));
    return issues.map((i) => ({ ...i, side: sd }));
  }
  let checkFrame = 0;
  function scheduleCheck() {
    if (checkFrame) return;
    checkFrame = requestAnimationFrame(() => { checkFrame = 0; renderCheck(); });
  }
  function renderCheck() {
    if (crop) return;
    const issues = checkIssues();
    st.issues = issues;
    st.issueObjs = new Set(issues.map((i) => i.obj));
    const chip = $('check-chip');
    chip.className = 'check-chip ' + (issues.length ? (issues.some((i) => i.level === 'error') ? 'bad' : 'warn') : 'ok');
    chip.innerHTML = issues.length ? `⚠ <span>${esc(t('check.issues', { n: POD.num(issues.length) }))}</span>` : `✓ <span>${esc(t('check.ok'))}</span>`;
    const R = rects();
    $('check-legend').innerHTML = `
      <li><i class="lg lg-trim"></i>${esc(t('check.legendTrim'))}</li>
      <li><i class="lg lg-safe"></i>${esc(t('check.legendSafe'))}</li>
      ${R.b ? `<li><i class="lg lg-bleed"></i>${esc(t('check.legendBleed'))}</li>` : ''}`;
    $('check-list').innerHTML = issues.length
      ? issues.map((i, k) => `<li class="${i.level}" data-issue="${k}"><span>${i.level === 'error' ? '⛔' : '⚠'}</span><span>${esc(t(i.key, { ...i.params, dpi: POD.num(i.params.dpi ?? 0), pt: POD.num(i.params.pt ?? 0) }))}</span></li>`).join('')
      : `<li class="ok"><span>✓</span><span>${esc(t('check.allGood'))}</span></li>`;
    canvas.requestRenderAll();
  }
  $('check-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-issue]');
    const issue = li && st.issues[Number(li.dataset.issue)];
    if (!issue || !canvas.contains(issue.obj) || issue.obj.selectable === false) return;
    if (issue.key === 'check.outside') {
      bringInside(issue.obj);
      commit();
      renderCheck();
      toast(t('check.broughtBack'));
    }
    canvas.setActiveObject(issue.obj);
    canvas.requestRenderAll();
  });
  $('check-chip').addEventListener('click', () => {
    if (MOBILE.matches) {
      canvas.discardActiveObject();
      setSheet('product');
      requestAnimationFrame(() => $('sec-check').scrollIntoView({ block: 'start' }));
    } else {
      $('sec-check').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // ---------- Price & chrome ----------
  function designedSides() {
    return allSides().filter((s) => (s.id === st.side ? canvas.getObjects().length : (st.designs[s.id] || []).length) > 0);
  }
  /** How many sides of the product carry something (the embroidery counts as the side it is on), as the shop prices it. */
  const decoratedCount = () => new Set(designedSides().map((s) => hostOf(s.id))).size;
  /** The full price: every piece at its size's price (or every name of the list). */
  function refreshPrice(notes = null) {
    const p = st.product;
    let total;
    let pieces;
    if (p.merge && st.mergeList) {
      pieces = mergeCount();
      total = Array.from({ length: pieces }, (_, i) => unitPrice(mergeRowSize(i))).reduce((a, b) => a + b, 0);
    } else if (p.kind === 'book') {
      pieces = 1;
      total = unitPrice(st.sizeId);
    } else {
      const lines = qtyLines();
      pieces = lines.reduce((a, l) => a + l.qty, 0);
      total = lines.reduce((a, l) => a + unitPrice(l.size) * l.qty, 0);
    }
    $('price').textContent = money(total);
    // Packs (100 cards, A5 × 500…): counted in copies ("for 300 copies"), not pieces.
    const copies = packs() && !(p.merge && st.mergeList) ? copiesIn(qtyLines()) : null;
    if (notes && pieces > 1) notes.push(copies != null ? POD.plural('qty.copiesFor', copies) : plural('qty.priceNote', pieces));
    // Phones: the number of pieces under the price; tapping it opens the quantities.
    const chip = $('qty-chip');
    if (chip) {
      chip.hidden = p.kind === 'book';
      chip.textContent = copies != null ? POD.plural('qty.copiesChip', copies) : plural(p.merge && st.mergeList ? 'qty.chipNames' : 'qty.chip', pieces);
    }
  }
  if ($('qty-chip')) {
    $('qty-chip').addEventListener('click', () => {
      if (st.product.merge && st.mergeList) return openNames(); // a name list: one copy per name
      canvas.discardActiveObject();
      setSheet('product');
      requestAnimationFrame(() => { const f = $('qty-field'); if (f) f.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    });
  }
  function refreshChrome() {
    if (bootDone) scheduleDraft();
    renderPlacement();
    const hint = $('stage-hint');
    if (hint) hint.hidden = st.preview || canvas.getObjects().length > 0;
    const p = st.product;
    const size = p.sizes.find((s) => s.id === st.sizeId);
    const n = decoratedCount();
    const perSide = p.extraSidePrice != null ? p.extraSidePrice : catalog.pricing.extraSide;
    const embFee = usesEmb() ? emb().surcharge : 0;
    const unit = p.basePrice + size.surcharge + Math.max(0, n - 1) * perSide + embFee;
    const notes = [];
    refreshPrice(notes);
    if (embFee) notes.push(t('emb.fee', { price: money(embFee) }));
    if (activeSides().length > 1 && perSide > 0) notes.push(n > 1 ? t('price.bothSides') : t('price.addSide', { price: money(perSide) }));
    // (Products sold in packs show each pack's own price on its chip: no add-on note.)
    if (size.surcharge && !p.sizes.some((z) => z.surcharge < 0)) notes.push(`${tr(size.label)} ${addOn(size.surcharge)}`);
    $('price-note').textContent = notes.join(POD.sep ? POD.sep() : ' · ');
    const h = hist();
    $('undo').disabled = h.i <= 0;
    $('redo').disabled = h.i >= h.stack.length - 1;
    $('add-to-cart').textContent = t(st.shopEdit ? 'shopEdit.button' : st.revise ? 'revise.send' : st.editingCartIndex !== null ? 'cart.update' : 'cart.add');
    renderSideTabs();
    renderLayers();
    renderCheck();
    renderMerge();
    renderQty();
  }

  // ---------- Pieces: one artwork, several identical items, sizes or colours ----------
  const mix = () => st.product.mix || { colors: false, sizes: false };
  /** The grid { colorId: { sizeId: n } }, starting with one piece in the chosen colour and size. */
  function qtyGrid() {
    const p = st.product;
    let g = st.qty && typeof st.qty === 'object' ? st.qty : null;
    // Only colours / sizes this product has, and only mixed where the print allows it.
    const clean = {};
    for (const [c, row] of Object.entries(g || {})) {
      if (!p.colors.some((x) => x.id === c) || (!mix().colors && c !== st.colorId)) continue;
      if (mix().colors) clean[c] ||= {}; // a colour set to 0 for now keeps its row (not deleted under the customer's finger)
      for (const [z, n] of Object.entries(row || {})) {
        const v = Math.max(0, Math.min(1000, Math.floor(Number(n) || 0)));
        if (p.sizes.some((x) => x.id === z) && (mix().sizes || z === st.sizeId) && v > 0) (clean[c] ||= {})[z] = v;
      }
    }
    if (!Object.values(clean).some((row) => Object.keys(row).length)) (clean[st.colorId] ||= {})[st.sizeId] = 1;
    st.qty = clean;
    return clean;
  }
  const qtyLines = () => Object.entries(qtyGrid()).flatMap(([c, row]) => Object.entries(row).filter(([, n]) => n > 0).map(([z, n]) => ({ color: c, size: z, qty: n })));
  const qtyTotal = () => qtyLines().reduce((n, l) => n + l.qty, 0);
  /** A single piece follows the colour / size picked above; a bigger order stays as typed. */
  function qtyFollow(fromColor, fromSize) {
    const lines = qtyLines();
    if (lines.length === 1 && lines[0].color === fromColor && lines[0].size === fromSize) st.qty = { [st.colorId]: { [st.sizeId]: lines[0].qty } };
  }
  function unitPrice(sizeId) {
    const p = st.product;
    const size = p.sizes.find((s) => s.id === sizeId) || p.sizes[0];
    const n = decoratedCount();
    const perSide = p.extraSidePrice != null ? p.extraSidePrice : catalog.pricing.extraSide;
    return p.basePrice + size.surcharge + Math.max(0, n - 1) * perSide + (usesEmb() ? emb().surcharge : 0) + optionsPrice(size.id);
  }
  /** Product options (business-card lamination…): what the chosen ones add to one piece of a size. */
  function chosenOption(opt) {
    const id = st.options && st.options[opt.id];
    return opt.choices.find((c) => c.id === id) || opt.choices[0];
  }
  const choicePrice = (choice, sizeId) => (typeof choice.price === 'number' ? choice.price : (choice.price && choice.price[sizeId]) || 0);
  function optionsPrice(sizeId) {
    return (st.product.options || []).reduce((sum, opt) => sum + choicePrice(chosenOption(opt), sizeId), 0);
  }
  /** "1 piece in total", "6 قطع", "12 قطعة" (Arabic: 3–10 take the plural). */
  /** A count with its Arabic form: key.one / key.two / key.few when the strings have them, else key. */
  function plural(key, n, params = {}) {
    const k = n % 100;
    const form = n === 1 ? 'one' : n === 2 ? 'two' : k >= 3 && k <= 10 ? 'few' : null;
    const v = form ? t(`${key}.${form}`, { ...params, n: POD.num(n) }) : null;
    return v && v !== `${key}.${form}` ? v : t(key, { ...params, n: POD.num(n) });
  }
  /** A place for the customer's details the shop's designs use ({Name}, {الاسم}…) still in a text. Only the shop's
   * own places count (the server's list): "{ return love; }" or "I ❤ {JS}" is just text (QA 25 Nov). */
  function hasShopField(text) {
    const key = (tok) => String(tok).slice(1, -1).trim().replace(/\s+/g, ' ').toLowerCase();
    const shop = new Set((catalog.fields || []).map(key));
    return [...String(text || '').matchAll(/\{\s*[\p{L}\p{N}_][^{}\n]{0,39}\}/gu)].some((m) => shop.has(key(m[0])));
  }
  /** Arabic: 3–10 (and 103–110…) take the plural form. */
  const few = (n) => n % 100 >= 3 && n % 100 <= 10;
  const qtyTotalText = (n) => (n === 1 ? t('qty.totalOne') : n === 2 ? t('qty.total.two') : t(n % 100 >= 3 && n % 100 <= 10 ? 'qty.totalFew' : 'qty.total', { n: POD.num(n) }));
  /** "12 pieces in total", or for packs "300 copies in total". */
  const qtySumText = () => (packs() ? POD.plural('qty.copiesTotal', copiesIn(qtyLines())) : qtyTotalText(qtyTotal()));

  // ---------- Packs: "100 cards", "A5 × 500", "8 pages × 10 copies"… ----------
  /** Sold in packs whose sizes count copies (`copies` per pack, `family` = the same paper size / page count). */
  const packs = () => st.product.sizes.length > 0 && st.product.sizes.every((z) => z.pack);
  const sizeById = (id) => st.product.sizes.find((z) => z.id === id);
  const copiesIn = (lines) => lines.reduce((n, l) => n + l.qty * ((sizeById(l.size) || {}).copies || 1), 0);
  const counted = (z) => z && typeof z.copies === 'number' && z.copies > 0;
  /** The cheapest packs of one family adding up to exactly `total` copies, as Map(sizeId → n), or null. */
  function cheapestPacks(total, sizes) {
    if (!sizes.length || total < 1 || total > 20000) return null;
    const price = sizes.map((z) => unitPrice(z.id));
    const cost = new Float64Array(total + 1).fill(Infinity);
    const pick = new Int16Array(total + 1).fill(-1);
    cost[0] = 0;
    for (let n = 1; n <= total; n++) {
      for (let i = 0; i < sizes.length; i++) {
        const k = sizes[i].copies;
        if (k <= n && cost[n - k] + price[i] < cost[n] - 1e-9) {
          cost[n] = cost[n - k] + price[i];
          pick[n] = i;
        }
      }
    }
    if (!Number.isFinite(cost[total])) return null;
    const out = new Map();
    for (let n = total; n > 0; n -= sizes[pick[n]].copies) out.set(sizes[pick[n]].id, (out.get(sizes[pick[n]].id) || 0) + 1);
    return out;
  }
  /**
   * The typed number reached a bigger pack that costs less ("10 × 1 bookmark" against "1 × 10 bookmarks"): the
   * boxes move to the cheapest packs for the same number of copies (the owner's choice, 25 Nov), and say so.
   * Products ordered in one size for all colours (flyers, menus, booklets) move to one bigger size when every
   * colour's copies fit it exactly.
   */
  function packSwitch() {
    const p = st.product;
    if (!packs() || p.kind === 'book' || (p.merge && st.mergeList)) return;
    const lines = qtyLines();
    if (!lines.length || !lines.every((l) => counted(sizeById(l.size)))) return;
    const before = lines.reduce((a, l) => a + unitPrice(l.size) * l.qty, 0);
    const fits = (c, z) => sizeOk(p, c, z) && !(POD.comboFew(p, c, z.id) > 0);
    let next = null;
    let size = st.sizeId;
    if (mix().sizes) {
      next = {};
      for (const c of [...new Set(lines.map((l) => l.color))]) {
        const mine = lines.filter((l) => l.color === c);
        for (const fam of [...new Set(mine.map((l) => sizeById(l.size).family))]) {
          const typed = mine.filter((l) => sizeById(l.size).family === fam);
          const best = cheapestPacks(copiesIn(typed), p.sizes.filter((z) => counted(z) && z.family === fam && fits(c, z)));
          for (const [z, n] of best || typed.map((l) => [l.size, l.qty])) (next[c] ||= {})[z] = (next[c][z] || 0) + n;
        }
      }
    } else {
      const cur = sizeById(st.sizeId);
      if (!counted(cur)) return;
      let bestCost = before;
      for (const z of p.sizes.filter((x) => counted(x) && x.family === cur.family && x.id !== cur.id)) {
        const rows = lines.map((l) => ({ color: l.color, n: (l.qty * cur.copies) / z.copies }));
        if (!rows.every((r) => Number.isInteger(r.n) && r.n >= 1 && r.n <= 1000 && fits(r.color, z))) continue;
        const cost = rows.reduce((a, r) => a + unitPrice(z.id) * r.n, 0);
        if (cost < bestCost - 0.5) {
          bestCost = cost;
          size = z.id;
          next = Object.fromEntries(rows.map((r) => [r.color, { [z.id]: r.n }]));
        }
      }
    }
    if (!next) return;
    const after = Object.values(next).reduce((a, row) => a + Object.entries(row).reduce((b, [z, n]) => b + unitPrice(z) * n, 0), 0);
    if (!(after < before - 0.5)) return;
    if (size !== st.sizeId) changeSize(size);
    st.qty = next;
    const list = Object.values(next).flatMap((row) => Object.entries(row).map(([z, n]) => `${POD.num(n)} × ${tr(sizeById(z).label)}`));
    toast(t('qty.packSwitched', { list: [...new Set(list)].join(POD.lang === 'ar' ? '، ' : ', '), save: money(before - after) }));
    renderOptions();
  }
  let qtyRedraw = false;
  function renderQty({ force = false } = {}) {
    const box = $('qty-field');
    if (!box) return;
    // (While a quantity box is being typed in, drawing the boxes again would lose it and the next box
    // just tapped: they're drawn once the focus leaves them, QA 25 Nov. The price is kept up to date.
    // A new colour row asked for is drawn at once: force.)
    const typing = document.activeElement;
    if (!force && typing && typing.classList && typing.classList.contains('qty-in') && box.contains(typing)) {
      qtyRedraw = true;
      return;
    }
    qtyRedraw = false;
    const p = st.product;
    if (p.kind === 'book') {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    // A name list: every row is one piece (its size from a Size column if there is one).
    if (p.merge && st.mergeList) {
      const vc = mergeVariantCols();
      box.innerHTML = `<label>${esc(t('qty.title'))}</label><p class="muted small" style="margin:0;line-height:1.5">${esc(vc.size >= 0 ? t('qty.fromListSizes', { n: POD.num(mergeCount()) }) : plural('qty.fromList', mergeCount()))}</p>`;
      return;
    }
    const g = qtyGrid();
    // (No size picked yet: the one piece kept for the first size isn't shown under it, so no size looks chosen and a
    // number typed under another size is that size only. QA 25 Nov.)
    const unpickedOne = !st.sizePicked && mix().sizes && qtyLines().length === 1 && qtyTotal() === 1;
    const sizes = mix().sizes ? p.sizes.filter((z) => canPick(z) || z.id === st.sizeId) : p.sizes.filter((z) => z.id === st.sizeId);
    const colors = p.colors.filter((c) => g[c.id]);
    const total = qtyTotal();
    const cell = (c, z) => (comboOut(p, c.id, z.id) && !(g[c.id] && g[c.id][z.id])
      ? `<span class="qty-out" title="${esc(tEd('ed.soldOut'))}">—</span>`
      : `<input type="text" inputmode="numeric" maxlength="4" autocomplete="off" class="qty-in${POD.comboFew(p, c.id, z.id) ? ' is-few' : ''}" data-qc="${c.id}" data-qz="${z.id}" value="${unpickedOne ? '' : (g[c.id] && g[c.id][z.id]) || ''}" placeholder="0" aria-label="${esc(`${tr(c.name)} ${tr(z.label)}`)}"${POD.comboFew(p, c.id, z.id) ? ` title="${esc(t('fewLeftCombo', { colour: tr(c.name), size: tr(z.label), n: POD.num(POD.comboFew(p, c.id, z.id)) }))}"` : ''}>`);
    const simple = !mix().sizes && !mix().colors;
    box.innerHTML = `
      <label>${esc(t('qty.title'))}</label>
      ${simple ? `
        <div class="qty-step">
          <button type="button" class="btn btn-sm" data-qstep="-1" aria-label="−">−</button>
          ${cell(p.colors.find((c) => c.id === st.colorId), p.sizes.find((z) => z.id === st.sizeId))}
          <button type="button" class="btn btn-sm" data-qstep="1" aria-label="+">+</button>
        </div>` : `
        <div class="qty-grid-wrap"><table class="qty-grid">
          <thead><tr><th></th>${sizes.map((z) => `<th>${esc(tr(z.label))}</th>`).join('')}${colors.length > 1 ? '<th></th>' : ''}</tr></thead>
          <tbody>${colors.map((c) => `<tr>
            <th><span class="qty-sw" style="background:${esc(c.hex)}"></span>${esc(tr(c.name))}</th>
            ${sizes.map((z) => `<td>${cell(c, z)}</td>`).join('')}
            ${colors.length > 1 ? `<td><button type="button" class="qty-x" data-qdel="${c.id}" aria-label="${esc(t('qty.removeColour', { c: tr(c.name) }))}">×</button></td>` : ''}
          </tr>`).join('')}</tbody>
        </table></div>
        ${mix().colors && colors.length < p.colors.length ? `<select class="qty-add" id="qty-add"><option value="">${esc(t('qty.addColour'))}</option>${p.colors.filter((c) => !g[c.id] && !c.soldOut).map((c) => `<option value="${c.id}">${esc(tr(c.name))}</option>`).join('')}</select>` : ''}`}
      <p class="small qty-sum">${esc(qtySumText())}</p>
      ${total > 1 ? `<p class="muted small" style="margin:2px 0 0;line-height:1.5">${esc(t(packs() ? 'qty.helpPacks' : mix().sizes || mix().colors ? 'qty.help' : 'qty.helpSame'))}</p>` : ''}`;
  }
  function redrawQtyIfLeft() {
    const box = $('qty-field');
    if (!qtyRedraw || !box || box.contains(document.activeElement)) return;
    qtyRedraw = false;
    renderQty();
  }
  if ($('qty-field')) {
    const setCell = (c, z, v) => {
      // No size picked yet: the one piece kept for the first size isn't the customer's. A number typed under another
      // size is that size only, and that size is the one picked (an S nobody chose was ordered too: QA 25 Nov).
      const unpicked = !st.sizePicked && mix().sizes && qtyLines().length === 1 && qtyTotal() === 1;
      const g = qtyGrid();
      if (unpicked && !(c === st.colorId && z === st.sizeId) && g[st.colorId]) delete g[st.colorId][st.sizeId];
      g[c] ||= {};
      // (Typed in Arabic or Persian digits too: a number box would drop those.)
      const n = String(v || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\D/g, '');
      g[c][z] = Math.max(0, Math.min(1000, Math.floor(Number(n) || 0)));
      // Only a few left of this colour and size: no more than there are (the cart would refuse it).
      const few = POD.comboFew(st.product, c, z);
      if (few && g[c][z] > few) {
        g[c][z] = few;
        const colour = st.product.colors.find((x) => x.id === c);
        const size = st.product.sizes.find((x) => x.id === z);
        toast(t('fewLeftCombo', { colour: colour ? tr(colour.name) : c, size: size ? tr(size.label) : z, n: POD.num(few) }), 'error');
        const box = $('qty-field') && $('qty-field').querySelector(`.qty-in[data-qc="${CSS.escape(c)}"][data-qz="${CSS.escape(z)}"]`);
        if (box) box.value = String(few);
      }
      // At least one piece: clearing the last box puts 1 back.
      if (!Object.values(g).some((row) => Object.values(row).some((n) => n > 0))) g[c][z] = 1;
      st.qty = g;
      st.sizePicked = true; // typed per size
      if (unpicked && z !== st.sizeId && g[c][z] > 0 && !(g[st.colorId] && g[st.colorId][st.sizeId])) {
        changeSize(z);
        renderOptions();
      }
    };
    $('qty-field').addEventListener('change', (e) => {
      const i = e.target.closest('.qty-in');
      if (i) {
        setCell(i.dataset.qc, i.dataset.qz, i.value);
        // (After the tap that moved the focus has landed: a box being typed in is then never drawn
        // again under the finger; the boxes are drawn once the focus leaves them.)
        setTimeout(() => {
          const was = JSON.stringify(st.qty);
          packSwitch();
          refreshChrome();
          if (JSON.stringify(st.qty) !== was) {
            // Moved to bigger packs: the boxes show it now, the keyboard on the box that holds them.
            qtyRedraw = false;
            const box = $('qty-field');
            if (box && box.contains(document.activeElement)) document.activeElement.blur();
            renderQty();
          } else redrawQtyIfLeft();
        }, 0);
      }
      if (e.target.id === 'qty-add' && e.target.value) {
        const g = qtyGrid();
        // (No size picked yet: the new colour's row starts empty, no piece under a size nobody chose. QA 25 Nov.)
        g[e.target.value] = !st.sizePicked && mix().sizes ? {} : { [st.sizeId]: 1 };
        st.qty = g;
        refreshChrome();
        // (Drawn now, with the new colour's row: it was waiting for a quantity box to lose its focus, QA 25 Nov.)
        renderQty({ force: true });
      }
    });
    $('qty-field').addEventListener('focusout', () => setTimeout(redrawQtyIfLeft, 0));
    $('qty-field').addEventListener('input', (e) => {
      const i = e.target.closest('.qty-in');
      if (!i) return;
      setCell(i.dataset.qc, i.dataset.qz, i.value);
      refreshPrice();
      const sum = $('qty-field').querySelector('.qty-sum');
      if (sum) sum.textContent = qtySumText();
    });
    $('qty-field').addEventListener('click', (e) => {
      const step = e.target.closest('[data-qstep]');
      if (step) {
        const g = qtyGrid();
        const now = (g[st.colorId] && g[st.colorId][st.sizeId]) || 0;
        st.qty = { [st.colorId]: { [st.sizeId]: Math.max(1, Math.min(1000, now + Number(step.dataset.qstep))) } };
        packSwitch();
        refreshChrome();
        renderQty();
      }
      const del = e.target.closest('[data-qdel]');
      if (del) {
        const g = qtyGrid();
        delete g[del.dataset.qdel];
        st.qty = g;
        refreshChrome();
        renderQty();
      }
    });
  }

  // ---------- Name lists (variable data) ----------
  // The customer uploads a spreadsheet (first row: column titles) and puts
  // fields such as {Name} into texts. Every row prints one copy with its own
  // values. Long values shrink to fit the width set for that text.
  const FIELD_RE = /\{([^{}\n]{1,60})\}/g;
  const fieldsOf = (s) => [...String(s || '').matchAll(FIELD_RE)].map((m) => m[1].trim());
  const srcText = (o) => (o.__mergeSrc != null ? o.__mergeSrc : o.text);
  const isFieldText = (o) => isText(o) && fieldsOf(srcText(o)).length > 0;
  const mergeObjects = () => canvas.getObjects().filter(isFieldText);
  /** Sides with at least one field (the side on screen is read from the canvas). */
  function fieldSides() {
    return designedSides().filter((s) => (s.id === st.side ? mergeObjects().length > 0 : (st.designs[s.id] || []).some((o) => o && /text/i.test(o.type) && fieldsOf(o.text).length)));
  }
  const mergeCount = () => (st.mergeList ? st.mergeList.rows.length : 0);
  // A Size / Colour column gives each row its own size and colour (team kits), as on the server.
  const looseTxt = (v) => String(v == null ? '' : v).toLowerCase()
    .replace(/[\u064b-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s\-–—_.()]+/g, '');
  function mergeVariantCols() {
    const cols = (st.mergeList && st.mergeList.columns) || [];
    const find = (titles) => cols.findIndex((c) => titles.includes(looseTxt(c)));
    const size = find(['size', 'sizes', 'مقاس', 'المقاس', 'المقاسات', 'مقاسات']);
    const color = find(['color', 'colour', 'لون', 'اللون']);
    return { size: mix().sizes ? size : -1, color: mix().colors ? color : -1 };
  }
  function matchSizeId(v) {
    const x = looseTxt(v);
    if (!x) return null;
    const p = st.product;
    const z = p.sizes.find((sz) => [sz.id, sz.label.en, sz.label.ar].some((y) => looseTxt(y) === x))
      || p.sizes.find((sz) => [sz.label.en, sz.label.ar].some((y) => looseTxt(y).startsWith(x) && x.length >= 2));
    return z ? z.id : null;
  }
  function matchColorId(v) {
    const x = looseTxt(v);
    const c = x && st.product.colors.find((co) => [co.id, co.name.en, co.name.ar].some((y) => looseTxt(y) === x));
    return c ? c.id : null;
  }
  /** The size of row i (its Size column, else the size chosen above). */
  const mergeRowSize = (i) => {
    const vc = mergeVariantCols();
    return (vc.size >= 0 && st.mergeList && matchSizeId(st.mergeList.rows[i][vc.size])) || st.sizeId;
  };
  /** Rows whose size or colour isn't one of the product's. */
  function mergeBadVariants() {
    const vc = mergeVariantCols();
    const bad = [];
    if (!st.mergeList) return bad;
    st.mergeList.rows.forEach((r, i) => {
      // A blank cell takes the size / colour chosen above (as the server does).
      const filled = (k) => String(r[k] || '').trim() !== '';
      if ((vc.size >= 0 && filled(vc.size) && !matchSizeId(r[vc.size])) || (vc.color >= 0 && filled(vc.color) && !matchColorId(r[vc.color]))) bad.push(i);
    });
    return bad;
  }
  const rowValues = (i) => {
    const L = st.mergeList;
    const r = (L && L.rows[i]) || [];
    return Object.fromEntries(L ? L.columns.map((c, k) => [c.trim(), r[k] || '']) : []);
  };
  const fillFields = (src, vals) => String(src).replace(FIELD_RE, (m, k) => (Object.hasOwn(vals, k.trim()) ? vals[k.trim()] : m));
  /** How wide the longest value may get: a share of the safe area (set per text). */
  const fitWidth = (o) => (o.mergeFit || 0.9) * rects().safe.w;
  const anchorX = (o) => (o.textAlign === 'left' ? 'left' : o.textAlign === 'right' ? 'right' : 'center');

  /** Show one row's values in a field text; returns how much the text had to shrink (1 = not at all). */
  function applyRow(o, vals) {
    if (o.__mergeSrc == null) {
      o.__mergeSrc = o.text;
      o.__mergeSize = o.fontSize;
      o.__mergeStyles = o.styles;
      o.__mergeLeft = o.left;
      o.__mergeTop = o.top;
      o.__mergeAnchor = o.translateToOriginPoint(o.getCenterPoint(), anchorX(o), 'center');
    }
    o.set({ text: fillFields(o.__mergeSrc, vals), fontSize: o.__mergeSize, styles: {} });
    const maxW = fitWidth(o);
    const w = o.width * Math.abs(o.scaleX || 1);
    let k = 1;
    if (w > maxW && w > 0) {
      k = maxW / w;
      o.set('fontSize', o.__mergeSize * k);
    }
    o.setPositionByOrigin(o.__mergeAnchor, anchorX(o), 'center');
    o.setCoords();
    return k;
  }
  function restoreFields(objs = canvas.getObjects()) {
    for (const o of objs) {
      if (o.__mergeSrc == null) continue;
      o.set({ text: o.__mergeSrc, fontSize: o.__mergeSize, styles: o.__mergeStyles || {}, left: o.__mergeLeft, top: o.__mergeTop });
      o.setCoords();
      ['__mergeSrc', '__mergeSize', '__mergeStyles', '__mergeLeft', '__mergeTop', '__mergeAnchor'].forEach((k) => delete o[k]);
    }
  }
  /** Download every letter used in the list, in the fonts of the field texts (Arabic too). */
  const mergeFontsDone = new Set();
  async function mergeFonts(objs) {
    if (!document.fonts || !st.mergeList) return;
    const sample = [...new Set(st.mergeList.rows.flat().join(''))].join('').slice(0, 4000) || 'Aa';
    let loaded = false;
    await Promise.all(objs.map(async (o) => {
      const key = `${o.fontFamily}|${o.fontWeight}|${o.fontStyle}|${st.mergeList.rows.length}|${sample.length}`;
      if (mergeFontsDone.has(key)) return;
      mergeFontsDone.add(key);
      await D.ensureFont(o.fontFamily, o.fontWeight, o.fontStyle);
      await document.fonts.load(`${o.fontStyle || 'normal'} ${o.fontWeight || 'normal'} 40px "${o.fontFamily}"`, sample).catch(() => {});
      loaded = true;
    }));
    if (loaded) objs.forEach((o) => { fabric.util.clearFabricFontCache(o.fontFamily); o.initDimensions && o.initDimensions(); });
  }

  // Preview: the canvas shows a row's real values (editing is paused meanwhile).
  async function showMergeRow(i) {
    if (!st.mergeList) return;
    const n = mergeCount();
    st.mergeRow = ((i % n) + n) % n;
    const objs = mergeObjects();
    await mergeFonts(objs);
    if (!st.mergePreview) {
      canvas.discardActiveObject();
      st.mergePreview = true;
      for (const o of canvas.getObjects()) {
        o.__mergeLock = { selectable: o.selectable, evented: o.evented };
        o.set({ selectable: false, evented: false });
      }
    }
    const vals = rowValues(st.mergeRow);
    objs.forEach((o) => applyRow(o, vals));
    canvas.requestRenderAll();
    renderMerge();
  }
  function endMergePreview() {
    if (!st.mergePreview) return;
    restoreFields();
    for (const o of canvas.getObjects()) {
      if (o.__mergeLock) o.set(o.__mergeLock);
      delete o.__mergeLock;
    }
    st.mergePreview = false;
    canvas.requestRenderAll();
    commit();
    renderMerge();
  }

  /** Rows whose values had to shrink a lot to fit (worth checking) and rows with empty fields. */
  function mergeReport() {
    const out = { small: [], empty: [] };
    const L = st.mergeList;
    if (!L) return out;
    const objs = mergeObjects();
    if (!objs.length) return out;
    const used = [...new Set(objs.flatMap((o) => fieldsOf(srcText(o))))];
    const wasPreview = st.mergePreview;
    const keep = wasPreview ? rowValues(st.mergeRow) : null;
    for (let i = 0; i < L.rows.length; i++) {
      const vals = rowValues(i);
      if (used.some((f) => Object.hasOwn(vals, f) && !String(vals[f]).trim())) out.empty.push(i);
      const k = Math.min(...objs.map((o) => applyRow(o, vals)));
      if (k < 0.7) out.small.push(i);
    }
    if (wasPreview) objs.forEach((o) => applyRow(o, keep));
    else restoreFields(objs);
    return out;
  }

  const rowList = (rows) => rows.slice(0, 12).map((i) => `<button class="link-btn" data-merge-row="${i}">${esc(POD.num(i + 1))}</button>`).join(', ') + (rows.length > 12 ? ` …` : '');
  function renderMerge() {
    const sec = $('sec-merge');
    if (!sec) return;
    sec.hidden = !st.product.merge;
    if ($('tool-names')) $('tool-names').hidden = !st.product.merge;
    if (!st.product.merge) return;
    const L = st.mergeList;
    const body = $('merge-body');
    if (!L) {
      body.innerHTML = `
        <div class="grid-2">
          <button class="btn btn-primary btn-sm" data-merge="upload">${esc(t('merge.upload'))}</button>
          <button class="btn btn-sm" data-merge="example">${esc(t('merge.example'))}</button>
        </div>
        ${mergeObjects().length ? `<p class="small merge-warn">${esc(t('merge.needList'))}</p>` : ''}`;
      return;
    }
    const objs = mergeObjects();
    const sel = active();
    const fieldSel = sel && isFieldText(sel) ? sel : null;
    const rep = st.mergePreview || !objs.length ? null : mergeReport();
    const row = st.mergeRow || 0;
    const first = L.columns[0];
    const label = (i) => String(L.rows[i][0] || '').slice(0, 40) || t('merge.emptyValue');
    body.innerHTML = `
      <div class="merge-sum">
        <span><strong>${esc(t(few(L.rows.length) ? 'merge.countFew' : 'merge.count', { n: POD.num(L.rows.length) }))}</strong>${esc(POD.sep ? POD.sep() : ' · ')}${esc(L.fileName || '')}</span>
        <button class="btn btn-sm" data-merge="remove">${esc(t('merge.remove'))}</button>
      </div>
      ${L.truncated ? `<p class="small merge-warn">${esc(t('merge.truncated', { n: POD.num(L.total), max: POD.num(L.rows.length) }))}</p>` : ''}
      <div class="field">
        <label>${esc(t('merge.insert'))}</label>
        <div class="chips">${L.columns.map((c, i) => `<button class="chip" data-merge-field="${i}">{${esc(c)}}</button>`).join('')}</div>
        <p class="muted small" style="margin:6px 0 0;line-height:1.5">${esc(t('merge.insertHelp', { field: `{${first}}` }))}</p>
      </div>
      ${objs.length ? `
      <div class="field">
        <label>${esc(t('merge.preview'))}</label>
        <div class="merge-nav">
          <button class="btn btn-sm" data-merge="prev" aria-label="${esc(t('merge.prev'))}">‹</button>
          <button class="btn btn-sm ${st.mergePreview ? 'active' : ''}" data-merge="toggle">${esc(st.mergePreview ? t('merge.row', { i: POD.num(row + 1), n: POD.num(L.rows.length), v: label(row) }) : t('merge.showNames'))}</button>
          <button class="btn btn-sm" data-merge="next" aria-label="${esc(t('merge.next'))}">›</button>
        </div>
        ${st.mergePreview ? `<button class="btn btn-sm btn-block" style="margin-top:6px" data-merge="end">${esc(t('merge.backToEdit'))}</button>` : ''}
      </div>` : `<p class="small merge-warn">${esc(t('merge.addField', { field: `{${first}}` }))}</p>`}
      ${fieldSel && !st.mergePreview ? `
      <div class="field">
        <label for="merge-fit">${esc(t('merge.fit'))} <span class="muted" id="merge-fit-val">${esc(POD.num(Math.round((fieldSel.mergeFit || 0.9) * 100)))}%</span></label>
        <input type="range" id="merge-fit" min="20" max="100" step="5" value="${Math.round((fieldSel.mergeFit || 0.9) * 100)}">
        <p class="muted small" style="margin:4px 0 0;line-height:1.5">${esc(t('merge.fitHelp'))}</p>
      </div>` : ''}
      ${mergeBadVariants().length ? `<p class="small merge-warn">${esc(plural('merge.badVariant', mergeBadVariants().length, { sizes: st.product.sizes.map((z) => tr(z.label)).join(POD.lang === 'ar' ? '، ' : ', ') }))} ${rowList(mergeBadVariants())}</p>` : ''}
      ${rep && rep.small.length ? `<p class="small merge-warn">${esc(plural('merge.small', rep.small.length))} ${rowList(rep.small)}</p>` : ''}
      ${rep && rep.empty.length ? `<p class="small merge-warn">${esc(plural('merge.empty', rep.empty.length))} ${rowList(rep.empty)}</p>` : ''}
      <p class="muted small" style="margin:8px 0 0">${esc(t(few(L.rows.length) ? 'merge.priceNoteFew' : 'merge.priceNote', { n: POD.num(L.rows.length) }))}</p>`;
  }

  async function uploadMergeFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error(t('merge.tooBig'));
    busy(true, t('merge.reading'));
    try {
      const res = await netFetch('/api/merge/parse', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-lang': POD.lang }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('merge.readFailed'));
      endMergePreview();
      st.mergeList = { columns: data.columns, rows: data.rows, total: data.total, truncated: data.truncated, fileName: file.name.slice(0, 80) };
      st.mergeRow = 0;
      mergeFontsDone.clear();
      // A design without fields yet: start one with the first column, ready to style.
      if (!mergeObjects().length && !designedSides().some((s) => s.id !== st.side && fieldSides().some((x) => x.id === s.id))) await addFieldText(0);
      refreshChrome();
      toast(plural('merge.loaded', data.rows.length), 'success');
    } finally {
      busy(false);
    }
  }
  async function addFieldText(col) {
    const L = st.mergeList;
    const token = `{${L ? L.columns[col] : 'Name'}}`;
    const o = active();
    // Typing in a text: put the field where the cursor is.
    if (o && isText(o) && o.isEditing) {
      o.insertChars(token, null, o.selectionStart, o.selectionEnd);
      o.selectionStart = o.selectionEnd = o.selectionStart + token.length;
      canvas.requestRenderAll();
      commit();
      return;
    }
    const sample = L ? L.rows.map((r) => r[col]).find(Boolean) || '' : '';
    const arabic = D.ARABIC_RE.test(sample);
    const font = arabic ? 'Cairo' : 'Montserrat';
    await D.ensureFont(font, 'bold', 'normal');
    addObject(new fabric.IText(token, {
      name: token,
      fontFamily: font,
      fontWeight: 'bold',
      fontSize: Math.round(area().w * 0.09),
      direction: arabic ? 'rtl' : 'ltr',
      fill: inkFor(surfaceHex()),
      textAlign: 'center',
      mergeFit: 0.9,
    }));
    commit();
  }
  function downloadExample() {
    const ar = POD.lang === 'ar';
    const pid = st.product.id;
    // An example that fits the product: cards with contact details, team kits with numbers and sizes.
    const rows = pid === 'bizcards' || pid === 'idcards'
      ? (ar
        ? [['الاسم', 'الوظيفة', 'الموبايل', 'الإيميل'], ['أحمد علي', 'مدير المبيعات', '01012345678', 'ahmed@example.com'], ['منى حسن', 'مهندسة', '01198765432', 'mona@example.com'], ['Omar Khaled', 'Designer', '01255511122', 'omar@example.com']]
        : [['Name', 'Position', 'Phone', 'Email'], ['Ahmed Ali', 'Sales Manager', '01012345678', 'ahmed@example.com'], ['Mona Hassan', 'Engineer', '01198765432', 'mona@example.com'], ['عمر خالد', 'مصمم', '01255511122', 'omar@example.com']])
      : st.product.category === 'apparel'
        ? (ar ? [['الاسم', 'الرقم', 'المقاس'], ['أحمد', '10', 'L'], ['منى', '7', 'M'], ['Omar', '9', 'XL']] : [['Name', 'Number', 'Size'], ['Ahmed', '10', 'L'], ['Mona', '7', 'M'], ['عمر', '9', 'XL']])
        : ar
          ? [['الاسم', 'الوظيفة'], ['أحمد علي', 'مدير'], ['منى حسن', 'مهندسة'], ['Omar Khaled', 'Designer']]
          : [['Name', 'Title'], ['Ahmed Ali', 'Manager'], ['Mona Hassan', 'Engineer'], ['عمر خالد', 'مصمم']];
    // The design's own fields ({الاسم}, {Name}…): the example has exactly those columns, so it works as it is
    // (a bilingual card uses both Arabic and English fields).
    const used = [...new Set([...mergeObjects().flatMap((o) => fieldsOf(srcText(o))), ...Object.entries(st.designs || {}).filter(([id]) => id !== st.side).flatMap(([, list]) => (list || []).filter((o) => o && /text/i.test(o.type)).flatMap((o) => fieldsOf(o.text)))])];
    if (used.length) {
      const samples = new Map();
      rows[0].forEach((h, i) => samples.set(h, rows.slice(1).map((r) => r[i])));
      const EN = { Name: ['Ahmed Ali', 'Mona Hassan', 'Omar Khaled'], Position: ['Sales Manager', 'Engineer', 'Designer'], Title: ['Manager', 'Engineer', 'Designer'], Phone: ['01012345678', '01198765432', '01255511122'], Email: ['ahmed@example.com', 'mona@example.com', 'omar@example.com'], Number: ['10', '7', '9'], Size: ['L', 'M', 'XL'] };
      const AR = { 'الاسم': ['أحمد علي', 'منى حسن', 'عمر خالد'], 'الوظيفة': ['مدير المبيعات', 'مهندسة', 'مصمم'], 'الموبايل': EN.Phone, 'الإيميل': EN.Email, 'الرقم': EN.Number, 'المقاس': EN.Size };
      // A bilingual design (Arabic and English fields): each field gets names in its own language on every row.
      const bilingual = used.some((f) => D.ARABIC_RE.test(f)) && used.some((f) => /[A-Za-z]/.test(f) && !D.ARABIC_RE.test(f));
      const sample = (f) => (bilingual && (AR[f] || EN[f])) || samples.get(f) || EN[f] || AR[f] || [`${f} 1`, `${f} 2`, `${f} 3`];
      rows.length = 0;
      rows.push(used, ...[0, 1, 2].map((i) => used.map((f) => sample(f)[i] || '')));
      // A size column for team kits even when the design doesn't show the size.
      if (st.product.category === 'apparel' && !used.some((f) => ['Size', 'المقاس'].includes(f))) {
        rows[0].push(ar ? 'المقاس' : 'Size');
        // Sizes this product really has (kids garments have their own).
        const zs = st.product.sizes.map((z) => tr(z.label));
        [0, 1, 2].forEach((i) => rows[i + 1].push(zs[Math.min(i + Math.floor(zs.length / 3), zs.length - 1)] || zs[0] || ''));
      }
    }
    const csv = '﻿' + rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n') + '\r\n';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: ar ? 'قائمة-الأسماء.csv' : 'names.csv' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  /** Open the name-list section (toolbar button, or ?names=1 from the product page). */
  function openNames() {
    if (!$('sec-merge') || $('sec-merge').hidden) return;
    closeFlyouts();
    if (MOBILE.matches) {
      canvas.discardActiveObject();
      setSheet('product');
    }
    requestAnimationFrame(() => {
      const sec = $('sec-merge');
      sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
      sec.classList.remove('flash');
      void sec.offsetWidth;
      sec.classList.add('flash');
    });
  }
  if ($('tool-names')) $('tool-names').addEventListener('click', openNames);
  if ($('sec-merge')) {
    $('merge-body').addEventListener('click', serial(async (e) => {
      const rowBtn = e.target.closest('[data-merge-row]');
      if (rowBtn) return showMergeRow(Number(rowBtn.dataset.mergeRow));
      const f = e.target.closest('[data-merge-field]');
      if (f) {
        if (st.mergePreview) endMergePreview();
        return addFieldText(Number(f.dataset.mergeField));
      }
      const b = e.target.closest('[data-merge]');
      if (!b) return;
      const act = b.dataset.merge;
      if (act === 'upload') $('merge-file').click();
      else if (act === 'example') downloadExample();
      else if (act === 'remove') {
        endMergePreview();
        st.mergeList = null;
        refreshChrome();
      } else if (act === 'toggle') {
        if (st.mergePreview) endMergePreview();
        else await showMergeRow(st.mergeRow || 0);
      } else if (act === 'prev') await showMergeRow((st.mergeRow || 0) - 1);
      else if (act === 'next') await showMergeRow((st.mergeRow || 0) + 1);
      else if (act === 'end') endMergePreview();
    }));
    $('merge-file').addEventListener('change', serial(async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      await uploadMergeFile(file);
    }));
    $('merge-body').addEventListener('input', (e) => {
      if (e.target.id !== 'merge-fit') return;
      const o = active();
      if (!o || !isFieldText(o)) return;
      o.set('mergeFit', Number(e.target.value) / 100);
      $('merge-fit-val').textContent = `${POD.num(Number(e.target.value))}%`;
      scheduleCommit();
    });
    $('merge-body').addEventListener('change', (e) => { if (e.target.id === 'merge-fit') renderMerge(); });
  }

  /**
   * Print files for a side with fields (on screen): the background without the
   * field texts (and anything lying over them), and one transparent picture
   * per row of just that part, all the same size, cropped to `box` (print pixels).
   */
  async function exportMergeSide(side, onProgress) {
    const { bleed, u } = rects(side.id);
    const mult = Math.min(TARGET_DPI / u, Math.sqrt(MAX_PRINT_PIXELS / (bleed.w * bleed.h)), MAX_PRINT_SIDE / Math.max(bleed.w, bleed.h));
    // The same size as the side's print file (exportPrint rounds): the server checks they match exactly.
    const W = Math.round(bleed.w * mult);
    const H = Math.round(bleed.h * mult);
    const objs = canvas.getObjects().filter((o) => o.name !== '__cropper' && o.visible !== false);
    const fields = objs.filter(isFieldText);
    await mergeFonts(fields);
    const n = mergeCount();
    // 1. Where the field texts can reach over every row.
    const union = (a, r) => (a ? { l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.left + r.width), b: Math.max(a.b, r.top + r.height) } : { l: r.left, t: r.top, r: r.left + r.width, b: r.top + r.height });
    let R = null;
    for (let i = 0; i < n; i++) {
      const vals = rowValues(i);
      for (const o of fields) {
        applyRow(o, vals);
        R = union(R, o.getBoundingRect(true, true));
      }
    }
    // 2. Objects above the lowest field text that overlap that area go with the texts (so layers stay in order).
    const low = Math.min(...fields.map((o) => objs.indexOf(o)));
    const front = new Set(fields);
    for (let again = true; again;) {
      again = false;
      for (const o of objs.slice(low)) {
        if (front.has(o)) continue;
        const r = o.getBoundingRect(true, true);
        if (r.left < R.r && r.left + r.width > R.l && r.top < R.b && r.top + r.height > R.t) {
          front.add(o);
          R = union(R, r);
          again = true;
        }
      }
    }
    // 3. The box in print pixels (inside the print file).
    const pad = 2;
    const x = Math.max(0, Math.floor((R.l - bleed.x) * mult) - pad);
    const y = Math.max(0, Math.floor((R.t - bleed.y) * mult) - pad);
    const box = { x, y, w: Math.max(1, Math.min(W, Math.ceil((R.r - bleed.x) * mult) + pad) - x), h: Math.max(1, Math.min(H, Math.ceil((R.b - bleed.y) * mult) + pad) - y) };
    const exact = (el, w, h) => {
      if (el.width === w && el.height === h) return el;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(el, 0, 0);
      return c;
    };
    // 4. The background: everything except the front set.
    restoreFields(fields);
    front.forEach((o) => { o.__mergeVis = o.visible; o.visible = false; });
    let base;
    try {
      base = await canvasBlob(exact(withArtworkOnly(() => canvas.toCanvasElement(mult, { left: bleed.x, top: bleed.y, width: (W + 0.5) / mult, height: (H + 0.5) / mult })), W, H));
    } finally {
      front.forEach((o) => { o.visible = o.__mergeVis !== false; delete o.__mergeVis; });
    }
    // 5. One picture per row: only the front set, cropped to the box.
    const others = objs.filter((o) => !front.has(o));
    others.forEach((o) => { o.__mergeVis = o.visible; o.visible = false; });
    const pics = [];
    try {
      const region = { left: bleed.x + box.x / mult, top: bleed.y + box.y / mult, width: (box.w + 0.5) / mult, height: (box.h + 0.5) / mult };
      for (let i = 0; i < n; i++) {
        const vals = rowValues(i);
        fields.forEach((o) => applyRow(o, vals));
        const el = withArtworkOnly(() => canvas.toCanvasElement(mult, region));
        pics.push(await canvasBlob(exact(el, box.w, box.h)));
        if (onProgress && (i % 10 === 9 || i === n - 1)) onProgress(i + 1, n);
      }
    } finally {
      others.forEach((o) => { o.visible = o.__mergeVis !== false; delete o.__mergeVis; });
      restoreFields(fields);
      canvas.requestRenderAll();
    }
    return { base, bin: new Blob(pics, { type: 'application/octet-stream' }), box };
  }

  // ---------- Export & add to cart ----------
  /** Run fn with the canvas showing only the artwork (no product, guides or on-screen clipping). */
  function withArtworkOnly(fn, clip = null) {
    const objs = canvas.getObjects();
    const clips = objs.map((o) => o.clipPath);
    const bg = canvas.backgroundImage;
    const ov = canvas.overlayImage;
    const vt = canvas.viewportTransform.slice();
    const limits = [fabric.perfLimitSizeTotal, fabric.maxCacheSideLimit];
    fabric.perfLimitSizeTotal = 64e6; // full resolution for any object that still caches
    fabric.maxCacheSideLimit = 8192;
    st.exporting = true;
    canvas.backgroundImage = null;
    canvas.overlayImage = null;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    objs.forEach((o) => { o.clipPath = clip ? clipRect(clip) : null; o.dirty = true; });
    try {
      return fn();
    } finally {
      objs.forEach((o, i) => { o.clipPath = clips[i]; o.dirty = true; });
      canvas.backgroundImage = bg;
      canvas.overlayImage = ov;
      canvas.setViewportTransform(vt);
      [fabric.perfLimitSizeTotal, fabric.maxCacheSideLimit] = limits;
      st.exporting = false;
    }
  }
  const canvasBlob = (el, type = 'image/png') => new Promise((resolve, reject) => el.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), type));

  /** Transparent print file: artwork + bleed at up to 300 DPI. */
  function exactSize(el, w, h) {
    if (!w || !h || (el.width === w && el.height === h)) return el;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(el, 0, 0, w, h);
    return out;
  }
  function exportPrint(side) {
    const { bleed, u, b } = rects(side.id);
    const mult = Math.min(TARGET_DPI / u, Math.sqrt(MAX_PRINT_PIXELS / (bleed.w * bleed.h)), MAX_PRINT_SIDE / Math.max(bleed.w, bleed.h));
    // The browser drops the fraction of width × scale, which can leave the file a pixel short of its
    // physical size × DPI: draw it again at the exact size (a change of well under 0.1%).
    const box = st.pattern ? rects(side.id).trim : bleed;
    const el = exactSize(st.pattern ? exportTile(mult) : withArtworkOnly(() => canvas.toCanvasElement(mult, { left: bleed.x, top: bleed.y, width: bleed.w, height: bleed.h })), Math.round(box.w * mult), Math.round(box.h * mult));
    // Canvas prints: the band round the front becomes the chosen edge (mirror, white, black).
    if (st.product.model && st.product.model.type === 'canvas') POD.canvasEdges(el, b * mult, st.colorId);
    return canvasBlob(el);
  }
  // ---------- Fabric patterns ----------
  /**
   * The seamless tile: the artwork in the tile, plus what crosses its edges
   * drawn again where the neighbouring tiles put it (for this repeat).
   */
  function exportTile(mult) {
    const r = rects().trim;
    const offs = POD.wrapOffsets(st.pattern ? st.pattern.repeat : 'mirror', r.w, r.h);
    return withArtworkOnly(() => {
      const base = canvas.toCanvasElement(mult, { left: r.x, top: r.y, width: r.w, height: r.h });
      const boxes = canvas.getObjects().map((o) => o.getBoundingRect(true, true));
      const ctx = base.getContext('2d');
      for (const [ox, oy] of offs) {
        const g = { x: r.x - ox, y: r.y - oy };
        if (!boxes.some((b) => b.left < g.x + r.w && b.left + b.width > g.x && b.top < g.y + r.h && b.top + b.height > g.y)) continue;
        ctx.drawImage(canvas.toCanvasElement(mult, { left: g.x, top: g.y, width: r.w, height: r.h }), 0, 0, base.width, base.height);
      }
      return base;
    }, null);
  }
  /** The product picture (bed, curtains, fabric roll) covered with the repeated tile, `width` pixels wide. */
  async function patternScene(tile, width) {
    const sc = st.product.pattern.scene;
    const k = width / W;
    const out = document.createElement('canvas');
    out.width = Math.round(W * k);
    out.height = Math.round(H * k);
    const ctx = out.getContext('2d');
    const [bg, ov] = await Promise.all([loadHtmlImage(POD.mockupUrl(sc, color().hex)), sc.overlay ? loadHtmlImage(POD.mockupUrl(sc, color().hex, 'overlay')) : null]);
    ctx.drawImage(bg, 0, 0, out.width, out.height);
    const f = sc.fill;
    const cm = POD.fabricCm(st.product, st.sizeId);
    const tw = (f.w * k * st.pattern.tileCm) / cm[0];
    POD.drawPattern(ctx, tile, { repeat: st.pattern.repeat, tw, th: tw, x: f.x * k, y: f.y * k, w: f.w * k, h: f.h * k });
    if (ov) ctx.drawImage(ov, 0, 0, out.width, out.height);
    return out;
  }
  const patternTile = (px) => exportTile(px / rects().trim.w);
  /** The small "how it repeats" picture in the options panel. */
  let patTimer = null;
  let patToken = 0;
  function schedulePatternPreview(delay = 400) {
    if (!st.pattern) return;
    clearTimeout(patTimer);
    patTimer = setTimeout(async () => {
      const my = ++patToken;
      try {
        const scene = await patternScene(patternTile(240), 600);
        if (my !== patToken || !st.pattern) return;
        const cv = $('pat-preview');
        cv.width = scene.width;
        cv.height = scene.height;
        cv.getContext('2d').drawImage(scene, 0, 0);
      } catch (e) { /* the picture is only a help */ }
    }, delay);
  }

  /** Product mockup with the trimmed design, for the cart, order page and print queue. */
  function exportPreview() {
    // Fabric: the product covered with the pattern (not the single tile).
    if (st.pattern) return patternScene(patternTile(360), 600).then((cv) => canvasBlob(cv));
    // The whole mockup at 1.2x, without the on-screen garment-size view.
    const z = canvas.width / W;
    const vt = canvas.viewportTransform.slice();
    st.exporting = true;
    const r = rects().trim;
    const objs = canvas.getObjects();
    const clips = objs.map((o) => o.clipPath);
    objs.forEach((o) => { o.clipPath = clipRect(r); o.dirty = true; });
    canvas.setViewportTransform([z, 0, 0, z, 0, 0]);
    try {
      return canvasBlob(canvas.toCanvasElement(1.2 / z));
    } finally {
      canvas.setViewportTransform(vt);
      objs.forEach((o, i) => { o.clipPath = clips[i]; o.dirty = true; });
      st.exporting = false;
    }
  }
  /** Vector SVG of the artwork at its physical size, with the fonts embedded. */
  async function exportSvg(baseSideDef) {
    const side = sideDef(baseSideDef.id); // this size's physical inches
    const { bleed, b, u } = rects(side.id);
    const wIn = +(bleed.w / u).toFixed(4);
    const hIn = +(bleed.h / u).toFixed(4);
    fabric.Text.prototype.svgUnitsPerInch = u;
    let svg = withArtworkOnly(() => canvas.toSVG({ viewBox: { x: bleed.x, y: bleed.y, width: bleed.w, height: bleed.h }, width: `${wIn}in`, height: `${hIn}in` }));
    // Photos are blob: URLs while editing; embed them so the file works anywhere.
    const blobs = [...new Set(svg.match(/blob:[^"']+/g) || [])];
    for (const url of blobs) {
      if (!inlined.has(url)) inlined.set(url, toDataUrl(url));
      svg = svg.split(url).join(await inlined.get(url).catch(() => ''));
    }
    // (And the site's own design pictures: uploaded ready designs.)
    if (D.inlineSvgImages) svg = await D.inlineSvgImages(svg);
    const fonts = await window.POD_FX.fontFaceCss(canvas.getObjects());
    const note = `<!-- ebda3 artwork: ${side.printWidthIn} x ${side.printHeightIn} in${b ? ` + ${side.bleedIn} in bleed each side` : ''}. sRGB. -->`;
    return svg.replace(/<defs>/, `${note}<defs><style>${fonts}</style>`);
  }
  /** Design layer only, in mockup coordinates, for the live previews. */
  function exportDesignLayer(scale, clip = rects().trim) {
    return withArtworkOnly(() => canvas.toCanvasElement(scale, { left: 0, top: 0, width: W, height: H }), clip);
  }

  // ---------- Photo quality boost ----------
  function boostScale(o) {
    const el = o._originalElement || o.getElement();
    const long = Math.max(el.naturalWidth || el.width, el.naturalHeight || el.height) || 1;
    const dpi = imageDpi(o);
    return Math.max(1, Math.min(4, 4000 / long, Math.max(1.5, 300 / Math.max(1, dpi))));
  }
  function boostBox(o) {
    const dpi = imageDpi(o);
    const k = boostScale(o);
    const text = o.boosted ? t('boost.already') : dpi < 300 && k > 1.05 ? t('boost.textLow', { dpi, to: Math.round(dpi * k) }) : t('boost.textOk');
    return `<div class="field boost-box"><p>${esc(text)}</p>
      <button class="btn btn-sm btn-block ${o.boosted ? '' : 'btn-primary'}" data-act="boost" ${o.boosted ? 'disabled' : ''}>${esc(t('boost.button'))}</button></div>`;
  }
  /** Enlarge and sharpen the photo on the server, keeping its size, crop, shape and filters. */
  async function boostImage(o) {
    if (!o || o.type !== 'image' || o.boosted) return;
    const k0 = boostScale(o);
    busy(true, t('boost.working'));
    try {
      const blob = await (await fetch(o.getSrc())).blob();
      const type = /^image\/(png|jpeg|webp)$/.test(blob.type) ? blob.type : 'image/png';
      const res = await netFetch('/api/enhance', { method: 'POST', headers: { 'Content-Type': type, 'x-scale': k0.toFixed(3), 'x-lang': POD.lang }, body: blob });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || t('msg.badImage'));
      const k = Number(res.headers.get('X-Scale')) || k0;
      const url = URL.createObjectURL(await res.blob());
      const keep = { cropX: (o.cropX || 0) * k, cropY: (o.cropY || 0) * k, width: o.width * k, height: o.height * k, scaleX: o.scaleX / k, scaleY: o.scaleY / k };
      await new Promise((resolve) => o.setSrc(url, resolve));
      o.set({ ...keep, boosted: true });
      if (o.filters && o.filters.length) o.applyFilters();
      o.setCoords();
      o.dirty = true;
      canvas.requestRenderAll();
      commit();
      renderProps();
      scheduleCheck();
      toast(t('boost.done', { dpi: imageDpi(o) }));
    } finally {
      busy(false);
    }
  }

  // ---------- AI help ----------
  const aiState = { tab: 'slogan', tone: 'funny', lang: POD.lang === 'en' ? 'en' : 'ar', style: 'modern', slogans: [], logos: [], busy: false };
  document.querySelectorAll('[data-ai-pick="lang"] .chip').forEach((c) => c.classList.toggle('active', c.dataset.v === aiState.lang));
  // The AI tool only shows once the shop has switched AI help on.
  const aiTool = document.querySelector('.tool[data-flyout="ai"]');
  aiTool.hidden = true;
  POD.api('/api/ai/status').then((r) => {
    aiTool.hidden = !r.enabled;
    $('ai-off').hidden = r.enabled;
    $('ai-on').hidden = !r.enabled;
  }).catch(() => { $('ai-off').hidden = false; $('ai-on').hidden = true; });
  $('flyout-ai').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ai-tab]');
    if (tab) {
      aiState.tab = tab.dataset.aiTab;
      document.querySelectorAll('[data-ai-tab]').forEach((b) => b.classList.toggle('active', b === tab));
      $('ai-slogan-form').hidden = aiState.tab !== 'slogan';
      $('ai-logo-form').hidden = aiState.tab !== 'logo';
      renderAiResults();
      return;
    }
    const chip = e.target.closest('[data-ai-pick] .chip');
    if (chip) {
      const box = chip.parentElement;
      aiState[box.dataset.aiPick] = chip.dataset.v;
      box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    }
  });
  function aiSpinner() {
    $('ai-results').innerHTML = `<div class="ai-spinner"><div class="spinner"></div>${esc(t('ai.working'))}</div>`;
  }
  async function renderAiResults() {
    const box = $('ai-results');
    if (aiState.tab === 'slogan') {
      box.innerHTML = aiState.slogans.length
        ? `<p class="ai-note">${esc(t('ai.tapToAdd'))}</p><div class="ai-results">${aiState.slogans.map((sl, i) => `<button type="button" class="ai-slogan" data-slogan="${i}" dir="auto" style="font-family:'${esc(sl.font)}'">${esc(sl.text)}</button>`).join('')}</div><p class="ai-note">${esc(t('ai.notice'))}</p>`
        : '';
      aiState.slogans.forEach((sl) => D.ensureFont(sl.font));
      return;
    }
    if (!aiState.logos.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<p class="ai-note">${esc(t('ai.tapLogo'))}</p><div class="ai-logos">${aiState.logos.map((l, i) => `<button type="button" class="ai-logo" data-logo="${i}"><img alt="" data-logo-thumb="${i}"><small dir="auto">${esc(l.name.ar)}</small></button>`).join('')}</div><p class="ai-note">${esc(t('ai.notice'))}</p>`;
    const bg = surfaceHex();
    for (let i = 0; i < aiState.logos.length; i++) {
      const img = box.querySelector(`[data-logo-thumb="${i}"]`);
      if (img) img.src = await D.templateThumb(aiState.logos[i], bg);
    }
  }
  function showAiLeft(n) {
    $('ai-left').textContent = Number.isFinite(n) ? t('ai.left', { n: POD.num ? POD.num(n) : n }) : '';
  }
  async function aiRequest(url, body) {
    if (aiState.busy) return null;
    aiState.busy = true;
    aiSpinner();
    try {
      const r = await POD.api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      showAiLeft(r.left);
      return r;
    } catch (err) {
      $('ai-results').innerHTML = '';
      toast(err.message, 'error');
      return null;
    } finally {
      aiState.busy = false;
    }
  }
  $('ai-slogan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await aiRequest('/api/ai/slogans', { about: $('ai-about').value, tone: aiState.tone, lang: aiState.lang });
    if (!r) return;
    aiState.slogans = r.slogans || [];
    $('ai-slogan-go').textContent = t('ai.again');
    renderAiResults();
  });
  $('ai-logo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('ai-name').value.trim();
    if (!name) { $('ai-name').focus(); return toast(t('ai.namePh'), 'error'); }
    const r = await aiRequest('/api/ai/logos', { name, tagline: $('ai-tagline').value, style: aiState.style, garment: surfaceHex() });
    if (!r) return;
    const stamp = Date.now();
    aiState.logos = (r.logos || []).map((l, i) => ({ id: `ai-${stamp}-${i}`, name: { en: l.title, ar: l.title }, items: l.items }));
    $('ai-logo-go').textContent = t('ai.again');
    renderAiResults();
  });
  $('ai-results').addEventListener('click', serial(async (e) => {
    const sb = e.target.closest('[data-slogan]');
    if (sb) {
      const sl = aiState.slogans[Number(sb.dataset.slogan)];
      if (!sl) return;
      await D.ensureFont(sl.font, 'normal');
      const arabic = D.ARABIC_RE.test(sl.text);
      addObject(new fabric.IText(sl.text, {
        name: 'Text', fontFamily: sl.font, fontSize: Math.round(area().w * 0.12), fill: inkFor(surfaceHex()),
        direction: arabic ? 'rtl' : 'ltr', textAlign: 'center', paintFirst: 'stroke',
      }));
      closeFlyouts();
      return;
    }
    const lb = e.target.closest('[data-logo]');
    if (lb) {
      const tpl = aiState.logos[Number(lb.dataset.logo)];
      if (tpl) await addTemplate(tpl);
    }
  }));

  // ---------- Share a design (friends approve or suggest changes) ----------
  const hashStr = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  const shareKey = () => 'pod-share:' + st.product.id;
  function designSignature() {
    const designs = {};
    for (const sd of allSides()) designs[sd.id] = sd.id === st.side ? serialize() : (st.designs[sd.id] || []);
    return hashStr(JSON.stringify([designs, st.colorId, st.sizeId, st.offsets, st.options || {}]));
  }
  function readLastShare() {
    try { return JSON.parse(localStorage.getItem(shareKey()) || 'null'); } catch (e) { return null; }
  }
  const shareUrl = (id) => `${location.origin}/s/${id}`;
  function renderShareReplies(share) {
    const fb = (share && share.feedback) || [];
    $('share-dialog-replies').innerHTML = fb.length
      ? fb.slice().reverse().map((f) => `<li class="${f.vote === 'up' ? 'up' : 'change'}"><strong>${f.vote === 'up' ? '👍 ' + esc(t('share.approved')) : '✏️ ' + esc(t('share.wantsChange'))}</strong>${f.comment ? `<p dir="auto">${esc(f.comment)}</p>` : ''}<span class="muted small">${f.name ? esc(f.name) : ''}</span></li>`).join('')
      : `<li class="muted small">${esc(t('share.noReplies'))}</li>`;
  }
  function openShareDialog(share) {
    st.share = share;
    const url = shareUrl(share.id);
    $('share-url').value = url;
    $('share-wa').href = 'https://wa.me/?text=' + encodeURIComponent(t('share.message', { url }));
    $('share-native').hidden = !navigator.share;
    renderShareReplies(share);
    $('share-dialog').hidden = false;
  }
  $('share-open').addEventListener('click', serial(async () => {
    cancelCrop();
    commit();
    const sides = designedSides();
    if (!sides.length) return toast(t('msg.addFirst'), 'error');
    const sig = designSignature();
    const last = readLastShare();
    if (last && last.sig === sig) {
      try {
        return openShareDialog(await POD.api('/api/shares/' + encodeURIComponent(last.id)));
      } catch (e) { /* expired or removed: make a new link */ }
    }
    canvas.discardActiveObject();
    const prevZoom = st.zoom;
    if (st.zoom !== 1) setZoom(1);
    const wasPreview = st.preview;
    if (wasPreview) togglePreview();
    const original = st.side;
    busy(true, t('share.creating'));
    try {
      const sidesPayload = {};
      const previews = {};
      for (const sd of sides) {
        await showSide(sd.id);
        // (Fabrics: the repeat style and tile size go with it, as with a design for the cart: QA 25 Nov.)
        sidesPayload[sd.id] = { objects: await inlineImages(st.designs[sd.id]), ...(st.offsets[sd.id] ? { offset: st.offsets[sd.id] } : {}), ...(st.pattern ? { pattern: { repeat: st.pattern.repeat, tileCm: st.pattern.tileCm } } : {}), area: xywh(baseArea(sd.id)) };
        previews[sd.id] = await toDataUrl(URL.createObjectURL(await exportPreview()));
      }
      await showSide(original);
      const share = await POD.api('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: st.product.id, color: st.colorId, size: st.sizeId, sizePicked: Boolean(st.sizePicked), options: st.options || {}, sides: sidesPayload, previews }),
      });
      try { localStorage.setItem(shareKey(), JSON.stringify({ id: share.id, sig })); } catch (e) { /* private mode */ }
      openShareDialog(share);
    } catch (err) {
      await showSide(original).catch(() => {});
      toast(err.message, 'error');
    } finally {
      busy(false);
      if (st.zoom !== prevZoom) setZoom(prevZoom);
      canvas.requestRenderAll();
    }
  }));
  $('share-close').addEventListener('click', () => { $('share-dialog').hidden = true; });
  $('share-dialog').addEventListener('click', (e) => { if (e.target === $('share-dialog')) $('share-dialog').hidden = true; });
  $('share-copy').addEventListener('click', async () => {
    const input = $('share-url');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (e) {
      input.select();
      document.execCommand('copy');
    }
    toast(t('share.copied'));
  });
  $('share-native').addEventListener('click', () => {
    const url = $('share-url').value;
    navigator.share({ title: 'ebda3', text: t('share.message', { url: '' }).trim(), url }).catch(() => {});
  });
  $('share-refresh').addEventListener('click', async () => {
    if (!st.share) return;
    try { renderShareReplies(st.share = await POD.api('/api/shares/' + encodeURIComponent(st.share.id))); } catch (err) { toast(err.message, 'error'); }
  });

  // ---------- Saved design (draft) ----------
  let draftTimer = null;
  let draftSaving = Promise.resolve(true);
  let startingOver = false; // "Start a new design": nothing is saved while the page reloads
  /** Save the current design for this product in the browser (or forget it when empty). */
  let lastPreview = null; // the thumbnail of the last full save (reused by quick saves when leaving)
  function saveDraft({ quick = false, force = false } = {}) {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!draftMode || st.exporting || startingOver) return draftSaving;
    // The customer's own saved design stays until this one is changed (then this one is saved instead).
    if (heldDraft) {
      if (!st.dirty && !force) return draftSaving;
      heldDraft = null;
      hideHeldBar();
    }
    const designs = {};
    for (const s of keptSides()) designs[s.id] = s.id === st.side ? serialize() : (st.designs[s.id] || []);
    const empty = !Object.values(designs).some((o) => o.length);
    const productId = st.product.id;
    const meta = { productId, colorId: st.colorId, sizeId: st.sizeId, side: st.side, offsets: { ...st.offsets }, areas: placedAreas(), ...(st.pattern ? { pattern: { ...st.pattern } } : {}), method: st.method, options: st.options || {}, mergeList: st.mergeList || null, qty: st.qty || null, library: st.libraryId || null, libraryNames: st.libraryNames || null, sizePicked: Boolean(st.sizePicked) };
    let preview = null;
    if (!empty && !quick) {
      try {
        preview = exportPreview(); // a Blob promise for the products page thumbnail
      } catch (e) {
        preview = null;
      }
    }
    draftSaving = draftSaving.then(async () => {
      if (empty) {
        await POD.drafts.remove(productId);
        return true;
      }
      const inl = {};
      for (const [id, objs] of Object.entries(designs)) inl[id] = await inlineImages(objs);
      const blob = preview ? await preview.catch(() => null) : lastPreview;
      if (blob) lastPreview = blob;
      const ok = await POD.drafts.set(productId, { ...meta, designs: inl, preview: blob, savedAt: new Date().toISOString() });
      if (ok && !rescueWritten) try { localStorage.removeItem('pod-rescue:' + productId); } catch (e) { /* private mode */ }
      return ok;
    });
    return draftSaving;
  }
  function scheduleDraft() {
    if (!draftMode) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 600);
  }
  // Leaving right after a change: save it now (quickly, without a new thumbnail), not after the short wait,
  // and keep a small copy in localStorage at once (written before the page goes; the real save may not finish).
  let rescueWritten = false;
  function rescueCopy() {
    // Only unsaved changes (not after adding to the cart, saving or sending: st.dirty is cleared then).
    if (!draftMode || st.exporting || startingOver || !st.product || !st.dirty) return;
    try {
      const designs = {};
      for (const sd of keptSides()) designs[sd.id] = sd.id === st.side ? serialize() : (st.designs[sd.id] || []);
      if (!Object.values(designs).some((o) => o.length)) return;
      let acct = '';
      try { const v = localStorage.getItem('pod-acct'); acct = v && v !== '1' ? v : ''; } catch (e) { /* private mode */ }
      const json = JSON.stringify({ at: Date.now(), acct, productId: st.product.id, colorId: st.colorId, sizeId: st.sizeId, side: st.side, offsets: st.offsets, areas: placedAreas(), pattern: st.pattern || null, method: st.method, options: st.options || {}, qty: st.qty || null, library: st.libraryId || null, libraryNames: st.libraryNames || null, sizePicked: Boolean(st.sizePicked), designs });
      // Pictures live in the browser's memory only while the page is open: those designs rely on the real save.
      if (json.includes('"blob:') || json.length > 1500000) return;
      localStorage.setItem('pod-rescue:' + st.product.id, json);
      rescueWritten = true;
    } catch (e) { console.warn('[draft] quick copy:', e.message); }
  }
  const leaving = () => {
    if (commitTimer) commit(); // typing that hasn't been taken in yet
    rescueCopy();
    if (draftTimer) saveDraft({ quick: true });
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leaving(); else rescueWritten = false; });
  window.addEventListener('pagehide', leaving);
  // A link in the shop tapped right after a change: finish saving first, then go.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || !draftMode || !draftTimer || a.target === '_blank' || a.hasAttribute('download') || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const to = new URL(a.href, location.href);
    if (to.origin !== location.origin) return;
    e.preventDefault();
    Promise.race([saveDraft({ quick: true }).then(() => POD.drafts.flush && POD.drafts.flush(st.product.id)), new Promise((r) => setTimeout(r, 3000))])
      .finally(() => { location.href = to.href; });
  }, true);

  function busy(on, text) {
    $('busy').hidden = !on;
    if (text) $('busy-text').textContent = text;
  }

  /** Clothes with sizes, and the customer hasn't picked one yet (a name list carries its own sizes). */
  function needsSize() {
    const p = st.product;
    if (p.category !== 'apparel' || p.sizes.length < 2 || st.sizePicked || st.editingCartIndex !== null) return false;
    if (p.merge && st.mergeList) return false;
    return new Set(qtyLines().map((l) => l.size)).size < 2;
  }
  /** The dashboard's sign-in in this tab (the Review tab opens the editor with it). */
  function adminToken() {
    try { return sessionStorage.getItem('pod-admin-token') || ''; } catch (e) { return ''; }
  }
  /** The shop's edit: the note, then "to the customer" or "print without asking". Resolves { print, note } or null. */
  function askShopEdit() {
    const box = $('shop-edit-ask');
    if (!box) return Promise.resolve(null);
    const owner = Boolean(st.shopEdit && st.shopEdit.owner);
    $('shop-edit-help').textContent = t(owner ? 'shopEdit.help' : 'shopEdit.helpTeam');
    $('shop-edit-print').textContent = t(owner ? 'shopEdit.print' : 'shopEdit.printTeam');
    $('shop-edit-msg').hidden = true;
    box.hidden = false;
    $('shop-edit-note').focus();
    return new Promise((resolve) => {
      const done = (v) => {
        box.hidden = true;
        box.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      const onClick = (e) => {
        if (e.target === box || e.target.closest('#shop-edit-cancel')) return done(null);
        const send = e.target.closest('#shop-edit-send');
        const print = e.target.closest('#shop-edit-print');
        if (!send && !print) return;
        const note = $('shop-edit-note').value.trim();
        // (Invisible marks only are no note: the server says so too.)
        if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(note.replace(/[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\u3164\ufeff\uffa0]/g, ''))) {
          $('shop-edit-msg').textContent = t('shopEdit.noteNeeded');
          $('shop-edit-msg').hidden = false;
          $('shop-edit-note').focus();
          return;
        }
        if (print && owner && !confirm(t('shopEdit.printConfirm'))) return;
        done({ print: Boolean(print), note });
      };
      box.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
    });
  }
  function askSize() {
    const box = $('size-ask');
    const lines = qtyLines();
    const n = lines.reduce((m, l) => m + l.qty, 0);
    $('size-ask-title').textContent = t('sizeAsk.title');
    $('size-ask-note').textContent = n > 1 ? t('sizeAsk.many', { n: POD.num(n) }) : t('sizeAsk.one');
    $('size-ask-chips').innerHTML = st.product.sizes.filter((z) => sizeOk(st.product, st.colorId, z)).map((z) => `<button type="button" class="chip" data-ask-size="${esc(z.id)}">${esc(tr(z.label))}${POD.sizeNote(st.product, z) ? ` <span style="opacity:.7">${esc(POD.sizeNote(st.product, z))}</span>` : ''}</button>`).join('');
    box.hidden = false;
    const first = box.querySelector('[data-ask-size]');
    if (first) first.focus();
  }
  if ($('size-ask')) {
    $('size-ask').addEventListener('click', async (e) => {
      if (e.target.id === 'size-ask' || e.target.closest('#size-ask-cancel')) { $('size-ask').hidden = true; return; }
      const b = e.target.closest('[data-ask-size]');
      if (!b) return;
      // Every colour keeps its number of pieces, all in the size picked.
      const perColour = {};
      for (const l of qtyLines()) perColour[l.color] = (perColour[l.color] || 0) + l.qty;
      if (!Object.keys(perColour).length) perColour[st.colorId] = 1;
      $('size-ask').hidden = true;
      // The design is redrawn for the new size before it is saved.
      if (b.dataset.askSize !== st.sizeId) await changeSize(b.dataset.askSize);
      st.qty = Object.fromEntries(Object.entries(perColour).map(([c, n]) => [c, { [st.sizeId]: n }]));
      st.sizePicked = true;
      renderOptions();
      refreshChrome();
      scheduleDraft();
      $('add-to-cart').click();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('size-ask').hidden) $('size-ask').hidden = true; });
  }
  $('add-to-cart').addEventListener('click', serial(async () => {
    cancelCrop();
    commit();
    canvas.discardActiveObject();
    const sides = designedSides();
    if (!sides.length) {
      toast(t('msg.addFirst'), 'error');
      return;
    }
    // Clothes: the size is asked once (never ordered silently in the first size).
    if (needsSize()) return askSize();
    // Only other colours ordered than the one on screen (e.g. white set to 0, black 3): show an ordered
    // colour, so the preview, the proof and the checks are of what will really be printed.
    const orderedColours = [...new Set(qtyLines().map((l) => l.color))];
    if (orderedColours.length && !orderedColours.includes(st.colorId) && st.product.colors.some((c) => c.id === orderedColours[0])) {
      st.colorId = orderedColours[0];
      renderOptions();
      await applyMockup();
      renderCheck();
    }
    // Name list: the fields must match the list's columns (and a list needs a field).
    if (st.mergePreview) endMergePreview();
    const mergeSides = st.product.merge ? fieldSides() : [];
    const useMerge = Boolean(st.product.merge && st.mergeList);
    if (st.product.merge) {
      if (mergeSides.length && !st.mergeList) {
        toast(t('merge.needList'), 'error');
        return;
      }
      if (useMerge && !mergeSides.length) {
        toast(t('merge.addField', { field: `{${st.mergeList.columns[0]}}` }), 'error');
        return;
      }
      if (useMerge && mergeBadVariants().length) {
        toast(plural('merge.badVariant', mergeBadVariants().length, { sizes: st.product.sizes.map((z) => tr(z.label)).join(POD.lang === 'ar' ? '، ' : ', ') }), 'error');
        return;
      }
      if (useMerge) {
        const cols = new Set(st.mergeList.columns.map((c) => c.trim()));
        const all = mergeSides.flatMap((s) => (s.id === st.side ? mergeObjects().map((o) => o.text) : (st.designs[s.id] || []).filter((o) => o && /text/i.test(o.type)).map((o) => o.text)));
        const unknown = [...new Set(all.flatMap(fieldsOf))].filter((f) => !cols.has(f));
        if (unknown.length) {
          toast(t('merge.unknownField', { field: `{${unknown[0]}}`, list: st.mergeList.columns.map((c) => `{${c}}`).join(' ') }), 'error');
          return;
        }
      }
    }
    // Pictures imported from other sites: the customer confirms the rights first.
    const imported = hasImports();
    if (imported && !(await confirmRights())) return;
    // The shop's own edit: what changed, and where it goes (asked before anything is saved).
    let shopChoice = null;
    if (st.shopEdit) {
      if (!adminToken()) return toast(t('shopEdit.signIn'), 'error');
      shopChoice = await askShopEdit();
      if (!shopChoice) return;
    }

    const prevZoom = st.zoom;
    if (st.zoom !== 1) setZoom(1);
    const wasPreview = st.preview;
    if (wasPreview) togglePreview();
    busy(true, t('busy.preparing'));
    const original = st.side;
    try {
      // 1. Render every designed side and collect print problems.
      const sidesPayload = {};
      const mergeSidesPayload = {};
      const files = {};
      const problems = [];
      const clientChecks = []; // the same checks, kept with the design for the proof and the shop
      let overlapAt = null; // print and embroidery on top of each other: not sent
      for (const s of sides) {
        await showSide(s.id);
        const issues = checkIssues();
        if (!overlapAt && issues.some((i) => i.overlap)) overlapAt = s.id;
        issues.forEach((i) => problems.push(`• ${tr(s.name)}: ${t(i.key === 'check.outside' ? 'check.outsideList' : i.key, { ...i.params, dpi: i.params.dpi, pt: i.params.pt })}`));
        clientChecks.push(...(await reportChecks(s.id, issues)));
        sidesPayload[s.id] = { editor: { version: fabric.version, objects: await inlineImages(st.designs[s.id]), ...(st.offsets[s.id] ? { offset: st.offsets[s.id] } : {}), ...(st.pattern ? { pattern: { ...st.pattern } } : {}), area: xywh(baseArea(s.id)) } };
        const withFields = useMerge && mergeSides.some((x) => x.id === s.id);
        if (withFields) {
          // The background and one picture of the names per row...
          const m = await exportMergeSide(s, (i, n) => busy(true, t('merge.preparing', { i: POD.num(i), n: POD.num(n) })));
          files[`${s.id}-merge-base.png`] = m.base;
          files[`${s.id}-merge.bin`] = m.bin;
          mergeSidesPayload[s.id] = { box: m.box };
          // ...and the usual files showing the first row (cart picture, single print).
          await mergeFonts(mergeObjects());
          const first = rowValues(0);
          mergeObjects().forEach((o) => applyRow(o, first));
        }
        try {
          // (Uploaded designs: the full-size original goes into the print, not the screen copy.)
          if (D.usePrintSources) await D.usePrintSources(canvas);
          files[`${s.id}-print.png`] = await exportPrint(s);
          // A booklet page from the customer's PDF with things added on top: those things on their own
          // (the print files put them over the PDF page itself).
          const bottom = canvas.getObjects()[0];
          if (st.product.paged && bottom && bottom.pdfSrc && canvas.getObjects().length > 1) {
            bottom.visible = false;
            try {
              files[`${s.id}-overlay.png`] = await exportPrint(s);
            } finally {
              bottom.visible = true;
            }
          }
          files[`${s.id}-preview.png`] = await exportPreview();
          files[`${s.id}-design.svg`] = new Blob([await exportSvg(s)], { type: 'image/svg+xml' });
        } finally {
          if (withFields) {
            restoreFields();
            canvas.requestRenderAll();
          }
        }
      }
      await showSide(original);
      if (overlapAt) {
        busy(false);
        if (overlapAt !== st.side) { await showSide(overlapAt); renderOptions(); refreshChrome(); }
        toast(t('check.overlapStop', { side: tr(baseSide(hostOf(overlapAt)).name) }), 'error');
        return;
      }
      if (problems.length) {
        busy(false);
        if (!confirm(t(st.revise ? 'revise.confirm' : 'check.confirm', { list: problems.join('\n') }))) return;
        busy(true, t('busy.saving'));
      }

      // 2. Save the layout, 3. upload the files, 4. let the server check and finish them.
      busy(true, t('busy.saving'));
      const created = await POD.api('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: st.product.id, color: st.colorId, size: st.sizeId, sides: sidesPayload, clientChecks: clientChecks.slice(0, 50), ...(imported ? { rightsConfirmed: true } : {}), ...(sides.some((s) => s.id === EMB) ? { method: 'embroidery' } : {}), ...(st.product.options ? { options: st.options || {} } : {}), ...(useMerge ? { merge: { columns: st.mergeList.columns, rows: st.mergeList.rows, sides: mergeSidesPayload } } : { quantities: qtyLines() }) }),
      });
      let done = 0;
      busy(true, t('busy.uploading', { n: 0, total: created.files.length }));
      await Promise.all(created.files.map(async (name) => {
        const res = await POD.putFile(`/api/designs/${created.id}/files/${encodeURIComponent(name)}`, created.uploadToken, files[name]);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('msg.requestFailed', { status: res.status }));
        busy(true, t('busy.uploading', { n: ++done, total: created.files.length }));
      }));
      busy(true, t('busy.finishing'));
      const design = await POD.api(`/api/designs/${created.id}/complete`, { method: 'POST', headers: { 'x-upload-token': created.uploadToken } });

      // The shop's own edit: to the customer to approve, or to print without asking (an owner's decision).
      if (st.shopEdit) {
        const se = st.shopEdit;
        const res = await fetch(`/api/admin/items/${encodeURIComponent(se.itemId)}/shop-edit${shopChoice.print ? '/print' : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}`, 'x-lang': POD.lang },
          body: JSON.stringify({ designId: design.id, baseDesignId: se.baseDesignId, note: shopChoice.note }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || t('msg.requestFailed', { status: res.status }));
        st.dirty = false;
        alert(t(res.status === 202 ? 'shopEdit.held' : shopChoice.print ? 'shopEdit.printed' : 'shopEdit.sent'));
        // Back to the dashboard (the tab it was opened from, if it's still there).
        if (window.opener && !window.opener.closed) window.close();
        location.href = '/admin';
        return;
      }
      // A new version of an ordered item the shop sent back for changes: it replaces the item's design.
      if (st.revise) {
        await POD.api(`/api/orders/${encodeURIComponent(st.revise.orderId)}/items/${encodeURIComponent(st.revise.itemId)}/revise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...reviseHeaders() },
          body: JSON.stringify({ designId: design.id }),
        });
        st.dirty = false;
        // Back to the order page when this browser can open it (its key, the account, or the browser it was
        // ordered from); else (an edit link from the shop) a thank-you and the shop's home page.
        const back = st.revise.key ? true : await POD.api('/api/orders/' + encodeURIComponent(st.revise.orderId)).then(() => true, () => false);
        if (back) location.href = `${POD.orderPath('order', st.revise.orderId, st.revise.key)}&revised=1`;
        else {
          alert(t('revise.sentNoPage'));
          location.href = '/';
        }
        return;
      }

      const entry = {
        designId: design.id,
        productId: design.productId,
        productName: design.productName,
        colorName: design.color.name,
        sizeLabel: design.size.label,
        sides: design.sides.map((s) => s.name),
        price: design.price,
        ...(design.copies > 1 ? { copies: design.copies } : {}),
        ...(design.quantities ? { quantities: design.quantities } : {}),
        ...(design.merge ? { merge: { count: design.merge.count } } : {}),
        previewUrl: design.previewUrl,
        addedAt: new Date().toISOString(),
      };
      const cart = POD.getCart();
      // The cart may have changed in another tab since this item was opened: replace it where it is now.
      const at = st.editingCartIndex !== null ? cart.findIndex((it) => it.designId === st.editingDesignId) : -1;
      if (at >= 0) cart[at] = entry;
      else cart.push(entry);
      // The browser refused to keep the cart (storage blocked): stay here, the message says so.
      if (POD.setCart(cart) === false) return;
      st.dirty = false;
      if (draftMode) {
        clearTimeout(draftTimer);
        await draftSaving;
        await POD.drafts.remove(st.product.id);
        try { localStorage.removeItem('pod-rescue:' + st.product.id); } catch (err) { /* private mode */ }
      }
      // (An item changed from the cart says "updated", not "added", QA 25 Nov.)
      location.href = at >= 0 ? '/cart?updated=1' : '/cart?added=1';
    } catch (e) {
      await showSide(original).catch(() => {});
      setZoom(prevZoom);
      toast(e.message, 'error');
    } finally {
      busy(false);
      canvas.requestRenderAll();
    }
  }));

  // ---------- Live preview (realistic, 3D, print colours) ----------
  $('preview-open').addEventListener('click', serial(async () => {
    cancelCrop();
    commit();
    canvas.discardActiveObject();
    const original = st.side;
    const sides = [];
    const previewSides = st.product.paged
      ? activeSides().filter((sd, k, all) => k === 0 || k === all.length - 1 || sd.id === original)
      : st.product.sides;
    // Booklets: every page as the printed page (blank ones stay paper), to flip through.
    let flip = null;
    if (st.product.paged) {
      busy(true, t('pv.loading'));
      try {
        const pages = [];
        for (const sd of activeSides()) {
          const has = sd.id === st.side ? canvas.getObjects().length : (st.designs[sd.id] || []).length;
          let img = null;
          if (has) {
            if (sd.id !== st.side) await showSide(sd.id);
            const r = rects(sd.id).trim;
            const k = 2;
            const layer = exportDesignLayer(k);
            const pg = document.createElement('canvas');
            pg.width = Math.round(r.w * k);
            pg.height = Math.round(r.h * k);
            const ctx = pg.getContext('2d');
            ctx.fillStyle = color().hex;
            ctx.fillRect(0, 0, pg.width, pg.height);
            ctx.drawImage(layer, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, pg.width, pg.height);
            img = pg.toDataURL('image/jpeg', 0.9);
          }
          pages.push({ id: sd.id, name: sd.name, img });
        }
        const a = activeSides()[0].printArea;
        // Which way it opens: its binding (Arabic on the right, English on the left).
        const bind = (st.product.options || []).find((o) => o.id === 'binding');
        flip = { pages, rtl: bind ? chosenOption(bind).id !== 'left' : POD.lang === 'ar', aspect: a.w / a.h, paper: color().hex };
      } finally {
        busy(false);
      }
    }
    for (const sd of previewSides) {
      if (sd.id !== st.side) await showSide(sd.id);
      if (st.pattern) {
        // Fabric: the product picture with the pattern repeated at its real size.
        const sc = st.product.pattern.scene;
        const f = sc.fill;
        const cm = POD.fabricCm(st.product, st.sizeId);
        const tile = patternTile(600);
        const layer = document.createElement('canvas');
        layer.width = W * 3;
        layer.height = H * 3;
        const tw = (f.w * 3 * st.pattern.tileCm) / cm[0];
        POD.drawPattern(layer.getContext('2d'), tile, { repeat: st.pattern.repeat, tw, th: tw, x: f.x * 3, y: f.y * 3, w: f.w * 3, h: f.h * 3 });
        sides.push({
          side: sd,
          rects: { trim: f, bleed: f, safe: f, u: f.w / (cm[0] / 2.54), b: 0, sf: 0 },
          design: layer,
          designScale: 3,
          hasDesign: canvas.getObjects().length > 0,
          base: POD.mockupUrl(sc, color().hex),
          overlay: sc.overlay ? POD.mockupUrl(sc, color().hex, 'overlay') : null,
          pattern: { tile, repeat: st.pattern.repeat, tileCm: st.pattern.tileCm, cm },
        });
        continue;
      }
      sides.push({
        side: sd,
        rects: rects(sd.id),
        // With the embroidery on this side drawn over the print.
        design: withGhost(exportDesignLayer(3), 3),
        // Canvas prints: the artwork that wraps round the frame, for the 3D sides.
        wrap: st.product.model && st.product.model.type === 'canvas' ? exportDesignLayer(3, rects(sd.id).bleed) : null,
        designScale: 3,
        hasDesign: canvas.getObjects().length > 0 || Boolean(ghost.el),
        base: POD.mockupUrl(sd.rtlArt && rightBound() ? { ...sd, ...sd.rtlArt } : sd, color().hex),
        hex: color().hex,
        overlay: sd.overlay ? POD.mockupUrl(sd.rtlArt && rightBound() ? { ...sd, ...sd.rtlArt } : sd, color().hex, 'overlay') : null,
      });
    }
    if (st.side !== original) await showSide(original);
    canvas.requestRenderAll();
    window.POD_PREVIEW.open({ product: st.product, color: color(), sides, startSide: hostOf(original), viewScale: POD.sizeView(st.product, st.sizeId), ...(flip ? { flip } : {}) });
  }));

  $('preview-open-m').addEventListener('click', () => $('preview-open').click());

  // Phones scroll the page to show the on-screen keyboard while typing on the
  // product and leave it scrolled afterwards, hiding the top toolbar. The
  // editor page never scrolls, so put it back whenever nothing is being typed.
  const typing = () => {
    const a = document.activeElement;
    return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable);
  };
  const phoneLayout = window.matchMedia('(max-width: 820px)');
  const unscroll = () => {
    if (!phoneLayout.matches || typing()) return;
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
    for (const el of [document.querySelector('main'), document.querySelector('.editor'), document.querySelector('.stage-wrap')]) {
      if (el && el.scrollTop) el.scrollTop = 0;
    }
  };
  window.addEventListener('scroll', () => setTimeout(unscroll, 150), { passive: true });
  document.addEventListener('focusout', () => setTimeout(unscroll, 300));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(unscroll, 300));

  $('save-draft').addEventListener('click', serial(async () => {
    commit();
    // Editing a cart item (or an ordered item to send again): saving means that, there is no separate draft.
    if (st.editingCartIndex !== null || st.revise) return $('add-to-cart').click();
    // Drafts are off here (the browser blocks site data, or a shared design): say so, keep the customer here.
    if (!draftMode) return toast(t('draft.saveOff'), 'error');
    busy(true, t('busy.saving'));
    let ok = await saveDraft({ force: true }); // (asked for: saved even when nothing was changed)
    // Signed in: wait for the copy on the account too (a few seconds at most), so it opens on the other device.
    if (ok && POD.drafts.flush) ok = (await Promise.race([POD.drafts.flush(st.product.id).then(() => true), new Promise((r) => setTimeout(() => r(true), 8000))])) && ok;
    busy(false);
    if (!ok) return toast(t('draft.saveFailed'), 'error');
    st.dirty = false;
    location.href = '/?saved=' + encodeURIComponent(st.product.id) + '#products';
  }));

  window.addEventListener('beforeunload', (e) => {
    if (draftMode && draftTimer) saveDraft();
    if (st.dirty && !draftMode) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Re-render everything the shopper reads when the language changes.
  document.addEventListener('pod:langchange', () => {
    renderOptions();
    renderPresets();
    renderShapes();
    renderStickers();
    if (templatesRendered) renderTemplates();
    refreshChrome();
    renderProps();
    renderFloatBar(); // the floating bar's labels in the new language
    canvas.requestRenderAll();
  });

  // ---------- Boot ----------
  renderOptions();
  renderPresets();
  renderShapes();
  renderStickers();
  fit();
  await D.ensureFont('Cairo', 600); // print-area label
  await showSide(st.side);
  seedHistory();
  refreshChrome();
  renderProps();
  renderCheck();
  autoFocusPrint();
  bootDone = true;
  // Report the phone's real screen measurements once (sizes only) so the
  // layout can be fitted to phones that draw pages behind system bars.
  if (MOBILE.matches) {
    setTimeout(() => {
      try {
        const probe = (css) => {
          const el = document.createElement('div');
          el.style.cssText = 'position:fixed;left:0;top:0;width:1px;visibility:hidden;' + css;
          document.body.appendChild(el);
          const v = Math.round(el.getBoundingClientRect().height);
          el.remove();
          return v;
        };
        const bottom = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().bottom) : null; };
        const vv = window.visualViewport;
        const m = {
          ih: innerHeight, iw: innerWidth, oh: outerHeight, sh: screen.height, sah: screen.availHeight, dpr: devicePixelRatio,
          vvh: vv ? Math.round(vv.height) : null, vvt: vv ? Math.round(vv.offsetTop) : null,
          dvh: probe('height:100dvh'), svh: probe('height:100svh'), lvh: probe('height:100lvh'), vh: probe('height:100vh'),
          envB: probe('height:env(safe-area-inset-bottom)'), appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h'),
          body: Math.round(document.body.getBoundingClientRect().height), tools: bottom('.tools'), foot: bottom('.panel-foot'),
          docH: document.documentElement.clientHeight,
        };
        const body = JSON.stringify(m);
        if (!navigator.sendBeacon || !navigator.sendBeacon('/api/client-layout', body)) fetch('/api/client-layout', { method: 'POST', body }).catch(() => {});
      } catch (e) { /* diagnostics only */ }
    }, 1500);
  }
  // From the product page's "Print a list of names": open the name-list section.
  if (params.get('names') === '1') setTimeout(openNames, 400);
  if (restoredDraft) {
    const lost = outsideObjects();
    if (lost.length) {
      lost.forEach(bringInside);
      commit();
      renderCheck();
    }
    draftChoice(lost.length);
  }
  if (fromShare) { toast(t('share.loaded')); scheduleDraft(); }
  /** What opens "send a new version": the order's key and/or the item's own edit link. */
  function reviseHeaders() {
    return { ...POD.orderHeaders(st.revise.key), ...(st.revise.rt ? { 'x-revise-token': st.revise.rt } : {}) };
  }
  if (st.shopEdit) {
    if ($('save-draft')) $('save-draft').hidden = true; // one way out: save the shop's edit
    const bar = document.createElement('div');
    bar.className = 'draft-bar revise-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>${esc(t(adminToken() ? 'shopEdit.bar' : 'shopEdit.signIn'))}</span>`;
    document.body.appendChild(bar);
    // (An owner prints without asking at once; anyone else asks an owner: the dialog says which.)
    if (adminToken()) {
      fetch('/api/admin/session', { headers: { Authorization: `Bearer ${adminToken()}` } }).then((r) => (r.ok ? r.json() : null)).then((me) => {
        if (me && st.shopEdit) st.shopEdit.owner = Boolean(me.emergency || (Array.isArray(me.roles) && me.roles.includes('owner')));
      }).catch(() => {});
    }
  }
  if (st.revise) {
    if ($('save-draft')) $('save-draft').hidden = true; // one way out: send the new version
    // Still waiting for a new version? (Back after sending, or the shop has moved on): if not, back to the order.
    const reviseOver = () => {
      toast(t(st.revise.key ? 'revise.done' : 'revise.doneNoPage'));
      st.dirty = false;
      setTimeout(() => { location.href = st.revise.key ? POD.orderPath('order', st.revise.orderId, st.revise.key) : '/'; }, 2500);
    };
    POD.api(`/api/orders/${encodeURIComponent(st.revise.orderId)}/items/${encodeURIComponent(st.revise.itemId)}/revise`, { headers: reviseHeaders() }).then((state) => {
      if (!state || state.status !== 'changes_requested') {
        reviseOver();
        return;
      }
      // The shop's note, kept in view while the customer makes the change.
      const last = { by: state.by };
      const note = state.note || '';
      const bar = document.createElement('div');
      bar.className = 'draft-bar revise-bar';
      bar.setAttribute('role', 'status');
      bar.innerHTML = `<span>${esc(note ? t(last.by === 'customer' ? 'revise.yourNote' : 'revise.shopNote', { note }) : t('revise.hint'))}</span><button type="button" class="fly-close" aria-label="${esc(t('draft.keep'))}">✕</button>`;
      bar.querySelector('button').addEventListener('click', () => bar.remove());
      document.body.appendChild(bar);
    }).catch((e) => {
      // An edit link already used (the new version was sent) or replaced by a newer one, or the order is gone: the
      // same "already sent" as above, not a change to make again that then can't be sent. QA 25 Nov.
      if (e && (e.status === 404 || (e.status === 403 && st.revise.rt))) reviseOver();
      else toast(t('revise.hint'));
    });
  }
  if (libraryDesign) {
    if (libraryDesign.kind === 'template') {
      await addTemplate({ id: libraryDesign.id, items: libraryDesign.items, aspect: libraryDesign.aspect });
      canvas.discardActiveObject();
    } else {
      await loadObjects(remap(libraryDesign.objects || [], libraryDesign.area || area(), area()));
      commit();
    }
    canvas.requestRenderAll();
    toast(t('design.loaded'));
    scheduleDraft();
  }
  // Opening is not changing: the customer's own saved design is kept until this one is changed.
  if (heldDraft) {
    st.dirty = false;
    heldChoice();
  }
  schedulePatternPreview(0);
  window.__editor = { canvas, st, rects, checkIssues, exportSvg, exportPrint, exportTile, exportPreview, rescueCopy }; // handy for debugging in the console
})();
