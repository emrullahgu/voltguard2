'use strict';
// ============================================================================
// PARALAKS: TEK HAT — solve2.js : tam erişilebilir durum grafiği + metrik başına kesin optimum
//  explore()   : BFS ile tüm erişilebilir durumlar (CSR kenar dizileri), kazanma bayrakları
//  optimum()   : GERÇEK demet (tuple) karşılaştırmalı sözlüksel Dijkstra (taşma yok)
//                Hamle | Manevra | Kesinti | Olay (kural sürümü 4: döndürme yok; kamera durumda değildir)
//  toGoal()    : ters 0-1 BFS (Hamle) -> çıkmaz kesri, ipucu tablosu
//  toGoalLex() : ters demet Dijkstra (örn. Kesinti, sonra Hamle) -> metrik başına ipucu tablosu
//  front()     : katmanlı DP ile kesin Pareto cephesi (Hamle × Kesinti, Hamle × Manevra)
//  solve()     : hızlı tek-metrik çözüm (Hamle; 0 maliyetli kapanış = 0-1 BFS, freeWalk ablasyonunda yürüyüş 0)
//  mash()      : DOKUN-YÜRÜ rastgele oyuncu (komut düzeyi; yürüyüş otomatik)
// Maliyet paketi: h bit0 | m bit1 | (bit2 ayrılmış, hep 0) | o (0..31) bit3-7 | k bit8+
// ============================================================================
const S = require('./sim2.js');

const pack = c => c.h | (c.m << 1) | (c.o << 3) | (c.k << 8);
const H = p => p & 1, M = p => (p >> 1) & 1, Rr = p => (p >> 2) & 1, O = p => (p >> 3) & 31, K = p => p >>> 8;
const COMP = { h: H, m: M, k: K, o: O, r: Rr };
const ORDERS = { hamle: ['h', 'm', 'k', 'o'], manevra: ['m', 'h', 'k', 'o'], kesinti: ['k', 'h', 'm', 'o'], olay: ['o', 'h', 'm', 'k'] };

function explore(L, cap) {
  cap = cap || 2e6;
  const s0 = S.initState(L); const ids = new Map(); const keys = []; const st = [];
  const off = [0]; const to = []; const cost = []; const tok = []; const won = [];
  const add = s => { const k = S.key(L, s); let i = ids.get(k); if (i === undefined) { i = keys.length; ids.set(k, i); keys.push(k); st.push(s); } return i; };
  add(s0);
  for (let i = 0; i < keys.length; i++) {
    if (keys.length > cap) return { unknown: true, n: keys.length };
    const s = st[i]; st[i] = null;
    const w = S.won(L, s); won.push(w ? 1 : 0);
    if (!w) for (const m of S.succ(L, s)) { to.push(add(m.s)); cost.push(pack(m.c)); tok.push(S.encodeAct(L, s, m.a)); }
    off.push(to.length);
  }
  return { L, n: keys.length, keys, ids, off: Int32Array.from(off), to: Int32Array.from(to), cost: Int32Array.from(cost), tok, won: Uint8Array.from(won) };
}

// demet yığını
function TupleHeap(w) { this.w = w; this.d = []; this.v = []; }
TupleHeap.prototype.less = function (a, b) { for (let i = 0; i < this.w; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
TupleHeap.prototype.push = function (d, v) { const D = this.d, Vv = this.v; let i = D.length; D.push(d); Vv.push(v);
  while (i > 0) { const p = (i - 1) >> 1; if (!this.less(d, D[p])) break; D[i] = D[p]; Vv[i] = Vv[p]; i = p; } D[i] = d; Vv[i] = v; };
TupleHeap.prototype.pop = function () { const D = this.d, Vv = this.v; const rd = D[0], rv = Vv[0]; const ld = D.pop(), lv = Vv.pop();
  if (D.length) { let i = 0; const n = D.length; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && this.less(D[c + 1], D[c])) c++; if (!this.less(D[c], ld)) break; D[i] = D[c]; Vv[i] = Vv[c]; i = c; } D[i] = ld; Vv[i] = lv; }
  this.rd = rd; return rv; };
const lessT = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

