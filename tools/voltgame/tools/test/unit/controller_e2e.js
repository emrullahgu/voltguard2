'use strict';
// ============================================================================
// tools/test/unit/controller_e2e.js — controller ekibinin tarayıcı uçtan uca testleri (headless Chrome, telefon 375×667
// DPR2 dokunma). Foundation paketlerinin (flow/touchplay) kapsamadığı controller davranışları:
//   1 yürürken başka karoya dokunma = hedef değiştirme (defter tek g, Volti yeni hedefte, sunum = mantık)
//   2 yürürken kaydırma = döndürme (defter yeniden oynatılabilir, Volti karo üstünde, görünüm değişti)
//   3 hızlı 4× E = FIFO (düşen girdi yok; tampon dolarsa YENİ olan reddedilir, eskiler oynar)
//   4 iki parmak dokunuşu = tek geri al
//   5 klavye imleci: ok tuşundan sonra rozetler görünür, dokunuşla gizlenir
//   6 her karede ayak karo üstünde (yürüyüş + hedef değiştirme + geri al sırasında; bağımsız geometri)
//   7 dokunuş -> ilk hareket (işleyici zamanından), 10 deneme medyanı
// Kullanım: node tools/test/unit/controller_e2e.js [--file dev/v2-controller.html]
// ============================================================================
const path = require('path');
const cdp = require('../cdp');
const { sleep } = cdp;
const ROOT = path.resolve(__dirname, '..', '..', '..');
const ai = process.argv.indexOf('--file');
const GAME = path.resolve(ai > 0 ? process.argv[ai + 1] : path.join(ROOT, 'dev', 'v2-controller.html'));
const INIT = `window.__PX_TEST__ = true; window.__inp = { upH: 0 }; addEventListener('pointerup', () => { __inp.upH = performance.now(); }, true);`;
// kural sürümü 4: merdiven/iskele hücresinin sütunundaki kareler (eğim/basamak) bu basit örnekleyicide atlanır
// (tam yüzey denetimi: suites2 grounding); karo üstünde ayak = blok tepesi
const FOOT = `(()=>{ const p=PX.volti.probe(), L=PX.game.L, G=L.G, K=PX.SIM.KIND; let ground=-1e9, skip=0;
  for (const x of [Math.floor(p.x+0.5-1e-4), Math.floor(p.x+0.5+1e-4)]) for (const z of [Math.floor(p.z+0.5-1e-4), Math.floor(p.z+0.5+1e-4)]) {
    if (x<0||z<0||x>=G.W||z>=G.D) continue; for (let y=G.H-1;y>=0;y--){ const c=G.idx(x,y,z); if(c<0||!G.kind[c]) continue; const k=G.kind[c]; if (k===K.merdiven||k===K.iskele) { skip=1; continue; } if (k===K.kapi) continue; const t=y+0.5; if (t<=p.footY+0.01){ if(t>ground) ground=t; break; } } }
  return [skip ? 0 : p.footY-ground, (p.arc?1:0)|(skip?1:0), p.moving?1:0]; })()`;
const far = `(()=>{const L=Game.L(), s=PX.game.state().s; const ts=PX.SIM.walkTargets(L,s);
  const arr=ts.map(t=>{ const w=PX.SIM.walkPath(L,s,t); return [t, w ? w.filter(x=>x.k==='karo').length-1 : 0]; }).sort((a,b)=>b[1]-a[1]); return arr;})()`;

