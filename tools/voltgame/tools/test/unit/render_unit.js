'use strict';
// ============================================================================
// tools/test/unit/render_unit.js — render ekibinin birim testleri (Node, tarayıcısız):
//   node tools/test/unit/render_unit.js
// render/fx.js  : PX.TW (etiketli iptal, dt devri — onDone ve Promise zinciri, k=1 son çağrı, havuz yeniden
//                 kullanımı), PX.EASE uçları
// render/camera.js: analitik kritik sönümlü yay (90° düğme döndürmesi 0,5° içine 260–300 ms hedef bandında,
//                 kare hızından bağımsız), zincirde hız sürekliliği, sürükleme devri (sıçrama yok), preBanded
//                 sürükleme, lastik bant (19°·tanh), bırakma, iki kademeli zoom
// Modüller build'deki gibi (function(PX){'use strict'; …})(PX) sarmalıyla vm içinde yüklenir. THREE yalnız
// kameranın kullandığı kadar taklit edilir (gerçek seçim/çizim tarayıcı paketlerinde: parity, flow).
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC2 = path.join(ROOT, 'tools', 'src2');
const SIM = require(path.join(ROOT, 'tools', 'reference2', 'sim2.js'));

let pass = 0, fail = 0;
let clock = 0;                      // sahte performance.now (ms)
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

function load(ctx, rel) {
  const src = fs.readFileSync(path.join(SRC2, rel), 'utf8');
  vm.runInContext("(function (PX) { 'use strict';\n" + src + '\n})(PX);', ctx, { filename: rel });
}
// --- minimal THREE taklidi (kamera)
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  unproject() { return this; } project() { return this; }
}
class OrthoCam {
  constructor(l, r, t, b) { this.left = l; this.right = r; this.top = t; this.bottom = b; this.position = new V3(); this.up = new V3(0, 1, 0); this.dir = new V3(0, -1, 0); }
  updateProjectionMatrix() {} updateMatrixWorld() {}
  lookAt(t) { const d = [t.x - this.position.x, t.y - this.position.y, t.z - this.position.z]; const l = Math.hypot(...d); this.dir.set(d[0] / l, d[1] / l, d[2] / l); }
  getWorldDirection(o) { return o.copy(this.dir); }
}
function env(extra) {
  const PX = Object.assign({ SIM }, extra || {});
  const ctx = vm.createContext({ PX, console, Promise, Math, Object, Array, Map, Set, Float32Array, Float64Array, Int16Array, Int32Array, Uint8Array,
    THREE: { OrthographicCamera: OrthoCam, Vector3: V3 }, window: {}, document: undefined, performance: { now: () => clock } });
  return { PX, ctx };
}
const tick = () => new Promise(r => setImmediate(r));

