'use strict';
// tools/test/unit/controller_game.js — PX.game (game/controller.js) birim testleri, KURAL SÜRÜMÜ 4 (fiziksel dünya):
// FIFO, sunum durumu, geri al/yinele/baştan, dokun-yürü hedef değiştirme, kamera döndürme = yalnız görsel (geçmişe
// girmez, asla reddedilmez, yürürken serbest), cihaz dokunuşu + çipler, erişilemeyen hedefin NEDEN kartı (engel adıyla),
// merdiven/iskele/kapı/duvar dokunuşu, klavye (ekran yönü -> fiziksel adım, merdiven dahil), kazanma + mühürler,
// altın dizgiler (instant ve animasyonlu), odak (örtücü hedefleri), iş listesi.
const { makeEnv, suite, eq, ok, SIM } = require('./controller_harness');

function env(o) { const E = makeEnv(o); E.load('game/controller.js'); E.PX.game.init(); return E; }
const toks = E => E.PX.game.tokens();
const st = E => E.PX.game.state();
function act(E, tok) { return E.PX.game.command({ t: 'act', tok }); }
const tiles = (L, s, to) => { const w = SIM.walkPath(L, s, to); return w ? w.filter(x => x.k === 'karo').map(x => x.c) : null; };
// başlangıçtan en az n karo adımlık yürüyüş hedefi (yol ile)
function farTarget(E, minLen) {
  const L = E.PX.game.L, s = st(E).s; const ts = SIM.walkTargets(L, s);
  for (const t of ts) { const p = tiles(L, s, t); if (p && p.length - 1 >= minLen) return { t, path: p }; }
  return null;
}
const v4 = E => E.PX.LEVELS.filter(l => l.kuralSurumu === 4 && l.def);
async function playInstant(E, str) { E.PX.game.setInstant(true); for (const t of String(str || '').split(' ').filter(Boolean)) { if (!act(E, t)) return t; await E.tick(); } await E.tick(); E.PX.game.setInstant(false); return null; }

