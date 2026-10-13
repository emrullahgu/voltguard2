// ============================================================================
// input/keyboard.js — PX.keyboard : ekran yönlü eşleme + imleç önizlemesi (§12.2, §13 #12)   sahip: Girdi (controller)
// Ok tuşları hedef karonun EKRANDAKİ yer değiştirmesine göre eşlenir (v1'in dünya ekseni hatası yok):
// ekran kafesi yönleri (+U, −U, +V, −V) kameranın sağ/yukarı eksenlerine izdüşürülür; ekran açısı (0 = yukarı,
// saat yönü) +45° kaydırılıp sıralanır => ↑ = sağ-yukarı, → = sağ-aşağı, ↓ = sol-aşağı, ← = sol-yukarı.
// Kural sürümü 4: controller kafes yönünü sim2.screenToDir(kameraGörünümü, i) ile FİZİKSEL yöne çevirir ve
// sim2.stepToward ile tek fiziksel adım atar (düz komşu, merdiven sahanlığı ya da iskele ucu: ok tuşuyla merdiven
// çıkılır/inilir). Eşleme kameranın o anki görünümüne göredir (PX.game.camView).
// İmleç önizlemesi: klavye kullanılınca (ok tuşu) Volti boştayken her okun gideceği karoda küçük bir ok rozeti
// ([data-testid=kbd-cursor] içinde, [data-key=ArrowUp…]); dokunma/fare ile gizlenir; kamera/Volti hareket
// ederken gizli. Kare başına ayırma yok (yalnız konum değişince yeniden yerleşir).
// Tuşlar: oklar yürü · Q/E kamerayı döndür (yalnız görsel) · Z (Ctrl+Z) geri al · Y (Ctrl+Y, Ctrl+Shift+Z) yinele ·
//   H ipucu (Shift+H hayalet adım) · Boşluk ilk çip (çip yoksa kendi karosunun çipleri) · 1–9 çip.
//   Basılı tutulan okun otomatik tekrarı FIFO'yu doldurmaz (bekleyen adım varken tekrarlar yok sayılır; tek bekleyen
//   adım Volti'nin karo sınırında durmadan zincirlenmesine yeter).
//   PX.keyboard.init()   PX.keyboard.map(view?) -> {ArrowUp:dir, ArrowRight:dir, ArrowDown:dir, ArrowLeft:dir}
//   PX.keyboard.targets() -> {ArrowUp:cell|-1, …} (o anki öngörülen durumdan)   PX.keyboard.cursorOn -> bool
// ============================================================================
const ARROWS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
const GLYPH = { ArrowUp: '↑', ArrowRight: '→', ArrowDown: '↓', ArrowLeft: '←' };
const EL0 = Math.atan(1 / Math.SQRT2);
const K = { on: false, dirty: true, shown: false, lastAz: NaN, box: null, marks: {}, pt: { x: 0, y: 0 }, mapCache: [null, null, null, null] };

function camEL() { return PX.camera && typeof PX.camera.EL === 'number' ? PX.camera.EL : EL0; }
function azOf(v) { return PX.camera && PX.camera.azOf ? PX.camera.azOf(v) : Math.PI / 4 + Math.PI / 2 * v; }
// görünüm v için ok -> sim2.DIRS indeksi (analitik; kamera dinlenme açısında)
function computeMap(v) {
  const sx = PX.SIM.VIEWS[v][0], sz = PX.SIM.VIEWS[v][1];
  const th = azOf(v), EL = camEL();
  const fx = Math.cos(EL) * Math.cos(th), fy = Math.sin(EL), fz = Math.cos(EL) * Math.sin(th);   // hedeften kameraya
  const rl = Math.hypot(fz, fx); const Rx = fz / rl, Rz = -fx / rl;                                // ekran sağı = f × yukarı'nın tersi
  const ux = fy * Rz, uz = -fy * Rx;                                                                // ekran yukarısı (y bileşeni gereksiz: Δy=0)
  const ang = PX.SIM.DIRS.map((d, i) => {
    const wx = sx * d[0], wz = sz * d[1];
    const X = wx * Rx + wz * Rz, Y = wx * ux + wz * uz;
    return { i, a: (Math.atan2(X, Y) + 2 * Math.PI + Math.PI / 4) % (2 * Math.PI) };
  });
  ang.sort((p, q) => p.a - q.a);
  const out = {}; ARROWS.forEach((k, j) => { out[k] = ang[j].i; });
  return out;
}
function map(view) {
  const v = (view === undefined ? PX.game.state().view : view) & 3;
  if (!K.mapCache[v]) K.mapCache[v] = computeMap(v);
  return Object.assign({}, K.mapCache[v]);
}
function targets() {
  const out = { ArrowUp: -1, ArrowRight: -1, ArrowDown: -1, ArrowLeft: -1 };
  const L = PX.game.L; const st = PX.game.state(); if (!L || !st.s) return out;
  const v = st.view & 3; const m = map(v);
  for (const k of ARROWS) { let t = -1; try { t = PX.SIM.stepToward(L, st.s, PX.SIM.screenToDir(v, m[k])); } catch (e) { t = -1; } out[k] = t; }
  return out;
}

