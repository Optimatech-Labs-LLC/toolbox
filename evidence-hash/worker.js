/* Hashing worker: reads a File in slices and feeds the streaming hashers, so the page stays
   responsive and memory stays flat. Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
'use strict';
importScripts('hashes.js');
var CHUNK = 8 * 1024 * 1024;

self.onmessage = function (e) {
  var job = e.data, file = job.file, algos = job.algos, id = job.id;
  var hashers = {};
  algos.forEach(function (a) { hashers[a] = OptimatechHashes.create(a); });
  var offset = 0, total = file.size, lastReport = 0;
  function step() {
    if (offset >= total) {
      var out = {};
      algos.forEach(function (a) { out[a] = hashers[a].digest(); });
      self.postMessage({ id: id, done: true, hashes: out });
      return;
    }
    var slice = file.slice(offset, Math.min(offset + CHUNK, total));
    slice.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      algos.forEach(function (a) { hashers[a].update(bytes); });
      offset += bytes.length;
      var now = Date.now();
      if (now - lastReport > 80 || offset >= total) { lastReport = now; self.postMessage({ id: id, done: false, loaded: offset, total: total }); }
      step();
    }, function (err) {
      self.postMessage({ id: id, error: String(err && err.message || err) });
    });
  }
  step();
};
