'use strict';
// VoltSim GES ek hesapları: yerleşim, string/MPPT ataması, geometrik engel gölgesi, koruma kontrolleri, ihracat sınırı.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '../../js/voltsim/engine.js'));
const C = require(path.join(__dirname, '../../js/voltsim/calc/ges.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≈ ' + b);

test('kayıp birleştirme ve bifasiyal kazanç', () => {
  near(C.combineLoss(14, 0), 14, 1e-12);
  near(C.combineLoss(10, 10), 19, 1e-9);
  near(C.bifacialGain(0.7, 0.2), 0.049, 1e-12);
  near(C.bifacialGain(0.8, 0.6, 0.5), 0.24, 1e-12);
});

test('string planı: bitişik bloklar, giriş sayısı kontrolü', () => {
  const p = C.stringPlan({ nMod: 360, perString: 18, nInv: 2, nMppt: 4, inPerMppt: 2 });
  assert.equal(p.nStrings, 20); assert.equal(p.M, 8); assert.equal(p.spare, 0);
  assert.equal(p.perMppt.reduce((a, b) => a + b, 0), 20);
  assert.equal(p.maxPerMppt, 3); assert.equal(p.overInputs, true, '3 string > 2 giriş');
  assert.ok(p.strings.every((s, i, a) => i === 0 || s.mppt >= a[i - 1].mppt), 'MPPT sırası artan');
  assert.equal(p.strings[0].inv, 0); assert.equal(p.strings[19].inv, 1);
  const f = C.activeFleet(p, 18, [1], 80);
  assert.equal(f.offStrings, 10); assert.equal(f.offModules, 180); assert.equal(f.PacActive, 80);
});

test('MPPT çalışma noktası', () => {
  const r = C.mpptPoint({ perString: 18, Vmp: 41.6, betaVmp: -0.35, Pmod: 540, mpptMin: 200, mpptMax: 1000 }, 1000, 25, 2);
  near(r.V, 748.8, 1e-9); near(r.I, 2 * 540 / 41.6, 1e-9); assert.equal(r.inWindow, true);
});

test('yerleşim: düz çatı ve trapez', () => {
  const ly = C.arrayLayout({ nMod: 360, rows: 12, moduleLen: 2.28, tilt: 15, pitch: 3.6 });
  assert.equal(ly.perRow, 30); assert.equal(ly.xs.length, 360);
  near(ly.pitchV, 3.6, 1e-9); near(ly.arrD, 11 * 3.6 + 2.28 * Math.cos(15 * Math.PI / 180), 1e-6);
  const tr = C.arrayLayout({ nMod: 40, rows: 4, moduleLen: 2, tilt: 10, roof: 'trapez' });
  assert.ok(tr.ys[0] > tr.ys[39], 'kuzey sırası saçaktan yüksekte');
  near(C.roofY(tr, tr.arrD / 2), 0, 1e-12);
});

test('engel gölgesi: geometri', () => {
  const ly = C.arrayLayout({ nMod: 30, rows: 1, moduleLen: 2, tilt: 0, pitch: 0 });
  const o = { x: 0, z: 4, w: 2, d: 2, h: 3 };
  // güneş tam güneyden 45° yükseklikte: engel dizinin güneyinde, gölge kuzeye (−z) 3 m uzanır → modüllere ulaşır
  const s45 = C.sunLocal({ elevation: 45, azimuth: 0 }, 0);
  near(s45.y, Math.SQRT1_2, 1e-12); near(s45.z, Math.SQRT1_2, 1e-12); near(s45.x, 0, 1e-12);
  const r = C.obstacleShade(ly, o, s45);
  assert.ok(r.frac > 0 && r.frac < 0.2, 'kısmi gölge ' + r.frac);
  const mid = Array.from(ly.xs).findIndex(x => Math.abs(x) < 0.6);
  assert.ok(r.per[mid] > 0, 'engelin arkasındaki modül gölgede');
  assert.equal(r.per[0], 0, 'kenardaki modül güneşte');
  // güneş batıdan: gölge doğuya düşer, dizi (güneyden 4 m uzakta değil) etkilenmez
  assert.equal(C.obstacleShade(ly, o, C.sunLocal({ elevation: 30, azimuth: 90 }, 0)).frac, 0);
  // engel dizinin kuzeyinde ve güneş güneyde: gölge yok
  assert.equal(C.obstacleShade(ly, { x: 0, z: -5, w: 2, d: 2, h: 3 }, s45).frac, 0);
  // gece
  assert.equal(C.obstacleShade(ly, o, C.sunLocal({ elevation: -5, azimuth: 0 }, 0)).frac, 0);
  // çakışma
  const c = C.obstacleShade(ly, { x: 0, z: 0, w: 2, d: 2, h: 1 }, s45);
  assert.ok(c.clash.length >= 2);
  // dizi azimutu: dizi 90° batıya döndürülünce batıdan gelen güneş dizi yönünden gelir
  near(C.sunLocal({ elevation: 0, azimuth: 90 }, 90).z, 1, 1e-12);
});

test('ışın–kutu', () => {
  const b = { x0: -1, x1: 1, y0: 0, y1: 1, z0: -1, z1: 1 };
  assert.equal(C.rayBox(0, 0.5, -5, { x: 0, y: 0, z: 1 }, b), true);
  assert.equal(C.rayBox(0, 0.5, -5, { x: 0, y: 0, z: -1 }, b), false);
  assert.equal(C.rayBox(0, 2, -5, { x: 0, y: 0, z: 1 }, b), false);
});

test('koruma: string sigortası, SPD, AC kesici', () => {
  const two = C.stringFuse(13.9, 2, 25, 0);
  assert.equal(two.needed, false); assert.equal(two.ok, true);
  const three = C.stringFuse(13.9, 3, 25, 0);
  assert.equal(three.needed, true); assert.equal(three.ok, false); near(three.reverse, 34.75, 1e-9);
  assert.equal(three.suggest, 25); assert.equal(C.stringFuse(13.9, 3, 25, 25).ok, true); assert.equal(C.stringFuse(13.9, 3, 25, 15).ok, false);
  assert.equal(C.spdCheck(1000, 960).ok, true); assert.equal(C.spdCheck(1000, 1050).ok, false);
  const ac = C.acBreaker(80, 400, 160);
  near(ac.Iac, 80000 / (Math.sqrt(3) * 400), 1e-9); assert.equal(ac.suggest, 160); assert.equal(ac.ok, true);
  assert.equal(C.acBreaker(80, 400, 125).ok, false);
});

test('ihracat sınırı ve ay × saat matrisi', () => {
  const pts = [{ t: 12, Pac: 150 }, { t: 3, Pac: 0 }];
  const l = C.loadAt('uc', 876000, 12); near(l, 100, 1e-9, '3 vardiya: sabit 100 kW');
  const r = C.exportLimit(pts, 'uc', 876000, 20);
  near(r.maxCutKW, 30, 1e-9); near(r.cutKWh, 5, 1e-9);
  const input = { lat: 38.42, lon: 27.14, tilt: 15, azimuth: 0, Pmod: 540, nMod: 360, perString: 18, stringsPerMppt: 2, Voc: 49.6, Vmp: 41.6, Isc: 13.9, betaVoc: -0.27, betaVmp: -0.35, gamma: -0.35, noct: 45, Pac: 160, vdcMax: 1100, mpptMin: 200, mpptMax: 1000, iscMppt: 40, invEff: 98.2, dcLoss: 14, cloud: 0.1, pitch: 3.6, rows: 12, month: 6, hour: 12, Ta: 28, Tmin: -3, Tmax: 40, price: 5, exportPrice: 3, capex: 0, consumption: 450000, roofArea: 2400 };
  const m = C.monthHour(input);
  assert.equal(m.length, 12); assert.equal(m[0].length, 16);
  const jun = E.ges.compute(input).values.today.pts.reduce((a, p) => (Math.abs(p.t - 12) < Math.abs(a.t - 12) ? p : a));
  near(m[5][7], jun.Pac, 1e-9, 'haziran 12:00 motorla aynı');
  assert.ok(m[5][7] > m[11][7], 'haziran öğlesi > aralık öğlesi');
});
