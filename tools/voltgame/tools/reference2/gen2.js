'use strict';
// ============================================================================
// PARALAKS: TEK HAT — gen2.js (kural sürümü 4: FİZİKSEL DÜNYA) : şablon başına saha tepe tırmanışı (hill-climb)
//   node gen2.js <şablon>[@saha] <tohum> <saniye> [çıktı.json] [tohumSeviyeDosyası#id]   (ör. muhurleme@kosk)
// Elektrik şeması şablondan gelir (templates2.js + templates/*.js). Üretici yalnız SAHAYI arar (site2.js biçimi):
//   sütun yükseklikleri h[x,z] (0..MAXH), duvar sütunları (%), ekipman sütunları, MERDİVENLER (yön: yukarı çıkış),
//   İSKELELER (el merdiveni, duvar tepesine), kapılar (şablonda 'kapi' elemanı varsa), başlangıç ve iş karoları.
// Saha arketipi (şablon alanı `saha`) ilk sahayı kurar; tırmanış onu bozmadan geliştirir:
//   'duz'      düz zemin (varsayılan)
//   'asma_kat' zemin + bir kenarda asma kat (pano odası, h+1) + merdiven
//   'galeri'   arka sıralarda OG hücre galerisi (h+1) + merdiven; ön tarafta avlu
//   'kosk'     köşede trafo köşkü (h+2) + çatıya iskele
//   'kanal'    yüksek döşeme + kablo kanalı (h−1) + iki uçta basamak
// Amaç fonksiyonu "içgörü yoğunluğu": cihaz işlemleri ödüllenir, yürüyüş payı cezalanır, kullanılan merdiven/iskele
// (çok katlı saha) ödüllenir; §6.1 bant ihlalleri (bands2.js), essential ablasyonları, K7/K9 lint'i ve FİZİKSEL KAPILAR
// (lint2.physical: yol yok asla, her cihaz/karo erişilir, merdivenler gerekli, tuzak yok) büyük cezadır.
// (Kural sürümü 3'ün pxc/needPairs/needAdj/forbidPairs/forbidStart alanları YOK SAYILIR ve uyarı basılır.)
// ============================================================================
const S = require('./sim2.js'), V = require('./solve2.js'), B = require('./bands2.js'), LN = require('./lint2.js'), ST = require('./site2.js');
const fs = require('fs'), path = require('path');
const LEGACY_KEYS = ['pxc', 'needPairs', 'needAdj', 'forbidPairs', 'forbidStart'];
const ABL = ['noAyiriciKurali', 'noZones', 'noLoto', 'noBackfeed', 'noProtection', 'noSync', 'noCapLock', 'noDoors'];   // verify2.ABL ile aynı
// Şablonlar: templates2.js + tools/reference2/templates/*.js (bölüm tasarımcılarının kendi dosyaları; her biri
// { şablonAdı: {...} } nesnesi dışa aktarır). Aynı ad iki dosyada varsa sonra yüklenen kazanır ve uyarı basılır.
function loadTemplates() {
  const T = Object.assign({}, require('./templates2.js')); const src = {}; for (const k in T) src[k] = 'templates2.js';
  const dir = path.join(__dirname, 'templates');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => /.js$/.test(f)).sort()) {
    let m; try { m = require(path.join(dir, f)); } catch (e) { console.warn(`gen2: templates/${f} yüklenemedi: ${e.message}`); continue; }
    for (const k of Object.keys(m)) { if (T[k]) console.warn(`gen2: şablon '${k}' (${f}) ${src[k]} içindeki tanımı geçersiz kılıyor`); T[k] = m[k]; src[k] = 'templates/' + f; }
  }
  return T;
}
const TPL = loadTemplates();
const DIRS = ST.DIRS;

