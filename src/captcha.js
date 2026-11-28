'use strict';
/*
 * Cloudflare Turnstile (CAPTCHA) on sign-up, sign-in, password reset requests and checkout.
 * It is on only when both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set (Hostinger
 * environment variables); otherwise every form works as before.
 *
 * The browser gets a one-time token from Cloudflare's widget and sends it as `captchaToken`;
 * the server checks it with Cloudflare. If Cloudflare can't be reached the request is let
 * through (and logged): an outage at Cloudflare must not stop customers from ordering. The
 * rate limits still apply.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function fromEnv(env = process.env) {
  const siteKey = String(env.TURNSTILE_SITE_KEY || '').trim();
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  if (!siteKey || !secret) return null;
  return { siteKey, secret };
}

/**
 * Checks a token. Returns { ok: true } or { ok: false, reason }.
 * `fetchImpl` is for tests.
 */
async function verify(cfg, token, ip, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, reason: 'missing' };
  let res;
  try {
    const body = new URLSearchParams({ secret: cfg.secret, response: token });
    if (ip) body.set('remoteip', ip);
    res = await fetchImpl(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    console.warn('[captcha] Cloudflare unreachable, letting the request through:', e.message);
    return { ok: true, unchecked: true };
  }
  if (!res.ok) {
    console.warn(`[captcha] Cloudflare answered ${res.status}, letting the request through`);
    return { ok: true, unchecked: true };
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: true, unchecked: true };
  }
  if (data && data.success === true) return { ok: true };
  const codes = (data && data['error-codes']) || [];
  // A wrong secret is the shop's mistake, not the customer's: log it loudly and let them through.
  if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
    console.error('[captcha] TURNSTILE_SECRET_KEY is wrong (Cloudflare refused it); fix it in Hostinger');
    return { ok: true, unchecked: true };
  }
  return { ok: false, reason: codes.join(',') || 'failed' };
}

module.exports = { fromEnv, verify, VERIFY_URL };
