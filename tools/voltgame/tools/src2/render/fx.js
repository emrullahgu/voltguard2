// ============================================================================
// render/fx.js — PX.TW (etiketli tween yöneticisi) + PX.EASE + PX.fx (FX kanalı)   sahip: Render
// §12.4: dt 100 ms'ye kırpılır (main.js); her FX bir etiket taşır; TW.cancel(tag) sonrası görsel durum
// mantıksal durumdan saf fonksiyonla yeniden kurulur (PX.render.sync). Global zaman ölçeği YOK.
// Havuzlu: kare başına ayırma yok (Promise yalnız add() anında, komut zamanında oluşur).
//   PX.TW.add(tag, durSec, fn(k, rawT), ease?, onDone?) -> Promise<{cancelled:bool}>
//        fn her karede eased k∈[0,1] ile çağrılır; bitince k=1 ile son kez. onDone(carry) senkron çağrılır.
//        dt devri (§12.4): biten tween'in artan süresi (carry) bir sonraki add()'e devredilir — ister
//        onDone içinde (aynı kare), ister Promise zincirinde (sonraki update'ten önce) eklensin.
//   PX.TW.cancel(tag) -> iptal edilen sayısı (fn tekrar çağrılmaz; Promise {cancelled:true} ile çözülür)
//   PX.TW.cancelAll()    PX.TW.active(tag?) -> bool    PX.TW.update(dt)    PX.TW.count()
// FX kanalı (ret geri bildirimi girişi ENGELLEMEZ; hiçbir FX girdi kilidi tutmaz):
//   PX.fx.ripple(clientX, clientY)         boş dokunuş halkası (§12.7, 24 px)
//   PX.fx.ring(x, y, z, kind)              karo üstünde halka (havuz; kind: 'hedef'|'eski' (değiştirilen hedef, 120 ms
//                                          söner)|'ret'|'kutlama'|'yuk')
//   PX.fx.burst(x, y, z, n, kind)          parçacık (havuz, toplamalı; FlashGuard: küçük alan)
//   PX.fx.init3d()                         havuzları sahneye ekler (diorama.init çağırır; açılışta derlenir)
//   PX.fx.update(dt)  PX.fx.cancelAll()   PX.fx.clear3d()
// Etiket kuralı: 'fx:*' etiketleri geri al / baştan ile iptal edilir (controller TW.cancelAll çağırır).
// ============================================================================
const EASE = {
  linear: k => k,
  inOutCubic: k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
  outCubic: k => 1 - Math.pow(1 - k, 3),
  inCubic: k => k * k * k,
  outQuint: k => 1 - Math.pow(1 - k, 5),
  inOutSine: k => -(Math.cos(Math.PI * k) - 1) / 2,
  outBack: k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  outQuad: k => 1 - (1 - k) * (1 - k),
  pulse: k => Math.sin(Math.PI * k),                       // 0 -> 1 -> 0
};
const POOL = 128;
function mkSlot() { return { on: false, rev: 0, skip: false, tag: '', t: 0, dur: 0, fn: null, ease: null, done: null, res: null }; }
const pool = []; for (let i = 0; i < POOL; i++) pool.push(mkSlot());
let carry = 0;            // onDone içinde (aynı update) eklenen tween'in başlangıç süresi
let pendingCarry = 0;     // son update'te biten tween'in artanı: update dışından (Promise zinciri) eklenene devredilir
const PC = new Float64Array(1);   // [update bitiş anı] — devir yalnız aynı görev içindeki Promise zincirine (≤ 4 ms) verilir
let nActive = 0; let updating = false;

