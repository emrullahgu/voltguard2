'use strict';

// Pano ek hesapları: standart zaman–akım bant sınır noktaları ve akım seçiciliği.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '../../js/voltsim/engine.js'));
const X = require(path.join(__dirname, '../../js/voltsim/calc/pano.js'));

test('MCB bandı TS EN 60898-1 sınır noktalarından kurulur', () => {
  const b = X.band({ kind: 'MCB', curve: 'C', In: 16 });
  assert.deepEqual(b.min[1], [1.13 * 16, 3600]);
  assert.deepEqual(b.max[1], [1.45 * 16, 3600]);
  assert.deepEqual(b.max[2], [2.55 * 16, 60]);
  assert.deepEqual(b.min[3], [80, 0.1]);
  assert.deepEqual(b.max[3], [160, 0.1]);
  assert.equal(X.band({ kind: 'MCB', curve: 'B', In: 40 }).max[2][1], 120, 'In > 32 A: 2,55·In’de 120 s');
});

test('gG sigorta kapıları ve değerlendirme', () => {
  const b = X.band({ kind: 'FUSE', In: 63 });
  assert.deepEqual(b.max[2], [320, 5]);
  assert.deepEqual(b.max[3], [820, 0.1]);
  assert.equal(E.fuseI2(63), 1.6 * 63);
  assert.equal(E.fuseAssessment(63, 900).state, 'magnetic');
  assert.equal(E.fuseAssessment(63, 400).state, 'thermal');
  assert.equal(E.fuseAssessment(63, 90).trips, null);
  assert.equal(E.fuseAssessment(63, 60).trips, false);
});

test('akım seçiciliği: ani açma bantları ve sınır', () => {
  const up = { kind: 'MCCB', In: 250, Ir: 250, Ii: 2500 };
  const down = { kind: 'MCB', curve: 'C', In: 16 };
  const lo = X.selectivity(up, down, 1500);
  assert.equal(lo.status, 'ok');
  assert.equal(lo.limit, 2000, 'Ii alt toleransı %80');
  assert.equal(X.selectivity(up, down, 5000).status, 'warn');
  assert.equal(X.selectivity({ kind: 'MCCB', In: 63, Ir: 63, Ii: 315 }, { kind: 'MCB', curve: 'D', In: 32 }, 500).status, 'fail', 'D32 bandı (320–640 A) üstün 252 A alt eşiğini aşar');
});

test('pano motoru: gG sigortalı devrede kesme süresi ve koordinasyon', () => {
  const r = E.pano.compute({ U_LL: 400, mainIn: 250, busbarIn: 400, mainIcu_kA: 36, SkQ_MVA: 500, trafo_kVA: 630, trafo_uk: 4, trafo_Pk: 4600, feedL: 20, feedS: 120, feedN: 1,
    circuits: [{ name: 'NH', phase: '3F', P_kW: 40, cos: 0.9, on: true, kind: 'FUSE', In: 100, S: 35, L: 60, method: 'E' }] });
  assert.equal(r.errors.length, 0);
  const c = r.values.circuits[0];
  assert.equal(c.tReq, 5);
  assert.equal(c.Ia, 580, 'In 100 A → Imax(5 s) 580 A');
  near(c.I2, 160);
  function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, a + ' ≠ ' + b); }
  const s = E.pano.compute({ U_LL: 400, mainIn: 250, mainIrF: 0.8, busbarIn: 400, mainIcu_kA: 36, SkQ_MVA: 500, trafo_kVA: 630, trafo_uk: 4, trafo_Pk: 4600, feedL: 20, feedS: 120, feedN: 1,
    circuits: [{ name: 'Şönt', phase: '3F', P_kW: 20, shunt: true, on: true, kind: 'MCCB', In: 40, S: 10, L: 3, method: 'C' }] });
  assert.ok(s.values.Q > 0, 'şönt reaktör endüktif');
  assert.equal(s.values.mainIr, 200);
});
