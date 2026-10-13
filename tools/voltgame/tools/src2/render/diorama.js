// ============================================================================
// render/diorama.js — PX.diorama : bloklar (InstancedMesh, biyom malzemeleri), duvarlar (%), merdiven / iskele / kapı
//                     kitleri, platform kenarı korkulukları, ekipman (PX.KIT), karo vurguları, yaklaşma bölgeleri
//                     (zemin çıkartması + çit kenarı, §24.5), ÖRTÜCÜ SAYDAMLIĞI (§25), kimlik tamponu   sahip: Render
// Kural sürümü 4 (fiziksel dünya): kamera yalnız görseldir; hiçbir şey gizli kalmaz. Volti'nin, seçili cihazın, yol
// önizlemesinin ve iş/hedef karosunun ÖNÜNDEKİ hücreler (sim2.occluders) 120 ms'de ~%26 opaklığa geçer; seçim
// (camera.pick / sim2.ownerAt skip) bu hücreleri atlar. Hedefler controller'ın 'focus' olayından gelir; yalnız olay
// anında ve kameranın yakın görünümü değişince yeniden hesaplanır (kare başına iş: yalnız geçiş animasyonu).
// Dünya = hücre koordinatı (küp merkezi (x,y,z), karo üstü y+0.5). Paylaşımlı geometri/malzeme/doku init'te bir kez;
// seviyeye özgü olanlar clear()'da atılır (leak paketi). Kare döngüsünde ayırma yok.
//   PX.diorama.init()            PX.diorama.build(L, s)       PX.diorama.sync(s, E)   (SAF: durum -> görsel)
//   PX.diorama.update(dt)        PX.diorama.tileTop(cell) -> y   PX.diorama.cellPos(cell, outVec3)
//   PX.diorama.highlight(cell|-1, kind?, onlyIf?)   kind: 'hedef' (yürüyüş hedefi, varsayılan) | 'imlec' (klavye
//                                imleç önizlemesi) | 'ipucu' (ipucu/rehber cihazı ya da karosu) | 'erisim' (erişim işareti)
//                                -1 ile gizler; onlyIf verilirse yalnız o hücredeyse gizler. Hedef değişince eski halka 120 ms söner.
//   PX.diorama.pulse(elIdx, kind)  cihaz "dokunuş" vuruşu (kit act(); obj.scale daima 1)
//   PX.diorama.cover([cell]|null)  lastik bant / engel neden çizgisi: hücreler kırmızı taralı kabuk ('gesture:rubber')
//   PX.diorama.tripFx([id])        koruma açması FX'i (halka + "pof"; patlama yok)
//   PX.diorama.focus(targets, v?)  örtücü hedefleri (sim2.occluders biçimi: hücre ya da [x,y,z]); 'focus' olayı çağırır
//   PX.diorama.fadedSet() -> Set<cell>  şu an yarı saydam örtücüler (sim2.ownerAt skip; önbellekli, olayda güncellenir)
//   PX.diorama.drawnScale(cell) -> number  çizilen nesnenin ölçeği (FX/mantık eşliği; çizilmiyorsa 0)
//   PX.diorama.drawnTiles(v) -> [cell]     KİMLİK TAMPONU: çizilen blok/duvar örnek matrisleri + ekipman/merdiven
//                                hücreleri birim küp vekilleriyle görünüm v'nin tam kamerasından; karonun iki üst üçgeninde
//                                4'er örnek noktası o hücrenin ÜST yüzünü göstermeli (örtücü saydamlığı hariç)
//   PX.diorama.walkableDrawn() -> {tiles, stairs, ladders, doors, rails}  ÇİZİLEN nesnelerden (mantıktan değil):
//                                üstü çizilmiş katı nesneyle örtülmeyen blok örnekleri, merdiven/iskele/kapı kitleri
//   PX.diorama.zones() -> [{cell, kind}]   çizilen bölge karoları ('canli'|'topraksiz'|'yuklu')
//   PX.diorama.elState(elIdx) -> son uygulanan setState nesnesi (test)
// Kit sözleşmesi (§24.2): (PX.KIT[el.t] || PX.KIT.default)(el, biyom) -> {obj, setState(st), anchor, hit}
//   st = {closed, locked, live, earthed, charge, blown, tripped}; kapı: closed = kapalı (kilitli), açık = !closed
// ============================================================================
const D = { L: null, blocks: null, eq: [], byCell: null, levelObjs: [], shared: null, zoneMesh: null, fence: null, work: null,
  zoneCells: [], zoneKinds: [], hl: {}, hlT: 0, biyom: 'Depo', idp: null, s: null, trip: new Set(), tripAny: false, tripT: 0,
  walls: [], structs: [], rails: null, railN: 0, inst: null, objAt: null, fade: null };
let m4 = null, col = null, v3 = null;
const ZK = ['canli', 'topraksiz', 'yuklu'];
const HL_KIND = { hedef: [0x7fe3ff, 'ring'], imlec: [0xffffff, 'square'], ipucu: [0xffc23a, 'ring'], erisim: [0x9cff8a, 'square'] };
function instancedKitMaterial() {
  // r128 caches the active shader variant per material. Sharing KIT's normal
  // material with instanced walls/rails makes that variant flip on every frame.
  if (!D.shared.kitInstMat) {
    const mat = PX.KITLIB.material().clone();
    mat.name = 'PX.KIT.instanced'; mat.userData.shared = true;
    D.shared.kitInstMat = mat;
  }
  return D.shared.kitInstMat;
}

