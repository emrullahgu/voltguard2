'use strict';
// Hesaplama sayfaları ve Hesaplama Merkezi'nin ortak formülleri (js/calculator-config.js) için referans değer testleri.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cfg = require('../../js/calculator-config.js');
const engine = require('../../js/voltsim/engine.js');
const C = cfg.calc;
const close = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} beklenen ${expected} ± ${tol}, bulunan ${actual}`);

test('Türkçe sayı girişi: ondalık virgül, binlik nokta, hatalı biçimler', () => {
  for (const [raw, v] of [['1.500', 1500], ['1.234,5', 1234.5], ['0,85', 0.85], ['2.4', 2.4], ['0.6', 0.6], ['35.000', 35000], [',5', 0.5]]) assert.equal(C.parseTr(raw), v, raw);
  for (const raw of ['', 'abc', '1,2,3', '1 000', 'Infinity', '1e3']) assert.ok(Number.isNaN(C.parseTr(raw)), raw);
});

test('IEC 60909: 1000 kVA, 400 V, uk %6, sonsuz şebeke → Ik3 ≈ 25,3 kA (c = 1,05) ve Icu ≥ 36 kA', () => {
  const s = C.shortCircuit({ S_kVA: 1000, uk: 6 });
  close(s.Ik3, 25259, 5, 'Ik3');
  close(s.In, 1443.4, 0.1, 'In');
  assert.equal(s.icu, 36);
  // js/voltsim/engine.js ile aynı sonuç
  const src = engine.sourceImpedance({ U_LL: 400, SkQ_MVA: 0, Sr_kVA: 1000, uk_pct: 6, Pk_W: 0 });
  close(engine.shortCircuit3(400, src.R, src.X).Ik, s.Ik3, 1e-6, 'engine');
});

test('IEC 60909: şebeke empedansı ve kablo Ik3 değerini düşürür; Ik1,min motor ile tutarlı', () => {
  const o = { S_kVA: 630, uk: 4, Pk_W: 4600, SkQ_MVA: 500, cable: { L: 80, S: 95, material: 'Cu', parallel: 1 } };
  const s = C.shortCircuit(o);
  const src = engine.sourceImpedance({ U_LL: 400, SkQ_MVA: 500, Sr_kVA: 630, uk_pct: 4, Pk_W: 4600 });
  const cab = engine.cableImpedance(80, 95, 1, 'Cu');
  close(s.Ik3, engine.shortCircuit3(400, src.R + cab.R, src.X + cab.X).Ik, 1e-6, 'Ik3 engine');
  close(s.Ik1min, engine.shortCircuit1Min(400, src, cab), 1e-6, 'Ik1min engine');
  assert.ok(s.Ik3 < C.shortCircuit({ S_kVA: 630, uk: 4 }).Ik3);
  assert.ok(s.ip > Math.SQRT2 * s.Ik3 && s.ip < 2 * Math.SQRT2 * s.Ik3);
});

test('Gerilim düşümü: R′ işletme sıcaklığında ve reaktansla; 80 A, 25 mm², 60 m, cosφ 0,9 → %1,67', () => {
  close(C.resistivity('Cu', 20), 1 / 56, 1e-12);
  close(1 / C.resistivity('Cu', 70), 46.8, 0.1, 'κ70 Cu');
  const d = C.voltageDrop({ I: 80, L: 60, S: 25, U: 400, phases: 3, cosphi: 0.9, material: 'Cu', tempC: 70 });
  close(d.pct, 1.671, 0.002);
  // tek faz 230 V: k = 2, U faz-nötr
  const d1 = C.voltageDrop({ I: 16, L: 30, S: 2.5, U: 230, phases: 1, cosphi: 1, material: 'Cu', tempC: 70 });
  close(d1.pct, 2 * 16 * 30 * C.resistivity('Cu', 70) / 2.5 / 230 * 100, 1e-9);
  assert.equal(C.VDROP_LIMITS['ity-light'].pct, 1.5);
  assert.equal(C.VDROP_LIMITS['ity-motor'].pct, 3);
  assert.equal(cfg.technical.voltageDropLimitLightingPct, 1.5, 'Merkez de EİTY md. 57 kullanır');
  assert.equal(cfg.technical.voltageDropLimitPowerPct, 3);
});

test('Kablo seçimi: Ib ≤ In ≤ Iz′, gG için I2 ≤ 1,45·Iz′, düzeltme katsayıları ve gerilim düşümü', () => {
  const Ib = C.loadCurrent(45, 400, 3, 0.9);
  close(Ib, 72.17, 0.01);
  const a = C.selectCable({ Ib, phases: 3, U: 400, cosphi: 0.9, L: 50, method: 'B1', dropLimit: 3 });
  assert.deepEqual([a.S, a.In, a.Iz, a.kind], [25, 80, 89, 'MCB']);
  const b = C.selectCable({ Ib, phases: 3, U: 400, cosphi: 0.9, L: 150, method: 'B1', dropLimit: 3 });
  assert.equal(b.S, 35); assert.equal(b.governedBy, 'gerilim düşümü');
  // gG 80 A: 1,6·80 = 128 ≤ 1,45·Iz → Iz ≥ 88,3 → 25 mm² (89 A) yeter; 30 °C yerine 40 °C (0,87) → 35 mm²
  assert.equal(C.selectCable({ Ib, phases: 3, U: 400, cosphi: 0.9, L: 0, method: 'B1', protection: 'gG' }).S, 25);
  assert.equal(C.selectCable({ Ib, phases: 3, U: 400, cosphi: 0.9, L: 0, method: 'B1', ambient: 40 }).S, 35);
  close(C.groupFactor(3), 0.7, 1e-12); close(C.tempFactor(35), 0.94, 1e-12);
  assert.equal(C.cableIz(2.5, 'C', 3), 24); assert.equal(C.cableIz(16, 'B1', 3), 68);
  for (const S of [1.5, 2.5, 4, 6, 10, 16, 25]) assert.equal(C.cableIz(S, 'B1', 3), engine.cableIz(S, 'B1', 3), 'B1 ' + S);
  // In > 125 A → MCCB; MCB kademeleri 125 A'i aşmaz
  assert.equal(C.breakerKind(140), 'MCCB'); assert.ok(Math.max(...C.MCB_SIZES) <= 125);
  assert.equal(C.overloadOk(30, 32, 32, 'gG').ok, false);
  assert.equal(C.overloadOk(30, 32, 32, 'MCB').ok, true);
});

test('Jeneratör: kW sınırı (anma cosφ 0,8) ve motor kalkışı', () => {
  const g = C.generatorSize({ P_kW: 200, cosphi: 1, simult: 1, margin: 0, motor_kW: 0, start: 'DOL' });
  assert.equal(g.S1, 250); assert.ok(g.kwGoverns); assert.equal(g.pick, 275);
  const d = C.generatorSize({ P_kW: 200, cosphi: 0.8, simult: 0.8, margin: 0.2, motor_kW: 30, start: 'DOL' });
  close(d.Inm, 56.6, 0.05); close(d.S2, 266.7, 0.1); assert.equal(d.pick, 275);
});

test('UPS: yaşlanma payı ve kısa deşarj kapasite oranıyla akü boyutu', () => {
  const u = C.upsSize({ P_kW: 20, pf: 1, margin: 0.2, minutes: 15, Udc: 240, invEff: 0.94 });
  assert.equal(u.pick, 30); assert.equal(u.blocks, 20);
  close(u.wPerBlock, 1329.8, 0.1); close(u.ahC10, 63.3, 0.1);
  assert.ok(u.ahC10 > 2 * (21277 / 240 * 0.25), 'Doğrusal akım × süre hesabından en az iki kat büyük');
});

test('Topraklama: Dwight çubuk formülü ve paralel verim', () => {
  close(C.rodResistance(150, 2.4, 0.02), 58.36, 0.05);
  const r = C.rodsFor(C.rodResistance(195, 2.4, 0.02), 10);
  assert.equal(r.n, 13); assert.ok(r.R <= 10);
  assert.equal(C.rodsFor(30, 50).n, 1);
});

test('Kompanzasyon ve reaktif sınırlar (EPDK 5999-3)', () => {
  const k = C.compensation(100, 0.75, 0.98);
  close(k.Qc, 67.89, 0.01);
  close(k.ratio2, 20.31, 0.01, '0,98 hedefi %20 sınırını aşar');
  close(C.cosForRatio(20), 0.9806, 1e-4); close(C.cosForRatio(33), 0.9496, 1e-4);
});

test('GES DC kablo: IEC 62548 tasarım akımı ve EN 50618 değerleri', () => {
  const dc = C.selectDcCable(1.25 * 14 * 4, 40, 600, 1);
  assert.equal(dc.S, 16); assert.ok(dc.drop <= 1);
  assert.equal(C.SOLAR_IZ[4], 55);
});

test('Trafo anma akımı cosφ’den bağımsızdır', () => {
  close(C.transformerCurrent(400, 400, 3), 577.35, 0.01);
  close(C.transformerCurrent(400, 34500, 3), 6.694, 0.001);
});

test('Hesaplama sayfaları ortak modülü yükler ve WebApplication JSON-LD içerir', () => {
  const fs = require('node:fs');
  const dir = path.join(__dirname, '../../hesaplama');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    const types = ld.flatMap(d => (d['@graph'] || [d]).map(n => n['@type']));
    assert.ok(types.includes('WebApplication'), file + ' WebApplication');
    if (file !== 'reaktif-ceza-hesaplama.html') assert.match(html, /\/js\/calculator-config\.js\?v=/, file);
    assert.doesNotMatch(html, /<input[^>]+type="number"/, file + ': Türkçe ondalık için metin girişi kullanılır');
  }
});
