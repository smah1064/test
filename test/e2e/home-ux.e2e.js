'use strict';

// The home page, owner's OK on the mock-ups (27 Nov), on phones (Pixel 7 and 360px), in Arabic and English, with the
// launch switch off (today: cash on delivery) and on (paying in advance only, src/payment-wording.js):
//   1. The four points under the banner: today's four (and the lower "why order here" box) exactly as before while
//      off; from launch: pay in advance (the ways to pay), the 7-day guarantee (a link to its page), the real delivery
//      days and the proof, the lower box not shown, and nothing promises cash on delivery.
//   2. The categories above "All products": one row that is swiped, a fade at its end edge until the end is reached,
//      the chosen one in view, and the heading names the chosen category (computers: the chips wrap, as before).
//   3. Product cards: the size or pack on its own small grey line under the price, its words unchanged.
//   5. Five rows (new & best sellers, wear, gifts, cards, business) and "How it works" right after the points,
//      compact on phones; the products of the rows that went are still in "All products".
//   6. "See all" is a pill at least 44 px tall; the kids' books' buttons line up; each page downloads only its
//      language's logo, and switching language shows the other one.
// And no sideways scroll anywhere.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadPlaywright, startServer } = require('./helpers');
const { DELIVERY_DAYS } = require('../../src/products');

let off;
let on;
let browser;
let devices;
test.before(async () => {
  [off, on] = await Promise.all([startServer(), startServer({ prepayOnly: true })]);
  const pw = loadPlaywright();
  devices = pw.devices;
  browser = await pw.chromium.launch();
});
test.after(async () => {
  if (browser) await browser.close();
  if (off) await off.close();
  if (on) await on.close();
});

const PHONES = () => [['Pixel 7', devices['Pixel 7']], ['360px', { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } }]];
const DESKTOP = { viewport: { width: 1366, height: 900 } };

async function context(lang, opts) {
  const { defaultBrowserType, ...rest } = opts; // (Chromium for every device)
  const ctx = await browser.newContext({ ...rest, serviceWorkers: 'block' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('pod-lang', l); } catch (e) { /* ignore */ } }, lang);
  return ctx;
}
/** The home page (or `url`) with its products drawn and its fonts in. */
async function home(ctx, srv, url = '/') {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.errors = errors;
  await page.goto(srv.base + url, { waitUntil: 'load' });
  await page.waitForSelector('.hm-gcard, .home-empty', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return page;
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Every word of the page, shown or not (as prepay-wording.e2e.js reads it). */
const pageText = (page) => page.evaluate(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('script, style, noscript, template') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  while (walk.nextNode()) out.push(walk.currentNode.nodeValue);
  return out.join(' ').replace(/\s+/g, ' ');
});
const COD = /الاستلام|عند استلام|كاش|cash on delivery|on delivery|in cash/i;
const codOn = (text) => COD.exec(text.replace(/الاستلام المتوقع|فودافون كاش/g, ''));

/** The visible points under the banner: [title, line] each, the links in them. */
const readStrip = () => {
  const shown = (el) => el.getClientRects().length > 0;
  const lists = [...document.querySelectorAll('.hm-trust')].filter(shown);
  return {
    lists: lists.length,
    prepayList: lists.length === 1 && lists[0].classList.contains('hm-trust-prepay'),
    points: lists.flatMap((ul) => [...ul.querySelectorAll('li')].filter(shown).map((li) => [li.querySelector('strong').textContent, li.querySelector('small').textContent])),
    links: [...document.querySelectorAll('.hm-trust a')].filter(shown).map((a) => { const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), h: r.height, text: a.textContent.trim() }; }),
    benefits: shown(document.querySelector('.hm-benefits')),
    // (Today's four in today's words, as the strings say.)
    today: ['delivery', 'proof', 'one', 'pay'].map((k) => [POD.t(`hm.trust.${k}T`), POD.t(`hm.trust.${k}S`)]),
    hidden: [...document.querySelectorAll('.hm-trust-prepay, .hm-trust-prepay [data-prepay-only]')].every((el) => el.hidden && !el.textContent.trim()),
    guarLinks: [...document.querySelectorAll('a[href]')].filter((a) => /\/guarantee/.test(a.getAttribute('href'))).length,
  };
};

