// ============================================================================
// debug/game_api.js — window.Game test API'si (§18.4)                               sahip: Test (Foundation)
// Yalnız ?debug, harness (window.__PX_TEST__ = true, init betiğiyle) ya da --dev build'de açılır.
// §18.4: Game.load(id) Game.cmd(cmd) Game.state() Game.visibleTiles() Game.screenOfTile(c) Game.ownerAt(x,y)
//        Game.replay(str) Game.drawnScale(cell) Game.frameStats()
// Ek (harness): ready, levelId, version, levels(), level(id), L(), probe(), idle(), events(n), decode(tok),
//        keyMap(), screenOfEl(id), chips(), camera(), save(), onFrame(fn), tileCell(i)
// Kural sürümü 4 (fiziksel dünya): walkableInfo(v) (= parityInfo, geri uyum) çizilen yürünebilir hücreler + sim2
//        L.tiles/L.stairs/L.ladders/L.doors; explain(e|id|{tile}) (sim2.explain, öngörülen durumdan), checklist(),
//        occluders(v?) (sim2.occluders, odak hedefleriyle), focus() (PX.game.focusTargets), guide(), rotate(d).
// Dönüş değerleri JSON-güvenlidir (L() ve onFrame hariç; bunlar sayfa içi kullanım içindir).
// ============================================================================
function enabled() {
  try { if (/(?:^|[?&])debug(?:[=&]|$)/.test(location.search)) return true; } catch (e) { /* yoksay */ }
  return !!(window.__PX_TEST__ || (PX.BUILD && PX.BUILD.dev));
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
function idle(timeoutMs) {
  const t0 = performance.now();
  return new Promise(resolve => {
    const chk = () => {
      const busy = PX.game.busy || (PX.camera && PX.camera.busy());
      if (!busy) return resolve(true);
      if (performance.now() - t0 > (timeoutMs || 30000)) return resolve(false);
      requestAnimationFrame(chk);
    };
    chk();
  });
}
function jsonState() {
  const st = PX.game.state(); const L = PX.game.L;
  return { levelId: st.id, s: st.s, view: st.view, tot: st.tot, won: st.won, presentation: { tot: st.presentation.tot, s: st.presentation.s, won: st.presentation.won },
    queue: st.queue, busy: st.busy, hist: st.hist, redo: st.redo, anim: st.busy, tile: st.s && L ? L.tileIdx[st.s.p] : -1, screen: PX.screens ? PX.screens.current : null };
}
// çizilen yürünebilir yüzeyler (render kimlik tamponu) ile sim2'nin fiziksel karoları; merdiven/iskele/kapı listeleri
function walkableInfo(v) {
  const L = PX.game.L; if (!L) return null; if (v === undefined) v = PX.game.state().view;
  let drawn = null; try { drawn = PX.diorama && PX.diorama.drawnTiles ? PX.diorama.drawnTiles(v) : null; } catch (e) { drawn = null; }
  const K = PX.SIM.KIND || {}; const kinds = {}; for (let c = 0; c < L.G.N; c++) { const k = L.G.kind[c]; if (k) kinds[k] = (kinds[k] || 0) + 1; }
  return { v, drawn, tiles: L.tiles.slice(), vis: L.tiles.slice(), stairs: L.stairs.map(x => ({ cell: x.cell, dir: x.dir, lo: x.lo, hi: x.hi })),
    ladders: L.ladders.map(x => ({ cells: x.cells.slice(), dir: x.dir, foot: x.foot, top: x.top })), doors: L.doors.map(d => ({ el: L.els[d.el].id, cell: L.els[d.el].cell, tile: d.tile, inner: d.nInner })),
    walls: (() => { const o = []; for (let c = 0; c < L.G.N; c++) if (L.G.kind[c] === K.duvar) o.push(c); return o; })(), kinds,
    stub: !!(PX.diorama && PX.diorama.drawnTiles && PX.diorama.drawnTiles.stub) };
}
function topOf(c, out) { const L = PX.game.L; if (!L || c < 0) return null; const [x, y, z] = L.G.xyz(c); return PX.camera.worldToClient(x, y + 0.5, z, out || {}); }
async function replay(str, opts) {
  opts = Object.assign({ instant: true }, opts || {});
  const L = PX.game.L; if (!L) return { ok: false, err: 'seviye_yok' };
  PX.game.command({ t: 'reset' });
  PX.game.setInstant(!!opts.instant);
  const toks = String(str || '').trim() ? String(str).trim().split(/\s+/) : [];
  let res = { ok: true };
  try {
    for (const tok of toks) {
      while (PX.game.state().queue >= 3) await nextFrame();
      const a = PX.SIM.decodeAct(L, PX.game.state().s, tok);
      if (!a) { res = { ok: false, at: tok, err: 'dogrulanamadi' }; break; }
      let rej = null; const off = PX.bus.once('cmd:rejected', p => { rej = p; });
      const ok = PX.game.command({ t: 'act', a }); off();
      if (!ok) { res = { ok: false, at: tok, err: rej ? rej.err : 'ret', msg: rej ? rej.msg : '' }; break; }
      if (opts.instant) await Promise.resolve();
    }
    await idle(opts.timeoutMs || 120000);
  } finally { PX.game.setInstant(false); }
  const st = PX.game.state();
  return Object.assign(res, { won: st.presentation.won, tot: st.presentation.tot, logicTot: st.tot, logicWon: st.won });
}
function install() {
  if (!enabled()) return;
  const Game = window.Game = window.Game || {};
  Object.assign(Game, {
    version: PX.BUILD ? PX.BUILD.version : '?', ready: false,
    get levelId() { return PX.game.state().id; },
    load(id) { return Promise.resolve(PX.screens ? PX.screens.play(id) : PX.game.load(id)).then(nextFrame).then(() => jsonState()); },
    cmd(c) { return PX.game.command(c); },
    state: jsonState,
    visibleTiles() { const v = PX.game.state().view; return PX.diorama.drawnTiles(v); },
    walkableInfo,
    parityInfo: walkableInfo,
    explain(t) { const L = PX.game.L; if (!L) return null; const tg = typeof t === 'string' ? { e: L.elIndex[t] } : typeof t === 'number' ? { e: t } : t;
      const x = PX.game.explain(tg); return x ? JSON.parse(JSON.stringify(x)) : null; },
    checklist() { return PX.game.checklist(); },
    occluders(v) { const L = PX.game.L; if (!L) return []; if (v === undefined) v = PX.game.state().view; return PX.SIM.occluders(L, v, PX.game.focusTargets()); },
    focus() { return PX.game.focusTargets(); },
    guide() { return PX.game.guide ? JSON.parse(JSON.stringify(PX.game.guide)) : null; },
    screenOfTile(c) { const p = topOf(c); return p ? { x: p.x, y: p.y } : null; },
    screenOfEl(id) { const L = PX.game.L; const i = L ? L.elIndex[id] : undefined; if (i === undefined || L.els[i].cell < 0) return null; const p = topOf(L.els[i].cell); return { x: p.x, y: p.y }; },
    ownerAt(x, y) { try { return PX.camera.pick(x, y); } catch (e) { return { kind: 'none', cell: -1, el: -1, err: String(e && e.message) }; } },
    replay,
    drawnScale(c) { return PX.diorama.drawnScale(c); },
    frameStats(n) { return PX.main.frameStats(n); },
    levels() { return PX.LEVELS.map(l => ({ id: l.id, ad: l.ad, bolum: l.bolum, sinif: l.sinif, biyom: l.biyom, opt: l.kanit && l.kanit.opt, cozum: l.kanit && l.kanit.cozum,
      cozumManevra: l.kanit && l.kanit.cozumManevra, cozumKesinti: l.kanit && l.kanit.cozumKesinti, states: l.kanit && l.kanit.states })); },
    level(id) { return JSON.parse(JSON.stringify(PX.LEVELS.find(l => l.id === id) || null)); },
    L() { return PX.game.L; },
    probe() { const p = PX.volti.probe(); return { x: p.x, y: p.y, z: p.z, footY: p.footY, groundY: p.groundY, cell: p.cell, arc: p.arc, moving: p.moving }; },
    idle,
    events(n) { return PX.bus.recent(n); },
    decode(tok) { const L = PX.game.L; const a = PX.SIM.decodeAct(L, PX.game.state().s, tok); if (!a) return null;
      return { t: a.t, cell: a.to !== undefined ? a.to : -1, el: a.e !== undefined ? L.els[a.e].id : null, elCell: a.e !== undefined ? L.els[a.e].cell : -1, d: a.d }; },
    tileCell(i) { const L = PX.game.L; return L && i >= 0 && i < L.tiles.length ? L.tiles[i] : -1; },
    keyMap() { return PX.keyboard.map(); },
    chips() { return PX.hud.chips(); },
    camera() { return { az: PX.camera.az, v: PX.camera.v, camV: PX.game.camView, busy: PX.camera.busy(), deg: PX.camera.az * 180 / Math.PI }; },
    rotate(d) { return PX.game.command({ t: 'rot', d: d > 0 ? 1 : -1, src: 'api' }); },
    save() { return PX.store ? JSON.parse(JSON.stringify(PX.store.data)) : null; },
    storeInfo() { return PX.store ? { available: PX.store.available, reason: PX.store.disabledReason } : null; },
    onFrame(fn) { return PX.main.onFrame(fn); },
    build() { return PX.BUILD; },
  });
}
PX.debug = { install, idle, replay };
