// ============================================================================
// core/worker_src.js — Worker gövdesi (§12.8, §5.6, §23.3-6)                       sahip: Kurallar
// Build bu dosyayı JSON dizgisi olarak PX.WORKER_SRC'ye gömer; ÖNÜNE manifest.worker.lib listesindeki
// modülleri CommonJS kabuğuyla ekler (yalnız sim2.js gerekir; solve2.js kullanılmaz). DOM yok, THREE yok, PX yok.
// Node'da da çalışır (birim testi): postMessage/onmessage kabuğu test tarafından verilir.
//
// Keşif: BFS, AÇIK ADRESLİ tipli hash (Float64 anahtar, doğrusal yoklama; Map yok), CSR kenarları
//        (Int32 to / cost / act; eylem dizgi olarak SAKLANMAZ — act = tip | param<<4, simge istenince üretilir).
//        Kenar kümesi solve2.explore ile birebir aynıdır (birim testi). Hızlı yürüyüş: bir durumdaki ilk 'git'
//        tam sim2.apply ile, diğerleri ondan türetilir (sim2'de git = finish(E0→E0): yalnız p değişir).
// Tablolar (ters grafta, kazanma durumlarından): her metrik için sözlüksel iki düzeyli mesafe
//        hamle (Hamle, sonra Manevra) · manevra (Manevra, Hamle) · kesinti (Kesinti, Hamle) · olay (Olay, Hamle)
//        Skaler ağırlık w = birincil·2^21 + ikincil: basit yollarda ikincil toplam < durum sayısı < 2^21 olduğundan
//        skaler sıra = sözlüksel sıra (tam; taşma yok, en büyük değer < 2^53). Kural sürümü 4: döndürme/izdüşüm yok.
//        Hamle tablosu ayrıca Uint8 (255 = çıkmaz, 254'te kırpılır) — lamba.
// İŞBİRLİKLİ DİLİMLEME: her iş (keşif + tablolar) ≤ SLICE ms'lik dilimlerle ilerler; dilimler arasında yeni mesajlar
//        işlenir. Başka bir seviye için 'load' gelirse süren iş anında bırakılır (eski istek {code:'iptal'} ile yanıtlanır):
//        Worker sonlandırılmaz, JIT sıcak kalır (soğuk Worker headless Chrome'da 3–10× yavaş ölçüldü).
// Sınırlar (§12.8, §17): en çok 400 000 durum, 6 000 000 kenar; aşılırsa {t:'error', code:'sinir'}.
// Önbellek: en çok 3 seviye grafı (LRU) — önceden hesaplama (sonraki seviye) ve geri dönüş için.
//
// Mesajlar (istek her zaman {req} taşır; yanıt aynı req ile döner):
//   ← {t:'load', req, id, gen, def}          → {t:'ready', req, id, gen, states, edges, goals, dead, cached, ms:{compile,explore,tables,total,slices},
//                                               cap, hk:Float64Array, hv:Int32Array, dH:Uint8Array,
//                                               tab:{hamle:[prim:Uint16Array, sec:Uint16Array], manevra:…, kesinti:…, olay:…}}
//                                            | {t:'error', req, id, gen, code:'sinir'|'derleme'|'iptal'|'hata', msg}
//   ← {t:'use', req, id, def}                → {t:'used', req, id, rebuilt, ok}  (graf önbellekte yoksa yeniden kurar)
//   ← {t:'hint', req, id, key, metric, tier, max?} → {t:'hint', req, id, key, metric, tier, dead, miss, acts:[simge], plan:[simge], val:[p,s]}
//   ← {t:'drop', req, id?}                   → {t:'dropped', req}          (id yoksa tüm önbellek)
//   ← {t:'ping', req}                        → {t:'pong', req, busy}
// ============================================================================
const S = require('./sim2.js');

const CAP_STATES = 400000, CAP_EDGES = 6000000, LRU = 3, SLICE = 12;
const SCALE = 2097152;                                   // 2^21
const METRICS = ['hamle', 'manevra', 'kesinti', 'olay'];
const ACT_T = ['git', 'op', 'kilit', 'kilitac', 'degistir', 'bas', 'set', 'calis', 'bekle'];   // kural sürümü 4 (dondur/izdusum yok)
const ACT_I = {}; ACT_T.forEach((t, i) => { ACT_I[t] = i; });
const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
const epoch = () => (typeof performance !== 'undefined' && performance.timeOrigin) ? performance.timeOrigin + performance.now() : Date.now();   // iş parçacıkları arası saat

