/* Checks the scrubber's byte-level cleaners on synthetic files. Run: node test/scrub_test.js */
'use strict';
global.TextDecoder = global.TextDecoder || require('util').TextDecoder; global.TextEncoder = global.TextEncoder || require('util').TextEncoder;
global.ZipKit = require('../shell/zipkit.js'); const S = require('../metadata-scrubber/scrub.js'); const K = global.ZipKit;
let fails = 0; const check = (l, g, w) => { const ok = g === w; if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + l + (ok ? '' : ` got ${JSON.stringify(g)} want ${JSON.stringify(w)}`)); };
// JPEG with EXIF (Make=Apple, Orientation=6), a comment, a fake DQT, SOS, EOI and a trailer
const tiff = [0x4D,0x4D,0,0x2A,0,0,0,8, 0,2, 0x01,0x0F,0,2,0,0,0,6,0,0,0,38, 0x01,0x12,0,3,0,0,0,1,0,6,0,0, 0,0,0,0, 0x41,0x70,0x70,0x6C,0x65,0];
const app1 = [0xFF,0xE1,0,2+6+tiff.length,0x45,0x78,0x69,0x66,0,0, ...tiff];
const jpeg = new Uint8Array([0xFF,0xD8, ...app1, 0xFF,0xFE,0,7,0x68,0x65,0x6C,0x6C,0x6F, 0xFF,0xDB,0,3,0, 0xFF,0xDA,0,2,0x12,0x34,0x56, 0xFF,0xD9, 0x54,0x52,0x41,0x49,0x4C]);
const rep = S.jpegInspect(jpeg);
check('jpeg finds make', rep.findings.some(f => f.name === 'Camera make' && f.value === 'Apple'), true);
check('jpeg finds comment', rep.findings.some(f => f.section === 'Comment' && f.value === 'hello'), true);
check('jpeg finds trailer', rep.findings.some(f => /after end of image/.test(f.name)), true);
check('jpeg orientation read', rep.info.orientation, 6);
const cleaned = S.jpegClean(jpeg, rep, { keepICC: true, dropTrailer: true });
const rep2 = S.jpegInspect(cleaned.bytes);
check('jpeg clean keeps only orientation', rep2.findings.map(f => f.name).join(','), 'Orientation');
check('jpeg clean drops trailer', cleaned.bytes[cleaned.bytes.length - 1] === 0xD9 && cleaned.bytes[cleaned.bytes.length - 2] === 0xFF, true);
check('jpeg clean keeps DQT and SOS', Buffer.from(cleaned.bytes).indexOf(Buffer.from([0xFF,0xDB,0,3,0])) > 0 && Buffer.from(cleaned.bytes).indexOf(Buffer.from([0xFF,0xDA,0,2,0x12,0x34,0x56])) > 0, true);
// PNG with tEXt, tIME and an eXIf chunk
function be32(v) { return [v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255]; }
function chunk(type, data) { const td = Buffer.concat([Buffer.from(type), Buffer.from(data)]); return [...be32(data.length), ...td, ...be32(K.crc32(new Uint8Array(td)))]; }
const png = new Uint8Array([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A, ...chunk('IHDR', [0,0,0,1,0,0,0,1,8,0,0,0,0]), ...chunk('tEXt', Buffer.from('Author\0Jane')), ...chunk('tIME', [7,234,1,2,3,4,5]), ...chunk('eXIf', tiff), ...chunk('IDAT', [0x78,0x01,0x01,2,0,0xFD,0xFF,0,0x80,0,0x81,0,0x81]), ...chunk('IEND', [])]);
const pngClean = S.pngClean(png);
check('png clean removes 3 chunks', pngClean.changes.length, 3);
check('png clean keeps IHDR/IDAT/IEND', pngClean.bytes.length, 8 + (12 + 13) + (12 + 13) + 12);
// PDF info strings and an uncompressed XMP stream, blanked in place without moving bytes
const pdfText = '%PDF-1.4\n1 0 obj << /Title (Secret) /Author (Jane \\(J\\) Doe) /CreationDate (D:20260101120000) >> endobj\n2 0 obj << /Type /Metadata /Subtype /XML /Length 44 >>\nstream\n<x:xmpmeta><dc:creator>Jane</dc:creator></x>\nendstream\nendobj\ntrailer << /Info 1 0 R >>\n%%EOF';
const pdf = new Uint8Array(Buffer.from(pdfText, 'latin1'));
const scan = S.pdfScan(pdf);
check('pdf finds 3 info strings', scan.strings.length, 3);
check('pdf decodes escaped author', scan.strings.find(s => s.key === 'Author').value, 'Jane (J) Doe');
check('pdf finds xmp stream', scan.streams.length === 1 && scan.streams[0].length === 44, true);
// run the async inspect+clean
S.inspect(pdf).then(r => { const c = S.clean(pdf, r, {}); return c; }).then(c => {
  check('pdf clean same length', c.bytes.length, pdf.length);
  const after = Buffer.from(c.bytes).toString('latin1');
  check('pdf clean blanks author', /\/Author \( {14}\)/.test(after), true);
  check('pdf clean blanks xmp', after.indexOf('<x:xmpmeta') < 0 && /stream\n {44}\nendstream/.test(after), true);
  // minimal EXIF segment parses back
  const seg = S.minimalExif(6); const t = S.parseTIFF(seg, 10);
  check('minimal exif orientation', t.info.orientation, 6);
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed'); process.exit(fails ? 1 : 0);
}).catch(e => { console.log('FAIL async: ' + e.stack); process.exit(1); });
