// ============================================================================
// render/kit/props.js — biyom dekorları (ızgara DIŞINDA, oynanışı asla örtmez)            sahip: Sanat (kits)
//   PX.KIT.props(L, biyom) -> {obj, setWarm(k), info} | null
//   Seviye kutusunun dört köşegen köşesinde birer küçük yüzen ada (zemin + dekor). TEK Mesh, tek çizim çağrısı,
//   paylaşımlı kit malzemesi. Bir köşe YALNIZ kameranın arka tarafındayken (köşe yönü · kamera yönü < −0,3)
//   çizilir: arkadaki nesne derinlik testiyle oynanışın arkasında kalır, öne hiç geçmez. Döndürme sırasında köşe
//   eşik geçince (tek seferlik köşe yeniden yazımı, ayırmasız) çöker/geri gelir; eşik payı 1 karelik gecikmeyi örter.
//   setWarm(k 0..1): gece soğuk mavi acil ışık -> sıcak (≥ 0,5) lamba bölgeleri; PX.scene.warm her karede okunur.
// Diorama entegrasyonu (render ekibi): build() sonunda
//   const p = PX.KIT.props && PX.KIT.props(L, D.biyom); if (p) { PX.scene.root.add(p.obj); D.levelObjs.push(p.obj); }
// ============================================================================
const LIB = PX.KITLIB, KIT = PX.KIT;
if (LIB) {
const R = LIB.R, P = LIB.P;

function islet(k, cx, cz, top, kind) {
  const b = k.b;
  const tex = kind === 'cimen' ? null : R(kind === 'asfalt' ? 'ASPHALT' : 'CONCRETE');
  const col = kind === 'cimen' ? 0x3f6630 : kind === 'cakil' ? 0x7d7a72 : kind === 'asfalt' ? 0xc8c8c8 : 0x8f8b82;
  b.color(col).box(cx - 0.78, top - 0.12, cz - 0.78, cx + 0.78, top, cz + 0.78, { t: tex, all: null });
  b.color(0x5a4636).box(cx - 0.7, top - 0.34, cz - 0.7, cx + 0.7, top - 0.12, cz + 0.7);
  b.color(0x45362a).box(cx - 0.5, top - 0.56, cz - 0.5, cx + 0.5, top - 0.34, cz + 0.5);
  b.color(0x372b22).box(cx - 0.24, top - 0.74, cz - 0.24, cx + 0.24, top - 0.56, cz + 0.24);
}
function streetLamp(k, x, y, z, h) {
  const b = k.b;
  b.color(0xa9a59a).push().at(x, y, z).cyl(0.07, 0.045, 0, h, 8, null, null).pop();         // beton direk
  b.color(0x8d887c).box(x - 0.03, y + h - 0.04, z - 0.03, x + 0.36, y + h, z + 0.03);
  b.color(0x30353b).box(x + 0.22, y + h - 0.08, z - 0.07, x + 0.42, y + h - 0.02, z + 0.07);
  b.begin('lampW'); b.color(0xffffff).quad(x + 0.24, y + h - 0.081, z + 0.05, x + 0.40, y + h - 0.081, z + 0.05, x + 0.40, y + h - 0.081, z - 0.05, x + 0.24, y + h - 0.081, z - 0.05, R('LAMP_C'));
  b.box(x + 0.25, y + h - 0.10, z - 0.05, x + 0.39, y + h - 0.08, z + 0.05, R('LAMP_C')); b.end();
}
function rack(k, x, y, z) {
  const b = k.b;
  for (let i = 0; i < 4; i++) { const sx = i & 1 ? 0.45 : -0.45, sz = i & 2 ? 0.2 : -0.2; b.color(0x2a5aa8).box(x + sx - 0.025, y, z + sz - 0.025, x + sx + 0.025, y + 1.2, z + sz + 0.025); }
  for (let j = 0; j < 3; j++) {
    const yy = y + 0.12 + j * 0.4;
    b.color(0xe0702a).box(x - 0.47, yy, z + 0.18, x + 0.47, yy + 0.05, z + 0.23).box(x - 0.47, yy, z - 0.23, x + 0.47, yy + 0.05, z - 0.18);
    b.color(j === 1 ? 0xb88a58 : 0xc49464).box(x - 0.40, yy + 0.05, z - 0.17, x - 0.02, yy + 0.30, z + 0.17).box(x + 0.04, yy + 0.05, z - 0.17, x + 0.40, yy + 0.24, z + 0.17);
  }
}
function batteryRack(k, x, y, z) {
  const b = k.b;
  b.color(0x30353b).box(x - 0.30, y, z - 0.18, x + 0.30, y + 0.62, z + 0.18);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
    const cx = x - 0.21 + i * 0.14, cy = y + 0.05 + j * 0.19;
    b.color(0x1d1f22).box(cx - 0.06, cy, z + 0.10, cx + 0.06, cy + 0.15, z + 0.181);
    b.color(i & 1 ? 0xd32f2f : 0x2b2b2b).box(cx - 0.035, cy + 0.15, z + 0.12, cx - 0.01, cy + 0.17, z + 0.15);
  }
  LIB.front(k, x - 0.2, y + 0.63, x + 0.2, y + 0.70, z + 0.181, LIB.label('AKÜ', 'yellow'));
}
function house(k, x, y, z, w, h, col) {
  const b = k.b;
  b.color(col).box(x - w / 2, y, z - w / 2, x + w / 2, y + h, z + w / 2);
  b.color(0xffffff).quad(x - w / 2 - 0.04, y + h, z + w / 2 + 0.04, x + w / 2 + 0.04, y + h, z + w / 2 + 0.04, x + w / 2 + 0.04, y + h + w * 0.42, z, x - w / 2 - 0.04, y + h + w * 0.42, z, R('ROOF'));
  b.quad(x + w / 2 + 0.04, y + h, z - w / 2 - 0.04, x - w / 2 - 0.04, y + h, z - w / 2 - 0.04, x - w / 2 - 0.04, y + h + w * 0.42, z, x + w / 2 + 0.04, y + h + w * 0.42, z, R('ROOF'));
  b.color(col).quad(x + w / 2, y + h, z + w / 2, x + w / 2, y + h, z - w / 2, x + w / 2, y + h + w * 0.42, z, x + w / 2, y + h + w * 0.42, z, null);
  b.quad(x - w / 2, y + h, z - w / 2, x - w / 2, y + h, z + w / 2, x - w / 2, y + h + w * 0.42, z, x - w / 2, y + h + w * 0.42, z, null);
  b.begin('win');
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const fx = x - w / 4 + c * w / 2, fy = y + 0.12 + r * h * 0.45;
    b.color(0xffffff).quad(fx - 0.07, fy, z + w / 2 + 0.003, fx + 0.07, fy, z + w / 2 + 0.003, fx + 0.07, fy + 0.16, z + w / 2 + 0.003, fx - 0.07, fy + 0.16, z + w / 2 + 0.003, R('WIN_OFF'));
    b.quad(x + w / 2 + 0.003, fy, fx - x + z + 0.07, x + w / 2 + 0.003, fy, fx - x + z - 0.07, x + w / 2 + 0.003, fy + 0.16, fx - x + z - 0.07, x + w / 2 + 0.003, fy + 0.16, fx - x + z + 0.07, R('WIN_OFF'));
  }
  b.end();
}
function meterBox(k, x, y, z) {
  const b = k.b;
  b.color(0xbdbca8).box(x - 0.18, y, z - 0.10, x + 0.18, y + 0.55, z + 0.10);
  b.color(0xa9a894).box(x - 0.20, y + 0.55, z - 0.12, x + 0.20, y + 0.59, z + 0.12);
  LIB.front(k, x - 0.13, y + 0.25, x + 0.13, y + 0.49, z + 0.101, R('METER'));
}
function kiosk(k, x, y, z) {
  const b = k.b, cr = R('CONCRETE');
  b.color(0xc9c2b2).box(x - 0.45, y, z - 0.32, x + 0.45, y + 0.72, z + 0.32, cr);
  b.color(0x9d968a).box(x - 0.5, y + 0.72, z - 0.37, x + 0.5, y + 0.80, z + 0.37, cr);
  b.color(0x5f7268).box(x - 0.38, y + 0.05, z + 0.32, x - 0.04, y + 0.60, z + 0.335, { f: R('LOUVRE') }).box(x + 0.04, y + 0.05, z + 0.32, x + 0.38, y + 0.60, z + 0.335, { f: R('LOUVRE') });
  LIB.front(k, x - 0.12, y + 0.36, x + 0.12, y + 0.60, z + 0.336, R('DANGER'));
}
function fence(k, x0, z0, x1, z1, y, h) {
  const b = k.b, n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.3));
  for (let i = 0; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; b.color(0x8d969c).box(x - 0.015, y, z - 0.015, x + 0.015, y + h, z + 0.015); }
  const dx = x1 - x0, dz = z1 - z0;
  b.color(0x8d969c).box(Math.min(x0, x1) - 0.012, y + h - 0.03, Math.min(z0, z1) - 0.012, Math.max(x0, x1) + 0.012, y + h, Math.max(z0, z1) + 0.012);
  b.color(0x8d969c).box(Math.min(x0, x1) - 0.012, y + h * 0.45, Math.min(z0, z1) - 0.012, Math.max(x0, x1) + 0.012, y + h * 0.45 + 0.025, Math.max(z0, z1) + 0.012);
  if (Math.abs(dx) > Math.abs(dz)) LIB.front(k, (x0 + x1) / 2 - 0.1, y + h * 0.5, (x0 + x1) / 2 + 0.1, y + h * 0.5 + 0.2, Math.max(z0, z1) + 0.014, R('DANGER'));
}
function arrester(k, x, y, z) {   // OG direği + parafudr + izolatörler
  const b = k.b;
  b.color(0x8d969c).push().at(x, y, z).cyl(0.06, 0.04, 0, 1.6, 8, null, null).pop();
  b.color(0x8d969c).box(x - 0.42, y + 1.45, z - 0.03, x + 0.42, y + 1.51, z + 0.03);
  const pr = LIB.insProf({ S: { ins: 'porselen' }, og: true }, 0.18, 0.025, 3);
  for (let i = -1; i <= 1; i++) b.color(P.porcelain).push().at(x + i * 0.36, y + 1.51, z).lathe(pr, 6).pop();
}
function cableTray(k, x, y, z) {
  const b = k.b;
  for (let i = -1; i <= 1; i += 2) b.color(0x8d969c).box(x + i * 0.5 - 0.02, y, z - 0.02, x + i * 0.5 + 0.02, y + 0.7, z + 0.02);
  b.color(0x8d969c).box(x - 0.6, y + 0.7, z - 0.16, x + 0.6, y + 0.73, z + 0.16);
  b.color(0x8d969c).box(x - 0.6, y + 0.73, z - 0.16, x + 0.6, y + 0.80, z - 0.14).box(x - 0.6, y + 0.73, z + 0.14, x + 0.6, y + 0.80, z + 0.16);
  for (let j = 0; j < 4; j++) b.color(j === 3 ? 0x2a6fd0 : 0x1d1f22).push().at(x - 0.6, y + 0.76, z - 0.09 + j * 0.06).rz(-Math.PI / 2).cyl(0.025, 0.025, 0, 1.2, 6, null, null).pop();
}
function bollards(k, x, y, z) {
  const b = k.b;
  for (let i = 0; i < 3; i++) { b.color(0xf2b705).push().at(x + i * 0.3 - 0.3, y, z).cyl(0.06, 0.06, 0, 0.4, 8, null, null).pop(); b.color(0x1b1b1b).push().at(x + i * 0.3 - 0.3, y + 0.25, z).cyl(0.062, 0.062, 0, 0.06, 8, null, null).pop(); }
}
function mccRow(k, x, y, z) {
  const b = k.b;
  for (let i = 0; i < 3; i++) {
    const cx = x - 0.4 + i * 0.4;
    b.color(0xcdd0ca).box(cx - 0.19, y, z - 0.2, cx + 0.19, y + 0.95, z + 0.2);
    for (let j = 0; j < 3; j++) b.color(0xd8dbd5).box(cx - 0.16, y + 0.1 + j * 0.27, z + 0.2, cx + 0.16, y + 0.33 + j * 0.27, z + 0.212, { f: R('DOOR') });
    b.color(0xe0a800).box(cx + 0.08, y + 0.2, z + 0.212, cx + 0.13, y + 0.24, z + 0.23);
  }
}
function fanUnit(k, x, y, z) {
  const b = k.b;
  b.color(0x9aa1a6).box(x - 0.35, y, z - 0.35, x + 0.35, y + 0.45, z + 0.35, { f: R('GRILLE'), k: R('GRILLE'), l: null, r: null, t: null });
  b.color(0x30353b).push().at(x, y + 0.45, z).cyl(0.28, 0.28, 0, 0.04, 12, null, R('GRILLE')).pop();
}

