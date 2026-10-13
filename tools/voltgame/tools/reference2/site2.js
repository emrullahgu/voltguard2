'use strict';
// ============================================================================
// PARALAKS: TEK HAT — site2.js : saha (fiziksel diorama) yardımcıları, kural sürümü 4
// Seviye haritasını sütun tabanlı bir "saha" tanımından üretir ve geri çözer; gen2 ve elle tasarım ortak kullanır.
//
//  saha (rep) = { W, D,
//    h:   [W*D] sütun yüksekliği (blok sayısı; 0 = zemin yok / boşluk). Sütun c = x + W*z.
//    duvar: [W*D] true ise sütunun blokları '%' (duvar/çit: üstü yürünmez, tehlike sınırı, bölme)
//    eq:  {elemanId: c}  eleman küpü c sütununun ÜSTÜNE (katman h[c]) oturur; Volti aynı yükseklikteki komşu karodan erişir
//    st:  {c: yön}  merdiven: c sütununun üstünde (katman h[c]); yön = YUKARI çıkış (0 +x, 1 −x, 2 +z, 3 −z).
//                   Alt sahanlık c−yön (h aynı), üst sahanlık c+yön (h+1) olmalı.
//    ld:  {c: yön}  iskele (el merdiveni): ayağı c sütununun karosu; yön tarafındaki daha yüksek sütunun tepesine çıkar
//                   (basamaklar katman h[c] .. h[duvar]−1).
//    start, work: sütun (karo) ; extra: {c: [[y, ch], …]} elle ek hücreler (asma kat döşemesi vb.)
//  }
//  build(rep, cells)   -> { map, hucre }   (cells: eq anahtarlarının harf sırası; varsayılan Object.keys(eq))
//  parse(def)          -> rep              (asma kat/üst üste blok gibi sütun dışı yapılar 'extra' olarak korunur)
//  ascii(L | def)      -> üstten görünüş (yükseklik + içerik) — tasarımcı ve rapor için
// ============================================================================
const STAIR_CH = ['>', '<', 'v', '^'];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CHARS = 'ABCDEFGHIJKLMNOPQRTUXYZabcdefghijklmnopqrtuxyz0123456789';   // ayrılmış: s w v % = > < ^ # . | /

