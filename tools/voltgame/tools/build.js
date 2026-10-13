// Assembles index.html from its parts so rules and level data have one source of truth.
//
// RELEASE R1: v2 is the default.   node tools/build.js   ==   node tools/build.js --v2   -> <root>/index.html
//             legacy v1:           node tools/build.js --v1 [--out <p>]                 -> <root>/legacy/paralaks-v1.html
//
// v1 (legacy; build code unchanged, only its default output moved to legacy/paralaks-v1.html):
//   tools/src/head.html  : CSS + HTML shell
//   tools/reference/sim.js, levels.js, pool.js : verified rules and levels (inlined verbatim)
//   tools/src/main.js    : renderer + controller
//
// v2 (PARALAKS: TEK HAT, spec docs/PARALAKS2_SPEC.md §18.5):
//   node tools/build.js [--v2] [--out <path>] [--dev] [--no-verify] [--all-levels] [--no-min]
//     --no-min        keep original source (default: parser-based safe compression and local identifier mangling)
//     --out <path>    output file (default: <root>/index.html)
//     --dev           skip verify2; size budget only warns. (R1 integration removed the stub fallback: every module
//                     must exist and pass `node --check`; the old stubs are no longer shipped.)
//     --no-verify     skip verify2 (modules must still be valid)
//     --all-levels    embed every level (default: R1 chapters from manifest.levels.chapters)
//   Steps: (1) node tools/reference2/verify2.js must print ALL LEVELS VERIFIED (unless --dev/--no-verify)
//          (2) tools/src2/manifest.json order: '@sim2' -> PX.SIM, '@levels' -> PX.LEVELS/PX.DAILY,
//              '@worker' -> PX.WORKER_SRC (JSON string: CommonJS shell + worker.lib + core/worker_src.js),
//              every other entry is a module file (glob allowed) wrapped in (function(PX){'use strict';…})(window.PX)
//          (3) verified local three.js r128   (4) v4 budget (§25.13): JS ≤ 500 KB, levels ≤ 200 KB
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const argv = process.argv.slice(2);

if (argv.includes('--v1')) buildV1(); else buildV2();

// ============================================================================ v1 (unchanged)
function buildV1() {
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const stripExports = src => src.replace(/^.*module\.exports.*$/gm, '').trimEnd();

const sim = stripExports(read('tools/reference/sim.js')).replace(/^'use strict';\s*/, '');
const levels = stripExports(read('tools/reference/levels.js'));
const pool = stripExports(read('tools/reference/pool.js'));
const head = read('tools/src/head.html').trimEnd();
const main = read('tools/src/main.js').trimEnd();

const html = `${head}
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
'use strict';
//#SIM-BEGIN
${sim}
//#SIM-END
//#LEVELS-BEGIN
${levels}
//#LEVELS-END
//#POOL-BEGIN
${pool}
//#POOL-END
${main}
</script>
</body>
</html>
`;

const oi = argv.indexOf('--out');
const outV1 = path.resolve(oi >= 0 && argv[oi + 1] ? argv[oi + 1] : path.join(root, 'legacy', 'paralaks-v1.html'));
fs.writeFileSync(outV1, html);
console.log(`${path.relative(root, outV1)} written (v1): ${html.split('\n').length} lines, ${html.length} chars`);
}

