'use strict';

/*
 * How the shop talks about paying: the one switch for the launch (owner's decision; wording prepared with
 * the owner's OK, 26 Nov: "ready to switch on at launch, kept off the live site until I say so").
 *
 *   PREPAY_ONLY = false   Today (the private preview): every order is cash on delivery, and the pages,
 *                         messages and emails say so, exactly as before this switch existed.
 *   PREPAY_ONLY = true    At launch: paying in advance is the only way to pay. Every promise of cash on
 *                         delivery gives way to prepayment wording ("Pay when you order", "nothing to pay
 *                         the courier"). Owner's decisions, 26 Nov, shown only then: the ways to pay (card,
 *                         Vodafone Cash, InstaPay) are named where the shop says how to pay (wording only), the
 *                         money-back guarantee is on the home page, a ready design, the editor, checkout, the
 *                         order page and the customer's emails, with its own page (/guarantee: not found while
 *                         off), and the order page's payment box is calm rather than a red warning.
 *
 * To switch on: set PREPAY_ONLY to true here and deploy. Only the wording changes: orders are still created
 * and marked paid as before (the way to pay in advance is built separately). Tests can set it per app with
 * createApp({ prepayOnly }).
 *
 * The pages learn it from /api/products (`payment: { prepayOnly }`), the order and invoice pages from the
 * order (`shop.payment`), the dashboard from /api/admin/session; public/js/i18n.js keeps each text's
 * prepay wording under the same key + '.prepay' (see POD.payment in public/js/common.js). The server's own
 * messages and emails take it as `prepayOnly` (src/notify.js).
 */
const PREPAY_ONLY = false;

module.exports = { PREPAY_ONLY };
