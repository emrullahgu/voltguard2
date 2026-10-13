// ============================================================================
// render/kit/structure.js — fiziksel dünya yapıları (kural sürümü 4, §25): çelik merdiven, el merdiveni (iskele),
// hücre kapısı (kapı kilitlemesi), duvar (%) ve platform kenarı korkuluğu.            sahip: Render
// Hepsi kit çekirdeğinin (common.js) Bld kurucusu + TEK paylaşımlı malzeme (atlas) ile; yapı başına 1 çizim çağrısı,
// duvar ve korkuluk InstancedMesh (diorama kurar). Kare başına ayırma yok.
//   PX.KIT.merdiven(st, L, biyom) -> kit arayüzü   st = L.stairs[i] {cell, dir, lo, hi}; yerel +z = YUKARI çıkış yönü
//        Yürüme yüzeyi (Volti'nin kök/ayak noktası): eğik düzlem y = z (hücre içinde −0,5 → +0,5). Basamaklar düzlemin
//        ortasından geçer: n = STAIR_N rıht, basamak i (1..n−1) yüksekliği i/n − 0,5, derinliği 1/n, merkezi z = i/n − 0,5.
//        Açık yanlarda (komşu hücre katı değilse) sarı korkuluk (dikme + küpeşte + ara lama), kaymaz sarı burun bandı.
//   PX.KIT.iskele(ld, L, biyom) -> kit arayüzü   ld = L.ladders[i] {cells (aşağıdan yukarı), dir, foot, top}
//        Köken = en alt iskele hücresinin merkezi, yerel +z = duvara doğru. Basamak çubukları her 1/LADDER_N'de,
//        z = LADDER_Z düzleminde; dikmeler sahanlığın 0,42 üstüne uzar (tutunma), yükselti ≥ 2 ise kafes.
//   PX.KIT.kapi(el, biyom) -> kit arayüzü (sim2 eleman tipi 'kapi'): dış kenar(lar)da çelik kasa + tel kafes kanat.
//        setState({closed}) kapalı = kanat kasada + kırmızı asma kilit ve kilitleme levhası; açık = kanat 90° içe döner.
//   PX.KIT.structGeo(biyom) -> {wallMid(), wallTop(), rail()} geometri kurucuları (seviyeye özgü: diorama yalnız
//        gerekeni kurar, clear() atar — leak paketi: GPU geometri sayısı seviyeler arasında sabit)
// Geometriler ve dokular LIB.Bld/LIB.R (common.js) ile; hiçbiri her karede yeniden kurulmaz.
// ============================================================================
const LIB = PX.KITLIB, KIT = PX.KIT;
if (LIB) {
const R = LIB.R, P = LIB.P, PI = Math.PI;
const STAIR_N = 5, LADDER_N = 4, LADDER_Z = 0.30;
const RAIL_H = 0.46, RAIL_MID = 0.24;
const YEL = 0xf2b705, YEL_D = 0xc99604, GALV = 0x9aa3aa, DARK = 0x3a4148;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const yawOf = d => Math.atan2(DIRS[d][0], DIRS[d][1]);
function fakeEl(t, cell, id) { return { t, id: id || '', i: -1, cell, ad: '' }; }
// a -> b doğrultusunda kutu (kesit w × h; "yukarı" yönü dünya +y'ye en yakın dik): eğik korkuluk/kiriş için
const _u = [0, 0, 0];
function beam(b, ax, ay, az, bx, by, bz, w, h) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz); if (L < 1e-6) return;
  const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  b.push().at((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2).ry(yaw).rx(pitch).box(-w / 2, -h / 2, -L / 2, w / 2, h / 2, L / 2).pop();
  void _u;
}
function post(b, x, y0, y1, z, s) { b.box(x - s, y0, z - s, x + s, y1, z + s); }

