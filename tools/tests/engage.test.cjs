'use strict';
/* Return-visit widget (js/vg-engage.js + js/vg-engage-data.js) and the favourite star (js/vg-favorite.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const TERMS = require('../data/elektrik-terimleri.cjs');
const { QUESTIONS } = require('../build-engage.cjs');

function loadData() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/vg-engage-data.js'), 'utf8'), ctx);
  return ctx.window.VG_ENGAGE_DATA;
}
function engageApi() {
  const window = {}; const document = { querySelectorAll: () => [] };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/vg-engage.js'), 'utf8'), { window, document, Intl, Date, Math, Number, String });
  return window.VGEngage;
}
const fileFor = href => {
  const rel = href.split('#')[0].replace(/^\//, '');
  if (/^hesaplama\/[a-z0-9-]+\/$/.test(rel)) return rel.slice(0, -1) + '.html';
  return rel.endsWith('/') ? rel + 'index.html' : rel;
};

test('Engage data is built from real site content', () => {
  const data = loadData();
  assert.equal(data.v, 1);
  const ids = new Set(TERMS.map(t => t.id));
  assert.ok(data.terms.length >= 40);
  for (const t of data.terms) {
    assert.ok(ids.has(t.id), 'glossary term exists: ' + t.id);
    assert.ok(t.def.length > 20 && t.def.length <= 400, t.id);
  }
  assert.ok(data.sims.length >= 1);
  for (const s of data.sims) assert.ok(fs.existsSync(path.join(root, 'voltsim', s.slug, 'index.html')), 'VoltSim page exists: ' + s.slug);
  for (const t of data.tools) assert.ok(fs.existsSync(path.join(root, 'hesaplama', t.slug + '.html')), t.slug);
  assert.ok(data.featured.length >= 4, 'curated featured tools');
  assert.equal(JSON.stringify(data.questions), JSON.stringify(QUESTIONS), 'Quiz data matches its source (run node tools/build-engage.cjs)');
});

test('Twelve weekly engineering questions are well-formed and cite existing pages', () => {
  assert.equal(QUESTIONS.length, 12);
  for (const q of QUESTIONS) {
    assert.ok(q.q.endsWith('?'), q.q);
    assert.ok(q.o.length === 4 && new Set(q.o).size === 4, q.q);
    assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length, q.q);
    assert.ok(q.e.length > 30, q.q);
    assert.ok(fs.existsSync(path.join(root, fileFor(q.src[0]))), 'source exists: ' + q.src[0]);
  }
  // Spot-check that cited facts appear on the cited page.
  const cited = { '%20': '/hesaplama/reaktif-ceza-hesaplama/', '189 Hz': '/bilgi/reaktif-guc-kompanzasyonu.html', '1.667 Ω': '/bilgi/topraklama-degeri-kac-olmali.html', '1443': '/bilgi/kisa-devre-akimi-nedir.html' };
  for (const [fact, href] of Object.entries(cited)) assert.ok(fs.readFileSync(path.join(root, fileFor(href)), 'utf8').includes(fact), `${fact} in ${href}`);
});

test('Rotation is deterministic: daily term, weekly simulation and question', () => {
  const api = engageApi();
  const data = loadData();
  const a = api.pick(data, '2026-10-26'), b = api.pick(data, '2026-10-26');
  assert.deepEqual(a, b, 'same date → same content');
  assert.notEqual(api.pick(data, '2026-10-27').term.id, a.term.id, 'term changes daily');
  // Monday 26 Oct 2026 .. Sunday 1 Nov 2026 share a week; Monday 2 Nov starts a new one.
  assert.equal(api.index('2026-10-26').week, api.index('2026-11-01').week);
  assert.equal(api.index('2026-11-02').week, api.index('2026-10-26').week + 1);
  assert.deepEqual(api.pick(data, '2026-11-01').question, a.question);
  assert.notDeepEqual(api.pick(data, '2026-11-02').question, a.question);
  const seen = new Set();
  for (let i = 0; i < 12; i++) seen.add(api.pick(data, new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10)).question.q);
  assert.equal(seen.size, 12, 'every question appears once in 12 consecutive weeks');
  assert.match(api.istanbulDate(new Date(Date.UTC(2026, 9, 24, 22, 30))), /^2026-10-25$/, 'Turkish date (UTC+3) decides the rotation');
});

test('"Popüler" requires real usage data; otherwise the curated label is used', () => {
  const src = fs.readFileSync(path.join(root, 'js/vg-engage.js'), 'utf8');
  assert.match(src, /action=popular/);
  assert.match(src, /list\.length >= 3/);
  assert.match(src, /'Öne çıkan araçlar'/);
  assert.doesNotMatch(src, /localStorage|document\.cookie/, 'widget keeps no persistent state');
});

test('Favourite star reuses the account favourites collection', () => {
  const src = fs.readFileSync(path.join(root, 'js/vg-favorite.js'), 'utf8');
  assert.match(src, /toggleFavorite\(id, name\(\), url\(\)\)/);
  assert.match(src, /'voltsim-' \+ m\[1\]/);
  const validate = fs.readFileSync(path.join(root, 'api/lib/validate.php'), 'utf8');
  assert.match(validate, /'favorites' => \['max' => 200/);
  assert.ok(/^[a-z0-9][a-z0-9-]{0,99}$/.test('voltsim-sarj-istasyonu'), 'VoltSim favourite IDs satisfy the server slug rule');
  assert.match(fs.readFileSync(path.join(root, 'js/voltsim/core.js'), 'utf8'), /\/js\/vg-favorite\.js/, 'VoltSim loads the star');
});
