'use strict';

// VoltSim depolama ek hesapları: tarife dönemleri, yük profilleri, GES/RES yeniden kullanımı, batarya verimi ve güç sınırı,
// saatlik dağıtım stratejileri, enerji dengesi, çevrim ve maliyet.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.resolve(__dirname, '../../js/voltsim/engine.js'));
const X = require(path.resolve(__dirname, '../../js/voltsim/calc/depolama.js'));

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol), (msg || '') + ' ' + a + ' ≠ ' + b);
const flat = (v, n) => new Array(n || 24).fill(v);
const base = o => Object.assign({ load: flat(100), pv: flat(0), wind: flat(0), bat: { cap: 0, pcs: 0, dod: 1, rte: 1, crate: 1 }, soc0: 0, cyclic: false,
  strategy: 'self', demandKW: 1e9, reserve: 0, gridCharge: false, gridKW: 1e6, exportKW: 1e6, gen: { on: false }, outage: { on: false }, island: true,
  prices: { gunduz: 3, puant: 5, gece: 2, export: 1, fuel: 40 } }, o);

test('tarife dönemleri: gece 22–06, gündüz 06–17, puant 17–22', () => {
  assert.deepEqual([0, 5, 6, 16, 17, 21, 22, 23].map(X.period), ['gece', 'gece', 'gunduz', 'gunduz', 'puant', 'puant', 'gece', 'gece']);
});

test('yük profili: taban + (tepe − taban)·şekil, özel profil ayrıştırma', () => {
  const p = X.loadProfile('tek', 600, 100);
  assert.equal(p.length, 24);
  assert.equal(p[9], 600); assert.equal(p[3], 100); near(p[12], 100 + 500 * 0.7);
  assert.deepEqual(X.parseProfile('1;2 3;4,5 ' + flat(0, 20).join(' ')).slice(0, 4), [1, 2, 3, 4.5]);
  assert.throws(() => X.parseProfile('1 2 3'), /24 saatlik/);
  assert.throws(() => X.loadProfile('ozel', 0, 0, [1, 2]), /24/);
});

test('GES: engine.ges yeniden kullanılır; saatlik toplam motorun günlük üretimine eşit', () => {
  const o = { kWp: 500, acKW: 420, lat: 37.87, lon: 32.48, month: 6, tilt: 20, azimuth: 0, cloud: 0.1, Ta: 25 };
  const inp = X.gesInput(o);
  near(inp.nMod * inp.Pmod, 500000, 1e-6, 'kurulu güç birebir');
  const r = X.pvHourly(o), ref = E.ges.compute(inp);
  assert.ok(ref.ok);
  near(r.kWh.reduce((a, b) => a + b, 0), ref.values.today.Eac, 1e-6, 'günlük enerji');
  assert.equal(r.kWh[2], 0); assert.equal(r.kWh[23], 0);
  assert.ok(Math.max.apply(null, r.kWh) <= 420 + 1e-9, 'inverter AC sınırı');
  assert.ok(r.kWh[12] > r.kWh[8], 'öğlen > sabah');
  assert.deepEqual(X.pvHourly(Object.assign({}, o, { kWp: 0 })).kWh, flat(0));
});

test('RES: engine.res.power ile; 11,5 m/s’de nominal, devreye girme altında sıfır', () => {
  const t = X.turbine(100);
  near(E.res.power(11.5, t).P, 100, 1e-9);
  assert.equal(E.res.power(2.9, t).P, 0);
  assert.equal(E.res.power(25, t).P, 0);
  near(t.D, Math.sqrt(4 * t.A / Math.PI));
  const w = X.windHourly({ kW: 100, vMean: 6 });
  near(w.v[14], 6 * (1 + 0.2 * Math.cos(2 * Math.PI * -0.5 / 24)), 1e-9, '14:00–15:00 tepe');
  assert.ok(w.v[14] > w.v[2], 'öğleden sonra > gece');
  assert.ok(w.kWh.every(x => x >= 0 && x <= 100));
});

test('dizel yakıt eğrisi ve batarya güç sınırı', () => {
  near(X.fuelRate(100, 50), 0.08145 * 100 + 0.246 * 50);
  assert.equal(X.fuelRate(100, 0), 0);
  const b = X.battery({ cap: 1000, pcs: 600, dod: 0.9, rte: 0.81, crate: 0.5 });
  assert.equal(b.Pmax, 500); near(b.Emin, 100); near(b.etaC, 0.9); near(b.etaD, 0.9);
});

