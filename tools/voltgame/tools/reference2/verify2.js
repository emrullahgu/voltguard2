'use strict';
// ============================================================================
// PARALAKS: TEK HAT — verify2.js (kural sürümü 4: FİZİKSEL DÜNYA) : her seviyeyi bağımsız doğrular.
//   node tools/reference2/verify2.js            -> tablo + "ALL LEVELS VERIFIED" (hata varsa çıkış 1)
//   node tools/reference2/verify2.js --stamp    -> kanıt alanlarını yeniden hesaplayıp seviye dosyasına yazar
//   node tools/reference2/verify2.js --json     -> verify2_out.json
//   node tools/reference2/verify2.js --file levels/ch1.js [--stamp]  -> yalnız bu aday dosya (JS dizi modülü ya da JSON)
//   node tools/reference2/verify2.js --id P1,M1 -> yalnız bu seviyeler      --no-daily -> günlük havuzu atla
//   node tools/reference2/verify2.js --ascii    -> her seviyenin üstten saha görünüşünü de basar (tasarım)
//   Varsayılan kaynak: levels2.js + levels/*.js + daily2.js (bkz. levelFiles)
// Kontroller (seviye başına):
//  0 kural sürümü: seviye 'kuralSurumu: 4' taşımalı (kural sürümü 3 seviyesi "dönüştürülmeli" ile reddedilir; PHYSICAL_GUIDE.md)
//  1 derleme: fiziksel geometri (merdiven sahanlıkları, iskele duvarı, ekipman/kapı zemine oturur, ayrılmış karakterler)
//  2 erişilebilir durum sayısı == beyan
//  3 metrik başına kesin optimum (Hamle, Manevra, Kesinti, Olay) == beyan [h,m,k,o]
//  4 altın çözümler (Hamle-, Manevra-, Kesinti-opt Manevra Defteri) yeniden oynatılır: yasal, kazanır, toplamlar
//  5 GÜVENLİK DENETİMİ (altın çözümler): her topraklama kapanışında bölüm en kötü durumda ayrılmış ve kilitli;
//    topraklama takılıyken hiçbir ayırma kilidi kaldırılmıyor; Olay=0 çözüm var
//  6 ablasyonlar == beyan (her bayrak için [Hamle-opt, Kesinti-opt Kesinti, Kesinti-opt Hamle]); 'essential' girişleri
//    ('bayrak' = Hamle, 'bayrak:kesinti' = Kesinti) optimumu değiştirir ya da seviyeyi çözümsüz yapar
//  7 dokun-yürü rastgele basma (10 000 koşu, 6·par+20 KOMUT) ve çıkmaz kesri == beyan
//  8 §6.1 SINIF BANDI (bands2.js): par, Manevra-opt, elektrik yapılandırması, durum, basma, yürüyüş payı (<= %55),
//    esaslı mekanik sayısı, çok amaçlılık (zor/sınav: Hamle × Kesinti ödünleşimi), freeWalk saf karar
//  9 FİZİKSEL KAPILAR (lint2.physical, izdüşüm×devre kapısının yerine): F1 yol yok asla, F2 her cihaz/iş noktası bir
//    durumda erişilir, F3 yürünebilir görünen her karo erişilir, F4 her merdiven/iskele kullanılır ya da gerekli,
//    F5 kapılar gerçek, F6 fiziksel tuzak yok
// 10 lint: K7 koruma payı, K9 gerçekçilik, K10 gerilim >= 0,9 pu
// 11 tasarımcı iddiaları ('iddia'): farkli, kesintisiz, ret, zorunlu, engel (erişim engeli adıyla ortaya çıkar)
// 12 süreler (ms), çözüm uzayı histogramı ve çözüm çeşitliliği raporlanır
// 13 optimizasyon talepleri (§24.6, talep2.js)
// 14 Tek Hat yerleşimi (§24.2, talep2.sldLint): R1 seviyelerinde (bölüm 0–3)
// 15 cephe uçları: H×K cephesi Hamle-opt değerinde başlar ve Kesinti-opt noktasını içerir; H×M Hamle-opt ve Manevra-opt
// 16 AMAÇ KAPISI (lint2.purpose): her cihazın işlev adı, isEmri.ozet (<= 160), iş noktası adı, eski izdüşüm metni yok
// ============================================================================
const fs = require('fs'), path = require('path');
const S = require('./sim2.js'), V = require('./solve2.js'), M = require('./metrics2.js'), B = require('./bands2.js'), LN = require('./lint2.js'), TL = require('./talep2.js');
const FILE = path.join(__dirname, 'levels2.js');
const ABL = ['noAyiriciKurali', 'noZones', 'noLoto', 'noBackfeed', 'noProtection', 'noSync', 'noCapLock', 'noDoors'];
const ESS_COUNT = ABL;

