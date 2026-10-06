/* CSV and TSV parsing and writing (RFC 4180 quoting, delimiter sniffing).
   Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function (root) {
  'use strict';
  function sniff(text) {
    var head = text.slice(0, 20000).split(/\r?\n/).slice(0, 10), best = ',', bestScore = -1;
    [',', ';', '\t', '|'].forEach(function (d) {
      var counts = head.filter(function (l) { return l.length; }).map(function (l) { return l.split(d).length - 1; });
      if (!counts.length) return;
      var min = Math.min.apply(null, counts), max = Math.max.apply(null, counts), score = min > 0 && min === max ? min * 10 : min;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }
  function parse(text, delimiter) {
    delimiter = delimiter || sniff(text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', i = 0, n = text.length, inQuotes = false;
    while (i < n) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQuotes = true; i++; continue; }
      if (c === delimiter) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return { rows: rows, delimiter: delimiter };
  }
  function quote(v, d) { v = v == null ? '' : String(v); return /["\r\n]/.test(v) || v.indexOf(d) >= 0 || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function serialize(rows, d) { return rows.map(function (r) { return r.map(function (v) { return quote(v, d); }).join(d); }).join('\r\n') + '\r\n'; }
  var api = { sniff: sniff, parse: parse, serialize: serialize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CSVKit = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
