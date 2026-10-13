// ============================================================================
// input/gesture.js — PX.gesture : jest durum makinesi (§12.1, §24.3)              sahip: Girdi (controller)
//   BOŞ -pointerdown-> BASILI(t0,x0,y0)   (kamera yaylanıyorsa o an yakalanır: "dönen kamerayı tut")
//   BASILI -hareket > 10 px, yatay baskın-> SÜRÜKLE  (meşgul olsa da; sürükleme ASLA dokunmaya dönmez)
//   BASILI -hareket > 10 px, dikey baskın-> İPTAL
//   BASILI -pointerup, < 10 px, < 350 ms-> DOKUN(x,y) -> PX.camera.pick -> PX.game.command({t:'tap',…})
//            (Volti'nin silüetine dokunuş -> {t:'tap', volti:true}: arkasındaki karo/cihaz seçilmez, §12.7)
//            (350–450 ms hareketsiz basış da dokunuştur: uzun basış tetiklenmeden bırakılan girdi düşürülmez)
//   BASILI -450 ms sabit-> UZUN_BAS (bus 'ui:longpress' {cell, el})
//   SÜRÜKLE -pointerup-> BIRAK(dx, vx): q = round(açı / 90°) (+ fırlatma), en çok ±2, q adet {t:'rot', src:'drag'};
//            kamera bırakma hızıyla tohumlanmış yayla PX.game.camView'e gider. Kural sürümü 4: döndürme YALNIZ
//            görseldir (komşuluk/erişim/elektrik değişmez) ve hiçbir zaman reddedilmez; yasak yön yoktur.
//   iki parmak dokunuşu (< 250 ms, < 10 px) -> {t:'undo'};  iki parmak açma/kısma -> iki kademeli zoom
// Ayrıntılar:
//   * Kamera SÜRÜKLE'ye geçerken yakalanır, dx geçiş noktasından ölçülür (sıçrama yok). Dönen kamera
//     pointerdown'da tutulur ve dokunuş/iptalde aynı hızla bırakılır (tutuş dokunuşu dondurmaz).
//   * Açı ölçeği: 90° = clamp(180, 0.45·min(g,y), 260) CSS px. Fırlatma: |v|·375/min(g,y) ≥ 0,9 px/ms ve |dx| ≥ 30 px.
//   * Bir sürüklemede en çok ±180° (2 adım); ötesinde lastik bant θ' = 19°·tanh(θ/19°) (yalnız his, ret yok).
//   * Seçim: PX.camera.pick (render; sim2.ownerAt ile aynı sahiplik). pick yoksa ya da hücre vermezse yedek seçim:
//     dokunulan noktanın görünüm kafesi koordinatı (A = sx·x − y, B = sz·z − y) kameranın worldToClient afininden
//     çözülür ve sim2.ownerAt ile sahibi bulunur (yarı saydam örtücüler PX.diorama.fadedSet() ile atlanır).
//     kind 'none' ama hücre varsa (merdiven, iskele, kapı, duvar) dokunuş yine controller'a gider (çık/in ya da neden).
//   * Tekerlek: yatay (izleme dörtgeni) = sürükleme gibi (bırakma 140 ms sessizlikte); dikey (fare tekerleği) =
//     her ~100 birim bir {t:'rot'} (zaman kilidi yok; FIFO tamponlar).
//   * Her pointerdown: doğuşu (PX.render.skip) ve kazanma kutlamasını (PX.game.skipCelebration) atlar.
//   PX.gesture.init(canvas)   PX.gesture.state() -> 'idle'|'pressed'|'drag'|'cancel'|'two'|'pinch'
//   PX.gesture.stats -> {taps, drags, undos, longs, pinches, rubber}
// Kare başına ayırma yok: durum önceden ayrılmış; hız halkası Float64Array.
// ============================================================================
const TAP_PX = 10, TAP_MS = 350, LONG_MS = 450, TWO_MS = 250, TWO_PX = 10;
const RUB_DEG = 19, HALF = Math.PI / 2, MAXQ = 2;
const FLING_V = 0.9, FLING_DX = 30, PINCH_OUT = 1.25, PINCH_IN = 0.8;
const VEL_N = 8, VEL_WIN = 60, VEL_STALE = 90, WHEEL_IDLE = 140, WHEEL_STEP = 100;
const st = {
  mode: 'idle', id: -1, id2: -1, extra: 0, x0: 0, y0: 0, t0: 0, x: 0, y: 0, x2: 0, y2: 0, x20: 0, y20: 0, t2: 0, d0: 1,
  grabbed: false, grabVel: 0, xg: 0, azg: 0, azBase: 0, lo: 0, hi: 0, baseV: 0, baseP: -1, rel: 0, cand: 0, rub: 0,
  longT: 0, moved2: false, lastPress: 0, taps: 0, drags: 0, undos: 0, longs: 0, pinches: 0, rubbers: 0, zoom: 0,
  vx: new Float64Array(VEL_N), vt: new Float64Array(VEL_N), vi: 0, vn: 0,
  wheelAcc: 0, wheelX: 0, wheelT: 0, wheelDrag: false, wheelTimer: 0,
};
const now = e => (e && e.timeStamp > 0 ? e.timeStamp : performance.now());
const cam = () => PX.camera;

