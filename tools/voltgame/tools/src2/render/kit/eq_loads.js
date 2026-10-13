// ============================================================================
// render/kit/eq_loads.js — yük kitleri: hastane, okul, fırın, sanayi, konut, soğuk hava deposu, sinyalizasyon,
// depo aydınlatması (raf + armatür), projektör direği, kapı motoru, motorlar (kompresör / konveyör / pompa).
// Beslenince (st.live): pencereler yanar (ışıma atlası), tabela lambası yanar, motor kaplini döner.
// Yük tipi el.ad'dan anahtar sözcükle seçilir; yoksa biyom varsayılanı.            sahip: Sanat (kits)
// ============================================================================
const LIB = PX.KITLIB;
if (LIB) {
const R = LIB.R, P = LIB.P;

// pencere ızgarası: dört yüzde satır×sütun; hepsi 'win' parçasında (WIN_OFF <-> WIN_ON)
function windows(k, x0, x1, z0, z1, ys, cols, sides) {
  const b = k.b; b.begin('win');
  const w = Math.min(0.12, (x1 - x0) / cols * 0.55), wz = Math.min(0.12, (z1 - z0) / cols * 0.55);
  for (let r = 0; r < ys.length; r++) {
    const y0 = ys[r][0], y1 = ys[r][1];
    for (let c = 0; c < cols; c++) {
      const fx = x0 + (x1 - x0) * (c + 0.5) / cols, fz = z0 + (z1 - z0) * (c + 0.5) / cols;
      if (!sides || sides.indexOf('f') >= 0) b.color(0xffffff).quad(fx - w / 2, y0, z1 + 0.003, fx + w / 2, y0, z1 + 0.003, fx + w / 2, y1, z1 + 0.003, fx - w / 2, y1, z1 + 0.003, R('WIN_OFF'));
      if (!sides || sides.indexOf('k') >= 0) b.quad(fx + w / 2, y0, z0 - 0.003, fx - w / 2, y0, z0 - 0.003, fx - w / 2, y1, z0 - 0.003, fx + w / 2, y1, z0 - 0.003, R('WIN_OFF'));
      if (!sides || sides.indexOf('r') >= 0) b.quad(x1 + 0.003, y0, fz + wz / 2, x1 + 0.003, y0, fz - wz / 2, x1 + 0.003, y1, fz - wz / 2, x1 + 0.003, y1, fz + wz / 2, R('WIN_OFF'));
      if (!sides || sides.indexOf('l') >= 0) b.quad(x0 - 0.003, y0, fz - wz / 2, x0 - 0.003, y0, fz + wz / 2, x0 - 0.003, y1, fz + wz / 2, x0 - 0.003, y1, fz - wz / 2, R('WIN_OFF'));
    }
  }
  b.end();
}
function gable(k, x0, x1, z0, z1, y0, y1, reg, col) {   // sırt x boyunca
  const b = k.b, zm = (z0 + z1) / 2; b.color(col || 0xffffff);
  b.quad(x0, y0, z1, x1, y0, z1, x1, y1, zm, x0, y1, zm, reg);
  b.quad(x1, y0, z0, x0, y0, z0, x0, y1, zm, x1, y1, zm, reg);
  return zm;
}
function gableEnds(k, x0, x1, z0, z1, y0, y1, col) {
  const b = k.b, zm = (z0 + z1) / 2; b.color(col);
  b.quad(x1, y0, z1, x1, y0, z0, x1, y1, zm, x1, y1, zm, null);
  b.quad(x0, y0, z0, x0, y0, z1, x0, y1, zm, x0, y1, zm, null);
}
const liveWin = k => (st) => { k.region('win', R(st.live ? 'WIN_ON' : 'WIN_OFF')); k.region('lampT', R(st.live ? 'LAMP_W' : 'LAMP_OFF')); };

function hospital(k, word) {
  const b = k.b;
  b.color(0x8d9399).box(-0.44, -0.5, -0.42, 0.44, -0.44, 0.42);
  b.color(0xe8ecef).box(-0.43, -0.44, -0.40, 0.43, 0.27, 0.40);
  b.color(0x1565c0).box(-0.435, 0.27, -0.405, 0.435, 0.31, 0.405);
  b.color(0xdfe3e6).box(-0.44, 0.31, -0.41, 0.44, 0.35, 0.41);
  LIB.top(k, -0.24, -0.26, 0.24, 0.22, 0.351, R('HOSP'));
  if (k.q >= 1) b.color(0x9aa1a6).box(0.28, 0.35, -0.36, 0.40, 0.42, -0.24);
  windows(k, -0.43, 0.43, -0.40, 0.40, [[-0.14, 0.0], [0.08, 0.22]], 3);
  b.color(0xcfd6db).box(-0.22, -0.20, 0.40, 0.22, -0.16, 0.47); b.color(0x6f8aa3).box(-0.12, -0.44, 0.40, 0.12, -0.20, 0.405);
  LIB.front(k, -0.30, -0.13, 0.30, -0.06, 0.403, LIB.label(word || 'HASTANE', 'blue'));
  LIB.back(k, -0.30, -0.13, 0.30, -0.06, -0.403, LIB.label(word || 'HASTANE', 'blue'));
  LIB.lamp(k, -0.36, 0.35, 0.33, 0.07, 'lampT');
  k.onState = liveWin(k);
}
function school(k) {
  const b = k.b;
  b.color(0x8d8578).box(-0.44, -0.5, -0.38, 0.44, -0.44, 0.38);
  b.color(0xe0a548).box(-0.43, -0.44, -0.36, 0.43, 0.14, 0.36);
  b.color(0xf3efe6).box(-0.435, -0.06, -0.365, 0.435, -0.03, 0.365);
  gable(k, -0.46, 0.46, -0.42, 0.42, 0.14, 0.44, R('ROOF'));
  gableEnds(k, -0.43, 0.43, -0.36, 0.36, 0.14, 0.40, 0xe0a548);
  windows(k, -0.43, 0.43, -0.36, 0.36, [[-0.26, -0.12], [0.0, 0.12]], 3, 'fk');
  windows(k, -0.43, 0.43, -0.36, 0.36, [[-0.26, -0.12]], 2, 'lr');
  b.color(0x6b4a2a).box(-0.08, -0.44, 0.36, 0.08, -0.22, 0.365);
  LIB.front(k, -0.22, -0.11, 0.22, -0.045, 0.367, LIB.label('OKUL', 'cream'));
  LIB.back(k, -0.22, -0.11, 0.22, -0.045, -0.367, LIB.label('OKUL', 'cream'));
  LIB.lamp(k, 0.38, 0.14, 0.38, 0.06, 'lampT');
  k.onState = liveWin(k);
}
function bakery(k, word) {
  const b = k.b;
  b.color(0x77756c).box(-0.44, -0.5, -0.42, 0.44, -0.44, 0.42);
  b.color(0xffffff).box(-0.42, -0.44, -0.38, 0.42, 0.16, 0.38, R('BRICK'));
  b.color(0xd8cfc0).box(-0.44, 0.16, -0.40, 0.44, 0.21, 0.40);
  b.color(0xffffff).box(0.12, 0.21, -0.30, 0.26, 0.45, -0.16, R('BRICK'));                     // fırın bacası
  b.color(0x3a3a3a).box(0.11, 0.44, -0.31, 0.27, 0.465, -0.15);
  b.begin('win');
  b.color(0xffffff).quad(-0.36, -0.32, 0.383, 0.10, -0.32, 0.383, 0.10, -0.02, 0.383, -0.36, -0.02, 0.383, R('WIN_OFF'));
  b.quad(0.10, -0.32, -0.383, -0.36, -0.32, -0.383, -0.36, -0.02, -0.383, 0.10, -0.02, -0.383, R('WIN_OFF'));
  b.quad(0.423, -0.25, 0.20, 0.423, -0.25, -0.20, 0.423, -0.05, -0.20, 0.423, -0.05, 0.20, R('WIN_OFF'));
  b.quad(-0.423, -0.25, -0.20, -0.423, -0.25, 0.20, -0.423, -0.05, 0.20, -0.423, -0.05, -0.20, R('WIN_OFF'));
  b.end();
  b.color(0x5a3a22).box(0.16, -0.44, 0.38, 0.32, -0.08, 0.385);
  b.color(0xffffff).quad(-0.42, 0.0, 0.47, 0.42, 0.0, 0.47, 0.42, 0.08, 0.385, -0.42, 0.08, 0.385, R('AWNING'));   // tente
  LIB.front(k, -0.30, 0.09, 0.30, 0.155, 0.383, LIB.label(word || 'FIRIN', 'cream'));
  LIB.back(k, -0.30, 0.03, 0.30, 0.095, -0.383, LIB.label(word || 'FIRIN', 'cream'));
  LIB.lamp(k, -0.36, 0.21, -0.34, 0.06, 'lampT');
  k.onState = liveWin(k);
}
function factory(k) {
  const b = k.b;
  b.color(0x6f757b).box(-0.44, -0.5, -0.42, 0.44, -0.44, 0.42);
  b.color(0xffffff).box(-0.43, -0.44, -0.40, 0.43, 0.08, 0.40, R('CORRUG'));
  const n = 3, w = 0.86 / n;
  for (let i = 0; i < n; i++) {   // testere dişi çatı: eğik yüz + dik cam yüz (beslenince yanar)
    const x0 = -0.43 + i * w, x1 = x0 + w;
    b.color(0x8a939b).quad(x0, 0.08, 0.40, x0, 0.08, -0.40, x1 - 0.01, 0.40, -0.40, x1 - 0.01, 0.40, 0.40, null);
    b.color(0x8a939b).quad(x0, 0.08, 0.40, x1 - 0.01, 0.40, 0.40, x1 - 0.01, 0.08, 0.40, x1 - 0.01, 0.08, 0.40, null);
    b.color(0x8a939b).quad(x1 - 0.01, 0.08, -0.40, x1 - 0.01, 0.40, -0.40, x0, 0.08, -0.40, x0, 0.08, -0.40, null);
  }
  b.begin('win');
  for (let i = 0; i < n; i++) { const x1 = -0.43 + (i + 1) * w - 0.01; b.color(0xffffff).quad(x1 + 0.002, 0.10, 0.38, x1 + 0.002, 0.10, -0.38, x1 + 0.002, 0.38, -0.38, x1 + 0.002, 0.38, 0.38, R('WIN_OFF')); }
  b.color(0xffffff).quad(-0.30, -0.20, 0.403, 0.30, -0.20, 0.403, 0.30, -0.06, 0.403, -0.30, -0.06, 0.403, R('WIN_OFF'));
  b.end();
  b.color(0x45505a).box(0.08, -0.44, 0.40, 0.34, -0.22, 0.405);
  LIB.front(k, -0.30, -0.03, 0.30, 0.045, 0.404, LIB.label('SANAYİ', 'blue'));
  LIB.lamp(k, -0.36, 0.08, 0.36, 0.06, 'lampT');
  k.onState = liveWin(k);
}
function house(k) {
  const b = k.b;
  b.color(0x77756c).box(-0.44, -0.5, -0.40, 0.44, -0.44, 0.40);
  b.color(0xe9dcc4).box(-0.42, -0.44, -0.36, 0.42, 0.16, 0.36);
  gable(k, -0.45, 0.45, -0.42, 0.42, 0.16, 0.45, R('ROOF'));
  gableEnds(k, -0.42, 0.42, -0.36, 0.36, 0.16, 0.42, 0xe9dcc4);
  windows(k, -0.42, 0.42, -0.36, 0.36, [[-0.30, -0.16], [-0.04, 0.10]], 3, 'fk');
  windows(k, -0.42, 0.42, -0.36, 0.36, [[-0.04, 0.10]], 2, 'lr');
  b.color(0x6b4a2a).box(-0.06, -0.44, 0.36, 0.08, -0.20, 0.365);
  b.color(0xffffff).box(0.18, 0.20, -0.08, 0.28, 0.46, 0.02, R('BRICK'));
  LIB.front(k, -0.40, -0.12, -0.20, -0.06, 0.366, LIB.label('-' + k.el.id, 'plate'));
  LIB.lamp(k, 0.36, 0.0, 0.40, 0.05, 'lampT');
  k.onState = liveWin(k);
}
function coldStore(k) {
  const b = k.b;
  b.color(0x6f757b).box(-0.44, -0.5, -0.42, 0.44, -0.44, 0.42);
  b.color(0xeef2f5).box(-0.43, -0.44, -0.40, 0.43, 0.24, 0.40, { f: R('CORRUG'), k: R('CORRUG'), l: R('CORRUG'), r: R('CORRUG') });
  b.color(0xd5dbe0).box(-0.44, 0.24, -0.41, 0.44, 0.28, 0.41);
  b.color(0x9aa1a6).box(-0.32, 0.28, -0.30, 0.10, 0.44, 0.0); LIB.top(k, -0.30, -0.28, 0.08, -0.02, 0.441, R('GRILLE'));
  b.begin('win'); b.color(0xffffff).quad(-0.28, -0.40, 0.403, 0.10, -0.40, 0.403, 0.10, -0.02, 0.403, -0.28, -0.02, 0.403, R('WIN_OFF')); b.end();
  LIB.front(k, 0.14, 0.06, 0.40, 0.14, 0.404, LIB.label('SOĞUK DEPO', 'blue'));
  LIB.lamp(k, 0.30, 0.28, 0.30, 0.08, 'lampT');
  k.onState = liveWin(k);
}
function signal(k) {   // sinyalizasyon kontrol dolabı + trafik lambası
  const b = k.b;
  b.color(0x77756c).box(-0.44, -0.5, -0.44, 0.44, -0.44, 0.44);
  b.color(0x8f9a8c).box(-0.36, -0.44, -0.22, 0.10, 0.10, 0.22);
  b.color(0x7d887a).box(-0.38, 0.10, -0.24, 0.12, 0.14, 0.24);
  LIB.front(k, -0.30, -0.20, 0.04, -0.12, 0.222, LIB.label('-' + k.el.id, 'plate'));
  b.color(0x2b2f35).box(0.26, -0.44, -0.03, 0.32, 0.20, 0.03);
  b.color(0x1b1d20).box(0.20, 0.20, -0.06, 0.38, 0.46, 0.06);
  b.begin('win');
  LIB.front(k, 0.24, 0.39, 0.34, 0.44, 0.061, R('LAMP_OFF')); LIB.front(k, 0.24, 0.31, 0.34, 0.36, 0.061, R('LAMP_OFF')); LIB.front(k, 0.24, 0.23, 0.34, 0.28, 0.061, R('LAMP_OFF'));
  b.end();
  b.begin('g'); LIB.front(k, 0.24, 0.23, 0.34, 0.28, 0.062, R('LAMP_OFF')); b.end();
  LIB.lamp(k, -0.30, 0.14, 0.15, 0.06, 'lampT');
  k.onState = st => { k.region('win', R('LAMP_OFF')); k.region('g', R(st.live ? 'LAMP_G' : 'LAMP_OFF')); k.region('lampT', R(st.live ? 'LAMP_G' : 'LAMP_OFF')); };
}
function rackLights(k) {   // depo: palet rafı + LED armatürler
  const b = k.b, up = 0x2a5aa8, beam = 0xe0702a;
  b.color(0x55595e).box(-0.45, -0.5, -0.45, 0.45, -0.47, 0.45);
  for (let i = 0; i < 4; i++) { const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1; b.color(up).box(sx * 0.42 - 0.025, -0.47, sz * 0.36 - 0.025, sx * 0.42 + 0.025, 0.36, sz * 0.36 + 0.025); }
  const lv = [-0.22, 0.08];
  for (let j = 0; j < lv.length; j++) {
    const y = lv[j];
    b.color(beam).box(-0.445, y, 0.33, 0.445, y + 0.05, 0.39).box(-0.445, y, -0.39, 0.445, y + 0.05, -0.33);
    b.color(0xc49464).box(-0.38, y + 0.05, -0.30, -0.04, y + 0.24, 0.30).box(0.04, y + 0.05, -0.30, 0.36, y + 0.20, 0.30);
    b.color(0xa77b52).box(-0.38, y + 0.11, 0.30, -0.04, y + 0.13, 0.301);
  }
  b.color(beam).box(-0.445, 0.33, 0.33, 0.445, 0.38, 0.39).box(-0.445, 0.33, -0.39, 0.445, 0.38, -0.33);
  b.color(0x2f3439).box(-0.40, 0.38, -0.05, 0.40, 0.40, 0.05);
  b.begin('win');
  for (let i = 0; i < 2; i++) { const x = i ? 0.2 : -0.2; b.color(0x3a3f45).box(x - 0.11, 0.40, -0.11, x + 0.11, 0.42, 0.11); b.color(0xffffff).box(x - 0.09, 0.42, -0.09, x + 0.09, 0.45, 0.09, R('LAMP_OFF')); }
  b.end();
  LIB.front(k, -0.20, -0.42, 0.20, -0.34, 0.40, LIB.label(k.el.id ? '-' + k.el.id : 'AYDINLATMA', 'plate'));
  k.onState = st => k.region('win', R(st.live ? 'LAMP_W' : 'LAMP_OFF'));
}
function mastLights(k) {   // projektör direği + aydınlatma dağıtım kutusu
  const b = k.b, S = k.S;
  b.color(0x8c887e).box(-0.44, -0.5, -0.44, 0.44, -0.44, 0.44, { t: R('CONCRETE'), all: null });
  b.color(S.body).box(-0.38, -0.44, 0.04, 0.02, 0.0, 0.36); b.color(S.roof).box(-0.40, 0.0, 0.02, 0.04, 0.03, 0.38);
  LIB.front(k, -0.32, -0.30, -0.04, -0.22, 0.361, LIB.label('-' + k.el.id, 'plate'));
  b.color(0x8d969c).push().at(0.22, -0.44, -0.18).cyl(0.04, 0.03, 0, 0.82, k.seg, null, null).pop();
  b.color(0x6d757c).box(0.02, 0.36, -0.21, 0.42, 0.39, -0.15);
  b.begin('win');
  for (let i = 0; i < 2; i++) { const x = i ? 0.33 : 0.11; b.color(0x2b2f35).box(x - 0.09, 0.30, -0.26, x + 0.09, 0.36, -0.10); b.color(0xffffff).quad(x - 0.08, 0.30, -0.099, x + 0.08, 0.30, -0.099, x + 0.08, 0.355, -0.099, x - 0.08, 0.355, -0.099, R('LAMP_OFF'));
    b.quad(x - 0.08, 0.361, -0.11, x + 0.08, 0.361, -0.11, x + 0.08, 0.361, -0.25, x - 0.08, 0.361, -0.25, R('LAMP_OFF')); }
  b.end();
  k.onState = st => k.region('win', R(st.live ? 'LAMP_W' : 'LAMP_OFF'));
}
function doorMotor(k) {   // seksiyonel kapı + motor kutusu
  const b = k.b, S = k.S;
  b.color(0x55595e).box(-0.45, -0.5, -0.45, 0.45, -0.46, 0.45);
  b.color(S.body).box(-0.44, -0.46, -0.44, -0.30, 0.36, 0.40).box(0.30, -0.46, -0.44, 0.44, 0.36, 0.40).box(-0.44, 0.24, -0.44, 0.44, 0.36, 0.40);
  b.color(0xb4bcc3).box(-0.30, -0.46, -0.10, 0.30, 0.24, 0.30, { f: R('LOUVRE'), all: null });
  b.color(0x8d969c).box(-0.30, -0.46, -0.44, 0.30, 0.24, -0.10);
  b.color(0xffffff).box(-0.44, -0.46, 0.40, -0.30, -0.20, 0.405, R('HAZARD')).box(0.30, -0.46, 0.40, 0.44, -0.20, 0.405, R('HAZARD'));
  b.color(0x2f3439).box(0.12, 0.36, -0.20, 0.40, 0.45, 0.10);                                   // motor
  b.color(P.alu).push().at(0.06, 0.40, -0.05).rz(Math.PI / 2).cyl(0.04, 0.04, -0.06, 0.06, 8, null, null).pop();
  LIB.front(k, -0.25, 0.27, 0.10, 0.34, 0.401, LIB.label('-' + k.el.id, 'plate'));
  LIB.lamp(k, 0.30, 0.45, 0.02, 0.06, 'lampT');
  k.onState = st => k.region('lampT', R(st.live ? 'LAMP_G' : 'LAMP_OFF'));
}
// Yangın algılama paneli: duvarda kırmızı panel + zil + yangın ihbar butonu; beslenince ekran + yeşil enerji lambası
function fireAlarm(k) {
  const b = k.b;
  b.color(0x77756c).box(-0.44, -0.5, -0.44, 0.44, -0.44, 0.44);
  b.color(0xb9bcb4).box(-0.40, -0.44, -0.40, 0.40, 0.30, -0.30);                                    // duvar
  b.color(0xc62828).box(-0.30, -0.30, -0.30, 0.30, 0.22, -0.12);                                    // panel
  b.color(0x9e1f1f).box(-0.31, 0.22, -0.31, 0.31, 0.25, -0.11);
  LIB.front(k, -0.24, 0.02, 0.08, 0.17, -0.118, R('SCREEN_OFF'), 'scr');
  LIB.front(k, -0.24, -0.22, 0.24, -0.12, -0.118, LIB.label('YANGIN', 'red'));
  b.color(0xd32f2f).push().at(0.19, 0.10, -0.12).rx(Math.PI / 2).cyl(0.06, 0.06, 0, 0.04, k.seg, null, null).pop();   // zil
  b.color(0x1b1d20).box(0.14, -0.44, -0.30, 0.18, -0.30, -0.26);                                    // kablo borusu
  b.color(0x8d969c).push().at(0.30, -0.44, 0.25).cyl(0.035, 0.035, 0, 0.5, k.seg, null, null).pop();   // ihbar butonu direği
  b.color(0xc62828).box(0.22, 0.06, 0.17, 0.38, 0.22, 0.33); b.color(0xf4f4ef).box(0.25, 0.10, 0.33, 0.35, 0.18, 0.336);
  LIB.lamp(k, -0.22, 0.25, -0.21, 0.07, 'lampT');
  LIB.lamp(k, 0.30, 0.22, 0.25, 0.06, 'lampB');
  k.onState = st => { k.region('scr', R(st.live ? 'SCREEN_ON' : 'SCREEN_OFF')); k.region('lampT', R(st.live ? 'LAMP_G' : 'LAMP_OFF')); k.region('lampB', R(st.live ? 'LAMP_R' : 'LAMP_OFF')); };
}
// Forklift akü şarj istasyonu: şarj cihazı + akülü forklift + kablo; beslenince ekran + LED çubuğu
function charger(k) {
  const b = k.b, S = k.S;
  b.color(0x55595e).box(-0.45, -0.5, -0.45, 0.45, -0.47, 0.45);
  b.color(0xffffff).box(-0.45, -0.47, 0.32, 0.45, -0.465, 0.38, R('HAZARD'));
  b.color(S.body).box(-0.40, -0.47, -0.40, -0.06, 0.30, -0.16); b.color(S.roof).box(-0.42, 0.30, -0.42, -0.04, 0.33, -0.14);
  LIB.front(k, -0.36, 0.08, -0.10, 0.24, -0.159, R('SCREEN_OFF'), 'scr');
  b.begin('leds'); for (let i = 0; i < 4; i++) LIB.front(k, -0.36 + i * 0.065, -0.02, -0.31 + i * 0.065, 0.03, -0.159, R('LAMP_OFF')); b.end();
  LIB.front(k, -0.37, -0.15, -0.09, -0.07, -0.159, LIB.label('ŞARJ', 'green'));
  b.color(0xf2b705).box(0.0, -0.40, -0.10, 0.36, -0.12, 0.22);                                       // forklift gövdesi
  b.color(0x23262a).box(0.02, -0.12, -0.08, 0.20, 0.08, 0.20);                                       // akü bölmesi
  for (let i = 0; i < 3; i++) b.color(i & 1 ? 0xd32f2f : 0x2b2b2b).box(0.05 + i * 0.05, 0.08, 0.0, 0.08 + i * 0.05, 0.10, 0.03);
  b.color(0x30353b).box(0.22, -0.12, -0.08, 0.26, 0.30, 0.20).box(0.22, 0.26, -0.08, 0.36, 0.30, 0.20);   // koruma kafesi
  b.color(0x6d757c).box(0.36, -0.40, -0.06, 0.40, 0.20, 0.0).box(0.36, -0.40, 0.12, 0.40, 0.20, 0.18);   // direk
  b.color(0x8d969c).box(0.40, -0.44, -0.05, 0.46, -0.42, -0.01).box(0.40, -0.44, 0.13, 0.46, -0.42, 0.17);   // çatallar
  b.color(0x1b1b1b).push().at(0.06, -0.40, 0.22).rx(Math.PI / 2).cyl(0.06, 0.06, -0.03, 0.03, 8, null, null, { top: true, bot: true }).pop()
    .push().at(0.30, -0.40, 0.22).rx(Math.PI / 2).cyl(0.06, 0.06, -0.03, 0.03, 8, null, null, { top: true, bot: true }).pop();
  b.color(P.cable).box(-0.10, -0.465, -0.20, -0.06, -0.445, 0.0).box(-0.10, -0.465, -0.02, 0.06, -0.445, 0.02).box(0.02, -0.465, -0.02, 0.06, -0.12, 0.02);   // şarj kablosu
  LIB.lamp(k, -0.12, 0.33, -0.37, 0.06, 'lampT');
  k.onState = st => { k.region('scr', R(st.live ? 'SCREEN_ON' : 'SCREEN_OFF')); k.region('leds', R(st.live ? 'LAMP_G' : 'LAMP_OFF')); k.region('lampT', R(st.live ? 'LAMP_G' : 'LAMP_OFF')); };
}
// Motor: kızak + nervürlü gövde + fan kapağı + klemens kutusu + dönen (sarı-siyah) kaplin + tahrik edilen makine
// + yerel kumanda kutusu (direkte, beslenince yeşil lamba). Kaplin sürekli dönüşü yalnız beslenince (onBeforeRender).
function motor(k, kind) {
  const b = k.b, seg = k.seg, BL = 0x2e5f9e, AX = -0.08, RM = 0.19;
  b.color(0xa9a59a).box(-0.45, -0.5, -0.36, 0.45, -0.36, 0.36, { t: R('CONCRETE'), all: null });                 // beton temel
  b.color(0x2b2f35).box(-0.44, -0.36, -0.30, 0.44, -0.31, 0.30);                                                 // kızak
  b.color(0xffffff).box(-0.44, -0.36, 0.30, 0.44, -0.31, 0.32, R('HAZARD')).box(-0.44, -0.36, -0.32, 0.44, -0.31, -0.30, R('HAZARD'));
  b.color(0x30353b).box(-0.40, -0.31, -0.15, -0.06, AX - RM + 0.04, 0.15);                                       // motor ayakları
  b.color(BL).push().at(-0.23, AX, 0).rz(Math.PI / 2).cyl(RM, RM, -0.17, 0.17, seg + 2, null, null, { top: true, bot: true }).pop();
  const nr = k.q === 0 ? 3 : 6;
  for (let i = 0; i < nr; i++) { const x = -0.38 + i * 0.30 / (nr - 1); b.color(0x285489).box(x - 0.008, AX - RM - 0.015, -RM - 0.015, x + 0.008, AX + RM + 0.015, RM + 0.015); }
  b.color(0x2b2f35).push().at(-0.425, AX, 0).rz(Math.PI / 2).cyl(RM + 0.005, RM + 0.005, -0.025, 0.025, seg + 2, null, R('GRILLE'), { top: true, bot: true }).pop();
  b.color(BL).box(-0.31, AX + RM - 0.01, -0.08, -0.15, AX + RM + 0.11, 0.08);                                    // klemens kutusu
  b.color(0x1b1d20).push().at(-0.23, AX + RM + 0.11, 0).cyl(0.025, 0.025, 0, 0.03, 6, null, null).pop();
  b.color(P.alu).push().at(-0.03, AX, 0).rz(Math.PI / 2).cyl(0.035, 0.035, -0.035, 0.035, 8, null, null).pop();
  b.begin('cup'); b.color(0xffffff).push().at(0.03, AX, 0).rz(Math.PI / 2).cyl(0.12, 0.12, -0.03, 0.03, seg + 2, R('HAZARD'), R('HAZARD'), { top: true, bot: true }).pop(); b.end();
  b.color(0xe0a800).box(-0.02, AX + 0.13, -0.14, 0.09, AX + 0.15, 0.14).box(-0.02, AX - 0.13, -0.14, 0.09, AX + 0.15, -0.13);   // kaplin koruyucu (açık yarım)
  if (kind === 'pompa') {
    b.color(0xb3261e).push().at(0.27, AX, 0).rz(Math.PI / 2).cyl(0.17, 0.17, -0.13, 0.13, seg + 2, null, null, { top: true, bot: true }).pop();
    b.color(0xb3261e).box(0.21, AX, -0.06, 0.33, 0.24, 0.06); b.color(P.galv).push().at(0.27, 0.24, 0).cyl(0.075, 0.075, 0, 0.06, seg, null, null).pop();
    b.color(P.galv).push().at(0.43, AX, 0).rz(Math.PI / 2).cyl(0.07, 0.07, -0.03, 0.03, seg, null, null, { top: true }).pop();
    b.color(0x30353b).box(0.16, -0.31, -0.12, 0.38, AX - 0.15, 0.12);
  } else if (kind === 'kompresör') {
    b.color(0x6d757c).box(0.13, -0.31, -0.20, 0.44, 0.14, 0.20);
    b.color(0x3a3f45).box(0.18, 0.14, -0.14, 0.40, 0.26, 0.14); b.color(0x8d969c).box(0.22, 0.26, -0.08, 0.36, 0.30, 0.08);
    LIB.side(k, 1, -0.10, -0.12, 0.10, 0.06, 0.441, R('GAUGE'));
  } else if (kind === 'fan') {   // radyal fan: salyangoz gövde + dikey çıkış kanalı
    b.color(0x8d969c).push().at(0.27, AX, 0).rz(Math.PI / 2).cyl(0.2, 0.2, -0.09, 0.09, seg + 2, null, null, { top: true, bot: true }).pop();
    b.color(0x30353b).push().at(0.36, AX, 0).rz(Math.PI / 2).cyl(0.09, 0.09, 0, 0.012, seg, null, R('GRILLE'), { top: true }).pop();
    b.color(0x8d969c).box(0.19, AX, -0.2, 0.35, 0.42, -0.04); b.color(0x6d757c).box(0.18, 0.40, -0.21, 0.36, 0.45, -0.03);
    b.color(0x30353b).box(0.16, -0.31, -0.14, 0.38, AX - 0.17, 0.14);
  } else if (kind === 'konveyör') {
    b.color(0x4a5056).box(0.12, -0.31, -0.24, 0.20, 0.0, 0.24).box(0.36, -0.31, -0.24, 0.44, 0.0, 0.24);
    b.color(0x1b1b1b).push().at(0.28, -0.03, 0).rx(Math.PI / 2).cyl(0.09, 0.09, -0.24, 0.24, seg, null, null, { top: true, bot: true }).pop();
    b.color(0x23262a).box(0.10, 0.04, -0.26, 0.46 - 0.01, 0.075, 0.26);
    b.color(0xc49464).box(0.18, 0.075, -0.12, 0.36, 0.20, 0.10);
  } else {
    b.color(0x6d757c).box(0.13, -0.31, -0.16, 0.42, 0.06, 0.16); b.color(0x55595e).box(0.15, 0.06, -0.14, 0.40, 0.10, 0.14);
  }
  // yerel kumanda kutusu (direkte): beslenince yeşil lamba
  b.color(0x6d757c).box(-0.42, -0.36, -0.42, -0.38, 0.22, -0.38);
  b.color(0xe8b10a).box(-0.44, 0.22, -0.44, -0.24, 0.44, -0.32);
  b.color(0xd32f2f).push().at(-0.34, 0.30, -0.32).rx(Math.PI / 2).cyl(0.035, 0.035, 0, 0.025, 8, null, null).pop();
  LIB.lamp(k, -0.34, 0.44, -0.38, 0.07, 'lampT');
  LIB.front(k, -0.40, -0.47, -0.06, -0.39, 0.361, LIB.label(k.el.id ? '-' + k.el.id : 'M', 'plate'));
  LIB.back(k, 0.06, -0.47, 0.40, -0.39, -0.361, LIB.label(k.el.id ? '-' + k.el.id : 'M', 'plate'));
  const sp = k.spin(a => k.rotate('cup', 0.03, AX, 0, 0, a), 9);
  k.onState = (st) => { k.region('lampT', R(st.live ? 'LAMP_G' : 'LAMP_OFF')); k.setSpin(sp, st.live); };
}

LIB.def('yuk', k => {
  const h = w => k.has(w);
  if (h('hastane')) hospital(k);
  else if (h('sağlık') || h('saglik')) hospital(k, 'SAĞLIK OCAĞI');
  else if (h('yangın') || h('yangin')) fireAlarm(k);
  else if (h('şarj') || h('sarj')) charger(k);
  else if (h('market') || h('otomat') || h('bakkal') || h('dükkan')) bakery(k, 'MARKET');
  else if (h('fan') && !h('fırın')) motor(k, 'fan');
  else if (h('okul')) school(k);
  else if (h('fırın') || h('firin') || h('ekmek')) bakery(k);
  else if (h('aydınlatma') || h('aydinlatma')) { if (k.biyom === 'Depo') rackLights(k); else mastLights(k); }
  else if (h('kompresör') || h('kompresor')) motor(k, 'kompresör');
  else if (h('konveyör') || h('konveyor')) motor(k, 'konveyör');
  else if (h('pompa')) motor(k, 'pompa');
  else if (h('motor') && !h('kapı')) motor(k, 'motor');
  else if (h('kapı') || h('kapi')) doorMotor(k);
  else if (h('soğuk') || h('soguk')) coldStore(k);
  else if (h('sinyal')) signal(k);
  else if (h('sanayi') || h('fabrika') || h('atölye')) factory(k);
  else if (h('konut') || /(^|\s)ev(\s|$|ler)/.test(k.ad) || h('apartman') || h('mesken')) house(k);
  else if (k.biyom === 'Fabrika') motor(k, 'motor');
  else if (k.biyom === 'Depo') rackLights(k);
  else if (k.biyom === 'Trafo Merkezi') factory(k);
  else house(k);
  k.anchor.set(0, -0.1, 0.46);
});
}
