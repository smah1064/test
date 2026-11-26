'use strict';

/**
 * Coupon codes (vouchers), made by the shop owner in the admin and typed by
 * customers at checkout.
 *
 *  - percent: a percentage off the items it applies to (optionally capped)
 *  - fixed:   an amount off those items (never more than they cost)
 *  - freeship: free shipping
 * Discounts are whole pounds (see discountOf), so cash on delivery never needs piastres.
 * Conditions: active, start and end dates (Cairo days), minimum order (items
 * total), total number of uses, uses per customer (by mobile number), and
 * which products or categories it applies to (all when none chosen).
 * Uses are counted from the orders themselves, under the store lock when an
 * order is placed, so two copies of the app can't go over a limit.
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const TYPES = ['percent', 'fixed', 'freeship'];
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.SHOP_TIMEZONE || 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => DAY_FMT.format(new Date());
/**
 * A code as stored: capitals, no spaces. Typed however the phone types it, it is the same code:
 * Arabic-Indic (٠-٩) and Persian (۰-۹) digits, as Arabic phone keyboards type them, and full-width
 * letters and digits ("ＥＩＤ２０") count as the English ones, and invisible direction marks (pasted
 * from a chat) are left out. "eid٢٠" and " E I D ２ ０ " are "EID20".
 */
const normCode = (c) => String(c == null ? '' : c)
  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
  .trim().toUpperCase().replace(/\s+/g, '');
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Checks a coupon from the admin form; returns { coupon } or { error }. */
function cleanCoupon(body, { products, categories, saved = null }) {
  const b = body && typeof body === 'object' ? body : {};
  const code = normCode(b.code);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return { error: 'couponCodeBad' };
  const type = TYPES.includes(b.type) ? b.type : null;
  if (!type) return { error: 'couponTypeBad' };
  const num = (v, { min = 0, max = 1e7 } = {}) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? round2(n) : undefined;
  };
  const value = type === 'freeship' ? 0 : num(b.value, { max: type === 'percent' ? 100 : 1e7 });
  // Discounts are whole pounds (see discountOf): an amount off or a cap under 1 EGP would take nothing off.
  if (type === 'fixed' && value != null && value < 1) return { error: 'couponFixedMin' };
  // (An amount off is whole pounds, as every discount is: 7.5 took 8 off. QA 25 Nov.)
  // (A coupon saved with such an amount before the rule keeps it while other things change, e.g. pausing it. QA 26 Nov.)
  const keptAmount = saved && saved.type === 'fixed' && type === 'fixed' && Number(saved.value) === value;
  if (type === 'fixed' && value != null && !Number.isInteger(value) && !keptAmount) return { error: 'couponFixedWhole' };
  if (value === null || value === undefined || (type === 'percent' && value < 0.01)) return { error: 'couponValueBad' };
  const maxDiscount = num(b.maxDiscount);
  if (maxDiscount != null && maxDiscount < 1) return { error: 'couponMaxMin' };
  const minOrder = num(b.minOrder);
  const maxUses = num(b.maxUses, { min: 1, max: 1e6 });
  const perCustomer = num(b.perCustomer, { min: 1, max: 1000 });
  if ([maxDiscount, minOrder, maxUses, perCustomer].includes(undefined)) return { error: 'couponValueBad' };
  const startsOn = b.startsOn ? String(b.startsOn) : '';
  const endsOn = b.endsOn ? String(b.endsOn) : '';
  if ((startsOn && !isDay(startsOn)) || (endsOn && !isDay(endsOn)) || (startsOn && endsOn && endsOn < startsOn)) return { error: 'couponDatesBad' };
  const prodIds = new Set(products.map((p) => p.id));
  const catIds = new Set(categories.map((c) => c.id));
  const onlyProducts = (Array.isArray(b.products) ? b.products : []).map(String).filter((id) => prodIds.has(id)).slice(0, 100);
  const onlyCategories = (Array.isArray(b.categories) ? b.categories : []).map(String).filter((id) => catIds.has(id)).slice(0, 20);
  return {
    coupon: {
      code, type, value,
      ...(maxDiscount ? { maxDiscount } : {}),
      ...(minOrder ? { minOrder } : {}),
      ...(maxUses ? { maxUses: Math.round(maxUses) } : {}),
      ...(perCustomer ? { perCustomer: Math.round(perCustomer) } : {}),
      ...(startsOn ? { startsOn } : {}),
      ...(endsOn ? { endsOn } : {}),
      products: onlyProducts,
      categories: onlyCategories,
      active: b.active !== false,
      note: String(b.note || '').trim().slice(0, 200),
    },
  };
}

