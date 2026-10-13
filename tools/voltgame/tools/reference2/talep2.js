'use strict';
// ============================================================================
// PARALAKS: TEK HAT — talep2.js (kural sürümü 4) : optimizasyon talepleri (§24.6) ve Tek Hat yerleşim lint'i (§24.2)
// Kural motoruna dokunmaz: yalnız sim2 + solve2.explore grafiği üzerinde kısıtlı sözlüksel Dijkstra.
//
// Tek (kanonik) talep şeması — seviye alanı `talep`:
//   { id, ad, aciklama?, kisit: { kesintiMax?, manevraMax?, hamleMax?, kesintisiz?:[yükId],
//                                 yasak?:[elId], agirlik?:{yükId:w} },
//     metrik?: 'hamle'|'manevra'|'kesinti'  (küçültülen birincil ölçüt; varsayılan hamle),
//     opt: [h,m,k,o], agirlikliKesinti?, cozum: 'Manevra Defteri dizgisi' }
//   Sıralama sözlükseldir: (agirlikliKesinti, birincil, Hamle, Manevra, Kesinti, Olay). (kural sürümü 4: döndürme yok; donmeMax yok sayılır)
// Eski biçim (`talepler: [{id, ad|metin, kisit:{k|kesinti|h|m}, enAz, deger}]`) normalize() ile okunur.
//   solve(L, Gr, t)  -> {tot:[h,m,k,o], kw, r, path} | null
//   normalize(lv)    -> kanonik talep dizisi (opt/cozum olmayabilir: eski biçim)
//   check(lv, Gr?)   -> hata listesi (kısıtlı optimum == beyan, çözüm yeniden oynatılınca kazanır ve kısıtı sağlar)
//   sldLint(lv)      -> hata listesi (her düğüm/eleman yerleşik, çakışma yok, yön geçerli)
// ============================================================================
const S = require('./sim2.js'), V = require('./solve2.js');
const { H, M, K, O, Rr } = V;
const MET = { hamle: 1, h: 1, manevra: 2, m: 2, kesinti: 3, k: 3 };

function constraintErrors(L, t) {
  const bad = [], k = t.kisit || {};
  for (const f of ['kesintiMax', 'manevraMax', 'hamleMax']) if (k[f] !== undefined && k[f] !== null && (!Number.isFinite(k[f]) || k[f] < 0)) bad.push(`${f} negatif olmayan bir sayı olmalı`);
  for (const id of k.kesintisiz || []) { const e = L.els && L.els[L.elIndex[id]]; if (!e || e.li === undefined) bad.push(`kesintisiz yük ${id} yok`); }
  for (const [id, w] of Object.entries(k.agirlik || {})) {
    const e = L.els && L.els[L.elIndex[id]];
    if (!e || e.li === undefined) bad.push(`ağırlıklı yük ${id} yok`);
    if (!Number.isFinite(w) || w < 0) bad.push(`yük ${id} ağırlığı negatif olmayan bir sayı olmalı`);
  }
  return bad;
}