// maliyet paketi = solve2.pack ile aynı: h bit0 | m bit1 | (bit2 ayrılmış, hep 0) | o (0..31) bit3-7 | k bit8+
function pack(c) { return c.h | (c.m << 1) | (c.o << 3) | (c.k << 8); }
// metrik ağırlığı (skaler, sözlüksel)
function weight(mi, c) {
  const h = c & 1, m = (c >> 1) & 1;
  switch (mi) {
    case 0: return h * SCALE + m;                        // hamle  (h, m)
    case 1: return m * SCALE + h;                        // manevra(m, h)
    case 2: return (c >>> 8) * SCALE + h;                // kesinti(k, h)
    default: return ((c >> 3) & 31) * SCALE + h;         // olay   (o, h)
  }
}
// hash: 0 ≤ k < 2^53 tamsayı -> yuva (istemcide aynı işlev)
function hslot(k, mask) {
  const lo = k % 4294967296, hi = (k - lo) / 4294967296;
  let h = Math.imul(lo | 0, 0x9E3779B1) ^ Math.imul((hi | 0) + 0x632BE5AB, 0x85EBCA77);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
  return h & mask;
}
function actCode(L, a) {
  const t = ACT_I[a.t]; let p = 0;
  if (a.t === 'git') p = L.tileIdx[a.to]; else if (a.e !== undefined) p = a.e;
  return t | (p << 4);
}
function actOf(L, code) {
  const t = ACT_T[code & 15], p = code >> 4;
  if (t === 'git') return { t, to: L.tiles[p] };
  if (t === 'calis' || t === 'bekle') return { t };
  return { t, e: p };
}
const tokOf = (L, code) => S.encodeAct(L, null, actOf(L, code));
const isNav = code => (code & 15) === 0;               // git (kural sürümü 4: tek gezinme eylemi)
function grow(a, need, Ctor) { let n = a.length; while (n < need) n *= 2; const b = new Ctor(n); b.set(a); return b; }
function fail(code, msg) { const e = new Error(msg); e.code = code; return e; }

