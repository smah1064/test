'use strict';

/**
 * Prices, costs and the money report for the admin's Accounts panel.
 *
 *  - Prices: the shop owner can change a product's price, its extra-side
 *    price and each size's surcharge. Changes are kept in the data file
 *    (db.pricing) and laid over the defaults in src/products.js, so every
 *    page and the order total use them right away.
 *  - Costs (db.costs), per product: blank item cost (plus extra per size),
 *    printing cost for the first side and for each extra side, packaging /
 *    other cost per item.
 *  - Each new order item keeps a copy of its cost at the time of the order,
 *    so later cost changes do not rewrite history. The admin can correct
 *    the real cost of any item and the real shipping cost of any order.
 *  - Expenses (db.expenses): rent, ads, salaries… for net profit.
 */
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.SHOP_TIMEZONE || 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
/** YYYY-MM-DD in the shop's time zone (expense dates are already plain days). */
const localDay = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : DAY_FMT.format(new Date(iso)));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (v, { min = 0, max = 1e7 } = {}) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return undefined; // invalid
  return round2(n);
};

// ---------- Prices ----------
let defaults = null;
/** Remember the built-in prices; give each product its own size objects so prices can differ. */
function initPricing(products, extraSideDefault) {
  if (defaults) return;
  defaults = {};
  for (const p of products) {
    p.sizes = p.sizes.map((s) => ({ ...s }));
    defaults[p.id] = {
      basePrice: p.basePrice,
      extraSidePrice: p.extraSidePrice != null ? p.extraSidePrice : extraSideDefault,
      hadExtra: p.extraSidePrice != null,
      sizes: Object.fromEntries(p.sizes.map((s) => [s.id, s.surcharge || 0])),
    };
  }
}

let appliedKey = null;
/** Lay the saved prices over the defaults (cheap when nothing changed). */
function applyPricing(products, pricing) {
  const key = JSON.stringify(pricing || {});
  if (key === appliedKey) return false;
  appliedKey = key;
  for (const p of products) {
    const d = defaults[p.id];
    if (!d) continue;
    const o = (pricing && pricing[p.id]) || {};
    p.basePrice = o.basePrice != null ? o.basePrice : d.basePrice;
    if (o.extraSidePrice != null) p.extraSidePrice = o.extraSidePrice;
    else if (d.hadExtra) p.extraSidePrice = d.extraSidePrice;
    else delete p.extraSidePrice;
    for (const s of p.sizes) s.surcharge = o.sizes && o.sizes[s.id] != null ? o.sizes[s.id] : d.sizes[s.id];
  }
  return true;
}

/** Check a price change from the admin; returns { pricing } (the product's override) or { error }. */
function cleanPricing(product, body) {
  const d = defaults[product.id];
  const out = {};
  const base = money(body.basePrice, { min: 1 });
  if (base === undefined) return { error: 'badPrice' };
  if (base !== null && base !== d.basePrice) out.basePrice = base;
  const extra = money(body.extraSidePrice);
  if (extra === undefined) return { error: 'badPrice' };
  if (extra !== null && extra !== d.extraSidePrice) out.extraSidePrice = extra;
  const sizes = {};
  for (const s of product.sizes) {
    const v = money(body.sizes && body.sizes[s.id], { min: -1e6 });
    if (v === undefined) return { error: 'badPrice' };
    if (v !== null && v !== d.sizes[s.id]) sizes[s.id] = v;
  }
  if (Object.keys(sizes).length) out.sizes = sizes;
  // A size must never cost less than nothing.
  const finalBase = out.basePrice != null ? out.basePrice : d.basePrice;
  for (const s of product.sizes) {
    const sur = sizes[s.id] != null ? sizes[s.id] : d.sizes[s.id];
    if (finalBase + sur < 1) return { error: 'badPrice' };
  }
  return { pricing: out };
}

