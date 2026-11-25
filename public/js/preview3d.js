/* 3D product preview (three.js). Units are inches, so every product is shown
 * at its real proportions with the customer's design mapped onto the printed
 * surface. Mugs and bottles are wrapped cylinders; posters, mouse pads, phone
 * cases, notebooks and cushions are modelled; clothing, caps and totes turn
 * as a curved front/back panel built from the realistic mockups.
 */
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/OrbitControls.js';
import { RoomEnvironment } from '/vendor/three/RoomEnvironment.js';

const S = 2; // design canvases are rendered at 2x the 500 x 600 mockup space
const MATERIALS = {
  fabric: { roughness: 0.92, metalness: 0, envMapIntensity: 0.55 },
  paper: { roughness: 0.85, metalness: 0, envMapIntensity: 0.55 },
  plastic: { roughness: 0.28, metalness: 0, envMapIntensity: 0.6 },
  ceramic: { roughness: 0.12, metalness: 0, envMapIntensity: 0.6 },
  metal: { roughness: 0.32, metalness: 0.6, envMapIntensity: 0.9 },
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  return c;
}
function texture(cv, renderer) {
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tx;
}
/** The trimmed print area of a side's design layer. */
function designCrop(tex) {
  if (!tex || !tex.hasDesign) return null;
  const r = tex.rects.trim;
  const sc = tex.designScale || S;
  const c = canvas(r.w * sc, r.h * sc);
  c.getContext('2d').drawImage(tex.design, r.x * sc, r.y * sc, r.w * sc, r.h * sc, 0, 0, c.width, c.height);
  return c;
}
/** A face: base colour with the design laid over it (optionally inset). */
function faceCanvas(fill, crop, w, h, inset = 0) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, c.width, c.height);
  if (crop) ctx.drawImage(crop, inset * c.width, inset * c.height, c.width * (1 - 2 * inset), c.height * (1 - 2 * inset));
  return c;
}
function mat(kind, opts) {
  return new THREE.MeshStandardMaterial({ ...MATERIALS[kind], ...opts });
}
function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/** Extruded rounded slab with the texture on its front face. */
function slab(w, h, r, depth, frontTex, sideMat, kind) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, h, r), { depth, bevelEnabled: true, bevelThickness: Math.min(0.06, depth / 4), bevelSize: Math.min(0.05, r / 3), bevelSegments: 4, curveSegments: 24 });
  geo.translate(0, 0, -depth / 2);
  frontTex.wrapS = frontTex.wrapT = THREE.ClampToEdgeWrapping;
  frontTex.repeat.set(1 / w, 1 / h);
  frontTex.offset.set(0.5, 0.5);
  return new THREE.Mesh(geo, [mat(kind, { map: frontTex }), sideMat]);
}

function buildMug(m, color, tex, renderer, product, side = product.sides[0]) {
  const g = new THREE.Group();
  const r = m.diameterIn / 2;
  const h = m.heightIn;
  const C = Math.PI * m.diameterIn;
  const wrap = canvas(2048, (2048 * h) / C);
  const ctx = wrap.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, wrap.width, wrap.height);
  const crop = designCrop(tex[side.id]);
  if (crop) {
    const pw = (side.printWidthIn / C) * wrap.width;
    const ph = (side.printHeightIn / h) * wrap.height;
    ctx.drawImage(crop, (wrap.width - pw) / 2, (wrap.height - ph) / 2 - wrap.height * 0.03, pw, ph);
  }
  const kind = m.material === 'metal' ? 'plastic' : 'ceramic';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 128, 1, true, Math.PI, Math.PI * 2), mat(kind, { map: texture(wrap, renderer) }));
  const plain = mat(kind, { color });
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, h * 0.98, 96, 1, true), mat('ceramic', { color, side: THREE.BackSide }));
  const innerBottom = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 64), plain);
  innerBottom.rotation.x = -Math.PI / 2;
  innerBottom.position.y = -h / 2 + 0.25;
  const base = new THREE.Mesh(new THREE.CircleGeometry(r, 64), plain);
  base.rotation.x = Math.PI / 2;
  base.position.y = -h / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.96, r * 0.04, 16, 128), plain);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h / 2;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(h * 0.27, 0.17, 24, 64, Math.PI), plain);
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(r - 0.05, 0.05, 0);
  g.add(body, inner, innerBottom, base, rim);
  if (m.handle !== false) {
    // A print all the way round is centred opposite the handle, its two ends meeting at the
    // handle: the handle goes behind, so the mug first shows the middle of the print.
    if (side.wrap) {
      const back = new THREE.Group();
      back.add(handle);
      back.rotation.y = Math.PI / 2;
      g.add(back);
    } else g.add(handle);
  }
  if (m.lid) {
    // Travel lid: a white cap with a steel band.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.005, r * 1.005, 0.18, 96), mat('metal', { color: '#c9ccd1' }));
    band.position.y = h / 2 + 0.09;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 1.0, 0.55, 96), mat('plastic', { color: '#f4f5f7' }));
    lid.position.y = h / 2 + 0.18 + 0.27;
    g.add(band, lid);
  }
  g.rotation.y = -0.35;
  return g;
}

function buildBottle(m, color, tex, renderer, product) {
  const g = new THREE.Group();
  const r = m.diameterIn / 2;
  const bodyH = m.heightIn * 0.72;
  const side = product.sides[0];
  const C = Math.PI * m.diameterIn;
  const wrap = canvas(2048, (2048 * bodyH) / C);
  const ctx = wrap.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, wrap.width, wrap.height);
  const crop = designCrop(tex[side.id]);
  if (crop) {
    const pw = (side.printWidthIn / C) * wrap.width;
    const ph = (side.printHeightIn / bodyH) * wrap.height;
    ctx.drawImage(crop, (wrap.width - pw) / 2, (wrap.height - ph) / 2, pw, ph);
  }
  const metal = mat('metal', { color });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, bodyH, 128, 1, true, Math.PI, Math.PI * 2), mat('metal', { map: texture(wrap, renderer) }));
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(r, 64), metal);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -bodyH / 2;
  const shoulderH = m.heightIn * 0.09;
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.52, r, shoulderH, 96, 1, true), metal);
  shoulder.position.y = bodyH / 2 + shoulderH / 2;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.4, 64), metal);
  neck.position.y = bodyH / 2 + shoulderH + 0.2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, m.heightIn * 0.12, 64), mat('plastic', { color: '#2a2b30' }));
  cap.position.y = bodyH / 2 + shoulderH + 0.4 + (m.heightIn * 0.12) / 2;
  g.add(body, bottom, shoulder, neck, cap);
  g.position.y = -(m.heightIn * 0.21) / 2;
  return g;
}

function buildFrame(color, tex, renderer, product) {
  const side = product.sides[0];
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const f = Math.max(0.8, w * 0.05);
  const depth = 1.1;
  const g = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat('paper', { map: texture(faceCanvas('#ffffff', designCrop(tex[side.id]), 1400, (1400 * h) / w), renderer) }));
  paper.position.z = depth / 2 - 0.25;
  const wood = mat('plastic', { color, roughness: 0.55 });
  const bar = (bw, bh, x, y) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, depth), wood);
    b.position.set(x, y, 0);
    return b;
  };
  g.add(paper, bar(w + 2 * f, f, 0, h / 2 + f / 2), bar(w + 2 * f, f, 0, -h / 2 - f / 2), bar(f, h, -w / 2 - f / 2, 0), bar(f, h, w / 2 + f / 2, 0));
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), wood);
  back.position.z = -depth / 2 + 0.1;
  g.add(back);
  return g;
}

function buildPad(color, tex, renderer, product) {
  const side = product.sides[0];
  const m = product.model || {};
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const r = Math.min(m.radiusIn != null ? m.radiusIn : 0.35, w / 2 - 0.001, h / 2 - 0.001);
  const face = texture(faceCanvas(color, designCrop(tex[side.id]), 1600, (1600 * h) / w), renderer);
  const mesh = slab(w, h, r, m.depthIn || 0.12, face, mat('plastic', { color: m.edge || '#2a2b30', roughness: 0.8 }), m.material || 'fabric');
  mesh.rotation.x = -1.05;
  return mesh;
}

/**
 * Clear acrylic (plaques, keychains): a see-through sheet with only the design
 * printed on it; where there is no ink you see through to the background.
 */
function clearBlock(w, h, r, m, t, renderer, opts = {}) {
  const depth = m.depthIn || 0.2;
  const bevel = Math.min(0.03, depth / 6);
  const g = new THREE.Group();
  const outline = () => opts.shape || roundedRect(w, h, r);
  const geo = new THREE.ExtrudeGeometry(outline(), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: Math.min(0.03, r / 3), bevelSegments: 3, curveSegments: opts.shape ? 48 : 24 });
  geo.translate(0, 0, -depth / 2);
  const glass = (opacity, color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.04, metalness: 0, transparent: true, opacity, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false, side: THREE.DoubleSide });
  // Faces nearly invisible; the cut edges catch the light with acrylic's slight green-blue tint.
  const sheet = new THREE.Mesh(geo, [glass(0.1, '#f4fbfd'), glass(0.55, '#cfe6e4')]);
  sheet.renderOrder = 2;
  g.add(sheet);
  const crop = designCrop(t);
  if (crop) {
    const c = canvas(1600, Math.round((1600 * h) / w));
    c.getContext('2d').drawImage(crop, 0, 0, c.width, c.height);
    const tx = texture(c, renderer);
    const ink = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, h, r), 24), mat('plastic', { map: tx, transparent: true, alphaTest: 0.02, roughness: 0.35, side: THREE.DoubleSide }));
    const uv = ink.geometry.attributes.uv;
    const pos = ink.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    // Printed on the back of the sheet, seen through the front (as UV prints on acrylic are).
    ink.position.z = -depth / 2 + 0.004;
    ink.renderOrder = 1;
    g.add(ink);
  }
  if (opts.engraved) {
    // Laser engraving: frosted into the front surface.
    const e = engraving(opts.engraved, w, h, renderer, { shape: outline(), frosted: '#a3aeb4' });
    e.position.z = depth / 2 + bevel + 0.003;
    g.add(e);
  }
  if (opts.turn !== false) g.rotation.y = -0.3;
  return g;
}

/** An upright block: acrylic photo blocks and keychains (clear edges) or foam-board signs. */
function buildBlock(color, tex, renderer, product) {
  const side = product.sides[0];
  const m = product.model || {};
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const r = Math.min(m.radiusIn != null ? m.radiusIn : 0.1, w / 2 - 0.001, h / 2 - 0.001);
  if (m.clear) return clearBlock(w, h, r, m, tex[side.id], renderer);
  const face = texture(faceCanvas(m.clear ? '#f7f9fb' : color, designCrop(tex[side.id]), 1600, (1600 * h) / w), renderer);
  const edge = m.clear
    ? new THREE.MeshPhysicalMaterial({ color: '#dfeaf0', roughness: 0.05, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.55, thickness: 0.5 })
    : mat('paper', { color: m.edge || '#f4f4f2' });
  const mesh = slab(w, h, r, m.depthIn || 0.5, face, edge, m.material || 'plastic');
  const back = product.sides[1];
  if (!back && (m.plainBack || m.stand)) {
    // Paper items printed on one side (envelopes, books, banners): a plain back,
    // not the design showing through; banners stand on a roll-up base.
    const g = new THREE.Group();
    g.add(mesh);
    if (m.plainBack) {
      const pb = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, h, r), 24), mat(m.material || 'paper', { color: m.plainBack === 'color' ? color : m.plainBack }));
      pb.rotation.y = Math.PI;
      pb.position.z = -(m.depthIn || 0.5) / 2 - Math.min(0.06, (m.depthIn || 0.5) / 4) - 0.002;
      g.add(pb);
    }
    if (m.stand) {
      const bw = w * 1.04;
      const bh = Math.max(2, h * 0.035);
      const bd = Math.max(3, w * 0.09);
      const base = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: 0.75, roughness: 0.35 }));
      base.position.set(0, -h / 2 - bh / 2 + bh * 0.25, 0);
      g.add(base);
    }
    g.rotation.y = -0.3;
    return g;
  }
  if (!back) {
    mesh.rotation.y = -0.3;
    return mesh;
  }
  // Two-sided items (business cards, ID cards, flyers): the back design on the reverse face.
  const g = new THREE.Group();
  const bf = texture(faceCanvas(color, designCrop(tex[back.id]), 1600, (1600 * h) / w), renderer);
  const backFace = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, h, r), 24), mat(m.material || 'plastic', { map: bf }));
  const uv = backFace.geometry.attributes.uv;
  const pos = backFace.geometry.attributes.position;
  // Seen from behind, so mirror u to read the right way round.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - (pos.getX(i) / w + 0.5), pos.getY(i) / h + 0.5);
  backFace.rotation.y = Math.PI;
  backFace.position.z = -(m.depthIn || 0.5) / 2 - Math.min(0.06, (m.depthIn || 0.5) / 4) - 0.002;
  g.add(mesh, backFace);
  g.rotation.y = -0.3;
  return g;
}

