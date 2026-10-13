#!/usr/bin/env node
'use strict';
// Headless test runner for PARALAKS (index.html). Zero dependencies.
// Usage: node tools/test/run.js <suite|all>[,suite…] [--file <path>|--file=<path>] [--v1|--v2] [--levels=P1,M1] [--cpu=1,4] [--realtime]
//   v1 suites (legacy page): smoke verify parity leak touchplay storage selftest
//   v2 suites (PARALAKS: TEK HAT, auto-detected by the //#PX2-BUILD marker, see suites2.js):
//      verify replay parity reach flow grounding leak storage touchplay smoke ui daily
//   --file defaults to <root>/index.html. Exit code 1 if any suite fails.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cdp = require('./cdp');
const { sleep } = cdp;

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const argv = process.argv.slice(2);
const VALUE_FLAGS = ['file', 'levels', 'cpu', 'vfile', 'parts'];
const opt = k => {
  const a = argv.find(x => x.startsWith('--' + k + '=')); if (a) return a.slice(k.length + 3);
  const i = argv.indexOf('--' + k); if (i < 0) return null;
  if (VALUE_FLAGS.includes(k)) return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  return true;
};
const positional = argv.filter((x, i) => !x.startsWith('--') && !(i > 0 && VALUE_FLAGS.some(k => argv[i - 1] === '--' + k)));
const GAME = path.resolve(opt('file') || path.join(ROOT, 'index.html'));
let IS_V2 = false;
try { IS_V2 = argv.includes('--v2') || (!argv.includes('--v1') && fs.existsSync(GAME) && /\/\/#PX2-BUILD/.test(fs.readFileSync(GAME, 'utf8'))); } catch (_) { IS_V2 = argv.includes('--v2'); }
const LEGACY = path.join(ROOT, 'legacy', 'devre-v1.html');

// ---------------------------------------------------------------- helpers
function makeResult(name) {
  const r = { name, pass: true, failures: [], notes: [], lines: [] };
  r.fail = msg => { r.pass = false; r.failures.push(msg); r.lines.push('  FAIL ' + msg); };
  r.note = msg => { r.notes.push(msg); r.lines.push('  note ' + msg); };
  r.info = msg => { r.lines.push('  ' + msg); };
  return r;
}
function flush(r) { for (const l of r.lines) console.log(l); r.lines = []; }

function withTimeout(promise, ms, label) {
  let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('TIMEOUT after ' + ms + 'ms: ' + label)), ms); });
  return Promise.race([promise, to]).finally(() => clearTimeout(t));
}

/** launch -> fn(page) with an overall timeout; Chrome is always killed and its profile removed. */
async function withPage(launchOpts, fn, timeoutMs, label) {
  let page = null;
  try {
    page = await cdp.launch(launchOpts);
    return await withTimeout(fn(page), timeoutMs, label);
  } finally { if (page) await page.close(); }
}

const fmtLogs = (page, logs) => logs.map(l => page.formatLog(l).replace(/\n/g, '\n        '));

function table(rows, prefer) {
  if (!Array.isArray(rows) || !rows.length) return ['  (no rows)'];
  const keys = [];
  for (const k of prefer) if (rows.some(r => r && k in r)) keys.push(k);
  for (const r of rows) for (const k of Object.keys(r || {})) if (!keys.includes(k)) keys.push(k);
  const cell = v => { let s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return s.length > 70 ? s.slice(0, 67) + '...' : s; };
  const data = rows.map(r => keys.map(k => cell(r && r[k])));
  const w = keys.map((k, i) => Math.max(k.length, ...data.map(d => d[i].length)));
  const line = cols => '  ' + cols.map((c, i) => c.padEnd(w[i])).join(' | ');
  return [line(keys), '  ' + w.map(n => '-'.repeat(n)).join('-+-'), ...data.map(line)];
}