function canvasTex(w, h, draw, srgb) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb !== false) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4; t.userData = { shared: true }; return t;
}
// birim küp: üst yüz köşe rengi 1, yanlar 0,74, alt 0,5 (örnek rengiyle çarpılır; Lambert ışığı ayrıca gölgeler)
function blockGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.attributes.position.count; const c = new Float32Array(n * 3); const nr = g.attributes.normal.array;
  for (let i = 0; i < n; i++) { const ny = nr[i * 3 + 1]; const k = ny > 0.5 ? 1 : ny < -0.5 ? 0.5 : 0.74; c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.userData.shared = true; return g;
}
// basit kutu birleştirici (çit rayları): [[sx,sy,sz, ox,oy,oz], …] -> tek BufferGeometry
function mergeBoxes(list) {
  const pos = [], nor = [], idx = []; let base = 0;
  for (const b of list) {
    const g = new THREE.BoxGeometry(b[0], b[1], b[2]); g.translate(b[3], b[4], b[5]);
    const p = g.attributes.position.array, nn = g.attributes.normal.array, ii = g.index.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(nn[i]); }
    for (let i = 0; i < ii.length; i++) idx.push(ii[i] + base);
    base += p.length / 3; g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  g.userData.shared = true; return g;
}
function hatch(g, w, h, bg, fg, step, lw, cross) {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = lw; g.lineCap = 'square';
  for (let i = -h; i < w + h; i += step) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); if (cross) { g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke(); } }
  g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
}
function init() {
  m4 = new THREE.Matrix4(); col = new THREE.Color(); v3 = new THREE.Vector3();
  const tileTex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w - 2, 0, 2, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(2, 2, w - 4, 2); g.fillRect(2, 2, 2, h - 4);
    g.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i < 26; i++) g.fillRect((i * 37) % 60 + 2, (i * 23) % 60 + 2, 2, 2);
  });
  const zoneTex = {
    canli: canvasTex(64, 64, (g, w, h) => hatch(g, w, h, 'rgba(255,70,40,0.20)', 'rgba(255,92,48,0.95)', 12, 4, false)),
    topraksiz: canvasTex(64, 64, (g, w, h) => hatch(g, w, h, 'rgba(255,190,40,0.16)', 'rgba(255,196,48,0.9)', 16, 3, true)),
    yuklu: canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = 'rgba(80,220,255,0.16)'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(90,230,255,0.95)';
      for (let y = 6; y < h; y += 13) for (let x = (y / 13) % 2 ? 12 : 6; x < w; x += 13) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = 'rgba(90,230,255,0.95)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    }),
  };
  const workTex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.save(); g.beginPath(); g.rect(0, 0, w, h); g.rect(16, 16, w - 32, h - 32); g.clip('evenodd');
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f0a020';
    for (let i = -h; i < w + h; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 11, 0); g.lineTo(i + 11 + h, h); g.lineTo(i + h, h); g.closePath(); g.fill(); }
    g.restore();
    g.fillStyle = 'rgba(240,160,32,0.95)'; g.font = 'bold 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('İŞ', w / 2, h / 2 + 3);
  });
  const blockMat = new THREE.MeshLambertMaterial({ map: tileTex, vertexColors: true });
  blockMat.userData.shared = true;
  const plane = new THREE.PlaneGeometry(0.96, 0.96); plane.rotateX(-Math.PI / 2); plane.userData.shared = true;
  const decal = k => { const m = new THREE.MeshBasicMaterial({ map: zoneTex[k], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, toneMapped: false }); m.userData.shared = true; return m; };
  const ringGeo = new THREE.RingGeometry(0.30, 0.42, 40, 1); ringGeo.rotateX(-Math.PI / 2); ringGeo.userData.shared = true;
  const sqGeo = new THREE.RingGeometry(0.56, 0.66, 4, 1, Math.PI / 4); sqGeo.rotateX(-Math.PI / 2); sqGeo.userData.shared = true;
  const fenceGeo = mergeBoxes([[1.0, 0.035, 0.035, 0, 0.10, 0], [1.0, 0.035, 0.035, 0, 0.22, 0], [0.04, 0.26, 0.04, 0.48, 0.13, 0], [0.04, 0.26, 0.04, -0.48, 0.13, 0]]);
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x220a00 }); fenceMat.userData.shared = true;
  const workMat = new THREE.MeshBasicMaterial({ map: workTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, toneMapped: false });
  workMat.userData.shared = true;
  D.shared = { box: blockGeometry(), blockMat, plane, zoneMat: { canli: decal('canli'), topraksiz: decal('topraksiz'), yuklu: decal('yuklu') }, ringGeo, sqGeo, fenceGeo, fenceMat, workMat, proxyBox: null };
  // vurgu halkaları (tür başına bir tane; paylaşımlı geometri, tür başına malzeme)
  for (const k in HL_KIND) {
    const m = new THREE.MeshBasicMaterial({ color: HL_KIND[k][0], transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, toneMapped: false });
    m.userData.shared = true;
    const mesh = new THREE.Mesh(HL_KIND[k][1] === 'ring' ? ringGeo : sqGeo, m); mesh.visible = false; mesh.renderOrder = 3; mesh.name = 'hl-' + k; mesh.userData.noShadow = true;
    D.hl[k] = { mesh, cell: -1 };
    PX.scene.scene.add(mesh);
  }
  {
    const ct = canvasTex(64, 64, (g, w, h) => hatch(g, w, h, 'rgba(255,60,40,0.18)', 'rgba(255,80,50,0.85)', 10, 3, false));
    const cm = new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    cm.userData.shared = true;
    const cv = new THREE.InstancedMesh(D.shared.box, cm, COVER_N); cv.count = 0; cv.visible = false; cv.frustumCulled = false;
    cv.instanceMatrix.setUsage(THREE.DynamicDrawUsage); cv.renderOrder = 5; cv.name = 'cover'; cv.userData.noShadow = true; cv.userData.shared = true;
    D.cover = cv; PX.scene.scene.add(cv);
  }
  if (PX.fx && PX.fx.init3d) PX.fx.init3d();
  if (PX.bus) {
    PX.bus.on('gesture:rubber', p => cover(p && p.on ? p.cells : null));
    PX.bus.on('level:loaded', () => { cover(null); highlight(-1, 'ipucu'); });
    // ipucu: sıradaki optimum eylemin cihazı (ya da yürüyüş hedefi) sarı halka; sonraki komutta söner
    PX.bus.on('hint', p => onHint(p));
    PX.bus.on('cmd:accepted', () => highlight(-1, 'ipucu'));
    PX.bus.on('redo', () => highlight(-1, 'ipucu'));
    PX.bus.on('cmd:accepted', p => { if (p && p.a && p.a.t === 'git' && !PX.render.instant) highlight(p.a.to, 'hedef'); });
    PX.bus.on('cmd:rejected', p => onReject(p));
    PX.bus.on('undo', () => { highlight(-1, 'hedef'); highlight(-1, 'ipucu'); if (D.tripAny) { clearTimeout(D.tripT); D.tripT = setTimeout(tripRebuild, 0); } });
    PX.bus.on('reset', () => { highlight(-1, 'hedef'); highlight(-1, 'ipucu'); D.trip.clear(); retrip(); });
    PX.bus.on('anim:step', p => {
      if (!D.L || !p) return;
      if (p.a && p.a.t === 'op') D.trip.delete(p.a.e);
      tripAdd(p.trips);
    });
    // örtücü hedefleri (controller): Volti gövdesi, seçili cihaz, yol hücreleri, iş/rehber karosu
    PX.bus.on('focus', p => { if (p && Array.isArray(p.targets)) focus(p.targets, p.view); });
  }
}
function clear() {
  const root = PX.scene.root;
  for (const o of D.levelObjs) {
    if (o.parent) o.parent.remove(o);
    o.traverse(n => {
      if (n.userData && n.userData.shared) return;
      if (n.geometry && !(n.geometry.userData && n.geometry.userData.shared)) n.geometry.dispose();
      const ms = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      for (const m of ms) if (!(m.userData && m.userData.shared)) { if (m.map && !(m.map.userData && m.map.userData.shared)) m.map.dispose(); m.dispose(); }
    });
    if (o.isInstancedMesh && o.dispose) o.dispose();
  }
  void root;
  if (D.fade) for (const g of D.fade.ghostMats) g.dispose();
  D.levelObjs.length = 0; D.eq.length = 0; D.byCell = null; D.blocks = null; D.zoneMesh = null; D.fence = null; D.work = null;
  D.zoneCells.length = 0; D.zoneKinds.length = 0; D.walls.length = 0; D.structs.length = 0; D.rails = null; D.railN = 0; D.inst = null; D.objAt = null; D.fade = null;
  for (const k in D.hl) { D.hl[k].mesh.visible = false; D.hl[k].cell = -1; }
}
function biyomOf(L) { const lv = PX.game && PX.game.level; if (lv && lv.biyom) return lv.biyom; const l2 = PX.LEVELS && PX.LEVELS.find(l => l.id === L.id); return (l2 && l2.biyom) || 'Depo'; }
function xyzOf(G, c) { return [c % G.W, Math.floor(c / G.W) % G.H, Math.floor(c / (G.W * G.H))]; }
function build(L, s) {
  clear(); D.L = L; D.s = s; D.trip.clear(); D.tripAny = false;
  D.fade = { cells: new Set(), targets: null, v: -1, ghostMats: [], anim: false };
  const G = L.G; D.biyom = biyomOf(L);
  const B = (PX.scene.BIOME && PX.scene.BIOME[D.biyom]) || PX.scene.BIOME.Depo;
  let n = 0;
  for (let c = 0; c < G.N; c++) if (G.kind[c] === 1) n++;
  const mesh = new THREE.InstancedMesh(D.shared.box, D.shared.blockMat, Math.max(1, n));
  mesh.name = 'blocks'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  const cTop = PX.scene.col(B.top), cAlt = PX.scene.col(B.tile2), cWork = PX.scene.col(B.work);
  let i = 0; let ymax = 1;
  for (let c = 0; c < G.N; c++) if (G.kind[c]) { const y = Math.floor(c / G.W) % G.H; if (y > ymax) ymax = y; }
  for (let c = 0; c < G.N; c++) {
    if (G.kind[c] !== 1) continue;
    const [x, y, z] = xyzOf(G, c);
    m4.makeTranslation(x, y, z); mesh.setMatrixAt(i, m4);
    if (c === L.work) col.copy(cWork);
    else { col.copy(((x + z) & 1) ? cAlt : cTop); col.multiplyScalar(0.84 + 0.22 * (y / ymax)); }
    mesh.setColorAt(i, col); i++;
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.userData.cells = new Int32Array(n); { let j = 0; for (let c = 0; c < G.N; c++) if (G.kind[c] === 1) mesh.userData.cells[j++] = c; }
  D.blocks = mesh; PX.scene.root.add(mesh); D.levelObjs.push(mesh);
  // hücre -> örnek (blok/duvar) ya da nesne kaydı: örtücü saydamlığı ve kimlik tamponu için
  D.inst = { set: new Int8Array(G.N).fill(-1), idx: new Int32Array(G.N).fill(-1), sets: [] };
  D.objAt = new Array(G.N).fill(null);
  addInstSet(mesh, D.shared.blockMat);
  for (let j = 0; j < n; j++) { const c = mesh.userData.cells[j]; D.inst.set[c] = 0; D.inst.idx[c] = j; }
  const SG = PX.KIT && PX.KIT.structGeo ? PX.KIT.structGeo(D.biyom) : null;
  // duvarlar (%): üstü boşsa başlıklı (tepesi yürüme yüzeyi gibi görünmez), değilse düz örgü
  if (SG) {
    const top = [], mid = [];
    for (let c = 0; c < G.N; c++) { if (G.kind[c] !== 5) continue; const [x, y, z] = xyzOf(G, c); const u = G.idx(x, y + 1, z); (u >= 0 && G.solid(u) ? mid : top).push(c); }
    for (const [list, mk] of [[top, SG.wallTop], [mid, SG.wallMid]]) {
      if (!list.length) continue;
      const wm = new THREE.InstancedMesh(mk(), instancedKitMaterial(), list.length); wm.name = 'walls'; wm.frustumCulled = false; wm.matrixAutoUpdate = false;
      list.forEach((c, j) => { const [x, y, z] = xyzOf(G, c); m4.makeTranslation(x, y, z); wm.setMatrixAt(j, m4); });
      wm.instanceMatrix.needsUpdate = true; wm.userData.cells = Int32Array.from(list);
      PX.scene.root.add(wm); D.levelObjs.push(wm); D.walls.push(wm);
      const si = addInstSet(wm, wm.material);
      list.forEach((c, j) => { D.inst.set[c] = si; D.inst.idx[c] = j; });
    }
  }
  // iş karosu çıkartması
  if (L.work >= 0) {
    const [x, y, z] = xyzOf(G, L.work);
    const w = new THREE.Mesh(D.shared.plane, D.shared.workMat); w.position.set(x, y + 0.502, z); w.renderOrder = 1; w.name = 'work'; w.userData.noShadow = true;
    w.matrixAutoUpdate = false; w.updateMatrix(); D.work = w; PX.scene.root.add(w); D.levelObjs.push(w);
  }
  // yaklaşma bölgeleri: desen başına bir InstancedMesh + çit
  const nt = Math.max(1, L.tiles.length);
  D.zoneMesh = {};
  for (const k of ZK) {
    const zm = new THREE.InstancedMesh(D.shared.plane, D.shared.zoneMat[k], nt); zm.count = 0; zm.frustumCulled = false; zm.renderOrder = 2; zm.name = 'zone-' + k; zm.userData.noShadow = true;
    zm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); zm.matrixAutoUpdate = false; zm.visible = false;
    D.zoneMesh[k] = zm; PX.scene.root.add(zm); D.levelObjs.push(zm);
  }
  const fz = new THREE.InstancedMesh(D.shared.fenceGeo, D.shared.fenceMat, nt * 4); fz.count = 0; fz.frustumCulled = false; fz.name = 'zone-fence';
  fz.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fz.matrixAutoUpdate = false; fz.visible = false; fz.userData.noShadow = true;
  fz.setColorAt(0, col.setRGB(1, 1, 1)); fz.instanceColor.setUsage(THREE.DynamicDrawUsage);
  D.fence = fz; PX.scene.root.add(fz); D.levelObjs.push(fz);
  // ekipman
  D.byCell = new Int32Array(G.N).fill(-1);
  L.els.forEach((el, ei) => {
    if (el.cell < 0) return;
    const mk = (PX.KIT && (PX.KIT[el.t] || PX.KIT.default));
    let k = null;
    try { k = mk ? mk(el, D.biyom) : null; } catch (e) { console.error('[PX.KIT] ' + el.t, e); k = null; }
    if (!k || !k.obj) {
      const o = new THREE.Mesh(D.shared.box, new THREE.MeshLambertMaterial({ color: 0x999999 }));
      k = { obj: o, setState() {}, anchor: null, hit: o };
    }
    const [x, y, z] = xyzOf(G, el.cell); k.obj.position.set(x, y, z); k.obj.scale.set(1, 1, 1);
    k.obj.updateMatrix(); k.obj.matrixAutoUpdate = false;    // kitler statik (kits isteği #2): kare başına matris yok
    k.obj.userData.el = ei; PX.scene.root.add(k.obj); D.levelObjs.push(k.obj);
    const rec = { ei, cell: el.cell, k, st: null, x, y, z, gm: null, a: 1, tgt: 1 };
    D.byCell[el.cell] = D.eq.length; D.eq.push(rec); D.objAt[el.cell] = rec;
  });
  // merdivenler ve iskeleler (kural sürümü 4): gerçek geometri, yapı başına bir çizim çağrısı
  const addStruct = (kind, cell, mk) => {
    let k = null; try { k = mk(); } catch (e) { console.error('[PX.KIT] ' + kind, e); k = null; }
    if (!k || !k.obj) return;
    const [x, y, z] = xyzOf(G, cell); k.obj.position.set(x, y, z); k.obj.updateMatrix(); k.obj.matrixAutoUpdate = false;
    k.obj.userData.struct = kind; PX.scene.root.add(k.obj); D.levelObjs.push(k.obj);
    const rec = { kind, cell, k, gm: null, a: 1, tgt: 1 }; D.structs.push(rec);
    if (kind === 'merdiven') D.objAt[cell] = rec;
  };
  if (PX.KIT && PX.KIT.merdiven) for (const st of L.stairs || []) addStruct('merdiven', st.cell, () => PX.KIT.merdiven(st, L, D.biyom));
  if (PX.KIT && PX.KIT.iskele) for (const ld of L.ladders || []) addStruct('iskele', ld.cells[0], () => PX.KIT.iskele(ld, L, D.biyom));
  buildRails(L, SG);
  // biyom dekorları (ızgara dışı köşe adaları; kit ekibi): tek Mesh, oynanışı asla örtmez
  if (PX.KIT && PX.KIT.props) {
    let p = null; try { p = PX.KIT.props(L, D.biyom); } catch (e) { console.error('[PX.KIT] props', e); p = null; }
    if (p && p.obj) { p.obj.name = p.obj.name || 'kit:props'; p.obj.userData.noShadow = true; PX.scene.root.add(p.obj); D.levelObjs.push(p.obj); }
  }
  for (const k in D.hl) PX.scene.scene.add(D.hl[k].mesh);
  // varsayılan odak (controller 'focus' olayı gelene kadar): Volti'nin başlangıç gövdesi + iş karosu
  const tg = []; { const [x, y, z] = xyzOf(G, s.p); tg.push([x, y + 1, z]); } if (L.work >= 0) { const [x, y, z] = xyzOf(G, L.work); tg.push([x, y + 1, z]); }
  focus(tg, (L.view0 | 0) & 3, true);
}
// ---------------------------------------------------------------- platform kenarı korkulukları
// Yükseltilmiş (y >= 1) karonun harita İÇİNDEKİ boş komşusuna (aşağı düşüş) bakan kenarı: sarı korkuluk. Merdiven,
// iskele, blok, ekipman ya da duvar komşusu açıklıktır (korkuluk yok). Harita dışı kenar = ada kenarı (korkuluk yok).
// Volti yalnız merdiven/iskeleyle kat değiştirir: korkuluk "buradan inilmez" demenin görsel dilidir.
function buildRails(L, SG) {
  if (!SG) return;
  const G = L.G, list = [];
  for (const c of L.tiles) {
    const [x, y, z] = xyzOf(G, c); if (y < 1) continue;
    for (let d = 0; d < 4; d++) {
      const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dz = d === 2 ? 1 : d === 3 ? -1 : 0;
      const q = G.idx(x + dx, y, z + dz); if (q < 0 || G.kind[q] !== 0) continue;
      const qu = G.idx(x + dx, y + 1, z + dz); if (qu >= 0 && G.kind[qu] !== 0 && G.kind[qu] !== 4) continue;
      list.push(x + dx * 0.47, y + 0.5, z + dz * 0.47, dx !== 0 ? 1 : 0);
    }
  }
  const nr = list.length / 4; D.railN = nr; if (!nr) return;
  const rm = new THREE.InstancedMesh(SG.rail(), instancedKitMaterial(), nr); rm.name = 'rails'; rm.frustumCulled = false; rm.matrixAutoUpdate = false;
  for (let i = 0; i < nr; i++) { m4.makeRotationY(list[i * 4 + 3] ? Math.PI / 2 : 0); m4.setPosition(list[i * 4], list[i * 4 + 1], list[i * 4 + 2]); rm.setMatrixAt(i, m4); }
  rm.instanceMatrix.needsUpdate = true; rm.userData.edges = Float32Array.from(list);
  D.rails = rm; PX.scene.root.add(rm); D.levelObjs.push(rm);
}
function stateOf(L, s, E, el) {
  const st = { closed: false, locked: false, live: false, earthed: false, charge: 0, blown: false, tripped: false };
  if (el.bit !== undefined) st.closed = !!((s.b >> el.bit) & 1);
  if (el.lk !== undefined && el.lk >= 0) st.locked = !!((s.lk >> el.lk) & 1);
  if (el.ei !== undefined) { const ed = L.edges[el.ei]; st.live = !!(E.live[ed.a] || E.live[ed.b]); st.earthed = !!(E.earthG[E.gal[ed.a]] || E.earthG[E.gal[ed.b]]); }
  else if (el.dugum !== undefined) { const nd = L.nodeIdx[el.dugum]; st.live = !!E.live[nd]; st.earthed = !!E.earthG[E.gal[nd]]; }
  if (el.t === 'toprak') st.earthed = st.closed;
  if (el.t === 'bara' && s.st === el.bi + 1) st.earthed = true;
  if (el.t === 'kondansator') st.charge = Math.floor(s.ch / Math.pow(4, el.ci)) % 4;
  if (el.t === 'sigorta') st.blown = !st.closed;
  if (el.t === 'kapi' && el.di !== undefined) { st.closed = !PX.SIM.doorOpen(L, s.b, s.lk, el.di); st.locked = st.closed; }
  return st;
}
function sync(s, E) {
  const L = D.L; if (!L) return;
  D.s = s;
  for (const r of D.eq) {
    const el = L.els[r.ei]; r.st = stateOf(L, s, E, el); r.st.tripped = el.t === 'kesici' && !r.st.closed && D.trip.has(r.ei);
    r.k.obj.visible = true; r.k.obj.scale.set(1, 1, 1); r.k.obj.position.set(r.x, r.y, r.z); r.k.obj.updateMatrix();
    try { r.k.setState(r.st); } catch (e) { console.error('[PX.KIT] setState', el.t, e); }
  }
  syncZones(s, E);
}
// ---------------------------------------------------------------- yaklaşma bölgeleri (R8; sim2.passMap ile aynı)
function zoneKind(L, s, E, ni, chargedGal) {
  let kind = -1;
  for (const h of L.hazards[ni]) {
    if (E.live[h.node]) return 0;
    if (h.cap >= 0) { if (Math.floor(s.ch / Math.pow(4, h.cap)) % 4 > 0 && kind < 0) kind = 2; continue; }
    if (!PX.SIM.rigidEarthed(L, s.b, s.st, h.node)) { kind = 1; continue; }
    if (chargedGal.indexOf(E.gal[h.node]) >= 0 && kind < 0) kind = 2;
  }
  return kind;
}
function syncZones(s, E) {
  const L = D.L, G = L.G; if (!D.zoneMesh) return;
  const pm = PX.SIM.passMap(L, E, s.b, s.st, s.ch, s.lk);
  const cg = []; L.caps.forEach((cp, i) => { if (Math.floor(s.ch / Math.pow(4, i)) % 4 > 0) cg.push(E.gal[cp.node]); });
  D.zoneCells.length = 0; D.zoneKinds.length = 0;
  const cnt = [0, 0, 0];
  const kindAt = new Int8Array(G.N).fill(-1);
  for (let ti = 0; ti < L.tiles.length; ti++) {
    if (pm[ti]) continue;
    if (L.doorAt && L.doorAt[ti] >= 0 && !PX.SIM.doorOpen(L, s.b, s.lk, L.doorAt[ti]) && !L.hazards[ti].length) continue;   // kapı kiti kilidi gösterir
    const c = L.tiles[ti]; let k = zoneKind(L, s, E, ti, cg); if (k < 0) k = 0;
    kindAt[c] = k; D.zoneCells.push(c); D.zoneKinds.push(ZK[k]);
    const [x, y, z] = xyzOf(G, c); m4.makeTranslation(x, y + 0.504, z);
    const zm = D.zoneMesh[ZK[k]]; zm.setMatrixAt(cnt[k]++, m4);
  }
  for (let k = 0; k < 3; k++) { const zm = D.zoneMesh[ZK[k]]; zm.count = cnt[k]; zm.visible = cnt[k] > 0; zm.instanceMatrix.needsUpdate = true; }
  // çit: bölge karosunun bölge dışı komşuya bakan kenarları
  const F = D.fence; let nf = 0;
  const FC = [PX.scene.col(0xff5a30), PX.scene.col(0xffc430), PX.scene.col(0x5ae6ff)];
  for (let i = 0; i < D.zoneCells.length; i++) {
    const c = D.zoneCells[i]; const [x, y, z] = xyzOf(G, c); const k = kindAt[c];
    for (let d = 0; d < 4; d++) {
      const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dz = d === 2 ? 1 : d === 3 ? -1 : 0;
      const q = G.idx(x + dx, y, z + dz);
      if (q >= 0 && kindAt[q] >= 0) continue;
      m4.makeRotationY(dz !== 0 ? 0 : Math.PI / 2); m4.setPosition(x + dx * 0.47, y + 0.5, z + dz * 0.47);
      F.setMatrixAt(nf, m4); F.setColorAt(nf, FC[k]); nf++;
    }
  }
  F.count = nf; F.visible = nf > 0; F.instanceMatrix.needsUpdate = true; if (F.instanceColor) F.instanceColor.needsUpdate = true;
}
function zones() { const o = []; for (let i = 0; i < D.zoneCells.length; i++) o.push({ cell: D.zoneCells[i], kind: D.zoneKinds[i] }); return o; }
// ---------------------------------------------------------------- vurgular ve FX
function highlight(c, kind, onlyIf) {
  kind = kind || 'hedef'; const h = D.hl[kind]; if (!h) return;
  if (c < 0 || !D.L) {
    if (onlyIf !== undefined && onlyIf !== h.cell) return;
    h.mesh.visible = false; h.cell = -1; return;
  }
  if (kind === 'hedef' && h.cell >= 0 && h.cell !== c && h.mesh.visible) {      // değiştirilen hedef halkası 120 ms söner
    const p = h.mesh.position; PX.fx.ring(p.x, p.y, p.z, 'eski');
  }
  const [x, y, z] = xyzOf(D.L.G, c); h.mesh.position.set(x, y + 0.506, z); h.mesh.visible = true; h.cell = c;
}
// cihaz vuruşu: kit sözleşmesi obj.scale'i DAİMA 1 tutar (drawnScale eşliği); vuruş kitin kendi act() kanalında
function pulse(ei, kind) {
  const i = D.byCell && D.L && D.L.els[ei] && D.L.els[ei].cell >= 0 ? D.byCell[D.L.els[ei].cell] : -1; if (i < 0) return;
  const r = D.eq[i];
  if (r.k.act) { try { r.k.act(kind === 'press' ? 'press' : 'op'); } catch (e) { console.error('[PX.KIT] act', e); } }
}
// lastik bant neden çizgisi (§12.1): Volti'nin gövdesini örtecek küpler kırmızı taralı kabukla gösterilir
const COVER_N = 24;
function cover(cells) {
  const m = D.cover; if (!m) return;
  let n = 0;
  if (cells && D.L) {
    const G = D.L.G;
    for (let i = 0; i < cells.length && n < COVER_N; i++) {
      const c = cells[i]; if (typeof c !== 'number' || c < 0 || c >= G.N || !G.kind[c]) continue;
      m4.makeScale(1.04, 1.04, 1.04); m4.setPosition(c % G.W, Math.floor(c / G.W) % G.H, Math.floor(c / (G.W * G.H)));
      m.setMatrixAt(n++, m4);
    }
  }
  m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true;
}
// koruma açması kalıcı gösterimi (§7.1 Röle Bayrağı, §24.2 'tripped'): korumanın açtığı kesici, bir sonraki elle
// işlemine kadar açtı mimiği/bayrağıyla (BRK_T/FLAG_T) çizilir (tek hat paneliyle aynı kural). Küme sunumdan beslenir:
// vuruşta (tripFx) ve 'anim:step'te eklenir, o elemana 'op' siler; baştan/yükleme temizler; geri al, sunulmuş geçmişi
// sim2 ile yeniden oynatıp kurar (geri alınan bir kapamanın altındaki açma geri gelir).
function tripAdd(ids) {
  const L = D.L; if (!L || !ids || !ids.length) return;
  for (const id of ids) { const ei = typeof id === 'number' ? id : L.elIndex[id]; if (ei !== undefined) { D.trip.add(ei); D.tripAny = true; } }
  retrip();
}
function retrip() {
  if (!D.L) return;
  for (const r of D.eq) {
    if (!r.st || D.L.els[r.ei].t !== 'kesici') continue;
    const t = !r.st.closed && D.trip.has(r.ei);
    if (t !== r.st.tripped) { r.st.tripped = t; try { r.k.setState(r.st); } catch (e) { console.error('[PX.KIT] setState', e); } }
  }
}
function tripRebuild() {
  const L = D.L, g = PX.game, SIM = PX.SIM; if (!L || !g || !g.state || !g.tokens) return;
  const st = g.state(); const n = st.hist - st.queue - (st.busy ? 1 : 0);
  const toks = g.tokens().split(' '); let s = SIM.initState(L); D.trip.clear();
  for (let i = 0; i < n && i < toks.length; i++) {
    const a = SIM.decodeAct(L, s, toks[i]); const r = a && SIM.apply(L, s, a); if (!r || r.err) break;
    if (a.t === 'op') D.trip.delete(a.e);
    if (r.trips) for (const e of r.trips) D.trip.add(e);
    s = r.s;
  }
  retrip();
}
function tripFx(ids) {
  const L = D.L; if (!L) return;
  tripAdd(ids);
  for (const id of ids) {
    const ei = typeof id === 'number' ? id : L.elIndex[id]; const el = L.els[ei]; if (!el || el.cell < 0) continue;
    const [x, y, z] = xyzOf(L.G, el.cell); PX.fx.ring(x, y + 0.5, z, 'ret'); PX.fx.burst(x, y + 0.6, z, 10, 'pof');
  }
}
function onReject(p) {
  if (!p || !D.L || PX.render.instant) return;
  const G = D.L.G;
  const ring = c => { if (typeof c !== 'number' || c < 0 || c >= G.N) return; const [x, y, z] = xyzOf(G, c); PX.fx.ring(x, y + 0.5, z, 'ret'); };
  if (p.cells) for (const c of p.cells) ring(c);
  // açıklamalı ret (sim2.explain): engel hücreleri kısa süre kırmızı taralı kabukla (lastik bant dili) gösterilir
  if (p.reason && p.cells && p.cells.length) { cover(p.cells); clearTimeout(D.coverT); D.coverT = setTimeout(() => cover(null), 1400); }
}
function onHint(p) {
  const L = D.L; if (!L || !p || !p.acts || !p.acts.length || !PX.game || !PX.game.state) return;
  let a = null; try { a = PX.SIM.decodeAct(L, PX.game.state().s, p.acts[0]); } catch (e) { a = null; }
  if (!a) return;
  const c = a.e !== undefined ? (L.els[a.e] ? L.els[a.e].cell : -1) : a.t === 'git' ? a.to : a.t === 'calis' ? L.work : -1;
  if (c >= 0) highlight(c, 'ipucu');
}
function update(dt) {
  D.hlT += dt;
  fadeUpdate(dt);
  const h = D.hl.hedef; if (h && h.mesh.visible) { const s = 1 + 0.08 * Math.sin(D.hlT * 6.5); h.mesh.scale.set(s, 1, s); }
  const q = D.hl.ipucu; if (q && q.mesh.visible) { q.mesh.material.opacity = 0.6 + 0.3 * Math.sin(D.hlT * 4); }
}
function tileTop(c) { return D.L ? Math.floor(c / D.L.G.W) % D.L.G.H + 0.5 : 0; }
function cellPos(c, out) { const G = D.L.G; return out.set(c % G.W, Math.floor(c / G.W) % G.H, Math.floor(c / (G.W * G.H))); }
function drawnScale(c) {
  if (!D.L || c < 0) return 0;
  const i = D.byCell ? D.byCell[c] : -1;
  if (i >= 0) { const o = D.eq[i].k.obj; return o.visible && o.parent ? o.scale.x : 0; }
  return D.L.G.kind[c] === 1 && D.blocks && D.blocks.parent ? 1 : 0;
}
function elState(ei) { for (const r of D.eq) if (r.ei === ei) return r.st; return null; }

