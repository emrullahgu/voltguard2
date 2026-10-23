/* VoltSim · topraklama ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.topraklama, Node'da require() ile kullanılır; testleri tools/tests/voltsim-topraklama.test.cjs.
 * İçerik: yaklaşık yüzey potansiyeli (çizgi kaynak), halka/temel elektrot direnci (Dwight), Wenner dört uçlu ölçüm
 * (homojen ve iki tabakalı toprak), potansiyel düşümü (%61,8) ölçümü, malzeme kesiti, AG/OG topraklama birleştirme notu. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.topraklama = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const ROD_TOP = 0.5; // çubuk başı gömme derinliği (m)

  /* ---------------------------------------------------------------- yüzey potansiyeli
   * Her iletken boyunca düzgün akım dağılımlı çizgi kaynak kabul edilir; homojen yarı uzayda yüzeydeki P noktasında
   * (görüntü kaynağı dahil) V = ρ·I_c/(2π·L_c)·∫dl/D. GPR = I·R’ye bölünerek 0…1 aralığına normalize edilir. */
  /** o: { electrode, n, s, L, Lstrip, h, meshA, ring: {cx, cz, a, b} } · mesh: { nMesh, LT } */
  function conductors(o, mesh) {
    const out = [];
    if (o.electrode === 'rod') {
      const n = Math.round(o.n);
      for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * o.s; out.push({ a: [x, -ROD_TOP, 0], b: [x, -ROD_TOP - o.L, 0], k: 1 / (n * o.L) }); }
    } else if (o.electrode === 'strip') {
      out.push({ a: [-o.Lstrip / 2, -o.h, 0], b: [o.Lstrip / 2, -o.h, 0], k: 1 / o.Lstrip });
    } else if (o.electrode === 'mesh') {
      const side = Math.sqrt(o.meshA), nm = mesh.nMesh, sp = side / (nm - 1);
      for (let j = 0; j < nm; j++) {
        const c = -side / 2 + j * sp;
        out.push({ a: [-side / 2, -o.h, c], b: [side / 2, -o.h, c], k: 1 / mesh.LT });
        out.push({ a: [c, -o.h, -side / 2], b: [c, -o.h, side / 2], k: 1 / mesh.LT });
      }
    } else { // halka / temel: dikdörtgen çevre
      const r = o.ring, P = 2 * (r.a + r.b), x0 = r.cx - r.a / 2, x1 = r.cx + r.a / 2, z0 = r.cz - r.b / 2, z1 = r.cz + r.b / 2, y = -o.h;
      [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]].forEach(q => out.push({ a: [q[0], y, q[1]], b: [q[2], y, q[3]], k: 1 / P }));
    }
    return out;
  }
  /** ∫ dl/|P − X(l)| bir doğru parçası boyunca; P yüzeyde (x, 0, z). */
  function segInt(c, x, z) {
    const ax = c.a[0], ay = c.a[1], az = c.a[2];
    let ux = c.b[0] - ax, uy = c.b[1] - ay, uz = c.b[2] - az;
    const Ls = Math.hypot(ux, uy, uz); ux /= Ls; uy /= Ls; uz /= Ls;
    const px = x - ax, py = -ay, pz = z - az;
    const t0 = px * ux + py * uy + pz * uz;
    const p = Math.max(Math.sqrt(Math.max(px * px + py * py + pz * pz - t0 * t0, 0)), 0.01);
    return Math.asinh((Ls - t0) / p) - Math.asinh(-t0 / p);
  }
  /** Yüzey potansiyeli fonksiyonu f(x, z) = V/GPR (≤ 1). rho: hesapta kullanılan özdirenç, R: elektrot direnci. */
  function surfacePotential(cs, rho, R) {
    const kk = rho / (2 * Math.PI * R);
    const f = (x, z) => { let s = 0; for (let i = 0; i < cs.length; i++) s += cs[i].k * segInt(cs[i], x, z); return Math.min(1, kk * s); };
    f.cs = cs; return f;
  }

  /* ---------------------------------------------------------------- halka / temel elektrot */
  /** Dwight halka bağıntısı: R = ρ/(2π²D)·[ln(8D/d) + ln(4D/s)], D halka çapı, d iletken çapı, s = 2h. */
  function ring(rho, D, d, h) { return rho / (2 * Math.PI * Math.PI * D) * (Math.log(8 * D / d) + Math.log(4 * D / (2 * h))); }
  /** Dikdörtgen çevre için eşdeğer halka çapı (eşit çevre): D = 2(a + b)/π. */
  const ringD = (a, b) => 2 * (a + b) / Math.PI;

  /** Motor sonucunu farklı bir R ile yeniden değerlendirir (halka/temel; motor bu tipleri doğrudan hesaplamaz).
   *  Kontroller motorun bağıntılarıyla aynıdır: TT RA·IΔn ≤ UL, IT RA·Id ≤ UL, GPR = IF·R, GPR ≤ E_dokunma. */
  function withR(res, R, inp) {
    const v = Object.assign({}, res.values, { R: R, GPR: inp.IF * R, Em: null, Es: null, LT: 0, nMesh: 0 });
    const IdN = inp.IdN_mA / 1000, UL = inp.UL, rd = (x, d) => Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0);
    const checks = res.checks.map(c => {
      if (c.id === 'tt') return Object.assign({}, c, { status: R * IdN <= UL ? 'ok' : 'fail', detail: 'RA·IΔn = ' + rd(R * IdN, 1) + ' V (UL = ' + UL + ' V) → bu RCD için RA ≤ ' + rd(UL / IdN, 0) + ' Ω' });
      if (c.id === 'it') return Object.assign({}, c, { status: R * IdN <= UL ? 'ok' : 'warn', detail: 'İlk arızada RA·Id ≤ UL koşulu → ' + rd(R * IdN, 1) + ' V. Yalıtım izleme cihazı gerekir.' });
      if (c.id === 'gpr') return Object.assign({}, c, { detail: 'GPR = IF·R = ' + rd(v.GPR, 0) + ' V' });
      if (c.id === 'touch') return Object.assign({}, c, { status: v.GPR <= v.Etouch ? 'ok' : 'warn' });
      return c;
    });
    return Object.assign({}, res, { values: v, checks: checks });
  }

  /* ---------------------------------------------------------------- Wenner dört uçlu ölçüm */
  /** İki tabakalı toprakta Wenner görünür özdirenci (görüntü serisi):
   *  ρa = ρ1·[1 + 4·Σ Kⁿ·(1/√(1 + (2nh/a)²) − 1/√(4 + (2nh/a)²))], K = (ρ2 − ρ1)/(ρ2 + ρ1). Homojen toprakta ρa = ρ1. */
  function wennerApparent(rho1, rho2, h1, a, terms) {
    const K = (rho2 - rho1) / (rho2 + rho1);
    if (Math.abs(K) < 1e-12) return rho1;
    let s = 0; const N = terms || 2000;
    for (let n = 1; n <= N; n++) { const t = 2 * n * h1 / a, kn = Math.pow(K, n); s += kn * (1 / Math.sqrt(1 + t * t) - 1 / Math.sqrt(4 + t * t)); if (Math.abs(kn) < 1e-9) break; }
    return rho1 * (1 + 4 * s);
  }
  /** Ölçü aletinin göstereceği direnç R = ρa/(2πa) ve buradan ρ = 2πaR. */
  const wennerR = (rhoA, a) => rhoA / (2 * Math.PI * a);
  const wennerRho = (a, R) => 2 * Math.PI * a * R;

  /* ---------------------------------------------------------------- potansiyel düşümü (fall-of-potential) */
  /** Akım probu C elektrottan D uzakta, potansiyel probu P aynı doğrultuda x uzakta.
   *  vAt(x): elektrotun yüzey potansiyeli / GPR. Ölçülen R(x) = R·(1 − vAt(x)) − ρ/(2πD) + ρ/(2π(D − x)).
   *  Yarım küre elektrotta x = 0,618·D noktasında ölçülen değer gerçek R’ye eşittir. */
  function fallOfPotential(R, rho, D, x, vAt) {
    if (!(x > 0 && x < D)) return NaN;
    return R * (1 - vAt(x)) - rho / (2 * Math.PI * D) + rho / (2 * Math.PI * (D - x));
  }

  /* ---------------------------------------------------------------- malzeme ve kesit (özet) */
  // TS HD 60364-5-54 Tablo 54.1 ve TS EN 62305-3’e dayalı özet asgari değerler — güncel tabloyla doğrulanmalıdır.
  const MATERIALS = {
    galv: { label: 'Sıcak daldırma galvaniz çelik', rodMin_mm: 16, stripMin_mm2: 90, note: 'şerit ≥ 3 mm kalınlık' },
    cu: { label: 'Bakır', rodMin_mm: 15, stripMin_mm2: 50, note: 'şerit ≥ 2 mm kalınlık; örgülü iletken ≥ 25 mm²' },
    cuSteel: { label: 'Bakır kaplı çelik (çubuk)', rodMin_mm: 14, stripMin_mm2: 50, note: 'çubuk bakır kaplama ≥ 250 µm' }
  };
  /** type: 'rod' → size = çap (mm); diğer → kesit (mm²). */
  function materialCheck(mat, type, size) {
    const m = MATERIALS[mat] || MATERIALS.galv, min = type === 'rod' ? m.rodMin_mm : m.stripMin_mm2;
    return { ok: size >= min - 1e-9, min: min, unit: type === 'rod' ? 'mm' : 'mm²', label: m.label, note: m.note };
  }

  /** OG/AG topraklamalarının birleştirilmesi (basitleştirilmiş, HD 60364-4-442 esaslı):
   *  ortak: GPR AG nötrü/PE üzerinden tesise taşınır → GPR ≤ izin verilen dokunma gerilimi;
   *  ayrı: AG ekipmanı U0 + GPR zorlanmasını taşır → tf ≤ 5 s için GPR ≤ 1200 V. */
  function mvlvCheck(mode, GPR, Etouch, tf) {
    if (mode === 'common') return { ok: GPR <= Etouch, limit: Etouch, text: 'Ortak topraklama: GPR ≤ izin verilen dokunma gerilimi' };
    const lim = tf <= 5 ? 1200 : 250;
    return { ok: GPR <= lim, limit: lim, text: 'Ayrı topraklama: AG yalıtım zorlanması U0 + GPR ≤ U0 + ' + lim + ' V' };
  }

  return { ROD_TOP: ROD_TOP, conductors: conductors, segInt: segInt, surfacePotential: surfacePotential, ring: ring, ringD: ringD, withR: withR,
    wennerApparent: wennerApparent, wennerR: wennerR, wennerRho: wennerRho, fallOfPotential: fallOfPotential, MATERIALS: MATERIALS, materialCheck: materialCheck, mvlvCheck: mvlvCheck };
});
