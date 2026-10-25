'use strict';

// VoltSim UPS ek hesapları: bypass kilitlemeleri, akü katsayıları, boyutlandırma, adım yük kabulü, black start planı.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.resolve(__dirname, '../../js/voltsim/engine.js'));
const X = require(path.resolve(__dirname, '../../js/voltsim/calc/ups.js'));

const OK = { bypassOK: true, sync: true, invOK: true };

test('bypass: bakım bypass sırası kesintisiz ve kilitli', () => {
  let st = X.BYPASS_INIT;
  assert.equal(X.loadPath(st, OK), 'inv');
  // statik bypass olmadan Q3 kapatılamaz (inverterle paralel olurdu)
  assert.equal(X.bypassCommand(st, 'closeQ3', OK).ok, false);
  // Q3 kapanmadan Q2 açılamaz (yük kesilirdi)
  assert.equal(X.bypassCommand(st, 'openQ2', OK).ok, false);
  for (const cmd of ['toStatic', 'closeQ3', 'openQ2']) {
    const r = X.bypassCommand(st, cmd, OK);
    assert.ok(r.ok, cmd + ': ' + r.msg);
    st = r.st;
    assert.ok(X.loadPath(st, OK), cmd + ' sonrası yük beslenmeli');
  }
  assert.equal(X.loadPath(st, OK), 'maint');
  assert.equal(X.modeName(st), 'Bakım bypass');
  // geri dönüş
  for (const cmd of ['closeQ2', 'openQ3', 'toInverter']) { const r = X.bypassCommand(st, cmd, OK); assert.ok(r.ok, cmd + ': ' + r.msg); st = r.st; assert.ok(X.loadPath(st, OK)); }
  assert.deepEqual(st, X.BYPASS_INIT);
});

test('bypass: senkron değilken aktarma reddedilir, durum değişmez', () => {
  const nos = { bypassOK: true, sync: false, invOK: true };
  const r = X.bypassCommand(X.BYPASS_INIT, 'toStatic', nos);
  assert.equal(r.ok, false);
  assert.match(r.msg, /senkron/);
  assert.equal(r.st, X.BYPASS_INIT);
  // statik bypass'tan inverter'e dönüş de senkron ister
  const sb = { SS: 'byp', Q2: true, Q3: false };
  assert.equal(X.bypassCommand(sb, 'toInverter', nos).ok, false);
  assert.equal(X.bypassCommand(sb, 'toInverter', OK).ok, true);
  // Q3 kapalıyken inverter'e dönülemez
  assert.equal(X.bypassCommand({ SS: 'byp', Q2: true, Q3: true }, 'toInverter', OK).ok, false);
});

test('bypass: senkronsuz paralellik assertSafe ile yakalanır', () => {
  assert.throws(() => X.assertSafe({ SS: 'inv', Q2: true, Q3: true }), /Kilitleme ihlali/);
  assert.doesNotThrow(() => X.assertSafe({ SS: 'byp', Q2: true, Q3: true }));
  // bypass beslemesi yoksa statik ve bakım yolunda yük kesilir
  assert.equal(X.loadPath({ SS: 'byp', Q2: true, Q3: false }, { bypassOK: false, invOK: true }), null);
  assert.equal(X.loadPath({ SS: 'byp', Q2: false, Q3: true }, { bypassOK: false, invOK: true }), null);
  // otomatik aktarma: senkronsa kesintisiz, değilse kesintili
  assert.deepEqual(X.autoTransfer(X.BYPASS_INIT, OK), { st: { SS: 'byp', Q2: true, Q3: false }, interrupted: false });
  assert.equal(X.autoTransfer(X.BYPASS_INIT, { bypassOK: true, sync: false }).interrupted, true);
});