// ---------------------------------------------------------------- örtücü saydamlığı (§25, sim2.occluders)
// Örnekli kümeler (bloklar, duvarlar): opak örnek sıfır ölçeğe alınır, aynı matris yarı saydam "hayalet" kopyada çizilir
// (örnek başına aFade özniteliği, depthWrite kapalı). Kit nesneleri (ekipman, merdiven, kapı): nesne başına tembel
// oluşturulan saydam malzeme kopyası (aynı program). Geçiş FADE_T; kare başına iş yalnız geçiş sürerken.
const FADE_A = 0.26, FADE_T = 0.12;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function fadeShader(sh) {
  sh.vertexShader = 'attribute float aFade;\nvarying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFade = aFade;');
  sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vFade );');
}
function addInstSet(src, mat) {
  const n = Math.max(1, src.count);
  const g = src.geometry.clone(); g.userData = {};
  const a = new Float32Array(n).fill(1);
  const fa = new THREE.InstancedBufferAttribute(a, 1); fa.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aFade', fa);
  const gm = mat.clone(); gm.transparent = true; gm.depthWrite = false; gm.onBeforeCompile = fadeShader; gm.userData = {};
  gm.customProgramCacheKey = () => 'pxfade';
  const ghost = new THREE.InstancedMesh(g, gm, n); ghost.name = src.name + '-fade'; ghost.frustumCulled = false; ghost.matrixAutoUpdate = false;
  ghost.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ghost.renderOrder = 6; ghost.userData.noShadow = true;
  for (let i = 0; i < n; i++) ghost.setMatrixAt(i, ZERO);
  if (src.instanceColor) { ghost.instanceColor = new THREE.InstancedBufferAttribute(src.instanceColor.array.slice(), 3); }
  ghost.count = src.count; ghost.visible = false;                         // saydam örnek yokken çizim çağrısı yok
  PX.scene.root.add(ghost); D.levelObjs.push(ghost);
  const set = { src, ghost, fa, a, tgt: new Uint8Array(n), mats: new Float32Array(n * 16) };
  for (let i = 0; i < src.count; i++) src.getMatrixAt(i, m4), m4.toArray(set.mats, i * 16);
  D.inst.sets.push(set); return D.inst.sets.length - 1;
}
// odak hedefleri -> örtücü kümesi. v verilmezse kameranın yakın görünümü. Yalnız olay anında (ayırma serbest).
function camView() { const C = PX.camera; if (!C) return 0; if (C.viewOfAz && typeof C.az === 'number') return C.viewOfAz(C.az); return (C.v | 0) & 3; }
function focus(targets, v, force) {
  const F = D.fade, L = D.L; if (!F || !L) return;
  F.targets = targets ? targets.slice() : []; F.v = -1;
  applyFocus(v === undefined || v === null ? camView() : v & 3, force);
}
function applyFocus(v, force) {
  const F = D.fade, L = D.L; if (!F || !L || (!force && v === F.v)) return;
  F.v = v;
  let cells = [];
  try { cells = PX.SIM.occluders ? PX.SIM.occluders(L, v, F.targets || []) : []; } catch (e) { cells = []; }
  const next = new Set(cells);
  for (const c of F.cells) if (!next.has(c)) setFaded(c, false, force);
  for (const c of next) if (!F.cells.has(c)) setFaded(c, true, force);
  F.cells = next;
}
function setFaded(c, on, snap) {
  const L = D.L, F = D.fade; const instant = snap || (PX.render && PX.render.instant);
  const si = D.inst.set[c];
  if (si >= 0) {
    const S = D.inst.sets[si], i = D.inst.idx[c];
    S.tgt[i] = on ? 1 : 0;
    if (on) { S.src.setMatrixAt(i, ZERO); m4.fromArray(S.mats, i * 16); S.ghost.setMatrixAt(i, m4); S.src.instanceMatrix.needsUpdate = true; S.ghost.instanceMatrix.needsUpdate = true; S.ghost.visible = true; }
    if (instant) { S.a[i] = on ? FADE_A : 1; S.fa.needsUpdate = true; if (!on) unghost(S, i); }
    F.anim = true; return;
  }
  const r = D.objAt[c]; if (!r) return;
  const o = r.k.obj; r.tgt = on ? FADE_A : 1;
  if (on) {
    if (!r.gm) { r.gm = o.material.clone(); r.gm.transparent = true; r.gm.depthWrite = false; r.gm.userData = {}; r.base = o.material; F.ghostMats.push(r.gm); }
    o.material = r.gm; o.renderOrder = 6;
  }
  if (instant) { r.a = r.tgt; if (r.gm) r.gm.opacity = r.a; if (!on) { o.material = r.base || o.material; o.renderOrder = 0; } }
  F.anim = true;
  void L;
}
function unghost(S, i) {
  S.ghost.setMatrixAt(i, ZERO); m4.fromArray(S.mats, i * 16); S.src.setMatrixAt(i, m4); S.src.instanceMatrix.needsUpdate = true; S.ghost.instanceMatrix.needsUpdate = true;
  let any = false; for (let j = 0; j < S.a.length && !any; j++) if (S.tgt[j] || S.a[j] < 1) any = true;
  S.ghost.visible = any;
}
function fadeUpdate(dt) {
  const F = D.fade; if (!F || !D.L) return;
  const v = camView(); if (v !== F.v && F.targets) applyFocus(v, false);
  if (!F.anim) return;
  const st = dt * (1 - FADE_A) / FADE_T; let any = false;
  for (let s = 0; s < D.inst.sets.length; s++) {
    const S = D.inst.sets[s]; let ch = false;
    for (let i = 0; i < S.a.length; i++) {
      const want = S.tgt[i] ? FADE_A : 1, a = S.a[i]; if (a === want) continue;
      const na = a < want ? Math.min(want, a + st) : Math.max(want, a - st); S.a[i] = na; ch = true;
      if (na !== want) any = true; else if (!S.tgt[i]) unghost(S, i);
    }
    if (ch) S.fa.needsUpdate = true;
  }
  if (fadeObjs(D.eq, st)) any = true;
  if (fadeObjs(D.structs, st)) any = true;
  F.anim = any;
}
function fadeObjs(list, st) {
  let any = false;
  for (let i = 0; i < list.length; i++) {
    const r = list[i]; if (!r.gm || r.a === r.tgt) continue;
    r.a = r.a < r.tgt ? Math.min(r.tgt, r.a + st) : Math.max(r.tgt, r.a - st); r.gm.opacity = r.a;
    if (r.a !== r.tgt) any = true; else if (r.tgt >= 1) { r.k.obj.material = r.base; r.k.obj.renderOrder = 0; }
  }
  return any;
}
function fadedSet() { return D.fade ? D.fade.cells : null; }
// ÇİZİLEN nesnelerden yürünebilir yüzeyler: blok örneği (sıfır ölçekli değilse) ve üstündeki hücrede çizilmiş katı
// nesne (blok/duvar örneği, ekipman ya da merdiven kiti) yoksa karo. Mantık tablosu (L.tiles) okunmaz.
function walkableDrawn() {
  const L = D.L; if (!L || !D.blocks) return { tiles: [], stairs: [], ladders: [], doors: [], rails: 0 };
  const G = L.G; const solid = new Uint8Array(G.N);
  for (const S of D.inst.sets) { const cells = S.src.userData.cells; if (!cells) continue; for (let i = 0; i < cells.length; i++) solid[cells[i]] = 1; }
  const doors = [];
  for (const r of D.eq) { const el = L.els[r.ei]; if (el.t === 'kapi') { if (r.k.obj.parent) doors.push(el.id); continue; } if (r.k.obj.parent) solid[r.cell] = 1; }
  const stairs = [], ladders = [];
  for (const r of D.structs) { if (!r.k.obj.parent) continue; if (r.kind === 'merdiven') { solid[r.cell] = 1; stairs.push(r.cell); } else { const ld = L.ladders.find(x => x.cells[0] === r.cell); ladders.push(ld ? ld.cells.slice() : [r.cell]); } }
  const tiles = []; const bc = D.blocks.userData.cells;
  for (let i = 0; i < bc.length; i++) { const c = bc[i]; const [x, y, z] = xyzOf(G, c); const u = G.idx(x, y + 1, z); if (u < 0 || !solid[u]) tiles.push(c); }
  tiles.sort((a, b) => a - b);
  return { tiles, stairs, ladders, doors, rails: D.railN };
}

