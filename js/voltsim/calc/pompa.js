/* VoltSim · Endüstriyel pompa ve frekans konvertörü (VFD) hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.pompa, Node'da require() ile; testleri tools/tests/voltsim-pompa.test.cjs.
 * Pompa eğrisi H(Q, s) = H0·s² + a2·Q² (s = n/n0; afinite yasalarıyla ölçeklenir), verim eğrisi BEP debisi s ile ölçeklenen
 * parabol; sistem eğrisi Hsys = Hst + kf·Q². Kısma (vana) ile VFD karşılaştırması aynı debi hedefinde yapılır.
 * Afinite yasaları: Q ∝ n, H ∝ n², P ∝ n³ (statik basma yüksekliği yokken ve verim sabitken). */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.pompa = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const G = 9.81;

  /** Pompa modeli: kapalı vana basması H0 (m), anma noktası (Qr m³/h, Hr m), en iyi verim ηmax ve BEP debisi Qbep. */
  function pump(o) { return { H0: o.H0, a2: (o.Hr - o.H0) / (o.Qr * o.Qr), Qr: o.Qr, Hr: o.Hr, etaMax: o.etaMax, Qbep: o.Qbep || o.Qr }; }
  function headAt(p, Q, s) { return p.H0 * s * s + p.a2 * Q * Q; }
  /** Verim: η = ηmax·[1 − ((Q − s·Qbep)/(s·Qbep))²], en az %5 (afinite: BEP debisi hızla orantılı, verim korunur). */
  function etaAt(p, Q, s) { const qb = Math.max(1e-9, s * p.Qbep), x = (Q - qb) / qb; return Math.max(0.05, p.etaMax * (1 - x * x)); }
  /** Sistem eğrisi: Hst + kf·Q² (kf tasarım noktasındaki sürtünme kaybından). */
  function system(Hst, Qd, Hd) { return { Hst: Hst, kf: Math.max(0, Hd - Hst) / (Qd * Qd) }; }
  const hsys = (sy, Q) => sy.Hst + sy.kf * Q * Q;
  /** Çalışma noktası: H0·s² + a2·Q² = Hst + kf·Q² → Q = √((H0·s² − Hst)/(kf − a2)). */
  function operating(p, sy, s) {
    const num = p.H0 * s * s - sy.Hst, den = sy.kf - p.a2;
    if (num <= 0 || den <= 0) return { Q: 0, H: Math.max(p.H0 * s * s, 0) };
    const Q = Math.sqrt(num / den); return { Q: Q, H: hsys(sy, Q) };
  }
  /** Hidrolik ve elektrik güç (kW): P_hid = ρ·g·Q·H, P_el = P_hid/(ηp·ηm·ηvfd). Q m³/h. */
  function power(Q, H, etaP, etaM, etaV, rho) { const Ph = (rho || 1000) * G * (Q / 3600) * H / 1e3; return { Ph: Ph, Pel: Q > 0 ? Ph / (etaP * etaM * (etaV || 1)) : 0 }; }
  /** Hedef debide VFD hızı: H0·s² = Hst + (kf − a2)·Qt². */
  function speedFor(p, sy, Qt) { return Math.sqrt(Math.max(0, (sy.Hst + (sy.kf - p.a2) * Qt * Qt) / p.H0)); }
  /** Kısma: tam hızda pompa Qt'de Hp(Qt) basar; vana kaybı Hp − Hsys. */
  function throttle(p, sy, Qt) { const Hp = headAt(p, Qt, 1); return { Hp: Hp, Hv: Math.max(0, Hp - hsys(sy, Qt)), feasible: Hp >= hsys(sy, Qt) - 1e-9 }; }
  /** Bir debi hedefinde iki yöntemin elektrik gücü. */
  function compare(p, sy, Qt, o) {
    const th = throttle(p, sy, Qt), s = speedFor(p, sy, Qt);
    const Pt = power(Qt, th.Hp, etaAt(p, Qt, 1), o.etaM, 1, o.rho);
    const Hv = hsys(sy, Qt), Pv = power(Qt, Hv, etaAt(p, Qt, s), o.etaM, o.etaVfd, o.rho);
    return { Qt: Qt, s: s, Hp: th.Hp, Hvalve: th.Hv, Hsys: Hv, feasible: th.feasible && s <= 1 + 1e-9, Pthrottle: Pt.Pel, Pvfd: Pv.Pel, Ph: Pv.Ph, etaThrottle: etaAt(p, Qt, 1), etaVfd: etaAt(p, Qt, s) };
  }
  /** Yıllık enerji: profile [[debi oranı (Qd'ye göre), saat], …]. Tam hızda bile sağlanamayan (feasible = false)
   * satırlar enerjiye katılmaz ve infeasible listesinde döner (fiziksel olmayan işletme noktası tasarrufu bozmasın). */
  function annual(p, sy, Qd, profile, o) {
    let Et = 0, Ev = 0, h = 0;
    const infeasible = [];
    const rows = profile.map((r, i) => {
      const c = compare(p, sy, Qd * r[0], o);
      if (c.feasible) { Et += c.Pthrottle * r[1]; Ev += c.Pvfd * r[1]; h += r[1]; } else infeasible.push(i);
      return Object.assign({ frac: r[0], hours: r[1] }, c);
    });
    return { rows: rows, Ethrottle: Et, Evfd: Ev, saving: Et - Ev, hours: h, infeasible: infeasible };
  }
  const AFFINITY = { Q: s => s, H: s => s * s, P: s => s * s * s };

  function compute(input) {
    const v = new E.Validator();
    const p = pump({
      H0: v.num(input.H0, 'Kapalı vana basma yüksekliği H0', { min: 2, max: 500, unit: 'm' }),
      Qr: v.num(input.Qr, 'Anma debisi', { min: 1, max: 20000, unit: 'm³/h' }),
      Hr: v.num(input.Hr, 'Anma basma yüksekliği', { min: 1, max: 400, unit: 'm' }),
      etaMax: v.num(input.etaMax, 'Pompa en iyi verimi', { min: 0.2, max: 0.92 }),
      Qbep: v.num(input.Qbep, 'BEP debisi', { min: 1, max: 20000, unit: 'm³/h' })
    });
    if (p.Hr >= p.H0) v.errors.push('Anma basma yüksekliği kapalı vana basmasından küçük olmalı.');
    const Hst = v.num(input.Hst, 'Statik basma yüksekliği', { min: 0, max: 400, unit: 'm' });
    const Qd = v.num(input.Qd, 'Tasarım debisi', { min: 1, max: 20000, unit: 'm³/h' });
    const Hd = v.num(input.Hd, 'Tasarım noktasında sistem basması', { min: 0.5, max: 400, unit: 'm' });
    if (Hd < Hst) v.errors.push('Tasarım basması statik basma yüksekliğinden küçük olamaz.');
    const etaM = v.num(input.etaM, 'Motor verimi', { min: 0.5, max: 0.99 }), etaVfd = v.num(input.etaVfd, 'Sürücü verimi', { min: 0.8, max: 0.995 });
    const frac = v.num(input.flowPct, 'Hedef debi', { min: 10, max: 120, unit: '%' }) / 100;
    const tariff = v.num(input.tariff, 'Elektrik birim fiyatı', { min: 0, max: 100, unit: 'TL/kWh' });
    const cost = v.num(input.vfdCost, 'VFD yatırım maliyeti', { min: 0, max: 1e8, unit: 'TL' });
    const prof = (input.profile || []).map((r, i) => [v.num(r[0], 'Profil ' + (i + 1) + ' debi', { min: 10, max: 120, unit: '%' }) / 100, v.num(r[1], 'Profil ' + (i + 1) + ' süre', { min: 0, max: 8760, unit: 'sa' })]);
    if (prof.reduce((a, r) => a + r[1], 0) > 8760) v.errors.push('Yıllık çalışma süresi 8760 saati aşamaz.');
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: [], checks: [], values: {} };
    const sy = system(Hst, Qd, Hd), o = { etaM: etaM, etaVfd: etaVfd, rho: 1000 };
    const full = operating(p, sy, 1);
    const Qt = Qd * frac, cmp = compare(p, sy, Qt, o);
    const year = annual(p, sy, Qd, prof, o);
    const savingTL = year.saving * tariff, payback = savingTL > 0 ? cost / savingTL : Infinity;
    const sMin = Math.sqrt(Hst / p.H0); // bu hızın altında debi yok
    const checks = [];
    const f = (x, d) => E.round(x, d === undefined ? 1 : d).toString().replace('.', ',');
    const ck = (id, label, status, detail, ref) => checks.push({ id: id, label: label, status: status, detail: detail, ref: ref || null });
    ck('cap', 'Pompa tasarım debisini karşılıyor', full.Q >= Qd * 0.98 ? 'ok' : 'fail', 'Tam hızda çalışma noktası Q = ' + f(full.Q, 0) + ' m³/h, H = ' + f(full.H) + ' m · tasarım ' + f(Qd, 0) + ' m³/h');
    ck('target', 'Hedef debi (' + f(frac * 100, 0) + ' %)', cmp.feasible ? 'ok' : 'fail', cmp.feasible ? 'VFD hızı ' + f(cmp.s * 100, 1) + ' % (' + f(cmp.s * 50, 1) + ' Hz) · kısmada vana kaybı ' + f(cmp.Hvalve) + ' m' : 'Bu debi tam hızda bile sağlanamaz.');
    const bepRatio = cmp.etaVfd / p.etaMax;
    ck('bep', 'VFD ile BEP’e yakınlık', bepRatio >= 0.95 ? 'ok' : bepRatio >= 0.85 ? 'warn' : 'fail', 'η = ' + f(cmp.etaVfd * 100, 1) + ' % (en iyi ' + f(p.etaMax * 100, 1) + ' %). Uzun süre BEP’ten uzakta çalışma titreşim ve yatak ömrünü etkiler.', 'Üretici pompa eğrisi esastır');
    if (Hst > 0) ck('static', 'Statik basma yüksekliği', sMin > 0.6 ? 'warn' : 'info', 'Hst = ' + f(Hst) + ' m: ' + f(sMin * 100, 0) + ' % hızın altında debi sıfırdır. Statik yük yüksekse VFD tasarrufu afinite yasasının (P ∝ n³) verdiğinden azdır.');
    if (cmp.s < 0.3 && cmp.feasible) ck('minspeed', 'Düşük hız', 'warn', 'Hız %30’un altında: motor soğutması (kendinden fanlı) ve minimum debi sınırı üreticiden kontrol edilmeli.');
    if (year.infeasible.length) ck('profile', 'İşletme profili', 'warn', 'Profil satırı ' + year.infeasible.map(i => i + 1).join(', ') + ': bu debi tam hızda bile sağlanamıyor; yıllık enerji ve tasarrufa katılmadı (' + f(year.hours, 0) + ' sa hesaba girdi).');
    ck('pay', 'Geri ödeme (basit)', payback <= 3 ? 'ok' : payback <= 6 ? 'info' : 'warn', 'Yıllık tasarruf ' + f(year.saving, 0) + ' kWh × ' + f(tariff, 2) + ' TL/kWh = ' + f(savingTL, 0) + ' TL · yatırım ' + f(cost, 0) + ' TL → ' + (isFinite(payback) ? f(payback, 1) + ' yıl' : 'tasarruf yok') + '. Faiz, bakım ve fiyat artışı dahil değildir.');
    return {
      ok: true, errors: [], warnings: [], checks: checks,
      values: { p: p, sy: sy, full: full, Qt: Qt, cmp: cmp, year: year, savingTL: savingTL, payback: payback, sMin: sMin, frac: frac },
      assumptions: [
        'Pompa eğrisi H = H0·s² + a2·Q² (iki noktadan, kapalı vana ve anma noktası); verim BEP etrafında parabol, afinite yasasıyla ölçeklenir (Reynolds/boyut etkileri ihmal).',
        'Sistem eğrisi Hsys = Hst + kf·Q² (tasarım noktasındaki sürtünme kaybından).',
        'Motor ve sürücü verimleri sabit girdi; düşük yükte motor verim düşüşü ve sürücü harmonik kayıpları modellenmez.',
        'Kısma senaryosunda pompa tam hızda, fazla basma vanada harcanır; baypas veya aç–kapa kontrol modellenmez.',
        'Geri ödeme basit (iskontosuz) hesaptır; tarife ve yatırım kullanıcı girdisidir.'
      ],
      formulas: ['Q₂/Q₁ = n₂/n₁, H₂/H₁ = (n₂/n₁)², P₂/P₁ = (n₂/n₁)³', 'H_pompa = H0·s² + a2·Q²', 'H_sistem = Hst + kf·Q²', 'P_el = ρ·g·Q·H/(ηp·ηm·ηvfd)', 's = √((Hst + (kf − a2)·Qt²)/H0)', 'Tasarruf = Σ (P_kısma − P_vfd)·t']
    };
  }
  return { compute: compute, pump: pump, headAt: headAt, etaAt: etaAt, system: system, hsys: hsys, operating: operating, power: power, speedFor: speedFor, throttle: throttle, compare: compare, annual: annual, AFFINITY: AFFINITY, G: G };
});
