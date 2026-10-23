/* VoltSim · res ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.res, Node'da require() ile kullanılır; testleri tools/tests/voltsim-res.test.cjs.
 *
 * İçerik: Weibull yoğunluğu; üretici bilgi föyünden (nominal hız) Cp türetme; 1B momentum kuramıyla Cp → Ct;
 * Jensen/Park iz modeli (kısmi örtüşmeli, Katic kare toplamı); park yerleşimi ve yön ortalamalı iz kaybı;
 * OG toplama kablosu ve trafo kayıpları; şebeke işletmecisi güç sınırı (curtailment); cut-out sonrası yeniden
 * devreye girme histerezisi (örnek ayar); tohumlu sentetik türbülanslı rüzgâr serisi; IEC 61400-12-1 yoğunluk
 * düzeltmesi; sapma (yaw) hatası kaybı yaklaşımı. Türbin gücü her yerde motorun E.res.power() fonksiyonundandır. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.res = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const R = E.res, BETZ = R.BETZ, RHO0 = 1.225, DEG = Math.PI / 180;

  /* ---------------------------------------------------------------- rüzgâr istatistiği ve profil */
  function weibullPdf(v, c, k) { return v <= 0 ? 0 : k / c * Math.pow(v / c, k - 1) * Math.exp(-Math.pow(v / c, k)); }
  function weibullMean(c, k) { return c * R.gamma(1 + 1 / k); }
  function weibullC(mean, k) { return mean / R.gamma(1 + 1 / k); }
  /** Üstel profil (motorla aynı bağıntı): v(h) = v_ref·(h/h_ref)^α */
  function atHeight(vRef, href, h, alpha) { return vRef * Math.pow(h / href, alpha); }
  /** IEC 61400-12-1 yoğunluk düzeltmesi: v_n = v·(ρ/ρ0)^(1/3), ρ0 = 1,225 kg/m³. */
  function densityCorrect(v, rho, rho0) { return v * Math.cbrt(rho / (rho0 || RHO0)); }

  /* ---------------------------------------------------------------- türbin föyü → motor türbin tanımı */
  /**
   * ds: { Prated (kW), D (m), cutIn, vRated, cutOut (m/s), etaMech, etaGen }
   * Cp, föydeki nominal hızda nominal güce ρ0 = 1,225'te ulaşılacak biçimde türetilir: Cp = P_n / (½·ρ0·A·v_n³·η).
   */
  function cpFromDatasheet(ds) {
    const A = Math.PI * ds.D * ds.D / 4;
    return ds.Prated * 1000 / (0.5 * RHO0 * A * Math.pow(ds.vRated, 3) * ds.etaMech * ds.etaGen);
  }
  function turbine(ds, rho) {
    return { A: Math.PI * ds.D * ds.D / 4, rho: rho, cp: cpFromDatasheet(ds), etaMech: ds.etaMech, etaGen: ds.etaGen, cutIn: ds.cutIn, cutOut: ds.cutOut, Prated: ds.Prated, D: ds.D };
  }

  /* ---------------------------------------------------------------- momentum kuramı ve Jensen izi */
  /** 1B momentum: Cp = 4a(1−a)², Ct = 4a(1−a), a ∈ [0, 1/3]. Cp ≥ 16/27 → a = 1/3, Ct = 8/9. */
  function aFromCp(cp) {
    if (cp <= 0) return 0;
    if (cp >= BETZ) return 1 / 3;
    let lo = 0, hi = 1 / 3;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (4 * m * (1 - m) * (1 - m) < cp) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  function ctFromCp(cp) { const a = aFromCp(cp); return 4 * a * (1 - a); }
  /** Türbinin v hızındaki itme katsayısı: kısmi yükte föy Cp'si, nominalde gereken Cp; durmuşken 0. */
  function ctAt(t, v) {
    const p = R.power(v, t);
    if (p.region === 'idle' || p.region === 'stop') return 0;
    return ctFromCp(p.region === 'rated' ? p.cpReq : t.cp);
  }
  /** Jensen (Park) hız açığı: δ = (1 − √(1 − Ct)) / (1 + 2k·x/D)², x: akış yönünde uzaklık. */
  function jensenDeficit(ct, x, D, k) { return (1 - Math.sqrt(Math.max(0, 1 - ct))) / Math.pow(1 + 2 * k * x / D, 2); }
  /** Yarıçapları r1, r2, merkez uzaklığı d olan iki dairenin kesişim alanı. */
  function circleOverlap(r1, r2, d) {
    if (d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
    const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
    const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
    const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
    return a + b - c;
  }
  /**
   * Park içi hızlar. layout: [{ x, y (m; x doğu, y kuzey), t (türbin tanımı) }], dirDeg: rüzgârın geldiği yön (meteorolojik).
   * Akış yönünde sıralanır; her türbin, önündeki türbinlerin izlerinden (kısmi örtüşme oranıyla) etkilenir, açıklar Katic
   * yöntemiyle kare toplanır. Yükseklik farkı ve arazi etkisi dahil değildir.
   */
  function farmSpeeds(layout, vFree, dirDeg, k) {
    const n = layout.length, fx = -Math.sin(dirDeg * DEG), fy = -Math.cos(dirDeg * DEG);
    const proj = layout.map((p, i) => ({ i: i, s: p.x * fx + p.y * fy }));
    proj.sort((a, b) => a.s - b.s);
    const vf = i => (Array.isArray(vFree) ? vFree[i] : vFree);
    const v = layout.map((p, i) => vf(i)), ct = new Array(n).fill(0);
    for (let q = 0; q < n; q++) {
      const j = proj[q].i, pj = layout[j], Rj = pj.t.D / 2;
      let sum = 0;
      for (let r = 0; r < q; r++) {
        const i = proj[r].i; if (ct[i] <= 0) continue;
        const pi = layout[i], dx = pj.x - pi.x, dy = pj.y - pi.y, x = dx * fx + dy * fy;
        if (x <= 1e-6) continue;
        const lat = Math.abs(dx * fy - dy * fx), Rw = pi.t.D / 2 + k * x;
        const ov = circleOverlap(Rj, Rw, lat) / (Math.PI * Rj * Rj);
        if (ov <= 0) continue;
        const d = jensenDeficit(ct[i], x, pi.t.D, k) * ov;
        sum += d * d;
      }
      v[j] = vf(j) * (1 - Math.sqrt(sum));
      ct[j] = ctAt(pj.t, v[j]);
    }
    return v;
  }

  /** Dizi (string) yerleşimi: her dizi rowDir doğrultusunda düz bir sıra; diziler aralarında rowGap·D. İlk türbin (0,0). */
  function layoutFarm(strings, types, o) {
    const ax = Math.sin(o.rowDir * DEG), ay = Math.cos(o.rowDir * DEG), px = ay, py = -ax;   // diziler sıra ekseninin sağına (saat yönünde 90°) dizilir
    const Dmax = Math.max.apply(null, types.map(t => t.D));
    const out = [];
    strings.forEach((s, si) => {
      const ty = types[s.type] || types[0];
      for (let j = 0; j < s.n; j++) out.push({ s: si, j: j, type: s.type, x: ax * j * o.spacing * ty.D + px * si * o.rowGap * Dmax, y: ay * j * o.spacing * ty.D + py * si * o.rowGap * Dmax });
    });
    return out;
  }

  /* ---------------------------------------------------------------- elektrik: OG toplama ve trafolar */
  /** Al iletken (κ = 35 m/Ω·mm², 20 °C) üç faz kayıp (kW): 3·I²·R. */
  function cableLossKW(P_kW, U_kV, pf, S, L_km) {
    if (P_kW <= 0) return 0;
    const I = P_kW / (Math.sqrt(3) * U_kV * pf), Rc = L_km * 1000 / (35 * S);
    return 3 * I * I * Rc / 1000;
  }
  /**
   * Zincir (daisy-chain) dizi: uzak uçtaki türbinden trafo merkezine doğru her bölüm, kendisinden sonraki türbinlerin
   * toplam gücünü taşır. P: dizideki türbin güçleri (uzak uçtan yakına), segKm: türbinler arası kablo, homeKm: son türbinden TM'ye.
   */
  function stringLoss(P, segKm, homeKm, U_kV, pf, S) {
    let acc = 0, loss = 0;
    for (let j = 0; j < P.length; j++) { acc += P[j]; loss += cableLossKW(acc, U_kV, pf, S, j < P.length - 1 ? segKm : homeKm); }
    return loss;
  }
  /** Trafo kaybı (kW): P0 + Pk·(S/Sn)². Tipik oranlar parametre olarak verilir. */
  function trafoLoss(S_kVA, Sn_kVA, p0pct, pkpct) { return Sn_kVA * (p0pct + pkpct * Math.pow(S_kVA / Sn_kVA, 2)) / 100; }

  /**
   * Anlık park durumu. inp: { types, strings, layout opts, vHubOf(type) → serbest hız, dirDeg, wakeOn, k, U_kV, pf, S, homeKm,
   *   trafo: {p0, pk}, ss: {Sn_kVA, p0, pk}, curtail_kW (0 = yok), stopped(i) → bool }
   */
  function farmState(inp) {
    const lay = layoutFarm(inp.strings, inp.types, inp);
    const tdefs = inp.types.map(ds => turbine(ds, inp.rho));
    const items = lay.map(p => ({ x: p.x, y: p.y, t: tdefs[p.type] || tdefs[0] }));
    // her türbin kendi göbek hızındaki serbest akışı görür; iz açığı oransal uygulanır
    const free = lay.map(p => inp.vHubOf(p.type));
    const vs = inp.wakeOn ? farmSpeeds(items, free, inp.dirDeg, inp.k) : free;
    const tur = lay.map((p, i) => {
      const vFree = free[i], v = vs[i];
      const stop = inp.stopped ? inp.stopped(i, p) : false;
      const pw = R.power(v, items[i].t);
      return { s: p.s, j: p.j, type: p.type, x: p.x, y: p.y, vFree: vFree, v: v, P: stop ? 0 : pw.P * (inp.yawF ? inp.yawF(i) : 1), Pfree: R.power(vFree, items[i].t).P, region: stop ? 'service' : pw.region };
    });
    const strings = inp.strings.map((s, si) => {
      const ts = tur.filter(t => t.s === si);
      const ty = inp.types[s.type] || inp.types[0];
      const P = ts.reduce((a, t) => a + t.P, 0);
      const trL = ts.reduce((a, t) => a + (t.P > 0 ? trafoLoss(t.P / inp.pf, ty.trafoKVA, inp.trafo.p0, inp.trafo.pk) : ty.trafoKVA * inp.trafo.p0 / 100), 0);
      const Pmv = ts.map(t => Math.max(0, t.P - (t.P > 0 ? trafoLoss(t.P / inp.pf, ty.trafoKVA, inp.trafo.p0, inp.trafo.pk) : 0))).reverse();
      const cab = stringLoss(Pmv, inp.spacing * ty.D / 1000, inp.homeKm, inp.U_kV, inp.pf, inp.S);
      const I = P / (Math.sqrt(3) * inp.U_kV * inp.pf);
      return { P: P, trafoLoss: trL, cableLoss: cab, I: I, n: ts.length };
    });
    const Pt = tur.reduce((a, t) => a + t.P, 0), Pfree = tur.reduce((a, t) => a + t.Pfree, 0);
    const lossT = strings.reduce((a, s) => a + s.trafoLoss, 0), lossC = strings.reduce((a, s) => a + s.cableLoss, 0);
    const mv = Math.max(0, Pt - lossT - lossC);
    const ssL = trafoLoss(mv / inp.pf, inp.ss.Sn_kVA, inp.ss.p0, inp.ss.pk);
    const avail = Math.max(0, mv - ssL);
    const poi = inp.curtail_kW > 0 ? Math.min(avail, inp.curtail_kW) : avail;
    return { turbines: tur, strings: strings, Pturb: Pt, Pfree: Pfree, wakeLoss: Pfree > 0 ? 1 - Pt / Pfree : 0, lossTrafo: lossT, lossCable: lossC, lossSS: ssL, available: avail, poi: poi, curtailed: avail - poi, ssLoading: mv / inp.pf / inp.ss.Sn_kVA };
  }

  /**
   * Yıllık üretim (varsayımsal): Weibull hız bölmeleri × tekdüze rüzgâr gülü (nDir yön) × park modeli.
   * inp: farmState girdileri + { meanOf(type) (göbek ort.), kW (Weibull k), avail (0–1), nDir }
   */
  function farmAEP(inp) {
    const nT = inp.strings.reduce((a, s) => a + s.n, 0);
    const nDir = inp.nDir || (nT > 120 ? 4 : nT > 60 ? 8 : 12), step = nT > 120 ? 2 : 1;
    let net = 0, gross = 0, free = 0, curt = 0;
    for (let v = step / 2; v < 32; v += step) {
      for (let d = 0; d < nDir; d++) {
        const dir = d * 360 / nDir;
        // bölme: referans tipin göbek hızı v; diğer tipler kendi ortalamalarına oranla ölçeklenir
        const st = farmState(Object.assign({}, inp, { dirDeg: dir, vHubOf: ty => v * inp.meanOf(ty) / inp.meanOf(0), stopped: null, yawF: null }));
        const f = weibullPdf(v, weibullC(inp.meanOf(0), inp.kW), inp.kW) * step / nDir;
        net += st.poi * f; gross += st.Pturb * f; free += st.Pfree * f; curt += st.curtailed * f;
      }
    }
    const h = 8760 * inp.avail;
    return { net: net * h, gross: gross * h, free: free * 8760, wakeLoss: free > 0 ? 1 - gross / free : 0, elecLoss: gross > 0 ? 1 - (net + curt) / gross : 0, curtailedE: curt * h, nDir: nDir };
  }

  /* ---------------------------------------------------------------- işletme: yaw, cut-out histerezisi, zaman serisi */
  /** Sapma (yaw) hatası kaybı yaklaşımı: P(γ) ≈ P·cos^p(γ). Teorik üst değer p = 3; ölçümler genellikle p ≈ 1,5–2 verir. */
  function yawFactor(gammaDeg, p) { const c = Math.cos(Math.abs(gammaDeg) * DEG); return c <= 0 ? 0 : Math.pow(c, p === undefined ? 2 : p); }
  /** İki yön arasındaki en kısa açı farkı (°, −180…180). */
  function angleDiff(a, b) { return ((a - b) % 360 + 540) % 360 - 180; }
  /**
   * Cut-out histerezisi (örnek ayar): v ≥ cutOut → durur; yeniden devreye girme için v < restart koşulunun en az
   * delay saniye kesintisiz sağlanması gerekir. st: { stopped, below (s) } → yeni durum.
   */
  function cutOutStep(st, v, o, dt) {
    if (v >= o.cutOut) return { stopped: true, below: 0, tripped: !st.stopped };
    if (!st.stopped) return { stopped: false, below: 0, tripped: false };
    const below = v < o.restart ? st.below + dt : 0;
    return below >= (o.delay || 0) ? { stopped: false, below: 0, tripped: false } : { stopped: true, below: below, tripped: false };
  }
  /** Tohumlu, tekrarlanabilir sözde rastgele sayı (mulberry32). */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /**
   * SENTETİK rüzgâr serisi (ölçüm değildir): ortalama + σ·x, σ = TI·ortalama. x = 0,8·hızlı AR(1) (τ = 40 s) +
   * 0,6·yavaş AR(1) (τ = 600 s), birim varyanslı. Aynı tohum aynı seriyi verir.
   */
  function windSeries(o) {
    const r = rng(o.seed), dt = o.dt || 5, n = Math.round((o.minutes || 60) * 60 / dt) + 1, sig = (o.ti || 0.12) * o.mean;
    const g = () => { const u = Math.max(1e-12, r()), w = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
    const p1 = Math.exp(-dt / 40), p2 = Math.exp(-dt / 600);
    let a = g(), b = g();
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(Math.max(0, o.mean + sig * (0.8 * a + 0.6 * b)));
      a = p1 * a + Math.sqrt(1 - p1 * p1) * g(); b = p2 * b + Math.sqrt(1 - p2 * p2) * g();
    }
    return out;
  }
  /** Tek türbinin seri üzerindeki işletmesi: motor güç eğrisi + cut-out histerezisi. Enerji kWh, durma sayısı, duruş dk. */
  function simulateSeries(o) {
    const dt = o.dt || 5, P = [], stopped = [];
    let st = { stopped: false, below: 0 }, e = 0, stops = 0, down = 0;
    o.v.forEach(v => {
      st = cutOutStep(st, v, o, dt);
      if (st.tripped) stops++;
      const p = st.stopped ? 0 : R.power(v, o.t).P * (o.factor === undefined ? 1 : o.factor);
      P.push(p); stopped.push(st.stopped ? 1 : 0);
      if (st.stopped) down += dt;
      e += p * dt / 3600;
    });
    return { P: P, stopped: stopped, energy: e, stops: stops, downMin: down / 60, meanP: o.v.length ? e / (o.v.length * dt / 3600) : 0 };
  }

  /** Sıcaklık/buzlanma koruması (örnek ayarlar): T < Tmin → düşük sıcaklık duruşu; buzlanma riski işaretliyse −5…+2 °C'de buz duruşu. */
  function climateStop(T, Tmin, icing) {
    if (T < Tmin) return { stop: true, reason: 'Düşük sıcaklık sınırı (T < ' + Tmin + ' °C)' };
    if (icing && T >= -5 && T <= 2) return { stop: true, reason: 'Kanat buzlanması algılandı (−5…+2 °C)' };
    return { stop: false, reason: '' };
  }

  return {
    RHO0: RHO0, weibullPdf: weibullPdf, weibullMean: weibullMean, weibullC: weibullC, atHeight: atHeight, densityCorrect: densityCorrect,
    cpFromDatasheet: cpFromDatasheet, turbine: turbine, aFromCp: aFromCp, ctFromCp: ctFromCp, ctAt: ctAt, jensenDeficit: jensenDeficit,
    circleOverlap: circleOverlap, farmSpeeds: farmSpeeds, layoutFarm: layoutFarm, cableLossKW: cableLossKW, stringLoss: stringLoss, trafoLoss: trafoLoss,
    farmState: farmState, farmAEP: farmAEP, yawFactor: yawFactor, angleDiff: angleDiff, cutOutStep: cutOutStep, rng: rng, windSeries: windSeries,
    simulateSeries: simulateSeries, climateStop: climateStop
  };
});
