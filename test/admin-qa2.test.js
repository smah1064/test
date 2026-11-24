'use strict';

// Printing-house messages: print methods by name (not raw codes) and express orders marked.
const test = require('node:test');
const assert = require('node:assert');
const dispatch = require('../src/dispatch');

const n = (en, ar) => ({ en, ar });
const base = { position: 1, productName: n('Poster', 'بوستر'), color: { name: n('White', 'أبيض') }, size: { label: n('M', 'M') } };
const args = { house: { name: 'X' }, design: { sides: [] }, files: [], expires: '2026-12-24T00:00:00Z' };
const order = (delivery) => ({ number: 'POD-3001', items: [{}], ...(delivery ? { delivery } : {}) });

test('printing-house messages name the print method in the message language', () => {
  const cases = [
    ['paper', /Paper printing/, /طباعة على الورق/],
    ['sublimation', /Sublimation/, /تسامي/],
    ['dtg', /DTG/, /DTG/],
    ['dtf', /DTF/, /DTF/],
    ['uv', /UV printing/, /طباعة UV/],
    ['canvas', /Canvas printing/, /كانفاس/],
    ['textile', /Textile/, /أقمشة/],
  ];
  for (const [process, en, ar] of cases) {
    const item = { ...base, process };
    const msgEn = dispatch.whatsappText({ ...args, order: order(), item, lang: 'en' });
    const msgAr = dispatch.whatsappText({ ...args, order: order(), item, lang: 'ar' });
    assert.match(msgEn, new RegExp(`\\*Print method:\\* ${en.source}`), process);
    assert.match(msgAr, new RegExp(`\\*طريقة الطباعة:\\* .*${ar.source}`), process);
    assert.doesNotMatch(msgEn + msgAr, /\b(PAPER|SUBLIMATION|EMBROIDERY|CANVAS|TEXTILE)\b/);
  }
  const emb = dispatch.whatsappText({ ...args, order: order(), item: { ...base, process: 'embroidery', method: 'embroidery' }, lang: 'ar' });
  assert.match(emb, /\*طريقة الطباعة:\* تطريز/);
  const photos = dispatch.emailBody({ ...args, order: order(), item: { ...base, kind: 'photoset', process: 'paper' }, lang: 'en', attached: false });
  assert.match(photos.text, /Print method: Photo prints/);
});

test('express orders are marked in printing-house messages with the day, Arabic digits in Arabic', () => {
  const express = order({ speed: 'express', days: 2, fee: 50, by: '2026-11-26' });
  const item = { ...base, process: 'paper' };
  const en = dispatch.whatsappText({ ...args, order: express, item, lang: 'en' });
  assert.match(en, /⚡ Express order: the customer expects it by Thursday 26 November/);
  const ar = dispatch.whatsappText({ ...args, order: express, item, lang: 'ar' });
  assert.match(ar, /⚡ طلب سريع: لازم يوصل للعميل لحد .*٢٦/);
  assert.doesNotMatch(ar.replace('POD-3001', ''), /\d/);
  const mail = dispatch.emailBody({ ...args, order: express, item, lang: 'ar', attached: false });
  assert.match(mail.text, /⚡ طلب سريع/);
  assert.match(mail.html, /⚡ طلب سريع: لازم يوصل للعميل لحد/);
  // Standard delivery: no express line.
  const std = dispatch.whatsappText({ ...args, order: order({ speed: 'standard', days: 5, fee: 0, by: '2026-12-01' }), item, lang: 'en' });
  assert.doesNotMatch(std, /Express/);
  assert.doesNotMatch(dispatch.emailBody({ ...args, order: order(), item, lang: 'en' }).html, /Express/);
});