const LAUNCH = {
  ar: [['ادفع مقدّمًا', 'كارت، فودافون كاش، إنستاباي'], ['ضمان ٧ أيام', 'نطبعهالك تاني أو ترجعلك فلوسك'], ['توصيل خلال يومين', 'بالسريع، أو ٥ أيام للعادي'], ['هتشوف البروفة', 'قبل ما نطبع']],
  en: [['Pay in advance', 'Card, Vodafone Cash or InstaPay'], ['7-day guarantee', 'Reprint or your money back'], ['Delivery in 2 days', 'Express, or 5 days standard'], ['You see the proof', 'before we print']],
};
const TODAY = {
  ar: [['توصيل لكل محافظات مصر', 'وسريع خلال يومين عمل'], ['بتشوف البروفة', 'قبل ما نطبع'], ['من قطعة واحدة', 'لحد آلاف'], ['دفع آمن', 'والسعر واضح من الأول']],
  en: [['Delivery all over Egypt', 'Express in 2 business days'], ['You see the proof', 'before we print'], ['From one piece', 'to thousands'], ['Safe payment', 'and a clear price up front']],
};
const norm = (pairs) => pairs.map((p) => p.map((s) => s.replace(/\s+/g, ' ')));

test('1. the points under the banner: today\'s while off; pay in advance, the guarantee, the real days and the proof while on', { timeout: 240000 }, async () => {
  // (The launch wording names the shop's settings: 2 days express, 5 standard.)
  assert.deepStrictEqual(DELIVERY_DAYS, { standard: 5, express: 2 }, 'the delivery days the words below expect');
  for (const [devName, dev] of PHONES()) {
    for (const lang of ['ar', 'en']) {
      for (const [mode, srv] of [['off', off], ['on', on]]) {
        const where = `${mode} ${lang} ${devName}`;
        const ctx = await context(lang, dev);
        try {
          const page = await home(ctx, srv);
          const s = await page.evaluate(readStrip);
          assert.strictEqual(s.lists, 1, `${where}: one row of points`);
          assert.strictEqual(s.points.length, 4, `${where}: four points`);
          if (mode === 'off') {
            assert.deepStrictEqual(norm(s.points), TODAY[lang], `${where}: today's four, word for word`);
            assert.deepStrictEqual(s.points, s.today, `${where}: today's strings`);
            assert.ok(!s.prepayList && s.hidden, `${where}: the launch points hidden and empty`);
            assert.strictEqual(s.guarLinks, 0, `${where}: nothing links to the guarantee`);
            assert.ok(s.benefits, `${where}: the lower box as today`);
            assert.ok(/الدفع عند الاستلام|Cash on delivery/.test(await page.locator('.hm-benefits').innerText()), `${where}: the lower box's words as today`);
          } else {
            assert.ok(s.prepayList, `${where}: the launch points`);
            assert.deepStrictEqual(norm(s.points), LAUNCH[lang], `${where}: the launch words`);
            assert.deepStrictEqual(s.links.map((l) => l.href), ['/guarantee'], `${where}: the guarantee point links to its page`);
            assert.ok(s.links[0].h >= 44 && s.links[0].text, `${where}: the whole point is the link (${s.links[0].h}px)`);
            assert.strictEqual(s.guarLinks, 1, `${where}: one way to the guarantee on the page`);
            assert.ok(!s.benefits, `${where}: the lower box is not shown`);
            const green = await page.evaluate(() => getComputedStyle(document.querySelector('.hm-trust-guar small')).color);
            assert.strictEqual(green, 'rgb(15, 107, 58)', `${where}: the guarantee in green`);
            const hit = codOn(await pageText(page));
            assert.strictEqual(hit, null, `${where}: no promise of cash on delivery ("${hit && hit[0]}")`);
            if (devName === 'Pixel 7') {
              // Switching language: the points in the other language, the days still the shop's.
              await page.click('.site-header .inner [data-lang-toggle]');
              await page.waitForFunction((l) => document.documentElement.lang === l, lang === 'ar' ? 'en' : 'ar');
              assert.deepStrictEqual(norm((await page.evaluate(readStrip)).points), LAUNCH[lang === 'ar' ? 'en' : 'ar'], `${where}: after switching language`);
              await page.click('.hm-trust-guar a');
              await page.waitForURL(/\/guarantee$/);
              await page.waitForFunction(() => Boolean(document.querySelector('[data-i18n="gu.title"]').textContent));
            }
          }
          assert.ok(await noSideScroll(page), `${where}: no sideways scroll`);
          assert.deepStrictEqual(page.errors, [], where);
        } finally {
          await ctx.close();
        }
      }
    }
  }
  // /guarantee only while on.
  assert.strictEqual((await fetch(`${off.base}/guarantee`)).status, 404);
  assert.strictEqual((await fetch(`${on.base}/guarantee`)).status, 200);
});