function solve(L, Gr, t) {
  if (constraintErrors(L, t).length || Gr.unknown) return null;
  const kisit = t.kisit || {};
  const yasak = new Set(kisit.yasak || []);
  const tokBad = tok => { const m = /^[okafbs]:(.+)$/.exec(tok); return !!(m && yasak.has(m[1])); };
  let lm = 0; for (const id of kisit.kesintisiz || []) { const ix = L.elIndex[id]; if (ix === undefined) return null; lm |= 1 << L.els[ix].li; }
  const fedOk = i => { if (!lm) return true; const E = S.stateE(L, S.unkey(L, Gr.keys[i])); return (E.loadMask & lm) === lm; };
  if (!fedOk(0)) return null;
  const okCache = new Int8Array(Gr.n); const ok = i => { if (!okCache[i]) okCache[i] = fedOk(i) ? 1 : 2; return okCache[i] === 1; };
  const lim = v => (v === undefined || v === null ? Infinity : v);
  const KM = lim(kisit.kesintiMax), MM = lim(kisit.manevraMax), HM = lim(kisit.hamleMax), RM = Infinity;
  const W = kisit.agirlik ? L.loads.map(l => kisit.agirlik[L.els[l.el].id] || 0) : null;
  const kw = (c, to) => { if (!W || !H(c)) return 0; const E = S.stateE(L, S.unkey(L, Gr.keys[to])); let k = 0; W.forEach((w, i) => { if (!((E.loadMask >> i) & 1)) k += w; }); return k; };
  const prim = MET[t.metrik || 'hamle'] || 1;
  // d = [kw, h, m, k, o, r]; öncelik anahtarı = [kw, d[prim], h, m, k, o, r]
  const pri = d => [d[0], d[prim], d[1], d[2], d[3], d[4], d[5]];
  const less = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  // Yalnız sınırlı kaynakları etikete kat: sınırsız birincil maliyet aynı duruma dönen
  // her çevrimde yeni etiket üretirse çözümsüz bir talep hiçbir zaman sona ermez.
  const key = (u, d) => u + ':' + (KM < Infinity ? d[3] : '') + ':' + (MM < Infinity ? d[2] : '') + ':' + (HM < Infinity ? d[1] : '') + ':' + (RM < Infinity ? d[5] : '');
  const heap = [];
  const push = x => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i].p, heap[p].p)) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && less(heap[c + 1].p, heap[c].p)) c++; if (!less(heap[c].p, heap[i].p)) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return top; };
  const lab = new Map();
  const d0 = [0, 0, 0, 0, 0, 0]; const st0 = { u: 0, d: d0, p: pri(d0), prev: null, tok: null };
  lab.set(key(0, d0), st0); push(st0);
  while (heap.length) {
    const x = pop(); if (lab.get(key(x.u, x.d)) !== x) continue;
    if (Gr.won[x.u]) { const path = []; let y = x; while (y.prev) { path.push(y.tok); y = y.prev; } path.reverse(); return { tot: [x.d[1], x.d[2], x.d[3], x.d[4]], kw: x.d[0], r: x.d[5], path: path.join(' ') }; }
    for (let e = Gr.off[x.u]; e < Gr.off[x.u + 1]; e++) {
      const to = Gr.to[e], c = Gr.cost[e], tok = Gr.tok[e]; if (tokBad(tok) || !ok(to)) continue;
      const d = [x.d[0] + kw(c, to), x.d[1] + H(c), x.d[2] + M(c), x.d[3] + K(c), x.d[4] + O(c), x.d[5] + Rr(c)];
      if (d[3] > KM || d[2] > MM || d[1] > HM || d[5] > RM) continue;
      const k = key(to, d); const old = lab.get(k); const p = pri(d);
      if (!old || less(p, old.p)) { const y = { u: to, d, p, prev: x, tok }; lab.set(k, y); push(y); }
    }
  }
  return null;
}

// eski biçimi kanoniğe çevir (opt/cozum yoksa check() hesaplar ve `deger` ile karşılaştırır)
function normalize(lv) {
  const out = [];
  for (const t of lv.talep || []) out.push(t);
  for (const t of lv.talepler || []) {
    const k = t.kisit || {}; const kisit = {};
    if (k.k !== undefined) kisit.kesintiMax = k.k; if (k.kesinti !== undefined) kisit.kesintiMax = k.kesinti;
    if (k.m !== undefined) kisit.manevraMax = k.m; if (k.manevra !== undefined) kisit.manevraMax = k.manevra;
    if (k.h !== undefined) kisit.hamleMax = k.h; if (k.hamle !== undefined) kisit.hamleMax = k.hamle;
    for (const f of ['kesintisiz', 'yasak', 'agirlik', 'kesintiMax', 'manevraMax', 'hamleMax', 'donmeMax']) if (k[f] !== undefined) kisit[f] = k[f];
    const metrik = { h: 'hamle', hamle: 'hamle', m: 'manevra', manevra: 'manevra', k: 'kesinti', kesinti: 'kesinti' }[t.enAz || 'h'] || 'hamle';
    const o = { id: t.id, ad: t.ad || t.metin, kisit };
    if (t.ad && t.metin) o.aciklama = t.metin; if (metrik !== 'hamle') o.metrik = metrik;
    if (t.deger !== undefined) o._deger = t.deger;
    out.push(o);
  }
  return out;
}

