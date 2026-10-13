'use strict';
// Kural denetiminin sınır durumları: node tools/test/unit/rules_regressions.js
const assert = require('node:assert/strict');
const S = require('../../reference2/sim2.js');
const V = require('../../reference2/solve2.js');
const T = require('../../reference2/talep2.js');
const Harness = require('./rules_lib.js');

function graph(rows, won) {
  const off = [0], to = [], cost = [], tok = [];
  for (const row of rows) { for (const e of row) { to.push(e[0]); cost.push(V.pack({ h: e[1], m: e[2], k: e[3] || 0, o: 0 })); tok.push(e[4] || 'o:Q1'); } off.push(to.length); }
  return { n: rows.length, keys: rows.map((_, i) => i), off, to, cost, tok, won };
}
const L0 = { els: [], elIndex: {}, loads: [] };
const cycle = graph([[[0, 1, 1], [1, 1, 1, 0, 'o:Q2']], []], [0, 1]);
for (const metrik of ['hamle', 'manevra', 'kesinti']) {
  assert.equal(T.solve(L0, cycle, { metrik, kisit: { yasak: ['Q2'] } }), null, 'yasak hedef ve çevrim çözümsüz olarak sona ermeli');
}
const bounded = graph([[[1, 1, 1], [2, 1, 0]], [[3, 1, 1]], [[1, 1, 0]], []], [0, 0, 0, 1]);
assert.deepEqual(T.solve(L0, bounded, { kisit: { manevraMax: 1 } }).tot, [3, 1, 0, 0], 'daha uzun ama kaynak sınırını sağlayan yol korunmalı');
assert.equal(T.solve(L0, cycle, { kisit: { agirlik: { Y1: -1 } } }), null, 'negatif ağırlıklar Dijkstra aramasına girmemeli');
const rows = Array.from({ length: 303 }, () => []), longWon = new Uint8Array(303);
rows[0].push([301, 0, 0]);
for (let i = 301; i > 1; i--) rows[i].push([i - 1, 0, 0]);
rows[1].push([302, 0, 0]); longWon[302] = 1;
assert.deepEqual(V.front(graph(rows, longWon), 'k', 0, 0), [[0, 0]], '256 adımı aşan sıfır maliyetli Pareto yolu kapanmalı');
const original = Object.fromEntries(['initState', 'key', 'won', 'succ', 'encodeAct'].map(k => [k, S[k]]));
try {
  S.initState = () => ({ p: 0 }); S.key = (_, s) => s.p; S.won = () => false; S.encodeAct = (_, s, a) => 'g' + a.to;
  for (const h of [0, 1]) {
    S.succ = (_, s) => s.p ? [] : Array.from({ length: 20 }, (_, i) => ({ a: { to: i + 1 }, s: { p: i + 1 }, c: { h } }));
    assert.deepEqual(V.solve({}, { cap: 2 }), { par: -1, unknown: true, states: 3 }, 'keşif sınırı her yeni durumda uygulanmalı');
  }
} finally { Object.assign(S, original); }

const def = {
  id: 'PULSE', map: 's#|.B', hucre: { B: 'S1' }, dugum: { A: {}, B: {} },
  el: [
    { id: 'G1', t: 'kaynak', dugum: 'A' },
    { id: 'S1', t: 'buton', a: 'A', b: 'B' },
    { id: 'C1', t: 'kondansator', dugum: 'B' },
    { id: 'Y1', t: 'yuk', dugum: 'B', zorunlu: false },
  ],
};
const L = S.compile(def), s = S.initState(L);
for (const a of [null, undefined, {}, { t: 'op' }, { t: 'kilit' }, { t: 'bas' }, { t: 'op', e: 0.5 }]) assert.equal(S.apply(L, s, a).err, 'gecersiz');
const pulse = S.apply(L, s, { t: 'bas', e: L.elIndex.S1 });
assert.equal(pulse.err, undefined);
assert.equal(S.stateE(L, pulse.s).live[L.nodeIdx.B], 0, 'buton bırakıldığında kondansatör enerjisiz');
assert.equal(pulse.s.ch, S.CH, 'kısa buton darbesi kondansatörü yükler');
assert.equal(S.apply(L, pulse.s, { t: 'bas', e: L.elIndex.S1 }).err, 'kond', 'yüklü kondansatöre yeni darbe reddedilir');
assert(T.satisfies(L, { kisit: { kesintisiz: ['Y1'] } }, '').bad.some(x => x.includes('başlangıçta')));
assert(T.satisfies(L, { kisit: { kesintisiz: ['G1'] } }, '').bad.some(x => x.includes('yük G1 yok')));
assert(T.satisfies(L, { kisit: { kesintisiz: ['UNKNOWN'] } }, '').bad.some(x => x.includes('yük UNKNOWN yok')));

