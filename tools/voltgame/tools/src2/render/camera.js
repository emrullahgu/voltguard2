// ============================================================================
// render/camera.js — PX.camera : ortografik izometrik kamera, yaylar, worldToClient, pick (§12.1, §12.3, §12.7)
//                                                                    sahip: Render
// Görünüm v ⇔ kamera yönü (sx,1,sz) (sim2 G1: derinlik d = sx·x + y + sz·z, büyük d kameraya yakın).
//   azimut az(v) = 45° + 90°·v (xz düzleminde (sx,sz) açısı), yükseklik açısı atan(1/√2) = 35,26°.
//   Döndürme d+ (v+1) => az +90°. Sürükleme: sağa (dx>0) => az azalır => q<0 => d−.
// KURAL SÜRÜMÜ 4: kamera YALNIZ GÖRSELDİR. Görünüm sim durumunda yoktur (C.v kameranın kendi açısı; controller G.camV
//   ile snapTo/syncView çağırır); döndürme hiçbir zaman reddedilmez, lastik bant yalnız tek sürüklemede ±180°'yi aşınca.
//   Seçim sim2.ownerAt(L, v, U, V, t, saydamKümesi): yarı saydam örtücülerin (PX.diorama.fadedSet) arkasındaki karo seçilir.
// Yay: ANALİTİK kritik sönümlü yay x(t) = (x0 + (v0 + ω·x0)·t)·e^(−ωt) (kare hızından bağımsız, kesin);
//   ω = 28,5 rad/s ⇒ 90° düğme döndürmesi ≈ 256 ms'de 0,5° içine girer (§12.3: 260–300 ms). Her snapTo o anki
//   açı ve AÇISAL HIZDAN yeniden tohumlanır ⇒ zincirlenmiş döndürmelerde ve yeniden yakalamada hız süreklidir.
//   snapTo Promise'i kalan açı < 1,2° olunca çözülür (sıradaki komut hız sürekliliğiyle hemen başlar); yay
//   tam oturana kadar busy() true kalır.
//   PX.camera.cam (THREE.OrthographicCamera)   .az (rad, sürekli)   .azVel (rad/s)   .v (mantıksal/hedef görünüm)
//   PX.camera.setLevel(L, s)  .setViewport(w,h)  .syncView(v)  .update(dt)  .fit()
//   PX.camera.snapTo(v, {vel}) -> Promise<{cancelled}>
//   PX.camera.grab()            pointerdown: yay DURMAZ; ilk drag() o anki açıdan sürekli devralır (sıçrama yok)
//   PX.camera.drag(dxPx)        yakalama noktasından ölçülen yatay piksel; tek sürüklemede ±2 adımın ötesinde lastik bant
//                               (θ' = 19°·tanh(θ/19°), §12.1); 90° = clamp(180, 0,45·min(g,y), 260) px
//   PX.camera.release(vxPxPerMs) -> q  (yasal aralığa kırpılmış işaretli adım; çağıran q adet {t:'rot'} gönderir).
//                               Sürükleme olmadıysa (dokunuş) 0 döner ve yaya dokunmaz.
//   PX.camera.pick(clientX, clientY) -> {kind:'tile'|'el'|'none', cell, el, U, V, tri}   sim ile AYNI sahiplik
//                               (sim2.ownerAt, saydam örtücüler atlanır). kind 'none' + cell >= 0: merdiven, iskele, kapı,
//                               duvar ya da üstü dolu blok (controller hücre türüne göre çözer: çık/in, neden).
//                               Hiç hücre yoksa 20 CSS px içinde en yakın sahip (§24.3).
//                               Döndürme ortasında da çalışır: görünen yüzey noktası hedef görünüme taşınır (girdi kilidi yok)
//   PX.camera.worldToClient(x, y, z, out?) -> {x, y} (CSS px, istemci koordinatı)
//   PX.camera.busy() -> bool (yay/sürükleme/doğuş sürüyor)   .spawn() (seviye doğuşu ≤ 450 ms; herhangi bir girdi atlar)
//   PX.camera.dragView() -> sürüklemede aday görünüm (yuvarlanmış) ya da -1
//   PX.camera.declutter([{x,y,w,h}]) -> aynı dizi, her kutuya dx,dy (etiket çakışması giderme; hud cihaz kodları)
// Kare başına ayırma yok (önceden ayrılmış geçiciler).
// ============================================================================
const EL = Math.atan(1 / Math.SQRT2);
const HALF_PI = Math.PI / 2, TWO_PI = Math.PI * 2;
const VIEWS = PX.SIM.VIEWS;
const OMEGA = 28.5;                       // rad/s (kritik sönümlü): 0,5° içine 256 ms + girdi gecikmesi ≈ 275 ms
const RESOLVE_EPS = 1.2 * Math.PI / 180;  // snapTo Promise eşiği
const BAND = 19 * Math.PI / 180;          // lastik bant
const SPAWN_S = 0.38;                     // seviye doğuşu (kamera yakınlaşması)
const azOf = v => Math.PI / 4 + HALF_PI * v;
const C = {
  cam: null, az: azOf(0), azVel: 0, v: 0, L: null, target: null, halfH: 6, aspect: 1, w: 1, h: 1,
  goal: null, x0: 0, v0: 0, st: 0, springRes: null,
  dragging: false, armed: false, az0: 0, baseAz: 0, lastDx: 0, qMin: -2, qMax: 2, dragV: -1,
  zoom: 1, spawnT: -1, ext: { ex: 1, ey: 1, cx: 0, cy: 0, cz: 0 }, preBanded: false,
  zoomLevel: 0, zT: -1, z0: 1, z1: 1, tx0: 0, tz0: 0, tx1: 0, tz1: 0,
};
const ZOOM_IN = 1.65, ZOOM_S = 0.2;        // iki kademeli kıstırma zoom (§24.3), 200 ms geçiş
let tmp = null, tmp2 = null;

