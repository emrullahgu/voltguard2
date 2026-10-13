'use strict';
// Kurallar: PX.solver + PX.hint birim/entegrasyon testi (Node; sahte Worker aynı worker_src.js'i eşzamansız çalıştırır).
//  node tools/test/unit/rules_client.js [--show]   (--show: ipucu metinlerini yazdırır)
const T = require('./rules_lib.js');
const { S, ok } = T;
const SHOW = process.argv.includes('--show');
const LEVELS = T.allLevels().filter(l => l.bolum <= 3);

// ---- sahte tarayıcı ortamı
let liveWorkers = 0, abParts = 0;
class FakeWorker {
  constructor() {
    this.w = T.loadWorker(); this.dead = false; liveWorkers++;
    this.w.out.push = msg => { setTimeout(() => { if (!this.dead && this.onmessage) this.onmessage({ data: msg }); }, 0); return 0; };
  }
  postMessage(m) { const c = structuredClone(m); setTimeout(() => { if (!this.dead) this.w.send(c); }, 0); }
  terminate() { if (!this.dead) liveWorkers--; this.dead = true; }
}
global.Worker = FakeWorker; global.Blob = class { constructor(a) { this.a = a; } }; global.URL.createObjectURL = () => 'blob:x';
const PX = { SIM: S, bus: T.fakeBus(), LEVELS, DAILY: [], WORKER_SRC: '',
  STR: { hesaplaniyor: 'Hesaplanıyor…', cikmaz: 'Çıkmaz', geriAl: 'Geri Al', ipucu1: 'Kural dürtmesi', ipucu2: 'Hayalet adım', ERR: Object.assign({}, S.ERR), dogrulanamadi: S.ERR.dogrulanamadi } };
