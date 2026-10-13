'use strict';
// ============================================================================
// PARALAKS: TEK HAT — sim2.js (kural sürümü 4: FİZİKSEL DÜNYA) : SAF KURALLAR (DOM yok, THREE yok, bağımlılık yok)
// Bu dosya kuralların TEK doğruluk kaynağıdır. Oyun (Worker + controller), build araçları ve doğrulayıcı aynı
// kodu çalıştırır. docs/PARALAKS2_SPEC.md §2 ve §25 bu dosyayı anlatır (sim2 kazanır).
//
//  G  Geometri : FİZİKSEL. Volti yalnız fiziksel olarak bitişik (4 komşu, AYNI yükseklik) karolar arasında yürür.
//               Yükseklik yalnız haritadaki gerçek merdiven (> < ^ v) ve iskele (=) geometrisiyle değişir; merdiven
//               ve iskele adımı sıradan bir yürüyüş adımıdır. Atlama, düşme, ekran teması, dikiş YOK.
//               Kamera (4 izometrik görünüm) YALNIZ GÖRSELDİR: komşuluğu, erişimi, elektriği, yasallığı değiştirmez
//               ve durumda yer almaz. Renderer için saf yardımcı: occluders(L, v, hedefler).
//  E  Elektrik : tek hat düğüm/kenar ağı, galvanik bileşenler, trafo üzerinden iki yönlü enerjilendirme (geri
//               besleme), düğüm analizi (DC eşdeğeri; yük = sabit akım, arıza = toprağa şönt iletkenlik), koruma
//               kademelenmesi, kontaktör sabit noktası, kondansatör yükü. (Kural sürümü 3 ile AYNI.)
//  F  Fiziksel erişim: yaklaşma bölgeleri (R8) ve hücre kapısı kilitlemesi (kapi elemanı) erişimi elektrik
//               durumuna bağlar; erişilemeyen her hedef için explain() engeli ADIYLA söyler.
//  S  Durum    : {p,b,lk,sp,st,ch,w} -> tek sayı anahtar (< 2^53). Görünüm (v) ve izdüşüm kümesi (cs) KALDIRILDI.
//  A  Eylemler : git (dokun-yürü: bir yürüyüş koşusu = 1 komut), op, kilit, kilitac, degistir, bas, set, calis, bekle.
//               ('dondur' ve 'izdusum' kaldırıldı: kamera istemcidedir, izdüşüm seçicisi yoktur.)
// ============================================================================

const RULES_VERSION = 4;
const VIEWS = [[1,1],[-1,1],[-1,-1],[1,-1]];          // YALNIZ GÖRSEL (renderer, occluders)
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];            // fiziksel yatay yönler (dx,dz): 0 +x, 1 −x, 2 +z, 3 −z
const CH = 3;                                         // kondansatör deşarj süresi (Hamle)
const G_SW = 1000;                                    // kapalı anahtarlama elemanı iletkenliği (pu)
const G_KABLO = 200, G_TRAFO = 200;                   // kablo / trafo varsayılan iletkenliği (pu)
const G_ARIZA = 100;                                  // arızanın toprağa şönt iletkenliği: Ik = V·G_ARIZA
const EPS = 1e-7, EPS_I = 1e-6;
const T = { kablo:0, trafo:1, kesici:2, ayirici:3, sigorta:4, kontaktor:5, yardimci:6, buton:7, yuk_ayirici:9 };
const STATION = [0,0,1,1,1,1,1,1,1,1];                // istasyon içi (komütasyon) yolu: anahtarlama elemanları
const SWITCHABLE = { kesici:1, ayirici:1, yuk_ayirici:1, toprak:1, sigorta:1, kontaktor:1 };
// hücre türleri (L.G.kind)
const KIND = { bos:0, blok:1, eleman:2, merdiven:3, iskele:4, duvar:5, kapi:6 };
// merdiven karakterleri: ok YUKARI ÇIKIŞ yönünü gösterir (harita metninde sağ = +x, aşağı satır = +z)
const STAIR = { '>':0, '<':1, 'v':2, '^':3 };
const RESERVED = '.#sw%=><v^|/';
const OPERABLE = { kesici:1, ayirici:1, yuk_ayirici:1, toprak:1, sigorta:1, buton:1, bara:1 };
const ELEMENT_ACTION = { op:1, kilit:1, kilitac:1, degistir:1, bas:1, set:1 };

function parseMap(def) {
  const layers = def.map.split('|').map(l => l.split('/'));
  const H = layers.length, D = layers[0].length, W = layers[0][0].length;
  layers.forEach((l, y) => { if (l.length !== D) throw new Error(`${def.id}: katman ${y} satır sayısı ${l.length} != ${D}`);
    l.forEach((r, z) => { if (r.length !== W) throw new Error(`${def.id}: katman ${y} satır ${z} uzunluğu ${r.length} != ${W}`); }); });
  return { W, H, D, layers };
}