function satisfies(L, t, str) {
  const kisit = t.kisit || {}; const bad = constraintErrors(L, t);
  if (bad.length) return { bad, tot: [0, 0, 0, 0], kw: 0 };
  const yasak = new Set(kisit.yasak || []);
  let lm = 0; for (const id of kisit.kesintisiz || []) lm |= 1 << L.els[L.elIndex[id]].li;
  let s = S.initState(L); const tot = { h: 0, m: 0, k: 0, o: 0 }; let kw = 0;
  if (lm && (S.stateE(L, s).loadMask & lm) !== lm) bad.push('kesintisiz yük başlangıçta beslenmiyor');
  for (const tok of String(str || '').split(/\s+/).filter(Boolean)) {
    const m = /^[okafbs]:(.+)$/.exec(tok); if (m && yasak.has(m[1])) bad.push(`yasak ${m[1]} kullanıldı`);
    const a = S.decodeAct(L, s, tok); if (!a) { bad.push(`çözüm ${tok} çözülemedi`); break; }
    const r = S.apply(L, s, a); if (r.err) { bad.push(`çözüm ${tok}: ${r.err}`); break; }
    tot.h += r.c.h; tot.m += r.c.m; tot.k += r.c.k; tot.o += r.c.o;
    s = r.s; const E = S.stateE(L, s);
    if (lm && (E.loadMask & lm) !== lm) bad.push('kesintisiz yük düştü');
    if (r.c.h && kisit.agirlik) L.loads.forEach((l, i) => { if (!((E.loadMask >> i) & 1)) kw += kisit.agirlik[L.els[l.el].id] || 0; });
  }
  if (!S.won(L, s)) bad.push('çözüm kazanmıyor');
  if (kisit.kesintiMax !== undefined && tot.k > kisit.kesintiMax) bad.push(`Kesinti ${tot.k} > ${kisit.kesintiMax}`);
  if (kisit.manevraMax !== undefined && tot.m > kisit.manevraMax) bad.push(`Manevra ${tot.m} > ${kisit.manevraMax}`);
  if (kisit.hamleMax !== undefined && tot.h > kisit.hamleMax) bad.push(`Hamle ${tot.h} > ${kisit.hamleMax}`);
  return { bad: [...new Set(bad)], tot: [tot.h, tot.m, tot.k, tot.o], kw };
}

function check(lv, Gr) {
  const list = normalize(lv); if (!list.length) return [];
  const bad = []; const L = Gr ? Gr.L : S.compile(lv.def); Gr = Gr || V.explore(L, 2e6);
  if (Gr.unknown) return ['talep doğrulaması: durum sınırı aşıldı'];
  const ids = new Set();
  for (const t of list) {
    if (!t.id) bad.push('talep kimliksiz'); else if (ids.has(t.id)) bad.push(`talep ${t.id} kimliği tekrar`); ids.add(t.id);
    if (!t.ad) bad.push(`talep ${t.id}: ad yok`);
    const ce = constraintErrors(L, t); if (ce.length) { for (const x of ce) bad.push(`talep ${t.id}: ${x}`); continue; }
    const r = solve(L, Gr, t);
    if (!r) { bad.push(`talep ${t.id}: kısıtla çözüm yok`); continue; }
    if (t._deger !== undefined) { const ix = MET[t.metrik || 'hamle'] - 1; if (r.tot[ix] !== t._deger) bad.push(`talep ${t.id}: kısıtlı optimum ${r.tot[ix]} != beyan ${t._deger}`); continue; }
    if (!t.opt) { bad.push(`talep ${t.id}: opt yok`); continue; }
    if (JSON.stringify(t.opt) !== JSON.stringify(r.tot)) bad.push(`talep ${t.id}: kısıtlı optimum ${JSON.stringify(r.tot)} != beyan ${JSON.stringify(t.opt)}`);
    if (t.agirlikliKesinti !== undefined && t.agirlikliKesinti !== r.kw) bad.push(`talep ${t.id}: ağırlıklı kesinti ${r.kw} != beyan ${t.agirlikliKesinti}`);
    if (t.cozum !== undefined) { const sa = satisfies(L, t, t.cozum); for (const x of sa.bad) bad.push(`talep ${t.id}: ${x}`); if (!sa.bad.length && JSON.stringify(sa.tot) !== JSON.stringify(t.opt)) bad.push(`talep ${t.id}: çözüm toplamı ${sa.tot} != opt ${t.opt}`); if (!sa.bad.length && sa.kw !== r.kw) bad.push(`talep ${t.id}: çözüm ağırlıklı kesinti ${sa.kw} != optimum ${r.kw}`); }
    else bad.push(`talep ${t.id}: cozum yok`);
  }
  return bad;
}

