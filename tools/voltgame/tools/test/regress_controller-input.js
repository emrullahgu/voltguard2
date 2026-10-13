#!/usr/bin/env node
'use strict';
// ============================================================================
// tools/test/regress_controller-input.js — controller/girdi alanı (game/controller.js, input/*) gerileme testleri
//   node tools/test/regress_controller-input.js [--unit] [--file <html>]     (varsayılan dosya: index.html)
// Bölüm A (Node, tarayıcısız; tools/test/unit/controller_harness.js): kural ve komut hattı özellikleri
// Bölüm B (headless Chrome, tools/test/cdp.js, telefon 375×667 DPR2 dokunma): gerçek dokunuş/jest yeniden üretimleri
// KURAL SÜRÜMÜ 4 (fiziksel dünya). Eski (v3) hataların karşılıkları ve yenileri:
//   R1 yürürken döndürme: kamera HEMEN döner, yol/defter/elektrik değişmez (eskiden bölme/erteleme vardı)
//   R2 Volti'nin başına/kaskına dokunuş arkasındaki karo/cihazı seçiyordu (yürüyüş, +1 Hamle)
//   R3 yürürken döndürme + geri al: kamera oyuncunun görünümünde kalır (döndürme geçmişe girmez), uçuştaki parça onu sunar
//   R4 bir seviyede yakınlaştırınca sonraki seviyede kıstırma (açma) ölü kalıyordu
//   R5 Mühendis Mührü her seviyede Hamle- ve Kesinti-optimum planıyla kazanılır
//   R6 sağlam sigortada 'Sigortayı değiştir' çipi ve yanlış erişim mesajı
//   R7 izdüşüm komutu/simgeleri kalktı: {t:'izdusum'} bilinmeyen komut, 'p'/'d+'/'d-' doğrulanamadı
//   R8 sahibin şikâyeti "takılıp kalıyor": her v4 seviyesinde rastgele yürüyüşlerin HER durumunda her cihaza ve karoya
//      dokunuş ya yürür/çip/kart ya da NEDENLE (adlandırılmış engel) reddedilir — asla sessiz değil
// Çıkış kodu: hata varsa 1.
// ============================================================================
const path = require('path');
const fs = require('fs');
const { makeEnv, suite, eq, ok, SIM } = require('./unit/controller_harness');

const argv = process.argv.slice(2);
const opt = k => { const a = argv.find(x => x.startsWith('--' + k + '=')); if (a) return a.slice(k.length + 3); const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null; };
const ROOT = path.resolve(__dirname, '..', '..');

function genv(o) { const E = makeEnv(o); E.load('game/controller.js'); E.PX.game.init(); return E; }
const st = E => E.PX.game.state();
const act = (E, tok) => E.PX.game.command({ t: 'act', tok });
const v4 = E => E.PX.LEVELS.filter(l => l.kuralSurumu === 4 && l.def);
const tiles = (L, s, to) => { const w = SIM.walkPath(L, s, to); return w ? w.filter(x => x.k === 'karo').map(x => x.c) : null; };
function walks(L, s, minLen) { const out = []; for (const t of SIM.walkTargets(L, s)) { const p = tiles(L, s, t); if (p && p.length - 1 >= minLen) out.push(p); } return out.sort((a, b) => b.length - a.length); }
function fresh(E) { E.PX.game.command({ t: 'reset' }); E.anims.length = 0; E.V.leg = -1; E.V.moving = false; E.clearEv(); E.camCalls.length = 0; }