function optimum(Gr, metric) {
  const ord = ORDERS[metric].map(c => COMP[c]); const W = ord.length; const n = Gr.n;
  const dist = new Array(n).fill(null); const prev = new Int32Array(n).fill(-1);
  const hp = new TupleHeap(W); dist[0] = new Array(W).fill(0); hp.push(dist[0], 0); let goal = -1;
  while (hp.d.length) { const u = hp.pop(); const du = hp.rd; if (du !== dist[u]) continue; if (Gr.won[u]) { goal = u; break; }
    for (let e = Gr.off[u]; e < Gr.off[u + 1]; e++) { const t = Gr.to[e]; const c = Gr.cost[e]; const nd = new Array(W); for (let i = 0; i < W; i++) nd[i] = du[i] + ord[i](c);
      if (!dist[t] || lessT(nd, dist[t])) { dist[t] = nd; prev[t] = e; hp.push(nd, t); } } }
  if (goal < 0) return null;
  const path = []; const tot = { h: 0, m: 0, k: 0, o: 0 }; let u = goal;
  const edgeFrom = e => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (Gr.off[mid] <= e) lo = mid; else hi = mid - 1; } return lo; };
  while (u !== 0) { const e = prev[u]; path.push(Gr.tok[e]); const c = Gr.cost[e]; tot.h += H(c); tot.m += M(c); tot.k += K(c); tot.o += O(c); u = edgeFrom(e); }
  path.reverse();
  return { metric, tot, path: path.join(' '), goal };
}
function reverseCSR(Gr) {
  if (Gr._rev) return Gr._rev;
  const n = Gr.n; const rOff = new Int32Array(n + 1); for (let e = 0; e < Gr.to.length; e++) rOff[Gr.to[e] + 1]++;
  for (let i = 0; i < n; i++) rOff[i + 1] += rOff[i];
  const rFrom = new Int32Array(Gr.to.length), rE = new Int32Array(Gr.to.length), fill = rOff.slice(0, n);
  for (let u = 0; u < n; u++) for (let e = Gr.off[u]; e < Gr.off[u + 1]; e++) { const t = Gr.to[e]; rFrom[fill[t]] = u; rE[fill[t]] = e; fill[t]++; }
  return (Gr._rev = { rOff, rFrom, rE });
}
// ters 0-1 BFS: her durumdan hedefe en az Hamle
function toGoal(Gr) {
  const n = Gr.n; const { rOff, rFrom, rE } = reverseCSR(Gr);
  const dist = new Int32Array(n).fill(-1); const dq = new Int32Array(2 * Gr.to.length + 2 * n + 2); let head = Gr.to.length + n + 1, tail = head;
  const d2 = new Int32Array(n).fill(1 << 30);
  for (let i = 0; i < n; i++) if (Gr.won[i]) { d2[i] = 0; dq[tail++] = i; }
  while (head < tail) { const u = dq[head++]; if (dist[u] >= 0) continue; dist[u] = d2[u];
    for (let j = rOff[u]; j < rOff[u + 1]; j++) { const p = rFrom[j], c = H(Gr.cost[rE[j]]); const nd = d2[u] + c; if (dist[p] < 0 && nd < d2[p]) { d2[p] = nd; if (c === 0) dq[--head] = p; else dq[tail++] = p; } } }
  let dead = 0; for (let i = 0; i < n; i++) if (dist[i] < 0) dead++;
  return { dist, dead, deadFrac: dead / n };
}
// ters demet Dijkstra (metrik başına ipucu): dist[i] = [birincil, ikincil] ya da null (çıkmaz)
function toGoalLex(Gr, metric) {
  const ord = ORDERS[metric].slice(0, 2).map(c => COMP[c]); const n = Gr.n; const { rOff, rFrom, rE } = reverseCSR(Gr);
  const dist = new Array(n).fill(null); const hp = new TupleHeap(2);
  for (let i = 0; i < n; i++) if (Gr.won[i]) { dist[i] = [0, 0]; hp.push(dist[i], i); }
  while (hp.d.length) { const u = hp.pop(); const du = hp.rd; if (du !== dist[u]) continue;
    for (let j = rOff[u]; j < rOff[u + 1]; j++) { const p = rFrom[j], c = Gr.cost[rE[j]]; const nd = [du[0] + ord[0](c), du[1] + ord[1](c)];
      if (!dist[p] || lessT(nd, dist[p])) { dist[p] = nd; hp.push(nd, p); } } }
  return dist;
}
// kesin Pareto cephesi: birincil Hamle (h ∈ [par, par+span]), ikincil 'k' (Kesinti) ya da 'm' (Manevra)
function front(Gr, sec, par, span) {
  const n = Gr.n; const INF = 1 << 30; let cur = new Int32Array(n).fill(INF); cur[0] = 0; const pts = []; let best = INF;
  const secOf = c => sec === 'k' ? K(c) : M(c);
  for (let h = 0; h <= par + span; h++) {
    // Sıfır Hamleli kapanışın uzunluğu durum sayısıyla sınırlıdır; keyfi bir
    // 256 tur sınırı geçerli uzun yolları reddeder. Yalnız iyileşen düğümleri işle.
    const q = [], queued = new Uint8Array(n);
    for (let u = 0; u < n; u++) if (cur[u] !== INF) { q.push(u); queued[u] = 1; }
    for (let i = 0; i < q.length; i++) {
      const u = q[i]; queued[u] = 0; if (Gr.won[u]) continue;
      for (let e = Gr.off[u]; e < Gr.off[u + 1]; e++) { const c = Gr.cost[e]; if (H(c)) continue; const t = Gr.to[e]; const nd = cur[u] + secOf(c);
        if (nd < cur[t]) { cur[t] = nd; if (!queued[t]) { q.push(t); queued[t] = 1; } } }
    }
    let g = INF; for (let u = 0; u < n; u++) if (Gr.won[u] && cur[u] < g) g = cur[u];
    if (g < best) { best = g; pts.push([h, g]); }
    const nx = new Int32Array(n).fill(INF);
    for (let u = 0; u < n; u++) { const du = cur[u]; if (du === INF || Gr.won[u]) continue;
      for (let e = Gr.off[u]; e < Gr.off[u + 1]; e++) { const c = Gr.cost[e]; if (!H(c)) continue; const t = Gr.to[e]; const nd = du + secOf(c); if (nd < nx[t]) nx[t] = nd; } }
    cur = nx;
  }
  return pts;
}
// hızlı Hamle çözücü (üretici ve ablasyonlar için): katmanlı 0-1 BFS, ebeveyn izi ile yol
function solve(L, o) {
  o = o || {}; const cap = o.cap || 2e6;
  let s0; try { s0 = S.initState(L); } catch (e) { return { par: -1, states: 0, badStart: true }; }
  const k0 = S.key(L, s0);
  const par = new Map(); par.set(k0, null); let layer = [s0]; let d = 0;
  const pathOf = k => { const p = []; let r = par.get(k); while (r) { p.push(r[1]); r = par.get(r[0]); } return p.reverse(); };
  while (layer.length) {
    const stack = layer.slice(); const all = layer.slice();
    while (stack.length) { const s = stack.pop(); const ks = S.key(L, s); if (S.won(L, s)) continue;
      for (const m of S.succ(L, s)) { if (m.c.h) continue; const k = S.key(L, m.s); if (par.has(k)) continue; par.set(k, [ks, S.encodeAct(L, s, m.a)]); if (par.size > cap) return { par: -1, unknown: true, states: par.size }; stack.push(m.s); all.push(m.s); } }
    for (const s of all) if (S.won(L, s)) return { par: d, states: par.size, path: o.path === false ? null : pathOf(S.key(L, s)) };
    if (par.size > cap) return { par: -1, unknown: true, states: par.size };
    const nx = [];
    for (const s of all) { const ks = S.key(L, s);
      for (const m of S.succ(L, s)) { if (!m.c.h) continue; const k = S.key(L, m.s); if (par.has(k)) continue; par.set(k, [ks, S.encodeAct(L, s, m.a)]); if (par.size > cap) return { par: -1, unknown: true, states: par.size }; nx.push(m.s); } }
    layer = nx; d++;
  }
  return { par: -1, states: par.size };
}
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// DOKUN-YÜRÜ rastgele oyuncu (denetçi önerisi, komut düzeyi): her adımda, fiziksel yürüyüşle erişilebilen
// her karodan yapılabilen yürüyüş-DIŞI komutların (işlem, kilit, bekle, çalış) farklılarından biri
// eşit olasılıkla seçilir (komut en yakın karodan yapılır); yürüyüş bedavadır. Bütçe KOMUT cinsinden.
function mashMenu(Gr) {
  const cache = new Map();
  return u => { let m = cache.get(u); if (m) return m; const opts = new Map(); let win = -1;
    const cl = [u]; for (let e = Gr.off[u]; e < Gr.off[u + 1]; e++) if (Gr.tok[e][0] === 'g') cl.push(Gr.to[e]);
    for (const x of cl) { if (Gr.won[x]) { win = x; break; } for (let e = Gr.off[x]; e < Gr.off[x + 1]; e++) { const t = Gr.tok[e]; if (t[0] !== 'g' && !opts.has(t)) opts.set(t, Gr.to[e]); } }
    m = win >= 0 ? { win } : { opts: [...opts.values()] }; cache.set(u, m); return m; };
}
function mash(Gr, budget, runs, seed) {
  const rnd = mulberry(seed || 12345); const menu = mashMenu(Gr); let w = 0;
  for (let r = 0; r < runs; r++) { let u = 0, ok = false;
    for (let i = 0; i <= budget; i++) { const m = menu(u); if (m.win !== undefined) { ok = true; break; } if (i === budget || !m.opts.length) break; u = m.opts[Math.floor(rnd() * m.opts.length)]; }
    if (ok) w++; }
  return w / runs;
}

module.exports = { explore, optimum, toGoal, toGoalLex, front, solve, mash, mashMenu, mulberry, pack, H, M, K, O, Rr, ORDERS };
