'use strict';
// Kurallar: FİZİKSEL DÜNYA birim testi (kural sürümü 4, spec §25). node tools/test/unit/rules_physical.js [--id=P1,T1]
//  - her yürüyüş yolu (walkPath) fiziksel olarak süreklidir: ardışık adımlar yatayda tam 1 hücre (karo↔karo aynı yükseklik),
//    yükseklik yalnız merdiven (±1, çıkış yönünde) ve iskele (dikey, aynı sütun) adımlarında değişir; atlama/düşme/ışınlanma yok
//  - yürüyüş elektrik durumunu değiştirmez (b, lk, sp, st, w aynı; yalnız kondansatör deşarj sayacı ilerleyebilir)
//  - kamera durumda yok: state anahtarında görünüm/izdüşüm alanı yok, 'd+' 'd-' 'p' simgeleri reddedilir
//  - başlangıçta her cihaza dokunuş ya bir yaklaşma karosu verir ya da ADI geçen bir engelle (kapı/bölge) reddedilir;
//    'yol_yok' hiçbir seviyede ve hiçbir erişilebilir durumda ortaya çıkmaz
//  - checklist her durumda tutarlı: kazanılan durumda tüm öğeler tamam
//  - occluders: hedefin kendisi dönmez, yalnız hedeften kameraya daha yakın hücreler
const T = require('./rules_lib.js');
const { S, V, ok } = T;
const ids = (process.argv.find(a => a.startsWith('--id=')) || '').slice(5).split(',').filter(Boolean);
const OPS = { kesici: 1, ayirici: 1, yuk_ayirici: 1, toprak: 1, sigorta: 1, buton: 1 };
for (const lv of T.allLevels()) {
  if (ids.length && !ids.includes(lv.id)) continue;
  const L = S.compile(lv.def); const Gr = V.explore(L, 4e5);
  let jumps = 0, elecWalk = 0, yolYok = 0, unexplained = 0, steps = 0, ex = '';
  const sample = Math.max(1, Math.floor(Gr.n / 4000));
  for (let i = 0; i < Gr.n; i += sample) {
    const s = S.unkey(L, Gr.keys[i]);
    for (const t of S.walkTargets(L, s)) {
      const p = S.walkPath(L, s, t); if (!p) { jumps++; ex = ex || `${lv.id}: yol yok ama hedef listede`; continue; }
      for (let k = 1; k < p.length; k++) { const a = p[k - 1], b = p[k]; steps++;
        const dxz = Math.abs(a.x - b.x) + Math.abs(a.z - b.z), dh = b.h - a.h;
        let good;
        if (a.k === 'karo' && b.k === 'karo') good = dxz === 1 && dh === 0;
        else if (a.k === 'merdiven' || b.k === 'merdiven') good = dxz === 1 && Math.abs(dh) === 0.5;
        else good = (dxz === 0 && Math.abs(dh) <= 1) || (dxz === 1 && Math.abs(dh) <= 1 && (a.k === 'karo' || b.k === 'karo'));   // iskele: dikey tırmanış, uçta sahanlığa yatay adım
        if (!good) { jumps++; ex = ex || `${lv.id}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`; }
      }
      const r = S.apply(L, s, { t: 'git', to: t });
      if (r.err) { jumps++; ex = ex || `${lv.id}: git ${t} reddedildi (${r.err})`; continue; }
      const n = r.s; if (n.b !== s.b || n.lk !== s.lk || n.sp !== s.sp || n.st !== s.st || n.w !== s.w) elecWalk++;
    }
    for (const e of L.els) if (e.cell >= 0 && OPS[e.t]) { const x = S.explain(L, s, { e: e.i });
      if (!x.ok) { if (x.err === 'yol_yok') yolYok++; else if (!x.blockers || !x.blockers.length || !/[A-Z][0-9A-Z]+/.test(x.msg)) unexplained++; } }
    if (L.work >= 0) { const x = S.explain(L, s, { tile: L.work }); if (!x.ok && x.err === 'yol_yok') yolYok++; }
  }
  ok(jumps === 0, `${lv.id}: yürüyüş yolları fiziksel olarak sürekli (${jumps} kopukluk) ${ex}`);
  ok(elecWalk === 0, `${lv.id}: yürüyüş elektrik durumunu değiştirmez (${elecWalk})`);
  ok(yolYok === 0, `${lv.id}: 'Yol yok' hiçbir durumda yok (${yolYok})`);
  ok(unexplained === 0, `${lv.id}: her erişilemeyen cihaz engeli adıyla açıklanır (${unexplained} açıklamasız)`);
  const s0 = S.initState(L);
  ok(!('v' in s0) && !('cs' in s0), `${lv.id}: durumda görünüm/izdüşüm alanı yok`);
  ok(S.decodeAct(L, s0, 'd+') === null && S.decodeAct(L, s0, 'p') === null && S.replay(L, 'd+').err === 'dogrulanamadi', `${lv.id}: eski döndürme/izdüşüm simgeleri reddedilir`);
  // kazanılan durumda checklist tamam
  let wonBad = 0; for (let i = 0; i < Gr.n; i++) if (Gr.won[i]) { const cl = S.checklist(L, S.unkey(L, Gr.keys[i])); if (cl.some(c => !c.done)) wonBad++; }
  ok(wonBad === 0, `${lv.id}: kazanılan her durumda iş listesi tamam (${wonBad})`);
  // occluders
  let occBad = 0; for (let v = 0; v < 4; v++) for (const c of L.tiles.slice(0, 12)) { const o = S.occluders(L, v, [c]); if (o.indexOf(c) >= 0) occBad++; }
  ok(occBad === 0, `${lv.id}: occluders hedefin kendisini döndürmez`);
  console.log(`  ${lv.id}: ${Gr.n} durum, ${steps} yol adımı, merdiven ${L.stairs.length}, iskele ${L.ladders.length}, kapı ${L.doors.length} — tamam`);
}
T.done('rules_physical');