const VIEWPORTS = [
  { name: '375x667', label: 'portrait mobile', width: 375, height: 667, mobile: true, touch: true, dpr: 2 },
  { name: '360x640', label: 'portrait mobile', width: 360, height: 640, mobile: true, touch: true, dpr: 2 },
  { name: '667x375', label: 'landscape mobile', width: 667, height: 375, mobile: true, touch: true, dpr: 2 },
  { name: '1280x800', label: 'desktop', width: 1280, height: 800, mobile: false, touch: false, dpr: 1 },
];

const READY = 'window.Game && window.Game.ready === true';

// In-page layout probe (shared by smoke).
const LAYOUT_PROBE = `(() => {
  const R = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const vis = el => {
    if (!el || !el.isConnected) return false;
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    }
    const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0;
  };
  const q = s => document.querySelector(s);
  return {
    vw: innerWidth, vh: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    scrollX: scrollX, scrollY: scrollY,
    canvas: R(q('canvas#game-canvas')), canvasVis: vis(q('canvas#game-canvas')),
    hudTop: R(q('[data-testid=hud-top]')), hudTopVis: vis(q('[data-testid=hud-top]')),
    hudControls: R(q('[data-testid=hud-controls]')), hudControlsVis: vis(q('[data-testid=hud-controls]')),
    titleVis: vis(q('[data-testid=title-screen]')),
    buttons: [...document.querySelectorAll('[data-testid^="btn-"]')].map(b => ({ id: b.dataset.testid, vis: vis(b), rect: R(b) })),
    webgl: !!document.createElement('canvas').getContext('webgl'),
  };
})()`;

function overlap(a, b) {
  const w = Math.min(a.r, b.r) - Math.max(a.x, b.x), h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5 ? { w: +w.toFixed(1), h: +h.toFixed(1) } : null;
}
const rs = r => r ? `[${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}x${r.h.toFixed(1)}]` : 'null';

// ---------------------------------------------------------------- suites
async function smoke() {
  const res = makeResult('smoke');
  fs.mkdirSync(OUT, { recursive: true });
  // Viewports run concurrently (each in its own Chrome); output is printed in order.
  const per = await Promise.all(VIEWPORTS.map(vp => {
    const r = makeResult('smoke ' + vp.name);
    return withPage(vp, async page => {
      await page.goto(GAME, { lvl: 3 });
      try { await page.waitFor(READY, 30000); }
      catch (e) { r.fail('Game.ready never became true: ' + e.message.split('\n')[0]); }
      await sleep(1500); await page.frames(3);
      const shot = await page.screenshot(path.join(OUT, vp.name + '.png'));
      r.info('screenshot ' + shot);
      const L = await page.evaluate(LAYOUT_PROBE);
      if (!L.webgl) r.fail('WebGL unavailable in headless Chrome (harness/GPU flags)');
      if (L.titleVis) r.note('title-screen is visible after ?lvl=3 load');
      if (!L.canvas) r.fail('canvas#game-canvas missing');
      else {
        r.info('canvas ' + rs(L.canvas) + '  hud-top ' + rs(L.hudTop) + '  hud-controls ' + rs(L.hudControls));
        if (L.canvas.w < 1 || L.canvas.h < 1) r.fail('canvas has zero size ' + rs(L.canvas));
        for (const [k, nm] of [['hudTop', 'hud-top'], ['hudControls', 'hud-controls']]) {
          if (!L[k]) { r.fail('[data-testid=' + nm + '] missing'); continue; }
          if (!L[k + 'Vis']) r.note('[data-testid=' + nm + '] not visible');
          const o = overlap(L[k], L.canvas);
          if (o) r.fail(nm + ' ' + rs(L[k]) + ' overlaps canvas ' + rs(L.canvas) + ' by ' + o.w + 'x' + o.h + ' px');
        }
      }
      const visBtns = L.buttons.filter(b => b.vis);
      r.info('visible buttons: ' + (visBtns.map(b => b.id + ' ' + b.rect.w.toFixed(0) + 'x' + b.rect.h.toFixed(0)).join(', ') || '(none)'));
      if (!visBtns.length) r.fail('no visible [data-testid^=btn-] buttons');
      for (const b of visBtns) {
        const R = b.rect;
        if (R.w < 44 - 0.01 || R.h < 44 - 0.01) r.fail(b.id + ' too small: ' + R.w.toFixed(1) + 'x' + R.h.toFixed(1) + ' (< 44x44)');
        if (R.x < -0.5 || R.y < -0.5 || R.r > L.vw + 0.5 || R.b > L.vh + 0.5) r.fail(b.id + ' outside viewport ' + L.vw + 'x' + L.vh + ': ' + rs(R));
      }
      if (L.scrollWidth > L.vw) r.fail('horizontal page scroll: scrollWidth ' + L.scrollWidth + ' > innerWidth ' + L.vw);
      const errs = page.errors();
      if (errs.length) r.fail(errs.length + ' console error(s)/exception(s):\n      ' + fmtLogs(page, errs).join('\n      '));
      return r;
    }, 120000, 'smoke ' + vp.name).catch(e => { r.fail('harness/page error: ' + e.message); return r; });
  }));
  for (let i = 0; i < VIEWPORTS.length; i++) {
    const r = per[i], vp = VIEWPORTS[i];
    console.log(' [' + (r.pass ? 'PASS' : 'FAIL') + '] ' + vp.name + ' (' + vp.label + ')');
    flush(r);
    if (!r.pass) { res.pass = false; res.failures.push(...r.failures.map(f => vp.name + ': ' + f)); }
  }
  return res;
}

