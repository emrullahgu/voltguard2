'use strict';
// Kurallar: Worker gövdesi birim testi (Node). node tools/test/unit/rules_worker.js [--id P1,T2]
//  - tipli keşif == solve2.explore (durum sırası, kenarlar, maliyetler, simgeler, kazanma bayrakları)
//  - Hamle Uint8 tablosu == solve2.toGoal; kesinti/manevra/olay tabloları == solve2.toGoalLex (ilk iki bileşen)
//  - plan(metrik) başlangıçtan kazanır ve damgalı optimumun ilk iki bileşenini verir; her ara durumdan da optimal kalır
//  - hash araması tüm anahtarlar için doğru; bilinmeyen anahtar -1; ready mesajı tabloları doğru dışa aktarır
const T = require('./rules_lib.js');
const { S, V, ok } = T;
const ids = (process.argv.find(a => a.startsWith('--id=')) || '').slice(5).split(',').filter(Boolean);
const W = T.loadWorker(); const A = W.api;
const ORD = { hamle: ['h', 'm'], manevra: ['m', 'h'], kesinti: ['k', 'h'], olay: ['o', 'h'] };
(async () => {
for (const lv of T.allLevels()) {
  if (ids.length && !ids.includes(lv.id)) continue;
  const L = S.compile(lv.def), G = A.exploreAll(L);
  const R = V.explore(S.compile(lv.def), 4e5);
  ok(G.n === R.n && G.m === R.to.length, `${lv.id}: durum/kenar ${G.n}/${G.m} != ${R.n}/${R.to.length}`);
  let bad = 0;
  for (let i = 0; i < G.n && bad < 3; i++) if (G.keys[i] !== R.keys[i] || G.won[i] !== R.won[i] || G.off[i] !== R.off[i]) { bad++; ok(false, `${lv.id}: durum ${i} farklı`); }
  for (let e = 0; e < G.m && bad < 3; e++) if (G.to[e] !== R.to[e] || G.cost[e] !== R.cost[e] || A.tokOf(L, G.act[e]) !== R.tok[e]) { bad++; ok(false, `${lv.id}: kenar ${e} farklı (${A.tokOf(L, G.act[e])} vs ${R.tok[e]})`); }
  ok(bad === 0, `${lv.id}: keşif eşdeğerliği`);
  // hash
  let hb = 0; for (let i = 0; i < G.n; i++) if (A.lookup(G, G.keys[i]) !== i) hb++;
  ok(hb === 0 && A.lookup(G, 2 ** 52 + 7) === -1 && A.lookup(G, 123456789.0 * 3 + 1e12) === -1, `${lv.id}: hash araması (${hb} hata)`);
  // tablolar
  A.tables(G);
  const tg = V.toGoal(R); let tb = 0;
  for (let i = 0; i < G.n; i++) { const want = tg.dist[i] < 0 ? 255 : Math.min(254, tg.dist[i]); if (G.dH[i] !== want) tb++; }
  ok(tb === 0, `${lv.id}: Hamle tablosu ${tb} durumda farklı`);
  for (const [mi, name] of A.METRICS.entries()) {
    const lx = V.toGoalLex(R, name); let lb = 0;
    for (let i = 0; i < G.n; i++) { const d = G.D[mi][i]; const r = lx[i]; if (r === null ? d !== Infinity : d !== r[0] * A.SCALE + r[1]) lb++; }
    ok(lb === 0, `${lv.id}: ${name} tablosu ${lb} durumda solve2.toGoalLex'ten farklı`);
  }
  // plan: başlangıçtan ve rastgele ara durumlardan
  const k = lv.kanit || {};
  for (const [mi, name] of A.METRICS.entries()) {
    const pl = A.planFrom(G, 0, mi, 500);
    const str = pl.map(e => A.tokOf(L, G.act[e])).join(' ');
    const rp = S.replay(S.compile(lv.def), str);
    ok(rp.ok && rp.won, `${lv.id}: ${name} planı kazanmıyor: ${rp.err} @${rp.at}`);
    if (k.opt && k.opt[name]) { const o = k.opt[name]; const vec = { h: o[0], m: o[1], k: o[2], o: o[3] };
      const [a, b] = ORD[name]; ok(rp.tot[a] === vec[a] && rp.tot[b] === vec[b], `${lv.id}: ${name} planı ${a}/${b}=${rp.tot[a]}/${rp.tot[b]} damga ${vec[a]}/${vec[b]}`); }
    // ara durumlar: plan uzunluğu tablo değeriyle tutarlı
    let ib = 0;
    for (let t = 0; t < 40; t++) {
      const u = (t * 7919 + 13) % G.n; if (G.D[mi][u] === Infinity) continue;
      const p2 = A.planFrom(G, u, mi, 600); let sum = 0, x = u;
      for (const e of p2) { sum += A.weight(mi, G.cost[e]); x = G.to[e]; }
      if (!G.won[x] || sum !== G.D[mi][u]) ib++;
    }
    ok(ib === 0, `${lv.id}: ${name} ara durum planları ${ib} kez tutarsız`);
  }
  // mesaj düzeyi
  const r = await W.request({ t: 'load', req: 9, id: lv.id, gen: 1, def: lv.def });
  ok(r.t === 'ready' && r.states === G.n && r.dH.length === G.n && r.tab.kesinti[0].length === G.n, `${lv.id}: ready mesajı`);
  const h = W.send({ t: 'hint', req: 10, id: lv.id, key: G.keys[0], metric: 'kesinti', tier: 1 });
  ok(h.t === 'hint' && !h.dead && !h.miss && h.acts.length >= 1 && h.plan.length >= h.acts.length, `${lv.id}: hint mesajı`);
  ok(h.acts.slice(0, -1).every(t => /^(g\d+|d[+-])$/.test(t)) && !/^(g\d+|d[+-])$/.test(h.acts[h.acts.length - 1]), `${lv.id}: segment = gezinme + tek eylem (${h.acts.join(' ')})`);
  let uk = 1; while (A.lookup(G, uk) >= 0) uk++;
  const hm = W.send({ t: 'hint', req: 11, id: lv.id, key: uk, metric: 'hamle', tier: 1 });
  ok(hm.miss === true, `${lv.id}: bilinmeyen anahtar miss`);
  console.log(`  ${lv.id}: ${G.n} durum, ${G.m} kenar — tamam`);
}
// sınır ve hata yolları
const bad = await W.request({ t: 'load', req: 1, id: 'X', gen: 1, def: { id: 'X', map: '#', hucre: {} } });
ok(bad.t === 'error' && bad.code === 'derleme', 'derlenemeyen seviye -> error/derleme');
const unk = W.send({ t: 'nope', req: 2 });
ok(unk.t === 'error', 'bilinmeyen mesaj -> error');
// işbirlikli iptal: büyük seviye sürerken başka seviye yüklenir -> eski istek 'iptal', yeni tamam, Worker aynı
const LV = T.allLevels(); const big = LV.reduce((a, b) => (b.kanit.states > a.kanit.states ? b : a)), small = LV.reduce((a, b) => (b.kanit.states < a.kanit.states ? b : a));   // kural sürümü 4: en büyük/en küçük dönüştürülmüş seviye
W.send({ t: 'drop', req: 30 });
const pBig = W.request({ t: 'load', req: 31, id: big.id, gen: 2, def: big.def });
await new Promise(r => setTimeout(r, 30));
const pSmall = W.request({ t: 'load', req: 32, id: small.id, gen: 3, def: small.def });
const [rb, rs] = await Promise.all([pBig, pSmall]);
ok(rb.t === 'error' && rb.code === 'iptal' && rs.t === 'ready' && rs.states === small.kanit.states, 'işbirlikli iptal: ' + rb.code + '/' + rs.t);
// aynı seviyeye iki istek: tek hesap, iki yanıt
W.send({ t: 'drop', req: 33 });
const [a1, a2] = await Promise.all([W.request({ t: 'load', req: 34, id: big.id, gen: 4, def: big.def }), W.request({ t: 'load', req: 35, id: big.id, gen: 5, def: big.def })]);
ok(a1.t === 'ready' && a2.t === 'ready' && a1.states === a2.states && a1.ms.slices > 1, 'iki bekleyen tek iş; dilim sayısı ' + a1.ms.slices);
const c1 = await W.request({ t: 'load', req: 36, id: big.id, gen: 6, def: big.def }); ok(c1.cached === true, 'Worker önbelleği');
const png = W.send({ t: 'ping', req: 37 }); ok(png.t === 'pong' && png.busy === false, 'ping');
T.done('rules_worker');
process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
