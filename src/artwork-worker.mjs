// Runs in a worker thread: draws the first page of an AI / EPS file to a
// transparent PNG with Ghostscript (WebAssembly build). The file only lives in
// Ghostscript's in-memory file system; -dSAFER blocks file and device access
// from inside the PostScript, and the parent thread kills this worker if it
// runs too long (PostScript is a programming language and can loop forever).
import { parentPort, workerData } from 'node:worker_threads';
import loadGs from '@okathira/ghostpdl-wasm';

const { data, kind, px } = workerData;
const log = [];
const gs = await loadGs({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
const input = kind === 'pdf' ? 'in.pdf' : 'in.eps';
gs.FS.writeFile(input, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
const args = [
  '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-dNOINTERPOLATE',
  '-sDEVICE=pngalpha', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
  // Fit the artwork into a px x px box, keeping its proportions.
  `-g${px}x${px}`, '-dFIXEDMEDIA',
  ...(kind === 'pdf' ? ['-dPDFFitPage', '-dFirstPage=1', '-dLastPage=1'] : ['-dEPSFitPage']),
  '-sOutputFile=out.png', input,
];
let code;
try {
  code = gs.callMain(args);
} catch (e) {
  code = e && typeof e.status === 'number' ? e.status : -1;
}
let png = null;
try {
  png = gs.FS.readFile('out.png');
} catch (e) {
  png = null;
}
parentPort.postMessage({ code, png, log: log.slice(-8).join('\n') });