function init() {
  C.cam = new THREE.OrthographicCamera(-5, 5, 5, -5, -200, 400);
  C.target = new THREE.Vector3();
  tmp = new THREE.Vector3(); tmp2 = new THREE.Vector3();
  place();
}
function setViewport(w, h) { C.w = w; C.h = h; C.aspect = w / Math.max(1, h); fit(); }
// v'ye en yakın eşdeğer azimut (o anki açıya göre)
function nearAz(v, ref) { const a = azOf(v); const k = Math.round((ref - a) / TWO_PI); return a + k * TWO_PI; }
function viewOfAz(az) { return ((Math.round((az - Math.PI / 4) / HALF_PI) % 4) + 4) % 4; }
function setLevel(L, s) {
  C.L = L; extents(L);
  C.target.set(C.ext.cx, C.ext.cy, C.ext.cz);
  const v0 = s && typeof s.v === 'number' ? s.v & 3 : (L.view0 | 0) & 3;
  C.v = v0; C.az = nearAz(v0, C.az); C.azVel = 0; C.goal = null; C.dragging = false; C.armed = false; C.dragV = -1;
  C.zoom = 1; C.zoomLevel = 0; C.zT = -1; C.preBanded = false;
  resolveSpring(true);
  fit();
}
// dolu hücrelerin sınır kutusu + Volti payı; dört görünümün en büyüğü ⇒ döndürmede yakınlaşma pompalanmaz
function extents(L) {
  const G = L.G; let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let c = 0; c < G.N; c++) {
    if (!G.kind[c]) continue;
    const x = c % G.W, y = Math.floor(c / G.W) % G.H, z = Math.floor(c / (G.W * G.H));
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (x0 > x1) { x0 = z0 = y0 = 0; x1 = G.W - 1; z1 = G.D - 1; y1 = G.H - 1; }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1 + 1) / 2;       // +1: üstteki Volti / akış kemerleri
  const hx = (x1 - x0) / 2 + 0.5, hz = (z1 - z0) / 2 + 0.5, hy = (y1 - y0 + 1) / 2 + 0.75;
  let ex = 0.5, ey = 0.5;
  for (let v = 0; v < 4; v++) {
    const th = azOf(v); const fx = Math.cos(EL) * Math.cos(th), fy = Math.sin(EL), fz = Math.cos(EL) * Math.sin(th);
    const rx = fz, rz = -fx; const rl = Math.hypot(rx, rz); const Rx = rx / rl, Rz = rz / rl;
    const ux = fy * Rz, uy = fz * Rx - fx * Rz, uz = -fy * Rx;
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
      const px = sx * hx, py = sy * hy, pz = sz * hz;
      ex = Math.max(ex, Math.abs(px * Rx + pz * Rz)); ey = Math.max(ey, Math.abs(px * ux + py * uy + pz * uz));
    }
  }
  C.ext.ex = ex; C.ext.ey = ey; C.ext.cx = cx; C.ext.cy = cy; C.ext.cz = cz;
}
function fit() {
  if (!C.cam) return;
  const m = 1.05;
  C.halfH = Math.max(C.ext.ey * m, C.ext.ex * m / C.aspect);
  applyProjection();
}
function applyProjection() {
  let z = C.zoom;
  if (C.spawnT >= 0) { const k = Math.min(1, C.spawnT / SPAWN_S); z *= 0.86 + 0.14 * (1 - Math.pow(1 - k, 3)); }
  const hh = C.halfH / z;
  C.cam.top = hh; C.cam.bottom = -hh; C.cam.left = -hh * C.aspect; C.cam.right = hh * C.aspect;
  C.cam.updateProjectionMatrix();
  place();
}
function place() { placeAt(C.cam, C.az); }
function placeAt(cam, a) {
  const R = 60, ce = Math.cos(EL);
  cam.position.set(C.target.x + R * ce * Math.cos(a), C.target.y + R * Math.sin(EL), C.target.z + R * ce * Math.sin(a));
  cam.up.set(0, 1, 0); cam.lookAt(C.target); cam.updateMatrixWorld();
  return cam;
}
function resolveSpring(cancelled) { const r = C.springRes; C.springRes = null; if (r) r(cancelled ? CANCELLED : DONE); }
const DONE = Object.freeze({ cancelled: false }), CANCELLED = Object.freeze({ cancelled: true });
// yay saati komut ANINDAN başlar: sıradaki update'in dt'si komuttan önceki kare süresini de içerir; st o kadar
// negatif tohumlanır (yay girdiden önce "ilerlemiş" görünmez; §12.3 ölçümü girdi anından)
// (yalnız duran yay için; süren yay o anki durumdan yeniden tohumlanır — kritik sönümlü yay özerk: yörünge aynı)
function seed(fresh) { C.x0 = C.az - C.goal; C.v0 = C.azVel; const g = (nowMs() - UT[0]) / 1000; C.st = fresh && UT[0] > 0 && g > 0 ? -Math.min(0.1, g) : 0; }
const UT = new Float64Array(1);           // son update'in duvar saati (ms); ayırmasız
function nowMs() { return typeof performance !== 'undefined' && performance.now ? performance.now() : 0; }
function snapTo(v, opts) {
  C.v = v & 3;
  if (opts && typeof opts.vel === 'number') C.azVel = opts.vel;
  resolveSpring(true);
  if (C.dragging) { C.goal = null; return Promise.resolve(DONE); }        // parmak kamerayı tutuyor: bırakınca yaylanır
  const fresh = C.goal === null && Math.abs(C.azVel) < 1e-6;
  C.goal = nearAz(C.v, C.az); seed(fresh);
  if (Math.abs(C.x0) < 1e-6 && Math.abs(C.v0) < 1e-4) { C.az = C.goal; C.azVel = 0; C.goal = null; place(); return Promise.resolve(DONE); }
  if (Math.abs(C.x0) < RESOLVE_EPS && Math.abs(C.v0) < 0.05) return Promise.resolve(DONE);
  return new Promise(r => { C.springRes = r; });
}
function syncView(v) {
  C.v = v & 3;
  if (C.dragging) return;
  if (C.goal === null) { const a = nearAz(C.v, C.az); if (a !== C.az) { C.az = a; C.azVel = 0; place(); } }
  else { const g = nearAz(C.v, C.az); if (g !== C.goal) { C.goal = g; seed(); } }      // yay sürüyorsa hedefi mantıksal görünüme çevir (hız korunur)
}
function update(dt) {
  if (C.spawnT >= 0) { C.spawnT += dt; if (C.spawnT >= SPAWN_S) C.spawnT = -1; applyProjection(); }
  if (C.zT >= 0) {
    C.zT += dt; let k = C.zT / ZOOM_S; if (k >= 1) { k = 1; C.zT = -1; }
    const e = 1 - (1 - k) * (1 - k) * (1 - k);
    C.zoom = C.z0 + (C.z1 - C.z0) * e;
    C.target.x = C.tx0 + (C.tx1 - C.tx0) * e; C.target.z = C.tz0 + (C.tz1 - C.tz0) * e;
    applyProjection();
  }
  UT[0] = nowMs();
  if (C.dragging || C.goal === null) return;
  C.st += dt; const t = C.st > 0 ? C.st : 0, w = OMEGA;
  const e = Math.exp(-w * t), b = C.v0 + w * C.x0;
  const x = (C.x0 + b * t) * e, vel = (C.v0 - w * b * t) * e;
  C.az = C.goal + x; C.azVel = vel;
  if (C.springRes && Math.abs(x) < RESOLVE_EPS) resolveSpring(false);
  if (Math.abs(x) < 2e-5 && Math.abs(vel) < 2e-3) { C.az = C.goal; C.azVel = 0; C.goal = null; resolveSpring(false); }
  place();
}
function dragScale() { return Math.max(180, Math.min(0.45 * Math.min(C.w, C.h), 260)); }
// kural sürümü 4: döndürme serbest (yalnız görsel); tek sürüklemede en çok ±2 adım
function legalRange() { C.qMin = -2; C.qMax = 2; }
function grab() {
  C.armed = true; C.lastDx = 0;
  if (C.spawnT >= 0) { C.spawnT = -1; applyProjection(); }          // herhangi bir dokunuş doğuşu atlar (§12.3)
}
function drag(dxPx, preBanded) {
  if (!C.dragging) {
    // ilk sürükleme: o anki (yayla hareket eden) açıdan devral; dx yakalama noktasından ölçülür, sıçrama yok
    C.dragging = true; C.armed = false; C.preBanded = !!preBanded; if (!C.preBanded) legalRange();
    C.az0 = C.az + dxPx * HALF_PI / dragScale();
    C.baseAz = nearAz(C.v, C.az); C.goal = null; resolveSpring(true);
    if (C.spawnT >= 0) { C.spawnT = -1; applyProjection(); }
  }
  C.lastDx = dxPx;
  const raw = C.az0 - dxPx * HALF_PI / dragScale();
  if (C.preBanded) {
    // jest (input/gesture.js) lastik bandı kendisi uygular (controller isteği §2)
    C.az = raw; C.azVel = 0; C.dragV = viewOfAz(C.az); place(); return;
  }
  let rel = raw - C.baseAz;
  const lo = C.qMin * HALF_PI, hi = C.qMax * HALF_PI;
  if (rel > hi) rel = hi + BAND * Math.tanh((rel - hi) / BAND);
  else if (rel < lo) rel = lo - BAND * Math.tanh((lo - rel) / BAND);
  C.az = C.baseAz + rel; C.azVel = 0;
  place();
  C.dragV = viewOfAz(C.az);
}
function release(vx) {
  C.armed = false;
  if (!C.dragging) return 0;                       // dokunuş: yaya dokunma (hız sürekliliği)
  C.dragging = false; C.dragV = -1;
  C.preBanded = false;
  const rel = C.az - C.baseAz;
  let q = Math.round(rel / HALF_PI);
  const vn = (vx || 0) * 375 / Math.max(1, Math.min(C.w, C.h));
  if (q === 0 && Math.abs(vn) >= 0.9 && Math.abs(C.lastDx) >= 30) q = vn > 0 ? -1 : 1;
  if (q > C.qMax) q = C.qMax; if (q < C.qMin) q = C.qMin;     // lastik bant gösteren bırakma sessizce geri yaylanır
  C.azVel = -(vx || 0) * 1000 * HALF_PI / dragScale();      // bırakma hızıyla tohumlanan yay
  if (Math.abs(C.azVel) > 12) C.azVel = 12 * Math.sign(C.azVel);
  C.goal = C.baseAz + q * HALF_PI; seed();
  return q;
}
// iki kademeli zoom: level 1 = ZOOM_IN kat, kıstırma noktasının altındaki zemin noktası ekranda yerinde kalır
// (ortografik izdüşüm doğrusal: T' = W − (W − T)/z kesin); level 0 = tam çerçeve, merkez. 200 ms, kesilebilir.
function setZoom(level, at) {
  level = level ? 1 : 0; if (!C.cam) return;
  C.z0 = C.zoom; C.tx0 = C.target.x; C.tz0 = C.target.z;
  if (level) {
    let wx = C.ext.cx, wz = C.ext.cz;
    if (at && typeof at.x === 'number' && PX.scene && PX.scene.rect) {
      const r = PX.scene.rect;
      const nx = ((at.x - r.left) / r.width) * 2 - 1, ny = -((at.y - r.top) / r.height) * 2 + 1;
      tmp.set(nx, ny, 0).unproject(C.cam);
      C.cam.getWorldDirection(tmp2);
      if (Math.abs(tmp2.y) > 1e-4) { const t = (C.ext.cy - 0.5 - tmp.y) / tmp2.y; wx = tmp.x + tmp2.x * t; wz = tmp.z + tmp2.z * t; }
    }
    const z = ZOOM_IN;
    let tx = wx - (wx - C.target.x) * C.zoom / z, tz = wz - (wz - C.target.z) * C.zoom / z;
    const lim = Math.max(C.ext.ex, C.ext.ey) * 0.7, dx = tx - C.ext.cx, dz = tz - C.ext.cz, d = Math.hypot(dx, dz);
    if (d > lim) { tx = C.ext.cx + dx * lim / d; tz = C.ext.cz + dz * lim / d; }
    C.z1 = z; C.tx1 = tx; C.tz1 = tz;
  } else { C.z1 = 1; C.tx1 = C.ext.cx; C.tz1 = C.ext.cz; }
  C.zoomLevel = level;
  if (PX.fx && PX.fx.reduced && PX.fx.reduced()) { C.zoom = C.z1; C.target.x = C.tx1; C.target.z = C.tz1; C.zT = -1; applyProjection(); return; }
  C.zT = 0;
}
function busy() { return C.dragging || C.goal !== null || C.spawnT >= 0; }
function spawn() { if (PX.fx && PX.fx.reduced && PX.fx.reduced()) return; C.spawnT = 0; applyProjection(); }
function dragView() { return C.dragging ? C.dragV : -1; }