// An order used this coupon: matched by the coupon's id (so renaming a used
// code keeps its count), or by code for orders saved before ids were kept.
const usedOn = (o, coupon) => Boolean(o.coupon) && (o.coupon.id ? o.coupon.id === coupon.id : o.coupon.code === coupon.code);
const usesOf = (orders, coupon) => orders.filter((o) => usedOn(o, coupon)).length;
const usesBy = (orders, coupon, phone) => orders.filter((o) => usedOn(o, coupon) && o.customer && o.customer.phone === phone).length;

/**
 * What a coupon takes off this cart. `lines` = [{ productId, category, price }].
 * Returns { ok: true, discount, freeShipping, eligible, lines } or { ok: false, reason, params }.
 * A coupon that takes nothing off this cart is refused rather than applied (so an order never uses
 * it up for nothing): a discount that rounds to 0 pounds (1% of a 30 EGP cart), or free shipping
 * when `shipping` (the cart's shipping before any coupon, when the caller gives it) is already 0.
 */
function apply(coupon, { lines, orders = [], phone = null, shipping = null }) {
  if (!coupon || !coupon.active) return { ok: false, reason: 'couponNotFound' };
  const day = today();
  if (coupon.startsOn && day < coupon.startsOn) return { ok: false, reason: 'couponNotYet', params: { date: coupon.startsOn } };
  if (coupon.endsOn && day > coupon.endsOn) return { ok: false, reason: 'couponExpired' };
  if (coupon.maxUses && usesOf(orders, coupon) >= coupon.maxUses) return { ok: false, reason: 'couponUsedUp' };
  if (phone && coupon.perCustomer && usesBy(orders, coupon, phone) >= coupon.perCustomer) return { ok: false, reason: 'couponUsedByYou' };
  const subtotal = round2(lines.reduce((n, l) => n + l.price, 0));
  const limited = coupon.products.length || coupon.categories.length;
  const fits = lines.map((l) => !limited || coupon.products.includes(l.productId) || coupon.categories.includes(l.category));
  const eligible = round2(lines.filter((l, i) => fits[i]).reduce((n, l) => n + l.price, 0));
  // Limited to some products: the cart must have one of them (free shipping too). Said before the minimum, so a cart
  // without them isn't first sent to spend more on things the coupon doesn't cover (QA 26 Nov).
  if (!eligible && (coupon.type !== 'freeship' || limited)) return { ok: false, reason: 'couponNoItems' };
  if (coupon.minOrder && subtotal < coupon.minOrder) return { ok: false, reason: 'couponMinOrder', params: { amount: coupon.minOrder } };
  // Which lines the discount came off (by index), so reports can charge it to those products only.
  const lineIdx = fits.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  const freeShipping = coupon.type === 'freeship';
  const discount = discountOf(coupon, eligible);
  // Free shipping takes the shipping off, not the items (its discount is 0).
  if (!freeShipping && !(discount > 0)) return { ok: false, reason: 'couponNoDiscount' };
  if (freeShipping && typeof shipping === 'number' && !(shipping > 0)) return { ok: false, reason: 'couponShipFree' };
  return { ok: true, discount, freeShipping, eligible, lines: lineIdx };
}

/**
 * The discount in whole pounds, so the total the courier collects in cash has no piastres
 * (10% off a 35 EGP bookmark is 4 EGP, not 3.50). Rounded to the nearest pound, never more than
 * the items it comes off, the coupon's cap (12.5 caps at 12) or below 0. The cart's quote, the
 * order and so the accounts (which keep the order's discount) all take it from here.
 */
function discountOf(coupon, eligible) {
  let raw = 0;
  if (coupon.type === 'percent') raw = (eligible * coupon.value) / 100;
  if (coupon.type === 'fixed') raw = coupon.value;
  if (coupon.maxDiscount) raw = Math.min(raw, coupon.maxDiscount);
  // To piastres first, so float noise (x.4999…) never turns a half pound down.
  let discount = Math.round(round2(raw));
  if (coupon.maxDiscount && discount > coupon.maxDiscount) discount = Math.floor(coupon.maxDiscount);
  return round2(Math.max(0, Math.min(discount, eligible)));
}

module.exports = { cleanCoupon, apply, normCode, usesOf, usedOn, TYPES };