/** The category row: chips' rows, scroll sizes, the fade, the heading, where the chosen chip is. */
const readCats = () => {
  const row = document.getElementById('cats');
  const r = row.getBoundingClientRect();
  const chips = [...row.querySelectorAll('.chip')];
  const a = row.querySelector('.chip.active').getBoundingClientRect();
  const cs = getComputedStyle(row);
  return {
    lines: new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    minH: Math.min(...chips.map((c) => c.getBoundingClientRect().height)),
    scrollW: row.scrollWidth,
    clientW: row.clientWidth,
    more: row.classList.contains('cats-more'),
    mask: cs.maskImage || cs.webkitMaskImage || '',
    heading: document.getElementById('hm-all-title').textContent,
    active: { text: row.querySelector('.chip.active').textContent, inRow: a.left >= r.left - 1 && a.right <= r.right + 1 },
    cats: chips.map((c) => c.dataset.cat),
    wrap: cs.flexWrap,
  };
};

test('2. categories on phones: one swiped row, a fade at the end edge, the chosen one in view, the heading follows', { timeout: 240000 }, async () => {
  for (const [devName, dev] of PHONES()) {
    for (const lang of ['ar', 'en']) {
      const where = `${lang} ${devName}`;
      const ctx = await context(lang, dev);
      try {
        const page = await home(ctx, off);
        let c = await page.evaluate(readCats);
        assert.strictEqual(c.lines, 1, `${where}: one row`);
        assert.ok(c.minH >= 44, `${where}: chips at least 44 px tall (${c.minH})`);
        assert.ok(c.scrollW > c.clientW + 40, `${where}: the row is swiped (${c.scrollW} > ${c.clientW})`);
        assert.ok(c.more, `${where}: more to see`);
        // The fade is at the end edge: the left in Arabic, the right in English.
        assert.match(c.mask, lang === 'ar' ? /to left/ : /to right/, `${where}: fade on the end side (${c.mask})`);
        assert.strictEqual(c.heading, lang === 'ar' ? 'كل المنتجات' : 'All products', `${where}: heading`);
        // Swiped to the end: the fade goes.
        await page.evaluate((rtl) => { const row = document.getElementById('cats'); row.scrollLeft = (rtl ? -1 : 1) * (row.scrollWidth + 100); }, lang === 'ar');
        await page.waitForFunction(() => !document.getElementById('cats').classList.contains('cats-more'));
        c = await page.evaluate(readCats);
        assert.strictEqual(c.mask, 'none', `${where}: no fade at the end`);
        // A category: the heading is its name, and back to "All products".
        await page.click('#cats [data-cat="business"]');
        c = await page.evaluate(readCats);
        assert.strictEqual(c.heading, c.active.text, `${where}: heading is the category`);
        assert.strictEqual(c.heading, lang === 'ar' ? 'للأعمال' : 'Business');
        assert.ok(c.active.inRow, `${where}: the chosen chip in view`);
        const last = c.cats[c.cats.length - 1];
        await page.evaluate(() => { document.getElementById('cats').scrollLeft = 0; });
        await page.click('#cats [data-cat="all"]');
        assert.strictEqual((await page.evaluate(readCats)).heading, lang === 'ar' ? 'كل المنتجات' : 'All products', `${where}: back to all`);
        // Opened on the last category (a link): its chip is scrolled into view, the page doesn't scroll sideways.
        const page2 = await home(ctx, off, `/?cat=${last}#products`);
        c = await page2.evaluate(readCats);
        assert.ok(c.active.inRow, `${where}: ${last} scrolled into view`);
        assert.strictEqual(c.heading, c.active.text, `${where}: heading ${last}`);
        assert.ok(await noSideScroll(page2), `${where}: no sideways scroll`);
        // The heading in the other language after switching.
        await page2.click('.site-header .inner [data-lang-toggle]');
        await page2.waitForFunction((l) => document.documentElement.lang === l, lang === 'ar' ? 'en' : 'ar');
        c = await page2.evaluate(readCats);
        assert.strictEqual(c.heading, c.active.text, `${where}: heading after switching language`);
        assert.deepStrictEqual([...page.errors, ...page2.errors], [], where);
      } finally {
        await ctx.close();
      }
    }
  }
  // Computers: the chips wrap as before, no fade.
  const ctx = await context('ar', DESKTOP);
  try {
    const c = await (await home(ctx, off)).evaluate(readCats);
    assert.strictEqual(c.wrap, 'wrap');
    assert.ok(c.lines > 1 || c.scrollW <= c.clientW, 'all chips show');
    assert.strictEqual(c.mask, 'none');
  } finally {
    await ctx.close();
  }
});

