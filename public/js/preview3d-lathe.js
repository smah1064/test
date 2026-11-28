/* 3D model of round drinkware measured for "New product from photo" (slice 1): a cup or tumbler turned on a
 * lathe from its measured side profile, so a tapered body is tapered in 3D too.
 *
 * The model (from src/drinkware.js applyTo): p.model = { type:'mug', diameterIn, heightIn, material, handle, lid,
 *   profile:[[yIn, rIn], ...]   y from the rim (0) down to the base, r the outside radius there,
 *   band:{ y0In, y1In, phi }    the print band (y from the rim) and the angle round the cup that is printed,
 *   finish:'gloss'|'matte'|'metal' }
 * Optional, read defensively: m.handleBand = { y0In, y1In } (or m.handle as that object) for where the handle meets
 * the body; without it the handle sits on the upper part of the body like a mug's.
 *
 * UVs: u = angle (0 at the back, 0.5 at the front, the seam at the back), v = arc length along the profile, so the
 * customer's design (the unrolled rectangle) drawn into the band covers phi of the circumference at every height:
 * on a tapered body it narrows towards the narrow end exactly as the fan print file does.
 *
 * No imports: three.js and the shared canvas helpers come in `helpers` ({ THREE, canvas, texture, designCrop, mat }),
 * so the pure maths below also loads in node for the unit tests.
 */

const TAU = Math.PI * 2;
export const SEGMENTS = 96;
export const WRAP_W = 2048;
const MAX_WRAP_H = 4096;

/** True when the model carries a usable measured profile. */
export function hasProfile(m) {
  return Boolean(m && Array.isArray(m.profile) && cleanProfile(m.profile).length >= 2);
}

/** The profile as finite [y, r] pairs, sorted from the rim down, without repeated points. */
export function cleanProfile(profile) {
  const pts = (Array.isArray(profile) ? profile : [])
    .map((p) => [Number(p && p[0]), Number(p && p[1])])
    .filter(([y, r]) => Number.isFinite(y) && Number.isFinite(r) && r >= 0)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

/** Height of the body (inches): the profile's last y. */
export function heightOf(profile) {
  const p = cleanProfile(profile);
  return p.length ? p[p.length - 1][0] - p[0][0] : 0;
}

/** Largest radius of the body. */
export function maxRadius(profile) {
  return cleanProfile(profile).reduce((a, p) => Math.max(a, p[1]), 0);
}

/** Outside radius at depth y below the rim (linear between profile points, clamped to the ends). */
export function radiusAt(profile, y) {
  const p = cleanProfile(profile);
  if (!p.length) return 0;
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][0]) {
      const [y0, r0] = p[i - 1];
      const [y1, r1] = p[i];
      return y1 === y0 ? r1 : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
  }
  return p[p.length - 1][1];
}

/** Cumulative arc length along the profile from the rim, one entry per (clean) profile point. */
export function arcLengths(profile) {
  const p = cleanProfile(profile);
  const out = [];
  let s = 0;
  p.forEach((pt, i) => {
    if (i) s += Math.hypot(pt[0] - p[i - 1][0], pt[1] - p[i - 1][1]);
    out.push(s);
  });
  return out;
}

/** Arc length along the profile from the rim down to depth y. */
export function arcAt(profile, y) {
  const p = cleanProfile(profile);
  if (p.length < 2) return 0;
  const acc = arcLengths(p);
  if (y <= p[0][0]) return 0;
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][0]) {
      const t = p[i][0] === p[i - 1][0] ? 1 : (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return acc[i - 1] + t * (acc[i] - acc[i - 1]);
    }
  }
  return acc[acc.length - 1];
}

/**
 * The profile as lathe points [r, yUp], from the base up (three's LatheGeometry then gives outward normals), with
 * yUp = height/2 − y so the body is centred on y = 0 like the cylinder mugs. `inset` makes it smaller (inner wall);
 * `toY` stops it at that depth (the inner floor).
 */
export function lathePoints(profile, { inset = 0, toY = Infinity } = {}) {
  const p = cleanProfile(profile);
  if (p.length < 2) return [];
  const y0 = p[0][0];
  const H = heightOf(p);
  const cut = p.filter(([y]) => y < toY);
  if (Number.isFinite(toY) && toY > y0 && toY < y0 + H) cut.push([toY, radiusAt(p, toY)]);
  return cut.map(([y, r]) => [Math.max(0.01, r - inset), H / 2 - (y - y0)]).reverse();
}