// ---------------------------------------------------------------- kimlik tamponu (parity, §20.1)
const ID_RES = 640;
function idPass() {
  if (D.idp) return D.idp;
  const vs = 'attribute float aId; varying float vId; varying float vTop;\n' +
    'void main(){ vId = aId; vec4 wp = vec4(position,1.0); vec3 n = normal;\n' +
    '#ifdef USE_INSTANCING\n wp = instanceMatrix * wp; n = mat3(instanceMatrix) * normal;\n#endif\n' +
    ' vTop = n.y > 0.5 ? 1.0 : 0.0; gl_Position = projectionMatrix * modelViewMatrix * wp; }';
  const fs = 'varying float vId; varying float vTop;\n' +
    'void main(){ float id = floor(vId + 0.5); gl_FragColor = vec4(mod(id,256.0)/255.0, floor(id/256.0)/255.0, vTop, 1.0); }';
  const mat = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, toneMapped: false });
  const rt = new THREE.WebGLRenderTarget(ID_RES, ID_RES, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
  D.idp = { mat, rt, scene: new THREE.Scene(), cam: null, buf: new Uint8Array(ID_RES * ID_RES * 4), clr: new THREE.Color() };
  return D.idp;
}
function drawnTiles(v) {
  const L = D.L, r = PX.scene.renderer; if (!L || !r || !D.blocks) return [];
  const P = idPass(); const G = L.G;
  // çizilen veriden vekil sahne: blok + duvar örnek matrisleri (saydamlaştırılmışlar özgün matrisiyle) + ekipman/merdiven
  const ext = []; for (const r of D.eq) if (L.els[r.ei].t !== 'kapi') ext.push(r); for (const r of D.structs) if (r.kind === 'merdiven') ext.push(r);
  let nb = 0; for (const S of D.inst.sets) nb += S.src.count;
  const ne = ext.length, n = nb + ne;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const ids = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(geo, P.mat, Math.max(1, n)); mesh.frustumCulled = false;
  let o = 0;
  for (const S of D.inst.sets) { const cells = S.src.userData.cells; for (let i = 0; i < S.src.count; i++) { ids[o] = cells[i] + 1; mesh.instanceMatrix.array.set(S.mats.subarray(i * 16, i * 16 + 16), o * 16); o++; } }
  for (let j = 0; j < ne; j++) { ids[o] = ext[j].cell + 1; const [x, y, z] = xyzOf(G, ext[j].cell); m4.makeTranslation(x, y, z); m4.toArray(mesh.instanceMatrix.array, o * 16); o++; }
  geo.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
  P.scene.add(mesh);
  P.cam = PX.camera.viewCamera(v, P.cam);
  const prevRT = r.getRenderTarget(); r.getClearColor(P.clr); const prevA = r.getClearAlpha(); const prevSh = r.shadowMap.enabled;
  r.shadowMap.enabled = false;
  r.setRenderTarget(P.rt); r.setClearColor(0x000000, 0); r.clear(true, true, false);
  r.render(P.scene, P.cam);
  r.readRenderTargetPixels(P.rt, 0, 0, ID_RES, ID_RES, P.buf);
  r.setRenderTarget(prevRT); r.setClearColor(P.clr, prevA); r.shadowMap.enabled = prevSh;
  P.scene.remove(mesh); geo.dispose(); mesh.dispose();
  // her karo: iki üst üçgen × 4 örnek (ağırlık merkezi + köşelere %60) aynı hücrenin ÜST yüzü olmalı
  const sx = PX.SIM.VIEWS[v][0], sz = PX.SIM.VIEWS[v][1]; const out = [];
  const T1 = [[0, 0], [0, 1], [1, 1]], T0 = [[0, 0], [1, 0], [1, 1]];          // (fa,fb) köşeleri: t1 fa≤fb, t0 fa≥fb
  for (const c of L.tiles) {
    const [x, y, z] = xyzOf(G, c); const Y = y + 0.5; const U = sx * x - y - 1, V = sz * z - y - 1;
    let ok = true;
    for (const tri of [T1, T0]) {
      const ca = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cb = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      for (let k = -1; k < 3 && ok; k++) {
        const fa = k < 0 ? ca : ca + 0.6 * (tri[k][0] - ca), fb = k < 0 ? cb : cb + 0.6 * (tri[k][1] - cb);
        const A = U + fa, Bv = V + fb;
        v3.set(sx * (A + Y), Y, sz * (Bv + Y)).project(P.cam);
        const px = Math.floor((v3.x + 1) / 2 * ID_RES), py = Math.floor((v3.y + 1) / 2 * ID_RES);
        if (px < 0 || py < 0 || px >= ID_RES || py >= ID_RES) { ok = false; break; }
        const o = (py * ID_RES + px) * 4; const id = P.buf[o] + 256 * P.buf[o + 1] - 1; const top = P.buf[o + 2] > 127;
        if (id !== c || !top) ok = false;
      }
      if (!ok) break;
    }
    if (ok) out.push(c);
  }
  return out;
}
function sharedTextures() { const S = D.shared; if (!S) return []; const o = [S.blockMat.map, S.workMat.map]; for (const k in S.zoneMat) o.push(S.zoneMat[k].map); if (D.cover) o.push(D.cover.material.map); return o; }
Object.assign(D, { init, build, sync, update, tileTop, cellPos, highlight, pulse, tripFx, drawnScale, drawnTiles, elState, clear, zones, cover, sharedTextures,
  focus, fadedSet, walkableDrawn });
PX.diorama = D;