function ablate(def, flag, metric) {
  const L = S.compile(def, typeof flag === 'object' ? flag : { [flag]: true });
  if (!metric || metric === 'hamle') return V.solve(L, { cap: 2e6, path: false }).par;
  const Gr = V.explore(L, 2e6); const o = V.optimum(Gr, metric); return o ? o.tot[{ manevra: 'm', kesinti: 'k', olay: 'o' }[metric]] : -1;
}
const vec = t => [t.h, t.m, t.k, t.o];
// ablasyon -> [Hamle-opt, Kesinti-opt Kesinti, Kesinti-opt Hamle]; geçersiz başlangıç ya da çözümsüz -> [-1,-1,-1]
function ablateHK(def, opt) {
  try { const L = S.compile(def, opt); const Gr = V.explore(L, 2e6); if (Gr.unknown) return [-2, -2, -2]; const h = V.optimum(Gr, 'hamle'); if (!h) return [-1, -1, -1]; const k = V.optimum(Gr, 'kesinti').tot; return [h.tot.h, k.k, k.h]; }
  catch (e) { return [-1, -1, -1]; }
}

// güvenlik denetimi: altın yolu adım adım oynatır
function safetyAudit(L, str) {
  let s = S.initState(L); const bad = [];
  for (const t of str.split(/\s+/).filter(Boolean)) {
    const a = S.decodeAct(L, s, t); if (!a) { bad.push(`${t}: çözülemedi`); break; }
    const r = S.apply(L, s, a); if (r.err) { bad.push(`${t}: ${r.err}`); break; }
    const before = S.appliedEarths(L, s.b, s.st), after = S.appliedEarths(L, r.s.b, r.s.st);
    for (const n of after) if (before.indexOf(n) < 0 && !S.isolatedWC(L, r.s.lk, [n])) bad.push(`${t}: ayrılmamış bölüm topraklandı`);
    if (after.length && !S.isolatedWC(L, r.s.lk, after)) bad.push(`${t}: topraklama takılıyken ayırma kilidi kaldırıldı`);
    s = r.s;
  }
  return bad;
}
// tasarımcı iddiaları
function checkClaims(lv, a, L) {
  const bad = [];
  for (const c of lv.iddia || []) {
    if (c.t === 'farkli') { const x = JSON.stringify(vec(a.opt.hamle.tot)), y = JSON.stringify(vec(a.opt[c.m || 'kesinti'].tot)); if (x === y) bad.push(`iddia farkli(${c.m || 'kesinti'}) tutmuyor`); }
    else if (c.t === 'kesintisiz') {      // Kesinti-opt yolu boyunca bu yükler hiç düşmez
      let s = S.initState(L); const ids = c.yukler.map(id => L.els[L.elIndex[id]].li); let ok = true;
      for (const t of a.opt.kesinti.path.split(' ').filter(Boolean)) { const r = S.apply(L, s, S.decodeAct(L, s, t)); s = r.s; const E = S.stateE(L, s); for (const i of ids) if (!((E.loadMask >> i) & 1)) ok = false; }
      if (!ok) bad.push(`iddia kesintisiz(${c.yukler}) tutmuyor`);
    } else if (c.t === 'ret') {           // erişilen bir durumda bu ret nedeni (ve isteğe bağlı eylem türü) ortaya çıkar
      if (c.eylem === 'izdusum' || c.eylem === 'dondur') { bad.push(`iddia ret(${c.err}/${c.eylem}): kural sürümü 4'te bu eylem yok`); continue; }
      let found = false; const Gr = a.Gr;
      for (let i = 0; i < Gr.n && !found; i++) { const s = S.unkey(L, Gr.keys[i]);
        for (const x of S.candidates(L, s)) { if (c.eylem && x.t !== c.eylem) continue; const r = S.apply(L, s, x); if (r.err === c.err) { found = true; break; } } }
      if (!found) bad.push(`iddia ret(${c.err}${c.eylem ? '/' + c.eylem : ''}) hiç ortaya çıkmıyor`);
    } else if (c.t === 'engel') {         // erişilen bir durumda hedefe (eleman kimliği ya da 'w') erişim bu engel koduyla reddedilir
      const tg = c.hedef === 'w' ? { tile: L.work } : { e: L.elIndex[c.hedef] };
      if (tg.e === undefined && tg.tile === undefined) { bad.push(`iddia engel: hedef ${c.hedef} yok`); continue; }
      let found = false; const Gr = a.Gr;
      for (let i = 0; i < Gr.n && !found; i++) { const s = S.unkey(L, Gr.keys[i]); const x = S.explain(L, s, tg); if (!x.ok && x.err === c.err) found = true; }
      if (!found) bad.push(`iddia engel(${c.err} → ${c.hedef}) hiç ortaya çıkmıyor`);
    } else if (c.t === 'zorunlu') {       // her optimum (Hamle-opt değeri) bu eylem türünü ister: ablasyonla kanıt
      const v = ablate(lv.def, c.bayrak); if (v === a.par) bad.push(`iddia zorunlu(${c.bayrak}) tutmuyor`);
    } else bad.push(`bilinmeyen iddia ${c.t}`);
  }
  return bad;
}

