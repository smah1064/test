'use strict';
// Laser-cut drawings for the two wooden Ramadan lanterns (scripts/lantern-drawings.js, PROTOTYPE): the generator
// writes every file, both lanterns are 300 mm tall, the SVGs are sized in mm, the DXFs read back with the CUT /
// ENGRAVE layers and $INSUNITS 4, --slot changes the slots, no part overlaps another, and the lattice keeps its webs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'lantern-drawings.js');
const gen = require(SCRIPT);
const MODELS = ['familyfanous', 'arabesquelantern'];
const FILES = [
  'familyfanous-body.svg', 'familyfanous-body.dxf', 'familyfanous-assembly.svg',
  'arabesquelantern-body.svg', 'arabesquelantern-body.dxf', 'arabesquelantern-assembly.svg',
  'slot-fit-test.svg', 'slot-fit-test.dxf', 'lanterns.json', 'README.md',
];
const dirs = [];
function run(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-'));
  dirs.push(dir);
  execFileSync(process.execPath, [SCRIPT, '--out', dir, ...args], { stdio: 'pipe' });
  return dir;
}
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const A = run(['--thickness', '3', '--slot', '3.1', '--kerf', '0.15']);
const B = run(['--slot', '3.3', '--res', '3']);
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const json = (dir) => JSON.parse(read(dir, 'lanterns.json'));

/** The [w, h] of each path with class="slot" in an SVG. */
function slotSizes(svg) {
  return [...svg.matchAll(/<path class="slot" d="([^"]+)"/g)].map((m) => {
    const n = m[1].match(/-?\d+(\.\d+)?/g).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0); const ys = n.filter((_, i) => i % 2 === 1);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  });
}

test('the generator writes every drawing, the assembly sheets, the slot test, the JSON and the README', () => {
  for (const f of FILES) assert.ok(fs.statSync(path.join(A, f)).size > 500, `${f} is missing or empty`);
  const readme = read(A, 'README.md');
  assert.match(readme, /node scripts\/lantern-drawings\.js --thickness 3 --slot 3\.1 --kerf 0\.15/);
  assert.match(readme, /PROTOTYPE/);
});

test('both lanterns are 300 mm from the feet to the top of the ring, with the size and the name area reported', () => {
  const s = json(A);
  for (const m of MODELS) {
    const d = s.models[m];
    assert.strictEqual(d.overallMm.H, 300);
    assert.ok(Math.abs(d.heightCheckMm - 300) < 1e-6, `${m}: stack adds up to ${d.heightCheckMm}`);
    const st = d.stackMm;
    assert.ok(Math.abs(st.base + st.body + st.cap + st.dome + st.collar + st.ringStem + st.ringOD - 300) < 0.11);
    assert.ok(d.overallMm.W >= d.bodyMm.W && d.overallMm.D === d.overallMm.W, 'square plan, base at least the body');
    assert.ok(d.nameAreaMm.w > 40 && d.nameAreaMm.h >= 15, `${m}: name area ${d.nameAreaMm.w} × ${d.nameAreaMm.h}`);
    assert.ok(d.nameAreaMm.w < d.plaqueMm.w && d.nameAreaMm.h < d.plaqueMm.h);
    const svg = read(A, `${m}-body.svg`);
    assert.ok(svg.includes(`× ${d.overallMm.W} × 300 mm`), 'the title block gives W × D × H');
    assert.ok(svg.includes(`NAME AREA ${d.nameAreaMm.w} × ${d.nameAreaMm.h} mm`));
  }
  // a thicker sheet changes the stack, the ring stem takes it up: still 300
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-')); dirs.push(dir);
  const { summary } = gen.generate({ out: dir, thickness: 3.3, slot: 3.4, res: 3 });
  for (const m of MODELS) assert.ok(Math.abs(summary.models[m].heightCheckMm - 300) < 1e-6);
});