/** A month page (12 small rows of days), drawn on a canvas, for calendar models. */
function monthCanvas(w, h, accent) {
  const c = canvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = accent;
  x.fillRect(c.width * 0.08, c.height * 0.07, c.width * 0.84, c.height * 0.1);
  const cols = 7;
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      if (r === rows - 1 && k > 2) break;
      x.fillStyle = k === cols - 1 ? accent : '#8d939b';
      const cx = c.width * (0.12 + (k * 0.76) / (cols - 1));
      const cy = c.height * (0.3 + (r * 0.6) / (rows - 1));
      x.fillRect(cx - c.width * 0.03, cy - c.height * 0.018, c.width * 0.06, c.height * 0.036);
    }
  }
  return c;
}
const metal = () => new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.8, roughness: 0.3 });
/** Polished chrome (a pen's clip, ring and tip). */
function chrome() {
  return new THREE.MeshStandardMaterial({ color: '#dde1e6', metalness: 1, roughness: 0.17, envMapIntensity: 1.25 });
}
/** A thin card panel (front texture + plain back), hinged at its top edge, hanging down. */
function hangingPanel(w, h, frontMat, backMat, t = 0.014) {
  const p = new THREE.Group();
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), frontMat);
  f.position.set(0, -h / 2, t / 2);
  const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), backMat);
  b.rotation.y = Math.PI;
  b.position.set(0, -h / 2, -t / 2);
  p.add(f, b);
  return p;
}

/** Tent cards (table numbers, place cards): two faces leaning together, folded along the top. */
function buildTent(color, tex, renderer, product) {
  const [front, backSide] = product.sides;
  const w = front.printWidthIn;
  const h = front.printHeightIn;
  const lean = 0.36; // each face, from upright
  const paper = (opts) => mat('paper', { side: THREE.FrontSide, ...opts });
  const faceMat = (sd) => paper({ map: texture(faceCanvas(color, designCrop(sd && tex[sd.id]), 1600, Math.round((1600 * h) / w)), renderer), emissive: '#141412' });
  const inside = paper({ color: '#efefeb' });
  const a = hangingPanel(w, h, faceMat(front), inside);
  a.rotation.x = -lean;
  const b = hangingPanel(w, h, faceMat(backSide), inside);
  b.rotation.y = Math.PI;
  b.rotation.x = 0;
  const bWrap = new THREE.Group();
  bWrap.add(b);
  bWrap.rotation.x = lean;
  const g = new THREE.Group();
  g.add(a, bWrap);
  g.position.y = (h * Math.cos(lean)) / 2;
  const out = new THREE.Group();
  out.add(g);
  out.rotation.y = -0.45;
  out.rotation.x = 0.12;
  return out;
}

/** Desk calendar: wire-bound sheets on a card stand; the design on the left half, the month on the right. */
function buildDeskCal(color, tex, renderer, product) {
  const side = product.sides[0];
  const w = side.printWidthIn * 2; // the sheet: design half + month half
  const h = side.printHeightIn;
  const lean = 0.32;
  const c = canvas(2000, Math.round((2000 * h) / w));
  const ctx = c.getContext('2d');
  ctx.drawImage(faceCanvas(color, designCrop(tex[side.id]), c.width / 2, c.height), 0, 0);
  ctx.drawImage(monthCanvas(c.width / 2, c.height, '#1c7ed6'), c.width / 2, 0);
  const sheet = hangingPanel(w, h, mat('paper', { map: texture(c, renderer), emissive: '#141412' }), mat('paper', { color: '#efefeb' }));
  sheet.rotation.x = -lean;
  const stand = hangingPanel(w, h, mat('paper', { color: '#2f3237' }), mat('paper', { color: '#2f3237' }), 0.03);
  stand.rotation.x = lean;
  stand.position.z = -0.03;
  const g = new THREE.Group();
  g.add(sheet, stand);
  // Wire rings along the top.
  const ring = new THREE.TorusGeometry(0.11, 0.018, 8, 18);
  const n = Math.round(w / 0.33);
  for (let i = 0; i < n; i++) {
    const r = new THREE.Mesh(ring, metal());
    r.rotation.y = Math.PI / 2;
    r.position.set(-w / 2 + (w * (i + 0.5)) / n, 0, 0);
    g.add(r);
  }
  g.position.y = (h * Math.cos(lean)) / 2;
  const out = new THREE.Group();
  out.add(g);
  out.rotation.y = -0.35;
  out.rotation.x = 0.1;
  return out;
}

/** Wall calendar: the printed card, a pad of month sheets stapled on its lower half and a hanger. */
function buildWallCal(color, tex, renderer, product) {
  const side = product.sides[0];
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const g = new THREE.Group();
  const card = buildBlock(color, tex, renderer, { ...product, model: { ...product.model, plainBack: '#f6f6f4' } });
  card.rotation.y = 0;
  g.add(card);
  const depth = (product.model.depthIn || 0.06) / 2 + 0.02;
  // The month pad: 244 × 184 of the 290 × 410 sheet, its top at 51% of the height.
  const pw = w * (244 / 290);
  const ph = h * (184 / 410);
  const padEdge = mat('paper', { color: '#cfd2d7' });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.08), [
    padEdge, padEdge, padEdge, padEdge,
    mat('paper', { map: texture(monthCanvas(1200, Math.round((1200 * ph) / pw), '#d9480f'), renderer) }), mat('paper', { color: '#e9eaec' }),
  ]);
  const top = h / 2 - h * ((250 - 40) / 410);
  pad.position.set(w * ((128 + 122 - 250) / 290), top - ph / 2, depth + 0.04);
  g.add(pad);
  // Hanger: a metal strip on the top edge and a cord to a nail.
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, 0.35, 0.12), metal());
  strip.position.set(0, h / 2 + 0.05, 0);
  const cordMat = new THREE.MeshStandardMaterial({ color: '#7b8088', roughness: 0.6 });
  const rise = h * 0.08;
  for (const sgn of [-1, 1]) {
    const len = Math.hypot(w * 0.34, rise);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), cordMat);
    cord.position.set((sgn * w * 0.34) / 2, h / 2 + 0.2 + rise / 2, 0);
    cord.rotation.z = sgn * Math.atan2(w * 0.34, rise);
    g.add(cord);
  }
  const nail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), metal());
  nail.position.set(0, h / 2 + 0.2 + rise, 0);
  g.add(strip, nail);
  g.rotation.y = -0.3;
  return g;
}

/** Banner: the flex sheet with metal eyelets round the hem. */
function buildBanner(color, tex, renderer, product) {
  const side = product.sides[0];
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const g = new THREE.Group();
  const sheet = buildBlock(color, tex, renderer, product);
  sheet.rotation.y = 0;
  g.add(sheet);
  const eyelets = [[41, 201], [145.5, 201], [250, 201], [354.5, 201], [459, 201], [41, 399], [145.5, 399], [250, 399], [354.5, 399], [459, 399], [41, 300], [459, 300]];
  const r = Math.max(0.25, w * 0.012);
  const ringGeo = new THREE.TorusGeometry(r, r * 0.35, 10, 24);
  const z = (product.model.depthIn || 0.03) / 2 + 0.03;
  for (const [x, y] of eyelets) {
    const px = ((x - 30) / 440 - 0.5) * w;
    const py = (0.5 - (y - 190) / 220) * h;
    for (const sz of [z, -z]) {
      const e = new THREE.Mesh(ringGeo, metal());
      e.position.set(px, py, sz);
      g.add(e);
    }
    const hole = new THREE.Mesh(new THREE.CircleGeometry(r * 0.7, 18), new THREE.MeshBasicMaterial({ color: '#4b5058' }));
    hole.position.set(px, py, z + 0.001);
    g.add(hole);
  }
  g.rotation.y = -0.3;
  return g;
}

/** Bookmark: a punched hole near the top with a gold tassel. */
function buildBookmark(color, tex, renderer, product) {
  const side = product.sides[0];
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const g = new THREE.Group();
  const card = buildBlock(color, tex, renderer, product);
  card.rotation.y = 0;
  g.add(card);
  const hy = h / 2 - h * (22 / 420);
  const hr = w * (7 / 140);
  const z = (product.model.depthIn || 0.03) / 2 + 0.01;
  for (const sz of [z, -z]) {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(hr, 20), new THREE.MeshBasicMaterial({ color: '#e9ecef' }));
    hole.position.set(0, hy, sz);
    if (sz < 0) hole.rotation.y = Math.PI;
    g.add(hole);
  }
  const gold = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.35, roughness: 0.45 });
  // The cord loops over the top and hangs down the left side.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, hy, 0), new THREE.Vector3(0, h / 2 + w * 0.35, 0.05), new THREE.Vector3(-w * 0.45, h / 2 + w * 0.25, 0.12), new THREE.Vector3(-w * 0.62, h / 2 - w * 0.2, 0.15),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.03, 6, false), gold));
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), gold);
  knot.position.copy(curve.getPoint(1));
  // Tassel: a cap under the knot and loose threads fanning out below it.
  const end = curve.getPoint(1);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.14, 12), new THREE.MeshStandardMaterial({ color: '#a8820f', metalness: 0.4, roughness: 0.4 }));
  cap.position.copy(end).add(new THREE.Vector3(0, -0.12, 0));
  const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.15, w * 0.55, 14, 1, true), gold);
  tassel.position.copy(end).add(new THREE.Vector3(0, -0.19 - w * 0.275, 0));
  g.add(knot, cap, tassel);
  g.rotation.y = -0.3;
  return g;
}

/**
 * Printed fabric: a piece of cloth with soft folds, the pattern repeated at
 * its real size (long rolls show their first 1.5 m).
 */
function buildCloth(color, tex, renderer, product) {
  const side = product.sides[0];
  const t = tex[side.id];
  const p = t.pattern;
  if (!p) return buildCard(color, tex, renderer, product);
  const wCm = p.cm[0];
  const hCm = Math.min(p.cm[1], 150);
  const pxW = 1400;
  const pxH = Math.round((pxW * hCm) / wCm);
  const c = canvas(pxW, pxH);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, pxW, pxH);
  const tw = (pxW * p.tileCm) / wCm;
  if (t.hasDesign) POD.drawPattern(ctx, p.tile, { repeat: p.repeat, tw, th: tw, x: 0, y: 0, w: pxW, h: pxH });
  const w = wCm / 2.54;
  const h = hCm / 2.54;
  const geo = new THREE.PlaneGeometry(w, h, 80, 60);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Hanging folds that get deeper towards the bottom, plus a gentle wave.
    const down = (h / 2 - y) / h;
    pos.setZ(i, Math.sin((x / w) * Math.PI * 7) * w * 0.018 * (0.35 + down) + Math.sin((y / h) * Math.PI * 1.5) * w * 0.012);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat('fabric', { map: texture(c, renderer), side: THREE.DoubleSide }));
  mesh.rotation.y = -0.3;
  return mesh;
}

/**
 * A gallery-wrapped canvas on its wooden frame: the design on the front and,
 * on the four sides, what the edge style puts there (the artwork wrapping
 * round, the front's edges mirrored, or plain white / black).
 */
function buildCanvas(colorId, tex, renderer, product) {
  const side = product.sides[0];
  const t = tex[side.id];
  const m = product.model || {};
  const r = t.rects.trim;
  const U = t.rects.u || r.w / side.printWidthIn; // mockup units per inch at this size
  const w = r.w / U;
  const h = r.h / U;
  const d = m.depthIn || 1.5;
  const sc = t.designScale || S;
  const dp = Math.max(2, Math.round(d * U * sc)); // the depth in design-layer pixels
  const X = r.x * sc;
  const Y = r.y * sc;
  const RW = Math.round(r.w * sc);
  const RH = Math.round(r.h * sc);
  const base = (cw, ch) => {
    const c = canvas(cw, ch);
    const ctx = c.getContext('2d');
    ctx.fillStyle = colorId === 'black' ? '#141414' : '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    return [c, ctx];
  };
  // The front.
  const [frontCv, fctx] = base(RW, RH);
  if (t.hasDesign) fctx.drawImage(t.design, X, Y, RW, RH, 0, 0, RW, RH);
  // One side: the strip of artwork next to that edge (outside it for a wrap,
  // inside it flipped for a mirror), or plain for white / black edges.
  const sideCv = (edge) => {
    const vertical = edge === 'left' || edge === 'right';
    const [c, ctx] = base(vertical ? dp : RW, vertical ? RH : dp);
    if (!t.hasDesign || colorId === 'white' || colorId === 'black') return c;
    const src = colorId === 'mirror' ? t.design : t.wrap || t.design;
    const out = { left: [X - dp, Y], right: [X + RW, Y], top: [X, Y - dp], bottom: [X, Y + RH] }[edge];
    const inn = { left: [X, Y], right: [X + RW - dp, Y], top: [X, Y], bottom: [X, Y + RH - dp] }[edge];
    const [sx, sy] = colorId === 'mirror' ? inn : out;
    ctx.save();
    if (colorId === 'mirror') {
      ctx.translate(vertical ? c.width : 0, vertical ? 0 : c.height);
      ctx.scale(vertical ? -1 : 1, vertical ? 1 : -1);
    }
    ctx.drawImage(src, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
    ctx.restore();
    return c;
  };
  const face = (cv, pw, ph) => new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat('fabric', { map: texture(cv, renderer) }));
  const g = new THREE.Group();
  const front = face(frontCv, w, h);
  front.position.z = d / 2;
  const right = face(sideCv('right'), d, h);
  right.rotation.y = Math.PI / 2;
  right.position.x = w / 2;
  const left = face(sideCv('left'), d, h);
  left.rotation.y = -Math.PI / 2;
  left.position.x = -w / 2;
  const top = face(sideCv('top'), w, d);
  top.rotation.x = -Math.PI / 2;
  top.position.y = h / 2;
  const bottom = face(sideCv('bottom'), w, d);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -h / 2;
  // The back: raw canvas stapled over the wooden stretcher bars.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat('fabric', { color: '#e8dcc4' }));
  back.rotation.y = Math.PI;
  back.position.z = -d / 2;
  const bar = Math.min(2, w * 0.12);
  for (const [bw, bh, bx, by] of [[w, bar, 0, h / 2 - bar / 2], [w, bar, 0, -h / 2 + bar / 2], [bar, h, w / 2 - bar / 2, 0], [bar, h, -w / 2 + bar / 2, 0]]) {
    const wood = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), mat('paper', { color: '#c9a26b' }));
    wood.rotation.y = Math.PI;
    wood.position.set(bx, by, -d / 2 - 0.01);
    g.add(wood);
  }
  g.add(front, right, left, top, bottom, back);
  g.rotation.y = -0.62;
  g.rotation.x = 0.12;
  return g;
}