function grab() {
  for (let i = 0; i < pool.length; i++) if (!pool[i].on) return pool[i];
  const o = mkSlot(); pool.push(o); return o;
}
function add(tag, dur, fn, ease, onDone) {
  const o = grab();
  o.rev++;
  let t0 = 0;
  if (updating) t0 = carry;
  else if (pendingCarry > 0) { if (now() - PC[0] < 4) t0 = pendingCarry; else pendingCarry = 0; }   // bayat devir başka girdiye geçmez
  o.on = true; o.skip = updating; o.tag = tag || ''; o.t = t0;
  o.dur = Math.max(1e-4, dur || 0); o.fn = fn || null; o.ease = ease || EASE.linear; o.done = onDone || null;
  nActive++;
  return new Promise(r => { o.res = r; });
}
function finish(o, cancelled) {
  o.on = false; nActive--;
  const r = o.res, d = o.done; o.fn = null; o.res = null; o.done = null; o.ease = null;
  if (!cancelled && d) { try { d(carry); } catch (e) { console.error('[PX.TW] onDone', e); } }
  if (r) r(cancelled ? CANCELLED : DONE);
}
const DONE = Object.freeze({ cancelled: false }), CANCELLED = Object.freeze({ cancelled: true });
function update(dt) {
  pendingCarry = 0;
  if (!nActive) return;
  updating = true;
  for (let i = 0; i < pool.length; i++) {
    const o = pool[i]; if (!o.on || o.skip) continue;     // skip: bu update içinde (onDone'dan) devirle eklendi
    o.t += dt; step(o);
  }
  // onDone zincirinden bu karede eklenenler: başlangıç süreleri = devir (artık dt); durumları AYNI karede çizilir
  // (zincir kare sınırında duraklamaz). Devir bir sonrakini de bitirebilir: zincir sınırlı derinlikte işlenir.
  for (let guard = 0; guard < 16; guard++) {
    let any = false;
    for (let i = 0; i < pool.length; i++) { const o = pool[i]; if (o.on && o.skip) { o.skip = false; any = true; step(o); } }
    if (!any) break;
  }
  updating = false;
  if (pendingCarry > 0) PC[0] = now();
}
function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function step(o) {
  const rev = o.rev;
  if (o.t >= o.dur - 1e-9) {
    carry = o.t > o.dur ? o.t - o.dur : 0; if (carry > pendingCarry) pendingCarry = carry;
    if (o.fn) callFn(o, 1);
    // fn geri al/iptal tetiklemiş ve bu havuz yuvası yeni tween'e geçmiş olabilir.
    if (o.on && o.rev === rev) finish(o, false);
    carry = 0;
  } else if (o.fn) callFn(o, o.t / o.dur);
}
function callFn(o, raw) {
  const rev = o.rev;
  try { o.fn(raw >= 1 ? 1 : o.ease(raw), raw); }
  catch (e) { console.error('[PX.TW] ' + o.tag, e); if (o.rev === rev) o.fn = null; }
}
function cancel(tag) {
  let n = 0;
  for (let i = 0; i < pool.length; i++) { const o = pool[i]; if (o.on && o.tag === tag) { finish(o, true); n++; } }
  return n;
}
function cancelAll() { for (let i = 0; i < pool.length; i++) if (pool[i].on) finish(pool[i], true); }
function active(tag) {
  if (tag === undefined) return nActive > 0;
  for (let i = 0; i < pool.length; i++) if (pool[i].on && pool[i].tag === tag) return true;
  return false;
}
PX.EASE = EASE;
PX.TW = { add, cancel, cancelAll, update, active, count: () => nActive };

// ---------------------------------------------------------------- FX kanalı: DOM dalga halkası (§12.7)
let rippleEl = null, rippleAnim = null;
function ripple(x, y) {
  if (!document.body) return;
  if (!rippleEl) {
    rippleEl = document.createElement('div'); rippleEl.className = 'px-ripple'; rippleEl.setAttribute('data-testid', 'ripple');
    rippleEl.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;margin:-12px 0 0 -12px;border:2px solid #9fd8ff;border-radius:50%;pointer-events:none;opacity:0;z-index:50;will-change:transform,opacity';
    document.body.appendChild(rippleEl);
  }
  rippleEl.style.left = x + 'px'; rippleEl.style.top = y + 'px';
  if (rippleEl.animate) {
    if (rippleAnim) rippleAnim.cancel();
    rippleAnim = rippleEl.animate([{ opacity: 0.9, transform: 'scale(0.6)' }, { opacity: 0, transform: 'scale(1.6)' }],
      { duration: reduced() ? 1 : 240, easing: 'ease-out' });
  }
}
function reduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }

// ---------------------------------------------------------------- 3B FX havuzları (halkalar + parçacıklar)
// Halka: tek InstancedMesh (12 yuva), örnek başına renk; kare başına yalnız etkin yuvaların matrisi yazılır.
const RING_N = 16, PART_N = 160;
const RING_KIND = { hedef: [0.50, 0.92, 1.00, 0.55, 0.99, 0.30], eski: [0.50, 0.92, 1.00, 0.95, 0.60, 0.12], ret: [1.00, 0.42, 0.30, 0.55, 0.88, 0.28],
  kutlama: [1.00, 0.85, 0.40, 0.55, 1.54, 0.90], yuk: [1.00, 0.80, 0.35, 0.55, 1.32, 0.70] };
