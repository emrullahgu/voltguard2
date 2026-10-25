'use strict';
// Bağımsız referans değer testleri: beklenen değerler test edilen fonksiyonla ÜRETİLMEZ. Her sayı elle (hesap makinesi)
// ya da yayımlanmış tablo/örnekten yazılmıştır; yanında türetilişi yorum olarak durur. Fonksiyon kendisiyle doğrulanmaz.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../js/voltsim/engine.js');
const cfg = require('../../js/calculator-config.js');
const C = cfg.calc;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} beklenen ${b} ± ${tol}, bulunan ${a}`);

test('trafo anma akımı (dengeli üç faz): 1000 kVA / 400 V ≈ 1443 A, 630 kVA / 400 V ≈ 909 A', () => {
  // 1 000 000 / (1,7320508 × 400) = 1 000 000 / 692,8203 = 1443,38 A
  // 630 000 / 692,8203 = 909,33 A
  near(C.transformerCurrent(1000, 400, 3), 1443.38, 0.01, 'calculator-config 1000 kVA');
  near(C.transformerCurrent(630, 400, 3), 909.33, 0.01, 'calculator-config 630 kVA');
  near(E.currentFromS(1000e3, 400), 1443.38, 0.01, 'engine 1000 kVA');
  near(E.currentFromS(630e3, 400), 909.33, 0.01, 'engine 630 kVA');
  const t = E.trafo.compute({ Sr_kVA: 1000, U1_kV: 34.5, U2_V: 400, P0: 690, Pk: 7600, uk: 6, P_kW: 500, cos: 1, ambient: 25, SkQ_MVA: 0 });
  assert.ok(t.ok, t.errors.join());
  near(t.values.I2n, 1443.38, 0.01, 'trafo.compute I2n');
  // primer: 1 000 000 / (1,7320508 × 34 500) = 16,73 A
  near(t.values.I1n, 16.73, 0.01, 'trafo.compute I1n');
  // tek fazlı 230 V sargı: S/U (√3 yok) = 10 000 / 230 = 43,48 A
  near(C.transformerCurrent(10, 230, 1), 43.48, 0.01, 'tek faz');
});

test('trafo yük kaybı ve yalnız-trafo kısa devre akımı (elle)', () => {
  // K = 500 kW / 1 / 1000 kVA = 0,5 → Pkayıp = 690 + 7600 × 0,25 = 2590 W; η = 500 000 / 502 590 = %99,485
  const t = E.trafo.compute({ Sr_kVA: 1000, U1_kV: 34.5, U2_V: 400, P0: 690, Pk: 7600, uk: 6, P_kW: 500, cos: 1, ambient: 25, SkQ_MVA: 0 });
  near(t.values.losses, 2590, 1e-6, 'kayıp');
  near(t.values.eff, 99.485, 0.001, 'verim');
  // Ik ≈ In / uk = 1443,38 / 0,06 = 24 056 A (c = 1, sonsuz şebeke)
  near(t.values.IkT, 24056, 1, 'IkT');
  // c = 1,05: ZT = 0,06 × 400² / 1e6 = 9,6 mΩ → 1,05 × 400 / (1,7320508 × 0,0096) = 25 259 A
  near(t.values.Ik, 25259, 2, 'Ik c=1,05');
});

test('batarya: 60 kWh, %20 → %80 ideal depolanan enerji 36 kWh; kayıplar ayrıca', () => {
  // 60 × (0,80 − 0,20) = 36 kWh. AC 22 kW (3 × 230 V × 32 A = 22 080 W), η = 0,90 → şebeke 36 / 0,9 = 40 kWh,
  // süre = 40 / 22,08 = 1,8116 h = 108,70 dk
  const r = E.sarj.compute({ profile: 'AC22', capacity: 60, soc0: 20, soc1: 80, obcPhases: 3, obcI: 32, dcMax: 100, nPoints: 1, siteKW: 500, curve: 'constant', effAC: 90 });
  assert.ok(r.ok, r.errors.join());
  near(r.values.ideal, 36, 1e-9, 'ideal');
  near(r.values.Ebatt, 36, 1e-6, 'bataryaya giren');
  near(r.values.Egrid, 40, 1e-6, 'şebekeden');
  near(r.values.lossKWh, 4, 1e-6, 'kayıp ayrı');
  near(r.values.minutes, 108.70, 0.01, 'süre');
});

test('AC şarj gücü sınırları: faz sayısı × 230 V × akım, araç OBC ile sınırlı', () => {
  // 3 × 230 × 32 = 22 080 W (= √3 × 400 × 32 = 22 170 W ile %0,4 fark: 230 V ≠ 400/√3 = 230,94 V)
  near(E.sarj.acPower({ phases: 3, I: 32 }, { obcPhases: 3, obcI: 32 }).P, 22.08, 1e-9);
  // 1 × 230 × 32 = 7 360 W
  near(E.sarj.acPower({ phases: 1, I: 32 }, { obcPhases: 1, obcI: 32 }).P, 7.36, 1e-9);
  // 3 fazlı 22 kW istasyon, 1 fazlı 32 A OBC → 7,36 kW; 3 faz 16 A OBC → 11,04 kW
  near(E.sarj.acPower({ phases: 3, I: 32 }, { obcPhases: 1, obcI: 32 }).P, 7.36, 1e-9);
  near(E.sarj.acPower({ phases: 3, I: 32 }, { obcPhases: 3, obcI: 16 }).P, 11.04, 1e-9);
});

test('güç birimleri: 30 kW, cosφ 0,8, 400 V üç faz → 37,5 kVA, 22,5 kVAr, 54,13 A', () => {
  // S = 30/0,8 = 37,5; Q = 37,5 × 0,6 = 22,5; I = 37 500 / 692,82 = 54,13 A
  const pt = E.powerTriangle(30, 0.8);
  near(pt.S, 37.5, 1e-9); near(pt.Q, 22.5, 1e-9);
  near(E.threePhaseCurrent(30e3, 400, 0.8), 54.13, 0.01);
  near(C.loadCurrent(30, 400, 3, 0.8, 1), 54.13, 0.01);
  // tek faz 230 V: 30 000 / (230 × 0,8) = 163,04 A (U faz-nötr)
  near(E.singlePhaseCurrent(30e3, 230, 0.8), 163.04, 0.01);
  near(C.loadCurrent(30, 230, 1, 0.8, 1), 163.04, 0.01);
});

test('motor: mil (çıkış) gücü ≠ elektriksel giriş gücü; 15 kW, η 0,92, cosφ 0,86, 400 V → 27,36 A, 16,30 kW', () => {
  // I = 15 000 / (1,7320508 × 400 × 0,86 × 0,92) = 15 000 / 548,16 = 27,364 A; P_el = 15 / 0,92 = 16,304 kW
  near(C.loadCurrent(15, 400, 3, 0.86, 0.92), 27.364, 0.005);
  const r = E.motor.compute({ Pn: 15, Un: 400, eff: 0.92, cos: 0.86, nn: 1460, poles: 4, IstIn: 7, TkTn: 2.8, TstTn: 2.2, method: 'DOL', loadPct: 90, J: 0.6, Ir: 27.5, loadType: 'quad' });
  assert.ok(r.ok, r.errors.join());
  near(r.values.nom.In, 27.364, 0.005, 'engine In');
});

test('gerilim düşümü motoru: Tk/Tn × u² kırpılmadan; 1,8 × 0,85² = 1,3005 ve 1,8 × 0,7² = 0,882 < 1 → devrilme', () => {
  const base = { Pn: 15, Un: 400, eff: 0.92, cos: 0.86, nn: 1460, poles: 4, IstIn: 7, TkTn: 1.8, TstTn: 2.2, method: 'DOL', loadPct: 100, J: 0.6, Ir: 27.5 };
  const lo = E.motor.compute(Object.assign({ uFactor: 0.7 }, base));
  assert.ok(lo.ok);
  assert.equal(lo.checks.find(c => c.id === 'tk').status, 'fail');
  assert.equal(E.motor.compute(Object.assign({ uFactor: 1 }, base)).checks.find(c => c.id === 'tk'), undefined);
});

test('kompanzasyon: 100 kW, cosφ 0,70 → 0,95 için Qc ≈ 69,15 kVAr (tablo katsayısı 0,691)', () => {
  // tan(acos 0,70) = 1,020204; tan(acos 0,95) = 0,328684 → 100 × 0,691520 = 69,15 kVAr
  near(C.compensation(100, 0.7, 0.95).Qc, 69.152, 0.001);
  near(E.komp.requiredQc(100, 0.7, 0.95), 69.152, 0.001);
  // EPDK sınırı %20 → cosφ = 1/√(1 + 0,04) = 0,98058
  near(C.cosForRatio(20), 0.98058, 1e-5);
});

test('GES string: 18 × 49,9 V, βVoc −%0,27/°C, Tmin −7 °C → Voc,soğuk ≈ 975,8 V', () => {
  // 18 × 49,9 = 898,2 V; 1 + (−0,0027) × (−7 − 25) = 1,0864 → 975,8 V
  const sc = E.ges.stringCheck({ perString: 18, Voc: 49.9, Vmp: 41.6, Isc: 13.9, betaVoc: -0.27, betaVmp: -0.35, noct: 45, stringsPerMppt: 2 }, -7, 40);
  near(sc.vocCold, 975.8, 0.05);
  // sıcak hücre: 40 + 25/800 × 1000 = 71,25 °C; Vmp = 18 × 41,6 × (1 − 0,0035 × 46,25) = 748,8 × 0,838125 = 627,59 V
  near(sc.TcHot, 71.25, 1e-9);
  near(sc.vmpHot, 627.59, 0.01);
  // tasarım akımı 1,25 × 13,9 × 2 = 34,75 A
  near(sc.iscDesign, 34.75, 1e-9);
});

test('topraklama: tek çubuk ρ = 100 Ω·m, L = 3 m, d = 20 mm → 32,31 Ω (Dwight); TT 300 mA → RA ≤ 166,7 Ω', () => {
  // 100/(2π·3) = 5,30516; ln(8·3/0,02) = ln 1200 = 7,09008 → 5,30516 × 6,09008 = 32,309 Ω
  near(E.topraklama.rod(100, 3, 0.02), 32.309, 0.001);
  near(C.rodResistance(100, 3, 0.02), 32.309, 0.001);
  const r = E.topraklama.compute({ rho: 100, electrode: 'rod', L: 3, d: 0.02, n: 1, s: 6, Lstrip: 40, h: 0.8, w: 0.03, meshA: 400, meshD: 5, system: 'TT', IdN_mA: 300, UL: 50, IF: 0, tf: 0.5, rhoS: 3000, hs: 0.1 });
  near(r.values.RAmax, 166.67, 0.01);
  assert.equal(r.checks.find(c => c.id === 'tt').status, 'ok');
  // IEEE 80 izin verilen dokunma, yüzey yok, ρ = 100, t = 0,5 s: (1000 + 150) × 0,116 / 0,70711 = 188,65 V
  const t = E.topraklama.compute(Object.assign({}, { rho: 100, electrode: 'rod', L: 3, d: 0.02, n: 1, s: 6, Lstrip: 40, h: 0.8, w: 0.03, meshA: 400, meshD: 5, system: 'TT', IdN_mA: 300, UL: 50, IF: 0, tf: 0.5, rhoS: 100, hs: 0 }));
  near(t.values.Etouch, 188.65, 0.01);
});

test('jeneratör yüklenmesi kW sınırını da kullanır: 180 kVA / 171 kW yük, 200 kVA (160 kWe) set → %107', () => {
  // 171 / (200 × 0,8) = 1,06875 → %107 (kVA'ya göre yalnız %90 görünürdü)
  const r = E.ups.compute({ Pcrit: 0.95, pfCrit: 0.95, Pother: 170, pfOther: 0.95, upsKVA: 10, upsPF: 0.9, etaInv: 95, nBlocks: 20, Vblock: 12, Ah: 100, strings: 1, dod: 80, kTemp: 1, kAge: 1, genKVA: 200, tGap: 10, fuel: 0.27, tank: 400 });
  const g = r.checks.find(c => c.id === 'gen');
  assert.equal(g.status, 'fail');
  assert.match(g.detail, /%107/);
});

test('IEC 60909 AG örneği: 630 kVA, uk %4, 400 V, sonsuz şebeke → Ik3 ≈ 23,9 kA (c = 1,05)', () => {
  // ZT = 0,04 × 160 000 / 630 000 = 10,159 mΩ → 1,05 × 400 / (1,7320508 × 0,010159) = 23 870 A
  near(C.shortCircuit({ S_kVA: 630, uk: 4 }).Ik3, 23870, 3);
});