// ---------------------------------------------------------------- hız izleyici (halka; ayırmasız)
function velReset(x, t) { st.vi = 0; st.vn = 0; velPush(x, t); }
function velPush(x, t) {
  if (st.vn) { const lt = st.vt[(st.vi - 1 + VEL_N) % VEL_N]; if (t < lt) t = lt; }        // zaman damgası geriye gidemez
  const i = st.vi; st.vx[i] = x; st.vt[i] = t; st.vi = (i + 1) % VEL_N; if (st.vn < VEL_N) st.vn++; }
// birleştirilmiş (coalesced) ara örnekler: yavaş karede bile hız doğru (yalnız sürüklemede, kare başına değil)
function pushCoalesced(e, t) {
  const ce = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
  if (ce && ce.length > 1) { for (let i = 0; i < ce.length; i++) velPush(ce[i].clientX, ce[i].timeStamp > 0 ? ce[i].timeStamp : t); }
  else velPush(e.clientX, t);
}
function velocity(tEnd) {          // px/ms, son ~60 ms; parmak durduysa 0
  if (st.vn < 2) return 0;
  const last = (st.vi - 1 + VEL_N) % VEL_N; const tl = st.vt[last], xl = st.vx[last];
  if (tEnd - tl > VEL_STALE) return 0;                         // parmak durup sonra kalktı
  // son örnek bırakma noktasıysa ve önceki örnekle aynı anda geldiyse, ondan öncesine bak (dt ≥ 4 ms)
  let j = last;
  for (let k = 1; k < st.vn; k++) { const i = (last - k + VEL_N) % VEL_N; j = i; if (tl - st.vt[i] >= VEL_WIN) break; }
  const dt = tl - st.vt[j]; return dt >= 4 ? (xl - st.vx[j]) / dt : 0;
}