/** Lathe UVs for `count` profile points × (segments + 1) rings: u = ring / segments, v = 1 − arc/total (rim at v = 1). */
export function latheUVs(profile, segments = SEGMENTS) {
  const p = cleanProfile(profile);
  const acc = arcLengths(p);
  const total = acc[acc.length - 1] || 1;
  // LatheGeometry orders vertices ring by ring, each ring along the given points (base up = reversed profile).
  const vs = acc.map((s) => 1 - s / total).reverse();
  const uv = new Float32Array((segments + 1) * vs.length * 2);
  let k = 0;
  for (let i = 0; i <= segments; i++) {
    for (const v of vs) {
      uv[k++] = i / segments;
      uv[k++] = v;
    }
  }
  return uv;
}

/** Wrap canvas size: 2048 px for the widest circumference, the height in proportion to the profile's arc length. */
export function wrapSize(profile, width = WRAP_W) {
  const R = maxRadius(profile) || 1;
  const acc = arcLengths(profile);
  const total = acc[acc.length - 1] || 1;
  return { w: width, h: Math.max(64, Math.min(MAX_WRAP_H, Math.round((width * total) / (TAU * R)))) };
}

/**
 * The print band of the model in inches from the rim plus its printed angle. Uses m.band; without one, falls back
 * to the side's print size centred on the body (phi from the print width at the widest radius).
 */
export function bandOf(m, side) {
  const p = cleanProfile(m.profile);
  const H = heightOf(p);
  const R = maxRadius(p) || 1;
  const b = m.band || {};
  let y0 = Number(b.y0In);
  let y1 = Number(b.y1In);
  let phi = Number(b.phi);
  if (!(Number.isFinite(y0) && Number.isFinite(y1) && y1 > y0)) {
    const ph = Math.min(H, Number(side && side.printHeightIn) || H * 0.8);
    y0 = (H - ph) / 2;
    y1 = y0 + ph;
  }
  if (!(phi > 0)) phi = Math.min(TAU, (Number(side && side.printWidthIn) || TAU * R * 0.9) / R);
  y0 = Math.max(0, y0);
  y1 = Math.min(H, y1);
  return { y0In: y0, y1In: y1, phi: Math.min(TAU, phi) };
}

/** Where the design goes on the wrap canvas: centred at the front (u = 0.5), phi/2π wide, from the band's arc lengths. */
export function bandRect(m, side, w, h) {
  const p = cleanProfile(m.profile);
  const acc = arcLengths(p);
  const total = acc[acc.length - 1] || 1;
  const band = bandOf(m, side);
  const y0 = p[0][0];
  const top = arcAt(p, y0 + band.y0In) / total;
  const bot = arcAt(p, y0 + band.y1In) / total;
  const rw = (band.phi / TAU) * w;
  return { x: (w - rw) / 2, y: top * h, w: rw, h: (bot - top) * h };
}

/** Where the handle meets the body (inches from the rim), or null for no handle. */
export function handleOf(m) {
  if (!m || !m.handle) return null;
  const H = heightOf(m.profile);
  const src = (m.handleBand && typeof m.handleBand === 'object' && m.handleBand)
    || (typeof m.handle === 'object' && m.handle)
    || {};
  let y0 = Number(src.y0In);
  let y1 = Number(src.y1In);
  if (!(Number.isFinite(y0) && Number.isFinite(y1) && y1 - y0 > 0.2)) {
    y0 = H * 0.17;
    y1 = H * 0.75;
  }
  y0 = Math.max(0, Math.min(H, y0));
  y1 = Math.max(y0 + 0.2, Math.min(H, y1));
  return { y0In: y0, y1In: y1 };
}

/** Body material by finish: gloss → ceramic, matte → plastic at roughness 0.6, metal → metal. */
export function finishOf(m) {
  const f = m.finish || (m.material === 'metal' ? 'metal' : 'gloss');
  if (f === 'glass') return { kind: 'glass', opts: {} };
  if (f === 'metal') return { kind: 'metal', opts: {} };
  if (f === 'matte') return { kind: 'plastic', opts: { roughness: 0.6 } };
  return { kind: 'ceramic', opts: {} };
}

