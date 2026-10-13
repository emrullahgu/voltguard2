'use strict';
// Gerçek controller + hint modülleri: bekleyen sonuç, ücretsiz çıkmaz ve hayalet yarışları.
const { makeEnv, suite, eq, ok } = require('./controller_harness');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function env() {
  const E = makeEnv(); E.load('game/controller.js'); E.PX.game.init(); E.load('game/hint.js');
  E.PX.solver.abstractHint = () => ({ el: null, why: 'Hesaplanıyor…' });
  return E;
}
const result = () => ({ tier: 2, metric: 'hamle', acts: ['g20', 'o:Q01'], plan: [], why: 'Q01 açılmalı', el: 'Q01', a: 'o:Q01', dead: false });
async function win(E) {
  E.PX.game.setInstant(true);
  for (const tok of E.PX.game.level.kanit.cozum.split(' ')) { ok(E.PX.game.command({ t: 'act', tok }), tok); await E.tick(); }
  await E.tick(); return E.events('win').slice(-1)[0];
}
module.exports = async function run() {
  const { test, res } = suite('controller_hint'); console.log('controller_hint');
  await test('yalnız hesaplanıyor yanıtı temiz ve mühendis mühürlerini kaybettirmez', async () => {
    const E = env(); await E.PX.game.load('P1');
    E.PX.game.command({ t: 'hint', tier: 1 });
    eq(E.PX.hint.used, false);
    const w = await win(E); eq(w.hinted, false); ok(w.seals.includes('temiz') && w.seals.includes('muhendis'));
  });
  await test('teslim edilen gerçek öneri doğrudan hint.request ile de mühür hesabına girer', async () => {
    const E = env(); await E.PX.game.load('P1');
    E.PX.solver.abstractHint = () => ({ el: 'Q01', tok: 'o:Q01', why: 'Q01 açılmalı' });
    await E.PX.hint.request(1); eq(E.PX.hint.used, true);
    const w = await win(E); eq(w.hinted, true); ok(!w.seals.includes('temiz') && !w.seals.includes('muhendis'));
  });
  await test('arka planda tamamlanan gerçek öneri kullanılmış sayılır', async () => {
    const E = env(); await E.PX.game.load('M1'); const d = deferred();
    E.PX.solver.abstractHint = () => ({ el: null, why: 'Hesaplanıyor…', partial: true, later: d.promise });
    const p = E.PX.hint.request(1); eq(E.PX.hint.used, false);
    d.resolve({ el: 'Q01', tok: 'o:Q01', why: 'Q01 açılmalı' }); await p;
    eq(E.PX.hint.used, true); ok(E.events('hint').slice(-1)[0].update);
  });
  await test('yeni ücretsiz çıkmaz yanıtı eski bekleyen öneriyi geçersiz kılar', async () => {
    const E = env(); await E.PX.game.load('M1'); const d = deferred(); let dead = false;
    E.PX.solver.dist = () => dead ? -1 : 1; E.PX.solver.hint = () => d.promise;
    const p = E.PX.hint.request(1); dead = true;
    const r = await E.PX.hint.request(1); ok(r.dead && r.free); E.clearEv();
    d.resolve(result()); eq(await p, null); eq(E.events('hint').length, 0); eq(E.PX.hint.used, false);
  });
  await test('baştan sonrası eski arka plan ipucu yayımlanmaz', async () => {
    const E = env(); await E.PX.game.load('M1'); const d = deferred();
    E.PX.solver.abstractHint = () => ({ el: null, why: 'Hesaplanıyor…', partial: true, later: d.promise });
    const p = E.PX.hint.request(1); E.PX.game.command({ t: 'reset' }); E.clearEv();
    d.resolve({ el: 'Q01', tok: 'o:Q01', why: 'Q01 açılmalı' }); await p;
    eq(E.events('hint').length, 0); eq(E.PX.hint.used, false);
  });
  await test('ayarlar sıfırlanınca ipucu metrik önbelleği varsayılana döner', async () => {
    const E = env(); E.PX.hint.setMetric('kesinti'); eq(E.PX.hint.metric, 'kesinti');
    E.PX.bus.emit('settings', { ayar: {} }); eq(E.PX.hint.metric, 'hamle');
    E.PX.bus.emit('settings', { ayar: { ipucuMetrik: 'm' } }); eq(E.PX.hint.metric, 'manevra');
  });
  await test('eski hayalet bitişi yeni hayaletin iptal edilmesini engellemez', async () => {
    const E = env(); await E.PX.game.load('M1'); const demos = []; let stops = 0;
    E.PX.solver.dist = () => 1; E.PX.solver.hint = () => Promise.resolve(result());
    E.PX.ghost = { play() { const d = deferred(); demos.push(d); return d.promise; }, stop() { stops++; } };
    await E.PX.hint.request(2); await E.PX.hint.request(2);
    demos[0].resolve({ cancelled: true }); await E.tick(); const n = stops;
    E.PX.game.command({ t: 'walk', dir: 0 });
    ok(stops > n, 'yeni hayalet oyuncu komutuyla durduruldu'); demos[1].resolve({ cancelled: true });
  });
  return res;
};
if (require.main === module) module.exports().then(r => { console.log(`${r.name}: ${r.pass} ok, ${r.fail} fail`); process.exit(r.fail ? 1 : 0); });