// ---------------------------------------------------------------- Bölüm A
async function unitPart() {
  const { test, res } = suite('regress_controller-input (unit)');
  console.log('A) birim (Node)');

  await test('R1 her v4 seviyesi × uzun yol × her ara bacak × d±: döndürme anında, yol ve defter aynı, uçuştaki parça yeni görünümü sunar', async () => {
    const E = genv(); let cases = 0;
    for (const lv of v4(E)) {
      await E.PX.game.load(lv.id); const L = E.PX.game.L; const s0 = st(E).s;
      for (const p of walks(L, s0, 3).slice(0, 3)) {
        for (let i = 1; i < p.length - 1; i++) for (const d of [1, -1]) {
          fresh(E);
          ok(E.PX.game.command({ t: 'tap', cell: p[p.length - 1] }), lv.id + ' tap');
          E.V.leg = p[i]; E.V.moving = true;
          const v0 = E.PX.game.camView, tk = E.PX.game.tokens(), sub = E.anims[E.anims.length - 1].step, path0 = sub.path.slice();
          eq(E.PX.game.command({ t: 'rot', d, src: 'drag' }), true, lv.id + ' kabul'); cases++;
          eq(E.PX.game.camView, (v0 + d + 4) & 3, lv.id + ' anında');
          ok(E.camCalls.some(c => c[0] === 'snap' && c[1] === E.PX.game.camView), lv.id + ' kamera yaylandı');
          eq(E.PX.game.tokens(), tk, lv.id + ' defter aynı'); eq(sub.path, path0, lv.id + ' yol aynı'); eq(sub.after.v, E.PX.game.camView, lv.id + ' uçuştaki parça');
          E.V.moving = false; await E.drain();
          eq(st(E).presentation.s.p, p[p.length - 1], lv.id + ' hedefe vardı');
        }
      }
    }
    fresh(E); console.log('       ' + cases + ' durum');
    ok(cases > 30, 'kapsam ' + cases);
  });

  await test('R3 yürürken döndürme + 1/2 geri al: kamera oyuncunun görünümünde (döndürme geri alınmaz), uçuştaki parça onu sunar', async () => {
    const E = genv(); let n = 0;
    for (const lv of v4(E)) {
      await E.PX.game.load(lv.id); const L = E.PX.game.L;
      const p = walks(L, st(E).s, 3)[0]; if (!p) continue;
      for (const undos of [1, 2]) for (const d of [1, -1]) {
        fresh(E); E.PX.game.command({ t: 'tap', cell: p[p.length - 1] }); E.V.leg = p[1]; E.V.moving = true;
        if (undos === 2) { E.V.moving = false; await E.drain(); E.PX.game.command({ t: 'tap', cell: p[1] }); E.V.moving = true; }
        const v0 = E.PX.game.camView; E.PX.game.command({ t: 'rot', d, src: 'drag' }); const v1 = (v0 + d + 4) & 3;
        for (let k = 0; k < undos; k++) E.PX.game.command({ t: 'undo' });
        eq(E.PX.game.camView, v1, lv.id + ' camV = oyuncunun görünümü');
        const snaps = E.camCalls.filter(c => c[0] === 'snap'); eq(snaps[snaps.length - 1][1], v1, lv.id + ' son kamera hedefi');
        if (E.syncs.length) eq(E.syncs[E.syncs.length - 1].v, v1, lv.id + ' saf kurulum v');
        eq(st(E).hist, 0, lv.id + ' geçmişte döndürme yok'); n++;
      }
    }
    ok(n > 8, 'kapsam ' + n);
  });

  await test('R5 Mühendis Mührü: her v4 seviyesinde Hamle- ve Kesinti-optimum planı mührü kazanır; ipuçlu koşu kazanmaz', async () => {
    const E = genv(); const miss = [];
    for (const lv of v4(E)) {
      const k = lv.kanit; if (!k || !k.opt) continue;
      for (const key of ['cozum', 'cozumKesinti']) {
        if (!k[key]) continue;
        await E.PX.game.load(lv.id); E.PX.game.setInstant(true); E.clearEv();
        for (const tok of k[key].split(/\s+/)) { if (!act(E, tok)) throw new Error(lv.id + ' ' + key + ' ' + tok + ' reddedildi'); await E.tick(); }
        await E.drain(); const w = E.events('win')[0]; ok(w, lv.id + ' kazanma');
        if (w.seals.indexOf('muhendis') < 0) miss.push(lv.id + '/' + key + ' ' + JSON.stringify(w.tot));
      }
    }
    eq(miss, [], 'mühürsüz altın plan');
    const L1 = v4(E).find(l => l.kanit && l.kanit.cozum); await E.PX.game.load(L1.id); E.PX.game.setInstant(true);
    E.PX.solver.dist = () => 3; E.PX.hint = { request() { E.PX.bus.emit('hint', { acts: ['o:Q01'] }); } }; E.PX.game.command({ t: 'hint', tier: 1 }); E.clearEv();
    for (const tok of L1.kanit.cozum.split(/\s+/)) { act(E, tok); await E.tick(); }
    await E.drain(); ok(E.events('win')[0].seals.indexOf('muhendis') < 0, 'ipuçlu');
  });

  await test('R6 sağlam sigorta: "Sigortayı değiştir" çipi yok; doğrudan simge -> "saglam" (erişim değil); dokunuş = cihaz kartı', async () => {
    const E = genv(); let fuses = 0;
    for (const lv of v4(E)) {
      await E.PX.game.load(lv.id); const L = E.PX.game.L;
      for (const el of L.els) { if (el.t !== 'sigorta' || el.cell < 0) continue; const s = st(E).s; if (!((s.b >> el.bit) & 1)) continue;
        fuses++; const tok = SIM.encodeAct(L, s, { t: 'degistir', e: el.i });
        E.clearEv(); eq(act(E, tok), false); const r = E.events('cmd:rejected')[0]; ok(r.err === 'saglam' || r.err === 'uzak' || r.reason, lv.id + ' ' + el.id + ' ' + r.err);
        if (r.err !== 'saglam') ok(!/erişilemez/i.test(r.msg || ''), 'mesaj');
        E.clearEv(); const h0 = st(E).hist; E.PX.game.command({ t: 'tap', cell: el.cell }); eq(st(E).hist, h0, 'yürüyüş yok'); eq(E.events('ui:longpress').length, 1, 'cihaz kartı');
      }
      E.clearEv(); E.PX.game.command({ t: 'tap', cell: st(E).s.p }); await E.drain();
      for (const c of E.events('ui:chip')) for (const x of c.actions) if (x.a.t === 'degistir') ok(!((st(E).s.b >> L.els[x.a.e].bit) & 1), lv.id + ' sağlam sigorta çipi');
    }
    console.log('       ' + fuses + ' sağlam sigorta');
  });

  await test('R7 izdüşüm yok: {t:"izdusum"} bilinmeyen; "p", "d+", "d-" simgeleri doğrulanamadı; döndürme komutu geçmişe girmez', async () => {
    const E = genv();
    for (const lv of v4(E)) {
      await E.PX.game.load(lv.id);
      E.clearEv(); eq(E.PX.game.command({ t: 'izdusum', src: 'key' }), false, lv.id); eq(E.events('cmd:rejected')[0].err, 'bilinmeyen');
      for (const t of ['p', 'd+', 'd-']) { E.clearEv(); eq(act(E, t), false, lv.id + ' ' + t); eq(E.events('cmd:rejected')[0].err, 'dogrulanamadi'); }
      E.PX.game.command({ t: 'rot', d: 1 }); eq(st(E).hist, 0); eq(E.PX.game.tokens(), '');
    }
  });

  await test('R8 asla takılmaz: her v4 seviyesi × rastgele yürüyüş durumları × her cihaz + karo + merdiven/iskele dokunuşu -> yürüyüş/çip/kart ya da nedenli ret', async () => {
    const E = genv(); let taps = 0, why = 0; const silent = [];
    for (const lv of v4(E)) {
      await E.PX.game.load(lv.id); const L = E.PX.game.L;
      const cells = [...new Set(L.els.filter(e => e.cell >= 0 && e.t !== 'kablo').map(e => e.cell).concat(L.tiles.filter((c, i) => i % 3 === 0), L.stairs.map(x => x.cell), L.ladders.map(x => x.cells[0])))];
      let seed = 97;
      for (let run = 0; run < 3; run++) {
        fresh(E); E.PX.game.setInstant(true); let s = st(E).s;
        for (let step = 0; step < 14 && !st(E).won; step++) {
          // bu durumda her hedef
          for (const c of cells) { const h0 = st(E).hist; E.clearEv(); const r = E.PX.game.command({ t: 'tap', cell: c }); taps++;
            const rj = E.events('cmd:rejected')[0];
            if (!r) { if (rj && rj.msg && rj.err !== 'bos') { why++; if (rj.reason) ok(rj.blockers && rj.blockers.length, lv.id + ' engel listesi'); } else silent.push(lv.id + ' c' + c + ' ' + (rj && rj.err)); }
            await E.tick(); if (st(E).hist > h0) { E.PX.game.command({ t: 'undo' }); await E.tick(); } }
          // rastgele yasal bir eylem
          const sc = SIM.succ(L, s); if (!sc.length) break; seed = (seed * 1103515245 + 12345) & 0x7fffffff; const m = sc[seed % sc.length];
          ok(act(E, SIM.encodeAct(L, s, m.a)), lv.id + ' rastgele eylem'); await E.tick(); await E.tick(); s = st(E).s;
        }
        E.PX.game.setInstant(false);
      }
    }
    console.log('       ' + taps + ' dokunuş, ' + why + ' nedenli ret, ' + silent.length + ' sessiz');
    eq(silent.slice(0, 8), [], 'sessiz dokunuş');
  });

  // ---- jest (input/gesture.js)
  function gestureEnv() {
    const E = makeEnv(); const calls = [];
    E.PX.game = { busy: false, camView: 0, L: { els: [{ id: 'Q01' }] },
      command(c) { calls.push(c); return true; }, state() { return { view: 0, queue: 0 }; }, skipCelebration() { return false; } };
    E.PX.camera.zoomLevel = 0; E.PX.camera.setZoom = function (l) { E.camCalls.push(['zoom', l]); this.zoomLevel = l; };
    E.load('input/gesture.js'); const Lh = {}; E.PX.gesture.init({ addEventListener(t, fn) { (Lh[t] = Lh[t] || []).push(fn); } });
    let t = 0;
    const fire = (type, id, x, y, dt = 0) => { t += dt; E.advance(dt); for (const fn of (Lh[type] || [])) fn({ pointerId: id, clientX: x, clientY: y, timeStamp: 1000 + t, pointerType: 'touch', button: 0, cancelable: true, preventDefault() {}, target: { setPointerCapture() {} } }); };
    const pinch = out => { fire('pointerdown', 1, 150, 300); fire('pointerdown', 2, out ? 175 : 230, 300, 10); for (let i = 1; i <= 5; i++) fire('pointermove', 2, out ? 175 + i * 12 : 230 - i * 12, 300, 16); fire('pointerup', 1, 150, 300, 10); fire('pointerup', 2, 200, 300, 5); };
    return Object.assign(E, { calls, fire, pinch });
  }
  await test('R4 kıstırma: seviye değişince (kamera zoom 1×) sonraki açma jesti ilk seferde yakınlaştırır', async () => {
    const E = gestureEnv();
    E.pinch(true); eq(E.PX.camera.zoomLevel, 1, 'M1 açma');
    E.PX.camera.zoomLevel = 0;
    E.pinch(true); eq(E.PX.camera.zoomLevel, 1, 'olay olmadan da (kameraya karşı karşılaştırma)');
    E.PX.camera.zoomLevel = 0; E.PX.bus.emit('level:loaded', {});
    E.pinch(true); eq(E.PX.camera.zoomLevel, 1, 'level:loaded sonrası');
    E.pinch(false); eq(E.PX.camera.zoomLevel, 0, 'kısma');
    eq(E.camCalls.filter(c => c[0] === 'zoom').map(c => c[1]), [1, 1, 1, 0]);
  });
  await test('R1 jest: yürürken (meşgul) sürükleme her zaman döndürür; kırpma yok', async () => {
    const E = gestureEnv(); const sc = Math.max(180, Math.min(0.45 * 375, 260)); E.PX.game.busy = true;
    E.fire('pointerdown', 1, 300, 300); for (let i = 1; i <= 8; i++) E.fire('pointermove', 1, 300 - i * 0.12 * sc, 300, 30);
    E.fire('pointerup', 1, 300 - 0.96 * sc, 300, 100);
    eq(E.calls.filter(c => c.t === 'rot').length, 1, 'bir adım');
  });
  return res;
}

