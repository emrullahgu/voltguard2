'use strict';

// VoltSim enerji kalitesi hesapları (js/voltsim/calc/kalite.js): kompanzasyon motoruyla tutarlılık, el hesabı ve bilinen değerler.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const E = require(path.join(root, 'js/voltsim/engine.js'));
const Q = require(path.join(root, 'js/voltsim/calc/kalite.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' beklenen ' + b + ', bulunan ' + a);

const base = { U_LL: 400, Sr_kVA: 1000, uk: 6, SkQ_MVA: 0, Qc_kvar: 300, p: 0 };

test('harmonik ağ: reaktörsüz bankada kompanzasyon motoruyla (E.komp) aynı Vh, THDv ve şebeke THDi', () => {
  const spec = { 5: 30, 7: 12, 11: 7, 13: 5 };
  const net = Q.network(base);
  const I1 = 400e3 / (Math.sqrt(3) * 400 * 0.85);
  const hm = Q.harmonics(net, I1, spec, Math.acos(0.85));
  const k = E.komp.compute({ U_LL: 400, P_kW: 400, cos1: 0.85, cos2: 0.95, Sr_kVA: 1000, uk: 6, detune: 0, steps: [300], manual: [true], harmonics: spec });
  near(hm.THDv, k.values.THDv, 1e-9, 'THDv');
  hm.rows.forEach((r, i) => near(r.Vh, k.values.spectrum[i].Vh, 1e-9, r.h + '. Vh'));
  hm.rows.forEach((r, i) => near(r.Isupply, k.values.spectrum[i].Isupply, 1e-9, r.h + '. şebeke akımı'));
  near(net.hPar, k.values.hPar, 1e-12, 'paralel rezonans');
});

test('rezonans mertebesi h_r = √(Ssc/Qc) ve ayarlı kol (p = %7 → 189 Hz)', () => {
  const net = Q.network(base);
  // ders kitabı: Ssc ≈ Sr/uk = 16 667 kVA → h_r ≈ √(16667/300) = 7,45 (Rs = Xs/8 ile %0,4 düşük)
  near(net.hr, Math.sqrt(16666.7 / 300), 0.04);
  near(net.Ssc, 1000 / 0.06 / Math.sqrt(1 + 1 / 64), 0.5);
  const det = Q.network(Object.assign({}, base, { p: 0.07 }));
  near(det.hSer * 50, 189.0, 0.1, 'seri ayar frekansı');
  assert.ok(det.hPar < det.hSer, 'kaynak ∥ kol rezonansı seri ayarın altında');
  near(det.XL / det.Xc, 0.07, 1e-12);
  // OG şebeke empedansı Xs’e eklenir: rezonans düşer
  const mv = Q.network(Object.assign({}, base, { SkQ_MVA: 250 }));
  assert.ok(mv.Xs > net.Xs && mv.hr < net.hr);
  near(mv.XQ, 1.1 * 400 * 400 / 250e6, 1e-12);
});

test('sıfır bileşen (3.) harmonik: kondansatöre girmez, nötr akımı 3·I3', () => {
  const net = Q.network(base);
  const hm = Q.harmonics(net, 100, { 3: 50, 5: 20 }, 0);
  const r3 = hm.rows.find(r => r.h === 3);
  assert.equal(r3.Icap, 0); assert.equal(r3.zero, true);
  near(r3.Isupply, 50, 1e-9);
  near(hm.Ineutral, 150, 1e-9, 'IN = 3 × 50 A');
  near(r3.Vh, 50 * Math.hypot(net.XT / 8, 3 * net.XT), 1e-9, 'V3 = I3·|Z0(3)|, Z0 ≈ ZT');
  near(hm.THDiLoad, Math.hypot(50, 20), 1e-9);
});

test('dalga şekli: doğrusal yükte tepe faktörü √2, rms örneklerden', () => {
  const net = Q.network(Object.assign({}, base, { Qc_kvar: 0 }));
  const hm = Q.harmonics(net, 100, {}, 0.3);
  const wf = Q.waveform(net, 100, 0.3, hm, 720, 1);
  near(wf.vCF, Math.SQRT2, 1e-4); near(wf.iCF, Math.SQRT2, 1e-4);
  const hm2 = Q.harmonics(net, 100, { 5: 30, 7: 15 }, 0);
  const wf2 = Q.waveform(net, 100, 0, hm2, 1440, 1);
  const rms = Math.sqrt(wf2.i.slice(0, -1).reduce((a, p) => a + p[1] * p[1], 0) / 1440);
  near(rms, hm2.Irms, 0.05, 'örnek rms = √(I1² + ΣIh²)');
});

test('gerilim çökmesi: gerilim bölücü ve EN 50160 sınıflandırması', () => {
  const s = Q.sagDivider({ U_kV: 34.5, Sk_MVA: 500, xr: 10, r_ohm_km: 0.2, x_ohm_km: 0.4, L_km: 5 });
  const Zs = 34.5e3 * 34.5e3 / 500e6, ZS = E.C.polar(Zs, Math.atan(10)), ZF = E.C.of(1, 2);
  near(s.u, E.C.abs(ZF) / E.C.abs(E.C.add(ZS, ZF)) * 100, 1e-9);
  assert.ok(s.u > 40 && s.u < 60, 'kalan gerilim ≈ %50: ' + s.u);
  assert.deepEqual([Q.classify(75, 150).row, Q.classify(75, 150).col], [1, 0]);
  assert.deepEqual([Q.classify(30, 700).row, Q.classify(30, 700).col], [3, 2]);
  assert.equal(Q.classify(3, 100).type, 'interruption');
  assert.equal(Q.classify(115, 100).type, 'swell');
  assert.equal(Q.classify(95, 100).type, 'normal');
  assert.equal(Q.insideF47(55, 150), true); assert.equal(Q.insideF47(55, 300), false); assert.equal(Q.insideF47(75, 450), true); assert.equal(Q.insideF47(85, 900), true);
  assert.equal(Q.contactorDrops(60, 80, 65, 15), true); assert.equal(Q.contactorDrops(70, 80, 65, 15), false); assert.equal(Q.contactorDrops(50, 10, 65, 15), false);
});

test('motor yol alma çökmesi: 75 kW, 6·In, Sk 16,5 MVA → ≈ %3,3', () => {
  const m = Q.motorStartDip({ U_LL: 400, P_kW: 75, eff: 0.94, cos: 0.86, kStart: 6, Sk_kVA: 16538 });
  near(m.In, 75000 / (Math.sqrt(3) * 400 * 0.94 * 0.86), 1e-9);
  near(m.Sst_kVA, Math.sqrt(3) * 400 * 6 * m.In / 1e3, 1e-9);
  near(m.dU, 3.25, 0.05);
});

test('gerilim dengesizliği: simetrik bileşenlerden üretilen gerilimlerde VUF = U2/U1', () => {
  near(Q.vuf(400, 400, 400), 0, 1e-9);
  [[400, 8, 0], [400, 4, 1.1], [400, 12, -2]].forEach(([u1, u2, a]) => { const l = Q.lineVoltagesFrom(u1, u2, a); near(Q.vuf(l[0], l[1], l[2]), u2 / u1 * 100, 1e-6, 'U2 ' + u2); });
  near(Q.lvur(410, 400, 390), 2.5, 1e-9);
  near(Q.motorI2(2, 6), 12, 1e-12);
});

test('tam hesap: kontroller ve hata yakalama', () => {
  const inp = { U_LL: 400, Sr_kVA: 1000, uk: 6, SkQ_MVA: 500, capOn: true, Qc_kvar: 300, p: 7, P_kW: 400, cos: 0.85, harm: { 3: 0, 5: 33, 7: 11, 11: 7.5, 13: 5 },
    mvU_kV: 34.5, mvSk_MVA: 500, line_r: 0.2, line_x: 0.4, faultKm: 5, sagMs: 120, event: 'og', swellPct: 115, motorKW: 75, kStart: 6, motorMs: 2000, dropPct: 65, dropMs: 15, Uab: 400, Ubc: 396, Uca: 404 };
  const r = Q.compute(inp);
  assert.ok(r.ok, (r.errors || []).join('; '));
  ['thdv', 'vh', 'res', 'cap', 'ev', 'f47', 'drop', 'vuf'].forEach(id => assert.ok(r.checks.some(c => c.id === id), id));
  assert.equal(r.checks.find(c => c.id === 'res').status, 'ok', '%7 ayarlı');
  const bad = Q.compute(Object.assign({}, inp, { uk: 40 }));
  assert.equal(bad.ok, false);
});