(async () => {
  const res = []; const add = (name, pass, info) => { res.push({ name, pass, info }); console.log((pass ? '  ok   ' : '  FAIL ') + name + (info ? '  — ' + info : '')); };
  const page = await cdp.launch({ width: 375, height: 667, mobile: true, touch: true, dpr: 2 });
  // Açık zaman damgalı, ACK beklemeden boru hattına verilen dokunuşlar: headless SwiftShader'da sayfa ilk saniyelerde
  // yavaşken cdp.tap()'in touchStart ACK'ini beklemesi 40 ms'lik dokunuşu 0,5–1 s'lik basışa (uzun basış) çeviriyordu
  // (_requests/controller.md #6). Burada parmağın gerçek süresi zaman damgasıyla verilir.
  const ptsOf = (pts) => pts.map((q, i) => ({ x: q.x, y: q.y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 }));
  const touchSeq = (down, holdMs) => { const t0 = Date.now() / 1000; return Promise.all([
    page.conn.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: t0, touchPoints: ptsOf(down) }),
    page.conn.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: t0 + holdMs / 1000, touchPoints: [] }) ]); };
  const tapAt = (x, y, holdMs = 40) => touchSeq([{ x, y }], holdMs);
  const twoTap = (x, y, holdMs = 60, sep = 50) => touchSeq([{ x: x - sep / 2, y }, { x: x + sep / 2, y }], holdMs);
  try {
    await page.addInitScript(INIT);
    const open = async id => { await page.goto(GAME, { debug: true, lvl: id }); await page.waitFor('window.Game && Game.ready===true', 30000); await page.evaluate('Game.idle(30000)', 35000); await sleep(300); };
    const idle = () => page.evaluate('Game.idle(20000)', 25000);
    const canvas = await (async () => { await open('M1'); return page.evaluate(`(()=>{const b=document.querySelector('canvas#game-canvas').getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height}})()`); })();

    // 1) hedef değiştirme
    {
      const list = await page.evaluate(far); const A = list[0][0];
      const B = list.find(x => x[0] !== A && x[1] >= 1)[0];
      const pa = await page.evaluate(`Game.screenOfTile(${A})`), pb = await page.evaluate(`Game.screenOfTile(${B})`);
      await page.startFrameTrace(FOOT, { width: 3 });
      await tapAt(pa.x, pa.y, 30); await sleep(180); await tapAt(pb.x, pb.y, 30); await idle(); await sleep(50);
      const tr = await page.stopFrameTrace();
      const st = await page.evaluate('Game.state()'); const toks = await page.evaluate('PX.game.tokens()'); const L = await page.evaluate(`Game.L().tileIdx[${B}]`);
      const bad = tr.rows.filter(r => !r[1] && Math.abs(r[0]) > 1e-3).length;
      add('yürürken başka karoya dokun = hedef değiştir (tek g, 1 Hamle)', toks === 'g' + L && st.s.p === B && st.presentation.s.p === B && st.tot.h === 1, `defter "${toks}", Volti ${st.presentation.s.p}/${B}`);
      add('hedef değiştirme boyunca ayak karo üstünde (her kare)', bad === 0 && tr.n > 10, `${tr.n} kare, ${bad} hatalı`);
    }
    // 2) yürürken kaydırma
    {
      await open('M1');
      const list = await page.evaluate(far); const A = list[0][0]; const pa = await page.evaluate(`Game.screenOfTile(${A})`);
      const v0 = (await page.evaluate('Game.state()')).view;
      await page.startFrameTrace(FOOT, { width: 3 });
      await tapAt(pa.x, pa.y, 30);
      // kural sürümü 4: döndürme yalnız kamera — Volti yürürken kaydır: görünüm değişir, defter tek g, yol aynı
      await page.evaluate(`new Promise(res=>{ const t0=performance.now(); const off=Game.onFrame(()=>{ if (PX.volti.moving || performance.now()-t0>2000) { off(); res(); } }); })`, 10000);
      const cx = canvas.x + canvas.w / 2, cy = canvas.y + canvas.h * 0.3, dx = 0.45 * Math.min(canvas.w, 260);
      await page.swipe(cx + dx / 2, cy, cx - dx / 2, cy + 2, { durationMs: 200 }); await idle(); await sleep(50);   // parmak sola = d+
      const tr = await page.stopFrameTrace();
      const st = await page.evaluate('Game.state()'); const toks = await page.evaluate('PX.game.tokens()'); const cam = await page.evaluate('Game.camera()');
      const rp = await page.evaluate(`(r=>({ok:r.ok, at:r.at, err:r.err}))(PX.SIM.replay(Game.L(), ${JSON.stringify(toks)}))`);
      const bad = tr.rows.filter(r => !r[1] && Math.abs(r[0]) > 1e-3).length;
      add('yürürken kaydırma = yalnız kamera: defter tek g, Volti hedefte', /^g\d+$/.test(toks) && st.s.p === A && st.presentation.s.p === A, `"${toks}" Volti ${st.presentation.s.p}/${A}`);
      add('yürürken kaydırma döndürür; defter geçerli; sunum = mantık; kamera = camView', st.view === ((v0 + 1) & 3) && cam.v === st.view && rp.ok && JSON.stringify(st.presentation.s) === JSON.stringify(st.s),
        `görünüm ${v0}->${st.view} kamera ${cam.v} replay ${JSON.stringify(rp)}`);
      add('yürürken döndürme boyunca ayak karo üstünde', bad === 0, `${tr.n} kare, ${bad} hatalı`);
    }
    // 3) hızlı 4× E
    {
      await open('M1');
      // kural sürümü 4: döndürme her yerde serbest (yasak yön yok); 4 hızlı E = 4 kabul, kamera başladığı görünümde
      const v0 = (await page.evaluate('Game.state()')).view;
      const T0 = await page.evaluate('performance.now()');
      await page.keys(['e', 'e', 'e', 'e'], 20); await idle();
      const ev = await page.evaluate(`Game.events(256).filter(e=>e.t>${T0}).filter(e=>e.type==="cmd:accepted"||e.type==="cmd:rejected").map(e=>[e.type,e.cmd,e.err])`);
      const acc = ev.filter(e => e[0] === 'cmd:accepted').length; const st = await page.evaluate('Game.state()'); const cam = await page.evaluate('Game.camera()');
      add('hızlı 4× E: düşen girdi yok (4 döndürme kabul, kamera son görünümde)', acc === 4 && cam.v === st.view && st.view === v0 && !cam.busy && ev.length === 4 && st.hist === 0, JSON.stringify(ev));
    }
    // 4) iki parmak dokunuşu
    {
      await open('M1');
      const list = await page.evaluate(far); await page.evaluate(`Game.cmd({t:'tap', cell:${list[0][0]}})`); await idle();
      const h0 = (await page.evaluate('Game.state()')).hist;
      await twoTap(canvas.x + canvas.w / 2, canvas.y + canvas.h * 0.4, 60, 50); await idle();
      const h1 = (await page.evaluate('Game.state()')).hist;
      add('iki parmak dokunuşu = tek geri al', h0 === 1 && h1 === 0, `hist ${h0} -> ${h1}`);
    }
    // 5) klavye imleci
    {
      await open('M1');
      await page.evaluate('document.querySelector("canvas#game-canvas").focus()');
      const km = await page.evaluate('Game.keyMap()'); const t = await page.evaluate('PX.keyboard.targets()');
      const k = Object.keys(t).find(x => t[x] >= 0);
      await page.key(k); await idle(); await page.frames(4);
      const vis = await page.evaluate('[...document.querySelectorAll("[data-testid=kbd-cursor] [data-key]")].filter(m=>m.style.display!=="none").length');
      const t2 = await page.evaluate('PX.keyboard.targets()'); const want = Object.values(t2).filter(c => c >= 0).length;
      await tapAt(canvas.x + 5, canvas.y + 5, 30); await page.frames(2);
      const vis2 = await page.evaluate('[...document.querySelectorAll("[data-testid=kbd-cursor] [data-key]")].filter(m=>m.style.display!=="none").length');
      add('klavye imleci: ok tuşundan sonra hedef rozetleri, dokunuşla gizlenir', vis === want && want > 0 && vis2 === 0, `görünen ${vis}/${want}, dokunuştan sonra ${vis2}; eşleme ${JSON.stringify(km)}`);
      await page.screenshot(path.join(ROOT, 'tools', 'test', 'out', 'controller-kbd-cursor.png')).catch(() => {});
    }
    // 7) dokunuş -> ilk hareket
    {
      const lat = [];
      for (let i = 0; i < 10; i++) {
        await open('M1');
        const list = await page.evaluate(far); const p = await page.evaluate(`Game.screenOfTile(${list[0][0]})`);
        await page.startFrameTrace('(p=>[p.x,p.y,p.z,__inp.upH])(PX.volti.probe())', { width: 4 });
        await sleep(60); await tapAt(p.x, p.y, 30); await idle();
        const tr = await page.stopFrameTrace(); const h = tr.rows[tr.n - 1][3]; const b = tr.rows[0];
        let k = -1; for (let j = 1; j < tr.n; j++) { if (tr.t[j] < h) continue; const r = tr.rows[j]; if (Math.abs(r[0] - b[0]) + Math.abs(r[1] - b[1]) + Math.abs(r[2] - b[2]) > 1e-4) { k = j; break; } }
        if (k > 0) lat.push(tr.t[k] - h);
      }
      lat.sort((a, b) => a - b);
      const med = lat.length ? lat[Math.floor(lat.length / 2)] : null;
      add('dokunuş -> ilk görünür hareket (medyan, 10 deneme)', med !== null && med <= 34, `medyan ${med && med.toFixed(1)} ms, en kötü ${lat.length ? lat[lat.length - 1].toFixed(1) : '-'} ms, ${lat.length}/10 ölçüm`);
    }
    const ex = page.exceptions(); add('sayfa istisnası yok', !ex.length, ex.slice(0, 3).map(l => page.formatLog(l)).join(' | '));
  } finally { await page.close(); }
  const fail = res.filter(r => !r.pass).length;
  console.log(fail ? `controller_e2e: ${fail} FAIL` : 'controller_e2e: ALL PASS'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
