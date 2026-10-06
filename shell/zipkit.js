/* Byte-level helpers shared by the tools: CRC-32, Adler-32, reading and writing ZIP containers
   (Office files are ZIPs), raw deflate through the browser's own DecompressionStream, and a
   builder for a valid zlib stream of spaces at an exact length, used to blank compressed PDF
   metadata without moving a single byte. Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function (root) {
  'use strict';
  var CRC_TABLE = (function () { var t = new Int32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
  function crc32(bytes, seed) { var c = (seed === undefined ? 0 : seed) ^ -1; for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
  function adler32(bytes) { var a = 1, b = 0; for (var i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }

  var dec = new TextDecoder('utf-8'), enc = new TextEncoder();
  function utf8(bytes) { return dec.decode(bytes); }
  function bytesOf(str) { return enc.encode(str); }
  function latin1(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function put16(b, o, v) { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; }
  function put32(b, o, v) { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; }

  function streamBytes(bytes, kind, Ctor) {
    var s = new Ctor(kind); var w = s.writable.getWriter(); w.write(bytes); w.close();
    return new Response(s.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function inflateRaw(bytes) { return streamBytes(bytes, 'deflate-raw', DecompressionStream); }
  function inflateZlib(bytes) { return streamBytes(bytes, 'deflate', DecompressionStream); }
  function deflateRaw(bytes) { return streamBytes(bytes, 'deflate-raw', CompressionStream); }

  /* Read a ZIP from bytes. Returns {entries:[{name, method, crc, csize, usize, dataOffset, time, date, extAttr, data(), raw()}]}. */
  function readZip(bytes) {
    var n = bytes.length, eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 65557); i--) { if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; } }
    if (eocd < 0) throw new Error('not a ZIP file');
    var count = u16(bytes, eocd + 10), cdOffset = u32(bytes, eocd + 16), p = cdOffset, entries = [];
    for (var e = 0; e < count; e++) {
      if (u32(bytes, p) !== 0x02014b50) throw new Error('bad central directory');
      var method = u16(bytes, p + 10), time = u16(bytes, p + 12), date = u16(bytes, p + 14), crc = u32(bytes, p + 16), csize = u32(bytes, p + 20), usize = u32(bytes, p + 24);
      var nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32), extAttr = u32(bytes, p + 38), local = u32(bytes, p + 42);
      var name = utf8(bytes.subarray(p + 46, p + 46 + nameLen));
      if (u32(bytes, local) !== 0x04034b50) throw new Error('bad local header for ' + name);
      var dataOffset = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      (function (entry) {
        entry.raw = function () { return bytes.subarray(entry.dataOffset, entry.dataOffset + entry.csize); };
        entry.data = function () { var r = entry.raw(); if (entry.method === 0) return Promise.resolve(r); if (entry.method === 8) return inflateRaw(r); return Promise.reject(new Error('unsupported compression method ' + entry.method + ' for ' + entry.name)); };
        entries.push(entry);
      })({ name: name, method: method, time: time, date: date, crc: crc, csize: csize, usize: usize, dataOffset: dataOffset, extAttr: extAttr });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries: entries };
  }

  /* Write a ZIP. Each item: {name, time, date, extAttr, and either data: Uint8Array (stored) or raw: {bytes, method, crc, usize}} */
  function writeZip(items) {
    var parts = [], offset = 0, central = [];
    items.forEach(function (it) {
      var nameBytes = bytesOf(it.name), payload, method, crc, usize;
      if (it.raw) { payload = it.raw.bytes; method = it.raw.method; crc = it.raw.crc; usize = it.raw.usize; }
      else { payload = it.data; method = 0; crc = crc32(payload); usize = payload.length; }
      var lh = new Uint8Array(30 + nameBytes.length);
      put32(lh, 0, 0x04034b50); put16(lh, 4, 20); put16(lh, 6, 0); put16(lh, 8, method); put16(lh, 10, it.time || 0); put16(lh, 12, it.date || 0);
      put32(lh, 14, crc); put32(lh, 18, payload.length); put32(lh, 22, usize); put16(lh, 26, nameBytes.length); put16(lh, 28, 0); lh.set(nameBytes, 30);
      var cd = new Uint8Array(46 + nameBytes.length);
      put32(cd, 0, 0x02014b50); put16(cd, 4, 20); put16(cd, 6, 20); put16(cd, 8, 0); put16(cd, 10, method); put16(cd, 12, it.time || 0); put16(cd, 14, it.date || 0);
      put32(cd, 16, crc); put32(cd, 20, payload.length); put32(cd, 24, usize); put16(cd, 28, nameBytes.length); put16(cd, 30, 0); put16(cd, 32, 0); put16(cd, 34, 0); put16(cd, 36, 0);
      put32(cd, 38, it.extAttr || 0); put32(cd, 42, offset); cd.set(nameBytes, 46);
      parts.push(lh, payload); offset += lh.length + payload.length; central.push(cd);
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (cd) { parts.push(cd); cdSize += cd.length; });
    var eocd = new Uint8Array(22);
    put32(eocd, 0, 0x06054b50); put16(eocd, 4, 0); put16(eocd, 6, 0); put16(eocd, 8, items.length); put16(eocd, 10, items.length); put32(eocd, 12, cdSize); put32(eocd, 16, cdStart); put16(eocd, 20, 0);
    parts.push(eocd);
    var total = 0; parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  /* A valid zlib stream of exactly `length` bytes whose content is spaces, built from stored blocks.
     Layout: 2-byte header, k stored blocks of (5 + len) bytes, 4-byte Adler-32. Returns null if length < 11. */
  function zlibStoredSpaces(length) {
    if (length < 11) return null;
    var payloadTotal = length - 6, blocks = 1;
    while (payloadTotal - 5 * blocks > 65535 * blocks) blocks++;
    var payloadLen = payloadTotal - 5 * blocks;
    if (payloadLen < 0) return null;
    var out = new Uint8Array(length), o = 0;
    out[o++] = 0x78; out[o++] = 0x01;
    var payload = new Uint8Array(payloadLen); payload.fill(0x20);
    var left = payloadLen, pos = 0;
    for (var b = 0; b < blocks; b++) {
      var len = (b < blocks - 1) ? Math.min(65535, left) : left;
      out[o++] = (b === blocks - 1) ? 1 : 0;
      out[o++] = len & 255; out[o++] = (len >>> 8) & 255; out[o++] = (~len) & 255; out[o++] = ((~len) >>> 8) & 255;
      out.set(payload.subarray(pos, pos + len), o); o += len; pos += len; left -= len;
    }
    put32be(out, o, adler32(payload));
    return out;
  }
  function put32be(b, o, v) { b[o] = v >>> 24; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; }

  var api = { crc32: crc32, adler32: adler32, utf8: utf8, bytesOf: bytesOf, latin1: latin1, u16: u16, u32: u32, readZip: readZip, writeZip: writeZip, inflateRaw: inflateRaw, inflateZlib: inflateZlib, deflateRaw: deflateRaw, zlibStoredSpaces: zlibStoredSpaces };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ZipKit = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