/**
 * A folded greeting card standing slightly open: the printed cover in front,
 * hinged at its left edge (the fold) to the plain back panel behind it.
 */
function buildFoldCard(color, tex, renderer, product) {
  const side = product.sides[0];
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const t = 0.012; // card thickness
  const paper = (opts) => mat('paper', { side: THREE.FrontSide, ...opts });
  const panel = (frontMat, backMat) => {
    const p = new THREE.Group();
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), frontMat);
    f.position.set(w / 2, 0, t / 2);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), backMat);
    b.rotation.y = Math.PI;
    b.position.set(w / 2, 0, -t / 2);
    p.add(f, b);
    return p;
  };
  const face = texture(faceCanvas(color, designCrop(tex[side.id]), 1600, Math.round((1600 * h) / w)), renderer);
  const plain = (shade) => paper({ color: shade, emissive: '#2a2a28' });
  const cover = panel(paper({ map: face, emissive: '#141412' }), plain('#f7f7f4'));
  const backPanel = panel(plain('#f4f4f1'), plain('#f1f1ee'));
  backPanel.position.z = -t * 1.5;
  backPanel.rotation.y = 1.05; // opened behind the cover, around the fold
  const card = new THREE.Group();
  card.add(cover, backPanel);
  card.position.x = -w * 0.3;
  const g = new THREE.Group();
  g.add(card);
  // Standing open, seen from the front right and a little above: the back
  // panel shows left of the fold and the top edges show the opening.
  g.rotation.y = 0.62;
  g.rotation.x = 0.22;
  return g;
}

function buildCase(color, tex, renderer, product) {
  const side = product.sides[0];
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const u = side.printArea.w / w;
  const g = new THREE.Group();
  const face = texture(faceCanvas(color, designCrop(tex[side.id]), 1000, (1000 * h) / w), renderer);
  const r = (side.printArea.rx || 30) / u;
  const depth = 0.38;
  const bt = Math.min(0.06, depth / 4);
  // The case body is plain; only its back (the camera side, facing +z) is printed.
  const body = new THREE.ExtrudeGeometry(roundedRect(w, h, r), { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: Math.min(0.05, r / 3), bevelSegments: 4, curveSegments: 24 });
  body.translate(0, 0, -depth / 2);
  g.add(new THREE.Mesh(body, mat('plastic', { color })));
  face.wrapS = face.wrapT = THREE.ClampToEdgeWrapping;
  face.repeat.set(1 / w, 1 / h);
  face.offset.set(0.5, 0.5);
  const print = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, h, r), 24), mat('plastic', { map: face }));
  print.position.z = depth / 2 + bt + 0.004;
  g.add(print);
  // The open front shows the phone's screen inside the case rim.
  const sw = w * 0.9;
  const sh = h * 0.95;
  const scr = canvas(400, Math.round((400 * sh) / sw));
  const sctx = scr.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, scr.width, scr.height);
  grad.addColorStop(0, '#1d2533');
  grad.addColorStop(1, '#07080c');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, scr.width, scr.height);
  sctx.fillStyle = '#000000';
  const pw = scr.width * 0.3;
  const ph = scr.width * 0.075;
  sctx.beginPath();
  if (sctx.roundRect) sctx.roundRect((scr.width - pw) / 2, scr.width * 0.06, pw, ph, ph / 2); else sctx.rect((scr.width - pw) / 2, scr.width * 0.06, pw, ph);
  sctx.fill();
  const screenTex = texture(scr, renderer);
  screenTex.wrapS = screenTex.wrapT = THREE.ClampToEdgeWrapping;
  screenTex.repeat.set(1 / sw, 1 / sh);
  screenTex.offset.set(0.5, 0.5);
  const screen = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(sw, sh, r * 0.85), 24), new THREE.MeshStandardMaterial({ map: screenTex, roughness: 0.12, metalness: 0.2, envMapIntensity: 0.9 }));
  screen.rotation.y = Math.PI;
  screen.position.z = -(depth / 2 + bt + 0.004);
  g.add(screen);
  // Camera bump, matching the 2D mockup's position.
  const bw = 76 / u;
  const bh = 86 / u;
  const bump = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(bw, bh, 0.28), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, curveSegments: 16 }), mat('plastic', { color: '#c9ccd2' }));
  bump.position.set(-w / 2 + (18 + 38) / u, h / 2 - (18 + 43) / u, 0.2);
  g.add(bump);
  const lensMat = mat('plastic', { color: '#16171a', roughness: 0.1 });
  for (const dy of [-0.32, 0.32]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.12, 32), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(bump.position.x - 0.18, bump.position.y + dy, 0.36);
    g.add(lens);
  }
  return g;
}

function buildNotebook(color, tex, renderer, product) {
  const side = product.sides[0];
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const d = 0.55;
  const g = new THREE.Group();
  const cover = texture(faceCanvas(color, designCrop(tex[side.id]), 1100, (1100 * h) / w), renderer);
  const pagesCv = canvas(256, 256);
  const pctx = pagesCv.getContext('2d');
  pctx.fillStyle = '#fbfaf6';
  pctx.fillRect(0, 0, 256, 256);
  pctx.strokeStyle = '#e2ded3';
  for (let i = 0; i < 256; i += 4) { pctx.beginPath(); pctx.moveTo(0, i); pctx.lineTo(256, i); pctx.stroke(); }
  const pages = mat('paper', { map: texture(pagesCv, renderer) });
  const back = mat('paper', { color });
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [pages, pages, pages, pages, mat('paper', { map: cover }), back]);
  g.add(box);
  const ring = mat('metal', { color: '#a7abb3' });
  for (let i = 0; i < 15; i++) {
    // Each ring loops through the cover edge, half outside the book.
    const t = new THREE.Mesh(new THREE.TorusGeometry(d * 0.62, 0.03, 10, 32), ring);
    t.rotation.x = Math.PI / 2;
    t.position.set(-w / 2 + 0.12, h / 2 - 0.45 - i * ((h - 0.9) / 14), 0);
    g.add(t);
  }
  g.rotation.y = 0.25;
  return g;
}

function buildPillow(m, color, tex, renderer, product) {
  const w = m.widthIn;
  const h = m.heightIn;
  const geo = new THREE.BoxGeometry(w, h, 5, 48, 48, 12);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = (2 * x) / w;
    const ny = (2 * y) / h;
    const puff = Math.sqrt(Math.max(0, (1 - nx * nx) * (1 - ny * ny)));
    const pinch = 1 - 0.06 * (1 - puff); // edges pull in a little
    pos.setXYZ(i, x * pinch, y * pinch, Math.sign(z) * (0.35 + 2.2 * puff) * Math.min(1, Math.abs(z) / 2.5));
  }
  geo.computeVertexNormals();
  const inset = (1 - product.sides[0].printWidthIn / w) / 2;
  const faces = product.sides.map((s) => mat('fabric', { map: texture(faceCanvas(color, designCrop(tex[s.id]), 1400, 1400, inset), renderer) }));
  const plain = mat('fabric', { color });
  return new THREE.Mesh(geo, [plain, plain, plain, plain, faces[0], faces[1] || faces[0]]);
}

/** Clothing, caps, totes: a gently curved panel with the realistic front and back renders. */
function buildCard(color, tex, renderer, product) {
  const first = tex[product.sides[0].id].real;
  const firstImg = first.cutout || first;
  // Real-world size from the render's pixels-per-inch, so photos and drawings both come out right.
  const w = firstImg.width / first.pxPerIn;
  const h = firstImg.height / first.pxPerIn;
  const g = new THREE.Group();
  const bend = (geo, dir) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, dir * (0.25 - 0.9 * ((p.getX(i) / (w / 2)) ** 2)));
    geo.computeVertexNormals();
  };
  const pick = (t) => t.real.cutout || t.real;
  const front = pick(tex[product.sides[0].id]);
  const backSide = product.sides[1];
  let backCv;
  if (backSide) backCv = pick(tex[backSide.id]);
  else if (tex[product.sides[0].id].plain) {
    // Single-sided photo products: the plain product, mirrored, seen from behind.
    const plain = tex[product.sides[0].id].plain.cutout;
    backCv = canvas(plain.width, plain.height);
    const bctx = backCv.getContext('2d');
    bctx.translate(backCv.width, 0);
    bctx.scale(-1, 1);
    bctx.drawImage(plain, 0, 0);
  } else {
    // Single-sided products: the plain product seen from behind.
    backCv = canvas(front.width, front.height);
    const bctx = backCv.getContext('2d');
    bctx.translate(backCv.width, 0);
    bctx.scale(-1, 1);
    bctx.drawImage(tex[product.sides[0].id].baseImg, 0, 0, backCv.width, backCv.height);
  }
  // Bags and pouches have real depth (product.model.depthIn): front and back
  // stand apart and side, bottom (and top, for zipped bags) walls join them.
  const m = product.model || {};
  const depth = m.depthIn || 0;
  const soft = m.shape === 'pouch' || m.shape === 'softbox';
  const fg = new THREE.PlaneGeometry(w, h, soft ? 72 : 48, soft ? 48 : 1);
  const bg = new THREE.PlaneGeometry(w, h, soft ? 72 : 48, soft ? 48 : 1);
  if (!depth) {
    bend(fg, 1);
    bend(bg, 1);
  }
  // Soft bags: the panels puff out (a pouch all the way to its seams, a soft box a little),
  // shaded by their own curve so the roundness shows.
  const body = soft ? bodyOf(firstImg, w, h) : null;
  if (soft && body) {
    const puff = m.shape === 'pouch' ? depth / 2 : Math.min(0.45, depth * 0.07);
    for (const geo of [fg, bg]) puffPanel(geo, body, puff, m.shape === 'pouch');
  }
  // The renders already carry the photo's own light and shading, so show them
  // unlit: the front and back then look the same whichever way the panel faces.
  const photoMat = (cv) => new THREE.MeshBasicMaterial({ map: texture(cv, renderer), alphaTest: 0.5, vertexColors: Boolean(soft && body), side: m.shape === 'pouch' ? THREE.DoubleSide : THREE.FrontSide });
  // A soft box gets a real strap handle on top: the flat handle drawn in the photos goes.
  const noHandle = (cv) => {
    if (m.shape !== 'softbox' || !body) return cv;
    const c = canvas(cv.width, cv.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(cv, 0, 0);
    ctx.clearRect(0, 0, c.width, Math.max(0, Math.floor((0.5 - body.yT / h) * c.height) - 1));
    return c;
  };
  const fm = new THREE.Mesh(fg, photoMat(noHandle(front)));
  const bm = new THREE.Mesh(bg, photoMat(noHandle(backCv)));
  bm.rotation.y = Math.PI;
  if (m.shape === 'pouch' && body) {
    // A pouch has no walls: front and back meet at the seams.
    g.add(fm, bm);
    g.rotation.y = -0.45;
    return g;
  }
  if (depth) {
    fm.position.z = depth / 2;
    bm.position.z = -depth / 2;
    for (const wall of bagWalls(firstImg, w, h, depth, m, renderer)) g.add(wall);
  } else {
    bm.position.z = -0.3;
  }
  g.add(fm, bm);
  if (depth) g.rotation.y = -0.45;
  return g;
}

/**
 * The walls of a bag: found from the photo (the rows where the body is at
 * least 70% of its widest, which leaves out handles), coloured like the body.
 */
/**
 * Where the bag's body is in its photo (rows at least 70% of the widest, which
 * leaves out handles), in model units, and the colour at its edges.
 */
function bodyOf(img, w, h) {
  const sw = 160;
  const sh = Math.max(1, Math.round((sw * img.height) / img.width));
  const c = canvas(sw, sh);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;
  const rows = [];
  let widest = 0;
  for (let y = 0; y < sh; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < sw; x++) {
      if (d[(y * sw + x) * 4 + 3] > 128) {
        if (l < 0) l = x;
        r = x;
      }
    }
    rows.push(l < 0 ? null : [l, r]);
    if (l >= 0) widest = Math.max(widest, r - l);
  }
  let top = -1;
  let bottom = -1;
  let left = sw;
  let right = 0;
  let rs = 0;
  let gs = 0;
  let bs = 0;
  let n = 0;
  rows.forEach((row, y) => {
    if (!row || row[1] - row[0] < widest * 0.7) return;
    if (top < 0) top = y;
    bottom = y;
    left = Math.min(left, row[0]);
    right = Math.max(right, row[1]);
    for (const x of [row[0] + 2, row[1] - 2]) {
      const i = (y * sw + Math.max(0, Math.min(sw - 1, x))) * 4;
      rs += d[i];
      gs += d[i + 1];
      bs += d[i + 2];
      n++;
    }
  });
  if (top < 0) return null;
  const toX = (px) => (px / sw - 0.5) * w;
  const toY = (py) => (0.5 - py / sh) * h;
  // Tucked in a little so the walls stay behind rounded corners and seams.
  const inset = (right - left) * 0.015;
  return {
    xL: toX(left + 0.5 + inset),
    xR: toX(right + 0.5 - inset),
    yT: toY(top + (bottom - top) * 0.04),
    yB: toY(bottom + 1 - (bottom - top) * 0.015),
    rgb: [rs / n, gs / n, bs / n],
  };
}

