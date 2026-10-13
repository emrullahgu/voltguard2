'use strict';
// Kurallar: headless Chrome ölçümü + duman testi (telefon 375x667 DPR2 dokunma).
//   node tools/test/unit/rules_browser.js [--file dev/v2-rules.html] [--cpu=1,4] [--reps=3] [--levels=P1,T2] [--shots]
// Ölçer (her kanıt seviyesi, CPU 1× ve 4×):
//   cold  = yeni Worker (soğuk JIT): PX.solver.load çağrısı -> söz çözülene kadar duvar saati, Worker içi süre
//   warm  = aynı Worker, önbellek boşaltılmış (sıcak JIT)
//   game  = Game.load(id) -> 'solver:ready' (oyuncunun gördüğü; flow paketinin ölçtüğü)
// Denetler: lamba 'ok', dist(s0) = par, 10 000 dist() okuması süresi ve ayırması, ipucu düğmesi metni, hayalet adım,
//   meydan okuma kodu doğrulama, uzun görev (> 50 ms) yok, konsol hatası yok.
const path = require('path');
const fs = require('fs');
const cdp = require('../cdp.js');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'tools', 'test', 'out');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); if (a) return a.slice(k.length + 3); const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const FILE = path.resolve(arg('file', path.join(ROOT, 'dev', 'v2-rules.html')));
const CPUS = arg('cpu', '1,4').split(',').map(Number);
const REPS = +arg('reps', 3);
const ONLY = (arg('levels', '') || '').split(',').filter(Boolean);
const SHOTS = process.argv.includes('--shots');
const PHONE = { width: 375, height: 667, mobile: true, touch: true, dpr: 2 };
const INIT = `window.__PX_TEST__ = true; window.__lt = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}`;
const os = require('os');
// makine geneli CPU doluluğu (%), os.cpus() boşta süre farkından
function machineBusy(prev) { const c = os.cpus(); let idle = 0, tot = 0; for (const x of c) { idle += x.times.idle; for (const k in x.times) tot += x.times[k]; }
  if (!prev) return { idle, tot }; return Math.round(100 * (1 - (idle - prev.idle) / Math.max(1, tot - prev.tot))); }
// yalıtılmış ölçüm sayfası: soğuk = her tekrar yeni Worker; sıcak = aynı Worker, önce P1 kurulur, önbellek boşaltılır
const BENCH_JS = `
const SRC = __SRC__, LV = __LV__;
let url = URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' })), req = 0;
function ask(w, msg) { return new Promise(res => { const r = ++req; msg.req = r; const h = e => { if (e.data.req === r) { w.removeEventListener('message', h); res(e.data); } }; w.addEventListener('message', h); w.postMessage(msg); }); }
async function one(w, lv) { const t0 = performance.now(); const m = await ask(w, { t: 'load', id: lv.id, gen: 1, def: lv.def }); return { wall: performance.now() - t0, m }; }
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
window.bench = async (id, reps) => {
  const lv = LV.find(l => l.id === id); const cold = [], coldW = [], warm = [], warmW = [], exp = [], tab = []; let states = 0, okc = true;
  for (let k = 0; k < reps; k++) {
    const w = new Worker(url); const a = await one(w, lv); cold.push(a.wall); coldW.push(a.m.ms.total); states = a.m.states; okc = okc && a.m.states === lv.states;
    await ask(w, { t: 'drop' }); await one(w, LV[0]); await ask(w, { t: 'drop' });
    const b = await one(w, lv); warm.push(b.wall); warmW.push(b.m.ms.total); exp.push(b.m.ms.explore); tab.push(b.m.ms.tables); okc = okc && b.m.states === lv.states;
    w.terminate();
  }
  const R = x => Math.round(x);
  return { id, states, ok: okc, coldWall: R(med(cold)), coldMin: R(Math.min(...cold)), coldWorker: R(med(coldW)), warmWall: R(med(warm)), warmMin: R(Math.min(...warm)), warmWorker: R(med(warmW)),
    explore: R(med(exp)), tables: R(med(tab)), coldMax: R(Math.max(...cold)), warmMax: R(Math.max(...warm)) };
};
// CPU kısıtlaması Worker'a uygulanıyor mu: Worker'da ve ana iş parçacığında sabit döngü (en iyi 7 deneme, ms)
const LOOP = 'let best = 1e9; for (let k = 0; k < 7; k++) { const t = performance.now(); let x = 0; for (let i = 0; i < 4e6; i++) x = (x + Math.imul(i, 2654435761)) | 0; best = Math.min(best, performance.now() - t + (x & 0)); }';
window.calib = async () => {
  const w = new Worker(URL.createObjectURL(new Blob(['onmessage = () => { ' + LOOP + ' postMessage(best); };'], { type: 'text/javascript' })));
  const wr = await new Promise(res => { w.onmessage = e => res(e.data); w.postMessage(0); }); w.terminate();
  const main = new Function(LOOP + ' return best;')();
  return { worker: Math.round(wr * 10) / 10, main: Math.round(main * 10) / 10 };
};`;
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN; };
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };

