'use strict';

/**
 * Passwords people would guess first, for the team's sign-ins and for customers' accounts: one list of common
 * passwords and of the parts that guess easily, used by both.
 *
 *  - Team (staffPassword): 10+ characters, not only digits, 4+ different characters, not a common one, and what's
 *    left without the easy parts, the person's username and the parts of their name is still six characters or
 *    more, four of them different, with a letter (or ten of them). "mostafa.ali" for mostafa.ali, "qwerty12345",
 *    "password1234!" are refused. QA 25 Nov.
 *  - Customers (customerPasswordProblem): 8+ characters, not a common one ("12345678", "password1", "qwerty123",
 *    "11111111", in any digits), and not their own mobile number (any way of writing it: Arabic digits, +20,
 *    spaces), email or name. Only checked when a password is chosen (sign-up, change, reset): an account that
 *    already has such a password still signs in with it.
 */
const { normalizeDigits, normalizeEgyptMobile } = require('./egypt');

const COMMON_PASSWORDS = new Set([
  'password12', 'password123', 'password1234', 'qwertyuiop', 'qwerty1234', '1234567890', '0123456789', 'abcdefghij', 'abc1234567', 'iloveyou12', 'admin12345', 'admin123456', 'welcome123', 'ebda3ebda3', 'ebda312345',
  // (Long enough for a customer's 8: the ones every list of leaked passwords starts with.)
  '1qaz2wsx', 'zaq12wsx', '1q2w3e4r5t', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'trustno1', 'whatever', 'starwars', 'passw0rd',
]);
/** Parts that guess easily, taken out before what's left of a password is judged. */
const WEAK_PARTS = ['password', 'passw0rd', 'qwerty', 'azerty', 'asdfgh', 'zxcvbn', '1q2w3e4r', '1q2w3e', 'q1w2e3', 'abc123', '1234567890',
  '123456', '12345', '654321', 'iloveyou', 'welcome', 'letmein', 'admin', 'ebda3', 'ebdaa', 'abcdef', '00000', '11111',
  // (Four-letter runs and doubled digits: "abcd1234", "asdf1234", "11223344" are refused, "mona1234" still does. QA 26 Nov.)
  'abcd', 'asdf', 'qwer', 'zxcv', '1122', '2233', '3344'];

/** What's left of a (lower-case) password without the easy parts and the given own words, longest first. */
function withoutParts(lower, own = []) {
  let rest = lower;
  for (const part of [...own.sort((a, b) => b.length - a.length), ...WEAK_PARTS]) rest = rest.split(part).join('');
  return rest;
}

/** A team member's password (`who`: { username, name }) is hard enough to guess. */
function staffPassword(pw, who) {
  if (typeof pw !== 'string') return false;
  // (Arabic or Persian digits are digits: "١٢٣٤٥٦٧٨٩٠١٢" is "123456789012", only numbers. QA 26 Nov.)
  const n = normalizeDigits(pw);
  if (!(pw.length >= 10 && pw.length <= 200 && pw.trim().length >= 10
    && new Set(n).size >= 4 && !/^\d+$/.test(n) && !COMMON_PASSWORDS.has(n.toLowerCase()))) return false;
  const own = who ? [String(who.username || ''), ...String(who.name || '').split(/[\s._-]+/)].map((x) => x.toLowerCase()).filter((x) => x.length >= 3) : [];
  const rest = withoutParts(n.toLowerCase(), own);
  // (What's left only digits and signs, "2024!!": a letter too, or ten of them.)
  return rest.length >= 6 && new Set(rest).size >= 4 && (/\p{L}/u.test(rest) || rest.length >= 10);
}

/**
 * One of the first passwords anyone tries: on the list, fewer than 4 different characters ("11111111",
 * "abababab"), or little more than the easy parts ("12345678", "password1", "qwerty2024", "87654321"). Digits
 * count the same in any script (١٢٣٤٥٦٧٨ is 12345678).
 */
function commonPassword(pw) {
  const s = normalizeDigits(String(pw || '')).trim().toLowerCase();
  if (COMMON_PASSWORDS.has(s) || new Set(s).size < 4) return true;
  if (/^(?:(\d)\1)+$/.test(s)) return true; // digits in pairs: 11223344, 99887766
  const rest = withoutParts(s);
  return rest.length < 5 || new Set(rest).size < 3;
}

/** Letters and digits only, lower case, digits 0-9: "Ahmed Ali", "ahmed.ali" and "AHMED_ALI" read the same. */
const flat = (v) => normalizeDigits(String(v || '')).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Is the password just the person's own mobile number (any spelling: ٠١١…, +20 11…, 011 5555 4441, without the
 * first 0), their email (or the part before the @) or their name? `who`: { phone, email, name } as kept.
 */
function ownDetails(pw, who) {
  if (!who || typeof who !== 'object') return false;
  const s = String(pw || '').trim();
  const phone = typeof who.phone === 'string' && who.phone ? who.phone : '';
  if (phone && (normalizeEgyptMobile(s) === phone || normalizeEgyptMobile(`0${s}`) === phone)) return true;
  const email = typeof who.email === 'string' ? who.email.toLowerCase() : '';
  const lower = s.toLowerCase();
  if (email && (lower === email || lower === email.split('@')[0])) return true;
  const mine = flat(s);
  return Boolean(mine) && [who.name, email.split('@')[0]].some((v) => v && flat(v) === mine);
}

/**
 * Why a customer's new password won't do, as a message key, or null: too short or long, their own details, or
 * too common. `who`: the account ({ phone, email, name }), or the sign-up's fields.
 */
function customerPasswordProblem(pw, who) {
  if (typeof pw !== 'string' || pw.length < 8) return 'acctPasswordShort';
  if (pw.length > 200) return 'acctPasswordLong';
  if (ownDetails(pw, who)) return 'acctPasswordPersonal';
  if (commonPassword(pw)) return 'acctPasswordCommon';
  return null;
}

module.exports = { COMMON_PASSWORDS, WEAK_PARTS, staffPassword, commonPassword, ownDetails, customerPasswordProblem };