/**
 * Puff a bag panel out from its seams. A pouch swells to `puff` in the middle and
 * meets the other panel at its seams (all four edges); a soft box bulges a little
 * inside its piped edges. Each vertex is shaded by its slope, so the curve reads
 * on the unlit photo.
 */
function puffPanel(geo, b, puff, pouch) {
  const p = geo.attributes.position;
  const cx = (b.xL + b.xR) / 2;
  const cy = (b.yT + b.yB) / 2;
  const hw = (b.xR - b.xL) / 2;
  const hh = (b.yT - b.yB) / 2;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const u = Math.min(1, Math.abs((p.getX(i) - cx) / hw));
    const v = Math.min(1, Math.abs((p.getY(i) - cy) / hh));
    // Flat-ish in the middle, falling off to the seams (sharper at a pouch's zip and sides).
    const fu = pouch ? 1 - u ** 3.2 : 1 - u ** 6;
    const fv = pouch ? 1 - v ** 2.6 : 1 - v ** 6;
    p.setZ(i, puff * Math.max(0, fu) ** 0.7 * Math.max(0, fv) ** 0.7);
  }
  geo.computeVertexNormals();
  // Light from the upper left, a little in front: slopes facing away get darker.
  const L = new THREE.Vector3(-0.42, 0.5, 0.76).normalize();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const d = nrm.getX(i) * L.x + nrm.getY(i) * L.y + nrm.getZ(i) * L.z;
    const k = Math.min(1.04, 0.83 + 0.27 * Math.max(0, d));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** A woven-fabric texture in the bag's colour, with its bump map (for the walls). */
function fabricTexture(rgb, renderer) {
  const N = 256;
  const c = canvas(N, N);
  const bmp = canvas(N, N);
  const ctx = c.getContext('2d');
  const bctx = bmp.getContext('2d');
  const img = ctx.createImageData(N, N);
  const bimg = bctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // A plain weave: alternating over-under threads, plus a little noise.
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 1 : -1;
      const t = 0.5 + 0.5 * Math.sin((x * Math.PI) / 2) * Math.sin((y * Math.PI) / 2) * weave;
      const noise = (Math.random() - 0.5) * 0.06;
      const k = 0.95 + 0.06 * t + noise;
      const i = (y * N + x) * 4;
      img.data[i] = Math.min(255, rgb[0] * k);
      img.data[i + 1] = Math.min(255, rgb[1] * k);
      img.data[i + 2] = Math.min(255, rgb[2] * k);
      img.data[i + 3] = 255;
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = Math.round(255 * t);
      bimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  const map = texture(c, renderer);
  const bump = new THREE.CanvasTexture(bmp);
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, bump };
}

function bagWalls(img, w, h, depth, m, renderer) {
  const b = bodyOf(img, w, h);
  if (!b) return [];
  const { xL, xR, yT, yB } = b;
  const soft = m.shape === 'softbox';
  // The edge colour, a little darker: the sides face away from the light.
  const col = new THREE.Color(`rgb(${Math.round(b.rgb[0] * 0.88)}, ${Math.round(b.rgb[1] * 0.88)}, ${Math.round(b.rgb[2] * 0.88)})`);
  let wallMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  let fab = null;
  if (soft) {
    fab = fabricTexture(b.rgb.map((v) => v * 0.93), renderer);
    wallMat = new THREE.MeshStandardMaterial({ map: fab.map, bumpMap: fab.bump, bumpScale: 0.6, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
  }
  const plane = (pw, ph) => {
    const geo = new THREE.PlaneGeometry(pw, ph, soft ? 16 : 1, soft ? 16 : 1);
    if (soft) {
      // Soft walls bow out a little between the piped edges, and the weave keeps its real size.
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = (2 * p.getX(i)) / pw;
        const v = (2 * p.getY(i)) / ph;
        p.setZ(i, Math.min(0.35, Math.min(pw, ph) * 0.05) * Math.max(0, 1 - u ** 4) * Math.max(0, 1 - v ** 4));
      }
      geo.computeVertexNormals();
      const uv = geo.attributes.uv;
      const shade = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const k = 0.86 + 0.14 * ((p.getY(i) / ph) + 0.5) * (ph > pw * 0.6 ? 1 : 0.4);
        shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = k;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * pw) / 1.6, (uv.getY(i) * ph) / 1.6);
    }
    return new THREE.Mesh(geo, wallMat);
  };
  const walls = [];
  const bodyH = yT - yB;
  const bodyW = xR - xL;
  for (const x of [xL, xR]) {
    const s = plane(depth, bodyH);
    s.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2; // its bulge faces outwards
    s.position.set(x, (yT + yB) / 2, 0);
    walls.push(s);
  }
  const bot = plane(bodyW, depth);
  bot.rotation.x = Math.PI / 2;
  bot.position.set((xL + xR) / 2, yB, 0);
  walls.push(bot);
  if (m.closedTop) {
    const t = plane(bodyW, depth);
    t.rotation.x = -Math.PI / 2;
    t.position.set((xL + xR) / 2, yT, 0);
    walls.push(t);
  }
  if (soft) {
    // Piping along every edge (it hides the corners and reads as a sewn bag) and a zip across the top.
    // Lit a little from within, so on a light bag the piping is a soft seam and not a drawn outline.
    const pipeMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(1.06), emissive: col.clone().multiplyScalar(0.4), roughness: 1, metalness: 0, envMapIntensity: 0.3 });
    const r = Math.min(0.055, depth * 0.01);
    const pipe = (len, axis, x, y, z) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12, 1), pipeMat);
      if (axis === 'x') c.rotation.z = Math.PI / 2;
      if (axis === 'z') c.rotation.x = Math.PI / 2;
      c.position.set(x, y, z);
      walls.push(c);
    };
    const zf = depth / 2;
    for (const x of [xL, xR]) for (const z of [-zf, zf]) pipe(bodyH, 'y', x, (yT + yB) / 2, z);
    for (const y of [yB, yT]) {
      for (const z of [-zf, zf]) pipe(bodyW, 'x', (xL + xR) / 2, y, z);
      for (const x of [xL, xR]) pipe(depth, 'z', x, y, 0);
    }
    if (m.closedTop) {
      // The zip: a dark tape with teeth, along the top's middle and down the sides a little.
      const tape = canvas(512, 32);
      const tctx = tape.getContext('2d');
      tctx.fillStyle = '#2b2d33';
      tctx.fillRect(0, 0, 512, 32);
      tctx.fillStyle = '#8d9096';
      for (let x = 0; x < 512; x += 6) tctx.fillRect(x, 11, 3, 10);
      const zipMat = new THREE.MeshStandardMaterial({ map: texture(tape, renderer), roughness: 0.5, metalness: 0.3 });
      const zip = new THREE.Mesh(new THREE.PlaneGeometry(bodyW * 0.98, Math.min(0.5, depth * 0.08)), zipMat);
      zip.rotation.x = -Math.PI / 2;
      zip.position.set((xL + xR) / 2, yT + Math.min(0.35, Math.min(bodyW, depth) * 0.05) + 0.01, 0);
      walls.push(zip);
      const pull = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.7), new THREE.MeshStandardMaterial({ color: '#9a9ea6', roughness: 0.3, metalness: 0.8 }));
      pull.position.set(xR - bodyW * 0.12, zip.position.y + 0.04, 0.3);
      walls.push(pull);
      // One carry strap across the top, from front to back like a real lunch bag's.
      const strapMat = new THREE.MeshStandardMaterial({ map: fab.map, bumpMap: fab.bump, bumpScale: 0.4, color: 0xdddddd, roughness: 0.95, metalness: 0 });
      const span = Math.min(bodyW * 0.42, 3.4);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(span / 2, 0.16, 10, 40, Math.PI), strapMat);
      strap.scale.set(1, 1.15, 2.4); // a flat webbing strap, not a round rope
      strap.position.set((xL + xR) / 2, yT + Math.min(0.35, Math.min(bodyW, depth) * 0.05), 0);
      walls.push(strap);
    }
  }
  return walls;
}

// ---------- Laser engraving and cutting ----------
// Wood, slate, leather and acrylic, each with its own look. Engraved items carry
// the design as a see-through layer on the material (the editor draws it in the
// material's engrave tone); cut items take the design's outline as their shape.

/** A small seeded random, so the procedural textures are the same every time. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rgbOf(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Smooth noise (0..1) that tiles over an N x N square: `cx` blobs across, `cy` down. */
function tileNoise(N, cx, rnd, cy = cx) {
  const g = Array.from({ length: cx * cy }, rnd);
  const out = new Float32Array(N * N);
  const sm = (t) => t * t * (3 - 2 * t);
  const at = (i, j) => g[(j % cy) * cx + (i % cx)];
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * cy;
    const y0 = Math.floor(fy);
    const ty = sm(fy - y0);
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * cx;
      const x0 = Math.floor(fx);
      const tx = sm(fx - x0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * N + x] = a + (b - a) * ty;
    }
  }
  return out;
}
/** Paint an N x N texture: `shade(x, y)` gives the brightness factor (and bump height). */
function paintTexture(hex, N, shade) {
  const [r, g, b] = rgbOf(hex);
  const c = canvas(N, N);
  const bump = canvas(N, N);
  const ctx = c.getContext('2d');
  const bctx = bump.getContext('2d');
  const img = ctx.createImageData(N, N);
  const bimg = bctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [k, hgt] = shade(x, y);
      const i = (y * N + x) * 4;
      img.data[i] = Math.min(255, r * k);
      img.data[i + 1] = Math.min(255, g * k);
      img.data[i + 2] = Math.min(255, b * k);
      img.data[i + 3] = 255;
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = Math.max(0, Math.min(255, Math.round(255 * hgt)));
      bimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  return [c, bump];
}
/** Wood: fine streaky grain along x with a few soft growth lines (painted wood: just a hint). */
function woodCanvas(hex, painted) {
  const N = 512;
  const rnd = seeded(11);
  const warp = tileNoise(N, 2, rnd, 6);
  const blotch = tileNoise(N, 3, rnd, 14); // long, soft patches along the grain
  const fibre = tileNoise(N, 6, rnd, 160); // fine streaks
  const fibre2 = tileNoise(N, 12, rnd, 300);
  const TAU = Math.PI * 2;
  return paintTexture(hex, N, (x, y) => {
    const i = y * N + x;
    const fy = y / N;
    const yy = fy + 0.012 * Math.sin(TAU * (x / N + fy)) + 0.035 * (warp[i] - 0.5);
    const ring = 0.5 + 0.5 * Math.cos(TAU * (yy * 9 + 0.35 * Math.sin(TAU * yy * 2)));
    const line = ring ** 16;
    const f = 0.6 * (fibre[i] - 0.5) + 0.4 * (fibre2[i] - 0.5);
    const b = blotch[i] - 0.5;
    const k = painted
      ? 1 - 0.02 * line - 0.05 * f - 0.02 * b
      : 1.04 - 0.17 * line - 0.05 * ring - 0.28 * f - 0.12 * b + 0.025 * (rnd() - 0.5);
    return [k, 0.5 + 0.8 * f - 0.2 * line];
  });
}
/** Slate: dark matte stone with fine speckle and faint layering. */
function slateCanvas(hex) {
  const N = 256;
  const rnd = seeded(5);
  const a = tileNoise(N, 6, rnd);
  const b = tileNoise(N, 32, rnd);
  return paintTexture(hex, N, (x, y) => {
    const s = rnd();
    const n = 0.55 * a[y * N + x] + 0.45 * b[y * N + x];
    return [0.86 + 0.24 * n + 0.08 * (s - 0.5), n * 0.7 + 0.3 * s];
  });
}
/** Leather: a fine pebbled grain. */
function leatherCanvas(hex) {
  const N = 256;
  const rnd = seeded(3);
  const a = tileNoise(N, 40, rnd);
  const b = tileNoise(N, 90, rnd);
  const c = tileNoise(N, 5, rnd);
  return paintTexture(hex, N, (x, y) => {
    const i = y * N + x;
    const n = 0.6 * a[i] + 0.4 * b[i];
    return [0.9 + 0.14 * n + 0.08 * (c[i] - 0.5), n];
  });
}
/** A repeating texture whose UVs are in inches; one tile covers `inches`. */
function tiled(cv, renderer, inches, color = true) {
  const tx = color ? texture(cv, renderer) : new THREE.CanvasTexture(cv);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(1 / inches, 1 / inches);
  return tx;
}

