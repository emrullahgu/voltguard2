// ============================================================================
// render/scene.js — PX.scene (renderer, sahne, ışık, kalite katmanları) + PX.render cephesi (§18.2)   sahip: Render
// Dünya koordinatı = hücre koordinatı: küp (x,y,z) merkezi dünya (x,y,z)'de, birim küp; karo üstü y+0.5.
// TEK render geçişi (v1'in Volti-üstte ikinci geçişi ve clearDepth YOK). setSize yalnız boyut değişince
// (ResizeObserver 100 ms debounce); getBoundingClientRect yalnız yeniden boyutta (S.rect önbelleği).
// Kalite katmanları (§14.3): dusuk (telefon varsayılanı: PR ≤ 1, gölge yok) / orta (PR ≤ 1,5, 1024² PCF) /
//   yuksek (PR ≤ 2, 2048² yumuşak PCF). Otomatik katman: seviye yüklendikten sonra 60 karelik rAF aralığı
//   ölçümü; ort. > 20 ms ⇒ bir katman düşür; ≤ 17,5 ms ve CPU < 4 ms üç seviye boyunca ⇒ bir katman yükselt
//   (telefonda en çok orta). Değişim YALNIZ seviyeler arasında (setLevel). ?kalite=dusuk|orta|yuksek zorlar.
// Kare başına ayırma: three r128 render() kendi içinde (ısınmadan sonra) yalnız iki yerde ayırır: render listesi
// sıralaması (Array.prototype.sort her çağrıda geçici dizi ayırır) ve frustum düzlemleri. sortObjects = false ve nesne
// başına frustumCulled = false ile ikisi de kapanır/azalır; çizim sırası sahne ağacı sırasıdır.
//   PX.scene.init(canvas)  .resize(force?)  .render()  .info() -> {calls,tris,geometries,textures,programs,tier}
//   PX.scene.renderer / .scene / .root (seviye grubu) / .canvas / .rect / .w / .h / .tier / .setTier(t)
//   PX.scene.BIOME[ad] palet tablosu   PX.scene.biome (geçerli)   PX.scene.col(hex) -> Color (sRGB→doğrusal)
//   PX.scene.compile()   açılışta/seviye kurulunca program derlemesi (ilk etkileşimde takılma yok, §17 F10)
//   PX.scene.prewarm() -> Promise<bool>   açılış/harita ekranında "Başla" seviyesini boşta dilimlerle derler (kendiliğinden)
//   PX.render.setLevel(L, s)      seviye kur (kamera + diorama + akış + Volti) ve doğuş
//   PX.render.sync(s, E?)         SAF yeniden kurulum: görsel durum = mantıksal durum (geri al / baştan / iptal sonrası)
//   PX.render.animate(step) -> Promise<{cancelled}>   step = controller adımı (README "Adım"). Yürüyüş: step.steps
//                                 (sim2.walkPath adımları: karo / merdiven / iskele) ya da step.path (karo hücreleri)
//                                 Volti'ye gider; kat değişimi yalnız merdiven/iskeleden (kural sürümü 4).
//   PX.render.instant = true      animasyonsuz (Game.replay hızlı modu): animate senkron sync yapar
// ============================================================================
const TIERS = {
  dusuk: { pr: 1.0, shadow: 0, soft: false },
  orta: { pr: 1.5, shadow: 1024, soft: false },
  yuksek: { pr: 2.0, shadow: 2048, soft: true },
};
const ORDER = ['dusuk', 'orta', 'yuksek'];
// Biyom paletleri (sRGB hex). gece -> sıcak: çözüm ilerledikçe (beslenen yük oranı) ışık sıcaklığı geri gelir.
const BIOME = {
  'Depo': { bg: [0x0a1428, 0x141a28], sky: [0x8fb4ff, 0xe6ecf6], gnd: [0x18223a, 0x23252e], dir: [0x9cc0ff, 0xffe2bc], top: 0x5d6f93, side: 0x3e4b68, tile2: 0x566789, glow: 0x3d6bd6, work: 0xe0902e },
  'Volt Mahallesi': { bg: [0x0b1330, 0x161a2e], sky: [0x7d92d8, 0xe4e8f4], gnd: [0x161c34, 0x22232e], dir: [0x8ea6ff, 0xffd6a0], top: 0x5c6386, side: 0x3b3f5c, tile2: 0x555c7e, glow: 0x5b5fd0, work: 0xe8962e },
  'Trafo Merkezi': { bg: [0x111824, 0x1a1c22], sky: [0xa9b6c8, 0xeceef2], gnd: [0x1e2228, 0x272726], dir: [0xc6d2e6, 0xffe0b8], top: 0x7a7f88, side: 0x50545c, tile2: 0x72777f, glow: 0xb07a46, work: 0xe0902e },
  'Fabrika': { bg: [0x131622, 0x1c1c1e], sky: [0xb8bfd0, 0xeef0f2], gnd: [0x1c1e26, 0x29271f], dir: [0xd0d6e6, 0xffdca8], top: 0x6e7684, side: 0x474d58, tile2: 0x687080, glow: 0xd0a030, work: 0xf0b030 },
};
const S = {
  renderer: null, scene: null, root: null, canvas: null, rect: { left: 0, top: 0, width: 1, height: 1 }, w: 0, h: 0, pr: 1,
  tier: 'dusuk', forced: false, pendingTier: null, hemi: null, dir: null, glow: null, biome: BIOME['Depo'], biomeName: 'Depo', warm: 0,
  shadowDirty: true, shadowHold: 0, meas: { n: 0, sum: 0, cpu: 0, skip: 0, on: false }, goodLevels: 0, BIOME,
};
let cA = null, cB = null, cTmp = null;
const col = hex => new THREE.Color(hex).convertSRGBToLinear();
function isPhone() {
  try { return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent); } catch (e) { return false; }
}
function param(k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } }
function initialTier() {
  const p = param('kalite'); if (p && TIERS[p]) { S.forced = true; return p; }
  let saved = null; try { saved = PX.store && PX.store.get ? PX.store.get('ayar.kalite') : null; } catch (e) { saved = null; }
  if (saved && TIERS[saved]) { S.forced = true; return saved; }
  return isPhone() ? 'dusuk' : 'orta';
}
function init(canvas) {
  S.canvas = canvas;
  S.tier = initialTier();
  const r = new THREE.WebGLRenderer({ canvas, antialias: S.tier !== 'dusuk', powerPreference: 'high-performance', alpha: false, stencil: false });
  r.outputEncoding = THREE.sRGBEncoding;
  r.shadowMap.autoUpdate = false;
  r.info.autoReset = true;
  // Ayırmasız kare: render listesi sıralaması (Array.prototype.sort her çağrıda ayırır) kapalı; çizim sırası sahne
  // ağacı sırasıdır (opaklar derinlik tamponuyla doğru; saydamlar: zemin parıltısı -> çıkartmalar -> akış -> vurgu -> FX).
  r.sortObjects = false;
  S.renderer = r;
  cA = new THREE.Color(); cB = new THREE.Color(); cTmp = new THREE.Color();
  S.scene = new THREE.Scene();
  S.scene.autoUpdate = true;
  S.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x1a2236, 0.95); S.scene.add(S.hemi);
  S.dir = new THREE.DirectionalLight(0xffffff, 0.8); S.dir.position.set(6, 12, 4); S.scene.add(S.dir); S.scene.add(S.dir.target);
  S.dir.shadow.bias = -0.0008; S.dir.shadow.normalBias = 0.02;
  // "yüzen diorama" zemin parıltısı: tek düzlem, radyal doku
  const gc = document.createElement('canvas'); gc.width = gc.height = 128; const g = gc.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const gt = new THREE.CanvasTexture(gc); gt.userData = { shared: true };
  const gm = new THREE.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false, color: 0x3d6bd6, toneMapped: false });
  gm.userData.shared = true;
  const gg = new THREE.PlaneGeometry(1, 1); gg.rotateX(-Math.PI / 2); gg.userData.shared = true;
  S.glow = new THREE.Mesh(gg, gm); S.glow.renderOrder = -1; S.glow.name = 'glow'; S.glow.matrixAutoUpdate = false; S.scene.add(S.glow);
  S.root = new THREE.Group(); S.root.name = 'level'; S.scene.add(S.root);
  applyTierRenderer();
  setBiome('Depo', 0);
  resize(true);
  const ro = window.ResizeObserver ? new ResizeObserver(() => resizeSoon()) : null;
  if (ro) ro.observe(canvas.parentElement || canvas);
  window.addEventListener('resize', resizeSoon);
  window.addEventListener('orientationchange', resizeSoon);
  if (PX.bus) {
    PX.bus.on('elec:changed', p => onElec(p));
    PX.bus.on('win', () => celebrate());
    // açılış/harita ekranı: "Başla" seviyesinin programlarını boşta, dilimlerle derle (yalnız seviye kurulmamışken)
    PX.bus.on('screen', p => { if (p && (p.name === 'title' || p.name === 'levels') && !R.L && !S.warmed) prewarm(); });
  }
}
let rzTimer = 0;
function resizeSoon() { clearTimeout(rzTimer); rzTimer = setTimeout(() => resize(false), 100); }
function resize(force) {
  if (!S.renderer) return;
  const el = S.canvas.parentElement || S.canvas;
  const b = el.getBoundingClientRect();
  const w = Math.max(1, Math.round(b.width)), h = Math.max(1, Math.round(b.height));
  const pr = Math.min(window.devicePixelRatio || 1, TIERS[S.tier].pr, Math.sqrt((isPhone() ? 1200000 : 2400000) / (w * h)));
  const cb = S.canvas.getBoundingClientRect();
  S.rect.left = cb.left; S.rect.top = cb.top; S.rect.width = cb.width || w; S.rect.height = cb.height || h;
  if (!force && w === S.w && h === S.h && pr === S.pr) return;
  S.w = w; S.h = h; S.pr = pr;
  S.renderer.setPixelRatio(pr); S.renderer.setSize(w, h, false);
  const cb2 = S.canvas.getBoundingClientRect();
  S.rect.left = cb2.left; S.rect.top = cb2.top; S.rect.width = cb2.width || w; S.rect.height = cb2.height || h;
  if (PX.camera && PX.camera.setViewport) PX.camera.setViewport(w, h);
  if (PX.flow && PX.flow.setResolution) PX.flow.setResolution(w, h);
}
function applyTierRenderer() {
  const T = TIERS[S.tier], r = S.renderer;
  const want = T.shadow > 0;
  r.shadowMap.enabled = want;
  r.shadowMap.type = T.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  S.dir.castShadow = want;
  if (want) {
    if (S.dir.shadow.map && S.dir.shadow.mapSize.x !== T.shadow) { S.dir.shadow.map.dispose(); S.dir.shadow.map = null; }
    S.dir.shadow.mapSize.set(T.shadow, T.shadow);
  }
  // malzemelerin program anahtarı gölgeye bağlı: yeniden derle (yalnız seviyeler arasında çağrılır)
  S.scene.traverse(n => { const m = n.material; if (!m) return; if (Array.isArray(m)) m.forEach(x => { x.needsUpdate = true; }); else m.needsUpdate = true; });
  applyShadowFlags();
  S.shadowDirty = true;
}
function applyShadowFlags() {
  const on = TIERS[S.tier].shadow > 0;
  S.scene.traverse(n => {
    // diorama kamera tarafından her zaman tam çerçevelenir: nesne başına frustum testi (ve ayırması) gereksiz
    if (n.isMesh || n.isPoints || n.isLine) n.frustumCulled = false;
    if (!n.isMesh || (n.userData && n.userData.noShadow)) return;
    const tr = n.material && (Array.isArray(n.material) ? n.material[0] : n.material);
    if (tr && (tr.transparent || tr.isShaderMaterial || tr.isMeshBasicMaterial)) { n.castShadow = false; n.receiveShadow = false; return; }
    // Volti gölge haritasına düşmez: zemine basışı kendi blob gölgesi gösterir (volti-shadow). Böylece Volti yürürken
    // gölge haritası her kare yeniden çizilmez (yürüyüşte ikinci çizim geçişi yok; 4× CPU'da uzun görevlerin nedeni)
    if (n.name === 'volti-body' || n.name === 'volti-glow') { n.castShadow = false; n.receiveShadow = on; return; }
    n.castShadow = on; n.receiveShadow = on;
  });
}
function setTier(t) {
  if (!TIERS[t] || t === S.tier) return;
  S.tier = t; applyTierRenderer(); resize(true);
}
// Işık sıcaklığı: w ∈ [0,1] (0 = gece/acil, 1 = sıcak)
function setBiome(name, w) {
  S.biomeName = BIOME[name] ? name : 'Depo'; S.biome = BIOME[S.biomeName];
  if (S.glow) S.glow.material.color.copy(col(S.biome.glow));
  setWarm(w === undefined ? S.warm : w);
}
function lerpHex(out, a, b, k) { cA.setHex(a).convertSRGBToLinear(); cB.setHex(b).convertSRGBToLinear(); return out.copy(cA).lerp(cB, k); }
function setWarm(w) {
  S.warm = w; const B = S.biome;
  lerpHex(cTmp, B.bg[0], B.bg[1], w); S.renderer.setClearColor(cTmp, 1);
  lerpHex(S.hemi.color, B.sky[0], B.sky[1], w); lerpHex(S.hemi.groundColor, B.gnd[0], B.gnd[1], w);
  lerpHex(S.dir.color, B.dir[0], B.dir[1], w);
  S.hemi.intensity = 0.78 + 0.22 * w; S.dir.intensity = 0.62 + 0.3 * w;
  if (S.glow) S.glow.material.opacity = 0.55 + 0.35 * w;
}
let warmFrom = 0, warmTo = 0;
function onElec(p) {
  const L = PX.render.L; if (!L || !p) return;
  const n = L.loads.length; const fed = p.fedLoads ? p.fedLoads.length : 0;
  const w = n ? 0.15 + 0.85 * (fed / n) : 1;
  if (PX.render.instant || Math.abs(w - S.warm) < 1e-3) { PX.TW.cancel('scene:light'); setWarm(w); return; }
  warmFrom = S.warm; warmTo = w;
  PX.TW.cancel('scene:light');
  PX.TW.add('scene:light', 0.6, k => setWarm(warmFrom + (warmTo - warmFrom) * k), PX.EASE.inOutSine);
}
// kutlama (900 ms, atlanabilir: herhangi bir komut/yükleme TW'yi iptal eder); yükler halka halka yanar
function celebrate() {
  const L = PX.render.L; if (!L || PX.render.instant) return;
  const G = L.G; let i = 0;
  for (const ld of L.loads) {
    const el = L.els[ld.el]; if (el.cell < 0) continue;
    const c = el.cell, x = c % G.W, y = Math.floor(c / G.W) % G.H, z = Math.floor(c / (G.W * G.H)); const d = 0.12 * i++;
    PX.TW.add('fx:win', d, null, null, () => { PX.fx.ring(x, y + 0.5, z, 'kutlama'); PX.fx.burst(x, y + 0.7, z, 14, 'kutlama'); });
  }
  const w0 = S.warm; PX.TW.cancel('scene:light'); warmFrom = w0; warmTo = 1;
  PX.TW.add('scene:light', 0.9, k => setWarm(w0 + (1 - w0) * k), PX.EASE.outCubic);
}
// herhangi bir dokunuş doğuşu ve kutlamayı atlar (§12.3; input/gesture.js her pointerdown'da çağırır)
function skip() {
  if (PX.camera && PX.camera.spawnT >= 0) { PX.camera.spawnT = -1; PX.camera.fit(); }
  if (PX.TW.active('fx:win')) PX.TW.cancel('fx:win');
  if (PX.TW.active('scene:light')) { PX.TW.cancel('scene:light'); setWarm(warmTo); }
}
// zemin parıltısı + gölge kamerası seviyeye oturtulur
function frameLevel(L) {
  const G = L.G; const ext = PX.camera.ext; let ymin = 1e9;
  for (let c = 0; c < G.N; c++) if (G.kind[c]) { const y = Math.floor(c / G.W) % G.H; if (y < ymin) ymin = y; }
  const span = Math.max(G.W, G.D) * 1.9 + 2;
  S.glow.matrix.makeScale(span, 1, span); S.glow.matrix.setPosition(ext.cx, ymin - 0.62, ext.cz); S.glow.matrixWorldNeedsUpdate = true;
  const rad = Math.hypot(G.W, G.H, G.D) * 0.6 + 1;
  S.dir.target.position.set(ext.cx, ext.cy, ext.cz); S.dir.target.updateMatrixWorld();
  S.dir.position.set(ext.cx + rad * 0.55, ext.cy + rad * 1.6, ext.cz + rad * 0.9);
  const sc = S.dir.shadow.camera; sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 0.1; sc.far = rad * 5; sc.updateProjectionMatrix();
  S.shadowDirty = true;
}
// ---------------------------------------------------------------- kare
function render() {
  if (!S.renderer || !PX.camera || !PX.camera.cam) return;
  if (R.warmOnly) return;                  // açılış ısınması: sahne yalnız derleme için kurulu, tuval opak örtünün altında
  const r = S.renderer;
  if (r.shadowMap.enabled) {
    // gölge haritası yalnız sahne değişirken: kirli işaretten sonra 30 kare (kit mekanik geçişleri ≤ 0,4 s kendi
    // saatinde sürer) ya da TW etkinken; Volti gölge haritasına düşmez (blob gölgesi), yürüyüş güncelleme istemez
    if (S.shadowDirty) { S.shadowHold = 30; S.shadowDirty = false; }
    if (S.shadowHold > 0 || PX.TW.active()) { r.shadowMap.needsUpdate = true; if (S.shadowHold > 0) S.shadowHold--; }
  }
  r.render(S.scene, PX.camera.cam);
  measure();
}
// otomatik katman ölçümü (rAF aralığı, histerezis); karar setLevel'da uygulanır
const MT = new Float64Array(2);            // [son zaman, toplam] — nesne alanına double yazmamak için (ayırmasız)
function measure() {
  const M = S.meas; if (!M.on) { MT[0] = 0; return; }
  const now = performance.now(); const gap = MT[0] ? now - MT[0] : 16.7; MT[0] = now;
  if (M.skip > 0) { M.skip--; MT[1] = 0; return; }
  M.n++; MT[1] += gap; M.sum = M.n;
  if (M.n >= 60) {
    M.on = false; const avg = MT[1] / M.n;
    let cpu = 0; try { cpu = PX.main && PX.main.frameStats ? PX.main.frameStats(60).cpuAvg : 0; } catch (e) { cpu = 0; }
    const i = ORDER.indexOf(S.tier);
    if (avg > 20 && i > 0) { S.pendingTier = ORDER[i - 1]; S.goodLevels = 0; }
    else if (avg <= 17.5 && cpu < 4) { S.goodLevels++; const cap = isPhone() ? 1 : 2; if (S.goodLevels >= 3 && i < cap) { S.pendingTier = ORDER[i + 1]; S.goodLevels = 0; } }
    else S.goodLevels = 0;
  }
}
function compile() { if (S.renderer && PX.camera && PX.camera.cam) { try { S.renderer.compile(S.scene, PX.camera.cam); } catch (e) { console.error('[PX.scene] compile', e); } } }
// Isınma geçişi (oturumda bir kez, ilk seviye kurulunca): gizli paylaşımlı nesneler (vurgular, bölge desenleri, FX
// halkaları/parçacıkları, örtü kabuğu) 4×4 hedefe bir kez çizilir => doku/geometri GPU yüklemesi ilk etkileşimde
// değil açılışta olur (§24.9: ilk cihaz etkileşiminde uzun görev yok; leak paketi: sayaçlar seviyeler arasında sabit).
function warmShared() {
  // A later level can introduce a new fade/instancing shader variant. Warm its
  // hidden meshes too, so that compilation cannot stall the first walk/touch.
  if (!S.renderer || !PX.camera || !PX.camera.cam) return;
  S.warmed = true;
  const r = S.renderer, saved = [];
  S.scene.traverse(o => {
    if (!(o.isMesh || o.isPoints)) return;
    saved.push(o, o.visible ? 1 : 0, o.isInstancedMesh ? o.count : -1);
    o.visible = true; if (o.isInstancedMesh && o.count === 0) o.count = 1;
  });
  let rt = null; const prev = r.getRenderTarget(), nu = r.shadowMap.needsUpdate;
  try {
    rt = warmTarget();
    r.shadowMap.needsUpdate = false; r.setRenderTarget(rt); r.render(S.scene, PX.camera.cam);
  } catch (e) { console.error('[PX.scene] warm', e); }
  finally { r.setRenderTarget(prev); r.shadowMap.needsUpdate = nu; }
  for (let i = 0; i < saved.length; i += 3) { const o = saved[i]; o.visible = saved[i + 1] === 1; if (saved[i + 2] >= 0) o.count = saved[i + 2]; }
  if (rt) rt.dispose();
  warmSharedTextures();
}
// Isınma hedefi tuvalle AYNI program anahtarını üretmeli: r128 program anahtarı çıkış kodlamasını geçerli render
// hedefinden okur (hedef varsa hedef dokusunun kodlaması). Varsayılan (Linear) 4×4 hedef her malzemenin ikinci bir
// (Linear) programını derliyordu: 11 yerine 22 program, ilk "Başla"da iki kat eşzamanlı bağlama. Gölge geçişi
// shadowMap.enabled kapatılarak DEĞİL needsUpdate=false ile atlanır (autoUpdate zaten kapalı): gölgeli katmanda
// da anahtar tuvaldekiyle aynı kalır.
function warmTarget() { return new THREE.WebGLRenderTarget(4, 4, { encoding: S.renderer.outputEncoding, depthBuffer: true, stencilBuffer: false }); }
// sahnede olmayabilen paylaşımlı dokular (iş karosu, şarj rakamları): doğrudan yükle
function warmSharedTextures() {
  const r = S.renderer;
  const tx = [].concat(PX.diorama && PX.diorama.sharedTextures ? PX.diorama.sharedTextures() : [], PX.flow && PX.flow.sharedTextures ? PX.flow.sharedTextures() : []);
  for (const t of tx) { try { if (t && r.initTexture) r.initTexture(t); } catch (e) { /* yoksay */ } }
}
// ---------------------------------------------------------------- açılış ısınması (§24.9, §17 F10, §12.3)
// Açılış/harita ekranı açıkken (opak örtü tuvali kapatır) "Başla"nın açacağı seviye (PX.world.nextLevel) sahneye
// kurulur ve her nesne tek tek 4×4 hedefe çizilerek programlar + geometri/doku yüklemeleri BOŞTA, dilim başına
// ~6 ms bütçeyle parça parça yapılır (tek bir program bağlaması bütçeyi aşabilir; ~10 ms). Önceden: ilk "Başla"
// dokunuşu R.setLevel içinde compile()+warmShared() ile 22 programı eşzamanlı derleyip bağlıyordu (r128
// checkShaderErrors her programda getProgramInfoLog ile bekler): 400–950 ms (4× CPU) tek uzun görev.
// Isınma sürerken ana döngü çizmez (R.warmOnly: tuval örtünün altında); gerçek setLevel ısınmayı keser, kalan iş eski
// yoldan (compile + warmShared) yapılır, derlenmiş programlar önbellekten gelir. PX.scene.prewarm() -> Promise<bool>.
const PW = { seq: 0, job: 0, list: null, i: 0, ws: null, rt: null, done: null, res: null };
function idleCb(fn) { if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 100 }); else setTimeout(fn, 16); }
function prewarmLevel() {
  const L = PX.LEVELS || []; let id = null;
  try { id = PX.world && PX.world.nextLevel ? PX.world.nextLevel() : null; } catch (e) { id = null; }
  return L.find(l => l.id === id) || L[0] || null;
}
function prewarm() {
  if (PW.done) return PW.done;
  if (S.warmed || R.L || !S.renderer || !PX.camera || !PX.camera.cam || !PX.SIM || !PX.diorama) return Promise.resolve(false);
  const job = ++PW.seq; PW.job = job;
  PW.done = new Promise(res => { PW.res = res; });
  idleCb(() => prewarmBuild(job));
  return PW.done;
}
function prewarmEnd(ok) {
  PW.job = 0; PW.list = null; PW.i = 0;
  if (PW.ws) { PW.ws.children.length = 0; PW.ws = null; }
  if (PW.rt) { PW.rt.dispose(); PW.rt = null; }
  const res = PW.res; PW.res = null; PW.done = null; if (res) res(!!ok);
}
function prewarmBuild(job) {
  if (PW.job !== job) return;
  if (R.L) { prewarmEnd(false); return; }                    // bu arada gerçek seviye kuruldu
  const lv = prewarmLevel(); let L = null, s = null;
  try { L = PX.SIM.compile(lv.def); s = PX.SIM.initState(L); } catch (e) { prewarmEnd(false); return; }
  try { R.warmOnly = true; R.setLevel(L, s); } catch (e) { console.error('[PX.scene] prewarm', e); R.warmOnly = false; prewarmEnd(false); return; }
  const list = []; S.scene.traverse(o => { if (o.material && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) list.push(o); });
  PW.list = list; PW.i = 0;
  const ws = new THREE.Scene(); ws.autoUpdate = false;
  // tuvaldeki ışık yapılandırmasıyla aynı (yarıküre + yönlü, aynı gölge bayrağı) => aynı program anahtarı
  const hl = new THREE.HemisphereLight(0xffffff, 0x000000, 1); const dl = new THREE.DirectionalLight(0xffffff, 1);
  dl.castShadow = S.dir.castShadow; ws.add(hl); ws.add(dl);
  PW.ws = ws; PW.rt = warmTarget();
  idleCb(() => prewarmStep(job));
}
function prewarmStep(job) {
  if (PW.job !== job) return;
  if (!R.warmOnly) { prewarmEnd(false); return; }
  const r = S.renderer, cam = PX.camera.cam, ws = PW.ws, list = PW.list, base = 2; const t0 = performance.now();
  const prev = r.getRenderTarget(), nu = r.shadowMap.needsUpdate;
  r.shadowMap.needsUpdate = false; r.setRenderTarget(PW.rt);
  try {
    while (PW.i < list.length && performance.now() - t0 < 6) {
      const o = list[PW.i++];
      const vis = o.visible, cnt = o.isInstancedMesh ? o.count : -1, fc = o.frustumCulled;
      o.visible = true; if (cnt === 0) o.count = 1; o.frustumCulled = false;
      ws.children.length = base; ws.children.push(o);          // o.parent değişmez: yalnız bu çizim için listede
      try { r.render(ws, cam); } catch (e) { console.error('[PX.scene] prewarm render', e); }
      ws.children.length = base;
      o.visible = vis; if (cnt >= 0) o.count = cnt; o.frustumCulled = fc;
    }
  } finally { r.setRenderTarget(prev); r.shadowMap.needsUpdate = nu; }
  if (PW.i < list.length) { idleCb(() => prewarmStep(job)); return; }
  warmSharedTextures(); S.warmed = true;
  prewarmEnd(true);
}
function info() {
  const i = S.renderer ? S.renderer.info : null;
  return i ? { calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0, tier: S.tier } : null;
}
Object.assign(S, { init, resize, render, info, setTier, setBiome, setWarm, compile, prewarm, frameLevel, col, TIERS });
// kit/Volti ekipleri katmanı PX.scene.quality olarak da okur (stub adı): salt okunur takma ad
Object.defineProperty(S, 'quality', { get() { return S.tier; }, enumerable: true });
PX.scene = S;