// ---------------------------------------------------------------- merdiven
KIT.merdiven = function (st, L, biyom) {
  const k = new LIB.Kit(fakeEl('merdiven', st.cell), biyom, { L, yaw: yawOf(st.dir), kv: 0.4 });
  const b = k.b, G = L.G, n = STAIR_N;
  const [cx, cy, cz] = G.xyz(st.cell);
  // yan açıklığı: yerel +x / −x dünyada nereye düşer (ry(yaw): yerel (1,0,0) -> (cos, 0, −sin))
  const yw = yawOf(st.dir), sxx = Math.round(Math.cos(yw)), sxz = Math.round(-Math.sin(yw));
  const open = sg => { const q = G.idx(cx + sg * sxx, cy, cz + sg * sxz); return !(q >= 0 && G.solid(q)); };
  const W = 0.40;                                                     // basamak yarı genişliği
  // limonlar (C profil, koyu galvaniz): eğik düzlemin 0,02 altında üst kenar
  for (const sg of [-1, 1]) {
    b.color(DARK); beam(b, sg * (W + 0.025), -0.5 - 0.04, -0.5 + 0.02, sg * (W + 0.025), 0.5 - 0.04, 0.5 + 0.02, 0.05, 0.12);
    b.color(0x262b30).box(sg * (W + 0.025) - 0.03, -0.5, 0.36, sg * (W + 0.025) + 0.03, 0.5 - 0.10, 0.47);     // üst bağlantı levhası
  }
  b.color(0x262b30).box(-W - 0.05, -0.5, -0.5, W + 0.05, -0.47, -0.36);                                         // ayak levhası
  // basamaklar: ızgara (GRILLE) + sarı burun
  for (let i = 1; i <= n; i++) {
    const y = i / n - 0.5, z0 = (i - 0.5) / n - 0.5 + 0.006, z1 = Math.min(0.5, (i + 0.5) / n - 0.5) - 0.004, t = 0.03;
    b.color(GALV).box(-W, y - t, z0, W, y, z1, { t: R('GRILLE'), f: null, k: null, l: null, r: null });
    b.color(YEL).box(-W, y - t - 0.004, z0 - 0.004, W, y + 0.003, z0 + 0.045);                                 // kaymaz burun bandı
    b.color(0x30363c).box(-W, y - t - 0.03, z0, W, y - t, z0 + 0.012);                                         // basamak alın sacı
  }
  // korkuluk: dikme (alt, orta, üst) + küpeşte + ara lama (yalnız açık yanlarda)
  for (const sg of [-1, 1]) {
    if (!open(sg)) continue;
    const x = sg * (W + 0.03);
    b.color(YEL);
    for (const zp of [-0.40, 0.0, 0.40]) post(b, x, zp - 0.04, zp + RAIL_H, zp, 0.022);
    b.color(YEL); beam(b, x, -0.40 - 0.02 + RAIL_H, -0.40, x, 0.40 + RAIL_H, 0.40, 0.045, 0.045);
    b.color(YEL_D); beam(b, x, -0.40 + RAIL_MID, -0.40, x, 0.40 + RAIL_MID, 0.40, 0.03, 0.03);
  }
  k.anchor.set(0, 0, 0);
  const iface = k.finish();
  iface.info.kind = 'merdiven'; iface.info.n = n;
  return iface;
};
KIT.merdiven.N = STAIR_N;

// ---------------------------------------------------------------- iskele (sabit el merdiveni)
KIT.iskele = function (ld, L, biyom) {
  const k = new LIB.Kit(fakeEl('iskele', ld.cells[0]), biyom, { L, yaw: yawOf(ld.dir), kv: 0.4 });
  const b = k.b, rise = ld.cells.length, top = -0.5 + rise, Z = LADDER_Z, HW = 0.17;
  const ext = 0.42;                                                      // sahanlık üstü tutunma uzantısı
  // dikmeler (sarı) + duvara bağlantı konsolları
  b.color(YEL);
  for (const sg of [-1, 1]) {
    b.box(sg * HW - 0.02, -0.5, Z - 0.02, sg * HW + 0.02, top + ext - 0.06, Z + 0.02);
    beam(b, sg * HW, top + ext - 0.06, Z, sg * HW, top + ext - 0.02, Z + 0.22, 0.04, 0.04);                     // kaz boynu (sahanlığa kıvrılır)
    b.color(YEL).box(sg * HW - 0.02, top - 0.02, Z + 0.20, sg * HW + 0.02, top + ext - 0.02, Z + 0.24);
    b.color(DARK);
    for (let y = -0.2; y < top; y += 0.5) b.box(sg * HW - 0.015, y - 0.02, Z + 0.02, sg * HW + 0.015, y + 0.02, 0.5);
    b.color(YEL);
  }
  // basamak çubukları (yuvarlak profil yerine kare kesit; okunurluk)
  b.color(0xd8dde2);
  for (let j = 1; j < rise * LADDER_N; j++) { const y = -0.5 + j / LADDER_N; b.box(-HW, y - 0.016, Z - 0.016, HW, y + 0.016, Z + 0.016); }
  // ayak levhası
  b.color(0x262b30).box(-HW - 0.05, -0.5, Z - 0.05, HW + 0.05, -0.48, Z + 0.06);
  // kafes: yükselti ≥ 2 -> tabandan 1 hücre yukarıdan tepeye; yükselti 1 -> yalnız sahanlık üstünde emniyet çemberi
  const hoopAt = y => {
    const R0 = 0.36, cz = Z + 0.02, seg = 7, pts = [];
    for (let i = 0; i <= seg; i++) { const a = PI * (i / seg); pts.push([-Math.cos(a) * R0, cz - Math.sin(a) * R0 * 0.95]); }
    b.color(YEL);
    for (let i = 0; i < seg; i++) beam(b, pts[i][0], y, pts[i][1], pts[i + 1][0], y, pts[i + 1][1], 0.03, 0.035);
    beam(b, -R0, y, cz, -HW, y, Z, 0.03, 0.035); beam(b, R0, y, cz, HW, y, Z, 0.03, 0.035);
    return pts;
  };
  if (rise >= 2) {
    const y0 = 0.5, ys = []; for (let y = y0; y <= top + ext - 0.05; y += 0.34) ys.push(y);
    let pts = null; for (const y of ys) pts = hoopAt(y);
    b.color(YEL_D);
    if (pts) for (const i of [1, 3, 4, 6]) b.box(pts[i][0] - 0.012, ys[0], pts[i][1] - 0.012, pts[i][0] + 0.012, ys[ys.length - 1], pts[i][1] + 0.012);
  } else hoopAt(top + ext - 0.10);
  k.anchor.set(0, 0, 0);
  const iface = k.finish();
  iface.info.kind = 'iskele'; iface.info.rise = rise;
  return iface;
};
KIT.iskele.N = LADDER_N; KIT.iskele.Z = LADDER_Z;

