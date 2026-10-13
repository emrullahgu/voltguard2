'use strict';
// Eski v3 kayıt, yeni fiziksel yayının ilk init'inden önce enjekte edilir; ayrı Chrome profili kullanılır.
// node tools/test/unit/store_migration_browser.js [--file <html>]
const path = require('path');
const cdp = require('../cdp');
const T = require('./rules_lib');
const a = process.argv.indexOf('--file');
const equalArg = process.argv.find(x => x.startsWith('--file='));
const file = path.resolve(equalArg ? equalArg.slice(7) : a >= 0 ? process.argv[a + 1] : path.join(T.ROOT, 'index.html'));
const levels = T.allLevels().filter(l => l.bolum <= 3), p2 = levels.find(l => l.id === 'P2');
const replay = T.S.replay(T.S.compile(p2.def), p2.kanit.cozum);
const valid = { cozuldu: true, en: Object.fromEntries(['h', 'm', 'k', 'o'].map(m => [m, [replay.tot[m], p2.kanit.cozum]])),
  gecmis: [[replay.tot.h, replay.tot.m, replay.tot.k, replay.tot.o]], muhur: ['temiz'], ipucsuz: true };
const old = { cozuldu: true, en: { h: [6, 'g1 d+ p'] }, gecmis: [[6, 2, 0, 0]], muhur: ['muhendis'], son: 'd+ p' };
const raw = JSON.stringify({ v: 1, ayar: { ses: 0.75 }, kozmetik: { kask: 'sari' },
  seviye: { P1: old, P2: valid, P3: old, P4: old }, gunluk: { '2026-10-13': { cozuldu: true, en: [6, 2, 0, 0] } } });

(async () => {
  const page = await cdp.launch({ width: 375, height: 667, mobile: true, touch: true, dpr: 2 });
  try {
    await page.addInitScript(`(()=>{window.__PX_TEST__=true; if(!localStorage.getItem('__px_migration_seeded')) {
      localStorage.setItem('paralaks2.kayit',${JSON.stringify(raw)});localStorage.setItem('__px_migration_seeded','1');}})()`);
    const ready = async () => { await page.goto(file); await page.waitFor('window.Game && Game.ready === true', 30000, 50); };
    const inspect = () => page.evaluate(`(()=>{const d=PX.store.data;return {rules:d.kuralSurumu,solved:d.seviye.P1.cozuldu,best:d.seviye.P1.en.h,
      seals:d.seviye.P1.muhur.length,son:d.seviye.P1.son,p2:d.seviye.P2.cozuldu,archive:d.arsiv.length,old:d.arsiv[0].seviye.P1.en.h[0],
      backup:localStorage.getItem(PX.store.KEY+'.kurallar.belirsiz'),ses:d.ayar.ses,kask:d.kozmetik.kask,m1:PX.world.unlocked('M1'),days:d.istat.gunSayisi}})()`);
    await ready(); const first = await inspect();
    T.ok(first.rules === 4 && !first.solved && !first.best && first.seals === 0 && first.son === null, 'browser: eski P1 skoru/mührü/devam dizgisi etkin değil');
    T.ok(first.archive === 1 && first.old === 6 && first.backup === raw, 'browser: eski kayıt arşivde ve özgün JSON yedekte');
    T.ok(first.p2 && first.ses === 0.75 && first.kask === 'sari' && first.m1 && first.days === 0, 'browser: v4 kanıtı/ayarlar/erişim korunur; eski günlük tamamlanma korunmaz');
    await ready(); const second = await inspect();
    T.ok(second.archive === 1 && !second.solved && second.p2 && second.m1 && second.backup === raw, 'browser: ikinci açılışta arşiv yinelenmez ve erişim korunur');
    await page.evaluate("Game.load('P1')"); await page.evaluate('Game.idle(20000)');
    await page.evaluate("Game.replay(PX.LEVELS.find(l=>l.id==='P1').kanit.cozum,{instant:true})"); await page.evaluate('Game.idle(20000)');
    const won = await page.evaluate("({best:PX.store.level('P1').en.h[0],rules:PX.store.level('P1').kuralSurumu,old:PX.store.data.arsiv[0].seviye.P1.en.h[0]})");
    T.ok(won.best === 9 && won.rules === 4 && won.old === 6, 'browser: yeni P1 kazanması 9 Hamle kaydeder, eski 6 Hamle yalnız arşivde kalır');
    T.ok(page.exceptions().length === 0, 'browser: göç ve yeni kazanma sırasında istisna yok');
    T.done('store_migration_browser');
  } finally { await page.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
