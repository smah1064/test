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
  if (m.handle !== false) g.add(handle);
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

/** An upright block: acrylic photo blocks and keychains (clear edges) or foam-board signs. */
function buildBlock(color, tex, renderer, product) {
  const side = product.sides[0];
  const m = product.model || {};
  const w = side.printWidthIn;
  const h = side.printHeightIn;
  const r = Math.min(m.radiusIn != null ? m.radiusIn : 0.1, w / 2 - 0.001, h / 2 - 0.001);
  const face = texture(faceCanvas(m.clear ? '#f7f9fb' : color, designCrop(tex[side.id]), 1600, (1600 * h) / w), renderer);
  const edge = m.clear
    ? new THREE.MeshPhysicalMaterial({ color: '#dfeaf0', roughness: 0.05, metalness: 0, transmission: 0.6, transparent: true, opacity: 0.55, thickness: 0.5 })
    : mat('paper', { color: m.edge || '#f4f4f2' });
  const mesh = slab(w, h, r, m.depthIn || 0.5, face, edge, m.material || 'plastic');
  const back = product.sides[1];
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
  const fg = new THREE.PlaneGeometry(w, h, 48, 1);
  const bg = new THREE.PlaneGeometry(w, h, 48, 1);
  if (!depth) {
    bend(fg, 1);
    bend(bg, 1);
  }
  // The renders already carry the photo's own light and shading, so show them
  // unlit: the front and back then look the same whichever way the panel faces.
  const photoMat = (cv) => new THREE.MeshBasicMaterial({ map: texture(cv, renderer), alphaTest: 0.5 });
  const fm = new THREE.Mesh(fg, photoMat(front));
  const bm = new THREE.Mesh(bg, photoMat(backCv));
  bm.rotation.y = Math.PI;
  if (depth) {
    fm.position.z = depth / 2;
    bm.position.z = -depth / 2;
    for (const wall of bagWalls(firstImg, w, h, depth, m)) g.add(wall);
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
function bagWalls(img, w, h, depth, m) {
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
  if (top < 0) return [];
  const toX = (px) => (px / sw - 0.5) * w;
  const toY = (py) => (0.5 - py / sh) * h;
  // Tucked in a little so the walls stay behind rounded corners and seams.
  const inset = (right - left) * 0.015;
  const xL = toX(left + 0.5 + inset);
  const xR = toX(right + 0.5 - inset);
  const yT = toY(top + (bottom - top) * 0.04);
  const yB = toY(bottom + 1 - (bottom - top) * 0.015);
  // The edge colour, a little darker: the sides face away from the light.
  const col = new THREE.Color(`rgb(${Math.round((rs / n) * 0.88)}, ${Math.round((gs / n) * 0.88)}, ${Math.round((bs / n) * 0.88)})`);
  const wallMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const plane = (pw, ph) => new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), wallMat);
  const walls = [];
  const bodyH = yT - yB;
  const bodyW = xR - xL;
  for (const x of [xL, xR]) {
    const s = plane(depth, bodyH);
    s.rotation.y = Math.PI / 2;
    s.position.set(x, (yT + yB) / 2, 0);
    walls.push(s);
  }
  const b = plane(bodyW, depth);
  b.rotation.x = -Math.PI / 2;
  b.position.set((xL + xR) / 2, yB, 0);
  walls.push(b);
  if (m.closedTop) {
    const t = plane(bodyW, depth);
    t.rotation.x = Math.PI / 2;
    t.position.set((xL + xR) / 2, yT, 0);
    walls.push(t);
  }
  return walls;
}

function contactShadow(width, y) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.28)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 256, 256);
  const tx = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.55), new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

export function mount(container, { product, color, textures, spin = true }) {
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
  if (m.type === 'mug' && product.sides.length > 1) {
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
  else if (m.type === 'block') obj = buildBlock(hex, textures, renderer, product);
  else if (m.type === 'case') obj = buildCase(hex, textures, renderer, product);
  else if (m.type === 'notebook') obj = buildNotebook(hex, textures, renderer, product);
  else if (m.type === 'pillow') obj = buildPillow(m, hex, textures, renderer, product);
  else obj = buildCard(hex, textures, renderer, product);
  scene.add(obj);

  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  scene.add(contactShadow(Math.max(size.x, size.z) * 1.6, -size.y / 2 - 0.05));

  // Fit the whole product in view on any screen shape (phones are narrow, so
  // the horizontal field of view often decides), and keep the depth range
  // tight: many phones have a 16-bit depth buffer, and a wide near/far range
  // makes nearby surfaces flicker into stripes (z-fighting).
  const radius = Math.max(size.x, size.y, size.z) * 0.62;
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 100);
  const viewDir = new THREE.Vector3(0.18, 0.16, 0.97).normalize();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = spin;
  controls.autoRotateSpeed = 1.6;
  let fitted = 0;
  const fit = (aspect) => {
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const dist = (radius / Math.sin(Math.min(halfV, halfH))) * 1.05;
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
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  container.__pod3d = { camera, controls }; // for tests and debugging
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
