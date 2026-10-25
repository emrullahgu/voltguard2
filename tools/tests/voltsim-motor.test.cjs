'use strict';

// VoltSim motor ek hesapları (js/voltsim/calc/motor.js): bilinen değer testleri.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require(path.join(__dirname, '../../js/voltsim/calc/motor.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' beklenen ' + b + ', bulunan ' + a);

test('termik temsili gecikme: sınıf sınırı ve I²t ölçek', () => {
  assert.equal(C.olDelay('10', 7.2), 10);
  assert.equal(C.olDelay('20', 8), 20);
  near(C.olDelay('10', 7.0), 10 * Math.pow(7.2 / 7, 2), 1e-9);
  assert.equal(C.olDelay('10', 1.3), 30, 'üst sınır 30 s');
  assert.equal(C.olDelay('10', 1.1), Infinity, '1,2·Ir altında açma yok');
});

test('serbest duruş adımı', () => {
  // J = 1 kg·m², 10 N·m, 1 s → Δω = 10 rad/s = 95,49 d/dk
  near(C.coastStep(1500, 1, 1, 10, 0), 1500 - 10 * 60 / (2 * Math.PI), 1e-9);
  assert.equal(C.coastStep(50, 1, 1, 100, 0), 0);
  assert.equal(C.coastStep(0, 1, 1, 10), 0);
});

test('faz kaybı ve kilitli rotor', () => {
  const r = C.singlePhasing({ running: true, I: 20 });
  near(r.I, 34.641, 1e-3); assert.equal(r.canStart, true);
  const s = C.singlePhasing({ running: false, Ist: 200 });
  near(s.I, 173.205, 1e-3); assert.equal(s.canStart, false);
  assert.deepEqual([C.lockedRotor(190).I, C.lockedRotor(190).rpm], [190, 0]);
});

test('gerilim düşümü: moment U², kalkış akımı U, çalışma akımı 1/U', () => {
  const v = C.voltageEffect(0.9, { TkTn: 2.8, TstTn: 2.2, IstIn: 7 });
  near(v.torqueFactor, 0.81, 1e-12); near(v.TkTn, 2.268, 1e-9); near(v.TstTn, 1.782, 1e-9); near(v.IstIn, 6.3, 1e-9);
  near(v.runCurrentFactor, 1 / 0.9, 1e-12);
  // kırpma yok: 1,8 × 0,85² = 1,3005 (elle); 1,8 × 0,7² = 0,882 < 1 → devrilme
  near(C.voltageEffect(0.85, { TkTn: 1.8, TstTn: 2, IstIn: 7 }).TkTn, 1.3005, 1e-9);
  assert.equal(C.voltageEffect(0.7, { TkTn: 1.8, TstTn: 2, IstIn: 7 }).stall, true);
});

test('VFD afinite: karesel yükte P ∝ n³', () => {
  const o = C.vfdOperating(0.8, true, 25, 27);
  near(o.powerFactor, 0.512, 1e-12); near(o.torqueFactor, 0.64, 1e-12); near(o.f, 40, 1e-12);
  const I0 = 0.35 * 27, Iq = Math.sqrt(25 * 25 - I0 * I0) * 0.64;
  near(o.I, Math.sqrt(I0 * I0 + Iq * Iq), 1e-9);
  near(C.vfdOperating(0.5, false, 20, 20).powerFactor, 0.5, 1e-12);
});

test('enerji karşılaştırması: %70 debide kısma ve VFD', () => {
  const r = C.energyCompare({ P100: 10, q: 0.7, etaMotor: 0.9, etaVfd: 0.97, hours: 6000, price: 3 });
  near(r.Pthrottle, 10 * 0.835 / 0.9, 1e-9);           // 9,278 kW
  near(r.Pvfd, 10 * 0.343 / (0.9 * 0.97), 1e-9);       // 3,929 kW
  near(r.savingPct, (r.Pthrottle - r.Pvfd) / r.Pthrottle * 100, 1e-9);
  near(r.savingPct, 57.65, 0.01);
  near(r.cost, (r.Ethrottle - r.Evfd) * 3, 1e-6);
  const c = C.energyCurves({ P100: 10, hours: 1 }, 10); assert.equal(c.vfd.length, 11); near(c.vfd[10][0], 100, 1e-9);
});

test('Y-Δ kullanıcı programı: kilitleme kapalıyken çakışma yakalanır', () => {
  assert.deepEqual(C.ydRequest(3.99, 4, true), { K2: true, K3: false });
  assert.deepEqual(C.ydRequest(4.02, 4, true), { K2: false, K3: false });
  assert.deepEqual(C.ydRequest(4.06, 4, true), { K2: false, K3: true });
  const bad = C.ydRequest(4.02, 4, false);
  assert.deepEqual(bad, { K2: true, K3: true });
  assert.throws(() => C.guardOutputs(bad), /Kilitleme/);
  assert.equal(C.guardOutputs(C.ydRequest(4.02, 4, true)), true);
});
