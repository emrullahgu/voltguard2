'use strict';
// tools/test/unit/controller_input.js — input/gesture.js ve input/keyboard.js birim testleri
// Jest: dokun / sürükle / iptal / uzun bas / iki parmak geri al / kıstırma / ±2 adım sınırı / fırlatma / dönen kamerayı
// tutma / meşgulken kaydırma asla dokunuş değil / merdiven-kapı hücresine dokunuş controller'a gider / yedek seçim.
// Klavye (kural sürümü 4): ekran yönlü eşleme -> sim2.screenToDir -> fiziksel adım (bağımsız izdüşümle doğrulanır,
// her v4 seviyesi × 4 görünüm × her fiziksel bağ, merdiven/iskele dahil), tuş -> komut, Q/E yalnız kamera.
const { makeEnv, suite, eq, ok, SIM } = require('./controller_harness');

function gestureEnv(o = {}) {
  const E = makeEnv();
  const calls = [];
  E.PX.game = {
    busy: false, camView: 0, L: { els: [{ id: 'Q01' }] }, _accept: true,
    command(c) { calls.push(c); return typeof this._accept === 'function' ? this._accept(c) : this._accept; },
    state() { return { view: 0, queue: 0 }; }, skipCelebration() { return false; },
  };
  E.PX.camera._pick = () => ({ kind: 'tile', cell: 12, el: -1, U: 1, V: 2, tri: 0 });
  E.load('input/gesture.js');
  const L = {}; const canvas = { addEventListener(t, fn) { (L[t] = L[t] || []).push(fn); } };
  E.PX.gesture.init(canvas);
  let t = 0;
  const fire = (type, id, x, y, dt = 0) => { t += dt; E.advance(dt); for (const fn of (L[type] || [])) fn({ pointerId: id, clientX: x, clientY: y, timeStamp: 1000 + t, pointerType: 'touch', button: 0, cancelable: true, preventDefault() {}, target: { setPointerCapture() {} } }); };
  const swipe = (x0, y0, x1, y1, ms, steps = 8, id = 1) => { fire('pointerdown', id, x0, y0); for (let i = 1; i <= steps; i++) fire('pointermove', id, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, ms / steps); fire('pointerup', id, x1, y1, 4); };
  const wheel = (dx, dy, dt = 0) => { t += dt; E.advance(dt); for (const fn of (L.wheel || [])) fn({ deltaX: dx, deltaY: dy, deltaMode: 0, timeStamp: 1000 + t, cancelable: true, preventDefault() {} }); };
  const scale = Math.max(180, Math.min(0.45 * 375, 260));
  return Object.assign(E, { calls, fire, swipe, wheel, scale, cmds: t2 => calls.filter(c => c.t === t2) });
}

