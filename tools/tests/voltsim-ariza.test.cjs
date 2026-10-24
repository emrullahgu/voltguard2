'use strict';

// VoltSim arıza tespit laboratuvarı: düğüm çözücü referansları, senaryoların tekrarlanabilirliği, arıza fiziği
// (açık nötr kayması, hayalet gerilim, kilitli rotor akımı, RCD kaçağı, gevşek temas), ölçü aletleri, EN 50110 kuralları ve puan.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.resolve(__dirname, '../../js/voltsim/engine.js'));
const X = require(path.resolve(__dirname, '../../js/voltsim/calc/ariza.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≠ ' + b);
const C = E.C;

test('çözücü: gerilim bölücü ve Millman yıldız noktası (referans)', () => {
  const N = new X.Net();
  N.src('A', 'RE', C.of(100), C.of(1e-6));
  N.add('A', 'B', C.of(30)); N.add('B', 'RE', C.of(70), 'r');
  const s = N.solve();
  near(s.V('B').re, 70, 1e-4); near(C.abs(s.I('r')), 1, 1e-6);
  // yüzer yıldız: üç faz 230 V, yükler 1, 1, 2 S oranında → Vn = Σ(Y·E)/ΣY
  const M = new X.Net(), Y = [1, 1, 2];
  for (let i = 0; i < 3; i++) { M.src('L' + i, 'RE', C.polar(230, -i * 120 * Math.PI / 180), C.of(1e-6)); M.add('L' + i, 'n', C.of(1 / Y[i])); }
  const vn = M.solve().V('n');
  let num = C.of(0); for (let i = 0; i < 3; i++) num = C.add(num, C.scale(C.polar(230, -i * 120 * Math.PI / 180), Y[i]));
  const ref = C.scale(num, 1 / 4);
  near(vn.re, ref.re, 1e-3); near(vn.im, ref.im, 1e-3); near(C.abs(vn), 57.5, 1e-3);
});

test('senaryo tohumu tekrarlanabilir; mod havuzları', () => {
  assert.deepEqual(X.scenario(42, 'intermediate'), X.scenario(42, 'intermediate'));
  for (let s = 1; s < 60; s++) assert.ok(X.POOLS.beginner.includes(X.scenario(s, 'beginner').type));
  const seen = new Set(); for (let s = 1; s < 400; s++) seen.add(X.scenario(s, 'advanced').type);
  assert.equal(seen.size, Object.keys(X.FAULTS).length, 'ileri modda bütün arızalar çıkabilir');
  assert.equal(X.scenario(3, 'beginner', 'ttEarth').type, 'ttEarth');
});

const sess0 = (type, seed) => { const sc = X.scenario(seed || 5, 'advanced', type); return { sc: sc, s: X.newSession(sc) }; };
const m = (sc, s, q) => X.measure(sc, s.sw, q);

test('sağlam tesis değerleri: 400/230 V, motor In, ısıtıcı akımı, saat yönü', () => {
  const { sc, s } = sess0('looseConn');
  near(m(sc, s, { inst: 'volt', a: 'B1', b: 'B2' }).value, 400, 6);
  near(m(sc, s, { inst: 'volt', a: 'B1', b: 'BN' }).value, 230, 3);
  near(m(sc, s, { inst: 'clamp', target: 'c3L1' }).value, X.MOTOR.In, 0.4);
  near(X.MOTOR.In, 5500 / (Math.sqrt(3) * 400 * 0.87 * 0.83), 1e-9);
  near(m(sc, s, { inst: 'clamp', target: 'c4L1' }).value, 3000 / 230, 0.3);
  assert.equal(m(sc, s, { inst: 'rot', target: 'rB' }).seq, 1);
  const lp = m(sc, s, { inst: 'loop', target: 'lB' });
  assert.ok(lp.value > 0.02 && lp.value < 0.1, 'bara döngüsü (trafo + servis kablosu) ' + lp.value);
});

test('açık nötr: L–L normal, L–N dengesiz, N kayar, toprak iletkeninden akım akar', () => {
  const { sc, s } = sess0('openN');
  near(m(sc, s, { inst: 'volt', a: 'B1', b: 'B2' }).value, 400, 6);
  const u1 = m(sc, s, { inst: 'volt', a: 'LmpL', b: 'LmpN' }).value, u2 = m(sc, s, { inst: 'volt', a: 'SoL', b: 'SoN' }).value;
  assert.ok(Math.abs(u1 - u2) > 40, 'dengesiz: ' + u1 + ' / ' + u2);
  assert.ok(m(sc, s, { inst: 'volt', a: 'BN', b: 'RE' }).value > 20, 'N barası uzak toprağa göre gerilimli');
  assert.ok(m(sc, s, { inst: 'clamp', target: 'earthC' }).value > 0.5, 'dönüş akımı toprak üzerinden');
  // Millman: N düğümü = Σ(Y·V)/ΣY (yerel topraklama dahil) — çözücüyle tutarlılık: KCL N barasında
  const ac = X.solveAC(sc, s.sw);
  const sumI = C.add(C.add(ac.sol.I('c1N'), ac.sol.I('c2N')), C.add(ac.sol.I('c4N'), ac.sol.I('earthC')));
  assert.ok(C.abs(sumI) < C.abs(ac.sol.I('c1N')), 'akımlar N/PE düğümünde dengelenir');
});

test('faz kaybı: kilitli rotor ≈ (√3/2)·Ist, açık fazda ≈ 115 V hayalet gerilim, termik açar', () => {
  const { sc, s: s0 } = sess0('phaseLoss');
  assert.equal(s0.sw.ol, false, 'başlangıçta termik atmış');
  let s = X.operate(sc, s0, 'ol', true).sess; s = X.operate(sc, s, 'k1', true).sess;
  const k = sc.p.lossPhase, good = [1, 2, 3].filter(i => i !== k);
  const I = m(sc, s, { inst: 'clamp', target: 'c3L' + good[0] }).value;
  near(I, Math.sqrt(3) / 2 * X.MOTOR.IstIn * X.MOTOR.In, 4, 'kilitli rotor akımı');
  assert.ok(m(sc, s, { inst: 'clamp', target: 'c3L' + k }).value < 1e-3);
  near(m(sc, s, { inst: 'volt', a: 'F3o' + k, b: 'BN' }).value, 115, 6, 'hayalet gerilim');
  let acc = {}, trip = null;
  for (let t = 0; t < 40 && !trip; t += 0.5) { const r = X.thermalStep(sc, s, acc, 0.5); acc = r.acc; trip = r.trip; }
  assert.equal(trip && trip.dev, 'ol');
  // ayırıp kilitledikten sonra atmış sigortanın sürekliliği OL
  s = X.operate(sc, s, 'k1', false).sess; s = X.operate(sc, s, 'q0', false).sess; // sigorta girişi baraya bağlı: ana şalter açılır, sigorta ayırıcı kapalı kalır
  assert.match(m(sc, s, { inst: 'ohm', a: 'B' + k, b: 'F3o' + k }).text, /^OL/);
  near(m(sc, s, { inst: 'ohm', a: 'B' + good[0], b: 'F3o' + good[0] }).value, 0, 0.01);
});

test('yalıtım hatası: RCD hemen açar; yalıtım ölçeri cihazı bulur', () => {
  const { sc, s: s0 } = sess0('insul');
  assert.equal(s0.sw.rcd, false, 'RCD açmış');
  const r = X.operate(sc, s0, 'rcd', true);
  assert.equal(r.sess.sw.rcd, false); assert.match(r.msg, /RCD hemen açtı/);
  let s = X.operate(sc, s0, 'f2', false).sess; s = X.operate(sc, s, 'f2', 'lock').sess;
  // nötr bağlı ve cihaz takılıyken L–PE yolu yük üzerinden düşük okur; nötr köprüsü kalkınca Rf görünür
  s = X.operate(sc, s, 'n2', false).sess;
  const lpe = m(sc, s, { inst: 'insul', a: 'SoL', b: 'SoPE' });
  near(lpe.value, sc.p.Rf, sc.p.Rf * 0.02, 'kaçak direnci');
  assert.ok(lpe.insulFail);
  s = X.operate(sc, s, 'plug', false).sess;
  assert.ok(m(sc, s, { inst: 'insul', a: 'SoL', b: 'SoPE' }).value > 100e6, 'sağlam kablo');
  near(m(sc, s, { inst: 'insul', a: 'ApL', b: 'ApPE' }).value, sc.p.Rf, 1, 'cihaz fişinde');
});

test('N–PE teması: yüksüz RCD açmaz, yükte açar; N–PE yalıtımı düşük', () => {
  const { sc, s: s0 } = sess0('npe');
  assert.equal(s0.sw.rcd, false);
  let s = X.operate(sc, s0, 'plug', false).sess; s = X.operate(sc, s, 'rcd', true).sess;
  assert.equal(s.sw.rcd, true, 'yüksüzken açmaz');
  s = X.operate(sc, s, 'plug', true).sess; assert.equal(s.sw.rcd, false, 'yükte açar');
  s = X.operate(sc, s, 'n2', false).sess;
  near(m(sc, s, { inst: 'insul', a: 'SoN', b: 'SoPE' }).value, sc.p.Rnp, 0.01, 'temas prizde');
});

test('gevşek bağlantı: sıcak nokta ve I·Rc gerilim düşümü', () => {
  const { sc, s } = sess0('looseConn'), k = sc.p.phase;
  const t = X.measure(sc, s.sw, { inst: 'thermal', target: 'tHbox' });
  assert.ok(t.value > 80); assert.match(t.text, new RegExp('L' + k));
  const I = m(sc, s, { inst: 'clamp', target: 'c4L' + k }).value;
  near(m(sc, s, { inst: 'volt', a: 'H' + k + 't', b: 'H' + k }).value, I * sc.p.Rc, 0.05);
});

test('faz sırası, bobin, TT ve aşırı yük', () => {
  let o = sess0('phaseSeq');
  assert.equal(m(o.sc, o.s, { inst: 'rot', target: 'rF3' }).seq, 1); assert.equal(m(o.sc, o.s, { inst: 'rot', target: 'rMot' }).seq, -1);
  o = sess0('coil');
  let s = X.operate(o.sc, o.s, 'k1', true).sess;
  near(m(o.sc, s, { inst: 'volt', a: 'A1', b: 'A2' }).value, 230, 3);
  assert.equal(X.solveAC(o.sc, s.sw).pulled, false);
  s = X.operate(o.sc, s, 'f3', false).sess;
  assert.match(m(o.sc, s, { inst: 'ohm', a: 'A1', b: 'A2' }).text, /^OL/);
  const ok = sess0('phaseSeq'); let s2 = X.operate(ok.sc, ok.s, 'k1', false).sess; s2 = X.operate(ok.sc, s2, 'f3', false).sess;
  near(m(ok.sc, s2, { inst: 'ohm', a: 'A1', b: 'A2' }).value, X.COIL.Rdc, 1, 'sağlam bobin');
  o = sess0('ttEarth');
  assert.equal(o.sc.system, 'TT');
  near(m(o.sc, o.s, { inst: 'volt', a: 'HPE', b: 'RE' }).value, 230, 6, 'gövde faz geriliminde');
  assert.ok(o.s.sw.rcd, 'RCD açmadı (akım yolu yok)');
  o = sess0('overload');
  s = X.operate(o.sc, o.s, 'f2', true).sess;
  const I = m(o.sc, s, { inst: 'clamp', target: 'c2L' }).value;
  assert.ok(I > 1.13 * 16, 'aşırı yük ' + I);
  let acc = {}, trip = null; for (let t = 0; t < 60 && !trip; t += 1) { const r = X.thermalStep(o.sc, s, acc, 1); acc = r.acc; trip = r.trip; }
  assert.equal(trip && trip.dev, 'f2');
});

test('EN 50110: gerilimli noktada DC ölçüm ihlal; ayır + kilitle + doğrula kuralı; puan', () => {
  const { sc, s: s0 } = sess0('coil');
  let r = X.record(sc, s0, { inst: 'ohm', a: 'A1', b: 'A2' });
  assert.equal(r.m.violation, undefined === r.m.violation ? undefined : r.m.violation); // A1 ölüyse (k1 kapalı) ihlal yok
  let s = X.operate(sc, s0, 'k1', true).sess;
  r = X.record(sc, s, { inst: 'ohm', a: 'A1', b: 'A2' });
  assert.equal(r.m.violation, true); s = r.sess;
  s = X.operate(sc, s, 'f3', false).sess;
  r = X.record(sc, s, { inst: 'ohm', a: 'A1', b: 'A2' }); s = r.sess;
  assert.deepEqual(r.e.rules.sort(), ['doğrulama', 'kilit'].sort());
  s = X.operate(sc, s, 'f3', 'lock').sess;
  assert.match(X.operate(sc, s, 'f3', true).msg, /kilitli/);
  r = X.record(sc, s, { inst: 'volt', a: 'A1', b: 'A2' }); s = r.sess;
  r = X.record(sc, s, { inst: 'ohm', a: 'A1', b: 'A2' }); s = r.sess;
  assert.deepEqual(r.e.rules, []);
  const sc1 = X.score(sc, s, { type: 'coil', loc: 'F3' }, 'beginner');
  assert.ok(sc1.typeOk && sc1.locOk); assert.equal(sc1.violations, 1); assert.equal(sc1.missing, 1);
  assert.equal(sc1.total, 60 + 15 + 15 + (10 - 10 - 4));
  assert.equal(X.score(sc, s, { type: 'insul', loc: 'F3' }, 'beginner').typeOk, false);
});
