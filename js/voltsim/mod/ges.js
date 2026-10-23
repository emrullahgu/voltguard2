/* VoltSim · 3D GES (Çatı Güneş Santrali) Simülasyonu
 * Hesap: VoltSimEngine.ges (Spencer güneş konumu, Meinel açık gök × Kasten–Czeplak bulut, Liu–Jordan düzlem ışınımı,
 * NOCT hücre sıcaklığı, sıra arası geometrik gölge, string Voc/MPPT kontrolü, öz tüketim ve geri dönüş).
 * Sahne: hesap sonucunu gösterir (güneş konumu ve gölgeler, enerji akışı, inverter durumu). Hiçbir sonuç animasyondan türetilmez. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const G = E.ges;
  const DEG = Math.PI / 180;
  const clamp = E.clamp;
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const MON3 = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  // Motorun kullandığı temsilî günlerle aynı (Klein). Yalnız güneş animasyonunun ara saatleri için gerekir;
  // hesaplanan değerler her zaman G.compute() sonucundan okunur.
  const MONTH_MID = E.ges.MONTH_MID; // motorun temsilî gün tablosu
  const CITY_LIST = Object.keys(G.CITIES);
  const HOURS_PER_S = 0.5; // simülasyon: 1 saat ≈ 2 s

  function defaults() {
    return {
      city: 'İzmir', lat: 38.42, lon: 27.14,
      month: 6, hour: 12, Ta: 28, cloud: 0.1, albedo: 0.2,
      roofArea: 2400, azimuth: 0, tilt: 15, rows: 12, nMod: 360, moduleLen: 2.28, pitch: 3.6,
      Pmod: 540, Voc: 49.6, Vmp: 41.6, Isc: 13.9, betaVoc: -0.27, betaVmp: -0.35, gamma: -0.35, noct: 45,
      perString: 18, stringsPerMppt: 2, Pac: 160, vdcMax: 1100, mpptMin: 200, mpptMax: 1000, iscMppt: 40, invEff: 98.2, dcLoss: 14,
      Tmin: -3, Tmax: 40,
      consumption: 450000, profile: 'tek', price: 5, exportPrice: 3, capex: 4800000,
      pvgisMonthly: null, pvgisSource: ''
    };
  }

  /* ---------------------------------------------------------------- yardımcılar */
  function num(v, d, lo, hi) { v = Number(v); if (!isFinite(v)) v = d; return clamp(v, lo, hi); }
  function fmtHour(h) {
    h = ((h % 24) + 24) % 24; let hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh = (hh + 1) % 24; mm = 0; }
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }
  function latLon(s) { const c = G.CITIES[s.city]; return c ? { lat: c[0], lon: c[1] } : { lat: Number(s.lat), lon: Number(s.lon) }; }
  function engineInput(s) { return Object.assign({}, s, latLon(s)); }
  /** Görsel inverter adedi (toplam Pac, ~110 kW'lık string inverterlere bölünmüş temsil). */
  function nInvOf(s) { return clamp(Math.ceil(num(s.Pac, 100, 1, 100000) / 110), 1, 6); }
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

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const r = app.validResult && app.validResult.values;
    const custom = !G.CITIES[s.city];
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
        { type: 'range', key: 'albedo', label: 'Zemin yansıtma (albedo)', min: 0, max: 0.9, step: 0.05, digits: 2 }
      ] },
      { title: 'Çatı ve yerleşim', items: [
        { type: 'number', key: 'roofArea', label: 'Kullanılabilir çatı alanı', min: 0, max: 1e6, step: 10, unit: 'm²' },
        { type: 'range', key: 'azimuth', label: 'Panel azimutu (güney = 0°, batı +)', min: -90, max: 90, step: 5, unit: '°', help: 'Sahnede bina ve paneller birlikte döner; kuzey oku sabittir.' },
        { type: 'range', key: 'tilt', label: 'Panel eğimi', min: 0, max: 45, step: 1, unit: '°' },
        { type: 'number', key: 'nMod', label: 'Panel adedi', min: 1, max: 20000, step: 1 },
        { type: 'range', key: 'rows', label: 'Sıra sayısı', min: 1, max: 40, step: 1 },
        { type: 'range', key: 'pitch', label: 'Sıra aralığı (pitch)', min: 0, max: 10, step: 0.1, unit: 'm', digits: 1, help: 'Bir sıranın ön kenarından sonrakinin ön kenarına. 0: sıra arası gölge hesaplanmaz.' },
        { type: 'number', key: 'moduleLen', label: 'Modül boyu (eğim yönünde)', min: 0.5, max: 3, step: 0.01, unit: 'm', digits: 2 },
        r ? { type: 'note', html: 'Sıra başına ≈ <b>' + Math.ceil(s.nMod / Math.max(1, s.rows)) + '</b> modül · gölge (şimdi) <b>%' + fmt(r.shade * 100, 0) + '</b>' + (layout(s).capped ? ' · <b>sahne temsilîdir</b> (40 sıra × 80 modül ile sınırlı)' : '') } : null
      ] },
      { title: 'Modül (katalog)', collapsed: true, summary: 'Elektriksel ve ısıl değerler', items: [
        { type: 'number', key: 'Pmod', label: 'Modül gücü Pmax (STC)', min: 50, max: 800, step: 5, unit: 'Wp' },
        { type: 'number', key: 'Voc', label: 'Açık devre gerilimi Voc', min: 1, max: 100, step: 0.1, unit: 'V', digits: 1 },
        { type: 'number', key: 'Vmp', label: 'MPP gerilimi Vmp', min: 1, max: 100, step: 0.1, unit: 'V', digits: 1 },
        { type: 'number', key: 'Isc', label: 'Kısa devre akımı Isc', min: 0.1, max: 30, step: 0.1, unit: 'A', digits: 1 },
        { type: 'number', key: 'betaVoc', label: 'βVoc', min: -1, max: 0, step: 0.01, unit: '%/°C', digits: 2 },
        { type: 'number', key: 'betaVmp', label: 'βVmp', min: -1, max: 0, step: 0.01, unit: '%/°C', digits: 2 },
        { type: 'number', key: 'gamma', label: 'γPmax', min: -1, max: 0, step: 0.01, unit: '%/°C', digits: 2 },
        { type: 'number', key: 'noct', label: 'NOCT', min: 35, max: 60, step: 1, unit: '°C' },
        { type: 'note', text: 'Varsayılanlar 540 Wp sınıfı tipik bir monokristal modülün örnek katalog değerleridir; projede kullanılacak modülün veri sayfası esastır.' }
      ] },
      { title: 'String ve inverter', items: [
        { type: 'range', key: 'perString', label: 'String başına modül', min: 4, max: 32, step: 1 },
        { type: 'range', key: 'stringsPerMppt', label: 'MPPT başına string', min: 1, max: 6, step: 1 },
        { type: 'number', key: 'Pac', label: 'İnverter toplam AC gücü', min: 1, max: 100000, step: 5, unit: 'kW' },
        { type: 'number', key: 'vdcMax', label: 'İnverter maks. DC giriş gerilimi', min: 100, max: 1500, step: 10, unit: 'V' },
        { type: 'number', key: 'mpptMin', label: 'MPPT alt sınır', min: 50, max: 1500, step: 10, unit: 'V' },
        { type: 'number', key: 'mpptMax', label: 'MPPT üst sınır', min: 50, max: 1500, step: 10, unit: 'V' },
        { type: 'number', key: 'iscMppt', label: 'MPPT maks. kısa devre akımı', min: 1, max: 200, step: 1, unit: 'A' },
        { type: 'range', key: 'invEff', label: 'İnverter verimi', min: 90, max: 99.5, step: 0.1, unit: '%', digits: 1 },
        { type: 'range', key: 'dcLoss', label: 'Sistem kayıpları', min: 0, max: 30, step: 0.5, unit: '%', digits: 1, help: 'Kablo, kirlenme, uyumsuzluk, LID vb. toplamı. %14, PVGIS’in varsayılan sistem kaybıdır.' },
        { type: 'range', key: 'Tmin', label: 'Tasarım en düşük ortam sıcaklığı', min: -40, max: 20, step: 1, unit: '°C', help: 'Soğuk ve açık sabahta string Voc en yüksek değerini alır.' },
        { type: 'range', key: 'Tmax', label: 'Tasarım en yüksek ortam sıcaklığı', min: 15, max: 55, step: 1, unit: '°C' },
        r ? { type: 'note', html: '<b>' + r.nStrings + '</b> string × ' + s.perString + ' modül · ' + nInvOf(s) + ' inverter (sahnede temsilî bölünmüş) · Voc(Tmin) <b>' + fmt(r.string.vocCold, 0, 'V') + '</b>' } : null
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
    const v = res.values, st = v.string, now = v.now;
    const st0 = id => (res.checks.find(c => c.id === id) || {}).status;
    const lv = id => ({ ok: 'ok', warn: 'warn', fail: 'bad' }[st0(id)] || undefined);
    const night = v.sun.elevation <= 0;
    return [
      { label: 'Kurulu güç (DC)', value: fmt(v.kWp, 1, 'kWp'), sub: s.nMod + ' × ' + s.Pmod + ' Wp' },
      { label: 'İnverter (AC)', value: fmt(v.Pac, 0, 'kW'), sub: nInvOf(s) + ' adet (temsilî)' },
      { label: 'DC/AC oranı', value: fmt(v.dcac, 2), level: lv('dcac'), sub: 'tipik 0,9–1,35' },
      { label: 'Anlık AC güç', value: VS.fmtPower(now.Pac), level: now.clipped > 1 ? 'warn' : undefined, sub: fmtHour(s.hour) + ' · ' + MONTHS[s.month - 1] + (now.clipped > 1 ? ' · kırpma ' + VS.fmtPower(now.clipped) : night ? ' · güneş ufkun altında' : '') },
      { label: 'Düzlem ışınımı G', value: fmt(now.G, 0, 'W/m²'), sub: 'GHI ' + fmt(now.plane.GHI, 0) + ' · gölge %' + fmt(v.shade * 100, 0) },
      { label: 'Hücre sıcaklığı', value: fmt(now.Tc, 1, '°C'), sub: 'Ta ' + fmt(s.Ta, 0) + ' °C · NOCT ' + s.noct + ' °C' },
      { label: 'String Voc (Tmin)', value: fmt(st.vocCold, 0, 'V'), level: lv('voc'), sub: 'sınır ' + s.vdcMax + ' V · ' + s.Tmin + ' °C' },
      { label: 'Vmp aralığı', value: fmt(st.vmpHot, 0) + '–' + fmt(st.vmpCold, 0) + ' V', level: st0('mpptLo') === 'ok' && st0('mpptHi') === 'ok' ? 'ok' : 'warn', sub: 'MPPT ' + s.mpptMin + '–' + s.mpptMax + ' V' },
      { label: 'Günlük enerji', value: VS.fmtEnergy(v.today.Eac), sub: MONTHS[s.month - 1] + (v.today.Eclip > 0.05 ? ' · kırpma ' + VS.fmtEnergy(v.today.Eclip) : ' · temsilî gün') },
      { label: 'Yıllık enerji', value: VS.fmtEnergy(v.annual), sub: s.pvgisMonthly ? 'PVGIS verisi (kullanıcı)' : 'açık gök × bulut senaryosu' },
      { label: 'Özgül verim', value: fmt(v.specYield, 0, 'kWh/kWp') },
      { label: 'Öz tüketim', value: '%' + fmt(v.selfRatio * 100, 0), sub: 'şebekeye ' + VS.fmtEnergy(v.exported) },
      { label: 'Geri dönüş (basit)', value: v.payback ? fmt(v.payback, 1, 'yıl') : '—', sub: 'yıllık kazanç ' + fmt(v.saving, 0, 'TL') },
      { label: 'Güneş', value: night ? 'Ufkun altında' : fmt(v.sun.elevation, 1) + '° yükseklik', sub: 'azimut ' + fmt(v.sun.azimuth, 0) + '° (güneyden, batı +) · güneş saati ' + fmtHour(v.sun.solarTime) }
    ];
  }
  function charts(res, s) {
    const v = res.values;
    const day = v.today.pts.map(p => [p.t, p.Pac]);
    const peak = day.reduce((a, p) => Math.max(a, p[1]), 0);
    const mon = v.monthly.map((e, i) => [i + 1, e / 1000]);
    const sel = v.monthly.map((e, i) => [i + 1, i + 1 === s.month ? e / 1000 : 0]);
    return [{
      id: 'day', title: 'Günlük AC güç profili (seçili ayın temsilî günü)', height: 160,
      series: [{ name: 'P_AC (kW)', color: 'amber', area: true, data: day }],
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
  const MOD_W = 1.134, STEP = MOD_W + 0.02, HB = 8, PARA = 0.9, H0 = 0.35;
  function layout(s) {
    const tiltD = num(s.tilt, 15, 0, 90), t = tiltD * DEG, L = num(s.moduleLen, 2.28, 0.5, 3);
    const n = Math.round(num(s.nMod, 1, 1, 20000)), rows = Math.round(num(s.rows, 1, 1, 500));
    const perRow = Math.ceil(n / rows);
    const rowsV = Math.min(rows, 40), perRowV = Math.min(perRow, 80);
    const dproj = L * Math.cos(t), rise = L * Math.sin(t);
    const pitchV = Math.max(num(s.pitch, 0, 0, 20), dproj + 0.15);
    const rowLen = perRowV * STEP;
    const arrD = (rowsV - 1) * pitchV + dproj;
    const W = Math.max(30, rowLen + 8), D = Math.max(22, arrD + 8);
    return { n: n, rows: rows, perRow: perRow, rowsV: rowsV, perRowV: perRowV, t: t, L: L, dproj: dproj, rise: rise, pitchV: pitchV, rowLen: rowLen, arrD: arrD, W: W, D: D, capped: rowsV < rows || perRowV < perRow, nInv: nInvOf(s) };
  }
  function rebuildOn(s) { const l = layout(s); return [l.rowsV, l.perRowV, l.n, l.t.toFixed(3), l.L, l.pitchV.toFixed(2), l.nInv].join('|'); }

  // paylaşımlı dokular/geometriler (sayfa başına bir kez)
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
    // PV modül: 6 × 12 hücre, alüminyum çerçeve
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
    // trapez sac cephe (dikey nervür), şerit pencere, seksiyonel kapı, çatı membranı
    const ribs = (g, w, h) => { g.fillStyle = '#dfe3e6'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { g.fillStyle = '#aeb6be'; g.fillRect(x, 0, 4, h); g.fillStyle = '#f4f6f7'; g.fillRect(x + 4, 0, 2, h); } };
    A.wallTex = (len) => canvasTex(T, 256, 32, ribs, len / 2, 1);
    A.winTex = (len) => canvasTex(T, 256, 64, (g, w, h) => {
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
    const a = assets(k), Ly = layout(s);
    const W = Ly.W, D = Ly.D;
    const sc = { inv: [], flows: {}, sunKey: '', pathKey: '' };
    app.scene3 = sc;
    const tmp = { p: new T.Vector3(), s: new T.Vector3(), m: new T.Matrix4(), q0: new T.Quaternion() };

    // zemin: çim + fabrika sahası (asfalt)
    const grass = k.ground(900, std(k, 0x34482a, { roughness: 1 }), 0); grass.receiveShadow = true;
    const site = k.group(null, 0, 0, 0); sc.site = site;
    const yard = k.box(W + 34, 0.04, D + 26, M.asphalt, 6, 0.02, 2, site, { noShadow: true }); yard.userData.noClip = true;

    /* --- fabrika binası */
    const bld = k.group(site, 0, 0, 0);
    const wallW = std(k, 0xffffff, { map: a.wallTex(W), roughness: 0.55, metalness: 0.3 });
    const wallD = std(k, 0xffffff, { map: a.wallTex(D), roughness: 0.55, metalness: 0.3 });
    const walls = [
      k.box(W, HB, 0.25, wallW, 0, HB / 2, D / 2, bld), k.box(W, HB, 0.25, wallW, 0, HB / 2, -D / 2, bld),
      k.box(0.25, HB, D, wallD, W / 2, HB / 2, 0, bld), k.box(0.25, HB, D, wallD, -W / 2, HB / 2, 0, bld)
    ];
    walls.forEach(w => k.shell(w));
    k.shell(k.box(W + 0.08, 0.7, D + 0.08, M.concreteDark, 0, 0.35, 0, bld)); // beton subasman
    const roofMat = std(k, 0xffffff, { map: a.roofTex(W, D), roughness: 0.92 }); roofMat.envMapIntensity = 0.45;
    const roof = k.box(W, 0.3, D, roofMat, 0, HB - 0.15, 0, bld); k.shell(roof);
    // parapet + alüminyum harpuşta
    [[W, 0.25, 0, D / 2 - 0.125], [W, 0.25, 0, -D / 2 + 0.125], [0.25, D, W / 2 - 0.125, 0], [0.25, D, -W / 2 + 0.125, 0]].forEach(p => {
      k.shell(k.box(p[0], PARA, p[1], wallD, p[2], HB + PARA / 2, p[3], bld));
      k.box(p[0] + 0.08, 0.06, p[1] + 0.08, M.alu, p[2], HB + PARA + 0.03, p[3], bld);
    });
    // şerit pencere (güney ve doğu cephe), seksiyonel kapılar, personel kapısı, yağmur inişleri
    const winS = std(k, 0xffffff, { map: a.winTex(W - 6), roughness: 0.15, metalness: 0.4 });
    const winE = std(k, 0xffffff, { map: a.winTex(D - 6), roughness: 0.15, metalness: 0.4 });
    k.shell(k.box(W - 6, 1.3, 0.06, winS, 0, 5.7, D / 2 + 0.13, bld));
    k.shell(k.box(0.06, 1.3, D - 6, winE, W / 2 + 0.13, 5.7, 0, bld));
    const doorMat = std(k, 0xffffff, { map: a.doorTex, roughness: 0.5, metalness: 0.4 });
    [-W * 0.3, -W * 0.3 + 6].forEach(x => { k.box(4.4, 4.6, 0.08, doorMat, x, 2.3, D / 2 + 0.15, bld); k.box(4.7, 0.18, 0.2, M.darkSteel, x, 4.65, D / 2 + 0.2, bld); });
    k.box(1.0, 2.2, 0.06, M.panelDark, W * 0.05, 1.1, D / 2 + 0.14, bld);
    k.box(1.8, 0.1, 1.1, M.galv, W * 0.05, 2.6, D / 2 + 0.6, bld);
    [[-W / 2 + 0.3, D / 2 + 0.3], [W / 2 - 0.3, D / 2 + 0.3], [-W / 2 + 0.3, -D / 2 - 0.3], [W / 2 + 0.3, -D / 2 + 0.3]].forEach(p => {
      const m = new T.Mesh(a.cylS, M.alu); m.scale.set(0.07, HB + PARA, 0.07); m.position.set(p[0], (HB + PARA) / 2, p[1]); m.castShadow = true; bld.add(m);
    });
    // iç yapı (şeffaf kapak / kesit ile görünür): portal çerçeveler, makine hattı, fabrika ana panosu
    for (let x = -W / 2 + 1; x <= W / 2 - 1 + 1e-6; x += (W - 2) / Math.max(1, Math.round((W - 2) / 7.5))) {
      k.box(0.35, HB - 0.3, 0.35, M.panelDark, x, (HB - 0.3) / 2, D / 2 - 0.6, bld); k.box(0.35, HB - 0.3, 0.35, M.panelDark, x, (HB - 0.3) / 2, -D / 2 + 0.6, bld);
      k.box(0.25, 0.7, D - 1.2, M.panelDark, x, HB - 0.65, 0, bld);
    }
    const mach = std(k, 0x2f6f8f, { roughness: 0.45, metalness: 0.3 });
    for (let i = 0; i < 4; i++) { k.box(5, 1.7, 2.2, mach, -W * 0.28 + i * 6.2, 0.85, -D * 0.12, bld); k.box(1.2, 0.6, 1.2, M.panelRAL7035, -W * 0.28 + i * 6.2 + 1.6, 2.0, -D * 0.12, bld); }
    k.box(W * 0.6, 0.9, 0.9, M.darkSteel, 0, 0.45, D * 0.18, bld); // konveyör
    const mainP = k.box(2.4, 2.1, 0.6, M.panelRAL7035, W / 2 - 1.8, 1.05, -D * 0.3, bld);
    k.pickable(mainP, 'Fabrika ana dağıtım panosu (ADP)', () => { const r = app.validResult && app.validResult.values; return r ? ['Yıllık tüketim: ' + VS.fmtEnergy(s.consumption) + ' · profil: ' + G.PROFILES[s.profile].name, 'GES üretiminin %' + fmt(r.selfRatio * 100, 0) + ' kadarı burada tüketilir (öz tüketim, saatlik eşleşme).', 'Pano iç yapısını 3D Pano simülasyonunda inceleyebilirsiniz.'] : []; });
    k.pickable(roof, 'Fabrika çatısı', () => { const r = app.validResult && app.validResult.values; return ['Kullanılabilir alan girdisi: ' + fmt(s.roofArea, 0, 'm²'), 'Düz çatı · balastlı eğik sıra montaj (temsilî).', r ? 'Çatı statik yük kontrolü (panel + konstrüksiyon + balast, rüzgâr/kar) ayrıca yapılmalıdır.' : ''].filter(Boolean); });

    /* --- PV dizisi: modüller (InstancedMesh), konstrüksiyon, balast, string kabloları */
    const arr = k.group(site, 0, HB, 0); sc.arr = arr;
    const modGrp = k.group(arr, 0, 0, 0);
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Ly.t);
    const yc = H0 + Ly.rise / 2;
    const rowZ = i => -Ly.arrD / 2 + Ly.dproj / 2 + i * Ly.pitchV;
    const rowCount = i => Ly.capped ? Ly.perRowV : clamp(Ly.n - i * Ly.perRow, 0, Ly.perRowV);
    let nTot = 0; for (let i = 0; i < Ly.rowsV; i++) nTot += rowCount(i);
    const modGeo = new T.BoxGeometry(MOD_W, 0.04, Ly.L); trash.push(modGeo);
    const mods = new T.InstancedMesh(modGeo, a.modMat, Math.max(1, nTot));
    mods.castShadow = true; mods.receiveShadow = true; mods.frustumCulled = false; modGrp.add(mods);
    // konstrüksiyon: ray + ayak (galvaniz), balast kızağı (beton)
    const pt = (u, zc) => { const c = Math.cos(Ly.t), sn = Math.sin(Ly.t); return { y: yc - 0.06 * c - u * sn, z: zc - 0.06 * sn + u * c }; };
    const legStep = Ly.rowLen / Math.max(1, Math.ceil(Ly.rowLen / 2.4));
    const legsPerRow = Math.round(Ly.rowLen / legStep) + 1;
    const str = new T.InstancedMesh(a.unit, M.galv, Ly.rowsV * (2 + legsPerRow * 2) + 4);
    const bal = new T.InstancedMesh(a.unit, M.concrete, Ly.rowsV * legsPerRow + 4);
    [str, bal].forEach(im => { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; arr.add(im); });
    let mi = 0, si = 0, bi = 0;
    for (let i = 0; i < Ly.rowsV; i++) {
      const zc = rowZ(i), cnt = rowCount(i); if (!cnt) continue;
      const len = cnt * STEP, x0 = -Ly.rowLen / 2;
      for (let j = 0; j < cnt; j++) inst(mods, mi++, x0 + STEP * (j + 0.5), yc, zc, q, 1, 1, 1, tmp);
      const uF = Ly.L * 0.3, uR = -Ly.L * 0.3, f = pt(uF, zc), r = pt(uR, zc);
      inst(str, si++, x0 + len / 2, f.y - 0.03, f.z, q, len, 0.05, 0.05, tmp);
      inst(str, si++, x0 + len / 2, r.y - 0.03, r.z, q, len, 0.05, 0.05, tmp);
      for (let x = x0 + 0.15; x <= x0 + len - 0.1; x += legStep) {
        inst(str, si++, x, (f.y + 0.12) / 2, f.z, null, 0.045, Math.max(0.02, f.y - 0.12), 0.045, tmp);
        inst(str, si++, x, (r.y + 0.12) / 2, r.z, null, 0.045, Math.max(0.02, r.y - 0.12), 0.045, tmp);
        inst(bal, bi++, x, 0.06, (f.z + r.z) / 2, null, 0.3, 0.12, Math.abs(f.z - r.z) + 0.45, tmp);
      }
      // string kablosu (arka ray altında) ve çatı kanalına bağlantı
      k.box(len, 0.03, 0.03, M.cableBlack, x0 + len / 2, r.y - 0.1, r.z, arr);
      const xt = W / 2 - 1.2, stub = xt - (x0 + len);
      if (stub > 0.05) k.box(stub, 0.03, 0.03, M.cableBlack, x0 + len + stub / 2, 0.12, r.z, arr);
    }
    mods.count = mi; str.count = si; bal.count = bi;
    [mods, str, bal].forEach(im => { im.instanceMatrix.needsUpdate = true; });
    k.explodable(modGrp, [0, 1.8, 0]);
    k.pickable(mods, 'PV modüller', () => {
      const r = app.validResult && app.validResult.values; if (!r) return [];
      return [Ly.n + ' × ' + s.Pmod + ' Wp = ' + fmt(r.kWp, 1, 'kWp') + ' · ' + Ly.rows + ' sıra, eğim ' + s.tilt + '°, azimut ' + s.azimuth + '°',
        'Düzlem ışınımı ' + fmt(r.now.G, 0, 'W/m²') + ' · hücre ' + fmt(r.now.Tc, 1, '°C') + ' · P_DC ' + VS.fmtPower(r.now.Pdc),
        'Sıra arası gölge (arka sıra) %' + fmt(r.rowShade * 100, 0) + ' · dizi geneli %' + fmt(r.shade * 100, 0) + (Ly.capped ? ' · sahne temsilîdir' : ''),
        'Gölge geometriktir; bypass diyot ve uyumsuzluk etkisi dahil değildir.'];
    });
    k.pickable(str, 'Montaj konstrüksiyonu ve balast', () => ['Sıra aralığı (pitch) ' + fmt(s.pitch, 1, 'm') + ' · modül boyu ' + fmt(Ly.L, 2, 'm') + ' (dikey yerleşim)', 'Galvaniz ray ve ayaklar, beton balast kızakları (temsilî).', 'Balast ve bağlantı, rüzgâr yükü hesabına (TS EN 1991-1-4) ve çatı taşıma kapasitesine göre belirlenir.']);

    /* --- DC kablo kanalı ve inverterler (doğu cephe) */
    const nInv = Ly.nInv, zInv0 = D / 2 - 1.5, zInvC = zInv0 - (nInv - 1) * 0.95 / 2;
    const xt = W / 2 - 1.2, xw = W / 2 + 0.125;
    const z1 = rowZ(0) - Ly.dproj / 2 - 0.4;
    k.box(0.3, 0.08, zInvC - z1, M.galv, xt, HB + 0.05, (z1 + zInvC) / 2, site);
    k.box(0.06, HB + PARA - 2.4, 0.3, M.galv, xw + 0.05, (HB + PARA + 2.4) / 2, zInvC, site);
    k.box(0.08, 0.06, nInv * 0.95, M.galv, xw + 0.08, 2.45, zInvC, site);
    const dc = k.tube([[xt, HB + 0.15, z1], [xt, HB + 0.15, zInvC - 0.6], [xt + 0.6, HB + 0.2, zInvC], [W / 2 - 0.3, HB + 0.25, zInvC], [W / 2 - 0.1, HB + PARA + 0.2, zInvC], [xw + 0.12, HB + PARA, zInvC], [xw + 0.12, HB - 0.6, zInvC], [xw + 0.12, 2.6, zInvC]], 0.06, M.cableBlack, site, 120);
    trash.push(dc.geometry);
    sc.flows.dc = k.flow(dc.userData.curve, 40, 0xfcd34d, 0.06, site);
    const invGrp = k.group(site, xw, 0, 0);
    for (let i = 0; i < nInv; i++) {
      const g = k.group(invGrp, 0, 1.6, zInv0 - i * 0.95); g.rotation.y = Math.PI / 2;
      k.rbox(0.64, 0.8, 0.24, 0.03, M.plasticWhite, 0, 0, 0.16, g);
      for (let f = 0; f < 7; f++) k.box(0.012, 0.66, 0.05, M.alu, -0.27 + f * 0.09, 0, 0.03, g); // arka soğutucu
      k.box(0.6, 0.06, 0.2, M.plasticDark, 0, -0.43, 0.16, g);
      const led = k.sphere(0.012, M.ledOff, 0.2, 0.25, 0.285, g);
      const dcs = new T.Mesh(a.cylS, M.plasticYellow); dcs.scale.set(0.045, 0.02, 0.045); dcs.rotation.x = Math.PI / 2; dcs.position.set(0.2, -0.22, 0.285); g.add(dcs);
      const knob = k.box(0.06, 0.015, 0.03, M.plasticRed, 0.2, -0.22, 0.3, g); void knob;
      for (let c = 0; c < 6; c++) { const gl = new T.Mesh(a.cylS, M.plasticDark); gl.scale.set(0.015, 0.05, 0.015); gl.position.set(-0.22 + c * 0.06, -0.48, 0.16); g.add(gl); }
      const scr = k.screen(0.16, 0.08, 160, (gx, w, h) => drawInv(gx, w, h, app, i), g, { emissive: 0.85 });
      scr.position.set(-0.08, 0.2, 0.285);
      k.box(0.03, 0.45, 0.03, M.cableBlack, 0, 0.62, 0.1, g);
      sc.inv.push({ led: led, scr: scr });
    }
    k.pickable(invGrp, 'String inverterler', () => {
      const r = app.validResult && app.validResult.values; if (!r) return [];
      return ['Toplam ' + fmt(s.Pac, 0, 'kW') + ' AC (sahnede ' + nInv + ' adet olarak temsil edilir) · η %' + fmt(s.invEff, 1),
        'DC/AC ' + fmt(r.dcac, 2) + ' · anlık P_AC ' + VS.fmtPower(r.now.Pac) + (r.now.clipped > 1 ? ' · kırpma ' + VS.fmtPower(r.now.clipped) : ''),
        'MPPT ' + s.mpptMin + '–' + s.mpptMax + ' V · maks. DC ' + s.vdcMax + ' V · string Voc(Tmin) ' + fmt(r.string.vocCold, 0, 'V'),
        'MPPT başına ' + s.stringsPerMppt + ' string · tasarım Isc ' + fmt(r.string.iscDesign, 1, 'A') + ' / ' + s.iscMppt + ' A',
        'String inverterlerde DC ayırıcı entegredir; ayrı DC birleştirme kutusu gerekmez (merkezi inverterde gerekir).'];
    });
    // GES AC toplama panosu + saçak
    const zPan = zInv0 - (nInv - 1) * 0.95 - 1.5;
    const pan = k.group(site, xw, 0, zPan); pan.rotation.y = Math.PI / 2;
    k.box(1.0, 0.1, 0.45, M.plasticDark, 0, 0.05, 0.25, pan);
    const cab = k.box(1.0, 1.9, 0.45, M.panelRAL7035, 0, 1.05, 0.25, pan);
    k.box(0.02, 0.18, 0.04, M.plasticDark, 0.42, 1.1, 0.49, pan);
    const pscr = k.screen(0.16, 0.11, 160, (gx, w, h) => drawMeter(gx, w, h, app), pan, { emissive: 0.85 }); pscr.position.set(-0.2, 1.45, 0.476);
    const plate = k.screen(0.36, 0.07, 256, (gx, w, h) => { gx.fillStyle = '#f4f4f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 22px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText('GES AC PANO', w / 2, h / 2); }, pan); plate.position.set(0, 1.85, 0.476);
    sc.panScreen = pscr;
    k.pickable(cab, 'GES AC toplama panosu', () => {
      const r = app.validResult && app.validResult.values; if (!r) return [];
      return ['İnverter AC çıkışları burada toplanır; çift yönlü sayaç ve şebeke bağlantı koruması (temsilî).', 'Anlık AC akım ≈ ' + fmt(E.threePhaseCurrent(r.now.Pac, 400, 1), 0, 'A') + ' (400 V, cosφ = 1)', 'İnverter anma akımı ≈ ' + fmt(E.threePhaseCurrent(s.Pac * 1000, 400, 1), 0, 'A')];
    });
    const span = Math.abs(zInv0 - zPan) + 1.4;
    k.box(1.0, 0.06, span, M.galv, xw + 0.5, 3.0, (zInv0 + zPan) / 2 + 0.2, site);

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
    const pole = k.cyl(0.12, 0.22, 11, M.concrete, px, 5.5, pz, site, 14); void pole;
    k.box(2.4, 0.12, 0.12, M.galv, px, 10.5, pz, site);
    [-1, 0, 1].forEach(j => {
      for (let d = 0; d < 3; d++) { const ins = new T.Mesh(a.cylS, M.porcelainGrey); ins.scale.set(0.07 - d * 0.005, 0.05, 0.07 - d * 0.005); ins.position.set(px + j * 1.0, 10.62 + d * 0.07, pz); site.add(ins); }
      const w = k.tube([[px + j * 1.0, 10.8, pz], [px + j * 1.0 + 0.3, 10.1, pz - 18], [px + j * 1.0 + 0.6, 10.8, pz - 36]], 0.012, M.alu, site, 24); trash.push(w.geometry);
    });
    const dn = k.tube([[px, 10.4, pz + 0.2], [px, 6, pz + 0.22], [px, 0.4, pz + 0.22], [px - 1, 0.05, pz + 2], [kx + 2.2, 0.05, kz - 0.5], [kx + 2.2, 0.5, kz]], 0.04, M.cableBlack, site, 60);
    trash.push(dn.geometry);

    /* --- etiketler */
    sc.lArr = k.label('PV', modGrp, [0, Ly.rise + 2.4, rowZ(Ly.rowsV - 1)]);
    sc.lInv = k.label('İnverter', invGrp, [0.4, 3.4, zInvC], 'vs-label--sm');
    sc.lKio = k.label('Trafo merkezi · şebeke', kio, [0, 3.6, 0], 'vs-label--sm');
    k.label('K ▲ Kuzey', null, [0, 0.3, -(D / 2 + 16)], 'vs-label--sm');

    /* --- güneş (dünya koordinatı; bina azimutla döner, güneş dönmez) */
    const sunMat = new T.MeshBasicMaterial({ color: 0xffe2a0, fog: false });
    const sun = new T.Mesh(a.sphere, sunMat); sun.scale.setScalar(4.5); sun.userData.noClip = true; v.root.add(sun);
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

    // kesit sınırları, kamera, gölge kutusu
    app.def.scene.bounds = [-W / 2 - 1, kx + 4];
    const half = Math.hypot(W + 34, D + 26) * 0.5 + 2;
    sc.shadowHalf = half;
    v.setShadowBox(half, half * 6);
    const vkey = Math.round(Math.max(W, D) / 8);
    if (v.__gesViewKey !== vkey) {
      v.__gesViewKey = vkey;
      v.setView({ target: [3, HB * 0.55, 0], r: Math.max(W, D) * 1.0 + 30, theta: 0.62, phi: 1.17, limits: { rMin: 6, rMax: 320, phiMax: 1.48 } });
    }
    v.sun.target.position.set(0, HB * 0.5, 0); v.sun.target.updateMatrixWorld();
  }

  function drawWarn(g, w, h) {
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c200'; g.strokeStyle = '#111'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w - 14, h * 0.7); g.lineTo(14, h * 0.7); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(w / 2 + 6, 30); g.lineTo(w / 2 - 8, 58); g.lineTo(w / 2 + 2, 58); g.lineTo(w / 2 - 6, 76); g.lineTo(w / 2 + 10, 50); g.lineTo(w / 2, 50); g.closePath(); g.fill();
    g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.fillText('YÜKSEK GERİLİM', w / 2, h * 0.86);
  }
  function drawInv(g, w, h, app, i) {
    const r = app.validResult && app.validResult.values, n = nInvOf(app.state);
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 14px monospace'; g.fillText('INV-' + (i + 1), 8, 18);
    if (!r) return;
    g.fillStyle = r.now.Pac > 0 ? '#fcd34d' : '#64748b'; g.font = 'bold 26px monospace';
    g.fillText(fmt(r.now.Pac / 1000 / n, 1) + ' kW', 8, 54);
    g.fillStyle = '#94a3b8'; g.font = '12px monospace'; g.fillText(r.now.clipped > 1 ? 'KIRPMA' : r.now.Pac > 0 ? 'MPPT' : 'BEKLEME', 8, 74);
  }
  function drawMeter(g, w, h, app) {
    const r = app.validResult && app.validResult.values;
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 13px monospace'; g.fillText('SAYAÇ · ÜRETİM', 8, 18);
    if (!r) return;
    g.fillStyle = '#fcd34d'; g.font = 'bold 24px monospace'; g.fillText(fmt(r.now.Pac / 1000, 1) + ' kW', 8, 52);
    g.fillStyle = '#94a3b8'; g.font = '12px monospace'; g.fillText('Gün ' + fmt(r.today.Eac, 0) + ' kWh', 8, 80);
  }

  /** Güneş yolu (seçili ayın temsilî günü) — motorun sunPosition fonksiyonuyla. */
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
    const line = new T.Line(geo, new T.LineDashedMaterial({ color: 0xfcd34d, transparent: true, opacity: 0.45, dashSize: 4, gapSize: 3, fog: false }));
    line.computeLineDistances(); line.userData.noClip = true;
    k.viewer.root.add(line); sc.path = line;
  }

  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, M = k.mats;
    sc.site.rotation.y = -num(s.azimuth, 0, -180, 180) * DEG;
    const prod = v.now.Pac > 0, clip = v.now.clipped > 1;
    sc.lArr.set('PV ' + fmt(v.kWp, 1) + ' kWp · ' + VS.fmtPower(v.now.Pdc) + ' DC · G ' + fmt(v.now.G, 0) + ' W/m²');
    sc.lArr.level(prod ? (v.shade > 0.05 ? 'warn' : 'ok') : '');
    const vocFail = v.string.vocCold > s.vdcMax;
    sc.lInv.set('İnverter ' + fmt(v.Pac, 0) + ' kW · ' + VS.fmtPower(v.now.Pac) + (clip ? ' · kırpma' : '') + (vocFail ? ' · Voc aşımı!' : ''));
    sc.lInv.level(vocFail ? 'bad' : clip ? 'warn' : prod ? 'ok' : '');
    sc.lKio.set('Bağlantı noktası · ' + (prod ? VS.fmtPower(v.now.Pac) + ' üretim' : 'üretim yok'));
    const sp = k.reducedMotion ? 0 : 1;
    sc.flows.dc.speed = sp * clamp(v.now.Pdc / Math.max(v.kWp * 1000, 1), 0, 1.2) * 0.35;
    sc.flows.ac.speed = sp * clamp(v.now.Pac / Math.max(v.Pac * 1000, 1), 0, 1.2) * 0.5;
    sc.inv.forEach(x => { x.led.material = vocFail ? M.ledRed : clip ? M.ledAmber : prod ? M.ledGreen : M.ledOff; x.scr.redraw(); });
    sc.panScreen.redraw();
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
    // ışık: gölge için en az 3° yükseklikte tutulur, yoğunluk güneş yüksekliği ve bulutla azalır
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

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  function view2d(g, W, H, res, s) {
    const v = res.values, st = id => (res.checks.find(c => c.id === id) || {}).status;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a', amb: '#fcd34d' };
    const sm = W < 560, f = sm ? 10 : 12;
    const C = x => ({ ok: col.ok, warn: col.warn, fail: col.bad }[x] || col.dim);
    g.lineCap = 'round'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = col.text; g.font = 'bold ' + (f + 1) + 'px Inter, sans-serif'; g.fillText('GES tek hat şeması', 16, 62);
    g.fillStyle = col.dim; g.font = f + 'px Inter, sans-serif'; g.fillText(MONTHS[s.month - 1] + ' · ' + fmtHour(s.hour) + ' · ' + (G.CITIES[s.city] ? s.city : 'özel koordinat'), 16, 78);
    // güneş yayı
    const sx = W - (sm ? 110 : 140), sy = sm ? 120 : 60, sr = sm ? 44 : 60;
    g.strokeStyle = '#2c4466'; g.lineWidth = 1.5; g.beginPath(); g.arc(sx, sy + 10, sr, Math.PI, 0); g.stroke();
    g.beginPath(); g.moveTo(sx - sr - 8, sy + 10); g.lineTo(sx + sr + 8, sy + 10); g.stroke();
    const ang = Math.PI - clamp((s.hour - 5) / 15, 0, 1) * Math.PI, hgt = Math.max(-0.1, Math.sin(v.sun.elevation * DEG));
    g.fillStyle = v.sun.elevation > 0 ? col.amb : '#475569'; g.beginPath(); g.arc(sx + Math.cos(ang) * sr, sy + 10 - hgt * sr, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = col.dim; g.textAlign = 'center'; g.fillText(v.sun.elevation > 0 ? 'Güneş ' + fmt(v.sun.elevation, 0) + '°' : 'Gece', sx, sy + 26); g.textAlign = 'left';

    const y = Math.round(H * (sm ? 0.34 : 0.36));
    const X = { pv: W * 0.09, inv: W * 0.36, bus: W * 0.52, met: W * 0.69, tr: W * 0.84 };
    const prod = v.now.Pac > 0;
    g.lineWidth = 2;
    // PV dizisi
    g.strokeStyle = col.line; g.strokeRect(X.pv - 24, y - 30, 48, 60);
    g.beginPath(); g.moveTo(X.pv - 24, y + 30); g.lineTo(X.pv + 24, y - 30); g.stroke();
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(X.pv - 16 + i * 10, y - 46); g.lineTo(X.pv - 10 + i * 10, y - 34); g.stroke(); }
    g.fillStyle = col.text; g.textAlign = 'center'; g.font = 'bold ' + f + 'px Inter, sans-serif'; g.fillText(fmt(v.kWp, 1) + ' kWp', X.pv, y + 48);
    g.font = f + 'px Inter, sans-serif'; g.fillStyle = col.dim; g.fillText(v.nStrings + ' × ' + s.perString + ' modül', X.pv, y + 63);
    g.fillText('G ' + fmt(v.now.G, 0) + ' W/m²', X.pv, y + 78);
    // DC hat
    g.strokeStyle = prod ? col.amb : col.line; g.beginPath(); g.moveTo(X.pv + 24, y); g.lineTo(X.inv - 26, y); g.stroke();
    g.font = (f - 1) + 'px Inter, sans-serif'; g.fillStyle = C(st('voc')); g.fillText('Voc(Tmin) ' + fmt(v.string.vocCold, 0) + ' V', (X.pv + X.inv) / 2, y - 24);
    g.fillStyle = C(st('mpptLo') === 'ok' && st('mpptHi') === 'ok' ? 'ok' : 'warn'); g.fillText('Vmp ' + fmt(v.string.vmpHot, 0) + '–' + fmt(v.string.vmpCold, 0) + ' V', (X.pv + X.inv) / 2, y - 10); g.font = f + 'px Inter, sans-serif';
    // inverter
    g.strokeStyle = col.line; g.strokeRect(X.inv - 26, y - 26, 52, 52); g.beginPath(); g.moveTo(X.inv - 26, y + 26); g.lineTo(X.inv + 26, y - 26); g.stroke();
    g.fillStyle = col.text; g.font = 'bold ' + (f + 2) + 'px Inter, sans-serif'; g.fillText('=', X.inv - 12, y - 6); g.fillText('~', X.inv + 12, y + 18);
    g.font = 'bold ' + f + 'px Inter, sans-serif'; g.fillText('İnverter ' + fmt(v.Pac, 0) + ' kW', X.inv, y + 46);
    g.font = f + 'px Inter, sans-serif'; g.fillStyle = C(st('dcac')); g.fillText('DC/AC ' + fmt(v.dcac, 2), X.inv, y + 61);
    g.fillStyle = v.now.clipped > 1 ? col.warn : col.dim; g.fillText(v.now.clipped > 1 ? 'kırpma ' + VS.fmtPower(v.now.clipped) : 'η %' + fmt(s.invEff, 1), X.inv, y + 76);
    // AC bara ve yük kolu
    g.strokeStyle = prod ? col.amb : col.line; g.beginPath(); g.moveTo(X.inv + 26, y); g.lineTo(X.bus, y); g.stroke();
    g.fillStyle = prod ? col.amb : col.dim; g.fillText(VS.fmtPower(v.now.Pac), (X.inv + X.bus) / 2 + 4, y - 10);
    g.strokeStyle = col.cu; g.lineWidth = 6; g.beginPath(); g.moveTo(X.bus, y - 44); g.lineTo(X.bus, y + 44); g.stroke(); g.lineWidth = 2;
    g.fillStyle = col.dim; g.fillText('AC pano 400 V', X.bus, y - 52);
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(X.bus, y + 44); g.lineTo(X.bus, y + 100); g.stroke();
    g.beginPath(); g.moveTo(X.bus - 7, y + 92); g.lineTo(X.bus, y + 104); g.lineTo(X.bus + 7, y + 92); g.stroke();
    g.fillStyle = col.text; g.fillText('Fabrika yükü', X.bus, y + 122);
    g.fillStyle = col.dim; g.fillText(VS.fmtEnergy(s.consumption) + '/yıl', X.bus, y + 137);
    g.fillText('öz tüketim %' + fmt(v.selfRatio * 100, 0), X.bus, y + 152);
    // sayaç
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(X.bus, y); g.lineTo(X.met - 16, y); g.stroke();
    g.beginPath(); g.arc(X.met, y, 16, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.text; g.font = (f - 1) + 'px Inter, sans-serif'; g.fillText('kWh', X.met, y + 4);
    g.font = f + 'px Inter, sans-serif'; g.fillStyle = col.dim; g.fillText('Çift yönlü', X.met, y + 34); g.fillText('sayaç', X.met, y + 48);
    // trafo ve şebeke
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(X.met + 16, y); g.lineTo(X.tr - 22, y); g.stroke();
    g.beginPath(); g.arc(X.tr - 8, y, 14, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(X.tr + 8, y, 14, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(X.tr + 22, y); g.lineTo(W - 10, y); g.stroke();
    g.fillStyle = col.dim; g.fillText('Trafo', X.tr, y + 34); g.fillText('OG şebeke →', Math.min(W - 40, X.tr + 10), y - 22);
    // değer tablosu
    const rows = [
      ['Anlık AC', VS.fmtPower(v.now.Pac), prod ? col.ok : col.dim], ['Hücre sıcaklığı', fmt(v.now.Tc, 1, '°C'), col.text],
      ['Günlük enerji', VS.fmtEnergy(v.today.Eac), col.text], ['Yıllık enerji', VS.fmtEnergy(v.annual), col.text],
      ['Özgül verim', fmt(v.specYield, 0, 'kWh/kWp'), col.text], ['Geri dönüş', v.payback ? fmt(v.payback, 1, 'yıl') : '—', col.text],
      ['Voc (Tmin) / sınır', fmt(v.string.vocCold, 0) + ' / ' + s.vdcMax + ' V', C(st('voc'))], ['MPPT Isc', fmt(v.string.iscDesign, 1) + ' / ' + s.iscMppt + ' A', C(st('isc'))]
    ];
    const ty = Math.min(H - 20 - Math.ceil(rows.length / (sm ? 1 : 2)) * 18, y + 180), cw = sm ? W - 32 : (W - 48) / 2;
    g.textAlign = 'left';
    rows.forEach((r, i) => {
      const cx = 16 + (sm ? 0 : (i % 2) * (cw + 16)), cy = ty + (sm ? i : Math.floor(i / 2)) * 18;
      g.fillStyle = col.dim; g.fillText(r[0], cx, cy); g.fillStyle = r[2]; g.textAlign = 'right'; g.fillText(r[1], cx + cw, cy); g.textAlign = 'left';
    });
    g.fillStyle = col.dim; g.font = (f - 1) + 'px Inter, sans-serif';
    g.fillText(s.pvgisMonthly ? 'Yıllık değerler: kullanıcının girdiği PVGIS verisi' + (s.pvgisSource ? ' (' + s.pvgisSource + ')' : '') : 'Yıllık değerler: açık gök × bulutluluk senaryosu (sahaya özgü değil)', 16, H - 10);
  }

  /* ---------------------------------------------------------------- senaryolar */
  const scen = (o) => Object.assign(defaults(), o);

  VS.register({
    id: 'ges', title: '3D GES Simülasyonu',
    defaults: defaults,
    initLive: () => ({ acc: 0 }),
    autoRun: false,
    startText: 'Gün oynatılıyor: güneş doğudan batıya ilerliyor, üretim saat saat hesaplanıyor (1 saat ≈ 2 s).',
    start: app => { const h = Number(app.state.hour); if (!(h >= 5 && h < 20)) app.state.hour = 5; app.live.acc = 0; app._startedOnce = true; app.invalidate(); },
    scenarios: [
      { id: 'izmir', name: 'İzmir fabrika çatısı · haziran günü', desc: '194 kWp, 160 kW inverter, 15° eğik sıralar. Simülasyonu başlatıp günü oynatın.', state: scen({}), start: true },
      { id: 'voc', name: 'Kış sabahı · string Voc sınırı aşılıyor', desc: 'Erzurum, Tmin −30 °C, 22 modüllü stringler: soğukta açık devre gerilimi inverter sınırını aşar.', state: scen({ city: 'Erzurum', lat: 39.9, lon: 41.27, month: 1, hour: 9, Ta: -12, Tmin: -30, Tmax: 32, perString: 22, nMod: 352, rows: 11, cloud: 0, albedo: 0.6, consumption: 380000 }) },
      { id: 'clip', name: 'Aşırı DC/AC · öğlen kırpması', desc: 'Antalya, 194 kWp DC’ye yalnız 110 kW inverter (DC/AC ≈ 1,77): öğlen saatlerinde inverter sınırında kırpma.', state: scen({ city: 'Antalya', lat: 36.9, lon: 30.7, Pac: 110, month: 6, hour: 12.5, cloud: 0, Ta: 33, tilt: 20 }) },
      { id: 'shade', name: 'Sıra arası gölge · aralık sabahı', desc: 'Ankara, 30° eğim ve 2,8 m sıra aralığı: kışın düşük güneşte ön sıra arkadakini gölgeler.', state: scen({ city: 'Ankara', lat: 39.93, lon: 32.86, tilt: 30, pitch: 2.8, month: 12, hour: 10, Ta: 2, cloud: 0.05, Tmin: -15 }) },
      { id: 'west', name: 'Batıya yönelik çatı · akşam tüketimi', desc: 'Azimut +60° (güneybatı-batı), ofis profili: üretim öğleden sonraya kayar.', state: scen({ azimuth: 60, tilt: 10, profile: 'ofis', month: 7, hour: 17 }) }
    ],
    controls: controls,
    compute: s => G.compute(engineInput(s)),
    readouts: readouts,
    charts: charts,
    tick: tick,
    reportInputs: s => {
      const ll = latLon(s);
      return [{ group: 'Konum', label: 'Koordinat', value: fmt(ll.lat, 2) + '° K, ' + fmt(ll.lon, 2) + '° D' }];
    },
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-20, 30] },
    view2d: view2d
  });
})();