function doorIds(t) { return (t.base.el || []).filter(e => e.t === 'kapi').map(e => e.id); }
function toDef(t, rep, id) {
  const doors = {}; for (const d of doorIds(t)) if (rep.doors && rep.doors[d] !== undefined) doors[d] = rep.doors[d];
  const b = ST.build(rep, t.cells, doors);
  return Object.assign(JSON.parse(JSON.stringify(t.base)), { id: id || 'GEN', map: b.map, hucre: b.hucre });
}
// eski seviye geometrisinden tohum: elemanlar tip + sıra ile eşlenir (site2.parse)
function fromDef(t, od) {
  const r0 = ST.parse(od); if (r0.W !== t.W || r0.D !== t.D) return null;
  const TA = { yuk_ayirici: 'ayirici' }; const ord = (els) => { const c = {}; const m = {}; for (const e of els) { const ty = TA[e.t] || e.t; c[ty] = (c[ty] || 0) + 1; m[e.id] = ty + '#' + c[ty]; } return m; };
  const om = ord(od.el.filter(e => r0.eq[e.id] !== undefined)), nm = ord(t.base.el.filter(e => t.cells.includes(e.id))); const inv = {}; for (const id in nm) inv[nm[id]] = id;
  const rep = { W: t.W, D: t.D, h: r0.h.slice(), duvar: r0.duvar.slice(), eq: {}, st: Object.assign({}, r0.st), ld: Object.assign({}, r0.ld), doors: {}, start: r0.start, work: t.work ? r0.work : -1 };
  for (const id in r0.eq) { const nid = inv[om[id]]; if (nid && t.cells.includes(nid)) rep.eq[nid] = r0.eq[id]; }
  const used = new Set(Object.values(rep.eq).concat([rep.start, rep.work]));
  for (const id of t.cells) if (rep.eq[id] === undefined) { const c = [...Array(t.W * t.D).keys()].find(q => rep.h[q] > 0 && !used.has(q)); if (c === undefined) return null; rep.eq[id] = c; used.add(c); }
  if (rep.start < 0 || (t.work && rep.work < 0)) return null;
  return rep;
}
function pathStats(p, par) {
  const walks = p.filter(x => x[0] === 'g').length; const ops = p.length - walks;
  return { walks, ops, walk: par > 0 ? walks / par : 1 };
}
// tam değerlendirme (gen ve verify ortak ölçüleri)
function measure(def, t, CAP, opts) {
  opts = opts || {};
  const L = S.compile(def); const Gr = V.explore(L, CAP); if (Gr.unknown) return null;
  const oh = V.optimum(Gr, 'hamle'); if (!oh) return null;
  const om = V.optimum(Gr, 'manevra'), ok = V.optimum(Gr, 'kesinti');
  const par = oh.tot.h; const ps = pathStats(oh.path.split(' '), par);
  const elec = new Set(); for (let i = 0; i < Gr.n; i++) elec.add(S.elecKey(L, S.unkey(L, Gr.keys[i])));
  const mash = V.mash(Gr, 6 * par + 20, opts.runs || 400, 4242);
  const vecs = new Set([oh, om, ok].map(o => [o.tot.h, o.tot.m, o.tot.k, o.tot.o].join(',')));
  return { L, Gr, oh, om, ok, par, ps, elec: elec.size, mash, vecs: vecs.size, states: Gr.n };
}
const WHY = {}; const why = k => { WHY[k] = (WHY[k] || 0) + 1; return null; };

