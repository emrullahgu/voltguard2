'use strict';

// VoltSim şarj ek hesapları: yük paylaşımı (öncelik, IEC 61851-1 6 A alt sınırı), profiller, tarife, hub simülasyonu.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '../../js/voltsim/engine.js'));
const X = require(path.join(__dirname, '../../js/voltsim/calc/sarj.js'));

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg || ''} beklenen ${e} ± ${tol}, bulunan ${a}`);
const car = o => Object.assign({ profile: 'AC11', stationP: 120, capacity: 60, soc0: 20, soc1: 80, obcPhases: 3, obcI: 16, dcMax: 150, eff: 0.9, priority: 1, active: true }, o);

test('IEC 61851-1 en küçük pilot akımı 6 A: 3 faz 4,14 kW, 1 faz 1,38 kW', () => {
  assert.equal(X.AC_MIN_A, 6);
  near(X.acMinKW(3), 4.14, 1e-9);
  near(X.acMinKW(1), 1.38, 1e-9);
});

test('eşit öncelikte su doldurma: 3 × 11 kW talep, 22 kW → 7,33 kW', () => {
  const r = X.allocate([1, 2, 3].map(() => ({ demand: 11, min: 4.14, priority: 1 })), 22);
  r.alloc.forEach(a => near(a, 22 / 3, 1e-9));
  assert.deepEqual(r.paused, [false, false, false]);
});

test('öncelik kademesi önce doyar: [11 (yüksek), 11, 11] / 22 kW → 11; 5,5; 5,5', () => {
  const r = X.allocate([{ demand: 11, min: 4.14, priority: 3 }, { demand: 11, min: 4.14, priority: 1 }, { demand: 11, min: 4.14, priority: 1 }], 22);
  near(r.alloc[0], 11, 1e-9); near(r.alloc[1], 5.5, 1e-9); near(r.alloc[2], 5.5, 1e-9);
});

test('6 A alt sınırı sığmazsa düşük öncelikli/son oturum duraklatılır', () => {
  const r = X.allocate([{ demand: 11, min: 4.14, priority: 1 }, { demand: 11, min: 4.14, priority: 1 }, { demand: 11, min: 4.14, priority: 1 }], 10);
  assert.deepEqual(r.paused, [false, false, true]);
  near(r.alloc[0], 5, 1e-9); near(r.alloc[1], 5, 1e-9); assert.equal(r.alloc[2], 0);
  // düşük öncelikli olan duraklar
  const q = X.allocate([{ demand: 11, min: 4.14, priority: 1 }, { demand: 11, min: 4.14, priority: 2 }, { demand: 11, min: 4.14, priority: 2 }], 10);
  assert.deepEqual(q.paused, [true, false, false]);
});

test('talebi küçük olan fazlayı bırakır; DC alt sınırı yok', () => {
  const r = X.allocate([{ demand: 3, min: 0, priority: 1 }, { demand: 50, min: 0, priority: 1 }], 30);
  near(r.alloc[0], 3, 1e-9); near(r.alloc[1], 27, 1e-9); near(r.unused, 0, 1e-9);
});

test('baz yük profili ve üç zamanlı tarife dilimleri', () => {
  near(X.baseLoadAt('office', 10, 40), 40, 1e-9);
  near(X.baseLoadAt('office', 7.5, 100), 65, 1e-9);
  near(X.baseLoadAt('none', 12, 100), 0, 1e-9);
  assert.equal(X.touPeriod(9), 'day'); assert.equal(X.touPeriod(18), 'peak'); assert.equal(X.touPeriod(23), 'night'); assert.equal(X.touPeriod(3), 'night');
  near(X.priceAt(23, { mode: 'tou', day: 3, peak: 5, night: 1.5 }), 1.5, 1e-9);
  near(X.priceAt(23, { mode: 'single', single: 4 }), 4, 1e-9);
});

test('GES profili gece sıfır, öğlen pozitif ve kWp ile orantılı', () => {
  assert.equal(X.pvAt(100, 2, 172), 0);
  const p = X.pvAt(100, 12.5, 172);
  assert.ok(p > 60 && p < 100, 'öğlen ' + p);
  near(X.pvAt(200, 12.5, 172), 2 * p, 1e-9);
});

test('tek nokta hub simülasyonu motorun sarj sonucuyla aynı (60 kWh %20→%80, AC 11 kW)', () => {
  const ref = E.sarj.compute({ profile: 'AC11', capacity: 60, soc0: 20, soc1: 80, obcPhases: 3, obcI: 16, dcMax: 150, effAC: 90, nPoints: 1, siteKW: 500, curve: 'typical' }).values;
  const h = X.simulateHub({ points: [car()], siteKW: 500, dlm: true, startHour: 8, curve: 'typical' });
  near(h.points[0].finishMin, ref.minutes, 1e-6, 'süre');
  near(h.points[0].Egrid, ref.Egrid, 1e-6, 'şebeke enerjisi');
  near(h.points[0].Ebatt, 36, 1e-6, 'ideal 36 kWh');
});

test('DC tipik eğri: hub sonucu motorla aynı', () => {
  const ref = E.sarj.compute({ profile: 'DC120', stationP: 120, capacity: 77, soc0: 10, soc1: 80, obcPhases: 3, obcI: 16, dcMax: 150, effDC: 94, nPoints: 1, siteKW: 1000, curve: 'typical' }).values;
  const h = X.simulateHub({ points: [car({ profile: 'DC120', capacity: 77, soc0: 10, eff: 0.94 })], siteKW: 1000, dlm: true, curve: 'typical' });
  near(h.points[0].finishMin, ref.minutes, 1e-6);
});

test('yük yönetimi kapalıyken tepe sınırı aşar; açıkken aşmaz', () => {
  const pts = [0, 1, 2, 3].map(() => car({ profile: 'AC22', obcI: 32 }));
  const off = X.simulateHub({ points: pts, siteKW: 50, dlm: false, startHour: 9, base: { profile: 'office', peakKW: 20 }, curve: 'typical' });
  const on = X.simulateHub({ points: pts, siteKW: 50, dlm: true, startHour: 9, base: { profile: 'office', peakKW: 20 }, curve: 'typical' });
  assert.ok(off.peak > 50, 'kapalı tepe ' + off.peak);
  assert.ok(on.peak <= 50 + 1e-6, 'açık tepe ' + on.peak);
  assert.ok(on.overMin === 0 && off.overMin > 0);
});

test('batarya tamponu tepe talebini bağlantı sınırında tutar ve süreyi kısaltır', () => {
  const pts = [0, 1].map(() => car({ profile: 'DC60', stationP: 60, eff: 0.94, capacity: 50, soc0: 20, soc1: 60 }));
  const no = X.simulateHub({ points: pts, siteKW: 60, dlm: true, curve: 'constant' });
  const yes = X.simulateHub({ points: pts, siteKW: 60, dlm: true, curve: 'constant', bat: { kWh: 100, kW: 60, soc0: 100 } });
  assert.ok(yes.lastFinish < no.lastFinish, yes.lastFinish + ' < ' + no.lastFinish);
  assert.ok(yes.peak <= 60 + 1e-6);
});

test('uyumsuz soket: oturum enerji almaz', () => {
  const h = X.simulateHub({ points: [car({ compatible: false })], siteKW: 50, dlm: true });
  assert.equal(h.points[0].Egrid, 0);
});

test('gece tarifesi maliyeti düşürür (aynı enerji)', () => {
  const tariff = { mode: 'tou', day: 3, peak: 5, night: 1.5 };
  const day = X.simulateHub({ points: [car()], siteKW: 50, dlm: true, startHour: 9, tariff: tariff });
  const night = X.simulateHub({ points: [car()], siteKW: 50, dlm: true, startHour: 23, tariff: tariff });
  near(day.chargeE, night.chargeE, 1e-6);
  near(night.cost, night.chargeE * 1.5, 1e-6);
  assert.ok(night.cost < day.cost);
});

test('besleme devresi: 22 kW AC, 6 mm² C yöntemi 30 m → Ib 32 A, Iz 41 A, ΔU ≈ %1,24', () => {
  const c = X.circuit({ profile: 'AC22', prot: 'MCB', In: 32, S: 6, L: 30, method: 'C', rcd: 'A-RDCDD' });
  near(c.Ib, 32, 1e-9); near(c.Iz, 41, 1e-9); assert.ok(c.coord && c.rcdOk);
  near(c.vd, Math.sqrt(3) * 32 * (30 / (56 * 6)) / 400 * 100, 1e-9);
  assert.equal(X.circuit({ profile: 'AC22', In: 32, S: 4, L: 30, method: 'B1', rcd: 'A' }).coord, false, '4 mm² B1: Iz 28 A < In 32 A');
  assert.equal(X.circuit({ profile: 'AC22', In: 32, S: 6, L: 30, method: 'C', rcd: 'A' }).rcdOk, false, 'Tip A tek başına yetmez');
  const dc = X.circuit({ profile: 'DC120', stationP: 120, eff: 0.94, In: 200, S: 95, L: 40, method: 'E', rcd: 'A' });
  near(dc.Ib, 120000 / 0.94 / (Math.sqrt(3) * 400 * 0.99), 1e-9);
});
