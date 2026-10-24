/* VoltSim · depolama ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.depolama, Node'da require() ile kullanılır; testleri tools/tests/voltsim-depolama.test.cjs.
 * İçerik: 24 saatlik fabrika yük profilleri, saatlik GES üretimi (engine.ges.compute temsilî gün eğrisinden; GES modeli
 * yeniden yazılmaz), küçük RES üretimi (engine.res.power güç eğrisi), dizel jeneratör yakıt eğrisi, LiFePO4 batarya
 * (kapasite, güç, DoD, çevrim verimi, C-oranı) ile saatlik enerji dağıtımı (öz tüketim, tepe tıraşlama, yedek rezerv,
 * zaman tarifesi) ve günlük göstergeler (öz yeterlilik, tepe azaltımı, eşdeğer çevrim, maliyet).
 * Bütün enerji büyüklükleri 1 saatlik adımda kWh'tir (1 saatlik ortalama güç kW ile sayıca eşittir). */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.depolama = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sum = a => a.reduce((s, x) => s + x, 0);
  const max = a => a.reduce((m, x) => (x > m ? x : m), 0);
  const H = 24;

  /* ---------------------------------------------------------------- tarife dönemleri
   * Üç zamanlı tarife dönemleri: gündüz 06:00–17:00, puant 17:00–22:00, gece 22:00–06:00. Birim fiyatlar kullanıcı girdisidir. */
  function period(h) { h = ((Math.floor(h) % 24) + 24) % 24; return h >= 6 && h < 17 ? 'gunduz' : h >= 17 && h < 22 ? 'puant' : 'gece'; }
  const PERIOD_NAME = { gunduz: 'Gündüz', puant: 'Puant', gece: 'Gece' };

  /* ---------------------------------------------------------------- yük profilleri
   * Şekil katsayıları (0–1) saat [h, h+1) için; yük(h) = taban + (tepe − taban)·şekil[h]. Temsilîdir; ölçülen profil girilebilir. */
  const LOAD_SHAPES = {
    tek: { name: 'Tek vardiya (08–17)', s: [0, 0, 0, 0, 0, 0, 0, 0.35, 1, 1, 1, 1, 0.7, 1, 1, 1, 1, 0.35, 0, 0, 0, 0, 0, 0] },
    iki: { name: 'İki vardiya (06–22)', s: [0, 0, 0, 0, 0, 0.3, 1, 1, 1, 1, 1, 1, 0.8, 1, 0.85, 1, 1, 1, 0.8, 1, 1, 1, 0.3, 0] },
    uc: { name: 'Üç vardiya (7/24)', s: [0.9, 0.9, 0.85, 0.85, 0.85, 0.9, 0.8, 1, 1, 1, 1, 1, 0.85, 1, 0.8, 1, 1, 1, 1, 0.9, 0.9, 0.9, 0.8, 0.9] },
    kesikli: { name: 'Kesikli üretim (pres/fırın tepeleri)', s: [0, 0, 0, 0, 0, 0, 0, 0.4, 0.7, 1, 0.95, 0.6, 0.4, 0.7, 1, 0.9, 0.6, 0.3, 0, 0, 0, 0, 0, 0] }
  };
  function loadProfile(preset, peak, base, custom) {
    if (preset === 'ozel') {
      if (!Array.isArray(custom) || custom.length !== H) throw new Error('Özel profil için 24 saatlik kW değeri gerekir.');
      return custom.map(x => Math.max(0, Number(x) || 0));
    }
    const sh = (LOAD_SHAPES[preset] || LOAD_SHAPES.tek).s;
    return sh.map(k => base + (peak - base) * k);
  }
  /** “120; 130; …” biçimindeki 24 değeri ayrıştırır (ondalık virgül ya da nokta). */
  function parseProfile(txt) {
    const parts = String(txt || '').trim().split(/[\s;]+/).filter(Boolean);
    const vals = parts.map(p => Number(p.replace(',', '.')));
    if (vals.length !== H || vals.some(x => !isFinite(x) || x < 0 || x > 1e5)) throw new Error('24 saatlik değer girin (kW, 0–100 000); ayırıcı boşluk ya da noktalı virgül.');
    return vals;
  }

  /* ---------------------------------------------------------------- GES (engine.ges yeniden kullanılır)
   * engine.ges.compute temsilî gün eğrisini 10 dk adımla (04:00–21:00) verir; saatlik enerji bu dikdörtgenlerin toplamıdır,
   * dolayısıyla 24 saatin toplamı motorun günlük AC üretimine (today.Eac) eşittir. Modül tipi örnek 540 Wp değerleridir;
   * yalnız ışınım, sıcaklık, inverter kırpması ve kayıplar kullanılır (string kontrolleri bu modülün konusu değildir). */
  function gesInput(o) {
    const nMod = Math.max(1, Math.round(o.kWp * 1000 / 540));
    return { lat: o.lat, lon: o.lon, tilt: o.tilt, azimuth: o.azimuth, Pmod: o.kWp * 1000 / nMod, nMod: nMod, perString: 18, stringsPerMppt: 1,
      Voc: 49.6, Vmp: 41.6, Isc: 13.9, betaVoc: -0.27, betaVmp: -0.35, gamma: -0.35, noct: 45, Pac: o.acKW, vdcMax: 1100, mpptMin: 200, mpptMax: 1000,
      iscMppt: 40, invEff: 98, dcLoss: o.dcLoss === undefined ? 14 : o.dcLoss, albedo: 0.2, cloud: o.cloud, moduleLen: 2.28, pitch: 0, roofArea: 0, rows: 1,
      month: o.month, hour: 12, Ta: o.Ta, Tmin: -5, Tmax: 38, price: 0, exportPrice: 0, capex: 0, consumption: 0, profile: 'tek' };
  }
  function pvHourly(o) {
    const out = new Array(H).fill(0);
    if (!(o.kWp > 0)) return { kWh: out, Eac: 0, ok: true };
    const r = E.ges.compute(gesInput(o));
    if (!r.ok) return { kWh: out, Eac: 0, ok: false, errors: r.errors };
    r.values.today.pts.forEach(p => { const h = Math.floor(p.t + 1e-9); if (h >= 0 && h < H) out[h] += p.Pac / 6; });
    return { kWh: out, Eac: r.values.today.Eac, ok: true, annual: r.values.annual };
  }

  /* ---------------------------------------------------------------- RES (engine.res.power yeniden kullanılır)
   * Genel küçük türbin: Cp 0,42, η_mek 0,95, η_jen 0,95, devreye girme 3 m/s, çıkma 25 m/s; süpürme alanı nominal gücün
   * 11,5 m/s’de elde edileceği şekilde seçilir. Saatlik hız: ortalama × (1 + 0,2·cos(2π(h + 0,5 − 15)/24)) (öğleden sonra
   * tepeli günlük döngü, temsilî). Saat ortalama hızı güç eğrisine uygulanır (saat içi değişkenlik ihmal). */
  function turbine(Prated, rho) {
    const t = { rho: rho || 1.225, cp: 0.42, etaMech: 0.95, etaGen: 0.95, cutIn: 3, cutOut: 25, Prated: Prated };
    t.A = Prated * 1000 / (0.5 * t.rho * t.cp * t.etaMech * t.etaGen * Math.pow(11.5, 3));
    t.D = Math.sqrt(4 * t.A / Math.PI);
    return t;
  }
  function windHourly(o) {
    const out = new Array(H).fill(0), v = new Array(H).fill(0);
    if (!(o.kW > 0)) return { kWh: out, v: v };
    const t = turbine(o.kW);
    for (let h = 0; h < H; h++) { v[h] = Math.max(0, o.vMean * (1 + 0.2 * Math.cos(2 * Math.PI * (h + 0.5 - 15) / 24))); out[h] = E.res.power(v[h], t).P; }
    return { kWh: out, v: v, turbine: t };
  }

  /* ---------------------------------------------------------------- dizel jeneratör
   * Yakıt eğrisi (Willans doğrusu): F [l/h] = F0·P_nom + F1·P, tipik değerler F0 = 0,08145, F1 = 0,246 l/(kW·h)
   * (yaygın mikro şebeke yazılımı varsayılanı). Gerçek değer üretici yakıt tablosundan alınmalıdır. */
  const FUEL = { F0: 0.08145, F1: 0.246 };
  function fuelRate(Pnom, P) { return P > 0 ? FUEL.F0 * Pnom + FUEL.F1 * P : 0; }

  /* ---------------------------------------------------------------- batarya
   * Yük/deşarj verimi çevrim veriminin karekökü (ηc = ηd = √RTE). Kullanılabilir pencere: SOC_min = 1 − DoD … 1.
   * Güç sınırı P_max = min(PCS gücü, C·E_nom). */
  function battery(o) {
    const eta = Math.sqrt(clamp(o.rte, 0.5, 1));
    return { cap: o.cap, Emin: o.cap * (1 - o.dod), Emax: o.cap, Pmax: Math.min(o.pcs, o.crate * o.cap), etaC: eta, etaD: eta, cratePcs: o.cap > 0 ? o.pcs / o.cap : 0 };
  }

  /* ---------------------------------------------------------------- saatlik dağıtım
   * o: { load[24], pv[24], wind[24], bat:{cap,pcs,dod,rte,crate}, soc0 (0–1), strategy: self|peak|backup|tou, demandKW,
   *      reserve (0–1), gridCharge, gridKW, exportKW, gen:{on,kW,minPct,peak}, outage:{on,start,dur}, island, prices:{gunduz,puant,gece,export,fuel} }
   * Kurallar: (1) yenilenebilir önce yüke; (2) fazlası bataryaya, kalanı ihracat sınırına kadar şebekeye, artanı kırpılır;
   * (3) açık stratejiye göre batarya deşarjı; (4) stratejiye göre şebekeden şarj; (5) jeneratör (kesintide ya da
   * tepe tıraşlamada); (6) kalan şebekeden. Batarya şebekeye enerji vermez (yalnız tesis yüküne deşarj eder). */
  function dispatchDay(o, E0) {
    const b = battery(o.bat), st = o.strategy, D = o.demandKW, pr = o.prices || {};
    const g = o.gen || {}, genOK = !!g.on && g.kW > 0, gMin = genOK ? clamp(g.minPct || 0, 0, 1) * g.kW : 0;
    let E1 = clamp(E0, b.Emin, b.Emax);
    const rows = [];
    for (let h = 0; h < H; h++) {
      const out = !!(o.outage && o.outage.on) && inWindow(h, o.outage.start, o.outage.dur);
      const gridOK = !out, islandOK = gridOK || !!o.island, per = period(h);
      const L = o.load[h];
      const pvA = islandOK ? o.pv[h] : 0, wA = islandOK ? o.wind[h] : 0, ren = pvA + wA;
      const lost = (o.pv[h] + o.wind[h]) - ren; // ada çalışması yoksa kesintide yenilenebilir de durur (ada koruması)
      const batOK = b.cap > 0 && islandOK;
      const floor = st === 'backup' && gridOK ? Math.max(b.Emin, b.cap * clamp(o.reserve, 0, 1)) : b.Emin;
      const canCh = () => (batOK ? Math.max(0, Math.min(b.Pmax - ch, (b.Emax - E1) / b.etaC)) : 0);
      let ch = 0, chGrid = 0, chGen = 0, dis = 0, imp = 0, exp = 0, curt = 0, gen = 0, dump = 0, uns = 0;
      // 1) yenilenebilir doğrudan yüke
      const use = Math.min(L, ren);
      let net = L - use, surplus = ren - use;
      // 2) fazlası bataryaya
      if (surplus > 0) { const c = Math.min(surplus, canCh()); ch += c; E1 += c * b.etaC; surplus -= c; }
      if (surplus > 0) { exp = gridOK ? Math.min(surplus, Math.max(0, o.exportKW)) : 0; curt = surplus - exp; }
      // 3) deşarj (kesintide jeneratör varsa önce jeneratör yüklenir, batarya kalan açığı kapatır: adım 5b)
      const genFirst = !gridOK && genOK;
      if (net > 0 && batOK && ch === 0 && !genFirst) {
        const canDis = Math.max(0, Math.min(b.Pmax, (E1 - floor) * b.etaD));
        let want = 0;
        if (!gridOK) want = net;
        else if (st === 'self' || st === 'backup') want = net;
        else if (st === 'peak') want = Math.max(0, net - D);
        else if (st === 'tou') want = per === 'puant' ? net : 0;
        dis = Math.min(want, canDis); net -= dis; E1 -= dis / b.etaD;
      }
      // 4) şebekeden şarj. Yedek rezerv: rezerv her saat şebekeden korunur. Zaman tarifesi: gece doldurulur. Öz tüketim ve
      //    yedek rezerv + izin: gece tam doluma. Tepe tıraşlama + izin: çekiş sınırın altındayken her saat (sınıra kadar).
      //    Şarj, şebeke çekişini bağlantı gücünün (tepe tıraşlamada talep sınırının) üstüne çıkarmaz.
      if (gridOK && batOK && dis === 0) {
        let target = -1;
        if (st === 'backup') target = Math.max(b.Emin, b.cap * clamp(o.reserve, 0, 1));
        if (per === 'gece' && (st === 'tou' || ((st === 'self' || st === 'backup') && o.gridCharge))) target = b.Emax;
        if (st === 'peak' && o.gridCharge) target = b.Emax;
        if (target > E1) {
          const lim = st === 'peak' ? D : o.gridKW;
          const room = Math.min(b.Pmax - ch, (target - E1) / b.etaC, lim - net, o.gridKW - net);
          if (room > 1e-9) { chGrid = room; ch += room; E1 += room * b.etaC; }
        }
      }
      // 5) jeneratör
      let need = 0;
      if (genOK) {
        if (!gridOK) need = net;
        else if (st === 'peak' && g.peak) need = Math.max(0, net + chGrid - D);
      }
      if (need > 1e-9) {
        const run = Math.min(g.kW, Math.max(need, gMin));
        gen = run; let extra = run - need;
        const served = Math.min(need, run); net -= Math.min(net, served);
        if (extra > 1e-9) { const c = Math.min(extra, canCh()); ch += c; chGen = c; E1 += c * b.etaC; extra -= c; if (gridOK) { const r2 = Math.min(extra, net); net -= r2; extra -= r2; } dump = extra; }
      }
      // 5b) kesintide jeneratör yetmezse batarya
      if (genFirst && net > 1e-9 && batOK && ch === 0) {
        const d2 = Math.min(net, Math.max(0, Math.min(b.Pmax, (E1 - floor) * b.etaD)));
        dis += d2; net -= d2; E1 -= d2 / b.etaD;
      }
      // 6) kalan
      if (gridOK) imp = net + chGrid; else uns = net;
      E1 = clamp(E1, 0, b.Emax);
      const fuel = fuelRate(g.kW || 0, gen);
      const price = pr[per] || 0;
      rows.push({ h: h, period: per, grid: gridOK, load: L, pv: pvA, wind: wA, lost: lost, use: use, ch: ch, chGrid: chGrid, chGen: chGen, dis: dis, imp: imp, exp: exp, curt: curt,
        gen: gen, dump: dump, uns: uns, fuel: fuel, E: E1, soc: b.cap > 0 ? E1 / b.cap : 0,
        cost: imp * price - exp * (pr.export || 0) + fuel * (pr.fuel || 0) });
    }
    return { rows: rows, Eend: E1, bat: b };
  }
  function inWindow(h, start, dur) { const d = ((h - start) % 24 + 24) % 24; return dur > 0 && d < dur; }

  /** Günlük benzetim. cyclic=true ise başlangıç SOC gün sonu SOC’ye eşitlenene kadar gün tekrarlanır (en çok 8 kez). */
  function simulate(o) {
    const b = battery(o.bat);
    let E0 = clamp((o.soc0 === undefined ? 0.5 : o.soc0) * b.cap, b.Emin, b.Emax), d = dispatchDay(o, E0), it = 1;
    if (o.cyclic) while (it < 8 && Math.abs(d.Eend - E0) > Math.max(1e-6, b.cap * 0.002)) { E0 = d.Eend; d = dispatchDay(o, E0); it++; }
    const R = d.rows, col = k => R.map(r => r[k]);
    const load = sum(col('load')), imp = sum(col('imp')), exp = sum(col('exp')), pv = sum(col('pv')), wind = sum(col('wind')), ren = pv + wind;
    const curt = sum(col('curt')), dis = sum(col('dis')), ch = sum(col('ch')), gen = sum(col('gen')), uns = sum(col('uns')), fuel = sum(col('fuel'));
    const disDC = dis / b.etaD, usable = b.cap - b.Emin;
    const cycles = usable > 0 ? disDC / usable : 0;
    const importCost = sum(R.map(r => r.imp * ((o.prices || {})[r.period] || 0)));
    const exportRev = exp * ((o.prices || {}).export || 0), fuelCost = fuel * ((o.prices || {}).fuel || 0);
    // talep (güç) bedeli: ölçülen en yüksek saatlik çekiş × birim fiyat (TL/kW·ay), günlük payı /30
    const demandCost = max(col('imp')) * ((o.prices || {}).demand || 0) / 30;
    const peakImp = max(col('imp'));
    return { rows: R, E0: E0, Eend: d.Eend, soc0: b.cap > 0 ? E0 / b.cap : 0, socEnd: b.cap > 0 ? d.Eend / b.cap : 0, iterations: it, bat: b,
      load: load, pv: pv, wind: wind, ren: ren, imp: imp, exp: exp, curt: curt, dis: dis, ch: ch, chGrid: sum(col('chGrid')), gen: gen, dump: sum(col('dump')), uns: uns, fuel: fuel,
      lossBat: ch - dis - (d.Eend - E0), // şarj − deşarj − depodaki artış = çevrim kaybı (AC tarafı)
      selfSuff: load > 0 ? 1 - imp / load : 0, // şebekeden bağımsızlık: 1 − şebeke alışı / tüketim
      renShare: load > 0 ? (load - imp - gen - uns) / load : 0,
      selfCons: ren > 0 ? (ren - exp - curt) / ren : 0,
      peakImp: peakImp, peakLoad: max(col('load')), unservedHours: R.filter(r => r.uns > 1e-6).length,
      overLimitHours: R.filter(r => r.imp > o.demandKW + 1e-6).length, overGridHours: R.filter(r => r.imp > o.gridKW + 1e-6).length,
      cycles: cycles, importCost: importCost, exportRev: exportRev, fuelCost: fuelCost, demandCost: demandCost, cost: importCost - exportRev + fuelCost + demandCost };
  }

  /** Basitleştirilmiş ömür: min(takvim ömrü, çevrim ömrü / (günlük çevrim × 365)). Kapasite kaybı günlük hesaba katılmaz. */
  function lifeYears(cycleLife, calLife, cyclesPerDay) {
    const byCycle = cyclesPerDay > 1e-6 ? cycleLife / (cyclesPerDay * 365) : Infinity;
    return { years: Math.min(calLife, byCycle), byCycle: byCycle, limitedBy: byCycle < calLife ? 'cycle' : 'calendar' };
  }

  /** Karşılaştırma: aynı gün (a) yalnız şebeke, (b) yenilenebilir var batarya yok, (c) tam sistem. */
  function compare(o) {
    const sys = simulate(o);
    const noBat = simulate(Object.assign({}, o, { bat: Object.assign({}, o.bat, { cap: 0, pcs: 0 }), cyclic: false }));
    const gridOnly = simulate(Object.assign({}, o, { bat: Object.assign({}, o.bat, { cap: 0, pcs: 0 }), pv: new Array(H).fill(0), wind: new Array(H).fill(0), gen: { on: false }, cyclic: false, outage: { on: false } }));
    return { sys: sys, noBat: noBat, gridOnly: gridOnly,
      peakCut: gridOnly.peakImp > 0 ? (gridOnly.peakImp - sys.peakImp) / gridOnly.peakImp : 0,
      peakCutBat: noBat.peakImp > 0 ? (noBat.peakImp - sys.peakImp) / noBat.peakImp : 0,
      savingBat: noBat.cost - sys.cost, savingAll: gridOnly.cost - sys.cost };
  }

  return { H: H, period: period, PERIOD_NAME: PERIOD_NAME, LOAD_SHAPES: LOAD_SHAPES, loadProfile: loadProfile, parseProfile: parseProfile,
    gesInput: gesInput, pvHourly: pvHourly, turbine: turbine, windHourly: windHourly, FUEL: FUEL, fuelRate: fuelRate, battery: battery,
    dispatchDay: dispatchDay, inWindow: inWindow, simulate: simulate, lifeYears: lifeYears, compare: compare };
});