// ---------------------------------------------------------------------------
// DERLEME
// ---------------------------------------------------------------------------
// opt (ablasyon bayrakları): noAyiriciKurali, noZones, noLoto (en kötü durum ayırma + önce-ayır-sonra-toprakla +
//   kilit sırası), noBackfeed, noProtection, noSync, noCapLock, noDoors (kapı kilitlemesi yok), freeWalk (yürüyüş 0 Hamle),
//   drop:[hücre] (bu merdiven/iskele hücreleri boşaltılır — verify2 merdiven gerekliliği kapısı)
function compile(def, opt) {
  opt = opt || {};
  const pm = parseMap(def);
  const { W, H, D } = pm; const N = W * H * D;
  const idx = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) ? -1 : x + W * (y + H * z);
  const xyz = i => [i % W, Math.floor(i / W) % H, Math.floor(i / (W * H))];
  const kind = new Uint8Array(N);
  const cellEl = new Int16Array(N).fill(-1);
  const sdir = new Int8Array(N).fill(-1);
  let start = -1, work = -1;
  const P = s => `${def.id}: ${s}`;
  const elIndex = Object.create(null); (def.el || []).forEach((e, i) => { if (elIndex[e.id] !== undefined) throw new Error(P(`yinelenen eleman ${e.id}`)); elIndex[e.id] = i; });
  const hucre = def.hucre || {};
  for (const ch of Object.keys(hucre)) if (RESERVED.indexOf(ch) >= 0) throw new Error(P(`'${ch}' ayrılmış harita karakteri (merdiven/iskele/duvar), hücre harfi olamaz`));
  for (const e of def.el || []) if (e.t === 'kafa') throw new Error(P(`kural sürümü 4: '${e.id}' izdüşüm seçicisi kafası (kafa) KALDIRILDI — yerine sahada gerçek bir kesici/ayırıcı/yük ayırıcısı koyun (tools/reference2/PHYSICAL_GUIDE.md)`));
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const ch = pm.layers[y][z][x]; const i = idx(x, y, z);
    if (ch === '.') continue;
    if (ch === '#' || ch === 's' || ch === 'w') { kind[i] = KIND.blok; if (ch === 's') { if (start >= 0) throw new Error(P('iki başlangıç (s)')); start = i; } if (ch === 'w') { if (work >= 0) throw new Error(P('iki iş noktası (w)')); work = i; } continue; }
    if (ch === '%') { kind[i] = KIND.duvar; continue; }
    if (ch === '=') { kind[i] = KIND.iskele; continue; }
    if (STAIR[ch] !== undefined) { kind[i] = KIND.merdiven; sdir[i] = STAIR[ch]; continue; }
    const id = hucre[ch]; if (id === undefined || elIndex[id] === undefined) throw new Error(P(`bilinmeyen hücre '${ch}'`));
    const t = def.el[elIndex[id]].t;
    kind[i] = t === 'kapi' ? KIND.kapi : KIND.eleman; cellEl[i] = elIndex[id];
  }
  for (const c of opt.drop || []) if (c >= 0 && c < N && (kind[c] === KIND.merdiven || kind[c] === KIND.iskele)) { kind[c] = KIND.bos; sdir[c] = -1; }
  if (start < 0) throw new Error(P('başlangıç (s) yok'));
  const solid = c => c >= 0 && (kind[c] === KIND.blok || kind[c] === KIND.eleman || kind[c] === KIND.merdiven || kind[c] === KIND.duvar);
  const freeAbove = c => { const [x, y, z] = xyz(c); const u = idx(x, y + 1, z); return u < 0 || kind[u] === KIND.bos || kind[u] === KIND.iskele || kind[u] === KIND.kapi; };
  const isTile = c => c >= 0 && kind[c] === KIND.blok && freeAbove(c);
  const at = (c, dx, dy, dz) => { const [x, y, z] = xyz(c); return idx(x + dx, y + dy, z + dz); };
  const where = c => { const [x, y, z] = xyz(c); return `(x${x} y${y} z${z})`; };
  const G = { W, H, D, N, idx, xyz, kind, sdir, solid, above: c => !freeAbove(c) };

  // ---- karolar ----
  const tiles = []; for (let c = 0; c < N; c++) if (isTile(c)) tiles.push(c);
  const nT = tiles.length;
  const tileIdx = new Int16Array(N).fill(-1); tiles.forEach((c, i) => tileIdx[c] = i);
  if (!isTile(start)) throw new Error(P('başlangıç bloğu üzerine basılamaz (üstü dolu)'));
  if (work >= 0 && !isTile(work)) throw new Error(P('iş noktası bloğu üzerine basılamaz (üstü dolu)'));

  // ---- fiziksel yürüyüş grafı: karo -> {to (karo indeksi), via (geçiş düğümleri), k, cells} ----
  const adj = tiles.map(() => []);
  const transit = []; const transitIdx = new Map();
  const addTransit = c => { let i = transitIdx.get(c); if (i === undefined) { i = nT + transit.length; transit.push(c); transitIdx.set(c, i); } return i; };
  // d: a'dan b'ye yatay hareket yönü (DIRS indeksi; karşıtı d^1) — klavye/ekran yönü eşlemesi için
  const link = (a, b, via, k, cells, d, extra) => {
    adj[tileIdx[a]].push(Object.assign({ to: tileIdx[b], via, k, cells, d }, extra || {}));
    adj[tileIdx[b]].push(Object.assign({ to: tileIdx[a], via: via.slice().reverse(), k, cells: cells.slice().reverse(), d: d ^ 1 }, extra || {}));
  };
  for (const c of tiles) for (const d of [0, 2]) { const q = at(c, DIRS[d][0], 0, DIRS[d][1]); if (isTile(q)) link(c, q, [], 'duz', [], d); }
  const stairs = [], ladders = [];
  for (let c = 0; c < N; c++) if (kind[c] === KIND.merdiven) {
    const [dx, dz] = DIRS[sdir[c]]; const [, y] = xyz(c);
    const below = at(c, 0, -1, 0), lo = at(c, -dx, -1, -dz), hi = at(c, dx, 0, dz), head = at(c, 0, 1, 0);
    if (y < 1 || !(below >= 0 && (kind[below] === KIND.blok || kind[below] === KIND.duvar))) throw new Error(P(`merdiven ${where(c)} havada: altında blok olmalı`));
    if (!isTile(lo)) throw new Error(P(`merdiven ${where(c)}: alt sahanlık yok — ${where(lo >= 0 ? lo : c)} yönünde aynı alt yükseklikte üstü boş bir blok olmalı`));
    if (!isTile(hi)) throw new Error(P(`merdiven ${where(c)}: üst sahanlık yok — çıkış yönünde bir üst yükseklikte üstü boş bir blok olmalı`));
    if (head >= 0 && solid(head)) throw new Error(P(`merdiven ${where(c)}: üstü kapalı (baş boşluğu yok)`));
    link(lo, hi, [addTransit(c)], 'merdiven', [c], sdir[c], { dir: sdir[c] });
    stairs.push({ cell: c, dir: sdir[c], lo, hi });
  }
  for (let c = 0; c < N; c++) if (kind[c] === KIND.iskele && !(at(c, 0, -1, 0) >= 0 && kind[at(c, 0, -1, 0)] === KIND.iskele)) {
    const foot = at(c, 0, -1, 0); const [, y0] = xyz(c);
    if (!(foot >= 0 && kind[foot] === KIND.blok)) throw new Error(P(`iskele ${where(c)}: ayağı zemine oturmalı (altında blok olmalı)`));
    const seg = [c]; let top = c; for (;;) { const u = at(top, 0, 1, 0); if (u >= 0 && kind[u] === KIND.iskele) { seg.push(u); top = u; } else break; }
    const y1 = y0 + seg.length - 1; const cand = [];
    for (let d = 0; d < 4; d++) { const [dx, dz] = DIRS[d]; const land = at(top, dx, 0, dz); if (!isTile(land)) continue;
      let wall = true; for (const s of seg) if (!solid(at(s, dx, 0, dz))) wall = false; if (wall) cand.push([d, land]); }
    if (!cand.length) throw new Error(P(`iskele ${where(c)}..y${y1}: üst sahanlık yok — yanında tepesi y${y1} katmanında, üstü boş bir duvar/blok olmalı`));
    if (cand.length > 1) throw new Error(P(`iskele ${where(c)}: yönü belirsiz (${cand.length} duvar tepesine yaslanıyor); bir tarafı kapatın`));
    const [d, land] = cand[0];
    link(foot, land, seg.slice(1).map(addTransit), 'iskele', seg, d, { dir: d });
    ladders.push({ cells: seg, dir: d, foot, top: land });
  }
  const nodes = nT + transit.length;
  const bodyXYZ = i => { if (i < nT) { const [x, y, z] = xyz(tiles[i]); return [x, y + 1, z]; } return xyz(transit[i - nT]); };

  // ---- statik (fiziksel) erişim: tehlike ve kapılar yok sayılarak başlangıçtan ----
  const bfs = (from, blockedTile) => { const seen = new Uint8Array(nT); if (from === blockedTile) return seen; seen[from] = 1; const q = [from];
    for (let i = 0; i < q.length; i++) for (const e of adj[q[i]]) if (!seen[e.to] && e.to !== blockedTile) { seen[e.to] = 1; q.push(e.to); } return seen; };
  const phys = bfs(tileIdx[start], -1);

  // ---- elektrik ağı ----
  const nodeNames = Object.keys(def.dugum || {});
  const nodeIdx = Object.create(null); nodeNames.forEach((n, i) => nodeIdx[n] = i);
  const nN = nodeNames.length;
  const kv = nodeNames.map(n => def.dugum[n].kv === undefined ? 0.4 : def.dugum[n].kv);
  const nd = n => { if (nodeIdx[n] === undefined) throw new Error(P(`bilinmeyen düğüm ${n}`)); return nodeIdx[n]; };
  const els = (def.el || []).map(e => Object.assign({}, e));
  let nb = 0, np = 0;
  const edges = [];
  const sources = [], loads = [], earths = [], baras = [], caps = [], faults = [], buttons = [], contactors = [], doors = [];
  els.forEach((e, i) => {
    e.i = i; e.cell = -1;
    if (SWITCHABLE[e.t]) { e.bit = nb++; }
    switch (e.t) {
      case 'kaynak': sources.push({ el: i, node: nd(e.dugum), grup: e.grup || 1, acil: !!e.acil }); break;
      case 'yuk': loads.push({ el: i, node: nd(e.dugum), d: e.d || 1, w: e.w === undefined ? 1 : e.w, req: e.zorunlu !== false, p: e.p || 0, q: e.q || 0 }); e.li = loads.length - 1; break;
      case 'toprak': earths.push({ el: i, node: nd(e.dugum), bit: e.bit }); break;
      case 'bara': baras.push({ el: i, node: nd(e.dugum), r: e.r || 1 }); e.bi = baras.length - 1; break;
      case 'kondansator': caps.push({ el: i, node: nd(e.dugum), q: e.q || 1, r: e.r || 1 }); e.ci = caps.length - 1; break;
      case 'ariza': faults.push({ el: i, node: nd(e.dugum) }); break;
      case 'kapi': doors.push({ el: i, earth: -1, lock: -1 }); e.di = doors.length - 1; break;
      case 'kablo': case 'trafo': case 'kesici': case 'ayirici': case 'yuk_ayirici': case 'sigorta': case 'kontaktor': case 'yardimci': case 'buton': {
        const g = e.t === 'kablo' ? (e.g || G_KABLO) : e.t === 'trafo' ? (e.g || G_TRAFO) : G_SW;
        const ed = { t: T[e.t], a: nd(e.a), b: nd(e.b), g, bit: e.bit === undefined ? -1 : e.bit, nc: !!e.nc, I: e.I || 0, kademe: e.kademe || 0, Ikes: e.Ikes || 20, el: i, of: -1, pbit: -1, coil: -1 };
        if (e.t === 'buton') { ed.pbit = np++; buttons.push(i); e.pbit = ed.pbit; }
        if (e.t === 'kontaktor') { ed.coil = nd(e.bobin); contactors.push({ el: i, bit: e.bit, coil: ed.coil }); }
        edges.push(ed); e.ei = edges.length - 1; break; }
      default: throw new Error(P(`bilinmeyen eleman tipi ${e.t}`));
    }
  });
  edges.forEach(ed => { const e = els[ed.el]; if (e.t === 'yardimci') { const o = elIndex[e.ait]; if (o === undefined) throw new Error(P(`${e.id} sahibi yok`)); ed.of = els[o].bit; } });
  for (let c = 0; c < N; c++) if (cellEl[c] >= 0) { const e = els[cellEl[c]]; if (e.cell >= 0) throw new Error(P(`${e.id} iki hücrede`)); e.cell = c; }
  // ekipman havada olamaz; kapı zemine oturur
  for (const e of els) if (e.cell >= 0) { const [, y] = xyz(e.cell); const b = at(e.cell, 0, -1, 0);
    if (e.t === 'kapi') { if (!(b >= 0 && kind[b] === KIND.blok)) throw new Error(P(`kapı ${e.id} ${where(e.cell)} zemine oturmalı`)); }
    else if (y > 0 && !solid(b)) throw new Error(P(`${e.id} ${where(e.cell)} havada: altında blok olmalı`)); }
  baras.forEach(b => { b.cell = els[b.el].cell; });
  caps.forEach(c => { c.cell = els[c.el].cell; });
  const lockable = els.filter(e => e.t === 'ayirici' || e.t === 'yuk_ayirici' || (e.t === 'kesici' && e.cekmeli)).map(e => e.i);
  if (nb > 31 || np > 31 || lockable.length > 31 || loads.length > 31) throw new Error(P('bit maskesi kapasitesi aşıldı: en fazla 31 anahtarlama, buton, kilitlenebilir cihaz ve yük desteklenir'));
  if (loads.some(l => !Number.isInteger(l.w) || l.w < 0) || loads.reduce((n, l) => n + (l.req ? l.w : 0), 0) > 0xffffff) throw new Error(P('Kesinti ağırlıkları negatif olmayan tamsayı olmalı ve toplamı 16777215 sınırını aşmamalı'));
  els.forEach(e => { e.lk = lockable.indexOf(e.i); });
  // kapılar: koşul + iç bölge (kapı kapalıyken başlangıçtan ayrılan karolar)
  const doorAt = new Int16Array(nT).fill(-1);
  doors.forEach((d, di) => {
    const e = els[d.el]; if (e.cell < 0) throw new Error(P(`kapı ${e.id} yerleşmemiş`));
    if (e.toprak !== undefined) { const x = els[elIndex[e.toprak]]; if (!x || x.t !== 'toprak') throw new Error(P(`kapı ${e.id}: toprak '${e.toprak}' bir topraklama ayırıcısı değil`)); d.earth = x.i; }
    if (e.kilitli !== undefined) { const x = els[elIndex[e.kilitli]]; if (!x || x.lk < 0) throw new Error(P(`kapı ${e.id}: kilitli '${e.kilitli}' kilitlenebilir değil`)); d.lock = x.i; }
    if (d.earth < 0 && d.lock < 0) throw new Error(P(`kapı ${e.id}: koşul yok (toprak ya da kilitli)`));
    d.tile = at(e.cell, 0, -1, 0); const ti = tileIdx[d.tile]; doorAt[ti] = di;
    if (d.tile === start) throw new Error(P(`kapı ${e.id} başlangıç karosunda`));
    const wo = bfs(tileIdx[start], ti); d.inner = new Uint8Array(nT); let n = 0;
    for (let t = 0; t < nT; t++) if (phys[t] && !wo[t] && t !== ti) { d.inner[t] = 1; n++; }
    d.nInner = n;
  });

  // ---- sabit (rijit) bileşenler: yalnız kablo ile bağlı düğümler (topraklamanın "sabit bağlantı" testi) ----
  const rp = new Int16Array(nN); for (let i = 0; i < nN; i++) rp[i] = i;
  const rf = x => { while (rp[x] !== x) { rp[x] = rp[rp[x]]; x = rp[x]; } return x; };
  for (const e of edges) if (e.t === T.kablo) { const A = rf(e.a), B = rf(e.b); if (A !== B) rp[A] = B; }
  const rigid = new Int16Array(nN); for (let i = 0; i < nN; i++) rigid[i] = rf(i);

  // ---- tehlike bölgeleri (karo gövdesi ve geçiş hücreleri) ----
  const hazards = new Array(nodes);
  for (let ni = 0; ni < nodes; ni++) {
    const [x, sy, z] = bodyXYZ(ni); const hs = [];
    baras.forEach((b, bi) => { if (b.cell < 0) return; const [bx, by, bz] = xyz(b.cell); if (Math.max(Math.abs(bx - x), Math.abs(by - sy), Math.abs(bz - z)) <= b.r) hs.push({ node: b.node, cap: -1, bara: bi }); });
    caps.forEach((k, ci) => { if (k.cell < 0) return; const [bx, by, bz] = xyz(k.cell); if (Math.max(Math.abs(bx - x), Math.abs(by - sy), Math.abs(bz - z)) <= k.r) hs.push({ node: k.node, cap: ci, bara: -1 }); });
    hazards[ni] = hs;
  }
  // ---- erişim: karonun 4 yatay komşusu, Volti'nin gövde katmanında (y+1) çalıştırılabilir eleman küpü ----
  const reach = new Array(N);
  for (const c of tiles) { const r = [];
    for (const [dx, dz] of DIRS) { const q = at(c, dx, 1, dz); if (q >= 0 && cellEl[q] >= 0 && kind[q] === KIND.eleman && OPERABLE[els[cellEl[q]].t]) r.push(cellEl[q]); }
    reach[c] = r; }
  const approach = els.map(() => []); for (const c of tiles) for (const e of reach[c]) approach[e].push(c);
  const hedef = def.hedef || {};
  let goalMask = 0; (hedef.yukler || loads.filter(l => l.req).map(l => els[l.el].id)).forEach(id => { const e = els[elIndex[id]]; if (!e || e.li === undefined) throw new Error(P(`hedef yük ${id} yok`)); goalMask |= 1 << e.li; });
  const posMask = (ids, want) => { let m = 0, v = 0; (ids || []).forEach(id => { const e = els[elIndex[id]]; if (!e || e.bit === undefined) throw new Error(P(`hedef konum ${id} anahtarlanabilir değil`)); m |= 1 << e.bit; if (want) v |= 1 << e.bit; }); return [m, v]; };
  const [mk, vk] = posMask(hedef.kapali, true), [ma] = posMask(hedef.acik, false);
  let initBits = 0; els.forEach(e => {
    if (e.bit === undefined) return;
    const on = e.t === 'sigorta' ? (e.saglam !== false) : !!e.kapali;
    if (on) initBits |= 1 << e.bit;
  });
  const L = {
    def, opt, id: def.id, G, tiles, tileIdx, walkable: isTile, transit, transitIdx, nodes, adj, stairs, ladders, doors, doorAt, phys, bodyXYZ,
    els, elIndex, nodeNames, nodeIdx, nN, kv, edges, sources, loads, earths, baras, caps, faults, buttons, contactors,
    nb, np, rigid, hazards, reach, approach, lockable, goalMask, initBits, start, work,
    posMask: mk | ma, posVal: vk, gerilimli: (hedef.gerilimli || []).map(nd),
    kilit: def.kilit || 0, yedek: def.yedek || 0, nSet: def.set ? 1 : 0, view0: def.gorunum | 0,
    zone: ((def.is || {}).bolge || []).map(nd), cosphi: hedef.cosphi ? { node: nd(hedef.cosphi.dugum), ind: hedef.cosphi.ind === undefined ? 200 : hedef.cosphi.ind, kap: hedef.cosphi.kap === undefined ? 150 : hedef.cosphi.kap } : null,
    ecache: new Map(), scache: new Map(), icache: new Map(), pcache: new Map(), wcache: new Map(), _tri: [],
  };
  L.R = { p: nT, b: 2 ** nb, lk: 2 ** lockable.length, sp: L.yedek + 1, st: L.nSet ? baras.length + 1 : 1, ch: 4 ** caps.length, w: L.work >= 0 ? 2 : 1 };
  const prod = L.R.p * L.R.b * L.R.lk * L.R.sp * L.R.st * L.R.ch * L.R.w;
  if (prod > 2 ** 52) throw new Error(P('durum uzayı anahtarı 2^52\'yi aşıyor'));
  return L;
}