// ---------------------------------------------------------------- kamera yardımcıları
function viewport() {
  const c = cam(); const w = (c && c.w > 1 ? c.w : 0) || (PX.scene && PX.scene.w) || window.innerWidth || 375;
  const h = (c && c.h > 1 ? c.h : 0) || (PX.scene && PX.scene.h) || window.innerHeight || 667;
  return Math.min(w, h);
}
function dragScale() { const c = cam(); if (c && typeof c.dragScale === 'function') return c.dragScale(); return Math.max(180, Math.min(0.45 * viewport(), 260)); }
function nearAz(v, ref) { const c = cam(); if (c && c.nearAz) return c.nearAz(v, ref); const a = Math.PI / 4 + HALF * v; return a + Math.round((ref - a) / (2 * Math.PI)) * 2 * Math.PI; }
function camBusy() { const c = cam(); return !!(c && c.busy && c.busy()); }
function grab() { const c = cam(); if (!c) return; st.grabVel = typeof c.azVel === 'number' ? c.azVel : 0; if (c.grab) c.grab(); st.grabbed = true; }
// tutulan kamerayı (dokunuş/iptal) bırak: yay o anki açı ve hızdan mantıksal hedefe devam eder
// (yayı durdurmayan kamera için snapTo hızı korur; durduran kamera için yeniden başlatır)
function resume() {
  if (!st.grabbed) return; st.grabbed = false;
  const c = cam(); if (!c) return;
  if (c.release) c.release(0);
  if (c.snapTo) c.snapTo(PX.game.camView);
}
function skipFX() {
  try { if (PX.render && typeof PX.render.skip === 'function') PX.render.skip(); } catch (e) { /* yoksay */ }
  try { if (PX.game && PX.game.skipCelebration) PX.game.skipCelebration(); } catch (e) { /* yoksay */ }
}
function capture(e) { try { e.target.setPointerCapture(e.pointerId); } catch (x) { /* yoksay */ } }