// ---------- Costs ----------
const COST_FIELDS = ['blank', 'printFirst', 'printExtra', 'other'];
function cleanCosts(product, body) {
  const out = {};
  for (const k of COST_FIELDS) {
    const v = money(body && body[k]);
    if (v === undefined) return { error: 'badCost' };
    if (v) out[k] = v;
  }
  const sizes = {};
  for (const s of product.sizes) {
    const v = money(body && body.sizes && body.sizes[s.id]);
    if (v === undefined) return { error: 'badCost' };
    if (v) sizes[s.id] = v;
  }
  if (Object.keys(sizes).length) out.sizes = sizes;
  return { costs: out };
}

/** What one order item costs to make, from the product's costs. */
function itemCostFrom(costs, item) {
  const c = (costs && costs[item.productId]) || {};
  const sides = item.kind === 'book' ? 1 : Math.max(1, (item.sides || []).length);
  const blank = round2((c.blank || 0) + ((c.sizes && item.size && c.sizes[item.size.id]) || 0));
  const print = round2((c.printFirst || 0) + (sides - 1) * (c.printExtra || 0));
  const other = round2(c.other || 0);
  // Name lists: one printed copy per row.
  const n = Math.max(1, item.copies || 1);
  if (n > 1) return { blank: round2(blank * n), print: round2(print * n), other: round2(other * n), total: round2((blank + print + other) * n), set: Boolean(costs && costs[item.productId]), copies: n };
  return { blank, print, other, total: round2(blank + print + other), set: Boolean(costs && costs[item.productId]) };
}
/** The cost used in the books: the admin's correction, else the copy made at order time, else today's costs. */
function itemCost(costs, item) {
  if (item.actualCost != null) return { total: item.actualCost, source: 'actual' };
  if (item.costAtOrder) return { ...item.costAtOrder, source: 'order' };
  return { ...itemCostFrom(costs, item), source: 'current' };
}

/**
 * An order's coupon discount shared over its items in proportion to their
 * prices (in piastres, so the shares add up exactly to the discount).
 */
