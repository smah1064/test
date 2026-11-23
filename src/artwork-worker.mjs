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

process.once('message', async ({ data, kind, px }) => {
  const log = [];
  let code = -1;
  let png = null;
  try {
    const gs = await loadGs({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
    const input = kind === 'pdf' ? 'in.pdf' : 'in.eps';
    gs.FS.writeFile(input, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const args = [
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
    try {
      png = gs.FS.readFile('out.png');
    } catch (e) {
      png = null;
    }
  } catch (e) {
    log.push(`load: ${(e && e.message) || e}`);
  }
  process.send({ code, png, log: log.slice(-8).join('\n') }, () => process.exit(0));
});
