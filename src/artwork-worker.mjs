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

process.once('message', async ({ data, kind, px, pages }) => {
  const log = [];
  let code = -1;
  let png = null;
  let pngs = null;
  try {
    const gs = await loadGs({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
    const input = kind === 'pdf' ? 'in.pdf' : 'in.eps';
    gs.FS.writeFile(input, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
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