// ---------------------------------------------------------------------------
// ELEKTRİK DEĞERLENDİRMESİ  E(bits, press, setBara)
// ---------------------------------------------------------------------------
function ekey(L, bits, press, setp) { return (bits * 2 ** L.np + press) * (L.baras.length + 1) + setp; }

function evaluate(L, bits, press, setp) {
  const key = ekey(L, bits, press, setp);
  let E = L.ecache.get(key); if (E) return E;
  const n = L.nN, opt = L.opt;
  const par = new Int16Array(n), sp = new Int16Array(n); for (let i = 0; i < n; i++) { par[i] = i; sp[i] = i; }
  const f = (P, x) => { while (P[x] !== x) { P[x] = P[P[x]]; x = P[x]; } return x; };
  const closed = [];
  for (let i = 0; i < L.edges.length; i++) {
    const e = L.edges[i]; let c;
    switch (e.t) {
      case T.kablo: case T.trafo: c = true; break;
      case T.kesici: case T.ayirici: case T.yuk_ayirici: case T.sigorta: case T.kontaktor: c = ((bits >> e.bit) & 1) === 1; break;
      case T.yardimci: c = (((bits >> e.of) & 1) === 1) !== e.nc; break;
      case T.buton: c = (((press >> e.pbit) & 1) === 1) !== e.nc; break;
    }
    if (c) closed.push({ a: e.a, b: e.b, g: e.g, t: e.t, i });
  }
  for (const e of closed) if (e.t !== T.trafo) { const A = f(par, e.a), B = f(par, e.b); if (A !== B) par[A] = B; }
  for (const e of closed) if (STATION[e.t]) { const A = f(sp, e.a), B = f(sp, e.b); if (A !== B) sp[A] = B; }
  const gal = new Int16Array(n), st = new Int16Array(n); for (let i = 0; i < n; i++) { gal[i] = f(par, i); st[i] = f(sp, i); }
  let fault = null, faultNode = -1;
  const gkv = new Map(); for (let i = 0; i < n; i++) { const g = gal[i]; if (gkv.has(g) && gkv.get(g) !== L.kv[i]) { fault = fault || 'seviye'; faultNode = i; } gkv.set(g, L.kv[i]); }
  const np2 = new Int16Array(n); for (let i = 0; i < n; i++) np2[i] = gal[i];
  for (const e of closed) if (e.t === T.trafo) { const A = f(np2, gal[e.a]), B = f(np2, gal[e.b]); if (A !== B) np2[A] = B; }
  const net = new Int16Array(n); for (let i = 0; i < n; i++) net[i] = f(np2, i);
  if (!opt.noSync) { const grp = new Map(); for (const s of L.sources) { const k = net[s.node]; if (grp.has(k) && grp.get(k) !== s.grup) { fault = fault || 'senkron'; faultNode = s.node; } grp.set(k, s.grup); } }
  const liveG = new Uint8Array(n); const stk = [];
  for (const s of L.sources) { const g = gal[s.node]; if (!liveG[g]) { liveG[g] = 1; stk.push(g); } }
  while (stk.length) { const g = stk.pop();
    for (const e of closed) { if (e.t !== T.trafo) continue; const ga = gal[e.a], gb = gal[e.b];
      if (ga === g && !liveG[gb]) { liveG[gb] = 1; stk.push(gb); }
      if (gb === g && !liveG[ga] && !opt.noBackfeed) { liveG[ga] = 1; stk.push(ga); } } }
  const live = new Uint8Array(n); for (let i = 0; i < n; i++) live[i] = liveG[gal[i]];
  const earthG = new Uint8Array(n);
  for (const e of L.earths) if ((bits >> e.bit) & 1) earthG[gal[e.node]] = 1;
  if (setp > 0) earthG[gal[L.baras[setp - 1].node]] = 1;
  for (let i = 0; i < n; i++) if (live[i] && earthG[gal[i]]) { fault = fault || 'toprak'; faultNode = i; }
  let loadMask = 0; L.loads.forEach((l, i) => { if (live[l.node]) loadMask |= 1 << i; });
  const coil = L.contactors.map(c => live[c.coil] ? 1 : 0);
  let faultLive = false; for (const fl of L.faults) if (live[fl.node]) faultLive = true;
  // düğüm analizi: kaynaklar 1 pu ideal; yükler sabit akım d; arıza toprağa şönt G_ARIZA
  const over = []; const cur = new Float64Array(L.edges.length); const V = new Float64Array(n);
  if (!fault) {
    const isSrc = new Uint8Array(n); for (const s of L.sources) isSrc[s.node] = 1;
    const ui = new Int16Array(n).fill(-1); const unk = [];
    for (let i = 0; i < n; i++) { if (live[i] && !isSrc[i]) { ui[i] = unk.length; unk.push(i); } if (isSrc[i]) V[i] = 1; }
    const m = unk.length;
    if (m > 0) {
      const A = []; for (let r = 0; r < m; r++) A.push(new Float64Array(m + 1));
      for (const e of closed) { if (!live[e.a] || !live[e.b]) continue;
        for (const [p, q] of [[e.a, e.b], [e.b, e.a]]) { if (ui[p] < 0) continue; A[ui[p]][ui[p]] += e.g; if (ui[q] >= 0) A[ui[p]][ui[q]] -= e.g; else A[ui[p]][m] += e.g * V[q]; } }
      for (const l of L.loads) if (ui[l.node] >= 0) A[ui[l.node]][m] -= l.d;
      for (const fl of L.faults) if (ui[fl.node] >= 0) A[ui[fl.node]][ui[fl.node]] += G_ARIZA;
      for (let c = 0; c < m; c++) {
        let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        if (p !== c) { const tmp = A[c]; A[c] = A[p]; A[p] = tmp; }
        const d = A[c][c]; if (Math.abs(d) < 1e-12) throw new Error(`${L.id}: tekil düğüm matrisi`);
        for (let r = 0; r < m; r++) { if (r === c) continue; const k = A[r][c] / d; if (k) for (let cc = c; cc <= m; cc++) A[r][cc] -= k * A[c][cc]; }
      }
      for (let c = 0; c < m; c++) V[unk[c]] = A[c][m] / A[c][c];
    }
    for (const e of closed) { if (!live[e.a]) continue; cur[e.i] = Math.abs(V[e.a] - V[e.b]) * e.g; }
    if (!opt.noProtection) L.edges.forEach((e, i) => { if ((e.t === T.kesici || e.t === T.sigorta) && e.I > 0 && cur[i] > e.I + EPS) over.push(i); });
  }
  E = { key, fault, faultNode, gal, st, live, earthG, loadMask, coil, over, cur, V, faultLive };
  L.ecache.set(key, E); return E;
}

