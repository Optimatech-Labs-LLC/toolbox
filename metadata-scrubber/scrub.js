/* Metadata inspection and removal for JPEG, PNG, WebP, PDF and Office files, in plain JavaScript.
   Nothing is re-encoded: segments and chunks are dropped, PDF strings are blanked in place, and
   Office XML parts are rewritten inside the same ZIP. Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function (root) {
  'use strict';
  var K = root.ZipKit;
  function be16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function be32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function asciiAt(b, s, e) { var r = ''; for (var i = s; i < e && i < b.length; i++) { if (b[i] === 0) break; r += String.fromCharCode(b[i]); } return r; }
  function startsWith(b, o, str) { for (var i = 0; i < str.length; i++) if (b[o + i] !== str.charCodeAt(i)) return false; return true; }
  function concat(parts) { var n = 0; parts.forEach(function (p) { n += p.length; }); var out = new Uint8Array(n), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out; }
  function kb(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }

  /* ---------------- TIFF / EXIF ---------------- */
  var IFD_TAGS = { 0x010F: 'Camera make', 0x0110: 'Camera model', 0x0112: 'Orientation', 0x0131: 'Software', 0x0132: 'Date and time', 0x013B: 'Artist', 0x8298: 'Copyright', 0x9003: 'Date taken', 0x9004: 'Date digitized', 0x9010: 'Time zone', 0x9286: 'User comment', 0x927C: 'Maker note', 0xA420: 'Image unique ID', 0xA430: 'Camera owner', 0xA431: 'Body serial number', 0xA433: 'Lens make', 0xA434: 'Lens model', 0xA435: 'Lens serial number', 0x0201: 'Embedded thumbnail' };
  var GPS_TAGS = { 1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 5: 'GPSAltitudeRef', 6: 'GPSAltitude', 7: 'GPSTimeStamp', 29: 'GPSDateStamp', 16: 'GPSImgDirection', 27: 'GPSProcessingMethod' };
  var TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function parseTIFF(b, base) {
    var le = b[base] === 0x49 && b[base + 1] === 0x49;
    if (!le && !(b[base] === 0x4D && b[base + 1] === 0x4D)) throw new Error('not TIFF');
    var r16 = function (o) { return le ? (b[o] | (b[o + 1] << 8)) : be16(b, o); };
    var r32 = function (o) { return le ? ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0) : be32(b, o); };
    var findings = [], info = { orientation: 1, hasThumbnail: false, gps: null };
    var seen = {};
    function readIFD(off, tagmap, group, depth) {
      if (depth > 3 || off < 8 || base + off + 2 > b.length || seen[off]) return 0; seen[off] = true;
      var p = base + off, count = r16(p); if (count > 500) return 0; p += 2;
      var raw = {};
      for (var i = 0; i < count; i++, p += 12) {
        if (p + 12 > b.length) break;
        var tag = r16(p), type = r16(p + 2), n = r32(p + 4), size = (TYPE_SIZE[type] || 1) * n;
        var vo = size <= 4 ? p + 8 : base + r32(p + 8);
        if (vo + size > b.length) continue;
        var value = null;
        if (type === 2) value = asciiAt(b, vo, vo + n).trim();
        else if (type === 3) value = n === 1 ? r16(vo) : Array.prototype.slice.call({ length: Math.min(n, 16) }).map(function (_, k) { return r16(vo + 2 * k); });
        else if (type === 4 || type === 9) value = n === 1 ? r32(vo) : Array.prototype.slice.call({ length: Math.min(n, 16) }).map(function (_, k) { return r32(vo + 4 * k); });
        else if (type === 5 || type === 10) value = Array.prototype.slice.call({ length: Math.min(n, 8) }).map(function (_, k) { var num = r32(vo + 8 * k), den = r32(vo + 8 * k + 4); return den ? num / den : 0; });
        else if (type === 1 || type === 7) value = n <= 64 ? asciiAt(b, vo, vo + n) : '(' + kb(n) + ' of binary data)';
        raw[tag] = value;
        if (group === 'EXIF' && tag === 0x8769) readIFD(r32(vo), IFD_TAGS, 'EXIF', depth + 1);
        else if (group === 'EXIF' && tag === 0x8825) readIFD(r32(vo), GPS_TAGS, 'GPS', depth + 1);
        else if (tagmap[tag]) {
          if (tag === 0x0112) info.orientation = value;
          if (tag === 0x0201) { info.hasThumbnail = true; findings.push({ section: group, name: 'Embedded thumbnail', value: 'present (can show the uncropped original)' }); continue; }
          if (tag === 0x927C) { findings.push({ section: group, name: 'Maker note', value: '(' + kb(n) + ' of camera-specific data, often including serial numbers)' }); continue; }
          if (group === 'GPS') continue;
          findings.push({ section: group, name: tagmap[tag], value: Array.isArray(value) ? value.join(', ') : String(value) });
        }
      }
      if (group === 'GPS') {
        var lat = raw[2], lon = raw[4];
        if (Array.isArray(lat) && Array.isArray(lon) && lat.length >= 3 && lon.length >= 3) {
          var dlat = (lat[0] + lat[1] / 60 + lat[2] / 3600) * (raw[1] === 'S' ? -1 : 1), dlon = (lon[0] + lon[1] / 60 + lon[2] / 3600) * (raw[3] === 'W' ? -1 : 1);
          info.gps = { lat: dlat, lon: dlon };
          findings.push({ section: 'GPS', name: 'Location', value: dlat.toFixed(6) + ', ' + dlon.toFixed(6) + ' (latitude, longitude)', risky: true });
        }
        if (Array.isArray(raw[6])) findings.push({ section: 'GPS', name: 'Altitude', value: raw[6][0].toFixed(1) + ' m' + (raw[5] === 1 ? ' below sea level' : '') });
        if (raw[29] || Array.isArray(raw[7])) findings.push({ section: 'GPS', name: 'GPS date and time', value: (raw[29] || '') + (Array.isArray(raw[7]) ? ' ' + raw[7].map(function (x) { return ('0' + Math.floor(x)).slice(-2); }).join(':') : '') });
        if (raw[16] !== undefined) findings.push({ section: 'GPS', name: 'Direction', value: (Array.isArray(raw[16]) ? raw[16][0] : raw[16]) + ' degrees' });
      }
      var next = r32(p);
      return next;
    }
    var ifd1 = readIFD(r32(base + 4), IFD_TAGS, 'EXIF', 0);
    if (ifd1 && ifd1 > 8) readIFD(ifd1, IFD_TAGS, 'EXIF', 1);
    return { findings: findings, info: info };
  }

  /* ---------------- XMP and IPTC ---------------- */
  var XMP_FIELDS = [['xmp:CreatorTool', 'Creator tool'], ['dc:creator', 'Creator'], ['dc:rights', 'Rights'], ['dc:description', 'Description'], ['dc:title', 'Title'], ['dc:subject', 'Keywords'], ['photoshop:City', 'City'], ['photoshop:Country', 'Country'], ['photoshop:Credit', 'Credit'], ['photoshop:AuthorsPosition', 'Author position'], ['Iptc4xmpCore:Location', 'Location'], ['xmp:CreateDate', 'Create date'], ['xmp:ModifyDate', 'Modify date'], ['xmp:MetadataDate', 'Metadata date'], ['xmpMM:DocumentID', 'Document ID'], ['xmpMM:InstanceID', 'Instance ID'], ['xmpMM:OriginalDocumentID', 'Original document ID'], ['exif:GPSLatitude', 'GPS latitude'], ['exif:GPSLongitude', 'GPS longitude'], ['pdf:Producer', 'Producer'], ['pdf:Keywords', 'Keywords'], ['tiff:Make', 'Camera make'], ['tiff:Model', 'Camera model'], ['aux:SerialNumber', 'Camera serial number'], ['aux:LensSerialNumber', 'Lens serial number'], ['Iptc4xmpExt:PersonInImage', 'Person in image']];
  function xmpFindings(xml, section) {
    var out = [];
    XMP_FIELDS.forEach(function (f) {
      var name = f[0], label = f[1], m;
      m = new RegExp(name.replace(':', '\\:') + '="([^"]*)"').exec(xml);
      if (!m) { m = new RegExp('<' + name.replace(':', '\\:') + '[^>]*>([\\s\\S]*?)</' + name.replace(':', '\\:') + '>').exec(xml); if (m) { var inner = m[1]; var li = inner.match(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g); if (li) m[1] = li.map(function (x) { return x.replace(/<[^>]+>/g, ''); }).join(', '); else m[1] = inner.replace(/<[^>]+>/g, '').trim(); } }
      if (m && m[1].trim()) out.push({ section: section, name: label, value: m[1].trim().slice(0, 200), risky: /GPS|Person/.test(label) });
    });
    return out;
  }
  var IPTC = { 5: 'Object name', 25: 'Keywords', 55: 'Date created', 80: 'By-line (creator)', 85: 'By-line title', 90: 'City', 92: 'Sub-location', 95: 'Province or state', 101: 'Country', 105: 'Headline', 110: 'Credit', 115: 'Source', 116: 'Copyright notice', 120: 'Caption', 122: 'Caption writer' };
  function iptcFindings(b, s, e) {
    var out = [], p = s;
    while (p + 5 <= e) {
      if (b[p] === 0x1C && b[p + 1] === 2) { var ds = b[p + 2], len = be16(b, p + 3); var val = K.utf8(b.subarray(p + 5, p + 5 + len)); if (IPTC[ds]) out.push({ section: 'IPTC', name: IPTC[ds], value: val }); p += 5 + len; } else p++;
    }
    return out;
  }

  /* ---------------- JPEG ---------------- */
  function jpegSegments(b) {
    if (!(b[0] === 0xFF && b[1] === 0xD8)) throw new Error('not a JPEG');
    var p = 2, segs = [];
    while (p + 1 < b.length) {
      if (b[p] !== 0xFF) throw new Error('corrupt JPEG marker stream');
      var m = b[p + 1];
      if (m === 0xFF) { p++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
      var len = be16(b, p + 2), seg = { marker: m, start: p, dataStart: p + 4, end: p + 2 + len };
      segs.push(seg); p = seg.end;
      if (m === 0xDA) break;
    }
    return { segs: segs, sosEnd: p };
  }
  function findEOI(b, from) { for (var i = from; i + 1 < b.length; i++) { if (b[i] === 0xFF && b[i + 1] === 0xD9) return i; } return -1; }
  function jpegInspect(b) {
    var r = jpegSegments(b), findings = [], notes = [], info = { orientation: 1 }, removable = 0;
    r.segs.forEach(function (s) {
      var m = s.marker, data = s.dataStart, end = s.end;
      if (m === 0xE1 && startsWith(b, data, 'Exif\0\0')) { try { var t = parseTIFF(b, data + 6); findings = findings.concat(t.findings); info.orientation = t.info.orientation; } catch (e) { notes.push('EXIF block could not be parsed; it will still be removed.'); } removable += end - s.start; }
      else if (m === 0xE1 && startsWith(b, data, 'http://ns.adobe.com/x')) { var xml = K.utf8(b.subarray(data, end)); findings.push({ section: 'XMP', name: 'XMP packet', value: kb(end - data) }); findings = findings.concat(xmpFindings(xml, 'XMP')); removable += end - s.start; }
      else if (m === 0xED) { findings.push({ section: 'IPTC', name: 'Photoshop/IPTC block', value: kb(end - data) }); findings = findings.concat(iptcFindings(b, data, end)); removable += end - s.start; }
      else if (m === 0xFE) { findings.push({ section: 'Comment', name: 'Comment', value: K.utf8(b.subarray(data, end)).slice(0, 300) }); removable += end - s.start; }
      else if (m === 0xE2 && startsWith(b, data, 'ICC_PROFILE')) { findings.push({ section: 'Kept', name: 'ICC color profile', value: kb(end - data) + ', kept so colors stay right' }); }
      else if (m === 0xE0 || m === 0xEE || m === 0xE2) { /* JFIF, Adobe, other APP2: kept */ }
      else if (m >= 0xE3 && m <= 0xEF) { findings.push({ section: 'Other', name: 'APP' + (m - 0xE0) + ' block', value: kb(end - data) + ' of application data' }); removable += end - s.start; }
    });
    var eoi = findEOI(b, r.sosEnd);
    var trailer = eoi >= 0 ? b.length - (eoi + 2) : 0;
    if (trailer > 0) { findings.push({ section: 'Other', name: 'Data after end of image', value: kb(trailer) + ' (hidden extra data, sometimes a second image or video)' }); removable += trailer; }
    if (eoi < 0) notes.push('No end-of-image marker found; the file may be truncated. It will be copied as is after the metadata blocks.');
    return { kind: 'jpeg', findings: findings, notes: notes, info: info, removable: removable, eoi: eoi };
  }
  function minimalExif(orientation) {
    var t = new Uint8Array(6 + 8 + 2 + 12 + 4);
    t.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0); t.set([0x4D, 0x4D, 0, 0x2A, 0, 0, 0, 8], 6);
    t[14] = 0; t[15] = 1; t.set([0x01, 0x12, 0, 3, 0, 0, 0, 1, (orientation >> 8) & 255, orientation & 255, 0, 0], 16); t.set([0, 0, 0, 0], 28);
    var seg = new Uint8Array(4 + t.length); seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = ((t.length + 2) >> 8) & 255; seg[3] = (t.length + 2) & 255; seg.set(t, 4);
    return seg;
  }
  function jpegClean(b, report, opts) {
    var r = jpegSegments(b), parts = [b.subarray(0, 2)], changes = [];
    var sos = null;
    r.segs.forEach(function (s) {
      var m = s.marker, keep;
      if (m === 0xDA) { sos = s; return; }
      if (m === 0xE0 || m === 0xEE) keep = true;
      else if (m === 0xE2) keep = opts.keepICC !== false || !startsWith(b, s.dataStart, 'ICC_PROFILE');
      else if (m >= 0xE1 && m <= 0xEF) keep = false;
      else if (m === 0xFE) keep = false;
      else keep = true;
      if (keep) parts.push(b.subarray(s.start, s.end)); else changes.push('Removed ' + (m === 0xFE ? 'comment' : 'APP' + (m - 0xE0)) + ' block, ' + kb(s.end - s.start));
    });
    if (report.info.orientation && report.info.orientation !== 1) { parts.push(minimalExif(report.info.orientation)); changes.push('Kept only the orientation flag (' + report.info.orientation + ') in a fresh 36-byte EXIF block so the image is not shown rotated'); }
    if (!sos) throw new Error('no scan data found');
    var end = report.eoi >= 0 && opts.dropTrailer !== false ? report.eoi + 2 : b.length;
    if (report.eoi >= 0 && opts.dropTrailer !== false && b.length > report.eoi + 2) changes.push('Dropped ' + kb(b.length - report.eoi - 2) + ' of data after the end-of-image marker');
    parts.push(b.subarray(sos.start, end));
    return { bytes: concat(parts), changes: changes };
  }

  /* ---------------- PNG ---------------- */
  var PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  var PNG_DROP = { tEXt: 1, zTXt: 1, iTXt: 1, eXIf: 1, tIME: 1, dSIG: 1 };
  function pngChunks(b) {
    for (var i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) throw new Error('not a PNG');
    var p = 8, chunks = [];
    while (p + 8 <= b.length) { var len = be32(b, p), type = asciiAt(b, p + 4, p + 8), c = { type: type, start: p, dataStart: p + 8, len: len, end: p + 12 + len }; if (c.end > b.length) break; chunks.push(c); p = c.end; if (type === 'IEND') break; }
    return chunks;
  }
  function pngInspect(b) {
    var chunks = pngChunks(b), findings = [], notes = [], removable = 0, pending = [];
    chunks.forEach(function (c) {
      var d = b.subarray(c.dataStart, c.dataStart + c.len);
      if (c.type === 'tEXt') { var z = d.indexOf(0); findings.push({ section: 'Text', name: K.latin1(d.subarray(0, z)), value: K.latin1(d.subarray(z + 1)).slice(0, 300) }); }
      else if (c.type === 'zTXt') { var z2 = d.indexOf(0); var key = K.latin1(d.subarray(0, z2)); pending.push(K.inflateZlib(d.subarray(z2 + 2)).then(function (t) { findings.push({ section: 'Text', name: key + ' (compressed)', value: K.latin1(t).slice(0, 300) }); }, function () { findings.push({ section: 'Text', name: key + ' (compressed)', value: '(could not decompress)' }); })); }
      else if (c.type === 'iTXt') { var z3 = d.indexOf(0), key3 = K.latin1(d.subarray(0, z3)), flag = d[z3 + 1], q = z3 + 3; var z4 = d.indexOf(0, q); var z5 = d.indexOf(0, z4 + 1); var text = d.subarray(z5 + 1);
        if (flag === 1) pending.push(K.inflateZlib(text).then(function (t) { var s = K.utf8(t); findings.push({ section: 'Text', name: key3, value: s.slice(0, 300) }); if (/x:xmpmeta|xmp/.test(key3) || /<x:xmpmeta/.test(s)) findings.push.apply(findings, xmpFindings(s, 'XMP')); }, function () {}));
        else { var s2 = K.utf8(text); findings.push({ section: 'Text', name: key3, value: s2.slice(0, 300) }); if (/XML:com.adobe.xmp/.test(key3) || /<x:xmpmeta/.test(s2)) findings.push.apply(findings, xmpFindings(s2, 'XMP')); } }
      else if (c.type === 'eXIf') { try { var t = parseTIFF(b, c.dataStart); findings.push.apply(findings, t.findings); } catch (e) { notes.push('EXIF chunk could not be parsed; it will still be removed.'); } }
      else if (c.type === 'tIME') { findings.push({ section: 'Time', name: 'Last modified', value: be16(d, 0) + '-' + ('0' + d[2]).slice(-2) + '-' + ('0' + d[3]).slice(-2) + ' ' + ('0' + d[4]).slice(-2) + ':' + ('0' + d[5]).slice(-2) + ':' + ('0' + d[6]).slice(-2) }); }
      if (PNG_DROP[c.type]) removable += c.end - c.start;
    });
    return Promise.all(pending).then(function () { return { kind: 'png', findings: findings, notes: notes, info: {}, removable: removable }; });
  }
  function pngClean(b) {
    var chunks = pngChunks(b), parts = [b.subarray(0, 8)], changes = [], counts = {};
    chunks.forEach(function (c) { if (PNG_DROP[c.type]) counts[c.type] = (counts[c.type] || 0) + 1; else parts.push(b.subarray(c.start, c.end)); });
    Object.keys(counts).forEach(function (t) { changes.push('Removed ' + counts[t] + ' ' + t + ' chunk' + (counts[t] > 1 ? 's' : '')); });
    return { bytes: concat(parts), changes: changes };
  }

  /* ---------------- WebP ---------------- */
  function webpChunks(b) {
    if (!(startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP'))) throw new Error('not a WebP');
    var p = 12, chunks = [];
    while (p + 8 <= b.length) { var fourcc = asciiAt(b, p, p + 4), size = K.u32(b, p + 4), c = { fourcc: fourcc, start: p, dataStart: p + 8, size: size, end: p + 8 + size + (size & 1) }; chunks.push(c); p = c.end; }
    return chunks;
  }
  function webpInspect(b) {
    var chunks = webpChunks(b), findings = [], notes = [], removable = 0;
    chunks.forEach(function (c) {
      if (c.fourcc === 'EXIF') { var off = startsWith(b, c.dataStart, 'Exif\0\0') ? c.dataStart + 6 : c.dataStart; try { findings.push.apply(findings, parseTIFF(b, off).findings); } catch (e) { notes.push('EXIF chunk could not be parsed; it will still be removed.'); } removable += c.end - c.start; }
      else if (c.fourcc === 'XMP ') { var xml = K.utf8(b.subarray(c.dataStart, c.dataStart + c.size)); findings.push({ section: 'XMP', name: 'XMP packet', value: kb(c.size) }); findings.push.apply(findings, xmpFindings(xml, 'XMP')); removable += c.end - c.start; }
      else if (c.fourcc === 'ICCP') findings.push({ section: 'Kept', name: 'ICC color profile', value: kb(c.size) + ', kept so colors stay right' });
    });
    return { kind: 'webp', findings: findings, notes: notes, info: {}, removable: removable };
  }
  function webpClean(b) {
    var chunks = webpChunks(b), parts = [], changes = [];
    chunks.forEach(function (c) {
      if (c.fourcc === 'EXIF' || c.fourcc === 'XMP ') { changes.push('Removed ' + c.fourcc.trim() + ' chunk, ' + kb(c.size)); return; }
      var slice = new Uint8Array(b.subarray(c.start, c.end));
      if (c.fourcc === 'VP8X') { slice[8] = slice[8] & ~0x0C; }
      parts.push(slice);
    });
    var body = concat(parts), out = new Uint8Array(12 + body.length);
    out.set(b.subarray(0, 12), 0); out.set(body, 12);
    var size = body.length + 4; out[4] = size & 255; out[5] = (size >>> 8) & 255; out[6] = (size >>> 16) & 255; out[7] = (size >>> 24) & 255;
    return { bytes: out, changes: changes };
  }

  /* ---------------- PDF ---------------- */
  var PDF_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];
  function pdfString(tok) {
    if (tok[0] === '<') { var hex = tok.slice(1, -1).replace(/\s+/g, ''); var bytes = []; for (var i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16)); return pdfBytesToText(bytes); }
    var s = tok.slice(1, -1), out = [], i = 0;
    while (i < s.length) { var c = s[i]; if (c === '\\') { var n = s[i + 1]; if (/[0-7]/.test(n)) { var oct = s.substr(i + 1, 3).match(/^[0-7]{1,3}/)[0]; out.push(parseInt(oct, 8)); i += 1 + oct.length; continue; } var map = { n: 10, r: 13, t: 9, b: 8, f: 12 }; out.push(map[n] !== undefined ? map[n] : n.charCodeAt(0)); i += 2; } else { out.push(c.charCodeAt(0)); i++; } }
    return pdfBytesToText(out);
  }
  function pdfBytesToText(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) { var s = ''; for (var i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]); return s; }
    return bytes.map(function (c) { return String.fromCharCode(c); }).join('');
  }
  function pdfDate(v) { var m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(v); return m ? m[1] + (m[2] ? '-' + m[2] : '') + (m[3] ? '-' + m[3] : '') + (m[4] ? ' ' + m[4] + ':' + (m[5] || '00') : '') : v; }
  function pdfScan(b) {
    var s = K.latin1(b), strings = [], streams = [];
    PDF_KEYS.forEach(function (key) {
      var re = new RegExp('/' + key + '\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)', 'g'), m;
      while ((m = re.exec(s))) { var tokStart = m.index + m[0].length - m[1].length; strings.push({ key: key, start: tokStart, end: tokStart + m[1].length, value: pdfString(m[1]) }); }
    });
    var re2 = /\/Type\s*\/Metadata/g, m2;
    while ((m2 = re2.exec(s))) {
      var dictStart = s.lastIndexOf('obj', m2.index), streamKw = s.indexOf('stream', m2.index);
      if (dictStart < 0 || streamKw < 0) continue;
      var dict = s.slice(dictStart, streamKw);
      var lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict), filterM = /\/Filter\s*\/(\w+)/.exec(dict), parms = /\/DecodeParms/.test(dict);
      var dataStart = streamKw + 6; if (s[dataStart] === '\r') dataStart++; if (s[dataStart] === '\n') dataStart++;
      var length;
      if (lenM) length = parseInt(lenM[1], 10); else { var endKw = s.indexOf('endstream', dataStart); length = endKw - dataStart; while (length > 0 && (s[dataStart + length - 1] === '\n' || s[dataStart + length - 1] === '\r')) length--; }
      if (length > 0 && dataStart + length <= b.length) streams.push({ start: dataStart, length: length, filter: filterM ? filterM[1] : null, parms: parms });
    }
    return { text: s, strings: strings, streams: streams, encrypted: /\/Encrypt\b/.test(s), objstm: /\/ObjStm\b/.test(s) };
  }
  function pdfInspect(b) {
    var scan = pdfScan(b), findings = [], notes = [], pending = [];
    scan.strings.forEach(function (st) { if (st.value.trim()) findings.push({ section: 'Document info', name: st.key.replace(/([a-z])([A-Z])/g, '$1 $2'), value: /Date$/.test(st.key) ? pdfDate(st.value) : st.value.slice(0, 200) }); });
    scan.streams.forEach(function (sm) {
      var bytes = b.subarray(sm.start, sm.start + sm.length);
      var blank = !sm.filter && /^\s*$/.test(K.latin1(bytes));
      findings.push({ section: blank ? 'Kept' : 'XMP', name: 'XMP metadata stream', value: kb(sm.length) + (sm.filter ? ', ' + sm.filter : '') + (blank ? ', already blank' : '') });
      if (!sm.filter && !blank) findings.push.apply(findings, xmpFindings(K.utf8(bytes), 'XMP'));
      else if (sm.filter === 'FlateDecode') pending.push(K.inflateZlib(bytes).then(function (t) { findings.push.apply(findings, xmpFindings(K.utf8(t), 'XMP')); }, function () { notes.push('An XMP stream could not be decompressed for display.'); }));
    });
    if (scan.encrypted) notes.push('This PDF is encrypted. Its metadata cannot be read or blanked here.');
    if (scan.objstm) notes.push('This PDF stores some objects in compressed object streams. Metadata inside those cannot be reached without re-saving the file, so a cleaned copy may still carry it. Re-save from a PDF application if that matters.');
    var removable = 0; scan.strings.forEach(function (st) { removable += st.end - st.start; }); scan.streams.forEach(function (sm) { removable += sm.length; });
    return Promise.all(pending).then(function () { return { kind: 'pdf', findings: findings, notes: notes, info: { encrypted: scan.encrypted }, removable: removable, scan: scan }; });
  }
  function pdfClean(b, report) {
    if (report.info.encrypted) throw new Error('encrypted PDF');
    var out = new Uint8Array(b), changes = [], scan = report.scan, blanked = 0;
    scan.strings.forEach(function (st) { for (var i = st.start + 1; i < st.end - 1; i++) out[i] = 0x20; blanked++; });
    if (blanked) changes.push('Blanked ' + blanked + ' document information field' + (blanked > 1 ? 's' : '') + ' in place');
    scan.streams.forEach(function (sm) {
      if (!sm.filter) { out.fill(0x20, sm.start, sm.start + sm.length); changes.push('Blanked an XMP metadata stream, ' + kb(sm.length)); }
      else if (sm.filter === 'FlateDecode' && !sm.parms) { var z = K.zlibStoredSpaces(sm.length); if (z) { out.set(z, sm.start); changes.push('Replaced a compressed XMP metadata stream with blank data of the same size, ' + kb(sm.length)); } else changes.push('An XMP stream was too small to replace safely and was left in place'); }
      else changes.push('An XMP stream uses an unsupported encoding (' + sm.filter + ') and was left in place');
    });
    return { bytes: out, changes: changes };
  }

  /* ---------------- Office (DOCX, XLSX, PPTX) ---------------- */
  var CORE = [['dc:creator', 'Author'], ['cp:lastModifiedBy', 'Last modified by'], ['dc:title', 'Title'], ['dc:subject', 'Subject'], ['dc:description', 'Comments'], ['cp:keywords', 'Keywords'], ['cp:category', 'Category'], ['cp:contentStatus', 'Status'], ['cp:revision', 'Revision'], ['dcterms:created', 'Created'], ['dcterms:modified', 'Modified'], ['cp:lastPrinted', 'Last printed']];
  var APP = [['Company', 'Company'], ['Manager', 'Manager'], ['TotalTime', 'Total editing time (minutes)'], ['Template', 'Template'], ['HyperlinkBase', 'Hyperlink base'], ['Application', 'Application'], ['AppVersion', 'App version']];
  function xmlText(xml, tag) { var m = new RegExp('<' + tag.replace(':', '\\:') + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag.replace(':', '\\:') + '>').exec(xml); return m ? m[1].replace(/<[^>]+>/g, '').trim() : null; }
  function setXmlText(xml, tag, value) { return xml.replace(new RegExp('(<' + tag.replace(':', '\\:') + '(?:\\s[^>]*)?>)([\\s\\S]*?)(</' + tag.replace(':', '\\:') + '>)', 'g'), '$1' + value + '$3'); }
  function unesc(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
  function officeInspect(b) {
    var zip = K.readZip(b), names = zip.entries.map(function (e) { return e.name; });
    var kind = names.some(function (n) { return n.indexOf('word/') === 0; }) ? 'docx' : names.some(function (n) { return n.indexOf('xl/') === 0; }) ? 'xlsx' : names.some(function (n) { return n.indexOf('ppt/') === 0; }) ? 'pptx' : null;
    if (!kind) return Promise.resolve({ kind: 'zip', findings: [], notes: ['This is a ZIP archive but not an Office document. Nothing to clean here.'], info: {}, removable: 0 });
    var findings = [], notes = [], jobs = [], info = { authors: {} };
    function entry(n) { return zip.entries.filter(function (e) { return e.name === n; })[0]; }
    function text(n) { var e = entry(n); return e ? e.data().then(K.utf8) : Promise.resolve(null); }
    jobs.push(text('docProps/core.xml').then(function (xml) { if (!xml) return; CORE.forEach(function (f) { var v = xmlText(xml, f[0]); if (v) findings.push({ section: 'Properties', name: f[1], value: unesc(v) }); }); }));
    jobs.push(text('docProps/app.xml').then(function (xml) { if (!xml) return; APP.forEach(function (f) { var v = xmlText(xml, f[0]); if (v && !(f[0] === 'TotalTime' && v === '0')) findings.push({ section: f[0] === 'Application' || f[0] === 'AppVersion' ? 'Kept' : 'Properties', name: f[1], value: unesc(v) }); }); }));
    jobs.push(text('docProps/custom.xml').then(function (xml) { if (!xml) return; var m, re = /<property[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g; while ((m = re.exec(xml))) findings.push({ section: 'Custom properties', name: unesc(m[1]), value: unesc(m[2].replace(/<[^>]+>/g, '')).slice(0, 200) }); }));
    names.filter(function (n) { return /^docProps\/thumbnail\./.test(n); }).forEach(function (n) { findings.push({ section: 'Other', name: 'Thumbnail image', value: n + ', ' + kb(entry(n).usize) }); });
    var authorParts = names.filter(function (n) { return /^(word\/(document|comments|commentsExtended|footnotes|endnotes|header\d*|footer\d*)\.xml|ppt\/commentAuthors\.xml|xl\/comments\d*\.xml|word\/people\.xml)$/.test(n); });
    authorParts.forEach(function (n) { jobs.push(text(n).then(function (xml) { if (!xml) return; var m, re = /(?:w:author|w15:author|name)="([^"]*)"/g; while ((m = re.exec(xml))) { var a = unesc(m[1]); if (a) info.authors[a] = (info.authors[a] || 0) + 1; } var re2 = /<author>([\s\S]*?)<\/author>/g; while ((m = re2.exec(xml))) { var a2 = unesc(m[1].trim()); if (a2) info.authors[a2] = (info.authors[a2] || 0) + 1; } })); });
    return Promise.all(jobs).then(function () {
      Object.keys(info.authors).forEach(function (a) { findings.push({ section: 'Comments and tracked changes', name: 'Author', value: a + ' (' + info.authors[a] + ' mention' + (info.authors[a] > 1 ? 's' : '') + ')' }); });
      return { kind: kind, findings: findings, notes: notes, info: info, removable: 0, zip: zip, names: names };
    });
  }
  function officeClean(b, report, opts) {
    var zip = report.zip, changes = [], items = [], jobs = [];
    var dropNames = {};
    if (zip.entries.some(function (e) { return e.name === 'docProps/custom.xml'; })) { dropNames['docProps/custom.xml'] = 1; changes.push('Removed custom properties (docProps/custom.xml)'); }
    zip.entries.forEach(function (e) { if (/^docProps\/thumbnail\./.test(e.name)) { dropNames[e.name] = 1; changes.push('Removed the thumbnail image'); } });
    zip.entries.forEach(function (e) {
      if (dropNames[e.name]) return;
      var item = { name: e.name, time: e.time, date: e.date, extAttr: e.extAttr };
      var rewrite = null;
      if (e.name === 'docProps/core.xml') rewrite = function (xml) {
        ['dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'dc:description', 'cp:keywords', 'cp:category', 'cp:contentStatus'].forEach(function (t) { xml = setXmlText(xml, t, ''); });
        xml = setXmlText(xml, 'cp:revision', '1'); xml = xml.replace(/<cp:lastPrinted>[\s\S]*?<\/cp:lastPrinted>/g, '');
        if (opts.clearDates) { xml = xml.replace(/<dcterms:created[^>]*>[\s\S]*?<\/dcterms:created>/g, '').replace(/<dcterms:modified[^>]*>[\s\S]*?<\/dcterms:modified>/g, ''); }
        changes.push('Blanked author, last modified by, title, subject, comments, keywords, category and status' + (opts.clearDates ? ', and removed the created and modified dates' : '')); return xml; };
      else if (e.name === 'docProps/app.xml') rewrite = function (xml) { ['Company', 'Manager', 'HyperlinkBase', 'Template'].forEach(function (t) { xml = setXmlText(xml, t, ''); }); xml = setXmlText(xml, 'TotalTime', '0'); changes.push('Blanked company, manager, template and editing time'); return xml; };
      else if (e.name === '[Content_Types].xml') rewrite = function (xml) { return xml.replace(/<Override[^>]*PartName="\/docProps\/custom\.xml"[^>]*\/>/g, ''); };
      else if (e.name === '_rels/.rels') rewrite = function (xml) { return xml.replace(/<Relationship\b[^>]*(?:custom-properties|thumbnail)[^>]*\/>/g, ''); };
      else if (opts.anonymizeAuthors !== false && /^(word\/(document|comments|commentsExtended|footnotes|endnotes|header\d*|footer\d*)\.xml|ppt\/commentAuthors\.xml|xl\/comments\d*\.xml|word\/people\.xml)$/.test(e.name)) rewrite = function (xml) {
        var n = 0;
        xml = xml.replace(/(w:author|w15:author)="[^"]*"/g, function (m, k) { n++; return k + '="Author"'; }).replace(/w:initials="[^"]*"/g, 'w:initials="A"').replace(/(w15:userId)="[^"]*"/g, '$1=""');
        if (e.name === 'ppt/commentAuthors.xml') xml = xml.replace(/name="[^"]*"/g, function () { n++; return 'name="Author"'; }).replace(/initials="[^"]*"/g, 'initials="A"');
        if (/^xl\/comments/.test(e.name)) xml = xml.replace(/<author>[\s\S]*?<\/author>/g, function () { n++; return '<author>Author</author>'; });
        if (e.name === 'word/people.xml') xml = xml.replace(/w15:author="[^"]*"/g, function () { n++; return 'w15:author="Author"'; });
        if (n) changes.push('Replaced ' + n + ' author name' + (n > 1 ? 's' : '') + ' in ' + e.name + ' with "Author"'); return xml; };
      if (rewrite) jobs.push(e.data().then(function (bytes) { item.data = K.bytesOf(rewrite(K.utf8(bytes))); }));
      else item.raw = { bytes: e.raw(), method: e.method, crc: e.crc, usize: e.usize };
      items.push(item);
    });
    return Promise.all(jobs).then(function () { return { bytes: K.writeZip(items), changes: changes }; });
  }

  /* ---------------- dispatch ---------------- */
  function detect(b) {
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'webp';
    if (startsWith(b, 0, '%PDF')) return 'pdf';
    if (b[0] === 0x50 && b[1] === 0x4B) return 'zip';
    if (b.length > 12 && startsWith(b, 4, 'ftyp')) return 'heic';
    return 'unknown';
  }
  function inspect(b) {
    var kind = detect(b);
    try {
      if (kind === 'jpeg') return Promise.resolve(jpegInspect(b));
      if (kind === 'png') return pngInspect(b);
      if (kind === 'webp') return Promise.resolve(webpInspect(b));
      if (kind === 'pdf') return pdfInspect(b);
      if (kind === 'zip') return officeInspect(b);
      if (kind === 'heic') return Promise.resolve({ kind: 'heic', findings: [], notes: ['HEIC and HEIF images are not supported yet. Export the photo as JPEG first, then drop that here.'], info: {}, removable: 0, unsupported: true });
      return Promise.resolve({ kind: 'unknown', findings: [], notes: ['Not a file type this tool understands: JPEG, PNG, WebP, PDF, DOCX, XLSX or PPTX.'], info: {}, removable: 0, unsupported: true });
    } catch (e) { return Promise.resolve({ kind: kind, findings: [], notes: ['Could not read this file: ' + e.message], info: {}, removable: 0, unsupported: true }); }
  }
  function clean(b, report, opts) {
    opts = opts || {};
    try {
      if (report.kind === 'jpeg') return Promise.resolve(jpegClean(b, report, opts));
      if (report.kind === 'png') return Promise.resolve(pngClean(b));
      if (report.kind === 'webp') return Promise.resolve(webpClean(b));
      if (report.kind === 'pdf') return Promise.resolve(pdfClean(b, report));
      if (report.kind === 'docx' || report.kind === 'xlsx' || report.kind === 'pptx') return officeClean(b, report, opts);
      return Promise.reject(new Error('unsupported'));
    } catch (e) { return Promise.reject(e); }
  }
  var api = { detect: detect, inspect: inspect, clean: clean, parseTIFF: parseTIFF, jpegInspect: jpegInspect, jpegClean: jpegClean, pngClean: pngClean, pdfScan: pdfScan, minimalExif: minimalExif };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Scrub = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
