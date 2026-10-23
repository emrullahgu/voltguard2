/* VoltSim · ges ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.ges, Node'da require() ile kullanılır; testleri tools/tests/voltsim-ges.test.cjs.
 * İçerik: dizi yerleşimi ve string/MPPT ataması, geometrik engel gölgesi (ışın–kutu kesişimi), bifasiyal kazanç,
 * kayıp birleştirme, inverter filosu, string sigortası / DC SPD / AC kesici kontrolleri, ihracat sınırlayıcı kırpması,
 * ay × saat üretim matrisi (motor çağrılarıyla). */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.ges = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => { v = Number(v); return isFinite(v) ? v : d; };

  /** Örnek inverter veri sayfaları (marka içermez; değerler tipik sınıf değerleridir, projede üretici verisi girilir). */
  const INVERTERS = {
    i20: { name: '20 kW · 2 MPPT (örnek)', Pac: 20, vdcMax: 1100, mpptMin: 180, mpptMax: 1000, nMppt: 2, inPerMppt: 2, iscMppt: 40, invEff: 98.0 },
    i50: { name: '50 kW · 4 MPPT (örnek)', Pac: 50, vdcMax: 1100, mpptMin: 200, mpptMax: 1000, nMppt: 4, inPerMppt: 2, iscMppt: 40, invEff: 98.4 },
    i80: { name: '80 kW · 6 MPPT (örnek)', Pac: 80, vdcMax: 1100, mpptMin: 200, mpptMax: 1000, nMppt: 6, inPerMppt: 2, iscMppt: 40, invEff: 98.5 },
    i110: { name: '110 kW · 10 MPPT (örnek)', Pac: 110, vdcMax: 1100, mpptMin: 200, mpptMax: 1000, nMppt: 10, inPerMppt: 2, iscMppt: 40, invEff: 98.6 },
    i250: { name: '250 kW · 1500 V · 12 MPPT (örnek)', Pac: 250, vdcMax: 1500, mpptMin: 500, mpptMax: 1500, nMppt: 12, inPerMppt: 2, iscMppt: 60, invEff: 99.0 }
  };
  /** Örnek modül veri sayfaları. fuseMax: modül maksimum seri sigorta değeri (A); bifi: bifasiyallik katsayısı. */
  const MODULES = {
    m540: { name: '540 Wp mono, tek yüzlü (örnek)', Pmod: 540, Voc: 49.6, Vmp: 41.6, Isc: 13.9, betaVoc: -0.27, betaVmp: -0.35, gamma: -0.35, noct: 45, moduleLen: 2.28, moduleW: 1.134, fuseMax: 25, bifacial: false, bifi: 0.7 },
    m580: { name: '580 Wp çift yüzlü, cam–cam (örnek)', Pmod: 580, Voc: 52.0, Vmp: 43.4, Isc: 14.2, betaVoc: -0.25, betaVmp: -0.29, gamma: -0.29, noct: 43, moduleLen: 2.278, moduleW: 1.134, fuseMax: 30, bifacial: true, bifi: 0.8 },
    m410: { name: '410 Wp mono, 1,72 m (örnek)', Pmod: 410, Voc: 37.8, Vmp: 31.6, Isc: 13.8, betaVoc: -0.28, betaVmp: -0.36, gamma: -0.35, noct: 45, moduleLen: 1.722, moduleW: 1.134, fuseMax: 25, bifacial: false, bifi: 0.7 }
  };
  const FUSES_DC = [10, 12, 15, 16, 20, 25, 30, 32, 35, 40];
  const BREAKERS = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630];

  /** İki kaybın çarpımsal birleşimi (%): 1 − (1 − a)(1 − b). */
  function combineLoss(aPct, bPct) { return 100 * (1 - (1 - num(aPct, 0) / 100) * (1 - num(bPct, 0) / 100)); }

  /** Bifasiyal arka yüz kazancı (oran). Basit görünüm katsayısı modeli: kazanç = φ·ρ·F; F çatı üstü eğik sıralar için ≈ 0,35
   * (arka yüzün zemini görme ve sıra gölgesi kaybı birlikte), açık zeminde daha büyüktür. Ön değerlendirme içindir. */
  function bifacialGain(bifi, albedo, F) { return clamp(num(bifi, 0), 0, 1) * clamp(num(albedo, 0), 0, 1) * (F === undefined ? 0.35 : F); }

  /** Inverter filosu ve string/MPPT ataması. Stringler sırayla bitişik bloklar hâlinde MPPT'lere dağıtılır. */
  function stringPlan(p) {
    const nMod = Math.max(0, Math.round(num(p.nMod, 0))), Ns = Math.max(1, Math.round(num(p.perString, 1)));
    const nInv = Math.max(1, Math.round(num(p.nInv, 1))), nMppt = Math.max(1, Math.round(num(p.nMppt, 1))), inPer = Math.max(1, Math.round(num(p.inPerMppt, 1)));
    const nStrings = Math.floor(nMod / Ns), M = nInv * nMppt;
    const strings = [];
    const perMppt = new Array(M).fill(0);
    for (let i = 0; i < nStrings; i++) { const m = Math.min(M - 1, Math.floor(i * M / Math.max(nStrings, 1))); strings.push({ mppt: m, inv: Math.floor(m / nMppt) }); perMppt[m]++; }
    const maxPer = perMppt.reduce((a, b) => Math.max(a, b), 0);
    return { nStrings: nStrings, spare: nMod - nStrings * Ns, M: M, strings: strings, perMppt: perMppt, maxPerMppt: maxPer, inputs: M * inPer, overInputs: maxPer > inPer, nInv: nInv, nMppt: nMppt };
  }

  /** DC ayırıcısı açık inverterlerin stringleri devre dışı: etkin modül sayısı ve AC gücü. */
  function activeFleet(plan, perString, invOff, PacUnit) {
    const off = new Set((invOff || []).map(Number).filter(i => i >= 0 && i < plan.nInv));
    let offStrings = 0; plan.strings.forEach(st => { if (off.has(st.inv)) offStrings++; });
    const onInv = plan.nInv - off.size;
    return { offInv: off.size, onInv: onInv, offStrings: offStrings, offModules: offStrings * perString, PacActive: onInv * PacUnit };
  }

  /** MPPT çalışma noktası (yaklaşık): V = Ns·Vmp·[1 + βVmp·(Tc − 25)], I = n·(Pmod/Vmp)·G/1000. */
  function mpptPoint(p, G, Tc, nStr) {
    const V = p.perString * p.Vmp * (1 + p.betaVmp / 100 * (Tc - 25));
    const I = nStr * (p.Pmod / p.Vmp) * Math.max(0, G) / 1000;
    return { V: V, I: I, P: V * I, inWindow: V >= p.mpptMin && V <= p.mpptMax };
  }

  /** Dizi yerleşimi (dizi yerel koordinatı: +x doğu, +z panel yönü, y çatı referansından yukarı).
   * roof 'flat': balastlı eğik sıralar; 'trapez': trapez sac çatıda eğime paralel, bitişik sıralar (sıra gölgesi yok). */
  function arrayLayout(p) {
    const roof = p.roof === 'trapez' ? 'trapez' : 'flat';
    const t = clamp(num(p.tilt, 15), 0, 60) * DEG, L = clamp(num(p.moduleLen, 2.28), 0.5, 3), Wm = clamp(num(p.moduleW, 1.134), 0.5, 2);
    const n = Math.max(1, Math.round(num(p.nMod, 1))), rows = clamp(Math.round(num(p.rows, 1)), 1, n);
    const perRow = Math.ceil(n / rows), step = Wm + 0.02;
    const dproj = L * Math.cos(t), rise = L * Math.sin(t), H0 = roof === 'flat' ? 0.35 : 0.12;
    const pitchV = roof === 'flat' ? Math.max(num(p.pitch, 0), dproj + 0.15) : (L + 0.02) * Math.cos(t);
    const rowLen = perRow * step;
    const arrD = (rows - 1) * pitchV + dproj;
    const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n), row = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / perRow), j = i - r * perRow;
      const zc = -arrD / 2 + dproj / 2 + r * pitchV;
      xs[i] = -rowLen / 2 + step * (j + 0.5); zs[i] = zc; row[i] = r;
      ys[i] = roof === 'flat' ? H0 + rise / 2 : roofY({ roof: roof, t: t, arrD: arrD }, zc) + H0;
    }
    return { roof: roof, n: n, rows: rows, perRow: perRow, t: t, L: L, Wm: Wm, step: step, dproj: dproj, rise: rise, H0: H0, pitchV: pitchV, rowLen: rowLen, arrD: arrD, xs: xs, ys: ys, zs: zs, row: row };
  }
  /** Çatı yüzeyi yüksekliği (dizi yerel). Trapez çatıda saçak dizinin güney kenarındadır. */
  function roofY(ly, z) { return ly.roof === 'trapez' ? Math.max(0, (ly.arrD / 2 - z) * Math.tan(ly.t)) : 0; }

  /** Güneş yön vektörü, dizinin yerel koordinatında. Motor azimutu: güneyden, batı pozitif. */
  function sunLocal(sun, arrayAz) {
    const el = num(sun.elevation, 0) * DEG, a = (num(sun.azimuth, 0) - num(arrayAz, 0)) * DEG;
    return { x: -Math.sin(a) * Math.cos(el), y: Math.sin(el), z: Math.cos(a) * Math.cos(el) };
  }

  function rayBox(px, py, pz, d, b) {
    let tmin = -Infinity, tmax = Infinity;
    const ax = [[px, d.x, b.x0, b.x1], [py, d.y, b.y0, b.y1], [pz, d.z, b.z0, b.z1]];
    for (let i = 0; i < 3; i++) {
      const o = ax[i][0], dd = ax[i][1], lo = ax[i][2], hi = ax[i][3];
      if (Math.abs(dd) < 1e-12) { if (o < lo || o > hi) return false; continue; }
      let t1 = (lo - o) / dd, t2 = (hi - o) / dd; if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return false;
    }
    return tmax > 0;
  }
  /** Engel kutusu (dizi yerel): x, z merkez; w (x), d (z), h yükseklik; taban çatı yüzeyinde. */
  function obstacleBox(ly, o) {
    const y0 = roofY(ly, num(o.z, 0));
    return { x0: o.x - o.w / 2, x1: o.x + o.w / 2, z0: o.z - o.d / 2, z1: o.z + o.d / 2, y0: y0, y1: y0 + Math.max(0.1, num(o.h, 1)) };
  }
  /** Engel gölgesi: her modülde nu × nv nokta, güneşe doğru ışın engel kutusunu keserse gölgede.
   * Dönüş: dizi geneli direkt ışınım gölge oranı, modül başına oran ve engelle çakışan modüller. */
  function obstacleShade(ly, o, sunVec, nu, nv) {
    nu = nu || 3; nv = nv || 5;
    const per = new Float32Array(ly.n), clash = [];
    if (!o) return { frac: 0, per: per, clash: clash };
    const b = obstacleBox(ly, o);
    const ct = Math.cos(ly.t), st = Math.sin(ly.t);
    let tot = 0;
    for (let i = 0; i < ly.n; i++) {
      const cx = ly.xs[i], cy = ly.ys[i], cz = ly.zs[i];
      if (cx > b.x0 - ly.Wm / 2 && cx < b.x1 + ly.Wm / 2 && cz > b.z0 - ly.dproj / 2 && cz < b.z1 + ly.dproj / 2 && b.y1 > cy - ly.rise / 2) { per[i] = 1; clash.push(i); tot += 1; continue; }
      if (sunVec.y <= 0) continue;
      let hit = 0;
      for (let a = 0; a < nu; a++) for (let c = 0; c < nv; c++) {
        const u = ((a + 0.5) / nu - 0.5) * ly.Wm, v = ((c + 0.5) / nv - 0.5) * ly.L;
        // modül düzlemi: eğim yönünde aşağı (güney) vektörü (0, −sinβ, cosβ)
        if (rayBox(cx + u, cy - v * st + 0.03, cz + v * ct, sunVec, b)) hit++;
      }
      per[i] = hit / (nu * nv); tot += per[i];
    }
    return { frac: tot / ly.n, per: per, clash: clash };
  }

  /** IEC 62548-1 string sigortası: Np ≥ 3 ve (Np − 1)·1,25·Isc > modül maks. seri sigorta değeri ise gerekli;
   * anma 1,5·Isc ≤ In ≤ 2,4·Isc ve In ≤ modül maks. seri sigorta değeri. */
  function stringFuse(Isc, Np, fuseMax, fuseIn) {
    const reverse = (Np - 1) * 1.25 * Isc;
    const needed = Np >= 3 && reverse > fuseMax;
    const lo = 1.5 * Isc, hi = Math.min(2.4 * Isc, fuseMax);
    const suggest = FUSES_DC.find(f => f >= lo && f <= hi) || null;
    const has = num(fuseIn, 0) > 0;
    const inRange = has && fuseIn >= lo - 1e-9 && fuseIn <= hi + 1e-9;
    return { needed: needed, reverse: reverse, lo: lo, hi: hi, suggest: suggest, ok: needed ? inRange : (!has || inRange) };
  }
  /** DC SPD (Tip 2): Ucpv ≥ soğukta string Voc olmalı. */
  function spdCheck(Ucpv, vocCold) { return { ok: num(Ucpv, 0) >= vocCold, margin: num(Ucpv, 0) - vocCold }; }
  /** İnverter AC çıkış kesicisi (tipik seçim In ≥ 1,25·Iac, standart değer) — üretici önerisi esastır. */
  function acBreaker(PacUnit_kW, U_LL, In) {
    const Iac = E.currentFromS(PacUnit_kW * 1000, U_LL || 400);
    const need = 1.25 * Iac;
    const suggest = BREAKERS.find(b => b >= need) || null;
    return { Iac: Iac, need: need, suggest: suggest, ok: num(In, 0) >= need };
  }

  /** Profil ağırlığına göre iş günü saatlik yük (kW), motorun öz tüketim yaklaşımıyla aynı ölçek. */
  function loadAt(profile, consumption, h) {
    const pr = E.ges.PROFILES[profile] || E.ges.PROFILES.tek;
    let w = 0; for (let k = 0; k < 24; k++) w += pr.w(k + 0.5);
    return consumption / 365 / w * pr.w(h);
  }
  /** Sıfır ihracat / ihracat sınırlayıcı: P_izin = yük + sınır. Günlük kırpılan enerji (kWh) temsilî gün eğrisinden. */
  function exportLimit(pts, profile, consumption, limitKW) {
    let cut = 0, maxCut = 0;
    const out = pts.map(p => { const allow = loadAt(profile, consumption, p.t) + limitKW; const c = Math.max(0, p.Pac - allow); cut += c / 6; maxCut = Math.max(maxCut, c); return [p.t, Math.min(p.Pac, allow)]; });
    return { cutKWh: cut, maxCutKW: maxCut, curve: out };
  }

  /** Ay × saat (05–20) AC güç matrisi (kW); her ay için motorun temsilî gün eğrisi. */
  function monthHour(input) {
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const r = E.ges.compute(Object.assign({}, input, { month: m }));
      const pts = r.ok ? r.values.today.pts : [];
      const row = [];
      for (let h = 5; h <= 20; h++) { const p = pts.find(q => Math.abs(q.t - h) < 1e-6) || pts.reduce((a, q) => (Math.abs(q.t - h) < Math.abs(a.t - h) ? q : a), { t: -99, Pac: 0 }); row.push(p.Pac); }
      rows.push(row);
    }
    return rows;
  }

  return { INVERTERS: INVERTERS, MODULES: MODULES, FUSES_DC: FUSES_DC, BREAKERS: BREAKERS, combineLoss: combineLoss, bifacialGain: bifacialGain, stringPlan: stringPlan, activeFleet: activeFleet, mpptPoint: mpptPoint, arrayLayout: arrayLayout, roofY: roofY, sunLocal: sunLocal, rayBox: rayBox, obstacleBox: obstacleBox, obstacleShade: obstacleShade, stringFuse: stringFuse, spdCheck: spdCheck, acBreaker: acBreaker, loadAt: loadAt, exportLimit: exportLimit, monthHour: monthHour };
});
