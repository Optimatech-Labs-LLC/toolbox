/* Metadata Scrubber tool. Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function () {
  'use strict';
  var doc = document, $ = function (id) { return doc.getElementById(id); };
  var list = $('file-list'), actions = $('actions'), entries = [];
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function fmtBytes(n) { if (n < 1024) return n + ' B'; var u = ['KB', 'MB', 'GB'], i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1); return n.toFixed(n < 10 ? 2 : 1) + ' ' + u[i]; }
  function opts() { return { keepICC: $('opt-icc').checked, dropTrailer: $('opt-trailer').checked, anonymizeAuthors: $('opt-authors').checked, clearDates: $('opt-dates').checked }; }
  function cleanName(name, kind) { var i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) + '-clean' + name.slice(i) : name + '-clean'; }
  function download(name, bytes, type) { var url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' })); var a = el('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }
  var LABEL = { jpeg: 'JPEG image', png: 'PNG image', webp: 'WebP image', pdf: 'PDF', docx: 'Word document', xlsx: 'Excel workbook', pptx: 'PowerPoint deck', zip: 'ZIP archive', heic: 'HEIC image', unknown: 'Unknown type' };

  function process(file) {
    var entry = { file: file, node: el('li', 'file'), report: null, result: null };
    entries.push(entry); list.appendChild(entry.node);
    var head = el('div', 'file-head'); head.appendChild(el('span', 'file-name', file.name)); entry.meta = el('span', 'file-meta', fmtBytes(file.size) + ' · reading'); head.appendChild(entry.meta); entry.node.appendChild(head);
    entry.body = el('div'); entry.node.appendChild(entry.body);
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf); entry.bytes = bytes;
      return Scrub.inspect(bytes).then(function (report) {
        entry.report = report; entry.meta.textContent = fmtBytes(file.size) + ' · ' + (LABEL[report.kind] || report.kind);
        if (report.unsupported) { renderReport(entry); return; }
        return Scrub.clean(bytes, report, opts()).then(function (res) { entry.result = res; renderReport(entry); }, function (err) { report.notes.push('Could not produce a clean copy: ' + err.message); renderReport(entry); });
      });
    }, function (err) { entry.meta.textContent = 'Could not read this file: ' + err.message; });
    actions.classList.remove('hidden');
  }

  function renderReport(entry) {
    var r = entry.report, body = entry.body; body.textContent = '';
    var stamps = el('div', 'stamps');
    var risky = r.findings.some(function (f) { return f.risky; });
    if (risky) stamps.appendChild(el('span', 'stamp bad', 'Location data found'));
    var removable = r.findings.filter(function (f) { return f.section !== 'Kept'; }).length;
    stamps.appendChild(el('span', removable ? 'stamp' : 'stamp ok', removable ? removable + ' metadata item' + (removable > 1 ? 's' : '') + ' found' : 'No removable metadata found'));
    body.appendChild(stamps);
    if (r.findings.length) {
      var dl = el('dl', 'hashes'); var lastSection = null;
      r.findings.forEach(function (f) {
        var row = el('div', 'hash'); row.appendChild(el('dt', null, f.section === lastSection ? '' : f.section)); lastSection = f.section;
        var dd = el('dd', f.risky ? 'mismatch' : null, f.name + ': ' + f.value); row.appendChild(dd); row.appendChild(el('span')); dl.appendChild(row);
      });
      body.appendChild(dl);
    }
    r.notes.forEach(function (n) { body.appendChild(el('p', 'note', n)); });
    if (entry.result) {
      var changes = el('ul', 'probes'); entry.result.changes.forEach(function (c) { var li = el('li'); li.appendChild(el('span', null, c)); changes.appendChild(li); });
      if (!entry.result.changes.length) { var li0 = el('li'); li0.appendChild(el('span', null, 'Nothing needed removing. The clean copy is identical in content.')); changes.appendChild(li0); }
      body.appendChild(el('p', 'note', 'Clean copy: ' + fmtBytes(entry.result.bytes.length) + (entry.bytes.length !== entry.result.bytes.length ? ' (' + fmtBytes(entry.bytes.length - entry.result.bytes.length) + ' smaller)' : ', same size')));
      body.appendChild(changes);
      var foot = el('div', 'file-foot'); var btn = el('button', 'btn small', 'Download clean copy'); btn.type = 'button';
      btn.addEventListener('click', function () { download(cleanName(entry.file.name), entry.result.bytes, entry.file.type); }); foot.appendChild(btn);
      var again = el('button', 'btn ghost small', 'Re-check the clean copy'); again.type = 'button';
      again.addEventListener('click', function () { var f = new File([entry.result.bytes], cleanName(entry.file.name), { type: entry.file.type }); process(f); }); foot.appendChild(again);
      body.appendChild(foot);
    }
  }

  $('download-all').addEventListener('click', function () {
    var items = entries.filter(function (e) { return e.result; }).map(function (e) { return { name: cleanName(e.file.name), data: e.result.bytes }; });
    if (!items.length) return;
    download('clean-copies.zip', ZipKit.writeZip(items), 'application/zip');
  });
  $('clear').addEventListener('click', function () { entries = []; list.textContent = ''; actions.classList.add('hidden'); });

  var drop = $('drop'), input = $('files');
  input.addEventListener('change', function () { Array.prototype.forEach.call(input.files, process); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer) Array.prototype.forEach.call(e.dataTransfer.files, process); });
  doc.addEventListener('dragover', function (e) { e.preventDefault(); }); doc.addEventListener('drop', function (e) { e.preventDefault(); });

  /* Automated check: ?selftest=1 builds small files with known metadata, cleans them, and prints the outcome. */
  if (/(^|[?&])selftest=1/.test(location.search)) {
    var out = el('pre'); out.id = 'scrub-selftest-out'; out.textContent = 'running'; list.parentNode.insertBefore(out, list);
    var K = ZipKit, results = {};
    function be32(v) { return [v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255]; }
    function pngChunk(type, data) { var t = K.bytesOf(type); var td = new Uint8Array(t.length + data.length); td.set(t); td.set(data, t.length); return [].concat(be32(data.length), Array.from(td), be32(K.crc32(td))); }
    var ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
    var raw = new Uint8Array([0, 0x80]); var idat = new Uint8Array([0x78, 0x01, 0x01, 2, 0, 0xFD, 0xFF, 0, 0x80].concat(be32(K.adler32(raw))));
    var png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].concat(pngChunk('IHDR', ihdr), pngChunk('tEXt', K.bytesOf('Author\0Jane Doe')), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))));
    var exifTiff = [0x4D, 0x4D, 0, 0x2A, 0, 0, 0, 8, 0, 2, 0x01, 0x0F, 0, 2, 0, 0, 0, 6, 0, 0, 0, 38, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0x41, 0x70, 0x70, 0x6C, 0x65, 0];
    var app1 = [0xFF, 0xE1, 0, 2 + 6 + exifTiff.length, 0x45, 0x78, 0x69, 0x66, 0, 0].concat(exifTiff);
    var jpeg = new Uint8Array([0xFF, 0xD8].concat(app1, [0xFF, 0xFE, 0, 7, 0x68, 0x65, 0x6C, 0x6C, 0x6F], [0xFF, 0xDB, 0, 3, 0], [0xFF, 0xDA, 0, 2, 0x12, 0x34, 0x56], [0xFF, 0xD9], [0x54, 0x52, 0x41, 0x49, 0x4C]));
    var pdf = K.bytesOf('%PDF-1.4\n1 0 obj << /Title (Secret Report) /Author (Jane Doe) >> endobj\n2 0 obj << /Type /Metadata /Length 60 >>\nstream\n<x:xmpmeta><dc:creator><rdf:li>Jane</rdf:li></dc:creator></x>\nendstream\nendobj\ntrailer << /Info 1 0 R >>\n%%EOF');
    var core = '<?xml version="1.0"?><cp:coreProperties><dc:creator>Jane Doe</dc:creator><cp:lastModifiedBy>J. Doe</cp:lastModifiedBy><dcterms:created>2026-01-01T00:00:00Z</dcterms:created></cp:coreProperties>';
    var docxPromise = K.deflateRaw(K.bytesOf(core)).then(function (comp) {
      return K.writeZip([{ name: '[Content_Types].xml', data: K.bytesOf('<Types><Override PartName="/docProps/custom.xml" ContentType="x"/></Types>') }, { name: '_rels/.rels', data: K.bytesOf('<Relationships></Relationships>') }, { name: 'docProps/core.xml', raw: { bytes: comp, method: 8, crc: K.crc32(K.bytesOf(core)), usize: core.length } }, { name: 'docProps/custom.xml', data: K.bytesOf('<Properties><property name="Client"><vt:lpwstr>Acme</vt:lpwstr></property></Properties>') }, { name: 'word/document.xml', data: K.bytesOf('<w:document><w:ins w:author="Jane Doe" w:initials="JD"/></w:document>') }]);
    });
    var jobs = [['png', Promise.resolve(png)], ['jpeg', Promise.resolve(jpeg)], ['pdf', Promise.resolve(pdf)], ['docx', docxPromise]].map(function (pair) {
      return pair[1].then(function (bytes) { return Scrub.inspect(bytes).then(function (rep) { return Scrub.clean(bytes, rep, { keepICC: true, dropTrailer: true, anonymizeAuthors: true }).then(function (res) {
        return Scrub.inspect(res.bytes).then(function (after) { results[pair[0]] = { before: rep.findings.map(function (f) { return f.name + '=' + f.value; }), changes: res.changes, after: after.findings.map(function (f) { return f.name + '=' + f.value; }), size: [bytes.length, res.bytes.length] }; }); }); }); });
    });
    Promise.all(jobs).then(function () { out.textContent = JSON.stringify(results, null, 1); }, function (err) { out.textContent = 'FAILED: ' + (err && err.stack || err); });
  }
})();