// ---------------------------------------------------------------- keşif (sürdürülebilir)
function exploreInit(L) {
  const X = { L, capS: 1024, capE: 8192, n: 0, m: 0, i: 0, hcap: 4096 };
  X.keys = new Float64Array(X.capS); X.won = new Uint8Array(X.capS); X.off = new Int32Array(X.capS + 1);
  X.to = new Int32Array(X.capE); X.cost = new Int32Array(X.capE); X.act = new Int32Array(X.capE);
  X.mask = X.hcap - 1; X.hk = new Float64Array(X.hcap).fill(-1); X.hv = new Int32Array(X.hcap);
  add(X, S.key(L, S.initState(L)));
  return X;
}
function rehash(X) {
  const ncap = X.hcap * 2, nm = ncap - 1, nk = new Float64Array(ncap).fill(-1), nv = new Int32Array(ncap);
  for (let i = 0; i < X.n; i++) { let h = hslot(X.keys[i], nm); while (nk[h] !== -1) h = (h + 1) & nm; nk[h] = X.keys[i]; nv[h] = i; }
  X.hk = nk; X.hv = nv; X.hcap = ncap; X.mask = nm;
}
function add(X, k) {
  let h = hslot(k, X.mask); const hk = X.hk;
  for (;;) { const x = hk[h]; if (x === -1) break; if (x === k) return X.hv[h]; h = (h + 1) & X.mask; }
  if (X.n + 1 >= X.capS) { X.capS *= 2; X.keys = grow(X.keys, X.capS, Float64Array); X.won = grow(X.won, X.capS, Uint8Array); X.off = grow(X.off, X.capS + 1, Int32Array); }
  const n = X.n; X.keys[n] = k; hk[h] = k; X.hv[h] = n; X.n = n + 1;
  if (X.n * 2 > X.hcap) rehash(X);
  return n;
}
function pushEdge(X, t, c, a) {
  if (X.m >= X.capE) {
    if (X.capE >= CAP_EDGES) throw fail('sinir', 'kenar sınırı aşıldı (' + X.m + ')');
    X.capE *= 2; X.to = grow(X.to, X.capE, Int32Array); X.cost = grow(X.cost, X.capE, Int32Array); X.act = grow(X.act, X.capE, Int32Array);
  }
  X.to[X.m] = t; X.cost[X.m] = c; X.act[X.m] = a; X.m++;
}
// deadline'a kadar durum genişletir; bitince true
function exploreStep(X, deadline) {
  const L = X.L;
  while (X.i < X.n) {
    if (X.n > CAP_STATES) throw fail('sinir', 'durum sınırı aşıldı (' + X.n + ' durum)');
    if ((X.i & 63) === 0 && now() > deadline) return false;
    const i = X.i++;
    X.off[i] = X.m;
    const s = S.unkey(L, X.keys[i]);
    if (S.won(L, s)) { X.won[i] = 1; continue; }
    const cands = S.candidates(L, s);
    let wTpl = null, wCost = 0, wDead = false, E0 = null;
    for (let j = 0; j < cands.length; j++) {
      const a = cands[j]; let ns, c;
      if (a.t === 'git' && wTpl) {
        // Hızlı yürüyüş: sim2'de 'git' = finish(E0 -> E0); ch/k/b/st hedeften bağımsız, yalnız p ve hedefin
        // geçilebilirliği değişir. (Eşdeğerlik: tools/test/unit/rules_worker.js — kenarlar solve2.explore ile birebir.)
        if (!S.passable(L, E0, wTpl.b, wTpl.st, wTpl.ch, a.to, wTpl.lk)) continue;
        ns = { p: a.to, b: wTpl.b, lk: wTpl.lk, sp: wTpl.sp, st: wTpl.st, ch: wTpl.ch, w: wTpl.w }; c = wCost;
      } else if (a.t === 'git' && wDead) continue;
      else {
        const r = S.apply(L, s, a);
        if (a.t === 'git') { if (!r.err) { wTpl = r.s; wCost = pack(r.c); E0 = S.stateE(L, s); } else if (r.err === 'kond') wDead = true; }
        if (r.err) continue;
        ns = r.s; c = pack(r.c);
      }
      pushEdge(X, add(X, S.key(L, ns)), c, actCode(L, a));
    }
  }
  X.off[X.n] = X.m;
  return true;
}
function exploreAll(L) { const X = exploreInit(L); exploreStep(X, Infinity); return X; }