// ---------------------------------------------------------------- hücre kapısı (tel kafes kanat, kapı kilitlemesi)
// Kasa, kapı karosunun DIŞ kenar(lar)ında: kapalıyken karoya girilemez (sim2 passMap), açıkken Volti kasanın içinden geçer.
KIT.kapi = function (el, biyom) {
  const L = LIB.curL(el);
  const k = new LIB.Kit(el, biyom, { L, yaw: 0, kv: 0.4 });
  const b = k.b; const edges = [];
  if (L && L.doors && el.di !== undefined && L.doors[el.di]) {
    const d = L.doors[el.di], ti = L.tileIdx[d.tile];
    for (const e of (L.adj[ti] || [])) if (!d.inner[e.to] && edges.indexOf(e.d) < 0) edges.push(e.d);
  }
  if (!edges.length) edges.push(2);
  const H = 0.36, HW = 0.44;
  const leafs = [];
  edges.forEach((d, i) => {
    b.push().ry(yawOf(d));                                                // yerel +z = dış kenar
    const zf = 0.45;
    // kasa: iki dikme + lento + eşik (emniyet sarısı)
    b.color(YEL);
    b.box(-HW - 0.03, -0.5, zf - 0.03, -HW + 0.03, H + 0.06, zf + 0.03).box(HW - 0.03, -0.5, zf - 0.03, HW + 0.03, H + 0.06, zf + 0.03);
    b.box(-HW - 0.03, H, zf - 0.035, HW + 0.03, H + 0.10, zf + 0.035);
    b.color(0x2a2f35).box(-HW, -0.5, zf - 0.03, HW, -0.485, zf + 0.03);
    // lento lambası: kırmızı = kilitli (kapı kilitlemesi), yeşil = açık
    b.color(0xffffff).begin('lamp' + i);
    b.box(HW - 0.11, H + 0.10, zf - 0.03, HW - 0.03, H + 0.135, zf + 0.03, R('LAMP_R'));
    b.end();
    // lento levhası (kimlik) + kilitleme levhası
    const lab = LIB.label('-' + (el.id || ''), 'plate');
    b.color(0xffffff).quad(-0.14, H + 0.012, zf + 0.037, 0.14, H + 0.012, zf + 0.037, 0.14, H + 0.088, zf + 0.037, -0.14, H + 0.088, zf + 0.037, lab);
    b.quad(0.14, H + 0.012, zf - 0.037, -0.14, H + 0.012, zf - 0.037, -0.14, H + 0.088, zf - 0.037, 0.14, H + 0.088, zf - 0.037, lab);
    // kanat: menteşe −x dikmesinde; tel kafes + çerçeve + kilit
    const part = 'leaf' + i; b.begin(part);
    const x0 = -HW + 0.035, x1 = HW - 0.035, y0 = -0.47, y1 = H - 0.015, zl = zf;
    b.color(0x8d969e).box(x0, y0, zl - 0.015, x1, y0 + 0.035, zl + 0.015).box(x0, y1 - 0.035, zl - 0.015, x1, y1, zl + 0.015)
      .box(x0, y0, zl - 0.015, x0 + 0.035, y1, zl + 0.015).box(x1 - 0.035, y0, zl - 0.015, x1, y1, zl + 0.015)
      .box(x0, (y0 + y1) / 2 - 0.015, zl - 0.012, x1, (y0 + y1) / 2 + 0.015, zl + 0.012);
    b.color(0xffffff);
    b.quad(x0 + 0.035, y0 + 0.035, zl + 0.004, x1 - 0.035, y0 + 0.035, zl + 0.004, x1 - 0.035, y1 - 0.035, zl + 0.004, x0 + 0.035, y1 - 0.035, zl + 0.004, R('GRILLE'));
    b.quad(x1 - 0.035, y0 + 0.035, zl - 0.004, x0 + 0.035, y0 + 0.035, zl - 0.004, x0 + 0.035, y1 - 0.035, zl - 0.004, x1 - 0.035, y1 - 0.035, zl - 0.004, R('GRILLE'));
    b.color(0xffffff).quad(-0.09, -0.32, zl + 0.018, 0.09, -0.32, zl + 0.018, 0.09, -0.14, zl + 0.018, -0.09, -0.14, zl + 0.018, R('DANGER'));
    b.color(P.handle || 0x23272c).box(x1 - 0.09, -0.06, zl + 0.015, x1 - 0.06, 0.06, zl + 0.04);
    b.end();
    // kilit (kapalıyken): dışa bakan yüzde kırmızı asma kilit + turuncu etiket
    b.begin('lock' + i);
    b.color(0xd32f2f).box(x1 - 0.17, 0.02, zl + 0.03, x1 - 0.03, 0.15, zl + 0.08);
    b.color(0xb0b6bb).box(x1 - 0.15, 0.15, zl + 0.045, x1 - 0.125, 0.21, zl + 0.065).box(x1 - 0.075, 0.15, zl + 0.045, x1 - 0.05, 0.21, zl + 0.065).box(x1 - 0.15, 0.19, zl + 0.045, x1 - 0.05, 0.21, zl + 0.065);
    b.color(0x1b1b1b).box(x1 - 0.11, 0.06, zl + 0.08, x1 - 0.09, 0.10, zl + 0.083);
    b.color(0xffffff).quad(x1 - 0.17, -0.13, zl + 0.085, x1 - 0.01, -0.13, zl + 0.085, x1 - 0.01, 0.02, zl + 0.082, x1 - 0.17, 0.02, zl + 0.082, R('LOCKTAG'));
    // lento üstünde büyük kilit (her izometrik görünümden okunur): kapı kilitlemesi etkin
    const ty = H + 0.10;
    b.color(0xd32f2f).box(-0.08, ty, zf - 0.045, 0.08, ty + 0.10, zf + 0.045);
    b.color(0xb0b6bb).box(-0.06, ty + 0.10, zf - 0.015, -0.035, ty + 0.16, zf + 0.015).box(0.035, ty + 0.10, zf - 0.015, 0.06, ty + 0.16, zf + 0.015).box(-0.06, ty + 0.14, zf - 0.015, 0.06, ty + 0.16, zf + 0.015);
    b.color(0x1b1b1b).box(-0.012, ty + 0.03, zf + 0.045, 0.012, ty + 0.07, zf + 0.049);
    b.end();
    b.pop();
    leafs.push({ part, lock: 'lock' + i, hx: Math.cos(yawOf(d)) * x0 + Math.sin(yawOf(d)) * zl, hz: -Math.sin(yawOf(d)) * x0 + Math.cos(yawOf(d)) * zl, lx: Math.cos(yawOf(d)) * (x1 - 0.08) + Math.sin(yawOf(d)) * (zl + 0.05), lz: -Math.sin(yawOf(d)) * (x1 - 0.08) + Math.cos(yawOf(d)) * (zl + 0.05) });
  });
  k.anchor.set(0, 0, 0);
  // açılma: menteşe ekseni dünya y; kanat içe (−yerel z) 90° döner. Kilit kapalı = görünür.
  const sw = k.chan(0.34, v => { for (const lf of leafs) { k.rotate(lf.part, lf.hx, 0, lf.hz, 1, v * PI * 0.5); } });
  const lk = k.chan(0.16, v => { for (const lf of leafs) k.scale(lf.lock, lf.lx, 0.1, lf.lz, v); });
  // açıkken kilit kanatla birlikte dönmez: kilit yalnız kapalıyken görünür (ölçek 0 -> 1)
  k.onState = (st, prev, snap) => {
    k.go(sw, st.closed ? 0 : 1, snap); k.go(lk, st.closed ? 1 : 0, snap);
    for (let i = 0; i < leafs.length; i++) k.region('lamp' + i, R(st.closed ? 'LAMP_R' : 'LAMP_G'));
  };
  const iface = k.finish();
  iface.info.kind = 'kapi'; iface.info.edges = edges.slice();
  return iface;
};