/** What the laser material looks like: wood, slate, leather, mirror or plain acrylic, or clear. */
function laserLook(color, product) {
  const id = color.id;
  const m = product.model || {};
  const name = JSON.stringify(color.name || '').toLowerCase();
  if (m.type === 'cardholder' || m.type === 'wallet') return 'leather';
  // Pens: coated metal, or a wooden (bamboo) barrel.
  if (m.type === 'pen') return id === 'bamboo' || name.includes('bamboo') || name.includes('wood') ? 'wood' : 'metal';
  if (id === 'clear' || m.clear) return 'clear';
  if (id === 'slate') return 'slate';
  if (['gold', 'silver', 'rosegold'].includes(id)) return 'mirror';
  if (['natural', 'wood', 'walnut'].includes(id) || name.includes('wood')) return 'wood';
  return 'acrylic';
}
/** The face and cut-edge materials for a look (laser-cut wood edges come out darkened). */
function laserMats(look, hex, renderer, painted) {
  const std = (o) => new THREE.MeshStandardMaterial({ metalness: 0, ...o });
  if (look === 'wood') {
    const [cv, bp] = woodCanvas(hex, painted);
    const map = tiled(cv, renderer, 10);
    const bump = tiled(bp, renderer, 10, false);
    return {
      // (Painted white is toned down a little so the lit top doesn't burn out to plain white.)
      face: std({ map, bumpMap: bump, bumpScale: painted ? 0.12 : 0.4, color: painted ? '#dcd9d4' : '#ffffff', roughness: painted ? 0.62 : 0.74, envMapIntensity: 0.45 }),
      edge: std({ map, color: painted ? '#c6b6a4' : '#7a5338', roughness: 0.9, envMapIntensity: 0.3 }),
    };
  }
  if (look === 'slate') {
    const [cv, bp] = slateCanvas(hex);
    const map = tiled(cv, renderer, 4);
    const bump = tiled(bp, renderer, 4, false);
    return {
      face: std({ map, bumpMap: bump, bumpScale: 0.8, roughness: 0.88, envMapIntensity: 0.35 }),
      edge: std({ map, bumpMap: bump, bumpScale: 2, color: '#d8d8d8', roughness: 0.95, envMapIntensity: 0.3 }),
    };
  }
  if (look === 'leather') {
    const [cv, bp] = leatherCanvas(hex);
    const map = tiled(cv, renderer, 1.6);
    const bump = tiled(bp, renderer, 1.6, false);
    return {
      face: new THREE.MeshPhysicalMaterial({ map, bumpMap: bump, bumpScale: 1.2, roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.55, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.25), envMapIntensity: 0.5 }),
      edge: std({ color: new THREE.Color(hex).multiplyScalar(0.7), roughness: 0.4, envMapIntensity: 0.5 }),
    };
  }
  if (look === 'metal') {
    // Coated metal (pens): the colour coat over the metal, a little glossy; the edge is the bare chrome.
    return {
      face: new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.55, roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 1 }),
      edge: chrome(),
    };
  }
  if (look === 'mirror') {
    return {
      face: std({ color: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.2), metalness: 1, roughness: 0.1, envMapIntensity: 1.6 }),
      edge: std({ color: new THREE.Color(hex).multiplyScalar(0.85), metalness: 0.6, roughness: 0.3, envMapIntensity: 1 }),
    };
  }
  // Black or white acrylic: glossy plastic (white a shade down, or its lit faces burn out).
  const light = new THREE.Color(hex).getHSL({}).l > 0.8;
  const base = light ? new THREE.Color(hex).multiplyScalar(0.66) : new THREE.Color(hex);
  const gloss = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.14, metalness: 0, clearcoat: light ? 0.5 : 1, clearcoatRoughness: 0.06, envMapIntensity: light ? 0.5 : 0.7 });
  return { face: gloss, edge: new THREE.MeshPhysicalMaterial({ color: light ? base.clone().multiplyScalar(0.88) : base, roughness: 0.3, metalness: 0, envMapIntensity: 0.6 }) };
}

/** The print area's real size in inches at the chosen size (k: how much bigger than the standard size). */
function printSize(side, t) {
  const r = t && t.rects && t.rects.trim;
  const u = r && (t.rects.u || r.w / side.printWidthIn);
  const w = r ? r.w / u : side.printWidthIn;
  const h = r ? r.h / u : side.printHeightIn || side.printWidthIn;
  return { w, h, k: w / side.printWidthIn };
}
/** Map a flat geometry's UVs to its x / y across a w x h box centred on (cx, cy). */
function boxUV(geo, w, h, cx = 0, cy = 0) {
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - cx) / w + 0.5, (pos.getY(i) - cy) / h + 0.5);
  uv.needsUpdate = true;
}
/** UVs in inches from each face's position, so wood grain keeps its real size on any box. */
function inchUV(geo, alongY = false) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ax >= ay && ax >= az) [u, v] = alongY ? [p.getY(i), p.getZ(i)] : [p.getZ(i), p.getY(i)];
    else if (ay >= az) [u, v] = [p.getX(i), p.getZ(i)];
    else [u, v] = alongY ? [p.getY(i), p.getX(i)] : [p.getX(i), p.getY(i)];
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}
/** A sheet cut to `shape`, `depth` thick, front face at z = depth / 2 (laser-cut: square edges). */
function cutSheet(shape, depth, mats, bevel = 0) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 48 });
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, [mats.face, mats.edge]);
}
/**
 * The engraving: the design (already in the engrave tone, on a transparent
 * background) laid on the surface, so the material shows around it. Covers a
 * w x h box (or `shape` within it), centred on the origin and facing +z.
 * `radius`: laid round a barrel whose length runs along x (the width runs along
 * it, the height goes round it), still centred on +z. `metal`: the bare metal
 * under a coat (a little shiny) rather than a matte burn.
 */
function engraving(crop, w, h, renderer, opts = {}) {
  const tx = texture(crop, renderer);
  const geo = opts.shape ? new THREE.ShapeGeometry(opts.shape, 48) : new THREE.PlaneGeometry(w, h, 1, opts.radius ? 32 : 1);
  if (opts.shape) boxUV(geo, w, h);
  if (opts.radius) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = p.getY(i) / opts.radius;
      p.setXYZ(i, p.getX(i), opts.radius * Math.sin(a), opts.radius * Math.cos(a));
    }
    geo.computeVertexNormals();
  }
  const m = new THREE.MeshStandardMaterial({
    map: tx, transparent: true, alphaTest: 0.04, depthWrite: false, metalness: 0,
    roughness: opts.frosted ? 0.95 : 0.88, envMapIntensity: opts.frosted ? 0.9 : 0.4,
    ...(opts.frosted ? { color: opts.frosted === true ? '#e6ecef' : opts.frosted } : {}),
    ...(opts.metal ? { metalness: 0.35, roughness: 0.6, envMapIntensity: 0.8 } : {}),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 3;
  return mesh;
}
/** An arch: straight sides and bottom, the top a semicircle across the whole width. */
function archShape(w, h) {
  const R = w / 2;
  const cy = h / 2 - R;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, cy);
  s.absarc(0, cy, R, 0, Math.PI, false);
  s.lineTo(-w / 2, -h / 2);
  return s;
}
/** A wooden stick or board between two points (a box of section sw x sd), grain along it. */
function beam(a, b, sw, sd, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(inchUV(new THREE.BoxGeometry(sw, len, sd), true), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** Signs and plaques: a board cut rounded or as an arch, engraved; plaques on a wooden stand, signs on an easel. */
function laserBlock(look, mats, crop, w, h, m, renderer) {
  const arch = m.shape === 'arch';
  const r = Math.min(m.radiusIn != null ? m.radiusIn : 0.1, w / 2 - 0.001, h / 2 - 0.001);
  const shape = arch ? archShape(w, h) : roundedRect(w, h, r);
  const depth = m.depthIn || 0.2;
  let board;
  if (look === 'clear') {
    board = clearBlock(w, h, r, m, null, renderer, { shape, engraved: crop, turn: false });
  } else {
    board = new THREE.Group();
    board.add(cutSheet(shape, depth, mats));
    if (crop) {
      const e = engraving(crop, w, h, renderer, { shape, frosted: look === 'acrylic' });
      e.position.z = depth / 2 + 0.004;
      board.add(e);
    }
  }
  const g = new THREE.Group();
  if (m.base === 'wood') {
    // A ready-made wooden stand with a slot; the acrylic stands in it.
    const bw = w + 0.7;
    const bd = Math.max(1.5, depth * 7);
    const bh = 0.75;
    const sunk = 0.3;
    const wood = laserMats('wood', '#c99a66', renderer, false);
    const geo = new THREE.ExtrudeGeometry(roundedRect(bw, bd, 0.12), { depth: bh - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 12 });
    geo.rotateX(-Math.PI / 2);
    const base = new THREE.Mesh(geo, [wood.face, wood.face]);
    base.position.y = -h / 2 + sunk - bh + 0.04;
    base.position.z = -0.15;
    g.add(board, base);
  } else if (m.easel) {
    // Leaning back on a wooden easel, standing on the ledge across its front legs.
    const a = 0.1;
    const yL = h * 0.42;
    const top = yL + h * 0.95;
    const wood = laserMats('wood', '#b98d5e', renderer, false).face;
    const back = (y) => -Math.tan(a) * y;
    const legW = 0.9;
    const legD = 0.6;
    for (const s of [-1, 1]) {
      g.add(beam(new THREE.Vector3(s * w * 0.46, 0, 0), new THREE.Vector3(s * w * 0.12, top, back(top)), legW, legD, wood));
    }
    g.add(beam(new THREE.Vector3(0, top - 0.6, back(top) - legD), new THREE.Vector3(0, 0, -top * 0.42), legW, legD, wood));
    const ledgeD = depth + 1.1;
    const ledge = new THREE.Mesh(inchUV(new THREE.BoxGeometry(w * 0.98, 0.6, ledgeD)), wood);
    ledge.position.set(0, yL - 0.3, back(yL) + legD / 2 + ledgeD / 2 - 0.05);
    const lip = new THREE.Mesh(inchUV(new THREE.BoxGeometry(w * 0.98, 0.45, 0.25)), wood);
    lip.position.set(0, yL + 0.2, ledge.position.z + ledgeD / 2 - 0.125);
    board.rotation.x = -a;
    board.position.set(0, yL + (h / 2) * Math.cos(a), back(yL + h / 2) + legD / 2 + depth / 2 + 0.02);
    g.add(board, ledge, lip);
  } else {
    g.add(board);
  }
  g.rotation.y = -0.3;
  return g;
}

/** Things lying on a table are first seen from above and in front. */
const LOOK_DOWN = new THREE.Vector3(0.2, 0.95, 0.85).normalize();

/** Coasters: a stack of the set, the top one engraved. */
function laserCoasters(mats, crop, w, h, m, renderer) {
  const depth = m.depthIn || 0.2;
  const r = Math.min(m.radiusIn != null ? m.radiusIn : 0.25, w / 2 - 0.001);
  const shape = roundedRect(w, h, r);
  const g = new THREE.Group();
  [0.0, 0.16, -0.12, 0.07].forEach((turn, i) => {
    const c = cutSheet(shape, depth, mats, 0.012);
    c.position.set(i ? 0.05 * i : 0, i ? -0.04 * i : 0, -i * (depth + 0.026));
    c.rotation.z = turn;
    g.add(c);
  });
  if (crop) {
    const e = engraving(crop, w, h, renderer);
    e.position.z = depth / 2 + 0.012 + 0.004;
    g.add(e);
  }
  g.rotation.set(-Math.PI / 2, 0, 0.3);
  g.userData.viewDir = LOOK_DOWN;
  return g;
}

/** The engagement tray: a floor, low walls and taller ends with cut-out handles; the design on the floor. */
function laserTray(mats, crop, w, h, m, k, renderer) {
  const [W, D] = (m.outerIn || [13.8, 9.84]).map((v) => v * k);
  const t = (m.wallIn || 0.4) * Math.min(1, k);
  const rim = (m.rimIn || 1.4) * k;
  const floor = 0.25;
  const g = new THREE.Group(); // built lying face up in +z (the floor is the x-y plane)
  const f = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(W, D, 0.2), { depth: floor, bevelEnabled: false, curveSegments: 16 }), [mats.face, mats.edge]);
  g.add(f);
  // Long walls.
  for (const s of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(roundedRect(W - 2 * t, rim, 0.05), { depth: t, bevelEnabled: false, curveSegments: 6 });
    // Shape in x / z, thickness along -y (a rotation, so the faces still point outwards).
    geo.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    geo.translate(0, s > 0 ? D / 2 : -D / 2 + t, floor + rim / 2);
    g.add(new THREE.Mesh(geo, [mats.face, mats.edge]));
  }
  // End walls: rise in a gentle hump with a rounded slot for the hands.
  const endH = rim + (m.handles === false ? 0 : 1.25 * k);
  const end = new THREE.Shape();
  end.moveTo(-D / 2, 0);
  end.lineTo(D / 2, 0);
  end.lineTo(D / 2, rim);
  if (m.handles === false) end.lineTo(-D / 2, rim);
  else {
    end.bezierCurveTo(D * 0.36, rim, D * 0.3, endH, D * 0.16, endH);
    end.lineTo(-D * 0.16, endH);
    end.bezierCurveTo(-D * 0.3, endH, -D * 0.36, rim, -D / 2, rim);
    const sw = Math.min(3.8 * k, D * 0.38);
    const sh = 0.8 * k;
    const cy = endH - 0.3 * k - sh / 2;
    const hole = new THREE.Path();
    hole.moveTo(-sw / 2 + sh / 2, cy - sh / 2);
    hole.lineTo(sw / 2 - sh / 2, cy - sh / 2);
    hole.absarc(sw / 2 - sh / 2, cy, sh / 2, -Math.PI / 2, Math.PI / 2, false);
    hole.lineTo(-sw / 2 + sh / 2, cy + sh / 2);
    hole.absarc(-sw / 2 + sh / 2, cy, sh / 2, Math.PI / 2, Math.PI * 1.5, false);
    end.holes.push(hole);
  }
  end.lineTo(-D / 2, 0);
  for (const s of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(end, { depth: t, bevelEnabled: false, curveSegments: 24 });
    // Shape (u, v) -> (y, z), thickness along x.
    geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    geo.translate(s > 0 ? W / 2 - t : -W / 2, 0, floor);
    g.add(new THREE.Mesh(geo, [mats.face, mats.edge]));
  }
  if (crop) {
    const e = engraving(crop, w, h, renderer);
    e.position.z = floor + 0.004;
    g.add(e);
  }
  g.rotation.set(-Math.PI / 2, 0, 0.12);
  g.userData.viewDir = LOOK_DOWN;
  return g;
}

