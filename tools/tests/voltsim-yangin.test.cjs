'use strict';

// VoltSim yangın ek hesapları (js/voltsim/calc/yangin.js): bilinen değer testleri.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Y = require(path.join(__dirname, '../../js/voltsim/calc/yangin.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' beklenen ' + b + ', bulunan ' + a);

test('dedektör yanıtı: eşik duyarlılıkla ölçeklenir, ısı dedektörü gecikmelidir', () => {
  near(Y.detectorResponse('optik', 'normal').threshold, 0.06);
  near(Y.detectorResponse('optik', 'yuksek').threshold, 0.036);
  near(Y.detectorResponse('beam', 'dusuk').threshold, 0.0525);
  assert.equal(Y.detectorResponse('isi', 'normal').tau, 40);
  assert.equal(Y.detectorResponse('optik', 'normal').tau, 0);
  assert.throws(() => Y.detectorResponse('lazer', 'normal'));
});

test('birinci derece gecikme: t = τ’da %63,2', () => {
  near(Y.lag(0, 1, 40, 40), 1 - Math.exp(-1), 1e-12);
  near(Y.lag(0.3, 0.5, 1, 0), 0.5);
  near(Y.lag(0, 1, 0, 40), 0);
});

test('kapsama yarıçapı (eğitim örneği) ve yükseklik sınırı', () => {
  assert.deepEqual(Y.coverageRadius('optik', 8), { r: 7.5, ok: true, hMax: 10.5 });
  assert.equal(Y.coverageRadius('isi', 8).ok, false);
  assert.equal(Y.coverageRadius('isi', 6).r, 5.3);
});

test('kapsama oranı: nokta ve ışın dedektörleri', () => {
  const cells = [[0, 0], [1, 0], [5, 0], [5, 3]];
  near(Y.coverageFraction(cells, [{ x: 0, y: 0, r: 1.5 }]), 0.5);
  near(Y.coverageFraction(cells, [{ beam: true, x0: 0, x1: 6, y: 0, r: 1 }]), 0.75);
  near(Y.coverageFraction(cells, []), 0);
  near(Y.coverageFraction([], [{ x: 0, y: 0, r: 9 }]), 0);
});

test('uzaklık alanı: duvar kapısından dolaşan en kısa yol, köşe kesilmez', () => {
  // 5×3 ızgara, x = 2 sütununda y = 0 ve 1 duvar (kapı y = 2), çıkış (0,0)
  const w = 5, h = 3, b = new Uint8Array(w * h); b[2] = 1; b[w + 2] = 1;
  const d = Y.distanceField(w, h, b, [0]);
  assert.equal(d[0], 0);
  near(d[1], 1); near(d[w + 1], Math.SQRT2);
  near(d[4], 4 + 2 * Math.SQRT2, 1e-9, '(4,0)');
  assert.equal(d[2], Infinity, 'duvar hücresi');
  // yol izleme: her adımda uzaklık azalır ve çıkışa varılır
  let i = 4, n = 0;
  while (d[i] > 0 && n < 20) { const j = Y.nextCell(d, w, h, b, i); assert.ok(j >= 0 && d[j] < d[i]); i = j; n++; }
  assert.equal(i, 0);
});

test('uzaklık alanı: kapalı çıkışta yeniden yönlendirme ve ulaşılamayan bölge', () => {
  const w = 6, h = 1, b = new Uint8Array(w);
  const both = Y.distanceField(w, h, b, [0, 5]);
  assert.equal(Y.nextCell(both, w, h, b, 1), 0, 'yakın çıkışa');
  const one = Y.distanceField(w, h, b, [5]); // sol çıkış dumanla kapandı
  assert.equal(Y.nextCell(one, w, h, b, 1), 2, 'uzak çıkışa yönlenir');
  near(one[1], 4);
  b[3] = 1; const cut = Y.distanceField(w, h, b, [5]);
  assert.equal(cut[1], Infinity); assert.equal(Y.nextCell(cut, w, h, b, 1), -1);
  // duman cezası: maliyetli hücre yolu uzatır
  const smoky = Y.distanceField(3, 1, new Uint8Array(3), [0], j => (j === 1 ? 4 : 0));
  near(smoky[2], 5 + 1);
});