test('3, 5, 6a. cards: the size on its own grey line; five rows, "How it works" after the points; "See all" 44 px', { timeout: 240000 }, async () => {
  for (const [devName, dev] of PHONES()) {
    for (const lang of ['ar', 'en']) {
      for (const [mode, srv] of [['off', off], ['on', on]]) {
        const where = `${mode} ${lang} ${devName}`;
        const ctx = await context(lang, dev);
        try {
          const page = await home(ctx, srv, '/?cat=business#products');
          const m = await page.evaluate(() => {
            const rtl = document.documentElement.dir === 'rtl';
            const box = (el) => el.getBoundingClientRect();
            const shown = (el) => el.getClientRects().length > 0;
            const packs = [...document.querySelectorAll('.hm-card, .hm-gcard')].filter((c) => c.querySelector('.hm-pack')).map((card) => {
              const price = box(card.querySelector('.hm-price'));
              const pack = card.querySelector('.hm-pack');
              const pb = box(pack);
              const s = getComputedStyle(pack);
              return { id: card.dataset.place || card.getAttribute('href'), text: pack.textContent, below: pb.top >= price.bottom - 1, start: rtl ? Math.abs(pb.right - price.right) : Math.abs(pb.left - price.left), size: s.fontSize, color: s.color };
            });
            const steps = document.querySelector('.hm-how');
            const prev = steps.previousElementSibling;
            const lastStrip = [...document.querySelectorAll('.hm-trust')].filter(shown).pop();
            return {
              packs,
              grid: Object.fromEntries([...document.querySelectorAll('.hm-gcard')].map((c) => [c.dataset.place, (c.querySelector('.hm-pack') || {}).textContent || ''])),
              rows: [...document.querySelectorAll('.hm-section')].map((s) => s.dataset.place),
              howAfterStrip: prev.classList.contains('hm-trust') && box(steps).top > box(lastStrip).bottom && box(steps).bottom < box(document.getElementById('hm-tiles')).top,
              howH: box(steps).height,
              stepText: Math.min(...[...document.querySelectorAll('.hm-step p')].map((p) => parseFloat(getComputedStyle(p).fontSize))),
              more: [...document.querySelectorAll('.hm-more')].map((a) => { const r = box(a); return { w: r.width, h: r.height, radius: getComputedStyle(a).borderTopLeftRadius, text: a.textContent }; }),
              step3: document.querySelector('[data-i18n="home.step3.text"]').textContent,
            };
          });
          // 3. The size or pack on its own line under the price, at the start side, small and grey, its words as before.
          assert.ok(m.packs.length >= 6, `${where}: cards with a size (${m.packs.length})`);
          for (const p of m.packs) {
            assert.ok(p.below, `${where} ${p.id}: "${p.text}" under the price`);
            assert.ok(p.start <= 1, `${where} ${p.id}: lined up with the price (${p.start})`);
            assert.strictEqual(p.size, '12.5px', `${where} ${p.id}`);
            assert.strictEqual(p.color, 'rgb(95, 99, 104)', `${where} ${p.id}: grey`);
          }
          assert.strictEqual(m.grid.bizcards, lang === 'ar' ? '١٠٠ كارت' : '100 cards', `${where}: the words of the size unchanged`);
          assert.strictEqual(m.grid.flyers, lang === 'ar' ? 'A5 × ١٠٠' : 'A5 × 100', `${where}: the words of the size unchanged`);
          // 5. Five rows in the agreed order; "How it works" right after the points, compact.
          assert.deepStrictEqual(m.rows, ['row:fresh', 'row:wear', 'row:gifts', 'row:cards', 'row:biz'], where);
          assert.ok(m.howAfterStrip, `${where}: "How it works" right after the points, before the picture tiles`);
          assert.ok(m.howH < 450, `${where}: the three steps compact (${m.howH}px; 536 to 603 before)`);
          assert.ok(m.stepText >= 13, `${where}: the steps readable (${m.stepText}px)`);
          if (mode === 'on') assert.strictEqual(codOn(m.step3), null, `${where}: step 3 in the prepay words: ${m.step3}`);
          else assert.ok(codOn(m.step3), `${where}: step 3 as today`);
          // 6a. "See all": four pills, at least 44 px tall.
          assert.strictEqual(m.more.length, 4, `${where}: "See all" next to four rows`);
          for (const a of m.more) {
            assert.ok(a.h >= 44 && a.w >= 44, `${where} "${a.text}": ${a.w}x${a.h}`);
            assert.strictEqual(a.text, lang === 'ar' ? 'شوف الكل' : 'See all');
            assert.ok(parseFloat(a.radius) >= 20, `${where}: a pill (${a.radius})`);
          }
          assert.ok(await noSideScroll(page), `${where}: no sideways scroll`);
          assert.deepStrictEqual(page.errors, [], where);
        } finally {
          await ctx.close();
        }
      }
    }
  }
  // The rows that went: their products are still in "All products" (by category).
  const ctx = await context('en', PHONES()[0][1]);
  try {
    for (const cat of ['laser', 'home', 'occasions']) {
      const page = await home(ctx, off, `/?cat=${cat}#products`);
      assert.ok(await page.locator('.hm-gcard').count() > 0, `${cat}: its products are listed`);
      await page.close();
    }
  } finally {
    await ctx.close();
  }
});

