/* Evidence Hash tool. Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var list = $('file-list'), actions = $('actions'), expectedInput = $('expected');
  var entries = [], worker = null, queue = [], busy = false, nextId = 1;

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function fmtBytes(n) { if (n < 1024) return n + ' B'; var u = ['KB', 'MB', 'GB', 'TB'], i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1); return n.toFixed(n < 10 ? 2 : 1) + ' ' + u[i]; }
  function localStamp(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; var off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-'; off = Math.abs(off);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' UTC' + sign + p(Math.floor(off / 60)) + ':' + p(off % 60); }
  function algos() { var a = []; if ($('algo-sha256').checked) a.push('sha256'); if ($('algo-sha1').checked) a.push('sha1'); if ($('algo-md5').checked) a.push('md5'); return a.length ? a : ['sha256']; }
  function normalizeHash(s) { return (s || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase(); }

  /* Self-test on load: the hashers must reproduce the published known answers. */
  (function selfTest() {
    var stamp = $('selftest-stamp'), ok = true;
    try {
      Object.keys(OptimatechHashes.vectors).forEach(function (algo) {
        Object.keys(OptimatechHashes.vectors[algo]).forEach(function (input) {
          var bytes = new TextEncoder().encode(input);
          if (OptimatechHashes.create(algo).update(bytes).digest() !== OptimatechHashes.vectors[algo][input]) ok = false;
        });
      });
    } catch (e) { ok = false; }
    stamp.textContent = ok ? 'Self-test passed' : 'Self-test FAILED';
    stamp.className = ok ? 'stamp ok' : 'stamp bad';
  })();

  function getWorker() {
    if (worker) return worker;
    worker = new Worker('worker.js');
    worker.onmessage = function (e) {
      var m = e.data, entry = entries.filter(function (x) { return x.id === m.id; })[0];
      if (!entry) return;
      if (m.error) { entry.error = m.error; entry.done = true; render(entry); busy = false; pump(); return; }
      if (!m.done) { entry.loaded = m.loaded; renderProgress(entry); return; }
      entry.hashes = m.hashes; entry.done = true; entry.finished = new Date();
      render(entry); crossCheck(entry); busy = false; pump();
    };
    worker.onerror = function (e) { busy = false; var entry = entries.filter(function (x) { return !x.done; })[0]; if (entry) { entry.error = e.message || 'worker error'; entry.done = true; render(entry); } pump(); };
    return worker;
  }
  function pump() {
    if (busy || !queue.length) return;
    var entry = queue.shift(); busy = true; entry.started = new Date();
    getWorker().postMessage({ id: entry.id, file: entry.file, algos: entry.algos });
  }

  /* Independent check: the browser's own SHA-256 must agree with ours on files it can hold in memory. */
  function crossCheck(entry) {
    if (!entry.hashes.sha256 || !(window.crypto && crypto.subtle) || entry.file.size > 64 * 1024 * 1024) { entry.cross = 'not run'; render(entry); return; }
    entry.file.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (d) {
      var hex = Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      entry.cross = hex === entry.hashes.sha256 ? 'matched' : 'MISMATCH';
      render(entry);
    }, function () { entry.cross = 'not run'; render(entry); });
  }

  function addFiles(files) {
    var a = algos();
    Array.prototype.forEach.call(files, function (file) {
      var entry = { id: nextId++, file: file, algos: a, loaded: 0, done: false, hashes: null, cross: null, error: null, node: null };
      entries.push(entry); render(entry); queue.push(entry);
    });
    actions.classList.remove('hidden'); pump();
  }

  function renderProgress(entry) {
    if (!entry.bar) return;
    var pct = entry.file.size ? Math.min(100, Math.round(entry.loaded / entry.file.size * 100)) : 100;
    entry.bar.style.width = pct + '%';
    entry.status.textContent = 'Hashing ' + pct + '%';
  }

  function render(entry) {
    if (!entry.node) {
      entry.node = el('li', 'file');
      var head = el('div', 'file-head');
      head.appendChild(el('span', 'file-name', entry.file.name));
      head.appendChild(el('span', 'file-meta', fmtBytes(entry.file.size) + (entry.file.type ? ' · ' + entry.file.type : '') + ' · modified ' + localStamp(new Date(entry.file.lastModified))));
      entry.node.appendChild(head);
      var prog = el('div', 'progress'); entry.bar = el('i'); prog.appendChild(entry.bar); entry.node.appendChild(prog);
      entry.hashList = el('dl', 'hashes'); entry.node.appendChild(entry.hashList);
      var foot = el('div', 'file-foot'); entry.status = el('span', null, 'Queued'); foot.appendChild(entry.status); entry.cross_el = el('span'); foot.appendChild(entry.cross_el); entry.node.appendChild(foot);
      list.appendChild(entry.node);
    }
    if (entry.error) { entry.status.textContent = 'Could not read this file: ' + entry.error; entry.bar.style.width = '0%'; return; }
    if (!entry.done) { renderProgress(entry); return; }
    entry.bar.style.width = '100%';
    entry.status.textContent = 'Done in ' + ((entry.finished - entry.started) / 1000).toFixed(1) + ' s';
    entry.hashList.textContent = '';
    var expected = normalizeHash(expectedInput.value);
    entry.algos.forEach(function (a) {
      var row = el('div', 'hash');
      row.appendChild(el('dt', null, a === 'sha256' ? 'SHA-256' : a === 'sha1' ? 'SHA-1' : 'MD5'));
      var dd = el('dd', null, entry.hashes[a]);
      if (expected && expected.length === entry.hashes[a].length) dd.className = expected === entry.hashes[a] ? 'match' : 'mismatch';
      row.appendChild(dd);
      var copy = el('button', 'btn ghost small', 'Copy'); copy.type = 'button';
      copy.addEventListener('click', function () { copyText(entry.hashes[a], copy); });
      row.appendChild(copy);
      entry.hashList.appendChild(row);
    });
    if (expected) {
      var any = entry.algos.some(function (a) { return entry.hashes[a] === expected; });
      var same = entry.algos.some(function (a) { return entry.hashes[a].length === expected.length; });
      entry.cross_el.textContent = any ? 'Matches the expected hash.' : (same ? 'Does NOT match the expected hash.' : 'Expected hash length matches none of the chosen algorithms.');
      entry.cross_el.className = any ? 'stamp ok' : (same ? 'stamp bad' : 'stamp muted');
    } else if (entry.cross === 'matched') { entry.cross_el.textContent = 'Cross-checked with your browser\'s built-in SHA-256'; entry.cross_el.className = 'stamp ok'; }
    else if (entry.cross === 'MISMATCH') { entry.cross_el.textContent = 'Cross-check MISMATCH, do not trust this result'; entry.cross_el.className = 'stamp bad'; }
    else { entry.cross_el.textContent = ''; entry.cross_el.className = ''; }
  }

  function copyText(text, button) {
    var done = function () { var old = button.textContent; button.textContent = 'Copied'; setTimeout(function () { button.textContent = old; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) { var ta = el('textarea'); ta.value = text; ta.className = 'hidden'; doc.body.appendChild(ta); ta.className = ''; ta.select(); try { doc.execCommand('copy'); } catch (e) {} doc.body.removeChild(ta); }

  function receipt() {
    var now = new Date();
    return {
      tool: 'Optimatech Labs Evidence Hash', version: VERSION, source: 'https://optimatechlabs.com/tools/evidence-hash/',
      generated: localStamp(now), clock_note: 'Time comes from the clock of the computer that ran the tool, not from a trusted time source.',
      processing_note: 'Files were hashed inside the web browser on that computer. No file content was transmitted anywhere.',
      files: entries.filter(function (e) { return e.done && !e.error; }).map(function (e) {
        return { name: e.file.name, size_bytes: e.file.size, type: e.file.type || '', last_modified: localStamp(new Date(e.file.lastModified)), hashes: e.hashes,
                 cross_check: e.cross === 'matched' ? 'browser built-in SHA-256 agreed' : 'not run' };
      })
    };
  }
  function receiptText(r) {
    var lines = ['OPTIMATECH LABS EVIDENCE HASH RECEIPT', 'Tool version ' + r.version + ', ' + r.source, 'Generated ' + r.generated + ' (' + r.clock_note + ')', r.processing_note, ''];
    r.files.forEach(function (f, i) {
      lines.push((i + 1) + '. ' + f.name); lines.push('   Size: ' + f.size_bytes + ' bytes' + (f.type ? ' (' + f.type + ')' : '')); lines.push('   Last modified: ' + f.last_modified);
      Object.keys(f.hashes).forEach(function (a) { lines.push('   ' + (a === 'sha256' ? 'SHA-256' : a === 'sha1' ? 'SHA-1  ' : 'MD5    ') + ': ' + f.hashes[a]); });
      lines.push('   Cross-check: ' + f.cross_check); lines.push('');
    });
    lines.push('To verify: shasum -a 256 FILE (macOS/Linux), certutil -hashfile FILE SHA256 (Windows).');
    return lines.join('\n');
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type }); var url = URL.createObjectURL(blob);
    var a = el('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }

  $('receipt-text').addEventListener('click', function () { download('evidence-hash-receipt-' + stamp() + '.txt', receiptText(receipt()), 'text/plain'); });
  $('receipt-json').addEventListener('click', function () { download('evidence-hash-receipt-' + stamp() + '.json', JSON.stringify(receipt(), null, 2), 'application/json'); });
  $('clear').addEventListener('click', function () { entries = []; queue = []; list.textContent = ''; actions.classList.add('hidden'); });
  expectedInput.addEventListener('input', function () { entries.forEach(function (e) { if (e.done && !e.error) render(e); }); });

  var drop = $('drop'), input = $('files');
  input.addEventListener('change', function () { if (input.files.length) addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  doc.addEventListener('dragover', function (e) { e.preventDefault(); }); doc.addEventListener('drop', function (e) { e.preventDefault(); });

  /* Automated check: with ?selftest=1 the page hashes a known file through the worker and prints the result. */
  if (/(^|[?&])selftest=1/.test(location.search)) {
    var out = el('pre'); out.id = 'hash-selftest-out'; out.textContent = 'running'; list.parentNode.insertBefore(out, list);
    $('algo-sha1').checked = true; $('algo-md5').checked = true;
    var probe = new File([new Blob(['abc'])], 'abc.txt', { type: 'text/plain' });
    addFiles([probe]);
    var timer = setInterval(function () {
      var e = entries[0];
      if (e && e.done) { clearInterval(timer); out.textContent = JSON.stringify({ hashes: e.hashes, error: e.error, cross: e.cross }); }
    }, 100);
  }
})();
