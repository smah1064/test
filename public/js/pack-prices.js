/* Pack prices: what each size of a product costs once the owner's price boxes are saved, and the bigger
 * packs that then cost less in total than a smaller pack of the same kind. The owner's own price for a
 * small pack stays fixed (1 brochure at 40) while the other packs follow the product's price, so a lower
 * product price can take 10 brochures down to 35: customers would buy the 10.
 * Shared by the server (src/accounting.js) and the admin's two price screens (Products → Prices and
 * Accounts → Prices), so all three find the same problems at the same prices.
 *
 *   savedPrices(now, built, form) -> { sizeId: EGP } what the shop charges for one of each size (one printed
 *     side, no extras) once `form` is saved, as src/accounting.js cleanPricing + applyPricing work it out:
 *       now:   the product as it stands { basePrice, sizes: [{ id, surcharge, smallPack, ownPrice }] }
 *       built: its built-in prices { basePrice, sizes: { sizeId: surcharge } }
 *       form:  the boxes as sent to the server { basePrice, sizes: { sizeId: amount added to the price } };
 *              an empty or missing box goes back to the built-in price, as on the server.
 *   cheaperBiggerPacks(sizes, prices) -> [{ bigger: { id, label, price }, smaller: { id, label, price } }]
 *   withOwnPrices(now, built) -> `now` with each small pack's ownPrice filled in where it isn't given
 *   packOf(sizeId) -> { kind, count } | null
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POD_PACKS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const same = (a, b) => Math.abs(a - b) < 0.005;
  /** A box as the server reads it: null when empty, else the amount (rounded to piastres). */
  const amount = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : round2(v));

  /**
   * A small pack's amount on top of product price `base` when it follows that price: its share of the
   * price as written, in whole pounds and never under 1 EGP (packSurcharge in src/accounting.js).
   */
  function shareOf(built, id, base) {
    const written = Number(built.sizes && built.sizes[id]) || 0;
    if (base === built.basePrice || !(built.basePrice > 0)) return written;
    return round2(Math.max(1, Math.round((base * (built.basePrice + written)) / built.basePrice)) - base);
  }
  /** What a small pack that follows the product's price adds to `base` (never under 1 EGP in all). */
  const following = (built, id, base) => Math.max(shareOf(built, id, base), round2(1 - base));

  function savedPrices(now, built, form = {}) {
    built = built && built.basePrice > 0 ? built : { basePrice: now.basePrice, sizes: Object.fromEntries(now.sizes.map((z) => [z.id, z.surcharge || 0])) };
    const typedBase = amount(form.basePrice);
    const base = typedBase === null ? built.basePrice : typedBase;
    const sizes = form.sizes || {};
    const out = {};
    for (const z of now.sizes) {
      const shown = Number(z.surcharge) || 0;
      const v = amount(sizes[z.id]);
      let add;
      if (!z.smallPack) add = v === null ? Number(built.sizes && built.sizes[z.id]) || 0 : v;
      else if (v === null) add = following(built, z.id, base);
      else if (same(v, shown)) {
        // Left as shown: the owner's own price for the pack stays that price, and a pack that follows
        // the product's price keeps following it.
        add = z.ownPrice ? round2(Math.max(1, round2(now.basePrice + shown)) - base) : following(built, z.id, base);
      } else if (same(v, shareOf(built, z.id, base))) add = following(built, z.id, base);
      else add = v; // the pack's own price from now on: the price typed plus the amount (refused under 1 EGP)
      out[z.id] = round2(base + add);
    }
    return out;
  }

  /**
   * The product with each small pack's `ownPrice` filled in where it isn't given (rows of Accounts → Prices
   * don't carry it): a small pack whose amount isn't its share of the product's price has a price of its
   * own. (One whose own price is exactly that share today reads as following the price.)
   */
  function withOwnPrices(now, built) {
    const b = built && built.basePrice > 0 ? built : null;
    return {
      ...now,
      sizes: now.sizes.map((z) => (!z.smallPack || typeof z.ownPrice === 'boolean' ? z
        : { ...z, ownPrice: Boolean(b) && !same(Number(z.surcharge) || 0, following(b, z.id, now.basePrice)) })),
    };
  }

  /** A pack size's kind and count from its id: '10' → 10, 'A4-10' → 10 of A4, '16-25' → 25 of 16 pages. */
  function packOf(id) {
    const m = /^(?:(.+)-)?(\d+)$/.exec(String(id));
    return m ? { kind: m[1] || '', count: Number(m[2]) } : null;
  }

  /**
   * Each bigger pack that costs less in total than a smaller pack of the same kind (10 brochures under
   * 1 brochure, A4 × 25 under A4 × 10, 16 pages × 25 copies under 16 pages × 10), for products sold in
   * packs with small packs (1, 10, 25 copies…: the packs whose price can stay put or follow the product's
   * price by its share). Sizes that are off are left out (customers can't pick them). `prices` is each
   * size's final price; the list goes by the smaller pack, in the product's order.
   */
  function cheaperBiggerPacks(sizes, prices) {
    if (!sizes.some((z) => z.smallPack)) return [];
    const packs = sizes
      .filter((z) => !z.off && prices[z.id] != null && Number.isFinite(Number(prices[z.id])))
      .map((z) => ({ id: z.id, label: z.label, price: Number(prices[z.id]), pack: packOf(z.id) }))
      .filter((x) => x.pack);
    const out = [];
    for (const small of packs) {
      for (const big of packs) {
        if (big.pack.kind !== small.pack.kind || big.pack.count <= small.pack.count) continue;
        if (big.price < small.price && !same(big.price, small.price)) {
          out.push({ bigger: { id: big.id, label: big.label, price: big.price }, smaller: { id: small.id, label: small.label, price: small.price } });
        }
      }
    }
    return out;
  }

  return { savedPrices, withOwnPrices, cheaperBiggerPacks, packOf };
});
