/* VoltSim · 3D Batarya Enerji Depolama ve Hibrit Santral Simülasyonu
 * Hesap: VoltSimEngine.ext.depolama (js/voltsim/calc/depolama.js): yük profilleri, saatlik GES üretimi (engine.ges.compute
 * temsilî gün eğrisinden, GES modeli yeniden yazılmadan), RES (engine.res.power), dizel yakıt eğrisi, LiFePO4 batarya
 * (kapasite, güç, DoD, çevrim verimi, C-oranı) ve saatlik dağıtım stratejileri; günlük göstergeler ve karşılaştırmalar.
 * Sahne: seçili saatteki güç akışlarını gösterir (akış yönü ve hızı hesap sonucundan); hiçbir değer animasyondan türetilmez. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const X = E.ext.depolama, G = E.ges;
  const clamp = E.clamp;
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const CITY_LIST = Object.keys(G.CITIES);
  const STRAT = { self: 'Öz tüketim', peak: 'Tepe tıraşlama', backup: 'Yedek rezerv', tou: 'Zaman tarifesi (arbitraj)' };
  const SKY = { night: 0x0b1a30, dusk: 0xb87452, day: 0x6f9fd2, high: 0x88b6e2 };
  const DEG = Math.PI / 180;

  function defaults() {
    return {
      city: 'Konya', month: 6, cloud: 0.15, Ta: 24,
      pvOn: true, pvKWp: 1000, pvAC: 800, tilt: 20, azimuth: 0,
      windOn: false, windKW: 150, windMean: 6,
      loadPreset: 'iki', loadPeak: 600, loadBase: 150, loadCustom: X.loadProfile('iki', 600, 150),
      batKWh: 1000, batKW: 500, dod: 90, rte: 90, crate: 0.5, socStart: 50, cyclic: true, reserve: 40, cycleLife: 6000, calLife: 15,
      strategy: 'self', demandKW: 500, gridCharge: false, gridKW: 1000, exportKW: 300,
      genOn: false, genKW: 250, genMin: 30, genPeak: false,
      outage: false, outStart: 18, outDur: 4, island: true,
      pG: 3.5, pP: 5.5, pN: 2.2, pE: 2.0, pF: 45, demandCharge: 0,
      hour: 12, speed: 2
    };
  }
  function initLive(s) { return { t: s.hour + 0.5, hourSet: s.hour }; }
  const hourOf = (L, s) => clamp(Math.floor(L && isFinite(L.t) ? L.t : s.hour), 0, 23);
  const hh = h => String(((h % 24) + 24) % 24).padStart(2, '0') + ':00';

  /* ---------------------------------------------------------------- model */
  function inputOf(s) {
    const c = G.CITIES[s.city] || G.CITIES.Konya;
    const load = X.loadProfile(s.loadPreset, s.loadPeak, s.loadBase, s.loadCustom);
    const pvH = s.pvOn ? X.pvHourly({ kWp: s.pvKWp, acKW: s.pvAC, lat: c[0], lon: c[1], month: s.month, tilt: s.tilt, azimuth: s.azimuth, cloud: s.cloud, Ta: s.Ta }) : { kWh: new Array(24).fill(0), Eac: 0, ok: true };
    const wH = s.windOn ? X.windHourly({ kW: s.windKW, vMean: s.windMean }) : { kWh: new Array(24).fill(0), v: new Array(24).fill(0) };
    return { lat: c[0], lon: c[1], load: load, pvH: pvH, wH: wH,
      o: { load: load, pv: pvH.kWh, wind: wH.kWh, bat: { cap: s.batKWh, pcs: s.batKW, dod: s.dod / 100, rte: s.rte / 100, crate: s.crate },
        soc0: s.socStart / 100, cyclic: !!s.cyclic, strategy: s.strategy, demandKW: s.demandKW, reserve: s.reserve / 100, gridCharge: !!s.gridCharge,
        gridKW: s.gridKW, exportKW: s.exportKW, gen: { on: !!s.genOn, kW: s.genKW, minPct: s.genMin / 100, peak: !!s.genPeak },
        outage: { on: !!s.outage, start: s.outStart, dur: s.outDur }, island: !!s.island,
        prices: { gunduz: s.pG, puant: s.pP, gece: s.pN, export: s.pE, fuel: s.pF, demand: s.demandCharge } } };
  }
  function compute(s0, app) {
    const v = new E.Validator(), s = Object.assign({}, s0);
    const num = (k, name, o) => { s[k] = v.num(s[k], name, o); };
    num('pvKWp', 'GES kurulu gücü', { min: 1, max: 10000, unit: 'kWp' }); num('pvAC', 'GES inverter AC gücü', { min: 1, max: 10000, unit: 'kW' });
    num('windKW', 'RES gücü', { min: 1, max: 3000, unit: 'kW' }); num('windMean', 'Ortalama rüzgâr hızı', { min: 0, max: 15, unit: 'm/s' });
    num('loadPeak', 'Tepe yük', { min: 1, max: 50000, unit: 'kW' }); num('loadBase', 'Taban yük', { min: 0, max: 50000, unit: 'kW' });
    num('batKWh', 'Batarya kapasitesi', { min: 0, max: 100000, unit: 'kWh' }); num('batKW', 'PCS gücü', { min: 0, max: 50000, unit: 'kW' });
    num('dod', 'DoD', { min: 50, max: 100, unit: '%' }); num('rte', 'Çevrim verimi', { min: 70, max: 99, unit: '%' }); num('crate', 'C-oranı', { min: 0.1, max: 4 });
    num('demandKW', 'Talep sınırı', { min: 0, max: 50000, unit: 'kW' }); num('gridKW', 'Bağlantı gücü', { min: 1, max: 100000, unit: 'kW' }); num('exportKW', 'İhracat sınırı', { min: 0, max: 100000, unit: 'kW' });
    num('genKW', 'Jeneratör gücü', { min: 10, max: 5000, unit: 'kW' });
    if (s.loadBase > s.loadPeak && s.loadPreset !== 'ozel') v.errors.push('Taban yük tepe yükten büyük olamaz.');
    if (s.loadPreset === 'ozel' && (!Array.isArray(s.loadCustom) || s.loadCustom.length !== 24)) v.errors.push('Özel profil 24 saatlik değer içermeli.');
    if (!v.errors.length && app && app.live && app.live.hourSet !== s.hour) { app.live.t = s.hour + 0.5; app.live.hourSet = s.hour; }
    if (v.errors.length) return { ok: false, errors: v.errors, checks: [], values: {} };
    const inp = inputOf(s);
    if (!inp.pvH.ok) return { ok: false, errors: (inp.pvH.errors || ['GES hesabı yapılamadı.']), checks: [], values: {} };
    const cmp = X.compare(inp.o), sys = cmp.sys;
    const life = X.lifeYears(s.cycleLife, s.calLife, sys.cycles);
    const b = sys.bat, PeA = (s.pvOn ? s.pvAC : 0) + (s.windOn ? s.windKW : 0);
    const values = { hour: s.hour, now: sys.rows[clamp(Math.floor(s.hour), 0, 23)], sys: sys, noBat: cmp.noBat, gridOnly: cmp.gridOnly, peakCut: cmp.peakCut, peakCutBat: cmp.peakCutBat, savingBat: cmp.savingBat, savingAll: cmp.savingAll,
      life: life, Pmax: b.Pmax, usable: b.cap - b.Emin, load: inp.load, pvEac: inp.pvH.Eac, wind: inp.wH, turbine: inp.wH.turbine, lat: inp.lat, lon: inp.lon, PeA: PeA };
    const checks = [];
    const ck = (id, label, status, detail, ref) => checks.push({ id: id, label: label, status: status, detail: String(detail).replace(/(\d)\.(\d)/g, '$1,$2'), ref: ref || null });
    if (s.batKWh > 0) ck('crate', 'Batarya güç sınırı (C-oranı)', s.batKW > s.crate * s.batKWh + 1e-9 ? 'warn' : 'ok', 'P_max = min(PCS ' + fmt(s.batKW, 0) + ' kW, ' + fmt(s.crate, 2) + 'C × ' + fmt(s.batKWh, 0) + ' kWh) = ' + fmt(b.Pmax, 0) + ' kW' + (s.batKW > s.crate * s.batKWh + 1e-9 ? '. PCS gücü hücre C-oranıyla sınırlanıyor; kurulu PCS’nin bir kısmı kullanılamaz.' : '.'), 'IEC 62619');
    if (sys.uns > 1e-6) ck('uns', 'Karşılanamayan yük', 'fail', fmt(sys.uns, 0) + ' kWh yük ' + sys.unservedHours + ' saatte beslenemedi (kesintide yetersiz batarya/jeneratör ya da ada çalışması kapalı).');
    else if (s.outage) ck('uns', 'Kesintide besleme', 'ok', 'Kesinti süresince tüm yük beslendi.');
    if (s.strategy === 'peak') ck('demand', 'Talep sınırı (tepe tıraşlama)', sys.overLimitHours ? 'warn' : 'ok', 'Şebekeden en yüksek çekiş ' + fmt(sys.peakImp, 0) + ' kW / sınır ' + fmt(s.demandKW, 0) + ' kW' + (sys.overLimitHours ? ' · ' + sys.overLimitHours + ' saatte aşıldı (batarya enerjisi ya da gücü yetmedi).' : '.'));
    ck('grid', 'Bağlantı gücü', sys.overGridHours ? 'fail' : 'ok', 'En yüksek çekiş ' + fmt(sys.peakImp, 0) + ' kW / bağlantı gücü ' + fmt(s.gridKW, 0) + ' kW (şebekeden şarj dahil).');
    if (sys.curt > 0.5) ck('curt', 'Kırpılan yenilenebilir enerji', 'info', fmt(sys.curt, 0) + ' kWh üretim ihracat sınırı (' + fmt(s.exportKW, 0) + ' kW) ya da kesinti nedeniyle kullanılamadı.');
    if (s.batKWh > 0) ck('lisanssiz', 'Lisanssız üretime bütünleşik depolama gücü', PeA > 0 && s.batKW > PeA + 1e-9 ? 'warn' : 'info', 'Batarya gücü ' + fmt(s.batKW, 0) + ' kW, üretim tesisinin elektriksel gücü ' + fmt(PeA, 0) + ' kW. Yönetmeliğin Ek Madde 3’üne göre bütünleşik depolama üretim tesisinin elektriksel gücüne kadar kurulabilir (kapasite sınırı 19.10.2026 değişikliğiyle kaldırıldı) ve depodan verilen ihtiyaç fazlasına ödeme yapılmaz; model bu nedenle bataryadan şebekeye enerji vermez. Güncel mevzuat doğrulaması gereklidir.', 'Lisanssız Üretim Yönetmeliği Ek Madde 3');
    if (s.batKWh > 0) ck('cycles', 'Günlük çevrim ve ömür (basitleştirilmiş)', sys.cycles > 1.5 ? 'warn' : 'ok', fmt(sys.cycles, 2) + ' eşdeğer tam çevrim/gün → ≈ ' + (isFinite(life.years) ? fmt(life.years, 1) + ' yıl' : '—') + ' (' + (life.limitedBy === 'cycle' ? 'çevrim ömrü' : 'takvim ömrü') + ' belirleyici). Kapasite kaybı, sıcaklık ve C-oranı etkisi hesaba katılmaz.');
    if (!s.cyclic && s.batKWh > 0 && sys.socEnd < sys.soc0 - 0.1) ck('soc', 'Gün sonu SOC', 'warn', 'Gün sonu SOC %' + fmt(sys.socEnd * 100, 0) + ' < başlangıç %' + fmt(sys.soc0 * 100, 0) + ': depodaki enerji azaldığı için günlük tasarruf olduğundan yüksek görünür. “Döngüsel gün” seçeneğini açın.');
    if (sys.chGrid > 0.5 && sys.peakImp > cmp.noBat.peakImp + 0.5) ck('chgrid', 'Şebekeden şarj ve tepe çekiş', 'warn', 'Şebekeden şarj, şebeke tepe çekişini ' + fmt(cmp.noBat.peakImp, 0) + ' kW’tan ' + fmt(sys.peakImp, 0) + ' kW’a çıkardı; sözleşme gücü ve talep/aşım bedeli açısından değerlendirin.');
    if (s.outage && !s.island) ck('island', 'Ada çalışması', 'info', 'Ada çalışması kapalı: şebeke kesilince inverterler ada koruması nedeniyle durur, GES ve batarya tesisi besleyemez.');
    ck('bess', 'Batarya sistemi güvenliği', 'info', 'LiFePO4 konteyner: hücre/modül güvenliği IEC 62619, sistem güvenliği IEC 62933-5-2; gaz algılama, havalandırma ve yangın söndürme projede ayrıca değerlendirilir.', 'IEC 62933-5-2');
    ck('data', 'Üretim verisi', 'info', 'GES: motorun açık gök × bulutluluk temsilî günü (' + MONTHS[s.month - 1] + ', ' + s.city + '). Sahaya özgü üretim ve ölçülmüş 15 dk yük profiliyle sonuçlar değişir.');
    return { ok: true, errors: [], values: values, checks: checks,
      assumptions: [
        '1 saatlik adım: güç ve enerji saatlik ortalamadır; 15 dakikalık talep tepeleri saat içindeki dalgalanmayla daha yüksek olabilir.',
        'GES saatlik üretimi engine.ges temsilî gününden (Meinel açık gök × Kasten–Czeplak bulut, NOCT sıcaklığı, varsayılan %14 sistem kaybı — PVGIS genel varsayılanı, tesise özgü değer değildir —, inverter kırpması).',
        'RES: genel küçük türbin (Cp 0,42, nominal 11,5 m/s); saatlik hız ortalama × (1 + 0,2·cos) günlük döngüsüyle temsilîdir.',
        'Batarya: ηşarj = ηdeşarj = √(çevrim verimi); SOC penceresi 1 − DoD … %100; güç P_max = min(PCS, C·E). Hücre sıcaklığı, kendi kendine deşarj ve yardımcı tüketim (HVAC) ihmal edilmiştir.',
        'Ömür basitleştirilmiştir: min(takvim ömrü, çevrim ömrü / yıllık çevrim). Kapasite kaybı (ör. ömür sonunda %70–80) günlük hesaba katılmaz; gerçek değer üretici garanti eğrisinden alınır.',
        'Batarya yalnız tesis yüküne deşarj eder, şebekeye enerji vermez. Şebekeden şarj: zaman tarifesinde gece; yedek rezervde rezerv her saat; izin verilirse öz tüketimde gece, tepe tıraşlamada çekiş sınırın altındayken. Şarj, şebeke çekişini bağlantı gücünün (tepe tıraşlamada talep sınırının) üstüne çıkarmaz; şarjın tepe çekişi artırdığı durum ön kontrolde uyarılır.',
        'Dizel yakıt eğrisi F = 0,08145·P_nom + 0,246·P (l/h, tipik). Kesintide jeneratör önce yüklenir, batarya kalan açığı kapatır; en düşük yük oranındaki fazla enerji bataryaya, o da doluysa yük direncine (atık) gider.',
        'Tarife fiyatları kullanıcı girdisidir (örnek değerler); vergi, fon ve dağıtım bedeli ayrıştırılmamıştır. Talep bedeli girilmişse en yüksek saatlik çekiş × birim fiyatın 1/30’u günlük maliyete eklenir (genel model; Türkiye’deki sözleşme gücü/aşım bedeli uygulaması farklıdır).',
        s.cyclic ? 'Döngüsel gün: başlangıç SOC gün sonu SOC’ye eşitlenene kadar gün tekrarlandı (' + sys.iterations + ' tekrar).' : 'Başlangıç SOC girdi olarak alındı (%' + s.socStart + ').',
        'Simülasyon ön değerlendirmedir: gerçek projede ölçülmüş yük verisi, şebeke bağlantı görüşü, koruma koordinasyonu ve üretici verileriyle detaylı tasarım gerekir.'
      ],
      formulas: ['E(t+1) = E(t) + P_şarj·√η − P_deşarj/√η', 'P_max = min(P_PCS, C·E_nom)', 'Öz yeterlilik = 1 − E_şebeke / E_tüketim', 'Öz tüketim = (E_GES+RES − E_ihracat − E_kırpılan) / E_GES+RES',
        'Eşdeğer çevrim = Σ(P_deşarj/√η) / (E_nom·DoD)', 'Tepe azaltımı = (P_yük,maks − P_şebeke,maks) / P_yük,maks', 'F_yakıt = 0,08145·P_nom + 0,246·P (l/h)', 'Maliyet = Σ E_alış·fiyat(dönem) − E_veriş·fiyat_veriş + yakıt + P_tepe·talep bedeli/30']
    };
  }

  /* ---------------------------------------------------------------- kontroller */
  function setStrategy(app, st) { app.state.strategy = st; app.renderControls(true); app.invalidate(); }
  function controls(s, app) {
    const r = app.validResult && app.validResult.values;
    const pr = r ? r.sys : null;
    return [
      { title: 'Saat ve oynatma', items: [
        { type: 'range', key: 'hour', label: 'Gösterilen saat', min: 0, max: 23, step: 1, fmt: v => hh(v) + ' – ' + hh(v + 1) },
        { type: 'select', key: 'speed', label: 'Oynatma hızı', options: [[0.5, '1 saat = 2 s'], [1, '1 saat = 1 s'], [2, '1 saat = 0,5 s'], [4, '1 saat = 0,25 s']], report: false },
        { type: 'note', text: '“Simülasyonu başlat” günü 00:00’dan oynatır; akışlar her saatin hesap sonucunu gösterir.' }
      ] },
      { title: 'Depolama stratejisi', items: [
        { type: 'seg', key: 'strategy', label: 'Dağıtım stratejisi', options: [['self', 'Öz tüketim'], ['peak', 'Tepe tıraşlama'], ['backup', 'Yedek rezerv'], ['tou', 'Zaman tarifesi']] },
        s.strategy === 'peak' ? { type: 'range', key: 'demandKW', label: 'Talep sınırı (şebeke çekişi)', min: 50, max: Math.max(2000, s.loadPeak * 1.2), step: 10, unit: 'kW' } : null,
        s.strategy === 'backup' ? { type: 'range', key: 'reserve', label: 'Kesinti için ayrılan rezerv', min: 0, max: 100, step: 5, unit: '%' } : null,
        s.strategy !== 'tou' ? { type: 'toggle', key: 'gridCharge', label: s.strategy === 'peak' ? 'Şebekeden şarj (çekiş sınırın altındayken)' : 'Şebekeden şarj (gece tarifesinde tam doluma)' } : { type: 'note', text: 'Zaman tarifesi: gece (22–06) şebekeden şarj, puant (17–22) deşarj; gündüz yalnız GES fazlasıyla şarj.' },
        { type: 'note', text: { self: 'Öz tüketim: GES/RES fazlası bataryaya, açık olduğunda batarya yüke deşarj eder.', peak: 'Tepe tıraşlama: yük talep sınırını aştığında batarya farkı karşılar; şebeke çekişi sınırda tutulmaya çalışılır.', backup: 'Yedek rezerv: şebeke varken SOC rezervin altına indirilmez ve rezerv gerekirse şebekeden doldurulur; kesintide tüm kapasite kullanılır.', tou: 'Arbitraj yalnız tesis tüketimi için: bataryadan şebekeye satış yapılmaz.' }[s.strategy] }
      ] },
      { title: 'Batarya (LiFePO4)', items: [
        { type: 'range', key: 'batKWh', label: 'Kapasite', min: 0, max: Math.max(5000, s.batKWh), step: 50, unit: 'kWh' },
        { type: 'range', key: 'batKW', label: 'PCS (inverter) gücü', min: 0, max: Math.max(2500, s.batKW), step: 25, unit: 'kW' },
        { type: 'select', key: 'crate', label: 'Hücre C-oranı', options: [[0.25, '0,25C (4 saatlik)'], [0.5, '0,5C (2 saatlik)'], [1, '1C (1 saatlik)'], [2, '2C (güç tipi)']] },
        { type: 'range', key: 'dod', label: 'Kullanılabilir derinlik (DoD)', min: 50, max: 100, step: 5, unit: '%' },
        { type: 'range', key: 'rte', label: 'Çevrim verimi (AC–AC)', min: 80, max: 96, step: 1, unit: '%' },
        { type: 'toggle', key: 'cyclic', label: 'Döngüsel gün (başlangıç = gün sonu SOC)' },
        s.cyclic ? null : { type: 'range', key: 'socStart', label: 'Başlangıç SOC', min: 0, max: 100, step: 5, unit: '%' },
        { type: 'select', key: 'cycleLife', label: 'Çevrim ömrü (üretici)', options: [3000, 4000, 6000, 8000, 10000].map(x => [x, fmt(x, 0) + ' çevrim']) },
        { type: 'select', key: 'calLife', label: 'Takvim ömrü', options: [10, 12, 15, 20].map(x => [x, x + ' yıl']) },
        r ? { type: 'note', html: 'P_max <b>' + fmt(r.Pmax, 0, 'kW') + '</b> · kullanılabilir <b>' + fmt(r.usable, 0, 'kWh') + '</b> · süre ≈ ' + (r.Pmax > 0 ? fmt(r.usable / r.Pmax, 1, 'sa') : '—') + '<br>Günlük ' + fmt(pr.cycles, 2) + ' çevrim · basit ömür ≈ <b>' + (isFinite(r.life.years) ? fmt(r.life.years, 1, 'yıl') : '—') + '</b> (basitleştirilmiş)' } : null
      ] },
      { title: 'Fabrika yük profili', items: [
        { type: 'select', key: 'loadPreset', label: 'Profil', rebuild: true, options: Object.keys(X.LOAD_SHAPES).map(k => [k, X.LOAD_SHAPES[k].name]).concat([['ozel', 'Özel (24 saatlik kW)']]),
          onChange: (v, a) => { if (v === 'ozel' && a.validResult) { a.state.loadCustom = a.validResult.values.load.map(x => Math.round(x)); a.renderControls(true); a.invalidate(); } } },
        s.loadPreset !== 'ozel' ? { type: 'range', key: 'loadPeak', label: 'Tepe yük', min: 50, max: Math.max(3000, s.loadPeak), step: 10, unit: 'kW' } : null,
        s.loadPreset !== 'ozel' ? { type: 'range', key: 'loadBase', label: 'Taban yük (sürekli)', min: 0, max: Math.max(1000, s.loadBase), step: 10, unit: 'kW' } : null,
        s.loadPreset === 'ozel' ? { type: 'text', key: 'loadCustom', label: '24 saatlik yük (kW, 00:00’dan)', multiline: true, parse: X.parseProfile, format: v => (v || []).map(x => fmt(x, 0).replace(/\./g, '')).join('; '), help: 'Ölçülmüş saatlik ortalama yükü girin; ayırıcı boşluk veya noktalı virgül.' } : null
      ] },
      { title: 'GES (güneş)', items: [
        { type: 'toggle', key: 'pvOn', label: 'GES devrede', rebuild: true },
        s.pvOn ? { type: 'range', key: 'pvKWp', label: 'Kurulu güç (DC)', min: 10, max: Math.max(3000, s.pvKWp), step: 10, unit: 'kWp' } : null,
        s.pvOn ? { type: 'range', key: 'pvAC', label: 'İnverter AC gücü', min: 10, max: Math.max(2500, s.pvAC), step: 10, unit: 'kW' } : null,
        s.pvOn ? { type: 'select', key: 'city', label: 'İl', options: CITY_LIST.map(c => [c, c]) } : null,
        { type: 'select', key: 'month', label: 'Ay (temsilî gün)', options: MONTHS.map((m, i) => [i + 1, m]) },
        s.pvOn ? { type: 'range', key: 'cloud', label: 'Bulutluluk', min: 0, max: 1, step: 0.05, fmt: v => '%' + fmt(v * 100, 0) } : null,
        s.pvOn ? { type: 'range', key: 'tilt', label: 'Panel eğimi', min: 0, max: 45, step: 1, unit: '°' } : null,
        s.pvOn ? { type: 'range', key: 'Ta', label: 'Günlük ortalama sıcaklık', min: -10, max: 40, step: 1, unit: '°C' } : null,
        r && s.pvOn ? { type: 'note', html: 'Günlük üretim <b>' + fmt(r.pvEac, 0, 'kWh') + '</b> · DC/AC ' + fmt(s.pvKWp / s.pvAC, 2) + ' (engine.ges temsilî gün)' } : null
      ] },
      { title: 'RES ve jeneratör', items: [
        { type: 'toggle', key: 'windOn', label: 'Rüzgâr türbini (RES)', rebuild: true },
        s.windOn ? { type: 'range', key: 'windKW', label: 'Türbin nominal gücü', min: 10, max: Math.max(1000, s.windKW), step: 10, unit: 'kW' } : null,
        s.windOn ? { type: 'range', key: 'windMean', label: 'Göbek yüksekliğinde ortalama hız', min: 2, max: 12, step: 0.5, unit: 'm/s', digits: 1 } : null,
        r && s.windOn && r.turbine ? { type: 'note', html: 'Rotor çapı ≈ ' + fmt(r.turbine.D, 1, 'm') + ' · günlük ' + fmt(r.sys.wind, 0, 'kWh') + ' (engine.res güç eğrisi)' } : null,
        { type: 'toggle', key: 'genOn', label: 'Dizel jeneratör', rebuild: true },
        s.genOn ? { type: 'range', key: 'genKW', label: 'Jeneratör gücü (prime)', min: 20, max: Math.max(1500, s.genKW), step: 10, unit: 'kW' } : null,
        s.genOn ? { type: 'range', key: 'genMin', label: 'En düşük yük oranı', min: 0, max: 50, step: 5, unit: '%' } : null,
        s.genOn ? { type: 'toggle', key: 'genPeak', label: 'Tepe tıraşlamada da çalıştır' } : null
      ] },
      { title: 'Şebeke ve kesinti', items: [
        { type: 'range', key: 'gridKW', label: 'Bağlantı (sözleşme) gücü', min: 50, max: Math.max(5000, s.gridKW), step: 10, unit: 'kW' },
        { type: 'range', key: 'exportKW', label: 'Şebekeye verme sınırı', min: 0, max: Math.max(3000, s.exportKW), step: 10, unit: 'kW', help: '0: sıfır ihracat (fazla üretim kırpılır).' },
        { type: 'toggle', key: 'outage', label: 'Şebeke kesintisi' },
        s.outage ? { type: 'range', key: 'outStart', label: 'Kesinti başlangıcı', min: 0, max: 23, step: 1, fmt: v => hh(v) } : null,
        s.outage ? { type: 'range', key: 'outDur', label: 'Kesinti süresi', min: 1, max: 24, step: 1, unit: 'sa' } : null,
        { type: 'toggle', key: 'island', label: 'Ada çalışması (şebeke yapıcı PCS + ayırma anahtarı)' }
      ] },
      { title: 'Tarife (kullanıcı girdisi)', collapsed: true, summary: 'Birim fiyatlar', items: [
        { type: 'range', key: 'pG', label: 'Gündüz (06–17)', min: 0, max: 15, step: 0.1, unit: 'TL/kWh', digits: 2 },
        { type: 'range', key: 'pP', label: 'Puant (17–22)', min: 0, max: 15, step: 0.1, unit: 'TL/kWh', digits: 2 },
        { type: 'range', key: 'pN', label: 'Gece (22–06)', min: 0, max: 15, step: 0.1, unit: 'TL/kWh', digits: 2 },
        { type: 'range', key: 'pE', label: 'Şebekeye verilen enerji', min: 0, max: 15, step: 0.1, unit: 'TL/kWh', digits: 2 },
        { type: 'range', key: 'pF', label: 'Motorin', min: 0, max: 100, step: 1, unit: 'TL/l' },
        { type: 'range', key: 'demandCharge', label: 'Talep bedeli (ölçülen tepe)', min: 0, max: 500, step: 5, unit: 'TL/kW·ay', help: 'Genel model: ayın en yüksek çekişi × birim; günlük maliyete 1/30 payı eklenir. Türkiye’de çift terimli tarifede güç bedeli sözleşme gücü ve aşım bedeli üzerinden uygulanır; kendi tarifenize göre değerlendirin.' },
        { type: 'note', text: 'Varsayılanlar örnek değerdir; güncel EPDK tarife tablosu ve tedarik sözleşmenizdeki birim fiyatları girin.' }
      ] }
    ];
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  const kw = x => fmt(x, 0, 'kW');
  function readouts(res, s, L) {
    const v = res.values, sys = v.sys, h = hourOf(L, s), row = sys.rows[h];
    const batNow = row.dis > 0.5 ? '+' + fmt(row.dis, 0) + ' kW deşarj' : row.ch > 0.5 ? '−' + fmt(row.ch, 0) + ' kW şarj' : 'bekleme';
    const gridNow = !row.grid ? 'KESİNTİ' : row.imp > 0.5 ? '+' + fmt(row.imp, 0) + ' kW alış' : row.exp > 0.5 ? '−' + fmt(row.exp, 0) + ' kW veriş' : '0 kW';
    const demandMo = s.demandCharge > 0 ? ' · talep bedeli ≈ ' + fmt(sys.peakImp * s.demandCharge, 0) + ' TL/ay' : '';
    return [
      { label: 'Saat', value: hh(h) + ' · ' + X.PERIOD_NAME[row.period] + ' tarifesi', sub: (row.grid ? 'şebeke var' : 'şebeke kesik') + ' · strateji: ' + STRAT[s.strategy], level: row.grid ? 'info' : 'warn', wide: true },
      { label: 'Fabrika yükü', value: kw(row.load), sub: row.uns > 0.5 ? fmt(row.uns, 0) + ' kW BESLENEMİYOR' : 'günlük ' + VS.fmtEnergy(sys.load), level: row.uns > 0.5 ? 'bad' : undefined },
      s.pvOn ? { label: 'GES üretimi', value: kw(row.pv), sub: 'günlük ' + VS.fmtEnergy(sys.pv) + (row.lost > 0.5 ? ' · ada koruması: durdu' : '') } : null,
      s.windOn ? { label: 'RES üretimi', value: kw(row.wind), sub: fmt(v.wind.v[h], 1, 'm/s') + ' · günlük ' + VS.fmtEnergy(sys.wind) } : null,
      s.batKWh > 0 ? { label: 'Batarya', value: batNow, sub: 'SOC %' + fmt(row.soc * 100, 0) + ' · P_max ' + kw(v.Pmax), level: row.soc < 1 - s.dod / 100 + 0.03 ? 'warn' : 'ok' } : null,
      { label: 'Şebeke', value: gridNow, level: !row.grid ? 'warn' : row.imp > s.gridKW ? 'bad' : s.strategy === 'peak' && row.imp > s.demandKW + 0.5 ? 'warn' : 'ok', sub: row.grid ? fmt(s[{ gunduz: 'pG', puant: 'pP', gece: 'pN' }[row.period]], 2) + ' TL/kWh' : 'ada çalışması ' + (s.island ? 'açık' : 'kapalı') },
      s.genOn ? { label: 'Jeneratör', value: row.gen > 0.5 ? kw(row.gen) : 'duruyor', sub: row.gen > 0.5 ? fmt(row.fuel, 1, 'l/h') + (row.dump > 0.5 ? ' · atık ' + kw(row.dump) : '') : 'günlük ' + fmt(sys.fuel, 0, 'l') + ' yakıt' } : null,
      { label: 'Öz yeterlilik', value: '%' + fmt(sys.selfSuff * 100, 0), sub: 'depolamasız %' + fmt(v.noBat.selfSuff * 100, 0) + ' · öz tüketim %' + fmt(sys.selfCons * 100, 0), level: 'info' },
      { label: 'Şebeke tepe çekişi', value: kw(sys.peakImp), sub: 'yük tepesi ' + kw(sys.peakLoad) + ' · azaltım %' + fmt(v.peakCut * 100, 0) + (s.batKWh > 0 ? ' (depolama payı %' + fmt(v.peakCutBat * 100, 0) + ')' : '') + demandMo, level: s.strategy === 'peak' && sys.overLimitHours ? 'warn' : 'ok' },
      s.batKWh > 0 ? { label: 'Eşdeğer çevrim', value: fmt(sys.cycles, 2) + ' /gün', sub: 'basit ömür ≈ ' + (isFinite(v.life.years) ? fmt(v.life.years, 1, 'yıl') : '—') + ' · gün sonu SOC %' + fmt(sys.socEnd * 100, 0), level: sys.cycles > 1.5 ? 'warn' : 'ok' } : null,
      { label: 'Günlük enerji maliyeti', value: fmt(sys.cost, 0, 'TL'), sub: 'yalnız şebeke ' + fmt(v.gridOnly.cost, 0) + ' · depolamasız ' + fmt(v.noBat.cost, 0) + ' TL', wide: true },
      s.batKWh > 0 ? { label: 'Depolamanın günlük katkısı', value: (v.savingBat >= 0 ? '' : '−') + fmt(Math.abs(v.savingBat), 0, 'TL'), sub: 'çevrim kaybı ' + fmt(sys.lossBat, 0, 'kWh') + (sys.chGrid > 0.5 ? ' · şebekeden şarj ' + fmt(sys.chGrid, 0, 'kWh') : ''), level: v.savingBat >= 0 ? 'ok' : 'warn' } : null,
      sys.uns > 0.5 ? { label: 'Karşılanamayan yük', value: VS.fmtEnergy(sys.uns), sub: sys.unservedHours + ' saat', level: 'bad' } : null
    ].filter(Boolean);
  }
  function charts(res, s, L) {
    const v = res.values, R = v.sys.rows, h = hourOf(L, s);
    const xs = { min: 0, max: 24, ticks: [0, 3, 6, 9, 12, 15, 18, 21, 24], fmt: x => String(x).padStart(2, '0'), label: 'saat' };
    const mid = f => R.map(r => [r.h + 0.5, f(r)]);
    const series = [
      { name: 'Batarya (+deşarj / −şarj)', type: 'bar', color: 'violet', data: mid(r => r.dis - r.ch), width: 0.7 },
      { name: 'Yük', color: 'red', width: 2.2, data: mid(r => r.load) },
      s.pvOn ? { name: 'GES', color: 'amber', area: true, data: mid(r => r.pv) } : null,
      s.windOn ? { name: 'RES', color: 'cyan', data: mid(r => r.wind) } : null,
      { name: 'Şebeke (+alış / −veriş)', color: 'blue', width: 2, data: mid(r => r.imp - r.exp) },
      s.genOn ? { name: 'Jeneratör', color: 'brown', data: mid(r => r.gen) } : null
    ].filter(Boolean);
    const out = [{
      id: 'flow', title: 'Saatlik enerji akışı (kWh)', height: 190, series: series,
      hLines: s.strategy === 'peak' ? [{ y: s.demandKW, label: 'talep sınırı', color: '#ef4444' }] : [],
      markers: [{ x: h + 0.5, label: hh(h), color: '#fcd34d' }], x: xs, y: { label: 'kW' },
      alt: 'Günlük yük ' + fmt(v.sys.load, 0) + ' kWh, GES ' + fmt(v.sys.pv, 0) + ' kWh, şebekeden ' + fmt(v.sys.imp, 0) + ' kWh alış, ' + fmt(v.sys.exp, 0) + ' kWh veriş; batarya ' + fmt(v.sys.dis, 0) + ' kWh deşarj.'
    }];
    if (s.batKWh > 0) out.push({
      id: 'soc', title: 'Batarya doluluğu (SOC, saat sonu)', height: 150,
      series: [{ name: 'SOC %', color: 'green', area: true, data: [[0, v.sys.soc0 * 100]].concat(R.map(r => [r.h + 1, r.soc * 100])) }],
      hLines: [{ y: 100 - s.dod, label: 'SOC min', color: '#f59e0b' }].concat(s.strategy === 'backup' ? [{ y: s.reserve, label: 'rezerv', color: '#22b8cf' }] : []),
      markers: [{ x: h + 1, color: '#fcd34d' }], x: xs, y: { min: 0, max: 105, label: '%' },
      alt: 'SOC başlangıçta %' + fmt(v.sys.soc0 * 100, 0) + ', gün sonunda %' + fmt(v.sys.socEnd * 100, 0) + '; ' + fmt(v.sys.cycles, 2) + ' eşdeğer çevrim.'
    });
    out.push({
      id: 'peak', title: 'Şebeke çekişi: depolamasız ve depolamalı', height: 150,
      series: [{ name: 'Depolamasız', color: 'grey', dash: [4, 3], data: v.noBat.rows.map(r => [r.h + 0.5, r.imp]) }, { name: 'Depolamalı', color: 'blue', data: mid(r => r.imp) }],
      hLines: s.strategy === 'peak' ? [{ y: s.demandKW, label: 'sınır', color: '#ef4444' }] : [], x: xs, y: { label: 'kW' },
      alt: 'Şebeke tepe çekişi depolamasız ' + fmt(v.noBat.peakImp, 0) + ' kW, depolamalı ' + fmt(v.sys.peakImp, 0) + ' kW.'
    });
    out.push({
      id: 'cost', title: 'Günlük maliyet karşılaştırması (TL)', height: 140,
      series: [{ name: 'TL/gün', type: 'bar', color: 'amber', data: [[1, v.gridOnly.cost], [2, v.noBat.cost], [3, v.sys.cost]] }],
      x: { min: 0.4, max: 3.6, ticks: [1, 2, 3], fmt: x => ['', 'Yalnız şebeke', 'Depolamasız', 'Depolamalı'][x] || '' }, y: { label: 'TL' },
      alt: 'Yalnız şebeke ' + fmt(v.gridOnly.cost, 0) + ' TL, GES/RES depolamasız ' + fmt(v.noBat.cost, 0) + ' TL, depolamalı ' + fmt(v.sys.cost, 0) + ' TL.'
    });
    return out;
  }

  /* ---------------------------------------------------------------- zaman */
  function tick(app, dt) {
    const L = app.live, s = app.state;
    const h0 = Math.floor(L.t);
    L.t += dt * (s.speed || 1);
    if (L.t >= 24) { L.t -= 24; }
    return Math.floor(L.t) !== h0;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  function rebuildOn(s) { return [s.pvOn ? Math.min(8, Math.max(1, Math.round(s.pvKWp / 100))) : 0, s.windOn ? 1 : 0, s.genOn ? 1 : 0, s.batKWh > 0 ? Math.min(8, Math.max(1, Math.ceil(s.batKWh / 500))) : 0].join('|'); }

  const BUS = [9.2, 0.14, -0.4];
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const sc = { flows: {}, labels: {}, leds: [], rotor: null, puffs: [], sig: '' };
    app.scene3 = sc;
    k.ground(140, M.grass, 0);
    const yard = k.box(46, 0.05, 30, M.asphalt, -1, 0.025, -1); yard.userData.noClip = true; yard.castShadow = false;
    buildFactory(k, sc, s, app);
    buildBus(k, sc, app);
    if (s.batKWh > 0) buildBess(k, sc, s, app);
    buildGrid(k, sc, app);
    if (s.windOn) buildWind(k, sc, app);
    if (s.genOn) buildGen(k, sc, app);
    const y = 0.14;
    const cab = (key, pts, col) => { const t = k.tube(pts, 0.06, M.cableBlack, null); sc.flows[key] = k.flow(t.userData.curve, 18, col, 0.11); };
    if (s.pvOn) cab('pv', [[5.6, 6.3, -1.4], [6.3, 5.4, -0.7], [6.3, 0.5, -0.7], [7.2, y, -0.5], [8.4, y, -0.4]], 0xfcd34d);
    if (s.batKWh > 0) cab('bat', [[10.0, y, -0.4], [12.8, y, -0.6], [14.6, y, -1.0], [15.4, y, -2.6], [15.4, y, -4.2]], 0x22d3ee);
    cab('grid', [[-15.2, y, 5.2], [-6, y, 5.2], [5, y, 3.2], [8.6, y, 1.2], [9.0, y, 0.2]], 0x93c5fd);
    cab('load', [[8.6, y, -0.6], [6.8, y, -0.6], [4.2, y, -0.8], [4.2, 0.9, -1.0]], 0x4ade80);
    if (s.windOn) cab('wind', [[-17.4, y, -13.4], [-17.4, y, 2.6], [-6, y, 3.4], [5.2, y, 2.4], [8.8, y, 0.6]], 0x67e8f9);
    if (s.genOn) cab('gen', [[9.6, y, 6.2], [9.8, y, 3.4], [9.6, y, 0.4]], 0xfb923c);
    app.def.scene.bounds = [-24, 20];
    v.setView({ target: [-1, 1.5, -2.5], r: 54, theta: 0.3, phi: 1.02, limits: { rMin: 6, rMax: 100 } });
    v.setShadowBox(28, 120);
    sc.sunKey = '';
    applyHour(k, app, true);
  }

  /* fabrika binası ve çatı GES dizisi (panel sayısı temsilîdir) */
  function buildFactory(k, sc, s, app) {
    const T = k.T, M = k.mats;
    const g = k.staticGroup(null, -2, 0, -6);
    const W = 16, Hh = 6, D = 10;
    k.box(W, Hh, D, M.wallPanel, 0, Hh / 2, 0, g);
    k.box(W + 0.3, 0.3, D + 0.3, M.roofSheet, 0, Hh + 0.15, 0, g);
    [-1, 1].forEach(sd => k.box(W + 0.3, 0.5, 0.15, M.wallPanel, 0, Hh + 0.55, sd * (D / 2 + 0.08), g));
    for (let i = 0; i < 7; i++) k.box(0.08, Hh - 0.3, 0.05, M.steel, -W / 2 + 1 + i * 2.3, Hh / 2, D / 2 + 0.03, g);
    k.box(4, 4, 0.1, M.plasticGrey, -3, 2, D / 2 + 0.06, g); // seksiyonel kapı
    for (let i = 0; i < 8; i++) k.box(4, 0.03, 0.04, M.steel, -3, 0.4 + i * 0.48, D / 2 + 0.12, g);
    for (let i = 0; i < 4; i++) k.box(1.6, 0.9, 0.05, M.glass, 2 + i * 1.9, 4.4, D / 2 + 0.05, g);
    const body = k.group(null, -2, 0, -6);
    const hit = k.box(W, Hh, D, k.mat(0x000000, { transparent: true, opacity: 0, depthWrite: false }), 0, Hh / 2, 0, body); hit.castShadow = false; hit.userData.noMerge = true;
    k.pickable(body, 'Fabrika (tüketim)', a => { const r = a.validResult && a.validResult.values; if (!r) return []; const row = r.sys.rows[hourOf(a.live, a.state)]; return ['Profil: ' + (a.state.loadPreset === 'ozel' ? 'özel (ölçülmüş)' : X.LOAD_SHAPES[a.state.loadPreset].name), 'Şu an ' + kw(row.load) + ' · günlük ' + VS.fmtEnergy(r.sys.load), 'Yük tepesi ' + kw(r.sys.peakLoad) + ' · şebeke tepesi ' + kw(r.sys.peakImp)]; },
      a => ['tek', 'iki', 'uc'].filter(p => p !== a.state.loadPreset).map(p => ({ label: X.LOAD_SHAPES[p].name, onClick: x => { x.state.loadPreset = p; x.renderControls(true); x.invalidate(); } })));
    sc.labels.load = k.label('Fabrika', body, [0, Hh + 1.6, 0]);
    // çatı GES: sıralar güneye (+z) eğik
    if (s.pvOn) {
      const rows = Math.min(8, Math.max(1, Math.round(s.pvKWp / 100))), per = 12, n = rows * per;
      const pv = new T.InstancedMesh(new T.BoxGeometry(1.08, 0.035, 1.9), M.pvCell, n), frame = new T.InstancedMesh(new T.BoxGeometry(1.1, 0.06, 0.08), M.alu, n * 2);
      const d = new T.Object3D(); let m = 0, f = 0;
      const tilt = clamp(s.tilt, 0, 45) * DEG, dz = (D - 1.6) / rows;
      for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
        const x = -W / 2 + 1.2 + i * 1.18, z = -D / 2 + 1.1 + r * dz, y = Hh + 0.75;
        d.position.set(x, y, z); d.rotation.set(-tilt, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); pv.setMatrixAt(m++, d.matrix);
        [-0.95, 0.95].forEach(o => { d.position.set(x, y - Math.sin(tilt) * o, z + Math.cos(tilt) * o); d.updateMatrix(); frame.setMatrixAt(f++, d.matrix); });
      }
      pv.castShadow = true; pv.receiveShadow = true; frame.castShadow = true;
      const arr = k.group(null, -2, 0, -6); arr.add(pv); arr.add(frame);
      k.pickable(pv, 'Çatı GES dizisi', a => { const r = a.validResult && a.validResult.values; if (!r) return []; const row = r.sys.rows[hourOf(a.live, a.state)]; return [fmt(a.state.pvKWp, 0) + ' kWp DC · ' + fmt(a.state.pvAC, 0) + ' kW AC (panel sayısı temsilî)', 'Şu an ' + kw(row.pv) + (row.lost > 0.5 ? ' · kesintide ada koruması nedeniyle durdu' : ''), 'Günlük ' + VS.fmtEnergy(r.sys.pv) + ' · öz tüketim %' + fmt(r.sys.selfCons * 100, 0), 'Hesap: engine.ges temsilî gün (' + MONTHS[a.state.month - 1] + ')']; },
        a => [{ label: 'GES’i devreden çıkar', variant: 'warn', onClick: x => { x.state.pvOn = false; x.renderControls(true); x.invalidate(); } }]);
      sc.labels.pv = k.label('GES', arr, [W / 2 - 2, Hh + 2.4, -D / 2 + 2]);
      // inverter dizisi (duvarda)
      const inv = k.group(null, 5.0, 0, -0.85);
      for (let i = 0; i < 3; i++) { k.rbox(0.6, 0.75, 0.25, 0.03, M.plasticWhite, -i * 0.75, 2.2, 0, inv); sc.leds.push({ m: k.sphere(0.03, M.ledOff, -i * 0.75 + 0.2, 2.45, 0.14, inv), kind: 'pv' }); }
    }
  }

  /* AG ana dağıtım panosu: bütün akışların buluştuğu bara */
  function buildBus(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, BUS[0], 0, BUS[2] - 0.6);
    k.box(2.6, 0.1, 0.7, M.plasticDark, 0, 0.05, 0, g);
    k.rbox(2.6, 2.2, 0.6, 0.03, M.panelRAL7035, 0, 1.2, 0, g);
    for (let i = 1; i < 4; i++) k.box(0.02, 2.1, 0.02, M.darkSteel, -1.3 + i * 0.65, 1.2, 0.31, g);
    const scr = k.screen(0.62, 0.36, 384, (gx, w, h) => drawBusScreen(gx, w, h, app), g, { emissive: 0.9 });
    scr.position.set(-0.65, 1.7, 0.31); sc.busScreen = scr;
    k.pickable(g, 'AG ana dağıtım panosu (ADP)', a => { const r = a.validResult && a.validResult.values; if (!r) return []; const row = r.sys.rows[hourOf(a.live, a.state)];
      return ['Güç dengesi (' + hh(row.h) + '): yük ' + kw(row.load), 'Kaynaklar: GES ' + kw(row.pv) + ' · RES ' + kw(row.wind) + ' · batarya ' + kw(row.dis) + ' · şebeke ' + kw(row.imp) + ' · jeneratör ' + kw(row.gen), 'Tüketimler: şarj ' + kw(row.ch) + ' · veriş ' + kw(row.exp) + ' · kırpılan ' + kw(row.curt)]; });
    sc.labels.bus = k.label('ADP 0,4 kV', g, [0, 2.8, 0], 'vs-label--sm');
  }
  function drawBusScreen(gx, w, h, app) {
    gx.fillStyle = '#04121f'; gx.fillRect(0, 0, w, h);
    const r = app.validResult && app.validResult.values; if (!r) return;
    const row = r.sys.rows[hourOf(app.live, app.state)];
    gx.font = 'bold 26px monospace'; gx.fillStyle = '#22d3ee'; gx.fillText('ADP ' + hh(row.h), 14, 34);
    gx.font = '22px monospace';
    [['YÜK', row.load, '#f87171'], ['GES', row.pv, '#fcd34d'], ['BAT', row.dis - row.ch, '#c4b5fd'], ['ŞEB', row.imp - row.exp, '#93c5fd']].forEach((x, i) => {
      gx.fillStyle = x[2]; gx.fillText(x[0], 14, 78 + i * 46); gx.fillStyle = '#e2e8f0'; gx.fillText(fmt(x[1], 0) + ' kW', 110, 78 + i * 46);
    });
  }

  /* LiFePO4 BESS konteyneri + PCS dolabı */
  function buildBess(k, sc, s, app) {
    const T = k.T, M = k.mats;
    const g = k.group(null, 15.4, 0, -6.4);
    const Wc = 6.06, Hc = 2.59, Dc = 2.44;
    // konteyner kabuğu (şeffaf kapak/kesitle içi görünür)
    const shellMat = k.mat(0xe9edf0, { metalness: 0.35, roughness: 0.5 });
    const shell = k.group(g, 0, 0, 0);
    k.box(Wc, 0.08, Dc, shellMat, 0, Hc, 0, shell);
    k.box(Wc, Hc, 0.05, shellMat, 0, Hc / 2, -Dc / 2, shell);
    k.box(0.05, Hc, Dc, shellMat, -Wc / 2, Hc / 2, 0, shell);
    k.box(0.05, Hc, Dc, shellMat, Wc / 2, Hc / 2, 0, shell);
    k.box(Wc, Hc, 0.05, shellMat, 0, Hc / 2, Dc / 2, shell);
    for (let i = 0; i < 18; i++) k.box(0.04, Hc - 0.1, 0.03, shellMat, -Wc / 2 + 0.2 + i * 0.33, Hc / 2, Dc / 2 + 0.035, shell);
    k.shell(shell); k.explodable(shell, [0, 3.2, 0]);
    k.box(Wc, 0.15, Dc, M.darkSteel, 0, 0.075, 0, g);
    // raflar ve modüller (InstancedMesh)
    const racks = Math.min(8, Math.max(1, Math.ceil(s.batKWh / 500))), perRack = 8;
    const mod = new T.InstancedMesh(new T.BoxGeometry(0.5, 0.2, 0.62), k.mat(0x2b3440, { metalness: 0.4, roughness: 0.5 }), racks * perRack);
    const d = new T.Object3D(); let n = 0;
    sc.socBars = [];
    for (let r = 0; r < racks; r++) {
      const x = racks > 1 ? -Wc / 2 + 0.55 + r * (Wc - 1.1) / (racks - 1) : 0;
      k.box(0.6, 2.2, 0.08, M.darkSteel, x, 1.25, -0.4, g);
      for (let i = 0; i < perRack; i++) { d.position.set(x, 0.35 + i * 0.25, -0.05); d.updateMatrix(); mod.setMatrixAt(n++, d.matrix); }
      const bar = k.box(0.06, 1.8, 0.03, M.ledOff, x + 0.22, 1.2, 0.29, g); bar.userData.noMerge = true; sc.socBars.push(bar);
    }
    mod.castShadow = true; mod.receiveShadow = true; g.add(mod);
    // HVAC ünitesi ve yangın söndürme paneli
    k.box(0.35, 1.2, 1.4, M.plasticGrey, Wc / 2 + 0.2, 1.4, 0, g);
    for (let i = 0; i < 6; i++) k.box(0.02, 0.9, 0.05, M.darkSteel, Wc / 2 + 0.38, 1.4, -0.5 + i * 0.2, g);
    k.box(0.35, 0.3, 0.05, M.plasticRed, -Wc / 2 + 0.6, 1.7, Dc / 2 + 0.06, g);
    k.pickable(mod, 'LiFePO4 batarya rafları', a => { const r = a.validResult && a.validResult.values; if (!r) return []; const row = r.sys.rows[hourOf(a.live, a.state)];
      return [fmt(a.state.batKWh, 0) + ' kWh · DoD %' + a.state.dod + ' → kullanılabilir ' + fmt(r.usable, 0) + ' kWh', 'SOC %' + fmt(row.soc * 100, 0) + ' · ' + (row.dis > 0.5 ? 'deşarj ' + kw(row.dis) : row.ch > 0.5 ? 'şarj ' + kw(row.ch) : 'bekleme'), 'Günlük ' + fmt(r.sys.cycles, 2) + ' eşdeğer çevrim · basit ömür ≈ ' + (isFinite(r.life.years) ? fmt(r.life.years, 1) + ' yıl' : '—'), 'Hücre: LFP, IEC 62619 · sistem: IEC 62933-5-2'];
    }, stratActions);
    const pcs = k.group(null, 14.6, 0, -1.9);
    k.rbox(1.6, 2.2, 0.8, 0.03, M.panelRAL7035, 0, 1.15, 0, pcs);
    const scr = k.screen(0.5, 0.3, 320, (gx, w, h) => drawPcs(gx, w, h, app), pcs, { emissive: 0.9 });
    scr.position.set(0, 1.65, 0.41); sc.pcsScreen = scr;
    for (let i = 0; i < 5; i++) k.box(1.2, 0.03, 0.02, M.darkSteel, 0, 0.5 + i * 0.12, 0.41, pcs);
    k.pickable(pcs, 'PCS (çift yönlü batarya inverteri)', a => { const r = a.validResult && a.validResult.values; if (!r) return []; return ['PCS ' + fmt(a.state.batKW, 0) + ' kW · C-oranı sınırı ' + fmt(a.state.crate * a.state.batKWh, 0) + ' kW → P_max ' + kw(r.Pmax), 'Çevrim verimi %' + a.state.rte + ' (şarj ve deşarj √η)', 'Ada çalışması: ' + (a.state.island ? 'şebeke yapıcı mod açık' : 'kapalı (kesintide durur)')]; }, stratActions);
    sc.labels.bat = k.label('Batarya', g, [0, Hc + 1.1, 0]);
  }
  function stratActions(a) {
    return Object.keys(STRAT).filter(k2 => k2 !== a.state.strategy).map(k2 => ({ label: STRAT[k2], onClick: x => setStrategy(x, k2) }));
  }
  function drawPcs(gx, w, h, app) {
    gx.fillStyle = '#071a10'; gx.fillRect(0, 0, w, h);
    const r = app.validResult && app.validResult.values; if (!r) return;
    const row = r.sys.rows[hourOf(app.live, app.state)];
    gx.font = 'bold 24px monospace'; gx.fillStyle = '#4ade80'; gx.fillText(row.dis > 0.5 ? 'DEŞARJ' : row.ch > 0.5 ? 'ŞARJ' : 'BEKLEME', 12, 34);
    gx.fillStyle = '#e2e8f0'; gx.font = 'bold 30px monospace'; gx.fillText(fmt(row.dis - row.ch, 0) + ' kW', 12, 84);
    gx.fillStyle = '#1e293b'; gx.fillRect(12, 112, w - 24, 34); gx.fillStyle = 'hsl(' + Math.round(row.soc * 120) + ',80%,48%)'; gx.fillRect(12, 112, (w - 24) * row.soc, 34);
    gx.fillStyle = '#0b1220'; gx.font = 'bold 22px monospace'; gx.fillText('SOC %' + fmt(row.soc * 100, 0), 20, 138);
  }

  /* şebeke bağlantısı: beton köşk trafo + sayaç */
  function buildGrid(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, -17, 0, 5.2);
    k.box(4.2, 2.9, 3.0, M.concrete, 0, 1.45, 0, g);
    k.box(4.4, 0.2, 3.2, M.concreteDark, 0, 3.0, 0, g);
    k.box(1.1, 2.1, 0.06, M.steel, -0.9, 1.1, 1.53, g); k.box(1.1, 2.1, 0.06, M.steel, 0.7, 1.1, 1.53, g);
    for (let i = 0; i < 6; i++) k.box(0.9, 0.04, 0.05, M.darkSteel, 0.7, 2.2 - i * 0.1, 1.57, g);
    const scr = k.screen(0.5, 0.26, 320, (gx, w, h) => drawMeter(gx, w, h, app), g, { emissive: 0.9 });
    scr.position.set(1.6, 1.7, 1.54); sc.meter = scr;
    // havai hat direkleri
    [[-22, 6], [-28, 6.5]].forEach(p => { const pole = k.cyl(0.13, 0.17, 9, M.concreteDark, p[0], 4.5, p[1], null, 12); void pole; k.box(2.4, 0.12, 0.12, M.steel, p[0], 8.4, p[1]); });
    k.tube([[-22, 8.5, 6], [-19, 7.8, 5.8], [-17, 3.05, 5.2]], 0.025, M.cableBlack, null);
    k.tube([[-28, 8.5, 6.5], [-25, 8.0, 6.2], [-22, 8.5, 6]], 0.025, M.cableBlack, null);
    k.pickable(g, 'Şebeke bağlantısı (trafo + sayaç)', a => { const r = a.validResult && a.validResult.values; if (!r) return []; const row = r.sys.rows[hourOf(a.live, a.state)];
      return [row.grid ? (row.imp > 0.5 ? 'Alış ' + kw(row.imp) : row.exp > 0.5 ? 'Veriş ' + kw(row.exp) : 'Denge 0 kW') : 'ŞEBEKE KESİK', 'Tarife: ' + X.PERIOD_NAME[row.period] + ' · bağlantı gücü ' + kw(a.state.gridKW), 'Günlük alış ' + VS.fmtEnergy(r.sys.imp) + ' · veriş ' + VS.fmtEnergy(r.sys.exp), 'Tepe çekiş ' + kw(r.sys.peakImp)];
    }, a => [a.state.outage ? { label: 'Kesintiyi kaldır', variant: 'primary', onClick: x => { x.state.outage = false; x.renderControls(true); x.invalidate(); } }
      : { label: 'Şimdi 4 saatlik kesinti başlat', variant: 'danger', onClick: x => { x.state.outage = true; x.state.outStart = hourOf(x.live, x.state); x.state.outDur = 4; x.renderControls(true); x.invalidate(); } }]);
    sc.labels.grid = k.label('Şebeke', g, [0, 3.9, 0]);
  }
  function drawMeter(gx, w, h, app) {
    gx.fillStyle = '#0d1f12'; gx.fillRect(0, 0, w, h);
    const r = app.validResult && app.validResult.values; if (!r) return;
    const row = r.sys.rows[hourOf(app.live, app.state)];
    gx.textBaseline = 'middle'; gx.font = 'bold 30px monospace';
    gx.fillStyle = row.grid ? '#86efac' : '#ef4444';
    gx.fillText(row.grid ? (row.exp > 0.5 ? '-' + fmt(row.exp, 0) : fmt(row.imp, 0)) + ' kW' : 'KESİK', 14, h * 0.38);
    gx.font = '20px monospace'; gx.fillStyle = '#94a3b8'; gx.fillText(X.PERIOD_NAME[row.period].toLocaleUpperCase('tr-TR') + ' ' + hh(row.h), 14, h * 0.78);
  }

  /* küçük rüzgâr türbini (rotor çapı güçten) */
  function buildWind(k, sc, app) {
    const M = k.mats, T = k.T;
    const g = k.group(null, -17.4, 0, -14);
    const Hh = 14;
    k.cyl(0.6, 0.9, 0.4, M.concrete, 0, 0.2, 0, g, 20);
    k.cyl(0.22, 0.38, Hh, M.bladeWhite, 0, Hh / 2 + 0.3, 0, g, 18);
    const nac = k.group(g, 0, Hh + 0.4, 0);
    k.rbox(0.7, 0.6, 1.6, 0.12, M.bladeWhite, 0, 0, -0.2, nac);
    const rotor = k.group(nac, 0, 0, 0.7);
    k.sphere(0.32, M.bladeWhite, 0, 0, 0.1, rotor);
    const R = clamp((app.validResult && app.validResult.values.turbine ? app.validResult.values.turbine.D / 2 : 6) * 0.6, 3, 9);
    for (let i = 0; i < 3; i++) { const b = k.box(0.28, R, 0.06, M.bladeWhite, 0, 0, 0, rotor); b.geometry = b.geometry.clone(); b.geometry.translate(0, R / 2, 0); b.rotation.z = i * 2 * Math.PI / 3; }
    sc.rotor = rotor; void T;
    k.pickable(g, 'Rüzgâr türbini (RES)', a => { const r = a.validResult && a.validResult.values; if (!r) return []; const h = hourOf(a.live, a.state), row = r.sys.rows[h];
      return [fmt(a.state.windKW, 0) + ' kW nominal · rotor ≈ ' + fmt(r.turbine.D, 1) + ' m (temsilî ölçek)', 'Rüzgâr ' + fmt(r.wind.v[h], 1) + ' m/s → ' + kw(row.wind), 'Günlük ' + VS.fmtEnergy(r.sys.wind) + ' · engine.res.power (½ρACpv³, nominalde sınırlı)'];
    }, a => [{ label: 'Türbini devreden çıkar', variant: 'warn', onClick: x => { x.state.windOn = false; x.renderControls(true); x.invalidate(); } }]);
    sc.labels.wind = k.label('RES', g, [0, Hh + 2.6, 0]);
  }

  /* dizel jeneratör seti */
  function buildGen(k, sc, app) {
    const M = k.mats, T = k.T;
    const g = k.group(null, 9.6, 0, 7.4);
    k.box(4.0, 0.3, 1.5, M.darkSteel, 0, 0.15, 0, g);
    const can = k.group(g, 0, 0, 0);
    k.rbox(4.0, 1.9, 1.5, 0.05, k.mat(0x5f6f58, { metalness: 0.35, roughness: 0.55 }), 0, 1.25, 0, can);
    for (let i = 0; i < 10; i++) k.box(0.8, 0.035, 0.05, M.darkSteel, 1.3, 0.6 + i * 0.12, 0.77, can);
    k.cyl(0.09, 0.09, 1.1, M.galv, -1.2, 2.7, -0.3, can, 14);
    sc.genLed = k.sphere(0.05, M.ledOff, -1.6, 1.8, 0.78, can);
    const pm = new T.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.25, depthWrite: false });
    for (let i = 0; i < 5; i++) { const p = new T.Mesh(new T.SphereGeometry(0.16, 10, 8), pm.clone()); p.visible = false; p.userData.ph = i / 5; k.viewer.root.add(p); sc.puffs.push(p); }
    sc.stack = new T.Vector3(9.6 - 1.2, 3.3, 7.4 - 0.3);
    k.pickable(can, 'Dizel jeneratör', a => { const r = a.validResult && a.validResult.values; if (!r) return []; const row = r.sys.rows[hourOf(a.live, a.state)];
      return [fmt(a.state.genKW, 0) + ' kW · en düşük yük %' + a.state.genMin, row.gen > 0.5 ? 'Çalışıyor: ' + kw(row.gen) + ' · ' + fmt(row.fuel, 1) + ' l/h' : 'Duruyor', 'Günlük yakıt ' + fmt(r.sys.fuel, 0, 'l') + ' · maliyet ' + fmt(r.sys.fuelCost, 0, 'TL'), 'Yakıt eğrisi: 0,08145·P_nom + 0,246·P (tipik)'];
    }, a => [{ label: a.state.genPeak ? 'Tepe tıraşlamada kullanma' : 'Tepe tıraşlamada da çalıştır', onClick: x => { x.state.genPeak = !x.state.genPeak; x.renderControls(true); x.invalidate(); } }]);
    sc.labels.gen = k.label('Jeneratör', can, [0, 3.0, 0]);
  }

  /* saat → sahne (akış yönü/hızı, LED, ekran, güneş); yalnız değişince */
  function applyHour(k, app, force) {
    const sc = app.scene3, r = app.validResult && app.validResult.values; if (!sc || !r) return false;
    const s = app.state, h = hourOf(app.live, s), row = r.sys.rows[h];
    const sig = h + '|' + JSON.stringify(row) + '|' + s.strategy;
    if (!force && sig === sc.sig) return false;
    sc.sig = sig;
    const M = k.mats, ref = Math.max(50, r.sys.peakLoad);
    const sp = x => (x > 0.5 ? clamp(0.2 + x / ref * 1.1, 0.2, 1.4) : 0);
    const F = sc.flows;
    if (F.pv) F.pv.speed = sp(row.pv);
    if (F.wind) F.wind.speed = sp(row.wind);
    if (F.gen) F.gen.speed = sp(row.gen);
    if (F.bat) { const p = row.dis > 0.5 ? row.dis : row.ch; F.bat.speed = sp(p); F.bat.dir = row.dis > 0.5 ? -1 : 1; }
    F.grid.speed = sp(row.grid ? (row.imp > 0.5 ? row.imp : row.exp) : 0); F.grid.dir = row.exp > 0.5 && row.imp < 0.5 ? -1 : 1;
    F.load.speed = sp(row.load - row.uns);
    sc.leds.forEach(l => { l.m.material = row.pv > 0.5 ? M.ledGreen : M.ledOff; });
    if (sc.socBars) { const col = row.soc > 0.5 ? M.ledGreen : row.soc > 0.2 ? M.ledAmber : M.ledRed; sc.socBars.forEach(b => { b.material = col; b.scale.y = Math.max(0.05, row.soc); b.position.y = 0.3 + 0.9 * Math.max(0.05, row.soc); }); }
    if (sc.genLed) sc.genLed.material = row.gen > 0.5 ? M.ledGreen : M.ledOff;
    [sc.busScreen, sc.pcsScreen, sc.meter].forEach(x => x && x.redraw(sig));
    const L = sc.labels;
    L.load.set('Fabrika · ' + kw(row.load) + (row.uns > 0.5 ? ' · KESİK' : '')); L.load.level(row.uns > 0.5 ? 'bad' : '');
    if (L.pv) { L.pv.set('GES · ' + kw(row.pv)); L.pv.level(row.pv > 0.5 ? 'ok' : ''); }
    if (L.wind) { L.wind.set('RES · ' + kw(row.wind)); L.wind.level(row.wind > 0.5 ? 'ok' : ''); }
    if (L.gen) { L.gen.set('Jeneratör · ' + (row.gen > 0.5 ? kw(row.gen) : 'duruyor')); L.gen.level(row.gen > 0.5 ? 'warn' : ''); }
    if (L.bat) { L.bat.set('Batarya · SOC %' + fmt(row.soc * 100, 0) + (row.dis > 0.5 ? ' · +' + kw(row.dis) : row.ch > 0.5 ? ' · −' + kw(row.ch) : '')); L.bat.level(row.soc < 0.2 ? 'bad' : row.dis > 0.5 ? 'warn' : 'ok'); }
    L.grid.set('Şebeke · ' + (row.grid ? (row.imp > 0.5 ? '+' + kw(row.imp) : row.exp > 0.5 ? '−' + kw(row.exp) : '0 kW') : 'KESİK')); L.grid.level(!row.grid ? 'bad' : s.strategy === 'peak' && row.imp > s.demandKW + 0.5 ? 'warn' : 'ok');
    // güneş: engine.ges.sunPosition (saat ortası)
    const sun = G.sunPosition(r.lat, r.lon, G.MONTH_MID[s.month - 1], h + 0.5, 3), v = k.viewer, T = k.T;
    const el = sun.elevation, az = sun.azimuth * DEG, e2 = Math.max(el, 4) * DEG;
    v.sun.position.set(-Math.sin(az) * Math.cos(e2), Math.sin(e2), Math.cos(az) * Math.cos(e2)).multiplyScalar(60).add(v.sun.target.position);
    const day = clamp((el + 4) / 18, 0, 1);
    v.sun.intensity = 0.25 + 2.4 * clamp(el / 15, 0, 1);
    if (v.hemi) v.hemi.intensity = 0.12 + 0.35 * day;
    const sky = (v.scene.background && v.scene.background.isColor) ? v.scene.background : (v.scene.background = new T.Color());
    const C = sc._c || (sc._c = { a: new T.Color(), b: new T.Color() });
    sky.setHex(SKY.night).lerp(C.a.setHex(el > 6 ? SKY.day : SKY.dusk), day).convertSRGBToLinear();
    v.renderer.toneMappingExposure = 0.55 + 0.37 * day;
    k.invalidate(true);
    return true;
  }
  function update(k, res, s, live, app) { if (app.scene3) app.scene3.sig = ''; applyHour(k, app); }
  function animate(k, dt, res, s, L, app) {
    const sc = app.scene3; if (!sc) return false;
    let moving = applyHour(k, app);
    const row = res.values.sys.rows[hourOf(L, s)];
    if (sc.rotor && row.wind > 0.5 && !k.reducedMotion && dt > 0 && app.running && !app.paused) { sc.rotor.rotation.z -= dt * (0.6 + 2.2 * row.wind / Math.max(1, s.windKW)); moving = true; }
    const run = row.gen > 0.5 && !k.reducedMotion && app.running && !app.paused;
    sc.puffs.forEach(m => {
      const was = m.visible; m.visible = run; if (was !== m.visible) moving = true;
      if (!run) return;
      m.userData.ph = (m.userData.ph + dt * 0.45) % 1; const t = m.userData.ph;
      m.position.set(sc.stack.x + t * 0.6, sc.stack.y + t * 1.8, sc.stack.z); m.scale.setScalar(0.6 + t * 2.4); m.material.opacity = 0.25 * (1 - t); moving = true;
    });
    return moving;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  function layout2d(W) {
    const narrow = W < 640, VW = narrow ? 400 : 800, VH = narrow ? 610 : 500;
    const s = narrow ? Math.min(1.3, (W - 16) / VW) : Math.min(1.35, (W - 84) / VW);
    return { narrow: narrow, VW: VW, VH: VH, s: s, top: narrow ? 118 : 52, ox: narrow ? Math.max(8, (W - VW * s) / 2) : 14 };
  }
  function view2dHeight(W) { const l = layout2d(W); return l.top + l.VH * l.s + 12; }
  function view2d(g, W, Hc, res, s, L) {
    const l = layout2d(W), k = l.s, v = res.values, h = hourOf(L, s), row = v.sys.rows[h];
    const col = { line: '#5b6b82', text: '#e6eef8', dim: '#8ea3bf', pv: '#fcd34d', wind: '#67e8f9', bat: '#c4b5fd', grid: '#93c5fd', gen: '#fb923c', load: '#4ade80', bad: '#ef4444' };
    const X0 = x => l.ox + x * k, Y0 = y => l.top + y * k;
    const font = (px, b) => (b ? 'bold ' : '') + Math.max(11, Math.round(px * k)) + 'px Inter, sans-serif';
    const txt = (t, x, y, c, al, px, b, maxV) => { g.font = font(px || 12, b); g.textAlign = al || 'left'; g.textBaseline = 'middle'; g.fillStyle = c || col.text; g.fillText(maxV ? VS.fitText(g, t, maxV * k) : t, X0(x), Y0(y)); };
    const BW = l.narrow ? 260 : 190, BH = 62;
    const box = (x, y, c, title, val, sub) => {
      g.fillStyle = '#10223d'; g.fillRect(X0(x), Y0(y), BW * k, BH * k); g.strokeStyle = c; g.lineWidth = 2; g.strokeRect(X0(x), Y0(y), BW * k, BH * k);
      txt(title, x + 8, y + 14, c, 'left', 12, true, BW - 14); txt(val, x + 8, y + 33, col.text, 'left', 13, true, BW - 14); if (sub) txt(sub, x + 8, y + 50, col.dim, 'left', 11, false, BW - 14);
    };
    /** Kaynak/tüketici ile bara arasında hat; on ise renkli ve ok yönü güç akış yönünü gösterir (toBus: bara yönünde). */
    const link = (x1, x2, y, on, c, toBus, busAtRight) => {
      g.save(); g.strokeStyle = on ? c : col.line; g.lineWidth = on ? 3 : 2; if (!on) g.setLineDash([5, 5]);
      g.beginPath(); g.moveTo(X0(x1), Y0(y)); g.lineTo(X0(x2), Y0(y)); g.stroke(); g.restore();
      if (!on) return;
      const right = toBus === busAtRight, mx = X0((x1 + x2) / 2), my = Y0(y), d = right ? 1 : -1;
      g.fillStyle = c; g.beginPath(); g.moveTo(mx + d * 9, my); g.lineTo(mx - d * 6, my - 7); g.lineTo(mx - d * 6, my + 7); g.closePath(); g.fill();
    };
    const batTxt = row.dis > 0.5 ? '+' + kw(row.dis) + ' deşarj' : row.ch > 0.5 ? '−' + kw(row.ch) + ' şarj' : 'bekleme';
    const gridTxt = !row.grid ? 'KESİK' : row.imp > 0.5 ? '+' + kw(row.imp) + ' alış' : row.exp > 0.5 ? '−' + kw(row.exp) + ' veriş' : '0 kW';
    const price = fmt(s[{ gunduz: 'pG', puant: 'pP', gece: 'pN' }[row.period]], 2) + ' TL/kWh';
    const nodes = [
      { c: col.grid, t: 'Şebeke', val: gridTxt, sub: X.PERIOD_NAME[row.period] + ' · ' + price, on: row.grid && (row.imp > 0.5 || row.exp > 0.5), toBus: !(row.exp > 0.5 && row.imp < 0.5) },
      { c: col.pv, t: 'GES ' + (s.pvOn ? fmt(s.pvKWp, 0) + ' kWp' : '(yok)'), val: kw(row.pv), sub: row.lost > 0.5 ? 'ada koruması: durdu' : 'günlük ' + fmt(v.sys.pv, 0) + ' kWh', on: row.pv > 0.5, toBus: true },
      { c: col.wind, t: 'RES ' + (s.windOn ? fmt(s.windKW, 0) + ' kW' : '(yok)'), val: kw(row.wind), sub: s.windOn ? fmt(v.wind.v[h], 1, 'm/s') + ' rüzgâr' : '', on: row.wind > 0.5, toBus: true },
      { c: col.gen, t: 'Jeneratör ' + (s.genOn ? fmt(s.genKW, 0) + ' kW' : '(yok)'), val: row.gen > 0.5 ? kw(row.gen) : 'duruyor', sub: row.gen > 0.5 ? fmt(row.fuel, 1, 'l/h') : '', on: row.gen > 0.5, toBus: true },
      { c: col.bat, t: 'Batarya ' + fmt(s.batKWh, 0) + ' kWh', val: batTxt, sub: 'SOC %' + fmt(row.soc * 100, 0) + ' · P_max ' + kw(v.Pmax), on: row.dis > 0.5 || row.ch > 0.5, toBus: row.dis > 0.5, soc: true },
      { c: col.load, t: 'Fabrika yükü', val: kw(row.load), sub: row.uns > 0.5 ? fmt(row.uns, 0) + ' kW beslenemiyor' : X.LOAD_SHAPES[s.loadPreset] ? X.LOAD_SHAPES[s.loadPreset].name : 'özel profil', on: row.load > 0.5, toBus: false }
    ];
    const socBar = (x, y) => { g.fillStyle = '#1e293b'; g.fillRect(X0(x), Y0(y), BW * k, 7 * k); g.fillStyle = 'hsl(' + Math.round(row.soc * 120) + ',80%,50%)'; g.fillRect(X0(x), Y0(y), BW * k * row.soc, 7 * k); };
    txt(hh(h) + '–' + hh(h + 1) + ' · ' + X.PERIOD_NAME[row.period] + ' · ' + STRAT[s.strategy], l.narrow ? 8 : 20, 8, col.text, 'left', 13, true, l.narrow ? 384 : 560);
    if (!l.narrow) {
      const busX = 400;
      g.fillStyle = '#cbd5e1'; g.fillRect(X0(busX - 4), Y0(46), 8 * k, 330 * k);
      txt('ADP 0,4 kV', busX + 10, 34, col.dim, 'left', 11);
      nodes.forEach((n, i) => {
        const right = i >= 4, x = right ? 590 : 20, y = right ? 70 + (i - 4) * 150 : 46 + i * 86;
        box(x, y, n.c, n.t, n.val, n.sub);
        if (right) link(busX + 4, x, y + 31, n.on, n.c, n.toBus, false); else link(x + BW, busX - 4, y + 31, n.on, n.c, n.toBus, true);
        if (n.soc && s.batKWh > 0) socBar(x, y + BH + 6);
      });
      timeline(20, 400, 760);
    } else {
      const busX = 350;
      g.fillStyle = '#cbd5e1'; g.fillRect(X0(busX - 4), Y0(30), 8 * k, 456 * k);
      txt('ADP', busX, 22, col.dim, 'center', 11);
      nodes.forEach((n, i) => {
        const x = 8, y = 30 + i * 78;
        box(x, y, n.c, n.t, n.val, n.sub);
        link(x + BW, busX - 4, y + 31, n.on, n.c, n.toBus, true);
        if (n.soc && s.batKWh > 0) socBar(x, y + BH + 3);
      });
      timeline(8, 500, 384);
    }
    function timeline(x0, y0, wv) {
      txt('24 saat · zemin: gece / gündüz / puant (kırmızı: kesinti) · mavi: şebeke · çizgi: yük', x0, y0, col.dim, 'left', 11, false, wv);
      const cw = wv / 24, ph = { gece: '#1e3a5f', gunduz: '#3b4f2a', puant: '#5a2a2a' }, mx = Math.max(1, ...v.sys.rows.map(r => Math.max(r.load, r.imp)));
      v.sys.rows.forEach((r, i) => {
        g.fillStyle = ph[r.period]; g.fillRect(X0(x0 + i * cw), Y0(y0 + 12), cw * k - 1, 66 * k);
        if (!r.grid) { g.fillStyle = '#ef444466'; g.fillRect(X0(x0 + i * cw), Y0(y0 + 12), cw * k - 1, 66 * k); }
        g.fillStyle = '#93c5fd'; const bh = r.imp / mx * 60; g.fillRect(X0(x0 + i * cw + cw * 0.2), Y0(y0 + 76 - bh), cw * 0.6 * k, bh * k);
      });
      g.strokeStyle = '#f87171'; g.lineWidth = 2; g.beginPath(); v.sys.rows.forEach((r, i) => { const xx = X0(x0 + (i + 0.5) * cw), yy = Y0(y0 + 76 - r.load / mx * 60); if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }); g.stroke();
      g.strokeStyle = '#fcd34d'; g.lineWidth = 2; g.strokeRect(X0(x0 + h * cw), Y0(y0 + 10), cw * k, 70 * k);
      [0, 6, 12, 18, 24].forEach(t => txt(String(t).padStart(2, '0'), x0 + t * cw, y0 + 92, col.dim, t === 0 ? 'left' : t === 24 ? 'right' : 'center', 11));
    }
  }

  /* ---------------------------------------------------------------- kayıt */
  const S = o => Object.assign(defaults(), o);
  VS.register({
    id: 'depolama', title: '3D Batarya Enerji Depolama ve Hibrit Santral Simülasyonu',
    defaults: defaults,
    initLive: initLive,
    autoRun: true,
    startText: 'Gün 00:00’dan oynatılıyor; akışlar her saatin dağıtım sonucunu gösterir.',
    start: app => { if (app._startedOnce) app.live.t = 0; app._startedOnce = true; app.invalidate(); }, // sayfa açılışında seçili saatten, “başlat” ile 00:00’dan
    scenarios: [
      { id: 'oz', name: 'İki vardiya · 1 MWp GES + 1 MWh öz tüketim', desc: 'Konya, Haziran: öğlen GES fazlası bataryaya, akşam vardiyasında yüke verilir.', state: defaults(), start: true },
      { id: 'tepe', name: 'Kesikli üretim · tepe tıraşlama', desc: 'Pres/fırın tepeleri 800 kW’a çıkıyor; batarya şebeke çekişini 500 kW’ta tutmaya çalışır ve sınırın altındaki saatlerde şebekeden şarj olur. Örnek talep bedeli 150 TL/kW·ay.', state: S({ loadPreset: 'kesikli', loadPeak: 800, loadBase: 120, strategy: 'peak', demandKW: 500, gridCharge: true, pvKWp: 300, pvAC: 250, demandCharge: 150 }), start: true },
      { id: 'kesinti', name: 'Akşam kesintisi · yedek rezerv ve ada çalışması', desc: '18:00–22:00 şebeke kesintisi: batarya rezervi ve GES ada modunda üretimi sürdürür.', state: S({ loadPreset: 'tek', loadPeak: 600, loadBase: 150, strategy: 'backup', reserve: 70, outage: true, outStart: 18, outDur: 4, island: true }), start: true },
      { id: 'hibrit', name: 'Hibrit: GES + RES + dizel (zayıf şebeke)', desc: 'Ocak ayı, 150 kW RES ve 450 kW dizel, %80 yedek rezerv; sabah 6 saatlik kesintide jeneratör en düşük yük oranında çalışır, fazlası bataryaya gider.', state: S({ month: 1, cloud: 0.4, Ta: 2, windOn: true, windKW: 150, windMean: 7, genOn: true, genKW: 450, strategy: 'backup', reserve: 80, outage: true, outStart: 6, outDur: 6 }), start: true },
      { id: 'arbitraj', name: 'Üç vardiya · zaman tarifesi arbitrajı', desc: 'GES yok; batarya gece tarifesinde dolar, puantta yükü besler. Çevrim kaybı ve fiyat farkı birlikte değerlendirilir.', state: S({ pvOn: false, loadPreset: 'uc', loadPeak: 600, loadBase: 450, strategy: 'tou' }), start: true },
      { id: 'kis', name: 'Kış ayı · aynı sistem', desc: 'Aralık, bulutlu: GES üretimi düşer; batarya az çevrim yapar, öz yeterlilik azalır.', state: S({ month: 12, cloud: 0.5, Ta: 3 }), start: true }
    ],
    tasks: [
      { id: 'peak', title: 'Şebeke tepesini 500 kW’a indir', goal: 'Kesikli üretimde şebekeden çekilen güç 800 kW’a çıkıyor. Yükü azaltmadan ve GES’i büyütmeden şebeke tepe çekişini 500 kW’ın altına indirin.', hint: 'Stratejiyi “Tepe tıraşlama” yapın, talep sınırını 500 kW’a ayarlayın; gerekirse gece şebekeden şarjı açın ve batarya gücünü (C-oranı) kontrol edin.',
        state: S({ loadPreset: 'kesikli', loadPeak: 800, loadBase: 120, pvKWp: 300, pvAC: 250, strategy: 'self', batKWh: 1000, batKW: 500 }),
        check: (r, s) => s.loadPreset === 'kesikli' && s.loadPeak >= 800 && s.pvKWp <= 300 && r.values.sys.peakImp <= 500 + 1e-6 && r.values.sys.uns < 1e-6 },
      { id: 'selfsuff', title: 'Öz yeterliliği %55’e çıkar', goal: 'İki vardiyalı fabrikada 1 MWp GES var ama batarya yok; öğlen fazlası şebekeye gidiyor. GES gücünü artırmadan ve yükü değiştirmeden şebekeden bağımsızlığı (öz yeterlilik) en az %55 yapın.', hint: 'Batarya kapasitesini ve PCS gücünü artırın, strateji “Öz tüketim” olsun. Günlük enerji akışı grafiğinde öğlen fazlasının akşama kaydığını izleyin.',
        state: S({ batKWh: 0, batKW: 0 }),
        check: (r, s) => s.pvKWp <= 1000 && s.loadPeak >= 600 && s.loadBase >= 150 && s.loadPreset === 'iki' && !s.windOn && !s.genOn && r.values.sys.selfSuff >= 0.55 },
      { id: 'backup', title: '4 saatlik kesintide üretim durmasın', goal: '18:00’de 4 saatlik şebeke kesintisi var ve jeneratör yok. Yükü azaltmadan kesinti boyunca tüm yük beslensin.', hint: 'Ada çalışmasını açın (yoksa inverterler durur), stratejiyi “Yedek rezerv” yapıp rezervi yükseltin; kesintide gereken enerji ≈ 4 sa × akşam yükü / verim. Yetmezse kapasiteyi artırın.',
        state: S({ loadPreset: 'tek', loadPeak: 600, loadBase: 150, outage: true, outStart: 18, outDur: 4, island: false, strategy: 'self', batKWh: 500, batKW: 250 }),
        check: (r, s) => s.outage && s.outDur >= 4 && s.outStart === 18 && !s.genOn && s.loadBase >= 150 && r.values.sys.uns < 1e-6 },
      { id: 'tou', title: 'Zaman tarifesiyle günde 1000 TL kazan', goal: 'GES’siz üç vardiyalı tesiste depolama günlük enerji maliyetini en az 1000 TL düşürsün (tarife fiyatlarını değiştirmeden).', hint: 'Stratejiyi “Zaman tarifesi” yapın: gece dolan batarya puantta deşarj eder. Kazanç ≈ deşarj × (puant − gece/η). Gerekirse kapasiteyi artırın.',
        state: S({ pvOn: false, loadPreset: 'uc', loadPeak: 600, loadBase: 450, strategy: 'self' }),
        check: (r, s) => !s.pvOn && s.pP <= 5.5 && s.pN >= 2.2 && s.loadPreset === 'uc' && r.values.savingBat >= 1000 },
      { id: 'crate', title: 'C-oranı darboğazını aş', goal: 'Ölçülmüş profilde iki kısa pres tepesi (900 kW) var. 1000 kWh enerji tipi (0,25C) batarya 500 kW PCS’ye bağlı ama talep sınırı 500 kW tutmuyor. Kapasiteyi artırmadan ve profili değiştirmeden sınırı sağlayın.', hint: 'P_max = min(PCS, C × kWh). 0,25C hücre 1000 kWh’ta yalnız 250 kW verir; tepe 400 kW fazla. Daha yüksek C-oranlı hücre seçin; Batarya grubundaki P_max notuna bakın.',
        state: S({ pvOn: false, loadPreset: 'ozel', loadCustom: [200, 200, 200, 200, 200, 200, 200, 300, 450, 450, 900, 450, 350, 450, 450, 900, 450, 300, 200, 200, 200, 200, 200, 200], strategy: 'peak', demandKW: 500, gridCharge: true, crate: 0.25 }),
        check: (r, s) => s.batKWh <= 1000 && s.demandKW <= 500 && s.loadPreset === 'ozel' && Math.max.apply(null, r.values.load) >= 900 && r.values.sys.peakImp <= 500 + 1e-6 && r.values.sys.uns < 1e-6 }

    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, L) => { const row = res.values.sys.rows[hourOf(L, s)]; return row.uns > 0.5 ? { level: 'bad', text: 'Yük beslenemiyor' } : !row.grid ? { level: 'warn', text: 'Ada modu · ' + hh(row.h) } : null; },
    reportInputs: (s, app) => { const r = app.validResult.values; return [{ group: 'Günlük sonuç', label: 'Öz yeterlilik', value: '%' + fmt(r.sys.selfSuff * 100, 0) }, { group: 'Günlük sonuç', label: 'Şebeke tepe çekişi', value: kw(r.sys.peakImp) }, { group: 'Günlük sonuç', label: 'Günlük maliyet (depolamalı / depolamasız)', value: fmt(r.sys.cost, 0) + ' / ' + fmt(r.noBat.cost, 0) + ' TL' }]; },
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-24, 20] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
