// ============================================================================
// render/volti.js — PX.volti : Volti rig v2, sürekli yol izleyici, klipler, hayalet (§15, §12.3, §12.6, §24.3)
//                                                                               sahip: Animasyon (volti)
// KESİN KURAL (kural sürümü 4, fiziksel dünya): ayak noktası (root.position) HER karede gerçek bir yüzeydedir:
// karoda karo üstü (y+0.5), merdivende eğik yürüme düzlemi (basamak ortalarından geçer; her ayak bir basamağa basar),
// iskelede basamak çubuğu (dikey tırmanma, yüz duvara dönük). Volti hiç sıçramaz, ışınlanmaz, kat değiştirmek için
// yalnız merdiven ve iskele kullanır (probe().arc daima false). Kamera yalnız görseldir: yürüyüşe hiç karışmaz.
//
//   PX.volti.init()  .setLevel(L, s)  .place(cell, v, s?)  .update(dt)
//   PX.volti.followPath(list, {rate?, chain?, steps?}) -> Promise<{cancelled, retarget?}>   list = sim2.walkPath adımları
//        [{c, k:'karo'|'merdiven'|'iskele', …}] ya da KARO hücreleri (ardışık ikisi fiziksel komşu: L.adj); list[0] =
//        Volti'nin karosu. Yürürken yeniden çağrılabilir: list[0] === legEnd() ise o anki bacak durmadan biter, hız/faz
//        korunur, önceki Promise {cancelled:true, retarget:true} ile çözülür.
//        opts.chain = true: bir önceki yürüyüş az önce bu karoda bitti (ardışık ok tuşu adımları) — hızlanma/çömelme yok.
//   PX.volti.legEnd() -> cell | -1     sürmekte olan bacağın bittiği karo (Volti'nin şu an doğru yürüdüğü karo)
//   PX.volti.retarget(cells) -> bool   cells[0] === legEnd(): o anki bacak durmadan biter, yolun kalanı cells olur
//        (merdiven/iskele dahil); açık followPath Promise'i yeni sonda {cancelled:false} ile çözülür. Olmazsa false.
//   PX.volti.moving (salt okunur)
//   PX.volti.play(clip, opts) -> Promise<{cancelled}>
//        klipler: operate lock unlock earth fuse press work wait (+ overlay: reject win spawn idle)
//        opts: {el: elIdx, step} — step = controller adımı (before/after/a/c/trips) → cihaz tipi, aç/kapa yönü
//   PX.volti.timing(clip, opts) -> {dur, beat} (s): play() ile aynı seçim; beat = cihazın döneceği vuruş anı
//   PX.volti.cancel()      yol + klip + kutlama iptal (Promise'ler {cancelled:true}); poz yumuşakça dinlenir
//   PX.volti.probe() -> {x,y,z, footY, groundY, cell, arc, moving, mode, tile}   (önceden ayrılmış nesne)
//        mode: 'karo' | 'merdiven' (footY = eğik düzlem) | 'iskele' (tırmanıyor: ayaklar basamak çubuklarında);
//        cell = o anki düğüm (karo ya da merdiven/iskele hücresi), tile = son karo
//   PX.volti.root          ayak noktası grubu (THREE.Group)
//   PX.volti.ghost(on, opts?) -> hayalet rig API'si {place, followPath, play, cancel, probe, visible}
//   PX.volti.setCosmetic({kask})  .setVisorDamage(0..1)  .info() -> {drawCalls, tris, bones}
// Olay: 'anim:beat' {kind, el, tok, a, before, after, beat} — klibin vuruş anında (kola basış, kilit, kelepçe);
//   render/kit cihazı bu anda döndürebilir (sunum, mantığın önüne geçmez: adım zaten kabul edilmiş).
// Bellek: kare döngüsünde ayırma yok (tüm geçiciler modül düzeyinde, poz tamponları Float32Array).
// Çizim: Volti = 3 çizim çağrısı (gövde SkinnedMesh + parıltı SkinnedMesh + blob gölge); hayalet +2.
// ============================================================================
const VIEWS = PX.SIM.VIEWS;
const PI = Math.PI, TAU = PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const ramp = (k, a, b) => sstep((k - a) / (b - a));
function env(k, a, b, c, d) { if (k <= a || k >= d) return 0; if (k < b) return sstep((k - a) / (b - a)); if (k <= c) return 1; return 1 - sstep((k - c) / (d - c)); }
const bump = (k, a, b) => (k <= a || k >= b ? 0 : Math.sin(PI * (k - a) / (b - a)));

// ------------------------------------------------------------------ hareket sabitleri (§12.3)
const SPEED0 = 4.5, SPEED_MAX = 7.0, RAMP_T = 0.15, ACCEL = (SPEED_MAX - SPEED0) / RAMP_T, LONG_PATH = 3;
const BRAKE_T = 0.12;                 // yol sonu yavaşlama süresi
const YAW_W = 68;                     // kritik sönümlü yaw yayı, ~70 ms yerleşme
const STRIDE = 0.115, STRIDE_MAX = 0.17, CAD_MAX = 12;   // doğal yarım adım genliği (karo), genlik üst sınırı, rahat adım/s
const FILLET = 0.28;                  // köşe yuvarlama teğet uzunluğu (karonun içinde kalır: < 0.5)
const MAXP = 4096;                    // yoğun yol noktası sınırı

// ------------------------------------------------------------------ iskelet (dinlenme: kök = ayak noktası, +z ileri, +x Volti'nin solu)
const LEG1 = 0.13, LEG2 = 0.13, ANKLE = 0.05, HIP_X = 0.07, HIP_Y = -0.02, PELVIS_Y = 0.33;
const ARM1 = 0.11, ARM2 = 0.10, HANDC = 0.035, EXT_MAX = 0.16;
const BONES = [
  ['root', -1, 0, 0, 0], ['pelvis', 0, 0, PELVIS_Y, 0], ['spine', 1, 0, 0.05, 0], ['head', 2, 0, 0.2, 0],
  ['helmet', 3, 0, 0.185, 0], ['eyeL', 3, 0.044, 0.108, 0.127], ['eyeR', 3, -0.044, 0.108, 0.127], ['ant', 4, -0.055, 0.15, -0.05],
  ['uarmL', 2, 0.165, 0.155, 0], ['farmL', 8, 0, -ARM1, 0], ['handL', 9, 0, -ARM2, 0],
  ['uarmR', 2, -0.165, 0.155, 0], ['farmR', 11, 0, -ARM1, 0], ['handR', 12, 0, -ARM2, 0],
  ['thighL', 1, HIP_X, HIP_Y, 0], ['shinL', 14, 0, -LEG1, 0], ['footL', 15, 0, -LEG2, 0],
  ['thighR', 1, -HIP_X, HIP_Y, 0], ['shinR', 17, 0, -LEG1, 0], ['footR', 18, 0, -LEG2, 0],
  ['pDet', 13, 0, -0.03, 0], ['pTab', 10, 0, -0.035, 0.02], ['pLock', 13, 0, -0.045, 0.012], ['pClamp', 13, 0, -0.04, 0],
  ['pPull', 13, 0, -0.035, 0], ['pWrench', 13, 0, -0.035, 0],
  ['bkDet', 2, 0.035, 0.11, -0.112], ['bkSet', 2, -0.02, 0.06, -0.118],
];
// kemerde asma kilitler (sağ kalça boyunca) ve yedek NH bıçakları (sol kalça cebi)
for (let i = 0; i < 5; i++) { const th = 0.45 + i * 0.36; BONES.push(['belt' + i, 1, -0.138 * Math.sin(th), -0.032, 0.104 * Math.cos(th)]); }
BONES.push(['fuse0', 1, 0.128, -0.022, -0.012], ['fuse1', 1, 0.128, -0.022, 0.03]);
const NB = BONES.length;
const B = {}; BONES.forEach((b, i) => { B[b[0]] = i; });
const BW = []; BONES.forEach((b, i) => { const p = b[1] >= 0 ? BW[b[1]] : [0, 0, 0]; BW.push([p[0] + b[2], p[1] + b[3], p[2] + b[4]]); });

// ------------------------------------------------------------------ poz tamponu düzeni
// [0, 3·NB): kemik başına Euler (x,y,z); ardından ekstralar
let XI = NB * 3;
const X = {};
for (const n of ['pelY', 'pelZ', 'pelX', 'flx', 'fly', 'flz', 'flp', 'frx', 'fry', 'frz', 'frp',
  'ikL', 'ikLx', 'ikLy', 'ikLz', 'ikR', 'ikRx', 'ikRy', 'ikRz', 'eye', 'eyeX', 'glow',
  'det', 'tab', 'lock', 'clamp', 'pull', 'wrench', 'beltD', 'fuseD', 'setD', 'stepF']) X[n] = XI++;
const NPOSE = XI;

// ------------------------------------------------------------------ geçiciler (ayırmasız kare döngüsü)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _m1 = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);
const KO = new Float32Array(4), KO2 = new Float32Array(4);

// ------------------------------------------------------------------ renkler (sRGB hex; köşe renginde doğrusala çevrilir)
const COL = {
  navy: 0x24375e, navyD: 0x1a2a4a, vest: 0xff7a1a, vestD: 0xe2620c, helmet: 0xf3f5f8, red: 0xdc1f28, cyan: 0x2bb5e8,
  graph: 0x2a3242, graphL: 0x46526a, black: 0x1b1e25, sole: 0x3a3f49, silver: 0xb9c3cf, steel: 0x8e99a8,
  glove: 0xd8262e, gloveCuff: 0xf2c21b, yellow: 0xffcc1a, green: 0x1f9d48, lock: 0xd8232a, tag: 0xff8c1a,
  ceramic: 0xeeeae0, brown: 0x4a3a2c, white: 0xffffff, eye: 0x5cf0ff, lamp: 0xfff1c0, amber: 0xffb020, stripe: 0xdfe8ef,
  screen: 0x64e6ff, led: 0xff3b3b,
};
const KASK = { beyaz: 0xf3f5f8, sari: 0xffcf1f, kirmizi: 0xdc1f28, mavi: 0x2b8fe0, turuncu: 0xff8a1c, yesil: 0x2fb35a };

// ------------------------------------------------------------------ doku atlası (parıltı malzemesi)
// 256×256: vizör camı (0..128, 0..64) çatlaklı; düz beyaz (192..256, 0..32); sırt yaması VOLTGUARD (0..256, 64..112);
// isim etiketi VOLTİ (0..128, 112..144); tablet ekranı (128..256, 112..192). flipY: v = 1 - y/256.
const UV = { visor: [0, 0.75, 0.5, 1], logo: [0, 0.5625, 1, 0.75], name: [0, 0.4375, 0.5, 0.5625], tab: [0.5, 0.25, 1, 0.5625] };
const WU = 0.875, WV = 1 - 16 / 256;
let atlas = null, atlasCtx = null, atlasDamage = -1;
function drawAtlas(damage) {
  const c = atlasCtx; if (!c) return;
  damage = clamp(damage, 0, 1);
  // vizör camı
  const g = c.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#20344f'); g.addColorStop(0.55, '#0c1626'); g.addColorStop(1, '#16263c');
  c.fillStyle = g; c.fillRect(0, 0, 128, 64);
  c.fillStyle = 'rgba(160,220,255,0.18)'; c.beginPath(); c.moveTo(10, 6); c.lineTo(46, 6); c.lineTo(30, 24); c.lineTo(6, 24); c.fill();
  if (damage > 0.01) {
    // çatlak: ışık kırığı (açık mavi-beyaz), perde ilerledikçe söner
    c.strokeStyle = 'rgba(235,248,255,' + (0.85 * damage).toFixed(3) + ')'; c.lineWidth = 1.6; c.lineCap = 'round';
    const pts = [[88, 8, 78, 22, 84, 34, 74, 52], [78, 22, 98, 30, 112, 26], [84, 34, 100, 44, 106, 58], [74, 52, 60, 58], [88, 8, 96, 2]];
    const n = Math.max(1, Math.round(pts.length * damage));
    for (let i = 0; i < n; i++) { const p = pts[i]; c.beginPath(); c.moveTo(p[0], p[1]); for (let j = 2; j < p.length; j += 2) c.lineTo(p[j], p[j + 1]); c.stroke(); }
    c.fillStyle = 'rgba(235,248,255,' + (0.7 * damage).toFixed(3) + ')'; c.beginPath(); c.arc(88, 8, 2.5, 0, TAU); c.fill();
  }
  atlasDamage = damage;
  if (atlas) atlas.needsUpdate = true;
}
function makeAtlas() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const c = atlasCtx = cv.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, 256, 256);
  // sırt yaması
  c.fillStyle = '#f7f9fb'; c.fillRect(0, 64, 256, 48);
  c.fillStyle = '#1a2a4a'; c.fillRect(0, 64, 256, 4); c.fillRect(0, 108, 256, 4);
  c.font = 'bold 34px Arial, Helvetica, sans-serif'; c.textBaseline = 'middle';
  const w1 = c.measureText('VOLT').width, w2 = c.measureText('GUARD').width; const x0 = (256 - w1 - w2) / 2;
  c.fillStyle = '#e8101a'; c.fillText('VOLT', x0, 89); c.fillStyle = '#1ea7dc'; c.fillText('GUARD', x0 + w1, 89);
  // isim etiketi
  c.fillStyle = '#1a2a4a'; c.fillRect(0, 112, 128, 32); c.fillStyle = '#ffffff'; c.font = 'bold 22px Arial, Helvetica, sans-serif';
  c.textAlign = 'center'; c.fillText('VOLTİ', 64, 129); c.textAlign = 'left';
  // tablet ekranı: küçük tek hat şeması
  c.fillStyle = '#0d2238'; c.fillRect(128, 112, 128, 80);
  c.strokeStyle = '#64e6ff'; c.lineWidth = 3; c.beginPath(); c.moveTo(140, 130); c.lineTo(244, 130); c.moveTo(160, 130); c.lineTo(160, 176); c.moveTo(212, 130); c.lineTo(212, 176); c.stroke();
  c.fillStyle = '#44e08a'; c.fillRect(154, 146, 12, 12); c.fillStyle = '#ff4d5e'; c.fillRect(206, 146, 12, 12);
  c.fillStyle = '#ffffff'; c.fillRect(192, 0, 64, 32);
  atlas = new THREE.CanvasTexture(cv); atlas.encoding = THREE.sRGBEncoding; atlas.anisotropy = 2;
  drawAtlas(1);
  return atlas;
}
function makeShadowTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

