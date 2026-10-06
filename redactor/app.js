/* Redactor tool. Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function () {
  'use strict';
  var doc = document, $ = function (id) { return doc.getElementById(id); };
  var state = { text: '', matches: [], result: null, name: 'redacted.txt' };
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function download(name, text, type) { var url = URL.createObjectURL(new Blob([text], { type: type })); var a = el('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }

  var typesBox = $('types');
  Detect.TYPES.forEach(function (t) {
    var lab = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = t.on; cb.dataset.type = t.id; lab.appendChild(cb); lab.appendChild(el('span', null, t.label)); typesBox.appendChild(lab);
  });
  function enabledTypes() { return Array.prototype.filter.call(typesBox.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.dataset.type; }); }

  function scan() {
    state.text = $('input').value;
    var terms = $('terms').value.split(/\r?\n/);
    state.matches = Detect.detect(state.text, { types: enabledTypes(), customTerms: terms });
    render(); $('review-section').classList.remove('hidden'); $('output').classList.add('hidden'); $('download').classList.add('hidden'); $('download-map').classList.add('hidden'); $('map-note').hidden = true;
    return state.matches;
  }
  function render() {
    var pv = $('preview'); pv.textContent = ''; var last = 0;
    state.matches.forEach(function (m, i) {
      if (m.start > last) pv.appendChild(doc.createTextNode(state.text.slice(last, m.start)));
      var s = el('span', 'hit' + (m.off ? ' off' : ''), state.text.slice(m.start, m.end)); s.dataset.type = m.type; s.title = Detect.tokenFor(m.type) + (m.off ? ' (kept)' : ' (will be replaced). Click to keep.');
      s.addEventListener('click', function () { m.off = !m.off; s.classList.toggle('off', !!m.off); s.title = Detect.tokenFor(m.type) + (m.off ? ' (kept)' : ' (will be replaced). Click to keep.'); counts(); });
      pv.appendChild(s); last = m.end;
    });
    pv.appendChild(doc.createTextNode(state.text.slice(last)));
    counts();
  }
  function counts() {
    var box = $('counts'); box.textContent = ''; var c = {};
    state.matches.forEach(function (m) { if (!m.off) c[m.type] = (c[m.type] || 0) + 1; });
    var total = 0; Object.keys(c).forEach(function (k) { total += c[k]; box.appendChild(el('span', 'stamp', Detect.tokenFor(k) + ' ' + c[k])); });
    if (!total) box.appendChild(el('span', 'stamp muted', state.matches.length ? 'Everything kept' : 'Nothing found'));
  }
  function apply() {
    var mode = doc.querySelector('input[name=mode]:checked').value;
    state.result = Detect.apply(state.text, state.matches, mode);
    var out = $('output'); out.value = state.result.text; out.classList.remove('hidden');
    $('download').classList.remove('hidden'); $('download-map').classList.toggle('hidden', mode !== 'pseudonym'); $('map-note').hidden = mode !== 'pseudonym';
    return state.result;
  }
  $('scan').addEventListener('click', scan);
  $('apply').addEventListener('click', apply);
  $('download').addEventListener('click', function () { if (state.result) download(state.name, state.result.text, 'text/plain'); });
  $('download-map').addEventListener('click', function () { if (state.result) download(state.name.replace(/\.txt$/, '') + '-mapping.csv', 'type,token,original\r\n' + state.result.mapping.map(function (m) { return [m.type, m.token, m.original].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n') + '\r\n', 'text/csv'); });

  function docxText(bytes) {
    var zip = ZipKit.readZip(bytes), e = zip.entries.filter(function (x) { return x.name === 'word/document.xml'; })[0];
    if (!e) return Promise.reject(new Error('no word/document.xml inside'));
    return e.data().then(function (b) {
      var xml = ZipKit.utf8(b);
      return xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>|<w:cr\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    });
  }
  function take(file) {
    if (!file) return;
    state.name = file.name.replace(/\.\w+$/, '') + '-redacted.txt';
    var p = /\.docx$/i.test(file.name) ? file.arrayBuffer().then(function (ab) { return docxText(new Uint8Array(ab)); }) : file.text();
    p.then(function (t) { $('input').value = t; $('file-note').textContent = file.name + ' loaded' + (/\.docx$/i.test(file.name) ? ' as plain text' : ''); scan(); }, function (err) { $('file-note').textContent = 'Could not read ' + file.name + ': ' + err.message; });
  }
  $('file').addEventListener('change', function () { take($('file').files[0]); $('file').value = ''; });
  doc.addEventListener('dragover', function (e) { e.preventDefault(); });
  doc.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer) take(e.dataTransfer.files[0]); });

  /* Automated check: ?selftest=1 scans a sample and prints the matches. */
  if (/(^|[?&])selftest=1/.test(location.search)) {
    var out = el('pre'); out.id = 'red-selftest-out'; $('review-section').parentNode.insertBefore(out, $('review-section'));
    $('input').value = 'Dr. Jane Doe (jane.doe@example.com, +1 401-555-0199) paid with card 4111 1111 1111 1111 on 05/10/2026. IBAN GB82 WEST 1234 5698 7654 32, routing 011000015, SSN 219-09-9999, from 192.168.1.7. Client: Robert Smith of Acme Holdings LLC. Token ghp_abcdefghijklmnopqrstuvwxyz0123456789. Random 123456789012 and 999999999 should not match.';
    $('terms').value = 'CASE-2026-0417';
    var ms = scan(); var res = Detect.apply(state.text, ms, 'pseudonym');
    out.textContent = JSON.stringify({ matches: ms.map(function (m) { return m.type + ':' + m.text; }), pseudonymized: res.text });
  }
})();
