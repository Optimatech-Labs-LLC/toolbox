/* Tiny LLM page script. Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  var doc = document, L = window.OptimatechTinyLLM;
  var $ = function (id) { return doc.getElementById(id); };
  var text = $('text'), textStats = $('text-stats'), shapeNote = $('shape-note'), status = $('status'), bar = $('bar'), sample = $('sample'), output = $('output');
  var trainBtn = $('train'), stopBtn = $('stop'), genBtn = $('generate'), copyBtn = $('copy'), downloadBtn = $('download'), loadInput = $('load');
  var chart = $('chart'), ctx = chart.getContext('2d');
  var worker = null, haveModel = false, training = false, history = [], heldHistory = [], info = null, lastProgress = null;

  function el(tag, cls, txt) { var e = doc.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function num(id, lo, hi, fallback) { var v = parseFloat($(id).value); if (!isFinite(v)) v = fallback; return Math.min(hi, Math.max(lo, v)); }
  function fmtSecs(ms) { var s = ms / 1000; return s < 10 ? s.toFixed(1) + ' s' : s < 90 ? Math.round(s) + ' s' : Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s'; }
  function cssVar(name) { return getComputedStyle(doc.documentElement).getPropertyValue(name).trim(); }

  /* Self-test on load: the backward pass must agree with finite differences. */
  (function selfTest() {
    var stamp = $('selftest-stamp'), ok = false;
    try { ok = L.gradientCheck(7).ok; } catch (e) { ok = false; }
    stamp.textContent = ok ? 'Self-test passed' : 'Self-test FAILED';
    stamp.className = ok ? 'stamp ok' : 'stamp bad';
  })();

  /* Settings and the text box */
  function settings() {
    return { context: num('context', 2, 32, 8) | 0, dim: parseInt($('dim').value, 10) || 32, epochs: num('epochs', 1, 20000, 500) | 0, lr: parseFloat($('lr').value) || 0.2,
             batch: 32, clip: $('clip').checked ? 1.0 : 0, seed: num('seed', 0, 999999, 42) | 0, holdout: $('holdout').checked ? 0.1 : 0 };
  }
  function describeText() {
    var t = text.value, chars = Array.from(t), distinct = new Set(chars).size, s = settings(), windows = Math.max(0, chars.length - s.context);
    textStats.textContent = '';
    textStats.appendChild(el('span', null, chars.length.toLocaleString() + ' characters'));
    textStats.appendChild(el('span', null, distinct + ' distinct'));
    textStats.appendChild(el('span', null, windows.toLocaleString() + ' training windows of ' + s.context));
    if (chars.length && chars.length < 120) textStats.appendChild(el('span', 'warn', 'Very short. It will memorize this in seconds and learn almost nothing.'));
    else if (chars.length > 20000) textStats.appendChild(el('span', 'warn', 'Long. Each epoch will take a while; lower the epochs or stop early.'));
    describeShape();
  }
  function describeShape() {
    var s = settings(), V = Math.max(2, new Set(Array.from(text.value)).size), D = s.dim;
    var params = V * D + s.context * D + 4 * D * D + D * 2 * D + 2 * D + 2 * D * D + D + D * V + V;
    shapeNote.textContent = 'This shape has ' + params.toLocaleString() + ' parameters, each a number that starts random and gets nudged on every step. The big models have hundreds of billions. Same idea, more of them.';
    $('st-params').textContent = haveModel && info ? info.parameters.toLocaleString() : params.toLocaleString();
  }
  text.addEventListener('input', describeText);
  ['context', 'dim'].forEach(function (id) { $(id).addEventListener('change', describeText); });
  $('use-sample').addEventListener('click', function () { text.value = L.SAMPLE_TEXT; describeText(); });
  $('clear-text').addEventListener('click', function () { text.value = ''; describeText(); text.focus(); });
  $('temperature').addEventListener('input', function () { $('temp-value').textContent = (+$('temperature').value).toFixed(1); });
  text.value = L.SAMPLE_TEXT;
  describeText();

  /* The worker */
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('worker.js');
    worker.onmessage = function (e) { handle(e.data); };
    worker.onerror = function (e) { training = false; setStatus('The worker failed: ' + (e.message || 'unknown error'), 'bad'); buttons(); };
    return worker;
  }
  function setStatus(msg, cls) { status.textContent = msg; status.className = 'status' + (cls ? ' ' + cls : ''); }
  function buttons() {
    trainBtn.disabled = training; stopBtn.disabled = !training;
    genBtn.disabled = !haveModel; copyBtn.disabled = !haveModel; downloadBtn.disabled = !haveModel || training;
    trainBtn.textContent = haveModel && !training ? 'Train again from scratch' : 'Train';
  }
  function stats(p) {
    $('st-epoch').textContent = p.epoch.toLocaleString() + (info ? ' / ' + info.epochs_requested.toLocaleString() : '');
    $('st-loss').textContent = isFinite(p.loss) ? p.loss.toFixed(3) : 'NaN';
    $('st-held').textContent = p.heldOut === null || p.heldOut === undefined ? '–' : p.heldOut.toFixed(3);
    $('st-time').textContent = fmtSecs(p.elapsed);
    $('st-speed').textContent = p.elapsed > 0 ? (p.epoch / (p.elapsed / 1000)).toFixed(1) : '–';
    bar.style.width = Math.min(100, Math.round(p.epoch / Math.max(1, p.epochs) * 100)) + '%';
  }
  function handle(m) {
    if (m.type === 'started') {
      info = m.info; haveModel = true; history = []; heldHistory = [];
      $('st-params').textContent = info.parameters.toLocaleString();
      $('key-held').classList.toggle('hidden', !info.held_out_windows);
      sample.textContent = m.sample;
      setStatus('Training on ' + info.text_characters.toLocaleString() + ' characters, ' + info.windows.toLocaleString() + ' windows per epoch' + (info.held_out_windows ? ', ' + info.held_out_windows + ' windows held out' : '') + '.');
      buttons(); drawChart();
    } else if (m.type === 'progress') {
      lastProgress = m; m.losses.forEach(function (l) { history.push(l); });
      if (m.heldOut !== null) heldHistory.push([history.length, m.heldOut]);
      stats(m); drawChart();
      if (m.epoch > 2 && m.elapsed > 1500 && m.epoch < m.epochs) { var left = (m.epochs - m.epoch) * (m.elapsed / m.epoch); setStatus('Training... about ' + fmtSecs(left) + ' left. Stop whenever the sample looks good enough.'); }
    } else if (m.type === 'sample') {
      sample.textContent = m.text;
    } else if (m.type === 'done') {
      training = false; m.losses.forEach(function (l) { history.push(l); });
      if (m.heldOut !== null) heldHistory.push([history.length, m.heldOut]);
      stats(m); drawChart(); sample.textContent = m.sample;
      setStatus((m.stopped ? 'Stopped after ' : 'Done. ') + m.epoch.toLocaleString() + ' epochs in ' + fmtSecs(m.elapsed) + ', loss ' + m.loss.toFixed(3) + (m.heldOut !== null ? ', held-out ' + m.heldOut.toFixed(3) : '') + '. Make it write below, or train again with different settings.', 'ok');
      buttons();
      generateNow();
    } else if (m.type === 'blowup') {
      training = false; m.losses.forEach(function (l) { history.push(l); });
      stats({ epoch: m.epoch, epochs: info ? info.epochs_requested : m.epoch, loss: NaN, heldOut: null, elapsed: m.elapsed }); drawChart();
      setStatus('Blew up at epoch ' + m.epoch.toLocaleString() + ': the loss is not a number any more, so the weights are ruined. This is an exploding gradient. Turn clipping on or lower the learning rate and train again.', 'bad');
      haveModel = false; buttons();
    } else if (m.type === 'generated') {
      output.textContent = m.text; genBtn.textContent = 'Generate';
    } else if (m.type === 'weights') {
      var blob = new Blob([m.json], { type: 'application/json' }), url = URL.createObjectURL(blob), a = el('a');
      a.href = url; a.download = 'tiny-llm-' + (info ? info.parameters : 'model') + '-params.json'; doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } else if (m.type === 'imported') {
      haveModel = true; info = m.info.training; history = []; heldHistory = []; drawChart();
      $('st-params').textContent = m.info.parameters.toLocaleString();
      if (info) { $('st-epoch').textContent = (info.epochs_done || 0).toLocaleString(); $('st-loss').textContent = info.final_loss ? info.final_loss.toFixed(3) : '–'; }
      setStatus('Loaded a model with ' + m.info.parameters.toLocaleString() + ' parameters, context ' + m.info.context + ', width ' + m.info.dim + ', ' + m.info.vocabulary + ' characters in its vocabulary.', 'ok');
      sample.textContent = 'Loaded from file.'; buttons(); generateNow();
    } else if (m.type === 'error') {
      training = false; setStatus(m.message, 'bad'); buttons();
    } else if (m.type === 'check') {
      selftestOut(m.result);
    }
  }

  /* Loss chart on a canvas, no library. */
  function drawChart() {
    var dpr = window.devicePixelRatio || 1, w = chart.clientWidth, h = chart.clientHeight;
    if (!w || !h) return;
    if (chart.width !== w * dpr || chart.height !== h * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    var ink = cssVar('--ink') || '#161b20', muted = cssVar('--muted') || '#5b6269', rule = cssVar('--rule') || '#d9d3c7', accent = cssVar('--accent') || '#1f4f8f', bad = cssVar('--bad') || '#9b2c2c';
    var padL = 44, padR = 12, padT = 12, padB = 26, W = w - padL - padR, H = h - padT - padB;
    var n = Math.max(history.length, info ? info.epochs_requested : 1, 1);
    var top = 0; history.forEach(function (v) { if (isFinite(v) && v > top) top = v; }); heldHistory.forEach(function (p) { if (p[1] > top) top = p[1]; });
    if (info && info.vocabulary) top = Math.max(top, Math.log(info.vocabulary)); top = Math.max(top, 1) * 1.05;
    ctx.font = '11px ' + (cssVar('--mono') || 'monospace'); ctx.fillStyle = muted; ctx.strokeStyle = rule; ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var y = padT + H - H * i / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText((top * i / 4).toFixed(1), padL - 6, y + 4);
    }
    ctx.textAlign = 'center'; ctx.fillText('epoch', padL + W / 2, h - 8); ctx.fillText('0', padL, h - 8); ctx.textAlign = 'right'; ctx.fillText(n.toLocaleString(), padL + W, h - 8);
    ctx.save(); ctx.translate(12, padT + H / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('loss', 0, 0); ctx.restore();
    if (info && info.vocabulary) {
      var yv = padT + H - H * Math.log(info.vocabulary) / top;
      ctx.setLineDash([2, 4]); ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(padL, yv); ctx.lineTo(padL + W, yv); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'left'; ctx.fillText('random guessing', padL + 4, yv - 4);
    }
    function px(epoch) { return padL + W * epoch / n; }
    function py(v) { return padT + H - H * Math.min(v, top) / top; }
    if (history.length) {
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath();
      var stride = Math.max(1, Math.floor(history.length / W));
      for (var e = 0; e < history.length; e += stride) { var v = history[e]; if (!isFinite(v)) break; var x = px(e + 1), yy = py(v); if (e === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
      ctx.stroke();
      var last = history[history.length - 1];
      if (isFinite(last)) { ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.fillText(last.toFixed(3), Math.min(px(history.length), padL + W), Math.max(py(last) - 6, padT + 10)); }
    }
    if (heldHistory.length) {
      ctx.strokeStyle = bad; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath();
      heldHistory.forEach(function (p, i) { var x = px(p[0]), yy = py(p[1]); if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); });
      ctx.stroke(); ctx.setLineDash([]);
    }
  }
  window.addEventListener('resize', drawChart);
  if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', drawChart); }

  /* Buttons */
  trainBtn.addEventListener('click', function () {
    var s = settings(), t = text.value;
    if (Array.from(t).length <= s.context + 1) { setStatus('Give it more text than the context window first.', 'bad'); return; }
    training = true; haveModel = false; buttons();
    setStatus('Starting...'); output.textContent = 'Training. Generation unlocks as soon as the first epoch is done.';
    getWorker().postMessage({ cmd: 'train', text: t, context: s.context, dim: s.dim, epochs: s.epochs, lr: s.lr, batch: s.batch, clip: s.clip, seed: s.seed, holdout: s.holdout,
                              sampleSeed: Array.from(t).slice(0, 12).join(''), sampleEvery: s.epochs >= 400 ? 25 : 5 });
  });
  stopBtn.addEventListener('click', function () { if (worker && training) { worker.postMessage({ cmd: 'stop' }); setStatus('Stopping after this epoch...'); } });
  function generateNow() {
    if (!haveModel) return;
    genBtn.textContent = 'Writing...';
    getWorker().postMessage({ cmd: 'generate', seed: $('seed-text').value, length: num('length', 1, 2000, 200) | 0, temperature: +$('temperature').value, rngSeed: Math.floor(Math.random() * 1e9) });
  }
  genBtn.addEventListener('click', generateNow);
  copyBtn.addEventListener('click', function () {
    var t = output.textContent, done = function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done); else done();
  });
  downloadBtn.addEventListener('click', function () { getWorker().postMessage({ cmd: 'export' }); });
  loadInput.addEventListener('change', function () {
    var f = loadInput.files && loadInput.files[0]; loadInput.value = '';
    if (!f) return;
    if (f.size > 64 * 1024 * 1024) { setStatus('That file is too large to be a Tiny LLM weights file.', 'bad'); return; }
    f.text().then(function (json) { getWorker().postMessage({ cmd: 'import', json: json }); }, function () { setStatus('Could not read that file.', 'bad'); });
  });
  buttons(); drawChart();

  /* Automated check: with ?selftest=1 the page runs the gradient check in the worker and a short training
     run on the sample paragraph, then prints the result. */
  var selftest = /(^|[?&])selftest=1/.test(location.search), selfOut = null, selfResult = {};
  function selftestOut(check) {
    selfResult.check = { ok: check.ok, worst: check.worst };
    $('epochs').value = 3; $('dim').value = '16';
    var first = null, unhook = handle;
    handle = function (m) {
      unhook(m);
      if (m.type === 'progress' || m.type === 'done') { if (first === null && m.losses.length) first = m.losses[0]; }
      if (m.type === 'done') { selfResult.train = { first: first, last: m.loss, epochs: m.epoch, improved: m.loss < first }; getWorker().postMessage({ cmd: 'generate', seed: 'It', length: 20, temperature: 1, rngSeed: 1 }); }
      if (m.type === 'generated') { selfResult.generated = m.text; selfResult.ok = selfResult.check.ok && selfResult.train.improved && Array.from(m.text).length === 22; selfOut.textContent = JSON.stringify(selfResult); }
    };
    trainBtn.click();
  }
  if (selftest) {
    selfOut = el('pre'); selfOut.id = 'llm-selftest-out'; selfOut.textContent = 'running'; status.parentNode.insertBefore(selfOut, status);
    getWorker().postMessage({ cmd: 'check' });
  }
})();