// Yerleşme (settle): kontaktör sabit noktası + koruma kademelenmesi.
function settle(L, bits, press, setp) {
  const key = ekey(L, bits, press, setp);
  let R = L.scache.get(key); if (R) return R;
  let olay = 0, cc = 0, b = bits; const trips = [];
  for (let it = 0; it < 40; it++) {
    const E = evaluate(L, b, press, setp);
    if (E.fault) { R = { fault: E.fault, faultNode: E.faultNode }; break; }
    let nb = b; L.contactors.forEach((c, i) => { if (E.coil[i]) nb |= 1 << c.bit; else nb &= ~(1 << c.bit); });
    if (nb !== b) { b = nb; if (++cc > 8) { R = { fault: 'cirpma' }; break; } continue; }
    if (E.over.length) {
      let mg = Infinity; for (const i of E.over) mg = Math.min(mg, L.edges[i].kademe);
      for (const i of E.over) if (L.edges[i].kademe === mg) { b &= ~(1 << L.edges[i].bit); olay++; trips.push(L.edges[i].el); }
      continue;
    }
    if (E.faultLive && !L.opt.noProtection) { R = { fault: 'koruma_yok' }; break; }
    R = { bits: b, olay, trips, E }; break;
  }
  if (!R) R = { fault: 'cirpma' };
  L.scache.set(key, R); return R;
}

// ---------------------------------------------------------------------------
// DURUM
// ---------------------------------------------------------------------------
function initState(L) {
  const R = settle(L, L.initBits, 0, 0);
  if (R.fault) throw new Error(`${L.id}: başlangıç durumu arızalı (${R.fault})`);
  if (R.olay) throw new Error(`${L.id}: başlangıçta koruma açıyor`);
  let ch = 0; L.caps.forEach((c, i) => { const q = R.E.live[c.node] ? CH : Math.min(CH, L.els[c.el].sarj | 0); ch += q * 4 ** i; });
  if (L.opt.noCapLock) ch = 0;
  return { p: L.start, b: R.bits, lk: 0, sp: L.yedek, st: 0, ch, w: 0 };
}
function key(L, s) {
  const R = L.R;
  return ((((((L.tileIdx[s.p] * R.b + s.b) * R.lk + s.lk) * R.sp + s.sp) * R.st + s.st) * R.ch + s.ch) * R.w + s.w);
}
function unkey(L, k) {
  const R = L.R; const s = {};
  s.w = k % R.w; k = (k - s.w) / R.w; s.ch = k % R.ch; k = (k - s.ch) / R.ch; s.st = k % R.st; k = (k - s.st) / R.st;
  s.sp = k % R.sp; k = (k - s.sp) / R.sp; s.lk = k % R.lk; k = (k - s.lk) / R.lk; s.b = k % R.b; k = (k - s.b) / R.b;
  s.p = L.tiles[k]; return s;
}
// elektrik yapılandırması (konum hariç) anahtarı — "elektrik yapılandırması sayısı" ölçüsü
function elecKey(L, s) { const R = L.R; return (((((s.b * R.lk + s.lk) * R.sp + s.sp) * R.st + s.st) * R.ch + s.ch) * R.w + s.w); }
const charge = (s, i) => Math.floor(s.ch / 4 ** i) % 4;
function stateE(L, s) { return evaluate(L, s.b, 0, s.st); }
function chargedGal(L, E, ch) { const set = new Set(); if (L.opt.noCapLock) return set; L.caps.forEach((c, i) => { if (Math.floor(ch / 4 ** i) % 4 > 0) set.add(E.gal[c.node]); }); return set; }
// uygulanmış topraklamalar (topraklama ayırıcıları + taşınabilir takım): düğüm listesi
function appliedEarths(L, b, st) { const o = []; for (const e of L.earths) if ((b >> e.bit) & 1) o.push(e.node); if (st > 0) o.push(L.baras[st - 1].node); return o; }
// sabit topraklı: düğümün rijit (yalnız kablo) bileşeninde uygulanmış bir topraklama var
function rigidEarthed(L, b, st, node) { for (const m of appliedEarths(L, b, st)) if (L.rigid[m] === L.rigid[node]) return true; return false; }

// EN KÖTÜ DURUM AYIRMA: kilitsiz HER anahtarlama elemanı (kesici, ayırıcı, yük ayırıcısı, sigorta, kontaktör, buton)
// kapalı varsayılır; trafolar iki yönlü. Döner: kaynaktan erişilebilen düğümler (Uint8Array). Yalnız kilit bitlerine bağlıdır.
function wcReach(L, lk) {
  let seen = L.icache.get(lk); if (seen) return seen;
  const n = L.nN; const adj = Array.from({ length: n }, () => []);
  for (const e of L.edges) {
    if (e.t === T.kesici || e.t === T.ayirici || e.t === T.yuk_ayirici) { const el = L.els[e.el]; if (el.lk >= 0 && ((lk >> el.lk) & 1)) continue; }
    adj[e.a].push(e.b); if (!(e.t === T.trafo && L.opt.noBackfeed)) adj[e.b].push(e.a);
  }
  seen = new Uint8Array(n); const st = L.sources.map(x => x.node); st.forEach(x => seen[x] = 1);
  while (st.length) { const x = st.pop(); for (const y of adj[x]) if (!seen[y]) { seen[y] = 1; st.push(y); } }
  L.icache.set(lk, seen); return seen;
}
function isolatedWC(L, lk, nodes) { if (L.opt.noLoto) return true; const r = wcReach(L, lk); for (const z of nodes) if (r[z]) return false; return true; }

// ---------------------------------------------------------------------------
// FİZİKSEL ERİŞİM: kapılar, yaklaşma bölgeleri, yürüyüş
// ---------------------------------------------------------------------------
// hücre kapısı açık mı? (mekanik kilitleme: topraklama ayırıcısı kapalı ve/veya ayırma noktası kilitli)
function doorOpen(L, b, lk, di) {
  if (L.opt.noDoors) return true;
  const d = L.doors[di];
  if (d.earth >= 0 && !((b >> L.els[d.earth].bit) & 1)) return false;
  if (d.lock >= 0 && !((lk >> L.els[d.lock].lk) & 1)) return false;
  return true;
}
// geçilebilirlik haritası: düğüm (karo 0..nT-1, geçiş hücresi nT..) güvenli ve açık mı?
function passMap(L, E, b, st, ch, lk) {
  lk = lk || 0;
  const k = (E.key * L.R.lk + lk) * L.R.ch + ch; let m = L.pcache.get(k); if (m) return m;
  m = new Uint8Array(L.nodes);
  const cg = chargedGal(L, E, ch);
  for (let ni = 0; ni < L.nodes; ni++) {
    let ok = true;
    if (ni < L.tiles.length && L.doorAt[ni] >= 0 && !doorOpen(L, b, lk, L.doorAt[ni])) ok = false;
    if (ok && !L.opt.noZones) for (const h of L.hazards[ni]) {
      if (h.cap >= 0) { if (!L.opt.noCapLock && Math.floor(ch / 4 ** h.cap) % 4 > 0) { ok = false; break; } continue; }
      if (E.live[h.node]) { ok = false; break; }
      if (!rigidEarthed(L, b, st, h.node)) { ok = false; break; }          // topraksız iletken gerilimli sayılır (EN 50110)
      if (cg.has(E.gal[h.node])) { ok = false; break; }
    }
    m[ni] = ok ? 1 : 0;
  }
  L.pcache.set(k, m); return m;
}
function passable(L, E, b, st, ch, c, lk) { return !!passMap(L, E, b, st, ch, lk)[L.tileIdx[c]]; }
// dokun-yürü hedefleri: geçilebilir karolar ve geçilebilir merdiven/iskele hücreleri üzerinden fiziksel BFS
function walkTargets(L, s, E) {
  E = E || stateE(L, s);
  const pk = (E.key * L.R.lk + s.lk) * L.R.ch + s.ch;
  const k = pk * L.tiles.length + L.tileIdx[s.p];
  let out = L.wcache.get(k); if (out) return out;
  const pm = passMap(L, E, s.b, s.st, s.ch, s.lk);
  const t0 = L.tileIdx[s.p]; const seen = new Uint8Array(L.tiles.length); seen[t0] = 1; const q = [t0]; out = [];
  for (let i = 0; i < q.length; i++) for (const e of L.adj[q[i]]) {
    if (seen[e.to] || !pm[e.to]) continue; let ok = true; for (const v of e.via) if (!pm[v]) { ok = false; break; } if (!ok) continue;
    seen[e.to] = 1; q.push(e.to); out.push(L.tiles[e.to]);
  }
  L.wcache.set(k, out); return out;
}
// en kısa fiziksel yol (adım sayısı; eşitlikte sabit komşu sırası). static=true: tehlike ve kapılar yok sayılır.
// Döner: [{c, k:'karo'|'merdiven'|'iskele', x, y, z, h}] (h = ayak yüksekliği) ya da null.
function bfsTiles(L, s, from, pmOrNull) {
  const n = L.tiles.length; const prev = new Int32Array(n).fill(-2); const pe = new Array(n); const dist = new Int32Array(n).fill(-1);
  const t0 = L.tileIdx[from]; prev[t0] = -1; dist[t0] = 0; const q = [t0];
  for (let i = 0; i < q.length; i++) { const u = q[i];
    for (const e of L.adj[u]) { if (prev[e.to] !== -2) continue;
      if (pmOrNull) { if (!pmOrNull[e.to]) continue; let ok = true; for (const v of e.via) if (!pmOrNull[v]) { ok = false; break; } if (!ok) continue; }
      prev[e.to] = u; pe[e.to] = e; dist[e.to] = dist[u] + 1; q.push(e.to); } }
  return { prev, pe, dist };
}
function stepOf(L, c, k) { const [x, y, z] = L.G.xyz(c);
  if (k === 'karo') return { c, k, x, y: y + 1, z, h: y + 1 };
  if (k === 'merdiven') return { c, k, x, y, z, h: y + 0.5, dir: L.G.sdir[c] };
  return { c, k, x, y, z, h: y }; }
