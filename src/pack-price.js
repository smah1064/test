'use strict';

/**
 * More copies never cost less than fewer (owner, 27 Nov: 900 DL envelopes as 500 + 4 × 100 were EGP 2,450 while
 * 1,000 as 2 × 500 were 2,100). The price of `copies` copies of one print is the cheapest set of packs that makes AT
 * LEAST that many; the copies asked for are what is printed. The editor has the same rule (public/js/editor.js,
 * packCover).
 *
 * packs: [{ copies, price }] (one pack of each size of the family, with its options); returns the price, or null.
 */
function coverPrice(packs, copies) {
  const usable = (packs || []).filter((p) => p && p.copies > 0 && Number.isFinite(p.price) && p.price >= 0);
  if (!usable.length || !(copies > 0)) return null;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = usable.reduce((a, p) => gcd(a, p.copies), 0);
  const need = Math.ceil(copies / g);
  const top = need + Math.max(...usable.map((p) => p.copies / g));
  if (top > 2e6) return null;
  const cost = new Float64Array(top + 1).fill(Infinity);
  cost[0] = 0;
  for (let n = 1; n <= top; n++) {
    for (const p of usable) {
      const k = p.copies / g;
      if (k <= n && cost[n - k] + p.price < cost[n]) cost[n] = cost[n - k] + p.price;
    }
  }
  let best = Infinity;
  for (let n = need; n <= top; n++) if (cost[n] < best) best = cost[n];
  return Number.isFinite(best) ? Math.round(best * 100) / 100 : null;
}

module.exports = { coverPrice };
