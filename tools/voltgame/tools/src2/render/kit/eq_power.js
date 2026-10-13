// ============================================================================
// render/kit/eq_power.js — güç kitleri: trafo (34,5/0,4 kV yağlı; kumanda trafosu), kondansatör bataryası,
// kaynak (UPS, beton köşk trafo AG, OG fider hücresi, fabrika ana giriş, dizel), açık bara, arıza (kablo eki),
// kablo başlığı.                                                                 sahip: Sanat (kits)
// ============================================================================
const LIB = PX.KITLIB;
if (LIB) {
const R = LIB.R, P = LIB.P;

// ---------------------------------------------------------------- trafo
function oilTrafo(k) {
  const b = k.b, seg = k.seg, TANK = 0x9ba3a9;
  b.color(P.concreteD).box(-0.45, -0.5, -0.45, 0.45, -0.46, 0.45, { t: R('CONCRETE'), all: null });
  b.color(P.dark).box(-0.30, -0.46, -0.26, 0.30, -0.42, -0.19).box(-0.30, -0.46, 0.19, 0.30, -0.42, 0.26);   // kızaklar
  b.color(TANK).box(-0.24, -0.42, -0.22, 0.24, 0.10, 0.22);
  const nf = k.q === 0 ? 5 : 7;
  for (let s = -1; s <= 1; s += 2) {   // radyatör kanatları ±x
    const xa = s > 0 ? 0.24 : -0.45, xb = s > 0 ? 0.45 : -0.24;
    b.color(0x8a9298).box(xa, 0.0, -0.20, xb, 0.04, 0.20).box(xa, -0.36, -0.20, xb, -0.32, 0.20);
    for (let i = 0; i < nf; i++) { const z = -0.18 + i * 0.36 / (nf - 1); b.color(TANK).box(xa, -0.34, z - 0.014, xb, 0.02, z + 0.014); }
  }
  b.color(0x8a9298).box(-0.26, 0.10, -0.24, 0.26, 0.13, 0.24);                                    // kapak
  const og = LIB.insProf(k, 0.30, 0.032, 3), ag = LIB.insProf(k, 0.12, 0.03, 1);
  for (let i = -1; i <= 1; i++) {   // OG buşingleri (porselen) + terminal
    b.color(P.porcelain).push().at(i * 0.15, 0.13, -0.07).lathe(og, seg).pop();
    b.color(P.alu).box(i * 0.15 - 0.022, 0.43, -0.092, i * 0.15 + 0.022, 0.465, -0.048);
  }
  for (let i = 0; i < 4; i++) {     // AG buşingleri (3 faz + N)
    const x = -0.18 + i * 0.12;
    b.color(i === 3 ? 0x6d7a88 : P.porcelainG).push().at(x, 0.13, 0.14).lathe(ag, seg).pop();
    b.color(P.copper).box(x - 0.025, 0.25, 0.12, x + 0.025, 0.31, 0.16);
  }
  // genleşme tankı (konservatör) + yağ seviye göstergesi + Buchholz borusu
  b.color(P.galv).box(-0.20, 0.13, -0.34, -0.17, 0.26, -0.29).box(0.17, 0.13, -0.34, 0.20, 0.26, -0.29);
  b.color(TANK).push().at(0, 0.32, -0.31).rz(Math.PI / 2).cyl(0.07, 0.07, -0.25, 0.25, seg, null, null, { top: true, bot: true }).pop();
  LIB.side(k, 1, -0.36, 0.28, -0.26, 0.37, 0.252, R('GAUGE'));
  b.color(0x6d757c).box(0.06, 0.13, -0.27, 0.09, 0.27, -0.24);
  // kademe değiştirici (yüksüz) + kol
  b.color(0x30353b).box(0.15, 0.13, -0.01, 0.23, 0.18, 0.07); b.color(0xc62828).box(0.18, 0.18, 0.0, 0.20, 0.21, 0.06);
  // ön: anma levhası + etiket + gerilim; arka: tehlike levhası
  LIB.front(k, -0.20, -0.20, 0.0, -0.02, 0.222, R('TRAFO'));
  LIB.front(k, 0.03, -0.12, 0.21, -0.04, 0.222, LIB.label('-' + k.el.id, 'plate'));
  LIB.liveFace(k, 0.04, -0.21, 0.20, -0.15, 0.222);
  LIB.back(k, -0.10, -0.24, 0.10, -0.04, -0.222, R('DANGER'));
  LIB.back(k, -0.12, -0.33, 0.12, -0.255, -0.222, LIB.label('34,5/0,4 kV', 'yellow'));
  b.color(0xffffff).box(-0.24, -0.46, 0.20, -0.20, -0.30, 0.235, R('PE'));
  k.anchor.set(0.19, 0.18, 0.1);
  k.onState = st => k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF'));
}
function controlTrafo(k) {
  const b = k.b;
  LIB.cabinet(k, { y1: 0.10, roofY: 0.14, labelY: -0.06 });
  b.color(0x30353b).box(-0.30, 0.14, -0.22, 0.30, 0.17, 0.22);
  b.color(0x3c4249).box(-0.20, 0.17, -0.12, 0.20, 0.42, 0.12);                                  // EI çekirdek
  b.color(0xffffff).box(-0.17, 0.20, -0.16, -0.03, 0.39, 0.16, R('CU')).box(0.03, 0.20, -0.16, 0.17, 0.39, 0.16, R('CU'));  // bobinler
  b.color(0x1b1d20).box(-0.28, 0.17, 0.16, 0.28, 0.22, 0.21);
  for (let i = 0; i < 6; i++) b.color(P.alu).box(-0.25 + i * 0.1, 0.22, 0.17, -0.21 + i * 0.1, 0.24, 0.20);
  LIB.front(k, -0.12, -0.30, 0.12, -0.12, 0.457, R('TRAFO'));
  LIB.liveFace(k, 0.16, -0.26, 0.36, -0.20, 0.457);
  k.anchor.set(0, 0, 0.48);
  k.onState = st => k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF'));
}
LIB.def('trafo', k => { if (k.has('kumanda') || k.kv <= 1) controlTrafo(k); else oilTrafo(k); });

// ---------------------------------------------------------------- kondansatör bataryası (silindir hücreler + deşarj göstergesi)
LIB.def('kondansator', k => {
  const b = k.b, seg = k.seg;
  LIB.cabinet(k, { y1: 0.10, roofY: 0.13, roofCol: P.galv, labelY: -0.06, doorY1: 0.06 });
  const C = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
  for (let i = 0; i < 4; i++) {
    const x = C[i][0], z = C[i][1];
    b.color(P.alu).push().at(x, 0.13, z).cyl(0.12, 0.12, 0, 0.24, seg, null, null).pop();
    b.color(0xa9b0b6).push().at(x, 0.37, z).cyl(0.11, 0.09, 0, 0.02, seg, null, null).pop();
    b.color(0xe7e7e0).push().at(x - 0.045, 0.39, z).cyl(0.022, 0.016, 0, 0.05, 6, null, null).pop().push().at(x + 0.045, 0.39, z).cyl(0.022, 0.016, 0, 0.05, 6, null, null).pop();
    b.color(0x2b2f35).box(x - 0.05, 0.44, z - 0.012, x + 0.05, 0.455, z + 0.012);              // deşarj direnci
  }
  // bağlantı baraları: topraklanınca sarı-yeşil çizgili (desen; yalnız renk değil)
  b.begin('bus'); b.color(0xffffff).box(-0.29, 0.44, -0.225, 0.29, 0.456, -0.175, R('CU')).box(-0.29, 0.44, 0.175, 0.29, 0.456, 0.225, R('CU')); b.end();
  // deşarj göstergesi (rakam + 3 dilim) ön ve arkada: her görünümden biri okunur
  LIB.front(k, -0.17, -0.34, 0.17, -0.10, 0.458, R('DIG0'), 'digF');
  LIB.back(k, -0.17, -0.34, 0.17, -0.10, -0.442, R('DIG0'), 'digB');
  LIB.side(k, 1, -0.12, -0.08, 0.12, 0.06, 0.442, R('DANGER'));
  LIB.clamp(k, 0.245, 0.43, 0.2, 'pe', 0.30);
  LIB.liveFace(k, 0.22, -0.30, 0.38, -0.24, 0.458);
  k.anchor.set(0, 0, 0.48);
  const pe = k.chan(0.15, v => k.scale('pe', 0.245, 0.43, 0.2, v));
  k.onState = (st, prev, snap) => {
    const r = R('DIG' + st.charge); k.region('digF', r); k.region('digB', r);
    k.go(pe, st.earthed ? 1 : 0, snap); k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF'));
    k.region('bus', R(st.earthed ? 'PE' : 'CU'));
  };
});

// ---------------------------------------------------------------- kaynak
function srcUPS(k) {
  const b = k.b;
  LIB.cabinet(k, { body: 0x2e3338, roofCol: 0x23272c, doorCol: 0x3a4047, plinth: 0x17191c, labelY: 0.26 });
  LIB.front(k, -0.24, 0.02, 0.10, 0.20, 0.458, R('SCREEN_OFF'), 'scr');
  b.begin('leds'); for (let i = 0; i < 4; i++) LIB.front(k, 0.15 + i * 0.055, 0.12, 0.19 + i * 0.055, 0.16, 0.458, R('LAMP_OFF')); b.end();
  LIB.front(k, -0.30, -0.34, 0.30, -0.08, 0.458, R('GRILLE'));
  LIB.mimic(k, -0.07, 0, 0.3, 0.45, 'SRC');
  LIB.lamp(k, 0.37, 0.45, -0.34, 0.1, 'lampT');
  k.onState = st => { k.region('scr', R(st.live ? 'SCREEN_ON' : 'SCREEN_OFF')); k.region('leds', R(st.live ? 'LAMP_G' : 'LAMP_OFF')); k.region('lampT', R(st.live ? 'LAMP_G' : 'LAMP_OFF')); };
}
function srcKiosk(k) {
  const b = k.b, cr = R('CONCRETE');
  b.color(0x8c887e).box(-0.45, -0.5, -0.45, 0.45, -0.44, 0.45);
  b.color(0xc9c2b2).box(-0.43, -0.44, -0.43, 0.43, 0.30, 0.43, cr);
  b.color(0x9d968a).box(-0.465, 0.30, -0.465, 0.465, 0.36, 0.465, cr);
  b.color(0xb3ac9f).box(-0.40, 0.36, -0.40, 0.40, 0.40, 0.40, cr);
  b.color(0x5f7268).box(-0.36, -0.40, 0.43, -0.02, 0.20, 0.442, { f: R('LOUVRE') }).box(0.02, -0.40, 0.43, 0.36, 0.20, 0.442, { f: R('LOUVRE') });
  b.color(0x5f7268).box(-0.30, -0.36, -0.442, 0.30, 0.10, -0.43, { k: R('LOUVRE') });
  LIB.front(k, -0.30, -0.06, -0.10, 0.14, 0.443, R('DANGER'));
  LIB.front(k, 0.06, 0.04, 0.32, 0.12, 0.443, LIB.label('-' + k.el.id, 'plate'));
  LIB.liveFace(k, 0.10, -0.06, 0.28, 0.0, 0.443);
  LIB.mimic(k, 0, 0, 0.27, 0.40, 'TRAFO');
  LIB.lamp(k, 0.40, 0.36, 0.40, 0.08, 'lampT');
  k.onState = st => LIB.applyLive(k, st.live);
}
function srcFeeder(k) {
  const b = k.b, seg = k.seg;
  LIB.cabinet(k, { y1: 0.16, roofY: 0.20, labelY: 0.02, doorY1: 0.12 });
  LIB.side(k, 1, -0.12, -0.10, 0.12, 0.14, 0.442, R('DANGER'));
  b.color(0x30353b).box(-0.36, 0.20, -0.16, 0.36, 0.23, 0.16);
  const pr = LIB.insProf(k, 0.2, 0.035, 3);
  for (let i = 0; i < 3; i++) {   // kablo başlıkları
    const x = (i - 1) * 0.24;
    b.color(0x9a3b22).push().at(x, 0.23, 0).lathe(pr, seg).pop();
    b.color(P.alu).box(x - 0.025, 0.43, -0.025, x + 0.025, 0.465, 0.025);
    b.color(LIB.PHASE[i]).box(x - 0.05, 0.23, 0.10, x + 0.05, 0.245, 0.15);
  }
  LIB.front(k, -0.12, -0.30, 0.12, -0.06, 0.4585, R('SRC'));
  LIB.liveFace(k, 0.16, -0.12, 0.36, -0.06, 0.4585);
  LIB.front(k, -0.16, 0.13, 0.16, 0.19, 0.4585, LIB.label(k.kv > 1 ? (String(k.kv).replace('.', ',') + ' kV') : '0,4 kV', 'yellow'));
  k.onState = st => k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF'));
}
function srcIncomer(k) {
  const b = k.b;
  LIB.cabinet(k, { y1: 0.26, roofY: 0.30, labelY: 0.13 });
  b.color(0x8f969c).box(-0.13, 0.30, -0.465, 0.13, 0.46, 0.14);                                // bara kanalı girişi
  b.color(0x6d757c).box(-0.15, 0.30, 0.10, 0.15, 0.465, 0.15);
  for (let i = 0; i < 4; i++) b.color(0x6d757c).box(-0.135, 0.32 + i * 0.035, -0.46, 0.135, 0.33 + i * 0.035, 0.10);
  LIB.front(k, -0.12, -0.10, 0.12, 0.10, 0.458, R('SRC'));
  LIB.liveFace(k, -0.12, -0.22, 0.12, -0.16, 0.458);
  LIB.lamp(k, 0.33, 0.30, -0.33, 0.1, 'lampT');
  LIB.lamp(k, -0.33, 0.30, -0.33, 0.1, 'lampT2');
  k.onState = st => { LIB.applyLive(k, st.live); k.region('lampT2', R(st.live ? 'LAMP_A' : 'LAMP_OFF')); };
}
function srcDiesel(k) {
  const b = k.b;
  b.color(0x23272c).box(-0.44, -0.5, -0.40, 0.44, -0.42, 0.40);
  b.color(0x2f7d4a).box(-0.42, -0.42, -0.36, 0.42, 0.24, 0.36);
  b.color(0x276a3e).box(-0.44, 0.24, -0.38, 0.44, 0.28, 0.38);
  LIB.front(k, -0.36, -0.34, 0.0, 0.14, 0.361, R('LOUVRE')); LIB.back(k, -0.30, -0.34, 0.30, 0.14, -0.361, R('GRILLE'));
  b.color(0x3a3f45).push().at(0.25, 0.28, -0.18).cyl(0.05, 0.05, 0, 0.18, k.seg, null, null).pop();
  b.color(0x15171a).push().at(0.25, 0.44, -0.18).cyl(0.052, 0.052, 0, 0.02, k.seg, null, null).pop();
  LIB.front(k, 0.06, 0.0, 0.34, 0.16, 0.361, R('SCREEN_OFF'), 'scr');
  LIB.front(k, 0.06, -0.12, 0.34, -0.04, 0.362, LIB.label('-' + k.el.id, 'plate'));
  LIB.lamp(k, -0.30, 0.28, 0.25, 0.1, 'lampT');
  k.onState = st => { k.region('scr', R(st.live ? 'SCREEN_ON' : 'SCREEN_OFF')); k.region('lampT', R(st.live ? 'LAMP_A' : 'LAMP_OFF')); };
}
LIB.def('kaynak', k => {
  if (k.has('ups')) srcUPS(k);
  else if (k.has('dizel') || k.has('jeneratör') || k.has('jenerator') || k.el.acil) srcDiesel(k);
  else if ((k.has(' og ') || k.has('og ') || k.has('fider')) && !k.has('ag')) srcFeeder(k);
  else if (k.has('trafo') && k.biyom === 'Volt Mahallesi') srcKiosk(k);
  else if (k.has('pano') || k.has('trafo') || k.has('şebeke') || k.has('sebeke') || k.biyom === 'Fabrika') srcIncomer(k);
  else if (k.biyom === 'Trafo Merkezi' || k.og) srcFeeder(k);
  else if (k.biyom === 'Volt Mahallesi') srcKiosk(k);
  else srcUPS(k);
  k.anchor.set(0, 0, 0.48);
});

// ---------------------------------------------------------------- açık bara (yaklaşma sınırı; taşınabilir topraklama takımı)
LIB.def('bara', k => {
  const b = k.b, seg = k.seg;
  b.color(P.concrete).box(-0.45, -0.5, -0.45, 0.45, -0.43, 0.45, { t: R('CONCRETE'), all: null });
  const c = 0.44, w = 0.017;
  for (let i = 0; i < 4; i++) { const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1; b.color(0x8d969c).box(sx * c - w, -0.43, sz * c - w, sx * c + w, 0.465, sz * c + w); }
  b.color(0x8d969c).box(-c - w, 0.44, -c - w, c + w, 0.465, -c + w).box(-c - w, 0.44, c - w, c + w, 0.465, c + w)
    .box(-c - w, 0.44, -c + w, -c + w, 0.465, c - w).box(c - w, 0.44, -c + w, c + w, 0.465, c - w);
  b.color(P.galv).box(-0.42, -0.43, -0.40, 0.42, -0.34, 0.40);
  b.color(P.galv).box(-0.37, -0.34, -0.36, -0.31, -0.29, 0.36).box(0.31, -0.34, -0.36, 0.37, -0.29, 0.36);
  const ZP = [-0.24, 0, 0.24], pr = LIB.insProf(k, 0.30, 0.03), ic = LIB.insCol(k), YB = 0.01;
  for (let i = 0; i < 3; i++) {
    b.color(ic).push().at(-0.34, -0.29, ZP[i]).lathe(pr, seg).pop().push().at(0.34, -0.29, ZP[i]).lathe(pr, seg).pop();
    b.color(0xffffff).box(-0.45, YB, ZP[i] - 0.04, 0.45, YB + 0.04, ZP[i] + 0.04, R('CU'));
    b.color(LIB.PHASE[i]).box(-0.25, YB - 0.003, ZP[i] - 0.043, -0.18, YB + 0.043, ZP[i] + 0.043).box(0.18, YB - 0.003, ZP[i] - 0.043, 0.25, YB + 0.043, ZP[i] + 0.043);
  }
  // tehlike levhası (ön ve arka sütunlarda) + etiket + gerilim göstergesi
  LIB.front(k, -0.42, -0.12, -0.24, 0.06, 0.4605, R('DANGER')); LIB.back(k, 0.24, -0.12, 0.42, 0.06, -0.4605, R('DANGER'));
  b.color(0x8d969c).box(-0.43, -0.13, 0.44, -0.23, 0.07, 0.46).box(0.23, -0.13, -0.46, 0.43, 0.07, -0.44);
  LIB.front(k, -0.10, -0.42, 0.18, -0.35, 0.401, LIB.label('-' + k.el.id, 'plate'));
  LIB.liveFace(k, 0.22, -0.42, 0.38, -0.36, 0.401);
  // taşınabilir topraklama takımı: 3 kelepçe + toprak barasına kablo
  b.begin('set');
  for (let i = 0; i < 3; i++) {
    b.color(0xffffff).box(0.04, YB - 0.02, ZP[i] - 0.06, 0.12, YB + 0.08, ZP[i] + 0.06, R('PE'));
    b.color(0xffffff).box(0.07, -0.34, ZP[i] - 0.012, 0.095, YB - 0.02, ZP[i] + 0.012, R('PE'));
  }
  b.color(0xffffff).box(0.02, -0.36, -0.30, 0.14, -0.33, 0.30, R('PE'));
  b.end();
  k.anchor.set(0, 0.0, 0.42);
  const set = k.chan(0.18, v => k.scale('set', 0.08, -0.34, 0, v));
  k.onState = (st, prev, snap) => { k.go(set, st.earthed ? 1 : 0, snap); k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF')); };
});

// ---------------------------------------------------------------- arıza (kablo eki: kanal, is lekesi, arıza gösterge bayrağı)
LIB.def('ariza', k => {
  const b = k.b, seg = k.seg, cr = R('CONCRETE');
  b.color(0xa9a59a).box(-0.45, -0.5, -0.45, 0.45, 0.02, -0.36, cr).box(-0.45, -0.5, 0.36, 0.45, 0.02, 0.45, cr)
    .box(-0.45, -0.5, -0.36, -0.36, 0.02, 0.36, cr).box(0.36, -0.5, -0.36, 0.45, 0.02, 0.36, cr);
  b.color(0x3b3128).box(-0.36, -0.5, -0.36, 0.36, -0.34, 0.36);
  b.color(0x3a3d40).box(-0.36, -0.34, -0.36, 0.36, -0.32, 0.36);
  b.color(P.cable).push().at(0, -0.22, 0.04).rz(Math.PI / 2).cyl(0.05, 0.05, -0.45, 0.45, seg, null, null).pop();
  b.color(0x2a2a2a).push().at(0, -0.24, -0.18).rz(Math.PI / 2).cyl(0.035, 0.035, -0.45, 0.45, seg, null, null).pop();
  b.color(0xffffff).push().at(0, -0.22, 0.04).rz(Math.PI / 2).lathe([[0.05, -0.2], [0.09, -0.15], [0.09, 0.15], [0.05, 0.2]], seg, R('SOOT')).pop();
  b.color(0xffffff).quad(-0.30, -0.315, 0.30, 0.30, -0.315, 0.30, 0.30, -0.315, -0.30, -0.30, -0.315, -0.30, R('SOOT'));
  b.color(0xffffff).box(-0.45, 0.02, -0.45, -0.12, 0.045, 0.45, R('CHECKER'));                    // kapak levhası
  b.color(0xffffff).box(0.20, 0.02, -0.45, 0.45, 0.045, -0.12, R('CHECKER'));
  b.color(P.steel).box(0.36, 0.02, -0.42, 0.42, 0.30, -0.36);                                   // gösterge direği
  b.color(0x2b3037).box(0.30, 0.30, -0.45, 0.45, 0.44, -0.33);
  b.color(0xffffff).quad(0.30, 0.31, -0.329, 0.45, 0.31, -0.329, 0.45, 0.43, -0.329, 0.30, 0.43, -0.329, R('FAULT'));
  b.quad(0.451, 0.31, -0.33, 0.451, 0.31, -0.45, 0.451, 0.43, -0.45, 0.451, 0.43, -0.33, R('FAULT'));
  b.quad(0.45, 0.31, -0.451, 0.30, 0.31, -0.451, 0.30, 0.43, -0.451, 0.45, 0.43, -0.451, R('FAULT'));
  b.quad(0.299, 0.31, -0.45, 0.299, 0.31, -0.33, 0.299, 0.43, -0.33, 0.299, 0.43, -0.45, R('FAULT'));
  LIB.lamp(k, 0.375, 0.44, -0.39, 0.06, 'lampT');
  LIB.front(k, -0.40, -0.10, -0.12, -0.02, 0.451, LIB.label('-' + k.el.id, 'yellow'));
  k.anchor.set(0, -0.2, 0.3);
  k.onState = st => k.region('lampT', R(st.live ? 'LAMP_R' : 'LAMP_OFF'));
});

// ---------------------------------------------------------------- kablo başlığı
LIB.def('kablo', k => {
  const b = k.b, seg = k.seg;
  b.color(P.concrete).box(-0.45, -0.5, -0.45, 0.45, -0.40, 0.45, { t: R('CONCRETE'), all: null });
  b.color(P.galv).box(-0.40, -0.40, -0.06, 0.40, 0.10, 0.06);
  b.color(P.galv).box(-0.40, 0.10, -0.12, 0.40, 0.14, 0.12);
  const pr = LIB.insProf(k, 0.26, 0.035, 3);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.25;
    b.color(0x9a3b22).push().at(x, 0.14, 0).lathe(pr, seg).pop();
    b.color(P.alu).box(x - 0.025, 0.40, -0.025, x + 0.025, 0.44, 0.025);
    b.color(P.cable).push().at(x, -0.40, 0.12).cyl(0.03, 0.03, 0, 0.55, 6, null, null).pop();
    b.color(LIB.PHASE[i]).box(x - 0.045, 0.14, 0.07, x + 0.045, 0.155, 0.12);
  }
  LIB.front(k, -0.20, -0.30, 0.20, -0.22, 0.061, LIB.label('-' + k.el.id, 'plate'));
  LIB.liveFace(k, -0.12, -0.18, 0.12, -0.12, 0.061);
  k.anchor.set(0, 0, 0.3);
  k.onState = st => k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF'));
});
}