module.exports = async function run() {
  const { test, res } = suite('controller_game');
  console.log('controller_game');

  await test('FIFO: 1 oynayan + 3 bekleyen; 5. girdi YENİ olanı reddeder (tampon)', async () => {
    const E = env(); await E.PX.game.load('M1');
    const g = 'g20 o:Q01 g1 o:Q11 k:Q11'.split(' ');
    const acc = g.map(t => act(E, t));
    eq(acc, [true, true, true, true, false], 'kabul');
    const rej = E.events('cmd:rejected'); eq(rej.length, 1); eq(rej[0].err, 'tampon');
    eq(st(E).queue, 3, 'bekleyen'); eq(toks(E), 'g20 o:Q01 g1 o:Q11');
    await E.drain();
    eq(act(E, 'k:Q11'), true, 'tampon boşalınca kabul');
  });
  await test('geçersiz komut tampona girmez, ret anında ve nedenli (uzak: önce yanına yürü)', async () => {
    const E = env(); await E.PX.game.load('M1');
    eq(act(E, 'o:Q11'), false); const r = E.events('cmd:rejected')[0]; eq(r.err, 'uzak'); ok(r.msg && /Q11/.test(r.msg), 'mesaj cihazı adlandırır: ' + r.msg);
    eq(st(E).queue, 0); eq(st(E).hist, 0); eq(st(E).busy, false);
    eq(act(E, 'd+'), false, 'eski simge'); eq(E.events('cmd:rejected')[1].err, 'dogrulanamadi');
    eq(act(E, 'p'), false, 'eski izdüşüm simgesi');
  });
  await test('sunum durumu animasyondan önce ilerlemez (HUD/lamba/tek hat/kazanma)', async () => {
    const E = env(); await E.PX.game.load('M1'); E.clearEv();
    act(E, 'g20'); act(E, 'o:Q01');
    eq(st(E).tot.h, 2, 'mantık anında'); eq(st(E).presentation.tot.h, 0, 'sunum beklemede');
    eq(E.events('anim:step').length, 0); eq(E.events('elec:changed').length, 0); eq(E.events('lamp').length, 0);
    await E.finishAnim(1);
    eq(st(E).presentation.tot.h, 1); eq(E.events('anim:step').length, 1); eq(E.events('elec:changed').length, 0, 'yürüyüş elektriği değiştirmez');
    await E.finishAnim(1);
    eq(st(E).presentation.tot, st(E).tot); eq(E.events('elec:changed').length, 1, 'işlem bitince tek hat');
    eq(E.events('anim:step').map(p => p.tot.h), [1, 2]);
    const lp = E.events('lamp'); ok(lp.every((x, i) => i === 0 || x.state !== lp[i - 1].state || x.dist !== lp[i - 1].dist), 'lamba tekrar yayılmaz');
  });
  await test('yürüyüş adımı: path karo hücreleri (fiziksel komşu), steps = sim2.walkPath, before/after.v = kamera', async () => {
    const E = env(); await E.PX.game.load('M1'); const L = E.PX.game.L;
    act(E, 'g20'); const a = E.anims[0].step; const want = tiles(L, L.def ? SIM.initState(L) : null, L.tiles[20]);
    eq(a.path, want, 'karo yolu'); ok(Array.isArray(a.steps) && a.steps.length >= a.path.length, 'steps');
    for (let i = 1; i < a.steps.length; i++) { const p = a.steps[i - 1], q = a.steps[i]; ok(Math.abs(p.x - q.x) + Math.abs(p.z - q.z) <= 1 && Math.abs(p.h - q.h) <= 1, 'sürekli adım ' + i); }
    eq(a.before.v, st(E).camV); eq(a.after.v, st(E).camV); ok(!('v' in st(E).s), 'sim durumunda görünüm yok');
  });
  await test('geri al: bekleyen -> yalnız kuyruktan; oynayan -> iptal + saf yeniden kurulum; sunulmuş -> yeniden kurulum', async () => {
    const E = env(); await E.PX.game.load('M1');
    act(E, 'g20'); act(E, 'o:Q01'); act(E, 'g1');
    const n0 = E.syncs.length;
    E.PX.game.command({ t: 'undo' }); eq(toks(E), 'g20 o:Q01'); eq(E.syncs.length, n0, 'bekleyen geri alındı, yeniden kurulum yok');
    E.PX.game.command({ t: 'undo' }); eq(toks(E), 'g20'); eq(st(E).queue, 0);
    E.PX.game.command({ t: 'undo' }); eq(toks(E), ''); eq(E.syncs.length, n0 + 1, 'oynayan iptal: saf yeniden kurulum');
    eq(E.syncs[E.syncs.length - 1].p, st(E).s.p); eq(E.syncs[E.syncs.length - 1].v, st(E).camV, 'kurulum kameranın görünümünü taşır');
    eq(st(E).presentation.s, st(E).s); eq(st(E).busy, false);
    await E.finishAnim(1);
    eq(st(E).presentation.tot.h, 0); eq(E.events('anim:step').length, 0);
    act(E, 'g20'); await E.drain(); eq(st(E).presentation.tot.h, 1);
    E.PX.game.command({ t: 'undo' }); eq(st(E).presentation.tot.h, 0); eq(st(E).presentation.s.p, E.PX.game.L.start);
    eq(E.PX.game.command({ t: 'redo' }), true); await E.drain(); eq(toks(E), 'g20'); eq(st(E).presentation.tot.h, 1);
  });
  await test('dokun-yürü: başlamamış dokunuşun yerini alır (işlem oynarken)', async () => {
    const E = env(); await E.PX.game.load('M1');
    act(E, 'g20'); await E.drain(); act(E, 'o:Q01');
    const L = E.PX.game.L; const ts = SIM.walkTargets(L, st(E).s);
    E.PX.game.command({ t: 'tap', cell: ts[0] }); E.PX.game.command({ t: 'tap', cell: ts[1] });
    eq(toks(E), 'g20 o:Q01 g' + L.tileIdx[ts[1]]); eq(st(E).queue, 1); eq(st(E).tot.h, 3);
  });
  await test('yürüyen dokun-yürü hedef değiştirir: tek g (1 Hamle), Volti sıradaki karo sınırından yeni yola', async () => {
    const E = env(); await E.PX.game.load('M1');
    const far = farTarget(E, 3); ok(far, 'uzun yol yok');
    E.PX.game.command({ t: 'tap', cell: far.t }); E.V.leg = far.path[1];
    const L = E.PX.game.L; const other = SIM.walkTargets(L, st(E).presentation.s).find(t => t !== far.t && t !== far.path[1] && t !== L.start);
    eq(E.PX.game.command({ t: 'tap', cell: other }), true);
    eq(toks(E), 'g' + L.tileIdx[other]); eq(st(E).tot.h, 1);
    eq(E.V.retargets.length, 1); eq(E.V.retargets[0][0], far.path[1], 'yeni yol sınır karosundan');
    eq(E.V.retargets[0][E.V.retargets[0].length - 1], other);
    eq(E.anims[0].step.after.p, other, 'parça sonu güncellendi (saf kurulum yanlış karoya ışınlamaz)');
    await E.drain(); eq(st(E).presentation.s.p, other); eq(st(E).presentation.tot.h, 1);
  });
  await test('hedef değiştirme başlangıca: adım boşa düşer (0 Hamle), Volti geri yürür', async () => {
    const E = env(); await E.PX.game.load('M1');
    const far = farTarget(E, 2); E.PX.game.command({ t: 'tap', cell: far.t }); E.V.leg = far.path[1];
    E.PX.game.command({ t: 'tap', cell: E.PX.game.L.start });
    eq(toks(E), ''); eq(st(E).tot.h, 0); eq(st(E).hist, 0);
    await E.drain(); eq(st(E).presentation.tot.h, 0); eq(E.events('anim:step').length, 0); eq(st(E).busy, false);
  });
  await test('hedef değiştirme (Volti uzantısı yok): parça bitince yeni hedefe devam, defter tek g', async () => {
    const E = env({ volti: 'none' }); await E.PX.game.load('M1');
    const far = farTarget(E, 2); E.PX.game.command({ t: 'tap', cell: far.t });
    const L = E.PX.game.L; const other = SIM.walkTargets(L, st(E).presentation.s).find(t => t !== far.t && t !== L.start);
    E.PX.game.command({ t: 'tap', cell: other });
    eq(toks(E), 'g' + L.tileIdx[other]);
    await E.finishAnim(1);
    ok(E.anims.length === 1 || far.t === other, 'ikinci parça istendi');
    if (E.anims.length) { const p = E.anims[0].step.path; eq(p[0], far.t); eq(p[p.length - 1], other); }
    await E.drain(); eq(st(E).presentation.s.p, other); eq(st(E).presentation.tot.h, 1);
  });
  await test('kamera döndürme yalnız görsel: geçmişe/deftere girmez, Hamle 0, asla reddedilmez, yürürken de serbest', async () => {
    const E = env(); await E.PX.game.load('M1'); const v0 = st(E).camV; E.camCalls.length = 0;
    for (let i = 0; i < 8; i++) ok(E.PX.game.command({ t: 'rot', d: i < 5 ? 1 : -1, src: i & 1 ? 'drag' : 'btn' }), 'döndürme ' + i);
    eq(st(E).camV, (v0 + 5 - 3 + 8) & 3); eq(st(E).hist, 0); eq(toks(E), ''); eq(st(E).tot, { h: 0, m: 0, k: 0, o: 0 });
    eq(E.events('cmd:rejected').length, 0); eq(E.camCalls.filter(c => c[0] === 'snap').length, 8, 'her döndürme kamerayı hemen yaylar');
    eq(E.events('view').length, 8);
    // yürürken: yol ve mantık değişmez; uçuştaki parçanın after.v'si güncellenir (saf kurulum kamerayı geri çekmez)
    const far = farTarget(E, 3); E.PX.game.command({ t: 'tap', cell: far.t }); const tk = toks(E); const sub = E.anims[0].step;
    ok(E.PX.game.command({ t: 'rot', d: 1, src: 'drag' })); eq(toks(E), tk, 'defter aynı'); eq(sub.after.v, st(E).camV);
    eq(sub.path, far.path, 'yol aynı (komşuluk görünümden bağımsız)');
    E.PX.game.command({ t: 'undo' }); eq(toks(E), '', 'geri al yürüyüşü alır, döndürmeyi değil'); eq(st(E).camV, (v0 + 3) & 3);
    // kazanılmış durumda da serbest
    await E.PX.game.load('P1'); eq(await playInstant(E, E.PX.LEVELS.find(l => l.id === 'P1').kanit.cozum), null);
    eq(st(E).won, true); ok(E.PX.game.command({ t: 'rot', d: -1 }), 'kazanınca döndürme');
    eq(E.PX.game.command({ t: 'izdusum' }), false, 'izdüşüm komutu yok');
  });
  await test('cihaza dokun: yaklaşma karosuna yürü, varınca o cihazın çipleri (başlık = sim2.labelOf + durum)', async () => {
    const E = env(); await E.PX.game.load('M1'); const L = E.PX.game.L; const e = L.elIndex.Q01;
    const t = SIM.approachTile(L, st(E).s, e); ok(t >= 0 && t !== st(E).s.p);
    E.clearEv(); eq(E.PX.game.command({ t: 'tap', cell: L.els[e].cell }), true);
    eq(toks(E), 'g' + L.tileIdx[t]); eq(E.PX.game.selected, e, 'seçili cihaz');
    eq(E.events('ui:chip').filter(c => c.actions.length).length, 0, 'varıştan önce çip yok');
    await E.drain();
    const ch = E.events('ui:chip').filter(c => c.actions.length); eq(ch.length, 1); eq(ch[0].el, 'Q01');
    eq(ch[0].title, SIM.labelOf(L, e)); ok(ch[0].state && ch[0].state.closed === true, 'durum');
    ok(ch[0].actions.some(a => a.tok === 'o:Q01' && a.preview && a.preview.ok), 'o:Q01 çipi');
    const x = ch[0].actions.find(a => a.tok === 'o:Q01'); E.clearEv();
    ok(E.PX.game.command({ t: 'act', a: x.a, tok: x.tok }));
    eq(E.events('ui:chip').filter(c => c.actions.length).length, 0, 'eylem oynarken çip yok');
    await E.drain();
    const ch2 = E.events('ui:chip').filter(c => c.actions.length); eq(ch2.length, 1); eq(ch2[0].el, 'Q01');
  });
  await test('erişilemeyen cihaz: NEDEN (engel adıyla, hücreler + çözüm cihazı), asla sessiz değil', async () => {
    const E = env(); let hit = 0;
    for (const lv of v4(E)) {
      await E.PX.game.load(lv.id); const L = E.PX.game.L, s = st(E).s;
      for (let e = 0; e < L.els.length; e++) { const el = L.els[e]; if (el.cell < 0 || !L.approach[e].length) continue;
        if (SIM.approachTile(L, s, e) >= 0) continue;
        E.clearEv(); const r = E.PX.game.command({ t: 'tap', cell: el.cell });
        if (r) { ok(E.events('ui:longpress').length || toks(E) !== '', lv.id + ' ' + el.id + ' kabul ama hiçbir şey'); E.PX.game.command({ t: 'reset' }); continue; }
        const x = E.events('cmd:rejected')[0]; ok(x && x.reason === true, lv.id + ' ' + el.id + ' neden kartı yok: ' + JSON.stringify(x));
        ok(x.msg && x.msg.length > 10, 'mesaj'); ok(x.blockers && x.blockers.length, 'engel listesi');
        ok(x.cells && x.cells.length, 'vurgulanacak hücreler'); ok(x.blockers.every(b => b.msg && b.id), 'engeller adıyla');
        if (x.err === 'kapi_kilitli') { ok(x.fix.length >= 1, 'kapı: çözüm cihazı'); ok(/Kapı kilitlemesi/.test(x.msg), x.msg); }
        hit++;
      }
    }
    ok(hit >= 1, 'erişilemeyen cihaz durumu bulunamadı');
    await E.PX.game.load('M1'); const L = E.PX.game.L; const y = L.els[L.elIndex.Y1]; E.clearEv();
    if (y && y.cell >= 0) { eq(E.PX.game.command({ t: 'tap', cell: y.cell }), true); eq(E.events('ui:longpress')[0].el, 'Y1'); }
  });
  await test('erişilemeyen karo (yaklaşma bölgesi / kapı): neden kartı; erişilen karo: yürüyüş', async () => {
    const E = env(); let hit = 0, walked = 0;
    for (const lv of v4(E)) {
      await E.PX.game.load(lv.id); const L = E.PX.game.L, s = st(E).s; const wt = new Set(SIM.walkTargets(L, s));
      for (const c of L.tiles) { if (c === s.p) continue; E.clearEv();
        const r = E.PX.game.command({ t: 'tap', cell: c });
        if (wt.has(c)) { ok(r, lv.id + ' erişilen karo reddedildi'); walked++; E.PX.game.command({ t: 'undo' }); continue; }
        eq(r, false); const x = E.events('cmd:rejected')[0]; ok(x && x.reason && x.msg && x.blockers.length, lv.id + ' karo ' + c + ': ' + JSON.stringify(x && { err: x.err, msg: x.msg })); hit++; }
    }
    ok(walked > 20, 'yürüyüşler'); ok(hit >= 1, 'erişilemeyen karo bulunamadı');
  });
  await test('merdiven / iskele dokunuşu: öbür uca yürü (çık ya da in); duvar: nedenli ret', async () => {
    const E = env(); let stair = 0, ladder = 0, wall = 0;
    for (const lv of v4(E)) {
      await E.PX.game.load(lv.id); const L = E.PX.game.L;
      for (const sc of L.stairs) { E.PX.game.command({ t: 'reset' }); const s = st(E).s; const wt = SIM.walkTargets(L, s);
        if (wt.indexOf(sc.hi) < 0 && wt.indexOf(sc.lo) < 0) continue;
        E.clearEv(); if (!E.PX.game.command({ t: 'tap', cell: sc.cell })) { const x = E.events('cmd:rejected')[0]; ok(x && x.reason && x.msg, lv.id + ' merdiven: öbür uç kapalıysa nedenli ret'); continue; }
        const to = st(E).s.p; ok(to === sc.hi || to === sc.lo, 'uç'); const a = E.anims[E.anims.length - 1].step;
        if (to === sc.hi && s.p !== sc.lo) ok(a.steps.some(x => x.k === 'merdiven' && x.c === sc.cell), 'yol merdivenden geçer');
        stair++; }
      for (const ld of L.ladders) { E.PX.game.command({ t: 'reset' }); E.clearEv();
        if (E.PX.game.command({ t: 'tap', cell: ld.cells[0] })) { const a = E.anims[E.anims.length - 1].step; ok(a.steps.some(x => x.k === 'iskele'), 'iskele adımları'); ladder++; }
        else ok(E.events('cmd:rejected')[0].reason, 'iskele: nedenli'); }
      for (let c = 0; c < L.G.N; c++) if (L.G.kind[c] === SIM.KIND.duvar) { E.clearEv(); eq(E.PX.game.command({ t: 'tap', cell: c }), false); const x = E.events('cmd:rejected')[0]; eq(x.err, 'duvar'); ok(x.msg.length > 10); wall++; break; }
    }
    ok(stair >= 1, 'merdiven yok'); ok(ladder >= 1, 'iskele yok (M1)'); console.log('       merdiven ' + stair + ', iskele ' + ladder + ', duvar ' + wall);
  });
  await test('klavye: ekran yönü -> fiziksel tek adım (merdiven dahil); yol yoksa nedenli ret, tampon dolmaz', async () => {
    const E = env(); await E.PX.game.load('M1'); const L = E.PX.game.L; const s = st(E).s;
    for (let d = 0; d < 4; d++) { E.clearEv(); const t = SIM.stepToward(L, s, SIM.screenToDir(st(E).camV, d)); const r = E.PX.game.command({ t: 'walk', dir: d });
      if (t < 0) { eq(r, false); const x = E.events('cmd:rejected')[0]; ok(x.err === 'yon_yok' || x.reason, 'ret ' + x.err); } else { eq(r, true); eq(toks(E), 'g' + L.tileIdx[t]); E.PX.game.command({ t: 'undo' }); } }
    eq(st(E).queue, 0);
    // merdiven: alt sahanlıktan ok tuşuyla çık (her görünümde ekran yönü farklı, fiziksel adım aynı)
    let done = false;
    for (const lv of v4(E)) { await E.PX.game.load(lv.id); const L2 = E.PX.game.L; const sc = L2.stairs[0]; if (!sc) continue;
      const path = tiles(L2, st(E).s, sc.lo); if (!path) continue; E.PX.game.setInstant(true);
      if (sc.lo !== st(E).s.p) ok(act(E, 'g' + L2.tileIdx[sc.lo]), 'alt sahanlığa'); await E.tick(); E.PX.game.setInstant(false);
      for (let v = 0; v < 4; v++) { const d = [0, 1, 2, 3].find(i => SIM.screenToDir(st(E).camV, i) === sc.dir);
        ok(d !== undefined, 'yön'); E.clearEv(); ok(E.PX.game.command({ t: 'walk', dir: d }), lv.id + ' merdiven tuşu v' + st(E).camV);
        eq(st(E).s.p, sc.hi, 'üst sahanlık'); E.PX.game.command({ t: 'undo' }); E.PX.game.command({ t: 'rot', d: 1 }); }
      done = true; break; }
    ok(done, 'merdivenli seviye yok');
  });
  await test('altın dizgiler (instant): her v4 seviyesi kazanır, toplamlar damgayla aynı, win + kayıt; iş listesi tamam', async () => {
    const E = env(); let n = 0;
    for (const lv of v4(E)) {
      if (!lv.kanit || !lv.kanit.opt) continue;
      for (const [fld, m] of [['cozum', 'hamle'], ['cozumManevra', 'manevra'], ['cozumKesinti', 'kesinti']]) {
        if (!lv.kanit[fld]) continue;
        await E.PX.game.load(lv.id); E.PX.game.setInstant(true); E.clearEv();
        for (const t of lv.kanit[fld].split(' ')) { ok(act(E, t), lv.id + ' ' + fld + ' ' + t + ' reddedildi: ' + JSON.stringify(E.events('cmd:rejected').slice(-1))); await E.tick(); }
        await E.tick(); E.PX.game.setInstant(false);
        const w = E.events('win'); eq(w.length, 1, lv.id + ' win');
        const o = lv.kanit.opt[m]; eq([w[0].tot.h, w[0].tot.m, w[0].tot.k, w[0].tot.o], o, lv.id + ' ' + fld);
        eq(w[0].ghost, lv.kanit[fld]);
        const cl = E.PX.game.checklist(); ok(cl.length && cl.every(x => x.done), lv.id + ' iş listesi kazanınca tamam: ' + JSON.stringify(cl.filter(x => !x.done)));
        n++;
      }
    }
    ok(n >= 3, 'dizgi'); ok(E.wins.length >= n, 'store.recordWin');
  });
  await test('animasyonlu altın dizgi (P1): sunum toplamı = optimum; kazanınca komut "kazanildi" (sunumdan önce metinsiz)', async () => {
    const E = env(); await E.PX.game.load('P1'); const lv = E.PX.LEVELS.find(l => l.id === 'P1');
    const T = lv.kanit.cozum.split(' ');
    for (const t of T) { while (st(E).queue >= 3) await E.finishAnim(1); ok(act(E, t), t); }
    eq(st(E).won, true); eq(st(E).presentation.won, false);
    E.clearEv(); act(E, 'g0'); eq(E.events('cmd:rejected')[0].msg, '', 'sunum kazanmadan metin yok');
    await E.drain(); eq(st(E).presentation.won, true);
    const w = E.events('win')[0]; eq([w.tot.h, w.tot.m, w.tot.k, w.tot.o], lv.kanit.opt.hamle);
    ok(w.seals.indexOf('muhendis') >= 0 && w.seals.indexOf('temiz') >= 0, 'mühürler: ' + w.seals);
    E.clearEv(); act(E, 'g0'); eq(E.events('cmd:rejected')[0].err, 'kazanildi'); ok(E.events('cmd:rejected')[0].msg.length > 0);
    for (let i = 0; i < T.length; i++) E.PX.game.command({ t: 'undo' });
    eq(toks(E), ''); eq(st(E).presentation.won, false);
    for (let i = 0; i < T.length; i++) { while (st(E).queue >= 3) await E.finishAnim(1); ok(E.PX.game.command({ t: 'redo' }), 'redo ' + i); }
    await E.drain(); eq(toks(E), lv.kanit.cozum); eq(st(E).presentation.won, true);
  });
  await test('Baştan: anında, doğuş yok, her şey s0 (kamera görünümü korunur)', async () => {
    const E = env(); await E.PX.game.load('M1'); act(E, 'g20'); act(E, 'o:Q01'); E.PX.game.command({ t: 'rot', d: 1 }); const cv = st(E).camV;
    E.PX.game.command({ t: 'reset' }); eq(st(E).hist, 0); eq(st(E).busy, false); eq(st(E).presentation.tot.h, 0);
    eq(E.syncs[E.syncs.length - 1].p, E.PX.game.L.start); eq(st(E).camV, cv);
    await E.drain(); eq(E.events('anim:step').length, 0);
  });
  await test('ipucu bayrağı: Temiz İşçilik ve Mühendis Mührü verilmez', async () => {
    const E = env(); E.PX.hint = { request() { E.PX.bus.emit('hint', { acts: ['g20', 'o:Q01'] }); } }; await E.PX.game.load('P1'); const lv = E.PX.LEVELS.find(l => l.id === 'P1');
    E.PX.game.command({ t: 'hint', tier: 1 }); E.PX.game.setInstant(true);
    for (const t of lv.kanit.cozum.split(' ')) { act(E, t); await E.tick(); } await E.tick();
    const w = E.events('win')[0]; ok(w.hinted); ok(w.seals.indexOf('temiz') < 0 && w.seals.indexOf('muhendis') < 0);
  });
  await test('odak (örtücü hedefleri): Volti gövdesi + seçili cihaz + yol + iş karosu; focus olayı', async () => {
    const E = env(); await E.PX.game.load('M1'); const L = E.PX.game.L; await E.tick();
    const f0 = E.PX.game.focusTargets(); const [x, y, z] = L.G.xyz(L.start); eq(f0[0], [x, y + 1, z]);
    ok(f0.some(t => Array.isArray(t) && t[0] === L.G.xyz(L.work)[0] && t[2] === L.G.xyz(L.work)[2]), 'iş karosu');
    E.clearEv(); E.PX.game.command({ t: 'tap', cell: L.els[L.elIndex.Q01].cell }); await E.tick();
    const f1 = E.PX.game.focusTargets(); ok(f1.indexOf(L.els[L.elIndex.Q01].cell) >= 0, 'seçili cihaz'); ok(f1.length > f0.length, 'yol hücreleri');
    const ev = E.events('focus'); ok(ev.length >= 1 && Array.isArray(ev[ev.length - 1].targets), 'focus olayı');
    ok(SIM.occluders(L, st(E).camV, f1).every(c => c >= 0 && c < L.G.N), 'occluders hesaplanır');
  });
  await test('ardışık yürüyüşler durmadan zincirlenir: ayak son karoya girince adım sunulur, sıradaki yol hızla başlar', async () => {
    const E = env(); await E.PX.game.load('M1'); const L = E.PX.game.L; const s = st(E).s;
    let d1 = -1, d2 = -1, t1 = -1, t2 = -1;
    for (let a = 0; a < 4 && d1 < 0; a++) { const x = SIM.stepToward(L, s, SIM.screenToDir(st(E).camV, a)); if (x < 0) continue;
      const s1 = SIM.apply(L, s, { t: 'git', to: x }).s;
      for (let b = 0; b < 4; b++) { const y = SIM.stepToward(L, s1, SIM.screenToDir(st(E).camV, b)); if (y < 0 || y === s.p) continue; d1 = a; d2 = b; t1 = x; t2 = y; break; } }
    ok(d1 >= 0, 'iki adımlık yol yok');
    ok(E.PX.game.command({ t: 'walk', dir: d1 })); ok(E.PX.game.command({ t: 'walk', dir: d2 }));
    eq(E.anims.length, 1); const a1 = E.anims[0];
    E.clearEv();
    E.V.moving = true; E.V.leg = t1; E.V.cell = s.p; E.PX.game.update(0.016); eq(E.anims.length, 1); eq(st(E).presentation.tot.h, 0);
    E.V.cell = t1; E.PX.game.update(0.016);
    eq(st(E).presentation.s.p, t1, 'sunum = ayağın bastığı karo'); eq(st(E).presentation.tot.h, 1);
    eq(E.anims.length, 2); const a2 = E.anims[1]; eq(a2.step.before.p, t1); eq(a2.step.path[a2.step.path.length - 1], t2);
    a1.res({ cancelled: true, retarget: true }); await E.tick(); await E.tick();
    eq(st(E).presentation.tot.h, 1); eq(E.events('anim:step').length, 1);
    E.anims.shift(); E.V.moving = false; await E.finishAnim(1);
    eq(st(E).presentation.s.p, t2); eq(st(E).presentation.tot.h, 2); eq(st(E).busy, false);
  });
  await test('kapı dokunuşu: açıksa kapı karosuna yürü, kapalıysa kapı kilitlemesi nedeni (çözüm cihazıyla)', async () => {
    const E = env(); let hit = 0;
    for (const lv of v4(E)) { await E.PX.game.load(lv.id); const L = E.PX.game.L;
      for (const d of L.doors) { const el = L.els[d.el]; E.clearEv(); const r = E.PX.game.command({ t: 'tap', cell: el.cell });
        const open = SIM.doorOpen(L, st(E).s.b, st(E).s.lk, el.di);
        if (r) ok(open || SIM.walkTargets(L, SIM.initState(L)).indexOf(d.tile) >= 0, 'kapı açık');
        else { const x = E.events('cmd:rejected')[0]; ok(x.reason && x.err === 'kapi_kilitli' && x.fix.length, lv.id + ' kapı: ' + JSON.stringify(x && { err: x.err, fix: x.fix })); }
        hit++; } }
    ok(hit >= 1, 'kapılı seviye yok');
  });
  return res;
};
if (require.main === module) module.exports().then(r => { console.log(`${r.name}: ${r.pass} ok, ${r.fail} fail`); process.exit(r.fail ? 1 : 0); });