async function testTW() {
  const { PX, ctx } = env(); load(ctx, 'render/fx.js');
  const TW = PX.TW;
  // 1) temel: k artar, bitişte k=1 ile son çağrı, onDone, Promise {cancelled:false}
  let ks = [], done = 0;
  const p = TW.add('a', 0.1, k => ks.push(k), null, () => done++);
  TW.update(0.04); TW.update(0.04); TW.update(0.04);
  const r = await p;
  ok(ks.length === 3 && near(ks[0], 0.4, 1e-9) && near(ks[1], 0.8, 1e-9) && ks[2] === 1, 'TW k sequence ' + ks);
  ok(done === 1 && r.cancelled === false, 'TW onDone + resolve');
  ok(!TW.active() && TW.count() === 0, 'TW inactive after finish');
  clock += 100;                     // yeni görev: önceki karenin artanı bayatlar (stale carry yok)
  // 2) dt devri onDone içinde: A 0,1 s; update(0,15) => B (0,1 s) 0,05 ile başlar, aynı karede k=0,5
  let bk = [];
  TW.add('chain', 0.1, null, null, () => { TW.add('chain', 0.1, k => bk.push(k)); });
  TW.update(0.15);
  ok(bk.length === 1 && near(bk[0], 0.5, 1e-9), 'TW carry in onDone (same frame k=0.5): ' + bk);
  TW.update(0.05);
  ok(bk.length === 2 && bk[1] === 1 && !TW.active('chain'), 'TW carried tween finishes after remaining 0.05');
  clock += 100;
  // 3) dt devri Promise zinciri: A biter (0,03 artan), .then'de eklenen B bir sonraki update'te +0,03 ile başlar
  let ck = [];
  TW.add('pz', 0.1).then(() => TW.add('pz', 0.1, k => ck.push(k)));
  TW.update(0.13); await tick(); await tick();
  TW.update(0.02);
  ok(ck.length === 1 && near(ck[0], 0.5, 1e-6), 'TW carry through Promise chain (0.03+0.02): ' + ck);
  TW.update(0.1);
  // 3b) bayat devir başka bir girdiye geçmez: biten tween'den 50 ms sonra eklenen tween 0'dan başlar
  let sk = []; TW.add('st', 0.1); TW.update(0.13); clock += 50; TW.add('st2', 0.1, k => sk.push(k)); TW.update(0.02);
  ok(sk.length === 1 && near(sk[0], 0.2, 1e-6), 'TW stale carry not applied to later input: ' + sk);
  TW.cancelAll(); clock += 100;
  // 4) iptal: fn bir daha çağrılmaz, Promise cancelled:true, onDone çağrılmaz, başka etiket etkilenmez
  let n1 = 0, n2 = 0, od = 0;
  const pc = TW.add('fx:x', 1, () => n1++, null, () => od++); TW.add('keep', 1, () => n2++);
  TW.update(0.1); const c = TW.cancel('fx:x'); TW.update(0.1);
  const rc = await pc;
  ok(c === 1 && n1 === 1 && od === 0 && rc.cancelled === true, 'TW cancel(tag)');
  ok(n2 === 2 && TW.active('keep'), 'TW cancel leaves other tags');
  TW.cancelAll(); ok(!TW.active(), 'TW cancelAll');
  // Bir callback aynı tween'i iptal edip boşalan havuz yuvasını yeni tween için kullanabilir.
  let replacement = null, rk = [];
  const swapped = TW.add('swap', 0.1, () => {
    TW.cancel('swap'); replacement = TW.add('replacement', 0.1, k => rk.push(k));
  });
  TW.update(0.1);
  const swappedResult = await swapped;
  ok(swappedResult.cancelled && TW.count() === 1 && TW.active('replacement'), 'TW callback cancel + slot reuse preserves replacement');
  TW.update(0.05);
  ok(rk.length === 2 && rk[0] === 0 && near(rk[1], 0.5, 1e-6), 'TW replacement starts independently: ' + rk);
  TW.update(0.05); if (TW.active('replacement')) TW.cancelAll();
  void replacement;
  // 5) havuz: 500 eşzamanlı tween, sonra hepsi biter; havuz yeniden kullanılır (count 0)
  for (let i = 0; i < 500; i++) TW.add('m', 0.01 * (1 + (i % 5)));
  ok(TW.count() === 500, 'TW pool grows');
  for (let i = 0; i < 10; i++) TW.update(0.01);
  ok(TW.count() === 0, 'TW all finished');
  // 6) hata yalıtımı: fn atarsa diğer tween'ler sürer
  let good = 0; const oe = console.error; console.error = () => {};
  TW.add('bad', 0.1, () => { throw new Error('x'); }); TW.add('good', 0.1, () => good++);
  TW.update(0.05); TW.update(0.05); console.error = oe;
  ok(good === 2 && !TW.active(), 'TW throwing fn isolated');
  // 7) EASE uçları
  for (const k of Object.keys(PX.EASE)) { if (k === 'pulse') continue; const e = PX.EASE[k]; ok(near(e(0), 0, 1e-9) && near(e(1), 1, 1e-9), 'EASE ' + k + ' endpoints'); }
}