// ---------------------------------------------------------------- ters CSR + tablolar
function reverse(G) {
  const n = G.n, m = G.m, rOff = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) rOff[G.to[e] + 1]++;
  for (let i = 0; i < n; i++) rOff[i + 1] += rOff[i];
  const rFrom = new Int32Array(m), rCost = new Int32Array(m), fill = rOff.slice(0, n);
  for (let u = 0; u < n; u++) for (let e = G.off[u], e1 = G.off[u + 1]; e < e1; e++) { const j = fill[G.to[e]]++; rFrom[j] = u; rCost[j] = G.cost[e]; }
  return { rOff, rFrom, rCost };
}
// ikili yığın (öncelik Float64, değer Int32), tembel silme; tamponlar metrikler arasında paylaşılır
function lexTable(G, R, mi, hp, hv) {
  const n = G.n, D = new Float64Array(n).fill(Infinity);
  let size = 0;
  const push = (p, v) => {
    let i = size++;
    while (i > 0) { const q = (i - 1) >> 1; if (hp[q] <= p) break; hp[i] = hp[q]; hv[i] = hv[q]; i = q; }
    hp[i] = p; hv[i] = v;
  };
  for (let i = 0; i < n; i++) if (G.won[i]) { D[i] = 0; push(0, i); }
  const { rOff, rFrom, rCost } = R;
  while (size > 0) {
    const p = hp[0], u = hv[0];
    const lp = hp[--size], lv = hv[size];
    if (size > 0) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= size) break; if (c + 1 < size && hp[c + 1] < hp[c]) c++; if (hp[c] >= lp) break; hp[i] = hp[c]; hv[i] = hv[c]; i = c; }
      hp[i] = lp; hv[i] = lv;
    }
    if (p > D[u]) continue;
    for (let j = rOff[u], j1 = rOff[u + 1]; j < j1; j++) {
      const q = rFrom[j], nd = p + weight(mi, rCost[j]);
      if (nd < D[q]) { D[q] = nd; push(nd, q); }
    }
  }
  return D;
}
function finishTables(G) {
  const n = G.n, dH = new Uint8Array(n), DH = G.D[0]; let dead = 0, goals = 0;
  for (let i = 0; i < n; i++) { const d = DH[i]; if (d === Infinity) { dH[i] = 255; dead++; } else dH[i] = Math.min(254, Math.floor(d / SCALE)); if (G.won[i]) goals++; }
  G.dH = dH; G.dead = dead; G.goals = goals;
}
function tables(G) {
  const R = reverse(G); const cap = G.m + G.n + 1, hp = new Float64Array(cap), hv = new Int32Array(cap);
  G.D = METRICS.map((_, mi) => lexTable(G, R, mi, hp, hv));
  finishTables(G);
}
function exportTab(D) {
  const n = D.length, pr = new Uint16Array(n), se = new Uint16Array(n);
  for (let i = 0; i < n; i++) { const d = D[i]; if (d === Infinity) { pr[i] = 65535; se[i] = 65535; continue; } const p = Math.floor(d / SCALE); pr[i] = Math.min(65534, p); se[i] = Math.min(65534, d - p * SCALE); }
  return [pr, se];
}
function lookup(G, k) {
  let h = hslot(k, G.mask);
  for (;;) { const x = G.hk[h]; if (x === -1) return -1; if (x === k) return G.hv[h]; h = (h + 1) & G.mask; }
}

// ---------------------------------------------------------------- graf önbelleği
const cache = new Map();                                // id -> G (LRU: Map ekleme sırası)
function remember(id, G) { cache.delete(id); cache.set(id, G); while (cache.size > LRU) cache.delete(cache.keys().next().value); }
function defKey(def) { try { return JSON.stringify(def); } catch (e) { return String(Math.random()); } }
function cachedFor(id, dk) { const G = cache.get(id); return G && G.defKey === dk ? G : null; }
// eşzamanlı tam kurulum (birim testi ve iç kullanım)
function build(id, def) {
  const t0 = now(); let L;
  try { L = S.compile(def); } catch (e) { throw fail('derleme', String(e && e.message || e)); }
  const t1 = now(); const X = exploreAll(L); const t2 = now();
  const G = { id, L, def, defKey: defKey(def), n: X.n, m: X.m, keys: X.keys, won: X.won, off: X.off, to: X.to, cost: X.cost, act: X.act, hk: X.hk, hv: X.hv, mask: X.mask };
  tables(G); const t3 = now();
  G.ms = { compile: t1 - t0, explore: t2 - t1, tables: t3 - t2, total: t3 - t0, slices: 1 };
  remember(id, G); return G;
}

