/* Optimatech Labs Toolbox shared shell: the proof panel every tool carries.
   Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function () {
  'use strict';
  var doc = document;
  var PROBE_HOST = 'https://example.com/optimatech-labs-probe';

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  var meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
  var policy = meta ? meta.getAttribute('content') : '';
  var violations = [];
  function noteViolation(e) {
    var v = { directive: e.effectiveDirective || e.violatedDirective || '?', blocked: e.blockedURI || '' };
    var dup = violations.some(function (x) { return x.directive === v.directive && x.blocked === v.blocked; });
    if (!dup) violations.push(v);
    renderProbes();
  }
  doc.addEventListener('securitypolicyviolation', noteViolation);

  var state = { ran: false, running: false, results: [] };

  function hasEvent(directive) {
    return violations.some(function (v) { return v.directive === directive; });
  }

  function runProbes() {
    if (state.running) return Promise.resolve(state.results);
    state.running = true; state.results = []; violations.length = 0;
    var results = state.results;
    function add(name, directive, apiBlocked) { results.push({ name: name, directive: directive, apiBlocked: apiBlocked }); }

    var pFetch = fetch(PROBE_HOST, { mode: 'no-cors', cache: 'no-store' }).then(
      function () { add('fetch()', 'connect-src', false); },
      function () { add('fetch()', 'connect-src', true); });

    try {
      var sent = navigator.sendBeacon(PROBE_HOST, 'probe');
      add('navigator.sendBeacon()', 'connect-src', !sent);
    } catch (e) { add('navigator.sendBeacon()', 'connect-src', true); }

    try {
      var ws = new WebSocket('wss://example.com/optimatech-labs-probe');
      ws.onerror = function () {};
      ws.close();
      add('WebSocket', 'connect-src', false);
    } catch (e) { add('WebSocket', 'connect-src', true); }

    var pImg = new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      function finish(blocked) { if (done) return; done = true; add('Image load', 'img-src', blocked); resolve(); }
      img.onload = function () { finish(false); };
      img.onerror = function () { finish(true); };
      setTimeout(function () { finish(true); }, 2500);
      img.src = PROBE_HOST + '.png';
    });

    // The form probe only runs when the policy on this copy of the page forbids form submission.
    // Without that rule the submit would open a new tab, which is the opposite of helpful.
    var form = null;
    if (/form-action 'none'/.test(policy)) {
      form = el('form');
      form.action = PROBE_HOST; form.method = 'post'; form.target = '_blank'; form.className = 'hidden';
      var input = el('input'); input.name = 'probe'; input.value = '1'; form.appendChild(input);
      // The refusal event is fired on the form itself a moment later, so it stays in the page until the probes finish.
      form.addEventListener('securitypolicyviolation', noteViolation);
      doc.body.appendChild(form);
      try { form.submit(); } catch (e) {}
      add('Form submit', 'form-action', true);
    } else {
      add('Form submit', 'form-action', false);
    }

    return Promise.all([pFetch, pImg]).then(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 800); });
    }).then(function () {
      if (form && form.parentNode) form.parentNode.removeChild(form);
      state.ran = true; state.running = false;
      renderProbes();
      return results;
    });
  }

  function verdict() {
    if (!state.ran) return null;
    var allBlocked = state.results.every(function (r) { return hasEvent(r.directive) || r.apiBlocked; });
    var eventsForAll = state.results.every(function (r) { return hasEvent(r.directive); });
    if (eventsForAll) return { ok: true, text: 'Your browser blocked all ' + state.results.length + ' attempts and reported each one. This page cannot send data out.' };
    if (allBlocked) return { ok: true, text: 'Every attempt was refused. Some refusals came without a policy event, which happens in a few browsers; the policy is still in force.' };
    return { ok: false, text: 'Warning: at least one attempt was not blocked. This copy of the page is not protected by the policy. Do not use it with sensitive files.' };
  }

  var ui = {};
  function renderProbes() {
    if (!ui.list) return;
    ui.list.textContent = '';
    state.results.forEach(function (r) {
      var li = el('li');
      li.appendChild(el('span', null, r.name));
      var ev = hasEvent(r.directive);
      var status = ev ? 'Blocked (' + r.directive + ' policy event)' : (r.apiBlocked ? 'Refused (no policy event)' : 'NOT BLOCKED');
      li.appendChild(el('span', ev || r.apiBlocked ? 'stamp ok' : 'stamp bad', status));
      ui.list.appendChild(li);
    });
    var v = verdict();
    ui.verdict.className = 'verdict ' + (v ? (v.ok ? 'ok' : 'bad') : 'hidden');
    ui.verdict.textContent = v ? v.text : '';
    ui.button.disabled = state.running;
    ui.button.textContent = state.running ? 'Trying to send...' : (state.ran ? 'Try again' : 'Prove it: try to send data out');
    if (ui.selftest) ui.selftest.textContent = JSON.stringify({ ran: state.ran, results: state.results, violations: violations, verdict: v }, null, 1);
  }

  function renderOnline() {
    if (!ui.online) return;
    ui.online.textContent = '';
    var b = el('b', null, navigator.onLine ? 'You are online.' : 'You are offline.');
    ui.online.appendChild(b);
    ui.online.appendChild(doc.createTextNode(navigator.onLine ? ' Nothing is sent either way. Switch off Wi-Fi and keep working to see for yourself.' : ' The tool still works, because there is nothing to call.'));
  }

  function build() {
    var host = doc.getElementById('proof');
    if (!host) return;
    host.className = 'proof';
    host.appendChild(el('h2', null, 'How to check that this page cannot send your files anywhere'));

    var r1 = el('div', 'proof-row');
    r1.appendChild(el('b', null, 'The policy'));
    var c1 = el('div');
    c1.appendChild(el('p', null, 'This page carries a Content Security Policy. Your browser enforces it; our server only delivers it. This is the policy on this copy of the page:'));
    c1.appendChild(el('pre', null, policy || '(no policy found in this copy of the page; it is not protected)'));
    r1.appendChild(c1); host.appendChild(r1);

    var r2 = el('div', 'proof-row');
    r2.appendChild(el('b', null, 'Prove it, live'));
    var c2 = el('div');
    ui.button = el('button', 'btn small'); ui.button.type = 'button';
    ui.button.addEventListener('click', function () { runProbes(); renderProbes(); });
    c2.appendChild(ui.button);
    ui.list = el('ul', 'probes'); c2.appendChild(ui.list);
    ui.verdict = el('div', 'verdict hidden'); c2.appendChild(ui.verdict);
    r2.appendChild(c2); host.appendChild(r2);

    var r3 = el('div', 'proof-row');
    r3.appendChild(el('b', null, 'Pull the plug'));
    ui.online = el('p', 'online'); r3.appendChild(ui.online); host.appendChild(r3);
    window.addEventListener('online', renderOnline); window.addEventListener('offline', renderOnline);

    var r4 = el('div', 'proof-row');
    r4.appendChild(el('b', null, 'Read the code'));
    var c4 = el('div');
    var p4 = el('p', null, 'The source for every tool is public, each release is tagged, and the scripts on this page carry integrity hashes. ');
    var a4 = el('a', null, 'Check it yourself'); a4.href = '../verify/';
    p4.appendChild(a4); p4.appendChild(doc.createTextNode(' lists the full set of checks and their limits.'));
    c4.appendChild(p4); r4.appendChild(c4); host.appendChild(r4);

    if (/(^|[?&])selftest=1/.test(location.search)) {
      ui.selftest = el('pre'); ui.selftest.id = 'selftest-out'; host.appendChild(ui.selftest);
      runProbes();
    }
    renderProbes(); renderOnline();
  }

  window.OptimatechShell = { runProbes: runProbes, policy: policy };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', build); else build();
})();
