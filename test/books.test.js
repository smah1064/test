'use strict';

// Kids books: answers are cleaned before they are printed.
const test = require('node:test');
const assert = require('node:assert');

test('book answers: invisible direction marks are removed and a name must be text', () => {
  const booksMod = require('../src/books');
  const book = booksMod.BOOKS['dream-jobs'];
  const base = {};
  for (const q of book.questions) if (q.required) base[q.id] = q.type === 'choice' ? q.options[0].id : q.type === 'date' ? '2020-01-01' : 'Laila';
  const nameQ = book.questions.find((q) => q.id === 'name');
  const out = booksMod.cleanAnswers(book, { ...base, name: 'x‏‮abc' });
  assert.strictEqual(out.name, 'xabc');
  assert.throws(() => booksMod.cleanAnswers(book, { ...base, name: { a: 1 } }));
  assert.ok(nameQ);
});

test('book names in any right-to-left script are refused (they would print backwards)', () => {
  const booksMod = require('../src/books');
  const book = booksMod.BOOKS['space-hero'];
  const base = {};
  for (const q of book.questions) if (q.required) base[q.id] = q.type === 'choice' ? q.options[0].id : q.type === 'date' ? '2020-01-01' : 'Laila';
  for (const name of ['שרה', 'سارة', 'ܫܪܐ']) assert.throws(() => booksMod.cleanAnswers(book, { ...base, name }), /bookLatin/, name);
  assert.strictEqual(booksMod.cleanAnswers(book, { ...base, name: 'Zoé' }).name, 'Zoé');
});
