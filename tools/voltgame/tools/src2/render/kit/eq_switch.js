// ============================================================================
// render/kit/eq_switch.js — anahtarlama kitleri: kesici (sabit / çekmeli ACB / MCC çekmecesi / kontaktörlü kademe),
// ayırıcı (3 kutuplu bıçak), yük ayırıcısı (RMU), topraklama ayırıcısı, NH sigorta, kontaktör, buton, yardımcı kontak.
// (Kural sürümü 4: izdüşüm seçicisi kafası kaldırıldı; eski kuplörler sahada gerçek kesici/ayırıcı/yük ayırıcısıdır.)
//                                                                                sahip: Sanat (kits)
// Ortak dil: durum tepe yüzünde okunur (her görünümde görünür): mimik levha / bıçak açısı / kilit / tepe lambası.
// Ön yüz (Volti'nin eriştiği taraf): etiket (-Q01…), I/O bayrağı, 3 noktalı gerilim göstergesi (VPIS), kol.
// ============================================================================
const LIB = PX.KITLIB;
if (LIB) {
const R = LIB.R, P = LIB.P, D2R = Math.PI / 180;

// ---------------------------------------------------------------- kesici
function breakerFixed(k, mcc) {
  const b = k.b, S = k.S;
  LIB.cabinet(k, { door: !mcc, labelY: 0.25 });
  if (mcc) {   // MCC: üç çekmece, ortadaki bu fider
    const rows = [[-0.38, -0.16], [-0.13, 0.13], [0.16, 0.36]];
    for (let i = 0; i < 3; i++) {
      const y0 = rows[i][0], y1 = rows[i][1];
      b.color(S.door).box(-0.39, y0, 0.44, 0.39, y1, 0.452, { f: R('DOOR') });
      b.color(S.handle).box(0.24, (y0 + y1) / 2 - 0.025, 0.452, 0.34, (y0 + y1) / 2 + 0.025, 0.468);
    }
    LIB.front(k, -0.30, -0.08, -0.14, 0.08, 0.454, R('FLAG_O'), 'flag');
    LIB.liveFace(k, -0.08, -0.04, 0.16, 0.04, 0.454);
    const lab = LIB.label('-' + k.el.id, 'plate');
    b.color(0xffffff).quad(-0.17, 0.215, 0.454, 0.17, 0.215, 0.454, 0.17, 0.30, 0.454, -0.17, 0.30, 0.454, lab);
  } else {
    LIB.front(k, -0.09, 0.02, 0.09, 0.15, 0.458, R('FLAG_O'), 'flag');
    LIB.liveFace(k, -0.14, -0.08, 0.10, -0.02, 0.458);
    if (k.og) { // OG hücresi: mimik şerit + kumanda düğmeleri
      b.color(0x1d2a3a).box(-0.36, -0.30, 0.452, -0.30, 0.18, 0.458);
      b.color(0x2e7d32).box(0.12, -0.20, 0.452, 0.18, -0.14, 0.47); b.color(0xc62828).box(0.12, -0.30, 0.452, 0.18, -0.24, 0.47);
    }
  }
  if (k.og) LIB.side(k, 1, -0.12, 0.06, 0.12, 0.30, 0.442, R('DANGER'));
  LIB.mimic(k, -0.07, 0, 0.3, 0.45, 'BRK_O');
  LIB.lamp(k, 0.37, 0.45, -0.34, 0.1, 'lampT');
  k.anchor.set(0.28, 0.0, 0.48);
  k.onState = (st) => {
    k.region('mimic', R(st.tripped ? 'BRK_T' : st.closed ? 'BRK_C' : 'BRK_O'));
    k.region('flag', R(st.tripped ? 'FLAG_T' : st.closed ? 'FLAG_I' : 'FLAG_O'));
    LIB.applyLive(k, st.live);
  };
}
// Çekmeli ACB: hücre + raylı araba. Açık = dışarı çekilmiş (sim2), araba 0,26 öne kayar, iç kepenkler görünür.
function breakerDrawout(k) {
  const b = k.b, S = k.S;
  b.color(S.plinth).box(-0.43, -0.5, -0.44, 0.43, -0.44, 0.17);
  b.color(S.body).box(-0.44, -0.44, -0.45, -0.36, 0.33, 0.18).box(0.36, -0.44, -0.45, 0.44, 0.33, 0.18)
    .box(-0.36, -0.44, -0.45, 0.36, 0.33, -0.30).box(-0.36, 0.06, -0.30, 0.36, 0.33, 0.18);
  b.color(0x30353b).box(-0.36, -0.46, -0.30, 0.36, -0.42, 0.18);
  b.color(0xffffff).quad(-0.36, -0.42, -0.299, 0.36, -0.42, -0.299, 0.36, 0.06, -0.299, -0.36, 0.06, -0.299, R('HAZARD'));  // kepenkler
  b.color(S.roof).box(-0.465, 0.33, -0.465, 0.465, 0.36, 0.205);
  b.color(0x24282d).box(-0.30, -0.5, 0.17, 0.30, -0.485, 0.47);                                        // ray platformu
  b.color(P.galv).box(-0.27, -0.485, -0.30, -0.23, -0.455, 0.47).box(0.23, -0.485, -0.30, 0.27, -0.455, 0.47);
  b.color(0xffffff).quad(-0.32, 0.20, 0.181, -0.06, 0.20, 0.181, -0.06, 0.285, 0.181, -0.32, 0.285, 0.181, LIB.label('-' + k.el.id, 'plate'));
  b.quad(0.17, 0.20, -0.452, -0.17, 0.20, -0.452, -0.17, 0.285, -0.452, 0.17, 0.285, -0.452, LIB.label('-' + k.el.id, 'plate'));
  LIB.liveFace(k, 0.04, 0.21, 0.30, 0.27, 0.181);
  b.color(0x1d2a3a).box(-0.30, 0.09, 0.18, 0.30, 0.17, 0.186);
  // araba
  b.begin('truck');
  b.color(0x2b3037).box(-0.32, -0.45, -0.28, 0.32, 0.02, 0.17, { bot: false });
  b.color(S.door).box(-0.34, -0.44, 0.17, 0.34, 0.035, 0.20, { f: R('DOOR') });
  b.color(0x1b1b1b).box(-0.30, -0.47, 0.06, -0.24, -0.43, 0.12).box(0.24, -0.47, 0.06, 0.30, -0.43, 0.12);   // tekerler
  LIB.front(k, -0.08, -0.12, 0.08, 0.0, 0.202, R('FLAG_O'), 'flag');
  b.color(0x2e7d32).box(-0.25, -0.10, 0.20, -0.17, -0.04, 0.215); b.color(0xc62828).box(-0.25, -0.22, 0.20, -0.17, -0.16, 0.215);
  b.color(0x15171a).box(0.16, -0.32, 0.20, 0.24, -0.24, 0.212);                                        // kurma kolu yuvası
  b.color(S.handle).box(-0.06, -0.36, 0.20, 0.06, -0.33, 0.225);
  b.end();
  LIB.mimic(k, -0.07, -0.13, 0.25, 0.36, 'BRK_O');
  LIB.lamp(k, 0.37, 0.36, -0.38, 0.09, 'lampT');
  const lk = LIB.padlock(k, 0.33, 0.36, 0.13, 0.17);
  k.anchor.set(0.0, -0.1, 0.48);
  const rack = k.chan(0.4, v => k.move('truck', 0, 0, v * 0.245));
  const lock = k.chan(0.18, v => k.scale('lock', lk[0], lk[1], lk[2], v));
  k.onState = (st, prev, snap) => {
    k.region('mimic', R(st.tripped ? 'BRK_T' : st.closed ? 'BRK_C' : 'BRK_O'));
    k.region('flag', R(st.tripped ? 'FLAG_T' : st.closed ? 'FLAG_I' : 'FLAG_O'));
    k.go(rack, st.closed ? 0 : 1, snap); k.go(lock, st.locked ? 1 : 0, snap);
    LIB.applyLive(k, st.live);
  };
}
// Kontaktör gövdesi (kontaktör, kontaktörlü kondansatör kademe "kesicisi", yardımcı kontak)
function contactorCab(k, sym) {
  const b = k.b, S = k.S;
  LIB.cabinet(k, { labelY: 0.27 });
  b.color(0xffffff).quad(-0.30, -0.24, 0.4555, 0.30, -0.24, 0.4555, 0.30, 0.22, 0.4555, -0.30, 0.22, 0.4555, R('GLASS'));
  b.color(0x55606a).box(-0.32, 0.0, 0.456, 0.32, 0.03, 0.462);                                             // DIN rayı
  b.color(0xd9dcd9).box(-0.13, -0.18, 0.456, 0.13, 0.18, 0.462);                                           // kontaktör gövdesi
  b.color(0x30353b).box(-0.11, 0.10, 0.462, 0.11, 0.16, 0.466).box(-0.11, -0.16, 0.462, 0.11, -0.10, 0.466);  // klemens sıraları
  b.color(0xffffff).begin('slider').box(-0.05, -0.05, 0.462, 0.05, 0.03, 0.469, R('FLAG_O')).end();
  b.color(0xd9dcd9).box(0.16, -0.10, 0.456, 0.25, 0.10, 0.464);                                            // yardımcı kontak bloğu
  LIB.liveFace(k, -0.28, -0.34, -0.06, -0.28, 0.4565);
  LIB.mimic(k, -0.07, 0, 0.3, 0.45, sym + '_O');
  LIB.lamp(k, 0.37, 0.45, -0.34, 0.1, 'lampT');
  k.anchor.set(0.0, 0.0, 0.48);
  const sl = k.chan(0.12, v => k.move('slider', 0, v * 0.05, 0));
  k.onState = (st, prev, snap) => {
    const on = st.closed;
    k.region('mimic', R(sym + (on ? '_C' : '_O'))); k.region('slider', R(on ? 'FLAG_I' : 'FLAG_O'));
    k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF')); k.region('lampT', R(on ? 'LAMP_G' : 'LAMP_OFF'));
    k.go(sl, on ? 1 : 0, snap);
  };
}
LIB.def('kesici', k => {
  if (k.el.cekmeli) breakerDrawout(k);
  else if (k.has('kontaktör') || k.has('kontaktor')) contactorCab(k, 'KON');
  else breakerFixed(k, k.biyom === 'Fabrika' || k.has('motor fider'));
});
LIB.def('kontaktor', k => contactorCab(k, 'KON'));
LIB.def('yardimci', k => contactorCab(k, 'KON'));

// ---------------------------------------------------------------- açık hava çerçevesi (ayırıcı, toprak, bara)
function frameCell(k, baseTop) {
  const b = k.b;
  b.color(P.concrete).box(-0.45, -0.5, -0.45, 0.45, -0.43, 0.45, { t: R('CONCRETE'), all: null });
  b.color(P.galv).box(-0.42, -0.43, -0.40, 0.42, baseTop, 0.40);
  const c = 0.44, w = 0.017;
  for (let i = 0; i < 4; i++) { const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1; b.color(0x8d969c).box(sx * c - w, -0.43, sz * c - w, sx * c + w, 0.465, sz * c + w); }
  b.color(0x8d969c).box(-c - w, 0.44, -c - w, c + w, 0.465, -c + w).box(-c - w, 0.44, c - w, c + w, 0.465, c + w)
    .box(-c - w, 0.44, -c + w, -c + w, 0.465, c - w).box(c - w, 0.44, -c + w, c + w, 0.465, c - w);
}
function frontPlates(k, y0, flag) {
  const b = k.b, lab = LIB.label('-' + k.el.id, 'plate');
  b.color(0xffffff).quad(-0.36, y0, 0.402, -0.10, y0, 0.402, -0.10, y0 + 0.08, 0.402, -0.36, y0 + 0.08, 0.402, lab);
  b.quad(0.13, y0, -0.402, -0.13, y0, -0.402, -0.13, y0 + 0.08, -0.402, 0.13, y0 + 0.08, -0.402, lab);
  if (flag) LIB.front(k, -0.06, y0 - 0.005, 0.03, y0 + 0.085, 0.402, R('FLAG_O'), 'flag');
  LIB.liveFace(k, 0.06, y0 + 0.01, 0.20, y0 + 0.07, 0.402);
}

// ---------------------------------------------------------------- ayırıcı (3 kutuplu, döner bıçak: yatay = kapalı, 70° = açık)
LIB.def('ayirici', k => {
  const b = k.b, seg = k.seg, BT = -0.29;
  frameCell(k, BT);
  const ZP = [-0.25, 0, 0.25], XH = -0.27, XC = 0.25, ih = 0.21, ir = k.og ? 0.032 : 0.036;
  const prof = LIB.insProf(k, ih, ir), icol = LIB.insCol(k);
  b.color(P.galv).push().at(XH, BT + 0.025, 0).rx(Math.PI / 2).cyl(0.018, 0.018, -0.33, 0.33, 6, null, null, { top: true }).pop();   // ortak tahrik mili
  for (let i = 0; i < 3; i++) {
    const z = ZP[i];
    b.color(LIB.PHASE[i]).box(XH - 0.06, BT, z - 0.06, XH + 0.06, BT + 0.012, z + 0.06);
    b.color(icol).push().at(XH, BT, z).lathe(prof, seg).pop().push().at(XC, BT, z).lathe(prof, seg).pop();
    b.color(P.alu).box(XH - 0.045, BT + ih, z - 0.035, XH + 0.035, BT + ih + 0.04, z + 0.035);       // mafsal
    b.color(P.copper).box(XC - 0.04, BT + ih, z - 0.045, XC + 0.05, BT + ih + 0.07, z - 0.025).box(XC - 0.04, BT + ih, z + 0.025, XC + 0.05, BT + ih + 0.07, z + 0.045); // çene
  }
  const PY = BT + ih + 0.03;   // bıçak pivot yüksekliği
  b.begin('blades');
  for (let i = 0; i < 3; i++) { const z = ZP[i]; b.color(0xd8dde2).box(XH - 0.02, PY - 0.016, z - 0.024, XC + 0.02, PY + 0.016, z + 0.024, { bot: true }); }
  b.end();
  // kumanda kolu: taban üstü sağ ön; kol açısı da durumu gösterir
  b.color(0x30353b).box(0.22, BT, 0.22, 0.36, BT + 0.07, 0.36);
  b.begin('lever'); b.color(0x1b1b1b).box(0.27, BT + 0.07, 0.27, 0.31, BT + 0.20, 0.31); b.color(0xc62828).box(0.26, BT + 0.19, 0.26, 0.32, BT + 0.23, 0.32); b.end();
  frontPlates(k, -0.41, true);
  const lk = LIB.padlock(k, 0.29, BT + 0.07, 0.34, 0.12);
  k.anchor.set(0.29, -0.15, 0.45);
  const ang = 70 * D2R, lp = [0.29, BT + 0.07, 0.29];
  const bl = k.chan(0.32, v => { k.rotate('blades', XH, PY, 0, 2, v * ang); k.rotate('lever', lp[0], lp[1], lp[2], 0, -v * 1.1); });
  const lock = k.chan(0.18, v => k.scale('lock', lk[0], lk[1], lk[2], v));
  k.onState = (st, prev, snap) => {
    k.go(bl, st.closed ? 0 : 1, snap); k.go(lock, st.locked ? 1 : 0, snap);
    k.region('flag', R(st.closed ? 'FLAG_I' : 'FLAG_O')); k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF'));
  };
});

// ---------------------------------------------------------------- topraklama ayırıcısı (sarı-yeşil bıçaklar; kapalı = dik, kelepçeli)
LIB.def('toprak', k => {
  const b = k.b, seg = k.seg, BT = -0.27;
  frameCell(k, BT);
  const ZB = -0.30, YB = 0.32, XS = [-0.22, 0, 0.22];
  const prof = LIB.insProf(k, YB - BT - 0.01, 0.034), icol = LIB.insCol(k);
  b.color(icol).push().at(-0.37, BT, ZB).lathe(prof, seg).pop().push().at(0.37, BT, ZB).lathe(prof, seg).pop();
  b.color(P.copper).box(-0.41, YB, ZB - 0.035, 0.41, YB + 0.05, ZB + 0.035, { all: R('CU') });               // topraklanacak iletken
  for (let i = 0; i < 3; i++) { b.color(LIB.PHASE[i]).box(XS[i] - 0.05, YB + 0.05, ZB - 0.036, XS[i] + 0.05, YB + 0.062, ZB + 0.036); b.color(P.copper).box(XS[i] - 0.04, YB - 0.06, ZB - 0.05, XS[i] + 0.04, YB, ZB + 0.05); }
  b.color(P.galv).push().at(0, BT + 0.03, ZB).rz(Math.PI / 2).cyl(0.022, 0.022, -0.34, 0.34, 6, null, null).pop();  // toprak mili
  b.color(0xffffff).box(-0.40, BT, ZB - 0.02, -0.36, BT + 0.03, ZB + 0.02, R('PE'));
  const PYv = BT + 0.03, L = 0.6;
  b.begin('eb');
  for (let i = 0; i < 3; i++) b.color(0xffffff).box(XS[i] - 0.026, PYv - 0.018, ZB, XS[i] + 0.026, PYv + 0.018, ZB + L, { all: R('PE'), bot: true });
  b.end();
  b.begin('kel');
  for (let i = 0; i < 3; i++) b.color(0xffffff).box(XS[i] - 0.045, YB - 0.10, ZB - 0.06, XS[i] + 0.045, YB - 0.03, ZB + 0.06, R('PE'));
  b.end();
  LIB.front(k, 0.24, -0.41, 0.36, -0.29, 0.402, R('PE_SIGN'));
  frontPlates(k, -0.40, true);
  k.anchor.set(0.0, -0.15, 0.45);
  const eb = k.chan(0.35, v => k.rotate('eb', 0, PYv, ZB, 0, -v * Math.PI / 2));
  const kel = k.chan(0.15, v => k.scale('kel', 0, YB - 0.065, ZB, v));
  k.onState = (st, prev, snap) => {
    k.go(eb, st.closed ? 1 : 0, snap); k.go(kel, st.closed ? 1 : 0, snap);
    k.region('flag', R(st.closed ? 'FLAG_I' : 'FLAG_O')); k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF'));
  };
});

// ---------------------------------------------------------------- yük ayırıcısı (RMU hücresi)
LIB.def('yuk_ayirici', k => {
  const b = k.b, S = k.S;
  LIB.cabinet(k, { door: false, label: false, y1: 0.33, roofY: 0.36 });
  b.color(0x1f3550).box(-0.40, -0.02, 0.44, 0.40, 0.31, 0.452);                                              // mimik panel
  LIB.front(k, -0.14, 0.02, 0.14, 0.30, 0.4535, R('LBS_O'), 'fmim');
  LIB.front(k, 0.21, 0.17, 0.35, 0.29, 0.4535, R('GAUGE'));
  LIB.liveFace(k, -0.36, 0.22, -0.19, 0.28, 0.4535);
  b.color(0x15171a).box(-0.33, 0.06, 0.452, -0.23, 0.16, 0.462);                                           // kumanda deliği
  b.color(S.door).box(-0.39, -0.38, 0.44, 0.39, -0.06, 0.452, { f: R('DOOR') });                            // kablo bölmesi
  b.color(S.handle).box(0.28, -0.26, 0.452, 0.32, -0.14, 0.47);
  const lab = LIB.label('-' + k.el.id, 'plate');
  b.color(0xffffff).quad(-0.17, -0.17, 0.4535, 0.17, -0.17, 0.4535, 0.17, -0.085, 0.4535, -0.17, -0.085, 0.4535, lab);
  b.quad(0.17, 0.20, -0.442, -0.17, 0.20, -0.442, -0.17, 0.285, -0.442, 0.17, 0.285, -0.442, lab);
  if (k.og) LIB.side(k, 1, -0.12, 0.04, 0.12, 0.28, 0.442, R('DANGER'));
  LIB.mimic(k, -0.07, -0.04, 0.28, 0.36, 'LBS_O');
  LIB.lamp(k, 0.37, 0.36, -0.36, 0.09, 'lampT');
  const lk = LIB.padlock(k, 0.33, 0.36, 0.36, 0.2);
  k.anchor.set(-0.28, 0.1, 0.48);
  const lock = k.chan(0.18, v => k.scale('lock', lk[0], lk[1], lk[2], v));
  k.onState = (st, prev, snap) => {
    const r = R(st.closed ? 'LBS_C' : 'LBS_O'); k.region('mimic', r); k.region('fmim', r);
    k.go(lock, st.locked ? 1 : 0, snap); LIB.applyLive(k, st.live);
  };
});

// ---------------------------------------------------------------- NH sigorta (3 faz buşon tepe yüzünde)
LIB.def('sigorta', k => {
  const b = k.b;
  LIB.cabinet(k, { y1: 0.16, roofY: 0.20, roofCol: 0x2a2e33, labelY: 0.0, doorY1: 0.12 });
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.27;
    b.color(0x1b1d20).box(x - 0.1, 0.20, -0.34, x + 0.1, 0.235, 0.34);
    b.color(LIB.PHASE[i]).box(x - 0.1, 0.235, 0.30, x + 0.1, 0.245, 0.34);
    b.color(P.alu).box(x - 0.06, 0.235, -0.29, x + 0.06, 0.31, -0.22).box(x - 0.06, 0.235, 0.22, x + 0.06, 0.31, 0.29);
    b.color(0xcfd4d8).box(x - 0.05, 0.27, -0.27, x + 0.05, 0.29, -0.17).box(x - 0.05, 0.27, 0.17, x + 0.05, 0.29, 0.27);
    b.color(P.alu).box(x - 0.028, 0.36, -0.17, x + 0.028, 0.41, -0.13).box(x - 0.028, 0.36, 0.13, x + 0.028, 0.41, 0.17);  // çekme tırnakları
  }
  b.begin('links'); for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.27; b.color(0xefeae0).box(x - 0.075, 0.25, -0.18, x + 0.075, 0.37, 0.18); } b.end();
  b.begin('ind'); for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.27; b.color(0xbfc4c8).box(x - 0.04, 0.37, -0.04, x + 0.04, 0.385, 0.04); } b.end();
  LIB.liveFace(k, -0.12, -0.12, 0.12, -0.06, 0.458);
  b.begin('eridi'); b.color(0xffffff).quad(-0.2, -0.30, 0.459, 0.2, -0.30, 0.459, 0.2, -0.20, 0.459, -0.2, -0.20, 0.459, LIB.label('ERİDİ', 'red')); b.end();
  if (k.q >= 1) { b.color(0x1d4f91).box(0.445, -0.25, -0.10, 0.465, 0.0, 0.10); b.color(0x9aa1a6).box(0.445, 0.0, -0.03, 0.47, 0.08, 0.03); }  // NH çekme kolu
  k.anchor.set(0.0, 0.1, 0.48);
  const er = k.chan(0.15, v => k.scale('eridi', 0, -0.25, 0.459, v));
  k.onState = (st, prev, snap) => {
    const blown = st.blown || !st.closed;
    k.tint('links', blown ? 0x4a3b31 : 0xefeae0); k.tint('ind', blown ? 0xe53935 : 0xbfc4c8);
    k.go(er, blown ? 1 : 0, snap); k.region('vpis', R(st.live ? 'VPIS_ON' : 'VPIS_OFF'));
  };
});