(async () => {
  const page = await cdp.launch(PHONE);
  try {
    // --- 0) YALITILMIŞ Worker ölçümü: aynı PX.WORKER_SRC, çizim yok (SwiftShader WebGL'i CPU'yu paylaşmaz)
    if (!process.argv.includes('--no-isolated')) {
      const html = fs.readFileSync(FILE, 'utf8');
      const ws = html.indexOf('window.PX.WORKER_SRC = ') + 'window.PX.WORKER_SRC = '.length;
      const NL = String.fromCharCode(10), SC = '<' + '/';
      const wsrc = JSON.parse(html.slice(ws, html.indexOf(';' + NL + '//#WORKER-END', ws)));
      const ls = html.indexOf('window.PX.LEVELS = ') + 'window.PX.LEVELS = '.length;
      const lvls = JSON.parse(html.slice(ls, html.indexOf(';' + NL + 'window.PX.DAILY', ls)));
      const esc = o => JSON.stringify(o).split(SC).join('<' + '\\/');
      const bench = path.join(OUT, 'rules-worker-bench.html'); fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(bench, '<!doctype html><meta charset="utf-8"><title>worker bench</title><body><script>' +
        BENCH_JS.replace('__SRC__', () => esc(wsrc)).replace('__LV__', () => esc(lvls.map(l => ({ id: l.id, def: l.def, states: l.kanit && l.kanit.states })))) + SC + 'script>');
      await page.goto(bench); await page.waitFor('window.bench', 10000, 50);
      const iso = [];
      for (const cpu of CPUS) {
        await page.setCPUThrottle(cpu); const b0 = machineBusy();
        console.log('  kalibrasyon ' + cpu + 'x (sabit döngü, en iyi 7, ms): ' + JSON.stringify(await page.evaluate('calib()', 120000)));
        const ids = (ONLY.length ? ONLY : lvls.map(l => l.id));
        for (const id of ids) {
          const r = await page.evaluate(`bench(${JSON.stringify(id)}, ${REPS})`, 600000);
          r.cpu = cpu + 'x'; iso.push(r); console.log('yalıtılmış ' + JSON.stringify(r));
          ok(r.ok, id + ': yalıtılmış Worker durum sayısı ' + r.states);
        }
        console.log('  makine CPU doluluğu (' + cpu + 'x yalıtılmış): %' + machineBusy(b0));
      }
      await page.setCPUThrottle(1);
      fs.writeFileSync(path.join(OUT, 'rules-bench-isolated.json'), JSON.stringify(iso, null, 1));
      if (process.argv.includes('--isolated-only')) { await page.close(); process.exit(fails ? 1 : 0); }
    }
    await page.addInitScript(INIT);
    await page.goto(FILE, { debug: 1, lvl: 'P1' });
    await page.waitFor('window.Game && Game.ready === true', 30000, 50);
    const build = await page.evaluate('({rules: PX.BUILD.rules, replaced: PX.BUILD.replaced, levels: PX.LEVELS.map(l => ({id: l.id, states: l.kanit && l.kanit.states, par: l.kanit && l.kanit.opt && l.kanit.opt.hamle[0]}))})');
    console.log('build: kural sürümü ' + build.rules + '; stub kalan modüller: ' + (build.replaced.join(', ') || 'yok'));
    await page.waitFor('PX.solver.ready', 60000, 50);
    const boot = await page.evaluate('PX.solver.stats()[0]');
    console.log('açılış yüklemesi (Worker oluşturma dahil): ' + JSON.stringify(boot));
    const busy0 = machineBusy();
    const levels = build.levels.filter(l => !ONLY.length || ONLY.includes(l.id));
    const rows = [];
    for (const cpu of CPUS) {
      await page.setCPUThrottle(cpu);
      for (const lv of levels) {
        const r = { cpu: cpu + 'x', id: lv.id, states: lv.states, cold: [], coldW: [], warm: [], warmW: [], game: [] };
        for (let k = 0; k < REPS; k++) {
          // soğuk: yeni Worker
          const c = await page.evaluate(`(async () => { PX.solver.cancel(); PX.solver.flush(); const lv = PX.LEVELS.find(l => l.id === ${JSON.stringify(lv.id)});
            const t0 = performance.now(); const r = await PX.solver.load(lv.id, lv.def); const wall = performance.now() - t0; const st = PX.solver.stats().pop();
            return { wall, worker: st && st.worker, states: r && r.states }; })()`, 60000);
          r.cold.push(c.wall); r.coldW.push(c.worker);
          // sıcak: aynı Worker, önbellek boş
          const w = await page.evaluate(`(async () => { PX.solver.flush(); const lv = PX.LEVELS.find(l => l.id === ${JSON.stringify(lv.id)});
            await PX.solver.load('P1', PX.LEVELS[0].def);
            PX.solver.flush(); const t0 = performance.now(); const r = await PX.solver.load(lv.id, lv.def); const wall = performance.now() - t0; const st = PX.solver.stats().pop();
            return { wall, worker: st && st.worker, states: r && r.states }; })()`, 60000);
          r.warm.push(w.wall); r.warmW.push(w.worker);
          ok(c.states === lv.states && w.states === lv.states, `${lv.id}: durum sayısı ${c.states}/${w.states} != ${lv.states}`);
          // oyun yolu: Game.load -> solver:ready (önbellek boş, sıcak Worker)
          const g = await page.evaluate(`new Promise(res => { PX.solver.flush(); const id = ${JSON.stringify(lv.id)}; const t0 = performance.now();
            const off = PX.bus.on('solver:ready', p => { if (p.id === id) { off(); res({ ms: performance.now() - t0, cached: p.cached }); } });
            Game.load(id); setTimeout(() => { off(); res(null); }, 90000); })`, 100000);
          r.game.push(g ? g.ms : NaN);
        }
        // doğruluk: lamba ve dist(s0)
        const chk = await page.evaluate(`(async () => { await Game.idle(5000); for (let i = 0; i < 900 && !(PX.solver.ready && PX.solver.id === ${JSON.stringify(lv.id)}); i++) await new Promise(r => setTimeout(r, 100)); const s = PX.game.state().s; const d = PX.solver.dist(s);
          const lamp = (document.querySelector('[data-testid=lamp]') || {}).className || '';
          const t0 = performance.now(); let x = 0; for (let i = 0; i < 10000; i++) x += PX.solver.dist(s); const ms = performance.now() - t0;
          return { d, lamp, ms, x }; })()`, 100000);
        ok(chk.d === lv.par, `${lv.id}: dist(s0)=${chk.d} par=${lv.par}`);
        ok(/ok/.test(chk.lamp), `${lv.id}: lamba ${chk.lamp}`);
        rows.push({ cpu: r.cpu, id: lv.id, states: lv.states, coldWall: Math.round(med(r.cold)), coldMin: Math.round(Math.min(...r.cold)), coldMax: Math.round(Math.max(...r.cold)), coldWorker: Math.round(med(r.coldW)),
          warmWall: Math.round(med(r.warm)), warmMin: Math.round(Math.min(...r.warm)), warmMax: Math.round(Math.max(...r.warm)), warmWorker: Math.round(med(r.warmW)), gameReady: Math.round(med(r.game)), gameMin: Math.round(Math.min(...r.game.filter(x => x === x))), gameMax: Math.round(Math.max(...r.game)), dist10k: +chk.ms.toFixed(2) });
        console.log(JSON.stringify(rows[rows.length - 1]));
      }
    }
    await page.setCPUThrottle(1);
    const load = machineBusy(busy0);
    console.log('makine CPU doluluğu ölçüm boyunca: %' + load + ' (16 çekirdek; diğer ekiplerin testleri dahil — duvar saatleri bununla şişer)');
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'rules-bench.json'), JSON.stringify(rows, null, 1));
    // --- ipucu / hayalet / kod / günlük duman testi (telefon)
    const lt0 = await page.evaluate('window.__lt.length');
    await page.evaluate(`Game.load('M1')`); await page.waitFor('PX.solver.ready && PX.solver.id === "M1"', 20000);
    const alloc = await page.evaluate(`(() => { const s = PX.game.state().s; for (let i = 0; i < 2000; i++) PX.solver.dist(s); const m0 = performance.memory.usedJSHeapSize; let x = 0; for (let i = 0; i < 100000; i++) x += PX.solver.dist(s); return { bytes: performance.memory.usedJSHeapSize - m0, x }; })()`);
    console.log('100 000 dist() okuması yığın değişimi: ' + alloc.bytes + ' B');
    ok(alloc.bytes < 64 * 1024, 'dist() ayırmasız olmalı (' + alloc.bytes + ' B)');
    const btn = await page.evaluate(`(() => { const b = document.getElementById('btn-hint'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await page.evaluate(`(window.__hintP = new Promise(res => { const off = PX.bus.on('hint', p => { off(); res(p); }); setTimeout(() => res(null), 15000); }), ${btn ? '' : "PX.game.command({t:'hint', tier:1}),"} true)`);
    if (btn) {                                              // HUD: ipucu düğmesi pencereyi açar, kademe düğmesi ister
      await page.tap(btn.x, btn.y); await cdp.sleep(250);
      const b1 = await page.evaluate(`(() => { const b = document.getElementById('hint-1'); if (!b) return null; const r = b.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
      if (b1) await page.tap(b1.x, b1.y); else await page.evaluate("PX.game.command({t:'hint', tier:1})");
    }
    const h1 = await page.evaluate('window.__hintP');
    console.log('ipucu 1: ' + JSON.stringify(h1 && { why: h1.why, acts: h1.acts, el: h1.el, metric: h1.metric }));
    ok(h1 && h1.acts && h1.acts.length && /Q01/.test(h1.why), 'ipucu düğmesi kural dürtmesi verir');
    await cdp.sleep(400);
    if (SHOTS) await page.screenshot(path.join(OUT, 'rules-hint1.png'));
    const toast = await page.evaluate(`(document.querySelector('[data-testid=toast]') || {}).textContent || ''`);
    console.log('toast: ' + JSON.stringify(toast));
    const h2 = await page.evaluate(`(async () => { const ev = []; const offs = ['ghost:start','ghost:step','ghost:end'].map(t => PX.bus.on(t, p => ev.push(t))); const r = await PX.hint.request(2); await new Promise(r => setTimeout(r, 2500)); offs.forEach(f => f()); return { why: r && r.why, acts: r && r.acts, ev }; })()`);
    console.log('ipucu 2: ' + JSON.stringify(h2));
    ok(h2.acts && h2.acts.length && h2.ev.includes('ghost:start') && h2.ev.includes('ghost:step'), 'hayalet adım oynatılır');
    const used = await page.evaluate('PX.hint.used'); ok(used === true, 'ipucu kullanıldı bayrağı');
    // metrik seçimi: kesinti planı
    const hk = await page.evaluate(`(async () => { PX.hint.setMetric('kesinti'); await Game.load('T2'); await new Promise(r => { const f = () => PX.solver.ready && PX.solver.id === 'T2' ? r() : setTimeout(f, 50); f(); }); const r = await PX.hint.request(1); const d = PX.solver.distM(PX.game.state().s, 'kesinti'); PX.hint.setMetric('hamle'); return { why: r.why, acts: r.acts, d }; })()`, 180000);
    console.log('ipucu (Kesinti, T2): ' + JSON.stringify(hk));
    ok(hk.d && hk.d.p === 19 && /Kesinti hedefi/.test(hk.why), 'Kesinti metriği T2: kalan Kesinti optimumu 19');
    // işbirlikli iptal: T2 hesaplanırken P1'e geçiş -> P1 hızlı hazır, Worker sonlandırılmaz
    const sw = await page.evaluate(`(async () => { PX.solver.flush(); await new Promise(r => setTimeout(r, 50)); const before = PX.solver.stats().length;
      const big = PX.LEVELS.find(l => l.id === 'F2') || PX.LEVELS[PX.LEVELS.length - 1]; const pBig = PX.solver.load(big.id, big.def); await new Promise(r => setTimeout(r, 40));
      const t0 = performance.now(); const r = await PX.solver.load('P1', PX.LEVELS[0].def); const ms = performance.now() - t0; const rb = await pBig;
      return { ms, big: rb, ready: PX.solver.ready && PX.solver.id === 'P1', cold: PX.solver.stats().slice(before).map(x => x.cold) }; })()`, 30000);
    console.log('iptal + geçiş: ' + JSON.stringify(sw));
    ok(sw.ready && sw.big === null && sw.ms < 400 && !sw.cold.includes(true), 'işbirlikli iptal: P1 ' + Math.round(sw.ms) + ' ms içinde hazır, sıcak Worker');
    // meydan okuma kodu
    const code = await page.evaluate(`(() => { const lv = PX.LEVELS.find(l => l.id === 'T2'); const r = PX.SIM.replay(PX.SIM.compile(lv.def), lv.kanit.cozumKesinti); const c = PX.ghost.code('T2', lv.kanit.cozumKesinti, r.tot); const v = PX.ghost.verify(c); const bad = PX.ghost.verify(c.replace(/-r3$/, '-r9')); const junk = PX.ghost.verify('PX2-T2-@@@-1.2.3.4'); return { c: c.slice(0, 48) + '…', ok: v.ok, tot: v.tot, bad: bad.msg, junk: junk.msg, defter: PX.ghost.defter('T2', lv.kanit.cozumKesinti).lines.slice(0, 3) }; })()`);
    console.log('kod: ' + JSON.stringify(code));
    ok(code.ok && code.tot.k === 19, 'meydan okuma kodu tarayıcıda doğrulanır');
    const daily = await page.evaluate(`({ pool: PX.daily.pool.length, today: PX.daily.today(), date: PX.daily.dateOf(Date.now()) })`);
    console.log('günlük: ' + JSON.stringify(daily));
    // önceden hesaplama: kazanma -> sonraki seviye önbellekte, "Sonraki" anında hazır
    const nx = await page.evaluate(`(async () => { PX.solver.flush(); await Game.load('T1'); await new Promise(r => { const f = () => PX.solver.ready && PX.solver.id === 'T1' ? r() : setTimeout(f, 50); f(); });
      PX.bus.emit('win', { id: 'T1', tot: {h:0,m:0,k:0,o:0} }); const tw = performance.now();
      while (!PX.solver.info().cached.includes('T2') && performance.now() - tw < 45000) await new Promise(r => setTimeout(r, 100)); const pre = performance.now() - tw; const cached = PX.solver.info().cached;
      const t0 = performance.now(); let ms = null; const off = PX.bus.on('solver:ready', p => { if (p.id === 'T2') { ms = performance.now() - t0; off(); } }); await Game.load('T2'); await new Promise(r => setTimeout(r, 50)); return { cached, ms, pre: Math.round(pre) }; })()`, 60000);
    console.log('önceden hesaplama: ' + JSON.stringify(nx));
    ok(nx.cached.includes('T2') && nx.ms !== null && nx.ms < 300, 'kazanınca sonraki seviye önceden hesaplanır');
    if (SHOTS) { await page.evaluate(`Game.load('M1')`); await cdp.sleep(800); await page.evaluate(`PX.hint.request(1)`); await cdp.sleep(500); await page.screenshot(path.join(OUT, 'rules-hint-M1.png')); }
    const lts = await page.evaluate(`window.__lt.slice(${lt0})`);
    console.log('uzun görevler (ölçüm sonrası): ' + JSON.stringify(lts.map(x => Math.round(x[1]))));
    const errs = page.errors().concat(page.exceptions()).map(l => page.formatLog(l)).filter(t => !/favicon/.test(t));
    if (errs.length) console.log('konsol hataları:\n  ' + errs.slice(0, 10).join('\n  '));
    ok(!errs.some(t => /PX\.solver|PX\.hint|PX\.ghost|PX\.daily|worker/i.test(t)), 'kurallar modüllerinden konsol hatası yok');
  } finally { await page.close(); }
  console.log(fails ? `rules_browser: ${fails} başarısız` : 'rules_browser: tamam');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
