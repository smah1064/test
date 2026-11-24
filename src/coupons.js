'use strict';

/**
 * Coupon codes (vouchers), made by the shop owner in the admin and typed by
 * customers at checkout.
 *
 *  - percent: a percentage off the items it applies to (optionally capped)
 *  - fixed:   an amount off those items (never more than they cost)
 *  - freeship: free shipping
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
const normCode = (c) => String(c == null ? '' : c).trim().toUpperCase().replace(/\s+/g, '');
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Checks a coupon from the admin form; returns { coupon } or { error }. */
function cleanCoupon(body, { products, categories }) {
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
  const value = type === 'freeship' ? 0 : num(b.value, { min: 0.01, max: type === 'percent' ? 100 : 1e7 });
  if (value === null || value === undefined) return { error: 'couponValueBad' };
  const maxDiscount = num(b.maxDiscount, { min: 0.01 });
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
 */
function apply(coupon, { lines, orders = [], phone = null }) {
  if (!coupon || !coupon.active) return { ok: false, reason: 'couponNotFound' };
  const day = today();
  if (coupon.startsOn && day < coupon.startsOn) return { ok: false, reason: 'couponNotYet', params: { date: coupon.startsOn } };
  if (coupon.endsOn && day > coupon.endsOn) return { ok: false, reason: 'couponExpired' };
  if (coupon.maxUses && usesOf(orders, coupon) >= coupon.maxUses) return { ok: false, reason: 'couponUsedUp' };
  if (phone && coupon.perCustomer && usesBy(orders, coupon, phone) >= coupon.perCustomer) return { ok: false, reason: 'couponUsedByYou' };
  const subtotal = round2(lines.reduce((n, l) => n + l.price, 0));
  if (coupon.minOrder && subtotal < coupon.minOrder) return { ok: false, reason: 'couponMinOrder', params: { amount: coupon.minOrder } };
  const limited = coupon.products.length || coupon.categories.length;
  const fits = lines.map((l) => !limited || coupon.products.includes(l.productId) || coupon.categories.includes(l.category));
  const eligible = round2(lines.filter((l, i) => fits[i]).reduce((n, l) => n + l.price, 0));
  if (!eligible && coupon.type !== 'freeship') return { ok: false, reason: 'couponNoItems' };
  let discount = 0;
  if (coupon.type === 'percent') discount = round2((eligible * coupon.value) / 100);
  if (coupon.type === 'fixed') discount = Math.min(eligible, coupon.value);
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  // Which lines the discount came off (by index), so reports can charge it to those products only.
  const lineIdx = fits.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  return { ok: true, discount: round2(discount), freeShipping: coupon.type === 'freeship', eligible, lines: lineIdx };
}

module.exports = { cleanCoupon, apply, normCode, usesOf, usedOn, TYPES };