function autoSuite(name, param, globalName, timeoutMs) {
  return async () => {
    const res = makeResult(name);
    await withPage({ width: 1280, height: 800 }, async page => {
      await page.goto(GAME, param);
      const t0 = Date.now(); let lastReport = t0, obj = null;
      for (;;) {
        obj = await page.evaluate(`(()=>{const o=window.${globalName};return o?JSON.parse(JSON.stringify(o)):null})()`).catch(() => null);
        if (obj && obj.done) break;
        if (Date.now() - t0 > timeoutMs) break;
        if (Date.now() - lastReport > 20000) {
          lastReport = Date.now();
          console.log('  ... waiting for ' + globalName + '.done (' + Math.round((Date.now() - t0) / 1000) + 's' + (obj && obj.rows ? ', rows so far: ' + obj.rows.length : '') + ')');
        }
        await sleep(250);
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!obj || !obj.done) {
        res.fail('window.' + globalName + '.done not set within ' + timeoutMs / 1000 + 's' + (obj ? ' (partial: ' + JSON.stringify(obj).slice(0, 300) + ')' : ' (object never created)'));
        if (obj && obj.rows) for (const l of table(obj.rows, ['id', 'name', 'pass', 'moves', 'par', 'reason'])) res.info(l);
      } else {
        res.info('window.' + globalName + ' done after ' + secs + 's, pass=' + obj.pass);
        if (obj.rows) for (const l of table(obj.rows, ['id', 'name', 'pass', 'moves', 'par', 'reason'])) res.info(l);
        if (obj.start || obj.end) res.info('start=' + JSON.stringify(obj.start) + '  end=' + JSON.stringify(obj.end));
        const extra = Object.keys(obj).filter(k => !['done', 'pass', 'rows', 'start', 'end'].includes(k));
        if (extra.length) res.info('other fields: ' + JSON.stringify(Object.fromEntries(extra.map(k => [k, obj[k]]))).slice(0, 500));
        if (Array.isArray(obj.rows)) {
          const bad = obj.rows.filter(r => r && r.pass === false);
          if (bad.length) res.info('failing rows: ' + bad.map(r => r.id != null ? r.id : JSON.stringify(r).slice(0, 40)).join(', '));
        }
        if (obj.pass !== true) res.fail('window.' + globalName + '.pass = ' + JSON.stringify(obj.pass));
      }
      const errs = page.errors();
      if (errs.length) res.note(errs.length + ' console error(s)/exception(s) during ?' + param + ' (not counted):\n      ' + fmtLogs(page, errs).slice(0, 20).join('\n      '));
    }, timeoutMs + 60000, name).catch(e => res.fail('harness/page error: ' + e.message));
    flush(res);
    return res;
  };
}

