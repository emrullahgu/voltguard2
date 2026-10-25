'use strict';
// Hesaplama kimlikleri (js/voltsim/identity.js) ve mevzuat kayıtları (js/voltsim/regulations.js) bütünlük testleri.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const I = require('../../js/voltsim/identity.js');
const E = require('../../js/voltsim/engine.js');
const cfg = require('../../js/calculator-config.js');
const regs = require('../../js/voltsim/regulations.js');
// build-voltsim.cjs require edilmez (yüklenince sayfaları yazar); modül listesi kaynaktan okunur
const MODULES = [...read('tools/build-voltsim.cjs').matchAll(/\{ id: '([a-z]+)', slug: '([a-z-]+)'/g)].map(m => ({ id: m[1], slug: m[2] }));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pageFile = url => {
  const rel = url.replace(/^\//, '').replace(/\/$/, '');
  return [rel + '.html', rel + '/index.html'].find(f => fs.existsSync(path.join(root, f)));
};

// Gerçek modül tanımını DOM kurmadan kaydet: defaults() hesap dosyasına taşınsa da iç içe anahtarlar doğrulanır.
function moduleDefaults(id) {
  let def;
  E.ext = E.ext || {};
  E.ext[id] = require(path.join(root, 'js/voltsim/calc', id + '.js'));
  const fmt = String;
  const win = { matchMedia: () => ({ matches: false }), VoltSim: { E, fmt, fmtPower: fmt, fmtEnergy: fmt, fmtDuration: fmt, esc: String, el: () => ({}), toast: () => {}, PALETTE: {}, reduceMotion: false, register: d => { def = d; } } };
  vm.runInNewContext(read('js/voltsim/mod/' + id + '.js'), { window: win, self: win });
  assert.ok(def && typeof def.defaults === 'function', id + ': modül varsayılanları okunamadı');
  return def.defaults();
}

test('her kimlik zorunlu alanların hepsini taşır', () => {
  const ids = new Set();
  for (const e of I.entries) {
    assert.ok(!ids.has(e.id), 'tekrarlanan kimlik ' + e.id); ids.add(e.id);
    for (const k of ['id', 'family', 'name', 'purpose', 'page', 'engine', 'reviewedWith']) assert.ok(typeof e[k] === 'string' && e[k].trim(), e.id + ': ' + k);
    for (const k of ['inputs', 'outputs', 'method', 'assumptions', 'validity', 'sources', 'impl', 'tests']) assert.ok(Array.isArray(e[k]) && e[k].length, e.id + ': ' + k + ' boş');
    for (const io of e.inputs.concat(e.outputs)) assert.ok(io.length === 3 && io.every(x => typeof x === 'string' && x.trim()), e.id + ': girdi/çıktı [ad, birim, açıklama] olmalı: ' + JSON.stringify(io));
    assert.ok(Array.isArray(e.requiredData), e.id + ': requiredData');
    assert.ok(pageFile(e.page), e.id + ': sayfa yok ' + e.page);
    for (const t of e.tests) assert.ok(fs.existsSync(path.join(root, t)), e.id + ': test dosyası yok ' + t);
    for (const f of e.impl) assert.ok(fs.existsSync(path.join(root, f.split(' · ')[0])), e.id + ': uygulama dosyası yok ' + f);
  }
});

test('kimlik, motorun güncel sürümüyle gözden geçirilmiştir (sürüm değişince kimlik de güncellenmeli)', () => {
  const versions = { voltsim: E.version, 'calculator-config': cfg.version };
  for (const e of I.entries) {
    if (versions[e.engine]) assert.equal(e.reviewedWith, versions[e.engine], e.id + ': motor ' + e.engine + ' ' + versions[e.engine] + ' ama kimlik ' + e.reviewedWith + ' ile gözden geçirilmiş');
    else assert.match(e.reviewedWith, ISO, e.id);
  }
});

test('her VoltSim modülünün ve her hesap sayfasının bir kimliği vardır', () => {
  assert.ok(MODULES.length >= 17, 'modül listesi okunamadı');
  for (const m of MODULES) {
    const e = I.byModule(m.id);
    assert.ok(e, 'kimliksiz modül ' + m.id);
    assert.equal(e.page, '/voltsim/' + m.slug + '/');
  }
  const calcPages = fs.readdirSync(path.join(root, 'hesaplama')).filter(f => f.endsWith('.html'))
    .filter(f => /U\.show\(|harmonicNeed\(/.test(read('hesaplama/' + f)));
  for (const f of calcPages) assert.ok(I.entries.some(e => e.page === '/hesaplama/' + f.replace(/\.html$/, '/')), 'kimliksiz hesap sayfası ' + f);
});

test('requiredData anahtarları modülün varsayılan durumunda tanımlıdır', () => {
  for (const e of I.entries.filter(x => x.family === 'voltsim')) {
    const defaults = moduleDefaults(e.module);
    for (const d of e.requiredData) {
      assert.ok(d.label && ['katalog', 'saha', 'kullanıcı'].includes(d.kind), e.id + ': ' + JSON.stringify(d));
      assert.notEqual(I.getPath(defaults, d.key), undefined, e.id + ': varsayılanlarda yok ' + d.key);
    }
  }
});

test('fabrika örnek tesis verileri hesaplandı yerine varsayımsal olarak sınıflanır', () => {
  const F = require('../../js/voltsim/calc/fabrika.js');
  const defaults = F.defaults(), r = F.evaluate(defaults);
  const assumed = I.assumedInputs(I.byModule('fabrika'), defaults, F.defaults());
  assert.ok(assumed.some(x => /Yük ve harmonik/.test(x)));
  assert.ok(assumed.some(x => /OG şebeke/.test(x)));
  assert.equal(I.classify({ errors: r.errors, checks: r.checks, assumed }).code, 'varsayimsal');
});

test('JSON proje ekleri yüklenince A/B ve olay geçmişi aynı işlemde yeniden çizilir', () => {
  const win = { VoltSimEngine: E, matchMedia: () => ({ matches: false }) };
  const source = read('js/voltsim/core.js').replace('window.VoltSim = {', 'window.VoltSim = { App: App,');
  vm.runInNewContext(source, { window: win, document: { readyState: 'loading', addEventListener() {} }, matchMedia: win.matchMedia });
  const extras = { log: [{ text: 'Dosyadaki olay' }], ab: { A: { name: 'Dosyadaki A' } } };
  const app = new win.VoltSim.App({ id: 'fabrika', defaults: () => ({ value: 0 }), compute: () => ({ ok: true }), loadExtras: (x, a) => { a.loadedExtras = x; } }, {});
  const rendered = [];
  app.renderAnalysis = () => rendered.push(app.loadedExtras);
  app.applyState = state => { app.state = state; app.renderAnalysis(); };
  app.syncToolbar = app.wake = () => {};
  const result = app.loadProject({ format: 'voltsim-project', module: 'fabrika', schema: 1, state: { value: 1 }, extras });
  assert.equal(result.ok, true);
  assert.equal(rendered.at(-1), extras, 'son çizim içe aktarılan ek verileri kullanmalı');
});

test('hesap sayfalarının durum etiketleri VoltSim ile aynıdır', () => {
  for (const code of I.ORDER) {
    assert.equal(cfg.ui.STATUS[code].label, I.STATUS[code].label, code);
    assert.equal(cfg.ui.STATUS[code].desc, I.STATUS[code].desc, code);
  }
});

test('%14 GES kaybı her tesis için fiziksel gerçek gibi sunulmaz', () => {
  const ges = read('js/voltsim/mod/ges.js');
  assert.match(ges, /Varsayımdır, tesise göre değiştirin/);
  assert.doesNotMatch(ges, /%14, PVGIS’in varsayılan sistem kaybıdır\.'/);
  const e = I.byModule('ges');
  assert.ok(e.requiredData.some(d => d.key === 'dcLoss'), 'dcLoss varsayımsal girdi olarak işaretli');
  assert.ok(e.assumptions.some(a => /%14/.test(a) && /değiştirilebilir/.test(a)));
});

test('mevzuat kayıtları: resmî kaynak, tür, sürüm, kapsam ve gerçek doğrulama tarihi', () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const r of regs) {
    assert.ok(r.kind && r.name && r.issuer, r.id + ': tür/ad/yayımlayan');
    assert.ok(r.rg || r.version, r.id + ': sürüm (RG tarihi/sayısı veya baskı) yok');
    assert.ok(r.note && Array.isArray(r.applies) && r.applies.length, r.id + ': kapsam yok');
    assert.ok('verifiedAt' in r, r.id + ': verifiedAt alanı yok');
    if (r.verifiedAt !== null) {
      assert.match(r.verifiedAt, ISO, r.id);
      assert.ok(r.verifiedAt <= today, r.id + ': gelecekte doğrulama tarihi');
      assert.ok(r.url && r.urlVerified === true, r.id + ': doğrulama tarihi var ama resmî bağlantı doğrulanmamış');
    }
    if (r.binding) assert.ok(r.url, r.id + ': bağlayıcı düzenlemenin resmî kaynağı yok');
    if (r.verifiedAt === null) assert.equal(r.needsCheck, true, r.id + ': doğrulanmamış kayıt needsCheck olmalı');
  }
});

test('doğrulama tarihi otomatik olarak bugüne çekilmez', () => {
  for (const f of ['js/voltsim/regulations.js', 'tools/build-voltsim.cjs', 'js/voltsim/identity.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /verifiedAt\s*[:=][^,\n]*(new Date|Date\.now|toISOString)/, f);
    assert.doesNotMatch(src, /(checked|reviewedWith|verifiedAt)\s*[:=]\s*(new Date|Date\.now)/, f);
  }
  assert.ok(!('checkedText' in regs) && !('checked' in regs), 'tüm kayıtlara tek bir "son kontrol" tarihi atanmamalı');
});

test('ön hesap sonucu "mevzuata uygundur" veya "uygulama için onaylıdır" diye sunulmaz', () => {
  const files = ['js/voltsim/core.js', 'js/voltsim/engine.js', 'tools/build-voltsim.cjs',
    ...fs.readdirSync(path.join(root, 'js/voltsim/mod')).map(f => 'js/voltsim/mod/' + f),
    ...fs.readdirSync(path.join(root, 'js/voltsim/calc')).map(f => 'js/voltsim/calc/' + f),
    ...fs.readdirSync(path.join(root, 'hesaplama')).filter(f => f.endsWith('.html')).map(f => 'hesaplama/' + f),
    'tools/engineering/src/tools/AG_Kısa_Devre_Simülatörü.html', 'tools/engineering/src/tools/AG_Gerilim_Düşümü_ve_Güç_Kaybı_Hesabı.html', 'tools/engineering/src/tools/Topraklama_Simülatörü.html'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /mevzuata (tam )?uygundur|uygulama için onaylıdır|UYGUNDUR|'Ön kontroller uygun'/, f);
  }
  assert.doesNotMatch(read('js/voltsim/core.js'), /ok: 'Uygun'/, 'ön kontrol satırı "Uygun" değil "Sağlanıyor" der');
});