module.exports = async function run() {
  const { test, res } = suite('controller_input');
  console.log('controller_input');

  await test('dokun: < 10 px, < 350 ms -> tek tap komutu; kamera boştaysa yakalanmaz', async () => {
    const E = gestureEnv(); E.fire('pointerdown', 1, 100, 300); E.fire('pointermove', 1, 104, 303, 30); E.fire('pointerup', 1, 104, 303, 40);
    eq(E.cmds('tap').length, 1); eq(E.cmds('tap')[0].cell, 12); eq(E.camCalls.filter(c => c[0] === 'grab').length, 0);
  });
  await test('meşgulken kaydırma ASLA dokunuş değil (16 px / 90 ms; 60 px / 140 ms)', async () => {
    const E = gestureEnv(); E.PX.game.busy = true;
    E.swipe(200, 250, 216, 251, 90); E.swipe(170, 250, 230, 252, 140);
    eq(E.cmds('tap').length, 0); eq(E.PX.gesture.stats.drags, 2);
  });
  await test('uzun basış 450 ms: ui:longpress, dokunuş yok; 400 ms hareketsiz basış düşürülmez (dokunuş)', async () => {
    const E = gestureEnv(); E.fire('pointerdown', 1, 50, 50); E.fire('pointerup', 1, 50, 50, 400); eq(E.cmds('tap').length, 1);
    E.calls.length = 0;
    E.fire('pointerdown', 1, 50, 50); E.advance(460); E.fire('pointerup', 1, 50, 50, 10);
    eq(E.events('ui:longpress').length, 1); eq(E.calls.length, 0);
  });
  await test('dikey baskın hareket -> iptal (dokunuş/döndürme yok)', async () => {
    const E = gestureEnv(); E.swipe(100, 300, 103, 200, 120);
    eq(E.calls.length, 0); eq(E.camCalls.filter(c => c[0] === 'drag').length, 0);
  });
  await test('iki parmak dokunuşu (< 250 ms, < 10 px) -> tek geri al; ilk parmağın dokunuşu bastırılır', async () => {
    const E = gestureEnv(); E.fire('pointerdown', 1, 100, 300); E.fire('pointerdown', 2, 140, 300, 20);
    E.fire('pointerup', 1, 100, 300, 60); E.fire('pointerup', 2, 140, 300, 5);
    eq(E.cmds('undo').length, 1); eq(E.cmds('tap').length, 0);
    const E2 = gestureEnv(); E2.fire('pointerdown', 1, 100, 300); E2.fire('pointerdown', 2, 140, 300, 20);
    E2.fire('pointermove', 2, 160, 300, 20); E2.fire('pointerup', 1, 100, 300, 20); E2.fire('pointerup', 2, 160, 300, 5);
    eq(E2.cmds('undo').length, 0, 'hareketli iki parmak geri almaz');
    const E3 = gestureEnv(); E3.fire('pointerdown', 1, 100, 300); E3.fire('pointerdown', 2, 140, 300, 20);
    E3.fire('pointerup', 1, 100, 300, 300); E3.fire('pointerup', 2, 140, 300, 5); eq(E3.cmds('undo').length, 0, 'uzun iki parmak geri almaz');
  });
  await test('kıstırma: iki kademeli zoom, geri al yok', async () => {
    const E = gestureEnv(); E.PX.camera.setZoom = (l) => E.camCalls.push(['zoom', l]);
    E.fire('pointerdown', 1, 150, 300); E.fire('pointerdown', 2, 200, 300, 10);
    for (let i = 1; i <= 5; i++) E.fire('pointermove', 2, 200 + i * 10, 300, 16);
    E.fire('pointerup', 1, 150, 300, 10); E.fire('pointerup', 2, 250, 300, 5);
    eq(E.cmds('undo').length, 0); ok(E.camCalls.some(c => c[0] === 'zoom' && c[1] === 1), 'zoom 1'); eq(E.PX.gesture.stats.zoom, 1);
  });
  await test('sürükle: 90° = ölçek px; parmak sola 0,6·ölçek -> d+ (sürükleme kaynaklı); dx eşik noktasından', async () => {
    const E = gestureEnv(); const x0 = 300;
    E.fire('pointerdown', 1, x0, 300); E.fire('pointermove', 1, x0 - 12, 300, 16);
    const first = E.camCalls.find(c => c[0] === 'drag'); ok(first && Math.abs(first[1] + 2) < 1e-6, 'geçişte sıçrama yok (yalnız eşiği aşan 2 px): ' + JSON.stringify(first));
    for (let i = 1; i <= 10; i++) E.fire('pointermove', 1, x0 - 12 - i * 0.06 * E.scale, 300, 30);
    E.fire('pointerup', 1, x0 - 12 - 0.6 * E.scale, 300, 120);
    eq(E.cmds('rot').map(c => [c.d, c.src]), [[1, 'drag']]); ok(E.camCalls.some(c => c[0] === 'release'));
    const last = E.camCalls[E.camCalls.length - 1]; eq(last[0], 'snap', 'son: kamera camView\'e');
  });
  await test('döndürme yalnız görsel: yasak yön yok; bir sürüklemede en çok ±2 adım (180° + 19° lastik), ret/olay yok', async () => {
    const E = gestureEnv();
    E.fire('pointerdown', 1, 360, 300); for (let i = 1; i <= 24; i++) E.fire('pointermove', 1, 360 - i * 20, 300, 16);
    const maxDeg = Math.max(...E.camCalls.filter(c => c[0] === 'drag').map(c => Math.abs(c[1]) * 90 / E.scale));
    ok(maxDeg <= 199.0001 && maxDeg > 185, 'en çok 180° + lastik: ' + maxDeg);
    E.fire('pointerup', 1, -120, 300, 200);
    eq(E.cmds('rot').map(c => [c.d, c.src]), [[1, 'drag'], [1, 'drag']], 'iki adım');
    eq(E.events('cmd:rejected').length, 0, 'toast yok'); eq(E.events('gesture:rubber').length, 0, 'lastik bant olayı yok');
    eq(E.events('izdusum:preview').length, 0, 'izdüşüm önizlemesi yok');
  });
  await test('fırlatma: 45 px / 40 ms (≥ 0,9 px/ms, ≥ 30 px) -> bir adım; yavaş 45 px -> geri yaylanır', async () => {
    const E = gestureEnv(); E.swipe(300, 300, 345, 300, 40, 4);
    eq(E.cmds('rot').map(c => c.d), [-1], 'parmak sağa = d−');
    const E2 = gestureEnv(); E2.swipe(300, 300, 345, 300, 400, 10); eq(E2.cmds('rot').length, 0);
  });
  await test('dönen kamerayı tut: pointerdown anında yakalanır; dokunuşta aynı hızla bırakılır', async () => {
    const E = gestureEnv(); E.PX.camera._busy = true; E.PX.camera.azVel = 2.5; E.PX.game.camView = 1;
    E.fire('pointerdown', 1, 100, 100); ok(E.camCalls.some(c => c[0] === 'grab'), 'yakalandı');
    E.fire('pointerup', 1, 100, 100, 50);
    const s = E.camCalls.filter(c => c[0] === 'snap').pop(); eq(s, ['snap', 1, undefined]); eq(E.cmds('tap').length, 1);
  });
  await test('merdiven/iskele/kapı hücresine dokunuş (kind none, hücre var) controller\'a gider; hücresiz -> dalga', async () => {
    const E = gestureEnv(); E.PX.camera._pick = () => ({ kind: 'none', cell: 33, el: -1, U: 0, V: 0, tri: 1 });
    E.fire('pointerdown', 1, 100, 300); E.fire('pointerup', 1, 100, 300, 40); eq(E.cmds('tap').map(c => c.cell), [33]);
    E.calls.length = 0; E.PX.camera._pick = () => ({ kind: 'none', cell: -1, el: -1, U: 0, V: 0, tri: 0 });
    let rip = 0; E.PX.fx.ripple = () => rip++;
    E.fire('pointerdown', 1, 100, 300); E.fire('pointerup', 1, 100, 300, 40); eq(E.calls.length, 0); eq(rip, 1);
  });
  await test('yedek seçim: camera.pick hata verirse sim2.ownerAt ile (worldToClient afininden) hücre bulunur', async () => {
    const E = makeEnv(); E.load('game/controller.js'); E.PX.game.init(); await E.PX.game.load('M1'); const L = E.PX.game.L;
    // basit ortografik izdüşüm (görünüm 0'a uygun): ekran = (A·20 + 200, B·20 + 200), A = sx·x − y, B = sz·z − y
    const v = E.PX.game.camView; const [sx, sz] = SIM.VIEWS[v];
    E.PX.camera.az = Math.PI / 4 + Math.PI / 2 * v; E.PX.camera.v = v;
    E.PX.camera.worldToClient = (x, y, z, out) => { out = out || {}; out.x = (sx * x - y) * 20 + 200; out.y = (sz * z - y) * 20 + 200; return out; };
    E.PX.camera.pick = () => { throw new Error('v3 kamera'); };
    E.load('input/gesture.js'); const Lc = {}; E.PX.gesture.init({ addEventListener(t, fn) { (Lc[t] = Lc[t] || []).push(fn); } });
    const c = L.tiles[5]; const [x, y, z] = L.G.xyz(c); const A = sx * x - y - 0.5 - 0.25, B = sz * z - y - 0.5 - 0.1;   // karonun üst yüzü içinde
    const ev = (type, px, py) => { for (const fn of (Lc[type] || [])) fn({ pointerId: 1, clientX: px, clientY: py, timeStamp: 1000, pointerType: 'touch', button: 0, target: { setPointerCapture() {} } }); };
    const px = A * 20 + 200, py = B * 20 + 200; const o = SIM.ownerAt(L, v, Math.floor(A), Math.floor(B), A - Math.floor(A) <= B - Math.floor(B) ? 1 : 0);
    E.clearEv(); ev('pointerdown', px, py); ev('pointerup', px, py);
    const acc = E.events('cmd:accepted').concat(E.events('cmd:rejected'));
    ok(o && acc.length >= 1, 'dokunuş controller\'a ulaştı (sahip ' + (o && o.c) + ')');
  });
  await test('üçüncü parmak / pointercancel: hiçbir komut yok, durum sıfırlanır', async () => {
    const E = gestureEnv(); E.fire('pointerdown', 1, 100, 100); E.fire('pointerdown', 2, 150, 100, 5); E.fire('pointerdown', 3, 200, 100, 5);
    E.fire('pointerup', 3, 200, 100, 5); E.fire('pointerup', 1, 100, 100, 5); E.fire('pointerup', 2, 150, 100, 5);
    eq(E.calls.length, 0); eq(E.PX.gesture.state(), 'idle');
    E.fire('pointerdown', 1, 100, 100); E.fire('pointermove', 1, 130, 100, 16); E.fire('pointercancel', 1, 130, 100, 16);
    eq(E.calls.length, 0); eq(E.PX.gesture.state(), 'idle');
    const E2 = gestureEnv(); E2.fire('pointerdown', 1, 100, 100); E2.fire('pointerdown', 2, 150, 100, 5);
    E2.fire('pointerup', 1, 100, 100, 5); E2.fire('pointerdown', 3, 200, 100, 5);
    E2.fire('pointerup', 2, 150, 100, 5); E2.fire('pointerup', 3, 200, 100, 5);
    eq(E2.calls.length, 0, 'ilk parmak kalktıktan sonra üçüncü parmak da yeni dokunuş sayılmaz');
  });
  await test('yataydan dikey tekerleğe geçiş kamerayı sürüklemede bırakmaz', async () => {
    const E = gestureEnv(); E.wheel(30, 0); ok(E.PX.camera.dragging, 'yatay kaydırma başladı');
    E.wheel(0, 100, 20); E.advance(400);
    eq(E.PX.camera.dragging, false, 'kamera serbest');
    eq(E.cmds('rot').filter(c => c.src === 'wheel').map(c => c.d), [1]);
    const n = E.camCalls.filter(c => c[0] === 'release').length;
    E.wheel(30, 0); E.advance(150);
    ok(E.camCalls.filter(c => c[0] === 'release').length > n, 'sonraki yatay kaydırma da biter');
  });
  await test('yatay tekerlekten parmak sürüklemeye geçişte eski zamanlayıcı yeni hareketi bitirmez', async () => {
    const E = gestureEnv(); E.wheel(30, 0);
    E.fire('pointerdown', 1, 250, 300, 20); E.fire('pointermove', 1, 220, 300, 20);
    const n = E.camCalls.filter(c => c[0] === 'release').length;
    E.advance(200);
    eq(E.PX.gesture.state(), 'drag'); eq(E.PX.camera.dragging, true);
    eq(E.camCalls.filter(c => c[0] === 'release').length, n, 'süren parmak sürüklemesi bırakılmadı');
    E.fire('pointerup', 1, 220, 300); eq(E.PX.camera.dragging, false);
  });
  await test('iki parmak son bırakma konumunda hareket ettiyse geri almaz', async () => {
    const E = gestureEnv(); E.fire('pointerdown', 1, 100, 300); E.fire('pointerdown', 2, 140, 300, 20);
    E.fire('pointerup', 1, 100, 300, 30); E.fire('pointerup', 2, 175, 300, 10);
    eq(E.cmds('undo').length, 0, 'pointermove gelmemiş olsa da son konum hareketi sayar');
  });
  await test('seviye değişimi eski tekerlek ve uzun basış zamanlayıcılarını iptal eder', async () => {
    const E = gestureEnv(); E.wheel(120, 0); E.PX.bus.emit('level:loaded', {}); E.advance(200);
    eq(E.cmds('rot').length, 0, 'eski kaydırma yeni seviyeyi döndürmedi'); eq(E.PX.camera.dragging, false);
    E.fire('pointerdown', 1, 50, 50); E.PX.bus.emit('level:loaded', {}); E.advance(500);
    eq(E.events('ui:longpress').length, 0, 'eski basış yeni seviyede kart açmadı');
    E.fire('pointerup', 1, 50, 50); eq(E.cmds('tap').length, 0); eq(E.PX.gesture.state(), 'idle');
  });

  // ------------------------------------------------------------ klavye
  function kbEnv() {
    const E = makeEnv(); E.load('game/controller.js'); E.PX.game.init(); E.load('input/keyboard.js'); E.PX.keyboard.init();
    const key = (k, o = {}) => { for (const fn of (E.winL.keydown || [])) fn(Object.assign({ key: k, code: '', target: { tagName: 'CANVAS' }, preventDefault() {}, repeat: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, o)); };
    return Object.assign(E, { key });
  }
  // bağımsız izdüşüm: kamera ileri = -(cosEL·cosaz, sinEL, cosEL·sinaz); sağ = ileri × dünyaYukarı; yukarı = sağ × ileri
  function screenDelta(az, a, b) {
    const EL = Math.atan(1 / Math.SQRT2); const f = [-Math.cos(EL) * Math.cos(az), -Math.sin(EL), -Math.cos(EL) * Math.sin(az)];
    const cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    let r = cr(f, [0, 1, 0]); const n = Math.hypot(...r); r = r.map(x => x / n); const u = cr(r, f);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return { x: d[0] * r[0] + d[1] * r[1] + d[2] * r[2], y: d[0] * u[0] + d[1] * u[1] + d[2] * u[2] };   // y yukarı
  }
  await test('klavye eşlemesi ekran yönlü -> fiziksel yön: her v4 seviyesi × 4 görünüm × her fiziksel bağ (merdiven/iskele dahil)', async () => {
    const E = kbEnv(); let n = 0, climbs = 0;
    const want = { ArrowUp: [1, 1], ArrowRight: [1, -1], ArrowDown: [-1, -1], ArrowLeft: [-1, 1] };   // [işaret x, işaret y(yukarı)]
    for (const lv of E.PX.LEVELS.filter(l => l.kuralSurumu === 4)) {
      await E.PX.game.load(lv.id); const L = E.PX.game.L;
      for (let v = 0; v < 4; v++) {
        const m = E.PX.keyboard.map(v); eq(new Set(Object.values(m)).size, 4, 'eşleme birebir');
        eq(new Set(Object.values(m).map(i => SIM.screenToDir(v, i))).size, 4, 'fiziksel yönler birebir');
        const az = Math.PI / 4 + Math.PI / 2 * v;
        for (let ti = 0; ti < L.tiles.length; ti++) { const c = L.tiles[ti];
          for (const k in m) { const d = SIM.screenToDir(v, m[k]); const e = L.adj[ti].find(x => x.d === d); if (!e) continue; n++;
            const A = L.G.xyz(c), B = L.G.xyz(L.tiles[e.to]); if (A[1] !== B[1]) climbs++;
            const dd = screenDelta(az, [A[0], 0, A[2]], [B[0], 0, B[2]]);                   // yatay yer değiştirme (merdivende yükseliş ayrı)
            ok(Math.sign(dd.x) === want[k][0] && Math.sign(dd.y) === want[k][1], `${lv.id} v${v} ${k}: ekran Δ=(${dd.x.toFixed(2)},${dd.y.toFixed(2)})`); } }
      }
    }
    ok(n > 100 && climbs > 0, 'kapsam: ' + n + ' bağ, ' + climbs + ' kat değişimi');
  });
  await test('tuşlar -> komutlar; otomatik tekrar tamponu doldurmaz; Ctrl+Z; metin alanı yok sayılır', async () => {
    const E = kbEnv(); await E.PX.game.load('M1'); const L = E.PX.game.L;
    const m = E.PX.keyboard.map(); const s = E.PX.game.state().s; const tgt = x => SIM.stepToward(L, s, SIM.screenToDir(E.PX.game.camView, m[x]));
    const k = Object.keys(m).find(x => tgt(x) >= 0); ok(k, 'yürünebilir ok yok');
    E.key(k); eq(E.PX.game.tokens(), 'g' + L.tileIdx[tgt(k)]);
    const kt = E.PX.keyboard.targets(); ok(Object.values(kt).some(c => c >= 0), 'imleç hedefleri');
    // basılı tutma: en çok bir bekleyen adım (zincir için), daha fazlası yok sayılır
    E.key(k, { repeat: true }); const h1 = E.PX.game.state().hist; ok(h1 <= 2, 'tekrar en çok bir adım ekler');
    if (E.PX.game.state().queue > 0) { E.key(k, { repeat: true }); E.key(k, { repeat: true }); eq(E.PX.game.state().hist, h1, 'bekleyen adım varken tekrar yok sayıldı'); }
    while (E.PX.game.state().hist > 1) E.PX.game.command({ t: 'undo' });
    E.key('z', { ctrlKey: true }); eq(E.PX.game.state().hist, 0);
    E.key('e', { target: { tagName: 'INPUT' } }); eq(E.PX.game.state().hist, 0);
    const v0 = E.PX.game.camView; E.key('E'); eq(E.PX.game.camView, (v0 + 1) & 3, 'E: kamera döner'); eq(E.PX.game.tokens(), '', 'döndürme deftere girmez');
    E.key('q'); eq(E.PX.game.camView, v0); E.key('p'); eq(E.PX.game.state().hist, 0, 'P tuşu yok');
    const t = E.PX.keyboard.targets(); eq(Object.keys(t).length, 4);
  });
  return res;
};
if (require.main === module) module.exports().then(r => { console.log(`${r.name}: ${r.pass} ok, ${r.fail} fail`); process.exit(r.fail ? 1 : 0); });
