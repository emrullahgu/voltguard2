'use strict';
// Kurallar: PX.ghost (meydan okuma kodu, defter, zaman çizelgesi, oynatma) + PX.daily birim testi (Node).
//   node tools/test/unit/rules_meta.js
const T = require('./rules_lib.js');
const { S, ok } = T;
const LEVELS = T.allLevels().filter(l => l.bolum <= 3);
const DAILY = LEVELS.slice(0, 5).map((l, i) => Object.assign({}, l, { id: 'G' + (i + 1) }));
DAILY[2].tarih = '2027-03-14';
const store = { data: { gunluk: {}, istat: { gunSayisi: 0 }, seviye: {} }, saved: 0, save() { this.saved++; return true; }, get(p) { return undefined; }, set() {} };
const PX = { SIM: S, bus: T.fakeBus(), LEVELS, DAILY, STR: { dogrulanamadi: 'Bu defter doğrulanamadı.', defter: 'Manevra Defteri' }, store };
PX.game = { L: null, level: null, state() { return {}; } };
T.loadModule('meta/ghost.js', PX); T.loadModule('meta/daily.js', PX);
const G = PX.ghost, D = PX.daily;

(async () => {
  // ---- olay veriyolu: dinleyici ekleme olay sırasında yürürlüğe girmez, '*' çift çağrılmaz
  const app = {};
  T.loadModule('app/bus.js', app);
  let first = 0, later = 0, wildcard = 0;
  const listener = () => { first++; if (first === 1) app.bus.on('sample', () => later++); };
  app.bus.on('sample', listener); app.bus.emit('sample');
  ok(first === 1 && later === 0, 'bus: tek dinleyici yeni dinleyiciyi aynı olayda çalıştırmaz');
  app.bus.emit('sample'); ok(first === 2 && later === 1, 'bus: eklenen dinleyici sonraki olayda çalışır');
  app.bus.on('*', () => wildcard++); app.bus.emit('*');
  ok(wildcard === 1, 'bus: yıldız olayı bir kez yayınlanır');
  ok(app.bus.recent(0).length === 0 && app.bus.recent(-2).length === 0 && app.bus.recent(1.9).length === 1, 'bus: günlük boyutu geçerli tam sayı');
  // ---- kısmen bozuk kayıt: sağlam ilerleme ve bilinmeyen alanlar korunur
  const oldWindow = global.window, oldLocation = global.location;
  const memory = new Map(); let denyWrite = false;
  global.window = { localStorage: { getItem: k => memory.get(k) || null, setItem(k, v) { if (denyWrite) throw new Error('kapalı'); memory.set(k, v); }, removeItem: k => memory.delete(k) } };
  global.location = { search: '' };
  try {
    const savedApp = { bus: T.fakeBus(), STR: { kayitKapali: 'Kayıt kapalı' } };
    T.loadModule('app/store.js', savedApp);
    const st = savedApp.store;
    memory.set(st.KEY, JSON.stringify({ v: 1, ayar: { ses: 7, muzik: 'bozuk', etiketler: 'false', kalite: 'bozuk' }, arac: {},
      seviye: { P1: { cozuldu: true, en: { h: [3, 'g1'] }, gecmis: 'bozuk', muhur: null }, P2: { en: { h: [-1, 'x'] }, gecmis: [[1, 2, 3, 4], ['x']] } },
      gunluk: { '2027-01-01': { cozuldu: true, en: 'bozuk' }, bozuk: 42 }, istat: { gunSayisi: 99 }, future: { keep: true } }));
    st.init();
    ok(st.data.future.keep && st.level('P1').cozuldu && st.level('P1').en.h[0] === 3, 'store: sağlam ilerleme ve bilinmeyen alan korunur');
    ok(st.data.ayar.ses === 1 && st.data.ayar.muzik === 0.3 && st.data.ayar.etiketler === true && st.data.ayar.kalite === 'oto' && Array.isArray(st.data.arac), 'store: bozuk ayarlar ve üst diziler düzeltilir');
    st.recordWin('P1', { h: 4, m: 2, k: 0, o: 0 }, 'g1', { ipuclu: false });
    ok(st.level('P1').gecmis.length === 1 && st.level('P1').en.h[0] === 3 && !st.level('P1').ipuclu, 'store: onarılan kayıtta kazanma kaydı çökmüyor');
    ok(st.level('P2').en.h === undefined && st.level('P2').gecmis.length === 1 && st.data.gunluk['2027-01-01'].en === null && st.data.istat.gunSayisi === 1, 'store: geçersiz ölçütler elenir ve günlük sayaç türetilir');
    st.set('__proto__.pxPolluted', true); st.set('constructor.prototype.pxPolluted', true);
    ok({}.pxPolluted === undefined && st.get('__proto__') === undefined, 'store: kayıt yolu nesne prototipine yazamaz');
    denyWrite = true; ok(st.save() === false && !st.available, 'store: yazma erişimi kaybedilince bellekte çalışır');
    denyWrite = false; st.init(); ok(st.available && st.disabledReason === '', 'store: yeniden erişilen kayıt eski kapalı nedenini temizler');
    // Eski yayın aynı kayıt anahtarını kullanır. Skorlar yalnız v4 yeniden oynatma kanıtıyla etkin kalabilir.
    const physical = { SIM: S, LEVELS, DAILY, bus: T.fakeBus(), STR: { bolumKilit: 'Bölüm kilitli' }, t: (k, v) => k + ':' + v.ad };
    T.loadModule('app/store.js', physical); T.loadModule('meta/world.js', physical);
    const ps = physical.store, p2 = LEVELS.find(l => l.id === 'P2'), good = S.replay(S.compile(p2.def), p2.kanit.cozum);
    const valid = { cozuldu: true, en: Object.fromEntries(['h', 'm', 'k', 'o'].map(m => [m, [good.tot[m], p2.kanit.cozum]])), gecmis: [[good.tot.h, good.tot.m, good.tot.k, good.tot.o], [999, 999, 999, 999]], muhur: ['temiz'], ipucsuz: true, son: 'd+ p' };
    const oldP1 = { cozuldu: true, en: { h: [6, 'g1 d+ p'] }, gecmis: [[6, 2, 0, 0]], muhur: ['muhendis'], son: 'd+ p' };
    const legacy = { v: 1, ayar: { ses: 0.75 }, kozmetik: { kask: 'sari' }, seviye: { P1: oldP1, P2: valid, P3: oldP1, P4: oldP1 }, gunluk: { '2026-10-13': { cozuldu: true, en: [6, 2, 0, 0] } } };
    const original = JSON.stringify(legacy); memory.set(ps.KEY, original); ps.init();
    ok(ps.data.kuralSurumu === S.RULES_VERSION && ps.level('P1').kuralSurumu === S.RULES_VERSION && !ps.level('P1').cozuldu && !ps.level('P1').en.h && !ps.level('P1').son && ps.level('P1').muhur.length === 0, 'store: eski P1 skoru/mührü/devam dizgisi yeni fiziksel seviyeye taşınmaz');
    ok(ps.data.arsiv.length === 1 && ps.data.arsiv[0].seviye.P1.en.h[0] === 6 && ps.data.arsiv[0].seviye.P1.son === 'd+ p' && ps.data.arsiv[0].gunluk['2026-10-13'].cozuldu && memory.get(ps.KEY + '.kurallar.belirsiz') === original, 'store: eski ilerleme içeride arşivlenir ve özgün JSON yedeklenir');
    ok(ps.level('P2').cozuldu && ps.level('P2').en.h[0] === good.tot.h && ps.level('P2').muhur[0] === 'temiz' && ps.data.ayar.ses === 0.75 && ps.data.kozmetik.kask === 'sari', 'store: sürüm etiketi olmayan doğrulanabilir v4 çözümü, ayarlar ve kozmetik korunur');
    ok(ps.level('P2').son === null && ps.level('P2').gecmis.length === 1 && ps.data.arsiv[0].seviye.P2.son === 'd+ p', 'store: bozuk devam/geçmiş ayıklanırken doğrulanmış v4 başarıları korunur');
    ok(!ps.data.gunluk['2026-10-13'] && ps.data.istat.gunSayisi === 0 && physical.world.unlocked('M1') && physical.world.unlocked('P4'), 'store: eski günlük tamamlanma sayılmaz; önceden açılmış seviyelere erişim korunur');
    ps.init(); ok(ps.data.arsiv.length === 1 && !ps.level('P1').cozuldu && ps.level('P2').cozuldu && physical.world.unlocked('M1'), 'store: göç ikinci açılışta tekrarlanmaz veya eski skorları geri getirmez');
    const p1 = LEVELS.find(l => l.id === 'P1'), current = S.replay(S.compile(p1.def), p1.kanit.cozum);
    ps.recordWin('P1', current.tot, p1.kanit.cozum, { ipuclu: false });
    ok(ps.level('P1').cozuldu && ps.level('P1').en.h[0] === current.tot.h && ps.level('P1').en.h[0] > 6 && ps.data.arsiv[0].seviye.P1.en.h[0] === 6, 'store: ilk v4 kazanması yeni kişisel en iyiyi kaydeder; eski daha küçük skor yarışmaz');
    ps.data.gunluk['2026-10-14'] = { cozuldu: true, en: [9, 2, 0, 0] }; ps.save(); ps.init();
    ok(ps.data.gunluk['2026-10-14'].kuralSurumu === S.RULES_VERSION && ps.data.istat.gunSayisi === 1 && ps.level('P1').cozuldu, 'store: yeni günlük kayıt kural sürümüyle işaretlenir ve yeniden açılışta korunur');
  } finally { global.window = oldWindow; global.location = oldLocation; }
  // ---- meydan okuma kodu
  for (const lv of LEVELS) {
    for (const key of ['cozum', 'cozumManevra', 'cozumKesinti']) {
      const str = lv.kanit && lv.kanit[key]; if (!str) continue;
      const rp = S.replay(S.compile(lv.def), str);
      const c = G.code(lv.id, str, rp.tot);
      const RV = '-r' + S.RULES_VERSION, rvEnd = new RegExp(RV + '$'), totRe = new RegExp('-(\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)' + RV + '$');
      ok(new RegExp('^PX2-[A-Za-z0-9_]+-[A-Za-z0-9_-]+-\\d+\\.\\d+\\.\\d+\\.\\d+' + RV + '$').test(c), `${lv.id}/${key}: kod biçimi ${c.slice(0, 40)}`);
      const v = G.verify(c);
      ok(v.ok && v.won && v.id === lv.id && v.str === str.trim() && v.tot.h === rp.tot.h && v.tot.k === rp.tot.k, `${lv.id}/${key}: doğrulama ${JSON.stringify({ ok: v.ok, reason: v.reason })}`);
      ok(G.verify('Bak şu kodu: ' + c + ' !').ok, `${lv.id}: metin içinden kod`);
      ok(G.verify('Kod: ' + c + '.').ok && !G.verify(c + 'x').ok && !G.verify(c + '9').ok && !G.verify(c + '.1').ok && !G.verify('x' + c).ok, `${lv.id}: kod sınırları, kesilmiş sürüm/toplam kabul edilmez`);
      ok(G.verify('https://ornek.tr/oyun/index.html#' + c).ok, `${lv.id}: URL parçasından kod`);
      ok(G.verify(encodeURIComponent('#' + c)).ok, `${lv.id}: URL kodlu`);
      const noR = c.replace(rvEnd, ''); ok(G.verify(noR).ok, `${lv.id}: sürüm eksiz (§5.3) kod`);
      // kurcalama
      const parts = c.split('-'); const tot = c.match(totRe);
      const wrongTot = c.replace(totRe, `-${+tot[1] - 1}.${tot[2]}.${tot[3]}.${tot[4]}` + RV);
      ok(!G.verify(wrongTot).ok && G.verify(wrongTot).reason === 'toplam', `${lv.id}: yanlış toplam reddedilir`);
      const other = c.replace(rvEnd, '-r2'); const vo = G.verify(other); ok(!vo.ok && vo.eski, `${lv.id}: eski kural sürümü işaretlenir`);
      const toks = str.trim().split(/\s+/); const cut = G.code(lv.id, toks.slice(0, -1).join(' '), rp.tot);
      ok(!G.verify(cut).ok, `${lv.id}: eksik defter kazanmaz`);
      const wrongLvl = G.code(lv.id === 'P1' ? 'M1' : 'P1', str, rp.tot); ok(!G.verify(wrongLvl).ok, `${lv.id}: başka seviyede doğrulanmaz`);
      break;
    }
  }
  // asla istisna atmaz
  const junk = [null, undefined, 42, {}, [], '', 'PX2-', 'PX2-P1--0.0.0.0', 'PX2-P1-!!!-1.2.3.4', 'PX2-P1-' + 'A'.repeat(30000) + '-1.1.1.1', 'PX2-ZZZ-ZzE-1.1.1.1',
    'PX2-P1-' + Buffer.from('g9999 o:YOK k:Q01').toString('base64url') + '-1.1.1.1', 'PX2-P1-' + Buffer.from('\u0000\u0001').toString('base64url') + '-0.0.0.0', 'PX2-P1-____-0.0.0.0',
    'PX2-P1-' + Buffer.from('ğüş').toString('base64url') + '-0.0.0.0', '%E0%A4%A', 'x'.repeat(50000)];
  let threw = 0; for (const j of junk) { try { const v = G.verify(j); if (v.ok) threw++; if (typeof v.msg !== 'string') threw++; } catch (e) { threw++; } }
  ok(threw === 0, 'çöp girdi: istisna yok, ok:false, msg var');
  // rastgele bit çevirme (fuzz) — kural sürümü 4: dönüştürülmüş en büyük kanıt seviyesi (T2 yoksa T1)
  const BIG = (LEVELS.find(l => l.id === 'T2') || LEVELS.find(l => l.id === 'T1') || LEVELS[LEVELS.length - 1]).id;
  const base = G.code(BIG, LEVELS.find(l => l.id === BIG).kanit.cozum, S.replay(S.compile(LEVELS.find(l => l.id === BIG).def), LEVELS.find(l => l.id === BIG).kanit.cozum).tot);
  let seed = 99, fz = 0, okc = 0;
  for (let i = 0; i < 400; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; const p = 8 + seed % (base.length - 20);
    const ch = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[seed % 64];
    const m = base.slice(0, p) + ch + base.slice(p + 1);
    try { const v = G.verify(m); if (v.ok) okc++; } catch (e) { fz++; }
  }
  ok(fz === 0, 'fuzz: istisna yok'); console.log(`  fuzz: 400 mutasyondan ${okc} hâlâ geçerli (aynı karakter ya da eşdeğer defter)`);
  ok(G.url('PX2-x') === null, 'file:// / Node: URL parçası yok');
  // ---- defter
  const T2 = LEVELS.find(l => l.id === BIG);
  const df = G.defter(BIG, T2.kanit.cozumKesinti);
  ok(df.ok && df.won && df.lines.length >= 8 && /^1\. /.test(df.lines[0]) && /Kesinti \d+/.test(df.text), 'defter numaralı satırlar');
  console.log('  defter örneği:\n    ' + df.text.split('\n').slice(0, 6).join('\n    '));
  ok(/KAPATILDI|AÇILDI/.test(df.text) && !/Pano yandı|Devre açık|Kısa Devre/.test(df.text), 'defter Türkçe, yasaklı ifade yok');
  // ---- zaman çizelgesi + oynatma (rig yok -> yalnız olaylar)
  const L = S.compile(T2.def); PX.game.L = L; PX.game.level = T2;
  const tl = G.steps(L, T2.kanit.cozum);
  ok(tl.ok && tl.won && tl.steps.every(st => st.kind !== 'walk' || (st.path.length >= 2 && st.path[st.path.length - 1] === st.a.to)), 'zaman çizelgesi yürüyüş yolları');
  const bad = G.steps(L, 'g0 o:YOK'); ok(!bad.ok, 'geçersiz dizgi zaman çizelgesi ok:false');
  const P1 = LEVELS[0]; const LP = S.compile(P1.def); PX.game.L = LP; PX.game.level = P1;
  PX.bus.log.length = 0;
  const pr = G.play(P1.kanit.cozum, { speed: 4 });
  ok(G.playing, 'oynatma başladı');
  const res = await pr;
  const steps = PX.bus.log.filter(([t]) => t === 'ghost:step').length;
  ok(res.done && steps === P1.kanit.cozum.trim().split(/\s+/).length && PX.bus.log.some(([t, p]) => t === 'ghost:end' && !p.cancelled), 'oynatma tüm adımları yayınlar');
  const p2 = G.play(P1.kanit.cozum, { speed: 4 }); await new Promise(r => setTimeout(r, 30)); G.stop(); const r2 = await p2;
  ok(r2.cancelled && !G.playing && PX.bus.log.some(([t, p]) => t === 'ghost:end' && p.cancelled), 'oynatma durdurulur');
  // sahte rig
  const calls = []; PX.volti = { ghost(on) { calls.push(['ghost', on]); return on ? { place: (c, v) => calls.push(['place', c, v]), followPath: (cells, o) => { calls.push(['walk', cells.length, o.speed]); return Promise.resolve({}); }, play: (clip) => { calls.push(['clip', clip]); return Promise.resolve({}); }, cancel() {} } : undefined; } };
  await G.play(P1.kanit.cozum, { speed: 2 });
  ok(calls.some(c => c[0] === 'place') && calls.some(c => c[0] === 'walk' && c[2] === 2) && calls.some(c => c[0] === 'clip' && c[1] === 'operate') && calls[calls.length - 1][0] === 'ghost' && calls[calls.length - 1][1] === false, 'rig tutamacı sürülür');
  const oldSetTimeout = global.setTimeout, oldClearTimeout = global.clearTimeout, timers = new Set();
  global.setTimeout = (f, ms) => { let timer; timer = oldSetTimeout(() => { timers.delete(timer); f(); }, ms); timers.add(timer); return timer; };
  global.clearTimeout = timer => { timers.delete(timer); oldClearTimeout(timer); };
  try {
    await G.play(P1.kanit.cozum, { speed: 4 });
    ok(timers.size === 0, 'hayalet: tamamlanan rig adımlarının 6 saniyelik zamanlayıcıları kalmaz');
    const held = G.play('', { speed: 4, hold: true });
    PX.volti = { ghost(on) { return on ? { followPath() { return new Promise(() => {}); }, play() { return new Promise(() => {}); }, cancel() {} } : undefined; } };
    const next = G.play(P1.kanit.cozum, { speed: 4 }); const heldResult = await held;
    ok(heldResult.cancelled && G.playing, 'hayalet: bekletme sırasında iptal yeni oynatmayı durdurmaz');
    G.stop(); ok((await next).cancelled && timers.size === 0, 'hayalet: yeni oynatma iptalinde bütün zamanlayıcılar temizlenir');
    PX.volti = { ghost(on) { return on ? { followPath() { return Promise.reject(new Error('rig hatası')); }, play() { return Promise.reject(new Error('rig hatası')); }, cancel() {} } : undefined; } };
    const failed = await G.play(P1.kanit.cozum, { speed: 4 });
    ok(failed.ok === false && !G.playing && timers.size === 0, 'hayalet: rig sözü reddedilirse oynatma temizlenir');
    const missing = await G.play('', { id: 'YOK' });
    ok(missing.ok === false && missing.err === 'seviye_yok', 'hayalet: bilinmeyen kimlik açık seviyeye düşmez');
  } finally {
    for (const timer of timers) oldClearTimeout(timer);
    global.setTimeout = oldSetTimeout; global.clearTimeout = oldClearTimeout;
  }
  delete PX.volti;
  // ---- günlük
  ok(D.dateOf(Date.UTC(2027, 0, 1, 20, 59)) === '2027-01-01' && D.dateOf(Date.UTC(2027, 0, 1, 21, 0)) === '2027-01-02', 'İstanbul gün sınırı (UTC+3)');
  const a = D.today('2027-01-01'), b = D.today('2027-01-02'), c2 = D.today('2027-01-06');
  ok(a.day === 0 && a.level.id === 'G1' && b.level.id === 'G2' && c2.level.id === 'G1', 'gün indeksi mod havuz');
  ok(D.today('2026-12-31').level.id === 'G5', 'dönem öncesi negatif gün');
  ok(D.today('2027-03-14').level.id === 'G3' && D.today('2027-03-14').index === 2, 'tarih sabitleme');
  ok(D.today('2027-02-30') === null && D.today('bozuk') === null, 'geçersiz tarih null');
  ok(D.today('0099-01-01').date === '0099-01-01' && D.today('0099-02-29') === null && D.dateOf(1e20) === null, 'tarih: küçük yıllar ve Date sınırı doğru doğrulanır');
  ok(D.today('2027-05-05').level === D.today('2027-05-05').level, 'deterministik');
  ok(typeof D.today().date === 'string', 'bugün');
  // kazanma kaydı
  D.today('2027-01-06');   // controller {daily:tarih} yüklemeden önce today(tarih) çağırır (bugünün tarihinden bağımsız)
  PX.bus.emit('level:loaded', { id: 'G1', level: DAILY[0] });
  PX.bus.emit('win', { id: 'G1', tot: { h: 9, m: 3, k: 12, o: 0 } });
  PX.bus.emit('win', { id: 'G1', tot: { h: 7, m: 4, k: 10, o: 0 } });
  const g = store.data.gunluk['2027-01-06'];
  ok(g && g.cozuldu && g.en.join(',') === '7,3,10,0' && store.data.istat.gunSayisi === 1 && D.played() === 1, 'günlük kazanma kaydı (metrik başına en iyi) ' + JSON.stringify(store.data.gunluk));
  PX.bus.emit('level:loaded', { id: 'P1', level: LEVELS[0] }); PX.bus.emit('win', { id: 'P1', tot: { h: 6, m: 3, k: 10, o: 0 } });
  ok(D.played() === 1, 'kampanya kazanması günlük sayılmaz');
  const ar = D.archive(10, '2027-01-06'); ok(ar.length === 10 && ar[0].date === '2027-01-06' && ar[0].cozuldu && !ar[1].cozuldu, 'arşiv');
  D.today('2027-01-06'); PX.bus.emit('level:loaded', { id: 'G1', level: { ...DAILY[0] } }); PX.bus.emit('win', { id: 'G1', tot: { h: 1, m: 1, k: 0, o: 0 } });
  ok(D.current === null && store.data.gunluk['2027-01-06'].en[0] === 7, 'günlük: tarih taşımayan paylaşılmış devre eski günlük oturuma yazılmaz');
  const beforeSaved = store.saved;
  ok(D.record('bozuk', { h: 1, m: 1, k: 0, o: 0 }) === null && D.record('2027-02-30', { h: 1, m: 1, k: 0, o: 0 }) === null && D.record('2027-01-02', { h: -1, m: 1, k: 0, o: 0 }) === null && store.saved === beforeSaved, 'günlük: geçersiz tarih/toplam kayıt üretmez');
  store.data.gunluk['2027-01-03'] = 42;
  const repaired = D.record('2027-01-03', { h: 2147483648, m: 1, k: 0, o: 0 });
  ok(repaired.en[0] === 2147483648 && D.played() === 2, 'günlük: bozuk satır onarılır, büyük ölçüt negatif sayıya taşmaz');
  store.data.gunluk.garbage = { cozuldu: true }; ok(D.played() === 2, 'günlük: geçersiz tarihli kayıt oynanan gün sayılmaz');
  PX.DAILY = []; ok(D.today('2027-01-01') === null && D.archive(5).length === 0, 'boş havuz -> null');
  T.done('rules_meta');
})().catch(e => { console.error(e); process.exit(1); });
