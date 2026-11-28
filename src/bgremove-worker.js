'use strict';

// One background removal, in its own process (see bgremove.js): the photo is
// shrunk to the model's 1024 x 1024 input, the model returns how likely each
// pixel belongs to the subject, and that becomes the alpha channel of the
// full-size photo.
const sharp = require('sharp');

const SIZE = 1024;

process.once('message', async ({ model, image }) => {
  try {
    const ort = require('onnxruntime-node');
    const input = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    let src;
    try {
      // Upright (phone photos carry a rotation tag), no bigger than maxPx, solid pixels.
      src = sharp(input, { limitInputPixels: 120e6 }).rotate().resize(image.maxPx, image.maxPx, { fit: 'inside', withoutEnlargement: true });
      const meta = await src.clone().png().toBuffer({ resolveWithObject: true });
      src = { png: meta.data, w: meta.info.width, h: meta.info.height };
    } catch (e) {
      process.send({ bad: true, error: e.message }, () => process.exit(0));
      return;
    }
    const session = await ort.InferenceSession.create(model, { intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all', enableCpuMemArena: false });
    const { data } = await sharp(src.png).removeAlpha().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const x = new Float32Array(3 * SIZE * SIZE);
    const plane = SIZE * SIZE;
    for (let i = 0; i < plane; i++) {
      x[i] = data[i * 3] / 255 - 0.5;
      x[plane + i] = data[i * 3 + 1] / 255 - 0.5;
      x[2 * plane + i] = data[i * 3 + 2] / 255 - 0.5;
    }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, SIZE, SIZE]) });
    const pred = out[session.outputNames[0]].data;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pred.length; i++) {
      if (pred[i] < lo) lo = pred[i];
      if (pred[i] > hi) hi = pred[i];
    }
    const mask = Buffer.alloc(plane);
    const span = hi - lo || 1;
    for (let i = 0; i < plane; i++) mask[i] = Math.round(((pred[i] - lo) / span) * 255);
    const alpha = await sharp(mask, { raw: { width: SIZE, height: SIZE, channels: 1 } }).resize(src.w, src.h, { fit: 'fill' }).toColourspace('b-w').raw().toBuffer();
    // Write the mask into the photo's alpha (sharp's joinChannel + removeAlpha would drop it again).
    const rgba = await sharp(src.png).removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = rgba.data;
    for (let i = 0, n = src.w * src.h; i < n; i++) px[i * 4 + 3] = alpha[i];
    const png = await sharp(px, { raw: rgba.info }).png({ compressionLevel: 6 }).toBuffer();
    process.send({ png }, () => process.exit(0));
  } catch (e) {
    process.send({ error: String((e && e.message) || e) }, () => process.exit(0));
  }
});
