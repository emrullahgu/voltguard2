'use strict';
// VoltSim trafo ek hesapları: manevra kilitlemeleri, kademe/gerilim, kompanzasyon, kayıp enerjisi, soğutma, koruma kontrolleri.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '../../js/voltsim/engine.js'));
const C = require(path.join(__dirname, '../../js/voltsim/calc/trafo.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≈ ' + b);

test('manevra: başlangıç enerjili, güvenli değil', () => {
  const sw = C.initialSw();
  assert.deepEqual(C.energized(sw, 'cb'), { mv: true, lv: true });
  assert.equal(C.isSafe(sw, 'cb'), false);
});

test('manevra: kilitlemeler yanlış sırayı reddeder', () => {
  const sw = C.initialSw();
  assert.equal(C.can(sw, 'esClose', 'cb').ok, false, 'kesici kapalıyken topraklama kapanmaz');
  assert.equal(C.can(sw, 'dsOpen', 'cb').ok, false, 'ayırıcı yük altında açılmaz');
  assert.equal(C.can(sw, 'doorOpen', 'cb').ok, false, 'topraklanmadan kapak açılmaz');
  let s = C.apply(sw, 'cbOpen', 'cb'); assert.ok(s.ok); assert.ok(s.warn, 'AG kapalıyken OG açmak uyarı verir');
  s = C.apply(s.sw, 'dsOpen', 'cb'); assert.ok(s.ok);
  assert.equal(C.can(s.sw, 'esClose', 'cb').ok, false, 'AG geri besleme riski: AG kapalıyken topraklama yok');
  assert.equal(C.apply(s.sw, 'esClose', 'cb').sw.es, false, 'reddedilen işlem durumu değiştirmez');
});

test('manevra: güvenli enerjisiz bırakma ve ters sırayla enerjileme', () => {
  for (const kind of ['cb', 'fuse']) {
    let sw = C.initialSw();
    for (const op of C.isolationSequence(kind)) { const r = C.apply(sw, op, kind); assert.ok(r.ok, kind + ' ' + op + ': ' + r.reason); sw = r.sw; }
    assert.equal(C.isSafe(sw, kind), true, kind + ' güvenli');
    assert.equal(C.energized(sw, kind).mv, false);
    assert.equal(C.can(sw, 'cbClose', kind).ok, false, 'topraklıyken kapama yok');
    assert.equal(C.can(sw, 'esOpen', kind).ok, false, 'kapak açıkken topraklama açılmaz');
    for (const op of C.reenergizeSequence(kind)) { const r = C.apply(sw, op, kind); assert.ok(r.ok, kind + ' ' + op + ': ' + r.reason); sw = r.sw; }
    assert.deepEqual(C.energized(sw, kind), { mv: true, lv: true });
  }
  assert.equal(C.can(C.initialSw(), 'dsOpen', 'fuse').ok, false, 'sigortalı hücrede ayrı ayırıcı yok');
});

test('kademe: AG gerilimi', () => {
  near(C.lvVoltage({ U2n: 400, uNetPct: 100, tapPct: 0, regPct: 0 }).U0, 400, 1e-9);
  near(C.lvVoltage({ U2n: 400, uNetPct: 100, tapPct: -5, regPct: 0 }).U0, 421.0526, 1e-3, '−%5 OG sarım → AG yükselir');
  near(C.lvVoltage({ U2n: 400, uNetPct: 100, tapPct: -5, regPct: 2 }).Uload, 412.6316, 1e-3);
  near(C.lvVoltage({ U2n: 400, uNetPct: 96, tapPct: 2.5, regPct: 0 }).U0, 374.6341, 1e-3);
});

test('kompanzasyon', () => {
  const r = C.pfCorrection(100, 0.8, 75);
  near(r.Q0, 75, 1e-9); near(r.Q1, 0, 1e-9); near(r.cos1, 1, 1e-12);
  assert.equal(C.pfCorrection(100, 0.8, 100).capacitive, true);
  near(C.capNeeded(100, 0.8, 0.95), 75 - 100 * Math.tan(Math.acos(0.95)), 1e-9);
});

test('günlük kayıp: sabit yükte P0 + Pk·K²', () => {
  const d = C.dailyLosses({ Sr_kVA: 630, cos: 0.95, Ppeak_kW: 630 * 0.95 * 0.5, profile: 'sabit', P0: 540, Pk: 4600, price: 4 });
  near(d.Eday, (540 + 4600 * 0.25) * 24 / 1000, 1e-9);
  near(d.Eyear, d.Eday * 365, 1e-9); near(d.costYear, d.Eyear * 4, 1e-9);
  const r = E.trafo.compute({ Sr_kVA: 630, U1_kV: 34.5, U2_V: 400, P0: 540, Pk: 4600, uk: 4, P_kW: 630 * 0.95 * 0.5, cos: 0.95, ambient: 20, SkQ_MVA: 500 });
  near(d.hours[5].loss, r.values.losses, 1e-6, 'motorla aynı kayıp');
  assert.equal(C.dailyLosses({ Sr_kVA: 630, cos: 1, Ppeak_kW: 0, profile: 'sabit', P0: 540, Pk: 4600, energized: false }).Eday, 0);
});

test('soğutma: ONAF ve kuru tip', () => {
  const th = E.trafo.THERMAL_ONAN;
  assert.deepEqual(C.onafTemps(0.9, 30, th, 1), E.trafo.steadyTemps(0.9, 30, th));
  assert.ok(C.onafTemps(1.2, 30, th, 1.25).hotSpot < E.trafo.steadyTemps(1.2, 30, th).hotSpot);
  near(C.onafTemps(1.25, 30, th, 1.25).hotSpot, E.trafo.steadyTemps(1, 30, th).hotSpot, 1e-9);
  assert.equal(C.fanControl(false, 64, 65, 55), false); assert.equal(C.fanControl(false, 65, 65, 55), true);
  assert.equal(C.fanControl(true, 60, 65, 55), true); assert.equal(C.fanControl(true, 55, 65, 55), false);
  near(C.dryTemps(1, 40, 'F').hotSpot, 150, 1e-9); assert.equal(C.dryTemps(1, 40, 'F').limit, 155);
  near(C.dryTemps(0.5, 20, 'H').hotSpot, 20 + 137.5 * Math.pow(0.5, 1.6), 1e-9);
});

test('koruma ön kontrolleri', () => {
  const rc = C.relayCheck({ I1n: 10.54, IkLV: 22700, U2: 400, U1: 34500, Ip: 13, Ihs: 400, Ie: 2 });
  near(rc.IkLVrefl, 263.19, 0.01); assert.equal(rc.ipOk, true); assert.equal(rc.ihsOk, true);
  assert.equal(C.relayCheck({ I1n: 10.54, IkLV: 22700, U2: 400, U1: 34500, Ip: 13, Ihs: 100, Ie: 2 }).ihsOk, false);
  assert.equal(C.fuseSuggest(10.54), 25); assert.equal(C.fuseSuggest(16.73), 40);
  const a = C.acbCheck({ In: 1000, Ir: 0.9, I2: 684, I2n: 909, Icu_kA: 50, Ik: 23100 });
  assert.deepEqual([a.loadOk, a.trafoOk, a.icuOk], [true, true, true]);
  assert.equal(C.acbCheck({ In: 1600, Ir: 1, I2: 684, I2n: 909, Icu_kA: 20, Ik: 23100 }).icuOk, false);
});

test('paralel çalışma: yük paylaşımı uk ile ters orantılı', () => {
  const p = C.parallelCheck({ Sr: 630, uk: 4, vg: 'Dyn11' }, { Sr: 630, uk: 6, vg: 'Dyn11', ratioDiff: 0 }, 1000);
  near(p.Sa, 600, 1e-9); near(p.Sb, 400, 1e-9); assert.equal(p.ukOk, false); assert.equal(p.vgOk, true);
  assert.equal(C.parallelCheck({ Sr: 630, uk: 4, vg: 'Dyn11' }, { Sr: 2500, uk: 6, vg: 'Yyn0' }, 1000).vgOk, false);
});
