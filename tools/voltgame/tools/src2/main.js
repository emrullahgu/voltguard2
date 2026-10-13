// ============================================================================
// main.js — PX.main : önyükleme sırası ve kare döngüsü                              sahip: Çekirdek (R1: Integrate)
// Önyükleme: store -> scene -> camera -> diorama/flow/volti -> ui (hud, sld, cards, screens, world) -> audio
//            -> input (gesture, keyboard) -> game -> debug API -> yönlendirme (?lvl=ID | ?daily | açılış).
// Modül yüklenirken: solverClient Worker'ı hemen kurar (betik açılışta ayrışır); hint/daily/ghost tembel init.
// Ekran akışı (R1): Açılış (Volti öz-testi) -> Devam et = sıradaki İş Emri kartı | Seviye Seç (düz harita) ->
//   İş Emri -> Diorama -> Kazanma paneli (Sonraki | Harita | Tekrar | hayalet | kod) ; Menü: ayarlar, kod yapıştır,
//   Günün Manevrası, El Kitabı. Meydan okuma bağlantısı #PX2-… ui/screens.js init'inde (yalnız http(s)).
// Kare: dt 100 ms'ye kırpılır; TW -> game -> volti -> camera -> diorama -> flow -> fx -> render; sonra onFrame kancaları.
// Kare CPU'su ve aralıkları önceden ayrılmış halkada (frameStats); açılıştan sonraki uzun görevler sayılır.
//   PX.main.boot()  PX.main.onFrame(fn(dt, now)) -> off   PX.main.frameStats(sonN?)  (son N kare; varsayılan 600)
// ============================================================================
const N = 600;
const ring = { cpu: new Float32Array(N), gap: new Float32Array(N), n: 0 };
const hooks = [];
let last = 0, booted = false, longTasks = 0, longMax = 0, bootT = 0;

function safe(name, fn) { try { fn(); return true; } catch (e) { console.error('[PX.main] ' + name + ' başlatılamadı:', e); return false; } }
function startupError(msg) {
  const d = document.createElement('div'); d.dataset.testid = 'startup-error';
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#e8f4ff;background:#0a1020;z-index:99';
  d.textContent = msg || (PX.STR && PX.STR.baslatilamadi) || 'Oyun başlatılamadı. Sayfayı yeniden açın.';
  document.body.appendChild(d);
}
function param(k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } }

function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now();
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  const gap = last ? now - last : 16.7; last = now;
  PX.TW.update(dt);
  if (PX.game.update) PX.game.update(dt);
  PX.volti.update(dt);
  PX.camera.update(dt);
  PX.diorama.update(dt);
  if (PX.flow.update) PX.flow.update(dt);
  PX.fx.update(dt);
  PX.scene.render();
  for (let i = 0; i < hooks.length; i++) { try { hooks[i](dt, now); } catch (e) { console.error('[PX.main] onFrame', e); } }
  const k = ring.n % N; ring.cpu[k] = performance.now() - t0; ring.gap[k] = gap; ring.n++;
}
function onFrame(fn) { hooks.push(fn); return () => { const i = hooks.indexOf(fn); if (i >= 0) hooks.splice(i, 1); }; }
function frameStats(last) {
  const n = Math.min(ring.n, N, last > 0 ? last : N); let sum = 0, max = 0, gsum = 0, gmax = 0; const a = [];
  for (let j = 0; j < n; j++) { const i = (ring.n - 1 - j + N * 2) % N; const c = ring.cpu[i], g = ring.gap[i]; sum += c; if (c > max) max = c; gsum += g; if (g > gmax) gmax = g; a.push(c); }
  a.sort((x, y) => x - y);
  const inf = PX.scene.info() || {};
  return { frames: ring.n, window: n, cpuAvg: n ? sum / n : 0, cpuMax: max, cpuP95: n ? a[Math.floor(0.95 * (n - 1))] : 0, gapAvg: n ? gsum / n : 0, gapMax: gmax,
    longTasks, longMax, drawCalls: inf.calls, triangles: inf.tris, geometries: inf.geometries, textures: inf.textures,
    heap: performance.memory ? performance.memory.usedJSHeapSize : null };
}
function boot() {
  if (booted) return; booted = true; bootT = performance.now();
  if (typeof THREE === 'undefined') {
    startupError((PX.STR && PX.STR.threeYok) || '3B grafik bileşeni yüklenemedi. Sayfayı yeniden açın.');
    console.error('[PX.main] THREE yok'); return;
  }
  const canvas = document.getElementById('game-canvas');
  safe('store', () => PX.store.init());
  if (!safe('scene', () => PX.scene.init(canvas)) ||
      !safe('camera', () => { PX.camera.init(); PX.camera.setViewport(PX.scene.w, PX.scene.h); }) ||
      !safe('diorama', () => PX.diorama.init()) ||
      !safe('flow', () => PX.flow.init && PX.flow.init()) ||
      !safe('volti', () => PX.volti.init())) { startupError(); return; }
  for (const m of ['hud', 'sld', 'cards', 'screens', 'world', 'audio']) safe(m, () => PX[m] && PX[m].init && PX[m].init());
  if (!safe('gesture', () => PX.gesture.init(canvas)) ||
      !safe('keyboard', () => PX.keyboard.init()) ||
      !safe('game', () => PX.game.init())) { startupError(); return; }
  safe('debug', () => PX.debug.install());
  if (window.PerformanceObserver) {
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.startTime > bootT + 2000) { longTasks++; if (e.duration > longMax) longMax = e.duration; } }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* desteklenmiyor */ }
  }
  requestAnimationFrame(frame);
  // yönlendirme
  const lvl = param('lvl'), daily = param('daily');
  let start = Promise.resolve();
  if (lvl && PX.LEVELS.some(l => l.id === lvl)) start = PX.screens.play(lvl);
  else if (lvl && /^\d+$/.test(lvl) && PX.LEVELS[+lvl - 1]) start = PX.screens.play(PX.LEVELS[+lvl - 1].id);
  else if (daily !== null && PX.daily && PX.daily.today(daily || undefined)) { PX.screens.show('game'); start = PX.game.load({ daily: daily || undefined }); }
  else PX.screens.show('title');
  // (meydan okuma bağlantısı #PX2-… ui/screens.js init'inde açılır: yalnız http(s) altında, §24.4)
  start.catch(e => console.error('[PX.main] seviye yüklenemedi', e)).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => {
    if (window.Game) window.Game.ready = true;
    PX.bus.emit('ready', {});
  });
}
PX.main = { boot, onFrame, frameStats };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