// ---------------------------------------------------------------- duvar (%) ve platform korkuluğu (paylaşımlı geometri)
// Duvar: beton blok örgü (yanlar), tepesi DÖŞEME GİBİ GÖRÜNMEZ: 0,08 yükseltilmiş, taşan beton başlık + koyu derz +
// sarı-siyah uyarı şeridi (üstüne basılmaz). wallMid: üstünde başka dolu hücre olan duvar (başlıksız).
function lin() { const r = PX.scene && PX.scene.renderer; return r ? r.outputEncoding === THREE.sRGBEncoding : true; }
KIT.structGeo = function (biyom) {
  const key = LIB.biyomKey(biyom);
  const wallCol = key === 'Volt Mahallesi' ? 0xb8b2a4 : key === 'Trafo Merkezi' ? 0xb4b2aa : 0xb9bbb6;
  const mk = withCap => {
    const b = new LIB.Bld(lin());
    b.color(wallCol);
    b.quad(0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, R('CONCRETE'));
    b.quad(-0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, R('CONCRETE'));
    b.quad(-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, R('CONCRETE'));
    b.quad(0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, R('CONCRETE'));
    // blok derzleri (yatay): her yüzde iki koyu çizgi
    b.color(0x7d7b74);
    for (const y of [-0.17, 0.16]) {
      b.box(-0.502, y - 0.008, -0.502, 0.502, y + 0.008, -0.49).box(-0.502, y - 0.008, 0.49, 0.502, y + 0.008, 0.502)
        .box(-0.502, y - 0.008, -0.49, -0.49, y + 0.008, 0.49).box(0.49, y - 0.008, -0.49, 0.502, y + 0.008, 0.49);
    }
    if (withCap) {
      // başlık: taşan, kenarları pahlı beton; tepe ortası çukur ve koyu (yürüme yüzeyi değil: korkuluk/parapet dili)
      b.color(0x5f5d58).box(-0.535, 0.43, -0.535, 0.535, 0.445, 0.535);                                    // damlalık derzi
      b.color(0x9a978f).box(-0.53, 0.445, -0.53, 0.53, 0.57, 0.53, { t: R('CONCRETE') });
      b.color(0x6a6862).box(-0.40, 0.57, -0.40, 0.40, 0.574, 0.40);                                        // tepe (koyu)
      b.color(0xb3b0a8);
      b.box(-0.53, 0.57, -0.53, 0.53, 0.60, -0.40).box(-0.53, 0.57, 0.40, 0.53, 0.60, 0.53)                // yükseltilmiş kenar
        .box(-0.53, 0.57, -0.40, -0.40, 0.60, 0.40).box(0.40, 0.57, -0.40, 0.53, 0.60, 0.40);
    } else b.color(wallCol).quad(-0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, R('CONCRETE'));
    return b.geometry();
  };
  // korkuluk parçası: yerel x boyunca bir kenar (−0,5..0,5), y = 0 zemin; dikme uçta, küpeşte, ara lama, etek tahtası
  const rail = () => {
    const b = new LIB.Bld(lin());
    b.color(YEL);
    b.box(-0.5, 0, -0.022, -0.456, RAIL_H, 0.022).box(0.456, 0, -0.022, 0.5, RAIL_H, 0.022);
    b.box(-0.5, RAIL_H - 0.04, -0.024, 0.5, RAIL_H, 0.024);
    b.color(YEL_D).box(-0.5, RAIL_MID - 0.015, -0.016, 0.5, RAIL_MID + 0.015, 0.016);
    b.color(0xffffff).box(-0.5, 0, -0.012, 0.5, 0.07, 0.012, R('HAZARD'));
    return b.geometry();
  };
  return { wallMid: () => mk(false), wallTop: () => mk(true), rail };
};
KIT.structGeo.RAIL_H = RAIL_H;
}