/** A soft placeholder photo for the frame's window. */
function placeholderPhoto(renderer, w, h) {
  const c = canvas(512, Math.round((512 * h) / w));
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#a9c4d8');
  sky.addColorStop(0.6, '#e9ddd0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f6efe4';
  ctx.beginPath();
  ctx.arc(W * 0.68, H * 0.3, W * 0.09, 0, Math.PI * 2);
  ctx.fill();
  const hill = (y, amp, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y + amp * Math.sin((x / W) * Math.PI * 1.6 + y));
    ctx.lineTo(W, H);
    ctx.fill();
  };
  hill(H * 0.62, H * 0.05, '#93ab9a');
  hill(H * 0.74, H * 0.04, '#728f7b');
  // Two figures, the way a couple's photo would be.
  ctx.fillStyle = '#4f5d62';
  for (const [x, s] of [[0.42, 1], [0.56, 0.92]]) {
    ctx.beginPath();
    ctx.arc(W * x, H * (0.6 - 0.12 * s), W * 0.05 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(W * x, H * 0.82, W * 0.1 * s, H * 0.22 * s, 0, Math.PI, 0);
    ctx.fill();
  }
  return texture(c, renderer);
}

/** The photo frame: a front board with the window, the photo behind it, a back and a stand; the design on the wide bottom. */
function laserFrame(mats, crop, w, h, m, k, renderer) {
  const [W, H] = (m.outerIn || [8.66, 11.4]).map((v) => v * k);
  const [ww, wh] = (m.windowIn || [5.12, 7.09]).map((v) => v * k);
  const top = (m.windowTopIn || 0.9) * k;
  const D = m.depthIn || 0.6;
  const front = D * 0.4;
  const mid = D * 0.2;
  const backT = D - front - mid;
  const wy = H / 2 - top - wh / 2; // the window's centre
  const g = new THREE.Group();
  const outline = () => roundedRect(W, H, 0.08 * k);
  const rectHole = (rw, rh, cy) => {
    const p = new THREE.Path();
    p.moveTo(-rw / 2, cy - rh / 2);
    p.lineTo(-rw / 2, cy + rh / 2);
    p.lineTo(rw / 2, cy + rh / 2);
    p.lineTo(rw / 2, cy - rh / 2);
    p.lineTo(-rw / 2, cy - rh / 2);
    return p;
  };
  const fs = outline();
  fs.holes.push(rectHole(ww, wh, wy));
  const fb = cutSheet(fs, front, mats);
  fb.position.z = mid + front / 2;
  const ms = outline();
  ms.holes.push(rectHole(ww + 0.6 * k, wh + 0.6 * k, wy));
  const mb = cutSheet(ms, mid, mats);
  mb.position.z = mid / 2;
  const bb = cutSheet(outline(), backT, mats);
  bb.position.z = -backT / 2;
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(ww + 0.5 * k, wh + 0.5 * k), new THREE.MeshStandardMaterial({ map: placeholderPhoto(renderer, ww, wh), roughness: 0.5, metalness: 0, envMapIntensity: 0.4 }));
  photo.position.set(0, wy, 0.03);
  g.add(fb, mb, bb, photo);
  // The stand behind: a strut from the back down to the table.
  const sh = H * 0.62;
  g.add(beam(new THREE.Vector3(0, -H / 2 + sh, -backT - 0.1), new THREE.Vector3(0, -H / 2 + 0.06, -backT - H * 0.36), 1.2 * k, 0.2, mats.face));
  if (crop) {
    // The design sits in the middle of the band under the window.
    const bandTop = wy - wh / 2;
    const e = engraving(crop, w, h, renderer);
    e.position.set(0, (bandTop + -H / 2) / 2, mid + front + 0.004);
    g.add(e);
  }
  g.rotation.y = -0.3;
  return g;
}

/** Stitches along a path: short thread dashes, `pitch` apart, on a face at z. */
function stitches(path, z, pitch, colorHex) {
  const len = path.getLength();
  const n = Math.max(2, Math.round(len / pitch));
  const pts = path.getSpacedPoints(n * 2);
  const geo = new THREE.BoxGeometry(1, 0.022, 0.012);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.7, metalness: 0 }), n);
  const o = new THREE.Object3D();
  let count = 0;
  for (let i = 0; i + 1 < pts.length && count < n; i += 2) {
    const a = pts[i];
    const b = pts[i + 1];
    o.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, z);
    o.rotation.set(0, 0, Math.atan2(b.y - a.y, b.x - a.x));
    o.scale.set(Math.max(0.01, a.distanceTo(b) * 0.85), 1, 1);
    o.updateMatrix();
    mesh.setMatrixAt(count++, o.matrix);
  }
  mesh.count = count;
  return mesh;
}
/** A business card sticking out of the holder. */
function cardFace(renderer) {
  const c = canvas(420, 240);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f6f2';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#2f3a45';
  ctx.fillRect(28, 26, 150, 16);
  ctx.fillStyle = '#9aa3ab';
  ctx.fillRect(28, 52, 100, 9);
  ctx.fillStyle = '#c33d3d';
  ctx.fillRect(c.width - 64, 24, 36, 36);
  return texture(c, renderer);
}
/** A slim leather card holder: back panel, a business card, the front pocket with a thumb cut, stitching. */
function laserCardholder(mats, crop, w, h, m, k, renderer, color) {
  const [W, H] = m.outerIn || [3.94, 2.76];
  const D = m.depthIn || 0.18;
  const layer = D * 0.38;
  const r = 0.26;
  const g = new THREE.Group();
  const back = cutSheet(roundedRect(W, H, r), layer, mats, 0.008);
  back.position.z = -D / 2 + layer / 2;
  // Front pocket: lower than the back, with a semicircle thumb cut in its top edge.
  const pocketTop = H / 2 - 0.36;
  const thumb = 0.42;
  const fs = new THREE.Shape();
  fs.moveTo(-W / 2, pocketTop);
  fs.lineTo(-W / 2, -H / 2 + r);
  fs.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + r, -H / 2);
  fs.lineTo(W / 2 - r, -H / 2);
  fs.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + r);
  fs.lineTo(W / 2, pocketTop);
  fs.lineTo(thumb, pocketTop);
  fs.absarc(0, pocketTop, thumb, 0, Math.PI, true);
  fs.lineTo(-W / 2, pocketTop);
  const front = cutSheet(fs, layer, mats, 0.008);
  front.position.z = D / 2 - layer / 2;
  // The card: 3.5 x 2 in, its top 0.4 in above the holder.
  const cw = 3.5;
  const ch = 2;
  const card = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(cw, ch, 0.08), { depth: 0.016, bevelEnabled: false, curveSegments: 8 }), [mat('paper', { map: (() => { const tx = cardFace(renderer); tx.repeat.set(1 / cw, 1 / ch); tx.offset.set(0.5, 0.5); return tx; })() }), mat('paper', { color: '#f2f1ec' })]);
  card.position.set(0, H / 2 + 0.4 - ch / 2, -0.008);
  g.add(back, front, card);
  const thread = color.id === 'black' ? '#77726c' : '#efe4cc';
  const inset = 0.1;
  const ri = r - inset;
  const u = new THREE.Path();
  u.moveTo(-W / 2 + inset, pocketTop - inset);
  u.lineTo(-W / 2 + inset, -H / 2 + inset + ri);
  u.absarc(-W / 2 + inset + ri, -H / 2 + inset + ri, ri, Math.PI, Math.PI * 1.5, false);
  u.lineTo(W / 2 - inset - ri, -H / 2 + inset);
  u.absarc(W / 2 - inset - ri, -H / 2 + inset + ri, ri, Math.PI * 1.5, Math.PI * 2, false);
  u.lineTo(W / 2 - inset, pocketTop - inset);
  g.add(stitches(u, D / 2 + 0.012, 0.11, thread));
  const all = new THREE.Path();
  const ar = roundedRect(W - 2 * inset, H - 2 * inset, ri).getPoints(12);
  all.setFromPoints(ar.concat([ar[0]]));
  g.add(stitches(all, -D / 2 - 0.012, 0.11, thread));
  if (crop) {
    const e = engraving(crop, w, h, renderer);
    e.position.set(0, (pocketTop + -H / 2) / 2 - 0.05, D / 2 + 0.012);
    g.add(e);
  }
  g.rotation.set(-Math.PI / 2, 0, 0.18);
  g.userData.viewDir = LOOK_DOWN;
  return g;
}

/**
 * A round part of a pen, turned about its length (x): `profile` is [x, radius]
 * pairs from left to right. UVs in inches, u along the pen and v round it
 * (so wood grain runs along the barrel), with the seam at the back.
 */
function penPart(profile, R, material) {
  const geo = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(r, x)), 72, Math.PI, Math.PI * 2);
  geo.rotateZ(-Math.PI / 2); // the lathe's axis (y) along x; its front (+z) stays in front
  const uv = geo.attributes.uv;
  const p = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), (0.5 - uv.getX(i)) * Math.PI * 2 * R);
  uv.needsUpdate = true;
  return new THREE.Mesh(geo, material);
}
/**
 * The ballpoint pen, lying down: the cap with its clip on the left, a chrome
 * ring, the barrel and the tapered tip on the right. The engraving runs along
 * the barrel between the ring and the tip, on the side facing the camera.
 */
function laserPen(look, mats, crop, w, h, m, renderer) {
  const L = m.lengthIn || 5.6;
  const R = (m.diameterIn || 0.43) / 2;
  const x0 = -L / 2;
  const x1 = L / 2;
  const body = mats.face; // the coated metal or the bamboo
  // (Bamboo: a finer grain than on a board, so a few straight fibres show across the thin barrel.)
  if (look === 'wood') for (const tx of [body.map, body.bumpMap]) tx.repeat.set(1 / 5, 1 / 5);
  const steel = look === 'metal' ? mats.edge : chrome();
  const xr = x0 + 1.5; // the cap's ring
  const ringW = 0.1;
  const xt = x1 - 0.62; // where the tip starts
  const g = new THREE.Group();
  // End button, cap, ring, barrel (closed at the tip end), tip and the ball.
  const dome = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 6) * (Math.PI / 2);
    return [x0 + 0.07 * (1 - Math.cos(a)), 0.15 * Math.sin(a)];
  });
  g.add(penPart([...dome, [x0 + 0.17, 0.15]], R, steel));
  g.add(penPart([[x0 + 0.15, 0], [x0 + 0.15, 0.16], [x0 + 0.16, 0.19], [x0 + 0.19, R - 0.007], [x0 + 0.24, R], [xr + 0.01, R]], R, body));
  g.add(penPart([[xr, R - 0.012], [xr + 0.008, R + 0.008], [xr + ringW - 0.008, R + 0.008], [xr + ringW, R - 0.012]], R, steel));
  g.add(penPart([[xr + ringW - 0.01, R], [xt - 0.45, R], [xt - 0.2, R - 0.006], [xt - 0.02, R - 0.02], [xt, R - 0.03], [xt, 0]], R, body));
  const tip = [];
  for (let i = 0; i <= 10; i++) {
    const s = i / 10;
    tip.push([xt - 0.01 + s * (x1 - 0.08 - xt + 0.01), R - 0.04 - (R - 0.04 - 0.045) * Math.pow(s, 1.25)]);
  }
  tip.push([x1 - 0.04, 0.032], [x1 - 0.015, 0.02], [x1, 0]);
  g.add(penPart(tip, R, steel));
  // The clip on top of the cap: a foot on the cap, an arm over it and a rounded end resting on the barrel.
  const xa = x0 + 0.17;
  const xe = x0 + 1.85;
  const s = new THREE.Shape();
  s.moveTo(xa, R - 0.05);
  s.lineTo(xa, R + 0.06);
  s.quadraticCurveTo(xa, R + 0.088, xa + 0.05, R + 0.088);
  s.lineTo(xe - 0.12, R + 0.058);
  s.quadraticCurveTo(xe, R + 0.055, xe, R + 0.018);
  s.quadraticCurveTo(xe, R - 0.008, xe - 0.08, R - 0.006);
  s.lineTo(xe - 0.17, R + 0.018);
  s.lineTo(xa + 0.36, R + 0.046);
  s.lineTo(xa + 0.3, R - 0.05);
  s.lineTo(xa, R - 0.05);
  const cw = 0.1;
  const clipGeo = new THREE.ExtrudeGeometry(s, { depth: cw, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 3, curveSegments: 12 });
  clipGeo.translate(0, 0, -cw / 2);
  g.add(new THREE.Mesh(clipGeo, steel));
  if (crop) {
    // Along the barrel, in the middle of the part between the ring and the tip.
    const e = engraving(crop, w, h, renderer, { radius: R + 0.003, metal: look === 'metal' });
    e.position.x = (xr + ringW + xt) / 2;
    g.add(e);
  }
  // Rolled a little towards the camera (which looks from a little above), the clip going back over the top.
  const lift = 0.42;
  g.rotation.x = -lift;
  g.userData.viewDir = new THREE.Vector3(0, Math.sin(lift), Math.cos(lift));
  g.userData.fitWidth = true;
  g.userData.shadow = [L * 1.1, 0.9];
  return g;
}

/**
 * A closed bifold leather wallet, lying face up: the two halves joined by the
 * rounded fold (the spine) on the left, open on the other three edges (the
 * card pockets' layers show between them), stitched round the front and back.
 * The engraving sits where the print area is on the 2D mockup.
 */
