'use strict';

// VoltSim pompa ve VFD hesapları (js/voltsim/calc/pompa.js): afinite yasaları, çalışma noktası ve enerji karşılaştırması.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const P = require(path.join(__dirname, '../../js/voltsim/calc/pompa.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' beklenen ' + b + ', bulunan ' + a);
const pump = P.pump({ H0: 40, Qr: 200, Hr: 30, etaMax: 0.8, Qbep: 200 });

test('hidrolik güç: 100 m³/h, 30 m, ρ 1000 → 8,175 kW', () => {
  near(P.power(100, 30, 1, 1, 1).Ph, 1000 * 9.81 * (100 / 3600) * 30 / 1000, 1e-12);
  near(P.power(100, 30, 1, 1, 1).Ph, 8.175, 0.001);
  near(P.power(100, 30, 0.75, 0.94, 0.97).Pel, 8.175 / (0.75 * 0.94 * 0.97), 0.001);
});

test('afinite yasaları: statik yük yokken çalışma noktası hızla Q ∝ n, H ∝ n², P ∝ n³', () => {
  const sy = P.system(0, 200, 30);
  const a = P.operating(pump, sy, 1), b = P.operating(pump, sy, 0.7);
  near(b.Q / a.Q, 0.7, 1e-9); near(b.H / a.H, 0.49, 1e-9);
  const pa = P.power(a.Q, a.H, P.etaAt(pump, a.Q, 1), 1, 1), pb = P.power(b.Q, b.H, P.etaAt(pump, b.Q, 0.7), 1, 1);
  near(pb.Pel / pa.Pel, 0.343, 1e-9, 'verim afinite ile korunur');
  near(P.etaAt(pump, 140, 0.7), 0.8, 1e-12, 'BEP hızla ölçeklenir');
  near(P.AFFINITY.P(0.8), 0.512, 1e-12);
});

test('çalışma noktası pompa ve sistem eğrisinin kesişimi; VFD hızı hedef debiyi verir', () => {
  const sy = P.system(10, 200, 30);
  const op = P.operating(pump, sy, 0.9);
  near(P.headAt(pump, op.Q, 0.9), P.hsys(sy, op.Q), 1e-9);
  const s = P.speedFor(pump, sy, 120);
  near(P.operating(pump, sy, s).Q, 120, 1e-9);
  assert.equal(P.operating(pump, sy, Math.sqrt(10 / 40) * 0.99).Q, 0, 'statik basmanın altındaki hızda debi yok');
});

test('kısma her kısmi debide VFD’den fazla güç çeker; yıllık tasarruf pozitif', () => {
  const sy = P.system(5, 200, 30), o = { etaM: 0.94, etaVfd: 0.97 };
  [0.4, 0.6, 0.8].forEach(f => { const c = P.compare(pump, sy, 200 * f, o); assert.ok(c.Pthrottle > c.Pvfd, 'debi %' + f * 100); assert.ok(c.Hvalve > 0); });
  const y = P.annual(pump, sy, 200, [[1, 1000], [0.7, 4000], [0.5, 2000]], o);
  assert.equal(y.hours, 7000);
  assert.ok(y.saving > 0);
  near(y.Ethrottle, y.rows.reduce((a, r) => a + r.Pthrottle * r.hours, 0), 1e-9);
});

test('tam hesap: kontroller ve geri ödeme', () => {
  const r = P.compute({ H0: 40, Qr: 200, Hr: 30, etaMax: 0.8, Qbep: 190, Hst: 5, Qd: 200, Hd: 30, etaM: 0.94, etaVfd: 0.97, flowPct: 70, tariff: 3, vfdCost: 150000, profile: [[100, 1000], [70, 4000], [50, 2000]] });
  assert.ok(r.ok, (r.errors || []).join('; '));
  near(r.values.savingTL, r.values.year.saving * 3, 1e-9);
  near(r.values.payback, 150000 / r.values.savingTL, 1e-9);
  assert.equal(P.compute({ H0: 20, Qr: 200, Hr: 30, etaMax: 0.8, Qbep: 190, Hst: 5, Qd: 200, Hd: 30, etaM: 0.94, etaVfd: 0.97, flowPct: 70, tariff: 3, vfdCost: 1, profile: [] }).ok, false);
});
