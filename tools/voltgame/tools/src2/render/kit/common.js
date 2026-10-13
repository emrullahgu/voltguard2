// ============================================================================
// render/kit/common.js — PX.KIT çekirdeği: geometri kurucu, doku atlası, paylaşımlı malzeme, durum kanalları
//                                                                             sahip: Sanat (kits)
// Sözleşme (§24.2): PX.KIT[tip](el, biyom, ctx?) -> {obj, setState(st), anchor, hit, act(kind), kit, info}
//   tip   = sim2 eleman tipi (kaynak, yuk, kesici, ayirici, yuk_ayirici, toprak, sigorta, kontaktor, buton,
//           kondansator, bara, ariza, trafo, kablo, yardimci, kapi); bilinmeyen tip -> PX.KIT.default
//           Yapılar (kural sürümü 4): PX.KIT.merdiven / iskele / kapi / structGeo (render/kit/structure.js)
//   biyom = 'Depo' | 'Volt Mahallesi' | 'Trafo Merkezi' | 'Fabrika' (bilinmeyen -> Depo paleti)
//   ctx   = (isteğe bağlı) {L, yaw, kv}. Yoksa L = PX.diorama.L / PX.render.L (diorama.build sırasında hazır).
//   obj   = TEK THREE.Mesh (tek çizim çağrısı): birim küp hücresine sığar, merkez (0,0,0) = hücre merkezi,
//           bütün köşeler |x|,|z| <= 0.47, -0.5 <= y <= 0.48 (komşu karoların üstüne asla taşmaz).
//           obj.rotation.y ön yüzü (yerel +z) Volti'nin erişim karosuna çevirir; obj.scale DAİMA 1 (drawnScale).
//   st    = {closed, locked, live, earthed, charge(0..3), blown, tripped}
//           Değişince mekanik parçalar kendi saatinde kısa geçişle (≤ 0,4 s) yeni duruma gider; ilk çağrı,
//           PX.render.instant ve gizli sekme anında. Geri al ortasında yeni st gelirse o anki pozdan devam eder.
//           Geçişler PX.TW'den bağımsızdır (TW.cancelAll görseli yarıda bırakamaz: çizim daima mantığa yakınsar).
//   anchor= THREE.Vector3: Volti'nin el hedefi, hücre merkezine göre DÜNYA eksenlerinde (dönüş uygulanmış) ofset.
//   act(k)= 'press' (buton basma vuruşu) | 'op' (kısa sarsıntı); Promise döndürmez, anında başlar.
// Bütçe: kit başına 1 çizim çağrısı, tek paylaşımlı MeshLambertMaterial (köşe rengi + 1024² atlas + 256² ışıma
// atlası); üçgen (ölçülen): düşük 66–1312, orta 66–1936 (açık hava porselen etekli OG ayırıcı/bara en ağırı); seviye başına kit toplamı ≤ 8 k (T1). Kurulum ≈ 0,2–3 ms/kit. Kare başına ayırma yok (onBeforeRender yalnız animasyonda iş yapar).
// Durum asla yalnız renkle gösterilmez: kapalı = kesintisiz hat / yatay bıçak, açık = kopuk hat / kalkık bıçak,
// açtı = sarı plaka + "!", topraklı = sarı-yeşil çizgi + kelepçe, kilitli = asma kilit + turuncu etiket,
// canlı = 3 noktalı gerilim göstergesi (VPIS) + tepe lambası, eridi = kararmış buşon + kırmızı gösterge.
// ============================================================================
const KIT = PX.KIT = PX.KIT || {};
const LIB = PX.KITLIB = {};

// ---------------------------------------------------------------- palet (sRGB onaltılık)
const P = {
  ral7035: 0xcfd2cc, ral7032: 0xbcbaa6, ral7016: 0x3b4249, ral7033: 0x7f8878, ral1003: 0xf2b705, ral5010: 0x1f4f8f,
  galv: 0xa2abb0, steel: 0x6f777e, dark: 0x2b3037, black: 0x181a1d, white: 0xf3f3ef, copper: 0xc8793a, alu: 0xc7cdd3,
  porcelain: 0x8b4b2f, porcelainG: 0xb9bdb6, epoxy: 0x6e2f24, concrete: 0xaaa69b, concreteD: 0x8c887e,
  red: 0xd3302a, green: 0x2f9e4a, amber: 0xf0a020, orange: 0xff7a1a, yellow: 0xf2c200,
  peY: 0xf2d21b, peG: 0x24994a, L1: 0x7b4a2a, L2: 0x1c1c1c, L3: 0x8c8c8c, N: 0x2a6fd0,
  navy: 0x24405f, teal: 0x2c6f7a, rubber: 0x202326, cable: 0x232528,
};
LIB.P = P;
const STY = {
  'Depo':           { body: 0xd2d5cf, roof: 0xbfc3bd, door: 0xdcdfd9, plinth: 0x2c3138, accent: 0x2f6fb5, handle: 0x23272c, ins: 'epoxy', street: false },
  'Volt Mahallesi': { body: 0xbdbca8, roof: 0xa9a894, door: 0xc8c7b3, plinth: 0x77756c, accent: 0x5a6b3a, handle: 0x2a2c2e, ins: 'epoxy', street: true },
  'Trafo Merkezi':  { body: 0xcfd2cc, roof: 0xb9bdb7, door: 0xd9dcd6, plinth: 0x3b4249, accent: 0x3b4249, handle: 0x1f2328, ins: 'porselen', street: false },
  'Fabrika':        { body: 0xcdd0ca, roof: 0xbabeb8, door: 0xd8dbd5, plinth: 0x2c3036, accent: 0xf2b705, handle: 0xe0a800, ins: 'epoxy', street: false },
};
function biyomKey(b) {
  if (STY[b]) return b;
  const s = String(b || '').toLocaleLowerCase('tr');
  if (s.indexOf('mahalle') >= 0) return 'Volt Mahallesi';
  if (s.indexOf('trafo') >= 0) return 'Trafo Merkezi';
  if (s.indexOf('fabrika') >= 0) return 'Fabrika';
  return 'Depo';
}
LIB.STY = STY; LIB.biyomKey = biyomKey;