test('akü katsayıları: sıcaklık ve yaşlanma', () => {
  const a = X.batteryDerating({ T: 25, age: 0, designLife: 10 });
  assert.equal(a.kTemp, 1); assert.equal(a.kAge, 1);
  const b = X.batteryDerating({ T: 15, age: 0, designLife: 10 });
  assert.ok(Math.abs(b.kTemp - 0.94) < 1e-9);
  const c = X.batteryDerating({ T: 30, age: 5, designLife: 10 });
  assert.ok(Math.abs(c.lifeEff - 5) < 1e-9);       // +10 °C (20 → 30) ömrü yarıya indirir
  assert.ok(Math.abs(c.kAge - 0.8) < 1e-9);        // ömür sonunda %80
  assert.ok(Math.abs(c.kTemp - 1.03) < 1e-9);
  assert.equal(c.endOfLife, true);
  assert.equal(X.batteryDerating({ T: 60, age: 30, designLife: 10 }).kAge, 0.5);
});

test('akü boyutlandırma: 32 kW, 15 dk, 40 × 12 V', () => {
  const o = { P_kW: 32, minutes: 15, etaInv: 0.95, nBlocks: 40, Vblock: 12, dod: 0.8, kTemp: 1, kAge: 1, AhList: [7, 9, 12, 18, 26, 40, 55] };
  const r = X.batterySizing(o);
  assert.ok(Math.abs(r.Wh - 8421.05) < 0.1);
  assert.ok(Math.abs(r.AhReq - 21.93) < 0.01);
  assert.deepEqual(r.pick, { Ah: 26, strings: 1 });
  // seçilen akü engine runtime ile hedef süreyi sağlar
  const rt = E.ups.runtime({ Vbat: 480, Ah: 26, dod: 0.8, kTemp: 1, kAge: 1, P: 32000, etaInv: 0.95 });
  assert.ok(rt >= 15);
  // listede yetmezse paralel grup
  assert.deepEqual(X.batterySizing(Object.assign({}, o, { minutes: 40 })).pick, { Ah: 40, strings: 2 });
});

test('adım yük kabulü: G2 ve yük planları', () => {
  const all = X.stepLoad(X.loadSteps('all', 35.5, 141.2), 200, 'G2');
  assert.equal(all.limit, 45); assert.equal(all.ok, false);
  assert.ok(Math.abs(all.maxPct - 88.35) < 0.01);
  const two = X.stepLoad(X.loadSteps('two', 35.5, 141.2), 200, 'G2');
  assert.equal(two.ok, false);
  const three = X.stepLoad(X.loadSteps('three', 35.5, 141.2), 200, 'G2');
  assert.equal(three.ok, true);
  assert.equal(three.steps.length, 3);
  assert.ok(Math.abs(three.totalPct - 88.35) < 0.01);
  // G1 daha büyük adım kabul eder; toplam jeneratörü aşarsa red
  assert.equal(X.stepLoad([110], 200, 'G1').ok, true);
  assert.equal(X.stepLoad([100, 100, 30], 200, 'G1').ok, false);
});

test('black start planı: sıralı adımlar ve yük adımları', () => {
  const p = X.blackStartPlan({ minFuelPct: 50, tank: 400, tConfirm: 3, tGenReady: 10, tDead: 1, tReturn: 30, tCool: 60, steps: [35, 70, 70], genKVA: 200, cls: 'G2', genPct: 88 });
  assert.equal(p.length, 5 + 3 + 3);
  p.forEach((x, i) => assert.equal(x.n, i + 1));
  assert.equal(p[0].title, 'Ön kontrol');
  assert.match(p[5].title, /Yük adımı 1/);
  assert.match(p[p.length - 1].title, /Rapor/);
});