const BUILD = {
  'Depo': [
    (k, x, y, z) => { rack(k, x, y, z - 0.2); streetLamp(k, x + 0.55, y, z + 0.45, 1.5); },
    (k, x, y, z) => { batteryRack(k, x - 0.25, y, z); batteryRack(k, x + 0.4, y, z + 0.3); },
    (k, x, y, z) => { rack(k, x + 0.1, y, z + 0.2); bollards(k, x, y, z - 0.6); },
  ],
  'Volt Mahallesi': [
    (k, x, y, z) => { house(k, x - 0.15, y, z - 0.15, 0.8, 0.7, 0xe9dcc4); streetLamp(k, x + 0.55, y, z + 0.55, 1.6); },
    (k, x, y, z) => { house(k, x + 0.1, y, z, 0.7, 0.9, 0xd9b48a); meterBox(k, x - 0.5, y, z + 0.5); },
    (k, x, y, z) => { streetLamp(k, x - 0.4, y, z - 0.4, 1.7); meterBox(k, x + 0.3, y, z + 0.3); house(k, x + 0.25, y, z - 0.35, 0.5, 0.5, 0xc9d2b8); },
  ],
  'Trafo Merkezi': [
    (k, x, y, z) => { kiosk(k, x, y, z - 0.1); fence(k, x - 0.75, z + 0.65, x + 0.75, z + 0.65, y, 0.5); },
    (k, x, y, z) => { arrester(k, x, y, z); fence(k, x - 0.75, z + 0.65, x + 0.75, z + 0.65, y, 0.5); },
    (k, x, y, z) => { kiosk(k, x + 0.1, y, z + 0.2); arrester(k, x - 0.5, y, z - 0.5); },
  ],
  'Fabrika': [
    (k, x, y, z) => { mccRow(k, x, y, z - 0.3); bollards(k, x, y, z + 0.55); },
    (k, x, y, z) => { cableTray(k, x, y, z); fanUnit(k, x, y, z + 0.4); },
    (k, x, y, z) => { fanUnit(k, x - 0.3, y, z - 0.3); cableTray(k, x, y, z + 0.4); },
  ],
};
const GROUND = { 'Depo': 'beton', 'Volt Mahallesi': 'cimen', 'Trafo Merkezi': 'cakil', 'Fabrika': 'beton' };