function walkPath(L, s, to, opts) {
  if (typeof to !== 'number' || !(L.tileIdx[to] >= 0)) return null;
  const pm = opts && opts.static ? null : passMap(L, stateE(L, s), s.b, s.st, s.ch, s.lk);
  const B = bfsTiles(L, s, s.p, pm); const ti = L.tileIdx[to]; if (B.prev[ti] === -2) return null;
  const seq = []; for (let u = ti; u >= 0; u = B.prev[u]) seq.push(u); seq.reverse();
  const out = [stepOf(L, L.tiles[seq[0]], 'karo')];
  for (let i = 1; i < seq.length; i++) { const e = B.pe[seq[i]];
    if (e.k === 'merdiven') out.push(stepOf(L, e.cells[0], 'merdiven'));
    else if (e.k === 'iskele') for (const c of e.cells) out.push(Object.assign(stepOf(L, c, 'iskele'), { dir: e.dir }));   // basamaklar sırayla (aşağıdan yukarı ya da tersi)
    out.push(stepOf(L, L.tiles[seq[i]], 'karo')); }
  return out;
}
function canReach(L, s, e) { const el = L.els[e]; return !!(el && el.cell >= 0 && L.reach[s.p] && L.reach[s.p].indexOf(e) >= 0); }
// UI yardımcısı: cihaza dokununca Volti'nin yürüyeceği erişim karosu (şu an geçilebilir yoldan en az adım); yoksa -1
function approachTile(L, s, e) {
  if (canReach(L, s, e)) return s.p;
  const ap = L.approach[e]; if (!ap || !ap.length) return -1;
  const B = bfsTiles(L, s, s.p, passMap(L, stateE(L, s), s.b, s.st, s.ch, s.lk));
  let best = -1, bd = Infinity; for (const c of ap) { const d = B.dist[L.tileIdx[c]]; if (d >= 0 && (d < bd || (d === bd && c < best))) { bd = d; best = c; } }
  return best;
}
const nm = el => el ? (el.ad ? `${el.id} (${el.ad})` : el.id) : '';
// düğümü (karo/geçiş) kapatan engeller
function nodeBlockers(L, E, s, ni) {
  const out = [];
  if (ni < L.tiles.length && L.doorAt[ni] >= 0 && !doorOpen(L, s.b, s.lk, L.doorAt[ni])) { const d = L.doors[L.doorAt[ni]]; out.push({ err: 'kapi_kilitli', el: d.el, earth: d.earth, lock: d.lock }); }
  if (L.opt.noZones) return out;
  const cg = chargedGal(L, E, s.ch);
  for (const h of L.hazards[ni]) {
    if (h.cap >= 0) { if (!L.opt.noCapLock && charge(s, h.cap) > 0) out.push({ err: 'bolge_kond', el: L.caps[h.cap].el, sarj: charge(s, h.cap) }); continue; }
    const bel = L.baras[h.bara].el;
    if (E.live[h.node]) out.push({ err: 'bolge_gerilimli', el: bel });
    else if (!rigidEarthed(L, s.b, s.st, h.node)) out.push({ err: 'bolge_topraksiz', el: bel });
    else if (cg.has(E.gal[h.node])) out.push({ err: 'bolge_kond', el: bel });
  }
  return out;
}
function blockerMsg(L, bl) {
  const el = L.els[bl.el];
  switch (bl.err) {
    case 'kapi_kilitli': {
      const need = []; if (bl.earth >= 0) need.push(`${nm(L.els[bl.earth])} kapatılmalı`); if (bl.lock >= 0) need.push(`${nm(L.els[bl.lock])} açık konumda kilitlenmeli`);
      return `Hücre kapısı kilitli: ${nm(el)}. Kapı kilitlemesi: önce ${need.join(' ve ')}.`; }
    case 'bolge_gerilimli': return `Yaklaşma bölgesi gerilimli: ${nm(el)} gerilim altında. Önce ayır ve kilitle, sonra topraklayıp kısa devre et.`;
    case 'bolge_topraksiz': return `Yaklaşma bölgesi: ${nm(el)} gerilimsiz ama topraklanmamış — gerilimli say. Önce topraklayıp kısa devre et.`;
    case 'bolge_kond': return `Yaklaşma bölgesi: ${nm(el)} hâlâ yüklü (kondansatör) — deşarjı bekle.`;
  }
  return ERR[bl.err] || bl.err;
}
// NEDEN ERİŞİLEMİYOR? hedef: {e: eleman} | {tile: karo hücresi}. Döner {ok:true, tile, path} ya da
// {err, msg, blockers:[{err, el, ...}], cells:[engelli hücre]} — engel ADIYLA söylenir.
function explain(L, s, target) {
  const goals = target.e !== undefined ? (L.approach[target.e] || []) : [target.tile];
  const what = target.e !== undefined ? nm(L.els[target.e]) : (target.tile === L.work ? 'iş noktası' : 'bu karo');
  if (target.e !== undefined && (!L.els[target.e] || L.els[target.e].cell < 0)) return fail('ulasilamaz');
  if (!goals.length) return fail('yol_yok', { msg: `Yol yok: ${what} için yaklaşma karosu yok.` });
  const E = stateE(L, s); const pm = passMap(L, E, s.b, s.st, s.ch, s.lk);
  if (goals.indexOf(s.p) >= 0) return { ok: true, tile: s.p, path: [] };
  const B = bfsTiles(L, s, s.p, pm); let best = -1, bd = Infinity;
  for (const c of goals) { const ti = L.tileIdx[c]; if (ti >= 0 && B.dist[ti] >= 0 && (B.dist[ti] < bd || (B.dist[ti] === bd && c < best))) { bd = B.dist[ti]; best = c; } }
  if (best >= 0) return { ok: true, tile: best, path: walkPath(L, s, best) };
  // 0-1 BFS: engelli düğüme girmek 1, serbest 0 -> en az engelli fiziksel yol
  const n = L.tiles.length, INF = 1 << 30; const cost = new Int32Array(n).fill(INF), prev = new Int32Array(n).fill(-1), pe = new Array(n);
  const t0 = L.tileIdx[s.p]; cost[t0] = 0; const dq = [t0]; let head = 0; const done = new Uint8Array(n);
  const blockedCost = e => { let c = pm[e.to] ? 0 : 1; for (const v of e.via) if (!pm[v]) c++; return c; };
  while (head < dq.length) { // basit Dijkstra (küçük graf)
    let bi = -1; for (let i = head; i < dq.length; i++) if (!done[dq[i]] && (bi < 0 || cost[dq[i]] < cost[dq[bi]])) bi = i; if (bi < 0) break;
    const u = dq[bi]; dq[bi] = dq[head]; dq[head++] = u; if (done[u]) continue; done[u] = 1;
    for (const e of L.adj[u]) { const nc = cost[u] + blockedCost(e); if (nc < cost[e.to]) { cost[e.to] = nc; prev[e.to] = u; pe[e.to] = e; dq.push(e.to); } } }
  let g = -1; for (const c of goals) { const ti = L.tileIdx[c]; if (ti >= 0 && cost[ti] < INF && (g < 0 || cost[ti] < cost[g])) g = ti; }
  if (g < 0) return fail('yol_yok', { msg: `Yol yok: ${what} noktasına çıkan merdiven ya da iskele yok.` });
  const blockers = [], cells = [], seenB = new Set();
  const addN = ni => { if (pm[ni]) return; cells.push(ni < n ? L.tiles[ni] : L.transit[ni - n]);
    for (const b of nodeBlockers(L, E, s, ni)) { const k = b.err + ':' + b.el; if (!seenB.has(k)) { seenB.add(k); blockers.push(b); } } };
  const chain = []; for (let u = g; u !== t0 && u >= 0; u = prev[u]) chain.push(u); chain.reverse();
  for (const u of chain) { for (const v of pe[u].via) addN(v); addN(u); }
  if (!blockers.length) return fail('ulasilamaz');
  const b0 = blockers[0];
  return fail(b0.err, { msg: blockerMsg(L, b0), blockers: blockers.map(b => Object.assign({ msg: blockerMsg(L, b), id: L.els[b.el].id }, b)), cells, hedef: what });
}

function cosOk(L, E) {
  if (!L.cosphi) return true;
  const g = E.gal[L.cosphi.node]; if (!E.live[L.cosphi.node]) return false;
  let P = 0, Q = 0;
  for (const l of L.loads) if (E.live[l.node] && E.gal[l.node] === g) { P += l.p; Q += l.q; }
  for (const c of L.caps) if (E.live[c.node] && E.gal[c.node] === g) Q -= c.q;
  // Türkiye reaktif sınırı (parametre): endüktif ≤ ind‰·P, kapasitif ≤ kap‰·P (varsayılan %20 / %15)
  return P > 0 && 1000 * Q <= L.cosphi.ind * P && -1000 * Q <= L.cosphi.kap * P;
}
function reaktif(L, E) { // HUD: {P,Q,ind%,kap%}
  if (!L.cosphi) return null; const g = E.gal[L.cosphi.node]; let P = 0, Q = 0;
  for (const l of L.loads) if (E.live[l.node] && E.gal[l.node] === g) { P += l.p; Q += l.q; }
  for (const c of L.caps) if (E.live[c.node] && E.gal[c.node] === g) Q -= c.q;
  return { P, Q, ind: P > 0 && Q > 0 ? 100 * Q / P : 0, kap: P > 0 && Q < 0 ? -100 * Q / P : 0 };
}
// HEDEF (R12)
function won(L, s) {
  const E = stateE(L, s); if (E.fault) return false;
  if (L.work >= 0 && !s.w) return false;
  if ((E.loadMask & L.goalMask) !== L.goalMask) return false;
  for (const e of L.earths) if ((s.b >> e.bit) & 1) return false;
  if (s.st || s.lk) return false;
  if (E.faultLive) return false;                                         // arızalı kesim ayrılmış (gerilimsiz)
  for (const z of L.gerilimli) if (!E.live[z]) return false;            // bakımı biten bölüm yeniden gerilimli
  if ((s.b & L.posMask) !== L.posVal) return false;                     // normal işletme konumu (varsa)
  for (const src of L.sources) if (src.acil) for (const l of L.loads) if (E.live[l.node] && E.gal[l.node] === E.gal[src.node]) return false; // acil kaynak yükte değil
  if (!cosOk(L, E)) return false;
  return true;
}
function kesintiOf(L, E) { let k = 0; L.loads.forEach((l, i) => { if (l.req && !((E.loadMask >> i) & 1)) k += l.w; }); return k; }

// İş bölgesi hazır mı? (beş altın kural)
function zoneReady(L, s, E) {
  for (const z of L.zone) { if (E.live[z]) return 'gerilim'; if (!L.opt.noLoto && !rigidEarthed(L, s.b, s.st, z)) return 'toprak'; if (L.opt.noLoto && !E.earthG[E.gal[z]]) return 'toprak'; }
  if (!isolatedWC(L, s.lk, L.zone)) return 'kilit';
  return null;
}