test('6b. kids\' books: the buttons line up at the bottom of the cards when a name wraps', { timeout: 120000 }, async () => {
  for (const [devName, dev] of PHONES()) {
    for (const lang of ['ar', 'en']) {
      const where = `${lang} ${devName}`;
      const ctx = await context(lang, dev);
      try {
        const page = await home(ctx, off, '/?cat=kids#products');
        const cards = await page.evaluate(() => [...document.querySelectorAll('.hm-gcard')].map((c) => ({
          title: Math.round(c.querySelector('h3').getBoundingClientRect().height),
          top: Math.round(c.getBoundingClientRect().top),
          start: c.querySelector('.hm-gstart').getBoundingClientRect().top,
          details: c.querySelector('.hm-gdetails').getBoundingClientRect().bottom,
          bottom: c.getBoundingClientRect().bottom,
        })));
        assert.ok(cards.length >= 2, `${where}: two books`);
        const byRow = {};
        for (const c of cards) (byRow[c.top] = byRow[c.top] || []).push(c);
        let wrapped = false;
        for (const row of Object.values(byRow)) {
          if (row.length < 2) continue;
          if (new Set(row.map((c) => c.title)).size > 1) wrapped = true;
          for (const c of row) {
            assert.ok(Math.abs(c.start - row[0].start) <= 1, `${where}: "Start" level (${row.map((x) => x.start)})`);
            assert.ok(Math.abs(c.details - c.bottom) <= 1, `${where}: "Details" at the card's bottom`);
          }
        }
        if (devName === 'Pixel 7' && lang === 'ar') assert.ok(wrapped, `${where}: a name wraps (the case this is for)`);
        assert.ok(await noSideScroll(page), where);
      } finally {
        await ctx.close();
      }
    }
  }
});