// ---------------------------------------------------------------- buton (kumanda kutusu; STOP = NK kırmızı mantar, START = NA yeşil gömme)
LIB.def('buton', k => {
  const b = k.b, S = k.S, nc = !!k.el.nc;
  LIB.cabinet(k, { y1: 0.26, roofY: 0.30, body: k.biyom === 'Fabrika' ? 0xe8b10a : S.body, doorY1: 0.21, labelY: 0.10 });
  const word = String(k.el.ad || '').split(/[\s(]/)[0] || (nc ? 'STOP' : 'START');
  const lab = LIB.label(word.toLocaleUpperCase('tr'), nc ? 'red' : 'green');
  b.color(0xffffff).quad(-0.17, -0.06, 0.458, 0.17, -0.06, 0.458, 0.17, 0.03, 0.458, -0.17, 0.03, 0.458, lab);
  b.quad(0.17, 0.10, -0.442, -0.17, 0.10, -0.442, -0.17, 0.185, -0.442, 0.17, 0.185, -0.442, lab);
  b.color(0x1b1d20).push().at(0, 0.30, 0).cyl(0.19, 0.17, 0, 0.05, k.seg + 2, null, null).pop();
  if (!nc) b.color(0x1b1d20).push().at(0, 0.35, 0).cyl(0.17, 0.17, 0, 0.03, k.seg + 2, null, null).pop();   // koruma yakası
  b.begin('cap');
  if (nc) { b.color(0xd32f2f).push().at(0, 0.35, 0).cyl(0.06, 0.06, 0, 0.03, k.seg, null, null).pop().push().at(0, 0.38, 0).lathe([[0.0, 0], [0.16, 0], [0.16, 0.03], [0.12, 0.07], [0.0, 0.085]], k.seg + 2).pop(); }
  else b.color(0x2e9e4a).push().at(0, 0.35, 0).cyl(0.13, 0.13, 0, 0.065, k.seg + 2, null, null).pop();
  b.end();
  LIB.liveFace(k, -0.30, -0.30, -0.10, -0.24, 0.458);
  LIB.lamp(k, 0.36, 0.30, -0.36, 0.08, 'lampT');
  k.anchor.set(0, 0.3, 0.2);
  const pr = k.chan(0.22, v => k.move('cap', 0, -v * 0.03, 0), true);
  k.onAct = kind => { if (kind === 'press' || kind === 'op') { pr.t0 = performance.now(); pr.on = true; k.anim = true; } };
  k.onState = st => LIB.applyLive(k, st.live);
});

}
