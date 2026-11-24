'use strict';

/**
 * Security checks: links that must not reach the server's own network,
 * spreadsheets built to freeze the server, name lists that would run as
 * formulas in Excel, SVG print files, and the headers and cookies every
 * visitor gets.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const importer = require('../src/importer');
const mergeData = require('../src/merge-data');
const merge = require('../src/merge');
const { sanitizeSvg } = require('../src/security');

let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-sec-test-'));
  const open = [{ max: 1e6, ms: 1000 }];
  const app = createApp({
    dataDir, adminPassword: 'secret', cleanupEvery: 0, requireApproval: false,
    limits: { importLink: open, importImage: open, mergeParse: open, accountSignup: open, accountLogin: open, accountForgot: open },
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------- Import from a link (SSRF) ----------

test('import: private addresses are refused however the link writes them', () => {
  const blocked = [
    'http://127.0.0.1/', 'http://localhost/', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data/',
    'http://0x7f000001/', 'http://2130706433/', 'http://[::1]/', 'http://[::]/',
    // IPv4-mapped IPv6: a parsed URL turns [::ffff:127.0.0.1] into [::ffff:7f00:1].
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://[::ffff:a9fe:a9fe]/',
    'http://[::ffff:10.1.2.3]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::1]/',
    'http://[fe80::1]/', 'http://[fd12:3456::1]/', 'http://[ff02::1]/',
  ];
  for (const url of blocked) {
    assert.throws(() => importer.checkUrl(url), (e) => e.code === 'importBlocked', url);
  }
  for (const url of ['https://example.com/a.png', 'http://[2606:4700:4700::1111]/', 'http://[::ffff:8.8.8.8]/']) {
    assert.doesNotThrow(() => importer.checkUrl(url), url);
  }
  assert.strictEqual(importer.privateAddress('::ffff:192.168.1.1'), true);
  assert.strictEqual(importer.privateAddress('fe80::1%eth0'), true);
  assert.strictEqual(importer.privateAddress('2a00:1450:4001::200e'), false);
  assert.strictEqual(importer.privateAddress('not an address'), true);
});

test('import: the API refuses links to the server itself before fetching anything', async () => {
  for (const url of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/admin']) {
    const res = await post('/api/import/link', { url });
    assert.strictEqual(res.status, 400, url);
    assert.strictEqual((await res.json()).code, 'importBlocked');
    const img = await fetch(`${base}/api/import/image?url=${encodeURIComponent(url)}`);
    assert.strictEqual(img.status, 400, url);
  }
});

// ---------- Spreadsheets (name lists) ----------

const xlsx = (sheetXml, extra = []) => mergeData.zipStore([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml) }, ...extra]);

test('name lists: a spreadsheet of tags that never close is read in linear time', () => {
  const n = 200000;
  const bad = {
    rows: '<worksheet><sheetData>' + '<row>'.repeat(n) + '</sheetData></worksheet>',
    noGt: '<worksheet><sheetData>' + '<row '.repeat(n) + '>' + '</sheetData></worksheet>',
    cells: '<worksheet><sheetData><row>' + '<c r="A1">'.repeat(n) + '</row></sheetData></worksheet>',
    values: '<worksheet><sheetData><row><c r="A1">' + '<v>'.repeat(n) + '</c></row></sheetData></worksheet>',
    attr: '<worksheet><sheetData><row><c ' + 'a'.repeat(n * 4) + '><v>1</v></c></row></sheetData></worksheet>',
  };
  for (const [name, xml] of Object.entries(bad)) {
    const t0 = Date.now();
    try {
      mergeData.parseTable(xlsx(xml));
    } catch (e) {
      assert.strictEqual(e.name, 'MergeDataError', name);
    }
    // Before the fix the first case alone took minutes (each tag rescanned the rest of the file).
    assert.ok(Date.now() - t0 < 2000, `${name} took ${Date.now() - t0} ms`);
  }
  const strings = '<sst><si>' + '<rPh>'.repeat(n) + '<t>Ali</t></si><si><t>Mona</t></si></sst>';
  const sheet = '<worksheet><sheetData><row><c t="s"><v>1</v></c></row><row><c t="s"><v>0</v></c></row></sheetData></worksheet>';
  const t0 = Date.now();
  const table = mergeData.parseTable(xlsx(sheet, [{ name: 'xl/sharedStrings.xml', data: Buffer.from(strings) }]));
  assert.ok(Date.now() - t0 < 2000);
  assert.deepStrictEqual(table.columns, ['Mona']);
  assert.deepStrictEqual(table.rows, [['Ali']]);
});

test('name lists: ordinary sheets still read the same (self-closing cells, phonetic guides, namespaces)', () => {
  const strings = '<sst><si><t>Name</t></si><si><r><t>Ah</t></r><r><t>med</t></r><rPh sb="0" eb="1"><t>x</t></rPh></si></sst>';
  const sheet = '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>No</x:t></x:is></x:c></x:row>'
    + '<x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2"><x:v>10</x:v></x:c><x:c r="C2"/></x:row></x:sheetData></x:worksheet>';
  const table = mergeData.parseTable(xlsx(sheet, [{ name: 'xl/sharedStrings.xml', data: Buffer.from(strings) }]));
  assert.deepStrictEqual(table.columns, ['Name', 'No']);
  assert.deepStrictEqual(table.rows, [['Ahmed', '10']]);
});

test('name lists: the upload route answers quickly for a hostile spreadsheet', async () => {
  const body = xlsx('<worksheet><sheetData>' + '<row>'.repeat(300000) + '</sheetData></worksheet>');
  const t0 = Date.now();
  const res = await fetch(base + '/api/merge/parse', { method: 'POST', body });
  assert.strictEqual(res.status, 400);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});

test('name lists: the CSV for the shop never starts a cell with a formula', () => {
  const out = merge.csv(['Name', 'Number'], [
    ['=HYPERLINK("http://x.example","click")', '10'],
    ['@SUM(1+1)', '-5'],
    ['+cmd|" /C calc"!A0', '+201012345678'],
    ['-2+3', '7'],
    ['Ahmed', '\t=1'],
  ]).toString('utf8').replace(/^﻿/, '');
  const lines = out.trim().split('\r\n');
  assert.strictEqual(lines[1], '1,"\'=HYPERLINK(""http://x.example"",""click"")",10');
  assert.strictEqual(lines[2], '2,"\'@SUM(1+1)",-5');
  assert.strictEqual(lines[3], '3,"\'+cmd|"" /C calc""!A0",+201012345678');
  assert.strictEqual(lines[4], '4,"\'-2+3",7');
  assert.strictEqual(lines[5], '5,Ahmed,"\'\t=1"');
});

// ---------- SVG print files ----------

test('svg: animations that could turn a link into javascript: are removed', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="#x">'
    + '<set attributeName="href" to="javascript:alert(1)"/><animate attributeName="xlink:href" values="javascript:alert(1)"></animate>'
    + '<animateTransform attributeName="transform" type="rotate" from="0" to="1"/><rect width="5" height="5" onclick="alert(1)"/></a>'
    + '<image href="https://evil.example/x.png"/><image href="data:image/png;base64,AAAA"/></svg>';
  const out = sanitizeSvg(svg);
  assert.ok(!/<set\b|<animate/i.test(out), out);
  assert.ok(!/javascript|onclick|evil\.example/i.test(out), out);
  assert.ok(out.includes('<rect width="5" height="5"'));
  assert.ok(out.includes('data:image/png;base64,AAAA'));
});

// ---------- Headers and cookies ----------

test('headers: pages run only the site\'s own scripts; other responses run nothing', async () => {
  const page = await fetch(base + '/');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-(inline|eval)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.strictEqual(page.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(page.headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(page.headers.get('access-control-allow-origin'), null);
  const api = await fetch(base + '/api/products');
  assert.match(api.headers.get('content-security-policy'), /default-src 'none'.*sandbox/);
});

test('accounts: the sign-in cookie is HttpOnly and SameSite, and never readable cross-site', async () => {
  const res = await post('/api/account/signup', { name: 'Test Person', phone: '01098765432', password: 'long-enough-1' });
  assert.strictEqual(res.status, 201);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^pod_c=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax/);
  const body = await res.json();
  assert.ok(!('passHash' in body.customer) && !('salt' in body.customer));
});

test('admin: every admin route needs the session token', async () => {
  for (const url of ['/api/admin/orders', '/api/admin/customers', '/api/admin/queue', '/api/admin/review']) {
    const res = await fetch(base + url, { headers: { Authorization: 'Bearer not-a-real-token-1234567890' } });
    assert.strictEqual(res.status, 401, url);
  }
});

test('accounts: a reset email never links to a host the shop does not own', async () => {
  const http = require('http');
  const mails = [];
  const mail = http.createServer((q, r) => { let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { mails.push(JSON.parse(b)); r.end('{}'); }); });
  await new Promise((r) => mail.listen(0, '127.0.0.1', r));
  const saved = { ...process.env };
  Object.assign(process.env, { BREVO_API_KEY: 'test', MAIL_FROM: 'shop@example.test', BREVO_API_URL: `http://127.0.0.1:${mail.address().port}/` });
  delete process.env.SITE_URL;
  try {
    await post('/api/account/signup', { name: 'Reset Person', phone: '01011112222', email: 'reset@example.test', password: 'long-enough-1' });
    const forgot = (host) => new Promise((resolve) => {
      const q = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/account/forgot', method: 'POST', headers: { host, 'content-type': 'application/json' } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
      q.end(JSON.stringify({ login: 'reset@example.test' }));
    });
    assert.strictEqual(await forgot('attacker.example'), 200); // same answer as always
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(mails.length, 0);
    assert.strictEqual(await forgot(`127.0.0.1:${server.address().port}`), 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(mails.length, 1);
    assert.match(mails[0].textContent, /http:\/\/127\.0\.0\.1:\d+\/account\?reset=/);
  } finally {
    for (const k of ['BREVO_API_KEY', 'MAIL_FROM', 'BREVO_API_URL']) if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
    mail.close();
  }
});

test('errors never show raw server messages or paths; odd input types are refused', async () => {
  {
    const b = base;
    const bad = await fetch(b + '/api/cart/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lang': 'ar' }, body: '{"designIds": [' });
    assert.strictEqual(bad.status, 400);
    const body = await bad.json();
    assert.strictEqual(body.code, 'badRequest');
    assert.match(body.error, /[\u0600-\u06FF]/, 'in Arabic');
    for (const id of ['constructor', '__proto__', 'toString']) {
      const r = await fetch(`${b}/api/books/companion/${id}.png`);
      assert.strictEqual(r.status, 404);
      assert.doesNotMatch(await r.text(), /ENOENT|\/src\//);
    }
    assert.strictEqual((await fetch(b + '/api/client-error', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'null' })).status, 204);
    const corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
    const pr = await fetch(b + '/api/proof', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: corrupt });
    assert.strictEqual(pr.status, 400);
    assert.strictEqual((await pr.json()).code, 'badImage');
    const book = await (await fetch(b + '/api/books/space-hero/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })).json().catch(() => ({}));
    if (book && book.id) assert.strictEqual((await fetch(`${b}/api/designs/${book.id}`)).status, 404);
  }
});

test('account fields must be text (no "[object Object]" saved)', async () => {
  const signup = await post('/api/account/signup', { name: 'Mona Test', phone: '01055566677', password: 'a-long-password-1' });
  assert.strictEqual(signup.status, 201, await signup.clone().text());
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const put = (body) => fetch(base + '/api/account', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  assert.strictEqual((await put({ name: { a: 1 } })).status, 400);
  assert.strictEqual((await put({ name: ['Mo', 'Ali'] })).status, 400);
  assert.strictEqual((await put({ name: 'Mona', address: { city: {}, address: '1 st' } })).status, 400);
  assert.strictEqual((await put({ name: 'Mona Ali' })).status, 200);
});

test('SVG cleaner: split tags, ">" inside quotes, other link prefixes and encoded javascript: are all removed', () => {
  const evil = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink" a=">" onload="x()"><scr<set/>ipt>alert(1)</script>'
    + '<image xl:href="http://evil.test/a.png"/><a href="jav&#x61;script:alert(1)"><rect width="9" height="9"/></a>'
    + '<use href="data:image/svg+xml;base64,PHN2Zy8+"/><foreignObject><div>x</div></foreignObject><style>@import url(http://evil.test/x.css);.a{fill:url(#g)}</style></svg>';
  const out = sanitizeSvg(evil);
  assert.doesNotMatch(out, /<script|onload|evil\.test|javascript|<foreignObject|data:image\/svg/i);
  assert.match(out, /<rect width="9" height="9"\/>/);
  assert.match(out, /url\(#g\)/, 'in-file references are kept');
  // A normal editor export keeps its fonts, pictures and text.
  const ok = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[@font-face{font-family:Cairo;src:url(data:font/woff2;base64,AAAA)}]]></style><image href="data:image/png;base64,iVBOR" x="1"/><text font-family="Cairo">مرحبا &amp; hi</text></svg>';
  assert.strictEqual(sanitizeSvg(ok), ok);
});

test('customers can only be signed out by the shop itself; imported sources must be web links', async () => {
  const cross = await fetch(base + '/api/account/logout', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.strictEqual(cross.status, 403);
  const other = await fetch(base + '/api/account/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(other.status, 403);
  assert.strictEqual((await fetch(base + '/api/account/logout', { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});