//             r, g, b, başlangıç ölçeği, bitiş ölçeği, süre (s)
const F3 = { ready: false, rings: null, ringGeo: null, ringMat: null, rt: new Float32Array(RING_N), rd: new Float32Array(RING_N), rs: new Float32Array(RING_N), r0: new Float32Array(RING_N),
  rp: new Float32Array(RING_N * 3), rc: new Float32Array(RING_N * 3), rOn: 0, rNext: 0,
  pts: null, pGeo: null, pPos: null, pCol: null, pVel: new Float32Array(PART_N * 3), pLife: new Float32Array(PART_N), pTtl: new Float32Array(PART_N), pBase: new Float32Array(PART_N * 3),
  pNext: 0, pAlive: 0, m4: null, col: null };
function init3d() {
  if (F3.ready || typeof THREE === 'undefined' || !PX.scene || !PX.scene.scene) return;
  F3.m4 = new THREE.Matrix4(); F3.col = new THREE.Color();
  F3.ringGeo = new THREE.RingGeometry(0.36, 0.46, 40, 1); F3.ringGeo.rotateX(-Math.PI / 2); F3.ringGeo.userData.shared = true;
  F3.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  F3.ringMat.userData.shared = true;
  const rings = new THREE.InstancedMesh(F3.ringGeo, F3.ringMat, RING_N);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage); rings.frustumCulled = false; rings.renderOrder = 6; rings.name = 'fx-rings';
  F3.m4.makeScale(0, 0, 0); for (let i = 0; i < RING_N; i++) { rings.setMatrixAt(i, F3.m4); rings.setColorAt(i, F3.col.setRGB(0, 0, 0)); }
  rings.instanceColor.setUsage(THREE.DynamicDrawUsage);
  rings.count = RING_N; rings.visible = false; F3.rings = rings;
  // parçacıklar (v1 havuzu: tek Points, toplamalı, CPU güncellemeli)
  F3.pPos = new Float32Array(PART_N * 3); F3.pCol = new Float32Array(PART_N * 3);
  for (let i = 0; i < PART_N; i++) F3.pPos[i * 3 + 1] = -999;
  F3.pGeo = new THREE.BufferGeometry();
  F3.pGeo.setAttribute('position', new THREE.BufferAttribute(F3.pPos, 3).setUsage(THREE.DynamicDrawUsage));
  F3.pGeo.setAttribute('color', new THREE.BufferAttribute(F3.pCol, 3).setUsage(THREE.DynamicDrawUsage));
  F3.pGeo.userData.shared = true;
  const dot = dotTexture();
  const pm = new THREE.PointsMaterial({ size: 9, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, toneMapped: false });
  pm.userData.shared = true;
  F3.pts = new THREE.Points(F3.pGeo, pm); F3.pts.frustumCulled = false; F3.pts.renderOrder = 7; F3.pts.visible = false; F3.pts.name = 'fx-particles';
  PX.scene.scene.add(F3.rings); PX.scene.scene.add(F3.pts);
  F3.ready = true;
}
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); t.userData = { shared: true }; return t;
}
function ring(x, y, z, kind) {
  if (!F3.ready) init3d(); if (!F3.ready) return;
  const K = RING_KIND[kind] || RING_KIND.hedef;
  const i = F3.rNext; F3.rNext = (F3.rNext + 1) % RING_N;
  if (F3.rd[i] <= 0) F3.rOn++;
  F3.rt[i] = 0; F3.rd[i] = reduced() ? 0.12 : K[5]; F3.r0[i] = K[3]; F3.rs[i] = K[4];
  F3.rp[i * 3] = x; F3.rp[i * 3 + 1] = y + 0.02; F3.rp[i * 3 + 2] = z;
  F3.rc[i * 3] = K[0]; F3.rc[i * 3 + 1] = K[1]; F3.rc[i * 3 + 2] = K[2];
  F3.rings.visible = true;
}
const BURST = { kutlama: [1.0, 0.85, 0.45], pof: [0.95, 0.55, 0.35], kivilcim: [0.6, 0.95, 1.0] };
function burst(x, y, z, n, kind) {
  if (!F3.ready) init3d(); if (!F3.ready || reduced()) return;
  const c = BURST[kind] || BURST.kutlama; n = Math.min(n | 0, 24);
  for (let k = 0; k < n; k++) {
    const i = F3.pNext; F3.pNext = (F3.pNext + 1) % PART_N;
    const a = (k / n) * Math.PI * 2 + Math.random() * 0.6, s = 0.6 + Math.random() * 0.7;
    F3.pPos[i * 3] = x; F3.pPos[i * 3 + 1] = y; F3.pPos[i * 3 + 2] = z;
    F3.pVel[i * 3] = Math.cos(a) * s; F3.pVel[i * 3 + 1] = 1.2 + Math.random() * 0.8; F3.pVel[i * 3 + 2] = Math.sin(a) * s;
    F3.pBase[i * 3] = c[0]; F3.pBase[i * 3 + 1] = c[1]; F3.pBase[i * 3 + 2] = c[2];
    F3.pTtl[i] = F3.pLife[i] = 0.55 + Math.random() * 0.3;
  }
  F3.pts.visible = true;
}
function update3d(dt) {
  if (!F3.ready) return;
  if (F3.rOn > 0) {
    const R = F3.rings, m = F3.m4, col = F3.col;
    for (let i = 0; i < RING_N; i++) {
      if (F3.rd[i] <= 0) continue;
      F3.rt[i] += dt; const k = F3.rt[i] / F3.rd[i];
      if (k >= 1) { F3.rd[i] = 0; F3.rOn--; m.makeScale(0, 0, 0); R.setMatrixAt(i, m); continue; }
      const sc = F3.r0[i] + (F3.rs[i] - F3.r0[i]) * (1 - (1 - k) * (1 - k));
      m.makeScale(sc, 1, sc); m.elements[12] = F3.rp[i * 3]; m.elements[13] = F3.rp[i * 3 + 1]; m.elements[14] = F3.rp[i * 3 + 2];
      R.setMatrixAt(i, m);
      const f = 1 - k; R.setColorAt(i, col.setRGB(F3.rc[i * 3] * f, F3.rc[i * 3 + 1] * f, F3.rc[i * 3 + 2] * f));
    }
    R.instanceMatrix.needsUpdate = true; R.instanceColor.needsUpdate = true;
    if (F3.rOn <= 0) { F3.rOn = 0; R.visible = false; }
  }
  if (F3.pts.visible) {
    let alive = 0; const P = F3.pPos, C = F3.pCol, V = F3.pVel;
    for (let i = 0; i < PART_N; i++) {
      if (F3.pLife[i] <= 0) continue;
      F3.pLife[i] -= dt;
      if (F3.pLife[i] <= 0) { C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = 0; P[i * 3 + 1] = -999; continue; }
      alive++;
      V[i * 3 + 1] -= 4 * dt;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      const f = F3.pLife[i] / F3.pTtl[i];
      C[i * 3] = F3.pBase[i * 3] * f; C[i * 3 + 1] = F3.pBase[i * 3 + 1] * f; C[i * 3 + 2] = F3.pBase[i * 3 + 2] * f;
    }
    F3.pGeo.attributes.position.needsUpdate = true; F3.pGeo.attributes.color.needsUpdate = true;
    if (!alive) F3.pts.visible = false;
  }
}
function clear3d() {
  if (!F3.ready) return;
  for (let i = 0; i < RING_N; i++) { F3.rd[i] = 0; F3.m4.makeScale(0, 0, 0); F3.rings.setMatrixAt(i, F3.m4); }
  F3.rOn = 0; F3.rings.visible = false; F3.rings.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < PART_N; i++) { F3.pLife[i] = 0; F3.pPos[i * 3 + 1] = -999; F3.pCol[i * 3] = F3.pCol[i * 3 + 1] = F3.pCol[i * 3 + 2] = 0; }
  F3.pts.visible = false; F3.pGeo.attributes.position.needsUpdate = true; F3.pGeo.attributes.color.needsUpdate = true;
}
PX.fx = {
  ripple, ring, burst, init3d, clear3d, reduced,
  update(dt) { update3d(dt); },
  cancelAll() { cancelAll(); clear3d(); },
  get busy() { return F3.rOn > 0 || (F3.pts && F3.pts.visible); },
};
