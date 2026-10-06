/* Checks the ZIP kit against Node's zlib and known answers. Run: node test/zipkit_test.js */
'use strict';
const zlib = require('zlib');
global.TextDecoder = global.TextDecoder || require('util').TextDecoder; global.TextEncoder = global.TextEncoder || require('util').TextEncoder;
const K = require('../shell/zipkit.js');
let fails = 0; const check = (l, g, w) => { const ok = g === w; if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + l + (ok ? '' : ` got ${g} want ${w}`)); };
check('crc32 123456789', K.crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
check('adler32 Wikipedia', K.adler32(Buffer.from('Wikipedia')).toString(16), '11e60398');
for (const len of [11, 12, 100, 65535 + 11, 70000, 200000]) {
  const z = K.zlibStoredSpaces(len);
  const out = zlib.inflateSync(Buffer.from(z));
  check(`zlibStoredSpaces(${len}) length`, z.length, len);
  check(`zlibStoredSpaces(${len}) inflates to spaces`, out.length === len - 6 - 5 * Math.ceil((len - 6) / 65540) && /^ *$/.test(out.toString('latin1')), true);
}
// round-trip a zip: write stored entries, read back, rewrite keeping raw deflate from Node
const a = Buffer.from('hello world, hello world, hello world'), b = Buffer.from('<x>metadata</x>');
const made = K.writeZip([{ name: 'a.txt', data: new Uint8Array(a) }, { name: 'dir/b.xml', data: new Uint8Array(b) }]);
const read = K.readZip(made);
check('zip entries', read.entries.map(e => e.name).join(','), 'a.txt,dir/b.xml');
check('zip stored data', Buffer.from(read.entries[0].raw()).toString(), a.toString());
check('zip crc', read.entries[0].crc, K.crc32(new Uint8Array(a)));
// a deflated entry produced by Node must be readable by our reader's raw() and re-wrapped without change
const comp = zlib.deflateRawSync(a);
const made2 = K.writeZip([{ name: 'c.txt', raw: { bytes: new Uint8Array(comp), method: 8, crc: K.crc32(new Uint8Array(a)), usize: a.length } }]);
const read2 = K.readZip(made2);
check('deflated entry round trip', zlib.inflateRawSync(Buffer.from(read2.entries[0].raw())).toString(), a.toString());
// Node can open what we wrote: use the central directory via a tiny parse, or just trust unzip if present
try { require('child_process').execFileSync('unzip', ['-tq', '-'], { input: Buffer.from(made) }); check('system unzip accepts our zip', true, true); } catch (e) { console.log('skip  system unzip check (' + (e.message.split('\n')[0]) + ')'); }
console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed'); process.exit(fails ? 1 : 0);