// ---------------------------------------------------------------- olaylar
function onDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const t = now(e);
  if (st.id < 0 && st.id2 < 0 && st.mode === 'idle') {
    if (st.wheelDrag) wheelEnd();                              // tekerlek zamanlayıcısı yeni parmak hareketini bırakamaz
    clearTimeout(st.wheelTimer); st.wheelTimer = 0; st.wheelAcc = 0;
    skipFX();
    st.id = e.pointerId; st.mode = 'pressed'; st.x0 = st.x = e.clientX; st.y0 = st.y = e.clientY; st.t0 = t;
    capture(e);
    st.grabbed = false;
    if (camBusy()) grab();                                     // dönen kamerayı tut
    velReset(e.clientX, t);
    clearTimeout(st.longT); st.longT = setTimeout(onLong, LONG_MS);
    PX.bus.emit('input:pointer', { kind: e.pointerType || 'touch' });
    return;
  }
  if (st.id2 < 0 && e.pointerId !== st.id) {
    st.id2 = e.pointerId; st.x2 = st.x20 = e.clientX; st.y2 = st.y20 = e.clientY; st.t2 = t; capture(e);
    clearTimeout(st.longT);
    if (st.mode === 'drag') endDrag(t, true);
    else if (st.grabbed) resume();
    st.mode = 'two'; st.moved2 = false; st.x0 = st.x; st.y0 = st.y;
    st.d0 = Math.max(1, Math.hypot(st.x2 - st.x, st.y2 - st.y));
    return;
  }
  st.extra++; if (st.mode === 'two' || st.mode === 'pinch') st.mode = 'cancel';
}
function onMove(e) {
  const isA = e.pointerId === st.id, isB = e.pointerId === st.id2;
  if (!isA && !isB) return;
  if (isA) { st.x = e.clientX; st.y = e.clientY; } else { st.x2 = e.clientX; st.y2 = e.clientY; }
  const t = now(e);
  switch (st.mode) {
    case 'pressed': {
      pushCoalesced(e, t);
      const dx = st.x - st.x0, dy = st.y - st.y0;
      if (dx * dx + dy * dy > TAP_PX * TAP_PX) {
        clearTimeout(st.longT);
        if (Math.abs(dx) >= Math.abs(dy)) { startDrag(t); dragTo(); }
        else { st.mode = 'cancel'; resume(); }
      }
      break;
    }
    case 'drag': if (isA) { pushCoalesced(e, t); dragTo(); } break;
    case 'two': case 'pinch': {
      if (Math.hypot(st.x - st.x0, st.y - st.y0) > TWO_PX || Math.hypot(st.x2 - st.x20, st.y2 - st.y20) > TWO_PX) st.moved2 = true;
      if (st.mode === 'two') {
        const r = Math.hypot(st.x2 - st.x, st.y2 - st.y) / st.d0;
        if (r > PINCH_OUT || r < PINCH_IN) { st.mode = 'pinch'; st.pinches++; setZoom(r > 1 ? 1 : 0, (st.x + st.x2) / 2, (st.y + st.y2) / 2); }
      }
      break;
    }
  }
}
function onUp(e) {
  const isA = e.pointerId === st.id, isB = e.pointerId === st.id2;
  if (!isA && !isB) { if (st.extra > 0) st.extra--; return; }
  const t = now(e);
  if (isA) { st.x = e.clientX; st.y = e.clientY; } else { st.x2 = e.clientX; st.y2 = e.clientY; }
  if (st.mode === 'two' || st.mode === 'pinch' || (st.mode === 'cancel' && st.id2 >= 0)) {
    if (Math.hypot(st.x - st.x0, st.y - st.y0) > TWO_PX || Math.hypot(st.x2 - st.x20, st.y2 - st.y20) > TWO_PX) st.moved2 = true;
    // iki parmak: son parmak kalkınca karar
    if (isA) st.id = -1; else st.id2 = -1;
    if (st.id >= 0 || st.id2 >= 0) {
      return;
    }
    const ok = st.mode === 'two' && !st.moved2 && st.extra === 0 && t - st.t2 < TWO_MS;
    endAll();
    if (ok) { st.undos++; PX.game.command({ t: 'undo', src: 'two-finger' }); }
    return;
  }
  if (!isA) { st.id2 = -1; return; }
  clearTimeout(st.longT);
  const mode = st.mode;
  if (mode === 'pressed') {
    const dx = st.x - st.x0, dy = st.y - st.y0;
    // < 350 ms = dokunuş (§12.1). 350–450 ms arası ölü bant yerine de dokunuş: hareketsiz bir basış uzun basışa
    // dönüşmeden bırakıldıysa sessizce yok sayılmaz (§12.7 "sessiz yok sayma yok"); uzun basış zaten iptal etti.
    const isTap = dx * dx + dy * dy < TAP_PX * TAP_PX && t - st.t0 < Math.max(TAP_MS, LONG_MS);
    st.lastPress = t - st.t0;                                    // tanı: son basışın süresi (ms)
    resume();
    endAll();
    if (isTap) tap(st.x0, st.y0);
    return;
  }
  if (mode === 'drag') { velPush(st.x, t); dragTo(); endDrag(t, false); endAll(); return; }   // bırakma noktası da sayılır
  resume(); endAll();
}
function onCancel(e) {
  if (e.pointerId !== st.id && e.pointerId !== st.id2) { if (st.extra > 0) st.extra--; return; }
  clearTimeout(st.longT);
  if (st.mode === 'drag') endDrag(now(e), true); else resume();
  endAll();
}
function endAll() { st.mode = 'idle'; st.id = -1; st.id2 = -1; st.extra = 0; }
function onLong() {
  if (st.mode !== 'pressed') return;
  st.mode = 'cancel'; st.longs++;
  resume();
  const vc = hitVolti(st.x0, st.y0);
  if (vc >= 0) { PX.bus.emit('ui:longpress', { cell: vc, el: null, volti: true, x: st.x0, y: st.y0 }); return; }   // arkadaki cihazın kartı değil
  const p = pick(st.x0, st.y0); const L = PX.game.L;
  let el = p.el >= 0 && L && L.els[p.el] ? L.els[p.el].id : null;
  if (!el && L && p.cell >= 0) { const e = L.els.find(x => x.cell === p.cell); if (e) el = e.id; }
  PX.bus.emit('ui:longpress', { cell: p.cell, el, x: st.x0, y: st.y0 });
}
function tap(x, y) {
  st.taps++;
  // Volti'nin gövdesine (kask/baş dahil) dokunuş: arkasındaki karo/cihaz DEĞİL Volti'nin kendisi (§12.7 "görünen")
  const vc = hitVolti(x, y);
  if (vc >= 0) { PX.game.command({ t: 'tap', volti: true, cell: vc, src: 'touch' }); return; }
  const p = pick(x, y);
  // kind 'none' ama hücre var (merdiven, iskele, kapı, duvar, yan yüz): hücre türünü controller çözer (çık/in, neden)
  if (!p || p.cell < 0) { if (PX.fx && PX.fx.ripple) PX.fx.ripple(x, y); return; }
  if (!PX.game.command({ t: 'tap', U: p.U, V: p.V, tri: p.tri, cell: p.cell, src: 'touch' }) && PX.fx && PX.fx.ripple) PX.fx.ripple(x, y);
}
// seçim: kamera (render) + yedek (sim2.ownerAt). Asla istisna atmaz.
const PK = { kind: 'none', cell: -1, el: -1, U: 0, V: 0, tri: 0, top: false };
function pick(x, y) {
  const c = cam(); let p = null;
  try { p = c && typeof c.pick === 'function' ? c.pick(x, y) : null; } catch (e) { p = null; }
  if (p && p.cell >= 0) return p;
  let q = null; try { q = fallbackPick(x, y); } catch (e) { q = null; }
  return q || p || PK;
}
const WP = { x: 0, y: 0 };
function fallbackPick(x, y) {
  const c = cam(), g = PX.game, L = g && g.L, S = PX.SIM;
  if (!c || !c.worldToClient || !L || !S.ownerAt) return null;
  const v = (typeof g.camView === 'number' ? g.camView : c.v) & 3;
  if (typeof c.az === 'number' && Math.abs(c.az - nearAz(v, c.az)) > 0.02) return null;   // döndürme ortası: kameranın pick'i işler
  const sx = S.VIEWS[v][0], sz = S.VIEWS[v][1];
  c.worldToClient(0, 0, 0, WP); const ox = WP.x, oy = WP.y;
  c.worldToClient(sx, 0, 0, WP); const ax = WP.x - ox, ay = WP.y - oy;
  c.worldToClient(0, 0, sz, WP); const bx = WP.x - ox, by = WP.y - oy; const D = ax * by - ay * bx; if (Math.abs(D) < 1e-9) return null;
  const qx = x - ox, qy = y - oy; const A = (qx * by - qy * bx) / D, B = (ax * qy - ay * qx) / D;   // y = 0 düzleminde A = sx·x, B = sz·z
  const U = Math.floor(A), V = Math.floor(B), tri = A - U <= B - V ? 1 : 0;
  let skip = null; try { skip = PX.diorama && typeof PX.diorama.fadedSet === 'function' ? PX.diorama.fadedSet() : null; } catch (e) { skip = null; }
  const o = S.ownerAt(L, v, U, V, tri, skip); if (!o) return { kind: 'none', cell: -1, el: -1, U, V, tri, top: false };
  const kd = L.G.kind[o.c]; let el = -1; if (kd === 2 || kd === 6) el = L.els.findIndex(e => e.cell === o.c);
  return { kind: kd === 2 ? 'el' : (kd === 1 && o.top && L.walkable(o.c)) ? 'tile' : 'none', cell: o.c, el, U, V, tri, top: !!o.top };
}

