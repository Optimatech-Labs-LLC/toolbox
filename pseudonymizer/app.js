/* Spreadsheet Pseudonymizer tool. Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function () {
  'use strict';
  var doc = document, $ = function (id) { return doc.getElementById(id); };
  var state = { rows: null, delimiter: ',', name: 'data.csv', out: null, key: null };
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function download(name, text, type) { var url = URL.createObjectURL(new Blob([text], { type: type })); var a = el('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }
  function slug(h, i) { var s = (h || 'col' + (i + 1)).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, ''); return s || 'COL' + (i + 1); }

  function load(text, name) {
    var parsed = CSVKit.parse(text); if (!parsed.rows.length) return;
    state.rows = parsed.rows; state.delimiter = parsed.delimiter; state.name = name || 'data.csv'; state.out = null;
    var header = state.rows[0], body = state.rows.slice(1);
    $('summary').textContent = state.name + ': ' + body.length + ' rows, ' + header.length + ' columns, ' + ({ ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[state.delimiter]) + ' separated. Tick the columns that identify people, and mark the ones that could single someone out together.';
    var table = $('preview'); table.textContent = '';
    var thead = el('thead'), tr = el('tr');
    header.forEach(function (h, i) {
      var th = el('th'), lab = el('label'); lab.appendChild(el('span', null, h || '(column ' + (i + 1) + ')'));
      var c1 = el('label'); var i1 = el('input'); i1.type = 'checkbox'; i1.className = 'pick'; i1.dataset.col = i; c1.appendChild(i1); c1.appendChild(doc.createTextNode(' pseudonymize')); lab.appendChild(c1);
      var c2 = el('label'); var i2 = el('input'); i2.type = 'checkbox'; i2.className = 'quasi'; i2.dataset.col = i; c2.appendChild(i2); c2.appendChild(doc.createTextNode(' risk check')); lab.appendChild(c2);
      th.appendChild(lab); tr.appendChild(th);
    });
    thead.appendChild(tr); table.appendChild(thead);
    var tbody = el('tbody'); body.slice(0, 8).forEach(function (r) { var row = el('tr'); header.forEach(function (_, i) { row.appendChild(el('td', null, r[i] === undefined ? '' : r[i])); }); tbody.appendChild(row); }); table.appendChild(tbody);
    $('loaded').classList.remove('hidden'); $('result').classList.add('hidden');
  }

  function normalize(v, fold) { v = v == null ? '' : String(v); return fold ? v.trim().replace(/\s+/g, ' ').toLowerCase() : v; }
  function deriveKey(pass) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('optimatech-labs-pseudonymizer-v1'), iterations: 100000, hash: 'SHA-256' }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    });
  }
  function run() {
    var header = state.rows[0], body = state.rows.slice(1);
    var picks = Array.prototype.map.call(doc.querySelectorAll('input.pick:checked'), function (i) { return +i.dataset.col; });
    var quasi = Array.prototype.map.call(doc.querySelectorAll('input.quasi:checked'), function (i) { return +i.dataset.col; });
    if (!picks.length) { $('result-summary').textContent = 'Tick at least one column to pseudonymize.'; $('result').classList.remove('hidden'); return; }
    var mode = doc.querySelector('input[name=mode]:checked').value, fold = $('fold').checked, len = +$('length').value, pass = $('passphrase').value;
    if (mode === 'hmac' && !pass) { $('result-summary').textContent = 'Enter a passphrase for the keyed hash, or switch to numbered tokens.'; $('result').classList.remove('hidden'); return; }
    var maps = {}, keyRows = [['column', 'token', 'original']];
    var prep = mode === 'hmac' ? deriveKey(pass) : Promise.resolve(null);
    return prep.then(function (key) {
      var enc = new TextEncoder(), chain = Promise.resolve();
      picks.forEach(function (c) {
        maps[c] = {}; var counter = 0, prefix = slug(header[c], c);
        body.forEach(function (r) {
          var raw = r[c] === undefined ? '' : r[c], norm = normalize(raw, fold);
          if (norm === '' || maps[c][norm] !== undefined) return;
          if (mode === 'token') { counter++; var tok = prefix + '-' + ('0000' + counter).slice(-4); maps[c][norm] = tok; keyRows.push([header[c], tok, raw]); }
          else { maps[c][norm] = null; chain = chain.then(function () { return crypto.subtle.sign('HMAC', key, enc.encode(header[c] + '\u0000' + norm)).then(function (sig) { maps[c][norm] = hex(sig).slice(0, len); }); }); }
        });
      });
      return chain;
    }).then(function () {
      var out = [header.slice()];
      body.forEach(function (r) { var row = header.map(function (_, i) { return r[i] === undefined ? '' : r[i]; }); picks.forEach(function (c) { var norm = normalize(row[c], fold); if (norm !== '') row[c] = maps[c][norm]; }); out.push(row); });
      state.out = out; state.key = mode === 'token' ? keyRows : null;
      var replaced = 0; picks.forEach(function (c) { replaced += Object.keys(maps[c]).length; });
      $('result-summary').textContent = 'Replaced ' + replaced + ' distinct value' + (replaced !== 1 ? 's' : '') + ' across ' + picks.length + ' column' + (picks.length > 1 ? 's' : '') + ' in ' + body.length + ' rows using ' + (mode === 'hmac' ? 'a keyed hash' : 'numbered tokens') + '.';
      var risk = $('risk');
      if (quasi.length) {
        var combos = {}; body.forEach(function (r) { var k = quasi.map(function (c) { return normalize(r[c], true); }).join('\u0001'); combos[k] = (combos[k] || 0) + 1; });
        var unique = 0; body.forEach(function (r) { var k = quasi.map(function (c) { return normalize(r[c], true); }).join('\u0001'); if (combos[k] === 1) unique++; });
        var pct = body.length ? Math.round(unique / body.length * 100) : 0;
        risk.className = 'verdict ' + (unique ? 'bad' : 'ok');
        risk.textContent = unique ? unique + ' of ' + body.length + ' rows (' + pct + '%) are unique on ' + quasi.map(function (c) { return header[c]; }).join(' + ') + '. Anyone who knows those facts about a person can find their row. Consider generalizing those columns (year instead of date, area instead of full postcode) or pseudonymizing them too.' : 'No row is unique on ' + quasi.map(function (c) { return header[c]; }).join(' + ') + '. Every combination appears at least twice.';
      } else { risk.className = 'verdict hidden'; risk.textContent = ''; }
      var table = $('result-preview'); table.textContent = '';
      var thead = el('thead'), tr = el('tr'); header.forEach(function (h) { tr.appendChild(el('th', null, h)); }); thead.appendChild(tr); table.appendChild(thead);
      var tbody = el('tbody'); out.slice(1, 9).forEach(function (r) { var row = el('tr'); r.forEach(function (v, i) { row.appendChild(el('td', picks.indexOf(i) >= 0 ? 'changed' : null, v)); }); tbody.appendChild(row); }); table.appendChild(tbody);
      $('download-key').classList.toggle('hidden', mode !== 'token'); $('key-note').hidden = mode !== 'token';
      $('result').classList.remove('hidden');
      return out;
    });
  }

  $('run').addEventListener('click', function () { run(); });
  $('reset').addEventListener('click', function () { state.rows = null; $('loaded').classList.add('hidden'); $('result').classList.add('hidden'); });
  $('show-pass').addEventListener('change', function () { $('passphrase').type = $('show-pass').checked ? 'text' : 'password'; });
  $('download').addEventListener('click', function () { if (state.out) download(state.name.replace(/(\.\w+)?$/, '-pseudonymized.csv'), CSVKit.serialize(state.out, state.delimiter), 'text/csv'); });
  $('download-key').addEventListener('click', function () { if (state.key) download(state.name.replace(/(\.\w+)?$/, '-key.csv'), CSVKit.serialize(state.key, ','), 'text/csv'); });

  var drop = $('drop'), input = $('file');
  function take(file) { if (!file) return; file.text().then(function (t) { load(t, file.name); }); }
  input.addEventListener('change', function () { take(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer) take(e.dataTransfer.files[0]); });
  doc.addEventListener('dragover', function (e) { e.preventDefault(); }); doc.addEventListener('drop', function (e) { e.preventDefault(); });

  /* Automated check: ?selftest=1 loads a sample, runs both modes, and prints the result. */
  if (/(^|[?&])selftest=1/.test(location.search)) {
    var out = el('pre'); out.id = 'ps-selftest-out'; out.textContent = 'running'; $('loaded').parentNode.insertBefore(out, $('loaded'));
    load('name,email,postcode,dob,sex,score\nJane Doe,jane@example.com,02864,1980-05-01,F,7\n"Doe, John",john@example.com,02864,1981-06-02,M,5\njane doe,JANE@example.com,02865,1980-05-01,F,9\n', 'sample.csv');
    doc.querySelectorAll('input.pick')[0].checked = true; doc.querySelectorAll('input.pick')[1].checked = true;
    [2, 3, 4].forEach(function (c) { doc.querySelectorAll('input.quasi')[c].checked = true; });
    $('passphrase').value = 'correct horse'; 
    run().then(function (hmacOut) {
      doc.querySelector('input[name=mode][value=token]').checked = true;
      return run().then(function (tokOut) { out.textContent = JSON.stringify({ hmac: hmacOut, token: tokOut, key: state.key, risk: $('risk').textContent }); });
    }).catch(function (e) { out.textContent = 'FAILED: ' + (e && e.stack || e); });
  }
})();