// kanonik talebi hesapla (stamp/dönüştürme için)
function stampOne(L, Gr, t) {
  const r = solve(L, Gr, t); if (!r) return null;
  const o = {}; for (const k of Object.keys(t)) if (k !== '_deger') o[k] = t[k];
  o.opt = r.tot; if (t.kisit && t.kisit.agirlik) o.agirlikliKesinti = r.kw; o.cozum = r.path; return o;
}

const DIR1 = ['u', 'd', 'l', 'r'], DIR2 = ['u', 'd', 'l', 'r', 'h', 'v'];
function sldLint(lv) {
  const bad = []; const sld = lv.sld; if (!sld || !sld.node || !sld.el) return ['sld yok'];
  const elIds = new Set(lv.def.el.map(e => e.id));
  const used = new Map();
  const cellsOf = p => { const out = [[p[0], p[1]]]; if (p.length >= 3 && Number.isInteger(p[2])) for (let c = Math.min(p[0], p[2]) + 1; c <= Math.max(p[0], p[2]); c++) out.push([c, p[1]]); return out; };
  const put = (what, p, multi) => {
    if (!Array.isArray(p) || p.length < 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) { bad.push(`${what} konumu geçersiz`); return; }
    for (const c of multi ? cellsOf(p) : [[p[0], p[1]]]) { const k = c[0] + ',' + c[1]; if (used.has(k)) bad.push(`${what} ${used.get(k)} ile çakışıyor (${k})`); else used.set(k, what); }
  };
  for (const n of Object.keys(lv.def.dugum)) { if (!sld.node[n]) bad.push(`düğüm ${n} yerleşmemiş`); else put('düğüm ' + n, sld.node[n], true); }
  for (const e of lv.def.el) {
    const p = sld.el[e.id];
    if (!p) { if (e.t === 'bara' || e.t === 'kapi') continue; bad.push(`eleman ${e.id} yerleşmemiş`); continue; }
    if (e.t === 'bara' || e.t === 'kapi') continue;        // kapı elektrik elemanı değil; bara konumu yalnız bilgi amaçlı (düğümle aynı hücre olabilir)
    put('eleman ' + e.id, p, false);
    const two = e.a !== undefined && e.b !== undefined;
    if (!(two ? DIR2 : DIR1).includes(p[2])) bad.push(`eleman ${e.id} yönü geçersiz: ${p[2]}`);
  }
  for (const k of Object.keys(sld.node)) if (!lv.def.dugum[k]) bad.push(`sld fazladan düğüm ${k}`);
  for (const k of Object.keys(sld.el)) {
    const base = k.replace(/\.bobin$/, '');
    if (!elIds.has(base)) bad.push(`sld fazladan eleman ${k}`);
    else if (k !== base) put('bobin ' + k, sld.el[k], false);
  }
  return bad;
}

module.exports = { solve, normalize, check, stampOne, satisfies, sldLint };