async function storage() {
  const res = makeResult('storage');
  await withPage({ width: 375, height: 667, mobile: true, touch: true, dpr: 2 }, async page => {
    await page.goto(GAME, 'nostorage&lvl=1');
    try { await page.waitFor(READY, 30000); res.info('Game.ready reached with ?nostorage&lvl=1'); }
    catch (e) { res.fail('Game.ready never became true with ?nostorage: ' + e.message.split('\n')[0]); }
    const blocked = await page.evaluate(`(()=>{try{localStorage.setItem('__t','1');localStorage.removeItem('__t');return 'localStorage works (not blocked)'}catch(e){return 'localStorage throws: '+e.message}})()`);
    res.info(blocked);
    if (/works/.test(blocked)) res.note('?nostorage did not make localStorage throw');
    await sleep(800);
    const lvl = await page.evaluate('window.Game ? Game.levelId : null').catch(() => null);
    res.info('Game.levelId = ' + lvl);
    await page.screenshot(path.join(OUT, 'storage.png'));
    const ex = page.exceptions();
    if (ex.length) res.fail(ex.length + ' uncaught exception(s):\n      ' + fmtLogs(page, ex).join('\n      '));
    const ce = page.errors().filter(l => l.kind !== 'exception');
    if (ce.length) res.note(ce.length + ' console error(s) (not counted):\n      ' + fmtLogs(page, ce).join('\n      '));
  }, 60000, 'storage').catch(e => res.fail('harness/page error: ' + e.message));
  flush(res);
  return res;
}

// ---------------------------------------------------------------- touchplay
let nodeSimCache = null;
function nodeSim() {
  if (nodeSimCache) return nodeSimCache;
  const src = fs.readFileSync(GAME, 'utf8');
  const m = src.match(/\/\/\s*#SIM-BEGIN[^\n]*\n([\s\S]*?)\/\/\s*#SIM-END/);
  if (!m) throw new Error('//#SIM-BEGIN ... //#SIM-END region not found in index.html');
  const ctx = vm.createContext({ console });
  vm.runInContext(m[1] + '\n;globalThis.__sim={compile,solve,initState,LEVELS:(typeof LEVELS!=="undefined"?LEVELS:undefined)};', ctx, { filename: 'SIM' });
  const sim = ctx.__sim;
  if (!sim.LEVELS) {
    const lm = src.match(/(?:const|let|var)\s+LEVELS\s*=\s*(\[[\s\S]*?\n\s*\]\s*);/);
    if (!lm) throw new Error('LEVELS array not found in index.html');
    sim.LEVELS = vm.runInContext('(' + lm[1] + ')', ctx);
  }
  return (nodeSimCache = sim);
}
const toDef = lv => Object.assign({}, lv, { layers: lv.layers || lv.L.split('|').map(l => l.split('/')) });

async function solverPath(page, r) {
  const st = await page.evaluate('Game.getState()');
  const from = { pos: st.pos, view: st.view, crates: (st.crates || []).slice().sort((a, b) => a - b), bat: st.bat | 0, burn: st.burn | 0 };
  // 1) Game.solvePath()  2) in-page sim globals  3) sim extracted from index.html (//#SIM-BEGIN..END) in Node
  const inPage = await page.evaluate(`(()=>{ const notes=[];
    try { if (typeof Game.solvePath==='function') { const x=Game.solvePath(); const p=Array.isArray(x)?x:(x&&x.path);
      if (Array.isArray(p)) return {src:'Game.solvePath()', path:p, par:x&&x.par}; notes.push('Game.solvePath() returned '+JSON.stringify(x).slice(0,80)); }
      else notes.push('Game.solvePath missing'); } catch(e){ notes.push('Game.solvePath threw: '+e.message); }
    try { if (typeof solve==='function' && typeof compile==='function' && typeof LEVELS!=='undefined') {
      const lv=LEVELS.find(l=>l.id===Game.levelId); const def=Object.assign({},lv,{layers:lv.layers||lv.L.split('|').map(l=>l.split('/'))});
      const x=solve(compile(def),{from:${JSON.stringify(from)}}); if (x&&Array.isArray(x.path)) return {src:'page globals solve(compile(LEVELS))', path:x.path, par:x.par, notes};
      notes.push('page solve() gave no path'); } else notes.push('sim globals not reachable from page'); } catch(e){ notes.push('page solve threw: '+e.message); }
    return {notes}; })()`);
  if (inPage.path) { if (inPage.notes) inPage.notes.forEach(n => r.info('  (' + n + ')')); return inPage; }
  inPage.notes.forEach(n => r.info('  (' + n + ')'));
  const sim = nodeSim();
  const lv = sim.LEVELS.find(l => l.id === st.levelId || l.id === r.levelId);
  if (!lv) throw new Error('level ' + r.levelId + ' not in LEVELS');
  const x = sim.solve(sim.compile(toDef(lv)), { from });
  if (!x || !Array.isArray(x.path)) throw new Error('node-side solve gave no path: ' + JSON.stringify(x));
  return { src: 'Node vm: //#SIM region of index.html', path: x.path, par: x.par };
}

const STATE_EXPR = '(()=>{const s=Game.getState();return {pos:s.pos,view:s.view,crates:s.crates,bat:s.bat,burn:s.burn,steps:s.steps,won:s.won,anim:s.anim}})()';
const keyOf = s => JSON.stringify([s.pos, s.view, s.crates, s.bat, s.burn, s.steps, s.won]);

/** After an input: wait until the game starts animating or the state changes, then until anim===false. */
async function settle(page, before) {
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) {
    const s = await page.evaluate(STATE_EXPR);
    if (s.anim || keyOf(s) !== before) break;
    await sleep(30);
  }
  await page.waitFor('window.Game && Game.getState().anim===false', 15000, 40);
  await sleep(60);
  return page.evaluate(STATE_EXPR);
}