// ---------------------------------------------------------------- Volti isabeti (§12.7)
// camera.pick yalnız sahiplik tablosunu (küpler) okur; Volti'nin gövdesi orada yok, bu yüzden üst gövde/kask/baş
// dokunuşu arkasındaki karo ya da cihaza çözülürdü. Ekrandaki silüet: ayaktan kask tepesine dikey kapsül (yarıçap
// VR). İçindeyse dokunuş Volti'nindir (önündeki bloklar yarı saydam). Döndürme ortasında yok sayılır. Ayırmasız.
const VH = 0.9, VR = 0.2, WA = { x: 0, y: 0 }, WB = { x: 0, y: 0 };
function hitVolti(x, y) {
  const c = cam(), g = PX.game, L = g && g.L, P = PX.volti && PX.volti.probe ? PX.volti.probe() : null;
  if (!c || !c.worldToClient || !L || !P || !(P.cell >= 0) || typeof P.footY !== 'number') return -1;
  const v = c.v & 3, f = P.footY, w = (X, Y, Z) => c.worldToClient(X, Y, Z, WB);
  if (Math.abs(c.az - nearAz(v, c.az)) > 0.14) return -1;
  c.worldToClient(P.x, f, P.z, WA); w(P.x, f + VH, P.z);
  const hx = WB.x - WA.x, hy = WB.y - WA.y, l2 = hx * hx + hy * hy; if (!(l2 > 1)) return -1;
  let t = ((x - WA.x) * hx + (y - WA.y) * hy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = VR * Math.sqrt(l2) / (VH * Math.cos(c.EL)), dx = x - WA.x - t * hx, dy = y - WA.y - t * hy;
  if (dx * dx + dy * dy > r * r) return -1;
  // kural sürümü 4: Volti'nin önündeki bloklar render'da yarı saydamdır (sim2.occluders) => silüet her zaman görünür
  return P.cell;
}

// ---------------------------------------------------------------- sürükleme (döndürme)
function startDrag(t) {
  st.mode = 'drag'; st.drags++;
  if (!st.grabbed) grab();
  const c = cam();
  // dx, eşiğin aşıldığı noktadan ölçülür (sıçrama yok); birleştirilmiş olayda parmağın gerçek yolu kaybolmaz
  st.azg = c ? c.az : 0; st.xg = st.x0 + (st.x >= st.x0 ? TAP_PX : -TAP_PX);
  const v0 = typeof PX.game.camView === 'number' ? PX.game.camView : PX.game.state().view;
  st.baseV = v0; st.baseP = -1;
  st.azBase = nearAz(v0, st.azg);
  st.hi = MAXQ; st.lo = -MAXQ;                                  // döndürme yalnız görsel: yasak yön yok
  st.rel = (st.azg - st.azBase) / HALF; st.cand = 0; st.rub = 0;
  velReset(st.x, t);
}
// lastik bant: izinli aralık [lo, hi] (adım), dışında θ' = 19°·tanh(θ/19°)
function band(rel) {
  if (rel > st.hi) return st.hi + RUB_DEG * Math.tanh((rel - st.hi) * 90 / RUB_DEG) / 90;
  if (rel < st.lo) return st.lo - RUB_DEG * Math.tanh((st.lo - rel) * 90 / RUB_DEG) / 90;
  return rel;
}
function dragTo() { dragDx(st.x - st.xg); }
function dragDx(dxRaw) {
  const sc = dragScale();
  const raw = (st.azg - dxRaw * HALF / sc - st.azBase) / HALF;
  const rel = band(raw); st.rel = rel;
  const az = st.azBase + rel * HALF;
  const c = cam(); if (c && c.drag) c.drag((st.azg - az) * sc / HALF, true);    // true: lastik bant burada uygulandı
  const rub = raw > st.hi + 1e-6 ? 1 : raw < st.lo - 1e-6 ? -1 : 0;
  if (rub !== st.rub) { st.rub = rub; if (rub) st.rubbers++; }
}
function endDrag(t, cancelled) {
  const vx = cancelled ? 0 : velocity(t);
  let q = cancelled ? 0 : Math.max(st.lo, Math.min(st.hi, Math.round(st.rel)));
  if (!cancelled && q === 0) {
    const vn = vx * 375 / viewport(); const dx = st.x - st.x0;
    if (Math.abs(vn) >= FLING_V && Math.abs(dx) >= FLING_DX && Math.sign(dx) === Math.sign(vx)) {
      const f = vx > 0 ? -1 : 1;                                // parmak sağa => az azalır => d−
      if ((f > 0 && st.hi >= 1) || (f < 0 && st.lo <= -1)) q = f;
    }
  }
  const c = cam();
  if (c && c.release) c.release(vx);                            // dragging biter, yay bırakma hızıyla tohumlanır
  st.grabbed = false;
  st.rub = 0; st.cand = 0;
  const d = q > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(q); i++) if (!PX.game.command({ t: 'rot', d, src: 'drag' })) break;
  if (c && c.snapTo) c.snapTo(PX.game.camView);                  // bırakma hızıyla yeni görünüme (q = 0: geri yaylanır)
}

