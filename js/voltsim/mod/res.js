/* VoltSim · 3D RES / Rüzgâr Enerjisi Simülasyonu
 * Hesap: VoltSimEngine.res (P = ½·ρ·A·Cp·v³·η_mek·η_jen, Betz sınırı, üstel rüzgâr profili, standart atmosfer
 * yoğunluğu, nominal güçte sınırlama, cut-in/cut-out, Weibull dağılımıyla varsayımsal yıllık üretim).
 * Sahne: rotor devri motorun rpm değerine yumuşakça yaklaşır; kanat açısı (pitch) motorda aerodinamik model
 * olmadığından temsilidir; nacelle rüzgâra yavaş döner (sapma kaybı hesaplanmaz). Rüzgâr çizgileri göbek
 * yüksekliği hızıyla akar. Gösterilen tüm sayılar motordan gelir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const R = E.res;
  const MAX_DRAWN = 15;        // çizilen en çok türbin (ön plandaki dahil)
  const YAW_RATE = 1;          // °/s (gerçekte ~0,3–0,5 °/s; izlenebilirlik için hızlandırılmış)
  const TILT = 5 * Math.PI / 180;
  const REGION = { idle: 'Devreye girme altı', partial: 'Kısmi yük (maks. Cp takibi)', rated: 'Nominal güç (pitch ile sınırlı)', stop: 'Korumalı duruş (cut-out)' };

  function defaults() {
    return {
      v10: 7, href: 10, alpha: 0.14, windDir: 190, gust: false,
      rhoMode: 'auto', T: 15, alt: 300, rho: 1.225,
      D: 120, hub: 100, Prated: 3600, cp: 0.45, etaMech: 0.96, etaGen: 0.95, cutIn: 3, cutOut: 25, rpmMax: 14, tsr: 8,
      n: 12, vMean: 7.5, k: 2, avail: 97, wake: 8
    };
  }
  const nDrawn = s => Math.max(1, Math.min(MAX_DRAWN, Math.round(s.n) || 1));
  const compass = d => ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
  /** Dalgalanma açıkken anlık v10 canlı durumdan gelir; motor girdisi yine motorla hesaplanır. */
  function input(s, app) { return s.gust && app && app.live && isFinite(app.live.v10g) ? Object.assign({}, s, { v10: app.live.v10g }) : s; }
  /** Grafik için motorun power() fonksiyonuna verilecek türbin tanımı (A ve ρ motor sonucundan). */
  function turbine(s, v) { return { A: v.A, rho: v.rho, cp: s.cp, etaMech: s.etaMech, etaGen: s.etaGen, cutIn: s.cutIn, cutOut: s.cutOut, Prated: s.Prated }; }
  const unitOf = s => (s.Prated >= 1000 ? { div: 1000, u: 'MW', d: 2 } : { div: 1, u: 'kW', d: 0 });

  /* ---------------------------------------------------------------- zaman adımı: temsili rüzgâr dalgalanması */
  function tick(app, dt) {
    const s = app.state, L = app.live;
    L.gt += dt;
    if (!s.gust) { if (isFinite(L.v10g)) { L.v10g = NaN; app.invalidate(); } return false; }
    L.acc += dt;
    if (L.acc < 0.25) return false;
    L.acc = 0;
    const t = L.gt;
    // üç sinüsün toplamı: tekrarlanabilir, temsili türbülans (ölçüm verisi değil)
    const f = 1 + 0.24 * Math.sin(0.31 * t) + 0.12 * Math.sin(1.13 * t + 1) + 0.06 * Math.sin(2.7 * t + 2);
    L.v10g = Math.max(0, Math.round(s.v10 * f * 100) / 100);
    app.invalidate();
    const r = app.validResult;
    if (r) { L.hist.push([Math.round(app.simTime * 10) / 10, r.values.P / unitOf(s).div, r.values.vHub]); if (L.hist.length > 240) L.hist.shift(); }
    return true;
  }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s) {
    const auto = s.rhoMode !== 'manual';
    return [
      { title: 'Rüzgâr', items: [
        { type: 'range', key: 'v10', label: 'Rüzgâr hızı (ölçüm yüksekliğinde)', min: 0, max: 35, step: 0.1, unit: 'm/s', digits: 1 },
        { type: 'range', key: 'href', label: 'Ölçüm yüksekliği h_ref', min: 2, max: 120, step: 1, unit: 'm' },
        { type: 'range', key: 'alpha', label: 'Rüzgâr kesme üssü α', min: 0.05, max: 0.5, step: 0.01, digits: 2, help: 'Açık deniz ~0,10 · düz açık arazi ~0,14 · ormanlık/engebeli ~0,25+. v_hub = v_ref·(h/h_ref)^α' },
        { type: 'range', key: 'windDir', label: 'Rüzgâr yönü (yalnız görsel)', min: 0, max: 359, step: 1, fmt: v => v + '° (' + compass(v) + ')' },
        { type: 'note', text: 'Nacelle rüzgâra ' + YAW_RATE + '°/s ile döner (gerçek türbinlerde ~0,3–0,5°/s). Yön değişimi ve sapma (yaw) hatasından doğan güç kaybı hesaplanmaz.' },
        { type: 'toggle', key: 'gust', label: 'Rüzgâr dalgalanması (temsili, zamana bağlı)' }
      ] },
      { title: 'Hava yoğunluğu', items: [
        { type: 'seg', key: 'rhoMode', label: 'Yoğunluk', options: [['auto', 'Sıcaklık + rakım'], ['manual', 'Elle gir']] },
        auto ? { type: 'range', key: 'T', label: 'Hava sıcaklığı', min: -30, max: 50, step: 1, unit: '°C' } : null,
        auto ? { type: 'range', key: 'alt', label: 'Saha rakımı', min: 0, max: 3000, step: 10, unit: 'm' } : null,
        auto ? null : { type: 'range', key: 'rho', label: 'Hava yoğunluğu ρ', min: 0.8, max: 1.4, step: 0.005, digits: 3, unit: 'kg/m³' }
      ] },
      { title: 'Türbin', items: [
        { type: 'range', key: 'D', label: 'Rotor çapı D', min: 20, max: 200, step: 1, unit: 'm' },
        { type: 'range', key: 'hub', label: 'Göbek yüksekliği', min: 20, max: 200, step: 1, unit: 'm' },
        { type: 'range', key: 'Prated', label: 'Nominal güç', min: 100, max: 15000, step: 50, unit: 'kW' },
        { type: 'range', key: 'cp', label: 'Güç katsayısı Cp (kısmi yük)', min: 0.2, max: 0.59, step: 0.005, digits: 3 },
        { type: 'note', text: 'Betz sınırı: ideal bir rotor, rotor alanından geçen rüzgârın kinetik gücünün (½·ρ·A·v³) en çok 16/27 ≈ %59,3’ünü alabilir; bu durumda rotor arkasındaki hız serbest akışın 1/3’üne düşer. Modern türbinlerde Cp ≈ 0,45–0,50.' },
        { type: 'range', key: 'etaMech', label: 'Mekanik (dişli kutusu) verimi', min: 0.8, max: 1, step: 0.005, digits: 3 },
        { type: 'range', key: 'etaGen', label: 'Jeneratör + çevirici verimi', min: 0.8, max: 1, step: 0.005, digits: 3 },
        { type: 'range', key: 'cutIn', label: 'Devreye girme hızı (cut-in)', min: 1, max: 8, step: 0.5, unit: 'm/s', digits: 1 },
        { type: 'range', key: 'cutOut', label: 'Devreden çıkma hızı (cut-out)', min: 15, max: 40, step: 1, unit: 'm/s' },
        { type: 'range', key: 'rpmMax', label: 'Maks. rotor devri', min: 3, max: 60, step: 0.5, unit: 'rpm', digits: 1 },
        { type: 'range', key: 'tsr', label: 'Uç hız oranı λ', min: 3, max: 12, step: 0.1, digits: 1 }
      ] },
      { title: 'Park ve yıllık üretim (varsayımsal)', items: [
        { type: 'range', key: 'n', label: 'Türbin sayısı', min: 1, max: 200, step: 1, help: 'Sahnede en çok ' + MAX_DRAWN + ' türbin çizilir.' },
        { type: 'range', key: 'vMean', label: 'Yıllık ortalama göbek hızı', min: 2, max: 15, step: 0.1, unit: 'm/s', digits: 1 },
        { type: 'range', key: 'k', label: 'Weibull şekil parametresi k', min: 1.2, max: 4, step: 0.1, digits: 1 },
        { type: 'range', key: 'avail', label: 'Kullanılabilirlik', min: 50, max: 100, step: 0.5, fmt: v => '%' + fmt(v, 1) },
        { type: 'range', key: 'wake', label: 'Park / iz (wake) kaybı', min: 0, max: 40, step: 0.5, fmt: v => '%' + fmt(v, 1) },
        { type: 'note', level: 'warn', text: 'Yıllık üretim ve kapasite faktörü ölçüm verisi olmadan varsayımsal Weibull dağılımıyla hesaplanan bir senaryodur; yatırım kararı için en az 1 yıllık saha ölçümü ve uzun dönem düzeltmesi gerekir.' }
      ] }
    ];
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values, u = unitOf(s), lv = v.region === 'stop' ? 'bad' : v.region === 'idle' ? 'warn' : 'ok';
    const cpUsed = v.region === 'partial' ? v.cpReq : v.region === 'rated' ? v.cpReq : null;
    return [
      { label: 'Göbek rüzgâr hızı', value: fmt(v.vHub, 2, 'm/s'), sub: (s.gust && isFinite(live.v10g) ? 'Anlık v10 ' + fmt(live.v10g, 1) : 'v10 ' + fmt(s.v10, 1)) + ' m/s → ' + s.hub + ' m (α ' + fmt(s.alpha, 2) + ')' },
      { label: 'Hava yoğunluğu ρ', value: fmt(v.rho, 3, 'kg/m³'), sub: s.rhoMode === 'manual' ? 'Elle girildi' : s.T + ' °C · ' + s.alt + ' m rakım' },
      { label: 'Rotor süpürme alanı A', value: fmt(v.A, 0, 'm²'), sub: 'D = ' + s.D + ' m' },
      { label: 'Rüzgâr gücü (rotor alanı)', value: VS.fmtPower(v.Pwind * 1000), sub: 'Betz üst sınırı ' + VS.fmtPower(v.Pwind * 1000 * R.BETZ) },
      { label: 'Elektrik gücü', value: VS.fmtPower(v.P * 1000), level: lv, sub: '%' + fmt(v.P / s.Prated * 100, 0) + ' nominal' },
      { label: v.region === 'rated' ? 'Gereken Cp (nominalde)' : 'Kullanılan Cp', value: cpUsed === null || cpUsed === undefined ? '—' : fmt(cpUsed, 3), sub: 'Betz sınırı 16/27 = 0,593' },
      { label: 'Rotor devri', value: fmt(v.rpm, 1, 'rpm'), sub: 'Uç hızı ' + fmt(v.tip, 1, 'm/s'), level: v.tip > 90 ? 'warn' : undefined },
      { label: 'Nominal rüzgâr hızı', value: fmt(v.vRated, 1, 'm/s'), sub: 'Cut-in ' + fmt(s.cutIn, 1) + ' · cut-out ' + fmt(s.cutOut, 0) + ' m/s' },
      { label: 'Çalışma bölgesi', value: REGION[v.region], level: lv, wide: true, sub: v.region === 'rated' ? 'Kanat açısı artırılarak Cp ' + fmt(v.cpReq, 3) + '’e düşürülür (kanat açısı görseli temsili)' : v.region === 'stop' ? 'Kanatlar rüzgâra paralel (feather), rotor frenli' : v.region === 'idle' ? 'Üretim yok; rotor ' + (v.rpm > 0 ? 'boşta dönüyor' : 'duruyor') : 'Güç v³ ile artar' },
      { label: 'Park gücü (anlık)', value: fmt(v.farmP / u.div, u.d, u.u), sub: s.n + ' × ' + VS.fmtPower(v.P * 1000) + ' (iz kaybı hariç)' },
      { label: 'Yıllık üretim (AEP)', value: VS.fmtEnergy(v.aep), sub: 'Varsayımsal senaryo · ölçüm verisi yok', hint: 'Weibull c = ' + fmt(v.weibullC, 2) + ' m/s, k = ' + s.k },
      { label: 'Kapasite faktörü', value: '%' + fmt(v.cf * 100, 1), sub: 'Varsayımsal · kullanılabilirlik %' + fmt(s.avail, 1) + ', iz %' + fmt(s.wake, 1) }
    ];
  }

  function weibull(vv, c, k) { return k / c * Math.pow(vv / c, k - 1) * Math.exp(-Math.pow(vv / c, k)); }
  function charts(res, s, live) {
    const v = res.values, u = unitOf(s), t = turbine(s, v);
    const curve = v.curve.map(p => [p.v, p.P / u.div]);
    const out = [{
      id: 'pcurve', title: 'Güç eğrisi P(v) ve çalışma noktası', height: 160,
      series: [{ name: 'Elektrik gücü (' + u.u + ')', color: 'amber', area: true, data: curve }],
      hLines: [{ y: s.Prated / u.div, label: 'Nominal ' + VS.fmtPower(s.Prated * 1000), color: '#94a3b8' }],
      markers: [{ x: Math.min(v.vHub, 30), y: v.P / u.div, color: '#fcd34d', label: fmt(v.vHub, 1) + ' m/s' }, { x: s.cutOut, color: '#ef4444' }],
      x: { label: 'm/s (göbek)', min: 0, max: 30 }, y: { label: u.u, min: 0, max: s.Prated / u.div * 1.15 },
      alt: 'Cut-in ' + s.cutIn + ' m/s, nominal güce ' + fmt(v.vRated, 1) + ' m/s’de ulaşılır, cut-out ' + s.cutOut + ' m/s. Çalışma noktası ' + fmt(v.vHub, 1) + ' m/s ve ' + VS.fmtPower(v.P * 1000) + '.'
    }];
    // Weibull frekansı (%) ve her hız aralığının yıllık enerjiye katkısı (%): P(v) motorun power() fonksiyonundan
    const bins = [];
    let sum = 0;
    for (let b = 0; b < 30; b++) { const vc = b + 0.5, f = weibull(vc, v.weibullC, s.k), e = R.power(vc, t).P * f; bins.push([vc, f * 100, e]); sum += e; }
    out.push({
      id: 'weibull', title: 'Rüzgâr hızı dağılımı (Weibull) ve enerji katkısı · varsayımsal', height: 160,
      series: [
        { name: 'Zaman payı (%)', type: 'bar', color: 'cyan', width: 0.4, offset: -0.5, data: bins.map(b => [b[0], b[1]]) },
        { name: 'Enerji payı (%)', type: 'bar', color: 'green', width: 0.4, offset: 0.5, data: bins.map(b => [b[0], sum > 0 ? b[2] / sum * 100 : 0]) }
      ],
      markers: [{ x: s.vMean, color: '#fcd34d', label: 'ort. ' + fmt(s.vMean, 1) }],
      x: { label: 'm/s', min: 0, max: 25 }, y: { label: '%' },
      alt: 'Weibull k = ' + s.k + ', c = ' + fmt(v.weibullC, 2) + ' m/s. Enerjinin büyük kısmı ortalamanın üstündeki hızlardan gelir.'
    });
    if (s.gust && live.hist.length > 2) out.push({
      id: 'gust', title: 'Dalgalı rüzgârda anlık güç (temsili zaman serisi)', height: 140,
      series: [{ name: 'P (' + u.u + ')', color: 'amber', area: true, data: live.hist.map(h => [h[0], h[1]]) }, { name: 'v_hub (m/s)', color: 'cyan', data: live.hist.map(h => [h[0], h[2]]) }],
      hLines: [{ y: s.Prated / u.div, label: 'Nominal', color: '#94a3b8' }],
      x: { label: 's' }, y: { label: u.u + ' · m/s' },
      alt: 'Temsili dalgalanmada göbek hızı ve buna karşılık gelen motor güç değeri.'
    });
    return out;
  }

  /* ---------------------------------------------------------------- 3D: geometri */
  let G = null;
  function hAt(x, z) {
    // yumuşak tepeler; ön plandaki türbin ve trafo merkezi çevresi düz
    const r = Math.hypot(x, z), f = r < 230 ? 0 : r > 520 ? 1 : (r - 230) / 290;
    const h = 16 * Math.sin(x / 260 + 0.6) * Math.cos(z / 330) + 11 * Math.sin((x + z) / 190) + 30 * Math.exp(-((x + 900) ** 2 + (z + 1300) ** 2) / 5e5) + 22 * Math.exp(-((x - 1100) ** 2 + (z + 700) ** 2) / 3e5);
    return (h + 12) * f * f * (3 - 2 * f);
  }
  function geos(T) {
    if (G) return G;
    G = { blades: {} };
    const S = 7000, N = 180, geo = new T.PlaneGeometry(S, S, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = [], c = new T.Color(), a = new T.Color(0x56723a), b = new T.Color(0x7f8d4a), d = new T.Color(0x3f5a2e);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = hAt(x, z);
      pos.setY(i, y);
      const n = 0.5 + 0.5 * Math.sin(x / 90 + Math.cos(z / 70) * 2) * Math.cos(z / 130);
      c.copy(a).lerp(b, n * 0.6).lerp(d, Math.max(0, Math.sin(x / 400 - z / 300)) * 0.35); c.convertSRGBToLinear();
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    G.terrain = geo;
    G.streak = new T.BoxGeometry(1, 1, 1);
    G.box = new T.BoxGeometry(1, 1, 1);
    return G;
  }
  /** Kanat: kök bölgede daireden aerofoil kesite geçen, sivrilen ve burulan gövde (NACA 00xx kalınlık dağılımı). */
  function bladeGeo(T, r0, Rt) {
    const key = r0.toFixed(2) + '|' + Rt.toFixed(2);
    if (G.blades[key]) return G.blades[key];
    const NS = 28, NP = 26, pos = [], idx = [];
    for (let i = 0; i < NS; i++) {
      const sN = i / (NS - 1), s = Math.pow(sN, 0.85), r = r0 + (Rt - r0) * s;
      const c = Rt * (s < 0.22 ? 0.045 + (0.075 - 0.045) * Math.sin(s / 0.22 * Math.PI / 2) : 0.075 - (0.075 - 0.016) * Math.pow((s - 0.22) / 0.78, 0.9));
      const tc = s < 0.22 ? 1 - (1 - 0.4) * s / 0.22 : 0.4 - 0.25 * Math.min(1, (s - 0.22) / 0.6);
      const circ = s < 0.16 ? 1 - smooth(s / 0.16) : 0;
      const tw = (14 * Math.pow(Math.max(0, 1 - s), 1.6)) * Math.PI / 180;
      const ct = Math.cos(tw), st = Math.sin(tw);
      for (let j = 0; j < NP; j++) {
        const th = j / NP * Math.PI * 2, xc = 0.5 * (1 + Math.cos(th));
        const yt = 5 * Math.min(tc, 0.42) * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc * xc * xc - 0.1036 * xc * xc * xc * xc);
        const camber = 0.035 * 4 * xc * (1 - xc) * (1 - s);
        let X = (xc - 0.32) * c, Y = (Math.sign(Math.sin(th)) * yt + camber) * c;
        X = X * (1 - circ) + 0.5 * Math.cos(th) * c * circ; Y = Y * (1 - circ) + 0.5 * Math.sin(th) * c * circ * (tc >= 0.99 ? 1 : 1);
        // kord → z (dönme yönü), kalınlık → x (rotor ekseni); burulma y ekseni etrafında
        pos.push(Y * ct - X * st, r, Y * st + X * ct);
      }
    }
    for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NP; j++) {
      const a = i * NP + j, b = i * NP + (j + 1) % NP, c = a + NP, d = b + NP;
      idx.push(a, c, b, b, c, d);
    }
    const tip = pos.length / 3; pos.push(0, Rt + 0.15, 0);
    for (let j = 0; j < NP; j++) idx.push((NS - 1) * NP + j, tip, (NS - 1) * NP + (j + 1) % NP);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    G.blades[key] = geo;
    return geo;
  }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function dims(s) {
    const D = s.D, hub = Math.max(s.hub, D / 2 + 5);
    const L = 0.11 * D + 1.5, Wn = 0.035 * D + 1, Hn = 0.033 * D + 0.9, hubR = 0.016 * D + 0.1;
    const rb = 0.4 + 0.012 * hub + 0.006 * D;
    return { D: D, Rt: D / 2, hub: hub, L: L, Wn: Wn, Hn: Hn, hubR: hubR, rb: rb, rt: rb * 0.6, Ht: hub - 0.55 * Hn, rotorX: 0.38 * L + 0.8 * hubR + 0.3, sF: D / 120 };
  }
  function bgPositions(s, d) {
    const out = [], n = nDrawn(s);
    for (let i = 1; i < n; i++) {
      const row = Math.floor((i - 1) / 4), col = (i - 1) % 4;
      const x = (col - 1.5) * 4.2 * d.D + (row % 2 ? 1.6 * d.D : 0) - 0.6 * d.D, z = -5.5 * d.D * (row + 1) - 140;
      out.push([x, hAt(x, z), z]);
    }
    return out;
  }

  /* ---------------------------------------------------------------- 3D: sahne kurulumu */
  function rebuildOn(s) { const d = dims(s); return Math.round(d.D) + '|' + Math.round(d.hub) + '|' + nDrawn(s); }
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer, g = geos(T), d = dims(s);
    const sc = { d: d, bg: [], app: app };
    app.scene3 = sc;
    v.camera.near = 0.5; v.camera.far = 9000; v.camera.updateProjectionMatrix();
    v.scene.fog = new T.Fog(0xb3c8de, 900, 5200);
    v.sun.shadow.bias = -0.0006; v.sun.shadow.normalBias = 0.3;
    const towerMat = new T.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.42, metalness: 0.1 });
    const white = M.bladeWhite;
    const gearMat = new T.MeshStandardMaterial({ color: 0x6f7f8c, roughness: 0.45, metalness: 0.5 });
    const genMat = new T.MeshStandardMaterial({ color: 0x2c4a6e, roughness: 0.45, metalness: 0.4 });

    // arazi
    const ter = new T.Mesh(g.terrain, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    ter.receiveShadow = true; ter.userData.noClip = true; v.root.add(ter);
    const pad = new T.Mesh(new T.CircleGeometry(24, 40), M.gravel); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.06; pad.receiveShadow = true; pad.userData.noClip = true; v.root.add(pad);
    // servis yolu (çakıl) türbinden trafo merkezine
    const rg = new T.PlaneGeometry(6, 104); rg.rotateX(-Math.PI / 2);
    const road = new T.Mesh(rg, M.gravel); road.rotation.y = Math.atan2(-95, -48); road.position.set(-47, 0.05, -24); road.receiveShadow = true; road.userData.noClip = true; v.root.add(road);

    // ---- ön plandaki türbin
    const base = k.group(null, 0, 0, 0);
    k.cyl(d.rb + 3.2, d.rb + 3.8, 1.2, M.concrete, 0, 0.3, 0, base, 40);
    const tower = new T.Mesh(new T.CylinderGeometry(d.rt, d.rb, d.Ht, 56, 6), towerMat);
    tower.position.y = d.Ht / 2 + 0.9; tower.castShadow = tower.receiveShadow = true; base.add(tower);
    [0.36, 0.68].forEach(f => { const rr = d.rb + (d.rt - d.rb) * f; const fl = new T.Mesh(new T.TorusGeometry(rr + 0.02, 0.07 * d.sF + 0.03, 8, 48), M.galv); fl.rotation.x = Math.PI / 2; fl.position.y = 0.9 + d.Ht * f; base.add(fl); });
    // kapı, merdiven, sahanlık (kameraya bakan yüzde)
    const door = k.group(base, Math.sin(0.7) * (d.rb - 0.05), 0, Math.cos(0.7) * (d.rb - 0.05)); door.rotation.y = 0.7;
    k.rbox(1.0, 2.2, 0.12, 0.08, M.plasticGrey, 0, 3.0, 0.05, door);
    k.box(2.2, 0.12, 1.6, M.galv, 0, 1.85, 0.85, door);
    for (let j = 0; j < 4; j++) k.box(1.0, 0.06, 0.32, M.galv, 0, 0.35 + j * 0.38, 1.85 + (3 - j) * 0.3, door);
    k.box(0.05, 1.1, 1.6, M.galv, 1.08, 2.45, 0.85, door); k.box(0.05, 1.1, 1.6, M.galv, -1.08, 2.45, 0.85, door);
    k.pickable(tower, 'Kule (konik çelik boru)', () => { const r = app.validResult; return ['Göbek yüksekliği: ' + s.hub + ' m · taban çapı ≈ ' + fmt(d.rb * 2, 1) + ' m', 'Flanşlı segmentler, içte merdiven/asansör ve kablo askısı', r ? 'Göbekte rüzgâr: ' + fmt(r.values.vHub, 2) + ' m/s' : '', 'Temel: betonarme ankraj (görsel temsili)']; });
    // türbin trafosu (kiosk) ve OG çıkışı
    const kx = d.rb + 9, kz = -4;
    const kiosk = k.rbox(3.2, 2.6, 2.4, 0.1, M.panelRAL7035, kx, 1.4, kz);
    k.box(3.4, 0.14, 2.6, M.panelRAL7035, kx, 2.78, kz);
    k.box(4, 0.3, 3, M.concrete, kx, 0.15, kz);
    k.pickable(kiosk, 'Türbin trafosu ve OG bağlantısı', () => ['Jeneratör çıkışı (≈ 0,69 kV) OG’ye yükseltilir (ör. 33 kV, temsili)', 'Kiosk tipi trafo kule dibinde; bazı türbinlerde nacelle içindedir', 'Park içi OG hat trafo merkezine gider']);

    // yaw grubu (nacelle) — yerel +x rüzgârın geldiği yöne bakar
    const yaw = k.group(null, 0, d.hub + 0.9, 0);
    sc.yaw = yaw;
    const coverLow = k.rbox(d.L, d.Hn * 0.46, d.Wn, Math.min(d.Hn, d.Wn) * 0.16, white, -0.12 * d.L, -d.Hn * 0.27, 0, yaw);
    const coverTop = k.rbox(d.L, d.Hn * 0.56, d.Wn, Math.min(d.Hn, d.Wn) * 0.22, white, -0.12 * d.L, d.Hn * 0.24, 0, yaw);
    k.shell(coverLow); k.shell(coverTop);
    k.explodable(coverTop, [0, d.Hn * 1.4, 0]);
    k.pickable(coverTop, 'Nacelle (makine dairesi)', () => nacelleInfo(app));
    const cooler = k.box(d.Wn * 0.7, d.Hn * 0.28, d.L * 0.16, M.plasticGrey, -0.55 * d.L, d.Hn * 0.62, 0, yaw); cooler.rotation.y = Math.PI / 2; k.shell(cooler); k.explodable(cooler, [0, d.Hn * 1.4, 0]);
    // meteoroloji sensörleri ve uçak ikaz lambası (nacelle üstü)
    k.cyl(0.04 * d.sF + 0.02, 0.04 * d.sF + 0.02, d.Hn * 0.5, M.galv, -0.42 * d.L, d.Hn * 0.78, d.Wn * 0.25, yaw, 8);
    sc.vane = k.group(yaw, -0.42 * d.L, d.Hn * 1.03, d.Wn * 0.25);
    k.box(0.9 * d.sF, 0.25 * d.sF, 0.03, M.plasticDark, -0.35 * d.sF, 0, 0, sc.vane);
    sc.beacon = k.sphere(0.22 * d.sF + 0.08, M.ledRed, -0.42 * d.L, d.Hn * 0.78, -d.Wn * 0.25, yaw);
    // aktarma organları (Şeffaf kapak / patlatılmış görünümde görünür)
    const sF = d.sF;
    k.box(d.L * 0.85, 0.4 * sF, d.Wn * 0.62, M.darkSteel, -0.1 * d.L, -d.Hn * 0.4, 0, yaw);                       // ana şasi
    const bearing = k.box(1.6 * sF, 1.7 * sF, 1.9 * sF, gearMat, 0.27 * d.L, -d.Hn * 0.1, 0, yaw);
    k.pickable(bearing, 'Ana yatak', () => ['Rotor yükünü şasiye aktaran ana (rotor) yatağı', 'Rotor eğimi ~5° (kanat–kule açıklığı için)']);
    const gb = k.cyl(1.25 * sF, 1.05 * sF, 2.4 * sF, gearMat, 0.04 * d.L, -d.Hn * 0.06, 0, yaw, 32); gb.rotation.z = Math.PI / 2;
    k.box(0.5 * sF, 0.6 * sF, 3.4 * sF, gearMat, 0.04 * d.L, -d.Hn * 0.2, 0, yaw);                              // tork kolları
    k.pickable(gb, 'Dişli kutusu (planet + helisel)', () => { const r = app.validResult; return ['Rotor devrini jeneratör devrine yükseltir (≈ 1:100, temsili)', 'Mekanik verim η_mek = ' + fmt(s.etaMech, 3), r ? 'Rotor devri: ' + fmt(r.values.rpm, 1) + ' rpm' : '']; });
    k.explodable(gb, [0, 0, d.Wn * 0.9]);
    const disc = k.cyl(0.8 * sF, 0.8 * sF, 0.12 * sF, M.steel, -0.08 * d.L, -d.Hn * 0.06, 0, yaw, 32); disc.rotation.z = Math.PI / 2;
    k.box(0.3 * sF, 0.5 * sF, 0.35 * sF, M.plasticRed, -0.08 * d.L, -d.Hn * 0.06 + 0.75 * sF, 0, yaw);       // fren kaliperi
    const cpl = k.cyl(0.22 * sF, 0.22 * sF, 0.1 * d.L, M.steel, -0.15 * d.L, -d.Hn * 0.06, 0, yaw, 16); cpl.rotation.z = Math.PI / 2;
    const gen = k.cyl(1.05 * sF, 1.05 * sF, 2.8 * sF, genMat, -0.3 * d.L, -d.Hn * 0.06, 0, yaw, 32); gen.rotation.z = Math.PI / 2;
    for (let j = 0; j < 5; j++) { const rr = k.cyl(1.12 * sF, 1.12 * sF, 0.08 * sF, genMat, -0.3 * d.L - 1.1 * sF + j * 0.55 * sF, -d.Hn * 0.06, 0, yaw, 32); rr.rotation.z = Math.PI / 2; }
    k.pickable(gen, 'Jeneratör (DFIG / senkron, temsili)', () => { const r = app.validResult; return ['Jeneratör + çevirici verimi η_jen = ' + fmt(s.etaGen, 3), r ? 'Elektrik gücü: ' + VS.fmtPower(r.values.P * 1000) : '', 'Şebeke bağlantısında güç elektroniği çeviricisi kullanılır']; });
    k.explodable(gen, [0, 0, -d.Wn * 0.9]);
    for (let j = 0; j < 3; j++) k.box(0.9 * sF, 1.9 * sF, 0.7 * sF, M.panelRAL7035, -0.52 * d.L, -d.Hn * 0.12, (j - 1) * 0.8 * sF, yaw); // çevirici dolapları
    const yring = new T.Mesh(new T.TorusGeometry(d.rt * 0.95, 0.15 * sF + 0.05, 8, 40), M.steel); yring.rotation.x = Math.PI / 2; yring.position.set(0, -d.Hn * 0.5, 0); yaw.add(yring);
    // rotor: eğim grubu → dönen grup → kanat tutucular → (pitch) kanatlar
    const tilt = k.group(yaw, d.rotorX, 0, 0); tilt.rotation.z = TILT;
    const rotor = k.group(tilt, 0, 0, 0);
    sc.rotor = rotor;
    const shaft = k.cyl(0.42 * sF, 0.5 * sF, d.rotorX - 0.1 * d.L, M.steel, -(d.rotorX - 0.1 * d.L) / 2 - 0.4, 0, 0, rotor, 20); shaft.rotation.z = Math.PI / 2;
    k.pickable(shaft, 'Ana mil', () => ['Düşük devirli ana mil; rotor torkunu dişli kutusuna iletir', 'Fren diski yüksek devirli taraftadır']);
    const sp = spinnerGeo(T, d.hubR);
    const spinner = new T.Mesh(sp, white); spinner.castShadow = true; rotor.add(spinner); k.shell(spinner);
    k.sphere(d.hubR * 0.75, M.galv, 0, 0, 0, rotor);                                                                  // göbek dökümü
    k.pickable(spinner, 'Göbek ve burun konisi', () => ['Üç kanat pitch yataklarıyla göbeğe bağlıdır', 'Kanat açısı (pitch) motorlu/hidrolik ayarlanır', 'Gösterilen kanat açısı temsilidir']);
    const bg = bladeGeo(T, d.hubR * 0.8, d.Rt);
    sc.blades = [];
    for (let j = 0; j < 3; j++) {
      const holder = k.group(rotor, 0, 0, 0); holder.rotation.x = j * Math.PI * 2 / 3;
      const bl = new T.Mesh(bg, white); bl.castShadow = true; bl.receiveShadow = true; holder.add(bl);
      k.cyl(d.hubR * 0.42, d.hubR * 0.42, 0.5, M.galv, 0, d.hubR * 0.85, 0, holder, 20);                              // pitch yatağı
      sc.blades.push(bl);
      if (j === 0) k.pickable(bl, 'Kanat (aerofoil kesitli, burulmalı)', () => { const r = app.validResult; return ['Uzunluk ≈ ' + fmt(d.Rt - d.hubR * 0.8, 1) + ' m · kök: dairesel, uç: ince aerofoil', r ? 'Uç hızı: ' + fmt(r.values.tip, 1) + ' m/s' : '', 'Kanat açısı (temsili): ' + fmt(app.live.pitch, 0) + '°', 'Kanat geometrisi görsel temsildir; Cp motorda sabit/gerekli değer olarak hesaplanır']; });
    }
    sc.nacLabel = k.label('Türbin', yaw, [-0.1 * d.L, d.Hn * 0.9 + 2, 0]);
    sc.pitchLabel = k.label('Kanat açısı', tilt, [d.hubR * 1.6, -d.hubR * 1.6, 0], 'vs-label--sm');

    // ---- arka plandaki türbinler (InstancedMesh: kule, nacelle, göbek, kanatlar)
    const pos = bgPositions(s, d), nb = pos.length;
    sc.bgPos = pos;
    if (nb) {
      const tw = new T.InstancedMesh(tower.geometry, towerMat, nb), dm = new T.Object3D();
      pos.forEach((p, i) => { dm.position.set(p[0], p[1] + d.Ht / 2 + 0.9, p[2]); dm.rotation.set(0, 0, 0); dm.updateMatrix(); tw.setMatrixAt(i, dm.matrix); });
      tw.castShadow = true; tw.receiveShadow = true; v.root.add(tw);
      sc.bgNac = new T.InstancedMesh(coverTop.geometry, white, nb * 2);
      sc.bgSpin = new T.InstancedMesh(sp, white, nb);
      sc.bgBlade = new T.InstancedMesh(bg, white, nb * 3);
      [sc.bgNac, sc.bgSpin, sc.bgBlade].forEach(im => { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.setUsage(T.DynamicDrawUsage); v.root.add(im); });
      // dönüşüm zinciri (yaw → eğim → dönme → kanat → pitch)
      const c0 = new T.Object3D(), c1 = new T.Object3D(), c2 = new T.Object3D(), c3 = new T.Object3D(), c4 = new T.Object3D(), cn = new T.Object3D();
      c0.add(c1); c1.add(c2); c2.add(c3); c3.add(c4); c0.add(cn);
      c1.position.set(d.rotorX, 0, 0); c1.rotation.z = TILT;
      sc.chain = [c0, c1, c2, c3, c4, cn];
    }
    // ---- ölçüm direği (h_ref)
    const mx = 60, mz = 26, mh = Math.max(2, s.href);
    k.cyl(0.12, 0.16, mh, M.galv, mx, mh / 2, mz, null, 10);
    [0, 2.1, 4.2].forEach(a => k.tube([[mx, mh * 0.8, mz], [mx + Math.cos(a) * mh * 0.5, 0.1, mz + Math.sin(a) * mh * 0.5]], 0.025, M.steel));
    k.box(1.6, 0.06, 0.06, M.galv, mx + 0.8, mh - 0.2, mz);
    sc.cups = k.group(null, mx + 1.6, mh + 0.15, mz);
    for (let j = 0; j < 3; j++) { const a = j * Math.PI * 2 / 3; k.box(0.32, 0.025, 0.025, M.plasticDark, Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16, sc.cups).rotation.y = -a; k.sphere(0.06, M.plasticDark, Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32, sc.cups); }
    sc.mastVane = k.group(null, mx, mh + 0.25, mz);
    k.box(0.9, 0.2, 0.025, M.plasticRed, -0.35, 0, 0, sc.mastVane);
    k.pickable(sc.cups, 'Ölçüm direği (anemometre + rüzgâr gülü)', () => { const r = app.validResult; return ['Ölçüm yüksekliği h_ref = ' + s.href + ' m', 'Ölçülen hız v_ref = ' + fmt(app.live.v10g > 0 ? app.live.v10g : s.v10, 1) + ' m/s', r ? 'Göbeğe taşıma: ' + fmt(r.values.vHub, 2) + ' m/s (α = ' + s.alpha + ')' : '', 'Yatırım için en az 1 yıl ölçüm ve uzun dönem korelasyonu gerekir']; });
    sc.mastLabel = k.label('Ölçüm direği', null, [mx, mh + 3, mz], 'vs-label--sm');

    // ---- rüzgâr yön oku (rotorun üstünde, gerçek rüzgâr yönünü anında gösterir)
    sc.arrow = k.group(null, 0, d.hub + d.Rt + 16 * d.sF + 6, 0);
    const arrowMat = new T.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.6, roughness: 0.4, transparent: true, opacity: 0.85 });
    const shaftA = k.cyl(0.9 * d.sF + 0.3, 0.9 * d.sF + 0.3, 26 * d.sF + 8, arrowMat, 0, 0, 0, sc.arrow, 16); shaftA.rotation.z = Math.PI / 2;
    const head = k.cyl(0, 2.6 * d.sF + 0.8, 8 * d.sF + 3, arrowMat, -(13 * d.sF + 4) - (4 * d.sF + 1.5), 0, 0, sc.arrow, 20); head.rotation.z = Math.PI / 2;
    sc.windLabel = k.label('Rüzgâr', sc.arrow, [0, 3 * d.sF + 2, 0]);

    // ---- rüzgâr çizgileri (göbek hızıyla akar)
    const NSTR = k.quality === 'low' ? 50 : 90;
    const strMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false });
    sc.streaks = new T.InstancedMesh(g.streak, strMat, NSTR); sc.streaks.castShadow = false; sc.streaks.userData.noClip = true; v.root.add(sc.streaks);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    sc.str = []; const span = Math.max(220, d.D * 2.2);
    for (let i = 0; i < NSTR; i++) sc.str.push({ u: (rnd() - 0.5) * 2 * span, w: (rnd() - 0.5) * 2 * span * 0.8, y: 12 + rnd() * (d.hub + d.Rt + 10), len: 6 + rnd() * 10 });
    sc.span = span;

    // ---- OG hat ve trafo merkezi
    const ssx = -95, ssz = -48;
    const yard = k.group(null, ssx, 0, ssz);
    k.box(46, 0.3, 32, M.gravel, 0, 0.15, 0, yard);
    for (let j = 0; j < 24; j++) { const t = j / 24, per = 2 * (46 + 32), p = t * per; let x, z; if (p < 46) { x = -23 + p; z = -16; } else if (p < 78) { x = 23; z = -16 + p - 46; } else if (p < 124) { x = 23 - (p - 78); z = 16; } else { x = -23; z = 16 - (p - 124); } k.box(0.12, 2.4, 0.12, M.galv, x, 1.5, z, yard); }
    [[0, -16], [0, 16]].forEach(f => k.box(46, 2.2, 0.04, M.galv, f[0], 1.4, f[1], yard));
    [[-23, 0], [23, 0]].forEach(f => k.box(0.04, 2.2, 32, M.galv, f[0], 1.4, f[1], yard));
    const ptr = k.group(yard, 4, 0.3, 2);
    k.box(7, 4.2, 3.6, M.trafoPaint, 0, 2.4, 0, ptr);
    const fins = new T.InstancedMesh(g.box, M.trafoPaint, 20), dmf = new T.Object3D();
    for (let j = 0; j < 20; j++) { dmf.position.set(-3 + (j % 10) * 0.66, 2.2, j < 10 ? 2.3 : -2.3); dmf.scale.set(0.08, 3.2, 1.0); dmf.updateMatrix(); fins.setMatrixAt(j, dmf.matrix); }
    fins.castShadow = true; ptr.add(fins);
    for (let j = 0; j < 3; j++) k.cyl(0.18, 0.26, 2.2, M.porcelainGrey, -2 + j * 2, 5.6, -0.8, ptr, 12);
    for (let j = 0; j < 3; j++) k.cyl(0.14, 0.2, 1.4, M.porcelainGrey, -2 + j * 2, 5.2, 1.0, ptr, 12);
    const cons = k.cyl(0.6, 0.6, 3.6, M.trafoPaint, 0, 5.4, 1.6, ptr, 20); cons.rotation.z = Math.PI / 2;
    // portal (gantry)
    [-9, -3].forEach(gx => { k.box(0.5, 11, 0.5, M.galv, gx, 5.8, -6, yard); k.box(0.5, 11, 0.5, M.galv, gx, 5.8, 6, yard); k.box(0.5, 0.6, 12.5, M.galv, gx, 11, 0, yard); });
    const bld = k.group(yard, -12, 0.3, 9);
    k.box(13, 4.2, 6.5, M.wallPanel, 0, 2.1, 0, bld); k.box(13.6, 0.3, 7.1, M.roofSheet, 0, 4.35, 0, bld);
    k.box(1.2, 2.3, 0.08, M.plasticGrey, 3, 1.15, 3.27, bld);
    k.pickable(ptr, 'Trafo merkezi (park bağlantısı)', () => { const r = app.validResult; return ['OG park hatlarını iletim gerilimine yükseltir (ör. 33/154 kV, temsili)', r ? 'Anlık park gücü: ' + VS.fmtPower(r.values.farmP * 1000) + ' (' + s.n + ' türbin, iz kaybı hariç)' : '', 'Bağlantı koşulları TEİAŞ / dağıtım şirketi görüşüyle belirlenir']; });
    sc.ssLabel = k.label('Trafo merkezi', ptr, [0, 8, 0]);
    // OG havai hat: kiosk → 2 direk → portal
    const A = new T.Vector3(kx - 1, 0, kz), B = new T.Vector3(ssx - 3, 0, ssz - 0), dir = B.clone().sub(A), len = dir.length(); dir.normalize();
    const perp = new T.Vector3(-dir.z, 0, dir.x);
    const poles = [0.08, 0.42, 0.76].map(t => A.clone().addScaledVector(dir, len * t));
    const ph = 12;
    poles.forEach(p => {
      k.cyl(0.16, 0.24, ph, M.concreteDark, p.x, ph / 2, p.z, null, 10);
      const arm = k.box(4, 0.2, 0.2, M.galv, p.x, ph - 0.6, p.z); arm.rotation.y = -Math.atan2(perp.z, perp.x);
      [-1.6, 0, 1.6].forEach(o => k.cyl(0.08, 0.12, 0.6, M.porcelainGrey, p.x + perp.x * o, ph - 0.2, p.z + perp.z * o, null, 8));
    });
    sc.lineFlow = null;
    [-1.6, 0, 1.6].forEach((o, j) => {
      const pts = [];
      const end = new T.Vector3(ssx - 3, 11, ssz + o * 1.5);
      const anchors = poles.map(p => new T.Vector3(p.x + perp.x * o, ph + 0.05, p.z + perp.z * o)).concat([end]);
      for (let a = 0; a < anchors.length; a++) {
        pts.push(anchors[a]);
        if (a < anchors.length - 1) { const m = anchors[a].clone().lerp(anchors[a + 1], 0.5); m.y -= 1.4; pts.push(m); }
      }
      const w = k.tube(pts, 0.06, M.alu, null, 120);
      if (j === 1) { sc.lineFlow = k.flow(w.userData.curve, 30, 0xfcd34d, 0.35); k.pickable(w, 'OG havai hat (park içi)', () => { const r = app.validResult; return ['Türbin trafosundan trafo merkezine (temsili 33 kV)', r ? 'Taşınan güç (bu türbin): ' + VS.fmtPower(r.values.P * 1000) : '', 'Akış hızı park gücüyle orantılı gösterilir']; }); }
    });
    k.tube([[poles[0].x, ph - 0.3, poles[0].z], [poles[0].x + dir.x * 0.3, 2, poles[0].z + dir.z * 0.3], [poles[0].x, 0, poles[0].z]], 0.08, M.cableBlack);

    // kamera, gölge, kesit
    app.def.scene.bounds = [-d.L - 10, d.L + 10];
    const key = Math.round(d.hub / 10) + '|' + Math.round(d.D / 15);
    if (app._viewKey !== key) {
      app._viewKey = key;
      const H = d.hub + d.Rt;
      v.setView({ target: [-14, H * 0.6, -20], r: H * 1.42 + 30, theta: 0.62, phi: 1.36, limits: { rMin: 8, rMax: 2500, phiMin: 0.15, phiMax: 1.54 } });
    }
    v.setShadowBox(Math.max(140, d.hub + d.Rt + 60), 1400);
    v.sun.position.set(260, 420, 200); v.sun.target.position.set(-20, 0, -20);
  }
  function spinnerGeo(T, r) {
    const pts = [];
    pts.push(new T.Vector2(0.001, -0.9 * r));
    pts.push(new T.Vector2(r * 0.98, -0.9 * r));
    for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI / 2; pts.push(new T.Vector2(Math.max(0.001, r * Math.cos(a)), 1.25 * r * Math.sin(a))); }
    const geo = new T.LatheGeometry(pts, 32); geo.rotateZ(-Math.PI / 2); geo.computeVertexNormals();
    return geo;
  }
  function nacelleInfo(app) {
    const r = app.validResult, s = app.state; if (!r) return [];
    const v = r.values;
    return ['İçerik: ana yatak, ana mil, dişli kutusu, fren, jeneratör, çevirici, yaw sistemi', 'Rotor: ' + fmt(v.rpm, 1) + ' rpm · ' + REGION[v.region], 'Elektrik gücü: ' + VS.fmtPower(v.P * 1000) + ' / nominal ' + VS.fmtPower(s.Prated * 1000),
      'Yaw: ' + fmt(app.live.yaw, 0) + '° (hedef ' + s.windDir + '°) — sapma kaybı hesaplanmaz', '“Şeffaf kapak” ve patlatılmış görünüm iç donanımı gösterir'];
  }

  /* ---------------------------------------------------------------- sahne güncelleme ve animasyon */
  function pitchTarget(v, s) {
    if (v.region === 'stop') return 88;
    if (v.region === 'rated') return 2 + 22 * Math.max(0, Math.min(1, (v.vHub - v.vRated) / Math.max(1, s.cutOut - v.vRated)));
    return 0;
  }
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values;
    sc.nacLabel.set(VS.fmtPower(v.P * 1000) + ' · ' + fmt(v.rpm, 1) + ' rpm · ' + REGION[v.region]);
    sc.nacLabel.level(v.region === 'stop' ? 'bad' : v.region === 'idle' ? 'warn' : 'ok');
    sc.windLabel.set('Göbek rüzgârı ' + fmt(v.vHub, 1) + ' m/s · ' + s.windDir + '° (' + compass(s.windDir) + ')');
    sc.windLabel.level(v.vHub >= s.cutOut ? 'bad' : '');
    sc.ssLabel.set('Trafo merkezi · park ' + VS.fmtPower(v.farmP * 1000) + ' (' + s.n + ' türbin)');
    sc.mastLabel.set('Ölçüm ' + s.href + ' m · ' + fmt(s.gust && isFinite(live.v10g) ? live.v10g : s.v10, 1) + ' m/s');
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, d = sc.d;
    // rotor devri: motorun rpm değerine eylemsizlikle yaklaşır (fren ile duruş daha yavaş)
    const tau = v.rpm > live.rpmVis ? 4 : v.region === 'stop' ? 6 : 3;
    live.rpmVis += (v.rpm - live.rpmVis) * Math.min(1, dt / tau);
    if (live.rpmVis < 0.02 && v.rpm === 0) live.rpmVis = 0;
    live.rotAng -= live.rpmVis * Math.PI * 2 / 60 * dt;   // rüzgârdan bakınca saat yönü
    sc.rotor.rotation.x = live.rotAng;
    // kanat açısı (temsili): ~8°/s pitch hızı
    const pt = pitchTarget(v, s), dp = pt - live.pitch;
    live.pitch += Math.sign(dp) * Math.min(Math.abs(dp), 8 * dt);
    const pr = live.pitch * Math.PI / 180;
    sc.blades.forEach(b => { b.rotation.y = pr; });
    sc.pitchLabel.set('Kanat açısı ~' + fmt(live.pitch, 0) + '° (temsili)' + (v.region === 'rated' ? ' · Cp gereken ' + fmt(v.cpReq, 3) : ''));
    // yaw: nacelle +x ekseni rüzgârın geldiği yöne, YAW_RATE ile
    let e = ((s.windDir - live.yaw) % 360 + 540) % 360 - 180;
    live.yaw += Math.sign(e) * Math.min(Math.abs(e), YAW_RATE * dt);
    live.yaw = (live.yaw + 360) % 360;
    const yawRad = Math.PI / 2 - live.yaw * Math.PI / 180;
    sc.yaw.rotation.y = yawRad;
    const windRad = Math.PI / 2 - s.windDir * Math.PI / 180;      // rüzgârın geldiği yön (gerçek, anlık)
    sc.arrow.rotation.y = windRad;                                 // ok ucu yerel −x: rüzgârın gittiği yön
    sc.mastVane.rotation.y = windRad;
    if (!k.reducedMotion) sc.cups.rotation.y -= (s.gust && isFinite(live.v10g) ? live.v10g : s.v10) * 0.9 * dt;
    if (sc.vane) sc.vane.rotation.y = (s.windDir - live.yaw) * Math.PI / 180;
    // uçak ikaz lambası (yanıp söner; azaltılmış harekette sabit)
    live.blink += dt;
    sc.beacon.material = k.reducedMotion || (live.blink % 1.5) < 0.75 ? k.mats.ledRed : k.mats.ledOff;
    if (Math.abs(e) > 3) { sc.nacLabel.set(VS.fmtPower(v.P * 1000) + ' · ' + fmt(v.rpm, 1) + ' rpm · yönleniyor (' + fmt(Math.abs(e), 0) + '°)'); }
    // OG hat akışı
    if (sc.lineFlow) sc.lineFlow.speed = v.P > 0 ? 0.02 + 0.2 * v.P / s.Prated : 0;
    // rüzgâr çizgileri: rüzgârın gittiği yön = −(geldiği yön)
    const fx = -Math.cos(windRad), fz = Math.sin(windRad);    // yerel +x'in dünya karşılığı (cos, −sin) → ters
    const T = k.T, dm = sc._dm || (sc._dm = new T.Object3D());
    if (sc.streaks) {
      sc.streaks.visible = !k.reducedMotion && v.vHub > 0.3;
      if (sc.streaks.visible) {
        const span = sc.span;
        sc.str.forEach((p, i) => {
          const sp = v.vHub * Math.pow(Math.max(p.y, 2) / d.hub, s.alpha);
          p.u += sp * dt * 1.5;
          if (p.u > span) p.u -= 2 * span;
          dm.position.set(fx * p.u - fz * p.w, p.y, fz * p.u + fx * p.w);
          dm.rotation.set(0, Math.atan2(-fz, fx), 0);
          dm.scale.set(p.len * (0.5 + Math.min(1.5, sp / 10)), 0.18, 0.18);
          dm.updateMatrix(); sc.streaks.setMatrixAt(i, dm.matrix);
        });
        sc.streaks.instanceMatrix.needsUpdate = true;
      }
    }
    // arka plan türbinleri (aynı model ve rüzgâr: aynı devir, farklı faz)
    if (sc.chain && sc.bgPos.length) {
      const c = sc.chain;
      sc.bgPos.forEach((p, i) => {
        c[0].position.set(p[0], p[1] + d.hub + 0.9, p[2]); c[0].rotation.set(0, yawRad, 0);
        c[2].rotation.set(live.rotAng + i * 0.9, 0, 0);
        c[5].position.set(-0.12 * d.L, d.Hn * 0.24, 0); c[0].updateMatrixWorld(true);
        sc.bgNac.setMatrixAt(i * 2, c[5].matrixWorld);
        c[5].position.set(-0.12 * d.L, -d.Hn * 0.16, 0); c[5].scale.set(1, 0.82, 1); c[5].updateMatrixWorld(true);
        sc.bgNac.setMatrixAt(i * 2 + 1, c[5].matrixWorld); c[5].scale.set(1, 1, 1);
        sc.bgSpin.setMatrixAt(i, c[2].matrixWorld);
        for (let j = 0; j < 3; j++) {
          c[3].rotation.set(j * Math.PI * 2 / 3, 0, 0); c[4].rotation.set(0, pr, 0); c[3].updateMatrixWorld(true);
          sc.bgBlade.setMatrixAt(i * 3 + j, c[4].matrixWorld);
        }
      });
      sc.bgNac.instanceMatrix.needsUpdate = true; sc.bgSpin.instanceMatrix.needsUpdate = true; sc.bgBlade.instanceMatrix.needsUpdate = true;
    }
  }

  /* ---------------------------------------------------------------- 2D şema: tek hat + yan görünüş */
  function fitText(g, text, x, y, maxW, px, weight) {
    let p = px; g.font = (weight || '') + ' ' + p + 'px Inter, sans-serif';
    while (p > 8 && g.measureText(text).width > maxW) { p -= 0.5; g.font = (weight || '') + ' ' + p + 'px Inter, sans-serif'; }
    g.fillText(text, x, y);
  }
  function view2d(g, W, H, res, s, live) {
    const v = res.values, col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', amber: '#fcd34d', cyan: '#38bdf8' };
    const lv = v.region === 'stop' ? col.bad : v.region === 'idle' ? col.warn : col.ok;
    g.lineWidth = 2;
    // üst bant: tek hat (rotor → dişli → jeneratör → çevirici → trafo → OG hat / trafo merkezi)
    const x0 = 24, x1 = W - 64, y = 92, n = 6, stp = (x1 - x0) / n;
    const nodes = ['Rotor', 'Dişli', 'Jeneratör', 'Çevirici', 'Trafo', 'Trafo merk.'];
    const Pmech = v.region === 'rated' || v.region === 'partial' ? v.P / (s.etaMech * s.etaGen) : 0;
    const vals = [VS.fmtPower(Pmech * 1000), 'η ' + fmt(s.etaMech, 2), 'η ' + fmt(s.etaGen, 2), 'AC/DC/AC', '0,69/33 kV', VS.fmtPower(v.farmP * 1000)];
    nodes.forEach((nm, i) => {
      const x = x0 + stp * (i + 0.5);
      g.strokeStyle = i === 2 ? lv : col.line;
      if (i === 2) { g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.text; g.textAlign = 'center'; g.font = 'bold 12px Inter, sans-serif'; g.fillText('G', x, y + 4); }
      else if (i === 4) { g.beginPath(); g.arc(x - 6, y, 11, 0, Math.PI * 2); g.arc(x + 6, y, 11, 0, Math.PI * 2); g.stroke(); }
      else { g.strokeRect(x - 15, y - 12, 30, 24); }
      if (i < n - 1) { g.strokeStyle = v.P > 0 ? col.amber : col.line; g.setLineDash(v.P > 0 ? [5, 4] : []); g.lineDashOffset = -((live.gt || 0) * 12 % 9); g.beginPath(); g.moveTo(x + 18, y); g.lineTo(x + stp - 18, y); g.stroke(); g.setLineDash([]); }
      g.textAlign = 'center'; g.fillStyle = col.text; fitText(g, nm, x, y + 30, stp - 6, 11);
      g.fillStyle = col.dim; fitText(g, vals[i], x, y + 45, stp - 6, 11);
    });
    g.textAlign = 'left'; g.fillStyle = col.dim; fitText(g, 'Mekanik güç → elektrik: P = P_mek·η_mek·η_jen · park ' + s.n + ' türbin (iz kaybı hariç)', x0, y + 66, x1 - x0, 11);
    // alt sol: ölçekli yan görünüş ve rüzgâr profili
    const top = y + 92, gy = H - 54, half = W < 560 ? W - 20 : W * 0.46;
    const Hm = s.hub + s.D / 2, sc = Math.max(0.1, (gy - top) / Hm), tx = Math.max(90, half * 0.62);
    g.strokeStyle = '#4b6a3a'; g.beginPath(); g.moveTo(10, gy); g.lineTo(half, gy); g.stroke();
    const hy = gy - s.hub * sc;
    g.fillStyle = '#c9d2dc'; g.beginPath(); g.moveTo(tx - 5, gy); g.lineTo(tx - 2.5, hy); g.lineTo(tx + 2.5, hy); g.lineTo(tx + 5, gy); g.closePath(); g.fill();
    g.fillRect(tx - 6, hy - 5, 20, 10);
    g.strokeStyle = col.text; g.lineWidth = 3; g.beginPath(); g.moveTo(tx - 9, hy - s.D / 2 * sc); g.lineTo(tx - 9, hy + s.D / 2 * sc); g.stroke(); g.lineWidth = 2;
    g.fillStyle = col.text; g.beginPath(); g.arc(tx - 9, hy, 3.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col.cyan; g.fillStyle = col.cyan;
    for (let i = 1; i <= 6; i++) {   // profil okları: göbek değeri motordan, şekil üstel profil
      const h = Hm * i / 6.2, vv = v.vHub * Math.pow(h / s.hub, s.alpha), len = Math.min(tx - 36, vv * 5);
      const yy = gy - h * sc;
      g.beginPath(); g.moveTo(tx - 18 - len, yy); g.lineTo(tx - 18, yy); g.stroke();
      g.beginPath(); g.moveTo(tx - 16, yy); g.lineTo(tx - 22, yy - 4); g.lineTo(tx - 22, yy + 4); g.fill();
    }
    g.textAlign = 'left'; g.fillStyle = col.text; g.font = '12px Inter, sans-serif';
    g.fillText('v_hub ' + fmt(v.vHub, 2) + ' m/s', tx + 18, hy - 6);
    g.fillStyle = col.dim; g.fillText(s.hub + ' m · D ' + s.D + ' m', tx + 18, hy + 10);
    fitText(g, 'v_ref ' + fmt(s.gust && isFinite(live.v10g) ? live.v10g : s.v10, 1) + ' m/s @ ' + s.href + ' m · ρ ' + fmt(v.rho, 3) + ' kg/m³', 12, gy + 20, half - 12, 11);
    // alt sağ (geniş ekranda) ya da yan görünüşün üstü: özet
    const lines = [
      [REGION[v.region], lv, 'bold '],
      ['P = ½·ρ·A·Cp·v³·η = ' + VS.fmtPower(v.P * 1000), col.text],
      ['Rüzgâr gücü ' + VS.fmtPower(v.Pwind * 1000) + ' · Betz üst sınırı ' + VS.fmtPower(v.Pwind * 1000 * R.BETZ), col.text],
      [(v.region === 'rated' ? 'Gereken Cp ' + fmt(v.cpReq, 3) : 'Cp ' + fmt(s.cp, 3)) + ' ≤ 16/27 ≈ 0,593', col.text],
      ['Rotor ' + fmt(v.rpm, 1) + ' rpm · uç hızı ' + fmt(v.tip, 1) + ' m/s', col.text],
      ['Nominal rüzgâr hızı ' + fmt(v.vRated, 1) + ' m/s', col.text],
      ['AEP ' + VS.fmtEnergy(v.aep) + ' · KF %' + fmt(v.cf * 100, 1) + ' (varsayımsal)', col.warn]
    ];
    const lx = W < 560 ? tx + 18 : half + 20, lw = (W < 560 ? W - lx - 10 : x1 - lx), ly = W < 560 ? top + 6 : top + 20;
    lines.forEach((l, i) => { g.fillStyle = l[1]; fitText(g, l[0], lx, ly + i * (W < 560 ? 16 : 22), lw, W < 560 ? 10.5 : 13, l[2]); });
  }
  /* ---------------------------------------------------------------- senaryolar */
  const st = o => Object.assign(defaults(), o);
  VS.register({
    id: 'res', title: '3D RES / Rüzgâr Enerjisi Simülasyonu',
    defaults: defaults,
    initLive: s => ({ rpmVis: 0, rotAng: 0, pitch: 0, yaw: s.windDir, blink: 0, gt: 0, acc: 0, v10g: NaN, hist: [] }),
    autoRun: true,
    startText: 'Simülasyon çalışıyor: rotor motorun hesapladığı devre yaklaşıyor.',
    start: app => { app.live.hist = []; app.live.gt = 0; app._startedOnce = true; },
    scenarios: [
      { id: 'partial', name: 'Kısmi yük · 3,6 MW türbin, 7 m/s (10 m)', desc: 'Göbekte ~9,7 m/s: güç v³ ile artar, Cp sabit (maks. güç takibi).', state: st({}) },
      { id: 'rated', name: 'Nominal bölge · güçlü rüzgâr', desc: 'Göbek hızı nominal hızın üstünde: güç sınırlanır, gereken Cp düşer, kanat açısı artar (görsel temsili).', state: st({ v10: 11 }) },
      { id: 'storm', name: 'Fırtına · cut-out ve korumalı duruş', desc: 'Dalgalı fırtınada göbek hızı 25 m/s’yi aşınca kanatlar rüzgâra paralel olur, rotor durur. Yeniden devreye girme gecikmesi modellenmez.', state: st({ v10: 17, gust: true }), start: true },
      { id: 'calm', name: 'Zayıf rüzgâr · devreye girme altı', desc: 'Göbek hızı cut-in altında: üretim yok.', state: st({ v10: 1.8 }) },
      { id: 'gusty', name: 'Dalgalı rüzgâr · güç–zaman', desc: 'Temsili dalgalanma: anlık güç v³ ile oynar; güç–zaman grafiğini izleyin.', state: st({ v10: 6.5, gust: true }), start: true },
      { id: 'highland', name: 'Yüksek rakım · düşük hava yoğunluğu', desc: '1800 m ve 5 °C: ρ düşer, aynı hızda güç azalır.', state: st({ alt: 1800, T: 5, v10: 7.5, alpha: 0.2 }) },
      { id: 'small', name: 'Küçük türbin · 250 kW, 30 m rotor', desc: 'Küçük ölçekli türbin: yüksek devir, kısa kule, 4 türbinlik park.', state: st({ D: 30, hub: 40, Prated: 250, rpmMax: 40, n: 4, cutIn: 3, cutOut: 25, vMean: 6 }) }
    ],
    controls: controls,
    compute: (s, app) => R.compute(input(s, app)),
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res) => res.values.region === 'stop' ? { level: 'bad', text: 'Korumalı duruş (cut-out)' } : null,
    reportInputs: (s, app) => (s.gust && app.live && isFinite(app.live.v10g) ? [{ group: 'Rüzgâr', label: 'Anlık v10 (dalgalanma)', value: fmt(app.live.v10g, 2, 'm/s') }] : []),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-30, 30], background: 0xb3c8de },
    view2d: view2d
  });
})();