// ---------------------------------------------------------------- iş (dilimli)
let job = null;
// tarayıcı: MessageChannel (setTimeout kıskacı yok; gelen mesajlar dilimler arasında FIFO işlenir); Node testi: setImmediate
const chan = typeof setImmediate !== 'function' && typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
if (chan) chan.port1.onmessage = pump;
function schedule() { if (chan) chan.port2.postMessage(0); else if (typeof setImmediate === 'function') setImmediate(pump); else setTimeout(pump, 0); }
function startJob(kind, m) {
  const dk = defKey(m.def);
  const G = cachedFor(m.id, dk);
  if (G) { remember(m.id, G); respond(kind, m, G, true); return; }
  if (job && job.id === m.id && job.dk === dk) { job.waiters.push({ kind, m }); return; }
  if (job) abortJob('yeni seviye');
  job = { id: m.id, def: m.def, dk, waiters: [{ kind, m }], phase: 0, t0: now(), e0: epoch(), work: 0, slices: 0, ms: {} };
  schedule();
}
function abortJob(why) {
  const J = job; job = null;
  for (const w of J.waiters) post({ t: 'error', req: w.m.req, id: J.id, gen: w.m.gen, code: 'iptal', msg: 'iptal: ' + why });
}
function pump() {
  const J = job; if (!J) return;
  const t0 = now(), deadline = t0 + SLICE;
  try {
    if (J.phase === 0) {                                                  // derleme
      try { J.L = S.compile(J.def); } catch (e) { throw fail('derleme', String(e && e.message || e)); }
      J.X = exploreInit(J.L); J.ms.compile = now() - t0; J.ms.explore = 0; J.phase = 1;
    }
    if (J.phase === 1) {                                                  // keşif
      const s0 = now(); const done = exploreStep(J.X, deadline); J.ms.explore += now() - s0;
      if (done) {
        const X = J.X;
        J.G = { id: J.id, L: J.L, def: J.def, defKey: J.dk, n: X.n, m: X.m, keys: X.keys, won: X.won, off: X.off, to: X.to, cost: X.cost, act: X.act, hk: X.hk, hv: X.hv, mask: X.mask, D: [] };
        J.X = null; J.phase = 2; J.ms.tables = 0;
      }
    }
    if (J.phase === 2 && now() < deadline) {                              // tablolar: metrik başına bir dilim
      const s0 = now(); const G = J.G;
      if (!J.R) { J.R = reverse(G); const cap = G.m + G.n + 1; J.hp = new Float64Array(cap); J.hq = new Int32Array(cap); }
      while (G.D.length < METRICS.length) { G.D.push(lexTable(G, J.R, G.D.length, J.hp, J.hq)); if (now() > deadline) break; }
      J.ms.tables += now() - s0;
      if (G.D.length === METRICS.length) { finishTables(G); J.R = J.hp = J.hq = null; J.phase = 3; }
    }
  } catch (err) {
    job = null;
    for (const w of J.waiters) post({ t: 'error', req: w.m.req, id: J.id, gen: w.m.gen, code: err.code || 'hata', msg: String(err && err.message || err) });
    return;
  }
  J.work += now() - t0; J.slices++;
  if (J.phase === 3) {
    job = null; const G = J.G;
    G.ms = { compile: J.ms.compile, explore: J.ms.explore, tables: J.ms.tables, total: J.work, wall: now() - J.t0, slices: J.slices, start: J.e0 };
    remember(J.id, G);
    for (const w of J.waiters) respond(w.kind, w.m, G, false);
    return;
  }
  if (job === J) schedule();
}
function respond(kind, m, G, cached) {
  if (kind === 'use') { post({ t: 'used', req: m.req, id: m.id, rebuilt: !cached, ok: true }); return; }
  const hk = G.hk.slice(0), hv = G.hv.slice(0), dH = G.dH.slice(0);
  const tab = {}; const tr = [hk.buffer, hv.buffer, dH.buffer];
  METRICS.forEach((name, mi) => { const t = exportTab(G.D[mi]); tab[name] = t; tr.push(t[0].buffer, t[1].buffer); });
  post({ t: 'ready', req: m.req, id: m.id, gen: m.gen, states: G.n, edges: G.m, goals: G.goals, dead: G.dead, cached,
    ms: cached ? { compile: 0, explore: 0, tables: 0, total: 0, wall: 0, slices: 0 } : G.ms, post: epoch(), cap: G.hk.length, hk, hv, dH, tab }, tr);
}

