'use strict';

// VoltSim RES ek hesapları: Weibull, föyden Cp, momentum Ct, Jensen izi, park/elektrik kayıpları, histerezis, sentetik seri.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '../../js/voltsim/engine.js'));
const X = require(path.join(__dirname, '../../js/voltsim/calc/res.js'));

const near = (a, e, tol, msg) => assert.ok(Math.abs(a - e) <= tol, `${msg || ''} beklenen ${e} ± ${tol}, bulunan ${a}`);
const DS = { Prated: 3600, D: 120, hub: 100, cutIn: 3, vRated: 11.5, cutOut: 25, etaMech: 0.96, etaGen: 0.95, trafoKVA: 4000 };

test('Weibull yoğunluğu: integral 1, ortalama c·Γ(1+1/k)', () => {
  const c = X.weibullC(7.5, 2);
  let s = 0, m = 0;
  for (let v = 0.005; v < 60; v += 0.01) { const f = X.weibullPdf(v, c, 2); s += f * 0.01; m += v * f * 0.01; }
  near(s, 1, 1e-3); near(m, 7.5, 1e-2);
  near(X.weibullMean(c, 2), 7.5, 1e-9);
  near(X.weibullPdf(5, 6, 1), Math.exp(-5 / 6) / 6, 1e-12, 'k = 1 üstel');
});

test('föyden Cp: nominal hızda motor gücü tam nominal (ρ0 = 1,225)', () => {
  const t = X.turbine(DS, 1.225);
  assert.ok(t.cp > 0.3 && t.cp < E.res.BETZ, 'cp ' + t.cp);
  near(E.res.power(11.5, t).P, 3600, 1e-6);
  assert.equal(E.res.power(11.4, t).region, 'partial');
});

test('momentum kuramı: Cp = 16/27 → a = 1/3, Ct = 8/9; Cp = 0 → Ct = 0', () => {
  near(X.aFromCp(16 / 27), 1 / 3, 1e-12);
  near(X.ctFromCp(16 / 27), 8 / 9, 1e-12);
  assert.equal(X.ctFromCp(0), 0);
  const a = X.aFromCp(0.45); near(4 * a * (1 - a) ** 2, 0.45, 1e-9);
});

test('Jensen açığı: Ct 0,8, x = 7D, k 0,075 → 0,13154', () => {
  near(X.jensenDeficit(0.8, 7 * 120, 120, 0.075), (1 - Math.sqrt(0.2)) / Math.pow(2.05, 2), 1e-12);
  near(X.jensenDeficit(0.8, 7 * 120, 120, 0.075), 0.13154, 1e-5);
});

test('daire örtüşmesi: ayrık 0, iç içe küçük alan, eş merkez', () => {
  assert.equal(X.circleOverlap(1, 1, 3), 0);
  near(X.circleOverlap(1, 3, 0.5), Math.PI, 1e-12);
  near(X.circleOverlap(1, 1, 1), 2 * Math.PI / 3 - Math.sqrt(3) / 2, 1e-9);
});

test('sıradaki iz: rüzgâr dizi boyunca → arka türbin yavaşlar; dik rüzgârda iz yok', () => {
  const t = X.turbine(DS, 1.225);
  const lay = [0, 1, 2].map(j => ({ x: -j * 5 * 120, y: 0, t: t }));   // batıya uzanan dizi
  const along = X.farmSpeeds(lay, 9, 90, 0.075);                         // doğudan esen rüzgâr
  near(along[0], 9, 1e-12, 'öndeki serbest');
  const ct = X.ctAt(t, 9);
  near(along[1], 9 * (1 - X.jensenDeficit(ct, 600, 120, 0.075)), 1e-9, 'ikinci türbin tam örtüşme');
  assert.ok(along[2] < along[1], 'üçüncü daha yavaş (kare toplam)');
  const cross = X.farmSpeeds(lay, 9, 0, 0.075);
  cross.forEach(v => near(v, 9, 1e-12));
});

test('park: geniş aralık iz kaybını azaltır; elektrik kayıpları pozitif; şebeke sınırı uygulanır', () => {
  const base = { types: [DS], strings: [{ type: 0, n: 6 }], rowDir: 270, spacing: 3, rowGap: 8, rho: 1.225, dirDeg: 90, wakeOn: true, k: 0.075, U_kV: 34.5, pf: 0.95, S: 240, homeKm: 3, trafo: { p0: 0.1, pk: 1 }, ss: { Sn_kVA: 30000, p0: 0.05, pk: 0.5 }, curtail_kW: 0, vHubOf: () => 9 };
  const near3 = X.farmState(base), far = X.farmState(Object.assign({}, base, { spacing: 9 }));
  assert.ok(near3.wakeLoss > far.wakeLoss && far.wakeLoss > 0);
  assert.ok(near3.lossCable > 0 && near3.lossTrafo > 0 && near3.lossSS > 0);
  const cur = X.farmState(Object.assign({}, base, { curtail_kW: 5000 }));
  near(cur.poi, 5000, 1e-9); assert.ok(cur.curtailed > 0);
});

