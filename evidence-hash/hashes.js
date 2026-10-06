/* Streaming SHA-256, SHA-1 and MD5 in plain JavaScript, so files of any size can be hashed
   without loading them into memory. Written for the Optimatech Labs Toolbox.
   Copyright (c) 2026 Optimatech Labs LLC. MIT License.
   Each hasher: update(Uint8Array) any number of times, then digest() -> lowercase hex. */
(function (root) {
  'use strict';

  function hex32be(words) {
    var s = '';
    for (var i = 0; i < words.length; i++) s += ('00000000' + (words[i] >>> 0).toString(16)).slice(-8);
    return s;
  }
  function hex32le(words) {
    var s = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i] >>> 0;
      s += ('00' + (w & 255).toString(16)).slice(-2) + ('00' + ((w >>> 8) & 255).toString(16)).slice(-2) +
           ('00' + ((w >>> 16) & 255).toString(16)).slice(-2) + ('00' + ((w >>> 24) & 255).toString(16)).slice(-2);
    }
    return s;
  }

  /* Shared block buffering. Subclasses implement _block(bytes, offset) on a 64-byte block. */
  function Base() {
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.lenLo = 0; this.lenHi = 0; /* total bytes as two 32-bit words */
  }
  Base.prototype.update = function (data) {
    var n = data.length, i = 0;
    var lo = (this.lenLo + n) >>> 0;
    if (lo < this.lenLo) this.lenHi = (this.lenHi + 1) >>> 0;
    this.lenLo = lo;
    if (this.bufLen) {
      var take = Math.min(64 - this.bufLen, n);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take; i = take;
      if (this.bufLen < 64) return this;
      this._block(this.buf, 0); this.bufLen = 0;
    }
    for (; i + 64 <= n; i += 64) this._block(data, i);
    if (i < n) { this.buf.set(data.subarray(i)); this.bufLen = n - i; }
    return this;
  };
  Base.prototype._finish = function (littleEndianLength) {
    var bitsLo = (this.lenLo << 3) >>> 0;
    var bitsHi = ((this.lenHi << 3) | (this.lenLo >>> 29)) >>> 0;
    var pad = new Uint8Array(1); pad[0] = 0x80; this.update(pad);
    var zero = new Uint8Array(1);
    while (this.bufLen !== 56) this.update(zero);
    var tail = new Uint8Array(8);
    if (littleEndianLength) {
      tail[0] = bitsLo & 255; tail[1] = (bitsLo >>> 8) & 255; tail[2] = (bitsLo >>> 16) & 255; tail[3] = bitsLo >>> 24;
      tail[4] = bitsHi & 255; tail[5] = (bitsHi >>> 8) & 255; tail[6] = (bitsHi >>> 16) & 255; tail[7] = bitsHi >>> 24;
    } else {
      tail[0] = bitsHi >>> 24; tail[1] = (bitsHi >>> 16) & 255; tail[2] = (bitsHi >>> 8) & 255; tail[3] = bitsHi & 255;
      tail[4] = bitsLo >>> 24; tail[5] = (bitsLo >>> 16) & 255; tail[6] = (bitsLo >>> 8) & 255; tail[7] = bitsLo & 255;
    }
    this.update(tail);
  };

  /* ---------------- SHA-256 ---------------- */
  var K256 = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function SHA256() {
    Base.call(this);
    this.h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    this.w = new Uint32Array(64);
  }
  SHA256.prototype = Object.create(Base.prototype);
  SHA256.prototype._block = function (d, o) {
    var w = this.w, t, x, y;
    for (t = 0; t < 16; t++, o += 4) w[t] = (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
    for (t = 16; t < 64; t++) {
      x = w[t - 15]; y = w[t - 2];
      w[t] = (w[t - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[t - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) >>> 0;
    }
    var h = this.h, a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4], f = h[5], g = h[6], hh = h[7], t1, t2;
    for (t = 0; t < 64; t++) {
      t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K256[t] + w[t]) >>> 0;
      t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (dd + t1) >>> 0; dd = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + dd) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  };
  SHA256.prototype.digest = function () { this._finish(false); return hex32be(this.h); };

  /* ---------------- SHA-1 ---------------- */
  function SHA1() {
    Base.call(this);
    this.h = new Uint32Array([0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0]);
    this.w = new Uint32Array(80);
  }
  SHA1.prototype = Object.create(Base.prototype);
  SHA1.prototype._block = function (d, o) {
    var w = this.w, t, x;
    for (t = 0; t < 16; t++, o += 4) w[t] = (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
    for (t = 16; t < 80; t++) { x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
    var h = this.h, a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4], f, k, tmp;
    for (t = 0; t < 80; t++) {
      if (t < 20) { f = (b & c) | (~b & dd); k = 0x5a827999; }
      else if (t < 40) { f = b ^ c ^ dd; k = 0x6ed9eba1; }
      else if (t < 60) { f = (b & c) | (b & dd) | (c & dd); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ dd; k = 0xca62c1d6; }
      tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
      e = dd; dd = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + dd) >>> 0; h[4] = (h[4] + e) >>> 0;
  };
  SHA1.prototype.digest = function () { this._finish(false); return hex32be(this.h); };

  /* ---------------- MD5 ---------------- */
  var MD5_S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  var MD5_K = new Uint32Array(64);
  for (var mi = 0; mi < 64; mi++) MD5_K[mi] = Math.floor(Math.abs(Math.sin(mi + 1)) * 4294967296) >>> 0;
  function MD5() {
    Base.call(this);
    this.h = new Uint32Array([0x67452301,0xefcdab89,0x98badcfe,0x10325476]);
    this.w = new Uint32Array(16);
  }
  MD5.prototype = Object.create(Base.prototype);
  MD5.prototype._block = function (d, o) {
    var w = this.w, t, f, g, tmp;
    for (t = 0; t < 16; t++, o += 4) w[t] = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
    var h = this.h, a = h[0], b = h[1], c = h[2], dd = h[3];
    for (t = 0; t < 64; t++) {
      if (t < 16) { f = (b & c) | (~b & dd); g = t; }
      else if (t < 32) { f = (dd & b) | (~dd & c); g = (5 * t + 1) & 15; }
      else if (t < 48) { f = b ^ c ^ dd; g = (3 * t + 5) & 15; }
      else { f = c ^ (b | ~dd); g = (7 * t) & 15; }
      tmp = dd; dd = c; c = b;
      var sum = (a + f + MD5_K[t] + w[g]) >>> 0;
      b = (b + ((sum << MD5_S[t]) | (sum >>> (32 - MD5_S[t])))) >>> 0;
      a = tmp;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + dd) >>> 0;
  };
  MD5.prototype.digest = function () { this._finish(true); return hex32le(this.h); };

  var api = { SHA256: SHA256, SHA1: SHA1, MD5: MD5,
    create: function (name) { if (name === 'sha256') return new SHA256(); if (name === 'sha1') return new SHA1(); if (name === 'md5') return new MD5(); throw new Error('unknown algorithm ' + name); },
    /* Known answers, checked on every page load. */
    vectors: {
      sha256: { '': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'abc': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
      sha1: { '': 'da39a3ee5e6b4b0d3255bfef95601890afd80709', 'abc': 'a9993e364706816aba3e25717850c26c9cd0d89d' },
      md5: { '': 'd41d8cd98f00b204e9800998ecf8427e', 'abc': '900150983cd24fb0d6963f7d28e17f72' }
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OptimatechHashes = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
