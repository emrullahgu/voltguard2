'use strict';

// VoltSim topraklama ek hesapları (js/voltsim/calc/topraklama.js): bilinen değerlerle doğrulama.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const E = require(path.join(root, 'js/voltsim/engine.js'));
const T = require(path.join(root, 'js/voltsim/calc/topraklama.js'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' beklenen ' + b + ', bulunan ' + a);
const base = { rho: 150, electrode: 'rod', L: 3, d: 0.02, n: 1, s: 6, Lstrip: 40, h: 0.8, w: 0.03, meshA: 400, meshD: 5, system: 'TT', IdN_mA: 300, UL: 50, IF: 100, tf: 0.5, rhoS: 3000, hs: 0 };

test('yüzey potansiyeli: tek çubuk kapalı biçimle aynı', () => {
  // başı t derinlikte, boyu L olan düşey çubuk: V(r)/GPR = ρ/(2πLR)·ln[(t+L+√((t+L)²+r²))/(t+√(t²+r²))]
  const R = E.topraklama.rod(150, 3, 0.02), t = T.ROD_TOP, L = 3;
  const f = T.surfacePotential(T.conductors({ electrode: 'rod', n: 1, s: 6, L: 3 }), 150, R);
  for (const r of [0.5, 1, 2, 5, 20]) {
    const exact = 150 / (2 * Math.PI * L * R) * Math.log((t + L + Math.hypot(t + L, r)) / (t + Math.hypot(t, r)));
    near(f(r, 0), exact, 1e-9, 'r = ' + r);
  }
  assert.ok(f(1, 0) > f(5, 0) && f(5, 0) > f(30, 0), 'uzaklıkla azalır');
  assert.ok(f(0, 0) <= 1);
});

test('yüzey potansiyeli: ağda iletken üstü merkezden yüksek, dışarıda düşük', () => {
  const r = E.topraklama.compute(Object.assign({}, base, { electrode: 'mesh', IF: 1000 })).values;
  const f = T.surfacePotential(T.conductors({ electrode: 'mesh', meshA: 400, h: 0.8 }, r), 150, r.R);
  assert.ok(f(0, 0) > f(25, 0) * 2, 'ağ içi ' + f(0, 0) + ' / dışı ' + f(25, 0));
  // ağ dokunma gerilimi (merkez) motorun Em değeriyle aynı mertebede
  const Ut = r.GPR * (1 - f(2.5, 2.5));
  assert.ok(Ut > 0.2 * r.Em && Ut < 5 * r.Em, 'Ut ≈ ' + Ut + ' Em = ' + r.Em);
});

test('halka elektrot (Dwight) ve yeniden değerlendirme', () => {
  const D = 10, d = 0.01, h = 0.5;
  near(T.ring(100, D, d, h), 100 / (2 * Math.PI * Math.PI * D) * (Math.log(8 * D / d) + Math.log(4 * D / (2 * h))), 1e-12);
  near(T.ring(100, D, d, h), 6.42, 0.01);
  near(T.ringD(3, 2), 10 / Math.PI, 1e-12);
  const res = E.topraklama.compute(base), w = T.withR(res, 200, base);
  assert.equal(w.values.GPR, 100 * 200);
  assert.equal(w.checks.find(c => c.id === 'tt').status, 'fail', '200 Ω · 0,3 A = 60 V > 50 V');
  assert.equal(T.withR(res, res.values.R, base).checks.find(c => c.id === 'tt').status, res.checks.find(c => c.id === 'tt').status);
});

test('Wenner: homojen toprakta ρ = 2πaR, iki tabakada sınır değerler', () => {
  near(T.wennerApparent(120, 120, 2, 3), 120, 1e-12);
  near(T.wennerRho(3, T.wennerR(120, 3)), 120, 1e-9);
  near(T.wennerApparent(80, 400, 2, 0.2), 80, 2, 'a ≪ h → üst tabaka');
  near(T.wennerApparent(80, 400, 2, 400), 400, 12, 'a ≫ h → alt tabaka');
  near(T.wennerApparent(400, 80, 2, 0.2), 400, 2);
  near(T.wennerApparent(400, 80, 2, 400), 80, 1);
  const a = T.wennerApparent(80, 400, 2, 2), b = T.wennerApparent(80, 400, 2, 8);
  assert.ok(a > 80 && b > a && b < 400, 'monoton geçiş');
});

test('potansiyel düşümü: yarım kürede %61,8 kuralı tam, çubuk dizisinde uzak akım probuyla yakınsar', () => {
  const rho = 100, r0 = 0.5, R = rho / (2 * Math.PI * r0), hemi = x => Math.min(1, r0 / x); // yarım küre: V/GPR = r0/x
  const D = 50;
  near(T.fallOfPotential(R, rho, D, 0.618034 * D, hemi), R, 1e-3);
  assert.ok(T.fallOfPotential(R, rho, D, 0.4 * D, hemi) < R && T.fallOfPotential(R, rho, D, 0.8 * D, hemi) > R);
  assert.ok(isNaN(T.fallOfPotential(R, rho, D, D, hemi)));
  const inp = Object.assign({}, base, { n: 3 }), r = E.topraklama.compute(inp).values;
  const f = T.surfacePotential(T.conductors(inp), inp.rho, r.R);
  const err = D2 => Math.abs(T.fallOfPotential(r.R, inp.rho, D2, 0.618 * D2, x => f(0, -x)) - r.R) / r.R;
  assert.ok(err(80) < 0.01 && err(80) < err(10), 'D = 80 m hata ' + err(80) + ', D = 10 m ' + err(10));
});

test('malzeme kesiti ve OG/AG birleştirme ölçütü', () => {
  assert.equal(T.materialCheck('galv', 'rod', 16).ok, true);
  assert.equal(T.materialCheck('galv', 'rod', 14).ok, false);
  assert.equal(T.materialCheck('galv', 'strip', 75).ok, false);
  assert.equal(T.materialCheck('cu', 'strip', 50).ok, true);
  assert.equal(T.mvlvCheck('common', 500, 600, 0.5).ok, true);
  assert.equal(T.mvlvCheck('common', 700, 600, 0.5).ok, false);
  assert.equal(T.mvlvCheck('separate', 1100, 600, 0.5).ok, true);
  assert.equal(T.mvlvCheck('separate', 1300, 600, 0.5).ok, false);
});
