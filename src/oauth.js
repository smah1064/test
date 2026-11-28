'use strict';

/**
 * Sign in with Google or Facebook: the standard OAuth 2 "authorization code"
 * redirect. The customer goes to the provider, picks their account, and comes
 * back to /auth/<provider>/callback with a one-time code; the server swaps the
 * code for their profile (provider id, verified email, name) using the app
 * secret. No provider script runs on our pages.
 *
 * Turned on by environment variables (set in the hosting panel):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
 * Redirect URIs to register with the provider:
 *   https://<your domain>/auth/google/callback   (and the www. one if used)
 *   https://<your domain>/auth/facebook/callback
 */
const crypto = require('crypto');

const PROVIDERS = {
  google: {
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  facebook: {
    env: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    meUrl: 'https://graph.facebook.com/v19.0/me',
    scope: 'email,public_profile',
  },
};
const NAMES = Object.keys(PROVIDERS);
const COOKIE = 'pod_o';

/** { google: { clientId, clientSecret } | null, facebook: ... } from the environment (or test overrides). */
function config(overrides = {}) {
  const out = {};
  for (const name of NAMES) {
    if (name in overrides) {
      out[name] = overrides[name];
      continue;
    }
    const [id, secret] = PROVIDERS[name].env.map((k) => String(process.env[k] || '').trim());
    out[name] = id && secret ? { clientId: id, clientSecret: secret } : null;
  }
  return out;
}

/** Where to send the customer to sign in. */
function authUrl(name, cfg, redirectUri, state) {
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: 'code', scope: PROVIDERS[name].scope, state });
  if (name === 'google') q.set('prompt', 'select_account');
  return `${PROVIDERS[name].authUrl}?${q}`;
}

/** The short-lived cookie that ties the callback to the browser that started it. */
function stateCookie(value, { secure }) {
  return `${COOKIE}=${value || ''}; Path=/auth; Max-Age=${value ? 600 : 0}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
function readStateCookie(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.get('cookie') || '');
  if (!m) return null;
  const [state, next] = m[1].split('.');
  return state ? { state, next: next || '' } : null;
}
const newState = () => crypto.randomBytes(24).toString('base64url');
function sameState(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

const lower = (e) => String(e || '').trim().toLowerCase().slice(0, 200);

/** Swap the one-time code for the customer's profile: { id, email (verified only, may be ''), name }. */
async function profile(name, cfg, code, redirectUri, fetchImpl = fetch) {
  const p = PROVIDERS[name];
  const res = await fetchImpl(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code: String(code), redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token exchange failed (${res.status}${tok.error ? `: ${tok.error}` : ''})`);
  if (name === 'google') {
    // The ID token came straight from Google's token endpoint over TLS, so its
    // signature needn't be checked (OpenID Connect Core 3.1.3.7); the claims are.
    const parts = String(tok.id_token || '').split('.');
    let claims;
    try {
      claims = JSON.parse(Buffer.from(parts[1] || '', 'base64url').toString('utf8'));
    } catch (e) {
      throw new Error('no ID token');
    }
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('ID token from the wrong issuer');
    if (claims.aud !== cfg.clientId) throw new Error('ID token for another app');
    if (!claims.exp || claims.exp * 1000 < Date.now() - 60e3) throw new Error('ID token expired');
    if (!claims.sub) throw new Error('ID token without a user');
    return { id: String(claims.sub), email: claims.email_verified === true || claims.email_verified === 'true' ? lower(claims.email) : '', name: String(claims.name || '').trim() };
  }
  // Facebook: read the profile with the access token (and the app-secret proof).
  const proof = crypto.createHmac('sha256', cfg.clientSecret).update(String(tok.access_token || '')).digest('hex');
  const q = new URLSearchParams({ fields: 'id,name,email', access_token: String(tok.access_token || ''), appsecret_proof: proof });
  const me = await fetchImpl(`${p.meUrl}?${q}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const data = await me.json().catch(() => ({}));
  if (!me.ok || !data.id) throw new Error(`profile failed (${me.status})`);
  // Facebook only returns an email the person has confirmed.
  return { id: String(data.id), email: lower(data.email), name: String(data.name || '').trim() };
}

module.exports = { NAMES, PROVIDERS, config, authUrl, stateCookie, readStateCookie, newState, sameState, profile };
