// ============================================================================
// ui/sld.js — PX.sld : Tek Hat paneli (SVG, IEC 60617 tarzı semboller), çapraz vurgu, kapalı şerit (§11.2, §24.2)
//                                                                               sahip: UI
// Yerleşim kaynağı (öncelik sırasıyla):
//   1) seviye verisindeki elle yazılmış ızgara  lv.sld  ya da  lv.def.sld  (§24.2):
//        sld: { node: { <düğüm>: [sütun, satır]  |  [sütun, satır, sütun2] (yatay bara sütun..sütun2) },
//               el:   { <elemanId>: [sütun, satır, yön] , '<KONTAKTÖR>.bobin': [sütun, satır, yön] (isteğe bağlı) } }
//        Birimler: 1 sütun = 60, 1 satır = 44 SVG birimi. Önerilen düzen: düğümler çift satırda, iki uçlu
//        elemanlar aradaki tek satırda. yön: 'd' (a üstte, b altta; varsayılan) | 'u' (a altta) | 'r' (a solda) | 'l'
//        (a sağda). Tek uçlu elemanlarda (kaynak, yük, topraklama, kondansatör, arıza) yön sembolün düğümden
//        hangi yöne sarktığıdır ('d' aşağı, 'u' yukarı, 'r' sağa, 'l' sola). 'bara' elemanı yerleşim istemez
//        (düğümü kalın bara olarak çizilir). Eksik giriş varsa otomatik yerleşime düşülür (konsola uyarı).
//   2) otomatik yerleşim (yedek): kaynaklardan genişlik-öncelikli keşif; keşif sırasına göre yönlendirilmiş en uzun
//      yol katmanlaması; ağaç düzeni (her besleme sütunu ayrı).
// Durumlar (renk tek ipucu değil, desen + ikon + etiket): CANLI (akan kesikli çizgi), ÖLÜ — TOPRAKSIZ (çapraz
// tarama, "gerilimli say"), TOPRAKLI (sarı-yeşil şerit + toprak sembolü), KİLİTLİ (asma kilit + etiket).
// Kural sürümü 4: izdüşüm seçicisi ve kafa sembolü yoktur; eski kuplörler gerçek kesici/ayırıcı olarak çizilir.
// Hücre kapıları Tek Hat'ta yer almaz (mekanik kilitleme; sahada). Sunum durumu: yalnız 'elec:changed' (controller
// bunu animasyon adımı bitince yayınlar) ve geri al/yinele/baştan ile güncellenir; kare başına iş yok.
//   PX.sld.init()  PX.sld.open(bool?) -> bool  PX.sld.isOpen  PX.sld.highlight(elId|null)
//   PX.sld.diagram(L, lv, {interactive}) -> {svg, W, H, update(s, E, extra?), highlight(id), fit(w)}   (önizleme için)
//   PX.sld.mini(items, opts) -> SVGElement   (kural ve Neden? kartlarının mini şemaları; cards.js)
//   PX.sld.nodeState(E, n) -> 'live'|'earth'|'dead'
//   [data-testid=sld-strip] (her zaman görünür şerit)   [data-testid=sld-panel]
// ============================================================================
const NS = 'http://www.w3.org/2000/svg';
const CW = 60, RH = 44, PAD = 30;
const $ = id => document.getElementById(id);
const SIM = PX.SIM;
const TWO = { kablo: 1, trafo: 1, kesici: 1, ayirici: 1, yuk_ayirici: 1, sigorta: 1, kontaktor: 1, yardimci: 1, buton: 1 };
const ONE = { kaynak: 1, yuk: 1, toprak: 1, kondansator: 1, ariza: 1 };
// düğüme bağlantı noktası: sembol merkezinden kontak noktasına uzaklık (yerel dikey çerçeve)
const TERM = { kablo: 6, trafo: 12.5, kesici: 9, ayirici: 9, yuk_ayirici: 9, sigorta: 9, kontaktor: 9, yardimci: 9, buton: 9,
  kaynak: 10, yuk: 6, toprak: 8, kondansator: 3, ariza: 8, bobin: 5 };