const touchConv = { sign: +1, confirmed: false }; // +1: finger moving right == rotate(+1)

async function swipe(page, sign) {
  const g = await page.evaluate(`(()=>{const c=document.querySelector('canvas#game-canvas');const b=c.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height,vw:innerWidth}})()`);
  const cx = g.x + g.w / 2, cy = g.y + g.h * 0.5, dx = 0.225 * g.vw;
  await page.drag(cx - sign * dx, cy, cx + sign * dx, cy, 16, 480);
}

async function doRotate(page, dir, r) {
  let s = await page.evaluate(STATE_EXPR);
  const v0 = s.view, want = (v0 + dir + 4) & 3;
  await swipe(page, touchConv.sign * dir);
  s = await settle(page, keyOf(s));
  if (s.view === want) {
    if (!touchConv.confirmed) { touchConv.confirmed = true; r.info('  swipe convention confirmed: finger ' + (touchConv.sign > 0 ? 'left->right' : 'right->left') + ' = rotate(+1) (view ' + v0 + '->' + s.view + ')'); }
    return true;
  }
  if (!touchConv.confirmed && s.view === ((v0 - dir + 4) & 3)) {
    touchConv.sign = -touchConv.sign; touchConv.confirmed = true;
    r.info('  swipe convention flipped: finger ' + (touchConv.sign > 0 ? 'left->right' : 'right->left') + ' = rotate(+1); recovering');
    for (let k = 0; k < 2; k++) { await swipe(page, touchConv.sign * dir); s = await settle(page, keyOf(s)); }
    return s.view === want;
  }
  if (!touchConv.confirmed && s.view === v0) {
    await swipe(page, -touchConv.sign * dir);
    s = await settle(page, keyOf(s));
    if (s.view === want) { touchConv.sign = -touchConv.sign; touchConv.confirmed = true; r.info('  swipe convention flipped (first swipe bounced): finger ' + (touchConv.sign > 0 ? 'left->right' : 'right->left') + ' = rotate(+1)'); return true; }
  }
  r.fail('rotate(' + dir + ') by swipe: view ' + v0 + ' -> ' + s.view + ' (expected ' + want + ')');
  return false;
}