// ---------------------------------------------------------------- seçim (sahiplik tablosundan, §12.7)
let cellElL = null, cellElA = null;
function cellToEl(c) {
  const L = C.L; if (!L) return -1;
  if (cellElL !== L) { cellElL = L; cellElA = new Int16Array(L.G.N).fill(-1); L.els.forEach((e, i) => { if (e.cell >= 0) cellElA[e.cell] = i; }); }
  return cellElA[c];
}
// istemci noktası -> görünüm v kafes koordinatı (A,B); ışın boyunca A,B sabittir (ortografik). PC = seçim kamerası
let PC = null, ALC = null;
function lattice(clientX, clientY, v, out) {
  const r = PX.scene.rect;
  const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = -((clientY - r.top) / r.height) * 2 + 1;
  tmp.set(nx, ny, 0).unproject(PC);
  const sx = VIEWS[v][0], sz = VIEWS[v][1];
  out.A = sx * tmp.x - tmp.y; out.B = sz * tmp.z - tmp.y;
  return out;
}
const LAT = { A: 0, B: 0 };
function classify(L, v, A, B, out) {
  const U = Math.floor(A), V = Math.floor(B); const fa = A - U, fb = B - V; const tri = fa <= fb ? 1 : 0;
  out.U = U; out.V = V; out.tri = tri; out.kind = 'none'; out.cell = -1; out.el = -1; out.top = false;
  const skip = PX.diorama && PX.diorama.fadedSet ? PX.diorama.fadedSet() : null;
  const o = PX.SIM.ownerAt(L, v, U, V, tri, skip && skip.size ? skip : null); if (!o) return out;
  out.cell = o.c; out.top = !!o.top;
  const k = L.G.kind[o.c];
  if (k === 2) { out.kind = 'el'; out.el = cellToEl(o.c); return out; }
  if (k === 6) { out.el = cellToEl(o.c); return out; }                      // kapı: controller kapının karosuna yürütür
  if (k === 1 && L.walkable(o.c)) { out.kind = 'tile'; out.top = true; }     // yan yüz de kendi üstü (arkadaki karo asla)
  return out;
}
const RINGS = [5, 10, 15, 20], ANG = 12;
function pick(clientX, clientY) {
  const out = { kind: 'none', cell: -1, el: -1, U: 0, V: 0, tri: 0, top: false };
  const L = C.L; if (!L || !PX.scene.rect || !C.cam) return out;
  const v = C.v; PC = C.cam;
  // döndürme ortası (yay/bırakma): sahiplik tablosu v'nin, ekran ise dönen kameranın. Dokunuş atılmaz ve yanlış hücreye
  // gitmez: dokunulan noktada GÖRÜNEN küp yüzeyi gerçek kameradan ışınla (birim küp DDA) bulunur, o dünya noktası v'ye
  // oturmuş kopya kameranın ekranına taşınır ve tablo orada okunur (boşluğa dokunuşta aynı ekran noktası)
  if (Math.abs(C.az - nearAz(v, C.az)) > 1e-4) {
    if (!ALC) ALC = new THREE.OrthographicCamera(); ALC.copy(C.cam, false); PC = placeAt(ALC, nearAz(v, C.az));
    if (surfaceHit(clientX, clientY, L.G)) { proj(ALC, tmp.x, tmp.y, tmp.z, WC); clientX = WC.x; clientY = WC.y; }
  }
  lattice(clientX, clientY, v, LAT); classify(L, v, LAT.A, LAT.B, out);
  if (out.kind !== 'none' || out.cell >= 0) return out;                    // hücre var: türünü controller çözer
  const exact = { U: out.U, V: out.V, tri: out.tri, cell: out.cell, top: out.top };
  // 20 CSS px içinde en yakın geçerli sahip (§24.3)
  const tmpO = { kind: 'none', cell: -1, el: -1, U: 0, V: 0, tri: 0, top: false };
  for (let ri = 0; ri < RINGS.length; ri++) {
    const rr = RINGS[ri]; let best = null, bd = 1e9;
    for (let a = 0; a < ANG; a++) {
      const th = (a / ANG) * TWO_PI; const px = clientX + rr * Math.cos(th), py = clientY + rr * Math.sin(th);
      lattice(px, py, v, LAT); classify(L, v, LAT.A, LAT.B, tmpO);
      if (tmpO.kind === 'none') continue;
      // aynı halkada birden çok aday: ekran mesafesi eşit; karo üst merkezine en yakını seç
      const d = centreDist(L, v, tmpO, clientX, clientY);
      if (d < bd) { bd = d; best = { kind: tmpO.kind, cell: tmpO.cell, el: tmpO.el, U: tmpO.U, V: tmpO.V, tri: tmpO.tri, top: tmpO.top }; }
    }
    if (best) { Object.assign(out, best); return out; }
  }
  out.U = exact.U; out.V = exact.V; out.tri = exact.tri; out.cell = exact.cell; out.top = exact.top;
  return out;
}
const WC = { x: 0, y: 0 };
function centreDist(L, v, o, cx, cy) {
  const G = L.G; const c = o.cell; const x = c % G.W, y = Math.floor(c / G.W) % G.H, z = Math.floor(c / (G.W * G.H));
  proj(PC, x, y + 0.5, z, WC); return Math.hypot(WC.x - cx, WC.y - cy);
}
// gerçek kameradan istemci noktasındaki ışının ilk dolu birim küpe giriş noktası -> tmp (yoksa false)
function surfaceHit(cx, cy, G) {
  const r = PX.scene.rect;
  tmp.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, -1).unproject(C.cam); C.cam.getWorldDirection(tmp2);
  const o = [tmp.x + 0.5, tmp.y + 0.5, tmp.z + 0.5], d = [tmp2.x, tmp2.y, tmp2.z], n = [G.W, G.H, G.D], p = [0, 0, 0], tm = [0, 0, 0];
  let t0 = 0, t1 = 1e9;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < 0 || o[i] > n[i]) return false; d[i] = 1e-9; }
    let a = -o[i] / d[i], b = (n[i] - o[i]) / d[i]; if (a > b) { const q = a; a = b; b = q; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
  }
  if (t0 > t1) return false;
  for (let i = 0; i < 3; i++) { p[i] = Math.min(n[i] - 1, Math.max(0, Math.floor(o[i] + d[i] * (t0 + 1e-6)))); tm[i] = ((d[i] > 0 ? p[i] + 1 : p[i]) - o[i]) / d[i]; }
  const skip = PX.diorama && PX.diorama.fadedSet ? PX.diorama.fadedSet() : null;
  for (let t = t0; t <= t1;) {
    const ci = G.idx(p[0], p[1], p[2]), kd = G.kind[ci];
    if (kd && kd !== 4 && !(skip && skip.has(ci))) { tmp.set(o[0] + d[0] * t - 0.5, o[1] + d[1] * t - 0.5, o[2] + d[2] * t - 0.5).addScaledVector(tmp2, 1e-3); return true; }
    const k = tm[0] < tm[1] ? (tm[0] < tm[2] ? 0 : 2) : (tm[1] < tm[2] ? 1 : 2);
    t = tm[k]; tm[k] += Math.abs(1 / d[k]); p[k] += d[k] > 0 ? 1 : -1;
    if (p[k] < 0 || p[k] >= n[k]) return false;
  }
  return false;
}
function worldToClient(x, y, z, out) { return proj(C.cam, x, y, z, out); }
function proj(cam, x, y, z, out) {
  out = out || { x: 0, y: 0 };
  tmp2.set(x, y, z).project(cam);
  const r = PX.scene.rect;
  out.x = r.left + (tmp2.x + 1) / 2 * r.width; out.y = r.top + (1 - tmp2.y) / 2 * r.height;
  return out;
}
// cihaz kodu etiketi ayıklama (telefon boyunda C1/S2, Q0T/KC… üst üste biniyordu): b = [{x, y, w, h}] (kutu merkezi,
// CSS px). Her kutuya dx, dy yazar: ekranda alttaki (kameraya yakın) önce yerinde kalır; çakışan sonraki önce dikeyde
// (±1…±4 satır), sonra yatayda yarım/tam genişlik kayar; hiçbiri boş değilse yerinde kalır. Yalnız kamera değişince çağrılır.
const DC = [0, 0, 0, -1, 0, 1, -1, 0, 1, 0, 0, -2, 0, 2, -1, -1, 1, -1, -1, 1, 1, 1, 0, -3, 0, 3, -1, -2, 1, -2, -1, 2, 1, 2, -2, 0, 2, 0, -2, -1, 2, -1, -2, 1, 2, 1, 0, -4, 0, 4];
function declutter(b) {
  const o = b.slice().sort((p, q) => q.y - p.y);
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    for (let k = 0; k < DC.length; k += 2) {
      p.dx = DC[k] * (p.w * 0.5 + 2); p.dy = DC[k + 1] * (p.h + 1);
      let hit = false;
      for (let j = 0; j < i && !hit; j++) { const q = o[j]; hit = Math.abs(p.x + p.dx - q.x - q.dx) < (p.w + q.w) / 2 + 1 && Math.abs(p.y + p.dy - q.y - q.dy) < (p.h + q.h) / 2 + 1; }
      if (!hit) break;
      if (k === DC.length - 2) p.dx = p.dy = 0;
    }
  }
  return b;
}
// test/parite: görünüm v'ye tam oturmuş bir kopya kamera (kimlik tamponu geçişi)
function viewCamera(v, out) {
  const cam = out || new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400);
  const hh = Math.max(C.ext.ey, C.ext.ex) * 1.08;
  cam.left = -hh; cam.right = hh; cam.top = hh; cam.bottom = -hh; cam.near = -200; cam.far = 400; cam.updateProjectionMatrix();
  return placeAt(cam, azOf(v));
}
Object.assign(C, { init, setViewport, setLevel, fit, snapTo, syncView, update, grab, drag, release, busy, pick, worldToClient, azOf, nearAz, EL,
  spawn, dragView, viewCamera, viewOfAz, OMEGA, setZoom, dragScale, declutter });
PX.camera = C;