// ---------------------------------------------------------------------------
// EYLEMLER
// ---------------------------------------------------------------------------
const ERR = {
  yuk: 'Ayırıcı yük akımı kesemez ve yük alamaz: bu işlemde akım akardı ve paralel bir istasyon yolu (bara/kesici komütasyonu) yok.',
  paralel: 'Ayırıcı iki ayrı gerilimli bölümü paralelleyemez: halka kapama ve paralelleme kesiciyle ya da yük ayırıcısıyla yapılır.',
  trafo: 'Trafo (yüksüz bile olsa) ayırıcıyla enerjilenemez/ayrılamaz: mıknatıslanma akımını kesici keser.',
  kondans: 'Kondansatör bataryası ayırıcıyla bağlanamaz/ayrılamaz: kademe kesicisini kullan.',
  kilit_yok: 'Boşta asma kilit kalmadı.', yedek_yok: 'Yedek NH sigorta bıçağı kalmadı.', gerilim: 'NH sigorta tabanı gerilimli: önce iki taraftan ayır.',
  is_gerilim: 'İş bölgesi gerilimli.',
  is_toprak: 'İş bölgesi sabit bağlantıyla topraklanmamış: bir anahtarlama elemanı üzerinden gelen topraklama sayılmaz.',
  is_kilit: 'İş bölgesi ayrılıp kilitlenmemiş: kilitsiz bir yol (açık sabit kesiciler dahil) bir kaynağa ulaşıyor.',
  ayrilmamis: 'Önce ayır ve kilitle: bu bölüm kilitsiz bir yol (açık sabit kesiciler dahil) üzerinden bir kaynağa bağlanabilir. Topraklama yalnız görünür ve kilitli ayırmadan sonra yapılır.',
  once_toprak: 'Önce topraklamayı kaldır: bu kilit, topraklı bir bölümün ayırma noktası.',
  acik_degil: 'Yalnız AÇIK ayırma noktası kilitlenir.',
  asiri: 'Bu manevra korumayı açtırır: ayırıcı aşırı akım altında işletilemez.',
  toprak: 'Bu manevra topraklı bölüme gerilim verirdi (topraklamaya kapama — ölümcül hata). Manevra programı reddedildi.',
  toprak_canli: 'Gerilim yokluğu tespit edilemedi: bölüm gerilimli, topraklanamaz.',
  senkron: 'Senkron kontrol (25): farklı kaynak grupları paralel bağlanamaz.',
  seviye: 'İki farklı gerilim seviyesi doğrudan birleşemez.',
  cirpma: 'Kumanda devresi kararsız (kontaktör çırpması).',
  koruma_yok: 'Bu manevra korumasız bir arızayı beslerdi: yolda açma eşiği olan kesici ya da sigorta yok.',
  kesemez: 'Yük ayırıcısı arıza akımını kesemez.',
  tehlike: 'Volti yaklaşma sınırı içinde kalırdı: gerilimli, topraksız ya da yüklü (kondansatör) iletken.',
  kond: 'Kondansatör hâlâ yüklü: deşarj süresi bitmeden enerji verilemez / topraklanamaz.',
  kilitli: 'Cihaz kilitli (LOTO): önce kilidi ve etiketi kaldır.',
  kilitlenemez: 'Bu cihaz kilitlenemez: yalnız ayırıcı, yük ayırıcısı ve çekmeli kesici açık konumda kilitlenir.',
  gecersiz: 'Bu cihaza bu işlem uygulanamaz.',
  zaten: 'Volti zaten orada.',
  uzak: 'Volti cihazın yanında değil: önce yaklaşma karosuna yürü.',
  yol_yok: 'Yol yok: bu noktaya çıkan merdiven ya da iskele yok.',
  kapi_kilitli: 'Hücre kapısı kilitli: kapı kilitlemesinin koşulu (topraklama kapalı / ayırma kilitli) sağlanmadı.',
  kapi_icerde: 'Kapı kilitlemesi: Volti hücrenin içindeyken (kapı açıkken) bu manevra yapılamaz. Önce hücreden çık.',
  bolge_gerilimli: 'Yaklaşma bölgesi gerilimli: önce ayır.',
  bolge_topraksiz: 'Yaklaşma bölgesi: iletken gerilimsiz ama topraklanmamış (gerilimli say). Önce topraklayıp kısa devre et.',
  bolge_kond: 'Yaklaşma bölgesi: kondansatör hâlâ yüklü. Deşarjı bekle.',
  ulasilamaz: 'Bu işlem şu an yapılamaz.',
  dogrulanamadi: 'Bu defter doğrulanamadı.',
};
function fail(reason, extra) { return Object.assign({ err: reason, msg: ERR[reason] || reason }, extra || {}); }

// AYIRICI KURALI (R6b, akım ve potansiyel tabanlı). Ayırıcı işlemi ancak:
//  açma: işlemden önce eleman akımı ≤ ε  YA DA  iki ucu işlemden sonra kapalı bir istasyon yoluyla bağlı (komütasyon);
//  kapama: iki ucu zaten aynı istasyon bileşeninde (komütasyon)  YA DA  (iki ayrı gerilimli bileşeni birleştirmez ve
//          kapamadan sonra eleman akımı ≤ ε);
//  ve hiçbir trafo ucunun ve kondansatörün enerji durumu değişmez (mıknatıslanma/şarj akımı modelde sıfırdır, kural açıktır).
function switchCheck(L, E0, E1, opened, closedEls) {
  for (const o of opened) if (o.cur > EPS_I && E1.st[o.a] !== E1.st[o.b]) return 'yuk';
  for (const c of closedEls) {
    if (E0.st[c.a] === E0.st[c.b]) continue;
    if (E0.live[c.a] && E0.live[c.b] && E0.gal[c.a] !== E0.gal[c.b]) return 'paralel';
    if (c.cur(E1) > EPS_I) return 'yuk';
  }
  for (const e of L.edges) if (e.t === T.trafo && (E0.live[e.a] !== E1.live[e.a] || E0.live[e.b] !== E1.live[e.b])) return 'trafo';
  for (const c of L.caps) if (E0.live[c.node] !== E1.live[c.node]) return 'kondans';
  return null;
}

function timeStep(L, s, Eold, Enew, ns, timed) {
  let ch = 0;
  for (let i = 0; i < L.caps.length; i++) {
    const c = L.caps[i]; let q = charge(s, i);
    if (Enew.live[c.node] || Eold.live[c.node]) q = CH; else if (timed && q > 0) q--;
    ch += q * 4 ** i;
  }
  ns.ch = L.opt.noCapLock ? 0 : ch;
}
function capReenergise(L, s, Eold, Enew) {
  if (L.opt.noCapLock) return false;
  for (let i = 0; i < L.caps.length; i++) { const c = L.caps[i]; if (!Eold.live[c.node] && Enew.live[c.node] && charge(s, i) > 0) return true; }
  return false;
}
function capEarthed(L, s, Enew) {
  if (L.opt.noCapLock) return false;
  for (let i = 0; i < L.caps.length; i++) if (charge(s, i) > 0 && Enew.earthG[Enew.gal[L.caps[i].node]]) return true;
  return false;
}
// kapı kilitlemesi: Volti kapının içinde ya da eşiğindeyken kapıyı kapatacak manevra yapılamaz
function doorTrap(L, s, ns) {
  if (!L.doors.length || L.opt.noDoors) return null;
  const ti = L.tileIdx[ns.p];
  for (let di = 0; di < L.doors.length; di++) {
    const d = L.doors[di];
    if ((d.inner[ti] || d.tile === ns.p) && doorOpen(L, s.b, s.lk, di) && !doorOpen(L, ns.b, ns.lk, di))
      return fail('kapi_icerde', { el: d.el, msg: `Kapı kilitlemesi: Volti ${nm(L.els[d.el])} içindeyken bu manevra kapıyı kilitlerdi. Önce hücreden çık.` });
  }
  return null;
}
function finish(L, s, E0, R, ns, cost, trips, timed) {
  const E1 = R.E;
  if (capReenergise(L, s, E0, E1)) return fail('kond');
  if (capEarthed(L, s, E1)) return fail('kond');
  timeStep(L, s, E0, E1, ns, timed);
  const dt = doorTrap(L, s, ns); if (dt) return dt;
  if (!passable(L, E1, ns.b, ns.st, ns.ch, ns.p, ns.lk)) {
    const bl = nodeBlockers(L, E1, ns, L.tileIdx[ns.p]).filter(b => b.err !== 'kapi_kilitli');
    return fail('tehlike', bl.length ? { msg: `Volti yaklaşma sınırı içinde kalırdı: ${blockerMsg(L, bl[0])}`, blockers: bl } : null);
  }
  if (timed) cost.k = kesintiOf(L, E1);
  return { s: ns, c: cost, trips: trips || [] };
}
function lockCount(lk) { let used = 0; for (let x = lk; x; x &= x - 1) used++; return used; }
function reachFail(L, s, e) {
  const x = explain(L, s, { e });
  if (x.ok) return fail('uzak', { el: e, tile: x.tile, msg: `Volti ${nm(L.els[e])} cihazının yanında değil: önce yaklaşma karosuna yürü.` });
  return x;
}