// ------------------------------------------------------------------ geometri kurucu (yalnız init)
function builder() { return { p: [], n: [], c: [], u: [], s: [], i: [], v: 0 }; }
const _bm = new THREE.Matrix4(), _bn = new THREE.Matrix3(), _bq = new THREE.Quaternion(), _be = new THREE.Euler(), _bs = new THREE.Vector3(), _bp = new THREE.Vector3(), _bt = new THREE.Vector3(), _bc = new THREE.Color();
// part: geo (BufferGeometry), bone, renk hex, o = {p:[dx,dy,dz] kemiğe göre, r:[rx,ry,rz], s:[sx,sy,sz], uv:[u0,v0,u1,v1]}
function part(bd, geo, bone, hex, o) {
  o = o || {};
  _be.set(o.r ? o.r[0] : 0, o.r ? o.r[1] : 0, o.r ? o.r[2] : 0); _bq.setFromEuler(_be);
  const bw = BW[bone]; _bp.set(bw[0] + (o.p ? o.p[0] : 0), bw[1] + (o.p ? o.p[1] : 0), bw[2] + (o.p ? o.p[2] : 0));
  _bs.set(o.s ? o.s[0] : 1, o.s ? o.s[1] : 1, o.s ? o.s[2] : 1);
  _bm.compose(_bp, _bq, _bs); _bn.getNormalMatrix(_bm);
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  _bc.setHex(hex).convertSRGBToLinear();
  const base = bd.v;
  for (let k = 0; k < pos.count; k++) {
    _bt.fromBufferAttribute(pos, k).applyMatrix4(_bm); bd.p.push(_bt.x, _bt.y, _bt.z);
    _bt.fromBufferAttribute(nor, k).applyMatrix3(_bn).normalize(); bd.n.push(_bt.x, _bt.y, _bt.z);
    bd.c.push(_bc.r, _bc.g, _bc.b);
    if (o.uv && uv) bd.u.push(o.uv[0] + uv.getX(k) * (o.uv[2] - o.uv[0]), o.uv[1] + uv.getY(k) * (o.uv[3] - o.uv[1]));
    else bd.u.push(WU, WV);
    bd.s.push(bone);
  }
  if (geo.index) { const ix = geo.index.array; for (let k = 0; k < ix.length; k++) bd.i.push(base + ix[k]); }
  else for (let k = 0; k < pos.count; k++) bd.i.push(base + k);
  bd.v += pos.count;
  geo.dispose();
  return [base, bd.v];
}
function finish(bd) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(bd.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(bd.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(bd.c, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(bd.u, 2));
  const si = new Uint16Array(bd.v * 4), sw = new Float32Array(bd.v * 4);
  for (let k = 0; k < bd.v; k++) { si[k * 4] = bd.s[k]; sw[k * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(bd.v > 65535 ? new THREE.Uint32BufferAttribute(bd.i, 1) : new THREE.Uint16BufferAttribute(bd.i, 1));
  g.computeBoundingSphere();
  return g;
}
const SPH = (r, w, h) => new THREE.SphereGeometry(r, w || 14, h || 10);
const CYL = (rt, rb, h, s, open, ts, tl) => new THREE.CylinderGeometry(rt, rb, h, s || 10, 1, !!open, ts || 0, tl || TAU);
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const TOR = (r, t, rs, ts, arc) => new THREE.TorusGeometry(r, t, rs || 6, ts || 14, arc || TAU);

const GEO = { body: null, glow: null, helmetRange: null, tris: 0 };
function buildGeometry() {
  const bd = builder(), gl = builder();
  // --- bacaklar + bot (iki taraf)
  for (const sd of [1, -1]) {
    const th = sd > 0 ? B.thighL : B.thighR, sh = sd > 0 ? B.shinL : B.shinR, ft = sd > 0 ? B.footL : B.footR;
    part(bd, CYL(0.034, 0.03, LEG1, 9), th, COL.navy, { p: [0, -LEG1 / 2, 0] });
    part(bd, SPH(0.033, 10, 8), sh, COL.cyan, { p: [0, 0, 0.012], s: [1, 1, 0.9] });       // diz koruyucu (VoltGuard turkuaz)
    part(bd, CYL(0.03, 0.027, LEG2 - 0.02, 9), sh, COL.navy, { p: [0, -LEG2 / 2 + 0.01, 0] });
    part(bd, BOX(0.074, 0.056, 0.118), ft, COL.black, { p: [0, -0.022, 0.018] });          // iş botu
    part(bd, BOX(0.078, 0.012, 0.124), ft, COL.sole, { p: [0, -0.044, 0.018] });           // taban (alt yüz = zemin)
    part(bd, BOX(0.06, 0.03, 0.03), ft, COL.graphL, { p: [0, -0.02, 0.07] });              // çelik burun
  }
  // --- kalça, kemer, cep
  part(bd, CYL(0.112, 0.1, 0.085, 12), B.pelvis, COL.navy, { p: [0, -0.02, 0], s: [1, 1, 0.76] });
  part(bd, CYL(0.126, 0.124, 0.032, 14), B.pelvis, COL.black, { p: [0, 0.006, 0], s: [1, 1, 0.8] });
  part(bd, BOX(0.04, 0.028, 0.012), B.pelvis, COL.silver, { p: [0, 0.006, 0.101] });
  part(bd, BOX(0.05, 0.062, 0.05), B.pelvis, COL.brown, { p: [0.122, -0.03, -0.035] });  // alet çantası
  for (let i = 0; i < 5; i++) {
    const b = B['belt' + i];
    part(bd, BOX(0.034, 0.032, 0.016), b, COL.lock, {});
    part(bd, TOR(0.011, 0.0035, 5, 10, PI), b, COL.silver, { p: [0, 0.016, 0] });
  }
  for (let i = 0; i < 2; i++) {
    const b = B['fuse' + i];
    part(bd, BOX(0.02, 0.046, 0.018), b, COL.ceramic, {});
    part(bd, BOX(0.004, 0.016, 0.012), b, COL.silver, { p: [0, 0.03, 0] });
  }
  // --- gövde + yelek
  part(bd, CYL(0.118, 0.11, 0.225, 12), B.spine, COL.navy, { p: [0, 0.095, 0], s: [1, 1, 0.76] });
  part(bd, CYL(0.128, 0.122, 0.17, 12), B.spine, COL.vest, { p: [0, 0.075, 0], s: [1, 1, 0.8] });
  part(bd, CYL(0.06, 0.07, 0.03, 10), B.spine, COL.navyD, { p: [0, 0.205, 0] });          // yaka
  part(bd, BOX(0.022, 0.07, 0.05), B.spine, COL.vestD, { p: [0.11, 0.155, 0] });            // yelek omuz bandı
  part(bd, BOX(0.022, 0.07, 0.05), B.spine, COL.vestD, { p: [-0.11, 0.155, 0] });
  part(bd, SPH(0.05, 10, 8), B.spine, COL.navy, { p: [0.158, 0.152, 0] });                  // omuz
  part(bd, SPH(0.05, 10, 8), B.spine, COL.navy, { p: [-0.158, 0.152, 0] });
  // yansıtıcı şeritler + sırt yaması + isim etiketi (parıltı)
  part(gl, CYL(0.131, 0.129, 0.016, 14, true), B.spine, COL.stripe, { p: [0, 0.035, 0], s: [1, 1, 0.8] });
  part(gl, CYL(0.13, 0.128, 0.016, 14, true), B.spine, COL.stripe, { p: [0, 0.105, 0], s: [1, 1, 0.8] });
  part(gl, new THREE.PlaneGeometry(0.17, 0.032), B.spine, COL.white, { p: [0, 0.07, -0.104], r: [0, PI, 0], uv: UV.logo });
  part(gl, new THREE.PlaneGeometry(0.07, 0.018), B.spine, COL.white, { p: [0.05, 0.13, 0.103], r: [-0.06, 0, 0], uv: UV.name });
  // sırtta gerilim dedektörü (çapraz)
  part(bd, CYL(0.016, 0.016, 0.13, 8), B.bkDet, COL.yellow, { r: [0, 0, 0.7] });
  part(bd, CYL(0.007, 0.012, 0.04, 6), B.bkDet, COL.black, { p: [0.054, -0.058, 0], r: [0, 0, 0.7] });
  // sırtta taşınabilir topraklama takımı (makara)
  part(bd, TOR(0.05, 0.017, 6, 14), B.bkSet, COL.green, { r: [0, 0, 0] });
  part(bd, TOR(0.05, 0.0175, 6, 14, PI * 0.6), B.bkSet, COL.yellow, { r: [0, 0, 0.4] });
  part(bd, BOX(0.03, 0.02, 0.02), B.bkSet, COL.yellow, { p: [0, -0.06, 0.004] });
  // --- baş: robot kafa + vizör + gözler + kulaklar
  part(bd, CYL(0.045, 0.05, 0.05, 10), B.head, COL.graph, { p: [0, 0.02, 0] });
  part(bd, SPH(0.122, 18, 13), B.head, COL.graph, { p: [0, 0.112, 0], s: [1.04, 0.94, 0.94] });
  part(bd, BOX(0.11, 0.02, 0.03), B.head, COL.graphL, { p: [0, 0.04, 0.1] });              // çene ızgarası
  part(gl, CYL(0.122, 0.122, 0.08, 16, true, -0.95, 1.9), B.head, COL.white, { p: [0, 0.112, 0], s: [1.04, 1, 1.0], uv: UV.visor });
  part(gl, BOX(0.048, 0.033, 0.008), B.eyeL, COL.eye, {});
  part(gl, BOX(0.048, 0.033, 0.008), B.eyeR, COL.eye, {});
  part(gl, CYL(0.028, 0.028, 0.018, 12), B.head, COL.cyan, { p: [0.127, 0.11, -0.005], r: [0, 0, PI / 2] });
  part(gl, CYL(0.028, 0.028, 0.018, 12), B.head, COL.cyan, { p: [-0.127, 0.11, -0.005], r: [0, 0, PI / 2] });
  // --- baret (kask): kubbe, siper, sırt, bant, fener, anten
  const h0 = bd.v;
  part(bd, new THREE.SphereGeometry(0.14, 18, 8, 0, TAU, 0, PI / 2), B.helmet, COL.helmet, { s: [1, 0.96, 1.08] });
  part(bd, CYL(0.15, 0.153, 0.012, 20), B.helmet, COL.helmet, { p: [0, 0.002, 0.022], s: [1, 1, 1.16] });
  part(bd, BOX(0.028, 0.03, 0.22), B.helmet, COL.helmet, { p: [0, 0.122, -0.004], r: [0.04, 0, 0] });
  const h1 = bd.v;
  part(bd, CYL(0.1425, 0.1425, 0.026, 18, true), B.helmet, COL.red, { p: [0, 0.018, 0], s: [1, 1, 1.08] });
  part(bd, CYL(0.1405, 0.1405, 0.008, 18, true), B.helmet, COL.cyan, { p: [0, 0.036, 0], s: [1, 1, 1.08] });
  part(bd, CYL(0.026, 0.026, 0.03, 10), B.helmet, COL.black, { p: [0, 0.07, 0.138], r: [PI / 2 - 0.45, 0, 0] });
  part(gl, CYL(0.02, 0.02, 0.006, 10), B.helmet, COL.lamp, { p: [0, 0.077, 0.153], r: [PI / 2 - 0.45, 0, 0] });
  part(bd, CYL(0.005, 0.006, 0.07, 5), B.helmet, COL.black, { p: [-0.055, 0.115, -0.05] });
  part(gl, SPH(0.016, 8, 6), B.ant, COL.amber, {});
  GEO.helmetRange = [h0, h1];
  // --- kollar: kol, yalıtkan eldiven (uzun konçlu), teleskopik bilek, saat
  for (const sd of [1, -1]) {
    const ua = sd > 0 ? B.uarmL : B.uarmR, fa = sd > 0 ? B.farmL : B.farmR, hd = sd > 0 ? B.handL : B.handR;
    part(bd, CYL(0.03, 0.028, ARM1, 9), ua, COL.navy, { p: [0, -ARM1 / 2, 0] });
    part(bd, SPH(0.03, 9, 7), fa, COL.navy, {});
    part(bd, CYL(0.027, 0.027, 0.045, 9), fa, COL.navy, { p: [0, -0.024, 0] });
    part(bd, CYL(0.039, 0.03, 0.062, 10), fa, COL.glove, { p: [0, -0.072, 0] });            // eldiven konçu (IEC 60903)
    part(bd, CYL(0.04, 0.04, 0.008, 10), fa, COL.gloveCuff, { p: [0, -0.043, 0] });         // sınıf bandı
    part(bd, CYL(0.016, 0.016, 0.15, 8), hd, COL.steel, { p: [0, 0.07, 0] });               // teleskop (bilekte gizli)
    part(bd, SPH(0.036, 10, 8), hd, COL.glove, { p: [0, -0.03, 0.004], s: [1.15, 1.25, 0.95] });
    part(bd, SPH(0.016, 8, 6), hd, COL.glove, { p: [-sd * 0.03, -0.022, 0.024] });         // başparmak
  }
  part(gl, BOX(0.026, 0.008, 0.024), B.farmL, COL.screen, { p: [0, -0.06, 0.036] });       // bilek saati ekranı
  // --- el aletleri (kemik ölçeği 0 = gizli)
  part(bd, CYL(0.016, 0.016, 0.13, 8), B.pDet, COL.yellow, { p: [0, -0.04, 0] });
  part(bd, CYL(0.006, 0.012, 0.045, 6), B.pDet, COL.black, { p: [0, -0.125, 0] });
  part(gl, BOX(0.018, 0.026, 0.004), B.pDet, COL.led, { p: [0, -0.02, 0.016] });
  part(bd, BOX(0.11, 0.078, 0.01), B.pTab, COL.black, { r: [0.25, 0, 0] });
  part(gl, new THREE.PlaneGeometry(0.098, 0.066), B.pTab, COL.white, { p: [0, 0.001, 0.0062], r: [0.25, 0, 0], uv: UV.tab });
  part(bd, BOX(0.036, 0.034, 0.017), B.pLock, COL.lock, {});
  part(bd, TOR(0.012, 0.0038, 5, 10, PI), B.pLock, COL.silver, { p: [0, 0.017, 0] });
  part(bd, BOX(0.03, 0.046, 0.003), B.pLock, COL.tag, { p: [0, -0.04, 0.004] });
  for (let i = 0; i < 4; i++) part(bd, CYL(0.019, 0.019, 0.014, 9), B.pClamp, i % 2 ? COL.yellow : COL.green, { p: [0, -0.01 - i * 0.014, 0] });
  part(bd, BOX(0.012, 0.04, 0.03), B.pClamp, COL.silver, { p: [0, -0.075, 0] });
  part(bd, TOR(0.04, 0.007, 5, 12, PI * 1.2), B.pClamp, COL.green, { p: [0, 0.01, -0.03], r: [0, PI / 2, 0] });
  part(bd, BOX(0.03, 0.05, 0.03), B.pPull, COL.graphL, {});
  part(bd, BOX(0.032, 0.058, 0.022), B.pPull, COL.ceramic, { p: [0, -0.05, 0] });
  part(bd, BOX(0.005, 0.02, 0.016), B.pPull, COL.silver, { p: [0, -0.087, 0] });
  part(bd, BOX(0.012, 0.11, 0.02), B.pWrench, COL.steel, { p: [0, -0.05, 0] });
  part(bd, TOR(0.018, 0.007, 5, 10), B.pWrench, COL.steel, { p: [0, -0.11, 0] });
  GEO.body = finish(bd); GEO.glow = finish(gl);
  GEO.tris = (bd.i.length + gl.i.length) / 3 + 2;
}
function recolorHelmet(geo, hex) {
  if (!geo || !GEO.helmetRange) return;
  const a = geo.attributes.color; _bc.setHex(hex).convertSRGBToLinear();
  for (let k = GEO.helmetRange[0]; k < GEO.helmetRange[1]; k++) a.setXYZ(k, _bc.r, _bc.g, _bc.b);
  a.needsUpdate = true;
}

// ------------------------------------------------------------------ anahtar kare yardımcıları
// tablo: Float32Array [k, a, b, c, d, ...] (adım 5), out: 4 değer, düzgün (smoothstep) aradeğerleme
function kf(T, k, out) {
  const n = T.length / 5;
  if (k <= T[0]) { out[0] = T[1]; out[1] = T[2]; out[2] = T[3]; out[3] = T[4]; return out; }
  for (let i = 0; i < n - 1; i++) {
    const o = i * 5, k1 = T[o + 5];
    if (k <= k1) {
      const u = sstep((k - T[o]) / Math.max(1e-6, k1 - T[o]));
      out[0] = T[o + 1] + (T[o + 6] - T[o + 1]) * u; out[1] = T[o + 2] + (T[o + 7] - T[o + 2]) * u;
      out[2] = T[o + 3] + (T[o + 8] - T[o + 3]) * u; out[3] = T[o + 4] + (T[o + 9] - T[o + 4]) * u;
      return out;
    }
  }
  const o = (n - 1) * 5; out[0] = T[o + 1]; out[1] = T[o + 2]; out[2] = T[o + 3]; out[3] = T[o + 4]; return out;
}
const F32 = a => new Float32Array(a);
function ikSet(P, side, w, x, y, z) {
  if (side > 0) { P[X.ikL] = w; P[X.ikLx] = x; P[X.ikLy] = y; P[X.ikLz] = z; } else { P[X.ikR] = w; P[X.ikRx] = x; P[X.ikRy] = y; P[X.ikRz] = z; }
}
function ikKF(P, side, T, k) { kf(T, k, KO); ikSet(P, side, KO[3], KO[0], KO[1], KO[2]); }
// gövde: [eğilme, pelvis y, pelvis z, baş x]
function bodyKF(P, T, k) { kf(T, k, KO2); P[B.spine * 3] += KO2[0]; P[X.pelY] += KO2[1]; P[X.pelZ] += KO2[2]; P[B.head * 3] += KO2[3]; }
// adım: sağ ayak öne/arkaya (z) + kaldırma (geçişte)
function stepR(P, z, e) { P[X.frz] += z * e; P[X.fry] += 0.035 * 4 * e * (1 - e) * (z !== 0 ? 1 : 0); }
// cihaza yaklaş: kök karonun İÇİNDE cihaza doğru STEP_IN kadar ilerler (ayak noktası hep karo üstünde);
// sol ayak dünyada geride kalır (çakılı), sağ ayak kaldırılarak öne basar
const STEP_IN = 0.17;
function approach(P, e) { P[X.stepF] = STEP_IN * e; P[X.flz] -= STEP_IN * 0.6 * e; stepR(P, 0.03, e); }
function stepL(P, z, e) { P[X.flz] += z * e; P[X.fly] += 0.035 * 4 * e * (1 - e) * (z !== 0 ? 1 : 0); }

// ------------------------------------------------------------------ klip tabloları (kök-yerel: +z cihaza doğru)
// kesici: tek elle kola uzan, bas (kapat: yukarı / aç: aşağı), geri çekil — 380 ms, ses kola basışta
const T_KES_R_KAP = F32([0, -0.15, 0.3, 0.04, 0, 0.36, -0.03, 0.44, 0.52, 1, 0.55, -0.03, 0.52, 0.52, 1, 0.66, -0.03, 0.52, 0.5, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_KES_R_AC = F32([0, -0.15, 0.3, 0.04, 0, 0.36, -0.03, 0.53, 0.52, 1, 0.55, -0.03, 0.45, 0.52, 1, 0.66, -0.03, 0.45, 0.5, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_KES_BODY = F32([0, 0, 0, 0, 0, 0.36, 0.2, -0.012, 0.04, 0.12, 0.66, 0.2, -0.012, 0.04, 0.1, 1, 0, 0, 0, 0]);
// ayırıcı: iki elle kol, bıçak açısı — 520 ms
const T_AYR_L_KAP = F32([0, 0.15, 0.3, 0.04, 0, 0.25, 0.05, 0.4, 0.48, 1, 0.72, 0.05, 0.57, 0.45, 1, 0.82, 0.05, 0.57, 0.45, 1, 1, 0.15, 0.3, 0.04, 0]);
const T_AYR_R_KAP = F32([0, -0.15, 0.3, 0.04, 0, 0.25, -0.05, 0.4, 0.48, 1, 0.72, -0.05, 0.57, 0.45, 1, 0.82, -0.05, 0.57, 0.45, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_AYR_L_AC = F32([0, 0.15, 0.3, 0.04, 0, 0.25, 0.05, 0.57, 0.46, 1, 0.72, 0.05, 0.4, 0.48, 1, 0.82, 0.05, 0.4, 0.48, 1, 1, 0.15, 0.3, 0.04, 0]);
const T_AYR_R_AC = F32([0, -0.15, 0.3, 0.04, 0, 0.25, -0.05, 0.57, 0.46, 1, 0.72, -0.05, 0.4, 0.48, 1, 0.82, -0.05, 0.4, 0.48, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_AYR_BODY = F32([0, 0, 0, 0, 0, 0.25, 0.22, -0.03, 0.03, 0.1, 0.72, 0.12, -0.045, 0.0, 0.05, 0.85, 0.12, -0.03, 0, 0.05, 1, 0, 0, 0, 0]);
// yük ayırıcısı: yaylı tek el kolu — 450 ms
const T_YA_R = F32([0, -0.15, 0.3, 0.04, 0, 0.32, -0.04, 0.5, 0.52, 1, 0.55, -0.04, 0.42, 0.5, 1, 0.68, -0.04, 0.42, 0.5, 1, 1, -0.15, 0.3, 0.04, 0]);
// gerilim yokluğu tespiti + topraklama ayırıcısı — 900 ms (dedektör sırttan → uç teması bip×2 → geri → iki el kol → onay)
const T_TOP_R = F32([0, -0.15, 0.3, 0.04, 0, 0.1, -0.05, 0.62, -0.1, 1, 0.13, -0.05, 0.62, -0.1, 1, 0.28, -0.03, 0.56, 0.52, 1, 0.42, -0.03, 0.56, 0.52, 1,
  0.52, -0.05, 0.62, -0.1, 1, 0.56, -0.05, 0.62, -0.1, 1, 0.66, -0.05, 0.42, 0.48, 1, 0.82, -0.05, 0.58, 0.45, 1, 0.9, -0.05, 0.58, 0.45, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_TOP_L = F32([0, 0.15, 0.3, 0.04, 0, 0.56, 0.15, 0.3, 0.04, 0, 0.66, 0.05, 0.42, 0.48, 1, 0.82, 0.05, 0.58, 0.45, 1, 0.9, 0.05, 0.58, 0.45, 1, 1, 0.15, 0.3, 0.04, 0]);
const T_TOP_BODY = F32([0, 0, 0, 0, 0, 0.28, 0.18, -0.012, 0.04, 0.15, 0.45, 0.16, -0.012, 0.04, 0.12, 0.56, 0.05, 0, 0, 0, 0.7, 0.2, -0.03, 0.03, 0.08, 0.86, 0.1, -0.03, 0, 0.0, 0.93, 0, 0, 0, 0.28, 1, 0, 0, 0, 0]);
// taşınabilir topraklama: dedektör testi → sırttan kıskaç → baraya → onay — 900 ms
const T_SET_R = F32([0, -0.15, 0.3, 0.04, 0, 0.1, -0.05, 0.62, -0.1, 1, 0.13, -0.05, 0.62, -0.1, 1, 0.28, -0.03, 0.56, 0.52, 1, 0.42, -0.03, 0.56, 0.52, 1,
  0.54, 0.0, 0.6, -0.12, 1, 0.6, 0.0, 0.6, -0.12, 1, 0.78, -0.02, 0.5, 0.53, 1, 0.86, -0.02, 0.5, 0.53, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_SET_BODY = F32([0, 0, 0, 0, 0, 0.28, 0.18, -0.012, 0.04, 0.15, 0.45, 0.16, -0.012, 0.04, 0.12, 0.58, 0.04, 0, 0, 0, 0.78, 0.22, -0.02, 0.04, 0.1, 0.88, 0.08, 0, 0, 0, 0.94, 0, 0, 0, 0.28, 1, 0, 0, 0, 0]);
// topraklama sökme (kıskacı al, sırta koy) — 600 ms
const T_UNSET_R = F32([0, -0.15, 0.3, 0.04, 0, 0.32, -0.02, 0.5, 0.53, 1, 0.42, -0.02, 0.5, 0.53, 1, 0.72, 0.0, 0.6, -0.12, 1, 0.8, 0.0, 0.6, -0.12, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_UNSET_BODY = F32([0, 0, 0, 0, 0, 0.32, 0.22, -0.02, 0.04, 0.1, 0.5, 0.1, 0, 0, 0, 1, 0, 0, 0, 0]);
// kilitle ve etiketle — 600 ms (kemerden kilit → as → etiket sallanır)
const T_LOCK_R = F32([0, -0.15, 0.3, 0.04, 0, 0.2, -0.14, 0.33, 0.06, 1, 0.26, -0.14, 0.33, 0.06, 1, 0.56, -0.03, 0.44, 0.52, 1, 0.68, -0.03, 0.42, 0.52, 1, 0.76, -0.03, 0.42, 0.5, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_LOCK_BODY = F32([0, 0, 0, 0, 0, 0.22, 0.05, -0.01, 0, 0.32, 0.56, 0.2, -0.015, 0.04, 0.12, 0.76, 0.18, -0.015, 0.04, 0.1, 0.86, 0.04, 0, 0, 0.2, 1, 0, 0, 0, 0]);
const T_UNLOCK_R = F32([0, -0.15, 0.3, 0.04, 0, 0.34, -0.03, 0.42, 0.52, 1, 0.42, -0.03, 0.44, 0.52, 1, 0.72, -0.14, 0.33, 0.06, 1, 0.8, -0.14, 0.33, 0.06, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_UNLOCK_BODY = F32([0, 0, 0, 0, 0, 0.34, 0.2, -0.015, 0.04, 0.12, 0.45, 0.18, -0.015, 0.04, 0.1, 0.74, 0.05, -0.01, 0, 0.32, 1, 0, 0, 0, 0]);
// NH sigorta bıçağı değiştir — 700 ms (çekme kolu → eski bıçağı çek → yedeği tak)
const T_FUSE_R = F32([0, -0.15, 0.3, 0.04, 0, 0.12, -0.12, 0.31, -0.02, 1, 0.16, -0.12, 0.31, -0.02, 1, 0.36, -0.03, 0.46, 0.52, 1, 0.48, -0.03, 0.46, 0.4, 1, 0.58, 0.1, 0.33, 0.06, 1,
  0.64, 0.1, 0.33, 0.06, 1, 0.76, -0.03, 0.46, 0.4, 1, 0.84, -0.03, 0.46, 0.53, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_FUSE_BODY = F32([0, 0, 0, 0, 0, 0.14, 0.04, -0.01, 0, 0.3, 0.36, 0.2, -0.02, 0.04, 0.1, 0.48, 0.12, -0.02, 0.0, 0.1, 0.6, 0.06, -0.02, 0, 0.3, 0.84, 0.22, -0.02, 0.05, 0.1, 1, 0, 0, 0, 0]);
// butona bas — 250 ms (işaret parmağı)
const T_PRESS_R = F32([0, -0.15, 0.3, 0.04, 0, 0.42, -0.02, 0.5, 0.5, 1, 0.52, -0.02, 0.5, 0.55, 1, 0.66, -0.02, 0.5, 0.5, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_PRESS_BODY = F32([0, 0, 0, 0, 0, 0.45, 0.18, -0.01, 0.03, 0.1, 0.66, 0.15, -0.01, 0.03, 0.08, 1, 0, 0, 0, 0]);
// bekle (deşarj): bilek saatine bak — 400 ms
const T_WAIT_L = F32([0, 0.15, 0.3, 0.04, 0, 0.3, 0.05, 0.52, 0.17, 1, 0.75, 0.05, 0.52, 0.17, 1, 1, 0.15, 0.3, 0.04, 0]);
const T_WAIT_BODY = F32([0, 0, 0, 0, 0, 0.3, 0.02, 0, 0, 0.32, 0.75, 0.02, 0, 0, 0.32, 1, 0, 0, 0, 0]);
// iş (bakım): diz çök, anahtarla sık — 700 ms
const T_WORK_R = F32([0, -0.15, 0.3, 0.04, 0, 0.18, -0.04, 0.24, 0.3, 1, 0.82, -0.04, 0.24, 0.3, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_WORK_L = F32([0, 0.15, 0.3, 0.04, 0, 0.2, 0.06, 0.26, 0.26, 1, 0.82, 0.06, 0.26, 0.26, 1, 1, 0.15, 0.3, 0.04, 0]);
const T_WORK_BODY = F32([0, 0, 0, 0, 0, 0.2, 0.34, -0.085, 0.02, 0.3, 0.82, 0.34, -0.085, 0.02, 0.3, 1, 0, 0, 0, 0]);
// kutlama: kask selamı — 900 ms
const T_WIN_R = F32([0, -0.15, 0.3, 0.04, 0, 0.18, -0.15, 0.3, 0.04, 0, 0.36, -0.075, 0.8, 0.13, 1, 0.62, -0.075, 0.8, 0.13, 1, 0.84, -0.15, 0.3, 0.04, 0, 1, -0.15, 0.3, 0.04, 0]);
// boşta: kilitleri say, tablet, eldiven
const T_IDLE_LOCKS_R = F32([0, -0.15, 0.3, 0.04, 0, 0.18, -0.15, 0.33, 0.07, 1, 0.82, -0.15, 0.33, 0.07, 1, 1, -0.15, 0.3, 0.04, 0]);
const T_IDLE_TAB_L = F32([0, 0.15, 0.3, 0.04, 0, 0.15, 0.06, 0.47, 0.19, 1, 0.85, 0.06, 0.47, 0.19, 1, 1, 0.15, 0.3, 0.04, 0]);
const T_IDLE_TAB_R = F32([0, -0.15, 0.3, 0.04, 0, 0.3, -0.15, 0.3, 0.04, 0, 0.42, 0.02, 0.5, 0.21, 1, 0.68, 0.02, 0.5, 0.21, 1, 0.8, -0.15, 0.3, 0.04, 0, 1, -0.15, 0.3, 0.04, 0]);
const T_IDLE_GLOVE_R = F32([0, -0.15, 0.3, 0.04, 0, 0.25, 0.1, 0.36, 0.09, 1, 0.75, 0.1, 0.36, 0.09, 1, 1, -0.15, 0.3, 0.04, 0]);

// ------------------------------------------------------------------ klip tanımları
// fn(P, k, R, cl) — P = taban pozun kopyası, k ∈ [0,1]; beats: [[k, kod], ...] (sıralı)
function clipOperate(P, k, R, cl) {
  const t = cl.devT;
  if (t === 'ayirici' || (t === 'toprak' && !cl.closing)) {
    ikKF(P, 1, cl.closing ? T_AYR_L_KAP : T_AYR_L_AC, k); ikKF(P, -1, cl.closing ? T_AYR_R_KAP : T_AYR_R_AC, k);
    bodyKF(P, T_AYR_BODY, k); const e = env(k, 0, 0.25, 0.82, 1); approach(P, e); P[X.frz] -= 0.09 * e; P[X.flz] += 0.06 * e; P[X.flx] += 0.015 * e; P[X.frx] -= 0.015 * e;
  } else if (t === 'toprak') {
    ikKF(P, -1, T_TOP_R, k); ikKF(P, 1, T_TOP_L, k); bodyKF(P, T_TOP_BODY, k);
    approach(P, env(k, 0.12, 0.26, 0.45, 0.55) + env(k, 0.55, 0.66, 0.86, 1));
    P[X.det] = cl.f1 ? 1 : 0;
  } else if (t === 'yuk_ayirici') {
    ikKF(P, -1, T_YA_R, k); bodyKF(P, T_KES_BODY, k); approach(P, env(k, 0, 0.3, 0.7, 1));
  } else {                                              // kesici (ve bilinmeyen)
    ikKF(P, -1, cl.closing ? T_KES_R_KAP : T_KES_R_AC, k); bodyKF(P, T_KES_BODY, k); approach(P, env(k, 0, 0.36, 0.66, 1));
  }
}
function clipEarth(P, k, R, cl) {                        // taşınabilir topraklama takımı
  if (cl.closing) {
    ikKF(P, -1, T_SET_R, k); bodyKF(P, T_SET_BODY, k); approach(P, env(k, 0.12, 0.26, 0.45, 0.54) + env(k, 0.6, 0.76, 0.88, 1));
    P[X.det] = cl.f1 ? 1 : 0; P[X.clamp] = cl.f2 ? 1 : 0; if (cl.f2 || cl.f3) P[X.setD] = -1;
  } else {
    ikKF(P, -1, T_UNSET_R, k); bodyKF(P, T_UNSET_BODY, k); approach(P, env(k, 0, 0.3, 0.45, 0.7));
    P[X.clamp] = cl.f1 && !cl.f2 ? 1 : 0; if (cl.f2) P[X.setD] = 1;
  }
}
function clipLock(P, k, R, cl) {
  if (cl.closing) { ikKF(P, -1, T_LOCK_R, k); bodyKF(P, T_LOCK_BODY, k); P[X.lock] = cl.f1 && !cl.f2 ? 1 : 0; if (cl.f1) P[X.beltD] = -1; }
  else { ikKF(P, -1, T_UNLOCK_R, k); bodyKF(P, T_UNLOCK_BODY, k); P[X.lock] = cl.f1 && !cl.f2 ? 1 : 0; if (cl.f2) P[X.beltD] = 1; }
  approach(P, cl.closing ? env(k, 0.28, 0.52, 0.76, 0.95) : env(k, 0, 0.3, 0.44, 0.7));
  P[B.handR * 3 + 2] += 0.5 * bump(k, cl.closing ? 0.6 : 0.34, cl.closing ? 0.74 : 0.46);   // kilidi çevir
}
function clipFuse(P, k, R, cl) {
  ikKF(P, -1, T_FUSE_R, k); bodyKF(P, T_FUSE_BODY, k); approach(P, env(k, 0.18, 0.36, 0.86, 1));
  P[X.pull] = cl.f1 && !cl.f3 ? 1 : 0; if (cl.f2) P[X.fuseD] = -1;
}
function clipPress(P, k, R, cl) { ikKF(P, -1, T_PRESS_R, k); bodyKF(P, T_PRESS_BODY, k); approach(P, env(k, 0, 0.42, 0.66, 1)); }
function clipWait(P, k, R, cl) {
  ikKF(P, 1, T_WAIT_L, k); bodyKF(P, T_WAIT_BODY, k); const e = env(k, 0.2, 0.35, 0.7, 0.95);
  P[B.head * 3 + 1] += 0.3 * e; P[B.handL * 3 + 2] += 0.6 * e; P[X.eyeX] += 0.8 * e;
}
function clipWork(P, k, R, cl) {
  ikKF(P, -1, T_WORK_R, k); ikKF(P, 1, T_WORK_L, k); bodyKF(P, T_WORK_BODY, k);
  const e = env(k, 0.15, 0.25, 0.78, 0.9); P[B.handR * 3 + 1] += 0.7 * Math.sin(k * 3 * TAU) * e;
  P[X.wrench] = k > 0.12 && k < 0.88 ? 1 : 0; stepR(P, -0.07, env(k, 0, 0.2, 0.82, 1)); stepL(P, 0.04, env(k, 0, 0.2, 0.82, 1));
}
function ovReject(P, k, R, ov) {
  const e = env(k, 0, 0.15, 0.7, 1);
  P[B.head * 3 + 1] += 0.32 * Math.sin(k * 3 * TAU) * e; P[B.head * 3] += 0.08 * e;
  P[B.uarmR * 3] += 0.35 * e; P[B.farmR * 3] -= 0.3 * e;              // eli geri çek
  if (ov.f1) { ikSet(P, 1, env(k, 0, 0.2, 0.75, 1), 0.07, 0.45, 0.2); P[X.tab] = e > 0.35 ? 1 : 0; P[B.head * 3] += 0.1 * e; }
  if (ov.f2) { P[X.pelZ] -= 0.05 * e; stepR(P, -0.08, e); P[B.spine * 3] -= 0.08 * e; }     // güvenli geri adım
  P[X.eye] *= 1 - 0.35 * e;
}
function ovWin(P, k, R, ov) {
  ikKF(P, -1, T_WIN_R, k);
  P[X.glow] += env(k, 0, 0.15, 0.62, 1);
  P[B.helmet * 3] -= 0.14 * env(k, 0.34, 0.42, 0.55, 0.66);           // kask selamı (siperi hafifçe indir)
  P[B.spine * 3] -= 0.06 * env(k, 0, 0.2, 0.8, 1); P[B.head * 3] -= 0.08 * env(k, 0, 0.2, 0.7, 0.85);
  P[B.head * 3] += 0.16 * env(k, 0.8, 0.87, 0.87, 0.97);              // onay başı
  P[X.eye] *= 1 - 0.5 * env(k, 0.1, 0.2, 0.8, 0.95);                  // gülümseyen göz
}
function ovSpawn(P, k, R, ov) {
  P[X.eye] *= ramp(k, 0.1, 0.5); P[X.glow] += 0.7 * env(k, 0.3, 0.5, 0.5, 1);
  P[B.head * 3 + 1] += 0.25 * Math.sin(k * TAU) * env(k, 0.4, 0.55, 0.85, 1); P[X.eyeX] += 0.8 * Math.sin(k * TAU) * env(k, 0.4, 0.55, 0.85, 1);
}
function ovScan(P, k) {
  const e = env(k, 0, 0.12, 0.88, 1), s = Math.sin(k * TAU); P[B.head * 3 + 1] += 0.5 * s * e; P[X.eyeX] += s * e; P[X.glow] += 0.25 * e;
}
function ovLocks(P, k) {
  ikKF(P, -1, T_IDLE_LOCKS_R, k); P[X.ikRy] += 0.012 * Math.max(0, Math.sin(k * 8 * TAU));
  const e = env(k, 0.05, 0.18, 0.85, 1); P[B.head * 3] += 0.42 * e; P[B.head * 3 + 1] -= 0.32 * e; P[B.spine * 3] += 0.06 * e;
}
function ovTablet(P, k) {
  ikKF(P, 1, T_IDLE_TAB_L, k); ikKF(P, -1, T_IDLE_TAB_R, k); P[X.tab] = env(k, 0.08, 0.15, 0.88, 0.94) > 0.5 ? 1 : 0;
  const e = env(k, 0.1, 0.22, 0.85, 1); P[B.head * 3] += 0.32 * e; P[B.head * 3 + 1] += 0.1 * e;
}
function ovGloves(P, k) {
  ikKF(P, -1, T_IDLE_GLOVE_R, k); const e = env(k, 0.1, 0.25, 0.75, 0.95);
  P[B.uarmL * 3] -= 0.35 * e; P[B.farmL * 3] -= 0.9 * e; P[B.head * 3] += 0.22 * e; P[B.head * 3 + 1] += 0.2 * e;
  P[X.ikRz] += 0.015 * Math.sin(k * 4 * TAU) * e;
}
function ovStretch(P, k) {
  const e = env(k, 0, 0.3, 0.65, 1);
  P[B.uarmL * 3 + 2] += 0.55 * e; P[B.uarmR * 3 + 2] -= 0.55 * e; P[B.uarmL * 3] += 0.25 * e; P[B.uarmR * 3] += 0.25 * e;
  P[B.spine * 3] -= 0.1 * e; P[B.head * 3] -= 0.18 * e; P[X.pelY] += 0.006 * e; P[X.eye] *= 1 - 0.4 * e;
}
// dur: s; beats: [k, kod]
const CLIPS = {
  operate: { dur: 0.38, fn: clipOperate, beats: [[0.55, 'op']] },
  earth: { dur: 0.9, fn: clipEarth, beats: [] },
  lock: { dur: 0.6, fn: clipLock, beats: [] },
  unlock: { dur: 0.6, fn: clipLock, beats: [] },
  fuse: { dur: 0.7, fn: clipFuse, beats: [[0.14, 'f1'], [0.45, 'cek'], [0.6, 'f2'], [0.82, 'tak'], [0.95, 'f3']] },
  press: { dur: 0.25, fn: clipPress, beats: [[0.5, 'bas']] },
  wait: { dur: 0.4, fn: clipWait, beats: [[0.3, 'bekle']] },
  work: { dur: 0.7, fn: clipWork, beats: [[0.3, 'is'], [0.8, 'isbit']] },
};
// cihaz tipine göre süre ve vuruş (operate/earth/lock varyantları)
const OP_VAR = {
  kesici: { dur: 0.38, beats: [[0.55, 'op']] },
  ayirici: { dur: 0.52, beats: [[0.3, 'ayrSes'], [0.72, 'beat']] },
  yuk_ayirici: { dur: 0.45, beats: [[0.55, 'op']] },
  toprakKap: { dur: 0.9, beats: [[0.1, 'f1'], [0.3, 'det'], [0.53, 'f0'], [0.8, 'op'], [0.93, 'nod']] },
  toprakAc: { dur: 0.52, beats: [[0.3, 'ayrSes'], [0.72, 'beat']] },
};
const EARTH_VAR = {
  kap: { dur: 0.9, beats: [[0.1, 'f1'], [0.3, 'det'], [0.52, 'f0'], [0.56, 'f2'], [0.8, 'kelepce'], [0.82, 'f2off']] },
  ac: { dur: 0.6, beats: [[0.4, 'kelepceAc'], [0.76, 'f2']] },
};
const LOCK_VAR = { kap: [[0.22, 'f1'], [0.7, 'kilit'], [0.72, 'f2']], ac: [[0.4, 'kilit'], [0.42, 'f1'], [0.76, 'f2']] };
const OVERLAYS = {
  reject: { dur: 0.3, fn: ovReject }, win: { dur: 0.9, fn: ovWin }, spawn: { dur: 0.42, fn: ovSpawn },
  scan: { dur: 2.0, fn: ovScan }, locks: { dur: 2.2, fn: ovLocks }, tablet: { dur: 2.4, fn: ovTablet }, gloves: { dur: 1.6, fn: ovGloves }, stretch: { dur: 1.8, fn: ovStretch },
};
const IDLE_LIST = ['scan', 'locks', 'tablet', 'gloves', 'stretch', 'scan'];

// ------------------------------------------------------------------ paylaşılan seviye durumu
const S = { L: null, inited: false, quality: 'orta', damage: 1, kask: 'beyaz', shadowTex: null, main: null, ghost: null, ghostOn: false, lastIdle: -1 };
const pop = x => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };

// ------------------------------------------------------------------ rig örneği
function makeRig(isGhost) {
  const bones = [];
  for (let i = 0; i < NB; i++) { const d = BONES[i]; const b = new THREE.Bone(); b.name = d[0]; b.position.set(d[2], d[3], d[4]); if (d[1] >= 0) bones[d[1]].add(b); bones.push(b); }
  bones[0].updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones);
  let matBody, matGlow;
  if (isGhost) {
    matBody = new THREE.MeshBasicMaterial({ color: 0x5cf0ff, transparent: true, opacity: 0.32, depthWrite: false, skinning: true });
    matGlow = new THREE.MeshBasicMaterial({ color: 0xbff8ff, transparent: true, opacity: 0.5, depthWrite: false, skinning: true });
  } else {
    matBody = new THREE.MeshLambertMaterial({ vertexColors: true, skinning: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    matGlow = new THREE.MeshBasicMaterial({ vertexColors: true, map: atlas, skinning: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
  }
  const body = new THREE.SkinnedMesh(GEO.body, matBody); body.add(bones[0]); body.bind(skel);
  const glow = new THREE.SkinnedMesh(GEO.glow, matGlow); glow.bind(skel, body.bindMatrix);
  body.frustumCulled = glow.frustumCulled = false; body.name = 'volti-body'; glow.name = 'volti-glow';
  if (isGhost) { body.renderOrder = glow.renderOrder = 3; }
  const yaw = new THREE.Group(); yaw.add(body, glow);
  const vis = new THREE.Group(); vis.add(yaw);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: S.shadowTex, transparent: true, depthWrite: false, opacity: isGhost ? 0.35 : 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  shadow.rotation.x = -PI / 2; shadow.position.y = 0.001; shadow.renderOrder = 1; shadow.name = 'volti-shadow';
  vis.add(shadow);
  const root = new THREE.Group(); root.name = isGhost ? 'volti-ghost' : 'volti'; root.add(vis);
  const R = {
    ghost: isGhost, line: !isGhost, root, vis, yaw, body, glow, shadow, bones, matBody, matGlow, glowBase: matGlow.color.clone(),
    cell: -1, groundY: 0, pathY: 0, visible: !isGhost, bx: 0, by: 0, bz: 0, mode: 0, zi: -1, lw: 0, lwT: 0, back: false, shA: 1,
    gl: new Float32Array(2),
    // yol: köşeler V, düğümler N, kilit bölgeleri Z (komut anında kurulur), yoğun noktalar (önceden ayrılmış)
    moving: false, res: null, V: [], N: [], Z: [],
    nP: 0, px: new Float64Array(MAXP), py: new Float64Array(MAXP), pz: new Float64Array(MAXP), pm: new Int8Array(MAXP), cum: new Float64Array(MAXP), ly: new Float32Array(MAXP),
    seg: 0, len: 0, s: 0,
    speed: 0, vmax: SPEED0, braking: false, brakeA: 0, rate: 1, ri: 0, endSnap: -1,
    // poz
    yawA: 0, yawV: 0, yawGoal: 0, phase: 0, walkW: 0, settle: 0, antic: 0, time: Math.random() * 10,
    blinkT: 2 + Math.random() * 3, blink: 0, idleT: 6 + Math.random() * 6, lastFoot: 0, stride: STRIDE * 0.6,
    Bp: new Float32Array(NPOSE), Cp: new Float32Array(NPOSE), Op: new Float32Array(NPOSE), Fp: new Float32Array(NPOSE),
    // klip ve kaplama
    cl: { on: false, fading: false, def: null, fn: null, dur: 1, t: 0, k: 0, bi: 0, beats: null, w: 0, res: null, name: '', devT: '', closing: true, el: -1, step: null, f1: false, f2: false, f3: false, fx: 0, fz: 0 },
    ov: { on: false, fading: false, fn: null, dur: 1, t: 0, k: 0, w: 0, res: null, name: '', f1: false, f2: false, skippable: false },
    // durum sayıları (sunum durumundan)
    belt: 0, fuses: 0, setOn: false,
    pr: { x: 0, y: 0, z: 0, footY: 0, groundY: 0, cell: -1, arc: false, moving: false, mode: 'karo', tile: -1 },
  };
  root.visible = R.visible;
  return R;
}

// ------------------------------------------------------------------ fiziksel yol (kural sürümü 4)
// Yol = köşe listesi R.V (dünya; y = AYAK yüksekliği) + köşeden çıkan parçanın türü m:
//   0 düz (karo üstü)  1 merdiven (eğik düzlem, basamak basamak)  2 iskele (dikey tırmanma)  3 iskeleye bağlı kısa düz
//   (yüzü duvara dönük: yaklaşma / geri adım). Köşe, düğüm ve bölge nesneleri KOMUT anında kurulur; kare döngüsü
//   yalnız okur (önceden ayrılmış yoğun nokta dizileri px/py/pz/pm/cum üzerinden) => kare başına ayırma yok.
// Düğümler R.N (sim2 karo + geçiş hücreleri) köşelerde başlar: karo sınırı (iki karo arası orta nokta), merdiven
// kenarı, iskele tabanı/katları/duvar düzlemi. legEnd = merkezi henüz geçilmemiş ilk KARO düğümü.
// Kilit bölgeleri R.Z (merdiven, iskele): adım fazı yaya kilitlenir => her ayak bir basamağın / basamak çubuğunun
// ortasına basar ve duruş boyunca orada kalır (λ = basamak aralığı, yarım adım genliği a = λ/2).
const LA = 0.10;                      // iskelede kökün sütun merkezinden duvara uzaklığı (basamak düzlemi KIT.iskele.Z)
const V_STAIR = 2.1, V_LADDER = 1.55, V_ATT = 1.7, DECEL = 26, LOOK = 1.6;
const LADDER_FZ = 0.17, LADDER_HZ = 0.21, ZPRE = 0.42, ZPOST = 0.36;
const stairN = () => (PX.KIT && PX.KIT.merdiven && PX.KIT.merdiven.N) || 5;
const ladderN = () => (PX.KIT && PX.KIT.iskele && PX.KIT.iskele.N) || 4;
// adım listesi (sim2.walkPath nesneleri ya da karo hücreleri) -> {t: karo hücreleri, e: kenar {k, c}, bad}
function parseSteps(L, list) {
  const t = [], e = [];
  if (!list || !list.length) return null;
  const st = c => L.stairs.find(q => q.cell === c), ld = c => L.ladders.find(q => q.cells.indexOf(c) >= 0);
  if (typeof list[0] === 'number') {
    for (const c of list) {
      if (!(L.tileIdx[c] >= 0)) return null;
      if (t.length && t[t.length - 1] === c) continue;
      if (t.length) {
        const ed = (L.adj[L.tileIdx[t[t.length - 1]]] || []).find(q => L.tiles[q.to] === c);
        if (!ed) return { t, e, bad: true };
        e.push({ k: ed.k, c: ed.k === 'merdiven' ? st(ed.cells[0]) : ed.k === 'iskele' ? ld(ed.cells[0]) : null });
      }
      t.push(c);
    }
    return { t, e, bad: false };
  }
  let pend = null;
  for (const s of list) {
    if (s.k === 'karo') { if (t.length) e.push(pend || { k: 'duz', c: null }); t.push(s.c); pend = null; }
    else if (!pend) pend = { k: s.k, c: s.k === 'merdiven' ? st(s.c) : ld(s.c) };
  }
  return { t, e, bad: e.some(q => q.k !== 'duz' && !q.c) };
}
// ---- köşe / düğüm / bölge kurucu (komut anı)
const vP = (R, x, y, z, m, n, c) => { const v = { x, y, z, m, n: n || null, c: c || null, S: 0, gone: false }; R.V.push(v); if (c) c.ct = v; return v; };
const nP = (R, c, k) => { const n = { c, k, e: 1e18, ct: null, s: -1 }; R.N.push(n); return n; };
// karo a'dan b'ye bir kenarın köşeleri (a'nın merkezi zaten eklenmiş); bitişte b'nin merkezi eklenir
function addEdge(R, L, a, b, ed) {
  const G = L.G; const pa = G.xyz(a), pb = G.xyz(b); const ya = pa[1] + 0.5, yb = pb[1] + 0.5;
  if (ed.k === 'merdiven') {
    const st = ed.c, ps = G.xyz(st.cell), u = PX.SIM.DIRS[st.dir]; const up = st.lo === a, ex = up ? -0.5 : 0.5;
    const e1 = vP(R, ps[0] + u[0] * ex, ya, ps[2] + u[1] * ex, 1, nP(R, st.cell, 1));
    const nb = nP(R, b, 0);
    const e2 = vP(R, ps[0] - u[0] * ex, yb, ps[2] - u[1] * ex, 0, nb);
    R.Z.push({ k: 1, a0: e1, a1: e2, h0: ya, sg: up ? 1 : -1, lam: 1 / stairN(), len: 1, fx: u[0], fz: u[1], s0: 0, s1: 0 });
    vP(R, pb[0], yb, pb[2], 0, null, nb);
    return;
  }
  if (ed.k === 'iskele') {
    const ld = ed.c, u = PX.SIM.DIRS[ld.dir], pf = G.xyz(ld.foot); const cx = pf[0], cz = pf[2], ax = cx + u[0] * LA, az = cz + u[1] * LA;
    const yf = pf[1] + 0.5, n = ld.cells.length, yt = yf + n, lam = 1 / ladderN();
    let z0, z1;
    if (ld.foot === a) {                                        // çıkış: tabana yaklaş (duvara dönük) -> tırman -> sahanlığa adım
      R.V[R.V.length - 1].m = 3;
      z0 = vP(R, ax, yf, az, 2, nP(R, ld.cells[0], 2));
      for (let k = 1; k < n; k++) vP(R, ax, yf + k, az, 2, nP(R, ld.cells[k], 2));
      z1 = vP(R, ax, yt, az, 0);
      R.Z.push({ k: 2, a0: z0, a1: z1, h0: yf, sg: 1, lam, len: n, fx: u[0], fz: u[1], s0: 0, s1: 0 });
      const nb = nP(R, b, 0);
      vP(R, cx + u[0] * 0.5, yt, cz + u[1] * 0.5, 0, nb);
      vP(R, pb[0], yb, pb[2], 0, null, nb);
    } else {                                                    // iniş: kenara yürü -> dön, geri adım -> in -> geri çekil
      vP(R, cx + u[0] * 0.5, yt, cz + u[1] * 0.5, 3, nP(R, ld.cells[n - 1], 2));
      z0 = vP(R, ax, yt, az, 2);
      for (let k = n - 1; k >= 1; k--) vP(R, ax, yf + k, az, 2, nP(R, ld.cells[k - 1], 2));
      const nb = nP(R, b, 0);
      z1 = vP(R, ax, yf, az, 3, nb);
      R.Z.push({ k: 2, a0: z0, a1: z1, h0: yt, sg: -1, lam, len: n, fx: u[0], fz: u[1], s0: 0, s1: 0 });
      vP(R, pb[0], yb, pb[2], 0, null, nb);
    }
    return;
  }
  const nb = nP(R, b, 0);
  vP(R, (pa[0] + pb[0]) / 2, ya, (pa[2] + pb[2]) / 2, 0, nb);
  vP(R, pb[0], yb, pb[2], 0, null, nb);
}
// köşelerden yoğun nokta dizisi: yalnız iki yanı düz (0) olan iç köşelerde Bezier yuvarlama; yay uzunluğu yatay
// (iskelede dikey). Köşe parametreleri v.S, düğüm sınırları n.e, karo merkezleri n.s, bölgeler z.s0/z.s1.
function densify(R) {
  const V = R.V, n = V.length; let np = 0;
  const px = R.px, py = R.py, pz = R.pz, pm = R.pm, idx = new Int32Array(n);
  const push = (x, y, z, m) => { if (np > 0 && Math.abs(px[np - 1] - x) < 1e-9 && Math.abs(py[np - 1] - y) < 1e-9 && Math.abs(pz[np - 1] - z) < 1e-9) { pm[np - 1] = m; return np - 1; } if (np < MAXP) { px[np] = x; py[np] = y; pz[np] = z; pm[np] = m; np++; } return np - 1; };
  for (let i = 0; i < n; i++) {
    const v = V[i];
    if (i > 0 && i < n - 1 && V[i - 1].m === 0 && v.m === 0 && Math.abs(V[i - 1].y - v.y) < 1e-9 && Math.abs(V[i + 1].y - v.y) < 1e-9) {
      const a = V[i - 1], c = V[i + 1];
      let dix = v.x - a.x, diz = v.z - a.z; const li = Math.hypot(dix, diz); let dox = c.x - v.x, doz = c.z - v.z; const lo = Math.hypot(dox, doz);
      if (li > 1e-9 && lo > 1e-9) {
        dix /= li; diz /= li; dox /= lo; doz /= lo;
        const cr = dix * doz - diz * dox, dt = dix * dox + diz * doz;
        if (!(Math.abs(cr) < 1e-6 && dt > 0) && dt >= -0.5) {
          const tl = Math.min(FILLET, 0.9 * li, 0.9 * lo);
          const Ax = v.x - dix * tl, Az = v.z - diz * tl, Bx = v.x + dox * tl, Bz = v.z + doz * tl;
          push(Ax, v.y, Az, 0);
          for (let j = 1; j < 6; j++) { const t = j / 6, u = 1 - t; const q = push(u * u * Ax + 2 * u * t * v.x + t * t * Bx, v.y, u * u * Az + 2 * u * t * v.z + t * t * Bz, 0); if (j === 3) idx[i] = q; }
          push(Bx, v.y, Bz, 0);
          continue;
        }
      }
    }
    idx[i] = push(v.x, v.y, v.z, v.m);
  }
  R.nP = np; const cum = R.cum; cum[0] = 0;
  for (let i = 1; i < np; i++) cum[i] = cum[i - 1] + (pm[i - 1] === 2 ? Math.abs(py[i] - py[i - 1]) : Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]));
  R.len = cum[np - 1];
  for (let i = 0; i < n; i++) V[i].S = cum[idx[i]];
  const N = R.N;
  for (let i = 0; i < n; i++) { const nd = V[i].n; if (nd) { const k = N.indexOf(nd); if (k > 0) N[k - 1].e = V[i].S; } }
  N[N.length - 1].e = 1e18;
  for (const nd of N) nd.s = nd.ct && !nd.ct.gone ? nd.ct.S : -1;
  for (const z of R.Z) { z.s0 = zParam(V[0], z, z.a0); z.s1 = zParam(V[0], z, z.a1); }
}
// bölge ucunun yay parametresi: köşe listedeyse onun parametresi; yeniden kurulumda geride kalmışsa (Volti merdiven/
// iskele üstünde ya da az önce çıktı) başlangıç noktasından o uca olan uzaklığın eksi işaretlisi
function zParam(v0, z, a) {
  if (!a.gone) return a.S;
  const h = Math.hypot(v0.x - a.x, v0.z - a.z);
  return z.k === 2 ? -(Math.abs(v0.y - a.y) + h) : -h;
}

// ---- yerleştirme
function placeRig(R, c) {
  if (!S.L || c === undefined || c < 0) return;
  if (R.moving) stopMove(R, true, false);
  if (c !== R.cell && R.cl.on) endClip(R, true);
  const p = S.L.G.xyz(c);
  R.cell = c; R.mode = 0; R.zi = -1; R.lw = 0; R.lwT = 0;
  R.root.position.set(p[0], p[1] + 0.5, p[2]); R.groundY = R.pathY = p[1] + 0.5; R.bx = p[0]; R.by = p[1] + 0.5; R.bz = p[2];
  R.vis.position.set(0, 0, 0);
  R.pr.cell = c;
  if (R.line && PX.flow && PX.flow.path) PX.flow.path(null);
}
function stopMove(R, cancelled, retarget) {
  R.moving = false; R.braking = false; R.speed = 0;
  const r = R.res; R.res = null;
  if (!retarget && R.line && PX.flow && PX.flow.path) PX.flow.path(null);
  if (r) r(retarget ? { cancelled: true, retarget: true } : { cancelled: !!cancelled });
}
// ---- yol izleyici
// followPath(list, opts): list = sim2.walkPath adımları ya da karo hücreleri; list[0] = Volti'nin karosu. Yürürken
// çağrılırsa list[0] === legEnd() olmalı (controller erken zincirleme / hedef değiştirme): o anki bacak durmadan biter.
function followPathRig(R, list, opts) {
  const L = S.L;
  if (!L || !list || !list.length) return Promise.resolve({ cancelled: false });
  const ps = parseSteps(L, opts && Array.isArray(opts.steps) && opts.steps.length > 1 ? opts.steps : list);   // hayalet: {steps: walkPath}
  if (!ps || !ps.t.length) { console.warn('[PX.volti] geçersiz yol'); return Promise.resolve({ cancelled: false }); }
  const wasMoving = R.moving; const vKeep = R.speed, phKeep = R.phase;
  if (R.cl.on) endClip(R, true);
  if (R.ov.on && R.ov.name !== 'reject') endOverlay(R, true);
  const ok = wasMoving && rebuild(R, ps);
  if (wasMoving) stopMove(R, true, true);
  if (!ok) {
    if (R.cell < 0 || R.cell !== ps.t[0] || R.mode !== 0) placeRig(R, ps.t[0]);
    const p0 = L.G.xyz(ps.t[0]); R.V = []; R.N = []; R.Z = [];
    const n0 = nP(R, ps.t[0], 0);
    vP(R, R.root.position.x, p0[1] + 0.5, R.root.position.z, 0, n0);
    if (!ps.e.length) vP(R, p0[0], p0[1] + 0.5, p0[2], 0, null, n0);          // yalnız karonun merkezine dön
    for (let i = 0; i < ps.e.length; i++) addEdge(R, L, ps.t[i], ps.t[i + 1], ps.e[i]);
    R.ri = 0; R.zi = -1;
  }
  R.endSnap = ps.bad ? list[list.length - 1] : -1;
  if (ps.bad) console.warn('[PX.volti] yol fiziksel komşu olmayan karo içeriyor; geçerli kısım yürünüp sona yerleştirilecek');
  densify(R); R.s = 0; R.seg = 0;
  R.rate = opts && opts.rate > 0 ? opts.rate : 1;
  showLine(R);
  if (R.len < 1e-6) { finishWalk(R); return Promise.resolve({ cancelled: false }); }
  R.vmax = R.len >= LONG_PATH - 0.01 ? SPEED_MAX : SPEED0;
  const chain = !wasMoving && !!(opts && opts.chain) && R.walkW > 0.05;
  R.speed = wasMoving ? Math.max(vKeep, SPEED0 * 0.6) : SPEED0; R.braking = false;
  R.phase = wasMoving || chain ? phKeep : R.phase;
  if (!wasMoving && !chain) { R.antic = 1; R.settle = 0; } else if (chain) { R.settle = 0; }
  R.moving = true; R.idleT = 6 + Math.random() * 6;
  return new Promise(res => { R.res = res; });
}
// yürürken yeniden kur: o anki konumdan legEnd karosunun merkezine kadar ESKİ köşeler, sonra yeni kenarlar
function rebuild(R, ps) {
  const L = S.L; const li = legIndex(R); if (li < 0 || R.N[li].c !== ps.t[0]) return false;
  const ct = R.N[li].ct; if (!ct) return false;
  const ci = R.V.indexOf(ct);
  const keep = [];
  for (let i = 0; i < R.V.length; i++) { const v = R.V[i]; if (i > ci) break; if (v.S <= R.s + 1e-6) v.gone = true; else keep.push(v); }
  const segMode = R.pm[Math.min(R.seg, R.nP - 1)];
  R.Z = R.Z.filter(z => R.V.indexOf(z.a1) <= ci && z.s1 >= R.s - ZPOST);
  R.N = R.N.slice(R.ri, li + 1);
  R.V = [{ x: R.root.position.x, y: R.pathY, z: R.root.position.z, m: segMode, n: null, c: null, S: 0, gone: false }].concat(keep);
  for (let i = 0; i < ps.e.length; i++) addEdge(R, L, ps.t[i], ps.t[i + 1], ps.e[i]);
  R.ri = 0; R.zi = -1;
  return true;
}
// sürmekte olan bacağın hedef KARO düğümü: merkezi henüz geçilmemiş ilk karo (ayırmasız)
function legIndex(R) {
  const N = R.N; if (!R.moving || !N.length) return -1;
  for (let i = R.ri; i < N.length; i++) if (N[i].k === 0 && N[i].s > R.s + 1e-9) return i;
  for (let i = N.length - 1; i >= 0; i--) if (N[i].k === 0) return i;
  return -1;
}
// yolun kalanını değiştir (§12.2): cells[0] === legEnd(); o anki bacak DURMADAN biter, sonra cells boyunca devam
function retargetRig(R, cells) {
  if (!R.moving || !S.L || !cells || !cells.length) return false;
  const ps = parseSteps(S.L, cells); if (!ps || ps.bad || !ps.t.length) return false;
  if (!rebuild(R, ps)) return false;
  R.endSnap = -1;
  densify(R); R.s = 0; R.seg = 0;
  showLine(R);
  if (R.len < 1e-6) { finishWalk(R); return true; }
  R.vmax = R.len >= LONG_PATH - 0.01 ? SPEED_MAX : SPEED0;
  R.braking = false; if (R.speed < SPEED0 * 0.6) R.speed = SPEED0 * 0.6;
  R.idleT = 6 + Math.random() * 6;
  return true;
}
function finishWalk(R) {
  const N = R.N; let last = N.length - 1; while (last > 0 && N[last].k !== 0) last--;
  const nd = N[last], ct = nd.ct, r = R.root.position;
  const X = ct ? ct.x : r.x, Y = ct ? ct.y : r.y, Z = ct ? ct.z : r.z;
  R.cell = nd.c; R.pr.cell = nd.c; R.ri = last; R.mode = 0; R.zi = -1; R.lwT = 0;
  r.set(X, Y, Z);
  R.groundY = R.pathY = Y; R.bx = X; R.by = Y; R.bz = Z;
  R.vis.position.set(0, 0, 0);
  R.settle = 1;
  const snap = R.endSnap; R.endSnap = -1;
  if (snap >= 0 && snap !== nd.c) placeRig(R, snap);
  stopMove(R, false, false);
}
// yol önizlemesi (yalnız ana rig): ayak yüksekliği + ofset (merdivende basamak burunlarının üstü)
function showLine(R) {
  if (!R.line || !PX.flow || !PX.flow.path) return;
  const n = R.nP, ly = R.ly, off = 0.5 / stairN() + 0.03;
  for (let i = 0; i < n; i++) ly[i] = R.py[i] + (R.pm[i] === 1 || (i > 0 && R.pm[i - 1] === 1) ? off : 0.035);
  PX.flow.path(R.px, ly, R.pz, R.cum, n);
}
const segV = (R, m) => (m === 1 ? V_STAIR : m === 2 ? V_LADDER : m === 3 ? V_ATT : R.vmax);
// bölge yüzeyi: basamak (adım fonksiyonu) ve düzlem; P yay parametresi
function zStep(z, P) { let q = Math.round((P - z.s0) / z.lam) * z.lam; if (q < 0) q = 0; else if (q > z.len) q = z.len; return z.h0 + z.sg * q; }
function zPlane(z, P) { let t = P - z.s0; if (t < 0) t = 0; else if (t > z.len) t = z.len; return z.h0 + z.sg * t; }
function walkUpdate(R, dt) {
  dt *= R.rate;
  // hız: parça sınırları ileriye bakarak (yavaş parçaya yaklaşırken yumuşak fren)
  let vcap = segV(R, R.pm[Math.min(R.seg, R.nP - 1)]);
  for (let j = R.seg + 1; j < R.nP - 1; j++) {
    const d = R.cum[j] - R.s; if (d > LOOK) break;
    const vl = segV(R, R.pm[j]); if (vl < vcap) { const va = Math.sqrt(vl * vl + 2 * DECEL * Math.max(0, d)); if (va < vcap) vcap = va; }
  }
  const rem = R.len - R.s;
  let ds;
  if (!R.braking && rem <= R.speed * BRAKE_T * 0.5 + 1e-9) { R.braking = true; R.brakeA = R.speed * R.speed / (2 * Math.max(rem, 1e-6)); }
  if (R.braking) {
    const v1 = R.speed - R.brakeA * dt;
    if (v1 <= 0) { ds = rem; R.speed = 0; } else { ds = (R.speed + v1) * 0.5 * dt; R.speed = v1; }
  } else {
    R.speed = R.speed < vcap ? Math.min(vcap, R.speed + ACCEL * dt) : Math.max(vcap, R.speed - DECEL * dt);
    ds = R.speed * dt;
  }
  R.s += ds;
  if (R.s >= R.len - 1e-9 || (R.braking && R.speed <= 0)) { R.s = R.len; finishWalk(R); return; }
  // konum
  const cum = R.cum; let i = R.seg;
  while (i < R.nP - 2 && cum[i + 1] < R.s) i++;
  R.seg = i;
  const l = cum[i + 1] - cum[i], u = l > 1e-12 ? (R.s - cum[i]) / l : 1;
  const X = R.px[i] + (R.px[i + 1] - R.px[i]) * u, Z = R.pz[i] + (R.pz[i + 1] - R.pz[i]) * u;
  let Y = R.py[i] + (R.py[i + 1] - R.py[i]) * u;
  const m = R.pm[i], N = R.N, ZS = R.Z, s = R.s;
  // düğüm
  let ri = R.ri; while (ri < N.length - 1 && s >= N[ri].e) ri++;
  if (ri !== R.ri) { R.ri = ri; R.cell = N[ri].c; R.pr.cell = R.cell; R.mode = N[ri].k; }
  // etkin bölge (kilitli adım fazı)
  let zi = -1;
  for (let k = 0; k < ZS.length; k++) if (s >= ZS[k].s0 - ZPRE && s <= ZS[k].s1 + ZPOST) { zi = k; break; }
  R.zi = zi;
  const zo = zi >= 0 ? ZS[zi] : null;
  let wz = 0;
  if (zo) {
    const s0 = zo.s0, s1 = zo.s1;
    wz = s < s0 ? ramp(s, s0 - ZPRE, s0 - 0.04) : s > s1 ? 1 - ramp(s, s1 + 0.04, s1 + ZPOST) : 1;
    if (zo.k === 1) Y = zPlane(zo, s);
    else if (s > s0 && s < s1) Y = zPlane(zo, s);
  }
  R.pathY = Y;
  if (zo && zo.k === 2 && s > zo.s0 && s < zo.s1)                 // iskele: kök alt ayağın hizasında (ayaklar kökün üstünde)
    Y -= (zo.lam / 2) * clamp((s - zo.s0) / 0.3, 0, 1) * clamp((zo.s1 - s) / 0.3, 0, 1);
  R.root.position.set(X, Y, Z);
  R.groundY = Y;
  // adım fazı: duruştaki ayak çakılı (yerel geri kayma 2·a·f = hız). Bölgede genlik λ/2'ye ve faz yaya kilitlenir.
  const v = ds / Math.max(dt, 1e-6);
  let a = STRIDE * clamp(0.6 + v / SPEED0 * 0.4, 0.6, 1), f = v / (2 * a);
  if (f > CAD_MAX) { f = Math.max(CAD_MAX, v / (2 * STRIDE_MAX)); a = v / (2 * f); }
  const ph0 = R.phase;
  if (zo && wz > 0) {
    const aL = zo.lam / 2; a += (aL - a) * wz;
    R.phase = (R.phase + ds / (4 * a)) % 1;
    let tgt = ((s + aL - zo.s0) / (2 * zo.lam)) % 0.5; if (tgt < 0) tgt += 0.5;
    let err = (tgt - R.phase) % 0.5; if (err > 0.25) err -= 0.5; else if (err < -0.25) err += 0.5;
    R.phase = (R.phase + err * wz + 1) % 1;
  } else R.phase = (R.phase + dt * f * 0.5) % 1;
  if ((ph0 < 0.5 && R.phase >= 0.5) || R.phase < ph0) footstep(R, zo && wz > 0.5 ? zo.k : 0);
  R.stride = a;
  // iskele ağırlığı (kollar + tırmanma pozu)
  R.lwT = zo && zo.k === 2 ? (s < zo.s0 ? ramp(s, zo.s0 - 0.2, zo.s0) : s > zo.s1 ? 1 - ramp(s, zo.s1, zo.s1 + 0.2) : 1) : 0;
  // yön: iskelede ve iskeleye bağlı parçada yüz duvara; diğerlerinde biraz ileriye bak
  R.back = false;
  if (zo && zo.k === 2 && (m === 2 || m === 3)) {
    R.yawGoal = Math.atan2(zo.fx, zo.fz);
    R.back = m === 3 && (R.px[i + 1] - R.px[i]) * zo.fx + (R.pz[i + 1] - R.pz[i]) * zo.fz < -1e-9;
  } else {
    let j = i; const la = s + 0.12; while (j < R.nP - 2 && cum[j + 1] < la) j++;
    const dx = R.px[j + 1] - R.px[j], dz = R.pz[j + 1] - R.pz[j];
    if (dx * dx + dz * dz > 1e-10 && R.pm[j] !== 2) R.yawGoal = Math.atan2(dx, dz);
  }
  if (R.line && PX.flow && PX.flow.pathCut) PX.flow.pathCut(s + 0.18);
}
// ayağın dünya yüksekliği (bölgede): yan = 0 sol, 1 sağ. Duruşta basamak/çubuk ortası; salınımda eskiden yeniye.
function footH(R, side) {
  const zo = R.Z[R.zi], a = R.stride; let u = side ? R.phase + 0.5 : R.phase; if (u >= 1) u -= 1;
  if (u < 0.5) return zStep(zo, R.s + a * (1 - 4 * u));
  const sw = (u - 0.5) * 2, P0 = R.s - a - 2 * a * sw;
  const h0 = zStep(zo, P0), h1 = zStep(zo, P0 + 4 * a);
  return h0 + (h1 - h0) * Math.min(1, sw * 1.7) + (h1 !== h0 ? 0.035 * Math.sin(PI * sw) : 0);
}
// ayak sesi: en çok ~8/s; merdivende çelik ızgara basamak, iskelede çubuk sesi
function footstep(R, kind) {
  if (R.ghost || R.walkW <= 0.5 || R.time - R.lastFoot < 0.12 || !PX.audio || !PX.audio.play) return;
  R.lastFoot = R.time; PX.audio.play(kind === 1 ? 'merdiven' : kind === 2 ? 'iskele' : 'adim', R.speed > SPEED0 + 0.5 ? FOOT_RUN : null);
}
const FOOT_RUN = { gain: 0.8 };

// ------------------------------------------------------------------ klipler
function deviceFacing(R, e) {
  const L = S.L; if (!L || e === undefined || e < 0 || !L.els[e] || L.els[e].cell < 0 || R.cell < 0) return;
  const a = L.G.xyz(L.els[e].cell), b = L.G.xyz(R.cell);
  const dx = a[0] - b[0], dz = a[2] - b[2]; if (dx || dz) { R.yawGoal = Math.atan2(dx, dz); const l = Math.hypot(dx, dz); R.cl.fx = dx / l; R.cl.fz = dz / l; }
}
// klip seçimi (süre, vuruşlar, cihaz tipi, aç/kapa yönü) — playRig ve timing() ortak kullanır (yan etkisiz)
function selectClip(cl, name, opts) {
  const def = CLIPS[name] || CLIPS.operate;
  const L = S.L, step = opts.step || null;
  const e = opts.el !== undefined && opts.el !== null ? opts.el : (step && step.a && step.a.e !== undefined ? step.a.e : -1);
  const el = L && e >= 0 ? L.els[e] : null;
  cl.name = name; cl.def = def; cl.fn = def.fn; cl.dur = def.dur; cl.beats = def.beats; cl.el = e; cl.step = step;
  cl.devT = el ? el.t : ''; cl.closing = true;
  const bef = step && step.before;
  if (name === 'operate' || (name === 'earth' && step && step.a && step.a.t === 'op')) {
    cl.name = 'operate'; cl.fn = clipOperate;
    cl.closing = el && el.bit !== undefined && bef ? !((bef.b >> el.bit) & 1) : true;
    const vk = cl.devT === 'toprak' ? (cl.closing ? 'toprakKap' : 'toprakAc') : (OP_VAR[cl.devT] ? cl.devT : 'kesici');
    cl.dur = OP_VAR[vk].dur; cl.beats = OP_VAR[vk].beats;
  } else if (name === 'earth') {
    cl.closing = bef ? !bef.st : true;
    const ev = EARTH_VAR[cl.closing ? 'kap' : 'ac']; cl.dur = ev.dur; cl.beats = ev.beats;
  } else if (name === 'lock' || name === 'unlock') {
    cl.closing = name === 'lock'; cl.beats = LOCK_VAR[cl.closing ? 'kap' : 'ac'];
  }
  if (opts.dur > 0) cl.dur = opts.dur / 1000;
  return cl;
}
function playRig(R, name, opts) {
  opts = opts || {};
  if (OVERLAYS[name]) return playOverlay(R, name, opts);
  if (R.moving) stopMove(R, true, false);
  if (R.cl.on) endClip(R, true);
  if (R.ov.on && R.ov.name !== 'reject') endOverlay(R, true);
  const cl = selectClip(R.cl, name, opts);
  cl.f1 = cl.f2 = cl.f3 = false;
  cl.t = 0; cl.k = 0; cl.bi = 0; cl.w = 1; cl.on = true; cl.fading = false;
  cl.rate = opts.rate > 0 ? opts.rate : 1;          // hayalet 2×/4× (rules R-6): klip saati de hızlanır
  cl.fx = 0; cl.fz = 0;
  if (cl.el >= 0) deviceFacing(R, cl.el);
  R.idleT = 6 + Math.random() * 6;
  return new Promise(res => { cl.res = res; });
}
// sunum zamanlaması: klibin süresi ve cihazın görsel durumunun değişeceği vuruş anı (s) — scene.js bunu kullanırsa
// cihaz, elin kola değdiği karede döner (anim:beat olayıyla aynı an)
const DEVICE_BEATS = { op: 1, beat: 1, kelepce: 1, kelepceAc: 1, kilit: 1, tak: 1, bas: 1, bekle: 1, isbit: 1 };
const _tcl = {};
function timing(name, opts) {
  opts = opts || {};
  if (OVERLAYS[name]) { const d = opts.dur > 0 ? opts.dur / 1000 : OVERLAYS[name].dur; return { dur: d, beat: d * 0.5 }; }
  const cl = selectClip(_tcl, name, opts);
  let beat = cl.dur * 0.5;
  if (cl.beats) for (let i = 0; i < cl.beats.length; i++) if (DEVICE_BEATS[cl.beats[i][1]]) { beat = cl.beats[i][0] * cl.dur; break; }
  _tcl.step = null;
  return { dur: cl.dur, beat };
}
function endClip(R, cancelled) {
  const cl = R.cl; if (!cl.on) return;
  cl.on = false; cl.fading = true;
  // normal bitiş: kemer/yedek/takım sayıları adımın sonucuna geçer (aynı karede; anim:step'i beklerken eski sayı
  // bir kare geri görünmesin). İptalde sayılar undo/reset/sync olayından gelir.
  if (!cancelled && cl.step && cl.step.after) countsFrom(R, cl.step.after);
  const r = cl.res; cl.res = null; if (r) r({ cancelled: !!cancelled });
}
function clipBeat(R, code) {
  const cl = R.cl, step = cl.step, L = S.L, A = PX.audio, el = L && cl.el >= 0 ? L.els[cl.el] : null;
  const snd = R.ghost || !A || !A.play ? null : A;
  switch (code) {
    case 'f1': cl.f1 = true; break;
    case 'f2': cl.f2 = true; break;
    case 'f3': cl.f3 = true; break;
    case 'f0': cl.f1 = false; break;
    case 'f2off': cl.f2 = false; cl.f3 = true; break;
    case 'det': if (snd) snd.play('dedektor'); break;
    case 'nod': break;
    case 'op':
      if (snd) {
        const t = cl.devT;
        snd.play(t === 'toprak' ? 'toprak' : t === 'yuk_ayirici' ? 'yuk_ayirici' : t === 'ayirici' ? 'ayirici' : cl.closing ? 'kesici_kapa' : 'kesici_ac');
      }
      emitBeat(R, 'op'); break;
    case 'ayrSes': if (snd) snd.play(cl.devT === 'toprak' ? 'toprak_ac' : 'ayirici', { closing: cl.closing }); break;
    case 'beat': emitBeat(R, 'op'); break;
    case 'kelepce': if (snd) snd.play('toprak'); emitBeat(R, 'earth'); break;
    case 'kelepceAc': if (snd) snd.play('toprak_ac'); cl.f1 = true; emitBeat(R, 'earth'); break;
    case 'kilit': if (snd) snd.play('kilit'); emitBeat(R, cl.closing ? 'lock' : 'unlock'); break;
    case 'cek': if (snd) snd.play('sigorta_cek'); break;
    case 'tak': if (snd) snd.play('sigorta_tak'); emitBeat(R, 'fuse'); break;
    case 'bas': if (snd) snd.play('buton'); emitBeat(R, 'press'); break;
    case 'bekle': if (snd) snd.play('bekle'); emitBeat(R, 'wait'); break;
    case 'is': if (snd) snd.play('is'); break;
    case 'isbit': emitBeat(R, 'work'); break;
  }
  // koruma açması / kontaktör düşmesi / çekmesi: vuruşla aynı anda (mantık zaten kabul edildi)
  if ((code === 'op' || code === 'beat' || code === 'bas' || code === 'kelepce' || code === 'tak') && snd && step) {
    if (step.trips && step.trips.length) snd.play('koruma', { delay: 0.09 });
    if (L && step.before && step.after && L.contactors && L.contactors.length) {
      let m = 0; for (let i = 0; i < L.contactors.length; i++) m |= 1 << L.contactors[i].bit;
      if ((step.before.b ^ step.after.b) & m) snd.play('kontaktor', { delay: 0.05 });
    }
  }
}
function emitBeat(R, beat) {
  if (R.ghost || !PX.bus) return;
  const cl = R.cl, step = cl.step, L = S.L;
  PX.bus.emit('anim:beat', { kind: step ? step.kind : cl.name, beat, el: L && cl.el >= 0 && L.els[cl.el] ? L.els[cl.el].id : null, elIdx: cl.el, tok: step ? step.tok : null, a: step ? step.a : null, before: step ? step.before : null, after: step ? step.after : null });
}
function playOverlay(R, name, opts) {
  const ov = R.ov, def = OVERLAYS[name];
  if (ov.on) endOverlay(R, true);
  ov.name = name; ov.fn = def.fn; ov.dur = opts && opts.dur > 0 ? opts.dur / 1000 : def.dur; ov.t = 0; ov.k = 0; ov.w = 1; ov.on = true; ov.fading = false;
  ov.f1 = !!(opts && opts.tablet); ov.f2 = !!(opts && opts.back);
  ov.skippable = name === 'win' || name === 'spawn' || IDLE_LIST.indexOf(name) >= 0;
  if (name === 'win') { const vv = VIEWS[camV()] || VIEWS[0]; R.yawGoal = Math.atan2(vv[0], vv[1]); }
  return new Promise(res => { ov.res = res; });
}
function endOverlay(R, cancelled) {
  const ov = R.ov; if (!ov.on) return;
  ov.on = false; ov.fading = true;
  const r = ov.res; ov.res = null; if (r) r({ cancelled: !!cancelled });
}
function cancelRig(R) {
  if (R.moving) stopMove(R, true, false);
  endClip(R, true);
  if (R.ov.on && R.ov.name !== 'reject') endOverlay(R, true);
  R.vis.position.set(0, 0, 0);
}

// ------------------------------------------------------------------ poz üretimi
function poseBase(R, P) {
  P.fill(0); R.gl[0] = R.gl[1] = 0;
  const t = R.time, br = Math.sin(t * 1.7);
  // boşta
  P[B.spine * 3] = 0.015 * br; P[B.head * 3] = -0.01 * br;
  P[B.uarmL * 3 + 2] = 0.11 + 0.012 * br; P[B.uarmR * 3 + 2] = -0.11 - 0.012 * br; P[B.farmL * 3] = -0.2; P[B.farmR * 3] = -0.2;
  P[B.uarmL * 3] = 0.04; P[B.uarmR * 3] = 0.04;
  P[X.pelY] = -0.005 + 0.002 * br; P[X.flz] = 0.012; P[X.frz] = -0.012;
  P[X.eye] = 1;
  // yürüyüş katmanı
  const w = R.walkW;
  if (w > 0.001) {
    const ph = R.phase, sp = clamp(R.speed / SPEED_MAX, 0, 1);
    const a = R.stride;
    const lift = 0.045;
    legCycle(ph, a, lift, KO); let lz = KO[0]; const ly = KO[1]; legCycle((ph + 0.5) % 1, a, lift, KO); let rz = KO[0]; const ry = KO[1];
    if (R.back) { lz = -lz; rz = -rz; }                                   // iskeleye geri adım: yüz duvara, hareket geriye
    // merdiven: her ayak kendi basamağında (kök eğik düzlemde)
    if (R.moving && R.zi >= 0 && R.Z[R.zi].k === 1) { const y0 = R.root.position.y; R.gl[0] = (footH(R, 0) - y0) * w; R.gl[1] = (footH(R, 1) - y0) * w; }
    const c = Math.cos(ph * TAU), s2 = Math.sin(ph * TAU);
    const lean = 0.1 + 0.1 * sp + 0.12 * R.antic;
    const bob = 0.012 * (0.5 - 0.5 * Math.cos(ph * 2 * TAU));
    P[X.flz] += (lz - P[X.flz]) * w; P[X.fly] += ly * w; P[X.frz] += (rz - P[X.frz]) * w; P[X.fry] += ry * w;
    P[X.pelY] += (-0.03 - bob - P[X.pelY]) * w;
    P[B.spine * 3] += (lean - P[B.spine * 3]) * w; P[B.spine * 3 + 1] += 0.12 * s2 * w; P[B.head * 3 + 1] -= 0.07 * s2 * w; P[B.head * 3] -= 0.5 * lean * w;
    P[B.spine * 3 + 2] += clamp(-R.yawV * 0.035, -0.18, 0.18) * w;
    const amp = 0.45 + 0.25 * sp;
    P[B.uarmL * 3] += (amp * c - P[B.uarmL * 3]) * w; P[B.uarmR * 3] += (-amp * c - P[B.uarmR * 3]) * w;
    P[B.farmL * 3] += (-0.65 - P[B.farmL * 3]) * w; P[B.farmR * 3] += (-0.65 - P[B.farmR * 3]) * w;
    P[B.uarmL * 3 + 2] += (0.16 - P[B.uarmL * 3 + 2]) * w; P[B.uarmR * 3 + 2] += (-0.16 - P[B.uarmR * 3 + 2]) * w;
  }
  // iskele: yüz duvara, ayaklar basamak çubuklarında, eller karşı ayağın 2 çubuk üstünde (sol el sağ ayakla)
  const lw = R.lw;
  if (lw > 0.001 && R.moving && R.zi >= 0 && R.Z[R.zi].k === 2) {
    const zo = R.Z[R.zi], y0 = R.root.position.y;
    const hl = footH(R, 0), hr = footH(R, 1);
    const top = Math.max(zo.h0, zo.h0 + zo.sg * zo.len) + 0.40;
    let ul = R.phase, ur = R.phase + 0.5; if (ur >= 1) ur -= 1;
    const pl = ul >= 0.5 ? Math.sin(PI * (ul - 0.5) * 2) : 0, pr = ur >= 0.5 ? Math.sin(PI * (ur - 0.5) * 2) : 0;
    P[X.flz] += (LADDER_FZ - 0.07 * pl - P[X.flz]) * lw; P[X.frz] += (LADDER_FZ - 0.07 * pr - P[X.frz]) * lw;
    P[X.fly] *= 1 - lw; P[X.fry] *= 1 - lw;
    R.gl[0] += ((hl - y0) - R.gl[0]) * lw; R.gl[1] += ((hr - y0) - R.gl[1]) * lw;
    P[X.ikL] = lw; P[X.ikLx] = 0.12; P[X.ikLy] = Math.min(hr + 0.52, top) - y0; P[X.ikLz] = LADDER_HZ;
    P[X.ikR] = lw; P[X.ikRx] = -0.12; P[X.ikRy] = Math.min(hl + 0.52, top) - y0; P[X.ikRz] = LADDER_HZ;
    P[B.spine * 3] += (0.13 - P[B.spine * 3]) * lw; P[B.spine * 3 + 1] *= 1 - lw; P[B.head * 3] += (-0.22 - P[B.head * 3]) * lw;
    P[X.pelZ] += (-0.02 - P[X.pelZ]) * lw;
  }
  // varış (yalnız son karoda çömelme)
  if (R.settle > 0) { const k = 1 - R.settle; P[X.pelY] -= 0.022 * Math.sin(PI * k) * (1 - w); P[B.spine * 3] -= 0.05 * Math.sin(PI * k) * (1 - w); }
}
// bacak döngüsü: duruş (u<0.5) zemine çakılı doğrusal geri kayma, salınım sinüs kaldırma. Salınımın ileri yolu Hermite
// kübiği: uçlardaki yerel hız duruşunkiyle aynı (−2a/s) => ayak yere hızsız değer ve hızsız kalkar (eskiden smoothstep
// uçta yerel hızı 0 yapıyordu: değme anında ayak dünyada gövdeyle birlikte kayıyordu)
function legCycle(u, a, lift, out) {
  if (u < 0.5) { out[0] = a * (1 - 4 * u); out[1] = 0; } else { const s = (u - 0.5) * 2; out[0] = a * (((12 - 8 * s) * s - 2) * s - 1); out[1] = lift * Math.sin(PI * s); }
}
function blendInto(F, A2, w) { for (let i = 0; i < NPOSE; i++) F[i] += (A2[i] - F[i]) * w; }

// ------------------------------------------------------------------ IK ve uygulama
// ayak hedefi: x = kalça eklemine göre yanal kayma, y = zeminden kaldırma, z = kök-yerel ileri; pelvis dönmez
function legIK(R, P, side, pelX, pelY, pelZ) {
  const bn = R.bones;
  const th = side > 0 ? bn[B.thighL] : bn[B.thighR], sh = side > 0 ? bn[B.shinL] : bn[B.shinR], ft = side > 0 ? bn[B.footL] : bn[B.footR];
  const fx = side > 0 ? P[X.flx] : P[X.frx], fy = Math.max(0, side > 0 ? P[X.fly] : P[X.fry]) + R.gl[side > 0 ? 0 : 1], fz = side > 0 ? P[X.flz] : P[X.frz], fp = side > 0 ? P[X.flp] : P[X.frp];
  const hy = pelY + HIP_Y, hz = pelZ;
  const dx = fx - pelX, dy = fy + ANKLE - hy, dz = fz - hz;
  const roll = Math.atan2(dx, -dy);
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const LM = LEG1 + LEG2 - 1e-4; if (d > LM) d = LM; if (d < 0.06) d = 0.06;
  const alpha = Math.atan2(dz, Math.sqrt(dy * dy + dx * dx));
  const beta = Math.acos(clamp((LEG1 * LEG1 + d * d - LEG2 * LEG2) / (2 * LEG1 * d), -1, 1));
  const knee = Math.acos(clamp((LEG1 * LEG1 + LEG2 * LEG2 - d * d) / (2 * LEG1 * LEG2), -1, 1));
  const bend = PI - knee, thx = -(alpha + beta);
  th.rotation.set(thx, 0, roll); sh.rotation.set(bend, 0, 0); ft.rotation.set(fp - thx - bend, 0, -roll);
}
// kol IK: hedef kök-yerel (yaw düğümü uzayı); omuz çerçevesi = spine
function armIK(R, P, side) {
  const w = side > 0 ? P[X.ikL] : P[X.ikR];
  const bn = R.bones, ua = bn[side > 0 ? B.uarmL : B.uarmR], fa = bn[side > 0 ? B.farmL : B.farmR], hd = bn[side > 0 ? B.handL : B.handR];
  const bu = (side > 0 ? B.uarmL : B.uarmR) * 3, bf = (side > 0 ? B.farmL : B.farmR) * 3;
  ua.rotation.set(P[bu], P[bu + 1], P[bu + 2]); fa.rotation.set(P[bf], P[bf + 1], P[bf + 2]);
  const hb = (side > 0 ? B.handL : B.handR) * 3; hd.rotation.set(P[hb], P[hb + 1], P[hb + 2]);
  if (w <= 0.001) { hd.position.y = -ARM2; return; }
  const sp = bn[B.spine];
  _m1.copy(sp.matrixWorld).invert();
  _v1.set(side > 0 ? P[X.ikLx] : P[X.ikRx], side > 0 ? P[X.ikLy] : P[X.ikRy], side > 0 ? P[X.ikLz] : P[X.ikRz]).applyMatrix4(R.yaw.matrixWorld).applyMatrix4(_m1);
  const S0 = BONES[side > 0 ? B.uarmL : B.uarmR];
  _v2.set(S0[2], S0[3], S0[4]);                                    // omuz (spine-yerel)
  _v3.subVectors(_v1, _v2); let d = _v3.length(); if (d < 1e-5) { _v3.set(0, -1, 0); d = 1e-5; }
  _v3.multiplyScalar(1 / d);                                        // Dn
  const L2 = ARM2 + HANDC;
  let ext = 0; if (d > ARM1 + L2 - 0.002) { ext = Math.min(EXT_MAX, d - (ARM1 + L2) + 0.004); }
  const L2e = L2 + ext; if (d > ARM1 + L2e - 1e-4) d = ARM1 + L2e - 1e-4; if (d < 0.04) d = 0.04;
  const cosA = clamp((ARM1 * ARM1 + d * d - L2e * L2e) / (2 * ARM1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _v4.set(side * 0.55, -1, -0.45).normalize();                      // dirsek kutbu: aşağı, dışa, geriye
  _v5.crossVectors(_v3, _v4); if (_v5.lengthSq() < 1e-8) _v5.set(1, 0, 0); _v5.normalize();   // n
  _v4.crossVectors(_v5, _v3).normalize();                          // w (kutba dik)
  _v5.copy(_v3).multiplyScalar(cosA).addScaledVector(_v4, sinA);  // üst kol yönü u
  _q1.setFromUnitVectors(DOWN, _v5);                                // üst kol (spine'a göre)
  _v4.copy(_v2).addScaledVector(_v5, ARM1);                         // dirsek
  _v1.copy(_v2).addScaledVector(_v3, d).sub(_v4).normalize();      // ön kol yönü
  _q2.setFromUnitVectors(DOWN, _v1);
  _q3.copy(_q1).invert().multiply(_q2);                             // ön kol (üst kola göre)
  ua.quaternion.slerp(_q1, w); fa.quaternion.slerp(_q3, w);
  hd.position.y = -ARM2 - ext * w;
}
function vis01(b, on) { const s = on ? 1 : 1e-4; if (b.scale.x !== s) b.scale.set(s, s, s); }
function applyPose(R) {
  const P = R.Fp, bn = R.bones;
  // pelvis: planlı ayaklar zemine ulaşabilsin diye gerekirse alçalt
  const pelX = P[X.pelX], pelZ = P[X.pelZ]; let pelY = PELVIS_Y + P[X.pelY];
  const LM = LEG1 + LEG2 - 0.003;
  for (let s = 0; s < 2; s++) {
    const fz = s ? P[X.frz] : P[X.flz], fy = Math.max(0, s ? P[X.fry] : P[X.fly]) + R.gl[s];
    const dx = (s ? P[X.frx] : P[X.flx]) - pelX, dz = fz - pelZ;
    const h2 = LM * LM - dx * dx - dz * dz; if (h2 > 0) { const hmax = fy + ANKLE + Math.sqrt(h2) - HIP_Y; if (pelY > hmax) pelY = hmax; }
  }
  bn[B.pelvis].position.set(pelX, pelY, pelZ);
  for (let i = 0; i < SIMPLE.length; i++) { const bi = SIMPLE[i]; bn[bi].rotation.set(P[bi * 3], P[bi * 3 + 1], P[bi * 3 + 2]); }
  // göz kırpma ve bakış
  const ey = Math.max(0.08, P[X.eye]); const eyeL = bn[B.eyeL], eyeR = bn[B.eyeR];
  eyeL.scale.set(1, ey, 1); eyeR.scale.set(1, ey, 1);
  eyeL.position.x = BONES[B.eyeL][2] + 0.012 * P[X.eyeX]; eyeR.position.x = BONES[B.eyeR][2] + 0.012 * P[X.eyeX];
  const ab = 0.7 + 0.3 * (Math.sin(R.time * TAU) > 0 ? 1 : 0); bn[B.ant].scale.set(ab, ab, ab);
  // bacaklar (IK; pelvis dönmez)
  legIK(R, P, 1, pelX, pelY, pelZ); legIK(R, P, -1, pelX, pelY, pelZ);
  // kollar (IK için spine dünya matrisi gerekir)
  R.yaw.updateMatrixWorld(true);
  armIK(R, P, 1); armIK(R, P, -1);
  // aletler ve sayılar
  const det = P[X.det] > 0.5;
  vis01(bn[B.pDet], det); vis01(bn[B.bkDet], !det);
  vis01(bn[B.pTab], P[X.tab] > 0.5); vis01(bn[B.pLock], P[X.lock] > 0.5); vis01(bn[B.pClamp], P[X.clamp] > 0.5);
  vis01(bn[B.pPull], P[X.pull] > 0.5); vis01(bn[B.pWrench], P[X.wrench] > 0.5);
  const nb = clamp(R.belt + Math.round(P[X.beltD]), 0, 5);
  for (let i = 0; i < 5; i++) vis01(bn[B.belt0 + i], i < nb);
  const nf = clamp(R.fuses + Math.round(P[X.fuseD]), 0, 2);
  vis01(bn[B.fuse0], nf > 0); vis01(bn[B.fuse1], nf > 1);
  vis01(bn[B.bkSet], P[X.setD] > 0.5 ? true : P[X.setD] < -0.5 ? false : R.setOn);
  // vizör parıltısı
  const g = 1 + 0.55 * clamp(P[X.glow], 0, 1.5);
  if (!R.ghost) R.matGlow.color.setRGB(R.glowBase.r * g, R.glowBase.g * g, R.glowBase.b * g);
}
const SIMPLE = new Int8Array([B.spine, B.head, B.helmet, B.ant, B.eyeL, B.eyeR, B.pDet, B.pTab, B.pLock, B.pClamp, B.pPull, B.pWrench]);

// ------------------------------------------------------------------ kare güncellemesi
function updateRig(R, dt) {
  R.time += dt;
  if (R.moving) walkUpdate(R, dt);
  // klip zamanı ve vuruşlar
  const cl = R.cl;
  if (cl.on) {
    cl.t += dt * (cl.rate || 1); cl.k = Math.min(1, cl.t / cl.dur);
    while (cl.beats && cl.bi < cl.beats.length && cl.k >= cl.beats[cl.bi][0]) { clipBeat(R, cl.beats[cl.bi][1]); cl.bi++; }
    if (cl.k >= 1) endClip(R, false);
  } else if (cl.fading) { cl.w -= dt / 0.1; if (cl.w <= 0) { cl.w = 0; cl.fading = false; } }
  const ov = R.ov;
  if (ov.on) { ov.t += dt; ov.k = Math.min(1, ov.t / ov.dur); if (ov.k >= 1) endOverlay(R, false); }
  else if (ov.fading) { ov.w -= dt / 0.08; if (ov.w <= 0) { ov.w = 0; ov.fading = false; } }
  // boşta varyantları
  if (!R.ghost && !R.moving && !cl.on && !cl.fading && !ov.on && !ov.fading) {
    R.idleT -= dt;
    if (R.idleT <= 0) {
      let i = Math.floor(Math.random() * IDLE_LIST.length); if (i === S.lastIdle) i = (i + 1) % IDLE_LIST.length; S.lastIdle = i;
      playOverlay(R, IDLE_LIST[i], null); R.idleT = 6 + Math.random() * 6;
    }
  }
  // yaw: kritik sönümlü yay (tam çözüm, her dt için kararlı)
  let err = R.yawA - R.yawGoal; err = Math.atan2(Math.sin(err), Math.cos(err));
  const ex = Math.exp(-YAW_W * dt), tmp = (R.yawV + YAW_W * err) * dt;
  const nerr = (err + tmp) * ex; R.yawV = (R.yawV - YAW_W * tmp) * ex; R.yawA = R.yawGoal + nerr;
  R.yaw.rotation.y = R.yawA;
  // katman ağırlıkları ve zamanlayıcılar
  const wt = R.moving ? 1 : 0; R.walkW += clamp(wt - R.walkW, -dt / 0.09, dt / 0.06);
  R.lw += clamp((R.moving ? R.lwT : 0) - R.lw, -dt / 0.08, dt / 0.08);
  if (R.antic > 0) R.antic = Math.max(0, R.antic - dt / 0.15);
  if (R.settle > 0) R.settle = Math.max(0, R.settle - dt / 0.2);
  R.blinkT -= dt; if (R.blinkT <= 0) { R.blink = 0.13; R.blinkT = 2.5 + Math.random() * 3; }
  if (R.blink > 0) R.blink = Math.max(0, R.blink - dt);
  // poz
  const Bp = R.Bp, Fp = R.Fp;
  poseBase(R, Bp);
  Fp.set(Bp);
  if (cl.on || cl.fading) {
    const C = R.Cp; C.set(Bp); cl.fn(C, cl.k, R, cl);
    const sf = C[X.stepF];
    if (sf > 0) {                                                       // cihaz hedeflerini kök ilerlemesine göre düzelt (gövde hedefleri değil)
      C[X.ikLz] -= sf * sstep((C[X.ikLz] - 0.2) / 0.2); C[X.ikRz] -= sf * sstep((C[X.ikRz] - 0.2) / 0.2);
    }
    if (cl.on && !R.moving) R.root.position.set(R.bx + cl.fx * sf, R.by, R.bz + cl.fz * sf);
    if (!cl.on) { C[X.beltD] = 0; C[X.fuseD] = 0; C[X.setD] = 0; }   // bitti/iptal: sayılar artık sunum durumundan
    blendInto(Fp, C, cl.on ? 1 : cl.w);
  }
  if (ov.on || ov.fading) { const O = R.Op; O.set(Fp); ov.fn(O, ov.k, R, ov); blendInto(Fp, O, ov.on ? 1 : ov.w); }
  if (R.blink > 0) Fp[X.eye] *= 0.12 + 0.88 * Math.abs(R.blink / 0.13 * 2 - 1);
  if (!cl.on && !R.moving && R.cell >= 0) R.root.position.set(R.bx, R.by, R.bz);
  applyPose(R);
  // gölge: ayak noktasında; merdivende ve iskelede söner (basamaklar ayakları zaten gösterir)
  const shT = R.moving && R.zi >= 0 && R.mode !== 0 ? 0 : 1;
  if (R.shA !== shT) { R.shA += clamp(shT - R.shA, -dt / 0.1, dt / 0.1); R.shadow.material.opacity = (R.ghost ? 0.35 : 1) * R.shA; R.shadow.visible = R.shA > 0.01; }
  R.shadow.position.set(0, 0.002, 0);
}

// ------------------------------------------------------------------ durum sayıları (sunum durumundan; saf)
function countsFrom(R, s) {
  const L = S.L; if (!L || !s) return;
  R.belt = clamp((L.kilit | 0) - pop(s.lk | 0), 0, 5);
  R.fuses = clamp(s.sp | 0, 0, 2);
  R.setOn = !!L.nSet && !s.st;
}

// ------------------------------------------------------------------ genel API
function init() {
  if (S.inited) return; S.inited = true;
  makeAtlas(); S.shadowTex = makeShadowTex();
  buildGeometry();
  S.main = makeRig(false);
  S.ghost = makeRig(true);
  warm(makeRig(false), 96);   // kısa dilimlerle ~11 bin çağrı: yayımdaki sıkıştırılmış poz zinciri de optimize olur
  try { const k = PX.store && PX.store.get && PX.store.get('kozmetik.kask'); if (k && KASK[k]) setCosmetic({ kask: k }); } catch (e) { /* kayıt yok */ }
  if (PX.bus) {
    PX.bus.on('cmd:rejected', p => {
      if (!p || p.err === 'bos' || p.err === 'tampon' || p.err === 'kazanildi') return;
      const R = S.main; const idle = !R.moving && !R.cl.on;
      playOverlay(R, 'reject', { tablet: idle, back: p.err === 'tehlike' });
    });
    PX.bus.on('win', () => { playOverlay(S.main, 'win', null); });
    PX.bus.on('level:loaded', p => {
      const lv = p && p.level; const ch = lv && lv.bolum !== undefined ? lv.bolum : 0;
      setVisorDamage([1, 0.72, 0.42, 0.18][clamp(ch | 0, 0, 3)]);
      if (p && p.s) countsFrom(S.main, p.s);
      playOverlay(S.main, 'spawn', null);
    });
    PX.bus.on('anim:step', p => { if (p && p.after) countsFrom(S.main, p.after); });
    PX.bus.on('undo', p => { if (p && p.s) countsFrom(S.main, p.s); });
    PX.bus.on('reset', p => { if (p && p.s) countsFrom(S.main, p.s); });
    PX.bus.on('cmd:accepted', () => { const R = S.main; R.idleT = 6 + Math.random() * 6; if (R.ov.on && IDLE_LIST.indexOf(R.ov.name) >= 0) endOverlay(R, true); });
  }
  window.addEventListener('pointerdown', () => {
    const R = S.main; if (!R) return; R.idleT = 6 + Math.random() * 6;
    if (R.ov.on && R.ov.skippable) endOverlay(R, true);       // kutlama / doğuş / boşta: dokunuş atlar
  }, { passive: true, capture: true });
}
// JIT ısıtması (kare başına ayırma): poz zinciri karede bir kez çağrıldığından V8 onu ~20 s boyunca Sparkplug'da tutar
// ve her ara double bir HeapNumber olur (boşta 1–2,5 KB/kare). Açılışta sahnede olmayan bir kopya rig (aynı şekil)
// küçük parçalarla yürüyüş + kol IK'lı klip + boşta sürülür => TurboFan erken; ana rig ve olaylar etkilenmez (vuruş/ses yok).
function warm(R, n) {
  R.lastFoot = 1e9; R.line = false;                                  // ısınma rig'i yol önizlemesine dokunmaz
  for (let i = 0; i < 120; i++) {
    if (!R.moving && !R.cl.on && i % 60 === 0) {
      R.V = []; R.N = []; R.Z = []; vP(R, 0, 0.5, 0, 0, nP(R, 0, 0)); const n1 = nP(R, 0, 0); vP(R, 0, 0.5, 0.5, 0, n1); vP(R, 0, 0.5, 1, 0, null, n1);
      densify(R); R.s = 0; R.seg = 0; R.endSnap = -1; R.zi = -1; R.moving = true; R.speed = SPEED0; R.vmax = SPEED0; R.rate = 1; R.ri = 0;
    } else if (!R.moving && !R.cl.on && i % 60 === 30) { playRig(R, 'operate', {}); R.cl.beats = null; }
    updateRig(R, 1 / 60);
  }
  if (n > 1) setTimeout(() => warm(R, n - 1), 20);
  else { R.matBody.dispose(); R.matGlow.dispose(); R.shadow.geometry.dispose(); R.shadow.material.dispose(); }
}
function attach(R) {
  const sc = PX.scene && PX.scene.scene; if (!sc) return;
  if (R.root.parent !== sc) sc.add(R.root);
}
function setLevel(L, s) {
  if (!S.inited) init();
  S.L = L;
  const R = S.main;
  cancelRig(R); R.cl.fading = false; R.cl.w = 0; R.ov.fading = false; R.ov.w = 0;
  attach(R);
  R.cell = -1; placeRig(R, s.p);
  const vv = VIEWS[typeof s.v === 'number' ? s.v & 3 : (L.view0 | 0) & 3] || VIEWS[0]; R.yawGoal = R.yawA = Math.atan2(vv[0], vv[1]) + 0.35; R.yawV = 0;
  R.walkW = 0; R.settle = 0; R.antic = 0;
  countsFrom(R, s);
  const G = S.ghost; cancelRig(G); G.cell = -1;
  if (S.ghostOn) { attach(G); placeRig(G, s.p); countsFrom(G, s); }
  S.quality = (PX.scene && PX.scene.quality) || 'orta';
  updateRig(R, 0);
}
function update(dt) {
  if (!S.L || !S.main) return;
  updateRig(S.main, dt);
  if (S.ghostOn && S.ghost.root.visible) updateRig(S.ghost, dt);
}
const MODE_NAME = ['karo', 'merdiven', 'iskele'];
function probeRig(R) {
  const p = R.pr, r = R.root.position;
  p.x = r.x; p.y = r.y; p.z = r.z; p.footY = r.y; p.groundY = R.cell >= 0 ? R.groundY : NaN; p.cell = R.cell; p.arc = false; p.moving = R.moving;
  p.mode = MODE_NAME[R.mode] || 'karo';
  if (R.mode === 0) p.tile = R.cell;
  return p;
}
function camV() { const C = PX.camera; if (C && typeof C.az === 'number' && C.viewOfAz) return C.viewOfAz(C.az); return C && typeof C.v === 'number' ? C.v & 3 : 0; }
function setCosmetic(o) {
  if (!o) return;
  if (o.kask && KASK[o.kask]) { S.kask = o.kask; recolorHelmet(GEO.body, KASK[o.kask]); }
}
function setVisorDamage(d) { d = clamp(+d || 0, 0, 1); if (Math.abs(d - atlasDamage) > 1e-3) drawAtlas(d); S.damage = d; }
const ghostApi = {
  place(c, v, s) { if (!S.ghostOn || !S.L) return; attach(S.ghost); placeRig(S.ghost, c); if (s) countsFrom(S.ghost, s); },
  followPath(cells, opts) { if (!S.ghostOn) return Promise.resolve({ cancelled: true }); return followPathRig(S.ghost, cells, opts); },
  play(clip, opts) { if (!S.ghostOn) return Promise.resolve({ cancelled: true }); return playRig(S.ghost, clip, opts); },
  cancel() { cancelRig(S.ghost); },
  probe() { return probeRig(S.ghost); },
  get visible() { return S.ghostOn; },
};
function ghost(on, opts) {
  if (!S.inited) init();
  const G = S.ghost; S.ghostOn = !!on; G.visible = S.ghostOn; G.root.visible = S.ghostOn;
  if (S.ghostOn) {
    attach(G);
    const q = (PX.scene && PX.scene.quality) || S.quality;
    const low = q === 'dusuk' || q === 'düşük';
    G.matBody.transparent = !low; G.matBody.opacity = low ? 1 : 0.32; G.matBody.depthWrite = low; G.matBody.color.setHex(low ? 0x2a6f86 : 0x5cf0ff);
    G.matGlow.visible = !low; G.shadow.visible = !low; G.matBody.needsUpdate = true;
    if (S.L && G.cell < 0) { const st = PX.game && PX.game.state ? PX.game.state() : null; if (st && st.s) { placeRig(G, st.s.p); countsFrom(G, st.s); } }
    if (opts && opts.cell !== undefined) placeRig(G, opts.cell);
  } else { cancelRig(G); G.cell = -1; if (G.root.parent) G.root.parent.remove(G.root); }
  return ghostApi;
}
function info() {
  const R = S.main;
  return { drawCalls: R ? (R.root.visible ? 3 : 0) + (S.ghostOn ? 3 : 0) : 0, tris: GEO.tris, bones: NB, verts: GEO.body ? GEO.body.attributes.position.count + GEO.glow.attributes.position.count : 0,
    clip: R && R.cl.on ? R.cl.name : null, overlay: R && R.ov.on ? R.ov.name : null, moving: R ? R.moving : false, speed: R ? R.speed : 0, damage: S.damage, kask: S.kask };
}
PX.volti = {
  init, setLevel, update, info, ghost, setCosmetic, setVisorDamage,
  place(c, v, s) { if (!S.main || !S.L) return; placeRig(S.main, c); if (s) countsFrom(S.main, s); },
  followPath(cells, opts) { if (!S.main) return Promise.resolve({ cancelled: true }); return followPathRig(S.main, cells, opts); },
  play(clip, opts) { if (!S.main || !S.L) return Promise.resolve({ cancelled: true }); return playRig(S.main, clip, opts); },
  cancel() { if (S.main) cancelRig(S.main); },
  legEnd() { const R = S.main; if (!R) return -1; const i = legIndex(R); return i < 0 ? -1 : R.N[i].c; },
  retarget(cells) { return S.main ? retargetRig(S.main, cells) : false; },
  get moving() { return !!(S.main && S.main.moving); },
  probe() { return S.main ? probeRig(S.main) : { x: 0, y: 0, z: 0, footY: 0, groundY: NaN, cell: -1, arc: false, moving: false }; },
  get root() { return S.main ? S.main.root : null; },
  get rig() { return S.main; },
  get ghostRig() { return ghostApi; },
  timing,
  CLIP_MS: { operate: 380, ayirici: 520, yuk_ayirici: 450, lock: 600, unlock: 600, earth: 900, fuse: 700, press: 250, work: 700, wait: 400, reject: 300, win: 900, spawn: 420 },
};