function run(name, seed, secs, out, seedDef) {
  const [tname, sahaOv] = String(name).split('@');   // 'şablon@kosk' -> saha arketipini geçersiz kıl
  const t0p = TPL[tname]; if (!t0p) throw new Error('şablon yok: ' + tname + ' (bilinen: ' + Object.keys(TPL).join(', ') + ')');
  const t = sahaOv ? Object.assign({}, t0p, { saha: sahaOv }) : t0p;
  for (const k of LEGACY_KEYS) if (t[k] !== undefined) console.warn(`gen2: şablon '${name}' alanı '${k}' kural sürümü 4'te yok sayılıyor (izdüşüm kaldırıldı)`);
  if ((t.base.el || []).some(e => e.t === 'kafa')) throw new Error(`şablon '${name}': 'kafa' (izdüşüm seçicisi) elemanı var — kural sürümü 4'te gerçek kesici/ayırıcı/yük ayırıcısına çevirin`);
  const rnd = V.mulberry(seed), ri = n => Math.floor(rnd() * n);
  const { W, D, MAXH } = t; const N = W * D; const band = B.BANDS[t.sinif]; const DOORS = doorIds(t);
  const X = c => c % W, Z = c => Math.floor(c / W), at = (x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? -1 : x + W * z;
  const nbr = c => { const o = []; for (const [dx, dz] of DIRS) { const q = at(X(c) + dx, Z(c) + dz); if (q >= 0) o.push(q); } return o; };
  const step = (c, d, k) => at(X(c) + k * DIRS[d][0], Z(c) + k * DIRS[d][1]);
  // ---- sahanın tutarlılığı: geçersiz merdiven/iskele/kapı düşürülür; kullanılmış sütunlar çakışmaz ----
  function occ(rep) { const m = new Map(); for (const id in rep.eq) m.set(rep.eq[id], 'e'); for (const id in rep.doors || {}) m.set(rep.doors[id], 'k'); for (const c in rep.st) m.set(+c, 's'); return m; }
  function normalize(rep) {
    const h = rep.h; const o0 = occ(rep);
    const plainTop = c => c >= 0 && h[c] >= 1 && !rep.duvar[c] && !o0.has(c) && rep.ld[c] === undefined;   // üstü boş karo sütunu
    for (const c of Object.keys(rep.st).map(Number)) { const d = rep.st[c]; const lo = step(c, d, -1), hi = step(c, d, 1);
      const ok = lo >= 0 && hi >= 0 && h[c] >= 1 && h[lo] === h[c] && h[hi] === h[c] + 1 && !rep.duvar[c] && h[c] < MAXH && rep.ld[c] === undefined &&
        plainTop(lo) && plainTop(hi) && !Object.values(rep.eq).includes(c);
      if (!ok) delete rep.st[c]; }
    for (const c of Object.keys(rep.ld).map(Number)) { const d = rep.ld[c]; const w = step(c, d, 1);
      let ok = w >= 0 && h[c] >= 1 && h[w] > h[c] && h[w] - h[c] <= 2 && !rep.duvar[c] && !rep.duvar[w] && rep.st[c] === undefined && !o0.has(c) && !o0.has(w) && rep.ld[w] === undefined;
      if (ok) for (let d2 = 0; d2 < 4; d2++) { if (d2 === d) continue; const q = step(c, d2, 1); if (q >= 0 && h[q] >= h[w] && h[q] > h[c]) ok = false; }   // tek duvar: yön belirsiz olmasın
      if (!ok) delete rep.ld[c]; }
    const o = occ(rep); const bad = c => c < 0 || h[c] < 1 || rep.duvar[c] || rep.st[c] !== undefined || (o.has(c) && o.get(c) !== 'e' && o.get(c) !== 'k');
    for (const id in rep.eq) if (h[rep.eq[id]] < 1 || rep.duvar[rep.eq[id]] || rep.st[rep.eq[id]] !== undefined || rep.ld[rep.eq[id]] !== undefined) return false;
    for (const id in rep.doors || {}) { const c = rep.doors[id]; if (bad(c) || rep.ld[c] !== undefined) return false; }
    if (bad(rep.start) || o.has(rep.start)) return false;
    if (rep.work >= 0 && (bad(rep.work) || o.has(rep.work) || rep.work === rep.start)) return false;
    const cols = new Set(); for (const id in rep.eq) { if (cols.has(rep.eq[id])) return false; cols.add(rep.eq[id]); }
    for (const id in rep.doors || {}) { if (cols.has(rep.doors[id])) return false; cols.add(rep.doors[id]); }
    return true;
  }
  function clone(r) { return { W, D, h: r.h.slice(), duvar: r.duvar.slice(), eq: Object.assign({}, r.eq), doors: Object.assign({}, r.doors), st: Object.assign({}, r.st), ld: Object.assign({}, r.ld), start: r.start, work: r.work }; }
  // ---- arketip ----
  function archetype() {
    const h = new Array(N).fill(1), duvar = new Array(N).fill(false), st = {}, ld = {};
    const kind = t.saha || 'duz';
    if (kind === 'asma_kat' || kind === 'galeri') {
      const side = ri(4); const depth = kind === 'galeri' ? Math.max(2, Math.floor(D / 3)) : Math.max(2, Math.floor((side < 2 ? W : D) / 3));
      for (let c = 0; c < N; c++) { const x = X(c), z = Z(c); const inMz = side === 0 ? x < depth : side === 1 ? x >= W - depth : side === 2 ? z < depth : z >= D - depth;
        if (inMz && (kind === 'galeri' || (side < 2 ? (z >= 1 && z <= D - 2) : (x >= 1 && x <= W - 2)))) h[c] = 2; }
      // merdiven: asma kat kenarına, zeminden yukarı
      for (let k = 0; k < 40; k++) { const c = ri(N); const d = ri(4); const lo = step(c, d, -1), hi = step(c, d, 1); if (lo >= 0 && hi >= 0 && h[c] === 1 && h[lo] === 1 && h[hi] === 2) { st[c] = d; break; } }
    } else if (kind === 'kosk') {
      const kw = 2 + ri(2), kd = 2; const x0 = rnd() < 0.5 ? 0 : W - kw, z0 = rnd() < 0.5 ? 0 : D - kd;
      for (let x = x0; x < x0 + kw; x++) for (let z = z0; z < z0 + kd; z++) h[at(x, z)] = 3;
      for (let k = 0; k < 60; k++) { const c = ri(N); const d = ri(4); const w = step(c, d, 1); if (w >= 0 && h[c] === 1 && h[w] === 3) { ld[c] = d; break; } }
    } else if (kind === 'kanal') {
      for (let c = 0; c < N; c++) h[c] = 2;
      // kablo kanalı: bir satır/sütunun iç kısmı (uçlardan 2 hücre içeride) bir alçakta; iki uçta kanal boyunca
      // dışarı doğru çıkan basamak (merdiven hücresi kanalın ilk hücresi, üst sahanlık kanal ucundaki döşeme)
      const horiz = rnd() < 0.5; const len = horiz ? W : D; const line = 1 + ri((horiz ? D : W) - 2);
      const cell = i => horiz ? at(i, line) : at(line, i);
      for (let i = 1; i <= len - 2; i++) h[cell(i)] = 1;
      st[cell(1)] = horiz ? 1 : 3;                                   // kanal başı: cell(2) kanal -> cell(1) basamak -> cell(0) döşeme
      if (len >= 7) st[cell(len - 2)] = horiz ? 0 : 2;              // kanal sonu (uzun kanalda ikinci basamak)
    }
    return { h, duvar, st, ld };
  }
  let nRand = 0;
  function randRep() {
    nRand++;
    const a = archetype(); const h = a.h;
    if (nRand > 2000 && rnd() < 0.3) for (let i = 0; i < 3; i++) { const c = ri(N); h[c] = Math.max(1, Math.min(MAXH, h[c] + (rnd() < 0.5 ? 1 : -1))); }
    const free = [...Array(N).keys()].filter(c => a.st[c] === undefined && a.ld[c] === undefined);
    for (let i = free.length - 1; i > 0; i--) { const j = ri(i + 1); [free[i], free[j]] = [free[j], free[i]]; }
    const eq = {}; let q = 0; for (const id of t.cells) eq[id] = free[q++];
    const doors = {}; for (const id of DOORS) doors[id] = free[q++];
    const rest = free.slice(q); if (rest.length < 2) return null;
    const rep = { W, D, h, duvar: a.duvar, eq, doors, st: a.st, ld: a.ld, start: rest[0], work: t.work ? rest[1] : -1 };
    return normalize(rep) ? rep : null;
  }
  function mutate(r) {
    const m = clone(r); const k = ri(100);
    const ids = t.cells.concat(DOORS); const colOf = id => m.eq[id] !== undefined ? m.eq[id] : m.doors[id];
    const setCol = (id, c) => { if (m.eq[id] !== undefined) m.eq[id] = c; else m.doors[id] = c; };
    if (k < 26) { const i = ri(N); let nh = m.h[i] + (rnd() < 0.5 ? 1 : -1); if (rnd() < 0.15) nh = 1 + ri(MAXH); m.h[i] = Math.max(0, Math.min(MAXH, nh)); }
    else if (k < 44) { const id = ids[ri(ids.length)]; const c0 = colOf(id); const ns = nbr(c0); const c = rnd() < 0.6 ? ns[ri(ns.length)] : ri(N); setCol(id, c); }
    else if (k < 50) { const a = ids[ri(ids.length)], b = ids[ri(ids.length)]; const ca = colOf(a), cb = colOf(b); setCol(a, cb); setCol(b, ca); }
    else if (k < 58) { const ns = nbr(m.start); m.start = rnd() < 0.6 ? ns[ri(ns.length)] : ri(N); }
    else if (k < 64) { if (m.work < 0) return null; const ns = nbr(m.work); m.work = rnd() < 0.6 ? ns[ri(ns.length)] : ri(N); }
    else if (k < 74) { for (let j = 0; j < 30; j++) { const c = ri(N), d = ri(4); const lo = step(c, d, -1), hi = step(c, d, 1); if (lo >= 0 && hi >= 0 && m.h[c] >= 1 && m.h[lo] === m.h[c] && m.h[hi] === m.h[c] + 1) { m.st[c] = d; break; } } }
    else if (k < 79) { const ks = Object.keys(m.st).concat(Object.keys(m.ld).map(x => 'L' + x)); if (!ks.length) return null; const x = ks[ri(ks.length)]; if (x[0] === 'L') delete m.ld[+x.slice(1)]; else delete m.st[+x]; }
    else if (k < 86) { for (let j = 0; j < 30; j++) { const c = ri(N), d = ri(4); const w = step(c, d, 1); if (w >= 0 && m.h[c] >= 1 && m.h[w] > m.h[c] && m.h[w] - m.h[c] <= 2) { m.ld[c] = d; break; } } }
    else if (k < 92) { const c = ri(N); m.duvar[c] = !m.duvar[c]; if (m.duvar[c] && m.h[c] < MAXH && rnd() < 0.7) m.h[c]++; }
    else { const x0 = ri(W - 1), z0 = ri(D - 1); const dh = rnd() < 0.5 ? 1 : -1; for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const c = at(x0 + dx, z0 + dz); m.h[c] = Math.max(1, Math.min(MAXH, m.h[c] + dh)); } }
    return normalize(m) ? m : null;
  }
  const CAP = band.states;
  function evalRep(rep, full) {
    let L, r, def;
    try { def = toDef(t, rep); L = S.compile(def); const s0 = S.initState(L); if (!S.passable(L, S.stateE(L, s0), s0.b, s0.st, s0.ch, s0.p, s0.lk)) return why('startzone');
      if (!LN.realism(L).ok) return why('realism');
      if (L.work >= 0 && !L.hazards[L.tileIdx[L.work]].some(h => h.bara >= 0 && L.zone.indexOf(h.node) >= 0)) return why('worktile'); // iş karosu bölge barasının yanında
      // hızlı fiziksel kapılar: her karo ve her cihazın yaklaşma karosu başlangıçla fiziksel olarak bağlı
      for (let ti = 0; ti < L.tiles.length; ti++) if (!L.phys[ti]) return why('kopukKaro');
      for (const e of L.els) if (e.cell >= 0 && L.approach[e.i] && (e.t === 'kesici' || e.t === 'ayirici' || e.t === 'yuk_ayirici' || e.t === 'toprak' || e.t === 'sigorta' || e.t === 'buton') && !L.approach[e.i].length) return why('yaklasma');
      for (const d of L.doors) if (!d.nInner) return why('kapiIslevsiz');
      r = V.solve(L, { cap: CAP }); } catch (e) { return why('exc:' + String(e.message).replace(/^[^:]*: /, '').slice(0, 40)); }
    if (r.par < 1) return why(r.unknown ? 'cap' : 'unsolv');
    const ps = pathStats(r.path, r.par);
    let pen = 0; if (r.par < band.par[0]) pen += 3 * (band.par[0] - r.par); if (r.par > band.par[1]) pen += 2 * (r.par - band.par[1]);
    pen += 25 * Math.max(0, ps.walk - Math.min(0.5, band.walk));
    let score = 3 * ps.ops + (t.hard ? 0.5 * r.par : 0) + 1.5 * Math.log(r.states) - pen;
    const e = { par: r.par, states: r.states, ...ps, path: r.path.join(' '), score, abl: {} };
    if (!full) return e;
    if (!LN.margin(L).ok) return why('margin');
    for (const f of t.essential) {
      const [fl, met] = f.split(':');
      let v0, v1;
      try { if (met === 'kesinti') { const G0 = V.explore(L, CAP), G1 = V.explore(S.compile(def, { [fl]: true }), CAP); const k0 = V.optimum(G0, 'kesinti'), k1 = V.optimum(G1, 'kesinti'); v0 = k0 ? k0.tot.k * 1000 + k0.tot.h : -1; v1 = k1 ? k1.tot.k * 1000 + k1.tot.h : -1; }
        else { v0 = r.par; v1 = V.solve(S.compile(def, { [fl]: true }), { cap: CAP, path: false }).par; } } catch (x) { v0 = 0; v1 = -2; }
      e.abl[f] = v1; const ch = v1 < 0 ? 4 : Math.min(4, Math.abs(v0 - v1) > 0 ? Math.max(1, Math.min(4, Math.abs(v0 - v1) % 1000 || 1)) : 0);
      if (ch === 0) e.score -= 20; else e.score += ch;
    }
    const mm = measure(def, t, CAP, { runs: 300 }); if (!mm) return null;
    // esaslı mekanik sayısı (alt sınır): Hamle-opt'u değiştiren standart ablasyonlar + şablonun ':kesinti' girişleri
    let essN = 0; for (const f of ABL) { if (t.essential.indexOf(f + ':kesinti') >= 0 && e.abl[f + ':kesinti'] !== undefined) { essN++; continue; }
      let v; try { v = e.abl[f] !== undefined ? e.abl[f] : V.solve(S.compile(def, { [f]: true }), { cap: CAP, path: false }).par; } catch (x) { v = -1; } if (v !== r.par) essN++; }
    const viol = B.check(t.sinif, { par: mm.par, man: mm.om.tot.m, manK: mm.ok.tot.m, elec: mm.elec, states: mm.states, mash: mm.mash, walk: mm.ps.walk, ess: essN, multi: mm.vecs >= 2, free: 99 });
    const golden = [mm.oh.path, mm.om.path, mm.ok.path];
    const ph = LN.physical(mm.L, mm.Gr, golden, def);
    e.band = viol; e.fizik = ph.bad.map(x => x.split(':')[0].slice(0, 40)); e.mash = mm.mash; e.elec = mm.elec; e.vecs = mm.vecs; e.kes = [mm.ok.tot.h, mm.ok.tot.m, mm.ok.tot.k];
    e.merdiven = ph.info.kullanilan;
    e.score -= 10 * viol.length + 15 * ph.bad.length; if (t.hard && mm.vecs >= 2) e.score += 4;
    if ((t.saha || 'duz') !== 'duz') e.score += ph.info.kullanilan ? Math.min(2, ph.info.kullanilan) * 2 : -6;   // çok katlı saha gerçekten kullanılmalı
    if (t.zeroKesinti) e.score += mm.ok.tot.k === 0 ? 10 : -10;
    e.score -= 40 * Math.max(0, mm.mash - band.mash);
    return e;
  }
  const t0 = Date.now(); let cur = null, ce = null, stall = 0, tries = 0, restarts = 0;
  const sr = seedDef ? fromDef(t, seedDef) : null;
  if (seedDef && !sr) console.log('  tohum dönüştürülemedi');
  if (sr) { for (let k = 0; k < 4000 && !ce && Date.now() - t0 < secs * 500; k++) { let r = clone(sr); for (let j = 0; j < Math.min(6, Math.floor(k / 50)); j++) { const m = mutate(r); if (m) r = m; } if (!normalize(r)) continue; const e = evalRep(r, true); tries++; if (e) { cur = r; ce = e; } }
    console.log('  tohum ' + (ce ? 'geçerli, skor ' + ce.score.toFixed(1) : 'geçersiz')); }
  const pool = [];
  while (Date.now() - t0 < secs * 1000) {
    if (!cur || stall > (t.hard ? 200 : 350) * (sr ? 3 : 1)) {
      if (ce) pool.push({ rep: cur, e: ce }); cur = null; ce = null; restarts++;
      for (let k = 0; k < 20000 && !ce && Date.now() - t0 < secs * 1000; k++) { let r = randRep(); if (sr && rnd() < 0.7) { r = clone(sr); for (let j = 0; j < 1 + ri(8); j++) { const m = mutate(r); if (m) r = m; } } tries++; if (!r) continue; const e = evalRep(r, true); if (e) { cur = r; ce = e; } }
      stall = 0; if (!ce) continue;
    }
    const m = mutate(cur); stall++; if (!m) continue;
    const quick = evalRep(m, false); if (!quick) continue;
    if (quick.score + 30 < ce.score) continue;
    const e = evalRep(m, true); if (!e) continue;
    if (e.score >= ce.score) { if (e.score > ce.score) stall = 0; cur = m; ce = e; }
  }
  if (ce) pool.push({ rep: cur, e: ce });
  pool.sort((a, b) => b.e.score - a.e.score);
  const res = pool.slice(0, 4).map(p => ({ name, seed, e: p.e, def: toDef(t, p.rep, name.toUpperCase()) }));
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  for (const r of res) console.log(`${name} s${seed} score ${r.e.score.toFixed(1)} par ${r.e.par} ops ${r.e.ops} walks ${r.e.walks} states ${r.e.states} elec ${r.e.elec} mash ${(100 * r.e.mash).toFixed(1)}% vecs ${r.e.vecs} kes ${JSON.stringify(r.e.kes)} merdiven ${r.e.merdiven} band ${JSON.stringify(r.e.band)} fizik ${JSON.stringify(r.e.fizik)} abl ${JSON.stringify(r.e.abl)}\n${ST.ascii(r.def)}`);
  console.log(`  tries ${tries} restarts ${restarts} red ${JSON.stringify(WHY)}`);
  return res;
}
module.exports = { run, toDef, fromDef, measure, pathStats, loadTemplates, TPL };
if (require.main === module) { const sd = process.argv[6] ? (() => { const [f, id] = process.argv[6].split('#'); const arr = f.endsWith('.json') ? JSON.parse(fs.readFileSync(f, 'utf8')) : require(path.resolve(f)); const x = arr.find(l => l.id === id) || arr[+id]; return x.def || x; })() : null;
  run(process.argv[2], +(process.argv[3] || 1), +(process.argv[4] || 30), process.argv[5], sd); }
