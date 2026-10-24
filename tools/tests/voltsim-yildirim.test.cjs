'use strict';

// VoltSim yıldırımdan korunma hesapları (js/voltsim/calc/yildirim.js): IEC 62305-1/-3 tablo değerleri ve geometri.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const Y = require(path.join(root, 'js/voltsim/calc/yildirim.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' beklenen ' + b + ', bulunan ' + a);

test('LPL tabloları: r, göz, iniş aralığı, ki (IEC 62305-3 Tablo 2, 4, 10)', () => {
  assert.deepEqual(['I', 'II', 'III', 'IV'].map(k => Y.LPL[k].r), [20, 30, 45, 60]);
  assert.deepEqual(['I', 'II', 'III', 'IV'].map(k => Y.LPL[k].mesh), [5, 10, 15, 20]);
  assert.deepEqual(['I', 'II', 'III', 'IV'].map(k => Y.LPL[k].down), [10, 10, 15, 20]);
  assert.deepEqual(['I', 'II', 'III', 'IV'].map(k => Y.LPL[k].ki), [0.08, 0.06, 0.04, 0.04]);
  assert.deepEqual([Y.KM.air, Y.KM.solid], [1, 0.5]);
  // elektrogeometrik model: en küçük tepe akımından küre yarıçapı (tablo değerleriyle %6 içinde; standart yuvarlatır)
  ['I', 'II', 'III', 'IV'].forEach(k => near(Y.rFromI(Y.LPL[k].Imin), Y.LPL[k].r, Y.LPL[k].r * 0.06, 'LPL ' + k + ' (tablo yuvarlatılmış)'));
});

test('sarkma derinliği ve en büyük çubuk aralığı', () => {
  near(Y.penetration(30, 10), 30 - Math.sqrt(875), 1e-12);
  near(Y.penetration(30, 10), 0.42, 0.005);
  near(Y.maxSpacing(20, 2), 2 * Math.sqrt(76), 1e-12);
  near(Y.penetration(20, Y.maxSpacing(20, 2)), 2, 1e-9, 'd_maks’ta sarkma = çubuk yüksekliği');
  near(Y.sphereRadiusAtBase(45, 45), 45, 1e-12);
});

test('koruma açısı: eşit alan yaklaşımı Şekil 1 uç değerlerini verir ve sayısal integralle tutarlı', () => {
  near(Y.protectionAngle(2, 20), 70.7, 0.3, 'LPL I, 2 m');
  near(Y.protectionAngle(20, 20), 23.2, 0.2, 'LPL I, h = r');
  near(Y.protectionAngle(60, 60), 23.2, 0.2, 'LPL IV, h = r (ölçek bağımsız)');
  near(Y.protectionAngle(1, 30), Y.protectionAngle(2, 30), 1e-12, 'h ≤ 2 m sabit');
  assert.equal(Y.protectionAngle(25, 20), null, 'h > r uygulanmaz');
  // sayısal integral: korunan kesit alanı = ∫ (r − √(r² − u²)) du, u ∈ [0, x0]
  [[10, 30], [5, 45], [30, 60]].forEach(([h, r]) => {
    const x0 = Math.sqrt(h * (2 * r - h)); let A = 0; const N = 20000;
    for (let i = 0; i < N; i++) { const u = (i + 0.5) * x0 / N; A += (r - Math.sqrt(r * r - u * u)) * x0 / N; }
    near(Math.tan(Y.protectionAngle(h, r) * Math.PI / 180), 2 * A / (h * h), 1e-4, 'h ' + h + ', r ' + r);
  });
  // yükseklik arttıkça açı azalır, LPL gevşedikçe artar
  assert.ok(Y.protectionAngle(10, 45) < Y.protectionAngle(5, 45));
  assert.ok(Y.protectionAngle(10, 20) < Y.protectionAngle(10, 60));
});

test('ayırma mesafesi s = ki·(kc/km)·l, kc Tablo 12', () => {
  assert.deepEqual([Y.kc(1), Y.kc(2), Y.kc(3), Y.kc(12)], [1, 0.66, 0.44, 0.44]);
  near(Y.separation({ ki: 0.04, n: 4, km: 1, l: 10 }), 0.176, 1e-12);
  near(Y.separation({ ki: 0.08, n: 1, km: 0.5, l: 10 }), 1.6, 1e-12, 'LPL I, tek iniş, beton içinde');
});

test('iniş iletkeni sayısı, toplama alanı ve ND', () => {
  assert.equal(Y.downConductors(40, 20, 15), 8);
  assert.equal(Y.downConductors(5, 5, 20), 2, 'en az iki');
  near(Y.collectionArea(20, 10, 10), 200 + 1800 + 900 * Math.PI, 1e-9);
  near(Y.dangerousEvents(2, 1e4, 0.5), 0.01, 1e-12);
});

test('çatı maruziyeti: korumasız çatı tamamen açık; yeterli çubuk ızgarası kapatır; kısa çubuk açık bırakır', () => {
  const b = { L: 30, W: 20, H: 10 };
  assert.equal(Y.roofExposure(Object.assign({}, b), 30, 30, 20).pct, 100);
  const r = 30, d = 10, hOk = Y.penetration(r, d * Math.SQRT2) + 0.3;
  const good = Y.roofExposure(Object.assign({}, b, { rods: true, rodH: hOk, rodD: d, perimeter: true }), r, 30, 20);
  near(good.pct, 0, 1e-9, 'h > p(köşegen)');
  const bad = Y.roofExposure(Object.assign({}, b, { rods: true, rodH: 0.3, rodD: 15 }), r, 30, 20);
  assert.ok(bad.pct > 10, 'kısa çubuk: ' + bad.pct);
  // koruma açısı: koni yarıçapı h·tanα
  const a = Y.angleExposure(Object.assign({}, b, { rods: true, rodH: 3, rodD: 6 }), 45, 30, 20);
  near(a.R, 3 * Math.tan(Y.protectionAngle(3, 45) * Math.PI / 180), 1e-12);
  assert.ok(a.pct < 5, 'sık çubukta koni örtüşür: ' + a.pct);
});

test('tam hesap: ağ yöntemi göz kuralı ve kontroller', () => {
  const base = { lpl: 'III', L: 40, W: 20, H: 12, method: 'mesh', mesh: true, meshM: 15, perimeter: true, rods: false, rodH: 1, rodD: 10, nDown: 8, lSep: 12, dEq: 1, medium: 'air', NG: 2, Cd: 0.5, rho: 100 };
  const r = Y.compute(base);
  assert.ok(r.ok, (r.errors || []).join('; '));
  assert.equal(r.checks.find(c => c.id === 'mesh').status, 'ok');
  assert.equal(Y.compute(Object.assign({}, base, { lpl: 'II' })).checks.find(c => c.id === 'mesh').status, 'fail', 'LPL II: 10 m göz');
  assert.equal(r.checks.find(c => c.id === 'down').status, 'ok', '120 m / 15 m = 8');
  near(r.values.s, 0.04 * 0.44 * 12, 1e-12);
  assert.equal(Y.compute(Object.assign({}, base, { lpl: 'V' })).ok, false);
});