function discountShares(o) {
  const total = Math.round((o.discount || 0) * 100);
  const prices = o.items.map((it) => Math.round((it.price || 0) * 100));
  const sum = prices.reduce((a, b) => a + b, 0);
  if (!total || !sum) return prices.map(() => 0);
  const raw = prices.map((p) => (total * p) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out.map((v) => v / 100);
}

// ---------- Report ----------
/**
 * Money for orders placed between `from` and `to` (inclusive dates,
 * YYYY-MM-DD) and the expenses in that time.
 */
function report({ orders, costs, expenses, settings, from, to }) {
  // Days are Cairo days (an order at 01:30 on the 1st belongs to the 1st, not the day before in UTC).
  const inRange = (iso) => { const day = localDay(iso); return (!from || day >= from) && (!to || day <= to); };
  const defShip = (settings && settings.shippingCost) || 0;
  const rows = [];
  const byProduct = new Map();
  const t = { orders: 0, items: 0, sales: 0, discounts: 0, shippingCharged: 0, revenue: 0, itemCost: 0, shippingCost: 0, grossProfit: 0, collected: 0, pending: 0, missingCosts: 0 };
  for (const o of orders) {
    if (!inRange(o.createdAt)) continue;
    let cost = 0;
    const share = discountShares(o);
    const items = o.items.map((it, idx) => {
      const c = itemCost(costs, it);
      cost += c.total;
      if (c.source !== 'actual' && !c.set) t.missingCosts++;
      const pk = it.productId;
      const p = byProduct.get(pk) || { productId: pk, productName: it.productName, units: 0, sales: 0, cost: 0 };
      p.units++;
      // Sales after the coupon: the order's discount is shared over its items by price.
      p.sales = round2(p.sales + it.price - share[idx]);
      p.cost = round2(p.cost + c.total);
      byProduct.set(pk, p);
      return { id: it.id, productId: it.productId, productName: it.productName, size: it.size, sides: (it.sides || []).length, price: it.price, status: it.status, cost: c.total, costSource: c.source, costParts: c.source === 'actual' ? null : { blank: c.blank, print: c.print, other: c.other } };
    });
    const shipCost = o.actualShipping != null ? o.actualShipping : defShip;
    const shipped = o.items.every((i) => i.status === 'shipped');
    const profit = round2(o.total - cost - shipCost);
    rows.push({
      id: o.id, number: o.number, createdAt: o.createdAt, customer: o.customer.name, status: shipped ? 'shipped' : 'open',
      subtotal: o.subtotal, discount: o.discount || 0, coupon: o.coupon ? o.coupon.code : null, shipping: o.shipping, total: o.total, itemCost: round2(cost), shippingCost: shipCost, shippingCostSet: o.actualShipping != null, profit, items,
    });
    t.orders++;
    t.items += o.items.length;
    t.sales += o.subtotal;
    t.discounts += o.discount || 0;
    t.shippingCharged += o.shipping;
    t.revenue += o.total;
    t.itemCost += cost;
    t.shippingCost += shipCost;
    if (shipped) t.collected += o.total;
    else t.pending += o.total;
  }
  const exp = (expenses || []).filter((e) => inRange(e.date)).sort((a, b) => b.date.localeCompare(a.date));
  const expensesTotal = exp.reduce((n, e) => n + e.amount, 0);
  for (const k of Object.keys(t)) if (typeof t[k] === 'number') t[k] = round2(t[k]);
  t.grossProfit = round2(t.revenue - t.itemCost - t.shippingCost);
  t.expenses = round2(expensesTotal);
  t.netProfit = round2(t.grossProfit - t.expenses);
  t.margin = t.revenue ? Math.round((t.grossProfit / t.revenue) * 1000) / 10 : 0;
  const products = [...byProduct.values()].map((p) => ({ ...p, profit: round2(p.sales - p.cost) })).sort((a, b) => b.sales - a.sales);
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { from, to, totals: t, orders: rows, products, expenses: exp };
}

/** The report's orders as CSV (opens in Excel; UTF-8 with BOM so Arabic names show). */
function reportCsv(r, nameOf) {
  // Numbers stay numbers (Excel adds them up); text that could start a formula gets a ' in front.
  const q = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['Order', 'Date', 'Customer', 'Status', 'Items', 'Products', 'Sales', 'Discount', 'Coupon', 'Shipping charged', 'Total', 'Item cost', 'Shipping cost', 'Profit'].join(',')];
  for (const o of r.orders) {
    lines.push([o.number, localDay(o.createdAt), o.customer, o.status, o.items.length, o.items.map((i) => nameOf(i.productName)).join(' + '), o.subtotal, o.discount, o.coupon || '', o.shipping, o.total, o.itemCost, o.shippingCost, o.profit].map(q).join(','));
  }
  lines.push('');
  lines.push(['Expenses', 'Date', 'Category', 'Description', 'Amount'].join(','));
  for (const e of r.expenses) lines.push(['', e.date, e.category, e.description, e.amount].map(q).join(','));
  lines.push('');
  const t = r.totals;
  for (const [k, v] of [['Discounts', t.discounts], ['Revenue', t.revenue], ['Item cost', t.itemCost], ['Shipping cost', t.shippingCost], ['Gross profit', t.grossProfit], ['Expenses', t.expenses], ['Net profit', t.netProfit]]) lines.push([k, v].map(q).join(','));
  return '﻿' + lines.join('\r\n');
}

const EXPENSE_CATEGORIES = ['materials', 'printing', 'shipping', 'marketing', 'rent', 'salaries', 'equipment', 'other'];
function cleanExpense(body) {
  const date = String((body && body.date) || '');
  // A real calendar day (2026-02-30 is refused).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return { error: 'badDate' };
  const amount = money(body.amount, { min: 0.01 });
  if (amount === null || amount === undefined) return { error: 'badAmount' };
  const category = EXPENSE_CATEGORIES.includes(body.category) ? body.category : 'other';
  const description = String(body.description || '').trim().slice(0, 200);
  return { expense: { date, amount, category, description } };
}

module.exports = {
  round2, money, localDay, initPricing, applyPricing, cleanPricing, cleanCosts, itemCostFrom, itemCost, report, reportCsv, cleanExpense, EXPENSE_CATEGORIES,
  defaultsFor: (id) => defaults && defaults[id],
};