test('olay zaman çizelgesi: sıralama, etiket ve ilk zamanlar', () => {
  const tl = Y.timeline([{ t: 40, kind: 'alarm', text: 'a' }, { t: 0, kind: 'fire', text: 'f' }, { t: 31, kind: 'detect', text: 'd1' }, { t: 31, kind: 'prealarm', text: 'p' }, { t: 35, kind: 'detect', text: 'd2' }]);
  assert.deepEqual(tl.rows.map(r => r.kind), ['fire', 'detect', 'prealarm', 'detect', 'alarm']);
  assert.equal(tl.rows[2].label, 'Ön alarm');
  assert.deepEqual(tl.first, { fire: 0, detect: 31, prealarm: 31, alarm: 40 });
  assert.equal(Y.clock(75.4), '01:15');
  assert.equal(Y.clock(-3), '00:00');
});

test('döngü: izolatör düğümleri', () => {
  assert.deepEqual(Y.isolatorNodes(25, 'yok'), []);
  assert.deepEqual(Y.isolatorNodes(25, 10), [10, 20]);
  assert.deepEqual(Y.isolatorNodes(3, 'her'), [1, 2, 3]);
});

test('döngü: kısa devre — izolatörsüz tüm döngü, izolatörle yalnız iki izolatör arası kaybolur', () => {
  // 20 cihaz, 7 ile 8 arasında kısa devre
  assert.equal(Y.loopLoss(20, { kind: 'short', seg: 7 }, { classA: true, iso: [] }).lost.length, 20);
  const r = Y.loopLoss(20, { kind: 'short', seg: 7 }, { classA: true, iso: [5, 10, 15] });
  assert.deepEqual(r.lost, [6, 7, 8, 9]);
  assert.deepEqual(r.dead, [5, 6, 7, 8, 9]);
  // her cihazda izolatör: kayıp yok
  assert.deepEqual(Y.loopLoss(20, { kind: 'short', seg: 7 }, { classA: true, iso: Y.isolatorNodes(20, 'her') }).lost, []);
  // panel çıkışında kısa devre (bölüm 0), ilk izolatör 5. cihaz: 1–4 kaybolur
  assert.deepEqual(Y.loopLoss(20, { kind: 'short', seg: 0 }, { classA: true, iso: [5, 10, 15] }).lost, [1, 2, 3, 4]);
  // radyal (sınıf B): kısa devrenin ötesi de kaybolur
  assert.equal(Y.loopLoss(20, { kind: 'short', seg: 7 }, { classA: false, iso: [5, 10, 15] }).lost.length, 15);
});

test('döngü: açık devre — sınıf A kayıpsız, sınıf B kopukluğun ötesi', () => {
  assert.deepEqual(Y.loopLoss(12, { kind: 'open', seg: 4 }, { classA: true, iso: [] }), { lost: [], dead: [4] });
  assert.deepEqual(Y.loopLoss(12, { kind: 'open', seg: 9 }, { classA: false, iso: [] }).lost, [10, 11, 12]);
  assert.deepEqual(Y.loopLoss(12, null, {}), { lost: [], dead: [] });
  assert.throws(() => Y.loopLoss(5, { kind: 'toprak', seg: 1 }, {}));
});

test('döngü: en kötü kayıp ve 32 cihaz kuralı (bilgi)', () => {
  assert.equal(Y.worstLoss(60, 'short', { classA: true, iso: [] }), 60);
  assert.equal(Y.worstLoss(60, 'short', { classA: true, iso: Y.isolatorNodes(60, 10) }), 9);
  assert.equal(Y.worstLoss(60, 'open', { classA: true, iso: [] }), 0);
  assert.equal(Y.worstLoss(60, 'open', { classA: false, iso: [] }), 60);
});

test('döngü: adres atama ve etiket', () => {
  const a = Y.assignLoops(7, 2);
  assert.deepEqual(a.map(x => x.loop), [1, 1, 1, 1, 2, 2, 2]);
  assert.deepEqual(a.map(x => x.seq), [1, 2, 3, 4, 1, 2, 3]);
  assert.equal(Y.address(2, 7), 'L2-007');
  assert.equal(Y.assignLoops(300, 1).length, 300, 'sabit üst sınır yok');
});
