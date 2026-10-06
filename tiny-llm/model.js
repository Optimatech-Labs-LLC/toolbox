/* Tiny LLM: a character-level transformer with hand-written backpropagation, in plain JavaScript.
   It is the same model as llm.py in https://github.com/Optimatech-Labs-LLC/feel-smart-llm, written so it
   can train inside a browser worker with nothing to download and nothing to send.
   Copyright (c) 2026 Optimatech Labs LLC. MIT License. */
(function (root) {
  'use strict';

  var SAMPLE_TEXT = 'What is an LLM? LLM stands for Large Language Model. In simple terms it is a piece of software that has been trained on massive amounts of text from the internet, books, articles, code, and conversations. It learned patterns in how humans use language by reading more text than any person could read in a thousand lifetimes. It does not think. It predicts. Given what you just said, it calculates the most likely next word, then the next, then the next. It does this so well that it feels like a conversation but underneath it is math.';

  /* Repeatable random numbers, so a run can be reproduced: mulberry32 for uniforms, Box-Muller for normals. */
  function Rng(seed) { this.s = (seed >>> 0) || 1; }
  Rng.prototype.next = function () {
    var t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.normal = function () { var u = 1 - this.next(), v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  Rng.prototype.below = function (n) { return Math.floor(this.next() * n); };
  Rng.prototype.shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = this.below(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; };

  /* The model works on characters. The vocabulary is every distinct character in the text. */
  function Vocab(text) {
    this.chars = Array.from(new Set(Array.from(text))).sort();
    this.index = Object.create(null);
    for (var i = 0; i < this.chars.length; i++) this.index[this.chars[i]] = i;
  }
  Vocab.prototype.size = function () { return this.chars.length; };
  Vocab.prototype.encode = function (s) { var out = [], a = Array.from(s); for (var i = 0; i < a.length; i++) if (a[i] in this.index) out.push(this.index[a[i]]); return out; };
  Vocab.prototype.decode = function (ids) { var s = ''; for (var i = 0; i < ids.length; i++) s += this.chars[ids[i]]; return s; };

  /* Every run of `context` characters, paired with the same run shifted one character ahead. */
  function windows(data, context) {
    var n = Math.max(0, data.length - context), X = new Int32Array(n * context), Y = new Int32Array(n * context);
    for (var i = 0; i < n; i++) for (var t = 0; t < context; t++) { X[i * context + t] = data[i + t]; Y[i * context + t] = data[i + t + 1]; }
    return { X: X, Y: Y, n: n, context: context };
  }

  var NAMES = ['E', 'P', 'Wq', 'Wk', 'Wv', 'Wo', 'W1', 'b1', 'W2', 'b2', 'Wout', 'bout'];
  function shapes(V, C, D) {
    var H = 2 * D;
    return { E: [V, D], P: [C, D], Wq: [D, D], Wk: [D, D], Wv: [D, D], Wo: [D, D], W1: [D, H], b1: [H], W2: [H, D], b2: [D], Wout: [D, V], bout: [V] };
  }
  function sizeOf(shape) { return shape.reduce(function (a, b) { return a * b; }, 1); }

  function init(V, C, D, rng) {
    var m = { V: V, C: C, D: D, H: 2 * D, w: {} }, sh = shapes(V, C, D);
    NAMES.forEach(function (k) {
      var a = new Float64Array(sizeOf(sh[k]));
      if (sh[k].length === 2) for (var i = 0; i < a.length; i++) a[i] = rng.normal() * 0.05;
      m.w[k] = a;
    });
    return m;
  }
  function countParams(m) { var n = 0; NAMES.forEach(function (k) { n += m.w[k].length; }); return n; }

  /* Three matrix products are all the linear algebra the model needs. Row-major, flat arrays.
     Each one works on several rows at once so every number loaded from memory is used more than once.
     That is worth about 1.5x in current JavaScript engines; the results are identical. */
  function mm(a, n, k, b, p, out) {            /* out[n x p] = a[n x k] @ b[k x p] */
    out.fill(0);
    var i = 0, j, l;
    for (; i + 3 < n; i += 4) {
      var ar0 = i * k, ar1 = ar0 + k, ar2 = ar1 + k, ar3 = ar2 + k, o0 = i * p, o1 = o0 + p, o2 = o1 + p, o3 = o2 + p;
      for (j = 0; j < k; j++) {
        var a0 = a[ar0 + j], a1 = a[ar1 + j], a2 = a[ar2 + j], a3 = a[ar3 + j], br = j * p;
        for (l = 0; l < p; l++) { var bv = b[br + l]; out[o0 + l] += a0 * bv; out[o1 + l] += a1 * bv; out[o2 + l] += a2 * bv; out[o3 + l] += a3 * bv; }
      }
    }
    for (; i < n; i++) {
      var ar = i * k, orow = i * p;
      for (j = 0; j < k; j++) { var av = a[ar + j], br1 = j * p; for (l = 0; l < p; l++) out[orow + l] += av * b[br1 + l]; }
    }
    return out;
  }
  function mmAT(a, n, k, b, p, out) {          /* out[k x p] = transpose(a[n x k]) @ b[n x p] */
    out.fill(0);
    var i = 0, j, l;
    for (; i + 3 < n; i += 4) {
      var ar0 = i * k, ar1 = ar0 + k, ar2 = ar1 + k, ar3 = ar2 + k, b0 = i * p, b1 = b0 + p, b2 = b1 + p, b3 = b2 + p;
      for (j = 0; j < k; j++) {
        var a0 = a[ar0 + j], a1 = a[ar1 + j], a2 = a[ar2 + j], a3 = a[ar3 + j], orow = j * p;
        for (l = 0; l < p; l++) out[orow + l] += a0 * b[b0 + l] + a1 * b[b1 + l] + a2 * b[b2 + l] + a3 * b[b3 + l];
      }
    }
    for (; i < n; i++) {
      var ar = i * k, br = i * p;
      for (j = 0; j < k; j++) { var av = a[ar + j], orow1 = j * p; for (l = 0; l < p; l++) out[orow1 + l] += av * b[br + l]; }
    }
    return out;
  }
  function mmBT(a, n, p, b, k, out) {          /* out[n x k] = a[n x p] @ transpose(b[k x p]) */
    var i = 0, j, l;
    for (; i + 1 < n; i += 2) {
      var ar0 = i * p, ar1 = ar0 + p, o0 = i * k, o1 = o0 + k;
      for (j = 0; j + 1 < k; j += 2) {
        var br0 = j * p, br1 = br0 + p, s00 = 0, s01 = 0, s10 = 0, s11 = 0;
        for (l = 0; l < p; l++) { var x0 = a[ar0 + l], x1 = a[ar1 + l], y0 = b[br0 + l], y1 = b[br1 + l]; s00 += x0 * y0; s01 += x0 * y1; s10 += x1 * y0; s11 += x1 * y1; }
        out[o0 + j] = s00; out[o0 + j + 1] = s01; out[o1 + j] = s10; out[o1 + j + 1] = s11;
      }
      for (; j < k; j++) { var brj = j * p, t0 = 0, t1 = 0; for (l = 0; l < p; l++) { t0 += a[ar0 + l] * b[brj + l]; t1 += a[ar1 + l] * b[brj + l]; } out[o0 + j] = t0; out[o1 + j] = t1; }
    }
    for (; i < n; i++) {
      var ar = i * p, orow = i * k;
      for (j = 0; j < k; j++) { var br = j * p, s = 0; for (l = 0; l < p; l++) s += a[ar + l] * b[br + l]; out[orow + j] = s; }
    }
    return out;
  }
  function colSum(a, n, p) { var out = new Float64Array(p); for (var i = 0; i < n; i++) { var r = i * p; for (var j = 0; j < p; j++) out[j] += a[r + j]; } return out; }

  /* Forward pass: embeddings, causal self-attention, feed-forward, readout. Keeps what backward needs. */
  function forward(m, idx, B, T) {
    var w = m.w, D = m.D, V = m.V, H = m.H, N = B * T, scale = 1 / Math.sqrt(D), i, j, d, b, t, u;
    var x0 = new Float64Array(N * D);
    for (i = 0; i < N; i++) { var c = idx[i] * D, p = (i % T) * D, r = i * D; for (d = 0; d < D; d++) x0[r + d] = w.E[c + d] + w.P[p + d]; }
    var Q = mm(x0, N, D, w.Wq, D, new Float64Array(N * D));
    var K = mm(x0, N, D, w.Wk, D, new Float64Array(N * D));
    var Vv = mm(x0, N, D, w.Wv, D, new Float64Array(N * D));
    var A = new Float64Array(B * T * T), AV = new Float64Array(N * D);
    for (b = 0; b < B; b++) {
      for (t = 0; t < T; t++) {
        var row = b * T + t, q = row * D, arow = row * T, max = -Infinity, s, sum = 0;
        for (u = 0; u <= t; u++) { var kr = (b * T + u) * D; s = 0; for (d = 0; d < D; d++) s += Q[q + d] * K[kr + d]; s *= scale; A[arow + u] = s; if (s > max) max = s; }
        for (u = 0; u <= t; u++) { var e = Math.exp(A[arow + u] - max); A[arow + u] = e; sum += e; }
        for (u = 0; u <= t; u++) { var a = A[arow + u] / sum, vr = (b * T + u) * D; A[arow + u] = a; for (d = 0; d < D; d++) AV[q + d] += a * Vv[vr + d]; }
      }
    }
    var x1 = mm(AV, N, D, w.Wo, D, new Float64Array(N * D));
    for (i = 0; i < N * D; i++) x1[i] += x0[i];
    var h = mm(x1, N, D, w.W1, H, new Float64Array(N * H));
    for (i = 0; i < N; i++) { var hr = i * H; for (j = 0; j < H; j++) { var v = h[hr + j] + w.b1[j]; h[hr + j] = v > 0 ? v : 0; } }
    var x2 = mm(h, N, H, w.W2, D, new Float64Array(N * D));
    for (i = 0; i < N; i++) { var xr = i * D; for (d = 0; d < D; d++) x2[xr + d] += x1[xr + d] + w.b2[d]; }
    var logits = mm(x2, N, D, w.Wout, V, new Float64Array(N * V));
    for (i = 0; i < N; i++) { var lr = i * V; for (j = 0; j < V; j++) logits[lr + j] += w.bout[j]; }
    return { idx: idx, B: B, T: T, x0: x0, Q: Q, K: K, V: Vv, A: A, AV: AV, x1: x1, h: h, x2: x2, logits: logits };
  }

  /* Cross-entropy loss and its gradient with respect to the logits. */
  function lossAndGrad(cache, targets) {
    var N = cache.B * cache.T, V = cache.logits.length / N, logits = cache.logits, d = new Float64Array(N * V), loss = 0, i, c;
    for (i = 0; i < N; i++) {
      var r = i * V, max = -Infinity, sum = 0;
      for (c = 0; c < V; c++) if (logits[r + c] > max) max = logits[r + c];
      for (c = 0; c < V; c++) { var e = Math.exp(logits[r + c] - max); d[r + c] = e; sum += e; }
      for (c = 0; c < V; c++) d[r + c] /= sum;
      loss -= logits[r + targets[i]] - max - Math.log(sum);
      d[r + targets[i]] -= 1;
    }
    for (i = 0; i < N * V; i++) d[i] /= N;
    return { loss: loss / N, dlogits: d };
  }

  /* Backward pass: the forward pass in reverse, chain rule at every step. gradientCheck() verifies it. */
  function backward(m, cache, dlogits) {
    var w = m.w, D = m.D, V = m.V, H = m.H, B = cache.B, T = cache.T, N = B * T, scale = 1 / Math.sqrt(D), g = {}, i, d, b, t, u;
    g.Wout = mmAT(cache.x2, N, D, dlogits, V, new Float64Array(D * V));
    g.bout = colSum(dlogits, N, V);
    var dx2 = mmBT(dlogits, N, V, w.Wout, D, new Float64Array(N * D));
    g.W2 = mmAT(cache.h, N, H, dx2, D, new Float64Array(H * D));
    g.b2 = colSum(dx2, N, D);
    var dh = mmBT(dx2, N, D, w.W2, H, new Float64Array(N * H));
    for (i = 0; i < N * H; i++) if (cache.h[i] <= 0) dh[i] = 0;             /* ReLU: gradient only where it was open */
    g.W1 = mmAT(cache.x1, N, D, dh, H, new Float64Array(D * H));
    g.b1 = colSum(dh, N, H);
    var dx1 = mmBT(dh, N, H, w.W1, D, new Float64Array(N * D));
    for (i = 0; i < N * D; i++) dx1[i] += dx2[i];                           /* residual: dx2 passes straight through */
    g.Wo = mmAT(cache.AV, N, D, dx1, D, new Float64Array(D * D));
    var dAV = mmBT(dx1, N, D, w.Wo, D, new Float64Array(N * D));
    var dV = new Float64Array(N * D), dQ = new Float64Array(N * D), dK = new Float64Array(N * D), dA = new Float64Array(T);
    for (b = 0; b < B; b++) {
      for (t = 0; t < T; t++) {
        var row = b * T + t, arow = row * T, qr = row * D, dot = 0;
        for (u = 0; u <= t; u++) {
          var vr = (b * T + u) * D, a = cache.A[arow + u], s = 0;
          for (d = 0; d < D; d++) { s += dAV[qr + d] * cache.V[vr + d]; dV[vr + d] += a * dAV[qr + d]; }
          dA[u] = s; dot += a * s;
        }
        for (u = 0; u <= t; u++) {                                           /* softmax backward, then undo the scale */
          var ds = cache.A[arow + u] * (dA[u] - dot) * scale, kr = (b * T + u) * D;
          if (ds === 0) continue;
          for (d = 0; d < D; d++) { dQ[qr + d] += ds * cache.K[kr + d]; dK[kr + d] += ds * cache.Q[qr + d]; }
        }
      }
    }
    g.Wq = mmAT(cache.x0, N, D, dQ, D, new Float64Array(D * D));
    g.Wk = mmAT(cache.x0, N, D, dK, D, new Float64Array(D * D));
    g.Wv = mmAT(cache.x0, N, D, dV, D, new Float64Array(D * D));
    var dx0 = dx1, tmp = new Float64Array(N * D);
    mmBT(dQ, N, D, w.Wq, D, tmp); for (i = 0; i < N * D; i++) dx0[i] += tmp[i];
    mmBT(dK, N, D, w.Wk, D, tmp); for (i = 0; i < N * D; i++) dx0[i] += tmp[i];
    mmBT(dV, N, D, w.Wv, D, tmp); for (i = 0; i < N * D; i++) dx0[i] += tmp[i];
    g.E = new Float64Array(V * D); g.P = new Float64Array(m.C * D);
    for (i = 0; i < N; i++) { var er = cache.idx[i] * D, pr = (i % T) * D, xr = i * D; for (d = 0; d < D; d++) { g.E[er + d] += dx0[xr + d]; g.P[pr + d] += dx0[xr + d]; } }
    return g;
  }

  /* When the combined length of all gradients exceeds maxNorm, scale them all down together. */
  function clipByGlobalNorm(g, maxNorm) {
    var sq = 0;
    NAMES.forEach(function (k) { var a = g[k]; for (var i = 0; i < a.length; i++) sq += a[i] * a[i]; });
    var norm = Math.sqrt(sq);
    if (maxNorm > 0 && norm > maxNorm) { var f = maxNorm / norm; NAMES.forEach(function (k) { var a = g[k]; for (var i = 0; i < a.length; i++) a[i] *= f; }); }
    return norm;
  }
  function step(m, g, lr) { NAMES.forEach(function (k) { var a = m.w[k], d = g[k]; for (var i = 0; i < a.length; i++) a[i] -= lr * d[i]; }); }

  /* One pass over the windows in random order. Returns the average loss. */
  function trainEpoch(m, data, batch, lr, clip, rng) {
    var n = data.n, T = data.context, order = new Int32Array(n), total = 0, i, b, t;
    for (i = 0; i < n; i++) order[i] = i;
    rng.shuffle(order);
    for (var start = 0; start < n; start += batch) {
      var B = Math.min(batch, n - start), idx = new Int32Array(B * T), tgt = new Int32Array(B * T);
      for (b = 0; b < B; b++) { var src = order[start + b] * T; for (t = 0; t < T; t++) { idx[b * T + t] = data.X[src + t]; tgt[b * T + t] = data.Y[src + t]; } }
      var cache = forward(m, idx, B, T), lg = lossAndGrad(cache, tgt), g = backward(m, cache, lg.dlogits);
      clipByGlobalNorm(g, clip);
      step(m, g, lr);
      total += lg.loss * B;
      if (!isFinite(lg.loss)) return NaN;
    }
    return total / n;
  }
  function evaluate(m, data) {
    var n = data.n, T = data.context, total = 0;
    for (var start = 0; start < n; start += 256) {
      var B = Math.min(256, n - start), idx = data.X.subarray(start * T, (start + B) * T), tgt = data.Y.subarray(start * T, (start + B) * T);
      total += lossAndGrad(forward(m, idx, B, T), tgt).loss * B;
    }
    return n ? total / n : NaN;
  }

  /* Feed the model its own output, one character at a time. */
  function generate(m, vocab, seed, n, temperature, rng) {
    var ids = vocab.encode(seed), V = m.V, temp = Math.max(temperature, 1e-6), c;
    if (!ids.length) ids = [(' ' in vocab.index) ? vocab.index[' '] : 0];
    for (var k = 0; k < n; k++) {
      var ctx = ids.slice(-m.C), T = ctx.length, logits = forward(m, Int32Array.from(ctx), 1, T).logits, r = (T - 1) * V, max = -Infinity, sum = 0, p = new Float64Array(V);
      for (c = 0; c < V; c++) if (logits[r + c] > max) max = logits[r + c];
      for (c = 0; c < V; c++) { p[c] = Math.exp((logits[r + c] - max) / temp); sum += p[c]; }
      var x = rng.next() * sum, acc = 0, pick = V - 1;
      for (c = 0; c < V; c++) { acc += p[c]; if (x < acc) { pick = c; break; } }
      ids.push(pick);
    }
    return vocab.decode(ids);
  }

  /* Nudge every weight up and down, measure how the loss moves, compare with what backward() claims. */
  function gradientCheck(seed) {
    var rng = new Rng(seed || 7), V = 7, C = 5, D = 6, B = 3, m = init(V, C, D, rng), eps = 1e-5, worst = 0, report = {}, i;
    NAMES.forEach(function (k) { var a = m.w[k]; for (var i = 0; i < a.length; i++) a[i] = a[i] * 4 + rng.normal() * 0.1; });
    var idx = new Int32Array(B * C), tgt = new Int32Array(B * C);
    for (i = 0; i < B * C; i++) { idx[i] = rng.below(V); tgt[i] = rng.below(V); }
    var cache = forward(m, idx, B, C), g = backward(m, cache, lossAndGrad(cache, tgt).dlogits);
    NAMES.forEach(function (k) {
      var a = m.w[k], maxNum = 0, maxAn = 0, maxDiff = 0;
      for (var i = 0; i < a.length; i++) {
        var old = a[i];
        a[i] = old + eps; var up = lossAndGrad(forward(m, idx, B, C), tgt).loss;
        a[i] = old - eps; var down = lossAndGrad(forward(m, idx, B, C), tgt).loss;
        a[i] = old;
        var num = (up - down) / (2 * eps);
        maxNum = Math.max(maxNum, Math.abs(num)); maxAn = Math.max(maxAn, Math.abs(g[k][i])); maxDiff = Math.max(maxDiff, Math.abs(num - g[k][i]));
      }
      report[k] = maxDiff / (maxNum + maxAn + 1e-12);
      if (report[k] > worst) worst = report[k];
    });
    return { worst: worst, ok: worst < 1e-4, report: report };
  }

  var FORMAT = 'optimatech-tiny-llm-1';
  function serialize(m, vocab, training) {
    var out = { format: FORMAT, context: m.C, dim: m.D, chars: vocab.chars, weights: {} };
    NAMES.forEach(function (k) { out.weights[k] = Array.from(m.w[k]); });
    if (training) out.training = training;
    return out;
  }
  function deserialize(obj) {
    if (!obj || obj.format !== FORMAT || !Array.isArray(obj.chars) || !obj.weights) throw new Error('This is not a Tiny LLM weights file.');
    var vocab = new Vocab(obj.chars.join('')), V = vocab.size(), C = obj.context | 0, D = obj.dim | 0;
    if (V < 2 || C < 1 || D < 1) throw new Error('The weights file is damaged.');
    var m = { V: V, C: C, D: D, H: 2 * D, w: {} }, sh = shapes(V, C, D);
    NAMES.forEach(function (k) {
      var a = obj.weights[k];
      if (!Array.isArray(a) || a.length !== sizeOf(sh[k])) throw new Error('The weights file is damaged (' + k + ').');
      m.w[k] = Float64Array.from(a);
    });
    return { model: m, vocab: vocab, training: obj.training || null };
  }

  var api = { SAMPLE_TEXT: SAMPLE_TEXT, NAMES: NAMES, Rng: Rng, Vocab: Vocab, windows: windows, init: init, countParams: countParams, forward: forward,
              lossAndGrad: lossAndGrad, backward: backward, clipByGlobalNorm: clipByGlobalNorm, step: step, trainEpoch: trainEpoch, evaluate: evaluate,
              generate: generate, gradientCheck: gradientCheck, serialize: serialize, deserialize: deserialize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OptimatechTinyLLM = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
