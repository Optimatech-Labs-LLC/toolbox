/* Checks the streaming hashers against OpenSSL on known vectors and random files.
   Run: node test/hash_test.js        (fast)
        node test/hash_test.js --big  (adds a 600 MB file to exercise lengths past 2^32 bits)
   Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const H = require('../evidence-hash/hashes.js');
const tmp = path.join(__dirname, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
let failures = 0;
function check(label, got, want) { const ok = got === want; if (!ok) failures++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : `\n      got  ${got}\n      want ${want}`)); }

// 1. Known answers
for (const algo of ['sha256', 'sha1', 'md5']) {
  for (const [input, want] of Object.entries(H.vectors[algo])) {
    check(`${algo} "${input}"`, H.create(algo).update(Buffer.from(input)).digest(), want);
  }
}
// 2. Boundary lengths around the 64-byte block and the 56-byte padding edge, vs OpenSSL
function openssl(algo, file) { return execFileSync('openssl', ['dgst', '-' + algo, '-r', file]).toString().split(' ')[0]; }
function streamHash(algo, file, chunk) { const h = H.create(algo); const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(chunk); let n; while ((n = fs.readSync(fd, buf, 0, chunk, null)) > 0) h.update(new Uint8Array(buf.buffer, buf.byteOffset, n)); fs.closeSync(fd); return h.digest(); }
for (const len of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 65537]) {
  const f = path.join(tmp, `len${len}.bin`); fs.writeFileSync(f, require('crypto').randomBytes(len));
  for (const algo of ['sha256', 'sha1', 'md5']) check(`${algo} ${len} bytes`, streamHash(algo, f, 7), openssl(algo, f));
}
// 3. Random files streamed in 8 MB chunks like the worker
const sizes = [1 * 1024 * 1024 + 13, 70 * 1024 * 1024 + 7];
if (process.argv.includes('--big')) sizes.push(600 * 1024 * 1024 + 3);
for (const size of sizes) {
  const f = path.join(tmp, `rand${size}.bin`);
  const fd = fs.openSync(f, 'w'); let left = size; while (left > 0) { const n = Math.min(left, 4 * 1024 * 1024); fs.writeSync(fd, require('crypto').randomBytes(n)); left -= n; } fs.closeSync(fd);
  for (const algo of ['sha256', 'sha1', 'md5']) {
    const t0 = Date.now(); const got = streamHash(algo, f, 8 * 1024 * 1024); const ms = Date.now() - t0;
    check(`${algo} ${(size / 1048576).toFixed(0)} MB (${(size / 1048576 / (ms / 1000)).toFixed(0)} MB/s)`, got, openssl(algo, f));
  }
  fs.unlinkSync(f);
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
