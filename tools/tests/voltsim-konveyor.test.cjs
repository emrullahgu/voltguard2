'use strict';

// VoltSim konveyör + SCADA: merdiven programı (sıralı kalkış/duruş, kilitleme, acil durdurma, sıkışma), motor FB’si olarak
// engine.motor.plcScan, ürün akışı, motor akımı/termik, alarm durumları ve analitik değerler.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.resolve(__dirname, '../../js/voltsim/engine.js'));
const K = require(path.resolve(__dirname, '../../js/voltsim/calc/konveyor.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≠ ' + b);

const UI = o => Object.assign({ start: false, stop: false, reset: false, es: [false, false, false], strain: [0, 0, 0] }, o);
const Kb = sim => [sim.plc.b.Q_K1, sim.plc.b.Q_K2, sim.plc.b.Q_K3];
function run(sim, ui, t, cfg) { return K.step(sim, ui, t, cfg); }
function started(cfg) { let s = K.initSim(cfg); s = run(s, UI({ start: true }), 0.05, cfg); return s; }

test('analitik değerler: kapasite, fotosel süresi, boşaltma süresi, motor In (engine.motor.nominal)', () => {
  const cfg = K.config({ v: 0.5 });
  const a = K.analysis(cfg);
  near(a.cap, 60 * 0.5 / (0.4 + 0.15), 1e-9); near(a.peBlock, 0.8, 1e-12);
  near(a.need[1], (6 + 0.4) / 0.5, 1e-12);
  const m = cfg.motors[1]; near(m.In, 3000 / (Math.sqrt(3) * 400 * 0.86 * 0.8), 1e-9);
  assert.equal(K.analysis(K.config({ tJam: 0.5 })).jamOK, false);
  assert.equal(K.analysis(K.config({ runout: [0, 5, 10] })).runoutOK[1], false);
});

test('sıralı kalkış: önce C3, tSeq sonra C2, sonra C1', () => {
  const cfg = K.config({ tSeq: 2 });
  let s = started(cfg);
  assert.deepEqual(Kb(s), [false, false, true]);
  s = run(s, UI(), 1.9, cfg); assert.deepEqual(Kb(s), [false, false, true]);
  s = run(s, UI(), 0.2, cfg); assert.deepEqual(Kb(s), [false, true, true]);
  s = run(s, UI(), 2.1, cfg); assert.deepEqual(Kb(s), [true, true, true]);
  assert.equal(s.plc.b.Q_GREEN, true);
});

test('sıralı duruş: C1 hemen, C2 ve C3 boşaltma süresince; yeterli süreyle bantlar boşalır', () => {
  const cfg = K.config({ feed: 30 });
  let s = started(cfg); s = run(s, UI(), 60, cfg);
  assert.ok(s.plant.items.length > 5);
  s = run(s, UI({ stop: true }), 0.1, cfg);
  assert.deepEqual(Kb(s), [false, true, true]);
  s = run(s, UI(), 13.5, cfg); assert.equal(s.plc.b.Q_K2, true, 'C2 boşaltmada (14 s)');
  s = run(s, UI(), 1, cfg); assert.equal(s.plc.b.Q_K2, false, 'C2 boşaltma bitti');
  s = run(s, UI(), 10.5, cfg); assert.deepEqual(Kb(s), [false, false, false]);
  const onC23 = s.plant.items.filter(it => K.segOf(cfg, it.x - K.ITEM / 2) >= 1).length;
  assert.equal(onC23, 0, 'C2 ve C3 boş');
  // kısa boşaltma: ürün bantta kalır
  const cfg2 = K.config({ feed: 30, runout: [0, 2, 2] });
  let s2 = started(cfg2); s2 = run(s2, UI(), 60, cfg2); s2 = run(s2, UI({ stop: true }), 0.1, cfg2); s2 = run(s2, UI(), 10, cfg2);
  assert.ok(s2.plant.items.filter(it => K.segOf(cfg2, it.x - K.ITEM / 2) >= 1).length > 0);
});

test('acil durdurma: kategori 0 (hepsi anında), reset olmadan yeniden kalkmaz; FB = engine.motor.plcScan', () => {
  const cfg = K.config({});
  let s = started(cfg); s = run(s, UI(), 10, cfg);
  s = run(s, UI({ es: [false, true, false] }), 0.05, cfg);
  assert.deepEqual(Kb(s), [false, false, false]); assert.equal(s.plc.b.M_ESL, true);
  assert.ok(s.plc.fb.every(f => f.estopLatched), 'FB içindeki acil kilidi (plcScan)');
  s = run(s, UI({ start: true }), 0.5, cfg); assert.deepEqual(Kb(s), [false, false, false], 'mantar bırakılmadan start etkisiz');
  s = run(s, UI({ start: true, es: [false, false, false] }), 0.5, cfg); assert.deepEqual(Kb(s), [false, false, false], 'reset gerekir');
  s = run(s, UI({ reset: true }), 0.1, cfg); assert.equal(s.plc.b.M_ESL, false);
  assert.deepEqual(Kb(s), [false, false, false], 'reset kendiliğinden başlatmaz (ISO 13850)');
  s = run(s, UI({ start: true }), 0.1, cfg); assert.equal(s.plc.b.Q_K3, true);
  // FB tek başına: motor-otomasyon plcScan ile aynı mühür kuralı
  const fb = E.motor.plcScan({ run: false, timer: 0 }, { start: true, stop: true, estop: true, ol: true, reset: false, method: 'DOL' }, 0.01, 0);
  assert.equal(fb.K1, true);
});

test('sıkışma: fotosel tJam’den uzun kapalı → bant ve yukarısı durur, aşağısı boşalır; alarm onaylanır', () => {
  const cfg = K.config({ tJam: 3 });
  let s = started(cfg); s = run(s, UI(), 20, cfg);
  s = Object.assign({}, s, { plant: K.injectJam(s.plant, cfg, 1) });
  s = run(s, UI(), 2.5, cfg); assert.equal(s.plc.b.M_JAM2, false, 'tJam dolmadı');
  s = run(s, UI(), 1, cfg); assert.equal(s.plc.b.M_JAM2, true);
  assert.equal(s.plc.b.Q_K1, false); assert.equal(s.plc.b.Q_K2, false); assert.equal(s.plc.b.Q_K3, true, 'C3 boşaltıyor');
  const al = s.alarms.find(a => a.id === 'J2'); assert.ok(al && al.active && !al.acked);
  let list = K.ackAll(s.alarms); assert.ok(list.find(a => a.id === 'J2').acked);
  // sıkışma giderilip resetlenince alarm normale döner, hat yeniden başlatılabilir
  s = Object.assign({}, s, { alarms: list, plant: K.clearJam(s.plant, cfg) });
  s = run(s, UI({ reset: true }), 0.1, cfg);
  assert.equal(s.plc.b.M_JAM2, false); assert.equal(s.alarms.find(a => a.id === 'J2'), undefined, 'onaylı + normal → listeden düşer');
  s = run(s, UI({ start: true }), 6, cfg); assert.deepEqual(Kb(s), [true, true, true]);
});

test('yanlış ayar: tJam ürün geçiş süresinden kısa → yalancı sıkışma', () => {
  const cfg = K.config({ tJam: 0.5, feed: 30 });
  let s = started(cfg); s = run(s, UI(), 40, cfg);
  assert.ok(s.plc.b.M_JAMANY, 'PE 0,8 s kapalı kalırken 0,5 s zamanlayıcı açar');
});

test('termik: mekanik zorlanmada akım > 1,2·In → termik açar, alt bantlar kilitlemeyle durur', () => {
  const cfg = K.config({});
  let s = started(cfg); s = run(s, UI(), 10, cfg);
  const In = cfg.motors[1].In;
  s = run(s, UI({ strain: [0, 1.2, 0] }), 2, cfg);
  assert.ok(s.plant.I[1] > 1.2 * In);
  s = run(s, UI({ strain: [0, 1.2, 0] }), 30, cfg);
  assert.equal(s.plant.ol[1], false); assert.equal(s.plc.b.Q_K2, false); assert.equal(s.plc.b.Q_K1, false);
  assert.ok(s.alarms.find(a => a.id === 'O2'));
  // yol alma akımı ≈ 6·In’den başlar
  let s2 = K.initSim(cfg); s2 = run(s2, UI({ start: true }), 0.05, cfg);
  assert.ok(s2.plant.I[2] > 4 * cfg.motors[2].In);
});

test('merdiven programı: her basamakta güç akışı kaydı ve çıktı tutarlılığı', () => {
  const cfg = K.config({});
  let s = started(cfg); s = run(s, UI(), 5, cfg);
  K.PROGRAM.forEach(r => assert.ok(s.plc.flow[r.id], 'akış ' + r.id));
  assert.equal(s.plc.flow.R6.power, true); assert.equal(s.plc.flow.R13.out, s.plc.b.Q_K1);
  // sayaç PE3 yükselen kenarlarını sayar
  s = run(s, UI(), 60, cfg); assert.ok(s.plc.C_OUT >= 10);
});
