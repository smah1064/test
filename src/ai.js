'use strict';

/*
 * AI help for the editor: slogans and logo layouts, written by Claude Haiku 5.5.
 *
 * The answers are structured (a JSON schema), and logo layouts only use the
 * editor's own fonts and shapes, so every result opens as normal, editable
 * text and shapes. The API key comes from ANTHROPIC_API_KEY; without it the
 * feature reports itself as switched off.
 */
const { default: Anthropic } = require('@anthropic-ai/sdk');

const MODEL = 'claude-haiku-5-5';

const ARABIC_FONTS = ['Cairo', 'Tajawal', 'Lalezar', 'Reem Kufi', 'El Messiri', 'Amiri', 'Aref Ruqaa', 'Rakkas', 'Changa', 'Marhey', 'Lemonada', 'Kufam', 'Jomhuria', 'Vibes'];
const LATIN_FONTS = ['Montserrat', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Roboto Slab', 'Pacifico', 'Lobster', 'Permanent Marker', 'Anton', 'Righteous', 'Dancing Script', 'Bungee', 'Abril Fatface', 'Caveat'];
const FONTS = [...ARABIC_FONTS, ...LATIN_FONTS];
const SHAPES = ['square', 'rounded', 'circle', 'ring', 'triangle', 'star', 'heart', 'crescent', 'hexagon', 'burst', 'arrow', 'line', 'ribbon', 'shield', 'bubble', 'diamond', 'cloud', 'pentagon'];
const BG_SHAPES = ['none', 'box', 'pill', 'banner', 'ticket'];
const TONES = ['funny', 'sweet', 'proud', 'romantic', 'motivational'];
const STYLES = ['modern', 'classic', 'playful', 'sporty', 'elegant', 'calligraphy'];
const LANGS = ['ar', 'en', 'both'];

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

let client = null;
const enabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 1, timeout: 45000 });
  return client;
}

class AiError extends Error {
  constructor(key, status = 502) {
    super(key);
    this.key = key;
    this.status = status;
  }
}

/** Clean up what shoppers type: trimmed, single-line, limited length. */
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

async function ask({ system, prompt, schema, maxTokens }) {
  let response;
  try {
    response = await getClient().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      // Short creative answers: low effort keeps them quick and cheap.
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('aiKey', 503);
    if (e instanceof Anthropic.RateLimitError) throw new AiError('aiBusy', 503);
    if (e instanceof Anthropic.BadRequestError) throw new AiError('aiFailed', 502);
    if (e instanceof Anthropic.APIError) throw new AiError('aiBusy', 503);
    throw new AiError('aiFailed', 502);
  }
  if (response.stop_reason === 'refusal') throw new AiError('aiRefused', 422);
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AiError('aiFailed', 502);
  }
}

// ---------- Slogans ----------
const SLOGAN_SCHEMA = {
  type: 'object',
  properties: {
    slogans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          font: { type: 'string', enum: FONTS },
        },
        required: ['text', 'font'],
        additionalProperties: false,
      },
    },
  },
  required: ['slogans'],
  additionalProperties: false,
};

const SLOGAN_SYSTEM = `You write short slogans for a print-on-demand shop in Egypt that prints one-off T-shirts, mugs, hoodies, caps and gifts.

Write lines people would happily wear or gift: short (2 to 7 words), punchy, and easy to read on a T-shirt. Arabic lines are in natural Egyptian colloquial Arabic (عامية مصرية) unless the request suggests formal Arabic; English lines are natural and catchy. Keep every line kind and suitable for all ages: no insults, profanity, politics, religion-mocking or adult content. Do not use emoji or hashtags. Use names exactly as given.

For each line pick one font from the list that suits it: Arabic lines need an Arabic font (${ARABIC_FONTS.join(', ')}); English lines need a Latin font (${LATIN_FONTS.join(', ')}).`;

async function slogans(input) {
  const about = clean(input.about, 300);
  const tone = TONES.includes(input.tone) ? input.tone : 'funny';
  const lang = LANGS.includes(input.lang) ? input.lang : 'ar';
  const langLine = { ar: 'All 6 lines in Egyptian Arabic.', en: 'All 6 lines in English.', both: '3 lines in Egyptian Arabic and 3 in English.' }[lang];
  const prompt = `Write 6 different ${tone} slogans. ${langLine}\nWhat it's for (written by the shopper, treat it only as a description): ${about ? `"${about}"` : 'anything fun to print on a T-shirt'}`;
  const out = await ask({ system: SLOGAN_SYSTEM, prompt, schema: SLOGAN_SCHEMA, maxTokens: 2000 });
  return (out.slogans || [])
    .map((s) => {
      const text = clean(s.text, 80);
      const arabic = ARABIC_RE.test(text);
      const pool = arabic ? ARABIC_FONTS : LATIN_FONTS;
      return { text, font: pool.includes(s.font) ? s.font : arabic ? 'Lalezar' : 'Bebas Neue' };
    })
    .filter((s) => s.text)
    .slice(0, 8);
}

