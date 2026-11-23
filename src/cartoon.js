'use strict';

/**
 * AI illustration for personalised books (Google Gemini image models through
 * the official @google/genai SDK).
 *
 *  - cartoonFace(): turns the child's photo into a face drawn in the book's
 *    style. One image per photo; used for every preview page.
 *  - redrawPage(): after an order, redraws one page so the child's head is
 *    painted naturally into the illustration (about 12-15 images per book).
 *
 * Off until GEMINI_API_KEY is set. GEMINI_IMAGE_MODEL picks the model and
 * GEMINI_API_BASE points the SDK at another endpoint (tests use a mock).
 */
const path = require('path');
const sharp = require('sharp');

const MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const enabled = () => Boolean(process.env.GEMINI_API_KEY);

// Keys from Google AI Studio ("AIza...") call the Gemini API. Some Google keys
// ("AQ....", e.g. Vertex AI express-mode keys) only work on Vertex AI, so a key
// the Gemini API rejects is tried once on Vertex AI and the one that works is
// remembered. GEMINI_VERTEX=1 / 0 forces one or the other.
let client = null;
let clientSig = null;
let useVertex = null; // null = not known yet
function vertexWanted() {
  if (process.env.GEMINI_VERTEX === '1') return true;
  if (process.env.GEMINI_VERTEX === '0') return false;
  return useVertex === true;
}
function ai() {
  const vertex = vertexWanted();
  const sig = `${process.env.GEMINI_API_KEY}|${vertex}`;
  if (!client || clientSig !== sig) {
    const { GoogleGenAI } = require('@google/genai');
    clientSig = sig;
    client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      ...(vertex ? { vertexai: true } : {}),
      ...(process.env.GEMINI_API_BASE ? { httpOptions: { baseUrl: process.env.GEMINI_API_BASE } } : {}),
    });
  }
  return client;
}
const keyRejected = (e) => {
  const status = e.status || e.code;
  return status === 401 || status === 403 || /api[_ ]?key|API_KEY_INVALID|UNAUTHENTICATED|PERMISSION_DENIED/i.test(String(e.message || ''));
};

class CartoonError extends Error {
  constructor(reason, message) {
    super(message || `Image model: ${reason}`);
    this.reason = reason;
  }
}

const jpeg = (buf, max = 1024) => sharp(buf).resize(max, max, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();

/** One image-generation request; returns the image bytes or throws CartoonError. */
async function generate({ prompt, images, aspectRatio = '1:1', imageSize = '1K', timeout = 120000 }) {
  if (!enabled()) throw new CartoonError('off', 'AI illustration is not set up');
  const parts = [{ text: prompt }];
  for (const img of images) parts.push({ inlineData: { mimeType: 'image/jpeg', data: (await jpeg(img)).toString('base64') } });
  const request = {
    model: MODEL(),
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize }, httpOptions: { timeout } },
  };
  let res;
  try {
    try {
      res = await ai().models.generateContent(request);
      if (useVertex === null) useVertex = vertexWanted();
    } catch (e) {
      const canSwitch = !process.env.GEMINI_VERTEX && useVertex === null && keyRejected(e);
      if (!canSwitch) throw e;
      useVertex = true; // try the same key on Vertex AI
      try {
        res = await ai().models.generateContent(request);
        console.log('[cartoon] GEMINI_API_KEY works on Vertex AI; using it from now on');
      } catch (e2) {
        useVertex = null; // neither worked; try both again next time
        if (keyRejected(e2)) console.warn(`[cartoon] key rejected by Gemini API (${e.message}) and Vertex AI (${e2.message})`);
        throw keyRejected(e2) ? e : e2;
      }
    }
  } catch (e) {
    const status = e.status || e.code;
    throw new CartoonError(status === 429 ? 'busy' : keyRejected(e) ? 'key' : 'failed', e.message);
  }
  const cand = res && res.candidates && res.candidates[0];
  const part = cand && cand.content && (cand.content.parts || []).find((p) => p.inlineData && p.inlineData.data);
  if (!part) {
    const reason = (cand && cand.finishReason) || (res && res.promptFeedback && res.promptFeedback.blockReason) || 'NO_IMAGE';
    throw new CartoonError(String(reason));
  }
  return Buffer.from(part.inlineData.data, 'base64');
}

const STYLE = {
  story: 'a warm, soft digital gouache children\'s picture book style with gentle textures, simple cute features, big friendly eyes and rosy cheeks',
  coloring: 'a children\'s colouring book style: clean, bold black outlines only, no shading, no grey, no colour fill, white background',
};

/**
 * The child's face drawn in the book's style, framed like the photo crop
 * (hairline to chin, 4:5). `styleRef` is an image of the book's art.
 */
async function cartoonFace(photo, styleRef, kind) {
  const prompt = [
    'Image 1 is a photo of a child. Image 2 shows the art style of a children\'s book.',
    `Draw this same child's face as a close-up portrait in ${STYLE[kind] || STYLE.story}, matching image 2.`,
    'Keep the child\'s real likeness: face shape, skin tone, eye shape and colour, eyebrows, nose, smile, hair colour and hairline, and a hijab or glasses if they wear one.',
    'Framing: the face fills the picture from the hairline at the top to the chin at the bottom, centred, looking straight at the viewer, with a plain light background.',
    'Do not add any text, letters, borders or other people.',
  ].join(' ');
  const out = await generate({ prompt, images: [photo, styleRef], aspectRatio: '3:4', imageSize: '1K' });
  // 3:4 from the model -> the 4:5 face frame the book pages use.
  return sharp(out).resize(720, 900, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer();
}

/**
 * Redraws one book page: `page` already has the child's face roughly placed
 * (so the model knows where and who); the model repaints the head naturally.
 */
async function redrawPage(page, face, kind) {
  const prompt = kind === 'coloring'
    ? [
      'Image 1 is a black-and-white colouring book page. The main child\'s face was pasted in and looks out of place.',
      'Redraw only that child\'s head (face and hair) with the same clean, bold black outlines as the rest of the page, so it looks like the child in image 2 (same face shape, eyes, smile and hairstyle).',
      'No shading, no grey, no colour. Keep the pose, hat or helmet, clothes, background, every other object, the line style and the composition exactly the same.',
      'Keep the bottom fifth of the page plain white. Do not add any text, letters or numbers.',
    ].join(' ')
    : [
      'Image 1 is a page of a children\'s picture book. The hero\'s face was pasted in and looks out of place.',
      'Redraw only the hero\'s head (face and hair) so it is painted naturally in exactly the same soft gouache style as the rest of the picture, looking like the child in image 2 (same face shape, skin tone, eyes, smile and hairstyle).',
      'Keep the pose, clothes, background, all other characters and objects, the colours and the composition exactly the same.',
      'Keep the bottom quarter of the picture as it is. Do not add any text, letters or numbers.',
    ].join(' ');
  return generate({ prompt, images: [page, face], aspectRatio: '1:1', imageSize: '2K', timeout: 180000 });
}

module.exports = { enabled, MODEL, cartoonFace, redrawPage, CartoonError, STYLE_REFS: { story: path.join(__dirname, 'book-assets', 'space', 'cover.jpg'), coloring: path.join(__dirname, 'book-assets', 'dreams', 'astronaut.png') } };