// ---------------------------------------------------------------- zoom (iki kademe; kamera desteklerse)
// Karşılaştırma kameranın GERÇEK kademesine karşı: camera.setLevel (seviye yükleme) zoom'u 1×'e sıfırlar; jestin kendi
// kopyası (st.zoom) ona göre değil buna göre karşılaştırılsaydı sonraki seviyede açma jestleri ölü kalırdı.
function setZoom(level, x, y) {
  const c = cam();
  const cur = c && typeof c.zoomLevel === 'number' ? c.zoomLevel : st.zoom;
  if (level === cur) { st.zoom = level; return; }
  st.zoom = level;
  if (c && typeof c.setZoom === 'function') c.setZoom(level, { x, y });
  PX.bus.emit('gesture:zoom', { level });
}

// ---------------------------------------------------------------- tekerlek / izleme dörtgeni
function onWheel(e) {
  if (e.cancelable) e.preventDefault();
  if (st.mode !== 'idle') return;
  const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * k, dy = e.deltaY * k; const t = now(e);
  if (Math.abs(dx) > Math.abs(dy)) {
    // yatay: sürükleme gibi (parmak sağa = içerik sağa = deltaX negatif)
    if (!st.wheelDrag) {
      skipFX(); st.wheelDrag = true; st.x0 = st.x = 0; st.wheelX = 0; grab(); startDrag(t); st.mode = 'idle'; st.drags--;
    }
    st.wheelX -= dx; st.x = st.wheelX; velPush(st.x, t); dragDx(st.wheelX);
    clearTimeout(st.wheelTimer); st.wheelTimer = setTimeout(wheelEnd, WHEEL_IDLE);
    return;
  }
  if (st.wheelDrag) wheelEnd();                               // yatay bitişi dikey birikim zamanlayıcısına kaybolmaz
  st.wheelAcc += dy;
  while (Math.abs(st.wheelAcc) >= WHEEL_STEP) {
    const d = st.wheelAcc > 0 ? 1 : -1; st.wheelAcc -= d * WHEEL_STEP;
    PX.game.command({ t: 'rot', d, src: 'wheel' });
  }
  clearTimeout(st.wheelTimer); st.wheelTimer = setTimeout(() => { st.wheelAcc = 0; }, 300);
}
function wheelEnd() {
  if (!st.wheelDrag) return;
  clearTimeout(st.wheelTimer); st.wheelTimer = 0;
  st.wheelDrag = false; st.x0 = 0;
  // izleme dörtgeni ataleti tarayıcıda zaten var: fırlatma yok, yalnız yuvarlama
  st.vn = 0; endDrag(performance.now(), false);
}
function cancelInput() {
  clearTimeout(st.longT); clearTimeout(st.wheelTimer);
  st.longT = st.wheelTimer = 0;
  if (st.mode === 'drag' || st.wheelDrag) endDrag(performance.now(), true); else resume();
  st.wheelDrag = false; st.wheelAcc = 0;
  endAll();
}

function init(canvas) {
  if (PX.bus && PX.bus.on) {
    PX.bus.on('level:loaded', () => { cancelInput(); st.zoom = 0; });   // camera.setLevel zoom'u sıfırlar
    PX.bus.on('reset', cancelInput);
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', e => { if ((e.pointerId === st.id || e.pointerId === st.id2) && st.mode !== 'idle') onCancel(e); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // tuvaldeki dokunuşun uyumluluk fare olayları ve click'i üretilmez: dokunuşla altında beliren düğmeye (çip) hayalet
  // tık düşmesin. Jest pointer olaylarıyla çalışır (etkilenmez).
  canvas.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
}
PX.gesture = {
  init, state: () => st.mode,
  get stats() { return { taps: st.taps, drags: st.drags, undos: st.undos, longs: st.longs, pinches: st.pinches, rubber: st.rubbers, zoom: st.zoom, lastPress: st.lastPress }; },
};