// ---------------------------------------------------------------- PX.render cephesi
// adım türü -> Volti klibi + cihaz durumunun görsel olarak değiştiği an (klip içi vuruş, 0..1)
const CLIP = { op: 'operate', lock: 'lock', unlock: 'unlock', earth: 'earth', fuse: 'fuse', press: 'press', work: 'work', wait: 'wait' };
const CLIP_S = { operate: 0.38, lock: 0.6, unlock: 0.6, earth: 0.9, fuse: 0.7, press: 0.25, work: 0.6, wait: 0.4 };
const BEAT = { operate: 0.55, lock: 0.6, unlock: 0.5, earth: 0.72, fuse: 0.6, press: 0.5, work: 0.5, wait: 0.55 };
const DONE = Object.freeze({ cancelled: false });
function biyomOf(L) { const lv = PX.game && PX.game.level; if (lv && lv.biyom) return lv.biyom; const l2 = PX.LEVELS && PX.LEVELS.find(l => l.id === L.id); return (l2 && l2.biyom) || 'Depo'; }
const R = {
  instant: false, L: null, s: null, skip, warmOnly: false,
  // kazanma paneli açıkken sonraki seviye için ısıtma (§12.3 "Sonraki → oynanabilir ≤ 300 ms"): kitlerin ortak
  // malzemesi zaten derli; boşta bir kez renderer.compile (yeni program yoksa ucuz). Yalnız ipucu, durum değişmez.
  prepare(lv) {
    if (!lv || !S.renderer) return;
    const run = () => { if (!R.L) return; compile(); };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 400 }); else setTimeout(run, 50);
  },
  setLevel(L, s) {
    const warmOnly = R.warmOnly === true && PW.job !== 0;     // açılış ısınmasının kendi kurulumu (prewarmBuild)
    if (!warmOnly) { R.warmOnly = false; if (PW.job) prewarmEnd(false); }
    R.L = L; R.s = s;
    if (PX.TW) PX.TW.cancel('scene:light');
    if (S.pendingTier && !S.forced) { const t = S.pendingTier; S.pendingTier = null; setTier(t); }
    setBiome(biyomOf(L), 0.15);
    if (PX.camera) PX.camera.setLevel(L, s);
    if (PX.fx && PX.fx.clear3d) PX.fx.clear3d();
    if (PX.diorama) PX.diorama.build(L, s);
    if (PX.flow && PX.flow.build) PX.flow.build(L, s);
    if (PX.volti) PX.volti.setLevel(L, s);
    frameLevel(L);
    applyShadowFlags();
    R.sync(s);
    const E = PX.SIM.stateE(L, s); const n = L.loads.length; let fed = 0; for (let i = 0; i < n; i++) if ((E.loadMask >> i) & 1) fed++;
    setWarm(n ? 0.15 + 0.85 * fed / n : 1); warmTo = S.warm;
    if (warmOnly) return;                                      // derleme/yükleme prewarmStep'te dilimlerle
    compile(); warmShared();
    if (PX.camera && PX.camera.spawn && !R.instant) PX.camera.spawn();
    S.meas.on = true; S.meas.n = 0; S.meas.sum = 0; S.meas.skip = 30;
  },
  sync(s, E) {
    if (!R.L || !s) return;
    R.s = s;
    E = E || PX.SIM.stateE(R.L, s);
    if (PX.diorama) PX.diorama.sync(s, E);
    if (PX.flow && PX.flow.sync) PX.flow.sync(s, E);
    if (PX.volti) PX.volti.place(s.p);
    if (PX.camera && typeof s.v === 'number') PX.camera.syncView(s.v);       // görünüm yalnız sunum alanı (controller G.camV)
    S.shadowDirty = true;
  },
  // cihazın görsel durumunu (diorama + akış) adımın sonucuna çevirir; Volti ve kamera dokunulmaz (klip sürerken)
  showDevices(s) {
    if (!R.L || !s) return;
    const E = PX.SIM.stateE(R.L, s);
    if (PX.diorama) PX.diorama.sync(s, E);
    if (PX.flow && PX.flow.sync) PX.flow.sync(s, E);
    S.shadowDirty = true;
  },
  animate(step) {
    if (R.instant || !R.L) { R.sync(step.after); return Promise.resolve(DONE); }
    // döndürme sahneyi değiştirmez (yalnız kamera): gölge haritası döndürme boyunca yeniden çizilmez
    if (step.kind !== 'rot' && step.kind !== 'walk') S.shadowDirty = true;
    const fin = r => { if (!r || !r.cancelled) R.sync(step.after); return r || DONE; };
    switch (step.kind) {
      case 'walk': {
        // fiziksel yol: sim2.walkPath adımları (merdiven/iskele geçişleri dahil) tercih edilir; yoksa karo hücreleri
        const steps = Array.isArray(step.steps) && step.steps.length > 1 ? step.steps : null;
        const path = steps || (step.path && step.path.length > 1 ? step.path : [step.before.p, step.after.p]);
        const end = step.after.p;
        if (PX.diorama && PX.diorama.highlight) PX.diorama.highlight(end, 'hedef');
        // chain: önceki yürüyüş bu karede bitti -> Volti eğilmeden/çömelmeden sürer (§12.3 "yürüme içi duraklama 0")
        return PX.volti.followPath(path, { chain: !!step.chain }).then(r => {
          if (!r || !r.cancelled) { if (PX.diorama && PX.diorama.highlight) PX.diorama.highlight(-1, 'hedef', end); }
          return fin(r);
        });
      }
      case 'rot': {
        if (typeof step.after.v !== 'number') return Promise.resolve(DONE);
        return PX.camera.snapTo(step.after.v).then(r => { const out = fin(r); S.shadowDirty = false; S.shadowHold = Math.max(S.shadowHold, 1); return out; });
      }
      default: {
        const clip = CLIP[step.kind] || 'operate';
        const ei = step.a && step.a.e !== undefined ? step.a.e : -1;
        // cihaz, Volti'nin eli değdiği anda döner: volti.timing() play() ile aynı klip seçimini yapar (volti isteği #1)
        let beat = (CLIP_S[clip] || 0.38) * (BEAT[clip] || 0.5);
        if (PX.volti.timing) { try { const tm = PX.volti.timing(clip, { el: ei, step }); if (tm && tm.beat > 0) beat = tm.beat; } catch (e) { /* tablo değeri */ } }
        const pv = PX.volti.play(clip, { el: ei, step });
        const pb = PX.TW.add('fx:beat', beat, null, null, () => {
          R.showDevices(step.after);
          if (ei >= 0 && PX.diorama && PX.diorama.pulse) PX.diorama.pulse(ei, step.kind);
          if (step.trips && step.trips.length && PX.diorama && PX.diorama.tripFx) PX.diorama.tripFx(step.trips);
        });
        return Promise.all([pv, pb]).then(rs => fin(rs[0] && rs[0].cancelled ? rs[0] : rs[1]));
      }
    }
  },
};
PX.render = R;