// ---------------------------------------------------------------- plan çıkarma (ipucu / hayalet)
// Sıkı kenar: D[t] + w(e) == D[u]. Önce pozitif ağırlıklı sıkı kenar (yürüyüş dışı tercih); yalnız 0 ağırlıklı (v3: döndürme;
// kural sürümü 4 normal oyunda 0 ağırlıklı kenar yok, kod genel kalır)
// sıkı kenarlar varsa, sıkı 0-kenarlar üzerinde BFS ile pozitif sıkı kenarı ya da hedefi olan en yakın durum (en az döndürme).
function planFrom(G, u, mi, max) {
  const D = G.D[mi]; if (D[u] === Infinity) return null;
  const out = []; const seen = new Map();
  while (!G.won[u] && out.length < max) {
    let best = -1, bestNav = true;
    for (let e = G.off[u], e1 = G.off[u + 1]; e < e1; e++) {
      const w = weight(mi, G.cost[e]); if (w === 0) continue;
      if (D[G.to[e]] + w !== D[u]) continue;
      const nav = isNav(G.act[e]);
      if (best < 0 || (bestNav && !nav)) { best = e; bestNav = nav; if (!nav) break; }
    }
    if (best >= 0) { out.push(best); u = G.to[best]; continue; }
    seen.clear(); seen.set(u, -1); const q = [u]; let goal = -1;
    for (let i = 0; i < q.length && goal < 0; i++) {
      const x = q[i];
      for (let e = G.off[x], e1 = G.off[x + 1]; e < e1; e++) {
        const t = G.to[e]; if (weight(mi, G.cost[e]) !== 0 || D[t] !== D[u] || seen.has(t)) continue;
        seen.set(t, e); q.push(t);
        let ok = !!G.won[t];
        if (!ok) for (let f = G.off[t], f1 = G.off[t + 1]; f < f1; f++) { const w = weight(mi, G.cost[f]); if (w !== 0 && D[G.to[f]] + w === D[t]) { ok = true; break; } }
        if (ok) { goal = t; break; }
      }
    }
    if (goal < 0) break;                                // olmamalı (D tutarlı)
    const seg = []; for (let x = goal; seen.get(x) !== -1; ) { const e = seen.get(x); seg.push(e); x = edgeFrom(G, e); }
    for (let i = seg.length - 1; i >= 0; i--) out.push(seg[i]);
    u = goal;
  }
  return out;
}
function edgeFrom(G, e) { let lo = 0, hi = G.n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (G.off[mid] <= e) lo = mid; else hi = mid - 1; } return lo; }
function onHint(m) {
  const G = cache.get(m.id);
  const base = { t: 'hint', req: m.req, id: m.id, key: m.key, metric: m.metric, tier: m.tier, dead: false, miss: false, acts: [], plan: [], val: null };
  if (!G) { base.miss = true; post(base); return; }
  const u = lookup(G, m.key);
  if (u < 0) { base.miss = true; post(base); return; }
  const mi = Math.max(0, METRICS.indexOf(m.metric));
  const D = G.D[mi];
  if (D[u] === Infinity) { base.dead = true; post(base); return; }
  const p = Math.floor(D[u] / SCALE); base.val = [p, D[u] - p * SCALE];
  const edges = planFrom(G, u, mi, m.max || 200) || [];
  let seg = -1;
  for (let i = 0; i < edges.length; i++) { const code = G.act[edges[i]]; base.plan.push(tokOf(G.L, code)); if (seg < 0 && !isNav(code)) seg = i; }
  base.acts = base.plan.slice(0, seg < 0 ? base.plan.length : seg + 1);
  post(base);
}

// ---------------------------------------------------------------- mesajlar
function post(msg, tr) { if (tr) postMessage(msg, tr); else postMessage(msg); }
onmessage = function (e) {
  const m = e.data;
  try {
    if (m.t === 'load') startJob('load', m);
    else if (m.t === 'use') { if (m.def) startJob('use', m); else if (cache.has(m.id)) { remember(m.id, cache.get(m.id)); post({ t: 'used', req: m.req, id: m.id, rebuilt: false, ok: true }); } else post({ t: 'used', req: m.req, id: m.id, ok: false }); }
    else if (m.t === 'hint') onHint(m);
    else if (m.t === 'drop') { if (m.id === undefined) cache.clear(); else cache.delete(m.id); post({ t: 'dropped', req: m.req }); }
    else if (m.t === 'ping') post({ t: 'pong', req: m.req, busy: !!job });
    else post({ t: 'error', req: m.req, id: m.id, gen: m.gen, code: 'hata', msg: 'bilinmeyen mesaj ' + m.t });
  } catch (err) {
    post({ t: 'error', req: m.req, id: m.id, gen: m.gen, code: (err && err.code) || 'hata', msg: String(err && err.message || err) });
  }
};
// Node birim testi için iç işlevler (Worker'da `module` yoktur)
if (typeof module !== 'undefined' && module.exports) module.exports = { exploreAll, exploreInit, exploreStep, tables, reverse, lexTable, planFrom, lookup, hslot, actCode, actOf, tokOf, build, cache, METRICS, SCALE, weight, pack, get job() { return job; } };
