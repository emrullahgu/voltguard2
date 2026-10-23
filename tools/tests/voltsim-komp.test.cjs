'use strict';

// VoltSim kompanzasyon ek hesapları (js/voltsim/calc/komp.js): bilinen değerlerle doğrulama.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const E = require(path.join(root, 'js/voltsim/engine.js'));
const K = require(path.join(root, 'js/voltsim/calc/komp.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' beklenen ' + b + ', bulunan ' + a);
const total = (steps, on) => steps.reduce((a, q, i) => a + (on[i] ? q : 0), 0);

test('kademe seçimi: ≤ 12 kademede motorun seçimiyle aynı toplam', () => {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 40; t++) {
    const n = 1 + Math.floor(rnd() * 12), steps = Array.from({ length: n }, () => Math.round(rnd() * 80 + 2.5) / 2 * 2);
    const Q = rnd() * steps.reduce((a, b) => a + b, 0) * 1.1;
    near(total(steps, K.chooseSteps(steps, Q)), total(steps, E.komp.chooseSteps(steps, Q)), 1e-6, 'n=' + n);
  }
});

test('kademe seçimi: 16 kademede kaba kuvvet optimumu, 48 kademede sınır aşılmaz', () => {
  const steps = [5, 7.5, 10, 12.5, 15, 20, 25, 25, 30, 40, 50, 50, 60, 75, 80, 100];
  const Q = 333.3, lim = Q * 1.02;
  let best = 0;
  for (let m = 0; m < (1 << steps.length); m++) { let q = 0; for (let i = 0; i < steps.length; i++) if (m & (1 << i)) q += steps[i]; if (q <= lim && q > best) best = q; }
  near(total(steps, K.chooseSteps(steps, Q)), best, 1e-9);
  const big = Array.from({ length: 48 }, (_, i) => 10 + (i % 7) * 12.5);
  const on = K.chooseSteps(big, 1234);
  assert.equal(on.length, 48);
  assert.ok(total(big, on) <= 1234 * 1.02 + 1e-9 && total(big, on) > 1234 * 0.98, 'toplam ' + total(big, on));
  assert.deepEqual(K.chooseSteps([10, 20], 0), [false, false]);
});

test('sıralı program liste sırasıyla ekler', () => {
  assert.deepEqual(K.chooseSteps([50, 30, 20, 10], 65, { program: 'linear' }), [true, false, false, true]);
});

test('röle: akım trafosu yük çıkışında tüm kademeler; kapasitif tesiste şönt reaktör', () => {
  const steps = [10, 20, 40];
  assert.deepEqual(K.controller({ steps, Ql: 50, Qneed: 30, Qcap: 0, ctPos: 'load' }).capOn, [true, true, true]);
  const c = K.controller({ steps, shunt: [10, 20, 20], Ql: 5, Qneed: 3, Qcap: 40 });
  near(c.shuntQ, 30, 1e-9, 'şönt (35 kVAr kapasitif fazlası, %10 tolerans içinde en büyük)');
  near(c.capQ, 0, 1e-9);
});

test('kademe sağlığı, gerilim yükselmesi, C/k', () => {
  assert.deepEqual(K.effectiveSteps([10, 20, 40], [0, 25, 0], [false, false, true]), [10, 15, 0]);
  near(K.trafoSk(1000, 6), 16666.67, 0.01);
  near(K.voltageRise(300, K.trafoSk(1000, 6)), 1.8, 1e-9, 'ΔU = 300/16667');
  near(K.cOverK(10, 400, 100, 5), 10000 / (Math.sqrt(3) * 400) / 20, 1e-12);
});

test('ayarlı filtre boyutlandırma: 50 kVAr, p = %7, 400 V', () => {
  const f = K.detunedFilter({ U_LL: 400, Q_kvar: 50, p: 0.07 });
  near(f.Xc, 400 * 400 / (50000 * 0.93), 1e-9);
  near(f.L_mH, 0.7667, 1e-3);
  near(f.C_uF, 925.1, 0.2);
  near(f.Uc, 430.1, 0.1);
  near(f.fr, 189.0, 0.1);
  near(f.I1, 72.17, 0.01);
  assert.equal(f.UcN, 480, '430 V × 1,05 → 480 V anma');
  assert.equal(K.detunedFilter({ U_LL: 400, Q_kvar: 50, p: 0 }), null);
});

test('aktif harmonik filtre: oransal bastırma', () => {
  const r = K.ahfReduce({ 5: 30, 7: 40 }, 100, 25); // Ih = 50 A
  near(r.Ih, 50, 1e-9); near(r.k, 0.5, 1e-12); near(r.harmonics[5], 15, 1e-12); near(r.harmonics[7], 20, 1e-12);
  near(K.ahfReduce({ 5: 30 }, 100, 1000).k, 1, 0);
});

test('günlük enerji ve EPDK oranları', () => {
  const d = K.dailyEnergy([{ P: 100, Q: 30 }, { P: 100, Q: -10 }, { P: 0, Q: -20 }]);
  assert.equal(d.kWh, 200); assert.equal(d.kvarhInd, 30); assert.equal(d.kvarhCap, 30);
  near(d.indPct, 15, 1e-12); near(d.capPct, 15, 1e-12);
  assert.deepEqual(K.epdkLimits(40), { ind: 33, cap: 20 });
  assert.deepEqual(K.epdkLimits(400), { ind: 20, cap: 15 });
  // kompanzasyonsuz sabit yük: oran = tanφ
  const base = { U_LL: 400, P_kW: 100, cos1: 0.8, cos2: 0.95, Qcap_kvar: 0, Sr_kVA: 400, uk: 6, detune: 0, steps: [], harmonics: {}, installed_kVA: 400 };
  const day = K.simulateDay(base, Array(24).fill(1));
  near(day.indPct, 75, 1e-6); assert.equal(day.indOk, false);
  // gece kapasitif yükü: şönt reaktör kapasitif oranı düşürür
  const night = Object.assign({}, base, { P_kW: 150, cos1: 0.72, cos2: 0.99, Qcap_kvar: 60, steps: [10, 20, 40, 60, 60, 80] });
  const a = K.simulateDay(night, K.PROFILES.v1.f), b = K.simulateDay(night, K.PROFILES.v1.f, { shunt: [20, 20, 20] });
  assert.equal(a.capOk, false); assert.equal(b.capOk && b.indOk, true);
});
