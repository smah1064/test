// Runs as a separate small Node process: draws the first page of an AI / EPS
// file to a transparent PNG with Ghostscript (WebAssembly build). The file only
// lives in Ghostscript's in-memory file system; -dSAFER blocks file and device
// access from inside the PostScript. The shop kills this process if it runs too
// long or uses too much memory (PostScript is a programming language and can
// loop forever), so a bad file can never slow down or crash the shop itself.
//
// It is started with --disable-wasm-trap-handler: shared hosting limits virtual
// memory, and WebAssembly otherwise reserves about 10 GB of it up front.
import loadGs from '@okathira/ghostpdl-wasm';

/** "0 0 200 100" → [0, 0, 200, 100] when it is a box with a size, else null. */
function parseBox(value) {
  const n = String(value).trim().split(/\s+/).map(Number);
  return n.length >= 4 && n.slice(0, 4).every(Number.isFinite) && n[2] > n[0] && n[3] > n[1] ? n.slice(0, 4) : null;
}
/**
 * An EPS file made sure that Ghostscript's -dEPSFitPage fits its artwork box into the picture.
 * Ghostscript reads %%BoundingBox / %%HiResBoundingBox only from a header that ends with an
 * %%EndComments line (and never from the trailer, for "(atend)"). Without one the file was drawn
 * at 72 dpi in a corner of the page: a small picture that the editor flagged as low resolution.
 * Then the box found anywhere in the header (or in the trailer) is written again right after the
 * first line, with an %%EndComments line after it. Other files are returned as they are.
 */
function epsWithBox(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = buf.subarray(0, 128 * 1024).toString('latin1');
  const first = /^\s*%![^\r\n]*(\r\n|\r|\n)/.exec(head);
  if (!first) return bytes;
  const box = {};
  let ended = false;
  // The header: the comment lines after the first one, up to %%EndComments or the first line of
  // PostScript (or the next section, such as %%BeginProlog or a preview).
  for (const line of head.slice(first[0].length).split(/\r\n|\r|\n/)) {
    if (line.startsWith('%%EndComments')) { ended = true; break; }
    if (!line.trim()) continue;
    if (!line.startsWith('%') || /^%%(Begin|End|Page:|Trailer)/.test(line)) break;
    const m = /^%%(HiResBoundingBox|BoundingBox):(.*)$/.exec(line);
    if (m && !box[m[1]]) box[m[1]] = parseBox(m[2]);
  }
  if (ended && (box.HiResBoundingBox || box.BoundingBox)) return bytes; // Ghostscript reads it itself
  if (!box.HiResBoundingBox && !box.BoundingBox) {
    // "%%BoundingBox: (atend)": the box is in the trailer.
    const tail = buf.subarray(Math.max(0, buf.length - 64 * 1024)).toString('latin1');
    const at = tail.lastIndexOf('%%Trailer');
    if (at >= 0) {
      for (const m of tail.slice(at).matchAll(/^%%(HiResBoundingBox|BoundingBox):(.*)$/gm)) box[m[1]] = parseBox(m[2]) || box[m[1]];
    }
  }
  if (!box.HiResBoundingBox && !box.BoundingBox) return bytes;
  const eol = first[1];
  const lines = [
    box.BoundingBox && `%%BoundingBox: ${box.BoundingBox.join(' ')}`,
    box.HiResBoundingBox && `%%HiResBoundingBox: ${box.HiResBoundingBox.join(' ')}`, // Ghostscript prefers it
    '%%EndComments',
  ].filter(Boolean);
  const start = first.index + first[0].length;
  return Buffer.concat([buf.subarray(0, start), Buffer.from(lines.join(eol) + eol, 'latin1'), buf.subarray(start)]);
}

process.once('message', async (msg) => {
  if (msg.job) return runJob(msg.job);
  const { data, kind, px, pages } = msg;
  const log = [];
  let code = -1;
  let png = null;
  let pngs = null;
  try {
    const gs = await loadGs({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
    const input = kind === 'pdf' ? 'in.pdf' : 'in.eps';
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    gs.FS.writeFile(input, kind === 'pdf' ? bytes : epsWithBox(bytes));
    // Booklet pages: every page of a PDF (up to pages.max), each fitted into a w x h page, on white paper.
    const args = pages ? [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-dNOINTERPOLATE',
      '-sDEVICE=png16m', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', '-dMaxBitmap=200000000',
      `-g${pages.w}x${pages.h}`, '-dFIXEDMEDIA', '-dPDFFitPage', '-dFirstPage=1', `-dLastPage=${pages.max}`,
      '-sOutputFile=out-%03d.png', input,
    ] : [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-dNOINTERPOLATE',
      '-sDEVICE=pngalpha', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
      // Draw the whole page in one piece: the banded mode (used for big pages) crashes in this WebAssembly build.
      '-dMaxBitmap=200000000',
      // Fit the artwork into a px x px box, keeping its proportions.
      `-g${px}x${px}`, '-dFIXEDMEDIA',
      ...(kind === 'pdf' ? ['-dPDFFitPage', '-dFirstPage=1', '-dLastPage=1'] : ['-dEPSFitPage']),
      '-sOutputFile=out.png', input,
    ];
    try {
      code = gs.callMain(args);
    } catch (e) {
      code = e && typeof e.status === 'number' ? e.status : -1;
      log.push(String((e && e.message) || e));
    }
    if (pages) {
      pngs = [];
      for (let i = 1; i <= pages.max; i++) {
        try {
          pngs.push(gs.FS.readFile(`out-${String(i).padStart(3, '0')}.png`));
        } catch (e) {
          break;
        }
      }
    } else {
      try {
        png = gs.FS.readFile('out.png');
      } catch (e) {
        png = null;
      }
    }
  } catch (e) {
    log.push(`load: ${(e && e.message) || e}`);
  }
  process.send({ code, png, pngs, log: log.slice(-8).join('\n') }, () => process.exit(0));
});

// A PostScript job (booklet print files from the customer's own PDF pages, page sizes of a PDF):
// the files it reads, the program, the output device. Returns the output file and the log.
async function runJob({ inputs, ps, device, args = [], dpi }) {
  const log = [];
  let code = -1;
  let out = null;
  let pngs = null;
  try {
    const gs = await loadGs({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
    const permits = [];
    for (const [name, data] of Object.entries(inputs || {})) {
      gs.FS.writeFile(name, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      permits.push(`--permit-file-read=${name}`);
    }
    const files = ps ? ['job.ps'] : [];
    if (ps) gs.FS.writeFile('job.ps', ps);
    const output = device === 'png16m' ? 'out-%03d.png' : 'out.pdf';
    try {
      code = gs.callMain(['-dSAFER', '-dBATCH', '-dNOPAUSE', `-sDEVICE=${device}`, `-sOutputFile=${output}`, ...permits, ...(dpi ? [`-r${dpi}`] : []), ...args, ...files]);
    } catch (e) {
      code = e && typeof e.status === 'number' ? e.status : -1;
      log.push(String((e && e.message) || e));
    }
    if (device === 'png16m') {
      pngs = [];
      for (let i = 1; i < 1000; i++) {
        try {
          pngs.push(gs.FS.readFile(`out-${String(i).padStart(3, '0')}.png`));
        } catch (e) {
          break;
        }
      }
    } else if (device !== 'nullpage') {
      try { out = gs.FS.readFile('out.pdf'); } catch (e) { out = null; }
    }
  } catch (e) {
    log.push(`load: ${(e && e.message) || e}`);
  }
  process.send({ code, out, pngs, log: log.slice(-400).join('\n') }, () => process.exit(0));
}