function compute(lv) {
  const a = M.analyse(lv.def, { runs: 10000 });
  if (a.unknown || a.unsolvable) throw new Error(`${lv.id}: ${a.unknown ? 'durum sınırı aşıldı' : 'çözümsüz'}`);
  const abl = {}; const T = Date.now();
  for (const f of ABL) abl[f] = ablateHK(lv.def, { [f]: true });
  for (const e of lv.essential || []) if (/:(manevra|olay)$/.test(e)) { const [f, m] = e.split(':'); try { abl[e] = ablate(lv.def, f, m); } catch (x) { abl[e] = -1; } }
  const tAbl = Date.now() - T;
  const kOpt = a.opt.kesinti.tot.k, khOpt = a.opt.kesinti.tot.h; const ess = ESS_COUNT.filter(f => abl[f][0] !== a.par || abl[f][1] !== kOpt || abl[f][2] !== khOpt).length;
  const manOpt = a.opt.manevra.tot.m;
  const band = B.check(lv.sinif, { par: a.par, man: manOpt, manK: a.opt.kesinti.tot.m, elec: a.elec, states: a.n, mash: a.mash, walk: a.walk, ess, multi: a.multi, free: a.free });
  const golden = [a.opt.hamle.path, a.opt.manevra.path, a.opt.kesinti.path].concat((lv.talep || []).map(t => t.cozum).filter(Boolean));
  const T2 = Date.now(); const phys = LN.physical(a.L, a.Gr, golden, lv.def); const tPhys = Date.now() - T2;
  const fz = phys.info;
  return { a, abl, tAbl, tPhys, ess, band, phys,
    kanit: { kural: S.RULES_VERSION, states: a.n, edges: a.edges, elec: a.elec, opt: { hamle: vec(a.opt.hamle.tot), manevra: vec(a.opt.manevra.tot), kesinti: vec(a.opt.kesinti.tot), olay: vec(a.opt.olay.tot) },
      cozum: a.opt.hamle.path, cozumManevra: a.opt.manevra.path, cozumKesinti: a.opt.kesinti.path, abl, mash: +a.mash.toFixed(4), dead: +a.deadFrac.toFixed(4),
      walk: +a.walk.toFixed(3), free: a.free, goals: a.goals, frontK: a.frontK, frontM: a.frontM, uzay: a.space,
      fizik: { karo: fz.karo, merdiven: fz.merdiven, iskele: fz.iskele, kapi: fz.kapi, cihaz: fz.cihaz } } };
}
// ---------------------------------------------------------------------------
// Seviye kaynakları
//  varsayılan : levels2.js + tools/reference2/levels/*.js (bölüm dosyaları, ada göre sıralı) + daily2.js
//               (günlük havuz; --no-daily ile atlanır)
//  --file <p> : yalnız bu aday dosya (JS modülü: dizi dışa aktarır, ya da {LEVELS|levels:[…]}; ya da JSON dizi)
//  --id A,B   : yalnız bu kimlikler
// Aynı kimlik birden çok dosyada: içerik aynıysa sonraki atlanır; farklıysa ikisi de doğrulanır ve uyarı basılır
// (build sonraki dosyadakini, yani levels/*.js sürümünü kullanır).
// ---------------------------------------------------------------------------
const LEVEL_DIR = path.join(__dirname, 'levels');
function argVal(name) {
  const a = process.argv; const i = a.indexOf(name); if (i >= 0 && a[i + 1] && !a[i + 1].startsWith('--')) return a[i + 1];
  const eq = a.find(x => x.startsWith(name + '=')); return eq ? eq.slice(name.length + 1) : null;
}
function levelFiles() {
  const f = argVal('--file');
  if (f) { const p = path.resolve(f); if (!fs.existsSync(p)) { console.error('verify2: dosya yok: ' + p); process.exit(2); } return [p]; }
  const out = [FILE];
  if (fs.existsSync(LEVEL_DIR)) for (const n of fs.readdirSync(LEVEL_DIR).filter(n => /\.js$/i.test(n)).sort()) out.push(path.join(LEVEL_DIR, n));
  const daily = path.join(__dirname, 'daily2.js');
  if (fs.existsSync(daily) && !process.argv.includes('--no-daily')) out.push(daily);
  return out;
}
function loadLevelFile(p) {
  let v;
  if (/\.json$/i.test(p)) v = JSON.parse(fs.readFileSync(p, 'utf8'));
  else { delete require.cache[require.resolve(p)]; v = require(p); }
  const arr = Array.isArray(v) ? v : v && (v.LEVELS || v.levels || v.default);
  if (!Array.isArray(arr)) throw new Error(p + ': seviye dizisi dışa aktarılmıyor (module.exports = [ … ] beklenir)');
  return arr;
}
// damga yazımı: JS dosyasında ilk "const AD = [" öncesi (başlık yorumu, yardımcı sabitler) korunur
function writeLevelFile(p, levels) {
  const body = levels.map(l => JSON.stringify(l, null, 1).replace(/\n\s*/g, ' ')).join(',\n');
  if (/\.json$/i.test(p)) { fs.writeFileSync(p, '[\n' + body + '\n]\n'); return; }
  const src = fs.readFileSync(p, 'utf8');
  const m = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/.exec(src);
  let head, name;
  if (m) { head = src.slice(0, m.index); name = m[1]; }
  else { const c = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|'use strict';?)\s*\n)*/.exec(src); head = c ? c[0] : ''; name = 'LEVELS'; }
  fs.writeFileSync(p, head + 'const ' + name + ' = [\n' + body + '\n];\nmodule.exports = ' + name + ';\n');
}
const rel = p => path.relative(__dirname, p).replace(/\\/g, '/');