// ---------------------------------------------------------------- Bölüm B (tarayıcı)
async function browserPart(file) {
  const cdp = require('./cdp'); const { sleep } = cdp;
  const { test, res } = suite('regress_controller-input (browser)');
  console.log('B) tarayıcı: ' + path.relative(ROOT, file));
  const page = await cdp.launch({ width: 375, height: 667, mobile: true, touch: true, dpr: 2 });
  try {
    await page.addInitScript('window.__PX_TEST__ = true;');
    await page.goto(file, { debug: true }); await page.waitFor('window.Game && window.Game.ready === true', 30000, 50);
    const idle = () => page.evaluate('Game.idle(30000)', 35000);
    const load = async id => { await page.evaluate(`Game.load(${JSON.stringify(id)})`); await idle(); await sleep(250); await idle(); };
    const ids = await page.evaluate('PX.LEVELS.map(l => l.id)');

    await test('R2 her seviye: Volti\'nin göğüs/baş/kask noktasına gerçek dokunuş yürütmez, Hamle harcamaz, cihaz hedeflemez', async () => {
      const bad = []; let n = 0;
      for (const id of ids) {
        for (const h of [0.45, 0.6, 0.75]) {
          await load(id);
          const q = await page.evaluate(`(() => { const p = PX.volti.probe(); const w = PX.camera.worldToClient(p.x, p.footY + ${h}, p.z, {}); return { x: w.x, y: w.y, s: PX.game.state().s.p }; })()`);
          await page.tap(q.x, q.y); await sleep(120);
          const a = await page.evaluate(`(() => { const s = PX.game.state(); return { hist: s.hist, p: s.s.p }; })()`);
          n++; if (a.hist !== 0 || a.p !== q.s) bad.push(`${id}@+${h}: hist ${a.hist}, p ${q.s}->${a.p}`);
        }
      }
      console.log(`       ${n} dokunuş`);
      eq(bad, [], 'Volti dokunuşu');
    });

    await test('R2 Volti dışına dokunuş hâlâ karoya yürür (P1, bir yürüyüş hedefi)', async () => {
      await load('P1');
      const q = await page.evaluate(`(() => { const L = PX.game.L, s = PX.game.state().s; const t = PX.SIM.walkTargets(L, s);
        for (const c of t) { const w = Game.screenOfTile(c); const k = Game.ownerAt(w.x, w.y); if (k.cell === c) return { c, x: w.x, y: w.y }; } return null; })()`);
      ok(q, 'hedef'); await page.tap(q.x, q.y); await sleep(120);
      eq(await page.evaluate('PX.game.state().s.p'), q.c);
    });

    await test('R4 açma kıstırması, sonraki seviyeye geç: ilk açma kıstırması yakınlaştırır', async () => {
      const pinch = async () => {
        const send = (type, pts, t) => page.conn.send('Input.dispatchTouchEvent', { type, timestamp: t / 1000, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
        const t0 = Date.now(); await send('touchStart', [[170, 330], [205, 330]], t0);
        for (let i = 1; i <= 8; i++) { await sleep(16); await send('touchMove', [[170 - i * 6, 330], [205 + i * 6, 330]], t0 + i * 16); }
        await send('touchEnd', [], t0 + 160); await sleep(320);
        return page.evaluate('({ z: PX.camera.zoom, lvl: PX.camera.zoomLevel })');
      };
      await load(ids[0]); const a = await pinch(); eq(a.lvl, 1, ids[0]); ok(a.z > 1.2, 'zoom ' + a.z);
      await load(ids[1] || ids[0]); eq(await page.evaluate('PX.camera.zoomLevel'), 0, 'yükleme sıfırlar');
      const b = await pinch(); eq(b.lvl, 1, 'ilk açma'); ok(b.z > 1.2, 'zoom ' + b.z);
    });

    await test('R1 yürürken gerçek sürükleme: kamera hemen döner, Volti aynı fiziksel yolda yürür, defter tek g', async () => {
      await load(ids.indexOf('M1') >= 0 ? 'M1' : ids[0]);
      const r = await page.evaluate(`new Promise(res => { const L = PX.game.L, s = PX.game.state().s; let best = -1, bl = -1;
        for (const c of PX.SIM.walkTargets(L, s)) { const w = PX.SIM.walkPath(L, s, c); if (w && w.length > bl) { bl = w.length; best = c; } }
        const want = PX.SIM.walkPath(L, s, best).map(x => x.c); /* karo + merdiven/iskele hücreleri */ const v0 = PX.game.camView; Game.cmd({ t: 'tap', cell: best });
        const seen = []; let rotated = false; const t0 = performance.now();
        let errN = 0, errS = ''; const tmo = setTimeout(() => { off(); res({ timeout: true, frames: seen.length, errN, errS, busy: PX.game.busy, cb: PX.camera.busy() }); }, 20000);
        const off = Game.onFrame(() => { try { const p = PX.volti.probe(); if (p.cell >= 0 && seen[seen.length - 1] !== p.cell) seen.push(p.cell);
          if (!rotated && performance.now() - t0 > 120) { rotated = true; Game.cmd({ t: 'rot', d: 1, src: 'drag' }); PX.camera.snapTo(PX.game.camView); }
          if (rotated && !PX.game.busy && !PX.camera.busy()) { off(); clearTimeout(tmo); res({ want, seen, v0, v: PX.game.camView, cam: PX.camera.v, toks: PX.game.tokens(), best, pv: PX.game.state().presentation.s.p }); }
          } catch (e) { errN++; errS = String(e && e.message); } }); })`, 30000);
      ok(!r.timeout, 'zaman aşımı ' + JSON.stringify(r)); eq(r.v, (r.v0 + 1) & 3, 'görünüm'); eq(r.cam, r.v, 'kamera = camView');
      ok(/^g\d+$/.test(r.toks), 'defter ' + r.toks); eq(r.pv, r.best, 'hedefe vardı');
      ok(r.seen.every(c => r.want.indexOf(c) >= 0), 'Volti yalnız fiziksel yolun karolarından geçti: ' + JSON.stringify(r.seen) + ' / ' + JSON.stringify(r.want));
    });

    await test('R3 uzak dokunuş + sürükleme döndürmesi + hızlı geri al -> kamera = oyuncunun görünümü (döndürme geri alınmaz)', async () => {
      for (const [id, undos] of [[ids[0], 1], [ids[1] || ids[0], 2], [ids.indexOf('M1') >= 0 ? 'M1' : ids[0], 1]]) {
        await load(id);
        const r = await page.evaluate(`new Promise(res => { const L = PX.game.L, s = PX.game.state().s; let best = -1, bl = -1;
          for (const c of PX.SIM.walkTargets(L, s)) { const w = PX.SIM.walkPath(L, s, c); if (w && w.length > bl) { bl = w.length; best = c; } }
          Game.idle(5000).then(() => { Game.cmd({ t: 'tap', cell: best }); const v0 = PX.game.camView;
            requestAnimationFrame(() => { Game.cmd({ t: 'rot', d: 1, src: 'drag' });
              setTimeout(() => { for (let k = 0; k < ${undos}; k++) Game.cmd({ t: 'undo' }); res({ best, bl, v0 }); }, 60); }); }); })`);
        await idle(); await sleep(400);
        const e = await page.evaluate('({ cam: PX.camera.v, gv: PX.game.camView, hist: PX.game.state().hist })');
        eq([e.cam, e.gv], [(r.v0 + 1) & 3, (r.v0 + 1) & 3], `${id} x${undos}`); eq(e.hist, 0, 'geçmiş boş');
      }
    });
  } finally { await page.close(); }
  return res;
}

(async () => {
  let fail = 0; const errs = [];
  const a = await unitPart(); fail += a.fail; errs.push(...a.errs); console.log(`${a.name}: ${a.pass} ok, ${a.fail} fail\n`);
  if (!opt('unit')) {
    const file = path.resolve(typeof opt('file') === 'string' ? opt('file') : path.join(ROOT, 'index.html'));
    if (!fs.existsSync(file)) { console.log('dosya yok: ' + file); process.exit(1); }
    try { const b = await browserPart(file); fail += b.fail; errs.push(...b.errs); console.log(`${b.name}: ${b.pass} ok, ${b.fail} fail\n`); }
    catch (e) { fail++; errs.push('browser: ' + (e && e.stack || e)); console.log('FAIL browser: ' + (e && e.stack || e)); }
  }
  if (errs.length) console.log(errs.map(e => '  - ' + e).join('\n'));
  console.log(fail ? 'REGRESS controller-input: FAIL' : 'REGRESS controller-input: ALL PASS');
  process.exit(fail ? 1 : 0);
})();
