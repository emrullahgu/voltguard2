/* VoltSim · 3D GES (Çatı Güneş Santrali) Simülasyonu
 * Hesap: VoltSimEngine.ges (Spencer güneş konumu, Meinel açık gök × Kasten–Czeplak bulut, Liu–Jordan düzlem ışınımı,
 * NOCT hücre sıcaklığı, sıra arası gölge, string Voc/MPPT kontrolü, öz tüketim ve geri dönüş) ve
 * VoltSimEngine.ext.ges (js/voltsim/calc/ges.js: yerleşim, string/MPPT ataması, geometrik engel gölgesi, bifasiyal kazanç,
 * string sigortası / DC SPD / AC kesici kontrolleri, ihracat sınırlayıcı, ay × saat üretim matrisi).
 * Sahne: hesap sonucunu gösterir (güneş ve gölgeler, MPPT renkleri, engel gölgesi, inverter DC ayırıcıları, enerji akışı).
 * Hiçbir sonuç animasyondan türetilmez. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const G = E.ges, X = E.ext.ges;
  const DEG = Math.PI / 180;
  const clamp = E.clamp;
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const MON3 = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const MONTH_MID = G.MONTH_MID; // motorun temsilî gün tablosu
  const CITY_LIST = Object.keys(G.CITIES);
  const HOURS_PER_S = 0.5; // simülasyon: 1 saat ≈ 2 s
  const INV_KEYS = ['Pac', 'vdcMax', 'mpptMin', 'mpptMax', 'nMppt', 'inPerMppt', 'iscMppt', 'invEff'];
  const MOD_KEYS = ['Pmod', 'Voc', 'Vmp', 'Isc', 'betaVoc', 'betaVmp', 'gamma', 'noct', 'moduleLen', 'moduleW', 'fuseMax', 'bifacial', 'bifi'];

  function invFields(id, count) {
    const m = X.INVERTERS[id];
    return { invSel: id, invPac: m.Pac, invCount: count, vdcMax: m.vdcMax, mpptMin: m.mpptMin, mpptMax: m.mpptMax, nMppt: m.nMppt, inPerMppt: m.inPerMppt, iscMppt: m.iscMppt, invEff: m.invEff };
  }
  function modFields(id) { const m = X.MODULES[id]; const o = { modSel: id }; MOD_KEYS.forEach(k => { o[k] = m[k]; }); return o; }

  function defaults() {
    return Object.assign({
      city: 'İzmir', lat: 38.42, lon: 27.14,
      month: 6, hour: 12, Ta: 28, cloud: 0.1, albedo: 0.2,
      roof: 'flat', roofArea: 2400, azimuth: 0, tilt: 15, rows: 12, nMod: 360, pitch: 3.6
    }, modFields('m540'), { perString: 18 }, invFields('i80', 2), {
      dcLoss: 14, soiling: 0, Tmin: -3, Tmax: 40,
      strFuse: 0, spdOn: true, spdUcpv: 1100, acBrk: 160, rcd: 'A300', expLimit: false, expKW: 0,
      consumption: 450000, profile: 'tek', price: 5, exportPrice: 3, capex: 4800000,
      obsOn: false, obsX: 0, obsZ: 0, obsW: 3, obsD: 2, obsH: 2.5,
      invOff: [], showStrings: true,
      pvgisMonthly: null, pvgisSource: ''
    });
  }

  /* ---------------------------------------------------------------- yardımcılar */
  function num(v, d, lo, hi) { v = Number(v); if (!isFinite(v)) v = d; return clamp(v, lo, hi); }
  function fmtHour(h) {
    h = ((h % 24) + 24) % 24; let hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh = (hh + 1) % 24; mm = 0; }
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }
  function latLon(s) { const c = G.CITIES[s.city]; return c ? { lat: c[0], lon: c[1] } : { lat: Number(s.lat), lon: Number(s.lon) }; }
  function parseMonthly(txt) {
    const t = String(txt || '').trim();
    if (!t) return null;
    let parts = t.split(/[\s;]+/).filter(Boolean);
    if (parts.length === 1 && (t.match(/,/g) || []).length >= 11) parts = t.split(',');
    const vals = parts.map(p => Number(p.replace(',', '.')));
    if (vals.length !== 12 || vals.some(x => !isFinite(x) || x < 0 || x > 400)) throw new Error('12 aylık değer girin (kWh/kWp, 0–400). Ayırıcı: boşluk veya noktalı virgül; ondalık için virgül veya nokta.');
    return vals;
  }
  const fmtMonthly = v => Array.isArray(v) ? v.map(x => fmt(x, 1)).join('; ') : '';
  function sunDir(T, sun, out) {
    // sahne: +x doğu, +z güney, +y yukarı. Motor azimutu güneyden, batı pozitif.
    const el = sun.elevation * DEG, az = sun.azimuth * DEG;
    return (out || new T.Vector3()).set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const obstacleOf = s => ({ x: Number(s.obsX), z: Number(s.obsZ), w: num(s.obsW, 3, 0.3, 30), d: num(s.obsD, 2, 0.3, 30), h: num(s.obsH, 2.5, 0.2, 20) });
  function layoutOf(s) {
    return X.arrayLayout({ nMod: num(s.nMod, 1, 1, 20000), rows: s.rows, moduleLen: s.moduleLen, moduleW: s.moduleW, tilt: s.tilt, pitch: s.pitch, roof: s.roof });
  }

  /* ---------------------------------------------------------------- model: durum → motor girdisi + ek hesaplar */
  function model(s) {
    const ll = latLon(s);
    const Ns = Math.max(1, Math.round(num(s.perString, 1, 1, 40)));
    const plan = X.stringPlan({ nMod: s.nMod, perString: Ns, nInv: num(s.invCount, 1, 1, 10000), nMppt: s.nMppt, inPerMppt: s.inPerMppt });
    const fleet = X.activeFleet(plan, Ns, s.invOff, num(s.invPac, 1, 0.001, 1e5));
    const gain = s.bifacial ? X.bifacialGain(s.bifi, s.albedo) : 0;
    const lossRaw = X.combineLoss(num(s.dcLoss, 0, 0, 100), num(s.soiling, 0, 0, 100));
    const ly = layoutOf(s);
    let obs = null;
    if (s.obsOn) {
      const sun = G.sunPosition(ll.lat, ll.lon, MONTH_MID[clamp(Math.round(num(s.month, 6, 1, 12)), 1, 12) - 1], num(s.hour, 12, 0, 24), 3);
      obs = X.obstacleShade(ly, obstacleOf(s), X.sunLocal(sun, s.azimuth), ly.n > 4000 ? 2 : 3, ly.n > 4000 ? 3 : 5);
    }
    const inp = Object.assign({}, s, ll, {
      Pmod: Number(s.Pmod) * (1 + gain),
      nMod: Math.max(1, Math.round(num(s.nMod, 1, 1, 1e6)) - fleet.offModules),
      Pac: Math.max(0.001, fleet.PacActive),
      stringsPerMppt: Math.max(1, plan.maxPerMppt),
      dcLoss: Math.min(30, lossRaw),
      pitch: s.roof === 'trapez' ? 0 : s.pitch,
      obstacleShade: obs ? obs.frac : 0
    });
    return { ll: ll, Ns: Ns, plan: plan, fleet: fleet, gain: gain, lossRaw: lossRaw, ly: ly, obs: obs, inp: inp };
  }

  // pahalı türev hesaplar için önbellek (saat ve ay hariç anahtar)
  const cache = {};
  function cached(name, key, fn) { if (cache[name] && cache[name].key === key) return cache[name].v; const v = fn(); cache[name] = { key: key, v: v }; return v; }
  function keyOf(inp, omit) { const o = Object.assign({}, inp); (omit || []).forEach(k => { delete o[k]; }); return JSON.stringify(o); }

  /** Seçili ayın temsilî gününde engelin yol açtığı enerji kaybı (kWh): her yarım saatte engel gölgesi + motor. */
  function obstacleDayLoss(m, s) {
    if (!m.obs) return 0;
    return cached('obsDay', keyOf(m.inp, ['hour', 'obstacleShade', 'invOff']) + JSON.stringify(obstacleOf(s)), () => {
      let loss = 0;
      for (let t = 4.25; t < 21; t += 0.5) {
        const sun = G.sunPosition(m.ll.lat, m.ll.lon, MONTH_MID[s.month - 1], t, 3);
        if (sun.elevation <= 0) continue;
        const f = X.obstacleShade(m.ly, obstacleOf(s), X.sunLocal(sun, s.azimuth), 2, 3).frac;
        if (f <= 0) continue;
        const a = G.compute(Object.assign({}, m.inp, { hour: t, obstacleShade: 0 })), b = G.compute(Object.assign({}, m.inp, { hour: t, obstacleShade: f }));
        if (a.ok && b.ok) loss += (a.values.now.Pac - b.values.now.Pac) / 1000 * 0.5;
      }
      return loss;
    });
  }
  function heatMatrix(m) { return cached('heat', keyOf(m.inp, ['hour', 'month', 'obstacleShade', 'Ta']), () => X.monthHour(Object.assign({}, m.inp, { obstacleShade: 0 }))); }

  function compute(s) {
    const m = model(s);
    const errs = [];
    if (m.plan.nStrings < 1) errs.push('String başına modül sayısı panel adedinden büyük: en az bir string oluşmalı.');
    if (m.fleet.onInv < 1) errs.push('En az bir inverterin DC ayırıcısı kapalı (devrede) olmalı.');
    if (!(Number(s.invCount) >= 1)) errs.push('İnverter adedi en az 1 olmalı.');
    const r = G.compute(m.inp);
    if (errs.length) { r.errors = r.errors.concat(errs); r.ok = false; }
    if (!r.ok) return r;
    const v = r.values, ck = (id, label, status, detail, ref) => r.checks.push({ id: id, label: label, status: status, detail: detail, ref: ref || null });
    const Np = m.plan.maxPerMppt;
    ck('inputs', 'MPPT giriş sayısı', m.plan.overInputs ? 'fail' : 'ok', m.plan.nStrings + ' string → ' + m.plan.M + ' MPPT (' + s.invCount + ' × ' + s.nMppt + '); MPPT başına en çok ' + Np + ' string / ' + s.inPerMppt + ' giriş.' + (m.plan.overInputs ? ' Giriş yetmiyor: dış birleştirme kutusu, daha fazla MPPT veya inverter gerekir.' : ''));
    const fu = X.stringFuse(Number(s.Isc), Np, Number(s.fuseMax), Number(s.strFuse));
    ck('fuse', 'String sigortası (IEC 62548-1)', fu.ok ? 'ok' : 'fail', (fu.needed ? 'Gerekli: (Np − 1)·1,25·Isc = ' + fmt(fu.reverse, 1) + ' A > modül maks. seri sigorta ' + s.fuseMax + ' A. ' : 'Np = ' + Np + ': ters akım modül sınırını aşmıyor, sigorta zorunlu değil. ') + 'Uygun aralık ' + fmt(fu.lo, 1) + '–' + fmt(fu.hi, 1) + ' A' + (fu.suggest ? ' (ör. ' + fu.suggest + ' A gPV)' : '') + '; seçili: ' + (s.strFuse ? s.strFuse + ' A' : 'yok') + '.', 'IEC 62548-1');
    if (s.spdOn) { const sp = X.spdCheck(Number(s.spdUcpv), v.string.vocCold); ck('spd', 'DC parafudr (SPD Tip 2) Ucpv', sp.ok ? 'ok' : 'fail', 'Ucpv ' + s.spdUcpv + ' V ≥ Voc(Tmin) ' + fmt(v.string.vocCold, 0) + ' V olmalı.', 'TS EN 61643-31'); }
    else ck('spd', 'DC parafudr (SPD)', 'warn', 'DC tarafta SPD seçilmedi. Gereklilik yıldırım risk değerlendirmesine ve kablo uzunluğuna bağlıdır.', 'TS HD 60364-7-712');
    const ac = X.acBreaker(Number(s.invPac), 400, Number(s.acBrk));
    ck('acb', 'İnverter AC çıkış kesicisi', ac.ok ? 'ok' : 'fail', 'Iac ≈ ' + fmt(ac.Iac, 1) + ' A; tipik seçim In ≥ 1,25·Iac = ' + fmt(ac.need, 1) + ' A' + (ac.suggest ? ' (ör. ' + ac.suggest + ' A)' : '') + '; seçili ' + s.acBrk + ' A. Üretici önerisi esastır.');
    ck('rcd', 'Kaçak akım koruması', s.rcd === 'none' ? 'warn' : 'info', { none: 'AC tarafta RCD seçilmedi; TN sistemde gereklilik devre türüne göre değerlendirilmelidir.', A300: 'A tipi 300 mA (yangın). İnverter DC kaçak akım üretemeyeceğini beyan etmiyorsa B tipi gerekir.', B300: 'B tipi 300 mA: DC kaçak akımlara duyarlı.', A30: 'A tipi 30 mA: büyük inverterlerde kapasitif kaçak akımla istenmeyen açma olabilir.' }[s.rcd] || '', 'TS HD 60364-7-712');
    const nowLoad = X.loadAt(s.profile, Number(s.consumption), Number(s.hour));
    const ex = s.expLimit ? X.exportLimit(v.today.pts, s.profile, Number(s.consumption), Number(s.expKW)) : null;
    if (ex) ck('exp', 'İhracat sınırlayıcı (' + fmt(s.expKW, 0, 'kW') + ')', 'info', 'Temsilî günde kısılan üretim ≈ ' + fmt(ex.cutKWh, 0, 'kWh') + ' (en çok ' + fmt(ex.maxCutKW, 1, 'kW') + '). Yük profilden tahmin edilir; gerçek sistem sayaç ölçümüyle sınırlar.');
    if (m.fleet.offInv) ck('off', 'DC ayırıcısı açık inverter', 'warn', m.fleet.offInv + ' inverter devre dışı: ' + m.fleet.offStrings + ' string (' + m.fleet.offModules + ' modül) üretim yapmıyor.');
    if (s.soiling > 0) ck('soil', 'Kirlenme', s.soiling > 5 ? 'warn' : 'info', '%' + fmt(s.soiling, 1) + ' kirlenme, sistem kaybıyla birleşik %' + fmt(m.lossRaw, 1) + (m.lossRaw > 30 ? ' (motor sınırı %30 ile hesaplandı)' : '') + '. 3D’de modüllere tıklayıp temizleyebilirsiniz.');
    let obsLoss = 0;
    if (m.obs) {
      obsLoss = obstacleDayLoss(m, s);
      if (m.obs.clash.length) ck('clash', 'Engel modüllerle çakışıyor', 'fail', m.obs.clash.length + ' modül engelin altında kalıyor; engeli taşıyın ya da modülleri kaldırın.');
      ck('obs', 'Çatı engeli gölgesi', m.obs.frac > 0.02 ? 'warn' : 'ok', 'Şu an direkt ışınımın %' + fmt(m.obs.frac * 100, 1) + '’i gölgede · temsilî günde kayıp ≈ ' + fmt(obsLoss, 1, 'kWh') + '. Yıllık sonuç engel gölgesini içermez.');
    }
    r.assumptions = r.assumptions.concat([
      'Inverter filosu: ' + s.invCount + ' × ' + fmt(s.invPac, 0) + ' kW; stringler MPPT’lere bitişik bloklar hâlinde dağıtılır, motor en kalabalık MPPT ile kontrol eder.',
      s.bifacial ? 'Bifasiyal kazanç = φ·ρ·0,35 = %' + fmt(m.gain * 100, 1) + ' (çatı üstü eğik sıra görünüm katsayısı varsayımı); modül gücüne eklenmiştir.' : 'Tek yüzlü modül.',
      'Kirlenme kaybı sistem kaybıyla çarpımsal birleştirilir.',
      'Engel gölgesi: ışın–kutu kesişimiyle modül başına 15 nokta (büyük dizilerde 6); anlık değer motorun direkt ışınım gölgesine eklenir, sıra gölgesiyle örtüşme çift sayılabilir.'
    ]);
    r.formulas = r.formulas.concat(['Kayıp = 1 − (1 − sistem)(1 − kirlenme)', 'String sigortası: (Np − 1)·1,25·Isc > I_mod,maks ⇒ gerekli; 1,5·Isc ≤ In ≤ 2,4·Isc']);
    v.ext = { installedKWp: Number(s.nMod) * Number(s.Pmod) / 1000, gain: m.gain, nStrings: m.plan.nStrings, M: m.plan.M, maxPerMppt: Np, offInv: m.fleet.offInv, offStrings: m.fleet.offStrings, obsFrac: m.obs ? m.obs.frac : 0, obsClash: m.obs ? m.obs.clash.length : 0, obsLoss: obsLoss, nowLoad: nowLoad, expCut: ex ? ex.cutKWh : 0, expNowCut: s.expLimit ? Math.max(0, v.now.Pac / 1000 - nowLoad - Number(s.expKW)) : 0, lossRaw: m.lossRaw };
    // büyük diziler JSON'a girmesin
    Object.defineProperty(v, '_m', { value: m, enumerable: false });
    Object.defineProperty(v, '_exCurve', { value: ex ? ex.curve : null, enumerable: false });
    return r;
  }

  /* ---------------------------------------------------------------- kontroller */
  function setInvOff(app, i, off) {
    const a = new Set(app.state.invOff || []);
    if (off) {
      const n = Math.round(num(app.state.invCount, 1, 1, 10000));
      if (!a.has(i) && n - a.size <= 1) { VS.toast('Simülasyonda en az bir inverter devrede kalmalıdır.', 'bad'); return; }
      a.add(i);
    } else a.delete(i);
    app.state.invOff = Array.from(a).sort((x, y) => x - y);
  }
  function controls(s, app) {
    const r = app.validResult && app.validResult.values;
    const custom = !G.CITIES[s.city];
    const flat = s.roof !== 'trapez';
    const ly = layoutOf(s);
    const xr = Math.ceil(ly.rowLen / 2 + 8), zr = Math.ceil(ly.arrD / 2 + 8);
    const n = Math.round(num(s.invCount, 1, 1, 10000));
    return [
      { title: 'Konum ve zaman', items: [
        { type: 'select', key: 'city', label: 'İl', rebuild: true, options: CITY_LIST.map(c => [c, c]).concat([['custom', 'Özel koordinat…']]),
          onChange: (v, a) => { const c = G.CITIES[v]; if (c) { a.state.lat = c[0]; a.state.lon = c[1]; } a.renderControls(); a.invalidate(); } },
        custom ? { type: 'number', key: 'lat', label: 'Enlem', min: 35, max: 43, step: 0.01, unit: '°', digits: 2, help: 'Türkiye sınırları için 35–43° K.' } : null,
        custom ? { type: 'number', key: 'lon', label: 'Boylam', min: 25, max: 45, step: 0.01, unit: '°', digits: 2 } : null,
        { type: 'select', key: 'month', label: 'Ay (temsilî gün)', options: MONTHS.map((m, i) => [i + 1, m]) },
        { type: 'range', key: 'hour', label: 'Saat (yerel, UTC+3)', min: 4, max: 21, step: 0.25, fmt: fmtHour, help: '“Simülasyonu başlat” günü saat saat oynatır (1 saat ≈ 2 s).' },
        { type: 'range', key: 'Ta', label: 'Ortam sıcaklığı', min: -20, max: 45, step: 1, unit: '°C', help: 'Anlık hesapta seçili saatin sıcaklığı; günlük eğride bu değer etrafında ±6 °C gün içi değişim varsayılır.' },
        { type: 'range', key: 'cloud', label: 'Bulutluluk', min: 0, max: 1, step: 0.05, fmt: v => '%' + fmt(v * 100, 0), help: 'Senaryo girdisidir (Kasten–Czeplak). Sahaya özgü üretim için aşağıya PVGIS verisi girin.' },
        { type: 'range', key: 'albedo', label: 'Çatı/zemin yansıtma (albedo)', min: 0, max: 0.9, step: 0.05, digits: 2, help: 'Beyaz membran ≈ 0,6–0,8; çakıl ≈ 0,2. Bifasiyal modülde arka yüz kazancını belirler.' }
      ] },
      { title: 'Çatı ve yerleşim', items: [
        { type: 'seg', key: 'roof', label: 'Çatı tipi', options: [['flat', 'Düz çatı · balastlı sıra'], ['trapez', 'Trapez sac · raylı']] },
        { type: 'number', key: 'roofArea', label: 'Kullanılabilir çatı alanı', min: 0, max: 1e6, step: 10, unit: 'm²' },
        { type: 'range', key: 'azimuth', label: flat ? 'Panel azimutu (güney = 0°, batı +)' : 'Çatı yüzü azimutu (güney = 0°, batı +)', min: -90, max: 90, step: 5, unit: '°', help: 'Sahnede bina ve paneller birlikte döner; kuzey oku sabittir.' },
        { type: 'range', key: 'tilt', label: flat ? 'Panel eğimi' : 'Çatı eğimi (paneller eğime paralel)', min: 0, max: flat ? 45 : 30, step: 1, unit: '°' },
        { type: 'number', key: 'nMod', label: 'Panel adedi', min: 1, max: 20000, step: 1 },
        { type: 'number', key: 'rows', label: 'Sıra sayısı', min: 1, max: 500, step: 1 },
        flat ? { type: 'range', key: 'pitch', label: 'Sıra aralığı (pitch)', min: 0, max: 12, step: 0.1, unit: 'm', digits: 1, help: 'Bir sıranın ön kenarından sonrakinin ön kenarına. 0: sıra arası gölge hesaplanmaz.' } : null,
        r ? { type: 'note', html: 'Sıra başına <b>' + ly.perRow + '</b> modül · dizi ' + fmt(ly.rowLen, 0) + ' × ' + fmt(ly.arrD, 0) + ' m · gölge (şimdi) <b>%' + fmt(r.shade * 100, 0) + '</b>' } : null
      ] },
      { title: 'Modül (veri sayfası)', collapsed: true, summary: 'Model, elektriksel ve ısıl değerler', items: [
        { type: 'select', key: 'modSel', label: 'Modül', rebuild: true, options: Object.keys(X.MODULES).map(k => [k, X.MODULES[k].name]).concat([['custom', 'Özel (kendi veri sayfanız)']]),
          onChange: (v, a) => { if (X.MODULES[v]) Object.assign(a.state, modFields(v)); a.renderControls(); a.invalidate(); } },
        { type: 'number', key: 'Pmod', label: 'Pmax (STC)', min: 50, max: 800, step: 5, unit: 'Wp' },
        { type: 'number', key: 'Voc', label: 'Voc', min: 1, max: 100, step: 0.1, unit: 'V', digits: 1 },
        { type: 'number', key: 'Vmp', label: 'Vmp', min: 1, max: 100, step: 0.1, unit: 'V', digits: 1 },
        { type: 'number', key: 'Isc', label: 'Isc', min: 0.1, max: 30, step: 0.1, unit: 'A', digits: 1 },
        { type: 'number', key: 'betaVoc', label: 'βVoc', min: -1, max: 0, step: 0.01, unit: '%/°C', digits: 2 },
        { type: 'number', key: 'betaVmp', label: 'βVmp', min: -1, max: 0, step: 0.01, unit: '%/°C', digits: 2 },
        { type: 'number', key: 'gamma', label: 'γPmax', min: -1, max: 0, step: 0.01, unit: '%/°C', digits: 2 },
        { type: 'number', key: 'noct', label: 'NOCT', min: 35, max: 60, step: 1, unit: '°C' },
        { type: 'number', key: 'moduleLen', label: 'Modül boyu (eğim yönünde)', min: 0.5, max: 3, step: 0.001, unit: 'm', digits: 3 },
        { type: 'number', key: 'moduleW', label: 'Modül eni', min: 0.5, max: 2, step: 0.001, unit: 'm', digits: 3 },
        { type: 'number', key: 'fuseMax', label: 'Maks. seri sigorta değeri', min: 5, max: 60, step: 1, unit: 'A' },
        { type: 'toggle', key: 'bifacial', label: 'Çift yüzlü (bifasiyal) modül', rebuild: true },
        s.bifacial ? { type: 'range', key: 'bifi', label: 'Bifasiyallik katsayısı φ', min: 0.5, max: 0.95, step: 0.01, digits: 2 } : null,
        { type: 'note', text: 'Önayarlar örnek veri sayfası değerleridir; projede kullanılacak modülün veri sayfası esastır.' }
      ] },
      { title: 'String ve inverter', items: [
        { type: 'range', key: 'perString', label: 'String başına modül', min: 1, max: 40, step: 1 },
        { type: 'select', key: 'invSel', label: 'İnverter modeli', rebuild: true, options: Object.keys(X.INVERTERS).map(k => [k, X.INVERTERS[k].name]).concat([['custom', 'Özel (kendi veri sayfanız)']]),
          onChange: (v, a) => { if (X.INVERTERS[v]) Object.assign(a.state, invFields(v, a.state.invCount)); a.renderControls(); a.invalidate(); } },
        { type: 'number', key: 'invCount', label: 'İnverter adedi', min: 1, max: 10000, step: 1, rebuild: true },
        { type: 'number', key: 'invPac', label: 'Birim AC gücü', min: 1, max: 5000, step: 1, unit: 'kW' },
        { type: 'number', key: 'nMppt', label: 'MPPT sayısı', min: 1, max: 40, step: 1 },
        { type: 'number', key: 'inPerMppt', label: 'MPPT başına string girişi', min: 1, max: 40, step: 1 },
        { type: 'number', key: 'vdcMax', label: 'Maks. DC giriş gerilimi', min: 100, max: 1500, step: 10, unit: 'V' },
        { type: 'number', key: 'mpptMin', label: 'MPPT alt sınır', min: 50, max: 1500, step: 10, unit: 'V' },
        { type: 'number', key: 'mpptMax', label: 'MPPT üst sınır', min: 50, max: 1500, step: 10, unit: 'V' },
        { type: 'number', key: 'iscMppt', label: 'MPPT maks. kısa devre akımı', min: 1, max: 500, step: 1, unit: 'A' },
        { type: 'range', key: 'invEff', label: 'Verim (Avrupa)', min: 90, max: 99.5, step: 0.1, unit: '%', digits: 1 },
        r ? { type: 'note', html: '<b>' + r.ext.nStrings + '</b> string × ' + s.perString + ' modül → <b>' + r.ext.M + '</b> MPPT · MPPT başına en çok <b>' + r.ext.maxPerMppt + '</b> string · toplam AC <b>' + fmt(n * s.invPac, 0, 'kW') + '</b> · Voc(Tmin) <b>' + fmt(r.string.vocCold, 0, 'V') + '</b>' } : null,
        { type: 'custom', render: (box, a) => {
          box.appendChild(VS.el('span', { class: 'vs-field__label', text: 'DC ayırıcılar (inverter başına)' }));
          const wrap = VS.el('div', { class: 'vs-btns', style: n > 12 ? 'max-height:168px;overflow:auto' : null });
          const off = new Set(s.invOff || []);
          for (let i = 0; i < n; i++) {
            const on = !off.has(i);
            wrap.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', 'aria-pressed': on ? 'true' : 'false', style: 'flex:0 0 auto;min-width:76px', text: 'İNV-' + (i + 1) + (on ? ' · açık' : ' · kapalı'), title: on ? 'DC ayırıcıyı aç (devre dışı bırak)' : 'DC ayırıcıyı kapat (devreye al)', onclick: () => { setInvOff(a, i, on); a.renderControls(); a.invalidate(); } }));
          }
          box.appendChild(wrap);
        } }
      ] },
      { title: 'DC/AC koruma ve ölçüm', collapsed: true, summary: 'Sigorta, parafudr, kesici, RCD, ihracat sınırı', items: [
        { type: 'select', key: 'strFuse', label: 'String sigortası (gPV)', options: [[0, 'Yok']].concat(X.FUSES_DC.map(f => [f, f + ' A gPV'])) },
        { type: 'toggle', key: 'spdOn', label: 'DC parafudr (SPD Tip 2)', rebuild: true },
        s.spdOn ? { type: 'select', key: 'spdUcpv', label: 'SPD Ucpv', options: [600, 1000, 1100, 1200, 1500].map(v => [v, v + ' V DC']) } : null,
        { type: 'select', key: 'acBrk', label: 'İnverter AC çıkış kesicisi', options: X.BREAKERS.map(b => [b, b + ' A']) },
        { type: 'select', key: 'rcd', label: 'AC kaçak akım koruması', options: [['none', 'Yok'], ['A30', 'A tipi 30 mA'], ['A300', 'A tipi 300 mA'], ['B300', 'B tipi 300 mA']] },
        { type: 'toggle', key: 'expLimit', label: 'İhracat sınırlayıcı / sıfır ihracat rölesi', rebuild: true },
        s.expLimit ? { type: 'number', key: 'expKW', label: 'İzin verilen ihracat', min: 0, max: 1e5, step: 1, unit: 'kW', help: '0 kW: sıfır ihracat. Fazla üretim inverterlerden kısılır.' } : null,
        { type: 'note', text: 'Bağlantı noktasında çift yönlü sayaç dağıtım şirketi tarafından belirlenir. Kontroller ön değerlendirmedir; IEC 62548-1, TS HD 60364-7-712 ve üretici talimatları esastır.' }
      ] },
      { title: 'Kayıplar ve sıcaklık', items: [
        { type: 'range', key: 'dcLoss', label: 'Sistem kayıpları', min: 0, max: 30, step: 0.5, unit: '%', digits: 1, help: 'Kablo, uyumsuzluk, LID vb. toplamı. %14, PVGIS’in varsayılan sistem kaybıdır.' },
        { type: 'range', key: 'soiling', label: 'Kirlenme (toz, kuş pisliği)', min: 0, max: 20, step: 0.5, unit: '%', digits: 1, help: '3D’de modüllere tıklayıp “Panelleri temizle” ile sıfırlanır.' },
        { type: 'range', key: 'Tmin', label: 'Tasarım en düşük ortam sıcaklığı', min: -40, max: 20, step: 1, unit: '°C', help: 'Soğuk ve açık sabahta string Voc en yüksek değerini alır.' },
        { type: 'range', key: 'Tmax', label: 'Tasarım en yüksek ortam sıcaklığı', min: 15, max: 55, step: 1, unit: '°C' }
      ] },
      { title: 'Çatı engeli (HVAC / baca)', items: [
        { type: 'toggle', key: 'obsOn', label: 'Çatıda engel var', rebuild: true },
        s.obsOn ? { type: 'range', key: 'obsX', label: 'Konum doğu–batı (dizi merkezine göre)', min: -xr, max: xr, step: 0.5, unit: 'm', digits: 1 } : null,
        s.obsOn ? { type: 'range', key: 'obsZ', label: 'Konum güney (+) / kuzey (−)', min: -zr, max: zr, step: 0.5, unit: 'm', digits: 1 } : null,
        s.obsOn ? { type: 'number', key: 'obsW', label: 'Genişlik', min: 0.3, max: 30, step: 0.1, unit: 'm', digits: 1 } : null,
        s.obsOn ? { type: 'number', key: 'obsD', label: 'Derinlik', min: 0.3, max: 30, step: 0.1, unit: 'm', digits: 1 } : null,
        s.obsOn ? { type: 'number', key: 'obsH', label: 'Yükseklik (çatıdan)', min: 0.2, max: 20, step: 0.1, unit: 'm', digits: 1 } : null,
        s.obsOn ? { type: 'note', text: 'Gölge, güneş vektörüyle her modülde ışın–kutu kesişimi olarak hesaplanır; 3D gölge aynı geometriyi gösterir. Engele tıklayıp taşıyabilirsiniz.' } : null
      ] },
      { title: 'Tüketim ve ekonomi', items: [
        { type: 'number', key: 'consumption', label: 'Yıllık tüketim', min: 0, max: 1e9, step: 1000, unit: 'kWh' },
        { type: 'select', key: 'profile', label: 'Tüketim profili', options: Object.keys(G.PROFILES).map(k => [k, G.PROFILES[k].name]) },
        { type: 'number', key: 'price', label: 'Elektrik birim fiyatı', min: 0, max: 100, step: 0.1, unit: 'TL/kWh', digits: 2 },
        { type: 'number', key: 'exportPrice', label: 'Şebekeye verilen enerji bedeli', min: 0, max: 100, step: 0.1, unit: 'TL/kWh', digits: 2 },
        { type: 'number', key: 'capex', label: 'Yatırım bedeli', min: 0, max: 1e10, step: 10000, unit: 'TL' },
        { type: 'note', text: 'Fiyat ve yatırım bedeli örnektir; güncel tarifeniz ve teklif fiyatınızla değiştirin. Vergi, finansman ve tarife değişimi dahil değildir.' }
      ] },
      { title: 'PVGIS verisi (isteğe bağlı)', items: [
        { type: 'note', html: 'Aylık özgül üretimi (kWh/kWp, 12 değer) <a class="vs-jump" href="https://re.jrc.ec.europa.eu/pvg_tools/tr/" target="_blank" rel="noopener">PVGIS</a> aracından alıp buraya girin; kaynak ve tarihi aşağıya kendiniz yazın. Veri girilmezse yıllık sonuç sahaya özgü üretim değil, <b>açık gök × bulutluluk senaryosudur</b>.' },
        { type: 'text', key: 'pvgisMonthly', label: 'Aylık kWh/kWp (Oca → Ara)', multiline: true, placeholder: 'ör. 68; 84; 121; …  (12 değer)', parse: parseMonthly, format: fmtMonthly },
        { type: 'text', key: 'pvgisSource', label: 'Veri kaynağı ve tarihi', placeholder: 'ör. PVGIS-SARAH3, 23.10.2026', parse: v => String(v).trim().slice(0, 120) },
        s.pvgisMonthly ? { type: 'buttons', items: [{ label: 'PVGIS verisini kaldır', onClick: a => { a.state.pvgisMonthly = null; a.renderControls(); a.invalidate(); } }] } : null
      ] },
      { title: 'Görünüm', items: [
        { type: 'toggle', key: 'showStrings', label: 'Modülleri MPPT’ye göre renklendir' },
        { type: 'note', text: 'Renk: her MPPT ayrı ton · gri: DC ayırıcısı açık inverter · turuncu: engel gölgesi · kırmızı: engelle çakışma.' }
      ] }
    ];
  }

  /* ---------------------------------------------------------------- zaman adımı: gün boyunca saat ilerler */
  function tick(app, dt) {
    const s = app.state, L = app.live;
    let h = Number(s.hour) + dt * HOURS_PER_S;
    if (h > 20.5) h = 5; // yeni gün (aynı ayın temsilî günü)
    s.hour = Math.round(h * 1000) / 1000;
    L.acc += dt;
    if (L.acc > 0.25) { L.acc = 0; app.invalidate(); syncHour(app); }
    return false;
  }
  function syncHour(app) {
    const input = app.root.querySelector('[data-vs-controls] input[data-key="hour"]');
    if (!input || document.activeElement === input) return;
    input.value = app.state.hour;
    input.style.setProperty('--p', ((app.state.hour - 4) / 17 * 100) + '%');
    const out = input.parentNode.querySelector('output'); if (out) out.textContent = fmtHour(app.state.hour);
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s) {
    const v = res.values, st = v.string, now = v.now, x = v.ext;
    const st0 = id => (res.checks.find(c => c.id === id) || {}).status;
    const lv = id => ({ ok: 'ok', warn: 'warn', fail: 'bad' }[st0(id)] || undefined);
    const night = v.sun.elevation <= 0;
    const out = [
      { label: 'Kurulu güç (DC)', value: fmt(x.installedKWp, 1, 'kWp'), sub: s.nMod + ' × ' + s.Pmod + ' Wp' + (x.gain ? ' · bifasiyal +%' + fmt(x.gain * 100, 1) : '') },
      { label: 'İnverter (AC)', value: fmt(v.Pac, 0, 'kW'), sub: s.invCount + ' × ' + fmt(s.invPac, 0) + ' kW' + (x.offInv ? ' · ' + x.offInv + ' kapalı' : '') },
      { label: 'DC/AC oranı', value: fmt(v.dcac, 2), level: lv('dcac'), sub: 'tipik 0,9–1,35' },
      { label: 'Anlık AC güç', value: VS.fmtPower(now.Pac), level: now.clipped > 1 ? 'warn' : undefined, sub: fmtHour(s.hour) + ' · ' + MONTHS[s.month - 1] + (now.clipped > 1 ? ' · kırpma ' + VS.fmtPower(now.clipped) : night ? ' · güneş ufkun altında' : '') },
      { label: 'Düzlem ışınımı G', value: fmt(now.G, 0, 'W/m²'), sub: 'GHI ' + fmt(now.plane.GHI, 0) + ' · gölge %' + fmt(v.shade * 100, 0) + (s.obsOn ? ' (engel %' + fmt(x.obsFrac * 100, 0) + ')' : '') },
      { label: 'Hücre sıcaklığı', value: fmt(now.Tc, 1, '°C'), sub: 'Ta ' + fmt(s.Ta, 0) + ' °C · NOCT ' + s.noct + ' °C' },
      { label: 'String Voc (Tmin)', value: fmt(st.vocCold, 0, 'V'), level: lv('voc'), sub: 'sınır ' + s.vdcMax + ' V · ' + s.Tmin + ' °C' },
      { label: 'Vmp aralığı', value: fmt(st.vmpHot, 0) + '–' + fmt(st.vmpCold, 0) + ' V', level: st0('mpptLo') === 'ok' && st0('mpptHi') === 'ok' ? 'ok' : 'warn', sub: 'MPPT ' + s.mpptMin + '–' + s.mpptMax + ' V' },
      { label: 'String / MPPT', value: x.nStrings + ' / ' + x.M, level: lv('inputs'), sub: 'MPPT başına en çok ' + x.maxPerMppt + ' string · ' + s.inPerMppt + ' giriş' },
      { label: 'Günlük enerji', value: VS.fmtEnergy(v.today.Eac), sub: MONTHS[s.month - 1] + (v.today.Eclip > 0.05 ? ' · kırpma ' + VS.fmtEnergy(v.today.Eclip) : ' · temsilî gün') },
      { label: 'Yıllık enerji', value: VS.fmtEnergy(v.annual), sub: s.pvgisMonthly ? 'PVGIS verisi (kullanıcı)' : 'açık gök × bulut senaryosu' },
      { label: 'Özgül verim', value: fmt(v.specYield, 0, 'kWh/kWp'), sub: 'kayıp %' + fmt(x.lossRaw, 1) + (s.soiling > 0 ? ' (kirlenme dahil)' : '') },
      { label: 'Öz tüketim', value: '%' + fmt(v.selfRatio * 100, 0), sub: 'şebekeye ' + VS.fmtEnergy(v.exported) },
      { label: 'Geri dönüş (basit)', value: v.payback ? fmt(v.payback, 1, 'yıl') : '—', sub: 'yıllık kazanç ' + fmt(v.saving, 0, 'TL') }
    ];
    if (s.obsOn) out.push({ label: 'Engel gölgesi', value: '%' + fmt(x.obsFrac * 100, 1), level: x.obsClash ? 'bad' : x.obsFrac > 0.02 ? 'warn' : 'ok', sub: 'temsilî günde ≈ ' + fmt(x.obsLoss, 1, 'kWh') + ' kayıp' });
    if (s.expLimit) out.push({ label: 'İhracat sınırı', value: fmt(s.expKW, 0, 'kW'), level: x.expNowCut > 0 ? 'warn' : undefined, sub: 'şimdi kısılan ' + fmt(x.expNowCut, 1, 'kW') + ' · gün ' + fmt(x.expCut, 0, 'kWh') });
    out.push({ label: 'Güneş', value: night ? 'Ufkun altında' : fmt(v.sun.elevation, 1) + '° yükseklik', sub: 'azimut ' + fmt(v.sun.azimuth, 0) + '° (güneyden, batı +) · güneş saati ' + fmtHour(v.sun.solarTime), wide: true });
    return out;
  }
  function charts(res, s) {
    const v = res.values;
    const day = v.today.pts.map(p => [p.t, p.Pac]);
    const peak = day.reduce((a, p) => Math.max(a, p[1]), 0);
    const mon = v.monthly.map((e, i) => [i + 1, e / 1000]);
    const sel = v.monthly.map((e, i) => [i + 1, i + 1 === s.month ? e / 1000 : 0]);
    const series = [{ name: 'P_AC (kW)', color: 'amber', area: true, data: day }];
    if (v._exCurve) series.push({ name: 'İhracat sınırıyla (kW)', color: 'cyan', dash: [4, 3], data: v._exCurve });
    return [{
      id: 'day', title: 'Günlük AC güç profili (seçili ayın temsilî günü)', height: 160,
      series: series,
      hLines: [{ y: v.Pac, label: 'İnverter ' + fmt(v.Pac, 0) + ' kW', color: '#ef4444' }],
      markers: [{ x: Number(s.hour), y: v.now.Pac / 1000, label: fmtHour(s.hour) }],
      x: { min: 4, max: 21, ticks: [5, 8, 11, 14, 17, 20], fmt: x => String(Math.round(x)).padStart(2, '0') + ':00', label: 'saat' }, y: { label: 'kW' },
      alt: MONTHS[s.month - 1] + ' temsilî gününde tepe AC güç ' + fmt(peak, 1) + ' kW, günlük üretim ' + fmt(v.today.Eac, 0) + ' kWh. İşaret: ' + fmtHour(s.hour) + ', ' + fmt(v.now.Pac / 1000, 1) + ' kW.'
    }, {
      id: 'month', title: 'Aylık enerji (MWh)', height: 150, type: 'bar',
      series: [{ name: 'Aylık üretim (MWh)', type: 'bar', color: 'cyan', data: mon }, { name: 'Seçili ay', type: 'bar', color: 'amber', data: sel }],
      x: { min: 0.4, max: 12.6, ticks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], fmt: x => MON3[x - 1] || '', label: 'ay' }, y: { label: 'MWh' },
      alt: (s.pvgisMonthly ? 'Kullanıcının girdiği PVGIS verisi. ' : 'Açık gök × bulutluluk senaryosu. ') + 'Yıllık ' + fmt(v.annual / 1000, 1) + ' MWh. ' + v.monthly.map((e, i) => MON3[i] + ' ' + fmt(e / 1000, 1)).join(', ') + ' MWh.'
    }, {
      id: 'volt', title: 'String gerilim penceresi', height: 150, type: 'bar',
      series: [{ name: 'String gerilimi (V)', type: 'bar', color: 'violet', data: [[1, v.string.vocCold], [2, v.string.vmpCold], [3, v.string.vmpHot]] }],
      hLines: [{ y: s.vdcMax, label: 'Maks. DC ' + s.vdcMax + ' V', color: '#ef4444' }, { y: s.mpptMax, label: 'MPPT üst ' + s.mpptMax, color: '#f59e0b' }, { y: s.mpptMin, label: 'MPPT alt ' + s.mpptMin, color: '#22b8cf' }],
      x: { min: 0.4, max: 3.6, ticks: [1, 2, 3], fmt: x => ['', 'Voc soğuk', 'Vmp soğuk', 'Vmp sıcak'][x] || '' }, y: { label: 'V', min: 0 },
      alt: 'Voc (Tmin) ' + fmt(v.string.vocCold, 0) + ' V, Vmp (soğuk) ' + fmt(v.string.vmpCold, 0) + ' V, Vmp (sıcak) ' + fmt(v.string.vmpHot, 0) + ' V; inverter sınırları ' + s.mpptMin + '–' + s.mpptMax + ' V MPPT, ' + s.vdcMax + ' V maksimum.'
    }, {
      id: 'self', title: 'Yıllık enerji dağılımı (MWh)', height: 140, type: 'bar',
      series: [{ name: 'Enerji (MWh)', type: 'bar', color: 'green', data: [[1, v.self / 1000], [2, v.exported / 1000], [3, s.consumption / 1000]] }],
      x: { min: 0.4, max: 3.6, ticks: [1, 2, 3], fmt: x => ['', 'Öz tüketim', 'Şebekeye', 'Tüketim'][x] || '' }, y: { label: 'MWh' },
      alt: 'Öz tüketim ' + fmt(v.self / 1000, 1) + ' MWh, şebekeye verilen ' + fmt(v.exported / 1000, 1) + ' MWh, yıllık tüketim (girdi) ' + fmt(s.consumption / 1000, 1) + ' MWh.'
    }];
  }

  /* ---------------------------------------------------------------- 3D sahne */
  const HB = 8, PARA = 0.9, INV_DZ = 0.95;
  function siteDims(s) {
    const ly = layoutOf(s);
    const trap = ly.roof === 'trapez';
    const W = Math.max(30, ly.rowLen + 8);
    const D = trap ? Math.max(22, 2 * (ly.arrD + 2.5)) : Math.max(22, ly.arrD + 8);
    return { ly: ly, trap: trap, W: W, D: D, nInv: Math.round(num(s.invCount, 1, 1, 10000)) };
  }
  function rebuildOn(s) { const d = siteDims(s); return [d.ly.roof, d.ly.n, d.ly.rows, d.ly.t.toFixed(3), d.ly.L, d.ly.Wm, d.ly.pitchV.toFixed(2), d.nInv, s.obsOn ? 1 : 0].join('|'); }
  /** Inverterlerin cephe yerleşimi: doğu cephesinde iki kat, sığmazsa güney cephesinde batıya doğru katlar hâlinde. */
  function invPlace(i, W, D) {
    const capE = Math.max(1, Math.floor((D - 6) / INV_DZ));
    if (i < 2 * capE) return { wall: 'E', x: W / 2 + 0.125, y: 1.3 + Math.floor(i / capE) * 1.15, z: D / 2 - 1.5 - (i % capE) * INV_DZ };
    const j = i - 2 * capE, capS = Math.max(1, Math.floor((W - 14) / INV_DZ));
    return { wall: 'S', x: W / 2 - 3 - (j % capS) * INV_DZ, y: 1.3 + Math.floor(j / capS) * 1.15, z: D / 2 + 0.125 };
  }

  let A = null;
  const trash = [];
  function canvasTex(T, w, h, draw, rx, ry) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx || 1, ry || 1); t.anisotropy = 4; return t;
  }
  function assets(k) {
    if (A && A.kit === k) return A;
    const T = k.T;
    A = { kit: k };
    const modTex = canvasTex(T, 128, 256, (g, w, h) => {
      g.fillStyle = '#c9ced3'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0e1d3c'; g.fillRect(4, 4, w - 8, h - 8);
      const cw = (w - 12) / 6, ch = (h - 12) / 12;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 12; j++) {
        const x = 6 + i * cw, y = 6 + j * ch;
        const gr = g.createLinearGradient(x, y, x + cw, y + ch); gr.addColorStop(0, '#1b3366'); gr.addColorStop(1, '#122650');
        g.fillStyle = gr; g.fillRect(x + 0.8, y + 0.8, cw - 1.6, ch - 1.6);
        g.fillStyle = '#41598a'; g.fillRect(x + cw * 0.33, y + 1, 0.6, ch - 2); g.fillRect(x + cw * 0.66, y + 1, 0.6, ch - 2);
      }
      g.fillStyle = '#5c6f93'; g.fillRect(4, h / 2 - 0.5, w - 8, 1);
    });
    A.modMat = new T.MeshPhysicalMaterial({ color: 0xffffff, map: modTex, metalness: 0.15, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.12 });
    A.modMat.envMapIntensity = 0.5;
    const ribs = (base, dark, light) => (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { g.fillStyle = dark; g.fillRect(x, 0, 4, h); g.fillStyle = light; g.fillRect(x + 4, 0, 2, h); } };
    A.wallTex = len => canvasTex(T, 256, 32, ribs('#dfe3e6', '#aeb6be', '#f4f6f7'), len / 2, 1);
    A.trapTex = (W, Ls) => canvasTex(T, 256, 32, ribs('#9aa3ac', '#6f7882', '#b9c0c7'), W / 2, Ls / 2);
    A.winTex = len => canvasTex(T, 256, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a7da6'); gr.addColorStop(1, '#22344f'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#9aa3ad'; for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 5, h); g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4); g.fillRect(0, h * 0.62, w, 3);
    }, len / 6, 1);
    A.doorTex = canvasTex(T, 128, 128, (g, w, h) => {
      g.fillStyle = '#b9c0c7'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 21) { g.fillStyle = '#8f98a1'; g.fillRect(0, y, w, 2); g.fillStyle = '#d6dbe0'; g.fillRect(0, y + 2, w, 1); }
      g.fillStyle = '#2e3e55'; for (let x = 10; x < w - 10; x += 28) g.fillRect(x, 46, 20, 12);
    });
    A.roofTex = (W, D) => canvasTex(T, 128, 128, (g, w, h) => { g.fillStyle = '#b4b9bf'; g.fillRect(0, 0, w, h); g.fillStyle = '#a3a9b0'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); }, W / 2, D / 2);
    A.louvreTex = canvasTex(T, 64, 128, (g, w, h) => { g.fillStyle = '#5d6670'; g.fillRect(0, 0, w, h); for (let y = 6; y < h - 6; y += 8) { g.fillStyle = '#2b3138'; g.fillRect(4, y, w - 8, 4); } });
    A.unit = new T.BoxGeometry(1, 1, 1);
    A.cylS = new T.CylinderGeometry(1, 1, 1, 14);
    A.sphere = new T.SphereGeometry(1, 24, 16);
    return A;
  }
  function inst(im, i, x, y, z, q, sx, sy, sz, tmp) {
    tmp.p.set(x, y, z); tmp.s.set(sx, sy, sz); tmp.m.compose(tmp.p, q || tmp.q0, tmp.s); im.setMatrixAt(i, tmp.m);
  }
  function std(k, hex, o) { return k.mat ? k.mat(hex, o) : new k.T.MeshStandardMaterial(Object.assign({ color: hex }, o || {})); }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    trash.forEach(x => x.dispose()); trash.length = 0;
    const a = assets(k), sd = siteDims(s), Ly = sd.ly;
    const W = sd.W, D = sd.D, trap = sd.trap;
    const sc = { inv: [], flows: {}, sunKey: '', pathKey: '', colKey: '' };
    app.scene3 = sc;
    const tmp = { p: new T.Vector3(), s: new T.Vector3(), m: new T.Matrix4(), q0: new T.Quaternion() };
    const tanT = Math.tan(Ly.t), Hr = trap ? D / 2 * tanT : 0;

    // zemin: çim + fabrika sahası (asfalt)
    k.ground(Math.max(900, Math.max(W, D) * 8), std(k, 0x34482a, { roughness: 1 }), 0);
    const site = k.group(null, 0, 0, 0); sc.site = site;
    const yard = k.box(W + 34, 0.04, D + 26, M.asphalt, 6, 0.02, 2, site, { noShadow: true }); yard.userData.noClip = true;

    /* --- fabrika binası */
    const bld = k.group(site, 0, 0, 0);
    const wallW = std(k, 0xffffff, { map: a.wallTex(W), roughness: 0.55, metalness: 0.3 });
    const wallD = std(k, 0xffffff, { map: a.wallTex(D), roughness: 0.55, metalness: 0.3 });
    [k.box(W, HB, 0.25, wallW, 0, HB / 2, D / 2, bld), k.box(W, HB, 0.25, wallW, 0, HB / 2, -D / 2, bld),
      k.box(0.25, HB, D, wallD, W / 2, HB / 2, 0, bld), k.box(0.25, HB, D, wallD, -W / 2, HB / 2, 0, bld)].forEach(w => k.shell(w));
    k.shell(k.box(W + 0.08, 0.7, D + 0.08, M.concreteDark, 0, 0.35, 0, bld));
    let roof;
    if (!trap) {
      const roofMat = std(k, 0xffffff, { map: a.roofTex(W, D), roughness: 0.92 }); roofMat.envMapIntensity = 0.45;
      roof = k.box(W, 0.3, D, roofMat, 0, HB - 0.15, 0, bld); k.shell(roof);
      [[W, 0.25, 0, D / 2 - 0.125], [W, 0.25, 0, -D / 2 + 0.125], [0.25, D, W / 2 - 0.125, 0], [0.25, D, -W / 2 + 0.125, 0]].forEach(p => {
        k.shell(k.box(p[0], PARA, p[1], wallD, p[2], HB + PARA / 2, p[3], bld));
        k.box(p[0] + 0.08, 0.06, p[1] + 0.08, M.alu, p[2], HB + PARA + 0.03, p[3], bld);
      });
    } else {
      // beşik çatı: güney yüzü modüller için, trapez sac; alın duvarları üçgen
      const Ls = D / 2 / Math.cos(Ly.t) + 0.4;
      const tm = std(k, 0xffffff, { map: a.trapTex(W, Ls), roughness: 0.5, metalness: 0.55 }); tm.envMapIntensity = 0.5;
      const rs = k.box(W + 0.5, 0.15, Ls, tm, 0, HB + Hr / 2, D / 4, bld); rs.rotation.x = Ly.t; k.shell(rs);
      const rn = k.box(W + 0.5, 0.15, Ls, tm, 0, HB + Hr / 2, -D / 4, bld); rn.rotation.x = -Ly.t; k.shell(rn);
      roof = rs;
      const sh = new T.Shape(); sh.moveTo(-D / 2, 0); sh.lineTo(D / 2, 0); sh.lineTo(0, Hr); sh.closePath();
      const gg = new T.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: false }); trash.push(gg);
      [-1, 1].forEach(j => { const m = new T.Mesh(gg, wallD); m.rotation.y = Math.PI / 2; m.position.set(j * W / 2 - 0.125, HB, 0); m.castShadow = m.receiveShadow = true; bld.add(m); k.shell(m); });
      k.box(W + 0.6, 0.12, 0.12, M.alu, 0, HB + Hr + 0.05, 0, bld);
      k.box(W + 0.6, 0.18, 0.18, M.alu, 0, HB - 0.05, D / 2 + 0.2, bld); // oluk
    }
    const winS = std(k, 0xffffff, { map: a.winTex(W - 6), roughness: 0.15, metalness: 0.4 });
    const winE = std(k, 0xffffff, { map: a.winTex(D - 6), roughness: 0.15, metalness: 0.4 });
    k.shell(k.box(W - 6, 1.3, 0.06, winS, 0, 5.7, D / 2 + 0.13, bld));
    k.shell(k.box(0.06, 1.3, D - 6, winE, -W / 2 - 0.13, 5.7, 0, bld));
    const doorMat = std(k, 0xffffff, { map: a.doorTex, roughness: 0.5, metalness: 0.4 });
    [-W * 0.3, -W * 0.3 + 6].forEach(x => { k.box(4.4, 4.6, 0.08, doorMat, x, 2.3, D / 2 + 0.15, bld); k.box(4.7, 0.18, 0.2, M.darkSteel, x, 4.65, D / 2 + 0.2, bld); });
    k.box(1.0, 2.2, 0.06, M.panelDark, -W * 0.3 + 10, 1.1, D / 2 + 0.14, bld);
    [[-W / 2 + 0.3, D / 2 + 0.3], [-W / 2 + 0.3, -D / 2 - 0.3]].forEach(p => {
      const m = new T.Mesh(a.cylS, M.alu); m.scale.set(0.07, HB + (trap ? 0 : PARA), 0.07); m.position.set(p[0], (HB + (trap ? 0 : PARA)) / 2, p[1]); m.castShadow = true; bld.add(m);
    });
    for (let x = -W / 2 + 1; x <= W / 2 - 1 + 1e-6; x += (W - 2) / Math.max(1, Math.round((W - 2) / 7.5))) {
      k.box(0.35, HB - 0.3, 0.35, M.panelDark, x, (HB - 0.3) / 2, D / 2 - 0.6, bld); k.box(0.35, HB - 0.3, 0.35, M.panelDark, x, (HB - 0.3) / 2, -D / 2 + 0.6, bld);
    }
    const mach = std(k, 0x2f6f8f, { roughness: 0.45, metalness: 0.3 });
    for (let i = 0; i < 4; i++) { k.box(5, 1.7, 2.2, mach, -W * 0.28 + i * 6.2, 0.85, -D * 0.12, bld); k.box(1.2, 0.6, 1.2, M.panelRAL7035, -W * 0.28 + i * 6.2 + 1.6, 2.0, -D * 0.12, bld); }
    const mainP = k.box(2.4, 2.1, 0.6, M.panelRAL7035, -W / 2 + 1.8, 1.05, -D * 0.3, bld);
    k.pickable(mainP, 'Fabrika ana dağıtım panosu (ADP)', () => { const r = app.validResult && app.validResult.values; return r ? ['Yıllık tüketim: ' + VS.fmtEnergy(s.consumption) + ' · profil: ' + G.PROFILES[s.profile].name, 'GES üretiminin %' + fmt(r.selfRatio * 100, 0) + ' kadarı burada tüketilir (öz tüketim, saatlik eşleşme).', 'Şu anki tahmini yük ≈ ' + fmt(r.ext.nowLoad, 0, 'kW') + ' (profil ağırlığı, iş günü).'] : []; });
    k.pickable(roof, trap ? 'Trapez sac çatı' : 'Düz çatı', () => [trap ? 'Paneller çatı eğimine paralel, alüminyum ray ve trapez sac bağlantı elemanlarıyla (sıra gölgesi yok).' : 'Balastlı eğik sıra montaj; sıra aralığı gölgeyi belirler.', 'Kullanılabilir alan girdisi: ' + fmt(s.roofArea, 0, 'm²'), 'Çatı statik yük kontrolü (panel + konstrüksiyon' + (trap ? '' : ' + balast') + ', rüzgâr/kar) ayrıca yapılmalıdır.']);

    /* --- PV dizisi */
    const zArr = trap ? D / 2 - 1.0 - Ly.arrD / 2 : 0;
    const yArr = trap ? HB + 1.0 * tanT + 0.08 : HB;
    const arr = k.group(site, 0, yArr, zArr); sc.arr = arr; sc.ly = Ly;
    const modGrp = k.group(arr, 0, 0, 0);
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Ly.t);
    const modGeo = new T.BoxGeometry(Ly.Wm, 0.04, Ly.L); trash.push(modGeo);
    const mods = new T.InstancedMesh(modGeo, a.modMat, Ly.n);
    mods.castShadow = true; mods.receiveShadow = true; mods.frustumCulled = false; modGrp.add(mods);
    const white = new T.Color(1, 1, 1);
    for (let i = 0; i < Ly.n; i++) { inst(mods, i, Ly.xs[i], Ly.ys[i], Ly.zs[i], q, 1, 1, 1, tmp); mods.setColorAt(i, white); }
    mods.instanceMatrix.needsUpdate = true; if (mods.instanceColor) mods.instanceColor.needsUpdate = true;
    sc.mods = mods;
    // konstrüksiyon
    const rowsArr = []; for (let r = 0; r < Ly.rows; r++) { const i0 = r * Ly.perRow; if (i0 < Ly.n) rowsArr.push({ z: Ly.zs[i0], y: Ly.ys[i0], cnt: Math.min(Ly.perRow, Ly.n - i0) }); }
    const pt = (u, zc, yc) => { const c = Math.cos(Ly.t), sn = Math.sin(Ly.t); return { y: yc - 0.06 * c - u * sn, z: zc - 0.06 * sn + u * c }; };
    const legStep = 2.4;
    let nLeg = 0; rowsArr.forEach(r => { nLeg += Math.ceil(r.cnt * Ly.step / legStep) + 1; });
    const str = new T.InstancedMesh(a.unit, M.galv, rowsArr.length * 2 + (trap ? nLeg : nLeg * 2) + 4);
    const bal = trap ? null : new T.InstancedMesh(a.unit, M.concrete, nLeg + 4);
    [str, bal].filter(Boolean).forEach(im => { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; arr.add(im); });
    let si = 0, bi = 0;
    const xt = W / 2 - 1.2;
    rowsArr.forEach(rw => {
      const len = rw.cnt * Ly.step, x0 = -Ly.rowLen / 2;
      const f = pt(Ly.L * 0.3, rw.z, rw.y), r = pt(-Ly.L * 0.3, rw.z, rw.y);
      inst(str, si++, x0 + len / 2, f.y - 0.03, f.z, q, len, 0.05, 0.05, tmp);
      inst(str, si++, x0 + len / 2, r.y - 0.03, r.z, q, len, 0.05, 0.05, tmp);
      for (let x = x0 + 0.15; x <= x0 + len - 0.1; x += legStep) {
        if (trap) { inst(str, si++, x, f.y - 0.09, f.z, q, 0.06, 0.1, 0.08, tmp); continue; } // çatı kancası
        inst(str, si++, x, (f.y + 0.12) / 2, f.z, null, 0.045, Math.max(0.02, f.y - 0.12), 0.045, tmp);
        inst(str, si++, x, (r.y + 0.12) / 2, r.z, null, 0.045, Math.max(0.02, r.y - 0.12), 0.045, tmp);
        inst(bal, bi++, x, 0.06, (f.z + r.z) / 2, null, 0.3, 0.12, Math.abs(f.z - r.z) + 0.45, tmp);
      }
      if (!trap) {
        k.box(len, 0.03, 0.03, M.cableBlack, x0 + len / 2, r.y - 0.1, r.z, arr);
        const stub = xt - (x0 + len);
        if (stub > 0.05) k.box(stub, 0.03, 0.03, M.cableBlack, x0 + len + stub / 2, 0.12, r.z, arr);
      }
    });
    str.count = si; str.instanceMatrix.needsUpdate = true;
    if (bal) { bal.count = bi; bal.instanceMatrix.needsUpdate = true; }
    k.explodable(modGrp, [0, 1.8, 0]);
    k.pickable(mods, 'PV modüller', () => {
      const r = app.validResult && app.validResult.values; if (!r) return [];
      return [s.nMod + ' × ' + s.Pmod + ' Wp = ' + fmt(r.ext.installedKWp, 1, 'kWp') + ' · ' + Ly.rows + ' sıra, eğim ' + s.tilt + '°, azimut ' + s.azimuth + '°',
        'Düzlem ışınımı ' + fmt(r.now.G, 0, 'W/m²') + ' · hücre ' + fmt(r.now.Tc, 1, '°C') + ' · P_DC ' + VS.fmtPower(r.now.Pdc),
        'Gölge: sıra %' + fmt(r.rowShade * 100, 0) + (s.obsOn ? ' · engel %' + fmt(r.ext.obsFrac * 100, 1) : '') + ' · kirlenme %' + fmt(s.soiling, 1),
        s.bifacial ? 'Çift yüzlü: arka yüz kazancı ≈ %' + fmt(r.ext.gain * 100, 1) + ' (φ ' + fmt(s.bifi, 2) + ', albedo ' + fmt(s.albedo, 2) + ')' : 'Tek yüzlü modül',
        'Gölge geometriktir; bypass diyot ve uyumsuzluk etkisi dahil değildir.'];
    }, ap => [
      ap.state.soiling > 0 ? { label: 'Panelleri temizle', variant: 'primary', onClick: x => { x.state.soiling = 0; VS.toast('Paneller temizlendi: kirlenme %0.', 'ok'); } } : null,
      { label: ap.state.showStrings ? 'MPPT renklerini gizle' : 'MPPT renklerini göster', onClick: x => { x.state.showStrings = !x.state.showStrings; } }
    ]);
    k.pickable(str, trap ? 'Montaj rayları ve çatı kancaları' : 'Montaj konstrüksiyonu ve balast', () => [trap ? 'Alüminyum ray, trapez sac üst hadvesine vidalı bağlantı (temsilî).' : 'Sıra aralığı ' + fmt(s.pitch, 1, 'm') + ' · galvaniz ray ve ayaklar, beton balast kızakları (temsilî).', 'Modül boyu ' + fmt(Ly.L, 2, 'm') + ' (dikey yerleşim) · eni ' + fmt(Ly.Wm, 3, 'm'), 'Bağlantı ve balast, rüzgâr yükü (TS EN 1991-1-4) ve çatı taşıma kapasitesine göre belirlenir.']);

    /* --- çatı engeli (HVAC ünitesi): konumu/boyutu update() içinde durumdan */
    if (s.obsOn) {
      const og = k.group(arr, 0, 0, 0); sc.obs = og;
      const body = new T.Mesh(a.unit, M.panelRAL7035); body.castShadow = body.receiveShadow = true; og.add(body);
      const grille = new T.Mesh(a.unit, M.darkSteel); og.add(grille);
      const fans = [0, 1].map(() => { const f = new T.Mesh(a.cylS, M.plasticDark); f.castShadow = true; og.add(f); return f; });
      sc.obsParts = { body: body, grille: grille, fans: fans };
      k.pickable(og, 'Çatı engeli (HVAC ünitesi)', () => { const r = app.validResult && app.validResult.values; const o = obstacleOf(app.state); return r ? [fmt(o.w, 1) + ' × ' + fmt(o.d, 1) + ' m, yükseklik ' + fmt(o.h, 1) + ' m', 'Şu an direkt ışınımın %' + fmt(r.ext.obsFrac * 100, 1) + '’i engel gölgesinde', 'Temsilî günde kayıp ≈ ' + fmt(r.ext.obsLoss, 1, 'kWh') + (r.ext.obsClash ? ' · ' + r.ext.obsClash + ' modülle çakışma!' : '')] : []; },
        () => [
          { label: '↑ Kuzeye 2 m', onClick: x => { x.state.obsZ = Number(x.state.obsZ) - 2; } },
          { label: '↓ Güneye 2 m', onClick: x => { x.state.obsZ = Number(x.state.obsZ) + 2; } },
          { label: '← Batıya 2 m', onClick: x => { x.state.obsX = Number(x.state.obsX) - 2; } },
          { label: '→ Doğuya 2 m', onClick: x => { x.state.obsX = Number(x.state.obsX) + 2; } },
          { label: 'Engeli kaldır', variant: 'danger', onClick: x => { x.state.obsOn = false; } }
        ]);
      sc.lObs = k.label('Engel', og, [0, 0, 0], 'vs-label--sm');
    }

    /* --- DC kablo kanalı ve inverterler */
    const nInv = sd.nInv, capE = Math.max(1, Math.floor((D - 6) / INV_DZ));
    const nE = Math.min(nInv, capE), zInv0 = D / 2 - 1.5, zInvC = zInv0 - (nE - 1) * INV_DZ / 2;
    const xw = W / 2 + 0.125;
    const zFirst = trap ? zArr + Ly.arrD / 2 : Ly.zs[0] - Ly.dproj / 2 - 0.4;
    if (!trap) k.box(0.3, 0.08, Math.abs(zInvC - zFirst), M.galv, xt, HB + 0.05, (zFirst + zInvC) / 2, site);
    k.box(0.06, HB + (trap ? 0 : PARA) - 2.6, 0.3, M.galv, xw + 0.05, (HB + (trap ? 0 : PARA) + 2.6) / 2, zInvC, site);
    k.box(0.08, 0.06, nE * INV_DZ, M.galv, xw + 0.08, 2.5, zInvC, site);
    const dcPts = trap
      ? [[xt, yArr + 0.1, zFirst - 0.6], [xt + 0.4, HB + 0.25, zFirst + 0.3], [W / 2 - 0.2, HB + 0.1, zInvC], [xw + 0.12, HB - 0.4, zInvC], [xw + 0.12, 2.7, zInvC]]
      : [[xt, HB + 0.15, zFirst], [xt, HB + 0.15, zInvC - 0.6], [xt + 0.6, HB + 0.2, zInvC], [W / 2 - 0.3, HB + 0.25, zInvC], [W / 2 - 0.1, HB + PARA + 0.2, zInvC], [xw + 0.12, HB + PARA, zInvC], [xw + 0.12, HB - 0.6, zInvC], [xw + 0.12, 2.7, zInvC]];
    const dc = k.tube(dcPts, 0.06, M.cableBlack, site, 120); trash.push(dc.geometry);
    sc.flows.dc = k.flow(dc.userData.curve, 40, 0xfcd34d, 0.06, site);
    const invGrp = k.group(site, 0, 0, 0);
    for (let i = 0; i < nInv; i++) {
      const pl = invPlace(i, W, D);
      const g = k.group(invGrp, pl.x, pl.y, pl.z); g.rotation.y = pl.wall === 'E' ? Math.PI / 2 : 0;
      k.rbox(0.64, 0.8, 0.24, 0.03, M.plasticWhite, 0, 0, 0.16, g);
      for (let f = 0; f < 5; f++) k.box(0.012, 0.66, 0.05, M.alu, -0.24 + f * 0.12, 0, 0.03, g);
      k.box(0.6, 0.06, 0.2, M.plasticDark, 0, -0.43, 0.16, g);
      const led = k.sphere(0.014, M.ledOff, 0.2, 0.25, 0.285, g);
      const dcs = new T.Mesh(a.cylS, M.plasticYellow); dcs.scale.set(0.05, 0.02, 0.05); dcs.rotation.x = Math.PI / 2; dcs.position.set(0.2, -0.2, 0.285); g.add(dcs);
      const knob = k.box(0.08, 0.018, 0.03, M.plasticRed, 0.2, -0.2, 0.3, g);
      let scr = null;
      if (i < 12) { scr = k.screen(0.16, 0.08, 160, (gx, w, h) => drawInv(gx, w, h, app, i), g, { emissive: 0.85 }); scr.position.set(-0.08, 0.2, 0.285); }
      else k.box(0.16, 0.08, 0.01, M.plasticDark, -0.08, 0.2, 0.28, g);
      // DC kutusu (string sigortaları / SPD)
      k.rbox(0.3, 0.38, 0.14, 0.02, M.plasticGrey, 0.52, -0.05, 0.1, g);
      k.box(0.03, 0.4, 0.03, M.cableBlack, 0, 0.6, 0.1, g);
      sc.inv.push({ led: led, scr: scr, knob: knob });
      k.pickable(g, 'İnverter İNV-' + (i + 1), () => invInfo(app, i), ap => {
        const off = (ap.state.invOff || []).indexOf(i) >= 0;
        return [{ label: off ? 'DC ayırıcıyı kapat (devreye al)' : 'DC ayırıcıyı aç (devre dışı)', variant: off ? 'primary' : 'warn', onClick: x => setInvOff(x, i, !off) }];
      });
    }
    // GES AC toplama panosu
    const zPan = zInv0 - (nE - 1) * INV_DZ - 1.6;
    const pan = k.group(site, xw, 0, zPan); pan.rotation.y = Math.PI / 2;
    const pw = clamp(0.6 + nInv * 0.1, 1.0, 3.0);
    k.box(pw, 0.1, 0.45, M.plasticDark, 0, 0.05, 0.25, pan);
    const cab = k.box(pw, 1.9, 0.45, M.panelRAL7035, 0, 1.05, 0.25, pan);
    const pscr = k.screen(0.16, 0.11, 160, (gx, w, h) => drawMeter(gx, w, h, app), pan, { emissive: 0.85 }); pscr.position.set(-pw / 2 + 0.2, 1.45, 0.476);
    const plate = k.screen(0.36, 0.07, 256, (gx, w, h) => { gx.fillStyle = '#f4f4f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 22px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText('GES AC PANO', w / 2, h / 2); }, pan); plate.position.set(0, 1.85, 0.476);
    sc.panScreen = pscr;
    k.pickable(cab, 'GES AC toplama panosu', () => {
      const r = app.validResult && app.validResult.values; if (!r) return [];
      const ac = X.acBreaker(Number(s.invPac), 400, Number(s.acBrk));
      return [nInv + ' inverter çıkışı · her biri ' + s.acBrk + ' A kesici (Iac ≈ ' + fmt(ac.Iac, 1) + ' A)', 'Kaçak akım: ' + ({ none: 'yok', A30: 'A tipi 30 mA', A300: 'A tipi 300 mA', B300: 'B tipi 300 mA' }[s.rcd] || '—'),
        'Anlık AC akım ≈ ' + fmt(E.threePhaseCurrent(r.now.Pac, 400, 1), 0, 'A') + ' (400 V, cosφ = 1)',
        s.expLimit ? 'İhracat sınırlayıcı: ' + fmt(s.expKW, 0, 'kW') + ' · şimdi kısılan ' + fmt(r.ext.expNowCut, 1, 'kW') : 'İhracat sınırlayıcı yok', 'Çift yönlü sayaç: dağıtım şirketi bağlantı noktasında.'];
    }, () => [{ label: s.expLimit ? 'İhracat sınırlayıcıyı kapat' : 'Sıfır ihracat rölesini devreye al', onClick: x => { x.state.expLimit = !x.state.expLimit; if (x.state.expLimit) x.state.expKW = 0; } }]);
    k.box(1.0, 0.06, Math.abs(zInv0 - zPan) + 1.4, M.galv, xw + 0.5, 3.0, (zInv0 + zPan) / 2 + 0.2, site);

    /* --- trafo merkezi (bağlantı noktası), OG direk ve AC kablosu */
    const kx = W / 2 + 9, kz = D / 2 - 4;
    const kio = k.group(site, kx, 0, kz);
    k.box(4.6, 0.25, 2.8, M.concreteDark, 0, 0.125, 0, kio);
    const kb = k.box(4.4, 2.5, 2.6, M.concrete, 0, 1.5, 0, kio);
    k.box(4.7, 0.18, 2.9, M.concreteDark, 0, 2.84, 0, kio);
    const lmat = std(k, 0xffffff, { map: a.louvreTex, roughness: 0.5, metalness: 0.5 });
    [-1.4, 0, 1.4].forEach((x, i) => {
      k.box(1.0, 2.0, 0.05, i === 1 ? lmat : M.panelDark, x, 1.3, 1.31, kio);
      const sg = k.screen(0.3, 0.26, 128, drawWarn, kio); sg.position.set(x, 1.85, 1.34);
    });
    k.pickable(kb, 'Trafo merkezi · şebeke bağlantı noktası', () => {
      const r = app.validResult && app.validResult.values; if (!r) return [];
      return ['Fazla üretim bu noktadan dağıtım şebekesine verilir (yıllık ≈ ' + VS.fmtEnergy(r.exported) + ').', 'Bağlantı görüşü, kapasite ve koruma ayarları dağıtım şirketi ile belirlenir (Lisanssız Üretim Yönetmeliği).', 'Trafo merkezi ayrıntısı: Trafo simülasyonu.'];
    });
    const acc = k.tube([[xw + 0.5, 0.3, zPan], [xw + 1.5, 0.06, zPan], [kx - 2.8, 0.06, zPan + (kz - zPan) * 0.7], [kx - 2.25, 0.06, kz], [kx - 2.2, 0.5, kz]], 0.05, M.cableBlack, site, 60);
    trash.push(acc.geometry);
    sc.flows.ac = k.flow(acc.userData.curve, 22, 0xfcd34d, 0.06, site);
    const px = kx + 6, pz = kz - 8;
    k.cyl(0.12, 0.22, 11, M.concrete, px, 5.5, pz, site, 14);
    k.box(2.4, 0.12, 0.12, M.galv, px, 10.5, pz, site);
    [-1, 0, 1].forEach(j => {
      for (let d = 0; d < 3; d++) { const ins = new T.Mesh(a.cylS, M.porcelainGrey); ins.scale.set(0.07 - d * 0.005, 0.05, 0.07 - d * 0.005); ins.position.set(px + j * 1.0, 10.62 + d * 0.07, pz); site.add(ins); }
      const w = k.tube([[px + j * 1.0, 10.8, pz], [px + j * 1.0 + 0.3, 10.1, pz - 18], [px + j * 1.0 + 0.6, 10.8, pz - 36]], 0.012, M.alu, site, 24); trash.push(w.geometry);
    });
    const dn = k.tube([[px, 10.4, pz + 0.2], [px, 6, pz + 0.22], [px, 0.4, pz + 0.22], [px - 1, 0.05, pz + 2], [kx + 2.2, 0.05, kz - 0.5], [kx + 2.2, 0.5, kz]], 0.04, M.cableBlack, site, 60);
    trash.push(dn.geometry);

    /* --- etiketler */
    const lastRow = rowsArr[rowsArr.length - 1];
    sc.lArr = k.label('PV', modGrp, [0, lastRow.y + Ly.rise / 2 + 2.2, lastRow.z]);
    sc.lInv = k.label('İnverter', invGrp, [xw + 0.4, 3.5, zInvC], 'vs-label--sm');
    sc.lKio = k.label('Trafo merkezi · şebeke', kio, [0, 3.6, 0], 'vs-label--sm');
    k.label('K ▲ Kuzey', null, [0, 0.3, -(D / 2 + 16)], 'vs-label--sm');

    /* --- güneş (dünya koordinatı; bina azimutla döner, güneş dönmez) */
    const sun = new T.Mesh(a.sphere, new T.MeshBasicMaterial({ color: 0xffe2a0, fog: false })); sun.scale.setScalar(4.5); sun.userData.noClip = true; v.root.add(sun);
    const halo = new T.Mesh(a.sphere, new T.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.22, depthWrite: false, fog: false }));
    halo.scale.setScalar(2); halo.userData.noClip = true; sun.add(halo);
    sc.sun = sun;
    sc.lSun = k.label('Güneş', sun, [0, 1.6, 0], 'vs-label--sm');
    k.pickable(sun, 'Güneş konumu', () => {
      const r = app.validResult && app.validResult.values; if (!r) return [];
      return ['Yükseklik ' + fmt(r.sun.elevation, 1) + '° · azimut ' + fmt(r.sun.azimuth, 1) + '° (güneyden, batı +)', 'Deklinasyon ' + fmt(r.sun.declination, 1) + '° · güneş saati ' + fmtHour(r.sun.solarTime), 'DNI ' + fmt(r.now.plane.DNI, 0) + ' W/m² · GHI ' + fmt(r.now.plane.GHI, 0) + ' W/m² (açık gök × bulut)', 'Spencer deklinasyonu ve zaman denklemi, UTC+3.'];
    });
    sc.R = Math.hypot(W + 30, D + 20) * 0.5 + 30;
    sc.sunDist = sc.R * 2.6;
    if (!v.scene.fog) v.scene.fog = new T.Fog(0x0b1a30, 220, 700);
    v.scene.fog.near = sc.R * 2.2; v.scene.fog.far = sc.R * 6;

    app.def.scene.bounds = [-W / 2 - 1, kx + 4];
    const half = Math.hypot(W + 34, D + 26) * 0.5 + 2;
    sc.shadowHalf = half;
    v.setShadowBox(half, half * 6);
    const span = Math.max(W, D);
    const vkey = Math.round(span / 8);
    if (v.__gesViewKey !== vkey) {
      v.__gesViewKey = vkey;
      v.setView({ target: [3, HB * 0.55, 0], r: span * 1.0 + 30, theta: 0.62, phi: 1.17, limits: { rMin: 3, rMax: Math.max(320, span * 4), phiMax: 1.48 } });
    }
    v.sun.target.position.set(0, HB * 0.5, 0); v.sun.target.updateMatrixWorld();
  }

  function invInfo(app, i) {
    const r = app.validResult && app.validResult.values, s = app.state; if (!r) return [];
    const m = r._m, off = (s.invOff || []).indexOf(i) >= 0;
    const lines = [fmt(s.invPac, 0, 'kW') + ' · ' + s.nMppt + ' MPPT × ' + s.inPerMppt + ' giriş · maks. DC ' + s.vdcMax + ' V · Isc,MPPT ' + s.iscMppt + ' A', off ? 'DC ayırıcı AÇIK: bu inverterin stringleri üretim yapmıyor.' : 'DC ayırıcı kapalı (devrede).'];
    const p = { perString: m.Ns, Vmp: Number(s.Vmp), betaVmp: Number(s.betaVmp), Pmod: Number(s.Pmod), mpptMin: Number(s.mpptMin), mpptMax: Number(s.mpptMax) };
    let shown = 0;
    for (let k = 0; k < m.plan.nMppt; k++) {
      const idx = i * m.plan.nMppt + k, nStr = m.plan.perMppt[idx] || 0;
      if (shown >= 8) { lines.push('… (' + (m.plan.nMppt - k) + ' MPPT daha)'); break; }
      const o = X.mpptPoint(p, off ? 0 : r.now.G, r.now.Tc, nStr);
      lines.push('MPPT ' + (k + 1) + ': ' + nStr + ' string · ' + (nStr && !off ? fmt(o.V, 0, 'V') + ' · ' + fmt(o.I, 1, 'A') + (o.inWindow ? '' : ' (pencere dışı!)') : 'boş'));
      shown++;
    }
    lines.push('V/I yaklaşık: Vmp sıcaklık katsayısı ve G ile ölçeklenmiş akım; gölge ve uyumsuzluk dahil değil.');
    return lines;
  }

  function drawWarn(g, w, h) {
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c200'; g.strokeStyle = '#111'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w - 14, h * 0.7); g.lineTo(14, h * 0.7); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(w / 2 + 6, 30); g.lineTo(w / 2 - 8, 58); g.lineTo(w / 2 + 2, 58); g.lineTo(w / 2 - 6, 76); g.lineTo(w / 2 + 10, 50); g.lineTo(w / 2, 50); g.closePath(); g.fill();
    g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.fillText('YÜKSEK GERİLİM', w / 2, h * 0.86);
  }
  function drawInv(g, w, h, app, i) {
    const r = app.validResult && app.validResult.values, s = app.state;
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 14px monospace'; g.fillText('INV-' + (i + 1), 8, 18);
    if (!r) return;
    const off = (s.invOff || []).indexOf(i) >= 0, on = Math.max(1, Number(s.invCount) - (s.invOff || []).length);
    g.fillStyle = !off && r.now.Pac > 0 ? '#fcd34d' : '#64748b'; g.font = 'bold 26px monospace';
    g.fillText(fmt(off ? 0 : r.now.Pac / 1000 / on, 1) + ' kW', 8, 54);
    g.fillStyle = off ? '#f87171' : '#94a3b8'; g.font = '12px monospace'; g.fillText(off ? 'DC KAPALI' : r.now.clipped > 1 ? 'KIRPMA' : r.now.Pac > 0 ? 'MPPT' : 'BEKLEME', 8, 74);
  }
  function drawMeter(g, w, h, app) {
    const r = app.validResult && app.validResult.values;
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 13px monospace'; g.fillText('SAYAÇ · ÜRETİM', 8, 18);
    if (!r) return;
    g.fillStyle = '#fcd34d'; g.font = 'bold 24px monospace'; g.fillText(fmt(r.now.Pac / 1000, 1) + ' kW', 8, 52);
    g.fillStyle = '#94a3b8'; g.font = '12px monospace'; g.fillText('Gün ' + fmt(r.today.Eac, 0) + ' kWh', 8, 80);
  }

  function sunPath(k, s, sc) {
    const T = k.T, ll = latLon(s), key = ll.lat + ',' + ll.lon + ',' + s.month + ',' + sc.sunDist.toFixed(0);
    if (sc.pathKey === key) return;
    sc.pathKey = key;
    if (sc.path) { k.viewer.root.remove(sc.path); sc.path.geometry.dispose(); }
    const pts = [], d = new T.Vector3();
    for (let h = 3; h <= 22; h += 0.2) {
      const sp = G.sunPosition(ll.lat, ll.lon, MONTH_MID[s.month - 1], h, 3);
      if (sp.elevation < -1) continue;
      sunDir(T, sp, d); pts.push(d.x * sc.sunDist, Math.max(0, d.y) * sc.sunDist, d.z * sc.sunDist);
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    const mat = new T.LineDashedMaterial({ color: 0xfcd34d, transparent: true, opacity: 0.45, dashSize: 4, gapSize: 3, fog: false });
    if (k.linearize) k.linearize(mat);
    const line = new T.Line(geo, mat);
    line.computeLineDistances(); line.userData.noClip = true;
    k.viewer.root.add(line); sc.path = line;
  }

  // MPPT renk paleti (koyu modül üzerinde hafif ton)
  const MPPT_COL = ['#9ec5ff', '#ffd59e', '#b6f0c2', '#f5b3e0', '#c9b8ff', '#9ee8f0', '#ffb3b3', '#e8f0a0', '#a0d2ff', '#ffc9a0', '#c0f0d8', '#d8c0ff'];
  function colorModules(k, sc, res, s) {
    const T = k.T, m = res.values._m, ly = sc.ly; if (!m || !sc.mods) return;
    const per = m.obs ? m.obs.per : null, clash = new Set(m.obs ? m.obs.clash : []);
    const off = new Set(s.invOff || []);
    const key = [s.showStrings, (s.invOff || []).join(','), m.Ns, m.plan.M, per ? Array.prototype.slice.call(per, 0, 64).join(',') + per.length + m.obs.frac : '', clash.size].join('|');
    if (sc.colKey === key) return;
    sc.colKey = key;
    const c = new T.Color(), white = new T.Color(1, 1, 1), grey = new T.Color(0.32, 0.32, 0.34), orange = new T.Color(1, 0.45, 0.12), red = new T.Color(1, 0.15, 0.12);
    const pal = MPPT_COL.map(h => new T.Color(h).convertSRGBToLinear());
    for (let i = 0; i < ly.n; i++) {
      const si = Math.floor(i / m.Ns), st = m.plan.strings[si];
      if (!st) c.set(0x6b7280).convertSRGBToLinear();
      else if (off.has(st.inv)) c.copy(grey);
      else if (s.showStrings) c.copy(pal[st.mppt % pal.length]);
      else c.copy(white);
      if (clash.has(i)) c.copy(red);
      else if (per && per[i] > 0) c.lerp(orange, 0.25 + 0.6 * per[i]);
      sc.mods.setColorAt(i, c);
    }
    if (sc.mods.instanceColor) sc.mods.instanceColor.needsUpdate = true;
  }

  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, M = k.mats, x = v.ext;
    sc.site.rotation.y = -num(s.azimuth, 0, -180, 180) * DEG;
    const prod = v.now.Pac > 0, clip = v.now.clipped > 1;
    sc.lArr.set('PV ' + fmt(x.installedKWp, 1) + ' kWp · ' + VS.fmtPower(v.now.Pdc) + ' DC · G ' + fmt(v.now.G, 0) + ' W/m²');
    sc.lArr.level(prod ? (v.shade > 0.05 ? 'warn' : 'ok') : '');
    const vocFail = v.string.vocCold > s.vdcMax;
    sc.lInv.set('İnverter ' + s.invCount + ' × ' + fmt(s.invPac, 0) + ' kW · ' + VS.fmtPower(v.now.Pac) + (clip ? ' · kırpma' : '') + (vocFail ? ' · Voc aşımı!' : '') + (x.offInv ? ' · ' + x.offInv + ' DC kapalı' : ''));
    sc.lInv.level(vocFail ? 'bad' : clip || x.offInv ? 'warn' : prod ? 'ok' : '');
    sc.lKio.set('Bağlantı noktası · ' + (prod ? VS.fmtPower(v.now.Pac) + ' üretim' : 'üretim yok'));
    const sp = k.reducedMotion ? 0 : 1;
    sc.flows.dc.speed = sp * clamp(v.now.Pdc / Math.max(x.installedKWp * 1000, 1), 0, 1.2) * 0.35;
    sc.flows.ac.speed = sp * clamp(v.now.Pac / Math.max(v.Pac * 1000, 1), 0, 1.2) * 0.5;
    const off = new Set(s.invOff || []);
    sc.inv.forEach((iv, i) => {
      const o = off.has(i);
      iv.led.material = o ? M.ledRed : vocFail ? M.ledRed : clip ? M.ledAmber : prod ? M.ledGreen : M.ledOff;
      iv.knob.rotation.z = o ? Math.PI / 2 : 0;
      if (iv.scr) iv.scr.redraw();
    });
    sc.panScreen.redraw();
    if (sc.obs) {
      const o = obstacleOf(s), y0 = X.roofY(sc.ly, o.z);
      sc.obs.position.set(o.x, y0, o.z);
      const p = sc.obsParts;
      p.body.scale.set(o.w, o.h * 0.88, o.d); p.body.position.set(0, o.h * 0.44, 0);
      p.grille.scale.set(o.w * 0.94, o.h * 0.12, o.d * 0.94); p.grille.position.set(0, o.h * 0.94, 0);
      p.fans.forEach((f, i) => { const r = Math.min(o.w / 4, o.d / 2) * 0.8; f.scale.set(r, 0.06, r); f.position.set((i ? 1 : -1) * o.w / 4, o.h + 0.03, 0); });
      sc.lObs.off.set(0, o.h + 0.6, 0);
      sc.lObs.set('Engel · gölge %' + fmt(x.obsFrac * 100, 1)); sc.lObs.level(x.obsClash ? 'bad' : x.obsFrac > 0.02 ? 'warn' : 'ok');
    }
    colorModules(k, sc, res, s);
    sunPath(k, s, sc);
  }

  /* güneş, ışık ve gökyüzü: saat her karede ilerlediği için animate içinde (yalnız görsel) */
  const SKY = { night: 0x0b1a30, dusk: 0xb87452, day: 0x6f9fd2, high: 0x88b6e2, over: 0x8e99a6 };
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const T = k.T, v = k.viewer, ll = latLon(s);
    const key = ll.lat + ',' + ll.lon + ',' + s.month + ',' + s.hour + ',' + s.cloud + ',' + s.azimuth;
    if (sc.sunKey === key) return;
    sc.sunKey = key;
    const sp = G.sunPosition(ll.lat, ll.lon, MONTH_MID[clamp(Math.round(s.month), 1, 12) - 1], Number(s.hour), 3);
    const d = sunDir(T, sp);
    sc.sun.position.copy(d).multiplyScalar(sc.sunDist);
    sc.sun.position.y = Math.max(sc.sun.position.y, -6);
    sc.sun.visible = sp.elevation > -3;
    const el = sp.elevation;
    const day = sstep(-4, 14, el);
    const cf = G.cloudFactor(num(s.cloud, 0, 0, 1));
    const dl = sunDir(T, { elevation: Math.max(el, 3), azimuth: sp.azimuth });
    v.sun.position.copy(v.sun.target.position).addScaledVector(dl, sc.shadowHalf * 2.4);
    v.sun.intensity = 6.0 * sstep(-1, 12, el) * (0.25 + 0.75 * cf);
    const warm = new T.Color(0xffb36b).lerp(new T.Color(0xfff3e0), sstep(3, 30, el));
    v.sun.color.copy(warm).convertSRGBToLinear();
    const sky = new T.Color(SKY.night).lerp(new T.Color(SKY.dusk), sstep(-7, 3, el) * (1 - sstep(4, 20, el)));
    if (el > 4) sky.lerp(new T.Color(SKY.day).lerp(new T.Color(SKY.high), sstep(20, 60, el)), sstep(4, 20, el));
    sky.lerp(new T.Color(SKY.over), (1 - cf) * day * 0.85);
    v.scene.background = sky;
    if (v.scene.fog) v.scene.fog.color.copy(sky).convertSRGBToLinear();
    if (v.hemi) { v.hemi.intensity = 0.06 + 0.3 * day; v.hemi.color.copy(sky).lerp(new T.Color(0xffffff), 0.5).convertSRGBToLinear(); }
    v.renderer.toneMappingExposure = 0.38 + 0.4 * day;
    sc.sun.material.color.set(el < 8 ? 0xffb26b : 0xffe7b0).convertSRGBToLinear();
    sc.lSun.set('Güneş · ' + (el > 0 ? fmt(el, 0) + '°' : 'ufkun altında') + ' · ' + fmtHour(s.hour));
    void dt; void res; void live;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması (ölçeklenir; gerekirse dikey kaydırma) */
  function layout2d(W, s) {
    const n = Math.round(num(s.invCount, 1, 1, 10000));
    const zoneW = Math.max(70, W * 0.22);
    const cellW = 64, cellH = 26;
    const cols = Math.max(1, Math.floor(zoneW / cellW));
    const rows = Math.ceil(n / cols);
    const top = 112, diagH = Math.max(210, rows * (cellH + 6) + 30);
    const loadY = top + diagH + 10, heatY = loadY + 92;
    const heatH = 12 * 15 + 46;
    return { n: n, cols: cols, rows: rows, cellW: cellW, cellH: cellH, zoneW: zoneW, top: top, diagH: diagH, loadY: loadY, heatY: heatY, total: heatY + heatH + 34 };
  }
  function view2dHeight(W, res, s) { return layout2d(W, s).total; }
  function fit(g, text, w) {
    text = String(text); if (g.measureText(text).width <= w) return text;
    while (text.length > 1 && g.measureText(text + '…').width > w) text = text.slice(0, -1);
    return text + '…';
  }
  function view2d(g, W, H, res, s) {
    const v = res.values, x = v.ext, st = id => (res.checks.find(c => c.id === id) || {}).status;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a', amb: '#fcd34d' };
    const sm = W < 560, f = sm ? 10 : 12;
    const C = c => ({ ok: col.ok, warn: col.warn, fail: col.bad }[c] || col.dim);
    const L = layout2d(W, s);
    const font = (b, sz) => { g.font = (b ? 'bold ' : '') + (sz || f) + 'px Inter, sans-serif'; };
    const txt = (t, px, py, c, w, al, b) => { font(b); g.fillStyle = c || col.text; g.textAlign = al || 'center'; g.fillText(w ? fit(g, t, w) : t, px, py); };
    g.lineCap = 'round'; g.textBaseline = 'alphabetic'; g.lineWidth = 2;
    txt('GES tek hat şeması', 16, 62, col.text, W * 0.55, 'left', true);
    txt(MONTHS[s.month - 1] + ' · ' + fmtHour(s.hour) + ' · ' + (G.CITIES[s.city] ? s.city : 'özel koordinat'), 16, 78, col.dim, W * 0.55, 'left');
    // güneş yayı
    const sx = W - (sm ? 100 : 140), sy = 58, sr = sm ? 34 : 50;
    g.strokeStyle = '#2c4466'; g.lineWidth = 1.5; g.beginPath(); g.arc(sx, sy + 10, sr, Math.PI, 0); g.stroke();
    g.beginPath(); g.moveTo(sx - sr - 8, sy + 10); g.lineTo(sx + sr + 8, sy + 10); g.stroke();
    const ang = Math.PI - clamp((s.hour - 5) / 15, 0, 1) * Math.PI, hgt = Math.max(-0.1, Math.sin(v.sun.elevation * DEG));
    g.fillStyle = v.sun.elevation > 0 ? col.amb : '#475569'; g.beginPath(); g.arc(sx + Math.cos(ang) * sr, sy + 10 - hgt * sr, 6, 0, Math.PI * 2); g.fill();
    txt(v.sun.elevation > 0 ? 'Güneş ' + fmt(v.sun.elevation, 0) + '°' : 'Gece', sx, sy + 26, col.dim);
    g.lineWidth = 2;

    const y = L.top + L.diagH / 2, prod = v.now.Pac > 0;
    const xPV = W * 0.07 + 6, xDC = W * 0.2, zx0 = W * 0.27, zx1 = zx0 + L.zoneW, xBus = zx1 + W * 0.05;
    const xMet = xBus + (W - xBus) * 0.32, xTr = xBus + (W - xBus) * 0.66;
    const colW = Math.max(40, W * 0.12);
    // PV dizisi
    g.strokeStyle = col.line; g.strokeRect(xPV - 22, y - 28, 44, 56);
    g.beginPath(); g.moveTo(xPV - 22, y + 28); g.lineTo(xPV + 22, y - 28); g.stroke();
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(xPV - 14 + i * 10, y - 44); g.lineTo(xPV - 8 + i * 10, y - 32); g.stroke(); }
    txt(fmt(x.installedKWp, 1) + ' kWp', xPV, y + 46, col.text, colW, 'center', true);
    txt(x.nStrings + ' × ' + s.perString + ' modül', xPV, y + 61, col.dim, colW);
    txt('G ' + fmt(v.now.G, 0) + ' W/m²', xPV, y + 76, col.dim, colW);
    // DC koruma kutusu (sigorta, SPD)
    g.strokeStyle = prod ? col.amb : col.line; g.beginPath(); g.moveTo(xPV + 22, y); g.lineTo(xDC - 14, y); g.stroke();
    g.strokeStyle = col.line; g.strokeRect(xDC - 14, y - 22, 28, 44);
    g.beginPath(); g.rect(xDC - 4, y - 14, 8, 14); g.stroke(); // sigorta
    if (s.spdOn) { g.beginPath(); g.moveTo(xDC, y + 4); g.lineTo(xDC, y + 12); g.moveTo(xDC - 6, y + 12); g.lineTo(xDC + 6, y + 12); g.moveTo(xDC - 3, y + 16); g.lineTo(xDC + 3, y + 16); g.stroke(); }
    txt('DC kutusu', xDC, y - 30, col.dim, Math.max(40, zx0 - xPV - 30));
    txt(s.strFuse ? s.strFuse + ' A gPV' : 'sigorta yok', xDC, y + 38, C(st('fuse')), Math.max(40, (zx0 - xPV) * 0.9));
    txt(s.spdOn ? 'SPD ' + s.spdUcpv + ' V' : 'SPD yok', xDC, y + 53, C(st('spd')), Math.max(40, (zx0 - xPV) * 0.9));
    txt('Voc ' + fmt(v.string.vocCold, 0) + ' V', xDC, y + 68, C(st('voc')), Math.max(40, (zx0 - xPV) * 0.9));
    // inverter ızgarası ve DC/AC baraları
    const gx0 = zx0 + 4, gy0 = y - (L.rows * (L.cellH + 6)) / 2;
    g.strokeStyle = prod ? col.amb : col.line; g.beginPath(); g.moveTo(xDC + 14, y); g.lineTo(gx0 - 6, y); g.moveTo(gx0 - 6, gy0); g.lineTo(gx0 - 6, gy0 + L.rows * (L.cellH + 6) - 6); g.stroke();
    const off = new Set(s.invOff || []);
    const cw = Math.min(L.cellW - 6, (L.zoneW - 8) / L.cols - 6);
    for (let i = 0; i < L.n; i++) {
      const cx = gx0 + (i % L.cols) * (cw + 6), cy = gy0 + Math.floor(i / L.cols) * (L.cellH + 6);
      const o = off.has(i);
      g.strokeStyle = o ? col.bad : col.line; g.strokeRect(cx, cy, cw, L.cellH);
      g.beginPath(); g.moveTo(cx, cy + L.cellH); g.lineTo(cx + Math.min(14, cw / 3), cy + L.cellH - 10); g.stroke();
      font(false, 9); g.fillStyle = o ? col.bad : col.text; g.textAlign = 'center'; g.fillText(fit(g, (o ? '✕ ' : '') + (i + 1), cw - 4), cx + cw / 2 + 4, cy + L.cellH / 2 + 4);
    }
    txt(s.invCount + ' × ' + fmt(s.invPac, 0) + ' kW', (zx0 + zx1) / 2, gy0 - 22, col.text, L.zoneW, 'center', true);
    txt('DC/AC ' + fmt(v.dcac, 2) + ' · MPPT ' + x.M, (zx0 + zx1) / 2, gy0 - 8, C(st('dcac')), L.zoneW);
    // AC bara
    g.strokeStyle = col.cu; g.lineWidth = 6; g.beginPath(); g.moveTo(xBus, L.top + 14); g.lineTo(xBus, L.top + L.diagH - 14); g.stroke(); g.lineWidth = 2;
    g.strokeStyle = prod ? col.amb : col.line; g.beginPath(); g.moveTo(zx1, y); g.lineTo(xBus, y); g.stroke();
    txt('AC pano', xBus, L.top + 6, col.dim, colW);
    txt(s.acBrk + ' A · ' + ({ none: 'RCD yok', A30: 'RCD A 30 mA', A300: 'RCD A 300 mA', B300: 'RCD B 300 mA' }[s.rcd] || ''), xBus - 10, L.top + L.diagH + 8, C(st('acb')), Math.max(60, xBus - zx0 - 14), 'right');
    // sayaç, ihracat sınırlayıcı, trafo, şebeke
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(xBus, y); g.lineTo(xMet - 14, y); g.stroke();
    g.beginPath(); g.arc(xMet, y, 14, 0, Math.PI * 2); g.stroke(); txt('kWh', xMet, y + 4, col.text, 26, 'center');
    txt('Çift yönlü', xMet, y + 32, col.dim, (xTr - xMet) * 0.9); txt('sayaç', xMet, y + 46, col.dim, (xTr - xMet) * 0.9);
    if (s.expLimit) txt('İhracat ≤ ' + fmt(s.expKW, 0) + ' kW', xMet, y - 24, col.warn, (xTr - xMet) * 0.95);
    g.beginPath(); g.moveTo(xMet + 14, y); g.lineTo(xTr - 20, y); g.stroke();
    g.beginPath(); g.arc(xTr - 7, y, 12, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(xTr + 7, y, 12, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(xTr + 19, y); g.lineTo(W - 8, y); g.stroke();
    txt('Trafo', xTr, y + 32, col.dim, (W - xTr) * 1.2); txt('OG →', Math.min(W - 24, xTr + 26), y - 18, col.dim, 40);
    // yük kolu
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(xBus, L.top + L.diagH - 14); g.lineTo(xBus, L.loadY + 20); g.stroke();
    g.beginPath(); g.moveTo(xBus - 6, L.loadY + 12); g.lineTo(xBus, L.loadY + 22); g.lineTo(xBus + 6, L.loadY + 12); g.stroke();
    txt('Fabrika yükü · ' + VS.fmtEnergy(s.consumption) + '/yıl · şimdi ≈ ' + fmt(x.nowLoad, 0) + ' kW', xBus, L.loadY + 40, col.text, Math.min(W - 20, 2 * Math.min(xBus, W - xBus) - 10));
    txt('Öz tüketim %' + fmt(v.selfRatio * 100, 0) + ' · anlık AC ' + VS.fmtPower(v.now.Pac), xBus, L.loadY + 56, col.dim, Math.min(W - 20, 2 * Math.min(xBus, W - xBus) - 10));
    // ay × saat ısı haritası
    const hm = heatMatrix(res.values._m);
    const hx0 = 46, hy0 = L.heatY + 24, hw = W - hx0 - 16, cwH = hw / 16, chH = 15;
    let mx = 0; hm.forEach(r => r.forEach(q => { mx = Math.max(mx, q); }));
    txt('Ay × saat AC güç ısı haritası (kW, temsilî günler · engel hariç)', 16, L.heatY + 12, col.text, W - 32, 'left', true);
    for (let mI = 0; mI < 12; mI++) {
      for (let h = 0; h < 16; h++) {
        const t = mx > 0 ? hm[mI][h] / mx : 0;
        g.fillStyle = t <= 0 ? '#0e2240' : 'hsl(' + (220 - 180 * t) + ',' + (60 + 30 * t) + '%,' + (18 + 45 * t) + '%)';
        g.fillRect(hx0 + h * cwH + 0.5, hy0 + mI * chH + 0.5, cwH - 1, chH - 1);
      }
      txt(MON3[mI], hx0 - 6, hy0 + mI * chH + 11, mI + 1 === Number(s.month) ? col.amb : col.dim, 40, 'right');
    }
    const hEvery = cwH < 26 ? 3 : cwH < 40 ? 2 : 1;
    for (let h = 0; h < 16; h += hEvery) txt(String(5 + h).padStart(2, '0'), hx0 + h * cwH + cwH / 2, hy0 + 12 * chH + 13, col.dim, cwH * hEvery);
    const hh = Number(s.hour) - 5;
    if (hh >= -0.5 && hh <= 15.5) { g.strokeStyle = col.amb; g.lineWidth = 1.5; g.strokeRect(hx0 + Math.round(hh) * cwH, hy0 + (s.month - 1) * chH, cwH, chH); }
    txt('en yüksek ' + fmt(mx, 0) + ' kW', W - 16, hy0 + 12 * chH + 28, col.dim, W / 2, 'right');
  }

  /* ---------------------------------------------------------------- senaryolar ve görevler */
  const scen = (o) => Object.assign(defaults(), o);
  const SAMPLE_MONTHLY = [72, 88, 124, 142, 168, 178, 190, 180, 150, 116, 82, 66];
  const ck = (r, id) => (r.checks.find(c => c.id === id) || {}).status;
  const ERZ = { city: 'Erzurum', lat: 39.9, lon: 41.27, month: 1, hour: 9, Ta: -12, Tmin: -30, Tmax: 32, perString: 22, nMod: 352, rows: 11, cloud: 0, albedo: 0.6, consumption: 380000 };
  const ANK = { city: 'Ankara', lat: 39.93, lon: 32.86, tilt: 30, pitch: 2.8, month: 12, hour: 12, Ta: 2, cloud: 0.05, Tmin: -15 };

  VS.register({
    id: 'ges', title: '3D GES Simülasyonu',
    defaults: defaults,
    initLive: () => ({ acc: 0 }),
    autoRun: false,
    startText: 'Gün oynatılıyor: güneş doğudan batıya ilerliyor, üretim saat saat hesaplanıyor (1 saat ≈ 2 s).',
    start: app => { const h = Number(app.state.hour); if (!(h >= 5 && h < 20)) app.state.hour = 5; app.live.acc = 0; app._startedOnce = true; app.invalidate(); },
    tasks: [
      { id: 'voc', title: 'Kış sabahı string aşırı gerilimini gider', goal: 'Erzurum’da −30 °C’de string Voc inverterin 1100 V sınırını aşıyor. Panel adedini 340’ın altına düşürmeden Voc kontrolünü uygun hâle getirin.', hint: 'String ve inverter → “String başına modül” sayısını azaltın; Voc ≈ Ns·Voc·[1 + βVoc·(Tmin − 25)].',
        state: scen(ERZ), check: (r, s) => ck(r, 'voc') === 'ok' && s.nMod >= 340 },
      { id: 'clip', title: 'Öğlen kırpmasını %1’in altına indir', goal: 'Antalya’da 194 kWp diziye tek 110 kW inverter bağlı. Panel sayısını değiştirmeden haziran gününde kırpılan enerjiyi günlük üretimin %1’inin altına indirin.', hint: 'İnverter adedini veya modelini değiştirin; DC/AC oranını izleyin.',
        state: scen(Object.assign({ city: 'Antalya', lat: 36.9, lon: 30.7, month: 6, hour: 12.5, cloud: 0, Ta: 33, tilt: 20 }, invFields('i110', 1))), check: (r, s) => s.nMod >= 360 && r.values.today.Eclip < 0.01 * r.values.today.Eac && ck(r, 'inputs') === 'ok' },
      { id: 'shade', title: 'Aralık öğlesinde sıra gölgesini kaldır', goal: 'Ankara’da 30° eğim ve 2,8 m sıra aralığında aralık öğlesinde arka sıralar gölgede. 360 modülü koruyarak 12:00’de sıra gölgesini %1’in altına indirin.', hint: 'Sıra aralığını büyütün ya da eğimi azaltın (düz çatı). Ay aralık, saat 12:00 kalmalı.',
        state: scen(ANK), check: (r, s) => s.month === 12 && Math.abs(s.hour - 12) <= 0.5 && s.nMod >= 360 && s.roof === 'flat' && r.values.shade < 0.01 },
      { id: 'obstacle', title: 'Çatı engelinin gölgesinden kurtul', goal: 'Dizinin güneyindeki HVAC ünitesi mart sabahı modülleri gölgeliyor. Engeli kaldırmadan, çakışma olmadan gölgeyi %0,5’in altına indirin.', hint: '3D’de engele tıklayıp kuzeye taşıyın ya da “Çatı engeli” kaydırıcılarını kullanın.',
        state: scen({ month: 3, hour: 10, obsOn: true, obsX: -6, obsZ: 22.5, obsW: 4, obsD: 2.5, obsH: 4 }), check: (r, s) => s.obsOn && r.values.ext.obsFrac < 0.005 && r.values.ext.obsClash === 0 },
      { id: 'dcac', title: 'İnverteri doğru boyutlandır', goal: 'Üç adet 110 kW inverter 194 kWp için fazla büyük (DC/AC ≈ 0,59). DC/AC oranını 1,10–1,30 aralığına getirin; MPPT girişleri yetmeli ve Voc uygun kalmalı.', hint: 'İnverter modelini/adedini değiştirin (ör. 2 × 80 kW).',
        state: scen(invFields('i110', 3)), check: r => r.values.dcac >= 1.1 && r.values.dcac <= 1.3 && ck(r, 'inputs') === 'ok' && ck(r, 'voc') === 'ok' },
      { id: 'fuse', title: 'String sigortasını seç', goal: 'Birleştirme kutulu bu tasarımda MPPT başına 5 string paralel bağlı. IEC 62548-1’e göre gereken string sigortasını doğru anma değeriyle seçin.', hint: 'DC/AC koruma → String sigortası: 1,5·Isc ≤ In ≤ 2,4·Isc ve modül maks. seri sigorta değerini aşmamalı.',
        state: scen({ invSel: 'custom', invPac: 160, invCount: 1, nMppt: 4, inPerMppt: 5, iscMppt: 100, vdcMax: 1100, mpptMin: 200, mpptMax: 1000, invEff: 98.5, acBrk: 315 }), check: (r, s) => r.values.ext.maxPerMppt >= 3 && ck(r, 'fuse') === 'ok' && Number(s.strFuse) > 0 },
      { id: 'clean', title: 'Kirlenmiş panelleri temizle', goal: 'Toz ve kuş pisliği %8 kayıp yaratıyor. 3D’de modüllere tıklayıp temizleyin ve özgül verimin arttığını görün.', hint: '3D sahnede panellere tıklayın → “Panelleri temizle”.',
        state: scen({ soiling: 8 }), check: (r, s) => Number(s.soiling) === 0 }
    ],
    scenarios: [
      { id: 'izmir', name: 'İzmir fabrika çatısı · haziran günü', desc: '194 kWp, 2 × 80 kW inverter, 15° eğik sıralar. Simülasyonu başlatıp günü oynatın.', state: scen({}), start: true },
      { id: 'voc', name: 'Kış sabahı · string Voc sınırı aşılıyor', desc: 'Erzurum, Tmin −30 °C, 22 modüllü stringler: soğukta açık devre gerilimi inverter sınırını aşar.', state: scen(ERZ) },
      { id: 'clip', name: 'Aşırı DC/AC · öğlen kırpması', desc: 'Antalya, 194 kWp DC’ye yalnız 110 kW inverter (DC/AC ≈ 1,77): öğlen saatlerinde inverter sınırında kırpma.', state: scen(Object.assign({ city: 'Antalya', lat: 36.9, lon: 30.7, month: 6, hour: 12.5, cloud: 0, Ta: 33, tilt: 20 }, invFields('i110', 1))) },
      { id: 'shade', name: 'Sıra arası gölge · aralık öğlesi', desc: 'Ankara, 30° eğim ve 2,8 m sıra aralığı: kışın düşük güneşte ön sıra arkadakini gölgeler.', state: scen(ANK) },
      { id: 'trapez', name: 'Trapez sac çatı · çift yüzlü modül', desc: '10° eğimli beşik çatının güney yüzü, 580 Wp bifasiyal modüller (açık renkli çatı), 3 × 80 kW inverter.', state: scen(Object.assign({ roof: 'trapez', tilt: 10, rows: 8, nMod: 400, albedo: 0.5, perString: 20 }, modFields('m580'), invFields('i80', 3))) },
      { id: 'obs', name: 'Çatıdaki HVAC ünitesinin gölgesi', desc: 'Dizinin güneyinde 4 m yüksekliğinde klima ünitesi; mart sabahı gölgesi turuncu modüllerde.', state: scen({ month: 3, hour: 10, obsOn: true, obsX: -6, obsZ: 22.5, obsW: 4, obsD: 2.5, obsH: 4 }) },
      { id: 'big', name: 'Büyük fabrika · 1,6 MWp, 14 inverter', desc: '3000 modül, 30 sıra, 14 × 110 kW inverter; sıfır ihracat rölesi ile.', state: scen(Object.assign({ nMod: 3000, rows: 30, perString: 20, roofArea: 22000, consumption: 2600000, profile: 'uc', capex: 38000000, expLimit: true, expKW: 0 }, invFields('i110', 14))) },
      { id: 'pvgis', name: 'PVGIS verisiyle yıllık üretim (örnek değerler)', desc: 'Aylık kWh/kWp alanına temsilî değerler girildi; bunlar PVGIS çıktısı değildir — kendi PVGIS verinizi ve kaynağını girin.', state: scen({ pvgisMonthly: SAMPLE_MONTHLY.slice(), pvgisSource: 'Temsilî örnek — kendi PVGIS çıktınızla değiştirin' }) },
      { id: 'west', name: 'Batıya yönelik çatı · akşam tüketimi', desc: 'Azimut +60° (güneybatı-batı), ofis profili: üretim öğleden sonraya kayar.', state: scen({ azimuth: 60, tilt: 10, profile: 'ofis', month: 7, hour: 17 }) }
    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    reportInputs: s => {
      const ll = latLon(s);
      return [{ group: 'Konum', label: 'Koordinat', value: fmt(ll.lat, 2) + '° K, ' + fmt(ll.lon, 2) + '° D' },
        { group: 'String ve inverter', label: 'DC ayırıcısı açık inverterler', value: (s.invOff || []).length ? s.invOff.map(i => 'İNV-' + (i + 1)).join(', ') : 'yok' }];
    },
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-20, 30] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
