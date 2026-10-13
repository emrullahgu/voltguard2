#!/usr/bin/env node
'use strict';
// ============================================================================
// tools/test/regress_render.js — render-camera / volti-audio / kits regresyonları (R1 tam oyun incelemesi)
//   node tools/test/regress_render.js [--file <html>] [--only rotA,stair,occl,pick,trip,feet,alloc,hudalloc,materials,labels]
// Her denetim kendi Chrome'unda (tools/test/cdp.js, telefon 375×667 DPR2 dokunma) koşar; hata varsa çıkış kodu 1.
//   rotA   kural sürümü 4: yürürken kamerayı tutup döndürmek YALNIZ görseldir — Volti beklemez, kökün 3B yolu döndürmesiz
//          koşuyla aynıdır (P1, merdivenden mezanine), tek karede ışınlanma yok, yol hedefte biter
//   stair  merdiven + iskele seviyelerinde dokun-yürü: kat değişimi yalnız merdiven/iskele düğümlerinden (probe().mode),
//          yol önizlemesi (PX.flow.info().path) yürürken var, bitince yok
//   occl   örtücü saydamlığı: PX.diorama.fadedSet() == sim2.occluders(L, görünüm, PX.game.focusTargets()) (4 görünüm);
//          saydam blok örneği opak kümede sıfır ölçekli; örtülen karoya dokunuş saydam bloğun ARKASINDAKİ karoyu seçer
//   pick   M1 döndürme yayı sürerken her karede bir karonun O ANKİ ekran konumuna dokunuş (PX.camera.pick): kamera
//          hedefe ≤ 8° iken daima o karo (eskiden 8° üstü 'none' = dokunuş kayıp, altı yanlış cihaz/karo)
//   trip   altın çözümlerden koruma açması üreten ilk cihaz işlemi: açan kesici elState.tripped (BRK_T/FLAG_T); geri al ->
//          false, yinele -> true, anında yeniden oynatmada da true
//   feet   uzun düz yürüyüş (≥ 4 karo/s): duruştaki ayak bir duruş boyunca ≤ 0,03 karo kayar (adım fazından)
//   alloc  M1 boşta: render/volti.js modülüne ait örneklenen ayırma ≤ 150 B/kare (eskiden 1–2,5 KB, Sparkplug kutulama)
//   hudalloc F7 boşta: etiket yerleşimi tekrar çalışmaz; HUD örneklenen ayırma ≤ 512 B/kare (çizim motoru hariç)
//   materials M1/F7: aynı malzeme normal/instanced/skinned Mesh türlerinde ortak kullanılmaz (r128 program churn)
//   labels F7 + tek hat paneli açık, 375×667 ve 667×375: görünür .dl cihaz etiketlerinin kutuları çakışmıyor
//          (PX.camera.declutter; hud.js bağlantısı ui ekibinde — bağlı değilse yalnız işlevin kendisi sınanır, not düşülür)
// ============================================================================
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');
const { sleep } = cdp;

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf('--' + k); if (i >= 0) return argv[i + 1]; const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const FILE = path.resolve(arg('file') || path.join(ROOT, 'index.html'));
const ONLY = (arg('only') || '').split(',').filter(Boolean);
const PHONE = { width: 375, height: 667, mobile: true, touch: true, dpr: 2 };
const READY = 'window.Game && window.Game.ready === true';

let failed = 0;
const res = (name, ok, msg) => { if (!ok) failed++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (msg ? ' — ' + msg : '')); };

async function withGame(vp, fn) {
  const page = await cdp.launch(vp || PHONE);
  try {
    await page.addInitScript('window.__PX_TEST__ = true;');
    await page.goto(FILE, { debug: true });
    await page.waitFor(READY, 30000, 50);
    return await fn(page);
  } finally { await page.close(); }
}

