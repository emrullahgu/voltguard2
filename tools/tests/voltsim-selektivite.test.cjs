'use strict';

// VoltSim kısa devre ve selektivite hesapları (js/voltsim/calc/selektivite.js): standart sınır değerleri ve bağımsız el hesabıyla doğrulama.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const E = require(path.join(root, 'js/voltsim/engine.js'));
const S = require(path.join(root, 'js/voltsim/calc/selektivite.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' beklenen ' + b + ', bulunan ' + a);
const rel = (a, b, r, msg) => near(a, b, Math.abs(b) * r, msg);

const mcb = (In, curve) => ({ kind: 'MCB', In, curve, Icu: 6 });
const fuse = In => ({ kind: 'FUSE', In, Icu: 100 });
const lsi = (kind, In, o) => Object.assign({ kind, In, ir: 1, tr: 10, isd: 0, tsd: 0.1, ii: 10, Icu: 50 }, o);

test('MCB bandı IEC 60898-1 kapılarından geçer (C16 ve C63)', () => {
  const c16 = mcb(16, 'C');
  assert.equal(S.band(c16, 1.12 * 16).tmin, null, '1,13·In altında açmaz');
  assert.equal(S.band(c16, 1.4 * 16).tmax, null, '1,45·In altında açma garanti değil');
  rel(S.band(c16, 1.45 * 16).tmax, 3600, 1e-9, '1,45·In → ≤ 1 sa');
  rel(S.band(c16, 2.55 * 16).tmax, 60, 1e-9, '2,55·In → ≤ 60 s (In ≤ 32 A)');
  rel(S.band(c16, 2.55 * 16).tmin, 1, 1e-9, '2,55·In → ≥ 1 s');
  assert.ok(S.band(c16, 5 * 16).tmin >= 0.1, 'alt ani sınırda 0,1 s içinde açmaz');
  near(S.band(c16, 10 * 16).tmax, 0.1, 1e-12, 'üst ani sınırda ≤ 0,1 s');
  assert.ok(S.band(c16, 9.9 * 16).tmax > 1, 'ani bandın içinde ani açma garanti değil');
  rel(S.band(mcb(63, 'C'), 2.55 * 63).tmax, 120, 1e-9, 'In > 32 A → ≤ 120 s');
  near(S.band(mcb(10, 'B'), 50).tmax, 0.1, 1e-12, 'B: 5·In');
  near(S.band(mcb(10, 'D'), 200).tmax, 0.1, 1e-12, 'D: 20·In');
  assert.ok(S.band(mcb(10, 'D'), 100).tmin >= 0.1, 'D: 10·In’de 0,1 s içinde açmaz');
});

test('gG sigorta bandı IEC 60269-2 kapı değerlerinden geçer (63 A ve 160 A)', () => {
  const f = fuse(63);
  near(S.band(f, 320).tmax, 5, 1e-9, 'Imax(5 s) = 320 A');
  near(S.band(f, 820).tmax, 0.1, 1e-9, 'Imax(0,1 s) = 820 A');
  near(S.band(f, 160).tmin, 10, 1e-9, 'Imin(10 s) = 160 A');
  near(S.band(f, 450).tmin, 0.1, 1e-9, 'Imin(0,1 s) = 450 A');
  assert.equal(S.band(f, 1.25 * 63).tmin, null, 'Inf = 1,25·In’de erimez');
  assert.equal(S.band(f, 1.55 * 63).tmax, null, 'If = 1,6·In altında erime garanti değil');
  near(S.band(f, 1.6 * 63).tmax, 3600, 1e-6, 'If → konvansiyonel süre 1 sa');
  near(S.band(fuse(160), 950).tmax, 5, 1e-9);
  near(S.band(fuse(160), 1.6 * 160).tmax, 7200, 1e-6, '63 < In ≤ 160 A → 2 sa');
});

test('LSI bandı: L (tr @ 6·Ir), S (tsd), I (Ii ±%20)', () => {
  const a = lsi('ACB', 630, { tr: 10, isd: 4, tsd: 0.2, ii: 0 });
  rel(S.band(a, 6 * 630).tmax, Math.min(12, 0.25), 1e-9, '6·Ir’de L 12 s ama S devrede (0,25 s)');
  rel(S.band(a, 2000).tmax, 1.2 * 10 * 36 / Math.pow(2000 / 630, 2), 1e-9, 'L bölgesi I²t = sabit');
  rel(S.band(a, 2000).tmin, 0.8 * 10 * 36 / Math.pow(2000 / 630, 2), 1e-9);
  assert.equal(S.band(a, 1.04 * 630).tmin, null, '1,05·Ir altında açmaz');
  assert.equal(S.band(a, 1.25 * 630).tmax, null, '1,30·Ir altında açma garanti değil (IEC 60947-2)');
  near(S.band(a, 3000).tmin, 0.17, 1e-9, 'Isd·0,9 = 2268 A üstü: tsd − 0,03');
  const m = lsi('MCCB', 250, { ii: 10 });
  near(S.band(m, 0.81 * 2500).tmin, 0.01, 1e-12, 'Ii alt toleransı 0,8·Ii');
  near(S.band(m, 1.2 * 2500).tmax, 0.05, 1e-12, 'Ii üst toleransı 1,2·Ii');
  assert.ok(S.band(m, 1.19 * 2500).tmax > 0.05, '1,2·Ii altında ani açma garanti değil');
});

test('kısa devre: 1000 kVA, %6, Pk 10,5 kW, SkQ 500 MVA → bağımsız el hesabı ≈ 24,4 kA', () => {
  // ZQ = 1,05·400²/500 MVA = 0,336 mΩ (X = 0,995Z, R = 0,1X); ZT = 9,6 mΩ, RT = 1,68 mΩ
  const ZQ = 1.05 * 400 * 400 / 500e6, XQ = 0.995 * ZQ, RQ = 0.1 * XQ, RT = 10500 * 400 * 400 / 1e12, XT = Math.sqrt(Math.pow(0.06 * 0.16, 2) - RT * RT);
  const Ik = 1.05 * 400 / (Math.sqrt(3) * Math.hypot(RQ + RT, XQ + XT));
  near(Ik, 24410, 30, 'el hesabı');
  const r = S.compute({ U_LL: 400, Sr_kVA: 1000, uk: 6, Pk_W: 10500, SkQ_MVA: 500, fault: 0, faultType: '3F', devices: [lsi('ACB', 1600, { L: 0, S: 240, n: 4, Icu: 65, isd: 4, tsd: 0.3, ii: 0 })] });
  assert.ok(r.ok, (r.errors || []).join('; '));
  near(r.values.Ik3T, Ik, 1e-6, 'motor (E.shortCircuit3) ile aynı');
  near(r.values.nodes[0].Ik3, Ik, 1e-6, 'kablosuz ana bara = trafo uçları');
  // kablo eklenince akım azalır; motorun cableImpedance + shortCircuit3 zinciriyle aynı
  const r2 = S.compute({ U_LL: 400, Sr_kVA: 1000, uk: 6, Pk_W: 10500, SkQ_MVA: 500, devices: [lsi('ACB', 1600, { L: 20, S: 240, n: 4 }), mcb(16, 'C')].map((d, i) => Object.assign({ L: 30, S: 2.5, n: 1, parent: i - 1, Icu: 50 }, d, i === 0 ? { L: 20, S: 240, n: 4 } : {})) });
  assert.ok(r2.ok, (r2.errors || []).join('; '));
  const src = E.sourceImpedance({ U_LL: 400, SkQ_MVA: 500, Sr_kVA: 1000, uk_pct: 6, Pk_W: 10500 });
  const c1 = E.cableImpedance(20, 240, 4, 'Cu'), c2 = E.cableImpedance(30, 2.5, 1, 'Cu');
  near(r2.values.nodes[1].Ik3, E.shortCircuit3(400, src.R + c1.R + c2.R, src.X + c1.X + c2.X).Ik, 1e-6);
  near(r2.values.nodes[1].Ik1, E.shortCircuit1Min(400, src, { R: c1.R + c2.R, X: c1.X + c2.X }), 1e-6);
  near(r2.values.nodes[1].IkLine, r2.values.nodes[0].Ik3, 1e-9, 'MCB’nin bağlı olduğu bara = ana bara');
  assert.ok(r2.values.nodes[1].Ik1 < 1000 && r2.values.nodes[1].Ik1 > 300, '2,5 mm² 30 m hat sonu Ik1 birkaç yüz A: ' + r2.values.nodes[1].Ik1);
});

test('seçicilik: ACB(tsd 0,3) → MCCB(tsd 0,1) tam; MCCB(Isd) → MCB sınırı ≈ 0,9·Isd (ani bölge)', () => {
  const acb = lsi('ACB', 1600, { tr: 12, isd: 4, tsd: 0.3, ii: 0 });
  const mccb = lsi('MCCB', 250, { tr: 5, isd: 6, tsd: 0.1, ii: 12 });
  const s1 = S.selectivity(acb, mccb, 25000);
  assert.equal(s1.status, 'total', JSON.stringify(s1));
  const m2 = lsi('MCCB', 250, { tr: 5, isd: 5, tsd: 0.1, ii: 10 });
  const s2 = S.selectivity(m2, mcb(16, 'C'), 12000);
  assert.equal(s2.status, 'partial');
  assert.equal(s2.region, 'inst');
  rel(s2.Is, 0.9 * 5 * 250, 0.01, 'Is ≈ 0,9·Isd (S alt toleransı < MCB 0,1 s)');
  // Ir ayarı alt cihazdan küçük üst cihaz: aşırı yük bölgesinde seçicilik yok
  const s3 = S.selectivity(lsi('MCCB', 100, { ir: 0.4, ii: 10 }), mcb(63, 'C'), 5000);
  assert.equal(s3.region, 'overload');
  assert.equal(s3.status, 'none');
});

test('seçicilik: gG 160/63 tam, gG 80/63 kısmi; anma oranı raporlanır', () => {
  const a = S.selectivity(fuse(160), fuse(63), 20000);
  assert.equal(a.status, 'total', JSON.stringify(a));
  near(a.ratio, 160 / 63, 1e-12);
  const b = S.selectivity(fuse(80), fuse(63), 20000);
  assert.notEqual(b.status, 'total');
});

test('arıza tepkisi: arızaya en yakın cihaz ilk açar; seçici değilse üst cihaz da açabilir', () => {
  const devs = [lsi('ACB', 1600, { isd: 4, tsd: 0.3, ii: 0, parent: -1 }), lsi('MCCB', 250, { isd: 5, tsd: 0.1, ii: 10, parent: 0 }), Object.assign(mcb(16, 'C'), { parent: 1 })];
  const low = S.faultResponse(devs, 2, 400);    // 400 A: MCB ani açar, MCCB açmaz
  assert.equal(low.first, 2); assert.equal(low.selective, true);
  assert.deepEqual(low.path, [2, 1, 0]);
  const high = S.faultResponse(devs, 2, 4000);  // MCCB ani (≥ 1,2·Ii = 3000 A: ≤ 50 ms) MCB’nin standart 0,1 s sınırından önce
  assert.equal(high.first, 1, JSON.stringify(high));
  assert.deepEqual(high.downMay, [2], 'MCB de aynı sürede açabilir (yarış)');
  assert.equal(high.selective, false);
});

test('tam hesap: girdi hataları, kontroller ve seçicilik çiftleri', () => {
  const bad = S.compute({ U_LL: 400, Sr_kVA: 1000, uk: 6, Pk_W: 10500, SkQ_MVA: 500, devices: [Object.assign(fuse(70), { L: 1, S: 50, parent: -1 })] });
  assert.equal(bad.ok, false, '70 A gG kapı tablosunda yok');
  const ok = S.compute({ U_LL: 400, Sr_kVA: 630, uk: 4, Pk_W: 6500, SkQ_MVA: 750, fault: 2, faultType: '1F', devices: [
    lsi('ACB', 1000, { parent: -1, L: 15, S: 240, n: 3, isd: 4, tsd: 0.3, ii: 0 }), lsi('MCCB', 160, { parent: 0, L: 60, S: 50, isd: 6, tsd: 0.1, ii: 10, Icu: 36 }), Object.assign(mcb(16, 'C'), { parent: 1, L: 25, S: 2.5, Icu: 6 })] });
  assert.ok(ok.ok, (ok.errors || []).join('; '));
  assert.equal(ok.values.nPairs, 2);
  assert.ok(ok.checks.some(c => c.id === 'sel2'));
  assert.ok(ok.checks.some(c => c.id === 'fault'));
  assert.ok(ok.values.Ifault < ok.values.nodes[2].Ik3, 'faz–toprak en küçük akım < Ik3');
});