function laserWallet(mats, crop, w, h, m, renderer, color, side) {
  const [W, H] = m.outerIn || [4.33, 3.54];
  const D = m.depthIn || 0.45;
  const t = 0.07; // each half's outer leather
  const S = D / 2; // the fold's radius
  const xs = -W / 2 + S; // where the fold meets the flat halves
  const r = 0.24; // the open corners' radius
  const bevel = 0.01;
  /** A panel from the fold to the right edge, `inset` in from the open edges, rounded at the open corners. */
  const panel = (inset = 0, from = xs) => {
    const x2 = W / 2 - inset;
    const y2 = H / 2 - inset;
    const rr = Math.max(0.02, r - inset);
    const p = new THREE.Shape();
    p.moveTo(from, -y2);
    p.lineTo(x2 - rr, -y2);
    p.quadraticCurveTo(x2, -y2, x2, -y2 + rr);
    p.lineTo(x2, y2 - rr);
    p.quadraticCurveTo(x2, y2, x2 - rr, y2);
    p.lineTo(from, y2);
    p.lineTo(from, -y2);
    return p;
  };
  const g = new THREE.Group();
  for (const sgn of [1, -1]) {
    const outer = cutSheet(panel(), t, mats, bevel);
    outer.position.z = sgn * (D / 2 - t / 2);
    g.add(outer);
    // The pockets inside each half, a little further in from the edges each, and their edges a shade darker.
    [[0.03, 0.055], [0.075, 0.07]].forEach(([inset, th], i) => {
      const inner = { face: mats.face, edge: mats.edge.clone() };
      inner.edge.color.multiplyScalar(i ? 0.72 : 0.86);
      const layer = cutSheet(panel(inset, xs - 0.02), th, inner);
      const top = D / 2 - t - 0.004 - (i ? 0.059 : 0);
      layer.position.z = sgn * (top - th / 2);
      g.add(layer);
    });
  }
  // The dark slit between the two halves.
  const dark = new THREE.MeshStandardMaterial({ color: '#120d0b', roughness: 1 });
  g.add(cutSheet(panel(0.13, xs - 0.02), 0.03, { face: dark, edge: dark }));
  // The fold: a half tube of leather round the left edge, its cut ends at the top and bottom.
  // (As thick as the halves with their rounded edges, so the fold meets their faces flush.)
  const fold = new THREE.Shape();
  fold.absarc(xs, 0, S + bevel, Math.PI / 2, Math.PI * 1.5, false);
  fold.lineTo(xs, -S + t);
  fold.absarc(xs, 0, S - t, Math.PI * 1.5, Math.PI / 2, true);
  fold.lineTo(xs, S + bevel);
  const foldGeo = new THREE.ExtrudeGeometry(fold, { depth: H, bevelEnabled: false, curveSegments: 32 });
  foldGeo.rotateX(Math.PI / 2); // the shape's y becomes z (thickness), its length runs along y
  foldGeo.translate(0, H / 2, 0);
  g.add(new THREE.Mesh(foldGeo, [mats.edge, mats.face]));
  // Stitching round each face, a little in from the edges (further from the fold), as on the 2D mockup.
  const thread = color.id === 'black' ? '#77726c' : '#efe4cc';
  const inset = 0.15;
  const sx0 = xs + 0.2;
  const sx1 = W / 2 - inset;
  const sy = H / 2 - inset;
  const rs = r - inset * 0.6;
  const path = new THREE.Path();
  path.moveTo(sx0, -sy + 0.08);
  path.quadraticCurveTo(sx0, -sy, sx0 + 0.08, -sy);
  path.lineTo(sx1 - rs, -sy);
  path.quadraticCurveTo(sx1, -sy, sx1, -sy + rs);
  path.lineTo(sx1, sy - rs);
  path.quadraticCurveTo(sx1, sy, sx1 - rs, sy);
  path.lineTo(sx0 + 0.08, sy);
  path.quadraticCurveTo(sx0, sy, sx0, sy - 0.08);
  path.lineTo(sx0, -sy + 0.08);
  g.add(stitches(path, D / 2 + bevel + 0.004, 0.11, thread));
  g.add(stitches(path, -D / 2 - bevel - 0.004, 0.11, thread));
  if (crop) {
    // The print area's place on the front, from the 2D mockup (wallet x 70..430, y 170..440).
    const MOCK = { x: 70, y: 170, w: 360, h: 270 };
    const pa = side.printArea;
    const e = engraving(crop, w, h, renderer);
    e.position.set(
      ((pa.x + pa.w / 2 - (MOCK.x + MOCK.w / 2)) / MOCK.w) * W,
      -((pa.y + pa.h / 2 - (MOCK.y + MOCK.h / 2)) / MOCK.h) * H,
      D / 2 + bevel + 0.004,
    );
    g.add(e);
  }
  g.rotation.set(-Math.PI / 2, 0, 0.16);
  g.userData.viewDir = LOOK_DOWN;
  return g;
}

// --- Cut pieces: the design's own outline ---
let traceLoading = null;
/** The outline tracer (public/js/trace.js), loaded once when first needed. */
function loadTrace() {
  if (window.POD_TRACE) return Promise.resolve(window.POD_TRACE);
  if (!traceLoading) {
    traceLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/js/trace.js';
      s.async = true;
      s.onload = () => (window.POD_TRACE ? resolve(window.POD_TRACE) : reject(new Error('trace.js did not load')));
      s.onerror = () => reject(new Error('trace.js did not load'));
      document.head.appendChild(s);
    }).catch((e) => {
      traceLoading = null;
      throw e;
    });
  }
  return traceLoading;
}
function traceFailed(e) {
  console.warn('3D preview: could not trace the design', e);
  return null;
}
function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return a / 2;
}
function inside(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
/**
 * Even out the pixel steps a traced outline keeps on slopes and curves (they
 * show as stripes on a shiny cut edge), keeping real corners: sharp turns
 * between two long sides. `px` is one pixel in the outline's units.
 */
function smoothOutline(pts, px) {
  const n = pts.length;
  if (n < 5) return pts;
  // A corner: the outline turns sharply when looked at 4 px either side.
  const reach = 4 * px;
  const far = (i, step) => {
    let j = i;
    for (let k = 0; k < n - 1; k++) {
      j = (j + step + n) % n;
      if (pts[j].distanceTo(pts[i]) >= reach) break;
    }
    return pts[j];
  };
  const corner = pts.map((p, i) => {
    const a = far(i, -1);
    const b = far(i, 1);
    const ax = p.x - a.x;
    const ay = p.y - a.y;
    const bx = b.x - p.x;
    const by = b.y - p.y;
    return (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1) < Math.cos(0.85);
  });
  const next = pts.map((p) => p.clone());
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      if (corner[i]) continue;
      const a = pts[(i + n - 1) % n];
      const b = pts[(i + 1) % n];
      next[i].set(pts[i].x * 0.5 + (a.x + b.x) * 0.25, pts[i].y * 0.5 + (a.y + b.y) * 0.25);
    }
    for (let i = 0; i < n; i++) pts[i].copy(next[i]);
  }
  return pts;
}
/**
 * The design's outline in inches (centred on the print area, y up): contours
 * nested by containment (even depth = solid, odd = a hole), plus the
 * downsampled alpha for finding edges. Null when the design is empty.
 */
async function designOutline(crop, wIn) {
  if (!crop) return null;
  const sc = Math.min(1, 600 / Math.max(crop.width, crop.height));
  const cw = Math.max(2, Math.round(crop.width * sc));
  const ch = Math.max(2, Math.round(crop.height * sc));
  const c = canvas(cw, ch);
  const ctx = c.getContext('2d');
  ctx.drawImage(crop, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  const alpha = new Uint8Array(cw * ch);
  let any = false;
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = data[i * 4 + 3];
    if (alpha[i] >= 128) any = true;
  }
  if (!any) return null;
  const T = await loadTrace();
  const res = T.trace(alpha, cw, ch, { threshold: 128, simplify: 1 });
  const s = wIn / cw; // inches per pixel
  const list = [];
  for (const ct of (res && res.contours) || []) {
    const pts = [];
    for (const pt of ct.points || []) {
      const x = Array.isArray(pt) ? pt[0] : pt.x;
      const y = Array.isArray(pt) ? pt[1] : pt.y;
      const v = new THREE.Vector2((x - cw / 2) * s, (ch / 2 - y) * s);
      const last = pts[pts.length - 1];
      if (!last || last.distanceToSquared(v) > 1e-10) pts.push(v);
    }
    if (pts.length > 2 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-10) pts.pop();
    smoothOutline(pts, s);
    const area = Math.abs(polyArea(pts));
    if (pts.length < 3 || area < 4 * s * s) continue; // specks
    list.push({ pts, area, parent: null, depth: 0, children: [] });
  }
  if (!list.length) return null;
  // Nesting: each contour's parent is the smallest bigger contour around it.
  for (const a of list) {
    const probes = [0, 0.33, 0.66].map((f) => {
      const i = Math.floor(f * a.pts.length);
      const p = a.pts[i];
      const q = a.pts[(i + 1) % a.pts.length];
      return new THREE.Vector2((p.x + q.x) / 2, (p.y + q.y) / 2);
    });
    for (const b of list) {
      if (b === a || b.area <= a.area) continue;
      if (probes.filter((p) => inside(p, b.pts)).length >= 2 && (!a.parent || b.area < a.parent.area)) a.parent = b;
    }
  }
  for (const a of list) {
    for (let p = a.parent; p; p = p.parent) a.depth++;
    if (a.parent) a.parent.children.push(a);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of list) {
    if (a.depth) continue;
    for (const p of a.pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { list, s, cw, ch, alpha, box: { minX, minY, maxX, maxY } };
}
/** THREE shapes for the solid parts (even depth), each with its holes. */
function solidShapes(contours) {
  return contours.filter((c) => c.depth % 2 === 0).map((c) => {
    const sh = new THREE.Shape(c.pts);
    for (const h of c.children) sh.holes.push(new THREE.Path(h.pts));
    return sh;
  });
}
/**
 * Smooth the shading of an extrusion's cut edge where neighbouring wall faces
 * meet at a shallow angle (a traced outline's many short segments), keeping
 * real corners sharp.
 */
function creaseEdges(geo, maxAngle = 0.6) {
  const grp = geo.groups.find((gr) => gr.materialIndex === 1);
  if (!grp) return geo;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const orig = nrm.array.slice();
  const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const at = new Map();
  const end = Math.min(pos.count, grp.start + grp.count);
  for (let i = grp.start; i < end; i++) {
    const k = key(i);
    if (!at.has(k)) at.set(k, []);
    at.get(k).push(i);
  }
  const cos = Math.cos(maxAngle);
  const n = new THREE.Vector3();
  for (let i = grp.start; i < end; i++) {
    const [ax, ay, az] = [orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]];
    n.set(0, 0, 0);
    for (const j of at.get(key(i))) {
      const [bx, by, bz] = [orig[j * 3], orig[j * 3 + 1], orig[j * 3 + 2]];
      if (ax * bx + ay * by + az * bz >= cos) n.add(new THREE.Vector3(bx, by, bz));
    }
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  return geo;
}
function extrudeShapes(shapes, depth, mats) {
  const geo = creaseEdges(new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1 }));
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, [mats.face, mats.edge]);
}
/**
 * Where a stick can join the piece near column x (inches): the column whose
 * solid part reaches lowest, the y of that bottom and how far up it stays solid.
 */
function stickSpot(o, xIn) {
  const col = Math.round(xIn / o.s + o.cw / 2);
  const span = Math.max(2, Math.round(o.cw * 0.08));
  let best = null;
  for (let x = Math.max(0, col - span); x <= Math.min(o.cw - 1, col + span); x++) {
    let y = o.ch - 1;
    while (y >= 0 && o.alpha[y * o.cw + x] < 128) y--;
    if (y < 0) continue;
    let run = 0;
    while (y - run >= 0 && o.alpha[(y - run) * o.cw + x] >= 128) run++;
    const score = y * 4 - Math.abs(x - col); // lowest first, then nearest
    if (!best || score > best.score) best = { score, x, y, run };
  }
  if (!best) return null;
  return { x: (best.x + 0.5 - o.cw / 2) * o.s, y: (o.ch / 2 - best.y - 1) * o.s, run: best.run * o.s };
}
/** The highest solid point near the middle (for the hanging loop). */
function topPoint(o) {
  const cx = Math.round(((o.box.minX + o.box.maxX) / 2) / o.s + o.cw / 2);
  const span = Math.max(3, Math.round(o.cw * 0.12));
  let best = { y: o.ch, x: cx };
  for (let x = Math.max(0, cx - span); x <= Math.min(o.cw - 1, cx + span); x++) {
    for (let y = 0; y < best.y; y++) {
      if (o.alpha[y * o.cw + x] >= 128) {
        if (y < best.y || (y === best.y && Math.abs(x - cx) < Math.abs(best.x - cx))) best = { x, y };
        break;
      }
    }
  }
  if (best.y >= o.ch) return { x: (o.box.minX + o.box.maxX) / 2, y: o.box.maxY };
  return { x: (best.x + 0.5 - o.cw / 2) * o.s, y: (o.ch / 2 - best.y) * o.s };
}

/** A simple round cake on a plate, its top at y = 0. */
function cake(radius) {
  const g = new THREE.Group();
  const hgt = Math.max(3.2, radius * 0.85);
  const fondant = new THREE.MeshPhysicalMaterial({ color: '#f6dde5', roughness: 0.6, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color('#ffffff'), envMapIntensity: 0.5 });
  const cream = new THREE.MeshStandardMaterial({ color: '#fcf1f4', roughness: 0.55, metalness: 0, envMapIntensity: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, hgt, 96), fondant);
  body.position.y = -hgt / 2;
  const pipe = (y, r, tube) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 12, 96), cream);
    t.rotation.x = Math.PI / 2;
    t.position.y = y;
    return t;
  };
  // Pearls round the top edge and a piped border at the bottom.
  const pearls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 12, 8), cream, 64);
  const o = new THREE.Object3D();
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    o.position.set(Math.cos(a) * (radius - 0.05), 0.02, Math.sin(a) * (radius - 0.05));
    o.updateMatrix();
    pearls.setMatrixAt(i, o.matrix);
  }
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(radius + 1.3, radius + 1.1, 0.25, 96), new THREE.MeshPhysicalMaterial({ color: '#fbfbfa', roughness: 0.15, clearcoat: 1, metalness: 0 }));
  plate.position.y = -hgt - 0.125;
  g.add(body, pearls, pipe(-hgt + 0.2, radius + 0.04, 0.22), plate);
  return g;
}

