/* VoltSim · sarj ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.sarj, Node'da require() ile kullanılır; testleri tools/tests/voltsim-sarj.test.cjs.
 *
 * İçerik: şarj merkezi (hub) dakikalık zaman simülasyonu — araç başına farklı batarya/SOC/kabul gücü, önceliğe göre
 * dinamik yük paylaşımı (AC'de IEC 61851-1 en küçük pilot akımı 6 A), bina baz yükü, çatı GES'i (motorun güneş
 * konumu/açık gök modeliyle), batarya tamponu (tepe tıraşlama), üç zamanlı tarife ile maliyet; nokta başına besleme
 * devresi (koruma, kablo Iz, gerilim düşümü, RCD tipi) kontrolü. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.sarj = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const SJ = E.sarj;
  const U_PH = 230, U_LL = 400, KAPPA_CU = 56, X_PER_M = 0.08e-3;

  /** IEC 61851-1: kontrol pilotu PWM ile bildirilebilen en küçük AC şarj akımı 6 A'dir; altına inilemez, oturum duraklatılır. */
  const AC_MIN_A = 6;
  function acMinKW(phases) { return phases * U_PH * AC_MIN_A / 1000; }

  /**
   * Önceliğe göre yük paylaşımı.
   * reqs: [{ demand (kW), min (kW, oturum açıkken verilmesi gereken en küçük güç), priority (büyük = önce) }]
   * 1) En küçük güçler önceliğe (eşitlikte sıraya) göre kabul edilir; sığmayan oturum duraklatılır (0 kW).
   * 2) Kalan güç öncelik kademesi sırasıyla, kademe içinde eşit "su doldurma" ile talebe kadar dağıtılır.
   * Dönüş: { alloc: [kW], paused: [bool], unused: kW }
   */
  function allocate(reqs, available) {
    const n = reqs.length, alloc = new Array(n).fill(0), paused = new Array(n).fill(false);
    let left = Math.max(0, available);
    const act = [];
    for (let i = 0; i < n; i++) if (reqs[i].demand > 1e-9) act.push(i);
    act.sort((a, b) => (reqs[b].priority || 0) - (reqs[a].priority || 0) || a - b);
    const acc = [];
    act.forEach(i => {
      const m = Math.min(reqs[i].min || 0, reqs[i].demand);
      if (m <= left + 1e-9) { alloc[i] = m; left -= m; acc.push(i); } else paused[i] = true;
    });
    const tiers = [];
    acc.forEach(i => { const p = reqs[i].priority || 0; let t = tiers.find(x => x.p === p); if (!t) tiers.push(t = { p: p, m: [] }); t.m.push(i); });
    tiers.sort((a, b) => b.p - a.p);
    tiers.forEach(t => {
      let open = t.m.filter(i => reqs[i].demand - alloc[i] > 1e-9);
      while (open.length && left > 1e-9) {
        const each = left / open.length, next = [];
        open.forEach(i => { const g = Math.min(reqs[i].demand - alloc[i], each); alloc[i] += g; left -= g; if (reqs[i].demand - alloc[i] > 1e-9) next.push(i); });
        if (next.length === open.length) break;
        open = next;
      }
    });
    return { alloc: alloc, paused: paused, unused: Math.max(0, left) };
  }

  /** Bina baz yükü profilleri: saatlik oran (0–1) × tepe yük. Temsili profiller; ölçüm varsa ölçüm kullanılmalıdır. */
  const BASE_PROFILES = {
    none: { name: 'Yok (yalnız şarj)', h: new Array(24).fill(0) },
    office: { name: 'Ofis (08–18)', h: [0.22, 0.2, 0.2, 0.2, 0.2, 0.22, 0.3, 0.5, 0.8, 0.95, 1, 1, 0.9, 0.95, 1, 0.95, 0.85, 0.6, 0.4, 0.3, 0.27, 0.25, 0.23, 0.22] },
    retail: { name: 'AVM / mağaza (10–22)', h: [0.3, 0.28, 0.27, 0.27, 0.27, 0.28, 0.3, 0.35, 0.5, 0.75, 0.9, 0.95, 1, 1, 1, 1, 0.98, 0.97, 0.97, 0.95, 0.92, 0.8, 0.5, 0.35] },
    factory: { name: 'Fabrika (2 vardiya 06–22)', h: [0.35, 0.35, 0.35, 0.35, 0.35, 0.4, 0.9, 0.95, 1, 1, 1, 0.95, 0.85, 1, 1, 1, 0.95, 0.95, 0.95, 0.95, 0.9, 0.85, 0.45, 0.38] },
    residential: { name: 'Konut sitesi (akşam tepesi)', h: [0.35, 0.3, 0.28, 0.27, 0.27, 0.3, 0.45, 0.6, 0.5, 0.4, 0.38, 0.4, 0.42, 0.4, 0.4, 0.45, 0.55, 0.75, 0.95, 1, 0.95, 0.8, 0.6, 0.45] }
  };
  function baseLoadAt(profile, hour, peakKW) {
    const p = (BASE_PROFILES[profile] || BASE_PROFILES.none).h;
    const h = ((hour % 24) + 24) % 24, i = Math.floor(h), f = h - i;
    return peakKW * (p[i] + (p[(i + 1) % 24] - p[i]) * f);
  }

  /** Üç zamanlı tarife dilimleri (Türkiye): gündüz 06–17, puant 17–22, gece 22–06. */
  function touPeriod(hour) { const h = ((hour % 24) + 24) % 24; return h >= 6 && h < 17 ? 'day' : h >= 17 && h < 22 ? 'peak' : 'night'; }
  function priceAt(hour, tariff) {
    if (!tariff || tariff.mode !== 'tou') return tariff ? tariff.single : 0;
    return tariff[touPeriod(hour)];
  }

  /** Çatı GES çıkışı (kW): motorun güneş konumu ve açık gök modeli; eğim 20°, güneye, performans oranı 0,80. Temsili açık gün. */
  function pvAt(kWp, hour, doy, lat, lon) {
    if (!(kWp > 0)) return 0;
    const sun = E.ges.sunPosition(lat === undefined ? 39.9 : lat, lon === undefined ? 32.85 : lon, doy || 172, hour, 3);
    if (sun.elevation <= 0) return 0;
    const cs = E.ges.clearSky(sun.elevation), b = 20 * Math.PI / 180;
    const poa = cs.DNI * Math.max(0, E.ges.incidenceCos(sun, 20, 0)) + cs.DHI * (1 + Math.cos(b)) / 2 + cs.GHI * 0.2 * (1 - Math.cos(b)) / 2;
    return kWp * poa / 1000 * 0.8;
  }

  /** Bir noktanın şebeke tarafı talebi (kW) — motorun sarj modeliyle aynı kurallar. */
  function pointDemand(pt, soc, curve) {
    const prof = SJ.PROFILES[pt.profile] || SJ.PROFILES.AC11;
    if (prof.kind === 'AC') {
      const ac = SJ.acPower(prof, { obcPhases: pt.obcPhases, obcI: pt.obcI });
      return { P: soc >= 0.97 && curve === 'typical' ? ac.P * 0.5 : ac.P, min: acMinKW(ac.phases), kind: 'AC', phases: ac.phases, I: ac.I };
    }
    const evLim = pt.dcMax * (curve === 'typical' ? SJ.dcCurveFactor(soc) : 1);
    return { P: Math.min(pt.stationP || prof.P, evLim) / pt.eff, min: 0, kind: 'DC' };
  }

  /**
   * Şarj merkezi zaman simülasyonu (adım dt dk, en çok maxMin dk).
   * inp.points: [{ profile, stationP, capacity, soc0, soc1 (%), obcPhases, obcI, dcMax, eff (0–1), priority, active (bool), compatible (bool) }]
   * inp: siteKW (bağlantı/trafo sınırı), dlm (yük yönetimi), base {profile, peakKW}, pv {kWp, doy}, bat {kWh, kW, soc0 (%)},
   *      startHour, curve, tariff, dt, maxMin
   * Dönüş: t, grid, base, pv, bat (+deşarj/−şarj), chargers, P[i][], soc[i][], points[{finishMin, Egrid, Ebatt, cost, pausedMin}], özet.
   */
  function simulateHub(inp) {
    const pts = inp.points || [], n = pts.length, dt = inp.dt || 1, maxMin = inp.maxMin || 1440;
    const curve = inp.curve === 'constant' ? 'constant' : 'typical';
    const soc = pts.map(p => p.soc0 / 100), tgt = pts.map(p => p.soc1 / 100);
    const res = { t: [], grid: [], base: [], pv: [], bat: [], chargers: [], P: pts.map(() => []), soc: pts.map(() => []), paused: pts.map(() => []) };
    const pr = pts.map(() => ({ finishMin: null, Egrid: 0, Ebatt: 0, cost: 0, pausedMin: 0 }));
    const bat = inp.bat && inp.bat.kWh > 0 ? { E: inp.bat.kWh * (inp.bat.soc0 === undefined ? 90 : inp.bat.soc0) / 100, max: inp.bat.kWh * 0.95, min: inp.bat.kWh * 0.1, kW: inp.bat.kW || 0 } : null;
    let t = 0, gridE = 0, peak = 0, peakAt = 0, overMin = 0, pvE = 0, batOut = 0;
    const live = i => pts[i].active && pts[i].compatible !== false && soc[i] < tgt[i] - 1e-9;
    for (let k = 0; k <= maxMin / dt; k++) {
      const hour = (inp.startHour || 0) + t / 60;
      const base = inp.base ? baseLoadAt(inp.base.profile, hour, inp.base.peakKW || 0) : 0;
      const pv = inp.pv ? pvAt(inp.pv.kWp, hour, inp.pv.doy) : 0;
      const dem = pts.map((p, i) => (live(i) ? pointDemand(p, soc[i], curve) : { P: 0, min: 0 }));
      const want = dem.reduce((a, d) => a + d.P, 0);
      // batarya: önce PV ve şebeke sınırına göre ne kadar destek verebileceği
      const headroom = inp.siteKW - base + pv;              // şarja ayrılabilecek güç (batarya hariç)
      const batCan = bat ? Math.min(bat.kW, Math.max(0, (bat.E - bat.min) * 60 / dt)) : 0;
      let alloc;
      if (inp.dlm) {
        const a = allocate(dem.map((d, i) => ({ demand: d.P, min: d.min, priority: pts[i].priority })), Math.max(0, headroom) + batCan);
        alloc = a.alloc; a.paused.forEach((ps, i) => { if (ps) { pr[i].pausedMin += dt; } res.paused[i].push(ps ? 1 : 0); });
      } else { alloc = dem.map(d => d.P); pts.forEach((p, i) => res.paused[i].push(0)); }
      const chg = alloc.reduce((a, b) => a + b, 0);
      // batarya dağıtımı: şarj talebi bağlantı payını aşarsa deşarj; PV fazlası varsa şarj
      let bp = 0;
      if (bat) {
        const deficit = chg + base - pv - inp.siteKW;
        if (deficit > 1e-9) bp = Math.min(deficit, batCan);
        else if (pv > base + chg) bp = -Math.min(bat.kW, pv - base - chg, Math.max(0, (bat.max - bat.E) * 60 / dt / 0.92));
        bat.E -= (bp > 0 ? bp : bp * 0.92) * dt / 60;
      }
      const grid = Math.max(0, base + chg - pv - bp);   // ihracat yok kabulü (fazla PV kırpılır)
      res.t.push(t); res.grid.push(grid); res.base.push(base); res.pv.push(pv); res.bat.push(bp); res.chargers.push(chg);
      if (grid > peak + 1e-9) { peak = grid; peakAt = t; }
      if (grid > inp.siteKW + 1e-6) overMin += dt;
      const price = priceAt(hour, inp.tariff);
      // şarj enerjisinin şebekeden gelen payı (PV/bataryadan karşılanan kısım ücretsiz kabul)
      const gridShare = chg > 1e-9 ? Math.max(0, Math.min(1, (grid - Math.max(0, base - pv)) / chg)) : 0;
      pts.forEach((p, i) => {
        res.P[i].push(alloc[i]); res.soc[i].push(soc[i] * 100);
        if (alloc[i] <= 1e-9) return;
        const eff = p.eff, Pb = alloc[i] * eff;
        let step = dt, dE = Pb * dt / 60;
        if (soc[i] + dE / p.capacity > tgt[i]) { dE = (tgt[i] - soc[i]) * p.capacity; step = dE / Pb * 60; }
        soc[i] += dE / p.capacity;
        const eg = alloc[i] * step / 60;
        pr[i].Egrid += eg; pr[i].Ebatt += dE; pr[i].cost += eg * gridShare * price;
        if (soc[i] >= tgt[i] - 1e-9 && pr[i].finishMin === null) pr[i].finishMin = t + step;
      });
      gridE += grid * dt / 60; pvE += pv * dt / 60; batOut += Math.max(0, bp) * dt / 60;
      if (!pts.some((p, i) => live(i))) break;
      t += dt;
      void want;
    }
    const finishes = pr.filter((p, i) => pts[i].active && pts[i].compatible !== false).map(p => p.finishMin);
    return Object.assign(res, {
      points: pr, minutes: t, peak: peak, peakAt: peakAt, overMin: overMin, gridE: gridE, pvE: pvE, batOut: batOut,
      chargeE: pr.reduce((a, p) => a + p.Egrid, 0), cost: pr.reduce((a, p) => a + p.cost, 0),
      allDone: finishes.length ? finishes.every(f => f !== null) : true,
      lastFinish: finishes.length && finishes.every(f => f !== null) ? Math.max.apply(null, finishes) : null,
      batEnd: bat ? bat.E : null
    });
  }

  /**
   * Nokta besleme devresi: Ib, Iz, koruma koordinasyonu (Ib ≤ In ≤ Iz), gerilim düşümü (Cu, cosφ ≈ 1), RCD uygunluğu.
   * c: { profile, stationP, eff, prot ('MCB'|'MCCB'), In, S, L, method, rcd ('A'|'A-RDCDD'|'B'|'none') }
   */
  function circuit(c) {
    const prof = SJ.PROFILES[c.profile] || SJ.PROFILES.AC11;
    let Ib, phases;
    if (prof.kind === 'AC') { phases = prof.phases; Ib = prof.I; }
    else { phases = 3; Ib = (c.stationP || prof.P) * 1000 / (c.eff || 0.94) / (Math.sqrt(3) * U_LL * 0.99); }
    const Iz = E.cableIz(c.S, c.method || 'C', phases === 1 ? 2 : 3);
    const R = c.L / (KAPPA_CU * c.S), X = X_PER_M * c.L;
    const vd = phases === 1 ? 2 * Ib * R / U_PH * 100 : Math.sqrt(3) * Ib * (R * 1 + X * 0) / U_LL * 100;
    const coord = Ib <= c.In + 1e-9 && c.In <= Iz + 1e-9;   // tablo dışı kesitte Iz = NaN → coord false (izTable ile ayrıca bildirilir)
    const rcdOk = prof.kind === 'DC' ? c.rcd !== 'none' : c.rcd === 'A-RDCDD' || c.rcd === 'B';
    return { kind: prof.kind, phases: phases, Ib: Ib, Iz: Iz, vd: vd, coord: coord, izTable: isFinite(Iz), rcdOk: rcdOk, R: R, lossW: (phases === 1 ? 2 : 3) * Ib * Ib * R };
  }

  return { AC_MIN_A: AC_MIN_A, acMinKW: acMinKW, allocate: allocate, BASE_PROFILES: BASE_PROFILES, baseLoadAt: baseLoadAt, touPeriod: touPeriod, priceAt: priceAt, pvAt: pvAt, pointDemand: pointDemand, simulateHub: simulateHub, circuit: circuit };
});