test('tepe tıraşlama: 100 kW yük, 60 kW sınır, 200 kWh batarya 5 saat taşır (referans)', () => {
  const s = X.simulate(base({ bat: { cap: 200, pcs: 100, dod: 1, rte: 1, crate: 1 }, soc0: 1, strategy: 'peak', demandKW: 60 }));
  for (let h = 0; h < 5; h++) { near(s.rows[h].dis, 40); near(s.rows[h].imp, 60); }
  near(s.rows[4].E, 0); assert.equal(s.rows[5].dis, 0); near(s.rows[5].imp, 100);
  near(s.imp, 60 * 5 + 100 * 19); near(s.dis, 200); near(s.peakImp, 100);
  near(s.cycles, 1); assert.equal(s.overLimitHours, 19);
});

test('çevrim verimi: %81 RTE → 100 kWh şarj, 81 kWh deşarj', () => {
  const load = flat(0); load[1] = 200; const pv = flat(0); pv[0] = 100;
  const s = X.simulate(base({ load: load, pv: pv, exportKW: 0, bat: { cap: 1000, pcs: 1000, dod: 1, rte: 0.81, crate: 1 } }));
  near(s.rows[0].ch, 100); near(s.rows[0].E, 90); near(s.rows[0].exp, 0);
  near(s.rows[1].dis, 81); near(s.rows[1].imp, 119); near(s.rows[1].E, 0, 1e-9);
  near(s.lossBat, 19);
});

test('C-oranı: P_max = min(PCS, C·E) deşarjı sınırlar', () => {
  const s = X.simulate(base({ bat: { cap: 1000, pcs: 500, dod: 1, rte: 1, crate: 0.25 }, soc0: 1, strategy: 'peak', demandKW: 0, load: flat(400) }));
  near(s.rows[0].dis, 250); near(s.rows[0].imp, 150);
});

function balance(s, label) {
  const b = s.bat;
  s.rows.forEach(r => {
    near(r.load, r.use + r.dis + (r.gen - r.chGen - r.dump) + (r.imp - r.chGrid) + r.uns, 1e-6, label + ' yük dengesi h' + r.h);
    near(r.pv + r.wind, r.use + (r.ch - r.chGrid - r.chGen) + r.exp + r.curt, 1e-6, label + ' üretim dengesi h' + r.h);
    assert.ok(r.E >= b.Emin - 1e-6 && r.E <= b.Emax + 1e-6, label + ' SOC sınırı h' + r.h);
    assert.ok(r.ch <= b.Pmax + 1e-6 && r.dis <= b.Pmax + 1e-6, label + ' güç sınırı h' + r.h);
    assert.ok(!(r.ch > 1e-9 && r.dis > 1e-9), label + ' aynı saatte şarj ve deşarj yok h' + r.h);
    assert.ok(r.imp >= -1e-9 && r.exp >= -1e-9 && r.uns >= -1e-9 && r.curt >= -1e-9);
  });
}

test('enerji dengesi ve sınırlar: dört strateji, kesinti, jeneratör', () => {
  const load = X.loadProfile('iki', 600, 150), pv = X.pvHourly({ kWp: 1000, acKW: 800, lat: 37.87, lon: 32.48, month: 6, tilt: 20, azimuth: 0, cloud: 0.15, Ta: 24 }).kWh;
  const bat = { cap: 1000, pcs: 500, dod: 0.9, rte: 0.9, crate: 0.5 };
  for (const st of ['self', 'peak', 'backup', 'tou']) for (const out of [false, true]) for (const gen of [false, true]) {
    const s = X.simulate(base({ load: load, pv: pv, bat: bat, cyclic: true, soc0: 0.5, strategy: st, demandKW: 450, reserve: 0.6, gridCharge: true, exportKW: 200,
      gen: { on: gen, kW: 300, minPct: 0.3, peak: true }, outage: { on: out, start: 18, dur: 4 } }));
    balance(s, st + (out ? '+kesinti' : '') + (gen ? '+jen' : ''));
    near(s.lossBat, s.ch - s.dis - (s.Eend - s.E0), 1e-9);
  }
});

test('döngüsel gün: başlangıç SOC gün sonu SOC’ye yakınsar', () => {
  const load = X.loadProfile('iki', 600, 150), pv = X.pvHourly({ kWp: 1000, acKW: 800, lat: 37.87, lon: 32.48, month: 6, tilt: 20, azimuth: 0, cloud: 0.15, Ta: 24 }).kWh;
  const s = X.simulate(base({ load: load, pv: pv, bat: { cap: 1000, pcs: 500, dod: 0.9, rte: 0.9, crate: 0.5 }, cyclic: true, soc0: 0.1, exportKW: 300 }));
  near(s.Eend, s.E0, 1000 * 0.002 + 1e-6);
  assert.ok(s.cycles > 0.3 && s.cycles < 1.2, 'yaz gününde ≈ bir çevrim: ' + s.cycles);
});