/**
 * Cut pieces (cake toppers, hanging decorations): the design's outline cut
 * out of the sheet, standing on a cake or hanging on a string.
 */
async function laserCutout(mats, crop, w, h, m, renderer) {
  const depth = m.depthIn || 0.12;
  const o = await designOutline(crop, w).catch(traceFailed);
  const g = new THREE.Group();
  let piece;
  let box;
  if (o) {
    piece = extrudeShapes(solidShapes(o.list), depth, mats);
    box = o.box;
  } else {
    // Nothing designed yet: a plain blank of the material.
    piece = cutSheet(roundedRect(w * 0.8, h * 0.5, 0.3), depth, mats);
    box = { minX: -w * 0.4, maxX: w * 0.4, minY: -h * 0.25, maxY: h * 0.25 };
  }
  const bw = box.maxX - box.minX;
  if (m.scene === 'cake') {
    // Stood on the cake on two sticks cut with it, pushed in.
    const R = Math.max(3, Math.min(5.5, bw * 0.6));
    const lift = 1.5;
    piece.position.y = -box.minY + lift;
    const stickW = Math.max(0.16, Math.min(0.26, bw * 0.03));
    for (const f of [0.28, 0.72]) {
      const spot = (o && stickSpot(o, box.minX + bw * f)) || { x: box.minX + bw * f, y: box.minY, run: 0.3 };
      // Joined a little way up into the piece (no further than it stays solid).
      const y0 = spot.y - box.minY + lift + Math.max(0.02, Math.min(0.3, spot.run - 0.02));
      const st = new THREE.Mesh(new THREE.BoxGeometry(stickW, y0 + 1.6, depth * 0.96), mats.face);
      st.position.set(spot.x, (y0 - 1.6) / 2, 0);
      g.add(st);
    }
    g.add(piece, cake(R));
    g.rotation.y = -0.25;
    return g;
  }
  g.add(piece);
  if (m.hang) {
    // A small ring through the top and a cord up to where it hangs.
    const top = o ? topPoint(o) : { x: 0, y: box.maxY };
    const ringR = Math.max(0.16, bw * 0.02);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.03, 10, 32), new THREE.MeshStandardMaterial({ color: '#c8a456', metalness: 1, roughness: 0.25 }));
    ring.rotation.y = Math.PI / 2;
    ring.position.set(top.x, top.y + ringR * 0.55, 0);
    const len = Math.max(3, (box.maxY - box.minY) * 0.45);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), new THREE.MeshStandardMaterial({ color: '#b39a6a', roughness: 0.8, metalness: 0 }));
    cord.position.set(top.x, top.y + ringR * 1.5 + len / 2, 0);
    g.add(ring, cord);
  }
  g.rotation.y = -0.3;
  return g;
}

/** The name puzzle: a board with the letters as thick pieces in matching holes, one lifted out. */
async function laserPuzzle(color, crop, w, h, m, renderer) {
  const T = m.depthIn || 0.35;
  const baseT = 0.12;
  const board = laserMats('wood', color.hex, renderer, false);
  const o = await designOutline(crop, w).catch(traceFailed);
  const g = new THREE.Group(); // built face up in +z
  const margin = 0.3;
  const outer = () => roundedRect(w + 2 * margin, h + 2 * margin, 0.3);
  const base = cutSheet(outer(), baseT, board);
  base.position.z = -baseT / 2;
  g.add(base);
  const topShape = outer();
  if (o) for (const c of o.list) if (c.depth === 0) topShape.holes.push(new THREE.Path(c.pts));
  const top = cutSheet(topShape, T, board);
  top.position.z = T / 2;
  g.add(top);
  if (o) {
    // Islands of the board inside the letters (the middle of an O or A).
    const islands = o.list.filter((c) => c.depth % 2 === 1).map((c) => {
      const sh = new THREE.Shape(c.pts);
      for (const ch of c.children) sh.holes.push(new THREE.Path(ch.pts));
      return sh;
    });
    if (islands.length) {
      const isl = extrudeShapes(islands, T, board);
      isl.position.z = T / 2;
      g.add(isl);
    }
    const palette = ['#e03131', '#f08c00', '#fab005', '#2f9e44', '#1c7ed6', '#7048e8', '#e64980', '#0ca678'];
    const paint = (hex) => {
      const p = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0, envMapIntensity: 0.55 });
      return { face: p, edge: p };
    };
    const lettersWood = color.id === 'natural' ? laserMats('wood', color.ink || color.hex, renderer, false) : null;
    const centreX = (c) => c.pts.reduce((sum, p) => sum + p.x, 0) / c.pts.length;
    const pieces = o.list.filter((c) => c.depth % 2 === 0).sort((a, b) => centreX(a) - centreX(b));
    // The piece lifted out: the rightmost of the big ones (not a dot).
    const biggest = Math.max(...pieces.map((c) => c.area));
    let lifted = -1;
    if (pieces.length > 1) pieces.forEach((c, i) => { if (c.area >= biggest * 0.4) lifted = i; });
    pieces.forEach((c, i) => {
      const sh = new THREE.Shape(c.pts);
      for (const hl of c.children) sh.holes.push(new THREE.Path(hl.pts));
      const mats = lettersWood || paint(color.id === 'rainbow' ? palette[i % palette.length] : color.ink || color.hex);
      const lt = T - 0.03;
      const piece = extrudeShapes([sh], lt, mats);
      piece.position.z = lt / 2 + 0.001;
      if (i === lifted) {
        // Lifted up and tilted, as if a child just picked it out.
        let cx = 0;
        let cy = 0;
        for (const p of c.pts) { cx += p.x; cy += p.y; }
        cx /= c.pts.length;
        cy /= c.pts.length;
        const pivot = new THREE.Group();
        pivot.position.set(cx, cy, T * 2.2);
        piece.position.set(-cx, -cy, 0);
        pivot.rotation.set(0.28, -0.22, 0.08);
        pivot.add(piece);
        g.add(pivot);
      } else g.add(piece);
    });
  }
  g.rotation.set(-Math.PI / 2, 0, 0.1);
  g.userData.viewDir = LOOK_DOWN;
  return g;
}

/** Every laser product (engraved or cut); cut ones come back as a promise (the outline is traced). */
function buildLaser(m, color, tex, renderer, product) {
  const side = product.sides[0];
  const t = tex[side.id];
  const { w, h, k } = printSize(side, t);
  const look = laserLook(color, product);
  const painted = look === 'wood' && color.id === 'white';
  const crop = designCrop(t);
  if (m.type === 'puzzle') return laserPuzzle(color, crop, w, h, m, renderer);
  const mats = look === 'clear' ? null : laserMats(look, color.hex, renderer, painted);
  if (m.type === 'cutout') return laserCutout(mats || laserMats('acrylic', color.hex, renderer), crop, w, h, m, renderer);
  if (m.type === 'pad') return laserCoasters(mats, crop, w, h, m, renderer);
  if (m.type === 'tray') return laserTray(mats, crop, w, h, m, k, renderer);
  if (m.type === 'frame') return laserFrame(mats, crop, w, h, m, k, renderer);
  if (m.type === 'cardholder') return laserCardholder(mats, crop, w, h, m, k, renderer, color);
  if (m.type === 'pen') return laserPen(look, mats, crop, w, h, m, renderer);
  if (m.type === 'wallet') return laserWallet(mats, crop, w, h, m, renderer, color, side);
  return laserBlock(look, mats, crop, w, h, m, renderer);
}

function contactShadow(width, y, depth = width * 0.55) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.28)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 256, 256);
  const tx = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

export function mount(container, { product, color, textures, spin = true, viewScale = 1 }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  // No tone mapping: a print preview must show the artwork's true colours.
  renderer.toneMapping = THREE.NoToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a6, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(4, 7, 9);
  scene.add(sun);
  // A softer light from behind so the back of a product isn't left in shadow as it turns.
  const back = new THREE.DirectionalLight(0xffffff, 1.05);
  back.position.set(-4, 5, -9);
  scene.add(back);

  const m = product.model;
  const hex = color.hex;
  let obj;
  // Laser products (cut ones come back as a promise: their outline is traced first).
  if (m.material === 'laser' || product.laser) obj = buildLaser(m, color, textures, renderer, product);
  else if (m.type === 'mug' && product.sides.length > 1) {
    // A set of mugs (couple mugs): one per side, side by side.
    obj = new THREE.Group();
    product.sides.forEach((sd, i) => {
      const mug = buildMug(m, hex, textures, renderer, product, sd);
      mug.position.x = (i - (product.sides.length - 1) / 2) * m.diameterIn * 1.9;
      mug.rotation.y = i ? -0.6 : -0.1;
      obj.add(mug);
    });
  } else if (m.type === 'mug') obj = buildMug(m, hex, textures, renderer, product);
  else if (m.type === 'bottle') obj = buildBottle(m, hex, textures, renderer, product);
  else if (m.type === 'frame') obj = buildFrame(hex, textures, renderer, product);
  else if (m.type === 'pad') obj = buildPad(hex, textures, renderer, product);
  else if (m.type === 'tent') obj = buildTent(hex, textures, renderer, product);
  else if (m.type === 'deskcal') obj = buildDeskCal(hex, textures, renderer, product);
  else if (m.type === 'wallcal') obj = buildWallCal(hex, textures, renderer, product);
  else if (m.type === 'banner') obj = buildBanner(hex, textures, renderer, product);
  else if (m.type === 'bookmark') obj = buildBookmark(hex, textures, renderer, product);
  else if (m.type === 'block') obj = buildBlock(hex, textures, renderer, product);
  else if (m.type === 'foldcard') obj = buildFoldCard(hex, textures, renderer, product);
  else if (m.type === 'canvas') obj = buildCanvas(color && color.id, textures, renderer, product);
  else if (m.type === 'cloth') obj = buildCloth(hex, textures, renderer, product);
  else if (m.type === 'case') obj = buildCase(hex, textures, renderer, product);
  else if (m.type === 'notebook') obj = buildNotebook(hex, textures, renderer, product);
  else if (m.type === 'pillow') obj = buildPillow(m, hex, textures, renderer, product);
  else obj = buildCard(hex, textures, renderer, product);

  // Fit the whole product in view on any screen shape (phones are narrow, so
  // the horizontal field of view often decides), and keep the depth range
  // tight: many phones have a 16-bit depth buffer, and a wide near/far range
  // makes nearby surfaces flicker into stripes (z-fighting).
  let radius = 1;
  let wide = null; // a long, thin product (a pen): its half sizes, fitted to fill the view's width
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 100);
  let viewDir = new THREE.Vector3(0.18, 0.16, 0.97).normalize();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = spin;
  controls.autoRotateSpeed = 1.6;
  let fitted = 0;
  const fit = (aspect) => {
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const dist = wide
      ? Math.max(wide.x / Math.tan(halfH), Math.max(wide.y, wide.z) / Math.tan(halfV)) * 1.12
      : (radius / Math.sin(Math.min(halfV, halfH))) * 1.05;
    controls.minDistance = dist * 0.45;
    controls.maxDistance = dist * 2.2;
    camera.near = Math.max(dist * 0.03, dist * 0.45 - radius * 1.45);
    camera.far = dist * 2.2 + radius * 2;
    // Keep the current viewing direction; only the distance changes.
    const dir = fitted ? camera.position.clone().sub(controls.target).normalize() : viewDir;
    const cur = fitted ? camera.position.distanceTo(controls.target) / fitted : 1;
    camera.position.copy(controls.target).addScaledVector(dir, dist * cur);
    fitted = dist;
  };

  const resize = () => {
    const w = container.clientWidth || 400;
    const h = container.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fit(camera.aspect);
    camera.updateProjectionMatrix();
    controls.update();
  };
  let disposed = false;
  const place = (o) => {
    if (disposed || !o) return;
    scene.add(o);
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    o.position.sub(center);
    const sh = o.userData.shadow;
    scene.add(sh ? contactShadow(sh[0], -size.y / 2 - 0.05, sh[1]) : contactShadow(Math.max(size.x, size.z) * 1.6, -size.y / 2 - 0.05));
    // A smaller size of the product (viewScale < 1) stays as far away as the biggest one: it looks smaller.
    const vs = Math.max(0.3, Math.min(1, viewScale || 1));
    radius = (Math.max(size.x, size.y, size.z) * 0.62) / vs;
    wide = o.userData.fitWidth ? size.clone().multiplyScalar(0.5 / vs) : null;
    if (o.userData.viewDir) viewDir = o.userData.viewDir;
    fitted = 0;
    resize();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  let ready;
  if (obj && typeof obj.then === 'function') {
    resize();
    ready = obj.then(place, (e) => console.warn('3D preview:', e));
  } else {
    place(obj);
    ready = Promise.resolve();
  }

  container.__pod3d = { camera, controls, ready, scene }; // for tests and debugging
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    setSpin(on) {
      controls.autoRotate = on;
    },
    snapshot() {
      renderer.render(scene, camera);
      return new Promise((resolve) => renderer.domElement.toBlob(resolve, 'image/png'));
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); });
      });
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
