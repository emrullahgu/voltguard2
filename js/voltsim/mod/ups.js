/* VoltSim · 3D UPS ve Jeneratör Simülasyonu
 * Hesap: VoltSimEngine.ups (UPS yüklenmesi, akü yedekleme süresi, jeneratör yüklenmesi, yakıt süresi) ve
 * ups.atsStep (açık geçişli ATS durum makinesi; QM ve QG aynı anda kapanırsa motor hata fırlatır).
 * Sahne: hesap ve durum makinesi sonucunu gösterir (kesici konumları, enerji akışı, akü doluluk rengi). */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const U = E.ups;

  /* ---------------------------------------------------------------- girdiler ve önayarlar */
  function defaults() {
    return {
      Pcrit: 32, pfCrit: 0.95, upsKVA: 60, upsPF: 0.9, etaInv: 95,
      nBlocks: 40, Vblock: 12, Ah: 100, strings: 1, dod: 80, kTemp: 1, kAge: 0.9,
      genKVA: 200, Pother: 60, pfOther: 0.85, fuel: 0.27, tank: 400,
      tConfirm: 3, tGenReady: 10, tDead: 1, tReturn: 30, tCool: 60,
      plan: true, cutAt: 5, outDur: 120, accel: 2
    };
  }
  const ATS_NAME = { MAINS: 'Şebeke', CONFIRM_FAIL: 'Kesinti onayı', GEN_START: 'Jeneratör yol alıyor', TRANSFER_GEN: 'Jeneratöre aktarma (ölü zaman)', ON_GEN: 'Jeneratörde', RETRANSFER: 'Şebekeye geri aktarma', COOLDOWN: 'Jeneratör soğutma' };
  const RECHARGE_H = 8;      // varsayım: boş aküden tam doluma ≈ 8 saat (temsili, ~C/10 şarj)
  const MAX_SHOWN = 192;     // 3D'de gösterilen en çok akü bloğu (4 raf × 48)

  function cfgOf(s) { return { tConfirm: s.tConfirm, tGenReady: s.tGenReady, tDead: s.tDead, tReturn: s.tReturn, tCool: s.tCool }; }
  function initLive(s) {
    return { mains: true, ats: { state: 'MAINS', t: 0, timer: 0, QM: true, QG: false, genRunning: false }, soc: 1, fuelL: s.tank, dropped: false,
      t: 0, hist: [], histT: 0, events: [], planCut: false, planBack: false, manual: false, onBatT: 0, maxGap: 0 };
  }
  /** Anlık güç yolu: ATS barası, UPS girişi, akü modu (hepsi durum makinesinden türetilir). */
  function paths(L) {
    const a = L.ats;
    const genV = a.genRunning && a.state !== 'GEN_START' && L.fuelL > 0;
    const viaMains = a.QM && L.mains, viaGen = a.QG && genV;
    const bus = viaMains || viaGen;
    return { genV: genV, viaMains: viaMains, viaGen: viaGen, bus: bus, onBat: !bus && !L.dropped, crit: !L.dropped };
  }

  /* ---------------------------------------------------------------- kontroller */
  function cut(app, on) {
    const L = app.live; L.manual = true;
    if (L.mains === !on) return;
    L.mains = !on; L.events.push(fmtT(L.t) + ' · ' + (on ? 'Şebeke kesildi (elle).' : 'Şebeke geri verildi (elle).'));
    app.running = true; app.paused = false; app.syncToolbar(); app.invalidate();
  }
  function controls(s, app) {
    const r = app.validResult && app.validResult.values;
    return [
      { title: 'Şebeke kesintisi', items: [
        { type: 'buttons', items: [
          { label: 'Şebekeyi kes', variant: 'danger', onClick: a => cut(a, true) },
          { label: 'Şebekeyi geri ver', variant: 'primary', onClick: a => cut(a, false) }
        ] },
        { type: 'note', text: 'Elle kesme/geri verme otomatik test planını devre dışı bırakır. “Simülasyonu başlat” planı baştan çalıştırır.' }
      ] },
      { title: 'Kritik yük ve UPS', items: [
        { type: 'range', key: 'Pcrit', label: 'Kritik yük (UPS çıkışı)', min: 1, max: 400, step: 1, unit: 'kW' },
        { type: 'range', key: 'pfCrit', label: 'Kritik yük cosφ', min: 0.7, max: 1, step: 0.01, digits: 2 },
        { type: 'select', key: 'upsKVA', label: 'UPS gücü', options: [10, 20, 30, 40, 60, 80, 100, 120, 160, 200, 300, 400, 500].map(v => [v, v + ' kVA']) },
        { type: 'range', key: 'upsPF', label: 'UPS çıkış güç faktörü', min: 0.8, max: 1, step: 0.01, digits: 2 },
        { type: 'range', key: 'etaInv', label: 'İnverter verimi', min: 85, max: 98, step: 0.5, unit: '%', digits: 1 }
      ] },
      { title: 'Akü grubu', items: [
        { type: 'range', key: 'nBlocks', label: 'Seri blok sayısı', min: 2, max: 100, step: 1 },
        { type: 'select', key: 'Vblock', label: 'Blok gerilimi', options: [[2, '2 V (OPzV hücre)'], [6, '6 V'], [12, '12 V (VRLA)']] },
        { type: 'select', key: 'Ah', label: 'Blok kapasitesi', options: [7, 9, 12, 18, 26, 40, 55, 65, 80, 100, 150, 200, 300, 500].map(v => [v, v + ' Ah']) },
        { type: 'select', key: 'strings', label: 'Paralel akü grubu', options: [1, 2, 3, 4].map(v => [v, v + ' grup']) },
        { type: 'range', key: 'dod', label: 'Kullanılabilir kapasite (DoD)', min: 50, max: 100, step: 5, unit: '%' },
        { type: 'range', key: 'kTemp', label: 'Sıcaklık katsayısı', min: 0.6, max: 1.05, step: 0.01, digits: 2, help: '25 °C altında kapasite düşer; üretici tablosundan alınır.' },
        { type: 'range', key: 'kAge', label: 'Yaşlanma katsayısı', min: 0.6, max: 1, step: 0.01, digits: 2, help: 'Ömür sonu kapasite genellikle anma değerinin %80’i kabul edilir.' },
        r ? { type: 'note', html: 'Akü gerilimi <b>' + fmt(r.Vbat, 0, 'V') + '</b> · toplam enerji <b>' + fmt(r.Ebat, 1, 'kWh') + '</b> · yedekleme <b>' + VS.fmtDuration(r.runtime) + '</b>' } : null
      ] },
      { title: 'Jeneratör ve diğer yükler', items: [
        { type: 'select', key: 'genKVA', label: 'Jeneratör gücü (prime)', options: [60, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500].map(v => [v, v + ' kVA']) },
        { type: 'range', key: 'Pother', label: 'Jeneratöre bağlı diğer yük', min: 0, max: 1000, step: 5, unit: 'kW', help: 'HVAC, aydınlatma, pompa gibi UPS’siz ama jeneratör destekli yükler.' },
        { type: 'range', key: 'pfOther', label: 'Diğer yük cosφ', min: 0.6, max: 1, step: 0.01, digits: 2 },
        { type: 'range', key: 'fuel', label: 'Özgül yakıt tüketimi', min: 0.2, max: 0.4, step: 0.01, unit: 'l/kWh', digits: 2 },
        { type: 'range', key: 'tank', label: 'Yakıt deposu', min: 50, max: 5000, step: 10, unit: 'l' }
      ] },
      { title: 'ATS süreleri', items: [
        { type: 'range', key: 'tConfirm', label: 'Kesinti onay süresi', min: 0.5, max: 30, step: 0.5, unit: 's', digits: 1 },
        { type: 'range', key: 'tGenReady', label: 'Jeneratör yol alma (gerilim/frekans hazır)', min: 3, max: 300, step: 1, unit: 's' },
        { type: 'range', key: 'tDead', label: 'Ölü zaman (açık geçiş)', min: 0.1, max: 5, step: 0.1, unit: 's', digits: 1 },
        { type: 'range', key: 'tReturn', label: 'Şebeke dönüş bekleme', min: 5, max: 600, step: 5, unit: 's' },
        { type: 'range', key: 'tCool', label: 'Jeneratör soğutma (yüksüz)', min: 10, max: 600, step: 10, unit: 's' },
        { type: 'note', text: 'Kesicilerin aynı anda kapanması durum makinesinde engellenir (break-before-make). Senkron paralel / kapalı geçiş bu modelde yoktur.' }
      ] },
      { title: 'Test planı ve zaman', items: [
        { type: 'toggle', key: 'plan', label: 'Otomatik kesinti testi' },
        s.plan ? { type: 'range', key: 'cutAt', label: 'Kesinti anı', min: 1, max: 120, step: 1, unit: 's' } : null,
        s.plan ? { type: 'range', key: 'outDur', label: 'Kesinti süresi', min: 1, max: 14400, step: 1, fmt: v => VS.fmtDuration(v / 60) } : null,
        { type: 'select', key: 'accel', label: 'Zaman hızlandırma', options: [1, 2, 5, 10, 30, 60, 120, 600].map(v => [v, '×' + v]) },
        { type: 'note', text: 'Varsayım (temsili): şebeke/jeneratör dönünce akü ≈ ' + RECHARGE_H + ' saatte boştan tam doluma şarj olur; yakıt yalnız yüklü çalışmada hesaplanır.' }
      ] }
    ];
  }

  /* ---------------------------------------------------------------- zaman adımı */
  function fmtT(t) { return t < 120 ? fmt(t, 0) + ' s' : VS.fmtDuration(t / 60); }
  function record(L) {
    const p = paths(L);
    L.hist.push({ t: L.t, m: L.mains ? 1 : 0, qm: L.ats.QM ? 1 : 0, qg: L.ats.QG ? 1 : 0, b: p.onBat ? 1 : 0, d: L.dropped ? 1 : 0, soc: L.soc });
    if (L.hist.length > 900) L.hist = L.hist.filter((h, i) => i % 2 === 0 || i === L.hist.length - 1); // seyrelt, tüm zaman çizelgesi kalsın
  }
  function tick(app, dt) {
    const res = app.validResult; if (!res) return false;
    const L = app.live, s = app.state, v = res.values, cfg = cfgOf(s);
    if (L.fuelL > s.tank) L.fuelL = s.tank;
    let simDt = dt * (s.accel || 1);
    const n = Math.max(1, Math.ceil(simDt / 0.25)), h = simDt / n;
    let changed = false;
    for (let i = 0; i < n; i++) {
      // otomatik test planı
      if (s.plan && !L.manual) {
        if (!L.planCut && L.t >= s.cutAt) { L.planCut = true; L.mains = false; L.events.push(fmtT(L.t) + ' · Şebeke kesildi (test planı).'); }
        if (L.planCut && !L.planBack && L.t >= s.cutAt + s.outDur) { L.planBack = true; L.mains = true; L.events.push(fmtT(L.t) + ' · Şebeke geri geldi (test planı).'); }
      }
      const prev = L.ats;
      L.ats = U.atsStep(prev, { mains: L.mains }, h, cfg); // QM ∧ QG ihlalinde motor hata fırlatır
      if (L.ats.state !== prev.state) { L.events.push(fmtT(L.t) + ' · ATS: ' + ATS_NAME[L.ats.state]); record(L); changed = true; }
      const p = paths(L);
      if (!p.bus) {
        // akü modu: sabit güçte doğrusal deşarj, motorun yedekleme süresi kadar
        if (!L.dropped) {
          L.soc -= h / (v.runtime * 60); L.onBatT += h; L.maxGap = Math.max(L.maxGap, L.onBatT);
          if (L.soc <= 0) { L.soc = 0; L.dropped = true; L.events.push(fmtT(L.t) + ' · Akü bitti: kritik yük KESİLDİ!'); record(L); changed = true; }
        }
      } else {
        L.onBatT = 0;
        if (L.dropped) { L.dropped = false; L.events.push(fmtT(L.t) + ' · UPS girişi geri geldi, kritik yük yeniden beslendi.'); record(L); changed = true; }
        L.soc = Math.min(1, L.soc + h / (RECHARGE_H * 3600));
      }
      if (p.viaGen) { L.fuelL = Math.max(0, L.fuelL - v.genLoadKW * s.fuel * h / 3600); if (L.fuelL === 0 && p.genV) L.events.push(fmtT(L.t) + ' · Yakıt bitti!'); }
      L.t += h;
    }
    L.histT += simDt;
    if (L.histT >= Math.max(0.25, (s.accel || 1) * 0.2)) { L.histT = 0; record(L); changed = true; }
    return changed;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function supplyText(L) {
    const p = paths(L);
    return L.dropped ? 'KESİK' : p.viaMains ? 'Şebeke → UPS' : p.viaGen ? 'Jeneratör → UPS' : 'Akü (inverter)';
  }
  function readouts(res, s, L) {
    const v = res.values, p = paths(L), a = L.ats;
    const lvl = (x, w, b) => x > b ? 'bad' : x > w ? 'warn' : 'ok';
    const out = [
      { label: 'Kritik yük beslemesi', value: supplyText(L), level: L.dropped ? 'bad' : p.onBat ? 'warn' : 'ok', sub: p.onBat ? 'Kalan ≈ ' + VS.fmtDuration(L.soc * v.runtime) : 'UPS çift dönüşüm (online)', wide: true },
      { label: 'UPS yüklenmesi', value: '%' + fmt(v.upsLoad, 0), level: lvl(v.upsLoad, 80, 100), sub: fmt(s.Pcrit, 0, 'kW') + ' · ' + fmt(v.Scrit, 1, 'kVA') + ' / ' + s.upsKVA + ' kVA' },
      { label: 'Akü yedekleme süresi', value: VS.fmtDuration(v.runtime), level: v.runtime * 60 >= (s.tConfirm + s.tGenReady + s.tDead) * 3 ? 'ok' : v.runtime * 60 >= s.tConfirm + s.tGenReady + s.tDead ? 'warn' : 'bad', sub: 'tam akü, sabit güç' },
      { label: 'Akü enerjisi', value: fmt(v.Ebat, 1, 'kWh'), sub: fmt(v.Vbat, 0, 'V') + ' · ' + s.Ah * s.strings + ' Ah' },
      { label: 'Akü doluluğu (SOC)', value: '%' + fmt(L.soc * 100, 0), level: L.soc < 0.2 ? 'bad' : L.soc < 0.5 ? 'warn' : 'ok', sub: p.onBat ? 'deşarj' : L.soc < 1 ? 'şarj (temsili)' : 'dolu' },
      { label: 'Jeneratör yüklenmesi', value: '%' + fmt(v.genPct, 0), level: lvl(v.genPct, 80, 100), sub: fmt(v.genLoadKVA, 0) + ' / ' + s.genKVA + ' kVA · ' + (a.genRunning ? (a.QG ? 'yükte' : 'yüksüz çalışıyor') : 'duruyor') },
      { label: 'Yakıt süresi (tam depo)', value: isFinite(v.fuelHours) ? fmt(v.fuelHours, 1, 'sa') : '—', sub: 'Depoda ' + fmt(L.fuelL, 0, 'l') + ' · ' + fmt(v.genLoadKW * s.fuel, 1, 'l/sa') },
      { label: 'ATS durumu', value: ATS_NAME[a.state], level: a.state === 'MAINS' ? 'ok' : a.state === 'ON_GEN' || a.state === 'COOLDOWN' ? 'info' : 'warn', sub: atsSub(a, s, L) },
      { label: 'Kilitleme', value: a.QM && a.QG ? 'İHLAL' : 'Sağlam', level: a.QM && a.QG ? 'bad' : 'ok', sub: 'QM ' + (a.QM ? 'kapalı' : 'açık') + ' · QG ' + (a.QG ? 'kapalı' : 'açık') },
      { label: 'Simülasyon zamanı', value: fmtT(L.t), sub: 'hız ×' + s.accel + (L.maxGap ? ' · en uzun akü modu ' + fmtT(L.maxGap) : '') }
    ];
    if (L.events.length) out.push({ label: 'Son olay', value: L.events[L.events.length - 1], wide: true });
    return out;
  }
  function atsSub(a, s, L) {
    if (a.state === 'CONFIRM_FAIL') return fmt(a.timer, 1) + ' / ' + s.tConfirm + ' s';
    if (a.state === 'GEN_START') return fmt(a.timer, 0) + ' / ' + s.tGenReady + ' s';
    if (a.state === 'TRANSFER_GEN' || a.state === 'RETRANSFER') return fmt(a.timer, 1) + ' / ' + s.tDead + ' s (ikisi de açık)';
    if (a.state === 'ON_GEN') return L.mains ? 'şebeke döndü · ' + fmt(a.timer, 0) + ' / ' + s.tReturn + ' s' : 'şebeke bekleniyor';
    if (a.state === 'COOLDOWN') return fmt(a.timer, 0) + ' / ' + s.tCool + ' s';
    return L.mains ? 'şebeke normal' : '';
  }
  function charts(res, s, L) {
    const v = res.values, H = L.hist.slice();
    const last = { t: L.t, m: L.mains ? 1 : 0, qm: L.ats.QM ? 1 : 0, qg: L.ats.QG ? 1 : 0, b: paths(L).onBat ? 1 : 0, soc: L.soc };
    if (!H.length || H[H.length - 1].t < L.t) H.push(last);
    const tMax = Math.max(10, L.t), useMin = tMax > 600, k = useMin ? 1 / 60 : 1;
    // basamak çizimi: her değişimde önceki değer yeni zamanda tekrarlanır
    const step = (key, base) => { const d = []; H.forEach((h, i) => { if (i) d.push([h.t * k, base + H[i - 1][key] * 0.7]); d.push([h.t * k, base + h[key] * 0.7]); }); return d; };
    const xs = { label: useMin ? 'dk' : 's', min: 0, max: tMax * k };
    const nOut = H.filter((h, i) => i && h.m === 0 && H[i - 1].m === 1).length;
    return [{
      id: 'timeline', title: 'Kaynak zaman çizelgesi', height: 170,
      series: [
        { name: 'Şebeke var', color: 'amber', width: 2, data: step('m', 3) },
        { name: 'QM kapalı', color: 'blue', width: 2, data: step('qm', 2) },
        { name: 'QG kapalı', color: 'green', width: 2, data: step('qg', 1) },
        { name: 'UPS akü modunda', color: 'red', width: 2, data: step('b', 0) }
      ],
      x: xs, y: { min: -0.2, max: 4, fmt: y => ['Akü', 'QG', 'QM', 'Şebeke', ''][Math.round(y)] || '' },
      alt: 'Simülasyon süresince şebeke varlığı, QM ve QG kesici konumları ve UPS akü modu basamak grafiği. ' + nOut + ' kesinti; ATS şu an ' + ATS_NAME[L.ats.state] + '. QM ve QG hiçbir anda birlikte kapalı değildir.'
    }, {
      id: 'soc', title: 'Akü doluluğu (SOC)',
      series: [{ name: 'SOC %', color: 'cyan', area: true, data: H.map(h => [h.t * k, h.soc * 100]) }],
      hLines: [{ y: 20, label: '%20', color: '#f59e0b' }],
      x: xs, y: { min: 0, max: 105, label: '%' },
      alt: 'Akü doluluğu şu an %' + fmt(L.soc * 100, 0) + '. Tam akü yedekleme süresi ' + VS.fmtDuration(v.runtime) + '.'
    }, {
      id: 'loads', title: 'Yüklenme oranları', type: 'bar',
      series: [{ name: 'Yüklenme %', type: 'bar', color: 'violet', data: [[1, v.upsLoad], [2, v.genPct]] }],
      hLines: [{ y: 80, label: '%80', color: '#f59e0b' }, { y: 100, label: '%100', color: '#ef4444' }],
      x: { min: 0.4, max: 2.6, ticks: [1, 2], fmt: x => ['', 'UPS', 'Jeneratör'][x] || '' }, y: { label: '%' },
      alt: 'UPS yüklenmesi %' + fmt(v.upsLoad, 0) + ', jeneratör yüklenmesi %' + fmt(v.genPct, 0) + '.'
    }];
  }

  /* ---------------------------------------------------------------- 3D sahne */
  function rebuildOn(s) { return Math.min(s.nBlocks * s.strings, MAX_SHOWN) + '|' + s.strings; }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const sc = { flows: {}, fans: [], puffs: [] };
    app.scene3 = sc;
    // zemin: tesis avlusu (beton) ve kablo kanalı kapakları
    k.ground(60, M.concrete, 0);
    const pad = k.box(16, 0.06, 11, M.concreteDark, -2.2, 0.03, -1.8); pad.userData.noClip = true;
    buildTrafo(k, sc, app);
    buildATS(k, sc, app);
    buildGenset(k, sc, app);
    buildUPS(k, sc, app);
    buildBattery(k, sc, s, app);
    buildServers(k, sc, app);
    buildOther(k, sc, app);
    // kablolar (kanal içinde) ve enerji akış parçacıkları
    const cab = (key, pts, col, r) => { const t = k.tube(pts, r || 0.035, M.cableBlack, null); sc.flows[key] = k.flow(t.userData.curve, 14, col, 0.055); };
    const y = 0.08;
    cab('mains', [[-7.3, y, -1.25], [-6.2, y, -1.25], [-5.0, y, -1.3], [-4.9, y, -1.65]], 0xfcd34d);
    cab('gen', [[-3.1, y, -5.45], [-3.1, y, -3.6], [-4.3, y, -2.9], [-4.3, y, -2.35]], 0xfb923c);
    cab('atsUps', [[-4.4, y, -1.65], [-3.6, y, -1.0], [-1.0, y, -1.0], [-0.45, y, -1.7]], 0xfcd34d);
    cab('other', [[-4.8, y, -1.65], [-4.85, y, -0.6], [-4.85, y, 0.4], [-4.7, y, 1.2]], 0xfcd34d);
    cab('bat', [[1.2, y, -1.6], [0.7, y, -1.35], [0.25, y, -1.7]], 0x22d3ee);
    cab('crit', [[0.0, y, -1.7], [0.3, y, -0.6], [0.9, y, 0.4], [1.2, y, 1.15]], 0x4ade80);
    app.def.scene.bounds = [-9.6, 6.4];
    v.setView({ target: [-2.3, 0.5, -1.5], r: 16, theta: 0.26, phi: 1.04, limits: { rMin: 2, rMax: 30 } });
    v.setShadowBox(11, 50);
    v.sun.position.set(6, 14, 9);
    sc.sig = '';
    applyState(k, app);
  }

  /* dağıtım trafosu + sayaç panosu (şebeke kaynağı) */
  function buildTrafo(k, sc, app) {
    const T = k.T, M = k.mats;
    const g = k.group(null, -8.2, 0, -2.0);
    k.box(2.6, 0.2, 1.8, M.concrete, 0.3, 0.1, 0, g);
    const tank = k.group(g, 0, 0, 0);
    k.box(1.3, 1.25, 0.8, M.trafoPaint, 0, 0.2 + 0.625, 0, tank);
    k.box(1.38, 0.05, 0.88, M.trafoPaint, 0, 1.47, 0, tank);
    // radyatör dilimleri (InstancedMesh, ön ve arka yüz)
    const fin = new T.InstancedMesh(new T.BoxGeometry(0.03, 1.0, 0.26), M.trafoPaint, 22);
    const d = new T.Object3D(); let n = 0;
    [-1, 1].forEach(side => { for (let i = 0; i < 11; i++) { d.position.set(-0.55 + i * 0.11, 0.85, side * 0.53); d.updateMatrix(); fin.setMatrixAt(n++, d.matrix); } });
    fin.castShadow = true; fin.receiveShadow = true; tank.add(fin);
    // genleşme kabı
    const cons = k.cyl(0.13, 0.13, 0.95, M.trafoPaint, 0, 1.78, -0.25, tank, 20); cons.rotation.z = Math.PI / 2;
    [-0.35, 0.35].forEach(x => k.box(0.04, 0.3, 0.04, M.trafoPaint, x, 1.6, -0.25, tank));
    // OG ve AG buşingleri
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) k.cyl(0.055 - j * 0.004, 0.06 - j * 0.004, 0.06, M.porcelain, -0.35 + i * 0.35, 1.53 + j * 0.065, -0.05, tank, 14);
    for (let i = 0; i < 4; i++) { k.cyl(0.035, 0.04, 0.16, M.porcelainGrey, -0.39 + i * 0.26, 1.58, 0.25, tank, 12); k.box(0.03, 0.05, 0.05, M.copper, -0.39 + i * 0.26, 1.69, 0.25, tank); }
    k.pickable(tank, 'Dağıtım trafosu (şebeke beslemesi)', a => {
      const r = a.validResult && a.validResult.values;
      return ['Şebeke: ' + (a.live.mains ? 'var' : 'YOK'), 'ATS üzerinden QM kesicisine bağlanır (açık geçiş).', r ? 'Tesis yükü ≈ ' + fmt(r.genLoadKVA, 0, 'kVA') + ' → ' + fmt(E.currentFromS(r.genLoadKVA * 1000, 400), 0, 'A') + ' (400 V, akü şarjı hariç)' : ''];
    });
    // sayaç / AG giriş panosu
    const mp = k.group(g, 1.25, 0.2, 0.1);
    k.rbox(0.62, 1.3, 0.32, 0.02, M.panelRAL7035, 0, 0.65, 0, mp);
    const scr = k.screen(0.22, 0.1, 256, (gx, w, h) => {
      const L = app.live; gx.fillStyle = '#0d1f12'; gx.fillRect(0, 0, w, h); gx.fillStyle = L && L.mains ? '#86efac' : '#334155'; gx.font = 'bold 44px monospace'; gx.textAlign = 'center'; gx.textBaseline = 'middle';
      gx.fillText(L && L.mains ? '400 V' : '---', w / 2, h / 2);
    }, mp, { emissive: 0.8 });
    scr.position.set(0, 0.95, 0.17); sc.meter = scr;
    k.box(0.5, 0.02, 0.01, M.plasticDark, 0, 0.75, 0.165, mp);
    k.pickable(mp, 'Sayaç ve AG giriş panosu', a => ['Şebeke gerilimi: ' + (a.live.mains ? '400 V' : 'yok'), 'Ölçü: aktif/reaktif sayaç, AG giriş koruması']);
    k.explodable(mp, [0.5, 0, 0.3]);
    sc.trafoLabel = k.label('Şebeke · trafo', tank, [0, 2.15, 0]);
  }

  /* ATS (otomatik transfer) panosu: QM / QG kesicileri ve mekanik kilit */
  function buildATS(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, -4.6, 0, -2.0);
    k.box(1.5, 0.1, 0.6, M.plasticDark, 0, 0.05, 0, g);
    const body = k.box(1.5, 2.0, 0.6, M.panelRAL7035, 0, 1.1, 0, g);
    k.box(1.52, 0.03, 0.62, M.panelRAL7035, 0, 2.115, 0, g);
    k.box(0.02, 1.96, 0.03, M.darkSteel, 0, 1.1, 0.305, g); void body;
    // kontrolör ekranı
    const scr = k.screen(0.36, 0.2, 384, (gx, w, h) => drawATS(gx, w, h, app), g, { emissive: 0.9 });
    scr.position.set(0, 1.72, 0.306); sc.atsScreen = scr;
    k.box(0.4, 0.24, 0.01, M.plasticDark, 0, 1.72, 0.302, g);
    k.pickable(scr, 'ATS kontrolörü', a => { const L = a.live; return ['Durum: ' + ATS_NAME[L.ats.state], 'Onay ' + a.state.tConfirm + ' s · yol alma ' + a.state.tGenReady + ' s · ölü zaman ' + a.state.tDead + ' s', 'Dönüş bekleme ' + a.state.tReturn + ' s · soğutma ' + a.state.tCool + ' s', 'TS EN 60947-6-1: transfer anahtarlama cihazları']; });
    sc.brk = {};
    [['QM', -0.36], ['QG', 0.36]].forEach(b => {
      const dev = k.group(g, b[1], 1.12, 0.3);
      k.rbox(0.44, 0.46, 0.14, 0.02, M.plasticDark, 0, 0, 0.02, dev);
      k.box(0.34, 0.3, 0.02, M.plasticGrey, 0, 0.02, 0.095, dev);
      const handle = k.box(0.05, 0.12, 0.06, M.plasticBlue, 0, 0.02, 0.12, dev);
      const flag = k.box(0.08, 0.035, 0.01, M.plasticGreen, 0.1, 0.15, 0.108, dev);
      const plate = k.screen(0.14, 0.05, 128, (gx, w, h) => { gx.fillStyle = '#f4f4f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 34px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(b[0], w / 2, h / 2 + 2); }, dev);
      plate.position.set(-0.1, 0.17, 0.108);
      const lamp = k.sphere(0.022, M.ledOff, 0, 0.32, 0.02, dev);
      k.pickable(dev, b[0] === 'QM' ? 'QM · şebeke kesicisi' : 'QG · jeneratör kesicisi', a => {
        const L = a.live, on = L.ats[b[0]];
        return [(on ? 'KAPALI' : 'AÇIK') + ' (ATS durum makinesi)', 'Motorlu kesici, 4 kutup (nötr anahtarlamalı)', 'Diğer kesiciyle mekanik + elektriksel kilitli: ikisi asla birlikte kapanmaz.', b[0] === 'QG' ? 'Jeneratör: ' + (L.ats.genRunning ? 'çalışıyor' : 'duruyor') : 'Şebeke: ' + (L.mains ? 'var' : 'yok')];
      });
      k.explodable(dev, [0, 0, 0.45]);
      sc.brk[b[0]] = { handle: handle, flag: flag, lamp: lamp };
    });
    // mekanik kilit: iki kesici arasında kayan çubuk ve durdurma pimleri
    const bar = k.box(0.56, 0.035, 0.035, M.steel, 0, 0.8, 0.34, g);
    [-0.36, 0.36].forEach(x => k.box(0.03, 0.08, 0.04, M.brass, x, 0.84, 0.33, g));
    k.box(0.06, 0.06, 0.05, M.darkSteel, 0, 0.8, 0.33, g);
    k.pickable(bar, 'Mekanik kilit', a => ['Kapalı olan kesici çubuğu öteki kesicinin kapama mekanizmasına iter.', 'Durum: ' + (a.live.ats.QM ? 'QG kilitli' : a.live.ats.QG ? 'QM kilitli' : 'ikisi de açık (ölü zaman)')]);
    sc.bar = bar;
    sc.atsLabel = k.label('ATS panosu', g, [0, 2.4, 0]);
  }
  function drawATS(gx, w, h, app) {
    const L = app.live; gx.fillStyle = '#04121f'; gx.fillRect(0, 0, w, h);
    if (!L) return;
    gx.fillStyle = '#22d3ee'; gx.font = 'bold 22px monospace'; gx.fillText('ATS', 14, 30);
    gx.fillStyle = L.mains ? '#4ade80' : '#ef4444'; gx.fillText(L.mains ? 'ŞEB OK' : 'ŞEB YOK', 80, 30);
    gx.fillStyle = L.ats.genRunning ? '#fbbf24' : '#64748b'; gx.fillText(L.ats.genRunning ? 'JEN ÇALIŞ' : 'JEN DUR', 220, 30);
    gx.fillStyle = '#e2e8f0'; gx.font = 'bold 24px Arial'; gx.fillText(ATS_NAME[L.ats.state].toLocaleUpperCase('tr-TR').slice(0, 26), 14, 90);
    gx.fillStyle = '#94a3b8'; gx.font = '20px monospace'; gx.fillText('QM ' + (L.ats.QM ? 'I' : 'O') + '   QG ' + (L.ats.QG ? 'I' : 'O') + '   t=' + fmt(L.ats.timer, 1) + ' s', 14, 150);
  }

  /* dizel jeneratör seti: şase, kabin (panjurlu), egzoz, kontrol paneli */
  function buildGenset(k, sc, app) {
    const T = k.T, M = k.mats;
    const g = k.group(null, -5.2, 0, -6.2);
    // şase ve kaide yakıt tankı
    k.box(4.2, 0.4, 1.3, M.darkSteel, 0, 0.2, 0, g);
    [-0.66, 0.66].forEach(z => k.box(4.3, 0.16, 0.1, M.darkSteel, 0, 0.48, z, g));
    // motor bloğu, alternatör, radyatör (kabin içinde)
    const engMat = new T.MeshStandardMaterial({ color: 0x38506b, metalness: 0.5, roughness: 0.5 });
    k.box(1.6, 0.85, 0.75, engMat, -0.35, 1.0, 0, g);
    k.box(1.3, 0.2, 0.5, M.steel, -0.35, 1.5, 0, g);
    const alt = k.cyl(0.42, 0.42, 1.0, M.plasticDark, 0.95, 1.0, 0, g, 28); alt.rotation.z = Math.PI / 2;
    k.box(0.4, 0.35, 0.35, M.plasticDark, 1.0, 1.55, 0.25, g); // alternatör klemens kutusu
    k.box(0.12, 1.25, 1.05, M.darkSteel, -1.65, 1.15, 0, g);
    const fan = k.group(g, -1.55, 1.15, 0);
    for (let j = 0; j < 5; j++) { const b = k.box(0.03, 0.42, 0.1, M.darkSteel, 0, 0.2, 0, fan); b.position.set(0, Math.cos(j * 1.2566) * 0.2, Math.sin(j * 1.2566) * 0.2); b.rotation.x = j * 1.2566; }
    sc.fans.push({ obj: fan, axis: 'x', key: 'gen' });
    const engine = k.group(g, 0, 0, 0); void engine;
    // kabin (ses yalıtımlı) — kabuk; patlatınca yukarı kalkar
    const canMat = new T.MeshStandardMaterial({ color: 0x5f6f58, metalness: 0.35, roughness: 0.55 });
    const can = k.group(g, 0, 0, 0);
    const W = 4.4, Hh = 1.75, D = 1.5, y0 = 0.56;
    k.box(W, 0.05, D, canMat, 0, y0 + Hh, 0, can);
    k.box(W, Hh, 0.04, canMat, 0, y0 + Hh / 2, D / 2, can);
    k.box(W, Hh, 0.04, canMat, 0, y0 + Hh / 2, -D / 2, can);
    k.box(0.04, Hh, D, canMat, -W / 2, y0 + Hh / 2, 0, can);
    k.box(0.04, Hh, D, canMat, W / 2, y0 + Hh / 2, 0, can);
    // kapı çizgileri ve menteşeler
    for (let i = 0; i < 4; i++) k.box(0.02, Hh - 0.15, 0.012, M.darkSteel, -1.65 + i * 1.1, y0 + Hh / 2, D / 2 + 0.025, can);
    // panjurlar (InstancedMesh): yan hava girişleri ve radyatör çıkışı
    const louv = new T.InstancedMesh(new T.BoxGeometry(0.85, 0.035, 0.05), M.darkSteel, 36);
    const d = new T.Object3D(); let n = 0;
    [-1, 1].forEach(side => { for (let i = 0; i < 12; i++) { d.position.set(1.35, y0 + 0.3 + i * 0.1, side * (D / 2 + 0.03)); d.rotation.set(side * 0.6, 0, 0); d.updateMatrix(); louv.setMatrixAt(n++, d.matrix); } });
    for (let i = 0; i < 12; i++) { d.position.set(-W / 2 - 0.03, y0 + 0.3 + i * 0.1, 0); d.rotation.set(0, Math.PI / 2, 0.6); d.scale.set(1.25, 1, 1); d.updateMatrix(); louv.setMatrixAt(n++, d.matrix); }
    louv.castShadow = true; can.add(louv);
    // susturucu ve egzoz bacası (çatıda)
    const muf = k.cyl(0.2, 0.2, 1.3, M.galv, 0.2, y0 + Hh + 0.3, -0.25, can, 20); muf.rotation.z = Math.PI / 2;
    [-0.3, 0.6].forEach(x => k.box(0.08, 0.25, 0.08, M.galv, x, y0 + Hh + 0.13, -0.25, can));
    const stack = k.cyl(0.09, 0.09, 1.0, M.galv, 0.95, y0 + Hh + 0.75, -0.25, can, 16);
    const cap = k.cyl(0.14, 0.1, 0.04, M.darkSteel, 0.95, y0 + Hh + 1.28, -0.25, can, 16); cap.rotation.z = 0.45;
    sc.stackTop = new T.Vector3(); stack.updateWorldMatrix(true, false); sc.stackTop.set(-5.2 + 0.95, y0 + Hh + 1.32, -6.2 - 0.25);
    k.shell(can);
    k.explodable(can, [0, 1.6, 0]);
    // kontrol paneli (ön kapakta)
    const cp = k.group(g, 1.75, y0 + 1.05, D / 2 + 0.03);
    k.rbox(0.5, 0.42, 0.1, 0.015, M.plasticDark, 0, 0, 0.04, cp);
    const scr = k.screen(0.3, 0.17, 256, (gx, w, h) => drawGen(gx, w, h, app), cp, { emissive: 0.9 });
    scr.position.set(0, 0.06, 0.092); sc.genScreen = scr;
    sc.genLed = k.sphere(0.018, M.ledOff, -0.17, -0.14, 0.09, cp);
    const estop = k.cyl(0.035, 0.035, 0.03, M.plasticRed, 0.17, -0.14, 0.1, cp, 16); estop.rotation.x = Math.PI / 2;
    k.pickable(cp, 'Jeneratör kontrol paneli', a => { const L = a.live, r = a.validResult.values; return ['Durum: ' + (L.ats.genRunning ? (L.ats.state === 'GEN_START' ? 'yol alıyor' : 'çalışıyor 1500 d/dk · 50 Hz') : 'hazırda bekliyor'), 'Yük: ' + fmt(r.genLoadKVA, 0, 'kVA') + ' (%' + fmt(r.genPct, 0) + ')', 'Tüketim ≈ ' + fmt(r.genLoadKW * a.state.fuel, 1, 'l/sa') + ' · depo ' + fmt(L.fuelL, 0, 'l')]; });
    k.pickable(alt, 'Alternatör', a => ['Senkron alternatör, ' + a.state.genKVA + ' kVA (prime)', 'Yüklenme %' + fmt(a.validResult.values.genPct, 0), 'Performans sınıfı ve adım yük kabulü: ISO 8528 (bu modelde hesaplanmaz)']);
    k.pickable(can, 'Dizel jeneratör seti', a => { const r = a.validResult.values; return [a.state.genKVA + ' kVA · kabinli, kaide yakıt tanklı', 'Yakıt süresi (tam depo ' + a.state.tank + ' l): ' + fmt(r.fuelHours, 1, 'sa'), 'Özgül tüketim ' + fmt(a.state.fuel, 2) + ' l/kWh (yük ve motora bağlı)']; });
    // egzoz dumanı (temsili, yalnız çalışırken)
    const pm = new T.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.25, depthWrite: false });
    for (let i = 0; i < 6; i++) { const p = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), pm.clone()); p.visible = false; p.userData.ph = i / 6; k.viewer.root.add(p); sc.puffs.push(p); }
    sc.genGroup = can;
    sc.genLabel = k.label('Dizel jeneratör', can, [0, 2.7, 0]);
  }
  function drawGen(gx, w, h, app) {
    const L = app.live; gx.fillStyle = '#071a10'; gx.fillRect(0, 0, w, h);
    if (!L) return;
    const run = L.ats.genRunning, ready = run && L.ats.state !== 'GEN_START';
    gx.fillStyle = '#4ade80'; gx.font = 'bold 22px monospace'; gx.fillText(run ? (ready ? 'ÇALIŞIYOR' : 'YOL ALIYOR') : 'OTOMATİK', 12, 32);
    gx.fillStyle = '#e2e8f0'; gx.font = 'bold 26px monospace';
    gx.fillText((ready ? '50.0' : run ? '--.-' : ' 0.0') + ' Hz', 12, 76);
    gx.fillText((ready ? '400' : '  0') + ' V', 12, 112);
    gx.fillStyle = '#fbbf24'; gx.fillText((L.ats.QG ? fmt(app.validResult.values.genPct, 0) : '0') + ' %', 150, 112);
  }

  /* online UPS kabini */
  function buildUPS(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, -0.2, 0, -2.2);
    k.box(1.0, 0.1, 0.85, M.plasticDark, 0, 0.05, 0, g);
    k.box(1.0, 2.0, 0.8, M.panelDark, 0, 1.1, -0.02, g);
    // iç modüller (kabuk saydamlaşınca görünür)
    for (let i = 0; i < 4; i++) k.rbox(0.8, 0.28, 0.6, 0.015, M.plasticGrey, 0, 0.45 + i * 0.34, 0, g);
    for (let i = 0; i < 6; i++) k.cyl(0.04, 0.04, 0.16, M.alu, -0.3 + i * 0.12, 1.85, 0.1, g, 12);
    // ön kapak (kabuk) ve üst gösterge bandı
    const door = k.box(0.98, 1.65, 0.03, M.panelDark, 0, 0.93, 0.395, g); k.shell(door);
    for (let i = 0; i < 8; i++) k.box(0.6, 0.012, 0.01, M.darkSteel, 0, 0.3 + i * 0.05, 0.415, g);
    k.box(0.98, 0.33, 0.03, M.plasticDark, 0, 1.93, 0.395, g);
    const scr = k.screen(0.34, 0.2, 384, (gx, w, h) => drawUPS(gx, w, h, app), g, { emissive: 0.9 });
    scr.position.set(-0.15, 1.93, 0.412); sc.upsScreen = scr;
    sc.upsLeds = ['Şebeke', 'Akü', 'Arıza'].map((n, i) => k.sphere(0.018, M.ledOff, 0.2 + i * 0.09, 1.93, 0.412, g));
    k.pickable(g, 'Online UPS (çift dönüşüm)', a => { const r = a.validResult.values, L = a.live; return [a.state.upsKVA + ' kVA · çıkış PF ' + fmt(a.state.upsPF, 2) + ' · η ' + fmt(a.state.etaInv, 1) + ' %', 'Yüklenme %' + fmt(r.upsLoad, 0) + ' (IEC 62040-3)', 'Mod: ' + supplyText(L), 'Doğrultucu → DC bara → inverter; şebeke kesintisinde inverter aküden kesintisiz beslenir.']; });
    sc.upsLabel = k.label('Online UPS', g, [0, 2.35, 0]);
  }
  function drawUPS(gx, w, h, app) {
    const L = app.live; gx.fillStyle = '#04121f'; gx.fillRect(0, 0, w, h);
    if (!L || !app.validResult) return;
    const p = paths(L), r = app.validResult.values;
    gx.fillStyle = L.dropped ? '#ef4444' : p.onBat ? '#fbbf24' : '#4ade80'; gx.font = 'bold 24px monospace';
    gx.fillText(L.dropped ? 'ÇIKIŞ YOK' : p.onBat ? 'AKÜ MODU' : 'NORMAL', 14, 34);
    gx.fillStyle = '#e2e8f0'; gx.font = 'bold 22px monospace';
    gx.fillText('YÜK %' + fmt(r.upsLoad, 0), 14, 76);
    gx.fillText('KALAN ' + (p.onBat ? VS.fmtDuration(L.soc * r.runtime) : '—'), 14, 110);
    // SOC çubuğu
    gx.strokeStyle = '#94a3b8'; gx.lineWidth = 3; gx.strokeRect(14, 140, w - 90, 40);
    gx.fillStyle = 'hsl(' + Math.round(L.soc * 120) + ',80%,50%)'; gx.fillRect(18, 144, (w - 98) * L.soc, 32);
    gx.fillStyle = '#e2e8f0'; gx.fillText(fmt(L.soc * 100, 0) + '%', w - 70, 170);
  }

  /* akü rafları: bloklar InstancedMesh, ön etiket şeridi SOC oranında dolar ve renklenir */
  function buildBattery(k, sc, s, app) {
    const T = k.T, M = k.mats;
    const total = s.nBlocks * s.strings, shown = Math.min(total, MAX_SHOWN);
    const perShelf = 8, perRack = 48, racks = Math.max(1, Math.ceil(shown / perRack));
    const x0 = 1.2, rw = 1.55, z0 = -2.2;
    const frame = k.group(null, 0, 0, 0);
    for (let r = 0; r < racks; r++) {
      const cx = x0 + rw / 2 + r * (rw + 0.08);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(p => k.box(0.04, 1.95, 0.04, M.galv, cx + p[0] * (rw / 2 - 0.02), 0.975, z0 + p[1] * 0.27, frame));
      for (let i = 0; i < 6; i++) k.box(rw, 0.025, 0.56, M.galv, cx, 0.12 + i * 0.31, z0, frame);
    }
    const body = new T.InstancedMesh(new T.BoxGeometry(0.33, 0.21, 0.17), new T.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 }), shown);
    const strip = new T.InstancedMesh(new T.BoxGeometry(0.28, 0.035, 0.006), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.35 }), shown);
    const term = new T.InstancedMesh(new T.CylinderGeometry(0.018, 0.018, 0.03, 8), M.brass, shown * 2);
    const d = new T.Object3D(), base = [];
    for (let i = 0; i < shown; i++) {
      const r = Math.floor(i / perRack), j = i % perRack, shelf = Math.floor(j / perShelf), q = j % perShelf;
      const col = q % 4, row = Math.floor(q / 4);
      const x = x0 + 0.06 + 0.2 + col * 0.36 + r * (rw + 0.08), y = 0.12 + shelf * 0.31 + 0.12, z = z0 + (row ? 0.12 : -0.12);
      d.position.set(x, y, z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); body.setMatrixAt(i, d.matrix);
      base.push([x, y, z]);
      [-0.1, 0.1].forEach((dx, t) => { d.position.set(x + dx, y + 0.12, z); d.updateMatrix(); term.setMatrixAt(i * 2 + t, d.matrix); });
    }
    [body, strip, term].forEach(m => { m.castShadow = true; m.receiveShadow = true; k.viewer.root.add(m); });
    sc.bat = { strip: strip, base: base, shown: shown };
    k.pickable(frame, 'Akü grubu (VRLA)', a => { const r = a.validResult.values, st = a.state; return [st.nBlocks + ' × ' + st.Vblock + ' V seri · ' + st.strings + ' paralel grup · ' + st.Ah + ' Ah', 'Toplam ' + fmt(r.Ebat, 1, 'kWh') + ' · DC ' + fmt(r.Vbat, 0, 'V'), 'Yedekleme ≈ ' + VS.fmtDuration(r.runtime) + ' (DoD %' + st.dod + ', k_T ' + st.kTemp + ', k_yaş ' + st.kAge + ')', total > shown ? 'Sahnede ' + shown + ' / ' + total + ' blok gösteriliyor.' : 'Akü odası havalandırması: TS EN IEC 62485-2']; });
    k.pickable(body, 'Akü bloğu', a => ['Blok ' + a.state.Vblock + ' V · ' + a.state.Ah + ' Ah', 'SOC %' + fmt(a.live.soc * 100, 0)]);
    sc.batLabel = k.label('Akü · ' + total + ' blok', frame, [x0 + rw / 2, 2.15, z0]);
    if (total > shown) k.label('+' + (total - shown) + ' blok gösterilmiyor', frame, [x0 + rw / 2, 0.1, z0 + 0.5], 'vs-label--sm');
  }
  function paintBattery(k, sc, soc) {
    const b = sc.bat; if (!b) return;
    const d = new k.T.Object3D();
    const s = Math.max(0.03, soc);
    b.base.forEach((p, i) => { d.position.set(p[0] - 0.14 * (1 - s), p[1] + 0.05, p[2] + 0.088 * (p[2] > -2.2 ? 1 : 1)); d.scale.set(s, 1, 1); d.updateMatrix(); b.strip.setMatrixAt(i, d.matrix); });
    b.strip.instanceMatrix.needsUpdate = true;
    b.strip.material.color.setHSL(soc * 0.33, 0.85, 0.5); b.strip.material.emissive.setHSL(soc * 0.33, 0.85, 0.4);
  }

  /* kritik yükler: sunucu kabinleri (UPS çıkışı) */
  function buildServers(k, sc, app) {
    const T = k.T, M = k.mats;
    const n = 5, x0 = 0.2, z = 1.7;
    const g = k.group(null, 0, 0, 0);
    const perf = (gx, w, h) => { gx.fillStyle = '#15191e'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#2b323b'; for (let y = 6; y < h; y += 10) for (let x = 6 + (y / 10 % 2) * 5; x < w; x += 10) { gx.beginPath(); gx.arc(x, y, 3, 0, Math.PI * 2); gx.fill(); } gx.fillStyle = '#3a424c'; gx.fillRect(w - 14, h / 2 - 30, 6, 60); };
    const units = new T.InstancedMesh(new T.BoxGeometry(0.48, 0.085, 0.8), M.darkSteel, n * 14);
    const ledA = new T.InstancedMesh(new T.BoxGeometry(0.012, 0.012, 0.01), M.ledGreen, n * 14);
    const ledB = new T.InstancedMesh(new T.BoxGeometry(0.012, 0.012, 0.01), M.ledBlue, n * 14);
    const d = new T.Object3D(); let u = 0;
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * 0.62;
      k.box(0.6, 2.0, 1.0, M.plasticDark, cx, 1.0, z, g);
      const door = k.screen(0.56, 1.9, 128, perf, g); door.position.set(cx, 1.0, z + 0.505); k.shell(door);
      for (let j = 0; j < 14; j++) {
        const y = 0.25 + j * 0.115;
        d.position.set(cx, y, z + 0.08); d.updateMatrix(); units.setMatrixAt(u, d.matrix);
        d.position.set(cx - 0.2, y, z + 0.515); d.updateMatrix(); ledA.setMatrixAt(u, d.matrix);
        d.position.set(cx - 0.17 + (j % 3) * 0.02, y, z + 0.515); d.updateMatrix(); ledB.setMatrixAt(u, d.matrix);
        u++;
      }
    }
    [units, ledA, ledB].forEach(m => { m.castShadow = m === units; k.viewer.root.add(m); });
    sc.srv = { ledA: ledA, ledB: ledB };
    k.pickable(g, 'Kritik yükler · sunucu kabinleri', a => { const r = a.validResult.values; return [fmt(a.state.Pcrit, 0, 'kW') + ' · cosφ ' + fmt(a.state.pfCrit, 2) + ' → ' + fmt(r.Scrit, 1, 'kVA'), 'Besleme: ' + supplyText(a.live), 'UPS çıkışından beslenir; kesinti anında aküden kesintisiz devam eder.']; });
    sc.srvLabel = k.label('Kritik yükler · sunucular', g, [x0 + 1.24, 2.35, z]);
  }

  /* diğer yükler: klima santrali + tali dağıtım panosu (ATS çıkışından, UPS’siz) */
  function buildOther(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, -4.6, 0, 2.1);
    k.box(2.4, 0.12, 1.2, M.darkSteel, 0, 0.06, 0, g);
    k.box(2.4, 1.3, 1.2, M.galv, 0, 0.77, 0, g);
    for (let i = 0; i < 5; i++) k.box(0.012, 1.2, 0.01, M.steel, -1 + i * 0.5, 0.77, 0.605, g);
    [-0.6, 0.6].forEach(x => {
      k.cyl(0.42, 0.42, 0.1, M.darkSteel, x, 1.47, 0, g, 28);
      const fan = k.group(g, x, 1.53, 0);
      for (let j = 0; j < 4; j++) { const b = k.box(0.36, 0.01, 0.1, M.plasticGrey, 0, 0, 0, fan); b.position.set(Math.cos(j * Math.PI / 2) * 0.18, 0, Math.sin(j * Math.PI / 2) * 0.18); b.rotation.y = -j * Math.PI / 2; b.rotation.x = 0.35; }
      k.cyl(0.07, 0.07, 0.05, M.plasticDark, 0, 0, 0, fan, 12);
      sc.fans.push({ obj: fan, axis: 'y', key: 'other' });
    });
    const pnl = k.group(g, 1.75, 0, 0.1);
    k.rbox(0.6, 1.4, 0.3, 0.02, M.panelRAL7035, 0, 0.8, 0, pnl);
    sc.otherLed = k.sphere(0.02, M.ledOff, 0.15, 1.35, 0.16, pnl);
    k.explodable(pnl, [0.6, 0, 0.3]);
    k.pickable(g, 'Diğer yükler (HVAC, aydınlatma)', a => [fmt(a.state.Pother, 0, 'kW') + ' · cosφ ' + fmt(a.state.pfOther, 2), 'ATS çıkışından beslenir: kesintide jeneratör devreye girene kadar enerjisizdir.', 'Besleme: ' + (paths(a.live).bus ? (a.live.ats.QG ? 'jeneratör' : 'şebeke') : 'YOK')]);
    sc.otherLabel = k.label('Diğer yükler', g, [0, 1.9, 0]);
  }

  /* durum → sahne: kesiciler, akışlar, LED’ler, ekranlar (yalnız değişince) */
  function applyState(k, app) {
    const sc = app.scene3, L = app.live, M = k.mats; if (!sc || !L || !app.validResult) return;
    const p = paths(L), a = L.ats, r = app.validResult.values;
    const sig = [a.state, a.QM, a.QG, L.mains, L.dropped, Math.round(L.soc * 100), Math.round(L.fuelL), Math.round(a.timer * 2), app.state.accel, r.upsLoad].join('|');
    if (sig === sc.sig) return;
    sc.sig = sig;
    ['QM', 'QG'].forEach(n => {
      const b = sc.brk[n], on = a[n];
      b.handle.position.y = on ? 0.06 : -0.02; b.handle.rotation.x = on ? 0 : 0.4;
      b.flag.material = on ? M.plasticRed : M.plasticGreen;
      b.lamp.material = on ? (n === 'QM' ? M.ledGreen : M.ledAmber) : M.ledOff;
    });
    sc.bar.position.x = a.QM ? 0.08 : a.QG ? -0.08 : 0;
    const F = sc.flows, sp = x => Math.min(1.2, 0.25 + x / 120);
    F.mains.speed = p.viaMains ? sp(r.genLoadKVA / 2) : 0;
    F.gen.speed = p.viaGen ? sp(r.genLoadKVA / 2) : 0;
    F.atsUps.speed = p.bus ? sp(r.upsLoad) : 0;
    F.other.speed = p.bus && app.state.Pother > 0 ? 0.5 : 0;
    F.bat.speed = p.onBat ? sp(r.upsLoad) : p.bus && L.soc < 0.999 ? 0.15 : 0; F.bat.dir = p.onBat ? 1 : -1;
    F.crit.speed = p.crit ? sp(r.upsLoad) : 0;
    sc.upsLeds[0].material = p.bus ? M.ledGreen : M.ledOff;
    sc.upsLeds[1].material = p.onBat ? M.ledAmber : M.ledOff;
    sc.upsLeds[2].material = L.dropped ? M.ledRed : M.ledOff;
    sc.genLed.material = a.genRunning ? (a.state === 'GEN_START' ? M.ledAmber : M.ledGreen) : M.ledOff;
    sc.otherLed.material = p.bus ? M.ledGreen : M.ledOff;
    sc.srv.ledA.material = p.crit ? M.ledGreen : M.ledOff; sc.srv.ledB.material = p.crit ? M.ledBlue : M.ledOff;
    paintBattery(k, sc, L.soc);
    [sc.atsScreen, sc.upsScreen, sc.genScreen, sc.meter].forEach(x => x && x.redraw());
    sc.trafoLabel.set('Şebeke · ' + (L.mains ? 'var' : 'YOK')); sc.trafoLabel.level(L.mains ? 'ok' : 'bad');
    sc.atsLabel.set('ATS · ' + ATS_NAME[a.state]); sc.atsLabel.level(a.state === 'MAINS' ? 'ok' : 'warn');
    sc.genLabel.set('Jeneratör · ' + (a.genRunning ? (a.QG ? 'yükte %' + fmt(r.genPct, 0) : a.state === 'GEN_START' ? 'yol alıyor' : 'yüksüz') : 'beklemede')); sc.genLabel.level(a.QG ? (r.genPct > 100 ? 'bad' : 'ok') : a.genRunning ? 'warn' : '');
    sc.upsLabel.set('UPS · %' + fmt(r.upsLoad, 0) + (p.onBat ? ' · AKÜ' : L.dropped ? ' · ÇIKIŞ YOK' : '')); sc.upsLabel.level(L.dropped ? 'bad' : p.onBat ? 'warn' : r.upsLoad > 100 ? 'bad' : 'ok');
    sc.batLabel.set('Akü · SOC %' + fmt(L.soc * 100, 0)); sc.batLabel.level(L.soc < 0.2 ? 'bad' : p.onBat ? 'warn' : 'ok');
    sc.srvLabel.set('Kritik yükler · ' + (p.crit ? 'besleniyor' : 'KESİK')); sc.srvLabel.level(p.crit ? 'ok' : 'bad');
    sc.otherLabel.set('Diğer yükler · ' + (p.bus ? 'besleniyor' : 'enerjisiz')); sc.otherLabel.level(p.bus ? 'ok' : 'warn');
  }
  function update(k, res, s, live, app) { if (app.scene3) app.scene3.sig = ''; applyState(k, app); }
  function animate(k, dt, res, s, L, app) {
    const sc = app.scene3; if (!sc || !L) return;
    applyState(k, app);
    const p = paths(L), run = L.ats.genRunning;
    sc.fans.forEach(f => { const on = f.key === 'gen' ? run : p.bus; f.v = (f.v || 0) + ((on ? 14 : 0) - (f.v || 0)) * Math.min(1, dt * 1.5); if (!k.reducedMotion) f.obj.rotation[f.axis] += f.v * dt; });
    // jeneratör titreşimi ve egzoz dumanı (temsili)
    sc.genGroup.position.y = run && !k.reducedMotion ? Math.sin(app.simTime * 90) * 0.003 : 0;
    sc.puffs.forEach(m => {
      m.visible = run && !k.reducedMotion;
      if (!m.visible) return;
      m.userData.ph = (m.userData.ph + dt * 0.45) % 1;
      const t = m.userData.ph;
      m.position.set(sc.stackTop.x + t * 0.5, sc.stackTop.y + t * 1.6, sc.stackTop.z);
      m.scale.setScalar(0.6 + t * 2.4); m.material.opacity = (L.ats.state === 'GEN_START' ? 0.45 : 0.22) * (1 - t);
    });
    // sunucu LED’leri: yanıp sönme
    if (p.crit && !k.reducedMotion) sc.srv.ledB.visible = Math.floor(app.simTime * 6) % 3 !== 0; else sc.srv.ledB.visible = true;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  function view2d(g, W, H, res, s, L) {
    const v = res.values, p = paths(L), a = L.ats;
    const col = { line: '#5b6b82', live: '#fcd34d', gen: '#fb923c', bat: '#22d3ee', out: '#4ade80', text: '#e6eef8', dim: '#7f94b0', bad: '#ef4444' };
    const sx = W / 800, sy = Math.max(0.75, Math.min(1.2, H / 520));
    const X = x => x * sx, Y = y => 46 + y * sy;
    const ln = (pts, c, w, dash) => { g.save(); g.strokeStyle = c; g.lineWidth = w || 2.5; if (dash) g.setLineDash(dash); g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1])))); g.stroke(); g.restore(); };
    const txt = (t, x, y, c, al, f) => { g.fillStyle = c || col.text; g.textAlign = al || 'center'; g.font = f || (Math.max(10, 12 * Math.min(sx, 1.1)) + 'px Inter, sans-serif'); g.fillText(t, X(x), Y(y)); };
    const sw = (x, y, closed, c, name, left) => { // kesici sembolü
      ln([[x, y - 22], [x, y - 10]], c); ln([[x, y + 10], [x, y + 22]], c);
      g.save(); g.strokeStyle = closed ? c : col.dim; g.lineWidth = 3; g.beginPath(); g.moveTo(X(x), Y(y + 10)); g.lineTo(X(x + (closed ? 0 : 16)), Y(y - 10)); g.stroke(); g.restore();
      g.fillStyle = closed ? c : col.dim; g.fillRect(X(x) - 3, Y(y - 10) - 3, 6, 6);
      txt(name + (closed ? ' · kapalı' : ' · açık'), left ? x - 14 : x + 22, y + 4, closed ? col.text : col.dim, left ? 'right' : 'left');
    };
    const mainsC = L.mains ? col.live : col.line, genC = p.genV ? col.gen : col.line;
    // şebeke trafosu
    g.strokeStyle = mainsC; g.lineWidth = 2.5; g.beginPath(); g.arc(X(150), Y(30), 14 * sx + 4, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(X(150), Y(52), 14 * sx + 4, 0, Math.PI * 2); g.stroke();
    txt('Şebeke ' + (L.mains ? '(var)' : '(YOK)'), 150, 10, L.mains ? col.text : col.bad);
    ln([[150, 70], [150, 108]], mainsC);
    // jeneratör
    g.strokeStyle = genC; g.beginPath(); g.arc(X(430), Y(42), 18 * sx + 5, 0, Math.PI * 2); g.stroke(); txt('G', 430, 47, genC, 'center', 'bold 14px Inter, sans-serif');
    txt('Jeneratör ' + s.genKVA + ' kVA · ' + (a.genRunning ? (a.state === 'GEN_START' ? 'yol alıyor' : 'çalışıyor') : 'duruyor'), 430, 10, a.genRunning ? col.text : col.dim);
    ln([[430, 70], [430, 108]], genC);
    // QM / QG
    const qmC = a.QM && L.mains ? col.live : col.line, qgC = a.QG && p.genV ? col.gen : col.line;
    sw(150, 130, a.QM, qmC, 'QM', true); sw(430, 130, a.QG, qgC, 'QG');
    ln([[175, 130], [405, 130]], '#94a3b8', 1.5, [5, 5]); txt('mekanik + elektriksel kilit', 290, 120, col.dim);
    // ATS barası
    const busC = p.viaGen ? col.gen : p.viaMains ? col.live : col.line;
    ln([[150, 152], [150, 180]], qmC); ln([[430, 152], [430, 180]], qgC);
    g.save(); g.lineWidth = 6; g.strokeStyle = p.bus ? busC : col.line; g.beginPath(); g.moveTo(X(70), Y(180)); g.lineTo(X(560), Y(180)); g.stroke(); g.restore();
    txt('ATS barası · ' + ATS_NAME[a.state] + ' · ' + atsSub(a, s, L), 70, 172, col.text, 'left');
    // diğer yükler
    ln([[110, 180], [110, 300]], p.bus ? busC : col.line);
    g.strokeStyle = p.bus ? busC : col.line; g.strokeRect(X(50), Y(300), X(120), 34 * sy);
    txt('Diğer yükler', 110, 316); txt(fmt(s.Pother, 0, 'kW') + (p.bus ? '' : ' · enerjisiz'), 110, 330, p.bus ? col.dim : col.bad);
    // UPS: doğrultucu → DC bara → inverter
    ln([[500, 180], [500, 230]], p.bus ? busC : col.line);
    const upsC = p.bus ? busC : col.line;
    g.strokeStyle = upsC; g.lineWidth = 2; g.strokeRect(X(460), Y(230), X(80), 50 * sy); txt('AC/DC', 500, 260, col.text);
    const dcC = p.onBat ? col.bat : p.bus ? busC : col.line;
    ln([[540, 255], [600, 255]], dcC);
    const outC = p.crit ? col.out : col.bad;
    g.strokeStyle = p.crit ? col.out : col.line; g.strokeRect(X(600), Y(230), X(80), 50 * sy); txt('DC/AC', 640, 260, col.text);
    txt('Online UPS ' + s.upsKVA + ' kVA · %' + fmt(v.upsLoad, 0), 570, 222, col.text);
    // akü
    ln([[570, 255], [570, 330]], dcC);
    g.strokeStyle = dcC; g.lineWidth = 2.5; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(X(552), Y(334 + i * 10)); g.lineTo(X(588), Y(334 + i * 10)); g.stroke(); g.beginPath(); g.moveTo(X(561), Y(338 + i * 10)); g.lineTo(X(579), Y(338 + i * 10)); g.stroke(); }
    txt('Akü ' + fmt(v.Vbat, 0, 'V') + ' · ' + fmt(v.Ebat, 1, 'kWh'), 600, 352, col.text, 'left');
    txt('SOC %' + fmt(L.soc * 100, 0) + (p.onBat ? ' · deşarj · kalan ' + VS.fmtDuration(L.soc * v.runtime) : ''), 600, 368, p.onBat ? col.bat : col.dim, 'left');
    g.fillStyle = '#1e293b'; g.fillRect(X(600), Y(376), X(140), 10); g.fillStyle = 'hsl(' + Math.round(L.soc * 120) + ',80%,50%)'; g.fillRect(X(600), Y(376), X(140) * L.soc, 10);
    // kritik yük
    ln([[680, 255], [740, 255], [740, 300]], outC);
    g.strokeStyle = outC; g.strokeRect(X(700), Y(300), X(80), 34 * sy); txt('Kritik yük', 740, 316); txt(fmt(s.Pcrit, 0, 'kW') + (p.crit ? '' : ' · KESİK'), 740, 330, p.crit ? col.dim : col.bad);
    // olay günlüğü
    txt('Son olaylar', 70, 410, col.dim, 'left');
    L.events.slice(-5).reverse().forEach((e, i) => txt(e, 70, 428 + i * 16, i ? col.dim : col.text, 'left'));
  }

  VS.register({
    id: 'ups', title: '3D UPS ve Jeneratör Simülasyonu',
    defaults: defaults,
    initLive: initLive,
    autoRun: true,
    startText: 'Simülasyon çalışıyor: test planına göre şebeke kesilecek; ATS durumlarını izleyin.',
    start: app => { app.live = initLive(app.state); app._startedOnce = true; app.renderControls(); app.invalidate(); },
    scenarios: [
      { id: 'normal', name: 'Normal kesinti · jeneratör devralır', desc: '5. saniyede şebeke kesilir: UPS aküden besler, ATS 3 s onay + 10 s yol alma + 1 s ölü zamanla jeneratöre aktarır; 2 dk sonra şebeke döner.', state: defaults(), start: true },
      { id: 'kisa-aku', name: 'Küçük akü · geç yol alan jeneratör → yük düşer', desc: '7 Ah bloklarla ≈ 3,5 dk yedekleme; jeneratör 4 dk’da hazır olur. Akü biter ve kritik yük kesilir.', state: Object.assign(defaults(), { nBlocks: 32, Ah: 7, tGenReady: 240, outDur: 600, accel: 10 }), start: true },
      { id: 'asiri', name: 'Aşırı yüklü jeneratör', desc: '100 kVA jeneratöre UPS girişi + 90 kW diğer yük: yüklenme %100’ü aşar, ön kontrol uygunsuzluk verir.', state: Object.assign(defaults(), { genKVA: 100, Pother: 90 }), start: true },
      { id: 'dalga', name: 'Kısa süreli şebeke kesintisi (2 s)', desc: 'Şebeke onay süresi dolmadan geri gelir: jeneratör çalıştırılmaz, UPS aküsü kısa süre devreye girer.', state: Object.assign(defaults(), { outDur: 2, tConfirm: 5 }), start: true },
      { id: 'uzun', name: 'Uzun kesinti · yakıt ve akü şarjı', desc: '2 saatlik kesinti, ×120 hızlandırılmış: jeneratör yakıt tüketir; şebeke dönünce akü (temsili) şarj olur.', state: Object.assign(defaults(), { outDur: 7200, accel: 120, tank: 200 }), start: true }
    ],
    controls: controls,
    compute: s => U.compute(Object.assign({}, s, { tGap: s.tConfirm + s.tGenReady + s.tDead })),
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, L) => L.dropped ? { level: 'bad', text: 'Kritik yük kesildi' } : paths(L).onBat ? { level: 'warn', text: 'UPS akü modunda' } : L.ats.QG ? { level: 'info', text: 'Jeneratörden besleniyor' } : null,
    reportInputs: (s, app) => [{ group: 'Simülasyon', label: 'Hesaplanan jeneratör devreye girme süresi', value: fmt(s.tConfirm + s.tGenReady + s.tDead, 1, 's') }, { group: 'Simülasyon', label: 'ATS son durumu', value: ATS_NAME[app.live.ats.state] }, { group: 'Simülasyon', label: 'Akü SOC (simülasyon sonu)', value: '%' + fmt(app.live.soc * 100, 0) }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-9.6, 6.4] },
    view2d: view2d
  });
})();