const game = { L: null, s: null, level: null, hist: [], won: false };
PX.game = { get L() { return game.L; }, get level() { return game.level; }, state() { return { s: game.s, won: game.won }; }, tokens() { return game.hist.join(' '); } };
T.loadModule('core/solverClient.js', PX); T.loadModule('game/hint.js', PX); T.loadModule('meta/ghost.js', PX);
function setLevel(lv) { game.level = lv; game.L = S.compile(lv.def); game.s = S.initState(game.L); game.hist = []; game.won = false; PX.bus.emit('level:loaded', { id: lv.id, level: lv }); }
function act(tok) { const a = S.decodeAct(game.L, game.s, tok); const r = S.apply(game.L, game.s, a); if (r.err) throw new Error('ret ' + tok + ' ' + r.err); game.s = r.s; game.hist.push(tok); game.won = S.won(game.L, game.s); return r.c; }
const ORD = { hamle: ['h', 'm'], manevra: ['m', 'h'], kesinti: ['k', 'h'], olay: ['o', 'h'] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1) yükleme, tablolar, metrik başına uzaklık
  for (const lv of LEVELS) {
    setLevel(lv);
    const r = await PX.solver.load(lv.id, lv.def);
    ok(r && r.states === lv.kanit.states, `${lv.id}: load durum sayısı ${r && r.states} != ${lv.kanit.states}`);
    ok(PX.solver.ready && PX.solver.status === 'ready', `${lv.id}: ready`);
    const o = lv.kanit.opt;
    ok(PX.solver.dist(game.s) === o.hamle[0], `${lv.id}: dist(s0)=${PX.solver.dist(game.s)} != par ${o.hamle[0]}`);
    const dk = PX.solver.distM(game.s, 'kesinti'), dm = PX.solver.distM(game.s, 'manevra');
    ok(dk && dk.p === o.kesinti[2] && dk.s === o.kesinti[0], `${lv.id}: distM kesinti ${JSON.stringify(dk)} != [${o.kesinti[2]},${o.kesinti[0]}]`);
    ok(dm && dm.p === o.manevra[1] && dm.s === o.manevra[0], `${lv.id}: distM manevra ${JSON.stringify(dm)}`);
    // 2) ipucu zinciri her metrikte optimuma götürür (segment segment)
    for (const metric of PX.solver.METRICS) {
      setLevel(lv); await PX.solver.load(lv.id, lv.def);
      const tot = { h: 0, m: 0, k: 0, o: 0 }; let guard = 0, emptyWhy = 0;
      while (!game.won && guard++ < 200) {
        const h = await PX.solver.hint(game.s, 1, metric);
        if (!h.acts.length) break; if (!h.why) emptyWhy++;
        if (SHOW && (metric === 'hamle' || (metric === 'kesinti' && lv.sinif === 'zor'))) console.log(`    [${lv.id}/${metric}] ${h.why}`);
        for (const t of h.acts) { const c = act(t); tot.h += c.h; tot.m += c.m; tot.k += c.k; tot.o += c.o; }
      }
      const v = o[metric]; const vec = { h: v[0], m: v[1], k: v[2], o: v[3] }; const [a, b] = ORD[metric];
      ok(game.won && tot[a] === vec[a] && tot[b] === vec[b], `${lv.id}: ${metric} ipucu zinciri ${JSON.stringify(tot)} hedef ${JSON.stringify(vec)} won=${game.won}`);
      ok(emptyWhy === 0, `${lv.id}: ${metric} boş ipucu metni ${emptyWhy}`);
    }
    // 3) soyut ipucu: bütçe içinde bir eylem önerir (asla çıkmaz demez)
    setLevel(lv);
    const t0 = performance.now(); const ah = PX.solver.abstractHint(game.s); const ms = performance.now() - t0;
    if (ms > 60) console.log(`  (not) ${lv.id}: soyut ipucu ${ms.toFixed(0)} ms (bütçe 12 ms; Node'da sahte Worker aynı yığında — GC/makine yükü)`);
    ok(ah && (ah.el || ah.tok || ah.partial) && !/Çıkmaz/.test(ah.why), `${lv.id}: soyut ipucu ${JSON.stringify(ah && { el: ah.el, tok: ah.tok, why: ah.why })} ${ms.toFixed(1)} ms`);
    if (SHOW) console.log(`    [${lv.id}] soyut: ${ah.why} (${ms.toFixed(1)} ms${ah.partial ? ', kısmi' : ''})`);
    // bütçe dolduysa arama arka planda sürer ve sonuç later ile gelir; bulunan eylem gerçekten yasal bir ilk adım olmalı
    const fin = ah.partial ? await ah.later : ah;
    ok(!ah.partial || typeof (ah.later && ah.later.then) === 'function', `${lv.id}: kısmi soyut ipucu later taşır`);
    ok(fin && (fin.el || fin.tok) && /Sıradaki/.test(fin.why), `${lv.id}: soyut ipucu arka planda tamamlanır ${JSON.stringify(fin && fin.why)}`);
    const again = PX.solver.abstractHint(game.s); ok(again === fin, `${lv.id}: soyut ipucu sonucu önbellekte`);
    if (ah.partial) abParts++;
  }
  // 4) eski sonuç koruması + iptal + önbellek
  const big = LEVELS.find(l => l.id === 'T2') || LEVELS[LEVELS.length - 1], small = LEVELS[0];
  PX.solver.cancel();
  setLevel(big); const pBig = PX.solver.load(big.id, big.def);
  setLevel(small); const pSmall = PX.solver.load(small.id, small.def);
  const [rb, rs] = await Promise.all([pBig, pSmall]);
  ok(rb === null, 'iptal edilen yükleme null döner');
  ok(rs && PX.solver.id === small.id && PX.solver.ready, 'yeni yükleme etkin');
  ok(PX.solver.dist(game.s) === small.kanit.opt.hamle[0], 'iptalden sonra doğru tablo');
  setLevel(big); const r2 = await PX.solver.load(big.id, big.def); ok(r2 && r2.states === big.kanit.states, 'T2 hesaplandı');
  setLevel(small); const r3 = await PX.solver.load(small.id, small.def); ok(r3 && r3.cached, 'P1 önbellekten');
  setLevel(big); const r4 = await PX.solver.load(big.id, big.def); ok(r4 && r4.cached && PX.solver.dist(game.s) === big.kanit.opt.hamle[0], 'T2 önbellekten + doğru');
  const hh = await PX.solver.hint(game.s, 1, 'hamle'); ok(hh.acts.length > 0 && !hh.stale, 'önbellekten etkin seviyede ipucu');
  const hp = PX.solver.hint(game.s, 1, 'hamle'); setLevel(small); PX.solver.load(small.id, small.def); const hs = await hp;
  ok(hs.stale === true, 'seviye değişince eski ipucu stale');
  // önceden hesaplama + bağlanma (aynı seviye yüklenirse terminate edilmez, ikinci hesap yok)
  PX.solver.cancel(); PX.solver.flush();
  const nxt = LEVELS.find(l => l.id === 'F2') || big;
  const nStats = PX.solver.stats().filter(x => x.id === nxt.id && x.kind !== 'cache').length;
  const pf = PX.solver.prefetch(nxt.id, nxt.def); setLevel(nxt); const pl = PX.solver.load(nxt.id, nxt.def);
  const [rpf, rpl] = await Promise.all([pf, pl]);
  ok(rpf === null && rpl && rpl.states === nxt.kanit.states && PX.solver.ready, 'önceden hesaplanan seviyeye bağlanma');
  ok(PX.solver.stats().filter(x => x.id === nxt.id && x.kind !== 'cache').length === nStats + 1, 'bağlanmada ikinci hesap yok');
  // kazanınca sonraki seviye önceden hesaplanır
  PX.bus.emit("win", { id: LEVELS[0].id }); for (let w = 0; w < 100 && !PX.solver.info().cached.includes(LEVELS[1].id); w++) await sleep(100);
  ok(PX.solver.info().cached.includes(LEVELS[1].id), 'win -> sonraki seviye önbellekte ' + JSON.stringify(PX.solver.info().cached) + ' ' + JSON.stringify(PX.solver.stats().slice(-3)));
  // 5) PX.hint.request: used bayrağı, metrik, çıkmaz ücretsiz
  const M1 = LEVELS.find(l => l.id === 'M1') || LEVELS[1];
  setLevel(M1); await PX.solver.load(M1.id, M1.def);
  ok(PX.hint.used === false, 'used başlangıçta false');
  const h1 = await PX.hint.request(1); ok(h1 && h1.acts.length && PX.hint.used, 'request(1) -> used');
  PX.bus.emit('reset', {}); ok(PX.hint.used === false, 'reset used temizler');
  ok(PX.hint.setMetric('kesinti') && PX.hint.metric === 'kesinti' && !PX.hint.setMetric('x'), 'metrik seçimi');
  PX.hint.setMetric('hamle');
  const h2 = await PX.hint.request(2); ok(h2 && h2.acts.length && /Hayalet adım/.test(h2.why), 'request(2) hayalet adım: ' + (h2 && h2.why));
  ok(PX.bus.log.some(([t]) => t === 'ghost:start'), 'tier 2 hayalet oynatmayı başlatır');
  PX.ghost.stop();
  let deadFound = false;
  for (const lv of LEVELS) {
    let seed = 7;
    for (let k = 0; k < 60 && !deadFound; k++) {
      setLevel(lv); await PX.solver.load(lv.id, lv.def);
      for (let j = 0; j < 40 && !game.won; j++) {
        const sc = S.succ(game.L, game.s); if (!sc.length) break; seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const m = sc[seed % sc.length]; act(S.encodeAct(game.L, game.s, m.a));
        if (PX.solver.dist(game.s) === -1) { deadFound = true; break; }
      }
    }
    if (deadFound) {
      const before = PX.hint.used; const r = await PX.hint.request(1);
      ok(r.dead && r.undo >= 1 && PX.hint.used === before, `çıkmaz ipucu ücretsiz ve geri alma sayısı veriyor (${lv.id}: ${r.why})`);
      if (SHOW) console.log('    çıkmaz: ' + r.why);
      break;
    }
  }
  if (!deadFound) console.log('  (not) R1 seviyelerinde rastgele yürüyüşle çıkmaz bulunamadı (kanıt: çıkmaz kesri 0) — çıkmaz testi atlandı');
  ok(liveWorkers <= 1, 'en çok bir canlı Worker (' + liveWorkers + ')');
  console.log('  soyut ipucu: ' + abParts + ' seviyede bütçe doldu, arka planda tamamlandı');
  T.done('rules_client');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
