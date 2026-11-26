'use strict';

// Review › Replace the child's photo on a kids' book (QA 26 Nov): the whole phone photo (head, body and room) was
// squeezed into the face oval. The dashboard now has the book page's crop step: the face is fitted into the oval
// (drag, arrow keys, zoom) and the 720 × 900 crop is what's sent and stored as face.jpg.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { loadPlaywright, startServer, newContext } = require('./helpers');

const CUSTOMER = { name: 'Salma Adel', phone: '01055556666', governorate: 'cairo', city: 'Maadi', address: '3 Street 9' };
const ANSWERS = { name: 'Yousef', gender: 'boy', birthday: '2019-03-12', city: 'Cairo', father: 'Ahmed', mother: 'Mona', fruit: 'mango', animal: 'cat', friend: 'Omar' };
const RED = { r: 211, g: 47, b: 47 };
const GREEN = { r: 31, g: 158, b: 74 };

/** A tall "phone photo": green background, a red circle (the face) in its upper part. */
function tallPhoto() {
  const W = 900;
  const H = 1600;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="rgb(${GREEN.r},${GREEN.g},${GREEN.b})"/>
    <circle cx="450" cy="480" r="230" fill="rgb(${RED.r},${RED.g},${RED.b})"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

/** Mean colour of a box of a decoded RGB(A) image. */
function meanOf(img, x0, y0, w, h) {
  const { data, info } = img;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * info.width + x) * info.channels;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
  }
  const n = w * h;
  return { r: r / n, g: g / n, b: b / n };
}
const isRed = (c) => c.r > 170 && c.g < 90 && c.b < 90;