test('kablo kaybı: 10 MW, 34,5 kV, cosφ 1, 240 mm² Al, 1 km → 3·I²·R', () => {
  const I = 10000 / (Math.sqrt(3) * 34.5), Rc = 1000 / (35 * 240);
  near(X.cableLossKW(10000, 34.5, 1, 240, 1), 3 * I * I * Rc / 1000, 1e-9);
  near(X.trafoLoss(4000, 4000, 0.1, 1), 44, 1e-9);
});

test('AEP: iz kapalıyken kayıp 0, açıkken pozitif; yön sayısı büyük parkta azalır', () => {
  const inp = { types: [DS], strings: [{ type: 0, n: 4 }], rowDir: 270, spacing: 4, rowGap: 8, rho: 1.225, wakeOn: false, k: 0.075, U_kV: 34.5, pf: 0.95, S: 240, homeKm: 3, trafo: { p0: 0.1, pk: 1 }, ss: { Sn_kVA: 20000, p0: 0.05, pk: 0.5 }, curtail_kW: 0, meanOf: () => 7.5, kW: 2, avail: 0.97 };
  const a = X.farmAEP(inp), b = X.farmAEP(Object.assign({}, inp, { wakeOn: true }));
  near(a.wakeLoss, 0, 1e-12); assert.ok(b.wakeLoss > 0.01 && b.wakeLoss < 0.2, 'iz ' + b.wakeLoss);
  assert.ok(b.net < a.net && a.net > 0);
});

test('IEC 61400-12-1 yoğunluk düzeltmesi motor güç bağıntısıyla tutarlı (kısmi yük)', () => {
  const t0 = X.turbine(DS, 1.225), t1 = X.turbine(DS, 1.1);
  const v = 8;
  near(E.res.power(v, t1).P, E.res.power(X.densityCorrect(v, 1.1), t0).P, 1e-9);
});

test('yaw kaybı ve açı farkı', () => {
  near(X.yawFactor(60, 2), 0.25, 1e-12); near(X.yawFactor(60, 3), 0.125, 1e-12); assert.equal(X.yawFactor(95), 0);
  assert.equal(X.angleDiff(350, 10), -20); assert.equal(X.angleDiff(10, 350), 20);
});

test('cut-out histerezisi: 25 m/s’de durur, 22 m/s altında 120 s sonra kalkar', () => {
  const o = { cutOut: 25, restart: 22, delay: 120 };
  let st = { stopped: false, below: 0 };
  st = X.cutOutStep(st, 25.2, o, 5); assert.ok(st.stopped && st.tripped);
  st = X.cutOutStep(st, 23, o, 5); assert.ok(st.stopped, '22–25 arası duruşta kalır');
  for (let i = 0; i < 23; i++) st = X.cutOutStep(st, 21, o, 5);
  assert.ok(st.stopped, '115 s henüz yetmez');
  st = X.cutOutStep(st, 21, o, 5); assert.ok(!st.stopped, '120 s sonra kalkar');
});

test('sentetik seri: aynı tohum aynı seri; ortalama ve TI hedefe yakın', () => {
  const a = X.windSeries({ seed: 7, mean: 12, ti: 0.14, minutes: 600, dt: 5 }), b = X.windSeries({ seed: 7, mean: 12, ti: 0.14, minutes: 600, dt: 5 });
  assert.deepEqual(a, b);
  const m = a.reduce((x, y) => x + y, 0) / a.length, sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
  near(m, 12, 1.2, 'ortalama'); near(sd / 12, 0.14, 0.05, 'TI');
  assert.notDeepEqual(X.windSeries({ seed: 8, mean: 12, ti: 0.14 }), X.windSeries({ seed: 7, mean: 12, ti: 0.14 }));
});

test('seri işletmesi: düşük yeniden kalkış eşiği durma sayısını azaltır', () => {
  const t = X.turbine(DS, 1.225), v = X.windSeries({ seed: 3, mean: 22, ti: 0.16, minutes: 60, dt: 5 });
  const tight = X.simulateSeries({ v: v, dt: 5, t: t, cutOut: 25, restart: 24.5, delay: 0 });
  const loose = X.simulateSeries({ v: v, dt: 5, t: t, cutOut: 25, restart: 22, delay: 120 });
  assert.ok(tight.stops >= loose.stops && tight.stops > 1, tight.stops + ' / ' + loose.stops);
  assert.ok(tight.energy > 0);
});

test('iklim koruması örnek ayarları', () => {
  assert.ok(X.climateStop(-25, -20, false).stop);
  assert.ok(!X.climateStop(-10, -20, false).stop);
  assert.ok(X.climateStop(0, -20, true).stop);
});