function apply(L, s, a) {
  if (!a || typeof a !== 'object') return fail('gecersiz');
  const E0 = stateE(L, s);
  const ns = { p: s.p, b: s.b, lk: s.lk, sp: s.sp, st: s.st, ch: s.ch, w: s.w };
  const cost = { h: 1, m: 0, k: 0, o: 0 };
  if (a.e !== undefined && (!Number.isInteger(a.e) || !L.els[a.e])) return fail('gecersiz');
  if (ELEMENT_ACTION[a.t] && a.e === undefined) return fail('gecersiz');
  switch (a.t) {
    case 'git': {
      if (a.to === s.p) return fail('zaten');
      if (L.tileIdx[a.to] === undefined || L.tileIdx[a.to] < 0) return fail('yol_yok');
      if (walkTargets(L, s, E0).indexOf(a.to) < 0) return explain(L, s, { tile: a.to });
      ns.p = a.to; if (L.opt.freeWalk) cost.h = 0;
      return finish(L, s, E0, { E: E0 }, ns, cost, [], true);
    }
    case 'op': {
      const el = L.els[a.e];
      if (!(el.t === 'kesici' || el.t === 'ayirici' || el.t === 'yuk_ayirici' || el.t === 'toprak')) return fail('gecersiz');
      if (!canReach(L, s, a.e)) return reachFail(L, s, a.e);
      if (el.lk >= 0 && ((s.lk >> el.lk) & 1)) return fail('kilitli');
      const closing = !((s.b >> el.bit) & 1);
      const nb = s.b ^ (1 << el.bit);
      if (el.t === 'toprak' && closing) {
        const node = L.earths.find(x => x.el === a.e).node;
        if (E0.live[node]) return fail('toprak_canli');
        if (chargedGal(L, E0, s.ch).has(E0.gal[node])) return fail('kond');
        if (!isolatedWC(L, s.lk, [node])) return fail('ayrilmamis');
      }
      if (el.t === 'yuk_ayirici' && !closing && E0.cur[el.ei] > L.edges[el.ei].Ikes + EPS) return fail('kesemez');
      const R = settle(L, nb, 0, s.st);
      if (R.fault) return fail(R.fault);
      if (el.t === 'ayirici' && !L.opt.noAyiriciKurali) {
        if (R.olay) return fail('asiri');
        const ed = L.edges[el.ei];
        const why = closing ? switchCheck(L, E0, R.E, [], [{ a: ed.a, b: ed.b, cur: E => E.cur[el.ei] }]) : switchCheck(L, E0, R.E, [{ a: ed.a, b: ed.b, cur: E0.cur[el.ei] }], []);
        if (why) return fail(why);
      }
      ns.b = R.bits; cost.m = 1; cost.o = R.olay;
      return finish(L, s, E0, R, ns, cost, R.trips, true);
    }
    case 'kilit': case 'kilitac': {
      const el = L.els[a.e]; if (el.lk < 0) return fail('kilitlenemez');
      if (!canReach(L, s, a.e)) return reachFail(L, s, a.e);
      const locked = (s.lk >> el.lk) & 1;
      if (a.t === 'kilit') {
        if (locked) return fail('kilitli');
        if ((s.b >> el.bit) & 1) return fail('acik_degil');
        if (lockCount(s.lk) >= L.kilit) return fail('kilit_yok');
        ns.lk = s.lk | (1 << el.lk);
      } else {
        if (!locked) return fail('gecersiz');
        ns.lk = s.lk & ~(1 << el.lk);
        const ea = appliedEarths(L, s.b, s.st); if (ea.length && !isolatedWC(L, ns.lk, ea)) return fail('once_toprak');
      }
      const R = settle(L, ns.b, 0, s.st); if (R.fault) return fail(R.fault);
      if (R.bits !== ns.b || R.olay) return fail('ulasilamaz');
      return finish(L, s, E0, R, ns, cost, [], true);
    }
    case 'degistir': {
      const el = L.els[a.e]; if (el.t !== 'sigorta' || ((s.b >> el.bit) & 1)) return fail('gecersiz');
      if (!canReach(L, s, a.e)) return reachFail(L, s, a.e);
      if (s.sp < 1) return fail('yedek_yok');
      const ed = L.edges[el.ei]; if (E0.live[ed.a] || E0.live[ed.b]) return fail('gerilim');
      const R = settle(L, s.b | (1 << el.bit), 0, s.st); if (R.fault) return fail(R.fault);
      ns.b = R.bits; ns.sp = s.sp - 1; cost.m = 1; cost.o = R.olay;
      return finish(L, s, E0, R, ns, cost, R.trips, true);
    }
    case 'bas': {
      const el = L.els[a.e]; if (el.t !== 'buton') return fail('gecersiz');
      if (!canReach(L, s, a.e)) return reachFail(L, s, a.e);
      const R1 = settle(L, s.b, 1 << el.pbit, s.st); if (R1.fault) return fail(R1.fault);
      // Buton basılıyken oluşan geçici durum da güvenli olmalı. Bu anda enerji alan
      // kondansatör, buton bırakıldığında tekrar enerjisiz olsa da yüklü kalır.
      const mid = Object.assign({}, ns, { b: R1.bits });
      const pulse = finish(L, s, E0, R1, mid, { h: 0, m: 0, k: 0, o: 0 }, [], false);
      if (pulse.err) return pulse;
      const R2 = settle(L, R1.bits, 0, s.st); if (R2.fault) return fail(R2.fault);
      ns.b = R2.bits; cost.m = 1; cost.o = R1.olay + R2.olay;
      return finish(L, pulse.s, R1.E, R2, ns, cost, R1.trips.concat(R2.trips), true);
    }
    case 'set': {
      if (!L.nSet) return fail('gecersiz');
      const el = L.els[a.e]; if (el.t !== 'bara') return fail('gecersiz');
      if (!canReach(L, s, a.e)) return reachFail(L, s, a.e);
      if (s.st === 0) {
        const node = L.baras[el.bi].node; if (E0.live[node]) return fail('toprak_canli');
        if (chargedGal(L, E0, s.ch).has(E0.gal[node])) return fail('kond');
        if (!isolatedWC(L, s.lk, [node])) return fail('ayrilmamis');
        ns.st = el.bi + 1;
      } else if (s.st === el.bi + 1) ns.st = 0; else return fail('gecersiz');
      const R = settle(L, s.b, 0, ns.st); if (R.fault) return fail(R.fault);
      ns.b = R.bits; cost.m = 1; cost.o = R.olay;
      return finish(L, s, E0, R, ns, cost, R.trips, true);
    }
    case 'calis': {
      if (L.work < 0 || s.w) return fail('gecersiz');
      if (s.p !== L.work) { const x = explain(L, s, { tile: L.work }); return x.ok ? fail('uzak', { tile: L.work, msg: 'Volti iş noktasında değil: önce iş noktasına yürü.' }) : x; }
      const why = zoneReady(L, s, E0); if (why) return fail('is_' + why);
      ns.w = 1; return finish(L, s, E0, { E: E0 }, ns, cost, [], true);
    }
    case 'bekle': {
      if (!deadCharged(L, s, E0)) return fail('gecersiz');
      return finish(L, s, E0, { E: E0 }, ns, cost, [], true);
    }
  }
  return fail('gecersiz');
}
function deadCharged(L, s, E) { for (let i = 0; i < L.caps.length; i++) if (charge(s, i) > 0 && !E.live[L.caps[i].node]) return true; return false; }

// tüm aday eylemler (yasal olup olmadıkları apply ile süzülür)
function candidates(L, s) {
  const out = []; const E = stateE(L, s);
  for (const q of walkTargets(L, s, E)) out.push({ t: 'git', to: q });
  for (const e of L.reach[s.p]) {
    const el = L.els[e];
    if (el.t === 'kesici' || el.t === 'ayirici' || el.t === 'yuk_ayirici' || el.t === 'toprak') out.push({ t: 'op', e });
    if (el.lk >= 0) out.push({ t: ((s.lk >> el.lk) & 1) ? 'kilitac' : 'kilit', e });
    if (el.t === 'sigorta') out.push({ t: 'degistir', e });
    if (el.t === 'buton') out.push({ t: 'bas', e });
    if (el.t === 'bara' && L.nSet) out.push({ t: 'set', e });
  }
  if (s.p === L.work && !s.w) out.push({ t: 'calis' });
  if (deadCharged(L, s, E)) out.push({ t: 'bekle' });
  return out;
}
function succ(L, s) {
  const out = [];
  for (const a of candidates(L, s)) { const r = apply(L, s, a); if (!r.err) out.push({ a, s: r.s, c: r.c }); }
  return out;
}

// ---------------------------------------------------------------------------
// AMAÇ (oyuncu her an NE ve NEDEN yapacağını bilir): cihaz etiketi, cihaz durumu, iş listesi
// ---------------------------------------------------------------------------
// "Q01 Okul fideri kesicisi" — kod + gerçek işlev (ad zorunlu; verify2 amaç kapısı)
function labelOf(L, e) { const el = L.els[e]; return el ? (el.ad ? `${el.id} ${el.ad}` : el.id) : ''; }
// cihaz durumu (UI/kit): {closed, locked, live, dead, earthed, charge, blown}
function deviceState(L, s, e) {
  const el = L.els[e]; const E = stateE(L, s); const o = {};
  if (el.bit !== undefined) o.closed = !!((s.b >> el.bit) & 1);
  if (el.lk >= 0) o.locked = !!((s.lk >> el.lk) & 1);
  if (el.t === 'sigorta') o.blown = !o.closed;
  const ns = []; if (el.dugum !== undefined) ns.push(L.nodeIdx[el.dugum]); if (el.a !== undefined) ns.push(L.nodeIdx[el.a], L.nodeIdx[el.b]);
  o.live = ns.some(n => E.live[n]); o.dead = !o.live;
  o.earthed = ns.length > 0 && ns.every(n => !E.live[n] && E.earthG[E.gal[n]]);
  if (el.ci !== undefined) o.charge = charge(s, el.ci);
  return o;
}
// iş listesi: beş altın kural (iş emri varsa) + hedefler. done = şu an sağlanıyor (altın kurallar iş yapıldıktan sonra tamam kalır)
function checklist(L, s) {
  const E = stateE(L, s); const out = []; const zn = L.zone;
  if (L.work >= 0 && zn.length) {
    const dead = zn.every(z => !E.live[z]);
    const iso = isolatedWC(L, s.lk, zn);
    const earthed = zn.every(z => L.opt.noLoto ? !!E.earthG[E.gal[z]] : rigidEarthed(L, s.b, s.st, z));
    const safe = passable(L, E, s.b, s.st, s.ch, L.work, s.lk);
    const isAd = (L.def.is || {}).ad || 'iş noktası';
    const W = !!s.w;
    out.push({ k: 'ayir', grup: 'altin', ad: '1 Ayır: iş bölgesini her kaynaktan ayır', done: W || dead });
    out.push({ k: 'kilitle', grup: 'altin', ad: '2 Kilitle ve etiketle (LOTO): ayırma noktalarını açık konumda kilitle', done: W || (dead && iso) });
    out.push({ k: 'tespit', grup: 'altin', ad: '3 Gerilim yokluğunu tespit et', done: W || (dead && iso && earthed) });
    out.push({ k: 'toprakla', grup: 'altin', ad: '4 Topraklayıp kısa devre et', done: W || (dead && iso && earthed) });
    out.push({ k: 'onlem', grup: 'altin', ad: '5 Yakındaki gerilimli bölümlere karşı önlem al (yaklaşma bölgesi güvenli)', done: W || (dead && iso && earthed && safe) });
    out.push({ k: 'is', grup: 'is', ad: `İşi yap: ${isAd}`, done: W });
    const clean = !appliedEarths(L, s.b, s.st).length && !s.lk;
    out.push({ k: 'geri', grup: 'geri', ad: 'Geri ver: önce topraklamayı kaldır, sonra kilitleri aç', done: W && clean });
  }
  L.loads.forEach((l, i) => { if ((L.goalMask >> i) & 1) out.push({ k: 'yuk:' + L.els[l.el].id, grup: 'hedef', ad: `${labelOf(L, l.el)} beslensin`, done: !!((E.loadMask >> i) & 1) }); });
  for (const z of L.gerilimli) out.push({ k: 'gerilimli:' + L.nodeNames[z], grup: 'hedef', ad: `Bakımı biten bölüm yeniden gerilimli (${L.nodeNames[z]})`, done: !!E.live[z] });
  if (L.posMask) { const ids = L.els.filter(e => e.bit !== undefined && ((L.posMask >> e.bit) & 1));
    out.push({ k: 'normal', grup: 'hedef', ad: 'Normal işletme konumu: ' + ids.map(e => `${e.id} ${((L.posVal >> e.bit) & 1) ? 'kapalı' : 'açık'}`).join(', '), done: (s.b & L.posMask) === L.posVal }); }
  if (L.faults.length) out.push({ k: 'ariza', grup: 'hedef', ad: 'Arızalı kesim ayrılmış (gerilimsiz)', done: !E.faultLive });
  if (L.cosphi) out.push({ k: 'cosphi', grup: 'hedef', ad: 'Reaktif oran sınırda (endüktif ≤ %' + L.cosphi.ind / 10 + ', kapasitif ≤ %' + L.cosphi.kap / 10 + ')', done: cosOk(L, E) });
  if (L.sources.some(x => x.acil)) out.push({ k: 'acil', grup: 'hedef', ad: 'Acil kaynak (dizel/UPS) yükte değil', done: !L.sources.some(src => src.acil && L.loads.some(l => E.live[l.node] && E.gal[l.node] === E.gal[src.node])) });
  return out;
}

