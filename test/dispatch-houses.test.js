'use strict';

// Printing houses: WhatsApp numbers wa.me can open, and the "sample first" request in the job message.
const test = require('node:test');
const assert = require('node:assert');
const dispatch = require('../src/dispatch');

test('Egyptian mobiles become 20XXXXXXXXXX however they are written', () => {
  for (const v of ['01001234567', '1001234567', '+201001234567', '+20 100 123 4567', '+20 010 0123 4567', '00201001234567', '0020 10 0123 4567', '201001234567', '010-0123-4567', '(010) 0123 4567', '٠١٠٠١٢٣٤٥٦٧', '۰۱۰۰۱۲۳۴۵۶۷', '‎+20 100 123 4567‏']) {
    assert.strictEqual(dispatch.whatsappDigits(v), '201001234567', v);
  }
  assert.strictEqual(dispatch.whatsappDigits('1112345678'), '201112345678');
  assert.strictEqual(dispatch.whatsappDigits('01212345678'), '201212345678');
  assert.strictEqual(dispatch.whatsappDigits('1512345678'), '201512345678');
});

test('numbers abroad keep their country code; landlines and numbers without a country code are refused', () => {
  assert.strictEqual(dispatch.whatsappDigits('+971 50 123 4567'), '971501234567');
  assert.strictEqual(dispatch.whatsappDigits('00966 50 123 4567'), '966501234567');
  assert.strictEqual(dispatch.whatsappDigits('+44 7700 900123'), '447700900123');
  assert.strictEqual(dispatch.whatsappDigits('+1 212 555 1234'), '12125551234');
  assert.strictEqual(dispatch.whatsappDigits(''), '');
  assert.strictEqual(dispatch.whatsappDigits('   '), '');
  // Egyptian landlines (Cairo 02, Alexandria 03, …), in every form.
  for (const v of ['0225551234', '02 2555 1234', '034812345', '+20 2 2555 1234', '0020225551234', '20225551234', '+20 0225551234']) {
    assert.strictEqual(dispatch.whatsappDigits(v), null, v);
  }
  // A digit missing / extra, a local number without its country code, other networks' prefixes, letters.
  for (const v of ['0100123456', '010012345678', '01312345678', '2125551234', '5012345', '0501234567', 'abc', '+20 100 123 456']) {
    assert.strictEqual(dispatch.whatsappDigits(v), null, v);
  }
});

test('the printing-house form refuses a landline and saves a mobile without its 0', () => {
  assert.deepStrictEqual(dispatch.cleanHouse({ name: 'X', whatsapp: '0225551234' }), { error: 'houseWhatsApp' });
  const { house } = dispatch.cleanHouse({ name: 'X', whatsapp: '1001234567', prefer: 'whatsapp' });
  assert.strictEqual(house.whatsapp, '201001234567');
  assert.strictEqual(house.prefer, 'whatsapp');
});

test('a "sample first" item says so in the WhatsApp and email messages, in both languages', () => {
  const n = (en, ar) => ({ en, ar });
  const item = { position: 1, productName: n('Polo', 'بولو'), process: 'dtf', copies: 40, approval: { proofHash: 'x', sample: true } };
  const args = { house: { name: 'X' }, design: { sides: [] }, files: [{ label: 'PDF', url: 'https://x/dl/1', name: 'a.pdf' }], expires: '2026-12-24T00:00:00Z', order: { number: 'POD-1', items: [{}] } };
  const waEn = dispatch.whatsappText({ ...args, item, lang: 'en' });
  const waAr = dispatch.whatsappText({ ...args, item, lang: 'ar' });
  assert.match(waEn, /\*🧪 Sample first: print ONE piece first and send us a photo of it\. Print the rest only after we confirm\.\*/);
  assert.match(waAr, /\*🧪 عينة الأول: اطبعوا قطعة واحدة بس الأول وابعتولنا صورتها/);
  const mailEn = dispatch.emailBody({ ...args, item, lang: 'en', attached: false });
  const mailAr = dispatch.emailBody({ ...args, item, lang: 'ar', attached: false });
  assert.match(mailEn.text, /Sample first: print ONE piece first/);
  assert.match(mailEn.html, /Sample first: print ONE piece first/);
  assert.match(mailAr.text, /عينة الأول/);
  assert.match(mailAr.html, /عينة الأول/);
  // The same field as the admin's item list carries; nothing for an ordinary item.
  assert.match(dispatch.whatsappText({ ...args, item: { ...item, approval: null, sample: true }, lang: 'en' }), /Sample first/);
  for (const plain of [{ ...item, approval: { proofHash: 'x', sample: false } }, { ...item, approval: null }]) {
    assert.doesNotMatch(dispatch.whatsappText({ ...args, item: plain, lang: 'en' }) + dispatch.emailBody({ ...args, item: plain, lang: 'ar', attached: false }).html, /Sample first|عينة الأول/);
  }
});
