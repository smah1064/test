'use strict';

// Account › Password: Enter in the "Delete my account" password box. The box was inside the "Change password" form,
// so Enter sent that form with empty boxes, and each press counted as a wrong password (10 locked changing the
// password and deleting for an hour). Now the delete box is its own form: Enter there is its Delete button (with
// the tick), and never sends a change of password.
const test = require('node:test');
const assert = require('node:assert');
const { loadPlaywright, startServer } = require('./helpers');

/** A signed-in customer on Account › Password, in `lang`, at `width`; the requests to /api/account/* are kept. */
async function openSecurity(browser, base, { lang, width, phone, password }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const sent = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/account\//.test(r.url())) sent.push(new URL(r.url()).pathname); });
  await page.goto(`${base}/account`);
  const made = await page.evaluate(async (b) => (await fetch('/api/account/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status, { name: 'Sara Test', phone, password });
  assert.ok([200, 201].includes(made), `signed up (${made})`);
  await page.goto(`${base}/account?view=security`);
  await page.waitForSelector('#del-open:visible');
  sent.length = 0;
  return { ctx, page, errors, sent };
}

test('Account › Password: Enter in the delete box never sends "Change password"; Enter deletes once ticked', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const { page, errors, sent } = await openSecurity(browser, srv.base, { lang: 'en', width: 1280, phone: '01066665511', password: 'sara-password-1' });
    // The delete part is in the same card as the password, under it, as before (its own form inside the card).
    assert.ok(await page.evaluate(() => {
      const card = document.getElementById('v-security');
      const del = document.getElementById('del-form');
      return card.classList.contains('card') && card.contains(del) && card.contains(document.getElementById('pw-form'))
        && !del.closest('#pw-form') && del.getBoundingClientRect().top > document.getElementById('pw-submit').getBoundingClientRect().bottom;
    }), 'one card: the password, then Delete my account');

    await page.click('#del-open');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'del-pw');
    await page.fill('#del-pw', 'sara-password-1');
    // Not ticked yet: Enter asks for the tick, as the Delete button does, and sends nothing. Pressed 10 times, as
    // many as used to lock the account.
    for (let i = 0; i < 10; i++) await page.press('#del-pw', 'Enter');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(sent, [], 'no request: neither the change of password nor the delete');
    await page.waitForSelector('#del-msg:visible');
    assert.strictEqual(await page.textContent('#del-msg'), 'Tick that you’re sure first.');
    assert.strictEqual(await page.inputValue('#del-pw'), 'sara-password-1', 'what was typed stays');

    // Nothing was counted as a wrong password: changing the password (Enter in its own form) still works.
    await page.fill('#pw-cur', 'sara-password-1');
    await page.fill('#pw-new', 'sara-password-2');
    const changed = page.waitForResponse((r) => r.url().endsWith('/api/account/password'));
    await page.press('#pw-new', 'Enter');
    assert.strictEqual((await changed).status(), 200);
    await page.waitForFunction(() => document.body.innerText.includes('Password changed'));
    assert.deepStrictEqual(sent, ['/api/account/password'], 'Enter in the password form sends only the change of password');

    // Ticked: Enter in the delete box deletes, with the password typed there.
    sent.length = 0;
    await page.check('#del-sure');
    await page.fill('#del-pw', 'sara-password-2');
    const gone = page.waitForResponse((r) => r.url().endsWith('/api/account/delete'));
    await Promise.all([page.waitForURL(`${srv.base}/`), page.press('#del-pw', 'Enter')]);
    assert.strictEqual((await gone).status(), 200);
    assert.deepStrictEqual(sent, ['/api/account/delete']);
    const me = await page.evaluate(async () => (await (await fetch('/api/account')).json()).customer);
    assert.strictEqual(me, null, 'signed out: the account is gone');
    const login = await page.evaluate(async () => (await fetch('/api/account/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: '01066665511', password: 'sara-password-2' }) })).status);
    assert.notStrictEqual(login, 200, 'the deleted account no longer signs in');
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('Account › Password (Arabic, phone 360 px): Enter on the tick box or with a wrong password is only the delete; the Delete button still deletes', { timeout: 90000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    const { page, errors, sent } = await openSecurity(browser, srv.base, { lang: 'ar', width: 360, phone: '01066665522', password: 'sara-password-1' });
    assert.strictEqual(await page.evaluate(() => document.documentElement.dir), 'rtl');
    // Nothing wider than the phone.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 360 px');
    await page.click('#del-open');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll with the delete box open');
    // Enter on the tick box (Chrome sends its form too): as the Delete button, it asks for the password; nothing is sent.
    await page.check('#del-sure');
    await page.press('#del-sure', 'Enter');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(sent, [], 'Enter on the tick box sends no change of password');
    await page.waitForSelector('#del-msg:visible');
    assert.strictEqual(await page.textContent('#del-msg'), 'اكتب كلمة المرور.');
    // Ticked, a wrong password, Enter: one delete request, refused; no change of password.
    await page.fill('#del-pw', 'not-my-password');
    const refused = page.waitForResponse((r) => r.url().endsWith('/api/account/delete'));
    await page.press('#del-pw', 'Enter');
    assert.notStrictEqual((await refused).status(), 200);
    await page.waitForSelector('#del-msg:visible');
    assert.deepStrictEqual(sent, ['/api/account/delete']);
    // The Delete button, as before.
    sent.length = 0;
    await page.fill('#del-pw', 'sara-password-1');
    await Promise.all([page.waitForURL(`${srv.base}/`), page.click('#del-go')]);
    assert.deepStrictEqual(sent, ['/api/account/delete']);
    assert.strictEqual(await page.evaluate(async () => (await (await fetch('/api/account')).json()).customer), null);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