async function doTap(page, a, r) {
  let s = await page.evaluate(STATE_EXPR);
  const cands = a.t === 'push' ? [a.crate && a.crate[0], a.to] : [a.to];
  let pt = null, cell = null;
  for (const c of cands) {
    if (c == null) continue;
    const p = await page.evaluate('Game.screenOfTile(' + c + ')');
    if (p && isFinite(p.x) && isFinite(p.y)) { pt = p; cell = c; break; }
  }
  if (!pt) { r.fail(a.t + ' to ' + a.to + ': Game.screenOfTile returned null for ' + cands.filter(c => c != null).join('/')); return false; }
  const g = await page.evaluate(`(()=>{const b=document.querySelector('canvas#game-canvas').getBoundingClientRect();return {x:b.left,y:b.top,r:b.right,b:b.bottom}})()`);
  if (pt.x < g.x || pt.x > g.r || pt.y < g.y || pt.y > g.b) r.note(a.t + ' target ' + cell + ' at (' + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + ') is outside the canvas rect');
  await page.tap(pt.x, pt.y);
  const s2 = await settle(page, keyOf(s));
  const ok = s2.pos === a.to && (a.t !== 'push' || !a.crate || (s2.crates || []).includes(a.crate[1]));
  if (!ok) r.fail(a.t + ' ' + a.from + '->' + a.to + (a.crate ? ' crate ' + a.crate.join('->') : '') + ': tapped cell ' + cell + ' at (' + pt.x.toFixed(1) + ',' + pt.y.toFixed(1) + '), got pos=' + s2.pos + ' crates=' + JSON.stringify(s2.crates) + ' view=' + s2.view);
  return ok;
}