// ============================================================================ v2
function buildV2() {
  const { spawnSync } = require('child_process');
  const SRC2 = path.join(root, 'tools', 'src2'), REF2 = path.join(root, 'tools', 'reference2');
  const has = f => argv.includes(f);
  const val = f => { const i = argv.indexOf(f); if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]; const e = argv.find(a => a.startsWith(f + '=')); return e ? e.slice(f.length + 1) : null; };
  const dev = has('--dev'), noVerify = dev || has('--no-verify'), allLevels = has('--all-levels'), noMin = has('--no-min');
  const out = path.resolve(val('--out') || path.join(root, 'index.html'));
  const die = msg => { console.error('build --v2: HATA: ' + msg); process.exit(1); };
  const MIN = require('./minjs.js'); const minWarn = [];
  // Parser-based compression; local bindings may be mangled, public properties remain unchanged.
  const mini = (src, name, local) => {
    if (noMin) return src;
    const r = MIN.minify(src, name, { local: !!local, mangle: !has('--no-mangle') });
    if (!r.ok) minWarn.push(name + ': ' + r.why); return r.src;
  };
  const rd = p => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  const t0 = Date.now();

  // (1) verify2
  if (!noVerify) {
    const r = spawnSync(process.execPath, [path.join(REF2, 'verify2.js')], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const outTxt = (r.stdout || '') + (r.stderr || '');
    const tail = outTxt.trim().split('\n').slice(-1)[0];
    if (r.status !== 0 || !/ALL LEVELS VERIFIED/.test(outTxt)) { console.error(outTxt.split('\n').filter(l => /FAIL|HATA|Error/.test(l)).slice(0, 40).join('\n')); die('verify2 başarısız (' + tail + '); --dev ya da --no-verify ile atlanabilir'); }
    console.log('verify2: ' + tail);
  } else console.log('verify2: atlandı (' + (dev ? '--dev' : '--no-verify') + ')');

  // (2) manifest
  let man; try { man = JSON.parse(rd(path.join(SRC2, 'manifest.json'))); } catch (e) { die('manifest.json okunamadı: ' + e.message); }
  const replaced = [];
  const nodeCheck = file => { const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); return r.status === 0 ? null : ((r.stderr || 'node --check başarısız').trim().split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4).join(' | ')); };
  const checkRel = (rel, isJs) => {
    const p = path.join(SRC2, rel);
    if (!fs.existsSync(p)) return 'dosya yok';
    if (isJs) return nodeCheck(p);
    return null;
  };
  // modül kaynağı: tools/src2 (stub geri dönüşü yok — R1 entegrasyonu)
  function source(rel, isJs) {
    const err = checkRel(rel, isJs);
    if (!err) return { rel, src: rd(path.join(SRC2, rel)), from: rel, stub: false };
    return die(`modül ${rel}: ${err}`);
  }
  function expand(pat) {
    if (!pat.includes('*')) return [pat];
    const dir = path.posix.dirname(pat), re = new RegExp('^' + path.posix.basename(pat).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const list = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => re.test(f)).sort() : [];
    let names = list(path.join(SRC2, dir));
    return names.map(n => dir + '/' + n);
  }
  const safeScript = s => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

  // sim2 -> PX.SIM
  const simSrc = rd(path.join(REF2, 'sim2.js'));
  const expRe = /^module\.exports\s*=\s*/m;
  if ((simSrc.match(/^module\.exports\s*=/gm) || []).length !== 1) die('sim2.js: tam bir "module.exports =" satırı beklenir');
  const SIM = require(path.join(REF2, 'sim2.js'));

  // seviyeler
  const chapters = (man.levels && man.levels.chapters) || [0, 1, 2, 3];
  function loadArr(p) {
    let v; if (/\.json$/i.test(p)) v = JSON.parse(rd(p)); else { delete require.cache[require.resolve(p)]; v = require(p); }
    const a = Array.isArray(v) ? v : v && (v.LEVELS || v.levels || v.default);
    if (!Array.isArray(a)) die(p + ': seviye dizisi dışa aktarılmıyor'); return a;
  }
  function globRef(pat) {
    if (!pat.includes('*')) { const p = path.join(REF2, pat); return fs.existsSync(p) ? [p] : []; }
    const dir = path.join(REF2, path.dirname(pat)), re = new RegExp('^' + path.basename(pat).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => re.test(f)).sort().map(f => path.join(dir, f)) : [];
  }
  const DROP_TOP = new Set(['ogretir', 'iddia', 'essential', 'kaynak']);
  const KEEP_KANIT = ['states', 'elec', 'opt', 'cozum', 'cozumManevra', 'cozumKesinti', 'frontK', 'frontM', 'uzay'];
  function compact(lv) {
    const o = {}; for (const k of Object.keys(lv)) if (!DROP_TOP.has(k) && k !== 'kanit') o[k] = lv[k];
    if (lv.kanit) { o.kanit = {}; for (const k of KEEP_KANIT) if (lv.kanit[k] !== undefined) o.kanit[k] = lv.kanit[k]; }
    return o;
  }
  const byId = new Map(); const levelFiles = [];
  for (const pat of (man.levels && man.levels.files) || ['levels2.js', 'levels/*.js']) for (const f of globRef(pat)) {
    levelFiles.push(path.relative(REF2, f).replace(/\\/g, '/'));
    for (const lv of loadArr(f)) { if (!lv || !lv.id || !lv.def) die(f + ': geçersiz seviye nesnesi'); byId.delete(lv.id); byId.set(lv.id, lv); }
  }
  let levels = [...byId.values()];
  if (!allLevels) levels = levels.filter(l => chapters.includes(l.bolum));
  // kural sürümü 4 geçişi: fiziksel dünyaya henüz dönüştürülmemiş seviyeler (kuralSurumu yok) yalnız --dev/--no-verify
  // build'lerinde uyarıyla atlanır; sürüm build'i (verify2 zorunlu) zaten onları reddeder (rules-v4.md).
  { const old = levels.filter(l => l.kuralSurumu !== SIM.RULES_VERSION);
    if (old.length) { if (!noVerify) die(`kural sürümü ${SIM.RULES_VERSION}'e dönüştürülmemiş seviyeler: ${old.map(l => l.id).join(' ')}`);
      console.warn(`UYARI: kural sürümü ${SIM.RULES_VERSION} olmayan ${old.length} seviye atlandı: ${old.map(l => l.id).join(' ')}`); levels = levels.filter(l => l.kuralSurumu === SIM.RULES_VERSION); } }
  levels = levels.map((l, i) => ({ l, i })).sort((a, b) => (a.l.bolum - b.l.bolum) || (a.i - b.i)).map(x => compact(x.l));
  for (const lv of levels) { try { SIM.initState(SIM.compile(lv.def)); } catch (e) { die(`seviye ${lv.id} derlenemiyor: ${e.message}`); } }
  let daily = [];
  for (const pat of (man.levels && man.levels.daily) || []) for (const f of globRef(pat)) daily = daily.concat(loadArr(f).map(compact));
  { const old = daily.filter(d => d.kuralSurumu !== SIM.RULES_VERSION); if (old.length) { if (!noVerify) die(`kural sürümü ${SIM.RULES_VERSION}'e dönüştürülmemiş günlük bulmacalar: ${old.length}`); console.warn(`UYARI: kural sürümü ${SIM.RULES_VERSION} olmayan ${old.length} günlük bulmaca atlandı`); daily = daily.filter(d => d.kuralSurumu === SIM.RULES_VERSION); } }
  // günlük bulmaca = kampanya devresi + yeni geometri: kaynak seviyeyle aynı olan def alanları, sld ve iş emri
  // gömülmez (defFark); sayfada kaynak seviyeden geri kurulur (§24.5 kompakt kodlama). Doğrulama verify2'de tam veriyle.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  daily = daily.map(d => {
    const src = d.kaynakSeviye && levels.find(l => l.id === d.kaynakSeviye); if (!src) return d;
    const o = {}; for (const k of Object.keys(d)) if (k !== 'def' && k !== 'sld' && k !== 'isEmri') o[k] = d[k];
    o.defFark = {}; for (const k of Object.keys(d.def)) if (!same(d.def[k], src.def[k])) o.defFark[k] = d.def[k];
    const sil = Object.keys(src.def).filter(k => !(k in d.def)); if (sil.length) o.defSil = sil;
    if (d.sld && !same(d.sld, src.sld)) o.sld = d.sld;
    if (d.isEmri) { const e = {}; for (const k of Object.keys(d.isEmri)) if (!src.isEmri || !same(d.isEmri[k], src.isEmri[k])) e[k] = d.isEmri[k]; o.isEmriFark = e; }
    return o;
  });
  const DAILY_FIX = 'window.PX.DAILY.forEach(function (d) { var s = null, k; for (var i = 0; i < window.PX.LEVELS.length; i++) if (window.PX.LEVELS[i].id === d.kaynakSeviye) s = window.PX.LEVELS[i]; if (!s) return;' +
    ' if (d.defFark) { var o = {}; for (k in s.def) o[k] = s.def[k]; for (k in d.defFark) o[k] = d.defFark[k]; (d.defSil || []).forEach(function (x) { delete o[x]; }); d.def = o; delete d.defFark; delete d.defSil; }' +
    ' if (!d.sld) d.sld = s.sld; if (d.isEmriFark) { var e = {}; for (k in s.isEmri || {}) e[k] = s.isEmri[k]; for (k in d.isEmriFark) e[k] = d.isEmriFark[k]; d.isEmri = e; delete d.isEmriFark; } });';
  const levelsJs = `//#LEVELS-BEGIN\nwindow.PX.LEVELS = ${JSON.stringify(levels)};\nwindow.PX.DAILY = ${JSON.stringify(daily)};\n${DAILY_FIX}\n//#LEVELS-END`;

  // worker
  const wcfg = man.worker || { src: 'core/worker_src.js', lib: [] };   // lib []: sim2 sayfadaki //#SIM2 bölgesinden geri kurulur (rules R-1/R-2)
  const wsrc = source(wcfg.src, true);
  let wbody = 'var __defs = {}, __mods = {};\n' +
    'function require(n) { var k = String(n).replace(/^.*[\\/\\\\]/, ""); if (__mods[k]) return __mods[k].exports; var d = __defs[k]; if (!d) throw new Error("worker: modül yok " + n);' +
    ' var m = { exports: {} }; __mods[k] = m; d(m, m.exports, require); return m.exports; }\n';
  for (const lib of wcfg.lib || []) {
    const p = path.join(REF2, lib); if (!fs.existsSync(p)) die('worker.lib: ' + lib + ' yok');
    wbody += `__defs[${JSON.stringify(lib)}] = function (module, exports, require) {\n${mini(rd(p), 'worker.lib/' + lib)}\n};\n`;
  }
  wbody += '// ---- ' + wsrc.from + '\n' + mini(wsrc.src, wsrc.from);
  const workerJs = '//#WORKER-BEGIN\nwindow.PX.WORKER_SRC = ' + JSON.stringify(wbody) + ';\n//#WORKER-END';

  // modüller
  const parts = []; const used = [];
  // modül sarmalı (kısa): yükleme hatası PX.__modErr ile kaydedilir (prelude)
  const wrap = (rel, src) => `// ==== ${rel} ====\ntry{(function(PX){\n'use strict';\n${mini(src, rel, true).trimEnd()}\n})(window.PX)}catch(e){PX.__modErr(${JSON.stringify(rel)},e)}`;
  for (const m of man.modules || []) {
    const p = typeof m === 'string' ? m : m.path;
    if (p === '@sim2') {   // solverClient.sim2FromPage bu biçime dayanır: BEGIN / ';(function (PX) {' / gövde ('PX.SIM = ' satır başında) / '})(window.PX);' / END
      const body = noMin ? simSrc.replace(expRe, 'PX.SIM = ') : mini(simSrc, 'sim2.js', true).replace(/module\.exports\s*=\s*/, '\nPX.SIM = ').replace(/^\n+/, '');
      parts.push(`//#SIM2-BEGIN\n;(function (PX) {\n${body.trimEnd()}\n})(window.PX);\n//#SIM2-END`); used.push('@sim2'); continue;
    }
    if (p === '@levels') { parts.push(levelsJs); used.push('@levels'); continue; }
    if (p === '@worker') { parts.push(workerJs); used.push('@worker:' + wsrc.from); continue; }
    if (p.startsWith('@')) die('bilinmeyen üretilmiş giriş ' + p);
    const rels = expand(p);
    if (!rels.length) { if (dev) { console.warn('UYARI: ' + p + ' hiçbir dosyayla eşleşmedi'); continue; } die(p + ' hiçbir dosyayla eşleşmedi'); }
    for (const rel of rels) { const s = source(rel, true); parts.push(wrap(s.from, s.src)); used.push(s.from); }
  }
  const head = source(man.head || 'shell/head.html', false);
  if (!/<body[\s>]/i.test(head.src)) die('head.html <body> içermiyor');
  const version = 'r1-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const buildInfo = { version, release: man.release || 'R1', rules: SIM.RULES_VERSION, dev, replaced: replaced.map(r => r.split(' (')[0]), modules: used, levels: levels.map(l => l.id), daily: daily.length, levelFiles };
  const prelude = `//#PX2-BUILD ${version}\nwindow.PX = window.PX || {};\nwindow.PX.BUILD = ${JSON.stringify(buildInfo)};\n` +
    `window.PX.__modErr = function (r, e) { console.error('[PX] modül yüklenirken hata: ' + r, e); (window.PX.BUILD.loadErrors = window.PX.BUILD.loadErrors || []).push(r); };`;
  const bundle = safeScript([prelude].concat(parts).join('\n'));
  let threeScript;
  if (man.threeLocal) {
    const file = path.join(root, man.threeLocal);
    if (!fs.existsSync(file)) die('yerel three.js dosyası yok: ' + man.threeLocal);
    const bytes = fs.readFileSync(file);
    const hash = require('crypto').createHash('sha256').update(bytes).digest('hex');
    if (man.threeSHA256 && hash !== man.threeSHA256) die('yerel three.js bütünlük kontrolü başarısız');
    const licenseFile = path.join(path.dirname(file), 'three.LICENSE');
    const license = fs.existsSync(licenseFile) ? '/*!\n' + rd(licenseFile) + '\n*/\n' : '';
    threeScript = '<script>\n' + safeScript(license + rd(file)) + '\n</script>';
  } else threeScript = `<script src="${man.three || 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'}"></script>`;
  const html = `${head.src.trimEnd()}\n${threeScript}\n<script>\n${bundle}\n</script>\n</body>\n</html>\n`;

  // (4) bütçe
  const KB = n => (n / 1024).toFixed(1);
  const lvBytes = Buffer.byteLength(levelsJs, 'utf8'), jsBytes = Buffer.byteLength(bundle, 'utf8') - lvBytes, htmlBytes = Buffer.byteLength(html, 'utf8');
  const bud = man.budget || { jsKB: 450, levelKB: 200 };
  const over = [];
  if (jsBytes > bud.jsKB * 1024) over.push(`JS ${KB(jsBytes)} KB > ${bud.jsKB} KB`);
  if (lvBytes > bud.levelKB * 1024) over.push(`seviye verisi ${KB(lvBytes)} KB > ${bud.levelKB} KB`);
  if (minWarn.length) console.warn('UYARI: ayıklama atlandı (özgün kaynak kullanıldı):\n  - ' + minWarn.join('\n  - '));
  if (replaced.length) console.warn(`UYARI: --dev: ${replaced.length} modül stub ile değiştirildi:\n  - ` + replaced.join('\n  - '));
  if (over.length) { if (dev) console.warn('UYARI: boyut bütçesi aşıldı: ' + over.join('; ')); else die('boyut bütçesi aşıldı: ' + over.join('; ')); }
  // Never overwrite a working release before all validation has succeeded.
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.tmp-' + process.pid;
  try { fs.writeFileSync(tmp, html); fs.renameSync(tmp, out); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  console.log(`${path.relative(process.cwd(), out) || out} yazıldı: ${KB(htmlBytes)} KB html, JS ${KB(jsBytes)} KB (bütçe ${bud.jsKB}), seviye ${KB(lvBytes)} KB (bütçe ${bud.levelKB}), ` +
    `${levels.length} seviye [${levels.map(l => l.id).join(' ')}], günlük ${daily.length}, ${used.length} parça, ${Date.now() - t0} ms`);
}