// sayfa içi yardımcılar: kök izi (fiziksel 3B), yürüyüş durumu, kamera açısı
const HELPERS = `(() => {
  const H = window.__rr = {};
  H.rows = []; H.off = null;
  H.start = () => { H.rows = []; let last = performance.now(); H.off = Game.onFrame(() => { const R = PX.volti.rig, r = R.root.position, p = PX.volti.probe();
    const now = performance.now();
    H.rows.push({ t: now, dt: (now - last) / 1000, rx: r.x, ry: r.y, rz: r.z, moving: R.moving, speed: R.speed, az: PX.camera.az, cell: p.cell, mode: p.mode, path: PX.flow.info ? PX.flow.info().path : -1 }); last = now; }); };
  H.stop = () => { if (H.off) H.off(); H.off = null; return H.rows; };
  return true;
})()`;
// iz: 3B tek kare ışınlanma (hızın 1,5 katı + pay) ve duraklama (yürürken hız ≈ 0 kareler)
function analyse(rows) {
  const out = { jumps: 0, worstJump: 0, stalls: 0, first: '' };
  for (let k = 1; k < rows.length; k++) {
    const a = rows[k - 1], b = rows[k];
    const st = Math.hypot(b.rx - a.rx, b.ry - a.ry, b.rz - a.rz), lim = Math.max(0.3, 7.2 * Math.min(b.dt, 0.1) * 1.5);
    if (st > out.worstJump) out.worstJump = st;
    if (st > lim) { out.jumps++; if (!out.first) out.first = `frame ${k}: step ${st.toFixed(3)} > ${lim.toFixed(3)}`; }
    if (b.moving && a.moving && b.speed < 0.05 && k > 3 && k < rows.length - 3) out.stalls++;
  }
  return out;
}
// yürüyüş izini yol üzerindeki noktalara indirger: ardışık kök konumları (çizgi), karşılaştırma için en yakın nokta uzaklığı
function pathDev(a, b) { let worst = 0; for (const p of a) { let best = 1e9; for (let i = 1; i < b.length; i++) { const q0 = b[i - 1], q1 = b[i];
  const dx = q1.rx - q0.rx, dy = q1.ry - q0.ry, dz = q1.rz - q0.rz, l2 = dx * dx + dy * dy + dz * dz; let t = l2 > 0 ? ((p.rx - q0.rx) * dx + (p.ry - q0.ry) * dy + (p.rz - q0.rz) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  const d = Math.hypot(q0.rx + dx * t - p.rx, q0.ry + dy * t - p.ry, q0.rz + dz * t - p.rz); if (d < best) best = d; } if (best > worst) worst = best; } return worst; }

const CHECKS = {
  async rotA() {
    await withGame(PHONE, async page => {
      await page.evaluate(HELPERS);
      const run = async rot => {
        await page.evaluate(`Game.load('P1')`); await page.evaluate('Game.idle(20000)'); await sleep(200);
        const tgt = await page.evaluate(`(() => { const L = PX.game.L; const st = L.stairs[0]; return st ? st.hi : -1; })()`);
        // Volti'nin kurduğu yoğun yol (fiziksel; kare örneklemesinden bağımsız)
        const dense = await page.evaluate(`(() => { __rr.start(); Game.cmd({t:'tap', cell:${'${tgt}'}}); const R = PX.volti.rig; const o = []; for (let i = 0; i < R.nP; i++) o.push({ rx: R.px[i], ry: R.py[i], rz: R.pz[i] }); return o; })()`.replace('${tgt}', tgt));
        // döndürme input/gesture.js gibi: kamerayı tut-sürükle, bırakınca {t:'rot', src:'drag'} + snapTo(camView)
        if (rot) { await sleep(60); await page.evaluate('(() => { PX.camera.grab(); PX.camera.drag(0); PX.camera.drag(70); return true; })()'); await sleep(250);
          await page.evaluate('(() => { PX.camera.drag(140); return true; })()'); await sleep(200);
          await page.evaluate('(() => { const q = PX.camera.release(0); for (let i = 0; i < Math.abs(q); i++) PX.game.command({t:\'rot\', d: q > 0 ? 1 : -1, src:\'drag\'}); PX.camera.snapTo(PX.game.camView); return q; })()'); }
        await page.evaluate('Game.idle(20000)'); await sleep(150);
        const rows = await page.evaluate('__rr.stop()'); const end = await page.evaluate('Game.probe()');
        return { rows: rows.filter(r => r.moving), all: rows, end, tgt, dense };
      };
      const base = await run(false), rot = await run(true);
      // döndürmeli koşunun her karesi döndürmesiz koşunun yoğun yolunun üstünde (kök: merdivende eğik düzlem, karoda üst)
      const an = analyse(rot.all), dev = Math.max(pathDev(rot.rows, base.dense), pathDev(rot.dense, base.dense));
      const turned = rot.all.length ? Math.abs(rot.all[rot.all.length - 1].az - rot.all[0].az) : 0;
      res('rotA camera turned while Volti walked (visual only)', turned > 0.5, `Δaz ${(turned * 180 / Math.PI).toFixed(0)}°`);
      res('rotA physical path identical to the no-rotation walk (≤ 0.02)', rot.rows.length > 5 && dev <= 0.02, `max deviation ${dev.toFixed(4)}`);
      res('rotA no one-frame teleport, no waiting', an.jumps === 0 && an.stalls === 0, `${an.jumps} jump(s) worst ${an.worstJump.toFixed(3)}, ${an.stalls} stall frame(s) ${an.first}`);
      res('rotA walk completes on target (up the stair)', rot.end.cell === rot.tgt && !rot.end.moving, `cell ${rot.end.cell} target ${rot.tgt}`);
    });
  },
  async stair() {
    await withGame(PHONE, async page => {
      await page.evaluate(HELPERS);
      const lv = await page.evaluate(`Game.levels().map(l => l.id)`);
      let n = 0;
      for (const id of lv) {
        await page.evaluate(`Game.load(${JSON.stringify(id)})`); await page.evaluate('Game.idle(20000)');
        const plan = await page.evaluate(`(() => { const L = PX.game.L; const out = []; for (const st of L.stairs) out.push(['merdiven', st.lo, st.hi]); for (const ld of L.ladders) out.push(['iskele', ld.foot, ld.top]); return out; })()`);
        for (const [kind, lo, hi] of plan) {
          // alt uca yerleş, üst uca dokun-yürü (Volti fiziksel yoldan gider), sonra geri in
          for (const [a, b] of [[lo, hi], [hi, lo]]) {
            const ok = await page.evaluate(`(() => { const L = PX.game.L, s = PX.game.state().s; if (!PX.SIM.walkPath(L, Object.assign({}, s, {p:${'${a}'}}), ${'${b}'})) return false;
              PX.game.command({t:'reset'}); return true; })()`.replace('${a}', a).replace('${b}', b));
            if (!ok) continue;
            await page.evaluate(`(() => { const L = PX.game.L; const s = PX.game.state().s; const w = PX.SIM.walkPath(L, s, ${a}); if (w && s.p !== ${a}) { PX.game.setInstant(true); PX.game.command({t:'act', a:{t:'git', to:${a}}}); PX.game.setInstant(false); } return true; })()`);
            await page.evaluate('Game.idle(20000)');
            await page.evaluate(`(() => { __rr.start(); Game.cmd({t:'tap', cell:${b}}); return true; })()`);
            await page.evaluate('Game.idle(20000)'); await sleep(80);
            const rows = await page.evaluate('__rr.stop()'); const end = await page.evaluate('Game.probe()');
            const via = rows.some(r => r.mode === kind), line = rows.some(r => r.moving && r.path > 0), cleared = rows.length && rows[rows.length - 1].path === 0;
            const levels = new Set(rows.filter(r => r.mode === 'karo').map(r => Math.round(r.ry * 2) / 2));
            n++;
            const good = end.cell === b && via && line && cleared && levels.size <= 2;
            res(`stair ${id} ${kind} ${a}->${b}: level change only via the ${kind} (path line shown, then cleared)`, good,
              `end ${end.cell} via ${via} line ${line} cleared ${cleared} floor heights ${[...levels].join('/')}`);
            if (n >= 24) return;
          }
        }
      }
    });
  },
  async occl() {
    await withGame(PHONE, async page => {
      const lv = await page.evaluate(`Game.levels().map(l => l.id)`);
      let checked = 0, through = 0, bad = 0;
      for (const id of lv) {
        await page.evaluate(`Game.load(${JSON.stringify(id)})`); await page.evaluate('Game.idle(20000)');
        for (let v = 0; v < 4; v++) {
          await page.evaluate(`Game.cmd({t:'rot', d:1})`); await page.evaluate('Game.idle(20000)'); await sleep(250);
          const r = await page.evaluate(`(() => { const L = PX.game.L, v = PX.camera.v; const want = PX.SIM.occluders(L, v, PX.game.focusTargets()); const got = [...PX.diorama.fadedSet()].sort((a, b) => a - b);
            const same = want.length === got.length && want.every((c, i) => c === got[i]);
            // saydam blok örneği opak kümede sıfır ölçekli mi?
            const m = PX.diorama.blocks; const cells = m.userData.cells; let hidden = 0, nb = 0; const e = new THREE.Matrix4();
            for (let i = 0; i < cells.length; i++) if (got.indexOf(cells[i]) >= 0) { nb++; m.getMatrixAt(i, e); if (Math.abs(e.elements[0]) < 1e-9) hidden++; }
            // örtülen hedef karoya dokunuş: Volti'nin karosu (ya da iş karosu) saydam bloğun arkasında seçilir
            let tap = null; const s = PX.game.state().s;
            for (const c of [s.p, L.work]) { if (c < 0) continue; const [x, y, z] = L.G.xyz(c); const [sx, sz] = PX.SIM.VIEWS[v]; const U = sx * x - y - 1, V = sz * z - y - 1;
              const o0 = PX.SIM.ownerAt(L, v, U, V, 1, null); if (!o0 || o0.c === c) continue;      // örtülmüyor
              const q = PX.camera.worldToClient(x + sx * 0.12, y + 0.5, z + sz * 0.12, {}); const k = PX.camera.pick(q.x, q.y); tap = { c, got: k.cell, kind: k.kind }; break; }
            return { v, same, want, got, nb, hidden, tap }; })()`);
          checked++;
          if (!r.same || r.hidden !== r.nb) { bad++; res(`occl ${id} v${r.v}: faded set == sim2.occluders, faded block instances hidden`, false, `want ${r.want} got ${r.got} hidden ${r.hidden}/${r.nb}`); }
          if (r.tap) { through++; if (r.tap.got !== r.tap.c) { bad++; res(`occl ${id} v${r.v}: tap on covered tile ${r.tap.c} selects it through the faded blocks`, false, JSON.stringify(r.tap)); } }
        }
      }
      res(`occl faded sets match sim2.occluders in ${checked} level-views`, bad === 0, '');
      res(`occl taps on covered tiles resolve through faded blocks (${through} cases)`, through > 0, '');
    });
  },
  async pick() {
    await withGame(PHONE, async page => {
      await page.evaluate(`Game.load('M1')`); await page.evaluate('Game.idle(20000)'); await sleep(300);
      const r = await page.evaluate(`new Promise(res => {
        const L = PX.game.L, v0 = PX.camera.v, v1 = (v0 + 3) & 3; let c = -1;
        for (const t of L.tiles) { const [x, y, z] = L.G.xyz(t); let ok = true; for (const v of [v0, v1]) { const [sx, sz] = PX.SIM.VIEWS[v]; const o = PX.SIM.ownerAt(L, v, sx * x - y - 1, sz * z - y - 1, 1, null), o2 = PX.SIM.ownerAt(L, v, sx * x - y - 1, sz * z - y - 1, 0, null); if (!o || o.c !== t || !o2 || o2.c !== t) ok = false; } if (ok) { c = t; break; } }
        window.__pc = c; const [x, y, z] = L.G.xyz(c), out = [];
        Game.cmd({t:'rot', d:-1});
        const off = Game.onFrame(() => {
          const C = PX.camera, d = Math.abs(C.az - C.nearAz(C.v, C.az)) * 180 / Math.PI, p = C.worldToClient(x, y + 0.5, z, {}), k = C.pick(p.x, p.y);
          out.push([+d.toFixed(2), k.kind, k.cell, k.el]);
          if (!C.busy()) { off(); res(out); }
        });
      })`);
      const near = r.filter(q => q[0] <= 8 && q[0] > 0.01);
      const pc = await page.evaluate('window.__pc');
      const bad = near.filter(q => !(q[1] === 'tile' && q[2] === pc));
      res('pick mid-rotation (≤ 8° off) resolves the tile under the finger', near.length > 0 && bad.length === 0,
        `${near.length} frame(s) ≤ 8°, ${bad.length} wrong: ${JSON.stringify(bad.slice(0, 4))}`);
      const mid = r.filter(q => q[0] > 8);
      const lost = mid.filter(q => q[1] === 'none');
      res('pick mid-rotation (> 8° off) is not dropped', mid.length === 0 || lost.length === 0, `${lost.length}/${mid.length} 'none'`);
    });
  },
  async trip() {
    await withGame(PHONE, async page => {
      // altın çözümlerden koruma açması üreten ilk işlem (sim2.apply r.trips)
      // altın yol boyunca her durumda her aday cihaz işlemi denenir: koruma açması üreten ilk işlem (yürüyüş öneki dahil)
      const f = await page.evaluate(`(() => { for (const lv of Game.levels()) { const L = PX.SIM.compile(Game.level(lv.id).def); let s = PX.SIM.initState(L); const toks = lv.cozum.split(' ');
          for (let i = 0; i <= toks.length; i++) {
            for (const e of L.els.map((x, k) => k).filter(k => L.els[k].t === 'kesici' || L.els[k].t === 'ayirici' || L.els[k].t === 'yuk_ayirici')) {
              const t = PX.SIM.approachTile(L, s, e); if (t < 0) continue; let s2 = s, pre = toks.slice(0, i).join(' ');
              if (t !== s.p) { const g = PX.SIM.apply(L, s, { t: 'git', to: t }); if (g.err) continue; s2 = g.s; pre = (pre + ' ' + PX.SIM.encodeAct(L, s, { t: 'git', to: t })).trim(); }
              const r = PX.SIM.apply(L, s2, { t: 'op', e }); if (r.err || !r.trips || !r.trips.length) continue;
              const br = r.trips.map(k => L.els[k]).find(x => x && x.t === 'kesici'); if (br) return { id: lv.id, pre, tok: 'o:' + L.els[e].id, br: br.id };
            }
            if (i === toks.length) break;
            const a = PX.SIM.decodeAct(L, s, toks[i]); const r = PX.SIM.apply(L, s, a); if (r.err) break; s = r.s; } } return null; })()`);
      if (!f) { res('trip: some golden solution trips a breaker', false, 'none found'); return; }
      await page.evaluate(`Game.load(${JSON.stringify(f.id)})`); await page.evaluate('Game.idle(20000)');
      const q = `(() => { const L = PX.game.L; const s = PX.diorama.elState(L.elIndex[${JSON.stringify(f.br)}]); return s ? s.tripped : null; })()`;
      await page.evaluate(`Game.replay(${JSON.stringify(f.pre)}, {instant:true})`);
      await page.evaluate(`Game.cmd({t:'act', tok:${JSON.stringify(f.tok)}})`); await page.evaluate('Game.idle(20000)');
      const t1 = await page.evaluate(q);
      res(`trip animated (${f.id} ${f.tok}): ${f.br} shows the protection trip (tripped)`, t1 === true, `tripped=${t1}`);
      await page.evaluate(`Game.cmd({t:'undo'})`); await page.evaluate('Game.idle(20000)'); await sleep(100);
      const t2 = await page.evaluate(q);
      res('trip undo: flag cleared', t2 === false, `tripped=${t2}`);
      await page.evaluate(`Game.cmd({t:'redo'})`); await page.evaluate('Game.idle(20000)'); await sleep(100);
      const t3 = await page.evaluate(q);
      res('trip redo: flag back', t3 === true, `tripped=${t3}`);
      await page.evaluate(`Game.replay(${JSON.stringify((f.pre + ' ' + f.tok).trim())}, {instant:true})`); await sleep(100);
      const t4 = await page.evaluate(q);
      res('trip instant replay: flag set', t4 === true, `tripped=${t4}`);
    });
  },
  async feet() {
    await withGame(PHONE, async page => {
      await page.evaluate(`Game.load('M3')`); await page.evaluate('Game.idle(20000)'); await sleep(300);
      const rows = await page.evaluate(`new Promise(res => {
        const R = PX.volti.rig, fl = R.bones.find(b => b.name === 'footL'), fr = R.bones.find(b => b.name === 'footR'), out = []; let last = performance.now();
        const L = PX.game.L, s = PX.game.state().s; let far = -1, fd = 0; for (const t of PX.SIM.walkTargets(L, s)) { const w = PX.SIM.walkPath(L, s, t); if (w && w.length > fd) { fd = w.length; far = t; } }
        Game.cmd({t:'tap', cell: far});
        const v = new THREE.Vector3();
        const off = Game.onFrame(gdt => { const now = performance.now(); const row = [gdt, R.zi >= 0 ? 0 : R.speed, R.root.position.y, R.moving ? 1 : 0, Math.abs(Math.atan2(Math.sin(R.yawA - R.yawGoal), Math.cos(R.yawA - R.yawGoal)))];   // oyunun kendi dt'si; merdiven/iskele bölgesi hariç (V7)
          for (const f of [fl, fr]) { f.getWorldPosition(v); row.push(v.x, v.y, v.z); } row.push(R.phase); last = now; out.push(row);
          if (!R.moving && out.length > 5) { off(); res(out); } });
      })`);
      // duruş: rig'in adım fazı (sol u = faz, sağ u = faz + 0,5; u < 0,5 duruş). Her duruşta ayağın ilk duruş örneğinden
      // sonraki örneklere yatay kayması (kare süresinden bağımsız; headless kare takılmalarına dayanıklı)
      let n = 0, mx = 0; const st = [null, null];
      for (let k = 0; k < rows.length; k++) {
        const b = rows[k];
        for (let f = 0; f < 2; f++) {
          const o = f ? 8 : 5, u = (b[11] + (f ? 0.5 : 0)) % 1;
          const ok = b[3] && b[1] >= 4 && b[4] <= 0.05 && u > 0.04 && u < 0.46;
          if (!ok) { st[f] = null; continue; }
          if (!st[f] || u < st[f].u) { st[f] = { u, x: b[o], z: b[o + 2] }; continue; }
          st[f].u = u; n++; const d = Math.hypot(b[o] - st[f].x, b[o + 2] - st[f].z); if (d > mx) mx = d;
          if (process.env.FEETDBG) console.log('   ', f, u.toFixed(3), d.toFixed(4));
        }
      }
      res('feet: planted foot does not skate on straights (drift within a stance ≤ 0.03 tiles)', n > 5 && mx <= 0.03, `${n} stance samples, max drift ${mx.toFixed(4)} tiles`);
    });
  },
  async alloc() {
    await withGame(PHONE, async page => {
      await page.evaluate(`Game.load('M1')`); await page.evaluate('Game.idle(20000)');
      await sleep(4000);
      const html = fs.readFileSync(FILE, 'utf8').split('\n');
      const a = html.findIndex(l => l.startsWith('// ==== render/volti.js')), b = html.findIndex((l, i) => i > a && l.startsWith('// ==== '));
      await page.evaluate('window.__fc = 0; window.__fo = Game.onFrame(() => { window.__fc++; }); true');
      await page.conn.send('HeapProfiler.enable');
      await page.conn.send('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await sleep(3000);
      const pr = await page.conn.send('HeapProfiler.stopSampling');
      const fc = await page.evaluate('window.__fo(), window.__fc');
      let tot = 0, vol = 0;
      const walk = n => { tot += n.selfSize; const ln = n.callFrame.lineNumber; if (n.callFrame.url && /\.html/.test(n.callFrame.url) && ln >= a && ln < b) vol += n.selfSize; for (const c of n.children) walk(c); };
      walk(pr.profile.head);
      res('alloc: Volti rig idle allocation ≤ 150 B/frame', a >= 0 && fc > 30 && vol / fc <= 150, `volti ${(vol / fc).toFixed(0)} B/frame of ${(tot / fc).toFixed(0)} total, ${fc} frames`);
    });
  },
  async hudalloc() {
    await withGame(PHONE, async page => {
      await page.evaluate("Game.load('F7')"); await page.evaluate('Game.idle(20000)');
      await page.evaluate('PX.sld.open(true)'); await sleep(4000);
      const html = fs.readFileSync(FILE, 'utf8').split('\n');
      const a = html.findIndex(l => l.startsWith('// ==== ui/hud.js')), b = html.findIndex((l, i) => i > a && l.startsWith('// ==== '));
      await page.evaluate(`(()=>{ window.__hudFrames=0; window.__hudLayouts=0; const dc=PX.camera.declutter;
        PX.camera.declutter=boxes=>{window.__hudLayouts++;return dc(boxes)};
        window.__hudOff=Game.onFrame(()=>{window.__hudFrames++}); return true; })()`);
      await page.conn.send('HeapProfiler.enable');
      await page.conn.send('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await sleep(3000);
      const pr = await page.conn.send('HeapProfiler.stopSampling');
      const state = await page.evaluate('(__hudOff(), {frames:__hudFrames, layouts:__hudLayouts})');
      let hud = 0;
      const walk = n => { const ln = n.callFrame.lineNumber; if (n.callFrame.url && /\.html/.test(n.callFrame.url) && ln >= a && ln < b) hud += n.selfSize; for (const c of n.children) walk(c); };
      walk(pr.profile.head);
      res('hudalloc: settled labels use their cached layout', state.frames > 30 && state.layouts === 0, `${state.frames} frames, ${state.layouts} layout passes`);
      res('hudalloc: HUD idle allocation ≤ 512 B/frame', a >= 0 && state.frames > 30 && hud / state.frames <= 512, `${(hud / state.frames).toFixed(0)} B/frame`);
    });
  },
  async materials() {
    await withGame(PHONE, async page => {
      for (const id of ['M1', 'F7']) {
        await page.evaluate(`Game.load(${JSON.stringify(id)})`); await page.evaluate('Game.idle(20000)'); await sleep(500);
        const mixed = await page.evaluate(`(()=>{ const groups=new Map(); PX.scene.scene.traverse(o=>{
          if(!o.isMesh||!o.material) return; for(let n=o;n;n=n.parent) if(!n.visible) return;
          for(const m of (Array.isArray(o.material)?o.material:[o.material])) {
            let g=groups.get(m.uuid); if(!g) {g={name:m.name||m.type,kinds:new Set(),users:[]};groups.set(m.uuid,g)};
            g.kinds.add(o.isInstancedMesh?'instanced':o.isSkinnedMesh?'skinned':'normal');g.users.push(o.name||o.type);
          }
        }); return [...groups.values()].filter(g=>g.kinds.size>1).map(g=>g.name+': '+g.users.join(', ')) })()`);
        res(`materials ${id}: each material has one mesh shader variant`, mixed.length === 0, mixed.join(' | ') || 'no shared variant conflicts');
      }
    });
  },
  async labels() {
    for (const vp of [PHONE, { width: 667, height: 375, mobile: true, touch: true, dpr: 2 }]) {
      await withGame(vp, async page => {
        await page.evaluate(`Game.load('F7')`); await page.evaluate('Game.idle(20000)');
        await page.evaluate('PX.sld && PX.sld.open && PX.sld.open(true)'); await sleep(900);
        const r = await page.evaluate(`(() => {
          const ls = [...document.querySelectorAll('#labels .dl')].filter(e => e.style.display !== 'none' && e.offsetParent !== null && getComputedStyle(document.getElementById('labels')).visibility !== 'hidden');
          const cr = PX.scene.rect; const rs = ls.map(e => { const b = e.getBoundingClientRect(); return { id: e.textContent, x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })
            .filter(b => b.w > 0 && b.x >= cr.left && b.x <= cr.left + cr.width && b.y >= cr.top && b.y <= cr.top + cr.height);
          const ov = bs => { const o = []; for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const p = bs[i], q = bs[j];
            const ox = (p.w + q.w) / 2 - Math.abs((p.x + (p.dx || 0)) - (q.x + (q.dx || 0))), oy = (p.h + q.h) / 2 - Math.abs((p.y + (p.dy || 0)) - (q.y + (q.dy || 0)));
            if (ox > 0.5 && oy > 0.5) o.push(p.id + '/' + q.id); } return o; };
          const live = ov(rs);
          const fn = PX.camera.declutter; let after = null;
          if (fn) { const cp = rs.map(b => Object.assign({}, b)); fn(cp); after = ov(cp); }
          return { n: rs.length, live, after, wired: !!(PX.hud && PX.hud.declutterWired) };
        })()`);
        res(`labels ${vp.width}x${vp.height}: PX.camera.declutter separates all ${r.n} visible labels`, r.after !== null && r.after.length === 0, r.after ? r.after.join(' ') : 'declutter missing');
        res(`labels ${vp.width}x${vp.height}: on-screen labels stay separate after viewport clipping`, r.wired && r.live.length === 0, r.live.join(' ') || 'no overlaps');
      });
    }
  },
};

(async () => {
  if (!fs.existsSync(FILE)) { console.error('file not found: ' + FILE); process.exit(2); }
  console.log('regress_render: ' + FILE);
  for (const k of Object.keys(CHECKS)) {
    if (ONLY.length && !ONLY.includes(k)) continue;
    console.log('[' + k + ']');
    try { await CHECKS[k](); } catch (e) { failed++; console.log('  FAIL ' + k + ' harness error: ' + (e && e.message || e)); }
  }
  console.log(failed ? `regress_render: ${failed} FAILED` : 'regress_render: ALL PASS');
  process.exit(failed ? 1 : 0);
})();