// ---------------------------------------------------------------- imleç önizlemesi (DOM kaplaması)
function buildCursor() {
  if (K.box || typeof document === 'undefined') return;
  const box = document.createElement('div'); box.setAttribute('data-testid', 'kbd-cursor'); box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:30';
  for (const k of ARROWS) {
    const m = document.createElement('span'); m.setAttribute('data-key', k); m.textContent = GLYPH[k];
    m.style.cssText = 'position:absolute;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:11px;display:none;' +
      'font:700 14px/22px system-ui,sans-serif;text-align:center;color:#06121f;background:rgba(127,227,255,.92);box-shadow:0 0 0 2px rgba(6,18,31,.55);will-change:transform';
    box.appendChild(m); K.marks[k] = m;
  }
  document.body.appendChild(box); K.box = box;
}
function hide() { if (!K.shown) return; K.shown = false; for (const k of ARROWS) K.marks[k].style.display = 'none'; }
function place() {
  const L = PX.game.L; if (!L || !K.box || !PX.camera || !PX.camera.worldToClient) return;
  const t = targets(); let any = false;
  for (const k of ARROWS) {
    const m = K.marks[k]; const c = t[k];
    if (c < 0) { m.style.display = 'none'; continue; }
    const xyz = L.G.xyz(c); const p = PX.camera.worldToClient(xyz[0], xyz[1] + 0.5, xyz[2], K.pt);
    m.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)'; m.style.display = 'block'; any = true;
  }
  K.shown = any;
}
function frame() {
  if (!K.on) return;
  const busy = PX.game.busy || (PX.camera && PX.camera.busy && PX.camera.busy());
  const az = PX.camera ? PX.camera.az : 0;
  if (busy || az !== K.lastAz) { K.lastAz = az; K.dirty = true; hide(); return; }
  if (K.dirty) { K.dirty = false; place(); }
}
function cursorOff() { K.on = false; hide(); }
function screenOk() { const c = PX.screens && PX.screens.current; return !c || c === 'game' || c === 'win'; }

// ---------------------------------------------------------------- tuşlar
function onKey(e) {
  const tg = e.target;
  if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
  if (e.altKey) return;
  if (!PX.game || !PX.game.L || !screenOk()) return;
  const k = e.key; const lk = typeof k === 'string' ? k.toLocaleLowerCase('tr') : ''; const code = e.code || '';
  const mod = e.ctrlKey || e.metaKey;
  let cmd = null;
  if (mod) {
    if (lk === 'z' || code === 'KeyZ') cmd = e.shiftKey ? { t: 'redo' } : { t: 'undo' };
    else if (lk === 'y' || code === 'KeyY') cmd = { t: 'redo' };
    else return;
  } else if (ARROWS.indexOf(k) >= 0) {
    K.on = true; K.dirty = true;
    // basılı tutma: en çok BİR bekleyen adım (Volti durmadan zincirlenir; bırakınca en çok bir adım daha)
    if (e.repeat && PX.game.state().queue > 0) { e.preventDefault(); return; }
    cmd = { t: 'walk', dir: map()[k], src: 'key' };
  } else if (lk === 'q') cmd = { t: 'rot', d: -1, src: 'key' };
  else if (lk === 'e') cmd = { t: 'rot', d: 1, src: 'key' };
  else if (lk === 'z') cmd = { t: 'undo', src: 'key' };
  else if (lk === 'y') cmd = { t: 'redo', src: 'key' };
  else if (lk === 'h') cmd = { t: 'hint', tier: e.shiftKey ? 2 : 1 };
  else if (k === ' ' || /^[1-9]$/.test(k)) {
    if (k === ' ' && tg && tg.tagName === 'BUTTON') return;      // odaklı düğmenin kendi Boşluk davranışı
    e.preventDefault();
    const chips = PX.hud && PX.hud.chips ? PX.hud.chips() : [];
    if (k === ' ' && !chips.length) { const st = PX.game.state(); if (st.s) PX.game.command({ t: 'tap', cell: st.s.p, src: 'key' }); return; }
    PX.bus.emit('ui:chipKey', { i: k === ' ' ? 0 : +k - 1 });
    return;
  }
  if (!cmd) return;
  if (e.repeat && cmd.t !== 'walk' && cmd.t !== 'undo' && cmd.t !== 'redo') { e.preventDefault(); return; }
  e.preventDefault();
  PX.game.command(cmd);
}
function init() {
  window.addEventListener('keydown', onKey);
  buildCursor();
  const dirty = () => { K.dirty = true; };
  for (const ev of ['anim:done', 'undo', 'redo', 'reset', 'level:loaded']) PX.bus.on(ev, dirty);
  PX.bus.on('input:pointer', cursorOff);
  PX.bus.on('screen', p => { if (p && p.name !== 'game') cursorOff(); });
  if (PX.main && PX.main.onFrame) PX.main.onFrame(frame);
}
PX.keyboard = { init, map, targets, get cursorOn() { return K.on; } };