const proto = S.compile({
  id: 'NAMES', map: 's#|.Q', hucre: { Q: 'constructor' },
  dugum: { constructor: {}, toString: {} },
  el: [{ id: 'constructor', t: 'kesici', a: 'constructor', b: 'toString' }],
});
assert.equal(proto.elIndex.constructor, 0);
assert.equal(proto.nodeIdx.toString, 1);
const ps = S.initState(proto), pa = S.decodeAct(proto, ps, 'o:constructor');
assert.equal(pa.e, 0);
assert.equal(S.apply(proto, ps, pa).err, undefined);

const eight = { id: 'TRIPS', map: 's#|.Q', hucre: { Q: 'Q0' }, dugum: { A: {}, BUS: {} }, el: [
  { id: 'G1', t: 'kaynak', dugum: 'A' }, { id: 'Q0', t: 'kesici', a: 'A', b: 'BUS' },
] };
for (let i = 1; i <= 8; i++) {
  eight.dugum['B' + i] = {};
  eight.el.push({ id: 'Q' + i, t: 'kesici', a: 'BUS', b: 'B' + i, kapali: true, I: 1 }, { id: 'F' + i, t: 'ariza', dugum: 'B' + i });
}
const E8 = S.compile(eight), s8 = S.initState(E8), tripped = S.apply(E8, s8, { t: 'op', e: E8.elIndex.Q0 });
assert.equal(tripped.c.o, 8);
assert.equal(V.O(V.pack(tripped.c)), 8, 'eşzamanlı sekiz koruma açması yediye kırpılmamalı');
assert.equal(Harness.loadWorker().api.weight(3, V.pack(tripped.c)), 8 * Harness.loadWorker().api.SCALE + 1);
assert.equal(V.K(V.pack({ h: 1, m: 0, o: 31, k: 0xffffff })), 0xffffff, 'yüksek Kesinti işaretli tamsayı taşmasından etkilenmemeli');
assert.throws(() => S.compile({ id: 'BITS', map: 's', dugum: { A: {}, B: {} }, el: Array.from({ length: 32 }, (_, i) => ({ id: 'Q' + i, t: 'kesici', a: 'A', b: 'B' })) }), /bit maskesi kapasitesi/);
(async () => {
  const worker = Harness.loadWorker();
  worker.api.build('SAME', def);
  const changed = { id: 'OTHER', map: 's', el: [], dugum: {} };
  const use = await worker.request({ t: 'use', req: 1, id: 'SAME', def: changed });
  assert.equal(use.rebuilt, true, 'aynı kimlikte değişen tanım eski Worker grafını kullanmamalı');
  assert.equal(worker.api.cache.get('SAME').def.map, 's');

  const savedWorker = global.Worker;
  global.Worker = class { constructor() { throw new Error('worker denied'); } };
  const PX = { SIM: S, WORKER_SRC: '', bus: Harness.fakeBus() };
  Harness.loadModule('core/solverClient.js', PX);
  assert.equal(await PX.solver.load('STARTFAIL', changed), null, 'Worker kurulamazsa yükleme null ile tamamlanmalı');
  assert.equal(PX.solver.status, 'error');
  assert.match(PX.solver.info().err, /worker denied/);
  PX.solver.cancel(); global.Worker = savedWorker;
  console.log('rules_regressions: talep, darbe şarjı, geçersiz komut, kimlik, Worker önbelleği ve başlatma hatası kontrolleri geçti');
})().catch(e => { console.error(e); process.exitCode = 1; });