test('every SVG is sized in mm with a matching viewBox and carries the PROTOTYPE warning in English and Arabic', () => {
  for (const f of FILES.filter((x) => x.endsWith('.svg'))) {
    const svg = read(A, f);
    const m = svg.match(/<svg[^>]*\swidth="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    assert.ok(m, `${f}: width/height in mm`);
    assert.strictEqual(Number(m[1]), Number(m[3])); assert.strictEqual(Number(m[2]), Number(m[4]));
    assert.ok(svg.includes('PROTOTYPE – not for production until the workshop confirms material thickness, joint fit and LED dimensions'), f);
    assert.ok(svg.includes('نموذج أولي – ليس للإنتاج قبل تأكيد الورشة لسُمك الخامة وتركيب الوصلات ومقاس الـ LED'), f);
  }
  for (const m of MODELS) {
    const svg = read(A, `${m}-body.svg`);
    assert.match(svg, /<g id="CUT" fill="none" stroke="#ff0000" stroke-width="0.1">/);
    assert.match(svg, /<g id="ENGRAVE" fill="#000000"/);
    assert.match(svg, /<g id="SCORE" fill="none" stroke="#0000ff"/);
    assert.match(svg, /<path id="eng-[\w-]+plaque" d="M/, 'the plaque engraving is on ENGRAVE');
  }
});

test('the DXFs read back: R12, mm ($INSUNITS 4), CUT / ENGRAVE / SCORE layers, closed polylines', () => {
  for (const f of FILES.filter((x) => x.endsWith('.dxf'))) {
    const r = gen.validateDxf(read(A, f));
    assert.strictEqual(r.insunits, 4, f);
    assert.strictEqual(r.version, 'AC1009', f);
    for (const l of ['CUT', 'ENGRAVE', 'SCORE']) assert.ok(r.layers.has(l), `${f}: layer ${l}`);
    assert.ok(r.used.CUT > 10, `${f}: cut outlines`);
  }
  for (const m of MODELS) assert.ok(gen.validateDxf(read(A, `${m}-body.dxf`)).used.ENGRAVE > 0, `${m}: engraving in the DXF`);
  assert.throws(() => gen.validateDxf('0\nSECTION\n2\nENTITIES\n0\nVERTEX\n8\nCUT\n0\nEOF\n'), /VERTEX outside POLYLINE/);
});

test('--slot sets the width of every slot (the fit-test strip keeps its 2.8 … 3.4 range)', () => {
  for (const m of MODELS) {
    const a = slotSizes(read(A, `${m}-body.svg`)); const b = slotSizes(read(B, `${m}-body.svg`));
    assert.ok(a.length >= 16 && a.length === b.length, `${m}: ${a.length} slots`);
    for (const [w, h] of a) assert.ok(Math.abs(Math.min(w, h) - 3.1) < 0.002, `${m}: slot ${w} × ${h}`);
    for (const [w, h] of b) assert.ok(Math.abs(Math.min(w, h) - 3.3) < 0.002, `${m}: slot ${w} × ${h}`);
    // slot length = tab + (slot − thickness): 0.2 mm longer at --slot 3.3
    const la = a.map(([w, h]) => Math.max(w, h)).sort((x, y) => x - y); const lb = b.map(([w, h]) => Math.max(w, h)).sort((x, y) => x - y);
    la.forEach((l, i) => assert.ok(Math.abs(lb[i] - l - 0.2) < 0.002));
  }
  const strip = slotSizes(read(B, 'slot-fit-test.svg')).map(([w]) => Math.round(w * 10) / 10);
  assert.deepStrictEqual(strip, [2.8, 2.9, 3, 3.1, 3.2, 3.3, 3.4]);
});

test('no part overlaps another on the sheet', () => {
  for (const f of ['familyfanous-body.svg', 'arabesquelantern-body.svg', 'slot-fit-test.svg']) {
    const svg = read(A, f);
    const boxes = [...svg.matchAll(/id="part-([\w-]+)" data-bbox="([\d. -]+)"/g)].map((m) => { const [x, y, w, h] = m[2].split(' ').map(Number); return { id: m[1], x, y, w, h }; });
    assert.ok(boxes.length >= 4, f);
    const [, W, H] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= W && a.y + a.h <= H, `${f}: ${a.id} off the sheet`);
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${f}: ${a.id} overlaps ${b.id}`);
      }
    }
  }
});

test('every part is present: 4 walls, plaque, roof facets, spines, base, skirt, LED hatch', () => {
  for (const m of MODELS) {
    const svg = read(A, `${m}-body.svg`);
    for (const id of ['wall-front', 'wall-back', 'wall-left', 'wall-right', 'plaque', 'cap-1', 'roof-1-1', 'roof-1-4', 'spine-a', 'spine-b', 'collar', 'base-plate', 'skirt-front', 'skirt-right', 'bay-space', 'bay-lock', 'hatch-lugs', 'hatch-core', 'hatch-grip']) {
      assert.ok(svg.includes(`id="part-${m}-${id}"`), `${m}: ${id}`);
    }
  }
  assert.ok(read(A, 'arabesquelantern-body.svg').includes('id="part-arabesquelantern-arch"'));
});

test('lattice webs stay at least the minimum web after the kerf', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-')); dirs.push(dir);
  gen.generate({ out: dir, res: 4 });
  const p = gen.DEFAULTS;
  for (const L of Object.values(gen.generate.last)) {
    for (const pt of L.parts) {
      if (pt.holes.length < 2) continue;
      const g = gen.minGap(pt.holes);
      assert.ok(g - p.kerf >= 2.5 && g >= p.web + p.kerf - 0.1, `${pt.id}: web ${g.toFixed(2)} mm`);
    }
  }
});

test('bad parameters are refused', () => {
  assert.throws(() => gen.generate({ out: os.tmpdir(), web: 2 }), /web/);
  assert.throws(() => gen.parseArgs(['--bogus', '1']), /Unknown option/);
  assert.deepStrictEqual(gen.parseArgs(['--thickness', '3.2', '--slot=3.3']).slot, 3.3);
});