// ---------------------------------------------------------------------------
// RENDERER YARDIMCISI (saf): görünüm v'de hedeflerin önünde kalan (örten) hücreler -> yarı saydam yapılacaklar
// hedefler: hücre indeksi ya da [x,y,z] (Volti gövdesi için karo üstü: [x, y+1, z]). Kurallara hiçbir etkisi yoktur.
// ---------------------------------------------------------------------------
function triOf(sx, sz, x, y, z) {
  const a = sx * x, b = sz * z, A = a - y, B = b - y, d = a + y + b;
  return { d, k: [[A - 1, B - 1, 0], [A - 1, B - 1, 1], [A, B - 1, 1], [A, B, 0], [A, B, 1], [A - 1, B, 0]].map(([U, V, t]) => ((U + 128) * 512 + (V + 128)) * 2 + t) };
}
function occluders(L, v, targets) {
  const [sx, sz] = VIEWS[v & 3]; const G = L.G;
  let M = L._tri[v & 3];
  if (!M) { M = new Map(); for (let c = 0; c < G.N; c++) { const kd = G.kind[c]; if (kd === KIND.bos || kd === KIND.iskele) continue; const [x, y, z] = G.xyz(c); const t = triOf(sx, sz, x, y, z);
      t.k.forEach((k, i) => { let a = M.get(k); if (!a) M.set(k, a = []); a.push(t.d, c, i < 2 ? 1 : 0); }); } L._tri[v & 3] = M; }
  const out = new Set();
  for (const tg of targets || []) {
    const [x, y, z] = Array.isArray(tg) ? tg : G.xyz(tg); const self = Array.isArray(tg) ? -1 : tg; const t = triOf(sx, sz, x, y, z);
    for (const k of t.k) { const a = M.get(k); if (!a) continue; for (let i = 0; i < a.length; i += 3) if (a[i] > t.d && a[i + 1] !== self) out.add(a[i + 1]); }
  }
  return [...out].sort((p, q) => p - q);
}
// dokunuş seçimi (yalnız görsel): görünüm v'de ekran kafesi üçgeni (U,V,t) önündeki en yakın dolu hücre -> {c, d, top} | null.
// skip: yarı saydam yapılmış örtücüler (Set) atlanır, böylece arkadaki karo/cihaz seçilir. Eski L.views[v].owner yerine.
function ownerAt(L, v, U, V, t, skip) {
  occluders(L, v, []); const a = L._tri[v & 3].get(((U + 128) * 512 + (V + 128)) * 2 + t); if (!a) return null; let best = null;
  for (let i = 0; i < a.length; i += 3) { if (skip && skip.has(a[i + 1])) continue; if (!best || a[i] > best.d) best = { c: a[i + 1], d: a[i], top: !!a[i + 2] }; }
  return best;
}
// ekran kafesi yönü i ([[1,0],[-1,0],[0,1],[0,-1]] = +U, −U, +V, −V; kural sürümü 3 DIRS) -> görünüm v'de fiziksel yön (DIRS indeksi)
function screenToDir(v, i) { const [sx, sz] = VIEWS[v & 3]; if (i < 2) return ((i === 0 ? 1 : -1) * sx) > 0 ? 0 : 1; return ((i === 2 ? 1 : -1) * sz) > 0 ? 2 : 3; }
// klavye adımı: Volti'nin karosundan d yönünde TEK fiziksel adım (düz komşu, merdiven sahanlığı ya da iskele ucu) -> karo | -1
function stepToward(L, s, d) {
  const tg = walkTargets(L, s); for (const e of L.adj[L.tileIdx[s.p]]) if (e.d === d && tg.indexOf(L.tiles[e.to]) >= 0) return L.tiles[e.to];
  return -1;
}

// ---------------------------------------------------------------------------
// EYLEM DİZGİSİ (hayalet / Manevra Defteri / meydan okuma kodu)
// ---------------------------------------------------------------------------
// git 'g<karo indeksi>', op 'o:ID', kilit 'k:ID', kilit aç 'a:ID', değiştir 'f:ID', bas 'b:ID', set 's:ID', çalış 'c', bekle 'w'
// (kural sürümü 4: 'd+' 'd-' 'p' YOK — eski dizgiler 'dogrulanamadi' ile reddedilir)
const TOK = /^(?:g(\d{1,4})|([okafbs]):([A-Za-z0-9_]{1,12})|(c)|(w))$/;
function encodeAct(L, s, a) {
  switch (a.t) {
    case 'git': return 'g' + L.tileIdx[a.to];
    case 'op': return 'o:' + L.els[a.e].id; case 'kilit': return 'k:' + L.els[a.e].id; case 'kilitac': return 'a:' + L.els[a.e].id;
    case 'degistir': return 'f:' + L.els[a.e].id; case 'bas': return 'b:' + L.els[a.e].id; case 'set': return 's:' + L.els[a.e].id;
    case 'calis': return 'c'; case 'bekle': return 'w';
  }
}
// katı çözümleme: geçersiz simge -> null (asla istisna atmaz)
function decodeAct(L, s, tok) {
  if (typeof tok !== 'string') return null;
  const m = TOK.exec(tok); if (!m) return null;
  if (m[1] !== undefined) { const i = +m[1]; if (i >= L.tiles.length) return null; return { t: 'git', to: L.tiles[i] }; }
  if (m[2]) { const e = L.elIndex[m[3]]; if (e === undefined) return null;
    return { t: { o: 'op', k: 'kilit', a: 'kilitac', f: 'degistir', b: 'bas', s: 'set' }[m[2]], e }; }
  if (m[4]) return { t: 'calis' };
  if (m[5]) return { t: 'bekle' };
  return null;
}
// Manevra Defteri satırı (Türkçe)
function describe(L, s, a, r) {
  const el = a.e !== undefined ? L.els[a.e] : null; const n = nm(el);
  switch (a.t) {
    case 'git': return null;
    case 'op': { const kap = !((s.b >> el.bit) & 1); const v = el.t === 'toprak' ? (kap ? 'gerilim yokluğu tespit edildi, topraklandı ve kısa devre edildi' : 'topraklama ayırıcısı AÇILDI')
      : (kap ? 'KAPATILDI' : 'AÇILDI'); return `${n} ${v}`; }
    case 'kilit': return `${n} kilitlendi ve etiketlendi (LOTO)`; case 'kilitac': return `${n} kilidi ve etiketi kaldırıldı`;
    case 'degistir': return `${n} NH sigorta bıçağı değiştirildi (yedekten)`; case 'bas': return `${n} butonuna basıldı`;
    case 'set': return s.st ? `${n} taşınabilir topraklama takımı söküldü` : `${n} gerilim yokluğu tespit edildi, taşınabilir topraklama takıldı ve kısa devre edildi`;
    case 'calis': return 'İş emri yapıldı (bakım)' + ((L.def.is || {}).ad ? `: ${L.def.is.ad}` : ''); case 'bekle': return 'Kondansatör deşarjı beklendi';
  }
  return null;
}
// yeniden oynatma: güvenilmeyen dizgiler için asla istisna atmaz
function replay(L, str, from) {
  const tot = { h: 0, m: 0, k: 0, o: 0 }; const log = [];
  let s;
  try { s = from || initState(L); } catch (e) { return { ok: false, err: 'dogrulanamadi', msg: ERR.dogrulanamadi, tot, log }; }
  if (typeof str !== 'string' || str.length > 20000) return { ok: false, err: 'dogrulanamadi', msg: ERR.dogrulanamadi, s, tot, log };
  const toks = str.trim() ? str.trim().split(/\s+/) : [];
  for (const t of toks) {
    let a, r;
    try { a = decodeAct(L, s, t); if (!a) return { ok: false, at: t, err: 'dogrulanamadi', msg: ERR.dogrulanamadi, s, tot, log }; r = apply(L, s, a); }
    catch (e) { return { ok: false, at: t, err: 'dogrulanamadi', msg: ERR.dogrulanamadi, s, tot, log }; }
    if (r.err) return { ok: false, at: t, err: r.err, msg: r.msg, s, tot, log };
    const line = describe(L, s, a, r); if (line) log.push(line);
    tot.h += r.c.h; tot.m += r.c.m; tot.k += r.c.k; tot.o += r.c.o; s = r.s;
  }
  return { ok: true, won: won(L, s), s, tot, log };
}

module.exports = { RULES_VERSION, VIEWS, DIRS, CH, G_SW, G_ARIZA, T, KIND, STAIR, compile, evaluate, settle, initState, key, unkey, elecKey, stateE,
  passable, passMap, walkTargets, walkPath, doorOpen, explain, nodeBlockers, blockerMsg, occluders,
  won, apply, candidates, succ, zoneReady, isolatedWC, wcReach, rigidEarthed, appliedEarths, approachTile, switchCheck,
  labelOf, deviceState, checklist, ownerAt, screenToDir, stepToward, encodeAct, decodeAct, describe, replay, kesintiOf, cosOk, reaktif, ERR };