async function touchplay() {
  const res = makeResult('touchplay');
  const LEVEL_IDS = (opt('levels') || '1,3,7,12,17').split(',').map(Number);
  touchConv.sign = +1; touchConv.confirmed = false;
  await withPage({ width: 375, height: 667, mobile: true, touch: true, dpr: 2 }, async page => {
    for (const id of LEVEL_IDS) {
      const r = makeResult('touchplay ' + id); r.levelId = id;
      try {
        await page.goto(GAME, { lvl: id });
        await page.waitFor(READY, 30000);
        if (await page.evaluate(`(()=>{const t=document.querySelector('[data-testid=title-screen]');return !!t&&getComputedStyle(t).display!=='none'&&getComputedStyle(t).visibility!=='hidden'&&t.getBoundingClientRect().width>0})()`)) {
          r.note('title-screen visible after ?lvl=' + id + '; tapping btn-play');
          const b = await page.evaluate(`(()=>{const b=document.querySelector('[data-testid=btn-play]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
          await page.tap(b.x, b.y); await sleep(800);
        }
        await page.waitFor('Game.getState().anim===false', 15000);
        await sleep(300);
        const lvlNow = await page.evaluate('Game.levelId');
        if (lvlNow !== id) r.fail('Game.levelId is ' + lvlNow + ' after ?lvl=' + id);
        const sp = await solverPath(page, r);
        const desc = sp.path.map(a => a.t === 'rot' ? 'R' + (a.dir > 0 ? '+' : '-') : (a.t === 'push' ? 'P' : 'W') + a.to).join(' ');
        r.info('  solver (' + sp.src + '): par ' + (sp.par != null ? sp.par : '?') + ', ' + sp.path.length + ' actions: ' + desc);
        let ok = true;
        for (const a of sp.path) {
          if (a.t === 'rot') ok = await doRotate(page, a.dir, r);
          else if (a.t === 'walk' || a.t === 'push') ok = await doTap(page, a, r);
          else { r.fail('unknown action ' + JSON.stringify(a)); ok = false; }
          if (!ok) break;
        }
        const final = await page.evaluate(STATE_EXPR);
        let winVis = false;
        try {
          await page.waitFor(`(()=>{const w=document.querySelector('[data-testid=win-panel]');if(!w)return false;for(let p=w;p&&p.nodeType===1;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||+s.opacity<0.05)return false}const b=w.getBoundingClientRect();return b.width>0&&b.height>0})()`, ok ? 15000 : 3000);
          winVis = true;
        } catch (_) {}
        await sleep(600);
        await page.screenshot(path.join(OUT, 'touchplay-lvl' + id + '.png'));
        r.info('  final state: steps=' + final.steps + ' won=' + final.won + ' pos=' + final.pos + ' view=' + final.view + '; win panel ' + (winVis ? 'visible' : 'NOT visible'));
        if (!winVis) r.fail('win panel did not appear');
        const errs = page.errors();
        if (errs.length) r.note(errs.length + ' console error(s)/exception(s):\n      ' + fmtLogs(page, errs).join('\n      '));
      } catch (e) {
        r.fail('level ' + id + ': ' + e.message.split('\n')[0]);
        await page.screenshot(path.join(OUT, 'touchplay-lvl' + id + '.png')).catch(() => {});
      }
      console.log(' [' + (r.pass ? 'PASS' : 'FAIL') + '] level ' + id);
      flush(r);
      if (!r.pass) { res.pass = false; res.failures.push(...r.failures.map(f => 'level ' + id + ': ' + f)); }
    }
  }, 600000, 'touchplay').catch(e => res.fail('harness/page error: ' + e.message));
  flush(res);
  return res;
}

// ---------------------------------------------------------------- selftest (harness mechanics, legacy page)
async function selftest() {
  const res = makeResult('selftest');
  const href = cdp.fileUrl(LEGACY, { lvl: 3, verify: true });
  if (!/Masa%C3%BCst%C3%BC/.test(href) && /ü/.test(LEGACY)) res.fail('fileUrl did not percent-encode non-ASCII path: ' + href);
  res.info('fileUrl: ' + href);
  const t0 = Date.now();
  const runs = await Promise.all(VIEWPORTS.map(async vp => {
    const page = await cdp.launch(vp);
    const info = { vp: vp.name, dir: page.userDataDir, pid: page.pid, port: page.port };
    try {
      await page.goto(LEGACY, { lvl: 3 });
      await page.waitFor('typeof THREE!=="undefined" && document.querySelector("canvas")', 20000);
      info.webgl = await page.evaluate("!!document.createElement('canvas').getContext('webgl')");
      info.size = await page.evaluate('innerWidth+"x"+innerHeight+"@"+devicePixelRatio+" touch="+navigator.maxTouchPoints');
      await page.frames(5);
      const before = await page.evaluate('document.getElementById("moves").textContent');
      // legacy: tapping a tile rotates it (+1 move). Try a few points around the centre.
      let after = before;
      for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.6]]) {
        await page.tap(vp.width * fx, vp.height * fy); await sleep(100);
        after = await page.evaluate('document.getElementById("moves").textContent');
        if (after !== before) break;
      }
      info.tap = before + '->' + after;
      await page.drag(vp.width * 0.3, vp.height * 0.5, vp.width * 0.7, vp.height * 0.5, 10, 300);
      await page.evaluate("console.error('selftest-console-error'); setTimeout(()=>{throw new Error('selftest-boom')},0); 1");
      await sleep(200);
      info.captured = { consoleError: page.errors().some(l => /selftest-console-error/.test(l.text)), exception: page.exceptions().some(l => /selftest-boom/.test(l.text)) };
      info.shot = await page.screenshot(path.join(OUT, 'selftest-' + vp.name + '.png'));
    } finally { await page.close(); }
    info.dirRemoved = !fs.existsSync(info.dir);
    try { process.kill(info.pid, 0); info.procGone = false; } catch (_) { info.procGone = true; }
    return info;
  }).map(p => p.catch(e => ({ error: e.message }))));
  res.info('4 concurrent Chrome instances finished in ' + (Date.now() - t0) + 'ms');
  for (const i of runs) {
    res.info(JSON.stringify(i));
    if (i.error) { res.fail(i.error); continue; }
    if (!i.webgl) res.fail(i.vp + ': WebGL not available');
    if (i.tap && i.tap.split('->')[0] === i.tap.split('->')[1]) res.fail(i.vp + ': tap did not register (moves ' + i.tap + ')');
    if (!i.captured.consoleError || !i.captured.exception) res.fail(i.vp + ': console/exception capture failed');
    if (!i.dirRemoved) res.fail(i.vp + ': temp profile not removed ' + i.dir);
    if (!i.procGone) res.fail(i.vp + ': chrome pid ' + i.pid + ' still alive');
  }
  const ports = new Set(runs.map(i => i.port)); if (ports.size !== runs.length) res.fail('ports not unique');
  // timeout cleanup: a suite that times out must still kill Chrome.
  let tdir = null;
  await withPage({ width: 320, height: 480 }, async page => { tdir = page.userDataDir; await sleep(5000); }, 500, 'forced-timeout')
    .then(() => res.fail('forced timeout did not reject'), e => res.info('forced timeout rejected as expected: ' + e.message));
  if (tdir && fs.existsSync(tdir)) res.fail('temp dir left after timeout: ' + tdir); else res.info('cleanup after timeout ok');
  flush(res);
  return res;
}

// ---------------------------------------------------------------- main
const SUITES_V1 = {
  smoke,
  verify: autoSuite('verify', 'verify', '__verify', 180000),
  parity: autoSuite('parity', 'parity', '__parity', 180000),
  leak: autoSuite('leak', 'leak', '__leak', 180000),
  touchplay,
  storage,
  selftest,
};
const ALL_V1 = ['smoke', 'storage', 'touchplay', 'verify', 'parity', 'leak'];
const S2 = require('./suites2')({ GAME, OUT, ROOT, cdp, makeResult, flush, withPage, fmtLogs, table, opt, LAYOUT_PROBE, overlap, rs, VIEWPORTS });
const SUITES = IS_V2 ? Object.assign({ selftest }, S2) : SUITES_V1;
delete SUITES.ALL;
const ALL = IS_V2 ? S2.ALL : ALL_V1;

process.on('unhandledRejection', e => { console.error('unhandledRejection:', e); process.exit(1); });
process.on('uncaughtException', e => { console.error('uncaughtException:', e); process.exit(1); });

(async () => {
  const which = positional[0];
  const list = which ? which.split(',') : [];
  if (!list.length || !list.every(w => w in SUITES || w === 'all')) {
    console.log('usage: node tools/test/run.js <' + Object.keys(SUITES).join('|') + '|all>[,suite…] [--file <index.html>] [--v1|--v2] [--levels=P1,M1] [--cpu=1,4] [--realtime]');
    console.log('mode: ' + (IS_V2 ? 'v2 (PARALAKS: TEK HAT)' : 'v1') + '  file: ' + GAME);
    process.exit(2);
  }
  if (which !== 'selftest' && !fs.existsSync(GAME)) { console.error('game file not found: ' + GAME); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  console.log('game: ' + GAME + ' (' + (IS_V2 ? 'v2' : 'v1') + ')\nchrome: ' + cdp.findChrome() + '\nnode: ' + process.version);
  const names = list.includes('all') ? ALL : list;
  const results = [];
  for (const n of names) {
    console.log('\n=== ' + n + ' ===');
    const t0 = Date.now();
    let r;
    try { r = await SUITES[n](); } catch (e) { r = makeResult(n); r.fail('suite crashed: ' + (e.stack || e.message)); flush(r); }
    r.secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('=== ' + n + ': ' + (r.pass ? 'PASS' : 'FAIL') + ' (' + r.secs + 's)');
    results.push(r);
  }
  if (names.length > 1) {
    console.log('\n================ SUMMARY ================');
    for (const r of results) {
      console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name.padEnd(10) + ' ' + r.secs + 's' + (r.pass ? '' : '  (' + r.failures.length + ' failure' + (r.failures.length === 1 ? '' : 's') + ')'));
      for (const f of r.failures) console.log('        - ' + f.split('\n')[0].slice(0, 200));
    }
    console.log('OVERALL: ' + (results.every(r => r.pass) ? 'PASS' : 'FAIL'));
  }
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
})();
