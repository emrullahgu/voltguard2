/* VoltSim · komp ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.komp, Node'da require() ile kullanılır; testleri tools/tests/voltsim-komp.test.cjs.
 * İçerik: kademe sağlığı (sigorta/kapasite kaybı), ayarlı filtre boyutlandırma, kondansatör gerilim yükselmesi,
 * 24 saatlik yük profili ile günlük endüktif/kapasitif enerji oranları (EPDK 5999-3, Md. 13). */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.komp = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const SQRT3 = Math.sqrt(3);
  const CAP_VOLTAGES = [400, 415, 440, 450, 480, 525, 550, 690, 760, 800];

  /** Kademelerin gerçek gücü: sigortası atmış kademe 0, kapasitans kaybı (%) oranında azalır (Q ∝ C). */
  function effectiveSteps(steps, lossPct, fuse) {
    return steps.map((q, i) => (fuse && fuse[i] ? 0 : q * (1 - Math.min(100, Math.max(0, (lossPct && lossPct[i]) || 0)) / 100)));
  }

  /** Trafo AG barasında kısa devre gücü (sonsuz OG şebeke): Sk = Sr/uk. kVA döner. */
  function trafoSk(Sr_kVA, uk_pct) { return Sr_kVA / (uk_pct / 100); }
  /** Kondansatör devreye girince bara gerilim yükselmesi: ΔU/U ≈ Qc/Sk (%). */
  function voltageRise(Qc_kvar, Sk_kVA) { return Sk_kVA > 0 ? Qc_kvar / Sk_kVA * 100 : 0; }

  /** Ayarlı (detuned) kademe boyutlandırma. Q: bara gerilimindeki etkin kademe gücü (kVAr), p: XL/Xc.
   *  Yıldız eşdeğeri: Q = U²/(Xc − XL) = U²/(Xc·(1 − p)). */
  function detunedFilter(o) {
    const U = o.U_LL, Q = o.Q_kvar * 1e3, p = o.p, f = o.f || 50, w = 2 * Math.PI * f;
    if (!(Q > 0) || !(p > 0) || p >= 1) return null;
    const Xc = U * U / (Q * (1 - p)), XL = p * Xc;
    const I1 = Q / (SQRT3 * U);
    const Uc = U / (1 - p);                        // kondansatör uçlarında faz arası gerilim
    const Ucap = Uc * Uc / Xc;                      // kondansatörün bu gerilimde verdiği güç (VAr)
    const UcN = CAP_VOLTAGES.find(v => v >= Uc * 1.05) || CAP_VOLTAGES[CAP_VOLTAGES.length - 1]; // %5 pay ile anma gerilimi
    return {
      Xc: Xc, XL: XL, C_uF: 1e6 / (w * Xc), L_mH: XL / w * 1e3, I1: I1, Uc: Uc, fr: f / Math.sqrt(p), hr: 1 / Math.sqrt(p),
      Qcap_kvar: Ucap / 1e3, UcN: UcN, QcapN_kvar: Ucap * (UcN / Uc) * (UcN / Uc) / 1e3, Qreactor_kvar: I1 * I1 * XL * 3 / 1e3
    };
  }

  /** Ölçeklenebilir kademe seçimi (kademe sayısı sınırsız). program:
   *  'optimal' — hedefi (Q·(1 + tol)) aşmayan en büyük toplam (0/1 sırt çantası, dinamik programlama, 0,1 kVAr çözünürlük);
   *  'linear'  — liste sırasıyla ekleme (sıralı/lineer program): sığan kademe devreye alınır. Dönüş: bool[]. */
  function chooseSteps(steps, Q, opt) {
    opt = opt || {};
    const n = steps.length, tol = opt.tol === undefined ? 0.02 : opt.tol, lim = Math.max(0, Q) * (1 + tol) + 1e-9;
    const on = steps.map(() => false);
    if (!n || lim <= 0) return on;
    if (opt.program === 'linear') { let t = 0; steps.forEach((q, i) => { if (q > 0 && t + q <= lim) { on[i] = true; t += q; } }); return on; }
    const total = steps.reduce((a, q) => a + Math.max(0, q), 0);
    const cap = Math.min(lim, total);
    let unit = 0.1; while (cap / unit > 200000) unit *= 2;
    const C = Math.floor(cap / unit + 1e-6), w = steps.map(q => Math.max(0, Math.round(q / unit)));
    const reach = new Uint8Array(C + 1), from = new Int32Array(C + 1).fill(-1);
    reach[0] = 1;
    for (let i = 0; i < n; i++) {
      const wi = w[i]; if (!wi || wi > C) continue;
      for (let c = C; c >= wi; c--) if (!reach[c] && reach[c - wi]) { reach[c] = 1; from[c] = i; }
    }
    let best = C; while (best > 0 && !reach[best]) best--;
    for (let c = best; c > 0;) { const i = from[c]; on[i] = true; c -= w[i]; }
    return on;
  }

  /** Reaktif güç rölesi kararı (ideal, kalıcı durum). o: { steps (etkin kVAr), shunt (etkin kVAr dizisi), Ql, Qneed, Qcap, ctPos, program }.
   *  Tesis kendi başına kapasitifse (Ql < Qcap) önce şönt reaktör kademeleri devreye alınır; sonra kondansatör hedefi
   *  T = Qneed − Qcap + Q_şönt (motorla aynı ilke). ctPos = 'load': akım trafosu kondansatör akımını görmez → röle
   *  hedefe hiç ulaşamadığını sanar ve tüm kademeleri devreye alır (yaygın montaj hatası). */
  function controller(o) {
    const shunt = o.shunt || [];
    const base = o.Ql - (o.Qcap || 0);
    const shuntOn = base < 0 ? chooseSteps(shunt, -base, { program: 'optimal', tol: 0.1 }) : shunt.map(() => false);
    const shuntQ = shunt.reduce((a, q, i) => a + (shuntOn[i] ? q : 0), 0);
    let capOn;
    if (o.ctPos === 'load') capOn = o.steps.map(q => q > 0);
    else capOn = chooseSteps(o.steps, o.Qneed - (o.Qcap || 0) + shuntQ, { program: o.program });
    return { capOn: capOn, shuntOn: shuntOn, shuntQ: shuntQ, capQ: o.steps.reduce((a, q, i) => a + (capOn[i] ? q : 0), 0) };
  }

  /** C/k değeri (A): en küçük kademenin akım trafosu sekonderine indirgenmiş reaktif akımı. Röle tepki eşiği ≈ 0,65·C/k. */
  function cOverK(Qmin_kvar, U_LL, ctPrimary, ctSecondary) { return Qmin_kvar * 1e3 / (SQRT3 * U_LL) / (ctPrimary / (ctSecondary || 5)); }

  /** Aktif harmonik filtre (AHF): anma akımına kadar yük harmonik akımlarını oransal bastıran ideal akım kaynağı.
   *  harm: { h: % I1 }, I1: yük temel akımı (A), Iahf: filtre anma (rms) akımı. Dönüş: { harmonics, k, Ih } */
  function ahfReduce(harm, I1, Iahf) {
    const keys = Object.keys(harm);
    const Ih = I1 * Math.sqrt(keys.reduce((a, h) => a + Math.pow((Number(harm[h]) || 0) / 100, 2), 0));
    const k = Ih > 0 ? Math.min(1, Math.max(0, Iahf) / Ih) : 0;
    const out = {}; keys.forEach(h => { out[h] = (Number(harm[h]) || 0) * (1 - k); });
    return { harmonics: out, k: k, Ih: Ih };
  }

  /** Örnek 24 saatlik yük profilleri (P/Pmaks). */
  const PROFILES = {
    v3: { label: 'Üç vardiya (7/24)', f: [0.78, 0.8, 0.8, 0.78, 0.78, 0.8, 0.82, 0.7, 0.86, 0.9, 0.92, 0.9, 0.8, 0.9, 0.92, 0.9, 0.72, 0.86, 0.88, 0.88, 0.85, 0.84, 0.82, 0.8] },
    v2: { label: 'İki vardiya (06–22)', f: [0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.75, 0.9, 0.95, 1, 1, 0.95, 0.7, 0.95, 1, 1, 0.95, 0.9, 0.85, 0.85, 0.8, 0.6, 0.15, 0.1] },
    v1: { label: 'Tek vardiya (08–17)', f: [0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.1, 0.4, 0.95, 1, 1, 0.95, 0.55, 0.95, 1, 1, 0.9, 0.4, 0.12, 0.1, 0.1, 0.08, 0.08, 0.08] }
  };

  /** Saatlik P (kW) ve Q (kVAr, + endüktif) dizisinden günlük enerjiler ve oranlar (Δt = 1 sa). */
  function dailyEnergy(hours) {
    let kWh = 0, ind = 0, cap = 0;
    hours.forEach(h => { kWh += h.P; if (h.Q >= 0) ind += h.Q; else cap -= h.Q; });
    return { kWh: kWh, kvarhInd: ind, kvarhCap: cap, indPct: kWh > 0 ? ind / kWh * 100 : 0, capPct: kWh > 0 ? cap / kWh * 100 : 0 };
  }
  /** EPDK 5999-3 Md. 13 sınırları (motorla aynı ölçüt). */
  function epdkLimits(installed_kVA) { return installed_kVA < 50 ? { ind: 33, cap: 20 } : { ind: 20, cap: 15 }; }

  /** Gün simülasyonu: her saat yük P = Pmaks·f(h); otomatik röle o saatin motor seçimini uygular (ideal, gecikmesiz).
   *  base: VoltSimEngine.komp.compute girdisi (steps = etkin kademe güçleri). */
  function simulateDay(base, frac, ctl) {
    ctl = ctl || {};
    const hours = frac.map((f, h) => {
      const P = base.P_kW * f, Ql = P * Math.tan(Math.acos(base.cos1));
      const c = controller({ steps: base.steps, shunt: ctl.shunt || [], Ql: Ql, Qneed: E.komp.requiredQc(P, base.cos1, base.cos2), Qcap: base.Qcap_kvar || 0, ctPos: ctl.ctPos, program: ctl.program });
      const r = E.komp.compute(Object.assign({}, base, { P_kW: P, manual: c.capOn, shunt_kvar: c.shuntQ }));
      return { h: h, P: P, Q: r.values.Qnet, Qc: r.values.QcNom, Qsh: c.shuntQ, cos: r.values.cosNew, steps: r.values.steps };
    });
    const tot = dailyEnergy(hours);
    const lim = epdkLimits(base.installed_kVA === undefined ? base.Sr_kVA : base.installed_kVA);
    return Object.assign(tot, { hours: hours, limit: lim, indOk: tot.indPct <= lim.ind, capOk: tot.capPct <= lim.cap });
  }

  return { chooseSteps: chooseSteps, controller: controller, cOverK: cOverK, ahfReduce: ahfReduce, effectiveSteps: effectiveSteps, trafoSk: trafoSk, voltageRise: voltageRise, detunedFilter: detunedFilter, PROFILES: PROFILES, dailyEnergy: dailyEnergy, epdkLimits: epdkLimits, simulateDay: simulateDay, CAP_VOLTAGES: CAP_VOLTAGES };
});