test('modüler UPS: N, N+1 ve modül kaybı (3 × 20 kVA, 32 kW)', () => {
  const base = { nMod: 3, modKVA: 20, pf: 0.9, Scrit: 32 / 0.95, Pcrit: 32, failed: 0, redundancy: 'N+1' };
  const a = X.upsModular(base);
  assert.equal(a.N, 2);                      // 32 kW / 18 kW = 1,78 → 2 modül
  assert.equal(a.need, 3);
  assert.ok(a.configOK && a.carries && a.survivesOne);
  assert.ok(Math.abs(a.perModPct - 32 / 54 * 100) < 1e-9); // kW sınırı belirleyici: %59,3
  const b = X.upsModular(Object.assign({}, base, { failed: 1 }));
  assert.equal(b.active, 2); assert.ok(b.carries); assert.equal(b.survivesOne, false);
  assert.ok(Math.abs(b.perModPct - 32 / 36 * 100) < 1e-9);  // %88,9
  const c = X.upsModular(Object.assign({}, base, { failed: 2 }));
  assert.equal(c.carries, false); assert.ok(c.perModPct > 100);
  assert.equal(X.upsModular(Object.assign({}, base, { nMod: 2 })).configOK, false); // N+1 için 3 gerekir
  assert.equal(X.upsModular(Object.assign({}, base, { nMod: 2, redundancy: 'N' })).configOK, true);
});

test('paralel jeneratörler: paylaşım, N+1 ve yakıt', () => {
  const g = X.genParallel({ nGen: 2, genKVA: 200, loadKVA: 106, loadKW: 93.7, fuel: 0.27, tankPerSet: 400 });
  assert.equal(g.totalKVA, 400);
  // kVA: 106/400 = %26,5; kW: 93,7/(400 × 0,8) = %29,28125 → büyüğü (cosφ 0,88 > 0,8 olduğundan kW sınırı belirler)
  assert.ok(Math.abs(g.perSetPct - 29.28125) < 1e-9);
  assert.equal(g.Nreq, 1); assert.equal(g.n1, true);
  // bir set kaybında: 93,7/160 = %58,5625 (kVA'ya göre yalnız %53 görünürdü)
  assert.ok(Math.abs(g.afterLossPct - 58.5625) < 1e-9);
  assert.ok(Math.abs(g.fuelPerSet - 93.7 / 2 * 0.27) < 1e-9);
  assert.ok(Math.abs(g.hours - 400 / (93.7 / 2 * 0.27)) < 1e-9);
  // engine ile tutarlılık: toplam depo / toplam tüketim = set başına süre
  const r = E.ups.compute({ Pcrit: 32, pfCrit: 0.95, Pother: 60, pfOther: 0.85, upsKVA: 60, upsPF: 0.9, etaInv: 95, nBlocks: 40, Vblock: 12, Ah: 100, strings: 1, dod: 80, kTemp: 1, kAge: 0.9, genKVA: 400, tGap: 14, fuel: 0.27, tank: 800 });
  const g2 = X.genParallel({ nGen: 2, genKVA: 200, loadKVA: r.values.genLoadKVA, loadKW: r.values.genLoadKW, fuel: 0.27, tankPerSet: 400 });
  assert.ok(Math.abs(g2.hours - r.values.fuelHours) < 1e-9);
  assert.ok(Math.abs(g2.perSetPct - r.values.genPct) < 1e-9);
  const h = X.genParallel({ nGen: 2, genKVA: 100, loadKVA: 150, loadKW: 130, fuel: 0.27, tankPerSet: 200 });
  assert.equal(h.Nreq, 2); assert.equal(h.n1, false);
  // 130 kW / 80 kWe = %162,5
  assert.ok(Math.abs(h.afterLossPct - 162.5) < 1e-9);
});

test('senkronizasyon: ölü bara serbest, canlı barada sınırlar', () => {
  assert.ok(X.canCloseGen(false, { dU: 20, df: 2, dphi: 90 }).ok);
  assert.ok(X.canCloseGen(true, { dU: 2, df: 0.1, dphi: 5 }).ok);
  const r = X.canCloseGen(true, { dU: 2, df: 0.5, dphi: 25 });
  assert.equal(r.ok, false);
  assert.deepEqual(X.syncCheck({ dU: 2, df: 0.5, dphi: 25 }).reasons.length, 2);
});
