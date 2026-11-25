/* Strings for after the purchase: order tracking, reorder, invoices, drafts in the account.
 * Loaded right after /js/i18n.js. Also holds the small reorder helper the order
 * page and the account page share (it only uses POD when called). */
(function () {
  'use strict';
  const S = window.POD_STRINGS || (window.POD_STRINGS = {});
  Object.assign(S, {
    // An order opened without its key (its number alone): where the customer finds its link.
    'order.linkNeededTitle': ['Open your order from its link', 'افتح طلبك من اللينك بتاعه'],
    'order.toAccount': ['My account', 'حسابي'],
    // The order page as the team sees it (from the dashboard, a link that works for 30 minutes).
    'team.banner': ['Team view: this order page as the customer sees it. Their buttons are switched off here.', 'عرض الفريق: صفحة الطلب دي زي ما العميل شايفها. الزراير بتاعته مقفولة هنا.'],
    'team.noAmounts': ['Amounts are hidden for your role.', 'المبالغ مخفية للدور بتاعك.'],
    'team.until': ['This link works until {time}.', 'اللينك ده شغال لحد {time}.'],
    'team.copyCustomer': ["Copy the customer's link", 'انسخ لينك العميل'],
    'team.customerCopied': ["Customer's link copied: send it to the customer only.", 'لينك العميل اتنسخ: ابعته للعميل بس.'],
    'team.overTitle': ['This team link has ended', 'لينك الفريق ده خلص'],
    'team.toAdmin': ['Open the dashboard', 'افتح لوحة الإدارة'],
    // Account: a password-reset link opened while already signed in
    'acct.resetKeep': ['Cancel and go to my account', 'إلغاء والرجوع لحسابي'],
    // Tracking timeline
    'track.title': ['Tracking', 'تتبّع الطلب'],
    'track.placed': ['Order placed', 'تم الطلب'],
    'track.production': ['In production', 'قيد التنفيذ'],
    'track.printed': ['Printed', 'تمت الطباعة'],
    'track.shipped': ['Shipped', 'تم الشحن'],
    'track.delivered': ['Delivered', 'تم التوصيل'],
    'track.placed.hint': ["We've got your order. Printing starts soon.", 'استلمنا طلبك، والطباعة هتبدأ قريب.'],
    'track.production.hint': ['Your items are being printed one by one.', 'منتجاتك بتتطبع واحدة واحدة.'],
    'track.printed.hint': ["Everything is printed. We're packing it for the courier.", 'كل حاجة اتطبعت، وبنغلّفها للمندوب.'],
    'track.shipped.hint': ['Your order is on its way to you.', 'طلبك في الطريق ليك.'],
    'track.delivered.hint': ['Delivered. Enjoy it!', 'وصلك الطلب. بالهنا!'],
    'track.now': ['Now', 'دلوقتي'],
    'track.pending': ['Not yet', 'لسه'],
    'track.expected': ['Expected {date}', 'متوقع {date}'],
    // "Now:" while items wait for a check or an approval (instead of "printing starts soon")
    'track.now.awaitingOne': ['One item is waiting for you to approve its proof. We print it as soon as you approve.', 'في منتج مستني موافقتك على البروفة بتاعته. هنطبعه أول ما توافق.'],
    'track.now.awaitingMany': ['{n} items are waiting for you to approve their proofs. We print each one as soon as you approve.', 'عدد المنتجات المستنية موافقتك على البروفة: {n}. هنطبع كل واحد أول ما توافق.'],
    'track.now.changes': ['A change is needed: see the item below. Edit it yourself and send it again, or leave it to us and we’ll send you a new proof.', 'محتاجين تعديل: شوف القطعة تحت. عدّلها بنفسك وابعتها تاني، أو سيبها علينا وهنبعتلك بروفة جديدة.'],
    'track.now.review': ['Our team is checking your design before printing. We will contact you if anything needs changing.', 'فريقنا بيراجع التصميم قبل الطباعة، وهنكلمك لو فيه حاجة محتاجة تتغير.'],
    // After ordering: the way back to the order
    'order.placedTitle': ['Thank you! Your order is placed.', 'شكرًا! طلبك اتسجّل.'],
    'order.keepLink': ['This page’s link is how you follow your order, so keep it. We also saved it on this device (on the Account page).', 'رابط الصفحة دي هو طريقك لمتابعة الطلب، فاحتفظ بيه. وحفظناه كمان على الجهاز ده (في صفحة الحساب).'],
    'order.sendWa': ['Send the order link to my WhatsApp', 'ابعت رابط الطلب على واتسابي'],
    'order.copyLink': ['Copy link', 'انسخ الرابط'],
    'order.linkCopied': ['Link copied ✓', 'اتنسخ الرابط ✓'],
    'order.linkCopyFailed': ["Couldn't copy. Copy the address from the browser bar.", 'معرفناش ننسخ. انسخ الرابط من شريط العنوان.'],
    'order.waSelf': ['My order {n} at ebda3: {link}', 'طلبي رقم {n} من إبداع: {link}'],
    'order.emailWhy': ['If you gave your email, order updates and any proof we need you to approve come there too.', 'لو كتبت إيميلك، هيوصلك عليه كمان تحديثات الطلب وأي بروفة محتاجين موافقتك عليها.'],
    // Orders placed on this phone / computer (kept in the browser, no account needed)
    'device.title': ['Orders on this device', 'طلبات من الجهاز ده'],
    'device.note': ['Orders placed from this phone or computer, so you can find them again without an account.', 'الطلبات اللي اتعملت من الموبايل أو الكمبيوتر ده، علشان ترجعلها من غير حساب.'],
    // Shipment
    'track.shipment': ['Delivery', 'الشحن'],
    'track.courier': ['Courier', 'شركة الشحن'],
    'track.number': ['Tracking number', 'رقم التتبّع'],
    'track.copy': ['Copy', 'نسخ'],
    'track.copied': ['Tracking number copied ✓', 'رقم التتبّع اتنسخ ✓'],
    'track.copyFailed': ["Couldn't copy. Select the number and copy it.", 'معرفناش ننسخ. حدّد الرقم وانسخه.'],
    'track.link': ['Track with the courier', 'تابع مع شركة الشحن'],
    'track.eta': ['Expected delivery', 'التوصيل المتوقع'],
    'track.deliveredOn': ['Delivered on', 'اتسلّم يوم'],
    'track.shippedOn': ['Shipped on', 'اتشحن يوم'],
    // Actions
    'track.invoice': ['Invoice', 'الفاتورة'],
    'track.reorder': ['Order again', 'اطلبه تاني'],
    'track.reordering': ['Adding to cart…', 'بنضيفه للسلة…'],
    'track.track': ['Track', 'تتبّع'],
    // Only some items again: a button on each item, and a list to tick when the order has several.
    'track.reorderItem': ['Order this again', 'اطلب ده تاني'],
    'track.reorderPick': ['Which items do you want again?', 'عايز أنهي منتجات تاني؟'],
    'track.reorderAdd': ['Add to cart ({n})', 'ضيف للسلة ({n})'],
    'track.reorderPickNone': ['Tick at least one item.', 'اختار منتج واحد على الأقل.'],
    'track.reorderCancel': ['Cancel', 'إلغاء'],
    'track.reorderNote': ["Same designs, today's prices.", 'نفس التصميمات، بأسعار النهارده.'],
    'track.goCart': ['Go to cart', 'روح للسلة'],
    // Counted: POD.plural('track.reorderPartial', n); the plain key reads right for any number.
    'track.reorderPartial': ['Items added to your cart: {n}. Some could not be added:', 'عدد المنتجات اللي اتضافت للسلة: {n}. وفي حاجات معرفناش نضيفها:'],
    'track.reorderPartial.one': ['1 item added to your cart. Some could not be added:', 'اتضاف للسلة منتج واحد. وفي حاجات معرفناش نضيفها:'],
    'track.reorderPartial.two': ['2 items added to your cart. Some could not be added:', 'اتضاف للسلة منتجين. وفي حاجات معرفناش نضيفها:'],
    'track.reorderPartial.few': ['{n} items added to your cart. Some could not be added:', 'اتضاف للسلة {n} منتجات. وفي حاجات معرفناش نضيفها:'],
    'track.reorderPartial.many': ['{n} items added to your cart. Some could not be added:', 'اتضاف للسلة {n} منتج. وفي حاجات معرفناش نضيفها:'],
    'track.reorderNone': ['None of these items can be ordered again:', 'مفيش ولا منتج من دول ينفع يتطلب تاني:'],
    'track.skip.productGone': ['{n}. {name}: no longer sold', '{n}. {name}: مبقاش متاح للبيع'],
    // Only books lose their photo (the child's photo): 30 days after the book was shipped (src/app.js, cleanup).
    'track.skip.photoGone': ["{n}. {name}: the child's photo was deleted (we keep it only until 30 days after shipping)", '{n}. {name}: صورة الطفل اتمسحت (بنحتفظ بيها لحد 30 يوم بعد الشحن بس)'],
    'track.skip.filesGone': ['{n}. {name}: the design files are no longer kept', '{n}. {name}: ملفات التصميم مبقتش محفوظة'],
    'track.skip.other': ['{n}. {name}: cannot be ordered again', '{n}. {name}: مينفعش يتطلب تاني'],
    // Account: orders and drafts
    'acct.drafts': ['My saved designs', 'تصميماتي المحفوظة'],
    'acct.draftsNote': ['Designs you started while signed in are saved to your account, so you can finish them on any phone or computer.', 'التصميمات اللي بدأتها وانت مسجّل دخول بتتحفظ في حسابك، فتقدر تكمّلها من أي موبايل أو كمبيوتر.'],
    'acct.noDrafts': ['No drafts yet', 'لسه مفيش مسودات'],
    'acct.noDraftsText': ['Designs you start while signed in are saved to your account automatically, so you can open them on any phone or computer and carry on.', 'أي تصميم تبدأه وانت مسجّل دخول بيتحفظ في حسابك لوحده، فتقدر تفتحه من أي موبايل أو كمبيوتر وتكمّل.'],
    'acct.draftSaved': ['Last saved {date}', 'آخر حفظ {date}'],
    'acct.continue': ['Continue designing', 'كمّل التصميم'],
    'acct.deleteDraft': ['Delete', 'مسح'],
    'acct.deleteDraftConfirm': ['Delete your draft for {name}? This cannot be undone.', 'تمسح مسودة {name}؟ مش هتقدر ترجّعها.'],
    'acct.draftDeleted': ['Draft deleted', 'اتمسحت المسودة'],
    // One design in several sizes / colours / quantities
    'qty.pieces': ['{n} pieces', '{n} قطعة'],
    'qty.piecesFew': ['{n} pieces', '{n} قطع'],
    'qty.piece': ['1 piece', 'قطعة واحدة'],
    'qty.each': ['{price} each', '{price} للقطعة'],
    'qty.breakdown': ['Sizes and colours', 'المقاسات والألوان'],
  });
  // Shared keys the main strings file may already have: only fill them in when missing.
  const fallback = {
    'order.delivered': ['Delivered', 'تم التوصيل'],
    'item.delivered': ['Delivered', 'تم التوصيل'],
  };
  for (const k of Object.keys(fallback)) if (!S[k]) S[k] = fallback[k];

  // Orders placed from this browser: [{ number, link, date, total }], newest first, at most 10.
  // The link carries the order's key (orders placed since the keys came in): the guest's way back to it.
  const DEVICE_KEY = 'pod-my-orders';
  const DEVICE_MAX = 10;
  const LINK_RE = /^\/order\?id=[\w-]+(&k=[A-Za-z0-9_-]{16,64})?$/;
  function deviceOrders() {
    try {
      const list = JSON.parse(localStorage.getItem(DEVICE_KEY) || '[]');
      return Array.isArray(list) ? list.filter((o) => o && typeof o.number === 'string' && typeof o.link === 'string' && LINK_RE.test(o.link)).slice(0, DEVICE_MAX) : [];
    } catch (e) {
      return [];
    }
  }

  /** Order again: the server copies every item; they go to the end of the cart. */
  window.PODAftercare = {
    /** Remember a placed order on this device (a guest's way back to it). Never throws. */
    rememberOrder(order) {
      try {
        if (!order || !order.id || !order.number) return;
        // Placed from an account: it is on the account (and the next person on a shared phone must not see it here).
        // The order says whose it is (`account`): an account whose session quietly expired ordered as a guest,
        // so that order is kept here. Older answers without the field: the signed-in marker decides.
        if (order.account === true) return;
        if (order.account !== false) {
          const acct = localStorage.getItem('pod-acct');
          if (acct && acct !== '1') return;
        }
        // (Its key in the link: the guest's way back to it. Built here: this runs before POD is needed.)
        const link = '/order?id=' + encodeURIComponent(order.id) + (typeof order.key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(order.key) ? '&k=' + order.key : '');
        if (!LINK_RE.test(link)) return;
        const entry = { number: String(order.number), link, date: order.createdAt || new Date().toISOString(), total: Number(order.total) || 0 };
        const same = (l) => l === link || l.split('&')[0] === link.split('&')[0];
        const list = [entry, ...deviceOrders().filter((o) => !same(o.link))].slice(0, DEVICE_MAX);
        localStorage.setItem(DEVICE_KEY, JSON.stringify(list));
      } catch (e) { /* private mode, storage full */ }
    },
    deviceOrders,
    /** "Orders on this device" as a card ('' when there are none). */
    deviceOrdersHtml() {
      const list = deviceOrders();
      if (!list.length) return '';
      const { t, esc, money } = window.POD;
      const when = (d) => { try { return window.POD.date(d); } catch (e) { return ''; } };
      return `
        <section class="card device-orders" aria-labelledby="device-orders-h">
          <h2 id="device-orders-h">${esc(t('device.title'))}</h2>
          <p class="muted small">${esc(t('device.note'))}</p>
          <ul>${list.map((o) => `
            <li><a href="${esc(o.link)}"><strong>${esc(t('order.title', { n: o.number }))}</strong></a>
              <span class="muted small">${esc(when(o.date))}${o.total ? `${window.POD.lang === 'ar' ? '، ' : ' · '}${esc(money(o.total))}` : ''}</span></li>`).join('')}
          </ul>
        </section>`;
    },
    /** Copies the order's items (or only `itemIds`) into the cart, at today's prices (`key`: the order's key). */
    async reorder(orderId, itemIds, key) {
      const r = await window.POD.api(`/api/orders/${encodeURIComponent(orderId)}/reorder`, {
        method: 'POST',
        headers: { ...(typeof key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(key) ? { 'x-order-key': key } : {}), ...(Array.isArray(itemIds) ? { 'Content-Type': 'application/json' } : {}) },
        ...(Array.isArray(itemIds) ? { body: JSON.stringify({ items: itemIds }) } : {}),
      });
      const items = (r && Array.isArray(r.items)) ? r.items : [];
      if (items.length) window.POD.setCart(window.POD.getCart().concat(items));
      return { added: items.length, skipped: (r && Array.isArray(r.skipped)) ? r.skipped : [] };
    },
    /**
     * An item's quantities grouped by colour: [{ color, lines: [{ size, qty, unitPrice }] }],
     * or null for a single piece / an older order without the field.
     */
    qtyGroups(item) {
      const q = item && Array.isArray(item.quantities) ? item.quantities.filter((l) => l && Number(l.qty) > 0) : [];
      if (!q.length) return null;
      const groups = new Map();
      for (const l of q) {
        const key = (l.color && (l.color.id || l.color.hex || JSON.stringify(l.color.name))) || '';
        if (!groups.has(key)) groups.set(key, { color: l.color || null, lines: [] });
        groups.get(key).lines.push(l);
      }
      return [...groups.values()];
    },
    /** Total pieces of an item (1 when nothing says otherwise). */
    /** "1 piece", "6 قطع", "12 قطعة" (Arabic: 3–10 take the plural). */
    piecesText(n) {
      const { t, num } = window.POD;
      const k = n % 100;
      return n === 1 ? t('qty.piece') : t(k >= 3 && k <= 10 ? 'qty.piecesFew' : 'qty.pieces', { n: num(n) });
    },
    pieces(item) {
      const groups = this.qtyGroups(item);
      const sum = groups ? groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + Number(l.qty), 0), 0) : 1;
      return Number(item.copies) > 0 ? Number(item.copies) : sum;
    },
    /** Is this item a name list (each row one piece with its own name/number)? */
    isNameList(item) {
      return Boolean(item.merge) || (!this.qtyGroups(item) && Number(item.copies) > 1);
    },
    /** Show the size/colour breakdown? Not for one plain piece, nor a name list all in one size. */
    showBreakdown(item) {
      const g = this.qtyGroups(item);
      if (!g) return false;
      if (this.isNameList(item)) return g.length > 1 || g[0].lines.length > 1;
      return true;
    },
    /** "Black: S×2 · M×5" per colour, then "12 pieces" (not for name lists: they keep their "N names" badge). */
    qtyHtml(item, { inline = false } = {}) {
      const { t, tr, num, esc } = window.POD;
      const groups = this.qtyGroups(item);
      if (!groups) return '';
      const sizes = (g) => g.lines.map((l) => {
        const label = l.size ? tr(l.size.label) : '';
        return `<span class="qty-size" dir="ltr">${label ? `<bdi>${esc(label)}</bdi>` : ''}<span class="qty-x">×${esc(num(l.qty))}</span></span>`;
      }).join(`<span class="qty-sep">${window.POD.lang === 'ar' ? '، ' : ' · '}</span>`); // (in Arabic "·" next to ١٢٣ looks like ٠)
      const rows = groups.map((g) => {
        const hex = g.color && /^#[0-9a-f]{3,8}$/i.test(g.color.hex || '') ? g.color.hex : null;
        const name = g.color ? tr(g.color.name) : '';
        return `<span class="qty-row">${hex ? `<span class="qty-dot" style="background:${hex}"></span>` : ''}${name ? `<span class="qty-color">${esc(name)}:</span> ` : ''}<span class="qty-sizes">${sizes(g)}</span></span>`;
      }).join('');
      const n = this.pieces(item);
      // Packs (100 cards × 2 + 1000 cards): the copies, never "3 pieces" (QA 25 Nov).
      const copies = window.POD.packCopies ? window.POD.packCopies(item.quantities) : null;
      const total = this.isNameList(item) ? '' : `<span class="qty-total">${esc(copies != null ? window.POD.plural('qty.copies', copies) : this.piecesText(n))}</span>`;
      return `<div class="qty-break${inline ? ' qty-inline' : ''}" aria-label="${esc(t('qty.breakdown'))}">${rows}${total}</div>`;
    },
    /** The same as plain text (WhatsApp messages): "Black: S×2, M×5 / White: M×2". */
    qtyText(item) {
      const { tr, num } = window.POD;
      const groups = this.qtyGroups(item);
      if (!groups) return '';
      return groups.map((g) => `${g.color ? tr(g.color.name) + ': ' : ''}${g.lines.map((l) => `${l.size ? tr(l.size.label) : ''}×${num(l.qty)}`).join(', ')}`).join(' / ');
    },
    /** One line per item that could not be copied, in the shopper's language. */
    skippedLines(skipped) {
      const { t, tr, num } = window.POD;
      return skipped.map((s, i) => {
        const key = S['track.skip.' + s.reason] ? 'track.skip.' + s.reason : 'track.skip.other';
        return t(key, { n: num(s.position || i + 1), name: tr(s.productName) });
      });
    },
  };
})();