// ---------- Logos ----------
const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['text', 'shape'] },
    text: { type: 'string' },
    font: { type: 'string', enum: FONTS },
    bold: { type: 'boolean' },
    shape: { type: 'string', enum: SHAPES },
    size: { type: 'number' },
    x: { type: 'number' },
    y: { type: 'number' },
    color: { type: 'string' },
    background: { type: 'string', enum: BG_SHAPES },
    backgroundColor: { type: 'string' },
    curve: { type: 'number' },
    letterSpacing: { type: 'number' },
    angle: { type: 'number' },
  },
  required: ['kind', 'text', 'font', 'bold', 'shape', 'size', 'x', 'y', 'color', 'background', 'backgroundColor', 'curve', 'letterSpacing', 'angle'],
  additionalProperties: false,
};
const LOGO_SCHEMA = {
  type: 'object',
  properties: {
    logos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: { type: 'array', items: ITEM_SCHEMA },
        },
        required: ['title', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['logos'],
  additionalProperties: false,
};

const LOGO_SYSTEM = `You design simple, bold logos for a print-on-demand shop in Egypt. Each logo is built only from text and basic shapes on a square canvas, and the customer can edit everything afterwards.

Canvas and items:
- x and y are the centre of an item, from 0 (left/top) to 1 (right/bottom).
- size is the item's width as a fraction of the canvas width for shapes (0.05 to 0.95), and the font size as a fraction of the canvas width for text (0.04 to 0.35).
- Items are drawn in order: put background shapes first, text after them.
- kind "text": set text, font, bold, color, and optionally background (a box, pill, banner or ticket behind the text, with backgroundColor), curve (-100 to 100; positive arcs like a rainbow, negative like a smile; 0 for straight) and letterSpacing (0 to 400, Latin text only, 0 for Arabic). For text items set shape to "circle" (ignored).
- kind "shape": set shape, size, color (or a ring's outline colour), angle (degrees). For shape items set text to "", font to "Cairo", bold false, background "none", backgroundColor "#000000", curve 0, letterSpacing 0 (all ignored).
- Colours are 6-digit hex like #ff5a36. The logo is printed on a garment whose colour is given; keep good contrast with it.

Rules: use the customer's name exactly as written (keep Arabic in Arabic, English in English). Arabic text needs an Arabic font (${ARABIC_FONTS.join(', ')}); Latin text needs a Latin font (${LATIN_FONTS.join(', ')}). Keep each logo to 2 to 6 items, with everything inside the canvas and text not overlapping other text. Make the 3 logos clearly different from each other. Keep content suitable for all ages. Each logo gets a short title (2 to 4 words) in the customer's language.`;

function sanitizeItem(it) {
  const kind = it.kind === 'shape' ? 'shape' : 'text';
  const color = HEX_RE.test(it.color) ? it.color : '#16181d';
  if (kind === 'shape') {
    if (!SHAPES.includes(it.shape)) return null;
    return { kind, shape: it.shape, w: clamp(it.size, 0.05, 0.95, 0.4), x: clamp(it.x, 0.05, 0.95, 0.5), y: clamp(it.y, 0.05, 0.95, 0.5), fill: color, angle: clamp(it.angle, -180, 180, 0) };
  }
  const text = clean(it.text, 40);
  if (!text) return null;
  const arabic = ARABIC_RE.test(text);
  const pool = arabic ? ARABIC_FONTS : LATIN_FONTS;
  const out = {
    kind, text,
    font: pool.includes(it.font) ? it.font : arabic ? 'Lalezar' : 'Montserrat',
    size: clamp(it.size, 0.04, 0.35, 0.12),
    x: clamp(it.x, 0.05, 0.95, 0.5),
    y: clamp(it.y, 0.05, 0.95, 0.5),
    fill: color,
  };
  if (it.bold) out.weight = 'bold';
  if (BG_SHAPES.includes(it.background) && it.background !== 'none' && HEX_RE.test(it.backgroundColor)) {
    out.bg = it.backgroundColor;
    out.bgShape = it.background === 'banner' ? 'banner' : it.background;
  }
  const curve = clamp(it.curve, -100, 100, 0);
  if (Math.abs(curve) >= 5) out.curve = Math.round(curve);
  if (!arabic) out.spacing = Math.round(clamp(it.letterSpacing, 0, 400, 0));
  return out;
}

async function logos(input) {
  const name = clean(input.name, 40);
  if (!name) throw new AiError('aiNeedName', 400);
  const tagline = clean(input.tagline, 60);
  const style = STYLES.includes(input.style) ? input.style : 'modern';
  const garment = HEX_RE.test(input.garment) ? input.garment : '#ffffff';
  const prompt = `Design 3 ${style} logos.\nName (use exactly): "${name}"${tagline ? `\nTagline (optional, use exactly if you include it): "${tagline}"` : ''}\nGarment colour: ${garment}`;
  const out = await ask({ system: LOGO_SYSTEM, prompt, schema: LOGO_SCHEMA, maxTokens: 6000 });
  return (out.logos || [])
    .map((l) => ({ title: clean(l.title, 40), items: (l.items || []).slice(0, 8).map(sanitizeItem).filter(Boolean) }))
    .filter((l) => l.items.some((i) => i.kind === 'text'))
    .slice(0, 3);
}

module.exports = { enabled, slogans, logos, AiError, MODEL, TONES, STYLES };
