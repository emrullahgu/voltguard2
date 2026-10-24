'use strict';
/* Unit tests for the three lead-generating pre-assessment tools (js/vg-assess.js) and their pages. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../../js/vg-assess.js');
const root = path.resolve(__dirname, '../..');
const close = (actual, expected, tol, why) => assert.ok(Math.abs(actual - expected) <= tol, `${why}: ${actual} ≉ ${expected}`);

const trafoBase = { sn: 630, pPeak: 400, cosNow: 0.95, growthPct: 3, years: 5, newKw: 150, newCos: 0.85, simult: 0.8, targetPct: 80 };

test('Trafo: standard ratings and next-size selection', () => {
  assert.equal(A.nextStd(631), 800);
  assert.equal(A.nextStd(630), 630);
  assert.equal(A.nextStd(3151), null);
});

test('Trafo: loading, P/Q summation, required rating and options', () => {
  const r = A.trafoCapacity(trafoBase);
  assert.equal(r.ok, true);
  close(r.sNow, 400 / 0.95, 1e-9, 'S now = P / cosφ');
  close(r.loadNow, 400 / 0.95 / 630 * 100, 1e-9, 'loading %');
  const pE = 400 * Math.pow(1.03, 5), qE = pE * Math.tan(Math.acos(0.95));
  const pN = 150 * 0.8, qN = pN * Math.tan(Math.acos(0.85));
  const s = Math.hypot(pE + pN, qE + qN);
  close(r.sFuture, s, 1e-6, 'S future from separate P and Q sums');
  close(r.sRequired, s / 0.8, 1e-6, 'required = S / target');
  assert.equal(r.replacement, A.nextStd(s / 0.8), 'replacement is next standard size');
  assert.equal(r.replacement, 800, '≈783 kVA required → 800 kVA');
  close(r.iRated, 630 / (Math.sqrt(3) * 0.4), 1e-6, 'rated LV current');
  assert.equal(r.sufficient, false);
  assert.ok(r.options.some(o => o.id === 'degisim') && r.options.some(o => o.id === 'ikinci'));
  assert.equal(r.second, 160, 'second transformer covers the shortfall with a standard size');
  assert.equal(r.parallelOk, false, '630:160 exceeds the 1:3 parallel rule of thumb');
});

test('Trafo: sufficient capacity, compensation deferral, oversize and validation', () => {
  const ok = A.trafoCapacity({ ...trafoBase, pPeak: 200, newKw: 0, growthPct: 0 });
  assert.equal(ok.status, 'yeterli');
  assert.deepEqual(ok.options.map(o => o.id), ['mevcut']);
  const comp = A.trafoCapacity({ ...trafoBase, sn: 1000, pPeak: 700, cosNow: 0.8, growthPct: 0, years: 0, newKw: 0, targetPct: 80 });
  close(comp.loadFuture, 87.5, 1e-9, '700/0.8 = 875 kVA on 1000 kVA');
  assert.equal(comp.compDefers, true, 'cosφ 0.98 brings 714 kVA under the 800 kVA target');
  const huge = A.trafoCapacity({ ...trafoBase, sn: 2500, pPeak: 3000, newKw: 0 });
  assert.equal(huge.replacement, null);
  assert.ok(huge.options.some(o => o.id === 'cok-buyuk'));
  for (const [field, value] of [['sn', 0], ['pPeak', -1], ['cosNow', 1.2], ['growthPct', 50], ['years', 2.5], ['simult', 0], ['targetPct', 120], ['newKw', NaN]]) {
    const bad = A.trafoCapacity({ ...trafoBase, [field]: value });
    assert.equal(bad.ok, false, field); assert.equal(bad.field, field);
  }
});

const harmBase = { sT: 1000, ukPct: 6, skGridMva: 250, pLoad: 600, vfd: 180, ups: 40, led: 30, other: 0, qc: 250, reactor: 'none' };

test('Harmonik: short-circuit power and parallel resonance order h_r = sqrt(Ssc/Qc)', () => {
  const r = A.harmonicNeed(harmBase);
  const ssc = 1 / (1 / (1000 / 0.06) + 1 / 250000);
  close(r.ssc, ssc, 1e-6, 'trafo + grid in series');
  close(r.hr, Math.sqrt(ssc / 250), 1e-9, 'resonance order');
  close(r.ghRatio, 250 / 0.9 / 1000, 1e-9, 'Gh/Sn');
  assert.equal(r.levels.gh, 2, 'Gh/Sn 27.8% → detuned class');
  assert.equal(r.levels.resonance, 2, 'h_r ≈ 7.9 within one order of the 7th');
  assert.equal(r.risk, 'Yüksek');
  assert.equal(r.reactorP, 0.07);
  close(r.tuneHz, 189, 0.5, 'p = 7% tunes to ≈189 Hz');
  close(r.capVoltageMin, 400 / 0.93, 1e-9, 'capacitor voltage U/(1−p)');
  assert.equal(r.capVoltageRated, 440);
  assert.equal(r.service, 'harmonik-filtreli-kompanzasyon');
  const thdu = (180 / 0.9 * 0.4 * 5 + 40 / 0.9 * 0.3 * 5 + 30 / 0.9 * 0.8 * 3) / ssc * 100;
  close(r.thduEst, thdu, 1e-9, 'first-order THDv estimate');
});

test('Harmonik: resonance on 5th/7th, reactor present, LED-dominant 14 %, clean plant and validation', () => {
  const ssc = 1 / (1 / (1000 / 0.06) + 1 / 250000);
  const at7 = A.harmonicNeed({ ...harmBase, qc: ssc / 49 });
  assert.equal(at7.levels.resonance, 3); assert.equal(at7.nearestOrder, 7); assert.equal(at7.risk, 'Çok yüksek');
  const reactor = A.harmonicNeed({ ...harmBase, qc: ssc / 49, reactor: 'p7' });
  assert.equal(reactor.levels.resonance, 0, 'detuned bank removes the parallel-resonance flag');
  const led = A.harmonicNeed({ ...harmBase, vfd: 20, ups: 0, led: 150 });
  assert.equal(led.reactorP, 0.14); close(led.tuneHz, 134, 0.5, 'p = 14% ≈ 134 Hz'); assert.equal(led.capVoltageRated, 480);
  const clean = A.harmonicNeed({ ...harmBase, vfd: 30, ups: 0, led: 0, qc: 0 });
  assert.equal(clean.level, 0); assert.equal(clean.hr, null); assert.equal(clean.service, 'enerji-kalitesi-olcumu');
  const infinite = A.harmonicNeed({ ...harmBase, skGridMva: 0 });
  close(infinite.ssc, 1000 / 0.06, 1e-6, 'unknown grid = infinite grid');
  for (const [field, value] of [['sT', 0], ['ukPct', 30], ['pLoad', 0], ['qc', -5], ['reactor', 'x'], ['vfd', -1]]) {
    assert.equal(A.harmonicNeed({ ...harmBase, [field]: value }).ok, false, field);
  }
  assert.equal(A.harmonicNeed({ ...harmBase, vfd: 700 }).ok, false, 'non-linear load cannot exceed total');
});

test('Risk testi: scoring, critical answers, prioritisation and partial answers', () => {
  const Q = A.RISK_QUESTIONS;
  assert.ok(Q.length >= 10);
  for (const q of Q) {
    assert.ok(q.options.length >= 2 && q.links.length >= 1 && q.service && q.action, q.id);
    assert.ok(q.options.some(o => o[1] === 0), q.id + ' has a no-risk answer');
  }
  const best = Object.fromEntries(Q.map(q => [q.id, q.options.findIndex(o => o[1] === 0)]));
  let r = A.factoryRisk(best);
  assert.deepEqual([r.complete, r.score, r.profile, r.actions.length], [true, 0, 'Düşük', 0]);
  const worst = Object.fromEntries(Q.map(q => [q.id, q.options.reduce((bi, o, i, a) => o[1] > a[bi][1] ? i : bi, 0)]));
  r = A.factoryRisk(worst);
  assert.ok(r.score > 90, 'worst answers score > 90'); assert.equal(r.profile, 'Kritik');
  assert.ok(r.actions[0].priority.startsWith('Acil'));
  // One critical answer (no RCD on some circuits) lifts an otherwise good profile to at least "Yüksek"
  r = A.factoryRisk({ ...best, rcd: 2 });
  assert.equal(r.profile, 'Yüksek'); assert.deepEqual(r.critical, ['rcd']);
  assert.equal(r.actions[0].id, 'rcd'); assert.equal(r.service, 'elektrik-pano-imalati');
  r = A.factoryRisk({ periyodik: 1 });
  assert.deepEqual([r.answered, r.complete, r.score], [1, false, 2 / 3 * 100]);
  assert.equal(A.factoryRisk({}).ok, false);
  assert.equal(A.factoryRisk({ periyodik: 99 }).answered, 0, 'invalid option ignored');
});

test('Risk testi links point to existing pages', () => {
  for (const q of A.RISK_QUESTIONS) for (const [href] of q.links) {
    const rel = href.replace(/^\//, '');
    const file = /^hesaplama\/[a-z0-9-]+\/$/.test(rel) ? rel.slice(0, -1) + '.html' : rel;
    assert.ok(fs.existsSync(path.join(root, file)), href);
  }
});

test('Tool pages: JSON-LD, quote hand-off, shared toolbar and assess module', () => {
  const pages = { 'trafo-kapasite-artirimi': 'trafo-merkezi-kurulumu', 'harmonik-filtre-ihtiyaci': 'harmonik-filtreli-kompanzasyon', 'fabrika-elektrik-risk-testi': 'elektrik-periyodik-kontrol' };
  const services = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [slug, service] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(root, 'hesaplama', slug + '.html'), 'utf8');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const types = ld['@graph'].map(x => x['@type']);
    for (const type of ['WebApplication', 'BreadcrumbList', 'FAQPage']) assert.ok(types.includes(type), `${slug} ${type}`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://voltguard.com.tr/hesaplama/${slug}/">`));
    assert.match(html, new RegExp(`href="/\\?hizmet=${service}#iletisim"`), `${slug} quote link`);
    assert.match(services, new RegExp(`value="${service}"`), `${service} exists in the contact form`);
    assert.match(html, /sessionStorage\.setItem\('vgQuoteNote'/, `${slug} hands the result to the contact form`);
    assert.match(html, /src="\/js\/vg-assess\.js\?v=/);
    assert.match(html, /src="\/js\/voltguard-tools\.js\?v=/, `${slug} gets favourite/save/PDF toolbar`);
    assert.match(html, /class="mini-calc"/);
    assert.doesNotMatch(html, /<form[^>]*id="contactForm"/, 'contact form is not duplicated');
  }
});
