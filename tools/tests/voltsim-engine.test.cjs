'use strict';

// VoltSim hesap motoru: bilinen değerler, sınır durumları ve hatalı girişler.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '../../js/voltsim/engine.js'));

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} beklenen ${expected} ± ${tol}, bulunan ${actual}`);

function panoInput(over) {
  return Object.assign({
    U_LL: 400, mainIn: 160, busbarIn: 250, mainIcu_kA: 36, SkQ_MVA: 500, trafo_kVA: 630, trafo_uk: 4, trafo_Pk: 4600, feedL: 20, feedS: 95, feedN: 1,
    circuits: [
      { name: 'Aydınlatma', phase: 'L1', P_kW: 2, cos: 0.95, on: true, kind: 'MCB', curve: 'B', In: 16, S: 2.5, L: 25, method: 'B1' },
      { name: 'Priz', phase: 'L2', P_kW: 2.5, cos: 0.9, on: true, kind: 'MCB', curve: 'C', In: 16, S: 2.5, L: 20, method: 'B1' },
      { name: 'Kompresör', phase: '3F', P_kW: 11, cos: 0.85, eff: 0.9, motor: true, running: true, on: true, kind: 'MCCB', In: 32, S: 6, L: 30, method: 'C' }
    ]
  }, over || {});
}

test('trafo AG nominal akımları: 1000 kVA ≈ 1443 A, 630 kVA ≈ 909 A', () => {
  near(E.currentFromS(1000e3, 400), 1443.4, 0.5);
  near(E.currentFromS(630e3, 400), 909.3, 0.5);
  const r = E.trafo.compute({ Sr_kVA: 1000, U1_kV: 34.5, U2_V: 400, P0: 690, Pk: 7600, uk: 6, P_kW: 800, cos: 0.9, ambient: 30, SkQ_MVA: 500 });
  assert.equal(r.errors.length, 0);
  near(r.values.I2n, 1443.4, 0.5);
  near(r.values.I1n, 16.73, 0.05, 'OG akımı');
});

test('trafo kayıpları ve verim', () => {
  const r = E.trafo.compute({ Sr_kVA: 630, U1_kV: 34.5, U2_V: 400, P0: 540, Pk: 4600, uk: 4, P_kW: 567, cos: 0.9, ambient: 20, SkQ_MVA: 0 });
  near(r.values.k, 1, 1e-9, 'tam yük');
  near(r.values.losses, 5140, 1e-6);
  near(r.values.eff, 567000 / (567000 + 5140) * 100, 1e-9);
  near(r.values.IkT, 909.3 / 0.04, 20, 'yalnız trafo kısa devre');
  near(r.values.temps.hotSpot, 20 + 55 + 23, 1e-6, 'K = 1 sıcak nokta = θa + Δθor + Hgr');
  near(r.values.aging, 1, 1e-9, '98 °C bağıl yaşlanma 1');
  near(r.values.kOpt, Math.sqrt(540 / 4600), 1e-12);
});

test('trafo enerjisizken kayıp yok, sıcaklık ortamda', () => {
  const r = E.trafo.compute({ Sr_kVA: 630, U1_kV: 34.5, U2_V: 400, P0: 540, Pk: 4600, uk: 4, P_kW: 0, cos: 0.9, ambient: 25, SkQ_MVA: 0, energized: false });
  assert.equal(r.values.losses, 0);
  assert.equal(r.values.temps.hotSpot, 25);
  assert.equal(E.ges.MONTH_MID.length, 12);
});

test('trafo hatalı girişleri reddeder', () => {
  const r = E.trafo.compute({ Sr_kVA: -5, U1_kV: 0.2, U2_V: 400, P0: 0, Pk: 50000, uk: 4, P_kW: 10, cos: 0.9, ambient: 20, SkQ_MVA: 0 });
  assert.ok(r.errors.length >= 2);
  assert.equal(r.ok, false);
});

test('şarj: 60 kWh %20→%80 ideal enerji 36 kWh, kayıplar ayrı', () => {
  const r = E.sarj.compute({ profile: 'DC120', capacity: 60, soc0: 20, soc1: 80, obcPhases: 3, obcI: 16, dcMax: 100, nPoints: 1, siteKW: 500, curve: 'constant', effDC: 94 });
  assert.equal(r.errors.length, 0);
  near(r.values.ideal, 36, 1e-9);
  near(r.values.Ebatt, 36, 1e-6, 'bataryaya giren enerji');
  near(r.values.Egrid, 36 / 0.94, 1e-3, 'şebeke enerjisi kayıp dahil');
  near(r.values.minutes, 36 / 100 * 60, 0.05, 'sabit 100 kW ile süre');
});

test('şarj: DC tipik eğri sabit güçten uzun sürer; AC OBC sınırı', () => {
  const base = { profile: 'DC180', capacity: 77, soc0: 10, soc1: 90, obcPhases: 3, obcI: 16, dcMax: 175, nPoints: 1, siteKW: 1000 };
  const typical = E.sarj.compute(Object.assign({ curve: 'typical' }, base));
  const constant = E.sarj.compute(Object.assign({ curve: 'constant' }, base));
  assert.ok(typical.values.minutes > constant.values.minutes);
  // 3 faz 32 A istasyon, 1 fazlı 32 A OBC → 7,36 kW
  const ac = E.sarj.acPower({ phases: 3, I: 32 }, { obcPhases: 1, obcI: 32 });
  near(ac.P, 7.36, 1e-9); assert.equal(ac.phases, 1);
  // 11 kW 3 faz 16 A
  near(E.sarj.acPower({ phases: 3, I: 16 }, { obcPhases: 3, obcI: 32 }).P, 11.04, 1e-9);
});

test('şarj: dinamik yük paylaşımı toplam gücü aşmaz ve hedef SOC hatası', () => {
  const alloc = E.sarj.shareLoad([22, 22, 7.4, 11], 40);
  near(alloc.reduce((a, b) => a + b, 0), 40, 1e-9);
  assert.ok(alloc.every((a, i) => a <= [22, 22, 7.4, 11][i] + 1e-9));
  near(alloc[2], 7.4, 1e-9, 'küçük talep tam karşılanır');
  const bad = E.sarj.compute({ profile: 'AC11', capacity: 60, soc0: 80, soc1: 50, obcPhases: 3, obcI: 16, dcMax: 50, nPoints: 1, siteKW: 22 });
  assert.equal(bad.ok, false);
});

test('RES: nominal altında güç hızın küpüyle değişir, nominalde sınırlanır, cut-out üstü sıfır', () => {
  const t = { A: Math.PI * 75 * 75, Prated: 4200, cp: 0.45, etaMech: 0.97, etaGen: 0.96, cutIn: 3, cutOut: 25, rho: 1.225 };
  const p5 = E.res.power(5, t).P, p6 = E.res.power(6, t).P;
  near(p6 / p5, Math.pow(6 / 5, 3), 1e-9);
  assert.equal(E.res.power(14, t).P, 4200);
  assert.equal(E.res.power(2.5, t).P, 0);
  assert.equal(E.res.power(25, t).P, 0);
  assert.equal(E.res.power(26, t).region, 'stop');
  near(E.res.airDensity(15, 0), 1.225, 0.001, 'ISA deniz seviyesi');
  near(E.res.gamma(1.5), Math.sqrt(Math.PI) / 2, 1e-10);
});

test('RES: Betz sınırı ve compute çıktıları', () => {
  const bad = E.res.compute({ D: 150, hub: 105, Prated: 4200, cp: 0.65, etaMech: 0.97, etaGen: 0.96, cutIn: 3, cutOut: 25, T: 15, alt: 0, v10: 7, alpha: 0.14, n: 1, rpmMax: 10, vMean: 7 });
  assert.equal(bad.ok, false);
  const r = E.res.compute({ D: 150, hub: 105, Prated: 4200, cp: 0.45, etaMech: 0.97, etaGen: 0.96, cutIn: 3, cutOut: 25, T: 15, alt: 0, v10: 6, alpha: 0.14, n: 5, rpmMax: 10, vMean: 7.5 });
  assert.equal(r.errors.length, 0);
  near(r.values.vHub, 6 * Math.pow(10.5, 0.14), 1e-9);
  assert.ok(r.values.cf > 0.2 && r.values.cf < 0.6, 'kapasite faktörü makul');
  near(r.values.farmP, r.values.P * 5, 1e-9);
});

test('pano: bir devre kapatılınca yalnızca o devrenin katkısı çıkar', () => {
  const full = E.pano.compute(panoInput());
  const inp = panoInput(); inp.circuits[1].on = false;
  const off = E.pano.compute(inp);
  const priz = E.pano.circuitFlow(Object.assign({}, panoInput().circuits[1]), 400);
  near(full.values.P - off.values.P, priz.P, 1e-6, 'aktif güç farkı');
  near(full.values.Q - off.values.Q, priz.Q, 1e-6, 'reaktif güç farkı');
  near(off.values.phases.L1, full.values.phases.L1, 1e-9, 'L1 akımı değişmez');
  assert.ok(off.values.phases.L2 < full.values.phases.L2);
});

test('pano: dengeli 3F yükte faz akımı √3 bağıntısıyla aynı, nötr sıfır', () => {
  const r = E.pano.compute(panoInput({ circuits: [{ name: 'M', phase: '3F', P_kW: 30, cos: 0.85, eff: 1, motor: false, on: true, kind: 'MCCB', In: 63, S: 16, L: 10, method: 'C' }] }));
  const I = 30000 / (Math.sqrt(3) * 400 * 0.85);
  near(r.values.phases.L1, I, 1e-6); near(r.values.phases.L3, I, 1e-6); near(r.values.phases.N, 0, 1e-6);
  near(r.values.pf, 0.85, 1e-9);
});

test('pano: üç eşit 1F yük farklı fazlarda nötrü sıfırlar; motor durunca katkısı yok', () => {
  const c = ph => ({ name: ph, phase: ph, P_kW: 3, cos: 1, on: true, kind: 'MCB', curve: 'C', In: 20, S: 4, L: 10, method: 'B1' });
  const r = E.pano.compute(panoInput({ circuits: [c('L1'), c('L2'), c('L3')] }));
  near(r.values.phases.N, 0, 1e-6);
  const inp = panoInput(); inp.circuits[2].running = false;
  const stopped = E.pano.compute(inp);
  near(stopped.values.P, (2 + 2.5) * 1000, 1e-6);
});

test('pano: koordinasyon, gerilim düşümü ve kısa devre kontrolleri', () => {
  const r = E.pano.compute(panoInput());
  assert.equal(r.errors.length, 0);
  const coord = r.checks.find(c => c.id === 'coord1');
  assert.equal(coord.status, 'ok', '2,5 mm² B1 (Iz 24 A) + C16');
  const wrong = panoInput(); wrong.circuits[1].In = 32;
  assert.equal(E.pano.compute(wrong).checks.find(c => c.id === 'coord1').status, 'fail', '2,5 mm² için 32 A uygun değil');
  assert.ok(r.values.Ik3 > 10000 && r.values.Ik3 < 25000, 'Ik3 makul aralıkta: ' + r.values.Ik3);
  const vd = E.pano.voltageDrop({ phase: 'L1', L: 20, S: 2.5, cos: 1 }, 10, 400);
  near(vd.dU, 2 * 10 * 20 / (56 * 2.5), 1e-9);
});

test('koruma cihazı değerlendirmesi süre uydurmaz', () => {
  assert.equal(E.breakerAssessment({ kind: 'MCB', curve: 'C', In: 16 }, 16).trips, false);
  assert.equal(E.breakerAssessment({ kind: 'MCB', curve: 'C', In: 16 }, 20).trips, null);
  assert.equal(E.breakerAssessment({ kind: 'MCB', curve: 'C', In: 16 }, 24).state, 'thermal');
  assert.equal(E.breakerAssessment({ kind: 'MCB', curve: 'B', In: 16 }, 81).state, 'magnetic');
  assert.equal(E.rcdAssessment(30, 30).trips, true);
  assert.equal(E.rcdAssessment(30, 20).trips, null);
  assert.equal(E.rcdAssessment(30, 10).trips, false);
});

test('GES: güneş konumu, string gerilimi ve kırpma', () => {
  // İzmir, 21 Haziran öğle (güneş saati ~12) yükseklik ≈ 90 − 38,4 + 23,44 ≈ 75°
  const s = E.ges.sunPosition(38.42, 27.14, 172, 13.25, 3);
  near(s.elevation, 75, 1.2);
  const base = { lat: 38.42, lon: 27.14, tilt: 25, azimuth: 0, Pmod: 550, nMod: 24, perString: 12, stringsPerMppt: 1, Voc: 49.6, Vmp: 41.9, Isc: 14, betaVoc: -0.27, betaVmp: -0.35, gamma: -0.35, noct: 45,
    Pac: 12, vdcMax: 1100, mpptMin: 200, mpptMax: 1000, iscMppt: 20, invEff: 97.5, dcLoss: 3, cloud: 0, pitch: 0, roofArea: 0, month: 6, hour: 13, Ta: 30, Tmin: -10, Tmax: 40, price: 3, exportPrice: 2, capex: 400000, consumption: 30000, profile: 'tek' };
  const r = E.ges.compute(base);
  assert.equal(r.errors.length, 0, r.errors.join());
  near(r.values.kWp, 13.2, 1e-9); near(r.values.dcac, 1.1, 1e-9);
  near(r.values.string.vocCold, 12 * 49.6 * (1 + -0.0027 * -35), 1e-6, 'soğuk Voc');
  assert.equal(r.checks.find(c => c.id === 'voc').status, 'ok');
  const tooLong = E.ges.compute(Object.assign({}, base, { perString: 22, nMod: 44 }));
  assert.equal(tooLong.checks.find(c => c.id === 'voc').status, 'fail', '22 modül > 1100 V');
  assert.ok(r.values.now.Pac <= 12000 + 1e-6, 'AC kırpma');
  const clip = E.ges.compute(Object.assign({}, base, { Pac: 6 }));
  assert.ok(clip.values.now.clipped > 0);
  assert.ok(r.values.annual > 13.2 * 1200 && r.values.annual < 13.2 * 2400, 'yıllık özgül üretim açık gök senaryosunda makul: ' + r.values.specYield);
  assert.ok(r.values.self <= r.values.annual + 1e-6);
  const pv = E.ges.compute(Object.assign({}, base, { pvgisMonthly: Array(12).fill(100) }));
  near(pv.values.annual, 1200 * 13.2, 1e-6, 'PVGIS aylık girdisi');
});

test('GES: sıra arası gölge yüksek güneşte sıfır, alçak güneşte pozitif', () => {
  assert.equal(E.ges.rowShading(30, 2.28, 6, { elevation: 60, azimuth: 0 }, 0), 0);
  assert.ok(E.ges.rowShading(30, 2.28, 3, { elevation: 10, azimuth: 0 }, 0) > 0);
});

test('kompanzasyon: Qc = P·(tanφ1 − tanφ2) ve rezonans', () => {
  near(E.komp.requiredQc(100, 0.8, 0.95), 100 * (0.75 - Math.tan(Math.acos(0.95))), 1e-9);
  const r = E.komp.compute({ U_LL: 400, P_kW: 400, cos1: 0.78, cos2: 0.96, Sr_kVA: 630, uk: 6, detune: 0, steps: [25, 50, 50, 100, 100], harmonics: { 5: 25, 7: 10, 11: 6, 13: 4 } });
  assert.equal(r.errors.length, 0);
  assert.ok(r.values.QcNom <= r.values.Qneed * 1.02 + 1e-9);
  near(r.values.hPar, Math.sqrt(r.values.Xc / r.values.Xs), 1e-9);
  const det = E.komp.compute({ U_LL: 400, P_kW: 400, cos1: 0.78, cos2: 0.96, Sr_kVA: 630, uk: 6, detune: 7, steps: [25, 50, 50, 100, 100], harmonics: { 5: 25, 7: 10, 11: 6, 13: 4 } });
  near(det.values.hRes * 50, 189, 1, '%7 ayar → 189 Hz');
  assert.ok(det.values.THDv < r.values.THDv, 'ayarlı grup THDv düşürür');
});

test('topraklama: çubuk direnci ve TT koşulu', () => {
  // ρ = 100 Ω·m, L = 3 m, d = 20 mm: R = 100/(2π·3)·(ln(1200) − 1) ≈ 32,3 Ω
  near(E.topraklama.rod(100, 3, 0.02), 100 / (2 * Math.PI * 3) * (Math.log(1200) - 1), 1e-9);
  near(E.topraklama.rod(100, 3, 0.02), 32.3, 0.2);
  const two = E.topraklama.rodsInLine(100, 3, 0.02, 2, 6);
  assert.ok(two < 32.3 && two > 32.3 / 2, 'iki çubuk: yarıdan büyük (karşılıklı etki)');
  const r = E.topraklama.compute({ rho: 100, electrode: 'rod', L: 3, d: 0.02, n: 1, s: 6, Lstrip: 20, h: 0.8, w: 0.03, meshA: 100, meshD: 5, system: 'TT', IdN_mA: 300, UL: 50, IF: 0, tf: 0.5, rhoS: 3000, hs: 0.1 });
  assert.equal(r.checks.find(c => c.id === 'tt').status, 'ok', '32 Ω · 0,3 A = 9,7 V ≤ 50 V');
  near(r.values.RAmax, 50 / 0.3, 1e-9);
  const m = E.topraklama.compute({ rho: 100, electrode: 'mesh', L: 3, d: 0.02, n: 1, s: 6, Lstrip: 20, h: 0.5, w: 0.03, meshA: 400, meshD: 5, system: 'TN', IdN_mA: 300, UL: 50, IF: 1000, tf: 0.5, rhoS: 3000, hs: 0.1 });
  assert.ok(m.values.R > 1 && m.values.R < 5, 'ağ direnci makul: ' + m.values.R);
  assert.ok(m.values.Em > 0 && m.values.Es > 0);
});

test('motor: anma değerleri ve yol alma', () => {
  const r = E.motor.compute({ Pn: 11, Un: 400, eff: 0.91, cos: 0.85, nn: 1460, poles: 4, IstIn: 7, TkTn: 2.8, method: 'DOL', loadPct: 60, J: 0.2, Ir: 21, olClass: '10', loadType: 'quad' });
  assert.equal(r.errors.length, 0, r.errors.join());
  near(r.values.nom.In, 11000 / (Math.sqrt(3) * 400 * 0.91 * 0.85), 1e-9);
  near(r.values.nom.Tn, 9550 * 11 / 1460, 1e-9);
  assert.ok(r.values.sim.tStart > 0 && r.values.sim.tStart < 5, 'yol alma süresi: ' + r.values.sim.tStart);
  near(r.values.sim.Imax / r.values.nom.In, 7, 0.3, 'DOL kalkış akımı ≈ Ist');
  const yd = E.motor.compute({ Pn: 11, Un: 400, eff: 0.91, cos: 0.85, nn: 1460, poles: 4, IstIn: 7, TkTn: 2.8, method: 'YD', loadPct: 30, J: 0.2, Ir: 12, olClass: '10', loadType: 'quad', tYD: 4 });
  assert.ok(yd.values.sim.pts[0].I < r.values.sim.pts[0].I / 2.5, 'Y-Δ kalkış akımı ≈ 1/3');
  assert.equal(E.motor.compute({ Pn: 11, Un: 400, eff: 0.91, cos: 0.85, nn: 1600, poles: 4, IstIn: 7, TkTn: 2.8, method: 'DOL', loadPct: 60, J: 0.2, Ir: 21 }).ok, false, 'senkron üstü devir');
});

test('motor: moment eğrisi kalkışta Tst, devrilmede Tk, anma kaymasında Tn', () => {
  const m = { Pn: 11, Un: 400, eff: 0.91, cos: 0.85, nn: 1460, poles: 4, f: 50, IstIn: 7, TkTn: 2.8, TstTn: 2.2 };
  const nom = E.motor.nominal(m), T = E.motor.kloss(m, nom);
  near(T(1) / nom.Tn, 2.2, 1e-9, 'kalkış');
  near(T(nom.sn) / nom.Tn, 1, 0.02, 'anma');
  const sk = nom.sn * (2.8 + Math.sqrt(2.8 * 2.8 - 1));
  near(T(sk) / nom.Tn, 2.8, 1e-9, 'devrilme');
  const heavy = E.motor.compute({ Pn: 11, Un: 400, eff: 0.91, cos: 0.85, nn: 1460, poles: 4, IstIn: 7, TkTn: 2.8, method: 'DOL', loadPct: 100, J: 0.3, Ir: 21, loadType: 'const' });
  assert.ok(heavy.values.sim.tStart > 0, 'tam yük sabit momentte DOL kalkabilmeli');
});

test('PLC: Y-Δ kilitleme, acil durdurma mühürlemesi', () => {
  let s = { run: false, timer: 0, K1: false, K2: false, K3: false, estopLatched: false };
  const inp = { start: true, stop: true, estop: true, ol: true, reset: false, method: 'YD' };
  s = E.motor.plcScan(s, inp, 0.1, 3);
  assert.ok(s.K1 && s.K2 && !s.K3);
  for (let i = 0; i < 40; i++) { s = E.motor.plcScan(s, Object.assign({}, inp, { start: false }), 0.1, 3); assert.ok(!(s.K2 && s.K3)); }
  assert.ok(s.K1 && s.K3 && !s.K2, 'üçgene geçti ve mühürlü');
  s = E.motor.plcScan(s, Object.assign({}, inp, { start: false, estop: false }), 0.1, 3);
  assert.ok(!s.K1 && s.estopLatched);
  s = E.motor.plcScan(s, Object.assign({}, inp, { start: true }), 0.1, 3);
  assert.ok(!s.K1, 'reset olmadan başlamaz');
  s = E.motor.plcScan(s, Object.assign({}, inp, { start: false, reset: true }), 0.1, 3);
  s = E.motor.plcScan(s, Object.assign({}, inp, { start: true }), 0.1, 3);
  assert.ok(s.K1);
  assert.match(E.motor.overloadAssessment('10', 20, 7.2 * 20).text, /4–10 s/);
});

test('UPS/ATS: kilitleme hiçbir durumda ihlal edilmez, yedekleme süresi', () => {
  near(E.ups.runtime({ Vbat: 480, Ah: 100, dod: 1, kTemp: 1, kAge: 1, P: 24000, etaInv: 1 }), 120, 1e-9);
  const cfg = { tConfirm: 2, tGenReady: 10, tDead: 0.5, tReturn: 5, tCool: 5 };
  let s = { state: 'MAINS', t: 0, timer: 0, QM: true, QG: false, genRunning: false };
  const seq = [];
  for (let i = 0; i < 800; i++) {
    const mains = !(i >= 20 && i < 300) && !(i >= 420 && i < 440);
    s = E.ups.atsStep(s, { mains: mains }, 0.1, cfg);
    assert.ok(!(s.QM && s.QG));
    seq.push(s.state);
  }
  assert.ok(seq.includes('ON_GEN') && seq.includes('COOLDOWN'));
  assert.equal(s.state, 'MAINS');
  const r = E.ups.compute({ Pcrit: 40, pfCrit: 0.9, Pother: 60, pfOther: 0.85, upsKVA: 60, upsPF: 0.9, etaInv: 95, nBlocks: 40, Vblock: 12, Ah: 100, dod: 80, kTemp: 1, kAge: 0.9, genKVA: 200, tGap: 15, fuel: 0.25, tank: 500 });
  assert.equal(r.errors.length, 0);
  assert.equal(r.checks.find(c => c.id === 'bridge').status, 'ok');
});

test('yangın: EN 54-2 panel durumları ve duman yayılımı', () => {
  const d = [{ zone: 1, state: 'alarm' }, { zone: 1, state: 'normal' }];
  assert.equal(E.yangin.panelState(d, { coincidence: true }).mode, 'prealarm');
  assert.equal(E.yangin.panelState(d, { coincidence: false }).mode, 'fire');
  assert.equal(E.yangin.panelState(d, { coincidence: true, mcp: true }).mode, 'fire');
  let g = new Float32Array(25);
  for (let i = 0; i < 50; i++) g = E.yangin.smokeStep(g, 5, 5, [{ x: 2, y: 2, rate: 0.2 }], 0.5);
  assert.ok(g[12] > g[0] && g[0] > 0);
});

test('doğrulayıcı: sıfır, negatif ve sayı olmayan girişler', () => {
  const v = new E.Validator();
  assert.equal(v.num('abc', 'X'), 0);
  v.num(-1, 'Y', { positive: true });
  v.num(5, 'Z', { max: 3 });
  assert.equal(v.errors.length, 3);
  assert.equal(new E.Validator().num('2,5', 'K'), 2.5);
});
