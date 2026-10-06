/* Personal-data detection with checksummed patterns and plain heuristics. No model, no network.
   Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function (root) {
  'use strict';
  function luhn(digits) { var sum = 0, alt = false; for (var i = digits.length - 1; i >= 0; i--) { var d = digits.charCodeAt(i) - 48; if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; } return sum % 10 === 0; }
  function ibanOk(s) {
    s = s.replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    var r = s.slice(4) + s.slice(0, 4), mod = 0;
    for (var i = 0; i < r.length; i++) { var c = r.charCodeAt(i), piece = c >= 65 ? String(c - 55) : r[i]; for (var j = 0; j < piece.length; j++) mod = (mod * 10 + (piece.charCodeAt(j) - 48)) % 97; }
    return mod === 1;
  }
  function abaOk(d) { if (!/^\d{9}$/.test(d)) return false; var n = d.split('').map(Number); var s = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]); if (s % 10 !== 0) return false; var p = +d.slice(0, 2); return (p <= 12) || (p >= 21 && p <= 32) || (p >= 61 && p <= 72) || p === 80; }
  var MONTHS = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
  var STOP_PAIRS = /^(United States|United Kingdom|New York|New Jersey|New Hampshire|New Mexico|North Carolina|South Carolina|North Dakota|South Dakota|West Virginia|Rhode Island|Supreme Court|District Court|High Court|Crown Court|Court of Appeal|Federal Court|European Union|Hong Kong|Los Angeles|San Francisco|Las Vegas|Social Security|Internal Revenue|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;

  /* Priority order: earlier types claim their characters first. */
  var TYPES = [
    { id: 'custom', label: 'Your own terms (names, case numbers, anything)', on: true, token: 'TERM' },
    { id: 'card', label: 'Payment card numbers (checksum verified)', on: true, token: 'CARD', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: function (m) { var d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); } },
    { id: 'iban', label: 'IBANs (checksum verified)', on: true, token: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, check: ibanOk },
    { id: 'ssn', label: 'US Social Security numbers', on: true, token: 'SSN', re: /\b(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g },
    { id: 'routing', label: 'US bank routing numbers (checksum verified)', on: true, token: 'ROUTING', re: /\b\d{9}\b/g, check: abaOk },
    { id: 'email', label: 'Email addresses', on: true, token: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    { id: 'phone', label: 'Phone numbers', on: true, token: 'PHONE', re: /(?<![\d-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{3,4}(?![\d-])/g, check: function (m) { var d = m.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15; } },
    { id: 'ipv4', label: 'IP addresses', on: true, token: 'IP', re: /\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g },
    { id: 'ipv6', label: 'IPv6 addresses', on: true, token: 'IP', re: /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g },
    { id: 'secret', label: 'API keys and tokens', on: true, token: 'KEY', re: /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g },
    { id: 'date', label: 'Dates', on: true, token: 'DATE', re: new RegExp('\\b(?:\\d{1,2}[\\/.-]\\d{1,2}[\\/.-](?:\\d{4}|\\d{2})|\\d{4}-\\d{2}-\\d{2}|' + MONTHS + ' \\d{1,2},? \\d{4}|\\d{1,2}(?:st|nd|rd|th)? ' + MONTHS + ',? \\d{4})\\b', 'g') },
    { id: 'url', label: 'Web addresses', on: false, token: 'URL', re: /\bhttps?:\/\/[^\s<>"')\]]+/g },
    { id: 'uspostal', label: 'US ZIP codes', on: false, token: 'ZIP', re: /\b\d{5}(?:-\d{4})?\b/g },
    { id: 'ukpostal', label: 'UK postcodes', on: false, token: 'POSTCODE', re: /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g },
    { id: 'org', label: 'Organizations (by suffix: Inc, Ltd, LLC, GmbH...)', on: true, token: 'ORG', re: /\b(?:[A-Z][A-Za-z&'.-]*\s){0,4}[A-Z][A-Za-z&'.-]*,?\s(?:Inc|Incorporated|LLC|L\.L\.C|Ltd|Limited|Corp|Corporation|GmbH|PLC|LLP|LP|Co|Company|Holdings|Group|Partners|Bank|Trust)(?!\w)/g },
    { id: 'name', label: 'Names after a title or label (Mr, Dr, Name:, Client:...)', on: true, token: 'NAME', re: /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Dame|Judge|Justice|Hon|Officer|Det|Detective|Sgt|Lt|Capt|Rev|Atty|Attorney|Name|Client|Defendant|Plaintiff|Witness|Applicant|Customer|Patient|Employee|Tenant|Landlord|Claimant|Respondent|Suspect|Victim|Complainant)\.?:?\s+((?:[A-Z][a-z'’-]+|[A-Z]\.)(?:\s(?:[A-Z][a-z'’-]+|[A-Z]\.)){0,3})/g, group: 1 },
    { id: 'capnames', label: 'Capitalized word pairs (aggressive, catches places and titles too)', on: false, token: 'NAME', re: /\b[A-Z][a-z'’-]+\s[A-Z][a-z'’-]+(?:\s[A-Z][a-z'’-]+)?\b/g, check: function (m) { return !STOP_PAIRS.test(m); } }
  ];

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function detect(text, options) {
    options = options || {};
    var enabled = options.types || TYPES.filter(function (t) { return t.on; }).map(function (t) { return t.id; });
    var taken = new Uint8Array(text.length), matches = [];
    function claim(start, end, type, value) { for (var i = start; i < end; i++) if (taken[i]) return false; for (var j = start; j < end; j++) taken[j] = 1; matches.push({ start: start, end: end, type: type, text: value }); return true; }
    TYPES.forEach(function (t) {
      if (enabled.indexOf(t.id) < 0) return;
      if (t.id === 'custom') {
        (options.customTerms || []).map(function (s) { return s.trim(); }).filter(Boolean).sort(function (a, b) { return b.length - a.length; }).forEach(function (term) {
          var re = new RegExp((/^\w/.test(term) ? '\\b' : '') + escapeRe(term) + (/\w$/.test(term) ? '\\b' : ''), 'gi'), m;
          while ((m = re.exec(text))) { claim(m.index, m.index + m[0].length, 'custom', m[0]); if (!m[0].length) re.lastIndex++; }
        });
        return;
      }
      var re = new RegExp(t.re.source, t.re.flags), m;
      while ((m = re.exec(text))) {
        if (!m[0].length) { re.lastIndex++; continue; }
        var value = t.group ? m[t.group] : m[0], start = t.group ? m.index + m[0].length - m[t.group].length : m.index;
        if (t.check && !t.check(value)) continue;
        claim(start, start + value.length, t.id, value);
      }
    });
    matches.sort(function (a, b) { return a.start - b.start; });
    return matches;
  }
  function tokenFor(type) { var t = TYPES.filter(function (x) { return x.id === type; })[0]; return t ? t.token : type.toUpperCase(); }
  function normalize(type, s) { return (/card|iban|ssn|routing|phone|ip/.test(type) ? s.replace(/[\s.()-]/g, '') : s.replace(/\s+/g, ' ').trim()).toLowerCase(); }
  /* mode: 'label' -> [EMAIL], 'block' -> ██████, 'pseudonym' -> EMAIL-1 (consistent per value). */
  function apply(text, matches, mode) {
    var out = '', last = 0, counters = {}, seen = {}, mapping = [];
    matches.forEach(function (m) {
      if (m.off) return;
      var rep;
      if (mode === 'block') rep = '██████';
      else if (mode === 'label') rep = '[' + tokenFor(m.type) + ']';
      else { var key = m.type + '\u0000' + normalize(m.type, m.text); if (!seen[key]) { counters[m.type] = (counters[m.type] || 0) + 1; seen[key] = tokenFor(m.type) + '-' + counters[m.type]; mapping.push({ type: m.type, token: seen[key], original: m.text }); } rep = seen[key]; }
      out += text.slice(last, m.start) + rep; last = m.end;
    });
    out += text.slice(last);
    return { text: out, mapping: mapping };
  }
  var api = { TYPES: TYPES, detect: detect, apply: apply, luhn: luhn, ibanOk: ibanOk, abaOk: abaOk, tokenFor: tokenFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Detect = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