KIT.props = function (L, biyom) {
  if (!L || !L.G) return null;
  const bk = LIB.biyomKey(biyom), G = L.G;
  const k = new LIB.Kit({ t: 'props', id: '', i: -1, cell: -1 }, bk, { L: null, yaw: 0, kv: 0.4 });
  let seed = 0; const id = String(L.id || ''); for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
  // Ada, köşegen arka köşede (yatay +1,9). Yüksekliği EKRAN boşluğu için hesaplanır: izometrik ortografik kamerada
  // ekran-yukarı = 0,816·y + 0,577·d (d = köşe yönündeki derinlik). Adanın en alt ekran noktası, ızgaranın o köşe
  // yönündeki en yüksek ekran noktasının (blok üstü + 0,12 pay) 0,35 üstünde kalır: ada oynanış
  // silüetine ekranda hiç değmez (perspektif kuralı "değen kenar bağlıdır" yanlış okunamaz), derinlikte de arkadadır.
  const cx = (G.W - 1) / 2, cz = (G.D - 1) / 2, ex = G.W / 2 + 1.9, ez = G.D / 2 + 1.9, CE = 0.8165, SE = 0.5774;
  const corners = [];
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1, x = cx + sx * ex, z = cz + sz * ez;
    const l = Math.hypot(sx * ex, sz * ez), ux = sx * ex / l, uz = sz * ez / l;
    let S = -1e9;
    for (let c = 0; c < G.N; c++) {
      if (!G.kind[c]) continue; const p = G.xyz(c);
      const s = CE * (p[1] + 0.62) + SE * ((p[0] - cx) * ux + (p[2] - cz) * uz + 0.71); if (s > S) S = s;
    }
    const dc = l, m = S + 0.35;
    const y = Math.max(-1.2, (m - SE * (dc - 1.11)) / CE + 0.12, (m - SE * (dc - 0.34)) / CE + 0.74);
    k.b.begin('c' + i);
    islet(k, x, z, y, GROUND[bk]);
    const list = BUILD[bk]; list[Math.abs(seed + i * 7) % list.length](k, x, y, z);
    k.b.end();
    corners.push({ dx: ux, dz: uz, x, y: y - 0.3, z, on: true });
  }
  const iface = k.finish();
  const mesh = iface.obj; mesh.frustumCulled = false; mesh.name = 'kit:props'; mesh.userData.noShadow = true;
  mesh.geometry.boundingSphere.radius = 1e4;
  let warm = -1;
  const setWarm = w => {
    const on = w >= 0.5 ? 1 : 0; if (on === warm) return; warm = on;
    for (const n of ['lampW']) if (k.rt[n]) k.region(n, R(on ? 'LAMP_W' : 'LAMP_C'));
    if (k.rt.win) k.region('win', R(on ? 'WIN_ON' : 'WIN_OFF'));
  };
  setWarm(0);
  // her karede: kamera yönüne göre köşe göster/gizle (yalnız değişince yeniden yazım)
  mesh.onBeforeRender = function (r, sc, cam) {
    const e = cam.matrixWorld.elements; let dx = e[8], dz = e[10]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    for (let i = 0; i < 4; i++) {
      // yalnız tam arka köşe (±≈30°): döndürme ortasında ada ızgaranın yanına kaymadan kaybolur
      const c = corners[i], d = c.dx * dx + c.dz * dz, want = c.on ? d < -0.84 : d < -0.88;
      if (want !== c.on) { c.on = want; k.scale('c' + i, c.x, c.y, c.z, want ? 1 : 0); }
    }
    const w = PX.scene && typeof PX.scene.warm === 'number' ? PX.scene.warm : 0; if ((w >= 0.5 ? 1 : 0) !== warm) setWarm(w);
  };
  return { obj: mesh, setWarm, info: { tris: iface.info.tris, biyom: bk } };
};
}
