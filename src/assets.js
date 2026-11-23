'use strict';

/**
 * The editor's library: tens of thousands of icons and colourful stickers
 * from open-licence sets (all fine to print on products that are sold),
 * searchable in Arabic and English.
 *
 *   Fluent Emoji Flat (Microsoft, MIT)       colourful stickers
 *   Tabler Icons (MIT), Phosphor (MIT),
 *   Lucide (ISC), Material Design Icons (Apache-2.0)   one-colour icons
 *
 * The sets come from npm (@iconify-json/*). They are read the first time the
 * library is used and kept in memory (about 25,000 small SVGs).
 */
const { AR, EN } = require('./asset-words');

const SETS = [
  { prefix: 'fluent-emoji-flat', kind: 'sticker', name: 'Fluent Emoji', license: 'MIT' },
  { prefix: 'tabler', kind: 'icon', name: 'Tabler Icons', license: 'MIT' },
  { prefix: 'ph', kind: 'icon', name: 'Phosphor', license: 'MIT', keep: (n) => !/-(bold|duotone|light|thin)$/.test(n) },
  { prefix: 'lucide', kind: 'icon', name: 'Lucide', license: 'ISC' },
  { prefix: 'mdi', kind: 'icon', name: 'Material Design Icons', license: 'Apache-2.0' },
];

/** Arabic spelling differences that should not matter when searching. */
function normAr(s) {
  return String(s || '')
    .replace(/[ً-ٰٟـ]/g, '') // diacritics, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .trim();
}
const ARABIC = /[؀-ۿ]/;
const AR_INDEX = new Map(Object.entries(AR).map(([k, v]) => [normAr(k), v.split(/\s+/)]));

let entries = null;
function load() {
  if (entries) return entries;
  entries = [];
  for (const set of SETS) {
    let data;
    try {
      data = require(`@iconify-json/${set.prefix}/icons.json`);
    } catch (e) {
      console.warn(`[library] icon set ${set.prefix} is not installed`);
      continue;
    }
    for (const [name, icon] of Object.entries(data.icons)) {
      if (icon.hidden || (set.keep && !set.keep(name))) continue;
      entries.push({
        id: `${set.prefix}:${name}`,
        set,
        name,
        body: icon.body,
        w: icon.width || data.width || 16,
        h: icon.height || data.height || 16,
        words: name.toLowerCase().split('-').filter(Boolean),
      });
    }
  }
  return entries;
}

/**
 * The words to look for: each typed word becomes a list of alternatives
 * (Arabic words through the dictionary, English words with their synonyms).
 * Arabic phrases ("كرة قدم") are tried as a whole first.
 */
function queryTerms(q) {
  const text = normAr(String(q || '').toLowerCase()).replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!text) return [];
  if (ARABIC.test(text) && AR_INDEX.has(text)) return [{ alts: AR_INDEX.get(text), exact: true }];
  const terms = [];
  for (const raw of text.split(' ')) {
    if (ARABIC.test(raw)) {
      const alts = AR_INDEX.get(raw) || AR_INDEX.get(raw.replace(/^ال/, '')) || AR_INDEX.get(raw.replace(/^(ب|و|ل)ال/, '')) || AR_INDEX.get(raw.replace(/(ات|ين|ه)$/, ''));
      if (alts) terms.push({ alts, exact: true });
      continue; // an Arabic word we don't know is skipped
    }
    const w = raw.replace(/s$/, '').length >= 3 ? raw.replace(/(ies)$/, 'y').replace(/(?<=[^s])s$/, '') : raw;
    terms.push({ alts: [w, ...(EN[w] ? EN[w].split(' ') : [])], exact: false });
  }
  return terms;
}

function scoreWord(words, name, alt, exact) {
  let best = 0;
  for (const w of words) {
    if (w === alt) return 3;
    if (alt.length >= 3 && w.startsWith(alt)) best = Math.max(best, 2);
  }
  // Inside a longer word ("cupcake" for "cake") only for what was typed in English.
  if (!best && !exact && alt.length >= 4 && name.includes(alt)) best = 1;
  return best;
}

// Shown before anything is typed: a friendly mix.
const POPULAR = ['fluent-emoji-flat:red-heart', 'fluent-emoji-flat:star', 'fluent-emoji-flat:crown', 'fluent-emoji-flat:crescent-moon', 'fluent-emoji-flat:birthday-cake', 'fluent-emoji-flat:soccer-ball', 'fluent-emoji-flat:party-popper', 'fluent-emoji-flat:wrapped-gift', 'fluent-emoji-flat:hot-beverage', 'fluent-emoji-flat:rocket', 'fluent-emoji-flat:cat-face', 'fluent-emoji-flat:sun', 'fluent-emoji-flat:rainbow', 'fluent-emoji-flat:butterfly', 'fluent-emoji-flat:balloon', 'fluent-emoji-flat:smiling-face-with-sunglasses', 'tabler:heart', 'tabler:star', 'tabler:crown', 'tabler:moon-stars', 'ph:coffee', 'lucide:sparkles', 'mdi:mosque', 'tabler:ball-football', 'ph:paw-print', 'tabler:music', 'lucide:plane', 'mdi:pyramid', 'tabler:flower', 'ph:lightning-fill'];

/**
 * Search: { items: [{ id, kind, w, h, body }], more, total }.
 * type: 'all' | 'sticker' | 'icon'.
 */
function search(q, { type = 'all', page = 0, per = 60 } = {}) {
  const all = load();
  const pool = type === 'all' ? all : all.filter((e) => e.set.kind === type);
  let list;
  const terms = queryTerms(q);
  if (!String(q || '').trim()) {
    const byId = new Map(pool.map((e) => [e.id, e]));
    list = POPULAR.map((id) => byId.get(id)).filter(Boolean);
  } else if (!terms.length) {
    list = [];
  } else {
    const scored = [];
    for (const e of pool) {
      let total = 0;
      let ok = true;
      for (const { alts, exact } of terms) {
        // The best keyword, plus a little for every other keyword it also has
        // ("كورة" -> football soccer ball: the soccer ball beats a rice ball).
        let best = 0;
        let others = 0;
        for (let i = 0; i < alts.length; i++) {
          const raw = scoreWord(e.words, e.name, alts[i], exact);
          const sc = raw && i === 0 ? raw + 0.3 : raw; // the main meaning first
          const a = alts[i]; // eslint-disable-line no-unused-vars
          if (sc > best) {
            if (best >= 2) others++;
            best = sc;
          } else if (sc >= 2) others++;
        }
        if (!best) { ok = false; break; }
        total += best + 0.6 * others;
      }
      // "Not this" variants (crossed out) only when asked for.
      if (ok && (e.words.includes('off') || e.words.includes('slash')) && !terms.some((tm) => tm.alts.includes('off') || tm.alts.includes('slash'))) total -= 1.5;
      if (ok) scored.push([total, e]);
    }
    // Best matches first; colourful stickers before icons; shorter names (the plain one) first.
    scored.sort((a, b) => b[0] - a[0] || (a[1].set.kind === 'sticker' ? -1 : 0) - (b[1].set.kind === 'sticker' ? -1 : 0) || a[1].name.length - b[1].name.length);
    list = scored.map((x) => x[1]);
  }
  const start = Math.max(0, page) * per;
  return {
    total: list.length,
    more: start + per < list.length,
    items: list.slice(start, start + per).map((e) => ({ id: e.id, kind: e.set.kind, w: e.w, h: e.h, body: e.body })),
  };
}

const credits = () => SETS.map((s) => ({ name: s.name, license: s.license }));

module.exports = { search, queryTerms, normAr, credits, load };