test('yedek rezerv: şebeke varken rezerv korunur, kesintide kullanılır; ada çalışması yoksa GES de durur', () => {
  const load = flat(150), cap = 1000;
  const o = base({ load: load, bat: { cap: cap, pcs: 500, dod: 0.9, rte: 0.9, crate: 0.5 }, soc0: 0.8, cyclic: true, strategy: 'backup', reserve: 0.8, outage: { on: true, start: 18, dur: 4 } });
  const s = X.simulate(o);
  s.rows.forEach(r => { if (r.h < 18) assert.ok(r.E >= cap * 0.8 - 1e-6, 'rezerv h' + r.h); });
  assert.ok(s.rows[22].chGrid > 0, 'kesinti sonrası rezerv şebekeden yeniden doldurulur');
  assert.equal(s.uns, 0, 'kesinti 600 kWh; rezerv (800 − 100)·√0,9 ≈ 664 kWh AC');
  near(s.rows[18].dis, 150);
  // ada çalışması kapalı: batarya ve GES devre dışı, yük beslenemez
  const pv = flat(50);
  const s2 = X.simulate(Object.assign({}, o, { island: false, pv: pv }));
  near(s2.uns, 4 * 150); near(s2.rows[19].lost, 50); assert.equal(s2.rows[19].dis, 0);
});

test('jeneratör: kesintide önce jeneratör, en düşük yükte fazlası bataryaya', () => {
  const load = flat(20);
  const s = X.simulate(base({ load: load, bat: { cap: 100, pcs: 100, dod: 1, rte: 1, crate: 1 }, soc0: 0, outage: { on: true, start: 0, dur: 24 }, gen: { on: true, kW: 100, minPct: 0.3 } }));
  near(s.rows[0].gen, 30); near(s.rows[0].chGen, 10); near(s.rows[0].E, 10); near(s.rows[0].fuel, X.fuelRate(100, 30));
  near(s.uns, 0);
  // batarya dolunca fazlası atık direnç yüküne
  const last = s.rows[23]; near(last.E, 100); assert.ok(last.dump > 0);
});

test('zaman tarifesi: gece şebekeden şarj, yalnız puantta deşarj; maliyet düşer', () => {
  const load = flat(400);
  const o = base({ load: load, bat: { cap: 1000, pcs: 500, dod: 0.9, rte: 0.9, crate: 0.5 }, soc0: 0.5, cyclic: true, strategy: 'tou', gridKW: 1000 });
  const s = X.simulate(o), c = X.compare(o);
  s.rows.forEach(r => { if (r.dis > 1e-9) assert.equal(r.period, 'puant'); if (r.chGrid > 1e-9) assert.equal(r.period, 'gece'); });
  assert.ok(c.savingBat > 0, 'puant 5 > gece 2/0,9');
  // beklenen tasarruf: deşarj × puant − şebekeden şarj × gece
  near(c.savingBat, s.dis * 5 - s.chGrid * 2, 1e-6);
});

test('maliyet, öz yeterlilik ve basit ömür', () => {
  const load = flat(100); const pv = flat(0); for (let h = 8; h < 16; h++) pv[h] = 150;
  const o = base({ load: load, pv: pv, exportKW: 1000, prices: { gunduz: 3, puant: 5, gece: 2, export: 1, fuel: 0, demand: 300 } });
  const s = X.simulate(o);
  near(s.imp, 100 * 16); near(s.exp, 50 * 8);
  near(s.importCost, 100 * (8 * 2 + 3 * 3 + 5 * 5)); // gündüz 6–8 ve 16–17 = 3 saat, puant 5, gece 8
  near(s.demandCost, 100 * 300 / 30);
  near(s.cost, s.importCost - 400 + 1000);
  near(s.selfSuff, 1 - 1600 / 2400); near(s.selfCons, 800 / 1200);
  const L1 = X.lifeYears(6000, 15, 1), L2 = X.lifeYears(6000, 15, 2);
  assert.equal(L1.years, 15); assert.equal(L1.limitedBy, 'calendar');
  near(L2.years, 6000 / 730); assert.equal(L2.limitedBy, 'cycle');
  assert.equal(X.lifeYears(6000, 15, 0).years, 15);
});
