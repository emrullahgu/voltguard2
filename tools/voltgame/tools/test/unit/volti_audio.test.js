'use strict';
// ============================================================================
// Birim testleri — render/volti.js (PX.volti) ve audio/audio.js (PX.audio)            sahip: volti ekibi
//   node tools/test/unit/volti_audio.test.js [--file dev/v2-volti.html] [--levels=P1,M1] [--quick]
// Derlenmiş v2 sayfasını headless Chrome'da açar (tools/test/cdp.js) ve modülleri DOĞRUDAN sürer
// (kontrolcüden bağımsız; deterministik dt adımlarıyla):
//   V1 çizim çağrısı / üçgen bütçesi (§24.5: Volti ≤ 4 çizim)
//   V2 ayırma: boşta ve yürürken PX.volti.update kare başına bayt (≈ 0) + süre (µs)
//   V3 zemin stresi (kural sürümü 4, fiziksel dünya): her seviye, rastgele fiziksel yollar (sim2.walkPath; adım
//      nesneleri ya da karo hücreleri) + rastgele dt (1/240..0,1 s) + yol ortasında hedef değiştirme; HER adımda ayak
//      = sütundaki en yüksek katı yüzey (blok/eleman/duvar üstü ya da merdivenin eğik düzlemi; sim2 geometrisinden
//      bağımsız), iskelede tırmanırken zemin denetimi yok; gövde katı hücrede değil; 3B konum sürekli (ışınlanma yok);
//      yol sonunda ayak tam karo merkezinde
//   V7 basamak teması: merdivenden çıkış/iniş ve iskele tırmanışında duruştaki her ayağın tabanı bir basamağın /
//      basamak çubuğunun üstünde ve kaymıyor (render/kit geometrisiyle: PX.KIT.merdiven.N, PX.KIT.iskele.N)
//   V4 ilk hareket: followPath'ten sonraki İLK update kökü hareket ettirir (dokun→hareket ≤ 1 kare)
//   V5 klipler: süre = §15 tablosu (±1 kare), vuruş olayı tam bir kez, kök karo içinde ve karo üstünde,
//      iptal + place → kök tam merkezde; overlay (ret) yürüyüşü engellemez
//   V6 legEnd()/retarget()/chain (controller isteği): yürürken durmadan hedef değiştirme, tek Promise çözümü
//   A1 her ses istisnasız çalar; A2 normalizasyon (OfflineAudioContext ölçümü + kırpma = hedef ±1 dB, tepe ≤ 1)
//   A3 ses sınırı (aynı tür ≤ 3, toplam ≤ 12); A4 resume öncesi kuyruk (ilk ses düşmez);
//   A5 bulanıklaşmada 30 ms sönüm + askı, odakta geri gelme
// ============================================================================
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const cdp = require(path.join(ROOT, 'tools', 'test', 'cdp.js'));
const args = process.argv.slice(2);
const opt = k => { for (let i = 0; i < args.length; i++) { if (args[i] === '--' + k) return args[i + 1] || true; if (args[i].startsWith('--' + k + '=')) return args[i].slice(k.length + 3); } return null; };
const FILE = path.resolve(ROOT, opt('file') || 'dev/phys-render.html');
const QUICK = !!opt('quick');
let fails = 0; const rows = [];
const check = (name, ok, val, lim) => { rows.push([ok ? 'PASS' : 'FAIL', name, String(val), String(lim || '')]); if (!ok) fails++; };

