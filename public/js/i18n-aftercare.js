/* Strings for after the purchase: order tracking, reorder, invoices, drafts in the account.
 * Loaded right after /js/i18n.js. Also holds the small reorder helper the order
 * page and the account page share (it only uses POD when called). */
(function () {
  'use strict';
  const S = window.POD_STRINGS || (window.POD_STRINGS = {});
  Object.assign(S, {
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
    // Shipment
    'track.shipment': ['Delivery', 'الشحن'],
    'track.courier': ['Courier', 'شركة الشحن'],
    'track.number': ['Tracking number', 'رقم التتبّع'],
    'track.copy': ['Copy', 'نسخ'],
    'track.copied': ['Tracking number copied ✓', 'تم نسخ رقم التتبّع ✓'],
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
    'track.reorderNote': ["Same designs, today's prices.", 'نفس التصميمات، بأسعار النهارده.'],
    'track.goCart': ['Go to cart', 'روح للسلة'],
    'track.reorderPartial': ['{n} item(s) added to your cart. Some could not be added:', 'اتضاف للسلة {n} منتج. وفي حاجات معرفناش نضيفها:'],
    'track.reorderNone': ['None of these items can be ordered again:', 'مفيش ولا منتج من دول ينفع يتطلب تاني:'],
    'track.skip.productGone': ['{n}. {name}: no longer sold', '{n}. {name}: مبقاش متاح للبيع'],
    'track.skip.photoGone': ['{n}. {name}: the photos were deleted (we keep them 7 days)', '{n}. {name}: الصور اتمسحت (بنحتفظ بيها 7 أيام بس)'],
    'track.skip.filesGone': ['{n}. {name}: the design files are no longer kept', '{n}. {name}: ملفات التصميم مبقتش محفوظة'],
    'track.skip.other': ['{n}. {name}: cannot be ordered again', '{n}. {name}: مينفعش يتطلب تاني'],
    // Account: orders and drafts
    'acct.drafts': ['My drafts', 'مسوداتي'],
    'acct.draftsNote': ['Designs you started while signed in are saved to your account, so you can finish them on any phone or computer.', 'التصميمات اللي بدأتها وانت مسجّل دخول بتتحفظ في حسابك، فتقدر تكمّلها من أي موبايل أو كمبيوتر.'],
    'acct.noDrafts': ['No drafts yet', 'لسه مفيش مسودات'],
    'acct.noDraftsText': ['Designs you start while signed in are saved to your account automatically, so you can open them on any phone or computer and carry on.', 'أي تصميم تبدأه وانت مسجّل دخول بيتحفظ في حسابك لوحده، فتقدر تفتحه من أي موبايل أو كمبيوتر وتكمّل.'],
    'acct.draftSaved': ['Last saved {date}', 'آخر حفظ {date}'],
    'acct.continue': ['Continue designing', 'كمّل التصميم'],
    'acct.deleteDraft': ['Delete', 'مسح'],
    'acct.deleteDraftConfirm': ['Delete your draft for {name}? This cannot be undone.', 'تمسح مسودة {name}؟ مش هتقدر ترجّعها.'],
    'acct.draftDeleted': ['Draft deleted', 'اتمسحت المسودة'],
  });
  // Shared keys the main strings file may already have: only fill them in when missing.
  const fallback = {
    'order.delivered': ['Delivered', 'تم التوصيل'],
    'item.delivered': ['Delivered', 'تم التوصيل'],
  };
  for (const k of Object.keys(fallback)) if (!S[k]) S[k] = fallback[k];

  /** Order again: the server copies every item; they go to the end of the cart. */
  window.PODAftercare = {
    async reorder(orderId) {
      const r = await window.POD.api(`/api/orders/${encodeURIComponent(orderId)}/reorder`, { method: 'POST' });
      const items = (r && Array.isArray(r.items)) ? r.items : [];
      if (items.length) window.POD.setCart(window.POD.getCart().concat(items));
      return { added: items.length, skipped: (r && Array.isArray(r.skipped)) ? r.skipped : [] };
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
