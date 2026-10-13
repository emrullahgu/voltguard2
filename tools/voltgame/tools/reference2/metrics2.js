'use strict';
// ============================================================================
// PARALAKS: TEK HAT — metrics2.js (kural sürümü 4) : seviye metrikleri (build zamanı)
//   analyse(def)  : durum sayısı, metrik başına kesin optimum (+ yol), çıkmaz kesri,
//                   dokun-yürü rastgele-basma kazanma oranı (6·par+20 KOMUT), Pareto cepheleri, çözüm çeşitliliği,
//                   elektrik yapılandırması sayısı, yürüyüş payı, freeWalk saf karar sayısı,
//                   ÇÖZÜM UZAYI histogramı (kazanma durumlarının Hamle uzaklığına göre dağılımı; dürüst, simülasyon yok) ve süreler
//   (kural sürümü 4: görünürlük paritesi ve klavye eşlemesi kaldırıldı — geometri fiziksel; fiziksel kapılar lint2.physical)
// ============================================================================
const S = require('./sim2.js'), V = require('./solve2.js');

// çözüm uzayı: başlangıçtan 0-1 BFS (Hamle) ile her kazanma durumunun en az Hamle'si; par..par+span histogramı
function solutionSpace(Gr, par, span) {
  const n = Gr.n; const d = new Int32Array(n).fill(-1); const dq = new Int32Array(2 * n + 2 * Gr.to.length + 2); let h0 = n + Gr.to.length + 1, t0 = h0;
  const best = new Int32Array(n).fill(1 << 30); best[0] = 0; dq[t0++] = 0;
  while (h0 < t0) { const u = dq[h0++]; if (d[u] >= 0) continue; d[u] = best[u]; if (Gr.won[u]) continue;
    for (let e = Gr.off[u]; e < Gr.off[u + 1]; e++) { const t = Gr.to[e], c = V.H(Gr.cost[e]); const nd = d[u] + c; if (d[t] < 0 && nd < best[t]) { best[t] = nd; if (c) dq[t0++] = t; else dq[--h0] = t; } } }
  const hist = new Map(); for (let i = 0; i < n; i++) if (Gr.won[i] && d[i] >= 0 && d[i] <= par + span) hist.set(d[i], (hist.get(d[i]) || 0) + 1);
  return [...hist.entries()].sort((a, b) => a[0] - b[0]);
}
// (eski) simüle oyuncu dağılımı — artık build kapısı değil, yalnız ajan ayarı için: her adımda exp(-beta*(Δh + dist[t])) ile eylem seçen ajanlar
function population(Gr, dist, n, beta, seed, budget) {
  const rnd = V.mulberry(seed || 99); const out = [];
  for (let r = 0; r < n; r++) { let u = 0; const tot = { h: 0, m: 0, k: 0, o: 0 };
    for (let i = 0; i < budget && !Gr.won[u]; i++) { const a = Gr.off[u], b = Gr.off[u + 1]; if (a === b) break;
      let sum = 0; const w = []; for (let e = a; e < b; e++) { const t = Gr.to[e]; const dd = dist[t] < 0 ? 60 : dist[t]; const x = Math.exp(-beta * (V.H(Gr.cost[e]) + dd - (dist[u] < 0 ? 60 : dist[u])) - (V.H(Gr.cost[e]) ? 0 : 0.7)); w.push(x); sum += x; }
      let p = rnd() * sum, e = a; for (let j = 0; j < w.length; j++) { p -= w[j]; if (p <= 0) { e = a + j; break; } e = a + j; }
      const c = Gr.cost[e]; tot.h += V.H(c); tot.m += V.M(c); tot.k += V.K(c); tot.o += V.O(c); u = Gr.to[e]; }
    if (Gr.won[u]) out.push(tot); }
  const hist = key => { const m = new Map(); for (const t of out) m.set(t[key], (m.get(t[key]) || 0) + 1); return [...m.entries()].sort((a, b) => a[0] - b[0]); };
  return { finished: out.length, n, hamle: hist('h'), manevra: hist('m'), kesinti: hist('k'), olay: hist('o') };
}
function analyse(def, o) {
  o = o || {}; const T0 = Date.now();
  const L = S.compile(def); const Gr = V.explore(L, o.cap || 2e6); const tExplore = Date.now() - T0;
  if (Gr.unknown) return { unknown: true, n: Gr.n };
  const T1 = Date.now(); const opt = {}; for (const m of ['hamle', 'manevra', 'kesinti', 'olay']) opt[m] = V.optimum(Gr, m); const tOpt = Date.now() - T1;
  if (!opt.hamle) return { unsolvable: true, n: Gr.n, tExplore };
  const T2 = Date.now(); const tg = V.toGoal(Gr); const tGoal = Date.now() - T2;
  const par = opt.hamle.tot.h;
  const T3 = Date.now(); const mash = V.mash(Gr, 6 * par + 20, o.runs || 10000, 4242); const tMash = Date.now() - T3;
  // çözüm çeşitliliği: kazanılan durumlardaki farklı son anahtarlama yapılandırmaları (açık uçluluk ölçüsü)
  let goals = 0; const ends = new Set(); for (let i = 0; i < Gr.n; i++) if (Gr.won[i]) { goals++; ends.add(S.unkey(L, Gr.keys[i]).b); }
  const T4 = Date.now();
  // cephe kesindir ve uç noktalarını içerir: Kesinti-opt (H×K) / Manevra-opt (H×M) planı par + 12'den uzunsa pencere
  // ona kadar genişler (M8: Kesinti-opt Hamle 37 > 24 + 12 idi; kesik cephe Mühendis/Pareto mühürlerini imkânsız kılıyordu)
  const spK = Math.max(o.span || 12, opt.kesinti.tot.h - par), spM = Math.max(o.span || 12, opt.manevra.tot.h - par);
  const fk = Gr.n <= 400000 ? V.front(Gr, 'k', par, spK) : null, fm = Gr.n <= 400000 ? V.front(Gr, 'm', par, spM) : null;
  const tFront = Date.now() - T4;
  const space = solutionSpace(Gr, par, o.span || 12);
  const elecSet = new Set(); for (let i = 0; i < Gr.n; i++) elecSet.add(S.elecKey(L, S.unkey(L, Gr.keys[i])));
  const toks = opt.hamle.path ? opt.hamle.path.split(' ') : []; const walks = toks.filter(x => x[0] === 'g').length;
  const fw = V.solve(S.compile(def, { freeWalk: true }), { cap: o.cap || 2e6, path: false }).par;
  const vecs = new Set(['hamle', 'manevra', 'kesinti'].map(m => [opt[m].tot.h, opt[m].tot.m, opt[m].tot.k, opt[m].tot.o].join(',')));
  const multi = vecs.size >= 2 || (fk && fk.length >= 2) || (fm && fm.length >= 2);
  return { L, Gr, n: Gr.n, edges: Gr.to.length, opt, par, endConfigs: ends.size, deadFrac: tg.deadFrac, mash, goals, frontK: fk, frontM: fm, space,
    elec: elecSet.size, walk: par ? walks / par : 0, free: fw, vecs: vecs.size, multi: !!multi,
    ms: { explore: tExplore, optimum: tOpt, toGoal: tGoal, mash: tMash, front: tFront, total: Date.now() - T0 } };
}
module.exports = { analyse, population, solutionSpace };