/** The lathe-turned body with the design in its print band, inner wall, floor, base, rim and handle. */
export function buildLathe(m, hex, tex, renderer, product, side, helpers) {
  const { THREE, canvas, texture, designCrop, mat } = helpers;
  side = side || product.sides[0];
  const prof = cleanProfile(m.profile);
  const H = heightOf(prof);
  const R = maxRadius(prof);
  const y0 = prof[0][0];
  const rTop = prof[0][1];
  const rBot = prof[prof.length - 1][1];
  const yUp = (y) => H / 2 - (y - y0);
  const g = new THREE.Group();

  // The wrap: the product colour with the design in the band.
  const size = wrapSize(prof);
  const wrap = canvas(size.w, size.h);
  const ctx = wrap.getContext('2d');
  const { kind, opts } = finishOf(m);
  const clear = kind === 'glass';
  // (Clear glass: only the design on the wrap; the glass itself is a see-through body under it.)
  if (!clear) {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, wrap.width, wrap.height);
  }
  const crop = designCrop(tex && side && tex[side.id]);
  if (crop) {
    const r = bandRect(m, side, wrap.width, wrap.height);
    ctx.drawImage(crop, r.x, r.y, r.w, r.h);
  }

  const geo = new THREE.LatheGeometry(lathePoints(prof).map(([r, y]) => new THREE.Vector2(r, y)), SEGMENTS, Math.PI, TAU);
  geo.setAttribute('uv', new THREE.BufferAttribute(latheUVs(prof), 2));
  const glassMat = (o = {}) => new THREE.MeshPhysicalMaterial({ color: '#eef6f8', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false, ...o });
  let body;
  if (clear) {
    // The glass, then the wrap just outside it (transparent where nothing is printed).
    body = new THREE.Group();
    body.add(new THREE.Mesh(geo, glassMat({ side: THREE.DoubleSide })));
    const decal = new THREE.Mesh(geo, mat('plastic', { map: texture(wrap, renderer), transparent: true, alphaTest: 0.02, roughness: 0.35 }));
    decal.scale.set(1.004, 1, 1.004);
    body.add(decal);
  } else body = new THREE.Mesh(geo, mat(kind, { ...opts, map: texture(wrap, renderer) }));
  body.userData.lathe = true;
  const plain = clear ? glassMat() : mat(kind, { ...opts, color: hex });

  // Wall thickness, the inner wall (seen from inside) down to the floor, the floor, the base and a rounded rim.
  const wall = Math.max(0.05, Math.min(0.14, R * 0.06));
  const floorT = Math.max(0.2, Math.min(0.4, H * 0.06));
  const innerPts = lathePoints(prof, { inset: wall, toY: y0 + H - floorT });
  const inner = new THREE.Mesh(new THREE.LatheGeometry(innerPts.map(([r, y]) => new THREE.Vector2(r, y)), 64, Math.PI, TAU), clear ? glassMat({ side: THREE.BackSide }) : mat(kind === 'metal' ? 'metal' : 'ceramic', { color: hex, side: THREE.BackSide }));
  const floorR = innerPts.length ? innerPts[0][0] : Math.max(0.01, rBot - wall);
  const innerBottom = new THREE.Mesh(new THREE.CircleGeometry(floorR, 64), plain);
  innerBottom.rotation.x = -Math.PI / 2;
  innerBottom.position.y = innerPts.length ? innerPts[0][1] : -H / 2 + 0.25;
  const base = new THREE.Mesh(new THREE.CircleGeometry(rBot, 64), plain);
  base.rotation.x = Math.PI / 2;
  base.position.y = -H / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.01, rTop - wall / 2), wall / 2, 12, 128), plain);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H / 2;
  g.add(body, inner, innerBottom, base, rim);

  // Handle: a half torus between where it meets the body, at the back (the seam gap is there, the print is centred
  // at the front), reaching out at most ~1.2 in.
  const hb = handleOf(m);
  if (hb) {
    const ra = (hb.y1In - hb.y0In) / 2;
    const tube = Math.max(0.12, Math.min(0.2, ra * 0.12));
    const arc = new THREE.Mesh(new THREE.TorusGeometry(ra, tube, 24, 64, Math.PI), plain);
    arc.rotation.z = -Math.PI / 2;
    const reach = new THREE.Group();
    reach.add(arc);
    reach.scale.x = Math.min(1, 1.2 / ra);
    const mid = (hb.y0In + hb.y1In) / 2;
    reach.position.set(radiusAt(prof, y0 + mid) - tube * 0.6, yUp(y0 + mid), 0);
    const back = new THREE.Group();
    back.add(reach);
    back.rotation.y = Math.PI / 2; // +x → −z: behind the cup
    back.userData.handle = true;
    g.add(back);
  }
  if (m.lid) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 1.005, rTop * 1.005, 0.18, 96), mat('metal', { color: '#c9ccd1' }));
    band.position.y = H / 2 + 0.09;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 0.97, rTop, 0.55, 96), mat('plastic', { color: '#f4f5f7' }));
    lid.position.y = H / 2 + 0.18 + 0.27;
    g.add(band, lid);
  }
  g.rotation.y = -0.35;
  return g;
}