function main() {
  const stamp = process.argv.includes('--stamp');
  const onlyIds = (argVal('--id') || '').split(',').filter(Boolean);
  const files = levelFiles();
  const sets = []; const items = []; const seen = new Map();
  let fail = 0, legacy = 0; const bad = (id, m) => { fail++; console.log(`FAIL ${id}: ${m}`); };
  for (const f of files) {
    let arr; try { arr = loadLevelFile(f); } catch (e) { bad(rel(f), e.message); sets.push({ file: f, levels: null }); continue; }
    sets.push({ file: f, levels: arr });
    for (const lv of arr) {
      if (onlyIds.length && onlyIds.indexOf(lv.id) < 0) continue;
      const prev = seen.get(lv.id);
      if (prev) {
        if (JSON.stringify(prev.lv) === JSON.stringify(lv)) { console.log(`not: ${lv.id} ${rel(f)} içinde ${rel(prev.file)} ile aynı; bir kez doğrulanır`); continue; }
        console.log(`UYARI: ${lv.id} hem ${rel(prev.file)} hem ${rel(f)} içinde ve içerik FARKLI; ikisi de doğrulanır, build ${rel(f)} sürümünü kullanır`);
      }
      seen.set(lv.id, { lv, file: f }); items.push({ lv, file: f });
    }
  }
  if (files.length > 1 || argVal('--file')) console.log('dosyalar: ' + sets.map(s => `${rel(s.file)} (${s.levels ? s.levels.length : 'okunamadı'})`).join(', '));
  const rows = [];
  for (const { lv, file } of items) {
    if (lv.kuralSurumu !== S.RULES_VERSION) { legacy++; bad(lv.id, `kural sürümü ${lv.kuralSurumu || 3} seviyesi (${rel(file)}): fiziksel dünyaya (kural sürümü ${S.RULES_VERSION}) dönüştürülmeli — tools/reference2/PHYSICAL_GUIDE.md`); continue; }
    let L; try { L = S.compile(lv.def); } catch (e) { bad(lv.id, 'derleme: ' + e.message); continue; }
    if (process.argv.includes('--ascii')) { const ST = require('./site2.js'); console.log(`\n${lv.id} ${lv.ad}\n${ST.ascii(lv.def)}`); }
    let r; try { r = compute(lv); } catch (e) { bad(lv.id, e.message); continue; }
    const { a, kanit } = r;
    if (stamp) lv.kanit = kanit;
    const k = lv.kanit || {};
    if (k.kural !== kanit.kural) bad(lv.id, `kanıt kural sürümü ${k.kural} != ${kanit.kural} (yeniden damgalayın)`);
    if (k.states !== kanit.states) bad(lv.id, `durum ${kanit.states} != beyan ${k.states}`);
    if (k.elec !== kanit.elec) bad(lv.id, `elektrik yapılandırması ${kanit.elec} != beyan ${k.elec}`);
    for (const m of ['hamle', 'manevra', 'kesinti', 'olay']) if (JSON.stringify(k.opt && k.opt[m]) !== JSON.stringify(kanit.opt[m])) bad(lv.id, `opt.${m} ${kanit.opt[m]} != beyan ${k.opt && k.opt[m]}`);
    for (const [fld, m] of [['cozum', 'hamle'], ['cozumManevra', 'manevra'], ['cozumKesinti', 'kesinti']]) {
      const rp = S.replay(L, k[fld] || '');
      if (!rp.ok) bad(lv.id, `altın çözüm ${fld} yasal değil: ${rp.at} (${rp.msg})`); else if (!rp.won) bad(lv.id, `altın çözüm ${fld} kazanmıyor`);
      else if (JSON.stringify(vec(rp.tot)) !== JSON.stringify(kanit.opt[m])) bad(lv.id, `altın çözüm ${fld} toplamı ${vec(rp.tot)} != ${kanit.opt[m]}`);
      else for (const x of safetyAudit(L, k[fld])) bad(lv.id, `güvenlik denetimi ${fld}: ${x}`);
    }
    if (kanit.opt.olay[3] !== 0) bad(lv.id, 'Olay=0 çözüm yok');
    for (const f of ['frontK', 'frontM']) if (JSON.stringify(k[f]) !== JSON.stringify(kanit[f])) bad(lv.id, `${f} ${JSON.stringify(kanit[f])} != beyan ${JSON.stringify(k[f])}`);
    if (kanit.frontK) { const q = kanit.opt.kesinti; if (!kanit.frontK.length || kanit.frontK[0][0] !== kanit.opt.hamle[0]) bad(lv.id, 'H×K cephesi Hamle-opt değerinden başlamıyor');
      if (!kanit.frontK.some(p => p[0] === q[0] && p[1] === q[2])) bad(lv.id, `H×K cephesi kesinti-opt ucunu [${q[0]},${q[2]}] içermiyor`); }
    if (kanit.frontM) for (const m of ['hamle', 'manevra']) { const q = kanit.opt[m]; if (!kanit.frontM.some(p => p[0] === q[0] && p[1] === q[1])) bad(lv.id, `H×M cephesi ${m}-opt ucunu [${q[0]},${q[1]}] içermiyor`); }
    if (JSON.stringify(k.abl) !== JSON.stringify(kanit.abl)) bad(lv.id, `ablasyonlar ${JSON.stringify(kanit.abl)} != beyan ${JSON.stringify(k.abl)}`);
    for (const e of lv.essential || []) {
      const [f, m] = e.split(':');
      if (ABL.indexOf(f) < 0) { bad(lv.id, `essential '${e}': bilinmeyen ablasyon bayrağı (kural sürümü 4: ${ABL.join(', ')})`); continue; }
      const base = m === 'kesinti' ? kanit.opt.kesinti[2] * 1000 + kanit.opt.kesinti[0] : m ? kanit.opt[m][{ manevra: 1, olay: 3 }[m]] : kanit.opt.hamle[0];
      const v = kanit.abl[e] !== undefined ? kanit.abl[e] : (m === 'kesinti' ? kanit.abl[f][1] * 1000 + kanit.abl[f][2] : kanit.abl[f][0]);
      if (v === base) bad(lv.id, `mekanik '${e}' gereksiz (ablasyon optimumu değiştirmiyor: ${v})`);
    }
    if (k.mash !== kanit.mash) bad(lv.id, `basma ${kanit.mash} != ${k.mash}`);
    if (k.dead !== kanit.dead) bad(lv.id, `çıkmaz ${kanit.dead} != ${k.dead}`);
    if (JSON.stringify(k.fizik) !== JSON.stringify(kanit.fizik)) bad(lv.id, `fizik özeti ${JSON.stringify(kanit.fizik)} != beyan ${JSON.stringify(k.fizik)}`);
    for (const v of r.band) bad(lv.id, `sınıf bandı (${lv.sinif}): ${v}`);
    if (!!lv.ogretici !== (lv.sinif === 'ogretici')) bad(lv.id, 'ogretici bayrağı sınıfla uyuşmuyor');
    for (const x of r.phys.bad) bad(lv.id, 'fiziksel kapı ' + x);
    const mg = LN.margin(a.L); if (!mg.ok) bad(lv.id, `K7 koruma payı: ${mg.where}`);
    const rl = LN.realism(a.L); for (const x of rl.bad) bad(lv.id, `K9 gerçekçilik: ${x}`);
    const vl = LN.voltage(a.L); if (!vl.ok) bad(lv.id, `K10 gerilim: ${vl.where} ${vl.worst.toFixed(3)} pu < 0,9`);
    for (const x of checkClaims(lv, a, a.L)) bad(lv.id, x);
    for (const x of TL.check(lv, a.Gr)) bad(lv.id, x);
    if (lv.sld || (lv.bolum >= 0 && lv.bolum <= 3 && lv.r1 !== false)) for (const x of TL.sldLint(lv)) bad(lv.id, 'Tek Hat yerleşimi: ' + x);
    for (const x of LN.purpose(lv, a.L)) bad(lv.id, 'amaç kapısı ' + x);
    rows.push({ sinif: lv.sinif, ends: a.endConfigs, id: lv.id, ad: lv.ad, par: kanit.opt.hamle[0], opt: kanit.opt, st: kanit.states, elec: kanit.elec, edges: a.edges,
      mash: kanit.mash, dead: kanit.dead, walk: kanit.walk, free: kanit.free, ess: r.ess, fk: kanit.frontK, fm: kanit.frontM, ms: a.ms, tAbl: r.tAbl, tPhys: r.tPhys, uzay: kanit.uzay, marj: mg.score,
      fiz: r.phys.info, notes: r.phys.notes });
  }
  if (stamp) {
    for (const st of sets) if (st.levels && items.some(it => it.file === st.file && it.lv.kuralSurumu === S.RULES_VERSION)) { writeLevelFile(st.file, st.levels); console.log(rel(st.file) + ' damgalandı'); }
  }
  console.log('\nid   sınıf     Hamle-opt[h,m,k,o] Manevra-opt   Kesinti-opt    durum  elek  basma%  yürü  saf  esas  çıkmaz  karo/merd/isk/kapı  cephe(H×K)');
  for (const r of rows) console.log(`${r.id.padEnd(4)} ${r.sinif.padEnd(9)} ${JSON.stringify(r.opt.hamle).padEnd(18)} ${JSON.stringify(r.opt.manevra).padEnd(13)} ${JSON.stringify(r.opt.kesinti).padEnd(13)} ${String(r.st).padStart(7)} ${String(r.elec).padStart(5)} ${(100 * r.mash).toFixed(2).padStart(6)} ${(100 * r.walk).toFixed(0).padStart(4)}% ${String(r.free).padStart(4)} ${String(r.ess).padStart(4)}  ${r.dead.toFixed(3)}  ${(r.fiz.karo + '/' + r.fiz.merdiven + '/' + r.fiz.iskele + '/' + r.fiz.kapi).padEnd(18)} ${JSON.stringify(r.fk)}`);
  for (const r of rows) for (const n of r.notes) console.log(`  not ${r.id}: ${n}`);
  if (legacy) console.log(`\n${legacy} seviye kural sürümü 3 biçiminde (izdüşüm/görünüm geometrisi): fiziksel dünyaya dönüştürülmeli (PHYSICAL_GUIDE.md).`);
  console.log('\nsüreler (ms):  id     keşif  optimum×4  mesafe  basma  cephe  ablasyon  fizik | kenar  son-yapılandırma  K7-pay  çözüm-uzayı(Hamle:kazanma durumu)');
  for (const r of rows) console.log(`  ${r.id.padEnd(5)} ${String(r.ms.explore).padStart(8)} ${String(r.ms.optimum).padStart(10)} ${String(r.ms.toGoal).padStart(7)} ${String(r.ms.mash).padStart(6)} ${String(r.ms.front).padStart(6)} ${String(r.tAbl).padStart(9)} ${String(r.tPhys).padStart(6)} | ${r.edges} ${r.ends}  ${r.marj === Infinity ? '-' : r.marj.toFixed(2)}  ${r.uzay.map(x => x.join(':')).join(' ')}`);
  if (!rows.length && !fail) { fail++; console.log('FAIL: doğrulanacak seviye yok'); }
  console.log(fail ? `\nFAILED ${fail}` : '\nALL LEVELS VERIFIED');
  if (process.argv.includes('--json')) fs.writeFileSync(path.join(__dirname, 'verify2_out.json'), JSON.stringify(rows, null, 1));
  process.exit(fail ? 1 : 0);
}
if (require.main === module) main();
module.exports = { compute, safetyAudit, checkClaims, loadLevelFile, writeLevelFile, levelFiles, ABL };