// ---------------------------------------------------------------- ortam
function rendererLin() { const r = PX.scene && PX.scene.renderer; return r ? r.outputEncoding === THREE.sRGBEncoding : true; }
function quality() {
  const q = String((PX.scene && (PX.scene.tier || PX.scene.quality)) || KIT.quality || 'orta').toLowerCase();
  return (q === 'dusuk' || q === 'düşük' || q === 'low') ? 0 : (q === 'yuksek' || q === 'yüksek' || q === 'high') ? 2 : 1;
}
function curL(el) {
  const cands = [PX.diorama && PX.diorama.L, PX.render && PX.render.L, PX.game && PX.game.L];
  for (let i = 0; i < cands.length; i++) { const L = cands[i]; if (L && L.els && el && L.els[el.i] === el) return L; }
  for (let i = 0; i < cands.length; i++) { const L = cands[i]; if (L && L.els && el && L.els[el.i] && L.els[el.i].id === el.id) return L; }
  return null;
}
function kvOf(el, L) {
  if (!L || !L.nodeIdx || !L.kv) return 0.4;
  let kv = 0; const ks = ['a', 'b', 'dugum'];
  for (let i = 0; i < ks.length; i++) { const n = el[ks[i]]; if (n !== undefined && L.nodeIdx[n] !== undefined) kv = Math.max(kv, L.kv[L.nodeIdx[n]] || 0); }
  return kv || 0.4;
}
// Ön yüz yönü: Volti'nin bu cihaza eriştiği karo (L.reach) > boş komşu > başlangıç görünümünün kamerası.
function frontYaw(el, L) {
  if (!L || !L.G || el.cell === undefined || el.cell < 0) return 0;
  const G = L.G; const xyz = G.xyz(el.cell); const x = xyz[0], y = xyz[1], z = xyz[2];
  const V = PX.SIM && PX.SIM.VIEWS ? PX.SIM.VIEWS : [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const v0 = (L.view0 | 0) & 3; const cam = V[v0];
  const D4 = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  let best = -1e9, yaw = 0;
  for (let k = 0; k < 4; k++) {
    const dx = D4[k][0], dz = D4[k][1]; let sc = 0;
    const t = G.idx(x + dx, y - 1, z + dz);
    if (t >= 0 && L.reach && L.reach[t] && L.reach[t].indexOf(el.i) >= 0) sc += 8;   // Volti'nin yaklaşma karosu
    const nb = G.idx(x + dx, y, z + dz); if (nb < 0 || G.kind[nb] === 0) sc += 3;
    if (dx * cam[0] + dz * cam[1] > 0) sc += 1.25;
    sc -= k * 0.01;
    if (sc > best) { best = sc; yaw = Math.atan2(dx, dz); }
  }
  return yaw;
}
LIB.curL = curL; LIB.kvOf = kvOf; LIB.frontYaw = frontYaw; LIB.quality = quality;

// ---------------------------------------------------------------- doku atlası (kanvas, harici dosya yok)
// 1024² renk atlası + aynı yerleşimde 256² ışıma atlası. Satır 0 (y 0–63) ve satır 7 (y 448–511): 64² örnekler;
// y 64–447: 128² semboller (3 × 8); satır 8 (y 512–575) örnekler; y 576–1023: 128×32 etiket yuvaları (14 × 8).
const AT = { W: 1024, cv: null, ecv: null, ctx: null, ectx: null, tex: null, etex: null, R: {}, labels: new Map(), next: 0, warned: false };
const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
function region(px, py, pw, ph, pad) {
  const W = AT.W; return { u0: (px + pad) / W, u1: (px + pw - pad) / W, v0: 1 - (py + ph - pad) / W, v1: 1 - (py + pad) / W, rot: 0 };
}
function paint(name, x, y, w, h, fn, pad) {
  const c = AT.ctx, e = AT.ectx;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); fn(c, x, y, w, h, false); c.restore();
  e.save(); e.beginPath(); e.rect(x, y, w, h); e.clip(); fn(e, x, y, w, h, true); e.restore();
  AT.R[name] = region(x, y, w, h, pad === undefined ? 5 : pad);
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function stripes(c, x, y, w, h, a, b, n) {
  c.fillStyle = a; c.fillRect(x, y, w, h); c.fillStyle = b; const s = (w + h) / n;
  for (let i = -n; i < n * 2; i++) { c.beginPath(); const x0 = x + i * s; c.moveTo(x0, y + h); c.lineTo(x0 + s / 2, y + h); c.lineTo(x0 + s / 2 + h, y); c.lineTo(x0 + h, y); c.closePath(); c.fill(); }
}
function lampPaint(on, core, rim) {
  return (c, x, y, w, h, em) => {
    if (em && !on) return;
    const g = c.createRadialGradient(x + w * 0.45, y + h * 0.42, 2, x + w / 2, y + h / 2, w * 0.62);
    g.addColorStop(0, core); g.addColorStop(1, rim); c.fillStyle = g; c.fillRect(x, y, w, h);
  };
}
function plate(c, x, y, w, h, bg, em, emA) {
  if (em) { if (emA) { c.globalAlpha = emA; c.fillStyle = bg; rr(c, x + 6, y + 6, w - 12, h - 12, 10); c.fill(); c.globalAlpha = 1; } return; }
  c.fillStyle = '#1b2026'; c.fillRect(x, y, w, h);
  c.fillStyle = bg; rr(c, x + 6, y + 6, w - 12, h - 12, 10); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; rr(c, x + 7, y + 7, w - 14, h - 14, 9); c.stroke();
}
// Tek hat sembolü (IEC 60617 esinli): kind = 'brk' (×), 'lbs' (o), 'kon' (yarım daire), 'earth'
function swSym(c, x, y, w, h, kind, closed, ink, em) {
  if (em) return;
  const cx = x + w / 2; c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 16; c.lineCap = 'round';
  const top = y + 16, bot = y + h - 16, cy = y + h * 0.38, piv = y + h * 0.68;
  c.beginPath(); c.moveTo(cx, top); c.lineTo(cx, cy); c.stroke();            // üst sabit uç
  if (kind === 'earth') { c.beginPath(); c.moveTo(cx, piv); c.lineTo(cx, piv + 6); c.stroke(); }
  else { c.beginPath(); c.moveTo(cx, piv); c.lineTo(cx, bot); c.stroke(); }  // alt uç
  c.beginPath(); c.moveTo(cx, piv);
  if (closed) c.lineTo(cx, cy); else c.lineTo(cx - (piv - cy) * 1.0, cy + 4);
  c.stroke();
  c.lineWidth = 9;
  if (kind === 'brk') { const s = 13; c.beginPath(); c.moveTo(cx - s, cy - s); c.lineTo(cx + s, cy + s); c.moveTo(cx + s, cy - s); c.lineTo(cx - s, cy + s); c.stroke(); }
  else if (kind === 'lbs') { c.beginPath(); c.arc(cx, cy - 2, 12, 0, Math.PI * 2); c.stroke(); }
  else if (kind === 'kon') { c.beginPath(); c.arc(cx, cy - 12, 12, 0, Math.PI); c.stroke(); }
  if (kind === 'earth') { // toprak sembolü
    const gy = piv + 14; c.lineWidth = 7;
    c.beginPath(); c.moveTo(cx - 24, gy); c.lineTo(cx + 24, gy); c.moveTo(cx - 15, gy + 11); c.lineTo(cx + 15, gy + 11); c.moveTo(cx - 6, gy + 22); c.lineTo(cx + 6, gy + 22); c.stroke();
  }
  if (!closed) { c.lineWidth = 4; c.setLineDash([6, 6]); c.globalAlpha = 0.6; c.beginPath(); c.moveTo(cx, cy + 10); c.lineTo(cx, piv - 10); c.stroke(); c.setLineDash([]); c.globalAlpha = 1; }
}
function earthGlyph(c, cx, cy, s, ink) {
  c.strokeStyle = ink; c.lineWidth = s * 0.16; c.lineCap = 'round';
  c.beginPath(); c.moveTo(cx, cy - s); c.lineTo(cx, cy); c.moveTo(cx - s * 0.8, cy); c.lineTo(cx + s * 0.8, cy);
  c.moveTo(cx - s * 0.5, cy + s * 0.35); c.lineTo(cx + s * 0.5, cy + s * 0.35); c.moveTo(cx - s * 0.2, cy + s * 0.7); c.lineTo(cx + s * 0.2, cy + s * 0.7); c.stroke();
}
function bolt(c, cx, cy, s, ink) {
  c.fillStyle = ink; c.beginPath();
  c.moveTo(cx + s * 0.18, cy - s); c.lineTo(cx - s * 0.42, cy + s * 0.12); c.lineTo(cx - s * 0.02, cy + s * 0.12);
  c.lineTo(cx - s * 0.2, cy + s); c.lineTo(cx + s * 0.42, cy - s * 0.18); c.lineTo(cx + s * 0.02, cy - s * 0.18); c.closePath(); c.fill();
}
function text(c, s, x, y, w, h, px, color, weight) {
  c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
  let f = px; c.font = (weight || 'bold') + ' ' + f + 'px ' + FONT;
  while (f > 8 && c.measureText(s).width > w - 6) { f -= 1; c.font = (weight || 'bold') + ' ' + f + 'px ' + FONT; }
  c.fillText(s, x + w / 2, y + h / 2 + 1);
}
function noise(c, x, y, w, h, base, dots, n, seed) {
  c.fillStyle = base; c.fillRect(x, y, w, h); let s = seed | 0 || 7;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const px = x + (s % w); s = (s * 1103515245 + 12345) & 0x7fffffff; const py = y + (s % h);
    c.fillStyle = dots[i % dots.length]; c.fillRect(px, py, 2, 2); }
}
function digit(c, x, y, w, h, n, em) {
  if (!em) { c.fillStyle = '#14110b'; c.fillRect(x, y, w, h); c.strokeStyle = '#3a3a3a'; c.lineWidth = 6; c.strokeRect(x + 3, y + 3, w - 6, h - 6); }
  const on = '#ffb21e', off = em ? '#000000' : '#2e2616';
  c.font = 'bold 74px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
  if (!em) { c.fillStyle = off; c.fillText('8', x + w / 2, y + 50); }
  c.fillStyle = on; c.fillText(String(n), x + w / 2, y + 50);
  for (let i = 0; i < 3; i++) { c.fillStyle = i < n ? on : off; c.fillRect(x + 16 + i * 34, y + 96, 26, 16); }
}
function buildAtlas() {
  const W = AT.W;
  AT.cv = document.createElement('canvas'); AT.cv.width = AT.cv.height = W; AT.ctx = AT.cv.getContext('2d');
  AT.ecv = document.createElement('canvas'); AT.ecv.width = AT.ecv.height = W / 4; AT.ectx = AT.ecv.getContext('2d');
  AT.ctx.fillStyle = '#ffffff'; AT.ctx.fillRect(0, 0, W, W);
  AT.ectx.fillStyle = '#000000'; AT.ectx.fillRect(0, 0, W / 4, W / 4); AT.ectx.scale(0.25, 0.25);
  const sw = (i, row, name, fn, pad) => paint(name, i * 64, row, 64, 64, fn, pad);
  // ---- satır 0 örnekleri
  sw(0, 0, 'WHITE', (c, x, y, w, h, em) => { if (!em) { c.fillStyle = '#fff'; c.fillRect(x, y, w, h); } }, 16);
  sw(1, 0, 'LAMP_OFF', lampPaint(false, '#5a6066', '#24282c'));
  sw(2, 0, 'LAMP_G', lampPaint(true, '#d6ffdf', '#22c55a'));
  sw(3, 0, 'LAMP_R', lampPaint(true, '#ffe0d8', '#e8322a'));
  sw(4, 0, 'LAMP_A', lampPaint(true, '#fff4cf', '#ffaa1c'));
  sw(5, 0, 'LAMP_C', lampPaint(true, '#e6feff', '#38d8ff'));
  sw(6, 0, 'LAMP_W', lampPaint(true, '#ffffff', '#ffd98a'));
  sw(7, 0, 'WIN_OFF', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#d9dcd8'; c.fillRect(x, y, w, h);
    const g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#3c4d66'); g.addColorStop(1, '#16202e'); c.fillStyle = g; c.fillRect(x + 7, y + 7, w - 14, h - 14);
    c.fillStyle = '#d9dcd8'; c.fillRect(x + w / 2 - 2, y + 7, 4, h - 14); c.fillRect(x + 7, y + h / 2 - 2, w - 14, 4); });
  sw(8, 0, 'WIN_ON', (c, x, y, w, h, em) => { if (!em) { c.fillStyle = '#d9dcd8'; c.fillRect(x, y, w, h); }
    const g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#fff1c2'); g.addColorStop(1, '#ffb440'); c.fillStyle = g; c.fillRect(x + 7, y + 7, w - 14, h - 14);
    c.fillStyle = em ? '#7a4a10' : '#c9b48a'; c.fillRect(x + w / 2 - 2, y + 7, 4, h - 14); c.fillRect(x + 7, y + h / 2 - 2, w - 14, 4); });
  sw(9, 0, 'HAZARD', (c, x, y, w, h, em) => { if (!em) stripes(c, x, y, w, h, '#f2c200', '#1b1b1b', 4); });
  sw(10, 0, 'PE', (c, x, y, w, h, em) => { if (!em) stripes(c, x, y, w, h, '#f2d21b', '#1f9a45', 4); }, 3);
  sw(11, 0, 'LOUVRE', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#ffffff'; c.fillRect(x, y, w, h); c.fillStyle = '#7d7d7d';
    for (let i = 0; i < 6; i++) c.fillRect(x + 8, y + 9 + i * 8, w - 16, 4); c.strokeStyle = '#9a9a9a'; c.lineWidth = 3; c.strokeRect(x + 5, y + 5, w - 10, h - 10); });
  sw(12, 0, 'GRILLE', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#ffffff'; c.fillRect(x, y, w, h); c.strokeStyle = '#5c5c5c'; c.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(x + i * 8, y); c.lineTo(x + i * 8, y + h); c.moveTo(x, y + i * 8); c.lineTo(x + w, y + i * 8); c.stroke(); } });
  sw(13, 0, 'CONCRETE', (c, x, y, w, h, em) => { if (!em) noise(c, x, y, w, h, '#f0eee8', ['#d6d3cb', '#c8c4ba', '#fbfaf6'], 260, 11); });
  sw(14, 0, 'DOOR', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#ffffff'; c.fillRect(x, y, w, h); c.strokeStyle = '#8f8f8f'; c.lineWidth = 4; c.strokeRect(x + 4, y + 4, w - 8, h - 8);
    c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 2; c.strokeRect(x + 10, y + 10, w - 20, h - 20); }, 3);
  sw(15, 0, 'SOOT', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#ffffff'; c.fillRect(x, y, w, h);
    const g = c.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, w * 0.55); g.addColorStop(0, '#120c08'); g.addColorStop(0.55, '#3b2a20'); g.addColorStop(1, '#ffffff'); c.fillStyle = g; c.fillRect(x, y, w, h); });
  // ---- satır 7 örnekleri (y 448)
  const R7 = 448;
  sw(0, R7, 'FLAG_I', (c, x, y, w, h, em) => { plate(c, x, y, w, h, '#c62828', em, 0.45); if (!em) text(c, 'I', x, y, w, h, 40, '#ffffff'); });
  sw(1, R7, 'FLAG_O', (c, x, y, w, h, em) => { plate(c, x, y, w, h, '#2e7d32', em, 0.45); if (!em) text(c, 'O', x, y, w, h, 36, '#ffffff'); });
  sw(2, R7, 'FLAG_T', (c, x, y, w, h, em) => { plate(c, x, y, w, h, '#f0a020', em, 0.5); if (!em) text(c, '!', x, y, w, h, 40, '#1b1b1b'); });
  const vpis = on => (c, x, y, w, h, em) => {
    if (!em) { c.fillStyle = '#2a2f35'; c.fillRect(x, y, w, h); }
    for (let i = 0; i < 3; i++) { const cx = x + 13 + i * 19, cy = y + h / 2;
      if (on) { c.fillStyle = '#ffd040'; c.beginPath(); c.arc(cx, cy, 8, 0, 7); c.fill(); if (!em) { c.fillStyle = '#fff6c8'; c.beginPath(); c.arc(cx - 2, cy - 2, 3, 0, 7); c.fill(); } }
      else if (!em) { c.fillStyle = '#4b4f55'; c.beginPath(); c.arc(cx, cy, 8, 0, 7); c.fill(); c.strokeStyle = '#7b8086'; c.lineWidth = 2; c.stroke(); } }
  };
  sw(3, R7, 'VPIS_OFF', vpis(false), 2); sw(4, R7, 'VPIS_ON', vpis(true), 2);
  sw(5, R7, 'GLASS', (c, x, y, w, h, em) => { if (em) return; const g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#6f8ca6'); g.addColorStop(1, '#2c3f52'); c.fillStyle = g; c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.moveTo(x + 8, y + h - 8); c.lineTo(x + 30, y + 8); c.lineTo(x + 42, y + 8); c.lineTo(x + 20, y + h - 8); c.fill(); }, 3);
  sw(6, R7, 'SCREEN_OFF', (c, x, y, w, h, em) => { if (!em) { c.fillStyle = '#0f1419'; c.fillRect(x, y, w, h); c.strokeStyle = '#3a4048'; c.lineWidth = 4; c.strokeRect(x + 2, y + 2, w - 4, h - 4); } }, 3);
  sw(7, R7, 'SCREEN_ON', (c, x, y, w, h, em) => { if (!em) { c.fillStyle = '#0f1a14'; c.fillRect(x, y, w, h); c.strokeStyle = '#3a4048'; c.lineWidth = 4; c.strokeRect(x + 2, y + 2, w - 4, h - 4); }
    c.fillStyle = '#5dffa0'; for (let i = 0; i < 4; i++) c.fillRect(x + 10, y + 12 + i * 11, [40, 28, 34, 20][i], 5); }, 3);
  sw(8, R7, 'BRICK', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#e8e2dc'; c.fillRect(x, y, w, h); c.fillStyle = '#b55a3c';
    for (let r = 0; r < 8; r++) for (let k = -1; k < 4; k++) c.fillRect(x + k * 20 + (r & 1) * 10 + 1, y + r * 8 + 1, 18, 6); });
  sw(9, R7, 'ROOF', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#7a2a1a'; c.fillRect(x, y, w, h);
    for (let r = 0; r < 6; r++) for (let k = -1; k < 6; k++) { c.fillStyle = (r + k) & 1 ? '#b8482c' : '#a83e26'; c.beginPath(); c.arc(x + k * 13 + (r & 1) * 6, y + r * 11 + 6, 7, 0, Math.PI); c.fill(); } }, 2);
  sw(10, R7, 'AWNING', (c, x, y, w, h, em) => { if (em) return; for (let i = 0; i < 8; i++) { c.fillStyle = i & 1 ? '#f4efe6' : '#c83a2c'; c.fillRect(x + i * 8, y, 8, h); } }, 2);
  sw(11, R7, 'CU', (c, x, y, w, h, em) => { if (em) return; const g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#f0a868'); g.addColorStop(0.5, '#c8793a'); g.addColorStop(1, '#9a5424'); c.fillStyle = g; c.fillRect(x, y, w, h); }, 2);
  sw(12, R7, 'GAUGE', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#2a2f35'; c.fillRect(x, y, w, h); c.fillStyle = '#f4f4ef'; c.beginPath(); c.arc(x + 32, y + 32, 26, 0, 7); c.fill();
    c.strokeStyle = '#2e9e4a'; c.lineWidth = 7; c.beginPath(); c.arc(x + 32, y + 32, 19, Math.PI * 1.15, Math.PI * 1.75); c.stroke();
    c.strokeStyle = '#d3302a'; c.beginPath(); c.arc(x + 32, y + 32, 19, Math.PI * 1.8, Math.PI * 1.95); c.stroke();
    c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.moveTo(x + 32, y + 32); c.lineTo(x + 44, y + 16); c.stroke(); }, 3);
  sw(13, R7, 'ASPHALT', (c, x, y, w, h, em) => { if (!em) noise(c, x, y, w, h, '#3a3d42', ['#4a4e54', '#2c2f33', '#55585e'], 300, 5); });
  sw(14, R7, 'CHECKER', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#9aa1a6'; c.fillRect(x, y, w, h); c.fillStyle = '#c4cacd';
    for (let r = 0; r < 6; r++) for (let k = 0; k < 6; k++) { c.save(); c.translate(x + 6 + k * 11, y + 6 + r * 11); c.rotate((r + k) & 1 ? 0.8 : -0.8); c.fillRect(-4, -1.5, 8, 3); c.restore(); } });
  sw(15, R7, 'CORRUG', (c, x, y, w, h, em) => { if (em) return; for (let i = 0; i < 16; i++) { c.fillStyle = i & 1 ? '#cfd6dc' : '#aab3bb'; c.fillRect(x + i * 4, y, 4, h); } }, 2);
  // ---- satır 8 örnekleri (y 512)
  const R8 = 512;
  sw(0, R8, 'CU_ON', (c, x, y, w, h, em) => { const g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#ffe2a8'); g.addColorStop(0.5, '#ffb45a'); g.addColorStop(1, '#e07a2a'); c.fillStyle = g; if (em) c.globalAlpha = 0.75; c.fillRect(x, y, w, h); c.globalAlpha = 1; }, 2);
  sw(1, R8, 'STEEL', (c, x, y, w, h, em) => { if (!em) noise(c, x, y, w, h, '#f4f5f6', ['#dfe2e5', '#e9ebed'], 120, 3); });
  // ---- 128² semboller
  const sym = (i, name, fn, pad) => paint(name, (i % 8) * 128, 64 + Math.floor(i / 8) * 128, 128, 128, fn, pad === undefined ? 6 : pad);
  const mim = (bg, kind, closed, ink, emA, extra) => (c, x, y, w, h, em) => { plate(c, x, y, w, h, bg, em, emA); swSym(c, x, y, w, h, kind, closed, ink, em); if (extra) extra(c, x, y, w, h, em); };
  const bang = (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#1b1b1b'; c.beginPath(); c.moveTo(x + w - 40, y + 18); c.lineTo(x + w - 18, y + 52); c.lineTo(x + w - 62, y + 52); c.closePath(); c.fill(); text(c, '!', x + w - 62, y + 24, 44, 30, 22, '#f0a020'); };
  sym(0, 'BRK_C', mim('#c62828', 'brk', true, '#ffffff', 0.38));
  sym(1, 'BRK_O', mim('#2e7d32', 'brk', false, '#ffffff', 0.38));
  sym(2, 'BRK_T', mim('#f0a020', 'brk', false, '#1b1b1b', 0.45, bang));
  sym(3, 'LBS_C', mim('#c62828', 'lbs', true, '#ffffff', 0.38));
  sym(4, 'LBS_O', mim('#2e7d32', 'lbs', false, '#ffffff', 0.38));
  sym(5, 'KON_C', mim('#c62828', 'kon', true, '#ffffff', 0.38));
  sym(6, 'KON_O', mim('#2e7d32', 'kon', false, '#ffffff', 0.38));
  sym(7, 'EARTH_C', (c, x, y, w, h, em) => { if (em) { c.globalAlpha = 0.3; c.fillStyle = '#c8e830'; rr(c, x + 6, y + 6, w - 12, h - 12, 10); c.fill(); c.globalAlpha = 1; return; }
    c.fillStyle = '#1b2026'; c.fillRect(x, y, w, h); c.save(); rr(c, x + 6, y + 6, w - 12, h - 12, 10); c.clip(); stripes(c, x, y, w, h, '#f2d21b', '#1f9a45', 6); c.restore();
    c.fillStyle = 'rgba(255,255,255,0.86)'; rr(c, x + 26, y + 14, w - 52, h - 28, 8); c.fill(); swSym(c, x, y, w, h, 'earth', true, '#111111', false); });
  sym(8, 'EARTH_O', mim('#5b636b', 'earth', false, '#ffffff', 0));
  sym(11, 'DANGER', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#f7f7f2'; c.fillRect(x, y, w, h); c.strokeStyle = '#cfcfc8'; c.lineWidth = 4; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
    c.fillStyle = '#1b1b1b'; c.beginPath(); c.moveTo(x + 64, y + 8); c.lineTo(x + 116, y + 92); c.lineTo(x + 12, y + 92); c.closePath(); c.fill();
    c.fillStyle = '#f7c600'; c.beginPath(); c.moveTo(x + 64, y + 22); c.lineTo(x + 104, y + 86); c.lineTo(x + 24, y + 86); c.closePath(); c.fill();
    bolt(c, x + 64, y + 60, 22, '#1b1b1b'); text(c, 'YÜKSEK GERİLİM', x + 2, y + 96, w - 4, 26, 15, '#c62828'); }, 4);
  sym(12, 'SRC', (c, x, y, w, h, em) => { plate(c, x, y, w, h, '#1f3a2a', em, 0); if (em) return; const cx = x + 64, cy = y + 64; c.strokeStyle = '#e8f5ea'; c.lineWidth = 8;
    c.beginPath(); c.arc(cx, cy, 38, 0, 7); c.stroke(); bolt(c, cx, cy, 27, '#ffd040'); });
  sym(13, 'TRAFO', (c, x, y, w, h, em) => { plate(c, x, y, w, h, '#2b3440', em, 0); if (em) return; c.strokeStyle = '#e8eef5'; c.lineWidth = 7;
    c.beginPath(); c.arc(x + 64, y + 46, 25, 0, 7); c.stroke(); c.beginPath(); c.arc(x + 64, y + 78, 25, 0, 7); c.stroke(); text(c, 'Dyn11', x, y + 100, w, 22, 16, '#f2c200'); });
  sym(14, 'CAP', (c, x, y, w, h, em) => { plate(c, x, y, w, h, '#2b3440', em, 0); if (em) return; c.strokeStyle = '#e8eef5'; c.lineWidth = 9; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(x + 64, y + 18); c.lineTo(x + 64, y + 54); c.moveTo(x + 30, y + 54); c.lineTo(x + 98, y + 54); c.moveTo(x + 30, y + 72); c.lineTo(x + 98, y + 72); c.moveTo(x + 64, y + 72); c.lineTo(x + 64, y + 108); c.stroke(); });
  sym(15, 'HOSP', (c, x, y, w, h, em) => { if (!em) { c.fillStyle = '#e9edf0'; c.fillRect(x, y, w, h); } c.fillStyle = '#1565c0'; rr(c, x + 14, y + 14, w - 28, h - 28, 12); c.fill();
    if (!em) text(c, 'H', x + 14, y + 14, w - 28, h - 28, 70, '#ffffff'); });
  for (let n = 0; n < 4; n++) sym(16 + n, 'DIG' + n, (c, x, y, w, h, em) => digit(c, x, y, w, h, n, em), 4);
  sym(20, 'PE_SIGN', (c, x, y, w, h, em) => { if (em) return; c.fillStyle = '#1f8f45'; c.fillRect(x, y, w, h); c.strokeStyle = '#ffffff'; c.lineWidth = 5; c.strokeRect(x + 8, y + 8, w - 16, h - 16); earthGlyph(c, x + 64, y + 58, 38, '#ffffff'); }, 4);
  sym(21, 'FAULT', (c, x, y, w, h, em) => { if (!em) { c.fillStyle = '#1b1b1b'; c.fillRect(x, y, w, h); } c.fillStyle = '#ffd000'; c.beginPath(); c.moveTo(x + 14, y + 14); c.lineTo(x + w - 14, y + 14); c.lineTo(x + 14, y + h - 14); c.closePath(); c.fill();
    if (!em) { c.fillStyle = '#1b1b1b'; c.font = 'bold 34px ' + FONT; c.textAlign = 'center'; c.fillText('!', x + 44, y + 58); } }, 4);
  sym(22, 'LOCKTAG', (c, x, y, w, h, em) => { if (em) { c.globalAlpha = 0.25; c.fillStyle = '#ff7a1a'; c.fillRect(x + 6, y + 6, w - 12, h - 12); c.globalAlpha = 1; return; }
    c.fillStyle = '#ff7a1a'; c.fillRect(x, y, w, h); c.strokeStyle = '#1b1b1b'; c.lineWidth = 5; c.strokeRect(x + 5, y + 5, w - 10, h - 10);
    c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(x + 64, y + 18, 7, 0, 7); c.fill();
    text(c, 'ÇALIŞMA VAR', x + 6, y + 30, w - 12, 26, 19, '#1b1b1b'); text(c, 'KAPATMAYIN', x + 6, y + 58, w - 12, 30, 22, '#b71c1c'); text(c, 'VOLTİ', x + 6, y + 90, w - 12, 24, 18, '#1b1b1b'); }, 4);
  sym(23, 'METER', (c, x, y, w, h, em) => { if (!em) { c.fillStyle = '#e9e6dc'; c.fillRect(x, y, w, h); c.fillStyle = '#20262c'; c.fillRect(x + 20, y + 24, w - 40, 36); }
    c.fillStyle = '#7dffa0'; c.font = 'bold 26px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('0482.7', x + 64, y + 43);
    if (!em) { c.fillStyle = '#b71c1c'; c.fillRect(x + 54, y + 80, 20, 8); text(c, 'kWh', x, y + 92, w, 24, 16, '#333'); } }, 4);
  AT.tex = new THREE.CanvasTexture(AT.cv); AT.etex = new THREE.CanvasTexture(AT.ecv);
  const lin = rendererLin();
  for (const t of [AT.tex, AT.etex]) {
    t.encoding = lin ? THREE.sRGBEncoding : THREE.LinearEncoding; t.userData = { shared: true };
    const r = PX.scene && PX.scene.renderer; t.anisotropy = r && r.capabilities ? Math.min(4, r.capabilities.getMaxAnisotropy()) : 1;
  }
  AT.next = 0; AT.labels.clear();
  prewarmLabels();
}
// Bütün R1 etiketlerini açılışta bir kez boya: oyun ortasında atlas değişmez (1024² dokunun yeniden yüklenmesi yok).
function prewarmLabels() {
  const fixed = [['HASTANE', 'blue'], ['SAĞLIK OCAĞI', 'blue'], ['OKUL', 'cream'], ['FIRIN', 'cream'], ['MARKET', 'cream'], ['SANAYİ', 'blue'],
    ['SOĞUK DEPO', 'blue'], ['AKÜ', 'yellow'], ['34,5/0,4 kV', 'yellow'], ['ERİDİ', 'red'], ['0,4 kV', 'yellow'], ['34,5 kV', 'yellow'],
    ['YANGIN', 'red'], ['ŞARJ', 'green'], ['M', 'plate'], ['AYDINLATMA', 'plate']];
  for (let i = 0; i < fixed.length; i++) label(fixed[i][0], fixed[i][1]);
  const lv = PX.LEVELS || [];
  for (let i = 0; i < lv.length; i++) {
    const els = (lv[i] && lv[i].def && lv[i].def.el) || [];
    for (let j = 0; j < els.length; j++) {
      const e = els[j]; if (!e || !e.id) continue;
      label('-' + e.id, e.t === 'ariza' ? 'yellow' : 'plate');
      if (e.t === 'buton') { const w = String(e.ad || '').split(/[\s(]/)[0] || (e.nc ? 'STOP' : 'START'); label(w.toLocaleUpperCase('tr'), e.nc ? 'red' : 'green'); }
    }
  }
}
// Etiket yuvası: 128×32 (uzunsa 256×32). Stiller: plate (beyaz levha, siyah yazı), dark, red, yellow, blue, sign
const LSTY = {
  plate: ['#f4f4ef', '#141414', '#4a4a4a'], dark: ['#1d232a', '#f2f2ee', '#59616b'], red: ['#c62828', '#ffffff', '#7a1414'],
  yellow: ['#f2c200', '#141414', '#3a3000'], blue: ['#1d4f91', '#ffffff', '#0e2a50'], green: ['#2e7d32', '#ffffff', '#11401a'],
  cream: ['#efe2c2', '#5a2a12', '#8a5a30'], white: ['#ffffff', '#1d4f91', '#9aa3ad'],
};
function label(str, style) {
  if (!AT.cv) buildAtlas();
  style = LSTY[style] ? style : 'plate';
  const key = style + '|' + str; const hit = AT.labels.get(key); if (hit) return hit;
  AT.ctx.font = 'bold 22px ' + FONT; const wide = AT.ctx.measureText(str).width > 112 ? 2 : 1;
  let slot = AT.next; if (wide === 2 && (slot & 7) === 7) slot++;
  if (slot + wide > 112) { if (!AT.warned) { console.warn('[PX.KIT] etiket atlası doldu'); AT.warned = true; } return AT.R.WHITE; }
  AT.next = slot + wide;
  const x = (slot & 7) * 128, y = 576 + (slot >> 3) * 32, w = 128 * wide, h = 32; const S = LSTY[style];
  paint('L:' + key, x, y, w, h, (c, X, Y, W, H, em) => {
    if (em) { if (style === 'red') { c.globalAlpha = 0.35; c.fillStyle = S[0]; c.fillRect(X, Y, W, H); c.globalAlpha = 1; } return; }
    c.fillStyle = S[2]; c.fillRect(X, Y, W, H); c.fillStyle = S[0]; c.fillRect(X + 2, Y + 2, W - 4, H - 4); text(c, str, X + 2, Y + 1, W - 4, H - 2, 22, S[1]);
  }, 2);
  const r = AT.R['L:' + key]; AT.labels.set(key, r);
  if (AT.tex) { AT.tex.needsUpdate = true; AT.etex.needsUpdate = true; }
  return r;
}
function R(name) { if (!AT.cv) buildAtlas(); return AT.R[name] || AT.R.WHITE; }
function rot(reg, k) { return { u0: reg.u0, u1: reg.u1, v0: reg.v0, v1: reg.v1, rot: k & 3 }; }
LIB.R = R; LIB.label = label; LIB.rot = rot; LIB.atlas = () => { if (!AT.cv) buildAtlas(); return AT; };

// ---------------------------------------------------------------- paylaşımlı malzeme
let MAT = null;
function material() {
  if (!MAT) {
    if (!AT.cv) buildAtlas();
    MAT = new THREE.MeshLambertMaterial({ vertexColors: true, map: AT.tex, emissiveMap: AT.etex, emissive: 0xffffff });
    MAT.name = 'PX.KIT'; MAT.userData.shared = true;
  }
  return MAT;
}
LIB.material = material;

// ---------------------------------------------------------------- geometri kurucu (birleşik, indekssiz)
// Tek paylaşımlı büyüyen Float32 karalama tamponu (kurulum eşzamanlı, aynı anda tek Bld): köşe başına ara dizi /
// kutu yok, çöp toplayıcı baskısı yok. geometry() kesin boyutlu kopyayı alır. Kit kurulumu ≈ 0,2–1 ms.
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _c = new THREE.Color();
const SCR = { cap: 0, P: null, N: null, C: null, U: null, Q: null };
function scratch(n) {
  if (n <= SCR.cap) return;
  let cap = Math.max(4096, SCR.cap); while (cap < n) cap *= 2;
  const grow = (a, k) => { const b = new Float32Array(cap * k); if (a) b.set(a); return b; };
  SCR.P = grow(SCR.P, 3); SCR.N = grow(SCR.N, 3); SCR.C = grow(SCR.C, 3); SCR.U = grow(SCR.U, 2); SCR.Q = grow(SCR.Q, 2); SCR.cap = cap;
}
const MPOOL = [];
function Bld(lin) {
  this.n = 0; this.M = new THREE.Matrix4(); this.S = []; this.r = 1; this.g = 1; this.b = 1; this.lin = lin; this.parts = {}; this.open = [];
  scratch(4096);
}
Bld.prototype.color = function (hex) { _c.setHex(hex); if (this.lin) _c.convertSRGBToLinear(); this.r = _c.r; this.g = _c.g; this.b = _c.b; return this; };
Bld.prototype.push = function () { const m = MPOOL.pop() || new THREE.Matrix4(); this.S.push(m.copy(this.M)); return this; };
Bld.prototype.pop = function () { const m = this.S.pop(); this.M.copy(m); MPOOL.push(m); return this; };
Bld.prototype.at = function (x, y, z) { this.M.multiply(_m.makeTranslation(x, y, z)); return this; };
Bld.prototype.rx = function (a) { this.M.multiply(_m.makeRotationX(a)); return this; };
Bld.prototype.ry = function (a) { this.M.multiply(_m.makeRotationY(a)); return this; };
Bld.prototype.rz = function (a) { this.M.multiply(_m.makeRotationZ(a)); return this; };
Bld.prototype.begin = function (name) { this.open.push({ name, s: this.n }); return this; };
// aynı ad birden çok kez açılabilir: parça birden çok aralık taşır
Bld.prototype.end = function () { const o = this.open.pop(); (this.parts[o.name] = this.parts[o.name] || []).push({ s: o.s, e: this.n }); return this; };
Bld.prototype.v = function (x, y, z, nx, ny, nz, u, v, fu, fv) {
  const i = this.n; if (i >= SCR.cap) scratch(i + 1);
  const e = this.M.elements, P = SCR.P, N = SCR.N, C = SCR.C, i3 = i * 3, i2 = i * 2;
  P[i3] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[i3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[i3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  const a = e[0] * nx + e[4] * ny + e[8] * nz, b = e[1] * nx + e[5] * ny + e[9] * nz, c = e[2] * nx + e[6] * ny + e[10] * nz;
  const l = Math.sqrt(a * a + b * b + c * c) || 1; N[i3] = a / l; N[i3 + 1] = b / l; N[i3 + 2] = c / l;
  C[i3] = this.r; C[i3 + 1] = this.g; C[i3 + 2] = this.b;
  SCR.U[i2] = u; SCR.U[i2 + 1] = v; SCR.Q[i2] = fu; SCR.Q[i2 + 1] = fv;
  this.n = i + 1;
};
const WU = 32 / 1024, WV = 1 - 32 / 1024;   // WHITE örneğinin merkezi
function uvOf(reg, fu, fv, out) {
  if (!reg) { out[0] = WU; out[1] = WV; return; }
  let a = fu, b = fv; const k = reg.rot | 0;
  if (k === 1) { a = 1 - fv; b = fu; } else if (k === 2) { a = 1 - fu; b = 1 - fv; } else if (k === 3) { a = fv; b = 1 - fu; }
  out[0] = reg.u0 + a * (reg.u1 - reg.u0); out[1] = reg.v0 + b * (reg.v1 - reg.v0);
}
const _uv = [0, 0], QFU = [0, 1, 1, 0], QFV = [0, 0, 1, 1], QIDX = [0, 1, 2, 0, 2, 3];
const QX = new Float64Array(4), QY = new Float64Array(4), QZ = new Float64Array(4);
// a,b,c,d: dışarıdan bakınca saat yönü tersine (sol-alt, sağ-alt, sağ-üst, sol-üst)
Bld.prototype.quad = function (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, reg) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = dx - ax, vy = dy - ay, vz = dz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  QX[0] = ax; QX[1] = bx; QX[2] = cx; QX[3] = dx; QY[0] = ay; QY[1] = by; QY[2] = cy; QY[3] = dy; QZ[0] = az; QZ[1] = bz; QZ[2] = cz; QZ[3] = dz;
  for (let i = 0; i < 6; i++) { const j = QIDX[i]; uvOf(reg, QFU[j], QFV[j], _uv); this.v(QX[j], QY[j], QZ[j], nx, ny, nz, _uv[0], _uv[1], QFU[j], QFV[j]); }
  return this;
};
function face(f, n) {
  if (!f) return null;
  if (f.u0 !== undefined) return f;   // tek bölge: her yüz
  return f[n] !== undefined ? f[n] : (f.all || null);
}
// f: null | bölge | {t,f,k,l,r,b(alt), all, bot:true}; alt yüz varsayılan olarak çizilmez (kamera hep üstte)
Bld.prototype.box = function (x0, y0, z0, x1, y1, z1, f) {
  this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, face(f, 'r'));
  this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, face(f, 'l'));
  this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, face(f, 't'));
  this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, face(f, 'f'));
  this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, face(f, 'k'));
  if (f && f.u0 === undefined && (f.bot || f.b)) this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, face(f, 'b'));
  return this;
};
// yerel Y ekseni boyunca koni/silindir (kesit seg), r0 alt, r1 üst
Bld.prototype.cyl = function (r0, r1, y0, y1, seg, side, cap, opt) {
  const top = !opt || opt.top !== false, bot = !!(opt && opt.bot);
  const dr = r0 - r1, h = y1 - y0, nl = Math.hypot(h, dr) || 1, ny = dr / nl, nh = h / nl;
  const TW = Math.PI * 2;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * TW, a1 = (i + 1) / seg * TW;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), f0 = i / seg, f1 = (i + 1) / seg;
    // köşe sırası 0,2,1, 0,3,2 ; 0=(r0,a0,alt) 1=(r0,a1,alt) 2=(r1,a1,üst) 3=(r1,a0,üst)
    for (let k = 0; k < 6; k++) {
      const q = k === 0 || k === 3 ? 0 : k === 1 || k === 5 ? 2 : k === 2 ? 1 : 3;
      const up = q >= 2, ra = q === 0 || q === 3, r = up ? r1 : r0, cc = ra ? c0 : c1, ss = ra ? s0 : s1, fu = ra ? f0 : f1, fv = up ? 1 : 0;
      uvOf(side, fu, fv, _uv); this.v(r * cc, up ? y1 : y0, r * ss, cc * nh, ny, ss * nh, _uv[0], _uv[1], fu, fv);
    }
    if (top && r1 > 0) {
      uvOf(cap, 0.5, 0.5, _uv); this.v(0, y1, 0, 0, 1, 0, _uv[0], _uv[1], 0.5, 0.5);
      uvOf(cap, 0.5 + 0.5 * c1, 0.5 - 0.5 * s1, _uv); this.v(r1 * c1, y1, r1 * s1, 0, 1, 0, _uv[0], _uv[1], 0.5 + 0.5 * c1, 0.5 - 0.5 * s1);
      uvOf(cap, 0.5 + 0.5 * c0, 0.5 - 0.5 * s0, _uv); this.v(r1 * c0, y1, r1 * s0, 0, 1, 0, _uv[0], _uv[1], 0.5 + 0.5 * c0, 0.5 - 0.5 * s0);
    }
    if (bot && r0 > 0) {
      uvOf(cap, 0.5, 0.5, _uv);
      this.v(0, y0, 0, 0, -1, 0, _uv[0], _uv[1], 0.5, 0.5); this.v(r0 * c0, y0, r0 * s0, 0, -1, 0, _uv[0], _uv[1], 0.5, 0.5); this.v(r0 * c1, y0, r0 * s1, 0, -1, 0, _uv[0], _uv[1], 0.5, 0.5);
    }
  }
  return this;
};
// döner yüzey: prof = [[r, y], ...] alttan üste
Bld.prototype.lathe = function (prof, seg, reg) {
  uvOf(reg, 0.5, 0.5, _uv); const u = _uv[0], w = _uv[1], TW = Math.PI * 2;
  for (let j = 0; j < prof.length - 1; j++) {
    const ra = prof[j][0], ya = prof[j][1], rb = prof[j + 1][0], yb = prof[j + 1][1];
    let tnx = yb - ya, tny = -(rb - ra); const l = Math.hypot(tnx, tny) || 1; tnx /= l; tny /= l;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * TW, a1 = (i + 1) / seg * TW;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      for (let k = 0; k < 6; k++) {
        const q = k === 0 || k === 3 ? 0 : k === 1 || k === 5 ? 2 : k === 2 ? 1 : 3;
        const up = q >= 2, r = up ? rb : ra, y = up ? yb : ya, cc = q === 0 || q === 3 ? c0 : c1, ss = q === 0 || q === 3 ? s0 : s1;
        this.v(r * cc, y, r * ss, cc * tnx, tny, ss * tnx, u, w, 0.5, 0.5);
      }
    }
  }
  return this;
};
Bld.prototype.geometry = function () {
  const n = this.n, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(SCR.P.slice(0, n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(SCR.N.slice(0, n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(SCR.C.slice(0, n * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(SCR.U.slice(0, n * 2), 2));
  this.Q = SCR.Q.slice(0, n * 2);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.9);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  return g;
};
LIB.Bld = Bld;

// ---------------------------------------------------------------- kit çalışma zamanı
const DEF = { closed: false, locked: false, live: false, earthed: false, charge: 0, blown: false, tripped: false };
const KEYS = ['closed', 'locked', 'live', 'earthed', 'charge', 'blown', 'tripped'];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

function Kit(el, biyom, ctx) {
  ctx = ctx || {};
  this.el = el; this.type = el.t; this.biyom = biyomKey(biyom); this.S = STY[this.biyom];
  this.L = ctx.L || curL(el); this.kv = ctx.kv !== undefined ? ctx.kv : kvOf(el, this.L); this.og = this.kv > 1;
  this.q = quality(); this.seg = [6, 10, 14][this.q];
  this.yaw = ctx.yaw !== undefined ? ctx.yaw : frontYaw(el, this.L);
  this.b = new Bld(rendererLin()); this.chs = []; this.anim = false; this.st = null; this.rt = {}; this.onState = null;
  this.spins = []; this.lastT = 0; this.mesh = null; this.ad = String(el.ad || '').toLocaleLowerCase('tr');
  this.anchor = new THREE.Vector3(0, -0.05, 0.48);
  if (!AT.cv) buildAtlas();
}
Kit.prototype.has = function (w) { return this.ad.indexOf(w) >= 0; };
Kit.prototype.finish = function () {
  const b = this.b, geo = b.geometry(); this.geo = geo;
  this.pos = geo.attributes.position; this.nrm = geo.attributes.normal; this.col = geo.attributes.color; this.uv = geo.attributes.uv; this.Q = b.Q;
  for (const name in b.parts) {
    const list = b.parts[name];
    for (let i = 0; i < list.length; i++) { const p = list[i]; p.p0 = this.pos.array.slice(p.s * 3, p.e * 3); p.n0 = this.nrm.array.slice(p.s * 3, p.e * 3); }
    this.rt[name] = list;
  }
  const mesh = new THREE.Mesh(geo, material()); mesh.name = 'kit:' + this.type + ':' + (this.el.id || '');
  mesh.rotation.y = this.yaw; mesh.userData.kit = this.type;
  const self = this; mesh.onBeforeRender = function () { self.tick(); };
  this.mesh = mesh;
  const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), a = this.anchor;
  const anchor = new THREE.Vector3(a.x * cy + a.z * sy, a.y, -a.x * sy + a.z * cy);
  const tris = geo.attributes.position.count / 3;
  return {
    obj: mesh, hit: mesh, anchor, kit: this, info: { type: this.type, tris, biyom: this.biyom, yaw: this.yaw },
    setState(st) { self.setState(st); }, act(kind) { self.act(kind); },
  };
};
// ---- parça işlemleri (yalnız durum değişiminde ve animasyonda; ayırmasız)
Kit.prototype.xform = function (name, M) {
  const list = this.rt[name]; if (!list) return;
  const e = M.elements, P = this.pos.array, N = this.nrm.array;
  for (let j = 0; j < list.length; j++) {
    const p = list[j], p0 = p.p0, n0 = p.n0; let o = p.s * 3;
    for (let i = 0; i < p0.length; i += 3, o += 3) {
      const x = p0[i], y = p0[i + 1], z = p0[i + 2];
      P[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = n0[i], b = n0[i + 1], c = n0[i + 2];
      N[o] = e[0] * a + e[4] * b + e[8] * c; N[o + 1] = e[1] * a + e[5] * b + e[9] * c; N[o + 2] = e[2] * a + e[6] * b + e[10] * c;
    }
  }
  this.pos.needsUpdate = true; this.nrm.needsUpdate = true;
};
// eksen etrafında döndür (pivot px,py,pz); ax: 0=x 1=y 2=z
Kit.prototype.rotate = function (name, px, py, pz, ax, ang) {
  if (ax === 0) _m2.makeRotationX(ang); else if (ax === 1) _m2.makeRotationY(ang); else _m2.makeRotationZ(ang);
  _m.makeTranslation(px, py, pz); _m.multiply(_m2); _m2.makeTranslation(-px, -py, -pz); _m.multiply(_m2);
  this.xform(name, _m);
};
Kit.prototype.move = function (name, dx, dy, dz) { _m.makeTranslation(dx, dy, dz); this.xform(name, _m); };
// ölçek (0 = görünmez: üçgenler tek noktaya çöker, normaller korunur)
Kit.prototype.scale = function (name, px, py, pz, k) {
  const s = Math.max(k, 1e-4); _m.makeTranslation(px, py, pz); _m2.makeScale(s, s, s); _m.multiply(_m2); _m2.makeTranslation(-px, -py, -pz); _m.multiply(_m2);
  const list = this.rt[name]; if (!list) return;
  this.xform(name, _m);
  const N = this.nrm.array;
  for (let j = 0; j < list.length; j++) { const p = list[j]; for (let i = p.s * 3; i < p.e * 3; i++) N[i] = p.n0[i - p.s * 3]; }
};
Kit.prototype.region = function (name, reg) {
  const list = this.rt[name]; if (!list) return; const U = this.uv.array, Q = this.Q;
  for (let j = 0; j < list.length; j++) { const p = list[j]; for (let i = p.s; i < p.e; i++) { uvOf(reg, Q[i * 2], Q[i * 2 + 1], _uv); U[i * 2] = _uv[0]; U[i * 2 + 1] = _uv[1]; } }
  this.uv.needsUpdate = true;
};
Kit.prototype.tint = function (name, hex) {
  const list = this.rt[name]; if (!list) return; _c.setHex(hex); if (this.b.lin) _c.convertSRGBToLinear();
  const C = this.col.array;
  for (let j = 0; j < list.length; j++) { const p = list[j]; for (let i = p.s; i < p.e; i++) { C[i * 3] = _c.r; C[i * 3 + 1] = _c.g; C[i * 3 + 2] = _c.b; } }
  this.col.needsUpdate = true;
};
// ---- kanallar: 0..1 değer, kendi saatiyle yumuşak geçiş
Kit.prototype.chan = function (dur, apply, bounce) { const c = { v: 0, from: 0, to: 0, t0: 0, dur: dur * 1000, apply, on: false, bounce: !!bounce }; this.chs.push(c); return c; };
Kit.prototype.go = function (c, to, snap) {
  if (snap) { c.on = false; c.v = c.to = to; c.apply(to); return; }
  if (c.to === to && (c.on || c.v === to)) return;
  c.from = c.v; c.to = to; c.t0 = now(); c.on = true; this.anim = true;
};
Kit.prototype.spin = function (apply, speed) { const s = { a: 0, speed, on: false, apply }; this.spins.push(s); return s; };
Kit.prototype.tick = function () {
  if (!this.anim && !this.spinning) return;
  const t = now();
  if (this.anim) {
    let any = false; const chs = this.chs;
    for (let i = 0; i < chs.length; i++) {
      const c = chs[i]; if (!c.on) continue;
      let k = (t - c.t0) / c.dur; if (k >= 1) { k = 1; c.on = false; } else { if (k < 0) k = 0; any = true; }
      if (c.bounce) { c.v = c.on ? Math.sin(Math.PI * k) : 0; if (!c.on) c.to = 0; }
      else c.v = c.from + (c.to - c.from) * ease(k);
      c.apply(c.v);
    }
    this.anim = any;
  }
  if (this.spinning) {
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0; let any = false;
    for (let i = 0; i < this.spins.length; i++) { const s = this.spins[i]; if (!s.on) continue; any = true; s.a = (s.a + dt * s.speed) % (Math.PI * 2); s.apply(s.a); }
    this.spinning = any;
  }
  this.lastT = t;
};
Kit.prototype.setSpin = function (s, on) { s.on = !!on; if (on) { this.spinning = true; this.lastT = 0; } };
Kit.prototype.setState = function (st) {
  if (!st) return;
  const prev = this.st;
  if (prev) { let same = true; for (let i = 0; i < KEYS.length; i++) { const k = KEYS[i]; if ((k === 'charge' ? (st[k] | 0) : !!st[k]) !== prev[k]) { same = false; break; } } if (same) return; }
  const snap = !prev || !!(PX.render && PX.render.instant) || (typeof document !== 'undefined' && document.hidden) || !!KIT.instant;
  const s = {}; for (let i = 0; i < KEYS.length; i++) { const k = KEYS[i]; s[k] = k === 'charge' ? Math.max(0, Math.min(3, st[k] | 0)) : !!st[k]; }
  this.st = s;
  if (this.onState) this.onState(s, prev || DEF, snap);
};
Kit.prototype.act = function (kind) { if (this.onAct) this.onAct(kind); };
LIB.Kit = Kit; LIB.DEF = DEF;

// ---------------------------------------------------------------- ortak parçalar
// Dolap gövdesi: kaide + gövde + çatı + ön kapı + yan panjur + ön/arka etiket. Dönüş: ölçüler.
LIB.cabinet = function (k, o) {
  o = o || {}; const b = k.b, S = k.S;
  const x0 = o.x0 !== undefined ? o.x0 : -0.44, x1 = o.x1 !== undefined ? o.x1 : 0.44;
  const z0 = o.z0 !== undefined ? o.z0 : -0.44, z1 = o.z1 !== undefined ? o.z1 : 0.44;
  const y1 = o.y1 !== undefined ? o.y1 : 0.40, ry = o.roofY !== undefined ? o.roofY : 0.45;
  b.color(o.plinth || S.plinth).box(x0 + 0.01, -0.5, z0 + 0.01, x1 - 0.01, -0.44, z1 - 0.01);
  b.color(o.body || S.body).box(x0, -0.44, z0, x1, y1, z1, { l: o.vents !== false ? null : null, r: null });
  if (o.roof !== false) {
    const ov = o.overhang !== undefined ? o.overhang : 0.025;
    b.color(o.roofCol || S.roof).box(x0 - ov, y1, z0 - ov, x1 + ov, ry, z1 + (o.roofFront !== undefined ? o.roofFront : ov));
  }
  if (o.vents !== false) {
    const vy0 = -0.36, vy1 = -0.12;
    b.color(o.body || S.body).quad(x1 + 0.002, vy0, z1 - 0.12, x1 + 0.002, vy0, z0 + 0.12, x1 + 0.002, vy1, z0 + 0.12, x1 + 0.002, vy1, z1 - 0.12, R('LOUVRE'));
    b.quad(x0 - 0.002, vy0, z0 + 0.12, x0 - 0.002, vy0, z1 - 0.12, x0 - 0.002, vy1, z1 - 0.12, x0 - 0.002, vy1, z0 + 0.12, R('LOUVRE'));
  }
  if (o.door !== false) {
    const dy0 = o.doorY0 !== undefined ? o.doorY0 : -0.38, dy1 = o.doorY1 !== undefined ? o.doorY1 : y1 - 0.05;
    b.color(o.doorCol || S.door).box(x0 + 0.05, dy0, z1, x1 - 0.05, dy1, z1 + 0.012, { f: R('DOOR') });
    b.color(S.handle).box(x1 - 0.12, -0.08, z1 + 0.012, x1 - 0.085, 0.10, z1 + 0.03);
  }
  if (o.label !== false && k.el.id) {
    const lab = label('-' + k.el.id, 'plate'); const ly = o.labelY !== undefined ? o.labelY : y1 - 0.13;
    b.color(0xffffff).quad(-0.17, ly, z1 + 0.014, 0.17, ly, z1 + 0.014, 0.17, ly + 0.085, z1 + 0.014, -0.17, ly + 0.085, z1 + 0.014, lab);
    b.quad(0.17, ly, z0 - 0.002, -0.17, ly, z0 - 0.002, -0.17, ly + 0.085, z0 - 0.002, 0.17, ly + 0.085, z0 - 0.002, lab);
  }
  return { x0, x1, z0, z1, y1, ry };
};
// Tepe mimik levhası (durum sembolü): çerçeve + üst yüz bölgesi değişebilir parça
LIB.mimic = function (k, cx, cz, half, y, regName, part) {
  const b = k.b; b.color(0x1b2026).box(cx - half - 0.015, y, cz - half - 0.015, cx + half + 0.015, y + 0.012, cz + half + 0.015);
  b.color(0xffffff).begin(part || 'mimic');
  b.quad(cx - half, y + 0.014, cz + half, cx + half, y + 0.014, cz + half, cx + half, y + 0.014, cz - half, cx - half, y + 0.014, cz - half, R(regName));
  b.end();
};
// Lamba (kubbe kutu): üst yüz ve ön yüz lamba bölgesinde; parça adı ile LAMP_* değiştirilir
LIB.lamp = function (k, x, y, z, s, part, reg) {   // alçak kubbe: toplam yükseklik ≤ 0,026
  const b = k.b; b.color(0x2a2f35).box(x - s * 0.62, y, z - s * 0.62, x + s * 0.62, y + 0.008, z + s * 0.62);
  b.color(0xffffff).begin(part).box(x - s / 2, y + 0.008, z - s / 2, x + s / 2, y + 0.026, z + s / 2, R(reg || 'LAMP_OFF')).end();
};
// Ön yüze düz levha (z = sabit, +z'ye bakar)
LIB.front = function (k, x0, y0, x1, y1, z, reg, part) {
  const b = k.b; b.color(0xffffff); if (part) b.begin(part);
  b.quad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, reg); if (part) b.end();
};
LIB.back = function (k, x0, y0, x1, y1, z, reg, part) {
  const b = k.b; b.color(0xffffff); if (part) b.begin(part);
  b.quad(x1, y0, z, x0, y0, z, x0, y1, z, x1, y1, z, reg); if (part) b.end();
};
LIB.side = function (k, sgn, z0, y0, z1, y1, x, reg, part) {   // sgn=+1: +x yüzü, -1: -x yüzü
  const b = k.b; b.color(0xffffff); if (part) b.begin(part);
  if (sgn > 0) b.quad(x, y0, z1, x, y0, z0, x, y1, z0, x, y1, z1, reg); else b.quad(x, y0, z0, x, y0, z1, x, y1, z1, x, y1, z0, reg);
  if (part) b.end();
};
LIB.top = function (k, x0, z0, x1, z1, y, reg, part) {
  const b = k.b; b.color(0xffffff); if (part) b.begin(part);
  b.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, reg); if (part) b.end();
};
// Asma kilit + LOTO etiketi: kilit üst yüzde (her görünümden görünür), etiket ön kenardan sarkar.
// (x,y,z): kilidin oturduğu üst yüz noktası. Parça 'lock'; pivot döner.
LIB.padlock = function (k, x, y, z, tagDown) {
  const b = k.b; b.begin('lock');
  // toplam yükseklik 0,115 (tepe yüzü + kilit ≤ 0,48 için kilitlenebilir dolaplar 0,36'da biter)
  b.color(0x8f969c).box(x - 0.03, y, z - 0.03, x + 0.03, y + 0.012, z + 0.03);                    // kilit dili (hasp)
  b.color(0xd32f2f).box(x - 0.07, y + 0.012, z - 0.035, x + 0.07, y + 0.085, z + 0.035);          // gövde
  b.color(0xb0b6bb).box(x - 0.052, y + 0.085, z - 0.012, x - 0.032, y + 0.115, z + 0.012).box(x + 0.032, y + 0.085, z - 0.012, x + 0.052, y + 0.115, z + 0.012)
    .box(x - 0.052, y + 0.10, z - 0.012, x + 0.052, y + 0.115, z + 0.012);                        // halka
  b.color(0x1b1b1b).box(x - 0.012, y + 0.035, z + 0.035, x + 0.012, y + 0.065, z + 0.038);        // anahtar deliği
  // etiket: kilitten öne doğru yatık, ön kenardan sarkan turuncu kart
  const tz = z + 0.04, ty = y + 0.05, td = tagDown || 0.2;
  b.color(0xffffff).quad(x - 0.075, ty - td, tz + 0.03, x + 0.075, ty - td, tz + 0.03, x + 0.075, ty, tz, x - 0.075, ty, tz, R('LOCKTAG'));
  b.quad(x + 0.075, ty - td, tz + 0.03, x - 0.075, ty - td, tz + 0.03, x - 0.075, ty, tz, x + 0.075, ty, tz, R('LOCKTAG'));
  b.end();
  return [x, y, z];
};
// Taşınabilir topraklama kelepçesi (sarı-yeşil): parça adıyla
LIB.clamp = function (k, x, y, z, part, len) {
  const b = k.b; b.begin(part);
  b.color(0xffffff).box(x - 0.035, y - 0.035, z - 0.035, x + 0.035, y + 0.035, z + 0.035, R('PE'));
  b.color(0xffffff).box(x - 0.012, y - (len || 0.25), z - 0.012, x + 0.012, y - 0.035, z + 0.012, R('PE'));
  b.end();
};
// Mesnet izolatörü profili (porselen etekli ya da epoksi)
LIB.insProf = function (k, h, r, sheds) {
  const pr = [[r * 1.15, 0], [r * 1.15, 0.02]]; const n = sheds === undefined ? (k.S.ins === 'porselen' || k.og ? 3 : 0) : sheds;
  if (!n) { pr.push([r, 0.03], [r * 0.85, h - 0.02], [r * 1.1, h - 0.02], [r * 1.1, h]); return pr; }
  const step = (h - 0.05) / n;
  for (let i = 0; i < n; i++) { const y = 0.03 + i * step; pr.push([r * 0.7, y], [r * 1.55, y + step * 0.35], [r * 0.7, y + step * 0.75]); }
  pr.push([r * 0.7, h - 0.02], [r, h - 0.02], [r, h]);
  return pr;
};
LIB.insCol = k => (k.og || k.S.ins === 'porselen') ? P.porcelain : P.epoxy;
// Faz renk bandı (IEC 60445: L1 kahverengi, L2 siyah, L3 gri)
LIB.PHASE = [P.L1, P.L2, P.L3];
// Gerilim göstergesi (VPIS) ön yüzde + tepe lambası; parça adları 'vpis', 'lampT'
LIB.liveFace = function (k, x0, y0, x1, y1, z) { LIB.front(k, x0, y0, x1, y1, z, R('VPIS_OFF'), 'vpis'); };
LIB.applyLive = function (k, live) { k.region('vpis', R(live ? 'VPIS_ON' : 'VPIS_OFF')); k.region('lampT', R(live ? 'LAMP_A' : 'LAMP_OFF')); };

// ---------------------------------------------------------------- kayıt
// Her ekipman dosyası LIB.def(tip, kurucu) çağırır; kurucu(k) Kit'i doldurur ve k.onState atar.
LIB.def = function (type, build) {
  KIT[type] = function (el, biyom, ctx) {
    const k = new Kit(el, biyom, ctx);
    build(k);
    const iface = k.finish();
    k.setState(DEF);
    return iface;
  };
  KIT[type].kit = true;
};
// Yedek: etiketli nötr dolap (bilinmeyen tip)
LIB.def('default', k => {
  LIB.cabinet(k, {});
  LIB.mimic(k, 0, 0, 0.3, 0.45, 'SRC');
  LIB.lamp(k, 0.36, 0.45, -0.36, 0.1, 'lampT');
  LIB.liveFace(k, -0.1, 0.06, 0.1, 0.12, 0.457);
  k.onState = st => LIB.applyLive(k, st.live);
});
KIT.version = 'kits-r1.1';