function laddTop(rep, c) { const { W } = rep; const d = rep.ld[c]; const x = c % W, z = Math.floor(c / W); const q = (x + DIRS[d][0]) + W * (z + DIRS[d][1]); return q; }
function build(rep, cells, doors) {
  const { W, D } = rep; const N = W * D; const h = rep.h; cells = cells || Object.keys(rep.eq || {});
  let H = 1;
  for (let c = 0; c < N; c++) H = Math.max(H, h[c] + ((rep.eq && Object.values(rep.eq).includes(c)) || (rep.st && rep.st[c] !== undefined) || (doors && Object.values(doors).includes(c)) ? 1 : 0));
  for (const c in rep.ld || {}) { const q = laddTop(rep, +c); H = Math.max(H, h[q]); }
  for (const c in rep.extra || {}) for (const [y] of rep.extra[c]) H = Math.max(H, y + 1);
  const g = []; for (let y = 0; y < H; y++) { g.push([]); for (let z = 0; z < D; z++) g[y].push(new Array(W).fill('.')); }
  const put = (c, y, ch) => { const x = c % W, z = Math.floor(c / W); if (g[y][z][x] !== '.' && g[y][z][x] !== '#') throw new Error(`site2: (${x},${y},${z}) iki kez dolu (${g[y][z][x]} / ${ch})`); g[y][z][x] = ch; };
  for (let c = 0; c < N; c++) for (let y = 0; y < h[c]; y++) put(c, y, rep.duvar && rep.duvar[c] ? '%' : '#');
  const hucre = {}; let k = 0;
  for (const id of cells) { const c = rep.eq[id]; const ch = CHARS[k++]; put(c, h[c], ch); hucre[ch] = id; }
  for (const id of Object.keys(doors || {})) { const c = doors[id]; const ch = CHARS[k++]; put(c, h[c], ch); hucre[ch] = id; }
  for (const c in rep.st || {}) put(+c, h[+c], STAIR_CH[rep.st[c]]);
  for (const c in rep.ld || {}) { const q = laddTop(rep, +c); for (let y = h[+c]; y < h[q]; y++) put(+c, y, '='); }
  for (const c in rep.extra || {}) for (const [y, ch] of rep.extra[c]) { const x = +c % W, z = Math.floor(+c / W); g[y][z][x] = ch; }
  const top = (c, ch) => { const x = c % W, z = Math.floor(c / W); g[h[c] - 1][z][x] = ch; };
  top(rep.start, 's'); if (rep.work !== undefined && rep.work >= 0) top(rep.work, 'w');
  return { map: g.map(l => l.map(r => r.join('')).join('/')).join('|'), hucre };
}
// haritayı sütun sahasına çevir (yalnız "sütun" biçimindeki haritalar tam çözülür)
function parse(def) {
  const layers = def.map.split('|').map(l => l.split('/')); const H = layers.length, D = layers[0].length, W = layers[0][0].length;
  const rep = { W, D, h: new Array(W * D).fill(0), duvar: new Array(W * D).fill(false), eq: {}, st: {}, ld: {}, doors: {}, start: -1, work: -1, extra: {} };
  const kapi = new Set((def.el || []).filter(e => e.t === 'kapi').map(e => e.id));
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) { const c = x + W * z; let y = 0;
    while (y < H && '#sw%'.includes(layers[y][z][x])) { const ch = layers[y][z][x]; if (ch === 's') rep.start = c; if (ch === 'w') rep.work = c; if (ch === '%') rep.duvar[c] = true; y++; }
    rep.h[c] = y;
    if (y < H) { const ch = layers[y][z][x];
      if (STAIR_CH.includes(ch)) rep.st[c] = STAIR_CH.indexOf(ch);
      else if (ch === '=') { for (let d = 0; d < 4; d++) { const xx = x + DIRS[d][0], zz = z + DIRS[d][1]; if (xx >= 0 && zz >= 0 && xx < W && zz < D && '#sw%'.includes(layers[y][zz][xx])) { rep.ld[c] = d; break; } } }
      else if (ch !== '.') { const id = def.hucre[ch]; if (kapi.has(id)) rep.doors[id] = c; else rep.eq[id] = c; } }
    for (let yy = y + 1; yy < H; yy++) { const ch = layers[yy][z][x]; if (ch !== '.' && ch !== '=') (rep.extra[c] = rep.extra[c] || []).push([yy, ch]); }
  }
  return rep;
}
// üstten görünüş: her hücre "yükseklik + içerik" (. karo, s başlangıç, w iş, harf eleman, > < v ^ merdiven, = iskele, % duvar, D kapı)
function ascii(def) {
  const rep = parse(def); const { W, D } = rep; const inv = {}; for (const id in rep.eq) inv[rep.eq[id]] = id; for (const id in rep.doors) inv[rep.doors[id]] = id + '⌂';
  const rows = [];
  rows.push('     ' + Array.from({ length: W }, (_, x) => ('x' + x).padEnd(6)).join(''));
  for (let z = 0; z < D; z++) { let r = ('z' + z).padEnd(5);
    for (let x = 0; x < W; x++) { const c = x + W * z; let t = rep.h[c] ? String(rep.h[c]) : ' ';
      if (inv[c]) t += inv[c]; else if (rep.st[c] !== undefined) t += STAIR_CH[rep.st[c]]; else if (rep.ld[c] !== undefined) t += '=' + STAIR_CH[rep.ld[c]];
      else if (rep.duvar[c]) t += '%'; else if (c === rep.start) t += 's'; else if (c === rep.work) t += 'w'; else if (rep.h[c]) t += '.';
      if (rep.extra[c]) t += '+' + rep.extra[c].map(e => e[1]).join('');
      r += t.padEnd(6); }
    rows.push(r); }
  return rows.join('\n');
}
module.exports = { build, parse, ascii, CHARS, STAIR_CH, DIRS };