function camEnv() {
  const fakeL = { G: { N: 27, W: 3, H: 3, D: 3, kind: new Uint8Array(27).fill(1) }, standOk: () => true };
  const st = { s: { p: 0, v: 0 } };
  const { PX, ctx } = env({ scene: { rect: { left: 0, top: 0, width: 375, height: 667 } }, game: { state: () => st }, flow: null, fx: { reduced: () => false } });
  load(ctx, 'render/camera.js');
  const C = PX.camera; C.init(); C.setViewport(375, 667); C.setLevel(fakeL, { v: 0 });
  return { C, fakeL, st };
}
const DEG = Math.PI / 180;
async function testCamera() {
  // 1) 90° düğme döndürmesi, farklı kare hızlarında aynı süre (analitik yay)
  for (const fps of [60, 30, 120]) {
    const { C } = camEnv(); const dt = 1 / fps;
    const goal = C.azOf(1); let t = 0, tIn = -1, resolved = -1; let maxOver = 0;
    C.snapTo(1).then(() => { resolved = t; });
    for (let i = 0; i < fps; i++) {
      C.update(dt); t += dt; await tick();
      const err = Math.abs(C.az - goal); if (tIn < 0 && err <= 0.5 * DEG) tIn = t;
      if ((C.az - goal) * Math.sign(C.azOf(0) - goal) < 0) maxOver = Math.max(maxOver, Math.abs(C.az - goal));
    }
    // kritik sönüm: aşma yok; 0,5° içine giriş 260–300 ms bandında (± bir kare)
    ok(tIn >= 0.25 - dt && tIn <= 0.30 + dt, `camera 90° within 0.5° at ${fps} fps: ${(tIn * 1000).toFixed(0)} ms`);
    ok(maxOver < 1e-6, `camera no overshoot at ${fps} fps`);
    ok(resolved > 0 && resolved <= tIn + dt, `camera snapTo resolves by settle (${(resolved * 1000).toFixed(0)} ms)`);
    ok(!C.busy(), 'camera idle after 1 s');
  }
  // 2) zincirlenmiş döndürme: ikinci snapTo o anki hızı devralır (hız sürekli; açı sıçramaz)
  {
    const { C } = camEnv(); const dt = 1 / 60;
    C.snapTo(1); for (let i = 0; i < 6; i++) C.update(dt);
    const az0 = C.az, vel0 = C.azVel;
    C.snapTo(2);
    ok(C.az === az0 && C.azVel === vel0, 'camera chained snapTo keeps angle and velocity');
    C.update(dt); const step = Math.abs(C.az - az0);
    // hız sürekli (ivme sıçrayabilir): ilk adım ≈ v0·dt + ½·a·dt², a ≤ ω²·|x0| + 2ω·|v0|
    const x0 = Math.abs(az0 - C.azOf(2)), amax = C.OMEGA * C.OMEGA * x0 + 2 * C.OMEGA * Math.abs(vel0);
    ok(step <= Math.abs(vel0) * dt + 0.5 * amax * dt * dt + 1e-9, 'camera chained first step continuous (' + (step / DEG).toFixed(2) + '°)');
    for (let i = 0; i < 90; i++) C.update(dt);
    ok(near(C.az, C.azOf(2), 1e-6) && C.azVel === 0, 'camera chained settles on v2');
  }
  // 3) sürükleme yakalama: yay sürerken ilk drag o anki açıdan devralır (sıçrama yok); preBanded bant uygulamaz
  {
    const { C } = camEnv(); const dt = 1 / 60;
    C.snapTo(1); for (let i = 0; i < 5; i++) C.update(dt);
    const az = C.az; C.grab(); C.update(dt); const azNow = C.az;
    C.drag(10, true);
    ok(near(C.az, azNow, 1e-9), 'camera drag takeover without jump');
    C.drag(10 + C.dragScale() * 2, true);
    ok(near(C.az, azNow - Math.PI, 1e-9), 'camera preBanded drag is linear (2 steps = 180°)');
    C.release(0); C.snapTo(1);
    for (let i = 0; i < 120; i++) C.update(dt);
    ok(near(C.az, C.nearAz(1, C.az), 1e-6), 'camera release + snapTo settles'); void az;
  }
  // 4) kural sürümü 4: döndürme yalnız görsel ve hep serbest; iç lastik bant yalnız tek sürüklemede ±2 adımın (180°)
  //    ötesinde, en çok 19°; bırakınca 2 adıma (180°) oturur
  {
    const { C, fakeL } = camEnv(); delete fakeL.standOk;
    const az0 = C.az; C.grab(); C.drag(0); C.drag(-C.dragScale() * 3);
    const dev = Math.abs(C.az - az0) / DEG;
    ok(dev > 198 && dev <= 199 + 1e-9, 'camera rubber band beyond ±180° ≤ 19° (' + dev.toFixed(2) + '°)');
    const q = C.release(0); ok(q === 2, 'camera rubber release q=2 (' + q + ')');
    for (let i = 0; i < 60; i++) C.update(1 / 60);
    ok(near(C.az, az0 + Math.PI, 1e-6), 'camera rubber settles on 180°');
    const { C: C2, fakeL: f2 } = camEnv(); f2.standOk = () => false;     // eski görünürlük kapısı artık etkisiz
    C2.grab(); C2.drag(0); C2.drag(-C2.dragScale()); ok(C2.release(0) === 1, 'camera rotation never gated by standing visibility');
  }
  // 5) fırlatma: kısa sürükleme + yüksek hız => bir adım
  {
    const { C } = camEnv();
    C.grab(); C.drag(0); C.drag(-40);
    const q = C.release(-1.2);       // parmak sola => az artar => d+
    ok(q === 1, 'camera fling one step (q=' + q + ')');
  }
  // 6) zoom: iki kademe, 200 ms, geri dönüşte merkez + ölçek 1
  {
    const { C } = camEnv(); const cx = C.target.x, cz = C.target.z;
    C.setZoom(1, { x: 187, y: 333 });
    for (let i = 0; i < 15; i++) C.update(1 / 60);
    ok(near(C.zoom, 1.65, 1e-9), 'camera zoom in reaches 1.65');
    C.setZoom(0);
    for (let i = 0; i < 15; i++) C.update(1 / 60);
    ok(near(C.zoom, 1, 1e-9) && near(C.target.x, cx, 1e-9) && near(C.target.z, cz, 1e-9), 'camera zoom out restores frame');
  }
}

(async () => {
  console.log('render/fx.js — TW'); await testTW();
  console.log('render/camera.js'); await testCamera();
  console.log(`render unit: ${pass} ok, ${fail} fail`);
  console.log(fail ? 'RENDER UNIT: FAIL' : 'RENDER UNIT: ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