test('Review › Replace the child\'s photo (kids\' book): the face is fitted into the oval and only that crop is stored', { timeout: 180000 }, async () => {
  const { chromium } = loadPlaywright();
  const srv = await startServer();
  const browser = await chromium.launch();
  const send = (method, url, body, headers = {}) => fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    // A book made and ordered by a customer (their own photo: a plain pink square).
    const pink = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#cc9999' } }).jpeg().toBuffer();
    const made = await send('POST', '/api/books/space-hero/designs', { answers: ANSWERS, face: `data:image/jpeg;base64,${pink.toString('base64')}` });
    assert.strictEqual(made.status, 201, await made.clone().text());
    const d = await made.json();
    const proof = await (await send('GET', `/api/designs/${d.id}/proof`)).json();
    const q = await (await send('POST', '/api/cart/quote', { designIds: [d.id] })).json();
    const ordered = await send('POST', '/api/orders', { customer: CUSTOMER, designIds: [d.id], expectedTotal: q.total, approvals: { [d.id]: { proofHash: proof.proofHash } } });
    assert.strictEqual(ordered.status, 201, await ordered.clone().text());
    const o = await ordered.json();
    const it = o.items[0];
    const owner = (await (await send('POST', '/api/admin/login', { password: 'secret' })).json()).token;
    if (it.status !== 'review') {
      const back = await send('POST', `/api/admin/items/${it.id}/review`, { action: 'reopen', note: 'The photo is too dark' }, { Authorization: `Bearer ${owner}` });
      assert.strictEqual(back.status, 200, await back.clone().text());
    }
    const faceFile = path.join(srv.dataDir, 'files', d.id, 'face.jpg');
    const faceBefore = fs.readFileSync(faceFile);

    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const confirms = [];
    page.on('dialog', (dl) => { confirms.push(dl.message()); dl.accept().catch(() => {}); });
    await page.goto(`${srv.base}/admin`);
    await page.fill('#password', 'secret');
    await page.click('#login button[type=submit]');
    await page.waitForSelector('#dash:not([hidden])');
    await page.click('[data-tab="review"]');
    await page.waitForSelector(`#rv-${it.id}`);
    await page.click(`[data-rv-toggle="${it.id}"]`);
    const input = `[data-rv-photo="${it.id}"][data-rv-n="face"]`;
    await page.waitForSelector(input, { state: 'attached' });
    await page.fill(`#rv-note-${it.id}`, 'A clearer photo of Yousef, from WhatsApp');
    const photo = { name: 'phone.jpg', mimeType: 'image/jpeg', buffer: await tallPhoto() };

    // A photo the browser can't open (HEIC on Chrome) can't be fitted: said, nothing sent.
    await page.setInputFiles(input, { name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('not really a photo') });
    await page.waitForFunction(() => document.body.innerText.includes('can\'t be opened here'));
    assert.strictEqual(await page.$('dialog.rv-crop-dlg'), null);
    assert.ok(fs.readFileSync(faceFile).equals(faceBefore));

    // Cancel: nothing is sent.
    await page.setInputFiles(input, photo);
    await page.waitForSelector('dialog.rv-crop-dlg[open]');
    assert.match(await page.textContent('dialog.rv-crop-dlg h3'), /Fit the child's face in the oval/);
    assert.match(await page.textContent('dialog.rv-crop-dlg'), /new proof \(version 2\)/);
    // The photo view has the keyboard first (arrow keys), and a name for screen readers.
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.matches('dialog.rv-crop-dlg canvas[aria-label]')));
    await page.click('dialog.rv-crop-dlg [data-crop-cancel]');
    await page.waitForSelector('dialog.rv-crop-dlg', { state: 'detached' });
    assert.ok(fs.readFileSync(faceFile).equals(faceBefore), 'cancelled: the book keeps its photo');

    // Again, fitting the face: zoom to 2.5 (the slider), drag the photo down, then two Shift+↓ (the arrow keys).
    // The dialog starts with the oval's centre at the photo's (450, 640), zoom 2. Zoom 2.5: 360 photo pixels across
    // the view; the drag moves it 88 photo pixels and each Shift+↓ 10% of the view (36): centre at (450, 480), the
    // circle's centre, where the whole oval box (242 × 302 photo pixels) is inside the circle (radius 230).
    await page.setInputFiles(input, photo);
    await page.waitForSelector('dialog.rv-crop-dlg[open]');
    await page.$eval('#rv-crop-zoom', (el) => { el.value = '2.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const box = await page.locator('dialog.rv-crop-dlg canvas').boundingBox();
    const perPhotoPx = box.width / 360; // screen pixels per photo pixel
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 44 * perPhotoPx, { steps: 4 });
    await page.mouse.move(cx, cy + 88 * perPhotoPx, { steps: 4 });
    await page.mouse.up();
    await page.focus('dialog.rv-crop-dlg canvas');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.click('dialog.rv-crop-dlg [data-crop-use]');
    await page.waitForSelector('dialog.rv-crop-dlg', { state: 'detached' });
    await page.waitForFunction(() => /version 2/i.test(document.body.innerText) && /New proof/.test(document.body.innerText), null, { timeout: 60000 });
    assert.deepStrictEqual(confirms, [], 'one step: the crop dialog says it goes to the customer (no second confirm)');

    // The stored face is the crop: 720 × 900, red (the circle) in the middle and in its corners, no green background.
    const face = await sharp(fs.readFileSync(faceFile)).raw().toBuffer({ resolveWithObject: true });
    assert.strictEqual(face.info.width, 720);
    assert.strictEqual(face.info.height, 900);
    const middle = meanOf(face, 180, 225, 360, 450);
    assert.ok(isRed(middle), `the middle is the face's colour, not the background: ${JSON.stringify(middle)}`);
    for (const [x, y] of [[10, 10], [670, 10], [10, 850], [670, 850]]) {
      const c = meanOf(face, x, y, 40, 40);
      assert.ok(isRed(c), `corner (${x}, ${y}) is inside the face circle too (the drag and the arrow keys moved it): ${JSON.stringify(c)}`);
    }
    // (What the old upload did, for contrast: the whole photo cut to 720 × 900 has green in its middle.)
    const whole = await sharp(photo.buffer).resize(720, 900, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });
    assert.ok(!isRed(meanOf(whole, 180, 225, 360, 450)));

    const pub = (await (await fetch(`${srv.base}/api/orders/${o.id}?k=${o.key}`)).json()).items[0];
    assert.strictEqual(pub.status, 'awaiting_approval');
    assert.strictEqual(pub.review.note, 'A clearer photo of Yousef, from WhatsApp');
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