function S(tag, a, p) { const e = document.createElementNS(NS, tag); if (a) for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
function ln(p, x1, y1, x2, y2, cls) { return S('line', { x1, y1, x2, y2, class: cls || 's-sym' }, p); }
function pth(p, d, cls) { return S('path', { d, class: cls || 's-sym' }, p); }
function tx(p, x, y, s, cls, anchor) { const t = S('text', { x, y, class: cls || 's-txt' }, p); if (anchor) t.setAttribute('text-anchor', anchor); t.textContent = s; return t; }
function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
// sözcükte keserken "…" (sözcük sınırı varsa orada)
function shortWord(s, n) {
  s = String(s || ''); if (s.length <= n) return s;
  const c = s.lastIndexOf(' ', n - 1); return (c >= n * 0.5 ? s.slice(0, c) : s.slice(0, n - 1)) + '…';
}
// Alt yazıyı YALNIZ sözcük sınırlarında satırlara böler (Türkçe sözcük ortadan bölünmez: "Depo aydınlat/ması" yerine
// "Depo / aydınlatması"); satır ≤ n karakter, en çok maxL satır, son satır gerekirse "…". n = 12: komşu sütunlar 60
// birim aralıklı, 9,5 px alt yazıda 12 karakter ≈ 58 birim -> yan yana iki yük adı birbirine değmez.
function wrapWords(s, n, maxL) {
  s = String(s || '').trim(); if (s.length <= n) return [s];
  const words = s.split(/\s+/); const out = []; let cur = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i]; const cand = cur ? cur + ' ' + w : w;
    if (cand.length <= n) { cur = cand; continue; }
    if (cur) out.push(cur);
    if (out.length === maxL - 1) { out.push(shortWord(words.slice(i).join(' '), n)); return out; }
    cur = w.length <= n ? w : shortWord(w, n);
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- ortak SVG desenleri (tek, belgede bir kez)
function ensureDefs() {
  if ($('px-sld-defs')) return;
  const svg = S('svg', { id: 'px-sld-defs', width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' }, null);
  const d = S('defs', null, svg);
  const p1 = S('pattern', { id: 'pHatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, d);
  S('rect', { width: 6, height: 6, fill: '#2a2944' }, p1); S('rect', { width: 2.4, height: 6, fill: '#b8b2e6' }, p1); S('rect', { width: 6, height: 1.6, fill: '#8f89c0' }, p1);
  const p2 = S('pattern', { id: 'pEarth', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, d);
  S('rect', { width: 8, height: 8, fill: '#2fbf6a' }, p2); S('rect', { width: 4, height: 8, fill: '#d8e83a' }, p2);
  const p3 = S('pattern', { id: 'pGray', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-45)' }, d);
  S('rect', { width: 5, height: 5, fill: 'rgba(110,122,150,.25)' }, p3); S('rect', { width: 2, height: 5, fill: '#8a96b4' }, p3);
  document.body.appendChild(svg);
}

// ---------------------------------------------------------------- semboller (yerel dikey çerçeve: a = (0,-16) üst, b = (0,16) alt)
function blade(g, closed, len, cls) {               // pivot (0,-len) -> kontak (0,len)
  const e = closed ? ln(g, 0, -len, 0, len, 'blade s-sym cond') : ln(g, 0, -len, -len * 0.95, len * 0.55, 'blade s-sym');
  if (cls) e.classList.add(cls); return e;
}
function lockIcon(g, x, y) {
  const k = S('g', { class: 'lockic-on', transform: `translate(${x},${y})` }, g);
  S('rect', { x: -1, y: -9.5, width: 42, height: 12.5, rx: 3, fill: '#4a1420', stroke: '#ff8090', 'stroke-width': 0.8 }, k);
  pth(k, 'M2,-3.5 v-2.2 a2.6,2.6 0 0 1 5.2,0 v2.2', 'lkshackle').setAttribute('style', 'fill:none;stroke:#ffd0d6;stroke-width:1.2');
  S('rect', { x: 1, y: -4, width: 7.2, height: 5.6, rx: 1, fill: '#ffd0d6' }, k);
  tx(k, 10, 0.5, 'KİLİTLİ', 's-flag');
}
function flag(g, x, y, s, fill) {
  const k = S('g', { transform: `translate(${x},${y})` }, g);
  S('rect', { x: -1, y: -9, width: 7 + s.length * 6.3, height: 12, rx: 3, fill: fill || '#a0461e' }, k);
  tx(k, 2, 0.5, s, 's-flag');
}
function earthMark(g, y, sc, f) { sc = sc || 1; f = f || 1; ln(g, -7 * sc, y, 7 * sc, y); ln(g, -4.5 * sc, y + 3 * f, 4.5 * sc, y + 3 * f); ln(g, -2 * sc, y + 6 * f, 2 * sc, y + 6 * f); }
const SYM = {
  kesici(g, st) {
    if (st.cekmeli) { pth(g, 'M-4,-15 l4,3 l4,-3', 's-sym'); pth(g, 'M-4,15 l4,-3 l4,3', 's-sym'); }
    blade(g, st.closed, 9);
    ln(g, -3, 6, 3, 12); ln(g, 3, 6, -3, 12);                       // kesici: sabit kontakta çarpı
  },
  ayirici(g, st) { blade(g, st.closed, 9); ln(g, -4.5, 9, 4.5, 9); }   // ayırıcı: sabit kontakta dik çizgi
  ,
  yuk_ayirici(g, st) { blade(g, st.closed, 9); ln(g, -4.5, 11, 4.5, 11); S('circle', { cx: 0, cy: 7, r: 2.4, class: 's-sym' }, g); },
  sigorta(g, st) {
    S('rect', { x: -4.5, y: -9, width: 9, height: 18, rx: 1, class: 's-sym' }, g);
    if (st.closed) ln(g, 0, -9, 0, 9, 's-sym cond');
    else { ln(g, 0, -9, 0, -3, 's-sym'); ln(g, 0, 3, 0, 9, 's-sym'); ln(g, -3, -2, 3, 2, 's-sym bad'); }
  },
  kontaktor(g, st) { blade(g, st.closed, 9); pth(g, 'M-3.2,9 a3.2,3.2 0 0 1 6.4,0', 's-sym'); },
  yardimci(g, st) { blade(g, st.closed, 9); if (st.nc) ln(g, 0, 9, -6, 9); if (!st.extLab) tx(g, -9, 3, st.nc ? 'NK' : 'NA', 's-sub', 'end'); },
  buton(g, st) {
    blade(g, st.closed, 9); if (st.nc) ln(g, 0, 9, -6, 9);
    pth(g, 'M-4.5,0 H-13 M-13,-4 V4', 's-sym dash'); if (!st.extLab) tx(g, -15, -6, st.nc ? 'NK' : 'NA', 's-sub', 'end');
  },
  trafo(g) { S('circle', { cx: 0, cy: -5, r: 7.5, class: 's-sym' }, g); S('circle', { cx: 0, cy: 5, r: 7.5, class: 's-sym' }, g); },
  kablo(g) { S('ellipse', { cx: 0, cy: 0, rx: 5.5, ry: 2.6, class: 's-sym' }, g); ln(g, 0, -6, 0, 6, 's-sym cond'); },
  // tek uçlu: kontak (0,-TERM) düğüme bağlanır; 'u' yönünde y aynalanır (metin düz kalır)
  kaynak(g, st, f) {
    S('circle', { cx: 0, cy: 0, r: 10, class: 's-sym' }, g);
    if (st.gen) tx(g, 0, 3.6, 'G', 's-txt', 'middle'); else pth(g, 'M-6,0 q3,-6 6,0 t6,0', 's-sym');
    if (st.live) S('circle', { cx: 0, cy: 0, r: 13, class: 's-sym', style: 'stroke:var(--live);stroke-width:1.2;opacity:.7' }, g);
  },
  yuk(g, st, f) {
    if (st.motor) { S('circle', { cx: 0, cy: 3 * f, r: 9, class: st.fed ? 's-sym fedfill' : 's-sym' }, g); tx(g, 0, 3 * f + 3.6, 'M', 's-txt', 'middle'); }
    else pth(g, `M-7,${-6 * f} L7,${-6 * f} L0,${7 * f} Z`, st.fed ? 's-sym fedfill' : 's-sym');
  },
  toprak(g, st, f) {
    if (st.closed) ln(g, 0, -8 * f, 0, 4 * f, 's-sym cond'); else ln(g, 0, -8 * f, -7, 1 * f, 's-sym');
    ln(g, -4, 4 * f, 4, 4 * f); ln(g, 0, 4 * f, 0, 8 * f); earthMark(g, 8 * f, 1, f);
  },
  kondansator(g, st, f) {
    ln(g, -9, -3 * f, 9, -3 * f, 's-sym plate'); ln(g, -9, 3 * f, 9, 3 * f, 's-sym plate'); ln(g, 0, 3 * f, 0, 8 * f); earthMark(g, 8 * f, 0.8, f);
    if (st.charge > 0) {
      for (let i = 0; i < 3; i++) { const a0 = -90 + i * 120 + 8, a1 = a0 + 104; const r = 6, cx = 16, cy = 0;
        const p = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
        const [x0, y0] = p(a0), [x1, y1] = p(a1);
        S('path', { d: `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`, style: `fill:none;stroke-width:2.2;stroke:${i < st.charge ? 'var(--warn)' : '#33405e'}` }, g); }
      tx(g, 16, 3, String(st.charge), 's-flag', 'middle');
    }
  },
  ariza(g, st, f) {
    pth(g, `M0,${-8 * f} L-4,${-2 * f} L4,${2 * f} L-1,${8 * f}`, 's-sym bad');
    pth(g, `M-3.5,${5.5 * f} L-1,${8 * f} L1.5,${5 * f}`, 's-sym bad');
    const y = 10 * f; ln(g, -6, y, 6, y); ln(g, -3.5, y + 3 * f, 3.5, y + 3 * f);
  },
  bobin(g, st, f) {
    S('rect', { x: -7, y: -5, width: 14, height: 10, rx: 1.5, class: st.live ? 's-sym fedfill' : 's-sym' }, g);
    ln(g, -7, -5, 7, 5, 's-sym thin'); ln(g, 0, 5 * f, 0, 9 * f); earthMark(g, 9 * f, 0.7, f);
  },
};

// ---------------------------------------------------------------- yerleşim
function levelGrid(lv) { return (lv && (lv.sld || (lv.def && lv.def.sld))) || null; }
const DIRV = { d: 'd', u: 'u', r: 'r', l: 'l', v: 'd', h: 'r', 0: 'd', 1: 'r', 2: 'u', 3: 'l' };
// yön -> dönüş (derece): 'd' 0, 'r' -90 (a solda), 'u' 180, 'l' 90
const ROT = { d: 0, r: -90, u: 180, l: 90 };
function rotP(dir, x, y) { switch (dir) { case 'r': return [y, -x]; case 'u': return [-x, -y]; case 'l': return [-y, x]; default: return [x, y]; } }   // SVG rotate(ROT[dir]) ile aynı

// tr = true: ızgara köşegene göre aynalanır (sütun <-> satır). Dikey telefonda alt sayfa geniş ve alçaktır; uzun bir
// elle yazılmış ızgara bu yüzden yatay akıtılır (yön: d<->r, u<->l). Elektrik ve semboller değişmez, yalnız yerleşim.
const TRD = { d: 'r', r: 'd', u: 'l', l: 'u' };
function gridExtent(grid) {
  let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  const add = g => { if (!Array.isArray(g)) return; c0 = Math.min(c0, g[0]); c1 = Math.max(c1, g[0]); r0 = Math.min(r0, g[1]); r1 = Math.max(r1, g[1]); if (typeof g[2] === 'number') c1 = Math.max(c1, g[2]); };
  for (const k in (grid.node || {})) add(grid.node[k]); for (const k in (grid.el || {})) add(grid.el[k]);
  return { cols: isFinite(c0) ? c1 - c0 + 1 : 1, rows: isFinite(r0) ? r1 - r0 + 1 : 1 };
}
function gridLayout(L, grid, tr) {
  const nodes = {}, items = []; const missing = [];
  const P = (c, r) => tr ? [r * CW, c * RH] : [c * CW, r * RH];
  const D = d => { d = DIRV[d === undefined ? 'd' : d] || 'd'; return tr ? TRD[d] : d; };
  for (let n = 0; n < L.nN; n++) {
    const g = grid.node && grid.node[L.nodeNames[n]];
    if (!g) { missing.push('düğüm ' + L.nodeNames[n]); continue; }
    const [x, y] = P(g[0], g[1]); const c2 = g[2] !== undefined ? g[2] : g[0];
    nodes[n] = tr ? { x, y, x0: g[0] * RH, x1: c2 * RH, vert: true, bus: false } : { x, y, x0: g[0] * CW, x1: c2 * CW, bus: false };
  }
  L.els.forEach((e, i) => {
    if (e.t === 'bara') return;
    const g = grid.el && grid.el[e.id];
    if (!g) { if (TWO[e.t] || ONE[e.t]) missing.push('eleman ' + e.id); return; }
    const [x, y] = P(g[0], g[1]); items.push({ i, t: e.t, x, y, dir: D(g[2]) });
  });
  L.contactors.forEach(c => { const id = L.els[c.el].id + '.bobin'; const g = grid.el && grid.el[id];
    if (g) { const [x, y] = P(g[0], g[1]); items.push({ i: c.el, t: 'bobin', node: c.coil, x, y, dir: D(g[2]) }); } });
  if (missing.length) return { missing };
  return { nodes, items, grid: true, tr: !!tr };
}
// kutuya (pw x ph) en büyük ölçekle sığan yönelim
function chooseTr(grid, box) {
  if (!box || !(box[0] > 0) || !(box[1] > 0)) return false;
  const { cols, rows } = gridExtent(grid);
  const k0 = Math.min(box[0] / (cols * CW + 2 * PAD), box[1] / (rows * RH + 2 * PAD));
  const k1 = Math.min(box[0] / (rows * CW + 2 * PAD), box[1] / (cols * RH + 2 * PAD));
  return k1 > k0 * 1.08;
}

function autoLayout(L, horiz) {
  const nN = L.nN, adj = []; for (let i = 0; i < nN; i++) adj.push([]);
  L.edges.forEach(ed => { if (ed.a === ed.b) return; const lk = { a: ed.a, b: ed.b, kind: 'el', el: ed.el }; adj[ed.a].push(lk); adj[ed.b].push(lk); });
  const disc = new Int32Array(nN).fill(-1), parent = new Array(nN).fill(null), order = [], root = new Uint8Array(nN);
  const grow = seeds => {
    let cur = seeds;
    while (cur.length) {
      for (let i = 0; i < cur.length; i++) { const u = cur[i];
        for (const lk of adj[u]) { if (lk.kind !== 'el') continue; const v = lk.a === u ? lk.b : lk.a; if (disc[v] >= 0) continue;
          disc[v] = order.length; order.push(v); parent[v] = lk; cur.push(v); } }
      const nxt = [];
      for (const u of cur) for (const lk of adj[u]) { if (lk.kind !== 'pair') continue; const v = lk.a === u ? lk.b : lk.a; if (disc[v] >= 0) continue;
        disc[v] = order.length; order.push(v); parent[v] = lk; nxt.push(v); }
      cur = nxt;
    }
  };
  const seeds = []; for (const s of L.sources) if (disc[s.node] < 0) { disc[s.node] = order.length; order.push(s.node); root[s.node] = 1; seeds.push(s.node); }
  grow(seeds);
  for (let n = 0; n < nN; n++) if (disc[n] < 0) { disc[n] = order.length; order.push(n); root[n] = 1; grow([n]); }
  // en uzun yol katmanı (keşif sırası topolojik sıradır)
  const layer = new Int32Array(nN);
  for (const v of order) { let m = 0; for (const lk of adj[v]) { const u = lk.a === v ? lk.b : lk.a; if (disc[u] < disc[v]) m = Math.max(m, layer[u] + 1); } layer[v] = root[v] ? 0 : m; }
  // düğüm başına yuvalar (eleman tanım sırası)
  const slots = []; for (let i = 0; i < nN; i++) slots.push([]);
  const headUpOf = new Map();                       // (kural sürümü 3 kalıntısı: kafa yok, boş kalır)
  L.els.forEach((e, i) => {
    if (TWO[e.t] && e.ei !== undefined) {
      const ed = L.edges[e.ei]; if (ed.a === ed.b) return;
      const up = disc[ed.a] < disc[ed.b] ? ed.a : ed.b, dn = up === ed.a ? ed.b : ed.a;
      slots[up].push({ kind: 'edge', i, other: dn, tree: parent[dn] && parent[dn].kind === 'el' && parent[dn].el === i, dir: up === ed.a ? 'd' : 'u' });
    } else if (ONE[e.t]) {
      const n = L.nodeIdx[e.dugum];
      if (e.t === 'kaynak') slots[n].push({ kind: 'src', i, dir: 'u' });
      else if (e.t === 'kafa') slots[n].push({ kind: 'head', i, dir: headUpOf.has(i) ? 'u' : 'd', hi: e.hi });
      else slots[n].push({ kind: 'att', i, dir: 'd' });
    }
  });
  L.contactors.forEach(c => slots[c.coil].push({ kind: 'att', i: c.el, t: 'bobin', dir: 'd' }));
  // sütunlar (ağaç düzeni)
  let col = 0; const placed = new Uint8Array(nN); const nx = new Float64Array(nN), x0 = new Float64Array(nN), x1 = new Float64Array(nN);
  const upHeadX = new Map();                        // düğüm -> {headEl -> x}
  function entryX(v) {
    let x = nx[v];
    for (const sl of slots[v]) if ((sl.kind === 'head' && sl.dir === 'u') || sl.kind === 'src') if (Math.abs(sl.x - x) < 0.01) { x += 0.5; x1[v] = Math.max(x1[v], x); x0[v] = Math.min(x0[v], x); }
    return x;
  }
  function place(u) {
    placed[u] = 1; const xs = []; const srcs = [];
    for (const sl of slots[u]) {
      if (sl.kind === 'src') { srcs.push(sl); continue; }
      if (sl.kind === 'edge') {
        if (sl.tree && !placed[sl.other]) { place(sl.other); sl.x = entryX(sl.other); } else sl.x = col++;
      } else if (sl.kind === 'head' && sl.dir === 'd') {
        const kids = [];
        for (let v = 0; v < nN; v++) { const p = parent[v]; if (!placed[v] && p && p.kind === 'pair' && (p.hi === sl.hi || p.hj === sl.hi) && (p.a === u || p.b === u)) kids.push(v); }
        if (kids.length) {
          for (const v of kids) if (!placed[v]) place(v);
          const m = upHeadX.get(kids[0]); let hx = null;
          if (m) for (const [hel, x] of m) { const hh = L.els[hel].hi; for (const p of L.allPairs) if ((p[4] === sl.hi && p[5] === hh) || (p[5] === sl.hi && p[4] === hh)) hx = x; }
          sl.x = hx !== null ? hx : col++;
        } else sl.x = col++;
      } else {
        sl.x = col++;
        if (sl.kind === 'head') { let m = upHeadX.get(u); if (!m) upHeadX.set(u, m = new Map()); m.set(sl.i, sl.x); }
      }
      xs.push(sl.x);
    }
    if (!xs.length) { nx[u] = x0[u] = x1[u] = col++; }
    else { x0[u] = Math.min(...xs); x1[u] = Math.max(...xs); nx[u] = (x0[u] + x1[u]) / 2; }
    for (const sl of srcs) { if (root[u]) sl.x = nx[u]; else { sl.x = col++; x1[u] = Math.max(x1[u], sl.x); } }
  }
  for (const v of order) if (!placed[v]) place(v);
  // koordinatlar (dikey: katman aşağı, kardeşler sağa; yatay: katman sağa, kardeşler aşağı)
  const nodes = {}, items = [];
  const LX = 44, CY = 58;                          // yatay yerleşim: yarım katman x adımı, kardeş y adımı
  const P2 = (col, half) => horiz ? [half * LX, col * CY] : [col * CW, half * RH];
  const DM = horiz ? { d: 'r', u: 'l' } : { d: 'd', u: 'u' };
  for (let n = 0; n < nN; n++) { const [x, y] = P2(nx[n], layer[n] * 2); const c0 = horiz ? x0[n] * CY : x0[n] * CW, c1 = horiz ? x1[n] * CY : x1[n] * CW; nodes[n] = { x, y, x0: c0, x1: c1, vert: !!horiz }; }
  for (let n = 0; n < nN; n++) for (const sl of slots[n]) {
    const hl = layer[n] * 2; let hf;
    if (sl.kind === 'src') hf = hl - 1;
    else if (sl.kind === 'head') hf = sl.dir === 'd' ? hl + 0.55 : hl - 0.55;
    else hf = hl + 1;
    const [x, y] = P2(sl.x, hf);
    const it = { i: sl.i, t: sl.t || L.els[sl.i].t, x, y, dir: DM[sl.dir] || sl.dir };
    if (sl.t === 'bobin') it.node = n;
    items.push(it);
  }
  return { nodes, items, grid: false };
}

// ---------------------------------------------------------------- çizim örneği
function nodeState(E, n) { return E.live[n] ? 'live' : (E.earthG[E.gal[n]] ? 'earth' : 'dead'); }
function elNode(L, it) {            // tek uçlu elemanın düğümü
  if (it.t === 'bobin') return it.node; const e = L.els[it.i]; return L.nodeIdx[e.dugum];
}
function diagram(L, lv, opts) {
  opts = opts || {};
  ensureDefs();
  let lay = null; const grid = levelGrid(lv);
  if (grid) { lay = gridLayout(L, grid, opts.tr !== undefined ? !!opts.tr : chooseTr(grid, opts.box)); if (lay.missing) { console.warn('[PX.sld] ' + L.id + ': sld ızgarası eksik (' + lay.missing.slice(0, 6).join(', ') + (lay.missing.length > 6 ? ', …' : '') + ') — otomatik yerleşim'); lay = null; } }
  if (!lay) lay = autoLayout(L, !!opts.horiz);
  const busNode = new Uint8Array(L.nN); for (const b of L.baras) busNode[b.node] = 1;
  const svg = S('svg', { xmlns: NS, class: 'sld-d' }, null);
  const gW = S('g', { class: 'g-wires' }, svg), gN = S('g', { class: 'g-nodes' }, svg), gP = S('g', { class: 'g-pairs' }, svg), gE = S('g', { class: 'g-els' }, svg);
  const nodeEls = []; for (let n = 0; n < L.nN; n++) nodeEls.push([]);
  // düğüm ekseni boyunca açıklık: yatay düğümde x, dikey düğümde y
  const span = {}; for (const n in lay.nodes) { const nd = lay.nodes[n]; const c = nd.vert ? nd.y : nd.x; span[n] = [Math.min(nd.x0, c), Math.max(nd.x1, c)]; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bb = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  function wire(n, d) {
    const a = S('path', { d, class: 'w n-off' }, gW), f = S('path', { d, class: 'wf' }, gW);
    nodeEls[n].push(a, f);
  }
  const ext = (n, c) => { span[n][0] = Math.min(span[n][0], c); span[n][1] = Math.max(span[n][1], c); };
  function route(n, px, py, axis) {       // terminal (px,py) -> düğüm n (düğüm eksenine dik gelen tel düğümü uzatır)
    const nd = lay.nodes[n]; if (!nd) return;
    if (!nd.vert) { if (axis === 'v') { wire(n, `M${px},${py}V${nd.y}`); ext(n, px); } else wire(n, `M${px},${py}H${nd.x}V${nd.y}`); }
    else { if (axis === 'h') { wire(n, `M${px},${py}H${nd.x}`); ext(n, py); } else wire(n, `M${px},${py}V${nd.y}H${nd.x}`); }
  }
  const elG = {}; const items = lay.items;
  const headEye = {};
  for (const it of items) {
    const e = L.els[it.i]; const dir = it.dir || 'd'; const horiz = dir === 'r' || dir === 'l';
    const key = it.t === 'bobin' ? e.id + '.bobin' : e.id;
    const g = S('g', { class: 'el t-' + it.t, 'data-el': key, transform: `translate(${it.x},${it.y})` }, gE);
    const hit = horiz ? S('rect', { class: 'hit', x: -30, y: -26, width: 60, height: 52 }, g) : S('rect', { class: 'hit', x: -CW / 2 + 2, y: -RH + 6, width: CW - 4, height: 2 * RH - 12 }, g);
    if (horiz) S('rect', { class: 'hl', x: -20, y: -14, width: 40, height: 28, rx: 6 }, g); else S('rect', { class: 'hl', x: -14, y: -20, width: 28, height: 40, rx: 6 }, g);
    const body = S('g', { class: 'body' }, g);
    const axisOf = d => (d === 'd' || d === 'u') ? 'v' : 'h';
    const isTwo = !!TWO[it.t];
    if (isTwo) {
      const ed = L.edges[e.ei]; const tt = TERM[it.t];
      const [ax, ay] = rotP(dir, 0, -tt), [bx, by] = rotP(dir, 0, tt);
      route(ed.a, it.x + ax, it.y + ay, axisOf(dir)); route(ed.b, it.x + bx, it.y + by, axisOf(dir));
      body.setAttribute('transform', `rotate(${ROT[dir]})`);
    } else {
      const n = elNode(L, it); const tt = TERM[it.t] || 8;
      const [ax, ay] = rotP(dir, 0, -tt); route(n, it.x + ax, it.y + ay, axisOf(dir));
      if (horiz) body.setAttribute('transform', `rotate(${ROT[dir]})`);
      if (it.t === 'kafa') { const [ex, ey] = rotP(dir, 0, 6); headEye[e.hi] = [it.x + ex, it.y + ey]; }
    }
    // etiketler
    const lab = S('g', { class: 'lab' }, g);
    const end = it.t === 'yuk' || it.t === 'kondansator' || it.t === 'kaynak' || it.t === 'bobin';
    if (end) {
      const name = it.t === 'bobin' ? e.id + ' bobini' : (e.ad || e.id);
      const lines = [[it.t === 'bobin' ? name : e.id, 's-txt']];
      if (it.t !== 'bobin' && name !== e.id) for (const l of wrapWords(name, 12, 3)) lines.push([l, 's-sub']);
      if (it.t === 'yuk') { const ld = L.loads[e.li]; lines.push([`talep ${ld.d} · w ${ld.w}` + (ld.req ? '' : ' · ' + PX.STR.istege), 's-sub']); }
      if (horiz) {
        const x = dir === 'r' ? 17 : -17, an = dir === 'r' ? 'start' : 'end'; let y = -((lines.length - 1) * 10) / 2 + 3;
        for (const [s, c] of lines) { tx(lab, x, y, s, c, an); y += 10; }
        if (dir === 'r') { bb(it.x - 20, it.y - 26); bb(it.x + 92, it.y + 28); } else { bb(it.x - 92, it.y - 26); bb(it.x + 20, it.y + 28); }
      } else {
        let y = dir === 'u' ? -21 - 10 * (lines.length - 1) : 25;
        for (const [s, c] of lines) { tx(lab, 0, y, s, c, 'middle'); y += 10; }
        bb(it.x - CW / 2 - 4, it.y - (dir === 'u' ? 22 + 10 * lines.length : RH * 0.9)); bb(it.x + CW / 2 + 4, it.y + (dir === 'u' ? RH * 0.9 : 22 + 10 * lines.length));
      }
    } else {
      if (horiz) tx(lab, 0, isTwo ? -14 : -13, e.id, 's-txt', 'middle'); else tx(lab, 13, -3, e.id, 's-txt');
      if (horiz) { bb(it.x - 26, it.y - 24); bb(it.x + 26, it.y + 34); } else { bb(it.x - CW / 2, it.y - RH * 0.9); bb(it.x + CW / 2 + 4, it.y + RH * 0.9); }
    }
    // NA/NK kontak yazısı etiket grubunda: dikeyde kimliğin ALTINDA (sağda), yatayda sembolün altında (kimlik üstte).
    // Gövdeyle dönen/sola taşan yazı kimliğe ya da soldaki sütunun kimliğine biniyordu ("K1ANA", "KCANA").
    if (it.t === 'yardimci' || it.t === 'buton') { const nn = e.nc ? 'NK' : 'NA'; if (horiz) tx(lab, 0, 21, nn, 's-sub', 'middle'); else tx(lab, 13, 8, nn, 's-sub'); }
    if ((it.t === 'kesici' || it.t === 'sigorta') && e.I) tx(lab, horiz ? 0 : 13, horiz ? 21 : 8, `I>${e.I}` + (e.kademe ? ` k${e.kademe}` : ''), 's-sub', horiz ? 'middle' : null);
    if (it.t === 'trafo') tx(lab, horiz ? 0 : 13, horiz ? 21 : 8, short(/Dyn\d+/.test(e.ad || '') ? (e.ad.match(/Dyn\d+/) || [''])[0] : 'trafo', 10), 's-sub', horiz ? 'middle' : null);
    const cur = S('text', { x: horiz ? 0 : 13, y: horiz ? 31 : 18, class: 'cur' }, lab); if (horiz) cur.setAttribute('text-anchor', 'middle'); cur.textContent = '';
    const flags = S('g', { class: 'flags' }, g);
    elG[key] = { g, body, flags, cur, it, e, k: '', horiz, hit };
  }
  // dokunma alanları: olabildiğince büyük ama komşusununkiyle ÇAKIŞMAZ (çakışınca sonraki DOM düğümü dokunuşu
  // kazanıyor, yanlış cihaz seçiliyordu: F7 X1/X2, K1/K2). Çakışan çift, aralarındaki eksen boyunca ortadan bölünür.
  {
    const hs = Object.keys(elG).map(k => { const o = elG[k]; return { o, x: o.it.x, y: o.it.y, hw: o.horiz ? 30 : CW / 2 - 2, hh: o.horiz ? 26 : RH - 6 }; });
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j]; const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx >= a.hw + b.hw || dy >= a.hh + b.hh) continue;
      if (dy >= dx) { const m = Math.max(4, dy / 2 - 0.5); a.hh = Math.min(a.hh, m); b.hh = Math.min(b.hh, m); }
      else { const m = Math.max(4, dx / 2 - 0.5); a.hw = Math.min(a.hw, m); b.hw = Math.min(b.hw, m); }
    }
    for (const q of hs) { const r = q.o.hit; r.setAttribute('x', -q.hw); r.setAttribute('y', -q.hh); r.setAttribute('width', 2 * q.hw); r.setAttribute('height', 2 * q.hh); }
  }
  // düğümler (bara / bağlantı hattı)
  const kvSeen = new Set([0.4]);
  for (let n = 0; n < L.nN; n++) {
    const nd = lay.nodes[n]; if (!nd) continue; const [a, b] = span[n]; const V = !!nd.vert;
    const bus = busNode[n] || (lay.grid && nd.x1 > nd.x0);
    let el = null;
    if (bus) el = V ? S('rect', { x: nd.x - 3, y: a - 10, width: 6, height: b - a + 20, rx: 1.5, class: 'busbar' }, gN) : S('rect', { x: a - 10, y: nd.y - 3, width: b - a + 20, height: 6, rx: 1.5, class: 'busbar' }, gN);
    else if (b - a > 0.5) { const d = V ? `M${nd.x},${a}V${b}` : `M${a},${nd.y}H${b}`; el = S('path', { d, class: 'w n-off' }, gN); nodeEls[n].push(S('path', { d, class: 'wf' }, gN)); }
    else el = S('circle', { cx: nd.x, cy: nd.y, r: 2.6, class: 'busbar' }, gN);
    nodeEls[n].unshift(el);
    const lx = V ? nd.x : a - 12, ly = V ? a - 14 : nd.y - 6, an = V ? 'middle' : 'end';
    if (bus) {
      const bi = L.baras.findIndex(x => x.node === n); const nm = bi >= 0 ? L.els[L.baras[bi].el].id : L.nodeNames[n];
      tx(gN, lx, ly, nm, 's-txt', an); if (bi >= 0) tx(gN, V ? nd.x : lx, V ? ly - 15 : nd.y + 12, 'yaklaşma ' + L.baras[bi].r, 's-sub', an);
      if (V) bb(nd.x - 30, a - 40); else bb(a - 70, nd.y);
    } else if (!kvSeen.has(L.kv[n])) {
      kvSeen.add(L.kv[n]); tx(gN, V ? nd.x + 6 : a - 6, V ? a - 6 : nd.y - 5, (String(L.kv[n]).replace('.', ',')) + ' kV', 's-sub', V ? 'start' : 'end');
      if (V) bb(nd.x + 46, a - 14); else bb(a - 46, nd.y);
    }
    if (V) { bb(nd.x - 8, a - 12); bb(nd.x + 8, b + 12); } else { bb(a - 12, nd.y - 8); bb(b + 12, nd.y + 8); }
  }
  const W = Math.ceil(maxX - minX + 2 * PAD), H = Math.ceil(maxY - minY + 2 * PAD);
  svg.setAttribute('viewBox', `${Math.floor(minX - PAD)} ${Math.floor(minY - PAD)} ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const nodeCls = new Array(L.nN).fill('');
  let hot = null; let lastS = null, lastE = null;
  const D = {
    svg, W, H, L, lay, elG,
    update(s, E, extra) {
      if (!s) return; E = E || SIM.stateE(L, s); lastS = s; lastE = E; extra = extra || {};
      for (let n = 0; n < L.nN; n++) {
        const st = nodeState(E, n); if (nodeCls[n] === st) continue; nodeCls[n] = st;
        for (const el of nodeEls[n]) { const base = el.classList.contains('wf') ? 'wf' : el.classList.contains('busbar') ? 'busbar' : 'w'; el.setAttribute('class', base + ' n-' + st); }
      }
      const showCur = !!extra.cur;
      for (const id in elG) {
        const o = elG[id], e = o.e, it = o.it; const st = elemState(L, s, E, e, it, extra); if (it.t === 'yardimci' || it.t === 'buton') st.extLab = 1;
        const k = JSON.stringify(st) + (showCur ? 'c' : '');
        if (k !== o.k) {
          o.k = k; o.body.textContent = ''; o.flags.textContent = '';
          const f = it.dir === 'u' && !TWO[it.t] ? -1 : 1;
          (SYM[it.t] || SYM.kablo)(o.body, st, f);
          if (ROT[it.dir] && (TWO[it.t] || it.dir === 'r' || it.dir === 'l')) for (const t of o.body.querySelectorAll('text')) t.setAttribute('transform', `rotate(${-ROT[it.dir]} ${t.getAttribute('x')} ${t.getAttribute('y')})`);
          o.g.classList.toggle('locked', !!st.locked);
          o.g.classList.toggle('cl-live', !!st.condLive);
          if (st.locked) lockIcon(o.flags, 12, (it.t === 'kafa' ? -2 : 6) + 10);
          if (st.blown) flag(o.flags, 12, 18, PX.STR.eridi, '#a0461e');
          if (st.tripped) flag(o.flags, 12, 18, PX.STR.acti, '#a0461e');
          if (it.t === 'ariza' && st.live) flag(o.flags, 10, 4, 'ARIZA', '#8a2030');
          if (st.setOn) { earthMark(o.flags, 12, 0.8); flag(o.flags, 10, 30, 'TAKIM', '#3a6a1e'); }
        }
        if (showCur && e.ei !== undefined) { const I = E.cur ? E.cur[e.ei] : 0; o.cur.textContent = I > 1e-6 ? PX.tnum(I, 1) : ''; }
        else if (o.cur.textContent) o.cur.textContent = '';
      }
    },
    highlight(id) {
      if (hot && elG[hot]) elG[hot].g.classList.remove('hot');
      hot = id && elG[id] ? id : null;
      if (hot) elG[hot].g.classList.add('hot');
      return hot ? elG[hot].g : null;
    },
    refresh(extra) { if (lastS) D.update(lastS, lastE, extra); },
  };
  return D;
}
// eleman görsel durumu (sunum durumundan)
const tripped = new Set();
function elemState(L, s, E, e, it, extra) {
  const st = {};
  if (it.t === 'bobin') { st.live = !!E.live[it.node]; return st; }
  if (e.bit !== undefined) st.closed = !!((s.b >> e.bit) & 1);
  if (e.t === 'yardimci') { const ed = L.edges[e.ei]; st.nc = !!e.nc; st.closed = (((s.b >> ed.of) & 1) === 1) !== !!e.nc; }
  if (e.t === 'buton') { st.nc = !!e.nc; st.closed = !!e.nc; }
  if (e.t === 'kesici') st.cekmeli = !!e.cekmeli;
  if (e.lk >= 0 && ((s.lk >> e.lk) & 1)) st.locked = true;
  if (e.t === 'sigorta' && !st.closed) st.blown = true;
  if (e.t === 'kesici' && !st.closed && tripped.has(e.id)) st.tripped = true;
  if (e.t === 'kondansator') st.charge = Math.floor(s.ch / Math.pow(4, e.ci)) % 4;
  if (e.t === 'yuk') { st.fed = !!((E.loadMask >> e.li) & 1); st.motor = /motor|pompa|kompres|konvey/i.test(e.ad || ''); }
  if (e.t === 'kaynak') { st.live = true; st.gen = /dizel|jenerat/i.test(e.ad || ''); }
  if (e.t === 'ariza') st.live = !!E.live[L.nodeIdx[e.dugum]];
  if (e.t === 'bara' && s.st === e.bi + 1) st.setOn = true;
  if (e.ei !== undefined && st.closed) st.condLive = !!E.live[L.edges[e.ei].a];
  return st;
}

// ---------------------------------------------------------------- mini şemalar (kartlar)
// items: [{t:'kaynak'} | {n:'live'|'dead'|'earth'} | {t:'kesici', c:1, mark:'arc'|'x'|'ok'|'lock'} | {t:'toprak', c:1, down:true} | {t:'yuk', fed}]
function mini(items, opts) {
  ensureDefs(); opts = opts || {};
  const svg = S('svg', { xmlns: NS, class: 'mini-d' }, null);
  const gW = S('g', null, svg), gE = S('g', null, svg);
  let x = 0; const y = 0; let state = 'live'; let maxY = 22, minY = -22; let ended = false; const GAP = 14;
  const seg = (x1, x2) => { if (x2 <= x1) return; const d = `M${x1},${y}H${x2}`; S('path', { d, class: 'w n-' + state }, gW); S('path', { d, class: 'wf n-' + state }, gW); };
  for (const it of items) {
    if (it.n) { state = it.n; continue; }
    ended = it.t === 'yuk' || it.t === 'kondansator' || it.t === 'bobin';
    const g = S('g', null, gE); const st = { closed: !!it.c, fed: !!it.fed, charge: it.charge || 0, cekmeli: !!it.cekmeli, nc: !!it.nc, live: state === 'live', motor: !!it.motor };
    if (it.t === 'kaynak') {
      st.live = true;
      if (x === 0) { g.setAttribute('transform', `translate(${x + 12},${y})`); SYM.kaynak(g, st, 1); x += 22; }
      else { seg(x, x + 8); g.setAttribute('transform', `translate(${x + 18},${y})`); SYM.kaynak(g, st, 1); x += 28; }
      continue;
    }
    if (it.down) {                                   // dal: hattan aşağı
      seg(x, x + 22); const bx = x + 11; const gg = S('g', { transform: `translate(${bx},${y + 24})` }, gE);
      S('path', { d: `M${bx},${y}V${y + 24 - (TERM[it.t] || 8)}`, class: 'w n-' + state }, gW);
      SYM[it.t](gg, st, 1); maxY = Math.max(maxY, 46); mark(gg, it.mark, 0, 0); x += 22; continue;
    }
    if (it.t === 'yuk' || it.t === 'kondansator' || it.t === 'bobin') {
      seg(x, x + 10); g.setAttribute('transform', `translate(${x + 10 + TERM[it.t]},${y}) rotate(-90)`); SYM[it.t](g, st, 1); mark(g, it.mark, 0, 0); x += 32; continue;
    }
    // iki uçlu satır içi
    const tt = TERM[it.t] || 9; seg(x, x + GAP);
    g.setAttribute('transform', `translate(${x + GAP + tt},${y}) rotate(-90)`); SYM[it.t](g, st, 1);
    for (const t of g.querySelectorAll('text')) t.setAttribute('transform', `rotate(90 ${t.getAttribute('x')} ${t.getAttribute('y')})`);
    mark(S('g', { transform: `translate(${x + GAP + tt},${y})` }, gE), it.mark, 0, 0);
    if (it.label) { tx(gE, x + GAP + tt, y + 22, it.label, 's-sub', 'middle'); maxY = Math.max(maxY, 26); }
    x += GAP + 2 * tt;
    if (it.after) state = it.after;
  }
  if (!ended) { seg(x, x + 8); x += 8; }
  const W = x + 8, H = maxY - minY + 8;
  svg.setAttribute('viewBox', `-4 ${minY - 4} ${W} ${H}`);
  const sc = opts.scale || 1; svg.setAttribute('width', Math.round(W * sc)); svg.setAttribute('height', Math.round(H * sc));
  return svg;
}
function mark(g, m, x, y) {
  if (!m) return;
  if (Array.isArray(m)) { for (const k of m) mark(g, k, x, y); return; }
  if (m === 'arc') { pth(g, `M${x - 6},${y - 12} l4,4 l-3,2 l5,5`, 's-sym arcm'); pth(g, `M${x + 7},${y - 12} l-3,4 l3,2 l-4,5`, 's-sym arcm'); }
  else if (m === 'x') { const k = S('g', { transform: `translate(${x + 10},${y - 12})` }, g); S('circle', { r: 6, fill: '#8a2030' }, k); ln(k, -2.5, -2.5, 2.5, 2.5, 's-sym wht'); ln(k, 2.5, -2.5, -2.5, 2.5, 's-sym wht'); }
  else if (m === 'ok') { const k = S('g', { transform: `translate(${x + 10},${y - 12})` }, g); S('circle', { r: 6, fill: '#1f6e48' }, k); pth(k, 'M-3,0 l2,2.5 l4,-5', 's-sym wht'); }
  else if (m === 'lock') { lockIcon(g, x + 8, y - 6); }
  else if (m === 'eye') { pth(g, `M${x - 7},${y - 14} Q${x},${y - 21} ${x + 7},${y - 14} Q${x},${y - 7} ${x - 7},${y - 14} Z`, 's-sym'); }
}

// ---------------------------------------------------------------- panel
const P = { L: null, lv: null, D: null, open: false, s: null, E: null, view: 0, hot: null, fitScale: 1, curOn: false, roPending: false, zoomFit: false };
// şerit için kısa yük adı: çok yük varsa ilk sözcük ("Kompresör motoru" -> "Kompresör")
function stripLim(n) { return n <= 2 ? 18 : n > 3 ? 9 : 12; }
function stripName(e, n) {
  const ad = String(e.ad || e.id); if (n <= 2 || ad.length <= 10) return short(ad, n <= 2 ? 18 : 16);
  const w = ad.split(/[\s(,]+/)[0]; return short(w.length >= 3 ? w : ad, stripLim(n));
}
// İki yüklü seviyede ad 18 karaktere kadar tam yazılır (F4/F7 "Temiz su pompası-1/-2" eskiden ikisi de "Temiz su
// pompas…" oluyordu). Kısaltılmış adlar yine çakışırsa cihaz kimliği öne eklenir (Y1/Y2): şerit hangi yükün
// beslendiğini göstermek için vardır, iki aynı etiket bu işi yapamaz.
function stripNames(L) {
  const n = L.loads.length; const out = L.loads.map(ld => stripName(L.els[ld.el], n));
  return out.map((x, i) => out.indexOf(x) !== out.lastIndexOf(x) ? L.els[L.loads[i].el].id + ' ' + short(x, Math.max(5, stripLim(n) - 3)) : x);
}
function stripRender() {
  const L = P.L, s = P.s, E = P.E; const box = $('sld-sum'); if (!box) return;
  box.textContent = ''; if (!L || !s || !E) return;
  const l1 = document.createElement('div'); l1.className = 'ln'; const names = stripNames(L);
  L.loads.forEach((ld, i) => {
    const e = L.els[ld.el]; const on = !!((E.loadMask >> i) & 1);
    const sp = document.createElement('span'); sp.className = 'ld ' + (on ? 'on' : 'off'); sp.title = (e.ad || e.id) + (on ? ' — besleniyor' : ' — beslenmiyor');
    const k = document.createElement('b'); k.className = 'lk'; k.textContent = on ? '✓' : '✗'; sp.appendChild(k);
    sp.appendChild(document.createTextNode(' ' + names[i])); l1.appendChild(sp);
  });
  box.appendChild(l1);
  const l2 = document.createElement('div'); l2.className = 'ln';
  const tag = (cls, txt, title) => { const t = document.createElement('span'); t.className = 'tag ' + cls; t.textContent = txt; if (title) t.title = title; l2.appendChild(t); return t; };
  if (L.zone.length) {
    const lab = document.createElement('span'); lab.className = 'lb'; lab.textContent = PX.STR.isBolgesi + ':'; l2.appendChild(lab);
    if (s.w) tag('ok', '✓ ' + PX.STR.isYapildi);
    else {
      let live = false, unearthed = false; for (const z of L.zone) { if (E.live[z]) live = true; else if (!SIM.rigidEarthed(L, s.b, s.st, z)) unearthed = true; }
      if (live) tag('live', PX.STR.canli);
      else if (unearthed) tag('dead', PX.STR.oluTopraksiz.split(' (')[0], PX.STR.oluTopraksiz);
      else if (!SIM.isolatedWC(L, s.lk, L.zone)) tag('warn', '⚠ ' + PX.STR.isKilitsiz, PX.STR.ERR.is_kilit);
      else tag('earth', '✓ ' + PX.STR.isHazir);
    }
    l2.lastChild.classList.add('zs');                 // iş bölgesi durumu: şeritte kısaltılmaz
  }
  let hz = 0; const chg = new Set(); L.caps.forEach((c, i) => { if (Math.floor(s.ch / Math.pow(4, i)) % 4 > 0) { chg.add(E.gal[c.node]); hz++; } });
  for (const b of L.baras) if (E.live[b.node] || !SIM.rigidEarthed(L, s.b, s.st, b.node) || chg.has(E.gal[b.node])) hz++;
  if (L.baras.length || L.caps.length) { const t = tag((hz ? 'warn' : 'ok') + ' hz', hz ? '⚠ ' + PX.STR.tehlike + ' ' + hz : PX.STR.tehlikeYok, PX.STR.kural.bara[1]); t.dataset.k = hz ? '⚠ ' + hz : '✓ 0'; }
  // kompanzasyon durumu F bölümünde seviyenin HEDEFİdir: kısa biçim, şeritte kısalmaz (.rk), uzun biçim başlıkta
  if (L.cosphi) { const r = SIM.reaktif(L, E); if (r) { const v = { ind: PX.tnum(r.ind, 0), kap: PX.tnum(r.kap, 0) }; tag((SIM.cosOk(L, E) ? 'ok' : 'warn') + ' rk', PX.t('reaktifSeritKisa', v), PX.t('reaktifSerit', v)); } }
  if (l2.childNodes.length) { box.appendChild(l2); fitLine(l2); }
}
// Dar şeritte (dikey 375 px) 2. satır sığmazsa önce "İş bölgesi:" -> "İş:", sonra "⚠ Tehlike 2" -> "⚠ 2" kısalır;
// iş bölgesi durumu (CANLI…) ve kompanzasyon etiketi hiç kısalmaz (yalnız durum değişince ölçülür, kare başına değil)
function fitLine(l2) {
  const over = () => l2.scrollWidth > l2.clientWidth + 1 || [...l2.children].some(c => c.scrollWidth > c.clientWidth + 1);
  if (!over()) return; const lb = l2.querySelector('.lb'); if (lb) lb.textContent = PX.STR.isKisa;
  if (!over()) return; const t = l2.querySelector('.hz'); if (t) t.textContent = t.dataset.k;
}
function legendRender() {
  const box = $('sld-legend'); if (!box) return; box.textContent = ''; const L = P.L; if (!L) return;
  const T = PX.STR; const add = (cls, txt, title) => { const t = document.createElement('span'); t.className = 'tag ' + cls; t.textContent = txt; t.title = title; box.appendChild(t); };
  add('live', T.canli, T.lejant.canli); add('dead', T.olu + ' — topraksız', T.lejant.oluTopraksiz); add('earth', T.toprakli, T.lejant.toprakli);
  if (L.lockable.length) add('lock', '🔒 ' + T.kilitli, T.lejant.kilitli);
}
function fit() {
  const D = P.D; const sc = $('sld-scroll'); if (!D || !sc) return;
  const w = sc.clientWidth - 8, hh = sc.clientHeight - 8; if (w <= 0) return;
  // Dokunmatikte okunur alt sınır 0,88 (kimlik 11 px -> ~9,7 px, alt yazı 9,5 -> ~8,4 px); eski 0,64 tabanı yazıları
  // 5–7 px'e indiriyordu. Bütün şemayı bir bakışta görmek için "sığdır" düğmesi (#sld-zoom) tabanı kaldırır.
  const fitK = Math.min(1.25, w / D.W, hh > 40 ? hh / D.H : 9);
  const kmin = P.zoomFit ? 0.2 : matchMedia('(pointer: coarse)').matches ? 0.88 : 0.6; const k = Math.max(kmin, fitK);
  const zb = $('sld-zoom'); if (zb) zb.hidden = !P.zoomFit && fitK >= (matchMedia('(pointer: coarse)').matches ? 0.88 : 0.6) - 1e-3;
  D.svg.style.width = Math.round(D.W * k) + 'px'; D.svg.style.height = Math.round(D.H * k) + 'px';
  // dikeyde de ortala (kaydırma gerekmiyorsa)
  D.svg.style.marginTop = hh > D.H * k ? Math.floor((hh - D.H * k) / 2) + 'px' : '0';
  P.fitScale = k;
}
function setZoomFit(on) {
  P.zoomFit = !!on; const zb = $('sld-zoom');
  if (zb) { zb.setAttribute('aria-pressed', String(P.zoomFit)); const t = P.zoomFit ? PX.STR.tekHatYakin : PX.STR.tekHatSigdir; zb.setAttribute('aria-label', t); zb.title = t; }
  fit(); if (!P.zoomFit && P.hot) scrollToHot();
}
function setOpen(on) {
  on = !!on; P.open = on;
  const app = $('app'); app.classList.toggle('sld-open', on);
  const tg = $('sld-toggle'); if (tg) { tg.setAttribute('aria-expanded', String(on)); tg.setAttribute('aria-label', on ? PX.STR.tekHatKapat : PX.STR.tekHatAc); }
  if (PX.scene && PX.scene.resize) PX.scene.resize(false);
  if (on) { fit(); if (P.hot) scrollToHot(); }
  PX.bus.emit('sld:open', { open: isOpenEff() });
  return on;
}
function isOpenEff() { return P.open || (window.matchMedia && matchMedia('(orientation: landscape) and (min-width: 560px)').matches); }
function scrollToHot() {
  const D = P.D; if (!D || !P.hot || !D.elG[P.hot]) return; const sc = $('sld-scroll'); const it = D.elG[P.hot].it;
  const vb = D.svg.viewBox.baseVal; const k = P.fitScale;
  const x = (it.x - vb.x) * k, y = (it.y - vb.y) * k;
  sc.scrollTo({ left: Math.max(0, x - sc.clientWidth / 2), top: Math.max(0, y - sc.clientHeight / 2), behavior: document.getElementById('app').classList.contains('rm') ? 'auto' : 'smooth' });
}
function highlight(id) {
  P.hot = id || null; if (P.D) P.D.highlight(P.hot); if (P.hot && isOpenEff()) scrollToHot();
}
function curSetting() { try { return !!(PX.store && PX.store.get('ayar.akim')); } catch (e) { return false; } }
function refresh() { if (P.D && P.s) P.D.update(P.s, P.E, { cur: curSetting(), view: P.view }); }
// dikey telefonda panel geniş ve alçaktır: katmanlar sağa akar (yatay); yatay ekranda sağ sütun dar ve uzundur (dikey)
function wantHoriz() { return !(window.matchMedia && matchMedia('(orientation: landscape) and (min-width: 560px)').matches); }
// açık panelin yaklaşık iç kutusu (kapalıyken de hesaplanabilir; yerleşim yönelimi seçimi için)
function panelBox() {
  const W = window.innerWidth || 375, Hh = window.innerHeight || 667;
  if (!wantHoriz()) { const sb = $('sld'); const w = sb && sb.clientWidth ? sb.clientWidth : W * 0.34; return [w - 12, Hh - 140]; }
  return [W - 12, Hh * 0.42 - 64 - 30];
}
function build() {
  if (!P.L) return; const host = $('sld-svg'); P.horiz = wantHoriz();
  let D = null; try { D = diagram(P.L, P.lv, { interactive: true, horiz: P.horiz, box: panelBox() }); } catch (e) { console.error('[PX.sld] çizilemedi', e); }
  P.D = D;
  if (host && D) { host.replaceWith(D.svg); D.svg.id = 'sld-svg'; D.svg.setAttribute('role', 'img'); D.svg.setAttribute('aria-label', 'Tek hat şeması: ' + ((P.lv && P.lv.ad) || P.L.id)); bindSvg(D.svg); }
  if (D && P.hot) D.highlight(P.hot);
  refresh(); fit();
}
function onLevel(p) {
  P.L = p.L; P.lv = p.level; P.s = p.s; P.E = SIM.stateE(p.L, p.s); P.view = p.view | 0; P.hot = null; tripped.clear();
  build(); stripRender(); legendRender();
}
function onElec(p) {
  if (!P.L) return; P.s = p.s || P.s; P.E = p.E || SIM.stateE(P.L, P.s); refresh(); stripRender();
}
function bindSvg(svg) {
  let t0 = null, lp = 0, moved = false, sx = 0, sy = 0, fired = false;
  const target = ev => { const g = ev.target && ev.target.closest ? ev.target.closest('.el') : null; return g ? g.getAttribute('data-el') : null; };
  svg.addEventListener('pointerdown', ev => {
    const id = target(ev); moved = false; fired = false; sx = ev.clientX; sy = ev.clientY; clearTimeout(lp);
    if (!id) return; t0 = id;
    lp = setTimeout(() => { if (!moved && t0 === id) { fired = true; info(id); } }, 450);
  });
  svg.addEventListener('pointermove', ev => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 8) { moved = true; clearTimeout(lp); } });
  const end = () => clearTimeout(lp);
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', () => { moved = true; end(); });
  svg.addEventListener('click', ev => {
    if (fired) { fired = false; return; }
    const id = target(ev); if (!id || !P.L) return;
    const e = P.L.els[P.L.elIndex[id.split('.')[0]]]; if (!e) return;
    highlight(e.id); PX.bus.emit('sld:select', { el: e.id });
    if (e.cell >= 0 && PX.game && PX.game.command) PX.game.command({ t: 'tap', cell: e.cell });
  });
  svg.addEventListener('contextmenu', ev => ev.preventDefault());
}
function info(id) { const e = P.L && P.L.els[P.L.elIndex[id.split('.')[0]]]; if (e && PX.cards && PX.cards.device) PX.cards.device(e, P.L, P.s, P.E); }

function init() {
  ensureDefs();
  const tap = (el, fn) => { if (!el) return; if (PX.hud && PX.hud.onTap) PX.hud.onTap(el, fn); else el.addEventListener('click', fn); };
  tap($('sld-toggle'), () => setOpen(!P.open));
  tap($('sld-zoom'), () => setZoomFit(!P.zoomFit));
  const strip = $('sld-strip');
  if (strip) {
    let y0 = null, done = false;
    strip.addEventListener('pointerdown', ev => { y0 = ev.clientY; done = false; });
    strip.addEventListener('pointermove', ev => { if (y0 === null || done) return; const dy = ev.clientY - y0; if (dy < -22 && !P.open) { done = true; setOpen(true); } else if (dy > 22 && P.open) { done = true; setOpen(false); } });
    strip.addEventListener('pointerup', ev => { if (y0 !== null && !done && ev.target && ev.target.closest && ev.target.closest('#sld-sum')) setOpen(!P.open); y0 = null; });
    strip.addEventListener('pointercancel', () => { y0 = null; });
  }
  const sc = $('sld-scroll');
  if (sc && window.ResizeObserver) new ResizeObserver(() => { if (P.roPending) return; P.roPending = true; requestAnimationFrame(() => { P.roPending = false; fit(); }); }).observe(sc);
  PX.bus.on('level:loaded', onLevel);
  PX.bus.on('elec:changed', onElec);
  PX.bus.on('anim:step', p => {
    if (!P.L) return;
    if (p.trips && p.trips.length) for (const id of p.trips) tripped.add(id);
    if (p.a && p.a.t === 'op' && P.L.els[p.a.e]) tripped.delete(P.L.els[p.a.e].id);
  });
  // geri al / yinele / baştan: ağır SVG yeniden çizimi bir sonraki kareye ertelenir (render isteği #3: geri al →
  // ilk hareket ≤ 34 ms; Volti/kamera aynı karede başlar, panel bir kare sonra). Ardışık olaylar tek çizimde birleşir.
  let redrawRaf = 0;
  const redrawLater = () => { if (redrawRaf) return; redrawRaf = requestAnimationFrame(() => { redrawRaf = 0; if (!P.L) return; refresh(); stripRender(); }); };
  for (const ev of ['undo', 'redo', 'reset']) PX.bus.on(ev, () => { if (!P.L) return; tripped.clear(); const st = PX.game.state(); P.s = st.presentation.s || st.s; P.view = st.view | 0; P.E = SIM.stateE(P.L, P.s); redrawLater(); });
  PX.bus.on('ui:chip', p => highlight(p && p.el ? p.el : null));
  PX.bus.on('cmd:accepted', p => { if (p.a && p.a.e !== undefined && P.L && P.L.els[p.a.e]) highlight(P.L.els[p.a.e].id); });
  PX.bus.on('settings', () => refresh());
  window.addEventListener('resize', () => {
    if (!P.L) return; const tr = P.D && P.D.lay && P.D.lay.grid ? chooseTr(levelGrid(P.lv), panelBox()) : null;
    if (P.horiz !== wantHoriz() || (tr !== null && tr !== !!P.D.lay.tr)) build(); else if (P.open || isOpenEff()) fit();
  });
}
PX.sld = {
  init, open(on) { return setOpen(on === undefined ? !P.open : on); }, get isOpen() { return isOpenEff(); }, highlight,
  diagram, mini, nodeState, SYM, refresh, strip: stripRender, zoomFit: setZoomFit, wrapWords, stripNames, get scale() { return P.fitScale; },
};