test('6c. every page with the shared header downloads only its language\'s logo; switching shows the other at once', { timeout: 240000 }, async () => {
  // The markup: no logo has an address in the page itself (the line after them gives it), no hidden mark logo.
  const pub = path.join(__dirname, '../../public');
  const withHeader = fs.readdirSync(pub).filter((f) => f.endsWith('.html') && fs.readFileSync(path.join(pub, f), 'utf8').includes('class="brand"'));
  assert.ok(withHeader.length >= 18, withHeader.join());
  for (const f of withHeader) {
    const html = fs.readFileSync(path.join(pub, f), 'utf8');
    const brand = html.slice(html.indexOf('<a class="brand"'), html.indexOf('</a>', html.indexOf('<a class="brand"')));
    assert.doesNotMatch(brand, / src=/, `${f}: no logo address in the markup`);
    assert.doesNotMatch(brand, /logo-mark-header/, `${f}: no hidden mark logo`);
    assert.match(html, /<\/a><script>\(function\(\)\{var l=document\.documentElement\.lang==='en'\?'en':'ar';/, `${f}: the line that gives the logo its address`);
  }
  const PAGES = ['/', '/cart', '/designs', '/account', '/product?id=tshirt', '/photos', '/privacy', '/rights', '/no-such-page'];
  for (const [devName, dev] of [PHONES()[0], ['computer', DESKTOP]]) {
    for (const lang of ['ar', 'en']) {
      const other = lang === 'ar' ? 'en' : 'ar';
      const ctx = await context(lang, dev);
      try {
        for (const url of PAGES) {
          const where = `${lang} ${devName} ${url}`;
          const page = await ctx.newPage();
          const logos = [];
          page.on('request', (r) => { const m = /\/img\/(logo-[a-z-]+)\.svg/.exec(r.url()); if (m) logos.push(m[1]); });
          await page.goto(off.base + url, { waitUntil: 'networkidle' });
          await page.waitForSelector('.footer-logo img', { state: 'attached', timeout: 30000 });
          assert.deepStrictEqual([...new Set(logos)].sort(), [`logo-${lang}-header`, `logo-${lang}-white`], `${where}: only the ${lang} logos`);
          const shown = () => [...document.querySelectorAll('.site-header .brand-logo, .footer-logo img')].filter((i) => i.getClientRects().length > 0).map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }));
          let s = await page.evaluate(shown);
          assert.deepStrictEqual(s, [{ src: `/img/logo-${lang}-header.svg`, ok: true }, { src: `/img/logo-${lang}-white.svg`, ok: true }], where);
          if (url === '/' || url === '/cart' || devName === 'computer') {
            // Switching language: the other logo, loaded, in the header and the footer.
            await page.click('.site-header .inner [data-lang-toggle]');
            await page.waitForFunction((l) => document.documentElement.lang === l, other);
            await page.waitForFunction(() => [...document.querySelectorAll('.site-header .brand-logo, .footer-logo img')].filter((i) => i.getClientRects().length > 0).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 });
            s = await page.evaluate(shown);
            assert.deepStrictEqual(s, [{ src: `/img/logo-${other}-header.svg`, ok: true }, { src: `/img/logo-${other}-white.svg`, ok: true }], `${where}: after switching`);
          }
          if (devName !== 'computer') assert.ok(await noSideScroll(page), `${where}: no sideways scroll`);
          await page.close();
        }
      } finally {
        await ctx.close();
      }
    }
  }
});
