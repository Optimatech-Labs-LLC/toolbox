/* Checks the Tiny LLM model: gradients against finite differences, the causal mask, that training
   lowers the loss, generation, and the weights file round trip. Run: node test/llm_test.js
   Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
'use strict';
const L = require('../tiny-llm/model.js');
let failures = 0;
function check(label, ok, detail) { if (!ok) failures++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail ? '  (' + detail + ')' : '')); }

// 1. Every gradient must agree with a finite-difference estimate.
const gc = L.gradientCheck(7);
check('gradient check, worst relative error ' + gc.worst.toExponential(1), gc.ok, Object.keys(gc.report).map(k => k + ' ' + gc.report[k].toExponential(1)).join(', '));

// 2. The causal mask: changing later characters must not change earlier predictions.
{
  const rng = new L.Rng(1), vocab = new L.Vocab(L.SAMPLE_TEXT), m = L.init(vocab.size(), 8, 16, rng);
  const a = new Int32Array(8), b = new Int32Array(8);
  for (let i = 0; i < 8; i++) { a[i] = rng.below(vocab.size()); b[i] = i < 5 ? a[i] : (a[i] + 1) % vocab.size(); }
  const la = L.forward(m, a, 1, 8).logits, lb = L.forward(m, b, 1, 8).logits, V = vocab.size();
  let sameBefore = true, sameAfter = true;
  for (let i = 0; i < 5 * V; i++) if (Math.abs(la[i] - lb[i]) > 1e-12) sameBefore = false;
  for (let i = 5 * V; i < 8 * V; i++) if (Math.abs(la[i] - lb[i]) > 1e-12) sameAfter = false;
  check('causal mask hides the future', sameBefore && !sameAfter);
}

// 3. A fresh model is about as surprised as a fair die with one side per character; training lowers that.
{
  const rng = new L.Rng(3), vocab = new L.Vocab(L.SAMPLE_TEXT), data = L.windows(vocab.encode(L.SAMPLE_TEXT), 8), m = L.init(vocab.size(), 8, 16, rng);
  const first = L.evaluate(m, data);
  check('untrained loss near ln(vocab) = ' + Math.log(vocab.size()).toFixed(3) + ', got ' + first.toFixed(3), Math.abs(first - Math.log(vocab.size())) < 0.1);
  let last = first;
  for (let e = 0; e < 30; e++) last = L.trainEpoch(m, data, 32, 0.05, 1.0, rng);
  check('30 epochs lower the loss: ' + first.toFixed(3) + ' -> ' + last.toFixed(3), last < first * 0.9);
  const out = L.generate(m, vocab, 'It does not think', 40, 1.0, rng);
  check('generation keeps the seed and the length', out.startsWith('It does not think') && Array.from(out).length === 17 + 40);
  check('generation only uses known characters', Array.from(out).every(c => vocab.chars.includes(c)));
  check('unknown seed falls back to one space', Array.from(L.generate(m, vocab, '~~~', 5, 1.0, rng)).length === 6);
  const saved = JSON.parse(JSON.stringify(L.serialize(m, vocab, { epochs: 30 }))), back = L.deserialize(saved);
  check('weights file round trip', L.generate(m, vocab, 'LLM', 30, 1.0, new L.Rng(9)) === L.generate(back.model, back.vocab, 'LLM', 30, 1.0, new L.Rng(9)) && back.training.epochs === 30);
  let threw = false; try { L.deserialize({ format: 'nope' }); } catch (e) { threw = true; }
  check('refuses a foreign weights file', threw);
}

// 4. Clipping scales every gradient together; 0 turns it off.
{
  const g = {}; L.NAMES.forEach(k => { g[k] = new Float64Array(2).fill(10); });
  const norm = L.clipByGlobalNorm(g, 1.0);
  let sq = 0; L.NAMES.forEach(k => { for (const v of g[k]) sq += v * v; });
  check('global norm clipping', Math.abs(norm - Math.sqrt(24 * 100)) < 1e-9 && Math.abs(Math.sqrt(sq) - 1) < 1e-9);
  const h = { }; L.NAMES.forEach(k => { h[k] = new Float64Array(2).fill(10); }); L.clipByGlobalNorm(h, 0);
  check('clip 0 leaves gradients alone', h.E[0] === 10);
}

// 5. Speed with the page's default settings, to size the default epoch count.
{
  const rng = new L.Rng(5), vocab = new L.Vocab(L.SAMPLE_TEXT), data = L.windows(vocab.encode(L.SAMPLE_TEXT), 8), m = L.init(vocab.size(), 8, 32, rng);
  for (let e = 0; e < 5; e++) L.trainEpoch(m, data, 32, 0.05, 1.0, rng);
  const t0 = Date.now(); let loss = 0;
  for (let e = 0; e < 100; e++) loss = L.trainEpoch(m, data, 32, 0.05, 1.0, rng);
  const ms = (Date.now() - t0) / 100;
  check('100 epochs at default size: ' + ms.toFixed(1) + ' ms/epoch, loss ' + loss.toFixed(3) + ', ' + L.countParams(m) + ' parameters', isFinite(loss));
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