// sayfa tarafı yardımcıları (bir kez enjekte edilir)
const HELPERS = `(() => {
  const H = window.__VT = {};
  const VIEWS = PX.SIM.VIEWS;
  // bağımsız zemin denetimi (kural sürümü 4 grounding örnekleyicisiyle aynı): katı = blok(1), eleman(2), duvar(5);
  // merdiven(3) eğik düzlem; iskele(4)/kapı(6) katı değil. p.mode === 'iskele' (tırmanıyor): zemin denetimi yok.
  H.ground = (p, L) => { const G = L.G, K = G.kind, E = 1e-4;
    const cx = new Set([Math.floor(p.x + 0.5 - E), Math.floor(p.x + 0.5 + E)]), cz = new Set([Math.floor(p.z + 0.5 - E), Math.floor(p.z + 0.5 + E)]);
    const stairH = (c, x, y, z, px, pz) => { const d = PX.SIM.DIRS[G.sdir[c]]; let t = (px - x) * d[0] + (pz - z) * d[1] + 0.5; t = t < 0 ? 0 : t > 1 ? 1 : t; return y - 0.5 + t; };
    let ground = -1e9, pen = 0;
    for (const x of cx) for (const z of cz) { if (x < 0 || z < 0 || x >= G.W || z >= G.D) continue;
      for (let y = G.H - 1; y >= 0; y--) { const c = G.idx(x, y, z); if (c < 0) continue; const k = K[c];
        const top = k === 1 || k === 2 || k === 5 ? y + 0.5 : k === 3 ? stairH(c, x, y, z, p.x, p.z) : null; if (top === null) continue;
        if (top <= p.footY + 0.01) { if (top > ground) ground = top; break; } } }
    const inside = (px, py, pz) => { const x = Math.round(px), y = Math.round(py), z = Math.round(pz); const c = G.idx(x, y, z); if (c < 0) return false; const k = K[c];
      if (!(Math.abs(px - x) < 0.5 - 1e-3 && Math.abs(py - y) < 0.5 - 1e-3 && Math.abs(pz - z) < 0.5 - 1e-3)) return false;
      return k === 1 || k === 2 || k === 5 || (k === 3 && py < stairH(c, x, y, z, px, pz) - 1e-3); };
    for (const h of [0.05, 0.45, 0.9]) if (inside(p.x, p.footY + h, p.z)) pen = 1;
    const climb = p.mode === 'iskele';
    return { err: climb ? 0 : p.footY - ground, pen, climb };
  };
  // fiziksel yol (sim2.walkPath) ve erişilebilir karolar (sim2.walkTargets); asSteps: adım nesneleri / karo hücreleri
  H.st = (L, p) => Object.assign({}, PX.game.state().s, { p });
  H.path = (L, v, from, to, asSteps) => { const w = PX.SIM.walkPath(L, H.st(L, from), to); if (!w) return null; return asSteps ? w : w.filter(x => x.k === 'karo').map(x => x.c); };
  H.reach = (L, v, from) => [from].concat(PX.SIM.walkTargets(L, H.st(L, from)));
  let seed = 12345; H.rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  H.lat = (v, p) => [p.x, p.y, p.z];
  void VIEWS;
  return true;
})()`;

