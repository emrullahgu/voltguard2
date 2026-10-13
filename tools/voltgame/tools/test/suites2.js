'use strict';
// ============================================================================
// PARALAKS: TEK HAT — v2 test suites (spec §20.1, §12.3, §24). Used by run.js when the target file is a v2
// build (contains //#PX2-BUILD) or when --v2 is given. Every v2 page is opened with ?debug and the harness
// init script (window.__PX_TEST__, input timestamp recorder, long-task observer).
//   verify     node tools/reference2/verify2.js (rules, proofs, gates)
//   (kural sürümü 4 = FİZİKSEL DÜNYA: kamera yalnız görsel, kat değişimi yalnız merdiven/iskele, erişilemeyen hedef
//    her zaman engeliyle açıklanır)
//   replay     every level's golden strings (cozum, cozumManevra, cozumKesinti) via Game.replay win with the
//              stamped totals (instant mode); --realtime replays with animations; no v3 tokens (d+ d- p)
//   parity     DRAWN walkable surfaces (PX.diorama.walkableDrawn: tiles, stairs, ladders, doors) == sim2 L.tiles /
//              L.stairs / L.ladders / L.doors (view independent), plus pick round-trip in all 4 views for every tile
//              and device whose top is unoccluded (Game.ownerAt(screenOfTile(c)) == c)
//   flow       §12.3 thresholds at CPU 1x and 4x (phone 375x667 DPR2 touch); stair/ladder walk continuity (no teleport)
//   grounding  Volti's feet on the walking surface on EVERY frame during golden replays, undo mid-walk, rotations:
//              tile top, stair incline (sim2 walkPath h), ladder rungs (inside the ladder column); body never in a solid
//   reach      every level: from the start AND after every golden manoeuvre, tapping every device / door / stair /
//              ladder either walks (or shows chips/card) or rejects WITH a reason (msg + named blockers); never silent.
//              Real touch on unreachable targets shows the reason card; "Volti'yi gönder" walks or explains
//   leak       20 level load/unload cycles: heap growth <= 2 MB, geometries/textures stable
//   storage    ?nostorage, throwing localStorage, corrupt save, migration, persistence
//   touchplay  P1 and M1 solved by touch only (tile taps, swipes, device taps + chips); any --levels order works
//   smoke      375x667, 360x640, 667x375, 1280x800: layout, tap targets, overlap, console errors, banned words
//   ui         UI / string regressions of the whole-game review (regress_ui.js)
//   daily      the 37 Günün Manevrası golden strings replayed in-page (regress_ui.js)
// ============================================================================
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = function suites2(ctx) {
  const { GAME, OUT, ROOT, cdp, makeResult, flush, withPage, fmtLogs, table, opt, LAYOUT_PROBE, overlap, rs, VIEWPORTS } = ctx;
  const { sleep } = cdp;
  const PHONE = { width: 375, height: 667, mobile: true, touch: true, dpr: 2 };
  const DESK = { width: 1280, height: 800, mobile: false, touch: false, dpr: 1 };
  const READY = 'window.Game && window.Game.ready === true';
  const levelOpt = () => (opt('levels') || '').split(',').filter(Boolean);

  // harness init script: runs before any page script on every navigation
  const INIT = `(() => {
    window.__PX_TEST__ = true;
    // ev = event.timeStamp (includes the browser's input pipeline delay); h = performance.now() when the first
    // (window, capture) listener runs = when the page can react. Latency gates use h; ev is reported as info.
    const I = window.__inp = { down: 0, up: 0, key: 0, downH: 0, upH: 0, keyH: 0, n: 0 };
    addEventListener('pointerdown', e => { I.down = e.timeStamp; I.downH = performance.now(); I.n++; }, true);
    addEventListener('pointerup', e => { I.up = e.timeStamp; I.upH = performance.now(); I.n++; }, true);
    addEventListener('keydown', e => { I.key = e.timeStamp; I.keyH = performance.now(); I.n++; }, true);
    window.__lt = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  })();`;

  async function open(page, params, extraInit) {
    if (!page.__pxInit) { await page.addInitScript(INIT); page.__pxInit = true; }
    if (extraInit) await page.addInitScript(extraInit);
    await page.goto(GAME, Object.assign({ debug: true }, params || {}));
    await page.waitFor(READY, 30000, 50);
  }
  const idle = (page, ms = 30000) => page.evaluate(`Game.idle(${ms})`, ms + 5000);
  async function loadLevel(page, id) { await page.evaluate(`Game.load(${JSON.stringify(id)})`); await idle(page); }
  const levelsOf = page => page.evaluate('Game.levels()');
  const eqVec = (t, v) => Array.isArray(v) && t && t.h === v[0] && t.m === v[1] && t.k === v[2] && t.o === v[3];
  const vecStr = t => t ? `[${t.h},${t.m},${t.k},${t.o}]` : 'null';
  const pass = (r, ok, msg) => { if (!ok) r.fail(msg); return ok; };

  // ------------------------------------------------------------------ verify
  async function verify() {
    const res = makeResult('verify');
    const args = [path.join(ROOT, 'tools', 'reference2', 'verify2.js')];
    if (opt('vfile')) args.push('--file', opt('vfile'));
    const t0 = Date.now();
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    const lines = out.split('\n');
    for (const l of lines.filter(l => /^(FAIL|UYARI|dosyalar|izdüşüm)/.test(l))) res.info(l);
    const rows = lines.filter(l => /^[A-Z][A-Z0-9]{0,3}\s+(ogretici|cekirdek|zor|sinav|gunluk)/.test(l));
    res.info(rows.length + ' level rows, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's; last line: ' + lines.filter(Boolean).slice(-1)[0]);
    if (r.status !== 0 || !/ALL LEVELS VERIFIED/.test(out)) res.fail('verify2 exit ' + r.status + ': ' + lines.filter(Boolean).slice(-1)[0]);
    flush(res); return res;
  }

  // ------------------------------------------------------------------ replay
  async function replay() {
    const res = makeResult('replay');
    await withPage(DESK, async page => {
      await open(page, { lvl: 'P1' });
      const lv = await levelsOf(page); const only = levelOpt();
      const rows = [];
      for (const L of lv) {
        if (only.length && !only.includes(L.id)) continue;
        await loadLevel(page, L.id);
        for (const [fld, m] of [['cozum', 'hamle'], ['cozumManevra', 'manevra'], ['cozumKesinti', 'kesinti']]) {
          const str = L[fld]; const exp = L.opt && L.opt[m];
          if (str && /(^|\s)(d[+-]|p)(\s|$)/.test(str)) { rows.push({ id: L.id, str: fld, pass: false, reason: 'v3 token (d±/p) in golden string' }); res.fail(L.id + ' ' + fld + ': v3 token'); continue; }
          if (!str || !exp) { rows.push({ id: L.id, str: fld, pass: false, reason: 'no golden/opt in PX.LEVELS' }); res.fail(L.id + ' ' + fld + ': missing'); continue; }
          const r = await page.evaluate(`Game.replay(${JSON.stringify(str)}, {instant:${opt('realtime') ? 'false' : 'true'}})`, 180000);
          const ok = r.ok && r.won && eqVec(r.tot, exp);
          rows.push({ id: L.id, str: fld, pass: ok, tot: vecStr(r.tot), exp: JSON.stringify(exp), reason: ok ? '' : (r.ok ? (r.won ? 'totals differ' : 'not won') : 'rejected at ' + r.at + ' (' + r.err + ')') });
          if (!ok) res.fail(`${L.id} ${fld}: ${rows[rows.length - 1].reason} tot=${vecStr(r.tot)} exp=${JSON.stringify(exp)}`);
        }
      }
      // one real-time replay through the full presentation pipeline
      if (!opt('realtime') && lv.length) {
        const L = lv[0]; await loadLevel(page, L.id);
        const r = await page.evaluate(`Game.replay(${JSON.stringify(L.cozum)}, {instant:false})`, 180000);
        const ok = r.ok && r.won && eqVec(r.tot, L.opt.hamle);
        rows.push({ id: L.id, str: 'cozum (animated)', pass: ok, tot: vecStr(r.tot), exp: JSON.stringify(L.opt.hamle), reason: ok ? '' : JSON.stringify(r).slice(0, 120) });
        if (!ok) res.fail(L.id + ' animated replay: ' + JSON.stringify(r).slice(0, 200));
      }
      for (const l of table(rows, ['id', 'str', 'pass', 'tot', 'exp', 'reason'])) res.info(l);
      const ex = page.exceptions(); if (ex.length) res.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 900000, 'replay').catch(e => res.fail('harness/page error: ' + e.message));
    flush(res); return res;
  }

  // ------------------------------------------------------------------ parity
  async function parity() {
    const res = makeResult('parity');
    await withPage(PHONE, async page => {
      await open(page, { lvl: 'P1' });
      const lv = await levelsOf(page); const rows = []; let stub = false;
      for (const L of lv) {
        if (levelOpt().length && !levelOpt().includes(L.id)) continue;
        await loadLevel(page, L.id);
        // 1) çizilen yürünebilir yüzeyler = sim2 fiziksel yüzeyleri (görünümden bağımsız)
        const g = await page.evaluate(`(()=>{ const L=Game.L(); const W=PX.diorama.walkableDrawn?PX.diorama.walkableDrawn():null; if(!W) return {none:true};
            const cmp=(a,b)=>{ const A=new Set(a), B=new Set(b); return { extra:[...A].filter(c=>!B.has(c)), miss:[...B].filter(c=>!A.has(c)), n:B.size }; };
            const flat=a=>[].concat(...a.map(x=>Array.isArray(x)?x:[x]));   // iskele: hücre dizileri; kapı: eleman kimliği ya da hücre
            const dId=x=>typeof x==='number'?(L.els.find(e=>e.cell===x)||{}).id:x;
            return { tiles: cmp(W.tiles, L.tiles), stairs: cmp(W.stairs, L.stairs.map(x=>x.cell)), ladders: cmp(flat(W.ladders), [].concat(...L.ladders.map(x=>x.cells))),
              doors: cmp(W.doors.map(dId), L.doors.map(d=>L.els[d.el].id)) }; })()`);
        if (g.none) { stub = true; rows.push({ id: L.id, v: 'yüzey', tiles: '-', pass: false, extra: 'PX.diorama.walkableDrawn yok', miss: '' }); res.fail(L.id + ': PX.diorama.walkableDrawn missing (render)'); }
        else for (const k of ['tiles', 'stairs', 'ladders', 'doors']) { const v = g[k]; const ok = !v.extra.length && !v.miss.length;
          rows.push({ id: L.id, v: k, tiles: v.n, pass: ok, extra: v.extra.join(','), miss: v.miss.join(',') });
          if (!ok) res.fail(`${L.id} ${k}: drawn != sim (extra ${v.extra}, missing ${v.miss})`); }
        // 2) seçim gidiş-dönüşü, 4 görünüm: üstü örtülmemiş her karo ve cihaz (kamera yalnız görsel: Game.rotate)
        for (let v = 0; v < 4; v++) {
          const r = await page.evaluate(`(()=>{ const st=Game.state(); const L=Game.L(); const v=st.view; const [sx,sz]=PX.SIM.VIEWS[v]; const bad=[]; let n=0;
            const topVis = c => { const [x,y,z]=L.G.xyz(c); const U=sx*x-y-1, V=sz*z-y-1; const a=PX.SIM.ownerAt(L,v,U,V,0,PX.diorama.fadedSet&&PX.diorama.fadedSet()), b=PX.SIM.ownerAt(L,v,U,V,1,PX.diorama.fadedSet&&PX.diorama.fadedSet()); return a&&b&&a.c===c&&b.c===c&&a.top&&b.top; };
            for (const c of L.tiles) { if (!topVis(c)) continue; n++; const q=Game.screenOfTile(c); const o=Game.ownerAt(q.x,q.y); if (o.cell!==c) bad.push([c,o.kind,o.cell]); }
            const badEl=[]; let ne=0; for (const e of L.els) { if (e.cell<0||e.t==='kapi') continue; if (!topVis(e.cell)) continue; ne++;
              const q=Game.screenOfEl(e.id); const o=Game.ownerAt(q.x,q.y); if (o.cell!==e.cell) badEl.push([e.id,o.kind,o.cell]); }
            return { v, n, bad, ne, badEl }; })()`);
          rows.push({ id: L.id, v: 'pick v' + r.v, tiles: r.n + '+' + r.ne + 'el', pass: !r.bad.length && !r.badEl.length, extra: JSON.stringify(r.bad.concat(r.badEl)).slice(0, 60), miss: '' });
          if (r.bad.length || r.badEl.length) res.fail(`${L.id} v${r.v}: pick round-trip failed for ${r.bad.length} tile(s), ${r.badEl.length} device(s): ${JSON.stringify(r.bad.concat(r.badEl)).slice(0, 200)}`);
          await page.evaluate('Game.rotate(1)'); await idle(page);
        }
      }
      for (const l of table(rows, ['id', 'v', 'tiles', 'pass', 'extra', 'miss'])) res.info(l);
      if (stub) res.note('PX.diorama.walkableDrawn is missing: drawn-surface rows cannot be compared until the render team ships it');
      const ex = page.exceptions(); if (ex.length) res.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 600000, 'parity').catch(e => res.fail('harness/page error: ' + e.message));
    flush(res); return res;
  }

  // ------------------------------------------------------------------ flow helpers (page side)
  // en uzak yürüyüş hedefi (fiziksel yol uzunluğu, sim2.walkPath karo adımı); tercihen üstü görünen karo
  const PICK_FAR = `(()=>{const L=Game.L(), s=PX.game.state().s; const ts=PX.SIM.walkTargets(L,s); if(!ts.length) return null;
    const v=PX.game.camView, [sx,sz]=PX.SIM.VIEWS[v]; const vis=c=>{const [x,y,z]=L.G.xyz(c); const U=sx*x-y-1,V=sz*z-y-1; const a=PX.SIM.ownerAt(L,v,U,V,0), b=PX.SIM.ownerAt(L,v,U,V,1); return a&&b&&a.c===c&&b.c===c;};
    let best=-1,bd=-1; for(const t of ts){ const w=PX.SIM.walkPath(L,s,t); const d=w?w.filter(x=>x.k==='karo').length-1:0; if(d>bd||(d===bd&&vis(t)&&!vis(best))){bd=d;best=t;}} return {cell:best, steps:bd};})()`;
  const VOLTI_SAMPLE = '(p=>[p.x,p.y,p.z,__inp.upH,__inp.up])(PX.volti.probe())';      // cols 3,4 = pointerup (handler, event)
  const CAM_SAMPLE = '[PX.camera.az, PX.camera.busy()?1:0, 0, __inp.upH, __inp.up]';
  // input -> first frame whose sampled columns changed. lat from handler time (gate), evLat from event timestamp (info)
  function latency(tr, cols, eps, hCol) {
    if (!tr || !tr.n) return { lat: null, evLat: null, k: -1, h: 0 };
    const h = tr.rows[tr.n - 1][hCol], ev = tr.rows[tr.n - 1][hCol + 1];
    const k = firstChange(tr, cols, eps, h);
    return { lat: k > 0 ? +(tr.t[k] - h).toFixed(1) : null, evLat: k > 0 ? +(tr.t[k] - ev).toFixed(1) : null, k, h };
  }
  const latStr = L => L.lat === null ? 'no motion' : L.lat + ' ms';
  const latNote = L => L.evLat === null ? '' : 'from event timestamp ' + L.evLat + ' ms (incl. browser input pipeline)';
  const btnCenter = (page, id) => page.evaluate(`(()=>{const b=document.querySelector('[data-testid=${id}]'); if(!b) return null; const r=b.getBoundingClientRect(); if(!r.width) return null; return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  function firstChange(tr, cols, eps, fromT) {
    if (!tr || !tr.n) return -1;
    const base = tr.rows[0];
    for (let k = 1; k < tr.n; k++) { if (fromT && tr.t[k] < fromT) continue; for (const c of cols) if (Math.abs(tr.rows[k][c] - base[c]) > eps) return k; }
    return -1;
  }
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

  async function flowRun(page, cpu, r, rows) {
    await page.setCPUThrottle(cpu);
    const tag = cpu + 'x';
    await page.evaluate('window.__runT0 = performance.now()');
    const LIM = cpu === 1 ? { motion: 34, rotDone: [260, 300], cpu: 6, reset: 100, next: 300, dist: 1500 } : { motion: 70, rotDone: [0, 340], cpu: 16, reset: 100, next: 500, dist: 5000 };
    const mark = name => page.evaluate('(window.__marks = window.__marks || []).push([performance.now(), ' + JSON.stringify('[' + tag + '] ' + name) + '])');
    const add = (metric, value, limit, ok, note) => { rows.push({ cpu: tag, metric, value, limit, pass: ok, note: note || '' }); if (!ok) r.fail(`[${tag}] ${metric}: ${value} (limit ${limit})${note ? ' ' + note : ''}`); };
    const lvId = (await levelsOf(page)).some(l => l.id === 'M1') ? 'M1' : (await levelsOf(page))[0].id;

    // 1) tap -> first visible motion (dokun-yürü)
    await mark("1) tap -> first visible motion (dokun-yürü)");
    await loadLevel(page, lvId); await sleep(300);
    let far = await page.evaluate(PICK_FAR);
    if (!far) add('tap→motion', 'n/a', LIM.motion, false, 'no walk target');
    else {
      const pt = await page.evaluate(`Game.screenOfTile(${far.cell})`);
      await page.startFrameTrace(VOLTI_SAMPLE, { width: 5 });
      await sleep(80); await page.tap(pt.x, pt.y, 40); await idle(page); await sleep(50);
      const tr = await page.stopFrameTrace();
      const L = latency(tr, [0, 1, 2], 1e-4, 3);
      add('tap→first motion (walk ' + far.steps + ' tiles)', latStr(L), '≤ ' + LIM.motion + ' ms', L.lat !== null && L.lat <= LIM.motion, latNote(L));
    }
    // 2) rotate button -> first motion + completion time
    await mark("2) rotate button -> first motion + completi");
    {
      const d = 1;                                                      // kural sürümü 4: döndürme her zaman serbest
      const b = await btnCenter(page, 'btn-rot-right');
      if (!b) add('rotate button→motion', 'n/a', LIM.motion, false, 'btn-rot-right not visible');
      else {
        await page.startFrameTrace(CAM_SAMPLE, { width: 5 });
        await sleep(80); await page.tap(b.x, b.y, 40); await idle(page); await sleep(100);
        const tr = await page.stopFrameTrace();
        const L = latency(tr, [0], 1e-5, 3); const up = L.h;
        add('rotate button→first motion', latStr(L), '≤ ' + LIM.motion + ' ms', L.lat !== null && L.lat <= LIM.motion, latNote(L));
        let done = -1; const fin = tr.n ? tr.rows[tr.n - 1][0] : 0;
        for (let i = tr.n - 1; i >= 0; i--) { if (Math.abs(tr.rows[i][0] - fin) > 0.5 * Math.PI / 180) { done = i + 1; break; } }
        const dur = done > 0 && done < tr.n ? +(tr.t[done] - up).toFixed(0) : null;
        add('rotation 90° completion (within 0.5°)', dur === null ? 'n/a' : dur + ' ms', LIM.rotDone[0] + '–' + LIM.rotDone[1] + ' ms', dur !== null && dur >= LIM.rotDone[0] && dur <= LIM.rotDone[1]);
        await page.evaluate(`Game.cmd({t:'rot', d:${-d}})`); await idle(page);
      }
    }
    // 3) undo button -> first motion (after a walk)
    await mark("3) undo button -> first motion (after a wal");
    {
      far = await page.evaluate(PICK_FAR);
      if (far) { await page.evaluate(`Game.cmd({t:'tap', cell:${far.cell}})`); await idle(page); }
      const b = await btnCenter(page, 'btn-undo');
      await page.startFrameTrace(VOLTI_SAMPLE, { width: 5 });
      await sleep(80); await page.tap(b.x, b.y, 40); await idle(page); await sleep(50);
      const tr = await page.stopFrameTrace();
      const L = latency(tr, [0, 1, 2], 1e-4, 3);
      add('undo button→first motion', latStr(L), '≤ ' + LIM.motion + ' ms', L.lat !== null && L.lat <= LIM.motion, latNote(L));
    }
    // 4) four fast arrow keys = four steps
    await mark("4) four fast arrow keys = four steps");
    {
      await loadLevel(page, lvId);
      const plan = await page.evaluate(`(()=>{ const L=Game.L(); let s=PX.game.state().s; const km=Game.keyMap(); const inv={}; for (const k in km) inv[km[k]]=k;
        const seq=[]; const go=(s,d)=>{ const t=PX.SIM.stepToward(L,s,PX.SIM.screenToDir(PX.game.camView,d)); if (t<0) return null; const r=PX.SIM.apply(L,s,{t:'git',to:t}); return r.err?null:r.s; };
        const dfs=(s,depth)=>{ if(depth===4) return true; for (let d=0; d<4; d++){ const n=go(s,d); if(n){ seq.push(d); if(dfs(n,depth+1)) return true; seq.pop(); } } return false; };
        if (!dfs(s,0)) return null; let e=s; for (const d of seq) e=go(e,d); return { keys: seq.map(d=>inv[d]), end: e.p, h0: PX.game.state().tot.h }; })()`);
      if (!plan) add('4 fast arrow keys = 4 steps', 'n/a', '4', false, 'no 4-step keyboard path from start');
      else {
        await page.evaluate('document.querySelector("canvas#game-canvas").focus()');
        const n0 = (await page.evaluate('Game.events(256)')).length;
        await page.keys(plan.keys, 25); await idle(page);
        const st = await page.evaluate('Game.state()');
        const ev = (await page.evaluate('Game.events(256)')).slice(-Math.max(1, 256 - n0 + 8));
        const rej = ev.filter(e => e.type === 'cmd:rejected' && e.cmd === 'walk').length;
        const steps = st.tot.h - plan.h0;
        add('4 fast arrow keys (' + plan.keys.join(',') + ') = 4 steps', steps + ' steps, ' + rej + ' rejected', '4 steps, tile ' + plan.end, steps === 4 && st.s.p === plan.end && st.presentation.s.p === plan.end);
      }
    }
    // 5) swipe while busy is not a tap
    await mark("5) swipe while busy is not a tap");
    {
      await loadLevel(page, lvId);
      far = await page.evaluate(PICK_FAR);
      if (!far || far.steps < 2) add('swipe-while-busy is not a tap', 'n/a', '0 taps', true, 'no long walk available (skipped)');
      else {
        const pt = await page.evaluate(`Game.screenOfTile(${far.cell})`);
        const g = await page.evaluate(`(()=>{const b=document.querySelector('canvas#game-canvas').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height*0.35,w:b.width}})()`);
        await page.tap(pt.x, pt.y, 30);
        const before = await page.evaluate('Game.events(256).filter(e=>e.type==="cmd:accepted"||e.type==="cmd:rejected").length');
        await sleep(40);
        await page.swipe(g.x, g.y, g.x + 16, g.y + 1, { durationMs: 90 });           // just above the 10 px threshold
        await sleep(40);
        await page.swipe(g.x - 30, g.y, g.x + 30, g.y + 2, { durationMs: 140 });
        await idle(page);
        const evs = await page.evaluate('Game.events(256).filter(e=>e.type==="cmd:accepted"||e.type==="cmd:rejected")');
        const taps = evs.slice(before).filter(e => e.cmd === 'tap').length;
        add('swipe-while-busy is not a tap', taps + ' tap command(s)', '0', taps === 0);
      }
    }
    // 6) undo mid-FX: drawn == logic
    await mark("6) undo mid-FX: drawn == logic");
    {
      const lv = (await levelsOf(page)).find(l => l.id === lvId);
      const toks = lv.cozum.split(' '); const i = toks.findIndex(t => /^o:/.test(t));
      if (i < 0) add('undo mid-FX visual parity', 'n/a', 'drawn = logic', true, 'no device op in golden path');
      else {
        await loadLevel(page, lvId);
        await page.evaluate(`Game.replay(${JSON.stringify(toks.slice(0, i).join(' '))}, {instant:true})`);
        await page.evaluate(`Game.cmd({t:'act', tok:${JSON.stringify(toks[i])}})`);
        await sleep(120);
        await page.evaluate(`Game.cmd({t:'undo'})`);
        await page.frames(3);
        const chk = await page.evaluate(`(()=>{ const L=Game.L(), st=Game.state(); const bad=[];
          for (const e of L.els) { if (e.cell<0) continue; const sc=Game.drawnScale(e.cell); if (Math.abs(sc-1)>1e-6) bad.push(e.id+':scale '+sc); }
          const E=PX.SIM.stateE(L, st.s); for (let i=0;i<L.els.length;i++){ const e=L.els[i]; if (e.cell<0||e.bit===undefined) continue; const ds=PX.diorama.elState?PX.diorama.elState(i):null; if (ds && ds.closed !== !!((st.s.b>>e.bit)&1)) bad.push(e.id+':closed'); }
          if (JSON.stringify(st.presentation.s)!==JSON.stringify(st.s)) bad.push('presentation.s != s');
          if (JSON.stringify(st.presentation.tot)!==JSON.stringify(st.tot)) bad.push('presentation.tot != tot');
          const p=PX.volti.probe(); const [x,y,z]=L.G.xyz(st.s.p); if (Math.abs(p.x-x)>1e-6||Math.abs(p.z-z)>1e-6||Math.abs(p.y-(y+0.5))>1e-6) bad.push('volti not on s.p');
          return bad; })()`);
        add('undo mid-FX: Game.drawnScale/state = logic', chk.length ? chk.slice(0, 4).join('; ') : 'ok', 'all equal', !chk.length);
      }
    }
    // 7) stair/ladder continuity (kural sürümü 4: atlama/ışınlanma yok): kat değiştiren bir yürüyüşte her karede dünya
    //    yer değiştirmesi ≤ 9 karo/s × o karenin dt'si + 0,05 ve ayak yüksekliği sürekli (kare başına ≤ 0,5)
    await mark("7) stair/ladder continuity");
    {
      const found = await page.evaluate(`(async()=>{ for (const lv of Game.levels()) { await Game.load(lv.id); const L=Game.L(), s=PX.game.state().s;
          for (const t of PX.SIM.walkTargets(L,s)) { const w=PX.SIM.walkPath(L,s,t); if (w && w.some(x=>x.k!=='karo')) return {id:lv.id, cell:t, kind:w.find(x=>x.k!=='karo').k, len:w.length}; } }
        return null; })()`, 60000);
      if (!found) add('stair/ladder continuity', 'n/a', 'no teleport', false, 'no stair/ladder walk at any level start');
      else {
        await loadLevel(page, found.id);
        await page.startFrameTrace('(p=>[p.x,p.footY,p.z,PX.main.frameStats(1).gapAvg])(PX.volti.probe())', { width: 4 });
        await page.evaluate(`Game.cmd({t:'tap', cell:${found.cell}})`); await idle(page); await sleep(50);
        const tr = await page.stopFrameTrace();
        let worst = -1e9, worstLim = 0, jumps = 0, maxDy = 0, y0 = tr.n ? tr.rows[0][1] : 0, y1 = y0;
        for (let k = 1; k < tr.n; k++) { const a = tr.rows[k - 1], b = tr.rows[k]; const dt = Math.min(100, Math.max(1, (tr.rows[k + 1] || b)[3] || 16.7));
          const w = Math.hypot(b[0] - a[0], b[2] - a[2]); const lim = 9 * dt / 1000 + 0.05; const dy = Math.abs(b[1] - a[1]);
          if (w > lim || dy > 0.5) jumps++; if (w - lim > worst - worstLim) { worst = w; worstLim = lim; } if (dy > maxDy) maxDy = dy; if (b[1] > y1) y1 = b[1]; if (b[1] < y0) y0 = b[1]; }
        add(`stair/ladder continuity (${found.id}, ${found.kind})`, jumps + ' jump frame(s); worst step ' + Math.max(0, worst).toFixed(3) + ' (lim ' + worstLim.toFixed(3) + '), max Δfoot ' + maxDy.toFixed(3), '0 jumps', jumps === 0 && tr.n > 2,
          'foot range ' + y0.toFixed(2) + '…' + y1.toFixed(2));
      }
    }
    // 8) steady-state frame CPU, 9) allocation per frame, 10) frame interval
    await mark("8) steady-state frame CPU, 9) allocation pe");
    {
      await loadLevel(page, lvId); await sleep(1200);
      await page.startFrameTrace('[performance.memory ? performance.memory.usedJSHeapSize : 0]', { width: 1 });
      await sleep(3000);
      const tr = await page.stopFrameTrace();
      const fs2 = await page.evaluate('Game.frameStats(120)');
      let inc = 0; for (let k = 1; k < tr.n; k++) { const d = tr.rows[k][0] - tr.rows[k - 1][0]; if (d > 0) inc += d; }
      const perFrame = tr.n > 1 ? inc / (tr.n - 1) : 0;
      add('steady frame CPU (avg of last 120)', fs2.cpuAvg.toFixed(2) + ' ms (p95 ' + fs2.cpuP95.toFixed(2) + ')', '≤ ' + LIM.cpu + ' ms', fs2.cpuAvg <= LIM.cpu);
      add('steady allocation per frame', (perFrame / 1024).toFixed(2) + ' KB (' + tr.n + ' frames)', '≤ 1 KB', perFrame <= 1024, 'includes the probe\'s own sample array');
      add('frame interval (info)', fs2.gapAvg.toFixed(1) + ' ms avg, max ' + fs2.gapMax.toFixed(1), 'info', true);
    }
    // 11) reset ("Baştan") <= 100 ms, 12) next level ready
    await mark("11) reset (\"Baştan\") <= 100 ms, 12) next lev");
    {
      far = await page.evaluate(PICK_FAR); if (far) { await page.evaluate(`Game.cmd({t:'tap', cell:${far.cell}})`); await idle(page); }
      const ms = await page.evaluate(`new Promise(res=>{ const t0=performance.now(); Game.cmd({t:'reset'}); const chk=()=>{ const st=Game.state(); if (!st.busy && st.hist===0) res(performance.now()-t0); else requestAnimationFrame(chk); }; requestAnimationFrame(chk); })`);
      add('"Baştan" (reset) → playable', ms.toFixed(1) + ' ms', '≤ ' + LIM.reset + ' ms', ms <= LIM.reset);
      const lv = await levelsOf(page); const nxt = lv[Math.min(lv.length - 1, 1)].id;
      const ms2 = await page.evaluate(`(async()=>{ const t0=performance.now(); await Game.load(${JSON.stringify(nxt)}); return performance.now()-t0; })()`);
      add('level switch (Game.load) → playable', ms2.toFixed(0) + ' ms', '≤ ' + LIM.next + ' ms', ms2 <= LIM.next);
    }
    // 13) distance table ready (Worker), biggest R1 level
    await mark("13) distance table ready (Worker), biggest R");
    {
      const lv = await levelsOf(page); const big = lv.slice().sort((a, b) => (b.states || 0) - (a.states || 0))[0];
      const ms = await page.evaluate(`new Promise(res=>{ const t0=performance.now(); const off=PX.bus.on('solver:ready', p=>{ if (p.id===${JSON.stringify(big.id)}) { off(); res({ms:performance.now()-t0, states:p.states}); } }); Game.load(${JSON.stringify(big.id)}); setTimeout(()=>{off(); res(null);}, 20000); })`, 30000);
      add(`distance table ready (${big.id}, ${big.states} states)`, ms ? ms.ms.toFixed(0) + ' ms' : 'timeout', '≤ ' + LIM.dist + ' ms', !!ms && ms.ms <= LIM.dist);
    }
    // 14) long tasks (> 50 ms) during this run, attributed to the step that was running
    {
      await sleep(300);
      const lt = await page.evaluate('(window.__lt||[]).filter(e => e[0] > window.__runT0).map(e => { const m = (window.__marks||[]).filter(x => x[0] <= e[0]).pop(); return [e[0], e[1], m ? m[1] : "?"]; })');
      add('long tasks (> 50 ms) during run', lt.length + (lt.length ? ' (max ' + Math.max(...lt.map(e => e[1])).toFixed(0) + ' ms)' : ''), '0', lt.length === 0, lt.map(e => e[1].toFixed(0) + ' ms in ' + e[2]).join('; '));
    }
    await page.setCPUThrottle(1);
  }
  async function flow() {
    const res = makeResult('flow');
    const rows = [];
    const cpus = (opt('cpu') || '1,4').split(',').map(Number).filter(x => x >= 1);
    await withPage(PHONE, async page => {
      await open(page, { lvl: 'P1' });
      await page.evaluate('window.__flowT0 = performance.now()');
      for (const c of cpus) { try { await flowRun(page, c, res, rows); } catch (e) { res.fail(`[${c}x] crashed: ${e.message.split('\n')[0]}`); await page.setCPUThrottle(1).catch(() => {}); } }
      const ex = page.exceptions(); if (ex.length) res.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 900000, 'flow').catch(e => res.fail('harness/page error: ' + e.message));
    for (const l of table(rows, ['cpu', 'metric', 'value', 'limit', 'pass', 'note'])) res.info(l);
    res.note('not measured by this suite: spawn ≤ 450 ms, skippable 900 ms win celebration, overlay transitions, drag release spring');
    flush(res); return res;
  }

  // ------------------------------------------------------------------ grounding
  // Independent of render/volti code: the sampler reads Volti's foot point and checks it against the level
  // geometry (sim2 L.G, render coordinates: cube centres, tile top = y + 0.5). Walking surface under the foot:
  //   tile          highest block/wall/element top (≤ foot + 0.01) in the column(s) under the foot;
  //   stair cell    the incline plane y + u (u = offset from the stair centre along its uphill direction, −0.5…0.5);
  //                 treads may deviate by STAIR_TOL (stepped steel treads on the plane), sim2 walkPath h = y + 0.5;
  //   ladder        Volti is "on the ladder" when his (x,z) is within the ladder column or its face (≤ 0.75 from the
  //                 rung axis) and his foot is between the foot landing and the top landing: no ground error there.
  // The body (foot+0.05 … foot+0.9) must never be strictly inside a solid cell (blocks, walls, elements); stair,
  // ladder and door cells are passable (stairs only above the incline).
  const GROUND_SAMPLE = `(()=>{ const p=PX.volti.probe(), L=PX.game.L, G=L.G, K=PX.SIM.KIND; const E=1e-4, TOL=0.13;
    const D=PX.SIM.DIRS; let ground=-1e9, pen=0, onStair=0, onLadder=0;
    const solidK=k=>k===K.blok||k===K.duvar||k===K.eleman;
    // merdiven: ayak bir merdiven hücresinin yatay izdüşümündeyse eğik düzlem
    const sx=Math.round(p.x), sz=Math.round(p.z);
    for (let y=0; y<G.H && !onStair; y++){ const c=G.idx(sx,y,sz); if (c<0||G.kind[c]!==K.merdiven) continue; const d=D[G.sdir[c]]; const u=(p.x-sx)*d[0]+(p.z-sz)*d[1];
      const h=y+u; if (Math.abs(p.footY-h)<=0.6) { onStair=1; ground=h; } }
    // iskele: ayak kafes sütununa yakın ve iki sahanlık arasında
    for (const ld of L.ladders) { const [lx,ly,lz]=G.xyz(ld.cells[0]); const top=G.xyz(ld.top)[1]+0.5, foot=G.xyz(ld.foot)[1]+0.5;
      const dd=D[ld.dir]; const ax=lx+dd[0]*0.5, az=lz+dd[1]*0.5; const off=Math.max(Math.abs(p.x-lx-dd[0]*0.25), Math.abs(p.z-lz-dd[1]*0.25));
      if (off<=0.75 && p.footY>=foot-0.02 && p.footY<=top+0.02 && (Math.abs(p.x-lx)<=1.01 && Math.abs(p.z-lz)<=1.01)) onLadder=1; }
    if (!onStair) { const cx=new Set([Math.floor(p.x+0.5-E), Math.floor(p.x+0.5+E)]), cz=new Set([Math.floor(p.z+0.5-E), Math.floor(p.z+0.5+E)]);
      for (const x of cx) for (const z of cz) { if (x<0||z<0||x>=G.W||z>=G.D) continue;
        for (let y=G.H-1; y>=0; y--) { const c=G.idx(x,y,z); if (c<0||!solidK(G.kind[c])) continue; const top=y+0.5;
          if (top <= p.footY+0.01) { if (top>ground) ground=top; break; } } } }
    const inside=(px,py,pz)=>{ const x=Math.round(px), y=Math.round(py), z=Math.round(pz); const c=G.idx(x,y,z); if (c<0) return false; const k=G.kind[c];
      if (k===K.merdiven) { const d=D[G.sdir[c]]; const u=(px-x)*d[0]+(pz-z)*d[1]; return py < y+u-0.15; }
      if (!solidK(k)) return false;
      return Math.abs(px-x)<0.5-1e-3 && Math.abs(py-y)<0.5-1e-3 && Math.abs(pz-z)<0.5-1e-3; };
    for (const h of [0.05,0.45,0.9]) if (inside(p.x,p.footY+h,p.z)) pen=1;
    const err = onLadder ? 0 : (onStair ? (Math.abs(p.footY-ground)<=TOL ? 0 : p.footY-ground) : p.footY-ground);
    return [p.footY, ground, err, (p.arc?1:0) + (onStair?2:0) + (onLadder?4:0), pen, p.moving?1:0, p.x, p.z]; })()`;
  async function grounding() {
    const res = makeResult('grounding');
    const rows = [];
    await withPage(PHONE, async page => {
      await open(page, { lvl: 'P1' });
      let lv = await levelsOf(page); const only = levelOpt(); if (only.length) lv = lv.filter(l => only.includes(l.id));
      for (const L of lv) {
        await loadLevel(page, L.id);
        await page.startFrameTrace(GROUND_SAMPLE, { width: 8, maxFrames: 60000 });
        // a) golden solution with animations, b) undo mid-walk, c) rotations both ways, d) reset
        await page.evaluate(`Game.replay(${JSON.stringify(L.cozum)}, {instant:false})`, 300000);
        await loadLevel(page, L.id);
        const far = await page.evaluate(PICK_FAR);
        if (far) { await page.evaluate(`Game.cmd({t:'tap', cell:${far.cell}})`); await sleep(150); await page.evaluate(`Game.cmd({t:'undo'})`); await idle(page);
          await page.evaluate(`Game.cmd({t:'tap', cell:${far.cell}})`); await idle(page); }
        for (const d of [1, 1, -1, -1]) { await page.evaluate(`Game.cmd({t:'rot', d:${d}})`); await idle(page); }
        await page.evaluate(`Game.cmd({t:'reset'})`); await page.frames(3);
        const tr = await page.stopFrameTrace();
        let bad = 0, maxErr = 0, arcs = 0, pens = 0, moving = 0, stairF = 0, ladderF = 0, firstBad = null;
        for (let k = 0; k < tr.n; k++) { const [foot, ground, err, flags, pen, mv, x, z] = tr.rows[k]; const arc = flags & 1;
          if (mv) moving++; if (arc) arcs++; if (flags & 2) stairF++; if (flags & 4) ladderF++;
          if (pen) { pens++; if (!firstBad) firstBad = `frame ${k}: body inside solid at (${x.toFixed(2)},${foot.toFixed(2)},${z.toFixed(2)})`; }
          // kural sürümü 4: atlama yayı YOK — yay bildiren kare de zemine oturmalı
          { const e = Math.abs(err); if (e > maxErr) maxErr = e; if (e > 1e-3) { bad++; if (!firstBad) firstBad = `frame ${k}: foot ${foot.toFixed(3)} vs ground ${ground.toFixed(3)} at (${x.toFixed(2)},${z.toFixed(2)})${arc ? ' (arc)' : ''}`; } }
        }
        const ok = bad === 0 && pens === 0 && tr.n > 0 && !tr.err;
        rows.push({ id: L.id, frames: tr.n, moving, stair: stairF, ladder: ladderF, arcs, floating: bad, inside: pens, maxErr: maxErr.toFixed(4), pass: ok, first: firstBad || tr.err || '' });
        if (!ok) res.fail(`${L.id}: ${bad} floating/sunk frame(s), ${pens} penetration frame(s); ${firstBad || tr.err || 'no frames'}`);
      }
      for (const l of table(rows, ['id', 'frames', 'moving', 'stair', 'ladder', 'arcs', 'floating', 'inside', 'maxErr', 'pass', 'first'])) res.info(l);
      const ex = page.exceptions(); if (ex.length) res.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 1800000, 'grounding').catch(e => res.fail('harness/page error: ' + e.message));
    flush(res); return res;
  }

  // ------------------------------------------------------------------ leak
  async function leak() {
    const res = makeResult('leak');
    await withPage(DESK, async page => {
      await open(page, { lvl: 'P1' });
      const lv = (await levelsOf(page)).map(l => l.id);
      await loadLevel(page, lv[0]); await sleep(300);
      const h0 = await page.heap(); const f0 = await page.evaluate('Game.frameStats()');
      for (let i = 0; i < 20; i++) { await loadLevel(page, lv[(i + 1) % lv.length]); await page.frames(2); }
      await loadLevel(page, lv[0]); await sleep(500);
      const h1 = await page.heap(); const f1 = await page.evaluate('Game.frameStats()');
      const grow = h1.usedSize - h0.usedSize;
      res.info(`heap ${(h0.usedSize / 1048576).toFixed(2)} MB -> ${(h1.usedSize / 1048576).toFixed(2)} MB (Δ ${(grow / 1048576).toFixed(2)} MB); geometries ${f0.geometries} -> ${f1.geometries}; textures ${f0.textures} -> ${f1.textures}`);
      pass(res, grow <= 2 * 1048576, `heap grew ${(grow / 1048576).toFixed(2)} MB after 20 level loads (limit 2 MB)`);
      pass(res, f1.geometries <= f0.geometries + 2, `GPU geometries grew ${f0.geometries} -> ${f1.geometries}`);
      pass(res, f1.textures <= f0.textures + 2, `GPU textures grew ${f0.textures} -> ${f1.textures}`);
      const ex = page.exceptions(); if (ex.length) res.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 300000, 'leak').catch(e => res.fail('harness/page error: ' + e.message));
    flush(res); return res;
  }

  // ------------------------------------------------------------------ storage
  async function storage() {
    const res = makeResult('storage');
    const KEY = 'paralaks2.kayit';
    const cases = [
      { name: '?nostorage', params: { lvl: 'P1', nostorage: true }, check: async (page, r) => {
        const si = await page.evaluate('Game.storeInfo()'); pass(r, si && si.available === false, 'store.available should be false, got ' + JSON.stringify(si));
        const t = await page.evaluate('(document.querySelector("[data-testid=toast]")||{}).textContent||""'); r.info('toast: ' + JSON.stringify(t));
        if (!/Kayıt kapalı/.test(t)) r.note('"Kayıt kapalı" toast not visible at check time'); } },
      { name: 'localStorage throws', params: { lvl: 'P1' }, init: `try{Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('blocked','SecurityError')}})}catch(e){}`,
        check: async (page, r) => { const si = await page.evaluate('Game.storeInfo()'); pass(r, si && si.available === false, 'store.available should be false, got ' + JSON.stringify(si)); } },
      { name: 'corrupt save', params: { lvl: 'P1' }, init: `try{ if(!sessionStorage.getItem('__c')){ sessionStorage.setItem('__c','1'); localStorage.setItem('${KEY}','{bozuk json'); } }catch(e){}`,
        check: async (page, r) => { const sv = await page.evaluate('Game.save()'); pass(r, sv && sv.v === 1 && sv.ayar && typeof sv.ayar.ses === 'number', 'save not reset to defaults: ' + JSON.stringify(sv).slice(0, 120));
          const bk = await page.evaluate(`localStorage.getItem('${KEY}.bozuk')`); pass(r, bk === '{bozuk json', 'corrupt save not backed up'); } },
      { name: 'migration v0 -> v1', params: { lvl: 'P1' }, init: `try{ if(!sessionStorage.getItem('__m')){ sessionStorage.setItem('__m','1'); localStorage.setItem('${KEY}', JSON.stringify({settings:{ses:0.2}, seviye:{P1:{cozuldu:true,en:{},gecmis:[],muhur:[]}}, ozelAnahtar:42})); } }catch(e){}`,
        check: async (page, r) => { const sv = await page.evaluate('Game.save()');
          pass(r, sv && sv.v === 1, 'v != 1: ' + JSON.stringify(sv).slice(0, 160)); pass(r, sv && sv.ayar && sv.ayar.ses === 0.2, 'ayar.ses not migrated');
          pass(r, sv && sv.seviye && sv.seviye.P1 && sv.seviye.P1.cozuldu === false, 'unproved legacy win carried into physical rules');
          pass(r, sv && sv.arsiv && sv.arsiv.some(a => a.seviye.P1 && a.seviye.P1.cozuldu === true), 'legacy P1 not preserved in archive');
          pass(r, sv && sv.erisilen && sv.erisilen.includes('P1'), 'legacy P1 access lost');
          pass(r, sv && sv.ozelAnahtar === 42, 'unknown key not preserved'); } },
      { name: 'persist win across reload', params: { lvl: 'P1' }, check: async (page, r) => {
          const lv = (await levelsOf(page))[0];
          const rp = await page.evaluate(`Game.replay(${JSON.stringify(lv.cozum)}, {instant:true})`); pass(r, rp.won, 'replay did not win');
          await page.goto(GAME, { debug: true, lvl: lv.id }); await page.waitFor(READY, 30000);
          const sv = await page.evaluate('Game.save()'); pass(r, sv && sv.seviye && sv.seviye[lv.id] && sv.seviye[lv.id].cozuldu === true, 'win not persisted: ' + JSON.stringify(sv && sv.seviye).slice(0, 160)); } },
    ];
    const per = await Promise.all(cases.map(c => {
      const r = makeResult('storage ' + c.name);
      return withPage(PHONE, async page => {
        try { await open(page, c.params, c.init); } catch (e) { r.fail('Game.ready never became true: ' + e.message.split('\n')[0]); return r; }
        await sleep(400);
        await c.check(page, r);
        const ex = page.exceptions(); if (ex.length) r.fail(ex.length + ' uncaught exception(s): ' + fmtLogs(page, ex).slice(0, 4).join(' | '));
        return r;
      }, 120000, 'storage ' + c.name).catch(e => { r.fail('harness/page error: ' + e.message); return r; });
    }));
    per.forEach((r, i) => { console.log(' [' + (r.pass ? 'PASS' : 'FAIL') + '] ' + cases[i].name); flush(r); if (!r.pass) { res.pass = false; res.failures.push(...r.failures.map(f => cases[i].name + ': ' + f)); } });
    return res;
  }

  // ------------------------------------------------------------------ touchplay
  async function touchplay() {
    const res = makeResult('touchplay');
    const ids = levelOpt().length ? levelOpt() : ['P1', 'M1'];
    // Kural sürümü 4: dizgide döndürme yok. Hedef karo/cihaz o anki görünümde seçilemiyorsa (önünde blok) oyuncunun
    // yapacağı gibi kamera KAYDIRMAYLA döndürülür (yalnız bakış; Hamle/defter değişmez) ve yeniden denenir.
    await withPage(PHONE, async page => {
      await open(page, { lvl: ids[0] });
      for (const id of ids) {
        const r = makeResult('touchplay ' + id);
        try {
          const L = (await levelsOf(page)).find(l => l.id === id); if (!L) throw new Error('level not embedded');
          await page.goto(GAME, { debug: true, lvl: id }); await page.waitFor(READY, 30000); await idle(page); await sleep(200);
          const toks = L.cozum.split(' ');
          r.info('golden (' + toks.length + ' commands): ' + L.cozum);
          const histNow = () => page.evaluate('Game.state().hist');
          const waitHist = async (n0, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await histNow() > n0) return true; await sleep(30); } return false; };
          const canvasBox = await page.evaluate(`(()=>{const b=document.querySelector('canvas#game-canvas').getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height}})()`);
          if (/(^|\s)(d[+-]|p)(\s|$)/.test(L.cozum)) throw new Error('v3 token (d±/p) in golden string');
          let swipes = 0;
          // hücrenin ekran noktası seçimde o hücreyi veriyorsa nokta; değilse kaydır (en çok 3 kez)
          const aim = async (cell, isEl, id) => {
            for (let k = 0; k < 4; k++) {
              const pt = isEl ? await page.evaluate(`Game.screenOfEl(${JSON.stringify(id)})`) : await page.evaluate(`Game.screenOfTile(${cell})`);
              const o = await page.evaluate(`Game.ownerAt(${pt.x},${pt.y})`);
              if (o && o.cell === cell) return pt;
              const cx = canvasBox.x + canvasBox.w / 2, cy = canvasBox.y + canvasBox.h * 0.3, dx = 0.3 * canvasBox.w;
              await page.swipe(cx + dx / 2, cy, cx - dx / 2, cy + 2, { durationMs: 220 }); await idle(page); swipes++;
            }
            throw new Error((isEl ? id : 'tile ' + cell) + ': not pickable in any view');
          };
          for (const tok of toks) {
            const n0 = await histNow(); const st = await page.evaluate('Game.state()');
            if (tok[0] === 'g') {
              const cell = await page.evaluate(`Game.tileCell(${+tok.slice(1)})`); const pt = await aim(cell, false);
              await page.tap(pt.x, pt.y, 40);
              if (!await waitHist(n0)) throw new Error(`${tok}: tap at (${pt.x.toFixed(1)},${pt.y.toFixed(1)}) not accepted; owner=${JSON.stringify(await page.evaluate(`Game.ownerAt(${pt.x},${pt.y})`))}`);
            } else {
              const d = await page.evaluate(`Game.decode(${JSON.stringify(tok)})`); if (!d) throw new Error(tok + ': cannot decode');
              const pt = d.el ? await aim(d.elCell, true, d.el) : await aim(st.s.p, false);
              await page.tap(pt.x, pt.y, 40);
              const sel = `[data-testid=chip][data-tok="${tok}"]`;
              const chipUp = `(()=>{const b=document.querySelector('${sel}'); return !!b && b.getBoundingClientRect().width>0})()`;
              let shown = false;
              try { await page.waitFor(chipUp, 4000, 40); shown = true; } catch (e) { /* aşağıda kurtarma */ }
              if (!shown) {
                // kurtarma: yoğun sayfada dokunuş uzun basış sayılıp cihaz kartı açılmış olabilir (pointerdown→up arası
                // > 450 ms). Kart kapatılır, kısa dokunuşla bir kez yeniden denenir; yine çıkmazsa gerçek hata.
                const sheets = await page.evaluate('PX.cards.top()');
                if (sheets) { r.info(`${tok}: long-press misfire recovered (${sheets} sheet)`); await page.evaluate('PX.cards.closeAll()'); await sleep(250); }
                await idle(page); await page.tap(pt.x, pt.y, 25);
                try { await page.waitFor(chipUp, 6000, 40); shown = true; } catch (e) { /* hata */ }
              }
              if (!shown) throw new Error(`${tok}: chip not shown after tapping ${d.el || 'own tile'} (chips: ${JSON.stringify(await page.evaluate('Game.chips()'))})`);
              const c = await page.evaluate(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
              await page.tap(c.x, c.y, 40); if (!await waitHist(n0)) throw new Error(tok + ': chip tap not accepted');
            }
            await idle(page);
          }
          let winVis = false;
          try { await page.waitFor(`(()=>{const w=document.querySelector('[data-testid=win-panel]'); if(!w) return false; const s=getComputedStyle(w); return s.display!=='none' && s.visibility!=='hidden' && w.getBoundingClientRect().width>0})()`, 8000); winVis = true; } catch (_) {}
          const fin = await page.evaluate('Game.state()');
          r.info(`final: tot ${vecStr(fin.presentation.tot)} (opt ${JSON.stringify(L.opt.hamle)}), won ${fin.presentation.won}, win panel ${winVis ? 'visible' : 'NOT visible'}, camera swipes ${swipes}`);
          pass(r, winVis, 'win panel did not appear'); pass(r, eqVec(fin.presentation.tot, L.opt.hamle), 'totals differ from golden');
        } catch (e) { r.fail(id + ': ' + e.message.split('\n')[0]); }
        await page.screenshot(path.join(OUT, 'v2-touchplay-' + id + '.png')).catch(() => {});
        console.log(' [' + (r.pass ? 'PASS' : 'FAIL') + '] ' + id); flush(r);
        if (!r.pass) { res.pass = false; res.failures.push(...r.failures); }
      }
      const ex = page.exceptions(); if (ex.length) res.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 900000, 'touchplay').catch(e => res.fail('harness/page error: ' + e.message));
    flush(res); return res;
  }

  // ------------------------------------------------------------------ smoke
  // v1 sloganları (§11.3/§13): durum ETİKETİ olarak "Pano yandı", "Devre açık", "Kısa Devre" yasak. Fiil kalıbındaki
  // teknik terim serbest: "kısa devre edilir/edildi" (topraklama ritüeli, sim2.describe), EN 50110-1 4. kuralının emir
  // kipi "topraklayıp kısa devre et" ve fizik açıklaması "… kısa devre olur/oluşur".
  const BANNED = [/pano\s+yand[ıi]/i, /devre\s+a[çc][ıi]k/i, /k[ıi]sa[\s-]+devre(?!\s+(?:edil|et\b|eder|olur|oluş))/i];
  async function smoke() {
    const res = makeResult('smoke');
    const src = fs.readFileSync(GAME, 'utf8');
    for (const re of BANNED) { const m = src.match(re); if (m) res.fail('banned phrase in build: "' + m[0] + '" (spec §11.3/§13)'); }
    // viewport'lar SIRAYLA açılır: dört SwiftShader (yazılımsal GPU) Chrome'u aynı anda kare çizince CDP yanıtları
    // 5–16 s gecikiyor ve paket düzen yerine makine yükünü ölçüyordu (R1 entegrasyonu). Denetimler aynı.
    const per = [];
    for (const vp of VIEWPORTS) per.push(await (() => {
      const r = makeResult('smoke ' + vp.name);
      return withPage(vp, async page => {
        try { await open(page, { lvl: 'P1' }); } catch (e) { r.fail('Game.ready never became true: ' + e.message.split('\n')[0]); }
        await sleep(800); await page.frames(3);
        r.info('screenshot ' + await page.screenshot(path.join(OUT, 'v2-' + vp.name + '.png')));
        const L = await page.evaluate(LAYOUT_PROBE);
        if (!L.webgl) r.fail('WebGL unavailable');
        if (!L.canvas) r.fail('canvas#game-canvas missing');
        else {
          r.info('canvas ' + rs(L.canvas) + '  hud-top ' + rs(L.hudTop) + '  hud-controls ' + rs(L.hudControls));
          if (L.canvas.w < 1 || L.canvas.h < 1) r.fail('canvas has zero size');
          for (const [k, nm] of [['hudTop', 'hud-top'], ['hudControls', 'hud-controls']]) {
            if (!L[k]) { r.fail('[data-testid=' + nm + '] missing'); continue; }
            if (!L[k + 'Vis']) r.fail('[data-testid=' + nm + '] not visible in game');
            const o = overlap(L[k], L.canvas); if (o) r.fail(nm + ' overlaps canvas by ' + o.w + 'x' + o.h + ' px');
          }
          if (L.hudTop && L.hudControls && overlap(L.hudTop, L.hudControls)) r.fail('hud-top overlaps hud-controls');
        }
        const vis = L.buttons.filter(b => b.vis);
        r.info('visible buttons: ' + vis.map(b => b.id + ' ' + b.rect.w.toFixed(0) + 'x' + b.rect.h.toFixed(0)).join(', '));
        if (!vis.length) r.fail('no visible [data-testid^=btn-] buttons');
        for (const b of vis) { const R = b.rect;
          if (R.w < 44 - 0.01 || R.h < 44 - 0.01) r.fail(b.id + ' too small: ' + R.w.toFixed(1) + 'x' + R.h.toFixed(1) + ' (< 44x44)');
          if (R.x < -0.5 || R.y < -0.5 || R.r > L.vw + 0.5 || R.b > L.vh + 0.5) r.fail(b.id + ' outside viewport: ' + rs(R)); }
        for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) { const o = overlap(vis[i].rect, vis[j].rect); if (o) r.fail(vis[i].id + ' overlaps ' + vis[j].id); }
        if (L.scrollWidth > L.vw) r.fail('horizontal page scroll: ' + L.scrollWidth + ' > ' + L.vw);
        const txt = await page.evaluate('document.body.innerText'); for (const re of BANNED) if (re.test(txt)) r.fail('banned phrase on screen: ' + re);
        const errs = page.errors(); if (errs.length) r.fail(errs.length + ' console error(s)/exception(s):\n      ' + fmtLogs(page, errs).join('\n      '));
        return r;
      }, 120000, 'smoke ' + vp.name).catch(e => { r.fail('harness/page error: ' + e.message); return r; });
    })());
    per.forEach((r, i) => { const vp = VIEWPORTS[i]; console.log(' [' + (r.pass ? 'PASS' : 'FAIL') + '] ' + vp.name + ' (' + vp.label + ')'); flush(r); if (!r.pass) { res.pass = false; res.failures.push(...r.failures.map(f => vp.name + ': ' + f)); } });
    flush(res); return res;
  }

  // ------------------------------------------------------------------ reach (kural sürümü 4)
  // Her seviye, başlangıçta VE altın çözümün her manevrasından sonra: her cihaz/kapı/merdiven/iskele hücresine dokunuş
  // ya yürür (cmd:accepted), ya çip/kart açar, ya da NEDENLE reddedilir (msg + adlandırılmış engeller + vurgu hücreleri).
  // Sessiz ret (bos / mesajsız) = hata. Gerçek dokunuş: erişilemeyen bir hedefte neden kartı DOM'da görünür; cihaz
  // kartındaki "Volti'yi gönder" yürür ya da aynı kartı açar.
  const REACH_PROBE = `(async (str) => {
    const L = Game.L(); const K = PX.SIM.KIND; const out = { taps: 0, walk: 0, chip: 0, card: 0, why: 0, silent: [], blockers: {}, unexplained: [] };
    const targets = []; for (const e of L.els) if (e.cell >= 0 && e.t !== 'kablo' && e.t !== 'yardimci') targets.push({ c: e.cell, id: e.id });
    for (const x of L.stairs) targets.push({ c: x.cell, id: 'merdiven@' + x.cell }); for (const x of L.ladders) targets.push({ c: x.cells[0], id: 'iskele@' + x.cells[0] });
    const toks = String(str || '').split(' ').filter(Boolean); const states = [0]; { let k = 0; for (const t of toks) { k++; if (!/^g/.test(t)) states.push(k); } }
    for (const upto of states) {
      PX.game.setInstant(true); PX.game.command({ t: 'reset' });
      for (const t of toks.slice(0, upto)) { PX.game.command({ t: 'act', tok: t }); await Promise.resolve(); await Promise.resolve(); }
      await Game.idle(5000); if (PX.game.state().won) continue;
      for (const tg of targets) {
        const ev = []; const offs = ['cmd:accepted', 'cmd:rejected', 'ui:chip', 'ui:longpress'].map(t => PX.bus.on(t, p => ev.push([t, p])));
        const hist0 = PX.game.state().hist; const ok = PX.game.command({ t: 'tap', cell: tg.c, src: 'reach' }); await Promise.resolve(); await Promise.resolve();
        offs.forEach(f => f()); out.taps++;
        const acc = ev.find(e => e[0] === 'cmd:accepted'), rej = ev.find(e => e[0] === 'cmd:rejected'), chip = ev.find(e => e[0] === 'ui:chip' && e[1].actions && e[1].actions.length), card = ev.find(e => e[0] === 'ui:longpress');
        if (ok && acc) out.walk++; else if (ok && chip) out.chip++; else if (ok && card) out.card++;
        else if (ok && PX.game.state().hist === hist0) { out.chip++; }                                  // kendi karosu: çip (boşta)
        else if (!ok && rej && rej[1].msg && rej[1].err !== 'bos') { out.why++;
          const p = rej[1]; if (p.reason) { for (const b of (p.blockers || [])) out.blockers[b.err] = (out.blockers[b.err] || 0) + 1; if (!p.blockers || !p.blockers.length || !p.msg) out.unexplained.push(tg.id + '@' + upto + ':' + p.err); } }
        else out.silent.push(tg.id + '@' + upto + ':' + (rej ? rej[1].err : (ok ? 'kabul/olay yok' : 'ret yok')));
        if (PX.game.state().hist > hist0) PX.game.command({ t: 'undo' });
        await Promise.resolve();
      }
    }
    PX.game.setInstant(false); PX.game.command({ t: 'reset' });
    return out; })`;
  async function reach() {
    const res = makeResult('reach');
    const rows = [];
    await withPage(PHONE, async page => {
      await open(page, { lvl: 'P1' });
      let lv = await levelsOf(page); const only = levelOpt(); if (only.length) lv = lv.filter(l => only.includes(l.id));
      for (const L of lv) {
        await loadLevel(page, L.id);
        const r = await page.evaluate(`(${REACH_PROBE})(${JSON.stringify(L.cozum || '')})`, 300000);
        const ok = !r.silent.length && !r.unexplained.length;
        rows.push({ id: L.id, taps: r.taps, walk: r.walk, chips: r.chip, card: r.card, reason: r.why, blockers: Object.entries(r.blockers).map(([k, v]) => k + ':' + v).join(' '), silent: r.silent.length, pass: ok,
          first: (r.silent[0] || r.unexplained[0] || '') });
        if (!ok) res.fail(`${L.id}: ${r.silent.length} silent tap(s), ${r.unexplained.length} unexplained rejection(s): ${r.silent.concat(r.unexplained).slice(0, 6).join(', ')}`);
        // gerçek dokunuş: başlangıçta erişilemeyen bir cihaz (varsa) -> neden kartı görünür; kartta "… yanına git"
        await loadLevel(page, L.id);
        const un = await page.evaluate(`(()=>{ const L=Game.L(), s=PX.game.state().s; const OPS={kesici:1,ayirici:1,yuk_ayirici:1,toprak:1,sigorta:1,buton:1}; for (let e=0;e<L.els.length;e++){ const el=L.els[e]; if (el.cell<0||!L.approach[e]||!L.approach[e].length||!(OPS[el.t]||el.lk>=0||(el.t==='bara'&&L.nSet>0))) continue; if (PX.SIM.approachTile(L,s,e)<0) return el.id; } return null; })()`);
        if (un) {
          const pt = await page.evaluate(`Game.screenOfEl(${JSON.stringify(un)})`); const o = await page.evaluate(`Game.ownerAt(${pt.x},${pt.y})`);
          const elCell = await page.evaluate(`Game.L().els[Game.L().elIndex[${JSON.stringify(un)}]].cell`);
          if (o && o.cell === elCell) {
            await page.tap(pt.x, pt.y, 40);
            let shown = false; try { await page.waitFor(`(()=>{const b=document.querySelector('[data-testid=reason]'); return !!b && !b.hidden && b.getBoundingClientRect().height>20})()`, 3000, 40); shown = true; } catch (e) { /* aşağıda */ }
            const txt = shown ? await page.evaluate(`document.querySelector('[data-testid=reason]').innerText`) : '';
            rows.push({ id: L.id, taps: 'dokunuş ' + un, walk: '', chips: '', card: '', reason: shown ? 'kart' : 'YOK', blockers: txt.replace(/\s+/g, ' ').slice(0, 60), silent: '', pass: shown, first: '' });
            if (!shown) res.fail(L.id + ': touch on unreachable ' + un + ' did not show the reason card');
            await page.evaluate('PX.cards.hideReason && PX.cards.hideReason(true)');
          } else rows.push({ id: L.id, taps: 'dokunuş ' + un, walk: '', chips: '', card: '', reason: 'atlandı (seçilemiyor)', blockers: '', silent: '', pass: true, first: '' });
        }
        // "Volti'yi gönder": işletilebilir her cihazın kartından -> yürüyüş/çip ya da neden (asla sessiz değil)
        const send = await page.evaluate(`(async()=>{ const L=Game.L(); const out={n:0,bad:[]}; for (const e of L.els) { if (e.cell<0||!L.approach[e.i]||!L.approach[e.i].length) continue;
            PX.game.command({t:'reset'}); PX.cards.closeAll(); await new Promise(r=>setTimeout(r,260)); PX.cards.device(e, L); await new Promise(r=>requestAnimationFrame(()=>r())); const shs=document.querySelectorAll('[data-testid=sheet]'); const sh=shs[shs.length-1]; const b=sh?sh.querySelector('[data-testid=btn-send]'):null; const OPS={kesici:1,ayirici:1,yuk_ayirici:1,toprak:1,sigorta:1,buton:1}; const s0=PX.game.state().s; const want=(OPS[e.t]||e.lk>=0||(e.t==='bara'&&L.nSet>0)) && !(e.t==='sigorta'&&e.lk<0&&((s0.b>>e.bit)&1)); if (!want) { if (b) out.bad.push(e.id+':gereksiz düğme'); PX.cards.closeAll(); continue; } if (!b) { out.bad.push(e.id+':düğme yok'); PX.cards.closeAll(); continue; }
            const ev=[]; const offs=['cmd:accepted','cmd:rejected','ui:chip','ui:longpress'].map(t=>PX.bus.on(t,p=>ev.push([t,p]))); b.click(); offs.forEach(f=>f()); out.n++;
            const okk = ev.some(x=>x[0]==='cmd:accepted') || ev.some(x=>x[0]==='ui:chip'&&x[1].actions&&x[1].actions.length) || ev.some(x=>x[0]==='cmd:rejected'&&x[1].msg) || PX.game.state().busy;
            if (!okk) out.bad.push(e.id+':sessiz '+JSON.stringify(ev.map(x=>x[0]))); PX.cards.closeAll(); if (PX.cards.hideReason) PX.cards.hideReason(true); }
          PX.game.command({t:'reset'}); return out; })()`, 60000);
        rows.push({ id: L.id, taps: 'gönder ' + send.n, walk: '', chips: '', card: '', reason: '', blockers: '', silent: send.bad.length, pass: !send.bad.length, first: send.bad.slice(0, 3).join(' ') });
        if (send.bad.length) res.fail(L.id + ': "Volti\'yi gönder" silent/missing for ' + send.bad.join(', '));
      }
      for (const l of table(rows, ['id', 'taps', 'walk', 'chips', 'card', 'reason', 'blockers', 'silent', 'pass', 'first'])) res.info(l);
      const ex = page.exceptions(); if (ex.length) res.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 1800000, 'reach').catch(e => res.fail('harness/page error: ' + e.message));
    flush(res); return res;
  }

  const RU = require('./regress_ui')(ctx);
  return { verify, smoke, storage, replay, parity, flow, grounding, touchplay, leak, reach, ui: RU.ui, daily: RU.daily,
    ALL: ['verify', 'smoke', 'storage', 'replay', 'daily', 'parity', 'reach', 'flow', 'grounding', 'touchplay', 'ui', 'leak'] };
};
