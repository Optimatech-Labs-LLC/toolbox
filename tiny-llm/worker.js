/* Tiny LLM training worker. Training and generation run here, off the page's main thread, so the page
   stays responsive. The weights live in this worker and leave it only as a file you ask for.
   Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
'use strict';
importScripts('model.js');
var L = self.OptimatechTinyLLM;
var state = { model: null, vocab: null, training: null, stop: false, busy: false };

self.onmessage = function (e) {
  var msg = e.data;
  try {
    if (msg.cmd === 'train') startTraining(msg);
    else if (msg.cmd === 'stop') state.stop = true;
    else if (msg.cmd === 'generate') doGenerate(msg);
    else if (msg.cmd === 'export') doExport();
    else if (msg.cmd === 'import') doImport(msg);
    else if (msg.cmd === 'check') self.postMessage({ type: 'check', result: L.gradientCheck(7) });
  } catch (err) {
    state.busy = false;
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};

function slice(all, from, to) {
  var C = all.context;
  return { X: all.X.subarray(from * C, to * C), Y: all.Y.subarray(from * C, to * C), n: to - from, context: C };
}

function startTraining(msg) {
  if (state.busy) throw new Error('Already training. Stop first.');
  var C = msg.context | 0, D = msg.dim | 0, epochs = msg.epochs | 0, lr = +msg.lr, batch = msg.batch | 0, clip = +msg.clip, seed = msg.seed | 0;
  if (C < 1 || D < 1 || epochs < 1 || !(lr > 0) || batch < 1) throw new Error('Those settings do not make sense.');
  var vocab = new L.Vocab(msg.text), ids = vocab.encode(msg.text);
  if (vocab.size() < 2) throw new Error('The text needs at least two different characters.');
  if (ids.length <= C + 1) throw new Error('The text is shorter than the context window. Give it more to read.');
  var all = L.windows(ids, C), data = all, held = null;
  if (msg.holdout > 0 && all.n >= 20) {
    var n = Math.floor(all.n * (1 - msg.holdout));
    data = slice(all, 0, n); held = slice(all, n, all.n);
  }
  var rng = new L.Rng(seed), model = L.init(vocab.size(), C, D, rng);
  state.model = model; state.vocab = vocab; state.stop = false; state.busy = true;
  state.training = { text_characters: ids.length, vocabulary: vocab.size(), windows: data.n, held_out_windows: held ? held.n : 0, parameters: L.countParams(model),
                     context: C, dim: D, epochs_requested: epochs, epochs_done: 0, learning_rate: lr, batch: batch, clip: clip, seed: seed, final_loss: null, held_out_loss: null };
  var sampleSeed = msg.sampleSeed || '', sampleEvery = msg.sampleEvery || 50;
  self.postMessage({ type: 'started', info: state.training, sample: L.generate(model, vocab, sampleSeed, 60, 0.8, new L.Rng(1)) });
  var epoch = 0, t0 = Date.now(), lastPost = t0, pending = [];

  function run() {
    if (state.stop || epoch >= epochs) { finish(); return; }
    var sliceStart = Date.now();
    do {
      var loss = L.trainEpoch(model, data, batch, lr, clip, rng);
      epoch++;
      pending.push(loss);
      state.training.epochs_done = epoch; state.training.final_loss = loss;
      if (!isFinite(loss)) {
        state.busy = false;
        self.postMessage({ type: 'blowup', epoch: epoch, losses: pending, elapsed: Date.now() - t0 });
        return;
      }
      var now = Date.now();
      if (epoch === epochs || now - lastPost > 100) {
        lastPost = now;
        if (held) state.training.held_out_loss = L.evaluate(model, held);
        self.postMessage({ type: 'progress', epoch: epoch, epochs: epochs, loss: loss, losses: pending, heldOut: held ? state.training.held_out_loss : null, elapsed: now - t0 });
        pending = [];
      }
      if (epoch % sampleEvery === 0 || epoch === epochs) self.postMessage({ type: 'sample', epoch: epoch, text: L.generate(model, vocab, sampleSeed, 60, 0.8, new L.Rng(1)) });
    } while (!state.stop && epoch < epochs && Date.now() - sliceStart < 60);
    setTimeout(run, 0);
  }
  function finish() {
    state.busy = false;
    if (held) state.training.held_out_loss = L.evaluate(model, held);
    self.postMessage({ type: 'done', epoch: epoch, epochs: epochs, loss: state.training.final_loss, losses: pending, heldOut: held ? state.training.held_out_loss : null,
                       elapsed: Date.now() - t0, stopped: state.stop && epoch < epochs, sample: L.generate(model, vocab, sampleSeed, 60, 0.8, new L.Rng(1)) });
  }
  setTimeout(run, 0);
}

function doGenerate(msg) {
  if (!state.model) throw new Error('Train a model first, or load a weights file.');
  var text = L.generate(state.model, state.vocab, msg.seed || '', Math.max(1, msg.length | 0), +msg.temperature || 1, new L.Rng(msg.rngSeed || Date.now()));
  self.postMessage({ type: 'generated', text: text });
}

function doExport() {
  if (!state.model) throw new Error('There is nothing to save yet.');
  self.postMessage({ type: 'weights', json: JSON.stringify(L.serialize(state.model, state.vocab, state.training)) });
}

function doImport(msg) {
  if (state.busy) throw new Error('Stop training before loading a file.');
  var back = L.deserialize(JSON.parse(msg.json));
  state.model = back.model; state.vocab = back.vocab; state.training = back.training;
  self.postMessage({ type: 'imported', info: { parameters: L.countParams(back.model), vocabulary: back.vocab.size(), context: back.model.C, dim: back.model.D, training: back.training } });
}