async function main() {
  const lifecycle = await require('./audio_lifecycle')(); fails += lifecycle.fail;
  const page = await cdp.launch({ width: 375, height: 667, mobile: true, touch: true, dpr: 2 });
  try {
    await page.goto(FILE, { debug: true, lvl: 'P1' });
    await page.waitFor('window.Game && window.Game.ready === true', 30000, 50);
    const mods = await page.evaluate('({ volti: !!(PX.volti && PX.volti.legEnd && PX.volti.timing), audio: !!(PX.audio && PX.audio.names && PX.audio.stats) })');
    check('V0 real modules loaded (not stubs, no eval error)', mods.volti && mods.audio, JSON.stringify(mods) + (page.exceptions().length ? ' ' + page.formatLog(page.exceptions()[0]) : ''), 'both');
    if (!mods.volti || !mods.audio) throw new Error('modules missing: ' + JSON.stringify(mods) + ' ' + (page.exceptions().length ? page.formatLog(page.exceptions()[0]) : ''));
    await page.evaluate(HELPERS);
    // ana döngünün Volti'yi sürmesini durdur: testler update'i kendileri çağırır
    await page.evaluate('(() => { window.__vu = PX.volti.update; PX.volti.update = () => {}; return true; })()');
    const levels = (await page.evaluate('Game.levels().map(l => l.id)')).filter(id => !opt('levels') || opt('levels').split(',').includes(id));

    // ---------------------------------------------------------------- V1
    const inf = await page.evaluate('PX.volti.info()');
    check('V1 Volti draw calls (main rig)', inf.drawCalls <= 4, inf.drawCalls, '≤ 4');
    check('V1 Volti triangles', inf.tris <= 8000, inf.tris, '≤ 8000');
    const g = await page.evaluate('(() => { const a = PX.volti.ghost(true).visible; const d = PX.volti.info().drawCalls; PX.volti.ghost(false); return { a, d }; })()');
    check('V1 ghost rig toggles (+3 draws when on)', g.a && g.d <= 7, g.d, '≤ 7');

    // ---------------------------------------------------------------- V2 allocation + cost
    // Ayırma: V8 örnekleme yığın profili (HeapProfiler.startSampling, 64 B aralık) — usedJSHeapSize nicemlemesi ve
    // JIT/geri besleme vektörü gürültüsünden bağımsız; ısınmadan (4000 kare) sonra 12000 kare ölçülür.
    const sampled = async (setup, n) => {
      await page.evaluate(`(async () => { ${setup}; for (let i = 0; i < 4000; i++) window.__vu(1 / 60); return true; })()`, 60000);
      await page.conn.send('HeapProfiler.enable');
      await page.conn.send('HeapProfiler.startSampling', { samplingInterval: 64 });
      const r = await page.evaluate(`(() => { const t0 = performance.now(); for (let i = 0; i < ${n}; i++) window.__vu(1 / 60); const t1 = performance.now(); return { us: (t1 - t0) / ${n} * 1000, moving: PX.volti.probe().moving }; })()`, 120000);
      const { profile } = await page.conn.send('HeapProfiler.stopSampling');
      let bytes = 0; const tops = new Map();
      const walk = (nd, inV) => { const f = nd.callFrame; const here = inV || /updateRig|applyPose|walkUpdate|poseBase|armIK|legIK|clip|ov[A-Z]/.test(f.functionName || '');
        if (here && nd.selfSize) { bytes += nd.selfSize; const k = (f.functionName || '(anon)') + ':' + f.lineNumber; tops.set(k, (tops.get(k) || 0) + nd.selfSize); }
        for (const c of nd.children) walk(c, here); };
      walk(profile.head, false);
      const top = [...tops.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, v]) => k + ' ' + (v / n).toFixed(1)).join(', ');
      return { bpf: bytes / n, us: r.us, moving: r.moving, top };
    };
    const SET_M1 = "await Game.load('M1'); window.__L = Game.L(); window.__s = PX.game.state().s; PX.volti.cancel(); PX.volti.place(__s.p)";
    const aIdle = await sampled(SET_M1, 12000);
    const nPath = await page.evaluate('(() => { const ts = __VT.reach(__L, 0, __s.p); window.__far = __VT.path(__L, 0, __s.p, ts[ts.length - 1]); return __far.length; })()');
    const aWalk = await sampled("PX.volti.cancel(); PX.volti.place(__s.p); PX.volti.followPath(__far, { rate: 0.002 })", 12000);
    // iskele tırmanışı ayırması (M1: zeminden sahanlığa)
    const ldr = await page.evaluate('(() => { const ld = __L.ladders[0]; if (!ld) return null; window.__lp = __VT.path(__L, 0, ld.foot, ld.top, true); return __lp ? __lp.length : null; })()');
    const aClimb = ldr ? await sampled("PX.volti.cancel(); PX.volti.place(__L.ladders[0].foot); PX.volti.followPath(__lp, { rate: 0.0002 }); for (let i = 0; i < 40; i++) window.__vu(1 / 60)", 12000) : null;
    const aClip = await sampled("PX.volti.cancel(); PX.volti.place(__s.p); PX.volti.play('operate', { el: __L.els.findIndex(x => x.t === 'kesici'), dur: 6e6 })", 12000);
    await page.evaluate('(() => { PX.volti.cancel(); PX.volti.place(__s.p); return true; })()');
    check('V2 idle update allocation', aIdle.bpf < 16, aIdle.bpf.toFixed(2) + ' B/frame' + (aIdle.top ? ' (' + aIdle.top + ')' : ''), '< 16 B');
    check('V2 walk update allocation (' + nPath + ' tiles, still moving: ' + aWalk.moving + ')', aWalk.bpf < 16 && aWalk.moving, aWalk.bpf.toFixed(2) + ' B/frame' + (aWalk.top ? ' (' + aWalk.top + ')' : ''), '< 16 B');
    if (aClimb) check('V2 ladder climb update allocation (still moving: ' + aClimb.moving + ')', aClimb.bpf < 16 && aClimb.moving, aClimb.bpf.toFixed(2) + ' B/frame' + (aClimb.top ? ' (' + aClimb.top + ')' : ''), '< 16 B');
    check('V2 clip update allocation', aClip.bpf < 16, aClip.bpf.toFixed(2) + ' B/frame' + (aClip.top ? ' (' + aClip.top + ')' : ''), '< 16 B');
    check('V2 update cost idle / walk / clip', Math.max(aIdle.us, aWalk.us, aClip.us) < 300, aIdle.us.toFixed(1) + ' / ' + aWalk.us.toFixed(1) + ' / ' + aClip.us.toFixed(1) + ' µs', '< 300 µs');

    // ---------------------------------------------------------------- V3 grounding stress + V4 first motion
    const nWalk = QUICK ? 4 : 14;
    for (const id of levels) {
      const r = await page.evaluate(`(async () => {
        const id = ${JSON.stringify(id)}; await Game.load(id); const L = Game.L(); const s0 = PX.game.state().s;
        const out = { steps: 0, walks: 0, retargets: 0, bad: 0, pen: 0, jump: 0, endErr: 0, first: null, firstMove: 1, stair: 0, climb: 0, levelUps: 0 };
        const R = __VT.rnd;
        for (let rep = 0; rep < 2; rep++) {
          let cur = s0.p;
          PX.volti.cancel(); PX.volti.place(cur);
          for (let w = 0; w < ${nWalk}; w++) {
            const ts = __VT.reach(L, 0, cur); if (ts.length < 2) break;
            const to = ts[1 + Math.floor(R() * (ts.length - 1))]; const p = __VT.path(L, 0, cur, to, R() < 0.5); if (!p) continue;
            let done = false; PX.volti.followPath(p, {}).then(r => { if (!r.retarget) done = true; }); out.walks++;
            let prev = null, steps = 0, didRetarget = false, target = to;
            const p0 = PX.volti.probe(); const lx = p0.x, lz = p0.z, ly0 = p0.y;
            while (!done && steps < 6000) {
              const dt = R() < 0.15 ? 0.1 : (1 / 240 + R() * (1 / 30));
              window.__vu(dt); steps++; out.steps++;
              const pr = PX.volti.probe();
              if (steps === 1 && Math.hypot(pr.x - lx, pr.z - lz, pr.y - ly0) < 1e-4) out.firstMove = 0;
              const gr = __VT.ground(pr, L);
              if (pr.mode === 'merdiven') out.stair++; if (gr.climb) out.climb++;
              if (Math.abs(gr.err) > (pr.mode === 'merdiven' ? 1.5e-4 : 1e-6)) { out.bad++; if (!out.first) out.first = id + ' foot ' + pr.footY.toFixed(3) + ' err ' + gr.err.toFixed(3) + ' at ' + pr.x.toFixed(2) + ',' + pr.z.toFixed(2) + ' mode ' + pr.mode; }
              if (gr.pen) { out.pen++; if (!out.first) out.first = id + ' penetration at ' + pr.x.toFixed(2) + ',' + pr.footY.toFixed(2) + ',' + pr.z.toFixed(2); }
              const lat = __VT.lat(0, pr);
              if (prev) { const d = Math.hypot(lat[0] - prev[0], lat[1] - prev[1], lat[2] - prev[2]); const lim = 7.2 * dt * 1.5 + 1e-6; if (d > lim) { out.jump++; if (!out.first) out.first = id + ' jump ' + d.toFixed(3) + ' > ' + lim.toFixed(3) + ' mode ' + pr.mode; } }
              prev = lat;
              // yol ortasında hedef değiştirme: legEnd karosundan yeni yol (controller ile aynı sözleşme)
              if (!didRetarget && steps > 3 && R() < 0.08 && pr.moving) {
                didRetarget = true; const X = PX.volti.legEnd();
                if (X >= 0) { const ts2 = __VT.reach(L, 0, X); const to2 = ts2[Math.floor(R() * ts2.length)]; const p2 = __VT.path(L, 0, X, to2, R() < 0.5);
                  if (p2) { done = false; target = to2; out.retargets++; PX.volti.followPath(p2, {}).then(r => { if (!r.retarget) done = true; }); } }
              }
            }
            const pe = PX.volti.probe(); const [x, y, z] = L.G.xyz(target);
            if (Math.abs(L.G.xyz(cur)[1] - y) > 0) out.levelUps++;
            const e = Math.max(Math.abs(pe.x - x), Math.abs(pe.z - z), Math.abs(pe.y - (y + 0.5)));
            if (e > 1e-9 || pe.cell !== target) { out.endErr++; if (!out.first) out.first = id + ' end mismatch ' + e; }
            cur = target;
          }
        }
        return out;
      })()`, 300000);
      check(`V3 ${id} grounding stress (${r.walks} walks, ${r.retargets} retargets, ${r.levelUps} level changes, ${r.stair} stair / ${r.climb} ladder frames, ${r.steps} steps)`,
        r.bad === 0 && r.pen === 0 && r.jump === 0 && r.endErr === 0, `float ${r.bad}, inside ${r.pen}, jumps ${r.jump}, end ${r.endErr}${r.first ? ' — ' + r.first : ''}`, 'all 0');
      check(`V4 ${id} first update after followPath moves Volti`, r.firstMove === 1, r.firstMove ? 'yes' : 'no', 'yes');
    }

    // ---------------------------------------------------------------- V6 legEnd / retarget / chain (controller isteği)
    // Uzun bir yürüyüş başlat; rastgele bir anda legEnd() X'ten yeni bir hedefe retarget; Volti durmadan (hız > 0)
    // ve zeminden ayrılmadan yeni sonda durur, açık Promise {cancelled:false} ile ÇÖZÜLÜR (tek kez). Ayrıca
    // retarget([X]) = X'te dur; uyuşmayan cells[0] → false ve yol değişmez; chain:true → ilk karede antic yok.
    for (const id of levels.slice(0, QUICK ? 3 : levels.length)) {
      const r6 = await page.evaluate(`(async () => {
        const id = ${JSON.stringify(id)}; await Game.load(id); const L = Game.L(); const s0 = PX.game.state().s; const R = __VT.rnd;
        const out = { long: 0, tries: 0, ok: 0, stops: 0, bad: 0, endErr: 0, unresolved: 0, rejectOk: 0, rejectTried: 0, short: 0, first: null };
        for (let v = 0; v < 3; v++) {
          let cur = s0.p;
          for (let w = 0; w < 6; w++) {
            PX.volti.cancel(); PX.volti.place(cur);
            const ts = __VT.reach(L, v, cur); if (ts.length < 4) break;
            const to = ts[ts.length - 1 - Math.floor(R() * 2)]; const p = __VT.path(L, v, cur, to); if (!p || p.length < 4) { cur = to; continue; }
            out.long++; let res = null, nres = 0; PX.volti.followPath(p, {}).then(r => { res = r; nres++; });
            const kAt = 2 + Math.floor(R() * 10); let target = to, did = false, steps = 0, minV = 1e9;
            while (!res && steps < 3000) {
              window.__vu(1 / 60 + R() * 0.01); steps++; await null;
              const pr = PX.volti.probe(); const g = __VT.ground(pr, L);
              if (Math.abs(g.err) > (pr.mode === 'merdiven' ? 1.5e-4 : 1e-6) || g.pen) { out.bad++; if (!out.first) out.first = id + " ground " + g.err + " at " + pr.x.toFixed(3) + "," + pr.footY.toFixed(3) + "," + pr.z.toFixed(3) + " mode " + pr.mode + " cell " + pr.cell + " zi " + PX.volti.rig.zi + " seg " + PX.volti.rig.seg + " pm " + PX.volti.rig.pm[PX.volti.rig.seg]; }
              if (did && pr.moving) minV = Math.min(minV, PX.volti.info().speed);
              if (!did && steps === kAt && pr.moving) {
                const X = PX.volti.legEnd(); if (X < 0) break; did = true; out.tries++;
                // uyuşmayan cells[0] reddedilir
                const wrong = L.tiles.find(c => c !== X); out.rejectTried++; if (PX.volti.retarget([wrong, X]) === false && PX.volti.legEnd() === X) out.rejectOk++;
                const ts2 = __VT.reach(L, v, X); const stop = R() < 0.3; target = stop ? X : ts2[Math.floor(R() * ts2.length)];
                const p2 = stop ? [X] : __VT.path(L, v, X, target);
                if (!p2 || !PX.volti.retarget(p2)) { out.first = out.first || id + ' retarget refused ' + X; break; }
                if (stop) out.short++;
              }
            }
            await null; await null;
            if (!res || res.cancelled) out.unresolved++;
            if (did && minV <= 0) out.stops++;
            const pe = PX.volti.probe(); const [x, y, z] = L.G.xyz(target);
            if (Math.max(Math.abs(pe.x - x), Math.abs(pe.z - z), Math.abs(pe.y - y - 0.5)) > 1e-9 || pe.cell !== target) { out.endErr++; if (!out.first) out.first = id + ' end ' + pe.cell + ' vs ' + target; }
            if (did && nres === 1 && res && !res.cancelled) out.ok++;
            cur = target;
          }
        }
        // chain: bir yürüyüş biter bitmez komşuya zincirli yürüyüş — eğilme (antic) başlamaz
        PX.volti.cancel(); PX.volti.place(s0.p);
        const ts = __VT.reach(L, 0, s0.p); let chainOk = null;
        if (ts.length >= 3) { const a = ts[1]; const p1 = __VT.path(L, 0, s0.p, a); let d1 = false; PX.volti.followPath(p1, {}).then(() => { d1 = true; });
          for (let i = 0; i < 400 && !d1; i++) { window.__vu(1 / 60); await null; } await null;
          const nb = __VT.reach(L, 0, a).find(c => c !== a); const p2 = __VT.path(L, 0, a, nb);
          PX.volti.followPath(p2, { chain: true }); chainOk = PX.volti.rig.antic === 0; PX.volti.cancel(); PX.volti.place(s0.p); }
        return Object.assign(out, { chainOk });
      })()`, 300000);
      check(`V6 ${id} legEnd/retarget mid-walk (${r6.tries} retargets, ${r6.short} stop-at-X${r6.long ? '' : ', n/a: no walk ≥ 3 tiles'})`, (r6.tries > 0 || r6.long === 0) && r6.ok === r6.tries && r6.stops === 0 && r6.bad === 0 && r6.endErr === 0 && r6.unresolved === 0 && r6.rejectOk === r6.rejectTried && r6.chainOk !== false,
        `resolved ${r6.ok}/${r6.tries}, stops ${r6.stops}, ground ${r6.bad}, end ${r6.endErr}, unresolved ${r6.unresolved}, bad cells[0] refused ${r6.rejectOk}/${r6.rejectTried}, chain ${r6.chainOk}${r6.first ? ' — ' + r6.first : ''}`, 'all');
    }

    // ---------------------------------------------------------------- V7 basamak / çubuk teması (merdiven ve iskele)
    // Merdiven ve iskele bulunan her seviyede alt uçtan üst uca ve geri: duruştaki ayak (dünya hızı < 0,25 karo/s)
    // tabanı (ayak bileği − 0,05) basamak üstünde (merdiven: N rıht, basamak i yüksekliği i/N, ±0,02) ya da çubukta
    // (iskele: 1/N aralık, ±0,03); duruşta ayak kaymıyor (kesintisiz duruş başına yatay sürüklenme ≤ 0,03).
    for (const id of levels) {
      const r7 = await page.evaluate(`(async () => {
        await Game.load(${JSON.stringify(id)}); const L = Game.L(); if (!L.stairs.length && !L.ladders.length) return null;
        const out = { stance: 0, bad: 0, slide: 0, worst: 0, first: null, runs: 0 };
        const R = PX.volti.rig, bn = R.bones; const FL = bn.find(b => b.name === 'footL'), FR = bn.find(b => b.name === 'footR');
        const NS = PX.KIT.merdiven.N, NL = PX.KIT.iskele.N; const v = new THREE.Vector3();
        const feet = [FL, FR]; const last = [null, null]; const anchor = [null, null];
        const runs = []; for (const st of L.stairs) runs.push([st.lo, st.hi], [st.hi, st.lo]); for (const ld of L.ladders) runs.push([ld.foot, ld.top], [ld.top, ld.foot]);
        for (const [a, b] of runs) {
          const p = __VT.path(L, 0, a, b, true); if (!p) continue; out.runs++;
          PX.volti.cancel(); PX.volti.place(a); let done = false; PX.volti.followPath(p, {}).then(() => { done = true; });
          last[0] = last[1] = null; anchor[0] = anchor[1] = null;
          for (let k = 0; k < 4000 && !done; k++) {
            const dt = 1 / 120; window.__vu(dt); R.root.updateMatrixWorld(true);
            const pr = PX.volti.probe();
            for (let f = 0; f < 2; f++) {
              feet[f].getWorldPosition(v); const x = v.x, y = v.y - 0.05, z = v.z;
              const sp = last[f] ? Math.hypot(x - last[f][0], z - last[f][2], y - last[f][1]) / dt : 1e9; last[f] = [x, y, z];
              if (sp > 0.25) { anchor[f] = null; continue; }
              const cx = Math.round(x), cz = Math.round(z);
              let surf = null;
              for (const st of L.stairs) { const [sx, sy, sz] = L.G.xyz(st.cell); if (sx !== cx || sz !== cz) continue; const d = PX.SIM.DIRS[st.dir];
                const t = (x - sx) * d[0] + (z - sz) * d[1] + 0.5; const i = Math.max(0, Math.min(NS, Math.round(t * NS))); surf = sy - 0.5 + i / NS; }
              if (surf === null && pr.mode === 'iskele') { const ld = L.ladders.find(l => l.cells.indexOf(pr.cell) >= 0); if (ld) { const y0 = L.G.xyz(ld.foot)[1] + 0.5; surf = y0 + Math.round((y - y0) * NL) / NL; } }
              if (surf === null) continue;
              out.stance++; const e = Math.abs(y - surf); if (e > out.worst) out.worst = e;
              if (e > (pr.mode === 'iskele' ? 0.03 : 0.02)) { out.bad++; if (!out.first) out.first = 'foot ' + f + ' sole ' + y.toFixed(3) + ' vs step ' + surf.toFixed(3) + ' mode ' + pr.mode + ' at ' + x.toFixed(2) + ',' + z.toFixed(2); }
              if (!anchor[f]) anchor[f] = [x, z]; else if (Math.hypot(x - anchor[f][0], z - anchor[f][1]) > 0.03) { out.slide++; anchor[f] = [x, z]; }
            }
          }
          await null;
        }
        PX.volti.cancel(); PX.volti.place(PX.game.state().s.p);
        return out;
      })()`, 120000);
      if (!r7) continue;
      check(`V7 ${id} feet on treads / rungs (${r7.runs} runs, ${r7.stance} stance samples)`, r7.runs > 0 && r7.stance > 20 && r7.bad === 0 && r7.slide === 0,
        `off-step ${r7.bad}, slides ${r7.slide}, worst ${r7.worst.toFixed(3)}${r7.first ? ' — ' + r7.first : ''}`, '0 / 0');
    }

    // ---------------------------------------------------------------- V5 clips
    const clips = await page.evaluate(`(async () => {
      await Game.load('M1'); const L = Game.L(); const s = PX.game.state().s;
      const res = [];
      const beats = []; const off = PX.bus.on('anim:beat', p => beats.push(p.beat));
      const run = async (name, el, step, expectMs) => {
        PX.volti.cancel(); PX.volti.place(s.p); beats.length = 0;
        let done = null; PX.volti.play(name, { el, step }).then(r => { done = r; });
        let t = 0, n = 0, maxOff = 0, yErr = 0, tb = -1; const [cx, cy, cz] = L.G.xyz(s.p);
        const tm = PX.volti.timing(name, { el, step });
        while (!done && n < 2000) { window.__vu(1 / 120); t += 1 / 120; n++; if (tb < 0 && beats.length) tb = t; await null;
          const p = PX.volti.probe(); maxOff = Math.max(maxOff, Math.abs(p.x - cx), Math.abs(p.z - cz)); yErr = Math.max(yErr, Math.abs(p.y - cy - 0.5)); }
        await null;
        res.push({ name: name + (step && step.a ? ':' + step.a.t + (el >= 0 ? ':' + L.els[el].t : '') : ''), ms: Math.round(t * 1000), expect: expectMs, tmDur: Math.round(tm.dur * 1000), tmBeat: Math.round(tm.beat * 1000), tb: Math.round(tb * 1000), beats: beats.slice(), maxOff, yErr, cancelled: done && done.cancelled });
      };
      const mk = (t, e, bef, aft, extra) => Object.assign({ kind: t, a: { t: extra || 'op', e }, before: bef, after: aft, c: { h: 1, m: 1, k: 0, o: 0 }, trips: [] });
      const idx = t => L.els.findIndex(x => x.t === t);
      const kes = idx('kesici'), ayr = idx('ayirici'), top = idx('toprak');
      const b0 = Object.assign({}, s), b1 = Object.assign({}, s, { b: s.b ^ (1 << L.els[kes].bit) });
      await run('operate', kes, mk('op', kes, b0, b1), 380);
      if (ayr >= 0) await run('operate', ayr, mk('op', ayr, b0, Object.assign({}, s, { b: s.b ^ (1 << L.els[ayr].bit) })), 520);
      if (top >= 0) { const open = Object.assign({}, s, { b: s.b & ~(1 << L.els[top].bit) }); await run('earth', top, mk('earth', top, open, Object.assign({}, open, { b: open.b | (1 << L.els[top].bit) })), 900); }
      if (ayr >= 0) await run('lock', ayr, mk('lock', ayr, s, s, 'kilit'), 600);
      if (ayr >= 0) await run('unlock', ayr, mk('unlock', ayr, s, s, 'kilitac'), 600);
      await run('fuse', kes, mk('fuse', kes, s, s, 'degistir'), 700);
      await run('press', kes, mk('press', kes, s, s, 'bas'), 250);
      await run('wait', -1, null, 400);
      await run('work', -1, null, 700);
      await run('earth', -1, { kind: 'earth', a: { t: 'set', e: idx('bara') }, before: s, after: Object.assign({}, s, { st: 1 }), c: { h: 1, m: 1, k: 0, o: 0 }, trips: [] }, 900);
      // iptal + yerleştirme kesinliği
      PX.volti.play('operate', { el: kes, step: mk('op', kes, b0, b1) }); for (let i = 0; i < 12; i++) window.__vu(1 / 60);
      const mid = PX.volti.probe(); const midOff = Math.hypot(mid.x - L.G.xyz(s.p)[0], mid.z - L.G.xyz(s.p)[2]);
      PX.volti.cancel(); PX.volti.place(s.p); window.__vu(1 / 60); window.__vu(1 / 60);
      const pc = PX.volti.probe(); const [x, y, z] = L.G.xyz(s.p);
      const exact = Math.abs(pc.x - x) < 1e-9 && Math.abs(pc.z - z) < 1e-9 && Math.abs(pc.y - y - 0.5) < 1e-9;
      // overlay yürüyüşü engellemez
      PX.volti.play('reject', { tablet: true }); const ts = __VT.reach(L, 0, s.p); const pth = __VT.path(L, 0, s.p, ts[ts.length - 1]);
      const p0 = PX.volti.probe(); const x0 = p0.x, z0 = p0.z; PX.volti.followPath(pth, {}); window.__vu(1 / 60);
      const p1 = PX.volti.probe(); const moved = Math.hypot(p1.x - x0, p1.z - z0);
      PX.volti.cancel(); PX.volti.place(s.p); off();
      return { res, exact, midOff, moved };
    })()`, 120000);
    const EXPECT_BEATS = { operate: 1, earth: 1, lock: 1, unlock: 1, fuse: 1, press: 1, wait: 1, work: 1 };
    for (const c of clips.res) {
      const nm = c.name.split(':')[0];
      const okT = Math.abs(c.ms - c.expect) <= 17, okB = c.beats.length === (EXPECT_BEATS[nm] || 0);
      const okTm = Math.abs(c.tmDur - c.ms) <= 17 && Math.abs(c.tmBeat - c.tb) <= 17;
      check(`V5 clip ${c.name}`, okT && okB && okTm && c.maxOff < 0.45 && c.yErr < 1e-9 && !c.cancelled, `${c.ms} ms, beats [${c.beats.join(',')}] at ${c.tb} ms (timing() ${c.tmDur}/${c.tmBeat}), in-tile offset ${c.maxOff.toFixed(3)}, foot err ${c.yErr.toExponential(1)}`, `${c.expect} ms ±17, 1 beat = timing(), < 0.45`);
    }
    check('V5 cancel mid-clip + place → foot exactly on tile centre', clips.exact && clips.midOff > 0.02, `exact ${clips.exact} (mid-clip in-tile step ${clips.midOff.toFixed(3)})`, 'exact');
    check('V5 reject overlay does not block walking', clips.moved > 0.03, clips.moved.toFixed(3) + ' tiles in first frame', '> 0.03');

    // ---------------------------------------------------------------- audio
    const au = await page.evaluate(`(async () => {
      const A = PX.audio; const out = {};
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      if (A.ctx.state !== 'running') { await A.ctx.resume(); await sleep(50); }
      out.state = A.ctx.state;
      // A1
      const errs = []; for (const n of A.names()) { try { A.play(n); } catch (e) { errs.push(n + ': ' + e.message); } }
      out.errs = errs; await sleep(1500);
      // A2
      A.measure(); for (let i = 0; i < 400 && !A.stats().measured; i++) await sleep(100);
      out.info = A.stats().info; out.baked = A.stats().baked;
      // A3
      for (let i = 0; i < 8; i++) A.play('kilit'); out.same = A.stats().voices;
      for (const n of A.names()) A.play(n); out.total = A.stats().voices; await sleep(1600);
      // A4
      await A.ctx.suspend(); await sleep(30);
      const pl0 = A.stats().played; const q0 = A.play('kilit'); out.queued = A.stats().queued; out.q0 = q0;
      A.resume(); for (let i = 0; i < 160 && A.ctx.state !== 'running'; i++) await sleep(25); await sleep(30);
      out.afterResume = { queued: A.stats().queued, played: A.stats().played - pl0, dropped: A.stats().dropped, held: A.stats().held, state: A.ctx.state };
      // A5
      window.dispatchEvent(new Event('blur')); await sleep(120); out.blur = { state: A.ctx.state, held: A.stats().held, play: A.play('kilit') };
      window.dispatchEvent(new Event('focus')); for (let i = 0; i < 200 && A.ctx.state !== 'running'; i++) await sleep(25); await sleep(100);
      out.focus = { state: A.ctx.state, held: A.stats().held };
      return out;
    })()`, 60000);
    check('A1 every sound plays without exception (' + Object.keys(au.info || {}).length + ' sounds)', au.errs.length === 0 && au.state === 'running', au.errs.join('; ') || 'ok', '0 errors');
    const TGT = { kesici_kapa: -16, kesici_ac: -16, ayirici: -17, yuk_ayirici: -16, kontaktor: -18, kilit: -20, dedektor: -21, toprak: -17, toprak_ac: -18, sigorta: -19, sigorta_cek: -21, sigorta_tak: -19, buton: -21, ret: -21, adim: -32, merdiven: -30, iskele: -31, sayac: -34, kutlama: -18, koruma: -19, rot: -26, bekle: -22, is: -21, undo: -24, ui: -27, ipucu: -23, spawn: -26 };
    const devs = [];
    for (const [n, m] of Object.entries(au.info || {})) { const out = m.rmsDb + m.trimDb; const peakAfter = m.peak * Math.pow(10, m.trimDb / 20); if (Math.abs(out - TGT[n]) > 1 && peakAfter < 0.94) devs.push(`${n} ${out.toFixed(1)} vs ${TGT[n]}`); if (peakAfter > 0.96) devs.push(`${n} peak ${peakAfter.toFixed(2)}`); }
    const devB = [];
    for (const [n, m] of Object.entries(au.info || {})) { const b = au.baked && au.baked[n]; if (!b) { devB.push(n + ' missing'); continue; } const bd = 20 * Math.log10(b); const out = m.rmsDb + bd; const pk = m.peak * b;
      if (Math.abs(out - TGT[n]) > 2 && !(out < TGT[n] && pk > 0.9)) devB.push(`${n} ${out.toFixed(1)} vs ${TGT[n]}`); if (pk > 1.2) devB.push(`${n} peak ${pk.toFixed(2)}`); }
    check('A2b baked TRIM table still hits targets (±2 dB; no runtime measuring)', au.baked && au.info && devB.length === 0, au.info ? (devB.join('; ') || 'all within') : 'measurement did not finish', '±2 dB');
    check('A2 loudness normalisation (loudest 50 ms RMS = target ±1 dB, or peak-limited)', au.info && devs.length === 0, au.info ? (devs.join('; ') || 'all within') : 'measurement did not finish', '±1 dB');
    check('A3 voice limits (same type / total)', au.same <= 3 && au.total <= 12, au.same + ' / ' + au.total, '≤ 3 / ≤ 12');
    check('A4 sfx queued while suspended, played after resume', au.queued === 1 && au.afterResume.queued === 0 && au.afterResume.played >= 1, `queued ${au.queued}, after resume queued ${au.afterResume.queued}, played ${au.afterResume.played} (dropped ${au.afterResume.dropped}, held ${au.afterResume.held}, ${au.afterResume.state})`, 'first sound not dropped');
    check('A5 blur → fade + suspend, focus → running', au.blur.held && au.blur.state === 'suspended' && au.blur.play === false && !au.focus.held && au.focus.state === 'running', JSON.stringify(au.blur) + ' ' + JSON.stringify(au.focus), 'held+suspended / running');

    const ex = page.exceptions(); check('no page exceptions', ex.length === 0, ex.length ? page.formatLog(ex[0]) : 0, '0');
  } finally { await page.close(); }
  const w = [0, 0, 0]; for (const r of rows) for (let i = 0; i < 3; i++) w[i] = Math.max(w[i], r[i + 1].length);
  for (const r of rows) console.log(r[0] + '  ' + r[1].padEnd(Math.min(w[0], 90)) + '  ' + r[2] + (r[3] ? '   [' + r[3] + ']' : ''));
  console.log(fails ? `=== volti/audio unit: FAIL (${fails})` : '=== volti/audio unit: PASS');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
